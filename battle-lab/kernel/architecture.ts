// kernel/architecture.ts — ★★ 架构级声明的登记册（a1-4 目标 ⑨，第 65 轮）
//
// 为什么还需要**第四张表**（前三张：capability/registry.ts 的 48 条官方能力、
// compile/unmodeled.ts 的未建模动词、kernel/effects.ts 的 28 条效果）：
//   那三张表管的都是「**游戏机制**」——而目标 ⑨ 里还有一整类声明是**引擎架构**：
//   BattleState 是不是唯一真相、事件是不是父子链、档位/队列/原子性/指纹……
//   这些此前只散落在报告的行文和 test 的注释里，**没有任何一处能一次回答"哪几条是真的"**。
//
// ★★ 每条必须给出可被机器验证的把手，四态**互斥且穷尽**：
//     ENFORCED         有生产者 + 有测试 ⇒ 改坏它测试会红
//     PARTIAL          有生产者，但**只在合成场景被走到**（真实对局到不了）⇒ 必须写 whyPartial
//     BY_OTHER_MEANS   规格点名的**结构**不存在，但规格自己要求的是**意图**，
//                      而意图由另一条路承担 ⇒ producer 必须为 null，且 insteadProducer 必须能匹配到
//     DEFERRED_BY_SPEC 规格自己写了"以后/如果" ⇒ producer 必须为 null，且必须给出规格原话
//
// ★ 第 65 轮实地核对的结果（都是先查再说，不是照着目标抄）：
//   · 「四队列分离」的规格原文紧接着就写了「四个 Queue **不应该**四套调度器，统一由 ResolutionScheduler 协调」
//     —— 引擎走的正是这条路（EventBus + ResolutionScope），所以这是 BY_OTHER_MEANS，不是缺口；
//   · 「Environment」在引擎里**一个字符都没有**，但规格 §34 自己写着"以后残局机制就在这里"、
//     "如果 M2 最后证明…" —— 属于 DEFERRED_BY_SPEC，不是漏做；
//   · 「Summon / ResolutionKey / Death State Machine」三处**有代码但在真实对局里到不了**
//     （召唤物容器没人放东西、排序键在真实对局里从不出现第二个候选、复活/不死标记从没被置为 true）
//     —— 这三条标 PARTIAL，并且必须写清楚"为什么到不了"。
export type ArchStatus = "ENFORCED" | "PARTIAL" | "BY_OTHER_MEANS" | "DEFERRED_BY_SPEC";

export interface ArchClaim {
  key: string;
  /** 目标 ⑨ 的原话（便于对照，不改写） */
  claim: string;
  /** 生产代码里的把手；BY_OTHER_MEANS / DEFERRED_BY_SPEC 必须为 null */
  producer: string | null;
  /** 把手的搜索范围：生产文件 / 含声明文件（effects.ts 这类表本身就是产物） */
  where: "PROD" | "DECLARATION";
  /** BY_OTHER_MEANS：实际承担意图的那段代码 */
  insteadProducer?: string;
  /** 验收测试（相对 battle-lab 的路径）；DEFERRED_BY_SPEC 可以为 null */
  test: string | null;
  status: ArchStatus;
  note: string;
  /** PARTIAL 必填：为什么"有代码但真实对局到不了" */
  whyPartial?: string;
  /** DEFERRED_BY_SPEC 必填：规格里那句"以后/如果" */
  specQuote?: string;
}

