// soul/stat-system.ts — SoulStatSystem：只参与**开战前面板生成**
// 与 SoulEffectSystem（战斗触发）严格分离。
import { GameMath } from "../kernel/gamemath.ts";
import { makeExact } from "../kernel/stats.ts";
import type { ExactStats, StatKey } from "../kernel/stats.ts";
import { setStatBonus } from "./loadout.ts";
import type { SoulLoadout, SoulDef } from "./loadout.ts";

export interface DeriveResult {
  exact: ExactStats;
  /** 面板各属性的来源分解，便于 Golden Test 定位差异 */
  breakdown: Array<{ key: StatKey; base: number; fromSets: number; fromPiecesRate: number; fromPiecesFlat: number; result: number }>;
  activeSets: Array<{ soulId: number; name: string; pieces: number; kind: "2SET" | "4SET" }>;
}

/**
 * base + 御魂 -> ExactStats。**全程不取整**。
 *   atk/hp/def = base * (1 + Σrate) + Σflat
 *   spd        = base + Σflat （速度不吃百分比）
 *   cri/crid/efh/efr = base + Σrate
 */
export function deriveExactStats(base: ExactStats, loadout: SoulLoadout | null, book: Map<number, SoulDef>): DeriveResult {
  const rate: Partial<Record<StatKey, number>> = {};
  const flat: Partial<Record<StatKey, number>> = {};
  let activeSets: DeriveResult["activeSets"] = [];
  if (loadout && loadout.pieces.length) {
    const s = setStatBonus(loadout, book);
    Object.assign(rate, s.rate); Object.assign(flat, s.flat);
    activeSets = s.active;
  }
  // 每件御魂的主属性 / 副属性
  const pieceRate: Partial<Record<StatKey, number>> = {};
  const pieceFlat: Partial<Record<StatKey, number>> = {};
  for (const p of loadout?.pieces ?? []) {
    for (const roll of [p.mainStat, ...p.subStats]) {
      if (!roll) continue;
      // 约定：RATE 型属性（百分比）用 roll.type 落在 PERCENT 集合判断；此处按类型表判断
      const isRate = RATE_TYPES.has(roll.type);
      if (isRate) pieceRate[roll.type] = (pieceRate[roll.type] ?? 0) + roll.exactValue;
      else pieceFlat[roll.type] = (pieceFlat[roll.type] ?? 0) + roll.exactValue;
    }
  }

  const mul = (k: StatKey) => base[k] * (1 + (rate[k] ?? 0) + (pieceRate[k] ?? 0)) + (flat[k] ?? 0) + (pieceFlat[k] ?? 0);
  const add = (k: StatKey) => base[k] + (flat[k] ?? 0) + (pieceFlat[k] ?? 0);
  const plusRate = (k: StatKey) => base[k] + (rate[k] ?? 0) + (pieceRate[k] ?? 0);

  const exact = makeExact({
    atk: mul("atk"), hp: mul("hp"), def: mul("def"),
    spd: add("spd"),
    cri: plusRate("cri"), crid: plusRate("crid"), efh: plusRate("efh"), efr: plusRate("efr"),
  });

  const breakdown = (["atk", "hp", "def", "spd", "cri", "crid", "efh", "efr"] as StatKey[]).map(k => ({
    key: k, base: base[k],
    fromSets: (rate[k] ?? 0), fromPiecesRate: (pieceRate[k] ?? 0),
    fromPiecesFlat: (flat[k] ?? 0) + (pieceFlat[k] ?? 0),
    result: exact[k],
  }));

  return { exact, breakdown, activeSets };
}

const RATE_TYPES = new Set<StatKey>(["atk", "hp", "def", "cri", "crid", "efh", "efr"]);
