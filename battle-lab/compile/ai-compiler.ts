// compile/ai-compiler.ts — 官方 cast/target 自然语言规则 -> 可执行谓词
// 数据来源：data/kb/ai.json（灰机 SkillAI，272 条，官方语义由社区整理）
// 原则同技能编译器：匹配不上的一律进 unresolved[]，绝不猜。
import { skillLevelMode } from "./max-level.ts";

/**
 * ATK read by the "highest ATK ally" target rules. Betting (MAX) mode: the initial panel ATK (entity.base) plus the
 * permanent form conversions the betting kits add at battle start (modifiers sourced "betting:…", e.g. 云外镜 Yin
 * +200% DEF as ATK) — but no status effects: live ATK is distorted by debuffs such as 紧盯 (-35%), which moved
 * 神无月's 入梦 off the strongest attacker (match 4). HYPOTHESIS from the match-6 replay: Kuro (5484 panel) paid the
 * full 3 onibi for 连斩 right after 美梦赐予, i.e. 入梦 went to Yin Ungaikyo (4241 + 2 × 707 = 5655 ATK).
 * BASE mode: the live ATK, unchanged.
 */
export const targetingAtk = (x: any): number => {
  if (skillLevelMode() !== "MAX") return x.prop("atk");
  let fixed = Number(x?.base?.atk ?? x.prop("atk")), rate = 0;
  for (const m of (x?.effects ?? []) as Array<{ prop: string; value: number; mode: string; source: string }>) {
    if (m.prop !== "atk" || !String(m.source).startsWith("betting:")) continue;
    if (m.mode === "FIXED") fixed += m.value; else if (m.mode === "ADD_RATE") rate += m.value;
  }
  return fixed * (1 + rate);
};
const allyAtk = targetingAtk;
export interface AICtx {
  self: any; allies: any[]; enemies: any[]; orbs: number; maxOrbs: number;
  turn: number; skillAvailable: (ref: string) => boolean; rng: any;
  /** 该技能本场是否已使用过（可选实现；未实现时调用方需自行判空） */
  usedSkill?: (ref: string) => boolean;
  hasBuff: (e: any, kw: string) => boolean;
  /**
   * ★★★ 第 116 轮：**场地（幻境 / 结界）查询回调**。
   *   ★ 缺省时谓词必须**失败关闭**（返回 false）—— 第 114 轮的教训：求值不了 ≠ 条件成立。
   */
  inFieldOf?: (e: any, kind: "ILLUSION" | "BARRIER", name?: string) => boolean;
  fieldRemaining?: (kind: "ILLUSION" | "BARRIER", name?: string) => number;
}

export type Predicate = (c: AICtx) => boolean;
export type Selector = (c: AICtx, cands: any[]) => any | undefined;

export interface SkillRef { index: number | null; raw: string; label: string }

export interface SkillRuleIR { priority: number; condRaw: string; cond: Predicate | null; skill: SkillRef; confidence: "HIGH" | "LOW" }
export interface TargetRuleIR { skill: SkillRef; ruleRaw: string; selector: Selector | null; confidence: "HIGH" | "LOW" }

