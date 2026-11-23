// kernel/ally-guard.ts — ★★★ 第 131 轮：**替友方拦截致命伤**
//
// 由来：三类拦截点里，前两类已经有了执行点 ——
//   ① 状态自带的免死（CompiledBuff.preventsLethal → kernel/damage.ts 的 findPreventLethal）；
//   ② 自身的 ON_LETHAL 形态（第 130 轮接线，kernel/battle.ts 的 resolveLethal）。
//   第三类一直只躺在账上：**「自身在场时，处于[buff_X]的友方目标受到致命伤害将剩余1点生命」**
//   （KB：伊邪那美「神赐之吻」）。它写在**主动技能**的原文里（cost=2），被动运行时只收 cost<0，
//   所以它既不是被动、也不是状态字段 —— 它是**站在场上的常驻条款**。
//
// 这一轮把它接到 `EV.DEATH_PREVENTION` 上：那个事件码第 91 轮就登记了、派发点也一直在
//   （kernel/battle.ts 的 resolveLethal），却**从来没有订阅者**（探针实测）。
//   现在它有了第一个生产者 —— 事件语义（"有人要把这一击拦下来"）第一次真的被用到。
//
// ★ 次数上限**必须真的执行**（与第 78 轮层数封顶同一条判据），否则就是多算：
//   · 「目标下回合开始前至多触发1次」⇒ 每个目标每个"自己的回合窗口"最多 1 次，
//     窗口在**目标自己的回合开始**时清空（battle.ts 的 runTurnInner 顶部）；
//   · 「被再次施加毁灭前至多累计触发3次」⇒ 累计计数，状态被**重新施加**时清零
//     （Entity.eventSink 的 STATUS_ADD，见 battle.ts 的 installEntitySinks）。
//   ★ 两份计数都记在**被拦者**的 notes 里 —— notes 是存档字段，暂停/续跑不会把次数清零。
import type { Entity } from "./entity.ts";
import { EV } from "./types.ts";

export interface AllyGuardSpec {
  statusRef: string;
  requireSelfOnField: boolean;
  keep: "ONE";
  perTurnMax: number | null;
  totalMax: number | null;
  resetOn: "STATUS_REAPPLY" | null;
  clause?: string;
}

/**
 * **这次死亡适不适用这条拦死条款** —— 唯一的判据实现（订阅处理器与诊断都调它）。
 *
 * 四个条件缺一不可，全部来自原文：
 *   ① 「自身在场时」：拥有者活着、且**没有离场**（形态期间本体不在场）；
 *   ② 拦的**不是自己**（「友方**目标**」——伊邪那美这条的承受者写的是队友）；
 *   ③ 目标身上**带着那个状态**（[buff_X]）；
 *   ④ 条款自己写在谁的技能里（`spec` 由调用方给出，见 installAllyGuards）。
 */
export function guardApplies(owner: Entity, spec: AllyGuardSpec, target: Entity): boolean {
  if (!owner.alive) return false;
  if ((owner.notes ?? []).some((n: string) => n.startsWith("offField:form:"))) return false;
  if (target.id === owner.id) return false;
  return (target.statuses ?? []).some((s: any) => String(s.def?.id) === spec.statusRef);
}

const turnKey = (ownerId: number) => "allyGuardTurn:" + ownerId;
/**
 * 计数记成 `allyGuardCount:<拥有者id>:<状态id>:<次数>`。
 * ★ 状态 id 必须**进键**：清零的判据是「**这个**状态被再次施加」（原文：「被再次施加毁灭前…」），
 *   而状态生产点（Entity.eventSink）只知道被施加的是哪一个状态 —— 不把状态 id 写进键，
 *   就会出现"加任何状态都把计数清零"这种**多算**（第一版正是这样，写的时候就想清楚）。
 */
const countKey = (ownerId: number, statusRef: string) => "allyGuardCount:" + ownerId + ":" + statusRef;
const numOf = (e: Entity, ownerId: number, statusRef: string): number => {
  const pre = countKey(ownerId, statusRef) + ":";
  const hit = (e.notes ?? []).find((n: string) => n.startsWith(pre));
  return hit ? Number(hit.slice(pre.length)) || 0 : 0;
};

/** 目标自己的回合开始了 ⇒ 它的"本回合窗口"重新开始（「下回合开始前至多触发1次」） */
export function clearAllyGuardWindow(target: Entity): number {
  const before = (target.notes ?? []).filter((n: string) => n.startsWith("allyGuardTurn:")).length;
  target.notes = (target.notes ?? []).filter((n: string) => !n.startsWith("allyGuardTurn:"));
  return before;
}

/**
 * 状态被重新施加 ⇒ 该状态的累计计数清零（「被再次施加毁灭前至多累计触发3次」）。
 * @param statusRef 只清**这一个状态**的计数（不给 = 清全部；测试与调试用）
 */
export function resetAllyGuardCounts(target: Entity, statusRef?: string): number {
  const keep: string[] = [];
  let n = 0;
  for (const note of (target.notes ?? []) as string[]) {
    const isCount = note.startsWith("allyGuardCount:");
    const segs = isCount ? note.split(":") : [];
    const mine = !statusRef || segs[2] === statusRef;
    if (isCount && mine) { n++; continue; }
    keep.push(note);
  }
  target.notes = keep;
  return n;
}

