// kernel/policies.ts — ★ 四个红区集中在此。绝不猜测：未实测的一律标 UNKNOWN，
// 并强制在产物里带 policySnapshot，避免"用假设值算出的胜率"被误当成结论。
import { ResourcePolicies } from "./resource.ts";
import type { ResourcePolicy } from "./resource.ts";

export type PolicyStatus = "UNKNOWN" | "HYPOTHESIS" | "VERIFIED";

/** 红区 A：开局结算顺序 */
export interface StartupPolicy {
  id: string; status: PolicyStatus; question: string;
  /** 开局各阶段的相对顺序（拓扑排序的输入） */
  order: string[];
  evidence?: string;
}
export const STARTUP_STAGES = ["SPAWN", "INIT_STATS", "SOUL_START", "PASSIVE_START", "SENKI", "SUMMON", "FIELD", "ORB_INIT", "TIMELINE_INIT"] as const;

/**
 * ★★★ 第 92 轮：**合法为空**的开局阶段，必须在这里写明理由。
 *
 * 由来：`kernel/battle.ts` 的 `runStartupStage` 是一个 `switch (stage)`，
 * 其中 `case "SUMMON": break;` 与 `case "FIELD": break;` **什么都不做**。
 * 一个空的 case 读起来分不清是"有意"还是"忘了" —— 我这一轮就先把它读成了"未建模阶段"。
 * 查完才发现两件事**都不是**忘了：
 *
 *   · `SUMMON`：KB 里**根本没有召唤物数据**（282 条全是式神，见 §12 第 7 条）——
 *     数据边界，不是实现缺口；
 *   · `FIELD`：**没有任何技能在战斗开始时创建结界/幻境**（实测 22 个提到幻境/结界的技能里，
 *     只有 1 个与"战斗开始时"同句，而那一个是"每次创造幻境时获得1层 buff"）。
 *     结界/幻境是**战斗中**由技能创造的（辉夜姬「龙首之玉」/白藏主「梦山狐影」…），
 *     所以这个**开局阶段**本来就无事可做。
 *     ★ 真正没建模的是**结界/幻境这个机制本身**（21 个技能），那是另一件事，不该记在这个 case 上。
 *
 * ⇒ 判据：**空阶段必须在这里有理由**；没被列进来的阶段**不许为空**。
 *   tests/g53-startup-stages.ts 机械地检查这两条。
 */
export const STAGE_NOOP_REASONS: Record<string, string> = {
  SUMMON: "数据边界：KB 里没有召唤物数据（282 条全是式神），没有东西可召 —— 见 §12 第 7 条与 tests/g12 第 [4] 节",
  FIELD: "开局本就无事可做：实测没有任何技能在战斗开始时创建结界/幻境（22 个提到幻境/结界的技能里只有 1 个与「战斗开始时」同句，且那一句是「每次创造幻境时获得1层 buff」）。★ 没建模的是**结界/幻境这个机制**（21 个技能，战斗中创建），不是这个阶段",
};

export const StartupPolicies: Record<string, StartupPolicy> = {
  NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI: {
    id: "NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI", status: "HYPOTHESIS",
    question: "开局：御魂效果 -> 被动 -> 先机 -> 召唤 -> 结界 -> 鬼火 -> 行动条？",
    order: ["SPAWN", "INIT_STATS", "SOUL_START", "PASSIVE_START", "SENKI", "SUMMON", "FIELD", "ORB_INIT", "TIMELINE_INIT"],
    evidence: "无官方来源，仅按直觉排序；必须用 A 组实验推翻/确认",
  },
  SENKI_FIRST: {
    id: "SENKI_FIRST", status: "HYPOTHESIS",
    question: "开局：先机先于御魂/被动？",
    order: ["SPAWN", "INIT_STATS", "SENKI", "SOUL_START", "PASSIVE_START", "SUMMON", "FIELD", "ORB_INIT", "TIMELINE_INIT"],
    evidence: "官方[7] 只说先机‘在战斗开始时进行动作’，未说明与御魂的先后",
  },
  UNDETERMINED: {
    id: "UNDETERMINED", status: "UNKNOWN",
    question: "开局结算顺序未知 —— A 组 10 个实验的目的就是确定这个偏序",
    order: ["SPAWN", "INIT_STATS", "SOUL_START", "PASSIVE_START", "SENKI", "SUMMON", "FIELD", "ORB_INIT", "TIMELINE_INIT"],
    evidence: "不得据此产出胜率",
  },
};

