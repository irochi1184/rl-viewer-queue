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
    // クォータ超過/レート制限時に待つ間隔。長めに待って自動回復させる（リセットで復帰）。
    this.quotaBackoffMs = opts.quotaBackoffMs ?? 5 * 60 * 1000;
    // 登録者数は変化が遅いので毎回は取らない（統計サイクルN回に1回）。クォータ節約。
    this.subsEvery = opts.subsEvery ?? 10;

    this.liveChatId = null;
    this.videoId = null;
    this.channelId = null;
    this.nextPageToken = undefined;

    this._chatTimer = null;
    this._statsTimer = null;
    this._running = false;
    this._statsTick = 0;
    this._lastSubs = null;
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
      // 本当にチャットが終了/消滅したときだけ停止。
      if (this._isLiveEnded(e)) {
        this.emit("status", { connected: false, reason: "live-ended" });
        this.stop();
        return;
      }
      // クォータ超過/レート制限は「終了」ではない。長めに待って継続（リセット後に自動復帰）。
      if (this._isQuota(e)) waitMs = this.quotaBackoffMs;
    }
    this._chatTimer = setTimeout(() => this._pollChat(), waitMs);
  }

  async _pollStats() {
    if (!this._running) return;
    let nextMs = this.statsIntervalMs;
    try {
      // 登録者数は subsEvery 回に1回だけ取得（クォータ節約）。視聴者数は毎回。
      const doSubs = this._statsTick++ % this.subsEvery === 0;
      const subs = doSubs ? await this._fetchSubscriberCount() : this._lastSubs;
      if (doSubs) this._lastSubs = subs;
      const viewers = await this._fetchConcurrentViewers();
      this.emit("stats", { subscriberCount: this._lastSubs, concurrentViewers: viewers });
    } catch (e) {
      this._handleError(e);
      if (this._isQuota(e)) nextMs = this.quotaBackoffMs; // クォータ中は統計も間隔を空ける
    }
    this._statsTimer = setTimeout(() => this._pollStats(), nextMs);
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

  _reasonOf(e) {
    return e?.errors?.[0]?.reason || e?.response?.data?.error?.errors?.[0]?.reason || "";
  }

  // 本当に配信/チャットが終了・消滅したか（quota や rate limit は含めない）。
  _isLiveEnded(e) {
    const code = e?.code || e?.response?.status;
    const reason = this._reasonOf(e);
    if (reason === "liveChatEnded" || reason === "liveChatNotFound") return true;
    if (code === 404) return true;
    return false;
  }

  // クォータ超過・レート制限（403だが「終了」ではない。待てば回復する）。
  _isQuota(e) {
    const reason = this._reasonOf(e);
    return reason === "quotaExceeded" || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded";
  }

  _handleError(e) {
    const code = e?.code || e?.response?.status;
    const reason = e?.response?.data?.error?.errors?.[0]?.reason || e?.message;
    this.emit("error", { code, reason: String(reason) });
  }
}
