// tools/merge-en-text.mjs — merge translated KB text batches into data/kb/en-text.json
//
// Usage:  node tools/merge-en-text.mjs <batch-dir> [--strict]
//
// Reads every `batch-*.en.json` in <batch-dir> (flat { key: englishText }) and the matching
// `batch-*.cn.json` next to it (flat { key: chineseText }, the translation source).
// For each English value it checks:
//   · the value is a non-empty string (otherwise the key is skipped);
//   · the multiset of `[...]` tokens ([buff_x] / [tips_x] …) equals the Chinese source's.
// Mismatches are reported but do not fail the merge (with --strict, mismatched keys are left out
// so the UI falls back to Chinese for them). Keys are written sorted, then the TS module is
// regenerated via apps/web/tools/build-en-text.mjs.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "data", "kb", "en-text.json");
const GENERATOR = path.join(ROOT, "apps", "web", "tools", "build-en-text.mjs");
const TOKEN = /\[[^\[\]\s]+\]/g;
const MAX_LISTED = 40;

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: node tools/merge-en-text.mjs <batch-dir> [--strict]");
  process.exit(2);
}
const batchDir = path.resolve(dir);
if (!fs.existsSync(batchDir) || !fs.statSync(batchDir).isDirectory()) {
  console.error(`merge-en-text: not a directory: ${batchDir}`);
  process.exit(2);
}

/** Read a JSON object file; returns null (and reports) when unreadable or not a flat object. */
function readFlat(file, problems) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
    problems.push(`${path.basename(file)}: not a flat JSON object`);
  } catch (e) {
    problems.push(`${path.basename(file)}: ${e.message}`);
  }
  return null;
}

/** Token multiset as a sorted list (order inside the sentence may legitimately change in English). */
const tokensOf = (s) => (String(s).match(TOKEN) ?? []).sort();
const sameTokens = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);

/** Human-readable diff of two token multisets: what's missing in EN and what's extra. */
function tokenDiff(cnTokens, enTokens) {
  const count = (list) => list.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map());
  const c = count(cnTokens), e = count(enTokens);
  const missing = [], extra = [];
  for (const [t, n] of c) for (let i = 0; i < n - (e.get(t) ?? 0); i++) missing.push(t);
  for (const [t, n] of e) for (let i = 0; i < n - (c.get(t) ?? 0); i++) extra.push(t);
  return [missing.length ? `missing ${missing.join(" ")}` : "", extra.length ? `extra ${extra.join(" ")}` : ""].filter(Boolean).join("; ");
}

const files = fs.readdirSync(batchDir).filter((f) => /^batch-.*\.en\.json$/.test(f)).sort();
if (!files.length) {
  console.error(`merge-en-text: no batch-*.en.json files in ${batchDir}`);
  process.exit(1);
}

const merged = {};
const owner = {};
const report = { fileProblems: [], nonString: [], mismatch: [], noSource: [], conflicts: [] };

for (const f of files) {
  const en = readFlat(path.join(batchDir, f), report.fileProblems);
  if (!en) continue;
  const cnFile = path.join(batchDir, f.replace(/\.en\.json$/, ".cn.json"));
  const cn = fs.existsSync(cnFile) ? readFlat(cnFile, report.fileProblems) : null;
  if (!cn) report.fileProblems.push(`${f}: no readable ${path.basename(cnFile)} — token check skipped for this batch`);

  for (const [key, value] of Object.entries(en)) {
    if (key.startsWith("_")) continue;
    if (typeof value !== "string" || !value.trim()) {
      report.nonString.push(`${f} ${key}: ${JSON.stringify(value)?.slice(0, 60)}`);
      continue;
    }
    if (cn) {
      if (typeof cn[key] !== "string") {
        report.noSource.push(`${f} ${key}`);
      } else {
        const want = tokensOf(cn[key]), got = tokensOf(value);
        if (!sameTokens(want, got)) {
          report.mismatch.push(`${f} ${key}: ${tokenDiff(want, got)}`);
          if (strict) continue;
        }
      }
    }
    if (key in merged && merged[key] !== value) report.conflicts.push(`${key}: ${owner[key]} overridden by ${f}`);
    merged[key] = value;
    owner[key] = f;
  }
}

const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2) + "\n", "utf8");

const section = (title, list) => {
  if (!list.length) return;
  console.log(`\n${title} (${list.length}):`);
  for (const line of list.slice(0, MAX_LISTED)) console.log("  " + line);
  if (list.length > MAX_LISTED) console.log(`  … ${list.length - MAX_LISTED} more`);
};
console.log(`merge-en-text: ${files.length} batch file(s) → ${Object.keys(sorted).length} keys → ${path.relative(ROOT, OUT)}`);
section("File problems", report.fileProblems);
section("Skipped: value is not a non-empty string", report.nonString);
section(`Token mismatches vs Chinese source${strict ? " (left out: --strict)" : " (kept)"}`, report.mismatch);
section("Keys with no Chinese source string (token check skipped)", report.noSource);
section("Duplicate keys with different values (last batch wins)", report.conflicts);

const gen = spawnSync(process.execPath, [GENERATOR], { stdio: "inherit" });
if (gen.status !== 0) {
  console.error("merge-en-text: generator failed");
  process.exit(gen.status ?? 1);
}
