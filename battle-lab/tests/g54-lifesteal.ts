// tests/g54-lifesteal.ts — ★★★ 吸血：从文案到回流生命（第 93 轮，目标 ⑨/①）
//
// 由来：全库 9 个技能写着「附带 N% 吸血」，而引擎此前**一行回流生命的代码都没有**
// （compile/unmodeled.ts 把「吸血」整类记为未建模）。三尾狐「诱惑」正是典型对局里
// 那条被拦住的被动 —— 拦它的理由就是 EFFECT（效果做不了）。
//
// 这一轮做三件事，缺一件都不算接线：
//   ① 编译：SkillIR.lifesteal（判据是**百分号紧贴「吸血」**；看着像吸血其实不是的必须有理由地跳过）；
//   ② 内核：伤害落账后 applyLifesteal 回流（基数/通道是红区 policies.lifesteal，**两条口径都实现**）；
//   ③ 被动：触发式吸血（造成伤害时）按 ctx.result.applied 结算，而且**失败关闭**（来源必须是本人）。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { UNMODELED } from "../compile/unmodeled.ts";
import { CAPABILITIES } from "../capability/registry.ts";
import { producerScanFiles, stripComments } from "../tools/field-census.ts";
import { LifestealPolicies, defaultPolicies, policySnapshot } from "../kernel/policies.ts";
import { DamageType } from "../kernel/types.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = "2d7c7507e18db61f";
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);
const sk = (t: string) => compileSkill(1, "T", { id: "1_01", name: "S", cost: 5, description: t, brief: "", upgrades: [] });

sec("[1] ★★★ 编译侧：全库「吸血」只有一种写法被收，另外 5 处必须有理由");
{
  let accepted: Array<{ who: string; ratio: number }> = [];
  const reasons: Record<string, number> = {};
  for (const s of LIST) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      const ir: any = compileSkill(s.id, s.name, k);
      if (ir.lifesteal) accepted.push({ who: s.name + "「" + k.name + "」", ratio: ir.lifesteal.ratio });
      for (const sk2 of (ir.lifestealSkips ?? [])) reasons[sk2.reason] = (reasons[sk2.reason] ?? 0) + 1;
    }
  }
  ok("★★★ 恰好收 6 条（不是 0 条而显得干净，也不是把 11 条都收进来）", accepted.length === 6, JSON.stringify(accepted));
  ok("★★★ 比例落在 (0,1] 内且各不相同（0.2 / 0.15 / 0.1 / 0.5 / 1 / 1）",
    accepted.every(a => a.ratio > 0 && a.ratio <= 1) &&
    new Set(accepted.map(a => a.ratio)).size === 5, JSON.stringify(accepted.map(a => a.ratio)));
  ok("★★★ 跳过 5 处：分支条件 3（形态/结界/使用条件）+ 看着像吸血其实不是 2",
    reasons.BRANCH_CONDITION === 3 && reasons.NOT_A_LIFESTEAL === 2 && !reasons.AMBIGUOUS,
    JSON.stringify(reasons));
  ok("★★★ 全库没有任何技能出现两个不同比例（AMBIGUOUS = 0 —— 有的话解析器会**整条不收**）",
    (reasons.AMBIGUOUS ?? 0) === 0, JSON.stringify(reasons));
  console.log("    收：" + accepted.map(a => a.who + " " + a.ratio).join("｜"));
  console.log("    跳过：" + JSON.stringify(reasons));

  // ── 假命中必须**点名**（这是本轮的判据核心：宽松写法会把它们一起收进来）
  const xueji = LIST.find((s: any) => s.name === "吸血姬");
  const xianxue = xueji.skills.find((k: any) => k.name === "鲜血之拥");
  const ir1: any = compileSkill(xueji.id, "吸血姬", xianxue);
  ok("★★★ 假命中①：式神名「吸血姬」里的两个字不算吸血（原文里的「不超过吸血姬攻击400%」）",
    !ir1.lifesteal && (ir1.lifestealSkips ?? []).some((k: any) => k.reason === "NOT_A_LIFESTEAL"),
    JSON.stringify({ ls: ir1.lifesteal, skips: ir1.lifestealSkips }));
  const ling: any = LIST.find((s: any) => s.name === "铃彦姬");
  const wushan = ling.skills.find((k: any) => k.name === "五山火祭");
  const ir2: any = compileSkill(ling.id, "铃彦姬", wushan);
  ok("★★★ 假命中②：「施放时无法触发治疗、X和吸血效果」是**抑制声明**，不是本技能在吸血",
    !ir2.lifesteal && (ir2.lifestealSkips ?? []).some((k: any) => k.reason === "NOT_A_LIFESTEAL"),
    JSON.stringify({ ls: ir2.lifesteal, skips: ir2.lifestealSkips }));
  // ── 反向自检：合成的真写法必须被收，合成的分支写法必须被跳过
  ok("★★★ 反向：合成的「附带30%吸血」必须被收（否则这是个「永远不收」的解析器）",
    sk("对敌方目标造成攻击100%伤害，附带30%吸血").lifesteal?.ratio === 0.3,
    JSON.stringify(sk("对敌方目标造成攻击100%伤害，附带30%吸血").lifesteal));
  ok("★★★ 反向：合成在**结界分支**里的写法必须被跳过（挂上去 = 无条件生效 = 多算）",
    sk("若开启封印结界，则攻击敌方目标2次，每次造成攻击80%伤害，15%吸血").lifesteal === null &&
    (sk("若开启封印结界，则攻击敌方目标2次，每次造成攻击80%伤害，15%吸血").lifestealSkips ?? []).some((k: any) => k.reason === "BRANCH_CONDITION"));
  ok("★★ 对照：完全没提吸血的技能，lifesteal 是 null 且没有任何跳过记录",
    sk("对敌方目标造成攻击100%的伤害").lifesteal === null && sk("对敌方目标造成攻击100%的伤害").lifestealSkips === null);
}

