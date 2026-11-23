// kernel/battle.ts — M0 空战场主循环
import { EV, Phase, TurnType, TurnFlags, StatusCategory } from "./types.ts";
import { RNG } from "./rng.ts";
import { EventBus, PriorityPolicies } from "./events.ts";
import { Timeline, TieBreaks, GOAL } from "./timeline.ts";
import { Entity, EntityType } from "./entity.ts";
import { GameMath } from "./gamemath.ts";
import { Team } from "./team.ts";
import { dealDamage, healTarget, loseHp } from "./damage.ts";
import { defaultPolicies, policySnapshot, hasUnknownPolicy } from "./policies.ts";
import type { BattlePolicies } from "./policies.ts";
import { validateGuessingLineups } from "./validate.ts";
import { isActionPrevented, canCastSkill, locksTimeline, hasSuppression, StatusBook } from "./status.ts";
import type { SummonSpec } from "./summon.ts";
// ★ 第 131 轮：替友方拦截致命伤（DEATH_PREVENTION 的第一个生产者）+ 两份计数的维护
import { clearAllyGuardWindow, resetAllyGuardCounts } from "./ally-guard.ts";
import { returnForm, formOwnerOf, sealedVictimOf, sealEntity, placeOnKill, skillPlacements, clearLinkAura, removeSummon, clearPresenceAuras, installSummonHooks, enterForm } from "./summon.ts";
import { restoreStats, stolenBy } from "./steal.ts";
import { createEnvironment, envTick, envAdvanceTurn, envRefereeAfterTurn, timeoutVerdict } from "./environment.ts";
import { expireFields, fieldTurnStart, fieldTurnEnd } from "./field.ts";
import { takeExtraTurn, clearExtraTurns, pendingExtraTurns } from "./extra-turn.ts";
import type { EnvironmentState } from "./environment.ts";
import type { StatusDef, ImmuneKind } from "./status.ts";
import type { ResolutionScope } from "./resolution.ts";

/**
 * ★ G2/G4：Trace Level 三档（a1-4 §35）。
 *   NONE    —— 不记任何事件：Monte Carlo 跑十万局时用，最快
 *   SUMMARY —— **只记「统计」需要的那几类**（damage / death / skill usage / first kill · §35 原文）
 *   FULL    —— 全部事件 + 逐帧快照记录器：CLI 回放、Battle Theater 拖进度条用
 * 三档必须产出**相同的战斗结果**，只是观测粒度不同 —— 这一点由测试锁死。
 *
 * ★★★ 第 192 轮：**SUMMARY 此前与 FULL 无法区分**（差别只在调用方挂不挂 recorder）——
 *   也就是说「三档」实际上是「两档半」，而 §35 写得很清楚：SUMMARY 是**统计档**，只收
 *   damage / death / skill usage / first kill。这一轮把它做实（见 SUMMARY_KINDS）。
 *   ★ 同时把**默认档从 SUMMARY 改成 FULL**：62 个测试文件在默认档下读详细事件流，
 *     它们要的本来就是「看得见」（此前是**碰巧**拿到，因为 SUMMARY == FULL）；
 *     默认档取「观测完整」这一侧才符合本仓库「不许静默少算」的一贯口径，
 *     批量路径（Monte Carlo）改为**显式**声明 NONE —— 那本来就是 §35 给它的档。
 */
export type TraceLevel = "NONE" | "SUMMARY" | "FULL";

/**
 * ★★★ 第 192 轮：**SUMMARY 档收哪几类**（a1-4 §35 原文：damage / death / skill usage / first kill）。
 *   · DAMAGE      —— damage
 *   · KILLED / DEATH —— death（first kill 由第一条 KILLED 派生，不另立事件）
 *   · SKILL_CAST  —— skill usage
 * ★ 就这四类。SUMMARY 的用途是**统计**：算得出谁打了多少、谁死了、放了什么技能、首杀在第几帧 ——
 *   而 Theater 要的逐帧细节（状态施加 / 行动条 / 护盾 / 鬼火 …）一律不进这一档。
 */
export const SUMMARY_KINDS: ReadonlySet<string> = new Set(["DAMAGE", "KILLED", "DEATH", "SKILL_CAST"]);

export interface BattleRules {
  damageFloat: number;   // 伤害浮动比例（红区：99%~101% 未证实，默认 0.01）
  maxTurns: number;      // 硬上限，防膀胱局
  seedLabel: string;
  /** 红区 B07：伤害被护盾完全吸收时，是否仍触发「造成伤害时」类效果。
   *  默认 false = 按《回合结算过程3.0》"被护盾吸收的伤害不触发〈针女〉"。 */
  fullyAbsorbedTriggersOnHit: boolean;
}

export const DEFAULT_RULES: BattleRules = { damageFloat: 0.01, maxTurns: 2000, seedLabel: "unversioned", fullyAbsorbedTriggersOnHit: false };

export interface TurnRecord { turn: number; actorId: number; type: TurnType; skill?: string; targetId?: number; note?: string }

/**
 * 「这个技能是不是一次**攻击**」—— 用编译产物自己的话回答：技能 IR 里有没有伤害分量。
 *
 * ★ 为什么不看「目标是敌人」：单体减益/偷取类技能也打敌人，但它们不是"攻击"。
 *   而 `ir.damage` 是编译器从原文解析出来的、已经存在的事实（含多段伤害的每一段）。
 *   ★ 为什么不看"这次有没有掉血"：那是 AFTER_DAMAGE 的语义（被闪避就不算造成伤害），
 *   而「攻击时」要的正是"动作发生了" —— 两者的差别就是这个 family 存在的理由。
 */
export function isAttackSkill(skill: any): boolean {
  const d = skill?.ir?.damage;
  return Array.isArray(d) && d.length > 0;
}

export class Battle {
  id: string;
  teams: [Team, Team];
  bus = new EventBus();
  timeline = new Timeline();
  rng: RNG;
  rules: BattleRules;
  policies: BattlePolicies;
  phase: Phase = Phase.CREATE;
  /** 观测粒度（见 TraceLevel）：默认 **FULL** —— 观测默认完整，批量路径显式降档 */
  traceLevel: TraceLevel = "FULL";
  /** FULL 档下的逐帧快照记录器（由调用方注入，见 kernel/snapshot.ts） */
  recorder: { onFrame(battle: any, frame: number): void } | null = null;
  /** ★ G0：开局流水线是否已跑过（存档续跑时不能重跑，否则先机/御魂会二次结算） */
  startupDone = false;
  /** BATTLE_END 是否已派发过（避免续跑时重复派发） */
  ended = false;
  /**
   * ★★★ 第 109 轮：**全局 Environment**（a1-4 §34）。
   *   它不挂在任何式神身上（规格原话「不污染式神」）：残局的档位与全局修改器只活在这里，
   *   伤害/治疗在结算时读一眼乘区。默认档 = 空环境 ⇒ 乘区为 1 ⇒ 历史行为逐位不变。
   */
  environment: EnvironmentState = createEnvironment();
  /**
   * ★★★ 第 115 轮：**场地（幻境 / 结界）**。空数组 = 场上没有场地；
   *   序列化时**空的不进档**（默认对局连这个键都没有）。
   */
  fields: any[] = [];
  /**
   * ★ a1-4 §30/§31：ResolutionScope 栈。**最外层** scope 退出即 ResolutionBoundary。
   *   内层 scope（多段技能里的每一段）不触发边界 —— 这正是规格要的
   *   「必须允许当前 Atomic Resolution 完成」。
   */
  resolutionStack: ResolutionScope[] = [];
  /** 边界检查次数（观测用；不参与推进，故不进 stateHash） */
  victoryChecks = 0;
  /**
   * ★ G1/G3：trace 帧号的起点。续跑的战斗从存档点继续编号（frame 39, 40, …），
   * 而不是从 0 重来 —— 这样"续跑产生的帧"与"连续跑产生的帧"逐字节相同，
   * G3 的 Frame N 才能与整场回放对得上。
   */
  frameBase = 0;
  turn = 0;
  turnLog: TurnRecord[] = [];
  trace: any[] = [];
  phaseLog: string[] = [];
  winner: 0 | 1 | null = null;
  /** 本场第一个阵亡的单位 id（NONE 档没有 trace 时，仍要能算"红方先手击杀率"） */
  firstDeathId: number | null = null;
  endReason = "";
  startedAtTurn = 0;
  /** 可插拔的技能选择器（M1 由 AI 编译器提供） */
  skillSelector: ((battle: Battle, actor: Entity, enemies: Entity[]) => any) | null = null;
  /** 源数据缺失、被兜底成"未知印记"的 buff id（不得静默丢弃） */
  unknownBuffRefs: string[] = [];

  /**
   * ★ G5/§45：全局统计由**引擎**累计，而不是事后从 trace 里刨。
   * 这样 Monte Carlo 才能把观测关到 NONE（trace 一条不记）却仍然拿得到逐单位贡献。
   */
  stats = {
    damageDealt: new Map<number, number>(),
    damageTaken: new Map<number, number>(),
    healing: new Map<number, number>(),
    kills: new Map<number, number>(),
    deaths: new Map<number, number>(),
    actions: new Map<number, number>(),
    skillUsage: new Map<number, Map<string, number>>(),
  };
  private bump(map: Map<number, number>, id: number, by: number) { map.set(id, (map.get(id) ?? 0) + by); }
  recordDamage(srcId: number, dstId: number, applied: number): void { this.bump(this.stats.damageDealt, srcId, applied); this.bump(this.stats.damageTaken, dstId, applied); }
  recordHeal(srcId: number, applied: number): void { this.bump(this.stats.healing, srcId, applied); }
  recordKill(killerId: number | null, victimId: number): void {
    this.bump(this.stats.deaths, victimId, 1);
    if (killerId !== null) this.bump(this.stats.kills, killerId, 1);
  }
  recordAction(actorId: number, skill: string): void {
    this.bump(this.stats.actions, actorId, 1);
    let m = this.stats.skillUsage.get(actorId);
    if (!m) { m = new Map(); this.stats.skillUsage.set(actorId, m); }
    m.set(skill, (m.get(skill) ?? 0) + 1);
  }

