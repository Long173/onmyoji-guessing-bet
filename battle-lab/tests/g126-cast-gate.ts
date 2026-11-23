// tests/g126-cast-gate.ts — ★★★ 第 248 轮：**施放限制**（「X 存在时，无法施放此技能」）—— 静默缺口筛查抓出来的新机制族
//
// 由来：第 248 轮把「自称完整编译（HIGH / unparsed 空 / 无未建模）」的技能按机制族扫了一遍（tools/_probe-silent248.ts），
//   筛出 4 条**有句子但没有执行点**的候选，这一条是最干净的一族：
//   · 大岳丸「无尽剑狱」333_03：「[buff_3334_1]存在时，无法施放…」⇒ 自己身上有该状态就放不出来；
//   · 蝉冰雪女「永冬」362_03：「敌方存在[tips_3621]目标时，无法施放此技能」⇒ 敌方有霜冻就放不出来。
// 判据：产物逐字 · 行为双向（条件成立 ⇒ 这条规则被 gate 掉、决策事件写明原因；条件不成立 ⇒ 照旧是候选）· 无关技能不受影响 · 指纹护栏。
import fs from "node:fs";
import path from "node:path";
import { StatusBook, controlDefByTipName } from "../kernel/status.ts";
import { selectSkillByAI } from "../compile/character.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const dump: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "skill-ir.json"), "utf8"));

sec("[1] ★★★ 产物：全库恰好 2 条带 castGate（大岳丸 333_03 · 蝉冰雪女 362_03）");
{
  const withG = dump.filter((ir: any) => ir.castGate);
  ok("★★★ 恰好 2 条，且就是这两条", withG.length === 2 && withG.map((ir: any) => ir.id).sort().join(",") === "333_03,362_03", JSON.stringify(withG.map((ir: any) => ir.id)));
  const g333 = dump.find((ir: any) => ir.id === "333_03").castGate;
  ok("★★★ 大岳丸：SELF_HAS buff_3334_1（自己身上有它 ⇒ 放不出来）", g333.when.kind === "SELF_HAS" && String(g333.when.statusRef) === "3334_1" && /无法施放/.test(String(g333.evidence)), JSON.stringify(g333));
  const g362 = dump.find((ir: any) => ir.id === "362_03").castGate;
  ok("★★★ 蝉冰雪女：ENEMY_HAS frost（敌方有霜冻 ⇒ 放不出来）", g362.when.kind === "ENEMY_HAS" && String(g362.when.statusRef) === "frost" && /无法施放/.test(String(g362.evidence)), JSON.stringify(g362));
  ok("★★★ 报表点名（recognized 里能看到这条技能受了哪条限制）",
    (dump.find((ir: any) => ir.id === "333_03").recognized ?? []).includes("castGate:SELF_HAS:3334_1") &&
    (dump.find((ir: any) => ir.id === "362_03").recognized ?? []).includes("castGate:ENEMY_HAS:frost"),
    JSON.stringify([dump.find((ir: any) => ir.id === "333_03").recognized, dump.find((ir: any) => ir.id === "362_03").recognized]));
  ok("★★★ 别的 816 条技能没有这个键", dump.filter((ir: any) => ir.castGate).length === 2, String(dump.length));
}

