// kernel/lethal-consume.ts — ★★★ 第 187 轮：**消耗型换命**（石长姬「磐长纪」）
//
// 原文：「无法被复活。战斗开始时，记录所有式神的初始属性并将自身初始生命凝炼成4朵[buff_6082_1]。
//   受到致命伤害时，消耗1朵[buff_6082_1]，获得其中的生命。」
// 这是**第四种**活下来的方式（前三种：状态自带的 preventsLethal / 替友方拦死 kernel/ally-guard.ts /
//   ON_LETHAL 形态转化）—— 它与前三种的区别是：**要花掉一个可数的资源**（一朵 = 初始生命 / 4）。
//
// 判据全部来自编译产物（SkillIR.lethalConsume，见 skill-compiler.ts 的解析）：
//   `statusRef` 要消耗哪个状态 · `perStack` 一次消耗几朵 · `total` 初始生命被凝炼成几朵。
//   ★ fail-closed：解析不出这个字段的技能**不装**（照旧按「致命伤害拦截」记未建模）。
//
// ★ 与 ally-guard 同一条纪律：**不受被动策略控制**（它写在技能原文里，是常驻条款），
//   装配路径与恢复路径都经由 compile/subscribers.ts 的同一处安装。
import type { Entity } from "./entity.ts";
import { EV } from "./types.ts";
import { GameMath } from "./gamemath.ts";

export interface LethalConsumeSpec { statusRef: string; perStack: number; total: number; clause: string }

/**
 * 一次消耗型换命：花掉 `perStack` 朵，把生命补到"那一朵里凝炼的生命"。
 * ★ 「初始生命」取**安装那一刻**的生命上限（装配发生在战斗开始之前），与原文「将自身初始生命凝炼成N朵」对齐。
 */
export function applyLethalConsume(
  battle: any, owner: Entity, spec: LethalConsumeSpec, initialMaxHp: number,
): { prevented: boolean; reason?: string; hpAfter?: number; left?: number } {
  const st = (owner.statuses ?? []).find((s: any) => String(s.def?.id ?? "") === spec.statusRef);
  const stacks = st ? Number(st.stacks ?? 0) : 0;
  if (!st || stacks < spec.perStack) {
    battle?.trace?.push?.({ t: "LETHAL_CONSUME_BLOCKED", id: owner.id, status: spec.statusRef, reason: "NO_STACK", have: stacks, need: spec.perStack, clause: spec.clause });
    return { prevented: false, reason: "NO_STACK" };
  }
  st.stacks = Math.max(0, stacks - spec.perStack);
  const perStackHp = spec.total > 0 ? initialMaxHp / spec.total : 0;
  const heal = Math.max(1, GameMath.roundAt(perStackHp * spec.perStack, "LETHAL_CONSUME_HEAL"));
  const hpBefore = owner.hp;
  owner.hp = Math.min(owner.maxHp, heal);
  owner.hpZero = false;
  owner.alive = true; owner.dead = false;
  battle?.trace?.push?.({
    t: "LETHAL_CONSUME", id: owner.id, status: spec.statusRef, consumed: spec.perStack, left: st.stacks,
    hpBefore: GameMath.display(hpBefore), hpAfter: GameMath.display(owner.hp), clause: spec.clause,
  });
  /** ★ 与 ally-guard 同一条：走事件总线（G1），Theater / Inspector / 被动运行时都看得见"这一击被换命挡下" */
  battle?.queueEvent?.(EV.DEATH_PREVENTION,
    { battle, entity: owner, owner, status: spec.statusRef, kind: "LETHAL_CONSUME", hpAfter: owner.hp },
    owner.id, owner.teamId, (id: number) => battle.teamOf(id));
  return { prevented: true, hpAfter: owner.hp, left: st.stacks };
}

/**
 * 给所有带着这种条款的单位挂上 `EV.DEATH_PREVENTION` 订阅（与 kernel/ally-guard.ts 同型）。
 * ★ 幂等：装配路径与恢复路径共用同一处安装，而 bus.register 不去重。
 */
export function installLethalConsumes(
  battle: any, entities: Entity[],
): Array<{ entityId: number; skill: string; statusRef: string; total: number; perStack: number }> {
  const installed: Array<{ entityId: number; skill: string; statusRef: string; total: number; perStack: number }> = [];
  for (const e of entities) {
    for (const sk of (e.skills ?? []) as any[]) {
      const spec: LethalConsumeSpec | undefined = sk?.ir?.lethalConsume;
      if (!spec) continue;
      const id = "lethalConsume:" + e.id + ":" + sk.name;
      if (battle.bus.handlers.some((h: any) => h.id === id)) continue;
      /** ★ 「初始生命」= 安装这一刻的生命上限（装配在战斗开始前）—— 与原文的「初始生命」对齐 */
      const initialMaxHp = Number(e.maxHp ?? 0);
      battle.bus.register({
        id, ownerId: e.id, code: EV.DEATH_PREVENTION, range: "ALL",
        /** 排在替友方拦死（-10）**之后**：先让队友有机会救，再花自己的资源 */
        priority: -5,
        passive: false,
        fn: async (hook: any) => {
          if (hook?.target?.id !== e.id || hook.prevented) return;
          const r = applyLethalConsume(battle, e, spec, initialMaxHp);
          if (r.prevented) hook.prevented = true;
        },
      });
      installed.push({ entityId: e.id, skill: sk.name, statusRef: spec.statusRef, total: spec.total, perStack: spec.perStack });
    }
  }
  return installed;
}
