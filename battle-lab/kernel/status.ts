// kernel/status.ts — 官方[25] 5 分类 + 官方[3] 控制效果 16 种
// 官方[15] 维持：存在回合数以【来源】的回合计算，而非目标回合。
import { StatusCategory } from "./types.ts";

export interface StatusDef {
  id: string; name: string; category: StatusCategory;
  /** 官方[3]：后九者无法被驱散；霜冻无法被解除 */
  dispellable: boolean; removable: boolean;
  preventsAction: boolean; preventsSkill: boolean; forcesBasicAttack: boolean;
  suppressPassive: boolean; suppressSoul: boolean; locksTimeline: boolean;
  durationPolicy: "SOURCE_TURN" | "TARGET_TURN" | "GLOBAL";   // 官方[15] 默认 SOURCE_TURN
  /**
   * ★★★ 第 94 轮：这个状态**自带免疫**什么 —— 来源是 **buff 原文**（data/kb/buffs.json 的 desc），
   * 不是技能文案。实测 338 条 buff 里 12 条写了免疫/禁复活语义。
   *
   * 为什么只能从 buff 原文取：技能文案里的「期间自身免疫[tips_103]」是**窗口式**声明，
   * 它要靠某个状态存在来兑现；而「免疫控制效果」这种**属性**写在 buff 自己身上，
   * 是状态的生命周期决定的 —— 状态在，免疫就在。
   *
   * 取值只收**能从原文无歧义读出**的四类：
   *   CONTROL  ← 「免疫控制效果 / 免疫所有控制效果」（判定与 isActionPrevented 同源）
   *   DEBUFF   ← 「免疫减益」（★ 是否连控制一起免，是红区 G，见 kernel/policies.ts）
   *   DAMAGE   ← 「免疫伤害 / 免疫所有伤害」
   *   BANISH   ← 「免疫…放逐」
   * ★ 刻意**不收**的：「无法被驱散」（那是 dispellable，另一个字段，早就在用）、
   *   「无法受到改变行动条的效果」（那是这个状态**自己**锁条 = locksTimeline，不是给别人免疫）。
   */
  immuneTo?: ImmuneKind[] | null;
  /** ★ 第 94 轮：这个状态**禁止复活**（原文「无法被复活 / 无法触发复活效果」）→ 维护 Entity.reviveBlocked */
  blocksRevive?: boolean;
  /** ★ 第 94 轮：免疫**消耗一层**（原文「受到控制效果时消耗1层，免疫该控制效果」） */
  consumeOnImmune?: boolean;
  /**
   * ★ 第 94 轮：**免死**（原文「免疫首次/下1次受到的致命伤害」／「受到致命伤害…剩余1点生命」）。
   *   FULL = 那次致命伤害被完全免除（血量回到受击前）；ONE = 活下来但只剩 1 点。
   *   触发一次就消耗一层（有层数时）并置 Entity.undeathUsed —— 这个字段同样此前从未被置为 true。
   */
  preventsLethal?: "FULL" | "ONE" | null;
  /**
   * ★★★ 第 100 轮：**放逐**（第五类可被免疫拦下的东西，也是唯一"不是控制效果但也不是纯标记"的一类）。
   *   为什么需要这个字段：`immuneTo` 里的 BANISH 从第 94 轮起就有，但**没有任何一个状态是"放逐"** ——
   *   于是「免疫放逐」这条免疫声明无物可免（同型问题见 §83.4 的"有字段没读者"）。
   */
  banish?: boolean;
  desc: string;
}

/** ★ 第 94 轮：可被「免疫」拦下的类别（新增一种时，三处必须同时改：这里、buff 解析、测试） */
export type ImmuneKind = "CONTROL" | "DEBUFF" | "DAMAGE" | "BANISH";

