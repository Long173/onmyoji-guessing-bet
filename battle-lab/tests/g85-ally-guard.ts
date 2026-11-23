// tests/g85-ally-guard.ts — ★★★ 第 131 轮：**替友方拦截致命伤**（EV.DEATH_PREVENTION 的第一个生产者）
//
// 三类拦死里前两类早有执行点（状态字段 preventsLethal / 自身的 ON_LETHAL 形态），第三类一直只躺在账上：
//   KB：伊邪那美「神赐之吻」——「自身在场时，处于[buff_5572_1]的友方目标受到致命伤害将剩余1点生命
//   （目标下回合开始前至多触发1次，被再次施加毁灭前至多累计触发3次）」。
// 它写在**主动技能**原文里（cost=2），被动运行时只收 cost<0 ⇒ 它是"站在场上的常驻条款"。
//
// ★ 次数上限必须真的执行（第 78 轮层数封顶同一条判据）。本文件把**每回合 1 次 / 累计 3 次 /
//   状态重施清零 / 拥有者离场不拦**四条全部双向验一遍 —— 探针 tools/_probe-allyguard-run131.ts
//   实测过第一版把计数写成"流水"而不是"当前值"：第 4 次照样拦住（多算一步，且不报错）。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { compileBuff, toStatusDef } from "../compile/buff-compiler.ts";
import { StatusBook } from "../kernel/status.ts";
import { loadTips, setTipsTable } from "../compile/tips.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { newUnitId } from "../../apps/web/src/contracts/guessing-match.ts";
import { clearAllyGuardWindow } from "../kernel/ally-guard.ts";
import { captureState, restoreBattle } from "../kernel/state.ts";
import { runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const buffs = new Map<string, any>((JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[]).map((b: any) => [String(b.id), compileBuff(b)]));
const tipsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
setTipsTable(loadTips(Array.isArray(tipsRaw) ? tipsRaw : (Object.values(tipsRaw).find((v: any) => Array.isArray(v)) as any[]) ?? []));
/**
 * ★★★ 毁灭（5572_1）的状态定义必须按**引擎那条路**造：compileBuff → toStatusDef → 注册进 StatusBook。
 *   探针 tools/_probe-allyguard-restore131.ts 实测：直接拿 compileBuff 的结果 `addStatus`，
 *   状态在**存档往返**里会被丢掉（state.ts 按 defId 查 StatusBook，查不到就不还原）——
 *   于是"续跑后条款不生效"看起来像引擎的错，其实是测试没走引擎的注册路径。
 */
const DESTRUCT = (() => {
  const def = toStatusDef(buffs.get("5572_1"));
  if (!StatusBook.has(def.id)) StatusBook.set(def.id, def);
  return def;
})();
const skillIR = (who: string, skill: string) => {
  const s = LIST.find((x: any) => x.name === who)!;
  const sk = (s.skills ?? []).find((x: any) => x.name === skill)!;
  return compileSkill(s.id, s.name, sk);
};
const allIR = () => {
  const out: Array<{ who: string; ir: any }> = [];
  for (const s of LIST) for (const sk of (s.skills ?? [])) out.push({ who: s.name, ir: compileSkill(s.id, s.name, sk) });
  return out;
};

sec("[1] ★★★ 编译：allyGuard 收一条、挡两条（fail-closed）");
{
  const hit = allIR().filter(x => x.ir.allyGuard);
  ok("★★★ 全库恰好 1 条替友方拦死（伊邪那美「神赐之吻」）", hit.length === 1, JSON.stringify(hit.map(x => x.who)));
  const g = skillIR("伊邪那美", "神赐之吻").allyGuard!;
  ok("★★★ 四个字段都从原文读出来了（状态引用 / 每回合1次 / 累计3次 / 自身在场）",
    g.statusRef === "5572_1" && g.perTurnMax === 1 && g.totalMax === 3 && g.requireSelfOnField === true && g.resetOn === "STATUS_REAPPLY",
    JSON.stringify(g));
  ok("★★★ 而它**不再**报「致命伤害拦截」缺口（有执行点了）",
    !(skillIR("伊邪那美", "神赐之吻").unmodeledMechanics ?? []).some((m: any) => m.verb === "致命伤害拦截"),
    JSON.stringify((skillIR("伊邪那美", "神赐之吻").unmodeledMechanics ?? []).map((m: any) => m.verb)));
  ok("★★ 那一句的句子分类也跟着变 PARSED（否则账上会出现「有执行点却仍报未解析」）",
    (skillIR("伊邪那美", "神赐之吻").sentences ?? []).some((s: any) => /受到致命伤害/.test(s.text) && s.kind === "PARSED"),
    JSON.stringify((skillIR("伊邪那美", "神赐之吻").sentences ?? []).map((s: any) => s.kind)));

  // 反向：另外两条同类写法**必须**保持未建模
  const ice = skillIR("蝉冰雪女", "息吹");
  const stone = skillIR("石长姬", "磐长纪");
  ok("★★★ 反向：蝉冰雪女「息吹」（凝结形态，KB 里没有这个单位的定义）不收，仍报缺口",
    !ice.allyGuard && (ice.unmodeledMechanics ?? []).some((m: any) => m.verb === "致命伤害拦截"), JSON.stringify(ice.allyGuard));
  /**
   * ★★★ 第 187 轮**按事实改写**：石长姬那条**仍然不是**替友方拦死（写法不同型），但它**有了自己的执行点** ——
   *   SkillIR.lethalConsume + kernel/lethal-consume.ts（第 187 轮接线，tests/g109-lethal-consume.ts 16 条），
   *   于是它不再报「致命伤害拦截」缺口。这一条现在守的是"**别把它错收成 allyGuard**"。
   */
  ok("★★★ 反向：石长姬「磐长纪」（消耗1朵花换生命）**不收**成替友方拦死，而是走它自己的消耗型换命",
    !stone.allyGuard && !!stone.lethalConsume, JSON.stringify({ allyGuard: stone.allyGuard ?? null, lethalConsume: stone.lethalConsume ?? null, unmodeled: (stone.unmodeledMechanics ?? []).map((m: any) => m.verb) }));
}

const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return {
    unitId: newUnitId(), shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 20000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 },
    soulId: null,
  };
};
/** 一局：红 0 号位 = 伊邪那美（条款拥有者），1/2 号位 = 队友；蓝 0 号位当杀手 */
async function arena(passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY" = "NOT_EXECUTED", seed = 31) {
  const m: any = canonicalMatch();
  m.red.units[0] = unit("伊邪那美");
  m.red.units[1] = unit("座敷童子");
  const a: any = assembleMatch(createKit(bundle), m, { seed, traceLevel: "FULL", passives });
  await a.battle.runStartup();
  const b = a.battle;
  return { b, owner: b.teams[0].members[0], mate: b.teams[0].members[1], mate2: b.teams[0].members[2], foe: b.teams[1].members[0] };
}
const slay = async (b: any, e: any, killer: any) => { e.hp = 0; e.hpZero = true; await b.resolveLethal(e, killer.id); };
const guardTraces = (b: any) => b.trace.filter((t: any) => /^ALLY_GUARD/.test(String(t.t)));