  constructor(teams: [Team, Team], opts: { seed: number; rules?: Partial<BattleRules>; policies?: Partial<BattlePolicies>; id?: string; traceLevel?: TraceLevel }) {
    this.id = opts.id ?? "battle";
    this.traceLevel = opts.traceLevel ?? "FULL";
    this.teams = teams;
    // ★ 第 122 轮：给所有单位装事件 sink（状态/护盾的生产点 → 事件队列）。召唤物在建成时再装一次。
    this.installEntitySinks();
    this.rules = { ...DEFAULT_RULES, ...(opts.rules ?? {}) };
    this.rng = new RNG(opts.seed);
    const p = { ...defaultPolicies(), ...(opts.policies ?? {}) };
    this.policies = p;
    this.bus.policy = PriorityPolicies[p.priority] ?? PriorityPolicies.UNDETERMINED;
    this.timeline.tieBreak = (TieBreaks[p.tieBreak] ?? TieBreaks.UNRESOLVED).fn;
    this.timeline.rng = this.rng;   // 并列到达时的随机必须走可复现 RNG
    // ★ a1-4 §31：让每个事件节点都知道自己在哪个 ResolutionScope 里
    this.bus.scopeProvider = () => this.resolutionStack[this.resolutionStack.length - 1] ?? null;
    /**
     * ★★★ 第 96 轮：**封印**的求值器 —— 由 Battle 读"这个单位身上有没有带封印标记的状态"。
     *
     * 为什么不是往 bus 的 Set 里写：那个 Set**不进 state**（它是运行时集合），
     * 于是"暂停→存档→重启→续跑"会把封印丢掉 —— 而 G0 的目标恰恰是"续跑完全相同"。
     * 走状态就没有这个问题：状态进 state、进指纹、可重放（tests/g57 第 [4] 节直接验这一点）。
     */
    /**
     * ★★★ 第 129 轮：**"这个拥有者还算在场吗"** —— 由 Battle 回答（它知道谁死了）。
     *
     * 为什么必须是求值器而不是"死亡时注销订阅"（第 129 轮改）：
     *   · 注销之后**复活带不回订阅** —— 探针实测：三尾狐「诱惑」阵亡前挨打回流 200 点，
     *     复活后再派发同一条 AFTER_DAMAGE，一条 trace 都没有；
     *   · 而且注销发生在 EV.DEATH 派发**之前**，于是「阵亡时」这一族**永远不可能触发**。
     * 判据只有一条：**已知且已阵亡**的单位返回 false。查不到（不是本局单位 / ownerId=0）⇒ 放行，
     * 否则实验脚手架与测试里那些"没有实体的拥有者"会被静默吞掉。
     */
    this.bus.ownerActive = (id: number) => { const e = this.entity(id); return e ? e.alive : true; };
    this.bus.suppressProvider = (id: number) => {
      const e = this.teams[0].members.find(m => m.id === id) ?? this.teams[1].members.find(m => m.id === id) ?? null;
      const defs = e?.statusDefs?.() ?? [];
      return { passive: hasSuppression(defs, "PASSIVE"), soul: hasSuppression(defs, "SOUL") };
    };
    // ★ 缚足 / 放逐 / 石化：把「能否被改变行动条」接到**状态**上。
    //   此前 Timeline.locked 这个标志生产代码一处都没调用过（只有 tests/m0 直接调），
    //   于是 StatusDef.locksTimeline 写了等于没写。
    this.timeline.lockPredicate = (id: number) => {
      const e = this.entity(id);
      return !!e && locksTimeline(e.statuses.map(s => s.def));
    };
    this.bus.resolver = { teamOf: (id: number) => this.teamOf(id), speedOf: (id: number) => this.entity(id)?.speed ?? 0 };
    // 递归溢出必须**当场留痕**（Theater 里要能看见"这里少算了一层"），不能等战斗结束再补记
    this.bus.onOverflow = (info) => { this.trace.push({ t: "EVENT_OVERFLOW", code: info.code, total: info.total, maxDepth: info.maxDepth }); };
    // ★ G1：所有 trace 自动盖章 —— frame（自己的序号）、ev（正在解析的事件）、depth（事件深度）。
    //   这样 Theater/Inspector 可以直接回答"这条伤害属于哪次技能、再往上是谁"，
    //   而不用去改散落各处的 trace.push 调用点。
    const rawPush = this.trace.push.bind(this.trace);
    (this.trace as any).push = (...items: any[]) => {
      if (this.traceLevel === "NONE") return this.trace.length;   // 只跑战斗，不留观测
      /**
       * ★★★ 第 192 轮：**SUMMARY 是统计档，不是「FULL 去掉快照」**（a1-4 §35 的原文：
       *   「统计：damage / death / skill usage / first kill」）。此前这一档原样收下全部事件，
       *   于是「三档」实际上只有两档半 —— 而十万局的批量跑要为此付出整条事件流的代价。
       * ★ 只按 **t**（事件标签）过滤：判据只有一份，与 FULL 的差别一眼可读。
       */
      if (this.traceLevel === "SUMMARY") items = items.filter((it) => it && typeof it === "object" && SUMMARY_KINDS.has(String(it.t)));
      if (!items.length) return this.trace.length;
      for (const it of items) {
        if (it && typeof it === "object") {
          if (it.frame === undefined) it.frame = this.frameBase + this.trace.length;
          if (it.ev === undefined) it.ev = this.bus.currentEvent;
          if (it.depth === undefined) it.depth = this.bus.depth;
        }
      }
      const r = rawPush(...items);
      // FULL 档：每帧通知记录器（Checkpoint + Delta）。默认关闭，否则 10k 局会被拖垮。
      for (const it of items) if (it && typeof it === "object" && it.frame !== undefined) this.snapshot(it.frame);
      return r;
    };
    for (const t of teams) t.orbs.policy = p.resource;
    // 违反已确证规则（如"对弈竞猜不含阴阳师"）直接拒绝，不静默跑
    if (p.guessing && p.guessing.hasOnmyoji === false) validateGuessingLineups(teams);
    this.phaseLog.push(`${Phase.CREATE} seed=${opts.seed} policies=${JSON.stringify(policySnapshot(p))}`);
    // ★ LOAD_RULESET：规则/策略装载完成。此前这个 Phase 枚举成员全库无人使用（field-census 查出）。
    this.phase = Phase.LOAD_RULESET;
    this.phaseLog.push(`${Phase.LOAD_RULESET} rules=${JSON.stringify(this.rules)} startOrder=${this.policies.startup.order.join(">")}`);
  }

  // ★ 单位注册表必须包含召唤物：否则未来的召唤物不能行动、不能被寻敌、也进不了状态恢复。
  //   （当前对局 summons 为空，因此这次收口不影响任何既有行为。）
  teamOf(id: number): number {
    for (const t of this.teams) if (t.members.some(m => m.id === id) || t.summons.some(s => s.id === id)) return t.id;
    return -1;
  }
  entity(id: number): Entity | undefined {
    for (const t of this.teams) {
      const e = t.members.find(m => m.id === id) ?? t.summons.find(s => s.id === id);
      if (e) return e;
    }
    return undefined;
  }
  allEntities(): Entity[] { return this.teams.flatMap(t => [...t.members, ...t.summons]); }

  /**
   * ★★★ 第 122 轮：把「状态 / 护盾生产点」接到事件队列上（Entity.eventSink → Battle.queueEvent）。
   *   幂等：重复安装只是覆盖同一个函数。
   */
  private installEntitySinks(): void {
    for (const e of this.allEntities()) {
      e.eventSink = (kind: string, payload: any) => {
        if (kind === "STATUS_ADD") {
          /**
           * ★★★ 第 131 轮：**状态被（重新）施加 ⇒ 替友方拦死的累计计数清零**
           *   （KB：伊邪那美「神赐之吻」——「被再次施加毁灭前至多累计触发3次」）。
           *   位置选在**状态生产点**（Entity.eventSink）而不是技能执行点：任何路径施加该状态都算
           *   "再次施加"，而这正是原文的措辞。
           */
          const stId = String(payload.status?.def?.id ?? "");
          if (stId && resetAllyGuardCounts(e, stId) > 0) {
            this.trace.push({ t: "ALLY_GUARD_RESET", target: e.id, status: stId, reason: "STATUS_REAPPLY" });
          }
          this.queueEvent(EV.STATUS_ADD,
            { battle: this, entity: e, status: payload.status?.def?.id, name: payload.status?.def?.name, merged: payload.merged, stacks: payload.status?.stacks, remaining: payload.status?.remaining },
            e.id, e.teamId);
        } else if (kind === "SHIELD_CREATE") {
          this.queueEvent(EV.SHIELD_CREATE,
            { battle: this, entity: e, shield: payload.shield?.id, value: payload.shield?.value, dispellable: payload.shield?.dispellable },
            e.id, e.teamId);
        }
      };
    }
  }
  /**
   * ★★★ 第 136 轮：**额外推进鬼火行动条**的唯一入口（「额外推进N格鬼火行动条」）。
   *
   * 与回合开始时那一次推进**同一套语义**（满格 ⇒ 归零 + cycle++ + 记 pendingReward），
   * 差别只在：这里是原文点名的"额外"推进，所以走 trace（Theater 要看得出"这一格是谁推的"）。
   * ★ 循环调用 advanceGauge 而不是一次加 N：格子可能**多次满格**（N=3、size=5 时会转一圈多），
   *   一次加 N 会漏掉中间的 cycle++。
   */
  advanceOrbGauge(teamId: number, cells: number, reason: string, actorId: number | null = null): number {
    const pool = this.teams[teamId]?.orbs;
    if (!pool || !(cells > 0) || pool.policy.gaugeSize <= 0) return 0;
    let filled = 0;
    for (let i = 0; i < cells; i++) {
      if (pool.advanceGauge()) { filled++; pool.pendingReward = pool.rewardForCycle(); }
    }
    this.trace.push({
      t: "ORB_GAUGE_ADVANCE_EXTRA", team: teamId, actor: actorId, cells, filled,
      gauge: pool.gauge, cycle: pool.cycle, pendingReward: pool.pendingReward, reason,
    });
    return filled;
  }
  aliveOf(teamId: number): Entity[] { return this.teams[teamId].aliveMembers(); }
  /**
   * 寻敌：优先返回**可被选中**的敌人。
   * 若敌方全员都不可选中（无敌/放逐/隐匿），退回存活列表 —— 这是红区假设：
   * 官方在"所有敌人都无法被选中"时到底怎么处理，没有可信来源，因此**不猜**，
   * 只保证不出现"没有目标导致行动阶段空转"这种人为死锁。
   */
  enemiesOf(teamId: number): Entity[] {
    const t = this.teams[1 - teamId];
    const targetable = t.targetableMembers();
    return targetable.length ? targetable : t.aliveMembers();
  }

