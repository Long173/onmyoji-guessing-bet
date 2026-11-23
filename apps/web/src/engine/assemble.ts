// engine/assemble.ts — 浏览器侧的「竞猜对局装配」
// ★ 与 battle-lab/soul/guessing-match.ts 共用 compile/character.ts 的同一份装配逻辑，
//   差异只有一处：数据不再从磁盘读，而是从预打包的 EngineBundle 注入。
// ★ 本文件保持 **零 Node API**，因此既能在 Worker 里跑，也能被 Node 测试直接 import 做同构校验。
import { Battle, DEFAULT_RULES } from "../../../../battle-lab/kernel/battle.ts";
import type { TraceLevel } from "../../../../battle-lab/kernel/battle.ts";
import { Team } from "../../../../battle-lab/kernel/team.ts";
import { ResourcePolicies } from "../../../../battle-lab/kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets, PassivePolicies, LifestealPolicies, ImmunePolicies } from "../../../../battle-lab/kernel/policies.ts";
import { buildCharacter, selectSkillByAI, applyIrCapabilities } from "../../../../battle-lab/compile/character.ts";
import type { LoadedChar } from "../../../../battle-lab/compile/character.ts";
import { compileBuff, toStatusDef } from "../../../../battle-lab/compile/buff-compiler.ts";
import { makeGuessingEntity, verifyGuessingPanel } from "../../../../battle-lab/soul/guessing-factory.ts";
import { bettingPolicies } from "../../../../battle-lab/compile/betting-policies.ts";
import { bettingAiRuleOf } from "../../../../battle-lab/compile/betting-coverage.ts";
import type { GuessingBuildResult } from "../../../../battle-lab/soul/guessing-factory.ts";
import { compileSoulBook } from "../../../../battle-lab/soul/effects.ts";
import { installSubscribers } from "../../../../battle-lab/compile/subscribers.ts";
import type { SubscriberKit } from "../../../../battle-lab/compile/subscribers.ts";
import { loadTips, setTipsTable } from "../../../../battle-lab/compile/tips.ts";
import { loadBuffNames, setBuffNames } from "../../../../battle-lab/compile/buff-names.ts";
/** ★★★ 第 174 轮：先机子句的**动词名**从编译器引入 —— 与 compile/passive-runtime.ts 同一条规矩（只有一份声明） */
import { APPEND_CAST_VERB } from "../../../../battle-lab/compile/skill-compiler.ts";
import type { SoulDef } from "../../../../battle-lab/soul/loadout.ts";
import type { GuessingMatch } from "../contracts/guessing-match.ts";
import { STAT_KEYS as UI_STAT_KEYS } from "../contracts/guessing-match.ts";
import { displayName } from "../kb/names.ts";

/** 预打包的知识库切片（由 tools/build-engine-bundle.mjs 生成） */
export interface EngineBundle {
  schemaVersion: 1;
  engineVersion: string;
  gameDataVersion: string;
  builtAt: string;
  shiki: any[];
  ai: any[];
  buffs: any[];
  souls: SoulDef[];
  onmyojiAI: { profiles: any[] };
  /** ★ 第 71 轮：data/kb/tips.json 的 {id,name}；[tips_N] 的解析依据 */
  tips?: { id: string; name: string }[];
}

/** UI 八维 -> 引擎 DisplayStats。契约里百分比已是百分数，与引擎展示口径一致，无需换算。 */
const UI_TO_ENGINE: Record<string, string> = {
  attack: "atk", hp: "hp", defense: "def", speed: "spd",
  critRate: "cri", critDamage: "crid", effectHit: "efh", effectResist: "efr",
};
export function toEngineDisplay(stats: any): Record<string, number> {
  const out: any = {};
  for (const k of UI_STAT_KEYS) out[UI_TO_ENGINE[k]] = Number(stats[k] ?? 0);
  return out;
}

