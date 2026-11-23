// tests/ui0-contracts.ts — UI-0 验收：契约 + Worker 协议 + mock 链路（Node 直接运行，无需浏览器）
import { canonicalMatch } from "../src/mock/canonical-match.ts";
import { mockAdapter } from "../src/adapters/mock-adapter.ts";
import { swapSides, emptyMatch, TEAM_SIZE } from "../src/contracts/guessing-match.ts";
import { isConclusionReady } from "../src/contracts/simulation-result.ts";
import type { SimulationResult } from "../src/contracts/simulation-result.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };

console.log("=== UI-0 契约验收 ===");

// ── ① 契约形状：GuessingMatch 永不出现 soulPieces
const m = canonicalMatch();
const json = JSON.stringify(m);
ok("★ GuessingMatch 不含 soulPieces（竞猜 ≠ 养成）", !json.includes("soulPieces") && !json.includes("soulLoadout"));
ok("schemaVersion / ruleset 已冻结", m.schemaVersion === 1 && m.ruleset === "GUESSING");
ok("每队 5 只", m.red.units.length === TEAM_SIZE && m.blue.units.length === TEAM_SIZE);
ok("八维字段完整", m.red.units.every(u =>
  ["attack","hp","defense","speed","critRate","critDamage","effectHit","effectResist"].every(k => typeof (u.stats as any)[k] === "number")));
ok("unitId 唯一（UI 定位用）", new Set([...m.red.units, ...m.blue.units].map(u => u.unitId)).size === 10);

// ── ② 红蓝互换（UX 护栏 #1）
const swapped = swapSides(m);
ok("交换红蓝后红方 = 原蓝方", swapped.red.units.map(u => u.name).join() === m.blue.units.map(u => u.name).join());
ok("交换两次回到原阵容（名称层面）", swapSides(swapped).red.units.map(u => u.name).join() === m.red.units.map(u => u.name).join());
ok("交换后 unitId 全部刷新（不串位）",
   [...swapped.red.units, ...swapped.blue.units].every(u => ![...m.red.units, ...m.blue.units].some(o => o.unitId === u.unitId)));

// ── ③ 校验器
const empty = emptyMatch();
const vr = await mockAdapter.validate(empty);
ok("空阵容全部被拦下（blockers=10，每队 5 只）", !vr.ok && vr.blockers.length === 10, `blockers=${vr.blockers.length}`);
const vr2 = await mockAdapter.validate(m);
ok("完整阵容通过校验", vr2.ok, JSON.stringify(vr2.blockers));
ok("★ UNKNOWN 计数随校验结果返回（永不隐藏）", vr2.strategySnapshot.unknownCount > 0, `unknown=${vr2.strategySnapshot.unknownCount}`);
ok("Coverage 快照完整", vr2.coverage.unitsTotal === 10 && Array.isArray(vr2.coverage.unsupportedCapabilities));

// ── ④ 模拟：进度回调 + 契约不变式
let progressCalls = 0, lastCompleted = 0, monotonic = true;
const result: SimulationResult = await mockAdapter.simulate(
  m, { simulations: 2000, seed: 12345, progressEvery: 200 },
  (p) => { progressCalls++; if (p.completed < lastCompleted) monotonic = false; lastCompleted = p.completed; },
  () => false,
);
ok("进度回调被多次触发且单调递增", progressCalls >= 5 && monotonic, `calls=${progressCalls} last=${lastCompleted}`);

const sum = result.redWins + result.blueWins + result.draws + result.timeouts + result.errors;
ok("★ 五类结局之和 = 总模拟数（无遗漏）", sum === result.simulations, `${sum} vs ${result.simulations}`);
ok("★ errors 永不进入分母", result.decisive === result.redWins + result.blueWins,
   `decisive=${result.decisive} red+blue=${result.redWins + result.blueWins}`);
ok("Wilson 区间存在且包含点估计", !!result.confidenceInterval
   && result.confidenceInterval.method === "WILSON"
   && result.redWinRate! >= result.confidenceInterval.low
   && result.redWinRate! <= result.confidenceInterval.high,
   result.confidenceInterval ? `${(result.redWinRate!*100).toFixed(2)}% ∈ [${(result.confidenceInterval.low*100).toFixed(2)}%, ${(result.confidenceInterval.high*100).toFixed(2)}%]` : "无");
ok("★ 模型不确定性 与 抽样误差 分开返回", !!result.modelUncertainty && result.modelUncertainty.perStrategy.length > 1,
   result.modelUncertainty ? `spread=${(result.modelUncertainty.spread!*100).toFixed(1)}pp verdict=${result.modelUncertainty.verdict}` : "无");
ok("策略快照随结果保存", result.strategySnapshot.unknownCount > 0);
ok("版本随结果保存", !!result.engineVersion && !!result.gameDataVersion, `${result.engineVersion} / ${result.gameDataVersion}`);
ok("警告包含 UNKNOWN_STRATEGY", result.warnings.some(w => w.kind === "UNKNOWN_STRATEGY"));
ok("代表局 seed 返回", !!result.seeds && result.seeds.length > 0);
ok("每只式神都有贡献统计", result.battleStats.perUnit.length === 10, `perUnit=${result.battleStats.perUnit.length}`);

// ── ⑤ 结论判定：UNKNOWN 存在时必须判"不可下结论"
const v = isConclusionReady(result);
ok("★ 存在 UNKNOWN 时判定为不可下结论", !v.ready, v.reasons.join("；"));

// ── ⑥ 同 seed 可复现
const r2 = await mockAdapter.simulate(m, { simulations: 2000, seed: 12345 }, () => {}, () => false);
ok("同 seed 结果一致（可复现）", r2.redWins === result.redWins && r2.blueWins === result.blueWins,
   `${r2.redWins}/${r2.blueWins} vs ${result.redWins}/${result.blueWins}`);

// ── ⑦ 取消
let cancelled = false;
try {
  await mockAdapter.simulate(m, { simulations: 20000, seed: 1, progressEvery: 100 }, () => { cancelled = true; }, () => true);
} catch { /* 预期抛错 */ }
ok("支持取消（shouldCancel 被响应）", cancelled);

// ── ⑧ Replay 契约
const rep = await mockAdapter.replay(m, 143822);
ok("Replay 返回事件流与单位表", rep.events.length > 0 && rep.units.length === 10, `events=${rep.events.length} units=${rep.units.length}`);
ok("事件含 Event Inspector 所需 detail", rep.events.some(e => e.code === "DAMAGE" && e.detail && "randomRoll" in e.detail));
ok("事件 index 连续", rep.events.every((e, i) => e.index === i));

console.log(`\n=== UI-0: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
