// tests/g98-source-bearer-plan.ts — ★★★ 第 175 轮：**逐句承受者归属**（「对伤害来源附加…」）的前置事实
//
// 这是缺口清单里那条「逐句承受者归属（『对伤害来源附加…』）」的**尺子**：先问事实，再动手。
// 本文件**不实现任何行为**（不改 IR、不改运行时、不需要 census 说明），它只把三件事钉住：
//   [1] 族的规模与形状（全库逐句扫描：谁写着"来源"，分四种形状）；
//   [2] 今天的**运行时现状**（哪一种失败关闭、哪一种装上了但目标取的是技能级 targeting）；
//   [3] 「来源」在三个触发点上到底拿不拿得到（事件载荷实测）—— 这决定了下一轮能不能实现。
import fs from "node:fs";
import path from "node:path";
import { DamageType, EV } from "../kernel/types.ts";
import { matchFamily } from "../kernel/triggers.ts";
import { tipsTable, resolveTips } from "../compile/tips.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const tips = tipsTable();

/** 逐句扫全库：子句里写着「伤害来源 / 攻击者 / 攻击来源」的 */
interface Hit { who: string; sid: string; skill: string; cost: number; clause: string; family: string; code: string | null }
const hits: Hit[] = [];
for (const c of KB) for (const sk of (c.skills ?? [])) {
  const raw = [String(sk.description ?? ""), ...((sk.tips ?? []) as any[]).map((t: any) => String(t?.text ?? t))].join(" ");
  const text = resolveTips(raw, tips).text;
  for (const clause of String(text).split(/[。；\n]/).map(s => s.trim()).filter(s => /伤害来源|攻击者|攻击来源/.test(s))) {
    const fam = matchFamily(clause);
    hits.push({ who: c.name, sid: String(sk.id), skill: sk.name, cost: Number(sk.cost ?? 0), clause, family: fam?.family ?? "无族", code: fam?.evCode ?? null });
  }
}
/** 四种形状：状态落到来源 / 反击来源 / 对来源施放技能 / 其他（提到来源但不是承受者） */
const SHAPES: Array<{ name: string; test: RegExp }> = [
  { name: "状态落到来源", test: /为(?:伤害来源|攻击来源|攻击者)(?:附加|施加|附上)|使(?:攻击来源|攻击者)/ },
  { name: "反击来源", test: /反击(?:伤害来源|攻击来源|攻击者)|对(?:伤害来源|攻击来源|攻击者)进行(?:一次)?反击|反击伤害来源/ },
  { name: "对来源施放技能", test: /对(?:伤害来源|减益来源)(?:无消耗)?施放/ },
  { name: "其他（提到来源但不是承受者）", test: /.*/ },
];
const shapeOf = (h: Hit) => SHAPES.find(s => s.test.test(h.clause))!.name;
const byShape = new Map<string, Hit[]>();
for (const h of hits) { const k = shapeOf(h); if (!byShape.has(k)) byShape.set(k, []); byShape.get(k)!.push(h); }
const ids = (k: string) => (byShape.get(k) ?? []).map(h => h.sid).sort().join(",");

