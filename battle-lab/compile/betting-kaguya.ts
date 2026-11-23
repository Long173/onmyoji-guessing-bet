// compile/betting-kaguya.ts — 辉夜姬 280 (Kaguya) at max skill level. MAX (betting) mode only.
//
// Sources: data/kb/shikigami.json 280_0x (CN text) and the English wiki page "Kaguya Hime" (same numbers).
//   蓬莱玉枝 280_01 · "有10%概率削减其1点鬼火" is a 10% chance to REMOVE 1 onibi from the enemy team. The compiler
//                    read it as orb.gain 1 for Kaguya's team (not executed today, zeroed so it never is).
//   火鼠裘 280_02   · 唯一效果. When Kaguya is attacked she has 40% (L3) to gain 1 onibi; while her 龙首之玉 illusion
//                    is up, any ally being attacked triggers it too. An AoE / multi-hit attack triggers it at
//                    most once (one roll per attack action).
//   龙首之玉 280_03 · Illusion for 2 turns, counted on Kaguya's own turns (same convention as the other
//                    illusion in this mode, 鲸汐千姬: the casting turn does not count). Allies: +25% DEF (L4),
//                    +20% effect RES (L5) (the compiler kept only the base 15% DEF), 67% chance of 1 onibi at
//                    the start of each ally turn (already run by kernel/field.ts).
//                  · In the illusion, a skill whose onibi cost cannot be paid may still be cast by spending all
//                    remaining onibi (at least 1 is required here: the text says "消耗剩余全部鬼火"). Each time,
//                    Kaguya sacrifices (missing onibi × 5%) of her current HP and the illusion loses 1 turn.
//                  · 龙首之玉 costs 1 less inside the illusion. The compiler read that as orb.gain 1 on every cast
//                    (net cost 1 even outside the illusion) — zeroed.
//   AI (data/kb/ai.json): 3技能 when she is not in her illusion or it has 1 turn left, otherwise normal attack.
import type { Entity } from "../kernel/entity.ts";
import { EV, DamageType } from "../kernel/types.ts";
import { fieldsOf, clearField } from "../kernel/field.ts";
import type { FieldState } from "../kernel/field.ts";
import { bettingActive, isSummonUnit, skillById, entityById, ensureGlobalHandler, gainOrbs, levelNumber } from "./betting-shared.ts";
import { currentHit } from "./betting-scope.ts";

export const KAGUYA = Object.freeze({
  illusionTurns: 2, sacrificePerOrb: 0.05, drainChance: 0.1, passiveChance: 0.4, def: 0.25, efr: 0.2,
});

const FIELD_TEXT = "创造存在2回合的幻境，使友方全体提升15%防御、10%效果抵抗，且在回合开始前有67%概率获得1点鬼火";

export const KAGUYA_PATCHES: Readonly<Record<string, { note: string; patch: Record<string, unknown> }>> = Object.freeze({
  "280_01": {
    note: "蓬莱玉枝: '10%概率削减其1点鬼火' removes an ENEMY onibi (betting-kaguya.ts), it is not an onibi gain",
    patch: { orb: { gain: 0, cost: 0 } },
  },
  "280_02": {
    note: "火鼠裘: the 40% onibi gain on being attacked is run by betting-kaguya.ts (illusion: any ally, once per attack)",
    patch: { orb: { gain: 0, cost: -1 } },
  },
  "280_03": {
    note: "龙首之玉: max-level auras +25% DEF / +20% effect RES; '幻境中施放龙首之玉消耗鬼火减少1点' is a cost rule (bettingCostOf), not orb.gain 1",
    patch: {
      orb: { gain: 0, cost: 2 },
      field: {
        kind: "ILLUSION", name: "幻境", duration: KAGUYA.illusionTurns, durationSource: "CLAUSE", probability: null,
        auras: [
          { scope: "ALLY", prop: "def", mode: "ADD_RATE", value: KAGUYA.def, evidence: FIELD_TEXT + " · L4 提升防御效果增至25%" },
          { scope: "ALLY", prop: "efr", mode: "FIXED", value: KAGUYA.efr, evidence: FIELD_TEXT + " · L5 提升效果抵抗效果增至20%" },
        ],
        perTurn: { trigger: "TURN_START", scope: "ALLY", kind: "ORB_GAIN", amount: 1, probability: 0.67, evidence: FIELD_TEXT },
        evidence: FIELD_TEXT,
      },
    },
  },
});

const isKaguya = (e: Entity | null | undefined): boolean => !!e && !!skillById(e, "280_03");

