// screenshot/kb-bridge.ts — KB lookups the importer needs, kept free of JSON imports so Node tests can load it.
import { SHIKIGAMI_EN, SOUL_EN } from "../kb/en-names.gen.ts";
import type { NameCandidate } from "./name-match.ts";
import type { GuessingStats, GuessingUnitInput } from "../contracts/guessing-match.ts";
import { newUnitId } from "../contracts/guessing-match.ts";

/** English-name candidates; `allowed` limits them to ids the engine KB knows (shikigami-index). */
export function nameCandidates(allowed?: Set<number>): NameCandidate[] {
  const out: NameCandidate[] = [];
  for (const [id, [en, cn]] of Object.entries(SHIKIGAMI_EN)) {
    const n = Number(id);
    if (allowed && !allowed.has(n)) continue;
    out.push({ id: n, en, cn });
  }
  return out;
}

export function soulOptions(): Array<{ id: number; en: string }> {
  return Object.entries(SOUL_EN).map(([id, [en]]) => ({ id: Number(id), en })).sort((a, b) => a.en.localeCompare(b.en));
}

export function shikigamiCn(id: number): string {
  return SHIKIGAMI_EN[String(id)]?.[1] ?? "";
}

export function shikigamiEnName(id: number): string {
  return SHIKIGAMI_EN[String(id)]?.[0] ?? "";
}

/** Reviewed row of the import table → GuessingUnitInput (percent stats stay percentages: 70 = 70 %). */
export interface ReviewedUnit { shikigamiId: number | null; stats: GuessingStats; soulId: number | null }

export function toGuessingUnit(u: ReviewedUnit): GuessingUnitInput {
  const id = u.shikigamiId ?? 0;
  return { unitId: newUnitId(), shikigamiId: id, name: id ? shikigamiCn(id) : "", stats: { ...u.stats }, soulId: u.soulId };
}
