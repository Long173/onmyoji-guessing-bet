// compile/betting-doujo.ts — 童女 (R 213, Global "Doujo") 命之祭献 at max skill level. MAX (betting) mode only.
//
// Sources: data/kb/shikigami.json 213_03 (CN), data/kb/en-text.json skill:213_03 (Global, same text); the match-5
// replay (matches/2026-11-23e-lineup.en.json, Blue Doujo, 25431 max HP).
//   命之祭献 (213_03) · text: "牺牲30%当前生命，为除自身外的友方全体治疗生命上限10%生命并获得[buff_2133_1]，持续1回合。
//                     若自身生命比例低于30%，同时治疗自身及获得[buff_2133_1]"; L2 治疗增至15%, L3 生命恢复额外+50%,
//                     L4 消耗的生命比例降低为20%.
//                   · The compiled IR (plus skill-patches.gen.ts) healed every ally for 22.5% of Doujo's max HP
//                     (5722) and never took the sacrifice.
//                   · Replay: 7 casts; each one heals every other ally by the SAME amount (so the base is Doujo's,
//                     not the target's), and the amount falls as her HP drops: 2304, 2016, 1728, 1144, 1152 —
//                     about 10% of her current HP each time (= 50% of the 20% she sacrifices), never 2543+
//                     (10% of max HP) and never 5722. The replay wins over the max-HP reading.
//   Modelled (after the IR statuses are applied, from bettingAfterCast):
//     1. HP before = her current HP; she loses 20% of it (L4; 失去: no shield, no damage events).
//     2. Every other living ally is healed for 10% of that HP (heal channel: Pearl / heal reduction apply; no crit,
//        as in the replay where all simultaneous heals were identical).
//     3. If her HP ratio was below 30% (checked before the sacrifice), she heals herself the same amount.
//   The IR heal slot is removed (DOUJO_PATCHES); 庇佑之息 [buff_2133_1] stays on the IR.
//   AI (unchanged): KB "友方单位血量低于60%时 → 3技能, 否则普攻".
import type { Entity } from "../kernel/entity.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { bettingActive, isSummonUnit, skillById } from "./betting-shared.ts";

export const DOUJO = Object.freeze({
  sacrifice: 0.2,     // 213_03 L4: 消耗的生命比例降低为20%
  healOfHp: 0.1,      // replay: heal = 10% of her current HP (= 50% of the sacrificed HP)
  selfBelow: 0.3,     // 213_03: 若自身生命比例低于30%，同时治疗自身
});

export const isDoujo = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "213_03");

/** IR patch (MAX): the heal is run by betting-doujo.ts (current-HP based, after the sacrifice). */
export const DOUJO_PATCHES = Object.freeze({
  "213_03": { note: "命之祭献: sacrifice 20% current HP and heal 10% of it to every other ally are run by betting-doujo.ts", patch: { heal: [] } },
});

/** After 命之祭献 (MAX): sacrifice, then the heals. Returns true when it handled the cast. */
export async function doujoAfterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "213_03" || !self.alive) return false;
  const hp0 = self.hp;
  const lowSelf = self.maxHp > 0 && hp0 / self.maxHp < DOUJO.selfBelow;
  const loss = hp0 * DOUJO.sacrifice;
  const amount = hp0 * DOUJO.healOfHp;
  battle.trace.push({ t: "DOUJO_SACRIFICE", actor: self.id, skill: x.name, hpBefore: GameMath.display(hp0),
    sacrifice: GameMath.display(loss), heal: GameMath.display(amount), healsSelf: lowSelf });
  if (loss > 0) battle.lose(self, loss);
  const allies: Entity[] = battle.teams[self.teamId].aliveMembers();
  for (const m of allies) {
    if (m.id === self.id && !lowSelf) continue;
    if (!m.alive || !(amount > 0)) continue;
    await battle.heal(self, m, amount, { crit: false });
  }
  return true;
}
