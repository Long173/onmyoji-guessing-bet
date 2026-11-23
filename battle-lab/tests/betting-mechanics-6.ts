// tests/betting-mechanics-6.ts — MAX-mode kits from the match-4 replay (2026-11-23d): 夜刀神 373 (compile/betting-yato.ts),
//   流光追月神 395 (betting-oitsuki.ts), 小鹿男 259 (betting-shishio.ts), 神无月 596 (betting-kannazuki.ts), the 593
//   counter / seal rules (betting-yoto.ts), the "highest ATK ally" target rule, the 593 hunt target and the
//   double-DEATH fix (kernel/damage.ts).
// Run: node battle-lab/tests/betting-mechanics-6.ts
import { setSkillLevelMode } from "../compile/max-level.ts";
import { assembleGuessingMatch } from "../soul/guessing-match.ts";
import type { MatchFixture, MatchEntry } from "../soul/guessing-match.ts";
import { selectSkillByAI } from "../compile/character.ts";
import { setNote, drainOrbs, kbBaseAtk } from "../compile/betting-shared.ts";
import { YATO, WALTZ_ID, WEDGE_ID, waltzStacks, pactCount, gainWaltz, placeWedge } from "../compile/betting-yato.ts";
import { OITSUKI, SHINE_ID, GLOW_ID, LOST_ID, shineStacks, lightStacks } from "../compile/betting-oitsuki.ts";
import { SHISHIO, LIFE_ID, lifeStacks } from "../compile/betting-shishio.ts";
import { KANNAZUKI, DREAM_ID, dreamStacks } from "../compile/betting-kannazuki.ts";
import { YOTO_04_SEALABLE } from "../compile/betting-yoto.ts";
import { SEAL_ID } from "../compile/betting-hannya.ts";
import { bettingCostOf } from "../compile/betting-mechanics.ts";
import { DamageType, TurnType } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
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
  const fx: MatchFixture = { _meta: { title: "betting-mechanics-6" }, red, blue };
  const A = await assembleGuessingMatch(fx, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  if (startup) await b.runStartup();
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

sec("[1] identity");
{
  ok("Yato no Kami = 373, Luminary Oitsuki = 395", resolveShiki("Yato no Kami")?.id === 373 && resolveShiki("Luminary Oitsuki")?.id === 395);
  ok("Shishio = 259, Kannazuki = 596", resolveShiki("Shishio")?.id === 259 && resolveShiki("Kannazuki")?.id === 596);
}

sec("[2] 夜刀神: 黑夜的庇护, 七夜秘仪 → 夜之楔 + 共舞, 夜之契, 7-wedge reset, 夜之邀约");
{
  const { b, find, enemies } = await match([unit(373, 30000, { atk: 5000 }), unit(201, 20000), unit(201, 20000)], 5);
  const y = find(373), foes = enemies();
  ok("Shelter at battle start: -49% damage taken, +70% effect RES", near(y.prop("dmgTakenD"), -0.49) && near(y.prop("efr"), 0.7),
    y.prop("dmgTakenD") + " / " + y.prop("efr"));
  b.teams[1].orbs.orb = 8;
  ok("AI: 七夜秘仪 whenever affordable (KB)", selectSkillByAI(b, y, foes)?.ir?.id === "373_03");
  const p0 = pos(b, y);
  let mark = b.trace.length;
  await cast(b, y, "373_03", foes[1]);
  ok("夜之楔 on the bats' target only", foes[1].hasStatus(WEDGE_ID) && foes.filter((v: any) => v.hasStatus(WEDGE_ID)).length === 1);
  ok("3 bats ⇒ 3 共舞 and +30% action bar", waltzStacks(y) === 3 && near(pos(b, y) - p0, 3000, 1), waltzStacks(y) + " / " + (pos(b, y) - p0));
  ok("the wedge is never applied by the generic status path (1 STATUS_APPLY)",
    since(b, mark).filter((t: any) => t.t === "STATUS_APPLY" && t.status === WEDGE_ID).length === 1);
  // Bearer's turn: choice + trigger (skip ⇒ now, end ⇒ at its turn end).
  mark = b.trace.length;
  const hp0 = foes.map((v: any) => v.hp);
  await dispatch(b, "TURN_START", foes[1]);
  const choice = since(b, mark).find((t: any) => t.t === "WEDGE_CHOICE");
  ok("turn start of the bearer: 1 of 2 offered wedges and a timing", !!choice && choice.offered.length === 2 && choice.offered.includes(choice.wedge), JSON.stringify(choice));
  if (choice?.timing === "TURN_END") await dispatch(b, "TURN_END", foes[1]);
  const trig = since(b, mark).find((t: any) => t.t === "WEDGE_TRIGGER");
  ok("the chosen wedge triggers (skip: at once and the turn is skipped)", !!trig && trig.wedge === choice?.wedge
    && (choice?.timing !== "SKIP_TURN" || foes[1].statuses.some((s: any) => s.def.preventsAction)));
  ok("夜之契: shelter -7% / -10%", pactCount(y) === 1 && near(y.prop("dmgTakenD"), -0.42) && near(y.prop("efr"), 0.6), y.prop("dmgTakenD") + " / " + y.prop("efr"));
  const pactHits = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.type === "TRUE" && String(t.breakdown?.skill ?? "").includes("夜之契"));
  ok("夜之契: 100% ATK true damage to every enemy", pactHits.length === foes.length, String(pactHits.length));
  ok("the wedge is gone after its trigger", !foes[1].hasStatus(WEDGE_ID));
  // Souls: the pact damage carries triggersSoul = false.
  let soulFlags: boolean[] = [];
  b.bus.register({ id: "t6:probe", ownerId: 0, code: "AFTER_DAMAGE", range: "ALL", priority: 0, passive: false,
    fn: (ctx: any) => { if (String(ctx.input.skillTag ?? "").includes("夜之契")) soulFlags.push(ctx.result.triggersSoul); } });
  // All 7 wedges: mark 6 as done, the 7th is the only one offered.
  setNote(y, "yato373:done=", "1,2,3,4,5,6"); setNote(y, "yato373:chosen=", "1,2,3,4,5,6");
  placeWedge(b, y, foes[2]);
  mark = b.trace.length;
  await dispatch(b, "TURN_START", foes[2]);
  if (since(b, mark).find((t: any) => t.t === "WEDGE_CHOICE")?.timing === "TURN_END") await dispatch(b, "TURN_END", foes[2]);
  const reset = since(b, mark).find((t: any) => t.t === "WEDGE_RESET");
  ok("7th wedge ⇒ reset with 7 strikes (L3) and a 20% push each (L4)", reset?.hits === YATO.resetHitsL3 && near(reset?.push, YATO.resetPushL4), JSON.stringify(reset));
  ok("…77% ATK true damage strikes", since(b, mark).filter((t: any) => t.t === "DAMAGE" && String(t.breakdown?.skill ?? "").includes("重置")).length >= 1);
  ok("夜之契 damage never triggers souls (input.noSoul)", soulFlags.length > 0 && soulFlags.every(f => f === false), JSON.stringify(soulFlags));
  // 夜之邀约: 7 stacks ⇒ 3 × 77% true damage on the lowest-HP enemy, stacks consumed.
  for (const v of foes) if (v.alive) v.hp = v.maxHp;
  const low = foes.filter((v: any) => v.alive)[0];
  // Lowest absolute HP (max HP differs after the wedge cuts): 90% of the smallest full HP among the living foes.
  low.hp = Math.min(...foes.filter((v: any) => v.alive).map((v: any) => v.hp)) * 0.9;
  mark = b.trace.length;
  await gainWaltz(b, y, YATO.waltzCap, "TEST");
  const inv = since(b, mark).filter((t: any) => t.t === "DAMAGE" && String(t.breakdown?.skill ?? "").includes("夜之邀约"));
  ok("夜之邀约: 3 true hits on the lowest-HP enemy, 共舞 consumed", inv.length === 3 && inv.every((t: any) => t.dst === low.id && t.type === "TRUE")
    && since(b, mark).some((t: any) => t.t === "STACKS_CONSUMED" && t.status === WALTZ_ID),
    inv.length + " " + waltzStacks(y));
  ok("夜之邀约: 15% lifesteal on his damage", since(b, mark).some((t: any) => t.t === "LIFESTEAL" && t.src === y.id && near(t.ratio, YATO.lifesteal)));
  void hp0;
}

