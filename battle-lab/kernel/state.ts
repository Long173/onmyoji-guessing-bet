// kernel/state.ts — ★ G0：BattleState 收口（a1-4.md §3、§55）
//
// 现状（G0 体检报告 fixtures/g0-state-audit.json）：
//   JSON.stringify(battle) 不报错，但**静默丢掉** 96 个函数、11 个 Set、2 个 Map，
//   并且 Entity/Team/OrbPool/RNG/Timeline/EventBus 这些类实例的**原型方法全部丢失**。
//   换句话说：现在根本没有"战斗状态"这个东西，Battle 对象本身就是状态，而且和运行时混在一起。
//
// 本文件确立边界：
//   BattleState  = 纯数据（可 JSON 往返，零函数零 Map/Set 零类实例）
//   Runtime      = 由 KnowledgeKit 按 shikigamiId **重建**的东西（技能 execute、AI 谓词、御魂 handler）
//   restoreBattle(state, { kit }) = 用 kit 重建运行时 + 覆盖纯数据
//
// 目标（文档 §55）：暂停 → 保存 state → 杀掉 Engine → 重新加载 → 继续完全相同地战斗。
import { Battle, DEFAULT_RULES } from "./battle.ts";
import type { BattleRules } from "./battle.ts";
import { Team } from "./team.ts";
import { Entity, EntityType } from "./entity.ts";
import type { EntityCapabilities } from "./entity.ts";
import { OrbPool, ResourcePolicies } from "./resource.ts";
import { Timeline, TieBreaks } from "./timeline.ts";
import { RNG } from "./rng.ts";
import { PriorityPolicies } from "./events.ts";
import {
  StartupPolicies, DeathPolicies, GuessingRulesets, defaultPolicies,
  PassivePolicies, LifestealPolicies, ImmunePolicies, ResistPolicies, StealPolicyConfigs, EndgamePolicies,
} from "./policies.ts";
import { StatusBook } from "./status.ts";
// ★★★ 第 194 轮：池子状态（RANDOM_*）不在 KB 里，恢复时按 id 重建壳（见 poolDefFromId 的注）
import { poolDefFromId } from "./random-pool.ts";
// ★★★ 第 238 轮：合成计数器状态（GHOST_EYE）也要能按 id 重建壳
import { counterDefFromId } from "./status.ts";
import { installSummonHooks } from "./summon.ts";
import type { BattlePolicies } from "./policies.ts";
import { envSnapshot, envRestore } from "./environment.ts";
import { fieldSnapshot, fieldRestore } from "./field.ts";
import type { FieldState } from "./field.ts";
import type { EnvironmentState } from "./environment.ts";

// ────────────────────────────── 状态形状（全部是纯数据） ──────────────────────────────
export interface EntityState {
  id: number; name: string; teamId: number;
  shikigamiId: number | null; soulIds: number[];
  type: string; caps: Record<string, boolean>;
  base: Record<string, number>;
  effects: Array<{ prop: string; value: number; mode: string; source: string }>;
  hp: number; maxHp: number; alive: boolean;
  hpZero: boolean; dead: boolean; killed: boolean; killCredit: number | null;
  transformed: boolean; reviveBlocked: boolean; undeathUsed: boolean;
  statuses: Array<{ defId: string; sourceId: number; stacks: number; remaining: number; tag: string; effects: Array<{ prop: string; value: number; mode: string; tag?: string }> }>;
  shields: any[];
  usedSkills: string[];
  notes: string[];
  onmyoji: any;
  /** ★ 状态标签发号器：决定 st1/st2… 的 tag，而 tag 是 effects 精确回收的依据 */
  statusSeq: number;
}

export interface TeamState {
  id: number; name: string; summonSlots: number;
  members: EntityState[]; summons: EntityState[];
  orbs: { orb: number; willpower: number; righteousFire: number; gauge: number; cycle: number; pendingReward: number; policyId: string };
}

export interface TimelineState {
  entries: Array<{ id: number; pos: number; locked: boolean }>;
  tieBreakId: string;
}

