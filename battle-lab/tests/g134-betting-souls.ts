// tests/g134-betting-souls.ts — betting-mode (MAX) hand-written souls: 伤魂鸟 / 珍珠 / 树妖 / 钓瓶火 / 蚌精.
// Run: node battle-lab/tests/g134-betting-souls.ts
//
// These five souls were inert (伤魂鸟 / 珍珠 / 树妖 / 钓瓶火: HEALING kind or no trigger, the generic loop has no
// branch for them) or wrong (蚌精: shield with no duration) on the generic path. In MAX they use the installers in
// soul/custom-effects.ts; in BASE the generic path is kept so the regression fingerprints do not move.
import fs from "node:fs/promises";
import path from "node:path";
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { EV, TurnType } from "../kernel/types.ts";
import { EntityType } from "../kernel/entity.ts";
import { healTarget } from "../kernel/damage.ts";
import { makeGuessingEntity } from "../soul/guessing-factory.ts";
import { installSoulEffects } from "../soul/effect-system.ts";
import { customSoulFor, BETTING_ONLY_SOULS, CUSTOM_SOUL_NOTES } from "../soul/custom-effects.ts";
import { setSkillLevelMode } from "../compile/max-level.ts";
import type { SoulDef } from "../soul/loadout.ts";

const KB = path.resolve(import.meta.dirname, "..", "..", "data", "kb");
const souls: SoulDef[] = JSON.parse(await fs.readFile(path.join(KB, "soul.json"), "utf8"));
const soulDefs = new Map<number, SoulDef>(souls.map(s => [Number(s.id), s]));
const idOf = (name: string) => Number(souls.find(s => s.name === name)!.id);
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };
const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;
const R = ResourcePolicies.COMMUNITY_4_8_5_345;
const deps = { soulDefs, charMeta: new Map([[217, { name: "A" }], [201, { name: "B" }]]) };

/** A (id 1, wearer) and C (id 3) on red, B (id 2) on blue. */
function setup(aSoul: string, mode: "MAX" | "BASE" = "MAX") {
  setSkillLevelMode(mode);
  const four = (name: string) => Array(4).fill(idOf(name));
  const A = makeGuessingEntity(1, 0, { shikigamiId: 217, observed: { atk: 3000, hp: 20000, def: 400, spd: 120, cri: 0, crid: 150, efh: 0, efr: 0 }, soulIds: four(aSoul) }, deps);
  const C = makeGuessingEntity(3, 0, { shikigamiId: 201, observed: { atk: 2000, hp: 30000, def: 300, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0 }, soulIds: [] }, deps);
  const B = makeGuessingEntity(2, 1, { shikigamiId: 201, observed: { atk: 2500, hp: 30000, def: 400, spd: 110, cri: 0, crid: 150, efh: 0, efr: 0 }, soulIds: [] }, deps);
  const t0 = new Team(0, "RED", R, 1); t0.add(A.entity); t0.add(C.entity);
  const t1 = new Team(1, "BLUE", R, 1); t1.add(B.entity);
  const bt: any = new Battle([t0, t1], { seed: 3, rules: { ...DEFAULT_RULES, maxTurns: 30 },
    policies: { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
      death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER",
      tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED } });
  const report = installSoulEffects(bt, A.resolution.soulBattleEffects, soulDefs);
  return { bt, a: A.entity as any, b: B.entity as any, c: C.entity as any, report };
}
const dispatch = (bt: any, code: string, ctx: any, e: any) => bt.bus.dispatch(code, ctx, e.id, e.teamId, (id: number) => bt.teamOf(id));
const turnEnd = (bt: any, e: any) => dispatch(bt, EV.TURN_END, { actor: e, type: TurnType.NORMAL }, e);
const procs = (bt: any, soul: string) => (bt.trace as any[]).filter(e => e.t === "SOUL_PROC" && e.soul === soul);
const liveShields = (e: any, tag: string) => (e.shields ?? []).filter((s: any) => !s.broken && String(s.id).startsWith(`sh_${tag}_`));

console.log("=== Betting-mode souls (g134) ===");

