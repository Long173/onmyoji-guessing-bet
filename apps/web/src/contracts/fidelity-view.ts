// contracts/fidelity-view.ts — ★★★ 第 138 轮：Per-Match Fidelity 的**逐技能**视图契约（a1-4 §33）
//
// 背景（第 137 轮审核的结论）：§33 要求「卡上按逐技能机制实现度 ● FULL / ◐ PARTIAL 并可展开」，
// 而当时的实现是「数据在不在」的四色圆点，展开抽屉里只有原始技能文本 —— **编译产物到不了界面**：
// kernel/fidelity.ts 把 30 个技能聚合成 6 个计数，逐技能那一层在载荷里根本不存在。
//
// 这一层把它补上。两条纪律：
//   ① **结构镜像**：页面层不许 import @engine（vite.config 的 alias 注释在守这条），所以这里自己声明形状；
//      漂移由 tests/ui10-fidelity.ts 拿**真引擎产出的载荷**逐字段核对。
//   ② **词汇只有一份**：记号与短标签声明在这里，卡面 / 抽屉 / 面板都读它；与 kernel/fidelity.ts 的
//      SKILL_CLASS_MARK / SKILL_CLASS_LABEL **逐字节相等**由 ui10 断言（不许各写各的、慢慢写歪）。

export type SkillFidelityClass = "FULL" | "PARTIAL" | "PASSIVE" | "NONE" | "NEVER_CAST";

/** 引擎 MatchFidelity.skills[] 的一条（载荷里的原样） */
export interface SkillFidelityView {
  unit: string;
  side: "red" | "blue";
  name: string;
  klass: SkillFidelityClass;
  /** 未解析的机制句数量 */
  unparsed: number;
  /** 引擎**明确跳过**的记录条数 */
  skipped: number;
  /** 依赖哪些未建模机制（动词名）—— ★ 它不参与分档，界面上必须与档位分开显示 */
  unmodeled: string[];
  /** KB skill id and English display name (betting-mode payload) */
  skillId?: string;
  label?: string;
  /** Betting mode: a hand-written module implements this skill ("module: note") */
  handWritten?: string;
  /** Betting mode: why the AI never casts it */
  neverCast?: string;
}

/** 记号与短标签（与 kernel/fidelity.ts 逐字节一致，ui10 断言） */
export const SKILL_MARK: Record<SkillFidelityClass, string> = { FULL: "●", PARTIAL: "◐", PASSIVE: "○", NONE: "✕", NEVER_CAST: "⊘" };
export const SKILL_LABEL: Record<SkillFidelityClass, string> = {
  FULL: "Fully compiled", PARTIAL: "Partially compiled", PASSIVE: "Passive (trigger not modelled)", NONE: "Active, no executable values",
  NEVER_CAST: "Never cast (AI)",
};
/** Badge label of a skill: a hand-written betting kit says so instead of "compiled". */
export function skillLabelOf(s: Pick<SkillFidelityView, "klass" | "handWritten">): string {
  if (s.handWritten && s.klass === "FULL") return "Hand-written betting kit";
  if (s.handWritten && s.klass === "PARTIAL") return "Hand-written betting kit, partial";
  return SKILL_LABEL[s.klass];
}
/** Display name of a skill (English name from the payload when present). */
export const skillNameOf = (s: Pick<SkillFidelityView, "name" | "label">): string => s.label ?? s.name;

/**
 * 内核（battle-lab/kernel/fidelity.ts）的层标题与计数标签是中文定值；界面按层 id / 原文查英文，
 * 查不到就原样显示（内核新增条目不会消失，只是暂时是中文）。注释 / 缺口 / 理由是动态文本，保持内核原文。
 */