/** Kaguya's illusion on `teamId` (her compiled field is named 幻境 and owned by a unit with 280_03). */
export function kaguyaIllusion(battle: any, teamId: number): (FieldState & { ownerTurnsLeft?: number; openedTurn?: number }) | null {
  for (const f of fieldsOf(battle) as any[]) {
    if (f.kind !== "ILLUSION" || f.name !== "幻境" || f.teamId !== teamId) continue;
    if (isKaguya(entityById(battle, f.ownerId))) return f;
  }
  return null;
}

/** Turns left of the illusion (owner turns), 0 when there is none. */
export const kaguyaTurnsLeft = (battle: any, teamId: number): number => Number(kaguyaIllusion(battle, teamId)?.ownerTurnsLeft ?? 0);

/**
 * Effective cost after Kaguya's rules (`base` = cost after the other betting rules).
 * In her illusion: 龙首之玉 -1; any skill whose cost exceeds the team's onibi costs all remaining onibi (≥ 1).
 */
export function kaguyaCost(battle: any, self: Entity, sk: any, base: number): number {
  if (!bettingActive() || !(base > 0) || !battle?.teams || isSummonUnit(self)) return base;
  const ill = kaguyaIllusion(battle, self.teamId);
  if (!ill) return base;
  // `sk` is a skill entry (AI: sk.ir.id) or the IR itself (character.ts execution: sk.id).
  let cost = (sk?.ir?.id ?? sk?.id) === "280_03" ? Math.max(0, base - 1) : base;
  const have = Number(battle.teams[self.teamId].orbs.current ?? 0);
  if (cost > have && have >= 1) cost = have;
  return cost;
}

/** AI (MAX): 龙首之玉 when there is no illusion or 1 turn is left and the cost can be paid, else normal attack. */
export function kaguyaRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || isSummonUnit(self)) return null;
  const jewel = skillById(self, "280_03");
  if (!jewel) return null;
  const left = kaguyaTurnsLeft(battle, self.teamId);
  const want = left <= 1;
  const c = costOf(jewel);
  if (want && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c))) {
    return { skill: jewel, rule: left === 0 ? "辉夜姬: 未处于幻境 → 龙首之玉" : "辉夜姬: 幻境剩余1回合 → 龙首之玉" };
  }
  const basic = skillById(self, "280_01") ?? self.skills.find((s: any) => Number(s.cost) === 0);
  return basic ? { skill: basic, rule: want ? "辉夜姬: 鬼火不足 → 普攻" : "辉夜姬: 幻境剩余" + left + "回合 → 普攻" } : null;
}

/** After an active cast (MAX): illusion bookkeeping and the 10% onibi removal of the normal attack. */
export function kaguyaAfterCast(battle: any, self: Entity, x: any): void {
  if (x?.id === "280_03") {
    const ill: any = kaguyaIllusion(battle, self.teamId);
    if (!ill) return;
    ill.expiresTurn = Number.MAX_SAFE_INTEGER;   // counted on Kaguya's turns (tickKaguya), not globally
    ill.ownerTurnsLeft = KAGUYA.illusionTurns;
    ill.openedTurn = Number(battle.turn ?? 0);
    battle.trace.push({ t: "FIELD_DURATION", name: ill.name, owner: self.id, turns: KAGUYA.illusionTurns, counted: "OWNER_TURNS", skill: x.name });
    return;
  }
  if (x?.id === "280_01") {
    const foe = battle.teams[self.teamId === 0 ? 1 : 0];
    battle.rng.expect("kaguya:drain:" + self.id);
    if (!battle.rng.testHit(KAGUYA.drainChance) || !(foe.orbs.current > 0)) return;
    const before = foe.orbs.current;
    foe.orbs.pay(1);
    battle.trace.push({ t: "ORB_DRAIN", team: foe.teamId ?? (self.teamId === 0 ? 1 : 0), src: self.id, skill: x.name, before, after: foe.orbs.current });
  }
}

function tickKaguya(battle: any, actor: Entity): void {
  for (const st of [...fieldsOf(battle)] as any[]) {
    if (st.name !== "幻境" || typeof st.ownerTurnsLeft !== "number") continue;
    const owner = entityById(battle, st.ownerId);
    if (!isKaguya(owner)) continue;
    const counts = owner?.alive ? actor.id === owner.id : (actor.teamId === st.teamId && !isSummonUnit(actor));
    if (!counts) continue;
    if (owner?.alive && st.openedTurn === Number(battle.turn ?? 0)) continue;
    st.ownerTurnsLeft--;
    if (st.ownerTurnsLeft <= 0) clearField(battle, st, "EXPIRED");
  }
}

