// kernel/sub-cast.ts — ★★★ 第 135 轮：**触发式追加施放**（「…并对随机敌方目标施放『X』」）
//
// 由来：全库十几条子句写着「施放『X』」，而引擎里**没有"替某个单位释放另一个技能"的入口** ——
//   技能执行点只有两处：主动行动的 execute（compile/character.ts）与伪回合（Battle.runPseudoTurn）。
//   第 129 轮只把**与复活同句**的那一条记成了账（追加施放 / WARN），执行点仍然是空的。
//
// 这一轮接上：走 **Battle.runPseudoTurn**（与反击/协战同一条受控入口），守卫与反击那套同源：
//   ① **不连锁**：事件链祖先里已经有 PSEUDO_TURN ⇒ 不再触发（判据取自事件树，不进 state）；
//   ② 施放者必须活着（九命猫那条是在**复活之后**才施放的 —— 顺序由调用方保证）；
//   ③ 目标技能必须在**这个单位自己的技能表**里（按 IR id 匹配）—— 找不到就留痕跳过，不猜；
//   ④ 随机目标走 battle.rng（可复现），拿不到目标就跳过。
// ★ 鬼火照常由伪回合里的技能执行点处理（原文只在百目鬼那条写「免消耗」，其余没写 ⇒ 不替规格做决定）；
//   付不起时会走引擎既有的 SKILL_FALLBACK 路径（这条对既是"引擎的既有语义"、也会留痕）。
import type { Entity } from "./entity.ts";
import { TurnType } from "./types.ts";

export interface SubCastSpec {
  ref: string;
  /** ★ 复用 SkillIR 的目标词汇（TargetMode）—— 不再自造字面量，见 compile/skill-compiler.ts 的字段注 */
  target: "SELF" | "ENEMY_RANDOM" | "ENEMY_ONE";
  clause?: string;
  /**
   * ★★★ 第 237 轮：**免消耗施放**（原文「将免消耗施放『X』」）。
   *   语义：这次施放**跳过鬼火支付**，且**不留** ORB_PAY / ORB_COST 事件 ——
   *   留一条假的付费事件比不做更坏（Theater / Fidelity / 重放都会读到它）。
   *   ★ 本字段暂时**没有生产者**（编译器还没吐它）⇒ 行为逐位不变；
   *     生产者是 §169 的"计数器满 5 层"那条，下一轮接。
   */
  free?: boolean;
}

export interface SubCastResult {
  fired: boolean;
  reason?: "ACTOR_DEAD" | "SKILL_NOT_FOUND" | "CHAINED" | "NO_TARGET";
  skill?: string;
  target?: number | null;
}

export async function castTriggeredSkill(battle: any, actor: Entity, spec: SubCastSpec): Promise<SubCastResult> {
  const skip = (reason: NonNullable<SubCastResult["reason"]>, extra: Record<string, unknown> = {}) => {
    battle?.trace?.push?.({ t: "SUBCAST_SKIPPED", actor: actor.id, ref: spec.ref, reason, clause: spec.clause ?? null, ...extra });
    return { fired: false, reason } as SubCastResult;
  };
  if (!actor.alive) return skip("ACTOR_DEAD");
  /** ③ 目标技能必须在自己的技能表里（IR id = charId_index） */
  const skill = (actor.skills ?? []).find((s: any) => String(s?.ir?.id ?? "") === spec.ref) ?? null;
  if (!skill) return skip("SKILL_NOT_FOUND", { have: (actor.skills ?? []).map((s: any) => s?.ir?.id ?? s?.name) });
  /** ① 不连锁（与反击同一条判据：看事件链祖先里有没有伪回合） */
  const cur = battle?.bus?.currentEvent ?? null;
  const chain = cur === null ? [] : (battle.bus.ancestry?.(cur) ?? []);
  if (chain.some((n: any) => n.code === TurnType.PSEUDO_TURN)) return skip("CHAINED");
  /** ④ 目标 */
  const enemies = battle.enemiesOf(actor.teamId);
  const target: Entity | null = spec.target === "SELF" ? actor
    : spec.target === "ENEMY_RANDOM" ? (battle.rng.pick(enemies) ?? null)
    : (enemies[0] ?? null);
  if (!target) return skip("NO_TARGET");
  battle.trace.push({
    t: "SUBCAST", actor: actor.id, ref: spec.ref, skill: skill.name, target: target.id,
    clause: spec.clause ?? null, note: "触发式追加施放（走伪回合入口，与反击/协战同源）",
  });
  await battle.runPseudoTurn(actor, TurnType.PSEUDO_TURN, { skill, target, free: spec.free === true });
  return { fired: true, skill: skill.name, target: target.id };
}
