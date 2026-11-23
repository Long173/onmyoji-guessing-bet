// compile/betting-shokurei.ts — 食灵 369 (Shokurei) at max skill level. MAX (betting) mode only.
//
// Sources: data/kb/shikigami.json 369_0x, buffs 3693_1 / 3694_1 / 3696_1; English wiki "Shokurei" (飨食 numbers).
//   开锅 369_01   · L5: when used outside his turn, the target gets 20% vulnerability for 2 turns (易伤 → +20%
//                  damage taken).
//   热浪 369_02   · 唯一效果. Allies deal +50% damage outside their own turn (L4). L5: when the ally with the
//                  highest initial crit damage selects a single enemy target in its own turn, Shokurei assists
//                  with a normal attack (a pseudo turn, so outside his turn). The compiled IR had no effect.
//   梦想料理 369_03 · 2 onibi (L2). A selected ally (not himself, not already eating) gets 用餐 until the end of its
//                  next turn: its damage in its own turn -30%, damage taken -40%. At the end of that turn it eats:
//                  用餐 ends, it gets 饱食, 庇护 for 1 turn (L3, blocks 1 control) and all allies heal 78% of
//                  Shokurei's ATK (L4). 3 turns later (any side), if it can act, 飨食 hits every enemy for 158% of
//                  the damage the ally dealt during its 用餐 turn, split evenly, ignoring defense, no crit, no
//                  souls, plus 66% of Shokurei's ATK per enemy (L5). (Cap of 3000% of the team's initial ATK per
//                  target is not reached in practice and not modelled.)
//   AI (data/kb/ai.json): 3技能 when at least 2 allies are alive, otherwise normal attack; 3技能 targets the ally
//   with the highest crit damage (ties: lineup order). The KB condition "我方存活数量大于等于2时" did not compile
//   (the dictionary only knows "≥"), so the engine never cast it.
// Not modelled: L3 "初始暴击伤害最高的友方额外获得30%协战概率"; the 进化 ATK stacks (unknown whether evolved).
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import { targetModeOf } from "./skill-compiler.ts";
import { bettingActive, isSummonUnit, skillById, entityById, ensureGlobalHandler, markDef, noteValue, setNote, PERSIST, levelNumber } from "./betting-shared.ts";
import { inOwnTurn, isSupportDamage, dealUndefended } from "./betting-scope.ts";

export const SHOKUREI = Object.freeze({
  offTurn: 0.5, mealDealt: 0.3, mealTaken: 0.4, fullTurns: 3, feastRatio: 1.58, feastAtkPerEnemy: 0.66,
  mealHealAtk: 0.78, vuln: 0.2, vulnTurns: 2, minAllies: 2,
});

export const SHOKUREI_PATCHES: Readonly<Record<string, { note: string; patch: Record<string, unknown> }>> = Object.freeze({
  "369_03": {
    note: "梦想料理: 用餐 / 饱食 / 飨食 are run by betting-shokurei.ts (the compiled slots applied both marks at once)",
    patch: { statusRefConditionOnly: [0, 1] },
  },
});

const MEAL_DMG = "shokurei:mealDmg=";   // damage dealt in the 用餐 turn (on the eater)
const FULL_NOTE = "shokurei:full=";     // "<turnsLeft>:<damage>:<shokureiId>:<openedTurn>" (on the eater)

const MEAL_DEF = () => markDef({ id: "bet:3693_1", name: "用餐", category: StatusCategory.COMMON_MARK,
  desc: "betting-shokurei: 回合内造成的伤害减少30%；受到的伤害减少40%" }, StatusBook);
const FULL_DEF = () => markDef({ id: "bet:3694_1", name: "饱食", category: StatusCategory.COMMON_MARK,
  desc: "betting-shokurei: 3个回合后若未处于无法动作，发动飨食" }, StatusBook);
const SHELTER_DEF = () => markDef({ id: "bet:3696_1", name: "庇护", category: StatusCategory.BUFF_MARK,
  desc: "betting-shokurei: 可抵挡1次控制效果", immuneTo: ["CONTROL"], consumeOnImmune: true, durationPolicy: "TARGET_TURN" }, StatusBook);
const VULN_DEF = () => markDef({ id: "bet:3691_vuln", name: "易伤", category: StatusCategory.DEBUFF_STATE,
  desc: "betting-shokurei: 受到的伤害提升20%（开锅 L5，回合外施放）", dispellable: true, removable: true, durationPolicy: "TARGET_TURN" }, StatusBook);

const isShokurei = (e: Entity | null | undefined): boolean => !!e && !!skillById(e, "369_03");
const hasMeal = (e: Entity): boolean => e.statuses.some(s => s.def.id === "bet:3693_1");
const aliveAllies = (battle: any, e: Entity): Entity[] => (battle.teams[e.teamId].aliveMembers() as Entity[]).filter(m => !isSummonUnit(m));
const canAct = (e: Entity): boolean => e.alive && !isActionPrevented(e.statusDefs());

