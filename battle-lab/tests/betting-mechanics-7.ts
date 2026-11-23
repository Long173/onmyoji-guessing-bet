// tests/betting-mechanics-7.ts — MAX-mode kits and souls from match 6 (2026-11-23f): 封阳君 575 (betting-fengyang.ts),
//   铃彦姬 376 (betting-suzuhiko.ts), 麓铭大岳丸 355 (betting-otakemaru.ts), 因幡辉夜姬 372 (betting-inaba.ts),
//   蝴蝶精 241 / 蜜桃&芥子 310 (betting-chocho.ts), 黑童子 277 (betting-kuro.ts), 入殓师 321 (betting-okuribito.ts),
//   souls 日女巳时 / 三味 / 骰子鬼 (soul/custom-effects-betting.ts).
// Run: node battle-lab/tests/betting-mechanics-7.ts
import { setSkillLevelMode } from "../compile/max-level.ts";
import { assembleGuessingMatch } from "../soul/guessing-match.ts";
import type { MatchFixture, MatchEntry } from "../soul/guessing-match.ts";
import { selectSkillByAI } from "../compile/character.ts";
import { bettingCostOf, bettingPreferredSkill } from "../compile/betting-mechanics.ts";
import { WANTED_ID, SNOW_ID, SKY_ID, F_SHELTER_ID, styleOf } from "../compile/betting-fengyang.ts";
import { FIRE_ID, UNDYING_ID, pierceStacks } from "../compile/betting-suzuhiko.ts";
import { COMMAND_ID, EROSION_ID, CRUSH_ID, MARSH_ID, marshStacks } from "../compile/betting-otakemaru.ts";
import { ILLUSION_ID, BLESS_ID, illusionLeft, provided, wishPower } from "../compile/betting-inaba.ts";
import { NIMBLE_ID, nimbleStacks } from "../compile/betting-chocho.ts";
import { RETURN_ID } from "../compile/betting-kuro.ts";
import { COFFIN_ID } from "../compile/betting-okuribito.ts";
import { SAMISEN_ID } from "../soul/custom-effects-betting.ts";
import { BETTING_ONLY_SOULS, customSoulFor } from "../soul/custom-effects.ts";
import { bettingAiRuleOf, bettingKitSkillOf } from "../compile/betting-coverage.ts";
import { StatusBook } from "../kernel/status.ts";
import { DamageType, TurnType } from "../kernel/types.ts";
import { resolveShiki } from "../../matches/names.ts";

setSkillLevelMode("MAX");

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };
const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const unit = (shikigamiId: number, hp: number, extra: Partial<MatchEntry["stats"]> = {}, soul: number | null = null): MatchEntry => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: soul === null ? [] : [soul, soul, soul, soul],
});
const RED = () => [unit(201, 20000), unit(201, 40000), unit(201, 25000, { spd: 180 }), unit(201, 30000), unit(201, 22000)];
async function match(blue: MatchEntry[], seed = 1, red: MatchEntry[] = RED()) {
  const fx: MatchFixture = { _meta: { title: "betting-mechanics-7" }, red, blue };
  const A = await assembleGuessingMatch(fx, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  const find = (charId: number, team = 1) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find, enemies: () => b.enemiesOf(1) as any[], allies: () => b.teams[1].members as any[] };
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const dispatch = (b: any, code: string, actor: any, type = TurnType.NORMAL) => b.bus.dispatch(code, { actor, type }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const pos = (b: any, e: any) => b.timeline.get(e.id)?.pos ?? 0;
const cast = (b: any, e: any, id: string, target: any) => {
  const s = sk(e, id);
  return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target));
};

