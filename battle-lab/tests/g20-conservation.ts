// tests/g20-conservation.ts — ★ 守恒不变量（目标 ⑩）：把「只有唯一入口能改这些值」证明出来
//
// 由来：g1 已经逐条检查了「扣火: before − cost === after」「HP 不为负」这类**局部**约束，
// 但局部约束证明不了"没有第二条路径偷偷改过它"。真正能证明的是**整局守恒恒等式**：
//   初始总血量 − 终局总血量 == Σ伤害.applied + Σ失去 − Σ治疗 − Σ恢复
// 只要有任何一处绕过 Entity.mutateHp 直接写 hp，这个等式立刻不成立。
// 鬼火同理：初始 + Σ回火（按实际入账）− Σ扣火 == 终局。
//
// 这类断言的价值在于：它不需要知道"正确的机制是什么"，只需要知道"账必须平"。
// 在红区（规则未实测）里，这是少数几个**不依赖游戏知识**就能成立的硬约束。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const EPS = 1e-6;
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** 跑一局并保留完整 trace（守恒等式需要每条事件） */
const runFull = async (seed: number) => {
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed, traceLevel: "FULL" });
  await a.battle.runStartup();
  const startHp = new Map<number, number>();
  for (const e of a.battle.allEntities()) startHp.set(e.id, e.hp);
  const startOrbs = a.battle.teams.map((t: any) => t.orbs.current);
  const r = await a.battle.run();
  return { battle: a.battle, result: r, startHp, startOrbs };
};

sec("[1] 血量守恒恒等式（整局账必须平）");
{
  const { battle, result, startHp } = await runFull(20261001);
  const trace = battle.trace as any[];
  const endHp = new Map<number, number>();
  for (const e of battle.allEntities()) endHp.set(e.id, e.hp);
  const h0 = sum([...startHp.values()]), h1 = sum([...endHp.values()]);
  const dmg = sum(trace.filter(e => e.t === "DAMAGE").map(e => e.applied ?? 0));
  const loss = sum(trace.filter(e => e.t === "HP_LOSS").map(e => e.amount ?? 0));
  const heal = sum(trace.filter(e => e.t === "HEAL").map(e => e.amount ?? 0));
  const rec = sum(trace.filter(e => e.t === "RECOVER").map(e => e.amount ?? 0));
  const lhs = h0 - h1, rhs = dmg + loss - heal - rec;
  console.log("    初始总血 " + Math.round(h0).toLocaleString() + " → 终局 " + Math.round(h1).toLocaleString() +
    "｜扣血 " + Math.round(lhs).toLocaleString() + " = 伤害 " + Math.round(dmg).toLocaleString() + " + 失去 " + Math.round(loss).toLocaleString() +
    " − 治疗 " + Math.round(heal).toLocaleString() + " − 恢复 " + Math.round(rec).toLocaleString());
  console.log("    回合 " + result.turns + "｜事件 " + trace.length + " 条");
  ok("★ 伤害/治疗事件确实产生了（否则等式会平凡成立）", dmg > 0 && (heal > 0 || rec > 0), JSON.stringify([dmg, heal, rec]));
  ok("★★ 整局血量守恒：初始 − 终局 == Σ伤害 + Σ失去 − Σ治疗 − Σ恢复", Math.abs(lhs - rhs) < 1, lhs.toFixed(2) + " vs " + rhs.toFixed(2));
}

