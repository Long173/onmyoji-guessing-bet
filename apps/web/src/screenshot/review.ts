// screenshot/review.ts — editable review model between the parser and the store.
// ParsedTable (what OCR saw) → ReviewTable (what the user corrects) → GuessingUnitInput[] (what the store keeps).
import type { GuessingStats, GuessingUnitInput } from "../contracts/guessing-match.ts";
import type { ParsedTable, RowKey } from "./parse.ts";
import { ROW_KEYS } from "./parse.ts";
import type { Side } from "./locate.ts";
import type { NameScore } from "./name-match.ts";
import type { SoulCandidate } from "./souls.ts";
import { toGuessingUnit } from "./kb-bridge.ts";

export interface ReviewUnit {
  shikigamiId: number | null;
  nameRaw: string[];
  nameCandidates: NameScore[];
  nameDoubtful: boolean;
  stats: Record<RowKey, number | null>;
  statFlags: Record<RowKey, { doubtful: boolean; note: string; raw: string }>;
  soulId: number | null;
  soulCandidates: SoulCandidate[];
  soulDoubtful: boolean;
}

export interface ReviewTable {
  key: string;
  source: string;
  side: Side | null;
  parsed: ParsedTable;
  units: ReviewUnit[];
}

export function toReview(parsed: ParsedTable, source: string, key: string): ReviewTable {
  const units = parsed.units.map<ReviewUnit>(u => {
    const stats = {} as Record<RowKey, number | null>;
    const statFlags = {} as ReviewUnit["statFlags"];
    for (const k of ROW_KEYS) {
      stats[k] = u.stats[k].value;
      statFlags[k] = { doubtful: u.stats[k].doubtful, note: u.stats[k].note ?? "", raw: u.stats[k].raw };
    }
    return {
      shikigamiId: u.name.id, nameRaw: u.name.raw, nameCandidates: u.name.candidates, nameDoubtful: u.name.doubtful,
      stats, statFlags,
      soulId: u.soul.soulId, soulCandidates: u.soul.candidates, soulDoubtful: u.soul.doubtful,
    };
  });
  return { key, source, side: parsed.side, parsed, units };
}

/** Problems that block applying (empty names / stats). Souls may stay unknown (soulId null). */
export function blockingIssues(t: ReviewTable): string[] {
  const out: string[] = [];
  if (!t.side) out.push("choose the team colour");
  t.units.forEach((u, i) => {
    if (!u.shikigamiId) out.push(`unit ${i + 1}: pick the shikigami`);
    const empty = ROW_KEYS.filter(k => u.stats[k] == null || !Number.isFinite(u.stats[k] as number));
    if (empty.length) out.push(`unit ${i + 1}: fill ${empty.join(", ")}`);
  });
  return out;
}

export function countFlags(t: ReviewTable): number {
  return t.units.reduce((n, u) => n + (u.nameDoubtful ? 1 : 0) + (u.soulDoubtful ? 1 : 0)
    + ROW_KEYS.filter(k => u.statFlags[k].doubtful).length, 0);
}

export function toGuessingUnits(t: ReviewTable): GuessingUnitInput[] {
  return t.units.map(u => {
    const stats = {} as GuessingStats;
    for (const k of ROW_KEYS) stats[k] = Number(u.stats[k] ?? 0);
    return toGuessingUnit({ shikigamiId: u.shikigamiId, stats, soulId: u.soulId });
  });
}
