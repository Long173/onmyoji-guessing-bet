// tests/betting-mechanics-2.ts — MAX-mode kits of 鲸汐千姬 562 and 云外镜 344
//   (compile/betting-senhime.ts, compile/betting-ungaikyo.ts).
// Run: node battle-lab/tests/betting-mechanics-2.ts
import { setSkillLevelMode } from "../compile/max-level.ts";
import { bettingHpScale } from "../compile/betting-policies.ts";
import { assembleGuessingMatch } from "../soul/guessing-match.ts";
import type { MatchFixture, MatchEntry } from "../soul/guessing-match.ts";
import { selectSkillByAI } from "../compile/character.ts";
import { bettingGate } from "../compile/betting-mechanics.ts";
import { illusionOf, bettingCostOf, seaStored, addSea, summonWhale, whalesOf, SENHIME } from "../compile/betting-senhime.ts";
import { formOf, extraLotusHits } from "../compile/betting-ungaikyo.ts";
import { DamageType, TurnType } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";

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
/** Blue = the units under test + fillers; Red = five 雪女 with distinct HP. */
async function match(blue: MatchEntry[], seed = 1, startup = true) {
  const fx: MatchFixture = {
    _meta: { title: "betting-mechanics-2" },
    red: [unit(201, 20000), unit(201, 40000), unit(201, 25000), unit(201, 30000), unit(201, 22000)],
    blue,
  };
  const A = await assembleGuessingMatch(fx, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  if (startup) await b.runStartup();
  const find = (charId: number) => b.teams[1].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find, enemies: () => b.enemiesOf(1) };
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const turnEnd = (b: any, actor: any) => b.bus.dispatch("TURN_END", { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const turnStart = (b: any, actor: any) => b.bus.dispatch("TURN_START", { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));

sec("[1] 鲸汐千姬 562: illusion, cost -1, AI");
{
  const { b, find, enemies } = await match([unit(562, 20000, { atk: 4000 }), unit(339, 15000)]);
  const s = find(562), tamamo = find(339);
  ok("永生之海幻境 opens at battle start (L5 先机)", !!illusionOf(b, 1) && b.trace.some((t: any) => t.t === "FIELD_ENTER" && t.name === SENHIME.illusion && t.owner === s.id));
  ok("汐流祝福 is gained at battle start", s.hasStatus("5623_1"));
  const ult = tamamo.skills.find((x: any) => x.ir?.id === "339_03");
  ok("an ally 3-onibi skill costs 2 while the illusion is up", bettingCostOf(b, tamamo, ult) === 2, String(bettingCostOf(b, tamamo, ult)));
  const own = s.skills.find((x: any) => x.ir?.id === "562_03");
  ok("鲸息洄梦 costs 1 (2 - 1) while the illusion is up", bettingCostOf(b, s, own) === 1);
  ok("0-cost skills stay at 0 (minimum 0)", bettingCostOf(b, s, s.skills.find((x: any) => x.ir?.id === "562_01")) === 0);
  b.teams[1].orbs.orb = 1;
  const pick = selectSkillByAI(b, s, enemies());
  ok("with 1 onibi the AI casts 鲸息洄梦 (562_03)", pick?.ir?.id === "562_03", String(pick?.ir?.id));
  const mark = b.trace.length;
  await pick.execute(b, s, enemies()[0]);
  const pay = since(b, mark).find((t: any) => t.t === "ORB_PAY" && t.actor === s.id);
  ok("…and pays exactly 1 onibi", pay?.amount === 1 && b.teams[1].orbs.current === 0, JSON.stringify(pay));
  b.teams[1].orbs.orb = 8;
  const p8 = selectSkillByAI(b, s, enemies());
  ok("with 8 onibi the AI still never picks 鲛人歌 (562_02)", p8?.ir?.id === "562_03", String(p8?.ir?.id));
  ok("bettingGate blocks 562_02", String(bettingGate(b, s, s.skills.find((x: any) => x.ir?.id === "562_02"))).startsWith("NEVER_CAST"));
  for (const f of [...b.fields]) b.fields.splice(b.fields.indexOf(f), 1);
  ok("without the illusion the costs are back to normal", bettingCostOf(b, tamamo, ult) === 3 && bettingCostOf(b, s, own) === 2);
}
{
  // Illusion lifetime: 2 of Senhime's own turns (the turn it is opened does not count).
  const { b, find } = await match([unit(562, 20000), unit(201, 20000)]);
  const s = find(562);
  b.turn = 1;
  await turnEnd(b, b.teams[0].members[0]);
  ok("an enemy turn does not shorten the illusion", !!illusionOf(b, 1));
  await turnEnd(b, s);
  ok("still up after her 1st turn", !!illusionOf(b, 1));
  b.turn = 2;
  await turnEnd(b, s);
  ok("expires after her 2nd turn", !illusionOf(b, 1) && b.trace.some((t: any) => t.t === "FIELD_EXIT" && t.reason === "EXPIRED"));
}
{
  let passive = 0, ult = 0, cheap = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const { b } = await match([unit(562, 30000, { spd: 150 }), unit(201, 60000), unit(201, 60000)], seed, false);
    await b.run();
    const tr = b.trace as any[];
    passive += tr.filter(t => t.t === "SKILL_CAST" && t.skill === "鲛人歌").length;
    ult += tr.filter(t => t.t === "SKILL_CAST" && t.skill === "鲸息洄梦").length;
    cheap += tr.filter(t => t.t === "ORB_PAY" && t.skill === "鲸息洄梦" && t.amount === 1).length;
  }
  ok("full battles: 鲛人歌 is never cast", passive === 0, String(passive));
  ok("full battles: 鲸息洄梦 is cast", ult > 0, String(ult));
  ok("full battles: recasts pay 1 onibi", cheap > 0, String(cheap));
}

sec("[2] 海凝: 30% of ally damage, 5000% initial ATK per stack, 9 stacks");
{
  const { b, find, enemies } = await match([unit(562, 20000, { atk: 4000 }), unit(201, 20000)]);
  const s = find(562), ally = b.teams[1].members.find((e: any) => e.id !== s.id);
  const foe = enemies()[0];
  const mark = b.trace.length;
  await b.damage(ally, foe, 1000, DamageType.NORMAL);
  const d = since(b, mark).find((t: any) => t.t === "DAMAGE" && t.src === ally.id);
  ok("ally damage stores 30% of it as 海凝 (L3)", foe.hasStatus("5622_1") && Math.abs(seaStored(foe) - 0.3 * d.breakdown.final) < 1e-6, seaStored(foe) + " vs " + 0.3 * d.breakdown.final);
  const before = seaStored(foe);
  await b.damage(ally, foe, 1000, DamageType.CONDUCTION);
  ok("conducted damage does not feed 海凝", seaStored(foe) === before);
  const perStack = 50 * 4000;
  const v2 = enemies()[1];
  addSea(b, s, v2, perStack + 1, "TEST", "test");
  ok("more than 5000% initial ATK needs a 2nd stack", v2.statuses.find((x: any) => x.def.id === "5622_1")?.stacks === 2);
  addSea(b, s, v2, perStack * 100, "TEST", "test");
  ok("capped at 9 stacks × 5000% initial ATK", seaStored(v2) === perStack * 9 && v2.statuses.find((x: any) => x.def.id === "5622_1")?.stacks === 9, String(seaStored(v2)));
  for (const f of [...b.fields]) b.fields.splice(b.fields.indexOf(f), 1);
  const v3 = enemies()[2];
  await b.damage(ally, v3, 1000, DamageType.NORMAL);
  ok("no 海凝 without the illusion", !v3.hasStatus("5622_1"));
}

sec("[3] 极昼鲸: recast summon, cap 2, 158% to the 3 lowest-HP enemies, INDIRECT burst");
{
  const { b, find, enemies } = await match([unit(562, 20000, { atk: 4000 }), unit(201, 20000)]);
  const s = find(562);
  const ult = s.skills.find((x: any) => x.ir?.id === "562_03");
  b.teams[1].orbs.orb = 8;
  const mark = b.trace.length;
  await ult.execute(b, s, enemies()[0]);
  ok("recasting while the illusion is up summons 极昼鲸", whalesOf(b, 1, "DAY").length === 1 && since(b, mark).some((t: any) => t.t === "WHALE_SUMMON" && t.reason === "RECAST"));
  const w = whalesOf(b, 1, "DAY")[0];
  ok("the whale is an action-bar summon (untargetable, on the timeline)", !w.caps.canBeTargeted && b.timeline.has(w.id));
  await ult.execute(b, s, enemies()[0]);
  await ult.execute(b, s, enemies()[0]);
  ok("at most 2 极昼鲸 exist", whalesOf(b, 1, "DAY").length === 2 && b.trace.some((t: any) => t.t === "WHALE_CAP"));
  // whale action
  const foes = enemies();
  const top = foes.reduce((a: any, x: any) => (x.hp > a.hp ? x : a));
  addSea(b, s, top, 5000, "TEST", "test");
  const lowest = [...foes].sort((a: any, c: any) => a.hp - c.hp).slice(0, 3).map((x: any) => x.id);
  const m2 = b.trace.length;
  await w.skills[0].execute(b, w, foes[0]);
  const tr = since(b, m2);
  const stores = tr.filter((t: any) => t.t === "SEA_FROST_STORE" && t.reason === "WHALE_ACTION");
  ok("158% of Senhime's ATK goes to the 3 lowest-HP enemies", stores.length === 3 && stores.every((t: any) => lowest.includes(t.dst) && near(Number(t.added), 1.58 * s.prop("atk"), 1)),
    stores.map((t: any) => t.dst + ":" + t.added).join(","));
  const bursts = tr.filter((t: any) => t.t === "DAMAGE" && t.src === w.id);
  ok("every 海凝 bursts as INDIRECT damage", bursts.length === 4 && bursts.every((t: any) => t.type === DamageType.INDIRECT), String(bursts.length));
  const tb = bursts.find((t: any) => t.dst === top.id);
  ok("burst = stored amount (no second defense reduction)", !!tb && near(Number(tb.breakdown.base) * Number(tb.breakdown.rate) * Number(tb.breakdown.defense.multiplier), 5000, 1e-6));
  ok("the marks are removed after the burst", foes.every((v: any) => !v.hasStatus("5622_1") && seaStored(v) === 0));
  // L2 and lifetime
  const pos0 = b.timeline.get(w.id).pos;
  await turnEnd(b, b.teams[0].members[0]);
  ok("L2: +10% action bar after a non-summon enemy turn", near(b.timeline.get(w.id).pos - pos0, 1000), String(b.timeline.get(w.id).pos - pos0));
  await turnEnd(b, w);
  ok("the whale stays after its 1st turn (L4: 2 turns)", w.alive);
  await turnEnd(b, w);
  ok("…and leaves after its 2nd turn", !w.alive && !b.timeline.has(w.id));
}

sec("[4] 汐流祝福: control → 冰眠, L4 shield, death summons 永夜鲸");
{
  const { b, find, enemies } = await match([unit(562, 20000, { atk: 4000 }), unit(201, 20000)]);
  const s = find(562), foe = enemies()[0];
  s.addStatus(StatusBook.get("stun")!, foe.id, 1, 2, [], null);
  await b.drainEvents();
  ok("a control effect on her becomes 冰眠", !s.hasStatus("stun") && s.hasStatus("5621_1"));
  const mark = b.trace.length;
  await b.damage(foe, s, 2000, DamageType.NORMAL);
  const sh = since(b, mark).find((t: any) => t.t === "SHIELD_APPLY" && t.dst === s.id && t.reason === "DAMAGE_DURING_ICE_SLEEP");
  const d = since(b, mark).find((t: any) => t.t === "DAMAGE" && t.dst === s.id);
  ok("L4: damage during 冰眠 grants an equal shield", !!sh && near(Number(sh.value), Number(d.final), 1), JSON.stringify(sh));
  await turnStart(b, s);
  ok("冰眠 is removed at her turn start", !s.hasStatus("5621_1"));
  await turnEnd(b, s);
  ok("the 1-turn shield expires at her turn end", b.trace.some((t: any) => t.t === "SHIELD_EXPIRE" && t.id === s.id));
  b.teams[1].orbs.orb = 2;
  await b.damage(foe, s, 1e7, DamageType.TRUE);
  await b.drainEvents();
  const night = whalesOf(b, 1, "NIGHT");
  ok("on death she summons 永夜鲸", !s.alive && night.length === 1);
  const ally = b.teams[1].members.find((e: any) => e.id !== s.id);
  const m2 = b.trace.length;
  await night[0].skills[0].execute(b, night[0], enemies()[0]);
  const tr = since(b, m2);
  ok("永夜鲸: +1 onibi", b.teams[1].orbs.current === 3, String(b.teams[1].orbs.current));
  ok("永夜鲸: shields all allies for 98% of Senhime's ATK", tr.some((t: any) => t.t === "SHIELD_APPLY" && t.dst === ally.id && near(Number(t.value), 0.98 * s.prop("atk"), 1)));
}

sec("[5] 云外镜 344: Yin/Yang form, HP pools, skill tables, L5 lotus");
{
  const { b, find } = await match([unit(344, 20000, { atk: 3000, def: 400 }), unit(201, 20000)]);
  const u = find(344);
  ok("ATK 3000 > 500% DEF 400 ⇒ 阴 (Yin)", formOf(u) === "YIN");
  ok("Yin ATK = base + 200% initial DEF", near(u.prop("atk"), 3000 + 800), String(u.prop("atk")));
  const hpMax = Math.round(20000 * bettingHpScale());   // Lineup HP × betting HP scale
  ok("split HP pools: starts at half HP", near(u.hp, hpMax / 2) && u.maxHp === hpMax, u.hp + "/" + u.maxHp);
  ok("镜盾 at battle start: 680% DEF", u.shields.some((x: any) => !x.broken && near(x.value, 6.8 * 400)));
  ok("Yin skill table: 落影 / 斗转 / 云岸净空", u.skills.map((x: any) => x.name).join("/") === "落影/斗转/云岸净空");
  const healed = await b.heal(b.teams[1].members.find((e: any) => e.id !== u.id), u, 1000, { crit: false });
  ok("镜中世界: heals do not restore HP, 50% becomes a shield", healed === 0 && near(u.hp, hpMax / 2) && u.shields.some((x: any) => near(x.value, 500)));
}
{
  const { b, find, enemies } = await match([unit(344, 20000, { atk: 3000, def: 400 }), unit(201, 20000)]);
  const u = find(344);
  const sk = u.skills.find((x: any) => x.ir?.id === "344_06");
  const lotusCount = async (hpRatio: number) => {
    u.hp = u.maxHp * hpRatio;
    b.teams[1].orbs.orb = 8;
    const top = enemies().reduce((x: any, y: any) => (y.hp > x.hp ? y : x));
    top.hp = top.maxHp;
    const mark = b.trace.length;
    await sk.execute(b, u, top);
    // the chosen target takes the sweep + every Black Lotus hit
    return since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === u.id && t.dst === top.id).length - 1;
  };
  ok("L5: full Yin HP ⇒ 1 Black Lotus hit", (await lotusCount(1)) === 1 && extraLotusHits(u, sk.ir) === 0);
  ok("L5: 50% Yin HP ⇒ 1 extra (2 lotus hits)", (await lotusCount(0.5)) === 2);
  ok("L5: 35% Yin HP ⇒ 2 extra (3 lotus hits)", (await lotusCount(0.35)) === 3);
  const mark = b.trace.length;
  u.hp = u.maxHp;
  await sk.execute(b, u, enemies()[0]);
  const d = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === u.id);
  ok("sweep and lotus hit for 145% of the Yin ATK", d.every((t: any) => near(Number(t.breakdown.base), 1.45 * 3800, 1e-6)));
}
{
  const { b, find, enemies } = await match([unit(344, 20000, { atk: 3000, def: 800 }), unit(201, 20000)]);
  const u = find(344), ally = b.teams[1].members.find((e: any) => e.id !== u.id);
  ok("ATK 3000 ≤ 500% DEF 800 ⇒ 阳 (Yang)", formOf(u) === "YANG");
  ok("Yang DEF = base + 10% initial ATK", near(u.prop("def"), 1100), String(u.prop("def")));
  ok("Yang skill table: 昙无 / 斗转 / 苦海浮生", u.skills.map((x: any) => x.name).join("/") === "昙无/斗转/苦海浮生");
  b.teams[1].orbs.orb = 1;   // 苦海浮生 costs 2 (match-5 replay; betting-ungaikyo.ts)
  const p2 = selectSkillByAI(b, u, enemies());
  ok("Yang, 1 onibi: normal attack 昙无", p2?.name === "昙无", String(p2?.name));
  const mark = b.trace.length;
  await p2.execute(b, u, enemies()[0]);
  const d = since(b, mark).find((t: any) => t.t === "DAMAGE" && t.src === u.id);
  ok("昙无 deals 360% of DEF", !!d && near(Number(d.breakdown.base), 3.6 * 1100, 1e-6), String(d?.breakdown?.base));
  ok("昙无 pulls the front ally +20%", since(b, mark).some((t: any) => t.t === "TIMELINE_SHIFT" && t.id === ally.id && near(t.percent, 0.2)));
  b.teams[1].orbs.orb = 2;
  const p3 = selectSkillByAI(b, u, enemies());
  ok("Yang, 2 onibi: skill 3 is 苦海浮生", p3?.name === "苦海浮生", String(p3?.name));
  const m2 = b.trace.length;
  await p3.execute(b, u, enemies()[0]);
  const tr = since(b, m2);
  ok("苦海浮生: 镜佑 on all allies", u.hasStatus("3444_1") && ally.hasStatus("3444_1"));
  ok("苦海浮生: +20% action bar to all allies", [u.id, ally.id].every(id => tr.some((t: any) => t.t === "TIMELINE_SHIFT" && t.id === id && near(t.percent, 0.2))));
  ok("苦海浮生: 镜盾 680% DEF on self", tr.some((t: any) => t.t === "SHIELD_APPLY" && t.dst === u.id && near(Number(t.value), 6.8 * 1100, 1)));
  ally.addStatus(StatusBook.get("freeze")!, enemies()[0].id, 1, 2, [], null);
  await b.drainEvents();
  ok("镜佑: a control on the bearer is dispelled at once", !ally.hasStatus("freeze") && b.trace.some((t: any) => t.t === "STATUS_REMOVE" && t.skill === "镜佑"));
}
{
  let doutenn = 0, yinCasts = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const { b } = await match([unit(344, 30000, { atk: 3000, def: 400, spd: 150 }), unit(201, 60000), unit(201, 60000)], seed, false);
    const u = b.teams[1].members[0];
    u.addStatus(StatusBook.get("disarm")!, 101, 1, 99, [], null);   // AI rule "鬼火不足且被缴械 → 2技能"
    await b.run();
    const tr = b.trace as any[];
    doutenn += tr.filter(t => t.t === "SKILL_CAST" && t.skill === "斗转").length;
    yinCasts += tr.filter(t => t.t === "SKILL_CAST" && t.actor === u.id && (t.skill === "云岸净空" || t.skill === "落影")).length;
  }
  ok("full battles: 斗转 (344_05) is never cast", doutenn === 0, String(doutenn));
  ok("full battles: Ungaikyo acts with skill 3 / normal attack", yinCasts > 0, String(yinCasts));
}

sec("[6] determinism and BASE mode");
{
  const run = async () => {
    const { b } = await match([unit(562, 20000, { spd: 150 }), unit(344, 20000, { atk: 3000, def: 800 }), unit(339, 15000)], 77, false);
    const r = await b.run();
    return JSON.stringify([r.winner, r.turns, b.trace.length, b.rng.draws.length]);
  };
  const a = await run(), c = await run();
  ok("same seed ⇒ identical battle", a === c, a);
  setSkillLevelMode("BASE");
  const { b, find } = await match([unit(562, 20000), unit(344, 20000, { atk: 3000, def: 400 })], 3);
  const u = find(344);
  ok("BASE: no illusion at battle start", !illusionOf(b, 1));
  ok("BASE: Ungaikyo keeps full HP, no form and its KB skill table", u.hp === u.maxHp && !formOf(u) && u.skills.map((x: any) => x.name).join("/") === "落影/斗转/云岸净空");
  ok("BASE: no whale was summoned", !summonWhale || whalesOf(b, 1).length === 0);
  setSkillLevelMode("MAX");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
