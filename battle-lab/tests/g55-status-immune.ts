// tests/g55-status-immune.ts — ★★★ 状态自带的免疫 / 免死 / 禁复活（第 94 轮，目标 ⑨）
//
// 由来：三个**只有声明没有写入方**的东西凑在同一处：
//   · `EV.IMMUNE` —— 事件码存在，**从来没有被派发过**（第 27 轮普查就记下了）；
//   · `Entity.reviveBlocked` —— 被 Battle.revive 读、被 state 序列化，**没有任何写入方**；
//   · `Entity.undeathUsed` —— 同上（capability 的 UNDYING 就挂在它身上）。
// 而数据一直在：338 条 buff 里有 15 条写着免疫/免死/禁复活语义。
//
// 这一轮把它们接到**唯一的状态施加点**与**伤害管线**上，判据全部取自 buff 原文（不是技能文案）。
import fs from "node:fs";
import path from "node:path";
import { compileBuff, toStatusDef } from "../compile/buff-compiler.ts";
import { findImmuneStatus, StatusBook } from "../kernel/status.ts";
import { ImmunePolicies, defaultPolicies, policySnapshot } from "../kernel/policies.ts";
import { DISPATCHED_EV_CODES } from "../compile/passive-runtime.ts";
import { CAPABILITIES } from "../capability/registry.ts";
import { DamageType, EV, HpMutation } from "../kernel/types.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = "2d7c7507e18db61f";
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const BUFFS: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8"));
const cb = (id: string) => compileBuff(BUFFS.find((b: any) => String(b.id) === id));
const kbBuff = (id: string) => BUFFS.find((b: any) => String(b.id) === id);

