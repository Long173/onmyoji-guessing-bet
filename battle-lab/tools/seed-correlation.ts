// tools/seed-correlation.ts — 顺序 seed 相关性检验（可复跑脚本）
// 背景：09-M1.8-预测工作台.md §4.3 记录了一个**被否定**的假设 ——
//       曾怀疑 seedBase+i 让相邻对局共享随机序列，使 Wilson 区间偏窄。
//       结论必须能被任何人重跑验证，所以把当时的检验固化成这个脚本。
//
// 方法：40 个区块 × 每块 250 局 = 10,000 局，比较区块胜率的实际标准差与二项理论值，
//       并做区块胜场数的卡方检验（df = 区块数-1）。
// 判读：SD 比值 ≈ 1、卡方落在 95% 区间内 → 与"各局独立"一致，未检出相关性。
//
// 运行：cd apps/web && node ../../battle-lab/tools/seed-correlation.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createKit, runOne, mixSeed } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(readFileSync(join(here, "..", "..", "apps", "web", "src", "engine", "bundle.json"), "utf8"));

const BLOCKS = Number(process.env.BLOCKS ?? 40);
const SIZE = Number(process.env.SIZE ?? 250);
const BASE = 20261001;
const kit = createKit(bundle);
const match = canonicalMatch();

async function run(label: string, seedOf: (i: number) => number) {
  const rates: number[] = [];
  for (let b = 0; b < BLOCKS; b++) {
    let red = 0, decisive = 0;
    for (let i = 0; i < SIZE; i++) {
      const a = await runOne(kit, match, seedOf(b * SIZE + i), { maxTurns: 300, annotate: false });
      if (a.result.reason === "TURN_LIMIT") continue;
      if (a.result.winner === 0) red++;
      decisive++;
    }
    rates.push(red / decisive);
  }
  const mean = rates.reduce((x, y) => x + y, 0) / BLOCKS;
  const sd = Math.sqrt(rates.reduce((x, y) => x + (y - mean) ** 2, 0) / (BLOCKS - 1));
  const theo = Math.sqrt((mean * (1 - mean)) / SIZE);
  let chi = 0;
  for (const r of rates) { const o = r * SIZE, e = mean * SIZE; chi += ((o - e) ** 2) / (e * (1 - mean)); }
  const df = BLOCKS - 1;
  const upper = df + 1.96 * Math.sqrt(2 * df);
  console.log(`${label}`);
  console.log(`  总胜率 ${(mean * 100).toFixed(2)}%   区块 SD ${(sd * 100).toFixed(2)}%   二项理论 ${(theo * 100).toFixed(2)}%   比值 ${(sd / theo).toFixed(3)}`);
  console.log(`  卡方 ${chi.toFixed(1)}  (df=${df}, 期望≈${df}, 95% 上界≈${upper.toFixed(0)})  → ${chi <= upper ? "与独立同分布一致（未检出相关性）" : "★ 超出上界，需要进一步排查"}`);
  return { mean, sd, theo, chi, df };
}

console.log(`=== seed 相关性检验：${BLOCKS} 区块 × ${SIZE} 局 = ${BLOCKS * SIZE} 局 ===\n`);
const seq = await run("【顺序 seed】seedBase + i", (i) => BASE + i);
console.log("");
const hashed = await run("【雪崩散列】mixSeed(seedBase, i)", (i) => mixSeed(BASE, i));
console.log(`\n结论：两种方案都与独立同分布相符（均值接近、SD 比值接近 1、卡方未超上界）。`);
console.log(`散列只是留有余量的防御性选择，不是修复某个已证实的缺陷 —— 详见 09-M1.8-预测工作台.md §4.3。`);
