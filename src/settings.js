// オーバーレイの見た目設定（配置・サイズ・色・表示項目・ラベル）の管理。
// data/overlay-settings.json に保存し、変更をイベントで通知する。
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { dataDir } from "./paths.js";

const SETTINGS_PATH = path.join(dataDir, "overlay-settings.json");

// 既定の見た目設定。
export const DEFAULT_SETTINGS = {
  position: "top-left", // top-left | top-right | bottom-left | bottom-right
  offsetX: 24,
  offsetY: 24,
  width: 223, // px
  scale: 142, // %
  radius: 12, // px
  bgOpacity: 97, // パネル背景の不透明度 %
  textColor: "#ffffff",
  blueColor: "#1e6bff",
  orangeColor: "#ff7a18",
  accentColor: "#5cffc9", // 統計バー・待機列ヘッダー
  labels: {
    blue: "ブルーチーム",
    orange: "オレンジチーム",
    waiting: "参加希望",
  },
  show: {
    subs: true,
    viewers: true,
    blueTeam: true,
    orangeTeam: true,
    waiting: true,
    vs: true,
    avatars: true,
    numbers: true,
    emptySlots: false,
  },
  // コメント表示
  comments: {
    show: true,
    mode: "ticker", // "list"（縦一覧）| "ticker"（横に流れる）
    max: 8, // 縦一覧での表示件数
    speed: 12, // 横流れ1コメントが流れ切る秒数
    fontSize: 16, // コメント文字サイズ(px)。単独ウィンドウはここを大きくして高画質に
    showPhoto: true, // アイコン表示
  },
};

export class OverlaySettings extends EventEmitter {
  constructor() {
    super();
    this.data = clone(DEFAULT_SETTINGS);
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(SETTINGS_PATH)) {
        const saved = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
        this.data = mergeDeep(clone(DEFAULT_SETTINGS), saved);
      }
    } catch {
      this.data = clone(DEFAULT_SETTINGS);
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(this.data, null, 2), "utf8");
    } catch (e) {
      console.error("設定の保存に失敗:", e.message);
    }
  }

  get() {
    return this.data;
  }

  // 部分更新（ネストもマージ）。
  update(patch) {
    if (!patch || typeof patch !== "object") return;
    this.data = mergeDeep(this.data, patch);
    this._save();
    this.emit("change", this.data);
  }

  reset() {
    this.data = clone(DEFAULT_SETTINGS);
    this._save();
    this.emit("change", this.data);
  }
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// プレーンオブジェクトのみ再帰マージ（配列・プリミティブは置換）。
function mergeDeep(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(patch || {})) {
    const pv = patch[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv) && out[k] && typeof out[k] === "object") {
      out[k] = mergeDeep(out[k], pv);
    } else {
      out[k] = pv;
    }
  }
  return out;
}