/**
 * 拦下这一击：把目标留在 1 点生命。
 * ★ 与"免死"（findPreventLethal）落的是同一种结果，但**来源不同**（那是目标自己身上的状态字段，
 *   这是同队某个人的常驻条款）—— 所以 trace 与事件都要分开记，Theater 才说得清"是谁救的"。
 */
export function applyAllyGuard(battle: any, target: Entity, owner: Entity, spec: AllyGuardSpec): { prevented: boolean; reason?: "PER_TURN_LIMIT" | "TOTAL_LIMIT" } {
  const tag = (extra: Record<string, unknown> = {}) =>
    battle?.trace?.push?.({ t: "ALLY_GUARD", target: target.id, owner: owner.id, status: spec.statusRef, clause: spec.clause ?? null, ...extra });

  /**
   * 两份计数都是"**当前值**"，不是"流水"：写之前先把同键的旧条目删掉。
   * ★ 第一版是直接 push —— 于是累计计数永远停在第一次的值（探针实测：第 4 次致命伤害
   *   本该被"累计至多3次"挡下，却照样拦住了；多算一步，而且不会报错）。
   */
  const setNote = (prefix: string, value: string) => {
    target.notes = (target.notes ?? []).filter((n: string) => !n.startsWith(prefix));
    target.notes.push(prefix + value);
  };
  const usedThisWindow = (target.notes ?? []).filter((n: string) => n.startsWith(turnKey(owner.id) + ":")).length;
  if (spec.perTurnMax !== null && usedThisWindow >= spec.perTurnMax) {
    battle?.trace?.push?.({ t: "ALLY_GUARD_BLOCKED", target: target.id, owner: owner.id, reason: "PER_TURN_LIMIT", limit: spec.perTurnMax, used: usedThisWindow });
    return { prevented: false, reason: "PER_TURN_LIMIT" };
  }
  const total = numOf(target, owner.id, spec.statusRef);
  if (spec.totalMax !== null && total >= spec.totalMax) {
    battle?.trace?.push?.({ t: "ALLY_GUARD_BLOCKED", target: target.id, owner: owner.id, reason: "TOTAL_LIMIT", limit: spec.totalMax, used: total });
    return { prevented: false, reason: "TOTAL_LIMIT" };
  }
  const hpBefore = target.hp;
  if (spec.keep === "ONE") target.hp = 1;
  target.hpZero = false;
  target.alive = true; target.dead = false;
  setNote(turnKey(owner.id) + ":", "used");
  setNote(countKey(owner.id, spec.statusRef) + ":", String(total + 1));
  tag({ hpBefore, hpAfter: target.hp, usedThisWindow: usedThisWindow + 1, totalUsed: total + 1 });
  /** ★ 走事件总线（G1）：Theater/Inspector 与被动运行时都看得见"这一击被队友拦了" */
  battle?.queueEvent?.(EV.DEATH_PREVENTION,
    { battle, entity: target, owner, status: spec.statusRef, kind: "ALLY_GUARD", hpAfter: target.hp }, target.id, target.teamId);
  return { prevented: true };
}

/**
 * 给所有"带着这种条款"的单位挂上 `EV.DEATH_PREVENTION` 订阅。
 * ★ **不受被动策略控制**：它写在主动技能原文里（与 ON_LETHAL 形态同一类常驻条款），
 *   所以装配路径无条件调用它 —— 否则默认档下这条原文永远不生效，而 Fidelity 又已经说它有执行点了。
 */
export function installAllyGuards(battle: any, entities: Entity[]): Array<{ entityId: number; skill: string; statusRef: string }> {
  const installed: Array<{ entityId: number; skill: string; statusRef: string }> = [];
  for (const e of entities) {
    for (const sk of (e.skills ?? []) as any[]) {
      const g: AllyGuardSpec | undefined = sk?.ir?.allyGuard;
      if (!g) continue;
      const id = "allyGuard:" + e.id + ":" + sk.name;
      /**
       * ★★ 幂等：同 id 已经在表里就跳过。
       *   装配路径与**恢复路径**共用 attachRuntime（apps/web/src/engine/assemble.ts），
       *   而 bus.register 不去重 —— 不判一下，恢复出来的战斗会挂两份处理器，
       *   同一次致命伤害被拦两次（第二次是空转，但计数会多走一格）。
       */
      if (battle.bus.handlers.some((h: any) => h.id === id)) continue;
      battle.bus.register({
        id,
        ownerId: e.id,
        code: EV.DEATH_PREVENTION,
        range: "ALL",
        priority: -10,          // 拦死要**早于**其它免死判定（先救下来，再谈别的拦截点）
        passive: false,         // ★ 不是被动
        /**
         * ★ 刻意**不写 source**：那条字段的语义是"被哪一类封印挡"（PASSIVE / SOUL），
         *   而这一条是**技能原文里的常驻条款**（伊邪那美「神赐之吻」）——
         *   "被动失效"不该关掉它（原文没有这种从属关系）。不写 = 不受封印影响（kernel/events.ts 的注）。
         */
        fn: async (ctx: any) => {
          const t: Entity | undefined = ctx?.target;
          /** ★ 判据只有一处：guardApplies（见它的注）。处理器不再自己抄一遍四个条件。 */
          if (!t || !guardApplies(e, g, t)) return;
          const r = applyAllyGuard(battle, t, e, g);
          if (r.prevented) ctx.prevented = true;                  // 唯一生产者：resolveLethal 见到它就 return
        },
      });
      installed.push({ entityId: e.id, skill: sk.name, statusRef: g.statusRef });
    }
  }
  return installed;
}