  // ---------- 生命周期：顺序由 StartupPolicy 决定（红区 A） ----------
  async runStartup(): Promise<void> {
    /**
     * ★★★ 第 190 轮：**开局只能跑一次**（幂等 —— 此前没有这道闸门）。
     *
     * 由来：`run()` 内部会调 `runStartup()`，而**几乎所有人**（75 个测试文件、若干工具）写的是
     *   `await b.runStartup(); await b.run();` ⇒ 开局流水线**跑了两遍**：
     *   BATTLE_START 按单位再派发一轮（先机 / 御魂「战斗开始时」各再触发一次）、
     *   鬼火与行动条再初始化一次。默认档（被动 OFF、无御魂）下看不出来，
     *   一旦有先机（座敷童子「福运昌隆」+1 鬼火、聆海金鱼姬「凌波」4 层印记）就当场分叉 ——
     *   实测典型对局被动档：`runStartup()+run()` = 6d7fb675c3d14eaf，而 `run()` = 7bc24506bdcd349e。
     *
     * ★ 这个缺口是**跨进程续跑**（第 190 轮的 tests/g112）顺出来的：恢复出来的战斗
     *   `startupDone` 已经是 true，任何一次多余的 `runStartup()` 都会把开局重放一遍。
     * 判据：`startupDone` 已置位 ⇒ 直接返回（正确的幂等是**无痕**的，不留事件 —— 它不是失败）。
     * 反向由 tests/g16-startup-once.ts 的第 [5] 节钉住：再跑一次既不多派发、也不多加鬼火。
     */
    if (this.startupDone) return;
    /**
     * ★★★ 第 244 轮：规格 a1-4 §60 要求「从 **00:00 BATTLE_START** 开始播、到 BATTLE_END 结束」，
     *   而这两个码此前**只作为事件派发、从不进 trace** ⇒ 录像的首尾两帧对不上规格
     *   （实测：首帧是 ORB_INIT、末帧是 VICTORY_CHECK —— 见 apps/web/tests/ui19-spec-acceptance.ts）。
     *   ★ 位置必须在**开局流水线之前**（第一次改动把它放在了流水线末尾，于是首帧仍是 ORB_INIT）。
     *   判据：这一条 trace 只影响录像的首帧，**不动事件派发本身**（御魂/被动订阅的时机一个字没变）。
     */
    this.trace.push({ t: "BATTLE_START" });
    // ★ 整个开局收敛成**一棵**树：先机/被动/御魂/初始鬼火/行动条初始化都是它的子节点。
    //   以前 9 个阶段各自成根（10 个根节点）—— Inspector 里看到的是"一片森林"，
    //   Event Parent/Root 链在开局段等于没有（a1-4 §28 要求可见父子关系）。
    await this.bus.within("STARTUP", { battle: this }, 0, 0, id => this.teamOf(id), async () => {
      for (const stage of this.policies.startup.order) {
        // 每个开局阶段是一个事件节点，Theater 可以从 STARTUP 一路顺到第一个行动。
        await this.bus.within("STARTUP:" + stage, { stage }, 0, 0, id => this.teamOf(id), async () => {
          await this.runStartupStage(stage);
        });
      }
      // ★ BATTLE_START 必须**按单位**派发（selfId = 单位 id），否则 SELF 范围的订阅者
      //   （御魂「战斗开始时」效果都注册成 SELF）永远匹配不上 —— ownerId !== 0。
      //   此前它以 selfId=0 派发一次，于是火灵 / 蚌精 这类开局御魂一次都不会触发；
      //   而按阶段重复派发的旧缺陷又会让它们变成"每个阶段各触发一次"。两个错误互相掩盖。
      for (const e of this.allEntities()) {
        await this.bus.dispatch(EV.BATTLE_START, { battle: this, self: e }, e.id, e.teamId, id => this.teamOf(id));
      }
    });
    this.phase = Phase.BATTLE;
    this.startupDone = true;
    // ★ 第 109 轮：开局档的残局规则（表默认是空的 ⇒ 这一行什么都不做，也不留痕）
    envTick(this, "BATTLE_START");
  }

  private async runStartupStage(stage: string): Promise<void> {
    {
      this.phaseLog.push(`STARTUP:${stage}`);
      switch (stage) {
        case "SPAWN": this.phase = Phase.SPAWN; break;
        case "INIT_STATS": this.phase = Phase.INIT_STATS; break;
        case "SOUL_START":
          // ★ START_EFFECTS：先机/御魂/被动这一段的归属阶段（a1-4 Phase 列表里一直没被进入过）
          this.phase = Phase.START_EFFECTS;
          for (const e of this.allEntities()) {
            for (const s of e.skills) if (s.onSoulStart) s.onSoulStart(this, e);
            await this.bus.dispatch(EV.SOUL_START, { battle: this, self: e }, e.id, e.teamId, id => this.teamOf(id));
          }
          break;
        case "PASSIVE_START":
          this.phase = Phase.START_EFFECTS;
          for (const e of this.allEntities()) {
            for (const s of e.skills) if (s.onPassiveStart) s.onPassiveStart(this, e);
            await this.bus.dispatch(EV.PASSIVE_START, { battle: this, self: e }, e.id, e.teamId, id => this.teamOf(id));
          }
          break;
        case "SENKI":
          this.phase = Phase.SENKI;
          await this.bus.dispatch(EV.SENKI, { battle: this }, 0, 0, id => this.teamOf(id));
          break;
        // ★★★ 第 92 轮：这两个 case **是有意为空**，不是忘了 —— 理由写在 STAGE_NOOP_REASONS 里，
        //   并由 tests/g53 机械检查（"空阶段必须写明理由，没写理由的阶段不许为空"）。
        //   一个空的 case 读起来分不清"有意/忘了"，这一轮我自己就先读错了一次。
        case "SUMMON": break;   // 数据边界：KB 里没有召唤物数据（见 STAGE_NOOP_REASONS）
        case "FIELD": break;    // 开局本就无事可做：没有任何技能在战斗开始时创建结界/幻境（同上）
        case "ORB_INIT":
          // 初始鬼火由 ResourcePolicy 提供；此处仅记录
          this.trace.push({ t: "ORB_INIT", red: this.teams[0].orbs.snapshot(), blue: this.teams[1].orbs.snapshot() });
          break;
        case "TIMELINE_INIT":
          this.phase = Phase.TIMELINE_START;
          for (const e of this.allEntities()) this.timeline.add(e.id, () => e.speed);
          break;
      }
      // ★ 第 120 轮：开局阶段里同步上的状态 / 鬼火，在这里统一投递（见 drainEvents 的注释）
      await this.drainEvents();
    }
    // ★ 这里曾经还有一份 BATTLE_START 派发 + phase/startupDone 赋值，与 runStartup 的尾部完全重复，
    //   结果是**每个开局阶段都派发一次 BATTLE_START**（9 个阶段 + 结尾 1 次 = 10 次）。
    //   而 soul/effect-system.ts 把「战斗开始时」御魂挂在 BATTLE_START 上 —— 那些效果于是触发 10 次。
    //   开局钩子只应该有一次：删掉重复尾部，BATTLE_START 归 runStartup 唯一负责。
  }

