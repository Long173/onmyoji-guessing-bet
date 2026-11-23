// tests/g111-subject-qualified.ts — ★★★ 第 189 轮：**触发句主语的第二批**
import fs from "node:fs";
import path from "node:path";
import { EV } from "../kernel/types.ts";
import { subjectSpecOf, subjectOf } from "../kernel/triggers.ts";
import { toStatusDef } from "../compile/buff-compiler.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

sec("[1] 判据纯函数双向");
{
  const cases: Array<[string, string, boolean, string | null, string | null]> = [
    ["带有[buff_2163_1]的敌方阵亡时，成为受控制的傀儡一同作战", "ENEMY", false, "2163_1", null],
    ["生命比例低于40%的非自身的友方受到伤害时", "SELF", false, null, "LIMITER_CONDITION_UNMODELED"],
    ["带有棋子的敌方在其回合结束时", "SELF", false, null, "LIMITER_CONDITION_UNMODELED"],
    ["被记录的友方受到伤害时", "SELF", false, null, "LIMITER_CONDITION_UNMODELED"],
    ["对带有[buff_2163_1]的敌方造成伤害时", "SELF", false, null, null],
    ["使非召唤物的友方全体获得[buff_1_1]", "SELF", false, null, null],
    ["为生命比例最低的友方治疗等同该次伤害15%的生命", "SELF", false, null, null],
    ["阵亡时，对伤害来源附加[buff_2073_1]", "SELF", false, null, null],
    ["阵亡时，若拥有4层[buff_2072_1]，则会立即复活并恢复生命上限20%的生命", "SELF", false, null, null],
    ["其他友方式神的回合开始时，有10%概率使其获得[buff_2665_1]直到回合结束", "ALLY", true, null, null],
    ["其他友方造成伤害时，储存等同于伤害20%的彩虹能量", "ALLY", true, null, null],
    ["除自身外的友方式神受到致命伤害时", "ALLY", true, null, null],
    ["非召唤物的敌方目标回合结束时，言灵增加1层墨灵", "ENEMY", false, null, null],
    ["全体目标回合结束时，言和获得1层[buff_6062_1]", "ANY", false, null, null],
    ["受到攻击时，有40%概率为攻击者附加[buff_2322_1]", "SELF", false, null, null],
    ["", "SELF", false, null, null],
  ];
  for (const [clause, want, excl, status, rej] of cases) {
    const s = subjectSpecOf(clause);
    ok("★ " + (clause ? clause.slice(0, 24) + "…" : "(空串)") + " ⇒ " + want + (excl ? " 排除自己" : "") + (status ? " 需" + status : "") + (rej ? " 拒:" + rej : ""),
      s.subject === want && s.excludesSelf === excl && s.requiresStatus === status && s.rejected === rej,
      JSON.stringify(s));
  }
  ok("★★★ 顺序：锚在句首的三条先判（非召唤物的敌方不会被限定语那条抢走）",
    subjectOf("非召唤物的敌方目标回合结束时") === "ENEMY" && subjectSpecOf("非召唤物的敌方目标回合结束时").requiresStatus === null);
  ok("★★★ subjectOf 是 subjectSpecOf 的薄壳（同一条判据只有一个实现）",
    cases.every(([c, want]) => subjectOf(c) === want));
}

import { tipsTable, resolveTips } from "../compile/tips.ts";

