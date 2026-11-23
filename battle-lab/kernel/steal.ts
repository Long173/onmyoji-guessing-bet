// kernel/steal.ts — ★★★ 第 99 轮：**属性偷取 → 归还**（a1-4 §16 的 Restore；目标 ⑨）
//
// 为什么是这一桶：全库 818 条技能里含「偷取」的只有 **7 条**（量出来的，不是估的），
// 其中 **6 条是属性偷取**、1 条是增益偷取（饿鬼「臭馒头」，不属这里）。数量小、语义闭合、可量化。
//
// ★★ 「偷取X%攻击」到底是什么意思 —— 这不是猜的，KB 里有三处**互相印证**的写法：
//   ① 烬天玉藻前「噬魂」：「偷取场上全体3%攻击力…**偷取总值**不超过自身初始攻击60%…阵亡时，将偷取的攻击**全部归还**」
//      —— 「总值」是**绝对量**的累加，而且上限相对的是**自己**的初始攻击 ⇒ 偷来的量是加在自己身上的数值；
//   ② 盗人神「盗亦有道」：可偷取的属性包含 15%攻击、20%防御、15%暴击、**10点速度** ——
//      同一句里百分比与"点"混用 ⇒ 偷的是一个**量**（速度用点数，其余用百分比换算成量）；
//   ③ 六条里三条写「持续N回合」，一条写「阵亡时…归还」 —— 偷是**借**，到期/阵亡要还。
//   ⇒ 默认口径 = TRANSFER_FROM_TARGET（从目标当前属性里取走一个绝对量，原样加到偷取者身上，守恒）。
//   备选口径 RATE_SWAP（双方各按**自己**面板的百分比变化，不守恒）**也实现**，
//   但只用于敏感性测量 —— 默认不选它，因为它与①②直接冲突。
//
// ★ 实现方式刻意复用**已有的状态机制**，不新增战斗状态字段：
//   偷取者身上挂一个增益状态、被偷者身上挂一个减益状态，两者**同一个来源 id、同一个持续回合**，
//   各自带一个 FIXED 修正（+X / −X）。于是：
//     · 到期归还 = 状态到期（既有机制，不用写新代码）；
//     · 存档/续跑 = 状态本来就会序列化（G0 不用改）；
//     · 阵亡归还 = restoreStats()（这一轮新增，接在死亡路径上）。
import { StatusCategory } from "./types.ts";
import { StatusBook } from "./status.ts";
import type { StatusDef } from "./status.ts";
import type { Entity } from "./entity.ts";
import { STEAL_BASIS } from "./policies.ts";
// ★ 第 191 轮：取整统一走 GameMath（lint-rounding 的规则；roundAt 与 Math.round 逐位等价，只是多了一个名字）
import { GameMath } from "./gamemath.ts";

/** 中文属性名 → 引擎字段。**只收 KB 原文里真的出现过的**六种（多一种都要有出处）。 */
export const STEAL_PROPS: Record<string, string> = {
  "攻击": "atk", "攻击力": "atk", "防御": "def", "防御力": "def",
  "速度": "spd", "暴击": "cri", "暴击伤害": "crid", "生命": "hp", "效果命中": "efh",
};
export const PROP_CN: Record<string, string> = {
  atk: "攻击", def: "防御", spd: "速度", cri: "暴击", crid: "暴击伤害", hp: "生命", efh: "效果命中",
};

