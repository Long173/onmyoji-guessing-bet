// compile/betting-oitsuki.ts — 流光追月神 (SP 395, Global "Luminary Oitsuki") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 395_01..395_03, buffs 3952_1 照君 / 3953_1 集落光 / 3954_1 失彩 / 3956_1 流光,
// tips_11 / tips_27 / tips_7; fandom "Ryuukou Oitsukigami/Main" (same text).
//   绮罗舞 (395_02, passive, tips_11) · after her own turn ends: +3 cells on the onibi gauge and 2 照君 to every ally.
//                     · ally onibi overflows while she is in 可行动状态 (tips_27: no control / banish / ...): every
//                       overflowed onibi gives every ally 1 照君 (not once her own 照君 is at 10).
//                     · L2 照君 +3 SPD per stack; L3 先机: +4 gauge cells at battle start; L4 照君 ATK 10% per stack;
//                       L5 at the start of an ally's turn with fewer than 3 onibi: spend 1 流光 for +1 gauge cell.
//   照君 (3952_1)      · cap 10, persists. "提升N%攻击" scales the soul-free base ATK (KB panel, kbBaseAtk), not
//                       the lineup panel: the match-4 replay's Yato numbers (77% hit 6754, 100% 8874 with 8–10 stacks)
//                       fit 6149 + n × 10% × 3028 and not 6149 × (1 + n × 10%).
//   飞彩凝辉 (395_03)   · 2 onibi at L4. 集落光 (3953_1) on every non-summon ally "维持1回合" = until the end of her
//                       next own turn. She gains 3 流光 (3956_1, cap 3, +10% effect RES each) at battle start and
//                       after each own turn (active-skill text: not sealed by 压制).
//   集落光             · ally onibi deducted by an effect (扣除; a skill's cost is not a deduction): consumes one mark,
//                       advances the gauge by the onibi deducted, 失彩 on the enemy at the front of the action bar
//                       (2 turns at L3), -1 流光. Cannot trigger with no 流光.
//                     · not consumed when it ends: L2 dispel 1 debuff or control from the holder; L5 the holder gains
//                       30% ATK (base ATK) and 30 SPD for 2 of its turns.
//   失彩 (3954_1)      · the bearer's turn does not advance its team's onibi gauge (the cell is taken back at
//                       ORB_GAUGE_ADVANCE).
// Overflow and deductions are observed through kernel/resource.ts hooks (setOrbOverflowHook / setOrbDeductHook),
// queued and resolved at the next safe point (skill end, action end, turn start / end).
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import { setOrbDeductHook, setOrbOverflowHook } from "../kernel/resource.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, stacksOn,
  setStackedStatus, hasLevelLine, kbBaseAtk, isDebuffOrControl, isControlDef, noteValue, setNote,
} from "./betting-shared.ts";

export const OITSUKI = Object.freeze({
  shineCap: 10, shineAtk: 0.1, shineAtkL1: 0.05, shineSpd: 3, turnEndCells: 3, turnEndShine: 2, senkiCells: 4,
  lightCap: 3, lightRes: 0.1, lightPerTurn: 3, lowOrbs: 3, lostTurns: 1, lostTurnsL3: 2,
  endAtk: 0.3, endSpd: 30, endTurns: 2,
});

export const SHINE_ID = "3952_1";
export const GLOW_ID = "3953_1";
export const LOST_ID = "3954_1";
export const LIGHT_ID = "3956_1";
const BOOST_ID = "395_glow_boost";
const DUE = "oitsuki395:glowDue=";

