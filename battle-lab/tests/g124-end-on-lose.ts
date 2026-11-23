// tests/g124-end-on-lose.ts — ★★★ 第 246 轮：**「失去 X 时结束 Y」**（蝉冰雪女「永冬」362_03）
//
// 原文：「化作凛冽的冰枪侵袭敌方目标，造成防御450%伤害，使其[tips_3621]。自身获得[buff_3622_1]，
//        若失去[buff_3622_1]则结束[tips_3621]。敌方存在[tips_3621]目标时，无法施放此技能。」
// 形状：**失去状态 ⇒ 结束另一个状态**。引擎里「失去」本来就有派发点（EV.STATUS_EXPIRE / EV.STATUS_REMOVE 都进总线），
//  所以这一条不需要新概念 —— 一个挂在拥有者身上的「失去监视」处理器就够（判据见 SkillIR.endOnLose 的注）。
// ★ 关键实测（第一版踩的坑）：362_03 是**主动技能**，监视器必须装在**施放点**（先施放、才获得要监视的 buff）——
//   装在被动装配点上永远不会发生（那一版跑出来两个处理器都没挂上）。
import fs from "node:fs";
import path from "node:path";
import { EV } from "../kernel/types.ts";
import { StatusBook, controlDefByTipName } from "../kernel/status.ts";
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

sec("[1] ★★★ 产物：全库恰好 1 条带 endOnLose（蝉冰雪女「永冬」362_03）");
{
  const withE = dump.filter((ir: any) => ir.endOnLose);
  ok("★★★ 恰好 1 条，就是 362_03", withE.length === 1 && withE[0].id === "362_03", JSON.stringify(withE.map((ir: any) => ir.id)));
  const e = withE[0]?.endOnLose ?? {};
  ok("★★★ 字段逐字：监视 buff_3622_1 ⇒ 结束 frost（霜冻）",
    String(e.watchRef) === "3622_1" && String(e.removeRef) === "frost" && String(e.removeName) === "霜冻", JSON.stringify(e));
  ok("★★ 判据原句可复核（同时含「若失去」与「则结束」）", /若失去/.test(String(e.clause)) && /则结束/.test(String(e.clause)), String(e.clause));
  ok("★★★ 报表点名（recognized 里能看到这条技能靠哪个机制）",
    (withE[0]?.recognized ?? []).some((r: string) => r === "endOnLose:3622_1→frost"), JSON.stringify(withE[0]?.recognized));
  ok("★★★ 记账：那条「结束霜冻」的 CONDITIONAL_BRANCH 收掉，而**条件那一侧**的引用形态照旧留着",
    !(withE[0]?.controlSkips ?? []).some((s: any) => s.name === "霜冻" && s.reason === "CONDITIONAL_BRANCH") &&
    (withE[0]?.controlSkips ?? []).some((s: any) => s.name === "霜冻" && s.reason === "REFERENCE_FORM"),
    JSON.stringify(withE[0]?.controlSkips));
  ok("★★★ 别的 817 条技能没有这个键", dump.filter((ir: any) => ir.endOnLose).length === 1, String(dump.length));
}