export interface EngineKit {
  bundle: EngineBundle;
  /** 每只式神的技能/AI 只编译一次，避免 10,000 局重复编译 */
  charCache: Map<number, LoadedChar>;
  soulDefs: Map<number, SoulDef>;
  soulBook: ReturnType<typeof compileSoulBook>;
  buffs: Map<string, any>;
  shikiById: Map<number, any>;
  aiById: Map<number, any>;
  omyById: Map<number, any>;
  charMeta: Map<number, { name: string; type?: string }>;
  /** 编译期问题（技能 LOW / 缺 AI），与对局无关，整个会话复用 */
  compileIssues: string[];
  /** ★ 占位符表（编译一次，全对局复用）。缺了它分类器会把 "40% [tips_2]" 看成无条件。 */
  tipsMap: Map<string, { id: string; name: string; desc: string }>;
  /**
   * ★★★ 第 186 轮：**状态名字表**（名字 → id 列表）—— 名字形态的状态引用（正文写「雄姿英发」而不是 [buff_x]）要用它。
   *   与 tipsMap 同一条纪律：**入口显式设置**，编译器只读单例；不设置就是空表（名字形态不解析，fail-closed）。
   */
  buffNamesMap: Map<string, string[]>;
  /** ★★★ 第 190 轮：按 defId 取状态定义（跨进程续跑的兜底；见 createKit 里的注） */
  statusDefOf: (defId: string) => any | null;
}

let buffFailures = 0;
export function createKit(bundle: EngineBundle): EngineKit {
  const buffs = new Map<string, any>();
  for (const b of bundle.buffs) {
    try { buffs.set(String(b.id), compileBuff(b)); } catch { buffFailures++; }
  }
  const soulDefs = new Map<number, SoulDef>(bundle.souls.map(s => [Number(s.id), s]));
  const shikiById = new Map<number, any>(bundle.shiki.map(s => [Number(s.id), s]));
  const aiById = new Map<number, any>(bundle.ai.map(a => [Number(a.id), a]));
  const omyById = new Map<number, any>((bundle.onmyojiAI?.profiles ?? []).map(p => [Number(p.id), p]));
  const charMeta = new Map<number, { name: string; type?: string }>();
  for (const s of bundle.shiki) {
    const g = String(s.gradeRaw ?? s.grade ?? s.rarity ?? "");
    charMeta.set(Number(s.id), { name: s.name, type: (g === "阴阳师" || g === "英杰") ? "ONMYOJI" : "SHIKIGAMI" });
  }
  const kit: EngineKit = {
    bundle, charCache: new Map(), soulDefs, soulBook: compileSoulBook(bundle.souls), buffs,
    shikiById, aiById, omyById, charMeta, compileIssues: [],
    // ★ 第 101 轮：编译期解析"形态类放置单位"要读 tips 表 ⇒ 装配时**显式设置**（唯一入口，不靠兜底）
    tipsMap: (() => { const m = loadTips((bundle as any).tips ?? []); setTipsTable(m); return m; })(),
    // ★★★ 第 186 轮：**状态名字表**同样在这里显式设置（浏览器侧从预打包的 bundle 取，与 node 侧读的是同一份数据）
    buffNamesMap: (() => { const m = loadBuffNames(bundle.buffs ?? []); setBuffNames(m); return m; })(),
    /**
     * ★★★ 第 190 轮：**状态定义的兜底来源**（跨进程续跑必需）。
     *
     * 由来：kernel/state.ts 的 restoreBattle 按 defId 从 StatusBook 取状态定义，
     *   而 StatusBook 是**模块级单例**、此前只在技能执行到某个状态时**顺手注册**（compile/character.ts）。
     *   同一个进程里跑过前 20 回合再恢复 ⇒ 表是热的、恢复无损；
     *   换一个进程恢复（真正的「杀掉 Engine → 重新加载」）⇒ 表是冷的，
     *   状态被静默丢掉、只留一条 restore:missing-statusdef 的痕 —— 实测指纹当场漂移
     *   （2d7c7507e18db61f → a85410dcc35735ea，tools/state-cli.ts）。
     *   这里把「知识库在场 ⇒ 状态定义可取」这条不变量交给 kit 自己承担（唯一入口，与 tips / 名字表同一条纪律）。
     */
    statusDefOf: (defId: string) => { const cb = buffs.get(String(defId)); return cb ? toStatusDef(cb) : null; },
  };
  // 预热：把本局可能用到的技能/AI 编译结果缓存起来（首次装配时填充）
  return kit;
}

