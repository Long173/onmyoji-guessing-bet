// runner/policy-sweep.ts — ★ 策略敏感性扫描：把「无法下结论」变成「这个判断稳不稳」
//
// 动机：项目里有四个红区（开局顺序 / 并列先后 / 击杀时点 / 竞猜残局），每个都有若干**都说得通**的
// 候选。此前的做法是：把 UNKNOWN 写进产物、然后声明"本结果不构成机制结论"。
// 这是诚实的，但对**使用者真正要回答的问题**毫无帮助 —— 他要的是"我该押哪边"。
//
// 关键区分：机制**是什么**无法由我们决定（那是红区，只能靠游戏内观测）；
// 但"**换成别的候选，结论会不会翻**"是我们完全可以算的。如果红方在全部合理候选下都赢，
// 那么"押红"这个判断就不依赖于那几个未解的问题 —— 这比"无法下结论"有用得多，而且同样是诚实的。
//
// 两条纪律：
//   ① 只把**说得通的候选**计入判定。已知有偏的候选（例如并列按注册序，会造成红方结构性优势）
//      单独列出、**不计入** verdict —— 否则用一个人为偏差去"证明"结论不稳，等于自己制造噪声。
//   ② 扫描结论的措辞必须限定范围：「在这些候选下稳健」，不是「已确证」。
import type { MonteCarloResult } from "./monte-carlo.ts";
import { monteCarlo } from "./monte-carlo.ts";

export interface SweepVariant {
  id: string;
  /** 该候选的可信度（沿用红区的三态） */
  status: "UNKNOWN" | "HYPOTHESIS" | "VERIFIED";
  /**
   * 是否计入判定。已知有偏 / 仅作参照的候选填 false —— 它们会被跑、会被列出，但不参与 verdict。
   */
  plausible: boolean;
  note?: string;
  /** 把该候选作用到 policies 上（返回新的 policies，不要就地改） */
  apply: (policies: any) => any;
}

export interface SweepAxis { name: string; variants: SweepVariant[] }

export interface SweepCell {
  combo: Record<string, string>;
  winRateRed: number | null;
  ci95: [number, number] | null;
  stalls: number;
  n: number;
  /** 该组合是否全部候选都 plausible（false = 含仅作参照的候选，不进 verdict） */
  countsTowardVerdict: boolean;
}

export type SweepVerdict = "STABLE_RED" | "STABLE_BLUE" | "FLIPS" | "INCONCLUSIVE";

export interface SweepResult {
  cells: SweepCell[];
  verdict: SweepVerdict;
  /** 计入判定的那些组合里，红方胜率的最低/最高 */
  minRate: number | null;
  maxRate: number | null;
  spread: number | null;
  /**
   * 连同「仅作参照」的候选一起看的极差。
   * ★ 为什么要单列：只报 spread 时，表格里明明有 55.0% 与 57.5% 两行，标题却写「极差 0.0」——
   *   技术上没错（判定只看计入的那些），但读起来像「什么都没变」。两个数都给，才不误导。
   */
  spreadAll: number | null;
  axes: string[];
  counts: { total: number; towardVerdict: number; excluded: number };
  note: string;
}

/** 笛卡尔积 */
function combinations(axes: SweepAxis[]): Array<Record<string, SweepVariant>> {
  let acc: Array<Record<string, SweepVariant>> = [{}];
  for (const ax of axes) {
    const next: Array<Record<string, SweepVariant>> = [];
    for (const base of acc) for (const v of ax.variants) next.push({ ...base, [ax.name]: v });
    acc = next;
  }
  return acc;
}