export interface BattleState {
  schemaVersion: 1;
  battleId: string;
  seed: number;
  turn: number;
  phase: string;
  winner: 0 | 1 | null;
  endReason: string;
  startupDone: boolean;
  ended: boolean;
  rules: BattleRules;
  policyIds: {
    startup: string; priority: string; tieBreak: string; death: string; resource: string; guessing: string;
    /**
     * ★★★ 第 132 轮：**后加的红区策略也要入档**（可选：只在**偏离默认值**时写）。
     *   不写的话，恢复出来的战斗会把这些策略**静默换回默认** —— 第 132 轮的续跑测试实测到过：
     *   装配时开着的被动运行时（PARSED_CANDIDATES_ONLY）在恢复后变成默认的 NOT_EXECUTED，
     *   于是"存档前被动在跑、续跑后一个都不跑"，回合数 57 → 55。
     *   ★ 只在偏离默认值时写：默认档下不加键 ⇒ 既有指纹（典型对局）逐位不变，与第 109 轮环境键同一条规矩。
     */
    passives?: string; lifesteal?: string; immune?: string; resist?: string; steal?: string; endgame?: string;
  };
  teams: [TeamState, TeamState];
  timeline: TimelineState;
  /** ★ 第 66 轮补 `pending`：expect() 已声明但还没抽的那次用途（不补就会在恢复后丢标签） */
  rng: { seed: number; s: number; n: number; pending?: string | null };
  /** 事件总线的注册表（handler 自身由运行时重建，这里只记"注册过什么"用于一致性校验） */
  busHandlers: Array<{ id: string; ownerId: number; code: string; priority: number; passive: boolean }>;
  unknownBuffRefs: string[];
  /**
   * 观测与序号计数：续跑时帧号/事件号必须接着往下编，否则回放对不上。
   * ★ 第 35 轮补：victoryChecks 也属于这一类 —— 它出现在 VICTORY_CHECK 的留痕里，
   * 不入档的话"续跑战斗"的这条留痕会从 0 开始数，于是 g0 的"逐条一致"立刻失败。
   * 教训与 §15 同型：**新加的运行状态必须同时想清楚它怎么进档**。
   */
  counts: { turnLog: number; trace: number; eventSeq: number; victoryChecks: number; resolutionDepth: number };
  /**
   * ★★★ 第 109 轮：全局 Environment（a1-4 §34）。**只有非默认才写出来** ——
   *   空环境（无档位、无全局修改器）时这个键根本不出现，于是既有的默认对局指纹逐位不变
   *   （与第 94/95 轮「无条件新增字段会让全部产物变成『变化』」是同一条纪律）。
   *   ★ `elapsedBattleTime` 是派生量（= battle.turn），**不进档**：它是回合的函数，
   *     进档只会让指纹随无关变化漂移；恢复时由 restoreBattle 重算（见 kernel/environment.ts）。
   */
  environment?: EnvironmentState | null;
  /**
   * ★★★ 第 115 轮：场地（幻境 / 结界）。**空的不进档** —— 默认对局连这个键都没有，
   *   所以指纹只在场上真有场地时才变。
   */
  fields?: FieldState[] | null;
}

// ────────────────────────────── 捕获 ──────────────────────────────
/** 默认策略（捕获时用来判断"这个策略偏离默认了吗" —— 偏离才入档，见 policyIds 的字段注） */
const DEFAULTS = defaultPolicies();
/**
 * ★★★ 第 130 轮：**caps 里"取默认值"的那些键不写进档**。
 *
 * 起因是一条真实事故：EntityCapabilities 新增 receivesHeal（「无法被治疗或恢复生命」）之后，
 *   所有既有指纹**当场全漂**（典型对局 2d7c7507e18db61f → ce96db6b33befe1f），25 个测试文件各红一条 ——
 *   而它们的**行为一个字节都没动**（新键在每个单位上都是 true）。
 *   这与第 67 轮给 SkillIR 加 revive 时是同一类：**形状变化冒充行为变化**，把真正要看的那几条淹没。
 *
 * 判据：只省略**声明为默认值**的那一个键（receivesHeal === true）；其它键一律照旧写出 ——
 *   不做通用的"省略默认值"清洗，那会把既有指纹也一起改掉（与第 109 轮环境键同一条注：
 *   默认档下不加新键，否则所有既有指纹都会漂一个常量）。
 * ★ 存档侧因此仍然正确：真的为 false 的单位**会**写出 false，恢复时 Object.assign 照常覆盖它。
 */
