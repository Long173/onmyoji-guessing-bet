// runner/monte-carlo.ts — Monte Carlo + Wilson 区间 + CRN 配对
// 关键：**卡住的局不计入任何一方**，单独统计为 STALL，否则胜率之和会假的凑成 100%。
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { policySnapshot, hasUnknownPolicy } from "../kernel/policies.ts";
import type { BattlePolicies } from "../kernel/policies.ts";

export interface RunOutcome { winner: 0 | 1 | null; reason: string; turns: number }

export interface MonteCarloResult {
  n: number; winsRed: number; winsBlue: number; stalls: number; doubleKo: number;
  winRateRed: number | null; winRateBlue: number | null;
  ci95Red: [number, number] | null; ci95Blue: [number, number] | null;
  /** 是否可下结论：卡住比例过高 / 含 UNKNOWN 策略时不可 */
  conclusionReady: boolean;
  warnings: string[];
  policies: any;
  seedBase: number;
}

/** Wilson score interval（比正态近似更适合极端胜率） */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - s) / d, (c + s) / d];
}

export async function monteCarlo(
  makeBattle: (seed: number) => Battle | Promise<Battle>,
  n: number,
  opts: { seedBase?: number; maxStallRatio?: number } = {},
): Promise<MonteCarloResult> {
  const seedBase = opts.seedBase ?? 100000;
  const maxStall = opts.maxStallRatio ?? 0.2;
  let winsRed = 0, winsBlue = 0, stalls = 0, doubleKo = 0;
  let policies: BattlePolicies | null = null;
  for (let i = 0; i < n; i++) {
    const bt = await makeBattle(seedBase + i);
    policies = bt.policies;
    const r = await bt.run();
    if (r.reason === "TURN_LIMIT") stalls++;
    else if (r.winner === 0) winsRed++;
    else if (r.winner === 1) winsBlue++;
    else doubleKo++;
  }
  const decisive = winsRed + winsBlue;
  const winRateRed = decisive ? winsRed / decisive : null;
  const winRateBlue = decisive ? winsBlue / decisive : null;
  const warnings: string[] = [];
  if (policies && hasUnknownPolicy(policies)) warnings.push("存在 UNKNOWN 策略：" + JSON.stringify(policySnapshot(policies)) + " —— 本结果不构成机制结论");
  if (stalls / n > maxStall) warnings.push("卡住比例 " + ((stalls / n) * 100).toFixed(1) + "% 超过阈值 " + (maxStall * 100) + "%，样本被未终结局污染");
  if (decisive < 100) warnings.push("有效样本仅 " + decisive + " 局，置信区间过宽");
  return {
    n, winsRed, winsBlue, stalls, doubleKo,
    winRateRed, winRateBlue,
    ci95Red: decisive ? wilson(winsRed, decisive) : null,
    ci95Blue: decisive ? wilson(winsBlue, decisive) : null,
    conclusionReady: warnings.length === 0,
    warnings, policies: policySnapshot(policies!), seedBase,
  };
}

/**
 * 回合上限敏感性：同一阵容在不同 maxTurns 下胜率会漂移多少。
 * 这是 D 组（对弈竞猜残局加速机制）未实测时，**唯一诚实的精度声明**。
 */
export interface SensitivityPoint { maxTurns: number; winRateRed: number | null; stalls: number; decisive: number }

export async function turnLimitSensitivity(
  makeBattleWithLimit: (seed: number, maxTurns: number) => Battle | Promise<Battle>,
  limits: number[], n: number, seedBase = 600000,
): Promise<{ points: SensitivityPoint[]; spread: number; verdict: string }> {
  const points: SensitivityPoint[] = [];
  for (const maxTurns of limits) {
    const r = await monteCarlo(s => makeBattleWithLimit(s, maxTurns), n, { seedBase, maxStallRatio: 1 });
    points.push({ maxTurns, winRateRed: r.winRateRed, stalls: r.stalls, decisive: r.winsRed + r.winsBlue });
  }
  const rates = points.map(p => p.winRateRed).filter((x): x is number => x !== null);
  const spread = rates.length > 1 ? Math.max(...rates) - Math.min(...rates) : 0;
  const stallDrop = points.length > 1 ? points[0].stalls - points[points.length - 1].stalls : 0;
  let verdict: string;
  if (spread > 0.1) verdict = "胜率随回合上限漂移 " + (spread * 100).toFixed(1) + " 个百分点 —— 残局机制未实测前，该阵容胜率不可用";
  else if (stallDrop / n > 0.05) verdict = "提高回合上限可消解 " + ((stallDrop / n) * 100).toFixed(1) + "% 的卡住局，但胜率稳定，结论对该参数不敏感";
  else verdict = "胜率对回合上限不敏感（漂移 " + (spread * 100).toFixed(1) + " 个百分点）";
  return { points, spread, verdict };
}

export function formatResult(r: MonteCarloResult, label = ""): string {
  const L: string[] = [];
  const pc = (x: number | null) => (x === null ? "N/A" : (x * 100).toFixed(2) + "%");
  const ci = (c: [number, number] | null) => (c ? `[${(c[0] * 100).toFixed(2)}%, ${(c[1] * 100).toFixed(2)}%]` : "N/A");
  L.push(`### ${label}`);
  L.push(`模拟 ${r.n} 局 | 红胜 ${r.winsRed} | 蓝胜 ${r.winsBlue} | 卡住(未终结) ${r.stalls} | 同归于尽 ${r.doubleKo}`);
  L.push(`红方胜率 ${pc(r.winRateRed)}  Wilson 95% CI ${ci(r.ci95Red)}`);
  L.push(`蓝方胜率 ${pc(r.winRateBlue)}  Wilson 95% CI ${ci(r.ci95Blue)}`);
  L.push(`可下结论: ${r.conclusionReady ? "是" : "否"}`);
  for (const w of r.warnings) L.push(`  ⚠️ ${w}`);
  return L.join("\n");
}
