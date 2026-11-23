// compile/passive-runtime.ts — ★★★ 被动技能的运行时（第 70 轮）
//
// 在此之前：`bus.register` 在生产代码里只有御魂那一处（soul/effect-system.ts），
// 式神的被动技能**没有任何运行时** —— 157 个被动的 IR 被解析出来了，但没人执行。
//
// 这一版做三件事，顺序不能变：
//   ① **筛**：先把 [tips_N] 解析成规范名（compile/tips.ts ← data/kb/tips.json，721 处 / 0 落空），
//      再收 classifyPassive() 判为 CANDIDATE 的（无显式条件词、也无**解析不出来**的占位符）。
//      ★ 顺序不能反：不解析就会把 "有40%[tips_2]" 看成无条件（第 69 轮 40% 变 100% 的根因）。
//      另外 19 条被占位符挡住的**必须挡在外面** —— 40% 的概率就藏在 [tips_2] 里（第 69 轮）。
//   ② **挂**：按触发时机映射到**已经派发**的事件码上；事件码没有派发点的自然挂不上，如实跳过。
//      ★ 第 74 轮：`SKILL_START` 原本没有派发点（「攻击时」×13 全被跳过），
//        现在 kernel/battle.ts 在**技能开始执行**处派发它（判据：技能 IR 里有没有伤害分量），
//        于是这一族可以挂了。DISPATCHED_EV_CODES 必须跟着事实走 —— g42 双向盯着它。
//   ★★ 第 75 轮：`「有 X% 概率 …」`被**建模**了 —— 这类被动不再"整条不挂"，
//      而是挂上并在触发时用 battle.rng 掷一次（掷数进 stateHash / 快照 / RNG parity）。
//   ③ **跑**：复用技能自己的 `execute`（与主动技能同一段代码），
//      目标由技能自己的 `pickTarget` 选 —— 于是"作用范围"那一层自动继承。
//
// ★ 默认 **OFF**：这个模块由 policies.passives.mode 控制，默认根本不注册任何东西，
//   因此与历史结果逐位一致（典型对局指纹不变）。理由见 kernel/policies.ts 的红区 E 注释。
import type { Battle } from "../kernel/battle.ts";
import type { Entity } from "../kernel/entity.ts";
import { classifyPassive, classifyPassiveUnits, matchFamily, TRIGGER_FAMILIES } from "../kernel/triggers.ts";
import type { PassiveUnit } from "../kernel/triggers.ts";
// ★ 第 93 轮：吸血类被动的执行入口在伤害管线里（不是 execute）—— 见下面的处理器注释
import { applyStatSteal } from "../kernel/steal.ts";
import { applyLifesteal } from "../kernel/damage.ts";
// ★ 第 129 轮：触发式自复活的执行入口（内核层，与主动复活共用 Battle.revive + healTarget）
import { applySelfRevive } from "../kernel/self-revive.ts";
// ★ 第 135 轮：触发式追加施放（走伪回合入口，与反击/协战同源）
import { castTriggeredSkill } from "../kernel/sub-cast.ts";
// ★ 第 141 轮：叠层场地（花海）—— 常驻机制，跟着被动一起装上
import { installLayerField } from "../kernel/layer-field.ts";
import type { LayerFieldSpec } from "../kernel/layer-field.ts";
// ★ 第 129 轮：「追加施放」这个动词名只有一份（编译器写它、这里读它）
import { APPEND_CAST_VERB, statusRefSlotsForClause, effectSlotsForClause, randomPoolSlotsForClause, controlSlotsForClause, normClauseText } from "./skill-compiler.ts";
// ★★★ 第 239 轮：计数器状态（GHOST_EYE）—— 触发施放入口复用第 135 轮那条（第 32 行），不重复导入
import { GHOST_EYE_ID, ghostEyeDef, DRUNK_ID, drunkDef, StatusBook } from "../kernel/status.ts";
// ★ 第 245 轮：治疗的唯一入口（醉倒醒来时治疗生命上限 N%）—— 与技能治疗同一条管线（可暴击/受减疗影响）
import { healTarget } from "../kernel/damage.ts";
// ★ 第 246 轮：「失去 X 时结束 Y」的监视器（与施放点共用一份实现）
import { installEndOnLose } from "../kernel/end-on-lose.ts";
import type { EffectSlotFilter } from "./skill-compiler.ts";
import { resolveTips, type TipEntry } from "./tips.ts";

export interface PassiveInstallReport {
  mode: "OFF" | "PARSED_ONLY";
  /** ★ 第 71 轮：分类前先把 [tips_N] 解析成规范名（205 次命中 / 0 次落空） */
  tipsResolved: number;
  tipsMissed: string[];
  /** ★ 第 95 轮：**一条 = 一个触发句**（不再是"一个被动一条"）。`clause` 是那一句的原文。 */
  installed: Array<{
    entityId: number; skill: string; family: string; event: string; probability: number | null; clause?: string;
    /** ★★★ 第 179 轮：这条子句的**主语**（谁身上发生这件事）与据此选定的总线 range —— 报表要能回答「为什么装成 ENEMY」 */
    subject?: string; range?: string;
    /** ★★★ 第 189 轮：主语的附加事实（排除自己 / 限定语的状态条件）—— 报表要能回答「为什么这次没触发」 */
    excludesSelf?: boolean; requiresStatus?: string | null;
  }>;
  /**
   * ★★★ 第 141 轮：装上的**叠层场地**（花海）—— 常驻机制，不挂触发句，所以与 installed 分开记账。
   *   它与"这条被动挂在哪句话上"不是一回事：一句都没解析出来也照样可能装上（先机那类就是这么回事）。
   */
  layerFields: Array<{ entityId: number; skill: string; term: string; startLayers: number }>;
  /** ★★★ 第 164 轮：装上的**先机结界**（[tips_7]：施放『X』且 X 真的带 field 的那几条） */
  senkiFields: Array<{ entityId: number; skill: string; cast: string; castId: string; mode: "SELF" | "ENEMY_RANDOM"; clause: string }>;
  /**
   * ★★★ 第 176 轮：**逐句承受者归属**装上了几条（「阵亡时，对伤害来源附加…」那一族）。
   *   它此前只在 `skipped.byTarget` 里出现 —— 报表能说"我没装"，说不清"装了哪一句、投给谁"。
   */
  sourceBearerFields: Array<{ entityId: number; skill: string; clause: string; refs: string[] }>;
  /**
   * ★★★ 第 177 轮：**写在主动 / 普攻技能里**的来源子句装上的处理器（鸩「毒之华」那一类）。
   *   它们不走被动那条路（cost ≥ 0 被闸门挡在外面），所以单独记账 ——
   *   报表要能说清"这一条我装了，装的是哪个事件码、投哪几个状态引用"。
   */
  activeBearerFields: Array<{ entityId: number; skill: string; code: string; family: string; refs: string[] }>;
  /** ★ 第 75 轮：装上的被动里有几条带**已建模的条件**（概率或层数门槛）。第 87 轮起不再只指概率。 */
  conditioned: number;
  /** ★★★ 第 87 轮：按**条件种类**分开记账 —— 否则"conditioned"这个名字会随着新条件种类悄悄变形 */
  conditionKinds: Record<string, number>;
  skipped: {
    noTrigger: number; hasCondition: number; hasPlaceholder: number; noDispatch: number;
    /** ★★★ 第 77 轮拆桶：被挡住的那些，到底是**条件**没建模还是**效果细节**没建模 */
    byCondition: number; byEffect: number;
    /**
     * ★★★ 第 129 轮：第七个桶 —— **承受者归属没建模**（「对伤害来源附加…」）。
     *   它既不是条件问题也不是效果问题：效果有执行点，但**打谁**没有逐句解析，
     *   于是"能不能执行"与"执行得对不对"是两件事。失败关闭 + 单独记账（见下面的安装闸门）。
     */
    byTarget: number;
  };
}

/**
 * 事件码 → 「生产代码里真的有人派发它吗」。
 *
 * ★★★ 这是一张**声明表**，而不是从代码里量出来的 —— 浏览器侧没有 fs，量不了。
 *   正因如此它**一定会漂**：第 74 轮补上 `SKILL_START` 的派发点之后，
 *   这份集合没有跟着更新，于是鬼女红叶「爆炸之咒」明明可挂，却被记成
 *   `skipped.noDispatch` **静默跳过** —— 代码做了事，声明说没做。
 *
 * ★ 所以它现在**导出**，并由 tests/g42 用生产者扫描**双向比对**（少了会红、多了也会红）。
 *   声明表可以有，但必须有人盯着它与事实对齐 —— 这是本项目第 4 次踩这个坑
 *   （kernel/effects.ts §41、kernel/architecture.ts §50、kernel/triggers.ts §53）。
 *
 * 当前：42 个事件码里 **18 个**有派发点（第 74 轮 SKILL_START 从"没有"变成"有"）。
 */
