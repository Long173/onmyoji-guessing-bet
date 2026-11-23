// stores/simulation.ts — 只持有 DTO 与 Worker 句柄，不持有任何 Engine 对象
import { defineStore } from "pinia";
/**
 * ★★★ 第 256 轮：**replay 文件必须是"生"的**（markRaw）。
 *
 * 用户实测（错误条抓到的原话）：`Failed to execute 'structuredClone' on 'Window': #<Object> could not be cloned.`
 * 根因：这份 replay 存进 Pinia state ⇒ Vue 把它包成**响应式代理**；而引擎的 replay/snapshot 用
 * `structuredClone` 复制状态帧 —— **代理不能被结构化克隆** ⇒ 剧场一渲染就抛。
 * Node 里的测试传的是原始对象，所以三种探针全绿（这是"测试路径与浏览器路径不是同一条"的典型）。
 * 逐字复现见 tools/_probe-reactive256.ts：reactive(replay) ⇒ 抛；markRaw / toRaw ⇒ 不抛。
 */
import { markRaw } from "vue";
import type { GuessingMatch } from "../contracts/guessing-match.ts";
import type { SimulationOptions, SimulationResult } from "../contracts/simulation-result.ts";
import type { WorkerRequest, WorkerResponse, ValidationReport, ReplayEvent, ReplayUnit, SimulationProgress } from "../contracts/worker-api.ts";

export const useSimulationStore = defineStore("simulation", {
  state: () => ({
    worker: null as Worker | null,
    requestId: null as string | null,
    running: false,
    progress: null as SimulationProgress | null,
    result: null as SimulationResult | null,
    validation: null as ValidationReport | null,
    error: null as string | null,
    // ★ 不能叫 replay：Pinia 的 state 与 action 共用命名空间，
    // 一旦 state 里有同名属性，this.replay = {...} 会**覆盖掉 action 函数**，
    // 之后 sim.replay(match, seed) 就不可调用了（vue-tsc 会直接报 "not callable"）。
    replayData: null as { seed: number; events: ReplayEvent[]; units: ReplayUnit[]; turns: number; winner: string } | null,
    /** ★ G4：完整 Replay 文件（Battle Theater 用它做到任意帧重建战场） */
    replayFile: null as unknown | null,
    /**
     * ★★★ 第 256 轮：**录像进行中**。
     *   用户实测报的问题：点「观看战斗」只切了视图 —— 没录过录像时就只看到「还没有可观看的战斗。」
     *   （看起来就是"观看不了"）。现在那个入口会**当场录一场**，而录制要时间 ⇒ 必须有个"正在录"的状态，
     *   否则那 100ms 里界面仍然像坏的。这个标志位同时是"失败也要清掉"的（不许永远转圈）。
     */
    replayPending: false as boolean,
  }),
  getters: {
    percent(s): number { return s.progress ? Math.round((s.progress.completed / Math.max(1, s.progress.total)) * 100) : 0; },
  },
  actions: {
    ensureWorker() {
      if (this.worker) return this.worker;
      const w = new Worker(new URL("../workers/simulation.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
      w.onerror = (e) => { this.error = String((e as any).message ?? e); this.running = false; };
      this.worker = w;
      return w;
    },
    send(req: WorkerRequest) { this.ensureWorker().postMessage(req); },
    newId() { return "req" + Math.random().toString(36).slice(2, 10); },

    onMessage(msg: WorkerResponse) {
      switch (msg.type) {
        case "VALIDATION_READY": if (msg.requestId === this.requestId) this.validation = msg.report; break;
        case "SIMULATION_STARTED": this.running = true; this.error = null; break;
        case "SIMULATION_PROGRESS": if (msg.requestId === this.requestId) this.progress = msg.progress; break;
        case "SIMULATION_COMPLETED": if (msg.requestId === this.requestId) { this.result = msg.result; this.running = false; this.progress = null; } break;
        /** ★ 第 256 轮：失败与取消也要把 replayPending 清掉（否则那个"正在录"的提示会永远转下去） */
        case "SIMULATION_FAILED": if (msg.requestId === this.requestId) { this.replayPending = false; this.error = msg.message === "Cancelled" ? null : msg.message; this.running = false; this.progress = null; } break;
        case "REPLAY_PREPARED": if (msg.requestId === this.requestId) {
          /** ★ 第 256 轮：两样都 markRaw —— 它们是**数据大块**，既不参与响应式，也绝不能被包成代理 */
          this.replayData = markRaw({ seed: msg.seed, events: msg.events, units: msg.units, turns: msg.turns, winner: msg.winner });
          this.replayFile = markRaw((msg as any).replay ?? null);
          this.replayPending = false;   // ★ 第 256 轮：录制结束（成功）
        } break;
      }
    },

    validate(match: GuessingMatch) {
      const requestId = this.newId();
      this.requestId = requestId;
      this.send({ type: "VALIDATE", requestId, match: JSON.parse(JSON.stringify(match)) });
    },
    simulate(match: GuessingMatch, options: SimulationOptions) {
      const requestId = this.newId();
      this.requestId = requestId;
      this.result = null; this.progress = null; this.error = null;
      this.send({ type: "SIMULATE", requestId, match: JSON.parse(JSON.stringify(match)), options });
    },
    cancel() { if (this.requestId) this.send({ type: "CANCEL", requestId: this.requestId }); },
    replay(match: GuessingMatch, seed: number) {
      const requestId = this.newId();
      this.requestId = requestId;
      this.replayPending = true;
      this.send({ type: "REPLAY", requestId, match: JSON.parse(JSON.stringify(match)), seed });
    },
    /**
     * ★★★ 第 256 轮：**「观看战斗」这个入口收成一个动作** —— 有录像就只切视图（不重复录），
     *   没录像就**当场录一场**（用传入的 seed）。
     *
     * 为什么放在 store 里而不是 <script setup> 里：本仓库没有 jsdom / @vue/test-utils，
     *   逻辑留在组件里就等于**没有验收** —— 这正是第 137 轮把播放控制搬进 transport.ts 的同一条教训
     *   （见报告 §106 与 tests/ui14-transport.ts 的文件头）。
     */
    watchOrReplay(match: GuessingMatch, seed: number): "reused" | "recording" {
      if (this.replayFile) return "reused";
      this.replay(match, seed);
      return "recording";
    },
  },
});
