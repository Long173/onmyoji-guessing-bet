// kernel/replay.ts — ★ G3：Full Battle Replay（a1-4.md §36/§38/§40/§41）
//
// 文档的三条硬要求：
//   §36 Replay **不应该是 Engine 第二次执行** —— 播放只读文件，不再跑一遍战斗
//   §38 一场战斗要能完整保存
//   §40/§41 Replay determinism：同一 seed 的录像必须逐帧可比；headless 与 Theater 结果一致
//
// 文件内容 = 事件流（frames）+ Checkpoint/Delta（可重建任意帧）+ 事件链 + 终局状态指纹。
// 播放任意帧 = stateAt(frame)，不需要引擎参与。
import { stateHash } from "./state.ts";
import type { BattleState } from "./state.ts";
import type { EventNode } from "./events.ts";
import type { Checkpoint, DeltaOp, FrameDelta, PackedOp, SnapshotRecorder } from "./snapshot.ts";
import { applyDelta, applyPackedDelta, expandPacked, packDeltas } from "./snapshot.ts";

/**
 * ★ §103 版本 2：Delta 多了路径字典编码（PATH_V1）。**读老文件的能力必须保留** ——
 * loadReplay 接受 1 与 2：v1 文件里的 op 一律自带 path 数组（那时还没有 PATH_V1）。
 */
export const REPLAY_SCHEMA_VERSION = 2;

export interface ReplayFrame {
  frame: number;
  turn?: number;
  t: string;
  ev: number | null;
  depth: number;
  [k: string]: any;
}

export interface ReplayResult { winner: 0 | 1 | null; turns: number; reason: string }

export interface ReplayFile {
  /** 1 = 只有 PLAIN op（老文件）；2 = 带 deltaCodec/deltaPaths */
  schemaVersion: 1 | 2;
  createdAt: string;
  engineVersion: string;
  gameDataVersion: string;
  /** 这一场是怎么来的（可复现的前提） */
  match: { id: string; seed: number; maxTurns: number; policyIds: Record<string, string>; red: string[]; blue: string[] };
  frames: ReplayFrame[];
  /**
   * ★★★ 第 191 轮：**每一帧那一刻引擎状态的指纹**（与 frames 同下标）。
   *   有它 ⇒ verify 能逐帧比对（Frame N state == 引擎在第 N 帧的状态），而不只是终局那一帧。
   *   老文件没有这个键 —— verify 会**如实说**自己只验到哪一档，不装作验过。
   */
  frameHashes?: string[];
  /** 事件链（Parent/Root），Inspector 用 */
  events: EventNode[];
  checkpoints: Checkpoint[];
  /**
   * ★ §103：Delta 的编码格式。
   *   "PLAIN"  = 每个 op 自带完整 path 数组（老文件，永远读得动）
   *   "PATH_V1"= 文件级 deltaPaths 字典 + 元组 op（默认，体积小得多，语义相同）
   * 缺省视为 PLAIN —— 兼容改动之前生成的录像文件。
   */
  deltaCodec?: "PLAIN" | "PATH_V1";
  /** PATH_V1 的路径字典（去重后只写一次）。op[0] 是它的下标。 */
  deltaPaths?: Array<Array<string | number>>;
  /** ops 的具体形状由 deltaCodec 决定：PLAIN → DeltaOp[]；PATH_V1 → PackedOp[] */
  deltas: FrameDelta[];
  /** 终局状态 + 指纹：用于"Frame N state == Engine final state"的比对 */
  finalState: BattleState;
  finalHash: string;
  result: ReplayResult;
  /** ★ G5/§20：本场全部随机数抽数与用途标签（RNG Inspector 的数据源） */
  rng?: { seed: number; total: number; draws: Array<{ n: number; v: number; tag: string }> };
}

export interface BuildReplayMeta {
  engineVersion: string;
  gameDataVersion: string;
  matchId: string;
  seed: number;
  maxTurns: number;
  policyIds: Record<string, string>;
  red: string[];
  blue: string[];
}

/**
 * 从一场刚跑完（FULL 档）的战斗 + 记录器打包成 Replay 文件。
 * opts.deltaCodec 默认 PATH_V1（路径字典）；传 "PLAIN" 可拿到逐 op 自带 path 的老格式，
 * 两种格式在 ReplayPlayer 里读法不同但**重建结果逐帧相同**（tests/g74 双向断言）。
 */
export function buildReplay(battle: any, rec: SnapshotRecorder, meta: BuildReplayMeta, finalState: BattleState, result: ReplayResult, opts: { deltaCodec?: "PLAIN" | "PATH_V1" } = {}): ReplayFile {
  const codec = opts.deltaCodec ?? "PATH_V1";
  const packed = codec === "PATH_V1" ? packDeltas(rec.deltas) : null;
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    engineVersion: meta.engineVersion,
    gameDataVersion: meta.gameDataVersion,
    match: {
      id: meta.matchId, seed: meta.seed, maxTurns: meta.maxTurns,
      policyIds: meta.policyIds, red: meta.red, blue: meta.blue,
    },
    frames: battle.trace.map((e: any) => ({ ...e })),
    events: battle.bus.chain.map((n: any) => ({ ...n, children: [...n.children] })),
    checkpoints: rec.checkpoints,
    /** ★★★ 第 191 轮：逐帧引擎状态指纹（与 frames 同下标）—— verify 靠它把「逐帧回放」验到每一帧 */
    ...(rec.hashes.length ? { frameHashes: rec.hashes.slice() } : {}),
    deltaCodec: codec,
    ...(packed ? { deltaPaths: packed.paths } : {}),
    deltas: packed ? packed.frames.map(f => ({ frame: f.frame, ops: f.ops as any, bytes: f.bytes })) : rec.deltas,
    finalState,
    finalHash: stateHash(finalState),
    result,
    rng: { seed: meta.seed, total: battle.rng.draws.length, draws: battle.rng.draws.map((d: any) => ({ n: d.n, v: d.v, tag: d.tag ?? "unlabeled" })) },
  };
}

