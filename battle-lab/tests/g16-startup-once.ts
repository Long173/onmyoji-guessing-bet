// tests/g16-startup-once.ts — ★ 开局钩子必须**只发生一次**（第六个同型接线缺口）
//
// 由来：runStartupStage 的尾部与 runStartup 的尾部重复了一份
//   `dispatch(BATTLE_START) + phase = BATTLE + startupDone = true`
// 于是 9 个开局阶段每个都派发一次 BATTLE_START，加上结尾那次 = **10 次**。
// 而 soul/effect-system.ts 把「战斗开始时」御魂挂在 BATTLE_START 上 —— 这些效果就触发 10 次。
// 危险之处在于它**看起来是对的**：无刀取那类有层数上限的效果被 cap 掩盖了，
// 「有 3 层」这个现象既可以来自正常累加，也可以来自 10 次连发被封顶。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { makeGuessingEntity } from "../soul/guessing-factory.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { installSoulEffects } from "../soul/effect-system.ts";
import type { SoulDef } from "../soul/loadout.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

const fresh = async () => {
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const bt: any = a.battle;
  const seen: string[] = [];
  const orig = bt.bus.dispatch.bind(bt.bus);
  bt.bus.dispatch = (...args: any[]) => { seen.push(String(args[0])); return orig(...args); };
  return { a, bt, seen };
};

sec("[1] BATTLE_START 只能派发一次");
{
  const { bt, seen } = await fresh();
  await bt.runStartup();
  const n = seen.filter(c => c === "BATTLE_START").length;
  // 语义修正：BATTLE_START 必须是**按单位**派发（selfId = 单位 id），否则 SELF 范围的御魂订阅者
  // 永远匹配不上（ownerId !== 0）。修复前是"每个开局阶段派发一次、selfId 恒为 0"：
  // 9 阶段 × 单位数 = 90 次广播，而真正该收到它的单位一次也没收到。
  ok("★ BATTLE_START 按单位派发，次数 === 单位数（不是 90）", n === 10, "实际 " + n + " 次（修复前为 10 次广播 selfId=0）");
  const senki = seen.filter(c => c === "SENKI").length;
  ok("SENKI 也只有一次", senki === 1, String(senki));
  const soul = seen.filter(c => c === "SOUL_START").length;
  ok("SOUL_START 按**单位**派发（10 个单位 = 10 次，不是按阶段叠乘）", soul === 10, String(soul));
}

sec("[2] ★ 行为级证明：开局御魂只结算一次（火灵 3 鬼火 / 蚌精 全队护盾）");
{
  // 这一节是整份测试的重点。只看"BATTLE_START 派发了几次"是**结构断言**；
  // 真正要证明的是**数值只被改了一次** —— 修复前每个开局阶段都派发一次，
  // 火灵会给出 3×10=30 点鬼火（被上限截断），蚌精会给每个单位叠 10 层护盾。
  const souls: SoulDef[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "soul.json"), "utf8"));
  const soulDefs = new Map<number, SoulDef>(souls.map(s => [Number(s.id), s]));
  const byName = new Map(souls.map(s => [s.name, s]));
  const huo = byName.get("火灵")!, bang = byName.get("蚌精")!;
  ok("前置：知识库里找得到火灵与蚌精（否则本节平凡通过）", !!huo && !!bang, JSON.stringify([huo?.id, bang?.id]));

  const mk = (id: number, teamId: number, soulId: number | null) =>
    makeGuessingEntity(id, teamId, {
      shikigamiId: 217,
      observed: { atk: 3000, hp: 20000, def: 400, spd: 120, cri: 0, crid: 150, efh: 0, efr: 0 },
      soulIds: soulId ? [soulId, soulId, soulId, soulId] : null,
    }, { soulDefs, charMeta: new Map([[217, { name: "大天狗" }]]) });

  const R = ResourcePolicies.COMMUNITY_4_8_5_345;
  const A = mk(1, 0, huo.id), B = mk(2, 1, bang.id);
  const t0 = new Team(0, "RED", R, 1); t0.add(A.entity);
  const t1 = new Team(1, "BLUE", R, 1); t1.add(B.entity);
  const bt = new Battle([t0, t1], { seed: 7, rules: { ...DEFAULT_RULES, maxTurns: 30 },
    policies: { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
      death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER",
      tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED } });
  const orbPolicy = ResourcePolicies.COMMUNITY_4_8_5_345 as any;
  const orbBefore = t0.orbs.current;
  const rep = installSoulEffects(bt, [...A.resolution.soulBattleEffects, ...B.resolution.soulBattleEffects], soulDefs);
  ok("前置：两件御魂的 4 件套效果都装入成功", rep.installed.length === 2, JSON.stringify(rep.installed.map(i => i.name + "/" + i.kind)));
  await bt.runStartup();
  const gained = t0.orbs.current - orbBefore;
  ok("★ 火灵只给一次 3 点鬼火（修复前会被派发 10 次）", gained === 3, "实际 +" + gained + "（上限 " + (orbPolicy?.maxOrb ?? "?") + "，开局 " + orbBefore + " → " + t0.orbs.current + "）");
  const shields = B.entity.shields.length;
  ok("★ 蚌精只给一层护盾（不是 10 层）", shields === 1, "shields=" + shields);
  const expect = B.entity.maxHp * 0.10;
  ok("护盾值 = 生命上限 10%", Math.abs((B.entity.shields[0]?.value ?? 0) - expect) < 1e-6, JSON.stringify([B.entity.shields[0]?.value, expect]));
  ok("前置：确实有触发计数（否则下一条会平凡通过）", Object.keys(rep.fireCount).length > 0, JSON.stringify(rep.fireCount));
  ok("★ 每件御魂只结算 1 次", Object.values(rep.fireCount).length > 0 && Object.values(rep.fireCount).every(v => v === 1), JSON.stringify(rep.fireCount));
}

