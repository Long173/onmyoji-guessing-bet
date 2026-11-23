// soul/effects.ts — M1.5C SoulEffectSystem：御魂的**战斗效果**（与静态属性完全分离）
// 数据：data/kb/soul.json 的 desc 字段（4件套战斗触发文案）
import type { SoulEffectRef } from "./stat-source.ts";
import type { SoulDef } from "./loadout.ts";

export interface SoulEffectIR {
  soulId: number; name: string;
  desc: string;
  /** 触发时机（从文案推断；推断不出则为 null，不猜） */
  trigger: string | null;
  /** 数值参数，例如 "永久提升15%的伤害，最高不超过45%" -> [15, 45] */
  magnitudes: number[];
  confidence: "HIGH" | "LOW";
  unparsed: string[];
}

const TRIGGER_PATTERNS: Array<[RegExp, string]> = [
  [/回合结束后/, "TURN_END"],
  [/回合开始时/, "TURN_START"],
  [/造成伤害时/, "ON_DEAL_DAMAGE"],
  [/受到伤害时/, "ON_TAKE_DAMAGE"],
  [/受到攻击时/, "ON_TAKE_ATTACK"],
  [/攻击时/, "ON_ATTACK"],
  [/战斗开始时/, "BATTLE_START"],
  [/施放技能(?:时|后)/, "ON_SKILL"],
  [/行动(?:时|后)/, "ON_ACTION"],
  [/阵亡时/, "ON_DEATH"],
  [/暴击时/, "ON_CRIT"],
  [/被击败时/, "ON_KILLED"],
];

export function compileSoulEffect(def: SoulDef): SoulEffectIR {
  const desc = String(def.desc ?? "");
  let trigger: string | null = null;
  for (const [re, t] of TRIGGER_PATTERNS) if (re.test(desc)) { trigger = t; break; }
  const mags = [...desc.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map(m => parseFloat(m[1]));
  const unparsed: string[] = [];
  if (!trigger && desc) unparsed.push("未能识别触发时机");
  return {
    soulId: def.id, name: def.name, desc,
    trigger, magnitudes: mags,
    confidence: trigger ? "HIGH" : "LOW",
    unparsed,
  };
}

export function compileSoulBook(souls: SoulDef[]): Map<number, SoulEffectIR> {
  return new Map(souls.map(s => [Number(s.id), compileSoulEffect(s)]));
}

/**
 * 竞猜模式：只取**战斗效果**，绝不返回静态面板贡献。
 * 返回的 refs 用于注册事件 handler；静态属性一律不碰。
 */
export function battleEffectsOf(soulIds: number[], book: Map<number, SoulEffectIR>, defs: Map<number, SoulDef>): SoulEffectRef[] {
  const counts = new Map<number, number>();
  for (const id of soulIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const out: SoulEffectRef[] = [];
  for (const [id, n] of counts) {
    if (n < 4) continue;                        // 只有 4 件套才是战斗效果
    const def = defs.get(id); const ir = book.get(id);
    if (!def) continue;
    out.push({ soulId: id, name: def.name, pieces: n, desc: ir?.desc ?? def.desc });
  }
  return out;
}
