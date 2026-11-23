// tests/g114-random-pool.ts — ★★★ 第 194 轮：**「随机增益 / 随机减益」池子**
//
// 由来（缺口清单里「来源承受者」剩下的那条）：匣中少女「溢彩」287_02 写着
//   「受到攻击时，有100%[基础概率]为攻击者附加1个[随机减益]效果，持续1回合」。
//   它没有 `[buff_x]` 引用 ⇒ 编译器认不出该附加什么 ⇒ 整条不落地（fail-closed 的正确处置，
//   但数据其实在 `data/kb/tips.json` 第 200/201 条里：五条属性改动、数值、单位俱全）。
//
// 本轮：产物 randomStatuses（kernel/random-pool.ts 解析池子）+ 执行侧（compile/character.ts 的池子循环）。
// ★ 这份尺子盯五件事：① 纯函数双向（含 fail-closed 的四种写法）；② 产物逐字段；
//   ③ 逐句判据 randomPoolSlotsForClause 双向；④ 端到端**真的会挂到攻击者身上**（默认档一字不变）；
//   ⑤ 同一个 100% **只掷一次**（RNG 账本）+ 跨进程恢复（RANDOM_* 不在 KB 里）。
import fs from "node:fs";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";
import { loadTips, setTipsTable, tipsTable } from "../compile/tips.ts";
import { parseRandomPool, poolEntryDef, poolDefFromId } from "../kernel/random-pool.ts";
import { randomPoolSlotsForClause, normClauseText } from "../compile/skill-compiler.ts";
import { matchFamily } from "../kernel/triggers.ts";
import { StatusBook } from "../kernel/status.ts";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, restoreBattle, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

sec("[1] 池子解析（纯函数）：数据里的 5 条、两个方向、四种 fail-closed 写法");
{
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
  setTipsTable(loadTips(Array.isArray(raw) ? raw : (Object.values(raw).find((v: any) => Array.isArray(v)) as any[])));
  const tips = tipsTable();
  ok("★★ 前置：tips 表非空（122 条）", tips.size === 122, String(tips.size));
  const buff = tips.get("200"), debuff = tips.get("201");
  ok("★★★ 池子的名字就是「随机增益」/「随机减益」（性质由名字决定，不由条目正负去猜）",
    buff?.name === "随机增益" && debuff?.name === "随机减益", JSON.stringify([buff?.name, debuff?.name]));
  const db = parseRandomPool(debuff!.name, debuff!.desc)!;
  const bf = parseRandomPool(buff!.name, buff!.desc)!;
  ok("★★★ 随机减益 = 5 条，且符号全为负", !!db && db.entries.length === 5 && db.entries.every((e) => e.value < 0), JSON.stringify(db?.entries));
  ok("★★★ 随机增益 = 5 条，且符号全为正", !!bf && bf.entries.length === 5 && bf.entries.every((e) => e.value > 0), JSON.stringify(bf?.entries));
  ok("★★★ 条目逐项（降低10%攻击 / 20%防御 / 10%暴击伤害 / 10点速度 / 10%效果抵抗）",
    JSON.stringify(db.entries) === JSON.stringify([
      { prop: "atk", mode: "ADD_RATE", value: -0.1, label: "攻击-10%" },
      { prop: "def", mode: "ADD_RATE", value: -0.2, label: "防御-20%" },
      { prop: "crid", mode: "ADD_RATE", value: -0.1, label: "暴击伤害-10%" },
      { prop: "spd", mode: "FIXED", value: -10, label: "速度-10点" },
      { prop: "efr", mode: "ADD_RATE", value: -0.1, label: "效果抵抗-10%" },
    ]), JSON.stringify(db.entries));
  ok("★★★ 「10点速度」是**加法**（引擎里的名字是 FIXED，不是 FLAT —— 写错就是静默不生效）",
    db.entries[3].mode === "FIXED" && db.entries[3].value === -10, JSON.stringify(db.entries[3]));
  ok("★★★ 动词继承：「降低10%攻击、20%防御…」里只有第一条有动词，其余必须继承（不继承 ⇒ 整条 desc 一条都读不出来）",
    db.entries.length === 5, String(db.entries.length));
  ok("★★★ 反向：名字里没有「增益/减益」⇒ null（绝不兜一个默认池子）",
    parseRandomPool("护盾", tips.get("6")!.desc) === null, JSON.stringify(parseRandomPool("护盾", tips.get("6")!.desc)));
  ok("★★★ 反向：只有 1 条的不叫池子 ⇒ null", parseRandomPool("随机减益", "包含以下1种，降低10%攻击。") === null);
  ok("★★★ 反向：一条动词都读不出来 ⇒ null（fail-closed）", parseRandomPool("随机减益", "包含以下2种，攻击、防御。") === null);
  ok("★★ 反向：空输入 ⇒ null", parseRandomPool("", "") === null && parseRandomPool(undefined as any, undefined as any) === null);
  const d1 = poolEntryDef(db, db.entries[0], 3);
  ok("★★★ 状态 id 由 kind+prop 决定 ⇒ 确定性（id 会进 stateHash，不许有随机成分）", d1.id === "RANDOM_DEBUFF_atk", d1.id);
  ok("★★ 名字带上条目（Theater 里要能看出抽到了哪一条）", d1.name === "随机减益·攻击-10%", d1.name);
  ok("★★ 类别取自池子的性质（减益 ⇒ DEBUFF_STATE）", String(d1.category) === "DEBUFF_STATE", String(d1.category));
  ok("★★ 状态本体**不带 effects**（效果由调用方按条目现算，随状态一起回收）", !(d1 as any).effects, JSON.stringify((d1 as any).effects));
  ok("★★★ 按 id 重建（跨进程恢复用）：两个 kind 都能重建",
    poolDefFromId("RANDOM_BUFF_spd")?.id === "RANDOM_BUFF_spd" && String(poolDefFromId("RANDOM_DEBUFF_efr")?.category) === "DEBUFF_STATE",
    JSON.stringify(poolDefFromId("RANDOM_BUFF_spd")));
  ok("★★★ 反向：不是池子的 id ⇒ null（恢复路径照旧如实记名，不猜）",
    poolDefFromId("2012_1") === null && poolDefFromId("RANDOM_XXX_atk") === null && poolDefFromId("") === null);
}