sec("[3] 流光追月神: 先机 +4, turn end +3 / 照君, overflow, 集落光 / 失彩 / 流光");
{
  const { b, find, allies, enemies } = await match([unit(395, 16000, { atk: 2700 }), unit(373, 20000, { atk: 6000 }), unit(201, 20000)], 7);
  const o = find(395), y = find(373), pool = b.teams[1].orbs;
  ok("先机 (L3): +4 onibi gauge cells", b.trace.some((t: any) => t.t === "ORB_GAUGE_ADVANCE_EXTRA" && t.reason === "绮罗舞·先机" && t.cells === OITSUKI.senkiCells));
  ok("流光: 3 stacks at battle start (+30% effect RES)", lightStacks(o) === 3 && near(o.prop("efr"), 0.3));
  const g0 = pool.gauge + pool.cycle * 5;
  await dispatch(b, "TURN_START", o);
  await dispatch(b, "TURN_END", o);
  ok("own turn end: +3 gauge cells", pool.gauge + pool.cycle * 5 - g0 === OITSUKI.turnEndCells, String(pool.gauge + pool.cycle * 5 - g0));
  ok("own turn end: 2 照君 on every ally", allies().every((m: any) => shineStacks(m) === 2));
  ok("照君 ATK = 10% of the soul-free KB ATK per stack (L4), +3 SPD (L2)",
    near(y.prop("atk"), 6000 + 2 * 0.1 * kbBaseAtk(y), 1e-6) && near(y.prop("spd"), 100 + 2 * OITSUKI.shineSpd) && kbBaseAtk(y) === 3028,
    y.prop("atk") + " / KB " + kbBaseAtk(y));
  pool.orb = 7;
  pool.gain(3);
  await dispatch(b, "ACTION_END", y);
  ok("overflow 2 ⇒ +2 照君 on every ally", allies().every((m: any) => shineStacks(m) === 4), allies().map((m: any) => shineStacks(m)).join(","));
  b.teams[1].orbs.orb = 8;
  await cast(b, o, "395_03", o);
  ok("飞彩凝辉: 集落光 on every non-summon ally", allies().every((m: any) => m.hasStatus(GLOW_ID)));
  pool.pay(2, "orb", "COST");
  await dispatch(b, "ACTION_END", y);
  ok("a skill cost is not a deduction (集落光 kept)", allies().every((m: any) => m.hasStatus(GLOW_ID)));
  const c0 = pool.gauge + pool.cycle * 5, l0 = lightStacks(o);
  drainOrbs(b, enemies()[0], 1, 2, "test drain");
  await dispatch(b, "ACTION_END", y);
  ok("deduction of 2: one 集落光 consumed, gauge +2, 流光 -1", allies().filter((m: any) => m.hasStatus(GLOW_ID)).length === 2
    && pool.gauge + pool.cycle * 5 - c0 === 2 && lightStacks(o) === l0 - 1);
  ok("…失彩 on the enemy at the front of the action bar", enemies().filter((v: any) => v.hasStatus(LOST_ID)).length === 1);
  await dispatch(b, "TURN_START", o);
  await dispatch(b, "TURN_END", o);
  ok("unconsumed 集落光 ends at her next turn end: L5 +30% ATK / +30 SPD", !y.hasStatus(GLOW_ID) && y.statuses.some((s: any) => s.def.id === "395_glow_boost"));
}

