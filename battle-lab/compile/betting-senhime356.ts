// compile/betting-senhime356.ts — 千姬 (SSR 356, Global "Senhime"; NOT 鲸汐千姬 562 in betting-senhime.ts) at max skill
// level. MAX mode only (match 9, 2026-11-24a).
//
// Sources: data/kb/shikigami.json 356_01..356_03, tips_3565 海原贝戟, buffs 3562_1 汐梦 / 3563_1 潮声, tips_112 深度冰冻;
// data/kb/ai.json row 356 + duiyi.json AI text 「无锤插锤，二技能选择生命比例最高者，五层悲歌拔锤」; data/kb/en-text.json
// (Global); fandom "Senhime/Main" (Global wording; the only source for 永生之汐 / 悲歌, which the CN KB lacks).
// Before (engine): none of the KB AI rows compiled (召唤物位 conditions unresolved) ⇒ she never summoned and only ever
// basic-attacked; 汐梦's passive 10% bar was compiled as a pull on cast and 汐梦 (3562_1) was applied without its
// halberd condition and did nothing.
//   AI · no halberd and a free summon slot → 海潮入梦 (cost 0); halberd + 5 悲歌 + 2 onibi → 永生之汐 (拔锤);
//        halberd → 汐梦 when affordable (target: KB row, highest HP); else 千汐.
//   海潮入梦 (356_03) · summons 海原贝戟 (kernel: HP 550% of her ATK — no 2.42 scale, it is a summon —, DEF 100%,
//        cannot act, immune to debuffs/control, heals the damaged ally 30% of the damage while present). L2: while the
//        halberd is present she and the halberd take 30% less damage. L3: every onibi her team spends gives the
//        halberd 1 潮声 (100%). L5: summoned with 3 潮声. Each 7 潮声 gained: +3 onibi and +15% damage to every
//        non-summon ally, permanent, max 5 (潮声·增伤).
//   永生之汐 (fandom; replaces 海潮入梦 while the halberd is present) · 2 onibi; at the start of her own turns she gains
//        1 悲歌 (max 5) while the halberd is present; deals (120 + 100 × 悲歌)% ATK to all enemies (620% at 5); then
//        悲歌 is cleared, she pulls the halberd out (it leaves the field: 「无锤插锤」) and the skill reverts.
//        The halberd's death also clears 悲歌.
//   L4 「千姬手持海原贝戟时永久免疫控制效果和放逐」 · read as: while NO halberd of hers is planted on the field (she holds
//        it — between battle start / a 拔锤 and the next 海潮入梦), she is immune to control and banish. (Doubt: the
//        other reading — while the halberd is present — would make her almost permanently immune.)
//   汐梦 (356_02) · passive: after every non-summon enemy's own turn she gains 10% action bar (shiftBar: chains /
//        bar locks stop it; 鬼童丸 reacts to it through betting-bar.ts). Active: 211% (IR) and, with the halberd
//        present, 汐梦 on the target (contested, no written chance): consumed after the bearer's next own turn in
//        which it acted, removing 3 onibi from its team; L5: if that team then has 0 onibi → 深度冰冻 1 turn.
//   千汐 (356_01) L5 · with the halberd present, +1 潮声.
// Readings (unverified): 潮声 counts onibi actually paid (ORB_PAY), free casts give nothing; 潮声·增伤 is applied
// to the allies living at the time of each reward; 汐梦 that never sees its bearer act stays until removed.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { StatusDef } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler,
  stacksOn, setStackedStatus, shiftBar, gainOrbs, drainOrbs, applyContested, PERSIST,
} from "./betting-shared.ts";
import { bearerTurnControl } from "./betting-fengyang.ts";