sec("[2] ★★ 红区 F：基数与通道是策略，不是代码里的常量");
{
  ok("★★★ 两条口径都在表里，且**基数不同**（否则「另一种口径」是假的）",
    LifestealPolicies.APPLIED_AS_HEAL.basis !== LifestealPolicies.TOTAL_BEFORE_SHIELD.basis,
    LifestealPolicies.APPLIED_AS_HEAL.basis + " vs " + LifestealPolicies.TOTAL_BEFORE_SHIELD.basis);
  ok("★★★ 默认是「实际扣除的生命 + 治疗通道」，且状态是 HYPOTHESIS（没有游戏内实测）",
    defaultPolicies().lifesteal.id === "APPLIED_AS_HEAL" && defaultPolicies().lifesteal.status === "HYPOTHESIS");
  ok("★★ 两条都写明了「原文没写这件事」（question 不是空话）",
    LifestealPolicies.APPLIED_AS_HEAL.question.length > 10 && LifestealPolicies.TOTAL_BEFORE_SHIELD.question.length > 10);
  const snap: any = policySnapshot(defaultPolicies());
  ok("★★★ policySnapshot 带着 basis 与 asRecover（产物里看得出这次用的哪种口径）",
    snap.lifesteal.basis === "HP_DAMAGE_APPLIED" && snap.lifesteal.asRecover === false, JSON.stringify(snap.lifesteal));
  ok("★★★ 多段口径**如实写在注释里**（第 93 轮实现的是逐段，合计口径未实现 —— 不假装它是可选项）",
    /逐段/.test(LifestealPolicies.APPLIED_AS_HEAL.evidence ?? "") || /逐段/.test(LifestealPolicies.APPLIED_AS_HEAL.question),
    LifestealPolicies.APPLIED_AS_HEAL.evidence);
}