export interface StatStealOption { prop: string; ratio: number | null; flat: number | null }
export interface StatStealSpec {
  /** 单个选项（普通情况）；随机偷取时用 options */
  prop?: string; ratio?: number | null; flat?: number | null;
  options?: StatStealOption[];
  random?: boolean;
  duration: number;
  probability: number | null;
  maxPerTarget?: number | null;
  side?: "ENEMY" | "ALLY";
  /** ★ 第 105 轮：「同时间内只能对一个目标生效」⇒ 偷新目标时把旧目标那笔还回去 */
  oneTargetOnly?: boolean;
  /**
   * ★★★ 第 107 轮：**总量上限**（相对**自身初始攻击**的比例）——
   *   原文「偷取总值不超过自身初始攻击60%」（噬魂）。与 maxPerTarget（每个目标最多 N 次）是两把不同的尺子。
   */
  capTotalRatio?: number;
  /** ★ 第 107 轮：受害者范围的来源（DEFAULT = 原文写「场上全体」，运行时可读作敌方全体） */
  scopeSource?: "DEFAULT" | "CLAUSE";
  evidence: string;
}

/**
 * ★ 口径名与口径表都在 kernel/policies.ts（STEAL_BASIS / StealPolicyConfigs）——
 *   这里只引用，不重抄一份，原因见 policies.ts 的注释（g38 的重复词表普查会抓）。
 */

const UP = "steal_up_", DOWN = "steal_down_";
export const STEAL_STATUS_PREFIXES = [UP, DOWN];

function mkDef(kind: "up" | "down", prop: string, evidence: string): StatusDef {
  const up = kind === "up";
  return {
    id: (up ? UP : DOWN) + prop,
    name: (up ? "偷取·" : "被偷取·") + (PROP_CN[prop] ?? prop),
    category: up ? StatusCategory.BUFF_MARK : StatusCategory.DEBUFF_MARK,
    /** KB 没写「不可驱散」⇒ 按可驱散/可解除（与其余状态一致；这是一条**默认**，写在注释里不藏着） */
    dispellable: true, removable: true,
    preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false,
    durationPolicy: "SOURCE_TURN",
    desc: evidence,
  };
}

/** 随机偷取时怎么选：交给 RNG（「随机偷取…属性」是 KB 原文写的，不是我们加的随机性） */
function pickOption(spec: StatStealSpec, battle: any, actorId: number, targetId: number): StatStealOption | null {
  const opts = spec.options?.length ? spec.options : (spec.prop ? [{ prop: spec.prop, ratio: spec.ratio ?? null, flat: spec.flat ?? null }] : []);
  if (!opts.length) return null;
  if (opts.length === 1 || !spec.random) return opts[0];
  const tag = "steal_pick:" + actorId + ":" + targetId;
  battle.rng?.expect?.(tag);
  const i = Math.min(opts.length - 1, Math.floor((battle.rng?.next?.() ?? 0) * opts.length));
  return opts[i];
}

/**
 * 执行一次属性偷取。**唯一产生者**（注册表 effects.ts 的 Restore 条指向这里）。
 * 返回 applied=false 时一定带 reason —— 静默失败是这个项目最忌讳的东西。
 */