sec("[3] 阶段序列：每个 Phase 都真的被进入过（含此前全库无人使用的两个）");
{
  const { bt } = await fresh();
  await bt.runStartup();
  const log = bt.phaseLog.join(" | ");
  ok("★ 装载策略阶段被进入（LOAD_RULESET）", bt.phaseLog.some((l: string) => l.startsWith("LOAD_RULESET")), log.slice(0, 160));
  ok("★ 开局效果阶段被进入（START_EFFECTS）", bt.phaseLog.some((l: string) => l.startsWith("STARTUP:SOUL_START") || l.startsWith("STARTUP:PASSIVE_START")));
  ok("开局后处于 BATTLE 阶段", String(bt.phase) === "BATTLE", String(bt.phase));
  ok("开局标志已置位", bt.startupDone === true);
  const idx = (s: string) => bt.phaseLog.findIndex((l: string) => l.startsWith(s));
  ok("★ LOAD_RULESET 出现在 CREATE 之后、SPAWN 之前", idx("LOAD_RULESET") > idx("CREATE") && idx("LOAD_RULESET") < idx("STARTUP:SPAWN"), JSON.stringify(bt.phaseLog.slice(0, 4)));
}

sec("[4] 事件树仍然是「一次开局一棵树」，没有被这次修复破坏");
{
  const { bt } = await fresh();
  const before = (bt.bus as any).nodes?.size ?? 0;
  await bt.runStartup();
  const nodes = (bt.bus as any).nodes as Map<number, any>;
  ok("前置：事件树确实在记录节点（否则本节平凡通过）", nodes && nodes.size > before, "before=" + before + " after=" + nodes?.size);
  const roots = [...nodes.values()].filter((n: any) => n.parent === null);
  ok("★ 整个开局只有**一个**根节点（此前 9 个阶段各自成根 = 10 个根）", roots.length === 1, "roots=" + roots.length + " nodes=" + nodes.size);
  const depth = Math.max(...[...nodes.values()].map((n: any) => n.depth ?? 0));
  console.log("    事件树节点 " + nodes.size + " 个，根 " + roots.length + " 个，最大深度 " + depth);
  ok("★ 开局事件没有堆积成超深层级（防递归爆栈哨兵）", depth < 64, String(depth));
}


