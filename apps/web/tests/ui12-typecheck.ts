// tests/ui12-typecheck.ts — ★★★ 把 vue-tsc 放进套件（第 63 轮）
//
// 由来：第 63 轮的词汇普查发现了几处「类型联合 + 标签表」的配对
// （presenter 的 state 联合 / EntityCard 的 STATE_LABEL、observations 的来源与置信度）。
// 这类漂移的**正确防线是类型系统**：把标签表写成闭合 Record<联合, string>，
// 联合多一个成员而表没跟上 ⇒ 编译错误。
//
// ★ 但那句"类型系统会拦住它"有前提：**有人真的跑类型检查**。
//   apps/web/package.json 里一直有 typecheck: vue-tsc --noEmit，但**测试套件从不跑它** ——
//   于是"TS 会抓到"就成了一句无人执行的承诺，与第 57 轮之前那句"复活没有调用方"同类：
//   写在纸上，没有任何东西在跑。
//   这个文件把那句话变成套件里的一条断言（实测 3.5 秒）。
//
// ★★ 而且它自己也要能自证伪：本文件会**临时写一个故意缺键的探针文件**，
//   确认 vue-tsc 真的会为"闭合 Record 缺键"报错，然后删掉它。
//   不做这一步，这条断言只证明"当前没有类型错误"，不证明"这类错误会被抓住"。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const WEB = path.resolve(import.meta.dirname, "..");
const TSC = path.join(WEB, "node_modules", "vue-tsc", "bin", "vue-tsc.js");
const PROBE = path.join(WEB, "src", "__typecheck_probe.ts");

const runTsc = () => spawnSync(process.execPath, [TSC, "--noEmit"], { cwd: WEB, encoding: "utf8" });

sec("[1] ★★ 前置：类型检查这一步真的存在（否则下面全是平凡通过）");
ok("★ vue-tsc 可执行文件在 node_modules 里", fs.existsSync(TSC), TSC);
ok("★ package.json 里仍然挂着 typecheck 脚本",
  /"typecheck"\s*:/.test(fs.readFileSync(path.join(WEB, "package.json"), "utf8")));

sec("[2] ★★★ 当前代码库：0 个类型错误");
{
  const r = runTsc();
  const out = String(r.stdout ?? "") + String(r.stderr ?? "");
  ok("★★★ vue-tsc --noEmit 通过（exit 0）", r.status === 0, "exit=" + r.status + "｜" + out.slice(-300));
  ok("★★ 输出里没有 error TS", !/error TS\d+/.test(out), out.slice(-300));
}

sec("[3] ★★★ 自证伪：闭合 Record 缺键，vue-tsc 必须报错");
{
  // 这正是第 61/63 轮的 bug 形状：联合多一个成员，标签表没跟上。
  const bad = [
    "// 临时探针（tests/ui12-typecheck.ts 自动删除）：故意缺一个键",
    'import type { UnitView } from "./theater/presenter.ts";',
    'export const BAD: Record<UnitView["state"], string> = {',
    '  ALIVE: "存活", HP_ZERO: "HP≤0", DEAD: "已阵亡", KILLED: "被击败",',
    "};",
    "",
  ].join("\n");
  fs.writeFileSync(PROBE, bad, "utf8");
  try {
    const r = runTsc();
    const out = String(r.stdout ?? "") + String(r.stderr ?? "");
    ok("★★★ 缺键时报错（exit ≠ 0）", r.status !== 0, "exit=" + r.status);
    ok("★★★ 报的正是缺的那个键 TRANSFORMED", /TRANSFORMED/.test(out), out.slice(-400));
    ok("★★ 报错信息指向探针文件（不是别处）", /__typecheck_probe/.test(out), out.slice(-200));
  } finally {
    fs.unlinkSync(PROBE);
  }
  const r2 = runTsc();
  ok("★★ 删掉探针后回到干净（不给仓库留垃圾）", r2.status === 0, "exit=" + r2.status);
  ok("★ 探针文件确实被删掉了", !fs.existsSync(PROBE));
}

console.log("\n=== 类型检查: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
