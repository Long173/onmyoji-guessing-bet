// compile/betting-chocho.ts — 蝴蝶精 (R 241, Global "Chocho") and 蜜桃&芥子 (SR 310, Global "Peach Maki & Karashi")
// passives at max skill level. MAX mode only (the generic passives are off on the betting path).
//
// Sources: data/kb/shikigami.json 241_02 / 241_03 / 310_02, buff 2414_1 蝶舞; fandom "Kochou no Sei/Main".
//   轻盈 (241_02) · +30 SPD (L4) per 20% (L5) of HP ratio lost by the living non-summon ally with the lowest HP
//       ratio (stacks, max 4); with 4 stacks 祈愿之舞 costs 2 less. Recomputed whenever HP can change.
//   蝶舞 (2414_1) · +20 SPD (compiled status) and, after taking damage, a heal of 12% (L5) of Chocho's max HP, at
//       most once per turn per bearer. The compiled status had the SPD only.
//   兔狱卒·坚毅 (310_02) · when taking damage: 30% chance to halve it.
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, stacksOn, setStackedStatus } from "./betting-shared.ts";

export const CHOCHO = Object.freeze({ step: 0.2, spd: 30, cap: 4, cut: 2, danceHeal: 0.12, makiChance: 0.3, makiCut: 0.5 });
export const NIMBLE_ID = "241_nimble";
export const DANCE_ID = "2414_1";
const nimbleDef = () => markDef({ id: NIMBLE_ID, name: "轻盈", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "轻盈：生命比例最低的友方每降低20%生命比例，蝴蝶精提升30点速度（至多4层）；4层时祈愿之舞消耗鬼火减少2点。" }, StatusBook);

export const isChocho241 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "241_02") && !!skillById(e, "241_03");
export const isMaki310 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "310_02");
export const nimbleStacks = (e: Entity): number => stacksOn(e, NIMBLE_ID);

function refreshNimble(battle: any, c: Entity): void {
  if (!c.alive) return;
  const allies = (battle.teams[c.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m) && m.maxHp > 0);
  const low = allies.reduce((a, m) => Math.min(a, m.hp / m.maxHp), 1);
  const n = Math.min(CHOCHO.cap, GameMath.floorAt((1 - low) / CHOCHO.step + 1e-9, "CHOCHO_NIMBLE"));
  const before = nimbleStacks(c);
  if (n === before) return;
  setStackedStatus(c, nimbleDef(), n, CHOCHO.cap, c.id, [{ prop: "spd", value: CHOCHO.spd, mode: "FIXED" }]);
  battle.trace.push({ t: "STACKS_SET", id: c.id, status: NIMBLE_ID, name: "轻盈", from: before, to: n, skill: "轻盈" });
}

/** 祈愿之舞 costs 2 less with 4 stacks of 轻盈. */
export function chochoCost(self: Entity, sk: any, base: number): number {
  if (!bettingActive() || (sk?.ir?.id ?? sk?.id) !== "241_03" || !(base > 0) || nimbleStacks(self) < CHOCHO.cap) return base;
  return Math.max(0, base - CHOCHO.cut);
}

export function installChocho(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const c of entities.filter(isChocho241)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void) =>
      registerOwnerHandler(battle, "betting:241:" + code + ":" + c.id, c.id, code, fn, "ALL");
    for (const code of [EV.BATTLE_START, EV.TURN_START, EV.TURN_END, EV.HEAL, EV.DEATH]) reg(code, () => refreshNimble(battle, c));
    reg(EV.AFTER_DAMAGE, async (ctx: any) => {
      refreshNimble(battle, c);
      const v: Entity | undefined = ctx?.input?.target;
      if (!v?.alive || v.teamId !== c.teamId || !(ctx?.result?.applied > 0 || ctx?.result?.absorbed > 0)) return;
      if (!v.statuses.some(s => s.def.id === DANCE_ID && s.sourceId === c.id)) return;
      const key = String(battle.turn ?? 0);
      if (noteValue(v, "chocho241:dance=") === key) return;
      setNote(v, "chocho241:dance=", key);
      await battle.heal(c, v, c.maxHp * CHOCHO.danceHeal, { crit: false });
    });
    out.push({ entityId: c.id, mechanic: "轻盈 (SPD stacks, 4-stack cost -2) · 蝶舞 heal after damage" });
  }
  for (const m of entities.filter(isMaki310)) {
    registerOwnerHandler(battle, "betting:310:guard:" + m.id, m.id, EV.BEFORE_DAMAGE, (ctx: any) => {
      const res = ctx?.result;
      if (ctx?.input?.target?.id !== m.id || !res || res.ignoresModifiers || !(res.final > 0)) return;
      battle.rng.expect("maki310_resolve");
      if (!battle.rng.testHit(CHOCHO.makiChance)) return;
      res.final *= 1 - CHOCHO.makiCut;
      battle.trace.push({ t: "DAMAGE_REDUCED", id: m.id, by: "兔狱卒·坚毅", ratio: CHOCHO.makiCut });
    }, "ALL");
    out.push({ entityId: m.id, mechanic: "兔狱卒·坚毅 (30%: damage halved)" });
  }
  return out;
}
