// tests/betting-mechanics-5.ts — MAX-mode kits of match 5 (2026-11-23e): 迦楼罗 378 (compile/betting-garuda.ts),
//   心狩鬼女红叶 388 (betting-momiji.ts), 御怨般若 331 (betting-hannya.ts), 入内雀 365 (betting-nyunai.ts), and the
//   action-bar observer they share (betting-bar.ts / kernel/timeline.ts shiftHook).
// Run: node battle-lab/tests/betting-mechanics-5.ts
import { setSkillLevelMode } from "../compile/max-level.ts";
import { assembleGuessingMatch } from "../soul/guessing-match.ts";
import type { MatchFixture, MatchEntry } from "../soul/guessing-match.ts";
import { selectSkillByAI } from "../compile/character.ts";
import { shiftBar } from "../compile/betting-shared.ts";
import { flushBarReactions } from "../compile/betting-bar.ts";
import { GARUDA, FEATHER_ID, hasFeather, featherMisses } from "../compile/betting-garuda.ts";
import { MOMIJI, BURNT_ID, GUARD_ID, EROSION_ID, woodsStacks, burntStacks, applyBurnt } from "../compile/betting-momiji.ts";
import { HANNYA, MARK_ID, HATRED_ID, SEAL_ID, hatredMarks, fieldOpen, masksLeft, gainMarks } from "../compile/betting-hannya.ts";
import { NYUNAI, BLOOD_ID, POSSESS_ID, bloodOf, possessedBy } from "../compile/betting-nyunai.ts";
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
const RED = () => [unit(201, 20000), unit(201, 40000), unit(201, 25000, { spd: 180 }), unit(201, 30000), unit(201, 22000)];
async function match(blue: MatchEntry[], seed = 1, startup = true, red: MatchEntry[] = RED()) {
  const fx: MatchFixture = { _meta: { title: "betting-mechanics-5" }, red, blue };
  const A = await assembleGuessingMatch(fx, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  if (startup) await b.runStartup();
  const find = (charId: number, team = 1) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find, enemies: () => b.enemiesOf(1) as any[], allies: () => b.teams[1].members as any[] };
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const turnEnd = (b: any, actor: any) => b.bus.dispatch("TURN_END", { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const turnStart = (b: any, actor: any) => b.bus.dispatch("TURN_START", { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const actionEnd = (b: any, actor: any) => b.bus.dispatch("ACTION_END", { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const hookMul = (t: any) => {
  const bd = t.breakdown;
  return Number(t.final) / (Number(bd.raw) * Number(bd.defense.multiplier) * Number(bd.modifiers.product) * Number(bd.modifiers.env) * Number(bd.float.value));
};
const pos = (b: any, e: any) => b.timeline.get(e.id)?.pos ?? 0;
const stun = () => StatusBook.get("stun")!;
/** Removes statuses with the usual effect recycling. */
const clear = (e: any, ...ids: string[]) => { for (const st of [...e.statuses]) if (ids.includes(st.def.id)) e.expireStatus(st); };
/** Active cast inside its SKILL resolution scope (as runTurnInner does). */
const cast = (b: any, e: any, id: string, target: any) => {
  const s = sk(e, id);
  return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target));
};

sec("[1] identity: Global names of the match-5 units");
{
  ok("Nyunai-suzume = 365", resolveShiki("Nyunai-suzume")?.id === 365);
  ok("Vengeful Hannya = 331", resolveShiki("Vengeful Hannya")?.id === 331);
  ok("Heartseeker Momiji = 388 (Momiji = SR 231)", resolveShiki("Heartseeker Momiji")?.id === 388 && resolveShiki("Momiji")?.id === 231);
  ok("Garuda = 378", resolveShiki("Garuda")?.id === 378);
}

sec("[2] 迦楼罗: 惜羽 (guaranteed, persistent), bar increase ⇒ normal attack, consume ⇒ heal, shields +20%, L5");
{
  const red = RED().map(u => ({ ...u, stats: { ...u.stats, efr: 500 } }));
  const { b, find, enemies, allies } = await match([unit(378, 20000, { atk: 4000, spd: 120 }), unit(201, 20000), unit(201, 20000)], 4, true, red);
  const g = find(378), foes = enemies();
  b.teams[1].orbs.orb = 8;
  ok("AI: 龙息炽羽 whenever affordable (KB)", selectSkillByAI(b, g, foes)?.ir?.id === "378_03");
  let mark = b.trace.length;
  await sk(g, "378_03").execute(b, g, foes[0]);
  ok("龙息炽羽 L5: 惜羽 on every enemy despite 500% effect RES", foes.every((v: any) => hasFeather(v, g)),
    foes.map((v: any) => hasFeather(v, g)).join(","));
  ok("…persistent (no 1-turn default) and not dispellable", foes[0].statuses.find((s: any) => s.def.id === FEATHER_ID)?.remaining > 1000
    && StatusBook.get(FEATHER_ID)!.dispellable === false);
  const ally = allies()[1];
  ally.hp = 5000;
  mark = b.trace.length;
  shiftBar(b, foes[1], 0.2, "test");
  await flushBarReactions(b);
  const tr = since(b, mark);
  const hit = tr.find((t: any) => t.t === "DAMAGE" && t.src === g.id && t.dst === foes[1].id);
  ok("bar +20% on a feathered enemy ⇒ Garuda normal-attacks it (125%)", !!hit && near(Number(hit.breakdown.base), 4000 * 1.25, 0.01), JSON.stringify(hit?.breakdown?.base));
  ok("…惜羽 consumed", !hasFeather(foes[1], g));
  const heal = tr.find((t: any) => (t.t === "HEAL" || t.t === "RECOVER") && t.src === g.id);
  ok("…the lowest-HP ally recovers GARUDA.healRatio (10%, KB text) of Garuda's max HP", !!heal && heal.dst === ally.id && near(Number(heal.amount), g.maxHp * GARUDA.healRatio, 1), JSON.stringify(heal));
  g.addStatus(stun(), foes[0].id, 1, 1, [], null);
  mark = b.trace.length;
  shiftBar(b, foes[2], 0.2, "test");
  await flushBarReactions(b);
  ok("Garuda stunned (无法动作) ⇒ no attack, 惜羽 kept", !since(b, mark).some((t: any) => t.t === "DAMAGE" && t.src === g.id) && hasFeather(foes[2], g));
  clear(g, "stun");
  foes[3].addShield({ value: 999999, sourceId: foes[3].id, dispellable: true, tag: "t" });
  mark = b.trace.length;
  await cast(b, g, "378_01", foes[3]);
  let t = since(b, mark).find((x: any) => x.t === "DAMAGE" && x.src === g.id);
  ok("天衣妙翅: +20% damage on a shielded enemy", !!t && near(hookMul(t), 1.2, 5e-3), t ? String(hookMul(t)) : "no hit");
  // L5: 5 enemy turn ends without a proc ⇒ free 龙息炽羽.
  const testHit = b.rng.testHit.bind(b.rng);
  b.rng.testHit = () => false;
  const orbs = b.teams[1].orbs.current;
  mark = b.trace.length;
  for (let i = 0; i < 4; i++) await turnEnd(b, foes[i]);
  ok("4 misses counted, no free cast yet", featherMisses(g) === 4 && !since(b, mark).some((x: any) => x.t === "SKILL_CAST" && x.actor === g.id));
  await turnEnd(b, foes[4]);
  b.rng.testHit = testHit;
  ok("5th miss ⇒ free 龙息炽羽 (no onibi)", since(b, mark).some((x: any) => x.t === "SKILL_CAST" && x.actor === g.id && x.skill === "龙息炽羽")
    && b.teams[1].orbs.current === orbs && featherMisses(g) === 0, String(b.teams[1].orbs.current) + "/" + orbs);
}

sec("[3] 心狩鬼女红叶: 先机 枫起之舞, 林隐 / 叶之护, 叶刃, 叶烬 / 红蚀, L4");
{
  const { b, find, enemies, allies } = await match([unit(388, 14000, { atk: 4000, spd: 120 }), unit(201, 20000), unit(201, 20000)], 5);
  const m = find(388), foes = enemies();
  ok("先机: 2 林隐 stacks", woodsStacks(m) === 2);
  ok("…every ally has 叶之护 (+100 DEF)", allies().every((a: any) => a.hasStatus(GUARD_ID)) && near(allies()[1].prop("def"), 500), String(allies()[1].prop("def")));
  b.teams[1].orbs.orb = 8;
  ok("AI: in 林隐 ⇒ normal attack (叶刃), 枫起之舞 gated", selectSkillByAI(b, m, foes)?.ir?.id === "388_01");
  await turnStart(b, m);
  let mark = b.trace.length;
  await cast(b, m, "388_01", foes[0]);
  let hits = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === m.id && t.type === "NORMAL");
  ok("叶刃: 4 strikes of 100% ATK (target + 3 bounces)", hits.length === 4 && hits.every((t: any) => near(Number(t.breakdown.base), 4000, 0.01)) && hits[0].dst === foes[0].id,
    hits.map((t: any) => t.dst + ":" + Math.round(t.breakdown.base)).join(","));
  ok("…every strike puts 1 叶烬 (4 in total)", foes.reduce((n: number, v: any) => n + burntStacks(v), 0) === 4, foes.map((v: any) => burntStacks(v)).join(","));
  ok("…cast in her own turn: 林隐 2 → 1", woodsStacks(m) === 1);
  await actionEnd(b, m);
  // 叶烬 numbers.
  const v = foes[1];
  clear(v, BURNT_ID, "388_poison");
  const atk0 = v.prop("atk"), def0 = v.prop("def"), spd0 = v.prop("spd");
  for (let i = 0; i < 5; i++) applyBurnt(b, m, v, "test");
  ok("5 叶烬: ATK and DEF -50%, SPD -10% (poison)", burntStacks(v) === 5 && near(v.prop("atk"), atk0 * 0.5, 1e-6) && near(v.prop("def"), def0 * 0.5, 1e-6) && near(v.prop("spd"), spd0 * 0.9, 1e-6),
    [v.prop("atk"), v.prop("def"), v.prop("spd")].join(","));
  applyBurnt(b, m, v, "test");
  ok("6th application ⇒ 红蚀 instead (stacks stay 5)", burntStacks(v) === 5 && v.hasStatus(EROSION_ID));
  const p0 = pos(b, v);
  shiftBar(b, v, 0.4, "test");
  ok("红蚀: an action-bar increase is halved (+40% ⇒ +20%)", near(pos(b, v) - p0, 10000 * 0.2, 1e-6), String(pos(b, v) - p0));
  mark = b.trace.length;
  await turnStart(b, v);
  const tick = since(b, mark).find((t: any) => t.t === "DAMAGE" && t.src === m.id && t.dst === v.id && t.type === "INDIRECT");
  ok("turn start: indirect 10% of her ATK (+10% indirect taken per stack, poison DEF -30 per stack)", !!tick && near(Number(tick.breakdown.base), 400, 0.01) && near(hookMul(tick), 1.5 * (300 / 350) / (300 / 500), 5e-3 * 2),
    tick ? tick.breakdown.base + " ×" + hookMul(tick) : "none");
  await turnEnd(b, v);
  ok("turn end: -1 stack", burntStacks(v) === 4);
  mark = b.trace.length;
  await cast(b, m, "388_01", v);
  ok("红蚀 bearer hit by her ⇒ extra indirect 80% ATK", since(b, mark).some((t: any) => t.t === "DAMAGE" && t.src === m.id && t.dst === v.id && t.type === "INDIRECT" && near(Number(t.breakdown.base), 3200, 0.01)));
  // L4 and 叶之护.
  const w = foes[4];
  clear(w, BURNT_ID, "388_poison");
  shiftBar(b, w, 0.25, "test"); await flushBarReactions(b);
  const a25 = burntStacks(w);
  shiftBar(b, w, 0.3, "test"); await flushBarReactions(b);
  ok("经霜 L4: +25% ⇒ nothing, +30% ⇒ 1 叶烬", a25 === 0 && burntStacks(w) === 1, a25 + "→" + burntStacks(w));
  const att = foes[3];
  clear(att, BURNT_ID, "388_poison");
  b.turn = 900;
  await b.damage(att, allies()[1], 100, DamageType.NORMAL);
  await b.damage(att, allies()[1], 100, DamageType.NORMAL);
  ok("叶之护: the attacker gets 1 叶烬, once per turn", burntStacks(att) === 1, String(burntStacks(att)));
  // 林隐 ends ⇒ 叶之护 removed; AI back to 枫起之舞.
  await turnStart(b, m);
  await cast(b, m, "388_01", foes[0]);
  await actionEnd(b, m);
  ok("second 叶刃 in her turn ⇒ 林隐 0, 叶之护 removed", woodsStacks(m) === 0 && !allies().some((a: any) => a.hasStatus(GUARD_ID)));
  ok("AI: not in 林隐 and 3 onibi ⇒ 枫起之舞", selectSkillByAI(b, m, enemies())?.ir?.id === "388_03");
  b.teams[1].orbs.orb = 2;
  ok("AI: 2 onibi ⇒ 乌翎", selectSkillByAI(b, m, enemies())?.ir?.id === "388_01");
  mark = b.trace.length;
  await cast(b, m, "388_01", foes[0]);
  hits = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === m.id && t.type === "NORMAL");
  ok("乌翎 outside 林隐: 1 hit of 125%", hits.length === 1 && near(Number(hits[0].breakdown.base), 5000, 0.01));
  ok("no 林隐 copy from the compiled 乌翎 slot", woodsStacks(m) === 0);
}

sec("[4] 御怨般若: 仇恨印记, 积重难返 gate, 封印结界, branches, 仇恨蔓延");
{
  const { b, find, enemies } = await match([unit(331, 16000, { atk: 4000, spd: 139 }), unit(201, 20000), unit(201, 20000)], 6);
  const h = find(331), foes = enemies();
  ok("先机 L5: 6 marks (+60% effect RES, 30% damage reduction)", hatredMarks(h) === 6 && near(h.prop("efr"), 0.6, 1e-9) && near(h.prop("dmgTakenD"), -0.3, 1e-9),
    hatredMarks(h) + " " + h.prop("efr") + " " + h.prop("dmgTakenD"));
  b.teams[1].orbs.orb = 3;
  ok("AI: 6 marks ⇒ 积重难返 gated ⇒ 予愿必还", selectSkillByAI(b, h, foes)?.ir?.id === "331_03");
  b.teams[1].orbs.orb = 0;
  ok("AI: no onibi ⇒ 恨返", selectSkillByAI(b, h, foes)?.ir?.id === "331_01");
  let mark = b.trace.length;
  await sk(h, "331_01").execute(b, h, foes[0]);
  let hits = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === h.id);
  ok("恨返 outside the field: 1 × 125%, +1 mark", hits.length === 1 && near(Number(hits[0].breakdown.base), 5000, 0.01) && hatredMarks(h) === 7);
  b.turn = 50;
  await b.damage(foes[0], h, 10, DamageType.NORMAL);
  h.addStatus(stun(), foes[0].id, 1, 1, [], null);
  const p0 = pos(b, h);
  gainMarks(b, h, 5, "test");
  ok("reaching 9 (capped): controls removed and +35% bar (Global)", hatredMarks(h) === 9 && !h.hasStatus("stun") && near(pos(b, h) - p0, 3500, 1e-6), String(pos(b, h) - p0));
  ok("AI: 9 marks ⇒ 积重难返 (0 onibi)", selectSkillByAI(b, h, foes)?.ir?.id === "331_02");
  mark = b.trace.length;
  await sk(h, "331_02").execute(b, h, foes[0]);
  ok("积重难返: 9 marks spent, 9 masks", hatredMarks(h) === 0 && masksLeft(h) === 9);
  ok("…every enemy: passives suppressed, souls sealed, crit -30%", foes.every((v: any) => v.statuses.some((s: any) => s.def.id === SEAL_ID && s.def.suppressPassive && s.def.suppressSoul)) 
    && foes[0].statuses.find((s: any) => s.def.id === SEAL_ID).effects.some((e: any) => e.prop === "cri" && near(e.value, HANNYA.demonCrit)));
  ok("…Hannya +30 SPD", near(h.prop("spd"), 139 + HANNYA.fieldSpd, 1e-9));
  ok("…no 仇恨蔓延 / no mark from the compiled slots", !since(b, mark).some((t: any) => t.t === "STATUS_APPLY" && (t.status === HATRED_ID || t.status === MARK_ID)));
  ok("AI: field open ⇒ 积重难返 gated", selectSkillByAI(b, h, foes)?.ir?.id === "331_01");
  mark = b.trace.length;
  await sk(h, "331_01").execute(b, h, foes[0]);
  hits = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === h.id);
  ok("恨返 in the field: 2 × 100% with 15% lifesteal, no mark", hits.length === 2 && hits.every((t: any) => near(Number(t.breakdown.base), 4000, 0.01)) && hatredMarks(h) === 0);
  b.teams[1].orbs.orb = 8;
  mark = b.trace.length;
  await sk(h, "331_03").execute(b, h, foes[0]);
  hits = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === h.id);
  ok("予愿必还 in the field: 3 × 80% + 2 waves × 80% on all 5", hits.length === 3 + 2 * 5 && hits.every((t: any) => near(Number(t.breakdown.base), 3200, 0.01)), String(hits.length));
  for (let i = 0; i < 8; i++) await turnEnd(b, foes[i % 5]);
  ok("8 enemy turn ends ⇒ 1 mask left", fieldOpen(h) && masksLeft(h) === 1);
  mark = b.trace.length;
  await turnEnd(b, foes[0]);
  ok("9th ⇒ field closed, seals removed, 仇恨蔓延 on the enemies", !fieldOpen(h) && !foes.some((v: any) => v.hasStatus(SEAL_ID)) && foes.some((v: any) => v.hasStatus(HATRED_ID))
    && near(h.prop("spd"), 139, 1e-9));
  const hated = foes.find((v: any) => v.hasStatus(HATRED_ID));
  ok("仇恨蔓延: crit +50%, damage dealt -35%", !!hated && near(hated.prop("dmgDealtB"), -0.35, 1e-9));
  const before = hatredMarks(h);
  await sk(h, "331_01").execute(b, h, hated);
  ok("attacking a 仇恨蔓延 enemy: +1 (cast) +1 (仇恨蔓延)", hatredMarks(h) === before + 2, before + "→" + hatredMarks(h));
}

