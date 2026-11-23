// matches/to-ui-json.ts — convert a matches/*.en.json lineup into the web UI's GuessingMatch JSON
// (schemaVersion 1, the format accepted by "Import JSON").
// Usage: node matches/to-ui-json.ts file=matches/<lineup>.en.json [out=matches/ui/<name>.json]
import fs from "node:fs";
import path from "node:path";
import { enShiki, resolveShiki, resolveSoul } from "./names.ts";

interface EnEntry { name: string; soul?: string | null; stats: Record<string, number> }

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split("=") as [string, string]));
if (!args.file) { console.error("usage: node matches/to-ui-json.ts file=<lineup.en.json> [out=<file>]"); process.exit(1); }

const src = JSON.parse(fs.readFileSync(args.file, "utf8"));
const base = path.basename(args.file).replace(/\.en\.json$|\.json$/, "");
const now = new Date().toISOString();

function toUnit(e: EnEntry, side: string, i: number) {
  const shiki = resolveShiki(e.name);
  if (!shiki) throw new Error(`unknown shikigami: ${e.name}`);
  const soulId = e.soul ? resolveSoul(e.soul) : null;
  if (e.soul && soulId == null) throw new Error(`unknown soul: ${e.soul}`);
  const s = e.stats;
  return {
    unitId: `${side}${i + 1}`,
    shikigamiId: shiki.id,
    name: enShiki(shiki.id) || e.name,
    stats: {
      attack: s.atk, hp: s.hp, defense: s.def, speed: s.spd,
      critRate: s.cri, critDamage: s.crid, effectHit: s.efh, effectResist: s.efr,
    },
    soulId,
  };
}

const match = {
  schemaVersion: 1,
  id: base,
  red: { units: (src.red as EnEntry[]).map((e, i) => toUnit(e, "r", i)) },
  blue: { units: (src.blue as EnEntry[]).map((e, i) => toUnit(e, "b", i)) },
  ruleset: "GUESSING",
  source: { type: "JSON", note: src._meta?.title ?? base },
  createdAt: now,
  updatedAt: now,
};

const out = args.out ?? path.join(path.dirname(args.file), "ui", `${base}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(match, null, 1));
console.log(out);
