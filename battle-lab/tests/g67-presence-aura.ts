// tests/g67-presence-aura.ts — ★★★ 第 111 轮：**在场光环与收回**（a1-4 §32/§34，目标 ⑨）
//
// 第 110 轮把这两个缺口**登记**成未建模（verb=在场光环 / 收回）；这一轮把它们**实现**，
// 于是同一个测试要同时钉住两件事：
//   ① 静态属性修正真的生效、范围真的按原文（「除召唤物外友方目标」）、撤离时整批回收；
//   ② 收不下的那部分（普攻加成 / 行动条 / 鬼火 / 层数 / 点名状态）**继续报未建模** —— 部分实现也要说清是哪一半。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { setTipsTable, loadTips } from "../compile/tips.ts";
import { parsePresenceAuras } from "../kernel/summon.ts";
import { StatusBook } from "../kernel/status.ts";
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
const irOf = (shiki: string, skill: string) => {
  const s = KB.find((x: any) => x.name === shiki)!;
  const k = (s.skills ?? []).find((y: any) => y.name === skill)!;
  return compileSkill(s.id, s.name, k) as any;
};
const hmBattle = async (seed: number) => {
  const HM = KB.find((s: any) => s.name === "慧明灯");
  const m = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: HM.id, name: "慧明灯" };
  const a: any = assembleMatch(createKit(bundle), m, { seed });
  await a.battle.runStartup();
  const self = a.battle.teams[0].members[0];
  const zn = self.skills.find((s: any) => s.name === "正念");
  /** ★ 施放**之前**的基准（否则会把"带光环的值"当成原值 —— 第 108 轮阵亡归还那条断言踩过同一个坑） */
  const pre = {
    defs: a.battle.teams[0].members.map((x: any) => x.prop("def")),
    spd: self.prop("spd"),
  };
  a.battle.teams[0].orbs.orb = 8;
  await a.battle.runPseudoTurn(self, TurnType.PSEUDO_TURN, { skill: zn, target: a.battle.teams[1].members[0] });
  return { a, self, pre };
};

sec("[1] 解析：两种语序都要认（第一版只认一种，漏掉了本轮唯一的 B 实例）")
{
  const A = parsePresenceAuras("在场时，提升除召唤物外友方目标20%防御", "ALLY");
  ok("★★★ 语序 A（数量在前）：提升除召唤物外友方目标20%防御",
    A.auras.length === 1 && A.auras[0].scope === "ALLY_NON_SUMMON" && A.auras[0].prop === "def" &&
    A.auras[0].mode === "ADD_RATE" && Math.abs(A.auras[0].value - 0.2) < 1e-9, JSON.stringify(A));
  const B = parsePresenceAuras("在场时，降低慧明灯的速度40点", "OWNER");
  ok("★★★ 语序 B（属性在前）：降低慧明灯的速度40点 ⇒ 拥有者 −40 点速度",
    B.auras.length === 1 && B.auras[0].scope === "OWNER" && B.auras[0].prop === "spd" &&
    B.auras[0].mode === "FIXED" && B.auras[0].value === -40, JSON.stringify(B));
  const C = parsePresenceAuras("在场时为友方单位恢复受到伤害30%的生命值", "OWNER");
  ok("★★★ 反向：反应式光环（恢复/治疗）**不收** —— 它不是静态属性修正",
    C.auras.length === 0 && C.unmodeled.length === 1, JSON.stringify(C));
  const D = parsePresenceAuras("在场时，猫川的普攻系数翻倍，同时使友方全体造成的普攻伤害提升20%", "ALLY");
  ok("★★★ 反向：普攻加成不收（留在 unmodeled 里）", D.auras.length === 0 && D.unmodeled.length === 1, JSON.stringify(D));
  const E = parsePresenceAuras("在场时，则鸣响[tips_6032]，获得1点鬼火、2层[buff_6031_1]并提升友方全体10%行动条", "ALLY");
  ok("★★★ 反向：鬼火/层数/行动条不收", E.auras.length === 0 && E.unmodeled.length === 1, JSON.stringify(E));
  const F = parsePresenceAuras("在场时，提升除召唤物外友方目标20%防御，并使携带3层[buff_5522_1]的敌方陷入[tips_115]", "ALLY");
  ok("★★★ **部分实现也要分开说**：前半句收成光环、整句仍然进 unmodeled（后半句没做）",
    F.auras.length === 1 && F.unmodeled.length === 1, JSON.stringify(F));
}

