// kernel/environment.ts — ★★★ 第 109 轮：**全局 Environment**（a1-4.md §34）
//
// 规格 §34 给的是一张**容器**图，不是一套数值。两句原话决定了本文件的做法：
//   · 「以后残局机制就在这里」；
//   · 「如果 M2 最后证明：180 秒后每 X 秒 +Y% 伤害 —— 只实现 EnvironmentRule，**不污染式神**」。
//
// ⇒ 于是这一轮实现的是：容器 + 规则接口 + 档位机 + 档位对伤害/治疗的乘区 + 序列化 + 留痕，
//   而 `ENVIRONMENT_RULES` **是空表**。空表是**事实**、不是缺口：
//   规格把残局的数值留给 M2 验证，引擎在没有证据之前不许自己填一个「每 30 回合 +10%」。
//
// ★ 与「不污染式神」的对应关系（可以机械检查，见 tests/g65-environment.ts）：
//   全局乘区**不进 Entity.effects**、不产生状态、不占鬼火 —— 它只活在 battle.environment 里，
//   伤害/治疗在结算时读一眼。所以 `modifierSources()` 里永远不会出现 env 来源。

import { GOAL } from "./timeline.ts";

/**
 * 全局修改器。字段与 Entity.addModifier 的三元组**同名同义**（prop / value / mode / source），
 * 这样"式神身上的修改器"与"全局修改器"是同一套词汇，读代码的人不需要记两套。
 */
export interface GlobalModifier {
  prop: string;
  value: number;
  mode: "FIXED" | "ADD_RATE";
  /** ★ 必须带来源（与 Entity.addModifier 同一条纪律：无来源的改动不可回收、不可审计） */
  source: string;
}

/** 残局档位（规格 §34 的 stalemate）——**数值全部由规则给出**，引擎不预置任何数 */
export interface StalemateState { stage: number; damageMultiplier: number; healingMultiplier: number }

export interface EnvironmentState {
  /**
   * ★ 战斗时间：规格字段名是 `elapsedBattleTime`（例子里写「180 秒」）。
   *   本引擎是**离散事件**的（不按帧、没有墙钟，见目标 ⑨），所以这条时间轴的单位是**回合** ——
   *   `ENV_TIME_UNIT` 把这个事实写成一个常量，而不是悄悄按秒算（那会凭空造出一个不存在的时钟）。
   *   ★ 它是 `battle.turn` 的确定函数 ⇒ **不进档**（见 kernel/state.ts 的注），恢复时重算。
   */
  elapsedBattleTime: number;
  /**
   * ★ 规格留了 `round?`。引擎里**没有「回目」这个时间轴**（这一点在 g60 的反一木绵跳过记录里已经写过），
   *   所以这里保留字段但**不填** —— 填一个等于回合数的假"回目"就是编。
   */
  round?: number;
  globalModifiers: GlobalModifier[];
  stalemate?: StalemateState;
  /**
   * Betting endgame (policies.endgame = REFEREE_*): living shikigami that have taken a turn in the
   * current referee round. `round` above is then the number of completed referee rounds.
   * Absent unless that policy is on (default runs never set it).
   */
  refereeActed?: number[];
  /** Betting endgame with actionsPerRound = N: full turns taken since the last referee round (absent otherwise). */
  refereeActions?: number;
  /** Betting endgame with refereeSpeed: action-bar clock elapsed since the battle start (absent otherwise). */
  refereeClock?: number;
}

/** 战斗时间的单位：回合（★ 不是秒 —— 见 EnvironmentState.elapsedBattleTime 的注） */
export const ENV_TIME_UNIT = "TURN" as const;

export type EnvWhen = "BATTLE_START" | "TURN_START";

/**
 * 残局规则。规格原话就是「只实现 EnvironmentRule」—— 所以规则是**唯一**的数值入口。
 */
