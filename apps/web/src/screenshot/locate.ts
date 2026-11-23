// screenshot/locate.ts — find the Lineup table(s) in a screenshot and derive the cell grid.
//
// The Global Lineup screen draws a beige table: a darker header band (portraits + names), then eight stat
// bands whose background alternates light / dark, then the "Soul effects" row. Columns are separated by a
// thin dark vertical line. We use exactly those three cues:
//   1. rows whose pixels are mostly beige → vertical runs = candidate tables (a picture may stack two windows);
//   2. per-row median luminance inside the table → header band + 8 alternating stat bands + soul row;
//   3. per-column share of "much darker than the band" pixels across the stat bands → the separator lines.
// Proportional fallbacks kick in when a cue is missing (cropped borders, JPEG noise), and are reported.
import type { Rect, RgbaImage } from "./image.ts";
import { lumAt, median, rgbAt } from "./image.ts";

export type Side = "red" | "blue";
export interface Span { a: number; b: number }   // half-open [a, b)

export interface TableGrid {
  bbox: Rect;
  side: Side | null;
  /** red / blue pixel counts in the fan badge (diagnostics + confidence) */
  sideVotes: { red: number; blue: number };
  header: Span;
  statRows: Span[];      // 8 rows: ATK, HP, DEF, Speed, Crit, Crit DMG, Effect HIT, Effect RES
  soulRow: Span;
  labelCol: Span;
  cols: Span[];          // 5 unit columns, left → right
  rowHeight: number;
  warnings: string[];
}

const STAT_ROWS = 8;
const UNITS = 5;

function isBeige(r: number, g: number, b: number): boolean {
  return r >= 130 && r <= 240 && r > g && g > b && r - b >= 20 && r - b <= 75 && g - b >= 6;
}

/** Runs of indices where pred holds, bridging gaps up to `gap`. */
function runs(n: number, pred: (i: number) => boolean, gap: number): Span[] {
  const out: Span[] = [];
  let start = -1, lastTrue = -1;
  for (let i = 0; i < n; i++) {
    if (pred(i)) {
      if (start < 0) start = i;
      else if (i - lastTrue > gap + 1) { out.push({ a: start, b: lastTrue + 1 }); start = i; }
      lastTrue = i;
    }
  }
  if (start >= 0) out.push({ a: start, b: lastTrue + 1 });
  return out;
}

function findTableBoxes(img: RgbaImage): Rect[] {
  const { width: W, height: H } = img;
  const step = W > 1400 ? 2 : 1;
  const rowCount = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = 0; x < W; x += step) { const [r, g, b] = rgbAt(img, x, y); if (isBeige(r, g, b)) c++; }
    rowCount[y] = (c * step) / W;
  }
  const minH = Math.max(120, H * 0.12);
  const vRuns = runs(H, y => rowCount[y] >= 0.3, 4).filter(s => s.b - s.a >= minH);
  const boxes: Rect[] = [];
  for (const vr of vRuns) {
    const colFrac = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      let c = 0, n = 0;
      for (let y = vr.a; y < vr.b; y += 2) { const [r, g, b] = rgbAt(img, x, y); if (isBeige(r, g, b)) c++; n++; }
      colFrac[x] = c / n;
    }
    const hr = runs(W, x => colFrac[x] >= 0.45, 6).sort((p, q) => (q.b - q.a) - (p.b - p.a))[0];
    if (!hr || hr.b - hr.a < W * 0.3) continue;
    boxes.push({ x: hr.a, y: vr.a, w: hr.b - hr.a, h: vr.b - vr.a });
  }
  return boxes;
}

/** Median luminance of each row inside the box (text is a minority, so the median is the band colour). */
function rowLevels(img: RgbaImage, box: Rect, x0: number, x1: number): number[] {
  const out: number[] = [];
  for (let y = box.y; y < box.y + box.h; y++) {
    const xs: number[] = [];
    for (let x = x0; x < x1; x += 2) xs.push(lumAt(img, x, y));
    out.push(median(xs));
  }
  return out;
}

interface Bands { header: Span; stat: Span[]; soul: Span; rowH: number; warnings: string[] }

function findBands(levels: number[], boxY: number): Bands | null {
  const warnings: string[] = [];
  const sorted = [...levels].sort((a, b) => a - b);
  const light = sorted[Math.floor(sorted.length * 0.85)];
  const cls = levels.map(L => {
    if (L >= light - 5.5 && L <= light + 6) return "A";
    if (L >= light - 20 && L < light - 5.5) return "B";
    if (L >= light - 90 && L < light - 25) return "H";
    return "?";
  });
  // header = longest run of H in the top half of the table
  const n = levels.length;
  const hRuns = runs(Math.floor(n * 0.5), i => cls[i] === "H", 2).sort((p, q) => (q.b - q.a) - (p.b - p.a));
  const header = hRuns[0];
  if (!header || header.b - header.a < n * 0.08) return null;
  // stat bands: maximal runs of A / B after the header
  const bands: Array<Span & { c: string }> = [];
  for (let i = header.b; i < n;) {
    let j = i;
    while (j < n && cls[j] === cls[i]) j++;
    if (cls[i] === "A" || cls[i] === "B") bands.push({ a: i, b: j, c: cls[i] });
    i = j;
  }
  const big = bands.filter(s => s.b - s.a >= 4);
  // merge consecutive same-class fragments
  const merged: Array<Span & { c: string }> = [];
  for (const s of big) {
    const last = merged[merged.length - 1];
    if (last && last.c === s.c && s.a - last.b <= 4) last.b = s.b; else merged.push({ ...s });
  }
  if (merged.length < STAT_ROWS) return null;
  const stat = merged.slice(0, STAT_ROWS);
  const hs = stat.map(s => s.b - s.a);
  const rowH = median(hs);
  if (hs.some(h => Math.abs(h - rowH) > rowH * 0.25)) warnings.push("uneven stat rows");
  // make rows contiguous: split the boundary between neighbours
  const statSpans: Span[] = stat.map((s, k) => ({
    a: k === 0 ? s.a : Math.round((stat[k - 1].b + s.a) / 2),
    b: k === STAT_ROWS - 1 ? s.b : Math.round((s.b + stat[k + 1].a) / 2),
  }));
  const soulA = statSpans[STAT_ROWS - 1].b;
  const soulB = Math.min(n, soulA + Math.round(rowH * 1.6));
  return {
    header: { a: header.a + boxY, b: header.b + boxY },
    stat: statSpans.map(s => ({ a: s.a + boxY, b: s.b + boxY })),
    soul: { a: soulA + boxY, b: soulB + boxY },
    rowH, warnings,
  };
}

