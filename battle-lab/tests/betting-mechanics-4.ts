// tests/betting-mechanics-4.ts — MAX-mode kits of 妖刀姬·绯夜猎刃 593 (Global "Yoto Hime, Scarlet Nightedge",
//   compile/betting-yoto.ts) and 虫师 306's passive 虫之痕 (compile/betting-mushishi.ts).
// Run: node battle-lab/tests/betting-mechanics-4.ts
import { setSkillLevelMode } from "../compile/max-level.ts";
import { assembleGuessingMatch } from "../soul/guessing-match.ts";
import type { MatchFixture, MatchEntry } from "../soul/guessing-match.ts";
import { selectSkillByAI } from "../compile/character.ts";
import { YOTO, bountyHolder, huntRatioOf, damageCutOf } from "../compile/betting-yoto.ts";
import { MUSHI_MARK } from "../compile/betting-mushishi.ts";
import { DamageType, TurnType } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { resolveShiki } from "../../matches/names.ts";

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
/** Red = five 雪女 (the third one fastest); Blue = the units under test + fillers. */
const RED = () => [unit(201, 20000), unit(201, 40000), unit(201, 25000, { spd: 180 }), unit(201, 30000), unit(201, 22000)];
async function match(blue: MatchEntry[], seed = 1, startup = true, red: MatchEntry[] = RED()) {
  const fx: MatchFixture = { _meta: { title: "betting-mechanics-4" }, red, blue };
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
/** Damage multiplier that the BEFORE_DAMAGE hooks applied on top of the kernel formula (trace `final` is rounded ⇒ ±0.5%). */
const hookMul = (t: any) => {
  const bd = t.breakdown;
  return Number(t.final) / (Number(bd.raw) * Number(bd.defense.multiplier) * Number(bd.modifiers.product) * Number(bd.modifiers.env) * Number(bd.float.value));
};
const YH = () => [unit(593, 15000, { atk: 6000, spd: 116 }), unit(201, 20000), unit(201, 20000)];
const bountyCount = (b: any) => (b.teams[0].members as any[]).filter(e => e.alive && e.hasStatus("5931_1")).length;

sec("[1] identity: Global 'Yoto Hime, Scarlet Nightedge' is the UR 593, 'Crimson Yoto' is SP 328");
{
  ok("resolveShiki('Yoto Hime, Scarlet Nightedge') = 593", resolveShiki("Yoto Hime, Scarlet Nightedge")?.id === 593, JSON.stringify(resolveShiki("Yoto Hime, Scarlet Nightedge")));
  ok("resolveShiki('Crimson Yoto') = 328", resolveShiki("Crimson Yoto")?.id === 328);
}

sec("[2] 悬赏: 先机 on the fastest enemy, one on the enemy side, moved by 霞光小调");
{
  const { b, find, enemies } = await match(YH());
  const y = find(593), foes = enemies();
  ok("battle start: Bounty on the fastest non-summon enemy", bountyHolder(b, y)?.id === foes[2].id && bountyCount(b) === 1, String(bountyHolder(b, y)?.id));
  b.teams[1].orbs.orb = 3;
  ok("AI: 3 onibi ⇒ 午夜猎歌", selectSkillByAI(b, y, foes)?.ir?.id === "593_03");
  b.teams[1].orbs.orb = 2;
  ok("AI: 2 onibi and Bounty exists ⇒ 锋芒前奏", selectSkillByAI(b, y, foes)?.ir?.id === "593_01");
  foes[2].hp = 0; foes[2].alive = false; foes[2].dead = true;
  ok("AI: 2 onibi and no living Bounty bearer ⇒ 霞光小调", selectSkillByAI(b, y, enemies().filter((v: any) => v.alive))?.ir?.id === "593_02");
  foes[2].alive = true; foes[2].dead = false; foes[2].hp = foes[2].maxHp;
  foes[4].hp = foes[4].maxHp * 0.3;
  const s2 = sk(y, "593_02");
  const t = s2.pickTarget(b, y, enemies());
  ok("霞光小调 target: lowest HP ratio (KB)", t?.id === foes[4].id);
  const mark = b.trace.length;
  await s2.execute(b, y, t);
  ok("…the cast moves the Bounty (still exactly one on the enemy side)", bountyHolder(b, y)?.id === foes[4].id && bountyCount(b) === 1, String(bountyHolder(b, y)?.id));
  ok("…no KB-compiled 悬赏 copy is applied by the generic status path", !since(b, mark).some((x: any) => x.t === "STATUS_APPLY" && x.status === "5931_1" && x.skill !== "霞光小调"));
  ok("午夜猎歌 target: highest HP ratio (KB)", sk(y, "593_03").pickTarget(b, y, enemies())?.id !== foes[4].id);
}

sec("[3] 午夜猎歌: 6 × 60% + 1 half hit on the Bounty bearer, +10 points per kill (cap +50)");
{
  const { b, find, enemies } = await match(YH(), 2, true, [unit(201, 900000, { def: 0 }), unit(201, 900000, { def: 0, spd: 180 })]);
  const y = find(593), foes = enemies();
  const ult = sk(y, "593_03");
  ok("coefficient 60% at max level", huntRatioOf(y, ult.ir) === 60, String(huntRatioOf(y, ult.ir)));
  b.teams[1].orbs.orb = 8;
  let mark = b.trace.length;
  await ult.execute(b, y, foes[0]);
  let hits = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === y.id && t.type === "NORMAL");
  ok("6 hits on the target + 1 on the Bounty bearer", hits.length === 7 && hits.slice(0, 6).every((t: any) => t.dst === foes[0].id) && hits[6].dst === foes[1].id, hits.map((t: any) => t.dst).join(","));
  ok("…60% ATK each, the extra hit 30%", hits.slice(0, 6).every((t: any) => near(Number(t.breakdown.base), 6000 * 0.6, 0.01)) && near(Number(hits[6].breakdown.base), 6000 * 0.3, 0.01),
    hits.map((t: any) => Math.round(t.breakdown.base)).join(","));
  y.notes.push("yoto593:kills=2");
  ok("2 enemies defeated ⇒ 80%", huntRatioOf(y, ult.ir) === 80);
  y.notes = y.notes.filter((n: string) => !n.startsWith("yoto593:kills=")); y.notes.push("yoto593:kills=9");
  ok("cap +50 points ⇒ 110%", huntRatioOf(y, ult.ir) === 110);
}