/**
 * ★★★ 第 98 轮：**从原文认出免疫项的规则表**（唯一一份）。
 *
 * 第二份拷贝的由来：放置单位规格（kernel/summon.ts）也要从 tips 原文里认「免疫伤害、减益、控制效果和放逐」，
 * 第一版直接在那边又写了一遍四个字符串，于是词汇普查当场抓到一组新的跨文件重复词表。
 * 现在规则表只在**声明 ImmuneKind 的同一个文件**里，使用者 import —— 判据从声明派生，不写第二份。
 *
 * ★ 跨度（`[^。]{0,n}`）不是随手写的：余烬原文「免疫伤害、减益、控制效果和放逐」里
 *   「免疫」到「放逐」隔了 **11 个字**，写 {0,10} 时 BANISH 被**静默漏掉**
 *   （immuneTo 少一项，不报错、不报警，看起来完全正常）。g59 逐项断言四类必须全在。
 */
export const IMMUNE_TEXT_RULES: Array<{ kind: ImmuneKind; re: RegExp; src: string }> = [
  { kind: "DAMAGE",  re: /免疫伤害/,             src: "「免疫伤害 / 免疫所有伤害」" },
  { kind: "DEBUFF",  re: /免疫[^。]{0,8}减益/,   src: "「免疫减益」" },
  { kind: "CONTROL", re: /免疫[^。]{0,8}控制/,   src: "「免疫控制效果」" },
  { kind: "BANISH",  re: /免疫[^。]{0,14}放逐/,  src: "「免疫…放逐」" },
];

const S = (o: Partial<StatusDef> & { id: string; name: string; category: StatusCategory; desc: string }): StatusDef => ({
  dispellable: true, removable: true, preventsAction: false, preventsSkill: false,
  forcesBasicAttack: false, suppressPassive: false, suppressSoul: false, locksTimeline: false,
  durationPolicy: "SOURCE_TURN", ...o,
});

/** 官方[3] 原文枚举的 16 种控制效果。前七可驱散，后九不可驱散，霜冻不可解除。 */
export const CONTROL_EFFECTS: StatusDef[] = [
  S({ id: "freeze",  name: "冰冻",     category: StatusCategory.DEBUFF_STATE, preventsAction: true,  desc: "无法动作" }),
  S({ id: "sleep",   name: "沉睡",     category: StatusCategory.DEBUFF_STATE, preventsAction: true,  desc: "无法动作，受到伤害时自动移除" }),
  S({ id: "confuse", name: "混乱",     category: StatusCategory.DEBUFF_STATE, forcesBasicAttack: true, desc: "行动时强制普攻随机目标" }),
  S({ id: "taunt",   name: "嘲讽",     category: StatusCategory.DEBUFF_STATE, forcesBasicAttack: true, desc: "行动时强制普攻嘲讽来源" }),
  S({ id: "silence", name: "沉默",     category: StatusCategory.DEBUFF_STATE, preventsSkill: true,   desc: "无法施放技能" }),
  S({ id: "bind",    name: "禁锢",     category: StatusCategory.DEBUFF_STATE, preventsSkill: true,   desc: "只能使用普攻" }),
  S({ id: "disarm",  name: "缴械",     category: StatusCategory.DEBUFF_STATE, suppressSoul: true,    desc: "无法普攻，御魂失效" }),
  S({ id: "morph",   name: "变形",     category: StatusCategory.DEBUFF_STATE, preventsAction: true, suppressPassive: true, dispellable: false, desc: "无法被驱散，无法动作，被动失效" }),
  S({ id: "stun",    name: "眩晕",     category: StatusCategory.DEBUFF_STATE, preventsAction: true, dispellable: false, desc: "无法被驱散，无法动作" }),
  S({ id: "provoke", name: "挑衅",     category: StatusCategory.DEBUFF_STATE, forcesBasicAttack: true, dispellable: false, desc: "视为嘲讽但无法被驱散" }),
  S({ id: "deepFreeze", name: "深度冰冻", category: StatusCategory.DEBUFF_STATE, preventsAction: true, dispellable: false, desc: "无法动作、速度-20" }),
  S({ id: "shadowBind", name: "影缚",  category: StatusCategory.DEBUFF_STATE, preventsAction: true, dispellable: false, desc: "无法被驱散，无法动作" }),
  S({ id: "frost",   name: "霜冻",     category: StatusCategory.DEBUFF_STATE, preventsAction: true, dispellable: false, removable: false, desc: "无法被驱散、无法被解除" }),
  S({ id: "soulDetain", name: "拘魂",  category: StatusCategory.DEBUFF_STATE, preventsAction: true, dispellable: false, desc: "无法被驱散，无法动作" }),
  S({ id: "sink",    name: "沉沦",     category: StatusCategory.DEBUFF_STATE, preventsAction: true, dispellable: false, desc: "无法动作" }),
  S({ id: "iceSleep", name: "冰眠",    category: StatusCategory.DEBUFF_STATE, preventsAction: true, dispellable: false, desc: "无法动作" }),
  // 官方[117] 非控制但锁条
  S({ id: "boundFeet", name: "缚足",   category: StatusCategory.DEBUFF_MARK, dispellable: false, locksTimeline: true, desc: "无法被驱散，无法受到改变行动条的效果" }),
];