/** Meal target among `cands`: highest crit damage, not himself, not eating, alive non-summon (lineup order on ties). */
function pickMealTarget(self: Entity, cands: Entity[]): Entity | null {
  const pool = cands.filter(m => m.alive && !isSummonUnit(m) && m.id !== self.id && m.teamId === self.teamId && !hasMeal(m));
  if (!pool.length) return null;
  return pool.reduce((a, b) => (b.prop("crid") > a.prop("crid") ? b : a), pool[0]);
}
export const mealTargetOf = (battle: any, self: Entity): Entity | null => pickMealTarget(self, aliveAllies(battle, self));

/** AI (MAX): 梦想料理 when ≥ 2 allies are alive, a target exists and the cost can be paid; else normal attack. */
export function shokureiRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || isSummonUnit(self)) return null;
  const dish = skillById(self, "369_03");
  if (!dish) return null;
  const enough = aliveAllies(battle, self).length >= SHOKUREI.minAllies;
  const c = costOf(dish);
  if (enough && mealTargetOf(battle, self) && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c))) {
    return { skill: dish, rule: "食灵: 我方存活数量≥2 → 梦想料理" };
  }
  const basic = skillById(self, "369_01");
  return basic ? { skill: basic, rule: enough ? "食灵: 鬼火不足或无可选友方 → 普攻" : "食灵: 我方存活数量<2 → 普攻" } : null;
}

/** Target override (MAX) for 369_03: the meal target. */
export function shokureiTarget(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || x?.id !== "369_03") return null;
  const t = pickMealTarget(self, cands);
  return t ? { target: t, rule: "食灵: 优先选择暴伤最高的友方单位（暴伤相同时优先占位靠前的）" } : null;
}

/** After an active cast of 369_03 (MAX): serve the meal. */
export function shokureiAfterCast(battle: any, self: Entity, x: any): void {
  if (x?.id !== "369_03") return;
  const t = mealTargetOf(battle, self);
  if (!t) return;
  t.addStatus(MEAL_DEF(), self.id, 1, PERSIST, [{ prop: "dmgTakenD", value: -SHOKUREI.mealTaken, mode: "FIXED" }], null);
  setNote(t, MEAL_DMG, 0);
  battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: t.id, status: "bet:3693_1", name: "用餐", category: StatusCategory.COMMON_MARK, duration: 1, known: true, skill: x.name });
}

async function finishMeal(battle: any, eater: Entity): Promise<void> {
  const st = eater.statuses.find(s => s.def.id === "bet:3693_1");
  if (!st) return;
  const chef = entityById(battle, st.sourceId);
  eater.expireStatus(st);
  const dmg = Number(noteValue(eater, MEAL_DMG) ?? 0);
  setNote(eater, MEAL_DMG, null);
  setNote(eater, FULL_NOTE, `${SHOKUREI.fullTurns}:${dmg}:${chef?.id ?? -1}:${Number(battle.turn ?? 0)}`);
  const prev = eater.statuses.find(s => s.def.id === "bet:3694_1");
  if (prev) eater.expireStatus(prev);
  eater.addStatus(FULL_DEF(), chef?.id ?? eater.id, 1, PERSIST, [], null);
  eater.addStatus(SHELTER_DEF(), chef?.id ?? eater.id, 1, 1, [], null);
  battle.trace.push({ t: "MEAL_FINISHED", id: eater.id, chef: chef?.id ?? null, damage: dmg, feastIn: SHOKUREI.fullTurns, skill: "梦想料理" });
  if (chef?.alive) {
    for (const m of aliveAllies(battle, chef)) await battle.heal(chef, m, chef.prop("atk") * SHOKUREI.mealHealAtk, { crit: false });
  }
}

async function feast(battle: any, eater: Entity, dmg: number, chefId: number): Promise<void> {
  const chef = entityById(battle, chefId);
  const src = chef?.alive ? chef : eater;
  const foes = (battle.enemiesOf(eater.teamId) as Entity[]).filter(e => e.alive);
  if (!foes.length) return;
  const atk = (chef ?? eater).prop("atk");
  const each = SHOKUREI.feastRatio * dmg / foes.length + SHOKUREI.feastAtkPerEnemy * atk;
  battle.trace.push({ t: "FEAST", id: eater.id, chef: chefId, mealDamage: dmg, perEnemy: each, enemies: foes.length, skill: "飨食" });
  await battle.withinResolution({ id: "HIT:飨食#1", type: "HIT" }, async () => {
    for (const v of foes) if (v.alive) await dealUndefended(battle, src, v, each, "飨食");
  });
}

