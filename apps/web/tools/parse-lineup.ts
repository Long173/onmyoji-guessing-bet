// tools/parse-lineup.ts — CLI: Lineup screenshot(s) → matches/*.en.json (the same parser as "Import from screenshot").
// Usage: node apps/web/tools/parse-lineup.ts out=matches/<name>-lineup.en.json title="..." <image.png> [image2.png]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { decodePng } from "./png.ts";
import { parseLineupImage, ROW_KEYS } from "../src/screenshot/parse.ts";
import type { ParsedTable } from "../src/screenshot/parse.ts";
import { createTesseractEngine } from "../src/screenshot/ocr-engine.ts";
import { buildSoulIndex } from "../src/screenshot/souls.ts";
import type { SoulRefFile } from "../src/screenshot/souls.ts";
import { nameCandidates } from "../src/screenshot/kb-bridge.ts";

const WEB = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter(a => a.includes("=")).map(a => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]));
const images = args.filter(a => !a.includes("="));
if (!images.length || !opt.out) {
  console.error('usage: node apps/web/tools/parse-lineup.ts out=<lineup.en.json> [title="..."] <image.png> [image2.png]');
  process.exit(1);
}

const INDEX: Array<{ i: number; pn?: (number | null)[] | null }> =
  JSON.parse(fs.readFileSync(path.join(WEB, "src", "kb", "shikigami-index.json"), "utf8"));
const baseSpeed = (id: number) => INDEX.find(x => x.i === id)?.pn?.[3] ?? null;
const candidates = nameCandidates(new Set(INDEX.map(x => x.i)));
const souls = buildSoulIndex(JSON.parse(fs.readFileSync(path.join(WEB, "src", "screenshot", "soul-refs.json"), "utf8")) as SoulRefFile);
const STAT_JSON: Record<string, string> = {
  attack: "atk", hp: "hp", defense: "def", speed: "spd", critRate: "cri", critDamage: "crid", effectHit: "efh", effectResist: "efr",
};

const T = createRequire(path.join(WEB, "package.json"))("tesseract.js");
const ocr = await createTesseractEngine({ langPath: path.join(WEB, "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int") }, T.createWorker);
const out: Record<string, unknown[]> = {};
const doubts: string[] = [];
try {
  for (const file of images) {
    const tables: ParsedTable[] = await parseLineupImage(decodePng(fs.readFileSync(file)), { ocr, candidates, baseSpeed, souls });
    for (const t of tables) {
      if (!t.side) { doubts.push(`${file}: table with unknown side skipped`); continue; }
      out[t.side] = t.units.map((u, k) => {
        if (u.name.doubtful) doubts.push(`${t.side} #${k + 1} name "${u.name.en}" (raw ${u.name.raw.join("|")})`);
        if (u.soul.doubtful) doubts.push(`${t.side} #${k + 1} soul "${u.soul.en}"`);
        const stats: Record<string, number | null> = {};
        for (const key of ROW_KEYS) {
          const s = u.stats[key];
          stats[STAT_JSON[key]] = s.value;
          if (s.doubtful) doubts.push(`${t.side} #${k + 1} ${key}=${s.value} (raw "${s.raw}")`);
        }
        return { name: u.name.en, soul: u.soul.en || null, stats };
      });
    }
  }
} finally {
  await ocr.terminate();
}
if (!out.red || !out.blue) { console.error("missing a team:", Object.keys(out)); process.exit(2); }
const lineup = { _meta: { title: opt.title ?? path.basename(opt.out), result: null, notes: ["Parsed from Lineup screenshots by apps/web/tools/parse-lineup.ts."] }, red: out.red, blue: out.blue };
fs.writeFileSync(opt.out, JSON.stringify(lineup, null, 2));
console.log(opt.out);
for (const s of ["red", "blue"] as const) for (const u of out[s] as any[]) console.log(s, u.name, "[" + u.soul + "]", JSON.stringify(u.stats));
console.log(doubts.length ? "DOUBTFUL:\n  " + doubts.join("\n  ") : "no doubtful cells");