export interface EnvironmentRule {
  id: string;
  when: EnvWhen;
  /**
   * ★★★ 数据出处，**空字符串不许注册**（registerEnvironmentRule 会抛错）。
   *   理由与 compile/unmodeled.ts 同一条：没有出处的数值进引擎，就是"声明冒充实现"的另一种写法。
   */
  evidence: string;
  /**
   * 纯函数：给定环境与战斗，返回**要施加的改动**（不直接改状态）。
   *   · 便于审计（改了什么一眼可见）、便于测试（喂一个假环境就能跑）；
   *   · ★ 不许掷骰：环境不是随机源（RNG 账本只记战斗内的掷数，见 kernel/rng.ts）。
   *   返回 null 表示"这一档不生效"。
   */
  evaluate(env: EnvironmentState, battle: any): {
    stage?: number; damageMultiplier?: number; healingMultiplier?: number; modifiers?: GlobalModifier[];
  } | null;
}

/**
 * ★★★ 生产规则表：**空**。
 *
 * 这不是"还没做"，而是**这一层的诚实边界**：残局的数值（多少回合后、每档加多少）在规格里被写成
 * 「如果 M2 最后证明…」—— 也就是说它**还没有被证明**。填一个好看的数会让模拟看起来更"完整"，
 * 但那正是本项目反复拒绝的那类做法（把"能跑"包装成"真实"）。
 *
 * tests/g65-environment.ts 第 [2] 节把这条事实**双向钉住**：表为空 + 每条规则必须有出处。
 */
export const ENVIRONMENT_RULES: EnvironmentRule[] = [];

/** 注册一条规则（空出处 / 重复 id 直接抛错 —— 失败关闭，不静默忽略） */
export function registerEnvironmentRule(rule: EnvironmentRule): void {
  if (!rule.id) throw new Error("environment rule 必须有 id");
  if (!rule.evidence || !rule.evidence.trim()) {
    throw new Error("environment rule「" + rule.id + "」没有 evidence：没有出处的数值不许进引擎");
  }
  if (ENVIRONMENT_RULES.some(r => r.id === rule.id)) throw new Error("environment rule 重复注册：" + rule.id);
  ENVIRONMENT_RULES.push(rule);
}


export function createEnvironment(): EnvironmentState {
  return { elapsedBattleTime: 0, globalModifiers: [] };
}

/** 这个环境是不是"什么都没发生"（★ 序列化与状态指纹都按它决定收不收 —— 默认档不许漂） */
export function envIsDefault(env: EnvironmentState | null | undefined): boolean {
  if (!env) return true;
  return !env.stalemate && (env.globalModifiers ?? []).length === 0 && !env.round && !(env.refereeActed ?? []).length && !env.refereeActions
    && !env.refereeClock;
}

/** 非默认才返回（进档/进指纹时用；默认 ⇒ null ⇒ 老对局的指纹逐位不变） */
export function envSnapshot(env: EnvironmentState | null | undefined): EnvironmentState | null {
  if (envIsDefault(env)) return null;
  return {
    elapsedBattleTime: 0,   // ★ 派生量不进档（恢复时由 turn 重算）
    ...(env!.round ? { round: env!.round } : {}),
    globalModifiers: (env!.globalModifiers ?? []).map(m => ({ ...m })),
    ...(env!.stalemate ? { stalemate: { ...env!.stalemate } } : {}),
    ...((env!.refereeActed ?? []).length ? { refereeActed: env!.refereeActed!.slice() } : {}),
    ...(env!.refereeActions ? { refereeActions: env!.refereeActions } : {}),
    ...(env!.refereeClock ? { refereeClock: env!.refereeClock } : {}),
  };
}

export function envRestore(raw: EnvironmentState | null | undefined): EnvironmentState {
  const env = createEnvironment();
  if (!raw) return env;
  if (raw.round) env.round = raw.round;
  env.globalModifiers = (raw.globalModifiers ?? []).map(m => ({ ...m }));
  if (raw.stalemate) env.stalemate = { ...raw.stalemate };
  if ((raw.refereeActed ?? []).length) env.refereeActed = raw.refereeActed!.slice();
  if (raw.refereeActions) env.refereeActions = raw.refereeActions;
  if (raw.refereeClock) env.refereeClock = raw.refereeClock;
  return env;
}

