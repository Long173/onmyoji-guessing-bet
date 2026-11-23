// soul/loadout.ts — 御魂六件套数据结构 + 2/4 件套统计
import type { Scalar } from "../kernel/gamemath.ts";
// StatKey 定义在 kernel/stats.ts（gamemath 只有 Scalar），原先从这里导入是错的
import type { StatKey, ExactStats } from "../kernel/stats.ts";

export type SoulSlot = 1 | 2 | 3 | 4 | 5 | 6;

export interface SoulStatRoll { type: StatKey; exactValue: Scalar }

export interface SoulPiece {
  soulId: number;
  slot: SoulSlot;
  /** 主属性（1/3/5 固定，2/4/6 可选；值随强化等级） */
  mainStat: SoulStatRoll;
  /** 副属性，最多 4 条 */
  subStats: SoulStatRoll[];
  /** 强化等级，对弈竞猜通常为 15 */
  level: number;
}

export interface SoulLoadout { pieces: SoulPiece[] }

export interface SoulDef { id: number; name: string; suit: string; desc: string; type: number }

/** 解析 2件套文案 -> 属性加成，例如 "攻击加成15%" -> {atk: 0.15}、"暴击15%" -> {cri: 0.15} */
const SUIT_PATTERN: Array<[RegExp, StatKey, "RATE" | "FLAT"]> = [
  [/攻击加成\s*(\d+(?:\.\d+)?)%/, "atk", "RATE"],
  [/生命加成\s*(\d+(?:\.\d+)?)%/, "hp", "RATE"],
  [/防御加成\s*(\d+(?:\.\d+)?)%/, "def", "RATE"],
  [/暴击伤害\s*(\d+(?:\.\d+)?)%/, "crid", "RATE"],
  [/暴击\s*(\d+(?:\.\d+)?)%/, "cri", "RATE"],
  [/效果命中\s*(\d+(?:\.\d+)?)%/, "efh", "RATE"],
  [/效果抵抗\s*(\d+(?:\.\d+)?)%/, "efr", "RATE"],
  [/速度\s*\+?\s*(\d+(?:\.\d+)?)/, "spd", "FLAT"],
];

export function parseSuitBonus(suitText: string): { rate: Partial<Record<StatKey, Scalar>>; flat: Partial<Record<StatKey, Scalar>>; parsed: boolean } {
  const rate: any = {}, flat: any = {};
  if (!suitText) return { rate, flat, parsed: false };
  let parsed = false;
  for (const [re, key, kind] of SUIT_PATTERN) {
    const m = suitText.match(re);
    if (!m) continue;
    parsed = true;
    const v = parseFloat(m[1]);
    if (kind === "RATE") rate[key] = (rate[key] ?? 0) + v / 100;
    else flat[key] = (flat[key] ?? 0) + v;
  }
  return { rate, flat, parsed };
}

/** 统计每个御魂种类的件数 */
export function countSets(loadout: SoulLoadout, book: Map<number, SoulDef>): Map<number, number> {
  const c = new Map<number, number>();
  for (const p of loadout.pieces) c.set(p.soulId, (c.get(p.soulId) ?? 0) + 1);
  return c;
}

/**
 * 套装加成。规则（社区通说 + 本轮实证的 2 件套部分）：
 *   2 件 -> suit 文案；4 件 -> 战斗触发（属于 SoulEffectSystem，不进面板）
 * 因此本函数只产出**面板加成**。
 */
export function setStatBonus(loadout: SoulLoadout, book: Map<number, SoulDef>) {
  const rate: any = {}, flat: any = {};
  const active: Array<{ soulId: number; name: string; pieces: number; kind: "2SET" | "4SET" }> = [];
  for (const [soulId, n] of countSets(loadout, book)) {
    const def = book.get(soulId);
    if (!def) continue;
    if (n >= 2) {
      const b = parseSuitBonus(def.suit);
      const rateIdx = rate as Record<string, number>, flatIdx = flat as Record<string, number>;
      for (const k of Object.keys(b.rate)) rateIdx[k] = (rateIdx[k] ?? 0) + (b.rate as Record<string, number>)[k];
      for (const k of Object.keys(b.flat)) flatIdx[k] = (flatIdx[k] ?? 0) + (b.flat as Record<string, number>)[k];
      active.push({ soulId, name: def.name, pieces: n, kind: "2SET" });
    }
    if (n >= 4) active.push({ soulId, name: def.name, pieces: n, kind: "4SET" });
  }
  return { rate, flat, active };
}
