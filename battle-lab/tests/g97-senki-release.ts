// tests/g97-senki-release.ts — ★★★ 第 174 轮：**先机子句的报表放行**（正反五个方向）
//
// 背景：第 164–172 轮把「先机 → 施放『X』」接通了（被动运行时装 BATTLE_START 钩子 → kernel/sub-cast.ts），
//   但编译器的**句子分类**仍写着 MECHANIC_UNPARSED —— 编译器只看得到自己这一个技能，看不到「『X』有没有场地」。
//   于是报表比代码悲观：御馔津「狐狩界」在卡面上一直是 ◐ 部分编译，而它唯一没解析的那句正是**已经跑通**的先机。
// 本轮按引擎自己的产物放行，判据三条（引用解析得到 + 那条技能真带 field + 子句是 [tips_7] 施放），
//   任一条不满足 ⇒ 照旧记缺口。★ IR 不动：编译器"我没解析"与运行时"这句有执行点"两个事实都留着。
import fs from "node:fs";
import path from "node:path";
import { createKit, charInfo, senkiReleaseOf } from "../../apps/web/src/engine/assemble.ts";
import { classifySkill } from "../kernel/fidelity.ts";
import { compileAll } from "../tools/compile-census.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const kit = createKit(bundle);
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const irOf = (key: string) => JSON.parse(String((input.skills as any[]).find((e: any) => String(e.key) === key)!.json));
const detailOf = (name: string, skillName: string) => {
  const c = KB.find((x: any) => x.name === name)!;
  return charInfo(kit, c.id).skillDetails.find((d: any) => d.name === skillName)!;
};
const upSent = (ir: any) => (ir.sentences ?? []).filter((s: any) => s.kind === "MECHANIC_UNPARSED");

sec("[1] ★★★ 御馔津「狐狩界」（主动技能里的先机，第 172 轮接线）：报表跟着代码走");
{
  const ir = irOf("304/304_02");
  const d: any = detailOf("御馔津", "狐狩界");
  ok("★★ IR 里那句**仍然**是 MECHANIC_UNPARSED（编译器的保守事实不变）",
    upSent(ir).length === 1 && /\[tips_7\]/.test(upSent(ir)[0].text), JSON.stringify(upSent(ir).map((s: any) => s.text)));
  ok("★★★ 但报表里的未解析句数 1 → 0（放行生效）", d.unparsedSentences === 0, String(d.unparsedSentences));
  ok("★★★ 逐技能档位随之从 ◐ 部分编译变成 ● 完整编译", classifySkill(d) === "FULL", classifySkill(d));
  ok("★★ 依赖机制列表里不再挂着「追加施放」（那条已经跑通）",
    !d.unmodeled.some((m: any) => m.verb === "追加施放"), JSON.stringify(d.unmodeled.map((m: any) => m.verb)));
}

sec("[2] ★★★ 辉夜姬「火鼠裘」：放行只放**先机那一句**，另外两句照旧算缺口（不许顺带放行）");
{
  const d: any = detailOf("辉夜姬", "火鼠裘");
  ok("★★ 先机那条不再列为「依赖的未建模机制」", !d.unmodeled.some((m: any) => m.verb === "追加施放"),
    JSON.stringify(d.unmodeled.map((m: any) => m.verb)));
  ok("★★★ 但它**仍然是** ◐ 部分编译（3 句未解析 → 2 句）", d.unparsedSentences === 2 && classifySkill(d) === "PARTIAL",
    JSON.stringify([d.unparsedSentences, classifySkill(d)]));
  const rest = upSent(irOf("280/280_02")).filter((s: any) => !/\[tips_7\]/.test(s.text));
  ok("★★ 剩下那两句真的是没建模的触发条件（钉住原文，免得下一轮误放）",
    rest.length === 2 && rest.every((s: any) => /受到攻击|群体攻击/.test(s.text)), JSON.stringify(rest.map((s: any) => s.text)));
}

sec("[3] ★★★ 反例：三条判据任缺一条都不放行（fail-closed）");
{
  const byId = new Map<string, any>([["304_02", { name: "狐狩界", field: { kind: "BARRIER" } }]]);
  const withField = { unmodeledMechanics: [{ verb: "追加施放", clause: "[tips_7]：施放『狐狩界』" }] };
  ok("★★ 引用解析得到、且那条技能带 field ⇒ 放行（返回被放行的子句）",
    senkiReleaseOf(withField, byId) === "[tips_7]：施放『狐狩界』", String(senkiReleaseOf(withField, byId)));
  const noField = new Map<string, any>([["304_02", { name: "狐狩界" }]]);
  ok("★★★ 引用解析得到、但那条技能**没有** field ⇒ 不放行", senkiReleaseOf(withField, noField) === null);
  ok("★★★ 引用解析不到 ⇒ 不放行",
    senkiReleaseOf({ unmodeledMechanics: [{ verb: "追加施放", clause: "[tips_7]：施放『不存在的技能』" }] }, byId) === null);
  ok("★★ 同一形状写了两条 ⇒ 不放行（不猜哪一条）",
    senkiReleaseOf({ unmodeledMechanics: [
      { verb: "追加施放", clause: "[tips_7]：施放『狐狩界』" },
      { verb: "追加施放", clause: "[tips_7]：施放『狐狩界』" },
    ] }, byId) === null);
  ok("★★ 非先机（没有 [tips_7]）的追加施放 ⇒ 不放行",
    senkiReleaseOf({ unmodeledMechanics: [{ verb: "追加施放", clause: "并对随机敌方目标施放『狐狩界』" }] }, byId) === null);
}

sec("[4] ★★ 全库口径：放行的恰好是这两条，其余 [tips_7] 施放子句一条都不放");
{
  const byChar = new Map<string, Map<string, any>>();
  for (const e of (input.skills as any[])) {
    const ir = JSON.parse(String(e.json));
    const cid = String(e.key).split("/")[0];
    if (!byChar.has(cid)) byChar.set(cid, new Map());
    byChar.get(cid)!.set(String(ir.id), ir);
  }
  const released: string[] = [];
  for (const e of (input.skills as any[])) {
    const ir = JSON.parse(String(e.json));
    const cid = String(e.key).split("/")[0];
    if (senkiReleaseOf(ir, byChar.get(cid)!)) released.push(String(e.key));
  }
  ok("★★★ 全库放行条数 = 2，且就是 280/280_02 与 304/304_02",
    released.length === 2 && released.includes("280/280_02") && released.includes("304/304_02"), JSON.stringify(released));
  const tipsCast = (input.skills as any[]).filter((e: any) => (JSON.parse(String(e.json)).unmodeledMechanics ?? [])
    .some((m: any) => m.verb === "追加施放" && /\[tips_7\]/.test(String(m.clause))));
  ok("★★ 全库带 [tips_7] 施放记账的技能数 = 2（这条形状就这两条）", tipsCast.length === 2, JSON.stringify(tipsCast.map((e: any) => e.key)));
}

sec("[5] ★ 放行是**引擎能力**的结论，与本次装配无关（纯函数，两次结果逐字相同）");
{
  const a = JSON.stringify(charInfo(kit, KB.find((x: any) => x.name === "御馔津")!.id).skillDetails);
  const b = JSON.stringify(charInfo(kit, KB.find((x: any) => x.name === "御馔津")!.id).skillDetails);
  ok("★ 两次 charInfo 结果逐字一致（没有把随机/时间带进报表）", a === b);
}

console.log("\n=== 先机子句放行: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
