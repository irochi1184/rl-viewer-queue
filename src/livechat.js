// YouTube ライブチャットを「Data APIを使わずに」取得するモジュール。
// OBSの「チャットをポップアウト」(youtube.com/live_chat) と同じ内部エンドポイント
// (InnerTube: youtubei/v1/live_chat/get_live_chat) を継続トークンでポーリングする。
// → Data APIのクォータを消費しないため、長時間配信でも上限に当たらない。
//
// 注意: 非公式エンドポイントのため、YouTube内部仕様の変更で動かなくなる可能性がある。
//       その場合は youtube.js 側でAPI方式へ自動フォールバックする。
import { EventEmitter } from "node:events";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class LiveChatScraper extends EventEmitter {
  constructor(videoId, opts = {}) {
    super();
    this.videoId = videoId;
    this.minIntervalMs = opts.minIntervalMs ?? 1500;
    this._running = false;
    this._timer = null;
    this._misses = 0;
    this._seen = new Set(); // 重複防止（直近のメッセージID）
  }

  async start() {
    const init = await this._fetchInit();
    this.apiKey = init.apiKey;
    this.clientVersion = init.clientVersion;
    this.continuation = init.continuation;
    if (!this.apiKey || !this.continuation) {
      throw new Error("ライブチャット情報を取得できませんでした（チャット無効、または配信が見つからない）。");
    }
    this._running = true;
    this._poll();
  }

  stop() {
    this._running = false;
    clearTimeout(this._timer);
  }

  // live_chat ページから APIキー・クライアントバージョン・初期継続トークンを取得。
  async _fetchInit() {
    const url = `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(this.videoId)}`;
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" } });
    const html = await res.text();
    const apiKey = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
    const clientVersion =
      (html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || [])[1] ||
      (html.match(/"clientVersion":"([\d.]+)"/) || [])[1] ||
      "2.20240101.00.00";
    let continuation = null;
    const raw = extractJson(html, "ytInitialData");
    if (raw) {
      try {
        const data = JSON.parse(raw);
        const conts = data?.contents?.liveChatRenderer?.continuations || [];
        const c = conts[0] || {};
        continuation =
          c.invalidationContinuationData?.continuation ||
          c.timedContinuationData?.continuation ||
          c.reloadContinuationData?.continuation ||
          null;
      } catch { /* ignore */ }
    }
    return { apiKey, clientVersion, continuation };
  }

  async _poll() {
    if (!this._running) return;
    let wait = this.minIntervalMs;
    try {
      const body = {
        context: { client: { clientName: "WEB", clientVersion: this.clientVersion, hl: "ja" } },
        continuation: this.continuation,
      };
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${this.apiKey}&prettyPrint=false`,
        { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA }, body: JSON.stringify(body) }
      );
      const data = await res.json();
      const lcc = data?.continuationContents?.liveChatContinuation;
      if (!lcc) {
        // 一時的な取りこぼしの可能性。数回続いたら終了とみなす。
        if (++this._misses > 5) { this.emit("ended"); this.stop(); return; }
        this._timer = setTimeout(() => this._poll(), 3000);
        return;
      }
      this._misses = 0;

      // 次の継続トークンと待機時間
      const cont = (lcc.continuations || [])[0] || {};
      const c = cont.invalidationContinuationData || cont.timedContinuationData || cont.reloadContinuationData || {};
      if (c.continuation) this.continuation = c.continuation;
      // YouTube推奨待機(timeoutMs)を尊重しつつ、応答性のため上限5秒（InnerTubeはクォータ消費なし）。
      wait = Math.min(5000, Math.max(this.minIntervalMs, Number(c.timeoutMs || 0) || this.minIntervalMs));

      for (const a of lcc.actions || []) {
        const item = a.addChatItemAction?.item;
        const r = item?.liveChatTextMessageRenderer;
        if (!r) continue;
        const id = r.id || "";
        if (id && this._seen.has(id)) continue;
        if (id) {
          this._seen.add(id);
          if (this._seen.size > 500) this._seen = new Set([...this._seen].slice(-250));
        }
        const text = (r.message?.runs || [])
          .map((run) => (run.text != null ? run.text : run.emoji ? (run.emoji.shortcuts?.[0] || "") : ""))
          .join("");
        const icons = (r.authorBadges || []).map(
          (b) => b.liveChatAuthorBadgeRenderer?.icon?.iconType || ""
        );
        this.emit("chat", {
          id: id || "ic-" + Date.now() + Math.random(),
          authorName: r.authorName?.simpleText || "",
          authorChannelId: r.authorExternalChannelId || "",
          authorPhoto: r.authorPhoto?.thumbnails?.slice(-1)[0]?.url || "",
          text,
          isOwner: icons.includes("OWNER"),
          isModerator: icons.includes("MODERATOR"),
        });
      }
    } catch (e) {
      this.emit("error", { reason: e.message });
      wait = 5000;
    }
    this._timer = setTimeout(() => this._poll(), wait);
  }
}

// HTML中の `marker = { ... }` を波括弧の対応で安全に抜き出す（文字列内の括弧も考慮）。
function extractJson(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const s = html.indexOf("{", i);
  if (s < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = s; j < html.length; j++) {
    const ch = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { if (--depth === 0) return html.slice(s, j + 1); }
  }
  return null;
}