sec("[2] 编译产物：光环与收回进了 IR，未建模记录**只说没做的那一半**")
{
  const zn = irOf("慧明灯", "正念");
  ok("★★★ 慧明灯：光环进 forms[].auras（ALLY_NON_SUMMON / def / +20%）",
    (zn.forms ?? []).some((f: any) => (f.auras ?? []).some((x: any) => x.scope === "ALLY_NON_SUMMON" && x.prop === "def" && Math.abs(x.value - 0.2) < 1e-9)),
    JSON.stringify((zn.forms ?? []).map((f: any) => f.auras)));
  /** ★ IR 里存的是**运行时 id**（`5522_1`）——原文的 `buff_` 是引用前缀，编译时去掉。这条断言同时钉住这个规范化。 */
  ok("★★★ 慧明灯：收回进 forms[].recall（OWNER_TURN_START + 点名运行时状态 id 5522_1）",
    (zn.forms ?? []).some((f: any) => f.recall?.at === "OWNER_TURN_START" && (f.recall.removeStatuses ?? []).includes("5522_1")) &&
    !(zn.forms ?? []).some((f: any) => (f.recall?.removeStatuses ?? []).includes("buff_5522_1")),
    JSON.stringify((zn.forms ?? []).map((f: any) => f.recall)));
  ok("★★★ 而且「收回」**不再**出现在未建模里（做完了就把记录撤掉）",
    !(zn.unmodeledMechanics ?? []).some((x: any) => x.verb === "收回"),
    JSON.stringify((zn.unmodeledMechanics ?? []).map((x: any) => x.verb)));
  ok("★★★ 猫川那条仍然报在场光环（普攻伤害本轮做不了）—— 不是所有记录都被一起撤掉",
    (irOf("猫川", "洗筋伐髓").unmodeledMechanics ?? []).some((x: any) => x.verb === "在场光环"));
  const hai = irOf("千姬", "海潮入梦");
  ok("★★★ 海原贝戟的反应式光环**第 113 轮接上了**：spec.reactive = 30% × 受到伤害（不再报未建模）",
    (hai.forms ?? []).some((f: any) => f.spec?.reactive?.ratio === 0.3) &&
    !(hai.formSkips ?? []).some((x: any) => x.reason === "PRESENCE_AURA_NOT_MODELED"),
    JSON.stringify({ reactive: (hai.forms ?? []).map((f: any) => f.spec?.reactive), skips: (hai.formSkips ?? []).map((x: any) => x.reason) }));
  ok("★★ 明识灯的「被移除时返还2点鬼火」**第 113 轮接上了**：spec.onRemove.orbs = 2",
    (zn.forms ?? []).some((f: any) => f.spec?.onRemove?.orbs === 2),
    JSON.stringify((zn.forms ?? []).map((f: any) => f.spec?.onRemove)));
}

sec("[3] 端到端：光环按范围生效，撤离时整批回收")
{
  const { a, self, pre } = await hmBattle(20261701);
  const allies = a.battle.teams[0].members.filter((x: any) => x.id !== self.id);
  const s0 = a.battle.teams[0].summons[0];
  ok("★ 前置：召唤物在场", !!s0 && s0.name === "明识灯");
  ok("★★★ 「除召唤物外友方目标20%防御」按范围生效（每个盟友 ×1.2）",
    allies.every((x: any) => x.modifierSources().some((src: string) => src.startsWith("aura:5523:"))),
    JSON.stringify(allies.map((x: any) => x.modifierSources().filter((src: string) => src.startsWith("aura:")).length)));
  ok("★★★ 「除召唤物外」被如实执行：召唤物自己**不吃**",
    !s0.modifierSources().some((src: string) => src.startsWith("aura:")));
  ok("★★★ 召唤物 tips 自己的光环也生效：本体速度 −40",
    self.modifierSources().includes("aura:5523:1"));
  ok("★★ 光环进档（就是 Entity.effects ⇒ G0 序列化天然覆盖）",
    captureState(a.battle).teams[0].members.some((mm: any) => (mm.effects ?? []).some((e: any) => String(e.source).startsWith("aura:5523:"))));
  a.battle.trace.length = 0;
  s0.hp = 0;
  await a.battle.resolveLethal(s0, a.battle.teams[1].members[0].id);
  ok("★★★ 召唤物阵亡 ⇒ 光环整批回收：属性回到**施放前**的基准值、来源清空",
    allies.every((x: any, i: number) => Math.abs(x.prop("def") - pre.defs[i + 1]) < 1e-9) &&
    !self.modifierSources().some((src: string) => src.startsWith("aura:")),
    JSON.stringify({ now: allies.map((x: any) => Math.round(x.prop("def"))), base: pre.defs.slice(1).map(Math.round) }));
  ok("★★★ 事件链里写明是光环撤离（AURA_END / SUMMON_DEATH）",
    a.battle.trace.some((t: any) => t.t === "AURA_END" && t.reason === "SUMMON_DEATH"),
    JSON.stringify(a.battle.trace.filter((t: any) => /AURA/.test(String(t.t))).map((t: any) => t.t + ":" + (t.reason ?? t.count))));
  ok("★★★ 撤离后本体速度回到基准（−40 那条光环也一起撤了，不是只撤了友方那条）",
    Math.abs(self.prop("spd") - pre.spd) < 1e-9, JSON.stringify({ now: Math.round(self.prop("spd")), base: Math.round(pre.spd) }));
}

