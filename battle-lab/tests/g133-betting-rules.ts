// tests/g133-betting-rules.ts — betting (MAX skill level) battle-wide rules:
//   ① effect resist SINGLE_ROLL_RATIO: hit = base × (1 + effect hit) / (1 + effect RES), one roll, RESIST event;
//   ② anti-stall endgame (referee rounds +damage / −healing, turn-cap adjudication by survivors then HP%).
// BASE mode must not see either rule (pinned fingerprints).
// Run: node battle-lab/tests/g133-betting-rules.ts
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import {
  StartupPolicies, DeathPolicies, GuessingRulesets, ResistPolicies, EndgamePolicies, defaultPolicies, policySnapshot,
} from "../kernel/policies.ts";
import { DamageType, EV, TurnType } from "../kernel/types.ts";
import { dealDamage, healTarget } from "../kernel/damage.ts";
import {
  refereeDamageMultiplier, refereeHealMultiplier, envRefereeAfterTurn, timeoutVerdict, createEnvironment,
  envDamageMultiplier, envHealMultiplier, envIsDefault, envSnapshot, envRestore,
} from "../kernel/environment.ts";
import { rollStatusContest } from "../kernel/resist.ts";
import { setSkillLevelMode } from "../compile/max-level.ts";
import { bettingPolicies, setBettingEndgame, bettingEndgameId, DEFAULT_BETTING_ENDGAME } from "../compile/betting-policies.ts";
import { assembleGuessingMatch, loadMatchFixture } from "../soul/guessing-match.ts";
import { makeGuessingEntity } from "../soul/guessing-factory.ts";
import { installSoulEffects } from "../soul/effect-system.ts";
import { captureState, restoreBattle, stateHash } from "../kernel/state.ts";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { normalizeLineup } from "../../matches/names.ts";
import type { SoulDef } from "../soul/loadout.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = path.join(ROOT, "data", "kb");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const LINEUP = path.join(ROOT, "matches", "2026-11-23-lineup.en.json");

sec("[1] Policies: presets, defaults, snapshot");
{
  ok("presets NONE / REFEREE_15_10 / REFEREE_20_10 exist", ["NONE", "REFEREE_15_10", "REFEREE_20_10"].every(k => EndgamePolicies[k]?.id === k));
  ok("engine default endgame is NONE (BASE unchanged)", defaultPolicies().endgame.id === "NONE" && defaultPolicies().resist.formula === "NONE");
  ok("policySnapshot omits endgame at NONE", !("endgame" in policySnapshot(defaultPolicies())));
  ok("policySnapshot carries a non-NONE endgame", (policySnapshot({ ...defaultPolicies(), endgame: EndgamePolicies.REFEREE_15_10 }) as any).endgame?.id === "REFEREE_15_10");
  ok("every preset states its evidence", Object.values(EndgamePolicies).every(p => (p.evidence ?? "").length > 30));
}

sec("[2] Referee multipliers (additive stacking, late step from round 11)");
{
  const p = EndgamePolicies.REFEREE_15_10, q = EndgamePolicies.REFEREE_20_10;
  ok("15/10: round 1 → ×1.15 dmg, ×0.90 heal", near(refereeDamageMultiplier(p, 1), 1.15) && near(refereeHealMultiplier(p, 1), 0.9));
  ok("15/10: round 10 → ×2.50 dmg, heal ×0", near(refereeDamageMultiplier(p, 10), 2.5) && near(refereeHealMultiplier(p, 10), 0));
  ok("15/10: round 11 → ×2.80, round 12 → ×3.10 (+30% steps)", near(refereeDamageMultiplier(p, 11), 2.8) && near(refereeDamageMultiplier(p, 12), 3.1));
  ok("heal never goes negative", refereeHealMultiplier(p, 15) === 0);
  ok("20/10: round 5 → ×2.0, round 12 → ×3.4 (no late step)", near(refereeDamageMultiplier(q, 5), 2) && near(refereeDamageMultiplier(q, 12), 3.4));
  ok("round 0 → ×1 / ×1", refereeDamageMultiplier(p, 0) === 1 && refereeHealMultiplier(p, 0) === 1);
}

