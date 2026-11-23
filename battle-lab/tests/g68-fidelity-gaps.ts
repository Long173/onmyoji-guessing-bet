// tests/g68-fidelity-gaps.ts — ★★★ 第 112 轮：**引擎记下的缺口必须出现在每局 Fidelity 报告里**（目标 ①）
//
// 由来：Fidelity 的 SKILL 层算「完整编译（无可执行缺口）」时只看「有没有未解析句」，
//   而引擎**明确跳过**的记录（formSkips / stealSkips）**到不了报告** —— 于是含千姬（海原贝戟的反应式光环没做）、
//   绘世花鸟卷（浮生画影没接）的阵容，在报告里显示「完整编译」。引擎诚实地记了，报告却没看见。
//
// 另一件事：缺口的**严重度**此前硬编码在报告层（两个名字的名单），一定会与动词表分叉，
//   而分叉方向是把要紧的缺口标成 INFO；这一轮改成「跟着记录走」。
import fs from "node:fs";
import path from "node:path";
import { charInfo, createKit } from "../../apps/web/src/engine/assemble.ts";
import { assessFidelity } from "../kernel/fidelity.ts";
import { compileSkill } from "../compile/skill-compiler.ts";
import { setTipsTable, loadTips } from "../compile/tips.ts";
import { UNMODELED } from "../compile/unmodeled.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const tipsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
const tips: any[] = Array.isArray(tipsRaw) ? tipsRaw : (Object.values(tipsRaw).find((v: any) => Array.isArray(v)) as any[]);
setTipsTable(loadTips(tips));
const kit = createKit(bundle);
const irOf = (shiki: string, skill: string) => {
  const s = KB.find((x: any) => x.name === shiki)!;
  const k = (s.skills ?? []).find((y: any) => y.name === skill)!;
  return compileSkill(s.id, s.name, k) as any;
};
const unitOf = (name: string, id: number, side: string) => {
  const info = charInfo(kit, id);
  return {
    name, side, panelFilled: 4, soul: null,
    skills: info.skillDetails.map((s: any) => ({ ...s, confidence: s.confidence })),
    ai: { dataPresent: true, compiled: true, confidence: info.aiConfidence, gameVerified: false },
  };
};

sec("[1] 说明表的反复制守卫（第 112 轮那次事故的可执行防线）")
{
  const tbl: Record<string, string> = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "tools", "compile-explain.json"), "utf8"));
  const keys = Object.keys(tbl);
  ok("★★ 前置：说明表非空（否则下面两条是平凡通过）", keys.length > 50, String(keys.length));
  const byText = new Map<string, string[]>();
  for (const k of keys) { const t = String(tbl[k]); byText.set(t, [...(byText.get(t) ?? []), k]); }
  const pasted = [...byText.entries()].filter(([, ks]) => ks.length > 3);
  ok("★★★ 没有任何一条说明被复制到 4 个以上的键（一次批量写入覆盖历史说明，正是这么发生的）",
    pasted.length === 0, JSON.stringify(pasted.slice(0, 2).map(([, ks]) => ks.slice(0, 3))));
  const short = keys.filter(k => String(tbl[k]).trim().length < 40);
  ok("★★★ 每条说明都写满了（≥ 40 字）—— 空话不算说明", short.length === 0, JSON.stringify(short.slice(0, 5)));
  ok("★★ 说明表里没有错位键（键只能是 skills:… 或 buffs:…）",
    keys.filter(k => !k.startsWith("_")).every(k => /^(skills|buffs):/.test(k)), JSON.stringify(keys.filter(k => !k.startsWith("_") && !/^(skills|buffs):/.test(k)).slice(0, 5)));
}

