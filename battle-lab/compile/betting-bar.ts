// compile/betting-bar.ts — "when a unit's action bar is increased" for the MAX-only (betting mode) kits.
//
// Used by compile/betting-garuda.ts (迦楼罗 惜羽) and compile/betting-momiji.ts (心狩鬼女红叶 经霜 L4 / 红蚀).
// The kernel timeline has no bar-change event; kernel/timeline.ts exposes `shiftHook` (null in BASE mode).
//   · adjust   — scalers of a positive change (红蚀: "move bar increasing effects -50%"), multiplied.
//   · increase — reactions to a positive change that landed. They run at the next safe point (end of the
//                running skill, action, turn start or turn end), not inside the synchronous shift() call, so a
//                reaction may attack (pseudo turn) or apply statuses with the usual events.
import type { Entity } from "../kernel/entity.ts";
import { EV } from "../kernel/types.ts";
import { ensureGlobalHandler } from "./betting-shared.ts";

type Adjust = (e: Entity, percent: number) => number;
type React = (e: Entity, percent: number) => Promise<void> | void;
interface BarState { adjust: Map<string, Adjust>; react: Map<string, React>; pending: Array<{ id: number; percent: number }>; flushing: boolean; flush: () => Promise<void>; hook: any }

const states = new WeakMap<object, BarState>();

function stateOf(battle: any): BarState {
  let st = states.get(battle);
  if (st) {
    if (battle.timeline.shiftHook !== st.hook) battle.timeline.shiftHook = st.hook;   // timeline rebuilt (restore)
    return st;
  }
  st = { adjust: new Map(), react: new Map(), pending: [], flushing: false, flush: async () => {}, hook: null };
  states.set(battle, st);
  const s = st;
  const find = (id: number): Entity | null => battle.allEntities().find((x: Entity) => x.id === id) ?? null;
  s.hook = {
    adjust: (id: number, percent: number) => {
      if (!(percent > 0) || !s.adjust.size) return percent;
      const e = find(id);
      if (!e) return percent;
      let p = percent;
      for (const fn of s.adjust.values()) p = fn(e, p);
      return p;
    },
    after: (id: number, percent: number) => {
      if (percent > 0 && s.react.size) s.pending.push({ id, percent });
    },
  };
  battle.timeline.shiftHook = s.hook;
  const flush = async () => {
    if (s.flushing || !s.pending.length) return;
    s.flushing = true;
    try {
      while (s.pending.length) {
        const { id, percent } = s.pending.shift()!;
        const e = find(id);
        if (!e?.alive) continue;
        for (const fn of [...s.react.values()]) await fn(e, percent);
      }
    } finally {
      s.flushing = false;
    }
  };
  s.flush = flush;
  for (const code of [EV.SKILL_END, EV.ACTION_END, EV.TURN_START, EV.TURN_END]) {
    ensureGlobalHandler(battle, "betting:bar-up:" + code, code, flush);
  }
  return st;
}

/** Scales positive action-bar changes (registered once per key). */
export function onBarAdjust(battle: any, key: string, fn: Adjust): void { stateOf(battle).adjust.set(key, fn); }

/** Reacts to a positive action-bar change of any unit (registered once per key). */
export function onBarIncrease(battle: any, key: string, fn: React): void { stateOf(battle).react.set(key, fn); }

/** Runs the pending reactions now (tests). */
export async function flushBarReactions(battle: any): Promise<void> {
  await states.get(battle)?.flush();
}
