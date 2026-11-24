// soul/custom-effects-betting.ts — 4-piece souls hand-written for betting mode (MAX) only: 日女巳时 / 三味 / 骰子鬼 / 隐念 /
// 魍魉之匣 / 薙魂 / 涂佛 / 元兴寺.
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
//   魍魉之匣 Mimic       · when the wearer deals damage (soul-triggering, to an enemy, applied + absorbed > 0 — a hit
//                         fully absorbed by a shield still "deals damage"; an immune hit does not), 25% base chance
//                         (effect hit vs effect RES, betting resist policy) to apply ONE of 眩晕 / 沉默 / 减疗40% / 混乱
//                         picked uniformly at random, for 1 turn. Every hit of a multi-hit skill rolls (fandom
//                         trivia). The 1 turn is counted on the bearer's turns (TARGET_TURN, as the betting kits'
//                         controls: compile/betting-fengyang.ts bearerTurnControl); the soul helpers' default
//                         SOURCE_TURN would expire a control applied in the wearer's own turn at that turn's end.
//   薙魂 Soul Edge       · 唯一效果: when an ally (not the wearer) is attacked by an enemy's single-target hit (the
//                         all-enemy parts of a skill are not single-target), 50% chance to guard it for the rest of
//                         that attack (one roll per attack and target; at most one guard per attack): each such hit is
//                         reduced by 20%, then 50% of it is shared — the ally takes half, the wearer takes the same
//                         amount as FIXED damage that triggers no souls (fandom: computed on the ally, the wearer's
//                         DEF does not matter). Global/KB 50% (fandom 40%). Indirect damage cannot be shared.
//   涂佛 Nuribotoke      · 唯一效果: at the end of the wearer's own turn, if it used its normal attack (the 0-onibi skill)
//                         during that turn or was unable to act at its turn start: every living non-summon ally gets
//                         +15% effect RES and +15% damage (additive dmgDealtB), the wearer +30% / +30%, for 2 of the
//                         bearer's turns (TARGET_TURN), refreshed (not stacked) by a new trigger. Unique per team.
//   元兴寺 Bell-Haunt    · 唯一效果 (match 12): during the wearer's own turn, every enemy hit by a control effect the wearer
//                         applies (one count per target per skill resolution, "单次控制重复命中同目标时，仅生效1次") gives
//                         every living non-summon ally +5% damage (additive dmgDealtB), max +40% (8 stacks), for 2 of the
//                         bearer's turns (TARGET_TURN), the duration refreshed by a new stack. "Control effect" = the 16
//                         official controls (kernel CONTROL_EFFECTS / isControlDef); 寻森小鹿男's 牵缠 is not one of them, so it
//                         does not count (conservative; see compile/betting-shishio551.ts). A resisted / immune control
//                         never lands, so it does not count ("命中").
//   海月火玉 Wispzoa     · (match 15) when the wearer casts a 妖术 (an attack skill whose effective onibi cost is > 0) and its
//                         side holds at least cost + 1 onibi at the cast start (EV.SKILL_START, before the payment):
//                         1 extra onibi is removed and every damage of that cast is x1.4 (独立乘区: separate multiplier).
//                         Counters / forced basic attacks (cost 0) never trigger it; a non-attack skill does not
//                         dispatch SKILL_START, so it never pays the extra onibi (it has no damage to boost).
import { EV, StatusCategory } from "../kernel/types.ts";
import type { EventRange } from "../kernel/types.ts";
import { StatusBook, incomingKinds } from "../kernel/status.ts";
import type { StatusDef } from "../kernel/status.ts";
import { shiftBar, isControlDef, noteValue, setNote, untargetableInBetting } from "../compile/betting-shared.ts";
import { isAoeHit, currentHit, inOwnTurn } from "../compile/betting-scope.ts";
import { bearerTurnControl } from "../compile/betting-fengyang.ts";
import { dealDamage } from "../kernel/damage.ts";
import { DamageType } from "../kernel/types.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { bettingCostOf } from "../compile/betting-mechanics.ts";