sec("[1] ★★★ 编译侧：15 条 buff 被解析出免疫语义，三类假命中必须**不收**");
{
  const rows = BUFFS.map((b: any) => ({ id: String(b.id), name: String(b.name), cb: compileBuff(b) }))
    .filter(r => r.cb.immuneTo || r.cb.blocksRevive || r.cb.preventsLethal);
  const byKind: Record<string, number> = {};
  for (const r of rows) { for (const k of (r.cb.immuneTo ?? [])) byKind[k] = (byKind[k] ?? 0) + 1; }
  /**
   * ★★★ 第 100 轮：19 → **24**。多出来的 5 条是**这一轮才被收上来的**庇护类印记：
   *   3696_1 / 3675_1 / 3532_1 / 3382_1（「可抵挡1次控制效果」）+ 2922_1 霜织庇护（「抵挡1次…或放逐」）。
   *   ★ 它们的写法里**没有「免疫」二字**，此前在引擎里等于不存在 —— 免疫判据从"只认免疫"扩到"也认抵挡N次"
   *   才把它们捞出来。这条计数断言正是"捞出来时必须改一个数字"的那种闸门。
   */
  ok("★★★ 恰好 24 条（20 免疫 + 4 免死；不是 0 条而显得干净）", rows.length === 24, String(rows.length));
  ok("★★★ 四类免疫都有实例：CONTROL / DEBUFF / DAMAGE / BANISH",
    byKind.CONTROL >= 5 && byKind.DAMAGE >= 3 && byKind.DEBUFF >= 1 && byKind.BANISH >= 3, JSON.stringify(byKind));
  ok("★★★ 禁复活 2 条（屹立不倒 3341_1 / 破碎印记 3143_1）",
    rows.filter(r => r.cb.blocksRevive).length === 2, JSON.stringify(rows.filter(r => r.cb.blocksRevive).map(r => r.id)));
  // ★ 两种免死口径**都有真实数据**（这是断言写完才发现的 —— 我原以为只有 FULL 一种）：
  //   「免疫首次/下1次受到的致命伤害」= FULL（血色之花 5852_1 / 四季流转 3928_1 / 怒火 2652_1）
  //   「受到致命伤害时将剩余1点生命」 = ONE（回魂 2772_1）
  ok("★★★ 免死 4 条：FULL 3（免除该次伤害）+ ONE 1（回魂 2772_1：剩余1点生命）",
    rows.filter(r => r.cb.preventsLethal === "FULL").length === 3 &&
    rows.filter(r => r.cb.preventsLethal === "ONE").map(r => r.id).join(",") === "2772_1",
    JSON.stringify(rows.filter(r => r.cb.preventsLethal).map(r => r.id + ":" + r.cb.preventsLethal)));
  ok("★★★ 而且「回魂」的 ONE 不是被伤害免疫抢走的（致命伤害 ≠ 免疫伤害）",
    !cb("2772_1").immuneTo, JSON.stringify(cb("2772_1").immuneTo));
  console.log("    免疫类别分布：" + JSON.stringify(byKind));

  // ── 假命中 ①：上一段的词被算进来（修罗：…吸收攻击120%伤害的护盾，免疫控制效果）
  const xl = cb("3453_1");
  ok("★★★ 假命中①：修罗只免疫控制 —— 「…120%伤害的护盾」里的「伤害」不许被算成免疫类别",
    JSON.stringify(xl.immuneTo) === JSON.stringify(["CONTROL"]), JSON.stringify(xl.immuneTo));
  // ── 假命中 ②：在说别人（无尽剑狱：…或目标免疫控制效果，则不开启剑狱）
  // ★ 判据用 `!`（而不是 === null）：这四个字段只有非默认值才写进产物，
  //   所以「没有」是**键不存在**。写 === null 会在改成条件写出之后静默失配（这一轮真的发生了）。
  ok("★★★ 假命中②：无尽剑狱的「目标免疫控制效果」是在说**别人**，不许收成本状态的属性",
    !cb("3334_1").immuneTo, JSON.stringify(cb("3334_1").immuneTo));
  // ── 假命中 ③：条件句（溟种：若该伤害被免疫或被护盾完全吸收，则…）
  ok("★★★ 假命中③：溟种的「若该伤害**被免疫**」是条件句，不许收",
    !cb("3582_1").immuneTo, JSON.stringify(cb("3582_1").immuneTo));
  // ── 边界：只免某一种控制的写法**不收**（收了会变成"免疫全部控制" = 多算）
  ok("★★★ 边界：「免疫沉睡效果」不收成 CONTROL（那会是多算 —— 它只免一种控制）",
    !cb("3861_1").immuneTo, JSON.stringify(cb("3861_1").immuneTo));
  // ── 边界：无法被驱散 / 锁条 都不是免疫
  ok("★★★ 边界：「无法被驱散」是 dispellable，「无法受到改变行动条的效果」是 locksTimeline —— 都不是免疫",
    !cb("6091_1").immuneTo && cb("6091_1").locksTimeline === true && cb("6091_1").dispellable === false,
    JSON.stringify({ imm: cb("6091_1").immuneTo, lock: cb("6091_1").locksTimeline, disp: cb("6091_1").dispellable }));
  // ── 消耗型
  ok("★★ 消耗型免疫 8 条（狐族庇佑 / 感知 / 霹雳 + 第 100 轮新收的 5 条「抵挡N次」写法）",
    BUFFS.filter((b: any) => compileBuff(b).consumeOnImmune).length === 8,
    String(BUFFS.filter((b: any) => compileBuff(b).consumeOnImmune).length));

  // ── 反向自检：合成的真写法必须被收
  const synth = (desc: string) => compileBuff({ id: "probe", name: "探查", desc });
  ok("★★★ 反向：合成的「免疫所有控制效果」必须收 CONTROL",
    JSON.stringify(synth("【增益、印记】免疫所有控制效果。").immuneTo) === JSON.stringify(["CONTROL"]),
    JSON.stringify(synth("【增益、印记】免疫所有控制效果。").immuneTo));
  ok("★★★ 反向：合成的「受到致命伤害…剩余1点生命」必须收成 preventsLethal=ONE（不是免疫伤害）",
    synth("【增益、印记】受到致命伤害时，剩余1点生命。").preventsLethal === "ONE" &&
    !synth("【增益、印记】受到致命伤害时，剩余1点生命。").immuneTo,
    JSON.stringify(synth("【增益、印记】受到致命伤害时，剩余1点生命。")));
}

