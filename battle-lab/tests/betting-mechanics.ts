// tests/betting-mechanics.ts — MAX-mode shikigami mechanics (compile/betting-mechanics.ts)
//   金鱼姬 282: casts 金鱼·助阵 (282_03) with enough onibi and no Goldfish; never casts the passive.
//   饭笥 370:   储备粮 gain, 胃口大开 at >= 6 stacks (highest-HP target, 8 random hits, -4), 10-stack free form.
//   烬天玉藻前 339: 焚天九尾 picks a random living enemy for every hit.
// Run: node battle-lab/tests/betting-mechanics.ts
import { setSkillLevelMode } from "../compile/max-level.ts";
import { bettingHpScale } from "../compile/betting-policies.ts";
import { assembleGuessingMatch } from "../soul/guessing-match.ts";
import type { MatchFixture, MatchEntry } from "../soul/guessing-match.ts";
import { selectSkillByAI } from "../compile/character.ts";
import { foodStacks, goldfishOf, FEAST_FULL } from "../compile/betting-mechanics.ts";
import { DamageType, TurnType } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";

setSkillLevelMode("MAX");

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };
const sec = (s: string) => console.log("\n" + s);

const unit = (shikigamiId: number, hp: number, extra: Partial<MatchEntry["stats"]> = {}): MatchEntry => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
/** Blue side = the unit under test + fillers; Red = five 雪女 with distinct HP (highest = 40000). */
async function match(blue: MatchEntry[], seed = 1) {
  const fx: MatchFixture = {
    _meta: { title: "betting-mechanics" },
    red: [unit(201, 20000), unit(201, 40000), unit(201, 25000), unit(201, 30000), unit(201, 22000)],
    blue,
  };
  const A = await assembleGuessingMatch(fx, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  const find = (charId: number) => b.teams[1].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find, enemies: () => b.enemiesOf(1) };
}
const sinceMark = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const dmgFrom = (tr: any[], src: number) => tr.filter(t => t.t === "DAMAGE" && t.src === src);
/** Reach n 储备粮 stacks through the real rule: one stack per non-summon ally turn end. */
async function allyTurnEnds(b: any, m: any, n: number) {
  const ally = b.teams[m.teamId].members.find((e: any) => e.id !== m.id);
  for (let i = 0; i < n; i++) {
    await b.bus.dispatch("TURN_END", { actor: ally, type: TurnType.NORMAL }, ally.id, ally.teamId, (id: number) => b.teamOf(id));
  }
}

sec("[1] 金鱼姬 282: 金鱼·助阵 when onibi suffice and no Goldfish exists");
{
  const { b, find, enemies } = await match([unit(282, 26000, { spd: 200 }), unit(201, 20000)]);
  const k = find(282);
  b.teams[1].orbs.orb = 4;
  const pick1 = selectSkillByAI(b, k, enemies());
  ok("AI picks 282_03 (金鱼·助阵) with 4 onibi and no Goldfish", pick1?.ir?.id === "282_03", String(pick1?.ir?.id));
  b.teams[1].orbs.orb = 1;
  const pickLow = selectSkillByAI(b, k, enemies());
  ok("with 1 onibi it falls back to the basic attack (282_01)", pickLow?.ir?.id === "282_01", String(pickLow?.ir?.id));
  b.teams[1].orbs.orb = 4;
  await pick1.execute(b, k, enemies()[0]);
  const g = goldfishOf(b, k);
  ok("casting 282_03 summons the Goldfish", !!g, g ? "hp=" + Math.round(g.maxHp) : "none");
  ok("Goldfish HP = 66% of Kingyo's HP (max-level inheritance)", !!g && Math.abs(g.maxHp - Math.round(26000 * bettingHpScale()) * 0.66) < 1, g ? String(g.maxHp) : "");
  ok("Goldfish inherits 100% ATK", !!g && g.base.atk === k.base.atk);
  ok("casting it spent 2 onibi", b.teams[1].orbs.current === 2, String(b.teams[1].orbs.current));
  b.teams[1].orbs.orb = 8;
  const pick2 = selectSkillByAI(b, k, enemies());
  ok("with a Goldfish present the AI does NOT pick 282_03", pick2?.ir?.id !== "282_03", String(pick2?.ir?.id));
  ok("…and never the passive 282_02 (cost -1)", pick2?.ir?.id !== "282_02" && Number(pick2?.cost) >= 0, String(pick2?.ir?.id));
  const last = [...b.trace].reverse().find((t: any) => t.t === "AI_DECISION" && t.actor === k.id);
  ok("the AI decision records the gate", JSON.stringify(last?.rules ?? []).includes("SUMMON_PRESENT"));
}
{
  // Full battles: the passive is never cast; the Goldfish's 鱼之怒 fires.
  let passiveCasts = 0, summonCasts = 0, rages = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const { b } = await match([unit(282, 26000, { spd: 200, atk: 2000 }), unit(201, 60000), unit(201, 60000)], seed);
    await b.run();
    const tr = b.trace as any[];
    passiveCasts += tr.filter(t => t.t === "SKILL_CAST" && t.skill === "金鱼·反击").length;
    summonCasts += tr.filter(t => t.t === "SKILL_CAST" && t.skill === "金鱼·助阵").length;
    rages += tr.filter(t => t.t === "GOLDFISH_RAGE").length;
  }
  ok("full battles: 金鱼·反击 is never cast as an active skill", passiveCasts === 0, String(passiveCasts));
  ok("full battles: 金鱼·助阵 is cast", summonCasts > 0, String(summonCasts));
  ok("full battles: 鱼之怒 fires after 8 enemy turns", rages > 0, String(rages));
}

