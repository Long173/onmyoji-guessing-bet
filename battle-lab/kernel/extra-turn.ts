// kernel/extra-turn.ts — producer of TurnType.NEW_TURN ("获得新的回合" / extra turn).
//
// Why a queue: the rule that grants an extra turn usually fires inside the current turn (轮入道 at
// "回合结束时"). Running the new turn right there would nest it inside the old one, before the old
// turn's status timers tick. So a grant is queued and Battle.run / runPartial play it right after the
// current turn has completely finished (Battle.runExtraTurns).
//
// The queue is not part of the saved state on purpose: it is always empty at a turn boundary (it is
// drained before the loop advances the action bar again), which is where states are saved / restored.
// Nothing in BASE mode grants extra turns except the 轮入道 soul, so an empty queue changes nothing.
import type { Entity } from "./entity.ts";

export interface ExtraTurnGrant { id: number; reason: string }

const queues = new WeakMap<object, ExtraTurnGrant[]>();

/** Queue one extra turn for `actor` (played after the current turn ends). */
export function grantExtraTurn(battle: any, actor: Entity, reason: string): void {
  const q = queues.get(battle) ?? [];
  q.push({ id: actor.id, reason });
  queues.set(battle, q);
  battle.trace?.push({ t: "EXTRA_TURN_GRANTED", actor: actor.id, reason, queued: q.length });
}

/** Next queued grant (FIFO), or null. */
export function takeExtraTurn(battle: any): ExtraTurnGrant | null {
  const q = queues.get(battle);
  return q && q.length ? q.shift()! : null;
}

/** Drops every pending grant (battle over / turn limit reached). */
export function clearExtraTurns(battle: any): number {
  const q = queues.get(battle);
  const n = q?.length ?? 0;
  if (q) q.length = 0;
  return n;
}

export function pendingExtraTurns(battle: any): number {
  return queues.get(battle)?.length ?? 0;
}
