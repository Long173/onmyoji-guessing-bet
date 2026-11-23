// compile/ai-gaps.ts — AI 规则量化缺口分析（目标 ② 的"AI 阈值量化"部分）
import fs from "node:fs/promises";
import path from "node:path";
import { compileAI } from "./ai-compiler.ts";
const KB = path.resolve(import.meta.dirname, "..", "..", "data", "kb", "ai.json");
const entries = JSON.parse(await fs.readFile(KB, "utf8"));

const FUZZY = /一定|若干|部分|某些|适量|较高|较低|足够|不足|充足|多个|少量|大量/;
const NUM = /\d/;

const rows: any[] = [];
for (const e of entries) {
  const ir = compileAI(e.id, e.name, e);
  for (const r of ir.skillRules) rows.push({ kind: "cast", char: e.name, id: e.id, raw: r.condRaw || "(无条件)",
    compiled: !!r.cond, quantified: !!r.condRaw && NUM.test(r.condRaw), fuzzy: FUZZY.test(r.condRaw) });
  for (const t of ir.targetRules) rows.push({ kind: "target", char: e.name, id: e.id, raw: t.ruleRaw,
    compiled: !!t.selector, quantified: NUM.test(t.ruleRaw), fuzzy: FUZZY.test(t.ruleRaw) });
}
const T = rows.length;
const compiled = rows.filter(r => r.compiled).length;
const quantified = rows.filter(r => r.quantified).length;
const fuzzy = rows.filter(r => r.fuzzy).length;
const fuzzyUncompiled = rows.filter(r => r.fuzzy && !r.compiled).length;
const concreteUncompiled = rows.filter(r => !r.fuzzy && !r.compiled).length;

console.log("=== AI 规则量化缺口分析（" + entries.length + " 只式神，" + T + " 条规则）===");
console.log(" 可编译        : " + compiled + " / " + T + "  (" + ((compiled / T) * 100).toFixed(1) + "%)");
console.log(" 含具体数值    : " + quantified + " / " + T + "  (" + ((quantified / T) * 100).toFixed(1) + "%)");
console.log(" 含模糊词      : " + fuzzy + "  (" + ((fuzzy / T) * 100).toFixed(1) + "%)");
console.log("   - 模糊 且 未编译 : " + fuzzyUncompiled + "   <- 必须实测/人工量化");
console.log("   - 不模糊 但 未编译: " + concreteUncompiled + "   <- 只是词典没覆盖，可继续加规则");

const byKind = (k: string) => { const s = rows.filter(r => r.kind === k); return s.length + " 条, 可编译 " + s.filter(r => r.compiled).length + ", 含数值 " + s.filter(r => r.quantified).length + ", 模糊 " + s.filter(r => r.fuzzy).length; };
console.log("\n cast  : " + byKind("cast"));
console.log(" target: " + byKind("target"));

console.log("\n=== 模糊词规则（全部，需人工/实测量化）===");
const fz = rows.filter(r => r.fuzzy);
for (const r of fz) console.log("  [" + r.char + "][" + r.kind + "] " + r.raw.slice(0, 66));

await fs.mkdir(path.resolve(import.meta.dirname, "..", "fixtures"), { recursive: true });
await fs.writeFile(path.resolve(import.meta.dirname, "..", "fixtures", "ai-gaps.json"), JSON.stringify({
  summary: { totalRules: T, compiled, quantified, fuzzy, fuzzyUncompiled, concreteUncompiled },
  fuzzyRules: fz, uncompiled: rows.filter(r => !r.compiled),
}, null, 1), "utf8");
console.log("\n-> fixtures/ai-gaps.json");
