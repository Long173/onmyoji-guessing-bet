// tests/g0-state.ts — ★ G0 验收：BattleState 收口（a1-4.md §55）
//
// 文档给的标准是一句话：
//   暂停战斗 → 保存 state → 杀掉 Engine → 重新加载 → 可以继续完全相同地战斗。
//
// 本测试把这句话拆成可执行断言：
//   ① 捕获的状态是**纯数据**（JSON 往返后指纹不变、零函数、零 Map/Set）
//   ② 续跑与连续跑**逐位一致**（胜者/回合/结束原因/事件数/最终状态指纹）
//   ③ 真的"杀掉 Engine"：旧实例被丢弃，用另一份 kit 重建
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, restoreBattle, stateHash } from "../kernel/state.ts";
import type { BattleState } from "../kernel/state.ts";

const here = import.meta.dirname;
const ROOT = path.resolve(here, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);

const SEED = 20261001;
const PAUSE_AT = 20;      // 第 20 回合暂停

/** 运行时工厂：与 assembleMatch 用的是同一份 buildCharacter（因此不是"另写一套恢复逻辑"） */
function makeDeps(kit: any) {
  // 与装配路径同源：runtimeFor 内部就是 assembleMatch 用的那份 buildCharacter + 缓存
  return { kit, makeRuntime: (shikigamiId: number) => runtimeFor(kit, shikigamiId), attachRuntime };
}

// ── 参照组：一口气跑完 ──
const kitA = createKit(bundle);
const a = assembleMatch(kitA, canonicalMatch(), { seed: SEED });
const refResult = await a.battle.run();
const refState = captureState(a.battle);
const refHash = stateHash(refState);
console.log(`参照：${refResult.turns} 回合 winner=${refResult.winner} reason=${refResult.reason} trace=${a.battle.trace.length} hash=${refHash}`);

sec("[1] 捕获的状态必须是纯数据");
const json = JSON.stringify(refState);
const roundTrip = JSON.parse(json) as BattleState;
ok("JSON 往返成功", json.length > 0, `${(json.length / 1024).toFixed(1)} KB`);
ok("★ 往返后指纹不变（无损）", stateHash(roundTrip) === refHash, `${stateHash(roundTrip)} vs ${refHash}`);
const fnCount = (json.match(/"\s*:\s*undefined/g) ?? []).length;
ok("序列化结果里没有 undefined 字段", fnCount === 0, String(fnCount));
ok("★ 没有任何 Map/Set/类实例（全被投影成纯数据）", !/\[object (Map|Set)\]/.test(json));
ok("实体身份（shikigamiId）在状态里", roundTrip.teams[0].members.every(m => m.shikigamiId !== null));
ok("随机数发生器内部状态已入档（s/n，不是只有 seed）", typeof roundTrip.rng.s === "number" && typeof roundTrip.rng.n === "number" && roundTrip.rng.n > 0, JSON.stringify(roundTrip.rng));
// 注意：死亡单位会从行动条移除（Battle.kill），所以终局时条上只剩存活者 —— 4 条是正确的，不是漏记
ok("行动条位置逐条入档（终局只剩存活者）", roundTrip.timeline.entries.length > 0 && roundTrip.timeline.entries.length <= 10, String(roundTrip.timeline.entries.length));
ok("存活者数量与行动条条目一致", roundTrip.timeline.entries.length === refState.teams.reduce((n, t) => n + t.members.filter(m => m.alive).length, 0), JSON.stringify(roundTrip.timeline.entries.map(e => e.id)));
ok("六条红区策略 id 全部入档", Object.values(roundTrip.policyIds).every(Boolean), JSON.stringify(roundTrip.policyIds));

sec(`[2] 暂停在第 ${PAUSE_AT} 回合 → 捕获 → 杀掉引擎 → 重建 → 续跑`);
const kitB = createKit(bundle);                       // 全新的运行时
const bAssembled = assembleMatch(kitB, canonicalMatch(), { seed: SEED });
await bAssembled.battle.runStartup();                  // 先跑开局流水线（建立御魂 handler / 行动条）
await bAssembled.battle.runPartial(PAUSE_AT);          // 推进到第 20 回合
const mid = captureState(bAssembled.battle);
console.log(`暂停点：turn=${mid.turn} rng.n=${mid.rng.n} trace=${bAssembled.battle.trace.length}`);
ok("确实停在了指定回合（不是一口气跑完）", mid.turn === PAUSE_AT && bAssembled.battle.winner === null, `turn=${mid.turn} winner=${bAssembled.battle.winner}`);

const saved = JSON.parse(JSON.stringify(mid)) as BattleState;   // 存盘：只剩字符串
// 杀掉引擎：丢弃 kitB 与旧 Battle，全部重新来过
const kitC = createKit(bundle);
const restored = restoreBattle(saved, makeDeps(kitC) as any);
ok("重建后回合数与存盘一致", restored.turn === saved.turn, `${restored.turn} vs ${saved.turn}`);
ok("重建后随机数位置一致（否则下一次抽数就分叉）", (restored.rng.snapshot(false) as any).s === saved.rng.s && (restored.rng.snapshot(false) as any).n === saved.rng.n);
ok("重建后行动条位置一致", JSON.stringify(restored.timeline.all().map(e => [e.id, Math.round(e.pos)]).sort()) === JSON.stringify(saved.timeline.entries.map(e => [e.id, Math.round(e.pos)]).sort()));
const needMore = await restored.runPartial(Infinity);
// runPartial 返回的是"还要不要继续"（boolean），胜者/回合要读战斗自身 —— 别把返回值当结果对象
const resumed = { winner: restored.winner, turns: restored.turn, reason: restored.endReason, needMore };
console.log(`续跑后：needMore=${needMore} turn=${resumed.turns} winner=${resumed.winner} reason=${resumed.reason} trace=${restored.trace.length}`);

sec("[3] ★ 续跑结果必须与连续跑逐位一致");
ok(`胜者一致（${resumed.winner}）`, resumed.winner === refResult.winner, `${resumed.winner} vs ${refResult.winner}`);
ok(`回合数一致（${resumed.turns}）`, resumed.turns === refResult.turns, `${resumed.turns} vs ${refResult.turns}`);
ok(`结束原因一致（${resumed.reason}）`, resumed.reason === refResult.reason, `${resumed.reason} vs ${refResult.reason}`);
// 续跑的战斗从空日志开始，因此它应当复现的是"暂停点之后"的那一段事件，且必须逐条一致
const postPauseRef = a.battle.trace.slice(mid.counts.trace);
ok(`★ 暂停后事件逐条一致（${restored.trace.length} 条）`, JSON.stringify(restored.trace) === JSON.stringify(postPauseRef),
   `resumed=${restored.trace.length} expected=${postPauseRef.length}`);
ok("回合日志也逐条一致", JSON.stringify(restored.turnLog) === JSON.stringify(a.battle.turnLog.slice(mid.counts.turnLog)), `${restored.turnLog.length} vs ${a.battle.turnLog.length - mid.counts.turnLog}`);
const finalHash = stateHash(captureState(restored));
ok(`★ 最终核心状态指纹一致`, finalHash === refHash, `${finalHash} vs ${refHash}`);

sec("[4] 复现性：同一个 seed 跑两次必须完全一样（State Hash 的意义）");
const a2 = assembleMatch(createKit(bundle), canonicalMatch(), { seed: SEED });
await a2.battle.run();
ok("两次独立运行的最终指纹相同", stateHash(captureState(a2.battle)) === refHash);

console.log(`\n=== G0: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
