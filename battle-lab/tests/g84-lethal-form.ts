// tests/g84-lethal-form.ts — ★★★ 第 130 轮：**致命伤害拦截**（自身形态 / 上限 / 记账 / 治疗闸门）
//
// 三条实测推着这一轮走（每条都是探针先跑出来的）：
//   ① forms[].trigger === "ON_LETHAL" 全库 2 处 —— 须佐之男「神之领域」（镇压别人，第 103 轮已接线）
//      与百羽凤凰火「未熄羽」（换掉自己）——**后者一直没有执行点**（探针 tools/_probe-onlethal130.ts：
//      挨致命一击时 dead=true / transformed=false / 场上没有召唤物，连一条 FORM_* 都没有）。
//   ② 接线之后立刻冒出两个"多算"：进入次数没有上限（原文写「至多可进入1次」）、
//      以及形态回归时本体因为被治疗过而从"0 血"变成"16767 血"回来（原文写的是**复活**）。
//   ③ 全库还有 5 条「受到致命伤害时…」子句**既没有执行点、也没有任何记账** —— 自称"完整编译"。
import fs from "node:fs";
import path from "node:path";
import { compileSkill, LETHAL_GUARD_VERB } from "../compile/skill-compiler.ts";
import { parseSummonSpec } from "../kernel/summon.ts";
import { loadTips, setTipsTable } from "../compile/tips.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { newUnitId } from "../../apps/web/src/contracts/guessing-match.ts";
import { healTarget } from "../kernel/damage.ts";
import { returnForm, removeSummon } from "../kernel/summon.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const tipsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
const tipsArr: any[] = Array.isArray(tipsRaw) ? tipsRaw : (Object.values(tipsRaw).find((v: any) => Array.isArray(v)) as any[]);
const tips = loadTips(tipsArr);
setTipsTable(tips);
const skillIR = (who: string, skill: string) => {
  const s = LIST.find((x: any) => x.name === who)!;
  const sk = (s.skills ?? []).find((x: any) => x.name === skill)!;
  return compileSkill(s.id, s.name, sk);
};
const allIR = () => {
  const out: Array<{ who: string; skill: string; ir: any }> = [];
  for (const s of LIST) for (const sk of (s.skills ?? [])) out.push({ who: s.name, skill: sk.name, ir: compileSkill(s.id, s.name, sk) });
  return out;
};