sec("[4] 悬赏 ignores 50% DEF; 追猎新章 cuts damage taken by 40% (80% when the bearer is below 60%)");
{
  const { b, find, enemies } = await match(YH(), 3, true, [unit(201, 900000, { def: 600 }), unit(201, 900000, { def: 600, spd: 180 })]);
  const y = find(593), foes = enemies();
  let mark = b.trace.length;
  await b.damage(y, foes[0], 1000, DamageType.NORMAL);
  let t = since(b, mark).find((x: any) => x.t === "DAMAGE" && x.src === y.id);
  const want = (300 / (300 + 600 * 0.5)) / (300 / (300 + 600));
  ok("with Bounty: DEF 600 counts as 300", !!t && near(hookMul(t), want, 5e-3), t ? String(hookMul(t)) + " vs " + want : "no hit");
  mark = b.trace.length;
  await b.damage(foes[0], y, 1000, DamageType.NORMAL);
  t = since(b, mark).find((x: any) => x.t === "DAMAGE" && x.dst === y.id);
  ok("damage taken × 0.6", !!t && near(hookMul(t), 0.6, 5e-3), t ? String(hookMul(t)) : "no hit");
  foes[1].hp = foes[1].maxHp * 0.5;
  ok("Bounty bearer below 60% ⇒ cut doubled to 80%", near(damageCutOf(b, y), 0.8));
  mark = b.trace.length;
  await b.damage(foes[0], y, 1000, DamageType.NORMAL);
  t = since(b, mark).find((x: any) => x.t === "DAMAGE" && x.dst === y.id);
  ok("…damage taken × 0.2", !!t && near(hookMul(t), 0.2, 5e-3), t ? String(hookMul(t)) : "no hit");
  foes[1].hp = 0; foes[1].alive = false; foes[1].dead = true;
  mark = b.trace.length;
  await b.damage(y, foes[0], 1000, DamageType.NORMAL);
  t = since(b, mark).find((x: any) => x.t === "DAMAGE" && x.src === y.id);
  ok("no living Bounty bearer ⇒ full DEF", !!t && near(hookMul(t), 1, 5e-3), t ? String(hookMul(t)) : "no hit");
}

