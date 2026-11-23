// tests/g66-summon-presence.ts — ★★★ 第 110 轮：**召唤物（本体留场）与它的「在场时」缺口**（a1-4 §32/§34，目标 ⑨）
//
// 由来：第 110 轮查「四条召唤为什么一条都没上场」时，发现的是**静默**：
//   · 技能写「召唤[tips_N]」（最字面的写法），而编译器只认「【施放】…召唤」与「击败…召唤」；
//   · tips 里的生命基准是「生命值是千姬攻击力的550%」「继承慧明灯45%生命值，100%防御」这些写法，
//     而 parseSummonSpec 当时只认「生命为…%」，于是四条 tips 全被判成"不是放置单位"。
// 两者叠加的结果是：**既没有产物、也没有跳过记录** —— 报表上什么都看不见。
//
// 本文件的断言分两侧：
//   ① 能做的：五种写法解析得出、召唤物真的上场、本体**留在场上**；
//   ② 不能做的：**在场光环与收回逐条记账**（绝不因为"召唤已实现"就一起变绿）。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { setTipsTable, loadTips } from "../compile/tips.ts";
import { parseSummonSpec } from "../kernel/summon.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { TurnType } from "../kernel/types.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = "2d7c7507e18db61f";
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const tipsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
const tips: any[] = Array.isArray(tipsRaw) ? tipsRaw : (Object.values(tipsRaw).find((v: any) => Array.isArray(v)) as any[]);
setTipsTable(loadTips(tips));
const tipOf = (id: string) => tips.find(t => String(t.id) === id);
const specOf = (id: string) => parseSummonSpec(tipOf(id));
const irOf = (shiki: string, skill: string) => {
  const s = KB.find((x: any) => x.name === shiki)!;
  const k = (s.skills ?? []).find((y: any) => y.name === skill)!;
  return compileSkill(s.id, s.name, k) as any;
};

sec("[1] 生命基准的五种写法：逐条从原文解析（第 110 轮补了后两种）")
{
  const hai = specOf("3565")!;
  ok("★★★ 「生命值是千姬攻击力的550%」⇒ hp = 千姬攻击 × 5.5（第 110 轮前这种写法读不出来）",
    hai?.hp?.prop === "atk" && hai?.hp?.ratio === 5.5, JSON.stringify(hai?.hp));
  ok("★★★ 「继承千姬100%的防御」⇒ 逐属性继承 def×1（不进 hp，也不混进 inheritInitialStats）",
    (hai?.inherit ?? []).some(x => x.prop === "def" && x.ratio === 1) && hai?.inheritInitialStats === false, JSON.stringify(hai?.inherit));
  const ming = specOf("5523")!;
  ok("★★★ 「继承慧明灯45%生命值，100%防御」⇒ hp = 慧明灯生命 × 0.45 且 def 继承",
    ming?.hp?.prop === "hp" && ming?.hp?.ratio === 0.45 && (ming?.inherit ?? []).some(x => x.prop === "def"), JSON.stringify({ hp: ming?.hp, inh: ming?.inherit }));
  const tang = specOf("5691")!;
  ok("★★★ 「继承猫川攻击550%的生命值和100%防御」⇒ 属性词写在百分号前：hp = 猫川攻击 × 5.5 + def 继承",
    tang?.hp?.prop === "atk" && tang?.hp?.ratio === 5.5 && (tang?.inherit ?? []).some(x => x.prop === "def"), JSON.stringify({ hp: tang?.hp, inh: tang?.inherit }));
  const yue = specOf("3942")!;
  ok("★★★ 虚假之月（月读）也被读成单位：继承45%生命值与100%防御 —— 第 103 轮判它「不是单位」是**判据太窄**",
    yue?.hp?.prop === "hp" && yue?.hp?.ratio === 0.45 && (yue?.inherit ?? []).some(x => x.prop === "def"), JSON.stringify({ hp: yue?.hp, inh: yue?.inherit }));
  /**
   * ★★★ 反向：判据**没有被放宽**。浮生画影（tips_3673）写着「免疫伤害、负面状态和控制效果，无法行动，
   *   造成的单次伤害不超过…1200%」—— 它没有生命基准、没有继承、没有胜利判定 ⇒ 仍然不算放置单位。
   *   这条断言就是"放宽正则"与"补写法"的分界线。
   */
  ok("★★★ 反向：浮生画影（3673）仍然**不是**放置单位规格（没有生命基准/继承/胜利判定）", specOf("3673") === null);
  ok("★★ 反向：状态类 tips 也不会被收进来（「维持」是状态说明，不是单位）", specOf("15") === null && specOf("11") === null);
}

