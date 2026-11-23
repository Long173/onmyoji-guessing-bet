// tests/g44-parse-gate.ts — ★★ 源文件解析闸门（第 72 轮）
//
// 存在的理由是一类**具体的、我反复踩的**坑：在双引号字符串里再写一个 ASCII 双引号。
//   console.log(" 条此前被记成"缺占位符解析"，第 71 轮…");   ← 就这一行，文件直接不合法
// 第 71 轮一轮之内踩了**两次**，每次都靠"跑测试→语法错误→回去改"发现，代价是两次往返。
//
// ★ 为什么此前没有这道闸门：§48.8 试过一个「中文旁边有 ASCII 引号」的**启发式**，
//   54 个命中**全是注释里的误报**，于是当时决定不塞进套件。那个决定是对的 ——
//   错的不是"要不要查"，而是"用启发式查"。**现在用解析器查**：
//   Node 自己剥类型时用的就是那个解析器，误报率按构造就是 0。
//
// ★ 为什么值得单独一道闸门：本项目有 150+ 个 .ts，其中**没有任何测试 import 的文件**
//   如果写坏了，是**没有症状**的 —— 语法错误只在这个文件真的被加载时才爆。
//   这道闸门把"能不能解析"从"碰巧被 load 到"变成"每次跑套件都查"。
import fs from "node:fs";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";

// stripTypeScriptTypes 目前是 experimental，每次跑都会往 stderr 打一行警告。
// 它不是失败信号（退出码仍是 0），但会让套件输出变脏 —— 这里静音，而不是让读日志的人去分辨。
process.removeAllListeners("warning");

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SKIP_DIR = new Set(["node_modules", "dist", ".git", ".vite"]);

/** 收集一个根下的 .ts/.mts（不含 .d.ts）。返回绝对路径。 */
export function collect(root: string, out: string[] = []): string[] {
  if (!fs.existsSync(root)) return out;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (/\.(ts|mts)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** 核心：一段源码能不能被解析。返回 null = 能。 */
export function parseError(source: string): string | null {
  try { stripTypeScriptTypes(source, { mode: "strip" }); return null; }
  catch (e: any) { return String(e?.message ?? e).split("\n")[0].slice(0, 120); }
}

/** 扫一批文件，返回解析失败的清单。 */
export function scan(files: string[]): { file: string; msg: string }[] {
  const bad: { file: string; msg: string }[] = [];
  for (const f of files) {
    const msg = parseError(fs.readFileSync(f, "utf8"));
    if (msg) bad.push({ file: path.relative(ROOT, f).split(path.sep).join("/"), msg });
  }
  return bad;
}

const ROOTS = [
  path.join(ROOT, "battle-lab"),
  path.join(ROOT, "apps", "web", "src"),
  path.join(ROOT, "apps", "web", "tests"),
  path.join(ROOT, "apps", "web", "tools"),
];

sec("[1] ★★★ 全部源文件都能被解析（不只是被 import 到的那部分）");
const files = ROOTS.flatMap(r => collect(r));
const bad = scan(files);
console.log("    扫描 " + files.length + " 个 .ts/.mts（4 个根）");
ok("★★★ 样本不是空的（≥140 个文件；扫描器写坏了不会平凡通过）", files.length >= 140, "只找到 " + files.length + " 个");
ok("★★★ 已知文件确实在扫描范围里（防止根路径漂移后静默扫空）",
  files.some(f => f.endsWith(path.join("compile", "tips.ts"))) &&
  files.some(f => f.endsWith(path.join("engine", "assemble.ts"))) &&
  files.some(f => f.endsWith(path.join("tests", "g44-parse-gate.ts"))), "");
ok("★★★ 0 个文件解析失败", bad.length === 0,
  bad.slice(0, 5).map(b => b.file + " — " + b.msg).join(" ｜ "));

sec("[2] ★★★ 反向：这道闸门真的会抓（不是只会说 OK）");
ok("★★★ 坏源码（双引号里再套双引号）被抓",
  parseError('const a = 1;\nconsole.log(" 被记成"缺占位符"，第 71 轮");\n') !== null,
  String(parseError('const a = 1;\nconsole.log(" 被记成"缺占位符"，第 71 轮");\n')));
ok("★★ 好源码（同样的中文 + 合法引号）不被误报",
  parseError('const a = 1;\nconsole.log(" 被记成「缺占位符」，第 71 轮");\n') === null);
ok("★★ 纯类型注解（可擦除语法）不被误报",
  parseError("interface A { x: number }\nexport const f = (a: A): number => a.x;\n") === null);

// ★★ 端到端反向：写一个**真的坏文件**，让 collect+scan 走同一段代码
const tmp = fs.mkdtempSync(path.join(ROOT, "battle-lab", "tests", "_parsegate-"));
try {
  fs.writeFileSync(path.join(tmp, "broken.ts"), 'const a = 1;\nconsole.log(" 条此前被记成"缺占位符解析"。");\n', "utf8");
  const tFiles = collect(tmp);
  const tBad = scan(tFiles);
  ok("★★★ 端到端：临时坏文件被 collect+scan 报出来（走的是同一段代码）",
    tFiles.length === 1 && tBad.length === 1, JSON.stringify({ files: tFiles.length, bad: tBad.length }));
  fs.writeFileSync(path.join(tmp, "broken.ts"), 'const a = 1;\nconsole.log(" 条此前被记成「缺占位符解析」。");\n', "utf8");
  ok("★★★ 改回合法引号后，同一路径再次为 0（闸门跟着内容走，不是跟着文件名走）",
    scan(collect(tmp)).length === 0);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

sec("[3] ★ 这道闸门为什么值得存在（把理由钉在断言里）");
ok("★★ 第 71 轮我在同一个坑上栽了两次（写进名字，免得后人以为它是过度设计）", true);
ok("★★ 与 §48.8 那个被否掉的启发式**不是同一件事**：那个查文本形状，这个查语法",
  parseError("// 注释里出现 \" 引号也无所谓，注释是合法的") === null);

console.log("\n=== 源文件解析闸门: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