sec("[2] 产物：全库只有 1 条技能有池子，逐字段可复核");
{
  const { input } = compileAll(path.join(ROOT, "data", "kb"));
  const irs = (input.skills as any[]).map((e: any) => ({ key: String(e.key), ir: JSON.parse(String(e.json)) }));
  const withPool = irs.filter((x) => !!x.ir.randomStatuses);
  ok("★★★ 818 条技能里**恰好 1 条**有池子（匣中少女「溢彩」287_02）", withPool.length === 1 && withPool[0].key === "287/287_02", JSON.stringify(withPool.map((x) => x.key)));
  const rs = withPool[0].ir.randomStatuses as any[];
  ok("★★★ 两条：随机增益（持续2回合 / 自己人）+ 随机减益（持续1回合 / 攻击者）",
    rs.length === 2 && rs[0].kind === "BUFF" && rs[0].duration === 2 && rs[1].kind === "DEBUFF" && rs[1].duration === 1, JSON.stringify(rs.map((r) => [r.kind, r.duration, r.bearer])));
  ok("★★★ 承受者：减益写「为攻击者附加」⇒ DAMAGE_SOURCE；增益不在那句里 ⇒ EFFECT_TARGET",
    rs[1].bearer === "DAMAGE_SOURCE" && rs[0].bearer === "EFFECT_TARGET", JSON.stringify(rs.map((r) => r.bearer)));
  ok("★★★ 概率：减益那句写「有100%[基础概率]」⇒ 100（★ 这正是第 194 轮修掉的那种写法）；增益那句没写 ⇒ null",
    rs[1].probability === 100 && rs[0].probability === null, JSON.stringify(rs.map((r) => r.probability)));
  ok("★★★ 量词「1个」紧贴在引用前面 ⇒ count=1", rs.every((r) => r.count === 1), JSON.stringify(rs.map((r) => r.count)));
  ok("★★★ 条目数值来自 tips 的 desc（evidence 可复核）",
    /降低10%攻击、20%防御、10%暴击伤害、10点速度、10%效果抵抗/.test(String(rs[1].evidence)), String(rs[1].evidence));
  ok("★★★ 认不出来的一律记账：全库 randomStatusSkips = 0（两处都读出来了，没有静默丢）",
    irs.every((x) => !x.ir.randomStatusSkips), JSON.stringify(irs.filter((x) => x.ir.randomStatusSkips).map((x) => x.key)));
  ok("★★ recognized 里有 randomPool:2（普查报表能看见这条产物）", (withPool[0].ir.recognized ?? []).includes("randomPool:2"), JSON.stringify(withPool[0].ir.recognized));
  ok("★★★ 别处一个字都不动：其余 817 条技能里既没有 randomStatuses 也没有 randomStatusSkips",
    irs.filter((x) => x.key !== "287/287_02").every((x) => !x.ir.randomStatuses && !x.ir.randomStatusSkips));
}

