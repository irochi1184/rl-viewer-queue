// アプリ本体。Webサーバー + WebSocket でオーバーレイ/管理画面に配信する。
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { Server as SocketServer } from "socket.io";
import { publicDir } from "./paths.js"; // dotenv はここで読み込まれる

import { getAuthorizedClient } from "./auth.js";
import { YouTubeMonitor } from "./youtube.js";
import { ParticipantQueue } from "./queue.js";
import { OverlaySettings } from "./settings.js";

const PORT = Number(process.env.PORT || 3000);
const JOIN_KEYWORDS = (process.env.JOIN_KEYWORDS || "参加希望")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const MIN_POLL_INTERVAL_MS = Number(process.env.MIN_POLL_INTERVAL_MS || 4000);
const STATS_INTERVAL_MS = Number(process.env.STATS_INTERVAL_MS || 30000);
const DEFAULT_TEAM_SIZE = Number(process.env.TEAM_SIZE || 3);
// デモモード: YouTube認証なしでWebサーバーだけ起動し、ダミーの参加希望を流す。
const DEMO = process.argv.includes("--demo") || process.env.DEMO === "1";

// 直近の状態を保持して、後から接続したクライアントへ即座に同期する。
const state = {
  connected: false,
  subscriberCount: null,
  concurrentViewers: null,
  lastError: null,
};

const queue = new ParticipantQueue({ teamSize: DEFAULT_TEAM_SIZE });
const settings = new OverlaySettings();

const app = express();
app.use(express.json());

// --- 静的ファイルは fs 読み込みで配信（exe化したスナップショットからも確実に読めるように）---
function sendFile(res, file, type) {
  try {
    const buf = fs.readFileSync(path.join(publicDir, file));
    res.type(type).send(buf);
  } catch {
    res.status(404).send("not found");
  }
}
app.get("/", (_req, res) => res.redirect("/admin.html"));
app.get("/admin.html", (_req, res) => sendFile(res, "admin.html", "html"));
app.get("/overlay.html", (_req, res) => sendFile(res, "overlay.html", "html"));
app.get("/settings.html", (_req, res) => sendFile(res, "settings.html", "html"));
app.get("/socket.io.min.js", (_req, res) => sendFile(res, "socket.io.min.js", "application/javascript"));

const server = http.createServer(app);
// serveClient:false … クライアントJSは上記の自前ルートで配信する。
const io = new SocketServer(server, { serveClient: false });

// キーワード判定（部分一致・大文字小文字無視）。
function matchesJoin(text) {
  const lower = (text || "").toLowerCase();
  return JOIN_KEYWORDS.some((k) => lower.includes(k.toLowerCase()));
}

function snapshot() {
  return {
    ...state,
    keywords: JOIN_KEYWORDS,
    ...queue.snapshot(),
    settings: settings.get(),
  };
}

function broadcast() {
  io.emit("state", snapshot());
}

io.on("connection", (socket) => {
  socket.emit("state", snapshot());

  // 管理画面からの操作。
  socket.on("queue:add", (name) => queue.addManual(name));
  socket.on("queue:remove", (id) => queue.remove(id));
  socket.on("queue:clear", () => queue.clear());
  socket.on("queue:arrange", (groups) => queue.arrange(groups || {}));
  socket.on("queue:autoAssign", () => queue.autoAssign());
  socket.on("queue:swapTeams", () => queue.swapTeams());
  socket.on("queue:clearTeams", () => queue.clearTeams());
  socket.on("queue:setTeamSize", (n) => queue.setTeamSize(n));

  // オーバーレイ設定の更新・リセット。
  socket.on("settings:update", (patch) => settings.update(patch));
  socket.on("settings:reset", () => settings.reset());
});

queue.on("change", () => broadcast());
// 設定変更は専用イベントでも通知（オーバーレイ/設定画面が軽量に反映できる）。
settings.on("change", (s) => io.emit("settings", s));

function printEndpoints() {
  console.log("\n----------------------------------------------");
  console.log(`管理画面 : http://localhost:${PORT}/admin.html`);
  console.log(`OBS用URL : http://localhost:${PORT}/overlay.html`);
  console.log("  → OBSの「ブラウザソース」に上記URLを設定してください。");
  console.log("----------------------------------------------\n");
}

// デモモード: 認証せずWebサーバーを起動し、数秒おきにダミーの参加希望を流す。
function runDemo() {
  console.log("=== rl-viewer-queue 起動中（デモモード）===");
  console.log("⚠ YouTubeには接続しません。動作確認・OBSレイアウト調整用です。");
  state.connected = true;
  state.subscriberCount = 12345;
  state.concurrentViewers = 87;
  const names = ["ロケット太郎", "Boostマスター", "さくらRL", "ぷれいやーA", "GoalKing", "ねこまた", "Aerial王", "しおり"];
  let i = 0;
  server.listen(PORT, () => printEndpoints());
  setInterval(() => {
    if (i < names.length) {
      const added = queue.add({ name: names[i], channelId: "demo-" + i, photo: "" });
      if (added) io.emit("joined", added);
      i++;
    }
    state.concurrentViewers = 80 + Math.floor(Math.random() * 30);
    broadcast();
  }, 3000);
}

async function main() {
  if (DEMO) return runDemo();

  console.log("=== rl-viewer-queue 起動中 ===");
  console.log("参加希望キーワード:", JOIN_KEYWORDS.join(" / "));

  // 認可（未認可ならブラウザが開く）。
  const auth = await getAuthorizedClient();

  const monitor = new YouTubeMonitor(auth, {
    minPollIntervalMs: MIN_POLL_INTERVAL_MS,
    statsIntervalMs: STATS_INTERVAL_MS,
  });

  monitor.on("status", (s) => {
    state.connected = !!s.connected;
    if (s.reason === "live-ended") console.log("ライブ配信が終了したため監視を停止しました。");
    broadcast();
  });

  monitor.on("stats", (s) => {
    state.subscriberCount = s.subscriberCount;
    state.concurrentViewers = s.concurrentViewers;
    broadcast();
  });

  monitor.on("chat", (msg) => {
    if (!matchesJoin(msg.text)) return;
    const added = queue.add({
      name: msg.authorName,
      channelId: msg.authorChannelId,
      photo: msg.authorPhoto,
    });
    if (added) {
      console.log(`[参加希望] ${added.name}`);
      io.emit("joined", added);
    }
  });

  monitor.on("error", (e) => {
    state.lastError = e.reason;
    console.error("YouTube APIエラー:", e.code, e.reason);
    broadcast();
  });

  server.listen(PORT, () => printEndpoints());

  // 配信監視を開始。失敗（配信未開始など）してもサーバーは動かし続ける。
  let retry = null;
  const tryStart = async () => {
    try {
      await monitor.start();
      if (retry) clearInterval(retry);
      retry = null;
      state.lastError = null;
      console.log("ライブ配信を検出しました。チャット監視を開始します。");
      broadcast();
      return true;
    } catch (e) {
      state.lastError = e.message;
      broadcast();
      return false;
    }
  };

  if (!(await tryStart())) {
    console.warn("⚠ 配信監視を開始できませんでした。配信開始後に自動再接続します（管理画面の『再接続』でも可）。");
    retry = setInterval(tryStart, 30000);
  }

  // 管理画面からの手動再接続。
  io.on("connection", (socket) => {
    socket.on("monitor:reconnect", () => tryStart());
  });
}

main().catch((e) => {
  console.error("起動に失敗しました:", e.message);
  process.exit(1);
});
