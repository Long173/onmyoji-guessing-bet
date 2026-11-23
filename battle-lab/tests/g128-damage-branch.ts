// tests/g128-damage-branch.ts — ★★★ 第 250/251 轮：**条件伤害分支**（御怨般若 331_01 / 331_03）
//
// 两轮两件事：
//   · 第 250 轮：**如实记账** —— 这两条此前 `confidence: HIGH` / `unparsed: []` / 无未建模，也就是报表说「完整编译」，
//     而实测（tools/_probe-dd250.ts）伤害形状不对：「恨返」一次施放 **4 条**（原文 1 或 2 条）、「予愿必还」**15 条**（原文 8 或 13 条）。
//   · 第 251 轮：**修「多算」这一半** —— 把「则此技能改为…」那一支从可执行产物里**摘出来**（`SkillIR.damageBranch`），
//     基础形态的 `hits` 收回 1 ⇒ 331_01 现在只打 **1 条**（未开结界的那一种读法）。
//     ★ 那一支**仍未执行**（条件「封印结界」在引擎里没有载体）⇒ 记账户头照旧保留 —— 修的是多算，不是把分支做出来。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const dump: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "skill-ir.json"), "utf8"));
const flagged = (ir: any) => (ir.unmodeledMechanics ?? []).filter((m: any) => m.verb === "条件伤害分支");

sec("[1] ★★★ 记账（第 250 轮）：全库恰好 2 条具名缺口，句子分类跟着走");
{
  const withFlag = dump.filter((ir: any) => flagged(ir).length > 0);
  ok("★★★ 恰好 2 条，就是这两条", withFlag.length === 2 && withFlag.map((ir: any) => ir.id).sort().join(",") === "331_01,331_03", JSON.stringify(withFlag.map((ir: any) => ir.id)));
  for (const id of ["331_01", "331_03"]) {
    const ir: any = dump.find((x: any) => x.id === id);
    const m = flagged(ir)[0];
    ok("★★★ " + id + "：verb/severity/clause 都在（clause 可复核）",
      !!m && m.severity === "WARN" && /则此技能改为|再增加\s*\d+\s*次/.test(String(m.clause)), JSON.stringify(m).slice(0, 180));
    ok("★★★ " + id + "：那一句判 MECHANIC_UNPARSED（不再自称完整编译）",
      (ir.sentences ?? []).some((s: any) => s.kind === "MECHANIC_UNPARSED") && (ir.unparsed ?? []).length >= 1,
      JSON.stringify((ir.sentences ?? []).map((s: any) => s.kind)));
    ok("★★ 证据指向实测探针（按 §173.3，探针必须留在仓库里）", /_probe-dd250/.test(String(m.evidence)) && fs.existsSync(path.join(ROOT, "battle-lab", "tools", "_probe-dd250.ts")), String(m.evidence).slice(0, 80));
  }
}

sec("[2] ★★★ 修正（第 251 轮）：变体那一支被**摘出来**，不再参与执行");
{
  const a: any = dump.find((x: any) => x.id === "331_01");
  ok("★★★ 331_01 的可执行伤害槽只剩基础那一条（100%）—— 分支的 80% 已经不在里面",
    JSON.stringify((a.damage ?? []).map((d: any) => [d.base, d.ratio])) === JSON.stringify([["atk", 100]]), JSON.stringify(a.damage));
  ok("★★★ 基础形态的 hits 收回 1（那个「2次」属于分支，不属于基础形态）", Number(a.hits) === 1, String(a.hits));
  ok("★★★ 摘出来的那一支原样记在 damageBranch 里（hits/ratio/条件名/原槽），可复核",
    !!a.damageBranch && Number(a.damageBranch.hits) === 2 && Number(a.damageBranch.ratio) === 80 && String(a.damageBranch.gateName) === "封印结界" && Number(a.damageBranch.movedSlot.ratio) === 80,
    JSON.stringify(a.damageBranch));
  ok("★★★ 报表点名：recognized 里既有记账的来源、也有摘出的那一支",
    (a.recognized ?? []).includes("damageBranch:2x80%") && (a.recognized ?? []).some((r: string) => r === "dmg:N100"), JSON.stringify(a.recognized));
  const b: any = dump.find((x: any) => x.id === "331_03");
  ok("★★ 331_03 的伤害槽与 hits 仍是 [72]/3（第 252 轮补上的是**分段形状** damageSegments —— 见 tests/g129-damage-segments.ts；条件分支那一半仍未执行）",
    JSON.stringify((b.damage ?? []).map((d: any) => [d.base, d.ratio])) === JSON.stringify([["atk", 72]]) && Number(b.hits) === 3 && b.damageBranch === undefined,
    JSON.stringify({ damage: b.damage, hits: b.hits, branch: b.damageBranch ?? null }));
}

