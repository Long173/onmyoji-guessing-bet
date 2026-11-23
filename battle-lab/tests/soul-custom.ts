// tests/soul-custom.ts — hand-written soul installers (soul/custom-effects.ts)
// Run: node battle-lab/tests/soul-custom.ts
import fs from "node:fs/promises";
import path from "node:path";
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets, ResistPolicies } from "../kernel/policies.ts";
import { DamageType, EV, TurnType } from "../kernel/types.ts";
import { CONTROL_EFFECTS } from "../kernel/status.ts";
import { SNOW_SLOW_ID } from "../soul/custom-effects.ts";
import { pendingExtraTurns } from "../kernel/extra-turn.ts";
import { dealDamage } from "../kernel/damage.ts";
import { makeGuessingEntity } from "../soul/guessing-factory.ts";
import { installSoulEffects } from "../soul/effect-system.ts";
import type { SoulDef } from "../soul/loadout.ts";

const KB = path.resolve(import.meta.dirname, "..", "..", "data", "kb");
const souls: SoulDef[] = JSON.parse(await fs.readFile(path.join(KB, "soul.json"), "utf8"));
const soulDefs = new Map<number, SoulDef>(souls.map(s => [Number(s.id), s]));
const idOf = (name: string) => Number(souls.find(s => s.name === name)!.id);
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };
const R = ResourcePolicies.COMMUNITY_4_8_5_345;
const deps = { soulDefs, charMeta: new Map([[217, { name: "A" }], [201, { name: "B" }]]) };

interface Setup {
  aSoul?: string; bSoul?: string; aCri?: number; alwaysHit?: boolean; seed?: number;
  /** a third unit (id 3) on A's team wearing this soul */
  cSoul?: string;
  /** force the outcome of rolls whose RNG tag starts with a key (the draw is still consumed) */
  force?: Record<string, boolean>;
  resist?: keyof typeof ResistPolicies;
}

function setup({ aSoul, bSoul, cSoul, aCri = 0, alwaysHit = true, seed = 7, force = {}, resist }: Setup) {
  const four = (name?: string) => (name ? Array(4).fill(idOf(name)) : []);
  const A = makeGuessingEntity(1, 0, { shikigamiId: 217, observed: { atk: 3000, hp: 20000, def: 400, spd: 120, cri: aCri, crid: 150, efh: 0, efr: 0 }, soulIds: four(aSoul) }, deps);
  const B = makeGuessingEntity(2, 1, { shikigamiId: 201, observed: { atk: 2500, hp: 30000, def: 400, spd: 110, cri: 0, crid: 150, efh: 0, efr: 0 }, soulIds: four(bSoul) }, deps);
  const C = cSoul ? makeGuessingEntity(3, 0, { shikigamiId: 201, observed: { atk: 2000, hp: 20000, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0 }, soulIds: four(cSoul) }, deps) : null;
  const t0 = new Team(0, "RED", R, 1); t0.add(A.entity);
  if (C) t0.add(C.entity);
  const t1 = new Team(1, "BLUE", R, 1); t1.add(B.entity);
  const bt = new Battle([t0, t1], { seed, rules: { ...DEFAULT_RULES, maxTurns: 30 },
    policies: { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
      death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER",
      tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED,
      ...(resist ? { resist: ResistPolicies[resist] } : {}) } });
  const refs = [A, B, ...(C ? [C] : [])].flatMap(x => x.resolution.soulBattleEffects);
  const report = installSoulEffects(bt, refs, soulDefs);
  // Every roll is recorded with its tag and probability; forced tags win over alwaysHit.
  const rolls: Array<{ tag: string; p: number }> = [];
  let pending = "";
  const realExpect = bt.rng.expect.bind(bt.rng);
  bt.rng.expect = (tag: string) => { pending = tag; realExpect(tag); };
  const real = bt.rng.testHit.bind(bt.rng);
  bt.rng.testHit = (p: number) => {
    const tag = pending;
    pending = "";
    rolls.push({ tag, p });
    const key = Object.keys(force).find(k => tag.startsWith(k));
    if (key !== undefined) { real(p); return force[key]; }
    if (alwaysHit && p >= 0.25 && p <= 0.4) return true;
    return real(p);
  };
  return { bt, a: A.entity, b: B.entity, c: C?.entity ?? null, report, rolls };
}

/** Give an entity a minimal normal attack (cost 0, damaging) so counters / assists can act. */
function giveBasic(e: any, base = 1000) {
  e.skills = [{
    name: "普攻", cost: 0, ir: { damage: [{ ratio: 1 }] },
    pickTarget: (_b: any, _s: any, enemies: any[]) => enemies[0],
    execute: async (b: any, self: any, target: any) => {
      await dealDamage(b, { source: self, target, base, rate: 1, type: DamageType.NORMAL, skillTag: "basic:" + self.id });
    },
  }];
}
const rollOf = (s: ReturnType<typeof setup>, prefix: string) => s.rolls.filter(r => r.tag.startsWith(prefix));
const near = (x: number, y: number) => Math.abs(x - y) < 1e-9;
const traceOf = (s: ReturnType<typeof setup>, t: string) => (s.bt.trace as any[]).filter(e => e.t === t);
const ctrl = (id: string) => CONTROL_EFFECTS.find(d => d.id === id)!;

