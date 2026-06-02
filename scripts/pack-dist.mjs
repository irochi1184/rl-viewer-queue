// ビルド後、配布フォルダ dist/ に .env テンプレートとクイックスタート手順を同梱する。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });

// .env テンプレート（既存ユーザー設定を消さないよう .env.template として置く）
fs.copyFileSync(path.join(root, ".env.example"), path.join(dist, ".env.template"));

const guide = `■ rl-viewer-queue クイックスタート（Windows）

1. このフォルダの「.env.template」を「.env」にリネームしてメモ帳で開く
2. Google Cloud で取得した GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を記入して保存
   （取得手順は README.md を参照。リダイレクトURIは http://localhost:3000/oauth2callback ）
3. 先に YouTube のライブ配信を開始する
4. rl-viewer-queue.exe をダブルクリック
   → 初回はブラウザが開くので、配信アカウントで「許可」する
   → 認証情報は data フォルダに保存され、次回以降は自動
5. 黒い画面(コンソール)に表示されるURLを OBS の「ブラウザソース」に設定
   OBS用URL : http://localhost:3000/overlay.html
   操作用URL : http://localhost:3000/admin.html （普通のブラウザで開く）

※ exe・.env・data フォルダは同じフォルダに置いたままにしてください。
※ コンソール画面は配信中つけっぱなしにしてください（閉じると停止します）。
`;
fs.writeFileSync(path.join(dist, "はじめにお読みください.txt"), guide, "utf8");
console.log("packed dist: .env.template, はじめにお読みください.txt");