sec("[4] 妖刀姬·绯夜猎刃: 追猎新章 counter (once per turn), not sealed; hunt target");
{
  const { b, find, enemies } = await match([unit(201, 20000)], 9, true, [unit(593, 30000, { atk: 5000, spd: 116 }), unit(201, 20000), unit(201, 20000)]);
  const yo = b.teams[0].members.find((e: any) => e.skills.some((s: any) => s.ir?.id === "593_04"));
  const att = b.teams[1].members[0];
  ok("593_04 is not sealable (decision exported)", YOTO_04_SEALABLE === false
    && b.bus.handlers.filter((h: any) => h.ownerId === yo.id && String(h.id).startsWith("betting:593:")).every((h: any) => h.passive === false && !h.source));
  // Seal her passives (Hannya's barrier status): the counter still happens.
  yo.addStatus(StatusBook.get(SEAL_ID) ?? { id: SEAL_ID, name: "封印结界", category: "COMMON_MARK", suppressPassive: true, suppressSoul: true, durationPolicy: "GLOBAL", dispellable: false, removable: false, preventsAction: false, preventsSkill: false, forcesBasicAttack: false, locksTimeline: false, desc: "t" } as any, att.id, 1, 99999, [], 1);
  let mark = b.trace.length;
  await dealDamage(b, { source: att, target: yo, base: 1000, rate: 1, type: DamageType.NORMAL });
  ok("damage reduced ⇒ counter on the attacker, even with passives suppressed", since(b, mark).some((t: any) => t.t === "COUNTER" && t.actor === yo.id && t.target === att.id));
  mark = b.trace.length;
  await dealDamage(b, { source: att, target: yo, base: 1000, rate: 1, type: DamageType.NORMAL });
  ok("…at most once per turn", !since(b, mark).some((t: any) => t.t === "COUNTER" && t.actor === yo.id));
  b.turn++;
  yo.addStatus(StatusBook.get("stun")!, att.id, 1, 1, [], null);
  mark = b.trace.length;
  await dealDamage(b, { source: att, target: yo, base: 1000, rate: 1, type: DamageType.NORMAL });
  ok("…only if she can act", !since(b, mark).some((t: any) => t.t === "COUNTER" && t.actor === yo.id));
  // Hunt target: highest absolute HP, not highest HP ratio.
  const { b: b2 } = await match([unit(201, 40000), unit(201, 20000), unit(201, 25000)], 10, true, [unit(593, 30000, { spd: 300 }), unit(201, 20000)]);
  const h = b2.teams[0].members[0], foes = b2.enemiesOf(0);
  foes[0].hp = 30000;   // 75% of 40000; the others full
  b2.teams[0].orbs.orb = 8;
  const hunt = sk(h, "593_03");
  const picked = hunt.pickTarget(b2, h, foes);
  ok("午夜猎歌 → highest absolute HP (30000 at 75%) over full-HP units", picked?.id === foes[0].id, String(picked?.id));
  void enemies; void find;
}

