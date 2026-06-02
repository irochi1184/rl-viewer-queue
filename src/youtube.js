// YouTube Data API v3 とのやり取りをまとめたモジュール。
//  - アクティブなライブ配信とチャットID(liveChatId)の取得
//  - ライブチャットメッセージのポーリング
//  - チャンネル登録者数 / 同時視聴者数の取得
import { youtube as youtubeApi } from "@googleapis/youtube";
import { EventEmitter } from "node:events";

export class YouTubeMonitor extends EventEmitter {
  /**
   * @param {import('google-auth-library').OAuth2Client} auth 認可済みクライアント
   * @param {object} opts
   * @param {number} opts.minPollIntervalMs チャットポーリングの下限間隔
   * @param {number} opts.statsIntervalMs 登録者数/視聴者数の取得間隔
   */
  constructor(auth, opts = {}) {
    super();
    this.youtube = youtubeApi({ version: "v3", auth });
    this.minPollIntervalMs = opts.minPollIntervalMs ?? 4000;
    this.statsIntervalMs = opts.statsIntervalMs ?? 30000;

    this.liveChatId = null;
    this.videoId = null;
    this.channelId = null;
    this.nextPageToken = undefined;

    this._chatTimer = null;
    this._statsTimer = null;
    this._running = false;
    // 初回ポーリングで過去ログを大量に処理しないため、起動以降のメッセージのみ対象にする。
    this._startedAt = Date.now();
  }

  // 自分のアクティブなライブ配信を探し、liveChatId と videoId を確定する。
  async resolveActiveBroadcast() {
    const res = await this.youtube.liveBroadcasts.list({
      part: ["snippet", "contentDetails", "status"],
      broadcastStatus: "active",
      broadcastType: "all",
      maxResults: 5,
    });
    const items = res.data.items || [];
    if (items.length === 0) {
      throw new Error(
        "アクティブなライブ配信が見つかりません。YouTube側で配信を開始してから起動してください。"
      );
    }
    const live = items[0];
    this.liveChatId = live.snippet?.liveChatId || null;
    this.videoId = live.id || null;
    this.channelId = live.snippet?.channelId || null;
    if (!this.liveChatId) {
      throw new Error("この配信にはライブチャットが有効になっていません。");
    }
    return { liveChatId: this.liveChatId, videoId: this.videoId };
  }

  // 監視を開始する。
  async start() {
    if (this._running) return;
    await this.resolveActiveBroadcast();
    this._running = true;
    this.emit("status", { connected: true, videoId: this.videoId });
    this._pollChat();
    this._pollStats();
  }

  stop() {
    this._running = false;
    clearTimeout(this._chatTimer);
    clearTimeout(this._statsTimer);
  }

  async _pollChat() {
    if (!this._running) return;
    let waitMs = this.minPollIntervalMs;
    try {
      const res = await this.youtube.liveChatMessages.list({
        liveChatId: this.liveChatId,
        part: ["snippet", "authorDetails"],
        pageToken: this.nextPageToken,
        maxResults: 200,
      });
      this.nextPageToken = res.data.nextPageToken;
      const apiInterval = Number(res.data.pollingIntervalMillis || 0);
      // YouTube推奨間隔と自前の下限の大きい方を採用（クォータ保護）。
      waitMs = Math.max(apiInterval, this.minPollIntervalMs);

      for (const item of res.data.items || []) {
        const publishedAt = new Date(item.snippet?.publishedAt || 0).getTime();
        // 起動前の過去メッセージはスキップ。
        if (publishedAt < this._startedAt) continue;
        const message = {
          id: item.id,
          text: item.snippet?.displayMessage || "",
          authorName: item.authorDetails?.displayName || "",
          authorChannelId: item.authorDetails?.channelId || "",
          authorPhoto: item.authorDetails?.profileImageUrl || "",
          isModerator: !!item.authorDetails?.isChatModerator,
          isOwner: !!item.authorDetails?.isChatOwner,
          publishedAt,
        };
        this.emit("chat", message);
      }
    } catch (e) {
      this._handleError(e);
      // チャットが終了(403/404)していたら停止イベント。
      if (this._isLiveEnded(e)) {
        this.emit("status", { connected: false, reason: "live-ended" });
        this.stop();
        return;
      }
    }
    this._chatTimer = setTimeout(() => this._pollChat(), waitMs);
  }

  async _pollStats() {
    if (!this._running) return;
    try {
      const [subs, viewers] = await Promise.all([
        this._fetchSubscriberCount(),
        this._fetchConcurrentViewers(),
      ]);
      this.emit("stats", { subscriberCount: subs, concurrentViewers: viewers });
    } catch (e) {
      this._handleError(e);
    }
    this._statsTimer = setTimeout(() => this._pollStats(), this.statsIntervalMs);
  }

  async _fetchSubscriberCount() {
    const res = await this.youtube.channels.list({
      part: ["statistics"],
      mine: true,
    });
    const stat = res.data.items?.[0]?.statistics;
    if (!stat) return null;
    // 登録者数を非公開にしている場合 hiddenSubscriberCount=true。
    if (stat.hiddenSubscriberCount) return null;
    return Number(stat.subscriberCount);
  }

  async _fetchConcurrentViewers() {
    if (!this.videoId) return null;
    const res = await this.youtube.videos.list({
      part: ["liveStreamingDetails"],
      id: [this.videoId],
    });
    const details = res.data.items?.[0]?.liveStreamingDetails;
    if (!details || details.concurrentViewers == null) return null;
    return Number(details.concurrentViewers);
  }

  _isLiveEnded(e) {
    const code = e?.code || e?.response?.status;
    const reason = e?.errors?.[0]?.reason || e?.response?.data?.error?.errors?.[0]?.reason;
    return code === 403 || code === 404 || reason === "liveChatEnded" || reason === "liveChatNotFound";
  }

  _handleError(e) {
    const code = e?.code || e?.response?.status;
    const reason = e?.response?.data?.error?.errors?.[0]?.reason || e?.message;
    this.emit("error", { code, reason: String(reason) });
  }
}
