// tests/g135-betting-coverage.ts — compile/betting-coverage.ts must say exactly what the betting modules do.
//   ① every declared hand-written AI rule returns a decision in a MAX battle; undeclared lineup units get none;
//   ② every kit skill id is referenced by the module it names (the module really handles that skill);
//   ③ never-cast skills come from the gates and bettingGate refuses them in a real battle;
//   ④ BASE mode: every query answers "nothing hand-written".
// Run: node battle-lab/tests/g135-betting-coverage.ts
import fs from "node:fs";
import path from "node:path";
import { setSkillLevelMode } from "../compile/max-level.ts";
import { BETTING_AI_RULES, BETTING_KIT_SKILLS, bettingAiRuleOf, bettingKitSkillOf, bettingNeverCastOf } from "../compile/betting-coverage.ts";
import { bettingPreferredSkill, bettingGate } from "../compile/betting-mechanics.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

sec("[4] BASE mode: nothing is hand-written");
setSkillLevelMode("BASE");
ok("bettingAiRuleOf(593) = null in BASE", bettingAiRuleOf(593) === null);
ok("bettingKitSkillOf(593_04) = null in BASE", bettingKitSkillOf("593_04") === null);
ok("bettingNeverCastOf(344_05) = null in BASE", bettingNeverCastOf("344_05") === null);

setSkillLevelMode("MAX");
const kit = createKit(bundle);
/** One MAX battle with `id` in red slot 1; returns the battle and that entity. */
function withUnit(id: number) {
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: id, name: String(id) };
  const a = assembleMatch(kit, m, { seed: 7 });
  return { battle: a.battle, e: a.battle.teams[0].members.find((x: any) => x.shikigamiId === id) };
}

sec("[1] Hand-written AI rules really decide in MAX");
for (const id of Object.keys(BETTING_AI_RULES).map(Number)) {
  const { battle, e } = withUnit(id);
  const pick = e ? bettingPreferredSkill(battle, e) : null;
  ok(`${id} (${BETTING_AI_RULES[id]}): bettingPreferredSkill decides`, !!pick?.skill, pick ? pick.rule : "no entity / null");
  ok(`${id}: bettingAiRuleOf reports it`, bettingAiRuleOf(id) === BETTING_AI_RULES[id]);
}
const lineupIds = new Set<number>();
for (const f of fs.readdirSync(path.join(ROOT, "matches", "ui")).filter(x => !x.includes(".min."))) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "matches", "ui", f), "utf8"));
  const m = j.match ?? j;
  for (const s of ["red", "blue"]) for (const u of m[s].units) if (u.shikigamiId) lineupIds.add(u.shikigamiId);
}
for (const id of [...lineupIds].filter(x => !(x in BETTING_AI_RULES))) {
  const { battle, e } = withUnit(id);
  const pick = e ? bettingPreferredSkill(battle, e) : null;
  ok(`${id}: no hand-written rule declared ⇒ none decides`, pick === null && bettingAiRuleOf(id) === null, pick?.rule ?? "");
}

sec("[2] Kit skills are named by the module they cite (code or header)");
for (const [sid, k] of Object.entries(BETTING_KIT_SKILLS)) {
  const src = fs.readFileSync(path.join(ROOT, "battle-lab", "compile", k.module), "utf8");
  ok(`${sid} → ${k.module} (${k.level})`, src.includes(sid) && k.note.length > 10);
}
ok("bettingKitSkillOf(388_01) = FULL Momiji kit", bettingKitSkillOf("388_01")?.module === "betting-momiji.ts");
ok("unknown skill → null", bettingKitSkillOf("230_01") === null);

sec("[3] Never-cast skills come from the gates");
for (const [sid, shiki] of [["344_05", 344], ["562_02", 562], ["365_02", 365]] as const) {
  const why = bettingNeverCastOf(sid);
  const { battle, e } = withUnit(shiki);
  const sk = e?.skills.find((s: any) => s?.ir?.id === sid);
  ok(`${sid}: never cast (${why})`, !!why && /never casts/.test(why));
  ok(`${sid}: bettingGate refuses it in a real battle`, !!sk && !!bettingGate(battle, e, sk), sk ? "" : "skill missing on entity");
}
ok("365_03 (state-dependent gate) is not 'never cast'", bettingNeverCastOf("365_03") === null);
ok("344_06 is cast ⇒ not 'never cast'", bettingNeverCastOf("344_06") === null);
setSkillLevelMode("BASE");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
