// screenshot/cells.ts — turn grid cells into clean, binarised OCR inputs.
//   stat cells:  dark digits on a beige band  → black ink on white, upscaled, tightly cropped;
//   name cells:  white letters with a dark outline under the portrait → the white fill becomes the ink.
import type { RgbaImage, Rect } from "./image.ts";
import { crop, encodeBmpGray, lumAt, median, resize, rgbAt } from "./image.ts";
import type { Span, TableGrid } from "./locate.ts";

export interface OcrInput { bmp: Uint8Array; width: number; height: number; empty: boolean }

const TARGET_INK_H = 44;   // Tesseract is most accurate with ~30-50 px glyphs
const PAD = 14;

function bbox(mask: Uint8Array, w: number, h: number): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Drop connected components smaller than `minArea` (JPEG specks, separator remnants). */
function denoise(mask: Uint8Array, w: number, h: number, minArea: number): Uint8Array {
  const out = new Uint8Array(mask);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    const comp: number[] = [];
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const x = p % w, y = (p / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = ny * w + nx;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (comp.length < minArea) for (const p of comp) out[p] = 0;
  }
  return out;
}

function toInput(mask: Uint8Array, w: number, h: number): OcrInput {
  const bb = bbox(mask, w, h);
  if (!bb) return { bmp: encodeBmpGray(new Uint8Array(4).fill(255), 2, 2), width: 2, height: 2, empty: true };
  const ow = bb.w + PAD * 2, oh = bb.h + PAD * 2;
  const out = new Uint8Array(ow * oh).fill(255);
  for (let y = 0; y < bb.h; y++) for (let x = 0; x < bb.w; x++) {
    if (mask[(bb.y + y) * w + bb.x + x]) out[(y + PAD) * ow + x + PAD] = 0;
  }
  return { bmp: encodeBmpGray(out, ow, oh), width: ow, height: oh, empty: false };
}

/** Stat cell → binarised digits. */
export function statCellInput(img: RgbaImage, col: Span, row: Span, variant = 0): OcrInput {
  const inset = Math.max(2, Math.round((row.b - row.a) * 0.08));
  const r: Rect = { x: col.a + inset, y: row.a + inset, w: col.b - col.a - inset * 2, h: row.b - row.a - inset * 2 };
  const cell = crop(img, r);
  const bg = median(sampleLum(cell));
  // variants retry a doubtful cell with a different glyph size / ink threshold
  const scale = Math.min(5, Math.max(1, TARGET_INK_H / ((row.b - row.a) * 0.5))) * [1, 0.7, 1.3][variant % 3];
  const big = resize(cell, Math.round(cell.width * scale), Math.round(cell.height * scale));
  const { width: w, height: h } = big;
  let minL = 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) minL = Math.min(minL, lumAt(big, x, y));
  const thr = (minL < bg - 40 ? (bg + minL) / 2 : bg - 40) + [0, 12, -12][variant % 3];
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (lumAt(big, x, y) < thr) mask[y * w + x] = 1;
  return toInput(denoise(mask, w, h, Math.round(scale * scale * 3)), w, h);
}

function sampleLum(img: RgbaImage): number[] {
  const out: number[] = [];
  for (let y = 0; y < img.height; y += 2) for (let x = 0; x < img.width; x += 2) out.push(lumAt(img, x, y));
  return out;
}

/**
 * Name text region of a header cell: the rows below the portrait. The portrait is the block of
 * non-beige pixels in the upper part of the header; names may wrap onto two lines.
 */
export function nameRegion(img: RgbaImage, grid: TableGrid, col: Span): Rect {
  const h = grid.header;
  const hh = h.b - h.a;
  const cx0 = col.a + Math.round((col.b - col.a) * 0.3), cx1 = col.b - Math.round((col.b - col.a) * 0.3);
  // The portrait is a square icon centred in the column: find its top edge, then measure its width on a row
  // just below the top (names never reach that high) — the bottom edge is top + width.
  const isOdd = (x: number, y: number) => {
    const [r, g, b] = rgbAt(img, x, y);
    return Math.max(r, g, b) - Math.min(r, g, b) > 70 || r < 110 || Math.min(r, g, b) > 185;
  };
  let portraitBottom = h.a + Math.round(hh * 0.55);
  for (let y = h.a + 1; y < h.a + Math.round(hh * 0.5); y++) {
    let odd = 0;
    for (let x = cx0; x < cx1; x++) if (isOdd(x, y)) odd++;
    if (odd / (cx1 - cx0) < 0.5) continue;
    const yy = Math.min(h.b - 1, y + Math.max(3, Math.round(hh * 0.08)));
    const mid = (col.a + col.b) >> 1;
    let l = mid, r = mid;
    while (l > col.a + 2 && (isOdd(l - 1, yy) || isOdd(l - 2, yy))) l--;
    while (r < col.b - 2 && (isOdd(r + 1, yy) || isOdd(r + 2, yy))) r++;
    const side = r - l + 1;
    if (side > hh * 0.3 && side < hh * 0.85) portraitBottom = y + side;
    break;
  }
  return { x: col.a + 4, y: portraitBottom + 1, w: col.b - col.a - 8, h: h.b - portraitBottom - 2 };
}

/** Keep only the text lines of a name mask: drop specks, lines touching the top edge (portrait remnants), keep ≤ 2. */
function keepNameLines(mask: Uint8Array, w: number, h: number): Uint8Array {
  const rowInk = new Array<number>(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rowInk[y] += mask[y * w + x];
  const lines: Span[] = [];
  for (let y = 0; y < h;) {
    if (!rowInk[y]) { y++; continue; }
    let e = y;
    while (e < h && rowInk[e]) e++;
    lines.push({ a: y, b: e });
    y = e;
  }
  if (!lines.length) return mask;
  const maxH = Math.max(...lines.map(l => l.b - l.a));
  let keep = lines.filter(l => l.b - l.a >= maxH * 0.45);
  if (keep.length > 1 && keep[0].a <= 1) keep = keep.slice(1);
  keep = keep.slice(-2);
  const out = new Uint8Array(w * h);
  for (const l of keep) for (let y = l.a; y < l.b; y++) for (let x = 0; x < w; x++) out[y * w + x] = mask[y * w + x];
  return out;
}

/** Name cell → binarised white glyph fill (black ink on white). */
export function nameCellInput(img: RgbaImage, r: Rect, thrOffset = 0): OcrInput {
  const cell = crop(img, r);
  const scale = Math.min(5, Math.max(2, 120 / Math.max(10, cell.height)));
  const big = resize(cell, Math.round(cell.width * scale), Math.round(cell.height * scale));
  const { width: w, height: h } = big;
  // the glyph fill is near-white, the background is the header beige: threshold the min channel halfway
  const mins: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r0, g0, b0] = rgbAt(big, x, y); mins.push(Math.min(r0, g0, b0)); }
  const sorted = [...mins].sort((a, b) => a - b);
  const bg = sorted[Math.floor(sorted.length * 0.5)];
  const fill = sorted[Math.floor(sorted.length * 0.985)];
  const thr = (fill - bg > 20 ? (bg + fill) / 2 : 200) + thrOffset;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (mins[i] <= thr) continue;
    const [r0, g0, b0] = rgbAt(big, i % w, (i / w) | 0);
    if (Math.max(r0, g0, b0) - mins[i] < 60) mask[i] = 1;
  }
  return toInput(keepNameLines(denoise(mask, w, h, Math.round(scale * scale * 3)), w, h), w, h);
}
