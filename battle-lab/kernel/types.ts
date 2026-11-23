// kernel/types.ts — 共享类型。erasable syntax only（无 enum / 无 namespace）

export const DamageType = {
  NORMAL: "NORMAL",           // 攻击×倍率×暴击×300/(300+def)×增减伤×浮动
  INDIRECT: "INDIRECT",       // 官方[5] 不触发御魂、无法被分担、对防御0必暴
  CONDUCTION: "CONDUCTION",   // 官方[12] 不会暴击、不触发薙魂
  TRUE: "TRUE",               // 官方[18] 无视防御、不会暴击
  FIXED: "FIXED",             // 官方[28] 无视防御、不会暴击、不受增减伤影响
  FORM_DESTROY: "FORM_DESTROY", // 官方 形毁伤害：无视防御和减伤
} as const;
export type DamageType = (typeof DamageType)[keyof typeof DamageType];

/** 官方[21] 失去 ≠ 伤害；官方[20] 恢复 ≠ 治疗。四条管线必须分开。 */
export const HpMutation = {
  DAMAGE: "DAMAGE", LOSS: "LOSS", HEAL: "HEAL", RECOVER: "RECOVER",
} as const;
export type HpMutation = (typeof HpMutation)[keyof typeof HpMutation];

/** 官方[25] 状态与印记共 5 类 */
export const StatusCategory = {
  BUFF_STATE: "BUFF_STATE", BUFF_MARK: "BUFF_MARK",
  DEBUFF_STATE: "DEBUFF_STATE", DEBUFF_MARK: "DEBUFF_MARK",
  COMMON_MARK: "COMMON_MARK",
} as const;
export type StatusCategory = (typeof StatusCategory)[keyof typeof StatusCategory];

/**
 * 回合类型：鬼火条推进 / 回合开始结束触发的判定依据。
 * ★ 命名对齐 a1-4 §12（NORMAL / NEW_TURN / PSEUDO_TURN / ACTION_ONLY）。
 *   原先叫 NEW / PSEUDO / SKILL_RESOLUTION —— 与规格书不一致，读代码的人得先做一次心算翻译。
 *   非 NORMAL 的三类此前全库无人调用（grep 确认），所以这次改名是纯命名对齐，不改变任何行为。
 */
export const TurnType = {
  /** 普通回合：完整参与回合开始/结束与鬼火条推进 */
  NORMAL: "NORMAL",
  /** 额外回合（再动）：计入回合、触发回合开始/结束，但**不推进鬼火条** */
  NEW_TURN: "NEW_TURN",
  /** 伪回合（反击/协战）：既不计回合，也不推进鬼火条，也不触发回合开始/结束 */
  PSEUDO_TURN: "PSEUDO_TURN",
  /** 只结算动作（如单独的技能结算）：同上，语义上强调"只有动作没有回合" */
  ACTION_ONLY: "ACTION_ONLY",
} as const;
export type TurnType = (typeof TurnType)[keyof typeof TurnType];

export const TurnFlags: Record<TurnType, {
  countsAsTurn: boolean; advancesOrbGauge: boolean;
  triggersTurnStart: boolean; triggersTurnEnd: boolean;
}> = {
  NORMAL:      { countsAsTurn: true,  advancesOrbGauge: true,  triggersTurnStart: true,  triggersTurnEnd: true },
  NEW_TURN:    { countsAsTurn: true,  advancesOrbGauge: false, triggersTurnStart: true,  triggersTurnEnd: true },
  PSEUDO_TURN: { countsAsTurn: false, advancesOrbGauge: false, triggersTurnStart: false, triggersTurnEnd: false },
  ACTION_ONLY: { countsAsTurn: false, advancesOrbGauge: false, triggersTurnStart: false, triggersTurnEnd: false },
};

/** 旧名兼容（若仍有外部引用，行为完全一致） */
export const TurnTypeAlias = { NEW: "NEW_TURN", PSEUDO: "PSEUDO_TURN", SKILL_RESOLUTION: "ACTION_ONLY" } as const;