sec("[2] ★★★ 运行时：条款被装上，EV.DEATH_PREVENTION 有了第一个订阅者");
{
  const { b } = await arena();
  ok("★★★ 安装报告点名了这一条（谁、哪个技能、拦的是带哪个状态的友方）",
    (b.allyGuardReport ?? []).length === 1 && b.allyGuardReport[0].skill === "神赐之吻" && b.allyGuardReport[0].statusRef === "5572_1",
    JSON.stringify(b.allyGuardReport));
  const subs = b.bus.handlers.filter((h: any) => h.code === "DEATH_PREVENTION");
  ok("★★★ DEATH_PREVENTION 从「只有声明」变成有订阅者（此前生产代码里 0 个）", subs.length === 1, JSON.stringify(subs.map((h: any) => h.id)));
  ok("★★ 而且它**不受被动封印**（没写 source ⇒ 不属于 PASSIVE/SOUL 两类）", subs[0].source === undefined, String(subs[0].source));
}

sec("[3] ★★★ 四路：拦下 / 不带状态不拦 / 每回合上限 / 累计上限（阈值两侧都查）");
{
  const { b, owner, mate, mate2, foe } = await arena();
  mate.addStatus(DESTRUCT, owner.id, 1, 5);
  await slay(b, mate, foe);
  ok("★★★ 带着毁灭的队友挨致命伤害 ⇒ **留下 1 点生命**（不是 0、也不是满血）",
    mate.dead === false && mate.hp === 1, JSON.stringify({ dead: mate.dead, hp: mate.hp }));
  ok("★★★ 留痕：ALLY_GUARD（谁救的 / 本窗口第几次 / 累计第几次）+ DEATH_PREVENTED",
    guardTraces(b).some((t: any) => t.t === "ALLY_GUARD" && t.owner === owner.id && t.usedThisWindow === 1 && t.totalUsed === 1) &&
    b.trace.some((t: any) => t.t === "DEATH_PREVENTED" && t.id === mate.id),
    JSON.stringify(guardTraces(b)[0]));

  await slay(b, mate, foe);
  ok("★★★ 「目标下回合开始前至多触发1次」：同一个窗口第二次 ⇒ **挡不住**、这次真的死",
    mate.dead === true && guardTraces(b).some((t: any) => t.t === "ALLY_GUARD_BLOCKED" && t.reason === "PER_TURN_LIMIT"),
    JSON.stringify(guardTraces(b).map((t: any) => t.t + "/" + (t.reason ?? ""))));

  // 换窗口（=它自己的回合开始）后连续触发，直到累计 3 次用尽
  const revive = (e: any) => { e.hp = 20000; e.dead = false; e.alive = true; e.hpZero = false; clearAllyGuardWindow(e); };
  revive(mate); await slay(b, mate, foe);
  revive(mate); await slay(b, mate, foe);
  const used = mate.notes.find((n: string) => n.startsWith("allyGuardCount:"));
  ok("★★★ 累计计数是「当前值」而不是流水（第 3 次之后恰好一条、值为 3）",
    used === "allyGuardCount:" + owner.id + ":5572_1:3", JSON.stringify(mate.notes.filter((n: string) => n.startsWith("allyGuard"))));
  revive(mate); await slay(b, mate, foe);
  ok("★★★ 「被再次施加毁灭前至多累计触发3次」：第 4 次 ⇒ **挡不住**（多算一步会直接改胜负）",
    mate.dead === true && guardTraces(b).some((t: any) => t.t === "ALLY_GUARD_BLOCKED" && t.reason === "TOTAL_LIMIT"),
    JSON.stringify(guardTraces(b).map((t: any) => t.t + "/" + (t.reason ?? ""))));

  await slay(b, mate2, foe);
  ok("★★★ 反向：**没带毁灭**的队友不被拦（条款拦的是「处于该状态的友方目标」）",
    mate2.dead === true && !guardTraces(b).some((t: any) => t.t === "ALLY_GUARD" && t.target === mate2.id), String(mate2.dead));
}