sec("[1] ★★★ 编译与记账：谁有执行点、谁必须被记账（两个方向都查）");
{
  const withForms = allIR().filter(x => (x.ir.forms ?? []).some((f: any) => f.trigger === "ON_LETHAL"));
  ok("★★★ 全库 ON_LETHAL 形态恰好 2 处（须佐之男/雷冢 与 百羽凤凰火/余烬）",
    withForms.length === 2, JSON.stringify(withForms.map(x => x.who + "「" + x.skill + "」")));
  const seal = withForms.find(x => x.who === "须佐之男")!;
  const self = withForms.find(x => x.who === "百羽凤凰火")!;
  ok("★★ 两处的 placement 不同：敌方（镇压式） vs 自身（换人）",
    seal.ir.forms[0].placement === "ENEMY" && self.ir.forms[0].placement === "SELF",
    JSON.stringify([seal.ir.forms[0].placement, self.ir.forms[0].placement]));

  const emberTip = tipsArr.find((t: any) => String(t.id) === "6071")!;
  const emberSpec: any = parseSummonSpec(emberTip);
  ok("★★★ 余烬规格读出「至多可进入1次」⇒ maxEntries = 1", emberSpec?.maxEntries === 1, JSON.stringify(emberSpec?.maxEntries));
  ok("★★★ 反向：这句话**不再**被算成 oncePerTarget（那是镇压式『同一式神该效果只可生效1次』的字段）",
    emberSpec?.oncePerTarget === false, JSON.stringify(emberSpec?.oncePerTarget));
  const sealTip = tipsArr.find((t: any) => String(t.id) === "3896")!;
  const sealSpec: any = parseSummonSpec(sealTip);
  ok("★★ 对照：雷冢的 oncePerTarget 仍然是 true（『同一式神该效果只可生效1次』照旧生效）",
    sealSpec?.oncePerTarget === true && sealSpec?.maxEntries === null,
    JSON.stringify({ once: sealSpec?.oncePerTarget, max: sealSpec?.maxEntries }));

  ok("★★★ 有执行点的两条**都不报**「致命伤害拦截」",
    ![...(seal.ir.unmodeledMechanics ?? []), ...(self.ir.unmodeledMechanics ?? [])].some((m: any) => m.verb === LETHAL_GUARD_VERB),
    JSON.stringify([seal.ir.unmodeledMechanics, self.ir.unmodeledMechanics].map((a: any) => a.map((m: any) => m.verb))));
  const flagged = allIR().filter(x => (x.ir.unmodeledMechanics ?? []).some((m: any) => m.verb === LETHAL_GUARD_VERB));
  /**
   * ★★★ 第 131 轮：这一条按事实收窄了 —— 伊邪那美「神赐之吻」**已经接线**
   *   （SkillIR.allyGuard + kernel/ally-guard.ts，见 tests/g85-ally-guard.ts），
   *   所以它不再报缺口，被记账的从 5 条变成 **4 条**。
   */
  /**
   * ★★★ 第 187 轮**按事实收窄**：石长姬「磐长纪」**已经接线**（SkillIR.lethalConsume + kernel/lethal-consume.ts，
   *   见 tests/g109-lethal-consume.ts）⇒ 它不再报缺口，被记账的从 4 条变成 **3 条**。
   */
  ok("★★★ 没有执行点的 3 条**全部**被记账（缚骨清姬/蝉冰雪女/空相面灵气）",
    flagged.length === 3 && ["缚骨清姬", "蝉冰雪女", "空相面灵气"].every(n => flagged.some(x => x.who === n)),
    JSON.stringify(flagged.map(x => x.who + "「" + x.skill + "」")));
  ok("★★★ 反向：伊邪那美「神赐之吻」**不再**报缺口（它现在有执行点 —— 第 131 轮接线）",
    !flagged.some(x => x.who === "伊邪那美"), JSON.stringify(flagged.map(x => x.who)));
  ok("★★★ 而且每条记录都带 severity=WARN 与那一句原文（面板要能说清缺的是哪一句）",
    flagged.every(x => (x.ir.unmodeledMechanics ?? []).some((m: any) => m.verb === LETHAL_GUARD_VERB && m.severity === "WARN" && /受到致命伤害/.test(String(m.clause)))),
    JSON.stringify(flagged.map(x => (x.ir.unmodeledMechanics ?? []).find((m: any) => m.verb === LETHAL_GUARD_VERB)?.clause?.slice(0, 30))));
  ok("★★ 反向：入内雀「附身」**不**报这一条（动词表已经记了它的「免疫 / 转移」—— 一处缺口一条记录）",
    !(skillIR("入内雀", "附身").unmodeledMechanics ?? []).some((m: any) => m.verb === LETHAL_GUARD_VERB),
    JSON.stringify((skillIR("入内雀", "附身").unmodeledMechanics ?? []).map((m: any) => m.verb)));

  const ember = skillIR("百羽凤凰火", "未熄羽");
  const skips = (ember.formSkips ?? []).map((x: any) => x.reason + "|" + String(x.evidence));
  ok("★★★ 余烬 tips 里的回归收益（对敌方全体附加2层[淬火] + 获得2点鬼火）**被记账**（TIPS_CLAUSE_NOT_MODELED）",
    skips.some((s: string) => s.includes("TIPS_CLAUSE_NOT_MODELED") && s.includes("淬火")),
    JSON.stringify(skips));
  ok("★★★ 反向：已经实现的那些（免疫 / 速度 / 胜负判定 / 至多进入1次）**不许**出现在 formSkips 里",
    !skips.some((s: string) => /免疫|速度|视为战斗失败|至多可进入/.test(s)), JSON.stringify(skips));

  ok("★★★ 百羽凤凰火 IR 带 noHeal（「无法被治疗或[tips_20]生命」）", !!ember.noHeal, JSON.stringify(ember.noHeal));
  ok("★ 全库只有 1 条这种写法（量出来的）",
    allIR().filter(x => x.ir.noHeal).length === 1,
    JSON.stringify(allIR().filter(x => x.ir.noHeal).map(x => x.who)));
}

const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return {
    unitId: newUnitId(), shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 20000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 },
    soulId: null,
  };
};

async function arena(who: string, seed = 21) {
  const m: any = canonicalMatch();
  m.red.units[0] = unit(who);
  const a: any = assembleMatch(createKit(bundle), m, { seed, traceLevel: "FULL" });
  await a.battle.runStartup();
  return { battle: a.battle, e: a.battle.teams[0].members[0], foe: a.battle.teams[1].members[0] };
}
const slay = async (b: any, e: any, killer: any) => { e.hp = 0; e.hpZero = true; await b.resolveLethal(e, killer.id); };

