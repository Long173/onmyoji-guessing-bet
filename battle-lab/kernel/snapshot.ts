// kernel/snapshot.ts — ★ G2：Snapshot + Delta + Checkpoint（a1-4.md §22/§23/§57）
//
// 文档要求：
//   §22 Snapshot 不需要每帧完整复制
//   §23 但必须增加 Checkpoint
//   §57 先做 snapshot(before) → resolve(event) → snapshot(after) → diff()，**先正确，后性能**
//
// 设计（照文档的"先粗暴后优化"）：
//   Checkpoint = 完整 BattleState（每隔 N 帧一个）
//   Delta      = 相邻两帧之间的**粗暴递归 diff**（路径 + 前后值）
//   任意帧状态 = 最近的 Checkpoint + 依次 apply 其后的 Delta
//
// 这套东西是 Theater 拖动进度条、以及 G3「Frame N state == Engine final state」的地基。
import { captureState, stateHash } from "./state.ts";
import type { BattleState } from "./state.ts";

// ────────────────────────── 粗暴但正确的递归 diff ──────────────────────────
/**
 * Delta 操作。除整值替换外，额外支持一种**手写增量**：`resize`。
 * 用途：usedSkills / statuses / effects 这类"只往后长"的数组，以前长度一变就整段替换，
 * 一个 Delta 能到几 KB；现在只记"截断/追加到多长、尾部新增了什么"。
 */
export type DeltaOp = { path: Array<string | number>; from?: any; to?: any; resize?: { to: number; tail: any[] } };

function isObj(v: any): boolean { return v !== null && typeof v === "object"; }

/** 递归比较，产出"把 a 变成 b 需要做的最小改动集合"。数组长度不同时整段替换（粗暴但不会错）。 */
export function diffStates(a: any, b: any, path: Array<string | number> = [], out: DeltaOp[] = []): DeltaOp[] {
  if (a === b) return out;
  if (!isObj(a) || !isObj(b)) { out.push({ path, from: a, to: b }); return out; }
  const aArr = Array.isArray(a), bArr = Array.isArray(b);
  if (aArr !== bArr) { out.push({ path, from: a, to: b }); return out; }
  if (aArr) {
    if (a.length !== b.length) {
      // 前缀完全相同的增长/缩短 → 手写增量（只记尾部）；否则退回整段替换，保证正确
      const n = Math.min(a.length, b.length);
      let i = 0;
      while (i < n && JSON.stringify(a[i]) === JSON.stringify(b[i])) i++;
      if (i === n) { out.push({ path, resize: { to: b.length, tail: b.slice(n) } }); return out; }
      out.push({ path, from: a, to: b });
      return out;
    }
    for (let i = 0; i < a.length; i++) diffStates(a[i], b[i], [...path, i], out);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a)) { out.push({ path: [...path, k], to: b[k] }); continue; }
    if (!(k in b)) { out.push({ path: [...path, k], from: a[k] }); continue; }
    diffStates(a[k], b[k], [...path, k], out);
  }
  return out;
}

/** 把 diff 结果应用到一个状态上（深拷贝语义：不改动入参） */
export function applyDelta<T>(state: T, ops: DeltaOp[]): T {
  const root: any = structuredClone(state);
  for (const op of ops) {
    if (!op.path || !op.path.length) continue;
    let cur = root;
    for (let i = 0; i < op.path.length - 1; i++) cur = cur?.[op.path[i] as any];
    const last = op.path[op.path.length - 1];
    if (cur === undefined || cur === null) continue;
    if (op.resize) {
      const arr: any[] = Array.isArray(cur[last as any]) ? cur[last as any] : [];
      arr.length = op.resize.to;                       // 先截断/扩位
      for (let i = 0; i < op.resize.tail.length; i++) arr[op.resize.to - op.resize.tail.length + i] = structuredClone(op.resize.tail[i]);
      cur[last as any] = arr;
    } else if ("to" in op) cur[last as any] = structuredClone(op.to);
    else delete cur[last as any];   // 字段被删除
  }
  return root;
}

