// tests/g39-architecture-registry.ts — ★★ 架构登记册的可证伪性（第 65 轮）
//
// 第四张表（前三张：capability 48 / unmodeled 动词 / effects 28）也要过同一道关：
//   **声明本身不是实现** —— 每条都得有能被机器验证的把手，而且四态要互斥且穷尽：
//     ENFORCED         producer 必须能在生产代码里找到，且有验收测试
//     PARTIAL          producer 找得到，但**必须写清楚"为什么真实对局到不了"**
//     BY_OTHER_MEANS   producer 必须为 **null**（不假装有那个结构），
//                      且 insteadProducer（真正承担意图的那段代码）必须找得到
//     DEFERRED_BY_SPEC producer 必须为 null，且必须给出规格原话
//
// ★ 还有一条本轮新加的：**登记册里点名的测试文件，必须真的在报告的运行清单里**。
//   "有个测试文件"和"这个测试在跑"是两件事 —— 第 64 轮的教训就是"没有执行者的承诺"。
import fs from "node:fs";
import path from "node:path";
import { ARCHITECTURE } from "../kernel/architecture.ts";
import { producerScanFiles, stripComments, isDeclarationFile } from "../tools/field-census.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PROD = producerScanFiles(ROOT).map(f => ({ f: path.relative(ROOT, f).split(path.sep).join("/"), s: stripComments(fs.readFileSync(f, "utf8")) }));
/** 声明文件（effects.ts 这类表本身就是产物）—— 只有 where: DECLARATION 的条目才在这里找 */
const walk = (d: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (/node_modules|\.git|reference|_oas|_nga|experiments/.test(p)) continue; walk(p, out); }
    else if (/\.ts$/.test(e.name)) out.push(p);
  }
  return out;
};
const DECL = walk(path.join(ROOT, "battle-lab")).filter(isDeclarationFile)
  .map(f => ({ f: path.relative(ROOT, f).split(path.sep).join("/"), s: stripComments(fs.readFileSync(f, "utf8")) }));
const findIn = (set: typeof PROD, marker: string) => set.filter(x => x.s.includes(marker));
const REPORT = path.join(ROOT, "10-M1.9-全局战斗与真实性体系.md");

sec("[1] ★★ 表本身：每条都写清了声明与说明");
{
  ok("★ 条目数 = 目标 ⑨ 的清单（18 条，含 Summon/Environment/Soul 拆开）", ARCHITECTURE.length === 18, String(ARCHITECTURE.length));
  ok("★ key 不重复", new Set(ARCHITECTURE.map(a => a.key)).size === ARCHITECTURE.length);
  ok("★★ 每条都有 claim（目标原话）与 note（实际是什么）",
    ARCHITECTURE.every(a => a.claim.length > 4 && a.note.length > 20));
  ok("★ 四态取值合法", ARCHITECTURE.every(a => ["ENFORCED", "PARTIAL", "BY_OTHER_MEANS", "DEFERRED_BY_SPEC"].includes(a.status)));
  const byStatus: Record<string, number> = {};
  for (const a of ARCHITECTURE) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
  console.log("    " + Object.entries(byStatus).map(([k, v]) => k + " " + v).join("｜"));
}

sec("[2] ★★★ 四态的把手各自验证（两个方向都查）");
{
  const missingProducer: string[] = [], falseProducer: string[] = [], missingInstead: string[] = [];
  for (const a of ARCHITECTURE) {
    const set = a.where === "DECLARATION" ? DECL : PROD;
    if (a.status === "ENFORCED" || a.status === "PARTIAL") {
      if (!a.producer || findIn(set, a.producer).length === 0) missingProducer.push(a.key + " → " + a.producer);
    } else {
      // BY_OTHER_MEANS / DEFERRED_BY_SPEC：**不许**假装自己有那个结构
      if (a.producer !== null) falseProducer.push(a.key + " 声明 " + a.status + " 却给了 producer");
      if (a.status === "BY_OTHER_MEANS" && (!a.insteadProducer || findIn(PROD, a.insteadProducer).length === 0)) {
        missingInstead.push(a.key + " → " + a.insteadProducer);
      }
    }
  }
  ok("★★★ ENFORCED / PARTIAL 的 producer 都能在生产代码里找到", missingProducer.length === 0, JSON.stringify(missingProducer));
  ok("★★★ BY_OTHER_MEANS / DEFERRED_BY_SPEC **不许**有 producer（否则就是在假装有那个结构）",
    falseProducer.length === 0, JSON.stringify(falseProducer));
  ok("★★★ BY_OTHER_MEANS 必须指出真正承担意图的那段代码，且它找得到", missingInstead.length === 0, JSON.stringify(missingInstead));
  // ★ 对照：Declaration 那条确实是靠 where: DECLARATION 才找到的（否则它会是个假红）
  const decl = ARCHITECTURE.find(a => a.where === "DECLARATION")!;
  // ★★ 先钉住"登记册自己也是声明文件" —— 第 65 轮建这张表时忘了登记它，
  //   结果它的 producer 字段把自己匹配上了（与第 56 轮 effects.ts 一模一样的坑，第二次发作）。
  ok("★★★ 登记册自己必须被登记为声明文件（否则它会污染生产集合）",
    isDeclarationFile(path.join(ROOT, "battle-lab", "kernel", "architecture.ts")) &&
    !PROD.some(x => x.f.endsWith("kernel/architecture.ts")), "architecture.ts 出现在生产集合里");
  const inProd = findIn(PROD, decl.producer!).length, inDecl = findIn(DECL, decl.producer!).length;
  ok("★★ where: DECLARATION 的条目在生产集合里**找不到**、在声明集合里找得到（说明这个字段不是装饰）",
    inProd === 0 && inDecl > 0, decl.key + "：生产命中 " + inProd + "｜声明命中 " + inDecl + "｜声明文件集合 " + DECL.length + " 个");
}