const hit = (s: ReturnType<typeof setup>, from: any, to: any, base = 3000) =>
  dealDamage(s.bt, { source: from, target: to, base, rate: 1, type: DamageType.NORMAL, skillTag: "test" });

console.log("=== Custom soul installers ===");

// 破势 Shadow
{
  const plain = setup({ seed: 11 });
  const shadow = setup({ aSoul: "破势", seed: 11 });
  const r0 = await hit(plain, plain.a, plain.b);
  const r1 = await hit(shadow, shadow.a, shadow.b);
  ok("破势 installs as CUSTOM", shadow.report.installed.some(i => i.name === "破势" && i.kind === "CUSTOM"));
  ok("破势 x1.4 against a full-HP target", Math.abs(r1.final / r0.final - 1.4) < 1e-9, `${r0.final.toFixed(1)} -> ${r1.final.toFixed(1)}`);
  const low = setup({ aSoul: "破势", seed: 11 });
  low.b.hp = low.b.maxHp * 0.5;
  const plainLow = setup({ seed: 11 });
  plainLow.b.hp = plainLow.b.maxHp * 0.5;
  const r2 = await hit(low, low.a, low.b);
  const r3 = await hit(plainLow, plainLow.a, plainLow.b);
  ok("破势 no bonus when target HP <= 70%", Math.abs(r2.final - r3.final) < 1e-9);
}

// 针女 Seductress
{
  const s = setup({ aSoul: "针女", aCri: 100 });
  const before = s.b.hp;
  const r = await hit(s, s.a, s.b);
  const extra = before - s.b.hp - r.applied;
  const expected = Math.min(s.b.maxHp * 0.1, s.a.prop("atk") * 1.2);
  const float = s.bt.rules.damageFloat;
  ok("针女 procs extra damage on crit (within damage float)", r.isCrit && extra >= expected * (1 - float) - 1e-6 && extra <= expected * (1 + float) + 1e-6,
    `extra=${extra.toFixed(1)} expected=${expected.toFixed(1)} ±${(float * 100).toFixed(0)}%`);
  ok("针女 proc is TRUE damage", s.bt.trace.some((t: any) => t.t === "DAMAGE" && t.type === DamageType.TRUE));
  const noCrit = setup({ aSoul: "针女", aCri: 0 });
  const hp0 = noCrit.b.hp;
  const r2 = await hit(noCrit, noCrit.a, noCrit.b);
  ok("针女 does nothing without crit", Math.abs(hp0 - noCrit.b.hp - r2.applied) < 1e-9);
}

// 阴摩罗 Harpy
{
  const s = setup({ aSoul: "阴摩罗" });
  s.b.hp = 10;
  const orbs = s.bt.teams[0].orbs;
  const before = orbs.current;
  await hit(s, s.a, s.b);
  ok("阴摩罗 +3 onibi on kill", orbs.current === Math.min(before + 3, 8) && !s.b.alive, `${before} -> ${orbs.current}`);
  const t = setup({ aSoul: "阴摩罗" });
  const o2 = t.bt.teams[0].orbs.current;
  await hit(t, t.a, t.b);
  ok("阴摩罗 no onibi without a kill", t.bt.teams[0].orbs.current === o2);
}

// 木魅 Tree Nymph
{
  const s = setup({ bSoul: "木魅" });
  const attackerOrbs = s.bt.teams[0].orbs;
  attackerOrbs.gain(3);
  const before = attackerOrbs.current;
  await hit(s, s.a, s.b);
  ok("木魅 drains 1 onibi from the attacker team", attackerOrbs.current === before - 1, `${before} -> ${attackerOrbs.current}`);
  await hit(s, s.a, s.b);
  ok("木魅 triggers at most once per attack", attackerOrbs.current === before - 1);
}

// 镜姬 Mirror Lady
{
  const s = setup({ bSoul: "镜姬" });
  const aBefore = s.a.hp;
  const r = await hit(s, s.a, s.b);
  const taken = r.applied + r.absorbed;
  ok("镜姬 reflects 100% of damage taken", Math.abs(aBefore - s.a.hp - taken) < 1e-6, `taken=${taken.toFixed(1)} reflected=${(aBefore - s.a.hp).toFixed(1)}`);
  const both = setup({ aSoul: "镜姬", bSoul: "镜姬" });
  const a0 = both.a.hp;
  const b0 = both.b.hp;
  const r2 = await hit(both, both.a, both.b);
  ok("镜姬 reflect cannot chain back", Math.abs(b0 - both.b.hp - r2.applied) < 1e-6 && a0 > both.a.hp);
}