export const ARCHITECTURE: ArchClaim[] = [
  { key: "battle-state", claim: "BattleState 为唯一真相", producer: "captureState", where: "PROD",
    test: "tests/g0-state.ts", status: "ENFORCED",
    note: "所有运行状态经 captureState 出口；存档 → 重建 → 续跑的逐字节一致由 g0 与 g12 压住" },
  { key: "modifier-lifecycle", claim: "Modifier 生命周期", producer: "addModifier", where: "PROD",
    test: "tests/g10-modifiers.ts", status: "ENFORCED",
    note: "FIXED / ADD_RATE / SET 三种模式，折叠发生在属性读取时（entity.prop）" },
  { key: "discrete-events", claim: "离散事件仿真（不按帧）", producer: "bus.dispatch", where: "PROD",
    test: "tests/g1-event-queue.ts", status: "ENFORCED",
    note: "推进靠事件与回合，不靠固定步长；trace 里的 frame 只是观测序号，不参与推进" },
  { key: "turn-classes", claim: "Turn 分类（NORMAL/NEW_TURN/PSEUDO_TURN/ACTION_ONLY）", producer: "TurnType", where: "PROD",
    test: "tests/g11-turn-types.ts", status: "ENFORCED",
    note: "四类都有类型与鬼火条/回合触发的判定分支；NEW_TURN 的生产者：kernel/extra-turn.ts 的 grantExtraTurn + Battle.runExtraTurns（见 effects.ts 的 ExtraTurn 条）" },
  { key: "effect-registry", claim: "Action/Effect Registry", producer: "EFFECT_KINDS", where: "DECLARATION",
    test: "tests/g35-effect-registry.ts", status: "ENFORCED",
    note: "★ 它的产物就是**声明文件本身**（kernel/effects.ts），所以把手要在声明文件里找 —— 扫描集合默认排除声明文件，这里显式声明 where: DECLARATION" },
  { key: "damage-branches", claim: "Damage Pipeline 五种伤害语义分叉", producer: "DamageType", where: "PROD",
    test: "tests/g32-damage-direction.ts", status: "ENFORCED",
    note: "NORMAL / INDIRECT / CONDUCTION / TRUE / FIXED（另加 FORM_DESTROY）各自的不暴击、无视防御、不触发御魂等语义写在 damage.ts" },
  { key: "trigger-depth", claim: "Trigger Engine 与 ActorResolver 防递归爆栈", producer: "maxDepth", where: "PROD",
    test: "tests/g1-event-queue.ts", status: "ENFORCED",
    note: "溢出会**当场留痕**（EVENT_OVERFLOW 进 trace），不是静默截断" },
  { key: "event-parent-root", claim: "Event Parent/Root", producer: "parent:", where: "PROD",
    test: "tests/g1-event-queue.ts", status: "ENFORCED",
    note: "每个节点带 seq/parent/root/depth，Theater 与 Inspector 靠它回答「这条伤害属于哪次技能」" },
  { key: "death-state-machine", claim: "Death State Machine", producer: "hpZero", where: "PROD",
    test: "tests/g28-resolution-boundary.ts", status: "PARTIAL",
    note: "HP 归零 / 死亡 / 被击败三态分开，胜负在边界即时判定",
    whyPartial: "★ 第 67 轮推进了一半：**主动复活**已接线（全库 3 个技能，compile/character.ts 调用 Battle.revive，tests/g41-revive.ts 验证）—— 这条支路现在走得通了。仍到不了的：① 触发式复活（阵亡时…立即复活）与依赖召唤物的复活（棺材/晴天娃娃）；② 不死/变形两条支路（reviveBlocked / undeathUsed / transformed 在生产代码里从没被置为 true，第 56 轮实测）" },
  /**
   * ★★★ 第 98 轮：这条从「容器齐、没有产生者」推进到「**产生者也在**，只是没有触发者」。
   *   ① 数据：放置单位的定义在 `data/kb/tips.json` 里（技能原文用 `[tips_N]` 引用），
   *      解析出 6 条规格 —— 见 kernel/summon.ts。旧结论「KB 里没有召唤物数据」是**查错了表**。
   *   ② 运行时：`Battle.addSummon` 是唯一产生者（生命基准 / 真实免疫状态 / 召唤位上限 /
   *      countsForVictory 与 Team.victoryCount / 确定性 id / SUMMON_CREATE·SUMMON_SLOT_FULL 留痕）。
   *   ③ 仍缺：编译层调用方（没有技能会触发它）。所以 status 保持 PARTIAL —— 不升 FULL。
   */
  { key: "summon-runtime", claim: "Summon Runtime", producer: "addSummon", where: "PROD",
    test: "tests/g59-summon.ts", status: "PARTIAL",
    note: "容器 / 序列化 / 恢复 / 寻敌 / 占位标记 / 产生者（addSummon）/ ★触发者（SkillIR.forms ← [tips_N]姿态，第 101 轮）",
    whyPartial: "触发者只覆盖**自身形态**这一类：神堕八岐大蛇「神堕之力」与百羽凤凰火「未熄羽」端到端打通（g62 §4/§5）。第 102 轮又补两块：形态**自己的技能表**（SkillIR.formSkillOf ← 「[tips_N]姿态下可施放」，实测 1 处）与**两种回归时机**（形态阵亡 / 到达行动条终点）。第 103 轮再补**敌方位放置**：镇压式（雷冢：放敌方队、被镇压者离场、雷冢被击败时以 1 点生命放回、同一式神只生效 1 次）与击杀式（龙胆蓝璃：放己方队、位置 = 阵亡者原位置）。仍缺：龙胆蓝璃的两条细则（重复召唤叠加上限 / 在场时拥有者免伤 —— 都写在事件里）。g12 §4 的旧边界声明只对了一半，已在 g12 §5 修正" },
  /**
   * ★★★ 第 109 轮：从 DEFERRED_BY_SPEC 变成 **PARTIAL**。
   *   为什么现在做：规格把它写成"以后"的容器，而**容器本身**正是规格给出的接口（§34 的 EnvironmentState）——
   *   建容器不需要任何游戏内证据，猜数值才需要。于是这一轮把容器、规则接口、档位乘区、序列化、留痕都做了，
   *   规则表**留空**（空表是事实：残局参数在 GuessingRuleset 里全是 null）。
   *   数据一到（D 组 12 个实验：增伤开始时间 / 曲线），**只改 ruleset 数据**就自动生效 —— 见 environment.ts 的
   *   stalemateRuleFromRuleset。
   */
  { key: "environment-runtime", claim: "Environment Runtime", producer: "envTick", where: "PROD",
    test: "tests/g65-environment.ts", status: "PARTIAL",
    note: "容器 / 规则接口（evidence 必填）/ 档位机 / 伤害·治疗乘区 / 序列化（非默认才进档 ⇒ 默认指纹不变）/ 留痕（ENV_STAGE·ENV_MODIFIER）/ 知识库残局数据的桥（stalemateRuleFromRuleset）",
    whyPartial: "★ **规则内容是空的**：`GuessingRuleset.stalemate` 的 startTurn / damageRamp / healingReductionRamp 全是 null（知识库自己的注释写着「未实测，全为 null 表示禁止假设」），D 组 12 个实验（残局增伤开始时间 D07 / 增长曲线 D08）未实测 ⇒ 引擎拒绝自己填一个「每 30 回合 +10%」。空表下乘区恒为 1，行为与历史逐位相同。",
    specQuote: "§34：「以后残局机制就在这里」／「如果 M2 最后证明：180 秒后每 X 秒 +Y% 伤害 —— 只实现 EnvironmentRule，不污染式神」" },
  { key: "soul-runtime", claim: "Soul Runtime", producer: "installSoulEffects", where: "PROD",
    test: "tests/g31-soul-liveness.ts", status: "ENFORCED",
    note: "★ g31 是**逐件实测**：70 件御魂里只有 4 件改变可观测状态（火灵/蚌精/无刀取 FULL + 招财猫 PARTIAL）—— 这条数字本身就是这层的诚实边界" },
  { key: "victory-immediate", claim: "Victory 即时检查", producer: "checkVictory", where: "PROD",
    test: "tests/g28-resolution-boundary.ts", status: "ENFORCED",
    note: "胜负在 ResolutionBoundary 即时判，不等回合结束；checkVictory 是全函数（没有团灭时会清掉上一次的判定）" },
  { key: "atomic-resolution", claim: "Atomic Resolution", producer: "withinResolution", where: "PROD",
    test: "tests/g28-resolution-boundary.ts", status: "ENFORCED",
    note: "一次技能结算是一个 ResolutionScope；双方同时死亡时不提前结束，允许当前原子结算走完" },
  { key: "resolution-key", claim: "ResolutionKey", producer: "compareResolutionKey", where: "PROD",
    test: "tests/g29-resolution-key.ts", status: "PARTIAL",
    note: "排序键（阶段 / 优先级 / 速度 / 阵营 / 插入序）完整实现，用于同一事件下多个候选触发者的定序",
    whyPartial: "**真实对局里从不出现第二个候选**：典型对局 562 次派发、0 次多候选；加了御魂也只有 61 次多候选，每次最多 1 个 —— 所以这条排序规则目前只有 g29 的合成场景在走（第 36 轮实测）" },
  { key: "queue-separation", claim: "ActionQueue/EventQueue/TriggerQueue/LifecycleQueue 分离", producer: null, where: "PROD",
    insteadProducer: "withinResolution", test: null, status: "BY_OTHER_MEANS",
    note: "四类**作为独立结构**不存在，四个名字在引擎里一个都没有。但规格紧接着自己写了「四个 Queue 不应该四套调度器」——引擎走的正是这条路：统一由 EventBus（dispatch + ResolutionScope）协调，四类的区别体现在事件码与 passive/priority 上（ActionQueue 那一类的四个来源里，EXTRA/COUNTER/INVITED 三个没有生产者，见 effects.ts）",
    specQuote: "§23：「四个 Queue 不应该四套调度器。统一由 ResolutionScheduler 协调。」" },
  { key: "state-hash", claim: "State Hash", producer: "stateHash", where: "PROD",
    test: "tests/g2-snapshot.ts", status: "ENFORCED",
    note: "★ 它上面挂着三样东西：G3 逐帧校验、replay determinism、G0 存档续跑 —— 第 57 轮那个 Math.random 做护盾 id 的 bug 就是把它弄坏的" },
  { key: "rng-parity", claim: "RNG parity", producer: "rng.expect", where: "PROD",
    test: "tests/g40-rng-parity.ts", status: "ENFORCED",
    note: "★ 第 66 轮补上验收测试。此前它标着 PARTIAL，理由是「没有一条以 RNG parity 为主题的测试」—— 按第 63 轮的判据（没有执行者的承诺等于假话），这一条不能留在那个状态里。g40 现在查五件事：同 seed 的**用途序列与数值序列**逐位一致、不同 seed 必须不同（防平凡通过）、帧边界不许落在 expect()/next() 之间（今天 0 次，钉住）、pending 随存档往返存活（并反证旧格式会丢标签）。★ 顺带修掉一个真缺口：快照此前只存 {seed,s,n}，在 expect() 之后做的存档恢复后会丢那次抽数的用途标签" },
];
