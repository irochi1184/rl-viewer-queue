// 配信画面シーン（フル画面レイアウト）の状態管理。
// 1シーン = キャンバス(1920x1080) + 背景 + ウィジェット配列。
// 複数シーンを保存し、アクティブな1つを stream.html が描画する。
// data/scenes.json に永続化し、変更をイベントで通知する（settings.js と同じ流儀）。
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { dataDir } from "./paths.js";

const SCENES_PATH = path.join(dataDir, "scenes.json");

export const CANVAS = { w: 1920, h: 1080 };

// 既定シーン：左にゲーム枠、右に統計・参加者・コメントを並べた「試合中」レイアウト。
function defaultScene() {
  return {
    id: "default",
    name: "メインシーン",
    canvas: { ...CANVAS },
    background: { type: "color", color: "#0b0e16", image: "", fit: "cover" },
    widgets: [
      {
        id: "w-game",
        type: "gameFrame",
        x: 40, y: 150, w: 1280, h: 720, z: 1,
        style: { radius: 12, borderWidth: 3, borderColor: "#1e6bff", shadow: true },
        config: { label: "", showLabel: false },
      },
      {
        id: "w-title",
        type: "text",
        x: 1360, y: 40, w: 520, h: 70, z: 2,
        style: { color: "#ffffff", fontSize: 40, fontWeight: 800, align: "left", bg: "transparent" },
        config: { text: "RL VIEWER" },
      },
      {
        id: "w-stats",
        type: "stats",
        x: 1360, y: 130, w: 520, h: 96, z: 2,
        style: { color: "#ffffff", accent: "#5cffc9", bgOpacity: 90, radius: 12 },
        config: { showSubs: true, showViewers: true },
      },
      {
        id: "w-teams",
        type: "participants",
        x: 1360, y: 246, w: 520, h: 540, z: 2,
        style: { color: "#ffffff", blue: "#1e6bff", orange: "#ff7a18", accent: "#5cffc9", bgOpacity: 90, radius: 12 },
        config: { show: "teams", showAvatars: true, showNumbers: true, showEmpty: false },
      },
      {
        id: "w-comments",
        type: "comments",
        x: 1360, y: 806, w: 520, h: 234, z: 2,
        style: { color: "#ffffff", accent: "#5cffc9", bgOpacity: 85, radius: 12, fontSize: 18 },
        config: { mode: "list", max: 8, speed: 12, showPhoto: true },
      },
    ],
  };
}

export const DEFAULT_DATA = {
  activeId: "default",
  scenes: [defaultScene()],
};

// カラーパレット（適用すると背景・各部品の色を一括変更）。
export const PALETTES = {
  rl:     { label: "RL クラシック", bg: "#0b0e16", text: "#ffffff", accent: "#5cffc9", blue: "#1e6bff", orange: "#ff7a18" },
  neon:   { label: "ネオン",        bg: "#0a0612", text: "#ffffff", accent: "#19e6ff", blue: "#7b5cff", orange: "#ff3ca6" },
  sunset: { label: "サンセット",    bg: "#170d1c", text: "#fff7ed", accent: "#ffb020", blue: "#3b82f6", orange: "#f97316" },
  mono:   { label: "モノクロ",      bg: "#0e0e10", text: "#ffffff", accent: "#c9ccd6", blue: "#5b6b9c", orange: "#9aa0ad" },
};