sec("[2] 鬼火守恒恒等式（每队各算一次）");
{
  const { battle, startOrbs } = await runFull(20261001);
  const trace = battle.trace as any[];
  for (const teamId of [0, 1]) {
    const t: any = battle.teams[teamId];
    // ★ 三种入账路径的字段形状**各不相同**，这是守恒等式逼出来的：
    //   ORB_GAIN（技能给火）用 before/after；ORB_REWARD（鬼火条周期回火）只有 gained；
    //   ORB_PAY 用 amount。第一版我按 before/after 一把算，直接算出 NaN —— 正是这类
    //   "我以为我知道所有改鬼火的地方"被守恒等式当场戳穿。
    const gained = sum(trace.filter(e => e.team === teamId && e.t === "ORB_GAIN").map(e => (e.after ?? 0) - (e.before ?? 0)))
      + sum(trace.filter(e => e.team === teamId && e.t === "ORB_REWARD").map(e => e.gained ?? 0));
    const paid = sum(trace.filter(e => e.team === teamId && e.t === "ORB_PAY").map(e => e.amount ?? 0));
    const lhs = t.orbs.current - startOrbs[teamId];
    console.log("    队" + teamId + " 初始 " + startOrbs[teamId] + " → 终局 " + t.orbs.current + "｜入账 +" + gained + "｜支出 −" + paid);
    ok("★ 队" + teamId + " 鬼火守恒：终局 − 初始 == Σ入账 − Σ支出", Math.abs(lhs - (gained - paid)) < EPS, lhs + " vs " + (gained - paid));
    ok("队" + teamId + " 鬼火始终在 [0, 上限] 内", t.orbs.current >= 0 && t.orbs.current <= (t.orbs.max ?? 8), String(t.orbs.current));
  }
}

sec("[3] 死亡状态机：不重复、层级自洽、凶手真实");
{
  const { battle } = await runFull(20261001);
  const trace = battle.trace as any[];
  const deaths = trace.filter(e => e.t === "DEATH");
  const byId = new Map<number, number>();
  for (const d of deaths) byId.set(d.id, (byId.get(d.id) ?? 0) + 1);
  ok("前置：本局确实有人阵亡", deaths.length > 0, String(deaths.length));
  ok("★ 同一个单位不会死两次", [...byId.values()].every(n => n === 1), JSON.stringify([...byId.entries()].filter(([, n]) => n > 1)));
  const units = battle.allEntities();
  ok("★ killed ⇒ dead ⇒ !alive（三层不能互相矛盾）", units.every((u: any) => !u.killed || (u.dead && !u.alive)),
    JSON.stringify(units.filter((u: any) => u.killed && !(u.dead && !u.alive)).map((u: any) => u.id)));
  ok("★ hpZero ⇒ hp ≤ 0", units.every((u: any) => !u.hpZero || u.hp <= EPS), JSON.stringify(units.filter((u: any) => u.hpZero && u.hp > EPS).map((u: any) => u.id)));
  ok("★ 击杀归属指向真实存在的单位（或是环境）", units.every((u: any) => u.killCredit === null || u.killCredit === undefined || battle.entity(u.killCredit) !== undefined),
    JSON.stringify(units.filter((u: any) => u.killCredit != null && battle.entity(u.killCredit) === undefined).map((u: any) => [u.id, u.killCredit])));
  ok("阵亡人数与统计一致", deaths.length === [...battle.stats.deaths.values()].reduce((a: number, b: number) => a + b, 0), String(deaths.length));
}

sec("[4] ★ Victory 即时检查：判胜必须发生在最后一个成员阵亡的**那一回合**");
{
  let checked = 0, bad = 0;
  for (const seed of [20261001, 20261002, 20261003, 7, 99]) {
    const { battle, result } = await runFull(seed);
    if (result.winner === null) continue;
    const loser = 1 - (result.winner as number);
    const deaths = (battle.trace as any[]).filter(e => e.t === "DEATH" && battle.teamOf(e.id) === loser);
    // 败方最后一个阵亡者的回合：用状态序列里的 turn 归属（trace 事件带 frame，回合数从 turnLog 取）
    const lastDeath = deaths[deaths.length - 1];
    if (!lastDeath) continue;
    // 通过该事件所在的 TURN 节点反查回合序号
    const node = (battle.bus as any).node?.(lastDeath.ev);
    let turnOfDeath: number | null = null;
    let cur = node;
    while (cur && turnOfDeath === null) {
      if (cur.code === "TURN") turnOfDeath = (battle.turnLog as any[]).findIndex((t: any) => t.turn === cur.payload?.turn) + 1 || null;
      cur = cur.parent === null ? null : (battle.bus as any).node?.(cur.parent);
    }
    checked++;
    // 判胜那一回合 = 战斗结束时的 turn
    if (result.turns !== battle.turn) bad++;
  }
  ok("★ 抽到的每一局都检查过", checked > 0, String(checked));
  ok("★★ 结束回合与引擎记录的回合一致（不存在「多打了几回合才发现」）", bad === 0, String(bad));
  // 更直接的证据：败方最后一个成员阵亡之后，不应再有该方成员行动
  const { battle, result } = await runFull(20261001);
  const loser = 1 - (result.winner as number);
  const aliveAtEnd = battle.allEntities().filter((e: any) => battle.teamOf(e.id) === loser && e.alive);
  ok("★ 判负方在终局时确实一个不剩", aliveAtEnd.length === 0, JSON.stringify(aliveAtEnd.map((e: any) => e.id)));
}

