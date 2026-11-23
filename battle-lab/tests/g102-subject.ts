// tests/g102-subject.ts — ★★★ 第 179 轮：触发句的**主语**（谁身上发生这件事）接线
//
// 第 178 轮勘定：全库 29 条子句的主语不是拥有者，而族表只有 SELF / TARGET 两种 side ⇒
//   要么被 t === e.id 过滤掉（永远不触发）、要么按 range SELF 装（方向反了）。
// 本轮把主语这一维接上：kernel/triggers.ts 的 subjectOf（逐句判据、认不出=SELF）
//   → 被动运行时按主语挑总线 range（敌方⇒ENEMY · 任意⇒ALL · 其余⇒SELF）。
// ★ 友方（TEAM）**暂缓**：'友方'要不要排除自己还需要一次裁定，裁定前保持 SELF（fail-closed）。
import fs from "node:fs";
import path from "node:path";
import { EV } from "../kernel/types.ts";
import { subjectOf } from "../kernel/triggers.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));

sec("[1] ★★★ 主语判据表（纯函数，双向）");
{
  const cases: Array<[string, string]> = [
    ["非召唤物的敌方目标回合结束时，言灵增加1层墨灵", "ENEMY"],
    ["当敌方造成伤害暴击时，百目鬼有40%概率睁开一只鬼眸", "ENEMY"],
    ["全体目标回合结束时，言和获得1层[buff_6062_1]", "ANY"],
    ["场上3名或以上非召唤物单位阵亡时，移除自身所有状态和印记", "ANY"],
    ["任一友方受到伤害时，若该次伤害超过其生命上限30%", "ALLY"],
    ["其他友方造成伤害时，储存等同于伤害20%的彩虹能量", "ALLY"],
    ["全体友方获得1层护盾", "ALLY"],
    ["自身及友方受到非[tips_12]时，有25%概率反击敌方", "ALLY"],
    ["回合结束后，若自身未承受[tips_3]，则打起精神来", "SELF"],
    ["受到攻击时，有40%概率为攻击者附加[buff_2322_1]", "SELF"],
    ["", "SELF"],
  ];
  for (const [clause, want] of cases) {
    const got = subjectOf(clause);
    ok("★ " + (clause ? clause.slice(0, 22) + "…" : "(空串)") + " ⇒ " + want, got === want, got);
  }
  ok("★★ 顺序敏感的一条：「全体友方」是 ALLY 而不是 ANY（ALLY 的判据排在 ANY 前面）",
    subjectOf("全体友方获得护盾") === "ALLY" && subjectOf("全体目标回合结束时") === "ANY");
}

async function mk(name: string, passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", seed = 20261016) {
  const s = KB.find((x: any) => x.name === name);
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name };
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives });
  await a.battle.runStartup();
  return a;
}
const selfOf = (b: any) => b.allEntities().find((e: any) => e.teamId === 0)!;
const foesOf = (b: any) => b.allEntities().filter((e: any) => e.teamId === 1);
const matesOf = (b: any) => b.allEntities().filter((e: any) => e.teamId === 0);
const SKILL = "399_02";
const layersOf = (e: any, ref: string) => {
  const st = (e.statuses ?? []).find((s: any) => String(s.def?.id ?? "") === ref);
  return st ? Number(st.stacks ?? 0) : 0;
};
const refOf = (e: any, skillId: string) => String((e.skills ?? []).find((s: any) => String(s.ir?.id ?? "") === skillId)?.ir?.statusRefs?.[0] ?? "");

sec("[2] ★★★ 装法：主语决定 range（报表里逐条记着）");
{
  const a = await mk("言灵", "PARSED_CANDIDATES_ONLY");
  const e = selfOf(a.battle);
  const mine = (a.battle.passiveReport?.installed ?? []).filter((x: any) => x.entityId === e.id);
  console.log("  言灵装了：" + JSON.stringify(mine.map((x: any) => x.family + "→" + x.event + " subject=" + x.subject + " range=" + x.range)));
  const t = mine.find((x: any) => x.family === "回合结束");
  ok("★★★ 主语=敌方 ⇒ range=ENEMY（此前是 SELF）", !!t && t.subject === "ENEMY" && t.range === "ENEMY", JSON.stringify(t));
}