sec("[2] 饭笥 370: 储备粮 gain, 胃口大开 at >= 6 stacks, 10-stack form");
{
  const { b, find } = await match([unit(370, 17000), unit(201, 20000)]);
  const m = find(370);
  await b.run();
  const gains = (b.trace as any[]).filter(t => t.t === "STATUS_APPLY" && t.dst === m.id && t.status === "3702_1");
  ok("stacks are gained at ally turn ends", gains.some(t => t.reason === "ALLY_TURN_END"), String(gains.length));
  ok("蓄食待发 grants stacks on cast", gains.some(t => t.reason === "CAST"));
  ok("stacks never exceed 10", gains.every(t => t.stacks <= 10));
  const feasts = (b.trace as any[]).filter(t => t.t === "SKILL_CAST" && t.actor === m.id && t.skill === "胃口大开");
  ok("胃口大开 is cast during a full battle", feasts.length > 0, String(feasts.length));
}
{
  const { b, find, enemies } = await match([unit(370, 17000), unit(201, 20000)]);
  const m = find(370);
  b.teams[1].orbs.orb = 8;
  await allyTurnEnds(b, m, 5);
  const p5 = selectSkillByAI(b, m, enemies());
  ok("5 stacks: 胃口大开 stays locked (AI picks something else)", p5?.ir?.id !== "370_03", String(p5?.ir?.id));
  await allyTurnEnds(b, m, 2);
  const atk7 = m.prop("atk");
  ok("储备粮 adds +10% ATK per stack", Math.abs(atk7 - 3000 * 1.7) < 1e-6, String(atk7));
  const p7 = selectSkillByAI(b, m, enemies());
  ok("7 stacks + 3 onibi: AI picks 胃口大开 (370_03)", p7?.ir?.id === "370_03", String(p7?.ir?.id));
  const top = enemies().reduce((a: any, x: any) => (x.hp > a.hp ? x : a));
  const mark = b.trace.length;
  await p7.execute(b, m, enemies()[0]);
  const tr = sinceMark(b, mark);
  const d = dmgFrom(tr, m.id);
  ok("first hit lands on the highest-HP enemy", d[0]?.dst === top.id, d[0]?.dst + " vs " + top.id);
  ok("first hit is 150% ATK (L5)", Math.abs(Number(d[0]?.breakdown?.base) - atk7 * 1.5) < 1e-6, String(d[0]?.breakdown?.base));
  ok("then 8 hits of 33% ATK", d.length === 9 && d.slice(1).every((x: any) => Math.abs(Number(x.breakdown?.base) - atk7 * 0.33) < 1e-6), String(d.length));
  const randTags = (b.rng.draws as any[]).filter((r: any) => String(r.tag ?? "").startsWith("hit_target:胃口大开")).length;
  ok("each of the 8 hits draws its own tagged random target", randTags === 8, String(randTags));
  ok("consumes 4 stacks (7 → 3)", foodStacks(m) === 3, String(foodStacks(m)));
  ok("costs 3 onibi", b.teams[1].orbs.current === 5, String(b.teams[1].orbs.current));
}
{
  // 10-stack free form, triggered by the ally-turn-end gain.
  const { b, find, enemies } = await match([unit(370, 17000), unit(201, 20000)]);
  const m = find(370);
  const ally = b.teams[1].members.find((e: any) => e.id !== m.id);
  b.teams[1].orbs.orb = 0;
  await allyTurnEnds(b, m, 9);
  const top = enemies().reduce((a: any, x: any) => (x.hp > a.hp ? x : a));
  const mark = b.trace.length;
  await b.bus.dispatch("TURN_END", { actor: ally, type: TurnType.NORMAL }, ally.id, ally.teamId, (id: number) => b.teamOf(id));
  const tr = sinceMark(b, mark);
  ok("reaching 10 stacks auto-casts 胃口大开 (SUBCAST)", tr.some(t => t.t === "SUBCAST" && t.actor === m.id && t.ref === "370_03"));
  ok("the free cast pays no onibi", !tr.some(t => t.t === "ORB_PAY" && t.actor === m.id) && b.teams[1].orbs.current === 0);
  const d = dmgFrom(tr, m.id);
  const first = d[0];
  const atk10 = 3000 * 2;   // 10 stacks × 10% ATK at the moment of the hit
  ok("full form: first hit on the highest-HP enemy at 180%", first?.dst === top.id && Math.abs(Number(first?.breakdown?.base) - atk10 * FEAST_FULL.firstRatio / 100) < 1e-6,
    first?.dst + " base=" + first?.breakdown?.base);
  const trues = d.filter((x: any) => x.type === DamageType.TRUE);
  const others = enemies().filter((e: any) => e.id !== top.id).length;
  const split = trues.reduce((s: number, x: any) => s + Number(x.breakdown?.base ?? 0), 0);
  ok("40% of the first hit is split as TRUE damage among the other enemies", trues.length === others && Math.abs(split - 0.4 * first.final) < 1,   // trace `final` is display-rounded
    trues.length + " parts, " + split.toFixed(1) + " vs " + (0.4 * first.final).toFixed(1));
  ok("then 9 random hits of 33%", d.filter((x: any) => x.type === DamageType.NORMAL).length === 10, String(d.length));
  ok("consumes all stacks", foodStacks(m) === 0, String(foodStacks(m)));
}
{
  // Controlled at the 10-stack trigger (silence does not stop the gain): spend 5 stacks to cleanse first.
  const { b, find } = await match([unit(370, 17000), unit(201, 20000)]);
  const m = find(370);
  const ally = b.teams[1].members.find((e: any) => e.id !== m.id);
  await allyTurnEnds(b, m, 9);
  m.addStatus(StatusBook.get("silence")!, 101, 1, 3, [], null);
  const mark = b.trace.length;
  await b.bus.dispatch("TURN_END", { actor: ally, type: TurnType.NORMAL }, ally.id, ally.teamId, (id: number) => b.teamOf(id));
  const tr = sinceMark(b, mark);
  ok("controlled: 5 stacks are spent to cleanse", tr.some(t => t.t === "STACKS_CONSUMED" && t.reason === "CLEANSE_CONTROL" && t.from === 10 && t.to === 5));
  ok("controlled: the control effect is removed", !m.hasStatus("silence") && tr.some(t => t.t === "STATUS_REMOVE" && t.by === "CLEANSE"));
  ok("controlled: the free cast still happens and consumes the rest", tr.some(t => t.t === "SKILL_CAST" && t.actor === m.id) && foodStacks(m) === 0);
}
{
  // No gain while unable to act.
  const { b, find } = await match([unit(370, 17000), unit(201, 20000)]);
  const m = find(370);
  const ally = b.teams[1].members.find((e: any) => e.id !== m.id);
  await allyTurnEnds(b, m, 3);
  m.addStatus(StatusBook.get("stun")!, 101, 1, 3, [], null);
  await b.bus.dispatch("TURN_END", { actor: ally, type: TurnType.NORMAL }, ally.id, ally.teamId, (id: number) => b.teamOf(id));
  ok("no stack gain while stunned (无法动作)", foodStacks(m) === 3, String(foodStacks(m)));
}

