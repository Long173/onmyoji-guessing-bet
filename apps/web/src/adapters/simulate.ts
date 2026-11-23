// adapters/simulate.ts — ★ 唯一允许接触 Engine 的模块
// UI-0：mock 实现（保证 UI 可独立开发）；UI-2：替换为真引擎，接口不变。
import type { GuessingMatch } from "../contracts/guessing-match.ts";
import type { SimulationOptions, SimulationResult, CoverageSnapshot, StrategySnapshot, SimulationWarning } from "../contracts/simulation-result.ts";
import type { ValidationReport, ReplayEvent, ReplayUnit } from "../contracts/worker-api.ts";

export interface SimulateAdapter {
  validate(match: GuessingMatch): Promise<ValidationReport>;
  simulate(match: GuessingMatch, options: SimulationOptions, onProgress: (p: { completed: number; total: number; redWins: number; blueWins: number; draws: number; timeouts: number; errors: number; elapsedMs: number }) => void, shouldCancel: () => boolean): Promise<SimulationResult>;
  replay(match: GuessingMatch, seed: number): Promise<{ events: ReplayEvent[]; units: ReplayUnit[]; turns: number; winner: "red" | "blue" | "draw" | "timeout" }>;
}

export const ENGINE_VERSION = "battle-lab 0.1-experimental";
export const GAME_DATA_VERSION = "2026-10-01";