sec("[1] ★★★ 族的规模与形状（全库逐句扫描，判据只用原文）");
{
  const skills = new Set(hits.map(h => h.who + "/" + h.sid));
  console.log("  形状分布：" + SHAPES.map(s => s.name + "×" + (byShape.get(s.name)?.length ?? 0)).join(" · "));
  for (const h of hits) console.log("      [" + shapeOf(h) + "|" + h.family + "→" + (h.code ?? "-") + "] " + h.who + " " + h.sid + " " + h.skill + " (cost=" + h.cost + ")：" + h.clause.slice(0, 70));
  ok("★★ 窄口径（伤害来源 / 攻击者 / 攻击来源）的技能数 = 17（任何变化都会在这里显形）", skills.size === 17, String(skills.size));
  /**
   * ★ 口径必须写清：还有 3 个技能写着**裸「来源」**（不是"伤害来源"三个字）——
   *   神乐&定春「守护必达」的「对来源进行反击」、纺愿缘结神「守缘刃」的「免疫来源于其他目标的行动条改变效果」、
   *   妙主九命猫「国王驾到」的「对减益来源施放速速护驾」。
   *   它们**不进**本族（一个是反击族的另一种写法、一个是否定式的免疫声明、一个是"减益来源"），
   *   但必须记下来 —— 不然下一轮按"来源"两个字做正则就会顺手把它们收进来。
   */
  const wideOnly = ["500/500_02", "554/554_02", "590/590_02"];
  const wide = new Set<string>();
  for (const c of KB) for (const sk of (c.skills ?? [])) {
    const raw = [String(sk.description ?? ""), ...((sk.tips ?? []) as any[]).map((t: any) => String(t?.text ?? t))].join(" ");
    if (/来源/.test(resolveTips(raw, tips).text)) wide.add(String(c.id) + "/" + String(sk.id));
  }
  const extra = [...wide].filter(k => !skills.has(k.split("/")[0] + "/" + k.split("/")[1]) && ![...skills].some(s => s.endsWith("/" + k.split("/")[1])));
  ok("★★ 宽口径（裸「来源」）比窄口径多出的 3 条，正是上面注里那三条",
    extra.length === 3 && wideOnly.every(k => [...wide].some(w => w.endsWith(k.split("/")[1]))), JSON.stringify(extra));
  ok("★★ 四种形状**穷尽**这条族（子句总数 = 四桶之和）",
    hits.length === SHAPES.reduce((s, x) => s + (byShape.get(x.name)?.length ?? 0), 0), String(hits.length));
  ok("★★★ 「状态落到来源」这一桶 = 9 条，与探针一致",
    (byShape.get("状态落到来源")?.length ?? 0) === 9, ids("状态落到来源"));
  ok("★★ 「反击来源」这一桶 = 3 条（反击族已有自己的 evidence 判据）",
    (byShape.get("反击来源")?.length ?? 0) === 3, ids("反击来源"));
  /**
   * ★ 事实（实测出来的，不是我原先以为的 5 条）：另外两条反击**没有点"来源"两个字**——
   *   萤草「生花」写的是「并**对其**进行反击」（其 = 伤害来源）、神乐&定春「守护必达」写的是「对来源进行反击」
   *   （裸"来源"，不在窄口径里）。所以"反击来源"这一族**不能只按字面**点名单，得按族 + evidence 判。
   */
  ok("★★ 萤草「生花」的「对其进行反击」落在「其他」桶里（代词指代，字面看不到「来源」二字）",
    (byShape.get("其他（提到来源但不是承受者）") ?? []).some(h => h.sid === "238_02" && /对其进行反击/.test(h.clause)),
    JSON.stringify((byShape.get("其他（提到来源但不是承受者）") ?? []).map(h => h.sid)));
  ok("★★ 「对来源施放技能」这一桶 = 1 条（大夜摩天阎魔 385_02，与第 135 轮的 sub-cast 入口同源）",
    (byShape.get("对来源施放技能")?.length ?? 0) === 1 && ids("对来源施放技能") === "385_02", ids("对来源施放技能"));
}

async function mk(name: string, passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", seed = 20261012) {
  const s = KB.find((x: any) => x.name === name);
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name };
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives });
  await a.battle.runStartup();
  return a;
}