const shineDef = () => markDef({ id: SHINE_ID, name: "照君", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】上限10层，每层提升10%攻击（L4）与3点速度（L2）。" }, StatusBook);
const glowDef = () => markDef({ id: GLOW_ID, name: "集落光", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL", dispellable: true, removable: true,
  desc: "【增益、印记】友方鬼火被扣除时推进等同扣除格数的鬼火行动条并消耗此印记，对敌方行动条最前端的目标施加失彩。触发后减少1层流光。（betting: 维持到追月神下个回合结束）" }, StatusBook);
const lostDef = () => markDef({ id: LOST_ID, name: "失彩", category: StatusCategory.DEBUFF_MARK, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【减益、印记】回合结束后无法推进鬼火行动条。" }, StatusBook);
const lightDef = () => markDef({ id: LIGHT_ID, name: "流光", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】上限3层，每层提升自身10%效果抵抗。" }, StatusBook);
const boostDef = () => markDef({ id: BOOST_ID, name: "集落光·余辉", category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "飞彩凝辉 L5：集落光未被消耗时，提升30%攻击与30点速度，持续2回合。" }, StatusBook);

export const isOitsuki395 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "395_02") && !!skillById(e, "395_03");
export const shineStacks = (e: Entity): number => stacksOn(e, SHINE_ID);
export const lightStacks = (o: Entity): number => stacksOn(o, LIGHT_ID, o.id);
const allies = (battle: any, o: Entity): Entity[] => (battle.teams[o.teamId].members as Entity[]).filter(m => m.alive);
const passiveOf = (o: Entity) => skillById(o, "395_02")?.ir;
const activeOk = (o: Entity): boolean => o.alive && !o.statuses.some(s => s.def.suppressPassive);
/** tips_27 可行动状态: no control effect, banish, … (approximated by "no control and not prevented"). */
const canAct = (o: Entity): boolean => o.alive && !isActionPrevented(o.statusDefs()) && !o.statuses.some(s => isControlDef(s.def));

/** tips_11: the first 395 of the team runs 绮罗舞. */
function dancerOf(battle: any, teamId: number): Entity | null {
  return (battle.teams[teamId]?.members ?? []).find((m: Entity) => isOitsuki395(m)) ?? null;
}

// ───────────────────────── 照君 / 流光 ─────────────────────────

function shineEffects(o: Entity, bearer: Entity): Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE" }> {
  const x = passiveOf(o);
  const atk = hasLevelLine(x, /攻击增至10%/) ? OITSUKI.shineAtk : OITSUKI.shineAtkL1;
  const out: Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE" }> = [{ prop: "atk", value: atk * kbBaseAtk(bearer), mode: "FIXED" }];
  if (hasLevelLine(x, /额外提升3点速度/)) out.push({ prop: "spd", value: OITSUKI.shineSpd, mode: "FIXED" });
  return out;
}

export function giveShine(battle: any, o: Entity, n: number, reason: string): void {
  if (!(n > 0)) return;
  const def = shineDef();
  for (const m of allies(battle, o)) {
    const before = stacksOn(m, SHINE_ID, o.id);
    if (before >= OITSUKI.shineCap) continue;
    const after = setStackedStatus(m, def, before + n, OITSUKI.shineCap, o.id, shineEffects(o, m));
    battle.trace.push({ t: "STATUS_APPLY", src: o.id, dst: m.id, status: SHINE_ID, name: "照君", category: def.category, duration: PERSIST, ref: SHINE_ID, known: true, stacks: after, threshold: OITSUKI.shineCap, reason, skill: "绮罗舞" });
  }
}

function setLight(battle: any, o: Entity, n: number, reason: string): void {
  const before = lightStacks(o);
  const after = setStackedStatus(o, lightDef(), n, OITSUKI.lightCap, o.id, [{ prop: "efr", value: OITSUKI.lightRes, mode: "FIXED" }]);
  if (after > before) battle.trace.push({ t: "STATUS_APPLY", src: o.id, dst: o.id, status: LIGHT_ID, name: "流光", category: StatusCategory.BUFF_MARK, duration: PERSIST, ref: LIGHT_ID, known: true, stacks: after, threshold: OITSUKI.lightCap, reason, skill: "飞彩凝辉" });
  else if (after < before) battle.trace.push({ t: "STACKS_CONSUMED", id: o.id, status: LIGHT_ID, name: "流光", from: before, to: after, reason, skill: "飞彩凝辉" });
}

// ───────────────────────── 集落光 ─────────────────────────

/** After 飞彩凝辉: 集落光 on every non-summon ally (replaces an older one). */
export function giveGlow(battle: any, o: Entity): void {
  const def = glowDef();
  for (const m of allies(battle, o).filter(x => !isSummonUnit(x))) {
    for (const st of [...m.statuses]) if (st.def.id === GLOW_ID && st.sourceId === o.id) m.expireStatus(st);
    const a = m.addStatus(def, o.id, 1, PERSIST, [], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: o.id, dst: m.id, status: GLOW_ID, name: def.name, category: def.category, duration: 1, ref: GLOW_ID, known: true, tag: a.tag, skill: "飞彩凝辉" });
  }
}

const glowHolders = (battle: any, o: Entity): Entity[] => allies(battle, o).filter(m => m.statuses.some(s => s.def.id === GLOW_ID && s.sourceId === o.id));

async function onDeduct(battle: any, o: Entity, amount: number): Promise<void> {
  if (!o.alive || lightStacks(o) < 1) return;
  const holder = glowHolders(battle, o)[0];
  if (!holder) return;
  for (const st of [...holder.statuses]) {
    if (st.def.id !== GLOW_ID || st.sourceId !== o.id || !holder.expireStatus(st)) continue;
    battle.trace.push({ t: "STACKS_CONSUMED", id: holder.id, status: GLOW_ID, name: "集落光", from: 1, to: 0, reason: "ORB_DEDUCTED", skill: "飞彩凝辉" });
    break;
  }
  battle.advanceOrbGauge(o.teamId, amount, "集落光", o.id);
  setLight(battle, o, lightStacks(o) - 1, "GLOW_TRIGGERED");
  const foes: Entity[] = battle.enemiesOf(o.teamId).filter((v: Entity) => v.alive);
  const front = foes.reduce<Entity | null>((a, v) => (!a || (battle.timeline.get(v.id)?.pos ?? 0) > (battle.timeline.get(a.id)?.pos ?? 0) ? v : a), null);
  if (!front) return;
  const turns = hasLevelLine(skillById(o, "395_03")?.ir, /持续时间增至2回合/) ? OITSUKI.lostTurnsL3 : OITSUKI.lostTurns;
  const def = lostDef();
  const ex = front.statuses.find(s => s.def.id === LOST_ID && s.sourceId === o.id);
  if (ex) { ex.remaining = Math.max(ex.remaining, turns); return; }
  const a = front.addStatus(def, o.id, 1, turns, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: o.id, dst: front.id, status: LOST_ID, name: def.name, category: def.category, duration: turns, ref: LOST_ID, known: true, tag: a.tag, skill: "集落光" });
}

/** A 集落光 that was not consumed ends: L2 dispel 1 debuff / control, L5 +30% ATK and +30 SPD (2 turns). */
async function glowExpired(battle: any, o: Entity, m: Entity): Promise<void> {
  const x = skillById(o, "395_03")?.ir;
  if (hasLevelLine(x, /驱散目标1个减益/)) {
    const pool = m.statuses.filter(s => isDebuffOrControl(s.def) && s.def.dispellable);
    const st = pool.find(s => isControlDef(s.def)) ?? pool[0];
    if (st && m.dispel(st.def.id)) {
      battle.trace.push({ t: "STATUS_REMOVE", id: m.id, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what: isControlDef(st.def) ? "CONTROL" : "DEBUFF", src: o.id, skill: "集落光" });
    }
  }
  if (hasLevelLine(x, /提升目标30%攻击与30点速度/)) {
    const def = boostDef();
    for (const st of [...m.statuses]) if (st.def.id === BOOST_ID) m.expireStatus(st);
    const a = m.addStatus(def, o.id, 1, OITSUKI.endTurns, [
      { prop: "atk", value: OITSUKI.endAtk * kbBaseAtk(m), mode: "FIXED" }, { prop: "spd", value: OITSUKI.endSpd, mode: "FIXED" },
    ], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: o.id, dst: m.id, status: BOOST_ID, name: def.name, category: def.category, duration: OITSUKI.endTurns, ref: GLOW_ID, known: true, tag: a.tag, skill: "集落光" });
  }
}

// ───────────────────────── turn hooks ─────────────────────────

async function onOwnTurnStart(battle: any, o: Entity): Promise<void> {
  // The marks held now end at this turn's end ("维持1回合"); a cast this turn replaces them with new ones (new tags).
  const due = glowHolders(battle, o).map(m => m.id + ":" + (m.statuses.find(s => s.def.id === GLOW_ID && s.sourceId === o.id)?.tag ?? ""));
  setNote(o, DUE, due.join(","));
}

async function onOwnTurnEnd(battle: any, o: Entity): Promise<void> {
  const due = new Set((noteValue(o, DUE) ?? "").split(",").filter(Boolean));
  setNote(o, DUE, null);
  for (const m of allies(battle, o)) {
    const st = m.statuses.find(s => s.def.id === GLOW_ID && s.sourceId === o.id);
    if (!st || !due.has(m.id + ":" + st.tag)) continue;   // a mark re-applied this turn has a new tag: kept
    if (!m.expireStatus(st)) continue;
    battle.trace.push({ t: "STATUS_EXPIRE", id: m.id, status: GLOW_ID, reason: "DURATION" });
    await glowExpired(battle, o, m);
  }
  setLight(battle, o, OITSUKI.lightCap, "TURN_END");
  if (!activeOk(o)) return;
  battle.advanceOrbGauge(o.teamId, OITSUKI.turnEndCells, "绮罗舞", o.id);
  giveShine(battle, o, OITSUKI.turnEndShine, "TURN_END");
}

/** IR patches (MAX): 集落光 / 流光 are run by betting-oitsuki.ts. */
export const OITSUKI_PATCHES = Object.freeze({
  "395_03": { note: "飞彩凝辉: 集落光 (until her next turn end) and 流光 (battle start / turn end, cap 3) are run by betting-oitsuki.ts", patch: { statusRefConditionOnly: [0, 1], statusStacks: null } },
});

/** After 飞彩凝辉: 集落光 on every non-summon ally. */
export function oitsukiAfterCast(battle: any, self: Entity, x: any): boolean {
  if (!bettingActive() || x?.id !== "395_03" || !isOitsuki395(self)) return false;
  giveGlow(battle, self);
  return true;
}

const hooked = new WeakSet<object>();
const pendingOverflow = new WeakMap<object, number>();
const pendingDeduct = new WeakMap<object, number[]>();

export function installOitsuki(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const o of entities.filter(isOitsuki395)) {
    if (dancerOf(battle, o.teamId) !== o) continue;   // tips_11
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, passive: boolean, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:395:" + code + (passive ? ":p:" : ":a:") + o.id, o.id, code, fn, range, { passive });
    const pool = battle.teams[o.teamId].orbs;
    if (!hooked.has(pool)) {
      hooked.add(pool);
      setOrbOverflowHook(pool, (n: number) => pendingOverflow.set(battle, (pendingOverflow.get(battle) ?? 0) + n));
      setOrbDeductHook(pool, (n: number) => { const q = pendingDeduct.get(battle) ?? []; q.push(n); pendingDeduct.set(battle, q); });
    }
    const flush = async () => {
      const q = pendingDeduct.get(battle) ?? [];
      pendingDeduct.set(battle, []);
      for (const n of q) await onDeduct(battle, o, n);
      const over = pendingOverflow.get(battle) ?? 0;
      pendingOverflow.set(battle, 0);
      // 绮罗舞 overflow (passive): needs her in 可行动状态, stops once her own 照君 is at the cap.
      if (over > 0 && activeOk(o) && canAct(o) && stacksOn(o, SHINE_ID, o.id) < OITSUKI.shineCap) giveShine(battle, o, over, "ORB_OVERFLOW");
    };
    for (const code of [EV.SKILL_END, EV.ACTION_END, EV.TURN_START, EV.TURN_END]) ensureGlobalHandler(battle, "betting:395:flush:" + code + ":" + o.id, code, flush);
    // 流光 at battle start (飞彩凝辉 text, active) and 先机 +4 cells (绮罗舞 L3, passive).
    reg(EV.BATTLE_START, () => { if (lightStacks(o) === 0) setLight(battle, o, OITSUKI.lightCap, "BATTLE_START"); }, false, "SELF");
    reg(EV.BATTLE_START, () => {
      if (noteValue(o, "oitsuki395:senki=") === "1" || !hasLevelLine(passiveOf(o), /额外推进4格/)) return;
      setNote(o, "oitsuki395:senki=", 1);
      battle.advanceOrbGauge(o.teamId, OITSUKI.senkiCells, "绮罗舞·先机", o.id);
    }, true, "SELF");
    reg(EV.TURN_START, async (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || (ctx.type !== "NORMAL" && ctx.type !== "NEW_TURN")) return;
      if (a.id === o.id) await onOwnTurnStart(battle, o);
    }, false);
    // L5: an ally's turn starts with fewer than 3 onibi ⇒ 1 流光 for +1 cell (passive).
    reg(EV.TURN_START, (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || a.teamId !== o.teamId || isSummonUnit(a) || (ctx.type !== "NORMAL" && ctx.type !== "NEW_TURN")) return;
      if (!hasLevelLine(passiveOf(o), /鬼火数不足3点/) || pool.current >= OITSUKI.lowOrbs || lightStacks(o) < 1) return;
      setLight(battle, o, lightStacks(o) - 1, "LOW_ONIBI");
      battle.advanceOrbGauge(o.teamId, 1, "绮罗舞 L5", o.id);
    }, true);
    reg(EV.TURN_END, async (ctx: any) => {
      if (ctx?.actor?.id === o.id && (ctx.type === "NORMAL" || ctx.type === "NEW_TURN")) await onOwnTurnEnd(battle, o);
    }, false, "SELF");
    out.push({ entityId: o.id, mechanic: "绮罗舞 (gauge +3, 照君, overflow, 先机, L5) · 集落光 / 失彩 / 流光" });
  }
  if (!out.length) return out;
  // 失彩: the bearer's own turn does not advance its gauge (one cell taken back before the advance).
  ensureGlobalHandler(battle, "betting:395:lost", EV.ORB_GAUGE_ADVANCE, (ctx: any) => {
    const team = ctx?.team;
    if (!team) return;
    const actor: Entity | undefined = lostActor.get(battle);
    if (!actor || battle.teams[actor.teamId] !== team || !actor.statuses.some(s => s.def.id === LOST_ID)) return;
    team.orbs.gauge -= 1;
    battle.trace.push({ t: "ORB_GAUGE_BLOCKED", team: actor.teamId, actor: actor.id, status: LOST_ID, name: "失彩" });
  });
  ensureGlobalHandler(battle, "betting:395:lost-actor", EV.TURN_START, (ctx: any) => { lostActor.set(battle, ctx?.actor); });
  return out;
}

/** Actor of the running turn (the ORB_GAUGE_ADVANCE payload only carries the team). */
const lostActor = new WeakMap<object, Entity | undefined>();
