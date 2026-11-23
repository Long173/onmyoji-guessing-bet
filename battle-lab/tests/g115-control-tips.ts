// tests/g115-control-tips.ts — ★★★ 第 195 轮：**占位符形态的控制效果**（`[tips_101]`=冰冻 / `[tips_108]`=眩晕…）
//
// 由来：控制效果在技能原文里几乎都写成 tips 占位符，全库 **73 处小句、56 个技能**，
//   而引擎此前**一处都不施加** —— 更坏的是那 56 个技能在报表上大多写着「完整编译」（unparsed 为空）。
//   这是「少算」里最坏的一类：不是没做，而是**看不出来没做**。
//
// 本轮：映射只有一份（kernel/status.ts 的 controlDefByTipName）· 产物 controlRefs / controlSkips ·
//   执行侧复用与池子**同一个施加核心**（compile/character.ts 的 applySyntheticStatus）。
// ★ 尺子盯五件事：① 映射双向；② 产物逐条可复核（收集 43 / 挡下 36，理由码齐全）；
//   ③ 逐句判据双向；④ 端到端**真的按原文概率落下**（雪女 8%/目标）且冻结真的阻止行动；
//   ⑤ 反向：两个指纹逐位不变 + 如实钉住没做到的部分（按名驱散、分支/随机取一）。
import fs from "node:fs";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";
import { loadTips, setTipsTable, tipsTable } from "../compile/tips.ts";
import { CONTROL_EFFECTS, StatusBook, isActionPrevented, controlDefByTipName } from "../kernel/status.ts";
import { controlSlotsForClause, normClauseText } from "../compile/skill-compiler.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { applySyntheticStatus } from "../compile/character.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const tipRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
setTipsTable(loadTips(Array.isArray(tipRaw) ? tipRaw : (Object.values(tipRaw).find((v: any) => Array.isArray(v)) as any[])));
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const IR = (input.skills as any[]).map((e: any) => ({ key: String(e.key), ir: JSON.parse(String(e.json)) }));
const irOf = (k: string) => IR.find((x) => x.key === k)!.ir;