sec("[1] identity, coverage");
{
  ok("Fengyang 575, Suzuhikohime 376, Monumental Otakemaru 355, Inaba Kaguya Hime 372",
    resolveShiki("Fengyang")?.id === 575 && resolveShiki("Suzuhikohime")?.id === 376 && resolveShiki("Monumental Otakemaru")?.id === 355 && resolveShiki("Inaba Kaguya Hime")?.id === 372);
  ok("Chocho 241, Kuro 277, Okuribito 321", resolveShiki("Chocho")?.id === 241 && resolveShiki("Kuro")?.id === 277 && resolveShiki("Okuribito")?.id === 321);
  ok("AI rules declared for 575 / 376 / 355 / 372 / 321", [575, 376, 355, 372, 321].every(id => !!bettingAiRuleOf(id)));
  ok("kit skills declared", ["575_02", "376_03", "355_02", "372_02", "241_02", "277_02", "321_03"].every(id => !!bettingKitSkillOf(id)));
  ok("日女巳时 / 三味 / 骰子鬼 are betting-only custom souls", ["日女巳时", "三味", "骰子鬼"].every(n => BETTING_ONLY_SOULS.has(n) && typeof customSoulFor(n) === "function"));
}

sec("[2] 封阳君: 庇护, 望月星河 (no style → 晴空), 通缉, +100% bar in own turn, style costs, 寒雪");
{
  const { b, find, enemies } = await match([unit(575, 20000, { atk: 4000 }), unit(201, 20000), unit(201, 20000)], 3);
  const f = find(575), foes = enemies();
  ok("庇护 at battle start, no style", f.hasStatus(F_SHELTER_ID) && styleOf(f) === "NONE");
  b.teams[1].orbs.orb = 4;
  ok("AI: 望月星河 whenever affordable", bettingPreferredSkill(b, f)?.skill?.ir?.id === "575_03");
  ok("no style: 望月星河 costs 0 (KB 1, L5 -1)", bettingCostOf(b, f, sk(f, "575_03")) === 0);
  await dispatch(b, "TURN_START", f);   // own turn (betting-scope tracker)
  const p0 = pos(b, f);
  let mark = b.trace.length;
  await cast(b, f, "575_03", foes[0]);
  const hits = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === f.id);
  ok("3 waves × all 5 enemies", hits.length === 15, String(hits.length));
  ok("通缉 on every enemy hit (+50% damage taken)", foes.every((v: any) => v.hasStatus(WANTED_ID) && near(v.prop("dmgTakenD"), 0.5)));
  ok("switches to 晴空 with 50% damage reduction", styleOf(f) === "SKY" && near(f.prop("dmgTakenD"), -0.5));
  ok("switch in own turn: +100% action bar, 庇护 again", pos(b, f) - p0 >= 9999 && f.hasStatus(F_SHELTER_ID), String(pos(b, f) - p0));
  ok("晴空: 望月星河·艳阳 costs 2 (3 - 1)", bettingCostOf(b, f, sk(f, "575_03")) === 2);
  mark = b.trace.length;
  await cast(b, f, "575_03", foes[0]);
  ok("re-casting in 晴空: no second bar boost in the same turn, 通缉 refreshed not stacked",
    !since(b, mark).some((t: any) => t.t === "TIMELINE_SHIFT" && t.id === f.id) && near(foes[0].prop("dmgTakenD"), 0.5));
  mark = b.trace.length;
  await cast(b, f, "575_01", foes[1]);
  const basic = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === f.id);
  ok("晴空 normal attack = 3 hits; then 霁雪", basic.length === 3 && styleOf(f) === "SNOW" && f.hasStatus(SNOW_ID) && !f.hasStatus(SKY_ID), String(basic.length));
  mark = b.trace.length;
  await cast(b, f, "575_01", foes[1]);
  ok("寒雪 = 2 hits", since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === f.id).length === 2);
}

