// soul/stat-source.ts — 面板来源与**模式语义**
// 核心分层（用户冻结）：
//   对弈竞猜 = AUTHORITATIVE_OVERRIDE（最终八维即真值，御魂静态属性**绝不**再叠加）
//   PlayerBuild = BASE + EQUIPMENT（六件御魂参与生成）
import type { ExactStats } from "../kernel/stats.ts";

export const StatSource = {
  BASE: "BASE",                                   // 六星觉醒式神基础面板
  EQUIPMENT: "EQUIPMENT",                         // 六件御魂 + 套装静态属性
  AUTHORITATIVE_OVERRIDE: "AUTHORITATIVE_OVERRIDE", // 对弈竞猜直接给定最终面板
} as const;
export type StatSource = (typeof StatSource)[keyof typeof StatSource];

export const EntityMode = {
  GUESSING: "GUESSING",         // 对弈竞猜：吃最终八维
  PLAYER_BUILD: "PLAYER_BUILD", // 完整养成：base + 六件御魂
} as const;
export type EntityMode = (typeof EntityMode)[keyof typeof EntityMode];

export type BuildLegality = "ACCEPT" | "IMPOSSIBLE_BUILD";

/**
 * 模式语义决定合法性。
 * 竞猜可能给出玩家养成体系里**根本无法合成**的面板（服务器直接生成），那不是错误；
 * 但同样的数据在 PlayerBuild 模式下就是 IMPOSSIBLE_BUILD。
 */
export function judgeLegality(mode: EntityMode, opts: { explainableByEquipment: boolean | null }): BuildLegality {
  if (mode === EntityMode.GUESSING) return "ACCEPT";
  if (opts.explainableByEquipment === false) return "IMPOSSIBLE_BUILD";
  return "ACCEPT";
}

export interface StatResolution {
  mode: EntityMode;
  source: StatSource;
  exact: ExactStats;
  /** ★ 竞猜模式必须为 false —— 否则御魂静态属性被重复计算 */
  soulStaticApplied: boolean;
  /** 御魂的战斗效果（4件套触发等）仍然加载 */
  soulBattleEffects: SoulEffectRef[];
  legality: BuildLegality;
  notes: string[];
}

export interface SoulEffectRef {
  soulId: number; name: string; pieces: number;
  /** 4件套的战斗触发文案（自然语言，进 SoulEffectSystem） */
  desc: string;
}

/** 不变量：竞猜模式下不得应用御魂静态属性 */
export function assertNoStaticDoubleCount(r: StatResolution): void {
  if (r.mode === EntityMode.GUESSING && r.soulStaticApplied) {
    throw new Error(
      "不变量违反：竞猜模式不得叠加御魂静态属性（面板已是装备结算后的最终值）。" +
      "否则会出现 暴伤164% + 无刀取2件套20% = 184% 这类重复计算。"
    );
  }
}
