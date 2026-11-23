// compile/betting-ibaraki.ts — 炼狱茨木童子 322 (Inferno Ibaraki Doji) passive 狂意 at max level. MAX mode only.
//
// Source: data/kb/shikigami.json 322_02 "当『炼狱之门』的鬼焰将攻击超过1名敌方时，每有1个额外敌方可使鬼焰提升10%伤害，
// 上限20%" with L2-L4 raising the cap to 50%. The compiled IR had no effect (MECHANIC_UNPARSED).
//   · Applied to the 鬼焰 (all-enemy) segment of 322_03 only: +10% per living enemy beyond the first, max 50%.
// Not modelled: L5 overkill carry-over to 鬼手, and 鬼手 retargeting the highest-HP enemy when the selected target
// died to 鬼焰 (the segment executor skips a dead primary).
import type { Entity } from "../kernel/entity.ts";
import { EV } from "../kernel/types.ts";
import { bettingActive, isSummonUnit, skillById, ensureGlobalHandler, levelNumber } from "./betting-shared.ts";
import { currentSkillOf, currentSegment, isSupportDamage } from "./betting-scope.ts";

export const IBARAKI = Object.freeze({ perEnemy: 0.1 });

export function installIbaraki(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const e of entities) {
    const x = skillById(e, "322_02")?.ir;
    if (!x || !skillById(e, "322_03") || isSummonUnit(e)) continue;
    const cap = levelNumber(x, /上限增至(\d+)%/, /上限(\d+)%/, 20) / 100;
    ensureGlobalHandler(battle, "betting:322:frenzy:" + e.id, EV.BEFORE_DAMAGE, (ctx: any) => {
      if (ctx?.input?.source?.id !== e.id || ctx?.result?.ignoresModifiers || isSupportDamage(ctx)) return;
      const sk = currentSkillOf(battle, e);
      if (sk?.ir?.id !== "322_03" || currentSegment(battle, sk.name) !== 1) return;
      const foes = (battle.enemiesOf(e.teamId) as Entity[]).filter(v => v.alive).length;
      const bonus = Math.min(cap, IBARAKI.perEnemy * Math.max(0, foes - 1));
      if (bonus > 0) ctx.result.final *= 1 + bonus;
    });
    out.push({ entityId: e.id, mechanic: "狂意" });
  }
  return out;
}