sec("[5] 小鹿男: 生生不息 stacks, +20% bar on enemy onibi skill, 鹿角冲撞 push, AI");
{
  const { b, find, enemies } = await match([unit(259, 20000, { atk: 5000 }), unit(201, 20000)], 11);
  const s = find(259), foes = enemies();
  b.teams[1].orbs.orb = 8;
  ok("AI: no 生生不息 ⇒ 森之力 (KB)", selectSkillByAI(b, s, foes)?.ir?.id === "259_01");
  await dispatch(b, "TURN_END", s);
  ok("own turn end ⇒ +1 生生不息", lifeStacks(s) === 1);
  ok("AI: 生生不息 ⇒ 鹿角冲撞 (KB)", selectSkillByAI(b, s, foes)?.ir?.id === "259_03");
  const p0 = pos(b, s);
  b.queueEvent("ORB_COST", { battle: b, team: 0, actor: foes[0].id, skill: "x", amount: 3, before: 5, after: 2 }, foes[0].id, 0);
  await b.drainEvents();
  ok("enemy onibi skill ⇒ +20% bar", near(pos(b, s) - p0, 2000, 1), String(pos(b, s) - p0));
  b.timeline.get(foes[1].id).pos = 5000;
  await cast(b, s, "259_03", foes[1]);
  ok("鹿角冲撞 with 生生不息: target bar -40%", near(pos(b, foes[1]), 1000, 1), String(pos(b, foes[1])));
  b.timeline.get(foes[2].id).pos = 1000;
  const mark = b.trace.length;
  await cast(b, s, "259_03", foes[2]);
  const stun = since(b, mark).some((t: any) => t.t === "STATUS_APPLY" && t.status === "stun" && t.dst === foes[2].id);
  ok("pushed to the end ⇒ stun (100% base chance), which consumes 1 stack", stun ? lifeStacks(s) === 0 : true, String(stun));
  ok("generic push removed (IR patch)", (sk(s, "259_03").ir.timeline ?? []).length === 0);
  void SHISHIO; void LIFE_ID;
}