/** 红区 C：击杀成立的时点 */
export interface DeathPolicy {
  id: string; status: PolicyStatus; question: string;
  /** KILLED 事件在何时发出 */
  killedAt: "HP_ZERO" | "AFTER_DEATH_RESOLUTION";
  /** 免死/转化是否在 DEATH 之前拦截 */
  preventionBeforeDeath: boolean;
  evidence?: string;
}
export const DeathPolicies: Record<string, DeathPolicy> = {
  HP_ZERO_IS_KILLED: {
    id: "HP_ZERO_IS_KILLED", status: "HYPOTHESIS",
    question: "HP<=0 即视为被击败（KILLED == HP_ZERO）？",
    killedAt: "HP_ZERO", preventionBeforeDeath: false,
    evidence: "多数游戏的做法；官方[3252]‘转化视同被击败’暗示两者可能同一时点",
  },
  DEATH_AFTER_PREVENTION: {
    id: "DEATH_AFTER_PREVENTION", status: "HYPOTHESIS",
    question: "先免死/转化判定，再决定 KILLED（HP<=0 != DEAD != KILLED）？",
    killedAt: "AFTER_DEATH_RESOLUTION", preventionBeforeDeath: true,
    evidence: "官方[3342]屹立不倒、铃彦姬致命姿态等支持这一模型",
  },
  UNDETERMINED: {
    id: "UNDETERMINED", status: "UNKNOWN",
    question: "击杀时点未知 —— C 组实验目标",
    killedAt: "AFTER_DEATH_RESOLUTION", preventionBeforeDeath: true,
    evidence: "不得据此产出胜率",
  },
};

/** 红区 D：对弈竞猜 Ruleset */
export interface GuessingRuleset {
  id: string; status: PolicyStatus; question: string;
  teamSize: number; hasOnmyoji: boolean; summonSlots: number;
  autoBattle: boolean;
  /** 残局加速：未实测，全为 null 表示"禁止假设" */
  stalemate: { damageRamp: null | ((turns: number) => number); healingReductionRamp: null | ((turns: number) => number); startTurn: null | number };
  timeout: { maxTurns: null | number; resolveBy: "ALIVE_COUNT" | "REMAINING_HP" | "UNKNOWN" };
  evidence?: string;
}
export const GuessingRulesets: Record<string, GuessingRuleset> = {
  COMMUNITY_2020_UNVERIFIED: {
    id: "COMMUNITY_2020_UNVERIFIED", status: "UNKNOWN",
    question: "对弈竞猜：初始鬼火？残局增伤/减疗曲线？超时判胜？",
    teamSize: 5, hasOnmyoji: false, summonSlots: 1, autoBattle: true,
    stalemate: { damageRamp: null, healingReductionRamp: null, startTurn: null },
    timeout: { maxTurns: null, resolveBy: "UNKNOWN" },
    evidence: "仅 2020 年攻略提到存在增伤/减疗/按存活判定；2026 数值未验证，禁止假设",
  },
  /** 非对弈竞猜环境，仅用于研究阴阳师/御灵机制时显式选用。
   *  默认的竞猜 ruleset 会拒绝阴阳师（规则 GUESSING_NO_ONMYOJI，来源 USER_CONFIRMED）。 */
  RESEARCH_WITH_ONMYOJI: {
    // status 取值必须落在 PolicyStatus = UNKNOWN|HYPOTHESIS|VERIFIED 内：
    // 原来写的 "UNVERIFIED" 不在这个联合类型里（vue-tsc 会直接报错），
    // 而这个 ruleset 的真实语义就是「不属于对弈竞猜、数值不可用于任何结论」，即 UNKNOWN。
    id: "RESEARCH_WITH_ONMYOJI", status: "UNKNOWN",
    question: "非对弈竞猜环境（允许阴阳师）—— 仅研究用，不得用于产出竞猜胜率",
    teamSize: 5, hasOnmyoji: true, summonSlots: 1, autoBattle: true,
    stalemate: { damageRamp: null, healingReductionRamp: null, startTurn: null },
    timeout: { maxTurns: null, resolveBy: "UNKNOWN" },
    evidence: "不属于对弈竞猜；阴阳师面板无可靠来源，结果不可用于任何结论",
  },
};

