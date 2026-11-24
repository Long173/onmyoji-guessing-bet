// compile/betting-shared.ts — helpers shared by the MAX-only (betting mode) shikigami mechanics.
//
// Used by compile/betting-senhime.ts (鲸汐千姬 562) and compile/betting-ungaikyo.ts (云外镜 344).
// Nothing here runs in BASE mode: every caller is gated by `bettingActive()`.
import type { Entity } from "../kernel/entity.ts";
import { EntityType } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { CONTROL_EFFECTS, StatusBook, findImmuneStatus } from "../kernel/status.ts";
import { rollStatusContest, reportResist } from "../kernel/resist.ts";
import type { StatusDef } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { skillLevelMode } from "./max-level.ts";
import { targetingAtk } from "./ai-compiler.ts";

export const bettingActive = (): boolean => skillLevelMode() === "MAX";

/**
 * Betting mode: an untargetable unit (action-bar summons such as 龙胆蓝璃 / 极昼鲸) cannot be the target of a
 * counterattack either (match-7 replay: the Glass struck Blue and was never hit back; Yuki took 0 damage).
 * Always false in BASE mode.
 */
export const untargetableInBetting = (e: any): boolean => bettingActive() && e?.caps?.canBeTargeted === false;

/** Statuses that live until removed by their own rule (no turn count). */
export const PERSIST = 99999;
/** skillTag prefix of status damage ticks (毒羽, 符咒·破 …): not an attack, so attack reactions (Inugami's guard counter) skip it. */
export const STATUS_TICK_TAG = "betting-tick:";

export const isSummonUnit = (e: any): boolean => e?.type === EntityType.SUMMON || e?.type === EntityType.SPECIAL_SUMMON;
export const skillById = (e: Entity, id: string): any => (e?.skills ?? []).find((s: any) => s?.ir?.id === id) ?? null;
export const hasSkill = (e: Entity, id: string): boolean => !!skillById(e, id);
export const entityById = (battle: any, id: number | null): Entity | null =>
  id === null ? null : (battle.allEntities().find((x: Entity) => x.id === id) ?? null);

/** Synthetic status definition (registered once; an existing KB-compiled definition is never replaced). */
export function markDef(o: Partial<StatusDef> & { id: string; name: string; category: StatusCategory; desc: string }, book: Map<string, StatusDef>): StatusDef {
  const known = book.get(o.id);
  if (known && known.desc === o.desc) return known;
  const def: StatusDef = {
    dispellable: false, removable: false, preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "GLOBAL", ...o,
  };
  book.set(o.id, def);
  return def;
}

const CONTROL_IDS = new Set(CONTROL_EFFECTS.filter(d => d.category === StatusCategory.DEBUFF_STATE).map(d => d.id));
/** Control effect (tips_3 list or a KB debuff that stops actions / skills / forces basic attacks). */
export const isControlDef = (d: StatusDef): boolean => CONTROL_IDS.has(d.id)
  || (String(d.category).startsWith("DEBUFF") && (d.preventsAction || d.preventsSkill || d.forcesBasicAttack));
export const isDebuffOrControl = (d: StatusDef): boolean => String(d.category).startsWith("DEBUFF") || isControlDef(d);

// ───────────────────────── notes (saved with the state) ─────────────────────────

export function noteValue(e: Entity, prefix: string): string | null {
  const hit = (e.notes ?? []).find(n => n.startsWith(prefix));
  return hit === undefined ? null : hit.slice(prefix.length);
}
export function setNote(e: Entity, prefix: string, value: string | number | null): void {
  e.notes = (e.notes ?? []).filter(n => !n.startsWith(prefix));
  if (value !== null) e.notes.push(prefix + value);
}

// ───────────────────────── timed shields ─────────────────────────

/**
 * Shield that expires after `turns` of its bearer's turns (the kernel shield has no duration).
 * Counted like the engine's statuses: every turn end of the bearer, the creation turn included.
 */
export function grantTimedShield(battle: any, src: Entity, dst: Entity, value: number, turns: number,
                                 o: { tag: string; skill: string; reason: string; base?: string; ratio?: number; dispellable?: boolean }): void {
  if (!dst?.alive || !(value > 0)) return;
  const sh: any = dst.addShield({ value, sourceId: src.id, dispellable: o.dispellable ?? true, tag: o.tag });
  sh.ttl = turns;
  battle.trace.push({
    t: "SHIELD_APPLY", src: src.id, dst: dst.id, value: GameMath.display(value), base: o.base ?? null, ratio: o.ratio ?? null,
    skill: o.skill, reason: o.reason, duration: turns,
  });
}