sec("[2] ★★★ 全库落点：收了多少 / 挡了多少（数字由运行产生）");
{
  const tips = tipsTable();
  let total = 0, nonSelf = 0, rejected = 0, excl = 0, withStatus = 0;
  const rejList: string[] = [];
  for (const c of KB) for (const sk of (c.skills ?? [])) {
    const raw = [String(sk.description ?? ""), ...((sk.tips ?? []) as any[]).map((t: any) => String(t?.text ?? t))].join(" ");
    const resolved = resolveTips(raw, tips).text.replace(/<br\s*\/?>/gi, "。");
    for (const s of String(resolved).split(/[。\n]/)) for (const cl of s.split(/[，；,;]/).map((x: string) => x.trim()).filter(Boolean)) {
      total++;
      const spec = subjectSpecOf(cl);
      if (spec.rejected) { rejected++; rejList.push(c.name + "/" + sk.id); }
      if (spec.subject !== "SELF") { nonSelf++; if (spec.excludesSelf) excl++; if (spec.requiresStatus) withStatus++; }
    }
  }
  console.log("  子句 " + total + "｜主语非自己 " + nonSelf + "（排除自己 " + excl + "｜带状态条件 " + withStatus + "）｜认出来但没收 " + rejected);
  ok("★★★ 全库 3886 条子句：主语非自己 124｜排除自己 11｜带状态条件 5｜认出来但没收 11",
    total === 3886 && nonSelf === 124 && excl === 11 && withStatus === 5 && rejected === 11,
    JSON.stringify({ total, nonSelf, excl, withStatus, rejected }));
  ok("★★★ 挡下的 11 条逐一在案（判据认出来了，但限定语里的条件表达不了 ⇒ 保持 SELF，fail-closed）",
    rejList.sort().join() === ["鬼使白/210_02", "蝴蝶精/241_02", "阎魔/255_02", "匣中少女/287_03", "弈/303_02", "卖药郎/305_02", "虫师/306_03", "久次良/332_02", "黑崎一护/337_02", "神乐&定春/500_02", "神乐&定春/500_02"].sort().join(),
    JSON.stringify(rejList));
  ok("★★★ 而「限定语 + 可执行条件」的那一条**收下了**（巫蛊师：带有[buff_2163_1]的敌方阵亡时）",
    subjectSpecOf("带有[buff_2163_1]的敌方阵亡时，成为受控制的傀儡一同作战").requiresStatus === "2163_1");
}

sec("[3] ★★★ 装机面（全库名册）：82 条装上的触发句里 5 条主语不是自己");
{
  const units: any[] = [];
  for (const c of KB) for (const sk of (c.skills ?? [])) {
    if (Number(sk.cost ?? 0) >= 0) continue;
    let a: any;
    try { const m: any = canonicalMatch(); m.red.units[0] = { ...m.red.units[0], shikigamiId: c.id, name: c.name }; a = assembleMatch(createKit(bundle), m, { seed: 189, passives: "PARSED_CANDIDATES_ONLY" }); await a.battle.runStartup(); }
    catch { continue; }
    const e = a.battle.teams[0].members[0];
    for (const x of (a.battle.passiveReport?.installed ?? []).filter((y: any) => y.entityId === e.id && y.skill === sk.name)) {
      units.push({ who: c.name, key: c.id + "/" + sk.id, family: x.family, event: x.event, subject: x.subject, range: x.range, excludesSelf: !!x.excludesSelf, requiresStatus: x.requiresStatus ?? null });
    }
  }
  const nonSelf = units.filter((u) => u.subject && u.subject !== "SELF");
  console.log("  装机单位 " + units.length + "｜主语非自己 " + nonSelf.length);
  for (const u of nonSelf) console.log("    [" + u.subject + " range=" + u.range + (u.excludesSelf ? " 排除自己" : "") + (u.requiresStatus ? " 需" + u.requiresStatus : "") + "] " + u.who + " " + u.key + " " + u.family + "→" + u.event);
  ok("★★★ 装机单位 82 条、其中主语非自己 5 条", units.length === 82 && nonSelf.length === 5, JSON.stringify({ units: units.length, nonSelf: nonSelf.length }));
  ok("★★★ 主语非自己的那 5 条逐一在案（名称 + 主语 + range）",
    nonSelf.map((u) => u.who + ":" + u.subject + ":" + u.range).sort().join()
      === ["巫蛊师:ENEMY:ENEMY", "青行灯:ALLY:TEAM", "虫师:ENEMY:ALL", "言灵:ENEMY:ENEMY", "言和:ANY:ALL"].sort().join(),
    JSON.stringify(nonSelf.map((u) => u.who + ":" + u.subject + ":" + u.range)));
  ok("★★★ 本轮新接上的三条：青行灯（ALLY + 排除自己）· 巫蛊师（ENEMY + 需 2163_1）· 虫师（目标侧 ENEMY + 需 3062_1）",
    nonSelf.some((u) => u.who === "青行灯" && u.excludesSelf === true)
      && nonSelf.some((u) => u.who === "巫蛊师" && u.requiresStatus === "2163_1")
      && nonSelf.some((u) => u.who === "虫师" && u.requiresStatus === "3062_1" && u.range === "ALL"),
    JSON.stringify(nonSelf));
  ok("★★★ 而**主语是自己**的那些一条都没被误伤（77 条仍是 subject=SELF / range=SELF 或它们的族本来就该 ALL）",
    units.filter((u) => u.subject === "SELF" || !u.subject).length === 77);
}

