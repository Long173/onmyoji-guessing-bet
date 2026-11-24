// compile/betting-kujira.ts — 久次良 (SR 332, Global "Bake-kujira") at max skill level. MAX mode only (match 13).
//
// Sources: data/kb/shikigami.json 332_01..332_03, tips_3320 骨盾 ("减少单个回合内40%受到的暴击伤害，受到暴击伤害后，于回合结束
// 时消失"), tips_18 真实伤害, data/kb/ai.json row 332 ("3技能"); data/kb/en-text.json (Global, same meaning). Before this
// module 鲸骨·驻 dealt 80% + a mis-based 10% ATK, 骨盾 / 以守为攻 / the 鱼鳞之备 aura never ran and the stance never changed.
//   骨盾 (tips_3320) · −40% crit damage taken; after taking crit damage it disappears at the end of that turn.
//   Defense stance (start):
//   鲸骨·驻 (332_01) · on his own turn, before attacking: 骨盾 to every ally; then 100% ATK (L5). If every ally already had
//        骨盾 when it was applied: + true damage 10% of the target's max HP (cap 120% of his ATK).
//   以守为攻 (332_02, passive, unique) · an ally without 骨盾 takes non-conducted damage from an enemy ⇒ that ally gets 骨盾 and
//        he counterattacks the source; one per turn.
//   鱼鳞之备 (332_03, passive part, unique) · all allies +20% effect RES, +20% DEF (L2/L3); after each ally's turn: 80% to
//        gain 骨盾 — if it already has one, it heals 15% of its lost HP instead (cap 120% of his ATK).
//   鱼鳞之备 (332_03, 3, cast) · switch to Offense stance; every ally +30% bar (L4), himself +60% (L5).
//   Offense stance: 「鲸骨·开」/「协同作战」/「方圆之备」 replace the three skills — their texts are NOT in the KB
//        (data/kb has only the Defense-stance skills). Modelled minimally: the S1 is a plain 100% ATK hit, the passive and
//        the 鱼鳞之备 aura are off, and the S3 (3 onibi) switches back to Defense stance (no other effect).
//   AI (KB) · "3技能" every turn (the generic KB rule already does this: 鱼鳞之备 / 方圆之备 whenever affordable) — not
//        hand-written. So he alternates stances whenever the team has 3 onibi for him.
// Readings (unverified — noted in the report):
//   · "一回合" for the passive = one battle turn (battle.turn): the first unmarked ally hit in a turn gets the mark and
//     the counter, later ones in the same turn get nothing. Counter = Battle.counterAttack (no chain, not when he cannot
//     act); untargetable sources are not countered; status ticks / soul / reflected damage are not "受到伤害" attacks.
//   · Turn-end rule: the 80% roll comes first; on success an ally that already has 骨盾 heals instead of gaining it.
//     The alternative (already marked ⇒ always heal, no roll) heals a bit more.
//   · 骨盾 never expires on its own (no duration in the text); it is not dispellable (special mechanic).
//   · The aura follows him: it is removed when he dies or switches to Offense stance.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import type { BettingKit, Hook, Installed } from "./betting-m7.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, noteValue, setNote,
  shiftBar, untargetableInBetting, STATUS_TICK_TAG, passiveSuppressed,
} from "./betting-shared.ts";
import { inOwnTurn } from "./betting-scope.ts";

export const KUJIRA = Object.freeze({
  basicRatio: 100, trueHpRatio: 0.1, trueCapAtk: 1.2, critCut: 0.4, auraRes: 0.2, auraDef: 0.2, markChance: 0.8,
  healLost: 0.15, healCapAtk: 1.2, allyBar: 0.3, selfBar: 0.6,
});
export const BONE_ID = "3320_bone", AURA_ID = "332_scale_aura";
const N_STANCE = "kuj332:stance=", N_COUNTER = "kuj332:counter=", N_CRIT = "kuj332:crit-hit";

const boneDef = () => markDef({ id: BONE_ID, name: "骨盾", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL", dispellable: false, removable: false,
  desc: "久次良的特殊机制，减少单个回合内40%受到的暴击伤害，受到暴击伤害后，于回合结束时消失。" }, StatusBook);
const auraDef = () => markDef({ id: AURA_ID, name: "鱼鳞之备·守备", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL", dispellable: false, removable: false,
  desc: "守备姿态下，友方全体提升20%效果抵抗，20%防御。" }, StatusBook);

