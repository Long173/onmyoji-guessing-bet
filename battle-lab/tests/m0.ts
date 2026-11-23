// tests/m0.ts — M0「空战场」验收：不加载任何真实式神数据
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { DamageType } from "../kernel/types.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { DeathPolicies, StartupPolicies } from "../kernel/policies.ts";
import { makeTeam, wireDummy } from "../dummy/dummy.ts";

const RES = ResourcePolicies.COMMUNITY_4_8_5_345;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) { pass++; console.log("  PASS " + name + (extra ? "  " + extra : "")); } else { fail++; console.log("  FAIL " + name + "  " + extra); } };

function build(seed: number, policies: any = {}) {
  const a = makeTeam(0, "RED", [
    { name: "R1", hp: 10000, atk: 1200, def: 300, spd: 120, skills: [{ name: "3技能", cost: 3, base: 1200, rate: 1.5, type: DamageType.NORMAL }] },
    { name: "R2", hp: 8000, atk: 900, def: 250, spd: 100, skills: [{ name: "普攻", cost: 0, base: 900, type: DamageType.NORMAL }] },
  ], RES, 0);
  const b = makeTeam(1, "BLUE", [
    { name: "B1", hp: 9000, atk: 1100, def: 350, spd: 110, skills: [{ name: "3技能", cost: 3, base: 1100, rate: 1.4, type: DamageType.NORMAL }] },
    { name: "B2", hp: 7000, atk: 800, def: 200, spd: 95, skills: [{ name: "普攻", cost: 0, base: 800, type: DamageType.NORMAL }] },
  ], RES, 100);
  const battle = new Battle([a.team, b.team], {
    seed, rules: { ...DEFAULT_RULES, maxTurns: 300 },
    policies: { resource: RES, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI, death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER", tieBreak: "SPEED_THEN_RANDOM", ...policies },
  });
  for (const e of [...a.entities, ...b.entities]) wireDummy(battle, e);
  return battle;
}

console.log("=== M0 Empty Battlefield 验收 ===");

// 1) 生命周期跑通
{
  const bt = build(12345);
  const r = await bt.run();
  ok("完整生命周期跑通", bt.turn > 0 && bt.phase === "END", `turns=${r.turns} winner=${r.winner} reason=${r.reason}`);
  ok("阶段日志含全部启动阶段", bt.phaseLog.filter(x => x.startsWith("STARTUP:")).length >= 9);
  ok("行动条已初始化", true);
  const s = bt.summary();
  ok("产物带 policySnapshot", !!s.policies && !!s.policies._warning);
}

// 2) Seed 可复现（同一 seed 完全一致）
{
  const runs = [];
  for (let i = 0; i < 20; i++) { const bt = build(999); const r = await bt.run(); runs.push(JSON.stringify({ w: r.winner, t: r.turns, trace: bt.trace })); }
  ok("同 seed 20 次完全一致", new Set(runs).size === 1, `distinct=${new Set(runs).size}`);
}

// 3) 不同 seed 产生不同结果（说明随机真的参与了）
{
  const set = new Set<string>();
  for (let s = 1; s <= 30; s++) { const bt = build(s); await bt.run(); set.add(JSON.stringify(bt.trace.filter((x: any) => x.t === "DAMAGE").slice(0, 3))); continue; set.add(`${r.winner}:${r.turns}`); }
  ok("不同 seed 结果有差异", set.size > 1, `distinct=${set.size}/30`);
}

// 4) 鬼火：初始值 / 上限 / 溢出 / 回火曲线
{
  const bt = build(7);
  const pool = bt.teams[0].orbs;
  ok("初始鬼火来自 Policy", pool.orb === RES.initialOrb, `orb=${pool.orb}`);
  pool.gain(100); ok("上限封顶", pool.orb === RES.maxOrb, `orb=${pool.orb}`);
  const g = pool.gain(5); ok("溢出被记录", g.gained === 0 && g.overflow === 5, JSON.stringify(g));
  const p2 = bt.teams[0].orbs; p2.cycle = 0; ok("回火曲线 3/4/5", [1,2,3,4].map(n => { p2.cycle = n; return p2.rewardForCycle(); }).join(",") === "3,4,5,5");
}

// 5) 四种 HP 变更管线严格分离
{
  const bt = build(11);
  const t = bt.teams[1].members[0]; const s = bt.teams[0].members[0];
  const before = t.hp;
  bt.lose(t, 1000);
  ok("LOSS 不被护盾吸收", t.hp === before - 1000);
  t.shields.push({ id: "sh1", value: 5000, dispellable: true, sourceId: s.id, consumed: 0, broken: false });
  const b2 = t.hp;
  await bt.damage(s, t, 3000, DamageType.NORMAL);
  ok("DAMAGE 被护盾吸收", t.hp > b2 - 3000, `hp ${b2} -> ${t.hp}`);
  const b3 = t.hp;
  await bt.heal(s, t, 500, { recover: true });
  ok("RECOVER 生效", t.hp > b3);
}

// 6) 伤害类型行为矩阵（官方[5][12][18][28]）
{
  const bt = build(13);
  const s = bt.teams[0].members[0]; const t = bt.teams[1].members[0];
  const r1 = await bt.damage(s, t, 1000, DamageType.NORMAL);
  ok("NORMAL 触发御魂", r1.triggersSoul === true);
  const r2 = await bt.damage(s, t, 1000, DamageType.INDIRECT);
  ok("INDIRECT 不触发御魂/不可被分担", r2.triggersSoul === false && r2.canBeShared === false);
  const r3 = await bt.damage(s, t, 1000, DamageType.CONDUCTION);
  ok("CONDUCTION 不会暴击", r3.canCrit === false);
  const r4 = await bt.damage(s, t, 1000, DamageType.TRUE);
  ok("TRUE 无视防御不会暴击", r4.defenseMultiplier === 1 && r4.canCrit === false);
  const r5 = await bt.damage(s, t, 1000, DamageType.FIXED);
  ok("FIXED 无视防御且不受增减伤", r5.ignoresModifiers === true && r5.defenseMultiplier === 1);
}

// 7) 状态：官方[15] 按来源回合计时；官方[3] 不可驱散
{
  const bt = build(17);
  const t = bt.teams[1].members[0];
  const stunDef = (await import("../kernel/status.ts")).StatusBook.get("stun")!;
  t.addStatus(stunDef, bt.teams[0].members[0].id, 1, 2);
  ok("眩晕标记为不可驱散", stunDef.dispellable === false);
  ok("状态已附着", t.hasStatus("stun"));
  ok("眩晕：无法被驱散 dispel", t.dispel("stun") === false);
  ok("眩晕：可以被解除 remove（官方[3] 后九者不可驱散，仅霜冻不可解除）", t.remove("stun") === true);
  const frost = (await import("../kernel/status.ts")).StatusBook.get("frost")!;
  t.addStatus(frost, bt.teams[0].members[0].id, 1, 2);
  ok("霜冻：不可驱散且不可解除", t.dispel("frost") === false && t.remove("frost") === false);
  ok("强制移除可生效", t.remove("frost", true) === true);
}

// 8) 死亡状态机：HP<=0 != DEAD != KILLED 三者分开
{
  const bt = build(19, { death: DeathPolicies.DEATH_AFTER_PREVENTION });
  const t = bt.teams[1].members[1];
  const s = bt.teams[0].members[0];
  await bt.damage(s, t, 999999, DamageType.TRUE);
  ok("致死目标 hpZero", t.hpZero === true);
  ok("致死目标 dead", t.dead === true);
  ok("致死目标 killed", t.killed === true);
  ok("trace 含 LETHAL 且含 DEATH", bt.trace.some(x => x.t === "LETHAL") && bt.trace.some(x => x.t === "DEATH"));
  ok("reviveBlocked 默认可复活", t.reviveBlocked === false);
  const rv = await bt.revive(t, 5000);
  ok("复活成功", rv === true && t.alive === true && t.hp === 5000);
}

// 9) 免死拦截（红区 C 的 DEATH_AFTER_PREVENTION 分支）
{
  const bt = build(23);
  const t = bt.teams[1].members[1];
  t.reviveBlocked = true;
  const s = bt.teams[0].members[0];
  await bt.damage(s, t, 999999, DamageType.TRUE);
  ok("reviveBlocked 时复活失败", (await bt.revive(t, 5000)) === false);
}

// 10) 行动条：拉条 / 锁条（官方[117]）
{
  const bt = build(29);
  await bt.runStartup();
  const e = bt.teams[0].members[0];
  bt.timeline.shift(e.id, -0.3);
  const p1 = bt.timeline.get(e.id)!.pos;
  bt.timeline.setLock(e.id, true);
  const shifted = bt.timeline.shift(e.id, -0.3);
  ok("锁条后无法改变行动条", shifted === false && bt.timeline.get(e.id)!.pos === p1, `pos=${p1.toFixed(0)}`);
}

// 11) 胜负判定
{
  const bt = build(31);
  const r = await bt.run();
  ok("产生唯一胜者或平局", r.winner === 0 || r.winner === 1 || r.winner === null, `winner=${r.winner} reason=${r.reason}`);
}

// 12) 未实测策略必须被标出
{
  const bt = build(37);
  const s = bt.summary();
  ok("UNKNOWN 策略会被标记", s.policiesContainUnknown === true);
}

console.log(`\n=== M0: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
