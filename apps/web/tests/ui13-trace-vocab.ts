// tests/ui13-trace-vocab.ts — ★★★ 第 106 轮：**trace 词汇的对齐闸门**（目标 ⑥/⑦/①）
//
// 由来：机制一直在加（放置单位 / 偷取 / 免疫 / 吸血 / 免死 / 反击 / 锁条 / 抵抗…），
// 而 Theater 的 Presenter 只认得其中一部分 —— 新机制在剧场里**只剩一个没有解释的空条目**。
// 「什么都没发生」与「发生了但没渲染」在画面上是一样的，所以这条必须**机械守**：
//   引擎（+ 适配器）发出的每一种 trace 类型，要么 Presenter 有 case，要么在下面的允许清单里**写明理由**。
//
// ★ 判据两侧都做：允许清单不许有僵尸条目（已经标注了、或已经没人发了）；
//   而且抽取器本身要能被证伪（合成一段代码，它必须抽得出来）。
import fs from "node:fs";
import path from "node:path";
// ★ 第 137 轮：观测档位映射（原来它只是适配器里的两个字符串字面量，没有任何断言）
import { traceLevelFor } from "../src/adapters/engine-adapter.ts";
import { createEngineAdapter } from "../src/adapters/engine-adapter.ts";
import { canonicalMatch } from "../src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const here = import.meta.dirname;
const ROOT = path.resolve(here, "..", "..", "..");

/** 从一段源码里抽出所有 trace 产出点的类型名（导出出来是为了让自检能喂合成输入） */
export function extractTraceTypes(src: string): string[] {
  const RE = /trace\??\.push\??\.?\(\{?\s*t:\s*"([A-Za-z_]+)"/g;
  return [...src.matchAll(RE)].map(m => m[1]);
}
/** 从 Presenter 里抽出所有 case 标签 */
export function extractLabels(src: string): string[] {
  return [...src.matchAll(/case\s+"([A-Za-z_]+)"/g)].map(m => m[1]);
}

/**
 * ★ 允许清单：**不渲染到 Banner 但必须写明理由**的类型。
 * 判据不是「渲染不渲染」，而是「看不见的时候有没有解释」。
 */
export const UNLABELED_OK: Record<string, string> = {
  TURN_TYPE: "回合类型（NORMAL/NEW_TURN/…）是**结构性**信息：Theater 由视图模型的 turnType 字段呈现，不占 Banner 条目",
  ORB_INIT: "开局鬼火初始化：初始值已经显示在鬼火条上，再报一条是重复",
  AI_TARGET: "AI 选目标：属于 **G5 Inspector** 的职责（aiDecision 直接读这些帧），Banner 只呈现技能",
};

const walk = (d: string, skip: string[], acc: string[] = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".") || skip.includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, skip, acc); else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
};
const presenterPath = path.join(here, "..", "src", "theater", "presenter.ts");
// presenter.ts + the betting-kit cases split out of it (theater/betting-banner.ts)
const presenterSrc = fs.readFileSync(presenterPath, "utf8") + "\n" + fs.readFileSync(path.join(here, "..", "src", "theater", "betting-banner.ts"), "utf8");
const labeled = new Set(extractLabels(presenterSrc));
const emitted = new Set<string>();
const where = new Map<string, string>();
for (const f of [...walk(path.join(ROOT, "battle-lab"), ["tests", "tools", "fixtures"]),
                   ...walk(path.join(ROOT, "apps", "web", "src"), ["tests"])]) {
  for (const t of extractTraceTypes(fs.readFileSync(f, "utf8"))) {
    emitted.add(t);
    if (!where.has(t)) where.set(t, path.relative(ROOT, f).replace(/\\/g, "/"));
  }
}

sec("[1] 抽取器自检（合成输入两侧都验）")
{
  ok("★ 单行 trace.push 抽得到", extractTraceTypes('this.trace.push({ t: "DAMAGE", id: 1 });').join() === "DAMAGE");
  ok("★★ 可选调用 + 跨行也抽得到（第 98–105 轮的写法正是这种）",
    extractTraceTypes('battle?.trace?.push?.({\n    t: "SUMMON_CREATE", owner: 1,\n  });').join() === "SUMMON_CREATE");
  ok("★★ 反向：普通对象里的 t: D 不算 trace（否则判定会被枚举值污染）",
    extractTraceTypes('const v = { t: "CANDIDATE", family: "x" };').length === 0);
  ok("★ Presenter case 抽得到", extractLabels('case "DAMAGE":\ncase "HEAL":').join() === "DAMAGE,HEAL");
}