export const isKujira = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "332_02") && !!skillById(e, "332_03");
export const stanceOf = (e: Entity): "DEFENSE" | "OFFENSE" => (noteValue(e, N_STANCE) === "OFFENSE" ? "OFFENSE" : "DEFENSE");
const defenseOn = (k: Entity): boolean => k.alive && stanceOf(k) === "DEFENSE";
export const hasBone = (e: Entity): boolean => e.statuses.some(s => s.def.id === BONE_ID);
const allies = (battle: any, k: Entity): Entity[] => battle.teams[k.teamId].aliveMembers() as Entity[];

/** 骨盾 on `a` (no-op when it already has one). Returns true when newly applied. */
export function giveBone(battle: any, k: Entity, a: Entity, skill: string): boolean {
  if (!a?.alive || hasBone(a)) return false;
  const r = a.addStatus(boneDef(), k.id, 1, PERSIST, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: k.id, dst: a.id, status: BONE_ID, name: "骨盾", category: StatusCategory.COMMON_MARK, duration: null, ref: "tips_3320", known: true, tag: (r as any)?.tag ?? null, skill });
  return true;
}

/** Defense-stance aura on every living ally (idempotent), or removed (Offense stance / death). */
export function syncAura(battle: any, k: Entity): void {
  const on = defenseOn(k) && !passiveSuppressed(k);
  for (const a of battle.teams[k.teamId].members as Entity[]) {
    const st = a.statuses.find(s => s.def.id === AURA_ID && s.sourceId === k.id);
    if (on && a.alive && !st) a.addStatus(auraDef(), k.id, 1, PERSIST, [{ prop: "efr", value: KUJIRA.auraRes, mode: "FIXED" }, { prop: "def", value: KUJIRA.auraDef, mode: "ADD_RATE" }], 1);
    if ((!on || !a.alive) && st) a.expireStatus(st);
  }
}

export function setStance(battle: any, k: Entity, stance: "DEFENSE" | "OFFENSE", skill: string): void {
  if (stanceOf(k) === stance) return;
  setNote(k, N_STANCE, stance);
  battle.trace.push({ t: "FORM_CHANGE", id: k.id, form: stance === "OFFENSE" ? "进攻姿态" : "守备姿态", skill });
  syncAura(battle, k);
}

/** 鲸骨·驻 (Defense) / 鲸骨·开 (Offense, text unknown: plain 100% hit). */
function whaleboneHook(x: any): Hook | null {
  if (x?.id !== "332_01") return null;
  return {
    kind: "WHALEBONE",
    run: async (battle, k, hurt, primary) => {
      const t = primary?.alive && primary.teamId !== k.teamId ? primary : battle.enemiesOf(k.teamId).find((v: Entity) => v.alive);
      if (!t) return;
      let bonus = false;
      if (isKujira(k) && defenseOn(k) && inOwnTurn(battle, k)) {
        const team = allies(battle, k);
        bonus = team.length > 0 && team.every(hasBone);
        for (const a of team) giveBone(battle, k, a, x.name);
      }
      hurt.push(t);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        await battle.damage(k, t, k.prop("atk") * KUJIRA.basicRatio / 100, DamageType.NORMAL, 1, x.lifesteal ?? null);
        if (bonus && t.alive) {
          const amt = Math.min(t.maxHp * KUJIRA.trueHpRatio, k.prop("atk") * KUJIRA.trueCapAtk);
          battle.trace.push({ t: "PASSIVE_PROC", actor: k.id, skill: x.name, effect: "友方全体均已拥有骨盾：额外真实伤害", target: t.id });
          await battle.damage(k, t, amt, DamageType.TRUE, 1, null);
        }
      });
    },
  };
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "332_03" || !isKujira(self)) return false;
  if (stanceOf(self) === "OFFENSE") {   // 「方圆之备」 (text unknown): back to Defense stance
    setStance(battle, self, "DEFENSE", "方圆之备");
    return true;
  }
  setStance(battle, self, "OFFENSE", x.name);
  for (const a of allies(battle, self)) shiftBar(battle, a, a.id === self.id ? KUJIRA.selfBar : KUJIRA.allyBar, x.name);
  return true;
}