sec("[3] Referee round (actionsPerRound = null, the Arena wording) = every living shikigami has acted once");
{
  const units = [{ id: 1, alive: true }, { id: 2, alive: true }, { id: 3, alive: true }];
  const fake: any = {
    policies: { endgame: { ...EndgamePolicies.REFEREE_15_10, actionsPerRound: null } }, environment: createEnvironment(), turn: 0, trace: [],
    teams: [{ aliveMembers: () => units.filter(u => u.alive && u.id < 3) }, { aliveMembers: () => units.filter(u => u.alive && u.id === 3) }],
  };
  envRefereeAfterTurn(fake, { id: 1 });
  envRefereeAfterTurn(fake, { id: 1 });   // acting twice does not complete the round
  envRefereeAfterTurn(fake, { id: 2 });
  ok("no round until all three acted", !fake.environment.round && fake.environment.refereeActed.join() === "1,2" && !envIsDefault(fake.environment));
  envRefereeAfterTurn(fake, { id: 3 });
  ok("round 1 completes → stalemate ×1.15 / ×0.9 + REFEREE_ROUND trace",
    fake.environment.round === 1 && near(envDamageMultiplier(fake.environment), 1.15) && near(envHealMultiplier(fake.environment), 0.9)
    && fake.trace.some((t: any) => t.t === "REFEREE_ROUND" && t.round === 1), JSON.stringify(fake.environment));
  units[2].alive = false;   // a dead unit is no longer awaited
  envRefereeAfterTurn(fake, { id: 1 });
  envRefereeAfterTurn(fake, { id: 2 });
  ok("dead units are not awaited (round 2 after the two survivors act)", fake.environment.round === 2 && near(envDamageMultiplier(fake.environment), 1.3));
  const none: any = { ...fake, policies: { endgame: EndgamePolicies.NONE }, environment: createEnvironment(), trace: [] };
  envRefereeAfterTurn(none, { id: 1 }); envRefereeAfterTurn(none, { id: 2 });
  ok("policy NONE: nothing is recorded (environment stays default)", envIsDefault(none.environment) && none.trace.length === 0);
}

sec("[3b] Betting presets: a referee round every REFEREE_ACTIONS_PER_ROUND (8) full turns (match-6 replay, HYPOTHESIS)");
{
  ok("both betting presets use 8 actions per round", EndgamePolicies.REFEREE_15_10.actionsPerRound === 8 && EndgamePolicies.REFEREE_20_10.actionsPerRound === 8
    && EndgamePolicies.NONE.actionsPerRound === null && !!EndgamePolicies.REFEREE_15_10.triggerEvidence);
  const units = [{ id: 1, alive: true }, { id: 2, alive: true }, { id: 3, alive: true }];
  const fake: any = {
    policies: { endgame: EndgamePolicies.REFEREE_15_10 }, environment: createEnvironment(), turn: 0, trace: [],
    teams: [{ aliveMembers: () => units.filter(u => u.alive && u.id < 3) }, { aliveMembers: () => units.filter(u => u.alive && u.id === 3) }],
  };
  for (let i = 0; i < 7; i++) envRefereeAfterTurn(fake, { id: 1 });   // the same unit 7 times; 2 and 3 never act
  ok("7 actions: no round yet, the count is state (not default)", !fake.environment.round && fake.environment.refereeActions === 7 && !envIsDefault(fake.environment));
  envRefereeAfterTurn(fake, { id: 1 });
  ok("8th action completes round 1 although units 2 and 3 never acted", fake.environment.round === 1 && !fake.environment.refereeActions
    && near(envDamageMultiplier(fake.environment), 1.15) && fake.trace.some((t: any) => t.t === "REFEREE_ROUND" && t.round === 1));
  for (let i = 0; i < 8; i++) envRefereeAfterTurn(fake, { id: 2 });
  ok("16 actions ⇒ round 2", fake.environment.round === 2 && near(envDamageMultiplier(fake.environment), 1.3));
  envRefereeAfterTurn(fake, { id: 3 });
  const snap = envSnapshot(fake.environment);
  ok("the pending count survives snapshot → restore", snap?.refereeActions === 1 && envRestore(snap).refereeActions === 1, JSON.stringify(snap));
}

