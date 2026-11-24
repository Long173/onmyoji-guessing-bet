// compile/betting-tenjo.ts — 天井下 (R 323, Global "Tenjo Kudari") at max skill level. MAX mode only (match 9).
//
// Sources: data/kb/shikigami.json 323_01..323_03, buff 3233_1 欢愉标记, tips_11 (唯一效果) / tips_27 (可行动状态),
// data/kb/ai.json (KB AI rows); data/kb/en-text.json (Global); fandom "Tenjo Kudari/Main".
// Before this module she only ever threw stones: the KB AI condition ("友方单位存活数量≥2时") does not compile, and the
// passive / aura parts of 323_02 / 323_03 are not run on the betting path (generic passives are off).
//   遮雨 (323_02, passive, exclusive) · non-summon allies +25% effect RES (L4), herself double (+50%). L5: at the start of
//       a non-summon ally's turn (herself included) that ally is healed 5% of ITS max HP — Global en-text "their max
//       HP" (the fandom box says "her max HP"; the KB "其生命上限" reads as the ally's). Sealed by 压制 (passive).
//   再会之音 (323_03, 0 onibi, exclusive) · the yokai house is awake during her own turn (turn start → turn end) and
//       while she holds 欢愉标记 and is actionable (tips_27: no control effect); while awake every non-summon ally deals
//       +20% damage (L4; additive dmgDealtB, status 妖怪屋·清醒). [Cast] 3 欢愉标记 (L5) for 1 turn. When ANOTHER ally's
//       turn ends: 1 mark is consumed, her team gains 1 onibi, and that ally's action bar +25% (L3).
//   AI (KB) · at least 2 allies alive → 再会之音, otherwise 扔石头.
// Readings (unverified): "持续1回合" of the marks = until the end of her NEXT own turn (a cast refreshes them to 3); the
// awake aura is not sealed by 压制 (it belongs to her special, not to the passive); the auras end when she dies.
// Not modelled: the fandom evolution line "+75% RES to Tenjo while the house is awake" (absent from the KB and the Global
// en-text); tips_11 duplicate-unit exclusivity (one Tenjo per team in every betting lineup).
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler,
  stacksOn, setStackedStatus, controlsOn, passiveSuppressed, gainOrbs, shiftBar,
} from "./betting-shared.ts";

export const TENJO = Object.freeze({ res: 0.25, resSelf: 0.5, heal: 0.05, awakeDmg: 0.2, marks: 3, bar: 0.25 });
export const SHELTER_ID = "3232_shelter";
export const AWAKE_ID = "3233_awake";
export const JOY_ID = "3233_1";
const N_TURN = "tenjo323:turn=", N_CAST = "tenjo323:cast=";

const shelterDef = () => markDef({ id: SHELTER_ID, name: "遮雨", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "遮雨：非召唤物的友方提升25%效果抵抗，天井下自身提升50%。" }, StatusBook);
const awakeDef = () => markDef({ id: AWAKE_ID, name: "妖怪屋·清醒", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "妖怪屋·清醒：非召唤物的友方造成的伤害提升20%。" }, StatusBook);
const joyDef = () => markDef({ id: JOY_ID, name: "欢愉标记", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】其他友方回合结束时，消耗1层并获得1点鬼火，并使其增加25%行动条。" }, StatusBook);

export const isTenjo323 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "323_02") && !!skillById(e, "323_03");
export const joyMarks = (t: Entity): number => stacksOn(t, JOY_ID, t.id);
const ownTurns = (t: Entity): number => Number(noteValue(t, N_TURN) ?? 0);
const allies = (battle: any, t: Entity): Entity[] => (battle.teams[t.teamId].members as Entity[]).filter(a => a.alive && !isSummonUnit(a));

/** Tenjo units currently inside their own turn (transient: turn start → turn end). */
const inTurn = new WeakMap<object, Set<number>>();
const turnSet = (battle: any): Set<number> => inTurn.get(battle) ?? inTurn.set(battle, new Set()).get(battle)!;

export function houseAwake(battle: any, t: Entity): boolean {
  if (!t.alive) return false;
  if (turnSet(battle).has(t.id)) return true;
  return joyMarks(t) > 0 && controlsOn(t).length === 0;
}

function setAura(e: Entity, def: any, src: Entity, on: boolean, effects: Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE" }>): void {
  const st = e.statuses.find(s => s.def.id === def.id && s.sourceId === src.id);
  if (!on) { if (st) e.expireStatus(st); return; }
  const same = st && st.effects.length === effects.length && st.effects.every((x: any, i: number) => x.prop === effects[i].prop && x.value === effects[i].value);
  if (same) return;
  if (st) e.expireStatus(st);
  e.addStatus(def, src.id, 1, PERSIST, effects, 1);
}

/** Recomputes 遮雨 (effect RES) and 妖怪屋·清醒 (damage) on every unit of Tenjo's team. */
export function refreshTenjo(battle: any, t: Entity): void {
  const team = battle.teams[t.teamId].members as Entity[];
  const shelterOn = t.alive && !passiveSuppressed(t);
  const awake = houseAwake(battle, t);
  for (const a of team) {
    const eligible = a.alive && !isSummonUnit(a);
    setAura(a, shelterDef(), t, eligible && shelterOn, [{ prop: "efr", value: a.id === t.id ? TENJO.resSelf : TENJO.res, mode: "FIXED" }]);
    setAura(a, awakeDef(), t, eligible && awake, [{ prop: "dmgDealtB", value: TENJO.awakeDmg, mode: "FIXED" }]);
  }
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isTenjo323(self)) return null;
  const song = skillById(self, "323_03"), basic = skillById(self, "323_01");
  const c = song ? costOf(song) : 0;
  if (song && allies(battle, self).length >= 2 && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c)))
    return { skill: song, rule: "天井下: 友方存活≥2 → 再会之音 (KB AI)" };
  return basic ? { skill: basic, rule: "天井下: 否则 → 扔石头 (KB AI)" } : null;
}