sec("[2] 前置：两边都真的抽到东西")
{
  ok("★★ 引擎发出的 trace 类型 ≥ 50 种（抽不到就是抽取器坏了，不是「没人发」）", emitted.size >= 50, String(emitted.size));
  ok("★★ Presenter 的 case ≥ 50 个（第 106 轮补齐后）", labeled.size >= 50, String(labeled.size));
}

sec("[3] ★★★ 每一种 trace 要么有 Banner，要么在允许清单里写明理由")
{
  const missing = [...emitted].filter(t => !labeled.has(t) && !(t in UNLABELED_OK)).sort();
  ok("★★★ 没有「发得出、又不渲染、又没理由」的类型", missing.length === 0,
    JSON.stringify(missing.map(t => t + " @" + where.get(t))));
  if (missing.length) for (const t of missing) console.log("      · " + t + "  ← " + where.get(t));
  console.log("    引擎发出 " + emitted.size + " 种｜Presenter 有 case " + labeled.size + " 种｜允许不渲染 " + Object.keys(UNLABELED_OK).length + " 种");
}

sec("[4] ★★★ 反向：允许清单不许有僵尸条目")
{
  const zombie = Object.keys(UNLABELED_OK).filter(t => labeled.has(t) || !emitted.has(t));
  ok("★★★ 允许清单里的每一条都仍然是合法豁免（没被标注、也确实还有人发）", zombie.length === 0, JSON.stringify(zombie));
  const noReason = Object.entries(UNLABELED_OK).filter(([, v]) => !v || v.length < 12).map(([k]) => k);
  ok("★★ 每条豁免都写了理由（不接受占位）", noReason.length === 0, JSON.stringify(noReason));
}

sec("[5] ★★ 第 98–105 轮新增的机制，在 Banner 上必须看得见")
{
  const recent = ["SUMMON_CREATE", "FORM_ENTER", "SEAL", "PLACE_ON_KILL", "STATUS_STEAL", "LINK_END"];
  ok("★★★ 这些机制都有 Banner（否则这一轮白做）",
    recent.every(t => labeled.has(t)), JSON.stringify(recent.filter(t => !labeled.has(t))));
}

sec("[6] ★★★ 观测档位（Trace Level）：运行模式 → NONE / FULL 的映射必须有断言")
{
  /**
   * 审核（第 137 轮）的结论：引擎侧三档**做到了**（g2/g20 断言了三档的胜负/回合/指纹/全部统计一致、
   * 观测工作量严格递增、挂 recorder 也不能越档），但适配器侧那句映射谁都没断言过 ——
   * 它原来就是两处字符串字面量。现在映射是一个可调用的纯函数（engine-adapter.traceLevelFor）。
   */
  ok("★★★ 批量模拟（胜率）用 NONE —— 1 万局不需要事件流", traceLevelFor("batch") === "NONE", traceLevelFor("batch"));
  ok("★★★ 观看一场用 FULL —— Theater 要拖到任意一帧，必须有事件流 + 逐帧快照", traceLevelFor("watch") === "FULL", traceLevelFor("watch"));
  ok("★★ 两向：这两个模式给出的档位**必须不同**（写成一个值就等于没有分档）", traceLevelFor("batch") !== traceLevelFor("watch"));
  const adapter = fs.readFileSync(path.join(here, "..", "src", "adapters", "engine-adapter.ts"), "utf8");
  const code = adapter.split("\n").filter((l: string) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
  ok("★★★ 适配器里不再有第二处档位字面量（两处调用点都走这个函数）",
    (code.match(/traceLevel:/g) ?? []).length === 2 && (code.match(/traceLevel: traceLevelFor\("/g) ?? []).length === 2,
    JSON.stringify((code.match(/traceLevel:[^,}]*/g) ?? [])));
  ok("★★ 观看一场那条路仍然挂 recorder（只有 FULL 才产快照 —— 不挂 recorder 就没有帧可拖）",
    /traceLevelFor\("watch"\), recorder/.test(code));
  // 真跑一遍「观看一场」：它必须产出一份**有帧、且末帧状态与终局一致**的录像（档位映射的下游证据）
  const bundle = JSON.parse(fs.readFileSync(path.join(here, "..", "src", "engine", "bundle.json"), "utf8"));
  const r: any = await createEngineAdapter(bundle).replay(canonicalMatch(), 4242);
  ok("★★★ 观看一场真的产出了可播放的录像（帧数 > 0 且带终局指纹）",
    !!r.replay && (r.replay.frames ?? []).length > 0 && typeof r.replay.finalHash === "string",
    JSON.stringify({ frames: (r.replay?.frames ?? []).length, hash: r.replay?.finalHash }));
}

console.log(`\n══════════════════════════════════`);
console.log(`UI-13 trace 词汇对齐：${pass} 通过 / ${fail} 失败`);
console.log(`══════════════════════════════════`);
if (fail > 0) process.exit(1);