/** 解析 Replay 文件（只做形状校验，不做业务解释） */
export function loadReplay(json: string | object): ReplayFile {
  const f = typeof json === "string" ? JSON.parse(json) : json;
  if (!f || (f.schemaVersion !== 1 && f.schemaVersion !== REPLAY_SCHEMA_VERSION)) throw new Error("Replay 文件版本不匹配：" + (f && f.schemaVersion));
  if (!Array.isArray(f.frames) || !Array.isArray(f.checkpoints)) throw new Error("Replay 文件缺 frames/checkpoints");
  // v1 文件里不可能有 PATH_V1 op；缺省一律按 PLAIN 读（这是"老录像还能放"的唯一依据）
  if (f.deltaCodec !== "PATH_V1") f.deltaCodec = "PLAIN";
  if (f.deltaCodec === "PATH_V1" && !Array.isArray(f.deltaPaths)) throw new Error("Replay 文件声明 PATH_V1 却没有 deltaPaths 字典");
  return f as ReplayFile;
}

/** ★ §103：把文件里的 Delta 还原成"逐 op 自带 path"的形式（审计 / 比对 / 测试用） */
export function plainDeltas(file: ReplayFile): FrameDelta[] {
  if (file.deltaCodec !== "PATH_V1") return file.deltas;
  const paths = file.deltaPaths ?? [];
  return file.deltas.map(d => ({ frame: d.frame, bytes: d.bytes, ops: expandPacked(d.ops as unknown as PackedOp[], paths) }));
}

/** 应用一帧 Delta（唯一分派点：两种编码都在这里走同一套 applyDelta 语义） */
export function applyFrameDelta(state: BattleState, file: ReplayFile, d: FrameDelta): BattleState {
  return file.deltaCodec === "PATH_V1"
    ? applyPackedDelta(state, d.ops as unknown as PackedOp[], file.deltaPaths ?? [])
    : applyDelta(state, d.ops as DeltaOp[]);
}

/** 序列化：不带缩进（10k 局的录像要能塞进磁盘），但保留一切信息 */
export function serializeReplay(f: ReplayFile): string { return JSON.stringify(f); }

/**
 * ★ 纯播放器：**不碰引擎**。任意帧的战场状态由 Checkpoint + Delta 重建，
 * 事件文案由 frames 提供。这就是 §36 要的"回放不是第二次执行"。
 */
export class ReplayPlayer {
  readonly file: ReplayFile;
  private cache = new Map<number, BattleState>();
  constructor(file: ReplayFile) { this.file = file; }

  get frameCount(): number { return this.frames.length; }
  get frames(): ReplayFrame[] { return this.file.frames; }
  get result(): ReplayResult { return this.file.result; }
  /** 实际记录到的最后一帧（含终局补记帧） */
  get lastFrame(): number { return this.file.checkpoints.length && this.file.deltas.length ? Math.max(this.file.deltas[this.file.deltas.length - 1].frame, this.file.checkpoints[this.file.checkpoints.length - 1].frame) : (this.file.checkpoints[0]?.frame ?? 0); }

  frame(i: number): ReplayFrame | null { return this.frames[i] ?? null; }

  /** 任意帧的战场状态（纯数据，无引擎） */
  stateAt(frame: number): BattleState | null {
    const hit = this.cache.get(frame);
    if (hit) return hit;
    let cp: Checkpoint | null = null;
    for (const c of this.file.checkpoints) { if (c.frame <= frame) cp = c; else break; }
    if (!cp) return null;
    let state = structuredClone(cp.state);
    for (const d of this.file.deltas) {
      if (d.frame <= cp.frame) continue;
      if (d.frame > frame) break;
      state = applyFrameDelta(state, this.file, d);
    }
    this.cache.set(frame, state);
    return state;
  }

  /** 事件链回溯（Inspector 用）：从某帧回溯到根 */
  ancestryOfFrame(frameIndex: number): EventNode[] {
    const fr = this.frames[frameIndex];
    if (!fr || fr.ev === null || fr.ev === undefined) return [];
    const bySeq = new Map(this.file.events.map(e => [e.seq, e]));
    const out: EventNode[] = [];
    let cur = bySeq.get(fr.ev);
    let guard = 0;
    while (cur && guard++ < 256) { out.push(cur); cur = cur.parent === null ? undefined : bySeq.get(cur.parent); }
    return out.reverse();
  }
}

// 与 kernel/snapshot.ts 的 applyDelta 相同语义，但这里不 import 它以免把记录器拖进播放路径
function applyOps<T>(state: T, ops: Array<{ path: Array<string | number>; from?: any; to?: any; resize?: { to: number; tail: any[] } }>): T {
  const root: any = structuredClone(state);
  for (const op of ops) {
    if (!op.path.length) continue;
    let cur = root;
    for (let i = 0; i < op.path.length - 1; i++) cur = cur?.[op.path[i] as any];
    const last = op.path[op.path.length - 1];
    if (cur === undefined || cur === null) continue;
    if (op.resize) {
      const arr: any[] = Array.isArray(cur[last as any]) ? cur[last as any] : [];
      arr.length = op.resize.to;
      for (let i = 0; i < op.resize.tail.length; i++) arr[op.resize.to - op.resize.tail.length + i] = structuredClone(op.resize.tail[i]);
      cur[last as any] = arr;
    } else if ("to" in op) cur[last as any] = structuredClone(op.to);
    else delete cur[last as any];
  }
  return root;
}
