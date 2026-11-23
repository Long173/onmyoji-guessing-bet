// workers/protocol.ts — Worker 消息协议的**全部逻辑**（与线程绑定无关）
// 抽出来的理由：协议必须在 Node 里可测。simulation.worker.ts 只剩三行胶水，
// 于是「VALIDATE/SIMULATE/CANCEL/REPLAY 的消息语义」可以脱离浏览器被完整验证。
import type { SimulateAdapter } from "../adapters/simulate.ts";
import type { WorkerRequest, WorkerResponse } from "../contracts/worker-api.ts";

export interface Protocol {
  handle(req: WorkerRequest): Promise<void>;
  /** 已取消的请求 id（测试可读） */
  cancelled: Set<string>;
}

export function createProtocol(adapter: SimulateAdapter, post: (m: WorkerResponse) => void): Protocol {
  const cancelled = new Set<string>();
  const startedAt = new Map<string, number>();

  function progressSink(requestId: string, total: number) {
    return (p: { completed: number; total: number; redWins: number; blueWins: number; draws: number; timeouts: number; errors: number; elapsedMs: number }) => {
      const eta = p.elapsedMs > 0 ? Math.round((p.elapsedMs / Math.max(1, p.completed)) * (total - p.completed)) : null;
      const decisive = p.redWins + p.blueWins;
      post({
        type: "SIMULATION_PROGRESS", requestId,
        progress: {
          completed: p.completed, total, redWins: p.redWins, blueWins: p.blueWins,
          draws: p.draws, timeouts: p.timeouts, errors: p.errors,
          runningRedWinRate: decisive > 0 ? p.redWins / decisive : null,
          runningCI: null,
          elapsedMs: p.elapsedMs, ...(eta !== null ? { etaMs: eta } : {}),
        },
      } as any);
    };
  }

  async function handle(req: WorkerRequest): Promise<void> {
    try {
      switch (req.type) {
        case "PING":
          post({ type: "PONG", requestId: req.requestId });
          return;
        case "VALIDATE": {
          const report = await adapter.validate(req.match);
          post({ type: "VALIDATION_READY", requestId: req.requestId, report });
          return;
        }
        case "CANCEL":
          cancelled.add(req.requestId);
          return;
        case "SIMULATE": {
          cancelled.delete(req.requestId);
          startedAt.set(req.requestId, Date.now());
          post({ type: "SIMULATION_STARTED", requestId: req.requestId, startedAt: new Date().toISOString() });
          const result = await adapter.simulate(
            req.match, req.options,
            progressSink(req.requestId, req.options.simulations),
            () => cancelled.has(req.requestId),
          );
          if (cancelled.has(req.requestId)) post({ type: "SIMULATION_FAILED", requestId: req.requestId, message: "Cancelled" });
          else post({ type: "SIMULATION_COMPLETED", requestId: req.requestId, result });
          cancelled.delete(req.requestId);
          return;
        }
        case "REPLAY": {
          const r = await adapter.replay(req.match, req.seed);
          post({ type: "REPLAY_PREPARED", requestId: req.requestId, seed: req.seed, ...r });
          return;
        }
      }
    } catch (err: any) {
      post({ type: "SIMULATION_FAILED", requestId: (req as any).requestId, message: String(err?.message ?? err), detail: String(err?.stack ?? "") });
    }
  }

  return { handle, cancelled };
}
