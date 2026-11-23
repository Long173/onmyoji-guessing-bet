// tests/g96-senki-field.ts — ★★★ 第 164 轮：**先机 → 结界**（规格见报告 §136，形状见 §137）
// 两向：被动档下战斗开始真的展开结界；默认档（被动 OFF）一条都不发生。
//
// ★★★ 本轮实测的边界（如实记下，不写成断言）：
//   · 辉夜姬「火鼠裘」✅ 端到端跑通（先机施放 280_03 → 幻境展开）；
//   · 御馔津「狐狩界」❌ 那条先机**写在一个 cost=3 的主动技能里**（304_02 自己），
//     而装配点是**被动运行时**（只收 cost<0）⇒ 它被那道 cost 闸门按设计挡住，永远不会装。
//     ⇒ 这不是「再写一行」能解决的：它要一个明确决定 —— 主动技能里的先机，装配点放哪？
//       候选是 compile/character.ts 的装配路径（但那时要不要受「被动 OFF」策略管？按第 140/145 轮的规矩，
//       机制类的东西默认档不装，且要在报告里说清）。在此之前**保持 fail-closed**（什么都不发生，继续按 WARN 记账）。
//   · 第 [1] 节只断言已经跑通的那一半；第 [3] 节把「御馔津那条写在主动技能里」这个事实钉住，
//     免得下一轮误以为它已经接好了。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { compileAll } from "../tools/compile-census.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
async function mk(name: string, passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", seed = 20261010) {
  const s = KB.find((x: any) => x.name === name);
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name };
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives });
  await a.battle.runStartup();
  return a;
}
const tr = (a: any, t: string) => a.battle.trace.filter((x: any) => x.t === t);

sec("[1] ★★★ 被动档：辉夜姬那条先机端到端跑通");
{
  const a = await mk("辉夜姬", "PARSED_CANDIDATES_ONLY");
  ok("★★★ 「火鼠裘」先机施放了『龙首之玉』（ref=280_03）", tr(a, "SUBCAST").some((x: any) => x.ref === "280_03"),
    JSON.stringify(tr(a, "SUBCAST").map((x: any) => x.ref)));
  ok("★★★ 而且真的展开了幻境（FIELD_ENTER）", tr(a, "FIELD_ENTER").length >= 1, JSON.stringify(tr(a, "FIELD_ENTER").map((x: any) => x.name)));
  ok("★★ 施放选到了真实目标（不是 NO_TARGET 跳过）", tr(a, "SUBCAST_SKIPPED").every((x: any) => x.reason !== "NO_TARGET"),
    JSON.stringify(tr(a, "SUBCAST_SKIPPED").map((x: any) => x.reason)));
}

sec("[2] ★★★ 反向：默认档（被动 OFF）一条都不发生");
{
  const a = await mk("辉夜姬", "NOT_EXECUTED");
  ok("★★★ 默认档没有 SUBCAST 痕迹", tr(a, "SUBCAST").length === 0, JSON.stringify(tr(a, "SUBCAST").map((x: any) => x.ref)));
  ok("★★ 也没有因为这条先机而展开任何场地", tr(a, "FIELD_ENTER").length === 0, JSON.stringify(tr(a, "FIELD_ENTER").map((x: any) => x.name)));
}

sec("[3] ★★★ 第 172 轮：**写在主动技能里的先机**也接上了（安装点挪到 cost 闸门之前）");
{
  const { input } = compileAll(path.join(ROOT, "data", "kb"));
  const at = (k: string) => JSON.parse((input.skills as any[]).find(e => e.key === k)!.json);
  ok("★★ 两条先机形状相同、归属不同：280_02 是被动（cost<0）、304_02 是主动（cost=3）",
    at("280/280_02").cost < 0 && at("304/304_02").cost === 3,
    JSON.stringify([at("280/280_02").cost, at("304/304_02").cost]));
  ok("★★ 两条都写着 [tips_7] 先机施放（判据同源）",
    [at("304/304_02"), at("280/280_02")].every(ir => (ir.unmodeledMechanics ?? []).some((m: any) => /\[tips_7\]/.test(String(m.clause)))));
  const b = await mk("御馔津", "PARSED_CANDIDATES_ONLY", 20261011);
  ok("★★★ 御馔津「狐狩界」的先机现在**真的会施放**（ref=304_02）",
    tr(b, "SUBCAST").some((x: any) => x.ref === "304_02"), JSON.stringify(tr(b, "SUBCAST").map((x: any) => x.ref)));
  ok("★★★ 而且结界展开了（FIELD_ENTER）", tr(b, "FIELD_ENTER").length >= 1, JSON.stringify(tr(b, "FIELD_ENTER").map((x: any) => x.name)));
  const off2 = await mk("御馔津", "NOT_EXECUTED", 20261011);
  ok("★★★ 但默认档（被动 OFF）仍然一条都不发生 —— 这条路径跟着「机制类默认不装」的口径走",
    tr(off2, "SUBCAST").length === 0 && tr(off2, "FIELD_ENTER").length === 0,
    JSON.stringify([tr(off2, "SUBCAST").length, tr(off2, "FIELD_ENTER").length]));
}

console.log("\n=== 先机→结界: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