  // ---------- 死亡状态机（红区 C） ----------
  async resolveLethal(target: Entity, killerId: number): Promise<void> {
    const pol = this.policies.death;
    /**
     * ★★★ 第 103 轮：**击杀式放置**要用到"目标倒下时它在行动条的哪个位置"**
     *   （tips_5911 龙胆蓝璃：「击败非召唤物敌方目标时，**在其行动条处**召唤」）。
     *   ★ 必须在 `this.timeline.remove()` **之前**取 —— 那一刻位置就没了。
     */
    const victimPos = this.timeline.get(target.id)?.pos ?? 0;
    const killer: Entity | null = killerId === null || killerId === undefined ? null : (this.allEntities().find(e => e.id === killerId) ?? null);
    this.trace.push({ t: "LETHAL", id: target.id, hp: target.hp, killer: killerId });
    await this.bus.dispatch(EV.LETHAL, { target, killerId, cancelled: false }, target.id, target.teamId, id => this.teamOf(id));

    if (pol.killedAt === "HP_ZERO") {
      target.killed = true; target.killCredit = killerId;
      await this.bus.dispatch(EV.KILLED, { target, killerId }, target.id, target.teamId, id => this.teamOf(id));
    }
    if (pol.preventionBeforeDeath) {
      // 免死 / 转化 拦截点（Dummy 可通过技能挂 handler）
      const hook: any = { target, killerId, prevented: false };
      await this.bus.dispatch(EV.DEATH_PREVENTION, hook, target.id, target.teamId, id => this.teamOf(id));
      if (hook.prevented) { this.trace.push({ t: "DEATH_PREVENTED", id: target.id }); return; }
      if (target.transformed) { this.trace.push({ t: "TRANSFORMED", id: target.id }); return; }
      /**
       * ★★★ 第 103 轮：**镇压式放置**（KB：须佐之男「神之领域」——
       *   「敌方式神受到来自须佐之男的致命伤害时，将会优先被镇压成[雷冢]」）。
       *   与"免死"的区别：目标不是被打不死，而是**被换掉**（离场、由雷冢顶替它的位置），
       *   而 tips_3896 写明了结局：「雷冢被击败后，被镇压的式神以 1 点生命复活」。
       *   「同一式神该效果只可生效 1 次」⇒ 用 killer.notes 里的标记封顶（notes 是存档字段）。
       */
      if (killer && target.type !== EntityType.SUMMON && !target.notes.some(n => n.startsWith("sealed:"))) {
        const sealForm = skillPlacements(killer).find(p => p.trigger === "ON_LETHAL" && p.placement === "ENEMY");
        /**
         * ★★ 「同一式神该效果只可生效1次」是**每个目标一次**，不是"一辈子只能压一个人"。
         *   第一版写成 ~B~!killer.notes.includes("seal-used:")~B~（前缀匹配 = 压过任何人都算用过）——
         *   于是须佐之男全场只能镇压一个敌人。按目标 id 判定才对；
         *   而且要不要封顶由**规格自己的 oncePerTarget** 说了算（tips 里写了才封顶）。
         */
        const usedOnTarget = killer.notes.includes("seal-used:" + target.id);
        const onceOnly = sealForm ? sealForm.spec.oncePerTarget !== false : true;
        if (sealForm && !(onceOnly && usedOnTarget)) {
          const r = sealEntity(this, killer, target, sealForm);
          if (r.ok) return;
        }
      }
      /**
       * ★★★ 第 130 轮：**自身的「受到致命伤害时，进入[tips_N]姿态」**。
       *
       * 数据早就在 IR 里：forms[].trigger === "ON_LETHAL"（第 101/103 轮解析），全库 2 处 ——
       *   · 须佐之男「神之领域」→ 雷冢（placement = ENEMY，**镇压别人**，第 103 轮已接线，就在上面那一段）；
       *   · 百羽凤凰火「未熄羽」→ 余烬（placement = SELF，**换掉自己**，**一直没有人执行**）。
       * 探针实测（tools/_probe-onlethal130.ts）：百羽凤凰火挨致命一击时 dead=true / transformed=false /
       * 场上没有召唤物，连一条 FORM_* 都没有 —— 解析得出来、执行点不存在（compile/character.ts 只执行
       * ON_CAST，遇到 ON_LETHAL 会记一条 FORM_SKIPPED / TRIGGER_NOT_CAST 然后跳过）。
       *
       * ★ 位置：**镇压之后**。判据来自原文自己的用词 —— 须佐之男那条写的是
       *   「敌方式神受到来自须佐之男的致命伤害时，将会**优先**被镇压成[雷冢]」，
       *   「优先」说明击杀方的镇压先于目标自己的转化。（这条读法是**假说**，记在报告里，不是实测。）
       * ★ 与"免死"同一档（pol.preventionBeforeDeath）：两者都是"先判定拦不拦得住，再决定算不算死"。
       * ★ 复用 enterForm —— 本体离场、形态上场、回归时机（TIMELINE_END 由回合入口那条钩子负责）
       *   都按第 101/102 轮那套走，不另造一条形态通道。
       */
      const selfForm = skillPlacements(target).find(p => p.trigger === "ON_LETHAL" && p.placement === "SELF");
      if (selfForm) {
        /** ★ victimPos 就是这一轮开始时记下的"目标倒下时它在行动条的位置"（tips_6071：继承行动条的位置） */
        const r = enterForm(this, target, selfForm, { hasSkills: false, pos: victimPos });
        if (r.ok) {
          this.trace.push({
            t: "LETHAL_FORM", id: target.id, killer: killerId, tipsId: selfForm.tipsId,
            name: selfForm.name, returnOn: selfForm.returnOn, summon: r.summon?.id ?? null,
            note: "受到致命伤害 ⇒ 本体离场、形态上场（本次死亡不结算）",
          });
          return;
        }
        /** 进不去形态**也要留痕**：否则「没做」与「做了但失败」在画面上一样（本仓库反复抓的那类静默） */
        this.trace.push({
          t: "FORM_SKIPPED", owner: target.id, tipsId: selfForm.tipsId, name: selfForm.name,
          reason: r.reason, place: "ON_LETHAL",
        });
      }
    }
    target.alive = false; target.dead = true;
    this.timeline.remove(target.id);
    /**
     * ★★★ 第 129 轮：**这里原本是 `this.bus.unregisterOwner(target.id)`** —— 删掉了，理由是两条实测：
     *   ① 复活之后订阅回不来（内核的 revive 只改状态、不重建处理器）：被复活的单位永久变成哑巴；
     *   ② 注销发生在下面 EV.DEATH 派发**之前**，所以「阵亡时」的处理器在死亡那一刻已经被摘掉 ——
     *      触发式复活的原文（九命猫「九命」/骨女「怨生」）根本没有机会执行。
     * "死了就不做事"这条语义没有丢，它现在由总线按存活状态挡（EventBus.ownerActive），
     * 并且对**死亡级联**的事件码豁免（倒下这件事本身要通知到他）。
     * ★ 撤下放置单位仍然走 unregisterOwner（kernel/summon.ts 的 removeSummon）—— 单位被移除是另一回事。
     */
    // （这里现在什么都不做：处理器留在订阅表里，"还算不算在场"由总线按存活状态裁决。）
    this.recordKill(killerId ?? null, target.id);   // §45：击杀/阵亡统计
    if (this.firstDeathId === null) this.firstDeathId = target.id;   // trace 关掉时也要能算"谁先死"
    this.trace.push({ t: "DEATH", id: target.id, killer: killerId });
    /**
     * ★★★ 第 99 轮：**阵亡时把偷来的属性还回去**（KB 原文：「阵亡时，将偷取的攻击全部归还」）。
     *   这是注册表 effects.ts 里 Restore 条（producer = restoreStats）的**生产调用点** ——
     *   没有它，归还会退化成"只有状态到期才还"，而"阵亡归还"是原文明确写的第三种结束方式。
     */
    {
      /**
       * ★ 归还的**内容**也要进事件链（不然 Theater 只能显示"还了 2 个"，看不出还的是什么）。
       *   stolenBy 是这一轮新增的观测入口 —— 它在这里有了**生产读取方**，
       *   而不是"只有测试在用"（接线审计会盯着这件事）。
       */
      /**
       * ★★★ 第 101 轮：**形态单位阵亡 ⇒ 本体回到场上**（蛇神 tips：「受到致命伤害时，本体重新回到场上」）。
       *   放在死亡留痕**之前**：本体先回来，再记形态的死亡 —— Theater 里看到的顺序与原文一致。
       */
      // ★ 第 104 轮：放置单位离场 ⇒ 撤掉「在场时」给拥有者的光环（tips_5911）
      clearLinkAura(this, target);
      /** ★ 第 111 轮：在场光环同理 —— 它随**召唤物的存在**而生效，单位一离场就必须整批回收 */
      {
        // ★ 只认「summon:<数字>」那条（notes 里还有 summon:stats-UNDECLARED:atk 之类的记账，见 removeSummon 的注）
        const sumTip = String((target.notes ?? []).find((x: string) => /^summon:[0-9]+$/.test(x)) ?? "summon:").slice("summon:".length);
        clearPresenceAuras(this, target, sumTip, "SUMMON_DEATH");
      }
      const sealedVictim = sealedVictimOf(target);
      if (formOwnerOf(target) !== null) await returnForm(this, target, sealedVictim !== null ? "SEAL_RELEASE" : "SUMMON_DEATH");
      const items = stolenBy(this, target.id);
      const returned = restoreStats(this, target.id, "DEATH");
      if (returned) this.trace.push({ t: "STEAL_RETURN_ALL", id: target.id, count: returned, reason: "DEATH", items: items.slice(0, 6) });
    }
    await this.bus.dispatch(EV.DEATH, { target, killerId }, target.id, target.teamId, id => this.teamOf(id));
    if (pol.killedAt === "AFTER_DEATH_RESOLUTION") {
      /**
       * ★★★ 第 129 轮：这一档的 KILLED 派发在 EV.DEATH **之后**，而「阵亡时…立即复活」的处理器
       *   正是在 EV.DEATH 上跑（第 129 轮接线）—— 真的复活成功时，目标此刻已经活着，
       *   再写 killed=true 就是把"这次真的死了"重新钉回去（revive 刚把它清掉）。
       *   ★ 反过来也要留痕：**跳过**这件事必须看得见，否则"为什么这次没记击杀"会变成静默。
       */
      if (target.dead) {
        target.killed = true; target.killCredit = killerId;
        await this.bus.dispatch(EV.KILLED, { target, killerId }, target.id, target.teamId, id => this.teamOf(id));
      } else {
        this.trace.push({ t: "KILLED_SKIPPED", id: target.id, killer: killerId, reason: "REVIVED_DURING_DEATH" });
      }
    }
    /**
     * ★★★ 第 103 轮：**击杀式放置**（KB：雪御前「龙胆·绽」——
     *   「击败非召唤物敌方目标时，在其行动条处召唤[龙胆蓝璃]」）。
     *   放在死亡流程**之后**：位置（victimPos）、击杀者、阵亡者此时都确定了。
     */
    if (killer && target.type !== EntityType.SUMMON) {
      for (const p of skillPlacements(killer)) {
        if (p.trigger !== "ON_KILL") continue;
        placeOnKill(this, killer, target, p, victimPos);
      }
    }
  }