export const SENHIME356 = Object.freeze({
  barPct: 0.1, tidePer: 7, tideOrbs: 3, tideDmg: 0.15, tideCap: 5, tideStart: 3, dirgeCap: 5,
  eternityBase: 120, eternityPer: 100, eternityCost: 2, halberdDr: 0.3, dreamDrain: 3,
});
export const HALBERD_TIPS = "3565";
export const TIDE_ID = "3563_1";
export const TIDE_DMG_ID = "3563_dmg";
export const DIRGE_ID = "356_dirge";
export const DREAM_ID = "3562_1";
export const HOLD_ID = "356_hold";
const N_INIT = "s356:halberd-init=";
const N_REWARDS = "s356:tide-rewards=";
const N_GAINED = "s356:tide-gained=";

const tideDef = (): StatusDef => StatusBook.get(TIDE_ID) ?? markDef({ id: TIDE_ID, name: "潮声", category: StatusCategory.BUFF_MARK,
  desc: "【增益、印记】海原贝戟每叠加7层潮声，获得3点鬼火；并使全体友方伤害永久提升15%，上限5层。" }, StatusBook);
const tideDmgDef = (): StatusDef => markDef({ id: TIDE_DMG_ID, name: "潮声·增伤", category: StatusCategory.BUFF_MARK,
  desc: "潮声：海原贝戟每叠加7层潮声，全体友方伤害永久提升15%（至多5层）。" }, StatusBook);
const dirgeDef = (): StatusDef => markDef({ id: DIRGE_ID, name: "悲歌", category: StatusCategory.BUFF_MARK,
  desc: "悲歌：千姬回合开始时获得1层（至多5层），提升永生之汐的伤害；施放永生之汐或海原贝戟阵亡后清除。" }, StatusBook);
const dreamDef = (): StatusDef => StatusBook.get(DREAM_ID) ?? markDef({ id: DREAM_ID, name: "汐梦", category: StatusCategory.DEBUFF_MARK,
  desc: "【减益、印记】行动后消耗，扣除3点鬼火，对怪物不生效。" }, StatusBook);
const holdDef = (): StatusDef => markDef({ id: HOLD_ID, name: "手持海原贝戟", category: StatusCategory.BUFF_STATE, immuneTo: ["CONTROL", "BANISH"],
  desc: "千姬手持海原贝戟时永久免疫控制效果和放逐（海原贝戟未插在场上时）。" }, StatusBook);

export const isSenhime356 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "356_02") && !!skillById(e, "356_03");
const isOwnTurnType = (t: any): boolean => t === "NORMAL" || t === "NEW_TURN";

export function halberdOf(battle: any, s: Entity): Entity | null {
  const team = battle.teams[s.teamId];
  return (team?.summons ?? []).find((h: Entity) => h.alive && h.notes.includes("summon:" + HALBERD_TIPS) && h.notes.includes("summon:owner=" + s.id)) ?? null;
}
function slotBusy(battle: any, s: Entity): boolean {
  const team = battle.teams[s.teamId];
  return (team?.summons ?? []).filter((x: Entity) => x.alive && x.caps.occupiesSummonSlot).length >= (team?.summonSlots ?? 1);
}
export const dirgeOf = (s: Entity): number => stacksOn(s, DIRGE_ID);
export const tideRewards = (s: Entity): number => Number(noteValue(s, N_REWARDS) ?? 0);

function setDirge(battle: any, s: Entity, n: number, reason: string): void {
  const before = dirgeOf(s);
  const after = setStackedStatus(s, dirgeDef(), n, SENHIME356.dirgeCap, s.id, []);
  if (after === before) return;
  if (after > before) battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: s.id, status: DIRGE_ID, name: "悲歌", category: StatusCategory.BUFF_MARK, duration: PERSIST, ref: DIRGE_ID, known: true, stacks: after, skill: "永生之汐" });
  else battle.trace.push({ t: "STACKS_CONSUMED", id: s.id, status: DIRGE_ID, name: "悲歌", from: before, to: after, reason, skill: "永生之汐" });
}