// Soul damage never triggers 破势
{
  const s = setup({ aSoul: "破势" });
  await dealDamage(s.bt, { source: s.a, target: s.b, base: 1000, rate: 1, type: DamageType.TRUE, skillTag: "soul:test" });
  ok("soul-tagged damage does not trigger 破势", !s.bt.trace.some((t: any) => t.t === "SOUL_PROC"));
}

// ─── Control / proc souls ────────────────────────────────────────────────────────────────

// 魅妖 Temptress: 25% base chance confusion on dealing damage
{
  const s = setup({ aSoul: "魅妖", alwaysHit: false, force: { "soul:魅妖:": true } });
  ok("魅妖 installs as CUSTOM", s.report.installed.some(i => i.name === "魅妖" && i.kind === "CUSTOM"));
  await hit(s, s.a, s.b);
  const r = rollOf(s, "soul:魅妖:status:confuse:2");
  ok("魅妖 rolls once per hit at the base chance 25%", r.length === 1 && near(r[0].p, 0.25), JSON.stringify(r));
  ok("魅妖 hit → target confused (混乱) for 1 turn", s.b.hasStatus("confuse") && s.b.statuses.find((x: any) => x.def.id === "confuse")?.remaining === 1);
  ok("魅妖 leaves STATUS_APPLY with the soul as skill", traceOf(s, "STATUS_APPLY").some(e => e.status === "confuse" && e.skill === "魅妖（4件套）"));

  const miss = setup({ aSoul: "魅妖", alwaysHit: false, force: { "soul:魅妖:": false } });
  await hit(miss, miss.a, miss.b);
  ok("魅妖 miss → no status, STATUS_MISS trace", !miss.b.hasStatus("confuse") && traceOf(miss, "STATUS_MISS").some(e => e.status === "confuse"));

  const res = setup({ aSoul: "魅妖", alwaysHit: false, resist: "SINGLE_ROLL_RATIO", force: { "soul:魅妖:": false } });
  res.b.base.efr = 1;   // stats are fractions: 1 = 100% effect RES
  await hit(res, res.a, res.b);
  const rr = rollOf(res, "soul:魅妖:status");
  ok("魅妖 base chance goes through the skill resist contest (SINGLE_ROLL_RATIO: 25% x 1/2)", rr.length === 1 && near(rr[0].p, 0.125), JSON.stringify(rr));
  const none = setup({ aSoul: "魅妖", alwaysHit: false, force: { "soul:魅妖:": false } });
  none.b.base.efr = 1;
  await hit(none, none.a, none.b);
  ok("魅妖 under the default resist policy (NONE) the base chance is used as is", near(rollOf(none, "soul:魅妖:status")[0]?.p ?? -1, 0.25));

  const imm = setup({ aSoul: "魅妖", alwaysHit: false, force: { "soul:魅妖:": true } });
  imm.b.addStatus({ ...ctrl("freeze"), id: "TEST_IMMUNE", name: "免控", category: "BUFF_STATE" as any, preventsAction: false, immuneTo: ["CONTROL"] }, 2, 1, 3);
  await hit(imm, imm.a, imm.b);
  ok("魅妖 respects control immunity (IMMUNE trace, no confusion)", !imm.b.hasStatus("confuse") && traceOf(imm, "IMMUNE").length === 1);

  const soulDmg = setup({ aSoul: "魅妖", alwaysHit: false, force: { "soul:魅妖:": true } });
  await dealDamage(soulDmg.bt, { source: soulDmg.a, target: soulDmg.b, base: 1000, rate: 1, type: DamageType.TRUE, skillTag: "soul:test" });
  await dealDamage(soulDmg.bt, { source: soulDmg.a, target: soulDmg.b, base: 1000, rate: 1, type: DamageType.INDIRECT, skillTag: "test" });
  ok("魅妖 ignores soul-made and INDIRECT damage", rollOf(soulDmg, "soul:魅妖").length === 0 && !soulDmg.b.hasStatus("confuse"));
}

// 返魂香 Senecio: 25% base chance to stun the damager; x0.4 against a taunted damager
{
  const s = setup({ bSoul: "返魂香", alwaysHit: false, force: { "soul:返魂香:": true } });
  await hit(s, s.a, s.b);
  const r = rollOf(s, "soul:返魂香:status:stun:1");
  ok("返魂香 rolls 25% base chance against the damager", r.length === 1 && near(r[0].p, 0.25), JSON.stringify(r));
  ok("返魂香 stuns the damager (眩晕) for 1 turn", s.a.hasStatus("stun") && !s.b.hasStatus("stun"));
  const t = setup({ bSoul: "返魂香", alwaysHit: false, force: { "soul:返魂香:": false } });
  t.a.addStatus(ctrl("taunt"), 2, 1, 1);
  await hit(t, t.a, t.b);
  ok("返魂香 chance reduced by 60% when the damager is taunted (10%)", near(rollOf(t, "soul:返魂香:status")[0]?.p ?? -1, 0.1));
  const n = setup({ aSoul: "返魂香", alwaysHit: false, force: { "soul:返魂香:": true } });
  await hit(n, n.a, n.b);
  ok("返魂香 does nothing when the wearer deals damage", rollOf(n, "soul:返魂香").length === 0 && !n.b.hasStatus("stun"));
}

