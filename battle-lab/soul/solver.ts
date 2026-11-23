// soul/solver.ts — M1.5B：面板 -> 御魂组合 是 **many-to-one，不可逆**。
// 因此**不提供** inferSoulPieces()（会制造虚假确定性）。
// 只提供 solveCompatibleSoulBuilds()，显式返回 0 / 1 / N / UNDERDETERMINED。
import { setStatBonus } from "./loadout.ts";
import { parseSuitBonus } from "./loadout.ts";
import type { SoulDef, SoulLoadout } from "./loadout.ts";
import { STAT_KEYS } from "../kernel/stats.ts";
import type { ExactStats, StatKey } from "../kernel/stats.ts";

export type SolveOutcome =
  | { kind: "NO_SOLUTION"; reason: string; detail: string[] }
  | { kind: "UNIQUE"; build: unknown }
  | { kind: "MULTIPLE"; count: number; sample: unknown[] }
  | { kind: "UNDERDETERMINED"; freeVariables: number; note: string; residual: Partial<Record<StatKey, number>> };

/** 面板各属性对基础面板的"必须由装备提供的增量" */
export function residualOverBase(target: ExactStats, base: ExactStats): Partial<Record<StatKey, number>> {
  const out: any = {};
  for (const k of STAT_KEYS) out[k] = target[k] - base[k];
  return out;
}

/**
 * 已知信息只有「2件套文案」（数据源可靠）。
 * 主属性/副属性的**数值表未知**，因此：
 *   - 若某属性的 2件套贡献已经**超过**目标增量 -> NO_SOLUTION（可判定）
 *   - 否则 -> UNDERDETERMINED，并给出"必须由主+副属性补足的余量"
 * 绝不返回"MULTIPLE 中的第一个"。
 */
export function solveCompatibleSoulBuilds(
  target: ExactStats, base: ExactStats, loadout: SoulLoadout | null, book: Map<number, SoulDef>,
): SolveOutcome {
  const residual = residualOverBase(target, base);
  const detail: string[] = [];

  if (!loadout || !loadout.pieces.length) {
    return { kind: "UNDERDETERMINED", freeVariables: 6 * 5, note: "未给定御魂搭配，解空间为全部可能组合", residual };
  }

  const s = setStatBonus(loadout, book);
  // 逐属性判定：套装贡献是否已经超过目标增量
  for (const k of STAT_KEYS) {
    const setRate = (s.rate as any)[k] ?? 0;
    const setFlat = (s.flat as any)[k] ?? 0;
    const isMul = k === "atk" || k === "hp" || k === "def";
    const setContribution = isMul ? base[k] * setRate + setFlat : setRate + setFlat;
    const need = residual[k] ?? 0;
    if (setContribution > need + 1e-6) {
      detail.push(`${k}: 套装已提供 ${setContribution.toFixed(2)}，但目标仅比基础高 ${need.toFixed(2)} —— 超出`);
    }
  }
  if (detail.length) {
    return { kind: "NO_SOLUTION", reason: "套装静态贡献超过目标面板增量（该组合不可能）", detail };
  }

  // 剩余必须由主属性 + 副属性提供；一个方程多个未知量 -> 欠定
  const residualAfterSets: any = {};
  for (const k of STAT_KEYS) {
    const setRate = (s.rate as any)[k] ?? 0;
    const setFlat = (s.flat as any)[k] ?? 0;
    const isMul = k === "atk" || k === "hp" || k === "def";
    const setContribution = isMul ? base[k] * setRate + setFlat : setRate + setFlat;
    residualAfterSets[k] = (residual[k] ?? 0) - setContribution;
  }
  return {
    kind: "UNDERDETERMINED",
    freeVariables: 6 * 5,   // 6 件 × (1 主 + ≤4 副)
    note: "主属性/副属性数值表未获得，无法给出唯一解。残差为『必须由主+副属性补足的余量』",
    residual: residualAfterSets,
  };
}

/** 主属性规则：1/3/5 固定，2/4/6 随机（官方概率公示） */
export const MainStatRules = {
  fixed: { 1: "atk", 3: "def", 5: "hp" } as Record<number, StatKey>,
  /** 2/4/6 的**允许集合**：数值表未获得，此处只登记"存在随机类别"这一事实 */
  randomSlots: [2, 4, 6] as const,
  allowedKnown: false,
  note: "官方公示：一、三、五号位固定；二、四、六号位存在随机属性选择。具体允许集合与各档精确值待从结构化数据获取",
} as const;

/** 强化规则（官方公示）：+3/+6/+9/+12/+15 各触发一次副属性事件 */
export const EnhanceRules = {
  breakpoints: [3, 6, 9, 12, 15] as const,
  maxSubStats: 4,
  onEvent(existingSubCount: number): "ADD_SUB" | "UPGRADE_RANDOM_SUB" {
    return existingSubCount < 4 ? "ADD_SUB" : "UPGRADE_RANDOM_SUB";
  },
  upgradeProbability: 0.25,   // 四条中随机强化一条，各 1/4
  note: "官方公示：不足四条则新增；已有四条则在四条中随机强化一条",
} as const;