/** L4: immune to control / banish while no halberd of hers is planted. */
function syncHold(battle: any, s: Entity): void {
  if (!s.alive) return;
  const planted = !!halberdOf(battle, s);
  const st = s.statuses.find(x => x.def.id === HOLD_ID);
  if (planted && st) s.expireStatus(st);
  if (!planted && !st) {
    s.addStatus(holdDef(), s.id, 1, PERSIST, [], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: s.id, status: HOLD_ID, name: "手持海原贝戟", category: StatusCategory.BUFF_STATE, duration: PERSIST, ref: HOLD_ID, known: true, skill: "海潮入梦" });
  }
}

/** 潮声: `n` stacks to the halberd; every 7 gained → +3 onibi and +15% damage to all allies (max 5 rewards). */
function addTide(battle: any, s: Entity, h: Entity, n: number, reason: string): void {
  if (!(n > 0) || !h.alive) return;
  const gained = Number(noteValue(h, N_GAINED) ?? 0) + n;
  setNote(h, N_GAINED, gained);
  const shown = setStackedStatus(h, tideDef(), stacksOn(h, TIDE_ID) + n, 999, s.id, []);
  battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: h.id, status: TIDE_ID, name: "潮声", category: StatusCategory.BUFF_MARK, duration: PERSIST, ref: TIDE_ID, known: true, stacks: shown, skill: reason });
  const due = GameMath.floorAt(gained / SENHIME356.tidePer, "S356_TIDE") - GameMath.floorAt((gained - n) / SENHIME356.tidePer, "S356_TIDE");
  for (let i = 0; i < due; i++) tideReward(battle, s, h);
}
function tideReward(battle: any, s: Entity, h: Entity): void {
  gainOrbs(battle, h, s.teamId, SENHIME356.tideOrbs, "潮声");
  const done = tideRewards(s);
  if (done >= SENHIME356.tideCap) return;
  setNote(s, N_REWARDS, done + 1);
  for (const a of (battle.teams[s.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m))) {
    const k = setStackedStatus(a, tideDmgDef(), done + 1, SENHIME356.tideCap, s.id, [{ prop: "dmgDealtB", value: SENHIME356.tideDmg, mode: "FIXED" }]);
    battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: a.id, status: TIDE_DMG_ID, name: "潮声·增伤", category: StatusCategory.BUFF_MARK, duration: PERSIST, ref: TIDE_DMG_ID, known: true, stacks: k, skill: "潮声" });
  }
}

/** The halberd leaves the field (拔锤): not a death (same steps as betting-senhime.ts whaleTurnDone). */
function pullHalberd(battle: any, h: Entity): void {
  h.alive = false;
  battle.timeline.remove(h.id);
  battle.bus.unregisterOwner(h.id);
  h.notes.push("summon:removed:PULLED");
  battle.trace.push({ t: "SUMMON_REMOVE", summon: h.id, name: h.name, tipsId: HALBERD_TIPS, reason: "PULLED" });
}

async function eternity(battle: any, s: Entity, h: Entity): Promise<void> {
  const dirge = dirgeOf(s);
  const ratio = SENHIME356.eternityBase + SENHIME356.eternityPer * dirge;
  battle.trace.push({ t: "SUBCAST", actor: s.id, ref: "356_03", skill: "永生之汐", target: null, clause: "五层悲歌拔锤：永生之汐" });
  for (const v of battle.enemiesOf(s.teamId).filter((e: Entity) => e.alive)) {
    if (v.alive) await battle.damage(s, v, s.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, null);
  }
  setDirge(battle, s, 0, "永生之汐");
  pullHalberd(battle, h);
  syncHold(battle, s);
}

const lastHit = new WeakMap<object, Map<number, number>>();

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isSenhime356(self)) return null;
  const orbs = battle.teams[self.teamId].orbs;
  const can = (sk: any) => { const c = costOf(sk); return !(c > 0) || orbs.canPay(c); };
  const basic = skillById(self, "356_01"), tide = skillById(self, "356_02"), summon = skillById(self, "356_03");
  const h = halberdOf(battle, self);
  if (!h && summon && !slotBusy(battle, self)) return { skill: summon, rule: "千姬: 无锤插锤 → 海潮入梦 (KB AI)" };
  if (h && summon && dirgeOf(self) >= SENHIME356.dirgeCap && can(summon)) return { skill: summon, rule: "千姬: 五层悲歌拔锤 → 永生之汐 (KB AI)" };
  if (tide && can(tide)) return { skill: tide, rule: "千姬: 召唤物位被占用 → 汐梦 (KB AI)" };
  return basic ? { skill: basic, rule: "千姬: 鬼火不足 → 千汐" } : null;
}

