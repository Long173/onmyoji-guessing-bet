// compile/betting-scope.ts — "where are we" helpers for the MAX-only (betting mode) support kits.
//
// Used by compile/betting-kaguya.ts, betting-hana.ts, betting-shokurei.ts. Nothing here runs in BASE mode:
// every handler is installed from installBettingSubscribers (MAX only).
//   · ownTurnActor   — id of the unit whose own turn (NORMAL / NEW_TURN) is running, null between turns and
//                      inside nobody's turn. A pseudo turn (counter / assist) does not change it, so a unit
//                      attacking in someone else's turn is "outside its turn" (回合外).
//   · currentHit     — innermost SKILL / HIT resolution scopes (ids "SKILL:<name>", "HIT:<name>#<seg>.<hit>").
//   · isAoeHit       — the damage being resolved belongs to an all-enemy (群体) part of the caster's skill.
//   · dealUndefended — damage that ignores defense, cannot crit and triggers no souls (kernel CONDUCTION type
//                      with the defense multiplier cancelled), tagged so the support kits can recognise it.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV } from "../kernel/types.ts";
import { dealDamage } from "../kernel/damage.ts";
import { targetModeOf } from "./skill-compiler.ts";
import { ensureGlobalHandler } from "./betting-shared.ts";

const ownTurn = new WeakMap<object, number | null>();

/** Tracks whose own turn is running (registered once per battle). */
export function installTurnTracker(battle: any): void {
  ensureGlobalHandler(battle, "betting:own-turn:start", EV.TURN_START, (ctx: any) => {
    if (ctx?.actor && (ctx.type === "NORMAL" || ctx.type === "NEW_TURN")) ownTurn.set(battle, ctx.actor.id);
  });
  ensureGlobalHandler(battle, "betting:own-turn:end", EV.ACTION_END, (ctx: any) => {
    // ACTION_END closes the action of a normal / new turn; pseudo turns do not reach TURN_START, so the
    // owner of the running turn is restored only when its own action ends.
    if (ctx?.actor && ownTurn.get(battle) === ctx.actor.id && (ctx.type === "NORMAL" || ctx.type === "NEW_TURN")) ownTurn.set(battle, null);
  });
}

export const ownTurnActor = (battle: any): number | null => ownTurn.get(battle) ?? null;
export const inOwnTurn = (battle: any, e: Entity | null | undefined): boolean => !!e && ownTurnActor(battle) === e.id;

/** Innermost SKILL and HIT scopes of the running resolution (null when the damage comes from outside a skill). */
export function currentHit(battle: any): { skill: string | null; hit: string | null } {
  const stack: any[] = battle?.resolutionStack ?? [];
  let skill: string | null = null, hit: string | null = null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i];
    if (!hit && s?.type === "HIT") hit = String(s.id);
    if (s?.type === "SKILL") { skill = String(s.id).replace(/^SKILL:/, ""); break; }
  }
  return { skill, hit };
}

/** Skill object of `src` that is being resolved, or null. */
export function currentSkillOf(battle: any, src: Entity): any {
  const { skill } = currentHit(battle);
  if (!skill) return null;
  return (src?.skills ?? []).find((s: any) => s?.name === skill) ?? null;
}

/** Segment number (1-based) of the running HIT scope of a segmented skill, or null. */
export function currentSegment(battle: any, skillName: string): number | null {
  const { hit } = currentHit(battle);
  if (!hit || !hit.startsWith("HIT:" + skillName + "#")) return null;
  const m = hit.slice(("HIT:" + skillName + "#").length).match(/^(\d+)\.\d+$/);
  return m ? Number(m[1]) : null;
}

/** true when the running hit of `src` is an all-enemy part of its skill (群体伤害). */
export function isAoeHit(battle: any, src: Entity): boolean {
  const sk = currentSkillOf(battle, src);
  const ir = sk?.ir;
  if (!ir) return false;
  const segs: any[] = Array.isArray(ir.damageSegments) ? ir.damageSegments : [];
  if (segs.length >= 2) {
    const n = currentSegment(battle, sk.name);
    return n !== null && segs[n - 1]?.scope === "ENEMY_ALL";
  }
  return targetModeOf(ir) === "ENEMY_ALL";
}

/** Tag prefix of the damages dealt by the support kits (painting transfer, feast). */
export const SUPPORT_TAG = "betting-support:";
export const isSupportDamage = (ctx: any): boolean => String(ctx?.input?.skillTag ?? "").startsWith(SUPPORT_TAG);

/**
 * Damage that ignores defense, cannot crit and does not trigger souls: the kernel CONDUCTION type (no crit,
 * no soul trigger) with its defense multiplier cancelled. Damage modifiers and the referee multiplier apply.
 */
export async function dealUndefended(battle: any, src: Entity, dst: Entity, amount: number, tag: string): Promise<any> {
  if (!dst?.alive || !(amount > 0)) return null;
  const def = Math.max(0, Number(dst.prop("def") ?? 0));
  const base = amount * (300 + def) / 300;
  return dealDamage(battle, { source: src, target: dst, base, rate: 1, type: DamageType.CONDUCTION, skillTag: SUPPORT_TAG + tag });
}