/** 全局修改器（带来源、可审计；与 Entity.addModifier 同一套语义） */
export function addGlobalModifier(env: EnvironmentState, m: GlobalModifier): void {
  if (!m.source) throw new Error("全局修改器必须有 source");
  env.globalModifiers.push({ ...m });
}


/** 全局伤害乘区（没有档位 ⇒ 1 —— 默认档下与历史逐位相同） */
export function envDamageMultiplier(env: EnvironmentState | null | undefined): number {
  return env?.stalemate?.damageMultiplier ?? 1;
}

/** 全局治疗乘区（同上） */
export function envHealMultiplier(env: EnvironmentState | null | undefined): number {
  return env?.stalemate?.healingMultiplier ?? 1;
}

/**
 * 评估一档规则并施加改动。**只在真的有变化时留痕**（默认档下每回合都发一条会灌满 Theater）。
 *
 * ★ 留痕写在**档位变化**与**修改器增加**这两件事上，不是"每回合 tick 一次"：
 *   回放里看到的那条事件就是"环境变了"这一件事本身。
 */
/**
 * ★★★ 第 109 轮：**把知识库里已有的残局数据接进来** —— 这一层不需要别人再写代码。
 *
 * `GuessingRuleset.stalemate` 从第 0 轮起就摆在那里，三个参数（startTurn / damageRamp /
 * healingReductionRamp）**全是 null**，而它的注释写着「未实测，全为 null 表示禁止假设」。
 * 这正是本文件存在的意义：**容器先建好，数据一到就生效**。
 *
 * 判据（失败关闭，缺一样就不建规则）：
 *   · `startTurn === null` ⇒ **没有规则**（禁止假设，这就是今天的默认档）；
 *   · 两条曲线都缺 ⇒ 没有规则（一个只有开始时间、没有斜率的残局做不了任何事）；
 *   · 有开始时间 + 至少一条曲线 ⇒ 建一条规则，`evidence` **直接用 ruleset 自己的出处字段**。
 *
 * ★ 档位（stage）在这里只区分「未进入残局 0 / 已进入 1」：更细的分档要由数据自己给 ——
 *   规则接口允许返回任意 stage，引擎不替数据编一个「第 3 档」。
 * ★ 它是**纯函数**（只读 elapsedBattleTime），所以不进 RNG 账本，续跑/重放天然一致。
 */
export function stalemateRuleFromRuleset(rs: any): EnvironmentRule | null {
  const st = rs?.stalemate;
  if (!st) return null;
  if (st.startTurn === null || st.startTurn === undefined) return null;
  if (!st.damageRamp && !st.healingReductionRamp) return null;
  return {
    id: "ruleset:" + String(rs.id) + ":stalemate",
    when: "TURN_START",
    evidence: String(rs.evidence ?? "（规则集没有写出处）"),
    evaluate: (env: EnvironmentState) => {
      const t = Number(env.elapsedBattleTime ?? 0);
      if (!(t >= Number(st.startTurn))) return null;
      const dmg = st.damageRamp ? 1 + Number(st.damageRamp(t)) : 1;
      const heal = st.healingReductionRamp ? Math.max(0, 1 - Number(st.healingReductionRamp(t))) : 1;
      return { stage: 1, damageMultiplier: dmg, healingMultiplier: heal };
    },
  };
}

