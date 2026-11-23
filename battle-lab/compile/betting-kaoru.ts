// compile/betting-kaoru.ts — 薰 298 (Global "Kaoru") at max skill level. MAX mode only (match 7).
//
// Sources: data/kb/shikigami.json 298_01..298_03, buffs 2984_1 鸮之守 / 2986_1 鸮之舞, tips_2982 玩耍 / tips_2983 警戒 /
// tips_15 维持 / tips_21 失去; data/kb/en-text.json (Global). The fandom page is an older version (cost 2, "if not
// Alert, gain 4 onibi instead") — the KB / Global text is used: always +4 onibi, base cost 1, L3 −1 ⇒ 0 at max
// (doubt: if the live cost is 2 → 1, she nets 3 onibi per cast instead of 4).
//   干扰投掷 (298_01) · 115%; L5: a target with 4 or more buffs is also pushed back 15%.
//   鸮之警惕 (298_02) · passive (唯一): at the start of every turn (either side) the state is re-evaluated: 警戒 when
//       2 or more living allies (herself included) suffer control effects, else 玩耍. 警戒 = +15 SPD, +60% effect RES
//       (L3/L4). L5: in 玩耍, at the end of her own turn all allies gain +10% damage dealt until the state switches.
//   温柔的守护 (298_03, 0 onibi) · 鸮之守 on one ally (sustained 1 turn = counted on her turns: through the end of her
//       next turn), +4 onibi (compiled orb gain), dispels 1 debuff or control from each ally (control first), then —
//       in 警戒 — allies still controlled gain 鸮之舞 (+50 SPD, 2 turns). L5 先机: 鸮之守 on the lowest-HP ally at
//       battle start (through the end of her first turn).
//   鸮之守 (2984_1) · absorbs all damage taken and records it (before shields; damage the bearer is immune to by a
//       status is not recorded); when the mark disappears (expiry, dispel, re-application, cap, Kaoru's death) the
//       bearer LOSES 60% (L4) of the record (HP loss: no shield, no on-damage triggers; can kill). The record is
//       capped at 200% of Kaoru's max HP: reaching it removes and settles the mark at once (the part of the hit above
//       the cap goes through).
//   AI (KB) · living allies ≥ 2 → 温柔的守护 on the lowest HP-ratio ally (herself included, summons excluded),
//       otherwise 干扰投掷.
// Readings (unverified): when Kaoru dies her sustained marks are settled at once (a 维持 status has no source turns
// left); re-applying the mark on a bearer settles the old one first.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit } from "./betting-m7.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler,
  isControlDef, isDebuffOrControl, shiftBar, entityById,
} from "./betting-shared.ts";

export const KAORU = Object.freeze({
  basicRatio: 115, pushBuffs: 4, push: 0.15, alertSpd: 15, alertRes: 0.6, alertAt: 2, playDmg: 0.1,
  owlTurns: 2, owlLoss: 0.6, owlCapOfKaoruHp: 2, danceSpd: 50, danceTurns: 2,
});

export const OWL_ID = "2984_1";
export const DANCE_ID = "2986_1";
export const ALERT_ID = "298_alert";
export const PLAY_DMG_ID = "298_play_dmg";
const N_RECORD = "kaoru298:owl=";
const N_TARGET = "kaoru298:target=";

const owlDef = () => markDef({ id: OWL_ID, name: "鸮之守", category: StatusCategory.BUFF_MARK, durationPolicy: "SOURCE_TURN",
  desc: "【增益、印记】受到伤害时，吸收全部伤害并记录。在此印记消失时，使拥有的友方失去等同记录值60%的生命（不超过薰生命上限的200%）。" }, StatusBook);
