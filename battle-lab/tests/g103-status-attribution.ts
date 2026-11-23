// tests/g103-status-attribution.ts — ★★★ 第 181 轮：状态引用的**逐句证据**（细化到槽位）+ 执行侧判据
//
// 第 180 轮落了产物（statusRefClauses），本轮把它**细化到槽位**并接上执行侧：
//   · 每个槽位 ← **它自己所在的那一句**（不再是"这个 ref 出现在哪些子句里"——那样多个槽位共享一份清单，收窄时分不开）；
//   · 只当条件的槽位单独标出来（statusRefConditionOnly）—— 「若拥有4层[buff_x]」里的那个引用**不是效果**；
//   · 执行侧 statusRefsForClause(ir, 子句)：没有证据 ⇒ null（照旧全放）；有证据 ⇒ 严格按证据（可能是空数组）。
import fs from "node:fs";
import path from "node:path";
import { DamageType, EV } from "../kernel/types.ts";
import { compileAll } from "../tools/compile-census.ts";
import { statusRefSlotsForClause } from "../compile/skill-compiler.ts";
// ★★★ 第 193 轮：判据本身也要能直接问（「这句里的这个引用是读还是写」）
import { refIsConditionOnly } from "../kernel/triggers.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const irs = (input.skills as any[]).map((e: any) => ({ key: String(e.key), ir: JSON.parse(String(e.json)) }));
const irOf = (k: string) => irs.find((x) => x.key === k)!.ir;

sec("[1] ★★★ 产物形状：逐槽位、只在会造成多算的地方写、每条证据都真的落在那一句里");
{
  const withField = irs.filter((x) => Array.isArray(x.ir.statusRefClauses));
  ok("★★★ 带 statusRefClauses 的技能 = 112", withField.length === 112, String(withField.length));
  ok("★★★ 与 statusRefs **一一对应**（长度相等）",
    withField.every((x) => x.ir.statusRefClauses.length === (x.ir.statusRefs ?? []).length));
  ok("★★★ 每个槽位的证据子句**真的包含它自己那个引用**（不许造证据、不许错位）",
    withField.every((x) => x.ir.statusRefClauses.every((c: string, i: number) => c.includes("[buff_" + x.ir.statusRefs[i] + "]"))));
  ok("★★★ 而且每个写出该键的技能里，**至少有一个 ref 跨 ≥2 子句**（这正是写出它的理由）",
    withField.every((x) => { const m = new Map<string, Set<string>>(); x.ir.statusRefs.forEach((r: string, i: number) => { if (!m.has(r)) m.set(r, new Set()); m.get(r)!.add(x.ir.statusRefClauses[i]); }); return [...m.values()].some((s) => s.size > 1); }));
  /**
   * ★★★ 第 193 轮：**条件写法不止「若拥有N层」那一种**。
   *   第 181 轮只认 PASSIVE_STACK_RE，于是「若自身未拥有[buff_x]」「若敌方存在[buff_x]目标」
   *   「若目标带有3层[buff_x]」这类**检查**被当成**效果**执行 —— 实测 15 个技能命中。
   *   判据扩到 kernel/triggers.ts 的 refIsConditionOnly（条件词 + 引用在其后 + 中间没有施加类动词，
   *   且**被动词不算施加**），命中数 2 → 25。
   */
  const condHits = irs.filter((x) => x.ir.statusRefConditionOnly);
  ok("★★★ 带「只当条件」槽位的技能 = 39（第 193 轮把两种**读法**都认出来：条件写法 + 计数写法）",
    condHits.length === 39, JSON.stringify({ n: condHits.length, keys: condHits.map((x) => x.key) }));
  ok("★★★ 而每一个被标的槽位，它的证据子句里**真的有读法标记**（条件词 或 计数「每…层」）—— 不许乱标",
    condHits.every((x) => x.ir.statusRefConditionOnly.every((i: number) => /若|如果|只要|除非|需|每/.test(x.ir.statusRefClauses[i]))),
    JSON.stringify(condHits.filter((x) => !x.ir.statusRefConditionOnly.every((i: number) => /若|如果|只要|除非|需|每/.test(x.ir.statusRefClauses[i]))).map((x) => x.key)));
}