sec("[3] ★★★ 非 ENFORCED 的每一条都必须把「为什么」写出来");
{
  const bad: string[] = [];
  for (const a of ARCHITECTURE) {
    if (a.status === "PARTIAL" && (a.whyPartial ?? "").trim().length < 20) bad.push(a.key + " PARTIAL 但没写 whyPartial");
    if (a.status === "DEFERRED_BY_SPEC" && (a.specQuote ?? "").trim().length < 10) bad.push(a.key + " DEFERRED 但没给规格原话");
  }
  ok("★★★ PARTIAL 都写了 whyPartial、DEFERRED 都给了规格原话", bad.length === 0, JSON.stringify(bad));
  const partials = ARCHITECTURE.filter(a => a.status === "PARTIAL");
  console.log("    PARTIAL（有代码、真实对局到不了）：");
  for (const p of partials) console.log("      · " + p.key + "：" + (p.whyPartial ?? "").slice(0, 78) + "…");
  for (const d of ARCHITECTURE.filter(a => a.status === "DEFERRED_BY_SPEC")) console.log("      · " + d.key + "（规格自己推迟）：" + (d.specQuote ?? "").slice(0, 60) + "…");
}

sec("[4] ★★★ 点名的测试文件必须存在，而且**真的在运行清单里**");
{
  const report = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, "utf8") : "";
  ok("★ 前置：读到了报告（否则下面会平凡通过）", report.length > 10000, String(report.length));
  /**
   * ★★★ 必须**只取 §11「怎么跑」那一节**再来找文件名。
   *   第一版写的是 `report.includes(文件名)` —— 而报告有四千行，文件名在正文里到处都是，
   *   于是这条断言实际上只证明"报告里提过它"，不证明"它在运行清单里"。
   *   这跟第 62 轮拆掉的那条形状断言是同一个毛病：**断言的名字比它查的东西大**。
   */
  const start = report.indexOf("## 11. 怎么跑");
  const end = report.indexOf("\n## ", start + 10);
  const runList = start < 0 ? "" : report.slice(start, end < 0 ? report.length : end);
  ok("★★ 前置：切出了 §11 运行清单这一节", runList.includes("cd battle-lab") && runList.length < 8000, String(runList.length));
  const missingFile: string[] = [], notRun: string[] = [];
  for (const a of ARCHITECTURE) {
    if (!a.test) continue;
    if (!fs.existsSync(path.join(ROOT, "battle-lab", a.test))) { missingFile.push(a.key + " → " + a.test); continue; }
    // 运行清单（**只有 §11 那一节**）里应当出现这个文件名
    const base = a.test.split("/").pop()!;
    if (!runList.includes(base)) notRun.push(a.key + " → " + base);
  }
  ok("★★ 点名的测试文件都存在", missingFile.length === 0, JSON.stringify(missingFile));
  ok("★★★ 点名的测试都出现在运行清单里（文件存在 ≠ 它在跑）", notRun.length === 0, JSON.stringify(notRun));
  const noTest = ARCHITECTURE.filter(a => !a.test).map(a => a.key);
  ok("★ 没有测试的条目只允许出现在非 ENFORCED 里",
    ARCHITECTURE.filter(a => !a.test && a.status === "ENFORCED").length === 0, JSON.stringify(noTest));
  console.log("    有验收测试 " + ARCHITECTURE.filter(a => a.test).length + " / " + ARCHITECTURE.length +
    "；无测试：" + (noTest.join("、") || "（无）"));
}

console.log("\n=== 架构登记册自检: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