// ── 内核级夹具：组装好的真实战斗（不是假单位），每次取新的一份
// ★ 第 93 轮：`full = true` 才会 `run()` 到底。
//   第一版 [7] 忘了这件事 —— 于是它比的是"开局刚结束"的状态指纹（3d0f8eaee0918a3e），
//   与锚点 2d7c7507e18db61f 对不上，还被读成"接线动了默认路径"。**夹具错了，结论就会错。**
async function fresh(passives: any = "NOT_EXECUTED", full = false) {
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives });
  await a.battle.runStartup();
  if (full) await a.battle.run();
  const ents = a.battle.allEntities();
  const src = ents.find((e: any) => e.shikigamiId === 202) ?? ents[0];       // 三尾狐（有吸血被动的那位）
  const dst = ents.find((e: any) => e.teamId !== src.teamId);
  return { battle: a.battle, src, dst, ents };
}

sec("[3] ★★★ 内核：伤害落账之后按比例回流（默认口径 = 实际扣除的生命）");
{
  const { battle, src, dst } = await fresh();
  src.hp = src.maxHp * 0.5;
  const hp0 = src.hp;
  const before = battle.trace.filter((t: any) => t.t === "LIFESTEAL").length;
  const res: any = await battle.damage(src, dst, 1000, DamageType.NORMAL, 1, { ratio: 0.5 });
  const healed = src.hp - hp0;
  ok("★★★ 回流量 == 比例 × **实际扣除**的伤害", Math.abs(healed - res.applied * 0.5) < 1e-6,
    "healed=" + healed + " applied=" + res.applied + " final=" + res.final);
  ok("★★★ 确实留下一条 LIFESTEAL 事件（Theater / Inspector 能看见它发生）",
    battle.trace.filter((t: any) => t.t === "LIFESTEAL").length === before + 1);
  const tr: any = battle.trace.filter((t: any) => t.t === "LIFESTEAL").pop();
  // ★ 事件里的 damage/healed 走 GameMath.display（界面显示整数）—— 所以容差是 **1**，不是 1e-6。
  //   真正精确的那条断言在上面（直接用 src.hp 的差值比）。
  ok("★★★ 事件里带着比例、基数与策略 id（不是只有一句「回血了」）",
    tr.ratio === 0.5 && tr.policy === "APPLIED_AS_HEAL" && Math.abs(tr.healed - res.applied * 0.5) <= 1,
    JSON.stringify(tr));

  // 上限：回血不能超过生命上限
  src.hp = src.maxHp - 10;
  const hp1 = src.hp;
  await battle.damage(src, dst, 5000, DamageType.NORMAL, 1, { ratio: 1 });
  ok("★★★ 回血被生命上限截断（不是无限回）", src.hp <= src.maxHp + 1e-6 && src.hp - hp1 <= 10 + 1e-6,
    "hp=" + src.hp + " maxHp=" + src.maxHp);

  // 比例 0 与死亡者：不许回流，也不许留一条假事件
  src.hp = src.maxHp * 0.5;
  const hp2 = src.hp;
  const n2 = battle.trace.filter((t: any) => t.t === "LIFESTEAL").length;
  await battle.damage(src, dst, 1000, DamageType.NORMAL, 1, { ratio: 0 });
  ok("★★★ 比例 0 == 没有吸血（而且**不留**事件 —— 否则计数会骗人）",
    Math.abs(src.hp - hp2) < 1e-9 && battle.trace.filter((t: any) => t.t === "LIFESTEAL").length === n2);
  src.hp = 0;
  const n3 = battle.trace.filter((t: any) => t.t === "LIFESTEAL").length;
  await battle.damage(src, dst, 1000, DamageType.NORMAL, 1, { ratio: 1 });
  ok("★★★ 已经阵亡的攻击方**不回流**（吸血的前提是打人的那个还活着）",
    src.hp === 0 && battle.trace.filter((t: any) => t.t === "LIFESTEAL").length === n3, "hp=" + src.hp);
}

