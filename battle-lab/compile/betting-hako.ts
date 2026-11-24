// compile/betting-hako.ts — 匣中少女 (SR 287, Global "Hako Shoujo") at max skill level. MAX mode only (match 9).
//
// Sources: data/kb/shikigami.json 287_01..287_03, tips_6 护盾 / tips_15 维持 / tips_20 恢复 / tips_200 随机增益 /
// tips_201 随机减益 / tips_2 基础概率, data/kb/ai.json (KB AI rows); data/kb/en-text.json (Global); fandom
// "Hako no Shoujo/Main" (回梦 cooldown 3, L5 −1 = 2: the cooldown is only in the fandom box and the KB L5 line).
// Before this module she only ever basic-attacked: the KB AI condition ("友方单位均无回梦时") does not compile, 回梦 had no
// executable effect, and the passive 溢彩 is not run on the betting path (generic passives are off).
//   溢彩 (287_02, passive, exclusive) · before an ally acts (its turn start, herself included): a shield of 8% of
//       Hako's max HP for 2 turns (the previous 溢彩 shield on that ally is replaced) and 1 random buff for 2 turns
//       (ATK +10% / DEF +20% / crit damage +10% / SPD +10 / effect RES +10%; re-rolling the same kind refreshes it).
//       Evolved: when an enemy attacks her (direct damage; once per enemy action), 100% base chance (effect hit vs
//       effect RES contest) to give the attacker 1 random debuff for 1 turn (the mirror values). Sealed by 压制.
//   回梦 (287_03, 3 onibi, cooldown 2 of her turns) · records every living ally's current HP for 2 of HER turns (维持);
//       when it takes effect, an ally below 60% (L4) of its record recovers (恢复: no heal effects, no crit, not
//       reduced by heal-down) up to 60% of the record. A recorded ally taking damage that would kill it (damage ≥ HP +
//       shields) is immune to that hit and its record takes effect immediately.
//   AI (KB) · no ally holds 回梦 (and the cooldown is over, 3 onibi free) → 回梦, otherwise 流光.
// Readings (unverified): the 1-turn debuff counts the attacker's current turn (engine TARGET_TURN rule, so on a normal
// attack it lasts to the end of that action); records vanish without effect if Hako dies (no source turns left);
// HP loss that is not damage does not trigger the lethal clause.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler,
  grantTimedShield, ensureShieldTicker, applyContested,
} from "./betting-shared.ts";

export const HAKO = Object.freeze({ shield: 0.08, shieldTurns: 2, buffTurns: 2, debuffTurns: 1, debuffChance: 1, ratio: 0.6, recordTurns: 2, cooldown: 2 });
export const DREAM_ID = "287_dream";
const SHIELD_TAG = "hako287";
const N_TURN = "hako287:turn=", N_CAST = "hako287:cast=", N_REC = "hako287:rec=";

