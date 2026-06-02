// 実行環境（通常の node 実行 / pkg でexe化した実行）に応じて
// 「書き込み可能なデータ保存先」と「同梱アセットの場所」を解決するモジュール。
//
// exe化すると __dirname は読み取り専用のスナップショット（/snapshot/...）になるため、
// トークンやキューの保存先はexeの隣のフォルダに置く必要がある。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// このモジュールの場所。
//  - CJSバンドル(esbuild→pkg)時 : 出力ファイル(app.cjs)のある build/ を指す __dirname が使える
//  - ESM(通常の node 実行)時      : import.meta.url から導出（__dirname は未定義）
// ※ esbuild は cjs 出力で import.meta を空にする警告を出すが、下記分岐により未到達なので無害。
const moduleDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

// pkg でパッケージ化されているか。
export const isPackaged = !!process.pkg;

// 書き込み可能な基準ディレクトリ。
//  - exe実行時 : exe があるフォルダ（ユーザーがここに .env を置く）
//  - 通常実行時 : プロジェクトルート（dev: src/.. 、bundle: build/.. のどちらもルート）
export const baseDir = isPackaged
  ? path.dirname(process.execPath)
  : path.resolve(moduleDir, "..");

// 同梱HTML等のアセットの場所。src/.. または build/.. の public を指す。
export const publicDir = path.resolve(moduleDir, "..", "public");

// データ保存先（書き込み可能）。
export const dataDir = path.join(baseDir, "data");
fs.mkdirSync(dataDir, { recursive: true });

// .env を baseDir から読み込む（exeの隣の .env を確実に読むため）。
dotenv.config({ path: path.join(baseDir, ".env") });
// 念のため cwd の .env も（dev時の利便性）。
dotenv.config();
