// tests/g116-purge-named.ts — ★★★ 第 196 轮：**按名驱散 + 方向按整句判**（兔丸「守护之心」289_03）
//
// 由来：原文「对随机非召唤物的**友方目标**，驱散其带有的[tips_101](冰冻)、[tips_102](沉睡)或[tips_1](解除)
//   其带有的[tips_107](变形)、[tips_108](眩晕)和[tips_112](深度冰冻)」此前被读成
//   「对**敌方**驱散 1 个**任意**状态」—— 方向、范围、对象三处全错：一个"给友方解控"的技能变成了"扒敌人一个状态"。
// 本轮：产物 purge 条目新增 statusIds（按名）；方向在小句没有主谓时按**整句**判；
//   `[tips_1]`（=「解除」）把同一个句子切成 DISPEL / REMOVE 两半 —— 这不是猜，是数据。
import fs from "node:fs";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";
import { controlDefByTipName } from "../kernel/status.ts";
import { isActionPrevented } from "../kernel/status.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const rows = (input.skills as any[]).map((e: any) => ({ key: String(e.key), ir: JSON.parse(String(e.json)) }));
const irOf = (k: string) => rows.find((x) => x.key === k)!.ir;

sec("[1] 产物：全库 44 条 purge，带 statusIds 的只有兔丸一个技能");
{
  const all = rows.flatMap((x) => x.ir.purge.map((p: any) => ({ who: x.ir.charName + "「" + x.ir.name + "」", p })));
  console.log("  purge 条目 = " + all.length);
  ok("★★★ 全库 purge 条目 = 44（第 196 轮摘掉「不会自动移除」50→49；第 199 轮摘掉 5 条规则句/条件句 49→44）", all.length === 44, String(all.length));
  const named = all.filter((x) => x.p.statusIds);
  ok("★★★ 带 statusIds 的条目 = 2，且都属于兔丸「守护之心」", named.length === 2 && named.every((x) => x.who.includes("兔丸")), JSON.stringify(named.map((x) => x.who)));
  const t = irOf("289/289_03").purge;
  ok("★★★ 一个句子按 `[tips_1]`（=解除）切成两半：DISPEL[冰冻,沉睡] + REMOVE[变形,眩晕,深度冰冻]",
    t.length === 2 && t[0].kind === "DISPEL" && JSON.stringify(t[0].statusIds) === JSON.stringify(["freeze", "sleep"]) &&
    t[1].kind === "REMOVE" && JSON.stringify(t[1].statusIds) === JSON.stringify(["morph", "stun", "deepFreeze"]), JSON.stringify(t.map((p: any) => [p.kind, p.statusIds])));
  ok("★★★ 方向 = ALLY（小句里没有主谓 ⇒ 按整句的「友方目标」判）—— 修好了此前判成 ENEMY 的那一处", t.every((p: any) => p.side === "ALLY"), JSON.stringify(t.map((p: any) => p.side)));
  ok("★★ 按名驱散 ⇒ count=99（原文没写个数，就是把这几类都清掉）", t.every((p: any) => p.count === 99));
  ok("★★★ 切两半的依据是数据：冰冻/沉睡 dispellable=true，而变形/眩晕/深度冰冻 dispellable=false + removable=true",
    controlDefByTipName("冰冻")!.dispellable === true && controlDefByTipName("沉睡")!.dispellable === true &&
    controlDefByTipName("变形")!.dispellable === false && controlDefByTipName("变形")!.removable === true &&
    controlDefByTipName("眩晕")!.dispellable === false && controlDefByTipName("深度冰冻")!.dispellable === false);
  ok("★★★ 食梦貘「沉睡」那条假命中已被排除（证据里不再有「不会自动移除」）",
    all.every((x) => !/不会[^。；]{0,6}(?:移除|解除)|自动移除/.test(String(x.p.evidence))),
    JSON.stringify(all.filter((x) => /自动移除/.test(String(x.p.evidence))).map((x) => x.who)));
  ok("★★ 其余 42 条 purge 一条都没带 statusIds（没有顺手动别的技能）", all.filter((x) => !x.p.statusIds).length === 42);
}