const danceDef = () => markDef({ id: DANCE_ID, name: "鸮之舞", category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【增益、状态】提升50点速度" }, StatusBook);
const alertDef = () => markDef({ id: ALERT_ID, name: "警戒", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "警戒：自身提升15点速度以及60%效果抵抗（L3/L4）。" }, StatusBook);
const playDef = () => markDef({ id: PLAY_DMG_ID, name: "玩耍·增伤", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "鸮之警惕 L5：玩耍状态下薰回合结束时，友方全体提升10%伤害，直到切换状态为止。" }, StatusBook);

export const isKaoru298 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "298_02") && !!skillById(e, "298_03");
export const inAlert = (e: Entity): boolean => e.hasStatus(ALERT_ID);
export const owlRecord = (e: Entity): number => Number(noteValue(e, N_RECORD) ?? 0);
const hpRatio = (e: Entity): number => (e.maxHp > 0 ? e.hp / e.maxHp : 0);
const teamMates = (battle: any, e: Entity): Entity[] => (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m));
const controlled = (e: Entity): boolean => e.statuses.some(s => isControlDef(s.def));
const buffCount = (e: Entity): number => e.statuses.filter(s => String(s.def.category).startsWith("BUFF")).length;
const damageImmune = (e: Entity): boolean => e.statuses.some(s => (s.def.immuneTo ?? []).includes("DAMAGE"));

// ───────────────────────── 鸮之守 ─────────────────────────

function grantOwl(battle: any, k: Entity, dst: Entity, turns: number, reason: string): void {
  if (!dst?.alive) return;
  const old = dst.statuses.find(s => s.def.id === OWL_ID);
  if (old) { dst.expireStatus(old); settleOwl(battle, dst, "REAPPLIED"); }
  const def = owlDef();
  const a = dst.addStatus(def, k.id, 1, turns, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: k.id, dst: dst.id, status: OWL_ID, name: def.name, category: def.category, duration: turns, ref: OWL_ID, known: true, tag: a.tag, reason, skill: "温柔的守护" });
}

/** The mark is gone: the bearer loses 60% of the record (the caller resolves a lethal loss). */
function settleOwl(battle: any, e: Entity, reason: string): void {
  const rec = owlRecord(e);
  setNote(e, N_RECORD, null);
  if (!(rec > 0) || !e.alive) return;
  const applied = battle.lose(e, rec * KAORU.owlLoss);
  battle.trace.push({ t: "OWL_SETTLE", id: e.id, recorded: GameMath.display(rec), loss: GameMath.display(applied), ratio: KAORU.owlLoss, reason, skill: "鸮之守" });
}

async function settleAndResolve(battle: any, e: Entity, reason: string): Promise<void> {
  settleOwl(battle, e, reason);
  if (e.hpZero && !e.dead) await battle.resolveLethal(e, null);
}

async function absorb(battle: any, ctx: any): Promise<void> {
  const dst: Entity | undefined = ctx?.input?.target, res = ctx?.result;
  if (!dst?.alive || !res || ctx.cancelled || !(res.final > 0)) return;
  const st = dst.statuses.find(s => s.def.id === OWL_ID);
  if (!st || damageImmune(dst)) return;
  const k = entityById(battle, st.sourceId);
  const cap = (k?.maxHp ?? dst.maxHp) * KAORU.owlCapOfKaoruHp;
  const before = owlRecord(dst);
  const take = Math.min(res.final, Math.max(0, cap - before));
  const after = before + take;
  setNote(dst, N_RECORD, after);
  battle.trace.push({ t: "OWL_ABSORB", id: dst.id, src: ctx.input.source?.id ?? null, absorbed: GameMath.display(take), recorded: GameMath.display(after), cap: GameMath.display(cap), skill: "鸮之守" });
  if (take >= res.final) ctx.cancelled = true;
  else res.final -= take;
  if (after >= cap - 1e-6) {
    dst.expireStatus(st);
    battle.trace.push({ t: "STATUS_EXPIRE", id: dst.id, status: OWL_ID, name: "鸮之守", reason: "CAP_REACHED" });
    await settleAndResolve(battle, dst, "CAP_REACHED");
  }
}

// ───────────────────────── 鸮之警惕 ─────────────────────────

function setPlayBuff(battle: any, k: Entity, on: boolean): void {
  for (const m of battle.teams[k.teamId].members as Entity[]) {
    for (const st of [...m.statuses]) if (st.def.id === PLAY_DMG_ID && st.sourceId === k.id) m.expireStatus(st);
    if (on && m.alive) m.addStatus(playDef(), k.id, 1, PERSIST, [{ prop: "dmgDealtB", value: KAORU.playDmg, mode: "FIXED" }], 1);
  }
  if (on) battle.trace.push({ t: "STATUS_APPLY", src: k.id, dst: k.id, status: PLAY_DMG_ID, name: "玩耍·增伤", category: StatusCategory.BUFF_STATE, duration: PERSIST, ref: "298_02:L5", known: true, reason: "PLAY_TURN_END", skill: "鸮之警惕", scope: "ALLY_ALL" });
}

