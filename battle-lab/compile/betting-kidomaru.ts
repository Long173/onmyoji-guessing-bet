// compile/betting-kidomaru.ts — 鬼童丸 (SSR 345, Global "Kidomaru") at max skill level. MAX mode only (match 9).
//
// Sources: data/kb/shikigami.json 345_01..345_03, buffs 3451_1 狂 / 3452_1 骸之锁 / 3453_1 修罗 / 3454_1 隐匿;
// data/kb/en-text.json (Global — preferred where fandom differs); fandom "Kidoumaru/Main" (猎魂狂杀 numbers, which the
// KB does not have).
// Before (engine trace, 24a): only the actives' IR ran — 降诛 2×59% + 骸之锁 (bar lock), 修罗骸锁 3×90% + 骸之锁 and
// three decorative 2-turn statuses (隐匿 / 狂 with no effect, no stacking). No 修罗 state ever, no concealment
// rules, no chain riders, no 降诛 counters.
//   降诛 (345_01) · 2×59% + 骸之锁 (2 turns, generic slot). Counter: an enemy that gains an action-bar increase and is
//       not chained ⇒ Kidomaru casts 降诛 on it (pseudo turn). Counters + 骸之锁 assists: at most 5 between two of
//       his turns. L5: hitting a target that already carries 骸之锁 ⇒ +1 狂 at the end of that turn.
//   骸之锁 (3452_1) · bar lock (KB-compiled locksTimeline). When a 降诛 / 修罗骸锁 cast of his lands, every OTHER chained
//       enemy takes 60% ATK and every chain is reset to 2 turns (once per cast). An ally's basic attack (skill _01) on a
//       chained enemy ⇒ Kidomaru assists with 降诛 after that ally's action (shares the cap of 5).
//   修罗骸锁 (345_03, 3 onibi) · 3×90% + 骸之锁; then enters 隐匿 unless he was already concealed when the cast began;
//       +1 狂 at the end of his turn. L5 (Global): 先机 — enters 隐匿 at battle start.
//   隐匿 (3454_1) · 3 turns (his). -20% damage taken; each enemy hit by one of his casts that began while concealed
//       also takes 33% ATK as TRUE damage (once per target per cast); enemy single-target skills pick someone else
//       while another enemy candidate exists (their pickTarget sees the list without him). Lifted at the end of an
//       action of his own turn in which he attacked while concealed.
//   狂 (3451_1) · +20 SPD, +30% damage dealt per stack, max 3, kept until 修罗 ends. The 3rd stack ⇒ 修罗.
//   修罗 (3453_1, 345_02) · shield 160% ATK (L4), immune to control / banish. After every non-summon enemy turn:
//       猎魂狂杀 — 40% ATK to all enemies (fandom L4), triggers no souls. Ends after 3 uses or when the shield breaks; at
//       the start of his turn the remaining uses are spent at once. On end: 狂 cleared, every enemy's 骸之锁 removed;
//       L5 (Global): the next 修罗骸锁 costs 1 less per chain removed.
// Not modelled (doubts): fandom's evolution "lethal damage ⇒ enter 修罗 once per round" (absent from the KB and the
// Global text, so not used) and fandom's L5 "heal 25% per chain removed" (Global says the cost discount); the 30%
// re-chain chance of 降诛 (the generic slot always re-chains — duration refresh only); "single-target" bar increases
// are not told apart from team-wide ones; the chain splash is once per cast (not per hit).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { onBarIncrease } from "./betting-bar.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, setStackedStatus, stacksOn,
} from "./betting-shared.ts";

export const KIDO = Object.freeze({
  frenzySpd: 20, frenzyDmg: 0.3, frenzyCap: 3, shuraShield: 1.6, huntRatio: 40, huntUses: 3,
  chainSplash: 60, chainTurns: 2, concealDr: 0.2, concealTrue: 0.33, concealTurns: 3, counterCap: 5,
});
export const CHAIN_ID = "3452_1";
export const FRENZY_ID = "345_frenzy";
export const SHURA_ID = "345_shura";
export const CONCEAL_ID = "345_conceal";
const SHIELD_TAG = "345shura";
const N_USES = "kido345:hunts=", N_CAP = "kido345:counters=", N_DISC = "kido345:discount=", N_PEND = "kido345:frenzy=";