export function envTick(battle: any, when: EnvWhen): void {
  const env: EnvironmentState | undefined = battle?.environment;
  if (!env) return;
  if (when === "TURN_START") env.elapsedBattleTime = Number(battle.turn ?? 0);
  /** ★ 内置规则（来自 battle.policies.guessing 的残局数据）+ 显式注册的规则，走同一条施加路径 */
  const builtin = stalemateRuleFromRuleset(battle?.policies?.guessing);
  const rules = builtin ? [builtin, ...ENVIRONMENT_RULES] : ENVIRONMENT_RULES;
  for (const rule of rules) {
    if (rule.when !== when) continue;
    const out = rule.evaluate(env, battle);
    if (!out) continue;
    const before = env.stalemate?.stage ?? 0;
    if (out.stage !== undefined || out.damageMultiplier !== undefined || out.healingMultiplier !== undefined) {
      const next: StalemateState = {
        stage: out.stage ?? env.stalemate?.stage ?? 0,
        damageMultiplier: out.damageMultiplier ?? env.stalemate?.damageMultiplier ?? 1,
        healingMultiplier: out.healingMultiplier ?? env.stalemate?.healingMultiplier ?? 1,
      };
      const changed = !env.stalemate || env.stalemate.stage !== next.stage ||
        env.stalemate.damageMultiplier !== next.damageMultiplier || env.stalemate.healingMultiplier !== next.healingMultiplier;
      env.stalemate = next;
      if (changed) {
        battle.trace?.push?.({
          t: "ENV_STAGE", rule: rule.id, when, timeUnit: ENV_TIME_UNIT, at: env.elapsedBattleTime,
          stageBefore: before, stage: next.stage,
          damageMultiplier: next.damageMultiplier, healingMultiplier: next.healingMultiplier,
          evidence: rule.evidence,
        });
      }
    }
    for (const m of out.modifiers ?? []) {
      addGlobalModifier(env, m);
      battle.trace?.push?.({ t: "ENV_MODIFIER", rule: rule.id, when, prop: m.prop, value: m.value, mode: m.mode, source: m.source, evidence: rule.evidence });
    }
  }
}

/** 战斗时间推进（由 runTurn 调用；伪回合不推进 —— 反击不是"过了一个回合"） */
export function envAdvanceTurn(battle: any): void {
  const env: EnvironmentState | undefined = battle?.environment;
  if (!env) return;
  env.elapsedBattleTime = Number(battle.turn ?? 0);
}

// ───────────────────────── Betting endgame (policies.endgame, red zone I) ─────────────────────────
//
// Not an EnvironmentRule on purpose: rules are evaluated at TURN_START from elapsed turns, while the
// referee round is defined by who has acted (every living shikigami once). Both write the same
// stalemate multipliers, so damage (kernel/damage.ts envMul) and healing (envHeal, next to heal-down)
// read one place. Policy NONE ⇒ these functions return before touching anything.

interface EndgameLike {
  id: string; mode: string; damageStep: number; lateDamageStep: number; lateFromRound: number | null; healStep: number; timeout: string;
  actionsPerRound?: number | null;
  refereeSpeed?: number | null;
}

/** Damage multiplier after `rounds` completed referee rounds (additive stacking). */
export function refereeDamageMultiplier(p: EndgameLike, rounds: number): number {
  const late = p.lateFromRound == null ? Infinity : p.lateFromRound - 1;
  return 1 + p.damageStep * Math.min(rounds, late) + p.lateDamageStep * Math.max(0, rounds - late);
}

/** Healing multiplier after `rounds` completed referee rounds (never below 0). */
export function refereeHealMultiplier(p: EndgameLike, rounds: number): number {
  return Math.max(0, 1 - p.healStep * rounds);
}

/**
 * Called once after every full turn (runTurn). Completes a referee round when
 *   · refereeSpeed = v: the action-bar clock has reached the next k·GOAL/v (betting default, HYPOTHESIS; the clock
 *     itself advances in envRefereeClock);
 *   · actionsPerRound = N: N full turns have been taken since the last round (previous betting presets);
 *   · both null: all living shikigami have acted (the Arena wording).
 */
export function envRefereeAfterTurn(battle: any, actor: { id: number }): void {
  const p: EndgameLike | undefined = battle?.policies?.endgame;
  if (!p || p.mode !== "REFEREE_ROUNDS") return;
  const env: EnvironmentState | undefined = battle?.environment;
  if (!env || !actor) return;
  if (p.refereeSpeed) { completeClockRounds(battle, env, p, true); return; }
  if (p.actionsPerRound) {
    const n = (env.refereeActions ?? 0) + 1;
    if (n < p.actionsPerRound) { env.refereeActions = n; return; }
    delete env.refereeActions;
    completeRefereeRound(battle, env, p);
    return;
  }
  const acted = new Set<number>(env.refereeActed ?? []);
  acted.add(actor.id);
  const alive: Array<{ id: number }> = [...battle.teams[0].aliveMembers(), ...battle.teams[1].aliveMembers()];
  if (!alive.length || !alive.every(e => acted.has(e.id))) {
    env.refereeActed = [...acted].sort((a, b) => a - b);
    return;
  }
  env.refereeActed = [];
  completeRefereeRound(battle, env, p);
}