/** What soul/custom-effects.ts hands over (its own helpers; nothing is re-implemented here). */
export interface BettingSoulHelpers {
  register: (c: any, code: string, range: EventRange, fn: (ctx: any) => unknown) => void;
  roll: (c: any, chance: number, what: string) => boolean;
  proc: (c: any, dst: number | null, effect: string) => void;
  countsAsSoulDamage: (ctx: any) => boolean;
  isUp: (e: any) => boolean;
  soulSkill: (c: any) => string;
  /** Status application with the skill rules (contest, immunity, refresh without stacking effects). */
  applyStatus?: (c: any, victim: any, def: StatusDef, chance: number | null, duration: number,
                 effects?: Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE" }>) => Promise<boolean>;
}

export const BETTING_SOUL_NUMBERS = Object.freeze({
  dawnChance: 0.2, dawnBuffedChance: 0.3, dawnPush: 0.3,
  samisenSpd: 30, samisenTurns: 2, samisenCap: 2,
  diceCounterBonus: 0.5, diceBar: 0.25,
  possessorSteps: [0.2, 0.4, 0.6] as readonly number[],
  mimicChance: 0.25, mimicTurns: 1, mimicHealDown: 0.4,
  edgeChance: 0.5, edgeCut: 0.2, edgeShare: 0.5,
  nuriBuff: 0.15, nuriTurns: 2,
  bellStep: 0.05, bellCap: 8, bellTurns: 2,
  wispExtra: 1, wispBoost: 0.4,
});

export const BELL_HAUNT_ID = "SOUL_BELL_HAUNT";
const bellDef = (): StatusDef => {
  const known = StatusBook.get(BELL_HAUNT_ID);
  if (known) return known;
  const def: StatusDef = {
    id: BELL_HAUNT_ID, name: "元兴寺", category: StatusCategory.BUFF_STATE,
    dispellable: true, removable: true, preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "TARGET_TURN",
    desc: "元兴寺（4件套）：造成的伤害提升5%（每层），最多40%，持续2回合",
  };
  StatusBook.set(BELL_HAUNT_ID, def);
  return def;
};
/** Sensitivity switch only (default false = the conservative reading): count 寻森小鹿男's 牵缠 as a control for 元兴寺. */
export const BELL_COUNTS_ENTANGLE = { value: false };
/** 元兴寺 唯一效果: the first wearer of each team acts (battle → team → wearer id). */
const bellHolder = new WeakMap<object, Map<number, number>>();

export const NURIBOTOKE_ID = "SOUL_NURIBOTOKE";
const nuriDef = (): StatusDef => {
  const known = StatusBook.get(NURIBOTOKE_ID);
  if (known) return known;
  const def: StatusDef = {
    id: NURIBOTOKE_ID, name: "涂佛", category: StatusCategory.BUFF_STATE,
    dispellable: true, removable: true, preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "TARGET_TURN",
    desc: "涂佛（4件套）：效果抵抗、伤害提升15%（佩戴者双倍），持续2回合",
  };
  StatusBook.set(NURIBOTOKE_ID, def);
  return def;
};
/** 涂佛 唯一效果: the first wearer of each team acts (battle → team → wearer id). */
const nuriHolder = new WeakMap<object, Map<number, number>>();

/** 魍魉之匣's 40% heal reduction (no KB buff ⇒ synthetic status, registered for restore). */
export const MIMIC_HEALDOWN_ID = "SOUL_MIMIC_HEALDOWN";
const mimicHealDownDef = (): StatusDef => {
  const known = StatusBook.get(MIMIC_HEALDOWN_ID);
  if (known) return known;
  const def: StatusDef = {
    id: MIMIC_HEALDOWN_ID, name: "减疗", category: StatusCategory.DEBUFF_STATE,
    dispellable: true, removable: true, preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "TARGET_TURN",
    desc: "魍魉之匣（4件套）：受到的治疗降低40%，持续1回合",
  };
  StatusBook.set(MIMIC_HEALDOWN_ID, def);
  return def;
};
/** The four 魍魉之匣 outcomes, in the text's order (眩晕、沉默、减疗40%、混乱). */
export const MIMIC_EFFECTS = Object.freeze(["stun", "silence", MIMIC_HEALDOWN_ID, "confuse"] as const);

/** 薙魂: the attack being guarded (key = turn, attacker, skill scope) and its guarded ally, kept in the wearer's notes. */
const EDGE_ATTACK = "soul-edge:attack=", EDGE_STATE = "soul-edge:state=";
/** 薙魂 result objects whose shared half is still owed by the wearer (transient: one damage resolution). */
const edgeOwed = new WeakMap<object, any>();
/** 唯一效果: the first wearer of each team acts (battle → team → wearer id). */
const edgeHolder = new WeakMap<object, Map<number, number>>();

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
      if (untargetableInBetting(src)) return;
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

