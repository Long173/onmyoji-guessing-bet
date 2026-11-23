// tests/ui25-betting-readiness.ts — betting (MAX) mode readiness / Fidelity panels for the 5 sample matches.
//
// The web worker always runs MAX (workers/simulation.worker.ts). This test does the same and checks:
//   ① no CJK text in the rendered Fidelity panel (all layers and the per-skill list expanded), the readiness
//     panel, or the unit tiles, for every matches/ui/*.json sample;
//   ② match 5 indicators say what the battle really runs: hand-written betting AI counts as high confidence,
//     hand-written soul installers count as full, the endgame slot shows policies.endgame (REFEREE_15_10,
//     HYPOTHESIS) instead of the replaced guessing ruleset, skills the AI never casts are NEVER_CAST (not a gap);
//   ③ honest gaps stay visible (match 1 / match 3 keep their skill without executable values).
// Run: node apps/web/tests/ui25-betting-readiness.ts
import fs from "node:fs";
import path from "node:path";
import { setSkillLevelMode } from "../../../battle-lab/compile/max-level.ts";
import { createEngineAdapter } from "../src/adapters/engine-adapter.ts";
import { skillStatusOf } from "../src/contracts/fidelity-view.ts";
import { buildHarness } from "../tools/ssr-harness/build.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const here = import.meta.dirname;
const ROOT = path.resolve(here, "..", "..", "..");
const CJK = /[　-〿㐀-鿿豈-﫿＀-￯]/;
const cjkSample = (html: string) => { const m = CJK.exec(html); return m ? html.slice(Math.max(0, m.index - 60), m.index + 40) : ""; };

setSkillLevelMode("MAX");
const bundle = JSON.parse(fs.readFileSync(path.join(here, "..", "src", "engine", "bundle.json"), "utf8"));
const adapter = createEngineAdapter(bundle);
const built = await buildHarness();
ok("SSR harness built", built.ok, built.error ?? "");
const H: any = built.module;

const files = fs.readdirSync(path.join(ROOT, "matches", "ui")).filter(f => /^2026-11-23[a-e]?-lineup\.json$/.test(f)).sort();
ok("5 sample matches found", files.length === 5, files.join(", "));
const reports = new Map<string, any>();

sec("[1] No CJK in the rendered panels (betting mode)");
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "matches", "ui", f), "utf8"));
  const match = j.match ?? j;
  const v: any = await adapter.validate(match);
  reports.set(f, { match, v });
  const panel: string = await H.renderPanel(v.fidelity, true);
  const health: string = await H.renderHealth(match, v);
  ok(`${f}: Fidelity panel rendered expanded (layers + per-skill list)`, /Per-skill compile status/.test(panel) && /Skills in this match/.test(panel), String(panel.length));
  ok(`${f}: no CJK in the Fidelity panel`, !CJK.test(panel), cjkSample(panel));
  ok(`${f}: no CJK in the readiness panel`, !CJK.test(health), cjkSample(health));
  let tilesClean = true, sample = "";
  for (const side of ["red", "blue"] as const) {
    for (const [i, u] of match[side].units.entries()) {
      const html: string = await H.renderTile({ unit: u, side, index: i, skillStatus: skillStatusOf(v.fidelity, side, u.name), support: v.units?.find((x: any) => x.side === side && x.name === u.name) ?? null });
      if (CJK.test(html)) { tilesClean = false; sample ||= cjkSample(html); }
    }
  }
  ok(`${f}: no CJK in the 10 unit tiles`, tilesClean, sample);
}

sec("[2] Match 5: indicators match what the battle runs");
{
  const { match, v } = reports.get("2026-11-23e-lineup.json");
  ok("AI high confidence 10/10 (4 hand-written betting AI)", v.coverage.aiHigh === 10 && v.coverage.aiHandWritten === 4, JSON.stringify([v.coverage.aiHigh, v.coverage.aiHandWritten]));
  ok("Soul battle effects 10 full / 0 partial (9 hand-written)", v.coverage.soulEffectsFull === 10 && v.coverage.soulEffectsPartial === 0 && v.coverage.soulEffectsCustom === 9,
    JSON.stringify([v.coverage.soulEffectsFull, v.coverage.soulEffectsPartial, v.coverage.soulEffectsCustom]));
  ok("endgame slot = REFEREE_15_10 (HYPOTHESIS), no UNKNOWN", v.strategySnapshot.endgame.id === "REFEREE_15_10" && v.strategySnapshot.endgame.status === "HYPOTHESIS" && v.strategySnapshot.unknownCount === 0,
    JSON.stringify(v.strategySnapshot.endgame));
  ok("endgame note says what COMMUNITY_2020_UNVERIFIED still does", /COMMUNITY_2020_UNVERIFIED/.test(v.strategySnapshot.endgame.note ?? "") && /no-Onmyoji/.test(v.strategySnapshot.endgame.note ?? ""));
  const health: string = await H.renderHealth(match, v);
  ok("readiness panel: AI tooltip names the hand-written betting AI", /hand-written betting AI/.test(health));
  ok("readiness panel: Endgame rule row shows REFEREE_15_10", /Endgame rule/.test(health) && /REFEREE_15_10 \(HYPOTHESIS\)/.test(health) && /No UNKNOWN/.test(health));
  const sk = (unit: string, id: string) => (v.fidelity.skills as any[]).find(s => s.unit === unit && s.skillId === id);
  const ungaikyo = match.red.units.find((u: any) => u.shikigamiId === 344).name;
  ok("Ungaikyo skill 2 (344_05) is NEVER_CAST, not a gap", sk(ungaikyo, "344_05")?.klass === "NEVER_CAST", JSON.stringify(sk(ungaikyo, "344_05")));
  ok("verdict is not 'unusable' (no skill without values left)", v.fidelity.klass !== "INSUFFICIENT", v.fidelity.klass);
  ok("effect HIT / RES caveat says they are resolved (SINGLE_ROLL_RATIO)", v.fidelity.caveats.some((c: string) => /SINGLE_ROLL_RATIO/.test(c)) && !v.fidelity.caveats.some((c: string) => /take no part/.test(c)));
  const yoto = match.red.units.find((u: any) => u.shikigamiId === 593);
  const sup = v.units.find((x: any) => x.name === yoto.name);
  ok("unit support: Yoto Hime's AI is the hand-written betting rule", sup?.ai.handWritten === "betting-ai-rules.ts", JSON.stringify(sup?.ai));
  const tile: string = await H.renderTile({ unit: yoto, side: "red", index: 3, skillStatus: skillStatusOf(v.fidelity, "red", yoto.name), support: sup });
  ok("tile: AI dot says hand-written, no ◐ / ✕ in the skill tally", /Hand-written betting AI/.test(tile) && !/[◐✕]/.test(tile), "");
  const fen = v.units.find((x: any) => x.soul?.id === 20);
  ok("unit support: Fenikkusu is a hand-written FULL soul", fen?.soul.support === "FULL" && fen?.soul.custom === true, JSON.stringify(fen?.soul));
}

sec("[3] Honest gaps stay visible");
for (const f of ["2026-11-23-lineup.json", "2026-11-23c-lineup.json"]) {
  const { v } = reports.get(f);
  ok(`${f}: still INSUFFICIENT with a real skill gap`, v.fidelity.klass === "INSUFFICIENT" && (v.fidelity.skills as any[]).some(s => s.klass === "NONE"), v.fidelity.klass);
}
setSkillLevelMode("BASE");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
