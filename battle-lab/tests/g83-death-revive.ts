// tests/g83-death-revive.ts — ★★★ 第 129 轮：**死亡级联与触发式自复活**
//
// 这一轮修的是两条**互相咬合**的事实（两条都是探针先跑出来的，不是推理出来的）：
//
//   ① 「阵亡的单位不再做事」原来靠 `unregisterOwner` 实现 —— 副作用是
//      **复活带不回订阅**（三尾狐「诱惑」阵亡前挨打回流 200 点，复活后再派发同一条
//      AFTER_DAMAGE，一条 trace 都没有），而且注销发生在 EV.DEATH 派发**之前**，
//      于是「阵亡时」这一族**永远不可能触发**。
//      改法：订阅不动，「还算不算在场」由总线按存活状态裁决（EventBus.ownerActive），
//      死亡级联的事件码豁免（倒下这件事本身要通知到他）。
//
//   ② 「阵亡时…立即复活」在 IR 里第一次有了产物（SkillIR.selfRevive），
//      运行时由 kernel/self-revive.ts 执行（与主动复活共用 Battle.revive + healTarget）。
//
// ★ 本文件里的每个数字都来自实测（tools/_probe-revive129c.ts 总线双向 / _probe-selfrevive-run.ts
//   端到端数值 / _probe-selfrevive129.ts IR 形状 / _probe-death3rd.ts 承受者归属 /
//   _probe-revive-scope.ts 全库候选计数），不是从文档推的。
import fs from "node:fs";
import path from "node:path";
import { compileBuff } from "../compile/buff-compiler.ts";
import { compileSkill } from "../compile/skill-compiler.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { newUnitId } from "../../apps/web/src/contracts/guessing-match.ts";
import { EV } from "../kernel/types.ts";
import { installPassiveSkills } from "../compile/passive-runtime.ts";
import { loadTips, setTipsTable } from "../compile/tips.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const buffs = new Map<string, any>((JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[]).map((b: any) => [String(b.id), compileBuff(b)]));
const tipsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
const tips = loadTips(Array.isArray(tipsRaw) ? tipsRaw : (Object.values(tipsRaw).find((v: any) => Array.isArray(v)) as any[]) ?? []);
setTipsTable(tips);
const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);
const skillIR = (who: string, skill: string) => {
  const s = LIST.find((x: any) => x.name === who)!;
  const sk = (s.skills ?? []).find((x: any) => x.name === skill)!;
  return compileSkill(s.id, s.name, sk);
};