  const mimic = (c: any) => {
    h.register(c, EV.AFTER_DAMAGE, "SELF", async ctx => {
      if (!h.applyStatus || !h.countsAsSoulDamage(ctx)) return;
      const t = ctx.input.target;
      if (!h.isUp(t) || t.teamId === c.owner.teamId) return;
      if (!(Number(ctx.result.applied ?? 0) + Number(ctx.result.absorbed ?? 0) > 0)) return;
      c.battle.rng.expect("soul:" + c.name + ":pick");
      const id: string = c.battle.rng.pick([...MIMIC_EFFECTS]);
      const heal = id === MIMIC_HEALDOWN_ID;
      const def = heal ? mimicHealDownDef() : bearerTurnControl(id);
      const landed = await h.applyStatus(c, t, def, BETTING_SOUL_NUMBERS.mimicChance, BETTING_SOUL_NUMBERS.mimicTurns,
        heal ? [{ prop: "healDown", value: BETTING_SOUL_NUMBERS.mimicHealDown, mode: "FIXED" }] : []);
      if (!landed) return;
      c.fired("魍魉之匣:" + id);
      h.proc(c, t.id, `${def.name}${heal ? " 40%" : ""} for 1 turn (25% base chance on damage)`);
    });
  };

  const soulEdge = (c: any) => {
    const { battle, owner } = c;
    let holders = edgeHolder.get(battle);
    if (!holders) { holders = new Map(); edgeHolder.set(battle, holders); }
    if (!holders.has(owner.teamId)) holders.set(owner.teamId, owner.id);
    h.register(c, EV.BEFORE_DAMAGE, "ALL", ctx => {
      if (holders!.get(owner.teamId) !== owner.id || !h.isUp(owner)) return;
      const t = ctx?.input?.target, src = ctx?.input?.source, res = ctx?.result;
      if (!t || !src || !res || t.teamId !== owner.teamId || t.id === owner.id || src.teamId === owner.teamId) return;
      if (!h.countsAsSoulDamage(ctx) || !res.canBeShared || res.ignoresModifiers || isAoeHit(battle, src)) return;
      const key = battle.turn + ":" + src.id + ":" + String(currentHit(battle).skill ?? "-");
      if (noteValue(owner, EDGE_ATTACK) !== key) { setNote(owner, EDGE_ATTACK, key); setNote(owner, EDGE_STATE, ""); }
      const state = String(noteValue(owner, EDGE_STATE) ?? "");
      const guarded = state.startsWith("G:") ? Number(state.slice(2)) : null;
      if (guarded !== null && guarded !== t.id) return;               // one guard per attack
      if (guarded === null) {
        if (state.split(",").includes(String(t.id))) return;          // already rolled (and failed) for this ally
        if (!h.roll(c, BETTING_SOUL_NUMBERS.edgeChance, "guard")) { setNote(owner, EDGE_STATE, state ? state + "," + t.id : String(t.id)); return; }
        setNote(owner, EDGE_STATE, "G:" + t.id);
        c.fired("薙魂:guard");
        h.proc(c, t.id, "guard: single-target damage -20%, 50% shared");
      }
      res.final *= (1 - BETTING_SOUL_NUMBERS.edgeCut) * (1 - BETTING_SOUL_NUMBERS.edgeShare);
      edgeOwed.set(res, owner);
    });
    h.register(c, EV.AFTER_DAMAGE, "ALL", async ctx => {
      const res = ctx?.result;
      if (!res || edgeOwed.get(res) !== owner) return;
      edgeOwed.delete(res);
      const share = Number(res.final ?? 0);
      if (!(share > 0) || !h.isUp(owner)) return;
      battle.trace.push({ t: "DAMAGE_SHARED", src: owner.id, ally: ctx.input.target.id, attacker: ctx.input.source.id, amount: GameMath.display(share), skill: h.soulSkill(c) });
      await dealDamage(battle, { source: ctx.input.source, target: owner, base: share, rate: 1, type: DamageType.FIXED, skillTag: "soul:薙魂", noSoul: true });
    });
  };