export interface AIProfileIR {
  charId: number; charName: string;
  skillRules: SkillRuleIR[]; targetRules: TargetRuleIR[];
  unresolvedConds: string[]; unresolvedRules: string[];
  /**
   * ★ 数据质量信号：「没有写明触发条件」的规则。引擎按"每回合都满足"处理，
   * 但这往往不是官方的真实行为 —— 例如思金神 601 的 cast 只有一条
   * 「3技能（即使友方单位仅存活自身）」，cond 为空，结果就是**每回合重复施放**
   * 「智火长明」（自损 24% 生命换一个 buff），全程不普攻。
   * 引擎不猜，但必须把这件事报出来，而不是给它打上 HIGH 置信度。
   */
  unconditionalRules: string[];
  /** 技能名后面括号里的补充说明（「3技能（即使友方单位仅存活自身）」→「即使友方单位仅存活自身」） */
  skillAnnotations: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

/** 「3技能」/「普攻」/「2技能【花之馨香】」-> 技能序号 */
/** 按技能名解析（阴阳师用的是「言灵·星」这类中文名，不是"N技能"）。
 *  skillNames 来自实际装载的技能列表；匹配不上就返回 null，绝不猜。 */
export function parseSkillRefByName(raw: string, skillNames: string[]): SkillRef | null {
  const s = (raw ?? "").trim();
  if (!s || !skillNames.length) return null;
  const norm = (x: string) => x.replace(/^\[[^\]]*\]|\[/g, "").replace(/[「」\[\]]/g, "").trim();
  const target = norm(s);
  if (!target || target.length < 2) return null;
  for (let i = 0; i < skillNames.length; i++) if (norm(skillNames[i]) === target) return { index: i, raw: s, label: s };
  for (let i = 0; i < skillNames.length; i++) {
    const n = norm(skillNames[i]);
    if (n && (n.includes(target) || target.includes(n))) return { index: i, raw: s, label: s };
  }
  return null;
}

export function parseSkillRef(raw: string): SkillRef {
  const s = (raw ?? "").trim();
  if (/普攻|普通攻击/.test(s)) return { index: 0, raw: s, label: "普攻" };
  const m = s.match(/([1-4])\s*技能/);
  if (m) return { index: Number(m[1]) - 1, raw: s, label: s };
  if (/序幕/.test(s)) return { index: 0, raw: s, label: s };
  if (/盛幕/.test(s)) return { index: 2, raw: s, label: s };
  return { index: null, raw: s, label: s };
}

const num = (s: string) => parseFloat(s);

/** ---------- 技能选择条件词典 ---------- */
const COND_RULES: Array<{ re: RegExp; make: (m: RegExpMatchArray) => Predicate; note: string }> = [
  /**
   * ★★★ 第 116 轮：**场地（幻境 / 结界）条件** —— 第 115 轮把场地做出来了，这一轮把条件接上。
   *
   * ★ 名字捕获写成 `([^，。；]{0,8}?(?:幻境|结界))` 并允许**空前缀**：第一版写 `(.+?)`，
   *   于是「自身处于幻境时」这种「动词后面直接就是幻境」的写法**一条都匹配不上**。
   * ★ 这几条必须排在通用 buff 规则**前面**：否则「不存在山行结界时」会落到
   *   `/(?:未拥有|没有|不存在)(.+?)…/` 上，被求值成「身上没有叫山行结界的 buff」——
   *   一个**永远为真**的谓词。那比「解析不出」更糟：它会被当成条件成立放行。
   * ★ 求值逻辑**内联**在每条 make 里（不引外部小工具）：`AICtx` 没有场地回调时一律 false ——
   *   失败关闭，绝不默认「条件成立」（第 114 轮的纪律）。
   */
  { re: /自身未处于([^，。；]{0,8}?(?:幻境|结界))或[^，。；]{0,8}?剩余(?:时间|回合数)\s*=?\s*1\s*(?:回合)?时?/, note: "自身不在场地、或场地仅剩1回合",
    make: (m) => (c) => { const w = m[1]; const k = /幻境/.test(w) ? "ILLUSION" : "BARRIER"; const n = /幻境/.test(w) ? undefined : w.replace(/结界$/, "");
      const inF = c.inFieldOf ? c.inFieldOf(c.self, k as any, n) : false; const left = c.fieldRemaining ? c.fieldRemaining(k as any, n) : 0; return !inF || left <= 1; } },
  { re: /(?:无|没有|不存在)([^，。；]{0,8}?(?:幻境|结界))或[^，。；]{0,8}?剩余时间\s*1\s*(?:回合)?/, note: "无场地、或场地仅剩1回合",
    make: (m) => (c) => { const w = m[1]; const k = /幻境/.test(w) ? "ILLUSION" : "BARRIER"; const n = /幻境/.test(w) ? undefined : w.replace(/结界$/, "");
      const inF = c.inFieldOf ? c.inFieldOf(c.self, k as any, n) : false; const left = c.fieldRemaining ? c.fieldRemaining(k as any, n) : 0; return !inF || left <= 1; } },
  { re: /自身未处于([^，。；]{0,8}?(?:幻境|结界))时?/, note: "自身不在场地",
    make: (m) => (c) => { const w = m[1]; const k = /幻境/.test(w) ? "ILLUSION" : "BARRIER"; const n = /幻境/.test(w) ? undefined : w.replace(/结界$/, ""); return c.inFieldOf ? !c.inFieldOf(c.self, k as any, n) : false; } },
  { re: /自身处于([^，。；]{0,8}?(?:幻境|结界))时?/, note: "自身在场地",
    make: (m) => (c) => { const w = m[1]; const k = /幻境/.test(w) ? "ILLUSION" : "BARRIER"; const n = /幻境/.test(w) ? undefined : w.replace(/结界$/, ""); return c.inFieldOf ? c.inFieldOf(c.self, k as any, n) : false; } },
  { re: /所有友方均无([^，。；]{0,8}?(?:幻境|结界))时?/, note: "所有友方均无该场地",
    make: (m) => (c) => { const w = m[1]; const k = /幻境/.test(w) ? "ILLUSION" : "BARRIER"; const n = /幻境/.test(w) ? undefined : w.replace(/结界$/, "");
      return c.inFieldOf ? c.allies.every((a: any) => !c.inFieldOf!(a, k as any, n)) : false; } },
  { re: /(?:不存在|没有|无)([^，。；]{0,8}?(?:幻境|结界))时?/, note: "场上没有该场地",
    make: (m) => (c) => { const w = m[1]; const k = /幻境/.test(w) ? "ILLUSION" : "BARRIER"; const n = /幻境/.test(w) ? undefined : w.replace(/结界$/, ""); return c.inFieldOf ? !c.inFieldOf(c.self, k as any, n) : false; } },
  { re: /^\s*$/, note: "无条件", make: () => () => true },
  { re: /^(否则|优先|随后|默认)$/, note: "否则/默认分支", make: () => () => true },
  { re: /鬼火充足/, note: "鬼火充足", make: () => (c) => c.orbs > 0 },
  { re: /鬼火不足/, note: "鬼火不足", make: () => (c) => c.orbs <= 0 },
  { re: /敌方(?:单位)?剩余数量\s*(?:大于|≥|>|＞)=?\s*(\d+)\s*(?:或|且)?\s*(?:己方)?鬼火(?:数量)?\s*(?:大于|＞|>|≥)\s*(\d+)/, note: "敌数或鬼火",
    make: (m) => (c) => c.enemies.length >= num(m[1]) || c.orbs > num(m[2]) },
  { re: /鬼火(?:数量)?\s*[＞>]\s*(\d+)/, note: "鬼火>N", make: (m) => (c) => c.orbs > num(m[1]) },
  { re: /鬼火(?:数量)?\s*[≥>]=?\s*(\d+)/, note: "鬼火>=N", make: (m) => (c) => c.orbs >= num(m[1]) },
  { re: /(?:鬼火数|剩余鬼火|鬼火)[^。；\n]{0,4}?(?:小于|少于|不足)\s*(\d+)/, note: "鬼火<N", make: (m) => (c) => c.orbs < num(m[1]) },
  { re: /(?:鬼火数|剩余鬼火|鬼火)[^。；\n]{0,4}?(?:小于等于|不超过)\s*(\d+)/, note: "鬼火<=N", make: (m) => (c) => c.orbs <= num(m[1]) },
  { re: /敌方(?:单位)?(?:剩余)?数量\s*=\s*(\d+)/, note: "敌数=N", make: (m) => (c) => c.enemies.length === num(m[1]) },
  { re: /敌方(?:单位)?(?:剩余)?数量\s*[≤<]=?\s*(\d+)/, note: "敌数<=N", make: (m) => (c) => c.enemies.length <= num(m[1]) },
  { re: /敌方(?:单位)?(?:剩余)?数量\s*[≥>]=?\s*(\d+)/, note: "敌数>=N", make: (m) => (c) => c.enemies.length >= num(m[1]) },
  { re: /我方(?:目标)?存活数量\s*[≥>]=?\s*(\d+)/, note: "我方存活>=N", make: (m) => (c) => c.allies.length >= num(m[1]) },
  { re: /我方(?:目标)?存活数量\s*[＜<]=?\s*(\d+)/, note: "我方存活<N", make: (m) => (c) => c.allies.length < num(m[1]) },
  { re: /友方单位血量低于\s*(\d+(?:\.\d+)?)%/, note: "友方血量<N%", make: (m) => (c) => c.allies.some(a => a.hp / a.maxHp < num(m[1]) / 100) },
  { re: /我方有可复活目标/, note: "有可复活目标", make: () => (c) => c.allies.some(a => a.dead && !a.reviveBlocked) },
  { re: /我方(?:目标)?(?:未存在|无)buff|友方(?:单位)?无buff/, note: "我方无buff", make: () => (c) => c.allies.some(a => a.statuses.length === 0) },
  { re: /不处于(.+?)行动时/, note: "不处于某状态", make: (m) => (c) => !c.hasBuff(c.self, m[1]) },
  { re: /处于(.+?)行动时/, note: "处于某状态", make: (m) => (c) => c.hasBuff(c.self, m[1]) },
  { re: /敌方目标未存在buff/, note: "敌方无buff", make: () => (c) => c.enemies.some(a => a.statuses.length === 0) },
  { re: /敌方目标存在buff/, note: "敌方有buff", make: () => (c) => c.enemies.some(a => a.statuses.length > 0) },
  { re: /(\d+)技能不可用/, note: "技能不可用", make: (m) => (c) => !c.skillAvailable(m[1] + "技能") },
  { re: /(\d+(?:\.\d+)?)%\s*概率/, note: "N%概率", make: (m) => (c) => c.rng.testHit(num(m[1]) / 100) },
  { re: /自身拥有(.+?)时/, note: "自身有指定buff", make: (m) => (c) => c.hasBuff(c.self, m[1]) },
  // --- 自身血量（容忍「时，优先」等后缀与裸写法「高于40%时」）---
  { re: /自身血量(?:比例)?\s*(?:低于|小于)\s*(\d+(?:\.\d+)?)%/, note: "自身血量<N%", make: (m) => (c) => c.self.hp / c.self.maxHp < num(m[1]) / 100 },
  { re: /自身血量(?:比例)?\s*(?:高于|大于)\s*(\d+(?:\.\d+)?)%/, note: "自身血量>N%", make: (m) => (c) => c.self.hp / c.self.maxHp > num(m[1]) / 100 },
  { re: /^(?:高于|大于)\s*(\d+(?:\.\d+)?)%\s*时/, note: "自身血量>N%（裸写法）", make: (m) => (c) => c.self.hp / c.self.maxHp > num(m[1]) / 100 },
  { re: /^(?:低于|小于)\s*(\d+(?:\.\d+)?)%\s*时/, note: "自身血量<N%（裸写法）", make: (m) => (c) => c.self.hp / c.self.maxHp < num(m[1]) / 100 },
  // --- 友方群体血量（含「均高于」变体）---
  { re: /友方单位血量均(?:高于|大于)\s*(\d+(?:\.\d+)?)%/, note: "全体友方>N%", make: (m) => (c) => c.allies.length > 0 && c.allies.every(a => a.hp / a.maxHp > num(m[1]) / 100) },
  { re: /友方单位血量均(?:低于|小于)\s*(\d+(?:\.\d+)?)%/, note: "全体友方<N%", make: (m) => (c) => c.allies.length > 0 && c.allies.every(a => a.hp / a.maxHp < num(m[1]) / 100) },
  // --- 友方数量 ---
  { re: /友方(?:剩余)?单位(?:剩余)?数量?\s*(?:等于|=)\s*(\d+)/, note: "友方数=N", make: (m) => (c) => c.allies.length === num(m[1]) },
  { re: /友方(?:剩余)?单位?\s*[≥>]=?\s*(\d+)/, note: "友方数>=N", make: (m) => (c) => c.allies.length >= num(m[1]) },
  { re: /友方剩余单位\s*[≥>]=?\s*(\d+)/, note: "友方剩余>=N", make: (m) => (c) => c.allies.length >= num(m[1]) },
  // --- 自身资源/层数（星辰之力、狂气…）---
  { re: /自身(.+?)\s*(?:大于等于|≥|>=)\s*(\d+)\s*时/, note: "自身层数>=N", make: (m) => (c) => c.hasBuff(c.self, m[1]) },
  { re: /自身(.+?)\s*(?:小于等于|≤|<=)\s*(\d+)\s*时/, note: "自身层数<=N", make: (m) => (c) => !c.hasBuff(c.self, m[1]) },
  // --- 技能使用状态 ---
  { re: /未使用\s*(\d+)\s*技能时/, note: "尚未用过N技能", make: (m) => (c) => !c.usedSkill?.(m[1] + "技能") },
  { re: /自身生命比例在\s*(\d+(?:\.\d+)?)%\s*以上/, note: "自身血量>=N%", make: (m) => (c) => c.self.hp / c.self.maxHp >= num(m[1]) / 100 },
  { re: /自身生命比例在\s*(\d+(?:\.\d+)?)%\s*以下/, note: "自身血量<=N%", make: (m) => (c) => c.self.hp / c.self.maxHp <= num(m[1]) / 100 },
  { re: /自身生命比例(?:低于|小于)\s*(\d+(?:\.\d+)?)%/, note: "自身血量<N%", make: (m) => (c) => c.self.hp / c.self.maxHp < num(m[1]) / 100 },
  { re: /自身生命比例(?:高于|大于)\s*(\d+(?:\.\d+)?)%/, note: "自身血量>N%", make: (m) => (c) => c.self.hp / c.self.maxHp > num(m[1]) / 100 },
  { re: /自身生命(?:上限)?(?:低于|小于)\s*(\d+(?:\.\d+)?)%/, note: "自身血量<N%", make: (m) => (c) => c.self.hp / c.self.maxHp < num(m[1]) / 100 },
  // --- 友方群体血量（本轮新增簇）---
  { re: /所有友方单位生命比例\s*(\d+(?:\.\d+)?)%\s*以上/, note: "全体友方>=N%", make: (m) => (c) => c.allies.length > 0 && c.allies.every(a => a.hp / a.maxHp >= num(m[1]) / 100) },
  { re: /友方单位血量均大于\s*(\d+(?:\.\d+)?)%/, note: "全体友方>N%", make: (m) => (c) => c.allies.length > 0 && c.allies.every(a => a.hp / a.maxHp > num(m[1]) / 100) },
  { re: /(?:存在友方单位|友方存在单位)血量(?:比例)?(?:小于|低于)\s*(\d+(?:\.\d+)?)%/, note: "存在友方<N%", make: (m) => (c) => c.allies.some(a => a.hp / a.maxHp < num(m[1]) / 100) },
  // --- buff 存在性（自身 / 我方）---
  { re: /(?:未拥有|没有|不存在)(.+?)(?:buff|状态|印记)?时?$/, note: "自身无某buff", make: (m) => (c) => !c.hasBuff(c.self, m[1]) },
  { re: /(?:已拥有|拥有|存在)(.+?)(?:buff|状态|印记)(?:时)?$/, note: "自身有某buff", make: (m) => (c) => c.hasBuff(c.self, m[1]) },
  { re: /我方(?:存在|有)(.+?)(?:buff|状态|印记)?(?:时)?$/, note: "我方存在某buff", make: (m) => (c) => c.allies.some(a => c.hasBuff(a, m[1])) },
  { re: /我方无(.+?)(?:buff|状态|印记)?时?$/, note: "我方无某buff", make: (m) => (c) => !c.allies.some(a => c.hasBuff(a, m[1])) },
  // --- 回合数 / 层数 ---
  { re: /第\s*(\d+)\s*回合/, note: "回合数>=N", make: (m) => (c) => c.turn >= num(m[1]) },
  { re: /(.+?)层数\s*[≥>]=?\s*(\d+)\s*时?/, note: "某层数>=N", make: (m) => (c) => c.hasBuff(c.self, m[1]) },
  // --- 排序标记：不是条件，而是优先级顺序的表达 ---
  { re: /^(先|随后|然后|接着|解锁前|之后)$/, note: "顺序标记（按优先级顺序求值即为默认分支）", make: () => () => true },
];

/** ---------- 目标选择规则词典 ---------- */
const TARGET_RULES: Array<{ re: RegExp; make: (m: RegExpMatchArray) => Selector; note: string }> = [
  { re: /优先选择血量低于\s*(\d+(?:\.\d+)?)%\s*的单位|优先血量\s*(\d+(?:\.\d+)?)%\s*以下的?目标/, note: "追残(血量比例)",
    make: (m) => (c, cands) => { const th = num(m[1] ?? m[2]) / 100; const low = cands.filter(x => x.hp / x.maxHp < th); return (low.length ? low : cands).reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a), cands[0]); } },
  { re: /优先选择血量低于\s*(\d+(?:\.\d+)?)%\s*的(?:敌方单位|友方单位|目标)|优先选择血量比例低于\s*(\d+(?:\.\d+)?)%\s*的敌方/, note: "追残(带单位后缀)",
    make: (m) => (c, cands) => { const th = num(m[1] ?? m[2]) / 100; const low = cands.filter(x => x.hp / x.maxHp < th); return (low.length ? low : cands).reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a), cands[0]); } },
  { re: /优先选择血量低的(?:敌方|友方)(?!单位)|优先选择血量低的$/, note: "最低生命比例(无阈值)",
    make: () => (_c, cands) => cands.reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a), cands[0]) },
  { re: /优先选择绝对血量更低的(?:敌方|友方)/, note: "最低绝对血量",
    make: () => (_c, cands) => cands.reduce((a, b) => (b.hp < a.hp ? b : a), cands[0]) },
  { re: /优先选择没有buff的友方中攻击最高的/, note: "无buff友方中攻击最高",
    make: () => (_c, cands) => { const f = cands.filter(x => x.statuses.length === 0); const pool = f.length ? f : cands; return pool.reduce((a, b) => (allyAtk(b) > allyAtk(a) ? b : a), pool[0]); } },
  { re: /固定选择施放了2技能的友方单位/, note: "固定目标(需战场标记)", make: () => (_c, cands) => cands[0] },
  { re: /优先选择没有护盾的友方单位/, note: "无护盾友方",
    make: () => (_c, cands) => { const f = cands.filter(x => x.shields.length === 0 || x.shields.every((s: any) => s.broken)); return (f.length ? f : cands)[0]; } },
  { re: /优先选择血量低的(?:友方单位|敌方单位)/, note: "最低生命比例",
    make: () => (_c, cands) => cands.reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a), cands[0]) },
  { re: /优先选择生命比例最低|优先选择生命比例低的敌方/, note: "最低生命比例",
    make: () => (_c, cands) => cands.reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a), cands[0]) },
  { re: /优先选择(?:绝对血量|血量绝对值)最高|选择血量最高的单位|优先选择生命值最高的敌方|优先选择血量高的敌方|优先选择血量高于\d+%/, note: "最高绝对血量",
    make: () => (_c, cands) => cands.reduce((a, b) => (b.hp > a.hp ? b : a), cands[0]) },
  { re: /(?:绝对血量|血量绝对值)更高|(?:绝对血量|血量绝对值)最高的敌方/, note: "最高绝对血量(变体)",
    make: () => (_c, cands) => cands.reduce((a, b) => (b.hp > a.hp ? b : a), cands[0]) },
  { re: /优先选择敌方攻击最高的单位|优先选择攻击最高的敌方(?:单位)?|攻击最高的敌方/, note: "最高攻击敌方",
    make: () => (_c, cands) => cands.reduce((a, b) => (b.prop("atk") > a.prop("atk") ? b : a), cands[0]) },
  { re: /优先选择没有(.+?)buff的敌方单位/, note: "无指定buff的敌方",
    make: (m) => (c, cands) => { const f = cands.filter(x => !c.hasBuff(x, m[1])); return (f.length ? f : cands)[0]; } },
  { re: /生命比例处于\s*(\d+(?:\.\d+)?)%\s*以下/, note: "追残(处于X%以下)",
    make: (m) => (c, cands) => { const th = num(m[1]) / 100; const low = cands.filter(x => x.hp / x.maxHp < th); return (low.length ? low : cands).reduce((a, b) => (b.hp / b.maxHp < a.hp / a.maxHp ? b : a), cands[0]); } },
  { re: /优先选择攻击高的友方|选择攻击最高的单位/, note: "最高攻击友方",
    make: () => (_c, cands) => cands.reduce((a, b) => (allyAtk(b) > allyAtk(a) ? b : a), cands[0]) },
  { re: /随机/, note: "随机",
    make: () => (c, cands) => c.rng.pick(cands) },
  { re: /优先选择带有减益效果且数量最多的友方单位/, note: "减益最多的友方",
    make: () => (_c, cands) => cands.reduce((a, b) => (b.statuses.filter((s: any) => s.def.category.startsWith("DEBUFF")).length > a.statuses.filter((s: any) => s.def.category.startsWith("DEBUFF")).length ? b : a), cands[0]) },
  { re: /优先选择没有(.+?)buff的、攻击最高的友方/, note: "无指定buff中攻击最高",
    make: (m) => (c, cands) => { const f = cands.filter(x => !c.hasBuff(x, m[1])); const pool = f.length ? f : cands; return pool.reduce((a, b) => (allyAtk(b) > allyAtk(a) ? b : a), pool[0]); } },
];