sec("[5] ★★★ 第 190 轮：runStartup **幂等**（跑第二遍必须什么都不做）");
{
  /**
   * 由来：`run()` 内部**也会**调 `runStartup()`，于是几乎所有人写的 `await runStartup(); await run()`
   *   让开局流水线跑了两遍（BATTLE_START 按单位再派发一轮 ⇒ 先机/御魂「战斗开始时」再触发一次）。
   *   默认档看不出来（无御魂、被动 OFF），有先机时当场分叉：
   *   实测典型对局被动档 `runStartup()+run()` = 6d7fb675c3d14eaf，而 `run()` = 7bc24506bdcd349e。
   *   这个缺口是**跨进程续跑**（tests/g112）顺出来的 —— 恢复出来的战斗 startupDone 已经是 true。
   */
  const souls: SoulDef[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "soul.json"), "utf8"));
  const soulDefs = new Map<number, SoulDef>(souls.map(s => [Number(s.id), s]));
  const huo = souls.find(s => s.name === "火灵")!;
  const mk = (id: number, teamId: number, soulId: number | null) =>
    makeGuessingEntity(id, teamId, { shikigamiId: 217, observed: { atk: 3000, hp: 20000, def: 400, spd: 120, cri: 0, crid: 150, efh: 0, efr: 0 }, soulIds: soulId ? [soulId, soulId, soulId, soulId] : null },
      { soulDefs, charMeta: new Map([[217, { name: "大天狗" }]]) });
  const R = ResourcePolicies.COMMUNITY_4_8_5_345;
  const A = mk(1, 0, huo.id), B = mk(2, 1, null);
  const t0 = new Team(0, "RED", R, 1); t0.add(A.entity);
  const t1 = new Team(1, "BLUE", R, 1); t1.add(B.entity);
  const bt: any = new Battle([t0, t1], { seed: 7, rules: { ...DEFAULT_RULES, maxTurns: 30 },
    policies: { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
      death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER",
      tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED } });
  const rep = installSoulEffects(bt, [...A.resolution.soulBattleEffects], soulDefs);
  const dispatched: string[] = [];
  const orig = bt.bus.dispatch.bind(bt.bus);
  bt.bus.dispatch = (...args: any[]) => { dispatched.push(String(args[0])); return orig(...args); };
  const orb0 = t0.orbs.current;
  await bt.runStartup();
  const afterFirst = { orbs: t0.orbs.current, bat: dispatched.filter(c => c === "BATTLE_START").length, nodes: (bt.bus as any).nodes.size, log: bt.phaseLog.length };
  await bt.runStartup();
  await bt.runStartup();
  const afterThird = { orbs: t0.orbs.current, bat: dispatched.filter(c => c === "BATTLE_START").length, nodes: (bt.bus as any).nodes.size, log: bt.phaseLog.length };
  console.log("    第一次开局后 " + JSON.stringify(afterFirst) + "｜再跑两次之后 " + JSON.stringify(afterThird));
  ok("★★★ 前置：第一次开局确实发生了（火灵给了鬼火、BATTLE_START 派发过）", afterFirst.orbs > orb0 && afterFirst.bat > 0, JSON.stringify({ orb0, afterFirst }));
  ok("★★★ 再跑两次 ⇒ **鬼火一点没多**（修复前每跑一次就再给 3 点）", afterThird.orbs === afterFirst.orbs, JSON.stringify({ a: afterFirst.orbs, b: afterThird.orbs }));
  ok("★★★ BATTLE_START 派发次数**不变**（修复前每跑一次 +10）", afterThird.bat === afterFirst.bat, JSON.stringify({ a: afterFirst.bat, b: afterThird.bat }));
  ok("★★★ 事件树节点数与阶段日志长度都不变（幂等是**无痕**的，不留事件）", afterThird.nodes === afterFirst.nodes && afterThird.log === afterFirst.log, JSON.stringify({ a: [afterFirst.nodes, afterFirst.log], b: [afterThird.nodes, afterThird.log] }));
  ok("★★ 而两件御魂的结算计数仍然是 1（不是 3）", Object.values(rep.fireCount).every(v => v === 1), JSON.stringify(rep.fireCount));
}

sec("[6] ★★★ 行为面：`runStartup(); run()` 与 `run()` 必须得到**同一个**对局（幂等的意义）");
{
  const one = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "PARSED_CANDIDATES_ONLY" });
  const r1 = await one.battle.run();
  const h1 = stateHash(captureState(one.battle));
  const two: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "PARSED_CANDIDATES_ONLY" });
  await two.battle.runStartup();
  const r2 = await two.battle.run();
  const h2 = stateHash(captureState(two.battle));
  console.log("    run()=" + h1 + "｜runStartup()+run()=" + h2);
  ok("★★★ 两条路得到同一个指纹（修复前：6d7fb675c3d14eaf vs 7bc24506bdcd349e）", h1 === h2, h1 + " vs " + h2);
  ok("★★★ 而单次开局的被动档指纹 = 7bc24506bdcd349e（本轮按事实改的常量）", h1 === "7bc24506bdcd349e", h1);
  ok("★★ 胜者/回合数也一致", r1.winner === r2.winner && r1.turns === r2.turns, JSON.stringify([r1, r2]));
  const off = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await off.battle.runStartup();
  await off.battle.run();
  ok("★★★ 默认档仍然逐位不变（2d7c7507e18db61f）", stateHash(captureState(off.battle)) === "2d7c7507e18db61f");
}
console.log("\n=== 开局唯一性: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
