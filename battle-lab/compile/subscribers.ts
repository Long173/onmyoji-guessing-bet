// compile/subscribers.ts — ★★★ 第 133 轮：**事件总线订阅的唯一安装点**
//
// 由来（两次同类事故的记录）：
//   · 第 93 轮：被动运行时只装在网页那条装配路径上 ⇒ CLI / monte-carlo 基线那条路径里
//     `policies.passives` **只是一句声明**（发现方式是两个本该校验差别的数字完全相同）；
//   · 第 132 轮：御魂与被动只装在**装配**路径上、**恢复**路径不装 ⇒ "存档前在跑、续跑后消失"；
//     同一轮还发现替友方拦死也没装到恢复路径上（第 131 轮）。
//
// 三次都是同一句话：**"装上什么"必须只有一个实现**。这个文件就是那一处：
//   · apps/web/src/engine/assemble.ts 的 attachRuntime（网页装配 + 恢复）
//   · battle-lab/soul/guessing-match.ts 的 assembleGuessingMatch（Node 侧参考装配 / 基线）
// 两条路径都调 `installSubscribers`，顺序也由这里定（默认 priority 是 REGISTRATION_ORDER，
// 同优先级事件的先后由**注册顺序**决定 ⇒ 顺序是行为的一部分，不能各写各的）。
//
// ★ 三种订阅都**不受被动策略控制**的只有替友方拦死与御魂；被动运行时由 policies.passives 决定
//   （默认 NOT_EXECUTED ⇒ 注册 0 个处理器，默认路径逐位不变）。
// ★ 缺知识库时**明确留痕**（SOUL_STATE_UNAVAILABLE），而不是安静地少装一套。
import { installSoulEffects } from "../soul/effect-system.ts";
import { battleEffectsOf } from "../soul/effects.ts";
import { installPassiveSkills } from "./passive-runtime.ts";
import type { PassiveInstallReport } from "./passive-runtime.ts";
import { installAllyGuards } from "../kernel/ally-guard.ts";
// ★★★ 第 187 轮：消耗型换命（石长姬「磐长纪」）—— 与替友方拦死同型，也装在**这一处**
import { installLethalConsumes } from "../kernel/lethal-consume.ts";
import { tipsTable } from "./tips.ts";
// Betting-mode (MAX) turn-end mechanics: 饭笥 储备粮 gain, 金鱼姬 鱼之怒 counter (no-op in BASE mode)
import { installBettingSubscribers } from "./betting-mechanics.ts";

/** 安装订阅需要的知识库切片（两条装配路径给的是同一个 bundle / 同一套 KB） */
export interface SubscriberKit {
  /** 御魂战斗效果的编译表（id → IR） */
  soulBook?: Map<number, any> | null;
  /** 御魂定义（id → SoulDef） */
  soulDefs?: Map<number, any> | null;
  /** [tips_N] 占位符表（不解析就会把"40% 概率"看成"无条件"） */
  tipsMap?: Map<string, any> | null;
}

export interface SubscriberReport {
  soul: ReturnType<typeof installSoulEffects> | null;
  passive: PassiveInstallReport | null;
  allyGuard: Array<{ entityId: number; skill: string; statusRef: string }>;
  /** ★★★ 第 187 轮：装上的**消耗型换命**（石长姬那一类：花掉一朵凝炼的生命换回一条命） */
  lethalConsume: Array<{ entityId: number; skill: string; statusRef: string; total: number; perStack: number }>;
  /** 御魂没能重装时的原因（null = 装上了或本来就没有御魂） */
  soulUnavailable: string | null;
  /** Betting-mode mechanics installed (always empty in BASE mode) */
  betting?: Array<{ entityId: number; mechanic: string }>;
}

/**
 * 把三种订阅装到这一场战斗上。**装配路径与恢复路径都必须调它**（订阅是函数，不进 BattleState）。
 *
 * 顺序：御魂 → 被动 → 替友方拦死。这个顺序**沿用历史**（第 70 轮被动接在御魂之后、
 * 第 131 轮替友方拦死接在最后），改顺序要先举证 —— 它会影响同优先级事件的先后。
 */
export function installSubscribers(battle: any, kit?: SubscriberKit | null): SubscriberReport {
  const entities: any[] = battle.allEntities();
  /** ① 御魂：refs 由**实体自己的 soulIds** 推导（恢复时没有 resolution 对象可读，而 soulIds 随存档回来） */
  let soul: ReturnType<typeof installSoulEffects> | null = null;
  let soulUnavailable: string | null = null;
  if (kit?.soulDefs && kit?.soulBook) {
    const refs = entities.flatMap((e: any) => battleEffectsOf(e.soulIds ?? [], kit.soulBook as any, kit.soulDefs as any));
    soul = refs.length ? installSoulEffects(battle, refs, kit.soulDefs as any) : null;
  } else {
    soulUnavailable = kit ? "KIT_INCOMPLETE" : "NO_KIT";
    battle.trace?.push?.({
      t: "SOUL_STATE_UNAVAILABLE", reason: soulUnavailable,
      note: "调用方没有给知识库（soulBook / soulDefs）⇒ 御魂战斗效果无法安装或重装",
    });
  }
  /** ② 被动运行时：模式取自 policies（入档），tips 取自 kit 或模块级表 */
  const passive = installPassiveSkills(battle, entities, {
    mode: battle.policies?.passives?.mode ?? "OFF",
    tips: (kit?.tipsMap ?? tipsTable()) as any,
  });
  /** ③ 替友方拦死（技能原文里的常驻条款，与被动策略无关） */
  const allyGuard = installAllyGuards(battle, entities);
  /** ★★★ 第 187 轮：消耗型换命（与替友方拦死同型；顺序也排在它之后 —— 先让队友救，再花自己的资源） */
  const lethalConsume = installLethalConsumes(battle, entities);
  /** Betting mode only (MAX): registered last so BASE handler order is unchanged */
  const betting = installBettingSubscribers(battle, entities);
  return { soul, passive, allyGuard, lethalConsume, soulUnavailable, ...(betting.length ? { betting } : {}) };
}
