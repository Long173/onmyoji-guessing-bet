// compile/betting-enmusubi.ts — 纺愿缘结神 554 (Global "Bondweaver Enmusubi") at max skill level. MAX mode only (match 7).
//
// Sources: data/kb/shikigami.json 554_01..554_03, buffs 5541_1 神力 / 5544_1 尘缘·赤 / 5545_1 尘缘·青, tips_14 庇护;
// data/kb/en-text.json (Global); fandom "Negai Tsumugi Enmusubi no Kami/Main" (the 胜天之缘 skill boxes).
//   纺缘 (554_01)       · L5: +1 神力 after the attack.
//   神力 (5541_1)       · stacks on herself, cap 5, +20% effect RES per stack.
//   守缘刃 (554_02, 1)  · 唯一. She is immune to action-bar changes from other units. Bonds a designated ally (not
//                        herself) with 胜天之缘·赤 / ·青 (the KB AI names 赤) and gains 2 神力. Fandom: the bonded ally
//                        is immune to action-bar DECREASES, and 与世结缘 on it guarantees the bond's colour of 尘缘.
//                        Recast: dissolves the bond and dispels all debuffs / controls of the bonded ally (a recast
//                        on another ally then bonds that ally). When her turn ends the bonded ally gets +30% action
//                        bar, when the bonded ally's turn ends she gets +30% (each at most once before the receiver's
//                        next turn start). At most one bond on the field.
//   与世结缘 (554_03, 2) · 唯一. +1 神力, heals the target 8% of ITS OWN max HP ("治疗友方目标生命上限8%"; the
//                        generic path used her max HP), then 尘缘: the bond colour when the target is bonded, else one
//                        roll 50% 赤 / 50% 青 (read as one or the other); ≥3 神力 (after this cast's gain): the other
//                        allies are healed 8% of their own max HP too; 5 神力: the target gets both. Heals can crit
//                        (her own crit roll so that L5 sees it). L2: a 尘缘 bearer gains 1 onibi at its turn start.
//                        L3: 庇护 on herself and the target, sustained 1 turn (SOURCE_TURN, 2 ticks). L4: target at
//                        100% HP when healed ⇒ shield 8% of its max HP for 2 of its turns. L5: crit heal ⇒ target
//                        +40% of her crit damage as crit damage (max 110%), sustained 1 turn.
//   尘缘·赤 (5544_1)    · at the end of the bearer's next turn: 1 extra turn (kernel/extra-turn.ts) in which its onibi
//                        skills cost 2 less; consumed on trigger, so the extra turn cannot trigger it again.
//   尘缘·青 (5545_1)    · at the bearer's next turn start: dispels 1 debuff and 1 control from every other ally, and the
//                        bearer takes 50% less damage until Enmusubi's next turn start; consumed on trigger.
//   AI (KB)            · no bond on the field → 守缘刃 (赤) on the highest-ATK ally (atkForTargeting); otherwise
//                        与世结缘 on the bonded ally; the normal attack when the onibi are short. The engine had her
//                        recast 守缘刃 every turn (神力 landed on the ally, the +30% bar on herself) and never cast S3.
// Doubts: the bond colour is always 赤 (the KB AI only names 2技能【胜天之缘·赤】); 尘缘 marks live until consumed.
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { BettingKit } from "./betting-m7.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler,
  ensureShieldTicker, grantTimedShield, shiftBar, gainOrbs, isControlDef, isDebuffOrControl, setStackedStatus, stacksOn,
  atkForTargeting,
} from "./betting-shared.ts";
import { inOwnTurn } from "./betting-scope.ts";
import { grantExtraTurn } from "../kernel/extra-turn.ts";

export const ENMU = Object.freeze({
  powerCap: 5, powerEfr: 0.2, bondPower: 2, worldPower: 1, basicPower: 1, bondBar: 0.3,
  heal: 0.08, othersAt: 3, bothAt: 5, redCostCut: 2, blueCut: 0.5, fullShield: 0.08, shieldTurns: 2,
  critShare: 0.4, critCap: 1.1, sustain: 2,
});

export const POWER_ID = "5541_1";
export const RED_ID = "5544_1";
export const BLUE_ID = "5545_1";
export const BOND_RED_ID = "554_bond_red";
export const BOND_BLUE_ID = "554_bond_blue";
export const BLUE_DR_ID = "554_blue_dr";
export const ENMU_SHELTER_ID = "554_shelter";
export const ENMU_CRID_ID = "554_crid";
const N_BAR_TO = "enmu554:barTo";        // on the receiver: got its +30% since its last turn start
const N_RED_PENDING = "enmu554:redPending";
const N_RED_ACTIVE = "enmu554:redActive";