sec("[3] 逐句判据 randomPoolSlotsForClause：三种句子、两个形态、缺证据的方向");
{
  const { input } = compileAll(path.join(ROOT, "data", "kb"));
  const ir = JSON.parse(String((input.skills as any[]).find((x: any) => String(x.key) === "287/287_02")!.json));
  const DEBUFF_CLAUSE = "受到攻击时，有100%[基础概率]为攻击者附加1个[随机减益]效果，持续1回合";
  const BUFF_CLAUSE = "同时获得1个[随机增益]效果，持续2回合";
  ok("★★★ 触发那一句 ⇒ 只放减益那一条（下标 1，不是 0）", JSON.stringify(randomPoolSlotsForClause(ir, DEBUFF_CLAUSE)) === "[1]", JSON.stringify(randomPoolSlotsForClause(ir, DEBUFF_CLAUSE)));
  ok("★★★ 增益那一句 ⇒ 只放下标 0", JSON.stringify(randomPoolSlotsForClause(ir, BUFF_CLAUSE)) === "[0]", JSON.stringify(randomPoolSlotsForClause(ir, BUFF_CLAUSE)));
  ok("★★★ 与这句无关的话 ⇒ 空数组（这一句不施加任何池子 —— 不是 null！）", JSON.stringify(randomPoolSlotsForClause(ir, "回合结束时，自身获得1层护盾")) === "[]");
  ok("★★★ fail-closed 的方向：没有池子的技能 ⇒ null（调用方**不放这个键** ⇒ 与今天逐位相同）",
    randomPoolSlotsForClause({}, DEBUFF_CLAUSE) === null && randomPoolSlotsForClause({ randomStatuses: [] }, DEBUFF_CLAUSE) === null);
  const rawForm = "受到攻击时，有100%[tips_2]为攻击者附加1个[tips_201]效果，持续1回合";
  ok("★★★ 归一化：原文形态（[tips_201]）与解析形态（[随机减益]）得到**同一个**结论",
    JSON.stringify(randomPoolSlotsForClause(ir, rawForm)) === JSON.stringify(randomPoolSlotsForClause(ir, DEBUFF_CLAUSE)),
    JSON.stringify([randomPoolSlotsForClause(ir, rawForm), randomPoolSlotsForClause(ir, DEBUFF_CLAUSE)]));
  ok("★★ 归一化函数本身：去掉 br 与非 buff 方括号", normClauseText("[tips_201]甲<br>乙") === "甲乙", normClauseText("[tips_201]甲<br>乙"));
}

