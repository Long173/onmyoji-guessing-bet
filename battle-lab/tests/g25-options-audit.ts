// tests/g25-options-audit.ts — ★ 审计工具本身必须被验证（第 32 轮）
//
// 由来：第 31 轮发现 assembleGuessingMatch 的 opts 里没有 policies、函数体却把候选写死，
// 于是 8 个组合跑出同一份结果。为了把这类"声明了却没人读的选项"变成机械检查，
// 这一轮写了 tools/options-audit.ts —— 然后它在自己的第一版里重犯了第 23 轮 field-census 的错：
//   **按行扫对象类型**，于是 `{ used?: number; never?: string }` 这种单行写法只认得出第一个字段，
//   「漏读的字段」只要和别的字段同行就永远查不出来。一个会漏报的审计比没有审计更糟 ——
//   它会让人以为"查过了，没问题"。
//
// 所以本测试两头都锁：**能抓到真缺口**，也**不会冤枉正确写法**。
import { collect } from "../tools/options-audit.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const run = (src: string) => collect([{ path: "fixture.ts", src }]);

sec("[1] ★★ 必须能抓到真缺口（否则整个审计是空转）");
{
  const one = run("export function f(opts: { used?: number; never?: string }) {\n  return opts.used ?? 0;\n}\n");
  ok("★★ 单行多字段里漏读的那个被抓到", one.gaps.length === 1 && one.gaps[0].field === "never", JSON.stringify(one.gaps.map(g => g.field)));
  ok("★ 读过的那个不被报", !one.gaps.some(g => g.field === "used"));

  const multi = run([
    "export function g(opts: {",
    "  a?: number;",
    "  b?: string;",
    "  c?: boolean;",
    "}) {",
    "  return opts.a;",
    "}",
  ].join("\n"));
  ok("★★ 多行多字段：两个漏读的都被抓到", multi.gaps.length === 2 && ["b", "c"].every(f => multi.gaps.some(g => g.field === f)), JSON.stringify(multi.gaps.map(g => g.field)));

  // 形参名要用真实的配置命名（cfg/opts…）：审计**刻意**只查这类名字，避免把数据参数也扫进来。
  // 第一版这里写的是 h(o: Cfg)，于是它被"故意不查"的规则跳过 —— 是测试写错了，不是工具错了。
  const iface = run([
    "export interface Cfg { x?: number; y?: number }",
    "export function h(cfg: Cfg) { return cfg.x; }",
  ].join("\n"));
  ok("★ 具名 interface 的字段同样被检查", iface.gaps.length === 1 && iface.gaps[0].field === "y", JSON.stringify(iface.gaps.map(g => g.field)));
}

sec("[2] ★★ 不能冤枉正确写法（乱叫的审计会被无视）");
{
  ok("都读了 → 无缺口", run("export function f(opts: { a?: number; b?: string }) {\n  return (opts.a ?? 0) + (opts.b ?? \"\").length;\n}\n").gaps.length === 0);
  ok("解构读取 → 无缺口", run("export function f(opts: { a?: number; b?: number }) {\n  const { a, b } = opts;\n  return a + b;\n}\n").gaps.length === 0);
  const merged = run("export function f(opts: { a?: number; b?: number }) {\n  const o = { x: 1, ...opts };\n  return o;\n}\n");
  ok("★ `{...opts}` 合并 → 归入「合并/转发」，不算缺口也不算已验证", merged.gaps.length === 0 && merged.merged.length === 2, JSON.stringify({ gaps: merged.gaps.length, merged: merged.merged.length }));
  ok("★ 数据参数（形参名不是 opts/cfg…）不被检查", run("export function f(a: ObsFrame) {\n  return a.kind;\n}\n").fields.length === 0);
  ok("★ 数组参数不被检查（那是数据列表）", run("export function f(cfgs: Item[]) {\n  return cfgs.length;\n}\n").fields.length === 0);
  ok("跨文件类型如实计入 uncovered（不假装查过）", run("export function f(opts: SomeExternalOpts) {\n  return 1;\n}\n").uncovered === 1);
}

sec("[3] 共享选项类型：只要有一个使用方读过，就不是缺口");
{
  const shared = run([
    "export interface Opts { alias?: string; tolerance?: number }",
    "function helper(f: string, o: Opts) { return f + (o.alias ?? \"\"); }",
    "export function main(items: string[], options: Opts) { return items.map(i => helper(i, options)).length + (options.tolerance ?? 1); }",
  ].join("\n"));
  ok("★ 辅助函数只读一部分不算缺口（别名被读到即可）", shared.gaps.length === 0, JSON.stringify(shared.gaps.map(g => g.field)));
  const lonely = run([
    "export interface Opts { alias?: string; unusedOne?: number }",
    "export function main(options: Opts) { return options.alias ?? \"\"; }",
  ].join("\n"));
  ok("★ 但谁都没读的字段仍然要报", lonely.gaps.length === 1 && lonely.gaps[0].field === "unusedOne", JSON.stringify(lonely.gaps.map(g => g.field)));
}

sec("[4] 拿真实代码库复跑：当前应当没有缺口（上一轮已修）");
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const BL = path.join(ROOT, "battle-lab");
  const walk = (d: string, acc: string[] = []): string[] => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, acc); else if (p.endsWith(".ts")) acc.push(p);
    }
    return acc;
  };
  const isScaffold = (f: string) => /[\\/](tests|tools|experiments)[\\/]/.test(f);
  const files = [...walk(BL).filter(f => !isScaffold(f)), ...walk(path.join(ROOT, "apps", "web", "src"))];
  const r = collect(files.map(f => ({ path: path.relative(ROOT, f), src: fs.readFileSync(f, "utf8") })));
  console.log("    扫描 " + files.length + " 个文件｜配置字段 " + r.fields.length + "｜缺口 " + r.gaps.length + "｜合并/转发 " + r.merged.length + "｜跨文件未追 " + r.uncovered);
  ok("★ 真实代码库里没有「声明了却没人读」的选项字段", r.gaps.length === 0, JSON.stringify(r.gaps.map(g => g.typeKey + "." + g.field)));
  ok("★ 确实扫到了一批字段（不是 0 个而显得「干净」）", r.fields.length >= 10, String(r.fields.length));
  ok("★★ 上一轮修掉的 assembleGuessingMatch 仍然带着 policies（回归锁）",
    fs.readFileSync(path.join(BL, "soul", "guessing-match.ts"), "utf8").includes("opts.policies"));
}

console.log("\n=== 选项审计工具自检: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;