export function compileAI(charId: number, charName: string, aiEntry: any, skillNames: string[] = []): AIProfileIR {
  const resolve = (raw: string): SkillRef => {
    const byPos = parseSkillRef(raw);
    if (byPos.index !== null || !skillNames.length) return byPos;
    return parseSkillRefByName(raw, skillNames) ?? byPos;
  };
  const skillRules: SkillRuleIR[] = [];
  const targetRules: TargetRuleIR[] = [];
  const unresolvedConds: string[] = [];
  const unresolvedRules: string[] = [];
  const unconditionalRules: string[] = [];
  const skillAnnotations: string[] = [];

  const casts = aiEntry?.cast ?? [];
  casts.forEach((c: any, i: number) => {
    /** 场地条件的两把小工具（kind/name 从条件原文里读；回调缺失 ⇒ false，不默认成立） */
  const condRaw = (c.cond ?? "").trim();
    let cond: Predicate | null = null;
    for (const r of COND_RULES) {
      const m = condRaw.match(r.re);
      if (m) { cond = r.make(m as RegExpMatchArray); break; }
    }
    if (!cond) unresolvedConds.push(condRaw || "(空)");
    // 「没写条件」不是「无条件」：两者行为相同，但可信度完全不同，必须分开记录
    if (!condRaw) unconditionalRules.push(String(c.skill ?? "").trim() + " → 每回合都会施放");
    const ann = String(c.skill ?? "").match(/[（(]([^）)]+)[）)]/);
    if (ann) skillAnnotations.push(ann[1]);
    skillRules.push({
      priority: casts.length - i,
      condRaw, cond,
      skill: resolve(c.skill ?? ""),
      confidence: cond ? "HIGH" : "LOW",
    });
  });

  for (const t of aiEntry?.target ?? []) {
    const ruleRaw = (t.rule ?? "").trim();
    let selector: Selector | null = null;
    for (const r of TARGET_RULES) {
      const m = ruleRaw.match(r.re);
      if (m) { selector = r.make(m as RegExpMatchArray); break; }
    }
    if (!selector) unresolvedRules.push(ruleRaw);
    targetRules.push({ skill: resolve(t.skill ?? ""), ruleRaw, selector, confidence: selector ? "HIGH" : "LOW" });
  }

  const allRefsOk = [...skillRules.map(s => s.skill), ...targetRules.map(t => t.skill)].every(r => r.index !== null);
  const total = skillRules.length + targetRules.length;
  const resolved = skillRules.filter(s => s.cond).length + targetRules.filter(t => t.selector).length;
  let confidence: AIProfileIR["confidence"] = "LOW";
  if (total > 0 && resolved === total && allRefsOk) confidence = "HIGH";
  else if (total > 0 && resolved / total >= 0.75) confidence = "MEDIUM";

  return { charId, charName, skillRules, targetRules, unresolvedConds, unresolvedRules, unconditionalRules, skillAnnotations, confidence };
}
