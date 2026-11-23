// tests/betting-mechanics-9.ts — crit RES (kernel/damage.ts `critRes`) and 铃彦姬 376 心火永明 granting it
//   (betting-suzuhiko.ts). Global 335_02 L5: "Crit RES, meaning the damage source is treated as having 30% less
//   Crit" ⇒ effective crit = max(0, attacker cri − target critRes). Fandom "Suzuhiko Hime/Main" Undying Flame:
//   "she gains 100% of Crit RES … Also increases other allies' Crit RES and DEF by 40%."
// Run: node battle-lab/tests/betting-mechanics-9.ts
import { setSkillLevelMode } from "../compile/max-level.ts";
import { assembleGuessingMatch } from "../soul/guessing-match.ts";
import type { MatchFixture, MatchEntry } from "../soul/guessing-match.ts";
import { SUZU, UNDYING_ID, inUndying } from "../compile/betting-suzuhiko.ts";
import { bettingKitSkillOf } from "../compile/betting-coverage.ts";
import { DamageType } from "../kernel/types.ts";

setSkillLevelMode("MAX");

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };
const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

const unit = (shikigamiId: number, hp: number, extra: Partial<MatchEntry["stats"]> = {}): MatchEntry => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
const TANKS = () => [unit(201, 900000), unit(201, 900000), unit(201, 900000)];
async function match(red: MatchEntry[], blue: MatchEntry[], seed = 1, startup = true) {
  const fx: MatchFixture = { _meta: { title: "betting-mechanics-9" }, red, blue };
  const A = await assembleGuessingMatch(fx, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  if (startup) await b.runStartup();
  const find = (charId: number, team = 1) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find };
}
const critRes = (e: any, value: number) => e.addModifier({ prop: "critRes", value, mode: "FIXED", source: "test" });
const lastDamage = (b: any) => [...b.trace].reverse().find((t: any) => t.t === "DAMAGE");
async function hits(b: any, src: any, dst: any, n: number) {
  const out: any[] = [];
  for (let i = 0; i < n; i++) {
    await b.damage(src, dst, 100, DamageType.NORMAL, 1, null);
    out.push(lastDamage(b));
  }
  return out;
}

sec("[1] the crit roll honours critRes: effective crit = max(0, cri − critRes)");
{
  const { b } = await match([unit(201, 900000, { cri: 100 })], TANKS(), 11);
  const src = b.teams[0].members[0], [full, part, none] = b.teams[1].members;
  critRes(full, 1); critRes(part, 0.4);
  const fullHits = await hits(b, src, full, 40);
  ok("100% crit vs 100% critRes ⇒ never crits", fullHits.every(t => !t.crit && t.breakdown.crit.cri === 0), fullHits.filter(t => t.crit).length + " crits");
  ok("breakdown records the raw crit and the RES", near(fullHits[0].breakdown.crit.criRaw, 1) && near(fullHits[0].breakdown.crit.critRes, 1));
  ok("the crit roll is still drawn (RNG stream unchanged)", fullHits.every(t => t.breakdown.crit.roll !== null));
  const partHits = await hits(b, src, part, 400);
  const rate = partHits.filter(t => t.crit).length / partHits.length;
  ok("100% crit vs 40% critRes ⇒ cri 0.6", partHits.every(t => near(t.breakdown.crit.cri, 0.6)));
  ok("…and a crit exactly when roll < 0.6", partHits.every(t => t.crit === (t.breakdown.crit.roll.v < 0.6)), "rate " + rate.toFixed(3));
  ok("observed crit rate ≈ 60% (n=400)", rate > 0.5 && rate < 0.7, rate.toFixed(3));
  const noneHits = await hits(b, src, none, 20);
  ok("no critRes ⇒ 100% crit, no critRes keys in the breakdown", noneHits.every(t => t.crit && t.breakdown.crit.cri === 1 && !("critRes" in t.breakdown.crit) && !("criRaw" in t.breakdown.crit)));
  const { b: b2 } = await match([unit(201, 900000, { cri: 30 })], TANKS(), 12);
  critRes(b2.teams[1].members[0], 0.4);
  const low = await hits(b2, b2.teams[0].members[0], b2.teams[1].members[0], 60);
  ok("critRes above the attacker's crit clamps to 0 (never negative)", low.every(t => !t.crit && t.breakdown.crit.cri === 0));
}