export async function sweepPolicies(
  makeBattle: (seed: number, policies: any) => Promise<any>,
  basePolicies: any,
  axes: SweepAxis[],
  n: number,
  opts: { seedBase?: number } = {},
): Promise<SweepResult> {
  const combos = combinations(axes);
  const cells: SweepCell[] = [];
  for (const combo of combos) {
    let policies = basePolicies;
    for (const v of Object.values(combo)) policies = v.apply(policies);
    const mc: MonteCarloResult = await monteCarlo((seed: number) => makeBattle(seed, policies), n, { seedBase: opts.seedBase ?? 20261001 });
    cells.push({
      combo: Object.fromEntries(Object.entries(combo).map(([k, v]) => [k, v.id])),
      winRateRed: mc.winRateRed, ci95: mc.ci95Red, stalls: mc.stalls, n: mc.n,
      countsTowardVerdict: Object.values(combo).every(v => v.plausible),
    });
  }
  const counted = cells.filter(c => c.countsTowardVerdict && c.winRateRed !== null);
  const rates = counted.map(c => c.winRateRed as number);
  const minRate = rates.length ? Math.min(...rates) : null;
  const maxRate = rates.length ? Math.max(...rates) : null;
  // ★ 数据层不做四舍五入：把它留给格式化。曾经在这里 toFixed(4)，
  //   结果测试按精确值断言时差了一点点 —— 数值字段应当是精确的，显示才需要取整。
  const spread = rates.length ? (maxRate! - minRate!) : null;

  let verdict: SweepVerdict = "INCONCLUSIVE";
  if (rates.length) {
    const allRed = rates.every(r => r > 0.5);
    const allBlue = rates.every(r => r <= 0.5);
    verdict = allRed ? "STABLE_RED" : allBlue ? "STABLE_BLUE" : "FLIPS";
  }
  const allRates = cells.map(c => c.winRateRed).filter((x): x is number => x !== null);
  const spreadAll = allRates.length ? (Math.max(...allRates) - Math.min(...allRates)) : null;
  const excluded = cells.length - counted.length;
  const note =
    verdict === "STABLE_RED"
      ? `在计入判定的 ${counted.length} 种候选组合下，红方胜率全部高于 50%（${(minRate! * 100).toFixed(1)}%–${(maxRate! * 100).toFixed(1)}%）——「押红」这个判断不依赖于那几个未解的问题。`
      : verdict === "STABLE_BLUE"
        ? `在计入判定的 ${counted.length} 种候选组合下，红方胜率全部不高于 50%（${(minRate! * 100).toFixed(1)}%–${(maxRate! * 100).toFixed(1)}%）——「押蓝」这个判断不依赖于那几个未解的问题。`
        : verdict === "FLIPS"
          ? `★ 结论会**翻**：红方胜率在 ${(minRate! * 100).toFixed(1)}%–${(maxRate! * 100).toFixed(1)}% 之间随候选而变，跨越 50%。在这种局面下"押哪边"取决于尚未确定的那条规则，本工具**不建议**据此下注。`
          : "没有可判定的组合（全部候选都被标记为仅作参照），无法给出稳健性判断。";
  return {
    cells, verdict, minRate, maxRate, spread, spreadAll,
    axes: axes.map(a => a.name),
    counts: { total: cells.length, towardVerdict: counted.length, excluded },
    note: note + "（注意：这只说明「结论对这几个候选不敏感」，不等于机制已被确证 —— 机制本身仍需游戏内观测。）"
      + ((spreadAll !== null && spread !== null && Math.abs(spreadAll - spread) > 1e-9)
        ? "（判定内的极差 " + (spread * 100).toFixed(1) + " 个百分点；连同仅作参照的候选一起看是 " + (spreadAll * 100).toFixed(1) + "）"
        : ""),
  };
}

/** 把结果排成一张可读的表（CLI 与测试共用，避免两处各写一遍格式） */
export function formatSweep(r: SweepResult): string {
  const L: string[] = [];
  L.push("=== 策略敏感性扫描 ===");
  L.push("轴：" + r.axes.join(" × ") + "｜组合 " + r.counts.total + "（计入判定 " + r.counts.towardVerdict + "，仅参照 " + r.counts.excluded + "）");
  L.push("");
  for (const c of r.cells) {
    const rate = c.winRateRed === null ? "—" : (c.winRateRed * 100).toFixed(1) + "%";
    const ci = c.ci95 ? "[" + (c.ci95[0] * 100).toFixed(1) + ", " + (c.ci95[1] * 100).toFixed(1) + "]" : "";
    L.push("  " + (c.countsTowardVerdict ? " " : "·") + " " + Object.values(c.combo).join(" × ").padEnd(58) + rate.padStart(7) + "  " + ci + (c.stalls ? "  卡住 " + c.stalls : ""));
  }
  L.push("");
  const sp = r.spread !== null
    ? "（判定内极差 " + (r.spread * 100).toFixed(1) + " 个百分点"
      + ((r.spreadAll !== null && Math.abs(r.spreadAll - r.spread) > 1e-9) ? "；含仅参照候选 " + (r.spreadAll * 100).toFixed(1) : "") + "）"
    : "";
  L.push("结论：" + r.verdict + sp);
  L.push(r.note);
  L.push("");
  L.push("标 · 的行含「仅作参照」的候选，不参与结论 —— 用已知有偏的候选去证明结论不稳，等于自己制造噪声。");
  return L.join("\n");
}
