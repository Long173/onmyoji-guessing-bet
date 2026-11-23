// compile/betting-vampira.ts — 吸血姬 253 (Vampira) at max skill level. MAX (betting) mode only.
//
// Source: data/kb/shikigami.json 253_01 / 253_02; English wiki "Kyuuketsu Hime" (same text).
//   血袭 253_01 · "牺牲10%当前生命，攻击敌方目标…" — she sacrifices 10% of her current HP before the attack.
//                The compiled IR only had the damage (her HP never moved).
//   血怒 253_02 · "生命比例每降低1%，提升4%伤害" — +4% damage per whole percent of HP lost. The compiled IR had no
//                effect (MECHANIC_UNPARSED).
import type { Entity } from "../kernel/entity.ts";
import { EV } from "../kernel/types.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { bettingActive, isSummonUnit, skillById, ensureGlobalHandler } from "./betting-shared.ts";

export const VAMPIRA = Object.freeze({ sacrifice: 0.1, perPercent: 0.04 });

export function installVampira(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const v of entities) {
    if (isSummonUnit(v)) continue;
    if (skillById(v, "253_01")) {
      ensureGlobalHandler(battle, "betting:253:sacrifice:" + v.id, EV.SKILL_START, (ctx: any) => {
        if (ctx?.actor?.id !== v.id || ctx?.skill?.ir?.id !== "253_01" || !v.alive) return;
        const loss = v.hp * VAMPIRA.sacrifice;
        if (loss > 0) battle.lose(v, loss);
      });
      out.push({ entityId: v.id, mechanic: "血袭: 牺牲10%当前生命" });
    }
    if (skillById(v, "253_02")) {
      ensureGlobalHandler(battle, "betting:253:rage:" + v.id, EV.BEFORE_DAMAGE, (ctx: any) => {
        if (ctx?.input?.source?.id !== v.id || ctx?.result?.ignoresModifiers || !(v.maxHp > 0)) return;
        const lost = GameMath.floorAt(Math.max(0, 1 - v.hp / v.maxHp) * 100 + 1e-9, "VAMPIRA_RAGE_PERCENT");
        if (lost > 0) ctx.result.final *= 1 + VAMPIRA.perPercent * lost;
      });
      out.push({ entityId: v.id, mechanic: "血怒" });
    }
  }
  return out;
}