/** 取（并缓存）某只式神的已编译技能表。teamId/entId 只影响被丢弃的 Entity 外壳，不影响技能对象。 */
function skillsFor(kit: EngineKit, id: number): LoadedChar | null {
  const hit = kit.charCache.get(id);
  if (hit) return hit;
  const s = kit.shikiById.get(id);
  if (!s) return null;
  const lc = buildCharacter(s, kit.aiById.get(id), kit.omyById.get(id), kit.buffs, 0, 0);
  kit.charCache.set(id, lc);
  for (const i of lc.issues) kit.compileIssues.push(`${s.name}: ${i}`);
  return lc;
}

/**
 * ★ G0：按 shikigamiId 取（并缓存）运行时技能表，供 **状态恢复** 重建运行时。
 * 存在的意义：restoreBattle 需要"从身份重建运行时"的能力，而这份能力必须与装配路径
 * 完全同源（同一份 buildCharacter / 同一个缓存），否则恢复出来的行为会与线上悄悄漂移。
 */
export function runtimeFor(kit: EngineKit, shikigamiId: number): { skills: any[] } | null {
  const lc = skillsFor(kit, shikigamiId);
  if (!lc) return null;
  return { skills: lc.entity.skills };
}

/** 编译期画像：技能数 / AI 置信度，供覆盖度统计与 UI 展示（带缓存，不重复编译） */
export interface UnconditionalRule { label: string; cost: number; isBasic: boolean }
/** Fidelity 的 Skill 层需要"这个技能解析出了什么、还漏了什么" */
export interface SkillFidelity {
  name: string; confidence: "HIGH" | "MEDIUM" | "LOW";
  /** KB skill id (e.g. "593_04") — joins the betting coverage registry and the English skill names */
  skillId: string;
  /** 鬼火消耗：<0 = 被动技能（引擎没有触发条件模型，属已知边界） */
  cost: number;
  parsed: { damage: number; heal: number; shield: number; timeline: number; status: number; orb: number };
  unparsedSentences: number;
  /** 原文明确写了「有N%概率…」并被成功归因到效果上的槽位数（掷骰施加） */
  probAttributed: number;
  /** 原文写了概率但归因有歧义、只能退回"必定施加"的处数 —— 这是**已知的过度施加**，必须显示出来 */
  probAmbiguous: number;
  /** 原文写明并被成功归因的「持续N回合」槽位数（真的按这个回合数结算） */
  durationStated: number;
  /** 原文写了「持续N回合」但归因有歧义的处数（只能退回印记描述或 1 回合） */
  durationAmbiguous: number;
  /**
   * ★ 这个技能依赖哪些**引擎没有建模**的机制（召唤 / 复活 / 反击 / 免疫…）。
   * 以前 Fidelity 只能说「N 句机制未建模」，说不清是哪个机制 ——
   * 有了它就能逐条列出"依赖什么"与"引擎缺什么"。来源见 battle-lab/compile/unmodeled.ts。
   */
  unmodeled: Array<{ verb: string; missing: string; severity?: "WARN" | "INFO" }>;
  /**
   * ★★★ 第 112 轮：**"引擎明确跳过"的记录**（放置单位的 formSkips、偷取的 stealSkips）。
   *   它们此前**到不了 Fidelity**：引擎诚实记下了"这条没做"，而每局报告看不见 ——
   *   于是含千姬/绘世花鸟卷的阵容在 SKILL 层显示「完整编译（无可执行缺口）」。
   */
  skips: Array<{ reason: string; evidence: string; kind: "PLACEMENT" | "STEAL" }>;
}
/**
 * ★★★ 第 174 轮：**「先机 → 施放『X』」这条子句的报表放行** —— 判据是引擎自己的产物，且 fail-closed。
 *
 * 由来：第 164–172 轮把这条子句接通了（被动运行时装 BATTLE_START 钩子 → kernel/sub-cast.ts 走伪回合），
 *   可编译器的**句子分类**仍写着 MECHANIC_UNPARSED —— 因为编译器只看得见自己这一个技能，
 *   看不见「『X』到底有没有场地」。于是**报表比代码悲观**：御馔津「狐狩界」在卡面上一直是
 *   ◐ 部分编译，而它唯一没解析的那句正是已经跑通的先机（tests/g96-senki-field.ts 第 [3] 节）。
 *
 * 放行判据（四条都要满足，任一条不满足 ⇒ 照旧记缺口）：
 *   ① 未建模记录里**有且只有一条** [tips_7] + 施放 的追加施放子句（两条同形就不猜哪一条）；
 *   ② 子句里的引用（`[skill_NNN_NN]` 或『名字』）能在**同一个角色的技能表**里解析到；
 *   ③ 被引用的那条技能**真的带 field**（幻境 / 结界）—— 这正是运行时装钩子的前提；
 *   ④ 该子句**确实对应一句** MECHANIC_UNPARSED（调用方核对，见 charInfo）。
 *   ★ 「狐狩界」引用的是它自己（自指也解析得到，与运行时按 e.skills 查找的口径一致）。
 *
 * ★ 它只动**报表**（未解析句数、依赖机制列表），**不动 IR**：编译器说"我没解析这句"是事实，
 *   运行时说"这句有执行点"也是事实，两个事实都留在产物里 —— 这也是为什么放行放在装配层而不是编译器：
 *   编译器拿不到兄弟技能（compileSkill(charId, charName, sk) 没有第三个入参），
 *   而为它加一个"有时传有时不传"的入参，正是本仓库反复警告的**两条路径漂移**。
 * ★ 反向钉子见 tests/g97-senki-release.ts（引用解析不到 / 没 field / 两条同形 / 非先机，一律不放行）。
 */