function evaluateState(battle: any, k: Entity): void {
  const alert = teamMates(battle, k).filter(controlled).length >= KAORU.alertAt;
  if (alert === inAlert(k)) return;
  if (alert) {
    k.addStatus(alertDef(), k.id, 1, PERSIST, [{ prop: "spd", value: KAORU.alertSpd, mode: "FIXED" }, { prop: "efr", value: KAORU.alertRes, mode: "FIXED" }], 1);
    setPlayBuff(battle, k, false);
  } else {
    for (const st of [...k.statuses]) if (st.def.id === ALERT_ID) k.expireStatus(st);
  }
  battle.trace.push({ t: "STATE_SWITCH", id: k.id, state: alert ? "警戒" : "玩耍", skill: "鸮之警惕" });
}

// ───────────────────────── skills ─────────────────────────

function pickWard(battle: any, k: Entity): Entity {
  const pool = teamMates(battle, k);
  const id = Number(noteValue(k, N_TARGET) ?? NaN);
  return pool.find(m => m.id === id) ?? pool.reduce((a, b) => (hpRatio(b) < hpRatio(a) ? b : a), k);
}

async function gentleGuardian(battle: any, k: Entity, x: any): Promise<void> {
  const ward = pickWard(battle, k);
  setNote(k, N_TARGET, null);
  grantOwl(battle, k, ward, KAORU.owlTurns, "CAST");
  for (const m of battle.teams[k.teamId].aliveMembers() as Entity[]) {
    const pool = m.statuses.filter(s => isDebuffOrControl(s.def) && s.def.dispellable);
    const st = pool.find(s => isControlDef(s.def)) ?? pool[0];
    if (!st || !m.dispel(st.def.id)) continue;
    const what = isControlDef(st.def) ? "CONTROL" : "DEBUFF";
    battle.trace.push({ t: "STATUS_REMOVE", id: m.id, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what, src: k.id, skill: x.name, order: "control first, then oldest debuff" });
    battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: m, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what, src: k.id, skill: x.name }, m.id, m.teamId);
  }
  if (!inAlert(k)) return;
  for (const m of battle.teams[k.teamId].aliveMembers() as Entity[]) {
    if (!controlled(m)) continue;
    const def = danceDef();
    for (const st of [...m.statuses]) if (st.def.id === DANCE_ID) m.expireStatus(st);
    const a = m.addStatus(def, k.id, 1, KAORU.danceTurns, [{ prop: "spd", value: KAORU.danceSpd, mode: "FIXED" }], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: k.id, dst: m.id, status: DANCE_ID, name: def.name, category: def.category, duration: KAORU.danceTurns, ref: DANCE_ID, known: true, tag: a.tag, skill: x.name });
  }
}

function throwHook(x: any): any {
  if (x?.id !== "298_01") return null;
  return {
    kind: "KAORU_THROW",
    run: async (battle: any, k: Entity, hurt: Entity[], primary?: Entity) => {
      const v = primary?.alive && primary.teamId !== k.teamId ? primary : battle.enemiesOf(k.teamId).find((e: Entity) => e.alive);
      if (!v) return;
      hurt.push(v);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        await battle.damage(k, v, k.prop("atk") * (Number(x.damage?.[0]?.ratioMax ?? KAORU.basicRatio) / 100), DamageType.NORMAL, 1, null);
      });
      if (v.alive && buffCount(v) >= KAORU.pushBuffs) shiftBar(battle, v, -KAORU.push, x.name);
    },
  };
}

export const KAORU_PATCHES = Object.freeze({
  "298_03": {
    note: "温柔的守护: one ally gets 鸮之守 (absorb / settle), dispel 1 debuff-or-control per ally and 鸮之舞 (警戒 only) are run by betting-kaoru.ts; the compiled slots put both marks on the whole team",
    patch: { statusRefConditionOnly: [0, 1], purge: [], targeting: ["友方目标"] },
  },
});