sec("[4] 收回：回合开始 ⇒ 移除放置单位 + 点名状态，且**不走死亡链**")
{
  const { a, self, pre } = await hmBattle(20261702);
  const ally0 = a.battle.teams[0].members[1];
  const def0 = pre.defs[1];
  ok("★ 前置：召唤物在场且光环生效", a.battle.teams[0].summons.length === 1 && ally0.modifierSources().some((src: string) => src.startsWith("aura:")));
  /** 敌方身上挂上被点名的状态（业回本来就会加它；这里手工挂，是为了确定性地量"收回时移除"） */
  /** ★ buff 定义从知识库的 buffs 表取（StatusBook 只登记"这一局编译到过"的那些） */
  /**
   * ★ 两处都要试：`kit.buffs` 的键是**编译产物 id**（`5522_1`），而状态定义 id 是 `buff_5522_1` ——
   *   第一版按 `buff_5522_1` 去查，查到的是 undefined（于是"移除"那条断言量的是空气）。
   */
  const kit0: any = createKit(bundle);
  const buffDef: any = kit0.buffs?.get?.("5522_1") ?? kit0.buffs?.get?.("buff_5522_1") ?? StatusBook.get("buff_5522_1");
  ok("★ 前置：知识库里有 buff_5522_1 这个状态定义", !!buffDef);
  const foe = a.battle.teams[1].members[0];
  /** ★ 运行时 id 就是 `5522_1`（原文的 `buff_` 是引用前缀，编译时去掉） */
  const RID = String(buffDef?.id ?? "5522_1");
  if (buffDef) foe.addStatus(buffDef, self.id, 1, 3);
  ok("★ 前置：状态真的挂上了（否则这一节量的是空气）", foe.statuses.some((s: any) => s.def.id === RID), JSON.stringify(foe.statuses.map((s: any) => s.def.id)));
  /** 鬼火清零 ⇒ 这一回合 AI 放不出正念（3 火），于是"收回之后没有被立刻重新召唤"是可观测的 */
  a.battle.teams[0].orbs.orb = 0;
  a.battle.trace.length = 0;
  a.battle.turn++;
  await a.battle.runTurn(self, TurnType.NORMAL);
  ok("★★★ 回合开始 ⇒ 收回：召唤物离场", a.battle.teams[0].summons.length === 0, String(a.battle.teams[0].summons.length));
  ok("★★★ 光环随收回一起回收（防御回到原值、来源清空）",
    !ally0.modifierSources().some((src: string) => src.startsWith("aura:")) && Math.abs(ally0.prop("def") - def0) < 1e-9,
    JSON.stringify({ def: Math.round(ally0.prop("def")), base: Math.round(def0) }));
  ok("★★★ 收回**不触发死亡链**：没有 DEATH / KILLED，事件写的是 SUMMON_REMOVE / RECALL_TURN_START",
    a.battle.trace.some((t: any) => t.t === "SUMMON_REMOVE" && t.reason === "RECALL_TURN_START") &&
    !a.battle.trace.some((t: any) => t.t === "DEATH" || t.t === "KILLED"),
    JSON.stringify(a.battle.trace.filter((t: any) => /SUMMON_REMOVE|DEATH|KILLED/.test(String(t.t))).map((t: any) => t.t)));
  ok("★★★ 「并移除[buff_5522_1]」被如实执行（敌方身上那个状态到期 + 事件说明是收回导致的）",
    !foe.statuses.some((s: any) => s.def.id === RID) &&
    a.battle.trace.some((t: any) => t.t === "STATUS_REMOVED" && t.status === RID && t.reason === "RECALL"),
    JSON.stringify(a.battle.trace.filter((t: any) => t.t === "STATUS_REMOVED")));
}

sec("[5] 默认档不漂：典型对局 #001 指纹逐位不变")
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.runStartup();
  await a.battle.run();
  ok("★★★ 指纹与第 97 轮记录的值逐位相同（光环只在这四位身上才可能生效）",
    stateHash(captureState(a.battle)) === BASE, stateHash(captureState(a.battle)));
  ok("★★ 而且整场没有任何 aura 来源的 modifier",
    a.battle.allEntities().every((e: any) => !e.modifierSources().some((src: string) => src.startsWith("aura:"))));
}

console.log("\n=== 在场光环与收回: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;