export const StatusBook = new Map(CONTROL_EFFECTS.map(s => [s.id, s]));

/**
 * ★★★ 第 195 轮：**tips 名 → 控制状态**的唯一映射（判据只有这一份）。
 *
 * 由来：技能原文里的控制效果几乎都写成 tips 占位符（`[tips_101]`=冰冻 / `[tips_108]`=眩晕 /
 *   `[tips_107]`=变形 / `[tips_102]`=沉睡 …），全库 **73 处小句、56 个技能**，而引擎此前
 *   **一处都不施加** —— 那 56 个技能在报表上却大多是「完整编译」（unparsed 为空）。
 *   field 的 perTurn（「回合结束有40%被施加[tips_103]」）早就在用同一个映射，本轮把它抽出来共用：
 *   判据只写一次，两处都调它（否则改一处忘一处，而分叉的方向是「静默不施加」）。
 */
export function controlDefByTipName(name: string): StatusDef | null {
  const n = String(name ?? "");
  if (!n) return null;
  return CONTROL_EFFECTS.find((d) => d.name === n) ?? null;
}
/**
 * ★★★ 第 238 轮：**合成计数器状态** —— §169（百目鬼「鬼眸」）的第一块。
 *
 * 由来：「当睁开5只鬼眸时，将免消耗施放『诅咒之眼』」里的「鬼眸」**不在 KB 里**（338 条 buff 里没有它），
 *   所以不能靠读数据；但也不该新造一种"计数器"概念 —— 把它做成**真实状态**，
 *   于是：阈值可以复用已有的 `STACK_AT_LEAST{statusRef, n}`（第 87 轮那套）、存档/State Hash/重放全部免费继承。
 * ★ id 是**确定性常量**（"GHOST_EYE"）：它会进 stateHash，不许有任何随机成分；
 *   层数上限 5 由**技能原文**决定（编译器读出来），运行时可随状态一起进存档，所以 def 本身不带 5。
 * ★ `counterDefFromId` 与 random-pool 的 `poolDefFromId` 同一职责：**跨进程恢复**时按 id 重建壳
 *   （合成状态不在 KB 里 ⇒ `kit.statusDefOf` 找不到它，不兜底就会静默丢状态 —— 第 190 轮那一类错）。
 */
