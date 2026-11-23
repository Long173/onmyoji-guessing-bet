// tests/g70-ai-conditions.ts — ★★★ 第 114 轮：**AI 条件解析不出 ≠ 条件成立**（目标 ①/⑨）
//
// 由来：`selectSkillByAI` 里写的是 `r.cond ? !!r.cond(ctx) : true` —— 于是**条件没编译出来**的规则
// 被当成「条件成立」逐回合放行；更糟的是决策事件里还写着 reason=COND_MATCH，
// 也就是**连解释都是假的**（G5 的 AI Inspector 会告诉用户「条件满足」）。
//
// 全库实测：421 条 AI 技能规则里 **114 条**条件解析不出，涉及 **70/272** 只式神
// （「自身处于幻境时」「不存在山行结界时」「没buff」「不充足」…）。
// ★ 典型对局 #001 的十位**都不在其中** —— 所以这条修正不动基准指纹（本文件最后一条断言）。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { compileAI } from "../compile/ai-compiler.ts";
import { selectSkillByAI } from "../compile/character.ts";
import { assessFidelity } from "../kernel/fidelity.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = "2d7c7507e18db61f";
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const kit: any = createKit(bundle);
const nameOf = new Map(KB.map((s: any) => [s.id, s.name]));
const profileOf = (id: number) => compileAI(id, String(nameOf.get(id) ?? id), kit.aiById.get(id), (KB.find((s: any) => s.id === id)?.skills ?? []).map((k: any) => k.name)) as any;

sec("[1] 全库普查：条件解析不出的 AI 规则有多少（数字来自实测）")
{
  let total = 0, unresolved = 0;
  const chars = new Set<string>();
  const texts = new Map<string, number>();
  for (const [id] of kit.aiById) {
    const ai = profileOf(id);
    for (const r of ai.skillRules ?? []) {
      total++;
      if (!r.cond) { unresolved++; chars.add(String(nameOf.get(id))); texts.set(r.condRaw, (texts.get(r.condRaw) ?? 0) + 1); }
    }
  }
  ok("★★★ AI 技能规则 421 条，其中**条件解析不出 109 条**（27% —— 这不是边角料）", total === 421 && unresolved === 109, JSON.stringify({ total, unresolved }));
  ok("★★★ 涉及 **66** 只式神（第 116 轮 70 → 66：四只式神的场地条件接上后不再有未解析条件）", chars.size === 66, String(chars.size));
  const keys = [...texts.keys()].join(" | ");
  ok("★★★ 未解析名单里**不再有**幻境 / 结界（第 115/116 轮把场地与条件都接上了；这条盯着别退回去）",
    !/幻境|结界/.test(keys), keys.slice(0, 160));
  ok("★★ 而且相当一部分**根本不是条件句**（「没buff」「不充足」这种碎片）—— 说明这份 AI 数据本身有噪声",
    /没buff|不充足|随后对/.test(keys), JSON.stringify([...texts.keys()].filter((k) => /没buff|不充足/.test(k))));
}