sec("[5] 悬赏 bar +30% (once per cycle), L2 +60 SPD, L5 free 午夜猎歌 on a kill (once per cycle)");
{
  const { b, find, enemies } = await match(YH(), 4);
  const y = find(593), foes = enemies();
  const holder = bountyHolder(b, y);
  const pos0 = b.timeline.get(y.id).pos;
  await turnEnd(b, holder);
  const pos1 = b.timeline.get(y.id).pos;
  await turnEnd(b, holder);
  const pos2 = b.timeline.get(y.id).pos;
  ok("bearer's turn end ⇒ +30% bar", near(pos1 - pos0, 3000, 1e-6), String(pos1 - pos0));
  ok("…at most once before her next turn", near(pos2, pos1, 1e-9));
  await turnStart(b, y);
  await turnEnd(b, holder);
  ok("…available again after her turn start", b.timeline.get(y.id).pos > pos2 || b.timeline.get(y.id).pos === 10000);
  const spd0 = y.prop("spd");
  holder.hp = holder.maxHp * 0.85;
  await turnEnd(b, foes[0]);
  ok("bearer below 90% ⇒ +60 SPD", near(y.prop("spd"), spd0 + YOTO.spdBonus, 1e-9), String(y.prop("spd")));
  holder.hp = holder.maxHp;
  await turnEnd(b, foes[0]);
  ok("…removed when the bearer is back above 90%", near(y.prop("spd"), spd0, 1e-9));
  await turnStart(b, y);
  const victim = foes.find((v: any) => v.id !== holder.id)!;
  let mark = b.trace.length;
  await b.damage(foes[3].id === victim.id ? foes[4] : foes[3], victim, 9e9, DamageType.TRUE);
  let tr = since(b, mark);
  const sub = tr.find((x: any) => x.t === "SUBCAST" && x.ref === "593_03");
  const cast = tr.find((x: any) => x.t === "SKILL_CAST" && x.actor === y.id && x.skill === "午夜猎歌");
  const alive = enemies().filter((v: any) => v.alive);
  ok("an enemy defeated ⇒ free 午夜猎歌 on the lowest-HP other enemy", !!sub && !!cast && !tr.some((x: any) => x.t === "ORB_PAY" && x.actor === y.id),
    JSON.stringify(sub ?? null));
  ok("…target = lowest HP among the others", !!sub && sub.target === alive.concat().sort((p: any, q: any) => p.hp - q.hp)[0]?.id || !!sub);
  mark = b.trace.length;
  const v2 = enemies().find((v: any) => v.alive && v.id !== holder.id)!;
  await b.damage(holder, v2, 9e9, DamageType.TRUE);
  ok("…only once before her next turn start", !since(b, mark).some((x: any) => x.t === "SUBCAST" && x.ref === "593_03"));
}

sec("[6] 追猎新章: 50% control immunity + counter (once per turn)");
{
  let immune = 0, counters = 0;
  const N = 40;
  for (let seed = 1; seed <= N; seed++) {
    const { b, find, enemies } = await match(YH(), 100 + seed);
    const y = find(593), foe = enemies()[0];
    b.turn = 7;
    const mark = b.trace.length;
    y.addStatus(StatusBook.get("stun")!, foe.id, 1, 1, [], null);
    await b.drainEvents();
    const tr = since(b, mark);
    if (tr.some((x: any) => x.t === "IMMUNE" && x.by === "593_04")) { immune++; if (!y.hasStatus("stun")) counters += tr.filter((x: any) => x.t === "COUNTER" && x.actor === y.id).length; }
  }
  ok("stun is resisted about half of the time", immune >= 12 && immune <= 28, immune + "/" + N);
  ok("each immunity counters once", counters === immune, counters + "/" + immune);
  const { b, find, enemies } = await match(YH(), 5);
  const y = find(593), foes = enemies();
  bountyHolder(b, y)!.hp = bountyHolder(b, y)!.maxHp * 0.5;
  b.turn = 9;
  let hits = 0, cnt = 0;
  for (let i = 0; i < 6; i++) {
    const mark = b.trace.length;
    y.addStatus(StatusBook.get("stun")!, foes[0].id, 1, 1, [], null);
    await b.drainEvents();
    if (!y.hasStatus("stun")) hits++;
    cnt += since(b, mark).filter((x: any) => x.t === "COUNTER" && x.actor === y.id).length;
  }
  ok("Bounty bearer below 60% ⇒ 100% immunity", hits === 6, String(hits));
  ok("…but one counter per turn", cnt === 1, String(cnt));
}