sec("[2] 端到端：给友方解控（按名 + 只碰友方这一侧）");
const mk = async (seed: number) => {
  const m: any = JSON.parse(JSON.stringify(canonicalMatch()));
  m.red.units[0].shikigamiId = 289; m.red.units[0].name = "兔丸";
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  const me = a.battle.teams[0].members[0];
  return { battle: a.battle, me, sk: me.skills.find((s: any) => s.name === "守护之心") };
};
{
  const b = await mk(20261001);
  const allies: any[] = b.battle.teams[0].members;
  const foes: any[] = b.battle.enemiesOf(0);
  for (const u of allies) { u.addStatus(controlDefByTipName("冰冻")!, b.me.id, 1, 3); u.addStatus(controlDefByTipName("眩晕")!, b.me.id, 1, 3); }
  for (const u of foes) u.addStatus(controlDefByTipName("冰冻")!, b.me.id, 1, 3);
  const frozen = (list: any[]) => list.filter((u) => u.statuses.some((s: any) => String(s.def.id) === "freeze")).length;
  const stunned = (list: any[]) => list.filter((u) => u.statuses.some((s: any) => String(s.def.id) === "stun")).length;
  console.log("  施放前：友方冻 " + frozen(allies) + "/晕 " + stunned(allies) + "｜敌方冻 " + frozen(foes));
  b.battle.teams[0].orbs.gain(8);
  await b.sk.execute(b.battle, b.me, allies[0]);
  await b.battle.drainEvents();
  console.log("  施放后：友方冻 " + frozen(allies) + "/晕 " + stunned(allies) + "｜敌方冻 " + frozen(foes));
  ok("★★★ 被选中的那个友方**两种控制都被清掉**（按名 + 两种动作各走各的）", frozen(allies) === 4 && stunned(allies) === 4, JSON.stringify([frozen(allies), stunned(allies)]));
  ok("★★★ 敌方一个都没动（方向 = ALLY）", frozen(foes) === 5, String(frozen(foes)));
  const removed = b.battle.trace.filter((e: any) => e.t === "STATUS_REMOVE");
  ok("★★★ 留痕两半：by=DISPEL 一条（冰冻或沉睡）+ by=REMOVE 一条（变形/眩晕/深度冰冻）",
    removed.some((e: any) => e.by === "DISPEL") && removed.some((e: any) => e.by === "REMOVE"), JSON.stringify(removed.map((e: any) => [e.by, e.status])));
  ok("★★ 留痕里 side=ALLY", removed.every((e: any) => e.side === "ALLY"), JSON.stringify(removed.map((e: any) => e.side)));
}

sec("[3] 反向：**不在名单里的状态不许被碰**");
{
  const b = await mk(20261001);
  const allies: any[] = b.battle.teams[0].members;
  for (const u of allies) {
    u.addStatus(controlDefByTipName("冰冻")!, b.me.id, 1, 3);
    u.addStatus({ id: "probeMark", name: "普通印记", category: "DEBUFF_STATE", dispellable: true, removable: true, preventsAction: false, preventsSkill: false, forcesBasicAttack: false, suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "SOURCE_TURN", desc: "探针" } as any, b.me.id, 1, 3);
  }
  b.battle.teams[0].orbs.gain(8);
  await b.sk.execute(b.battle, b.me, allies[0]);
  await b.battle.drainEvents();
  const marks = allies.reduce((n, u) => n + u.statuses.filter((s: any) => String(s.def.id) === "probeMark").length, 0);
  const frozen = allies.reduce((n, u) => n + u.statuses.filter((s: any) => String(s.def.id) === "freeze").length, 0);
  ok("★★★ 普通减益 probeMark **一个都没掉**（按名驱散只碰名单里的五种）", marks === 5, String(marks));
  ok("★★★ 而冰冻掉了 1 个（被选中的那个友方）", frozen === 4, String(frozen));
}

sec("[4] 反向：两个指纹逐位不变");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.run();
  ok("★★★ 默认档 2d7c7507e18db61f", stateHash(captureState(a.battle)) === "2d7c7507e18db61f", stateHash(captureState(a.battle)));
  const c: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "PARSED_CANDIDATES_ONLY" });
  await c.battle.runStartup(); await c.battle.run();
  ok("★★★ 被动档 7bc24506bdcd349e", stateHash(captureState(c.battle)) === "7bc24506bdcd349e", stateHash(captureState(c.battle)));
}

console.log("\n=== 按名驱散: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;