sec("[5] 入内雀: 附身 先机 / lethal, 腐化 / 腐血, 雀啄, 协战");
{
  const { b, find, allies, enemies } = await match([
    unit(365, 16000, { atk: 4500, def: 1000, spd: 156 }), unit(201, 20000, { atk: 6000, def: 500 }), unit(201, 30000, { atk: 3000 }),
  ], 7);
  const n = find(365), foes = enemies(), [ , yoto, other] = allies();
  ok("先机: possesses the highest-ATK ally", possessedBy(b, n)?.id === yoto.id);
  ok("…it gains his initial DEF capped at 100% of its own (+500)", near(yoto.prop("def"), 1000, 1e-9), String(yoto.prop("def")));
  ok("…he gains its initial ATK capped at 100% of his own (+4500)", near(n.prop("atk"), 9000, 1e-9), String(n.prop("atk")));
  b.teams[1].orbs.orb = 8;
  ok("AI: 腐化 whenever affordable", selectSkillByAI(b, n, foes)?.ir?.id === "365_03");
  b.teams[1].orbs.orb = 2;
  ok("AI: 2 onibi ⇒ 雀啄", selectSkillByAI(b, n, foes)?.ir?.id === "365_01");
  let mark = b.trace.length;
  await sk(n, "365_01").execute(b, n, foes[2]);
  const hits = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === n.id);
  ok("雀啄: chosen enemy, 50% ATK + 90% DEF true damage", hits.length === 2 && hits.every((t: any) => t.dst === foes[2].id)
    && near(Number(hits[0].breakdown.base), 9000 * 0.5, 0.01) && hits[1].type === "TRUE" && near(Number(hits[1].breakdown.base), 900, 0.01),
    hits.map((t: any) => t.dst + ":" + t.type + ":" + Math.round(t.breakdown.base)).join(","));
  b.teams[1].orbs.orb = 8;
  const decay = sk(n, "365_03");
  const tgt = decay.pickTarget(b, n, foes);
  ok("腐化 target: an ally without 腐血 (not himself)", tgt.teamId === n.teamId && tgt.id !== n.id);
  const max0 = tgt.maxHp;
  await decay.execute(b, n, tgt);
  const cut = Math.min(20 * 1000, max0 * 0.5);
  ok("腐化: max HP -min(2000% DEF, 50%), same amount of 腐血", near(tgt.maxHp, max0 - cut, 1e-6) && near(bloodOf(tgt), cut, 1e-6), tgt.maxHp + " / " + bloodOf(tgt));
  ok("…腐血: crit -10%, damage dealt +25%, cannot be healed", near(tgt.prop("dmgDealtB"), 0.25, 1e-9) && tgt.caps.receivesHeal === false);
  ok("…Nyunai +10 SPD / +20% RES / 10% reduction per ally with 腐血", near(n.prop("spd"), 156 + NYUNAI.perSpd, 1e-9) && near(n.prop("dmgTakenD"), -0.1, 1e-9));
  const hp0 = tgt.hp;
  mark = b.trace.length;
  await b.damage(foes[0], tgt, 3000, DamageType.TRUE);
  ok("腐血 absorbs 3 damage per point before HP", near(tgt.hp, hp0, 1e-6) && near(bloodOf(tgt), cut - 1000, 5), tgt.hp + " " + bloodOf(tgt));
  ok("腐化 cannot target the ally with 腐血 again", decay.pickTarget(b, n, foes)?.id !== tgt.id);
  // Lethal on the possessed ally.
  mark = b.trace.length;
  const yotoMax0 = yoto.maxHp;
  await b.damage(foes[0], yoto, 999999, DamageType.TRUE);
  ok("lethal damage on the possessed ally: survives at 1/1 HP, 附身 consumed", yoto.alive && near(yoto.hp, 1) && near(yoto.maxHp, 1) && !yoto.hasStatus(POSSESS_ID),
    yoto.alive + " " + yoto.hp + "/" + yoto.maxHp);
  ok("…腐血 = lost max HP (cap 4000% DEF), his ATK bonus gone", near(bloodOf(yoto), Math.min(yotoMax0 - 1, 40 * 1000), 1e-6) && near(n.prop("atk"), 4500, 1e-9), String(bloodOf(yoto)));
  // 协战 at 100% after the consumption.
  mark = b.trace.length;
  await b.runPseudoTurn(other, TurnType.PSEUDO_TURN, { skill: other.skills.find((s: any) => s.cost === 0), target: foes[1] });
  ok("协战 at 100% after 附身 was consumed: 雀啄 on the same enemy", since(b, mark).some((t: any) => t.t === "ASSIST" && t.actor === n.id && t.target === foes[1].id && t.chance === 1));
}

sec("[6] full battles, determinism, BASE mode");
{
  const run = async () => {
    const { b } = await match([unit(378, 20000, { spd: 200 }), unit(388, 14000), unit(331, 16000), unit(365, 16000, { def: 1000 }), unit(201, 20000)], 88, false);
    const r = await b.run();
    return JSON.stringify([r.winner, r.turns, b.trace.length, b.rng.draws.length]);
  };
  const a = await run(), c = await run();
  ok("same seed ⇒ identical battle", a === c, a);
  setSkillLevelMode("BASE");
  const { b, find, allies } = await match([unit(388, 14000), unit(331, 16000), unit(365, 16000), unit(378, 20000), unit(201, 20000)], 3);
  ok("BASE: no 林隐 先机, no marks, no 附身, no bar hook", woodsStacks(find(388)) === 0 && hatredMarks(find(331)) === 0
    && !allies().some((m: any) => m.hasStatus(POSSESS_ID)) && b.timeline.shiftHook === null);
  setSkillLevelMode("MAX");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