sec("[2] ★★★ 代表：九命猫「九命」—— 三个槽位各归各句，条件那一槽被标出来");
{
  const ir = irOf("207/207_02");
  console.log("  refs = " + JSON.stringify(ir.statusRefs));
  console.log("  slots = " + JSON.stringify(ir.statusRefClauses));
  console.log("  condOnly = " + JSON.stringify(ir.statusRefConditionOnly));
  ok("★★★ 槽位 0 是「获得1层」（暴击句）· 槽位 1 是「若拥有4层」（**条件**）· 槽位 2 是「对伤害来源附加」",
    /获得1层/.test(ir.statusRefClauses[0]) && /若拥有4层/.test(ir.statusRefClauses[1]) && /伤害来源/.test(ir.statusRefClauses[2]));
  ok("★★★ 条件槽位被单独标出来（[1]）", JSON.stringify(ir.statusRefConditionOnly) === "[1]", JSON.stringify(ir.statusRefConditionOnly));
}

sec("[3] ★★★ 执行侧判据（纯函数）：这一句该施加哪几个引用");
{
  const ir = irOf("207/207_02");
  ok("★★★ 暴击句 ⇒ 只施加**槽位 0**（其余两槽不属于这一句；注意是槽位不是 ref）",
    JSON.stringify(statusRefSlotsForClause(ir, "暴击时，获得1层[buff_2072_1]，上限4层")) === "[0]",
    JSON.stringify(statusRefSlotsForClause(ir, "暴击时，获得1层[buff_2072_1]，上限4层")));
  ok("★★★ 复活句 ⇒ **空数组**（它唯一的引用是条件 —— 不该被当成效果施加）",
    JSON.stringify(statusRefSlotsForClause(ir, "阵亡时，若拥有4层[buff_2072_1]，则会立即复活并恢复生命上限20%的生命")) === "[]",
    JSON.stringify(statusRefSlotsForClause(ir, "阵亡时，若拥有4层[buff_2072_1]，则会立即复活并恢复生命上限20%的生命")));
  ok("★★★ 伤害来源句 ⇒ 只施加**槽位 2**",
    JSON.stringify(statusRefSlotsForClause(ir, "阵亡时，对伤害来源附加[buff_2073_1]")) === "[2]",
    JSON.stringify(statusRefSlotsForClause(ir, "阵亡时，对伤害来源附加[buff_2073_1]")));
  ok("★★★ 没有逐句证据的技能 ⇒ null（调用方照旧全放，fail-closed）",
    statusRefSlotsForClause(irOf("234/234_02"), "友方全体各有50%概率获得[buff_2342_1]") === null);
  /**
   * ★ 归一化钉子（第一版就是这么错的）：槽位证据是**原文形态**（带 [tips_2] 占位符），
   *   而触发单元的子句来自**解析后**的文本（[基础概率]）—— 比对前必须把非 buff 的方括号都去掉。
   */
  const slots = statusRefSlotsForClause(irOf("249/249_02"), "受到攻击时，有40%[基础概率]为攻击者附加[buff_2492_1]");
  ok("★★★ 原文形态的 tips 占位符与解析后的规范名**能对上**（归一化去掉非 buff 方括号）—— 用觉「记仇」这条",
    Array.isArray(slots) && slots.length >= 1, JSON.stringify(slots));
}

async function mk(name: string, passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", seed = 20261017) {
  const s = KBfind(name);
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name };
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives });
  await a.battle.runStartup();
  return a;
}
const KB: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KBfind = (n: string) => KB.find((c: any) => c.name === n)!;

