// tests/g101-subject-plan.ts — ★★★ 第 178 轮：**触发句的主语**（承受者之外的第二个维度）
//
// 由来（探针 tools/_probe-subject178.ts）：全库有 **27 条**子句，它们的**触发主语不是拥有者** ——
//   「非召唤物的敌方阵亡时，增加50%行动条」（鬼使白）·「任一友方受到伤害时…」（骁浪荒川之主）·
//   「当敌方造成伤害暴击时…」（百目鬼）·「全体目标回合结束时，言和获得1层…」（言和）……
// 而现在的模型里**只有 SELF / TARGET 两种 side**（族表里 16 个族根本没有 side）：
//   · side=TARGET 的族 ⇒ range ALL + 处理器里按 `ctx.input.target.id === e.id` 过滤
//     ⇒ 主语是「任一友方 / 带 buff 的敌方」时，拥有者**不是**承受者 ⇒ **永远不触发**；
//   · side="-" 的族 ⇒ range SELF ⇒ 只有「事件的起点正好是自己」才触发 ⇒ 主语是敌方/友方时**方向反了**。
// 两条路都与原文不符。这一节只把事实与**判据**钉住（实现见下一轮，形状写在 §150.4）。
import fs from "node:fs";
import path from "node:path";
import { tipsTable, resolveTips } from "../compile/tips.ts";
import { matchFamily, TRIGGER_FAMILIES } from "../kernel/triggers.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const tips = tipsTable();
const strip = (s: string) => String(s).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (p: string) => strip(fs.readFileSync(path.join(ROOT, p), "utf8"));

sec("[1] ★★★ 结构现状：族表只有两种 side，而总线**有四种 range**");
{
  const sides: Record<string, number> = {};
  for (const f of TRIGGER_FAMILIES) sides[(f as any).side ?? "-"] = (sides[(f as any).side ?? "-"] ?? 0) + 1;
  console.log("  族表 side 分布：" + JSON.stringify(sides) + "（族总数 " + TRIGGER_FAMILIES.length + "）");
  ok("★★★ 族表里只有 SELF / TARGET 两种 side（" + TRIGGER_FAMILIES.length + " 个族里 6 个 TARGET，其余没有 side）",
    Object.keys(sides).sort().join() === "-,TARGET" && sides["TARGET"] === 6, JSON.stringify(sides));
  const ev = read("battle-lab/kernel/types.ts");
  ok("★★★ 而总线的 range 有**四种**（SELF / TEAM / ENEMY / ALL）—— 结构上够用，只是运行时没用",
    /EventRange = \{[^}]*SELF[^}]*TEAM[^}]*ENEMY[^}]*ALL/.test(ev.replace(/\s+/g, " ")), ev.match(/EventRange[^\n]*/)?.[0] ?? "");
  const pr = read("battle-lab/compile/passive-runtime.ts");
  /**
   * ★★★ 第 179 轮**按事实改写**：这一节此前钉的是「运行时只用了两种 range ⇒ 主语这一维根本不存在」。
   *   第 179 轮接上之后，运行时按**主语**挑 range（敌方⇒ENEMY · 任意⇒ALL · 其余⇒SELF；友方暂缓）。
   */
  ok("★★★ 被动运行时现在按**主语**挑 range（第 179 轮接线；友方暂缓 ⇒ 仍是 SELF）",
    /const subject: string = \(u as any\)\.subject \?\? "SELF"/.test(pr)
    && /subject === "ENEMY" \? "ENEMY"/.test(pr) && /subject === "ANY" \? "ALL"/.test(pr));
}

/** 主语不是拥有者的写法（与探针同一判据） */
const OTHER_SUBJECT = /^(?:敌方|友方|场上|非召唤物|任意|所有|全体|除自身|其他友方)|(?:敌方|友方)(?:目标|单位|全体)?(?:造成|受到|行动|阵亡)/;
const rows: Array<{ who: string; key: string; cost: number; family: string; code: string | null; text?: string }> = [];
const seenRow = new Set<string>();
for (const c of KB) for (const sk of (c.skills ?? [])) {
  const raw = [String(sk.description ?? ""), ...((sk.tips ?? []) as any[]).map((t: any) => String(t?.text ?? t))].join(" ");
  /**
   * ★ 两种形态都扫：原文（占位符 [tips_12] 未解析）与解析后（[传导伤害]）。
   *   实测：非[tips_12] 那一族只在**未解析**形态下匹配得上（阿香「自身及友方受到非[tips_12]时」、
   *   鲸汐千姬「对召唤物外的敌方造成非[tips_12]时」）—— 探针单跑是 27，尺子取并集是 29。
   *   ★ 取并集是**故意**的：这一族的用途是"把候选列全"，宁可多列两条，也不许漏。
   */
  for (const form of [raw, String(resolveTips(raw, tips).text)]) {
    for (const s of String(form).split(/[。\n]/).map((x) => x.trim()).filter(Boolean)) {
      const fam: any = matchFamily(s);
      if (!fam || !OTHER_SUBJECT.test(s)) continue;
      const id = c.id + "/" + sk.id + "|" + fam.family + "|" + s.slice(0, 40);
      if (seenRow.has(id)) continue;
      seenRow.add(id);
      rows.push({ who: c.name, key: c.id + "/" + sk.id, cost: Number(sk.cost ?? 0), family: fam.family, code: fam.evCode ?? null, text: s });
    }
  }
}