export const Phase = {
  CREATE: "CREATE", LOAD_RULESET: "LOAD_RULESET", SPAWN: "SPAWN", INIT_STATS: "INIT_STATS",
  PRE_BATTLE: "PRE_BATTLE", SENKI: "SENKI", START_EFFECTS: "START_EFFECTS",
  TIMELINE_START: "TIMELINE_START", BATTLE: "BATTLE", END: "END",
} as const;
export type Phase = (typeof Phase)[keyof typeof Phase];

export const EventRange = { SELF: "SELF", TEAM: "TEAM", ENEMY: "ENEMY", ALL: "ALL" } as const;
export type EventRange = (typeof EventRange)[keyof typeof EventRange];

export interface EventCode { readonly code: string }
export const EV = {
  // ★★★ 第 91 轮补登记：这两个码**一直在被派发**（kernel/battle.ts 的开局阶段），
  //   但它们**不在 EV 表里** —— 派发处写的是裸字符串 `dispatch("SOUL_START", …)`。
  //   后果有三条，都是结构性的：
  //     ① 任何**按 EV 表枚举事件码**的扫描都看不见它们（普查、词汇表、DISPATCHED_EV_CODES）；
  //     ② 「42 个码里 18 个有派发点」这个账**从一开始就是错的**（实际 44 / 20）；
  //     ③ `dispatch(EV.X)` 打错字编译不过，而 `dispatch("X")` 打错字**静默不派发**。
  //   ⇒ 补进表里，并把派发处改成 `EV.SOUL_START` / `EV.PASSIVE_START`。
  SOUL_START: "SOUL_START", PASSIVE_START: "PASSIVE_START",
  BATTLE_CREATE: "BATTLE_CREATE", PRE_BATTLE: "PRE_BATTLE", SENKI: "SENKI", BATTLE_START: "BATTLE_START",
  TIMELINE_ADVANCE: "TIMELINE_ADVANCE",
  TURN_START: "TURN_START", TURN_END: "TURN_END", ACTION_START: "ACTION_START", ACTION_END: "ACTION_END",
  SKILL_SELECT: "SKILL_SELECT", TARGET_SELECT: "TARGET_SELECT", SKILL_START: "SKILL_START", SKILL_END: "SKILL_END",
  ORB_GAUGE_ADVANCE: "ORB_GAUGE_ADVANCE", ORB_GAIN: "ORB_GAIN", ORB_OVERFLOW: "ORB_OVERFLOW", ORB_COST: "ORB_COST",
  BEFORE_HIT: "BEFORE_HIT", HIT: "HIT", RESIST: "RESIST", IMMUNE: "IMMUNE",
  BEFORE_DAMAGE: "BEFORE_DAMAGE", DAMAGE: "DAMAGE", AFTER_DAMAGE: "AFTER_DAMAGE",
  HP_LOSS: "HP_LOSS", HEAL: "HEAL", RECOVER: "RECOVER",
  SHIELD_CREATE: "SHIELD_CREATE", SHIELD_DAMAGE: "SHIELD_DAMAGE", SHIELD_BREAK: "SHIELD_BREAK",
  STATUS_ADD: "STATUS_ADD", STATUS_REMOVE: "STATUS_REMOVE", STATUS_EXPIRE: "STATUS_EXPIRE",
  /** ★ 施加概率掷骰失败（原文写「有N%概率…」而这次没中）。它**不是抵抗** —— RESIST 需要效果命中/抵抗公式，那个仍是 UNKNOWN。 */
  STATUS_MISS: "STATUS_MISS", TIMELINE_MISS: "TIMELINE_MISS",
  /** ★ 第 91 轮补登记：致死前的拦截点（battle.ts 的 lethal 路径派发）。此前同样是裸字符串。 */
  DEATH_PREVENTION: "DEATH_PREVENTION",
  LETHAL: "LETHAL", DEATH: "DEATH", KILLED: "KILLED", REVIVE: "REVIVE", TRANSFORM: "TRANSFORM",
  VICTORY_CHECK: "VICTORY_CHECK", BATTLE_END: "BATTLE_END",
} as const;