export function senkiReleaseOf(ir: any, byId: Map<string, any>): string | null {
  const hits = ((ir?.unmodeledMechanics ?? []) as any[]).filter((m: any) =>
    m?.verb === APPEND_CAST_VERB && /\[tips_7\]/.test(String(m.clause ?? "")) && /施放/.test(String(m.clause ?? "")));
  if (hits.length !== 1) return null;
  const clause = String(hits[0].clause);
  const idM = /\[skill_(\d+_\d+)\]/.exec(clause);
  const nameM = /施放『([^』]+)』/.exec(clause);
  const target = idM ? byId.get(idM[1])
    : nameM ? [...byId.values()].find((x: any) => String(x?.name ?? "") === nameM[1])
    : undefined;
  if (!target?.field) return null;
  return clause;
}

export function charInfo(kit: EngineKit, id: number): {
  skills: number; aiConfidence: "HIGH" | "MEDIUM" | "LOW" | "NONE"; issues: string[];
  unconditional: UnconditionalRule[]; annotations: string[];
  skillDetails: SkillFidelity[]; aiUnresolvedConds: number;
} {
  const lc = skillsFor(kit, id);
  if (!lc) return { skills: 0, aiConfidence: "NONE", issues: ["not in the knowledge base"], unconditional: [], annotations: [], skillDetails: [], aiUnresolvedConds: 0 };
  /** ★★★ 第 174 轮：先机放行要按**同角色的技能表**解析引用（判据见 senkiReleaseOf） */
  const irById = new Map<string, any>(lc.ir.map((y: any) => [String(y.id), y]));
  const skillDetails: SkillFidelity[] = lc.ir.map((x: any) => {
    /**
     * ★★★ 第 174 轮：先机子句的放行。**两侧对得上才真放行**：
     *   左边 = 判据说这条子句有执行点（senkiReleaseOf）；右边 = 它**确实**少掉正好一句未解析。
     *   任一侧对不上就按原样报 —— 这样"放行"永远不会多放一句、也不会把无关的缺口带走。
     */
    const candidate = senkiReleaseOf(x, irById);
    const unparsedAll = (x.sentences ?? []).filter((s: any) => s.kind === "MECHANIC_UNPARSED");
    const unparsedKept = candidate ? unparsedAll.filter((s: any) => !String(s.text ?? "").includes(candidate)) : unparsedAll;
    const released: string | null = candidate && unparsedKept.length === unparsedAll.length - 1 ? candidate : null;
    const unmodeledAll = ((x.unmodeledMechanics ?? []) as any[]);
    const unmodeledKept = released ? unmodeledAll.filter((m: any) => String(m.clause ?? "") !== released) : unmodeledAll;
    return {
      name: x.name, skillId: String(x.id), confidence: x.confidence, cost: x.cost,
      parsed: {
        damage: x.damage.length, heal: x.heal.length, shield: x.shield.length,
        timeline: x.timeline.length, status: x.statusRefs.length, orb: x.orb.gain > 0 ? 1 : 0,
      },
      unparsedSentences: unparsedKept.length,
      probAttributed: (x.effectProbs ?? []).length,
      probAmbiguous: (x.effectProbSkips ?? []).length,
      durationStated: (x.statusDurations ?? []).length,
      durationAmbiguous: (x.durationSkips ?? []).length,
      unmodeled: unmodeledKept.map((m: any) => ({ verb: m.verb, missing: m.missing, ...(m.severity ? { severity: m.severity } : {}) })),
      skips: [
        ...((x.formSkips ?? []) as any[]).map((s: any) => ({ reason: String(s.reason), evidence: String(s.evidence ?? ""), kind: "PLACEMENT" as const })),
        ...((x.stealSkips ?? []) as any[]).map((s: any) => ({ reason: String(s.reason), evidence: String(s.evidence ?? ""), kind: "STEAL" as const })),
      ],
    };
  });
  // 「没有写明触发条件」的规则：引擎按每回合都满足处理（仍受鬼火约束），但这多半不是官方行为
  const unconditional: UnconditionalRule[] = (lc.ai.unconditionalRules ?? []).map((label: string) => {
    const idx = lc.ai.skillRules.find(r => label.startsWith(r.skill.raw || "\u0000"))?.skill.index;
    const sk = idx == null ? null : lc.entity.skills[idx];
    return { label, cost: sk?.cost ?? -1, isBasic: !!sk && sk.cost === 0 && (sk.ir?.damage?.length ?? 0) > 0 };
  });
  return {
    skills: lc.ir.length, aiConfidence: (lc.ai.confidence ?? "LOW") as any, issues: lc.issues,
    /** ★ 第 114 轮：AI 规则里**条件解析不出**的条数（此前这些规则被当成「条件成立」放行） */
    aiUnresolvedConds: (lc.ai.unresolvedConds ?? []).length,
    unconditional, annotations: lc.ai.skillAnnotations ?? [], skillDetails,
  };
}

