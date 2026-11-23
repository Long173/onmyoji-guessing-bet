// tools/add-soul-refs.ts — add / refresh soul-icon references for the screenshot importer.
//
// Usage (run from anywhere, Node ≥ 22):
//   node apps/web/tools/add-soul-refs.ts --image shot.png --lineup matches/2026-11-23-lineup.en.json [--side red|blue]
//       crops the five Soul-effects icons of every table found in the screenshot (or only the given side) and
//       labels them with the lineup's `soul` names (English or Chinese) of the table's team colour.
//   node apps/web/tools/add-soul-refs.ts --wiki-meta icons/meta.json
//       adds whole-image icons (e.g. fandom wiki art, PNG) listed as [{ "file": "...png", "en": "Fortune Cat" }]
//       as low-priority "wiki" references.
//   --list                       print what the reference file holds
//   --out <file>                 reference file (default apps/web/src/screenshot/soul-refs.json)
// References with the same origin key ("<image>#<side><column>") are replaced, so re-running is idempotent.
import fs from "node:fs";
import path from "node:path";
import { decodePng } from "./png.ts";
import { locateTables } from "../src/screenshot/locate.ts";
import { findSoulIcon, iconThumb, thumbToBase64, THUMB } from "../src/screenshot/souls.ts";
import type { SoulRef, SoulRefFile } from "../src/screenshot/souls.ts";
import { resize, crop } from "../src/screenshot/image.ts";
import type { RgbaImage } from "../src/screenshot/image.ts";

const WEB = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(WEB, "..", "..");
const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const OUT = path.resolve(opt("--out") ?? path.join(WEB, "src", "screenshot", "soul-refs.json"));

const EN = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "en-names.json"), "utf8"));
const norm = (s: string) => s.toLowerCase().replace(/[\s'’._-]+/g, "");
function soulIdOf(name: string): { id: number; en: string } {
  for (const [id, v] of Object.entries<{ en: string; cn: string }>(EN.souls)) {
    if (norm(v.en) === norm(name) || v.cn === name) return { id: Number(id), en: v.en };
  }
  throw new Error(`unknown soul "${name}"`);
}

function load(): SoulRefFile {
  if (!fs.existsSync(OUT)) return { version: 1, thumb: THUMB, refs: [] };
  return JSON.parse(fs.readFileSync(OUT, "utf8"));
}
function save(f: SoulRefFile) {
  f.refs.sort((a, b) => a.soulId - b.soulId || a.source.localeCompare(b.source) || a.from.localeCompare(b.from));
  // one ref per line keeps diffs readable
  const body = f.refs.map(r => "    " + JSON.stringify(r)).join(",\n");
  fs.writeFileSync(OUT, `{\n  "version": 1,\n  "thumb": ${f.thumb},\n  "refs": [\n${body}\n  ]\n}\n`);
}
function upsert(f: SoulRefFile, ref: SoulRef) {
  f.refs = f.refs.filter(r => r.from !== ref.from);
  f.refs.push(ref);
}

/** Whole-image icon (transparent / square art): crop to the opaque bounding box, then shrink. */
function wholeIconThumb(img: RgbaImage): RgbaImage {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.data[(y * img.width + x) * 4 + 3] > 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  const d = Math.max(x1 - x0 + 1, y1 - y0 + 1);
  const sq = crop(img, { x: (x0 + x1 - d) / 2, y: (y0 + y1 - d) / 2, w: d, h: d });
  // flatten transparency onto the table beige so masks behave like in-game crops
  for (let i = 0; i < sq.width * sq.height; i++) {
    const a = sq.data[i * 4 + 3] / 255;
    const bgc = [212, 198, 181];
    for (let k = 0; k < 3; k++) sq.data[i * 4 + k] = Math.round(sq.data[i * 4 + k] * a + bgc[k] * (1 - a));
    sq.data[i * 4 + 3] = 255;
  }
  return resize(sq, THUMB, THUMB);
}

const file = load();
if (args.includes("--list")) {
  const by = new Map<string, number>();
  for (const r of file.refs) by.set(`${r.en} (${r.soulId}) ${r.source}`, (by.get(`${r.en} (${r.soulId}) ${r.source}`) ?? 0) + 1);
  for (const [k, n] of [...by].sort()) console.log(`${n}× ${k}`);
  console.log(`${file.refs.length} references in ${path.relative(process.cwd(), OUT)}`);
  process.exit(0);
}

const wikiMeta = opt("--wiki-meta");
if (wikiMeta) {
  const meta: Array<{ file: string; en: string }> = JSON.parse(fs.readFileSync(wikiMeta, "utf8"));
  let n = 0;
  for (const m of meta) {
    const p = path.resolve(path.dirname(wikiMeta), m.file);
    if (!p.toLowerCase().endsWith(".png") || !fs.existsSync(p)) { console.warn(`skip ${m.file} (need an existing .png)`); continue; }
    let sid: { id: number; en: string };
    try { sid = soulIdOf(m.en); } catch (e) { console.warn(String(e)); continue; }
    const thumb = wholeIconThumb(decodePng(fs.readFileSync(p)));
    upsert(file, { soulId: sid.id, en: sid.en, source: "wiki", from: "wiki:" + path.basename(p), rgb: thumbToBase64(thumb) });
    n++;
  }
  save(file);
  console.log(`added/updated ${n} wiki references → ${OUT}`);
  process.exit(0);
}

const image = opt("--image"), lineupPath = opt("--lineup"), onlySide = opt("--side");
if (!image || !lineupPath) {
  console.error("usage: --image <png> --lineup <lineup.json> [--side red|blue]   |   --wiki-meta <meta.json>   |   --list");
  process.exit(2);
}
const lineup = JSON.parse(fs.readFileSync(lineupPath, "utf8"));
const img = decodePng(fs.readFileSync(image));
const tables = locateTables(img);
if (!tables.length) { console.error("no Lineup table found in " + image); process.exit(1); }
let added = 0;
for (const t of tables) {
  if (!t.side) { console.warn("table with unknown team colour skipped (pass --side on a single-table image)"); continue; }
  const side = onlySide && tables.length === 1 ? onlySide : t.side;
  if (onlySide && side !== onlySide) continue;
  const units = lineup[side];
  if (!Array.isArray(units) || units.length !== 5) throw new Error(`lineup has no 5-unit "${side}" team`);
  for (let c = 0; c < 5; c++) {
    const soulName = units[c].soul;
    if (!soulName) { console.warn(`${side}${c}: no soul in lineup, skipped`); continue; }
    const icon = findSoulIcon(img, t.cols[c], t.soulRow);
    if (!icon) { console.warn(`${side}${c}: soul icon not found`); continue; }
    const sid = soulIdOf(soulName);
    upsert(file, {
      soulId: sid.id, en: sid.en, source: "screen", from: `${path.basename(image)}#${side}${c}`,
      rgb: thumbToBase64(iconThumb(img, icon)),
    });
    added++;
  }
}
save(file);
console.log(`added/updated ${added} references from ${path.basename(image)} → ${OUT}`);
