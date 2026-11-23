// screenshot/parse.ts — Lineup screenshot → one ParsedTable per detected table (a picture may hold two).
// Pure orchestration over locate / cells / OCR / name-match / souls; no DOM, so Node tests run it as-is.
import type { RgbaImage, Rect } from "./image.ts";
import { crop, resize } from "./image.ts";
import { locateTables } from "./locate.ts";
import type { Side, TableGrid } from "./locate.ts";
import { nameCellInput, nameRegion, statCellInput } from "./cells.ts";
import type { OcrEngine } from "./ocr-engine.ts";
import { matchName } from "./name-match.ts";
import type { NameCandidate, NameScore } from "./name-match.ts";
import { findSoulIcon, iconThumb, matchSoul } from "./souls.ts";
import type { SoulCandidate, SoulIndex, SoulRef } from "./souls.ts";

/** Same order as the table rows and as contracts/guessing-match STAT_KEYS. */
export const ROW_KEYS = ["attack", "hp", "defense", "speed", "critRate", "critDamage", "effectHit", "effectResist"] as const;
export type RowKey = (typeof ROW_KEYS)[number];

interface StatRule { min: number; max: number; percent: boolean }
/** Plausible ranges for a 6★ unit's final panel. Values outside are kept but flagged. */
export const STAT_RULES: Record<RowKey, StatRule> = {
  attack: { min: 500, max: 15000, percent: false },
  hp: { min: 2000, max: 80000, percent: false },
  defense: { min: 100, max: 3000, percent: false },
  speed: { min: 100, max: 400, percent: false },
  critRate: { min: 0, max: 100, percent: true },
  critDamage: { min: 150, max: 400, percent: true },
  effectHit: { min: 0, max: 300, percent: true },
  effectResist: { min: 0, max: 300, percent: true },
};

export interface ParsedStat { value: number | null; raw: string; confidence: number; doubtful: boolean; note?: string }
export interface ParsedName { raw: string[]; id: number | null; en: string; cn: string; candidates: NameScore[]; doubtful: boolean }
export interface ParsedSoul { soulId: number | null; en: string; candidates: SoulCandidate[]; doubtful: boolean; icon: Rect | null }
export interface ParsedUnit { name: ParsedName; stats: Record<RowKey, ParsedStat>; soul: ParsedSoul }
export interface ParsedTable {
  side: Side | null;
  /** grid in the coordinates of `image` (the source picture, or an upscaled cut-out of it when it was small) */
  grid: TableGrid;
  image: RgbaImage;
  scale: number;
  offset: { x: number; y: number };
  units: ParsedUnit[];
  warnings: string[];
}

export interface ParseDeps {
  ocr: OcrEngine;
  candidates: NameCandidate[];
  baseSpeed?: (id: number) => number | null | undefined;
  souls: SoulIndex;
  /** tests: leave-one-out evaluation of the soul references */
  excludeSoulRef?: (ref: SoulRef) => boolean;
  onProgress?: (done: number, total: number) => void;
}

/** Parse OCR text of one stat cell. */
export function parseStatText(text: string, key: RowKey): { value: number | null; note?: string } {
  const rule = STAT_RULES[key];
  const t = text.replace(/\s+/g, "");
  const m = /^(\d+)(%?)$/.exec(t);
  if (!m) return { value: null, note: t ? `unreadable "${t}"` : "empty" };
  let digits = m[1];
  const hasPct = m[2] === "%";
  // a "%" occasionally comes back as an extra digit ("73%" → "739"); drop it if that makes the value plausible
  if (rule.percent && !hasPct && digits.length >= 2) {
    const cut = Number(digits.slice(0, -1));
    if (Number(digits) > rule.max && cut >= rule.min && cut <= rule.max) return { value: cut, note: "% sign misread" };
  }
  if (!rule.percent && hasPct) return { value: Number(digits), note: "unexpected %" };
  if (digits.length > 1 && digits.startsWith("0")) digits = digits.replace(/^0+(?=\d)/, "");
  return { value: Number(digits) };
}

function plausible(key: RowKey, v: number | null): boolean {
  if (v == null || !Number.isFinite(v)) return false;
  const r = STAT_RULES[key];
  return v >= r.min && v <= r.max;
}

async function readStat(img: RgbaImage, grid: TableGrid, c: number, r: number, ocr: OcrEngine): Promise<ParsedStat> {
  const key = ROW_KEYS[r];
  const tries: Array<ParsedStat & { ok: boolean }> = [];
  for (let variant = 0; variant < 3; variant++) {
    const input = statCellInput(img, grid.cols[c], grid.statRows[r], variant);
    if (input.empty) { tries.push({ value: null, raw: "", confidence: 0, doubtful: true, note: "empty cell", ok: false }); break; }
    const res = await ocr.recognize(input.bmp);
    const p = parseStatText(res.text, key);
    const ok = plausible(key, p.value) && !p.note;
    tries.push({ value: p.value, raw: res.text, confidence: res.confidence, doubtful: !ok, note: p.note, ok });
    if (ok && res.confidence >= 80) break;
  }
  const good = tries.filter(t => t.ok).sort((a, b) => b.confidence - a.confidence);
  if (good.length) {
    const best = good[0];
    const disagree = good.some(g => g.value !== best.value);
    const doubtful = best.confidence < 70 || (disagree && best.confidence < 85);
    return { value: best.value, raw: best.raw, confidence: best.confidence, doubtful, note: doubtful ? "low OCR confidence" : undefined };
  }
  const any = tries.filter(t => t.value != null).sort((a, b) => b.confidence - a.confidence)[0] ?? tries[0];
  const note = any?.note ?? (any?.value != null ? `outside ${STAT_RULES[key].min}–${STAT_RULES[key].max}` : "unreadable");
  return { value: any?.value ?? null, raw: any?.raw ?? "", confidence: any?.confidence ?? 0, doubtful: true, note };
}