export interface AssembledMatch {
  battle: Battle;
  red: GuessingBuildResult[];
  blue: GuessingBuildResult[];
  issues: string[];
  /** 显示层同速：截图精度可能翻转出手顺序，必须显式暴露 */
  displayTies: Array<{ spd: number; members: string[] }>;
  /**
   * 御魂 4 件套效果的安装报告（装了几件 / 几件 UNSUPPORTED / 各触发了几次）。
   * 它此前被**直接丢弃**：报告里只能写"已加载"，写不出"其中 2 件永远不会触发"。
   * 本局没有御魂战斗效果时为 null —— 注意 null 不等于"御魂没问题"，它只说明没装进任何东西。
   */
  soulReport: import("../../../../battle-lab/soul/effect-system.ts").InstallReport | null;
}

/**
 * 竞猜口径装配。**绝不应用御魂静态属性**（面板即权威输入）。
 * 御魂图标 = 该 4 件套生效，因此把单个 soulId 复制 4 份 —— 这是猜测口径下唯一可自洽的读法，
 * 且已在 UI 中明确告知用户（图标无法区分 2 件套与 4 件套时，按 4 件套处理）。
 */
/**
 * ★ G0：把**运行时回调**接到战斗上。这类东西（技能选择器、AI 谓词）是函数，
 * 永远不该进 BattleState —— 它们必须能从知识库重新生成。
 * 装配与"从存档恢复"必须调用**同一个** attachRuntime，否则恢复出来的战斗会静默降级
 * （实测过一次：漏接 skillSelector，全场退化成普攻，事件数从 125 掉到 63）。
 */