sec("[2] 严重度跟着记录走（不在报告层维护名字名单）")
{
  /**
   * ★★★ 第 129 轮：这一条的**被查对象按事实改写了**。
   *   原文用 九命猫「九命」当例子 —— 而这一轮它的复活**已经接线**（IR 里 selfRevive，
   *   运行时由 kernel/self-revive.ts 执行），那一条 复活 记录**不再存在**（下面反转断言盯着它）。
   *   仍然报缺口的例子换成 跳跳妹妹「不玩了啦」：它的复活要看"番茄在场"（召唤物容器），
   *   生命比例也没写 ⇒ 按 fail-closed 判据保持未建模。
   */
  const rev = irOf("跳跳妹妹", "不玩了啦");
  const revM = (rev.unmodeledMechanics ?? []).find((m: any) => m.verb === "复活");
  ok("★★★ 「复活」这类影响胜负的缺口在 IR 里带 severity=WARN", !!revM && revM.severity === "WARN", JSON.stringify(revM));
  /** 反向：已经接线的那两条**不再**报"复活未建模"（否则报告会把已实现的算成缺口） */
  const modeled: string[] = [];
  for (const [who, skill] of [["九命猫", "九命"], ["骨女", "怨生"]] as Array<[string, string]>) {
    const ir: any = irOf(who, skill);
    if (!ir.selfRevive) modeled.push(who + "「" + skill + "」少了 selfRevive");
    if ((ir.unmodeledMechanics ?? []).some((m: any) => m.verb === "复活")) modeled.push(who + "「" + skill + "」仍然报复活未建模");
  }
  ok("★★★ 反向：接线了的两条（九命猫/骨女）IR 里有 selfRevive 且**不再**报复活缺口", modeled.length === 0, JSON.stringify(modeled));
  /**
   * ★★★ 第 135 轮：这条的被查对象按事实换了 —— 九命猫那句「并对随机敌方目标施放『X』」
   *   已经接线（SkillIR.subCasts + kernel/sub-cast.ts，tests/g89 双向验证），所以它**不再**报缺口。
   *   仍然报缺口的例子换成 **辉夜姬「火鼠裘」**（「[先机]：施放『[skill_280_03]』」）：
   *   它的施放**没写打谁** ⇒ 读不出目标 ⇒ 按 fail-closed 不收，由动词表具名记账。
   */
  const half = (irOf("辉夜姬", "火鼠裘").unmodeledMechanics ?? []).find((m: any) => m.verb === "追加施放");
  ok("★★★ 仍然没有执行点的施放子句继续报缺口（追加施放，WARN）—— 部分实现要能说清是哪一半",
    !!half && half.severity === "WARN", JSON.stringify(half));
  ok("★★ 反向：九命猫那条**不再**报（它现在真的会施放）",
    !(irOf("九命猫", "九命").unmodeledMechanics ?? []).some((m: any) => m.verb === "追加施放"),
    JSON.stringify((irOf("九命猫", "九命").unmodeledMechanics ?? []).map((m: any) => m.verb)));
  const zn = irOf("慧明灯", "正念");
  const aura = (zn.unmodeledMechanics ?? []).find((m: any) => m.verb === "在场光环");
  ok("★★★ 编译器合成的记录（在场光环）自己声明 WARN —— 它不在动词表里，更不可能在旧名单里",
    !!aura && aura.severity === "WARN", JSON.stringify(aura));
  ok("★★ 动词表里声明 WARN 的动词非空（severity 是表里的一份事实）",
    UNMODELED.filter((e: any) => e.severity === "WARN").length >= 5,
    JSON.stringify(UNMODELED.filter((e: any) => e.severity === "WARN").map((e: any) => e.verb)));
}