sec("[1] ★★★ 编译：selfRevive 的四条判据（收两条、挡两条，两个方向都查）");
{
  const nine: any = skillIR("九命猫", "九命");
  ok("★★★ 九命猫「九命」：IR 里有 selfRevive（20% / 门槛 4 层 / 不消耗 / 恢复通道）",
    nine.selfRevive?.hpPercent === 20 && nine.selfRevive?.requireStacks?.n === 4 &&
    nine.selfRevive?.requireStacks?.statusRef === "2072_1" && nine.selfRevive?.consumeStacks === false &&
    nine.selfRevive?.channel === "RECOVER",
    JSON.stringify(nine.selfRevive));
  /**
   * ★★★ 第 135 轮：这一条**按事实反过来了**。
   *   第 129 轮它断言的是"同一句里的『施放』没有被顺手算成已实现"（那时确实没有执行点，
   *   编译器为它合成了一条 追加施放 / WARN）。第 135 轮把触发式追加施放接上了
   *   （SkillIR.subCasts + kernel/sub-cast.ts），所以现在正确的断言是：
   *   IR 里有 subCasts 指向 skill_207_03，而那条 WARN 记录**必须消失**（实现了就不该再报缺口）。
   *   执行面的双向验证在 tests/g89-sub-cast.ts。
   */
  ok("★★★ 同一句里的『施放 skill_207_03』现在**有执行点**：IR 里有 subCasts，且不再报 追加施放 缺口",
    (nine.subCasts ?? []).some((x: any) => x.ref === "207_03" && x.target === "ENEMY_RANDOM") &&
    !nine.unmodeledMechanics.some((m: any) => m.verb === "追加施放"),
    JSON.stringify({ subCasts: nine.subCasts, unmodeled: nine.unmodeledMechanics.map((m: any) => m.verb) }));
  ok("★★★ 而「复活」这一条**不再**出现在未建模表里（它有行为代码了）",
    !nine.unmodeledMechanics.some((m: any) => m.verb === "复活"),
    JSON.stringify(nine.unmodeledMechanics.map((m: any) => m.verb)));

  const bone: any = skillIR("骨女", "怨生");
  ok("★★★ 骨女「怨生」：4层**以上**读成同一个门槛（门槛 4），且写明了消耗所有层数 / 治疗通道 HEAL",
    bone.selfRevive?.requireStacks?.n === 4 && bone.selfRevive?.requireStacks?.statusRef === "2232_1" &&
    bone.selfRevive?.consumeStacks === true && bone.selfRevive?.channel === "HEAL",
    JSON.stringify(bone.selfRevive));
  ok("★★★ 骨女这一句的未建模表是空的（条件与效果都有执行点）",
    bone.unmodeledMechanics.length === 0, JSON.stringify(bone.unmodeledMechanics.map((m: any) => m.verb)));

  // 反向：两条读不出生命比例的**必须**保持未建模（fail-closed）
  const frog: any = skillIR("青蛙瓷器", "转运");
  const sis: any = skillIR("跳跳妹妹", "不玩了啦");
  ok("★★★ 反向：青蛙瓷器「转运」（条件靠骰子点数）没有 selfRevive，且仍然报「复活」未建模",
    !frog.selfRevive && frog.unmodeledMechanics.some((m: any) => m.verb === "复活"), JSON.stringify(frog.selfRevive));
  ok("★★★ 反向：跳跳妹妹「不玩了啦」（要看「番茄在场」、也没写生命比例）同样保持未建模",
    !sis.selfRevive && sis.unmodeledMechanics.some((m: any) => m.verb === "复活"), JSON.stringify(sis.selfRevive));

  // 主动复活不能被这一轮误伤
  const tao: any = skillIR("桃花妖", "桃华灼灼");
  ok("★★★ 主动复活那条路没被误伤：桃花妖「桃华灼灼」仍然是 revive=ONE、selfRevive=null",
    tao.revive?.scope === "ONE" && !tao.selfRevive, JSON.stringify({ revive: tao.revive, selfRevive: tao.selfRevive }));

  // 全库计数（量出来的，不是我挑的）
  const hits: string[] = [];
  for (const s of LIST) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const sk of (s.skills ?? [])) {
      const ir: any = compileSkill(s.id, s.name, sk);
      if (ir.selfRevive) hits.push(s.name + "「" + sk.name + "」");
    }
  }
  ok("★★★ 全库恰好 2 条触发式自复活（九命猫「九命」/ 骨女「怨生」）",
    hits.length === 2, JSON.stringify(hits));
  console.log("    " + hits.join("、"));
}

const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return {
    unitId: newUnitId(), shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 20000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 100, effectResist: 0 },
    soulId: null,
  };
};

/** 造一局：红 0 号位换成 `who`，其余沿用典型对局 #001（蓝方 2 号位当击杀者，故意不是 0 号位） */
async function arena(who: string, opts: { stacks?: number; buffId?: string; seed?: number; passives?: boolean } = {}) {
  const m: any = canonicalMatch();
  m.red.units[0] = unit(who);
  const a: any = assembleMatch(createKit(bundle), m, {
    seed: opts.seed ?? 7, traceLevel: "FULL",
    passives: opts.passives === false ? "NOT_EXECUTED" : "PARSED_CANDIDATES_ONLY",
  });
  await a.battle.runStartup();
  const b = a.battle;
  const e = b.teams[0].members[0];
  const killer = b.teams[1].members[2];
  if (opts.stacks && opts.buffId) e.addStatus(buffs.get(opts.buffId)!, e.id, opts.stacks, 5);
  return { battle: b, e, killer, report: b.passiveReport };
}

