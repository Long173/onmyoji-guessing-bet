// compile/betting-oitsuki295.ts — 追月神 (SR 295, Global "Oitsuki") at max skill level. MAX (betting) mode only.
// (Not the SP 流光追月神 395 "Luminary Oitsuki": that kit is compile/betting-oitsuki.ts.)
//
// Sources: data/kb/shikigami.json 295_01..295_03, buff 2954_1 月之祝福, tips_7 先机 / tips_14 庇护 / tips_15 维持;
// data/kb/en-text.json (Global, same text); the match-5 replay (matches/2026-11-23e-lineup.en.json, Red Oitsuki).
//   明月潮生 (295_02, passive) · 先机 (tips_7: acts at battle start): the onibi gauge advances 1 extra cell, 4 at L4.
//                     The compiled IR kept orbGaugeAdvance 1 (level lines skipped) and passives do not run on the
//                     betting path, so nothing happened. Replay: Red's gauge showed 4/5 at f380 (before any Red
//                     turn) and filled after Red's first turn; the sim's first Red refill came at action 9.
//                   · L5: when 清辉月华 is cast with too few onibi, it still casts by spending all remaining onibi;
//                     the shortfall is paid with that many onibi-gauge cells; not possible when the gauge has fewer
//                     cells. (Read as needing ≥1 onibi, like 辉夜姬's illusion rule. Monster deductions: n/a in duels.)
//                     Passive: sealed by 压制.
//   清辉月华 (295_03) · 2 onibi. 月之祝福 (buff_2954_1, 维持1回合 = counted on her own turns: it lasts until the end of
//                     her next own turn; a recast refreshes it). While it lasts, every OTHER ally gains 20 SPD (L3)
//                     and 20% ATK (L4, of the soul-free base ATK like the other betting kits), and at the end of each
//                     other ally's turn the onibi gauge advances 1 extra cell (buff text; replay: Red's gauge moved
//                     at the end of each Red ally's turn). The compiled status had no effects and expired at the end
//                     of the casting turn (and sat on Oitsuki only), so none of this happened.
//                     Active-skill effect: not sealed by 压制; ends if she is defeated.
//                   · 庇护 (tips_14) at battle start / L5 on cast: unchanged (IR).
//   AI (unchanged): KB "我方存活数量≥2 → 3技能, ＜2 → 普攻".
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler,
  ensureGlobalHandler, levelNumber, hasLevelLine, kbBaseAtk, passiveSuppressed,
} from "./betting-shared.ts";

export const OITSUKI295 = Object.freeze({
  senkiCellsL1: 1,     // 295_02: 先机：使鬼火行动条额外推进1格 (L4: 4格, read from the level lines)
  blessSpd: 20,        // 295_03 L3: 提升速度效果增至20点 (base 10)
  blessAtk: 0.2,       // 295_03 L4: 提升攻击效果增至20% (L2 10%)
  blessCells: 1,       // buff_2954_1: 回合结束时额外推进1格鬼火行动条
  nominalCost: 2,
});

export const BLESS_ID = "2954_1";
const AURA_ID = "295_moon_aura";
const NOTE_BLESS = "oitsuki295:bless=";      // "new" (cast this turn) → "due" (ends at this own turn's end)
const NOTE_SENKI = "oitsuki295:senki=";