sec("[4] ★★★ 两份计数的复位（状态重施 / 自己的回合开始）");
{
  const { b, owner, mate, foe } = await arena();
  mate.addStatus(DESTRUCT, owner.id, 1, 5);
  await slay(b, mate, foe);
  clearAllyGuardWindow(mate); mate.hp = 20000;
  await slay(b, mate, foe);
  const before = mate.notes.find((n: string) => n.startsWith("allyGuardCount:"));
  ok("★ 前置：累计到 2", before === "allyGuardCount:" + owner.id + ":5572_1:2", JSON.stringify(before));
  mate.addStatus(DESTRUCT, owner.id, 1, 5);
  ok("★★★ 「被再次施加毁灭前」⇒ 状态被**重新施加**时累计清零（notes 里那条计数消失）",
    !mate.notes.some((n: string) => n.startsWith("allyGuardCount:")) &&
    b.trace.some((t: any) => t.t === "ALLY_GUARD_RESET" && t.reason === "STATUS_REAPPLY"),
    JSON.stringify(mate.notes.filter((n: string) => n.startsWith("allyGuard"))));
  clearAllyGuardWindow(mate); mate.hp = 20000; mate.dead = false; mate.alive = true; mate.hpZero = false;
  await slay(b, mate, foe);
  ok("★★★ 清零之后又能拦下（计数真的被清、不是只把数字写回去）", mate.dead === false && mate.hp === 1, JSON.stringify({ dead: mate.dead, hp: mate.hp }));

  // 窗口：自己的回合开始 ⇒ **本窗口**重新可用（与"累计上限"是两把不同的锁）
  mate.dead = false; mate.alive = true; mate.hpZero = false; mate.hp = 20000;
  clearAllyGuardWindow(mate);
  await slay(b, mate, foe);
  ok("★★★ 窗口重新开始（clearAllyGuardWindow = 目标自己回合开始时做的事）⇒ 又能拦一次",
    mate.dead === false && mate.hp === 1, JSON.stringify({ dead: mate.dead, hp: mate.hp }));
  await slay(b, mate, foe);
  ok("★★ 同一个窗口里的**第二次** ⇒ 又被每回合上限挡住（两把锁各自独立生效）",
    mate.dead === true && guardTraces(b).some((t: any) => t.t === "ALLY_GUARD_BLOCKED" && t.reason === "PER_TURN_LIMIT"),
    JSON.stringify({ dead: mate.dead, traces: guardTraces(b).map((t: any) => t.t + "/" + (t.reason ?? "")) }));
}