sec("[3] 铃彦姬: AI by HP, 五山火祭 loop, 神火, 铃焰灼心, 心火永明");
{
  const { b, find, enemies } = await match([unit(376, 20000, { atk: 3000 }), unit(201, 20000), unit(201, 20000)], 5,
    [unit(201, 90000), unit(201, 90000), unit(201, 90000), unit(201, 90000), unit(201, 90000)]);
  const s = find(376), foes = enemies(), pool = b.teams[1].orbs;
  ok("AI: HP > 50% → 五山火祭", selectSkillByAI(b, s, foes)?.ir?.id === "376_03");
  pool.orb = 8;
  let mark = b.trace.length;
  await cast(b, s, "376_03", foes[0]);
  const waves = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === s.id).length / 5;
  ok("72% + 4 repeats (13% HP each) until HP < 50%", waves === 5 && near(s.hp / s.maxHp, 0.48, 1e-6), waves + " / " + s.hp / s.maxHp);
  ok("4 onibi paid", pool.orb === 4, String(pool.orb));
  ok("5 attacks ⇒ 1 ignore-DEF stack (L5)", pierceStacks(s) === 1);
  ok("below 75% ⇒ 神火", s.hasStatus(FIRE_ID));
  ok("AI: HP < 50% → 铃焰灼心", selectSkillByAI(b, s, foes)?.ir?.id === "376_02");
  await cast(b, s, "376_02", s);
  ok("铃焰灼心: +40% max HP", near(s.hp / s.maxHp, 0.88, 1e-6), String(s.hp / s.maxHp));
  s.hp = s.maxHp - 1;
  await dispatch(b, "TURN_END", find(201));   // ally turn end: +8% ⇒ full ⇒ 神火 fires
  ok("ally turn end (L3) fills HP ⇒ 神火 fires a free 五山火祭", b.trace.some((t: any) => t.t === "SUBCAST" && t.actor === s.id && t.ref === "376_03"));
  mark = b.trace.length;
  s.hp = 10;
  await b.damage(foes[0], s, 999999, DamageType.TRUE, 1, null);
  ok("lethal ⇒ 心火永明: alive, immobile, ~50% HP, shield", s.alive && s.hasStatus(UNDYING_ID) && s.statuses.find((x: any) => x.def.id === UNDYING_ID)?.def.preventsAction
    && s.hp > s.maxHp * 0.49 && (s.shields ?? []).some((x: any) => !x.broken), String(s.hp));
  s.hp = s.maxHp * 0.2;
  const others = b.teams[1].members.filter((m: any) => m.id !== s.id);
  others[0].hp = 1; await b.damage(foes[0], others[0], 999999, DamageType.TRUE, 1, null);
  ok("another unit falls ⇒ she recovers 50% and stays in 心火永明", s.alive && s.hasStatus(UNDYING_ID) && near(s.hp / s.maxHp, 0.7, 1e-6), String(s.hp / s.maxHp));
  others[1].hp = 1; await b.damage(foes[0], others[1], 999999, DamageType.TRUE, 1, null);
  ok("last ally falls ⇒ she falls too", !s.alive && s.dead);
}

sec("[4] 麓铭大岳丸: 先机 驭魂形态, 麓泽, single-target cut, 麓蚀 → 麓压, AI");
{
  const { b, find, enemies } = await match([unit(355, 20000), unit(201, 20000), unit(201, 20000)], 7);
  const o = find(355), foes = enemies(), ally = b.teams[1].members.find((m: any) => m.id !== o.id);
  ok("驭魂形态 at battle start (+100% effect RES)", o.hasStatus(COMMAND_ID) && near(o.prop("efr"), 1));
  await b.bus.dispatch("SKILL_END", { battle: b, actor: ally, skill: sk(ally, "201_03") ?? { cost: 2, ir: { id: "201_03" } }, target: foes[0] }, ally.id, ally.teamId, (id: number) => b.teamOf(id));
  ok("ally onmyojutsu ⇒ 1 麓泽; 断末无铭 costs 4 - 1", marshStacks(o) === 1 && o.hasStatus(MARSH_ID) && bettingCostOf(b, o, sk(o, "355_03")) === 3);
  b.teams[1].orbs.orb = 8;
  ok("AI in the form: 断末无铭", bettingPreferredSkill(b, o)?.skill?.ir?.id === "355_03");
  await cast(b, o, "355_01", foes[0]);
  ok("麓影·蚀 puts 麓蚀 (ATK -15%)", foes[0].hasStatus(EROSION_ID) && near(foes[0].prop("atk"), 3000 * 0.85));
  await dispatch(b, "TURN_END", foes[0]);
  ok("bearer turn end ⇒ 麓压 (dazed, SPD -30%)", foes[0].hasStatus(CRUSH_ID) && !foes[0].hasStatus(EROSION_ID) && near(foes[0].prop("spd"), 70));
  await dispatch(b, "TURN_START", foes[0]);
  ok("麓压 ends at its next turn start", !foes[0].hasStatus(CRUSH_ID));
  for (const st of [...o.statuses]) if (st.def.id === COMMAND_ID) o.expireStatus(st);
  ok("AI out of the form: 铭海之主", bettingPreferredSkill(b, o)?.skill?.ir?.id === "355_02");
}

