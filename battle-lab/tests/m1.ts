// tests/m1.ts — M1「第一只真实式神」验收
// 不加载 Dummy，全部数据来自 data/kb（灰机 wiki 的 2026 数据快照）
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { DeathPolicies, StartupPolicies } from "../kernel/policies.ts";
import { loadCharacter, selectSkillByAI } from "../compile/load.ts";

const R = ResourcePolicies.COMMUNITY_4_8_5_345;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };

async function build(seed: number, idsA: number[], idsB: number[]) {
  const teams: any[] = [];
  let ent = 1;
  for (const [ti, ids] of [idsA, idsB].entries()) {
    const members: any[] = [];
    for (const id of ids) { const lc = await loadCharacter(id, ti, ent++); members.push(lc); }
    teams.push(members);
  }
  const { Team } = await import("../kernel/team.ts");
  const t0 = new Team(0, "RED", R, 1), t1 = new Team(1, "BLUE", R, 1);
  for (const m of teams[0]) t0.add(m.entity);
  for (const m of teams[1]) t1.add(m.entity);
  const bt = new Battle([t0, t1], {
    seed, rules: { ...DEFAULT_RULES, maxTurns: 500 },
    policies: { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI, death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER", tieBreak: "SPEED_THEN_RANDOM" },
  });
  bt.skillSelector = (b, actor, enemies) => selectSkillByAI(b, actor, enemies);
  return { bt, teams };
}

console.log("=== M1 First Real Shikigami 验收 ===");

// 装载清单：机制覆盖面最广且编译全 HIGH/MEDIUM 的真实式神
const RED = [236, 201, 212];   // 管狐 / 雪女 / 童男
const BLUE = [246, 307, 347];  // 赤舌 / 猫掌柜 / 缘结神

const { bt, teams } = await build(20261001, RED, BLUE);
const all = [...teams[0], ...teams[1]];
console.log("\n装载式神：");
for (const m of all) console.log(`  ${m.entity.name}(${m.meta.rarity}) 技能${m.ir.length} 面板 atk${m.entity.prop("atk")} hp${m.entity.maxHp} spd${m.entity.speed} AI=${m.ai.confidence} 问题${m.issues.length}`);

ok("装载 6 只真实式神", all.length === 6);
ok("全部有真实面板（非默认值）", all.every(m => m.meta.panel && m.entity.maxHp === m.meta.panel.hp));
ok("全部有可执行技能", all.every(m => m.entity.skills.length === m.ir.length && m.entity.skills.length >= 1));
ok("技能携带技能IR", all.every(m => m.entity.skills.every((s: any) => s.ir && s.ir.id)));

const r = await bt.run();
ok("真实式神对局跑通", bt.turn > 0 && bt.phase === "END", `turns=${r.turns} winner=${r.winner} reason=${r.reason}`);
ok("产生了伤害记录", bt.trace.some((x: any) => x.t === "DAMAGE"), `damage events=${bt.trace.filter((x: any) => x.t === "DAMAGE").length}`);
ok("行动条被真实速度驱动", bt.timeline.log.length > 0, `advances=${bt.timeline.log.length}`);

// Seed 可复现
{
  const sigs: string[] = [];
  for (let i = 0; i < 10; i++) { const { bt: b } = await build(777, RED, BLUE); await b.run(); sigs.push(JSON.stringify(b.trace)); }
  ok("同 seed 10 次完全一致", new Set(sigs).size === 1, `distinct=${new Set(sigs).size}`);
}
{
  const sigs = new Set<string>();
  for (let s = 1; s <= 12; s++) { const { bt: b } = await build(s, RED, BLUE); await b.run(); sigs.add(JSON.stringify(b.trace.filter((x: any) => x.t === "DAMAGE").slice(0, 5))); }
  ok("不同 seed 产生不同过程", sigs.size > 1, `distinct=${sigs.size}/12`);
}

// AI 真的在选技能（不是永远放同一个）
{
  const used = new Set<string>();
  for (let s = 1; s <= 20; s++) {
    const { bt: b } = await build(s, [236], [246]);
    await b.run();
    for (const rec of b.turnLog) if (rec.skill) used.add(rec.skill);
  }
  ok("AI 使用了多个不同技能", used.size >= 2, `skills used = ${[...used].join("/")}`);
}
{
  const { bt: b } = await build(5, [236], [246]);
  await b.runStartup();
  const actor = b.teams[0].members[0];
  const sk = selectSkillByAI(b, actor, b.enemiesOf(0));
  ok("AI 选择器返回合法技能", !!sk && !!sk.execute, `chose=${sk?.name}`);
}

// 鬼火是第一约束：火不足时不能放高消耗技能
{
  const { bt: b } = await build(9, [201], [246]);
  await b.runStartup();
  const actor = b.teams[0].members[0];
  b.teams[0].orbs.orb = 0;
  const sk = selectSkillByAI(b, actor, b.enemiesOf(0));
  ok("鬼火为 0 时 AI 不会选高消耗技能", (sk?.cost ?? 0) === 0, `chose=${sk?.name} cost=${sk?.cost}`);
}

// buff 编译器接进战斗
{
  const { loadBuffs } = await import("../compile/load.ts");
  const buffs = await loadBuffs();
  const withEff = [...buffs.values()].filter(b => b.effects.length > 0).length;
  const withFlag = [...buffs.values()].filter(b => b.preventsAction || b.forcesBasicAttack || b.locksTimeline).length;
  ok("buff 字典已编译", buffs.size > 300, `total=${buffs.size} 有属性效果=${withEff} 有行为标记=${withFlag}`);
}

// ★ 镜像对称不变量：同阵容打自己必须 ≈50%，否则引擎有结构性偏向
{
  const { monteCarlo } = await import("../runner/monte-carlo.ts");
  const { Team } = await import("../kernel/team.ts");
  const { Entity } = await import("../kernel/entity.ts");
  const { loadCharacter: LC } = await import("../compile/load.ts");
  const base = await LC(236, 0, 1);
  const fac = async (seed: number) => {
    const e0 = new Entity(1, base.entity.name, 0, { ...base.entity.base }); e0.skills = base.entity.skills;
    const e1 = new Entity(101, base.entity.name, 1, { ...base.entity.base }); e1.skills = base.entity.skills;
    const t0 = new Team(0, "R", R, 1); t0.add(e0);
    const t1 = new Team(1, "B", R, 1); t1.add(e1);
    const bt = new Battle([t0, t1], { seed, rules: { ...DEFAULT_RULES, maxTurns: 300 },
      policies: { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI, death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER", tieBreak: "SPEED_THEN_RANDOM" } });
    bt.skillSelector = (b, a, en) => selectSkillByAI(b, a, en);
    return bt;
  };
  const r = await monteCarlo(fac, 300, { seedBase: 900000 });
  const ci = r.ci95Red!;
  ok("镜像对局对称（红方胜率 95% CI 覆盖 50%）", ci[0] <= 0.5 && ci[1] >= 0.5,
     `红 ${(r.winRateRed! * 100).toFixed(1)}% CI [${(ci[0] * 100).toFixed(1)}%, ${(ci[1] * 100).toFixed(1)}%]`);
}

// 阴阳师双体系（依据数据自身的 grade 字段拆分，不靠猜测）
{
  const OMY = [10, 11, 12, 13, 15, 16];
  const loaded: any[] = [];
  for (const id of OMY) loaded.push(await loadCharacter(id, 0, id));
  const classic = loaded.filter(l => l.entity.onmyoji?.system === "CLASSIC_GUARDIAN");
  const clan = loaded.filter(l => l.entity.onmyoji?.system === "CLAN_HERO");
  ok("6 个阴阳师/英杰全部识别为 ONMYOJI", loaded.every(l => l.entity.type === "ONMYOJI"));
  ok("经典四位归入 CLASSIC_GUARDIAN", classic.length === 4, classic.map(l => l.entity.name).join("/"));
  ok("源赖光+藤原道长归入 CLAN_HERO", clan.length === 2, clan.map(l => l.entity.name).join("/"));
  ok("经典四位带御灵映射", classic.every(l => !!l.entity.onmyoji?.guardian?.name),
     classic.map(l => l.entity.name + ":" + l.entity.onmyoji?.guardian?.name).join(" "));
  ok("CLAN_HERO 无御灵模型", clan.every(l => l.entity.onmyoji?.guardian === null));
  ok("全部标记为无属性面板来源", loaded.every(l => l.entity.onmyoji?.statsSource === "NONE"));
  const withAI = loaded.filter(l => l.entity.onmyoji?.aiAvailable);
  ok("经典四位有 AI 资料、英杰两位没有", withAI.length === 4 && clan.every(l => !l.entity.onmyoji?.aiAvailable),
     "有AI:" + withAI.map(l => l.entity.name).join("/"));
  ok("阴阳师技能已装载", loaded.every(l => l.entity.skills.length >= 3));
  const shiki = await loadCharacter(217, 0, 999);
  ok("式神不受影响（仍是 SHIKIGAMI 且无 onmyoji 档案）", shiki.entity.type === "SHIKIGAMI" && shiki.entity.onmyoji === null);
}

console.log(`\n=== M1: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