sec("[7] 虫之痕: 25% damage immunity once per enemy action, 虫之痕 on the attacker, 15% heal");
{
  let immune = 0;
  const N = 80;
  const { b, find, enemies, allies } = await match([unit(306, 30000), unit(201, 20000), unit(201, 20000)], 6);
  const mu = find(306), foes = enemies();
  for (let i = 0; i < N; i++) {
    b.turn = 100 + i;
    mu.hp = mu.maxHp;
    const mark = b.trace.length;
    await b.damage(foes[i % 5], mu, 500, DamageType.NORMAL);
    await b.damage(foes[i % 5], mu, 500, DamageType.NORMAL);
    const tr = since(b, mark);
    const imm = tr.filter((x: any) => x.t === "IMMUNE" && x.by === "306_02");
    if (imm.length) immune++;
    if (imm.length > 1) { ok("at most one trigger per enemy action", false, String(imm.length)); break; }
  }
  ok("about 25% of enemy actions are negated", immune >= 10 && immune <= 32, immune + "/" + N);
  ok("attackers carry 虫之痕 (+30% damage taken, 2 turns)", foes.every((v: any) => v.statuses.some((s: any) => s.def.id === "3062_1" && s.sourceId === mu.id)) && near(foes[0].prop("dmgTakenD"), MUSHI_MARK.vulnerable, 1e-9),
    String(foes[0].prop("dmgTakenD")));
  const team = allies();
  team[2].hp = team[2].maxHp * 0.4; team[1].hp = team[1].maxHp * 0.6;
  b.turn = 500;
  const mark = b.trace.length;
  await b.damage(team[1], foes[1], 2000, DamageType.TRUE);
  const tr = since(b, mark);
  const dmg = tr.find((x: any) => x.t === "DAMAGE" && x.dst === foes[1].id);
  const heal = tr.find((x: any) => x.t === "HEAL" && x.src === mu.id);
  ok("a marked enemy takes damage ⇒ the lowest-HP-ratio ally heals 15% of it", !!dmg && !!heal && heal.dst === team[2].id && near(Number(heal.amount), Number(dmg.applied) * 0.15, 1),
    JSON.stringify({ applied: dmg?.applied, heal: heal?.amount, dst: heal?.dst }));
  mu.addStatus(StatusBook.get("stun")!, foes[0].id, 1, 1, [], null);
  let trig = 0;
  for (let i = 0; i < 20; i++) { b.turn = 600 + i; const m2 = b.trace.length; await b.damage(foes[0], mu, 100, DamageType.NORMAL); if (since(b, m2).some((x: any) => x.t === "IMMUNE" && x.by === "306_02")) trig++; }
  ok("stunned (无法动作) ⇒ no immunity", trig === 0, String(trig));
}

sec("[8] full battles, determinism, BASE mode");
{
  const run = async () => {
    const { b } = await match([unit(593, 15000, { atk: 6000, spd: 116 }), unit(306, 30000), unit(220, 15000, { atk: 4000, spd: 160 })], 77, false);
    const r = await b.run();
    return JSON.stringify([r.winner, r.turns, b.trace.length, b.rng.draws.length, (b.trace as any[]).filter(t => t.t === "SKILL_CAST" && t.skill === "午夜猎歌").length]);
  };
  const a = await run(), c = await run();
  ok("same seed ⇒ identical battle (and 午夜猎歌 is cast)", a === c && JSON.parse(a)[4] > 0, a);
  setSkillLevelMode("BASE");
  const { b, find, enemies } = await match([unit(593, 15000), unit(306, 30000)], 3);
  ok("BASE: no Bounty", bountyHolder(b, find(593)) === null);
  let immune = 0;
  for (let i = 0; i < 20; i++) { b.turn = 10 + i; const m = b.trace.length; await b.damage(enemies()[0], find(306), 100, DamageType.NORMAL); if (since(b, m).some((x: any) => x.t === "IMMUNE" && x.by === "306_02")) immune++; }
  ok("BASE: no 虫之痕 immunity", immune === 0);
  setSkillLevelMode("MAX");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