sec("[3] ★★★ 行为：331_01 一次施放只打 1 条（此前 4 条）");
const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return { unitId: "u-" + name, shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 40000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 }, soulId: null };
};
const run = async (id: string) => {
  const m: any = canonicalMatch();
  m.red.units[0] = unit("御怨般若");
  const a: any = assembleMatch(createKit(bundle), m, { seed: 251, passives: "NOT_EXECUTED", traceLevel: "FULL" });
  await a.battle.runStartup();
  const e = a.battle.teams[0].members[0];
  const foe = a.battle.teams[1].members[0];
  const sk = (e.skills ?? []).find((k: any) => String(k?.ir?.id ?? "") === id)!;
  const t0 = a.battle.trace.length;
  await sk.execute(a.battle, e, foe, undefined, { free: true });
  return a.battle.trace.slice(t0).filter((x: any) => x.t === "DAMAGE");
};
{
  const ev = await run("331_01");
  ok("★★★ 331_01 一次施放 ⇒ **1 条**伤害事件（第 250 轮实测是 4 条；原文未开结界时就是 1 条）", ev.length === 1, String(ev.length));
  ok("★★★ 而且打的是**单个目标**（不是全体）", ev.every((x: any) => x.dst === ev[0].dst), JSON.stringify(ev.map((x: any) => x.dst)));
  const ev3 = await run("331_03");
  /**
   * ★★★ 第 252 轮**按事实改写**：第 251 轮这里断言的是「仍是 15 条（没有被误改）」——
   *   而第 252 轮把它的**形状**修对了（`damageSegments`：3 次单体 + 1 次全体 ⇒ 8 条）。
   *   记账那一半照旧：条件分支（开封印结界再 +1 次）仍未执行，`damageBranch` 里记着它。
   */
  ok("★★★ 331_03 现在 **8 条**（3 次单体 + 1 次全体）—— 第 252 轮修掉了那 15 条里的多算（形状判据见 tests/g129-damage-segments.ts）", ev3.length === 8, String(ev3.length));
}

sec("[4] ★★★ 反向：控制类的「改为」分支不会被当伤害分支摘掉");
{
  const x362: any = dump.find((x: any) => x.id === "362_03");
  ok("★★★ 蝉冰雪女 362_03：damageBranch 不存在，而它自己的 endOnLose 仍在", x362.damageBranch === undefined && !!x362.endOnLose, JSON.stringify({ branch: x362.damageBranch ?? null, endOnLose: !!x362.endOnLose }));
  const x201: any = dump.find((x: any) => x.id === "201_03");
  ok("★★★ 雪女 201_03：同理（它的分支是控制效果位变体）", x201.damageBranch === undefined && !!x201.controlRefs?.[0]?.variant);
  const LINEUP = [202, 297, 601, 225, 346, 205, 358, 267, 352, 390];
  ok("★★ 御怨般若不在典型阵容里 ⇒ 两个指纹不该动", !LINEUP.includes(331));
}

console.log("\ng128-damage-branch: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);