async function tickFull(battle: any, actor: Entity): Promise<void> {
  for (const e of battle.allEntities() as Entity[]) {
    const v = noteValue(e, FULL_NOTE);
    if (v === null) continue;
    const [left, dmg, chefId, opened] = v.split(":").map(Number);
    if (opened === Number(battle.turn ?? 0)) continue;
    if (left - 1 > 0) { setNote(e, FULL_NOTE, `${left - 1}:${dmg}:${chefId}:${opened}`); continue; }
    setNote(e, FULL_NOTE, null);
    const st = e.statuses.find(s => s.def.id === "bet:3694_1");
    if (st) e.expireStatus(st);
    if (!canAct(e)) { battle.trace.push({ t: "FEAST_SKIPPED", id: e.id, reason: e.alive ? "CANNOT_ACT" : "DEAD" }); continue; }
    await feast(battle, e, dmg, chefId);
  }
}

/** Highest initial crit damage among the non-summon allies other than Shokurei (lineup order on ties). */
function carryOf(battle: any, chef: Entity): Entity | null {
  const pool = (battle.teams[chef.teamId].members as Entity[]).filter(m => !isSummonUnit(m) && m.id !== chef.id);
  if (!pool.length) return null;
  return pool.reduce((a, b) => (Number(b.base.crid ?? 0) > Number(a.base.crid ?? 0) ? b : a), pool[0]);
}

const selectsSingleEnemy = (ir: any): boolean =>
  !!ir && Array.isArray(ir.damage) && ir.damage.length > 0
  && (targetModeOf(ir) === "ENEMY_ONE" || (ir.targeting ?? []).some((t: string) => /敌方目标|选定目标/.test(t)));

async function assist(battle: any, chef: Entity, ctx: any): Promise<void> {
  const target: Entity = ctx?.target;
  if (!chef.alive || !canAct(chef) || !target?.alive || target.teamId === chef.teamId) return;
  const basic = skillById(chef, "369_01");
  if (!basic) return;
  battle.trace.push({ t: "ASSIST", actor: chef.id, ally: ctx.actor.id, target: target.id, skill: basic.name, clause: "初始暴击伤害最高的友方回合内若选择敌方单体目标，食灵使用普攻进行助战" });
  await battle.runPseudoTurn(chef, TurnType.PSEUDO_TURN, { skill: basic, target });
  if (!target.alive) return;
  target.addStatus(VULN_DEF(), chef.id, 1, SHOKUREI.vulnTurns, [{ prop: "dmgTakenD", value: SHOKUREI.vuln, mode: "FIXED" }], null);
  battle.trace.push({ t: "STATUS_APPLY", src: chef.id, dst: target.id, status: "bet:3691_vuln", name: "易伤", category: StatusCategory.DEBUFF_STATE, duration: SHOKUREI.vulnTurns, known: true, skill: basic.name });
}

export function installShokurei(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const chefs = entities.filter(e => isShokurei(e) && !isSummonUnit(e));
  if (!chefs.length) return out;
  const offTurnOf = (chef: Entity) => levelNumber(skillById(chef, "369_02")?.ir, /回合外造成的伤害增加至(\d+)%/, /回合外造成的伤害增加(\d+)%/, 30) / 100;
  // 热浪: one boost per team (唯一效果) while a Shokurei of that team is alive.
  ensureGlobalHandler(battle, "betting:369:heat-wave", EV.BEFORE_DAMAGE, (ctx: any) => {
    const src: Entity = ctx?.input?.source;
    if (!src || ctx?.result?.ignoresModifiers || isSupportDamage(ctx)) return;
    const chef = chefs.find(c => c.alive && c.teamId === src.teamId);
    if (chef && !inOwnTurn(battle, src)) ctx.result.final *= 1 + offTurnOf(chef);
    if (hasMeal(src) && inOwnTurn(battle, src)) ctx.result.final *= 1 - SHOKUREI.mealDealt;
  });
  ensureGlobalHandler(battle, "betting:369:meal-damage", EV.AFTER_DAMAGE, (ctx: any) => {
    const src: Entity = ctx?.input?.source;
    if (!src || !hasMeal(src) || !inOwnTurn(battle, src)) return;
    setNote(src, MEAL_DMG, Number(noteValue(src, MEAL_DMG) ?? 0) + Number(ctx?.result?.final ?? 0));
  });
  ensureGlobalHandler(battle, "betting:369:meal-end", EV.TURN_END, async (ctx: any) => {
    const actor: Entity = ctx?.actor;
    if (actor && hasMeal(actor)) await finishMeal(battle, actor);
  });
  ensureGlobalHandler(battle, "betting:369:feast", EV.TURN_END, async (ctx: any) => { if (ctx?.actor) await tickFull(battle, ctx.actor); });
  for (const chef of chefs) {
    const carry = carryOf(battle, chef);
    out.push({ entityId: chef.id, mechanic: "热浪 / 梦想料理" + (carry ? " / 助战→" + carry.id : "") });
    if (!carry) continue;
    ensureGlobalHandler(battle, "betting:369:assist:" + chef.id, EV.SKILL_END, async (ctx: any) => {
      if (ctx?.actor?.id !== carry.id || (ctx.type !== "NORMAL" && ctx.type !== "NEW_TURN")) return;
      if (!selectsSingleEnemy(ctx.skill?.ir)) return;
      await assist(battle, chef, ctx);
    });
  }
  return out;
}