function afterCast(battle: any, self: Entity, x: any): boolean {
  if (!bettingActive() || !isTenjo323(self) || x?.id !== "323_03") return false;
  setStackedStatus(self, joyDef(), TENJO.marks, TENJO.marks, self.id, []);
  setNote(self, N_CAST, ownTurns(self));
  battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: self.id, status: JOY_ID, name: "欢愉标记", category: StatusCategory.BUFF_MARK, duration: 1, stacks: TENJO.marks, cap: TENJO.marks, ref: JOY_ID, known: true, skill: x.name });
  refreshTenjo(battle, self);
  return true;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isTenjo323);
  for (const t of units) {
    const refresh = () => refreshTenjo(battle, t);
    // House state / auras: recomputed at every boundary (global, so they also clear when she dies or is sealed).
    for (const code of [EV.BATTLE_START, EV.ACTION_END, EV.SKILL_END, EV.DEATH, EV.STATUS_REMOVE, EV.STATUS_EXPIRE]) {
      ensureGlobalHandler(battle, "betting:323:refresh:" + code + ":" + t.id, code, refresh);
    }
    ensureGlobalHandler(battle, "betting:323:turn-start:" + t.id, EV.TURN_START, (ctx: any) => {
      if (ctx?.actor?.id === t.id && t.alive) turnSet(battle).add(t.id);
      refresh();
    });
    ensureGlobalHandler(battle, "betting:323:turn-end:" + t.id, EV.TURN_END, (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a) return;
      if (a.id === t.id) {
        turnSet(battle).delete(t.id);
        const cast = noteValue(t, N_CAST);
        if (joyMarks(t) > 0 && (cast === null || Number(cast) < ownTurns(t))) {
          setStackedStatus(t, joyDef(), 0, TENJO.marks, t.id, []);
          battle.trace.push({ t: "STATUS_EXPIRE", id: t.id, status: JOY_ID, name: "欢愉标记", reason: "DURATION" });
        }
        setNote(t, N_TURN, ownTurns(t) + 1);
      } else if (a.teamId === t.teamId && t.alive && joyMarks(t) > 0) {
        const left = joyMarks(t) - 1;
        setStackedStatus(t, joyDef(), left, TENJO.marks, t.id, []);
        battle.trace.push({ t: "STATUS_EXPIRE", id: t.id, status: JOY_ID, name: "欢愉标记", reason: "MARK_CONSUMED", left });
        gainOrbs(battle, t, t.teamId, 1, "欢愉标记");
        if (a.alive) shiftBar(battle, a, TENJO.bar, "欢愉标记");
      }
      refresh();
    });
    // 遮雨 L5: heal at the start of each non-summon ally's turn (passive: sealed by 压制).
    registerOwnerHandler(battle, "betting:323:heal:" + t.id, t.id, EV.TURN_START, async (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || a.teamId !== t.teamId || isSummonUnit(a) || !a.alive || !t.alive) return;
      await battle.heal(t, a, a.maxHp * TENJO.heal, { crit: false });
    }, "ALL");
    out.push({ entityId: t.id, mechanic: "遮雨 (+25% / +50% effect RES, 5% heal at ally turn start) · 再会之音 (awake house +20% damage, 3 欢愉标记: onibi + 25% bar) · KB AI" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "323_03": { note: "再会之音: the 欢愉标记 (3 at L5), their consumption and the awake-house aura are run by betting-tenjo.ts", patch: { statusRefConditionOnly: [0, 1] } },
  }),
  ruleSkill,
  afterCast,
  install,
};