sec("[4] Turn-cap verdict: survivors, then team HP%, else draw");
{
  const mk = (hp: number[], max: number[]) => ({
    members: hp.map((h, i) => ({ alive: h > 0, hp: h, maxHp: max[i], caps: { countsForVictory: true } })),
    victoryCount() { return this.members.filter((m: any) => m.alive).length; },
  });
  const b = (t0: any, t1: any, p = EndgamePolicies.REFEREE_15_10) => ({ policies: { endgame: p }, teams: [t0, t1] });
  const v1 = timeoutVerdict(b(mk([10, 10], [100, 100]), mk([90, 0], [100, 100])));
  ok("more survivors wins even with less HP", v1?.winner === 0 && v1.reason === "TIMEOUT_ALIVE", JSON.stringify(v1));
  const v2 = timeoutVerdict(b(mk([10, 10], [100, 100]), mk([50, 10], [100, 100])));
  ok("equal survivors → higher team HP% wins", v2?.winner === 1 && v2.reason === "TIMEOUT_HP" && near(v2.hpPct[0], 0.1) && near(v2.hpPct[1], 0.3), JSON.stringify(v2));
  const v3 = timeoutVerdict(b(mk([50], [100]), mk([100], [200])));
  ok("exact tie → draw", v3?.winner === null && v3.reason === "TIMEOUT_DRAW");
  ok("policy NONE → no verdict (TURN_LIMIT)", timeoutVerdict(b(mk([1], [1]), mk([1], [1]), EndgamePolicies.NONE)) === null);
}

sec("[5] Effect resist contest (kernel/resist.ts)");
{
  const fakeRng = (vals: number[]) => {
    const draws: any[] = []; let pending = "unlabeled";
    return {
      draws, expect(t: string) { pending = t; },
      testHit(p: number) { const v = vals.shift() ?? 0.5; draws.push({ v, tag: pending }); pending = "unlabeled"; return v < p; },
      get lastDraw() { return draws[draws.length - 1] ?? null; },
    };
  };
  const ent = (id: number, efh: number, efr: number) => ({ id, teamId: id, prop: (k: string) => (k === "efh" ? efh : k === "efr" ? efr : 0) });
  const debuff = { id: "stun", name: "眩晕", category: "DEBUFF_CONTROL" };
  const buff = { id: "up", name: "up", category: "BUFF_STATE" };
  const B = (formula: string, vals: number[]) => ({ policies: { resist: { formula } }, rng: fakeRng(vals) });
  const n1 = B("NONE", [0.9]);
  ok("NONE + no written chance → lands, no draw", rollStatusContest(n1, ent(1, 0, 0), ent(2, 0, 5), debuff, null, "p", "r").outcome === "LAND" && n1.rng.draws.length === 0);
  const n2 = B("NONE", [0.6]);
  ok("NONE + written 50% → one draw under the prob tag, MISS on 0.6, RES ignored",
    rollStatusContest(n2, ent(1, 0, 0), ent(2, 0, 5), debuff, 0.5, "p", "r").outcome === "MISS" && n2.rng.draws.length === 1 && n2.rng.draws[0].tag === "p");
  const s1 = B("SINGLE_ROLL_RATIO", [0.4]);
  const c1 = rollStatusContest(s1, ent(1, 0.84, 0), ent(2, 0, 0.48), debuff, 0.25, "p", "r");
  ok("formula: 25% × 1.84 / 1.48 (stats are fractions)", near(c1.effective ?? -1, 0.25 * 1.84 / 1.48) && c1.outcome === "RESIST", JSON.stringify(c1));
  const s2 = B("SINGLE_ROLL_RATIO", [0.5]);
  ok("100% control vs 100% RES: p = 0.5, roll 0.5 → RESIST (one roll)",
    rollStatusContest(s2, ent(1, 0, 0), ent(2, 0, 1), debuff, null, "p", "r").outcome === "RESIST" && s2.rng.draws.length === 1);
  const s3 = B("SINGLE_ROLL_RATIO", [0.3]);
  ok("roll under the effective chance → LAND", rollStatusContest(s3, ent(1, 0, 0), ent(2, 0, 1), debuff, null, "p", "r").outcome === "LAND");
  const s4 = B("SINGLE_ROLL_RATIO", [0.35]);
  ok("failed roll above base × (1+hit) → MISS, not RESIST", rollStatusContest(s4, ent(1, 0, 0), ent(2, 0, 0), debuff, 0.3, "p", "r").outcome === "MISS");
  const s5 = B("SINGLE_ROLL_RATIO", [0.9]);
  ok("buffs are never contested (no draw)", rollStatusContest(s5, ent(1, 0, 0), ent(2, 0, 9), buff, null, "p", "r").outcome === "LAND" && s5.rng.draws.length === 0);
  const s6 = B("SINGLE_ROLL_RATIO", [0.99]);
  ok("effect hit can push the chance to certainty", rollStatusContest(s6, ent(1, 1, 0), ent(2, 0, 0), debuff, 0.5, "p", "r").outcome === "LAND");
}