function gate(battle: any, self: Entity, sk: any): string | null {
  if (!bettingActive() || !isSenhime356(self) || sk?.ir?.id !== "356_03") return null;
  const h = halberdOf(battle, self);
  if (h && dirgeOf(self) < SENHIME356.dirgeCap) return "HALBERD_PRESENT (永生之汐 needs 5 悲歌)";
  if (!h && slotBusy(battle, self)) return "SUMMON_SLOT_BUSY";
  return null;
}

function cost(battle: any, self: Entity, sk: any, base: number): number {
  // The AI passes the skill object (sk.ir.id), the cast path the IR itself (sk.id).
  if (!bettingActive() || (sk?.ir ?? sk)?.id !== "356_03" || !isSenhime356(self)) return base;
  return halberdOf(battle, self) ? SENHIME356.eternityCost : base;
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isSenhime356(self)) return false;
  const h = halberdOf(battle, self);
  if (x?.id === "356_03") {
    if (!h) { syncHold(battle, self); return true; }
    if (noteValue(h, N_INIT) !== null) { await eternity(battle, self, h); return true; }
    setNote(h, N_INIT, battle.turn ?? 0);
    syncHold(battle, self);
    addTide(battle, self, h, SENHIME356.tideStart, "海潮入梦");
    return true;
  }
  if (x?.id === "356_02") {
    const id = lastHit.get(battle)?.get(self.id);
    lastHit.get(battle)?.delete(self.id);
    const v = battle.enemiesOf(self.teamId).find((e: Entity) => e.id === id && e.alive);
    if (h && v && !isSummonUnit(v)) await applyContested(battle, self, v, dreamDef(), null, PERSIST, [], { skill: "汐梦", ref: DREAM_ID });
    return true;
  }
  if (x?.id === "356_01") {
    if (h) addTide(battle, self, h, 1, "千汐");
    return true;
  }
  return false;
}

