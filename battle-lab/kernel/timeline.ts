// kernel/timeline.ts — 连续时间行动条（离散事件推进，不逐帧）
// 模型：跑道长 GOAL；t_i = (GOAL - p_i)/v_i；Δt = min(t_i)；p_i += v_i·Δt
// ★ 并列到达的先后 = 红区 B；锁条 = 官方[117]缚足 / [109]放逐 / [2277]石化
export const GOAL = 10000;
const EPS = 1e-6;

export interface TimelineEntry { id: number; pos: number; velocity: () => number; locked: boolean }

export interface RngLike { pick<T>(a: T[]): T | undefined; next(): number }
export type TieBreak = (cands: TimelineEntry[], rng?: RngLike | null) => TimelineEntry;

export const TieBreaks: Record<string, { id: string; status: string; fn: TieBreak; note: string }> = {
  SPEED_THEN_RANDOM: {
    id: "SPEED_THEN_RANDOM", status: "HYPOTHESIS",
    // 先取速度最快者，同速者之间**均匀随机**（否则会退化成"注册顺序优先"，产生红方结构优势）
    fn: (c, rng) => {
      const maxV = Math.max(...c.map(e => e.velocity()));
      const fastest = c.filter(e => Math.abs(e.velocity() - maxV) < 1e-9);
      if (fastest.length === 1) return fastest[0];
      return (rng?.pick(fastest)) ?? fastest[0];
    },
    note: "速度最快优先；同速均匀随机（M1 镜像自检发现不随机会导致红方优势）",
  },
  UNRESOLVED: { id: "UNRESOLVED", status: "UNKNOWN", fn: (c) => c[0], note: "未实测：并列到达的真实先后未知（当前按注册序，已知有偏，仅用于对照）" },
};

export class Timeline {
  private entries = new Map<number, TimelineEntry>();
  tieBreak: TieBreak = TieBreaks.UNRESOLVED.fn;
  rng: RngLike | null = null;
  readonly log: string[] = [];
  /** Clock time the last advance() moved (0 before the first; read by the betting referee clock, not saved). */
  lastDt = 0;
  /**
   * ★ 「这个单位现在能不能被改变行动条」的**唯一真相**由外部提供（Battle 传进来，
   * 内部查单位的缚足/放逐/石化状态）。用谓词而不是靠调用方去 setLock 同步一个布尔量：
   * 后者要求每个「加状态 / 去状态」的地方都记得同步，漏一处就静默失效 —— 那正是这个 bug 的成因。
   */
  lockPredicate: ((id: number) => boolean) | null = null;
  /** 位置是否被锁（显式锁 或 谓词判定） */
  isLocked(id: number): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    return e.locked || (this.lockPredicate?.(id) ?? false);
  }

  add(id: number, velocity: () => number, pos = 0): void { this.entries.set(id, { id, pos, velocity, locked: false }); }
  remove(id: number): void { this.entries.delete(id); }
  has(id: number): boolean { return this.entries.has(id); }
  get(id: number): TimelineEntry | undefined { return this.entries.get(id); }
  all(): TimelineEntry[] { return [...this.entries.values()]; }
  setLock(id: number, locked: boolean): void { const e = this.entries.get(id); if (e) e.locked = locked; }
  /**
   * Betting mode (MAX) only: observer of action-bar changes (compile/betting-bar.ts). Unset (null) in BASE
   * mode, so shift() behaves exactly as before. `adjust` may scale the requested change (e.g. "move bar
   * increases are halved"); `after` runs once the change landed. Not part of the saved state.
   */
  shiftHook: { adjust?: (id: number, percent: number) => number; after?: (id: number, percent: number) => void } | null = null;
  /** 官方[117]：无法受到改变行动条的效果 */
  shift(id: number, percent: number): boolean {
    const e = this.entries.get(id);
    if (!e || this.isLocked(id)) return false;
    const p = this.shiftHook?.adjust ? this.shiftHook.adjust(id, percent) : percent;
    e.pos = Math.max(0, Math.min(GOAL, e.pos + GOAL * p));
    this.log.push(`shift ${id} ${(p * 100).toFixed(1)}% -> ${e.pos.toFixed(0)}`);
    this.shiftHook?.after?.(id, p);
    return true;
  }
  /**
   * 推进到下一个到达终点的单位，返回其 id（无则 null）。
   *
   * ★ 锁条**不影响自然推进**。原先这里对 locked 的单位直接 continue，
   * 而一旦把缚足接上锁条（本轮修复），那个单位就会永远停在原地、永远不到达终点、
   * 于是永远不再行动 —— 那不是「无法受到改变行动条的效果」，那是死锁。
   * 官方案文只说「无法受到**改变行动条的效果**」，自然流逝不是效果，所以照常推进。
   * （另一读法「锁条 = 冻结原地」未被采纳：它会制造死锁，且与文案不符。）
   */
  advance(): number | null {
    let minT = Infinity;
    for (const e of this.entries.values()) {
      const v = e.velocity() || EPS;
      minT = Math.min(minT, (GOAL - e.pos) / v);
    }
    if (!isFinite(minT)) return null;
    this.lastDt = minT;
    const arrived: TimelineEntry[] = [];
    for (const e of this.entries.values()) {
      const v = e.velocity() || EPS;
      e.pos = Math.min(e.pos + v * minT, GOAL);
      if (Math.abs(e.pos - GOAL) < EPS) arrived.push(e);
    }
    this.log.push(`advance dt=${minT.toFixed(3)} arrived=[${arrived.map(a => a.id).join(",")}]`);
    if (!arrived.length) return null;
    const chosen = this.tieBreak(arrived, this.rng);
    chosen.pos = 0;
    return chosen.id;
  }
}