type Eff = { prop: string; value: number; mode: "FIXED" | "ADD_RATE" };
interface Kind { key: string; up: string; down: string; eff: Eff }
const KINDS: readonly Kind[] = Object.freeze([
  { key: "atk", up: "溢彩·攻击提升", down: "溢彩·攻击降低", eff: { prop: "atk", value: 0.1, mode: "ADD_RATE" } },
  { key: "def", up: "溢彩·防御提升", down: "溢彩·防御降低", eff: { prop: "def", value: 0.2, mode: "ADD_RATE" } },
  { key: "crid", up: "溢彩·暴伤提升", down: "溢彩·暴伤降低", eff: { prop: "crid", value: 0.1, mode: "FIXED" } },
  { key: "spd", up: "溢彩·速度提升", down: "溢彩·速度降低", eff: { prop: "spd", value: 10, mode: "FIXED" } },
  { key: "efr", up: "溢彩·抵抗提升", down: "溢彩·抵抗降低", eff: { prop: "efr", value: 0.1, mode: "FIXED" } },
]);
export const HAKO_BUFF_IDS = KINDS.map(k => "2872_up_" + k.key);
export const HAKO_DEBUFF_IDS = KINDS.map(k => "2872_down_" + k.key);
const buffDef = (k: Kind) => markDef({ id: "2872_up_" + k.key, name: k.up, category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【增益、状态】随机增益（溢彩）：" + k.up }, StatusBook);
const debuffDef = (k: Kind) => markDef({ id: "2872_down_" + k.key, name: k.down, category: StatusCategory.DEBUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【减益、状态】随机减益（溢彩）：" + k.down }, StatusBook);
const dreamDef = () => markDef({ id: DREAM_ID, name: "回梦", category: StatusCategory.BUFF_MARK, durationPolicy: "SOURCE_TURN",
  desc: "回梦：记录当前生命，维持2回合后生效；生效时若当前生命低于记录值的60%，则恢复至60%。受到致命伤害时免疫该次伤害并立即生效。" }, StatusBook);

export const isHako287 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "287_02") && !!skillById(e, "287_03");
const ownTurns = (e: Entity): number => Number(noteValue(e, N_TURN) ?? 0);
const shieldTotal = (e: Entity): number => ((e.shields ?? []) as any[]).reduce((a, s) => a + (s.broken ? 0 : Math.max(0, Number(s.value) || 0)), 0);
const recordOf = (battle: any, e: Entity): { st: any; hp: number } | null => {
  const st = e.statuses.find(s => s.def.id === DREAM_ID);
  const v = noteValue(e, N_REC);
  return st && v !== null ? { st, hp: Number(v) } : null;
};

export function hakoGate(self: Entity, sk: any): string | null {
  if ((sk?.ir ?? sk)?.id !== "287_03") return null;
  const last = noteValue(self, N_CAST);
  return last !== null && ownTurns(self) - Number(last) <= HAKO.cooldown ? "COOLDOWN" : null;
}

/** The record takes effect on `e` (duration over, or a lethal hit): recover up to 60% of the recorded HP. */
async function takeEffect(battle: any, e: Entity, reason: string): Promise<void> {
  const rec = noteValue(e, N_REC);
  setNote(e, N_REC, null);
  const st = e.statuses.find(s => s.def.id === DREAM_ID);
  if (st) e.expireStatus(st);
  if (rec === null || !e.alive) return;
  const src = battle.allEntities().find((x: Entity) => x.id === (st?.sourceId ?? -1)) ?? e;
  const floor = Number(rec) * HAKO.ratio;
  if (reason !== "DURATION") battle.trace.push({ t: "STATUS_EXPIRE", id: e.id, status: DREAM_ID, name: "回梦", reason, recorded: GameMath.display(Number(rec)), floor: GameMath.display(floor) });
  if (e.hp < floor) await battle.heal(src, e, floor - e.hp, { recover: true });
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isHako287(self)) return null;
  const dream = skillById(self, "287_03"), basic = skillById(self, "287_01");
  const team = (battle.teams[self.teamId].members as Entity[]).filter(a => a.alive);
  const anyRecord = team.some(a => a.hasStatus(DREAM_ID));
  const c = dream ? costOf(dream) : 0;
  if (dream && !anyRecord && !hakoGate(self, dream) && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c)))
    return { skill: dream, rule: "匣中少女: 友方均无回梦 → 回梦 (KB AI)" };
  return basic ? { skill: basic, rule: anyRecord ? "匣中少女: 友方已有回梦 → 流光 (KB AI)" : "匣中少女: 回梦冷却或鬼火不足 → 流光" } : null;
}

function gate(_battle: any, self: Entity, sk: any): string | null {
  if (!bettingActive() || !isHako287(self)) return null;
  return hakoGate(self, sk);
}

function afterCast(battle: any, self: Entity, x: any): boolean {
  if (!bettingActive() || !isHako287(self) || x?.id !== "287_03") return false;
  setNote(self, N_CAST, ownTurns(self));
  const def = dreamDef();
  for (const a of (battle.teams[self.teamId].members as Entity[]).filter(m => m.alive)) {
    for (const old of [...a.statuses]) if (old.def.id === DREAM_ID) a.expireStatus(old);
    a.addStatus(def, self.id, 1, HAKO.recordTurns, [], 1);
    setNote(a, N_REC, a.hp);
    battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: a.id, status: DREAM_ID, name: def.name, category: def.category, duration: HAKO.recordTurns, ref: DREAM_ID, known: true, skill: x.name });
  }
  return true;
}