async function mk(name: string, seed = 189) {
  const c = KB.find((x: any) => x.name === name)!;
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: c.id, name };
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives: "PARSED_CANDIDATES_ONLY" });
  await a.battle.runStartup();
  return a;
}
const stacksOf = (e: any, id: string) => { const st = (e.statuses ?? []).find((s: any) => String(s.def?.id ?? "") === id); return st ? Number(st.stacks ?? 0) : 0; };
const traceOf = (b: any, from: number) => (b.trace ?? []).slice(from).map((x: any) => x.t);

sec("[4] ★★★ 行为（青行灯「明灯」）：其他友方式神的回合开始时");
{
  const a = await mk("青行灯");
  const b = a.battle;
  const e = b.teams[0].members[0];
  const mate = b.teams[0].members.find((x: any) => x.id !== e.id)!;
  const foe = b.enemiesOf(e.teamId)[0];
  const probe = async (who: any, n: number) => { let hit = 0; for (let i = 0; i < n; i++) { const b0 = stacksOf(e, "2665_1"); await b.bus.dispatch(EV.TURN_START, { actor: who, type: "NORMAL" }, who.id, who.teamId, (id: number) => b.teamOf(id)); if (stacksOf(e, "2665_1") > b0) hit++; } return hit; };
  const viaMate = await probe(mate, 400);
  const viaSelf = await probe(e, 400);
  const viaFoe = await probe(foe, 400);
  console.log("  400 次里命中：友方回合开始 " + viaMate + "｜自己 " + viaSelf + "｜敌方 " + viaFoe);
  ok("★★★ **友方**回合开始 ⇒ 真的触发（400 次里至少 1 次；此前 range=SELF，一次都不会触发）", viaMate > 0, String(viaMate));
  ok("★★★ **自己**回合开始 ⇒ 一次都不触发（「其他友方」的排除标记真的在过滤）", viaSelf === 0, String(viaSelf));
  ok("★★★ **敌方**回合开始 ⇒ 一次都不触发（range=TEAM 真的把范围收在同一队伍里）", viaFoe === 0, String(viaFoe));
}

sec("[5] ★★★ 行为（巫蛊师「迷魂蛊」）：带有 buff_2163_1 的敌方阵亡时");
{
  const a = await mk("巫蛊师");
  const b = a.battle;
  const e = b.teams[0].members[0];
  const foes = b.enemiesOf(e.teamId);
  const mate = b.teams[0].members.find((x: any) => x.id !== e.id)!;
  const cb = createKit(bundle).buffs.get("2163_1")!;
  const def = toStatusDef(cb);
  const kill = async (victim: any, withStatus: boolean) => {
    if (withStatus) victim.addStatus(def, victim, 1);
    const n0 = (b.trace ?? []).length;
    victim.hp = 0; victim.dead = true;
    await b.bus.dispatch(EV.DEATH, { battle: b, target: victim, killerId: e.id }, victim.id, victim.teamId, (id: number) => b.teamOf(id));
    return traceOf(b, n0);
  };
  const foe1 = foes[0];
  const withIt = await kill(foe1, true);
  const foe2 = foes[1];
  const without = foe2 ? await kill(foe2, false) : [];
  const self = await kill(e, true);
  const ally = await kill(mate, true);
  console.log("  敌方(带状态)阵亡 → " + JSON.stringify(withIt));
  console.log("  敌方(不带状态)阵亡 → " + JSON.stringify(without) + "｜自己 → " + JSON.stringify(self) + "｜友方 → " + JSON.stringify(ally));
  ok("★★★ **敌方且带着这个状态**阵亡 ⇒ 触发（SKILL_CAST）", withIt.includes("SKILL_CAST"), JSON.stringify(withIt));
  ok("★★★ 敌方**没带**这个状态 ⇒ 不触发（限定语的状态条件真的在筛）", without.length === 0, JSON.stringify(without));
  ok("★★★ **自己**阵亡 ⇒ 不触发（主语是敌方，不是自己）", self.length === 0, JSON.stringify(self));
  ok("★★★ **友方**阵亡 ⇒ 不触发", ally.length === 0, JSON.stringify(ally));
}