export const DISPATCHED_EV_CODES = new Set([
  "TURN_START", "TURN_END", "DEATH", "KILLED", "SENKI", "BATTLE_START", "ACTION_END",
  "BEFORE_DAMAGE", "AFTER_DAMAGE", "LETHAL", "SKILL_SELECT", "SKILL_END",
  "ORB_GAUGE_ADVANCE", "DAMAGE", "REVIVE", "VICTORY_CHECK", "BATTLE_END",
  "SKILL_START",
  // ★ 第 91 轮：这两个码一直在被派发，只是此前**不在 EV 表里**，所以这张表也收不到它们
  //   （见 kernel/types.ts 的补登记说明）。漏了它们的后果是：
  //   若哪天有触发器映射到开局阶段，会被误判成"挂在没人派发的事件上"。
  "SOUL_START", "PASSIVE_START", "DEATH_PREVENTION",
  // ★★★ 第 94 轮：IMMUNE 从「从未被派发」变成有派发点 —— 两处：
  //   compile/character.ts（状态施加被免疫挡下）与 kernel/damage.ts（伤害被免疫免除）。
  //   这张表由 tests/g42 双向盯着：少了会红、多了也会红。
  "IMMUNE",
  // ★★★ 第 97 轮：RESIST 也有派发点了（红区 H 的两掷口径下，控制被抵抗时派发一次）。
  //   注意：默认口径 NONE 下**永远不会**派发它 —— 这张表说的是"代码里有派发点"，不是"默认会派发"。
  "RESIST",
  // ★★★ 第 120 轮：这 10 个码从「机制在跑、只有 trace」变成**真的进总线**（走 Battle.queueEvent 的
  //   事件队列，见 kernel/battle.ts 的 drainEvents）。由来是一次口径复盘：它们的机制一直都在
  //   （治愈/恢复/失血/状态增删到期/状态未命中/行动条未命中/鬼火获得与溢出），但只有 trace 通道 ——
  //   于是「受到治疗时」「获得状态时」这类时机的被动/御魂**挂不上**（Theater 看得见、触发器接不上）。
  //   ★ 边界（别当成已全覆盖）：ORB_* 的派发点在**技能 / 御魂两条生产路径**上；
  //     直接调鬼火池（team.orbs.gain/pay）的地方不产生事件。
  "HEAL", "RECOVER", "HP_LOSS",
  "STATUS_REMOVE", "STATUS_EXPIRE", "STATUS_MISS", "TIMELINE_MISS",
  //   ★ STATUS_REMOVE 的路径**可达**：把 802 个技能逐个过 compileSkill，带非空 purge 的实测 **39 条**
  //     （g76 §[6] 机械盯着这个数字）。★ 这条我先量错过一次：用 bundle.json 里的 purge 数成 0 ——
  //     因为 bundle **没有序列化 purge 字段**。量错的弯路与教训记在报告 §105。
  "ORB_GAIN", "ORB_OVERFLOW", "ORB_COST",
  // ★★★ 第 122 轮：状态与护盾的生产点接上事件队列（Entity.eventSink → Battle.queueEvent），
  //   变形则在 enterForm / returnForm 两处派发。四个码此前都是「只有声明」：
  //     STATUS_ADD（获得状态 ——「获得状态时」这一族被动等的就是它）、
  //     SHIELD_CREATE / SHIELD_DAMAGE / SHIELD_BREAK（护盾三兄弟：机制一直在跑，但没有事件）、
  //     TRANSFORM（变形：trace 里只有 FORM_ENTER，事件码从未派发）。
  "STATUS_ADD", "SHIELD_CREATE", "SHIELD_DAMAGE", "SHIELD_BREAK", "TRANSFORM",
]);
const DISPATCHED = DISPATCHED_EV_CODES;

/**
 * ★★★ 第 80 轮：**分类一个被动技能的唯一入口**。
 *
 * 为什么要抽出来：分类需要三样东西 —— 解析后的文案、`cost < 0` 这道闸门、
 * 以及**编译产物里的事实**（例如"这个技能解析出护盾了吗"，见 `IrFacts`）。
 * 只要有一处漏了其中一样，测试里的数字就会与线上行为**悄悄分叉**：
 * 第 80 轮就真的发生了 —— `g42` 的普查没传 `irFacts`，于是它报的候选数停在 63，
 * 而生产路径已经是 65。**同一条判据必须只有一个入口**，否则"测试通过"说明不了任何事。
 *
 * @returns `v` 分类结论；`res` 占位符解析结果（供调用方累计 tipsResolved / tipsMissed）
 */
