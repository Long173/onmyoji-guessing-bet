// screenshot/browser.ts — browser glue: decode pasted / dropped images, own the OCR worker, run the parser.
import type { RgbaImage } from "./image.ts";
import { resize } from "./image.ts";
import type { OcrEngine } from "./ocr-engine.ts";
import { browserTesseractPaths, createTesseractEngine } from "./ocr-engine.ts";
import type { ParsedTable } from "./parse.ts";
import type { SoulIndex, SoulRefFile } from "./souls.ts";
import { nameCandidates } from "./kb-bridge.ts";
import { SHIKIGAMI } from "../kb/useKb.ts";

const MAX_SIDE = 2600;   // 4K phone captures: shrink first, the table is still far above the OCR's needs

export async function blobToRgba(blob: Blob): Promise<RgbaImage> {
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2D context unavailable");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const img: RgbaImage = { width: d.width, height: d.height, data: d.data };
    const k = MAX_SIDE / Math.max(img.width, img.height);
    return k < 1 ? resize(img, Math.round(img.width * k), Math.round(img.height * k)) : img;
  } finally {
    bmp.close();
  }
}

let engine: Promise<OcrEngine> | null = null;
let souls: Promise<SoulIndex> | null = null;

function getEngine(): Promise<OcrEngine> {
  if (!engine) {
    engine = createTesseractEngine(browserTesseractPaths(import.meta.env.BASE_URL)).catch(e => { engine = null; throw e; });
  }
  return engine;
}

function getSouls(): Promise<SoulIndex> {
  if (!souls) {
    souls = Promise.all([import("./souls.ts"), import("./soul-refs.json")])
      .then(([m, refs]) => m.buildSoulIndex((refs.default ?? refs) as unknown as SoulRefFile))
      .catch(e => { souls = null; throw e; });
  }
  return souls;
}

const allowedIds = new Set(SHIKIGAMI.map(s => s.i));
const baseSpeedById = new Map(SHIKIGAMI.map(s => [s.i, s.pn?.[3] ?? null]));

export async function parseImage(img: RgbaImage, onProgress?: (done: number, total: number) => void): Promise<ParsedTable[]> {
  const [{ parseLineupImage }, ocr, soulIndex] = await Promise.all([import("./parse.ts"), getEngine(), getSouls()]);
  return parseLineupImage(img, {
    ocr, souls: soulIndex, onProgress,
    candidates: nameCandidates(allowedIds),
    baseSpeed: id => baseSpeedById.get(id) ?? null,
  });
}

export async function disposeOcr(): Promise<void> {
  const e = engine;
  engine = null;
  if (e) await (await e).terminate().catch(() => undefined);
}