sec("[1] 映射只有一份：tips 名 → 控制状态（controlDefByTipName）");
{
  ok("★★★ 16 种控制名全部映射到 CONTROL_EFFECTS 的 id",
    CONTROL_EFFECTS.every((d: any) => controlDefByTipName(d.name)?.id === d.id) && CONTROL_EFFECTS.length === 17,
    String(CONTROL_EFFECTS.length));
  ok("★★★ 双向：冰冻→freeze、眩晕→stun、变形→morph（拼写错一位就整族不落地）",
    controlDefByTipName("冰冻")?.id === "freeze" && controlDefByTipName("眩晕")?.id === "stun" && controlDefByTipName("变形")?.id === "morph",
    JSON.stringify([controlDefByTipName("冰冻")?.id, controlDefByTipName("眩晕")?.id, controlDefByTipName("变形")?.id]));
  ok("★★★ 反向：不是控制的名字 ⇒ null（护盾 / 基础概率 / 先机 / 空）",
    controlDefByTipName("护盾") === null && controlDefByTipName("基础概率") === null && controlDefByTipName("先机") === null && controlDefByTipName("") === null && controlDefByTipName(undefined as any) === null);
  ok("★★ 控制状态的定义带行为（冰冻 preventsAction / 沉默 preventsSkill / 嘲讽 forcesBasicAttack）",
    controlDefByTipName("冰冻")!.preventsAction && controlDefByTipName("沉默")!.preventsSkill && controlDefByTipName("嘲讽")!.forcesBasicAttack);
  ok("★★★ 而且「阻止行动」这条判据真的被回合循环读（不是只写在表里）",
    fs.readFileSync(path.join(ROOT, "battle-lab", "kernel", "battle.ts"), "utf8").split("\n").filter((l) => !l.trim().startsWith("*")).some((l) => /isActionPrevented\(/.test(l)) && isActionPrevented([controlDefByTipName("冰冻")!]));
}

sec("[2] 产物：45 条控制引用 / 32 条按理由挡下（逐条可复核；★ 第 242 轮把两条 CONDITIONAL_BRANCH 变成「已建模的条件变体」 ⇒ 34 → 32，见 g121）");
{
  const withRefs = IR.filter((x) => x.ir.controlRefs);
  const withSkips = IR.filter((x) => x.ir.controlSkips);
  const nRef = withRefs.reduce((n, x) => n + x.ir.controlRefs.length, 0);
  const nSkip = withSkips.reduce((n, x) => n + x.ir.controlSkips.length, 0);
  console.log("  技能 " + new Set([...withRefs, ...withSkips].map((x) => x.key)).size + " 个｜引用 " + nRef + "｜挡下 " + nSkip);
  ok("★★★ 收集 45 条 / 挡下 31 条（数量是事实，变了就要按事实改写：第 242 轮两条「转化为深度冰冻」落地 ⇒ 34 → 32；第 246 轮「失去 X 时结束 Y」落地 ⇒ 32 → 31）", nRef === 45 && nSkip === 31, JSON.stringify({ nRef, nSkip }));
  ok("★★★ 每一条引用的 ref 都是 CONTROL_EFFECTS 里的 id（绝不自造）",
    withRefs.every((x) => x.ir.controlRefs.every((r: any) => CONTROL_EFFECTS.some((d: any) => d.id === r.ref))),
    JSON.stringify(withRefs.flatMap((x) => x.ir.controlRefs.map((r: any) => r.ref)).filter((r: string) => !CONTROL_EFFECTS.some((d: any) => d.id === r))));
  ok("★★★ 每一条挡下都带理由码（绝不静默丢）",
    withSkips.every((x) => x.ir.controlSkips.every((s: any) => !!s.reason && !!s.clause && !!s.name)));
  const reasons = new Map<string, number>();
  for (const x of withSkips) for (const s of x.ir.controlSkips) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
  console.log("  按理由：" + JSON.stringify([...reasons.entries()].sort()));
  ok("★★★ 六类理由码都真的用到了（不是只有一个兜底桶）", reasons.size === 6, JSON.stringify([...reasons.keys()]));
  ok("★★ 概率/时长都是就地读的（要么数字、要么 null，不许 NaN）",
    withRefs.every((x) => x.ir.controlRefs.every((r: any) => (r.probability === null || Number.isFinite(r.probability)) && (r.duration === null || Number.isFinite(r.duration)))));
  const xuenv = irOf("201/201_03");
  /** ★★★ 第 242 轮：这一条多了 `variant` —— 8% 冰冻仍是基础效果位，但目标已带冰冻时按 30% **改写**成深度冰冻（尺子 g121） */
  ok("★★★ 雪女「暴风雪」逐条：8% 冰冻 1 回合落进 controlRefs，并挂上条件变体（freeze → deepFreeze @30%）",
    JSON.stringify(xuenv.controlRefs) === JSON.stringify([{ ref: "freeze", tipId: "101", name: "冰冻", duration: 1, probability: 8, bearer: "EFFECT_TARGET", clause: "并有8%[tips_2]将其[tips_101]1回合", variant: { when: { kind: "TARGET_HAS", statusId: "freeze" }, probability: 30, ref: "deepFreeze", name: "深度冰冻", evidence: "再次攻击被[tips_101]的目标时，有30%概率转化为[tips_112]" } }]),
    JSON.stringify(xuenv.controlRefs));
  ok("★★★ 剩下的两种**读法**按理由挡下（条件引用 / 则改为冰冻2回合的怪物变体）；「转化为深度冰冻」那一半已落地",
    JSON.stringify(xuenv.controlSkips.map((s: any) => s.reason)) === JSON.stringify(["REFERENCE_FORM", "CONDITIONAL_BRANCH"]) &&
    xuenv.controlSkips.some((s: any) => s.name === "冰冻" && s.reason === "CONDITIONAL_BRANCH"),
    JSON.stringify(xuenv.controlSkips.map((s: any) => [s.name, s.reason])));
  const lian = IR.find((x) => x.ir.charName === "镰鼬" && x.ir.controlSkips)!;
  ok("★★★ 随机取一（镰鼬「胖揍」三选一）**不施加**（施加了就是把 1/3 变成 100%）",
    lian.ir.controlSkips.some((s: any) => s.reason === "RANDOM_ONE_OF") && !lian.ir.controlRefs);
  const xiong = IR.find((x) => x.ir.charName === "神酿星熊童子" && x.ir.controlSkips)!;
  ok("★★★ 场地 perTurn 已经在做的那一句不重复施加（FIELD_PER_TURN）",
    xiong.ir.controlSkips.some((s: any) => s.reason === "FIELD_PER_TURN"));
  ok("★★ 只有带 controlRefs/controlSkips 的技能有这两个键（其余 762 条一个字不动）",
    IR.filter((x) => !x.ir.controlRefs && !x.ir.controlSkips).length === IR.length - new Set([...withRefs, ...withSkips].map((x) => x.key)).size);
}

sec("[3] 逐句判据 controlSlotsForClause：三种句子 + 缺证据的方向");
{
  const ir = irOf("201/201_03");
  const HIT = "并有8%[tips_2]将其[tips_101]1回合";
  const RESOLVED = "并有8%[基础概率]将其[冰冻]1回合";
  ok("★★★ 那一句 ⇒ [0]（只有这一条控制）", JSON.stringify(controlSlotsForClause(ir, HIT)) === "[0]", JSON.stringify(controlSlotsForClause(ir, HIT)));
  ok("★★★ 归一化：原文形态与解析形态同结论", JSON.stringify(controlSlotsForClause(ir, RESOLVED)) === JSON.stringify(controlSlotsForClause(ir, HIT)));
  ok("★★★ 无关句 ⇒ 空数组（这一句不施加任何控制）", JSON.stringify(controlSlotsForClause(ir, "造成攻击30%伤害")) === "[]");
  ok("★★★ fail-closed：没有控制引用的技能 ⇒ null（调用方不放这个键）",
    controlSlotsForClause({}, HIT) === null && controlSlotsForClause({ controlRefs: [] }, HIT) === null);
  ok("★★ 归一化函数本身：去掉非 buff 方括号", normClauseText("[tips_101]甲") === "甲");
}

sec("[4] 端到端：雪女的 8% 冰冻**真的按每目标 8%** 落下，而且冻结真的阻止行动");
const withUnit = (id: number, name: string) => { const m: any = JSON.parse(JSON.stringify(canonicalMatch())); m.red.units[0].shikigamiId = id; m.red.units[0].name = name; return m; };
const mk = async (seed: number) => {
  const a: any = assembleMatch(createKit(bundle), withUnit(201, "雪女"), { seed, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  const me = a.battle.teams[0].members[0];
  return { battle: a.battle, me, sk: me.skills.find((s: any) => s.name === "暴风雪"), foes: a.battle.enemiesOf(0) };
};
{
  let casts = 0, applied = 0, miss = 0, slots = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const b = await mk(950000 + i);
    b.battle.teams[0].orbs.gain(8);
    const before = b.battle.trace.length;
    await b.sk.execute(b.battle, b.me, b.foes[0]);
    const ev = b.battle.trace.slice(before);
    if (ev.some((e: any) => e.t === "SKILL_CAST" && e.skill === "暴风雪")) casts++;
    applied += ev.filter((e: any) => e.t === "STATUS_APPLY" && String(e.status) === "freeze").length;
    miss += ev.filter((e: any) => e.t === "CONTROL_MISS").length;
    slots += b.battle.rng.draws.filter((d: any) => /^control_prob:freeze:暴风雪:/.test(String(d.tag))).length;
  }
  const rate = applied / Math.max(1, applied + miss);
  console.log("  " + N + " 次施放：冰冻 " + applied + "｜未命中 " + miss + "｜实测命中率 " + (rate * 100).toFixed(1) + "%（原文 8%）");
  ok("★★★ 每一次判定都有标签进 RNG 账本（掷数 = 命中 + 未命中）", slots === applied + miss && slots > 0, JSON.stringify({ slots, applied, miss }));
  ok("★★★ 实测命中率落在 8% 的合理区间（0.03~0.16，二项分布；★ 此前是**一次都不施加**）", rate > 0.03 && rate < 0.16, String(rate));
  ok("★★★ 而且**不再**是 100%（那就是把 8% 读成了必定）", rate < 0.5, String(rate));
  // 冻结真的阻止行动：直接读那个单位的 statusDefs
  const b2 = await mk(950000);
  const def = controlDefByTipName("冰冻")!;
  b2.foes[0].addStatus(def, b2.me.id, 1, 1);
  ok("★★★ 冻上的单位 isActionPrevented=true（回合循环据此跳过它）", isActionPrevented(b2.foes[0].statusDefs()) === true);
  ok("★★ 对照：没冻的单位是 false", isActionPrevented(b2.foes[1].statusDefs()) === false);
  // 分类正确：是减益（走 hurt 那一路的承受者）
  ok("★★ 冰冻的类别是 DEBUFF_STATE（减益判定与状态那一段同源）", String(def.category) === "DEBUFF_STATE");
}

sec("[5] 免疫：带「免疫控制」的状态在场 ⇒ 控制被挡下并留痕");
{
  const b = await mk(950001);
  const kbBuffs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[];
  const raw = kbBuffs.find((x: any) => String(x.id) === "2193_1");
  ok("★★ 前置：KB 里有「免疫控制」的印记（2193_1 鬼王降临）", !!raw, String(raw?.id));
  if (raw) {
    const { compileBuff, toStatusDef } = await import("../compile/buff-compiler.ts");
    const cb: any = compileBuff(raw);
    ok("★★★ 前提：这个印记确实带 immuneTo=CONTROL", (cb.immuneTo ?? []).includes("CONTROL"), JSON.stringify(cb.immuneTo));
    const target = b.foes[0];
    target.addStatus(toStatusDef(cb), b.me.id, 1, 3);
    const before = b.battle.trace.length;
    await applySyntheticStatus(b.battle, b.me, target, {
      def: controlDefByTipName("冰冻")!, dur: 1, count: 1, effects: [], probability: null,
      probTag: "probe", missTrace: "CONTROL_MISS", ref: "CONTROL:freeze", extra: {}, skill: "暴风雪",
    });
    const ev = b.battle.trace.slice(before);
    ok("★★★ 免疫在场 ⇒ IMMUNE 留痕，冰冻**没有**加上", ev.some((e: any) => e.t === "IMMUNE") && !target.statusDefs().includes(controlDefByTipName("冰冻")!), JSON.stringify(ev.map((e: any) => e.t)));
  }
}

sec("[6] 反向：两个指纹逐位不变（典型对局里 0 个控制占位符命中）");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.run();
  ok("★★★ 默认档 2d7c7507e18db61f", stateHash(captureState(a.battle)) === "2d7c7507e18db61f", stateHash(captureState(a.battle)));
  const c: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "PARSED_CANDIDATES_ONLY" });
  await c.battle.runStartup(); await c.battle.run();
  ok("★★★ 被动档 7bc24506bdcd349e", stateHash(captureState(c.battle)) === "7bc24506bdcd349e", stateHash(captureState(c.battle)));
}