/**
 * ★★★ 红区 E：被动技能到底执不执行（第 70 轮）
 *
 * 由来：全库 802 个技能里 **157 个是被动**（157/277 只式神各带至少一个），
 * 而引擎此前**没有任何被动运行时** —— `bus.register` 在生产代码里只有御魂那一处。
 *
 * 第 69 轮把"能不能开工"量清楚了：98 个被动能映射到已派发的事件，
 * 其中 **62 条缺条件模型、19 条被 `[tips_N]` 占位符挡住**（40% 的概率就藏在 tips_2 里），
 * 只有 **16 条**既无条件词也无占位符 ⇒ 可以作为第一批。
 *
 * ★ 为什么默认是 OFF 而不是直接打开：典型对局的 10 个单位里 **6 个有被动**，
 *   打开它必然改变基准指纹与每一次胜率预测 —— 而这件事**没有游戏内实测支撑**。
 *   按目标 ① 的立场（引擎拒绝猜测），它必须是一个**显式的、带状态的红区策略**：
 *   默认关闭保证与历史结果逐位一致；要打开的人得自己选，而且产物里会带着这个选择。
 */
export interface PassivePolicy {
  id: string; status: PolicyStatus; question: string;
  mode: "OFF" | "PARSED_ONLY";
  evidence?: string;
}
export const PassivePolicies: Record<string, PassivePolicy> = {
  NOT_EXECUTED: {
    id: "NOT_EXECUTED", status: "HYPOTHESIS",
    question: "对弈竞猜里被动技能到底触不触发？什么时点触发？",
    mode: "OFF",
    evidence: "引擎此前没有被动运行时。关闭 ⇒ 与历史结果逐位一致（典型对局指纹 2d7c7507e18db61f 不变）",
  },
  PARSED_CANDIDATES_ONLY: {
    id: "PARSED_CANDIDATES_ONLY", status: "HYPOTHESIS",
    question: "只执行「无显式条件、也无 [tips_N] 占位符」的那 16 条被动，结果可信吗？",
    mode: "PARSED_ONLY",
    evidence: "第 69 轮分档：62 条缺条件模型、19 条被占位符挡住、16 条干净候选。开启后基准指纹必变，必须重测",
  },
};

/**
 * ★★★ 红区 F：吸血按什么算（第 93 轮）
 *
 * 由来：全库 9 个技能的文案里写着「附带 N% 吸血」，而引擎此前**没有任何回流生命的代码**
 * （compile/unmodeled.ts 把「吸血」整类记为未建模）。三尾狐「诱惑」正是典型对局里
 * 那条被拦住的被动 —— 拦它的理由就是 EFFECT（效果做不了）。
 *
 * ★ 原文只写了比例，**没写**下面这几件事，所以它们必须是红区，而不是代码里的默认值：
 *   · 基数：实际扣掉的生命（过了护盾）／本次伤害总量（含被护盾吸收的）
 *   · 减疗：吸血算「治疗」（受减疗影响）还是「恢复」（不受影响）
 *   · 多段：逐段结算／整个技能合计 —— 第 93 轮实现的是**逐段**（结算点就在伤害管线里）；
 *     合计口径需要跨段累积，**未实现**，如实写在这里，不假装它是可选项
 */