// 完成レイアウトのテンプレート（適用するとアクティブシーンを置き換え）。
export const TEMPLATES = {
  match: { label: "試合中", build: () => ({ background: { type: "color", color: "#0b0e16" }, widgets: defaultScene().widgets }) },
  recruit: {
    label: "参加募集",
    build: () => ({
      background: { type: "gradient", gradient: "linear-gradient(135deg,#10203a,#0b0e16)" },
      widgets: [
        { type: "text", x: 80, y: 56, w: 1100, h: 100, z: 2, style: { color: "#ffffff", fontSize: 64, fontWeight: 900, align: "left", bg: "transparent" }, config: { text: "参加者 募集中！" } },
        { type: "text", x: 80, y: 168, w: 1180, h: 60, z: 2, style: { color: "#5cffc9", fontSize: 32, fontWeight: 800, align: "left", bg: "transparent" }, config: { text: "コメントで「参加希望」と送ってね！" } },
        { type: "stats", x: 1360, y: 56, w: 480, h: 110, z: 2, style: { accent: "#5cffc9", bgOpacity: 90, radius: 14 }, config: { showSubs: true, showViewers: true } },
        { type: "participants", x: 80, y: 264, w: 820, h: 760, z: 2, style: { blue: "#1e6bff", orange: "#ff7a18", accent: "#5cffc9", bgOpacity: 90, radius: 14 }, config: { show: "queue", showAvatars: true, showNumbers: true, showEmpty: false } },
        { type: "comments", x: 940, y: 200, w: 900, h: 824, z: 2, style: { accent: "#5cffc9", bgOpacity: 85, radius: 14, fontSize: 22 }, config: { mode: "list", max: 16, speed: 12, showPhoto: true } },
      ],
    }),
  },
  starting: {
    label: "開始前 (Starting Soon)",
    build: () => ({
      background: { type: "gradient", gradient: "radial-gradient(120% 120% at 50% 0%,#16243f,#080a12)" },
      widgets: [
        { type: "text", x: 260, y: 360, w: 1400, h: 140, z: 2, style: { color: "#ffffff", fontSize: 96, fontWeight: 900, align: "center", bg: "transparent" }, config: { text: "まもなく開始します" } },
        { type: "text", x: 260, y: 520, w: 1400, h: 70, z: 2, style: { color: "#5cffc9", fontSize: 40, fontWeight: 800, align: "center", bg: "transparent" }, config: { text: "Starting Soon..." } },
        { type: "cameraFrame", x: 1456, y: 736, w: 400, h: 288, z: 3, style: { borderWidth: 3, borderColor: "#5cffc9", radius: 14, shadow: true }, config: { showLabel: true, label: "CAM" } },
        { type: "comments", x: 0, y: 992, w: 1920, h: 88, z: 2, style: { accent: "#5cffc9", bgOpacity: 70, radius: 0, fontSize: 28 }, config: { mode: "ticker", speed: 14, showPhoto: true } },
      ],
    }),
  },
};

