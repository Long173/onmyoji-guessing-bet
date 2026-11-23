// contracts/simulation-result.ts — ★ 结果契约（冻结）
// UI 不需要自己重算任何东西；这里没有的字段就是引擎没提供。
import type { GuessingStats } from "./guessing-match.ts";

export interface WilsonInterval {
  method: "WILSON";
  level: number;      // 0.95
  low: number;
  high: number;
}

export interface AggregateBattleStats {
  avgTurns: number;
  medianTurns: number;
  p95Turns: number;
  firstKillRedRate: number | null;
  avgSurvivorsRed: number;
  avgSurvivorsBlue: number;
  avgRemainHpRed: number;
  avgRemainHpBlue: number;
  avgOrbSpentRed: number;
  avgOrbSpentBlue: number;
  /** 每只式神的聚合贡献（按 unitId 索引） */
  perUnit: PerUnitStats[];
}

export interface PerUnitStats {
  unitId: string;
  name: string;
  side: "red" | "blue";
  avgDamageDealt: number;
  avgDamageTaken: number;
  avgHealing: number;
  kills: number;
  deaths: number;
  deathRate: number;
  avgActions: number;
  skillUsage: Record<string, number>;
  soulTriggerCount: number;
  controlApplied: number;
  controlResisted: number;
}

/** 机制策略快照：与结果一起永久保存 */
export interface StrategySnapshot {
  startup: { id: string; status: "UNKNOWN" | "HYPOTHESIS" | "VERIFIED" };
  triggerPriority: { id: string; status: "UNKNOWN" | "HYPOTHESIS" | "VERIFIED" };
  death: { id: string; status: "UNKNOWN" | "HYPOTHESIS" | "VERIFIED" };
  /** Rule that decides stalls / the turn cap: policies.endgame in betting (MAX) mode, else the guessing ruleset */
  endgame: { id: string; status: "UNKNOWN" | "HYPOTHESIS" | "VERIFIED"; note?: string };
  resource: { id: string; status: "UNKNOWN" | "HYPOTHESIS" | "VERIFIED" };
  /** Betting (MAX) mode only: real max HP = Lineup HP × value (compile/betting-policies.ts BETTING_HP_SCALE_RULE) */
  hpScale?: { id: string; status: "UNKNOWN" | "HYPOTHESIS" | "VERIFIED"; value: number; note: string };
  unknownCount: number;
}

export interface CoverageSnapshot {
  unitsJoined: number; unitsTotal: number;
  skillsAvailable: number; skillsTotal: number;
  aiHigh: number; aiTotal: number;
  soulsResolved: number; soulsTotal: number;
  soulEffectsFull: number; soulEffectsPartial: number;
  /** Betting (MAX) mode: units whose skill choice is a hand-written betting rule (counted in aiHigh) */
  aiHandWritten?: number;
  /** Betting (MAX) mode: souls run by a hand-written installer (counted in soulEffectsFull) */
  soulEffectsCustom?: number;
  /** Per-row explanation for the readiness panel (English) */
  notes?: { ai?: string; souls?: string; policies?: string };
  unknownBuffRefs: string[];
  unsupportedCapabilities: string[];
}

export const WarningKind = {
  UNKNOWN_STRATEGY: "UNKNOWN_STRATEGY",
  LOW_AI_CONFIDENCE: "LOW_AI_CONFIDENCE",
  SOUL_EFFECT_UNSUPPORTED: "SOUL_EFFECT_UNSUPPORTED",
  UNKNOWN_BUFF_REF: "UNKNOWN_BUFF_REF",
  HIGH_STALL_RATE: "HIGH_STALL_RATE",
  SMALL_SAMPLE: "SMALL_SAMPLE",
  MODEL_SENSITIVE: "MODEL_SENSITIVE",
  DATA_MISSING: "DATA_MISSING",
} as const;
export type WarningKind = (typeof WarningKind)[keyof typeof WarningKind];

export interface SimulationWarning {
  kind: WarningKind;
  severity: "INFO" | "WARN" | "BLOCK";
  message: string;
  detail?: string;
}

/** 模型不确定性：与 Monte Carlo 抽样误差**严格分开** */
export interface ModelUncertainty {
  /** 各候选策略下的红胜率 */
  perStrategy: Array<{ label: string; group: "STARTUP" | "TRIGGER" | "DEATH" | "ENDGAME" | "TURN_LIMIT"; redWinRate: number | null; note?: string }>;
  min: number | null;
  max: number | null;
  /** max - min，即"结论会不会因为未知机制而翻转" */
  spread: number | null;
  verdict: "STABLE" | "SENSITIVE" | "INCONCLUSIVE";
}

export interface SimulationOptions {
  simulations: number;
  seed: number | "AUTO";
  /** 覆盖默认策略（用于策略敏感性） */
  strategyOverrides?: Record<string, string>;
  maxTurns?: number;
  /** 进度回调批次 */
  progressEvery?: number;
}

export interface RepresentativeSeed {
  seed: number;
  winner: "red" | "blue" | "draw" | "timeout";
  turns: number;
  label?: string;
}

export interface SimulationResult {
  schemaVersion: 1;
  resultId: string;
  matchId: string;

  simulations: number;
  redWins: number;
  blueWins: number;
  draws: number;
  timeouts: number;
  errors: number;
  /** 分母口径：只含有效局，errors 永不进入 */
  decisive: number;

  redWinRate: number | null;
  blueWinRate: number | null;
  confidenceInterval: WilsonInterval | null;
  blueConfidenceInterval: WilsonInterval | null;

  battleStats: AggregateBattleStats;
  strategySnapshot: StrategySnapshot;
  modelUncertainty: ModelUncertainty | null;
  coverage: CoverageSnapshot;
  warnings: SimulationWarning[];

  engineVersion: string;
  gameDataVersion: string;
  createdAt: string;

  seeds?: RepresentativeSeed[];
}

export function isConclusionReady(r: SimulationResult): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.strategySnapshot.unknownCount > 0) reasons.push(`${r.strategySnapshot.unknownCount} UNKNOWN mechanic policies in use`);
  if (r.decisive < 1000) reasons.push(`Only ${r.decisive} decisive battles`);
  if (r.timeouts / Math.max(1, r.simulations) > 0.2) reasons.push("Timeout rate > 20%");
  if (r.errors > 0) reasons.push(`${r.errors} battle(s) errored`);
  return { ready: reasons.length === 0, reasons };
}
