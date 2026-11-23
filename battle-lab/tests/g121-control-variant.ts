// tests/g121-control-variant.ts — ★★★ 第 242 轮：**效果位的条件变体**（§175 设计草案的形状 ②/③ 落地）
//
// 原文（雪女「暴风雪」201_03）：「…并有8%[tips_2]将其[tips_101]1回合。…再次攻击被[tips_101]的目标时，有30%概率转化为[tips_112]。」
// 原文（雪童子「霜天之织」292_02）：「…有25%[tips_2]附加[tips_101]1回合，再次攻击冰冻目标时，转为[tips_112]…」
// 形状：条件（目标**已带**某个控制状态）+ 概率（写了才掷）+ 变体（命中后**替换**这一位的状态）。
// 铁律（与 §175.4 同）：
//   ① 条件**不掷骰**（只读 hasStatus）—— 否则"同一个 seed 两次不同结果"会从条件里漏进来；
//   ② 转换概率是原文写明的 ⇒ 该掷就掷，标签 branch_pick:<技能>:<变体名>，且在基础概率**之前**；
//   ③ **改写不是新增** —— 目标不许同时挂着 freeze 与 deepFreeze（多算比不做更坏）。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { controlDefByTipName } from "../kernel/status.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const dump: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "skill-ir.json"), "utf8"));

sec("[1] ★★★ 产物：恰好 2 条带条件变体，字段逐字对齐原文；别的技能一个字不动");
{
  const withV = dump.filter((ir: any) => (ir.controlRefs ?? []).some((e: any) => e.variant));
  ok("★★★ 带 variant 的技能恰好 2 条（雪女 201_03 · 雪童子 292_02）",
    withV.length === 2 && withV.map((ir: any) => ir.id).sort().join(",") === "201_03,292_02",
    JSON.stringify(withV.map((ir: any) => ir.id)));
  const v201 = dump.find((ir: any) => ir.id === "201_03").controlRefs[0];
  ok("★★★ 雪女：基础位 freeze（8% / 1 回合）+ 条件 freeze + 30% 转 deepFreeze",
    v201.ref === "freeze" && Number(v201.probability) === 8 && v201.variant.when.kind === "TARGET_HAS" && v201.variant.when.statusId === "freeze" && Number(v201.variant.probability) === 30 && v201.variant.ref === "deepFreeze",
    JSON.stringify(v201));
  const v292 = dump.find((ir: any) => ir.id === "292_02").controlRefs[0];
  ok("★★★ 雪童子：同样形状，但原文没写概率 ⇒ probability=null（必定转化，不许自己编一个数）",
    v292.variant.when.statusId === "freeze" && v292.variant.ref === "deepFreeze" && v292.variant.probability === null,
    JSON.stringify(v292.variant));
  ok("★★ 判据原句可复核（evidence 里既有条件也有转化）",
    /目标时/.test(v201.variant.evidence) && /(转化为|转为)/.test(v201.variant.evidence) && /(转化为|转为)/.test(v292.variant.evidence),
    JSON.stringify([v201.variant.evidence, v292.variant.evidence]));
  ok("★★★ 别的 816 条技能没有 variant（新键只在真的读出来时才出现）",
    dump.filter((ir: any) => (ir.controlRefs ?? []).some((e: any) => e.variant)).length === 2,
    String(dump.length));
}

sec("[2] ★★★ 记账：变体落地的那一条收掉，没做的照旧留着（不许一起变绿）");
{
  const sk201 = dump.find((ir: any) => ir.id === "201_03").controlSkips ?? [];
  const sk292 = dump.find((ir: any) => ir.id === "292_02").controlSkips ?? [];
  ok("★★★ 292_02：「深度冰冻 CONDITIONAL_BRANCH」已收掉（它现在有执行点了）",
    !sk292.some((s: any) => s.name === "深度冰冻" && s.reason === "CONDITIONAL_BRANCH"), JSON.stringify(sk292));
  ok("★★★ 反向（201_03）：**怪物变体**那条分支照旧记账 —— 「若目标为怪物，则改为冰冻2回合」没做就是没做",
    sk201.some((s: any) => s.name === "冰冻" && s.reason === "CONDITIONAL_BRANCH"), JSON.stringify(sk201));
  ok("★★ 反向（201_03）：条件那一侧仍记 REFERENCE_FORM（它在那一句里只是条件，不是施加）",
    sk201.some((s: any) => s.name === "冰冻" && s.reason === "REFERENCE_FORM"), JSON.stringify(sk201));
  const sk362 = dump.find((ir: any) => ir.id === "362_03").controlSkips ?? [];
  /**
   * ★★★ 第 246 轮按事实改写：那一条**已经做了** ——「失去 X 时结束 Y」落地为 `SkillIR.endOnLose`
   *   （`kernel/end-on-lose.ts`，尺子 tests/g124-end-on-lose.ts 16 条）。
   *   现在的事实：`CONDITIONAL_BRANCH` 收掉、条件那一侧的 `REFERENCE_FORM` 留着，而且它**不是**效果位变体（两回事）。
   */
  const ir362: any = dump.find((ir: any) => ir.id === "362_03");
  ok("★★★ 反向（蝉冰雪女 362_03）：这一轮已落地 ⇒ 收掉 CONDITIONAL_BRANCH、留 REFERENCE_FORM，且与效果位变体无关",
    !sk362.some((s: any) => s.name === "霜冻" && s.reason === "CONDITIONAL_BRANCH") &&
    sk362.some((s: any) => s.name === "霜冻" && s.reason === "REFERENCE_FORM") &&
    !!ir362.endOnLose && ir362.controlRefs[0].variant === undefined,
    JSON.stringify({ skips: sk362, endOnLose: ir362.endOnLose }));
}

