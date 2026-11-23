// tools/symmetry-spread.ts — ★★ 「换边胜率差」的**分布测量**（第 84 轮）
//
// 由来：apps/web/tests/ui7-guardrails.ts 的护栏 #1 用「换边后红方胜率 ≈ 原局蓝方胜率」
// 来判红蓝对称，容差原本是 **8 个百分点** —— 而第 83 轮实测量到的实际偏差只有 **0.40pp**。
// 第 84 轮把它收紧到 4pp，但**收紧不能靠估**：先量分布，再定容差。
//
// 这个工具就是那次测量的**可复现版本** —— 引擎改了之后，重跑它就能重新核对容差是否仍然合适。
//   node tools/symmetry-spread.ts
//
// ★ 它不参与断言，只产出数字。判据在 ui7（容差）与 tests/g50（逐 seed 结构）。
import fs from "node:fs";
import path from "node:path";
import { createEngineAdapter } from "../../apps/web/src/adapters/engine-adapter.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { swapSides } from "../../apps/web/src/contracts/guessing-match.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

export interface Spread { N: number; seed: number; diff: number }
export interface SpreadSummary { n: number; mean: number; sd: number; max: number; byN: Record<string, number> }

/** 纯统计：给一批测量值，返回均值/标准差/最大值（百分点） */
export function summarize(rows: Spread[]): SpreadSummary {
  const ds = rows.map(r => r.diff);
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  const sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / ds.length);
  const byN: Record<string, number> = {};
  for (const r of rows) byN[String(r.N)] = Math.max(byN[String(r.N)] ?? 0, r.diff);
  return { n: ds.length, mean: mean * 100, sd: sd * 100, max: Math.max(...ds) * 100, byN: Object.fromEntries(Object.entries(byN).map(([k, v]) => [k, v * 100])) };
}

if (import.meta.filename === process.argv[1]) {
  const adapter = createEngineAdapter(bundle);
  const one = async (N: number, seed: number): Promise<number> => {
    const a: any = await adapter.simulate(canonicalMatch(), { simulations: N, seed, progressEvery: N }, () => {}, () => false);
    const b: any = await adapter.simulate(swapSides(canonicalMatch()), { simulations: N, seed, progressEvery: N }, () => {}, () => false);
    return Math.abs(b.redWinRate - (1 - a.redWinRate));
  };
  const Ns = [200, 500, 1000, 2000];
  const seeds = [777, 1, 42, 20261001, 12345];
  const rows: Spread[] = [];
  console.log("=== 换边胜率差 |pb - (1-pa)|（百分点）===");
  console.log("N\\seed   " + seeds.map(s => String(s).padStart(9)).join(" "));
  for (const N of Ns) {
    const line: string[] = [];
    for (const s of seeds) { const d = await one(N, s); rows.push({ N, seed: s, diff: d }); line.push((d * 100).toFixed(2).padStart(8)); }
    console.log(String(N).padStart(6) + "   " + line.join(" "));
  }
  const s = summarize(rows);
  console.log("\n共 " + s.n + " 组：均值 " + s.mean.toFixed(3) + "pp｜标准差 " + s.sd.toFixed(3) + "pp｜最大 " + s.max.toFixed(3) + "pp");
  console.log("各 N 的最大值：" + Object.entries(s.byN).map(([k, v]) => "N=" + k + " → " + (v as number).toFixed(2) + "pp").join("｜"));
  console.log("\n当前 ui7 容差 = 4.00pp");
  console.log("  ÷ 全局最大 " + s.max.toFixed(2) + "pp = " + (4 / s.max).toFixed(2) + " 倍");
  console.log("  ÷ N=1000 最大 " + (s.byN["1000"] ?? NaN).toFixed(2) + "pp = " + (4 / (s.byN["1000"] ?? NaN)).toFixed(2) + " 倍（ui7 用的就是 N=1000）");
  console.log("\n★ 判读：倍数掉到 1.5 以下就该重新定容差；掉到 1 以下说明它已经挡不住合法抖动了。");
}