sec("[5] 因幡辉夜姬: 先机 幻境, 愿力 pays costs, provided riders, 愿佑, AI");
{
  const { b, find, enemies } = await match([unit(372, 20000, { crid: 200, def: 500 }), unit(201, 20000), unit(201, 20000)], 9);
  const k = find(372), pool = b.teams[1].orbs, ally = b.teams[1].members.find((m: any) => m.id !== k.id);
  ok("先机: illusion (2 turns, +80% RES) and 3 愿力", k.hasStatus(ILLUSION_ID) && illusionLeft(k) === 2 && wishPower(b, 1) === 3 && near(k.prop("efr"), 0.8));
  ok("AI with 2 turns left: 寂光映月", bettingPreferredSkill(b, k)?.skill?.ir?.id === "372_03");
  pool.orb = 0;
  ok("onibi 0 but 3 愿力 ⇒ a 3-cost skill is affordable", pool.canPay(3) && !pool.canPay(4));
  const crid0 = k.prop("crid");
  ok("paying with 愿力", pool.pay(3, "orb", "COST") === true && wishPower(b, 1) === 0 && pool.orb === 0);
  ok("provided 3 ⇒ +15% crit damage (L2), 3 shields of 12% max HP (L3)", provided(k) === 3 && near(k.prop("crid") - crid0, 0.15)
    && (k.shields ?? []).filter((x: any) => !x.broken && String(x.id).startsWith("sh_372wish_")).length === 3);
  await b.bus.dispatch("SKILL_END", { battle: b, actor: ally, skill: sk(ally, "201_01"), target: enemies()[0] }, ally.id, ally.teamId, (id: number) => b.teamOf(id));
  ok("ally cast in the illusion ⇒ 愿佑 (30% of her crit damage / DEF)", ally.hasStatus(BLESS_ID) && near(ally.prop("def"), 400 + 150), String(ally.prop("def")));
  await dispatch(b, "TURN_END", k);
  ok("her turn end: 1 turn left ⇒ AI 愿满夜", illusionLeft(k) === 1 && (pool.orb = 4, bettingPreferredSkill(b, k)?.skill?.ir?.id === "372_02"));
}

sec("[6] 蝴蝶精 / 蜜桃&芥子 / 黑童子 / 入殓师");
{
  const { b, find, enemies } = await match([unit(241, 20000), unit(201, 20000), unit(277, 20000, { atk: 4000 }), unit(321, 20000), unit(310, 20000)], 11);
  const c = find(241), k = find(277), o = find(321), foes = enemies();
  const low = b.teams[1].members.find((m: any) => m.skills.some((s: any) => s.ir?.charId === 201));
  low.hp = low.maxHp * 0.15;
  await dispatch(b, "TURN_START", foes[0]);
  ok("轻盈: 85% lost ⇒ 4 stacks, +120 SPD; 祈愿之舞 costs 0", nimbleStacks(c) === 4 && c.hasStatus(NIMBLE_ID) && near(c.prop("spd"), 220) && bettingCostOf(b, c, sk(c, "241_03")) === 0);
  ok("回魂 at battle start (先机)", k.hasStatus(RETURN_ID));
  k.hp = 5;
  await b.damage(foes[0], k, 999999, DamageType.TRUE, 1, null);
  ok("回魂: lethal ⇒ 1 HP + shield, consumed", k.alive && k.hp === 1 && !k.hasStatus(RETURN_ID) && (k.shields ?? []).some((x: any) => !x.broken && String(x.id).startsWith("sh_2772_")));
  let mark = b.trace.length;
  await cast(b, k, "277_03", foes[0]);
  ok("连斩 at 1 HP: 1 + 3 attacks on every enemy", since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === k.id && t.depth !== undefined).length >= 20);
  b.teams[1].orbs.orb = 8;
  ok("入殓师 AI: coffin first", bettingPreferredSkill(b, o)?.skill?.ir?.id === "321_03");
  mark = b.trace.length;
  await cast(b, o, "321_03", o);
  ok("coffin: no damage on cast, 织雪 (DEF +250% base, RES +70%)", !since(b, mark).some((t: any) => t.t === "DAMAGE" && t.src === o.id) && o.hasStatus(COFFIN_ID) && near(o.prop("efr"), 0.7));
  ok("coffin on cooldown ⇒ AI 离魂", bettingPreferredSkill(b, o)?.skill?.ir?.id === "321_02");
  mark = b.trace.length;
  await dispatch(b, "TURN_END", foes[2]);
  ok("enemy turn end ⇒ coffin strike on it and the lowest-HP-ratio other enemy", since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === o.id).length === 2);
}

