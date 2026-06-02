// YouTube API の OAuth 2.0 認証を扱うモジュール。
// 初回はブラウザで認可し、取得した refresh_token を data/tokens.json に保存する。
// 2回目以降は保存済みトークンを自動で使い回す。
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { OAuth2Client } from "google-auth-library";
import { baseDir, dataDir } from "./paths.js"; // dotenv はここで読み込まれる

const ROOT = baseDir;
const TOKENS_PATH = path.join(dataDir, "tokens.json");

// 既定ブラウザでURLを開く（OS標準コマンドを使用。外部パッケージ不要でexe化に強い）。
function openUrl(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* 開けなくてもURLはコンソールに表示済み */
  }
}

// 自分の配信のチャット読み取りに必要なスコープ。
// readonly だけだと liveChatMessages が読めないため youtube スコープを付与。
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube",
];

const PORT = Number(process.env.PORT || 3000);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

// .env もしくは client_secret.json から OAuth クライアント情報を読み込む。
function loadClientCredentials() {
  const fileEnv = process.env.CLIENT_SECRET_FILE;
  if (fileEnv) {
    const p = path.isAbsolute(fileEnv) ? fileEnv : path.join(ROOT, fileEnv);
    const json = JSON.parse(fs.readFileSync(p, "utf8"));
    const node = json.installed || json.web;
    if (!node) throw new Error("client_secret.json の形式が不正です（installed / web キーが見つかりません）");
    return { clientId: node.client_id, clientSecret: node.client_secret };
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "OAuth クライアント情報が未設定です。.env に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を設定するか、CLIENT_SECRET_FILE を指定してください。"
    );
  }
  return { clientId, clientSecret };
}

// OAuth2 クライアントを生成する。
export function createOAuthClient() {
  const { clientId, clientSecret } = loadClientCredentials();
  return new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
}

function saveTokens(tokens) {
  fs.mkdirSync(path.dirname(TOKENS_PATH), { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), "utf8");
}

function loadTokens() {
  if (!fs.existsSync(TOKENS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));
  } catch {
    return null;
  }
}

// 認可済みの OAuth クライアントを返す。トークンが無ければブラウザ認可フローを実行する。
export async function getAuthorizedClient() {
  const oauth2 = createOAuthClient();
  const tokens = loadTokens();

  // トークンが更新されたら自動保存する。
  oauth2.on("tokens", (t) => {
    const merged = { ...loadTokens(), ...t };
    saveTokens(merged);
  });

  if (tokens && tokens.refresh_token) {
    oauth2.setCredentials(tokens);
    return oauth2;
  }

  // 初回認可フロー
  return runConsentFlow(oauth2);
}

// ブラウザを開いてユーザーに認可させ、コードをローカルサーバーで受け取る。
function runConsentFlow(oauth2) {
  return new Promise((resolve, reject) => {
    const authUrl = oauth2.generateAuthUrl({
      access_type: "offline", // refresh_token を得るために必須
      prompt: "consent", // 毎回 refresh_token を確実に得る
      scope: SCOPES,
    });

    const server = http.createServer(async (req, res) => {
      if (!req.url.startsWith("/oauth2callback")) {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      if (err) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>認可エラー: ${err}</h1>`);
        server.close();
        reject(new Error(`認可が拒否されました: ${err}`));
        return;
      }
      try {
        const { tokens } = await oauth2.getToken(code);
        oauth2.setCredentials(tokens);
        saveTokens(tokens);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<h1>認可が完了しました ✅</h1><p>このタブを閉じてアプリに戻ってください。</p>"
        );
        server.close();
        resolve(oauth2);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<h1>トークン取得に失敗しました</h1><pre>${e.message}</pre>`);
        server.close();
        reject(e);
      }
    });

    server.listen(PORT, () => {
      console.log("\n=== YouTube アカウントの認可が必要です ===");
      console.log("ブラウザが開きます。配信に使うアカウントでログイン・許可してください。");
      console.log("自動で開かない場合は次のURLを手動で開いてください:\n");
      console.log(authUrl + "\n");
      openUrl(authUrl);
    });

    server.on("error", reject);
  });
}

// 単体実行（npm run auth）で認可だけ済ませる用途。
if (import.meta.url === `file://${process.argv[1]}`) {
  getAuthorizedClient()
    .then(() => {
      console.log("認可情報を data/tokens.json に保存しました。");
      process.exit(0);
    })
    .catch((e) => {
      console.error("認可に失敗しました:", e.message);
      process.exit(1);
    });
}