const CLOCK_EPS = 1e-6;
/** Clock time at which referee round `round` fires (refereeSpeed presets). */
export function refereeRoundTime(p: EndgameLike, round: number): number {
  return round * GOAL / Number(p.refereeSpeed);
}

/**
 * refereeSpeed presets: called right after the action bar advanced (Battle.run / runPartial), with the clock time
 * that advance moved. Rounds whose time has strictly passed fire BEFORE the arriving unit's turn; a round at exactly
 * the arrival time waits until that turn ends (envRefereeAfterTurn) — ties go to the unit. No-op otherwise.
 */
export function envRefereeClock(battle: any, dt: number): void {
  const p: EndgameLike | undefined = battle?.policies?.endgame;
  if (!p || p.mode !== "REFEREE_ROUNDS" || !p.refereeSpeed) return;
  const env: EnvironmentState | undefined = battle?.environment;
  if (!env || !(dt > 0)) return;
  env.refereeClock = (env.refereeClock ?? 0) + dt;
  completeClockRounds(battle, env, p, false);
}

function completeClockRounds(battle: any, env: EnvironmentState, p: EndgameLike, inclusive: boolean): void {
  const clock = env.refereeClock ?? 0;
  for (let guard = 0; guard < 1000; guard++) {
    const at = refereeRoundTime(p, (env.round ?? 0) + 1);
    if (inclusive ? clock < at - CLOCK_EPS : clock <= at + CLOCK_EPS) return;
    completeRefereeRound(battle, env, p);
  }
}

function completeRefereeRound(battle: any, env: EnvironmentState, p: EndgameLike): void {
  const round = (env.round ?? 0) + 1;
  const before = env.stalemate?.stage ?? 0;
  env.round = round;
  env.stalemate = { stage: round, damageMultiplier: refereeDamageMultiplier(p, round), healingMultiplier: refereeHealMultiplier(p, round) };
  battle.trace?.push?.({
    t: "REFEREE_ROUND", policy: p.id, round, stageBefore: before, turn: Number(battle.turn ?? 0),
    damageMultiplier: env.stalemate.damageMultiplier, healingMultiplier: env.stalemate.healingMultiplier,
  });
}

export interface TimeoutVerdict { winner: 0 | 1 | null; reason: "TIMEOUT_ALIVE" | "TIMEOUT_HP" | "TIMEOUT_DRAW"; alive: [number, number]; hpPct: [number, number] }

/** Team remaining HP% = Σ hp / Σ max HP over the shikigami that count for victory (the fallen count as 0). */
function teamHpPct(team: any): number {
  let hp = 0, max = 0;
  for (const m of team.members ?? []) {
    if (m?.caps && m.caps.countsForVictory === false) continue;
    max += Number(m.maxHp) || 0;
    if (m.alive) hp += Math.max(0, Number(m.hp) || 0);
  }
  return max > 0 ? hp / max : 0;
}

/** Turn-cap verdict under policies.endgame.timeout = ALIVE_THEN_HP (null for any other policy). */
export function timeoutVerdict(battle: any): TimeoutVerdict | null {
  const p: EndgameLike | undefined = battle?.policies?.endgame;
  if (!p || p.timeout !== "ALIVE_THEN_HP") return null;
  const alive: [number, number] = [battle.teams[0].victoryCount(), battle.teams[1].victoryCount()];
  const hpPct: [number, number] = [teamHpPct(battle.teams[0]), teamHpPct(battle.teams[1])];
  if (alive[0] !== alive[1]) return { winner: alive[0] > alive[1] ? 0 : 1, reason: "TIMEOUT_ALIVE", alive, hpPct };
  if (hpPct[0] !== hpPct[1]) return { winner: hpPct[0] > hpPct[1] ? 0 : 1, reason: "TIMEOUT_HP", alive, hpPct };
  return { winner: null, reason: "TIMEOUT_DRAW", alive, hpPct };
}