sec("[7] souls: 日女巳时 push, 三味 SPD, 骰子鬼 counter / bar");
{
  const { b, find, enemies } = await match([unit(201, 20000, { atk: 3000 }, 10), unit(241, 20000, {}, 4), unit(372, 20000, {}, 24)], 13);
  const installed = (b as any).soulReport.installed.filter((x: any) => x.kind === "CUSTOM").map((x: any) => x.name);
  ok("all three installed as CUSTOM", ["日女巳时", "三味", "骰子鬼"].every(n => installed.includes(n)), installed.join(","));
  const dawn = b.teams[1].members.find((m: any) => m.skills.some((s: any) => s.ir?.charId === 201)), foes = enemies();
  let mark = b.trace.length;
  for (let i = 0; i < 30; i++) await b.damage(dawn, foes[0], 1000, DamageType.NORMAL, 1, null);
  const pushes = since(b, mark).filter((t: any) => t.t === "TIMELINE_SHIFT" && t.id === foes[0].id && near(t.percent, -0.3));
  ok("日女巳时: some of 30 hits push the target back 30%", pushes.length > 0 && pushes.length < 20, String(pushes.length));
  const c = find(241);
  dawn.addStatus(StatusBook.get("stun")!, foes[0].id, 1, 1, [], null);
  await b.drainEvents();
  ok("三味: ally stunned ⇒ that ally +30 SPD (non-dispellable)", dawn.hasStatus(SAMISEN_ID) && near(dawn.prop("spd"), 130), String(dawn.prop("spd")));
  void c;
  const k = find(372);
  const p0 = pos(b, k);
  k.addStatus(StatusBook.get("silence")!, foes[0].id, 1, 1, [], null);
  await b.drainEvents();
  ok("骰子鬼: control while not controlled ⇒ +25% bar", pos(b, k) - p0 >= 2499, String(pos(b, k) - p0));
  mark = b.trace.length;
  await b.bus.dispatch("RESIST", { target: k, source: foes[1], status: StatusBook.get("stun"), probability: 1, effective: 0.5, duration: 1 }, k.id, k.teamId, (id: number) => b.teamOf(id));
  ok("骰子鬼: resist ⇒ counter-attack, bonus removed afterwards", since(b, mark).some((t: any) => t.t === "COUNTER" && t.actor === k.id) && near(k.prop("dmgDealtB"), 0));
}

sec("[8] determinism, BASE untouched");
{
  const run = async () => {
    const fx: MatchFixture = { _meta: { title: "bm7" }, red: [unit(596, 22000), unit(277, 14000, { atk: 5000 }), unit(344, 11000, { atk: 4000, def: 700 }), unit(321, 12000), unit(310, 25000)],
      blue: [unit(575, 14500, { spd: 188 }), unit(376, 12000), unit(355, 13000), unit(241, 23000), unit(372, 13000)] };
    const A: any = await assembleGuessingMatch(fx, { seed: 21, traceLevel: "FULL" });
    const r = await A.battle.run();
    return JSON.stringify([r.winner, r.turns, A.battle.trace.length, A.battle.rng.draws.length]);
  };
  const a = await run(), c = await run();
  ok("same seed ⇒ identical battle", a === c, a);
  setSkillLevelMode("BASE");
  const { find } = await match([unit(575, 20000), unit(355, 20000), unit(372, 20000)], 3);
  ok("BASE: no 庇护 / 驭魂形态 / 幻境", !find(575).hasStatus(F_SHELTER_ID) && !find(355).hasStatus(COMMAND_ID) && !find(372).hasStatus(ILLUSION_ID));
  ok("BASE: souls not custom", customSoulFor("日女巳时") === null && bettingAiRuleOf(575) === null);
  setSkillLevelMode("MAX");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