async function overflow(battle: any, h: Entity, a: Entity): Promise<void> {
  if (!a.alive || !h.alive) return;
  for (const sh of (a.shields ?? []) as any[]) {
    if (!sh.broken && sh.sourceId === h.id && String(sh.id ?? "").includes(SHIELD_TAG)) sh.broken = true;
  }
  grantTimedShield(battle, h, a, h.maxHp * HAKO.shield, HAKO.shieldTurns, { tag: SHIELD_TAG, skill: "溢彩", reason: "ALLY_TURN_START", base: "maxHp", ratio: HAKO.shield });
  battle.rng.expect("hako287_buff");
  const k = KINDS[battle.rng.int(0, KINDS.length - 1)];
  const def = buffDef(k);
  for (const old of [...a.statuses]) if (old.def.id === def.id) a.expireStatus(old);
  const s = a.addStatus(def, h.id, 1, HAKO.buffTurns, [k.eff], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: h.id, dst: a.id, status: def.id, name: def.name, category: def.category, duration: HAKO.buffTurns, ref: "tips_200", known: true, tag: (s as any)?.tag ?? null, skill: "溢彩" });
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isHako287);
  if (!units.length) return out;
  ensureShieldTicker(battle);
  for (const h of units) {
    // 溢彩 (passive: sealed by 压制) — shield + random buff before each ally acts.
    registerOwnerHandler(battle, "betting:287:overflow:" + h.id, h.id, EV.TURN_START, async (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (a && a.teamId === h.teamId) await overflow(battle, h, a);
    }, "ALL");
    // 溢彩 evolved — random debuff on the attacker, once per enemy action.
    const hitBy = new Set<number>();
    registerOwnerHandler(battle, "betting:287:retort:" + h.id, h.id, EV.DAMAGE, async (ctx: any) => {
      const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
      if (!src || dst?.id !== h.id || src.teamId === h.teamId || !src.alive || ctx?.result?.type === DamageType.INDIRECT) return;
      if (hitBy.has(src.id)) return;
      hitBy.add(src.id);
      battle.rng.expect("hako287_debuff");
      const k = KINDS[battle.rng.int(0, KINDS.length - 1)];
      const def = debuffDef(k);
      for (const old of [...src.statuses]) if (old.def.id === def.id) src.expireStatus(old);
      await applyContested(battle, h, src, def, HAKO.debuffChance, HAKO.debuffTurns, [{ ...k.eff, value: -k.eff.value }], { skill: "溢彩", ref: "tips_201" });
    }, "ALL");
    ensureGlobalHandler(battle, "betting:287:retort-reset:" + h.id, EV.ACTION_END, () => hitBy.clear());
    ensureGlobalHandler(battle, "betting:287:turn:" + h.id, EV.TURN_END, (ctx: any) => { if (ctx?.actor?.id === h.id) setNote(h, N_TURN, ownTurns(h) + 1); });
    // Records die with Hako (no source turn will ever count them down).
    ensureGlobalHandler(battle, "betting:287:death:" + h.id, EV.DEATH, (ctx: any) => {
      if (ctx?.target?.id !== h.id) return;
      for (const a of battle.allEntities() as Entity[]) {
        const st = a.statuses.find(s => s.def.id === DREAM_ID && s.sourceId === h.id);
        if (!st) continue;
        a.expireStatus(st);
        setNote(a, N_REC, null);
        battle.trace.push({ t: "STATUS_EXPIRE", id: a.id, status: DREAM_ID, name: "回梦", reason: "SOURCE_DEFEATED" });
      }
    });
    out.push({ entityId: h.id, mechanic: "溢彩 (8% max-HP shield + random buff before each ally acts, random debuff on attackers) · 回梦 (HP record, 60% recover, lethal-hit immunity, cooldown 2) · KB AI" });
  }
  // 回梦 — duration over ⇒ takes effect; a lethal hit on a recorded ally ⇒ immune + takes effect now.
  ensureGlobalHandler(battle, "betting:287:dream-expire", EV.STATUS_EXPIRE, async (ctx: any) => {
    const e: Entity | undefined = ctx?.entity;
    if (ctx?.status !== DREAM_ID || ctx?.reason !== "DURATION" || !e) return;
    if (noteValue(e, N_REC) !== null) await takeEffect(battle, e, "DURATION");
  });
  ensureGlobalHandler(battle, "betting:287:dream-lethal", EV.BEFORE_DAMAGE, async (ctx: any) => {
    const res = ctx?.result, v: Entity | undefined = ctx?.input?.target, src: Entity | undefined = ctx?.input?.source;
    if (!res || !v || ctx.cancelled || !(res.final > 0) || !recordOf(battle, v)) return;
    if (res.final < v.hp + shieldTotal(v)) return;
    ctx.cancelled = true;
    battle.trace.push({ t: "IMMUNE", src: src?.id ?? null, dst: v.id, by: DREAM_ID, name: "回梦", kind: "DAMAGE", damage: GameMath.display(res.final), consumed: true, skill: "回梦" });
    await takeEffect(battle, v, "LETHAL_CONSUMED");
  });
  return out;
}

export const KIT: BettingKit = {
  ruleSkill,
  gate,
  afterCast,
  install,
};