  const nuribotoke = (c: any) => {
    const { battle, owner } = c;
    let holders = nuriHolder.get(battle);
    if (!holders) { holders = new Map(); nuriHolder.set(battle, holders); }
    if (!holders.has(owner.teamId)) holders.set(owner.teamId, owner.id);
    let basicUsed = false, unable = false;
    h.register(c, EV.TURN_START, "SELF", ctx => {
      if (ctx?.actor?.id !== owner.id) return;
      basicUsed = false;
      unable = (owner.statuses ?? []).some((s: any) => s.def.preventsAction);
    });
    h.register(c, EV.SKILL_END, "SELF", ctx => {
      if (ctx?.actor?.id === owner.id && (Number(ctx?.skill?.cost) || 0) === 0) basicUsed = true;
    });
    h.register(c, EV.TURN_END, "SELF", ctx => {
      if (ctx?.actor?.id !== owner.id || holders!.get(owner.teamId) !== owner.id || !h.isUp(owner)) return;
      if (!basicUsed && !unable) return;
      const def = nuriDef();
      const v = BETTING_SOUL_NUMBERS.nuriBuff;
      for (const m of battle.teams[owner.teamId].aliveMembers()) {
        if (m.type === "SUMMON" || m.type === "SPECIAL_SUMMON") continue;
        for (const st of [...m.statuses]) if (st.def.id === NURIBOTOKE_ID) m.expireStatus(st);
        const k = m.id === owner.id ? 2 : 1;
        m.addStatus(def, owner.id, 1, BETTING_SOUL_NUMBERS.nuriTurns, [{ prop: "efr", value: v * k, mode: "FIXED" }, { prop: "dmgDealtB", value: v * k, mode: "FIXED" }], 1);
        battle.trace.push({ t: "STATUS_APPLY", src: owner.id, dst: m.id, status: NURIBOTOKE_ID, name: def.name, category: def.category, duration: BETTING_SOUL_NUMBERS.nuriTurns, known: true, skill: h.soulSkill(c) });
      }
      c.fired("涂佛:buff");
      h.proc(c, owner.id, `allies +15% effect RES / damage for 2 turns (self +30%) — ${basicUsed ? "normal attack" : "unable to act"}`);
    });
  };

  const bellHaunt = (c: any) => {
    const { battle, owner } = c;
    let holders = bellHolder.get(battle);
    if (!holders) { holders = new Map(); bellHolder.set(battle, holders); }
    if (!holders.has(owner.teamId)) holders.set(owner.teamId, owner.id);
    const counted = new WeakMap<object, Set<number>>();
    h.register(c, EV.STATUS_ADD, "ALL", ctx => {
      const v = ctx?.entity;
      if (!v || v.teamId === owner.teamId || ctx.merged || holders!.get(owner.teamId) !== owner.id || !h.isUp(owner)) return;
      if (!inOwnTurn(battle, owner)) return;
      const st = [...(v.statuses ?? [])].reverse().find((s: any) => s.def.id === ctx.status);
      if (!st || st.sourceId !== owner.id || !(isControlDef(st.def) || (BELL_COUNTS_ENTANGLE.value && st.def.id === "5513_entangle"))) return;
      const stack: any[] = battle.resolutionStack ?? [];
      const scope = stack.find((x: any) => x?.type === "SKILL") ?? st;
      let seen = counted.get(scope);
      if (!seen) { seen = new Set(); counted.set(scope, seen); }
      if (seen.has(v.id)) return;
      seen.add(v.id);
      const def = bellDef();
      let after = 0;
      for (const m of battle.teams[owner.teamId].aliveMembers()) {
        if (m.type === "SUMMON" || m.type === "SPECIAL_SUMMON") continue;
        const cur = m.statuses.find((s: any) => s.def.id === BELL_HAUNT_ID);
        const n = Math.min(BETTING_SOUL_NUMBERS.bellCap, (cur?.stacks ?? 0) + 1);
        if (cur) m.expireStatus(cur);
        m.addStatus(def, owner.id, n, BETTING_SOUL_NUMBERS.bellTurns, [{ prop: "dmgDealtB", value: BETTING_SOUL_NUMBERS.bellStep * n, mode: "FIXED" }], BETTING_SOUL_NUMBERS.bellCap);
        after = Math.max(after, n);
        battle.trace.push({ t: "STATUS_APPLY", src: owner.id, dst: m.id, status: BELL_HAUNT_ID, name: def.name, category: def.category, duration: BETTING_SOUL_NUMBERS.bellTurns, known: true, stacks: n, skill: h.soulSkill(c) });
      }
      c.fired("元兴寺:buff");
      h.proc(c, v.id, `allies +5% damage per controlled target (${after}/8 stacks, 2 turns) after ${st.def.name}`);
    });
  };