sec("[2] ★★★ 行为：失去 buff_3622_1 ⇒ 结束敌方身上的霜冻（两条失去路径都算）");
const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return { unitId: "u-" + name, shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 40000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 }, soulId: null };
};
async function arena(who: string, seed: number) {
  const m: any = canonicalMatch();
  m.red.units[0] = unit(who);
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives: "PARSED_CANDIDATES_ONLY", traceLevel: "FULL" });
  await a.battle.runStartup();
  return { b: a.battle, e: a.battle.teams[0].members[0], foe: a.battle.teams[1].members[0] };
}
const hasFrost = (u: any) => (u.statuses ?? []).some((x: any) => String(x?.def?.id) === "frost");
const watchOn = (u: any) => (u.statuses ?? []).some((x: any) => String(x?.def?.id) === "3622_1");
{
  const frostDef = controlDefByTipName("霜冻");
  ok("★★ 前置：霜冻是 CONTROL_EFFECTS 里的状态（controlDefByTipName 认它）", !!frostDef);
  const A = await arena("蝉冰雪女", 246);
  const sk = (A.e.skills ?? []).find((s: any) => String(s?.ir?.id ?? "") === "362_03");
  ok("★★ 前置：这一招在自己的技能表里", !!sk, JSON.stringify((A.e.skills ?? []).map((s: any) => s?.ir?.id)));
  if (sk) await sk.execute(A.b, A.e, A.foe, undefined, { free: true });
  ok("★★★ 施放一次就把三件事都做了：敌方挂霜冻 · 自身获得要监视的 buff_3622_1 · 装上监视器（两条失去路径）",
    hasFrost(A.foe) && watchOn(A.e) &&
    A.b.bus.hasHandler("end_on_lose:STATUS_EXPIRE:" + A.e.id + ":永冬") && A.b.bus.hasHandler("end_on_lose:STATUS_REMOVE:" + A.e.id + ":永冬"),
    JSON.stringify({ frost: hasFrost(A.foe), watch: watchOn(A.e), h1: A.b.bus.hasHandler("end_on_lose:STATUS_EXPIRE:" + A.e.id + ":永冬"), h2: A.b.bus.hasHandler("end_on_lose:STATUS_REMOVE:" + A.e.id + ":永冬") }));
  ok("★★ 前置：buff_3622_1 的定义在施放时登记进 StatusBook（状态定义不是凭空来的）", !!StatusBook.get("3622_1"));
  const expire = (status: string, selfId: number) => A.b.bus.dispatch(EV.STATUS_EXPIRE, { battle: A.b, entity: A.e, status, name: status, reason: "DURATION" }, selfId, 0, (id: number) => A.b.teamOf(id));
  const t0 = A.b.trace.length;
  await expire("9999_9", A.e.id);
  ok("★★★ 反向：别的状态到期 ⇒ 霜冻**一个都不清**（只认监视的那一个）",
    hasFrost(A.foe) && !A.b.trace.slice(t0).some((x: any) => x.reason === "ENDED_ON_LOSE"), JSON.stringify(A.b.trace.slice(t0).map((x: any) => x.t)));
  /** ★ 反向的判据要落在**载荷里的 entity** 上：总线的 ALL 只按事件码分发（第一版把派发方换成别人，处理器照样跑） */
  await A.b.bus.dispatch(EV.STATUS_EXPIRE, { battle: A.b, entity: A.foe, status: "3622_1", name: "3622_1", reason: "DURATION" }, A.foe.id, A.foe.teamId, (id: number) => A.b.teamOf(id));
  ok("★★★ 反向：失去监视状态的是**别人**（载荷 entity 是敌方）⇒ 自己这边不清霜冻", hasFrost(A.foe), String(hasFrost(A.foe)));
  await expire("3622_1", A.e.id);
  const ev = A.b.trace.slice(t0);
  ok("★★★ 正例：自己失去 buff_3622_1 ⇒ 敌方霜冻被结束，且留痕 reason=ENDED_ON_LOSE",
    !hasFrost(A.foe) && ev.some((x: any) => x.t === "STATUS_EXPIRE" && x.status === "frost" && x.reason === "ENDED_ON_LOSE"),
    JSON.stringify(ev.filter((x: any) => x.t === "STATUS_EXPIRE").map((x: any) => [x.status, x.reason])));
  const removePath = await (async () => {
    if (frostDef) A.foe.addStatus(frostDef as any, A.e.id, 1, 3);
    A.e.addStatus(StatusBook.get("3622_1") as any, A.e.id, 1, 3);
    await A.b.bus.dispatch(EV.STATUS_REMOVE, { battle: A.b, entity: A.e, status: "3622_1", name: "3622_1", by: "DISPEL" }, A.e.id, 0, (id: number) => A.b.teamOf(id));
    return !hasFrost(A.foe);
  })();
  ok("★★★ 另一条失去路径（STATUS_REMOVE 被解除）同样会结束它", removePath, String(hasFrost(A.foe)));
  const noTarget = await (async () => {
    const t1 = A.b.trace.length;
    A.e.addStatus(StatusBook.get("3622_1") as any, A.e.id, 1, 3);
    await expire("3622_1", A.e.id);
    return !A.b.trace.slice(t1).some((x: any) => x.reason === "ENDED_ON_LOSE");
  })();
  ok("★★★ 反向：敌方身上本来就没有霜冻 ⇒ 什么都不做、也不留痕", noTarget, "无霜冻时不该有 ENDED_ON_LOSE 痕迹");
}

sec("[3] ★★ 爆炸半径：蝉冰雪女不在典型阵容里（指纹的护栏）");
{
  const LINEUP = [202, 297, 601, 225, 346, 205, 358, 267, 352, 390];
  const c = LIST.find((x: any) => x.name === "蝉冰雪女");
  ok("★★ 362 不在典型对局阵容里 ⇒ 两个指纹不该动（另见 g0/g3 的指纹断言）", !!c && !LINEUP.includes(Number(c.id)), String(c?.id));
}

console.log("\ng124-end-on-lose: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);