const blessDef = () => markDef({ id: BLESS_ID, name: "月之祝福", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】期间其他友方提升20点速度与20%攻击，并在其回合结束时额外推进1格鬼火行动条。（betting: 维持到追月神下个回合结束）" }, StatusBook);
const auraDef = () => markDef({ id: AURA_ID, name: "月之祝福·光环", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  dispellable: false, removable: false,
  desc: "追月神的月之祝福期间：提升20点速度与20%攻击（光环，随月之祝福结束）。" }, StatusBook);

export const isOitsuki295 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "295_02") && !!skillById(e, "295_03");
export const blessingActive = (o: Entity): boolean => o.alive && noteValue(o, NOTE_BLESS) !== null;

const passiveOf = (o: Entity) => skillById(o, "295_02")?.ir;
const typeOk = (ctx: any): boolean => ctx?.type === "NORMAL" || ctx?.type === "NEW_TURN";

/** 先机 cells at max level (4). */
export function senkiCells(o: Entity): number {
  const x = passiveOf(o);
  return levelNumber(x, /额外推进增至(\d+)格/, null, Number(x?.orbGaugeAdvance ?? OITSUKI295.senkiCellsL1));
}

function auraEffects(o: Entity, m: Entity): Array<{ prop: string; value: number; mode: "FIXED" }> {
  const x = skillById(o, "295_03")?.ir;
  const spd = hasLevelLine(x, /速度效果增至20点/) ? OITSUKI295.blessSpd : 10;
  const atk = hasLevelLine(x, /攻击效果增至20%/) ? OITSUKI295.blessAtk : hasLevelLine(x, /额外提升10%攻击/) ? 0.1 : 0;
  const out: Array<{ prop: string; value: number; mode: "FIXED" }> = [{ prop: "spd", value: spd, mode: "FIXED" }];
  if (atk > 0) out.push({ prop: "atk", value: atk * kbBaseAtk(m), mode: "FIXED" });
  return out;
}

function clearAura(o: Entity, battle: any): void {
  for (const m of battle.teams[o.teamId].members as Entity[]) {
    for (const st of [...m.statuses]) if (st.def.id === AURA_ID && st.sourceId === o.id) m.expireStatus(st);
  }
}

function startBlessing(battle: any, o: Entity): void {
  const def = blessDef();
  for (const st of [...o.statuses]) if (st.def.id === BLESS_ID && st.sourceId === o.id) o.expireStatus(st);
  const a = o.addStatus(def, o.id, 1, PERSIST, [], 1);
  setNote(o, NOTE_BLESS, "new");
  battle.trace.push({ t: "STATUS_APPLY", src: o.id, dst: o.id, status: BLESS_ID, name: def.name, category: def.category, duration: 1, ref: BLESS_ID, known: true, tag: a.tag, skill: "清辉月华" });
  clearAura(o, battle);
  const aura = auraDef();
  for (const m of battle.teams[o.teamId].aliveMembers() as Entity[]) {
    if (m.id === o.id) continue;
    m.addStatus(aura, o.id, 1, PERSIST, auraEffects(o, m), 1);
  }
}

function endBlessing(battle: any, o: Entity, reason: string): void {
  if (noteValue(o, NOTE_BLESS) === null) return;
  setNote(o, NOTE_BLESS, null);
  for (const st of [...o.statuses]) if (st.def.id === BLESS_ID && st.sourceId === o.id) o.expireStatus(st);
  clearAura(o, battle);
  battle.trace.push({ t: "STATUS_EXPIRE", id: o.id, status: BLESS_ID, reason });
}

/** After 清辉月华 (MAX): 月之祝福 (aura + gauge cell per other ally turn end). */
export function oitsuki295AfterCast(battle: any, self: Entity, x: any): boolean {
  if (!bettingActive() || x?.id !== "295_03" || !isOitsuki295(self)) return false;
  startBlessing(battle, self);
  return true;
}

/** IR patch (MAX): 月之祝福 is run by betting-oitsuki295.ts (the compiled status had no effect and a 0-turn life). */
export const OITSUKI295_PATCHES = Object.freeze({
  "295_03": { note: "清辉月华: 月之祝福 (other allies +20 SPD / +20% ATK, +1 gauge cell at their turn end, until her next turn end) is run by betting-oitsuki295.ts", patch: { statusRefConditionOnly: [0] } },
});

/** 明月潮生 L5 (MAX): 清辉月华 with too few onibi costs all remaining onibi when the gauge covers the shortfall. */
export function oitsuki295Cost(battle: any, self: Entity, sk: any, base: number): number {
  if (!bettingActive() || (sk?.ir?.id ?? sk?.id) !== "295_03" || !(base > 0) || !battle?.teams || !isOitsuki295(self)) return base;
  if (!hasLevelLine(passiveOf(self), /鬼火不足时，仍可消耗剩余全部鬼火施放/) || passiveSuppressed(self)) return base;
  const pool = battle.teams[self.teamId].orbs;
  const have = Number(pool.current ?? 0);
  if (have >= base || have < 1) return base;
  return Number(pool.gauge ?? 0) >= base - have ? have : base;
}

/** The shortfall of a partial 清辉月华 is paid with gauge cells (ORB_COST is queued after the payment). */
function onOrbCost(battle: any, o: Entity, ctx: any): void {
  if (Number(ctx?.actor ?? -1) !== o.id) return;
  const sk = (o.skills ?? []).find((s: any) => s.name === ctx.skill);
  if (sk?.ir?.id !== "295_03") return;
  const nominal = Number(sk.cost ?? OITSUKI295.nominalCost);
  const paid = Number(ctx.amount ?? 0);
  if (!(nominal > paid)) return;
  const pool = battle.teams[o.teamId].orbs;
  const cells = Math.min(nominal - paid, Number(pool.gauge ?? 0));
  pool.gauge -= cells;
  battle.trace.push({ t: "OITSUKI295_PARTIAL_CAST", actor: o.id, skill: sk.name, cost: nominal, paid, gaugeCells: cells, gauge: pool.gauge,
    clause: "施放清辉月华鬼火不足时，仍可消耗剩余全部鬼火施放；触发该效果时会消耗鬼火数差值格鬼火行动条" });
}

export function installOitsuki295(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const o of entities.filter(isOitsuki295)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, passive: boolean, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:295:" + code + (passive ? ":p:" : ":a:") + o.id, o.id, code, fn, range, { passive });
    // 明月潮生 先机 (passive): +4 gauge cells at battle start.
    reg(EV.BATTLE_START, () => {
      if (noteValue(o, NOTE_SENKI) === "1") return;
      setNote(o, NOTE_SENKI, 1);
      battle.advanceOrbGauge(o.teamId, senkiCells(o), "明月潮生·先机", o.id);
    }, true, "SELF");
    // 月之祝福 lifetime: marked "due" at her own turn start, ends at that turn's end unless recast during it.
    reg(EV.TURN_START, (ctx: any) => {
      if (ctx?.actor?.id === o.id && typeOk(ctx) && noteValue(o, NOTE_BLESS) === "new") setNote(o, NOTE_BLESS, "due");
    }, false, "SELF");
    reg(EV.TURN_END, (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || !typeOk(ctx) || a.teamId !== o.teamId || !blessingActive(o)) return;
      if (a.id === o.id) { if (noteValue(o, NOTE_BLESS) === "due") endBlessing(battle, o, "DURATION"); return; }
      if (isSummonUnit(a)) return;
      battle.advanceOrbGauge(o.teamId, OITSUKI295.blessCells, "月之祝福", o.id);
    }, false);
    reg(EV.ORB_COST, (ctx: any) => onOrbCost(battle, o, ctx), true);
    ensureGlobalHandler(battle, "betting:295:death:" + o.id, EV.DEATH, (ctx: any) => {
      if (ctx?.target?.id === o.id) endBlessing(battle, o, "OWNER_DEFEATED");
    });
    out.push({ entityId: o.id, mechanic: "明月潮生 (先机 +4 gauge cells, L5 partial 清辉月华) · 月之祝福 (other allies +20 SPD / +20% ATK, +1 cell per ally turn end)" });
  }
  return out;
}

/** Test helper: the Oitsuki of `teamId` whose 月之祝福 is up, if any. */
export function blessingOwner(battle: any, teamId: number): Entity | null {
  return (battle.teams[teamId]?.members ?? []).find((m: Entity) => isOitsuki295(m) && blessingActive(m)) ?? null;
}