console.log("\n[1] gating: MAX uses the installer, BASE keeps the generic path");
{
  // + 日女巳时 / 三味 / 骰子鬼 (match 6, soul/custom-effects-betting.ts; covered by tests/betting-mechanics-7.ts).
  // + 隐念 Possessor (match 7, soul/custom-effects-betting.ts; covered by tests/betting-mechanics-11.ts).
  // + 魍魉之匣 Mimic / 薙魂 Soul Edge (match 8, soul/custom-effects-betting.ts; covered by tests/betting-mechanics-12.ts).
  // + 涂佛 Nuribotoke (match 11, soul/custom-effects-betting.ts; covered by tests/betting-mechanics-17.ts).
  ok("BETTING_ONLY_SOULS = the twelve souls", [...BETTING_ONLY_SOULS].sort().join() === ["伤魂鸟", "珍珠", "树妖", "钓瓶火", "蚌精", "日女巳时", "三味", "骰子鬼", "隐念", "薙魂", "魍魉之匣", "涂佛"].sort().join());
  ok("every betting-only soul has an install note", [...BETTING_ONLY_SOULS].every(n => !!CUSTOM_SOUL_NOTES[n]));
  setSkillLevelMode("BASE");
  ok("BASE: customSoulFor returns null for every betting-only soul", [...BETTING_ONLY_SOULS].every(n => customSoulFor(n) === null));
  ok("BASE: customSoulFor still returns the old custom souls (狰)", typeof customSoulFor("狰") === "function");
  setSkillLevelMode("MAX");
  ok("MAX: customSoulFor returns an installer for every betting-only soul", [...BETTING_ONLY_SOULS].every(n => typeof customSoulFor(n) === "function"));
  ok("customSoulFor(unknown) is null", customSoulFor("__nope__") === null);
  for (const n of BETTING_ONLY_SOULS) {
    const max = setup(n, "MAX").report.installed.find(i => i.name === n);
    const base = setup(n, "BASE").report.installed.find(i => i.name === n);
    ok(`${n}: MAX installs CUSTOM, BASE installs the generic kind`, max?.kind === "CUSTOM" && !!base && base.kind !== "CUSTOM", `${max?.kind} / ${base?.kind}`);
  }
  const base = setup("树妖", "BASE");
  ok("BASE: no heal amplifier hook on the battle", base.bt.healAmplifiers === undefined);
}

console.log("\n[2] 伤魂鸟: heal 20% max HP and +20% damage per non-summon death, max 6 stacks");
{
  const s = setup("伤魂鸟");
  s.a.hp = s.a.maxHp * 0.5;
  const hp0 = s.a.hp;
  await dispatch(s.bt, EV.DEATH, { target: s.b, killerId: s.c.id }, s.b);
  ok("heals the wearer by 20% of its max HP", near(s.a.hp - hp0, s.a.maxHp * 0.2), `${hp0} -> ${s.a.hp}`);
  const stacks = () => s.a.effects.filter((x: any) => String(x.source).startsWith(`soul${idOf("伤魂鸟")}:stack`)).length;
  ok("first death → 1 stack, dmgDealtB +0.2", stacks() === 1 && near(s.a.prop("dmgDealtB"), 0.2), String(s.a.prop("dmgDealtB")));
  for (let i = 0; i < 7; i++) await dispatch(s.bt, EV.DEATH, { target: i % 2 ? s.b : s.c, killerId: 0 }, s.b);
  ok("capped at 6 stacks (+120%)", stacks() === 6 && near(s.a.prop("dmgDealtB"), 1.2), `${stacks()} / ${s.a.prop("dmgDealtB")}`);
  ok("every death leaves a SOUL_PROC", procs(s.bt, "伤魂鸟").length === 8, String(procs(s.bt, "伤魂鸟").length));
  const t = setup("伤魂鸟");
  await dispatch(t.bt, EV.DEATH, { target: { id: 99, teamId: 1, type: EntityType.SUMMON }, killerId: 0 }, t.b);
  ok("a summon's death does not count", procs(t.bt, "伤魂鸟").length === 0);
  await dispatch(t.bt, EV.DEATH, { target: t.a, killerId: 2 }, t.a);
  ok("the wearer's own death does not count", procs(t.bt, "伤魂鸟").length === 0);
  t.a.alive = false;
  await dispatch(t.bt, EV.DEATH, { target: t.b, killerId: 0 }, t.b);
  ok("a dead wearer does nothing (DEATH reaches dead owners)", procs(t.bt, "伤魂鸟").length === 0);
}

console.log("\n[3] 珍珠: wearer's heal → shield = 30% of the base heal, 2 turns, non-dispellable");
{
  const s = setup("珍珠");
  s.c.hp = s.c.maxHp * 0.5;
  await healTarget(s.bt, s.a, s.c, 1000);
  await s.bt.drainEvents();
  let sh = liveShields(s.c, "soul-pearl");
  ok("target gets one Pearl shield of 300 (30% of base 1000)", sh.length === 1 && near(sh[0].value, 300), JSON.stringify(sh.map((x: any) => x.value)));
  ok("non-dispellable, ttl 2", sh[0]?.dispellable === false && sh[0]?.ttl === 2);
  s.c.addModifier({ prop: "healDown", value: 0.5, mode: "FIXED", source: "test" });
  await healTarget(s.bt, s.a, s.c, 2000);
  await s.bt.drainEvents();
  sh = liveShields(s.c, "soul-pearl");
  ok("base heal ignores heal reduction (2000 → 600) and replaces the previous shield", sh.length === 1 && near(sh[0].value, 600), JSON.stringify(sh.map((x: any) => x.value)));
  await turnEnd(s.bt, s.c);
  ok("still there after 1 of the target's turns", liveShields(s.c, "soul-pearl").length === 1);
  await turnEnd(s.bt, s.c);
  ok("expires after 2 of the target's turns", liveShields(s.c, "soul-pearl").length === 0);
  await healTarget(s.bt, s.a, s.c, 1000, { recover: true });
  await healTarget(s.bt, s.b, s.b, 1000);
  await s.bt.drainEvents();
  ok("recover and other units' heals give no shield", liveShields(s.c, "soul-pearl").length === 0 && liveShields(s.b, "soul-pearl").length === 0);
}

