// tests/betting-mechanics-10.ts — replay review of matches 5/6 (2026-11-23e/f), MAX (betting) mode:
//   · betting max-HP multiplier BETTING_HP_SCALE = 2.42 (compile/betting-policies.ts, soul/guessing-factory.ts),
//     both assembly paths, panel echo still on the unscaled input, BASE unchanged;
//   · Garuda's 10% max-HP heal back to the KB text (the 24.2% calibration double-counted the HP scale);
//   · referee rounds (kernel/policies.ts; since 2026-11-24 a speed-114 referee clock, the 8-action preset kept);
//   · Fengyang L5 bar once per referee round, style switches only on own-turn casts (betting-fengyang.ts);
//   · "highest ATK ally" targeting = panel ATK + permanent kit forms (Yin Ungaikyo), not debuffs (ai-compiler.ts).
// Run: node battle-lab/tests/betting-mechanics-10.ts
import fs from "node:fs";
import path from "node:path";
import { setSkillLevelMode } from "../compile/max-level.ts";
import { assembleGuessingMatch, loadMatchFixture } from "../soul/guessing-match.ts";
import type { MatchFixture, MatchEntry } from "../soul/guessing-match.ts";
import { verifyGuessingPanel } from "../soul/guessing-factory.ts";
import { BETTING_HP_SCALE, BETTING_HP_SCALE_RULE, bettingHpScale } from "../compile/betting-policies.ts";
import { GARUDA } from "../compile/betting-garuda.ts";
import { styleOf, SKY_ID } from "../compile/betting-fengyang.ts";
import { targetingAtk } from "../compile/ai-compiler.ts";
import { formOf } from "../compile/betting-ungaikyo.ts";
import { EndgamePolicies, REFEREE_ACTIONS_PER_ROUND, REFEREE_CLOCK_SPEED } from "../kernel/policies.ts";
import { TurnType } from "../kernel/types.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { normalizeLineup } from "../../matches/names.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
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
async function match(blue: MatchEntry[], seed = 1, red: MatchEntry[] = RED()) {
  const fx: MatchFixture = { _meta: { title: "betting-mechanics-10" }, red, blue };
  const A = await assembleGuessingMatch(fx, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  const find = (charId: number, team = 1) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { A, b, find, enemies: () => b.enemiesOf(1) as any[] };
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => {
  const s = sk(e, id);
  return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target));
};
const dispatch = (b: any, code: string, actor: any) => b.bus.dispatch(code, { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const pos = (b: any, e: any) => b.timeline.get(e.id)?.pos ?? 0;
/** The test never runs the timeline, so the bar stays full after a boost: empty it (as after a real turn). */
const emptyBar = (b: any, e: any) => { const slot = b.timeline.get(e.id); if (slot) slot.pos = 0; };
const M6 = path.join(ROOT, "matches", "2026-11-23f-lineup.en.json");

sec("[1] Betting HP scale: real max HP = Lineup HP × 2.42 (HYPOTHESIS), both paths, echo on the unscaled input");
{
  setSkillLevelMode("MAX");
  ok("rule: 2.42, HYPOTHESIS, evidence cites the replays", BETTING_HP_SCALE === 2.42 && bettingHpScale() === 2.42
    && BETTING_HP_SCALE_RULE.status === "HYPOTHESIS" && /3847/.test(BETTING_HP_SCALE_RULE.evidence) && /4855/.test(BETTING_HP_SCALE_RULE.evidence));
  const fx: any = normalizeLineup(await loadMatchFixture(M6));
  const A: any = await assembleGuessingMatch(fx, { seed: 1 });
  const suzu = A.blue[1];
  ok("Suzuhikohime 12229 → max HP 29594, starts full", suzu.entity.maxHp === Math.round(12229 * 2.42) && suzu.entity.hp === suzu.entity.maxHp && suzu.entity.base.hp === suzu.entity.maxHp,
    suzu.entity.hp + "/" + suzu.entity.maxHp);
  ok("…13% HP cost ≈ 3847, 8% heal ≈ 2367 (replay)", Math.abs(0.13 * suzu.entity.maxHp - 3847) < 2 && Math.abs(0.08 * suzu.entity.maxHp - 2367) < 2);
  ok("panel echo compares the unscaled input: no stat-echo issue", [...A.red, ...A.blue].every((r: any) => verifyGuessingPanel(r).ok) && !A.issues.some((i: string) => /回显/.test(i)));
  ok("resolution.exact keeps the screenshot HP", suzu.resolution.exact.hp === 12229);
  ok("ATK / DEF are not scaled", suzu.entity.base.atk === 4831 && suzu.entity.base.def === 677);
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
  const kit = createKit(bundle);
  const m = canonicalMatch();
  const w: any = assembleMatch(kit, m, { seed: 1 });
  const hp0 = Number(m.red.units[0].stats.hp);
  ok("web path scales the same way (Node vs Web parity)", w.battle.teams[0].members[0].maxHp === Math.round(hp0 * 2.42), String(w.battle.teams[0].members[0].maxHp));
  setSkillLevelMode("BASE");
  const wb: any = assembleMatch(kit, m, { seed: 1 });
  const nb: any = await assembleGuessingMatch(fx, { seed: 1 });
  ok("BASE: scale 1 on both paths (fingerprints unchanged)", bettingHpScale() === 1 && wb.battle.teams[0].members[0].maxHp === hp0 && nb.blue[1].entity.maxHp === 12229);
  setSkillLevelMode("MAX");
}

sec("[2] Garuda: heal back to the KB 10% of max HP (4855 = 10% × 20065 × 2.42)");
{
  ok("GARUDA.healRatio = 0.1", GARUDA.healRatio === 0.1);
  const { find } = await match([unit(378, 20065, { atk: 3908 }), unit(201, 20000)], 2);
  ok("Garuda's max HP 48557 ⇒ heal floors to 4855", Math.floor(find(378).maxHp * GARUDA.healRatio) === 4855, String(find(378).maxHp));
}

sec("[3] Referee rounds: the speed-114 clock (default) still gives ~8 actions per round in match 6; the 8-action preset is kept");
{
  ok("REFEREE_15_10 / 20_10: actionsPerRound = 8 (kept to revert)", REFEREE_ACTIONS_PER_ROUND === 8 && EndgamePolicies.REFEREE_15_10.actionsPerRound === 8);
  ok("default clock speed 114", REFEREE_CLOCK_SPEED === 114 && EndgamePolicies.REFEREE_CLOCK_114.refereeSpeed === 114);
  const fx: any = normalizeLineup(await loadMatchFixture(M6));
  const A: any = await assembleGuessingMatch(fx, { seed: 100000, traceLevel: "FULL" });
  await A.battle.run();
  const rounds = (A.battle.trace as any[]).filter(t => t.t === "REFEREE_ROUND");
  // Replay: banners after ~8 and ~16 top-level actions (Okuribito / Ungaikyo held back).
  ok("match 6: round 1 after 7-9 actions, round 2 after 15-19", rounds.length >= 2 && rounds[0].turn >= 7 && rounds[0].turn <= 9
    && rounds[1].turn >= 15 && rounds[1].turn <= 19 && rounds.every((t, i) => t.round === i + 1), rounds.map(t => t.turn).join(","));
  ok("damage ×1.15 per round from round 1", near(rounds[0].damageMultiplier, 1.15) && near(rounds[1].damageMultiplier, 1.3));
}

sec("[4] Fengyang: +100% bar once per referee round; only own-turn casts switch the style");
{
  const { b, find, enemies } = await match([unit(575, 20000, { atk: 4000 }), unit(201, 20000), unit(201, 20000)], 3);
  const f = find(575), foes = enemies();
  b.teams[1].orbs.orb = 8;
  await dispatch(b, "TURN_START", f);
  let p0 = pos(b, f);
  await cast(b, f, "575_03", foes[0]);
  ok("first switch (NONE → 晴空) in his turn: +100% bar", styleOf(f) === "SKY" && pos(b, f) - p0 >= 9999, String(pos(b, f) - p0));
  // Inaba's 邀战 basic on someone else's turn: no switch (stays 晴空).
  await dispatch(b, "TURN_START", foes[0]);
  await cast(b, f, "575_01", foes[1]);
  ok("basic attack outside his turn (邀战): style stays 晴空", styleOf(f) === "SKY" && f.hasStatus(SKY_ID));
  // Next own turn, same referee round: the switch to 霁雪 gives no bar.
  b.turn++;
  emptyBar(b, f);
  await dispatch(b, "TURN_START", f);
  p0 = pos(b, f);
  await cast(b, f, "575_01", foes[1]);
  ok("next turn, same round: switch to 霁雪 but no second bar boost", styleOf(f) === "SNOW" && pos(b, f) - p0 < 1, String(pos(b, f) - p0));
  // New referee round: the boost is available again.
  b.environment.round = (b.environment.round ?? 0) + 1;
  b.turn++;
  emptyBar(b, f);
  await dispatch(b, "TURN_START", f);
  p0 = pos(b, f);
  await cast(b, f, "575_03", foes[0]);
  ok("new referee round: switch to 晴空 gives +100% again", styleOf(f) === "SKY" && pos(b, f) - p0 >= 9999, String(pos(b, f) - p0));
}

sec("[5] Highest-ATK ally targeting: panel ATK + permanent forms (Yin Ungaikyo), not debuffs");
{
  const { find } = await match([unit(344, 11618, { atk: 4241, def: 707 }), unit(277, 14443, { atk: 5484, def: 703 })], 4);
  const u = find(344), kuro = find(277);
  ok("Yin Ungaikyo: 4241 + 2 × 707 = 5655 > Kuro's 5484", formOf(u) === "YIN" && near(targetingAtk(u), 5655) && targetingAtk(kuro) === 5484, String(targetingAtk(u)));
  kuro.addModifier({ prop: "atk", value: -0.35, mode: "ADD_RATE", source: "st_test:紧盯" });
  ok("status / debuff modifiers are ignored (match-4 紧盯 rule kept)", targetingAtk(kuro) === 5484);
  const fx: any = normalizeLineup(await loadMatchFixture(M6));
  let onUng = 0;
  const N = 5;
  for (let s = 0; s < N; s++) {
    const A: any = await assembleGuessingMatch(fx, { seed: 100000 + s, traceLevel: "FULL" });
    await A.battle.run();
    const first = (A.battle.trace as any[]).find(t => t.t === "STATUS_APPLY" && t.status === "5965_1" && t.note);
    if (first && A.battle.entity(first.dst)?.name === "云外镜") onUng++;
  }
  ok("match 6: Kannazuki's first 入梦 goes to Ungaikyo (Kuro then pays full 3 onibi, as in the replay)", onUng === N, `${onUng}/${N}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