/** 把 `e` 打死（走真实的死亡状态机，不是直接置 dead） */
async function slay(b: any, e: any, killer: any) {
  e.hp = 0; e.hpZero = true;
  await b.resolveLethal(e, killer.id);
}

sec("[2] ★★★ 总线：阵亡**不再注销订阅**（阵亡期间不做事 / 复活后恢复做事，双向）");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, traceLevel: "FULL", passives: "PARSED_CANDIDATES_ONLY" });
  await a.battle.runStartup();
  const b = a.battle;
  const fox = b.allEntities().find((x: any) => x.name === "三尾狐")!;   // 「诱惑」= 造成伤害时 50% 概率 20% 吸血
  const foe = b.teams[1].members[0];
  const owned = () => b.bus.handlers.filter((h: any) => h.ownerId === fox.id);
  ok("★ 前置：三尾狐身上确实装着 1 个处理器（否则下面三条是平凡通过）", owned().length === 1, String(owned().length));

  const fire = async () => {
    const t0 = b.trace.length;
    await b.bus.dispatch(EV.AFTER_DAMAGE,
      { input: { source: fox, target: foe }, result: { applied: 1000, final: 1000, absorbed: 0 } },
      fox.id, fox.teamId, (id: number) => b.teamOf(id));
    return b.trace.slice(t0).filter((t: any) => /LIFESTEAL|HEAL/.test(String(t.t))).length;
  };
  const before = await fire();
  ok("★★★ 阵亡前：这条被动真的会做事（吸血留下 trace）", before > 0, String(before));

  fox.hp = 0; fox.hpZero = true;
  await b.resolveLethal(fox, foe.id);
  ok("★★ 阵亡后处理器**仍然在表里**（不再是 unregisterOwner 那条路）", owned().length === 1, String(owned().length));
  const during = await fire();
  ok("★★★ 但阵亡期间它**一次都不许触发**（「死了就不做事」这条语义没有丢）", during === 0, String(during));

  const revived = await b.revive(fox, 1);
  ok("★ 复活成功", revived === true && fox.alive === true, JSON.stringify({ revived, alive: fox.alive, hp: fox.hp }));
  const after = await fire();
  ok("★★★ 复活后同一条派发又能触发 —— **订阅没有被死亡带走**（这一轮修掉的核心缺陷）",
    after > 0, String(after));
}

sec("[3] ★★★ 「阵亡时」这一族的承受者归属（★ 第 176 轮接线后**按事实改写**）");
{
  const { battle: b, e, killer, report } = await arena("九命猫", { stacks: 3, buffId: "2072_1" });
  const installed = (report.installed ?? []).filter((x: any) => x.entityId === e.id);
  ok("★★ 九命猫现在装了 **3** 条处理器（暴击叠层 / 阵亡复活 / **阵亡时对伤害来源附加**）",
    installed.length === 3, JSON.stringify(installed.map((x: any) => x.family + "/" + x.event)));
  ok("★★★ 第三句走的是**逐句承受者归属**（sourceBearerFields 里有它），不再进 byTarget 桶",
    (report.sourceBearerFields ?? []).some((x: any) => x.skill === "九命") && report.skipped.byTarget === 0,
    JSON.stringify({ sb: report.sourceBearerFields, skipped: report.skipped }));
  ok("★★ 第 129 轮那条失败关闭的痕**不再出现**（那一句已经能算了）",
    !b.trace.some((t: any) => t.t === "PASSIVE_SKIPPED" && t.reason === "DAMAGE_SOURCE_TARGET_NOT_PER_CLAUSE"),
    JSON.stringify(b.trace.filter((t: any) => t.t === "PASSIVE_SKIPPED").map((t: any) => t.reason)));

  await slay(b, e, killer);
  ok("★★★ 状态落在**击杀者**身上 —— 这就是原文说的「伤害来源」",
    (killer.statuses ?? []).some((s: any) => String(s.def?.id) === "2073_1"),
    JSON.stringify({ killer: killer.id, has: (killer.statuses ?? []).map((s: any) => s.def?.id) }));
  const wrong = b.teams[1].members.filter((x: any) => x.id !== killer.id
    && (x.statuses ?? []).some((s: any) => String(s.def?.id) === "2073_1"));
  ok("★★★ 而且**别的敌人一个都没拿到**（旧的技能级 targeting 会把它随手加给随机一个敌人）",
    wrong.length === 0, JSON.stringify(wrong.map((x: any) => x.id)));
}

