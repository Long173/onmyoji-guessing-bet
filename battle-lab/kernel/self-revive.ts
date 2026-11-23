// kernel/self-revive.ts — ★★★ 第 129 轮：**触发式自复活**（「阵亡时…立即复活」）
//
// 由来：第 67 轮接线的是**主动复活**（我施放技能去救别人），触发式那一半一直留在未建模表里
//   （compile/unmodeled.ts 的「复活」条，WARN）。第 87 轮把条件「若拥有N层[buff_X]」建模成
//   STACK_AT_LEAST，第 129 轮又把总线改成"死亡级联事件照常投递给刚阵亡的单位"——
//   时机与条件两半都通了，缺的只剩**动作本身**：把自己拉回场上。
//
// ★ 与主动复活共用**同一条内核路径**（Battle.revive + healTarget），不另起一套：
//   原文写的都是「复活…并为其治疗生命上限N%的生命」，两个入口必须给出同一种结算
//   （先以 1 点血进场，再由治疗抬到 N% —— 见 compile/character.ts 的同一条注）。
//   ★ 治疗走哪条通道由**原文的动词**决定，不是统一处理：
//     「恢复」（九命猫 九命 的 [tips_20]）是官方[20] RECOVER —— 不受减疗/暴击/残局治疗乘区影响；
//     「治疗」（骨女 怨生）走 HEAL 通道，吃减疗。
//     两者在引擎里本就是两条管线（kernel/damage.ts 的 healTarget 参数 recover），这里如实分派。
import type { Entity } from "./entity.ts";
import { EV } from "./types.ts";
import { healTarget } from "./damage.ts";
import { GameMath } from "./gamemath.ts";

export interface SelfReviveSpec {
  /**
   * 原文「生命上限N%的生命」里的 **N 本身**（20 表示 20%）——
   * ★ 单位是**百分数**，不是比例：用的时候必须 /100。
   *   第一版探针（tools/_probe-selfrevive-run.ts）就是在这里错的：把 20 当成比例传进 healTarget，
   *   治疗量算成生命上限的 20 倍，被 HP 上限截断成"回满血" —— trace 里 healed=19999 / hpAfter=maxHp，
   *   看上去像"复活成功"，数字却是错的（一次不会报错的错）。
   */
  hpPercent: number;
  /** 原文「则消耗所有层数」—— 复活前把门槛状态整条消耗掉 */
  consumeStacks: boolean;
  /** 「若拥有N层[buff_X]」的门槛（含「N层以上」）；null = 无条件 */
  requireStacks: { statusRef: string; n: number } | null;
  /** 治疗通道：RECOVER = 官方[20] 恢复（原文写「恢复」），HEAL = 治疗 */
  channel?: "HEAL" | "RECOVER";
  /** 判定所依据的原文子句（trace 里带出来，便于逐条复核） */
  clause?: string;
}

export interface SelfReviveResult {
  fired: boolean;
  /** 没触发的原因（**每一种都要留痕**：不触发与没实现长得一样，是这个仓库反复抓的静默） */
  reason?: "NOT_DEAD" | "REVIVE_BLOCKED" | "TRANSFORMED" | "STACKS_INSUFFICIENT" | "REVIVE_REJECTED";
  hp: number;
}

/**
 * 让 `e` 在阵亡的这一刻复活自己。**幂等**：已经活着（或已经被别人拉起来）时不做任何事。
 *
 * 为什么门槛要在**这里**再读一次，而不是只靠分类器的 STACK_AT_LEAST：
 *   分类器给出的条件是"这个处理器要不要进来"的粗筛（它按文本判），而真正决定这次复活
 *   成不成立的是**死亡那一刻的层数事实**。两处读的是同一个状态、同一条门槛，
 *   但这里这次是**权威**的（它的结果进 trace）；粗筛只是省掉一次无意义的进入。
 */