/** 汐梦 consumed after its bearer acted in its own turn: −3 onibi; L5 0 onibi → 深度冰冻 (1 turn). */
async function consumeDream(battle: any, bearer: Entity, acted: boolean): Promise<void> {
  const st = bearer.statuses.find(x => x.def.id === DREAM_ID);
  if (!st || !acted) return;
  const src: Entity | null = battle.allEntities().find((e: Entity) => e.id === st.sourceId) ?? null;
  bearer.expireStatus(st);
  battle.trace.push({ t: "STACKS_CONSUMED", id: bearer.id, status: DREAM_ID, name: "汐梦", from: 1, to: 0, reason: "行动后消耗", skill: "汐梦" });
  drainOrbs(battle, src ?? bearer, bearer.teamId, SENHIME356.dreamDrain, "汐梦");
  if (src && battle.teams[bearer.teamId].orbs.current <= 0 && bearer.alive) {
    await applyContested(battle, src, bearer, bearerTurnControl("deepFreeze"), null, 1, [{ prop: "spd", value: -20, mode: "FIXED" }], { skill: "汐梦", ref: "CONTROL:deepFreeze" });
  }
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isSenhime356);
  if (!units.length) return out;
  // 汐梦 consumption (global: the debuff outlives its source).
  const acted = new Map<number, boolean>();
  ensureGlobalHandler(battle, "betting:356:dream-start", EV.TURN_START, (ctx: any) => { if (ctx?.actor && isOwnTurnType(ctx.type)) acted.set(ctx.actor.id, false); });
  ensureGlobalHandler(battle, "betting:356:dream-act", EV.SKILL_END, (ctx: any) => { if (ctx?.actor && acted.has(ctx.actor.id)) acted.set(ctx.actor.id, true); });
  ensureGlobalHandler(battle, "betting:356:dream-end", EV.TURN_END, async (ctx: any) => {
    const a: Entity | undefined = ctx?.actor;
    if (!a || !isOwnTurnType(ctx.type)) return;
    const did = acted.get(a.id) ?? false;
    acted.delete(a.id);
    await consumeDream(battle, a, did);
  });
  for (const s of units) {
    let seq = 0;
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = false) =>
      registerOwnerHandler(battle, "betting:356:" + code + ":" + s.id + ":" + (seq++), s.id, code, fn, range, { passive });
    reg(EV.BATTLE_START, () => syncHold(battle, s), "SELF");
    // 汐梦 passive: +10% bar after every non-summon enemy's own turn.
    reg(EV.TURN_END, (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || a.teamId === s.teamId || isSummonUnit(a) || !isOwnTurnType(ctx.type) || !s.alive) return;
      shiftBar(battle, s, SENHIME356.barPct, "汐梦");
    }, "ALL", true);
    // 悲歌: +1 at the start of her own turns while the halberd is present.
    reg(EV.TURN_START, (ctx: any) => {
      if (ctx?.actor?.id !== s.id || !isOwnTurnType(ctx.type) || !halberdOf(battle, s)) return;
      setDirge(battle, s, dirgeOf(s) + 1, "TURN_START");
    }, "SELF");
    // 潮声 from every onibi her team pays (L3 100%).
    ensureGlobalHandler(battle, "betting:356:tide:" + s.id, EV.ORB_COST, (ctx: any) => {
      if (ctx?.team !== s.teamId || !(Number(ctx?.amount) > 0)) return;
      const h = halberdOf(battle, s);
      if (h) addTide(battle, s, h, Number(ctx.amount), "潮声");
    });
    // 汐梦 target of the running cast.
    reg(EV.AFTER_DAMAGE, (ctx: any) => {
      if (ctx?.input?.source?.id !== s.id || !ctx?.input?.target) return;
      let m = lastHit.get(battle);
      if (!m) { m = new Map(); lastHit.set(battle, m); }
      m.set(s.id, ctx.input.target.id);
    }, "SELF");
    // L2: she and the halberd take 30% less damage while it is present.
    reg(EV.BEFORE_DAMAGE, (ctx: any) => {
      const res = ctx?.result, t = ctx?.input?.target;
      if (!res || res.ignoresModifiers || !(res.final > 0) || !t) return;
      const h = halberdOf(battle, s);
      if (!h || (t.id !== s.id && t.id !== h.id)) return;
      res.final *= 1 - SENHIME356.halberdDr;
      battle.trace.push({ t: "DAMAGE_REDUCED", id: t.id, by: "海潮入梦", ratio: SENHIME356.halberdDr });
    });
    // The halberd's death clears 悲歌 and gives back the L4 hold immunity.
    ensureGlobalHandler(battle, "betting:356:halberd-death:" + s.id, EV.DEATH, (ctx: any) => {
      const t: Entity | undefined = ctx?.target ?? ctx?.entity;
      if (!t || !t.notes?.includes("summon:owner=" + s.id) || !t.notes?.includes("summon:" + HALBERD_TIPS)) return;
      if (dirgeOf(s) > 0) setDirge(battle, s, 0, "海原贝戟阵亡");
      syncHold(battle, s);
    });
    out.push({ entityId: s.id, mechanic: "千姬 KB AI (插锤 / 汐梦 / 五层悲歌拔锤) · 汐梦 bar +10% · 汐梦 drain / 深度冰冻 · 潮声 rewards · 悲歌 / 永生之汐 · L2 DR · L4 hold immunity" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "356_02": { note: "汐梦: the 10% bar is the passive after enemy turns and 汐梦 needs the halberd — both run by betting-senhime356.ts", patch: { timeline: [], statusRefConditionOnly: [0] } },
  }),
  cost,
  ruleSkill,
  gate,
  afterCast,
  install,
};