console.log("\n[4] 树妖: +20% base heal, +50% when the target is below 20% HP");
{
  const s = setup("树妖");
  s.c.hp = s.c.maxHp * 0.5;
  ok("+20% on a target at 50% HP", near(await healTarget(s.bt, s.a, s.c, 1000), 1200));
  s.c.hp = s.c.maxHp * 0.1;
  ok("+50% on a target below 20% HP", near(await healTarget(s.bt, s.a, s.c, 1000), 1500));
  s.c.hp = s.c.maxHp * 0.5;
  ok("recover is not amplified", near(await healTarget(s.bt, s.a, s.c, 1000, { recover: true }), 1000));
  s.b.hp = s.b.maxHp * 0.5;
  ok("another unit's heal is not amplified", near(await healTarget(s.bt, s.b, s.b, 1000), 1000));
  ok("SOUL_PROC per amplified heal", procs(s.bt, "树妖").length === 2, String(procs(s.bt, "树妖").length));
  installSoulEffects(s.bt, [{ soulId: idOf("树妖"), name: "树妖", pieces: 4, desc: "" } as any], soulDefs);
  ok("re-installing on the same battle does not stack the amplifier", near(await healTarget(s.bt, s.a, s.c, 1000), 1200));
  const sealed = setup("树妖");
  sealed.bt.bus.suppressProvider = () => ({ passive: false, soul: true });
  sealed.c.hp = sealed.c.maxHp * 0.5;
  ok("a sealed wearer's heal is not amplified", near(await healTarget(sealed.bt, sealed.a, sealed.c, 1000), 1000));
}

console.log("\n[5] 钓瓶火: wearer turn end → onibi gauge +1 and heal the lowest-HP-ratio ally for 700% DEF");
{
  const s = setup("钓瓶火");
  const pool = s.bt.teams[0].orbs;
  s.c.hp = s.c.maxHp * 0.3;
  s.a.hp = s.a.maxHp * 0.6;
  const g0 = pool.gauge, hpC = s.c.hp;
  await turnEnd(s.bt, s.a);
  ok("gauge +1", pool.gauge === g0 + 1, `${g0} -> ${pool.gauge}`);
  ok("lowest-ratio ally (C) healed for 700% of the wearer's DEF", near(s.c.hp - hpC, s.a.prop("def") * 7), `${s.c.hp - hpC} vs ${s.a.prop("def") * 7}`);
  pool.gauge = pool.policy.gaugeSize - 1;
  const cycle0 = pool.cycle;
  await turnEnd(s.bt, s.a);
  ok("a fill wraps the gauge and sets the pending reward", pool.gauge === 0 && pool.cycle === cycle0 + 1 && pool.pendingReward === pool.rewardForCycle(), JSON.stringify(pool.snapshot()));
  const before = pool.gauge;
  await turnEnd(s.bt, s.c);
  ok("another unit's turn end does nothing", pool.gauge === before);
  ok("trace: ORB_GAUGE_ADVANCE_EXTRA by the soul", (s.bt.trace as any[]).filter(e => e.t === "ORB_GAUGE_ADVANCE_EXTRA" && String(e.reason).includes("钓瓶火")).length === 2);
}

console.log("\n[6] 蚌精: battle start → 10% own max HP shield for 1 turn (BASE: generic shield without duration)");
{
  const s = setup("蚌精");
  await dispatch(s.bt, EV.BATTLE_START, { battle: s.bt, self: s.a }, s.a);
  const sa = liveShields(s.a, "soul-seasprite"), sc = liveShields(s.c, "soul-seasprite");
  ok("each ally gets 10% of its own max HP", sa.length === 1 && sc.length === 1 && near(sa[0].value, s.a.maxHp * 0.1) && near(sc[0].value, s.c.maxHp * 0.1));
  ok("non-dispellable, ttl 1; enemies get none", sa[0].dispellable === false && sa[0].ttl === 1 && (s.b.shields ?? []).length === 0);
  await turnEnd(s.bt, s.a);
  ok("expires at the end of the bearer's own turn (A), C keeps its own", liveShields(s.a, "soul-seasprite").length === 0 && liveShields(s.c, "soul-seasprite").length === 1);
  await turnEnd(s.bt, s.c);
  ok("C's expires at the end of C's turn", liveShields(s.c, "soul-seasprite").length === 0);
  const b = setup("蚌精", "BASE");
  await dispatch(b.bt, EV.BATTLE_START, { battle: b.bt, self: b.a }, b.a);
  const gen = (b.a.shields ?? []).filter((x: any) => !x.broken);
  ok("BASE: generic shield, no ttl (unchanged behaviour)", gen.length === 1 && gen[0].ttl === undefined, JSON.stringify(gen.map((x: any) => [x.value, x.ttl])));
}

setSkillLevelMode("BASE");
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