export const GHOST_EYE_ID = "GHOST_EYE";
export function ghostEyeDef(name = "鬼眸"): StatusDef {
  return {
    id: GHOST_EYE_ID, name, category: StatusCategory.BUFF_STATE,
    dispellable: false, removable: false,
    preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false,
    durationPolicy: "GLOBAL",
    desc: "百目鬼「鬼眸」的计数器（合成状态）：每层＝睁开一只鬼眸；满 5 层免消耗施放『诅咒之眼』并清空。"
  };
}
/**
 * ★★★ 第 245 轮：**狸猫「醉倒」的合成状态**（`DRUNK`）。
 *
 * 由来：208_02 的原文把行为写全了 ——「回合结束时，有20%概率醉倒，直至下回合醒来并治疗生命上限6%的生命。
 *   醉倒时若被攻击，有50%概率被吵醒，并为攻击者附上1层[buff_2081_1]，上限5层，持续至战斗结束」——
 *   而 **KB 的 338 条 buff 里没有「醉倒」**（实测 tools/_probe-tanuki245.ts），所以它和鬼眸一样只能做成**合成状态**：
 *   做成真实状态之后，存档 / State Hash / 重放 / 状态列表全部免费继承。
 * ★ 行为标记按原文取：它**不阻止行动**、不锁条（原文只说"醉倒时若被攻击"，没有一个字说不能动）——
 *   这一条是刻意的：凭直觉把它做成眩晕会**改变行为**，而原文没写。
 * ★ 时长由运行时自己管（醒来即移除），所以 `durationPolicy` 取 GLOBAL：不靠回合数到期，靠我们显式 expireStatus。
 */
export const DRUNK_ID = "DRUNK";
export function drunkDef(name = "醉倒"): StatusDef {
  return {
    id: DRUNK_ID, name, category: StatusCategory.DEBUFF_STATE,
    dispellable: false, removable: false,
    preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false,
    durationPolicy: "GLOBAL",
    desc: "狸猫「醉倒」的合成状态：回合结束 20% 醉倒；下回合醒来治疗生命上限 6%；醉倒时被攻击有 50% 概率被吵醒，并给攻击者 1 层 buff_2081_1（上限 5）。"
  };
}

/** 合成状态的**按 id 重建**（跨进程恢复用）：鬼眸与醉倒共用这一个入口 —— 它们都不在 KB 里 */
export function counterDefFromId(id: string): StatusDef | null {
  const k = String(id ?? "");
  if (k === GHOST_EYE_ID) return ghostEyeDef();
  if (k === DRUNK_ID) return drunkDef();
  return null;
}

/**
 * ★★★ 第 100 轮：**放逐**（`banish`）。
 *
 * 三条出处，逐条写清楚哪些是数据、哪些**不是**：
 *   · 官方[117] 把放逐与缚足/石化并列写「无法受到改变行动条的效果」⇒ `locksTimeline` 有出处；
 *   · KB 的 buff 多处把它与控制效果并列（「受到伤害、控制效果或放逐时，免疫并移除1层」），
 *     且 buff_3334_1 写「目标免疫控制效果，则不开启剑狱」⇒ 「无法动作」有出处（免疫控制等于挡下它）；
 *   · 它**不在**官方[3] 的 16 种控制效果里（那张表逐条列了 16 种，没有放逐）⇒ 类别是 DEBUFF_STATE，
 *     但**不进** CONTROL_EFFECTS 表（那张表的条数有断言，且它本来就是"16 种"的定义）。
 *
 * ★★ 刻意**不实现**的一条：`canBeTargeted = false`（"被放逐 = 无法被选中 / 移出战场"）。
 *   这是最容易凭直觉加上的语义，但 KB 里**一句都没有**：查遍 338 条 buff，写「无法被选中」的是 **0 条**；
 *   反过来 buff_3334_1 明写「剑狱关闭时，悬浮的巨石坠落对**被放逐目标**造成攻击358%的伤害」——
 *   被放逐的目标仍然在场上、仍然会被打到。所以"移出战场"是我们的直觉，不是数据。
 *   ⇒ 它的直接后果是 `Entity.setTargetable` 至今**没有生产调用方**（capability 的 INVINCIBLE 条如实记着）——
 *     这一轮**没有**为了让那条字段好看而编一个语义出来。
 */