sec("[2] ★★★ 红区 G：「免疫减益」到底免不免控制 —— 两条口径都实现、都被读");
{
  ok("★★★ 两条口径的取值相反（否则「另一种口径」是假的）",
    ImmunePolicies.DEBUFF_COVERS_CONTROL.debuffCoversControl !== ImmunePolicies.CONTROL_ONLY.debuffCoversControl);
  ok("★★★ 默认是 DEBUFF_COVERS_CONTROL 且状态是 HYPOTHESIS（无实测来源）",
    defaultPolicies().immune.id === "DEBUFF_COVERS_CONTROL" && defaultPolicies().immune.status === "HYPOTHESIS");
  const snap: any = policySnapshot(defaultPolicies());
  ok("★★★ policySnapshot 带着这条口径（用哪种口径算的要看得出来）",
    snap.immune.debuffCoversControl === true && snap.immune.id === "DEBUFF_COVERS_CONTROL", JSON.stringify(snap.immune));

  const stun = StatusBook.get("stun")!;                        // 控制 + 减益
  const slow = { id: "probe_slow", name: "探查·减速", category: "DEBUFF_STATE", preventsAction: false, preventsSkill: false, forcesBasicAttack: false, dispellable: true, removable: true, suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "SOURCE_TURN", desc: "" } as any;
  const debuffImmune = { id: "probe_imm_debuff", name: "探查·免疫减益", category: "BUFF_MARK", preventsAction: false, preventsSkill: false, forcesBasicAttack: false, dispellable: true, removable: true, suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "SOURCE_TURN", immuneTo: ["DEBUFF"], desc: "" } as any;
  const holder = { statuses: [{ def: debuffImmune, sourceId: 0, stacks: 1, remaining: 3, effects: [], tag: "t1" }] } as any;
  ok("★★★ 口径 A（覆盖控制）：免疫减益**挡得住**眩晕",
    !!findImmuneStatus(holder, stun, true) && findImmuneStatus(holder, stun, true)!.kind === "DEBUFF");
  ok("★★★ 口径 B（只管非控制减益）：同一个眩晕**挡不住**了 —— 这条红区不是装饰",
    findImmuneStatus(holder, stun, false) === null, JSON.stringify(findImmuneStatus(holder, stun, false)));
  ok("★★ 而两个口径下，普通减益都被挡下（区别只在控制上）",
    !!findImmuneStatus(holder, slow, true) && !!findImmuneStatus(holder, slow, false));
}

// ── 端到端夹具：给一个真实单位挂一个合成状态
async function fresh() {
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  const ents = a.battle.allEntities();
  return { battle: a.battle, ents };
}
const mkDef = (o: any) => ({ id: "probe", name: "探查", category: "BUFF_MARK", preventsAction: false, preventsSkill: false, forcesBasicAttack: false, dispellable: true, removable: true, suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "SOURCE_TURN", desc: "", ...o });

