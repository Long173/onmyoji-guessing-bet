// screenshot/souls.ts — recognise the round 4-piece soul icon of each column.
//
// Each icon is cut out as a square around its circle and shrunk to THUMB×THUMB RGB. References are the
// same thumbnails, cropped from labelled screenshots (tools/add-soul-refs.ts) and stored base64 in
// soul-refs.json, so the comparison can be re-tuned without re-cropping. The distance mixes
//   • 1 − normalised cross-correlation of a 16×16 greyscale version (shape), and
//   • 1 − Bhattacharyya coefficient of a 4×4×4 RGB histogram (palette),
// both inside a circular mask that drops the golden ring and the beige corners.
import type { Rect, RgbaImage } from "./image.ts";
import { crop, lumAt, median, resize, rgbAt } from "./image.ts";
import type { Span } from "./locate.ts";

export const THUMB = 24;
const GRAY = 16;
const MASK_R = 0.8;        // fraction of the radius kept (the outer ring is the same on every icon)
const WIKI_PENALTY = 0.06; // fandom-wiki art is drawn differently; prefer in-game crops

export interface SoulRef { soulId: number; en: string; source: "screen" | "wiki"; from: string; rgb: string }
export interface SoulRefFile { version: 1; thumb: number; refs: SoulRef[] }

export interface SoulFeature { gray: Float64Array; hist: Float64Array }
export interface SoulCandidate { soulId: number; en: string; distance: number; from: string }
export interface SoulMatch { soulId: number | null; ranked: SoulCandidate[]; confident: boolean; icon: Rect | null }

/** Find the round icon inside the soul cell: bounding box of pixels that clearly differ from the band colour. */
export function findSoulIcon(img: RgbaImage, col: Span, row: Span): Rect | null {
  const x0 = col.a + 2, x1 = col.b - 2, y0 = row.a + 1, y1 = row.b - 1;
  const bgL = median(Array.from({ length: Math.max(1, x1 - x0) }, (_, i) => lumAt(img, x0 + i, y0 + 2)));
  const [br, bgG, bb] = rgbAt(img, x0 + 2, y0 + 2);
  const differs = (x: number, y: number) => {
    const [r, g, b] = rgbAt(img, x, y);
    return Math.abs(r - br) + Math.abs(g - bgG) + Math.abs(b - bb) > 70 || Math.abs(lumAt(img, x, y) - bgL) > 30;
  };
  const colHits = new Array<number>(x1 - x0).fill(0);
  const rowHits = new Array<number>(y1 - y0).fill(0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (differs(x, y)) { colHits[x - x0]++; rowHits[y - y0]++; }
  const minRun = (row.b - row.a) * 0.15;
  const xs = colHits.map((c, i) => (c >= minRun ? i : -1)).filter(i => i >= 0);
  const ys = rowHits.map((c, i) => (c >= minRun ? i : -1)).filter(i => i >= 0);
  if (xs.length < 5 || ys.length < 5) return null;
  // keep the run closest to the column centre (ignores stray bits near the borders)
  const mid = (x1 - x0) / 2;
  const groups: number[][] = [];
  for (const x of xs) { const g = groups[groups.length - 1]; if (g && x - g[g.length - 1] <= 3) g.push(x); else groups.push([x]); }
  const g = groups.sort((p, q) => Math.abs((p[0] + p[p.length - 1]) / 2 - mid) - Math.abs((q[0] + q[q.length - 1]) / 2 - mid))[0];
  const w = g[g.length - 1] - g[0] + 1, h = ys[ys.length - 1] - ys[0] + 1;
  const d = Math.max(w, h);
  if (d < (row.b - row.a) * 0.4) return null;
  const cx = x0 + (g[0] + g[g.length - 1]) / 2, cy = y0 + (ys[0] + ys[ys.length - 1]) / 2;
  return { x: Math.round(cx - d / 2), y: Math.round(cy - d / 2), w: d, h: d };
}

export function iconThumb(img: RgbaImage, icon: Rect): RgbaImage {
  return resize(crop(img, icon), THUMB, THUMB);
}

export function thumbToBase64(t: RgbaImage): string {
  let s = "";
  for (let i = 0; i < t.width * t.height; i++) s += String.fromCharCode(t.data[i * 4], t.data[i * 4 + 1], t.data[i * 4 + 2]);
  return btoa(s);
}

export function thumbFromBase64(b64: string, size = THUMB): RgbaImage {
  const s = atob(b64);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = s.charCodeAt(i * 3); data[i * 4 + 1] = s.charCodeAt(i * 3 + 1); data[i * 4 + 2] = s.charCodeAt(i * 3 + 2); data[i * 4 + 3] = 255;
  }
  return { width: size, height: size, data };
}