sec("[4] ★★★ 九命猫「九命」：4 层复活、3 层不复活（阈值两侧都查）");
{
  const a = await arena("九命猫", { stacks: 4, buffId: "2072_1" });
  const b = a.battle, e = a.e;
  const maxHp = e.maxHp;
  await slay(b, e, a.killer);
  const sr = b.trace.find((t: any) => t.t === "SELF_REVIVE");
  ok("★★★ 4 层时真的复活了（SELF_REVIVE + REVIVE 两条都在）",
    !!sr && b.trace.some((t: any) => t.t === "REVIVE" && t.id === e.id), JSON.stringify(sr));
  ok("★★★ 生命 = 生命上限的 20% + 1 点（与主动复活同一个约定：先 1 点血进场，再由治疗抬到 N%）",
    Math.abs(e.hp - (maxHp * 0.2 + 1)) < 1e-6, JSON.stringify({ hp: e.hp, maxHp, expect: maxHp * 0.2 + 1 }));
  ok("★★★ 走的是**恢复**通道（原文 [tips_20]）—— 与「治疗」是两条管线，不能混",
    sr?.channel === "RECOVER" && b.trace.some((t: any) => t.t === "RECOVER" && t.dst === e.id),
    JSON.stringify(sr?.channel));
  ok("★★ 复活后回到行动条上（否则它虽然活着但永远不会动）", !!b.timeline.get(e.id));
  ok("★★ 原文没写消耗 ⇒ 层数保持 4（不许多算一步）",
    (e.statuses.find((s: any) => String(s.def?.id) === "2072_1")?.stacks ?? 0) === 4, "");

  const c = await arena("九命猫", { stacks: 3, buffId: "2072_1" });
  await slay(c.battle, c.e, c.killer);
  ok("★★★ 反向：3 层时**不复活**（仍然 dead、没有 SELF_REVIVE trace、也不在行动条上）",
    c.e.dead === true && !c.battle.trace.some((t: any) => t.t === "SELF_REVIVE") && !c.battle.timeline.get(c.e.id),
    JSON.stringify({ dead: c.e.dead, hp: c.e.hp }));
}