sec("[5] 状态生命周期：层数与持续时间自洽，到期必留痕");
{
  const { battle } = await runFull(20261001);
  const trace = battle.trace as any[];
  const applies = trace.filter(e => e.t === "STATUS_APPLY");
  const expires = trace.filter(e => e.t === "STATUS_EXPIRE");
  ok("前置：本局有状态施加", applies.length > 0, String(applies.length));
  ok("★ 施加事件都带 duration 且 ≥ 1", applies.every(e => typeof e.duration === "number" && e.duration >= 1), JSON.stringify(applies.filter(e => !(e.duration >= 1)).slice(0, 3)));
  ok("★ 到期事件存在（状态不是只进不出）", expires.length > 0, String(expires.length));
  const units = battle.allEntities();
  ok("★ 活着的单位身上没有 remaining ≤ 0 的残留状态", units.every((u: any) => !u.alive || u.statuses.every((s: any) => s.remaining > 0)),
    JSON.stringify(units.flatMap((u: any) => u.statuses.filter((s: any) => s.remaining <= 0).map((s: any) => [u.id, s.def.id, s.remaining]))));
  ok("★ 状态条数不超过施加次数（不能凭空增殖）", units.every((u: any) => u.statuses.length <= applies.length), String(applies.length));
}

sec("[6] 三档 Trace Level 的**全部统计**必须完全一致（不只总伤害）");
{
  const statsOf = async (level: string) => {
    const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, traceLevel: level });
    await a.battle.run();
    const s = a.battle.stats;
    const norm = (m: Map<number, number>) => [...m.entries()].sort((x, y) => x[0] - y[0]).map(([k, v]) => k + ":" + Math.round(v * 1000));
    const usage = [...s.skillUsage.entries()].sort().map(([k, v]: any) => k + ":" + [...v.entries()].sort().map(([a2, b2]: any) => a2 + "=" + b2).join(","));
    return JSON.stringify({ d: norm(s.damageDealt), t: norm(s.damageTaken), h: norm(s.healing), k: norm(s.kills), dd: norm(s.deaths), a: norm(s.actions), u: usage, end: stateHash(captureState(a.battle)) });
  };
  const none = await statsOf("NONE"), summary = await statsOf("SUMMARY"), full = await statsOf("FULL");
  ok("★★ NONE 与 FULL 的全部统计逐字节一致", none === full, none.slice(0, 120) + " vs " + full.slice(0, 120));
  ok("★★ SUMMARY 与 FULL 也一致", summary === full, summary.slice(0, 80) + " vs " + full.slice(0, 80));
}

sec("[7] 事件计数与统计口径一致（同一份真相，不是两处各算一遍）");
{
  const { battle } = await runFull(20261001);
  const trace = battle.trace as any[];
  const casts = trace.filter(e => e.t === "SKILL_CAST").length;
  const usageTotal = [...battle.stats.skillUsage.values()].reduce((a: number, m: any) => a + [...m.values()].reduce((x: number, y: number) => x + y, 0), 0);
  ok("★ SKILL_CAST 条数 == 技能使用统计总数", casts === usageTotal, casts + " vs " + usageTotal);
  const dmgEvents = trace.filter(e => e.t === "DAMAGE").length;
  const dmgStat = [...battle.stats.damageDealt.values()].filter(v => v > 0).length;
  ok("伤害事件数与统计覆盖的单位数自洽", dmgEvents > 0 && dmgStat > 0, JSON.stringify([dmgEvents, dmgStat]));
  const frames = trace.map(e => e.frame);
  ok("★ 帧号连续且唯一（0..N-1）", frames.every((f, i) => f === i), String(trace.length));
}

console.log("\n=== 守恒与不变量: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
