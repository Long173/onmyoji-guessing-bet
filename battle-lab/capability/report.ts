import fs from "node:fs/promises";
import path from "node:path";
import { CAPABILITIES, coverage } from "./registry.ts";

const KB = path.resolve(import.meta.dirname, "..", "..", "data", "kb", "shikigami.full.json");
const shiki = JSON.parse(await fs.readFile(KB, "utf8"));
const tagFreq: Record<string, number> = {};
for (const s of shiki) for (const sk of s.skills) for (const t of sk.tags ?? []) tagFreq[t] = (tagFreq[t] ?? 0) + 1;

const rows = CAPABILITIES.map(c => ({ ...c, freq: tagFreq[c.tag] ?? 0 })).sort((a, b) => b.freq - a.freq);
const cov = coverage();
const icon = (s: string) => (s === "FULL" ? "FULL" : s === "PARTIAL" ? "PARTIAL" : "NONE");

const L: string[] = [];
L.push("# Capability Coverage — 引擎能力覆盖率", "");
L.push("以游戏自身的技能 tags[]（48 类）为基准，而不是自定的功能清单。", "");
L.push("| 能力 | 官方tag频次 | 引擎支持 | 机制来源 | 生产者（须在生产代码中匹配到） | 说明 |", "|---|---:|---|---|---|---|");
for (const r of rows) L.push("| " + r.key + " | " + r.freq + " | " + icon(r.support) + " | " + r.evidence + " | " + (r.producer ? "`" + r.producer + "`" : (r.support === "FULL" ? "**缺失（FULL 却没有生产者）**" : "—")) + " | " + r.note + " |");
L.push("", "## 汇总", "");
L.push("- 能力总数: **" + cov.total + "**");
L.push("- FULL: " + cov.full);
L.push("- PARTIAL: " + cov.partial);
L.push("- NONE: " + cov.none);
L.push("- **Kernel Coverage = " + cov.kernelCoverage + "%**（PARTIAL 按 0.5 计）");
L.push("- Hard Coverage = " + cov.hardCoverage + "%（只算 FULL）");
L.push("", "未支持能力: " + cov.unsupported.join(", "));
L.push("", "> 这是**内核能力**覆盖率，不是实现了多少式神。M1 装载真实式神后应重新统计。");
L.push("> ");
L.push("> **这不是「真实性 / 准确率」** —— 没有依据把覆盖率线性映射成预测准确率（见 HealthCheck 的同一句声明）。");
L.push("> 「生产者」一列由 tests/g22-capability-claims.ts 强制：FULL 的能力必须能在**生产代码**里匹配到");
L.push("> 那个正则；匹配不到就说明这句声明比代码乐观。tests / tools / experiments 都**不算**生产代码 ——");
L.push("> 否则脚手架会把自己的缺口掩盖掉（第 28 轮：封印的抑制集合只有 experiments 会写）。");

const out = path.resolve(import.meta.dirname, "coverage.md");
await fs.writeFile(out, L.join("\n"), "utf8");
await fs.writeFile(path.resolve(import.meta.dirname, "coverage.json"), JSON.stringify({ cov, rows }, null, 1), "utf8");
console.log(L.slice(L.length - 12).join("\n"));
