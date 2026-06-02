# rl-viewer-queue

Rocket League などの **YouTube 視聴者参加型配信** 用ツール。
ライブチャットに「**参加希望**」とコメントした視聴者を自動でリストアップし、
**🔵青チーム vs 🟠オレンジチーム** に振り分けて、**OBS のブラウザソース**で配信画面に表示します。
**チャンネル登録者数**と**同時視聴者数**も表示できます。

## 機能

- 🎮 「参加希望」コメントを検出 → 投稿者名を自動で待機列に追加（同一人物は重複しない）
- 🔵🟠 **チーム分け**：青 vs オレンジに振り分け。**1vs1〜4vs4**（試合形式）を切替可能
- 🔀 ドラッグ＆ドロップ／ボタンで枠間を移動、**サイド交代（青⇄オレンジ）**、**自動振り分け**
- 📋 OBS オーバーレイに「青 vs オレンジ ＋ 待機列」を表示（透過背景）
- 👥 登録者数・同時視聴者数をリアルタイム表示
- 💬 **コメント表示**：ライブチャットを「縦の一覧」または「横に流れる（ニコニコ風）」で表示（設定で切替）
- 🪟 **独立ウィンドウ**：統計／チーム／待機列／コメントを個別URLで出力でき、OBS上で1つずつ自由に配置・サイズ変更
- 🎨 **オーバーレイ設定画面**：配置(4隅)・余白・幅・拡大率・色・角丸・背景透明度・各項目の表示/非表示・ラベル文言・コメント表示形式を GUI で変更（OBSを見ながらライブ反映）

---

## 使い方A：exe をダウンロードして使う（配信者向け・Node不要）

`dist/rl-viewer-queue.exe` を配布フォルダごと使います。同梱の **「はじめにお読みください.txt」** が最短手順です。

1. **YouTube API の準備（初回のみ）** … 下の「YouTube API の準備」を参照
2. `.env.template` を `.env` にリネームし、`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を記入
3. **先に YouTube のライブ配信を開始**する
4. `rl-viewer-queue.exe` をダブルクリック → 初回はブラウザで認可（配信アカウントで許可）
5. コンソールに出るURLを OBS の「ブラウザソース」に設定
   - OBS用URL：`http://localhost:3000/overlay.html`
   - 操作用URL：`http://localhost:3000/admin.html`（普段のブラウザで開く）

> `exe` / `.env` / `data` フォルダは**同じフォルダ**に置いてください。
> 認可情報・参加者リストは exe の隣の `data/` に保存されます。
> コンソール画面は配信中つけっぱなしに（閉じると停止します）。

---

## 使い方B：ソースから動かす（開発者向け）

```bash
npm install
cp .env.example .env   # 値を編集
npm start              # 初回はブラウザで認可
```

動作確認だけしたい場合（YouTube認証不要のダミー表示）：

```bash
npm run demo
```

---

## YouTube API の準備（初回のみ）

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「APIとサービス」→「ライブラリ」で **YouTube Data API v3** を有効化
3. 「OAuth 同意画面」を設定（ユーザーの種類：**外部**／テストユーザーに自分の配信用Gmailを追加）
4. 「認証情報」→「OAuth クライアント ID」を作成
   - 種類：**ウェブ アプリケーション**
   - 承認済みリダイレクト URI に **`http://localhost:3000/oauth2callback`** を追加
5. 発行された **クライアントID / シークレット** を `.env` に記入
   （JSONを使う場合は `.env` の `CLIENT_SECRET_FILE=./client_secret.json` を有効化）

---

## OBS への表示

1. OBS の「ソース」→「＋」→「ブラウザ」を追加
2. URL に `http://localhost:3000/overlay.html`
3. 幅 380 / 高さ 900 程度（背景は透過）。配信画面の好きな位置へ

> OBSのブラウザソースは広めに作っておき、**位置・サイズ・拡大率はオーバーレイ設定画面で調整**するのがおすすめです（OBSソースを作り直さずに微調整できます）。

---

## オーバーレイの見た目を変える（設定画面）

管理画面の **「🎨 オーバーレイ設定」** ボタン、または `http://localhost:3000/settings.html` を開きます。

- **配置**：右上 / 左上 / 右下 / 左下 ＋ 横・縦の余白
- **サイズ**：幅・全体の拡大率
- **デザイン**：角丸・背景の不透明度・文字色・青チーム色・オレンジ色・アクセント色
- **表示する項目**：登録者数 / 同時視聴者数 / 青 / オレンジ / 待機列 / VS / アイコン / 番号 / 空きスロット を個別にON/OFF
- **ラベル文言**：「青チーム」「オレンジチーム」「待機列」の表記を変更（例：「レッド」「ブルー」など）

変更は即座にOBS表示へ反映され、設定画面内のライブプレビューでも確認できます。設定は `data/overlay-settings.json` に保存されます。

### コメント表示