function capsForState(x: { caps: EntityCapabilities | Record<string, boolean> }): Record<string, boolean> {
  const c = { ...x.caps } as Record<string, boolean>;
  if (c.receivesHeal === true) delete c.receivesHeal;
  return c;
}
function entityState(e: Entity): EntityState {
  return {
    id: e.id, name: e.name, teamId: e.teamId,
    shikigamiId: e.shikigamiId, soulIds: (e.soulIds ?? []).slice(),
    type: e.type as string, caps: capsForState(e),
    base: { ...e.base },
    effects: e.effects.map(x => ({ prop: x.prop, value: x.value, mode: x.mode, source: x.source })),
    hp: e.hp, maxHp: e.maxHp, alive: e.alive,
    hpZero: e.hpZero, dead: e.dead, killed: e.killed, killCredit: e.killCredit,
    transformed: e.transformed, reviveBlocked: e.reviveBlocked, undeathUsed: e.undeathUsed,
    statuses: e.statuses.map(s => ({
      defId: s.def.id, sourceId: s.sourceId, stacks: s.stacks, remaining: s.remaining, tag: s.tag,
      effects: (s.effects ?? []).map((x: any) => ({ prop: x.prop, value: x.value, mode: x.mode, tag: x.tag })),
    })),
    shields: e.shields.map((s: any) => ({ ...s })),
    usedSkills: [...e.usedSkills],
    notes: e.notes.slice(),
    onmyoji: e.onmyoji ? JSON.parse(JSON.stringify(e.onmyoji)) : null,
    statusSeq: (e as any).statusSeq ?? 0,
  };
}

export function captureState(battle: Battle): BattleState {
  const busHandlers = (battle.bus as any).handlers instanceof Map
    ? [...(battle.bus as any).handlers.values()].flat()
    : ((battle.bus as any).handlers ?? []);
  return {
    schemaVersion: 1,
    battleId: battle.id,
    seed: battle.rng.seed,
    turn: battle.turn,
    phase: battle.phase as string,
    winner: battle.winner,
    endReason: battle.endReason,
    startupDone: battle.startupDone,
    ended: battle.ended,
    rules: { ...battle.rules },
    policyIds: {
      startup: battle.policies.startup.id, priority: battle.policies.priority, tieBreak: battle.policies.tieBreak,
      death: battle.policies.death.id, resource: battle.policies.resource.id, guessing: battle.policies.guessing.id,
      // ★ 第 132 轮：五个后加的红区策略，**偏离默认值才写**（见 policyIds 的字段注）
      ...(battle.policies.passives.id !== DEFAULTS.passives.id ? { passives: battle.policies.passives.id } : {}),
      ...(battle.policies.lifesteal.id !== DEFAULTS.lifesteal.id ? { lifesteal: battle.policies.lifesteal.id } : {}),
      ...(battle.policies.immune.id !== DEFAULTS.immune.id ? { immune: battle.policies.immune.id } : {}),
      ...(battle.policies.resist.id !== DEFAULTS.resist.id ? { resist: battle.policies.resist.id } : {}),
      ...(battle.policies.steal.id !== DEFAULTS.steal.id ? { steal: battle.policies.steal.id } : {}),
      ...(battle.policies.endgame && battle.policies.endgame.id !== DEFAULTS.endgame.id ? { endgame: battle.policies.endgame.id } : {}),
    },
    teams: battle.teams.map(t => ({
      id: t.id, name: t.name, summonSlots: t.summonSlots,
      members: t.members.map(entityState),
      summons: t.summons.map(entityState),
      orbs: {
        orb: t.orbs.orb, willpower: t.orbs.willpower, righteousFire: t.orbs.righteousFire,
        gauge: t.orbs.gauge, cycle: t.orbs.cycle, pendingReward: t.orbs.pendingReward,
        policyId: t.orbs.policy.id,
      },
    })) as [TeamState, TeamState],
    timeline: {
      entries: battle.timeline.all().map(e => ({ id: e.id, pos: e.pos, locked: e.locked })),
      tieBreakId: battle.policies.tieBreak,
    },
    rng: battle.rng.snapshot(false) as any,
    busHandlers: busHandlers.map((h: any) => ({ id: h.id, ownerId: h.ownerId, code: h.code, priority: h.priority, passive: !!h.passive })),
    unknownBuffRefs: battle.unknownBuffRefs.slice(),
    counts: {
      turnLog: battle.turnLog.length, trace: battle.trace.length, eventSeq: battle.bus.seqSnapshot(),
      victoryChecks: battle.victoryChecks, resolutionDepth: battle.resolutionStack.length,
    },
    // ★ 第 109 轮：环境**非默认才进档**（默认档下连键都没有 ⇒ 指纹不变）
    ...(envSnapshot(battle.environment) ? { environment: envSnapshot(battle.environment) } : {}),
    // ★ 第 115 轮：场地非空才进档
    ...(fieldSnapshot(battle) ? { fields: fieldSnapshot(battle) } : {}),
  };
}