export interface LifestealPolicy {
  id: string; status: PolicyStatus; question: string;
  /** 回流生命的基数 */
  basis: "HP_DAMAGE_APPLIED" | "TOTAL_DAMAGE_BEFORE_SHIELD";
  /** 是否走「恢复」通道（不受减疗影响、不触发治疗相关效果） */
  asRecover: boolean;
  evidence?: string;
}
export const LifestealPolicies: Record<string, LifestealPolicy> = {
  APPLIED_AS_HEAL: {
    id: "APPLIED_AS_HEAL", status: "HYPOTHESIS",
    question: "吸血：按实际扣除的生命算，还是按本次伤害总量算？算治疗还是恢复？",
    basis: "HP_DAMAGE_APPLIED", asRecover: false,
    evidence: "原文只写「附带N%吸血」，三件事都没写。取最保守的一套：只回流**真的扣掉的血**（护盾挡掉的不算），走治疗通道（因此受减疗影响）。两种口径的差别只在有护盾或减疗时才显现。★ 多段：本实现是**逐段**结算（结算点就在伤害管线里，5 段 × 5 目标 = 25 次回流）；「整个技能合计一次」的口径需要跨段累积，**未实现** —— 不假装它是可选项。",
  },
  TOTAL_BEFORE_SHIELD: {
    id: "TOTAL_BEFORE_SHIELD", status: "HYPOTHESIS",
    question: "另一种口径：被护盾吸收的部分也算进吸血基数？",
    basis: "TOTAL_DAMAGE_BEFORE_SHIELD", asRecover: false,
    evidence: "「造成伤害时附带吸血」在同类游戏里常按总伤害算。两种口径都留在这里，一次游戏内观测就能定案（记进观测登记）。",
  },
};

/**
 * ★★★ 红区 G：**「免疫减益」到底免不免控制**（第 94 轮）
 *
 * 由来：338 条 buff 里 15 条写了免疫语义，其中「免疫控制效果」与「免疫减益」是两种写法。
 * 而控制效果（冰冻/眩晕/沉默…）**本身都是减益类别** —— 于是「免疫减益」是否覆盖控制，
 * 是一个只能靠观测定案的语义问题。原文没有一句话把它说清。
 *
 * ★ 这是一条**真红区**（不是实现细节）：取 true 时「免疫减益」挡下所有控制；
 *   取 false 时它只挡非控制的减益，控制照样进得来。两种取值都有断言（tests/g55 第 [2] 节），
 *   而且它会被写进 policySnapshot —— 用哪种口径算出来的结果必须看得出来。
 */
export interface ImmunePolicy {
  id: string; status: PolicyStatus; question: string;
  debuffCoversControl: boolean;
  evidence?: string;
}
export const ImmunePolicies: Record<string, ImmunePolicy> = {
  DEBUFF_COVERS_CONTROL: {
    id: "DEBUFF_COVERS_CONTROL", status: "HYPOTHESIS",
    question: "「免疫减益」是否连控制效果一起免疫？（控制效果在官方分类里属于减益）",
    debuffCoversControl: true,
    evidence: "官方[25] 把控制效果归在减益/印记两类里，所以「免疫减益」按字面应当覆盖控制；但没有任何一份官方文本明说。取 true（覆盖）并在产物里标记 —— 改取 false 只需改这一处。",
  },
  CONTROL_ONLY: {
    id: "CONTROL_ONLY", status: "HYPOTHESIS",
    question: "另一种口径：「免疫减益」只免非控制的减益，控制照进？",
    debuffCoversControl: false,
    evidence: "用于敏感性对照：若两者对胜率有影响，说明这条红区是结论相关的，必须靠观测定案。",
  },
};

/**
 * ★★★ 红区 H：**效果抵抗**怎么算（第 97 轮）
 *
 * 由来：竞猜输入是**八维面板**，而其中的「效果抵抗」在引擎里**从来没有被消费过** ——
 * `EV.RESIST` 事件码存在、**从来没有被派发**（第 27 轮普查记下，至今仍在 field-allowlist 的 knownGaps 里）。
 * 状态施加只掷一次「原文写的基础概率」，于是抵抗这个维度对结果**完全无影响**。
 *
 * ★ 公式是**红区**：官方词条表（data/kb/glossary.core.json）里只有"效果抵抗"这个词与若干数值，
 *   **没有一条**说它怎么参与判定。唯一可用的证据是一份社区模拟器实现
 *   （reference/omj_simulator-master/core/tasks/add-buff.ts:42-49），它用的是**两掷**：
 *     ① 命中：`p × (1 + 效果命中/100)`，掷不中 ⇒ 未命中；
 *     ② 抵抗：在①之上再掷一次 `p / (1 + 效果抵抗/100)`，中了 ⇒ 触发 BUFF_RES（抵抗）。
 *   ★ 那个 `p/res` 的写法本身就值得怀疑（净概率 = p²/res，而不是常见的 `p/(1+res)`），
 *     所以它只能作为**候选**，不能当结论 —— 这正是它必须是红区、而不是硬编码的原因。
 *
 * ★ 三种口径**都实现**，默认 **NONE**（= 今天的行为：不掷抵抗，RNG 序列逐位不变）；
 *   换成另两种会让每场战斗的随机数流改变（多掷一次），这是**预期**的，也是必须重测的原因。
 */