sec("[3] 引擎跳过的记录进 SKILL 层：点名单位，且不许再算「完整编译」")
{
  const qj = KB.find((s: any) => s.name === "千姬");
  const hs = KB.find((s: any) => s.name === "绘世花鸟卷");
  const f: any = assessFidelity({
    units: [unitOf("千姬", qj.id, "red"), unitOf("绘世花鸟卷", hs.id, "blue")],
    ruleset: [{ id: "COMMUNITY_2020_UNVERIFIED", status: "UNKNOWN" }],
    capabilities: [],
    displayPrecision: "INTEGER_OBSERVED",
  } as any);
  const skill = f.layers.find((l: any) => l.layer === "SKILL");
  const texts = skill.gaps.map((g: any) => g.what).join(" | ");
  /**
   * ★★★ 第 113 轮：这条**按事实改写** —— 海原贝戟的反应式光环已经实现，所以千姬的跳过记录
   *   从 PRESENCE_AURA_NOT_MODELED 变成了 TIPS_CLAUSE_NOT_MODELED（剩下没接的是「潮声」叠层那句）。
   *   这正是「做一半要说清是哪一半」：记录换了名字，但仍然点名单位、仍然在报告里。
   */
  ok("★★★ 千姬「海潮入梦」的跳过记录出现在报告里，并点名单位",
    /跳过记录：TIPS_CLAUSE_NOT_MODELED/.test(texts) && /千姬/.test(texts), texts.slice(0, 240));
  ok("★★★ 绘世花鸟卷的 NOT_A_SUMMON_SPEC 同理", /跳过记录：NOT_A_SUMMON_SPEC/.test(texts));
  ok("★★★ 统计行写明「含引擎明确跳过的技能」有几条",
    skill.counts.some((c: any) => /明确跳过/.test(c.label) && Number(c.value) >= 2),
    JSON.stringify(skill.counts.map((c: any) => c.label + "=" + c.value)));
  ok("★★★ 这些缺口带的是 WARN（不是 INFO）",
    skill.gaps.filter((g: any) => /跳过记录/.test(g.what)).every((g: any) => g.severity === "WARN"));
  /**
   * ★ 断言按事实写：这一局的 SKILL 层是 **GAPS 或 PARTIAL**（还有主动技能完全没有可执行数值 ⇒ GAPS），
   *   关键是**不是 COMPLETE**，而且「完整编译」的计数里不含那两个有跳过记录的技能。
   */
  const fullRow2 = skill.counts.find((c: any) => /完整编译/.test(c.label));
  const totalRow = skill.counts.find((c: any) => /技能总数/.test(c.label));
  ok("★★★ 有跳过记录 ⇒ SKILL 层**不是 COMPLETE**，且「完整编译」计数把它们排除在外",
    skill.klass !== "COMPLETE" && !!fullRow2 && !!totalRow && Number(fullRow2.value) < Number(totalRow.value),
    JSON.stringify({ klass: skill.klass, full: fullRow2?.value, total: totalRow?.value }));
}

sec("[4] 反向：没有跳过记录就不受影响；报告里不许出现百分比")
{
  const cleanSkill = { name: "S", confidence: "HIGH", cost: 1, parsed: { damage: 1, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 }, unparsedSentences: 0, probAttributed: 0, probAmbiguous: 0, durationStated: 0, durationAmbiguous: 0, unmodeled: [], skips: [] };
  const mk = (skills: any[]) => ({ units: [{ name: "甲", side: "red", panelFilled: 4, soul: null, skills, ai: { dataPresent: true, compiled: true, confidence: "HIGH", gameVerified: false } }], ruleset: [{ id: "R", status: "VERIFIED" }], capabilities: [{ name: "DAMAGE", support: "FULL", useCount: 1 }], displayPrecision: "EXACT" });
  const fc: any = assessFidelity(mk([cleanSkill]) as any);
  const skc = fc.layers.find((l: any) => l.layer === "SKILL");
  ok("★★★ 反向：没有跳过记录 ⇒ SKILL 层 COMPLETE（守卫不是恒真）",
    skc.klass === "COMPLETE" && !skc.gaps.some((g: any) => /跳过记录/.test(g.what)), skc.klass);
  const fd: any = assessFidelity(mk([{ ...cleanSkill, skips: [{ reason: "TEST_REASON", evidence: "合成", kind: "PLACEMENT" }] }]) as any);
  const skd = fd.layers.find((l: any) => l.layer === "SKILL");
  ok("★★★ 同一个技能只多一条跳过记录 ⇒ 立刻降到 PARTIAL 并列出原因码",
    skd.klass === "PARTIAL" && skd.gaps.some((g: any) => /TEST_REASON/.test(g.what)), skd.klass);
  const allText = JSON.stringify(fc);
  ok("★★★ 报告里没有任何百分比（非评价性分类，不是评分）", !/[0-9]+\s*%/.test(allText), (allText.match(/[0-9]+\s*%/g) ?? []).join(","));
  ok("★★★ 总分类只能是四个非评价性取值之一",
    ["VERIFIED", "COMPLETE_UNVERIFIED", "PARTIAL", "INSUFFICIENT"].includes(fc.klass), fc.klass);
}

console.log("\n=== Fidelity 缺口与跳过记录: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;