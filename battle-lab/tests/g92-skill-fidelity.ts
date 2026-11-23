// tests/g92-skill-fidelity.ts — ★★★ 第 138 轮：**逐技能**编译状态（目标 ① / ⑪：§33）
//
// 由来（第 137 轮审核的结论）：§33 要求「卡上按逐技能机制实现度 ● FULL / ◐ PARTIAL 并可展开」，
// 而 Fidelity 载荷里**只有 6 个聚合计数** —— 界面问不出「这一个技能是哪一档」。
// 补这一层时顺带发现旧计数**不是穷尽的**：「有跳过记录、但没有未解析句」的技能两个计数都不含它
// （实测：典型对局 30 个技能，旧口径 完整 22 + 部分 5 = 27 ≠ 30）。
//
// 这个测试盯三件事：① 四档判据逐条两向；② 计数与逐技能列表**同一次分类**（不可能对不上）；
// ③ 计数是穷尽的（四档之和 == 技能总数，不许再有「谁都不算」的技能）。
import fs from "node:fs";
import path from "node:path";
import { charInfo, createKit } from "../../apps/web/src/engine/assemble.ts";
import { assessFidelity, classifySkill, SKILL_CLASS_LABEL, SKILL_CLASS_MARK } from "../kernel/fidelity.ts";
import type { FidelityUnitInput } from "../kernel/fidelity.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const kit = createKit(bundle);

/** 合成一个技能输入：只写与分档有关的那几个字段（其余按默认） */
const sk = (over: Partial<FidelityUnitInput["skills"][number]> = {}): FidelityUnitInput["skills"][number] => ({
  name: "测试技能", confidence: "HIGH", cost: 2,
  parsed: { damage: 1, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 },
  unparsedSentences: 0,
  ...over,
});
const empty = { damage: 0, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 };

sec("[1] ★★★ 四档判据逐条两向（合成输入，先把每条判据单独钉住）");
{
  ok("★★★ 有可执行数值 + 没有未解析句 + 没有跳过记录 ⇒ FULL", classifySkill(sk()) === "FULL", classifySkill(sk()));
  ok("★★★ 有未解析句 ⇒ PARTIAL（哪怕主效果已经可用）", classifySkill(sk({ unparsedSentences: 2 })) === "PARTIAL");
  ok("★★★ 有跳过记录、**没有**未解析句 ⇒ PARTIAL（这正是旧计数漏掉的那一类）",
    classifySkill(sk({ skips: [{ reason: "NOT_A_SUMMON_SPEC", evidence: "原文", kind: "PLACEMENT" }] })) === "PARTIAL");
  ok("★★★ 主动技能 + 没有任何可执行数值 ⇒ NONE（真缺口）", classifySkill(sk({ parsed: empty })) === "NONE");
  ok("★★★ 被动技能（cost<0）+ 没有可执行数值 ⇒ PASSIVE（已知边界，不是解析失败）",
    classifySkill(sk({ parsed: empty, cost: -1 })) === "PASSIVE");
  ok("★★ 两向：主动技能哪怕 cost=0 也不许被判成 PASSIVE", classifySkill(sk({ parsed: empty, cost: 0 })) === "NONE");
  ok("★★ 两向：被动技能**有**可执行数值时走正常分档（不因为 cost<0 就整条豁免）", classifySkill(sk({ cost: -1 })) === "FULL");
  ok("★★★ 未建模机制**不参与分档**（它是另一件事：文本里有动词表里的词），但必须原样带出来",
    classifySkill(sk({ unmodeled: [{ verb: "花海", missing: "没有计数器" }] })) === "FULL");
  ok("★★ 可执行数值只看六类成分：任意一类非 0 就算有（不是只看伤害）",
    ["damage", "heal", "shield", "timeline", "status", "orb"].every(k =>
      classifySkill(sk({ parsed: { ...empty, [k]: 1 } as any })) === "FULL"));
}