sec("[2] 全库普查：「召唤[tips_N]」的技能现在各自去了哪里（不许静默）")
{
  const rows: Array<{ who: string; forms: any[]; skips: string[] }> = [];
  for (const s of KB) {
    for (const k of (s.skills ?? [])) {
      if (!/召唤\[tips_\d+\]/.test(String(k.description ?? ""))) continue;
      const ir = irOf(s.name, k.name);
      rows.push({ who: s.name + "「" + k.name + "」", forms: ir.forms ?? [], skips: (ir.formSkips ?? []).map((x: any) => x.reason) });
    }
  }
  const summons = rows.filter(r => r.forms.some(f => f.kind === "SUMMON"));
  ok("★★★ 全库 6 条技能引用 [tips_N] 召唤，其中 **4 条**被接成召唤物（kind=SUMMON）",
    rows.length === 6 && summons.length === 4, JSON.stringify(rows.map(r => r.who + ":" + (r.forms.map(f => f.kind ?? "FORM").join("/") || r.skips.join("/")))));
  ok("★★★ 而且四条的名字是实测的那四个（不是把别的技能也算进来）",
    ["千姬", "月读", "慧明灯", "猫川"].every(n => summons.some(r => r.who.startsWith(n))),
    JSON.stringify(summons.map(r => r.who)));
  /** ★ 唯一没接上的那条必须是**有理由的跳过**，不是消失 */
  const skipped = rows.filter(r => !r.forms.length);
  ok("★★★ 没接上的那条（绘世花鸟卷）留了 NOT_A_SUMMON_SPEC —— 第 110 轮之前它是**静默丢**",
    skipped.length === 1 && skipped[0].skips.includes("NOT_A_SUMMON_SPEC"), JSON.stringify(skipped.map(r => r.who + ":" + r.skips)));
  ok("★★ 形态类（kind 不是 SUMMON）仍然是原来那两条：蛇神与余烬 —— SUMMON 分支没有误伤形态",
    ["神堕八岐大蛇", "百羽凤凰火"].every(n => { const f = (irOf(n, n === "神堕八岐大蛇" ? "神堕之力" : "未熄羽").forms ?? [])[0]; return f && f.kind !== "SUMMON" && f.returnOn !== "NONE"; }));
}

sec("[3] 端到端：慧明灯「正念」⇒ 明识灯上场，而**本体留在场上**")
{
  const HM = KB.find((s: any) => s.name === "慧明灯");
  const m = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: HM.id, name: "慧明灯" };
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261601 });
  await a.battle.runStartup();
  const self = a.battle.teams[0].members[0];
  const zn = self.skills.find((s: any) => s.name === "正念");
  a.battle.teams[0].orbs.orb = 8;
  a.battle.trace.length = 0;
  await a.battle.runPseudoTurn(self, TurnType.PSEUDO_TURN, { skill: zn, target: a.battle.teams[1].members[0] });
  const sums = a.battle.teams[0].summons;
  ok("★★★ 召唤物真的上场了（明识灯）", sums.length === 1 && sums[0].name === "明识灯", JSON.stringify(sums.map((x: any) => x.name)));
  const s0 = sums[0];
  ok("★★★ 生命基准来自原文：45% × 慧明灯生命值",
    !!s0 && Math.abs(s0.maxHp - Math.round(self.base.hp * 0.45)) <= 1, JSON.stringify({ maxHp: s0?.maxHp, expect: Math.round(self.base.hp * 0.45) }));
  ok("★★★ 逐属性继承生效：防御 = 慧明灯初始防御 × 100%（第 110 轮新增的那条路）",
    !!s0 && Math.abs(s0.base.def - Math.round(self.base.def * 1)) <= 1, JSON.stringify({ def: s0?.base.def, ownerDef: self.base.def }));
  ok("★★ 属性来源写在事件与记账里：hp 来自 tips、按属性继承的是 def（atk 原文没写 ⇒ 明确标出）",
    a.battle.trace.some((t: any) => t.t === "SUMMON_CREATE" && t.statsSource === "TIPS_HP_INHERIT") &&
    s0.notes.includes("summon:stats-UNDECLARED:atk"), JSON.stringify({ src: a.battle.trace.filter((t: any) => t.t === "SUMMON_CREATE").map((t: any) => t.statsSource), notes: s0.notes }));
  ok("★★★ 召唤物占召唤位、且不计入胜负（KB 只在「只剩它」时才特判，见 g59 的默认值论证）",
    s0.caps.occupiesSummonSlot === true && s0.caps.countsForVictory === false, JSON.stringify(s0.caps));
  /** ★★★ 这一条就是 FORM / SUMMON 的分岔：本体**没有**离场 */
  ok("★★★ 本体留在场上：transformed=false、没有 offField 记录、也没有 form_off_field 状态",
    self.transformed === false && !self.notes.some((n: string) => n.startsWith("offField")) &&
    !self.statuses.some((s: any) => s.def.id === "form_off_field"),
    JSON.stringify({ transformed: self.transformed, notes: self.notes.filter((n: string) => n.startsWith("offField")) }));
  ok("★★★ 而且事件链里是 SUMMON_ENTER（不是 FORM_ENTER）—— 两种放置必须能分辨",
    a.battle.trace.some((t: any) => t.t === "SUMMON_ENTER" && t.tipsId === "5523") &&
    !a.battle.trace.some((t: any) => t.t === "FORM_ENTER"),
    JSON.stringify(a.battle.trace.filter((t: any) => /SUMMON_ENTER|FORM_ENTER/.test(String(t.t))).map((t: any) => t.t)));
}

