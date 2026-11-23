// stores/match.ts — 只持有可序列化 DTO（契约要求：store 不持有 Engine 对象）
import { defineStore } from "pinia";
import { emptyMatch, swapSides, newUnitId } from "../contracts/guessing-match.ts";
import type { GuessingMatch, GuessingUnitInput, StatKey } from "../contracts/guessing-match.ts";

const DRAFT_KEY = "yys.workbench.match.draft.v1";

/** UX 护栏 #10：输入自动保存到本地草稿，防止填 10 只后刷新丢失 */
function loadDraft(): GuessingMatch | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as GuessingMatch;
    if (m?.schemaVersion !== 1 || !m.red || !m.blue) return null;
    return m;
  } catch { return null; }
}

export const useMatchStore = defineStore("match", {
  state: () => ({
    match: (loadDraft() ?? emptyMatch()) as GuessingMatch,
    savedAt: null as string | null,
    dirty: false,
  }),
  getters: {
    filledCount(s): number { return [...s.match.red.units, ...s.match.blue.units].filter(u => u.shikigamiId > 0).length; },
  },
  actions: {
    touch() { this.match.updatedAt = new Date().toISOString(); this.dirty = true; this.persist(); },
    persist() {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(this.match)); this.savedAt = new Date().toISOString(); this.dirty = false; }
      catch { /* 配额满时静默：草稿不应阻塞操作 */ }
    },
    unit(side: "red" | "blue", index: number): GuessingUnitInput { return this.match[side].units[index]; },
    setShikigami(side: "red" | "blue", index: number, id: number, name: string) {
      const u = this.match[side].units[index]; u.shikigamiId = id; u.name = name; this.touch();
    },
    setStat(side: "red" | "blue", index: number, key: StatKey, value: number) {
      const u = this.match[side].units[index];
      u.stats[key] = Number.isFinite(value) ? value : 0;
      this.touch();
    },
    setSoul(side: "red" | "blue", index: number, soulId: number | null) {
      this.match[side].units[index].soulId = soulId; this.touch();
    },
    clearUnit(side: "red" | "blue", index: number) {
      this.match[side].units[index] = { ...this.match[side].units[index], unitId: newUnitId(), shikigamiId: 0, name: "", soulId: null };
      this.touch();
    },
    swap() { this.match = swapSides(this.match); this.touch(); },
    replace(m: GuessingMatch) { this.match = m; this.touch(); },
    reset() { this.match = emptyMatch(); this.touch(); },
    loadCanonical() { /* UI-1 接入 mock 数据 */ },
  },
});