sec("[2] ★★★ 穷尽性：四档之和必须等于技能总数（不许再有「谁都不算」的技能）");
{
  const all = [sk(), sk({ unparsedSentences: 1 }), sk({ parsed: empty }), sk({ parsed: empty, cost: -1 }),
    sk({ skips: [{ reason: "R", evidence: "e", kind: "STEAL" }] })];
  const tally = ("FULL|PARTIAL|PASSIVE|NONE".split("|") as any[]).map(k => all.filter(s => classifySkill(s) === k).length);
  ok("★★★ 四档计数相加 == 输入条数", tally.reduce((a, b) => a + b, 0) === all.length, JSON.stringify(tally));
  ok("★★★ 每一条**恰好**落一档（没有一条同时落两档 —— 判据是互斥的）",
    all.every(s => ["FULL", "PARTIAL", "PASSIVE", "NONE"].filter(k => classifySkill(s) === k).length === 1));
  ok("★★ 记号与标签四档齐全（少了哪一档，界面就会显示 undefined）",
    ["FULL", "PARTIAL", "PASSIVE", "NONE"].every(k => !!SKILL_CLASS_MARK[k as any] && !!SKILL_CLASS_LABEL[k as any]),
    JSON.stringify([SKILL_CLASS_MARK, SKILL_CLASS_LABEL]));
  ok("★★★ 词汇里没有 % —— 真实性体系严禁百分比（这条是那个铁律在逐技能层的复述）",
    !JSON.stringify([SKILL_CLASS_MARK, SKILL_CLASS_LABEL]).includes("%"));
}

sec("[3] ★★★ 真实阵容：逐技能列表与 SKILL 层计数是**同一次分类的两种视图**");
const CANON: Array<[string, number, "red" | "blue"]> = [
  ["三尾狐", 202, "red"], ["日和坊", 297, "red"], ["思金神", 601, "red"], ["跳跳弟弟", 225, "red"], ["聆海金鱼姬", 346, "red"],
  ["座敷童子", 205, "blue"], ["夜溟彼岸花", 358, "blue"], ["樱花妖", 267, "blue"], ["缚骨清姬", 352, "blue"], ["神启荒", 390, "blue"],
];
const units: FidelityUnitInput[] = CANON.map(([name, id, side]) => {
  const info = charInfo(kit, id);
  return {
    name, side, panelFilled: 4, soul: null,
    skills: info.skillDetails.map((s: any) => ({ ...s, confidence: s.confidence })),
    ai: { dataPresent: true, compiled: true, confidence: info.aiConfidence, gameVerified: false },
  };
});
const rep = assessFidelity({ units, ruleset: [], capabilities: [], displayPrecision: "INTEGER_OBSERVED" });
{
  const layer = rep.layers.find(l => l.layer === "SKILL")!;
  const cnt = (re: RegExp) => Number((layer.counts.find(c => re.test(c.label))?.value) ?? NaN);
  const byClass = (k: string) => rep.skills.filter(s => s.klass === k).length;
  ok("★★ 前置：逐技能列表非空（否则下面全是平凡通过）", rep.skills.length >= 25, String(rep.skills.length));
  ok("★★★ 逐技能列表条数 == 「本局技能总数」", rep.skills.length === cnt(/本局技能总数/), rep.skills.length + " vs " + cnt(/本局技能总数/));
  ok("★★★ 四档各自的条数 == SKILL 层四个计数（**同一次分类**，不可能对不上）",
    byClass("FULL") === cnt(/完整编译/) && byClass("PARTIAL") === cnt(/部分编译/) && byClass("PASSIVE") === cnt(/被动技能/) && byClass("NONE") === cnt(/主动技能但无可执行数值/),
    JSON.stringify({ FULL: byClass("FULL"), PARTIAL: byClass("PARTIAL"), PASSIVE: byClass("PASSIVE"), NONE: byClass("NONE"), layer: layer.counts.map(c => c.label + "=" + c.value) }));
  ok("★★★ 「四档合计」这一行必须等于技能总数（穷尽性在**报告里**也看得见）",
    cnt(/四档合计/) === rep.skills.length && cnt(/四档合计/) === cnt(/本局技能总数/),
    cnt(/四档合计/) + " vs " + rep.skills.length);
  ok("★★ 今日实测：典型对局 30 个技能 ⇒ ●22 ◐6 ○2 ✕0",
    rep.skills.length === 30 && byClass("FULL") === 22 && byClass("PARTIAL") === 6 && byClass("PASSIVE") === 2 && byClass("NONE") === 0,
    JSON.stringify({ n: rep.skills.length, FULL: byClass("FULL"), PARTIAL: byClass("PARTIAL"), PASSIVE: byClass("PASSIVE"), NONE: byClass("NONE") }));
  /**
   * ★★★ 这条就是本轮那个发现：旧口径的两个计数**加起来不等于总数**。
   *   神启荒「星罗云布」有 1 条跳过记录、0 条未解析句 ⇒ 旧口径里它既不算完整、也不算部分。
   *   写上它，是为了让「计数变成穷尽的」这件事**有据可查**，而不是一句声明。
   */
  const rescued = rep.skills.filter(s => s.klass === "PARTIAL" && s.unparsed === 0 && s.skipped > 0);
  /**
   * ★★★ 第 252 轮**按事实改写**：第 234 轮这条断言用来证明「旧口径的两个计数加起来不等于总数」的那一条，
   *   正是神启荒「星罗云布」390_02（有跳过记录、0 条未解析句）。而第 252 轮给它补上了一条**记账**
   *   （缺口动词「次数读成了上限」：「触发6次星爆后幻境结束」被当成了"一次施放 6 段"）⇒ 它现在**有**未解析句，
   *   于是"被旧口径漏掉的那一类"当场**空了**。
   *   ★ 这正是那一轮想要的效果：典型对局里**不再有**技能同时满足「有跳过记录、却没有未解析句」。
   *   所以判据改成两条：① 集合为空；② 反向 —— 390_02 仍在且仍是 PARTIAL（跳过 1 + 未解析 ≥ 1），
   *   也就是"那一类是被**记账**关掉的，不是被改判/被隐藏的"。
   */
  ok("★★★ 第 252 轮起：典型对局里**没有**「有跳过记录、却 0 条未解析句」的技能（旧口径漏掉的那一类已经空了）",
    rescued.length === 0, JSON.stringify(rescued.map(s => s.unit + "「" + s.name + "」skipped=" + s.skipped)));
  const xly: any = rep.skills.find(s => s.name === "星罗云布");
  ok("★★★ 反向：神启荒「星罗云布」仍在，且仍是 PARTIAL（跳过 " + (xly?.skipped ?? "?") + " + 未解析 " + (xly?.unparsed ?? "?") + "）—— 那一类是被记账关掉的，不是被改判的",
    !!xly && xly.klass === "PARTIAL" && xly.skipped >= 1 && xly.unparsed >= 1,
    JSON.stringify(rep.skills.filter((s: any) => s.unit === "神启荒").map((s: any) => [s.name, s.klass, s.skipped, s.unparsed])));
  ok("★★ 反向：旧口径的「完整编译」计数一行都没动（22 == 内核里那个数）", byClass("FULL") === cnt(/完整编译/));
  ok("★★ 逐技能条目带得出未建模机制（动词名），且与「依赖未建模机制的技能」计数口径不冲突",
    rep.skills.some(s => s.unmodeled.length > 0) && rep.skills.filter(s => s.unmodeled.length > 0).length >= cnt(/依赖未建模机制/),
    JSON.stringify(rep.skills.filter(s => s.unmodeled.length > 0).map(s => s.unit + "「" + s.name + "」" + s.unmodeled.join("/"))));
  ok("★★ 每个技能条目都归得上单位与边（界面按 side + 名字取数，缺一个界面上就会串到别人身上）",
    rep.skills.every(s => !!s.unit && (s.side === "red" || s.side === "blue") && !!s.name));
  ok("★★★ 整份报告里仍然没有任何 % 字符（第 49 轮那条铁律不能因为多了一层就破）",
    !JSON.stringify(rep).includes("%"));
}