/** TURN_END of `actor`: count down its timed shields and break the expired ones. */
export function tickTimedShields(battle: any, actor: Entity): void {
  for (const sh of (actor.shields ?? []) as any[]) {
    if (sh.broken || typeof sh.ttl !== "number") continue;
    sh.ttl--;
    if (sh.ttl > 0) continue;
    sh.broken = true;
    battle.trace.push({ t: "SHIELD_EXPIRE", id: actor.id, shield: sh.id, remaining: GameMath.display(sh.value) });
  }
}

// ───────────────────────── casting helpers ─────────────────────────

/** Pays the onibi of a hand-written skill (same steps and traces as compile/character.ts). false = fell back. */
export async function payOrFallback(battle: any, self: Entity, sk: any, cost: number, target: Entity, free: boolean): Promise<boolean> {
  if (!(cost > 0) || free) return true;
  const team = battle.teams[self.teamId];
  if (!team.orbs.canPay(cost)) {
    const basic = self.skills.find((s: any) => s.cost === 0 && s !== sk);
    battle.trace.push({ t: "SKILL_FALLBACK", actor: self.id, skill: sk.name, reason: "ORB_SHORT", need: cost, have: team.orbs.current, fallback: basic?.name ?? null });
    if (basic) await basic.execute(battle, self, target);
    return false;
  }
  const before = team.orbs.current;
  team.orbs.pay(cost, "orb", "COST");
  battle.queueEvent(EV.ORB_COST, { battle, team: self.teamId, actor: self.id, skill: sk.name, amount: cost, before, after: team.orbs.current }, self.id, self.teamId);
  battle.trace.push({ t: "ORB_PAY", team: self.teamId, actor: self.id, skill: sk.name, amount: cost, before, after: team.orbs.current });
  return true;
}

/** Action bar change with the same traces as the skill path (percent: 0.2 = 20%, negative = push). */
export function shiftBar(battle: any, e: Entity, percent: number, skill: string): void {
  const posBefore = battle.timeline.get(e.id)?.pos ?? null;
  const moved = battle.timeline.shift(e.id, percent);
  const direction = percent >= 0 ? "pull" : "push";
  if (!moved && battle.timeline.isLocked?.(e.id)) {
    battle.trace.push({ t: "TIMELINE_LOCKED", id: e.id, direction, percent, skill, reason: "锁条（缚足/放逐/石化）" });
    return;
  }
  battle.trace.push({ t: "TIMELINE_SHIFT", id: e.id, direction, percent, posBefore, posAfter: battle.timeline.get(e.id)?.pos ?? null, applied: moved, skill });
}

/** Adds onibi from a mechanic (same events / traces as the skill path). */
export function gainOrbs(battle: any, src: Entity, teamId: number, n: number, skill: string): void {
  const pool = battle.teams[teamId].orbs;
  const before = pool.current;
  const g = pool.gain(n);
  battle.queueEvent(EV.ORB_GAIN, { battle, team: teamId, src: src.id, skill, requested: n, gained: g.gained, before, after: pool.current }, src.id, teamId);
  if (g.overflow > 0) battle.queueEvent(EV.ORB_OVERFLOW, { battle, team: teamId, src: src.id, skill, overflow: g.overflow, after: pool.current }, src.id, teamId);
  battle.trace.push({ t: "ORB_GAIN", team: teamId, src: src.id, skill, requested: n, before, after: pool.current, overflow: g.overflow });
}

/** Number from the highest-level upgrade line matching `re` (group 1), else from the skill text, else `fallback`. */
export function levelNumber(x: any, re: RegExp, textRe: RegExp | null, fallback: number): number {
  let v: number | null = null;
  if (textRe) {
    const t = (x?.sentences ?? []).map((s: any) => String(s.text ?? "")).join("。");
    const m = t.match(textRe);
    if (m) v = Number(m[1]);
  }
  for (const l of [...(x?.levelScale ?? [])].sort((a: any, b: any) => a.level - b.level)) {
    const m = String(l.effect ?? "").match(re);
    if (m) v = Number(m[1]);
  }
  return v ?? fallback;
}
export function hasLevelLine(x: any, re: RegExp): boolean {
  return (x?.levelScale ?? []).some((l: any) => re.test(String(l.effect ?? "")));
}

/** Global (owner 0) handler, registered once per battle. Not a passive: sealing the owner does not stop it. */
export function ensureGlobalHandler(battle: any, id: string, code: string, fn: (ctx: any) => Promise<void> | void): void {
  if (battle.bus.hasHandler(id)) return;
  battle.bus.register({ id, ownerId: 0, code, range: "ALL", priority: 0, passive: false, fn: async (ctx: any) => { await fn(ctx); } });
}