sec("[4] 没做的那半边：在场光环与收回**逐条记账**（绝不随「召唤已实现」一起变绿）")
{
  const zn = irOf("慧明灯", "正念");
  const verbs = (zn.unmodeledMechanics ?? []).map((x: any) => x.verb);
  ok("★★★ 「[tips_5523]在场时，提升除召唤物外友方目标20%防御」记成在场光环未建模",
    verbs.includes("在场光环"), JSON.stringify((zn.unmodeledMechanics ?? []).map((x: any) => x.verb + "：" + String(x.clause).slice(0, 24))));
  /** ★★★ 第 111 轮这条**按事实反过来**了：收回接上了（forms[].recall），未建模记录随之撤掉。 */
  ok("★★★ 「回合开始时，收回[tips_5523]」**已接线**：forms[].recall 指向拥有者回合开始 + 点名状态（运行时 id 5522_1）",
    (zn.forms ?? []).some((f: any) => f.recall?.at === "OWNER_TURN_START" && (f.recall.removeStatuses ?? []).includes("5522_1")));
  ok("★★★ 而且「收回」不再出现在未建模里（做完了要撤记录，否则报表会说它没做）",
    !verbs.includes("收回"), JSON.stringify(verbs));
  const mao = irOf("猫川", "洗筋伐髓");
  ok("★★★ 猫川那条在场光环也被记下（同一套判据，不是给慧明灯开的特例）",
    (mao.unmodeledMechanics ?? []).some((x: any) => x.verb === "在场光环"));
  /** ★ 反向：**没有**在场效果的地方不许冒出这个理由（否则它就成了万能挡箭牌） */
  const qian = irOf("千姬", "海潮入梦");
  ok("★★ 反向：千姬「海潮入梦」只有一句「召唤[tips_3565]，接受潮汐的祝福。」⇒ 不该有在场光环记录",
    !(qian.unmodeledMechanics ?? []).some((x: any) => x.verb === "在场光环") && (qian.forms ?? []).length === 1,
    JSON.stringify(qian.unmodeledMechanics ?? []));
}

sec("[5] 默认档不漂：典型对局 #001 的指纹逐位不变（阵容里没有这四位）")
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.runStartup();
  await a.battle.run();
  ok("★★★ 指纹与第 97 轮记录的值逐位相同", stateHash(captureState(a.battle)) === BASE, stateHash(captureState(a.battle)));
  ok("★★ 而且整场没有任何召唤物（默认阵容里没有会召唤的式神）",
    a.battle.teams[0].summons.length === 0 && a.battle.teams[1].summons.length === 0);
}

console.log("\n=== 召唤物与在场光环: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;