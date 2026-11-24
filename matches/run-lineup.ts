// matches/run-lineup.ts — Monte Carlo win rate for one lineup file.
// Usage: node matches/run-lineup.ts file=matches/2026-11-23-lineup.en.json n=1000 [seedBase=100000] [maxTurns=300]
//        [endgame=NONE|REFEREE_CLOCK_114|REFEREE_15_10|REFEREE_20_10]   (or env BETTING_ENDGAME; default REFEREE_CLOCK_114)
// Lineup entries may use Global English names: { "name": "Shiro Mujou", "soul": "Temptress", "stats": {...} }
import path from "node:path";
import { setSkillLevelMode } from "../battle-lab/compile/max-level.ts";
import { setBettingEndgame, bettingEndgameId } from "../battle-lab/compile/betting-policies.ts";
import { assembleGuessingMatch, loadMatchFixture } from "../battle-lab/soul/guessing-match.ts";
import { wilson } from "../battle-lab/runner/monte-carlo.ts";
import { enShiki, enSoul, normalizeLineup } from "./names.ts";

// Betting mode uses max skill levels.
setSkillLevelMode("MAX");

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split("=") as [string, string]));
if (!args.file) {
  console.error("Usage: node matches/run-lineup.ts file=<lineup.json> n=1000");
  process.exit(2);
}
if (args.endgame) setBettingEndgame(args.endgame);   // throws on an unknown preset
const n = Number(args.n ?? 500);
const seedBase = Number(args.seedBase ?? 100000);
const maxTurns = Number(args.maxTurns ?? 300);
const fx: any = normalizeLineup(await loadMatchFixture(path.resolve(args.file)));

let red = 0, blue = 0, stall = 0, draw = 0, turnsSum = 0;
const reasons = new Map<string, number>();
let issues: string[] = [];
let souls: any = null;
const started = Date.now();
for (let i = 0; i < n; i++) {
  const A: any = await assembleGuessingMatch(fx, { seed: seedBase + i, maxTurns });
  if (i === 0) { issues = A.issues ?? []; souls = A.battle.soulReport; }
  const r = await A.battle.run();
  reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  turnsSum += r.turns ?? 0;
  if (r.reason === "TURN_LIMIT") stall++;
  else if (r.winner === 0) red++;
  else if (r.winner === 1) blue++;
  else draw++;
}
const decisive = red + blue;
const pct = (x: number) => (x * 100).toFixed(1) + "%";
const [rl, rh] = wilson(red, decisive);
const [bl, bh] = wilson(blue, decisive);
const team = (side: string) => fx[side].map((e: any) => `${e.enName}${e.soulIds?.length ? ` [${enSoul(e.soulIds[0])}]` : ""}`).join(" / ");
const enIssue = (s: string) => s.replace(/^(\S+)/, m => enShiki(m)).replace("AI 置信度 LOW", "AI confidence LOW");
console.log(`Lineup: ${fx._meta?.title ?? args.file}`);
console.log(`Red : ${team("red")}`);
console.log(`Blue: ${team("blue")}`);
console.log(`Rules: effect resist SINGLE_ROLL_RATIO · endgame ${bettingEndgameId()}`);
console.log(`Battles: ${n} (${((Date.now() - started) / 1000).toFixed(1)}s) · decided: ${decisive} · stalled: ${stall} · draw: ${draw}`);
console.log(`Red  wins ${pct(red / Math.max(1, decisive))}  (95% CI ${pct(rl)} – ${pct(rh)})`);
console.log(`Blue wins ${pct(blue / Math.max(1, decisive))}  (95% CI ${pct(bl)} – ${pct(bh)})`);
console.log(`End reasons: ${[...reasons].map(([k, v]) => `${k.replace("TEAM0", "RED").replace("TEAM1", "BLUE")}=${v}`).join(", ")} · avg turns ${(turnsSum / n).toFixed(1)}`);
if (souls) {
  const active = souls.installed.filter((s: any) => s.kind !== "UNSUPPORTED").map((s: any) => enSoul(s.soulId));
  const inactive = souls.installed.filter((s: any) => s.kind === "UNSUPPORTED").map((s: any) => enSoul(s.soulId));
  console.log(`Souls simulated: ${active.join(", ") || "-"}${inactive.length ? ` · NOT simulated: ${inactive.join(", ")}` : ""}`);
}
if (issues.length) console.log(`Warnings (${issues.length}):\n  - ${issues.slice(0, 12).map(enIssue).join("\n  - ")}`);