sec("[2] 运行时三档：有谓词就求值 / 数据里没写条件就放行 / **解析不出就不放行**")
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261901 });
  await a.battle.runStartup();
  const self = a.battle.teams[0].members[0];
  const foes = a.battle.teams[1].members.filter((x: any) => x.alive);
  const realProfile = self.skills[0].aiProfile;
  const mk = (rules: any[]) => ({ charId: 0, charName: "T", skillRules: rules, targetRules: [], unresolvedConds: [], unresolvedRules: [], unconditionalRules: [], skillAnnotations: [], confidence: "LOW" });
  /** ① 条件解析不出（condRaw 非空、cond 为 null） */
  self.skills.forEach((s: any) => { s.aiProfile = mk([{ priority: 0, condRaw: "自身处于幻境时", cond: null, skill: { index: 1, raw: "X", label: "X" }, confidence: "LOW" }]); });
  a.battle.trace.length = 0;
  const r1: any = selectSkillByAI(a.battle, self, foes);
  const t1: any = a.battle.trace.filter((t: any) => t.t === "AI_DECISION").pop();
  ok("★★★ 条件解析不出 ⇒ **不放行**（退回 0 鬼火技能），而不是当成成立",
    t1?.reason === "NO_RULE_MATCHED" && r1?.cost === 0, JSON.stringify({ chosen: r1?.name, reason: t1?.reason }));
  ok("★★★ 而且决策事件**说出来**了（condUnresolved + unresolvedSkipped），不再误报 COND_MATCH",
    t1?.unresolvedSkipped === 1 && t1.rules.some((x: any) => x.condUnresolved === true), JSON.stringify(t1?.rules));
  /** ② 同一份规则，把条件换成**真谓词** ⇒ 放行 */
  self.skills.forEach((s: any) => { s.aiProfile = mk([{ priority: 0, condRaw: "自身处于幻境时", cond: () => true, skill: { index: 1, raw: "X", label: "X" }, confidence: "HIGH" }]); });
  const r2: any = selectSkillByAI(a.battle, self, foes);
  ok("★★★ 反向：同样是「自身处于幻境时」，**编译出了谓词**就照常放行", r2?.cost !== 0 || r2?.name === self.skills[1]?.name, JSON.stringify({ chosen: r2?.name, cost: r2?.cost }));
  /** ③ 数据里真的没写条件（condRaw 为空）⇒ 照放（这是既有的、有据的口径） */
  self.skills.forEach((s: any) => { s.aiProfile = mk([{ priority: 0, condRaw: "", cond: null, skill: { index: 1, raw: "X", label: "X" }, confidence: "HIGH" }]); });
  const t3: any = (() => { a.battle.trace.length = 0; const rr = selectSkillByAI(a.battle, self, foes); return { rr, ev: a.battle.trace.filter((t: any) => t.t === "AI_DECISION").pop() }; })();
  ok("★★★ 反向：**没写条件**（condRaw 空）仍然按每回合都放处理（reason=UNCONDITIONAL_RULE）",
    t3.ev?.reason === "UNCONDITIONAL_RULE", JSON.stringify({ reason: t3.ev?.reason }));
  self.skills.forEach((s: any) => { s.aiProfile = realProfile; });
}

sec("[3] Fidelity 的 AI 层：解析不出的条件必须看得见（两侧）")
{
  const mkInput = (unresolved: number) => ({
    units: [{ name: "甲", side: "red", panelFilled: 4, soul: null,
      skills: [{ name: "S", confidence: "HIGH", cost: 1, parsed: { damage: 1, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 }, unparsedSentences: 0, probAttributed: 0, probAmbiguous: 0, durationStated: 0, durationAmbiguous: 0, unmodeled: [], skips: [] }],
      ai: { dataPresent: true, compiled: true, confidence: "HIGH", gameVerified: false, unresolvedConds: unresolved } }],
    ruleset: [{ id: "R", status: "VERIFIED" }], capabilities: [{ name: "DAMAGE", support: "FULL", useCount: 1 }], displayPrecision: "EXACT" });
  const f0: any = assessFidelity(mkInput(0) as any);
  const ai0 = f0.layers.find((l: any) => l.layer === "AI");
  ok("★★ 反向：没有解析不出的条件 ⇒ AI 层 COMPLETE，也没有那条缺口",
    ai0.klass === "COMPLETE" && !ai0.gaps.some((g: any) => /条件解析不出/.test(g.what)), ai0.klass);
  const f1: any = assessFidelity(mkInput(3) as any);
  const ai1 = f1.layers.find((l: any) => l.layer === "AI");
  const gap = ai1.gaps.find((g: any) => /条件解析不出/.test(g.what));
  ok("★★★ 有 3 条解析不出 ⇒ AI 层降为 PARTIAL 且列出条数", ai1.klass === "PARTIAL" && !!gap && /3 条/.test(gap.what), JSON.stringify({ klass: ai1.klass, gap: gap?.what }));
  ok("★★★ 缺口是 WARN，并写明这些规则**不再**按条件成立放行", gap?.severity === "WARN" && /不再被当成条件成立|不再按/.test(gap.detail), gap?.detail);
  ok("★★ 计数行里也有一行（报告要能一眼看到条数）", ai1.counts.some((c: any) => /条件解析不出/.test(c.label) && c.value === "3"));
}

sec("[4] 默认不漂：典型对局 #001 的十位都不在受影响名单里")
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.runStartup();
  await a.battle.run();
  ok("★★★ 指纹与第 97 轮记录的值逐位相同（这条修正不动基准阵容）",
    stateHash(captureState(a.battle)) === BASE, stateHash(captureState(a.battle)));
}

console.log("\n=== AI 条件解析不出: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;