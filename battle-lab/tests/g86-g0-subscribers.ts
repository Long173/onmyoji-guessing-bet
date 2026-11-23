// tests/g86-g0-subscribers.ts — ★★★ 第 132 轮：**三种订阅在"装配"与"恢复"两条路径上装同一套**
//
// 由来（第 131 轮那条笔记的续集）：订阅是**事件总线上的函数**，不进 BattleState。
//   装配路径装、恢复路径不装 ⇒「存档前御魂在跑、续跑后御魂消失」这种**静默降级**在架构上成立。
//   第 131 轮先把"替友方拦死"搬进 attachRuntime，这一轮把**御魂与被动**一起搬进去，
//   并补上御魂**闭包层数**的反推（无刀取的 stacks 原先从 0 重来）。
//
// 本文件的判据是**行为**而不是"函数被调用过"：
//   ① 装配路径装了哪三种订阅（id 集合）；
//   ② 恢复之后 id 集合**逐项相同**；
//   ③ 续跑终局与连续跑**逐位一致**（这就是"暂停→存档→杀掉引擎→重载→继续完全相同地战斗"）。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, restoreBattle, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const SEED = 20261302;
const PAUSE_AT = 18;
const SOUL_WUDAOQU = 56;   // 无刀取：回合结束后永久提升15%伤害，上限45% ⇒ 最多 3 层
const PASSIVES = "PARSED_CANDIDATES_ONLY" as const;

/** 典型对局 #001 + 给红 0 号位（三尾狐）穿四件套无刀取 + 打开被动运行时 */
function fixture() {
  const m: any = canonicalMatch();
  m.red.units[0].soulId = SOUL_WUDAOQU;
  return m;
}
const stackCount = (battle: any, id: number) =>
  (battle.teams[0].members[0].effects ?? []).filter((x: any) => typeof x.source === "string" && x.source.startsWith("soul" + SOUL_WUDAOQU + ":stack")).length;
/** 三种订阅的 id 集合（御魂 / 被动 / 替友方拦死）—— 只取这三类，别的处理器不参与比较 */
const subscriberIds = (battle: any) =>
  (battle.bus.handlers ?? []).filter((h: any) => h.source === "SOUL" || h.source === "PASSIVE" || String(h.id).startsWith("allyGuard:"))
    .map((h: any) => h.id).sort();

sec("[1] 装配路径：三种订阅都装上，而且账上有据（soulReport / passiveReport）");
const kitA = createKit(bundle);
const a: any = assembleMatch(kitA, fixture(), { seed: SEED, passives: PASSIVES, traceLevel: "FULL" });
await a.battle.runStartup();
const idsA = subscriberIds(a.battle);
ok("★★★ 御魂装上了（无刀取 = TURN_END 的层数 ramp）",
  !!a.battle.soulReport && a.battle.soulReport.installed.some((x: any) => x.soulId === SOUL_WUDAOQU),
  JSON.stringify(a.battle.soulReport?.installed?.map((x: any) => x.soulId)));
ok("★★★ 被动运行时装上了（三尾狐「诱惑」= AFTER_DAMAGE 的吸血）",
  (a.battle.passiveReport?.installed ?? []).length > 0,
  JSON.stringify(a.battle.passiveReport?.installed?.map((x: any) => x.skill)));
ok("★★ 三种订阅的 id 集合非空（否则下面的比较是平凡通过）", idsA.length >= 2, JSON.stringify(idsA));

sec("[2] 跑到第 " + PAUSE_AT + " 回合 → 存档 → 杀掉引擎 → 重建：订阅必须逐项相同");
await a.battle.runPartial(PAUSE_AT);
const mid = JSON.parse(JSON.stringify(captureState(a.battle)));
const stacksAtPause = stackCount({ teams: mid.teams.map((t: any) => ({ members: t.members.map((m: any) => ({ effects: m.effects })) })) } as any, 0);
ok("★ 前置：存档点上无刀取已经叠过层（否则第 [4] 节证明不了「层数会续」）", stacksAtPause > 0, String(stacksAtPause));

const kitC = createKit(bundle);   // ★ 全新的运行时
const restored: any = restoreBattle(mid, {
  kit: kitC,
  makeRuntime: (id: number) => runtimeFor(kitC, id),
  attachRuntime,                   // ★ 与装配路径**同一个**函数
} as any);
const idsB = subscriberIds(restored);
ok("★★★ 恢复之后的订阅 id 集合与装配路径**逐项相同**",
  JSON.stringify(idsA) === JSON.stringify(idsB),
  JSON.stringify({ 装配: idsA, 恢复: idsB }));

sec("[3] ★★★ 御魂的闭包层数**从实体身上反推**（不是从 0 重来）");
ok("★★★ 恢复后立刻读：已叠层数与存档点一致（无刀取不会「续跑后又能再涨一轮」）",
  stackCount(restored, 0) === stacksAtPause, JSON.stringify({ 恢复后: stackCount(restored, 0), 存档点: stacksAtPause }));

sec("[4] ★★★ 续跑终局与连续跑逐位一致（在有订阅者的情况下）");
const b: any = assembleMatch(createKit(bundle), fixture(), { seed: SEED, passives: PASSIVES, traceLevel: "FULL" });
await b.battle.run();
const refHash = stateHash(captureState(b.battle));
const needMore = await restored.runPartial(Infinity);
const gotHash = stateHash(captureState(restored));
ok("★★★ 终局状态指纹一致（帧号/事件号/RNG/实体状态全部对齐）", gotHash === refHash, JSON.stringify({ 连续: refHash, 续跑: gotHash }));
ok("★★★ 胜者与回合数一致",
  restored.winner === b.battle.winner && restored.turn === b.battle.turn,
  JSON.stringify({ 连续: [b.battle.winner, b.battle.turn], 续跑: [restored.winner, restored.turn] }));
ok("★★ 无刀取的叠层最终都封顶在同一层数（上限 45% / 每层 15% ⇒ 3 层）",
  stackCount(restored, 0) === stackCount(b.battle, 0) && stackCount(b.battle, 0) === 3,
  JSON.stringify({ 连续: stackCount(b.battle, 0), 续跑: stackCount(restored, 0) }));
void needMore;

sec("[5] ★★ 不给知识库时**明确留痕**，而不是安静地少装一套御魂");
{
  const kitD = createKit(bundle);
  const mid2: any = (() => {
    const c: any = assembleMatch(createKit(bundle), fixture(), { seed: SEED, passives: PASSIVES, traceLevel: "FULL" });
    return c.battle;   // 只需要一份状态快照（开局即存）
  })();
  await mid2.runStartup();
  const snap = JSON.parse(JSON.stringify(captureState(mid2)));
  const noKit: any = restoreBattle(snap, {
    kit: undefined,                                   // ★ 调用方没给知识库（不是给了一个空的）
    makeRuntime: (id: number) => runtimeFor(kitD, id),
    attachRuntime,
  } as any);
  ok("★★★ 没有知识库时留下 SOUL_STATE_UNAVAILABLE（理由 NO_KIT）——「少装」必须看得见",
    noKit.trace.some((t: any) => t.t === "SOUL_STATE_UNAVAILABLE" && t.reason === "NO_KIT"),
    JSON.stringify(noKit.trace.filter((t: any) => t.t === "SOUL_STATE_UNAVAILABLE")));
  ok("★★ 而被动仍然装上了（它只需要 policies 与模块级 tips 表）",
    (noKit.passiveReport?.installed ?? []).length > 0, JSON.stringify(noKit.passiveReport?.installed?.length));
}

console.log("\ng86-g0-subscribers: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);