const frenzyDef = () => markDef({ id: FRENZY_ID, name: "狂", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】提升20点速度，30%伤害，可叠加，上限3层。" }, StatusBook);
const shuraDef = () => markDef({ id: SHURA_ID, name: "修罗", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  immuneTo: ["CONTROL", "BANISH"],
  desc: "【增益、印记】获得吸收攻击160%伤害的护盾，免疫控制效果。施放3次猎魂狂杀或护盾被击破后解除修罗状态，清除自身的狂和敌方的骸之锁。" }, StatusBook);
const concealDef = () => markDef({ id: CONCEAL_ID, name: "隐匿", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN",
  desc: "【增益、印记】敌方技能优先选择鬼童丸以外的目标，持续3回合；受到伤害降低20%，攻击额外造成攻击33%的真实伤害；在鬼童丸回合内攻击后解除。" }, StatusBook);

export const isKidomaru345 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "345_01") && !!skillById(e, "345_03");
export const frenzyOf = (e: Entity): number => stacksOn(e, FRENZY_ID);
export const inShura = (e: Entity): boolean => e.hasStatus(SHURA_ID);
export const concealed = (e: Entity): boolean => e.hasStatus(CONCEAL_ID);
const chained = (e: Entity): boolean => e.hasStatus(CHAIN_ID);
const num = (e: Entity, p: string): number => Number(noteValue(e, p) ?? 0);
const aliveEnemies = (battle: any, k: Entity): Entity[] => (battle.teams[1 - k.teamId].members as Entity[]).filter(v => v.alive);
const canAct = (k: Entity): boolean => k.alive && !isActionPrevented(k.statusDefs());

/** Per-cast state (not saved: a cast never spans a save point). */
interface Cast { target: number | null; wasConcealed: boolean; ownTurn: boolean; skill: string; trueHit: Set<number>; chainedTarget: boolean }
const casts = new WeakMap<object, Map<number, Cast>>();
const castOf = (battle: any, k: Entity): Cast | undefined => casts.get(battle)?.get(k.id);
let riderDepth = 0;

// ───────────────────────── 狂 / 修罗 ─────────────────────────

async function gainFrenzy(battle: any, k: Entity, reason: string): Promise<void> {
  if (!k.alive) return;
  const before = frenzyOf(k);
  const n = setStackedStatus(k, frenzyDef(), before + 1, KIDO.frenzyCap, k.id,
    [{ prop: "spd", value: KIDO.frenzySpd, mode: "FIXED" }, { prop: "dmgDealtB", value: KIDO.frenzyDmg, mode: "FIXED" }]);
  if (n !== before) battle.trace.push({ t: "STACKS_SET", id: k.id, status: FRENZY_ID, name: "狂", from: before, to: n, reason, skill: "修罗骸锁" });
  if (n >= KIDO.frenzyCap && !inShura(k)) enterShura(battle, k);
}

function enterShura(battle: any, k: Entity): void {
  const def = shuraDef();
  const st = k.addStatus(def, k.id, 1, PERSIST, [], 1);
  setNote(k, N_USES, 0);
  battle.trace.push({ t: "STATE_SWITCH", id: k.id, state: "修罗", skill: "残月鬼衣" });
  battle.trace.push({ t: "STATUS_APPLY", src: k.id, dst: k.id, status: SHURA_ID, name: def.name, category: def.category, duration: PERSIST, ref: "3453_1", known: true, tag: st.tag, skill: "残月鬼衣" });
  const value = k.prop("atk") * KIDO.shuraShield;
  k.addShield({ value, sourceId: k.id, dispellable: false, tag: SHIELD_TAG });
  battle.trace.push({ t: "SHIELD_APPLY", src: k.id, dst: k.id, value: GameMath.display(value), base: "atk", ratio: KIDO.shuraShield * 100, skill: "残月鬼衣", reason: "修罗" });
}

function endShura(battle: any, k: Entity, reason: string): void {
  const st = k.statuses.find(s => s.def.id === SHURA_ID);
  if (!st) return;
  k.expireStatus(st);
  for (const sh of (k.shields ?? []) as any[]) if (!sh.broken && String(sh.id).includes(SHIELD_TAG)) sh.broken = true;
  const before = frenzyOf(k);
  setStackedStatus(k, frenzyDef(), 0, KIDO.frenzyCap, k.id, []);
  if (before) battle.trace.push({ t: "STACKS_SET", id: k.id, status: FRENZY_ID, name: "狂", from: before, to: 0, reason: "SHURA_END", skill: "残月鬼衣" });
  let removed = 0;
  for (const v of aliveEnemies(battle, k)) {
    for (const c of v.statuses.filter(s => s.def.id === CHAIN_ID)) {
      if (!v.expireStatus(c)) continue;
      removed++;
      battle.trace.push({ t: "STATUS_REMOVE", id: v.id, status: CHAIN_ID, name: "骸之锁", by: "REMOVE", side: "ENEMY", what: "DEBUFF", src: k.id, skill: "残月鬼衣" });
    }
  }
  setNote(k, N_DISC, removed || null);   // L5 (Global): the next 修罗骸锁 costs 1 less per chain removed
  battle.trace.push({ t: "STATE_SWITCH", id: k.id, state: "修罗解除", reason, skill: "残月鬼衣", chainsRemoved: removed });
}

async function hunt(battle: any, k: Entity): Promise<void> {
  if (!k.alive || !inShura(k)) return;
  const uses = num(k, N_USES) + 1;
  setNote(k, N_USES, uses);
  battle.trace.push({ t: "SUBSKILL", actor: k.id, skill: "猎魂狂杀", form: "修罗", use: uses });
  await battle.withinResolution({ id: "HIT:猎魂狂杀#" + uses, type: "HIT" }, async () => {
    for (const v of aliveEnemies(battle, k)) {
      if (v.alive && k.alive) await dealDamage(battle, { source: k, target: v, base: k.prop("atk") * (KIDO.huntRatio / 100), rate: 1, type: DamageType.NORMAL, skillTag: "猎魂狂杀", noSoul: true });
    }
  });
  if (uses >= KIDO.huntUses) endShura(battle, k, "HUNTS_USED");
}

// ───────────────────────── 隐匿 ─────────────────────────

function enterConceal(battle: any, k: Entity, reason: string): void {
  if (!k.alive || concealed(k)) return;
  const def = concealDef();
  const st = k.addStatus(def, k.id, 1, KIDO.concealTurns, [{ prop: "dmgTakenD", value: -KIDO.concealDr, mode: "FIXED" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: k.id, dst: k.id, status: CONCEAL_ID, name: def.name, category: def.category, duration: KIDO.concealTurns, ref: "3454_1", known: true, tag: st.tag, reason, skill: "修罗骸锁" });
}
function liftConceal(battle: any, k: Entity, reason: string): void {
  const st = k.statuses.find(s => s.def.id === CONCEAL_ID);
  if (!st || !k.expireStatus(st)) return;
  battle.trace.push({ t: "STATUS_EXPIRE", id: k.id, status: CONCEAL_ID, name: "隐匿", reason });
}

/** Enemy target lists seen by single-target picks: a concealed Kidomaru is dropped while someone else is left. */
const wrapped = new WeakSet<object>();
function wrapEnemyPicks(battle: any, k: Entity): void {
  for (const e of battle.allEntities() as Entity[]) {
    if (e.teamId === k.teamId) continue;
    for (const sk of (e.skills ?? []) as any[]) {
      if (!sk?.pickTarget || wrapped.has(sk)) continue;
      const orig = sk.pickTarget;
      sk.pickTarget = (b: any, self: Entity, enemies: Entity[]) => {
        if (!bettingActive() || !Array.isArray(enemies)) return orig(b, self, enemies);
        const rest = enemies.filter(v => !(isKidomaru345(v) && concealed(v)));
        return orig(b, self, rest.length && rest.length < enemies.length ? rest : enemies);
      };
      wrapped.add(sk);
    }
  }
}

// ───────────────────────── 骸之锁 riders / 降诛 counters ─────────────────────────

async function chainSplash(battle: any, k: Entity, primary: number | null, skill: string): Promise<void> {
  const others = aliveEnemies(battle, k).filter(v => chained(v) && v.id !== primary);
  for (const v of aliveEnemies(battle, k)) for (const c of v.statuses) if (c.def.id === CHAIN_ID) c.remaining = Math.max(c.remaining, KIDO.chainTurns);
  if (!others.length || !k.alive) return;
  battle.trace.push({ t: "MARK_TRIGGER", id: k.id, status: CHAIN_ID, name: "骸之锁", targets: others.map(v => v.id), ratio: KIDO.chainSplash, skill });
  riderDepth++;
  try {
    await battle.withinResolution({ id: "HIT:骸之锁#" + skill, type: "HIT" }, async () => {
      for (const v of others) if (v.alive && k.alive) await battle.damage(k, v, k.prop("atk") * (KIDO.chainSplash / 100), DamageType.NORMAL, 1, null);
    });
  } finally { riderDepth--; }
}

async function counterCast(battle: any, k: Entity, v: Entity, why: "BAR" | "ASSIST", ally?: Entity): Promise<void> {
  const basic = skillById(k, "345_01");
  if (!basic || !v.alive || !canAct(k) || num(k, N_CAP) >= KIDO.counterCap) return;
  setNote(k, N_CAP, num(k, N_CAP) + 1);
  if (why === "ASSIST") battle.trace.push({ t: "ASSIST", actor: k.id, target: v.id, skill: basic.name, ally: ally?.id ?? null });
  else battle.trace.push({ t: "SUBCAST", actor: k.id, ref: "345_01", skill: basic.name, target: v.id, clause: "敌方获得单体行动条提升或加速效果时，鬼童丸对其施放「降诛」" });
  await battle.runPseudoTurn(k, TurnType.PSEUDO_TURN, { skill: basic, target: v });
}

// ───────────────────────── kit ─────────────────────────

async function afterCast(battle: any, k: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isKidomaru345(k) || (x?.id !== "345_01" && x?.id !== "345_03")) return false;
  const c = castOf(battle, k);
  if (x.id === "345_03") {
    setNote(k, N_DISC, null);
    if (!c?.wasConcealed) enterConceal(battle, k, "CAST");
    setNote(k, N_PEND, num(k, N_PEND) + 1);
  } else if (c?.chainedTarget) setNote(k, N_PEND, Math.max(1, num(k, N_PEND)));   // L5: +1 狂 at the end of the turn
  await chainSplash(battle, k, c?.target ?? null, x.name);
  return true;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const k = entities.find(isKidomaru345);   // 唯一效果
  if (!k) return out;
  if (!casts.has(battle)) casts.set(battle, new Map());
  const state = casts.get(battle)!;
  wrapEnemyPicks(battle, k);
  const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = true, key = "") =>
    registerOwnerHandler(battle, "betting:345:" + code + key + ":" + k.id, k.id, code, fn, range, { passive });
  reg(EV.BATTLE_START, () => enterConceal(battle, k, "SENKI"), "SELF");   // 345_03 L5 先机
  reg(EV.TURN_START, async (ctx: any) => {
    if (ctx?.actor?.id !== k.id) return;
    setNote(k, N_CAP, 0);
    while (k.alive && inShura(k)) await hunt(battle, k);   // remaining 猎魂狂杀 at once
  }, "ALL", false);
  reg(EV.SKILL_START, (ctx: any) => {
    if (ctx?.actor?.id !== k.id) return;
    const t: Entity | undefined = ctx.target;
    state.set(k.id, { target: t?.id ?? null, wasConcealed: concealed(k), ownTurn: ctx.type === "NORMAL" || ctx.type === "NEW_TURN",
      skill: String(ctx.skill?.ir?.id ?? ""), trueHit: new Set(), chainedTarget: !!t && chained(t) });
  }, "ALL", false, ":self");
  // Lifted after attacking (concealed) during his own turn.
  reg(EV.ACTION_END, (ctx: any) => {
    if (ctx?.actor?.id !== k.id) return;
    const c = state.get(k.id);
    state.delete(k.id);
    if (c?.ownTurn && c.wasConcealed) liftConceal(battle, k, "ATTACKED");
  }, "ALL", false, ":self");
  // 隐匿: +33% ATK true damage per enemy hit by a cast that began while concealed.
  reg(EV.AFTER_DAMAGE, async (ctx: any) => {
    const src: Entity | undefined = ctx?.input?.source, v: Entity | undefined = ctx?.input?.target;
    if (riderDepth || src?.id !== k.id || !v || v.teamId === k.teamId || ctx.input?.skillTag === "betting-kidomaru:conceal") return;
    const c = state.get(k.id);
    if (!c?.wasConcealed || c.trueHit.has(v.id) || !v.alive) return;
    c.trueHit.add(v.id);
    riderDepth++;
    try { await dealDamage(battle, { source: k, target: v, base: k.prop("atk") * KIDO.concealTrue, rate: 1, type: DamageType.TRUE, skillTag: "betting-kidomaru:conceal" }); }
    finally { riderDepth--; }
  }, "ALL", false);
  // 狂 pending from 修罗骸锁 / L5, granted at the end of the turn.
  reg(EV.TURN_END, async (ctx: any) => {
    const n = num(k, N_PEND);
    if (n > 0) { setNote(k, N_PEND, null); for (let i = 0; i < n; i++) await gainFrenzy(battle, k, "TURN_END"); }
    const u: Entity | undefined = ctx?.actor;
    if (u && u.teamId !== k.teamId && !isSummonUnit(u) && inShura(k)) await hunt(battle, k);
  }, "ALL", false);
  reg(EV.SHIELD_BREAK, (ctx: any) => {
    if (ctx?.target?.id !== k.id || !inShura(k)) return;
    if ((k.shields as any[]).some(sh => String(sh.id).includes(SHIELD_TAG) && sh.broken)) endShura(battle, k, "SHIELD_BROKEN");
  }, "ALL", false);
  // 骸之锁 assist: an ally's basic attack on a chained enemy.
  const pendingAssist = new Map<number, number>();
  reg(EV.SKILL_START, (ctx: any) => {
    const a: Entity | undefined = ctx?.actor, t: Entity | undefined = ctx?.target;
    if (!a || a.id === k.id || a.teamId !== k.teamId || isSummonUnit(a) || !t || t.teamId === k.teamId) return;
    if (!String(ctx.skill?.ir?.id ?? "").endsWith("_01") || !chained(t)) return;
    pendingAssist.set(a.id, t.id);
  }, "ALL", false, ":ally");
  reg(EV.ACTION_END, async (ctx: any) => {
    const a: Entity | undefined = ctx?.actor;
    if (!a || !pendingAssist.has(a.id)) return;
    const t = (battle.allEntities() as Entity[]).find(e => e.id === pendingAssist.get(a.id));
    pendingAssist.delete(a.id);
    if (t?.alive && chained(t)) await counterCast(battle, k, t, "ASSIST", a);
  }, "ALL", false, ":ally");
  onBarIncrease(battle, "kidomaru345:" + k.id, async (e: Entity) => {
    if (e.teamId === k.teamId || isSummonUnit(e) || chained(e) || !e.alive) return;
    await counterCast(battle, k, e, "BAR");
  });
  out.push({ entityId: k.id, mechanic: "狂 stacks → 修罗 (shield, control immunity, 猎魂狂杀 ×3) · 隐匿 (DR, true damage, untargeted, L5 先机) · 骸之锁 splash / reset / assists · 降诛 counters on bar increases (cap 5) · L5 cost discount" });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "345_03": { note: "修罗骸锁: 隐匿 (3 turns) and 狂 (stacked, at turn end) are run by betting-kidomaru.ts; only 骸之锁 stays generic", patch: { statusRefConditionOnly: [1, 2, 3, 4] } },
  }),
  cost: (_battle, self, sk, base) => {
    if (!bettingActive() || (sk?.ir ?? sk)?.id !== "345_03" || !isKidomaru345(self)) return base;
    const d = num(self, N_DISC);
    return d > 0 ? Math.max(0, base - d) : base;
  },
  gate: (_battle, self, sk) => (bettingActive() && (sk?.ir ?? sk)?.id === "345_02" && isKidomaru345(self) ? "PASSIVE_NOT_CASTABLE" : null),
  afterCast,
  install,
};