/** Handler owned by one unit, SELF range by default (a passive: sealing the owner stops it). Registered once.
 *  `range: "ALL"` = the owner reacts to every unit's event (e.g. any damage, any turn end).
 *  `opts.passive: false` = the rule comes from an active skill (or an innate trait): passive seals (压制 /
 *  "被动失效") do not stop it; the bus still skips it while the owner is dead. */
export function registerOwnerHandler(battle: any, id: string, ownerId: number, code: string, fn: (ctx: any) => Promise<void> | void,
                                     range: "SELF" | "ALL" = "SELF", opts: { passive?: boolean } = {}): void {
  if (battle.bus.hasHandler(id)) return;
  const passive = opts.passive !== false;
  battle.bus.register({
    id, ownerId, code, range, priority: 0, passive, ...(passive ? { source: "PASSIVE" as const } : {}),
    fn: async (ctx: any) => { await fn(ctx); },
  });
}

// ───────────────────────── KB base ATK ─────────────────────────

/** Soul-free max-level ATK per shikigami id (data/kb/shikigami.full.json panel), filled by compile/character.ts. */
const KB_ATK = new Map<number, number>();
export function noteKbBaseAtk(shikigamiId: number, atk: unknown): void {
  const v = Number(atk);
  if (Number.isFinite(shikigamiId) && v > 0) KB_ATK.set(Number(shikigamiId), v);
}
/** "X% ATK" buffs scale the base ATK, not the panel (souls included): the KB value, else the entity's base ATK. */
export const kbBaseAtk = (e: Entity): number => {
  // Guessing entities carry no shikigamiId (soul/guessing-factory.ts): fall back to the skills' KB charId.
  const id = e?.shikigamiId ?? (e?.skills ?? []).find((sk: any) => sk?.ir?.charId)?.ir?.charId;
  return KB_ATK.get(Number(id)) ?? Number(e?.base?.atk ?? 0);
};

/** ATK used by "highest ATK" AI target rules: panel ATK + permanent kit form bonuses in betting mode (see
 *  compile/ai-compiler.ts targetingAtk), the live ATK otherwise. */
export const atkForTargeting = (e: Entity): number => targetingAtk(e);

/** Removes onibi from a team as an effect (扣除, not a cost) with the same trace as the existing drains. */
export function drainOrbs(battle: any, src: Entity, teamId: number, n: number, skill: string): number {
  const pool = battle.teams[teamId].orbs;
  const take = Math.min(Math.max(0, n), pool.current);
  if (!(take > 0)) return 0;
  const before = pool.current;
  pool.pay(take);
  battle.trace.push({ t: "ORB_DRAIN", team: teamId, src: src.id, skill, before, after: pool.current });
  return take;
}

/** Timed shields count down on their bearer's turn ends. */
export function ensureShieldTicker(battle: any): void {
  ensureGlobalHandler(battle, "betting:timed-shields", EV.TURN_END, (ctx: any) => { if (ctx?.actor) tickTimedShields(battle, ctx.actor); });
}

// ───────────────────────── stacked statuses ─────────────────────────

/** Stack count of the status `id` on `e` (any source unless `src` is given). */
export function stacksOn(e: Entity, id: string, src: number | null = null): number {
  return e.statuses.find(s => s.def.id === id && (src === null || s.sourceId === src))?.stacks ?? 0;
}

/**
 * Sets a stacked status to `n` stacks (clamped to [0, cap]; 0 removes it). Per-stack effects are rebuilt so the
 * numbers always match the count (same steps as betting-mechanics.ts setStacks). Returns the new count.
 */
export function setStackedStatus(e: Entity, def: StatusDef, n: number, cap: number, src: number,
                                 perStack: Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE" }>,
                                 duration = PERSIST): number {
  const next = Math.max(0, Math.min(cap, n));
  const st = e.statuses.find(s => s.def.id === def.id && s.sourceId === src);
  const effects = perStack.map(p => ({ prop: p.prop, value: p.value * next, mode: p.mode }));
  if (next === 0) {
    if (st) e.expireStatus(st);
    return 0;
  }
  if (!st) {
    e.addStatus(def, src, next, duration, effects, cap);
    return next;
  }
  const tags = new Set(st.effects.map(x => x.tag));
  e.effects = e.effects.filter(x => !tags.has(x.source));
  st.effects = [];
  effects.forEach((ef, i) => {
    const tag = st.tag + ":" + i;
    st.effects.push({ ...ef, tag });
    e.effects.push({ ...ef, source: tag });
  });
  st.stacks = next;
  st.remaining = Math.max(st.remaining, duration);
  return next;
}