sec("[2] zero critRes is bit-identical");
{
  const lineup = () => ({
    red: [unit(201, 30000, { cri: 60, crid: 180, spd: 130 }), unit(201, 28000, { cri: 90 }), unit(201, 26000, { cri: 30, spd: 115 })],
    blue: [unit(201, 30000, { cri: 50, spd: 125 }), unit(201, 27000, { cri: 80, crid: 200 }), unit(201, 29000, { cri: 20 })],
  });
  const fingerprint = async (zeroRes: boolean) => {
    const { red, blue } = lineup();
    const { b } = await match(red, blue, 77, false);
    if (zeroRes) for (const m of [...b.teams[0].members, ...b.teams[1].members]) critRes(m, 0);
    const r = await b.run();
    const dmg = b.trace.filter((t: any) => t.t === "DAMAGE");
    return { key: JSON.stringify([r.winner, r.reason, r.turns, dmg.map((t: any) => [t.src, t.dst, t.final, t.crit, t.breakdown?.crit])]), dmg, b };
  };
  const plain = await fingerprint(false), zero = await fingerprint(true);
  const crits = plain.dmg.filter((t: any) => t.crit).length;
  ok("battle with a 0 critRes modifier on every unit == battle without one", plain.key === zero.key && crits > 0 && crits < plain.dmg.length,
    plain.dmg.length + " damage events, " + crits + " crits");
  const unitById = (id: number) => [...plain.b.teams[0].members, ...plain.b.teams[1].members].find((m: any) => m.id === id);
  ok("no critRes ⇒ no critRes keys and the roll uses the attacker's own crit", plain.dmg.every((t: any) => !t.breakdown?.crit?.canCrit || t.breakdown.crit.forced
    || (!("critRes" in t.breakdown.crit) && near(t.breakdown.crit.cri, unitById(t.src).prop("cri")))));
  setSkillLevelMode("BASE");
  const { red, blue } = lineup();
  const { b } = await match(red, [unit(376, 20000), ...blue.slice(0, 2)], 5);
  const s = b.teams[1].members.find((m: any) => m.skills.some((k: any) => k.ir?.charId === 376));
  s.hp = 10;
  await b.damage(b.teams[0].members[0], s, 999999, DamageType.TRUE, 1, null);
  ok("BASE: 铃彦姬's lethal does not enter 心火永明 and grants no critRes",
    !s.hasStatus(UNDYING_ID) && [...b.teams[0].members, ...b.teams[1].members].every((m: any) => m.prop("critRes") === 0));
  setSkillLevelMode("MAX");
}

sec("[3] 心火永明 grants Crit RES +100% (self) / +40% (other allies) while it lasts");
{
  const { b, find } = await match([unit(201, 900000, { cri: 100 })], [unit(376, 20000), unit(201, 20000), unit(201, 20000)], 5);
  const s = find(376), foe = b.teams[0].members[0], allies = b.teams[1].members.filter((m: any) => m.id !== s.id);
  ok("constants: 100% / 40%", SUZU.undyingCritRes === 1 && SUZU.allyCritRes === 0.4);
  ok("before: no critRes anywhere", [s, ...allies, foe].every((m: any) => m.prop("critRes") === 0));
  s.hp = 10;
  await b.damage(foe, s, 999999, DamageType.TRUE, 1, null);
  ok("lethal ⇒ 心火永明", s.alive && inUndying(s));
  ok("self critRes 1, allies 0.4, enemy 0", s.prop("critRes") === 1 && allies.every((m: any) => near(m.prop("critRes"), 0.4)) && foe.prop("critRes") === 0,
    [s, ...allies, foe].map((m: any) => m.prop("critRes")).join("/"));
  for (const x of s.shields ?? []) x.broken = true;
  s.shields = [];
  const onHer = await hits(b, foe, s, 30);
  ok("a 100%-crit attacker never crits her", onHer.every(t => !t.crit && t.breakdown.crit.cri === 0));
  const onAlly = await hits(b, foe, allies[0], 30);
  ok("…and rolls 60% against her allies", onAlly.every(t => near(t.breakdown.crit.cri, 0.6) && t.crit === (t.breakdown.crit.roll.v < 0.6)));
  s.hp = s.maxHp;
  await b.bus.dispatch("ACTION_END", { actor: allies[0] }, allies[0].id, allies[0].teamId, (id: number) => b.teamOf(id));
  ok("HP full ⇒ she returns and every critRes is gone", !inUndying(s) && [s, ...allies].every((m: any) => m.prop("critRes") === 0),
    [s, ...allies].map((m: any) => m.prop("critRes")).join("/"));
  ok("coverage: 376_02 now FULL", bettingKitSkillOf("376_02")?.level === "FULL", JSON.stringify(bettingKitSkillOf("376_02")));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