  /**
   * ★★★ 第 98 轮：**放置单位（召唤物 / 姿态体）的唯一产生者** —— `addSummon`。
   *
   * 注册表 `kernel/effects.ts` 里那条 `{ key: "Summon", producer: "addSummon" }` 写的正是这一行：
   * 在此之前全仓库搜不到 `summons.push`（只有 state.ts 的恢复路径），
   * 于是"容器齐、序列化齐、恢复齐、寻敌齐"全都建立在**空的容器**上。
   *
   * 数据来源不是猜的：`data/kb/tips.json` 就是放置单位的定义处（技能原文用 `[tips_N]` 引用），
   * 例如 tips_3896 雷冢写明了「生命为须佐之男初始攻击150%／无法行动／不触发御魂和被动／
   * 被击败后以1点生命复活／若敌方只存在雷冢视为战斗胜利」。解析在 `kernel/summon.ts`。
   *
   * ★ 三条与 G0 有关的决定：
   *   ① 实体 id **确定性推导**（队伍 + 当前召唤物数），不用随机数（第 57 轮的教训）；
   *   ② 「被镇压的那个单位」记在 **notes** 里（notes 是 state 的一部分 ⇒ 存档/续跑不丢）；
   *   ③ `caps` 也是 state 的一部分 ⇒ `occupiesSummonSlot` / `countsForVictory` 跟着走。
   */
  addSummon(owner: Entity, spec: SummonSpec, opts: {
    suppressedId?: number;
    form?: { ownerId: number; tipsId: string; returnOn: string };
    hasSkills?: boolean;
    /** ★ 第 101 轮：召唤物**可以带技能表**（数据来自「[tips_N]姿态下可施放」） */
    skills?: any[];
    /**
     * ★★★ 第 103 轮：**放到哪一队**。默认跟拥有者同队；镇压式放置（雷冢）要放到**敌方**队里，
     *   因为被镇压的那个式神本来就在那一队（tips_3896：雷冢被击败后，被镇压的式神以 1 点生命复活）。
     */
    teamId?: number;
    /** ★ 第 103 轮：放进行动条的**哪个位置**（「在其行动条处召唤[龙胆蓝璃]」） */
    pos?: number;
    /** ★ 第 103 轮：这是"镇压"——本体（被镇压者）离场，这个单位被击败时它以 1 点生命回来 */
    seal?: { victimId: number };
  } = {}): Entity | null {
    const team = this.teams[opts.teamId ?? owner.teamId];
    /**
     * ★★ 占位检查读的是 `caps.occupiesSummonSlot`，**不是** `summons.length`。
     *   两个理由：
     *     ① 语义：占用召唤位的是"占位的那种单位"，不是数组里有几个元素
     *        （阵亡的、或不占位的单位不该继续堵着位子）；
     *     ② 这个字段此前**只有写入方、没有读取方** —— 字段普查会把"只有写"的字段
     *        记成豁免（它按出现次数算），于是缺口被藏起来。给它一个真读者才是修法。
     */
    const occupied = team.summons.filter(s => s.alive && s.caps.occupiesSummonSlot).length;
    if (occupied >= (team.summonSlots ?? 1)) {
      this.trace.push({ t: "SUMMON_SLOT_FULL", owner: owner.id, name: spec.name, tipsId: spec.tipsId, slots: team.summonSlots });
      return null;
    }
    /**
     * ★★★ 属性从哪来 —— 这一版把"没写的"和"写了的"**分开记**，而不是给个像样的默认值。
     *
     * 旧写法（本轮第一版）：atk 取 `拥有者攻击 × 0.5`。那个 0.5 **没有任何出处** ——
     * 它会让雷冢看起来有一个正常的攻击力，而 tips_3896 从头到尾没写攻击。
     * 这正是本项目禁止的"编一个数让报表好看"：**数值臆造比缺口更难发现**（缺口会露馅，编的数不会）。
     *
     * 现在按 tips 到底写了什么分三档：
     *   · `inheritInitialStats`（余烬「继承…初始属性」）⇒ 整套照抄拥有者的**初始**面板，来源 OWNER_INHERIT；
     *   · 原文写明的（雷冢的**生命** = 初始攻击×150%）⇒ 用它，来源 TIPS；
     *   · 原文没写的（雷冢的 atk / def）⇒ **给 0 并挂 `summon:stats-UNDECLARED`**，
     *     进 trace 的 statsSource 字段 —— 谁都看得见"这两项我们不知道"。
     * 速度是唯一的例外：它由「提升100点速度」这类**相对**措辞决定，锚点是拥有者速度（记 RELATIVE）。
     */
    const hpBase = spec.hp ? (owner.base[spec.hp.prop] ?? owner.base.hp ?? 1) * spec.hp.ratio
      : spec.inheritInitialStats ? (owner.base.hp ?? 1) : 1;
    /**
     * ★★★ 第 110 轮：`stats-UNDECLARED` 从"一个布尔"改成"**哪些属性没写**"。
     *   第 98 轮只有 HP 一种继承来源，所以"没写初始属性 ⇒ atk/def 都不知道"这句话成立；
     *   现在逐属性继承（`spec.inherit`）也能给出 def，于是再挂一个笼统的 UNDECLARED 就是**误报**
     *   （实测明识灯 def=792 来自「继承慧明灯100%防御」，却仍被标成"未声明"）。
     *   ★ 两项都没写时仍然挂原来那个名字（既有断言与事件语义不漂）。
     */
    const unknownProps: string[] = [];
    if (!spec.inheritInitialStats && !(spec.inherit ?? []).some(x => x.prop === "atk")) unknownProps.push("atk");
    if (!spec.inheritInitialStats && !(spec.inherit ?? []).some(x => x.prop === "def")) unknownProps.push("def");
    const undeclared = unknownProps.length === 2;
    /**
     * ★★★ 第 110 轮：**逐属性继承**（`spec.inherit`）——「继承千姬100%的防御」「继承猫川…100%防御」。
     *   它写在**原文里**（tips 的 desc），所以是"照原文给的数"，不是补一个好看的默认值：
     *   与 hp 一样进 base（初始面板），并且**在 statsSource 里说出来**（TIPS_INHERIT）。
     *   ★ 只覆盖 atk / def：速度另有措辞（「提升N点速度」，相对拥有者，记 RELATIVE）。
     */
    const inherited: Record<string, number> = {};
    for (const inh of spec.inherit ?? []) {
      if (inh.prop !== "atk" && inh.prop !== "def") continue;
      // ★ 第 191 轮：命名取整点（此前是散落的 Math.round —— 与 GameMath.roundAt 逐位等价，但可枚举可替换）
      inherited[inh.prop] = GameMath.roundAt((owner.base[inh.prop] ?? 0) * inh.ratio, "SUMMON_INHERIT_STAT");
    }
    const id = 900 + owner.teamId * 50 + team.summons.length + 1;
    const e = new Entity(id, spec.name, owner.teamId, {
      atk: spec.inheritInitialStats ? (owner.base.atk ?? 0) : (inherited.atk ?? 0),
      hp: Math.max(1, GameMath.roundAt(hpBase, "SUMMON_HP")),
      def: spec.inheritInitialStats ? (owner.base.def ?? 0) : (inherited.def ?? 0),
      spd: Math.max(1, (owner.base.spd ?? 100) + (spec.spdBonus ?? 0)),
      cri: 0, crid: 1.5, efh: 0, efr: 0,
    }, null);
    const statsSource = spec.inheritInitialStats ? "OWNER_INHERIT"
      : (spec.hp ? (Object.keys(inherited).length ? "TIPS_HP_INHERIT" : "TIPS_HP_ONLY") : "UNDECLARED");
    if (undeclared) e.notes.push("summon:stats-UNDECLARED");
    else if (unknownProps.length) e.notes.push("summon:stats-UNDECLARED:" + unknownProps.join("+"));
    e.type = spec.inheritInitialStats ? EntityType.SPECIAL_SUMMON : EntityType.SUMMON;
    e.caps.occupiesSummonSlot = true;
    /**
     * ★★ 「召唤物计不计入胜负」——这一条**不是**默认直觉，而是 KB 原文专门声明的**特例**：
     *   · tips_3896 雷冢：「若敌方只存在雷冢，视为战斗胜利」
     *   · tips_6071 余烬：「若场上只有余烬视为战斗失败」
     * 两条原文都在说同一件事：**该方只剩这个放置单位时，该方输**。
     * 若"召唤物算存活单位"是默认行为，这两句就没有写的必要 —— 所以默认取 false，
     * 并由 Team.victoryCount() 真正读这个字段（否则又是一个"有字段没读者"）。
     */
    e.caps.countsForVictory = false;
    if (spec.noAction) e.caps.advancesOrbGauge = false;
    e.notes.push("summon:" + spec.tipsId);
    /**
     * ★★★ 第 113 轮：**反应式光环与移除代价的记账**。
     *   notes 是**存档字段**：新建时装钩子、恢复后重装钩子，读的都是这里。
     */
    e.notes.push("summon:owner=" + owner.id);
    if (spec.reactive?.ratio) e.notes.push("summon:reactive-heal=" + spec.reactive.ratio);
    if (spec.onRemove?.orbs) e.notes.push("summon:on-remove-orbs=" + spec.onRemove.orbs);
    if (spec.onRemove?.healMaxHpRatio) e.notes.push("summon:on-remove-heal-maxhp=" + spec.onRemove.healMaxHpRatio);
    if (spec.onRemove?.damageAtkRatio) e.notes.push("summon:on-remove-damage-atk=" + spec.onRemove.damageAtkRatio);
    installSummonHooks(this, e);
    this.installEntitySinks();   // ★ 第 122 轮：新召唤物也要装 sink
    if (spec.suppressSoul) e.notes.push("summon:suppressSoul");
    if (spec.suppressPassive) e.notes.push("summon:suppressPassive");
    /**
     * 「免疫伤害、减益、控制效果和放逐」——**必须挂成真状态**，不能只写进 notes：
     * notes 没有任何读者，而 findDamageImmunity / findImmuneStatus 读的是 statusDefs()。
     * 第 94 轮把 immuneTo 接上以后，这里就是它的第二个来源（第一个是 buff 原文）。
     * duration 用 GLOBAL + 大数：它由召唤物的存活决定，不该被回合数掉光。
     */
    for (const k of spec.immuneTo) {
      const def: StatusDef = {
        id: "summon_immune_" + k.toLowerCase(), name: spec.name + "·免疫" + k, category: StatusCategory.BUFF_STATE,
        dispellable: false, removable: false, preventsAction: false, preventsSkill: false,
        forcesBasicAttack: false, suppressPassive: false, suppressSoul: false, locksTimeline: false,
        durationPolicy: "GLOBAL", immuneTo: [k as ImmuneKind], desc: spec.evidence,
      };
      /**
       * ★★★ 必须**登记进 StatusBook**，否则存档恢复读不到它。
       *   `state.ts` 还原状态时只拿得到 `defId`，要靠 StatusBook 反查定义；查不到就只记一条
       *   restore gap（"不静默丢"，但那个状态也回不来了）。合成的召唤物免疫状态**不在**任何
       *   buff 表里，所以第一版恢复后 `findDamageImmunity` 直接读不到 —— g59 §9 当场抓红。
       *   与 compile/character.ts 对编译出来的 buff 用同一条规矩：`if (!has) set`。
       */
      if (!StatusBook.has(def.id)) StatusBook.set(def.id, def);
      e.addStatus(def, e.id, 1, 99999);
    }
    if (opts.suppressedId !== undefined) e.notes.push("suppressed:" + opts.suppressedId);
    /**
     * ★★★ 第 101 轮：形态单位要记住"我是谁的形态"。
     *   记在 **notes** 里（notes 是存档字段）⇒ 这条关系能续跑：本体阵亡回归、形态阵亡让本体回来，
     *   都靠它找回本体，而不需要新的状态字段。
     */
    /**
     * ★★★ 第 103 轮：**规格里已有的字段要用起来**（不是把 tips 的结论再硬编码一遍）。
     *   tips_3896 写着「雷冢被击败后，被镇压的式神以**1点生命**复活」⇒ SummonSpec.onDefeatRevive={hp:1}
     *   在规格里**从第 98 轮就存在**，但运行时一直没用它。现在把解除时的生命值记在这里（notes 进存档）。
     */
    if (spec.onDefeatRevive) e.notes.push("form:returnHp=" + spec.onDefeatRevive.hp);
    if (opts.seal) {
      /**
       * ★ 镇压关系也记在 notes（存档字段）⇒ 续跑之后仍然知道该把谁放出来。
       *   与 form:owner= 分开记：一个说"我是谁的形态"，一个说"我压着谁"——
       *   两者的归还语义不同（形态：本体回来；镇压：被镇压者以 1 点生命复活）。
       */
      e.notes.push("seal:victim=" + opts.seal.victimId);
      e.notes.push("form:owner=" + opts.seal.victimId);
    }
    if (opts.form) {
      e.notes.push("form:owner=" + opts.form.ownerId);
      e.notes.push("form:returnOn=" + opts.form.returnOn);
      e.notes.push("form:tips=" + opts.form.tipsId);
    }
    /**
     * ★ 技能表：形态单位可以**带着自己的技能**上场（第 102 轮，数据来自「[tips_N]姿态下可施放」）。
     *   没有技能表的单位照样在场上，并且会进行动条（第 102 轮放开）：
     *   它这一回合什么都不做，而"为什么什么都不做"记在 notes / trace 里（summon:NO_SKILLS）。
     */
    if (opts.skills?.length) e.skills.push(...opts.skills);
    const skillless = (e.skills?.length ?? 0) === 0;
    if (skillless) {
      e.caps.advancesOrbGauge = false;
      e.notes.push("summon:NO_SKILLS");
      this.trace.push({ t: "SUMMON_NO_SKILLS", summon: e.id, name: spec.name, tipsId: spec.tipsId, note: "没有技能表 ⇒ 不进行动条（第 98 轮声明的空缺）" });
    }
    team.summons.push(e);
    /**
     * ★★★ 第 102 轮：**没有技能表也进行动条**。
     *   第 101 轮把这类单位挡在行动条外面（怕它在回合里空转），第 102 轮放开，理由有两条：
     *     ① 回合处理器对 `ctx.skill === null` 是**安全**的（battle.ts：`if (ctx.skill) {...}` 一整段被守卫），
     *        空转就是"这一回合它什么也不做"——那正是"无法行动"该有的样子；
     *     ② 更重要：**余烬的回归时机是"到达行动条终点"**（tips_6071）。不进行动条 = 永远到不了终点 = 永远回不来。
     *   仍然如实留痕（summon:NO_SKILLS + SUMMON_NO_SKILLS），因为"它为什么什么都不做"必须看得见。
     */
    if (!spec.noAction) this.timeline.add(e.id, () => e.speed, opts.pos ?? 0);
    this.trace.push({
      t: "SUMMON_CREATE", owner: owner.id, summon: e.id, name: spec.name, tipsId: spec.tipsId,
      hp: GameMath.display(e.maxHp), noAction: spec.noAction, countsForVictory: e.caps.countsForVictory,
      statsSource, atk: e.base.atk, def: e.base.def, spd: e.base.spd,
      suppressed: opts.suppressedId ?? null,
    });
    return e;
  }