sec("[7] 如实钉住没做到的部分");
{
  const allSkips = IR.flatMap((x) => x.ir.controlSkips ?? []);
  ok("★★★ 按名字驱散具体控制（兔丸「守护之心」：驱散冰冻/沉睡/变形/眩晕/深度冰冻）仍是缺口 —— 记在理由里，不假装做了",
    allSkips.filter((s: any) => s.name === "冰冻" && /驱散/.test(String(s.clause))).length >= 1,
    JSON.stringify(allSkips.filter((s: any) => /驱散/.test(String(s.clause))).map((s: any) => s.reason)));
  ok("★★★ 「使攻击来源…」的控制（海忍「潜影」）**收进来了**，而且承受者标成 DAMAGE_SOURCE",
    IR.some((x) => x.ir.controlRefs?.some((r: any) => r.ref === "confuse" && r.bearer === "DAMAGE_SOURCE" && /攻击来源/.test(String(r.clause)))),
    JSON.stringify(IR.flatMap((x) => x.ir.controlRefs ?? []).filter((r: any) => r.bearer === "DAMAGE_SOURCE").map((r: any) => r.ref + "@" + r.clause)));
  ok("★★ 被挡下的引用**没有**被悄悄当成效果（controlRefs 里不含它们）",
    IR.every((x) => (x.ir.controlRefs ?? []).every((r: any) => !(x.ir.controlSkips ?? []).some((s: any) => s.clause === r.clause && s.name === r.name))));
}

console.log("\n=== 控制占位符: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;