export const FIDELITY_LAYER_TITLE: Record<string, string> = {
  INPUT: "Input (8 stats / Souls)", SKILL: "Skills (every skill this match may use)",
  AI: "AI (Wiki rules ≠ 2026 server behaviour)", MECHANIC: "Mechanics (capabilities this match needs)",
  RULESET: "Rules (start / triggers / death / endgame)",
};
export const FIDELITY_COUNT_LABEL: Record<string, string> = {
  "式神身份": "Shikigami identified", "八维面板": "8-stat panel", "御魂已识别": "Souls recognised",
  "御魂输入缺失": "Soul input missing", "面板重复叠加": "Stats double-counted",
  "本局技能总数": "Skills in this match", "四档合计": "Sum of the four tiers",
  "完整编译（无可执行缺口）": "Fully compiled (no executable gap)",
  "部分编译（有未建模附加效果）": "Partially compiled (unmodelled extra effects)",
  "被动技能（引擎未建模其触发条件）": "Passive (engine does not model its trigger)",
  "主动技能但无可执行数值": "Active, no executable values",
  "依赖未建模机制的技能": "Skills relying on unmodelled mechanics",
  "含「引擎明确跳过」的技能": "Skills with steps the engine explicitly skips",
  "AI 数据存在": "AI data present", "已编译": "Compiled", "游戏内已验证": "Verified in-game",
  "条件解析不出的规则": "Rules with unparseable conditions",
  "本局涉及能力": "Capabilities used", "完整支持": "Fully supported", "部分支持": "Partially supported",
  "未支持": "Not supported", "红区条目": "Red-zone entries",
};

/** 严重度顺序（卡面小圆点取「最重」的那一档）：NONE > PARTIAL > PASSIVE > FULL */
export const SKILL_SEVERITY: SkillFidelityClass[] = ["NONE", "PARTIAL", "PASSIVE", "NEVER_CAST", "FULL"];
/**
 * **显示**顺序（记数串与逐条清单按它排）：与档位表同序 —— 先 ● 后 ◐。
 * ★ 与 SKILL_SEVERITY 是两个不同的东西（一个问「最重是谁」，一个问「先写谁」），
 *   所以它们是两张表；混用会让记数串读成 ◐1 ●2（第 138 轮第一版就是这样，SSR 渲染时被抓到）。
 */
export const SKILL_TIER_ORDER: SkillFidelityClass[] = ["FULL", "PARTIAL", "PASSIVE", "NEVER_CAST", "NONE"];

export interface FidelityCountView { label: string; value: string; note?: string }
export interface FidelityGapView { what: string; severity: string; detail: string }
export interface FidelityLayerView {
  layer: string; title: string; klass: string;
  counts: FidelityCountView[]; gaps: FidelityGapView[];
  bar: { filled: number; total: number } | null;
}
export interface FidelityView {
  klass: string;
  layers: FidelityLayerView[];
  reasons: string[];
  caveats: string[];
  /** ★ 第 138 轮：逐技能编译状态（引擎侧同名字段；缺省时按「没有这一层信息」处理） */
  skills?: SkillFidelityView[];
}

/** 取某个单位的逐技能状态（载荷缺失 / 名字对不上时返回空数组，界面显示「无编译信息」） */
export function skillStatusOf(fidelity: unknown, side: "red" | "blue", name: string): SkillFidelityView[] {
  const list = (fidelity as FidelityView | null)?.skills;
  if (!Array.isArray(list)) return [];
  return list.filter(s => s.side === side && s.unit === name);
}

/** 最重的一档（列表为空时 null）。判据用 SKILL_SEVERITY，不另写一套顺序。 */
export function worstSkillClass(list: SkillFidelityView[]): SkillFidelityClass | null {
  for (const k of SKILL_SEVERITY) if (list.some(s => s.klass === k)) return k;
  return null;
}

/** 记数串（形如 ●2 ◐1）；按 SKILL_SEVERITY 排，保证同输入同输出 */
export function skillTally(list: SkillFidelityView[]): string {
  return SKILL_TIER_ORDER.filter(k => list.some(s => s.klass === k))
    .map(k => SKILL_MARK[k] + list.filter(s => s.klass === k).length).join(" ");
}

/** 逐技能状态按单位分组（**保序**：先出现的单位在前，单位内保持引擎给的顺序） */
export function groupSkillStatus(list: SkillFidelityView[]): Array<{ key: string; unit: string; side: "red" | "blue"; skills: SkillFidelityView[]; tally: string; worst: SkillFidelityClass | null }> {
  const out: Array<{ key: string; unit: string; side: "red" | "blue"; skills: SkillFidelityView[]; tally: string; worst: SkillFidelityClass | null }> = [];
  for (const s of list) {
    const key = s.side + "/" + s.unit;
    let g = out.find(x => x.key === key);
    if (!g) { g = { key, unit: s.unit, side: s.side, skills: [], tally: "", worst: null }; out.push(g); }
    g.skills.push(s);
  }
  for (const g of out) { g.tally = skillTally(g.skills); g.worst = worstSkillClass(g.skills); }
  return out;
}