sec("[6] betting policy selection (MAX only)");
{
  setSkillLevelMode("BASE");
  ok("BASE → no overrides", Object.keys(bettingPolicies()).length === 0);
  setSkillLevelMode("MAX");
  const p = bettingPolicies();
  ok("MAX → resist SINGLE_ROLL_RATIO + endgame REFEREE_15_10 by default",
    p.resist?.id === "SINGLE_ROLL_RATIO" && p.endgame?.id === DEFAULT_BETTING_ENDGAME && DEFAULT_BETTING_ENDGAME === "REFEREE_15_10");
  setBettingEndgame("REFEREE_20_10");
  ok("setBettingEndgame selects the preset", bettingPolicies().endgame?.id === "REFEREE_20_10" && bettingEndgameId() === "REFEREE_20_10");
  let threw = "";
  try { setBettingEndgame("REFEREE_99"); } catch (e: any) { threw = String(e?.message ?? e); }
  ok("unknown preset throws with the valid ids", /REFEREE_15_10/.test(threw), threw);
  setBettingEndgame(null);
  process.env.BETTING_ENDGAME = "NONE";
  ok("env BETTING_ENDGAME is honoured", bettingPolicies().endgame?.id === "NONE");
  delete process.env.BETTING_ENDGAME;
  ok("back to the default", bettingEndgameId() === "REFEREE_15_10");
}