/** 以守为攻: an unmarked ally takes enemy damage ⇒ mark + counter, once per turn. */
async function onAllyHit(battle: any, k: Entity, ctx: any): Promise<void> {
  const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
  if (!src || !dst?.alive || !defenseOn(k) || src.teamId === k.teamId || dst.teamId !== k.teamId) return;
  const t = ctx?.result?.type ?? ctx?.input?.type;
  const tag = String(ctx.input.skillTag ?? "");
  if (t === DamageType.CONDUCTION || tag.startsWith("soul:") || tag.startsWith("reflect:") || tag.startsWith(STATUS_TICK_TAG)) return;
  if (hasBone(dst)) return;
  if (noteValue(k, N_COUNTER) === String(battle.turn)) return;
  setNote(k, N_COUNTER, battle.turn);
  giveBone(battle, k, dst, "以守为攻");
  if (!src.alive || untargetableInBetting(src) || isActionPrevented(k.statusDefs())) return;
  await battle.counterAttack(k, src.id);
}

async function allyTurnEnd(battle: any, k: Entity, a: Entity): Promise<void> {
  if (!defenseOn(k) || !a?.alive || a.teamId !== k.teamId || isSummonUnit(a)) return;
  battle.rng.expect("kujira332_mark");
  if (!battle.rng.testHit(KUJIRA.markChance)) return;
  if (!hasBone(a)) { giveBone(battle, k, a, "鱼鳞之备"); return; }
  const lost = Math.max(0, a.maxHp - a.hp);
  const amt = Math.min(lost * KUJIRA.healLost, k.prop("atk") * KUJIRA.healCapAtk);
  if (amt > 0) await battle.heal(k, a, amt, { crit: false });
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isKujira);
  if (!units.length) return out;
  // 骨盾: −40% crit damage; a crit-hit bearer loses it at the end of the turn.
  ensureGlobalHandler(battle, "betting:332:bone", EV.BEFORE_DAMAGE, (ctx: any) => {
    const dst: Entity | undefined = ctx?.input?.target, res = ctx?.result;
    if (!dst?.alive || !res?.isCrit || !hasBone(dst) || !(Number(res.final ?? 0) > 0)) return;
    res.final *= 1 - KUJIRA.critCut;
    if (!dst.notes.includes(N_CRIT)) dst.notes.push(N_CRIT);
  });
  ensureGlobalHandler(battle, "betting:332:bone-expire", EV.TURN_END, () => {
    for (const e of battle.allEntities() as Entity[]) {
      if (!e.notes?.includes(N_CRIT)) continue;
      e.notes = e.notes.filter(n => n !== N_CRIT);
      const st = e.statuses.find(s => s.def.id === BONE_ID);
      if (st && e.expireStatus(st)) battle.trace.push({ t: "STATUS_EXPIRE", id: e.id, status: BONE_ID, name: "骨盾", reason: "CRIT_TAKEN" });
    }
  });
  for (const k of units) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = true) =>
      registerOwnerHandler(battle, "betting:332:" + code + ":" + k.id, k.id, code, fn, range, { passive });
    syncAura(battle, k);
    reg(EV.AFTER_DAMAGE, (ctx: any) => onAllyHit(battle, k, ctx));
    reg(EV.TURN_END, async (ctx: any) => {
      if (ctx?.type && ctx.type !== "NORMAL" && ctx.type !== "NEW_TURN") return;
      await allyTurnEnd(battle, k, ctx?.actor);
    });
    // The aura leaves with him (death) and follows seals; checked again at every turn start.
    ensureGlobalHandler(battle, "betting:332:aura:" + k.id, EV.TURN_START, () => syncAura(battle, k));
    ensureGlobalHandler(battle, "betting:332:aura-death:" + k.id, EV.DEATH, () => syncAura(battle, k));
    out.push({ entityId: k.id, mechanic: "骨盾 (−40% crit damage) · 鲸骨·驻 (marks, true-damage bonus) · 以守为攻 (mark + counter, 1/turn) · 鱼鳞之备 (aura +20% RES/DEF, turn-end 80% mark / heal; cast: Offense stance, +30%/+60% bar) · Offense stance minimal" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "332_01": { note: "鲸骨·驻: an enemy target; marks, the true-damage bonus and the Offense-stance hit are run by betting-kujira.ts", patch: { targeting: ["敌方目标"] } },
    "332_03": { note: "鱼鳞之备: stance switch and the +30% / +60% bar are run by betting-kujira.ts", patch: { timeline: [] } },
  }),
  damageHook: (x: any) => (bettingActive() ? whaleboneHook(x) : null),
  afterCast,
  install,
};
