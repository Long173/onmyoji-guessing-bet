// tests/g72-ai-field-conditions.ts — ★★★ 第 116 轮：**AI 的场地条件接上谓词**（目标 ①/⑨）
//
// 第 115 轮把场地（幻境/结界）做出来了，但 AI 里那 5 条引用场地条件的规则仍然编译不出谓词；
// 而且其中两条（「不存在山行结界时」「没有结界」）此前落到通用 buff 规则上，被求值成
// 「身上没有叫山行结界的 buff」—— 一个**永远为真**的谓词。那比"解析不出"更糟：它会被当成条件成立放行。
//
// 这一轮给 AICtx 加 `inFieldOf` / `fieldRemaining` 两个回调，并把场地条件排在通用 buff 规则**之前**。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { compileAI } from "../compile/ai-compiler.ts";
import { mkCtx } from "../compile/character.ts";
import { createField } from "../kernel/field.ts";
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
const profileOf = (name: string) => {
  const id = KB.find((s: any) => s.name === name)!.id;
  return compileAI(id, name, kit.aiById.get(id), (KB.find((s: any) => s.id === id)?.skills ?? []).map((k: any) => k.name)) as any;
};
const FIELD_TEXTS = ["自身处于幻境时", "自身未处于幻境时", "无幻境或幻境剩余时间1回合时", "自身未处于幻境或幻境剩余回合数=1时", "所有友方均无狐影结界时"];

sec("[1] 全库：场地条件不再进 unresolved（114 → 109）")
{
  let total = 0, unresolved = 0;
  const un: string[] = [];
  for (const [id] of kit.aiById) {
    const ai = compileAI(id, String(nameOf.get(id) ?? id), kit.aiById.get(id), (KB.find((s: any) => s.id === id)?.skills ?? []).map((k: any) => k.name)) as any;
    for (const r of ai.skillRules ?? []) { total++; if (!r.cond) { unresolved++; un.push(r.condRaw); } }
  }
  ok("★★★ AI 技能规则 421 条，条件解析不出 **109** 条（第 114 轮量的是 114 —— 少掉的正是场地条件）",
    total === 421 && unresolved === 109, JSON.stringify({ total, unresolved }));
  ok("★★★ 五条场地条件**一条都不在** unresolved 里", FIELD_TEXTS.every(t => !un.includes(t)), JSON.stringify(un.filter(x => FIELD_TEXTS.includes(x))));
  ok("★★ 反向：真正解析不出的（数据噪声）仍然在名单里 —— 不是把闸门关掉", un.includes("没buff") || un.includes("不充足"), JSON.stringify(un.filter(x => /没buff|不充足/.test(x))));
  ok("★★ 而且全库 unresolved 里**不再有任何**提到幻境/结界的条件", !un.some(x => /幻境|结界/.test(x)), JSON.stringify(un.filter(x => /幻境|结界/.test(x))));
}

sec("[2] 谓词两侧：真的按场地的存在与剩余回合求值")
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20262101 });
  await a.battle.runStartup();
  const self = a.battle.teams[0].members[0];
  const foes = a.battle.teams[1].members.filter((x: any) => x.alive);
  const ctx = () => mkCtx(a.battle, self, foes);
  const condOf = (who: string, raw: string) => (profileOf(who).skillRules ?? []).find((r: any) => r.condRaw === raw)?.cond ?? null;
  const inIll = condOf("荒", "自身处于幻境时");
  const notIll = condOf("荒", "自身未处于幻境时");
  ok("★★★ 荒的两条场地条件都编译出了谓词（不是 null）", typeof inIll === "function" && typeof notIll === "function");
  ok("★★★ 没有场地时：「处于幻境」=false、「未处于幻境」=true（两侧互斥）",
    inIll(ctx()) === false && notIll(ctx()) === true, JSON.stringify({ in: inIll(ctx()), not: notIll(ctx()) }));
  createField(a.battle, self, { kind: "ILLUSION", name: "幻境", duration: 2, durationSource: "CLAUSE", auras: [], evidence: "g72" } as any);
  ok("★★★ 展开 2 回合幻境后：两条同时翻转（同一个场地状态，两个方向的判据）",
    inIll(ctx()) === true && notIll(ctx()) === false, JSON.stringify({ in: inIll(ctx()), not: notIll(ctx()) }));
  const remCond = condOf("辉夜姬", "自身未处于幻境或幻境剩余回合数=1时");
  ok("★★★ 「未处于幻境或剩余回合数=1时」：剩 2 回合 ⇒ false", remCond(ctx()) === false, String(remCond(ctx())));
  /** 把幻境换成 1 回合的 ⇒ 剩余=1 ⇒ 条件成立（这是"要不要续杯"的那种条件） */
  createField(a.battle, self, { kind: "ILLUSION", name: "幻境", duration: 1, durationSource: "CLAUSE", auras: [], evidence: "g72" } as any);
  ok("★★★ 换成只剩 1 回合 ⇒ true（同一条件的另一侧）", remCond(ctx()) === true, String(remCond(ctx())));
  /** ★ 反向：名字不匹配的场地不算（「所有友方均无狐影结界时」不该被"日曜结界"满足） */
  const noFox = condOf("白藏主", "所有友方均无狐影结界时");
  createField(a.battle, self, { kind: "BARRIER", name: "日曜结界", duration: 2, durationSource: "CLAUSE", auras: [], evidence: "g72" } as any);
  /** ★ 判据是「所有友方均无**狐影**结界」：场上有一个**别的**结界（日曜）时，这个条件应当**成立**（true） */
  ok("★★★ 按名字匹配：日曜结界**不影响**「无狐影结界」（true）", noFox(ctx()) === true, String(noFox(ctx())));
  createField(a.battle, self, { kind: "BARRIER", name: "狐影结界", duration: 2, durationSource: "CLAUSE", auras: [], evidence: "g72" } as any);
  ok("★★★ 狐影结界展开后 ⇒ 仍然 false（「均无」在场地存在时不成立）；清掉之后才是 true",
    noFox(ctx()) === false && (() => { a.battle.fields.length = 0; return noFox(ctx()) === true; })());
}

sec("[3] 回调缺失时失败关闭（不能默默当成条件成立）")
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20262102 });
  await a.battle.runStartup();
  const self = a.battle.teams[0].members[0];
  const ctx: any = mkCtx(a.battle, self, a.battle.teams[1].members.filter((x: any) => x.alive));
  const cond = (profileOf("荒").skillRules ?? []).find((r: any) => r.condRaw === "自身处于幻境时")!.cond!;
  const bare: any = { ...ctx, inFieldOf: undefined, fieldRemaining: undefined };
  ok("★★★ 没有 inFieldOf 回调时谓词返回 **false**（第 114 轮的纪律：求值不了 ≠ 条件成立）", cond(bare) === false, String(cond(bare)));
}

sec("[4] 默认不漂：典型对局 #001 指纹逐位不变")
{
  const z: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await z.battle.runStartup();
  await z.battle.run();
  ok("★★★ 指纹与第 97 轮记录的值逐位相同（场地条件属于别的式神，基准十位不受影响）",
    stateHash(captureState(z.battle)) === BASE, stateHash(captureState(z.battle)));
}

console.log("\n=== AI 场地条件: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;