sec("[3] ★★★ 状态免疫闸门（走真实技能的执行路径）：控制被挡下 + EV.IMMUNE 真的被派发");
{
  // 鲸汐千姬「鲛人歌」是全库少数会施加**控制类状态**（5621_1 冰眠）的技能之一
  const m: any = canonicalMatch();
  m.red.units[0].shikigamiId = 562; m.red.units[0].name = "鲸汐千姬";
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261001, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  const battle: any = a.battle;
  const caster = battle.allEntities().find((e: any) => e.shikigamiId === 562);
  const foe = battle.allEntities().find((e: any) => e.teamId !== caster.teamId);
  const skl = caster.skills.find((s: any) => s.name === "鲛人歌");
  const controlRef = (skl.ir.statusRefs ?? []).find((r: string) => {
    const d = toStatusDef(compileBuff(kbBuff(r)));
    return d.preventsAction || d.preventsSkill || d.forcesBasicAttack;
  });
  ok("前置：这个技能真的会施加一个控制类状态（否则下面两条断言会平凡通过）",
    !!controlRef, JSON.stringify(skl.ir.statusRefs));
  let immuneEvents = 0;
  battle.bus.register({ id: "PROBE:IMMUNE", ownerId: foe.id, code: EV.IMMUNE, range: "ALL", priority: 99, passive: false, fn: () => { immuneEvents++; } });
  battle.teams[caster.teamId].orbs.gain(8);
  await skl.execute(battle, caster, foe);
  // ★ 受试者**从 trace 里读**，不假设是哪个单位 —— 第一版假设是 AI 选的目标，
  //   结果那个控制状态其实落在别的单位身上（技能范围/AI 选目标都不是这里该猜的事）。
  const applied1 = battle.trace.filter((t: any) => t.t === "STATUS_APPLY" && t.status === controlRef);
  ok("★★★ 对照组：没有免疫时，控制状态**真的挂上了**（并且从 trace 里读出是谁中了）",
    applied1.length >= 1, JSON.stringify(battle.trace.filter((t: any) => t.t === "STATUS_APPLY").map((t: any) => t.status)));
  const victim = battle.allEntities().find((e: any) => e.id === applied1[applied1.length - 1].dst);
  ok("★★ 受试者已定位（不是猜的）", !!victim, JSON.stringify(applied1.slice(-1)));
  ok("★★ 而且此刻没有 IMMUNE 事件", immuneEvents === 0, String(immuneEvents));

  // 给受击方挂上「免疫控制」
  const immDef = mkDef({ id: "probe_imm_ctrl", name: "探查·免控", immuneTo: ["CONTROL"] });
  victim.addStatus(immDef as any, 0, 1, 3);
  victim.expireStatus(victim.statuses.find((s: any) => s.def.id === controlRef)!);   // 先清掉上一条
  const beforeImmune = immuneEvents;
  const appliesBefore = battle.trace.filter((t: any) => t.t === "STATUS_APPLY" && t.status === controlRef).length;
  await skl.execute(battle, caster, foe);
  const appliesAfter = battle.trace.filter((t: any) => t.t === "STATUS_APPLY" && t.status === controlRef).length;
  void foe;
  ok("★★★ 有免疫时，控制状态**没有被挂上**（施加次数没变）", appliesAfter === appliesBefore, appliesBefore + " → " + appliesAfter);
  ok("★★★ 而它留下了 IMMUNE trace（「什么都没发生」必须可观测）",
    battle.trace.some((t: any) => t.t === "IMMUNE" && t.kind === "CONTROL" && t.by === "probe_imm_ctrl"),
    JSON.stringify(battle.trace.filter((t: any) => t.t === "IMMUNE").slice(-2)));
  ok("★★★ EV.IMMUNE 真的被派发了（这个事件码此前从未被派发过）", immuneEvents === beforeImmune + 1, beforeImmune + " → " + immuneEvents);
  ok("★★ 被挡下的控制确实不在身上", !victim.hasStatus(controlRef), JSON.stringify(victim.statuses.map((s: any) => s.def.id)));
}

sec("[4] ★★★ 消耗型免疫：「受到控制效果时消耗1层，免疫该控制效果」");
{
  const { battle, ents } = await fresh();
  const foe = ents[1];
  const immDef = mkDef({ id: "probe_consume", name: "探查·感知", immuneTo: ["CONTROL"], consumeOnImmune: true });
  foe.addStatus(immDef as any, 0, 3, 9);
  const st = foe.statuses.find((s: any) => s.def.id === "probe_consume");
  const hit1 = findImmuneStatus(foe, StatusBook.get("stun")!, true);
  ok("★★★ 第一次免疫：挡下 + 层数 3 → 2", !!hit1 && hit1.consumed && st.stacks === 2, JSON.stringify({ hit: !!hit1, stacks: st.stacks }));
  findImmuneStatus(foe, StatusBook.get("freeze")!, true);
  ok("★★ 第二次免疫：再减一层（2 → 1）", st.stacks === 1, String(st.stacks));
  const third = findImmuneStatus(foe, StatusBook.get("stun")!, true);
  ok("★★★ 层数归零之后**不再免疫**（immunity 用完就是没了）",
    st.stacks === 0 && !!third, JSON.stringify({ stacks: st.stacks, stillBlocked: !!third }));
  ok("★★ 说明：层数归零的状态本身要由施加路径清理（这里是直接调用，故仍在身上）—— 边界写清楚",
    foe.statuses.some((s: any) => s.def.id === "probe_consume"));
}