sec("[2] ★★★ 行为（SELF_HAS）：条件成立 ⇒ 这条规则被 gate 掉、决策事件写明原因；不成立 ⇒ 照旧是候选");
const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return { unitId: "u-" + name, shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 40000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 }, soulId: null };
};
async function arena(who: string, seed: number) {
  const m: any = canonicalMatch();
  m.red.units[0] = unit(who);
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives: "PARSED_CANDIDATES_ONLY", traceLevel: "FULL" });
  await a.battle.runStartup();
  return { b: a.battle, e: a.battle.teams[0].members[0] };
}
/** 跑一次 AI 选招，把决策事件里的该技能规则条目取出来 */
const ruleOf = (b: any, e: any, skillName: string) => {
  const t0 = b.trace.length;
  const chosen = selectSkillByAI(b, e, b.enemiesOf(e.teamId));
  const dec = b.trace.slice(t0).reverse().find((x: any) => x.t === "AI_DECISION");
  return { chosen, dec, rule: (dec?.rules ?? []).find((r: any) => r.skill === skillName) ?? null };
};
{
  const A = await arena("大岳丸", 248);
  /**
   * ★★ 实测：KB 状态的定义是**施放时**才登记进 StatusBook 的（compile/character.ts），
   *   而这条测试只调 `selectSkillByAI`（不施放）⇒ 得自己把定义编译出来登记一次（与 g89/g109 同一做法）。
   */
  const buffs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[];
  const { compileBuff, toStatusDef } = await import("../compile/buff-compiler.ts");
  const gateDef = toStatusDef(compileBuff(buffs.find((b: any) => String(b.id) === "3334_1")));
  if (!StatusBook.has(gateDef.id)) StatusBook.set(gateDef.id, gateDef);
  ok("★★ 前置：buff_3334_1 的定义可用（编译出来并登记；引擎里是施放时登记，这条尺子只选招不施放）", !!gateDef && StatusBook.has("3334_1"), String(gateDef?.id));
  const r1 = ruleOf(A.b, A.e, "无尽剑狱");
  ok("★★★ 条件不成立（身上没有 3334_1）⇒ 这条规则**不是** gated（照旧是候选）", !!r1.rule && !r1.rule.gated, JSON.stringify(r1.rule));
  if (gateDef) {
    A.e.addStatus(gateDef as any, A.e.id, 1, 99999, [], null);
    const r2 = ruleOf(A.b, A.e, "无尽剑狱");
    ok("★★★ 条件成立 ⇒ 这条规则被 gate 掉，且写明依据原句", !!r2.rule && r2.rule.gated === true && /无法施放/.test(String(r2.rule.gate)), JSON.stringify(r2.rule));
    ok("★★★ 而且真的没选它（chosen != 无尽剑狱）", String(r2.chosen?.name) !== "无尽剑狱", String(r2.chosen?.name));
    ok("★★ 决策事件里 `gatedSkipped` ≥ 1（G5 要能回答「为什么这一回合没放它」）", Number(r2.dec?.gatedSkipped ?? 0) >= 1, String(r2.dec?.gatedSkipped));
    ok("★★ 反向：同一场里别的技能没有被误标 gated", (r2.dec?.rules ?? []).filter((r: any) => r.gated).length === (r2.dec?.rules ?? []).filter((r: any) => r.skill === "无尽剑狱").length, JSON.stringify((r2.dec?.rules ?? []).map((r: any) => [r.skill, !!r.gated])));
  }
}

sec("[3] ★★★ 行为（ENEMY_HAS）：敌方有霜冻 ⇒ 放不出来；敌方没有 ⇒ 照旧是候选");
{
  const B = await arena("蝉冰雪女", 248);
  const frostDef = controlDefByTipName("霜冻");
  const r1 = ruleOf(B.b, B.e, "永冬");
  ok("★★★ 敌方没有霜冻 ⇒ 这条规则不是 gated", !!r1.rule && !r1.rule.gated, JSON.stringify(r1.rule));
  if (frostDef) {
    B.b.teams[1].members[0].addStatus(frostDef as any, B.e.id, 1, 9);
    const r2 = ruleOf(B.b, B.e, "永冬");
    ok("★★★ 敌方有霜冻 ⇒ 被 gate 掉（依据原句写明）", !!r2.rule && r2.rule.gated === true && /无法施放/.test(String(r2.rule.gate)), JSON.stringify(r2.rule));
    ok("★★★ 而且真的没选它", String(r2.chosen?.name) !== "永冬", String(r2.chosen?.name));
  }
}

sec("[4] ★★ 爆炸半径：这两只都不在典型阵容里（指纹的护栏）");
{
  const LINEUP = [202, 297, 601, 225, 346, 205, 358, 267, 352, 390];
  ok("★★ 333 与 362 都不在典型对局阵容里 ⇒ 两个指纹不该动", !LINEUP.includes(333) && !LINEUP.includes(362));
}

console.log("\ng126-cast-gate: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);