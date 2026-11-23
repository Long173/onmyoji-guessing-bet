// contracts/worker-api.ts — ★ Worker API（冻结，UI 永远不知道 Battle 内部实现）
import type { GuessingMatch } from "./guessing-match.ts";
import type { SimulationOptions, SimulationResult, CoverageSnapshot, StrategySnapshot, SimulationWarning } from "./simulation-result.ts";

export interface SimulationProgress {
  completed: number;
  total: number;
  redWins: number;
  blueWins: number;
  draws: number;
  timeouts: number;
  errors: number;
  /** 当前滚动估计（可能为 null，样本不足时不假装有值） */
  runningRedWinRate: number | null;
  runningCI: { low: number; high: number } | null;
  elapsedMs: number;
}

export interface SimulationStarted {
  type: "SIMULATION_STARTED";
  requestId: string;
  startedAt: string;
}

export interface SimulationProgressMsg {
  type: "SIMULATION_PROGRESS";
  requestId: string;
  progress: SimulationProgress;
}

export interface SimulationCompleted {
  type: "SIMULATION_COMPLETED";
  requestId: string;
  result: SimulationResult;
}

export interface SimulationFailed {
  type: "SIMULATION_FAILED";
  requestId: string;
  message: string;
  detail?: string;
}

export interface ValidationReport {
  ok: boolean;
  blockers: string[];
  warnings: SimulationWarning[];
  coverage: CoverageSnapshot;
  strategySnapshot: StrategySnapshot;
  /**
   * ★ Per-Match Fidelity（a1-4 §1-§10）：五层各自给**非评价性状态分类**，
   * 绝不合成"真实性百分比"。阵容编辑器在跑之前就能看到它（§33）。
   */
  fidelity?: unknown;
  /**
   * Per-unit support as the battle really runs it (unit tiles: AI / Soul dots). Betting mode counts
   * hand-written betting AI rules and hand-written soul installers; absent = engine validation not run.
   */
  units?: UnitSupport[];
}

export interface UnitSupport {
  side: "red" | "blue";
  name: string;
  ai: { confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE"; handWritten: string | null };
  soul: { id: number; support: "FULL" | "PARTIAL" | "UNSUPPORTED"; custom: boolean; note: string } | null;
}

export interface ValidationReady {
  type: "VALIDATION_READY";
  requestId: string;
  report: ValidationReport;
}

export interface ReplayPrepared {
  type: "REPLAY_PREPARED";
  requestId: string;
  seed: number;
  /** 事件流（已序列化，UI 只做展示与步进） */
  events: ReplayEvent[];
  units: ReplayUnit[];
  turns: number;
  winner: "red" | "blue" | "draw" | "timeout";
  /**
   * ★ G4：完整 Replay 文件（帧流 + 事件链 + Checkpoint/Delta + 终局状态）。
   * Battle Theater 靠它做到"任意帧可重建战场"——**不需要**再跑一遍引擎。
   * 旧客户端可以忽略这个字段（加法式扩展，不改变已有语义）。
   */
  replay?: unknown;
}

export interface ReplayUnit {
  unitId: string; side: "red" | "blue"; name: string; maxHp: number;
}
export interface ReplayEvent {
  index: number;
  turn: number;
  code: string;
  actorUnitId?: string;
  targetUnitId?: string;
  text: string;
  /** 展示用的结构化 detail（Event Inspector 用） */
  detail?: Record<string, unknown>;
  /** 该事件发生后的快照（用于步进时还原血条/行动条） */
  snapshot?: Record<string, unknown>;
}

export type WorkerRequest =
  | { type: "VALIDATE"; requestId: string; match: GuessingMatch }
  | { type: "SIMULATE"; requestId: string; match: GuessingMatch; options: SimulationOptions }
  | { type: "CANCEL"; requestId: string }
  | { type: "REPLAY"; requestId: string; match: GuessingMatch; seed: number }
  | { type: "PING"; requestId: string };

export type WorkerResponse =
  | SimulationStarted | SimulationProgressMsg | SimulationCompleted | SimulationFailed
  | ValidationReady | ReplayPrepared
  | { type: "PONG"; requestId: string };