sec("[4] ★★★ 两种基数口径**都真的被读到**（护盾吸收的那部分算不算）");
{
  const { battle, src, dst } = await fresh();
  dst.addShield({ value: 1e9, sourceId: 0 });     // 这一击会被护盾全吃掉
  src.hp = src.maxHp * 0.5;
  const hp0 = src.hp;
  const res: any = await battle.damage(src, dst, 1000, DamageType.NORMAL, 1, { ratio: 0.5 });
  ok("前置：这一击确实被护盾全吸收了（applied = 0，absorbed > 0）",
    res.applied === 0 && res.absorbed > 0, JSON.stringify({ applied: res.applied, absorbed: res.absorbed, final: res.final }));
  ok("★★★ 默认口径（实际扣除的生命）→ **一点血都不回**", Math.abs(src.hp - hp0) < 1e-9, "healed=" + (src.hp - hp0));
  battle.policies.lifesteal = LifestealPolicies.TOTAL_BEFORE_SHIELD;
  const hp1 = src.hp;
  const res2: any = await battle.damage(src, dst, 1000, DamageType.NORMAL, 1, { ratio: 0.5 });
  ok("★★★ 换成「伤害总量」口径 → 同一击真的回了血（说明 basis 是被读的，不是装饰）",
    Math.abs((src.hp - hp1) - res2.final * 0.5) < 1e-6,
    "healed=" + (src.hp - hp1) + " final=" + res2.final);
  battle.policies.lifesteal = LifestealPolicies.APPLIED_AS_HEAL;
  dst.shields.length = 0;
}

sec("[5] ★★★ 减疗与「治疗/恢复」通道（asRecover 也必须是被读的）");
{
  const { battle, src, dst } = await fresh();
  src.base.healDown = 0.5;
  src.hp = src.maxHp * 0.5;
  const hp0 = src.hp;
  const res: any = await battle.damage(src, dst, 1000, DamageType.NORMAL, 1, { ratio: 1 });
  const asHeal = src.hp - hp0;
  ok("★★★ 默认走**治疗**通道 → 被减疗 50% 砍掉一半（回流量 = 伤害 × 1 × 50%）",
    Math.abs(asHeal - res.applied * 0.5) < 1e-6, "healed=" + asHeal + " applied=" + res.applied);
  battle.policies.lifesteal = { ...LifestealPolicies.APPLIED_AS_HEAL, asRecover: true };
  src.hp = src.maxHp * 0.5;
  const hp1 = src.hp;
  const res2: any = await battle.damage(src, dst, 1000, DamageType.NORMAL, 1, { ratio: 1 });
  ok("★★★ 改成**恢复**通道 → 减疗不再生效（同一击回满比例）",
    Math.abs((src.hp - hp1) - res2.applied) < 1e-6, "healed=" + (src.hp - hp1) + " applied=" + res2.applied);
  battle.policies.lifesteal = LifestealPolicies.APPLIED_AS_HEAL;
  src.base.healDown = 0;
}

sec("[6] ★★★ 主动技能端到端：多段伤害是**逐段**结算的（铃鹿御前「万羽浪行」5 段 × 10%）");
{
  const m: any = canonicalMatch();
  m.red.units[0].shikigamiId = 351; m.red.units[0].name = "铃鹿御前";
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261001, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  const battle = a.battle;
  const atk = battle.allEntities().find((e: any) => e.shikigamiId === 351);
  const foes = battle.allEntities().filter((e: any) => e.teamId !== atk.teamId);
  const skl = atk.skills.find((s: any) => s.name === "万羽浪行");
  ok("前置：这个技能在 IR 里有伤害 5 段 + 吸血 10%",
    skl?.ir?.damage?.length === 1 && skl?.ir?.hits === 5 && skl?.ir?.lifesteal?.ratio === 0.1,
    JSON.stringify({ dmg: skl?.ir?.damage, hits: skl?.ir?.hits, ls: skl?.ir?.lifesteal }));
  battle.teams[atk.teamId].orbs.gain(8);
  atk.hp = atk.maxHp * 0.3;
  const before = battle.trace.filter((t: any) => t.t === "LIFESTEAL").length;
  await skl.execute(battle, atk, foes[0]);
  const ls = battle.trace.filter((t: any) => t.t === "LIFESTEAL");
  // ★ 「万羽浪行」是**全体**技能：5 段 × 5 个敌方目标 = 25 次伤害结算 —— 所以是 25 条，不是 5 条。
  //   第一版按"单体 5 段"写死了 5，运行结果 25 条 —— 断言错了，行为是对的（如实改断言，不改行为）。
  const expect = 5 * foes.length;
  ok("★★★ 一次技能产生 **" + expect + " 条** LIFESTEAL（5 段 × " + foes.length + " 个目标，逐段结算）",
    ls.length - before === expect, "新增 " + (ls.length - before) + " 条");
  ok("★★★ 每一条的比例都是 0.1，且回流量 ≈ 0.1 × 该段的实际伤害（展示值容差 1）",
    ls.slice(before).every((t: any) => t.ratio === 0.1 && Math.abs(t.healed - t.damage * 0.1) <= 1),
    JSON.stringify(ls.slice(before).map((t: any) => [t.damage, t.healed])));
  ok("★★★ 而且**确实**有回血发生（不是 5 条 0 回流的事件）",
    ls.slice(before).some((t: any) => t.healed > 0), JSON.stringify(ls.slice(before).map((t: any) => t.healed)));
}