/** Column separators: x where almost every stat-band row is far darker than its band. */
function findSeparators(img: RgbaImage, box: Rect, rows: Span[], darkBy: number): number[] {
  const ys: number[] = [];
  for (const r of rows) for (let y = r.a + 2; y < r.b - 2; y++) ys.push(y);
  const bandLevel = new Map<number, number>();
  for (const y of ys) {
    const xs: number[] = [];
    for (let x = box.x; x < box.x + box.w; x += 3) xs.push(lumAt(img, x, y));
    bandLevel.set(y, median(xs));
  }
  const frac: number[] = [];
  for (let x = box.x; x < box.x + box.w; x++) {
    let dark = 0;
    for (const y of ys) if (lumAt(img, x, y) < (bandLevel.get(y) ?? 0) - darkBy) dark++;
    frac.push(dark / ys.length);
  }
  const peaks = runs(frac.length, i => frac[i] >= 0.8, 1).map(s => box.x + (s.a + s.b - 1) / 2);
  // ignore the outer border region
  return peaks.filter(p => p > box.x + box.w * 0.04 && p < box.x + box.w * 0.985);
}

function pickSeparators(peaks: number[], box: Rect): { seps: number[]; colW: number } | null {
  // choose 5 peaks with near-equal spacing (label | c1 | c2 | c3 | c4 | c5)
  if (peaks.length < UNITS) return null;
  let best: { seps: number[]; colW: number; err: number } | null = null;
  for (let s = 0; s + UNITS <= peaks.length; s++) {
    for (let e = s + UNITS - 1; e < peaks.length; e++) {
      const colW = (peaks[e] - peaks[s]) / (UNITS - 1);
      if (colW < box.w * 0.1) continue;
      const seps: number[] = [];
      let err = 0, ok = true;
      for (let k = 0; k < UNITS; k++) {
        const want = peaks[s] + k * colW;
        const near = peaks.reduce((p, q) => Math.abs(q - want) < Math.abs(p - want) ? q : p);
        if (Math.abs(near - want) > colW * 0.06) { ok = false; break; }
        seps.push(near); err += Math.abs(near - want);
      }
      if (!ok) continue;
      if (peaks[s] + (UNITS) * colW > box.x + box.w + colW * 0.15) continue;   // fifth column must fit
      if (!best || colW > best.colW || (colW === best.colW && err < best.err)) best = { seps, colW, err };
    }
  }
  return best ? { seps: best.seps, colW: best.colW } : null;
}

function detectSide(img: RgbaImage, x: Span, y: Span): { side: Side | null; votes: { red: number; blue: number } } {
  let red = 0, blue = 0;
  for (let yy = y.a; yy < y.b; yy++) {
    for (let xx = x.a; xx < x.b; xx++) {
      const [r, g, b] = rgbAt(img, xx, yy);
      if (r > 140 && r - g > 70 && r - b > 60) red++;
      else if (b > 140 && b - r > 50 && b - g > 10) blue++;
    }
  }
  const total = red + blue;
  const side: Side | null = total < 30 ? null : red > blue * 1.5 ? "red" : blue > red * 1.5 ? "blue" : null;
  return { side, votes: { red, blue } };
}

export function locateTables(img: RgbaImage): TableGrid[] {
  const out: TableGrid[] = [];
  for (const box of findTableBoxes(img)) {
    const levels = rowLevels(img, box, box.x + Math.round(box.w * 0.15), box.x + box.w);
    const bands = findBands(levels, box.y);
    if (!bands) continue;
    const warnings = [...bands.warnings];
    // the 1-px separator fades when the screenshot is downscaled, so retry with a softer contrast threshold
    let picked: { seps: number[]; colW: number } | null = null;
    for (const darkBy of [35, 18, 10]) {
      picked = pickSeparators(findSeparators(img, box, bands.stat, darkBy), box);
      if (picked) break;
    }
    if (!picked) {
      // proportional fallback measured on the 1121×632 client: label column ≈ 13.1 % of the table, units equal
      const colW = box.w * 0.1727;
      const first = box.x + box.w * 0.1305;
      picked = { seps: Array.from({ length: UNITS }, (_, k) => first + k * colW), colW };
      warnings.push("column separators not found — using proportional layout");
    }
    const { seps, colW } = picked;
    const cols: Span[] = seps.map(s => ({ a: Math.round(s + 1), b: Math.round(Math.min(s + colW, box.x + box.w)) }));
    const labelCol: Span = { a: box.x, b: Math.round(seps[0]) };
    const { side, votes } = detectSide(img, labelCol, bands.header);
    if (!side) warnings.push("team colour (fan badge) not recognised");
    out.push({
      bbox: box, side, sideVotes: votes, header: bands.header, statRows: bands.stat, soulRow: bands.soul,
      labelCol, cols, rowHeight: bands.rowH, warnings,
    });
  }
  return out;
}
