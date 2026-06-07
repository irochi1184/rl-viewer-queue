// 完全に Data API / OAuth を使わずに、チャンネル名だけでライブを監視するモニター。
//  - ライブ動画の発見: チャンネルの /live ページから現在のライブ動画IDを取得
//  - チャット: InnerTube(LiveChatScraper)で取得（クォータ消費ゼロ）
//  - 同時視聴者数: youtubei/v1/updated_metadata から取得
//  - 登録者数: チャンネルページの表示テキストから取得（大規模は概数、小規模はほぼ正確）
// YouTubeMonitor と同じイベント(status/chat/stats/error/chatSource)を発行するので差し替え可能。
import { EventEmitter } from "node:events";
import { LiveChatScraper } from "./livechat.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const headers = () => ({ "User-Agent": UA, "Accept-Language": "ja,en;q=0.8", Cookie: "SOCS=CAI;" });

export class ScrapeMonitor extends EventEmitter {
  constructor(channel, opts = {}) {
    super();
    this.channel = channel;
    this.base = channelBase(channel);
    this.viewersIntervalMs = opts.viewersIntervalMs ?? 30000;
    this.subsIntervalMs = opts.subsIntervalMs ?? 5 * 60 * 1000;
    this._running = false;
    this._scraper = null;
    this._vTimer = null;
    this._sTimer = null;
    this._lastSubs = null;
    this._lastViewers = null;
    this.videoId = null;
    this.apiKey = null;
    this.clientVersion = null;
  }

  async start() {
    if (this._running) return;
    await this._resolveLive(); // videoId / apiKey / clientVersion を確定（ライブが無ければ throw）
    this._running = true;
    this.emit("status", { connected: true, videoId: this.videoId });

    // チャット（InnerTube）
    this._scraper = new LiveChatScraper(this.videoId, { minIntervalMs: 1500 });
    this._scraper.on("chat", (m) => this.emit("chat", m));
    this._scraper.on("ended", () => { this.emit("status", { connected: false, reason: "live-ended" }); this.stop(); });
    this._scraper.on("error", (e) => this.emit("error", { code: 0, reason: "innertube: " + e.reason }));
    await this._scraper.start();
    this.emit("chatSource", "innertube");

    // 統計（視聴者数・登録者数）
    this._pollViewers();
    this._pollSubs();
  }

  stop() {
    this._running = false;
    clearTimeout(this._vTimer);
    clearTimeout(this._sTimer);
    if (this._scraper) { this._scraper.stop(); this._scraper = null; }
  }

  // /live ページから現在のライブ動画ID・APIキー・クライアントバージョンを取得。
  async _resolveLive() {
    const res = await fetch(this.base + "/live", { headers: headers() });
    const html = await res.text();
    const vid =
      (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})">/) || [])[1] ||
      (html.match(/"liveBroadcastDetails":\{"isLiveNow":true[^}]*?"[^"]*"/) ? (html.match(/"videoId":"([\w-]{11})"/) || [])[1] : null);
    this.apiKey = (html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) || [])[1];
    this.clientVersion = (html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || [])[1] || "2.20240101.00.00";
    if (!vid || !this.apiKey) {
      throw new Error("このチャンネルは現在ライブ配信していないようです（または取得に失敗）。配信開始後に自動接続します。");
    }
    this.videoId = vid;
    return vid;
  }

  async _pollViewers() {
    if (!this._running) return;
    try {
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/updated_metadata?key=${this.apiKey}&prettyPrint=false`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": UA },
          body: JSON.stringify({ context: { client: { clientName: "WEB", clientVersion: this.clientVersion, hl: "ja" } }, videoId: this.videoId }),
        }
      );
      const data = await res.json();
      for (const a of data?.actions || []) {
        const r = a.updateViewershipAction?.viewCount?.videoViewCountRenderer;
        if (!r) continue;
        let n = Number(r.originalViewCount);
        if (!Number.isFinite(n)) {
          const t = (r.viewCount?.runs || []).map((x) => x.text).join("");
          const d = t.replace(/[^\d]/g, "");
          n = d ? Number(d) : NaN;
        }
        if (Number.isFinite(n)) this._lastViewers = n;
      }
      this.emit("stats", { subscriberCount: this._lastSubs, concurrentViewers: this._lastViewers });
    } catch (e) {
      this.emit("error", { code: 0, reason: "viewers: " + e.message });
    }
    this._vTimer = setTimeout(() => this._pollViewers(), this.viewersIntervalMs);
  }

  async _pollSubs() {
    if (!this._running) return;
    try {
      const res = await fetch(this.base, { headers: headers() });
      const html = await res.text();
      const subs = parseSubs(html);
      if (subs != null) {
        this._lastSubs = subs;
        this.emit("stats", { subscriberCount: this._lastSubs, concurrentViewers: this._lastViewers });
      }
    } catch { /* 取得失敗は無視（次回再試行） */ }
    this._sTimer = setTimeout(() => this._pollSubs(), this.subsIntervalMs);
  }
}

// チャンネル指定(@handle / UC... / ハンドル名 / URL)を https://www.youtube.com/... のベースURLに正規化。
function channelBase(ch) {
  ch = String(ch).trim();
  if (/^https?:\/\//i.test(ch)) return ch.replace(/\/+$/, "").replace(/\/(live|streams|videos|featured|about)$/i, "");
  if (/^UC[\w-]{20,}$/.test(ch)) return "https://www.youtube.com/channel/" + ch;
  if (ch.startsWith("@")) return "https://www.youtube.com/" + ch;
  return "https://www.youtube.com/@" + ch;
}

// 登録者数テキスト（"チャンネル登録者数 1580万人" / "90人" / "1.58M subscribers"）を数値化。
function parseSubs(html) {
  const m =
    html.match(/(?:subscribers|チャンネル登録者数?)[^0-9]{0,8}([\d.,]+)\s*([KMB万億]?)/i) ||
    html.match(/([\d.,]+)\s*([KMB万億]?)\s*(?:subscribers|人?のチャンネル登録者)/i);
  if (!m) return null;
  let n = parseFloat(String(m[1]).replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const unit = m[2] || "";
  const mult =
    { "": 1, K: 1e3, M: 1e6, B: 1e9, "万": 1e4, "億": 1e8 }[unit] ??
    { "": 1, K: 1e3, M: 1e6, B: 1e9 }[unit.toUpperCase()] ?? 1;
  return Math.round(n * mult);
}
