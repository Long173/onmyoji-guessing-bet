// soul/custom-effects-betting.ts — 4-piece souls hand-written for betting mode (MAX) only: 日女巳时 / 三味 / 骰子鬼 / 隐念.
//
// The generic text interpreter installs none of them (run-lineup listed them as "NOT simulated"). They are
// registered through soul/custom-effects.ts (CUSTOM_SOULS + BETTING_ONLY_SOULS), which passes its own helpers
// in, so the event registration and the soul rules stay in one place. In BASE mode they are never installed.
//
// Sources: data/kb/soul.json (CN), data/kb/en-text.json soul:10 / soul:4 / soul:24 (Global text, preferred),
// fandom "Dawn Fairy" / "Samisen" / "Dice Sprite".
//   日女巳时 Dawn Fairy  · on dealing damage: 20% chance to push the target's action bar back 30%; 30% when the
//                         target bears a buff (status or mark). Wiki trivia: no trigger when a shield absorbed
//                         the whole hit (the target "did not take damage") ⇒ applied HP damage is required.
//   三味 Samisen        · when any ally receives a control effect or banishment: that ally gains +30 SPD for
//                         2 turns, non-dispellable, max 2 stacks (Global / CN: "使其" = that ally; the wiki's
//                         "the equipper's speed" reading is not used).
//   骰子鬼 Dice Sprite  · when the wearer resists (EV.RESIST): counter-attacks the source with +50% damage.
//                         When it receives a control effect while not already controlled: +25% action bar.
//   隐念 Possessor      · damage dealt +20%; dealing damage to the same target again raises it to +40%, then +60%,
//                         then the cycle restarts at +20% (独立乘区: a separate multiplier on the final damage).
//                         Read as a per-target counter of the wearer's soul-triggering hits that persists for the
//                         whole battle (switching targets does not reset it; the text names no reset).
import { EV, StatusCategory } from "../kernel/types.ts";
import type { EventRange } from "../kernel/types.ts";
import { StatusBook, incomingKinds } from "../kernel/status.ts";
import type { StatusDef } from "../kernel/status.ts";
import { shiftBar, isControlDef, noteValue, setNote } from "../compile/betting-shared.ts";

/** What soul/custom-effects.ts hands over (its own helpers; nothing is re-implemented here). */
export interface BettingSoulHelpers {
  register: (c: any, code: string, range: EventRange, fn: (ctx: any) => unknown) => void;
  roll: (c: any, chance: number, what: string) => boolean;
  proc: (c: any, dst: number | null, effect: string) => void;
  countsAsSoulDamage: (ctx: any) => boolean;
  isUp: (e: any) => boolean;
  soulSkill: (c: any) => string;
}

export const BETTING_SOUL_NUMBERS = Object.freeze({
  dawnChance: 0.2, dawnBuffedChance: 0.3, dawnPush: 0.3,
  samisenSpd: 30, samisenTurns: 2, samisenCap: 2,
  diceCounterBonus: 0.5, diceBar: 0.25,
  possessorSteps: [0.2, 0.4, 0.6] as readonly number[],
});

/** 隐念: per-target hit counter, kept in the wearer's notes (saved with the state). */
const POSSESSOR_NOTE = (targetId: number) => "soul-possessor:" + targetId + "=";

export const SAMISEN_ID = "SOUL_SAMISEN_SPD";
const samisenDef = (): StatusDef => {
  const known = StatusBook.get(SAMISEN_ID);
  if (known) return known;
  const def: StatusDef = {
    id: SAMISEN_ID, name: "三味·加速", category: StatusCategory.BUFF_STATE,
    dispellable: false, removable: false, preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "TARGET_TURN",
    desc: "三味（4件套）：速度提升30点，持续2回合，不可驱散，可叠加2层",
  };
  StatusBook.set(SAMISEN_ID, def);
  return def;
};

const isBuff = (st: any): boolean => String(st?.def?.category ?? "").startsWith("BUFF");
const isControlOrBanish = (def: StatusDef | undefined): boolean =>
  !!def && (isControlDef(def) || incomingKinds(def, false).includes("CONTROL") || incomingKinds(def, false).includes("BANISH"));
const controlledNow = (e: any, except: string): boolean =>
  (e?.statuses ?? []).some((s: any) => s.def.id !== except && isControlOrBanish(s.def));

/** Counter-attacks running with the Dice Sprite bonus (transient; removed right after the counter). */
const DICE_BONUS_SRC = "soul-dice:counter";