export function applyStatSteal(battle: any, actor: Entity, target: Entity, spec: StatStealSpec):
  { applied: boolean; reason?: string; prop?: string; toTarget?: number; toActor?: number } {
  const basis = battle?.policies?.steal?.basis ?? STEAL_BASIS.TRANSFER;
  const o = pickOption(spec, battle, actor.id, target.id);
  if (!o) return { applied: false, reason: "NO_SPEC" };
  const prop = o.prop;
  /**
   * ★★ 上限要数**效果条数**，不是状态条数：同一个 def id + 同一个来源会被 addStatus **合并成一个状态**
   *   （层数/效果累加）。第一版数状态，于是「每个目标最多偷取3次」永远只算 1 次 —— 上限形同虚设。
   */
  const existing = target.statuses.filter((s: any) => s.def.id === DOWN + prop && s.sourceId === actor.id)
    .reduce((n: number, s: any) => n + (s.effects?.length ?? 0), 0);
  if (spec.maxPerTarget != null && existing >= spec.maxPerTarget) return { applied: false, reason: "MAX_PER_TARGET" };
  const targetCur = target.prop(prop);
  let amount = o.flat ?? (o.ratio ?? 0) * targetCur;
  /**
   * ★★★ 第 107 轮：**总量上限**。「偷取总值不超过自身初始攻击60%」——
   *   上限读的是**初始攻击**（base.atk），已偷的总量读的是偷取者身上那些 up 状态（存档字段 ⇒ 续跑也算得对）。
   *   超出时**不是整笔拒绝**，而是把这一笔**削到剩余额度**（原文说的是"总值不超过"，不是"超过就不偷"）。
   */
  let capped = false;
  if (spec.capTotalRatio) {
    const cap = spec.capTotalRatio * (actor.base.atk ?? 0);
    const already = actor.statuses.filter((s: any) => String(s.def.id).startsWith(UP))
      .flatMap((s: any) => s.effects ?? []).reduce((n: number, ef: any) => n + Number(ef.value ?? 0), 0);
    const room = cap - already;
    if (!(room > 0)) return { applied: false, reason: "CAP_TOTAL" };
    if (amount > room) { amount = room; capped = true; }
  }
  /**
   * ★ 两种口径的差别**只在这一行**：TRANSFER 拿的是目标的量（守恒），RATE_SWAP 拿的是偷取者自己的比例。
   *   把它们写在一起，是为了让"默认档换掉会发生什么"是可以被测出来的，而不是靠读注释相信。
   */
  const toTarget = Math.max(0, amount);
  const toActor = basis === STEAL_BASIS.RATE_SWAP ? Math.max(0, o.flat ?? (o.ratio ?? 0) * actor.prop(prop)) : toTarget;
  if (!(toTarget > 0) && !(toActor > 0)) return { applied: false, reason: "ZERO_AMOUNT" };
  const duration = spec.duration > 0 ? spec.duration : 1;
  const upDef = mkDef("up", prop, spec.evidence), downDef = mkDef("down", prop, spec.evidence);
  // ★ 第 98 轮的教训：合成的状态定义必须进 StatusBook，否则存档恢复读不到它。
  if (!StatusBook.has(upDef.id)) StatusBook.set(upDef.id, upDef);
  if (!StatusBook.has(downDef.id)) StatusBook.set(downDef.id, downDef);
  actor.addStatus(upDef, actor.id, 1, duration, [{ prop, value: toActor, mode: "FIXED" }]);
  target.addStatus(downDef, actor.id, 1, duration, [{ prop, value: -toTarget, mode: "FIXED" }]);
  /**
   * ★★★ 第 105 轮：「同时间内只能**对一个目标**生效」（首无「冥火」原文）——
   *   偷新目标之前，把**其他目标**身上由同一个偷取者留下的借据还掉（借据是按 prop 配对的：
   *   一个 prop 一份 up 状态、每个受害目标一份 down 状态）。
   */
  if (spec.oneTargetOnly) {
    const returned = returnStealsExcept(battle, actor.id, target.id);
    if (returned) battle?.trace?.push?.({ t: "STEAL_RETURN", from: actor.id, keep: target.id, count: returned, reason: "NEW_TARGET", note: "「同时间内只能对一个目标生效」⇒ 旧目标的那笔先还掉" });
  }
  battle?.trace?.push?.({
    t: "STAT_STEAL", src: actor.id, dst: target.id, prop, cn: PROP_CN[prop] ?? prop,
    toTarget: GameMath.roundAt(toTarget * 100, "STEAL_REPORT") / 100, toActor: GameMath.roundAt(toActor * 100, "STEAL_REPORT") / 100,
    duration, basis, targetBefore: GameMath.roundAt(targetCur * 100, "STEAL_REPORT") / 100,
    conservation: GameMath.roundAt((toActor - toTarget) * 100, "STEAL_REPORT") / 100,
    // ★ 第 107 轮：两种情况必须在事件里看得见 —— 被总量上限削过、以及"场上全体"这个默认读法
    ...(capped ? { capped: true, cap: spec.capTotalRatio } : {}),
    ...(spec.scopeSource ? { scopeSource: spec.scopeSource } : {}),
  });
  return { applied: true, prop, toTarget, toActor };
}