/** Partial payment in the illusion: HP sacrifice and -1 illusion turn (ORB_COST is queued after the payment). */
async function onOrbCost(battle: any, ctx: any, nominalOf: (actor: Entity, sk: any) => number): Promise<void> {
  const actor: Entity | null = entityById(battle, Number(ctx?.actor ?? -1));
  if (!actor) return;
  const ill: any = kaguyaIllusion(battle, actor.teamId);
  if (!ill) return;
  const sk = (actor.skills ?? []).find((s: any) => s.name === ctx.skill);
  if (!sk) return;
  let nominal = nominalOf(actor, sk);
  if (sk.ir?.id === "280_03") nominal = Math.max(0, nominal - 1);
  const paid = Number(ctx.amount ?? 0);
  if (!(nominal > paid)) return;
  const kaguya = entityById(battle, ill.ownerId);
  const missing = nominal - paid;
  if (kaguya?.alive) {
    const loss = kaguya.hp * KAGUYA.sacrificePerOrb * missing;
    if (loss > 0) battle.lose(kaguya, loss);
  }
  ill.ownerTurnsLeft = Number(ill.ownerTurnsLeft ?? 1) - 1;
  battle.trace.push({
    t: "KAGUYA_PARTIAL_CAST", actor: actor.id, skill: sk.name, cost: nominal, paid, owner: ill.ownerId,
    sacrifice: missing * KAGUYA.sacrificePerOrb, illusionTurnsLeft: Math.max(0, ill.ownerTurnsLeft),
    clause: "幻境中，施放技能所需鬼火不足时，仍可消耗剩余全部鬼火施放；每次触发该效果，辉夜姬牺牲消耗鬼火数差值×5%当前生命，并使幻境的持续时间减少1回合",
  });
  if (ill.ownerTurnsLeft <= 0) clearField(battle, ill, "EXPIRED");
}

const lastRoll = new WeakMap<object, Map<number, unknown>>();

/** 火鼠裘: 40% onibi when Kaguya (or, in her illusion, any ally) is attacked; once per attack action. */
function onAttacked(battle: any, kaguya: Entity, ctx: any, chance: number): void {
  const t: Entity = ctx?.input?.target, s: Entity = ctx?.input?.source;
  if (!kaguya.alive || !t || !s || s.teamId === kaguya.teamId || t.teamId !== kaguya.teamId) return;
  if (ctx?.result?.type !== DamageType.NORMAL) return;   // attacks only (no DoT / reflect / transfer)
  if (t.id !== kaguya.id && !kaguyaIllusion(battle, kaguya.teamId)) return;
  const stack: any[] = battle.resolutionStack ?? [];
  const scope = stack.find((x: any) => x?.type === "SKILL");
  if (!scope || !currentHit(battle).skill) return;
  const seen = lastRoll.get(battle) ?? new Map<number, unknown>();
  lastRoll.set(battle, seen);
  if (seen.get(kaguya.id) === scope) return;
  seen.set(kaguya.id, scope);
  battle.rng.expect("kaguya:fire-rat:" + kaguya.id);
  const hit = battle.rng.testHit(chance);
  battle.trace.push({ t: "PASSIVE_ROLL", src: kaguya.id, skill: "火鼠裘", dst: t.id, probability: chance, hit });
  if (hit) gainOrbs(battle, kaguya, kaguya.teamId, 1, "火鼠裘");
}

export function installKaguya(battle: any, entities: Entity[], nominalOf: (actor: Entity, sk: any) => number): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const kaguyas = entities.filter(e => isKaguya(e) && !isSummonUnit(e));
  if (!kaguyas.length) return out;
  ensureGlobalHandler(battle, "betting:280:illusion-tick", EV.TURN_END, (ctx: any) => { if (ctx?.actor) tickKaguya(battle, ctx.actor); });
  ensureGlobalHandler(battle, "betting:280:partial-cast", EV.ORB_COST, (ctx: any) => onOrbCost(battle, ctx, nominalOf));
  for (const k of kaguyas) {
    const x = skillById(k, "280_02")?.ir;
    if (!x) continue;
    const chance = levelNumber(x, /触发概率增至(\d+)%/, /有(\d+)%概率获得1点鬼火/, 30) / 100;
    ensureGlobalHandler(battle, "betting:280:fire-rat:" + k.id, EV.AFTER_DAMAGE, (ctx: any) => onAttacked(battle, k, ctx, chance));
    out.push({ entityId: k.id, mechanic: "龙首之玉幻境 / 火鼠裘" });
  }
  return out;
}