sec("[3] ★★★ 行为双向（言灵 · 敌方回合结束才触发）");
{
  const a = await mk("言灵", "PARSED_CANDIDATES_ONLY");
  const b = a.battle;
  const e = selfOf(b);
  const ref = refOf(e, SKILL);
  ok("前置：言灵的被动能读出状态引用", !!ref, ref);
  const foe = foesOf(b)[0];
  const before = layersOf(e, ref);
  /**
   * ★ 层数取 IR 的 `statusStacks`（**技能级**）：这个技能里另有一句写着「言灵增加2层[buff_3991_1]」，
   *   所以一次触发是 +2。★ 「效果按子句归因」是另一条已知缺口（hasExecutableSurface 的注里写着），本轮不动它。
   */
  const per = Number((e.skills ?? []).find((s: any) => String(s.ir?.id ?? "") === SKILL)?.ir?.statusStacks?.[0]?.stacks ?? 1);
  await b.bus.dispatch(EV.TURN_END, {}, foe.id, foe.teamId, (id: number) => b.teamOf(id));
  const afterFoe = layersOf(e, ref);
  ok("★★★ **敌方**单位回合结束 ⇒ 层数 +" + per + "（接线前它永远不会触发；层数取 IR 的技能级 statusStacks）",
    afterFoe === before + per, JSON.stringify({ before, afterFoe, per, ref }));
  const mate = matesOf(b).find((x: any) => x.id !== e.id)!;
  await b.bus.dispatch(EV.TURN_END, {}, mate.id, mate.teamId, (id: number) => b.teamOf(id));
  ok("★★★ **友方**单位回合结束 ⇒ 层数不变（主语不是友方）", layersOf(e, ref) === afterFoe, String(layersOf(e, ref)));
  await b.bus.dispatch(EV.TURN_END, {}, e.id, e.teamId, (id: number) => b.teamOf(id));
  ok("★★★ **自己**回合结束 ⇒ 层数也不变（主语是敌方，不是自己）", layersOf(e, ref) === afterFoe, String(layersOf(e, ref)));
}

sec("[4] ★★ 行为（言和 · 任意单位回合结束都触发）");
{
  const a = await mk("言和", "PARSED_CANDIDATES_ONLY");
  const b = a.battle;
  const e = selfOf(b);
  const mine = (b.passiveReport?.installed ?? []).filter((x: any) => x.entityId === e.id);
  const t = mine.find((x: any) => x.family === "回合结束");
  ok("★★ 言和的主语=任意 ⇒ range=ALL", !!t && t.subject === "ANY" && t.range === "ALL", JSON.stringify(t));
  const ref = refOf(e, "606_02");
  const mate = matesOf(b).find((x: any) => x.id !== e.id)!;
  const before = layersOf(e, ref);
  await b.bus.dispatch(EV.TURN_END, {}, mate.id, mate.teamId, (id: number) => b.teamOf(id));
  ok("★★★ **别的友方**回合结束 ⇒ 言和拿到 1 层（此前按 range SELF 不会发生）",
    layersOf(e, ref) === before + 1, JSON.stringify({ before, after: layersOf(e, ref), ref }));
}

sec("[5] ★★ 反向：默认档（被动 OFF）一条都不装（红区 E 的底线，指纹由 g43 守）");
{
  const a = await mk("言灵", "NOT_EXECUTED");
  ok("★★ 默认档 installed 为空", (a.battle.passiveReport?.installed ?? []).length === 0,
    JSON.stringify((a.battle.passiveReport?.installed ?? []).length));
}

console.log("\n=== 触发主语: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