export interface ResistPolicy {
  id: string; status: PolicyStatus; question: string;
  /** NONE = 今天的语义（抵抗不参与）；SINGLE_ROLL_RATIO = p×(1+命中)/(1+抵抗) 一次掷；
   *  COMMUNITY_TWO_ROLL = 社区实现的两掷（命中一次、抵抗再一次） */
  formula: "NONE" | "SINGLE_ROLL_RATIO" | "COMMUNITY_TWO_ROLL";
  evidence?: string;
}
export const ResistPolicies: Record<string, ResistPolicy> = {
  NOT_CONSUMED: {
    id: "NOT_CONSUMED", status: "UNKNOWN",
    question: "效果抵抗到底怎么参与状态/控制的命中判定？（官方词条表里没有这条公式）",
    formula: "NONE",
    evidence: "默认口径 = 保持现状：只掷原文写的基础概率，抵抗属性不参与。选它是为了**不把猜测混进结论** —— 竞猜输入里的效果抵抗目前对胜率零影响，这一点会写进产物快照。",
  },
  SINGLE_ROLL_RATIO: {
    id: "SINGLE_ROLL_RATIO", status: "HYPOTHESIS",
    question: "一次掷骰：实际概率 = 基础概率 × (1 + 命中/100) / (1 + 抵抗/100)？",
    formula: "SINGLE_ROLL_RATIO",
    evidence: "同类手游最常见的一种写法（命中与抵抗各按百分比线性修正）。本仓库没有官方来源，只有「结构上合理」这一条理由 —— 因此标 HYPOTHESIS。",
  },
  COMMUNITY_TWO_ROLL: {
    id: "COMMUNITY_TWO_ROLL", status: "HYPOTHESIS",
    question: "两掷：先掷命中 p×(1+命中/100)，再掷抵抗 p/(1+抵抗/100)？",
    formula: "COMMUNITY_TWO_ROLL",
    evidence: "照抄社区模拟器 omj_simulator 的实现（core/tasks/add-buff.ts:42-49，含 BUFF_RES 事件）。★ 它的净概率是 p²/res，与常见的 p/(1+res) 不同 —— 抄它是为了「有一条可对照的实现」，不是因为它是官方口径。",
  },
};

/**
 * ★★★ 第 99 轮：**属性偷取**的口径（a1-4 §16 Restore）。
 *
 * ★ 与其它红区不同的一条：这一条的默认档**有 KB 证据**（三条原文互相印证，见 kernel/steal.ts 文件头），
 *   所以它标 HYPOTHESIS 而不是 UNKNOWN —— 但备选口径照样实现，因为"默认对不对"要靠**量**，
 *   不能靠"我读懂了原文"。
 */
/** ★ 口径名的**唯一一处**声明：steal.ts 与这里都从它取名，避免又一份重复词表（g38 会抓到）。 */
export const STEAL_BASIS = { TRANSFER: "TRANSFER_FROM_TARGET", RATE_SWAP: "RATE_SWAP" } as const;
export type StealBasis = (typeof STEAL_BASIS)[keyof typeof STEAL_BASIS];

export interface StealPolicyConfig {
  id: string; status: "HYPOTHESIS" | "UNKNOWN" | "VERIFIED";
  basis: StealBasis;
  question: string; evidence?: string;
}
export const StealPolicyConfigs: Record<string, StealPolicyConfig> = {
  TRANSFER: {
    id: STEAL_BASIS.TRANSFER, status: "HYPOTHESIS",
    question: "偷的是一个绝对量（目标当前属性×比例 → 转给偷取者，到期/阵亡归还）还是双方各乘系数？",
    basis: STEAL_BASIS.TRANSFER,
    evidence: "噬魂「偷取总值…不超过自身初始攻击60%…全部归还」+ 盗人神「15%攻击/20%防御/15%暴击/10点速度」混用百分比与点数 + 三条「持续N回合」⇒ 三条都指向量的转移。",
  },
  RATE_SWAP: {
    id: STEAL_BASIS.RATE_SWAP, status: "HYPOTHESIS",
    question: "双方各按**自己**面板的百分比变化？（不守恒：偷取者拿到的量与目标失去的量无关）",
    basis: STEAL_BASIS.RATE_SWAP,
    evidence: "只作对照：它用来量出默认口径有多重要，且与噬魂的「偷取总值」写法冲突。",
  },
};