// 雪幽魂 Snow Spirit: freeze 15% (30% vs slowed) on dealing damage; attacker slowed by 30 when attacked
{
  const s = setup({ aSoul: "雪幽魂", alwaysHit: false, force: { "soul:雪幽魂:": true } });
  await hit(s, s.a, s.b);
  ok("雪幽魂 freeze roll at 15% vs an unslowed target", near(rollOf(s, "soul:雪幽魂:status:freeze")[0]?.p ?? -1, 0.15));
  ok("雪幽魂 freezes the target (冰冻) for 1 turn", s.b.hasStatus("freeze"));
  const slowed = setup({ aSoul: "雪幽魂", alwaysHit: false, force: { "soul:雪幽魂:": false } });
  slowed.b.addStatus({ ...ctrl("freeze"), id: "TEST_SLOW", name: "测试减速", preventsAction: false }, 9, 1, 2, [{ prop: "spd", value: -10, mode: "FIXED" }]);
  await hit(slowed, slowed.a, slowed.b);
  ok("雪幽魂 freeze roll at 30% vs a slowed target", near(rollOf(slowed, "soul:雪幽魂:status:freeze")[0]?.p ?? -1, 0.3));

  const d = setup({ bSoul: "雪幽魂", alwaysHit: false });
  const spd0 = d.a.speed;
  await hit(d, d.a, d.b);
  ok("雪幽魂 attacker slowed by 30 speed (no roll under the NONE resist policy)", d.a.hasStatus(SNOW_SLOW_ID) && near(spd0 - d.a.speed, 30) && rollOf(d, "soul:雪幽魂").length === 0,
    `${spd0} -> ${d.a.speed}`);
  await hit(d, d.a, d.b);
  ok("雪幽魂 repeated slow refreshes instead of stacking (-30 total)", near(spd0 - d.a.speed, 30), `${spd0} -> ${d.a.speed}`);
  const dr = setup({ bSoul: "雪幽魂", alwaysHit: false, resist: "SINGLE_ROLL_RATIO", force: { "soul:雪幽魂:status:SOUL_SNOW_SLOW": false } });
  await hit(dr, dr.a, dr.b);
  ok("雪幽魂 slow is contested (100% base) when a resist policy is active", near(rollOf(dr, "soul:雪幽魂:status:SOUL_SNOW_SLOW")[0]?.p ?? -1, 1) && !dr.a.hasStatus(SNOW_SLOW_ID));
}

// 钟灵: stun 20% when no enemy is stunned, otherwise 10%
{
  const s = setup({ aSoul: "钟灵", alwaysHit: false, force: { "soul:钟灵:": true } });
  await hit(s, s.a, s.b);
  ok("钟灵 20% base chance while no enemy is stunned", near(rollOf(s, "soul:钟灵:status:stun")[0]?.p ?? -1, 0.2) && s.b.hasStatus("stun"));
  await hit(s, s.a, s.b);
  ok("钟灵 10% base chance once an enemy is stunned", near(rollOf(s, "soul:钟灵:status:stun")[1]?.p ?? -1, 0.1));
}

// 狰 Scarlet: 35% counter (normal attack) when taking enemy damage; 14% vs taunted attacker
{
  const s = setup({ bSoul: "狰", alwaysHit: false, force: { "soul:狰:": true } });
  giveBasic(s.b);
  const a0 = s.a.hp;
  await hit(s, s.a, s.b);
  ok("狰 rolls 35%", near(rollOf(s, "soul:狰:counter")[0]?.p ?? -1, 0.35));
  ok("狰 counters with a normal attack (COUNTER trace, attacker damaged)", traceOf(s, "COUNTER").some(e => e.actor === 2 && e.target === 1) && s.a.hp < a0, `${a0} -> ${s.a.hp}`);
  ok("狰 counter does not chain (one COUNTER only)", traceOf(s, "COUNTER").length === 1);
  const t = setup({ bSoul: "狰", alwaysHit: false, force: { "soul:狰:": false } });
  giveBasic(t.b);
  t.a.addStatus(ctrl("taunt"), 2, 1, 1);
  await hit(t, t.a, t.b);
  ok("狰 chance reduced by 60% vs a taunted attacker (14%)", near(rollOf(t, "soul:狰:counter")[0]?.p ?? -1, 0.14));
  const st = setup({ bSoul: "狰", alwaysHit: false, force: { "soul:狰:": true } });
  giveBasic(st.b);
  st.b.addStatus(ctrl("stun"), 1, 1, 1);
  await hit(st, st.a, st.b);
  ok("狰 cannot counter while immobile (no roll)", rollOf(st, "soul:狰").length === 0 && traceOf(st, "COUNTER").length === 0);
}