sec("[3] 烬天玉藻前 339: 焚天九尾 picks a random enemy for every hit");
{
  let repeat = 0, spread = 0, casts = 0, decayOk = true;
  for (let seed = 1; seed <= 20; seed++) {
    const { b, find, enemies } = await match([unit(339, 15000), unit(201, 20000)], seed);
    const t = find(339);
    b.teams[1].orbs.orb = 8;
    const sk = t.skills.find((s: any) => s.ir?.id === "339_03");
    const mark = b.trace.length;
    await sk.execute(b, t, enemies()[0]);
    const d = dmgFrom(sinceMark(b, mark), t.id);
    casts++;
    const per = new Map<number, number>();
    for (const x of d) {
      const n = per.get(x.dst) ?? 0;
      per.set(x.dst, n + 1);
      if (Math.abs(Number(x.breakdown?.rate) - Math.max(0, 1 - 0.15 * n)) > 1e-9) decayOk = false;
    }
    if ([...per.values()].some(v => v >= 2)) repeat++;
    if (per.size >= 2) spread++;
  }
  ok("some cast hits the same enemy twice", repeat > 0, repeat + "/" + casts);
  ok("some cast hits two different enemies", spread > 0, spread + "/" + casts);
  ok("repeat hits on one target decay by 15% each (max level)", decayOk);
}
{
  // Determinism: same seed ⇒ same battle.
  const run = async () => {
    const { b } = await match([unit(339, 15000), unit(370, 17000), unit(282, 26000, { spd: 200 })], 77);
    const r = await b.run();
    return JSON.stringify([r.winner, r.turns, b.trace.length, b.rng.draws.length]);
  };
  const a = await run(), c = await run();
  ok("same seed ⇒ identical battle (deterministic RNG)", a === c, a);
}

sec("[4] BASE mode is untouched");
{
  setSkillLevelMode("BASE");
  const { b, find, enemies } = await match([unit(339, 15000), unit(201, 20000)], 3);
  const t = find(339);
  b.teams[1].orbs.orb = 8;
  const sk = t.skills.find((s: any) => s.ir?.id === "339_03");
  const mark = b.trace.length;
  await sk.execute(b, t, enemies()[0]);
  const dst = new Set(dmgFrom(sinceMark(b, mark), t.id).map((x: any) => x.dst));
  ok("BASE: 焚天九尾 keeps the historical single random target", dst.size === 1, String([...dst]));
  setSkillLevelMode("MAX");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
