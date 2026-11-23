// tests/g104-skill-swap-plan.ts — ★★★ 第 182 轮：**技能替换**这块缺口的真相（引擎缺，还是数据缺？）
//
// 缺口清单里这一条写的是「需要『技能表可换』这一层」——听起来像"引擎做出来就能解锁 33 条"。
// 这一轮把 33 条逐条问了一遍：**目标的技能**在同角色技能表里到底有没有。
// 结论（本文件钉住）：**只有 1 条能解析到**，其余 32 条的目标技能根本不在知识库里
//   （它们是形态 / 姿态专用技能，KB 没有收录）⇒ 这一条的主体是**数据缺口**，不是引擎缺口。
import fs from "node:fs";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const KB: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const byKey = new Map<string, any>((input.skills as any[]).map((e: any) => [String(e.key), JSON.parse(String(e.json))]));

/** 取「替换为 / 替换成」**右侧**的目标（第一版取的是子句里第一个『』里的名字 —— 那是"被替换的"，不是"替换成"的） */
function targetOf(clause: string): { id: string | null; name: string | null } {
  const right = String(clause).split(/替换(?:为|成|普攻为)/)[1] ?? "";
  const idM = /\[skill_(\d+_\d+)\]/.exec(right);
  const nameM = /[『「]([^』」]+)[』」]/.exec(right);
  return { id: idM ? idM[1] : null, name: nameM ? nameM[1] : null };
}

interface Row { who: string; key: string; clause: string; to: string; resolved: string | null; shape: string }
const rows: Row[] = [];
for (const c of KB) for (const sk of (c.skills ?? [])) {
  const ir = byKey.get(c.id + "/" + sk.id);
  const hits = (ir?.unmodeledMechanics ?? []).filter((m: any) => m.verb === "替换");
  if (!hits.length) continue;
  const table = (c.skills ?? []).map((s: any) => ({ id: String(s.id), name: String(s.name) }));
  for (const h of hits) {
    const clause = String(h.clause);
    const t = targetOf(clause);
    const hit = t.id ? table.find((x) => x.id === t.id) : (t.name ? table.find((x) => x.name === t.name) : undefined);
    const shape = /施放后/.test(clause) ? "施放后" : /每\d+次/.test(clause) ? "计数器" : /姿态|状态时|在场时|存活|放逐|击败|阵亡/.test(clause) ? "条件/事件" : /敌方.*技能/.test(clause) ? "改敌方技能" : "其他";
    rows.push({ who: c.name + "「" + sk.name + "」", key: c.id + "/" + sk.id, clause, to: t.id ?? t.name ?? "(取不到)", resolved: hit ? hit.id + "「" + hit.name + "」" : null, shape });
  }
}

sec("[1] ★★★ 规模：带「替换」记账的技能与子句数");
{
  const skills = new Set(rows.map((r) => r.key));
  console.log("  形状分布：" + JSON.stringify(rows.reduce((m: any, r) => { m[r.shape] = (m[r.shape] ?? 0) + 1; return m; }, {})));
  ok("★★★ 「替换」子句 = 33 条，落在 " + skills.size + " 个技能上", rows.length === 33 && skills.size >= 18, JSON.stringify({ clauses: rows.length, skills: skills.size }));
}

sec("[2] ★★★ 关键事实：目标技能**能不能在同一个角色的技能表里解析到**");
{
  const good = rows.filter((r) => r.resolved);
  console.log("  能解析到的：" + (good.map((r) => r.who + " → " + r.resolved).join(" · ") || "（无）"));
  console.log("  解析不到的（前 8 条）：");
  for (const r of rows.filter((r) => !r.resolved).slice(0, 8)) console.log("      " + r.who + " → 目标 " + r.to + " ← " + r.clause.slice(0, 52));
  ok("★★★ 能解析到的**只有 1 条**：待宵姑获鸟「墨风」的『[skill_354_03]』（墨影剑光，同表里就有）",
    good.length === 1 && /354_03/.test(good[0]?.resolved ?? ""), JSON.stringify(good.map((r) => r.who + "/" + r.resolved)));
  ok("★★★ 其余 **32 条**的目标技能不在同角色技能表里（形态 / 姿态专用技能，KB 没收录）",
    rows.length - good.length === 32, String(rows.length - good.length));
  ok("★★ 目标取自「替换为 / 替换成」的**右侧**（第一版取的是子句里第一个『』——那是被替换的那个）",
    /追魂/.test(rows.find((r) => /惩戒/.test(r.who))?.to ?? ""), JSON.stringify(rows.find((r) => /惩戒/.test(r.who))));
}

sec("[3] ★★★ 结论：这一条缺口的主体是**数据**，不是引擎");
{
  const shapes = rows.reduce((m: any, r) => { m[r.shape] = (m[r.shape] ?? 0) + 1; return m; }, {});
  console.log("  形状：" + JSON.stringify(shapes));
  console.log("  ⇒ 引擎层（可换的技能表 + 计数器 / 事件触发）做出来，**当前知识库条件下只能解锁 1 条**；");
  console.log("    另外 32 条要先把那些形态 / 姿态专用技能**收进 KB**（它们的技能文案、倍率、AI 规则都不知道）。");
  ok("★★★ 记账口径据此改：这一条从「仓库内可做」改成**数据阻塞**（KB 缺形态技能定义）", true);
  const row354 = rows.find((r) => /354_01/.test(r.key))!;
  const full = String((byKey.get("354/354_01")?.sentences ?? []).map((s: any) => String(s?.text ?? "")).find((t: string) => t.includes("skill_354_03")) ?? "");
  ok("★★ 而「待宵姑获鸟」那一条即便目标解析得到，也还需要**计数器**（整句写的是「每3次普攻后…」）—— 与百目鬼「鬼眸」同型",
    /每3次/.test(full), JSON.stringify({ 片段: row354.clause, 整句: full.slice(0, 60) }));
}

console.log("\n=== 技能替换（前置事实）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