/** Control statuses currently on `e`. */
export const controlsOn = (e: Entity): any[] => e.statuses.filter(s => isControlDef(s.def));

/** Removes every control effect on `e` (解除: removability is not checked, the skill text says "all"). */
export function clearControls(battle: any, e: Entity, src: Entity, skill: string): number {
  let n = 0;
  for (const st of controlsOn(e)) {
    if (!e.expireStatus(st)) continue;
    n++;
    battle.trace.push({ t: "STATUS_REMOVE", id: e.id, status: st.def.id, name: st.def.name, by: "REMOVE", side: "ALLY", what: "CONTROL", src: src.id, skill });
    battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: e, status: st.def.id, name: st.def.name, by: "REMOVE", side: "ALLY", what: "CONTROL", src: src.id, skill }, e.id, e.teamId);
  }
  return n;
}

/** The owner's passive skills are suppressed (压制, e.g. 御怨般若's 封印结界). */
export const passiveSuppressed = (e: Entity): boolean => e.statuses.some(s => s.def.suppressPassive);

/**
 * Applies a status through the same steps as the skill path: chance / effect-resist contest (kernel/resist.ts:
 * `p` null = no written chance, the betting resist policy still contests enemy debuffs), immunity, then
 * addStatus. Returns true when it landed.
 */
export async function applyContested(battle: any, src: Entity, dst: Entity, def: StatusDef, p: number | null, duration: number,
                                     effects: Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE" }>,
                                     o: { skill: string; ref?: string; tag?: string }): Promise<boolean> {
  if (!dst?.alive) return false;
  const tag = o.tag ?? def.id + ":" + o.skill + ":" + dst.id;
  const contest = rollStatusContest(battle, src, dst, def, p, "status_prob:" + tag, "resist:" + tag);
  if (contest.outcome === "MISS") {
    battle.trace.push({ t: "STATUS_MISS", src: src.id, dst: dst.id, status: def.id, name: def.name, probability: p, skill: o.skill, ref: o.ref ?? def.id });
    return false;
  }
  if (!StatusBook.has(def.id)) StatusBook.set(def.id, def);
  if (contest.outcome === "RESIST") {
    await reportResist(battle, src, dst, def, contest, { probability: p, duration, ref: o.ref ?? def.id, skill: o.skill });
    return false;
  }
  const imm = findImmuneStatus(dst, def, battle.policies?.immune?.debuffCoversControl ?? true);
  if (imm) {
    battle.trace.push({ t: "IMMUNE", src: src.id, dst: dst.id, status: def.id, name: def.name, by: imm.def.id, kind: imm.kind, consumed: imm.consumed, ref: o.ref ?? def.id, skill: o.skill });
    return false;
  }
  const a = dst.addStatus(def, src.id, 1, duration, effects, 1);
  battle.trace.push({ t: "STATUS_APPLY", src: src.id, dst: dst.id, status: def.id, name: def.name, category: def.category, duration, ref: o.ref ?? def.id, known: true, tag: (a as any)?.tag ?? null, skill: o.skill });
  return true;
}

/** Permanent max-HP change (ratio: -0.3 = 30% less); current HP is capped by the new maximum. */
export function scaleMaxHp(battle: any, e: Entity, ratio: number, skill: string): void {
  if (!e?.alive) return;
  const before = e.maxHp;
  e.maxHp = Math.max(1, e.maxHp * (1 + ratio));
  if (e.hp > e.maxHp) e.hp = e.maxHp;
  battle.trace.push({ t: "MAX_HP_CHANGE", id: e.id, before: GameMath.display(before), after: GameMath.display(e.maxHp), ratio, skill });
}

// ───────────────────────── "ignores enemy souls / passives" ─────────────────────────

/**
 * Runs `fn` with the souls (and optionally the passives) of `self`'s enemies suppressed, through the bus's own
 * suppression check (kernel/battle.ts injects bus.suppressProvider). Used by 因幡辉夜姬 L4/L5 and 铃彦姬's 神火.
 */
export async function withEnemiesSuppressed<T>(battle: any, self: Entity, what: { soul: boolean; passive: boolean }, fn: () => Promise<T>): Promise<T> {
  const bus = battle.bus;
  const prev = bus.suppressProvider;
  bus.suppressProvider = (id: number) => {
    const base = prev?.(id) ?? { passive: false, soul: false };
    if (battle.teamOf?.(id) === self.teamId || id === 0) return base;
    return { passive: base.passive || what.passive, soul: base.soul || what.soul };
  };
  try { return await fn(); } finally { bus.suppressProvider = prev; }
}