- **縦の一覧**：新しいコメントが下に積まれる定番スタイル
- **横に流れる**：ニコニコ動画風に右→左へ流れる（コメント単独ウィンドウなら画面全体に流せます）
- 表示件数（一覧）・流れる速さ（横流れ）・アイコン有無を設定可能

### 各ウィンドウを個別に配置（独立ウィンドウ）

`overlay.html?view=◯◯` を**別々のブラウザソース**としてOBSに追加すると、OBS上で1つずつ自由に移動・拡大縮小できます。設定画面の「OBS用URL」からコピーできます。

| 内容 | URL |
|------|-----|
| 全部入り | `http://localhost:3000/overlay.html` |
| 統計のみ | `http://localhost:3000/overlay.html?view=stats` |
| チームのみ | `http://localhost:3000/overlay.html?view=teams` |
| 待機列のみ | `http://localhost:3000/overlay.html?view=waiting` |
| コメントのみ | `http://localhost:3000/overlay.html?view=comments` |
| 青チームのみ | `http://localhost:3000/overlay.html?view=blue` |
| オレンジのみ | `http://localhost:3000/overlay.html?view=orange` |

> 個別ウィンドウは左上基準で表示されるので、位置・サイズはOBSのソース変形で調整します。「コメントのみ＋横に流れる」は画面全体に流したいとき便利です。

---

## 操作（管理画面 /admin.html）

- **試合形式**：1vs1〜4vs4 を選択（各チームの定員が変わる）
- **自動振り分け**：待機列の先頭から青→オレンジへ定員まで自動配置
- **サイド交代 🔵⇄🟠**：青とオレンジのメンバーを丸ごと入れ替え
- **チーム解除**：両チームを待機列へ戻す
- カードを**ドラッグ**で枠間移動／カード上の **青・橙・待機** ボタンでも移動
- ✕ で個別削除、**全クリア** で全員削除

---

## 開発者向け：exe のビルド

Mac/Windows いずれの開発環境でも、Windows 向けの単一 exe を生成できます。

```bash
npm run build:win   # → dist/rl-viewer-queue.exe（+ .env.template, 手順txt）
npm run build:mac   # → dist/rl-viewer-queue-mac（macOS arm64・動作確認用）
```

仕組み：`esbuild` で全依存を 1 つの CommonJS（`build/app.cjs`）にバンドル →
`@yao-pkg/pkg` で Node ランタイム同梱の実行ファイル化。`public/` は pkg の assets として同梱。

> ⚠ ビルド時に出る次の警告は**無害**です：
> - `Cannot resolve 'mod'`（依存内の動的requireの静的解析警告。実行パスには影響なし）
> - `punycode is deprecated`（Node標準の非推奨警告）

ビルドには初回のみ、対象Nodeのプリビルドバイナリ取得のためネット接続が必要です
（pkg のキャッシュタグ v3.6 に合わせ **node22** を対象にしています）。

---

## クォータについて

YouTube Data API は 1 日 10,000 ユニットが上限。本ツールは API 推奨ポーリング間隔
（`pollingIntervalMillis`）を尊重し、登録者数・視聴者数の取得も `STATS_INTERVAL_MS`（既定30秒）で
抑えています。長時間配信で不足する場合は Google Cloud でクォータ増加を申請するか各間隔を伸ばしてください。

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| 「アクティブなライブ配信が見つかりません」 | 配信を開始してから管理画面の「再接続」。チャットが有効か確認 |
| 登録者数が「—」のまま | チャンネル設定で登録者数を非公開にしていないか確認 |
| 認可をやり直したい | `data/tokens.json` を削除して再起動 |
| OBSで何も出ない | URL・ポートが一致しているか、exe/コンソールが起動中か確認 |

## 設定（.env）

| キー | 説明 |
|------|------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth クライアント情報 |
| `CLIENT_SECRET_FILE` | client_secret.json を使う場合のパス（ID/SECRETより優先） |
| `PORT` | サーバーポート（既定 3000。変えたら Cloud のリダイレクトURIも合わせる） |
| `JOIN_KEYWORDS` | 参加希望と判定するキーワード（カンマ区切り・部分一致） |
| `TEAM_SIZE` | 試合形式の初期値（1〜4＝1vs1〜4vs4） |
| `MIN_POLL_INTERVAL_MS` / `STATS_INTERVAL_MS` | チャット／統計の取得間隔 |

## ファイル構成

```
src/
  server.js   サーバー + WebSocket
  paths.js    実行/exe環境の保存先・アセット解決
  auth.js     OAuth 認証（ブラウザ起動は外部依存なし）
  youtube.js  チャット/登録者/視聴者の取得（@googleapis/youtube）
  queue.js    参加者キュー＋チーム分け
  settings.js オーバーレイ見た目設定の管理・永続化
public/
  overlay.html   OBS表示用（青 vs オレンジ ＋ 待機列）
  admin.html     操作用（3カラム＋ドラッグ移動）
  settings.html  オーバーレイ設定（GUI＋ライブプレビュー）
scripts/        ビルド補助（クライアント同梱・配布パック）
```
