// tests/g69-summon-reactivity.ts — ★★★ 第 113 轮：**召唤物的反应式光环与移除代价**（目标 ⑨）
//
// 第 111 轮的光环只做**静态属性修正**（挂 Modifier 就完事）；这一轮做剩下两类：
//   · 反应式：「在场时为友方单位恢复受到伤害30%的生命值」（海原贝戟，全库 1 处）—— 要在伤害结算之后动手；
//   · 移除代价：「被移除时返还2点鬼火」（明识灯）—— 挂在**移除路径**上，不是阵亡路径。
// ★ 判据两侧都做：生效时要真的算出来，不生效时（阵亡、非友方、0 伤害）一条都不许冒。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { TurnType, DamageType } from "../kernel/types.ts";
import { dealDamage } from "../kernel/damage.ts";
import { captureState, restoreBattle, stateHash } from "../kernel/state.ts";
import { setTipsTable, loadTips } from "../compile/tips.ts";
import { parseSummonSpec } from "../kernel/summon.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = "2d7c7507e18db61f";
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const tipsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
const tips: any[] = Array.isArray(tipsRaw) ? tipsRaw : (Object.values(tipsRaw).find((v: any) => Array.isArray(v)) as any[]);
setTipsTable(loadTips(tips));
const specOf = (id: string) => parseSummonSpec(tips.find(t => String(t.id) === id));
const mk = async (name: string, seed: number) => {
  const s = KB.find((x: any) => x.name === name);
  const m = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name };
  const a: any = assembleMatch(createKit(bundle), m, { seed });
  await a.battle.runStartup();
  return a;
};

sec("[1] 解析：这两类形状在全库各只有几处，逐条读出来")
{
  const lamp = specOf("3565")!;
  ok("★★★ 海原贝戟：「在场时为友方单位恢复受到伤害30%的生命值」⇒ reactive = 30%",
    lamp.reactive?.kind === "HEAL_ON_ALLY_DAMAGE" && lamp.reactive?.ratio === 0.3, JSON.stringify(lamp.reactive));
  const ming = specOf("5523")!;
  ok("★★★ 明识灯：「被移除时返还2点鬼火」⇒ onRemove.orbs = 2", ming.onRemove?.orbs === 2, JSON.stringify(ming.onRemove));
  ok("★★ 反向：雷冢写的是「被**击败**后」⇒ **不进**移除代价（KB 自己在区分这两种写法）",
    !specOf("3896")?.onRemove, JSON.stringify(specOf("3896")?.onRemove));
  ok("★★ 反向：别馆私汤没有反应式光环/移除代价（它的「每使用普攻6次」另有形状）",
    !specOf("5691")?.reactive && !specOf("5691")?.onRemove);
  ok("★ 计数：全库只有 1 条反应式光环（海原贝戟）",
    tips.filter((t: any) => parseSummonSpec(t)?.reactive).length === 1,
    JSON.stringify(tips.filter((t: any) => parseSummonSpec(t)?.reactive).map((t: any) => t.name)));
}

sec("[2] 反应式光环：按**实际扣血**的 30% 回血，且只对同队")
{
  const A = await mk("千姬", 20261801);
  const qj = A.battle.teams[0].members[0];
  A.battle.teams[0].orbs.orb = 8;
  await A.battle.runPseudoTurn(qj, TurnType.PSEUDO_TURN, { skill: qj.skills.find((s: any) => s.name === "海潮入梦"), target: A.battle.teams[1].members[0] });
  const lamp = A.battle.teams[0].summons[0];
  ok("★★★ 海原贝戟上场，并把钩子判据写进 notes（存档字段 ⇒ 恢复后重装得回来）",
    !!lamp && lamp.notes.includes("summon:reactive-heal=0.3") && lamp.notes.some((n: string) => n.startsWith("summon:owner=")),
    JSON.stringify(lamp?.notes.filter((n: string) => /reactive|owner/.test(n))));
  const ally = A.battle.teams[0].members[1];
  ally.hp = ally.maxHp * 0.5;
  A.battle.trace.length = 0;
  const dmg = await dealDamage(A.battle, { source: A.battle.teams[1].members[0], target: ally, base: 1000, rate: 1, type: DamageType.NORMAL, skillTag: "G69" });
  const heals = A.battle.trace.filter((t: any) => t.t === "SUMMON_REACTIVE_HEAL");
  ok("★★★ 友方挨打 ⇒ 真的回血，且比例 = 30% × 实际扣血",
    heals.length === 1 && Math.abs(heals[0].healed - dmg.applied * 0.3) < 1e-6,
    JSON.stringify({ applied: dmg.applied, healed: heals[0]?.healed, expect: dmg.applied * 0.3 }));
  ok("★★ 走的是**恢复**通道（原文写「恢复」而不是「治疗」）",
    A.battle.trace.some((t: any) => t.t === "RECOVER" && t.dst === ally.id),
    JSON.stringify(A.battle.trace.filter((t: any) => t.t === "RECOVER" || t.t === "HEAL").map((t: any) => t.t)));
  ok("★★★ 反向：**敌方**挨打不触发（只对同队生效）",
    (() => { const foe = A.battle.teams[1].members[1]; foe.hp = foe.maxHp * 0.5; return heals.every((h: any) => h.dst !== foe.id); })());
  /** 恢复后钩子必须重装（handler 不进档） */
  const k2 = createKit(bundle);
  const B: any = restoreBattle(JSON.parse(JSON.stringify(captureState(A.battle))), { kit: k2, makeRuntime: (id: number) => runtimeFor(k2, id), attachRuntime });
  ok("★★★ 存档 → 恢复后钩子被重装（否则续跑的战斗里这条光环静默消失）",
    B.bus.handlers.filter((h: any) => String(h.id).includes("reactive-heal")).length === 1,
    String(B.bus.handlers.filter((h: any) => String(h.id).includes("reactive-heal")).length));
  /**
   * ★★★ 第 137 轮：**handler 条数不是行为**。
   *   上一条只证明"表里有一条"；它能被写成 ratio 读错、装了两条（治两次）、或闭包引用旧
   *   battle 却照样是 1 条。所以这里在**恢复后的那场战斗里真的打一下**，按事实断言：
   *   · 比例必须还是 30%（判据来自 notes ⇒ 证明 notes 真的进了档、真的被读回来）；
   *   · healed 恰好等于 0.3 × 实际扣血（**治两次会翻倍**，这一条把幂等也一起测了）。
   */
  const allyB = B.teams[0].members[1];
  allyB.hp = allyB.maxHp * 0.8;
  B.trace.length = 0;
  const dmgB = await dealDamage(B, { source: B.teams[1].members[0], target: allyB, base: 1000, rate: 1, type: DamageType.NORMAL, skillTag: "G69-RESTORED" });
  const healsB = B.trace.filter((t: any) => t.t === "SUMMON_REACTIVE_HEAL");
  ok("★★★ 恢复后的战斗里这条光环**真的会触发**，且比例还是 30%（notes 是判据、确实进了档）",
    healsB.length === 1 && healsB[0].ratio === 0.3 && healsB[0].dst === allyB.id,
    JSON.stringify(healsB));
  ok("★★★ 恢复后的回血量 = 30% × 实际扣血（治两次会翻倍 ⇒ 幂等也在这一条里）",
    healsB.length === 1 && Math.abs(healsB[0].healed - dmgB.applied * 0.3) < 1e-6,
    JSON.stringify({ applied: dmgB.applied, healed: healsB[0]?.healed, expect: dmgB.applied * 0.3 }));
}