export async function applySelfRevive(battle: any, e: Entity, spec: SelfReviveSpec): Promise<SelfReviveResult> {
  /**
   * ★★ 每一种留痕都**写成字面量**（`t: "SELF_REVIVE"`），不走变量拼装。
   *   理由是可机械检查：apps/web/tests/ui13-trace-vocab.ts 用**源码正则**抽出所有 trace 类型，
   *   再与 Theater Presenter 的 case 对齐 —— 第一版这里写的是 `tag(t, ...)` 辅助函数，
   *   于是这两种新 trace **对词汇闸门不可见**：既不会被要求有 Banner，也不会被报"没人渲染"。
   *   机制看不见 = 没做（第 106 轮那条闸门的原话）。抽不出类型就等于从账上消失。
   */
  if (!e.dead) return { fired: false, reason: "NOT_DEAD", hp: e.hp };
  /** 官方[3252][3342]：这两条与 Battle.revive 的守卫**同一套**（在这里先记原因，别静默返回） */
  if (e.reviveBlocked) {
    battle?.trace?.push?.({ t: "SELF_REVIVE_BLOCKED", id: e.id, clause: spec.clause ?? null, reason: "REVIVE_BLOCKED" });
    return { fired: false, reason: "REVIVE_BLOCKED", hp: e.hp };
  }
  if (e.transformed) {
    battle?.trace?.push?.({ t: "SELF_REVIVE_BLOCKED", id: e.id, clause: spec.clause ?? null, reason: "TRANSFORMED" });
    return { fired: false, reason: "TRANSFORMED", hp: e.hp };
  }

  const st = spec.requireStacks
    ? ((e.statuses ?? []).find((s: any) => String(s.def?.id ?? "") === spec.requireStacks!.statusRef) ?? null)
    : null;
  const stacks = st ? Number(st.stacks ?? 0) : 0;
  if (spec.requireStacks && stacks < spec.requireStacks.n) {
    battle?.trace?.push?.({
      t: "SELF_REVIVE_BLOCKED", id: e.id, clause: spec.clause ?? null,
      reason: "STACKS_INSUFFICIENT", need: spec.requireStacks.n, have: stacks, status: spec.requireStacks.statusRef,
    });
    return { fired: false, reason: "STACKS_INSUFFICIENT", hp: e.hp };
  }
  /**
   * 消耗层数：「则消耗所有层数，立即复活」——语序上消耗在前，所以先消耗再复活（trace 顺序与原文一致）。
   * ★ 复用 Entity.expireStatus（它内部走唯一的 recycleStatus）——否则属性加成会留在单位身上，
   *   而那正是第 121 轮在驱散路径上抓到的泄漏。
   */
  if (spec.consumeStacks && st) {
    if (e.expireStatus(st)) {
      battle?.trace?.push?.({ t: "STATUS_EXPIRE", id: e.id, status: st.def.id, name: st.def.name, stacks, reason: "SELF_REVIVE_CONSUMED" });
      battle.queueEvent(EV.STATUS_EXPIRE,
        { battle, entity: e, status: st.def.id, name: st.def.name, reason: "SELF_REVIVE_CONSUMED" }, e.id, e.teamId);
    }
  }
  const ok = await battle.revive(e, 1);
  if (!ok) {
    battle?.trace?.push?.({ t: "SELF_REVIVE_BLOCKED", id: e.id, clause: spec.clause ?? null, reason: "REVIVE_REJECTED" });
    return { fired: false, reason: "REVIVE_REJECTED", hp: e.hp };
  }

  const amount = e.maxHp * spec.hpPercent / 100;   // ★ hpPercent 是百分数（见字段注）
  const channel = spec.channel ?? "HEAL";
  const healed = await healTarget(battle, e, e, amount, channel === "RECOVER" ? { recover: true } : {});
  battle?.trace?.push?.({
    t: "SELF_REVIVE", id: e.id, clause: spec.clause ?? null,
    hpPercent: spec.hpPercent, channel, healed: GameMath.display(healed),
    hpAfter: GameMath.display(e.hp), stacks: spec.requireStacks ? stacks : null, consumed: spec.consumeStacks,
  });
  return { fired: true, hp: e.hp };
}