/**
 * 归还：把某个来源（通常是阵亡的偷取者）留下的**所有**偷取状态一次性还回去。
 * 名字与注册表里的 producer 一致（effects.ts 的 Restore 条写的就是 restoreStats）。
 */
export function restoreStats(battle: any, ownerId: number, reason = "RETURN"): number {
  let n = 0;
  for (const e of battle.allEntities()) {
    for (const st of [...e.statuses]) {
      const id = String(st.def.id);
      if (!STEAL_STATUS_PREFIXES.some(p => id.startsWith(p))) continue;
      if (st.sourceId !== ownerId) continue;
      if (e.expireStatus(st)) {
        n++;
        battle?.trace?.push?.({ t: "STEAL_RETURN", id: e.id, status: id, from: ownerId, reason });
      }
    }
  }
  return n;
}

/**
 * ★★ 「增益 / 减益 / 任意」这组取值**只声明一次**（就在这里）。
 *   第 104 轮第一版在编译器的 IR 里又写了一遍，词汇普查立刻抓到一组新的重复取值（[ANY,BUFF,DEBUFF]）——
 *   与第 103 轮 trigger/returnOn 是同一个坑：**同一组取值写两遍 = 改一处忘一处**。
 */
export type BuffWhat = "BUFF" | "DEBUFF" | "ANY";

export interface BuffStealSpec { buffSteal: { count: number; what: BuffWhat }; evidence?: string }

/**
 * ★★★ 第 104 轮：**增益偷取**（「偷取1个增益状态」）—— 把目标身上的一个状态**搬**到偷取者身上。
 *
 * 与属性偷取的三处差别（都是原文决定的，不是我挑的）：
 *   ① **不归还**：原文只写"偷取"，没有"持续N回合"也没有"归还"⇒ 不建借据、不做到期；
 *   ② 搬的是**整个状态**（含层数与剩余回合）⇒ 用 addStatus 重建而不是加修正值；
 *   ③ 候选的挑选顺序 KB 没写 ⇒ 沿用**驱散**那条已有的默认（挂载顺序）并在事件里写明依据。
 *
 * ★ 来源 id（sourceId）**保持原样**：buff 的时长口径是"按来源的回合算"（官方[15]），
 *   把它改成偷取者会让剩余回合跟着换人算 —— 那是一条没有出处的改动，所以不动它、并在这里写明。
 */
export function stealBuff(battle: any, actor: Entity, target: Entity, spec: BuffStealSpec):
  { applied: boolean; reason?: string; stolen: string[] } {
  const what = spec.buffSteal.what;
  const cands = target.statuses.filter((s: any) => {
    if (what === "BUFF" && !String(s.def.category).startsWith("BUFF")) return false;
    if (what === "DEBUFF" && !String(s.def.category).startsWith("DEBUFF")) return false;
    return s.def.dispellable !== false;   // 不可驱散的搬不走（与驱散同一条判据）
  });
  if (!cands.length) return { applied: false, reason: "NO_CANDIDATE", stolen: [] };
  const picked = cands.slice(0, Math.max(1, spec.buffSteal.count));
  const stolen: string[] = [];
  for (const st of picked) {
    const snapshot = { def: st.def, sourceId: st.sourceId, stacks: st.stacks, remaining: st.remaining, effects: (st.effects ?? []).map((e: any) => ({ prop: e.prop, value: e.value, mode: e.mode })) };
    const gone = target.dispel(st.def.id);
    if (!gone) continue;
    actor.addStatus(snapshot.def, snapshot.sourceId, snapshot.stacks, Math.max(1, snapshot.remaining), snapshot.effects);
    stolen.push(st.def.id);
  }
  if (!stolen.length) return { applied: false, reason: "TRANSFER_FAILED", stolen: [] };
  battle?.trace?.push?.({
    t: "STATUS_STEAL", src: actor.id, dst: target.id, count: stolen.length, statuses: stolen,
    order: "挂载顺序（KB 未写挑选优先级 ⇒ 沿用驱散那条默认）",
    sourceKept: "状态的 sourceId 保持原样：时长按来源回合算（官方[15]），换人算没有出处",
  });
  return { applied: true, stolen };
}