// 应声虫 Echoer: 20% assist on an ally's normal attack
{
  const s = setup({ cSoul: "应声虫", alwaysHit: false, force: { "soul:应声虫:": true } });
  giveBasic(s.a); giveBasic(s.c!, 777);
  await s.bt.runTurn(s.a, TurnType.NORMAL);
  ok("应声虫 rolls 20% when an ally normal-attacks", rollOf(s, "soul:应声虫:assist").length === 1 && near(rollOf(s, "soul:应声虫:assist")[0].p, 0.2));
  ok("应声虫 assist: the wearer normal-attacks the same target", traceOf(s, "DAMAGE").some(e => e.src === 3 && e.dst === 2) && traceOf(s, "SOUL_PROC").some(e => e.soul === "应声虫"));
  ok("应声虫 assist does not chain", traceOf(s, "DAMAGE").filter(e => e.src === 3).length === 1);
  const sk = setup({ cSoul: "应声虫", alwaysHit: false, force: { "soul:应声虫:": true } });
  giveBasic(sk.a); giveBasic(sk.c!);
  sk.a.skills[0].cost = 2;
  sk.bt.teams[0].orbs.gain(5);
  await sk.bt.runTurn(sk.a, TurnType.NORMAL);
  ok("应声虫 no assist on a non-normal-attack skill", rollOf(sk, "soul:应声虫").length === 0 && !traceOf(sk, "DAMAGE").some(e => e.src === 3));
  const self = setup({ aSoul: "应声虫", alwaysHit: false, force: { "soul:应声虫:": true } });
  giveBasic(self.a);
  await self.bt.runTurn(self.a, TurnType.NORMAL);
  ok("应声虫 the wearer does not assist itself", rollOf(self, "soul:应声虫").length === 0);
}

// 共潜 Merrow: turn end dispel 1 random ally debuff; 3 if no damage dealt that turn
{
  const teamOf = (s: ReturnType<typeof setup>) => (id: number) => s.bt.teamOf(id);
  const withDebuffs = (s: ReturnType<typeof setup>) => {
    for (let i = 0; i < 4; i++) s.a.addStatus({ ...ctrl("freeze"), id: "TEST_DEBUFF_" + i, name: "测试减益" + i, preventsAction: false }, 2, 1, 5);
    s.a.addStatus(ctrl("stun"), 2, 1, 5);
  };
  const idle = setup({ aSoul: "共潜", alwaysHit: false });
  withDebuffs(idle);
  await idle.bt.bus.dispatch(EV.TURN_START, { actor: idle.a, type: TurnType.NORMAL }, 1, 0, teamOf(idle));
  await idle.bt.bus.dispatch(EV.TURN_END, { actor: idle.a, type: TurnType.NORMAL }, 1, 0, teamOf(idle));
  const left = idle.a.statuses.filter((x: any) => String(x.def.id).startsWith("TEST_DEBUFF_")).length;
  ok("共潜 no damage dealt → 3 debuffs dispelled", left === 1, `left ${left}`);
  ok("共潜 never touches undispellable debuffs (stun stays)", idle.a.hasStatus("stun"));
  ok("共潜 dispels leave STATUS_REMOVE traces", traceOf(idle, "STATUS_REMOVE").filter(e => e.skill === "共潜（4件套）").length === 3);
  const busy = setup({ aSoul: "共潜", alwaysHit: false });
  withDebuffs(busy);
  await busy.bt.bus.dispatch(EV.TURN_START, { actor: busy.a, type: TurnType.NORMAL }, 1, 0, teamOf(busy));
  await hit(busy, busy.a, busy.b);
  await busy.bt.bus.dispatch(EV.TURN_END, { actor: busy.a, type: TurnType.NORMAL }, 1, 0, teamOf(busy));
  ok("共潜 damage dealt during the turn → only 1 debuff dispelled", busy.a.statuses.filter((x: any) => String(x.def.id).startsWith("TEST_DEBUFF_")).length === 3);
}

// 蝠翼 Nightwing: 20% lifesteal
{
  const s = setup({ aSoul: "蝠翼" });
  s.a.hp = 5000;
  const h0 = s.a.hp;
  const r = await hit(s, s.a, s.b);
  ok("蝠翼 heals 20% of the damage dealt", near(s.a.hp - h0, r.applied * 0.2), `+${(s.a.hp - h0).toFixed(1)} vs ${(r.applied * 0.2).toFixed(1)}`);
  ok("蝠翼 leaves a LIFESTEAL trace", traceOf(s, "LIFESTEAL").some(e => e.tag === "soul:蝠翼"));
}

// 涅槃之火: action end with HP < 30% → heal 15% max HP
{
  const s = setup({ aSoul: "涅槃之火" });
  s.a.hp = s.a.maxHp * 0.2;
  await s.bt.bus.dispatch(EV.ACTION_END, { actor: s.a, type: TurnType.NORMAL }, 1, 0, (id: number) => s.bt.teamOf(id));
  ok("涅槃之火 heals 15% max HP below 30% HP", near(s.a.hp, s.a.maxHp * 0.35), `${s.a.hp}`);
  s.a.hp = s.a.maxHp * 0.5;
  await s.bt.bus.dispatch(EV.ACTION_END, { actor: s.a, type: TurnType.NORMAL }, 1, 0, (id: number) => s.bt.teamOf(id));
  ok("涅槃之火 no heal at 50% HP", near(s.a.hp, s.a.maxHp * 0.5));
}

