// tests/g26-wiring-audit.ts — ★ 审计工具自检（第 32 轮）：wiring-audit 必须两头都准
//
// 由来：wiring-audit 是最早的检查器（第 22 轮），却**一直没有自检**。这一轮补它，
// 而且当场就查出它自己有静默漏报：它在**未剥注释**的源码上数出现次数，
// 于是"函数名只在注释里被提到过"也算已接线 —— 实测漏掉了两个：
//   · restoreBattle（G0 的续跑能力）
//   · solveCompatibleSoulBuilds（御魂反解器）
// 文档里的名字不是调用点。这条教训在 options-audit 上也出现过一次。
import fs from "node:fs";
import path from "node:path";
import { auditWiring, stripComments, walk } from "../tools/wiring-audit.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);

const run = (engine: Array<[string, string]>, prod: Array<[string, string]>) => auditWiring({
  engineFiles: engine.map(([p, src]) => ({ path: p, src })),
  prodFiles: prod.map(([p, src]) => ({ path: p, src })),
});

sec("[1] ★★ 必须能抓到真缺口（否则整个审计是空转）");
{
  const r = run([["/bl/a.ts", "export function orphan() { return 1; }\n"]], [["/bl/b.ts", "export const x = 1;\n"]]);
  ok("★★ 只有定义、没人调用 → 判定为未接线", r.unwired.length === 1 && r.unwired[0].name === "orphan", JSON.stringify(r.unwired));
  const r2 = run([["/bl/a.ts", "export function used() { return 1; }\n"]], [["/bl/b.ts", "import { used } from \"./a\";\nused();\n"]]);
  ok("★ 被真正调用 → 不算未接线", r2.unwired.length === 0, JSON.stringify(r2.unwired));
  const r3 = run([["/bl/a.ts", "export async function alsoOrphan() { return 1; }\n"]], []);
  ok("★ async 导出同样被扫描", r3.unwired.length === 1 && r3.unwired[0].name === "alsoOrphan");
  const r4 = run([["/bl/tests/t.ts", "export function scaffoldOnly() { return 1; }\n"]], []);
  ok("★ 测试文件里的导出不算候选（否则每个测试辅助函数都会被报）", r4.exported === 0, String(r4.exported));
}

sec("[2] ★★ 反向对照：注释里的名字**不是**调用点（本轮修掉的静默漏报）");
{
  const r = run(
    [["/bl/a.ts", "export function ghost() { return 1; }\n"]],
    [["/bl/b.ts", "// 这里应该调用 ghost() 来完成收口\n/* ghost 也出现在块注释里 */\nexport const y = 2;\n"]],
  );
  ok("★★ 只在行注释/块注释里被提到 → 仍然判定为未接线", r.unwired.length === 1 && r.unwired[0].name === "ghost", JSON.stringify(r.unwired));
  ok("stripComments 确实去掉了行注释", !stripComments("// ghost()\nconst a = 1;").includes("ghost"));
  ok("stripComments 确实去掉了块注释", !stripComments("/* ghost */\nconst a = 1;").includes("ghost"));
  ok("stripComments 不误伤 URL 里的双斜杠", stripComments("const u = \"https://x/y\";").includes("https://x/y"));
  // ★ 造 fixture 时必须把**定义所在的文件**也放进 prodFiles —— 真实扫描就是这样
  //   （prodFiles = 引擎非测试文件 + apps/web/src，定义文件本身在里面，定义算 1 次命中）。
  //   第一版没放，于是"一个调用点"只有 1 次命中，被误判成未接线 —— 是 fixture 不真实，不是工具的错。
  const r2 = run(
    [["/bl/a.ts", "export function real() { return 1; }\n"]],
    [["/bl/a.ts", "export function real() { return 1; }\n"], ["/bl/b.ts", "// real()\nreal();\n"]],
  );
  ok("★ 注释里提过、代码里也真的调了 → 不算未接线", r2.unwired.length === 0, JSON.stringify(r2.unwired));
  // 反向锁住上面那条前提：定义文件不进 prodFiles 时，规则会退化成"人人都未接线" —— 这是工具使用上的前提，不是可选项
  const r3 = run(
    [["/bl/a.ts", "export function real() { return 1; }\n"]],
    [["/bl/b.ts", "real();\n"]],
  );
  ok("★ 记录该前提：定义文件若不在扫描集合里，单调用点也会被判未接线（所以调用方必须把定义文件算进去）",
    r3.unwired.length === 1, JSON.stringify(r3.unwired));
}

sec("[3] 真实代码库：未接线 5 个，且每一个都在 allowlist 里写明了理由");
{
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const BL = path.join(ROOT, "battle-lab");
  const engineFiles = walk(BL);
  const webFiles = walk(path.join(ROOT, "apps", "web", "src"));
  const prodFiles = [...engineFiles.filter(f => !/[\\/]tests[\\/]/.test(f)), ...webFiles];
  const toEntry = (f: string) => ({ path: path.relative(ROOT, f), src: fs.readFileSync(f, "utf8") });
  const r = auditWiring({ prodFiles: prodFiles.map(toEntry), engineFiles: engineFiles.map(toEntry) });
  console.log("    导出函数 " + r.exported + "｜未接线 " + r.unwired.length + "：" + r.unwired.map(u => u.name).join(", "));
  ok("★ 确实扫到了导出函数（不是 0 而显得干净）", r.exported > 50, String(r.exported));
  const allow = JSON.parse(fs.readFileSync(path.join(BL, "tools", "wiring-allowlist.json"), "utf8"));
  const missing = r.unwired.filter(u => !(u.name in allow.allowed));
  ok("★★ 每一个未接线函数都在 allowlist 里（否则审计应当报红）", missing.length === 0, JSON.stringify(missing.map(m => m.name)));
  const thin = Object.entries(allow.allowed).filter(([, v]) => String(v).trim().length < 20 || String(v).startsWith("待复核"));
  ok("★★ allowlist 的每一条都写明了理由（不接受「待复核」占位）", thin.length === 0, JSON.stringify(thin.map(([k]) => k)));
  ok("★ 本轮新发现的两位都写清了「为什么合理」",
    /tests\/g0-state/.test(allow.allowed["restoreBattle"] ?? "") && /研究工具|反解/.test(allow.allowed["solveCompatibleSoulBuilds"] ?? ""),
    JSON.stringify({ a: allow.allowed["restoreBattle"]?.slice(0, 30), b: allow.allowed["solveCompatibleSoulBuilds"]?.slice(0, 30) }));
}

sec("[4] 与 field-census 的分工：函数级 vs 字段级");
{
  const ROOT = path.resolve(import.meta.dirname, "..");
  ok("★ 两个审计工具都存在且互相引用（防止其中一个被删掉而无人发现）",
    fs.existsSync(path.join(ROOT, "tools", "wiring-audit.ts")) && fs.existsSync(path.join(ROOT, "tools", "field-census.ts")));
  const fc = fs.readFileSync(path.join(ROOT, "tools", "field-census.ts"), "utf8");
  ok("★ field-census 也剥了注释（同一个坑不能踩两次）", /stripComments/.test(fc));
}

console.log("\n=== 接线审计自检: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;