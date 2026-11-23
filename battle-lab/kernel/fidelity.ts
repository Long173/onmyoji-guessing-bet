// kernel/fidelity.ts — ★ Per-Match Fidelity（a1-4.md §1-§10、§33、Phase I）
//
// 文档最强调的一条（§3）：**不能说"当前模拟器有 80% 真实性"**。
//   Capability Coverage 58.3% ≠ 战斗真实性 58.3%
//   技能 HIGH 编译率 × AI HIGH 编译率 ≠ 真实性
// 所以这里只产出**非评价性的状态分类**，不产出任何百分比评分：
//   VERIFIED / COMPLETE_UNVERIFIED / PARTIAL / INSUFFICIENT
// 五层各自独立给结论，绝不合成一个"总分"。
//
// 另外一个关键点（§6）：AI 的 DATA PRESENT / COMPILED / GAME-VERIFIED 三态必须分开 ——
// 我们从来没有做过游戏内大规模验证，所以 GAME-VERIFIED 目前恒为「否」，且必须显示出来。
import type { BattleState } from "./state.ts";
import { verbEn, verbMissingEn } from "./fidelity-en.ts";

export type FidelityClass = "VERIFIED" | "COMPLETE_UNVERIFIED" | "PARTIAL" | "INSUFFICIENT";
export type LayerClass = "COMPLETE" | "PARTIAL" | "GAPS" | "UNKNOWN";

/**
 * ★ 第 127 轮：五层的**规范顺序**只声明在这里 —— CLI 与测试都从这里取。
 *   起因：CLI 的测试自己又写了一遍 ["INPUT","SKILL",...] ⇒ 词汇普查（g38）当场抓到一组跨文件重复。
 *   「同一份词汇声明几遍」正是那个工具要防的事，所以修法是把顺序**导出**，而不是加白名单。
 */
export const FIDELITY_LAYERS = ["INPUT", "SKILL", "AI", "MECHANIC", "RULESET"] as const;

export interface FidelityCount { label: string; value: string; note?: string }
export interface FidelityGap { what: string; severity: "BLOCK" | "WARN" | "INFO"; detail: string }
export interface FidelityLayer {
  layer: "INPUT" | "SKILL" | "AI" | "MECHANIC" | "RULESET";
  title: string;
  klass: LayerClass;
  counts: FidelityCount[];
  gaps: FidelityGap[];
  /** 这一层"能看到的比例"仅用于画进度条，**不是**真实性评分，界面上必须如此标注 */
  bar: { filled: number; total: number } | null;
}

export interface FidelityUnitInput {
  name: string; side: "red" | "blue";
  /** Display name for report texts (English panel); `name` stays the matching key. */
  label?: string;
  /** 四个绝对值维度（攻/生/防/速）里已填的个数 / 应为 4。
   *  暴击/爆伤/命中/抵抗**不参与判定** —— 它们在游戏里合法地可以是 0。 */
  panelFilled: number;
  soul: { id: number | null; resolved: boolean; support: "FULL" | "PARTIAL" | "UNSUPPORTED" } | null;
  skills: Array<{
    name: string;
    /** KB skill id (e.g. "593_04") and display name (English panel) — optional */
    skillId?: string;
    label?: string;
    /** Betting mode: a hand-written module implements this skill (compile/betting-coverage.ts) */
    kit?: { level: "FULL" | "PARTIAL"; module: string; note: string } | null;
    /** Betting mode: the AI provably never casts this skill (reason from the module gate) */
    neverCast?: string | null;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    /** <0 表示被动技能：引擎没有触发条件模型，属已知边界而不是解析失败 */
    cost?: number;
    /** 该技能解析出的可执行成分 */
    parsed: { damage: number; heal: number; shield: number; timeline: number; status: number; orb: number };
    /** 未解析的机制句数量（MECHANIC_UNPARSED） */
    unparsedSentences: number;
    /** 原文写了「有N%概率…」且**成功归因**到效果上的槽位数（运行时真的掷骰） */
    probAttributed?: number;
    /** 原文写了概率但**归因有歧义**、只能退回「必定施加」的处数 —— 已知的过度施加 */
    probAmbiguous?: number;
    /** 原文写明并被成功归因的「持续N回合」槽位数 */
    durationStated?: number;
    /** 原文写了「持续N回合」但归因有歧义的处数 */
    durationAmbiguous?: number;
    /** 这个技能依赖哪些引擎没有建模的机制（召唤 / 复活 / 反击 / 免疫…） */
    unmodeled?: Array<{ verb: string; missing: string; severity?: "WARN" | "INFO" }>;
    /** ★ 第 112 轮：引擎**明确跳过**的记录（放置 / 偷取），逐条带原因码 */
    skips?: Array<{ reason: string; evidence: string; kind: "PLACEMENT" | "STEAL" }>;
  }>;
  ai: { dataPresent: boolean; compiled: boolean; confidence: "HIGH" | "MEDIUM" | "LOW"; gameVerified: boolean;
    /** Betting mode: module of the hand-written skill-choice rule (the KB rules never decide for this unit) */
    handWritten?: string | null;/** ★ 第 114 轮：条件**解析不出**的规则条数（这些规则不再被当成「条件成立」） */ unresolvedConds?: number };
}