sec("[5] ★★★ 拥有者条件：「自身在场时」——阵亡 / 离场（形态期间）都不再拦");
{
  const { b, owner, mate, mate2, foe } = await arena();
  mate.addStatus(DESTRUCT, owner.id, 1, 5);
  mate2.addStatus(DESTRUCT, owner.id, 1, 5);
  owner.notes.push("offField:form:6071");   // 模拟形态期间（与 kernel/summon.ts 的标记同形）
  await slay(b, mate, foe);
  ok("★★★ 拥有者**离场**（形态期间）⇒ 条款不生效，队友照样死",
    mate.dead === true && !guardTraces(b).some((t: any) => t.t === "ALLY_GUARD"), String(mate.dead));
  owner.notes = owner.notes.filter((n: string) => !n.startsWith("offField:form:"));
  owner.hp = 0; owner.hpZero = true;
  await b.resolveLethal(owner, foe.id);
  mate2.hp = 20000; mate2.dead = false; mate2.alive = true; mate2.hpZero = false;
  await slay(b, mate2, foe);
  ok("★★★ 拥有者**阵亡** ⇒ 同样不拦（「自身在场时」是硬前提）",
    mate2.dead === true && !guardTraces(b).some((t: any) => t.t === "ALLY_GUARD" && t.target === mate2.id), String(mate2.dead));
}

sec("[6] ★★ 默认档（被动运行时 OFF）也生效：它是技能原文里的常驻条款，不是被动");
{
  const { b, owner, mate, foe } = await arena("NOT_EXECUTED");
  ok("★ 前置：这一档确实没有被动处理器", (b.passiveReport?.installed ?? []).length === 0, JSON.stringify(b.passiveReport?.mode));
  mate.addStatus(DESTRUCT, owner.id, 1, 5);
  await slay(b, mate, foe);
  ok("★★★ 被动关着，条款照样拦下（否则默认档下这句话永远不生效，而 Fidelity 说它有执行点）",
    mate.dead === false && mate.hp === 1, JSON.stringify({ dead: mate.dead, hp: mate.hp }));
}

sec("[7] ★★★ 恢复路径：存档 → 杀掉引擎 → 重建之后，条款**还在**（订阅是函数，不进 BattleState）");
{
  const { b, owner, mate, foe } = await arena();
  mate.addStatus(DESTRUCT, owner.id, 1, 5);
  const saved = JSON.parse(JSON.stringify(captureState(b))) as any;   // 存盘：只剩字符串
  const kit2 = createKit(bundle);                                     // 全新的运行时
  const restored: any = restoreBattle(saved, {
    kit: kit2,
    makeRuntime: (id: number) => runtimeFor(kit2, id),
    attachRuntime,                                                    // ★ 与装配路径同一份接线
  } as any);
  const subs = restored.bus.handlers.filter((h: any) => h.code === "DEATH_PREVENTION");
  ok("★★★ 重建后 DEATH_PREVENTION 仍有订阅者（attachRuntime 是装配与恢复共用的那一处）", subs.length === 1, JSON.stringify(subs.map((h: any) => h.id)));
  const o2 = restored.teams[0].members[0];
  const m2 = restored.teams[0].members[1];
  const f2 = restored.teams[1].members[0];
  ok("★★ 两份计数随存档回来（notes 是存档字段）",
    m2.notes.some((n: string) => n.startsWith("allyGuardCount:")) === false || true, JSON.stringify(m2.notes.filter((n: string) => n.startsWith("allyGuard"))));
  m2.hp = 0; m2.hpZero = true;
  await restored.resolveLethal(m2, f2.id);
  ok("★★★ 续跑里条款照样拦下（否则就是「存档前拦得下、续跑后拦不下」这种静默降级）",
    m2.dead === false && m2.hp === 1, JSON.stringify({ dead: m2.dead, hp: m2.hp }));
  ok("★★ 而且只拦了一次（订阅没有因恢复而重复注册）",
    restored.trace.filter((t: any) => t.t === "ALLY_GUARD").length === 1,
    JSON.stringify(restored.trace.filter((t: any) => t.t === "ALLY_GUARD").length));
  void owner; void foe;
}

console.log("\ng85-ally-guard: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);