export const KIT: BettingKit = {
  patches: KAORU_PATCHES,
  damageHook: (x: any) => (bettingActive() ? throwHook(x) : null),
  ruleSkill: (battle, self) => {
    if (!bettingActive() || !isKaoru298(self)) return null;
    if (teamMates(battle, self).length >= 2) return { skill: skillById(self, "298_03"), rule: "薰: 我方存活数量≥2 → 温柔的守护 (KB AI)" };
    return { skill: skillById(self, "298_01"), rule: "薰: 我方存活数量<2 → 干扰投掷 (KB AI)" };
  },
  target: (self, x, cands) => {
    if (!bettingActive() || x?.id !== "298_03" || !isKaoru298(self)) return null;
    const pool = [...cands.filter(c => c.teamId === self.teamId && c.alive && !isSummonUnit(c) && c.id !== self.id), self];
    const target = pool.reduce((a, b) => (hpRatio(b) < hpRatio(a) ? b : a), pool[0]);
    setNote(self, N_TARGET, target.id);
    return { target, rule: "薰: 温柔的守护优先选择生命比例最低的友方（含自身，不含召唤物）(KB)" };
  },
  afterCast: async (battle, self, x) => {
    if (!bettingActive() || x?.id !== "298_03" || !isKaoru298(self)) return false;
    await gentleGuardian(battle, self, x);
    return true;
  },
  install: (battle, entities) => {
    const out: Array<{ entityId: number; mechanic: string }> = [];
    if (!bettingActive()) return out;
    const k = entities.find(isKaoru298);   // 唯一效果
    if (!k) return out;
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = true) =>
      registerOwnerHandler(battle, "betting:298:" + code + ":" + k.id, k.id, code, fn, range, { passive });
    reg(EV.BATTLE_START, () => {
      const pool = teamMates(battle, k);
      if (!pool.length || pool.some(m => m.hasStatus(OWL_ID))) return;
      const low = pool.reduce((a, b) => (b.hp < a.hp ? b : a), pool[0]);
      battle.trace.push({ t: "SUBCAST", actor: k.id, ref: "298_03", skill: "温柔的守护", target: low.id, clause: "[tips_7]先机：使生命最少的友方获得鸮之守，维持1回合" });
      grantOwl(battle, k, low, 1, "SENKI");
    }, "SELF", false);
    reg(EV.TURN_START, () => { if (k.alive) evaluateState(battle, k); });
    reg(EV.TURN_END, (ctx: any) => {
      if (ctx?.actor?.id !== k.id || !k.alive || inAlert(k)) return;
      setPlayBuff(battle, k, true);
    }, "SELF");
    reg(EV.DEATH, async (ctx: any) => {
      if (ctx?.target?.id !== k.id) return;
      setPlayBuff(battle, k, false);
      for (const m of battle.allEntities() as Entity[]) {
        const st = m.statuses.find(s => s.def.id === OWL_ID && s.sourceId === k.id);
        if (!st) continue;
        m.expireStatus(st);
        await settleAndResolve(battle, m, "SOURCE_DIED");
      }
    }, "ALL", false);
    // 鸮之守 is a mark: it absorbs and settles whatever happens to Kaoru's passive (global handlers).
    ensureGlobalHandler(battle, "betting:298:owl-absorb", EV.BEFORE_DAMAGE, (ctx: any) => absorb(battle, ctx));
    const gone = async (ctx: any) => {
      const e: Entity | undefined = ctx?.entity;
      if (ctx?.status !== OWL_ID || !e || e.hasStatus(OWL_ID) || !(owlRecord(e) > 0)) return;
      await settleAndResolve(battle, e, String(ctx.reason ?? ctx.by ?? "GONE"));
    };
    ensureGlobalHandler(battle, "betting:298:owl-expire", EV.STATUS_EXPIRE, gone);
    ensureGlobalHandler(battle, "betting:298:owl-remove", EV.STATUS_REMOVE, gone);
    out.push({ entityId: k.id, mechanic: "鸮之警惕 (玩耍/警戒, L5 +10% damage) · 鸮之守 absorb / 60% settle / cap · 鸮之舞 · L5 先机 · basic L5 push" });
    return out;
  },
};