sec("[3] ★★★ 行为（雪童子，确定性）：未冰冻 ⇒ 只上 freeze；已冰冻 ⇒ 只上 deepFreeze");
const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return {
    unitId: "u-" + name, shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 40000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 },
    soulId: null,
  };
};
async function arena(who: string, seed: number) {
  const m: any = canonicalMatch();
  m.red.units[0] = unit(who);
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives: "NOT_EXECUTED", traceLevel: "FULL" });
  await a.battle.runStartup();
  const e = a.battle.teams[0].members[0];
  const foe = a.battle.teams[1].members[0];
  return { b: a.battle, e, foe };
}
const castControl = async (b: any, e: any, foe: any, ref: string) => {
  const sk = (e.skills ?? []).find((s: any) => String(s?.ir?.id ?? "") === ref)!;
  const t0 = b.trace.length;
  /**
   * ★★ 第二个坑（同一次实测）：暴风雪是**要鬼火的主动技能**，而初始鬼火只够放两三次 ——
   *   后面的施放全部走 SKILL_FALLBACK（退回普攻），控制路径一次都不进。
   *   行为尺子只关心控制那一段 ⇒ 用第 237 轮的 `free` 通路（免消耗）把它隔离出来。
   */
  await sk.execute(b, e, foe, undefined, { onlyControlSlots: [0], free: true });
  return b.trace.slice(t0).filter((x: any) => String(x.ref ?? "").startsWith("CONTROL:"));
};
const applyFreeze = (foe: any) => { const d = controlDefByTipName("冰冻")!; foe.addStatus(d as any, foe.id, 1, 9); };
/**
 * ★★ 第 242 轮实测踩到的坑：暴风雪是**全体三段**，每一段几千伤害 ⇒ 目标几轮就死了，
 *   而死了的单位不在 `hurt` 里 ⇒ 后面 300 多次施放**一次都没进控制路径**。
 *   第一版因此"通过"了几条断言（样本只有 1 次）—— 那是**空转的绿**。
 *   所以每次施放前把敌方全体复活并补满血，并额外断言样本量（见下面的 >20 / >30 门槛）。
 */
const revive = (u: any) => { u.hp = u.maxHp; u.dead = false; u.hpZero = false; u.killed = false; };
/**
 * ★★ 第三个坑（同一次实测）：暴风雪是**全体**技能 ⇒ 施放次数一多，别的敌人也慢慢挂上 freeze，
 *   于是"每条施放掷一次"变成了"每条施放 × 每个已冰冻的目标各掷一次"（实测 400 次施放掷了 1961 次）。
 *   正确的判据是后者；尺子这里把敌方**全部**控制状态清干净、只给主目标补 freeze ⇒ 每次施放恰好 1 次掷骰。
 */