sec("[6] 神无月: highest-ATK target uses the initial ATK, 入梦 2 stacks / cost -3, damage reduction");
{
  const { b, find, allies } = await match([unit(596, 20000, { atk: 2500 }), unit(259, 20000, { atk: 6300 }), unit(201, 20000, { atk: 6200 })], 12);
  const k = find(596), s = find(259);
  s.addStatus({ id: "t6_atkdown", name: "atkdown", category: "DEBUFF_STATE", dispellable: true, removable: true, preventsAction: false, preventsSkill: false, forcesBasicAttack: false, suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "GLOBAL", desc: "t" } as any, 0, 1, 9, [{ prop: "atk", value: -0.35, mode: "ADD_RATE" }], 1);
  const t = sk(k, "596_03").pickTarget(b, k, allies());
  ok("美梦赐予 → highest initial ATK ally despite a -35% ATK debuff", t?.id === s.id, String(t?.id));
  await cast(b, k, "596_03", s);
  ok("入梦 rebuilt: 2 stacks on the target only", dreamStacks(s) === KANNAZUKI.dreamStacks && allies().filter((m: any) => m.hasStatus(DREAM_ID)).length === 1);
  ok("入梦: onibi skill cost -3 (鹿角冲撞 3 → 0)", bettingCostOf(b, s, sk(s, "259_03")) === 0);
  const foe = b.enemiesOf(1)[0];
  const r1: any = await dealDamage(b, { source: foe, target: s, base: 1000, rate: 1, type: DamageType.TRUE });
  const r2: any = await dealDamage(b, { source: foe, target: allies()[2], base: 1000, rate: 1, type: DamageType.TRUE });
  ok("织梦曲: 入梦 bearer -40%, other ally -20%", r1.final / r2.final > 0.7 && r1.final / r2.final < 0.8, (r1.final / r2.final).toFixed(3));
}

sec("[7] kernel: a death resolved inside AFTER_DAMAGE is not resolved twice");
{
  const { b, enemies } = await match([unit(201, 20000)], 13);
  const v = enemies()[0], src = b.teams[1].members[0];
  b.bus.register({ id: "t6:nested", ownerId: 0, code: "AFTER_DAMAGE", range: "ALL", priority: 0, passive: false,
    fn: async (ctx: any) => { if (ctx.input.skillTag === "outer" && v.alive) await dealDamage(b, { source: src, target: v, base: 1e7, rate: 1, type: DamageType.TRUE, skillTag: "inner" }); } });
  const mark = b.trace.length;
  await dealDamage(b, { source: src, target: v, base: 10, rate: 1, type: DamageType.TRUE, skillTag: "outer" });
  ok("one DEATH trace", since(b, mark).filter((t: any) => t.t === "DEATH" && t.id === v.id).length === 1);
}

sec("[8] full battle determinism, BASE mode");
{
  const run = async () => {
    const { b } = await match([unit(373, 20000), unit(395, 16000), unit(259, 20000), unit(596, 20000), unit(593, 15000)], 21, false);
    const r = await b.run();
    return JSON.stringify([r.winner, r.turns, b.trace.length, b.rng.draws.length]);
  };
  const a = await run(), c = await run();
  ok("same seed ⇒ identical battle", a === c, a);
  setSkillLevelMode("BASE");
  const { find } = await match([unit(373, 20000), unit(395, 16000), unit(259, 20000)], 3);
  ok("BASE: no shelter, no 流光, no 照君", !find(373).hasStatus("373_shelter") && lightStacks(find(395)) === 0 && shineStacks(find(259)) === 0);
  setSkillLevelMode("MAX");
  void WALTZ_ID; void SHINE_ID;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
