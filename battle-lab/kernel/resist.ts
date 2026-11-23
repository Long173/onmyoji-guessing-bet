// kernel/resist.ts — one probability / effect-resist contest for every status producer
// (skill statuses, control placeholders, soul statuses). Red zone H, see kernel/policies.ts ResistPolicies.
//
// Policy NONE (engine default): exactly the historical behaviour — roll the written chance once under
// `probTag`, never roll when the text gives no chance, never resist.
//
// SINGLE_ROLL_RATIO (betting MAX mode): one roll u against
//     p = base × (1 + effect hit) / (1 + effect RES)        (stats are fractions: 0.84 = 84%)
// for an enemy debuff, even when the text gives no chance (base = 1). A failed roll is a RESIST when
// u < base × (1 + effect hit) (it would have landed without the target's RES), otherwise a MISS.
//
// COMMUNITY_TWO_ROLL: the omj_simulator shape (roll base × (1+hit), then a resist roll at the same ratio).

import { EV } from "./types.ts";

export type ContestOutcome = "LAND" | "MISS" | "RESIST";

export interface StatusContest {
  outcome: ContestOutcome;
  /** an enemy debuff under a resist policy other than NONE */
  contested: boolean;
  /** SINGLE_ROLL_RATIO applied to this roll */
  single: boolean;
  /** the chance that was rolled when RES took part (null otherwise) */
  effective: number | null;
  efh: number;
  efr: number;
}

/** Effect hit / RES as fractions (prop values are 0.84 for 84%). */
function frac(e: any, prop: "efh" | "efr"): number {
  const v = Number(e?.prop?.(prop) ?? 0);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Roll whether `def` from `self` lands on `victim`.
 * @param baseP written chance in 0..1, or null when the text gives none (= 1, rolled only when contested)
 */
export function rollStatusContest(battle: any, self: any, victim: any, def: any, baseP: number | null,
  probTag: string, resistTag: string): StatusContest {
  const formula = String(battle?.policies?.resist?.formula ?? "NONE");
  const isDebuff = String(def?.category ?? "").startsWith("DEBUFF");
  const contested = isDebuff && self?.id !== victim?.id && formula !== "NONE";
  const efh = contested ? frac(self, "efh") : 0;
  const efr = contested ? frac(victim, "efr") : 0;
  const result = (outcome: ContestOutcome, single: boolean, effective: number | null): StatusContest =>
    ({ outcome, contested, single, effective, efh, efr });
  if (baseP === null && !contested) return result("LAND", false, null);
  const base = baseP ?? 1;
  const single = formula === "SINGLE_ROLL_RATIO" && contested;
  const p1 = single ? base * (1 + efh) / (1 + efr) : base;
  battle.rng.expect(probTag);
  if (!battle.rng.testHit(p1)) {
    const u = Number(battle.rng.lastDraw?.v ?? 1);
    if (single && u < base * (1 + efh)) return result("RESIST", true, p1);
    return result("MISS", single, single ? p1 : null);
  }
  if (formula === "COMMUNITY_TWO_ROLL" && contested) {
    const p2 = base * (1 + efh) / (1 + efr);
    battle.rng.expect(resistTag);
    if (battle.rng.testHit(p2)) return result("RESIST", false, p2);
  }
  return result("LAND", single, single ? p1 : null);
}

/** Leaves the STATUS_RESIST trace and dispatches EV.RESIST (Yamabiko and passives listen to it). */
export async function reportResist(battle: any, self: any, victim: any, def: any, c: StatusContest,
  extra: { probability: number | null; duration: number; [k: string]: any }): Promise<void> {
  const { duration, ...rest } = extra;
  battle.trace.push({
    t: "STATUS_RESIST", src: self.id, dst: victim.id, status: def.id, name: def.name,
    effective: c.effective, efh: c.efh, efr: c.efr, ...rest,
  });
  await battle.bus.dispatch(EV.RESIST,
    { target: victim, source: self, status: def, probability: extra.probability, effective: c.effective, duration },
    victim.id, victim.teamId, (id: number) => battle.teamOf(id));
}