/**
 * ★★★ 第 105 轮：把"除了某个受害目标之外"的偷取借据全部还掉（「同时间内只能对一个目标生效」）。
 *   配对规则：down 状态在受害目标身上（sourceId = 偷取者），up 状态在偷取者身上；
 *   某个 prop 的 up 只有在**没有任何目标**还挂着对应 down 时才撤 —— 否则会把还在生效的那笔一起还掉。
 */
export function returnStealsExcept(battle: any, actorId: number, keepVictimId: number): number {
  let n = 0;
  const actor: Entity | undefined = battle.allEntities().find((e: Entity) => e.id === actorId);
  if (!actor) return 0;
  for (const e of battle.allEntities()) {
    if (e.id === keepVictimId) continue;
    for (const st of [...e.statuses]) {
      const id = String(st.def.id);
      if (!id.startsWith(DOWN) || st.sourceId !== actorId) continue;
      const prop = id.slice(DOWN.length);
      if (e.expireStatus(st)) {
        n++;
        /**
         * ★★ 偷取者身上那条 up 状态是**按 prop 合并**的（addStatus 同 def + 同来源就合并层数/效果），
         *   所以"还掉某个目标的那一份"不能整条删掉 —— 必须把**还在生效的那部分重新算一遍**。
         *   第一版直接整条 expire（还判断了 stillOwed），于是"另一个目标还在被偷、属性却已经还回去了"，
         *   而且 up 状态整条消失（g60 的两条断言当场红）。
         */
        /**
         * ★★ 注意符号：受害目标身上的那份是**负数**（-X），偷取者身上那份是**正数**（+X）。
         *   第一版把受害侧的负数直接搬到了 up 状态上，于是"还掉旧目标"之后
         *   偷取者**倒扣**了一份属性（g60 报 upTotal=-774.6 / bLost=774.6 当场抓到）。
         */
        const downSum = battle.allEntities()
          .flatMap((x: Entity) => x.statuses.filter((s: any) => s.def.id === DOWN + prop && s.sourceId === actorId))
          .flatMap((s: any) => s.effects ?? [])
          .reduce((acc: number, ef: any) => acc + Number(ef.value ?? 0), 0);
        const remaining = -downSum;   // 镜像：受害侧是 -X ⇒ 偷取侧是 +X
        for (const up of [...actor.statuses]) {
          if (up.def.id === UP + prop && up.sourceId === actorId) actor.expireStatus(up);
        }
        if (Math.abs(remaining) > 1e-9) {
          actor.addStatus(mkDef("up", prop, "「同时间内只能对一个目标生效」⇒ 按剩余借据重算"), actorId, 1, 99999, [{ prop, value: remaining, mode: "FIXED" }]);
        }
        battle?.trace?.push?.({ t: "STEAL_RETURN", id: e.id, status: id, from: actorId, reason: "NEW_TARGET", prop, remaining });
      }
    }
  }
  return n;
}

/** 观测用：某来源此刻偷了多少（Inspector / 测试用）。 */
export function stolenBy(battle: any, ownerId: number): Array<{ id: number; prop: string; amount: number }> {
  const out: Array<{ id: number; prop: string; amount: number }> = [];
  for (const e of battle.allEntities()) {
    for (const st of e.statuses) {
      const id = String(st.def.id);
      if (!STEAL_STATUS_PREFIXES.some(p => id.startsWith(p))) continue;
      if (st.sourceId !== ownerId) continue;
      for (const ef of st.effects ?? []) out.push({ id: e.id, prop: String(ef.prop), amount: Number(ef.value) });
    }
  }
  return out;
}
