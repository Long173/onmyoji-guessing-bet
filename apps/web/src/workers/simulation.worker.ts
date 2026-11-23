// workers/simulation.worker.ts — 模拟 Worker（只剩线程胶水；协议逻辑在 protocol.ts）
// UI-2：真引擎适配器（mock 保留在 adapters/mock-adapter.ts 供离线 UI 开发）。
// ★ 对外协议一字不改：主线程永远只看到 DTO。
import { createProtocol } from "./protocol.ts";
import { createEngineAdapter } from "../adapters/engine-adapter.ts";
import type { WorkerRequest } from "../contracts/worker-api.ts";
import bundle from "../engine/bundle.json";
import { setSkillLevelMode } from "@engine/compile/max-level.ts";

// The betting mode uses max skill levels (regression tests import the adapter directly and keep BASE).
setSkillLevelMode("MAX");

const protocol = createProtocol(createEngineAdapter(bundle as any), (m) => (self as any).postMessage(m));

self.onmessage = (e: MessageEvent<WorkerRequest>) => { void protocol.handle(e.data); };