sec("[4] ★★★ 行为（端到端）：暴击触发只加 **1** 层（此前是 2 —— 隔壁鬼火句的那份被一起算了）");
{
  const a = await mk("九命猫", "PARSED_CANDIDATES_ONLY");
  const b = a.battle;
  const e = b.allEntities().find((x: any) => x.teamId === 0)!;
  const foe = b.allEntities().find((x: any) => x.teamId === 1)!;
  const layers = (ref: string) => { const st = (e.statuses ?? []).find((s: any) => String(s.def?.id ?? "") === ref); return st ? Number(st.stacks ?? 0) : 0; };
  const before = layers("2072_1");
  await b.bus.dispatch(EV.AFTER_DAMAGE, { input: { source: e, target: foe }, result: { isCrit: true, applied: 100 } }, e.id, e.teamId, (id: number) => b.teamOf(id));
  const after = layers("2072_1");
  ok("★★★ 暴击句触发 ⇒ 2072_1 只 +1（逐句归因；此前是 +2）", after === before + 1, JSON.stringify({ before, after }));
  const off = await mk("九命猫", "NOT_EXECUTED");
  ok("★★ 反向：默认档（被动 OFF）一条都不装（指纹由 g43 守）",
    (off.battle.passiveReport?.installed ?? []).length === 0);
}


sec("[5] ★★★ 第 193 轮：**两种「读法」**都不该被当成效果（纯函数双向）");
{
  /**
   * 判据在 kernel/triggers.ts 的 refIsConditionOnly（唯一实现）。两种读法：
   *   ① **条件写法**：「若…[buff_x]」（引用在条件词之后、中间没有施加类动词；**被动词不算施加**）；
   *   ② **计数写法**：「每(有|获得|消耗)?N层[buff_x]」—— 按层数缩放/门槛，不是「给几层」。
   * ★ 分界就是那个**每**字：没有 每 的「获得/附加N层」是写，有 每 的是读。
   */
  const cases: Array<[string, string, boolean]> = [
    ["若自身未拥有[buff_3464_1]", "3464_1", true],
    ["若敌方存在[buff_3981_1]目标", "3981_1", true],
    ["若目标带有3层[buff_3291_1]", "3291_1", true],
    ["若其已拥有3层[buff_3172_1]", "3172_1", true],
    ["若[buff_5643_1]存在", "5643_1", true],
    ["施放时若自身未带有[buff_3961_1]", "3961_1", true],
    ["若拥有4层[buff_2072_1]", "2072_1", true],
    ["若敌方被附加[buff_2862_1]", "2862_1", true],
    ["则每层[buff_2862_1]增加1次攻击次数", "2862_1", true],
    ["每有1层[buff_3903_1]额外对敌方全体造成1次攻击56%伤害", "3903_1", true],
    ["每获得5层[buff_5532_1]", "5532_1", true],
    ["每消耗1层[buff_6031_1]使系数额外提升30%", "6031_1", true],
    ["则获得攻击80%的[buff_3464_1]", "3464_1", false],
    ["获得1层[buff_3462_1]", "3462_1", false],
    ["[tips_7]：获得4层[buff_3462_1]", "3462_1", false],
    ["为攻击者附加1层[buff_2852_1]", "2852_1", false],
    ["若生命比例低于50%则获得[buff_1_1]", "1_1", false],
    ["获得[buff_1_1]后若目标死亡", "1_1", false],
    ["对敌方全体造成攻击127%伤害", "3903_1", false],
  ];
  for (const [clause, ref, want] of cases) {
    ok("★ " + (want ? "读" : "写") + " ← 「" + clause.slice(0, 30) + "…」",
      refIsConditionOnly(clause, ref) === want, JSON.stringify({ got: refIsConditionOnly(clause, ref), want }));
  }
  ok("★★★ 引用不在子句里 ⇒ 一律 false（不许凭子句形状下结论）",
    refIsConditionOnly("若拥有4层[buff_2072_1]", "9999_9") === false);
  ok("★★★ 空子句 / 空引用都不炸，且返回 false",
    refIsConditionOnly("", "1_1") === false && refIsConditionOnly("若", "") === false);
}