  async revive(target: Entity, hp: number): Promise<boolean> {
    if (!target.dead || target.reviveBlocked || target.transformed) return false;  // 官方[3252][3342]
    target.alive = true; target.dead = false; target.killed = false; target.hpZero = false;
    target.hp = Math.min(target.maxHp, Math.max(1, hp));
    this.timeline.add(target.id, () => target.speed);
    this.trace.push({ t: "REVIVE", id: target.id, hp: target.hp });
    await this.bus.dispatch(EV.REVIVE, { target }, target.id, target.teamId, id => this.teamOf(id));
    return true;
  }

  // ---------- 胜负 ----------
  checkVictory(): boolean {
    const a = this.teams[0].victoryCount();
    const b = this.teams[1].victoryCount();
    if (a === 0 && b === 0) { this.winner = null; this.endReason = "DOUBLE_KO"; return true; }
    if (a === 0) { this.winner = 1; this.endReason = "TEAM0_WIPED"; return true; }
    if (b === 0) { this.winner = 0; this.endReason = "TEAM1_WIPED"; return true; }
    /**
     * ★ §30 的必然要求：边界检查会**重复发生**，所以它必须是「全函数」。
     *   没有分出胜负时要把上一次的胜负判定清掉 —— 否则
     *   「打死 → 复活 → 继续打」会被上一条结论钉死：战场真的继续了，winner 却already 设了。
     *   只清由全灭/同归于尽得出的判定，不碰 NO_ACTOR / TURN_LIMIT 这类外部终止原因。
     */
    if (this.endReason === "TEAM0_WIPED" || this.endReason === "TEAM1_WIPED" || this.endReason === "DOUBLE_KO") {
      this.winner = null; this.endReason = "";
    }
    return false;
  }

  /**
   * ★ a1-4 §31 Atomic Resolution：在一个 ResolutionScope 里执行 fn。
   *   **最外层**退出时到达 ResolutionBoundary（内层不触发）。
   */
  async withinResolution<T>(scope: ResolutionScope, fn: () => Promise<T> | T): Promise<T> {
    this.resolutionStack.push(scope);
    try {
      return await fn();
    } finally {
      this.resolutionStack.pop();
      if (this.resolutionStack.length === 0) await this.resolveBoundary(scope);
    }
  }

  /**
   * ★ a1-4 §30：ResolutionBoundary —— 边界处判胜负（不再等到回合结束）。
   *
   * 与规格的**一处有意差异**，写在这里而不是藏着：死亡状态仍是**即时落账**的
   * （Entity.mutateHp → Battle.resolveLethal），没有推迟到边界才 commit deaths。
   * 理由：推迟落地会让所有「结算中途读 alive」的代码改变行为，影响面远大于本项收益。
   * 而 §30 真正要保证的观测量 —— 双方同时死亡必须判平局、不得在中途提前宣布胜方 ——
   * 由「只在边界判定」直接保证：两次死亡都在判定之前落账，边界看到的是 0 : 0。
   * 这一点由 tests/g28 用「同一段技能里双方同归于尽」的用例锁住。
   *
   * 判定**发生变化**时才发事件（达成 / 被复活推翻），所以一场战斗通常只有一条
   * VICTORY_CHECK：每次边界都发会把事件链灌满，而 Theater 需要的只是「这一回合为什么结束」。
   * 检查次数记在 battle.victoryChecks，可断言。
   */
  async resolveBoundary(boundaryScope: ResolutionScope | null = null): Promise<boolean> {
    const before = this.endReason;
    const won = this.checkVictory();
    this.victoryChecks++;
    const after = won ? this.endReason : "";
    if (after !== before && (won || before !== "")) {
      const payload = {
        won, winner: this.winner, reason: this.endReason || null, previousReason: before || null,
        overturned: !won, turn: this.turn, checked: this.victoryChecks,
        boundary: boundaryScope?.type ?? "TURN_END",
        scope: boundaryScope ? { id: boundaryScope.id, type: boundaryScope.type } : null,
        alive: [this.teams[0].aliveMembers().length, this.teams[1].aliveMembers().length],
      };
      // 两条通道都要留痕：事件链进 ReplayFile（Theater/Inspector 读它），
      // trace 进 ReplayEvent（Worker 路径的 SimulationResult 读它）。只写一条 = 半条。
      this.trace.push({ t: "VICTORY_CHECK", ...payload });
      await this.bus.dispatch(EV.VICTORY_CHECK, payload, 0, 0, id => this.teamOf(id));
    }
    return won;
  }

  // ---------- 主循环 ----------
  /**
   * ★ G0/G4：可暂停的主循环。run() = runStartup() + runPartial(∞)。
   * 返回 true 表示"还需要继续"（未分胜负且未到上限），false 表示已终止。
   * Theater 的暂停/单步、以及 G0 的"存档续跑"都依赖它 —— 不把它拆出来，
   * 就没法在一场战斗中途拿到一致的状态快照。
   */
  async runPartial(maxAdditionalTurns = Infinity): Promise<boolean> {
    if (!this.startupDone) await this.runStartup();
    const stopAt = Math.min(this.rules.maxTurns, this.turn + maxAdditionalTurns);
    while (this.turn < stopAt) {
      const actorId = this.timeline.advance();
      if (actorId === null) { this.endReason = "NO_ACTOR"; break; }
      const actor = this.entity(actorId);
      if (!actor || !actor.alive) continue;
      this.turn++;
      await this.runTurn(actor, TurnType.NORMAL);
      // ★ §30：回合结束本身就是一次 ResolutionBoundary（DoT / 回合结束触发的死亡在这里被判）
      if (await this.resolveBoundary()) break;
      // Extra turns granted during that turn (kernel/extra-turn.ts) are played now, before the bar advances.
      if (await this.runExtraTurns()) break;
    }
    if (this.winner !== null || this.endReason === "NO_ACTOR" || this.turn >= this.rules.maxTurns) {
      if (this.turn >= this.rules.maxTurns && this.winner === null) this.endAtTurnLimit();
      if (!this.ended) {
        this.ended = true;
        this.phase = Phase.END;
        /** ★ 第 244 轮：同上 —— 末帧要对得上规格写的 BATTLE_END（带胜负与结束原因，Theater 的收尾横幅靠它） */
        this.trace.push({ t: "BATTLE_END", winner: this.winner, reason: this.endReason || null });
        await this.bus.dispatch(EV.BATTLE_END, { battle: this }, 0, 0, id => this.teamOf(id));
        // ★ G2：终局状态必须补记一帧 —— 胜负是在最后一个事件**之后**才写进状态的
        //   （checkVictory / TURN_LIMIT），不补记的话"重建最终状态"永远差一步。
        this.snapshot(this.frameBase + this.trace.length);
      }
      return false;
    }
    return true;
  }

  /**
   * ★★★ 观测的唯一入口（第 64 轮）。
   *
   * 此前 `recorder.onFrame` 是**无条件**调用的：`traceLevel` 只在上面那一处（trace.push 的重写）
   * 被读，管的是 trace，**不管快照**。于是"三档"在内核里其实是**两档**：
   *   · `NONE` + 挂了 recorder ⇒ 仍然会回调（终局帧）—— 并不是"只跑战斗，不留观测"；
   *   · `SUMMARY` 与 `FULL` 在内核里**完全无法区分**，差别只在调用方挂不挂 recorder。
   *     也就是说"我先声明 SUMMARY、再偷偷挂个 recorder"能拿到 FULL 的行为 —— 档位名不保证行为。
   *
   * 现在统一在这里把关：**只有 FULL 档产生快照**。
   * 扫描过全部挂载点（adapter 的 replay、runner/replay-cli、g2 的三处、g3）——
   * 它们**都已经**先声明 `traceLevel: "FULL"` 再挂 recorder，所以这次收紧不改变任何既有行为，
   * 只是把"调用方的自觉"变成内核的不变量。
   */
  private snapshot(frame: number): void {
    if (this.traceLevel !== "FULL") return;
    this.recorder?.onFrame(this, frame);
  }

  /**
   * Turn cap reached without a winner. Default: TURN_LIMIT (no winner). Under the betting endgame
   * policy (timeout = ALIVE_THEN_HP) the battle is adjudicated: more surviving shikigami, then higher
   * team remaining HP%, else a draw.
   */
  private endAtTurnLimit(): void {
    const v = timeoutVerdict(this);
    if (!v) { this.endReason = "TURN_LIMIT"; return; }
    if (this.ended) return;   // already adjudicated (runPartial may be re-entered after the end)
    this.winner = v.winner;
    this.endReason = v.reason;
    this.trace.push({ t: "TIMEOUT_DECISION", winner: v.winner, reason: v.reason, alive: v.alive, hpPct: v.hpPct, turn: this.turn });
  }

  async run(): Promise<{ winner: 0 | 1 | null; turns: number; reason: string }> {
    await this.runStartup();
    while (this.turn < this.rules.maxTurns) {
      const actorId = this.timeline.advance();
      if (actorId === null) { this.endReason = "NO_ACTOR"; break; }
      const actor = this.entity(actorId);
      if (!actor || !actor.alive) continue;
      this.turn++;
      await this.runTurn(actor, TurnType.NORMAL);
      // ★ §30：回合结束本身就是一次 ResolutionBoundary（DoT / 回合结束触发的死亡在这里被判）
      if (await this.resolveBoundary()) break;
      // Extra turns granted during that turn (kernel/extra-turn.ts) are played now, before the bar advances.
      if (await this.runExtraTurns()) break;
    }
    if (this.turn >= this.rules.maxTurns && this.winner === null) this.endAtTurnLimit();
    this.phase = Phase.END;
    if (!this.ended) {
      this.ended = true;
      /** ★ 第 244 轮：同上 —— 末帧要对得上规格写的 BATTLE_END（**这条路径才是 `run()` 用的那条**，
       *  第一次改动把 trace 只加在了另一个分支上，于是录像里 BATTLE_END 一帧都没有）。 */
      this.trace.push({ t: "BATTLE_END", winner: this.winner, reason: this.endReason || null });
      await this.bus.dispatch(EV.BATTLE_END, { battle: this }, 0, 0, id => this.teamOf(id));
      this.snapshot(this.frameBase + this.trace.length);
    }
    return { winner: this.winner, turns: this.turn, reason: this.endReason || "UNKNOWN" };
  }

  /**
   * Plays the queued extra turns (TurnType.NEW_TURN: counts as a turn, triggers turn start / end, does
   * not advance the onibi gauge). Returns true when the battle ended. An extra turn may grant another
   * one (it is queued and played in the same loop). Empty queue ⇒ no-op (BASE behaviour unchanged).
   */
  private async runExtraTurns(): Promise<boolean> {
    while (pendingExtraTurns(this) > 0) {
      const next = takeExtraTurn(this)!;
      if (this.winner !== null || this.turn >= this.rules.maxTurns) {
        clearExtraTurns(this);
        return this.winner !== null;
      }
      const actor = this.entity(next.id);
      if (!actor || !actor.alive) continue;
      this.turn++;
      this.trace.push({ t: "EXTRA_TURN", actor: actor.id, reason: next.reason, turn: this.turn });
      await this.runTurn(actor, TurnType.NEW_TURN);
      if (await this.resolveBoundary()) { clearExtraTurns(this); return true; }
    }
    return false;
  }

