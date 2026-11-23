// tests/ui24-screenshot-import.ts — "Import from screenshot": Lineup screenshot → names / 8 stats / soul per unit.
//
// Runs the real browser parser (src/screenshot/*) on every Global-client sample in tests/fixtures/lineup-screens
// with tesseract.js (local worker / core / eng traineddata — no network), and checks against the ground-truth
// lineups in matches/*.en.json: team colour, all 5 names, all 40 stats and all 5 souls per table.
// Souls are scored twice: with the shipped reference set, and leave-one-match-out (the match's own crops removed,
// so only other matches + fandom-wiki art can answer) — the second number is the honest generalisation figure.
// Also: grid detection on rescaled / cropped / noisy variants, and unit checks of the text → value rules.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { decodePng } from "../tools/png.ts";
import { resize, crop } from "../src/screenshot/image.ts";
import type { RgbaImage } from "../src/screenshot/image.ts";
import { locateTables } from "../src/screenshot/locate.ts";
import { parseLineupImage, parseStatText, ROW_KEYS } from "../src/screenshot/parse.ts";
import type { ParsedTable } from "../src/screenshot/parse.ts";
import { createTesseractEngine } from "../src/screenshot/ocr-engine.ts";
import { matchName, similarity } from "../src/screenshot/name-match.ts";
import { buildSoulIndex } from "../src/screenshot/souls.ts";
import type { SoulRefFile } from "../src/screenshot/souls.ts";
import { nameCandidates } from "../src/screenshot/kb-bridge.ts";

const here = import.meta.dirname;
const WEB = path.resolve(here, "..");
const ROOT = path.resolve(WEB, "..", "..");
const FIX = path.join(here, "fixtures", "lineup-screens");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);

