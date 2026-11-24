// compile/betting-enmusubi347.ts — 缘结神 (SSR 347, Global "Enmusubi") at max skill level. MAX mode only (match 10).
// The base SSR, not 纺愿缘结神 554 (betting-enmusubi.ts).
//
// Sources: data/kb/shikigami.json 347_01..347_03, buffs 3470_1 缘 / 34726_1 再续前缘 / 3475_1 再续前缘, tips_14 庇护 /
// tips_7 先机 / tips_11; data/kb/ai.json; data/kb/en-text.json (Global). Before this module 神赐良缘 only healed 9% (no
// damage buff, no 庇护, no 缘 scaling) and the passive 绯色花月 never ran (generic passives are off).
//   绯色花月 (347_02, passive) · 唯一. Before another ally's turn: one of 4 random bonds; equal to the bond of the other
//        ally who acted before ⇒ +1 onibi and +1 缘 (cap 7); different ⇒ she gets 再续前缘 (one mark).
//   缘 (3470_1)        · per stack, 神赐良缘 gives +5% damage and +1% max-HP heal more.
//   再续前缘 (34726_1)  · after her turn ends: 1 new turn in which her skills cost 3 onibi less; consumed.
//   神赐良缘 (347_03, 2) · 庇护 on the target (KB AI: highest crit damage ally); every non-summon ally: damage +40%
//        (+5%/缘) sustained 1 turn and a heal of 9% (+1%/缘) of its own max HP (heals can crit: her crit stats).
//        L2 (≥1 缘): 50% of the overheal becomes a shield for 1 turn. L3 (≥3 缘): SPD +30 for 1 turn. L4 (7 缘): the
//        target (if not herself) gets 再续前缘 and she gets 庇护. L5 先机: 庇护 on herself.
//   AI (KB)            · always 神赐良缘 (normal attack when the onibi are short).
// Readings (unverified): "sustained 1 turn" = until the end of her next turn (SOURCE_TURN, 2 ticks, as in
// betting-enmusubi.ts); 再续前缘 does not stack; the first ally of the battle has no previous bond (no roll).
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { grantExtraTurn } from "../kernel/extra-turn.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler,
  stacksOn, setStackedStatus, gainOrbs, grantTimedShield, ensureShieldTicker, PERSIST,
} from "./betting-shared.ts";
import { inOwnTurn } from "./betting-scope.ts";

export const ENMU347 = Object.freeze({
  bonds: 4, bondCap: 7, dmg: 0.4, dmgPerBond: 0.05, heal: 0.09, healPerBond: 0.01, overShield: 0.5, spd: 30,
  sustain: 2, renewCostCut: 3,
});
export const BOND_ID = "3470_1";
export const RENEW_ID = "34726_1";
const SHELTER_ID = "347_shelter", DMG_ID = "347_dmg", SPD_ID = "347_spd";
const N_LAST = "enmu347:lastBond=", N_RENEW_PENDING = "enmu347:renewPending", N_RENEW_ACTIVE = "enmu347:renewActive";