  const wispzoa = (c: any) => {
    const { battle, owner } = c;
    let active: any = null;   // the skill object of the boosted cast
    h.register(c, EV.SKILL_START, "SELF", ctx => {
      active = null;
      if (ctx?.actor?.id !== owner.id || !h.isUp(owner)) return;
      const sk = ctx?.skill;
      if (!sk || !((Number(sk.cost) || 0) > 0)) return;           // 妖术 = a skill with an onibi cost
      let eff = Number(sk.cost) || 0;
      try { eff = bettingCostOf(battle, owner, sk.ir ?? sk); } catch { /* keep the printed cost */ }
      const pool = battle.teams[owner.teamId].orbs;
      if (!(pool.current >= Math.max(0, eff) + BETTING_SOUL_NUMBERS.wispExtra)) return;
      const before = pool.current;
      pool.pay(BETTING_SOUL_NUMBERS.wispExtra);
      battle.trace.push({ t: "ORB_DRAIN", team: owner.teamId, src: owner.id, skill: h.soulSkill(c), before, after: pool.current });
      active = sk;
      c.fired("海月火玉:boost");
      h.proc(c, owner.id, `extra 1 onibi for ${sk.name} (cost ${eff}) → its damage x1.4`);
    });
    h.register(c, EV.BEFORE_DAMAGE, "SELF", ctx => {
      if (!active || ctx?.input?.source?.id !== owner.id || ctx.result?.ignoresModifiers) return;
      const t = ctx.input.target;
      if (!t || t.teamId === owner.teamId || !h.countsAsSoulDamage(ctx)) return;
      ctx.result.final *= 1 + BETTING_SOUL_NUMBERS.wispBoost;
    });
    h.register(c, EV.SKILL_END, "SELF", ctx => { if (ctx?.actor?.id === owner.id) active = null; });
  };

  return { 海月火玉: wispzoa, 日女巳时: dawnFairy, 三味: samisen, 骰子鬼: diceSprite, 隐念: possessor, 魍魉之匣: mimic, 薙魂: soulEdge, 涂佛: nuribotoke, 元兴寺: bellHaunt };
}

export const BETTING_SOUL_NOTES: Readonly<Record<string, string>> = Object.freeze({
  日女巳时: "custom (MAX only): wearer deals soul-triggering damage that reaches HP → 20% (30% vs a buffed target) push back 30% action bar",
  三味: "custom (MAX only): an ally receives a control or banishment → that ally +30 SPD for 2 of its turns, non-dispellable, max 2 stacks",
  隐念: "custom (MAX only): wearer's soul-triggering damage x1.2 / x1.4 / x1.6 cycling per target (per-target hit counter for the whole battle; independent multiplier)",
  魍魉之匣: "custom (MAX only): every soul-triggering hit the wearer deals to an enemy (shield-absorbed included) → 25% base chance, contested by effect RES, to apply one of stun / silence / 40% heal reduction / confusion (uniform pick) for 1 of the target's turns",
  薙魂: "custom (MAX only): ally (not the wearer) takes an enemy single-target hit → 50% guard for the rest of that attack (one per attack): hit x0.8 then half shared, the wearer takes the same amount as FIXED no-soul damage; unique per team",
  涂佛: "custom (MAX only, unique per team): wearer turn end after a normal attack (or unable to act at turn start) → non-summon allies +15% effect RES / +15% damage for 2 of their turns, the wearer +30% / +30%; refreshed, not stacked",
  元兴寺: "custom (MAX only, unique per team): wearer's own turn, each enemy hit by a control effect it applies (once per target per skill) → non-summon allies +5% damage, max +40% (8 stacks), for 2 of their turns, refreshed",
  海月火玉: "custom (MAX only): wearer casts an attack skill with an onibi cost while its side holds cost + 1 onibi → 1 extra onibi is removed and that cast's damage x1.4 (independent multiplier)",
  骰子鬼: "custom (MAX only): wearer resists (EV.RESIST) → counter-attack the source with +50% damage; control received while not controlled → +25% action bar",
});