sec("[6] ★★★ 行为（虫师「虫之痕」）：目标侧 —— 带有 buff_3062_1 的敌方受到伤害时");
{
  const a = await mk("虫师");
  const b = a.battle;
  const e = b.teams[0].members[0];
  const foes = b.enemiesOf(e.teamId);
  const mate = b.teams[0].members.find((x: any) => x.id !== e.id)!;
  const def = toStatusDef(createKit(bundle).buffs.get("3062_1")!);
  const hit = async (victim: any, withStatus: boolean) => {
    if (withStatus) victim.addStatus(def, victim, 1);
    const n0 = (b.trace ?? []).length;
    await b.damage(e, victim, 120, undefined, 1, null);
    return traceOf(b, n0);
  };
  const foe1 = foes[0];
  const enemyWith = await hit(foe1, true);
  const foe2 = foes[1];
  const enemyWithout = foe2 ? await hit(foe2, false) : [];
  const self = await hit(e, false);
  mate.addStatus(def, mate, 1);
  const ally = await hit(mate, false);
  console.log("  敌方(带状态)被打 → " + JSON.stringify(enemyWith));
  console.log("  敌方(不带状态) → " + JSON.stringify(enemyWithout) + "｜自己 → " + JSON.stringify(self) + "｜友方(带状态) → " + JSON.stringify(ally));
  ok("★★★ 敌方且带着这个状态被打 ⇒ 触发治疗（HEAL）", enemyWith.includes("HEAL"), JSON.stringify(enemyWith));
  ok("★★★ 敌方没带这个状态 ⇒ 只掉血、不治疗", enemyWithout.length > 0 && !enemyWithout.includes("HEAL"), JSON.stringify(enemyWithout));
  ok("★★★ **自己**被打 ⇒ 不治疗（此前写死 t === e.id ⇒ **只有**自己挨打才治疗，方向正好反了）",
    self.length > 0 && !self.includes("HEAL"), JSON.stringify(self));
  ok("★★★ 友方（即使带着同一个状态）被打 ⇒ 不治疗（目标侧的主语判定是**敌方**）",
    ally.length > 0 && !ally.includes("HEAL"), JSON.stringify(ally));
}

sec("[7] ★★★ 回归：第 179 轮那三条锚定判据没被放宽（放宽锚点撞过的那堵墙）");
{
  ok("★★★ 九命猫的复活句仍是 SELF（「并对随机敌方目标施放」里的敌方**不是**主语）",
    subjectOf("阵亡时，若拥有4层[buff_2072_1]，则会立即复活并恢复生命上限20%的生命") === "SELF"
      && subjectOf("阵亡时，对伤害来源附加[buff_2073_1]") === "SELF");
  ok("★★★ 「使/为/对/优先」开头的宾语短语一律不收（实测词头表的边界）",
    ["使非召唤物的友方全体获得护盾", "为生命比例最低的友方治疗10%生命上限的生命", "对生命比例高于40%的敌方造成攻击100%伤害", "优先攻击没攻击过的敌方目标"].every((c) => subjectOf(c) === "SELF"));
  ok("★★ 而第 179 轮接上的三条仍然对（敌方 / 任意 / 友方各一）",
    subjectOf("非召唤物的敌方目标回合结束时，言灵增加1层墨灵") === "ENEMY"
      && subjectOf("全体目标回合结束时，言和获得1层[buff_6062_1]") === "ANY"
      && subjectOf("任一友方受到伤害时，若该次伤害超过其生命上限30%") === "ALLY");
}