export const BANISH_STATUS: StatusDef = S({
  id: "banish", name: "放逐", category: StatusCategory.DEBUFF_STATE,
  preventsAction: true, locksTimeline: true, dispellable: false, banish: true,
  desc: "无法动作、无法受到改变行动条的效果（官方[117]）；不是官方[3] 的 16 种控制效果之一",
});
StatusBook.set(BANISH_STATUS.id, BANISH_STATUS);
/**
 * ★★★ 第 94 轮：**一个来袭状态属于哪几类**（决定它会不会被「免疫X」挡下）。
 *
 * 判定与引擎既有口径同源：控制与否看 preventsAction / preventsSkill / forcesBasicAttack
 * （与 isActionPrevented / canCastSkill 用的是同一组字段，不另造一套）。
 *
 * ★ 红区 G（policies.immune.debuffCoversControl）管的是**重叠**这一件事：
 *   控制效果本身都是减益类别，所以「免疫减益」在游戏里到底免不免控制，是一句只能靠观测定案的话。
 *   默认 true（免）。取 false 时，减益免疫**不**挡控制 —— 两种取值都有断言（tests/g55 第 [2] 节）。
 */
export function incomingKinds(def: StatusDef, debuffCoversControl: boolean): ImmuneKind[] {
  const control = !!(def.preventsAction || def.preventsSkill || def.forcesBasicAttack);
  const debuff = String(def.category).startsWith("DEBUFF");
  const out: ImmuneKind[] = [];
  if (control) out.push("CONTROL");
  if (debuff && (debuffCoversControl || !control)) out.push("DEBUFF");
  /**
   * ★★★ 第 100 轮：**放逐要单独算一类**，而不是只靠 CONTROL/DEBUFF 兜住。
   *   理由来自 KB 的两处并列写法：「免疫[控制效果]**和放逐**」「免疫减益**和放逐**」——
   *   原文每次都是**分开列举**的，说明游戏把它们当不同的类别；
   *   而 buff_3334_1 又写「目标免疫控制效果…则不开启剑狱」⇒ 控制免疫**也**该挡住它。
   *   两者都要成立：这里 push BANISH（让「免疫放逐」生效），control 分支照旧 push CONTROL（让「免疫控制」生效）。
   */
  if (def.banish) out.push("BANISH");
  return out;
}

export interface ImmuneHit { def: StatusDef; kind: ImmuneKind; consumed: boolean }

/**
 * 目标身上有没有能挡下这个来袭状态的状态？有就返回**是被谁挡下的**。
 * ★ 消耗型（consumeOnImmune）在这里就把层数减掉 —— 免疫与消耗必须同一时刻发生，
 *   分成两步就会出现「免疫了但没消耗」的中间态。
 */
export function findImmuneStatus(target: { statuses: ActiveStatus[] }, def: StatusDef, debuffCoversControl: boolean): ImmuneHit | null {
  const kinds = incomingKinds(def, debuffCoversControl);
  if (!kinds.length) return null;
  for (const st of target.statuses) {
    const imm = st.def.immuneTo ?? [];
    const kind = kinds.find(k => imm.includes(k));
    if (!kind) continue;
    if (st.def.consumeOnImmune) st.stacks = Math.max(0, Number(st.stacks ?? 1) - 1);
    return { def: st.def, kind, consumed: !!st.def.consumeOnImmune };
  }
  return null;
}

/** ★ 第 94 轮：目标身上有没有「免疫伤害」的状态（伤害管线用它把这一击归零） */
export function findDamageImmunity(target: { statuses: ActiveStatus[] }): ImmuneHit | null {
  for (const st of target.statuses) {
    if (!(st.def.immuneTo ?? []).includes("DAMAGE")) continue;
    if (st.def.consumeOnImmune) st.stacks = Math.max(0, Number(st.stacks ?? 1) - 1);
    return { def: st.def, kind: "DAMAGE", consumed: !!st.def.consumeOnImmune };
  }
  return null;
}

export interface PreventLethalHit { def: StatusDef; keep: "FULL" | "ONE"; exhausted: boolean }

