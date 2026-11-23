// tests/g113-rounding-lint.ts — ★★★ 第 191 轮：**取整不许散落**这条规矩，第一次真的有人守着
//
// 由来：tools/lint-rounding.ts 是第 2x 轮留下的审计工具，规则写得很清楚
//   （「除 kernel/gamemath.ts 外，全项目禁止 Math.floor / Math.round / parseInt」，
//    理由：游戏自己的取整点未知，散落的取整会污染中间结果且**无法一次性替换**）——
//   但它**没有任何测试跑它**，而且长期以 exit=1 收场（12 处命中）。
//   于是这条规矩实际上处于「写着、但没人守」的状态 —— 正是本仓库反复抓的那类静默。
//
// 第 191 轮两件事一起做：
//   ① 数值路径上的 10 处改成 GameMath.roundAt(v, "命名取整点") —— 与 Math.round **逐位等价**
//      （所以两个指纹常量逐位不变），区别只是取整点从此**可枚举、可整体替换**；
//   ② 剩下 2 处（指纹量化 / rng 整数抽样）进 tools/rounding-allowlist.json，每条写明理由。
import fs from "node:fs";
import path from "node:path";
import { scanRounding, roundingKey } from "../tools/lint-rounding.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");

sec("[1] ★★★ 扫描结果：0 处未说明，3 处已说明（每处都有理由）");
const r = await scanRounding();
{
  console.log("  扫描文件 " + r.scanned + "｜命中 " + r.findings.length + "（已说明 " + r.allowed.length + "｜未说明 " + r.unexplained.length + "）");
  ok("★★★ 未说明的取整调用 = 0（新增第 13 处会让这一条变红）", r.unexplained.length === 0, JSON.stringify(r.unexplained.map((x) => x.file + ":" + x.line)));
  /**
   * ★★★ 第 245 轮按事实改写：**第 3 处**是狸猫「醉倒」的治疗算式（生命上限 × 6%）——
   *   那一步必然有一次取整（HP 必须是整数），而**取整方向原文一个字都没写**（round 还是 floor 要游戏内观测）。
   *   它登在 `tools/rounding-allowlist.json` 里，理由就是这句话本身 —— 不是"顺手加一条让闸门变绿"。
   */
  ok("★★★ 已说明的恰好 3 处", r.allowed.length === 3, JSON.stringify(r.allowed.map((x) => x.file + ":" + x.line)));
  ok("★★★ 那 3 处正是「指纹量化」「rng 整数抽样」「醉倒治疗算式（方向未实测）」（不是随便凑的）",
    r.allowed.map((x) => x.file).sort().join() === "compile/passive-runtime.ts,kernel/state.ts,kernel/steal.ts",
    JSON.stringify(r.allowed.map((x) => x.file)));
  ok("★★★ 每条说明**都是一句话的理由**（不是占位符 / 空串 / TODO）",
    r.allowed.every((x) => (x.reason ?? "").length > 30 && !/TODO|FIXME|待补/i.test(String(x.reason))),
    JSON.stringify(r.allowed.map((x) => (x.reason ?? "").slice(0, 20))));
  ok("★★ 理由里点名了「为什么不走 GameMath」",
    r.allowed.every((x) => /GameMath|随机数域|指纹/.test(String(x.reason))));
}

sec("[2] ★★★ 反向：合成一行 Math.round 必须被照出来（否则这条闸门是空转的）");
{
  const synth = await scanRounding({ extraSources: [{ file: "kernel/__synthetic_probe.ts", source: "const x = Math.round(1.5);\nconst y = Math.floor(2.5);\n// Math.round(3.5)\n" }] });
  const mine = synth.findings.filter((f) => f.file === "kernel/__synthetic_probe.ts");
  console.log("  合成源码命中 " + mine.length + " 处：" + JSON.stringify(mine.map((f) => f.line)));
  ok("★★★ 两行真代码都被照出来（Math.round / Math.floor）", mine.length === 2 && mine.map((f) => f.line).join() === "1,2", JSON.stringify(mine));
  ok("★★★ 注释行**不算**（`// Math.round(3.5)` 不该被误伤）", !mine.some((f) => f.line === 3));
  ok("★★★ 合成的那两处**没有**理由 ⇒ 落在 unexplained 里（新增命中不会自动被放过）",
    synth.unexplained.filter((f) => f.file === "kernel/__synthetic_probe.ts").length === 2);
  const withAllow = await scanRounding({ extraSources: [{ file: "kernel/__synthetic_probe.ts", source: "const x = Math.round(1.5);" }], allow: { [roundingKey("kernel/__synthetic_probe.ts", "const x = Math.round(1.5);")]: "合成对照用的说明（长度足够，不会被下面的检查当成占位符）" } });
  ok("★★★ 而传入 allow 时能被说明（证明允许表真的是判据，不是摆设）",
    withAllow.findings.filter((f) => f.file === "kernel/__synthetic_probe.ts").every((f) => !!f.reason)
      && withAllow.findings.filter((f) => f.file === "kernel/__synthetic_probe.ts").length === 1,
    JSON.stringify(withAllow.findings.filter((f) => f.file === "kernel/__synthetic_probe.ts")));
}

sec("[3] ★★★ GameMath 是唯一入口，且命名取整点是可枚举的");
{
  const files = ["kernel/battle.ts", "kernel/summon.ts", "kernel/lethal-consume.ts", "kernel/layer-field.ts", "kernel/steal.ts", "kernel/diff.ts", "compile/character.ts"];
  const named: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, "battle-lab", f), "utf8");
    for (const m of src.matchAll(/roundAt\([^,]+,\s*"([A-Z0-9_]+)"/g)) named.push(f + ":" + m[1]);
  }
  console.log("  命名取整点 " + named.length + " 个：" + JSON.stringify(named));
  ok("★★★ 第 191 轮改动引入的命名取整点全部在案（≥8 个）", named.length >= 8, String(named.length));
  ok("★★★ 名字都是**大写下划线**的常量风格（可 grep、可整体替换）", named.every((n) => /:[A-Z][A-Z0-9_]+$/.test(n)), JSON.stringify(named.filter((n) => !/:[A-Z][A-Z0-9_]+$/.test(n))));
  const gm = fs.readFileSync(path.join(ROOT, "battle-lab", "kernel", "gamemath.ts"), "utf8");
  ok("★★★ roundAt 的实现就是 Math.round（**逐位等价** ⇒ 这次改动不该动任何指纹）", /roundAt\(v: Scalar, where: string\): Scalar \{ void where; return Math\.round\(v\); \}/.test(gm));
}

sec("[4] ★★★ 反向：两个指纹逐位不变（命名取整点与 Math.round 等价，不是偷偷换了口径）");
{
  const { createKit, assembleMatch } = await import("../../apps/web/src/engine/assemble.ts");
  const { canonicalMatch } = await import("../../apps/web/src/mock/canonical-match.ts");
  const { captureState, stateHash } = await import("../kernel/state.ts");
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.run();
  ok("★★★ 默认档 2d7c7507e18db61f", stateHash(captureState(a.battle)) === "2d7c7507e18db61f", stateHash(captureState(a.battle)));
  const b: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "PARSED_CANDIDATES_ONLY" });
  await b.battle.runStartup(); await b.battle.run();
  ok("★★★ 被动档 7bc24506bdcd349e", stateHash(captureState(b.battle)) === "7bc24506bdcd349e", stateHash(captureState(b.battle)));
}

console.log("\n=== 取整纪律: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