/**
 * 核心状态 = **决定未来的那部分**（实体/行动条/随机数/回合/胜负/策略）。
 * 观测日志（trace / turnLog）不属于核心：它是"已经发生了什么"的记录，
 * 续跑的战斗天然从空日志开始，把它算进指纹只会掩盖真正的一致性问题。
 */
export function coreState(state: BattleState) {
  return {
    turn: state.turn, winner: state.winner, endReason: state.endReason,
    policyIds: state.policyIds, rules: state.rules,
    teams: state.teams.map(t => ({
      orbs: t.orbs,
      members: t.members.map(m => ({
        id: m.id, shikigamiId: m.shikigamiId, hp: m.hp, maxHp: m.maxHp, alive: m.alive,
        hpZero: m.hpZero, dead: m.dead, killed: m.killed, killCredit: m.killCredit,
        transformed: m.transformed, reviveBlocked: m.reviveBlocked, undeathUsed: m.undeathUsed,
        base: m.base, effects: m.effects, statuses: m.statuses, shields: m.shields,
        usedSkills: [...m.usedSkills].sort(),
        // ★ 第 130 轮：核心指纹这一路同样走 capsForState（两处序列化必须一致，否则"存档一致"会被破坏）
        caps: capsForState(m),
      })),
      summons: t.summons.map(s => ({ id: s.id, hp: s.hp, alive: s.alive })),
    })),
    timeline: state.timeline.entries.map(e => ({ id: e.id, pos: Math.round(e.pos * 1e6) / 1e6, locked: e.locked })),
    rng: { s: state.rng.s, n: state.rng.n },
    // ★ 第 109 轮：环境是**决定未来**的状态（档位乘区会改后面的每一次伤害）⇒ 进核心指纹；
    //   但默认档下**不加这个键**（否则所有既有指纹都会漂一个常量）。
    ...(state.environment ? { environment: state.environment } : {}),
    // ★ 第 115 轮：场地进核心指纹 —— 它决定「友方是否处于幻境/结界」这类条件，是决定未来的状态
    ...(state.fields ? { fields: state.fields } : {}),
  };
}

/** 核心状态指纹：用于"续跑结果与连续跑必须逐位一致"的断言（a1-4 §26 State Hash） */
export function stateHash(state: BattleState): string {
  const s = JSON.stringify(coreState(state));
  let h1 = 0x811c9dc5, h2 = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"));
}

