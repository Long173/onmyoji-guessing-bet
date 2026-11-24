// compile/betting-zashiki.ts — 座敷童子 (R 205, Global "Zashiki") at max skill level. MAX mode only (match 10).
//
// Sources: data/kb/shikigami.json 205_01 / 205_02 / 205_04, tips_7 先机; data/kb/en-text.json (Global).
// The compiled IR kept the level-1 numbers of both onibi skills (the max-level lines were skipped) and the passive is
// not run on the betting path (generic passives are off).
//   福运昌隆 (205_02, passive) · L3 先机: +3 onibi at battle start.
//   祸福相生 (205_04)          · L2: +3 onibi; L3: sacrifices 20% of her CURRENT HP (HP loss, not damage).
//   AI (KB, compiles)          · onibi < 6 → 祸福相生, otherwise 魂之火 (unchanged).
import type { Entity } from "../kernel/entity.ts";
import { EV } from "../kernel/types.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, ensureGlobalHandler, gainOrbs } from "./betting-shared.ts";

export const ZASHIKI = Object.freeze({ openingOrbs: 3, fortuneOrbs: 3, hpCost: 0.2 });

export const isZashiki205 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "205_02") && !!skillById(e, "205_04");
const opened = new WeakSet<object>();

function afterCast(battle: any, self: Entity, x: any): boolean {
  if (!bettingActive() || !isZashiki205(self) || x?.id !== "205_04") return false;
  const loss = self.hp * ZASHIKI.hpCost;
  if (loss > 0 && self.alive) {
    battle.lose(self, loss);
  }
  return false;   // the onibi gain stays on the generic path (patched to 3)
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isZashiki205);
  if (!units.length) return out;
  ensureGlobalHandler(battle, "betting:205:start", EV.BATTLE_START, () => {
    if (opened.has(battle)) return;   // BATTLE_START reaches global handlers once per unit
    opened.add(battle);
    const seen = new Set<number>();
    for (const z of units) {
      if (!z.alive || seen.has(z.teamId)) continue;   // 唯一-like: one opening gain per team is enough for a duplicate
      seen.add(z.teamId);
      battle.trace.push({ t: "SUBCAST", actor: z.id, ref: "205_02", skill: "福运昌隆", target: z.id, clause: "[tips_7]先机：获得3点鬼火" });
      gainOrbs(battle, z, z.teamId, ZASHIKI.openingOrbs, "福运昌隆");
    }
  });
  for (const z of units) out.push({ entityId: z.id, mechanic: "福运昌隆 先机 +3 onibi · 祸福相生 +3 onibi / −20% current HP" });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "205_04": { note: "祸福相生 L2: +3 onibi (the 20% current-HP cost is run by betting-zashiki.ts)", patch: { orb: { gain: 3, cost: 0 } } },
  }),
  afterCast,
  install,
};
