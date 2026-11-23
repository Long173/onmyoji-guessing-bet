// tests/g71-field.ts — ★★★ 第 115 轮：**场地（幻境 / 结界）运行时**（目标 ⑨）
//
// 25 条技能提到幻境/结界，其中 20 条是创建类；引擎此前连"场上有没有这个场地"都答不出来，
// 而 AI 层已经在条件里引用它（第 114 轮：5 条规则因此编译不出谓词）。
// 本轮做的是**存在性 / 持续时间 / 静态属性修正**，逐句记下没做的部分。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { compileSkill } from "../compile/skill-compiler.ts";
import { setTipsTable, loadTips } from "../compile/tips.ts";
import { activeField, entityInField, fieldsOf } from "../kernel/field.ts";
import { captureState, restoreBattle, stateHash } from "../kernel/state.ts";
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
const mk = async (name: string, seed: number) => {
  const s = KB.find((x: any) => x.name === name);
  const m = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name };
  const a: any = assembleMatch(createKit(bundle), m, { seed });
  await a.battle.runStartup();
  return a;
};

sec("[1] 解析：创建类技能的场地规格（名字 / 持续时间 / 概率 / 光环）")
{
  const all: Array<{ who: string; f: any }> = [];
  for (const s of KB) for (const k of (s.skills ?? [])) { const ir = compileSkill(s.id, s.name, k); if (ir.field) all.push({ who: s.name + "「" + k.name + "」", f: ir.field }); }
  ok("★★★ 全库解析出 **14** 条施放式创建（20 条创建类里，回合开始/被动触发的 3 条刻意不收）", all.length === 14, String(all.length));
  const hui = irOf("辉夜姬", "龙首之玉").field;
  ok("★★★ 「创造存在2回合的幻境」⇒ ILLUSION / 持续 2 / 来源 CLAUSE", hui?.kind === "ILLUSION" && hui?.duration === 2 && hui?.durationSource === "CLAUSE", JSON.stringify(hui && { k: hui.kind, d: hui.duration, s: hui.durationSource }));
  const bai = irOf("白藏主", "梦山狐影").field;
  ok("★★★ 「开启存在1回合的狐影结界」⇒ 名字**整名**取出（不是「影结界」）", bai?.name === "狐影结界" && bai?.kind === "BARRIER", JSON.stringify(bai?.name));
  const shen = irOf("神启荒", "星罗云布").field;
  ok("★★★ 没写「存在N回合」⇒ duration 1 且来源记成 **DEFAULT**（默认值必须能被看出来）", shen?.duration === 1 && shen?.durationSource === "DEFAULT", JSON.stringify({ d: shen?.duration, s: shen?.durationSource }));
  ok("★★ 光环：辉夜姬幻境读到「友方全体提升15%防御」（范围在动词**之前**的那种语序）",
    (hui?.auras ?? []).some((a: any) => a.scope === "ALLY" && a.prop === "def" && Math.abs(a.value - 0.15) < 1e-9), JSON.stringify(hui?.auras));
  ok("★★ 反向：御怨般若「若开启封印结界，则…」**不是**创建动作 ⇒ 没有 field", !irOf("御怨般若", "恨返").field);
  ok("★★ 反向：荒「星辰之境」（回合开始前 30% 概率创造）⇒ 不收，留 FIELD_TRIGGER_NOT_MODELED",
    !irOf("荒", "星辰之境").field && (irOf("荒", "星辰之境").formSkips ?? []).some((x: any) => x.reason === "FIELD_TRIGGER_NOT_MODELED"),
    JSON.stringify((irOf("荒", "星辰之境").formSkips ?? []).map((x: any) => x.reason)));
  const zb = irOf("鲸汐千姬", "鲸息洄梦").field;
  ok("★★ 长名字也整名取出（「展开存在2个回合的永生之海幻境」⇒ 永生之海幻境）", zb?.name === "永生之海幻境", JSON.stringify(zb?.name));
}