/**
 * ★★★ 第 94 轮：**免死** —— 这一击会要命，而目标身上有「免疫首次/下1次受到的致命伤害」。
 *
 * 判据只认 buff 原文里写明的两类（见 compile/buff-compiler.ts）：
 *   「免疫(首次|下1次)受到的致命伤害」 → keep = FULL（那次伤害被免除，血量回到受击前）
 *   「受到致命伤害…剩余1点生命」        → keep = ONE（活下来，但只剩 1 点）
 *
 * ★ 消耗：触发一次就减一层；层数减到 0 时由调用方把这个状态**移除**
 *   （「首次」/「下1次」本来就是一次性的，留着会让下一次致命伤害又被免掉）。
 *   `exhausted` 就是把这件事告诉调用方。
 */
export function findPreventLethal(target: { statuses: ActiveStatus[] }): PreventLethalHit | null {
  for (const st of target.statuses) {
    const keep = st.def.preventsLethal;
    if (!keep) continue;
    const before = Number(st.stacks ?? 1);
    st.stacks = Math.max(0, before - 1);
    return { def: st.def, keep, exhausted: before <= 1 };
  }
  return null;
}

/**
 * ★★★ 第 96 轮：目标身上有没有「封印」类的状态。
 *   `"PASSIVE"` 读 StatusDef.suppressPassive（式神被动失效），`"SOUL"` 读 suppressSoul（御魂失效）。
 * ★ 这个函数**取代了**"往 EventBus 的 Set 里写"的做法：Set 不进 state，
 *   存档/续跑会把封印丢掉；而状态本来就是 state 的一部分（G0 天然成立、进指纹、可重放）。
 */
export function hasSuppression(defs: StatusDef[], kind: "PASSIVE" | "SOUL"): boolean {
  return defs.some(d => (kind === "PASSIVE" ? !!d.suppressPassive : !!d.suppressSoul));
}

/** ★ 第 94 轮：目标身上有没有「禁止复活」的状态（Entity 用它维护 reviveBlocked） */
export function hasReviveBlock(statuses: Array<{ def: StatusDef }>): boolean {
  return statuses.some(s => !!s.def.blocksRevive);
}

/** 官方[17] 无法动作 / [27] 可行动状态 */
export function isActionPrevented(defs: StatusDef[]): boolean { return defs.some(d => d.preventsAction); }
export function canCastSkill(defs: StatusDef[]): boolean { return !defs.some(d => d.preventsSkill || d.preventsAction); }
/**
 * 官方[117]缚足 / [109]放逐 / [2277]石化：**无法受到改变行动条的效果**。
 *
 * 这个判定函数此前不存在，StatusDef.locksTimeline 于是只在 toStatusDef 里被「搬运」了一次，
 * 从来没有任何地方**读它来做判断** —— 被缚足的单位照样能被拉条推条。
 * Timeline 自己的 locked 标志是有的，但生产代码里没有任何一处调用 setLock（只有测试调用）。
 */
export function locksTimeline(defs: StatusDef[]): boolean { return defs.some(d => d.locksTimeline); }

/**
 * 挂在单位身上的一个状态实例。
 * `tag` / `effects` 是**运行时托管**用的：每个效果带一个唯一 tag 进 Entity.effects，
 * 状态到期或被驱散时按 tag 整批回收（见 Entity.expireStatus）。
 * 它们原先只在代码里被临时挂上去、接口没声明，导致 entity.ts 有 9 处类型错误 —— 这里补上声明。
 */
export interface ActiveStatus {
  def: StatusDef; sourceId: number; stacks: number; remaining: number;
  /**
   * ★★★ 第 78 轮：层数上限（`null` = 不封顶）。
   * 首次施加时由技能 IR 的 `statusCaps` 写入，之后**一直沿用** ——
   * 因为写明上限的是"先施加它的那个技能"，后来源源不断叠层的技能通常不重复写上限。
   * 进了核心状态（`state.ts` 的 coreState 序列化它），所以它会进指纹与快照。
   */
  cap?: number | null;
  /** 该状态在本单位上的唯一标识（st1、st2……）。构造时必填（Entity.addStatus 负责生成）。 */
  tag: string;
  /** 本状态托管的效果，每项带自己的 tag，便于精确回收 */
  effects: Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE" | "SET"; tag?: string }>;
}