const NAME_VARIANTS = [-12, 0, 10];

async function readName(img: RgbaImage, grid: TableGrid, c: number, ocr: OcrEngine): Promise<string[]> {
  const region = nameRegion(img, grid, grid.cols[c]);
  const out: string[] = [];
  for (const v of NAME_VARIANTS) {
    const input = nameCellInput(img, region, v);
    if (input.empty) continue;
    const res = await ocr.recognize(input.bmp);
    if (res.text) out.push(res.text.replace(/\s*\n\s*/g, " "));
  }
  return out;
}

/** Stat-row height the OCR preprocessing is tuned for (the 1121 px-wide PC client gives ~39 px). */
const NOMINAL_ROW_H = 40;

/**
 * Small screenshots: cut each table out and upscale it to the nominal size, then locate again inside the cut.
 * Returned grids are in the coordinates of the returned image (callers draw overlays on that image).
 */
export function normaliseTables(img: RgbaImage): Array<{ image: RgbaImage; grid: TableGrid; scale: number; offset: { x: number; y: number } }> {
  return locateTables(img).map(grid => {
    if (grid.rowHeight >= NOMINAL_ROW_H * 0.85) return { image: img, grid, scale: 1, offset: { x: 0, y: 0 } };
    const k = NOMINAL_ROW_H / grid.rowHeight;
    const pad = Math.round(grid.rowHeight * 0.5);
    const box = { x: grid.bbox.x - pad, y: grid.bbox.y - pad, w: grid.bbox.w + pad * 2, h: grid.bbox.h + pad * 2 };
    const cut = crop(img, box);
    const big = resize(cut, Math.round(cut.width * k), Math.round(cut.height * k));
    const again = locateTables(big)[0];
    if (!again) return { image: img, grid, scale: 1, offset: { x: 0, y: 0 } };
    return { image: big, grid: { ...again, side: again.side ?? grid.side }, scale: k, offset: { x: Math.max(0, box.x), y: Math.max(0, box.y) } };
  });
}

export async function parseLineupImage(img: RgbaImage, deps: ParseDeps): Promise<ParsedTable[]> {
  const prepared = normaliseTables(img);
  const grids = prepared.map(p => p.grid);
  const total = grids.length * (5 * 8 + 5 * NAME_VARIANTS.length);
  let done = 0;
  const tick = (n = 1) => { done += n; deps.onProgress?.(Math.min(done, total), total); };
  const tables: ParsedTable[] = [];
  for (const { image: img, grid, scale, offset } of prepared) {
    // 1) stats (digits mode)
    await deps.ocr.setMode("digits");
    const stats: Array<Record<RowKey, ParsedStat>> = [];
    for (let c = 0; c < 5; c++) {
      const s = {} as Record<RowKey, ParsedStat>;
      for (let r = 0; r < ROW_KEYS.length; r++) { s[ROW_KEYS[r]] = await readStat(img, grid, c, r, deps.ocr); tick(); }
      stats.push(s);
    }
    // 2) names (letters mode), Speed as tie-breaker
    await deps.ocr.setMode("name");
    const units: ParsedUnit[] = [];
    for (let c = 0; c < 5; c++) {
      const raw = await readName(img, grid, c, deps.ocr);
      tick(NAME_VARIANTS.length);
      const m = matchName(raw, deps.candidates, { speed: stats[c].speed.value, baseSpeed: deps.baseSpeed });
      const name: ParsedName = {
        raw, id: m.best?.id ?? null, en: m.best?.en ?? "", cn: m.best?.cn ?? "",
        candidates: m.ranked, doubtful: !m.confident,
      };
      // 3) soul icon
      const icon = findSoulIcon(img, grid.cols[c], grid.soulRow);
      let soul: ParsedSoul = { soulId: null, en: "", candidates: [], doubtful: true, icon };
      if (icon) {
        const sm = matchSoul(deps.souls, iconThumb(img, icon), deps.excludeSoulRef);
        const best = sm.ranked[0];
        soul = { soulId: sm.soulId, en: sm.soulId != null && best ? best.en : "", candidates: sm.ranked, doubtful: !sm.confident, icon };
      }
      units.push({ name, stats: stats[c], soul });
    }
    tables.push({ side: grid.side, grid, image: img, scale, offset, units, warnings: [...grid.warnings, ...(scale !== 1 ? [`small screenshot: table upscaled ×${scale.toFixed(2)}`] : [])] });
  }
  return tables;
}