const EN = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "en-names.json"), "utf8"));
const INDEX: Array<{ i: number; pn?: (number | null)[] | null }> = JSON.parse(fs.readFileSync(path.join(WEB, "src", "kb", "shikigami-index.json"), "utf8"));
const norm = (s: string) => s.toLowerCase().replace(/[\s'’._,&-]+/g, "");
const shikiId = (e: { name: string; shikigamiId?: number }) => e.shikigamiId
  ?? Number(Object.entries<any>(EN.shikigami).find(([, v]) => norm(v.en) === norm(e.name) || v.cn === e.name)?.[0]);
const soulId = (n: string) => Number(Object.entries<any>(EN.souls).find(([, v]) => norm(v.en) === norm(n) || v.cn === n)?.[0]);
const baseSpeed = (id: number) => INDEX.find(x => x.i === id)?.pn?.[3] ?? null;
const candidates = nameCandidates(new Set(INDEX.map(x => x.i)));
const refFile: SoulRefFile = JSON.parse(fs.readFileSync(path.join(WEB, "src", "screenshot", "soul-refs.json"), "utf8"));
const souls = buildSoulIndex(refFile);
const STAT_JSON: Record<string, string> = {
  attack: "atk", hp: "hp", defense: "def", speed: "spd", critRate: "cri", critDamage: "crid", effectHit: "efh", effectResist: "efr",
};
const load = (f: string): RgbaImage => decodePng(fs.readFileSync(path.join(FIX, f)));

sec("[1] text → value rules");
{
  ok("plain integer", parseStatText("17434", "hp").value === 17434);
  ok("percent with sign", parseStatText("73%", "critRate").value === 73);
  ok("'%' read as a digit is dropped when that makes it plausible", parseStatText("739", "critRate").value === 73);
  ok("garbage ⇒ null", parseStatText("4a5", "attack").value === null);
  ok("similarity: identical = 1", similarity("Kuro", "Kuro") === 1);
  ok("similarity: OCR confusion r/n is cheap", similarity("Serhime Resurgent", "Senhime Resurgent") > 0.9);
  const mk = matchName(["Maki& Karachi"], candidates);
  ok("in-game short name 'Maki&Karashi' ⇒ 310 Peach Maki & Karashi", mk.best?.id === 310, JSON.stringify(mk.best));
  const sen = matchName(["Senhime"], candidates);
  ok("'Senhime' ⇒ Senhime (not Senhime Resurgent)", sen.best?.en === "Senhime", sen.best?.en);
}

sec("[2] grid detection on every sample + rescaled / cropped / noisy variants");
const manifest: { images: Array<{ file: string; lineup: string; tables: Array<"red" | "blue"> }> } =
  JSON.parse(fs.readFileSync(path.join(FIX, "manifest.json"), "utf8"));
for (const im of manifest.images) {
  const img = load(im.file);
  const variants: Array<[string, RgbaImage]> = [
    ["original", img],
    ["×0.6", resize(img, Math.round(img.width * 0.6), Math.round(img.height * 0.6))],
    ["×1.6", resize(img, Math.round(img.width * 1.6), Math.round(img.height * 1.6))],
    ["cropped", crop(img, { x: 60, y: 40, w: img.width - 120, h: img.height - 70 })],
    ["noise", { ...img, data: img.data.map((v, i) => (i % 4 === 3 ? v : v + ((i * 2654435761) % 13) - 6)) as Uint8ClampedArray }],
  ];
  for (const [label, v] of variants) {
    const t = locateTables(v);
    const sides = t.map(x => x.side).join(",");
    const regular = t.every(x => x.statRows.length === 8 && x.cols.length === 5
      && x.cols.every((c, k) => k === 0 || Math.abs((c.a - x.cols[k - 1].a) - (x.cols[1].a - x.cols[0].a)) <= 3));
    ok(`${im.file} ${label}: ${t.length} table(s) ${sides}`, sides === im.tables.join(",") && regular, sides);
  }
}

sec("[3] full parse (tesseract.js, local assets) vs ground truth");
const require = createRequire(path.join(WEB, "package.json"));
const T = require("tesseract.js");
const ocr = await createTesseractEngine(
  { langPath: path.join(WEB, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int") },
  T.createWorker,
);
const totals = { names: 0, namesOk: 0, stats: 0, statsOk: 0, souls: 0, soulsOk: 0, soulsLoo: 0, flaggedWrong: 0, unflaggedWrong: 0 };
const report: string[] = [];
try {
  for (const im of manifest.images) {
    const img = load(im.file);
    const truth = JSON.parse(fs.readFileSync(path.join(ROOT, "matches", im.lineup), "utf8"));
    const match = im.file.slice(0, 11);
    const t0 = Date.now();
    const tables: ParsedTable[] = await parseLineupImage(img, { ocr, candidates, baseSpeed, souls });
    const loo: ParsedTable[] = await parseLineupImage(img, {
      ocr, candidates, baseSpeed, souls: buildSoulIndex({ ...refFile, refs: refFile.refs.filter(r => !r.from.startsWith(match)) }),
    });
    const ms = Date.now() - t0;
    ok(`${im.file}: tables ${tables.map(t => t.side).join(",")}`, tables.map(t => t.side).join(",") === im.tables.join(","));
    tables.forEach((t, k) => {
      const side = im.tables[k];
      const want = truth[side];
      let n = 0, s = 0, so = 0, sl = 0;
      const misses: string[] = [];
      t.units.forEach((u, c) => {
        const wid = shikiId(want[c]);
        if (u.name.id === wid) n++; else misses.push(`name${c}: ${u.name.en || "?"} (ocr ${JSON.stringify(u.name.raw)}) ≠ ${want[c].name}`);
        if (u.name.id !== wid && !u.name.doubtful) totals.unflaggedWrong++;
        for (const key of ROW_KEYS) {
          const v = u.stats[key];
          const exp = want[c].stats[STAT_JSON[key]];
          if (v.value === exp) s++;
          else {
            misses.push(`${key}${c}: ${v.value} (raw "${v.raw}") ≠ ${exp}`);
            if (v.doubtful) totals.flaggedWrong++; else totals.unflaggedWrong++;
          }
        }
        if (u.soul.soulId === soulId(want[c].soul)) so++; else misses.push(`soul${c}: ${u.soul.candidates[0]?.en} ≠ ${want[c].soul}`);
        if (loo[k]?.units[c].soul.soulId === soulId(want[c].soul)) sl++;
      });
      totals.names += 5; totals.namesOk += n; totals.stats += 40; totals.statsOk += s; totals.souls += 5; totals.soulsOk += so; totals.soulsLoo += sl;
      const line = `${im.file} [${side}]  names ${n}/5 · stats ${s}/40 · souls ${so}/5 (leave-match-out ${sl}/5) · ${ms} ms`;
      report.push(line);
      ok(line, n === 5 && s === 40 && so === 5, misses.join("; "));
      const flagged = t.units.flatMap(u => [u.name.doubtful, u.soul.doubtful, ...ROW_KEYS.map(key => u.stats[key].doubtful)]).filter(Boolean).length;
      if (flagged) console.log(`      (${flagged} cell(s) flagged for review)`);
    });
  }
} finally {
  await ocr.terminate();
}
sec("[4] summary");
for (const l of report) console.log("  " + l);
console.log(`  TOTAL names ${totals.namesOk}/${totals.names} · stats ${totals.statsOk}/${totals.stats} · souls ${totals.soulsOk}/${totals.souls} (leave-match-out ${totals.soulsLoo}/${totals.souls})`);
ok("no wrong value slipped through without a review flag", totals.unflaggedWrong === 0, String(totals.unflaggedWrong));
ok("leave-match-out souls ≥ 90 %", totals.soulsLoo >= totals.souls * 0.9, `${totals.soulsLoo}/${totals.souls}`);

console.log(`\nui24-screenshot-import: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