sec("[7] ★★★ 被动端到端：三尾狐「诱惑」（造成伤害时 50% 概率 20% 吸血）");
{
  const off = await fresh("NOT_EXECUTED", true);
  const offHash = stateHash(captureState(off.battle));
  ok("★★★ OFF 档：指纹逐位不变（接线没有动默认路径）" + "", offHash === BASE, offHash);
  const on = await fresh("PARSED_CANDIDATES_ONLY", true);
  const onHash = stateHash(captureState(on.battle));
  /**
   * ★★★ 第 135 轮：**装上 1 条 → 3 条**。多出来的两条不是吸血，而是新接的「先机」族
   *   （tips_7 = 战斗开始时）：座敷童子「福运昌隆」(+1 鬼火) 与 聆海金鱼姬「凌波」(4 层印记)。
   *   ★ 与本节的主题无关但**必须一起盯**：本节验证的仍是"诱惑真的回流了生命"，
   *     而 ON/OFF 的差异现在同时来自这三条 —— 所以下面那条"胜负未变"的断言更有意义了
   *     （三条被动都生效，胜负与回合数仍然不变 ⇒ 它们改的是过程，不是这一局的结论）。
   */
  ok("★★★ 典型对局装上 **3** 条（诱惑 + 先机族两条：福运昌隆 / 凌波）",
    on.battle.passiveReport.installed.length === 3 &&
    ["诱惑", "福运昌隆", "凌波"].every(n => on.battle.passiveReport.installed.some((i: any) => i.skill === n)),
    JSON.stringify(on.battle.passiveReport.installed.map((i: any) => i.skill + "/" + i.event)));
  const ls = on.battle.trace.filter((t: any) => t.t === "LIFESTEAL");
  ok("★★★ 它在战斗里**真的回流了生命**（≥3 条 LIFESTEAL 事件）", ls.length >= 3, String(ls.length));
  const lure = on.battle.allEntities().find((e: any) => e.shikigamiId === 202);
  ok("★★★ 每一条的来源都是**那个被动拥有者自己**（失败关闭：不是「谁挨打谁回血」）",
    ls.every((t: any) => t.src === lure.id), JSON.stringify([...new Set(ls.map((t: any) => t.src))]));
  ok("★★★ 比例都是 20%，且回流量 ≤ 比例 × 伤害（上限截断时更小；展示值容差 1）",
    ls.every((t: any) => t.ratio === 0.2 && t.healed <= t.damage * 0.2 + 1));
  ok("★★★ 至少有一条是**足额**回流（证明不是全被上限截断成 0）",
    ls.some((t: any) => Math.abs(t.healed - t.damage * 0.2) <= 1), JSON.stringify(ls.map((t: any) => [t.damage, t.healed])));
  /**
   * ★★★ 第 135 轮：这条断言**按事实收窄**了。原来写的是"指纹不同且**胜负未变**"——
   *   当时 ON 档只有一条吸血被动（只改过程、不改结论）。第 135 轮「先机」族接线之后，
   *   典型对局里多了两条**开局就生效**的被动（座敷童子开局 +1 鬼火、聆海金鱼姬开局 4 层印记），
   *   实测结论**真的翻转了**（OFF winner=1、ON winner=0）—— 这正是"它们真的在做事"的证据，
   *   而不是需要抹平的异常。所以现在断言：指纹必须不同，**并且把胜负是否改变如实报出来**。
   */
  ok("★★★ ON 与 OFF 的指纹**不同**（这次不同是因为真的做了事：吸血 + 两条先机被动）",
    onHash !== offHash, "ON " + onHash + " vs OFF " + offHash);
  /**
   * ★★★ 第 190 轮：这条断言**按事实再收窄一次**。
   *   第 135 轮它写的是「胜负变了 **或** 胜负与回合数都没变」—— 那是在「开局跑了两遍」的产物上写的：
   *   本轮给 runStartup 加了幂等闸门（runStartup(); run() 此前会跑两遍开局），
   *   于是 ON 档从「OFF winner=1 / ON winner=0」变成「两边都是 winner=0，但回合数 59 → 53」。
   *   判据改成与意图一致的那一条：**ON 与 OFF 的结论必须真的不同**（胜者或回合数至少一个不同）。
   */
  ok("★★★ 胜负/回合数的差异**如实记录**，且 ON 与 OFF 的结论确实不同（OFF winner=" + off.battle.winner + "/" + off.battle.turn +
    " 回合、ON winner=" + on.battle.winner + "/" + on.battle.turn + " 回合）",
    on.battle.winner !== off.battle.winner || on.battle.turn !== off.battle.turn,
    JSON.stringify({ off: [off.battle.winner, off.battle.turn], on: [on.battle.winner, on.battle.turn] }));
  console.log("    诱惑 20%：LIFESTEAL " + ls.length + " 条，回血合计 " +
    ls.reduce((a: number, t: any) => a + t.healed, 0).toFixed(0) + "｜ON 指纹 " + onHash);
  // 失败关闭的另一半：源码里那道来源校验（这是**源码扫描**，行为面由上面那条 src 断言守）
  const pr = stripComments(fs.readFileSync(path.join(ROOT, "battle-lab", "compile", "passive-runtime.ts"), "utf8"));
  ok("★★ 处理器里有**失败关闭**的来源校验（ctx.input.source.id === e.id）—— 源码扫描，非行为断言",
    /input\?\.source\?\.id === e\.id/.test(pr));
}