sec("[6] ★★★ 行为（主动路径）：条件 / 计数引用在**施放时**不再被当成效果");
{
  /**
   * 由来：第 181 轮只把这道闸门装在**被动路径**上（statusRefSlotsForClause）。
   *   于是主动技能里的读法照旧被当成效果 —— 以津真天「风之舞」的
   *   「若敌方**被附加**[buff_2862_1]」「每有1层[buff_2862_1]」「则每层[buff_2862_1]增加1次攻击次数」
   *   三条**读法**会在施放时给目标挂上 2862_1（实测：施放一次 +2 层）。
   * ★ 这一节同时是**反向对照**：真效果槽（九命猫的 2072_1 / 2073_1）必须照旧施加 ——
   *   否则这道闸门就成了「一刀切全不施加」，那是把一个错换成另一个错。
   */
  const stacksIn = (x: any, ref: string) => { const st = (x.statuses ?? []).find((s: any) => String(s.def?.id ?? "") === ref); return st ? Number(st.stacks ?? 0) : 0; };
  const a = await mk("以津真天", "NOT_EXECUTED");
  const e = a.battle.teams[0].members[0];
  const foe = a.battle.enemiesOf(e.teamId)[0];
  const sk = (e.skills ?? []).find((s: any) => s.name === "风之舞")!;
  const refs: string[] = sk.ir?.statusRefs ?? [];
  ok("★★★ 前置：「风之舞」的三个引用**全部**是读法（条件 + 计数）",
    JSON.stringify(sk.ir?.statusRefConditionOnly) === JSON.stringify([0, 1, 2]),
    JSON.stringify({ refs, condOnly: sk.ir?.statusRefConditionOnly }));
  const n0 = (a.battle.trace ?? []).length;
  await sk.execute(a.battle, e, foe);
  const after = refs.map((r) => stacksIn(e, r) + stacksIn(foe, r));
  const evs = (a.battle.trace ?? []).slice(n0).map((x: any) => x.t);
  console.log("  施放后 2862_1 层数（自己+敌人）=" + JSON.stringify(after) + "｜事件=" + JSON.stringify(evs));
  ok("★★★ 施放**一层都不给**（三条读法此前会被施加成 2 层）", after.every((n) => n === 0), JSON.stringify(after));
  ok("★★★ 而技能本身没被误伤：伤害照旧打出来（4 段）", evs.filter((t) => t === "DAMAGE").length === 4, JSON.stringify(evs));
  const b = await mk("九命猫", "NOT_EXECUTED");
  const e2 = b.battle.teams[0].members[0];
  const foe2 = b.battle.enemiesOf(e2.teamId)[0];
  const sk2 = (e2.skills ?? []).find((s: any) => s.name === "九命")!;
  const n1 = (b.battle.trace ?? []).length;
  await sk2.execute(b.battle, e2, foe2);
  const applied = (b.battle.trace ?? []).slice(n1).filter((x: any) => x.t === "STATUS_APPLY").map((x: any) => x.status);
  console.log("  九命猫施放后 STATUS_APPLY =" + JSON.stringify(applied));
  ok("★★★ 反向对照：**真效果槽**照旧施加（2072_1 与 2073_1 各一条）",
    applied.includes("2072_1") && applied.includes("2073_1") && applied.filter((s) => s === "2072_1").length === 1,
    JSON.stringify(applied));
  ok("★★★ 而条件槽（2072_1 的那一份）不再被重复施加（施放一次只给 1 层）",
    applied.filter((s) => s === "2072_1").length === 1 && stacksIn(e2, "2072_1") === 1,
    JSON.stringify({ applied, stacks: stacksIn(e2, "2072_1") }));
}

console.log("\n=== 状态引用的逐句证据 + 执行侧判据: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