export interface FidelityInput {
  units: FidelityUnitInput[];
  ruleset: Array<{ id: string; status: "UNKNOWN" | "HYPOTHESIS" | "VERIFIED" }>;
  /** Extra notes on the rules in force (e.g. which part of a replaced ruleset still applies) — INFO gaps */
  rulesetNotes?: string[];
  /** Effect-resist policy in force (kernel/resist.ts); absent or NOT_CONSUMED ⇒ effect HIT / RES are inputs only */
  resist?: { id: string; status: string } | null;
  /** Report language (default "zh"; the betting-mode web panel asks for "en") */
  lang?: "zh" | "en";
  /** 本局技能实际会用到的能力 → 引擎支持度（来自能力矩阵） */
  capabilities: Array<{ name: string; support: "FULL" | "PARTIAL" | "NONE"; useCount: number; registered?: boolean }>;
  displayPrecision: "INTEGER_OBSERVED" | "EXACT";
  /** 可选：终局状态（用于把"实际发生过什么"也算进去） */
  finalState?: BattleState | null;
}

export interface MatchFidelity {
  schemaVersion: 1;
  klass: FidelityClass;
  layers: FidelityLayer[];
  /** 为什么是这个分类 —— 逐条给理由，不给分数 */
  reasons: string[];
  /** 必须随结果一起显示的免责声明（§2 显示精度陷阱 / §8 红区） */
  caveats: string[];
  /**
   * ★★★ 第 138 轮：**逐技能**编译状态（a1-4 §33：卡上按逐技能机制实现度 ● FULL / ◐ PARTIAL，且可展开）。
   *   在此之前这里只有 6 个聚合计数（完整编译 N / 部分编译 M / …），界面上问不出
   *   「这个技能到底是哪一档」—— 而 §33 要的正是逐技能那一层。
   *   ★ 它同时是 SKILL 层那 4 个计数的**唯一来源**（计数由它数出来，不是两处各算一遍）。
   */
  skills: FidelitySkillStatus[];
}

const emptyParsed = (p: FidelityUnitInput["skills"][number]["parsed"]) =>
  p.damage === 0 && p.heal === 0 && p.shield === 0 && p.timeline === 0 && p.status === 0 && p.orb === 0;

/**
 * 逐技能的四档编译状态。判据与 SKILL 层原来的计数**逐字一致**（先证明一致，再让它成为唯一来源）：
 *
 * | 档 | 判据 | 含义 |
 * |---|---|---|
 * | NONE | 主动技能（cost ≥ 0）且没有任何可执行数值 | 真缺口：实战里等于不会用这个技能 |
 * | PASSIVE | 被动技能（cost < 0）且没有可执行数值 | 已知边界：引擎没有触发条件模型，不是解析失败 |
 * | FULL | 有可执行数值，且**没有未解析句、没有跳过记录** | 「完整编译（无可执行缺口）」 |
 * | PARTIAL | 有可执行数值，但有未解析句或跳过记录 | 主效果可用，附带的没做全 |
 *
 * ★ 一处**必须说明**的变化：原来的两个计数漏掉了一类技能 ——「有跳过记录、但没有未解析句」的
 *   既不算完整编译、也不算部分编译（两个数加起来不等于技能总数）。现在它归 PARTIAL，
 *   于是计数变成**穷尽**的（四档之和 == 技能总数）。差分实测见报告 §122.2。
 */
export type SkillFidelityClass = "FULL" | "PARTIAL" | "PASSIVE" | "NONE" | "NEVER_CAST";

/** 界面用的记号与短标签（**只声明这一处**：卡面、抽屉、报告、断言都读它） */
export const SKILL_CLASS_MARK: Record<SkillFidelityClass, string> = { FULL: "●", PARTIAL: "◐", PASSIVE: "○", NONE: "✕", NEVER_CAST: "⊘" };
export const SKILL_CLASS_LABEL: Record<SkillFidelityClass, string> = {
  FULL: "完整编译", PARTIAL: "部分编译", PASSIVE: "被动（触发条件未建模）", NONE: "主动但无可执行数值", NEVER_CAST: "AI 从不施放（竞猜）",
};

/**
 * Betting mode adds two inputs that come before the compile-based tiers:
 *   · neverCast — the betting AI provably never casts it (module gate) ⇒ NEVER_CAST, not a gap;
 *   · kit       — a hand-written module implements the skill ⇒ its level (FULL / PARTIAL), whatever the
 *                 generic compiler parsed (the compiler's unparsed sentences are the parts the module runs).
 */
export function classifySkill(s: FidelityUnitInput["skills"][number]): SkillFidelityClass {
  if (s.neverCast) return "NEVER_CAST";
  if (s.kit) return s.kit.level;
  if (emptyParsed(s.parsed)) return (s.cost ?? 0) < 0 ? "PASSIVE" : "NONE";
  return (s.unparsedSentences === 0 && (s.skips ?? []).length === 0) ? "FULL" : "PARTIAL";
}

/** Number of skills classified NEVER_CAST (betting mode only). */
const countNeverCast = (list: Array<{ klass: SkillFidelityClass }>): number => list.filter(x => x.klass === "NEVER_CAST").length;