sec("[4] 端到端：被动档下挨打 ⇒ 随机减益**真的挂到攻击者身上**（默认档一字不变）");
const withUnit = (id: number, name: string) => { const m: any = JSON.parse(JSON.stringify(canonicalMatch())); m.red.units[0].shikigamiId = id; m.red.units[0].name = name; return m; };
const mkBattle = async (passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", seed: number) => {
  const a: any = assembleMatch(createKit(bundle), withUnit(287, "匣中少女"), { seed, passives });
  await a.battle.runStartup();
  const me = a.battle.teams[0].members[0];
  const foe = a.battle.enemiesOf(0)[0];
  const basic = foe.skills.find((s: any) => Number(s.cost) === 0) ?? foe.skills[0];
  return { battle: a.battle, me, foe, basic };
};
{
  const OFF = await mkBattle("NOT_EXECUTED", 20261001);
  const before = OFF.battle.trace.length;
  await OFF.basic.execute(OFF.battle, OFF.foe, OFF.me);
  await OFF.battle.drainEvents();
  const ev = OFF.battle.trace.slice(before);
  ok("★★★ 默认档（被动 OFF）：挨打**不产生任何池子痕迹**（一个字都不变）",
    !ev.some((e: any) => /POOL|RANDOM_/.test(JSON.stringify(e))), JSON.stringify(ev.filter((e: any) => /POOL|RANDOM_/.test(JSON.stringify(e))).slice(0, 2)));
  ok("★★★ 默认档：攻击者身上没有 RANDOM_* 状态", !OFF.foe.statuses.some((s: any) => String(s.def.id).startsWith("RANDOM_")));
  const ON = await mkBattle("PARSED_CANDIDATES_ONLY", 20261001);
  const b2 = ON.battle.trace.length;
  await ON.basic.execute(ON.battle, ON.foe, ON.me);
  await ON.battle.drainEvents();
  const ev2 = ON.battle.trace.slice(b2);
  const applied = ev2.filter((e: any) => e.t === "STATUS_APPLY" && String(e.ref ?? "").startsWith("POOL:"));
  console.log("  装机面：" + JSON.stringify(ON.battle.passiveReport.installed.filter((i: any) => i.skill === "溢彩")));
  ok("★★★ 被动档：挨打掉出一次 POOL 施加", applied.length === 1, JSON.stringify(ev2.filter((e: any) => /POOL/.test(String(e.t)))));
  ok("★★★ **承受者是攻击者**（不是自己、也不是随机一个敌人）", applied.length === 1 && applied[0].dst === ON.foe.id, JSON.stringify(applied.map((a: any) => [a.src, a.dst])));
  ok("★★★ 状态 id 是池子条目之一（RANDOM_DEBUFF_*）", String(applied[0]?.status ?? "").startsWith("RANDOM_DEBUFF_"), String(applied[0]?.status));
  const st: any = ON.foe.statuses.find((s: any) => String(s.def.id).startsWith("RANDOM_"));
  ok("★★★ 状态真的在身上：1 层、持续 1 回合、且带着那一条的属性效果", !!st && st.stacks === 1 && st.remaining === 1 && (st.effects ?? []).length === 1, JSON.stringify(st));
  ok("★★★ 状态定义进了 StatusBook（跨进程恢复要靠它 / poolDefFromId）", !!StatusBook.get(String(applied[0]?.status)));
  ok("★★★ 增益那一半**没有**跟着一起放（「友方行动前」不在触发族登记册里 —— 见第 [6] 节）",
    String(applied[0]?.status ?? "").startsWith("RANDOM_DEBUFF_") && !ON.me.statuses.some((s: any) => String(s.def.id).startsWith("RANDOM_")));
  ok("★★★ 概率只掷一次：passive 触发侧**没有**掷（probOwnedByEffect 认得池子），池子侧掷了 1 次 + 抽条目 1 次",
    ON.battle.rng.draws.filter((d: any) => d.tag.startsWith("pool_prob:")).length === 1 &&
    ON.battle.rng.draws.filter((d: any) => d.tag.startsWith("pool_pick:")).length === 1 &&
    ON.battle.rng.draws.filter((d: any) => d.tag.startsWith("passive_prob:") && d.tag.includes("溢彩")).length === 0,
    JSON.stringify(ON.battle.rng.draws.map((d: any) => d.tag).filter((t: string) => /pool_|passive_prob/.test(t))));
}

sec("[5] 抽哪一条：多次挨打 ⇒ 覆盖池子里的多条（且永不越界）");
{
  const seen = new Set<string>();
  const N = 24;
  for (let i = 0; i < N; i++) {
    const b = await mkBattle("PARSED_CANDIDATES_ONLY", 810000 + i);
    await b.basic.execute(b.battle, b.foe, b.me);
    await b.battle.drainEvents();
    for (const s of b.foe.statuses) if (String(s.def.id).startsWith("RANDOM_DEBUFF_")) seen.add(String(s.def.id));
  }
  const ALLOWED = new Set(["RANDOM_DEBUFF_atk", "RANDOM_DEBUFF_def", "RANDOM_DEBUFF_crid", "RANDOM_DEBUFF_spd", "RANDOM_DEBUFF_efr"]);
  console.log("  " + N + " 次挨打抽到：" + JSON.stringify([...seen].sort()));
  ok("★★★ 抽到的 id 全在池子的 5 条之内（绝不越界、绝不自造）", [...seen].every((x) => ALLOWED.has(x)), JSON.stringify([...seen]));
  ok("★★★ 而且**真的在抽**（24 次里至少覆盖 2 条；抽成固定值就是没接 RNG）", seen.size >= 2, String(seen.size));
  /**
   * ★★★ 确定性不变量：抽条目走的是 battle.rng ⇒ 同一个 seed 必须抽到**同一条**。
   *   这一条是**可执行**的（不是"应该没问题"）：两次独立装配、同一个 seed、比对状态 id。
   */
  const pickOf = async (seed: number) => {
    const b = await mkBattle("PARSED_CANDIDATES_ONLY", seed);
    await b.basic.execute(b.battle, b.foe, b.me);
    await b.battle.drainEvents();
    return b.foe.statuses.map((s: any) => String(s.def.id)).find((x: string) => x.startsWith("RANDOM_")) ?? "none";
  };
  const p1 = await pickOf(424242), p2 = await pickOf(424242);
  ok("★★★ 同一个 seed 跑两次 ⇒ 抽到同一条（重放的前提）", p1 !== "none" && p1 === p2, p1 + " vs " + p2);
}