sec("[8] ★★ 登记册跟着事实走：未建模表里没有吸血了，能力表说 FULL");
{
  ok("★★★ compile/unmodeled.ts 里不再有「吸血」（它现在有行为代码）",
    !UNMODELED.some(m => m.verb === "吸血"), JSON.stringify(UNMODELED.map(m => m.verb)));
  ok("★★ 但**别的**机制还在（不是把整张表清空了）", UNMODELED.length >= 15, String(UNMODELED.length));
  const cap = CAPABILITIES.find(c => c.key === "LIFESTEAL")!;
  ok("★★★ 能力表：吸血从 NONE 升为 FULL，且给了 producer", cap.support === "FULL" && !!cap.producer, JSON.stringify(cap));
  const prod = producerScanFiles(ROOT).map(f => stripComments(fs.readFileSync(f, "utf8"))).join("\n");
  ok("★★★ 那个 producer 真的出现在生产代码里（FULL 不许是空口声明，tests/g22 同一条判据）",
    new RegExp(cap.producer!).test(prod));
  ok("★★ 而反伤/闪避/孤立仍然是 NONE（这一轮只动了吸血一个）",
    ["REFLECT", "DODGE", "ISOLATE"].every(k => CAPABILITIES.find(c => c.key === k)!.support === "NONE"));
}

console.log("\n=== 吸血: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
