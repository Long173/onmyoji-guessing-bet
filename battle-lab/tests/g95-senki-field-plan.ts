// tests/g95-senki-field-plan.ts — ★★ 第 160 轮：**先机 → 结界** 的前置事实钉住（为下一轮的实现备好尺子）
//
// 背景（第 158/159 轮）：先机那两条（辉夜姬「火鼠裘」/ 御馔津「狐狩界」）的规格已由用户裁定 ——
//   先机放的是**结界**，范围写在被施放的那个技能里，不在先机这一句里。
// 探针（tools/_probe-senki159.ts）实测：被施放的两个技能 **IR 里已经带着 field**。
//
// 这个文件不实现任何东西，只把「实现前必须成立的三件事」钉住 —— 否则下一轮动手时，
//   一旦这两条的形状悄悄变了（比如谁把 field 解析改了），计划就失效而没人知道。
import fs from "node:fs";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const map = new Map<string, any>((input.skills as any[]).map(e => [e.key, JSON.parse(e.json)]));
const ir = (k: string) => map.get(k);
const clausesOf = (k: string, verb: string) => (ir(k)?.unmodeledMechanics ?? []).filter((m: any) => m.verb === verb).map((m: any) => String(m.clause));

sec("[1] ★★ 现状：两条先机子句都没有目标短语 ⇒ 记成「追加施放 / WARN」");
{
  const a = clausesOf("280/280_02", "追加施放");
  const b = clausesOf("304/304_02", "追加施放");
  ok("★★ 辉夜姬「火鼠裘」：有一条「[tips_7]：施放『[skill_280_03]』」的记账",
    a.length === 1 && /\[tips_7\].*施放.*skill_280_03/.test(a[0]), JSON.stringify(a));
  ok("★★ 御馔津「狐狩界」：有一条「[tips_7]：施放『狐狩界』」的记账",
    b.length === 1 && /\[tips_7\].*施放/.test(b[0]), JSON.stringify(b));
  ok("★★ 两条都**没有**目标短语（这正是它们此前 fail-closed 的原因）",
    [...a, ...b].every(c => !/对(随机)?敌方|对友方|对其/.test(c)), JSON.stringify([...a, ...b]));
  ok("★★ 而且它们也没有进 subCasts（那条路要求写明打谁）",
    !ir("280/280_02")?.subCasts && !ir("304/304_02")?.subCasts);
}

sec("[2] ★★★ 前置事实：被施放的两个技能 IR 里**已经带着 field**（这是「不需要新目标模型」的依据）");
{
  const dragon = ir("280/280_03");
  ok("★★★ 辉夜姬 → 280_03「龙首之玉」：field=ILLUSION，且 aura/perTurn 的 scope 都是 ALLY",
    dragon?.field?.kind === "ILLUSION" && (dragon.field.auras ?? []).every((x: any) => x.scope === "ALLY") && dragon.field.perTurn?.scope === "ALLY",
    JSON.stringify(dragon?.field ?? null).slice(0, 200));
  ok("★★★ 御馔津 → 304_02「狐狩界」本身就是那条结界技能：field=BARRIER",
    ir("304/304_02")?.field?.kind === "BARRIER", JSON.stringify(ir("304/304_02")?.field ?? null).slice(0, 180));
  ok("★★ 两处 field 都带 evidence（判据可回原文核对）",
    !!dragon?.field?.evidence && !!ir("304/304_02")?.field?.evidence);
  ok("★★ 两处 field 都有持续时间（幻境 2 回合 / 结界 1 回合）",
    dragon?.field?.duration === 2 && ir("304/304_02")?.field?.duration === 1,
    JSON.stringify([dragon?.field?.duration, ir("304/304_02")?.field?.duration]));
}

sec("[3] ★★ 范围：先机族不止这两条（实现时要逐条过）");
{
  const withTips7 = [...map.entries()].filter(([, v]) => JSON.stringify(v).includes("tips_7"));
  const senkiUnmodeled = [...map.entries()].filter(([, v]) => (v.unmodeledMechanics ?? []).some((m: any) => /\[tips_7\]/.test(String(m.clause ?? ""))));
  ok("★★ 目前还有 [tips_7] 子句未建模的技能数（应含这两条在内）", senkiUnmodeled.length >= 2, String(senkiUnmodeled.length));
  ok("★ 全库提到 [tips_7] 的技能数（族规模，供实现时逐条核对）", withTips7.length >= 5, String(withTips7.length));
}

console.log("\n=== 先机→结界 前置事实: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