// ────────────────────────────── 重建 ──────────────────────────────
export interface RestoreDeps {
  /** 知识库：由它按 shikigamiId 重建技能与 AI 运行时 */
  kit: {
    soulDefs: Map<number, any>;
    buffs: Map<string, any>;
    charMeta: Map<number, { name: string; type?: string }>;
    /** ★ 第 132 轮：重装御魂订阅要用（soulIds → 战斗效果），以及被动的 [tips_N] 表 */
    soulBook?: Map<number, any>;
    tipsMap?: Map<string, any>;
    /** ★★★ 第 190 轮：按 defId 现编译状态定义（跨进程续跑的兜底 —— 见 entityFromState 里的注） */
    statusDefOf?: (defId: string) => any | null;
  };
  /** 与 assemble 相同的运行时工厂（避免这里重写一遍技能装配） */
  makeRuntime: (shikigamiId: number, teamId: number, entId: number) => { skills: any[] } | null;
  /**
   * ★ 运行时接线（技能选择器等函数回调）。**必须**由调用方提供：
   * 这些是函数，不能进状态；漏接会让"恢复后的战斗"静默退化成另一套行为。
   * 传 undefined 时恢复出来的战斗只能普攻 —— 因此这里不给默认值，逼调用方显式决定。
   */
  /** ★ 第 132 轮：第二个参数是知识库 —— attachRuntime 还要用它重装御魂 / 被动订阅 */
  attachRuntime?: (battle: Battle, kit?: any) => void;
}

function entityFromState(st: EntityState, deps: RestoreDeps): Entity {
  const e = new Entity(st.id, st.name, st.teamId, st.base, st.shikigamiId);
  e.type = st.type as EntityType;
  e.soulIds = st.soulIds.slice();
  const rt = st.shikigamiId != null ? deps.makeRuntime(st.shikigamiId, st.teamId, st.id) : null;
  // 每局独占技能对象：运行时是按单位实例化的，不能让两个单位共享同一批对象
  e.skills = rt ? rt.skills.map((sk: any) => ({ ...sk })) : [];

  Object.assign(e.caps, st.caps);
  e.effects = st.effects.map(x => ({ prop: x.prop, value: x.value, mode: x.mode as any, source: x.source }));
  e.maxHp = st.maxHp; e.hp = st.hp; e.alive = st.alive;
  e.hpZero = st.hpZero; e.dead = st.dead; e.killed = st.killed; e.killCredit = st.killCredit;
  e.transformed = st.transformed; e.reviveBlocked = st.reviveBlocked; e.undeathUsed = st.undeathUsed;
  e.shields = st.shields.map((s: any) => ({ ...s }));
  e.usedSkills = new Set(st.usedSkills);
  (e as any).statusSeq = st.statusSeq ?? 0;
  e.notes = st.notes.slice();
  // ★ 运行时重建不了就必须留痕（注意顺序：必须在 notes 赋值**之后**压入，否则会被整体覆盖）
  if (!rt) e.notes.push("restore:NO_RUNTIME" + (st.shikigamiId == null ? "(no shikigamiId)" : "(unknown id " + st.shikigamiId + ")"));
  e.onmyoji = st.onmyoji ?? null;
  // 状态**直接按快照还原**，不走 addStatus：
  //   addStatus 会把 effects 重新注册进 e.effects，而 e.effects 已经从快照整体恢复过，
  //   再注册一次就是重复计算（同样的加成叠两遍）。
  // 状态定义取自 StatusBook（数据驱动、由知识库确定性生成）；取不到就如实记名，不静默丢。
  /**
   * ★★★ 第 190 轮：**跨进程续跑**（a1-4 §55 的字面要求）暴露的缺口 ——
   *   StatusBook 是**模块级单例**，此前只在技能执行到某个状态时顺手注册（compile/character.ts），
   *   于是"同一进程内暂停→重建"无损（表是热的），而"换进程恢复"会**静默丢状态**
   *   （实测 2d7c7507e18db61f → a85410dcc35735ea，只留一条 restore:missing-statusdef 的痕）。
   *   兜底顺序：StatusBook（可能已在别处注册过）→ kit.statusDefOf（知识库按 defId 现编译）→ 如实记名。
   *   ★ 兜底成功时**顺手写回 StatusBook**：同一条定义只编译一次，后续恢复与其他读取方共享同一份。
   */
  for (const s of st.statuses) {
    let def = StatusBook.get(s.defId);
    if (!def) {
      const fallback = (deps.kit as any)?.statusDefOf?.(s.defId) ?? poolDefFromId(s.defId) ?? counterDefFromId(s.defId);
      if (fallback) { StatusBook.set(s.defId, fallback); def = fallback; }
    }
    if (!def) { e.notes.push("restore:missing-statusdef:" + s.defId); continue; }
    e.statuses.push({
      def, sourceId: s.sourceId, stacks: s.stacks, remaining: s.remaining, tag: s.tag,
      effects: s.effects.map(x => ({ ...x })),
    } as any);
  }
  return e;
}

