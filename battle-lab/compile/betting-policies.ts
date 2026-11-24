// compile/betting-policies.ts — battle-wide policies that only the betting (MAX skill level) mode uses.
//
// Both assembly paths (soul/guessing-match.ts for Node, apps/web/src/engine/assemble.ts for the web
// worker) spread `bettingPolicies()` into the Battle policies. In BASE mode it returns {} so the
// regression suite's pinned fingerprints stay byte-identical.
//   · resist  = SINGLE_ROLL_RATIO: hit chance = base × (1 + effect hit) / (1 + effect RES), one roll.
//   · endgame = anti-stall referee rounds (default REFEREE_CLOCK_114: a speed-114 referee runner on the action bar,
//     +15% damage per pass, no healing cut); choose with env BETTING_ENDGAME (NONE | REFEREE_CLOCK_114 |
//     REFEREE_15_10 (previous default: every 8 actions, −10% healing) | REFEREE_20_10) or setBettingEndgame().
//   · hp scale = BETTING_HP_SCALE (HYPOTHESIS): real max HP = Lineup-screen HP × 2.42 (see below).
import { skillLevelMode } from "./max-level.ts";
import { EndgamePolicies, ResistPolicies } from "../kernel/policies.ts";
import type { BattlePolicies, EndgamePolicy } from "../kernel/policies.ts";

export const DEFAULT_BETTING_ENDGAME = "REFEREE_CLOCK_114";

let override: string | null = null;

/** Validates a preset id (throws with the valid ids, so a typo never silently runs another preset). */
export function endgamePreset(id: string): EndgamePolicy {
  const p = EndgamePolicies[id];
  if (!p) throw new Error(`Unknown betting endgame preset "${id}" (valid: ${Object.keys(EndgamePolicies).join(", ")})`);
  return p;
}

/** Selects the preset for later assemblies (null = back to env / default). */
export function setBettingEndgame(id: string | null): void {
  if (id !== null) endgamePreset(id);
  override = id;
}

/** Preset id in force: setBettingEndgame() > env BETTING_ENDGAME > DEFAULT_BETTING_ENDGAME. */
export function bettingEndgameId(): string {
  const env = (globalThis as any).process?.env?.BETTING_ENDGAME;
  return override ?? (env ? String(env).trim() : DEFAULT_BETTING_ENDGAME);
}

/** Policy overrides for the betting mode; {} in BASE mode. */
export function bettingPolicies(): Partial<BattlePolicies> {
  if (skillLevelMode() !== "MAX") return {};
  return { resist: ResistPolicies.SINGLE_ROLL_RATIO, endgame: endgamePreset(bettingEndgameId()) };
}

/**
 * Betting max-HP multiplier — HYPOTHESIS, measured from duel-betting replays (2026-11-23).
 *
 * In duel betting every unit's real max HP is ≈ 2.42 × the HP printed on the Lineup screen, while per-hit
 * damage matches the damage formula within ~1% (so ATK/DEF/crit are NOT scaled).
 *   · Match 6: Suzuhikohime's 13% max-HP cost (Five Mountains) showed 3847 ⇒ max HP 29,592; her 8% heal
 *     showed 2367 ⇒ 29,588. Lineup HP 12,229 ⇒ ratio 2.420. Kuro's and Okuribito's HP bars give a similar ratio.
 *   · Match 5 cross-check: Garuda's Cherish Feathers heals 10% of max HP and showed exactly 4855
 *     = 10% × 20,065 × 2.42 = 4855.7.
 * Alternative reading: a flat HP bonus (+N HP to everyone). Rejected because it cannot fit two units with very
 * different panel HP at once: Suzuhikohime (12,229 → +17,363) and Garuda (20,065 → +28,485) need different
 * flat bonuses, while one multiplier fits both to < 0.1%.
 * Applied where guessing stats become entity stats (soul/guessing-factory.ts), so both assembly paths
 * (Node and web worker) get it; BASE mode returns 1 (pinned fingerprints unchanged). The panel echo check
 * (verifyGuessingPanel) still compares the UNSCALED input with the screenshot.
 */
export const BETTING_HP_SCALE = 2.42;

export const BETTING_HP_SCALE_RULE = {
  id: "BETTING_HP_SCALE_2_42",
  status: "HYPOTHESIS" as const,
  value: BETTING_HP_SCALE,
  question: "Is a unit's real max HP in duel betting the Lineup-screen HP × 2.42?",
  evidence: "Replays 2026-11-23: Suzuhikohime 13% HP cost 3847 and 8% heal 2367 ⇒ max HP ≈ 29,590 vs Lineup 12,229 (×2.420); "
    + "Kuro / Okuribito HP bars similar; Garuda's 10% max-HP heal = 4855 = 10% × 20,065 × 2.42. "
    + "A flat HP bonus cannot fit both units; damage per hit matches the formula (~1%), so only HP is scaled.",
};

/** Max-HP multiplier in force: BETTING_HP_SCALE in betting (MAX) mode, 1 in BASE. */
export function bettingHpScale(): number {
  return skillLevelMode() === "MAX" ? BETTING_HP_SCALE : 1;
}
