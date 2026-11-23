// kernel/resolution.ts — ★ a1-4 §30/§31：ResolutionScope 与 ResolutionBoundary
//
// 规格原文 §30「Victory Check 不应该到回合结束才检查」：
//   「每个可能改变生存状态的 resolution 后：VICTORY_CHECK
//     但是不要过早结束。例如双方同时死亡，必须允许当前 Atomic Resolution 完成。
//     所以引入 ResolutionBoundary。只有边界处：commit deaths / check victory」
//
// 规格原文 §31「Atomic Resolution」：
//   interface ResolutionScope { id: string; type: "SKILL" | "HIT" | "EFFECT" | "TRIGGER"; }
//   「事件知道自己在哪个 Scope。」
//
// 本文件只定义类型。生命周期在 kernel/battle.ts 的 withinResolution / resolveBoundary；
// 事件如何拿到 scope 见 kernel/events.ts 的 scopeProvider。
export type ResolutionType = "SKILL" | "HIT" | "EFFECT" | "TRIGGER";

export interface ResolutionScope {
  /** 稳定标识，进事件链供 Inspector 展示（形如 SKILL:破魔箭） */
  id: string;
  type: ResolutionType;
}