sec("[2] ★★★ 实战：致命伤害 ⇒ 本体离场、余烬上场（这次死亡不结算）");
{
  const { battle: b, e, foe } = await arena("百羽凤凰火");
  const posBefore = b.timeline.get(e.id)?.pos;
  await slay(b, e, foe);
  ok("★★★ 本体**没有**死（死亡被拦截，走的是转化而不是结算）", e.dead === false && e.alive === true, JSON.stringify({ dead: e.dead, alive: e.alive }));
  ok("★★★ 留下 LETHAL_FORM 痕迹（含回归时机与本次不结算的说明）",
    b.trace.some((t: any) => t.t === "LETHAL_FORM" && t.returnOn === "TIMELINE_END"), JSON.stringify(b.trace.find((t: any) => t.t === "LETHAL_FORM")));
  const ember = b.teams[0].summons.find((x: any) => x.notes.includes("summon:6071"));
  ok("★★★ 余烬真的上场了（FORM_ENTER + 召唤物在册）", !!ember && b.trace.some((t: any) => t.t === "FORM_ENTER" && t.summon === ember.id), String(!!ember));
  ok("★★★ 本体离场：transformed=true + 不可被选中 + 带离场状态 + notes 记了离场",
    e.transformed === true && e.caps.canBeTargeted === false &&
    e.statuses.some((s: any) => s.def.id === "form_off_field") && e.notes.includes("offField:form:6071"),
    JSON.stringify({ transformed: e.transformed, targetable: e.caps.canBeTargeted, notes: e.notes }));
  ok("★★★ 「继承…在行动条的位置」：形态与本体在同一个位置（本次为 0）",
    b.timeline.get(ember.id)?.pos === posBefore, JSON.stringify({ posBefore, ember: b.timeline.get(ember.id)?.pos }));
  ok("★★ 余烬带着 4 种免疫（伤害/减益/控制/放逐）且不计入胜负（「若场上只有余烬视为战斗失败」）",
    (ember.statuses ?? []).length === 4 && ember.caps.countsForVictory === false,
    JSON.stringify({ immune: (ember.statuses ?? []).map((s: any) => s.def.id), victory: ember.caps.countsForVictory }));
  ok("★★ 速度 = 本体 + 100（tips：「提升100点速度」）", ember.speed === e.speed + 100, JSON.stringify({ owner: e.speed, ember: ember.speed }));
  ok("★★ 进入次数已记账（form-entered:6071 —— 它是存档字段，续跑不会清零）",
    e.notes.includes("form-entered:6071"), JSON.stringify(e.notes.filter((n: string) => n.startsWith("form-entered"))));
}

sec("[3] ★★★ 上限：第二次致命伤害 ⇒ 不许再进（原文「至多可进入1次」）");
{
  const { battle: b, e, foe } = await arena("百羽凤凰火");
  await slay(b, e, foe);
  const ember = b.teams[0].summons[0];
  await returnForm(b, ember, "TIMELINE_END");
  await removeSummon(b, ember, "FORM_RETURN:TIMELINE_END");
  ok("★ 前置：回归之后本体活着（1 点血）且在行动条上", e.alive && !e.transformed && !!b.timeline.get(e.id), JSON.stringify({ hp: e.hp, dead: e.dead }));
  await slay(b, e, foe);
  const limitSkip = b.trace.find((t: any) => t.t === "FORM_SKIPPED" && t.reason === "ENTRY_LIMIT");
  ok("★★★ 第二次**进不去**形态：FORM_SKIPPED / ENTRY_LIMIT（带 entered 与 limit）",
    !!limitSkip && limitSkip.entered === 1 && limitSkip.limit === 1, JSON.stringify(limitSkip));
  ok("★★★ 这一次真的死了（拦截用完了就不再拦 —— 不许变成无限免死）", e.dead === true, JSON.stringify({ dead: e.dead }));
  ok("★★ 场内没有新的活着的余烬", b.teams[0].summons.filter((x: any) => x.notes.includes("summon:6071") && x.alive).length === 0, "");
}