/**
 * ★ G3：装配次数计数器。存在的唯一目的是**证明**"回放不是第二次执行引擎"（a1-4 §36）：
 * 从 Replay 文件播放时这个数字必须一动不动。
 */
export let assembleCount = 0;

export function attachRuntime(battle: any, kit?: SubscriberKit | null): void {
  battle.skillSelector = (b: any, a: any, e: any) => selectSkillByAI(b, a, e);
  /**
   * ★★★ 第 131/132/133 轮：**订阅（御魂 / 被动 / 替友方拦死）由 compile/subscribers.ts 统一安装**。
   *
   * 三次同类事故推着它走到这里：
   *   · 第 131 轮：替友方拦死只装在装配路径上 ⇒ 恢复后条款静默失效；
   *   · 第 132 轮：御魂与被动同样只在装配路径上 ⇒ "存档前在跑、续跑后消失"；
   *   · 第 133 轮：Node 侧参考装配（CLI / 基线）**既没有御魂也没有替友方拦死** —— 又是"两条路径装的不一样"。
   * ⇒ 现在只有**一处实现**（battle-lab/compile/subscribers.ts），装配与恢复、网页与 Node 都调它；
   *   顺序（御魂 → 被动 → 替友方拦死）也在那里定 —— 默认 priority 是 REGISTRATION_ORDER，
   *   同优先级事件的先后由注册顺序决定，所以顺序是行为的一部分。
   */
  const rep = installSubscribers(battle, kit);
  (battle as any).soulReport = rep.soul;
  (battle as any).passiveReport = rep.passive;
  (battle as any).allyGuardReport = rep.allyGuard;
}

export interface AssembleOverrides {
  /** 红区 B：开局结算顺序（HYPOTHESIS 之间可切换，用于策略敏感性） */
  startup?: string;
  /** 红区 C：击杀成立时点 */
  death?: string;
  /** 红区 A：同时触发的优先级 */
  priority?: string;
  /** 同速时的出手决定方式 */
  tieBreak?: string;
}

/**
 * ★ 第 34 轮修：`traceLevel` / `recorder` 以前只有 runOne 在**装配之后**补设，
 * 直接调用 assembleMatch 的调用方（多个测试）传了也没人接 —— 而 Node 只剥类型不做检查，
 * 所以"我以为在跑 NONE 档"实际跑的是 SUMMARY：观测没关掉，性能与语义都不对。
 * 现在它和其它装配选项一样，由构造参数一路传到底。
 */