sec("[5] ★★★ 骨女「怨生」：消耗所有层数 + 治疗通道；层数不足时层数必须**原样留着**");
{
  const a = await arena("骨女", { stacks: 5, buffId: "2232_1" });
  const b = a.battle, e = a.e, maxHp = e.maxHp;
  await slay(b, e, a.killer);
  const sr = b.trace.find((t: any) => t.t === "SELF_REVIVE");
  ok("★★★ 5 层（≥4）复活成功", !!sr && e.alive && !e.dead, JSON.stringify(sr && { hp: e.hp, alive: e.alive }));
  ok("★★★ 生命 = 生命上限 20% + 1", Math.abs(e.hp - (maxHp * 0.2 + 1)) < 1e-6, JSON.stringify({ hp: e.hp, expect: maxHp * 0.2 + 1 }));
  ok("★★★ 「则消耗所有层数」被执行：状态整条回收（不是置 0 留在身上）",
    !(e.statuses ?? []).some((s: any) => String(s.def?.id) === "2232_1"), JSON.stringify((e.statuses ?? []).map((s: any) => s.def?.id)));
  const exp = b.trace.find((t: any) => t.t === "STATUS_EXPIRE" && t.reason === "SELF_REVIVE_CONSUMED");
  ok("★★★ 消耗这件事进 trace 与事件队列（STATUS_EXPIRE / SELF_REVIVE_CONSUMED）",
    !!exp && exp.stacks === 5, JSON.stringify(exp));
  ok("★★★ 走的是**治疗**通道（原文写「治疗」）—— 与九命猫的「恢复」分开",
    sr?.channel === "HEAL" && !b.trace.some((t: any) => t.t === "RECOVER" && t.dst === e.id), JSON.stringify(sr?.channel));

  const c = await arena("骨女", { stacks: 2, buffId: "2232_1" });
  await slay(c.battle, c.e, c.killer);
  ok("★★★ 反向：2 层时**不复活**，而且那 2 层**一个都没被消耗**（失败关闭不许有副作用）",
    c.e.dead === true && (c.e.statuses.find((s: any) => String(s.def?.id) === "2232_1")?.stacks ?? 0) === 2,
    JSON.stringify({ dead: c.e.dead, stacks: c.e.statuses.map((s: any) => s.def?.id + "x" + s.stacks) }));
}

sec("[6] ★★★ 政策边界：killedAt=AFTER_DEATH_RESOLUTION 档下，复活成功不许再记 killed");
{
  const a = await arena("骨女", { stacks: 4, buffId: "2232_1" });
  const b = a.battle, e = a.e;
  b.policies.death.killedAt = "AFTER_DEATH_RESOLUTION";
  await slay(b, e, a.killer);
  ok("★★★ 目标已经复活 ⇒ 不再写 killed=true（否则 revive 刚清掉的标记会被重新钉回去）",
    e.killed === false && e.alive === true, JSON.stringify({ killed: e.killed, alive: e.alive }));
  ok("★★★ 跳过也要留痕（KILLED_SKIPPED / REVIVED_DURING_DEATH）",
    b.trace.some((t: any) => t.t === "KILLED_SKIPPED" && t.reason === "REVIVED_DURING_DEATH"),
    JSON.stringify(b.trace.filter((t: any) => t.t === "KILLED_SKIPPED")));

  // 对照：没复活的人在这一档下必须照旧被记 killed（否则上面那条断言可能只是「这一档什么都没做」）
  const c = await arena("骨女", { stacks: 0, buffId: "2232_1" });
  c.battle.policies.death.killedAt = "AFTER_DEATH_RESOLUTION";
  await slay(c.battle, c.e, c.killer);
  ok("★★★ 对照：没有复活的目标仍然记 killed=true 且派发 KILLED（这一档没有被整体关掉）",
    c.e.killed === true && !c.battle.trace.some((t: any) => t.t === "KILLED_SKIPPED"),
    JSON.stringify({ killed: c.e.killed }));
}

sec("[7] ★★ 与主动复活的分工：被动关闭时，触发式复活**不注册**（默认档不许改变历史结果）");
{
  const a = await arena("骨女", { stacks: 5, buffId: "2232_1", passives: false });
  ok("★ 前置：被动策略 OFF 时安装报告是空的", (a.report?.installed ?? []).length === 0, JSON.stringify(a.report?.mode));
  await slay(a.battle, a.e, a.killer);
  ok("★★★ 默认档下骨女**不复活**（红区 E：默认不许产生新行为，指纹才不会漂）",
    a.e.dead === true && !a.battle.trace.some((t: any) => t.t === "SELF_REVIVE"),
    JSON.stringify({ dead: a.e.dead }));
}

console.log("\ng83-death-revive: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);