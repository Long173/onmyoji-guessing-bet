// tests/betting-mechanics-3.ts — MAX-mode kits of 犬神 220 (compile/betting-inugami.ts) and the in-game AI rules
//   of 犬神 / 虫师 306 / 赤影妖刀姬 328 plus 虫之护 (compile/betting-ai-rules.ts).
// Run: node battle-lab/tests/betting-mechanics-3.ts
import { setSkillLevelMode } from "../compile/max-level.ts";
import { assembleGuessingMatch } from "../soul/guessing-match.ts";
import type { MatchFixture, MatchEntry } from "../soul/guessing-match.ts";
import { selectSkillByAI } from "../compile/character.ts";
import { bettingCostOf } from "../compile/betting-mechanics.ts";
import { INUGAMI, markedAllies, guardAtkBonus, counterRatioOf, inugamiDiscount } from "../compile/betting-inugami.ts";
import { DamageType, TurnType } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { grantExtraTurn, pendingExtraTurns } from "../kernel/extra-turn.ts";

setSkillLevelMode("MAX");

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };
const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const unit = (shikigamiId: number, hp: number, extra: Partial<MatchEntry["stats"]> = {}): MatchEntry => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
const RED = () => [unit(201, 20000), unit(201, 40000), unit(201, 25000), unit(201, 30000), unit(201, 22000)];
async function match(blue: MatchEntry[], seed = 1, startup = true, red: MatchEntry[] = RED()) {
  const fx: MatchFixture = { _meta: { title: "betting-mechanics-3" }, red, blue };
  const A = await assembleGuessingMatch(fx, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  if (startup) await b.runStartup();
  const find = (charId: number) => b.teams[1].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find, enemies: () => b.enemiesOf(1) as any[], allies: () => b.teams[1].members as any[] };
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const turnEnd = (b: any, actor: any) => b.bus.dispatch("TURN_END", { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const turnStart = (b: any, actor: any) => b.bus.dispatch("TURN_START", { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const marked = (b: any) => markedAllies(b, 1).map((e: any) => e.id).sort((x: number, y: number) => x - y);
const INU = () => [unit(220, 15000, { atk: 4000 }), unit(201, 20000), unit(201, 20000), unit(201, 20000), unit(201, 20000)];

sec("[1] 守护印记: floor(allies/2), lowest HP ratio first, re-assigned at Inugami's turn end, moved not stacked");
{
  const { b, find, allies } = await match(INU());
  const inu = find(220);
  const team = allies();
  ok("battle start: 5 allies ⇒ 2 marks (all full HP ⇒ random tie-break)", marked(b).length === 2, JSON.stringify(marked(b)));
  ok("the mark is the KB 守护印记 (2202_1, 通用印记)", team.some((m: any) => m.statuses.some((s: any) => s.def.id === "2202_1" && s.def.name === "守护印记")));
  {
    const sets = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) { const r = await match(INU(), seed); sets.add(JSON.stringify(marked(r.b).map((id: number) => r.allies().findIndex((m: any) => m.id === id)))); }
    ok("battle-start marks vary with the seed (not always the first two in the lineup)", sets.size > 1, [...sets].join(" "));
  }
  const before = JSON.stringify(marked(b));
  team[3].hp = team[3].maxHp * 0.3; team[4].hp = team[4].maxHp * 0.5;
  await turnEnd(b, b.teams[0].members[0]);
  ok("an enemy's turn end does not move the marks (wiki: at the end of Inugami's turn)", JSON.stringify(marked(b)) === before, JSON.stringify(marked(b)));
  await turnEnd(b, team[2].id === inu.id ? team[1] : team[2]);
  ok("…nor an ally's turn end", JSON.stringify(marked(b)) === before, JSON.stringify(marked(b)));
  await turnEnd(b, inu);
  ok("Inugami's turn end re-assigns to the 2 lowest HP ratios", JSON.stringify(marked(b)) === JSON.stringify([team[3].id, team[4].id].sort((x, y) => x - y)), JSON.stringify(marked(b)));
  ok("never more than one mark per ally (moved, not stacked)", team.every((m: any) => m.statuses.filter((s: any) => s.def.id === "2202_1").length <= 1 && (m.statuses.find((s: any) => s.def.id === "2202_1")?.stacks ?? 1) === 1));
  inu.hp = inu.maxHp * 0.1;
  await turnEnd(b, inu);
  ok("Inugami counts as an ally (lowest ratio ⇒ marked)", marked(b).includes(inu.id) && marked(b).length === 2);
  for (const m of [team[1], team[2]]) { m.hp = 0; m.alive = false; m.dead = true; }
  await turnEnd(b, inu);
  ok("3 allies alive ⇒ floor(3/2) = 1 mark", marked(b).length === 1, JSON.stringify(marked(b)));
  inu.hp = 0; inu.alive = false; inu.dead = true;
  await turnEnd(b, b.teams[0].members[0]);
  ok("Inugami dead ⇒ the marks are cleared at the next turn end", marked(b).length === 0, JSON.stringify(marked(b)));
}

sec("[2] counter: only for marked allies, 135% ATK, once per enemy action, not while immobile");
{
  const { b, find, allies, enemies } = await match(INU());
  const inu = find(220), team = allies(), foe = enemies()[0];
  ok("counter ratio = 135% (220_02 L5 '反击伤害增加至135%')", counterRatioOf(inu) === 135);
  const unmarked = team.find((m: any) => !m.hasStatus("2202_1"));
  const target = team.find((m: any) => m.hasStatus("2202_1") && m.id !== inu.id);
  b.turn = 10;
  let mark = b.trace.length;
  await b.damage(foe, unmarked, 1000, DamageType.NORMAL);
  ok("damage to an unmarked ally ⇒ no counter", !since(b, mark).some((t: any) => t.t === "COUNTER"));
  mark = b.trace.length;
  await b.damage(foe, target, 1000, DamageType.CONDUCTION);
  ok("conducted damage to a marked ally ⇒ no counter", !since(b, mark).some((t: any) => t.t === "COUNTER"));
  mark = b.trace.length;
  const atk0 = inu.prop("atk");
  await b.damage(foe, target, 1000, DamageType.NORMAL);
  const tr = since(b, mark);
  const c = tr.find((t: any) => t.t === "COUNTER");
  const hit = tr.find((t: any) => t.t === "DAMAGE" && t.src === inu.id && t.dst === foe.id);
  ok("damage to a marked ally ⇒ Inugami counters the attacker", !!c && c.actor === inu.id && c.target === foe.id && c.marked === target.id);
  ok("…in a pseudo turn with 1 hit of 135% ATK", !!hit && near(Number(hit.breakdown.base), atk0 * 1.35, 0.01) && tr.some((t: any) => t.t === "TURN_TYPE" && t.type === "PSEUDO_TURN" && t.actor === inu.id),
    hit ? String(hit.breakdown.base) + " vs " + atk0 * 1.35 : "no hit");
  mark = b.trace.length;
  await b.damage(foe, target, 1000, DamageType.NORMAL);
  ok("a second hit of the same enemy action ⇒ no second counter", !since(b, mark).some((t: any) => t.t === "COUNTER"));
  b.turn = 11;
  inu.addStatus(StatusBook.get("stun")!, foe.id, 1, 1, [], null);
  mark = b.trace.length;
  await b.damage(foe, target, 1000, DamageType.NORMAL);
  ok("Inugami stunned (无法动作) ⇒ no counter", !since(b, mark).some((t: any) => t.t === "COUNTER"));
}

sec("[3] counter rider: +30% of the enemy's ATK (cap 210% base), 紧盯, cost -2, expiry at his turn end");
{
  const strong = RED().map(u => ({ ...u, stats: { ...u.stats, atk: 10000 } }));
  const { b, find, allies, enemies } = await match(INU(), 2, true, strong);
  const inu = find(220), team = allies(), foes = enemies();
  const target = team.find((m: any) => m.hasStatus("2202_1") && m.id !== inu.id);
  const base = Number(inu.base.atk);
  const ult = sk(inu, "220_03");
  ok("without 紧盯 心剑乱舞 costs 3", bettingCostOf(b, inu, ult) === 3);
  b.turn = 20;
  const foeAtk = foes[0].prop("atk");
  await b.damage(foes[0], target, 500, DamageType.NORMAL);
  ok("ATK +30% of the countered enemy's ATK", near(guardAtkBonus(inu), INUGAMI.atkFromEnemy * foeAtk, 1e-6) && near(inu.prop("atk"), base + 0.3 * foeAtk, 1e-6), String(guardAtkBonus(inu)));
  ok("the counter target gets 紧盯 (2204_1): ATK -35%", foes[0].hasStatus("2204_1") && near(foes[0].prop("atk"), foeAtk * 0.65, 1e-6), String(foes[0].prop("atk")));
  ok("one enemy with 紧盯 ⇒ no discount", inugamiDiscount(b, inu, ult) === 0);
  b.turn = 21;
  await b.damage(foes[1], target, 500, DamageType.NORMAL);
  ok("two enemies with 紧盯 ⇒ 心剑乱舞 costs 1 (3 - 2)", bettingCostOf(b, inu, ult) === 1 && bettingCostOf(b, inu, ult.ir) === 1);
  b.teams[1].orbs.orb = 1;
  const pick = selectSkillByAI(b, inu, foes);
  ok("with 1 onibi the AI casts the discounted 心剑乱舞", pick?.ir?.id === "220_03", String(pick?.ir?.id));
  for (let i = 2; i < 5; i++) { b.turn = 20 + i; await b.damage(foes[i], target, 500, DamageType.NORMAL); }
  ok("ATK bonus capped at 210% of the soul-free base ATK (3002, not the 4000 panel)", INUGAMI.baseAtk === 3002 && near(guardAtkBonus(inu), 2.1 * INUGAMI.baseAtk, 1e-6) && near(inu.prop("atk"), base + 2.1 * INUGAMI.baseAtk, 1e-6), String(guardAtkBonus(inu)) + " vs " + 2.1 * INUGAMI.baseAtk);
  await turnStart(b, inu);
  b.turn = 30;
  await b.damage(foes[0], target, 500, DamageType.NORMAL);   // counter during his own turn window
  await turnEnd(b, inu);
  ok("his turn end removes 紧盯 and the ATK bonus gained before that turn…", !foes.slice(1).some((v: any) => v.hasStatus("2204_1")));
  ok("…but keeps what was gained during it (until his next turn end)", foes[0].hasStatus("2204_1") && guardAtkBonus(inu) > 0);
  await turnStart(b, inu);
  await turnEnd(b, inu);
  ok("next turn end: all gone", !foes.some((v: any) => v.hasStatus("2204_1")) && guardAtkBonus(inu) === 0 && near(inu.prop("atk"), base, 1e-6));
}

sec("[4] 心剑乱舞: 5 × 108%, unhit enemies first, repeat hits ×0.5 each");
{
  const { b, find, enemies } = await match(INU());
  const inu = find(220);
  const ult = sk(inu, "220_03");
  b.teams[1].orbs.orb = 8;
  let mark = b.trace.length;
  await ult.execute(b, inu, enemies()[2]);
  let hits = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === inu.id);
  ok("5 hits, 5 different enemies (none repeated while an unhit one is alive)", hits.length === 5 && new Set(hits.map((t: any) => t.dst)).size === 5, hits.map((t: any) => t.dst).join(","));
  ok("hit 1 strikes the chosen target", hits[0]?.dst === enemies()[2].id);
  ok("108% ATK per hit, no decay on first hits", hits.every((t: any) => near(Number(t.breakdown.base), 4000 * 1.08, 0.01) && near(Number(t.breakdown.rate), 1)), String(hits[0]?.breakdown?.base));
  const { b: b2, find: f2 } = await match(INU(), 3, true, [unit(201, 900000)]);
  const inu2 = f2(220);
  b2.teams[1].orbs.orb = 8;
  mark = b2.trace.length;
  await sk(inu2, "220_03").execute(b2, inu2, b2.enemiesOf(1)[0]);
  hits = since(b2, mark).filter((t: any) => t.t === "DAMAGE" && t.src === inu2.id);
  ok("single enemy: rates 1, 0.5, 0.25, 0.125, 0.0625 (multiplicative)", hits.length === 5 && hits.every((t: any, i: number) => near(Number(t.breakdown.rate), Math.pow(0.5, i))), hits.map((t: any) => t.breakdown.rate).join(","));
  const { b: b3, find: f3 } = await match(INU(), 4, true, [unit(201, 900000), unit(201, 900000)]);
  const inu3 = f3(220);
  b3.teams[1].orbs.orb = 8;
  mark = b3.trace.length;
  await sk(inu3, "220_03").execute(b3, inu3, b3.enemiesOf(1)[0]);
  hits = since(b3, mark).filter((t: any) => t.t === "DAMAGE" && t.src === inu3.id);
  const firstTwo = new Set(hits.slice(0, 2).map((t: any) => t.dst));
  ok("two enemies: hits 1-2 on different enemies, later hits decay per target", firstTwo.size === 2 && hits.length === 5, hits.map((t: any) => t.dst + "@" + t.breakdown.rate).join(","));
  const perTarget = new Map<number, number[]>();
  for (const t of hits) perTarget.set(t.dst, [...(perTarget.get(t.dst) ?? []), Number(t.breakdown.rate)]);
  ok("…each target's rates are 1, 0.5, 0.25 … in order", [...perTarget.values()].every(r => r.every((x, i) => near(x, Math.pow(0.5, i)))));
}

sec("[5] AI: 犬神 always 心剑乱舞 when affordable; 虫师 70% rule; 赤影妖刀姬 lowest HP ratio");
{
  const { b, find, enemies } = await match(INU());
  const inu = find(220);
  let ult = 0, basic = 0;
  for (let i = 0; i < 20; i++) {
    b.teams[1].orbs.orb = 3;
    const p = selectSkillByAI(b, inu, enemies());
    if (p?.ir?.id === "220_03") ult++; else basic++;
  }
  ok("犬神 with 3 onibi: 心剑乱舞 20/20 (not the wiki's 50%)", ult === 20 && basic === 0, ult + "/" + basic);
  b.teams[1].orbs.orb = 2;
  ok("犬神 with 2 onibi (no discount): 心斩", selectSkillByAI(b, inu, enemies())?.ir?.id === "220_01");
  ok("犬神 never casts 守护 (220_02)", ![0, 1, 2, 3, 8].some(n => { b.teams[1].orbs.orb = n; return selectSkillByAI(b, inu, enemies())?.ir?.id === "220_02"; }));
}
{
  const { b, find, allies, enemies } = await match([unit(306, 30000), unit(201, 20000), unit(201, 20000)]);
  const mu = find(306), team = allies();
  b.teams[1].orbs.orb = 8;
  ok("虫师: every ally ≥ 70% ⇒ 虫之舞 even with 8 onibi", selectSkillByAI(b, mu, enemies())?.ir?.id === "306_01");
  team[1].hp = team[1].maxHp * 0.69;
  ok("虫师: an ally < 70% ⇒ 虫之护", selectSkillByAI(b, mu, enemies())?.ir?.id === "306_03");
  b.teams[1].orbs.orb = 2;
  ok("虫师: an ally < 70% but 2 onibi ⇒ 虫之舞", selectSkillByAI(b, mu, enemies())?.ir?.id === "306_01");
  b.teams[1].orbs.orb = 8;
  team[1].hp = team[1].maxHp; mu.hp = mu.maxHp * 0.5;
  ok("虫师: herself < 70% counts", selectSkillByAI(b, mu, enemies())?.ir?.id === "306_03");
  const foes = enemies();
  foes[3].hp = foes[3].maxHp * 0.6; foes[1].hp = foes[1].maxHp * 0.45; foes[4].hp = foes[4].maxHp * 0.3;
  const t = sk(mu, "306_01").pickTarget(b, mu, foes);
  ok("虫之舞 target: lowest HP ratio among enemies below 50%", t?.id === foes[4].id, String(t?.id));
}
{
  const { b, find, allies } = await match([unit(306, 30000), unit(201, 20000), unit(201, 20000), unit(201, 20000), unit(201, 20000), unit(201, 20000)].slice(0, 5));
  const mu = find(306), team = allies();
  const sleep = StatusBook.get("sleep")!;
  const base = StatusBook.get("silence")!;
  const debuffDef = { ...base, id: "TEST_DEBUFF", name: "测试减益", preventsSkill: false, dispellable: true } as any;
  const buffDef = { ...base, id: "TEST_BUFF", name: "测试增益", category: "BUFF_STATE", preventsSkill: false, dispellable: true } as any;
  StatusBook.set(debuffDef.id, debuffDef); StatusBook.set(buffDef.id, buffDef);
  for (const m of team) { m.addStatus(debuffDef, 1, 1, 3, [], null); m.addStatus(buffDef, m.id, 1, 3, [], null); }
  team[2].addStatus(sleep, 1, 1, 3, [], null);
  for (const m of team) m.hp = m.maxHp * 0.5;
  b.teams[1].orbs.orb = 8;
  const mark = b.trace.length;
  await sk(mu, "306_03").execute(b, mu, team[1]);
  const removed = since(b, mark).filter((t: any) => t.t === "STATUS_REMOVE" && t.skill === "虫之护");
  ok("虫之护 dispels at most 4 allies (L2)", removed.length === 4 && new Set(removed.map((t: any) => t.id)).size === 4, String(removed.length));
  ok("…one effect each, a control before an older debuff", team[2].hasStatus("TEST_DEBUFF") && !team[2].hasStatus("sleep") && !team[0].hasStatus("TEST_DEBUFF") && team[4].hasStatus("TEST_DEBUFF"));
  ok("…and never a buff", team.every((m: any) => m.hasStatus("TEST_BUFF")));
  const heals = since(b, mark).filter((t: any) => t.t === "HEAL" && t.src === mu.id);
  const full = mu.maxHp * 0.18;
  const h4 = heals.find((t: any) => t.dst === team[4].id), h1 = heals.find((t: any) => t.dst === team[1].id);
  ok("heal 18% of 虫师's max HP to the undispelled 5th ally", !!h4 && near(Number(h4.amount), full, 0.5), String(h4?.amount) + " vs " + full);
  ok("dispelled allies heal 20% less (L4)", !!h1 && near(Number(h1.amount), full * 0.8, 0.5), String(h1?.amount) + " vs " + full * 0.8);
}
{
  const red = [unit(201, 20000), unit(201, 20000), unit(201, 20000), unit(201, 20000), unit(201, 20000)];
  const { b, find, enemies } = await match([unit(328, 15000, { atk: 6000 }), unit(201, 20000)], 5, true, red);
  const yh = find(328), foes = enemies();
  b.teams[1].orbs.orb = 3;
  ok("赤影妖刀姬: 3 onibi ⇒ 赤影一瞬", selectSkillByAI(b, yh, foes)?.ir?.id === "328_03");
  b.teams[1].orbs.orb = 2;
  ok("赤影妖刀姬: 2 onibi ⇒ 炎刃", selectSkillByAI(b, yh, foes)?.ir?.id === "328_01");
  ok("all full HP ⇒ lineup order (first enemy)", sk(yh, "328_03").pickTarget(b, yh, foes)?.id === foes[0].id);
  foes[3].hp = foes[3].maxHp * 0.4; foes[1].hp = foes[1].maxHp * 0.5;
  ok("赤影一瞬 targets the lowest HP ratio", sk(yh, "328_03").pickTarget(b, yh, foes)?.id === foes[3].id);
  ok("炎刃 too", sk(yh, "328_01").pickTarget(b, yh, foes)?.id === foes[3].id);
}

sec("[6] full battles, extra turns, determinism, BASE mode");
{
  let counters = 0, discounted = 0, inuUlt = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { b } = await match([unit(220, 15000, { atk: 4000, spd: 160 }), unit(306, 30000), unit(201, 20000), unit(201, 20000), unit(201, 20000)], seed, false);
    await b.run();
    const tr = b.trace as any[];
    counters += tr.filter(t => t.t === "COUNTER" && t.skill === "守护·反击").length;
    discounted += tr.filter(t => t.t === "ORB_PAY" && t.skill === "心剑乱舞" && t.amount === 1).length;
    inuUlt += tr.filter(t => t.t === "SKILL_CAST" && t.skill === "心剑乱舞").length;
  }
  ok("full battles: 守护 counters happen", counters > 0, String(counters));
  ok("full battles: 心剑乱舞 is cast", inuUlt > 0, String(inuUlt));
  ok("full battles: discounted 心剑乱舞 (1 onibi) happens", discounted > 0, String(discounted));
}
{
  const { b, allies } = await match(INU(), 9, true);
  const a = allies()[1];
  grantExtraTurn(b, a, "TEST");
  ok("grantExtraTurn queues one turn", pendingExtraTurns(b) === 1);
  const turns0 = b.turn;
  await b.runPartial(1);
  const ex = (b.trace as any[]).filter(t => t.t === "EXTRA_TURN");
  ok("…played right after the next turn as a NEW_TURN that counts as a turn", ex.length === 1 && ex[0].actor === a.id && b.turn === turns0 + 2 && pendingExtraTurns(b) === 0,
    JSON.stringify(ex) + " turn " + b.turn);
}
{
  const run = async () => {
    const { b } = await match([unit(220, 15000, { atk: 4000, spd: 160 }), unit(306, 30000), unit(328, 15000)], 77, false);
    const r = await b.run();
    return JSON.stringify([r.winner, r.turns, b.trace.length, b.rng.draws.length]);
  };
  const a = await run(), c = await run();
  ok("same seed ⇒ identical battle", a === c, a);
  setSkillLevelMode("BASE");
  const { b, find, enemies } = await match(INU(), 3);
  const inu = find(220);
  ok("BASE: no 守护印记", markedAllies(b, 1).length === 0);
  ok("BASE: 心剑乱舞 keeps its KB cost", bettingCostOf(b, inu, sk(inu, "220_03")) === 3);
  b.turn = 5;
  const mark = b.trace.length;
  await b.damage(enemies()[0], b.teams[1].members[0], 1000, DamageType.NORMAL);
  ok("BASE: no 守护 counter", !since(b, mark).some((t: any) => t.t === "COUNTER"));
  setSkillLevelMode("MAX");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