// ────────────── ★ §103 Delta 编码：路径字典 + 元组（PATH_V1） ──────────────
//
// 实测（tools/_probe-size118.ts / seed 123456，597 帧）：Delta 共 191 KB，
// 其中 2582 个标量 op 每个都要把 [“teams”,0,“members”,3,“hp”] 这样的路径整段写一遍，
// 而一局里不同路径最多几十条 —— 这就是最大的一笔浪费。
//
// 做法：文件级 paths 字典只写一次，每帧 ops 写成元组
//   [路径下标, 种类, 值, 旧值]   种类 0=set 1=delete 2=resize
// 语义与 DeltaOp 完全一致：解码后交给 applyDelta，**不另写一份应用逻辑**。
export type PackedOp = [number, number, any?, any?];

export interface PackedDeltas {
  paths: Array<Array<string | number>>;
  frames: Array<{ frame: number; ops: PackedOp[]; bytes: number }>;
}

/** 编码：逐帧 Delta → 路径字典 + 元组。from 也留着 —— 它是链式自检的凭据。 */
export function packDeltas(deltas: FrameDelta[]): PackedDeltas {
  const paths: Array<Array<string | number>> = [];
  const index = new Map<string, number>();
  const pathId = (p: Array<string | number>): number => {
    const key = JSON.stringify(p);
    let id = index.get(key);
    if (id === undefined) { id = paths.length; paths.push(p); index.set(key, id); }
    return id;
  };
  const frames = deltas.map(d => {
    const ops: PackedOp[] = d.ops.map(op => {
      const id = pathId(op.path);
      if (op.resize) return [id, 2, op.resize] as PackedOp;
      if (!("to" in op)) return [id, 1, op.from] as PackedOp;
      return ("from" in op ? [id, 0, op.to, op.from] : [id, 0, op.to]) as PackedOp;
    });
    return { frame: d.frame, ops, bytes: JSON.stringify(ops).length };
  });
  return { paths, frames };
}

/** 解码：元组 → DeltaOp（path 直接复用字典里的数组，不复制） */
export function expandPacked(ops: PackedOp[], paths: Array<Array<string | number>>): DeltaOp[] {
  return ops.map(o => {
    /** 字典外下标不在这里抛错：这样 verify 才能把"原因"报出来（否则它只会炸在 applyDelta 里）。
     *  代价是这次 op 被跳过、重建偏移 —— 但那是**可检测**的偏移：verify 的字典检查会点名它。 */
    const path = paths[o[0]] ?? [];
    if (o[1] === 2) return { path, resize: o[2] };
    if (o[1] === 1) return o.length > 2 ? { path, from: o[2] } : { path };
    return o.length > 3 ? { path, to: o[2], from: o[3] } : { path, to: o[2] };
  });
}

/** 应用：先解码再走 applyDelta —— 单一应用逻辑，编码格式换了也不会出现两套语义 */
export function applyPackedDelta<T>(state: T, ops: PackedOp[], paths: Array<Array<string | number>>): T {
  return applyDelta(state, expandPacked(ops, paths));
}

// ────────────────────────── 记录器 ──────────────────────────
export interface Checkpoint { frame: number; state: BattleState; bytes: number }
export interface FrameDelta { frame: number; ops: DeltaOp[]; bytes: number }

export interface RecorderStats {
  frames: number;
  checkpoints: number;
  deltas: number;
  checkpointBytes: number;
  deltaBytes: number;
  /** 与"每帧存一份完整状态"相比省下的比例 */
  savingRatio: number;
  maxDeltaOps: number;
}

/**
 * 逐帧记录器。默认**不启用** —— 10000 局 Monte Carlo 不可能每帧抓快照，
 * 这也是 a1-4 §35「Trace Level 三档」存在的原因：NONE / SUMMARY / FULL。
 */
