// compile/skill-overrides.ts — hand-verified corrections applied on top of compileSkill() output.
//
// Why: compileSkill reads skill prose; for some multi-segment skills it produces `hits: N` together
// with several damage ratios and no `damageSegments`, so the executor multiplies every ratio by N
// (e.g. 鬼使白 无常夺命 became 3 × (32% + 158%) to all enemies instead of 3 × 32% + one 182% follow-up).
//
// Rules for entries:
//   · keyed by skill id (`<charId>_<nn>`), values are shallow-merged into the compiled SkillIR;
//   · every entry quotes the original text it is derived from and states the max-skill-level choice;
//   · values assume max skill level (the betting mode uses max skills).
// Known skills with the same compiler shape that still need a reviewed entry are listed in
// PENDING_SEGMENT_REVIEW.
//
// Generated, reviewed patches from the max-level skill review live in ./skill-patches.gen.ts. They are
// applied only in MAX skill-level mode (the regression suite runs in BASE mode and pins fingerprints),
// and always before the hand overrides below, which stay authoritative in both modes.

import { SKILL_PATCHES } from "./skill-patches.gen.ts";
import { skillLevelMode } from "./max-level.ts";
import { BETTING_IR_PATCHES } from "./betting-mechanics.ts";

export interface SkillOverride {
  source: string;
  note: string;
  patch: Record<string, unknown>;
}

export const SKILL_OVERRIDES: Readonly<Record<string, SkillOverride>> = Object.freeze({
  "210_03": {
    source: "从地狱唤出鬼手攻击敌方全体3次，每次造成攻击32%伤害并有100%[tips_2]附加4级[buff_99_1]，持续1回合；然后对敌方全体附加[buff_2104_1]，造成158%[tips_5]，持续1回合。L4: [tips_5]增至182%",
    note: "鬼使白 无常夺命: 3 hits × 32% to all enemies, then one 182% (max level) indirect hit to all enemies",
    patch: {
      damage: [
        { ratio: 32, type: "NORMAL", base: "atk" },
        { ratio: 182, type: "INDIRECT", base: "atk" },
      ],
      damageSegments: [
        { hits: 3, ratio: 32, scope: "ENEMY_ALL" },
        { hits: 1, ratio: 182, scope: "ENEMY_ALL" },
      ],
    },
  },
});

/** Skills flagged by the multi-hit × multi-ratio scan that have not been hand-reviewed yet. */
export const PENDING_SEGMENT_REVIEW: readonly string[] = Object.freeze([
  "16 藤原道长 破阵奏曲", "248 荒川之主 吞噬", "258 两面佛 神罪连击", "260 清姬 焚身之火",
  "318 於菊虫 虫之毒", "320 一反木绵 绯夜散华", "354 待宵姑获鸟 墨影剑光", "370 饭笥 胃口大开",
  "392 季 弥天叶唳", "584 时曜泷夜叉姬 烬时之斩", "590 妙主九命猫 猫的报仇", "592 平将门 骄阳长明",
]);

/**
 * Shallow-merge reviewed overrides into compiled skills (in place, before executors are built).
 * MAX mode: generated patches first (deep-copied so units never share arrays), then hand overrides.
 */
export function applySkillOverrides<T>(ir: T[]): T[] {
  if (skillLevelMode() === "MAX") {
    for (const x of ir as any[]) {
      const g = x.id ? SKILL_PATCHES[x.id] : undefined;
      if (!g || SKILL_OVERRIDES[x.id]) continue;
      Object.assign(x, structuredClone(g.patch), { overrideNote: g.note });
    }
    // Betting-mode mechanics (compile/betting-mechanics.ts): status slots that are conditions or costs.
    for (const x of ir as any[]) {
      const b = x.id ? BETTING_IR_PATCHES[x.id] : undefined;
      if (b) Object.assign(x, structuredClone(b.patch), { bettingNote: b.note });
    }
  }
  for (const x of ir as any[]) {
    const o = x.id ? SKILL_OVERRIDES[x.id] : undefined;
    if (!o) continue;
    Object.assign(x, o.patch, { overrideNote: o.note });
  }
  return ir;
}
