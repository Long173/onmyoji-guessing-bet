// runner/diff-cli.ts — G6：把「人工在游戏里记下的观测」与「模拟的一天条」逐条对照，指出第一处分歧
//
// 用法：
//   node runner/diff-cli.ts obs=observations/typical-001.json seed=20261001 maxTurns=300
//   node runner/diff-cli.ts obs=... seed=... fixture=fixtures/guessing-match-canonical-001.json
//
// 观测文件格式（人在游戏里记的，越简单越好）：
//   {
//     "note": "2026-10-05 对弈竞猜 第 3 场",
//     "frames": [
//       { "kind": "SKILL",  "actor": "雪女",   "skill": "暴风雪" },
//       { "kind": "DAMAGE", "actor": "雪女",   "target": "三尾狐", "amount": 6241, "hpAfter": 11364 },
//       { "kind": "STATUS", "actor": "雪女",   "target": "三尾狐", "status": "冰冻" }
//     ]
//   }
// 只写你**真的看见了**的字段：没写的字段一律不参与比对（见 kernel/diff.ts）。
import fs from "node:fs";
import path from "node:path";
import { diffTimelines, projectObserved, buildAlias } from "../kernel/diff.ts";
import type { ObsFrame } from "../kernel/diff.ts";
import { assembleGuessingMatch, loadMatchFixture } from "../soul/guessing-match.ts";

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split("=") as [string, string]));
const obsPath = args.obs;
if (!obsPath) {
  console.error("用法：node runner/diff-cli.ts obs=<观测文件.json> [seed=20261001] [maxTurns=300] [fixture=<对局夹具>]");
  process.exit(2);
}
const ROOT = path.resolve(import.meta.dirname, "..");
const fixPath = args.fixture ?? path.join(ROOT, "fixtures", "guessing-match-canonical-001.json");
const seed = Number(args.seed ?? 20261001);
const maxTurns = Number(args.maxTurns ?? 300);

const file = JSON.parse(fs.readFileSync(path.resolve(obsPath), "utf8"));
const expected: ObsFrame[] = file.frames ?? file;
const fx: any = await loadMatchFixture(fixPath);
// ★ 第 192 轮：这一行必须**显式要 FULL** —— projectObserved 吃的是 trace，
//   而 assembleGuessingMatch 的默认档是 NONE（a1-4 §35 给批量跑的档）。
const A: any = await assembleGuessingMatch(fx, { seed, maxTurns, traceLevel: "FULL" });
const result = await A.battle.run();
const { frames, unobservable } = projectObserved(A.battle.trace as any[]);

const byId: Record<number, string> = {};
for (const t of A.battle.teams) for (const m of t.members) byId[m.id] = m.name;
const alias = buildAlias(byId);
const d = diffTimelines(expected, frames, { alias, tolerance: Number(args.tolerance ?? 1) });

console.log("=== G6 对照：游戏观测 vs 模拟 ===");
console.log("对局：" + path.basename(fixPath) + "｜seed " + seed + "｜模拟结果 胜者=" + (result.winner ?? "平") + " 回合=" + result.turns);
console.log("观测 " + expected.length + " 条｜模拟可观测帧 " + frames.length + " 条（另有 " + unobservable + " 条内部帧，游戏画面看不到）");
console.log("");
if (d.ok) {
  console.log("✓ " + d.summary);
  console.log("  —— 在这段观测覆盖到的范围内，模拟与游戏**没有分歧**。");
  console.log("     这不等于模型正确：只说明没被观测覆盖到的部分仍未经验证。");
} else {
  const f = d.first!;
  console.log("✗ " + d.summary);
  console.log("");
  console.log("第一处分歧（第 " + (f.index + 1) + " 条观测）：");
  if (f.reason === "MISSING") {
    console.log("  游戏里发生了这件事，模拟里**没有**：");
    console.log("    观测：" + JSON.stringify(f.expected));
  } else if (f.reason === "EXTRA") {
    console.log("  模拟里发生了这件事，观测里**没有**：");
    console.log("    模拟：" + JSON.stringify(f.actual));
  } else {
    console.log("    字段 " + f.field + "：观测 " + JSON.stringify(f.expectedValue) + " vs 模拟 " + JSON.stringify(f.actualValue));
    console.log("    观测：" + JSON.stringify(f.expected));
    console.log("    模拟：" + JSON.stringify(f.actual));
  }
  console.log("");
  console.log("  分歧点之前（已一致）：");
  for (const b of f.context.before) console.log("    " + JSON.stringify(b));
  console.log("  分歧点之后（观测）：");
  for (const a2 of f.context.after) console.log("    " + JSON.stringify(a2));
  if (d.all.length > 1) console.log("\n（后续还有 " + (d.all.length - 1) + " 处分歧，用 --all 查看）");
  if (process.argv.includes("--all")) for (const x of d.all) console.log("  " + x.reason + " #" + (x.index + 1) + " " + JSON.stringify(x.expected ?? x.actual));
}
console.log("");
console.log("已逐条比对 " + d.matched + " 条；模拟侧另有 " + d.skipped + " 条内部帧按容差跳过" + (d.skipped ? "（明细见 kernel/diff.ts 的 skippedDetail）" : ""));
process.exit(d.ok ? 0 : 1);