// ─── Damage modifier souls (same seed ⇒ same float roll; compare with a soulless run) ───
async function ratio(opts: Setup, prep: (s: ReturnType<typeof setup>) => void = () => {}, reverse = false) {
  const plain = setup({ ...opts, aSoul: undefined, bSoul: undefined });
  const worn = setup(opts);
  prep(plain); prep(worn);
  const r0 = reverse ? await hit(plain, plain.b, plain.a) : await hit(plain, plain.a, plain.b);
  const r1 = reverse ? await hit(worn, worn.b, worn.a) : await hit(worn, worn.a, worn.b);
  return r1.final / r0.final;
}
{
  const q = await ratio({ aSoul: "镇墓兽", aCri: 100, seed: 5 }, s => { s.a.hp = s.a.maxHp * 0.5; });
  ok("镇墓兽 at 50% HP: crit damage 150% → 175%", near(q, 1.75 / 1.5), q.toFixed(6));
  const q0 = await ratio({ aSoul: "镇墓兽", aCri: 0, seed: 5 }, s => { s.a.hp = s.a.maxHp * 0.5; });
  ok("镇墓兽 no effect without a crit", near(q0, 1));
  const qf = await ratio({ aSoul: "镇墓兽", aCri: 100, seed: 5 });
  ok("镇墓兽 no effect at full HP", near(qf, 1));

  ok("鸣屋 x1.45 vs a controlled target", near(await ratio({ aSoul: "鸣屋" }, s => { s.b.addStatus(ctrl("stun"), 1, 1, 1); }), 1.45));
  ok("鸣屋 no bonus vs an uncontrolled target", near(await ratio({ aSoul: "鸣屋" }), 1));

  ok("心眼 target at 50% HP → +30% (3 x 15%)", near(await ratio({ aSoul: "心眼" }, s => { s.b.hp = s.b.maxHp * 0.5; }), 1.3));
  ok("心眼 target at 90% HP → no bonus", near(await ratio({ aSoul: "心眼" }, s => { s.b.hp = s.b.maxHp * 0.9; }), 1));

  ok("狂骨 4 onibi → +32%", near(await ratio({ aSoul: "狂骨" }, s => { const o = s.bt.teams[0].orbs; o.pay(o.current); o.gain(4); }), 1.32));

  ok("片叶之苇 full HP → x1.45", near(await ratio({ aSoul: "片叶之苇" }), 1.45));
  ok("片叶之苇 not at full HP → no bonus", near(await ratio({ aSoul: "片叶之苇" }, s => { s.a.hp = s.a.maxHp - 1; }), 1));

  const ign = await ratio({ aSoul: "网切", alwaysHit: false, force: { "soul:网切:": true } });
  ok("网切 ignores 45% defense (def 400 → 220)", near(ign, (300 / (300 + 220)) / (300 / 700)), ign.toFixed(6));
  ok("网切 50% roll", near(await ratio({ aSoul: "网切", alwaysHit: false, force: { "soul:网切:": false } }), 1));

  ok("被服 wearer takes x0.7", near(await ratio({ bSoul: "被服" }), 0.7));
  ok("被服 no reduction on the wearer's own attacks", near(await ratio({ bSoul: "被服" }, () => {}, true), 1));
}

// 轮入道 Soultaker: 20% extra turn at the wearer's turn end (kernel/extra-turn.ts, NEW_TURN)
{
  const teamOf = (s: ReturnType<typeof setup>) => (id: number) => s.bt.teamOf(id);
  const s = setup({ aSoul: "轮入道", alwaysHit: false, force: { "soul:轮入道:": true } });
  ok("轮入道 installs as CUSTOM", s.report.installed.some(i => i.name === "轮入道" && i.kind === "CUSTOM"));
  await s.bt.bus.dispatch(EV.TURN_END, { actor: s.b, type: TurnType.NORMAL }, s.b.id, s.b.teamId, teamOf(s));
  ok("轮入道 no roll at an enemy's turn end", rollOf(s, "soul:轮入道").length === 0 && pendingExtraTurns(s.bt) === 0);
  await s.bt.bus.dispatch(EV.TURN_END, { actor: s.a, type: TurnType.NORMAL }, s.a.id, s.a.teamId, teamOf(s));
  ok("轮入道 rolls 20% at the wearer's turn end and queues one extra turn", near(rollOf(s, "soul:轮入道:extra-turn")[0]?.p ?? -1, 0.2) && pendingExtraTurns(s.bt) === 1);
  const miss = setup({ aSoul: "轮入道", alwaysHit: false, force: { "soul:轮入道:": false } });
  await miss.bt.bus.dispatch(EV.TURN_END, { actor: miss.a, type: TurnType.NORMAL }, miss.a.id, miss.a.teamId, teamOf(miss));
  ok("轮入道 failed roll → no extra turn", pendingExtraTurns(miss.bt) === 0);
  // Full battle with the real RNG: every proc becomes exactly one NEW_TURN of the wearer, right after its turn.
  const f = setup({ aSoul: "轮入道", alwaysHit: false, seed: 21 });
  giveBasic(f.a, 100); giveBasic(f.b, 100);
  await f.bt.run();
  const procs = traceOf(f, "SOUL_PROC").filter(e => e.soul === "轮入道");
  const extra = traceOf(f, "EXTRA_TURN");
  ok("轮入道 full battle: procs happen and each one plays one extra turn of the wearer", procs.length > 0 && extra.length === procs.length && extra.every(e => e.actor === 1), `${procs.length} procs / ${extra.length} extra turns`);
  ok("轮入道 extra turns are NEW_TURN entries in the turn log", f.bt.turnLog.filter((t: any) => t.type === TurnType.NEW_TURN && t.actorId === 1 && t.skill).length === extra.length);
  const rolls = rollOf(f, "soul:轮入道:extra-turn");
  ok("轮入道 one 20% roll per wearer turn end (extra turns included)", rolls.every(r => near(r.p, 0.2)) && rolls.length === f.bt.turnLog.filter((t: any) => t.actorId === 1 && t.skill).length, `${rolls.length} rolls`);
}