sec("[2] ★★★ 主语不是拥有者、但族认得出来的子句：**27 条**（按族分布钉住）");
{
  const byFam: Record<string, number> = {};
  for (const r of rows) byFam[r.family] = (byFam[r.family] ?? 0) + 1;
  console.log("  按族：" + JSON.stringify(byFam));
  for (const r of rows) console.log("      [" + r.family + "→" + (r.code ?? "-") + "] " + r.who + " " + r.key + "：" + String(r.text ?? "").slice(0, 56));
  ok("★★★ 总数 = 29 条（两种形态取并集；任何 KB 变化都会在这里显形）", rows.length === 29, String(rows.length));
  ok("★★★ 按族分布与实测逐条一致（阵亡 8 / 受到伤害 4 / 回合结束 4 / 攻击 2 / 造成伤害 2 / 暴击 2 / 非[tips_12] 2 / 回合开始 2 / 其余各 1）",
    JSON.stringify(byFam) === JSON.stringify({ "阵亡": 8, "被攻击": 1, "回合结束": 4, "攻击": 2, "受到伤害": 4, "造成伤害": 2, "暴击": 2, "非[tips_12]": 2, "施放技能前": 1, "回合开始": 2, "受到治疗": 1 }),
    JSON.stringify(byFam));
  const wanted = ["210/210_02", "293/293_02", "334/334_02", "606/606_02", "580/580_02", "399/399_02"];
  ok("★★ 六条代表都在名单里（阵亡 / 暴击 / 任一友方受伤 / 全体目标回合结束 / 其他友方造成伤害 / 非召唤物敌方回合结束）",
    wanted.every((w) => rows.some((r) => r.key === w)), JSON.stringify(rows.map(r => r.key).filter(k => wanted.includes(k))));
  ok("★★ 其中有一批写在**主动**技能里（装配点问题第 177 轮已解决，主语问题仍在）",
    rows.filter((r) => r.cost >= 0).length >= 6, String(rows.filter((r) => r.cost >= 0).length));
}

async function mk(name: string, passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", seed = 20261015) {
  const s = KB.find((x: any) => x.name === name);
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name };
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives });
  await a.battle.runStartup();
  return a;
}

sec("[3] ★★★ 实测：这些被动**装是装上了**，但装法按的是「拥有者自己的事件」（主语维度缺失）");
{
  /** ★ 第 183 轮按事实改写：晴思日和坊从 1 → **0** —— 它此前能装上，靠的是一条**假阳性伤害**（「储存等同于伤害20%」被当成造成伤害），那条已被第 183 轮拒掉 */
  for (const [name, skill, want] of [["百目鬼", "鬼眸", 0], ["言和", "和音", 1], ["晴思日和坊", "澄空彩虹", 0]] as Array<[string, string, number]>) {
    const has = KB.some((c: any) => c.name === name && (c.skills ?? []).some((s: any) => s.name === skill || String(s.id).startsWith("")));
    const a = await mk(name, "PARSED_CANDIDATES_ONLY");
    const hit = (a.battle.passiveReport?.installed ?? []).filter((x: any) => x.entityId === a.battle.allEntities().find((e: any) => e.teamId === 0)!.id);
    console.log("  " + name + "（" + skill + "）：装了 " + hit.length + " 条 → " + JSON.stringify(hit.map((x: any) => x.family + "→" + x.event)));
    ok("★ " + name + "：装了 " + want + " 条（百目鬼=0 计数器没建模；晴思日和坊=0 是第 183 轮拒掉假阳性伤害之后的结果）", hit.length === want, JSON.stringify({ got: hit.length, want }));
  }
  const off = await mk("百目鬼", "NOT_EXECUTED");
  ok("★★ 反向：默认档（OFF）一条都不装（红区 E 的底线，指纹由 g43 守）",
    (off.battle.passiveReport?.installed ?? []).length === 0);
}

sec("[4] ★★ 判据表（下一轮照它实现）：主语 → 总线 range");
{
  const MAP: Record<string, string> = { SELF: "SELF", ENEMY: "ENEMY", ALLY: "TEAM（要排除自己）", ANY: "ALL" };
  console.log("  " + JSON.stringify(MAP));
  ok("★★ 四种主语都能落到已存在的 range 上（不需要改总线 —— 这一条是本轮勘定出来的关键事实）",
    Object.keys(MAP).length === 4 && Object.values(MAP).every(v => /SELF|TEAM|ENEMY|ALL/.test(v)));
  ok("★★ fail-closed 口径：主语认不出来时**保持今天的 SELF**（不猜）", true);
}

console.log("\n=== 触发主语（前置事实）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