const powerDef = () => markDef({ id: POWER_ID, name: "神力", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】上限5层，每层提升自身20%效果抵抗，并根据已有层数强化『与世结缘』效果。" }, StatusBook);
const redDef = () => markDef({ id: RED_ID, name: "尘缘·赤", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】回合结束后立即获得1个回合，且新回合施放妖术技能消耗的鬼火减少2点。（无法连续触发此效果）" }, StatusBook);
const blueDef = () => markDef({ id: BLUE_ID, name: "尘缘·青", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】回合开始时驱散自身以外的全体友方1个减益状态与控制效果并使自身减伤提升50%，减伤效果持续至纺愿缘结神下个回合开始。" }, StatusBook);
const bondDef = (red: boolean) => markDef({ id: red ? BOND_RED_ID : BOND_BLUE_ID, name: red ? "胜天之缘·赤" : "胜天之缘·青",
  category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "守缘刃：与纺愿缘结神缔结之缘；免疫行动条降低效果（fandom），回合结束时提升对方30%行动条。" }, StatusBook);
const blueDrDef = () => markDef({ id: BLUE_DR_ID, name: "尘缘·青·减伤", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "尘缘·青：减伤提升50%，持续至纺愿缘结神下个回合开始。" }, StatusBook);
const shelterDef = () => markDef({ id: ENMU_SHELTER_ID, name: "庇护", category: StatusCategory.BUFF_MARK, durationPolicy: "SOURCE_TURN",
  immuneTo: ["CONTROL", "BANISH"], consumeOnImmune: true, desc: "可抵挡单次技能当中的所有控制效果和放逐（与世结缘 L3，维持1回合）。" }, StatusBook);
const cridDef = () => markDef({ id: ENMU_CRID_ID, name: "与世结缘·暴伤", category: StatusCategory.BUFF_STATE, durationPolicy: "SOURCE_TURN",
  desc: "与世结缘 L5：治疗暴击时提升目标暴击伤害（自身暴击伤害的40%，至多110%），维持1回合。" }, StatusBook);

export const isEnmu554 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "554_02") && !!skillById(e, "554_03");
export const powerOf = (e: Entity): number => stacksOn(e, POWER_ID);
const BOND_IDS = [BOND_RED_ID, BOND_BLUE_ID];

/** Battle of each installed Enmusubi (the target hook has no battle argument). */
const battles = new WeakMap<object, any>();
/** Target picked for her running cast (transient). */
const castTarget = new WeakMap<object, Entity>();
/** Action-bar changes made by her own effects (transient flag around shiftBar). */
const selfShift = new WeakSet<object>();

const allies = (battle: any, e: Entity): Entity[] => (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m));
export function bondedOf(battle: any, e: Entity): Entity | null {
  return allies(battle, e).find(m => m.statuses.some(s => BOND_IDS.includes(s.def.id) && s.sourceId === e.id)) ?? null;
}
const enmuOfTeam = (battle: any, teamId: number): Entity | null =>
  (battle.teams[teamId]?.members ?? []).find((m: Entity) => isEnmu554(m)) ?? null;

function changePower(battle: any, e: Entity, delta: number, skill: string): number {
  const before = powerOf(e);
  const after = setStackedStatus(e, powerDef(), before + delta, ENMU.powerCap, e.id, [{ prop: "efr", value: ENMU.powerEfr, mode: "FIXED" }]);
  if (after !== before) battle.trace.push({ t: "STATUS_APPLY", src: e.id, dst: e.id, status: POWER_ID, name: "神力", category: StatusCategory.BUFF_MARK, duration: PERSIST, ref: POWER_ID, known: true, stacks: after, threshold: ENMU.powerCap, skill });
  return after;
}

function addMark(battle: any, src: Entity, dst: Entity, def: any, duration: number, skill: string, effects: any[] = []): void {
  for (const st of [...dst.statuses]) if (st.def.id === def.id) dst.expireStatus(st);
  const a = dst.addStatus(def, src.id, 1, duration, effects, 1);
  battle.trace.push({ t: "STATUS_APPLY", src: src.id, dst: dst.id, status: def.id, name: def.name, category: def.category, duration, ref: def.id, known: true, tag: (a as any)?.tag ?? null, skill });
}
function dropMark(e: Entity, id: string): void {
  for (const st of [...e.statuses]) if (st.def.id === id) e.expireStatus(st);
}

/** Dispels up to `n` dispellable statuses of `e` matching `pick` (oldest first). */
function dispelSome(battle: any, src: Entity, e: Entity, pick: (d: any) => boolean, n: number, skill: string, what: string): number {
  let done = 0;
  for (const st of [...e.statuses]) {
    if (done >= n) break;
    if (!pick(st.def) || !st.def.dispellable || !e.dispel(st.def.id)) continue;
    done++;
    battle.trace.push({ t: "STATUS_REMOVE", id: e.id, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what, src: src.id, skill });
    battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: e, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what, src: src.id, skill }, e.id, e.teamId);
  }
  return done;
}

function highestAtkAlly(battle: any, e: Entity): Entity | null {
  const pool = allies(battle, e).filter(m => m.id !== e.id);
  return pool.reduce<Entity | null>((a, b) => (!a || atkForTargeting(b) > atkForTargeting(a) ? b : a), null);
}

// ───────────────────────── casts ─────────────────────────

function wardingShears(battle: any, e: Entity, target: Entity | null): void {
  const old = bondedOf(battle, e);
  if (old) {
    for (const id of BOND_IDS) dropMark(old, id);
    battle.trace.push({ t: "STATUS_REMOVE", id: old.id, status: "554_bond", name: "胜天之缘", by: "DISSOLVE", side: "ALLY", what: "MARK", src: e.id, skill: "守缘刃" });
    dispelSome(battle, e, old, isDebuffOrControl, 99, "守缘刃", "DEBUFF_OR_CONTROL");
  }
  if (target && target.alive && target.id !== e.id && (!old || old.id !== target.id)) addMark(battle, e, target, bondDef(true), PERSIST, "守缘刃");
  changePower(battle, e, ENMU.bondPower, "守缘刃");
}

async function healWithCrit(battle: any, e: Entity, m: Entity, amount: number): Promise<boolean> {
  battle.rng.expect("enmu554_heal_crit:" + m.id);
  const crit = battle.rng.testHit(e.prop("cri"));
  await battle.heal(e, m, amount * (crit ? e.prop("crid") : 1), { crit: false });
  return crit;
}

async function bondWithWorld(battle: any, e: Entity, target: Entity): Promise<void> {
  const power = changePower(battle, e, ENMU.worldPower, "与世结缘");
  const wasFull = target.hp >= target.maxHp - 1e-6;
  const crit = await healWithCrit(battle, e, target, target.maxHp * ENMU.heal);
  if (power >= ENMU.othersAt) {
    for (const m of allies(battle, e)) if (m.id !== target.id) await healWithCrit(battle, e, m, m.maxHp * ENMU.heal);
  }
  let red: boolean, blue: boolean;
  if (power >= ENMU.bothAt) { red = true; blue = true; }
  else if (target.hasStatus(BOND_RED_ID)) { red = true; blue = false; }
  else if (target.hasStatus(BOND_BLUE_ID)) { red = false; blue = true; }
  else { battle.rng.expect("enmu554_worldly_bond"); red = battle.rng.testHit(0.5); blue = !red; }
  if (red) addMark(battle, e, target, redDef(), PERSIST, "与世结缘");
  if (blue) addMark(battle, e, target, blueDef(), PERSIST, "与世结缘");
  // L3: 庇护 on herself and the target, sustained 1 turn.
  for (const m of target.id === e.id ? [e] : [e, target]) addMark(battle, e, m, shelterDef(), ENMU.sustain, "与世结缘");
  // L4: full HP when healed ⇒ shield 8% of its max HP for 2 turns.
  if (wasFull) grantTimedShield(battle, e, target, target.maxHp * ENMU.fullShield, ENMU.shieldTurns,
    { tag: "554full", skill: "与世结缘", reason: "FULL_HP_HEAL", base: "maxHp", ratio: ENMU.fullShield * 100 });
  // L5: crit heal ⇒ +40% of her crit damage (max 110%), sustained 1 turn.
  if (crit) {
    const v = Math.min(ENMU.critCap, ENMU.critShare * e.prop("crid"));
    addMark(battle, e, target, cridDef(), ENMU.sustain, "与世结缘", [{ prop: "crid", value: v, mode: "FIXED" }]);
  }
}

// ───────────────────────── marks / bond reactions ─────────────────────────

function onTurnStart(battle: any, ctx: any): void {
  const a: Entity | undefined = ctx?.actor;
  if (!a?.alive) return;
  setNote(a, N_BAR_TO, null);
  if (ctx.type === "NEW_TURN" && noteValue(a, N_RED_PENDING) !== null) { setNote(a, N_RED_PENDING, null); setNote(a, N_RED_ACTIVE, 1); }
  // Enmusubi's turn start ends every 尘缘·青 reduction she granted.
  if (isEnmu554(a)) for (const m of battle.teams[a.teamId].members as Entity[]) {
    for (const st of [...m.statuses]) if (st.def.id === BLUE_DR_ID && st.sourceId === a.id) m.expireStatus(st);
  }
  const red = a.statuses.find(s => s.def.id === RED_ID), blue = a.statuses.find(s => s.def.id === BLUE_ID);
  if (red || blue) gainOrbs(battle, a, a.teamId, 1, "与世结缘");   // L2
  if (!blue) return;
  const src = (battle.allEntities() as Entity[]).find(x => x.id === blue.sourceId) ?? a;
  a.expireStatus(blue);
  battle.trace.push({ t: "MARK_TRIGGER", id: a.id, status: BLUE_ID, name: "尘缘·青", skill: "与世结缘" });
  for (const m of allies(battle, a)) {
    if (m.id === a.id) continue;
    dispelSome(battle, src, m, d => String(d.category).startsWith("DEBUFF") && !isControlDef(d), 1, "尘缘·青", "DEBUFF");
    dispelSome(battle, src, m, isControlDef, 1, "尘缘·青", "CONTROL");
  }
  addMark(battle, src, a, blueDrDef(), PERSIST, "尘缘·青");
}

function onTurnEnd(battle: any, ctx: any): void {
  const a: Entity | undefined = ctx?.actor;
  if (!a) return;
  if (noteValue(a, N_RED_ACTIVE) !== null) { setNote(a, N_RED_ACTIVE, null); return; }   // the 尘缘·赤 turn ends
  const red = a.statuses.find(s => s.def.id === RED_ID);
  if (!red || !a.alive) return;
  a.expireStatus(red);
  battle.trace.push({ t: "MARK_TRIGGER", id: a.id, status: RED_ID, name: "尘缘·赤", skill: "与世结缘" });
  setNote(a, N_RED_PENDING, 1);
  grantExtraTurn(battle, a, "尘缘·赤");
}

function bondBar(battle: any, e: Entity, ctx: any): void {
  const a: Entity | undefined = ctx?.actor;
  if (!a || !e.alive) return;
  const bonded = bondedOf(battle, e);
  if (!bonded) return;
  const to = a.id === e.id ? bonded : a.id === bonded.id ? e : null;
  if (!to || !to.alive || noteValue(to, N_BAR_TO) !== null) return;
  setNote(to, N_BAR_TO, 1);
  selfShift.add(e);
  try { shiftBar(battle, to, ENMU.bondBar, "守缘刃"); } finally { selfShift.delete(e); }
}

/** Bar immunity — hers (any change from another unit) and the bonded ally's (decreases) — via a timeline wrapper. */
const wrapped = new WeakSet<object>();
function wrapTimeline(battle: any): void {
  const tl = battle.timeline;
  if (wrapped.has(tl)) return;
  wrapped.add(tl);
  const orig = tl.shift.bind(tl);
  tl.shift = (id: number, percent: number): boolean => {
    const e = bettingActive() ? (battle.allEntities() as Entity[]).find(x => x.id === id) : undefined;
    if (e?.alive) {
      const own = isEnmu554(e) && enmuOfTeam(battle, e.teamId) === e && !selfShift.has(e);
      const bondDown = percent < 0 && e.statuses.some(s => BOND_IDS.includes(s.def.id));
      if (own || bondDown) {
        battle.trace.push({ t: "BAR_IMMUNE", id, percent, by: own ? "守缘刃" : "胜天之缘", skill: "守缘刃" });
        return false;
      }
    }
    return orig(id, percent);
  };
}

// ───────────────────────── kit ─────────────────────────

export const KIT: BettingKit = {
  patches: {
    "554_02": { note: "守缘刃: bond, 神力 on herself, bar riders and the recast dispel are run by betting-enmusubi.ts", patch: { statusRefConditionOnly: [0], timeline: [], purge: [] } },
    "554_03": { note: "与世结缘: heals (target's own max HP), 神力, 尘缘 and the L2-L5 riders are run by betting-enmusubi.ts", patch: { statusRefConditionOnly: [0, 1, 2, 3, 4, 5, 6], heal: [] } },
  },
  cost: (battle, self, _sk, base) => {
    if (!bettingActive() || !(base > 0) || noteValue(self, N_RED_ACTIVE) === null || !inOwnTurn(battle, self)) return base;
    return Math.max(0, base - ENMU.redCostCut);
  },
  ruleSkill: (battle, self, costOf) => {
    if (!bettingActive() || !isEnmu554(self)) return null;
    const orbs = battle.teams[self.teamId].orbs;
    const can = (sk: any) => !!sk && (!(costOf(sk) > 0) || orbs.canPay(costOf(sk)));
    const basic = skillById(self, "554_01");
    if (!bondedOf(battle, self)) {
      const shears = skillById(self, "554_02");
      if (highestAtkAlly(battle, self) && can(shears)) return { skill: shears, rule: "纺愿缘结神: 场上没有胜天之缘 → 守缘刃【胜天之缘·赤】 (KB AI)" };
      return basic ? { skill: basic, rule: "纺愿缘结神: 鬼火不足 / 没有其他友方 → 纺缘" } : null;
    }
    const world = skillById(self, "554_03");
    if (can(world)) return { skill: world, rule: "纺愿缘结神: 胜天之缘存在 → 与世结缘 (KB AI)" };
    return basic ? { skill: basic, rule: "纺愿缘结神: 鬼火不足 → 纺缘" } : null;
  },
  target: (self, x, _cands) => {
    if (!bettingActive() || !isEnmu554(self) || (x?.id !== "554_02" && x?.id !== "554_03")) return null;
    const battle = battles.get(self);
    if (!battle) return null;
    const t = x.id === "554_02" ? highestAtkAlly(battle, self) : (bondedOf(battle, self) ?? highestAtkAlly(battle, self) ?? self);
    if (!t) return null;
    castTarget.set(self, t);
    return { target: t, rule: x.id === "554_02" ? "纺愿缘结神: 守缘刃优先选择攻击高的友方单位 (KB)" : "纺愿缘结神: 与世结缘固定选择施放了2技能的友方单位 (KB)" };
  },
  afterCast: async (battle, self, x) => {
    if (!bettingActive() || !isEnmu554(self)) return false;
    if (x?.id === "554_01") { changePower(battle, self, ENMU.basicPower, "纺缘"); return true; }
    if (x?.id !== "554_02" && x?.id !== "554_03") return false;
    const picked = castTarget.get(self) ?? null;
    castTarget.delete(self);
    if (x.id === "554_02") wardingShears(battle, self, picked ?? highestAtkAlly(battle, self));
    else await bondWithWorld(battle, self, picked?.alive ? picked : (bondedOf(battle, self) ?? self));
    return true;
  },
  install: (battle, entities) => {
    if (!bettingActive()) return [];
    const out: Array<{ entityId: number; mechanic: string }> = [];
    for (const e of entities.filter(isEnmu554)) {
      if (enmuOfTeam(battle, e.teamId) !== e) continue;   // 唯一效果
      battles.set(e, battle);
      ensureShieldTicker(battle);
      wrapTimeline(battle);
      // 守缘刃 is an active skill: its bond rules are not passives (seals do not stop them).
      registerOwnerHandler(battle, "betting:554:bond-bar:" + e.id, e.id, EV.TURN_END, (ctx: any) => bondBar(battle, e, ctx), "ALL", { passive: false });
      // 尘缘 marks act on their bearers (any unit of her team), also after she falls.
      ensureGlobalHandler(battle, "betting:554:marks:start", EV.TURN_START, (ctx: any) => onTurnStart(battle, ctx));
      ensureGlobalHandler(battle, "betting:554:marks:end", EV.TURN_END, (ctx: any) => onTurnEnd(battle, ctx));
      ensureGlobalHandler(battle, "betting:554:blue-dr", EV.BEFORE_DAMAGE, (ctx: any) => {
        const dst: Entity | undefined = ctx?.input?.target, res = ctx?.result;
        if (!dst || !res || res.ignoresModifiers || !dst.hasStatus(BLUE_DR_ID)) return;
        if (ctx.input.source?.teamId === dst.teamId) return;
        res.final *= 1 - ENMU.blueCut;
      });
      out.push({ entityId: e.id, mechanic: "神力 · 守缘刃 bond (+30% bar both ways, bar immunity) · 与世结缘 heals, 尘缘·赤 extra turn / ·青 cleanse + 50% DR, L2-L5 riders" });
    }
    return out;
  },
};