// 地藏像 Jizo Statue: crit taken → self 100% / each ally 30%, 1-turn shield of 10% of the receiver's max HP
{
  const teamOf = (s: ReturnType<typeof setup>) => (id: number) => s.bt.teamOf(id);
  const jizoShields = (e: any) => (e.shields ?? []).filter((sh: any) => !sh.broken && String(sh.id).startsWith("sh_soul-jizo_"));
  const t = setup({ aSoul: "地藏像", alwaysHit: false, force: { "soul:地藏像:": true }, cSoul: "被服" });
  ok("地藏像 installs as CUSTOM", t.report.installed.some(i => i.name === "地藏像" && i.kind === "CUSTOM"));
  t.c!.maxHp = 30000; t.c!.hp = 30000;
  t.b.base.cri = 100;
  await hit(t, t.b, t.a);
  ok("地藏像 crit taken → wearer shield = 10% of its max HP, no roll for the wearer", jizoShields(t.a).length === 1 && near(jizoShields(t.a)[0].value, t.a.maxHp * 0.1) && !rollOf(t, "soul:地藏像:shield:1").length,
    String(jizoShields(t.a)[0]?.value));
  ok("地藏像 ally: 30% roll, shield = 10% of the ally's own max HP", near(rollOf(t, "soul:地藏像:shield:3")[0]?.p ?? -1, 0.3) && jizoShields(t.c).length === 1 && near(jizoShields(t.c)[0].value, 3000),
    String(jizoShields(t.c)[0]?.value));
  ok("地藏像 shields are SHIELD_APPLY with duration 1", traceOf(t, "SHIELD_APPLY").filter(e => e.skill === "地藏像（4件套）" && e.duration === 1).length === 2);
  await hit(t, t.b, t.a);
  ok("地藏像 a new crit replaces the wearer's shield (no stacking)", jizoShields(t.a).length === 1);
  await t.bt.bus.dispatch(EV.TURN_END, { actor: t.a, type: TurnType.NORMAL }, t.a.id, t.a.teamId, teamOf(t));
  ok("地藏像 shield expires at the end of the receiver's turn", jizoShields(t.a).length === 0 && jizoShields(t.c).length === 1 && traceOf(t, "SHIELD_EXPIRE").some(e => e.id === 1));
  const n = setup({ aSoul: "地藏像", alwaysHit: false, force: { "soul:地藏像:": true }, cSoul: "被服" });
  await hit(n, n.b, n.a);
  ok("地藏像 no crit → no shield", jizoShields(n.a).length === 0 && rollOf(n, "soul:地藏像").length === 0);
  const tt = setup({ aSoul: "地藏像", alwaysHit: false, force: { "soul:地藏像:": false }, cSoul: "被服" });
  tt.b.base.cri = 100;
  tt.b.addStatus(ctrl("taunt"), 1, 1, 1);
  await hit(tt, tt.b, tt.a);
  ok("地藏像 vs a taunted attacker: wearer 40%, ally 12%", near(rollOf(tt, "soul:地藏像:shield:1")[0]?.p ?? -1, 0.4) && near(rollOf(tt, "soul:地藏像:shield:3")[0]?.p ?? -1, 0.12) && jizoShields(tt.a).length === 0);
  const soul = setup({ aSoul: "地藏像", alwaysHit: false, force: { "soul:地藏像:": true } });
  soul.b.base.cri = 100;
  await dealDamage(soul.bt, { source: soul.b, target: soul.a, base: 1000, rate: 1, type: DamageType.NORMAL, skillTag: "soul:test" });
  ok("地藏像 soul-tagged crits do not trigger it", jizoShields(soul.a).length === 0);
}