export function classifySkill(sk: any, tips?: Map<string, TipEntry>, ir?: any) {
  // ★ 显式 IR 参数是给**跑在原始 KB 上的普查**用的：那些对象没有 .ir，
  //   不传编译产物就会把"有护盾"判成 false —— g42 正是这样一度报着旧数字。
  const x = ir ?? sk?.ir ?? null;
  const raw = String(x?.sentences?.map((s: any) => s.text).join("。") ?? sk?.description ?? "");
  const res = tips ? resolveTips(raw, tips) : { text: raw, hit: [] as string[], miss: [] as string[] };
  const v = classifyPassive(res.text, -1, undefined, { hasShield: !!x?.shield?.length, hasSteal: !!x?.steals?.length, hasSelfRevive: !!x?.selfRevive });
  /**
   * ★★★ 第 95 轮：**逐句触发路由**。一个被动可以有多条互不相干的触发句
   *   （九命猫「九命」三句 / 骨女「怨生」两句 / 阿香「蛇之影」两句），
   *   而上面的 `v` 只挑**一族**。`units` 是每一条命中触发句各自的判定，顺序 = 文本顺序。
   *   ★ 与 `v` **同一套判据**（同一个 judgeClause）—— 两个入口共用一份实现，不允许分叉。
   */
  const units = classifyPassiveUnits(res.text, -1, undefined, { hasShield: !!x?.shield?.length, hasSteal: !!x?.steals?.length, hasSelfRevive: !!x?.selfRevive });
  /**
   * ★★★ 第 87 轮：**条件建模了 ≠ 效果可执行**。
   *
   * 这一刀是查「九命猫『九命』」时发现的：它的触发子句是
   *   「阵亡时，若拥有4层[buff_2072_1]，则会立即复活并[恢复]生命上限20%的生命」
   * 条件（4 层）第 87 轮建模了，可**复活**这个效果在 IR 里是 `revive: null`、
   * `unmodeledMechanics` 明写「**触发式**复活…没有接线」。
   * ⇒ 把它挂上去，运行时会在满足条件时执行一个**什么都不做**的 execute。
   *
   * 更糟的是它是**多子句**被动：第三句「阵亡时，对伤害来源附加[buff_2073_1]」是解析好的，
   * 于是一个由「4 层」把关的条件会顺带把那一句也管住 —— 而那一句本来是无条件的。
   *
   * 判据用 IR **自己的话**（不是另写一套启发式）：`unmodeledMechanics[].clause` 记着
   * "是哪一句话没建模"。只要它与**触发子句**互相包含，就说明这一段的效果没实现。
   * ★ 注意必须比到**子句**一级：同一个技能里别的子句未建模（例如 萤草「生花」的反击）
   *   不该连累这一条（第 88 轮的实测里，10 条"疑似"有 5 条属这种）。
   */
  const unmodeled = (x?.unmodeledMechanics ?? []) as Array<{ clause?: string; verb?: string }>;
  const clause = v.clause;
  /**
   * ★★★ 第 89 轮修掉一个**静默漏判**：这里的两个子句来自**不同的文本**——
   *   · `v.clause` 来自 `resolveTips` 之后的文本（`[恢复]`）；
   *   · `u.clause` 来自 IR，是**未解析**的原文（`[tips_20]`）。
   *   直接 `includes` 会失败，于是含 `[tips_N]` 的未建模子句**整类被漏掉**。
   *   实测：九命猫「九命」因此一直被当成候选（它的复活子句里恰好有 `[tips_20]`）。
   *
   *   修法：比较前把方括号内容与 `<br>` 都归一化掉 —— 判的是"是不是同一句话"，
   *   而不是"括号里写的是不是同一串字"。归一化之后两边都是
   *   「则会立即复活并生命上限20%的生命」。
   */
  const norm = (s: string) => String(s ?? "").replace(/<br\s*\/?>/gi, "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "");
  const nc = norm(clause);
  if (v.verdict === "CANDIDATE" && clause && nc &&
      unmodeled.some(u => { const nu = norm(u.clause ?? ""); return nu.length > 6 && (nc.includes(nu) || nu.includes(nc)); })) {
    return { v: { ...v, verdict: "HAS_CONDITION" as const, blockedBy: "EFFECT" as const }, res, units };
  }
  /**
   * ★★★ 第 88 轮：**第二道效果闸门 —— 这个 execute 到底有没有事可做。**
   *
   * 第 87 轮只查了"触发子句是不是落在一句 MECHANIC_UNPARSED 上"。但还有另一种空转：
   * **子句被判成 PARSED，可它描述的效果没有任何 IR 字段接得住。** 实测 8 条候选属于这种：
   *
   *   · 跳跳弟弟「驱逐」——「受到伤害时提升攻击，等同所受伤害的5%」：**属性增益**没有字段；
   *   · 山童「怪力」/ 凤凰火「烈焰」——「使其[tips_108]」：控制效果写成 `[tips_108]`，
   *     不是 `[buff_x]`，所以 `statusRefs` 是空的；
   *   · 夜叉「鬼魅」/ 烟烟罗「扑朔迷离」/ 蜜桃&芥子 —— 提速 / 减伤，同样是修饰符而非状态；
   *   · 白童子「不灭」——「使用普攻攻击」：一次追加行动，没有字段；
   *   · 须佐之男「神之领域」——「获得6把神剑·天羽羽斩」：未建模机制。
   *
   * ★ 其中「驱逐」**正是典型对局里唯一被装上的那条被动** —— 也就是说
   *   g43 那条"被装的被动真的触发了（16 次）"的断言，证明的是
   *   **handler 跑了 16 次**，而不是"它做了任何事"。**跑 ≠ 做事。**
   *
   * 判据：把 IR 里所有**会产生行为**的字段列一遍，一个都没有就说明没事可做。
   * ★ 注意 `orb.cost` 不能用 —— 被动自身的 `cost = -1` 会漏进 orb，于是每条都被算成"有鬼火效果"
   *   （第一版就是这么量的，65 条全带 +orb）。只有 `gain > 0` 或 `cost > 0` 才算。
   */
  if (v.verdict === "CANDIDATE" && x) {
    // ★ 第 93 轮：`lifesteal` 补进来之后，三尾狐「诱惑」（造成伤害时 50% 概率 20% 吸血）
    //   第一次**有事可做** —— 它此前正是被这一条挡住，理由是 EFFECT。断言随之转向（见 tests/g42 §[4]）。
    // ★ 第 95 轮：`counter` 同理（反击接线），并抽成 hasExecutableSurface（逐句注册也要用它 → 一处实现）。
    if (!hasExecutableSurface(x)) return { v: { ...v, verdict: "HAS_CONDITION" as const, blockedBy: "EFFECT" as const }, res, units };
  }
  return { v, res, units };
}

/**
 * ★ 第 88 轮的"这条 execute 到底有没有事可做"判据 —— 抽成函数，
 * 因为第 95 轮起它在**逐句注册**里也要用（一处事实，一处实现）。
 */
export function hasExecutableSurface(x: any): boolean {
  if (!x) return false;
  /**
   * ★★★ 第 105 轮：**偷取也算"有事可做"**。首无「冥火」的整个技能只有一句偷取，
   *   它的 ~B~execute~B~ 是空的 —— 若这里不认偷取，这条被动会被判成 HAS_CONDITION / EFFECT
   *   而**根本不注册**，于是"实现了却没有触发者"（g60 的端到端会红）。
   */
  return !!x.lifesteal || !!x.counter || !!x.selfRevive || (x.orbGaugeAdvance ?? 0) > 0 || (x.subCasts ?? []).length > 0 || (x.steals ?? []).length > 0 ||
    (x.damage ?? []).length > 0 || (x.heal ?? []).length > 0 || (x.shield ?? []).length > 0 ||
    (x.statusRefs ?? []).length > 0 || (x.purge ?? []).length > 0 || (x.timeline ?? []).length > 0 ||
    !!x.revive || (x.orb?.gain ?? 0) > 0 || (x.orb?.cost ?? 0) > 0;
}

/**
 * 给每个单位的被动技能挂上触发处理器。**必须在 runStartup() 之前调用**，
 * 否则 BATTLE_START 那一档会漏掉。
 * ★ 第 95 轮：注册单位从"一个被动"细化为"一个**触发句**"（见 installPassiveSkills 内的注释）。
 */
/**
 * ★★★ 第 189 轮：**证据子句落不落在这条触发句里**（双向包含，与第 181/188 轮的归因判据同一条规矩）。
 *   归一化复用 compile/skill-compiler.ts 的 normClauseText —— 两处各写一份就一定会分叉。
 */
function clauseCoversEvidence(unitClause: string, evidence: string): boolean {
  const a = normClauseText(unitClause), b = normClauseText(evidence);
  return a.length > 4 && b.length > 4 && (a.includes(b) || b.includes(a));
}

export function installPassiveSkills(
  battle: Battle,
  entities: Entity[],
  opts: { mode: "OFF" | "PARSED_ONLY"; tips?: Map<string, TipEntry> },
): PassiveInstallReport {
  const report: PassiveInstallReport = {
    mode: opts.mode, installed: [], layerFields: [], senkiFields: [], sourceBearerFields: [], activeBearerFields: [], conditioned: 0, conditionKinds: {}, tipsResolved: 0, tipsMissed: [],
    skipped: { noTrigger: 0, hasCondition: 0, hasPlaceholder: 0, noDispatch: 0, byCondition: 0, byEffect: 0, byTarget: 0 },
  };
  if (opts.mode === "OFF") return report;

  /** ★ 第 87/89 轮的子句归一化（方括号内容与 <br> 都去掉），逐句判据与全局判据共用 */
  const norm = (s: string) => String(s ?? "").replace(/<br\s*\/?>/gi, "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "");
  for (const e of entities) {
    for (const sk of (e.skills as any[])) {
      // ★ 只看被动（cost < 0）。第一版漏了这道闸门，于是**主动技能也被分类并计入 skipped**，
      //   统计数字被撑大（"22 条没有触发时机"里大半是普攻这类主动技能）—— 数字错了就会误导下一个人。
      /**
       * ★★★ 第 172 轮：**先机 → 结界**的安装位置挪到 cost 闸门**之前** —— 因为先机也写在**主动技能**里
       *   （御馔津「狐狩界」cost=3，先机就写在它自己身上）。
       *
       * 为什么挪到这里还是安全的：整个被动运行时**默认 OFF**（policies.passives，红区 E），
       *   所以默认档的指纹逐位不变；只有开被动档（PARSED_CANDIDATES_ONLY）时这条路径才会跑。
       *   也就是说：它跟着「机制类默认不装」这条口径走，而不是绕过它。
       *
       * fail-closed 三条与第 164 轮一致：子句必须是 [tips_7]、ref 要解析得到、且那条技能必须真的带 field。
       */
      for (const m of ((sk?.ir?.unmodeledMechanics ?? []) as any[])) {
        if (m.verb !== APPEND_CAST_VERB || !/\[tips_7\]/.test(String(m.clause ?? ""))) continue;
        const clause = String(m.clause);
        const idM = /\[skill_(\d+_\d+)\]/.exec(clause);
        const nameM = /施放『([^』]+)』/.exec(clause);
        const tg = (e.skills ?? []).find((s: any) => idM
          ? String(s?.ir?.id ?? "") === idM[1]
          : String(s?.name ?? "") === String(nameM?.[1] ?? ""));
        const f = tg?.ir?.field;
        if (!tg || !f) continue;
        const scopes = ((f.auras ?? []) as any[]).map((a: any) => a.scope).concat([f.perTurn?.scope]).filter(Boolean);
        const mode: "SELF" | "ENEMY_RANDOM" = scopes.includes("ENEMY") && !scopes.includes("ALLY") ? "ENEMY_RANDOM" : "SELF";
        const hid = "senkiField:" + e.id + ":" + String(tg.ir.id);
        if (battle.bus.hasHandler(hid)) continue;
        battle.bus.register({
          id: hid, ownerId: e.id, code: "BATTLE_START", range: "ALL", priority: 0, passive: true, source: "PASSIVE",
          fn: async () => {
            if (!e.alive) return;
            await castTriggeredSkill(battle, e, { ref: String(tg.ir.id), target: mode, clause });
          },
        });
        report.senkiFields.push({ entityId: e.id, skill: sk.name, cast: tg.name, castId: String(tg.ir.id), mode, clause });
      }
      /**
       * ★★★ 第 177 轮：**写在主动 / 普攻技能里的「受到攻击时，为攻击者附加…」**（鸩「毒之华」cost=2）。
       *
       * 与第 172 轮「主动技能里的先机」是**同一类装配点问题**：被动运行时只收 cost<0 的技能，
       *   而这一句写在一个 cost=2 的主动技能里 ⇒ 它此前永远不会被装上（受击时什么都不发生）。
       *
       * 判据（fail-closed，三条都要满足）：
       *   ① 这条技能的**来源子句证据**非空（sourceBearerRefs —— 第 176 轮的产物）；
       *   ② 每一条证据的子句都认得出来触发族，且那个事件码**真有派发点**（DISPATCHED）；
       *   ③ 目标侧族（受到攻击 / 受到伤害）⇒ range ALL + 处理器里按 ctx.input.target 过滤（第 95 轮同一条规矩）。
       * ★ 执行只走 execute 的 **statusOnly** 模式：把这门技能整套再放一遍就成了"挨一下打白送一发大招"（多算）。
       */
      const activeBearerRefs = ((sk?.ir?.sourceBearerRefs ?? []) as Array<{ ref: string; clause: string }>);
      if (activeBearerRefs.length && (Number(sk?.ir?.cost ?? sk?.cost) || 0) >= 0) {
        const byCode = new Map<string, { refs: string[]; family: string; targetSide: boolean }>();
        for (const b of activeBearerRefs) {
          /**
           * ★★ 族要按**整句**判，不能按证据里的那个小句判：splitClauses 是按逗号切的，
           *   285_02 的证据子句只有「为攻击者附加1层[buff_2852_1]」—— **不含**「受到攻击时」，
           *   照它判会得到「无族」，处理器就永远装不上（第一版就是这么错的，g100 当场照出来）。
           */
          const sentence = ((sk?.ir?.sentences ?? []) as any[])
            .map((s: any) => String(s?.text ?? ""))
            .find((t: string) => t.includes(String(b.clause ?? ""))) ?? String(b.clause ?? "");
          const fam = matchFamily(resolveTips(sentence, opts.tips ?? new Map()).text);
          const code = fam?.evCode ?? null;
          if (!code || !DISPATCHED.has(code)) continue;
          const cur = byCode.get(code) ?? { refs: [], family: String(fam!.family), targetSide: fam!.side === "TARGET" };
          cur.refs.push(String(b.ref));
          byCode.set(code, cur);
        }
        for (const [code, spec] of byCode) {
          const hid = "activeBearer:" + e.id + ":" + sk.name + ":" + code;
          if (battle.bus.hasHandler(hid)) continue;
          battle.bus.register({
            id: hid, ownerId: e.id, code, range: "ALL", priority: 0, passive: true, source: "PASSIVE",
            fn: async (ctx: any) => {
              if (spec.targetSide && ctx?.input?.target?.id !== e.id) return;
              await sk.execute(battle, e, ctx?.input?.source ?? e, ctx, { statusOnly: spec.refs });
            },
          });
          report.activeBearerFields.push({ entityId: e.id, skill: sk.name, code, family: spec.family, refs: spec.refs });
        }
      }
      if ((Number(sk?.ir?.cost ?? sk?.cost) || 0) >= 0) continue;
      /**
       * ★★★ 第 239 轮：**计数器 → 满层免消耗施放**（百目鬼「鬼眸」293_02；见 SkillIR.counterCast 的注）。
       *
       * 这是"条件表达不了"的那一类里**唯一能直接落地**的一条（§169.6 实测：主语已是 ENEMY、触发族「暴击」→ AFTER_DAMAGE 已派发，
       * 卡点只是"阈值没有载体"）—— 载体就是第 238 轮的合成状态 GHOST_EYE。
       * 口径：
       *   · 只认**敌方**造成的伤害（`src.teamId !== e.teamId`）且**暴击**（`ctx.result.isCrit`）；
       *   · 概率**只在触发侧掷一次**（写了才掷；与第 189/195 轮同一条"同一个概率不许掷两次"）；
       *   · 计数用 addStatus（cap=threshold），满层走 castTriggeredSkill（**free=免消耗**，第 237 轮的通路）；
       *   · reset ⇒ 施放后移除计数器。
       * ★ 本轮的边界：计数过程在 Theater 上**还看不见**（不加新 trace 类型，免得为它动 Presenter 与 ui13）—— 记在报告里。
       */
      const cc = (sk?.ir as any)?.counterCast;
      if (cc) {
        const hid = "counterCast:" + e.id + ":" + sk.name;
        if (!battle.bus.hasHandler(hid)) {
          battle.bus.register({
            id: hid, ownerId: e.id, code: "AFTER_DAMAGE", range: "ALL", priority: 0, passive: true, source: "PASSIVE",
            fn: async (ctx: any) => {
              if (!e.alive) return;
              const src = ctx?.input?.source ?? null;
              if (!src || src.teamId === e.teamId) return;
              if (!ctx?.result?.isCrit) return;
              if (cc.probability !== null && cc.probability !== undefined) {
                battle.rng.expect("counter_prob:" + cc.name + ":" + sk.name);
                if (!battle.rng.testHit(Number(cc.probability) / 100)) return;
              }
              const cap = Math.max(1, Number(cc.threshold) || 1);
              const prevStacks = Number((e.statuses ?? []).find((x: any) => String(x?.def?.id) === GHOST_EYE_ID)?.stacks ?? 0);
              e.addStatus(ghostEyeDef(cc.name), e.id, Math.max(1, Number(cc.perEvent) || 1), 99999, [], cap);
              const st: any = (e.statuses ?? []).find((x: any) => String(x?.def?.id) === GHOST_EYE_ID);
              const stacks = Number(st?.stacks ?? 0);
              /**
               * ★★★ 第 240 轮：**计数器过程在 Theater / Delta 上可见**（§179.7 留的那条边界）。
               *   走**既有** trace 词汇 STATUS_APPLY（Presenter 的 Banner 与 Buff 生命周期、kernel/diff 的帧、
               *   ui13 的词汇闸门都认它）—— 不新增类型：新类型要么没有渲染，要么得动 ui13 的允许清单。
               *   字段：stacks / threshold（层数型状态要能读出"第几只"）· merged（是新增量还是合并）·
               *   tag 用**状态实例自己的 tag**（同一个实例的多次施加因此能在生命周期里合并成一段）。
               *   ★ 在增层**之后**才写（要记的是加完的层数），且**每条成功计数一条** —— 与 40% 掷数一一对应。
               */
              battle.trace.push({
                t: "STATUS_APPLY", src: e.id, dst: e.id, status: GHOST_EYE_ID, name: cc.name,
                merged: prevStacks > 0, stacks, threshold: cap, ref: GHOST_EYE_ID, tag: st?.tag ?? null,
                duration: null, known: true, skill: sk.name, note: "COUNTER_STACK",
              });
              if (stacks < cap) return;
              await castTriggeredSkill(battle, e, { ref: String(cc.skillRef), target: "ENEMY_ONE", free: cc.free === true, clause: String(cc.clause ?? "") });
              /**
               * ★★★ 第 239 轮实测（尺子 g118 抓到的第一版错误）：这里**不能用 remove**。
               *   ① Entity.remove(id, force=false) 看的是 **removable 标记**（官方[1]「解除」的语义）——
               *      而鬼眸按规格定义成**不可解除**，于是 remove 返回 false、**什么都不做**，
               *      计数器永远停在 5 层 ⇒ 此后每一次成功都再放一次（实测：200 次暴击 85 次成功 → **81** 次施放，
               *      正确值 17 次）。而返回值没人看 ⇒ **静默**跑偏，正是 Fidelity 要抓的那类漂移。
               *   ② 仓库里「内部把状态花掉」的既有入口一律是 expireStatus（kernel/self-revive.ts:90、
               *      kernel/steal.ts:174/245、kernel/summon.ts:230/607、kernel/damage.ts:177）——
               *      计数被花掉**不是**「被解除」，不该借解除这条路（entity.ts 明说三个入口共用同一份回收实现）。
               */
              if (cc.reset) {
                const spent: any = (e.statuses ?? []).find((x2: any) => String(x2?.def?.id) === GHOST_EYE_ID);
                if (spent) {
                  const spentStacks = Number(spent.stacks ?? 0);
                  e.expireStatus(spent);
                  /** ★ 第 240 轮：清零也要看得见（reason 与 damage/self-revive 那两条同型：消耗 ≠ 到期） */
                  battle.trace.push({ t: "STATUS_EXPIRE", id: e.id, status: GHOST_EYE_ID, name: cc.name, stacks: spentStacks, reason: "COUNTER_SPENT" });
                }
              }
            },
          });
        }
      }
      /**
       * ★★★ 第 245 轮：**「醉倒」类自伤状态标记**（IR 的 drunk；狸猫 208_02 —— 判据与"为什么必须做"见 skill-compiler 的字段注）。
       *  三条行为全部来自原文：
       *   ① TURN_END：有 chance% 概率醉倒（掷一次，标签 `drunk_roll:<技能>`）；
       *   ② TURN_START：若还醉着 ⇒ **醒来**（expireStatus + 治疗 healRatio% 生命上限）——「直至下回合醒来并治疗…」；
       *   ③ 醉倒时被**敌方**攻击：有 wakeChance% 概率被吵醒（醒来同样治疗），并给**攻击者** wakeBuffRef（上限 wakeBuffCap 层）。
       *  ★ 铁律沿用第 239/240 轮：状态被"花掉"一律走 `expireStatus`（不能用 `remove` —— 它看 removable 标记，实测会**静默失败**）；
       *    条件（是否还醉着）**不掷骰**；只有原文写明的概率才掷，且标签写明用途。
       */
      const dr = (sk?.ir as any)?.drunk;
      if (dr) {
        /** 醒来：移除状态 + 治疗 +（若是被攻击吵醒）给攻击者上 buff —— 三条路径共用这一份实现 */
        const wake = async (reason: string, attacker: any): Promise<void> => {
          const st: any = (e.statuses ?? []).find((x: any) => String(x?.def?.id) === DRUNK_ID);
          if (!st) return;
          e.expireStatus(st);
          battle.trace.push({ t: "STATUS_EXPIRE", id: e.id, status: DRUNK_ID, name: dr.name, stacks: 1, reason });
          const amount = Math.floor(e.maxHp * Number(dr.healRatio) / 100);
          if (amount > 0) await healTarget(battle, e, e, amount);
          if (attacker && dr.wakeBuffRef) {
            const wakeDef = StatusBook.get(String(dr.wakeBuffRef));
            if (wakeDef) {
              const applied: any = attacker.addStatus(wakeDef, e.id, 1, 99999, [], Math.max(1, Number(dr.wakeBuffCap) || 1));
              battle.trace.push({ t: "STATUS_APPLY", src: e.id, dst: attacker.id, status: String(dr.wakeBuffRef), name: wakeDef.name, merged: null, stacks: applied?.stacks ?? null, threshold: Math.max(1, Number(dr.wakeBuffCap) || 1), ref: String(dr.wakeBuffRef), tag: applied?.tag ?? null, duration: null, known: true, skill: sk.name, note: "DRUNK_WAKE" });
            }
          }
        };
        const hidEnd2 = "drunk_end:" + e.id + ":" + sk.name;
        if (!battle.bus.hasHandler(hidEnd2)) battle.bus.register({ id: hidEnd2, ownerId: e.id, code: "TURN_END", range: "ALL", priority: 0, passive: true, source: "PASSIVE", fn: async () => {
          if (!e.alive) return;
          battle.rng.expect("drunk_roll:" + sk.name);
          if (!battle.rng.testHit(Number(dr.chance) / 100)) return;
          const applied: any = e.addStatus(drunkDef(dr.name), e.id, 1, 99999, [], null);
          battle.trace.push({ t: "STATUS_APPLY", src: e.id, dst: e.id, status: DRUNK_ID, name: dr.name, merged: false, stacks: applied?.stacks ?? 1, ref: DRUNK_ID, tag: applied?.tag ?? null, duration: null, known: true, skill: sk.name, note: "DRUNK" });
        } });
        const hidStart2 = "drunk_wake:" + e.id + ":" + sk.name;
        if (!battle.bus.hasHandler(hidStart2)) battle.bus.register({ id: hidStart2, ownerId: e.id, code: "TURN_START", range: "ALL", priority: 0, passive: true, source: "PASSIVE", fn: async () => { if (e.alive) await wake("DRUNK_WOKE_TURN", null); } });
        const hidHit2 = "drunk_hit:" + e.id + ":" + sk.name;
        if (!battle.bus.hasHandler(hidHit2)) battle.bus.register({ id: hidHit2, ownerId: e.id, code: "AFTER_DAMAGE", range: "ALL", priority: 0, passive: true, source: "PASSIVE", fn: async (ctx: any) => {
          if (!e.alive) return;
          const src = ctx?.input?.source ?? null;
          if (!src || src.teamId === e.teamId) return;
          if (!(e.statuses ?? []).some((x: any) => String(x?.def?.id) === DRUNK_ID)) return;
          battle.rng.expect("drunk_wake_roll:" + sk.name);
          if (!battle.rng.testHit(Number(dr.wakeChance) / 100)) return;
          await wake("DRUNK_WOKE_ATTACK", src);
        } });
      }
      /**
       * ★★★ 第 246 轮：**「失去 X 时结束 Y」**（IR 的 endOnLose；蝉冰雪女「永冬」362_03）。
       *   原文「自身获得[buff_3622_1]，若失去[buff_3622_1]则结束[tips_3621]」⇒ 失去监视 ⇒ 结束霜冻。
       *  ★ 判据：只认**监视的那个状态**（别的状态到期不触发）、只清**敌方**身上的该控制；
       *    两条失去路径都挂（`STATUS_EXPIRE` 到期/耗尽 · `STATUS_REMOVE` 被解除），因为原文写的是「失去」。
       *  ★ 结束走 `expireStatus`（第 239 轮那条铁律：内部把状态花掉不用 `remove`）并留痕，reason=`ENDED_ON_LOSE`。
       */
      const el = (sk?.ir as any)?.endOnLose;
      if (el) installEndOnLose(battle, e, el, sk.name);
      if (false) {
        const endIt = async (): Promise<number> => {
          let n = 0;
          for (const foe of battle.enemiesOf(e.teamId)) {
            const st: any = (foe.statuses ?? []).find((x: any) => String(x?.def?.id) === String(el.removeRef));
            if (!st) continue;
            const stacks = Number(st.stacks ?? 0);
            foe.expireStatus(st);
            battle.trace.push({ t: "STATUS_EXPIRE", id: foe.id, status: String(el.removeRef), name: el.removeName, stacks, reason: "ENDED_ON_LOSE" });
            n++;
          }
          return n;
        };
        for (const code of ["STATUS_EXPIRE", "STATUS_REMOVE"]) {
          const hid = "end_on_lose:" + code + ":" + e.id + ":" + sk.name;
          if (battle.bus.hasHandler(hid)) continue;
          battle.bus.register({ id: hid, ownerId: e.id, code, range: "ALL", priority: 0, passive: true, source: "PASSIVE", fn: async (ctx: any) => {
            if (!e.alive) return;
            const lost = String(ctx?.input?.status ?? ctx?.input?.name ?? "");
            if (lost !== String(el.watchRef)) return;
            await endIt();
          } });
        }
      }
      // ★★ 先解析占位符再分类：`[tips_2]` → `[基础概率]`。不解析就会把"40% 概率"看成"无条件"（第 69 轮）。
      const { res, units } = classifySkill(sk, opts.tips);
      report.tipsResolved += res.hit.length;
      for (const id of res.miss) if (!report.tipsMissed.includes(id)) report.tipsMissed.push(id);
      /**
       * ★★★ 第 141/142 轮：**叠层场地（花海）的装配点** —— 位置很关键：必须在下面那道
       *   `if (!units.length) continue` **之前**。
       *   第一版把它放在逐句注册的循环里，于是「赤团华」这种**一句话都没有触发族**的被动
       *   （花海六条判据全是常驻规则）会在那道闸门处 continue 掉 ⇒ 机制永远不装、
       *   层数恒为 0（g93 第 [2] 节当场照出来：installed 标记不在）。
       *   ★ 另一个坑：`installLayerField` 必须是**同步**的（它只注册订阅、没有 await），
       *     否则装配循环（同步）里会出现 await。
       */
      if (sk?.ir?.layerField) {
        const raw: LayerFieldSpec = sk.ir.layerField;
        const spec: LayerFieldSpec = { ...raw, shield: null };
        // 跨技能引用：原文『[skill_288_03]』的护盾按 id 在**拥有者自己的技能表**里取
        if (raw.shieldFrom) {
          const ref = (e.skills ?? []).find((s: any) => String(s?.ir?.id ?? "") === String(raw.shieldFrom));
          const sh = ref?.ir?.shield?.[0];
          spec.shield = sh ? { ratio: sh.ratio, base: sh.base } : null;
        }
        if (installLayerField(battle, e, spec) > 0) {
          report.layerFields.push({ entityId: e.id, skill: sk.name, term: spec.term, startLayers: spec.startLayers });
        }
      }
      /**
       * ★★★ 第 95 轮：**逐句注册**，不再"一个被动一个处理器"。
       *
       * 三处实测都撞在同一堵墙上：九命猫「九命」（暴击 / 阵亡×2）、骨女「怨生」（受到攻击 / 阵亡）、
       * 阿香「蛇之影」（攻击 / 受到伤害）。旧模型只挑**一族**，于是
       *   · 另一句的效果永远挂不上（复活 / 反击）；
       *   · 一句话的条件会**顺带管住**另一句本来无条件的话。
       * ⇒ 每一句是它自己的触发单元：各自判条件、各自过"未建模动词"闸门、各自注册。
       */
      if (!units.length) { report.skipped.noTrigger++; continue; }
      // ★ 第 129 轮：元素类型补上 verb —— 下面那道"追加施放不挡执行"的例外要按**动词**判
      const um = (sk?.ir?.unmodeledMechanics ?? []) as Array<{ clause?: string; verb?: string }>;
      /**
       * ★★★ 第 95 轮：**反击只在"写着反击的那一句"上生效**。
       *
       * 判据：把 `ir.counter.evidence`（解析器认定的那一句）与每个单元的句子**归一化后**比对，
       * 只有包含它的那个单元才装反击。为什么必须这么严：
       *   萤草「生花」有三句 —— 第一句「受到攻击时，治疗攻击15%的生命」（这一个是**能装**的单元）、
       *   第三句才是「…并对其进行反击」。若不比对，第一句一触发就会顺带反击，
       *   而原文给反击加了两个条件（攻击力低于萤草 / 单个回合限1次）—— 那是**多算**。
       *   「多算」比「少算」更坏：它会让 Fidelity 把没实现的条件说成实现了。
       */
      const counterEvidence = norm(sk?.ir?.counter?.evidence ?? "");
      const counterUnit = counterEvidence
        ? units.findIndex(u => { const nu = norm(u.clause); return nu.length > 4 && (nu.includes(counterEvidence) || counterEvidence.includes(nu)); })
        : -1;
      /**
       * ★★★ 第 129 轮：**触发式自复活只挂在"写着复活的那一句"上**（与反击同一条规矩）。
       *
       * 九命猫「九命」有三句：暴击时（叠层）/ 阵亡时（复活+治疗）/ 阵亡时（给伤害来源附加状态）。
       * 后两句**都**注册在 DEATH 上，而 `selfRevive` 是**技能级**字段 —— 不比对子句的话，
       * 两句都会去尝试复活（靠 applySelfRevive 的 NOT_DEAD 幂等兜住，但"谁该做这件事"就说不清了，
       * 触发式复活的 trace 也会挂在错的那一句上）。
       */
      /**
       * ★★★ 第 135 轮：**追加施放也只挂在写着它的那一句上**（与反击/自复活同一条规矩）。
       */
      const scEvidence = (sk?.ir?.subCasts ?? []).map((x: any) => norm(x.clause ?? "")).filter(Boolean);
      const subCastUnit = scEvidence.length
        ? units.findIndex(u => { const nu = norm(u.clause); return nu.length > 4 && scEvidence.some((ev: string) => nu.includes(ev) || ev.includes(nu)); })
        : -1;
      const srEvidence = norm(sk?.ir?.selfRevive?.clause ?? "");
      const selfReviveUnit = srEvidence
        ? units.findIndex(u => { const nu = norm(u.clause); return nu.length > 4 && (nu.includes(srEvidence) || srEvidence.includes(nu)); })
        : -1;
      for (let ui = 0; ui < units.length; ui++) {
        const u = units[ui];
        if (u.verdict === "HAS_PLACEHOLDER") { report.skipped.hasPlaceholder++; continue; }
        if (u.verdict !== "CANDIDATE") {
          report.skipped.hasCondition++;
          // ★ 分开记账：报告要能说清"下一步该修条件模型，还是该修这个效果"
          if (u.blockedBy === "EFFECT") report.skipped.byEffect++; else report.skipped.byCondition++;
          continue;
        }
        /**
         * ★★★ 逐句的「未建模动词」闸门（第 87 轮的判据，第 89 轮修好归一化，第 95 轮改成逐句）。
         *   归一化后比较：`v.clause` 来自 resolveTips 之后的文本，`u.clause` 是 IR 里的原文。
         */
        const nc = norm(u.clause);
        if (um.some(x => {
          /**
           * ★★★ 第 129 轮：**「追加施放」不挡这一句的执行**（记账照旧、执行不牵连）。
           *
           * 九命猫「九命」的复活句里还有半句「并对随机敌方目标施放『skill_207_03』」——
           * 它没有行为代码（编译器合成了一条 WARN 记录，Fidelity 面板与 compile-census 都看得见），
           * 但它**不是这一句的效果**：这一句的效果是"复活并恢复20%生命"，那半边有执行点。
           * 不让它挡，就是让能做的先做起来；挡了则整句不注册，于是 IR 说"复活已建模"、
           * 运行时**什么都不做** —— 那份声明会变成谎话（本仓库最不能接受的方向）。
           *
           * ★ 只在 IR 真有 selfRevive 产物时才放行：没有产物时这句话照旧被挡在外面，
           *   而且同一句里若还有**别的**未建模动词，它们照样能把它挡下（这里只放过这一个 verb）。
           */
          if (sk?.ir?.selfRevive && x.verb === APPEND_CAST_VERB) return false;
          const nu = norm(x.clause ?? "");
          return nu.length > 6 && !!nc && (nc.includes(nu) || nu.includes(nc));
        })) {
          report.skipped.hasCondition++; report.skipped.byEffect++; continue;
        }
        /**
         * ★ 整条技能的"有没有事可做"（第 88 轮）—— 仍然是**整条**的判据：
         *   逐句归因需要 IR 每个字段都带 evidence，而今天只有一部分带（statusRefs/heal/damage 不带）。
         *   逐句的缺口由上面那道"未建模动词"闸门兜住（它精确到句子）。
         */
        if (!hasExecutableSurface(sk?.ir)) { report.skipped.hasCondition++; report.skipped.byEffect++; continue; }
        const fam = TRIGGER_FAMILIES.find(f => f.family === u.family);
        const code = fam?.evCode ?? null;
        if (!code || !DISPATCHED.has(code)) { report.skipped.noDispatch++; continue; }
        /**
         * ★★★ 第 129 轮：「**阵亡时，对伤害来源附加…**」这一族**不安装**（失败关闭 + 单独记账）。
         *
         * 为什么是这一轮才暴露：在此之前，「阵亡时」的处理器在 EV.DEATH 派发**之前**就被注销了
         *   （旧的 resolveLethal 里有 unregisterOwner），这一族**从来没有执行过**。
         *   第 129 轮接通死亡级联之后它第一次真的跑起来 —— 探针（tools/_probe-death3rd.ts）实测：
         *   九命猫「九命」第三句「阵亡时，对伤害来源附加[buff_2073_1]」把状态加到了
         *   **随机一个敌人**身上（击杀者是 203，状态落在 201）：因为承受者来自**技能级** targeting
         *   （这一句的"随机敌方目标"其实是隔壁那句「并对随机敌方目标施放『X』」解析出来的），
         *   而不是原文点名的"伤害来源"。
         *
         * 第 129 轮的处置：按本仓库的既定顺序（**算错比少算更坏**）⇒ 失败关闭、装都不装，并留一条 trace 与一个桶。
         *   ★ 第 176 轮改成**有条件放行** —— 逐句承受者归属接上之后，判据见下面那一段。
         *   ★ 为什么只对「阵亡」族关：受击类（如天照「无灭」的「受到敌方攻击时，为伤害来源附加…」）
         *     是**既有行为**，一直按技能级 targeting 选目标 —— 那一类属于"逐句归因"这条更大的缺口，
         *     要动就得先有逐句的 IR 证据（这里不动它，另行记账，见第 129 轮报告）。
         */
        if (u.family === "阵亡" && /伤害来源/.test(u.clause)) {
          /**
           * ★★★ 第 176 轮：**这一族现在可以装了 —— 前提是逐句承受者归属真的接上了。**
           *
           * 第 129 轮把它整条关掉是对的：承受者当时来自技能级 targeting，实测把状态加到了**随机一个敌人**
           *   身上（击杀者 203、状态落在 201）——「算错比少算更坏」。
           * 现在编译产物 `sk.ir.sourceBearerRefs` 逐句记下了"哪条子句点名来源、用的是哪个 buff 引用"，
           *   执行侧（compile/character.ts 的 damageSourceOf）会把它投给**事件来源**。
           *
           * 放行判据（fail-closed，逐条都对得上才放）：这一句里出现的**每一个** `[buff_x]` 引用，
           *   都必须在 sourceBearerRefs 里有**同子句**的证据。少一个 ⇒ 照旧不装、照旧记 byTarget。
           *   ★ 这样写还有一个副作用是想要的：**引用解析不出来的**（例如匣中少女的"随机减益"）继续关着。
           */
          const bearerRefs = ((sk?.ir?.sourceBearerRefs ?? []) as Array<{ ref: string; clause: string }>);
          const clauseRefs = Array.from(String(u.clause).matchAll(/\[buff_([0-9_]+)\]/g)).map((m: any) => m[1]);
          const nb = norm(u.clause);
          const bearerAll = clauseRefs.length > 0 && clauseRefs.every((r: string) => bearerRefs.some((b: any) =>
            String(b.ref) === r && (nb.includes(norm(b.clause)) || norm(b.clause).includes(nb))));
          if (!bearerAll) {
            report.skipped.byTarget++;
            battle.trace.push({
              t: "PASSIVE_SKIPPED", entity: e.id, skill: sk.name, family: u.family, event: code,
              clause: u.clause, reason: "DAMAGE_SOURCE_TARGET_NOT_PER_CLAUSE",
            });
            continue;
          }
          report.sourceBearerFields.push({ entityId: e.id, skill: sk.name, clause: String(u.clause), refs: clauseRefs });
        }

      /**
       * ★ 重入保护：一个"受到伤害时"的被动如果自己也造成伤害，会再次触发 AFTER_DAMAGE。
       *   事件总线有 maxDepth 兜底（g1 压过），但这里再加一道单处理器级的闸门 ——
       *   被动**不递归触发自己**，这是它作为"附加效果"的语义，而不是靠深度上限侥幸不爆栈。
       */
      const cond = u.condition ?? null;
      if (cond) { report.conditioned++; report.conditionKinds[cond.kind] = (report.conditionKinds[cond.kind] ?? 0) + 1; }
      /**
       * ★★★ 第 95 轮：**目标侧**的族必须换个注册方式。
       *
       * `EV.BEFORE_DAMAGE / AFTER_DAMAGE` 的 origin 是**伤害来源**，所以
       *   · 源侧族（造成伤害 / 攻击 / 暴击）：`range: SELF` 天然正确；
       *   · 目标侧族（受到伤害 / 受到攻击 / 被攻击 / 受到敌方攻击）：`range: SELF` 只会匹配到
       *     "伤害来源恰好是自己" —— 也就是说一条「受到伤害时」的被动会在**自己打人的时候**触发。
       *     正确做法：`range: ALL` + 处理器里按 `ctx.input.target.id` 过滤，且**失败关闭**
       *     （拿不到 target 就不放行）。
       */
      const targetSide = fam?.side === "TARGET";
      const requiresCrit = !!fam?.requiresCrit;
      /**
       * ★★★ 第 179 轮：**主语 → 总线 range**（第 178 轮勘定出来的那一维，见 kernel/triggers.ts 的 TriggerSubject）。
       *   · 目标侧族（side=TARGET）仍然 range ALL + 处理器里按事件形状过滤目标（第 95 轮）；
       *   · 主语 = 敌方 ⇒ ENEMY（「非召唤物的敌方目标回合结束时…」）；
       *   · 主语 = 任意 ⇒ ALL（「全体目标回合结束时…」）；
       *   · 其余（自己 / **友方**）⇒ SELF —— ★ 友方**暂缓**：'友方'要不要排除自己
       *     （「其他友方」要排、「任一友方」多半不排）还需要一次裁定；裁定之前保持今天的 SELF
       *     （fail-closed：宁可少算，不许算错）。见报告 §151.4。
       */
      const subject: string = (u as any).subject ?? "SELF";
      /**
       * ★★★ 第 189 轮：**友方（TEAM）接上了** —— 第 179 轮暂缓的那一批。
       *
       *   · 源侧族（造成伤害 / 回合结束 / 阵亡 …）：主语是**事件的来源** ⇒ range = TEAM；
       *   · 目标侧族（受到伤害 / 受到攻击 …）：仍然 range ALL + 处理器里按事件形状过滤，
       *     过滤条件由主语决定（见下面 SUBJECT_TARGET_FILTER）。
       *
       *   为什么现在能接：'友方' 要不要排除自己**有文本证据**，不需要猜 —— KB 自己就用
       *   「其他友方 / 其余友方 / 除自身外的 / 非自身的 / 自身外的」表示不含自身，
       *   而「任一友方 / 所有友方 / 全体友方 / 自身及友方」用在不排除自己的地方
       *   （kernel/triggers.ts 的 EXCLUDES_SELF_RE 就是这一份证据）。
       */
      const excludesSelf = !!(u as any).subjectExcludesSelf;
      const requiresStatus: string | null = (u as any).subjectRequiresStatus ?? null;
      const range: "SELF" | "TEAM" | "ENEMY" | "ALL" = targetSide ? "ALL"
        : subject === "ENEMY" ? "ENEMY"
        : subject === "ALLY" ? "TEAM"
        : subject === "ANY" ? "ALL"
        : "SELF";
      /**
       * ★★★ 第 189 轮：**主语决定了"谁是承受事件的那个实体"**（处理器里的过滤条件）。
       *   源侧族的"那一个实体"就是事件的**来源**；目标侧族则是事件的**目标**。
       *   失败关闭：取不到实体 ⇒ **不触发**（宁可少算）。
       */
      const subjectEntity = (ctx: any): any => {
        if (targetSide) return ctx?.input?.target ?? ctx?.target ?? ctx?.entity ?? null;
        return ctx?.input?.source ?? ctx?.source ?? ctx?.actor ?? ctx?.target ?? ctx?.entity ?? null;
      };
      let busy = false;
      battle.bus.register({
        id: `passive:${e.id}:${sk.name}:${ui}`, ownerId: e.id, code,
        range: range as any,
        priority: 0, passive: true,
        source: "PASSIVE",   // ★ 第 96 轮：封印（被动失效）按这个标记挡
        fn: async (ctx: any) => {
          if (busy) return;
          if (targetSide) {
            /**
             * ★★★ 第 123 轮：目标侧「谁是目标」必须按**事件形状**取，不能只认伤害事件。
             *   伤害类（BEFORE/AFTER_DAMAGE）载荷是 `{ input: { target } }`；
             *   而第 120/122 轮接上总线的治愈 / 状态 / 护盾事件用的是 `{ target }` 或 `{ entity }`。
             *   只认 `input.target` 的后果：一条「被施加…时」的被动**永远不触发**（fail-closed 把它全挡了），
             *   而「永远不触发」与「没实现」在账上长得一模一样 —— 这正是本仓库反复抓的那类静默。
             */
            const t = ctx?.input?.target?.id ?? ctx?.target?.id ?? ctx?.entity?.id;
            /**
             * ★★★ 第 189 轮：目标侧族的过滤条件**由主语决定**（此前写死 t === e.id）：
             *   · SELF（默认）—— 拥有者自己就是承受者：`t === e.id`；
             *   · ENEMY —— 承受者必须是拥有者的**敌方**（「带有[buff]的敌方受到伤害时」）；
             *   · ALLY —— 承受者必须是拥有者的**友方**；带排除标记时还要 `t !== e.id`；
             *   · ANY —— 不筛（任一方都算）。
             *   ★ 拿不到实体（t === undefined）一律**不放行**：与第 95 轮立的规矩一致。
             *   ★ 敌我判定用**实体自己的 teamId**，不走 teamOf 回调 —— 处理器只有 ctx，没有 battle.teamOf。
             */
            if (t === undefined || t === null) return;
            if (subject === "ENEMY") { const ent = ctx?.input?.target ?? ctx?.target ?? ctx?.entity ?? null; if (!ent || ent.teamId === e.teamId) return; }
            else if (subject === "ALLY") { const ent = ctx?.input?.target ?? ctx?.target ?? ctx?.entity ?? null; if (!ent || ent.teamId !== e.teamId) return; if (excludesSelf && t === e.id) return; }
            else if (subject === "ANY") { /* 任一方都算 */ }
            else if (t !== e.id) return;
          }
          /**
           * ★★★ 第 189 轮：**源侧族的"排除自己"**（「其他友方造成伤害时」）。
           *   源侧的"承受事件的那个实体"就是事件的**来源**：range=TEAM 已经把范围收在同一个队伍里，
           *   这里再把拥有者自己摘掉。取不到来源 ⇒ **不触发**（失败关闭）。
           */
          if (!targetSide && excludesSelf) {
            const ent = subjectEntity(ctx);
            if (!ent || ent.id === e.id) return;
          }
          /**
           * ★★★ 第 189 轮：**限定语带来的状态条件**（「带有[buff_x]的敌方…」）。
           *   拿不到那个实体、或它身上没有这个状态 ⇒ 不触发。失败关闭。
           *   ★ 位置放在族过滤之后、概率之前：它是**主语的一部分**（谁身上发生这件事），
           *     不是"效果的概率"，所以不掷骰子、也不进 RNG 账本。
           */
          if (requiresStatus) {
            const ent = subjectEntity(ctx);
            const has = !!ent && Array.isArray(ent.statuses) && ent.statuses.some((x: any) => String(x?.def?.id ?? "") === requiresStatus);
            if (!has) return;
          }
          if (requiresCrit && !ctx?.result?.isCrit) return;
          // ★★★ 第 75 轮：**已建模的概率条件** —— 「有 X% 概率 …」必须真的掷，掷不中就不执行。
          //
          // 这是第 69 轮那个错误的正面修法：那一轮我发现「有40%[tips_2]…」的 40% 会被
          // 执行成 100%，当时的处置是**整条不挂**（宁可少算也不能算错）。
          // 现在概率被解析出来了，就可以挂上并如实掷 —— 从"因噎废食"变成"按规则执行"。
          //
          // 走 battle.rng（而不是 Math.random）：掷数要进 stateHash / 快照 / RNG parity，
          // 否则同一 seed 两次结果不同，重放也会对不上。
          /**
           * ★★★ 第 189 轮：**同一个概率不许掷两次**（本轮实测发现的第二处算错）。
           *
           * 由来：同一条文案「有N%概率使其获得[buff_x]」被**两套机制**各读了一次 ——
           *   · 触发侧：judgeClause 把「有N%概率」解析成 cond（第 75 轮），处理器在这里掷一次；
           *   · 效果侧：编译器把它归因到具体槽位 effectProbs（第 15 轮），execute 在槽位上再掷一次。
           *   两次都掷 ⇒ 实际概率是 **p 的平方**：50%→25%、30%→9%、10%→**1%**。
           *   实测（tools/_probe-doubleroll189.ts）：**8 条**装上的触发句命中这个形状，
           *   最典型的是青行灯「明灯」—— 400 次「友方回合开始」只命中 7 次（≈1.75%，而原文写的是 10%）。
           *
           * 判据：这条概率**已经被归因到属于这一句的效果槽位**上（effectProbs 里有一条同值、
           *   且它的证据子句落在本条触发句里）⇒ 触发侧**不再掷**（由效果侧掷，总次数仍然是 1）。
           *   ★ fail-closed：找不到对应槽位就照旧在触发侧掷（与今天逐位相同）。
           */
          const probOwnedByEffect = cond?.kind === "PROBABILITY"
            ? (sk?.ir?.effectProbs ?? []).some((p: any) => Math.abs(Number(p.probability) - cond.p * 100) < 1e-9 && clauseCoversEvidence(u.clause, p.evidence))
              /**
               * ★★★ 第 194 轮：**池子的概率也算「已被效果侧认领」**（否则同一条 100% 会被掷两次）。
               *   判据与上面那条完全同型：同值 + 证据子句落在这条触发句里。
               */
              || (sk?.ir?.randomStatuses ?? []).some((p: any) => p.probability !== null && p.probability !== undefined && Math.abs(Number(p.probability) - cond.p * 100) < 1e-9 && clauseCoversEvidence(u.clause, p.clause))
            : false;
          if (cond?.kind === "PROBABILITY" && !probOwnedByEffect) {
            battle.rng.expect("passive_prob:" + e.id + ":" + sk.name);
            if (!battle.rng.testHit(cond.p)) return;
          }
          // ★★★ 第 87 轮：**运行时条件求值** —— 「若拥有N层[buff_X]」。
          //   在触发的**这一刻**去读拥有者身上的层数；不够就**不执行**。
          //   与概率不同，这里不掷骰子（它是确定性的状态检查），所以不进 RNG 账本。
          if (cond?.kind === "STACK_AT_LEAST") {
            const st = (e.statuses ?? []).find((x: any) => String(x.def?.id ?? "") === cond.statusRef);
            const stacks = st ? Number(st.stacks ?? 0) : 0;
            if (stacks < cond.n) return;
          }
          /**
           * ★★★ 第 93 轮：**吸血类被动不是靠 execute 生效的。**
           *
           * 它的原文是「造成伤害时，附带 15% 吸血」（夜刀神「夜之邀约」）或
           * 「造成伤害时，有 50% 概率附带 20% 吸血」（三尾狐「诱惑」）——
           * 这个技能**自己一次伤害都不造成**，所以它的 execute 是空的；
           * 要读的是"刚刚那一下打了多少"，而那个数字就在 `ctx.result.applied` 里
           * （AFTER_DAMAGE 在 mutateHp **之后**派发；而 EV.DAMAGE 在之前派发、那时 applied 还是 0）。
           *
           * ★ 为什么要校验 `ctx.input.source.id === e.id`：
           *   这一族映射到 AFTER_DAMAGE，而「受到伤害」族**共用同一个事件码**（见 kernel/triggers.ts 的注）。
           *   万一哪天映射到受击侧，这里会变成"挨打回血" —— 一个不会报错的错。
           *   校验之后它是**失败关闭**的：拿不到来源就什么都不做。
           */
          const ls = sk?.ir?.lifesteal;
          if (ls && ctx?.result && ctx?.input?.source?.id === e.id) {
            await applyLifesteal(battle, e, ls.ratio, ctx.result, "passive:" + sk.name);
          }
          /**
           * ★★★ 第 105 轮：**造成伤害时触发的偷取**（首无「冥火」：「造成伤害时，偷取目标40%暴击，
           *   持续1回合。同时间内只能对一个目标生效」）。与吸血类被动同型：这个技能自己一次伤害都不造成，
           *   要知道"刚刚那一下打了谁" ⇒ 取 ctx.input.target，并校验来源是自己（失败关闭）。
           */
          /**
           * ★★★ 第 107 轮：**施放技能前**的偷取（噬魂：「施放『焚天九尾』前，先偷取场上全体3%攻击力…」）。
           *   这一族映射到 SKILL_START（第 74 轮就有派发点），所以先确认"现在要放的正是那个技能"，
           *   然后对**敌方全体**逐个偷（原文写「场上全体」，读作敌方 —— 这是默认读法，记在事件里）。
           */
          const preSteals = (sk?.ir?.steals ?? []).filter((x: any) => x.trigger === "PRE_CAST");
          /**
           * ★★★ 第 108 轮：**这一族的触发是"点名技能"的** —— 「施放『焚天九尾』前」不是「攻击时」。
           *   实测（tools/_probe-prec5.ts）：强制放普攻（339_01）时，旧代码虽然跳过了偷取，
           *   却继续往下走 `execute`，而 execute 又进主动执行点 —— 于是**放普攻也偷了 5 个敌人**。
           *   判据取自 IR 自己：trigger=PRE_CAST 且带 onSkill 的偷取，现在要放的**不是**那个技能就整条不执行。
           *   （失败关闭：拿不到技能 id 也算不匹配。）
           */
          if (preSteals.length && ctx?.actor?.id === e.id && ctx?.skill) {
            const skillId = String(ctx.skill?.ir?.id ?? ctx.skill?.id ?? "");
            if (preSteals.every((x: any) => x.onSkill) && !preSteals.some((x: any) => x.onSkill === skillId)) return;
            for (const st of preSteals) {
              if (st.onSkill && st.onSkill !== skillId) continue;
              for (const foe of battle.enemiesOf(e.teamId)) {
                if (!foe.alive) continue;
                const r = applyStatSteal(battle, e, foe, { ...st, scopeSource: st.scopeSource ?? "DEFAULT" } as any);
                if (!r.applied && r.reason !== "CAP_TOTAL") battle.trace.push({ t: "STAT_STEAL_BLOCKED", src: e.id, dst: foe.id, skill: sk.name, reason: r.reason });
              }
            }
          }
          const dmgSteals = (sk?.ir?.steals ?? []).filter((x: any) => x.trigger === "ON_DAMAGE");
          if (dmgSteals.length && ctx?.input?.source?.id === e.id && ctx?.input?.target?.alive) {
            for (const st of dmgSteals) {
              if (st.probability !== null && st.probability !== undefined) {
                battle.rng.expect("steal_prob:" + (st.prop ?? "random") + ":" + sk.name + ":" + ctx.input.target.id);
                if (!battle.rng.testHit(st.probability)) continue;
              }
              const r = applyStatSteal(battle, e, ctx.input.target, st);
              if (!r.applied) battle.trace.push({ t: "STAT_STEAL_BLOCKED", src: e.id, dst: ctx.input.target.id, skill: sk.name, reason: r.reason });
            }
          }
          busy = true;
          try {
            /**
             * ★★★ 第 129 轮：**触发式自复活**（「阵亡时，若拥有4层…立即复活并治疗生命上限20%的生命」）。
             *
             * 位置：在 counter / execute **之前**，并且这一句**不再走 execute** ——
             *   这一句的效果只有"复活 + 治疗N%"，而 applySelfRevive 两件都做了；
             *   再走一遍 execute 会把同句里的治疗**治第二次**（骨女「怨生」的 heal: 20%/maxHp
             *   是编译产物里真实存在的字段）—— 那是多算 20% 生命上限，而且不会报错。
             */
            const sr = sk?.ir?.selfRevive;
            if (sr && ui === selfReviveUnit) {
              const rev = await applySelfRevive(battle, e, sr);
              /**
               * ★★★ 第 135 轮：**复活之后再施放**（原文语序：「则会立即复活并…，并对随机敌方目标施放『X』」）。
               *   所以施放放在这里（而不是走 execute）—— 复活失败时**不施放**（人没回来，放什么技能）。
               */
              if (rev.fired && ui === subCastUnit) {
                for (const spec of (sk?.ir?.subCasts ?? [])) await castTriggeredSkill(battle, e, spec);
              }
              return;
            }
            /**
             * ★★★ 第 135 轮：**只施放、没有别的效果的子句**（先机：施放『X』）——
             *   执行点是 castTriggeredSkill，不走 execute（execute 会把整条技能的**所有**子句效果再来一遍，
             *   那是"再放一次这个被动"，不是"施放那个被点名的技能"）。
             */
            if (ui === subCastUnit && !sr) {
              for (const spec of (sk?.ir?.subCasts ?? [])) await castTriggeredSkill(battle, e, spec);
              return;
            }
            /**
             * ★★★ 第 95 轮：**反击** —— 这一句的效果不是"执行本技能"，而是"打回去"。
             *   判据取自编译产物（`ir.counter`），执行走 `Battle.counterAttack`
             *   （伪回合 + 强制普攻 + 防连锁），不再经过 execute ——
             *   execute 会把整条技能的**所有**效果再放一遍（那是"再放一次技能"，不是反击）。
             */
            const c = sk?.ir?.counter;
            if (c && ui === counterUnit) {
              const attackerId = ctx?.input?.source?.id;
              if (typeof attackerId === "number") await battle.counterAttack(e, attackerId);
            }
            const enemies = battle.enemiesOf(e.teamId);
            const target = sk.pickTarget ? sk.pickTarget(battle, e, enemies) : (enemies[0] ?? e);
            /**
           * ★★★ 第 181 轮：**逐句效果归因** —— 触发的是这一句（u.clause），就只施加属于它的状态引用。
           *   statusRefSlotsForClause 返回 null = 这条技能没有逐句证据 ⇒ 照旧全放（与今天逐位相同）；
           *   返回数组（可能是空的）= 严格按证据 —— 空数组意味着这一句不施加任何状态（宁可少算，不许把隔壁子句的也算上）。
           */
          const onlyStatusSlots = statusRefSlotsForClause(sk?.ir, u.clause);
          /**
           * ★★★ 第 188 轮：**逐句效果归因的第二批** —— 同一句话里的 damage / heal / shield / timeline
           *   也按句收窄（第 181 轮只做了状态引用那一族）。见 compile/character.ts 的 onlyEffectSlots。
           * ★ 某一族返回 null = 这条技能没有那一族的证据 ⇒ **不放进 opts**（执行侧照旧全放，逐位不变）。
           */
          const onlyEffectSlots: EffectSlotFilter = {};
          for (const k of ["damage", "heal", "shield", "timeline"] as const) {
            const slots = effectSlotsForClause(sk?.ir, u.clause, k);
            if (slots) onlyEffectSlots[k] = slots;
          }
          const hasEffectEvidence = Object.keys(onlyEffectSlots).length > 0;
          /**
           * ★★★ 第 194 轮：**池子（随机增益/随机减益）也按句收窄**（与状态引用、四个效果族同型）。
           *   没这个键 = 这条技能没有池子 ⇒ 调用方不放它（与今天逐位相同）；有键 = 严格按证据。
           */
          const onlyPoolSlots = randomPoolSlotsForClause(sk?.ir, u.clause);
          /** ★★★ 第 195 轮：**控制占位符也按句收窄**（与状态引用 / 四个效果族 / 池子同型） */
          const onlyControlSlots = controlSlotsForClause(sk?.ir, u.clause);
          await sk.execute(battle, e, target, ctx,
            (onlyStatusSlots || hasEffectEvidence || onlyPoolSlots || onlyControlSlots)
              ? { ...(onlyStatusSlots ? { onlyStatusSlots } : {}), ...(hasEffectEvidence ? { onlyEffectSlots } : {}), ...(onlyPoolSlots ? { onlyPoolSlots } : {}), ...(onlyControlSlots ? { onlyControlSlots } : {}) }
              : undefined);
          } finally { busy = false; }
        },
      });
        report.installed.push({ entityId: e.id, skill: sk.name, family: u.family!, event: code, probability: cond?.kind === "PROBABILITY" ? cond.p : null, clause: u.clause, subject, range, excludesSelf, requiresStatus });
      }
    }
  }
  return report;
}
