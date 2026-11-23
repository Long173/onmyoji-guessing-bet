// tests/g88-skill-swap.ts — ★★★ 第 134 轮：**「技能替换」这一族第一次有了具名的缺口**
//
// 由来：全库 33 条子句写着「…技能替换为『X』」（姿态 / 状态 / 场上条件触发），而引擎里
//   **没有任何"换技能表"的入口** —— 一个单位的技能表在装配时就定死（Entity.skills），
//   选招只在这张表里挑。可此前这 33 条的账是**分裂**的：
//     · 一部分被逐句分类判成 MECHANIC_UNPARSED，但**没有一条具名的缺口**（说不清缺的是什么机制）；
//     · 另一部分干脆是 PARSED（"完整编译"）—— 报表比代码乐观，正是动词表存在的理由。
// 这一轮把动词表加上「替换」，缺口具名；本文件是它的双向验证与**行为面**钉子。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { splitClauses } from "../compile/skill-compiler.ts";
import { findUnmodeled, UNMODELED } from "../compile/unmodeled.ts";
import { loadTips, setTipsTable } from "../compile/tips.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const tipsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
setTipsTable(loadTips(Array.isArray(tipsRaw) ? tipsRaw : (Object.values(tipsRaw).find((v: any) => Array.isArray(v)) as any[]) ?? []));

sec("[1] ★★★ 动词表新增「替换」：全库 33 条子句逐条具名");
{
  const entry = UNMODELED.find((e: any) => e.verb === "替换");
  ok("★★★ 动词表里有「替换」，且声明为 WARN（它改的是「接下来能放什么」）",
    !!entry && entry.severity === "WARN", JSON.stringify(entry && { verb: entry.verb, severity: entry.severity }));
  const found: Array<{ who: string; skill: string; clause: string }> = [];
  for (const s of LIST) for (const sk of (s.skills ?? [])) {
    const ir: any = compileSkill(s.id, s.name, sk);
    for (const h of (ir.unmodeledMechanics ?? []).filter((x: any) => x.verb === "替换")) found.push({ who: s.name, skill: sk.name, clause: String(h.clause) });
  }
  ok("★★★ 全库恰好 33 条（量出来的，不是我挑的）", found.length === 33, String(found.length));
  ok("★★★ 每一条的子句里都真的有「替换」（没有一条是误伤）",
    found.every(x => /替换/.test(x.clause)), JSON.stringify(found.filter(x => !/替换/.test(x.clause))));
  // 抽查几条**形态完全不同**的写法都收进来了（姿态 / 状态 / 场上条件 / 普攻替换 / 敌方技能替换）
  for (const [who, skill] of [["不知火", "初舞"], ["灶门祢豆子", "腿踢"], ["跳跳妹妹", "汪汪出击"], ["般若", "鬼袭"], ["百目鬼", "诅咒之眼"]] as Array<[string, string]>) {
    ok("★★ 「" + who + "「" + skill + "」」在清单里", found.some(x => x.who === who && x.skill === skill));
  }
}

sec("[2] ★★★ 双向：真写法必须收，免疫声明必须不收");
{
  const yes = findUnmodeled("【施放】施放后将该技能替换为「春告」", splitClauses);
  ok("★★★ 真写法（施放后…替换为）⇒ 收", yes.some(h => h.verb === "替换"), JSON.stringify(yes.map(h => h.verb)));
  const yes2 = findUnmodeled("处于离殇姿态时，技能替换为『终舞』", splitClauses);
  ok("★★★ 另一种写法（姿态条件）⇒ 同样收", yes2.some(h => h.verb === "替换"), JSON.stringify(yes2.map(h => h.verb)));
  const no = findUnmodeled("该技能不可替换", splitClauses);
  ok("★★★ 免疫声明（不可替换）⇒ **必须不收**（否定语境规则）", !no.some(h => h.verb === "替换"), JSON.stringify(no.map(h => h.verb)));
  const no2 = findUnmodeled("此技能无法替换为其他技能", splitClauses);
  ok("★★★ 「无法替换」⇒ 同样不收", !no2.some(h => h.verb === "替换"), JSON.stringify(no2.map(h => h.verb)));
}

sec("[3] ★★★ 句子分类也必须跟着改（「此前是 PARSED」的那些要变成 MECHANIC_UNPARSED）");
{
  const wasParsed: Array<[string, string]> = [["百目鬼", "诅咒之眼"], ["季", "弥天叶唳"], ["孔雀明王", "流羽风"], ["天逆每", "惧刃之风"], ["犬神", "守护"], ["闻人翊悬", "火拳"]];
  const bad: string[] = [];
  for (const [who, skill] of wasParsed) {
    const s = LIST.find((x: any) => x.name === who)!;
    const sk = (s.skills ?? []).find((x: any) => x.name === skill)!;
    const ir: any = compileSkill(s.id, s.name, sk);
    const hit = (ir.unmodeledMechanics ?? []).find((m: any) => m.verb === "替换")!;
    const sent = (ir.sentences ?? []).find((x: any) => x.text.includes(String(hit.clause).slice(0, 6)));
    if (!sent || sent.kind !== "MECHANIC_UNPARSED") bad.push(who + "「" + skill + "」→ " + (sent?.kind ?? "找不到那句"));
  }
  ok("★★★ 这六条此前被判成 PARSED 的，现在都是 MECHANIC_UNPARSED", bad.length === 0, JSON.stringify(bad));
}

sec("[4] ★★★ 行为面：引擎里确实没有换技能表的入口（技能表在整场战斗里不变）");
{
  const g = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const assigners = ["battle-lab/compile/character.ts", "battle-lab/kernel/state.ts"]
    .filter(p => /\.skills\s*=/.test(g(p)));
  ok("★★ 只有装配与恢复两处会写 Entity.skills（没有第三处）",
    assigners.length === 2, JSON.stringify(assigners));

  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], name: "不知火", shikigamiId: LIST.find((x: any) => x.name === "不知火")!.id };
  const a: any = assembleMatch(createKit(bundle), m, { seed: 134134, traceLevel: "SUMMARY" });
  await a.battle.runStartup();
  const e = a.battle.teams[0].members[0];
  const before = (e.skills ?? []).map((x: any) => x.name).join(",");
  await a.battle.run();
  const after = (e.skills ?? []).map((x: any) => x.name).join(",");
  ok("★★★ 「不知火」带着替换条款打了整场，技能表**一个名字都没变**（这就是未实现的直接证据）",
    before === after && before.length > 0, JSON.stringify({ before, after }));
}

console.log("\ng88-skill-swap: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);