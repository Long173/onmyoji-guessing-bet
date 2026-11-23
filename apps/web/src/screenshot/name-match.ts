// screenshot/name-match.ts — fuzzy-match OCR'd name lines against the English (Global) shikigami names.
//
// OCR on the outlined in-game font confuses a handful of letter pairs (r/n, c/s, h/t …), so the edit
// distance charges those substitutions half price. Several OCR variants of the same cell vote together;
// base Speed is a tie-breaker (a unit's panel Speed can never be below its base Speed).

export interface NameCandidate { id: number; en: string; cn: string }
export interface NameScore extends NameCandidate { score: number }
export interface NameMatch { best: NameScore | null; ranked: NameScore[]; confident: boolean }

/** Short names the Lineup screen uses that differ from the KB's English name. */
export const SCREEN_ALIASES: Record<number, string[]> = {
  310: ["Maki&Karashi", "Maki & Karashi"],
};

const CONFUSABLE = new Set([
  "cs", "ce", "co", "rn", "ht", "hk", "hn", "il", "ij", "it", "lt", "uv", "ao", "ae", "gq", "mn", "eo", "rt", "ri",
  "ft", "bh", "ou", "un", "ad", "gy", "fr",
].flatMap(p => [p, p[1] + p[0]]));

export function normName(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const sub = a[i - 1] === b[j - 1] ? 0 : CONFUSABLE.has(a[i - 1] + b[j - 1]) ? 0.5 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/** 1 = identical, 0 = nothing in common. */
export function similarity(ocr: string, name: string): number {
  const a = normName(ocr), b = normName(name);
  if (!a || !b) return 0;
  const full = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  // the screen sometimes shows a shorter form ("Maki&Karashi" for "Peach Maki & Karashi")
  let partial = 0;
  if (a.length >= 5 && b.length > a.length) {
    for (let s = 0; s + a.length <= b.length; s++) {
      partial = Math.max(partial, 1 - editDistance(a, b.slice(s, s + a.length)) / a.length);
    }
    partial *= 0.88;
  }
  return Math.max(full, partial);
}

export interface MatchOptions {
  /** observed panel Speed of this unit (tie-breaker) */
  speed?: number | null;
  baseSpeed?: (id: number) => number | null | undefined;
}

export function matchName(ocrTexts: string[], candidates: NameCandidate[], opt: MatchOptions = {}): NameMatch {
  const texts = ocrTexts.map(t => t.trim()).filter(t => normName(t).length >= 2);
  if (!texts.length) return { best: null, ranked: [], confident: false };
  const scored: NameScore[] = candidates.map(c => {
    const names = [c.en, ...(SCREEN_ALIASES[c.id] ?? [])];
    // best variant counts fully, the others add a small agreement bonus
    const perText = texts.map(t => Math.max(...names.map(n => similarity(t, n)))).sort((x, y) => y - x);
    let score = perText[0] + 0.03 * perText.slice(1).reduce((s, v) => s + v, 0) / Math.max(1, perText.length - 1);
    const base = opt.baseSpeed?.(c.id);
    if (opt.speed != null && base != null && base > opt.speed + 0.5) score -= 0.15;
    return { ...c, score };
  });
  scored.sort((x, y) => y.score - x.score);
  const ranked = scored.slice(0, 8);
  const best = ranked[0] ?? null;
  const second = ranked[1]?.score ?? 0;
  const confident = !!best && best.score >= 0.72 && best.score - second >= 0.08;
  return { best, ranked, confident };
}