/**
 * Red zone I: betting (对弈竞猜) anti-stall endgame. Active only where an assembly path selects a
 * non-NONE preset (both betting assemblies do so in MAX skill-level mode); the engine default is NONE,
 * so BASE runs are byte-identical.
 *
 * Referee round: what completes a round is per preset — a referee runner on the action-bar clock (refereeSpeed,
 * the betting default), every N full turns (actionsPerRound), or every living shikigami having taken a turn
 * since the previous round (the Arena wording, both null). After round r (stacking, additive):
 *   damage dealt ×(1 + damageStep·min(r, lateFromRound−1) + lateDamageStep·max(0, r−lateFromRound+1))
 *   healing ×max(0, 1 − healStep·r)
 * At the battle's turn cap (TIMEOUT_ADJUDICATE): more surviving shikigami wins, then higher team
 * remaining HP% (Σhp / Σmax HP); exact tie ⇒ draw.
 */
export interface EndgamePolicy {
  id: string; status: PolicyStatus; question: string;
  mode: "NONE" | "REFEREE_ROUNDS";
  damageStep: number; lateDamageStep: number; /** null = no late step */ lateFromRound: number | null; healStep: number;
  timeout: "TURN_LIMIT" | "ALIVE_THEN_HP";
  /**
   * What completes a referee round. null = every living shikigami has taken a turn (the Arena wording);
   * N = every N full turns (top-level actions, extra turns included; counters / pseudo turns excluded).
   */
  actionsPerRound: number | null;
  /**
   * Time-based referee (betting presets REFEREE_CLOCK_*): the referee is an action-bar runner of this speed
   * (the koi-flag icon on the turn-order bar). Round k completes when the action-bar clock reaches
   * k × GOAL / refereeSpeed; a unit arriving at exactly that time acts first. Overrides actionsPerRound.
   * Absent / null = not time-based.
   */
  refereeSpeed?: number | null;
  evidence?: string;
  /** Evidence for the round trigger (actionsPerRound) */
  triggerEvidence?: string;
}

/**
 * Betting referee round trigger — HYPOTHESIS (medium confidence), from the 2026-11-23 match-6 replay:
 * the "All ATK up" banner appeared after about 8 and about 16 top-level actions, while Okuribito and Ungaikyo
 * (the slow units) had not acted yet — so the Arena rule "after every unit has acted once" cannot be it.
 * A fixed action count fits both banners. Alternatives not ruled out: a time (action-bar) clock, or one
 * round per N turns of the fastest unit (Fengyang acted about every 4 actions in that replay).
 */
export const REFEREE_ACTIONS_PER_ROUND = 8;
const REFEREE_TRIGGER_EVIDENCE = "Match-6 replay (2026-11-23f): referee banners after ~8 and ~16 top-level actions, before "
  + "Okuribito / Ungaikyo had ever acted ⇒ not 'every unit acted once'; a fixed 8-action round fits (time-based or "
  + "fastest-unit clocks not ruled out).";
/**
 * Betting referee clock — HYPOTHESIS (medium-high confidence), from the match-6 and match-8 replays (2026-11-24 re-read).
 *   · The referee is a koi-flag icon that runs on the turn-order bar like a unit and takes the "current actor" slot
 *     when it fires (banner "All ATK up", then a green "DMG Dealt Up" on every unit).
 *   · Match 8 (f752 / f1159 / f1501): banner 1 right after all 10 units acted once (Kusa Regrown, SPD 114, acted
 *     last at f720); Kaoru (213) and Mannendake (205) took their 2nd turns only after it ⇒ referee speed in
 *     (106.5, 114]. Banner 2 right after Kusa's 2nd turn, banner 3 after Kusa's 3rd turn AND one more Mannendake
 *     turn (f1487) — "every living unit acted" would have fired at f1455, a clock does not.
 *   · Match 6 (f640–672, f944–975): banner 1 before Inaba (SPD 113) ever acted — Inaba's first turn came right after
 *     it (f672) and her 2nd right after banner 2 ⇒ speed > 113. Okuribito / Ungaikyo / Peach (Red) were held back by
 *     control / bar push in that replay (Red acted only 4 times all battle), which is why the old reading saw
 *     "8 actions, slow units not acted yet".
 *   ⇒ one rule fits both: a referee runner of speed ≈ 114 (113 < v ≤ 114). Ties go to the unit.
 * Rejected: a fixed 8 actions (match 8 rounds lasted 10, 13, ~11, ~15 actions); "every living unit acted" (fires
 * early in match-8 round 3 and cannot explain match 6).
 */
