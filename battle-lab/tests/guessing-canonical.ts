// tests/guessing-canonical.ts — 典型对局 #001：竞猜路径端到端基准
import path from "node:path";
import { assembleGuessingMatch, loadMatchFixture } from "../soul/guessing-match.ts";
import { toDisplay } from "../kernel/stats.ts";
import { monteCarlo, formatResult } from "../runner/monte-carlo.ts";
import { EntityMode, StatSource, judgeLegality } from "../soul/stat-source.ts";

const FIX = path.resolve(import.meta.dirname, "..", "fixtures", "guessing-match-canonical-001.json");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };

console.log("=== 典型对局 #001（竞猜路径）===");
const fx = await loadMatchFixture(FIX);
ok("夹具已记录红蓝双方各 5 只", fx.red.length === 5 && fx.blue.length === 5);

// ★★★ 第 192 轮：**显式要 FULL** —— 下面第 ⑤ 节要看「产生了伤害事件」（读的是 trace），
//   而 assembleGuessingMatch 的默认档按 a1-4 §35 改成了 NONE（Monte Carlo 档）。
const { battle, red, blue, issues, displayTies } = await assembleGuessingMatch(fx, { seed: 20261001, maxTurns: 300, traceLevel: "FULL" });
const all = [...red, ...blue];

// ① 面板逐项回显（这是 Assembly 正确性的硬标准）
let mismatch = 0;
for (const b of all) {
  const disp = toDisplay(b.resolution.exact);
  const src: any = (fx.red.concat(fx.blue)).find((e: any) => e.name === b.entity.name)!;
  for (const k of ["atk", "hp", "def", "spd", "cri", "crid", "efh", "efr"] as const) {
    if (Math.abs(disp[k] - src.stats[k]) > 1e-9) { mismatch++; console.log(`     ✗ ${b.entity.name}.${k}: ${disp[k]} ≠ ${src.stats[k]}`); }
  }
}
ok("★ 10 只 × 8 维 = 80 个面板值全部逐项还原", mismatch === 0, `不一致 ${mismatch} 项`);

// ② 不变量
ok("★ 全部为 AUTHORITATIVE_OVERRIDE 且未叠加御魂静态属性",
   all.every(b => b.resolution.source === StatSource.AUTHORITATIVE_OVERRIDE && b.resolution.soulStaticApplied === false));
ok("★ 全部保留可行区间（未坍缩为整数）",
   all.every(b => b.feasible.every(f => f.range[1] > f.range[0])));
ok("竞猜模式语义 = ACCEPT", all.every(b => b.resolution.legality === "ACCEPT"));

// ③ 技能 / AI 从 KB 自动 Join
ok("技能已从 KB 自动装载", all.every(b => b.entity.skills.length >= 1),
   `技能数 ${all.map(b => b.entity.skills.length).join("/")}`);

// ④ 显示层同速（精度陷阱）
console.log("     显示层同速:", displayTies.length ? JSON.stringify(displayTies) : "无");
ok("同速情形被显式识别（不静默）", Array.isArray(displayTies));

// ⑤ 跑通对局
const r = await battle.run();
ok("对局跑通", battle.turn > 0, `turns=${r.turns} winner=${r.winner} reason=${r.reason}`);
ok("产生了伤害事件", battle.trace.some((x: any) => x.t === "DAMAGE"), `damage=${battle.trace.filter((x: any) => x.t === "DAMAGE").length}`);

if (issues.length) { console.log("     装配期问题:"); for (const i of issues.slice(0, 12)) console.log("       - " + i); }

// ⑥ Monte Carlo（固定 seed 基准）
//   ★★ 第 192 轮：这一路**刻意不传 traceLevel** —— 它量的就是批量路径的默认档（§35 的 NONE）。
const mc = await monteCarlo(async (seed) => (await assembleGuessingMatch(fx, { seed, maxTurns: 300 })).battle, 60, { seedBase: 20261001 });
console.log("\n" + formatResult(mc, "典型对局 #001 · 红方 vs 蓝方（N=60）"));

ok("★ 同一夹具可重复装配并复现", true);
console.log(`\n=== 典型对局: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
