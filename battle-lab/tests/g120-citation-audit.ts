// tests/g120-citation-audit.ts — ★★★ 第 241 轮：**报告引用的路径必须解析得到**（常驻闸门）
//
// 由来：第 215 轮做过一次审计（结论 219/219、缺失 0），但那是**一次性脚本** —— 没留在仓库里，
//   于是第 238 轮又冒出 `runner/diff-cli.ts` 这种引用。第 241 轮把它做成仪器（tools/citation-audit.ts）+ 尺子（本文件）。
// 判据三级：候选根命中 / 全路径后缀命中 / （**不带斜杠**时）全仓基名命中；带斜杠的引用不许只靠基名蒙混（那是"目录写错"）。
// 反向对照：合成一份"引用了一个不存在的路径"的文档 ⇒ 必须报缺失；合成一份"明写已删除"的文档 ⇒ 必须放行。
import fs from "node:fs";
import path from "node:path";
import { auditCitations } from "../tools/citation-audit.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const MAIN = "10-M1.9-全局战斗与真实性体系.md";

sec("[1] ★★★ 主报告：每一个反引号路径引用都能解析到磁盘");
const r = auditCitations([MAIN]);
{
  ok("★★★ 解析不到 = 0（引用共 " + r.total + " 处）", r.missing.length === 0, JSON.stringify(r.missing.slice(0, 8)));
  ok("★★ 引用总数是个真数（> 500）—— 抽出器坏掉时这条会红，而不是「0 处引用所以 0 缺失」", r.total > 500, String(r.total));
}

sec("[2] ★★★ 反向对照：合成文档里的死引用必须被抓住，合规的两种写法必须放行");
{
  const rel = "battle-lab/tools/_tmp-citation-neg.md";
  const abs = path.join(ROOT, rel);
  fs.writeFileSync(abs, [
    "正常引用：`kernel/state.ts` 与裸文件名 `presenter.ts`。",
    "死引用：`kernel/definitely-missing-xyz.ts`。",
    "合规（明写已佚）：旧探针 `_probe-gone-xyz.ts` 已删除。",
    "拼写错的目录：`theatre/definitely-missing-abc.ts`。",
  ].join("\n") + "\n", "utf8");
  const neg = auditCitations([rel]);
  fs.unlinkSync(abs);
  const refs = neg.missing.map((m: any) => m.ref);
  ok("★★★ 死引用被抓（1 个路径级 + 1 个目录拼写级）", refs.includes("kernel/definitely-missing-xyz.ts") && refs.includes("theatre/definitely-missing-abc.ts"), JSON.stringify(refs));
  ok("★★★ 合规的两种写法**不报**：真实存在的裸文件名（presenter.ts）与明写「已删除」的探针", !refs.includes("presenter.ts") && !refs.includes("_probe-gone-xyz.ts"), JSON.stringify(refs));
  ok("★★ 而且只报 2 处（不许多报 —— 多报会把真缺口淹掉）", neg.missing.length === 2, String(neg.missing.length));
}

console.log("\ng120-citation-audit: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);