export interface FidelitySkillStatus {
  /** 归属（卡面按单位分组） */
  unit: string;
  side: "red" | "blue";
  name: string;
  klass: SkillFidelityClass;
  /** 未解析的机制句数量（0 = 没有 MECHANIC_UNPARSED） */
  unparsed: number;
  /** 引擎**明确跳过**的记录条数（0 = 编译期没有判过"这条不执行"） */
  skipped: number;
  /**
   * 依赖哪些未建模机制（动词名，来自 compile/unmodeled.ts 的动词表）。
   * ★ 它**不参与分档**：与「完整编译」是两件事（前者是"文本里出现了动词表里的词 + 有未建模机制"，
   *   后者是"有没有未解析句/跳过记录"）。界面必须分开显示，否则会把两者混成一个数。
   */
  unmodeled: string[];
  /** KB skill id and display name (when the input gave them) */
  skillId?: string;
  label?: string;
  /** Betting mode: hand-written implementation note ("module: note") */
  handWritten?: string;
  /** Betting mode: why the AI never casts it */
  neverCast?: string;
}

export function assessFidelity(input: FidelityInput): MatchFidelity {
  const caveats: string[] = [];
  /** Report language: Chinese by default (regression suite), English for the betting-mode web panel. */
  const en = input.lang === "en";
  const T = (zh: string, enText: string): string => (en ? enText : zh);
  const uName = (u: { name: string; label?: string }) => (en ? u.label ?? u.name : u.name);
  const units = input.units;
  const n = units.length;

  // ───────── ① Input Fidelity（§4）─────────
  const panelOk = units.filter(u => u.panelFilled >= 4).length;
  /**
   * ★★ 御魂的三种状态必须分开，**不能**合并成一个「OK」：
   *   soul === null       —— **输入缺失**（截图没识别出御魂图标）
   *   resolved === false  —— 有御魂，但知识库解析不出战斗效果
   *   resolved === true   —— 已识别
   * 这里原先把第一种也算进「已识别」，于是 10 个单位全无御魂信息的对局会报
   * 「御魂已识别 10/10」、输入层判 COMPLETE —— 把「没有信息」当成了「信息没问题」。
   * 这不是措辞问题：tests/g30 实测这种对局的御魂运行时**根本不可达**
   * （事件总线订阅者 0、真正投递过的节点 0），而面板上却写着「已识别」。
   */
  const soulsResolved = units.filter(u => u.soul?.resolved === true).length;
  const soulsUnknown = units.filter(u => u.soul === null).length;
  const soulsUnresolved = n - soulsResolved - soulsUnknown;
  const inputLayer: FidelityLayer = {
    layer: "INPUT", title: T("输入（八维面板 / 御魂）", "Input (8 stats / Souls)"),
    klass: n > 0 && panelOk === n && soulsUnknown === 0 && soulsUnresolved === 0 ? "COMPLETE"
      : n > 0 && panelOk === n ? "PARTIAL" : "GAPS",
    counts: [
      { label: T("式神身份", "Shikigami identified"), value: `${n}/10` },
      { label: T("八维面板", "8-stat panel"), value: T(`${panelOk}/${n} 只`, `${panelOk}/${n}`), note: T("判据：攻/生/防/速 已填（暴击·爆伤·命中·抵抗 合法可为 0）", "Criterion: ATK / HP / DEF / SPD filled in (crit, crit damage, HIT and RES may legally be 0)") },
      { label: T("御魂已识别", "Souls recognised"), value: `${soulsResolved}/${n}` },
      { label: T("御魂输入缺失", "Soul input missing"), value: `${soulsUnknown}/${n}`, note: T("截图未识别出御魂图标 = **没有信息**，不等于已识别", "No soul icon recognised on the screenshot = no information, not \"recognised\"") },
      { label: T("面板重复叠加", "Stats double-counted"), value: T("无", "None"), note: T("竞猜口径：静态属性不参与计算", "Betting reading: static soul stats are not added (the panel is final)") },
    ],
    gaps: [
      ...units.filter(u => u.panelFilled < 4).map(u => ({ what: T(`${u.name} 面板未填`, `${uName(u)}: stats not filled in`), severity: "WARN" as const, detail: T("攻/生/防/速 有空缺，引擎会用 0 参与计算", "ATK / HP / DEF / SPD missing: the engine computes with 0") })),
      ...(soulsUnknown > 0 ? [{
        what: T(`${soulsUnknown} 个单位没有御魂信息`, `${soulsUnknown} unit(s) have no soul information`),
        severity: "WARN" as const,
        detail: T("本局不可能触发任何御魂效果（实测：事件总线订阅者 0、投递节点 0，见 tests/g30）。这不说明御魂机制有问题，而是这份输入检验不了它 —— 结论范围要按此收窄。", "No soul effect can trigger for them in this match (measured: 0 bus subscribers, see tests/g30). Conclusions about souls do not apply."),
      }] : []),
      ...(soulsUnresolved > 0 ? [{
        what: T(`${soulsUnresolved} 个单位的御魂无法解析`, `${soulsUnresolved} unit(s) have an unresolved soul`),
        severity: "WARN" as const,
        detail: T("御魂 id 不在知识库，或该御魂的战斗效果尚未支持。", "The soul id is not in the knowledge base."),
      }] : []),
    ],
    bar: { filled: panelOk, total: Math.max(1, n) },
  };
  if (input.displayPrecision === "INTEGER_OBSERVED") {
    caveats.push(T("显示精度：INTERNAL DECIMALS UNKNOWN —— 截图只给整数，内部隐藏小数未知（速度尤其危险：显示同速可能实际一快一慢）",
      "Display precision: INTERNAL DECIMALS UNKNOWN — screenshots show whole numbers only; hidden decimals are unknown (speed especially: equal displayed speeds may really differ)."));
  }
  // ★ 输入缺失必须在**顶层**也说一次：分层面板里的一行小字很容易被跳过，
  //   而这件事决定了"本局能得出什么结论"——御魂相关的一切都不适用。
  if (soulsUnknown > 0) {
    caveats.push(T(`御魂输入缺失：${soulsUnknown}/${n} 个单位没有御魂信息 → 本局不可能触发御魂效果，御魂相关结论不适用（实测见 tests/g30-bus-liveness.ts）`,
      `Soul input missing: ${soulsUnknown}/${n} unit(s) have no soul information → no soul effect can trigger for them; soul conclusions do not apply.`));
  }

  // ───────── ② Skill Fidelity（§5）─────────
  // 文档口径：不是问"有没有技能文本"，而是问"这场战斗可能调用的每个技能，语义是否已编译进引擎"
  const allSkills = units.flatMap(u => u.skills.map(s => ({ unit: u.name, unitLabel: uName(u), ...s })));
  /** Betting mode: a hand-written kit or a never-cast gate replaces the compiler's view of the skill. */
  const covered = (s: FidelityUnitInput["skills"][number]): boolean => !!s.kit || !!s.neverCast;
  const skLabel = (s: { name: string; label?: string }) => (en ? s.label ?? s.name : s.name);
  /**
   * ★★★ 第 112 轮：「完整编译」的定义收紧 —— 除了"没有未解析句"，还要**没有跳过记录**。
   *   之前一个技能可以被算成"完整编译（无可执行缺口）"，而它的 formSkips 里明明写着
   *   `NOT_A_SUMMON_SPEC` / `PRESENCE_AURA_NOT_MODELED`（引擎自己承认跳过了）。
   */
  /**
   * ★★★ 第 138 轮：**四档只算一次** —— 逐技能状态由 classifySkill 给出，四个计数从这里数出来。
   *   原来四个计数各写一条 filter，而界面**根本看不到逐技能**；现在界面拿到的 skills[]
   *   与报告里显示的计数是**同一次分类的两种视图**，不可能对不上。
   */
  const skillStatus: FidelitySkillStatus[] = units.flatMap(u => u.skills.map(s => ({
    unit: u.name, side: u.side, name: s.name,
    klass: classifySkill(s),
    // A hand-written / never-cast skill: the compiler's leftovers are the parts the module runs => not shown.
    unparsed: covered(s) ? 0 : s.unparsedSentences,
    skipped: covered(s) ? 0 : (s.skips ?? []).length,
    unmodeled: covered(s) ? [] : [...new Set((s.unmodeled ?? []).map(m => (en ? verbEn(m.verb) : m.verb)))],
    ...(s.skillId ? { skillId: s.skillId } : {}),
    ...(s.label ? { label: s.label } : {}),
    ...(s.kit ? { handWritten: `${s.kit.module}: ${s.kit.note}` } : {}),
    ...(s.neverCast ? { neverCast: s.neverCast } : {}),
  })));
  const kitCount = allSkills.filter(s => !!s.kit && !s.neverCast).length;
  const neverCastCount = countNeverCast(skillStatus);
  const countClass = (k: SkillFidelityClass) => skillStatus.filter(s => s.klass === k).length;
  const skillFull = countClass("FULL");
  const skillPartial = countClass("PARTIAL");
  // ★ 被动技能（cost<0）没有可执行数值是**数据事实**，不是解析失败：
  //   引擎本来就没有"触发条件"模型。把它算成缺口会让每局都被判成 INSUFFICIENT。
  const skillPassive = countClass("PASSIVE");
  const skillNone = countClass("NONE");
  // ★ 把「未建模机制」按**机制名**汇总：报告要说清"这个阵容依赖召唤，而引擎不会生成召唤物"，
  //   而不是笼统一句"N 句未建模"。表见 battle-lab/compile/unmodeled.ts（含验证依据）。
  const mechTally = new Map<string, { count: number; missing: string; units: Set<string>; severity: "WARN" | "INFO" }>();
  for (const s of allSkills.filter(x => !covered(x))) for (const m of s.unmodeled ?? []) {
    /** ★ 第 112 轮：severity **跟着记录走**（记录由动词表或编译器声明）；报告层不再维护名字名单 */
    const e = mechTally.get(m.verb) ?? { count: 0, missing: m.missing, units: new Set<string>(), severity: m.severity ?? "INFO" };
    if (m.severity === "WARN") e.severity = "WARN";
    e.count++; e.units.add(s.unitLabel); mechTally.set(m.verb, e);
  }
  /**
   * ★★★ 第 112 轮：**"引擎明确跳过"也要进报告**（此前它们到不了这里）。
   *   跳过记录与"未建模机制"是两件事：前者是引擎**知道**自己没做（逐条带原因码），
   *   后者是文本里出现了动词表里的词。两条都要按**原因码**汇总并点名单位。
   */
  const skipTally = new Map<string, { count: number; units: Set<string>; ev: string }>();
  for (const s of allSkills.filter(x => !covered(x))) for (const k of s.skips ?? []) {
    const e = skipTally.get(k.reason) ?? { count: 0, units: new Set<string>(), ev: k.evidence };
    e.count++; e.units.add(s.unitLabel); skipTally.set(k.reason, e);
  }
  const skipList = [...skipTally.entries()].sort((a, b) => b[1].count - a[1].count);
  const skillSkipped = allSkills.filter(s => !covered(s) && (s.skips ?? []).length > 0).length;
  const mechList = [...mechTally.entries()].sort((a, b) => b[1].count - a[1].count);
  const skillUnmodeled = allSkills.filter(s => !covered(s) && (s.unmodeled ?? []).length > 0).length;
  const klassOf = new Map(allSkills.map((s, i) => [s, skillStatus[i].klass] as const));
  const kOf = (s: (typeof allSkills)[number]) => klassOf.get(s);
  const skillLayer: FidelityLayer = {
    layer: "SKILL", title: T("技能（本局可能调用的每一个技能）", "Skills (every skill this match may use)"),
    klass: allSkills.length === 0 ? "UNKNOWN" : skillNone === 0 ? ((skillPartial === 0 && skillSkipped === 0 && skillUnmodeled === 0) ? "COMPLETE" : "PARTIAL") : "GAPS",
    counts: [
      { label: T("本局技能总数", "Skills in this match"), value: String(allSkills.length) },
      // ★ 第 138 轮：四档是**穷尽**的 —— 这条把「计数加起来等于总数」变成界面上看得见的事实
      { label: T("四档合计", "Sum of the tiers"), value: String(skillStatus.length), note: neverCastCount
        ? T("● 完整 + ◐ 部分 + ○ 被动 + ✕ 无数值 + ⊘ AI 从不施放 == 本局技能总数（差额恒为 0）", "● full + ◐ partial + ○ passive + ✕ no values + ⊘ never cast == skills in this match (difference always 0)")
        : T("● 完整 + ◐ 部分 + ○ 被动 + ✕ 无数值 == 本局技能总数（差额恒为 0）", "● full + ◐ partial + ○ passive + ✕ no values == skills in this match (difference always 0)") },
      { label: T("完整编译（无可执行缺口）", "Fully compiled (no executable gap)"), value: String(skillFull) },
      { label: T("部分编译（有未建模附加效果）", "Partially compiled (unmodelled extra effects)"), value: String(skillPartial) },
      { label: T("被动技能（引擎未建模其触发条件）", "Passive (engine does not model its trigger)"), value: String(skillPassive), note: T("已知边界，不是解析失败", "Known boundary, not a parse failure") },
      { label: T("主动技能但无可执行数值", "Active, no executable values"), value: String(skillNone), note: T("这才是真缺口", "This is the real gap") },
      ...(kitCount ? [{ label: T("竞猜手写实现的技能", "Skills with a hand-written betting kit"), value: String(kitCount), note: T("compile/betting-*.ts 实现了这些技能的机制（已计入 ● / ◐）", "compile/betting-*.ts implements their mechanics (counted in the full / partial tiers above)") }] : []),
      ...(neverCastCount ? [{ label: T("AI 从不施放的技能", "Skills the AI never casts"), value: String(neverCastCount), note: T("竞猜 AI 的门禁拒绝施放（用户实测），不是缺口", "Refused by the betting AI gate (user-confirmed); not a gap") }] : []),
      { label: T("依赖未建模机制的技能", "Skills relying on unmodelled mechanics"), value: String(skillUnmodeled), note: skillUnmodeled ? T("这些技能在实战中会少做一部分（见下方逐条）", "These skills do less in battle than their text says (listed below)") : T("无", "None") },
      { label: T("含「引擎明确跳过」的技能", "Skills with steps the engine explicitly skips"), value: String(skillSkipped), note: skillSkipped ? T("引擎记下了「哪一条没做」（按原因码见下方）", "The engine recorded which clause it does not run (reason codes below)") : T("无", "None") },
    ],
    gaps: ([...allSkills.filter(s => kOf(s) === "NONE").map(s => ({ what: T(`${s.unit}「${s.name}」`, `${s.unitLabel} · ${skLabel(s)}`), severity: "BLOCK" as const, detail: T("主动技能却没有任何可执行数值：实战中等于不会用这个技能", "Active skill without any executable value: in battle it does nothing") }))] as FidelityGap[])
      .concat(allSkills.filter(s => kOf(s) === "PASSIVE").map(s => ({ what: T(`${s.unit}「${s.name}」`, `${s.unitLabel} · ${skLabel(s)}`), severity: "INFO" as const, detail: T("被动技能：引擎没有触发条件模型（如'造成伤害时附带吸血'），属已知边界", "Passive skill: the engine has no trigger model for it (known boundary)") })))
      .concat(allSkills.filter(s => kOf(s) === "PARTIAL" && !s.kit && s.unparsedSentences > 0).slice(0, 6).map(s => ({ what: T(`${s.unit}「${s.name}」`, `${s.unitLabel} · ${skLabel(s)}`), severity: "INFO" as const, detail: T(`${s.unparsedSentences} 句机制未建模（伤害/治疗等主效果已可用）`, `${s.unparsedSentences} sentence(s) not modelled (main damage / heal works)`) })))
      // Betting mode: hand-written kits that still miss riders, and skills the AI never casts.
      .concat(allSkills.filter(s => s.kit?.level === "PARTIAL" && !s.neverCast).map(s => ({ what: T(`${s.unit}「${s.name}」`, `${s.unitLabel} · ${skLabel(s)}`), severity: "WARN" as const, detail: T(`竞猜手写实现（${s.kit!.module}），仍有未建模部分：${s.kit!.note}`, `Hand-written betting kit (${s.kit!.module}) with gaps: ${s.kit!.note}`) })))
      .concat(allSkills.filter(s => !!s.neverCast).map(s => ({ what: T(`${s.unit}「${s.name}」`, `${s.unitLabel} · ${skLabel(s)}`), severity: "INFO" as const, detail: T(`AI 从不施放（${s.neverCast}）${s.kit ? "；手写实现：" + s.kit.note : ""}`, `Never cast by the AI (${s.neverCast})${s.kit ? "; hand-written: " + s.kit.note : ""}`) })))
      // ★ 逐条列出**依赖哪个未建模机制**、以及引擎缺什么。
      //   每条都指得出验证依据（battle-lab/compile/unmodeled.ts），不是"大概没实现"。
      .concat(mechList.map(([verb, e]) => ({
        what: T(`未建模机制：${verb}（${e.count} 处，涉及 ${[...e.units].join("、")}）`, `Unmodelled mechanic: ${verbEn(verb)} (${e.count}x, ${[...e.units].join(", ")})`),
        // ★ 第 112 轮：严重度**来自记录**（动词表 / 编译器声明），报告层不再硬编码名字名单
        severity: e.severity,
        detail: T(`引擎缺的是：${e.missing}`, `Missing in the engine: ${verbMissingEn(verb)}`),
      })))
      // ★ 第 112 轮：**引擎明确跳过**的逐原因码列出（它们此前到不了报告）
      .concat(skipList.map(([reason, e]) => ({
        what: T(`跳过记录：${reason}（${e.count} 处，涉及 ${[...e.units].join("、")}）`, `Skipped clause: ${reason} (${e.count}x, ${[...e.units].join(", ")})`),
        severity: "WARN" as const,
        detail: T(`引擎在编译期就判定这一条不执行，原文：${String(e.ev).slice(0, 80)}`, "The compiler decided not to execute this clause (reason code above; the skill text is in the skill details)."),
      }))),
    bar: { filled: skillFull, total: Math.max(1, allSkills.length) },
  };

  // ───────── ③ AI Fidelity（§6）三态分开 ─────────
  const dataPresent = units.filter(u => u.ai.dataPresent).length;
  const compiled = units.filter(u => u.ai.compiled).length;
  const gameVerified = units.filter(u => u.ai.gameVerified).length;
  /** ★ 第 114 轮：AI 规则里条件解析不出的条数（逐单位汇总）—— 它必须在报告里看得见 */
  const unresolvedAI = units.reduce((s, u) => s + (u.ai.unresolvedConds ?? 0), 0);
  const handAI = units.filter(u => !!u.ai.handWritten).length;
  const aiLayer: FidelityLayer = {
    layer: "AI", title: T("AI（Wiki 规则 ≠ 2026 服务器行为）", "AI (Wiki rules ≠ 2026 server behaviour)"),
    klass: n === 0 ? "UNKNOWN" : compiled === n ? (unresolvedAI > 0 ? "PARTIAL" : "COMPLETE") : compiled > 0 ? "PARTIAL" : "GAPS",
    counts: [
      { label: T("AI 数据存在", "AI data present"), value: `${dataPresent}/${n}` },
      { label: T("已编译", "Compiled"), value: `${compiled}/${n}` },
      ...(handAI ? [{ label: T("竞猜手写 AI", "Hand-written betting AI"), value: `${handAI}/${n}`, note: T("compile/betting-*.ts 的规则决定这些单位的技能选择（计入已编译）", "A compile/betting-*.ts rule decides these units' skill choice (counted as compiled)") }] : []),
      { label: T("游戏内已验证", "Verified in-game"), value: gameVerified === 0 ? T("0（从未做过大规模实测）", "0 (never tested at scale in-game)") : `${gameVerified}/${n}` },
      { label: T("条件解析不出的规则", "Rules with unparseable conditions"), value: String(unresolvedAI), note: unresolvedAI ? T("这些规则**不再**按「条件成立」放行（第 114 轮修正：此前会，而且事件里还写着 COND_MATCH）", "These rules are not treated as satisfied (they never fire)") : T("无", "None") },
    ],
    gaps: [
      ...(gameVerified === 0 ? [{ what: T("AI 行为未经游戏内验证", "AI behaviour not verified in-game"), severity: "WARN" as const, detail: T("AI 数据存在、也已编译，但未经游戏内验证：Wiki 的 cast/target 规则整理自社区，是否等于 2026 服务器 AI 没有大规模实测过；含「没写触发条件」的规则会被按每回合都放处理", "The Wiki cast / target rules come from the community and were never tested at scale against the 2026 server; hand-written betting rules follow user observations, not a full in-game study. Rules without a written trigger are cast every turn (Onibi permitting).") }] : []),
      ...(unresolvedAI > 0 ? [{ what: T(`AI 规则条件解析不出：${unresolvedAI} 条`, `AI rules with unparseable conditions: ${unresolvedAI}`), severity: "WARN" as const, detail: T("这些规则的条件原文在引擎里没有对应的谓词（「自身处于幻境时」「不存在山行结界时」…）。第 114 轮起它们**不再被当成条件成立**（此前会被逐回合放行，且决策事件误报 COND_MATCH）；缺口逐条见 fixtures/ai-gaps.json", "The engine has no predicate for these condition texts, so these rules never trigger: they are not treated as satisfied. Units with a hand-written betting AI are not counted: their KB rules never decide. Details: battle-lab/fixtures/ai-gaps.json") }] : []),
    ],
    bar: { filled: compiled, total: Math.max(1, n) },
  };

  // ───────── ④ Mechanic Fidelity（§7）本局需要的 vs 支持的 ─────────
  const caps = input.capabilities;
  const full = caps.filter(c => c.support === "FULL").length;
  const partial = caps.filter(c => c.support === "PARTIAL").length;
  const none = caps.filter(c => c.support === "NONE").length;
  const mechLayer: FidelityLayer = {
    layer: "MECHANIC", title: T("机制（本局需要的能力）", "Mechanics (capabilities this match needs)"),
    klass: caps.length === 0 ? "UNKNOWN" : none > 0 ? "GAPS" : partial > 0 ? "PARTIAL" : "COMPLETE",
    counts: [
      { label: T("本局涉及能力", "Capabilities used"), value: String(caps.length) },
      { label: T("完整支持", "Fully supported"), value: String(full) },
      { label: T("部分支持", "Partially supported"), value: String(partial) },
      { label: T("未支持", "Not supported"), value: String(none) },
    ],
    gaps: caps.filter(c => c.support !== "FULL").map(c => ({
      what: c.name, severity: c.support === "NONE" ? "BLOCK" as const : "WARN" as const,
      detail: c.registered === false
        ? T(`本局有 ${c.useCount} 处用到，但能力矩阵里没有登记这个能力 —— 支持度未知，按部分支持处理`, `Used ${c.useCount}x in this match but not registered in the capability matrix — support unknown, treated as partial`)
        : (c.support === "NONE" ? T(`本局有 ${c.useCount} 处用到但引擎未实现`, `Used ${c.useCount}x in this match; not implemented`) : T(`本局有 ${c.useCount} 处用到，引擎只实现了部分触发条件`, `Used ${c.useCount}x in this match; only part of its triggers is implemented`)),
    })),
    bar: { filled: full, total: Math.max(1, caps.length) },
  };

  // ───────── ⑤ Ruleset Fidelity（§8）─────────
  const unknown = input.ruleset.filter(r => r.status === "UNKNOWN");
  const hypo = input.ruleset.filter(r => r.status === "HYPOTHESIS");
  const rulesLayer: FidelityLayer = {
    layer: "RULESET", title: T("规则（开局/触发/死亡/残局）", "Rules (start / triggers / death / endgame)"),
    klass: unknown.length > 0 ? "GAPS" : hypo.length > 0 ? "PARTIAL" : "COMPLETE",
    counts: [
      { label: T("红区条目", "Red-zone entries"), value: String(input.ruleset.length) },
      { label: "UNKNOWN", value: String(unknown.length) },
      { label: "HYPOTHESIS", value: String(hypo.length) },
      { label: "VERIFIED", value: String(input.ruleset.filter(r => r.status === "VERIFIED").length) },
    ],
    gaps: [
      ...unknown.map(r => ({ what: r.id, severity: "BLOCK" as const, detail: T("该机制在游戏内没有可靠来源，引擎拒绝猜测", "No reliable in-game source for this mechanic; the engine refuses to guess") })),
      ...hypo.filter(r => en).map(r => ({ what: r.id, severity: "INFO" as const, detail: "HYPOTHESIS: an assumption the engine runs with; not confirmed in-game" })),
      ...(input.rulesetNotes ?? []).map(t => ({ what: T("说明", "Note"), severity: "INFO" as const, detail: t })),
    ],
    bar: { filled: input.ruleset.length - unknown.length, total: Math.max(1, input.ruleset.length) },
  };

  // ───────── 总分类（§10）——非评价性，只分类不打分 ─────────
  const layers = [inputLayer, skillLayer, aiLayer, mechLayer, rulesLayer];
  const reasons: string[] = [];
  let klass: FidelityClass;
  const allVerifiedAi = gameVerified === n && n > 0;
  const allRulesVerified = input.ruleset.length > 0 && unknown.length === 0 && hypo.length === 0;
  /**
   * ★★★ 分类按**成因**分，不按「有没有 UNKNOWN」分（第 60 轮修正）。
   *
   * 规格 §10 的两条定义都是成因式的：
   *   COMPLETE_UNVERIFIED =「代码路径完整 + 没有 NONE + 但仍包含未游戏实测机制」
   *   PARTIAL             =「存在 PARTIAL，但可以运行」
   * 二者**互斥**：只要有 PARTIAL，代码路径就不完整 —— 此时哪怕同时还有一堆 UNKNOWN 规则，
   * 也只能是 PARTIAL，不能贴「代码路径完整」那张标签。
   *
   * 改之前写的是 `unknown.length > 0 ? "COMPLETE_UNVERIFIED" : "PARTIAL"`：
   * 拿"有没有 UNKNOWN 规则"当分岔，而不是拿"代码路径完不完整"当分岔。
   * 实测 8 种组合里错了 4 种，而且错的方向是**过度声称** ——
   * 含部分实现机制的局被贴上了「代码路径完整」。这正是 §3「不能说 80% 真实性」要防的那一类，
   * 只是它伪装成了一个分类名，所以更难看出来。
   */
  const codeIncomplete = skillPartial > 0 || partial > 0;   // 存在 PARTIAL ⇒ 代码路径不完整
  const unverified = !allVerifiedAi || !allRulesVerified;   // 代码路径完整，但缺游戏内实测

  if (skillNone > 0 || none > 0) {
    klass = "INSUFFICIENT";
    if (skillNone > 0) reasons.push(T(`${skillNone} 个技能没有任何可执行数值`, `${skillNone} skill(s) have no executable value at all`));
    if (none > 0) reasons.push(T(`${none} 项本局必需机制引擎未实现`, `${none} mechanic(s) this match needs are not implemented`));
  } else if (codeIncomplete) {
    klass = "PARTIAL";
    if (skillPartial > 0) reasons.push(T(`${skillPartial} 个技能有未建模的附加效果 —— 代码路径不完整`, `${skillPartial} skill(s) have unmodelled extra effects — code path incomplete`));
    if (partial > 0) reasons.push(T(`${partial} 项机制只实现了一部分 —— 代码路径不完整`, `${partial} mechanic(s) only partly implemented — code path incomplete`));
    if (!allVerifiedAi) reasons.push(T("AI 行为未经游戏内验证", "AI behaviour not verified in-game"));
    if (unknown.length > 0) reasons.push(T(`${unknown.length} 项红区规则仍是 UNKNOWN`, `${unknown.length} red-zone rule(s) still UNKNOWN`));
    if (hypo.length > 0) reasons.push(T(`${hypo.length} 项红区规则是 HYPOTHESIS`, `${hypo.length} red-zone rule(s) are HYPOTHESIS`));
  } else if (unverified) {
    klass = "COMPLETE_UNVERIFIED";
    if (!allVerifiedAi) reasons.push(T("代码路径完整，但 AI 行为未经游戏内验证", "Code path complete, but AI behaviour not verified in-game"));
    if (input.ruleset.length === 0) reasons.push(T("红区规则表为空 —— 没有任何规则被声明为 VERIFIED", "Red-zone rule table is empty — no rule is declared VERIFIED"));
    else if (unknown.length > 0) reasons.push(T(`${unknown.length} 项红区规则仍是 UNKNOWN`, `${unknown.length} red-zone rule(s) still UNKNOWN`));
    else if (hypo.length > 0) reasons.push(T(`${hypo.length} 项红区规则是 HYPOTHESIS`, `${hypo.length} red-zone rule(s) are HYPOTHESIS`));
  } else {
    klass = "VERIFIED";
    reasons.push(T("本局所有必要机制 FULL、AI 已验证、规则全 VERIFIED", "Every needed mechanic FULL, AI verified, all rules VERIFIED"));
  }
  // 红区铁律的第二道防线：结构上 VERIFIED 已经要求 unknown === 0，这里再兜一次。
  if (klass === "VERIFIED" && unknown.length > 0) klass = "COMPLETE_UNVERIFIED";

  if (unknown.length > 0) caveats.push(T(`存在 ${unknown.length} 项 UNKNOWN 机制：即使本局所有技能都完整，也**不能**宣称这是一次已验证的模拟`,
    `${unknown.length} UNKNOWN mechanic(s) in use: even with every skill complete this cannot be called a verified simulation.`));
  /**
   * ★★ 八维里有两个维度**没有任何消费者**：效果命中 / 效果抵抗。
   *   引擎里不存在「先判定命中、再结算」这一级（EV.HIT / EV.BEFORE_HIT / EV.RESIST 从未派发，
   *   见 tools/field-allowlist.json），状态要么必定施加、要么按技能原文写明的概率掷骰。
   *   但界面把它们当普通属性显示，看的人会理所当然地以为它在参与结算 —— 所以必须说一次。
   *   这条与具体对局无关（机制本身不存在），所以是无条件 caveat。
   */
  const resisting = !!input.resist && input.resist.id !== "NOT_CONSUMED" && input.resist.id !== "NONE";
  if (resisting) {
    // The resist contest of kernel/resist.ts is in force (betting mode: SINGLE_ROLL_RATIO).
    caveats.push(T(`效果命中 / 效果抵抗参与结算（${input.resist!.id}，${input.resist!.status}）：对敌方施加的减益（技能与御魂）一次掷骰，概率 = 基础概率 × (1 + 命中) / (1 + 抵抗)；原文未写概率时基础概率按 100%。公式没有官方来源。`,
      `Effect HIT / RES are resolved (${input.resist!.id}, ${input.resist!.status}): every debuff a skill or soul puts on an enemy is one roll at base chance × (1 + HIT) / (1 + RES); a debuff with no written chance has base 100%. The formula has no official source.`));
  } else {
    caveats.push(T("效果命中 / 效果抵抗未参与任何结算：引擎没有「先判定命中、再结算」这一级（状态要么必中、要么按技能原文写明的概率掷骰）。面板上这两维目前只是输入记录。",
      "Effect HIT / RES take no part in any roll under this policy: statuses either always land or roll the chance written in the skill text. These two stats are input records only."));
  }
  caveats.push(T("本报告不给「真实性百分比」：Capability Coverage 与编译率都不能线性映射成真实性",
    "This report gives no \"accuracy percentage\": capability coverage and compile rates do not map to realism."));

  return { schemaVersion: 1, klass, layers, reasons, caveats, skills: skillStatus };
}

export const FIDELITY_CLASS_LABEL: Record<FidelityClass, string> = {
  VERIFIED: "已验证（所有必要机制 FULL + AI 已验证 + 规则全 VERIFIED）",
  COMPLETE_UNVERIFIED: "代码路径完整，但包含未游戏实测的机制",
  PARTIAL: "存在部分实现的机制，可以运行",
  INSUFFICIENT: "关键技能/御魂/机制未实现，本局结果不可用",
};