export function makeBettingSouls(h: BettingSoulHelpers): Record<string, (c: any) => void> {
  const dawnFairy = (c: any) => {
    h.register(c, EV.AFTER_DAMAGE, "SELF", ctx => {
      if (!h.countsAsSoulDamage(ctx)) return;
      const t = ctx.input.target;
      if (!h.isUp(t) || t.teamId === c.owner.teamId || !(ctx.result.applied > 0)) return;
      const buffed = (t.statuses ?? []).some(isBuff);
      const p = buffed ? BETTING_SOUL_NUMBERS.dawnBuffedChance : BETTING_SOUL_NUMBERS.dawnChance;
      if (!h.roll(c, p, "push")) return;
      c.fired("日女巳时:push");
      h.proc(c, t.id, `push back 30% action bar (${p * 100}%${buffed ? ", target buffed" : ""})`);
      shiftBar(c.battle, t, -BETTING_SOUL_NUMBERS.dawnPush, h.soulSkill(c));
    });
  };

  const samisen = (c: any) => {
    h.register(c, EV.STATUS_ADD, "ALL", ctx => {
      const e = ctx?.entity;
      if (!e || e.teamId !== c.owner.teamId || !h.isUp(e) || !h.isUp(c.owner) || ctx.merged) return;
      const def = StatusBook.get(String(ctx.status ?? "")) ?? e.statuses.find((s: any) => s.def.id === ctx.status)?.def;
      if (!isControlOrBanish(def)) return;
      const sd = samisenDef();
      const before = e.statuses.find((s: any) => s.def.id === SAMISEN_ID && s.sourceId === c.owner.id)?.stacks ?? 0;
      const effects = before < BETTING_SOUL_NUMBERS.samisenCap ? [{ prop: "spd", value: BETTING_SOUL_NUMBERS.samisenSpd, mode: "FIXED" as const }] : [];
      // "持续2回合": the bearer's own turn after the control counts (TARGET_TURN, the current turn excluded).
      e.addStatus(sd, c.owner.id, 1, BETTING_SOUL_NUMBERS.samisenTurns, effects, BETTING_SOUL_NUMBERS.samisenCap);
      const after = e.statuses.find((s: any) => s.def.id === SAMISEN_ID && s.sourceId === c.owner.id)?.stacks ?? 0;
      c.battle.trace.push({ t: "STATUS_APPLY", src: c.owner.id, dst: e.id, status: SAMISEN_ID, name: sd.name, category: sd.category, duration: BETTING_SOUL_NUMBERS.samisenTurns, known: true, stacks: after, skill: h.soulSkill(c) });
      c.fired("三味:spd");
      h.proc(c, e.id, `+30 SPD for 2 turns (${after}/2 stacks) after ${def?.name ?? ctx.status}`);
    });
  };

  const diceSprite = (c: any) => {
    h.register(c, EV.RESIST, "SELF", async ctx => {
      const { battle, owner } = c;
      const src = ctx?.source;
      if (ctx?.target?.id !== owner.id || !src || src.teamId === owner.teamId || !h.isUp(src) || !h.isUp(owner)) return;
      c.fired("骰子鬼:counter");
      h.proc(c, src.id, "counter-attack +50% damage (resisted)");
      owner.addModifier({ prop: "dmgDealtB", value: BETTING_SOUL_NUMBERS.diceCounterBonus, mode: "FIXED", source: DICE_BONUS_SRC });
      try { await battle.counterAttack(owner, src.id); } finally { owner.removeModifiersBySource(DICE_BONUS_SRC); }
    });
    h.register(c, EV.STATUS_ADD, "SELF", ctx => {
      const e = ctx?.entity;
      if (!e || e.id !== c.owner.id || !h.isUp(e) || ctx.merged) return;
      const def = StatusBook.get(String(ctx.status ?? "")) ?? e.statuses.find((s: any) => s.def.id === ctx.status)?.def;
      if (!def || !isControlDef(def) || controlledNow(e, def.id)) return;
      c.fired("骰子鬼:bar");
      h.proc(c, e.id, "+25% action bar (control received while not controlled)");
      shiftBar(c.battle, e, BETTING_SOUL_NUMBERS.diceBar, h.soulSkill(c));
    });
  };

  const possessor = (c: any) => {
    h.register(c, EV.BEFORE_DAMAGE, "SELF", ctx => {
      if (!h.countsAsSoulDamage(ctx) || ctx.result.ignoresModifiers) return;
      const t = ctx.input.target;
      if (!t || t.teamId === c.owner.teamId) return;
      const steps = BETTING_SOUL_NUMBERS.possessorSteps;
      const n = Number(noteValue(c.owner, POSSESSOR_NOTE(t.id)) ?? 0);
      const bonus = steps[n % steps.length];
      setNote(c.owner, POSSESSOR_NOTE(t.id), n + 1);
      ctx.result.final *= 1 + bonus;
      c.fired("隐念:boost");
      h.proc(c, t.id, `damage x${1 + bonus} (hit ${n + 1} on this target)`);
    });
  };

  return { 日女巳时: dawnFairy, 三味: samisen, 骰子鬼: diceSprite, 隐念: possessor };
}

export const BETTING_SOUL_NOTES: Readonly<Record<string, string>> = Object.freeze({
  日女巳时: "custom (MAX only): wearer deals soul-triggering damage that reaches HP → 20% (30% vs a buffed target) push back 30% action bar",
  三味: "custom (MAX only): an ally receives a control or banishment → that ally +30 SPD for 2 of its turns, non-dispellable, max 2 stacks",
  隐念: "custom (MAX only): wearer's soul-triggering damage x1.2 / x1.4 / x1.6 cycling per target (per-target hit counter for the whole battle; independent multiplier)",
  骰子鬼: "custom (MAX only): wearer resists (EV.RESIST) → counter-attack the source with +50% damage; control received while not controlled → +25% action bar",
});