const clearCtl = (b: any) => {
  for (const u of b.teams[1].members) for (const s of [...(u.statuses ?? [])]) {
    if (String(s?.def?.id) === "freeze" || String(s?.def?.id) === "deepFreeze") u.expireStatus(s);
  }
};
const reviveAll = (b: any) => { for (const f of b.teams[1].members) revive(f); };
{
  const A = await arena("雪童子", 242);
  const appliedA: string[] = [];
  for (let i = 0; i < 120; i++) { reviveAll(A.b); clearCtl(A.b); for (const t of await castControl(A.b, A.e, A.foe, "292_02")) if (t.t === "STATUS_APPLY") appliedA.push(String(t.status)); }
  ok("★★★ 目标**未**冰冻：所有落地的控制都是 freeze，一条 deepFreeze 都没有（样本 " + appliedA.length + " 次，>20 才算真样本）",
    appliedA.length > 20 && appliedA.every((s) => s === "freeze"), JSON.stringify(appliedA.slice(0, 8)) + " 共 " + appliedA.length);
  ok("★★★ 未冰冻时 **0 次** branch_pick 掷骰（条件不掷骰 ⇒ 不进 RNG 账本）",
    (A.b.rng.draws ?? []).filter((d: any) => String(d.tag).startsWith("branch_pick:")).length === 0,
    String((A.b.rng.draws ?? []).filter((d: any) => String(d.tag).startsWith("branch_pick:")).length));
  const B = await arena("雪童子", 242);
  const appliedB: string[] = [];
  for (let i = 0; i < 120; i++) { reviveAll(B.b); clearCtl(B.b); applyFreeze(B.foe); for (const t of await castControl(B.b, B.e, B.foe, "292_02")) if (t.t === "STATUS_APPLY") appliedB.push(String(t.status)); }
  ok("★★★ 目标已冰冻：所有落地的控制都变成 deepFreeze（原文没写概率 ⇒ 必定转化；样本 " + appliedB.length + " 次，>20 才算真样本）",
    appliedB.length > 20 && appliedB.every((s) => s === "deepFreeze"), JSON.stringify(appliedB.slice(0, 8)) + " 共 " + appliedB.length);
  ok("★★★ 而且**没有任何一次两个都上**（改写 ≠ 新增）",
    !appliedB.includes("freeze"), JSON.stringify(appliedB.filter((s) => s === "freeze").length));
  ok("★★ 无概率的变体**也不掷骰**（原文没写就是必定，不许自己造一次抽数）",
    (B.b.rng.draws ?? []).filter((d: any) => String(d.tag).startsWith("branch_pick:")).length === 0,
    String((B.b.rng.draws ?? []).filter((d: any) => String(d.tag).startsWith("branch_pick:")).length));
}

sec("[4] ★★★ 行为（雪女，30%）：已冰冻时每条施放恰好掷一次，比例落在 3σ 带内");
{
  const C = await arena("雪女", 2420);
  const applied: string[] = [];
  let casts = 0;
  for (let i = 0; i < 400; i++) { reviveAll(C.b); clearCtl(C.b); applyFreeze(C.foe); casts++; for (const t of await castControl(C.b, C.e, C.foe, "201_03")) if (t.t === "STATUS_APPLY") applied.push(String(t.status)); }
  const rolls = (C.b.rng.draws ?? []).filter((d: any) => String(d.tag).startsWith("branch_pick:"));
  ok("★★★ 每条施放、每个已冰冻的目标各掷一次（清干净后只剩主目标 ⇒ " + rolls.length + " == " + casts + "），标签带得出处",
    rolls.length === casts && rolls.every((d: any) => String(d.tag) === "branch_pick:暴风雪:深度冰冻"), JSON.stringify(rolls.slice(0, 2)));
  const hits = rolls.filter((d: any) => Number(d.v) < 0.3).length;
  ok("★★★ 30% 是真掷出来的（命中 " + (hits / rolls.length * 100).toFixed(1) + "%）",
    hits / rolls.length >= 0.22 && hits / rolls.length <= 0.38, hits + "/" + rolls.length);
  const deep = applied.filter((s) => s === "deepFreeze").length;
  ok("★★★ 落地的状态里 deepFreeze 与 freeze 加起来 == 落地总数（一次施放只挂一个状态，永不双挂）",
    applied.length === deep + applied.filter((s) => s === "freeze").length && applied.length > 0,
    JSON.stringify({ total: applied.length, deep, freeze: applied.filter((s) => s === "freeze").length }));
  ok("★★ 而且样本量够（落地 >30 次、转化 >5 次；否则上面的等式可能是空转）", deep >= 5 && applied.length > 30, JSON.stringify({ applied: applied.length, deep }));
}

sec("[5] ★★ 爆炸半径：两条技能都不在典型阵容里（指纹的护栏）");
{
  const LINEUP = [202, 297, 601, 225, 346, 205, 358, 267, 352, 390];
  const withV = dump.filter((ir: any) => (ir.controlRefs ?? []).some((e: any) => e.variant));
  ok("★★ 带 variant 的角色 id 都不在典型对局阵容里（所以两个指纹不该动，见 g0/g3 的指纹断言）",
    withV.every((ir: any) => !LINEUP.includes(Number(ir.charId))), JSON.stringify(withV.map((ir: any) => ir.charId)));
}

function foe_clear(foe: any) { for (const s of [...(foe.statuses ?? [])]) if (String(s?.def?.id) === "freeze" || String(s?.def?.id) === "deepFreeze") foe.expireStatus(s); }

console.log("\ng121-control-variant: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);