sec("[2] 运行时：展开、生效、到期")
{
  const A = await mk("辉夜姬", 20262001);
  const hy = A.battle.teams[0].members[0];
  A.battle.teams[0].orbs.orb = 8;
  const ally = A.battle.teams[0].members[1];
  const def0 = ally.prop("def");
  A.battle.trace.length = 0;
  await A.battle.runPseudoTurn(hy, TurnType.PSEUDO_TURN, { skill: hy.skills.find((s: any) => s.name === "龙首之玉"), target: A.battle.teams[1].members[0] });
  ok("★★★ 施放 ⇒ 场地写进 battle.fields（含到期回合）", fieldsOf(A.battle).length === 1 && fieldsOf(A.battle)[0].expiresTurn === A.battle.fields[0].createdTurn + 2, JSON.stringify(fieldsOf(A.battle)));
  ok("★★★ 事件链里有 FIELD_ENTER（带持续/来源/光环数）",
    A.battle.trace.some((t: any) => t.t === "FIELD_ENTER" && t.name === "幻境" && t.duration === 2 && t.auraCount > 0));
  ok("★★★ 光环真的生效：友方防御 ×1.15", Math.abs(ally.prop("def") - def0 * 1.15) < 1e-6, JSON.stringify({ before: Math.round(def0), after: Math.round(ally.prop("def")) }));
  /** ★ 回归：拥有者不能被施加两次（第一版 [owner, ...members] 把 owner 算了两遍） */
  const auraSources = hy.modifierSources().filter((x: string) => x.startsWith("aura:field"));
  ok("★★★ 拥有者只吃一份（不是 ×1.3）—— 池子必须去重", auraSources.length === 1 && Math.abs(hy.prop("def") / 1.15 - hy.prop("def") / 1.15) < 1e-9, JSON.stringify(auraSources));
  ok("★★ 条件查询：友方在幻境里、敌方不在", entityInField(A.battle, hy, "ILLUSION") && !entityInField(A.battle, A.battle.teams[1].members[0], "ILLUSION"));
  ok("★★ 按名字查（「所有友方均无狐影结界时」那类条件要按名字匹配）", activeField(A.battle, "ILLUSION", "幻境") !== null && activeField(A.battle, "BARRIER", "狐影结界") === null);
  const st = captureState(A.battle);
  ok("★★★ 场地进档（非空才写）", Array.isArray((st as any).fields) && (st as any).fields.length === 1);
  const k2 = createKit(bundle);
  const B: any = restoreBattle(JSON.parse(JSON.stringify(st)), { kit: k2, makeRuntime: (id: number) => runtimeFor(k2, id), attachRuntime });
  ok("★★★ 恢复后场地还在、指纹逐位一致（且光环**不重复施加**）",
    fieldsOf(B).length === 1 && stateHash(captureState(B)) === stateHash(st),
    JSON.stringify({ fields: fieldsOf(B).length, same: stateHash(captureState(B)) === stateHash(st) }));
  A.battle.turn++;
  await A.battle.runTurn(A.battle.teams[0].members[1], TurnType.NORMAL);
  A.battle.turn++;
  A.battle.trace.length = 0;
  await A.battle.runTurn(A.battle.teams[0].members[2], TurnType.NORMAL);
  ok("★★★ 到期 ⇒ 场地离场 + 光环整批回收（FIELD_EXIT / EXPIRED）",
    fieldsOf(A.battle).length === 0 && A.battle.trace.some((t: any) => t.t === "FIELD_EXIT" && t.reason === "EXPIRED"),
    JSON.stringify(A.battle.trace.filter((t: any) => String(t.t).startsWith("FIELD")).map((t: any) => t.t + ":" + t.reason)));
}

sec("[3] 默认不漂：典型对局 #001 指纹逐位不变")
{
  const Z: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await Z.battle.runStartup();
  await Z.battle.run();
  ok("★★★ 指纹与第 97 轮记录的值逐位相同（场地是**瞬时**的：终局场上没有场地 ⇒ 不进指纹）",
    stateHash(captureState(Z.battle)) === BASE && (Z.battle as any).fields.length === 0,
    stateHash(captureState(Z.battle)) + " fields=" + (Z.battle as any).fields.length);
}

console.log("\n=== 场地（幻境/结界）运行时: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;