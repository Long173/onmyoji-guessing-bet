// kernel/rng.ts — 可复现随机数。所有随机都必须走这里，否则 seed replay 不成立。
/**
 * ★ G5：每一次抽数都要能说清"为什么抽"（a1-4 §20「RNG 也必须成为事件的一部分」）。
 * 用法：`rng.expect("crit:" + skill)` 之后紧跟的那次 next() 会带上这个用途标签。
 * 标签是**可选的**：没标就记 "unlabeled" —— 不假装知道，但也不静默丢掉。
 */
export class RNG {
  private s: number;
  readonly seed: number;
  readonly draws: Array<{ n: number; v: number; tag: string }> = [];
  private n = 0;
  private pending: string | null = null;
  constructor(seed: number) { this.seed = seed >>> 0; this.s = this.seed || 1; }
  /** 声明"下一次抽数是用来干什么的" */
  expect(tag: string): void { this.pending = tag; }
  /** 最近一次抽数的序号与用途（Inspector 用） */
  get lastDraw(): { n: number; v: number; tag: string } | null { return this.draws.length ? this.draws[this.draws.length - 1] : null; }
  /** mulberry32 */
  next(): number {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const v = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    this.n++;
    const tag = this.pending ?? "unlabeled";
    this.pending = null;
    this.draws.push({ n: this.n, v, tag });
    return v;
  }
  real(a: number, b: number): number { return a + this.next() * (b - a); }
  int(a: number, b: number): number { return Math.floor(this.real(a, b + 1)); }
  /** p 为概率（0..1）。p>=1 必中，p<=0 必不中。 */
  testHit(p: number): boolean { return this.next() < p; }

  /**
   * ★ G0：随机数发生器的内部状态必须可存取 —— 否则「暂停→保存→重载→续跑」在
   * 下第一次抽随机数时就会与原来分叉（同一个 seed 但已消耗的序列长度不同）。
   * draws 只用于回放展示，默认不随状态一起序列化（10k 局会撑爆内存）。
   */
  /**
   * ★★ 第 66 轮补上 `pending`：此前快照只存 {seed, s, n}，
   *   于是**在 expect() 之后、next() 之前做的任何快照/存档，都会丢掉"这次抽数是用来干什么的"** ——
   *   恢复后那一次抽数的标签会变成 unlabeled（用途归因错一位），
   *   而用途序列正是 RNG parity（a1-4 §25）要比的东西。
   *
   * ★ 为什么 `pending` 进状态、却**不进** coreState（指纹）：
   *   它只影响下一次抽数的**标签**，不影响数值 —— 数值只由 `s` 决定。
   *   coreState 收的是"决定未来的那部分"（数值），标签属于"记录"，与 trace / draws 同类。
   *   所以补它不移动任何指纹。
   */
  snapshot(includeDraws = false): { seed: number; s: number; n: number; pending: string | null; draws?: Array<{ n: number; v: number; tag: string }> } {
    const base = { seed: this.seed, s: this.s, n: this.n, pending: this.pending };
    return includeDraws ? { ...base, draws: this.draws.slice() } : base;
  }
  restore(snap: { seed?: number; s: number; n: number; pending?: string | null; draws?: Array<{ n: number; v: number; tag: string }> }): void {
    this.s = snap.s >>> 0;
    this.n = snap.n;
    this.pending = snap.pending ?? null;
    if (snap.draws) { this.draws.length = 0; this.draws.push(...snap.draws); }
  }
  pick<T>(arr: T[]): T | undefined { return arr.length ? arr[this.int(0, arr.length - 1)] : undefined; }
}