function inMask(x: number, y: number, n: number): boolean {
  const c = (n - 1) / 2, r = (n / 2) * MASK_R;
  return (x - c) ** 2 + (y - c) ** 2 <= r * r;
}

export function soulFeature(thumb: RgbaImage): SoulFeature {
  const g = resize(thumb, GRAY, GRAY);
  const vals: number[] = [];
  for (let y = 0; y < GRAY; y++) for (let x = 0; x < GRAY; x++) if (inMask(x, y, GRAY)) vals.push(lumAt(g, x, y));
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length) || 1;
  const gray = Float64Array.from(vals, v => (v - mean) / sd);
  const hist = new Float64Array(64);
  let n = 0;
  for (let y = 0; y < thumb.height; y++) for (let x = 0; x < thumb.width; x++) {
    if (!inMask(x, y, thumb.width)) continue;
    const [r, gg, b] = rgbAt(thumb, x, y);
    hist[(r >> 6) * 16 + (gg >> 6) * 4 + (b >> 6)]++; n++;
  }
  for (let i = 0; i < 64; i++) hist[i] /= n || 1;
  return { gray, hist };
}

export function soulDistance(a: SoulFeature, b: SoulFeature): number {
  let corr = 0;
  for (let i = 0; i < a.gray.length; i++) corr += a.gray[i] * b.gray[i];
  corr /= a.gray.length;
  let bc = 0;
  for (let i = 0; i < 64; i++) bc += Math.sqrt(a.hist[i] * b.hist[i]);
  return 0.55 * (1 - corr) / 2 + 0.45 * (1 - bc);
}

export interface SoulIndex { entries: Array<{ ref: SoulRef; feature: SoulFeature }> }

export function buildSoulIndex(file: SoulRefFile): SoulIndex {
  return { entries: file.refs.map(ref => ({ ref, feature: soulFeature(thumbFromBase64(ref.rgb, file.thumb)) })) };
}

export const SOUL_ACCEPT = 0.24;  // max distance for an automatic match
export const SOUL_MARGIN = 0.06;  // required gap to the best *different* soul

export function matchSoul(index: SoulIndex, thumb: RgbaImage, exclude?: (ref: SoulRef) => boolean): Omit<SoulMatch, "icon"> {
  const f = soulFeature(thumb);
  const bestBySoul = new Map<number, SoulCandidate>();
  for (const { ref, feature } of index.entries) {
    if (exclude?.(ref)) continue;
    const d = soulDistance(f, feature) + (ref.source === "wiki" ? WIKI_PENALTY : 0);
    const cur = bestBySoul.get(ref.soulId);
    if (!cur || d < cur.distance) bestBySoul.set(ref.soulId, { soulId: ref.soulId, en: ref.en, distance: d, from: ref.from });
  }
  const ranked = [...bestBySoul.values()].sort((a, b) => a.distance - b.distance).slice(0, 6);
  const best = ranked[0];
  const confident = !!best && best.distance <= SOUL_ACCEPT && (ranked[1]?.distance ?? 1) - best.distance >= SOUL_MARGIN;
  return { soulId: confident ? best.soulId : null, ranked, confident };
}