  async runTurn(actor: Entity, type: TurnType): Promise<void> {
    /**
     * ★★★ 第 109 轮：**战斗时间只在这里推进**。
     *   放在 `runTurn` 而不是 `runTurnInner`：伪回合（反击/协战/追加行动）不是"过了一个回合"，
     *   它们不该让残局档位往前走 —— 与 TurnFlags 的 `countAsTurn: false` 是同一条语义。
     */
    envAdvanceTurn(this);
    envTick(this, "TURN_START");
    // ★ G1：整回合作为一个事件节点，内部的一切（行动开始/选技能/伤害/上状态/被动/御魂）
    //   都自动挂到它下面 —— Theater 的"这一回合发生了什么"就是这棵子树。
    await this.bus.within("TURN", { actor, type, turn: this.turn }, actor.id, actor.teamId, id => this.teamOf(id), async () => {
      await this.runTurnInner(actor, type);
    });
    /** ★ 第 115 轮：回合结束时判**场地到期**（「存在N回合」，创建当回合算第 1 回合） */
    expireFields(this);
    // Betting endgame referee round (policies.endgame; NONE ⇒ no-op).
    envRefereeAfterTurn(this, actor);
  }

  /**
   * ★ Turn 四分类的**受控入口**（a1-4 §12：NORMAL / NEW_TURN / PSEUDO_TURN / ACTION_ONLY）。
   * 反击、协战、追加行动这类"不是完整回合"的行为必须走这里，而不是直接调 runTurn：
   *   - 该不该推进鬼火条、该不该触发回合开始/结束，全部由 TurnFlags 决定（不硬编码行为差异，§13）
   *   - 会留下一条 TURN_TYPE 事件，Theater 里能看出"这一次不是普通回合"
   *   - 事件链上会多一个以类别命名的节点，方便 Inspector 归类
   */
  async runPseudoTurn(actor: Entity, type: TurnType = TurnType.PSEUDO_TURN, forcedAction?: { skill?: any; target?: Entity; free?: boolean }): Promise<void> {
    const f = TurnFlags[type] as any;
    this.trace.push({
      t: "TURN_TYPE", actor: actor.id, type,
      turnStart: !!f?.triggersTurnStart, advancesOrbGauge: !!f?.advancesOrbGauge, turnEnd: !!f?.triggersTurnEnd,
      countAsTurn: false,
    });
    await this.bus.within(type, { actor, type, turn: this.turn }, actor.id, actor.teamId, id => this.teamOf(id), async () => {
      await this.runTurnInner(actor, type, forcedAction);
    });
  }

  /**
   * ★★★ 第 95 轮：**反击** —— 把"受到伤害就打回去"接上 `runPseudoTurn`。
   *
   * 由来：`runPseudoTurn`（a1-4 §12 的伪回合受控入口）从第 23 轮就在，但**没有任何生产者**——
   * capability 的 COUNTER 因此一直是 PARTIAL「入口在、无生产者」，未建模表里「反击」有 15 处命中。
   *
   * 四条守卫，每一条都有文本或机制依据：
   *   ① **反击不连锁**：原文里就有「**若非进行反击**」（酒吞童子「鬼葫芦」/以津真天「风之舞」）。
   *      判据不新造状态：看**事件链的祖先**里有没有 PSEUDO_TURN（`bus.ancestry`）——
   *      于是它是从事件树推出来的，不进 state、不影响指纹、重放天然一致。
   *   ② 双方都得活着（打人的死了/被打的死了都不反击）。
   *   ③ 被打的那个**能动**才反击（眩晕/冰冻/变形 → 不反击）—— 与 isActionPrevented 同一判据。
   *   ④ 强制**普攻**打回去（不是"再放一次技能"）：反击在游戏里就是一次普攻动作。
   */
  async counterAttack(defender: Entity, attackerId: number): Promise<boolean> {
    if (!defender.alive || defender.hp <= 0) return false;
    const attacker = this.allEntities().find(e => e.id === attackerId) ?? null;
    if (!attacker || !attacker.alive || attacker.teamId === defender.teamId) return false;
    // ① 反击不连锁：祖先链里已经有伪回合 ⇒ 这次也是反击打出来的，不再反击
    const cur = this.bus.currentEvent;
    const chain = cur === null ? [] : this.bus.ancestry(cur);
    if (chain.some(n => n.code === TurnType.PSEUDO_TURN)) return false;
    // ③ 被控住不能反击
    if (isActionPrevented(defender.statusDefs())) return false;
    const basic = defender.skills.find((s: any) => (Number(s.cost) || 0) === 0) ?? defender.skills[0] ?? null;
    if (!basic) return false;
    this.trace.push({ t: "COUNTER", actor: defender.id, target: attacker.id, skill: basic.name, turn: this.turn });
    await this.runPseudoTurn(defender, TurnType.PSEUDO_TURN, { skill: basic, target: attacker });
    return true;
  }