sec("[8] ★★ 反向：默认档（被动 OFF）一条都不装，两个指纹逐位不变");
{
  // ★★★ 第 190 轮：被动档常量 6d7fb675c3d14eaf → **7bc24506bdcd349e**（runStartup 幂等：此前 `runStartup(); run()` 跑了两遍开局）
  for (const [mode, want] of [["NOT_EXECUTED", "2d7c7507e18db61f"], ["PARSED_CANDIDATES_ONLY", "7bc24506bdcd349e"]] as const) {
    const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: mode });
    await a.battle.runStartup();
    await a.battle.run();
    const h = stateHash(captureState(a.battle));
    ok("★★★ " + mode + " 指纹 " + want + " 逐位不变", h === want, h);
  }
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  ok("★★ 默认档 installed 为空", (a.battle.passiveReport?.installed ?? []).length === 0);
}

sec("[9] ★★★ 顺带收掉的第二处算错：**同一个概率不许掷两次**（p 的平方）");
{
  /**
   * 由来：同一条「有N%概率使其获得[buff_x]」被两套机制各读一次 ——
   *   触发侧（judgeClause 的 cond，第 75 轮）与效果侧（effectProbs，第 15 轮）。
   *   两次都掷 ⇒ 实际概率是 p 的平方。实测 8 条装上的触发句命中这个形状。
   * 判据：effectProbs 里有一条同值、且证据子句落在本条触发句里 ⇒ 触发侧不再掷。
   * ★ 判据的干净观测量是**处理器执行了几次**（SKILL_CAST）：修好之后 400 次全执行，
   *   而修之前只有 p 的那一份（青行灯 ~40/400）—— 比「命中几次」更直接，不受层数上限影响。
   */
  const a = await mk("青行灯");
  const b = a.battle;
  const e = b.teams[0].members[0];
  const mate = b.teams[0].members.find((x: any) => x.id !== e.id)!;
  const n0 = (b.trace ?? []).length;
  let hit = 0;
  for (let i = 0; i < 400; i++) { const b0 = stacksOf(e, "2665_1"); await b.bus.dispatch(EV.TURN_START, { actor: mate, type: "NORMAL" }, mate.id, mate.teamId, (id: number) => b.teamOf(id)); if (stacksOf(e, "2665_1") > b0) hit++; }
  const casts = (b.trace ?? []).slice(n0).filter((x: any) => x.t === "SKILL_CAST" && x.skill === "明灯").length;
  console.log("  青行灯：400 次友方回合开始 → 处理器执行 " + casts + " 次｜状态命中 " + hit + " 次（原文 p=0.1）");
  ok("★★★ 触发侧**不再**掷那个概率（400 次全部进入处理器；两次都掷的话只有 ~40 次）", casts === 400, String(casts));
  ok("★★★ 而效果侧按 p 掷（400 次命中率落在 10% 附近；p 的平方只有 ~4 次）", hit >= 20 && hit <= 80, String(hit));
  const a2 = await mk("嘴平伊之助");
  const e2 = a2.battle.teams[0].members[0];
  let hit2 = 0;
  for (let i = 0; i < 400; i++) { e2.statuses.length = 0; await a2.battle.bus.dispatch(EV.TURN_START, { actor: e2, type: "NORMAL" }, e2.id, e2.teamId, (id: number) => a2.battle.teamOf(id)); if (stacksOf(e2, "3872_1") > 0) hit2++; }
  console.log("  嘴平伊之助：400 次回合开始 → 状态命中 " + hit2 + " 次（原文 p=0.8；p 的平方 ~256）");
  ok("★★★ 80% 的那一条也回到 p（400 次命中 ≥ 280；p 的平方只有 ~256）", hit2 >= 280, String(hit2));
}


console.log("\n=== 触发句主语的第二批（限定语 + 友方）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