export class SnapshotRecorder {
  readonly checkpoints: Checkpoint[] = [];
  readonly deltas: FrameDelta[] = [];
  /**
   * ★★★ 第 191 轮：**每一帧那一刻的引擎状态指纹**（一帧一个，与 frame 同下标）。
   *
   * 为什么要它：G3 的验收原文是「Frame N state == Engine final state」—— 但那只钉住了**最后一帧**，
   *   中间几百帧的 Delta 链从来没有跟地面真值比对过（verify 里只抽查 4 帧，而且不与任何东西比）。
   *   记录器本来每帧就 captureState 一次（要拿它做 diff），顺手算一个指纹几乎没有额外成本；
   *   于是「逐帧回放」从「能重建」升级成「**每一帧都与引擎当时的状态一致**」。
   */
  readonly hashes: string[] = [];
  private lastState: BattleState | null = null;
  /** 最近一次记录的帧号。战斗结束时 Battle 会**额外补记一帧**（终局状态），它就在这里。 */
  lastFrame = -1;
  /** Checkpoint 间隔（帧）。太大 → 重建要应用很多 delta；太小 → 存得多。 */
  checkpointEvery: number;
  maxOps = 0;

  constructor(checkpointEvery = 256) { this.checkpointEvery = checkpointEvery; }

  /** 每产生一帧（trace 条目）调用一次 */
  onFrame(battle: any, frame: number): void {
    const state = captureState(battle);
    const bytes = JSON.stringify(state).length;
    if (this.lastState === null || frame % this.checkpointEvery === 0) {
      this.checkpoints.push({ frame, state, bytes });
    }
    /**
     * ★ §103：**每一帧都记 Delta，Checkpoint 帧也不例外**。
     * 旧写法是"Checkpoint 帧不记 Delta"，于是 f-1→f 这一步的转移只存在于 Checkpoint 内部，
     * 导致中间 Checkpoint 的内容在文件里**无法被交叉验证**（只能信记录时那次 captureState），
     * verify 里那句 "checkpoint 自证" 也因此恒真（播放器在 Checkpoint 帧直接返回档里那份）。
     * 现在 Checkpoint = 冗余锚点，Delta 链完整：区间重建必须正好落在下一个 Checkpoint 上。
     */
    if (this.lastState !== null) {
      // ★ 必须 diff **完整状态**：coreState 只用于指纹比对（不含 counts/unknownBuffRefs 等），
      //   拿它做 diff 会让重建出来的状态在这些字段上停在上一个 checkpoint（实测就是这个坑）。
      const ops = diffStates(this.lastState, state);
      this.maxOps = Math.max(this.maxOps, ops.length);
      this.deltas.push({ frame, ops, bytes: JSON.stringify(ops).length });
    }
    this.hashes[frame] = stateHash(state);
    this.lastState = state;
    this.lastFrame = frame;
  }

  /** 任意帧重建：最近 checkpoint + 其后所有 delta */
  stateAt(frame: number): BattleState | null {
    let cp: Checkpoint | null = null;
    for (const c of this.checkpoints) { if (c.frame <= frame) cp = c; else break; }
    if (!cp) return null;
    let state = structuredClone(cp.state);
    for (const d of this.deltas) {
      if (d.frame <= cp.frame) continue;
      if (d.frame > frame) break;
      state = applyDelta(state, d.ops);
    }
    return state;
  }

  stats(totalFrames: number): RecorderStats {
    const checkpointBytes = this.checkpoints.reduce((s, c) => s + c.bytes, 0);
    const deltaBytes = this.deltas.reduce((s, d) => s + d.bytes, 0);
    const fullBytes = this.checkpoints[0]?.bytes ?? 0;
    const naive = fullBytes * totalFrames;
    return {
      frames: totalFrames, checkpoints: this.checkpoints.length, deltas: this.deltas.length,
      checkpointBytes, deltaBytes, maxDeltaOps: this.maxOps,
      savingRatio: naive > 0 ? 1 - (checkpointBytes + deltaBytes) / naive : 0,
    };
  }
}
