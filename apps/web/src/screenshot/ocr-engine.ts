// screenshot/ocr-engine.ts — the OCR boundary. The parser only needs "recognise this binarised line".
// In the browser this is tesseract.js with worker / core / traineddata served from /tesseract/ (no CDN);
// Node tests construct the same engine with local paths (see tests/ui24-screenshot-import.ts).

export type OcrMode = "digits" | "name";
export interface OcrResult { text: string; confidence: number }

export interface OcrEngine {
  setMode(mode: OcrMode): Promise<void>;
  recognize(bmp: Uint8Array): Promise<OcrResult>;
  terminate(): Promise<void>;
}

export interface TesseractPaths {
  /** browser only: URL of tesseract.js worker.min.js */
  workerPath?: string;
  /** browser only: directory URL holding tesseract-core-*-lstm.wasm.js */
  corePath?: string;
  /** directory (URL in the browser, filesystem path in Node) holding eng.traineddata.gz */
  langPath: string;
  cachePath?: string;
}

const DIGITS = "0123456789%";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz&,.' ";

// tesseract.js ships CommonJS without precise types for our usage; keep the surface we touch explicit.
interface TessWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(img: Uint8Array): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
}
type CreateWorker = (lang: string, oem: number, opts: Record<string, unknown>) => Promise<TessWorker>;

export async function createTesseractEngine(paths: TesseractPaths, createWorker?: CreateWorker): Promise<OcrEngine> {
  let create = createWorker;
  if (!create) {
    const mod: { createWorker?: CreateWorker; default?: { createWorker: CreateWorker } } = await import("tesseract.js");
    create = mod.createWorker ?? mod.default?.createWorker;
  }
  if (!create) throw new Error("tesseract.js did not load");
  const opts: Record<string, unknown> = { langPath: paths.langPath, gzip: true, cacheMethod: "none" };
  if (paths.workerPath) { opts.workerPath = paths.workerPath; opts.workerBlobURL = false; }
  if (paths.corePath) opts.corePath = paths.corePath;
  if (paths.cachePath) opts.cachePath = paths.cachePath;
  const worker = await create("eng", 1 /* OEM.LSTM_ONLY */, opts);
  let mode: OcrMode | null = null;
  return {
    async setMode(m) {
      if (m === mode) return;
      mode = m;
      await worker.setParameters(m === "digits"
        ? { tessedit_char_whitelist: DIGITS, tessedit_pageseg_mode: "7" }
        : { tessedit_char_whitelist: LETTERS, tessedit_pageseg_mode: "6" });
    },
    async recognize(bmp) {
      const r = await worker.recognize(bmp);
      return { text: r.data.text.trim(), confidence: r.data.confidence };
    },
    async terminate() { await worker.terminate(); },
  };
}

/** Browser engine with assets from `${BASE_URL}tesseract/` (copied there by the Vite plugin in vite.config.ts). */
export function browserTesseractPaths(base: string): TesseractPaths {
  const root = new URL(base.replace(/\/?$/, "/") + "tesseract/", location.href).href;
  return { workerPath: root + "worker.min.js", corePath: root.replace(/\/$/, ""), langPath: root.replace(/\/$/, "") };
}
