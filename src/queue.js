// 参加希望者キュー＋チーム分けの状態管理。
// 各参加者は team ("queue" | "blue" | "orange") を持つ。
// teamSize(1〜4) で各チームの定員(NvN)を決める。
// data/queue.json に永続化し、再起動後も復元できる。
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { dataDir } from "./paths.js";

const QUEUE_PATH = path.join(dataDir, "queue.json");
const TEAMS = ["blue", "orange"];

export class ParticipantQueue extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.entries = []; // { id, name, channelId, photo, joinedAt, team }
    this.teamSize = clampSize(opts.teamSize ?? 3); // 既定 3vs3
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(QUEUE_PATH)) {
        const data = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
        if (Array.isArray(data.entries)) {
          this.entries = data.entries.map((e) => ({
            team: "queue",
            ...e,
          }));
        }
        if (data.teamSize) this.teamSize = clampSize(data.teamSize);
      }
    } catch {
      this.entries = [];
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(QUEUE_PATH), { recursive: true });
      fs.writeFileSync(
        QUEUE_PATH,
        JSON.stringify({ teamSize: this.teamSize, entries: this.entries }, null, 2),
        "utf8"
      );
    } catch (e) {
      console.error("キューの保存に失敗:", e.message);
    }
  }

  _changed() {
    this._save();
    this.emit("change", this.snapshot());
  }

  // クライアントへ渡す状態。
  snapshot() {
    return {
      teamSize: this.teamSize,
      queue: this.entries.filter((e) => e.team === "queue"),
      blue: this.entries.filter((e) => e.team === "blue"),
      orange: this.entries.filter((e) => e.team === "orange"),
    };
  }

  _countTeam(team) {
    return this.entries.filter((e) => e.team === team).length;
  }

  // 参加希望者を待機列に追加。既に居る(同一channelId)場合は何もしない。
  add({ name, channelId, photo }) {
    if (channelId) {
      if (this.entries.some((e) => e.channelId && e.channelId === channelId)) return null;
    } else {
      if (this.entries.some((e) => !e.channelId && e.name === name)) return null;
    }
    const entry = {
      id: randomUUID(),
      name,
      channelId: channelId || "",
      photo: photo || "",
      joinedAt: Date.now(),
      team: "queue",
    };
    this.entries.push(entry);
    this._changed();
    return entry;
  }

  addManual(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    return this.add({ name: trimmed, channelId: "", photo: "" });
  }

  remove(id) {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length !== before) this._changed();
  }

  clear() {
    this.entries = [];
    this._changed();
  }

  // 試合形式(1〜4)を変更。定員オーバー分は待機列へ戻す。
  setTeamSize(n) {
    this.teamSize = clampSize(n);
    for (const team of TEAMS) {
      const members = this.entries.filter((e) => e.team === team);
      members.slice(this.teamSize).forEach((e) => (e.team = "queue"));
    }
    this._changed();
  }

  // 待機列の先頭から青→オレンジの順に定員まで自動で振り分ける。
  autoAssign() {
    for (const team of TEAMS) {
      let need = this.teamSize - this._countTeam(team);
      while (need > 0) {
        const next = this.entries.find((e) => e.team === "queue");
        if (!next) return this._changed();
        next.team = team;
        need--;
      }
    }
    this._changed();
  }

  // 青チームとオレンジチームを丸ごと入れ替え（サイド交代）。
  swapTeams() {
    for (const e of this.entries) {
      if (e.team === "blue") e.team = "orange";
      else if (e.team === "orange") e.team = "blue";
    }
    this._changed();
  }

  // 両チームのメンバーを待機列へ戻す。
  clearTeams() {
    for (const e of this.entries) {
      if (e.team !== "queue") e.team = "queue";
    }
    this._changed();
  }

  // 管理画面のドラッグ＆ドロップ結果を一括反映する。
  // groups = { queue:[id...], blue:[id...], orange:[id...] }
  // 定員を超えた分は待機列に回す。指定漏れは待機列の末尾へ。
  arrange(groups = {}) {
    const map = new Map(this.entries.map((e) => [e.id, e]));
    const ordered = [];
    const place = (ids, team, limit) => {
      let placed = 0;
      for (const id of ids || []) {
        const e = map.get(id);
        if (!e) continue;
        map.delete(id);
        if (limit != null && placed >= limit) {
          e.team = "queue";
        } else {
          e.team = team;
          placed++;
        }
        ordered.push(e);
      }
    };
    place(groups.blue, "blue", this.teamSize);
    place(groups.orange, "orange", this.teamSize);
    place(groups.queue, "queue", null);
    // 指定漏れ（新規追加直後など）は待機列末尾へ。
    for (const e of map.values()) {
      e.team = "queue";
      ordered.push(e);
    }
    this.entries = ordered;
    this._changed();
  }
}

function clampSize(n) {
  const v = Math.floor(Number(n) || 0);
  return Math.min(4, Math.max(1, v));
}