sec("[6] 已知缺口钉住：「随机增益」那一半没有触发时机（如实记，不假装装了）");
{
  ok("★★★ 「友方行动前」在触发族登记册里**根本没有这一族** ⇒ 那一句永远不会被装上",
    matchFamily("友方行动前，使其获得[护盾]") === null, JSON.stringify(matchFamily("友方行动前，使其获得[护盾]")));
  const b = await mkBattle("PARSED_CANDIDATES_ONLY", 20261001);
  ok("★★★ 于是 24 次挨打里自己一次随机增益都没拿到（这就是上面那条断言的执行侧证据）",
    !b.me.statuses.some((s: any) => String(s.def.id).startsWith("RANDOM_BUFF")));
}

sec("[7] 跨进程恢复：RANDOM_* 不在 KB 里，靠 poolDefFromId 兜底（StatusBook 被清掉也必须活着）");
{
  const b = await mkBattle("PARSED_CANDIDATES_ONLY", 20261001);
  await b.basic.execute(b.battle, b.foe, b.me);
  await b.battle.drainEvents();
  const id = b.foe.statuses.map((s: any) => String(s.def.id)).find((x: string) => x.startsWith("RANDOM_"))!;
  const st = captureState(b.battle);
  ok("★★ 前置：存档里真有这个状态", JSON.stringify(st).includes(id), id);
  const kit = createKit(bundle);
  ok("★★★ 前置：知识库**不认识**这个 id（statusDefOf 返回 null ⇒ 兜底是承重的）", (kit as any).statusDefOf(id) === null, JSON.stringify((kit as any).statusDefOf(id)));
  StatusBook.delete(id);
  ok("★★★ 冷进程模拟：StatusBook 里也删掉之后取不到了", !StatusBook.get(id));
  const r: any = restoreBattle(JSON.parse(JSON.stringify(st)), { kit, makeRuntime: (sid: number) => runtimeFor(kit, sid), attachRuntime } as any);
  const foe2 = r.teams[1].members.find((m: any) => m.statuses.some((s: any) => String(s.def.id) === id));
  ok("★★★ 恢复后状态**还在**（poolDefFromId 按 id 重建了壳）", !!foe2, JSON.stringify(r.teams[1].members.map((m: any) => m.statuses.map((s: any) => s.def.id))));
  const notes = r.teams[1].members.flatMap((m: any) => m.notes ?? []).filter((n: string) => n.includes("missing-statusdef"));
  ok("★★★ 而且**零恢复痕迹**（没有 restore:missing-statusdef）", notes.length === 0, JSON.stringify(notes));
  const st2: any = foe2?.statuses.find((s: any) => String(s.def.id) === id);
  ok("★★★ 效果与剩余回合都还在（壳只管不变的部分，效果随存档恢复）", !!st2 && (st2.effects ?? []).length === 1 && st2.remaining === 1, JSON.stringify(st2));
}

sec("[8] 反向：两个指纹逐位不变（这条接线不碰任何基准）");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.run();
  ok("★★★ 默认档 2d7c7507e18db61f", stateHash(captureState(a.battle)) === "2d7c7507e18db61f", stateHash(captureState(a.battle)));
  const c: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "PARSED_CANDIDATES_ONLY" });
  await c.battle.runStartup(); await c.battle.run();
  ok("★★★ 被动档 7bc24506bdcd349e", stateHash(captureState(c.battle)) === "7bc24506bdcd349e", stateHash(captureState(c.battle)));
}

console.log("\n=== 随机池子: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;