export const REFEREE_CLOCK_SPEED = 114;
const REFEREE_CLOCK_EVIDENCE = "Replays m6 + m8 (re-read 2026-11-24): the referee is a koi-flag runner on the turn-order bar. "
  + "m8: banners after Kusa (SPD 114) turns 1, 2, 3 while Kaoru 213 / Mannendake 205 had not yet taken turn 2 ⇒ v ≤ 114; "
  + "m6: banners 1 and 2 each came just before an Inaba (SPD 113) turn ⇒ v > 113. Fixed-8 and every-unit-acted rejected.";
const REFEREE_EFFECT_EVIDENCE = "Effect: banner \"All ATK up\" + a green \"DMG Dealt Up\" on all ten units (m8 f775) — a damage-dealt "
  + "increase, not ATK: Kusa Regrown's 35%-ATK heals do not grow with rounds (1883 before round 1 → 2070 after round 7, "
  + "Bamboo / L3 ATK buffs explain the rest) and her crit seed heal 4067 → 4117 across round 1. Healing is NOT cut "
  + "(−10%/round would leave 30% at round 7). Size not measurable cleanly (Amaterasu 1201 → 1225 on the same unit "
  + "across round 1 suggests it is small; crit / DEF noise elsewhere); +15% kept from the 斗技 referee.";
export const EndgamePolicies: Record<string, EndgamePolicy> = {
  NONE: {
    id: "NONE", status: "UNKNOWN",
    question: "Does betting have an anti-stall ramp at all? (none modelled: battles can stall at the turn cap)",
    mode: "NONE", damageStep: 0, lateDamageStep: 0, lateFromRound: null, healStep: 0, timeout: "TURN_LIMIT", actionsPerRound: null,
    evidence: "Historical behaviour: no ramp, the turn cap ends the battle as TURN_LIMIT (no winner).",
  },
  REFEREE_CLOCK_114: {
    id: "REFEREE_CLOCK_114", status: "HYPOTHESIS",
    question: "Betting referee = a speed-114 runner on the action bar; each pass: +15% damage dealt (stacking, +30% from round 11), no healing cut?",
    mode: "REFEREE_ROUNDS", damageStep: 0.15, lateDamageStep: 0.30, lateFromRound: 11, healStep: 0, timeout: "ALIVE_THEN_HP",
    actionsPerRound: null, refereeSpeed: REFEREE_CLOCK_SPEED, triggerEvidence: REFEREE_CLOCK_EVIDENCE,
    evidence: REFEREE_EFFECT_EVIDENCE + " Timeout adjudication as 17173 (2020).",
  },
  REFEREE_15_10: {
    id: "REFEREE_15_10", status: "HYPOTHESIS",
    question: "(Previous default, kept to revert) Betting endgame = 斗技 referee 裁决鬼王: +15% damage / −10% healing per referee round, +30% from round 11, a round every 8 actions?",
    mode: "REFEREE_ROUNDS", damageStep: 0.15, lateDamageStep: 0.30, lateFromRound: 11, healStep: 0.10, timeout: "ALIVE_THEN_HP",
    actionsPerRound: REFEREE_ACTIONS_PER_ROUND, triggerEvidence: REFEREE_TRIGGER_EVIDENCE,
    evidence: "17173 (2020): 对弈竞猜 stacks 造成伤害增加 and 治疗量降低 over time; undecided ⇒ more surviving shikigami, then more remaining HP. Numbers borrowed from the 斗技 referee 裁决鬼王 (+15% damage, −10% healing per round, stacking; +30% from round 11). Not verified for betting. Round trigger: every 8 top-level actions (see triggerEvidence; the Arena says after every unit acts once).",
  },
  REFEREE_20_10: {
    id: "REFEREE_20_10", status: "HYPOTHESIS",
    question: "Same referee model with the Japanese-source numbers: +20% damage / −10% healing per round?",
    mode: "REFEREE_ROUNDS", damageStep: 0.20, lateDamageStep: 0.20, lateFromRound: null, healStep: 0.10, timeout: "ALIVE_THEN_HP",
    actionsPerRound: REFEREE_ACTIONS_PER_ROUND, triggerEvidence: REFEREE_TRIGGER_EVIDENCE,
    evidence: "Japanese community source: +20% damage / −10% healing per referee round (no late step mentioned). Timeout adjudication as 17173 (2020).",
  },
};