sec("[4] ★★ 边界：没有单位 / 单位没有技能时不许崩，也不许报出假的档位");
{
  const r0 = assessFidelity({ units: [], ruleset: [], capabilities: [], displayPrecision: "EXACT" });
  ok("★ 空输入 ⇒ 逐技能列表为空（不是 undefined）", Array.isArray(r0.skills) && r0.skills.length === 0, JSON.stringify(r0.skills));
  ok("★ 空输入 ⇒ SKILL 层仍是 UNKNOWN（不被这一层改动带偏）", r0.layers.find(l => l.layer === "SKILL")!.klass === "UNKNOWN");
  const r1 = assessFidelity({
    units: [{ name: "甲", side: "red", panelFilled: 4, soul: null, skills: [], ai: { dataPresent: false, compiled: false, confidence: "LOW", gameVerified: false } }],
    ruleset: [], capabilities: [], displayPrecision: "EXACT",
  });
  ok("★ 单位没有技能 ⇒ 四档计数全 0，且合计 == 总数 == 0（不出现负数或 NaN）",
    r1.skills.length === 0 && r1.layers.find(l => l.layer === "SKILL")!.counts.find(c => /四档合计/.test(c.label))!.value === "0");
}

console.log("\n=== 逐技能编译状态（§33）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