export function assembleMatch(kit: EngineKit, match: GuessingMatch, opts: { seed: number; maxTurns?: number; passives?: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY"; traceLevel?: TraceLevel; recorder?: { onFrame(battle: any, frame: number): void } } & AssembleOverrides = { seed: 1 }): AssembledMatch {
  assembleCount++;
  const issues: string[] = [];
  const results: Record<string, GuessingBuildResult[]> = { red: [], blue: [] };
  const teams: Record<string, Team> = {};

  for (const side of ["red", "blue"] as const) {
    const teamId = side === "red" ? 0 : 1;
    const team = new Team(teamId, side.toUpperCase(), ResourcePolicies.COMMUNITY_4_8_5_345, 1);
    let entId = (teamId + 1) * 100;
    for (const u of match[side].units) {
      const id = ++entId;
      const slot = match[side].units.indexOf(u) + 1;
      if (!u.shikigamiId) { issues.push(`${side === "red" ? "Red" : "Blue"} slot ${slot}: no Shikigami selected`); continue; }
      const lc = skillsFor(kit, u.shikigamiId);
      const built = makeGuessingEntity(id, teamId, {
        shikigamiId: u.shikigamiId,
        observed: toEngineDisplay(u.stats),
        soulIds: u.soulId == null ? [] : [u.soulId, u.soulId, u.soulId, u.soulId],
      }, { soulDefs: kit.soulDefs, charMeta: kit.charMeta });

      // ★ G0：把知识库身份写进实体，状态序列化后才能重建运行时
      built.entity.shikigamiId = u.shikigamiId;
      // 图标 = 该 4 件套生效：实体侧也记 4 份，和 makeGuessingEntity 的口径保持一致
      // （只记 1 份会让任何按"满 4 件"判断的路径静默失效）
      built.entity.soulIds = u.soulId == null ? [] : [u.soulId, u.soulId, u.soulId, u.soulId];
      if (lc) {
        built.entity.skills = lc.entity.skills.map((sk: any) => ({ ...sk }));   // 每局独占技能对象，避免跨局串状态
        /**
         * ★★★ 第 130 轮：**能力位也要跟着技能一起搬过来**。
         *   竞猜口径的单位是 makeGuessingEntity 造的（不是 buildCharacter 的实体），
         *   只拷 skills 的话，「无法被治疗」这类**只写在技能原文里**的能力位会静默丢掉
         *   （探针 tools/_probe-noheal130.ts 实测：装配后又变回 receivesHeal=true）。
         *   共用助手在 battle-lab/compile/character.ts —— 一处实现，两条装配路径都调它。
         */
        applyIrCapabilities(built.entity, lc.ir);
        built.entity.notes.push(`kb-skills=${lc.ir.length} ai=${lc.ai.confidence}`);
        if (!lc.ir.length) issues.push(`${displayName(u.name)}: no skill data`);
        // Betting mode: a hand-written betting rule decides this unit's skills, so the KB AI's confidence is moot.
        if (lc.ai.confidence === "LOW" && !bettingAiRuleOf(u.shikigamiId)) issues.push(`${displayName(u.name)}: AI confidence LOW`);
      } else {
        issues.push(`${displayName(u.name)} (id=${u.shikigamiId}) is not in the knowledge base; it will only use its basic attack (${side} slot ${slot})`);
      }
      const v = verifyGuessingPanel(built);
      if (!v.ok) issues.push(`${displayName(u.name)}: stat echo mismatch: ${v.detail.join("; ")}`);

      team.add(built.entity);
      results[side].push(built);
    }
    teams[side] = team;
  }

  const battle = new Battle([teams.red, teams.blue], {
    seed: opts.seed,
    rules: { ...DEFAULT_RULES, maxTurns: opts.maxTurns ?? 300 },
    policies: {
      resource: ResourcePolicies.COMMUNITY_4_8_5_345,
      startup: StartupPolicies[opts.startup ?? "NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI"],
      death: DeathPolicies[opts.death ?? "DEATH_AFTER_PREVENTION"],
      priority: opts.priority ?? "REGISTRATION_ORDER",
      tieBreak: opts.tieBreak ?? "SPEED_THEN_RANDOM",
      guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED,
      // ★ 第 70 轮：被动技能执行与否（红区 E）。默认 NOT_EXECUTED ⇒ 与历史结果逐位一致。
      passives: PassivePolicies[opts.passives ?? "NOT_EXECUTED"],
      // ★★ 第 93/94 轮：两条新红区也要进产物快照 ——
      //   否则「用哪种口径算出来的」在网页侧看不出来（引擎默认值在 kernel/policies.ts）。
      lifesteal: LifestealPolicies.APPLIED_AS_HEAL,
      immune: ImmunePolicies.DEBUFF_COVERS_CONTROL,
      // MAX (betting) mode only — the worker sets MAX: effect resist contest + anti-stall endgame ({} in BASE).
      ...bettingPolicies(),
    },
    traceLevel: opts.traceLevel,
  });
  if (opts.recorder) (battle as any).recorder = opts.recorder;
  /**
   * ★★★ 第 132 轮：**御魂 / 被动 / 替友方拦死三种订阅都只在这里装**（attachRuntime 内部）。
   *
   * 这里是装配路径；恢复路径由 restoreBattle 调**同一个** attachRuntime（并把 kit 传进去）。
   * 订阅是函数、不进 BattleState，两边必须装同一套 —— 否则续跑会静默降级。
   * ★ 原先这三段（御魂 + 被动）写在这里，于是**恢复路径根本没有装**；搬进去之后只装一份，
   *   也不会出现"同 id 装两遍"（bus.register 不去重）。
   * ★ 安装报告仍然挂在 battle 上（soulReport / passiveReport / allyGuardReport），
   *   供 Fidelity / Theater / 测试读取 —— 搬家的只是**调用点**，不是账。
   */
  attachRuntime(battle, kit);

  const bySpd = new Map<number, string[]>();
  for (const side of ["red", "blue"] as const) for (const u of match[side].units) {
    if (!u.shikigamiId) continue;
    const spd = u.stats.speed;
    if (!bySpd.has(spd)) bySpd.set(spd, []);
    bySpd.get(spd)!.push(`${side === "red" ? "Red" : "Blue"}·${displayName(u.name)}`);
  }
  const displayTies = [...bySpd.entries()].filter(([, v]) => v.length > 1).map(([spd, v]) => ({ spd, members: v }));

  /** ★ 第 132 轮：安装报告一律从 battle 上读（装它们的地方已经搬到 attachRuntime 里） */
  return { battle, red: results.red, blue: results.blue, issues, displayTies, soulReport: (battle as any).soulReport ?? null };
}

/** 单局：装配 + 跑完，并把 trace 打上回合戳（回放器需要） */
export async function runOne(kit: EngineKit, match: GuessingMatch, seed: number, opts: { maxTurns?: number; annotate?: boolean; traceLevel?: "NONE" | "SUMMARY" | "FULL"; recorder?: any } & AssembleOverrides = {}) {
  // ★ G4：观测粒度由调用方决定（10k 局用 NONE/SUMMARY，Theater 用 FULL + 记录器）
  const a = assembleMatch(kit, match, { seed, maxTurns: opts.maxTurns, startup: opts.startup, death: opts.death, priority: opts.priority, tieBreak: opts.tieBreak, traceLevel: opts.traceLevel, recorder: opts.recorder });
  if (opts.annotate !== false) {
    const tr: any[] = a.battle.trace;
    const orig = tr.push.bind(tr);
    (tr as any).push = (...items: any[]) => { for (const it of items) { if (it && typeof it === "object" && it.turn === undefined) it.turn = a.battle.turn; } return orig(...items); };
  }
  const r = await a.battle.run();
  return { ...a, result: r };
}

export function buffCompileFailures() { return buffFailures; }

/**
 * 每一局的 seed 由 (基准 seed, 局序号) **雪崩散列**得到，而不是简单的 seedBase + i。
 *
 * 起因是一个真实的担忧：mulberry32 对相邻种子的雪崩较弱，若相邻几局共享同一段
 * 开局随机序列，Wilson 区间就会**偏窄**（假装比实际更确定）。
 *
 * 实测结论（典型对局 #001，40 区块 × 250 局 = 10,000 局，区块胜率卡方检验）：
 *   顺序 seed：区块 SD 3.34% vs 二项理论 2.96%（比值 1.13），chi² = 49.7，df = 39
 *   散列 seed：区块 SD 3.26% vs 二项理论 2.96%（比值 1.10），chi² = 47.3，df = 39
 * 两者都落在独立同分布的 95% 区间内（≈ 39 ± 17.4）——
 * **即：没有检出顺序 seed 的相关性**。散列只是留有余量的防御性选择，不是修复某个已证实的缺陷。
 * 早期用 10 个区块估 SD 时看到的"波动异常"是 SD 估计本身的噪声（10 个区块时 SD 的
 * 相对不确定度约 24%），不足以支撑任何结论。
 */
export function mixSeed(seedBase: number, i: number): number {
  let h = (seedBase ^ 0x9E3779B9) >>> 0;
  h = Math.imul(h ^ ((i + 0x85EBCA6B) >>> 0), 0xCC9E2D51) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2545F491) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 2147483647) || 1;
}
