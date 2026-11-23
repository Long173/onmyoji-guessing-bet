// kernel/resource.ts — 泛鬼火 ResourceSystem
// 官方[26] 泛鬼火 = 鬼火 + 愿力 + 义火。技能不许直接改数值，必须走 pay()/gain()。
// ★ 初始值/上限/回火曲线 = 红区 D（未实测），全部来自 Policy，不硬编码。
import { EV } from "./types.ts";

export type OrbKind = "orb" | "willpower" | "righteousFire";

export interface ResourcePolicy {
  id: string;
  status: "UNKNOWN" | "HYPOTHESIS" | "VERIFIED";
  initialOrb: number; maxOrb: number; gaugeSize: number;
  /** 第 n 次（1-based）鬼火条满时回多少火 */
  rewardAtCycle: (cycle: number) => number;
  /** 回合结束结算回火（规格书：回合结束阶段第7步推进，满格回火在该真回合结束时发生） */
  rewardAtTurnEnd: boolean;
  evidence?: string;
}

export const ResourcePolicies: Record<string, ResourcePolicy> = {
  COMMUNITY_4_8_5_345: {
    id: "COMMUNITY_4_8_5_345", status: "HYPOTHESIS",
    initialOrb: 4, maxOrb: 8, gaugeSize: 5,
    rewardAtCycle: (n) => (n <= 1 ? 3 : n === 2 ? 4 : 5),
    rewardAtTurnEnd: true,
    evidence: "社区攻略 + omj_simulator 实现；官方 tooltip 未给数值，待 D 组实测",
  },
  UNKNOWN_ZERO: {
    id: "UNKNOWN_ZERO", status: "UNKNOWN",
    initialOrb: 0, maxOrb: 8, gaugeSize: 5, rewardAtCycle: () => 0, rewardAtTurnEnd: true,
    evidence: "占位：未实测，禁止用于产出胜率",
  },
};

export interface GainResult { requested: number; gained: number; overflow: number; kind: OrbKind }

/** Per-pool listeners (kept outside the pool so its serialized shape never changes). */
const deductHooks = new WeakMap<object, (amount: number) => void>();
const overflowHooks = new WeakMap<object, (overflow: number) => void>();
/** Called with the amount whenever onibi is deducted by an effect (pay with purpose "DEDUCT"). null clears it. */
export function setOrbDeductHook(pool: object, fn: ((amount: number) => void) | null): void {
  if (fn) deductHooks.set(pool, fn); else deductHooks.delete(pool);
}
/** Called with the overflow whenever a gain overflows the cap. null clears it. */
export function setOrbOverflowHook(pool: object, fn: ((overflow: number) => void) | null): void {
  if (fn) overflowHooks.set(pool, fn); else overflowHooks.delete(pool);
}

export class OrbPool {
  orb: number; willpower = 0; righteousFire = 0;
  gauge = 0; cycle = 0; pendingReward = 0;
  readonly history: string[] = [];
  teamId: number;
  policy: ResourcePolicy;
  constructor(teamId: number, policy: ResourcePolicy) {
    this.teamId = teamId;
    this.policy = policy;
    this.orb = policy.initialOrb;
  }
  get current(): number { return this.orb; }
  canPay(amount: number): boolean { return this.orb >= amount; }

  /**
   * 支付。★ 多形态泛鬼火的优先消耗顺序属红区（愿力/义火语义未实测）
   * `purpose`: "COST" = a skill's onibi cost (消耗); "DEDUCT" (default) = removed by an effect (扣除).
   * Only a deduction reaches the hook set with setOrbDeductHook (betting mode; no hook ⇒ no behaviour change).
   */
  pay(amount: number, kind: OrbKind = "orb", purpose: "COST" | "DEDUCT" = "DEDUCT"): boolean {
    if (kind !== "orb") { this.history.push(`pay:${kind}:${amount}:unsupported`); return false; }
    if (!this.canPay(amount)) { this.history.push(`pay:orb:${amount}:FAIL`); return false; }
    this.orb -= amount;
    this.history.push(`pay:orb:${amount}`);
    if (purpose === "DEDUCT" && amount > 0) deductHooks.get(this)?.(amount);
    return true;
  }

  gain(requested: number, kind: OrbKind = "orb"): GainResult {
    if (kind !== "orb") return { requested, gained: 0, overflow: requested, kind };
    const before = this.orb;
    this.orb = Math.min(this.policy.maxOrb, this.orb + requested);
    const gained = this.orb - before;
    const overflow = requested - gained;
    this.history.push(`gain:orb:${requested}->+${gained}(overflow ${overflow})`);
    if (overflow > 0) overflowHooks.get(this)?.(overflow);
    return { requested, gained, overflow, kind };
  }

  /** 推进鬼火条，返回是否恰好满格 */
  advanceGauge(): boolean {
    if (this.policy.gaugeSize <= 0) return false;
    this.gauge++;
    if (this.gauge >= this.policy.gaugeSize) { this.gauge = 0; this.cycle++; return true; }
    return false;
  }
  rewardForCycle(): number { return this.policy.rewardAtCycle(this.cycle); }
  snapshot() { return { orb: this.orb, willpower: this.willpower, righteousFire: this.righteousFire, gauge: this.gauge, cycle: this.cycle, pendingReward: this.pendingReward }; }
}