sec("[7] Node assembly: MAX battle carries both rules; BASE does not");
{
  const fx: any = normalizeLineup(await loadMatchFixture(LINEUP));
  setSkillLevelMode("BASE");
  const base: any = await assembleGuessingMatch(fx, { seed: 1 });
  ok("BASE assembly: endgame NONE, resist NOT_CONSUMED", base.battle.policies.endgame.id === "NONE" && base.battle.policies.resist.id === "NOT_CONSUMED");
  setSkillLevelMode("MAX");
  const A: any = await assembleGuessingMatch(fx, { seed: 100003, traceLevel: "FULL" });
  ok("MAX assembly: endgame REFEREE_15_10, resist SINGLE_ROLL_RATIO", A.battle.policies.endgame.id === "REFEREE_15_10" && A.battle.policies.resist.id === "SINGLE_ROLL_RATIO");
  await A.battle.run();
  const rounds = A.battle.trace.filter((t: any) => t.t === "REFEREE_ROUND");
  ok("referee rounds are recorded with the preset multipliers",
    rounds.length > 0 && rounds.every((t: any) => near(t.damageMultiplier, refereeDamageMultiplier(EndgamePolicies.REFEREE_15_10, t.round))), JSON.stringify(rounds.slice(0, 3)));
  // Damage really scales: same hit with and without a stalemate stage.
  const B: any = await assembleGuessingMatch(fx, { seed: 5, traceLevel: "NONE" });
  await B.battle.runStartup();
  const [src, dst] = [B.battle.teams[0].members[0], B.battle.teams[1].members[0]];
  const hitOnce = async (mul: number | null) => {
    B.battle.environment.stalemate = mul === null ? undefined : { stage: 1, damageMultiplier: mul, healingMultiplier: 1 };
    dst.hp = dst.maxHp; dst.shields = [];
    const r = await dealDamage(B.battle, { source: src, target: dst, base: 1000, rate: 1, type: DamageType.NORMAL, skillTag: "g133" });
    return r.final / (r.raw || 1) / (r.defenseMultiplier || 1);
  };
  const plain = await hitOnce(null), ramped = await hitOnce(2.5);
  ok("the stalemate damage multiplier is applied in the damage pipeline (×2.5 ± float)", ramped / plain > 2.4 && ramped / plain < 2.6, String(ramped / plain));
  const healOnce = async (mul: number) => {
    B.battle.environment.stalemate = { stage: 3, damageMultiplier: 1, healingMultiplier: mul };
    dst.hp = 1;
    return Number(await healTarget(B.battle, src, dst, 1000));
  };
  const h1 = await healOnce(1), h07 = await healOnce(0.7);
  ok("healing is reduced through the heal path (×0.7)", h1 > 0 && Math.abs(h07 / h1 - 0.7) < 1e-9, h1 + " / " + h07);
  B.battle.environment.stalemate = undefined;
  // Turn cap: adjudicated in MAX, TURN_LIMIT with the NONE preset.
  const C: any = await assembleGuessingMatch(fx, { seed: 100007, maxTurns: 4, traceLevel: "FULL" });
  const rc = await C.battle.run();
  ok("MAX turn cap → TIMEOUT_* verdict with a TIMEOUT_DECISION trace",
    /^TIMEOUT_(ALIVE|HP|DRAW)$/.test(rc.reason) && C.battle.trace.some((t: any) => t.t === "TIMEOUT_DECISION" && t.reason === rc.reason), JSON.stringify(rc));
  const D: any = await assembleGuessingMatch(fx, { seed: 100007, maxTurns: 4, policies: { endgame: EndgamePolicies.NONE } });
  const rd = await D.battle.run();
  ok("NONE preset keeps TURN_LIMIT (no winner)", rd.reason === "TURN_LIMIT" && rd.winner === null, JSON.stringify(rd));
}