/**
 * 用纯状态 + 知识库重建一场可以继续跑的战斗。
 * 注意：运行时（技能对象、AI 谓词、御魂 handler）全部由 kit 重新生成，
 * 因此要求「同样的 shikigamiId + 同样的知识库版本」——这正是 Replay 文件的存续前提。
 */
export function restoreBattle(state: BattleState, deps: RestoreDeps): Battle {
  const teams = state.teams.map(ts => {
    const policy = (ResourcePolicies as any)[ts.orbs.policyId] ?? ResourcePolicies.COMMUNITY_4_8_5_345;
    const t = new Team(ts.id, ts.name, policy, ts.summonSlots);
    for (const m of ts.members) t.members.push(entityFromState(m, deps));
    for (const s of ts.summons) t.summons.push(entityFromState(s, deps));
    t.orbs.orb = ts.orbs.orb; t.orbs.willpower = ts.orbs.willpower; t.orbs.righteousFire = ts.orbs.righteousFire;
    t.orbs.gauge = ts.orbs.gauge; t.orbs.cycle = ts.orbs.cycle; t.orbs.pendingReward = ts.orbs.pendingReward;
    return t;
  }) as [Team, Team];

  const battle = new Battle(teams, {
    seed: state.seed,
    rules: state.rules,
    id: state.battleId,
    // ★ 六个红区策略必须**逐个按 id 还原**：只传 priority/tieBreak 会让其余回落到
    //   defaultPolicies() 的 UNDETERMINED，死亡结算与鬼火规则会当场换一套，续跑立刻失真。
    policies: {
      startup: (StartupPolicies as any)[state.policyIds.startup] ?? StartupPolicies.UNDETERMINED,
      death: (DeathPolicies as any)[state.policyIds.death] ?? DeathPolicies.UNDETERMINED,
      resource: (ResourcePolicies as any)[state.policyIds.resource] ?? ResourcePolicies.UNKNOWN_ZERO,
      guessing: (GuessingRulesets as any)[state.policyIds.guessing] ?? GuessingRulesets.COMMUNITY_2020_UNVERIFIED,
      priority: state.policyIds.priority,
      tieBreak: state.policyIds.tieBreak,
      /**
       * ★★★ 第 132 轮：**五个后加的红区策略按 id 还原**（档里没有就是没偏离默认 ⇒ 用默认）。
       *   漏掉它们的后果实测过：被动运行时在续跑里被静默关掉（回合数 57 → 55）。
       */
      passives: state.policyIds.passives ? ((PassivePolicies as any)[state.policyIds.passives] ?? DEFAULTS.passives) : DEFAULTS.passives,
      lifesteal: state.policyIds.lifesteal ? ((LifestealPolicies as any)[state.policyIds.lifesteal] ?? DEFAULTS.lifesteal) : DEFAULTS.lifesteal,
      immune: state.policyIds.immune ? ((ImmunePolicies as any)[state.policyIds.immune] ?? DEFAULTS.immune) : DEFAULTS.immune,
      resist: state.policyIds.resist ? ((ResistPolicies as any)[state.policyIds.resist] ?? DEFAULTS.resist) : DEFAULTS.resist,
      steal: state.policyIds.steal ? ((StealPolicyConfigs as any)[state.policyIds.steal] ?? DEFAULTS.steal) : DEFAULTS.steal,
      endgame: state.policyIds.endgame ? ((EndgamePolicies as any)[state.policyIds.endgame] ?? DEFAULTS.endgame) : DEFAULTS.endgame,
    } as Partial<BattlePolicies>,
  });
  battle.turn = state.turn;
  battle.frameBase = state.counts.trace;   // 帧号接着存档点往下编，续跑帧与连续跑帧一致
  battle.bus.seqRestore(state.counts.eventSeq ?? 0);   // 事件号同理
  battle.phase = state.phase as any;
  battle.winner = state.winner;
  battle.endReason = state.endReason;
  battle.victoryChecks = state.counts.victoryChecks ?? 0;
  /**
   * ★ ResolutionScope 栈是**瞬时**状态，不入档（它只在一次 resolution 之内非空）。
   *   存盘点必须在边界之间 —— 若在结算中途存盘，恢复出来的战斗会在错误的层级上重开边界
   *   （内层 HIT 会被当成最外层，于是"多段技能每段都判胜负"）。宁可在这里明确报错，
   *   也不要静默丢栈：静默丢栈的症状会表现为"续跑后胜负判定时机不同"，极难追。
   */
  if (state.counts.resolutionDepth) {
    throw new Error("存盘点落在 resolution 之内（depth=" + state.counts.resolutionDepth + "）：必须在 ResolutionBoundary 之间捕获状态");
  }
  battle.startupDone = state.startupDone;
  battle.ended = state.ended;
  battle.unknownBuffRefs = state.unknownBuffRefs.slice();
  /**
   * ★ 第 109 轮：环境恢复。`elapsedBattleTime` 是派生量（= turn），**在这里重算**而不是从档里读 ——
   *   所以就算存档里写了它，也不会成为第二份真相（一处事实，一处实现）。
   */
  battle.environment = envRestore(state.environment);
  battle.environment.elapsedBattleTime = battle.turn;
  /**
   * ★★★ 第 113 轮：**恢复后重装召唤物钩子**。
   *   教训：第一版把它写在 teams.map(...) 的闭包里 —— 那一刻 `battle` 还在初始化，直接抛
   *   「Cannot access 'battle' before initialization」。钩子必须在**实体与队伍都就位之后**装。
   */
  for (const tm of battle.teams) for (const sm of tm.summons) installSummonHooks(battle, sm);
  /** ★ 第 115 轮：场地状态恢复（光环本身是 Modifier，已经在实体 effects 里 ⇒ **不要重复施加**） */
  fieldRestore(battle, state.fields);
  battle.rng.restore(state.rng as any);
  battle.timeline.rng = battle.rng;
  battle.timeline.tieBreak = (TieBreaks[state.timeline.tieBreakId] ?? TieBreaks.UNRESOLVED).fn;
  // 行动条：速度是实时的（速度 buff 会改变到达时间），因此只恢复位置与锁定，速度仍由实体实时计算
  for (const en of state.timeline.entries) {
    const e = battle.entity(en.id);
    if (!e) continue;
    battle.timeline.add(en.id, () => e.speed, en.pos);
    battle.timeline.setLock(en.id, en.locked);
  }
  /**
   * 运行时回调（技能选择器等）由调用方重新接上；不接就是另一套行为，绝不含糊过去。
   * ★★★ 第 132 轮：**把 kit 一起传下去** —— attachRuntime 现在还要重装三种订阅
   *   （御魂 / 被动 / 替友方拦死）。它们都是函数、不进 BattleState：
   *   只接技能选择器而漏掉订阅，就是"存档前御魂在跑、续跑后御魂消失"这种静默降级。
   */
  deps.attachRuntime?.(battle, deps.kit);
  // ★ 恢复缺口清单：哪些单位的运行时没能重建（召唤物目前就在这一类里）。
  //   暴露出来是为了让调用方/测试能看见，而不是靠"跑起来没报错"当作没事。
  (battle as any).restoreGaps = battle.allEntities()
    .filter((e: any) => e.notes.some((n: string) => n.startsWith("restore:NO_RUNTIME")))
    .map((e: any) => ({ id: e.id, name: e.name, shikigamiId: e.shikigamiId, note: e.notes.find((n: string) => n.startsWith("restore:NO_RUNTIME")) }));
  return battle;
}

export { DEFAULT_RULES };
export { PriorityPolicies };