// 幽谷响 Yamabiko: resisting a control → 50% reflect it to the source, guaranteed hit
{
  const s = setup({ aSoul: "魅妖", bSoul: "幽谷响", alwaysHit: false, resist: "COMMUNITY_TWO_ROLL",
    force: { "soul:魅妖:status": true, "soul:魅妖:resist": true, "soul:幽谷响:": true } });
  ok("幽谷响 installs as CUSTOM", s.report.installed.some(i => i.name === "幽谷响" && i.kind === "CUSTOM"));
  await hit(s, s.a, s.b);
  ok("幽谷响 the control was resisted (STATUS_RESIST, EV.RESIST)", traceOf(s, "STATUS_RESIST").some(e => e.status === "confuse" && e.dst === 2) && !s.b.hasStatus("confuse"));
  ok("幽谷响 50% roll, the resisted control lands on its source", near(rollOf(s, "soul:幽谷响:reflect")[0]?.p ?? -1, 0.5) && s.a.hasStatus("confuse")
    && traceOf(s, "STATUS_APPLY").some(e => e.status === "confuse" && e.dst === 1 && e.skill === "幽谷响（4件套）" && e.reason === "REFLECTED" && e.duration === 1));
  ok("幽谷响 reflect is guaranteed: no probability / resist roll for it", rollOf(s, "soul:幽谷响").length === 1 && !rollOf(s, "soul:魅妖:status:confuse:1").length);
  const miss = setup({ aSoul: "魅妖", bSoul: "幽谷响", alwaysHit: false, resist: "COMMUNITY_TWO_ROLL",
    force: { "soul:魅妖:status": true, "soul:魅妖:resist": true, "soul:幽谷响:": false } });
  await hit(miss, miss.a, miss.b);
  ok("幽谷响 failed roll → nothing reflected", !miss.a.hasStatus("confuse"));
  const landed = setup({ aSoul: "魅妖", bSoul: "幽谷响", alwaysHit: false, resist: "COMMUNITY_TWO_ROLL",
    force: { "soul:魅妖:status": true, "soul:魅妖:resist": false, "soul:幽谷响:": true } });
  await hit(landed, landed.a, landed.b);
  ok("幽谷响 a control that lands is not reflected", landed.b.hasStatus("confuse") && !landed.a.hasStatus("confuse") && rollOf(landed, "soul:幽谷响").length === 0);
  const slow = setup({ aSoul: "雪幽魂", bSoul: "幽谷响", alwaysHit: false, resist: "COMMUNITY_TWO_ROLL",
    force: { "soul:雪幽魂:status:SOUL_SNOW": true, "soul:雪幽魂:resist": true, "soul:雪幽魂:status:freeze": false, "soul:幽谷响:": true } });
  await hit(slow, slow.b, slow.a);
  ok("幽谷响 a resisted non-control debuff (雪幽魂 slow) is not reflected", traceOf(slow, "STATUS_RESIST").some(e => e.status === SNOW_SLOW_ID) && rollOf(slow, "soul:幽谷响").length === 0);
  const imm = setup({ aSoul: "魅妖", bSoul: "幽谷响", alwaysHit: false, resist: "COMMUNITY_TWO_ROLL",
    force: { "soul:魅妖:status": true, "soul:魅妖:resist": true, "soul:幽谷响:": true } });
  imm.a.addStatus({ ...ctrl("freeze"), id: "TEST_IMMUNE", name: "免控", category: "BUFF_STATE" as any, preventsAction: false, immuneTo: ["CONTROL"] }, 1, 1, 3);
  await hit(imm, imm.a, imm.b);
  ok("幽谷响 the reflected control respects the source's immunity", !imm.a.hasStatus("confuse") && traceOf(imm, "IMMUNE").some(e => e.dst === 1));
  const def = setup({ aSoul: "魅妖", bSoul: "幽谷响", alwaysHit: false, force: { "soul:魅妖:status": false, "soul:幽谷响:": true } });
  await hit(def, def.a, def.b);
  ok("幽谷响 default resist policy: no resist, no reflect", rollOf(def, "soul:幽谷响").length === 0);
}

// Every soul named in the task brief has an installer
{
  const { CUSTOM_SOULS, CUSTOM_SOUL_NOTES } = await import("../soul/custom-effects.ts");
  const want = ["魅妖", "返魂香", "雪幽魂", "镇墓兽", "应声虫", "狰", "蝠翼", "共潜"];
  ok("priority souls all have custom installers", want.every(n => typeof CUSTOM_SOULS[n] === "function"), want.filter(n => !CUSTOM_SOULS[n]).join(","));
  ok("every custom soul has an install note and a KB entry",
    Object.keys(CUSTOM_SOULS).every(n => !!CUSTOM_SOUL_NOTES[n] && souls.some(s => s.name === n)));
}

console.log(`\n=== custom souls: ${pass} passed, ${fail} failed ===`);
if (fail) process.exit(1);
