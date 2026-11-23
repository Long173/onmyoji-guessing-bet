// kernel/gamemath.ts — 数值层唯一入口
// 规则：**除本文件外，全项目禁止 Math.floor / Math.round / parseInt / toFixed**。
// 原因：游戏自己的取整点未知，散落的取整会污染中间结果且无法一次性替换。
export type Scalar = number;

/** 游戏规定的取整点；未实证前一律不用。 */
export const RoundingPoint = {
  /** 展示层四舍五入（假设，待实测） */
  DISPLAY_ROUND: "DISPLAY_ROUND",
  /** 展示层向下截断（假设，待实测） */
  DISPLAY_FLOOR: "DISPLAY_FLOOR",
} as const;
export type RoundingPoint = (typeof RoundingPoint)[keyof typeof RoundingPoint];

/** 展示口径尚未实测 —— 两个候选都保留，默认 ROUND 并在产物里标出。 */
export let DISPLAY_MODE: RoundingPoint = RoundingPoint.DISPLAY_ROUND;
export function setDisplayMode(m: RoundingPoint) { DISPLAY_MODE = m; }

export const EPS = 1e-9;

export const GameMath = {
  /** 只有游戏明确存在取整节点时才调用 */
  floorAt(v: Scalar, where: string): Scalar { void where; return Math.floor(v); },
  roundAt(v: Scalar, where: string): Scalar { void where; return Math.round(v); },

  /** 展示格式化：整数面板 */
  display(v: Scalar): Scalar {
    return DISPLAY_MODE === RoundingPoint.DISPLAY_FLOOR ? Math.floor(v) : Math.round(v);
  },
  /** 展示格式化：百分比面板（内部比例 -> 显示百分数） */
  displayPercent(ratio: Scalar): Scalar { return GameMath.display(ratio * 100); },

  /** 面板公式：base * (1 + Σ加成) + Σ固定值。**不做中间取整** */
  apply(base: Scalar, addRates: Scalar[], flats: Scalar[]): Scalar {
    let rate = 0; for (const r of addRates) rate += r;
    let flat = 0; for (const f of flats) flat += f;
    return base * (1 + rate) + flat;
  },
  /** 速度等非乘区属性：base + Σ加减 */
  applyFlat(base: Scalar, deltas: Scalar[]): Scalar {
    let v = base; for (const d of deltas) v += d; return v;
  },
  clamp(v: Scalar, lo: Scalar, hi: Scalar): Scalar { return v < lo ? lo : v > hi ? hi : v; },
  /** 从"显示值 + 取整规则"推出精确值的可行区间 */
  feasibleRange(displayed: Scalar): [Scalar, Scalar] {
    return DISPLAY_MODE === RoundingPoint.DISPLAY_FLOOR ? [displayed, displayed + 1 - EPS] : [displayed - 0.5, displayed + 0.5 - EPS];
  },
  /** 判断一个精确值是否能显示为该整数 */
  displaysAs(exact: Scalar, displayed: Scalar): boolean {
    return Math.abs(GameMath.display(exact) - displayed) < EPS;
  },
};