sec("[4] ★★★ 回归：形态到达行动条终点 ⇒ 本体**复活**、形态离场");
{
  const { battle: b, e, foe } = await arena("百羽凤凰火");
  await slay(b, e, foe);
  const ember = b.teams[0].summons[0];
  const t0 = b.trace.length;
  await b.run();
  const ret = b.trace.slice(t0).find((t: any) => t.t === "FORM_RETURN");
  ok("★★★ TIMELINE_END 触发了 FORM_RETURN", !!ret && ret.reason === "TIMELINE_END", JSON.stringify(ret));
  ok("★★★ 本体是**复活**回来的：1 点生命 + returnHp=DEFAULT_1（KB 没写回归生命值 ⇒ 按最低可存活值并如实记账）",
    ret?.hp === 1 && ret?.returnHp === "DEFAULT_1", JSON.stringify({ hp: ret?.hp, returnHp: ret?.returnHp }));
  ok("★★★ 形态**离场**（否则它是一具打不死、永远占着行动条的空壳）",
    b.trace.some((t: any) => t.t === "SUMMON_REMOVE" && t.summon === ember.id && t.reason === "FORM_RETURN:TIMELINE_END") &&
    !b.teams[0].summons.some((x: any) => x.id === ember.id && x.alive),
    JSON.stringify(b.trace.filter((t: any) => t.t === "SUMMON_REMOVE").map((t: any) => t.reason)));
  ok("★★ 而且它没有走死亡链（移除路径：没有 KILLED / 没有阵亡结算）",
    !b.trace.some((t: any) => t.t === "KILLED" && t.id === ember.id), "");
}

sec("[5] ★★★ 治疗闸门：「无法被治疗」与「已离场」都不落地（两道闸门分开验）");
{
  const { battle: b, e, foe } = await arena("百羽凤凰火");
  ok("★★★ 能力位在**装配路径**上落地了（竞猜口径的单位是 makeGuessingEntity 造的，不是 buildCharacter 的实体）",
    e.caps.receivesHeal === false && e.notes.some((n: string) => n.startsWith("noHeal:")),
    JSON.stringify({ receivesHeal: e.caps.receivesHeal, notes: e.notes.filter((n: string) => n.startsWith("noHeal")) }));
  e.hp = 1000;
  const healed = await healTarget(b, e, e, 5000);
  ok("★★★ 闸门①：治疗量 0（原文「无法被治疗或恢复生命」）且留下 HEAL_SKIPPED / CANNOT_BE_HEALED",
    healed === 0 && e.hp === 1000 && b.trace.some((t: any) => t.t === "HEAL_SKIPPED" && t.dst === e.id && t.reason === "CANNOT_BE_HEALED"),
    JSON.stringify({ healed, hp: e.hp }));
  const mate = b.teams[0].members[1];
  mate.hp = 1000;
  const hMate = await healTarget(b, e, mate, 5000);
  ok("★ 反向：同一个 API 对**能治疗**的队友照常生效（否则上面那条可能只是治疗坏了）",
    hMate > 0 && mate.hp > 1000, JSON.stringify({ hMate, hp: mate.hp }));

  await slay(b, e, foe);
  e.caps.receivesHeal = true;   // ★ 临时让开第一道闸门，才能单独验第二道（不是掩盖）
  const before = e.hp;
  const h2 = await healTarget(b, e, e, 5000);
  ok("★★★ 闸门②：离场的本体（notes 里的 offField:form:）同样不接受治疗 —— HEAL_SKIPPED / OFF_FIELD",
    h2 === 0 && e.hp === before && b.trace.some((t: any) => t.t === "HEAL_SKIPPED" && t.reason === "OFF_FIELD"),
    JSON.stringify({ h2, before, hp: e.hp }));
}

sec("[6] ★★ 默认档没有被动运行时也不受影响（这一轮的能力位与形态都不依赖被动策略）");
{
  const m: any = canonicalMatch();
  m.red.units[0] = unit("百羽凤凰火");
  const a: any = assembleMatch(createKit(bundle), m, { seed: 21, traceLevel: "FULL", passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  const b = a.battle, e = b.teams[0].members[0];
  await slay(b, e, b.teams[1].members[0]);
  ok("★★★ 被动策略关闭时，致命伤害转化**照样生效**（它不是被动技能运行时的一部分）",
    e.transformed === true && b.teams[0].summons.some((x: any) => x.notes.includes("summon:6071")),
    JSON.stringify({ transformed: e.transformed, summons: b.teams[0].summons.map((x: any) => x.name) }));
}

console.log("\ng84-lethal-form: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
