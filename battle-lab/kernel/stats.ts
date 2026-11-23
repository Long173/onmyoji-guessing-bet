// kernel/stats.ts — 三层数值：ExactStats（参与计算）/ DisplayStats（界面口径）/ ObservedStats（截图观测）
import { GameMath } from "./gamemath.ts";
import type { Scalar } from "./gamemath.ts";

export const STAT_KEYS = ["atk", "hp", "def", "spd", "cri", "crid", "efh", "efr"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** 百分比类属性（内部存比例，展示乘 100） */
export const PERCENT_STATS: StatKey[] = ["cri", "crid", "efh", "efr"];

/**
 * 精确面板。**所有战斗计算只读这里**。
 * atk/hp/def/spd 为绝对数值；cri/crid/efh/efr 为比例（0.15 = 15%）。
 */
export interface ExactStats {
  atk: Scalar; hp: Scalar; def: Scalar; spd: Scalar;
  cri: Scalar; crid: Scalar; efh: Scalar; efr: Scalar;
}

/** 界面显示口径：整数；百分比类以百分数表示（15 表示 15%） */
export interface DisplayStats {
  atk: Scalar; hp: Scalar; def: Scalar; spd: Scalar;
  cri: Scalar; crid: Scalar; efh: Scalar; efr: Scalar;
}

export type ObservedSource = "SCREENSHOT" | "KB" | "DERIVED";

/**
 * 观测值。截图只给整数，因此**不能假装精确**：
 *   - displayed: 界面看到的整数（权威）
 *   - exact:     若已由 base+御魂推导出来则填（权威）
 *   - feasibleRange: 未推导时，能显示为该整数的精确值区间
 */
export interface ObservedStat {
  displayed: Scalar;
  exact?: Scalar;
  feasibleRange?: [Scalar, Scalar];
  source: ObservedSource;
}

export type ObservedStats = Record<StatKey, ObservedStat>;

export function makeExact(p: Partial<ExactStats>): ExactStats {
  return { atk: 0, hp: 0, def: 0, spd: 0, cri: 0, crid: 1.5, efh: 0, efr: 0, ...p };
}

/** Exact -> Display。**唯一的展示取整点** */
export function toDisplay(e: ExactStats): DisplayStats {
  const out: any = {};
  for (const k of STAT_KEYS) out[k] = PERCENT_STATS.includes(k) ? GameMath.displayPercent(e[k]) : GameMath.display(e[k]);
  return out as DisplayStats;
}

/** 截图整数 -> 观测值（保留可行区间，不假装精确） */
export function observe(displayed: Partial<DisplayStats>, source: ObservedSource = "SCREENSHOT"): ObservedStats {
  const out: any = {};
  for (const k of STAT_KEYS) {
    const d = displayed[k] ?? (PERCENT_STATS.includes(k) ? 0 : 0);
    const exactDisp = d;
    out[k] = { displayed: d, feasibleRange: GameMath.feasibleRange(exactDisp), source };
  }
  return out as ObservedStats;
}

/** 用推导出的精确值回填观测值，并校验它确实会显示为同一个整数 */
export function bindExact(obs: ObservedStats, exact: ExactStats): { ok: boolean; mismatches: string[] } {
  const disp = toDisplay(exact);
  const mismatches: string[] = [];
  for (const k of STAT_KEYS) {
    obs[k].exact = exact[k];
    obs[k].source = "DERIVED";
    if (Math.abs(disp[k] - obs[k].displayed) > 1e-9) {
      mismatches.push(`${k}: 推导显示 ${disp[k]} ≠ 截图 ${obs[k].displayed}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

export function exactFromObserved(obs: ObservedStats): ExactStats {
  const out: any = {};
  for (const k of STAT_KEYS) out[k] = obs[k].exact ?? (obs[k].feasibleRange ? (obs[k].feasibleRange![0] + obs[k].feasibleRange![1]) / 2 : obs[k].displayed);
  return out as ExactStats;
}
