// tests/g49-fidelity-no-percent.ts — ★★★ 「不许把覆盖率/编译率包装成真实性百分比」（第 82 轮，目标 ①）
//
// a1-4.md §3 最强调的一条：**不能说「当前模拟器有 80% 真实性」**。
//   Capability Coverage 58.3% ≠ 战斗真实性 58.3%
//   HIGH 编译率 × HIGH AI 率 ≠ 真实性
// 报告 §7 与 kernel/fidelity.ts 的注释都写了这条禁令，ui10-fidelity 也断言了
// 「免责声明里明确写了不给百分比」。
//
// ★★★ 但那只证明**我们说了**不给，没证明**我们没给**。这一轮把后半句也变成断言：
//   走**生产路径**（engine-adapter）真的跑一场，把产出的 Fidelity 报告逐键扫一遍，
//   任何「评分型」的字段名都必须不存在；分类只能落在四态里，不能是数字。
//   —— 与项目里反复出现的「声明 vs 实现」同类：**声明本身不是实现**。
import fs from "node:fs";
import path from "node:path";
import { createEngineAdapter } from "../../apps/web/src/adapters/engine-adapter.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { assessFidelity, FIDELITY_CLASS_LABEL } from "../kernel/fidelity.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** 评分型字段名：出现即违规 */
const SCORE_KEY = /percent|percentage|score|rate|真实性|总分|总体|overall|fidelitynum/i;
/** 白名单：这些数字是**条目进度**，不是真实性评分（fidelity.ts 的注释写明了这一点） */
const ALLOW_KEYS = new Set(["bar", "filled", "total", "schemaVersion", "useCount", "panelFilled"]);

/**
 * 递归扫描一份 Fidelity 报告，返回所有「评分型」字段的路径。
 * ★ 这就是被测对象 —— 反向用例直接喂给同一个函数，所以它必须能**抓到**。
 */
export function scanForScores(o: any, at = "", hits: string[] = []): string[] {
  if (o === null || typeof o !== "object") return hits;
  for (const k of Object.keys(o)) {
    const here = at ? at + "." + k : k;
    if (SCORE_KEY.test(k) && !ALLOW_KEYS.has(k)) hits.push(here + "（字段名像评分）");
    scanForScores(o[k], here, hits);
  }
  return hits;
}

sec("[1] ★★★ 走生产路径跑一场，报告里不许有评分型字段");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const adapter = createEngineAdapter(bundle);
// ★ 生产路径是 `validate()` 而不是 `simulate()` —— Fidelity 正是"跑之前就能看到"的那份报告。
//   （我第一版写成 simulate()，于是 res.fidelity 恒为 undefined；而我的探针
//    `fidelity === null ? "null" : "有"` 打印出了「有」—— 因为 undefined 也不等于 null。
//    **检查器错了和代码错了后果一样**，这是本 session 第 3 次。）
const res: any = await adapter.validate(canonicalMatch());
const f = res.fidelity;
{
  ok("★★★ 生产路径确实产出了 Fidelity 报告（不是 null 而显得干净）", !!f && !!f.klass, JSON.stringify(f && f.klass));
  const hits = scanForScores(f);
  ok("★★★ 报告里没有**任何**评分型字段（percent / score / rate / 真实性 / 总分 …）", hits.length === 0, JSON.stringify(hits));
  ok("★★★ 总体结论是**四态之一**，不是数字",
    typeof f.klass === "string" && Object.keys(FIDELITY_CLASS_LABEL).includes(f.klass), String(f.klass));
  const topNums = Object.entries(f).filter(([, v]) => typeof v === "number").map(([k]) => k);
  ok("★★★ 顶层唯一的数字字段是 schemaVersion（没有「总分」这类东西）",
    topNums.every(k => k === "schemaVersion"), JSON.stringify(topNums));
  ok("★★★ 五层各自的结论也都是**分类**而不是数字",
    Array.isArray(f.layers) && f.layers.length === 5 && f.layers.every((l: any) => typeof l.klass === "string"));
  ok("★★★ counts 的值一律是**字符串**（数字会被读成分数）",
    f.layers.every((l: any) => l.counts.every((c: any) => typeof c.value === "string")));
  console.log("    分类 " + f.klass + "｜五层 " + f.layers.map((l: any) => l.layer + ":" + l.klass).join(" ") +
    "｜评分型字段 " + hits.length);
}

sec("[2] ★★★ 免责声明必须随结果走，且点名这条禁令");
{
  ok("★★★ caveats 里点名不给百分比", f.caveats.some((c: string) => /不给「真实性百分比」/.test(c)), JSON.stringify(f.caveats.slice(0, 2)));
  ok("★★★ 而且说清了原因（覆盖率/编译率不能线性映射）", f.caveats.some((c: string) => /Capability Coverage|编译率/.test(c)));
  ok("★★ 理由给的是**逐条文字**，不是分数", Array.isArray(f.reasons) && f.reasons.every((r: string) => typeof r === "string"));
}

sec("[3] ★★★ 反向：这个扫描器真的会抓（不是只会说 OK）");
{
  const bad1 = scanForScores({ klass: "PARTIAL", fidelityPercent: 58.3 });
  ok("★★★ 合成一个 fidelityPercent 必须被抓", bad1.length === 1 && /fidelityPercent/.test(bad1[0]), JSON.stringify(bad1));
  const bad2 = scanForScores({ layers: [{ layer: "SKILL", score: 0.8 }] });
  ok("★★★ 藏进 layers 里的 score 也要抓", bad2.length === 1 && /layers\.0\.score/.test(bad2[0]), JSON.stringify(bad2));
  const bad3 = scanForScores({ layers: [{ layer: "SKILL", coverageRate: 58.3 }] });
  ok("★★★ 换个名字的覆盖率（coverageRate）也要抓", bad3.length === 1, JSON.stringify(bad3));
  const clean = scanForScores({ klass: "PARTIAL", layers: [{ layer: "SKILL", klass: "PARTIAL", bar: { filled: 3, total: 5 }, counts: [{ label: "x", value: "3 / 5" }] }] });
  ok("★★★ 但**条目进度条**（bar.filled / bar.total）不算违规 —— 不许误报", clean.length === 0, JSON.stringify(clean));
  ok("★★ 真实报告走同一个扫描器也是干净的（正反两用同一个函数）", scanForScores(f).length === 0);
}

sec("[4] ★★ 分类判据本身也不产出分数：四态是**枚举**，标签是文字");
{
  const labels = Object.values(FIDELITY_CLASS_LABEL) as string[];
  ok("★★ 四个分类各自有中文标签", labels.length === 4 && labels.every((x: string) => x.length > 0), JSON.stringify(labels));
  ok("★★★ 标签里**没有百分号**（否则就是把分类渲染成了分数）", labels.every((x: string) => !/%/.test(x)), JSON.stringify(labels));
  const fake: any = { units: [], ruleset: [], capabilities: [], displayPrecision: "EXACT" };
  const r0 = assessFidelity(fake);
  ok("★★ 空输入也不产出数字分（是 INSUFFICIENT 这类分类）", typeof r0.klass === "string" && scanForScores(r0).length === 0, JSON.stringify(r0.klass));
}

console.log("\n=== Fidelity 不给百分比: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