const bondDef = () => markDef({ id: BOND_ID, name: "缘", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】上限7层，每层缘使施放神赐良缘时，额外提升友方全体5%的伤害和治疗生命上限1%的生命值。" }, StatusBook);
export const renewDef = () => markDef({ id: RENEW_ID, name: "再续前缘", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】回合结束后，获得1个新的回合，且施放技能消耗鬼火减少3点。" }, StatusBook);
const shelterDef = () => markDef({ id: SHELTER_ID, name: "庇护", category: StatusCategory.BUFF_MARK, durationPolicy: "SOURCE_TURN",
  immuneTo: ["CONTROL", "BANISH"], consumeOnImmune: true, desc: "可抵挡单次技能当中的所有控制效果和放逐（神赐良缘）。" }, StatusBook);
const dmgDef = () => markDef({ id: DMG_ID, name: "神赐良缘·鼓舞", category: StatusCategory.BUFF_STATE, durationPolicy: "SOURCE_TURN", dispellable: true, removable: true,
  desc: "神赐良缘：伤害提升40%（每层缘额外5%），维持1回合。" }, StatusBook);
const spdDef = () => markDef({ id: SPD_ID, name: "神赐良缘·速度", category: StatusCategory.BUFF_STATE, durationPolicy: "SOURCE_TURN", dispellable: true, removable: true,
  desc: "神赐良缘 L3：速度提升30，维持1回合。" }, StatusBook);

export const isEnmu347 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "347_02") && !!skillById(e, "347_03");
export const bondsOf = (e: Entity): number => stacksOn(e, BOND_ID);
const allies = (battle: any, e: Entity): Entity[] => (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m));
const enmuOfTeam = (battle: any, teamId: number): Entity | null =>
  (battle.teams[teamId]?.members ?? []).find((m: Entity) => isEnmu347(m) && m.alive) ?? null;
const castTarget = new WeakMap<object, Entity>();
const battles = new WeakMap<object, any>();
const opened = new WeakSet<object>();

function addMark(battle: any, src: Entity, dst: Entity, def: any, duration: number, skill: string, effects: any[] = []): void {
  for (const st of [...dst.statuses]) if (st.def.id === def.id) dst.expireStatus(st);
  const a = dst.addStatus(def, src.id, 1, duration, effects, 1);
  battle.trace.push({ t: "STATUS_APPLY", src: src.id, dst: dst.id, status: def.id, name: def.name, category: def.category, duration, ref: def.id, known: true, tag: (a as any)?.tag ?? null, skill });
}

/** 绯色花月 before another ally's turn. */
function scarletMoon(battle: any, e: Entity, a: Entity): void {
  battle.rng.expect("enmu347_bond");
  const bond = battle.rng.int(0, ENMU347.bonds - 1);
  const last = noteValue(e, N_LAST);
  setNote(e, N_LAST, bond);
  battle.trace.push({ t: "SUBSKILL", actor: e.id, skill: "绯色花月", form: "缘结#" + (bond + 1), target: a.id, previous: last });
  if (last === null) return;
  if (Number(last) === bond) {
    gainOrbs(battle, e, e.teamId, 1, "绯色花月");
    const after = setStackedStatus(e, bondDef(), bondsOf(e) + 1, ENMU347.bondCap, e.id, []);
    battle.trace.push({ t: "STATUS_APPLY", src: e.id, dst: e.id, status: BOND_ID, name: "缘", category: StatusCategory.COMMON_MARK, duration: PERSIST, ref: BOND_ID, known: true, stacks: after, threshold: ENMU347.bondCap, skill: "绯色花月" });
  } else if (!e.statuses.some(s => s.def.id === RENEW_ID)) {
    addMark(battle, e, e, renewDef(), PERSIST, "绯色花月");
  }
}

async function divineMatch(battle: any, e: Entity, target: Entity | null): Promise<void> {
  const n = bondsOf(e);
  if (target?.alive) addMark(battle, e, target, shelterDef(), ENMU347.sustain, "神赐良缘");
  const team = allies(battle, e);
  for (const a of team) {
    addMark(battle, e, a, dmgDef(), ENMU347.sustain, "神赐良缘", [{ prop: "dmgDealtB", value: ENMU347.dmg + ENMU347.dmgPerBond * n, mode: "FIXED" }]);
    if (n >= 3) addMark(battle, e, a, spdDef(), ENMU347.sustain, "神赐良缘", [{ prop: "spd", value: ENMU347.spd, mode: "FIXED" }]);
  }
  for (const a of team) {
    if (!a.alive) continue;
    const want = a.maxHp * (ENMU347.heal + ENMU347.healPerBond * n);
    let asked = want;
    const healed = Number(await battle.heal(e, a, want, { crit: true, onRequested: (req: number) => { asked = req; } })) || 0;
    const over = Math.max(0, asked - healed);
    if (n >= 1 && over > 0 && a.alive) grantTimedShield(battle, e, a, over * ENMU347.overShield, 1, { tag: "enmu347", skill: "神赐良缘", reason: "OVERHEAL", base: "overheal", ratio: ENMU347.overShield });
  }
  if (n >= ENMU347.bondCap) {
    if (target?.alive && target.id !== e.id && !target.statuses.some(s => s.def.id === "3475_1")) {
      addMark(battle, e, target, markDef({ id: "3475_1", name: "再续前缘", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL", desc: "【通用、印记】回合结束后，获得1个新的回合，且施放技能消耗鬼火减少3点。" }, StatusBook), PERSIST, "神赐良缘");
    }
    addMark(battle, e, e, shelterDef(), ENMU347.sustain, "神赐良缘");
  }
}

function onTurnStart(battle: any, e: Entity, ctx: any): void {
  const a: Entity | undefined = ctx?.actor;
  if (!a) return;
  if (a.id === e.id && ctx.type === "NEW_TURN" && noteValue(e, N_RENEW_PENDING) !== null) { setNote(e, N_RENEW_PENDING, null); setNote(e, N_RENEW_ACTIVE, 1); }
  if (a.teamId !== e.teamId || a.id === e.id || isSummonUnit(a) || !e.alive || ctx.type !== "NORMAL") return;
  if (enmuOfTeam(battle, e.teamId) !== e) return;   // 唯一效果
  scarletMoon(battle, e, a);
}

/** 再续前缘 (on her or, L4, on an ally): after the bearer's turn ends ⇒ a new turn with −3 onibi costs. */
function onTurnEnd(battle: any, ctx: any): void {
  const a: Entity | undefined = ctx?.actor;
  if (!a) return;
  if (noteValue(a, N_RENEW_ACTIVE) !== null) { setNote(a, N_RENEW_ACTIVE, null); return; }
  const st = a.statuses.find(s => s.def.id === RENEW_ID || s.def.id === "3475_1");
  if (!st || !a.alive) return;
  a.expireStatus(st);
  battle.trace.push({ t: "MARK_TRIGGER", id: a.id, status: st.def.id, name: "再续前缘", skill: "绯色花月" });
  setNote(a, N_RENEW_PENDING, 1);
  grantExtraTurn(battle, a, "再续前缘");
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "347_02": { note: "绯色花月: bonds, onibi, 缘 and 再续前缘 are run by betting-enmusubi347.ts", patch: { statusRefConditionOnly: [0, 1], orb: { gain: 0, cost: -1 } } },
    "347_03": { note: "神赐良缘: 庇护, damage buff, heal and the 缘 riders are run by betting-enmusubi347.ts", patch: { heal: [] } },
  }),
  cost: (battle, self, _sk, base) => {
    if (!bettingActive() || !(base > 0) || noteValue(self, N_RENEW_ACTIVE) === null || !inOwnTurn(battle, self)) return base;
    return Math.max(0, base - ENMU347.renewCostCut);
  },
  ruleSkill: (battle, self, costOf) => {
    if (!bettingActive() || !isEnmu347(self)) return null;
    const match = skillById(self, "347_03"), basic = skillById(self, "347_01");
    if (match && (!(costOf(match) > 0) || battle.teams[self.teamId].orbs.canPay(costOf(match)))) return { skill: match, rule: "缘结神: 神赐良缘 (KB AI)" };
    return basic ? { skill: basic, rule: "缘结神: 鬼火不足 → 月下花" } : null;
  },
  target: (self, x, _cands) => {
    if (!bettingActive() || !isEnmu347(self) || x?.id !== "347_03") return null;
    const battle = battles.get(self);
    if (!battle) return null;
    const pool = allies(battle, self);
    const t = pool.reduce<Entity | null>((a, b) => (!a || b.prop("crid") > a.prop("crid") ? b : a), null);
    if (!t) return null;
    castTarget.set(self, t);
    return { target: t, rule: "缘结神: 神赐良缘优先选择暴击伤害最高的友方单位 (KB AI)" };
  },
  afterCast: async (battle, self, x) => {
    if (!bettingActive() || !isEnmu347(self) || x?.id !== "347_03") return false;
    const picked = castTarget.get(self) ?? null;
    castTarget.delete(self);
    await divineMatch(battle, self, picked?.alive ? picked : self);
    return true;
  },
  install: (battle, entities) => {
    const out: Installed = [];
    if (!bettingActive()) return out;
    const units = entities.filter(isEnmu347);
    if (!units.length) return out;
    ensureShieldTicker(battle);
    for (const e of units) {
      battles.set(e, battle);
      registerOwnerHandler(battle, "betting:347:moon:" + e.id, e.id, EV.TURN_START, (ctx: any) => onTurnStart(battle, e, ctx), "ALL");
      out.push({ entityId: e.id, mechanic: "绯色花月 (random bonds: +1 onibi / 缘, or 再续前缘 extra turn at −3 cost) · 神赐良缘 (庇护, +40% damage, 9% heal, 缘 riders) · 先机 庇护 · KB AI" });
    }
    ensureGlobalHandler(battle, "betting:347:renew", EV.TURN_END, (ctx: any) => onTurnEnd(battle, ctx));
    ensureGlobalHandler(battle, "betting:347:start", EV.BATTLE_START, () => {
      if (opened.has(battle)) return;
      opened.add(battle);
      for (const e of units) if (e.alive) addMark(battle, e, e, shelterDef(), ENMU347.sustain, "神赐良缘");
    });
    return out;
  },
};