sec("[2] ★★★ 运行时现状（★ 第 176 轮接线后**按事实改写**：这一节以前写的是「装都不装」）");
{
  const a = await mk("九命猫", "PARSED_CANDIDATES_ONLY");
  const rep: any = a.battle.passiveReport;
  ok("★★★ 九命猫「九命」的「阵亡时，对伤害来源附加…」现在**装上了**（走逐句承受者归属）",
    (rep.sourceBearerFields ?? []).some((x: any) => x.skill === "九命"), JSON.stringify(rep.sourceBearerFields));
  ok("★★★ 于是 byTarget 桶回到 0（那道第 129 轮的失败关闭已经由逐句归属取代）",
    rep.skipped.byTarget === 0, JSON.stringify(rep.skipped));
  ok("★★ 同一技能里**别的**句子照常装上（不是整条技能被废）", rep.installed.some((x: any) => x.skill === "九命"),
    JSON.stringify(rep.installed.filter((x: any) => x.skill === "九命").map((x: any) => x.family)));

  const b = await mk("天照", "PARSED_CANDIDATES_ONLY");
  const repB: any = b.battle.passiveReport;
  ok("★★★ 天照「无灭」的「受到敌方攻击时，为伤害来源附加…」**装上了**（受击族按技能级 targeting 执行）",
    repB.installed.some((x: any) => x.skill === "无灭"), JSON.stringify(repB.installed.map((x: any) => x.skill).slice(0, 8)));
  ok("★★ 它不属于失败关闭那一桶（byTarget 里没有它）",
    !(b.battle.trace ?? []).some((t: any) => t.t === "PASSIVE_SKIPPED" && t.reason === "DAMAGE_SOURCE_TARGET_NOT_PER_CLAUSE" && /无灭/.test(String(t.skill))));

  const off = await mk("九命猫", "NOT_EXECUTED");
  ok("★★ 反向：默认档（被动 OFF）两条都不装、一条痕都不留",
    (off.battle.passiveReport?.installed ?? []).length === 0 && (off.battle.trace ?? []).filter((t: any) => t.t === "PASSIVE_SKIPPED").length === 0);
}

sec("[3] ★★★ 事件载荷实测：「来源」在三个触发点上拿不拿得到？（决定下一轮能不能实现）");
{
  const a = await mk("九命猫", "NOT_EXECUTED");
  const cap: any = { before: [] as any[], after: [] as any[], death: [] as any[] };
  a.battle.bus.register({ id: "PROBE:BEFORE", ownerId: 0, code: EV.BEFORE_DAMAGE, range: "ALL", priority: -5, passive: false, fn: (ctx: any) => { cap.before.push({ source: ctx?.input?.source?.id ?? null, target: ctx?.input?.target?.id ?? null }); } });
  a.battle.bus.register({ id: "PROBE:AFTER", ownerId: 0, code: EV.AFTER_DAMAGE, range: "ALL", priority: -5, passive: false, fn: (ctx: any) => { cap.after.push({ source: ctx?.input?.source?.id ?? null, target: ctx?.input?.target?.id ?? null }); } });
  a.battle.bus.register({ id: "PROBE:DEATH", ownerId: 0, code: EV.DEATH, range: "ALL", priority: -5, passive: false, fn: (ctx: any) => { cap.death.push({ target: ctx?.target?.id ?? null, killerId: ctx?.killerId ?? null }); } });
  const all = a.battle.allEntities();
  const src = all.find((e: any) => e.teamId === 0)!;
  const dst = all.find((e: any) => e.teamId === 1)!;
  await a.battle.damage(src, dst, 9999999, DamageType.NORMAL, 1);
  ok("★★★ BEFORE_DAMAGE 的载荷里能读到**来源**与目标（ctx.input.source / target）",
    cap.before.length >= 1 && cap.before[0].source === src.id && cap.before[0].target === dst.id, JSON.stringify(cap.before.slice(0, 2)));
  ok("★★★ AFTER_DAMAGE 同理", cap.after.length >= 1 && cap.after[0].source === src.id, JSON.stringify(cap.after.slice(0, 2)));
  ok("★★★ DEATH 的载荷里能读到**击杀者**（ctx.killerId）—— 这就是「伤害来源」",
    cap.death.length >= 1 && cap.death[0].killerId === src.id && cap.death[0].target === dst.id, JSON.stringify(cap.death.slice(0, 2)));
}

console.log("\n=== 逐句承受者归属（前置事实）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