  private async runTurnInner(actor: Entity, type: TurnType, forcedAction?: { skill?: any; target?: Entity; free?: boolean }): Promise<void> {
    /** ★★★ 第 237 轮：**免消耗施放**（见 kernel/sub-cast.ts 的 SubCastSpec.free）—— 只影响本函数里那一次施放的付费判定 */
    const freeCast = forcedAction?.free === true;
    const f = TurnFlags[type];
    const other = this.teams[actor.teamId === 0 ? 1 : 0];
    this.bus.actorTeam = actor.teamId;
    if (f.triggersTurnStart) await this.bus.dispatch(EV.TURN_START, { actor, type }, actor.id, actor.teamId, id => this.teamOf(id));
    /**
     * ★★★ 第 131 轮：**"目标下回合开始前至多触发1次"的窗口在这里重新开始**。
     *   替友方拦死（kernel/ally-guard.ts）的次数上限是**按目标的回合窗口**算的：
     *   窗口从目标自己这一回合开始，直到它下一次回合开始。所以每回合开头把窗口标记清掉。
     *   ★ 只清**自己的**窗口（笔记键带拥有者 id，见 ally-guard.ts），别人的窗口不受影响。
     */
    if (f.triggersTurnStart && clearAllyGuardWindow(actor) > 0) {
      this.trace.push({ t: "ALLY_GUARD_WINDOW", target: actor.id, reason: "OWN_TURN_START" });
    }
    /**
     * ★★★ 第 124 轮：**场地的每回合效果**（第 115 轮明说「没有行为代码」的那一块）。
     *   位置：TURN_START 之后、行动之前 —— 原文「在回合开始前有67%概率获得1点鬼火」。
     *   只对**行动者**结算（每个单位在自己回合开始时各掷一次），范围由场地自己判（ALLY / ENEMY）。
     */
    fieldTurnStart(this, actor);
    if (f.advancesOrbGauge) {
      await this.bus.dispatch(EV.ORB_GAUGE_ADVANCE, { team: this.teams[actor.teamId] }, actor.id, actor.teamId, id => this.teamOf(id));
      const full = this.teams[actor.teamId].orbs.advanceGauge();
      if (full) this.teams[actor.teamId].orbs.pendingReward = this.teams[actor.teamId].orbs.rewardForCycle();
    }
    // 行动阶段：选技能 -> 选目标 -> 支付 -> 结算
    const ctx: any = { battle: this, actor, skill: null, target: null };
    await this.bus.dispatch(EV.SKILL_SELECT, ctx, actor.id, actor.teamId, id => this.teamOf(id));
    // ★ 控制效果必须真的阻止行动（a1-4 §23 状态系统）。
    //   此前 preventsAction / canCastSkill / forcesBasicAttack 三个标记**数据齐全但从未被读取**：
    //   被眩晕/冰冻/沉睡的单位照样正常放技能，控制队等于不存在。
    /**
     * ★★★ 第 102 轮：**"到达行动条终点"就是"轮到它行动"** —— 形态类放置单位的第二种回归时机。
     *   tips_6071（余烬）：「到达行动条终点后复活」。放在这里（回合入口，早于一切状态判定与选招）：
     *   本体该在形态"到达终点"的**那一刻**回来，而不是等这一回合打完。
     *   ★ 只对形态单位生效，且只还一次（notes 里记 form:returned）。
     */
    if (formOwnerOf(actor) !== null && actor.notes.includes("form:returnOn=TIMELINE_END") && !actor.notes.includes("form:returned")) {
      actor.notes.push("form:returned");
      await returnForm(this, actor, "TIMELINE_END");
      /**
       * ★★★ 第 130 轮：**本体回来了，形态就得离场**。
       *
       * 实测（tools/_probe-embercap130.ts）：returnForm 只把本体放回来，**不撤形态单位** ——
       *   于是余烬在回归之后仍然活着、仍然在行动条上、仍然带着 4 种免疫。
       *   它没有技能（SUMMON_NO_SKILLS）所以"看起来什么都没发生"，但它会一直占着行动条位置、
       *   一直是一具打不死的空壳 —— 一个不会报错的错。
       * ★ 走 removeSummon（移除路径）而不是 resolveLethal：形态**没有被打死**，是本体回来了 ⇒
       *   不该触发死亡链（KILLED / 阵亡被动 / 击杀式放置 / 阵亡归还），与第 111 轮"收回"同一条判据。
       */
      await removeSummon(this, actor, "FORM_RETURN:TIMELINE_END");
    }
    /**
     * ★★★ 第 111 轮：**收回**（「回合开始时，收回[tips_5523]并移除[buff_5522_1]」）。
     *   与"被打死"是两条不同的离场路径：收回**不触发**死亡链（KILLED / 阵亡被动 / 击杀式放置），
     *   所以它走 removeSummon，而不是 resolveLethal。
     *   ★ 位置与「到达行动条终点」那个形态钩子同一处：都是"轮到拥有者行动了，先处理场地上的东西"。
     */
    for (const fm of skillPlacements(actor)) {
      if (fm.recall?.at !== "OWNER_TURN_START") continue;
      const team = this.teams[actor.teamId];
      const s = (team.summons ?? []).find((x: any) => (x.notes ?? []).includes("summon:" + fm.tipsId));
      if (!s) continue;
      await removeSummon(this, s, "RECALL_TURN_START");
      /** 「并移除[buff_5522_1]」—— 原文点名了状态 id，就对**敌方**身上那个 id 逐条移除 */
      for (const id of fm.recall.removeStatuses ?? []) {
        for (const foe of this.enemiesOf(actor.teamId)) {
          for (const st of [...foe.statuses]) {
            if (st.def.id !== id) continue;
            if (foe.expireStatus(st)) this.trace.push({ t: "STATUS_REMOVED", id: foe.id, status: id, by: actor.id, reason: "RECALL" });
          }
        }
      }
    }
    const statusDefs = actor.statusDefs();
    const prevented = isActionPrevented(statusDefs);
    const canCast = canCastSkill(statusDefs);
    const forced = statusDefs.find((d: any) => d.forcesBasicAttack) ?? null;
    if (prevented) {
      const by = statusDefs.filter((d: any) => d.preventsAction).map((d: any) => d.id);
      this.trace.push({ t: "ACTION_PREVENTED", actor: actor.id, by });
      this.turnLog.push({ turn: this.turn, actorId: actor.id, type, note: "ACTION_PREVENTED:" + by.join("/") });
    }
    const basic = () => actor.skills.find((s: any) => s.cost === 0) ?? null;
    /**
     * ★★★ 第 95 轮：**伪回合可以指定动作**（反击 = 用普攻打回去）。
     *   在此之前 runTurnInner 只会走 AI 选招 —— 反击若走 AI，就变成"被打了以后有机会放一个群体技能"，
     *   那不是反击。forced 只在调用方明确给出时生效（今天唯一的调用方是 counterAttack）。
     */
    if (forcedAction?.skill && !ctx.skill && !prevented) {
      ctx.skill = forcedAction.skill;
      if (forcedAction.target) ctx.target = forcedAction.target;
      this.trace.push({ t: "SKILL_FORCED", actor: actor.id, reason: "COUNTER", skill: ctx.skill?.name ?? null, target: forcedAction.target?.id ?? null });
    }
    if (!ctx.skill && !prevented) {
      if (forced) {
        // 嘲讽/挑衅/混乱：强制普攻，AI 的 cast 规则被架空
        ctx.skill = basic() ?? (actor.skills[0] ?? null);
        this.trace.push({ t: "SKILL_FORCED", actor: actor.id, by: (forced as any).id, reason: "forcesBasicAttack", skill: ctx.skill?.name ?? null });
      } else if (!canCast) {
        // 封印类：不能使用技能，只能普攻
        ctx.skill = basic() ?? (actor.skills[0] ?? null);
        this.trace.push({ t: "SKILL_FORCED", actor: actor.id, by: statusDefs.filter((d: any) => d.preventsSkill).map((d: any) => d.id), reason: "preventsSkill", skill: ctx.skill?.name ?? null });
      } else {
        // 官方 AI：先按鬼火过滤，再按 cast 规则优先级选技能
        ctx.skill = this.skillSelector
          ? this.skillSelector(this, actor, this.enemiesOf(actor.teamId))
          : (actor.skills.filter((s: any) => s.selectable !== false)[0] ?? null);
      }
    }
    if (ctx.skill) {
      if (!ctx.target) {
        const enemies = this.enemiesOf(actor.teamId);
        ctx.target = ctx.skill.pickTarget ? ctx.skill.pickTarget(this, actor, enemies) : enemies[0] ?? null;
      }
      if (ctx.target && ctx.skill.execute) {
        // ★★★ 第 74 轮：补上 \`SKILL_START\` 的派发点 —— 「攻击时」这一族被动等的就是它。
        //
        // 为什么必须在这里（而不是 AFTER_DAMAGE）：登记册里写明了这一族的语义 ——
        //   「攻击时」= 这次攻击**动作开始了**（被闪避、被免疫、被护盾全挡，都算）
        //   「造成伤害时」= 这次攻击**真的造出了伤害**（不算的那些走 AFTER_DAMAGE）
        // 两者是两个时点，所以不能共用同一个事件码。
        //
        // 判据「这个技能是不是攻击」用**编译产物自己**的话：\`ir.damage.length > 0\`。
        // 不新造一套启发式 —— 技能 IR 里有没有伤害分量，是编译器已经算好的事实。
        if (isAttackSkill(ctx.skill)) {
          await this.bus.dispatch(EV.SKILL_START,
            { battle: this, actor, skill: ctx.skill, target: ctx.target, type },
            actor.id, actor.teamId, id => this.teamOf(id));
        }
        // ★ a1-4 §31：一次技能释放是一次 SKILL resolution（其内部的多段是 HIT 子 scope）
        await this.withinResolution({ id: "SKILL:" + (ctx.skill.name ?? "?"), type: "SKILL" }, () => ctx.skill.execute(this, actor, ctx.target, undefined, freeCast ? { free: true } : undefined));
        // ★★★ 第 119 轮：补上 `SKILL_END` 的派发点（此前**声明了、映射了、却从未派发**）。
        //
        // 它是怎么被藏住的：`DISPATCHED_EV_CODES` 里从第 74 轮就写着 SKILL_END，御魂表也把它
        // 当成「施放技能后」的落点（soul/effect-system.ts 的 `ON_SKILL: EV.SKILL_END,`）——
        // 而那句**映射本身**正好命中旧扫描规则里的 `EV.X,` 这一半，于是它被算成「有派发点」。
        // 后果与第 90 轮那个 CRI 死处理器同类：真挂上去的御魂/被动会被判成「已安装」却永不触发。
        // 实测（tools/event-audit.ts）：45 个码里它是**唯一**一个「声明说有派发、事实没有」的。
        //
        // 语义边界（如实写，不糊）：SKILL_END = 这次**技能释放结束了**（攻击 / 治疗 / 增益都算）。
        // 它与 SKILL_START **不是一对**：后者是「攻击动作开始」，只对带伤害分量的技能派发。
        // ★ 已知粗糙处：御魂触发词是 /施放技能(?:时|后)/ —— 「时」与「后」被并成同一个 trigger，
        //   所以哪怕原文写「施放技能时」，今天也只能在这一刻触发。70 件御魂实测 0 件命中此写法，先记账。
        await this.bus.dispatch(EV.SKILL_END,
          { battle: this, actor, skill: ctx.skill, target: ctx.target, type },
          actor.id, actor.teamId, id => this.teamOf(id));
        // ★ 第 120 轮：这次技能里同步产生的事件（治愈 / 失血 / 状态增删 / 鬼火）在动作结束前投递
        await this.drainEvents();
        this.recordAction(actor.id, ctx.skill.name);   // §45：统计由引擎累计，与 trace 档位无关
        this.turnLog.push({ turn: this.turn, actorId: actor.id, type, skill: ctx.skill.name, targetId: ctx.target.id });
      } else {
        this.turnLog.push({ turn: this.turn, actorId: actor.id, type, note: "no-target-or-execute" });
      }
    }
    await this.bus.dispatch(EV.ACTION_END, { actor, type }, actor.id, actor.teamId, id => this.teamOf(id));
    if (f.triggersTurnEnd) await this.bus.dispatch(EV.TURN_END, { actor, type }, actor.id, actor.teamId, id => this.teamOf(id));
    /**
     * ★★★ 第 125 轮：场地的**回合结束**效果（「双方目标在回合结束时有40%概率被施加[混乱]」）。
     *   放在 TURN_END 的同一条闸门里：伪回合（反击）不是回合结束，不该触发它。
     */
    if (f.triggersTurnEnd) fieldTurnEnd(this, actor);
    // 规格书：回合结束阶段第7步推进鬼火条 -> 满格则回火（pendingReward）
    if (f.advancesOrbGauge) {
      const pool = this.teams[actor.teamId].orbs;
      if (pool.pendingReward > 0) {
        const g = pool.gain(pool.pendingReward);
        this.trace.push({ t: "ORB_REWARD", team: actor.teamId, requested: pool.pendingReward, gained: g.gained, overflow: g.overflow });
        pool.pendingReward = 0;
      }
    }
    // 状态计时：官方[15] 以来源回合计算
    for (const e of this.allEntities()) {
      for (const st of [...e.statuses]) {
        if (st.def.durationPolicy === "TARGET_TURN" && e.id !== actor.id) continue;
        if (st.def.durationPolicy === "SOURCE_TURN" && st.sourceId !== actor.id) continue;
        st.remaining--;
        if (st.remaining <= 0) {
          e.expireStatus(st);
          this.trace.push({ t: "STATUS_EXPIRE", id: e.id, status: st.def.id });
          this.queueEvent(EV.STATUS_EXPIRE, { battle: this, entity: e, status: st.def.id, name: st.def.name, reason: "DURATION" }, e.id, e.teamId);
        }
      }
    }
    // ★ 第 120 轮：本回合的到期事件在这一回合内投递（顺序：先全部到期，再按入队顺序送达）
    await this.drainEvents();
  }

  /**
   * ★★★ 第 120 轮：**事件队列**（a1-4 §14 的 EventQueue，落在引擎里的最小形态）。
   *
   * 由来：治疗 / 失血 / 状态到期 / 鬼火这些生产点是**同步函数**（healTarget / loseHp / expireStatus …），
   * 它们没法 `await bus.dispatch(...)` —— 硬写就是不 await 的**悬空 Promise**，处理器会在不可预测的
   * 微任务时刻跑（而事件顺序是本项目里最不能含糊的东西之一）。
   * 所以生产者只**入队**，由 Battle 在安全点统一 drain：
   *   · 每个开局阶段结束（soul_start / passive_start 期间上的状态要送达）
   *   · 一次技能释放结束（SKILL_END 之后、ACTION_END 之前 —— 事件属于这次动作）
   *   · 回合里的状态计时结束（到期事件在这一回合内送达）
   * 顺序语义：同一批按入队顺序投递；**drain 期间新入队的事件留到下一批**（不递归、不插队）。
   */
  private pendingEvents: Array<{ code: string; ctx: any; selfId: number; teamId: number }> = [];
  /** 入队（同步，无 await）—— 供 healTarget / loseHp / 状态到期 / 鬼火等同步生产点使用 */
  queueEvent(code: string, ctx: any, selfId: number, teamId: number): void {
    this.pendingEvents.push({ code, ctx, selfId, teamId });
  }
  /** 投递一批事件，返回投递条数（供测试与 Inspector 用） */
  async drainEvents(): Promise<number> {
    if (!this.pendingEvents.length) return 0;
    const batch = this.pendingEvents;
    this.pendingEvents = [];
    for (const e of batch) await this.bus.dispatch(e.code, e.ctx, e.selfId, e.teamId, id => this.teamOf(id));
    return batch.length;
  }

  // 便捷 API（Dummy / 实验用）
  /** ★ 第 93 轮：第 6 个参数是**吸血**（比例）—— 由技能 IR 提供，见 damage.ts 的 applyLifesteal。 */
  damage(src: Entity, dst: Entity, base: number, type: any, rate = 1, lifesteal?: { ratio: number } | null) {
    return dealDamage(this, lifesteal ? { source: src, target: dst, base, rate, type, lifesteal } : { source: src, target: dst, base, rate, type });
  }
  heal(src: Entity, dst: Entity, amount: number, opts?: any) { return healTarget(this, src, dst, amount, opts); }
  lose(dst: Entity, amount: number) { return loseHp(this, dst, amount); }

  summary() {
    return {
      battleId: this.id, seed: this.rng.seed, turns: this.turn, winner: this.winner, reason: this.endReason,
      policies: policySnapshot(this.policies), policiesContainUnknown: hasUnknownPolicy(this.policies),
      rngDraws: this.rng.draws.length, traceLength: this.trace.length,
      teams: this.teams.map(t => ({ id: t.id, name: t.name, alive: t.aliveMembers().length, orbs: t.orbs.snapshot() })),
    };
  }
}