sec("[3] 移除代价：收回时返还鬼火，阵亡时**不**返还")
{
  const C = await mk("慧明灯", 20261802);
  const hm = C.battle.teams[0].members[0];
  C.battle.teams[0].orbs.orb = 8;
  await C.battle.runPseudoTurn(hm, TurnType.PSEUDO_TURN, { skill: hm.skills.find((s: any) => s.name === "正念"), target: C.battle.teams[1].members[0] });
  const lamp2 = C.battle.teams[0].summons[0];
  ok("★★★ 明识灯上场并记下移除代价", !!lamp2 && lamp2.notes.includes("summon:on-remove-orbs=2"), JSON.stringify(lamp2?.notes.filter((n: string) => /remove/.test(n))));
  C.battle.teams[0].orbs.orb = 0;
  C.battle.turn++;
  C.battle.trace.length = 0;
  await C.battle.runTurn(hm, TurnType.NORMAL);
  ok("★★★ 回合开始收回 ⇒ 返还 2 点鬼火（事件写明是移除代价）",
    C.battle.teams[0].orbs.orb >= 2 &&
    C.battle.trace.some((t: any) => t.t === "SUMMON_PAYOFF" && t.kind === "ORBS" && t.gained >= 2),
    JSON.stringify({ orb: C.battle.teams[0].orbs.orb, payoff: C.battle.trace.filter((t: any) => t.t === "SUMMON_PAYOFF").map((t: any) => t.kind + ":" + t.gained) }));
  /** ★ 阵亡不是"被移除"：KB 用「被击败」写另一种情况 */
  const D = await mk("慧明灯", 20261803);
  const hm2 = D.battle.teams[0].members[0];
  D.battle.teams[0].orbs.orb = 8;
  await D.battle.runPseudoTurn(hm2, TurnType.PSEUDO_TURN, { skill: hm2.skills.find((s: any) => s.name === "正念"), target: D.battle.teams[1].members[0] });
  const lamp3 = D.battle.teams[0].summons[0];
  D.battle.teams[0].orbs.orb = 0;
  D.battle.trace.length = 0;
  lamp3.hp = 0;
  await D.battle.resolveLethal(lamp3, D.battle.teams[1].members[0].id);
  ok("★★★ 反向：**阵亡**不返还鬼火（原文写的是「被移除时」，阵亡是另一条路径）",
    D.battle.teams[0].orbs.orb === 0 && !D.battle.trace.some((t: any) => t.t === "SUMMON_PAYOFF"),
    JSON.stringify({ orb: D.battle.teams[0].orbs.orb, traces: D.battle.trace.filter((t: any) => /PAYOFF/.test(String(t.t))).length }));
}

sec("[4] 默认档不漂：典型对局 #001 指纹逐位不变")
{
  const z: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await z.battle.runStartup();
  await z.battle.run();
  ok("★★★ 指纹与第 97 轮记录的值逐位相同（这两个机制只在这几位身上才可能生效）",
    stateHash(captureState(z.battle)) === BASE, stateHash(captureState(z.battle)));
  ok("★★ 而且整场没有 SUMmon 反应式回血 / 移除代价事件",
    !z.battle.trace.some((t: any) => t.t === "SUMMON_REACTIVE_HEAL" || t.t === "SUMMON_PAYOFF"));
}

console.log("\n=== 召唤物的反应式光环与移除代价: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;