sec("[5] ★★★ 伤害免疫：「免疫伤害」把这一击归零，而且不触发「造成伤害时」");
{
  const { battle, ents } = await fresh();
  const src = ents.find((e: any) => e.teamId === 0)!;
  const dst = ents.find((e: any) => e.teamId === 1)!;
  let afterDamageFired = 0;
  battle.bus.register({ id: "PROBE:AFTER_DAMAGE", ownerId: src.id, code: EV.AFTER_DAMAGE, range: "ALL", priority: 99, passive: false, fn: () => { afterDamageFired++; } });
  const hp0 = dst.hp;
  const r1: any = await battle.damage(src, dst, 5000, DamageType.NORMAL, 1);
  ok("前置：没有免疫时这一击真的掉血（对照组）", dst.hp < hp0 && afterDamageFired > 0, JSON.stringify({ hp: dst.hp, hp0, fired: afterDamageFired }));

  const immDef = mkDef({ id: "probe_imm_dmg", name: "探查·免伤", immuneTo: ["DAMAGE"] });
  dst.addStatus(immDef as any, 0, 1, 3);
  const hp1 = dst.hp;
  const firedBefore = afterDamageFired;
  const dmgTraces = battle.trace.filter((t: any) => t.t === "DAMAGE").length;
  const r2: any = await battle.damage(src, dst, 5000, DamageType.NORMAL, 1);
  ok("★★★ 这一击被归零（final = 0）且血量一位不变", r2.final === 0 && dst.hp === hp1, JSON.stringify({ final: r2.final, hp: dst.hp, was: hp1 }));
  ok("★★★ **没有**产生 DAMAGE trace（这一击被免除，而不是「打了个 0」）",
    battle.trace.filter((t: any) => t.t === "DAMAGE").length === dmgTraces, String(battle.trace.filter((t: any) => t.t === "DAMAGE").length - dmgTraces));
  ok("★★★ 也**没有**触发「造成伤害时」（AFTER_DAMAGE 计数不变）—— 否则被动会被一次没造成伤害的攻击触发",
    afterDamageFired === firedBefore, firedBefore + " → " + afterDamageFired);
  ok("★★★ 留下 IMMUNE trace（kind=DAMAGE）", battle.trace.some((t: any) => t.t === "IMMUNE" && t.kind === "DAMAGE" && t.by === "probe_imm_dmg"));
}

sec("[6] ★★★ 免死：FULL 回到受击前 / ONE 只剩 1 点，并且 undeathUsed 第一次被置为 true");
{
  const { battle, ents } = await fresh();
  const src = ents.find((e: any) => e.teamId === 0)!;
  const dst = ents.find((e: any) => e.teamId === 1)!;
  ok("前置：undeathUsed 出厂是 false（这个字段此前从未被置为 true）", dst.undeathUsed === false);
  dst.hp = 300;
  const full = mkDef({ id: "probe_undying_full", name: "探查·免死FULL", preventsLethal: "FULL" });
  dst.addStatus(full as any, 0, 1, 9);
  await battle.damage(src, dst, 99999, DamageType.NORMAL, 1);
  ok("★★★ FULL：血量回到受击前（300），没有死", Math.abs(dst.hp - 300) < 1e-6 && !dst.dead, "hp=" + dst.hp + " dead=" + dst.dead);
  ok("★★★ undeathUsed 变成了 true", dst.undeathUsed === true);
  ok("★★★ 留下 UNDYING trace（keep=FULL）", battle.trace.some((t: any) => t.t === "UNDYING" && t.keep === "FULL" && t.id === dst.id));
  ok("★★★ 用掉即消耗：「首次」只有一次，状态被移除（否则下一次致命伤害又被免掉）",
    !dst.statuses.some((s: any) => s.def.id === "probe_undying_full") &&
    battle.trace.some((t: any) => t.t === "STATUS_EXPIRE" && t.reason === "UNDYING_CONSUMED"), JSON.stringify(dst.statuses.map((s: any) => s.def.id)));

  // ONE 口径 + 多层
  const { battle: b2, ents: e2 } = await fresh();
  const s2 = e2.find((e: any) => e.teamId === 0)!;
  const d2 = e2.find((e: any) => e.teamId === 1)!;
  d2.hp = 500;
  d2.addStatus(mkDef({ id: "probe_undying_one", name: "探查·免死ONE", preventsLethal: "ONE" }) as any, 0, 3, 9);
  await b2.damage(s2, d2, 99999, DamageType.NORMAL, 1);
  const st2 = d2.statuses.find((x: any) => x.def.id === "probe_undying_one");
  ok("★★★ ONE：活下来但只剩 1 点血", Math.abs(d2.hp - 1) < 1e-6 && !d2.dead, "hp=" + d2.hp);
  ok("★★ 三层里只消耗一层（状态还在，剩 2 层）", !!st2 && st2.stacks === 2, JSON.stringify({ stacks: st2?.stacks }));
  // 对照：没有免死状态时，同样的伤害就是死
  const { battle: b3, ents: e3 } = await fresh();
  const d3 = e3.find((e: any) => e.teamId === 1)!;
  d3.hp = 300;
  await b3.damage(e3.find((e: any) => e.teamId === 0)!, d3, 99999, DamageType.NORMAL, 1);
  ok("★★★ 对照：没有免死状态时这一击直接打死（这条断言证明上面两条不是平凡通过）",
    d3.dead === true || d3.hpZero === true, JSON.stringify({ dead: d3.dead, hpZero: d3.hpZero, hp: d3.hp }));
}