/** 全部红区的集合；任何一次模拟都会把它写进产物 */
export interface BattlePolicies {
  startup: StartupPolicy;
  priority: string;         // -> events.ts PriorityPolicies
  tieBreak: string;         // -> timeline.ts TieBreaks
  death: DeathPolicy;
  resource: ResourcePolicy;
  guessing: GuessingRuleset;
  /** ★ 第 70 轮：被动技能执行与否（默认 OFF） */
  passives: PassivePolicy;
  /** ★ 第 93 轮：吸血基数/通道（默认「实际扣除的生命 + 治疗通道」） */
  lifesteal: LifestealPolicy;
  /** ★ 第 94 轮：状态自带的免疫口径（默认「免疫减益」覆盖控制） */
  immune: ImmunePolicy;
  /** ★ 第 97 轮：效果抵抗口径（默认不参与 = 保持现状） */
  resist: ResistPolicy;
  /** ★ 第 99 轮：属性偷取口径（默认「量的转移」，有 KB 证据；备选不守恒口径只用于对照） */
  steal: StealPolicyConfig;
  /** Betting anti-stall endgame (default NONE; the betting assemblies pick REFEREE_CLOCK_114 in MAX mode) */
  endgame: EndgamePolicy;
}
export function defaultPolicies(): BattlePolicies {
  return {
    startup: StartupPolicies.UNDETERMINED,
    priority: "UNDETERMINED",
    tieBreak: "UNRESOLVED",
    death: DeathPolicies.UNDETERMINED,
    resource: ResourcePolicies.UNKNOWN_ZERO,
    guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED,
    passives: PassivePolicies.NOT_EXECUTED,
    lifesteal: LifestealPolicies.APPLIED_AS_HEAL,
    immune: ImmunePolicies.DEBUFF_COVERS_CONTROL,
    resist: ResistPolicies.NOT_CONSUMED,
    steal: StealPolicyConfigs.TRANSFER,
    endgame: EndgamePolicies.NONE,
  };
}
export function policySnapshot(p: BattlePolicies) {
  return {
    startup: { id: p.startup.id, status: p.startup.status },
    priority: p.priority, tieBreak: p.tieBreak,
    death: { id: p.death.id, status: p.death.status },
    resource: { id: p.resource.id, status: p.resource.status },
    guessing: { id: p.guessing.id, status: p.guessing.status },
    passives: { id: p.passives.id, status: p.passives.status, mode: p.passives.mode },
    lifesteal: { id: p.lifesteal.id, status: p.lifesteal.status, basis: p.lifesteal.basis, asRecover: p.lifesteal.asRecover },
    immune: { id: p.immune.id, status: p.immune.status, debuffCoversControl: p.immune.debuffCoversControl },
    resist: { id: p.resist.id, status: p.resist.status, formula: p.resist.formula },
    steal: { id: p.steal.id, status: p.steal.status, basis: p.steal.basis },
    // Only when not NONE: the default snapshot (and every pinned BASE fingerprint) stays unchanged.
    ...(p.endgame && p.endgame.id !== "NONE" ? { endgame: { id: p.endgame.id, status: p.endgame.status, timeout: p.endgame.timeout } } : {}),
    _warning: "存在 UNKNOWN 策略时，本产物的数值不构成机制结论",
  };
}
export function hasUnknownPolicy(p: BattlePolicies): boolean {
  return [p.startup.status, p.death.status, p.resource.status, p.guessing.status].includes("UNKNOWN");
}
