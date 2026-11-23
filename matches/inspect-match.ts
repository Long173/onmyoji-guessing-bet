// matches/inspect-match.ts — per-unit breakdown of one simulated battle (skills used, damage, healing).
// Usage: node matches/inspect-match.ts file=matches/2026-11-23-lineup.en.json seed=100000
import path from "node:path";
import { setSkillLevelMode } from "../battle-lab/compile/max-level.ts";
import { assembleGuessingMatch, loadMatchFixture } from "../battle-lab/soul/guessing-match.ts";
import { enShiki, normalizeLineup } from "./names.ts";

// Betting mode uses max skill levels.
setSkillLevelMode("MAX");

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split("=") as [string, string]));
const fx: any = normalizeLineup(await loadMatchFixture(path.resolve(args.file)));
const A: any = await assembleGuessingMatch(fx, { seed: Number(args.seed ?? 100000), traceLevel: "FULL" });
const result = await A.battle.run();
const trace: any[] = A.battle.trace;

const units = new Map<number, any>();
A.battle.teams.forEach((team: any, ti: number) => {
  for (const e of team.members) {
    units.set(e.id, {
      side: ti === 0 ? "Red" : "Blue", name: enShiki(e.name),
      ai: (e.notes.find((n: string) => n.startsWith("kb-skills")) ?? "").replace(/^.*ai=/, "ai="),
      dealt: 0, taken: 0, healed: 0, skills: new Map<string, number>(),
      alive: e.alive, hp: Math.round(e.hp), maxHp: Math.round(e.maxHp),
    });
  }
});
for (const t of trace) {
  if (t.t === "DAMAGE") {
    if (units.has(t.src)) units.get(t.src).dealt += t.applied ?? 0;
    if (units.has(t.dst)) units.get(t.dst).taken += t.applied ?? 0;
  }
  if (t.t === "HEAL" && units.has(t.src)) units.get(t.src).healed += t.amount ?? t.healed ?? t.value ?? 0;
  const actor = t.src ?? t.actor ?? t.id;
  if (t.t === "SKILL_CAST" && units.has(actor)) {
    const u = units.get(actor);
    const k = t.skill ?? t.name ?? "?";
    u.skills.set(k, (u.skills.get(k) ?? 0) + 1);
  }
}
const winner = result.winner === 0 ? "Red" : result.winner === 1 ? "Blue" : "-";
console.log(`seed=${args.seed ?? 100000} winner=${winner} reason=${result.reason} turns=${result.turns}`);
for (const u of units.values()) {
  const skills = [...u.skills].map(([k, v]) => `${k}×${v}`).join(", ") || "(no skill cast)";
  const end = u.alive ? `${u.hp}/${u.maxHp}` : "dead";
  console.log(`${u.side.padEnd(4)} ${u.name.padEnd(22)} ${u.ai.padEnd(8)} dealt=${String(Math.round(u.dealt)).padStart(6)} taken=${String(Math.round(u.taken)).padStart(6)} healed=${String(Math.round(u.healed)).padStart(5)} end=${end.padEnd(12)} | ${skills}`);
}