export class SceneStore extends EventEmitter {
  constructor() {
    super();
    this.data = clone(DEFAULT_DATA);
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(SCENES_PATH)) {
        const saved = JSON.parse(fs.readFileSync(SCENES_PATH, "utf8"));
        if (saved && Array.isArray(saved.scenes) && saved.scenes.length) {
          this.data = saved;
          if (!this._scene(this.data.activeId)) this.data.activeId = this.data.scenes[0].id;
        }
      }
    } catch {
      this.data = clone(DEFAULT_DATA);
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(SCENES_PATH), { recursive: true });
      fs.writeFileSync(SCENES_PATH, JSON.stringify(this.data, null, 2), "utf8");
    } catch (e) {
      console.error("シーンの保存に失敗:", e.message);
    }
  }

  _changed() {
    this._save();
    this.emit("change", this.data);
  }

  get() {
    return this.data;
  }

  _scene(id) {
    return this.data.scenes.find((s) => s.id === id);
  }

  getActive() {
    return this._scene(this.data.activeId) || this.data.scenes[0];
  }

  activate(id) {
    if (this._scene(id)) {
      this.data.activeId = id;
      this._changed();
    }
  }

  // シーン単位のフィールド（name / canvas / background）を部分マージ。
  updateScene(id, patch) {
    const s = this._scene(id);
    if (!s || !patch) return;
    const { widgets, ...rest } = patch; // widgets はここでは扱わない
    mergeInto(s, rest);
    this._changed();
  }

  createScene(name) {
    const s = defaultScene();
    s.id = "s-" + randomUUID().slice(0, 8);
    s.name = name || "新しいシーン";
    this.data.scenes.push(s);
    this.data.activeId = s.id;
    this._changed();
    return s.id;
  }

  duplicateScene(id) {
    const src = this._scene(id);
    if (!src) return null;
    const copy = clone(src);
    copy.id = "s-" + randomUUID().slice(0, 8);
    copy.name = src.name + " のコピー";
    this.data.scenes.push(copy);
    this.data.activeId = copy.id;
    this._changed();
    return copy.id;
  }

  renameScene(id, name) {
    const s = this._scene(id);
    if (!s) return;
    s.name = String(name || "").trim() || s.name;
    this._changed();
  }

  deleteScene(id) {
    if (this.data.scenes.length <= 1) return; // 最低1つは残す
    this.data.scenes = this.data.scenes.filter((s) => s.id !== id);
    if (this.data.activeId === id) this.data.activeId = this.data.scenes[0].id;
    this._changed();
  }

  // ウィジェットの追加・更新（id があれば更新、無ければ採番して追加）。
  upsertWidget(sceneId, widget) {
    const s = this._scene(sceneId) || this.getActive();
    if (!s || !widget) return null;
    if (!widget.id) {
      widget.id = "w-" + randomUUID().slice(0, 8);
      widget.z = widget.z ?? (Math.max(0, ...s.widgets.map((w) => w.z || 0)) + 1);
      s.widgets.push(widget);
    } else {
      const i = s.widgets.findIndex((w) => w.id === widget.id);
      if (i >= 0) mergeInto(s.widgets[i], widget);
      else s.widgets.push(widget);
    }
    this._changed();
    return widget.id;
  }

  removeWidget(sceneId, widgetId) {
    const s = this._scene(sceneId) || this.getActive();
    if (!s) return;
    const before = s.widgets.length;
    s.widgets = s.widgets.filter((w) => w.id !== widgetId);
    if (s.widgets.length !== before) this._changed();
  }

  // 重なり順（z）を ids の並び順に振り直す。
  reorderWidgets(sceneId, ids) {
    const s = this._scene(sceneId) || this.getActive();
    if (!s || !Array.isArray(ids)) return;
    ids.forEach((id, i) => {
      const w = s.widgets.find((x) => x.id === id);
      if (w) w.z = i + 1;
    });
    this._changed();
  }

  // テンプレートをアクティブシーンに適用（背景・部品を置き換え。名前/IDは維持）。
  applyTemplate(name) {
    const t = TEMPLATES[name];
    if (!t) return;
    const built = t.build();
    const s = this.getActive();
    if (!s) return;
    s.background = clone(built.background);
    s.widgets = built.widgets.map((w, i) => ({ ...clone(w), id: "w-" + randomUUID().slice(0, 8), z: w.z ?? i + 1 }));
    this._changed();
  }

  // テンプレートから新しいシーンを作成して切り替え。
  createFromTemplate(name) {
    const t = TEMPLATES[name];
    if (!t) return null;
    const built = t.build();
    const s = {
      id: "s-" + randomUUID().slice(0, 8),
      name: t.label,
      canvas: { ...CANVAS },
      background: clone(built.background),
      widgets: built.widgets.map((w, i) => ({ ...clone(w), id: "w-" + randomUUID().slice(0, 8), z: w.z ?? i + 1 })),
    };
    this.data.scenes.push(s);
    this.data.activeId = s.id;
    this._changed();
    return s.id;
  }

  // カラーパレットをアクティブシーンに適用（背景色＋各部品の色を一括変更）。
  applyPalette(name) {
    const p = PALETTES[name];
    if (!p) return;
    const s = this.getActive();
    if (!s) return;
    if (!s.background) s.background = {};
    if (s.background.type !== "image") { s.background.type = "color"; s.background.color = p.bg; }
    for (const w of s.widgets) {
      const st = w.style || (w.style = {});
      if (w.type === "text") st.color = p.text;
      else if (w.type === "stats") st.accent = p.accent;
      else if (w.type === "participants") { st.blue = p.blue; st.orange = p.orange; st.accent = p.accent; }
      else if (w.type === "comments") st.accent = p.accent;
      else if (w.type === "gameFrame" || w.type === "cameraFrame") st.borderColor = p.accent;
    }
    this._changed();
  }

  reset() {
    this.data = clone(DEFAULT_DATA);
    this._changed();
  }
}

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

// プレーンオブジェクトは再帰マージ、配列・プリミティブは置換（settings.js と同じ方針）。
function mergeInto(target, patch) {
  for (const k of Object.keys(patch || {})) {
    const pv = patch[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
      mergeInto(target[k], pv);
    } else {
      target[k] = pv;
    }
  }
  return target;
}