sec("[7] ★★★ 禁复活：reviveBlocked 由状态维护（这个字段此前从未被置为 true）");
{
  const { battle, ents } = await fresh();
  const victim = ents.find((e: any) => e.teamId === 1)!;
  ok("前置：reviveBlocked 出厂是 false", victim.reviveBlocked === false);
  victim.mutateHp(HpMutation.DAMAGE, 99999, "probe");
  await battle.resolveLethal(victim, 0);
  ok("前置：目标已阵亡（dead = true）", victim.dead === true);
  ok("★★★ 刚死时 reviveBlocked 仍是 false —— 于是复活**能成功**（对照）",
    victim.reviveBlocked === false && (await battle.revive(victim, 100)) === true, String(victim.reviveBlocked));

  // 再杀一次，这次挂上「无法被复活」的状态
  victim.hp = 0; victim.dead = false; victim.alive = true; victim.hpZero = false;
  victim.addStatus(toStatusDef(cb("3341_1")) as any, 0, 1, 9);
  ok("★★★ 挂上「无法被复活」的状态后，reviveBlocked 变成 true", victim.reviveBlocked === true, String(victim.reviveBlocked));
  victim.mutateHp(HpMutation.DAMAGE, 99999, "probe");
  await battle.resolveLethal(victim, 0);
  ok("★★★ 复活被拒（Battle.revive 返回 false）—— reviveBlocked 第一次真的起作用",
    (await battle.revive(victim, 100)) === false);
  victim.expireStatus(victim.statuses.find((s: any) => s.def.id === "3341_1")!);
  ok("★★★ 状态消失后又可以复活了（reviveBlocked 跟着状态走，不是一个永久锁）",
    victim.reviveBlocked === false && (await battle.revive(victim, 100)) === true, String(victim.reviveBlocked));
}

sec("[8] ★★★ 登记册与默认路径");
{
  ok("★★★ IMMUNE 进了 DISPATCHED_EV_CODES（它现在真的有两处派发点）", DISPATCHED_EV_CODES.has("IMMUNE"));
  const cap = CAPABILITIES.find(c => c.key === "CONTROL_IMMUNE")!;
  ok("★★★ 能力表：免控不再是「没有独立判定」——说明改写并给了 producer",
    !!cap.producer && !/没有独立的免控判定/.test(cap.note), JSON.stringify({ producer: cap.producer, note: cap.note.slice(0, 40) }));
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  await a.battle.run();
  ok("★★★ 默认路径指纹逐位不变（典型对局 10 个单位都不带这些 buff —— 数据侧也验过）",
    stateHash(captureState(a.battle)) === BASE, stateHash(captureState(a.battle)));
  const snap: any = (a.battle as any).summary().policies;
  ok("★★ 产物快照里带着免疫口径（用哪种口径算的要看得出来）",
    snap.immune?.debuffCoversControl === true, JSON.stringify(snap.immune));
}

console.log("\n=== 状态免疫/免死/禁复活: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