sec("[8] Soul controls go through the same contest; Yamabiko reflects on a resist");
{
  const souls: SoulDef[] = JSON.parse(await fsp.readFile(path.join(KB, "soul.json"), "utf8"));
  const soulDefs = new Map<number, SoulDef>(souls.map(s => [Number(s.id), s]));
  const idOf = (name: string) => Number(souls.find(s => s.name === name)!.id);
  const R = ResourcePolicies.COMMUNITY_4_8_5_345;
  const deps = { soulDefs, charMeta: new Map([[217, { name: "A" }], [201, { name: "B" }]]) };
  const duel = (bSoul: string | null, bEfr: number, seed: number) => {
    const A = makeGuessingEntity(1, 0, { shikigamiId: 217, observed: { atk: 3000, hp: 20000, def: 400, spd: 120, cri: 0, crid: 150, efh: 0, efr: 0 }, soulIds: Array(4).fill(idOf("魅妖")) }, deps);
    const Bx = makeGuessingEntity(2, 1, { shikigamiId: 201, observed: { atk: 2500, hp: 300000, def: 400, spd: 110, cri: 0, crid: 150, efh: 0, efr: bEfr }, soulIds: bSoul ? Array(4).fill(idOf(bSoul)) : [] }, deps);
    const t0 = new Team(0, "RED", R, 1); t0.add(A.entity);
    const t1 = new Team(1, "BLUE", R, 1); t1.add(Bx.entity);
    const bt = new Battle([t0, t1], { seed, rules: { ...DEFAULT_RULES, maxTurns: 30 }, policies: {
      resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI, death: DeathPolicies.DEATH_AFTER_PREVENTION,
      priority: "REGISTRATION_ORDER", tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED,
      resist: ResistPolicies.SINGLE_ROLL_RATIO } });
    installSoulEffects(bt, [A, Bx].flatMap(x => x.resolution.soulBattleEffects), soulDefs);
    return { bt, a: A.entity, b: Bx.entity };
  };
  let resisted = 0, landed = 0, resistEvents = 0;
  for (let i = 0; i < 60; i++) {
    const s = duel(null, 300, 1000 + i);
    s.bt.bus.register({ id: "PROBE:RESIST", ownerId: s.b.id, code: EV.RESIST, range: "ALL", priority: 99, passive: false, fn: () => { resistEvents++; } });
    await dealDamage(s.bt, { source: s.a, target: s.b, base: 3000, rate: 1, type: DamageType.NORMAL, skillTag: "test" });
    resisted += s.bt.trace.filter((t: any) => t.t === "STATUS_RESIST" && t.status === "confuse").length;
    landed += s.b.hasStatus("confuse") ? 1 : 0;
  }
  ok("Temptress confusion vs 300% RES is mostly resisted (STATUS_RESIST + EV.RESIST)", resisted > 0 && resistEvents === resisted && landed < 10, JSON.stringify({ resisted, landed, resistEvents }));
  let reflected = 0;
  for (let i = 0; i < 80 && !reflected; i++) {
    const s = duel("幽谷响", 300, 2000 + i);
    await dealDamage(s.bt, { source: s.a, target: s.b, base: 3000, rate: 1, type: DamageType.NORMAL, skillTag: "test" });
    if (s.bt.trace.some((t: any) => t.t === "STATUS_APPLY" && t.reason === "REFLECTED" && t.dst === s.a.id) && s.a.hasStatus("confuse")) reflected++;
  }
  ok("Yamabiko fires under SINGLE_ROLL_RATIO (resisted confusion reflected to the source)", reflected > 0);
}

sec("[9] Web assembly parity + save/restore keeps the endgame state");
{
  setSkillLevelMode("MAX");
  const kit = createKit(bundle);
  const a: any = assembleMatch(kit, canonicalMatch(), { seed: 20261133 });
  ok("web MAX assembly: same two policies", a.battle.policies.endgame.id === "REFEREE_15_10" && a.battle.policies.resist.id === "SINGLE_ROLL_RATIO");
  await a.battle.runStartup();
  for (let i = 0; i < 400 && !(a.battle.environment.round >= 1 && a.battle.environment.refereeActions); i++) {
    const id = a.battle.timeline.advance(); if (id === null) break;
    const actor = a.battle.entity(id); if (!actor || !actor.alive) continue;
    a.battle.turn++;
    await a.battle.runTurn(actor, TurnType.NORMAL);
    if (await a.battle.resolveBoundary()) break;
  }
  const snap: any = JSON.parse(JSON.stringify(captureState(a.battle)));
  ok("state carries policyIds.endgame/resist and the referee round", snap.policyIds.endgame === "REFEREE_15_10" && snap.policyIds.resist === "SINGLE_ROLL_RATIO" && snap.environment?.round >= 1, JSON.stringify({ p: snap.policyIds, env: snap.environment }));
  const deps = { kit, makeRuntime: (id: number) => runtimeFor(kit, id), attachRuntime };
  const b: any = restoreBattle(snap, deps as any);
  ok("restored battle keeps the policies and referee progress", b.policies.endgame.id === "REFEREE_15_10" && b.environment.round === snap.environment.round
    && b.environment.refereeActions === snap.environment.refereeActions && snap.environment.refereeActions > 0);
  await a.battle.run(); await b.run();
  const ha = stateHash(captureState(a.battle)), hb = stateHash(captureState(b));
  ok("continuous run == save → restore → resume (final fingerprint)", ha === hb, ha + " vs " + hb);
  setSkillLevelMode("BASE");
  const c: any = assembleMatch(kit, canonicalMatch(), { seed: 20261133 });
  ok("web BASE assembly: neither rule", c.battle.policies.endgame.id === "NONE" && c.battle.policies.resist.id === "NOT_CONSUMED" && !("endgame" in captureState(c.battle).policyIds));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
