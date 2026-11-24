// compile/betting-ichimokuren.ts — 一目连 (SSR 272, Global "Ichimokuren") at max skill level. MAX mode only (match 15).
//
// Sources: data/kb/shikigami.json 272_01..272_03, buffs 2722_1 风护 / 2723_1 风佑, tips_11, data/kb/ai.json row 272;
// data/kb/en-text.json (Global, same meaning). Before this module:
//   · the KB row "存在友方单位生命比例40%以下时 → 2技能" never resolved, so 风符·护 was never cast;
//   · the compiled 风符·护 dealt 12% ATK to every enemy AND to the targeted ally at once and shielded himself;
//   · the compiled 风符·破 stole 20% ATK from EVERY enemy (character.ts steals loop over the whole enemy pool);
//   · the compiled 风神之佑 shields never expired and 风佑 had no ATK / effect RES effect.
//   风符·破 (272_01) · 125% ATK to the target, then 100% chance to steal 20% of ITS ATK for 2 turns (kernel steal).
//   风符·护 (272_02, 2) · 风护 on one ally: shield = 20% of his max HP (L2) for 2 of the bearer's turns. When it
//        disappears (broken or expired): damage = 12% of his max HP to every enemy, and (L3) every enemy's action bar
//        −20%. L4 先机 (unique per side): cast free at battle start on the allied shikigami with the highest ATK. L5:
//        while it exists, each debuff / control / banishment the bearer receives pushes every enemy back 5% (max 3 per
//        round).
//   风神之佑 (272_03, 3) · every living non-summon ally: 风佑 shield = 18% of his max HP (L3) + 10% ATK + 15% effect RES
//        for 2 of the bearer's turns. L4: an ally that already had 风佑 also gets +20% ATK / +30% RES for 1 turn; L5: it
//        is also healed by 80% of its remaining 风佑 shield (before the new one).
//   AI (KB) · every ally ≥ 40% HP → 风神之佑; an ally below 40% → 风符·护 on the lowest-HP-ratio ally (KB target rule);
//        unaffordable → 风符·破.
// Readings (unverified, noted in the report):
//   · "生命上限" in both shields and the burst = Ichimokuren's own max HP (the compiled shield base, same reading).
//   · Re-casting 风护 on a bearer that still has it replaces the old shield without a burst.
//   · The burst is NORMAL damage (can crit, reduced by DEF); it does not happen once he is dead.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { applyStatSteal } from "../kernel/steal.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Hook, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, shiftBar, isDebuffOrControl, atkForTargeting,
} from "./betting-shared.ts";
import { inOwnTurn } from "./betting-scope.ts";

export const ICHIMOKUREN = Object.freeze({
  wardShield: 0.2, wardTurns: 2, burst: 0.12, burstPush: 0.2, l5Push: 0.05, l5Cap: 3,
  blessShield: 0.18, blessAtk: 0.1, blessRes: 0.15, blessTurns: 2, repeatAtk: 0.2, repeatRes: 0.3, repeatTurns: 1, repeatHeal: 0.8,
  steal: 0.2, stealTurns: 2, aiLow: 0.4, s1Ratio: 125,
});
export const WARD_ID = "2722_1";
export const BLESS_ID = "2723_1";
const REPEAT_ID = "272_bless_repeat";

const wardDef = () => markDef({ id: WARD_ID, name: "风护", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN",
  dispellable: false, removable: true, desc: "【增益、印记】能够吸收一定量伤害，无法被驱散。消失时对敌方全体造成一目连生命上限12%伤害并击退20%行动条。" }, StatusBook);
const blessDef = () => markDef({ id: BLESS_ID, name: "风佑", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN",
  dispellable: false, removable: true, desc: "【增益、印记】能够吸收一定量伤害，无法被驱散。提升10%攻击、15%效果抵抗。" }, StatusBook);
const repeatDef = () => markDef({ id: REPEAT_ID, name: "风佑·重复", category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN",
  dispellable: true, removable: true, desc: "风神之佑 L4：对携带风佑的友方重复施放，额外提升20%攻击、30%效果抵抗，持续1回合。" }, StatusBook);

export const isIchimokuren = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "272_02") && !!skillById(e, "272_03");
const allies = (battle: any, e: Entity): Entity[] => (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m));
const enemies = (battle: any, e: Entity): Entity[] => (battle.enemiesOf(e.teamId) as Entity[]).filter(v => v.alive);
const ratioOf = (v: Entity): number => (v.maxHp > 0 ? v.hp / v.maxHp : 1);

interface Ward { src: Entity; bearer: Entity; shield: any; turns: number; skipOwn: boolean; done: boolean }
const WARDS = new WeakMap<object, Map<number, Ward>>();
const wardsOf = (battle: any): Map<number, Ward> => { let m = WARDS.get(battle); if (!m) { m = new Map(); WARDS.set(battle, m); } return m; };
const lastTarget = new WeakMap<object, number>();

function wardTarget(battle: any, i: Entity): Entity | null {
  const pool = allies(battle, i);
  if (!pool.length) return null;
  const low = pool.filter(m => ratioOf(m) < ICHIMOKUREN.aiLow);
  if (low.length) return low.reduce((a, b) => (ratioOf(b) < ratioOf(a) ? b : a));
  return pool.reduce((a, b) => (atkForTargeting(b) > atkForTargeting(a) ? b : a));
}

function removeWardMark(w: Ward): void { for (const st of [...w.bearer.statuses]) if (st.def.id === WARD_ID && st.sourceId === w.src.id) w.bearer.expireStatus(st); }

/** 风护 disappears: burst + L3 push (once). */
async function wardGone(battle: any, w: Ward, why: string): Promise<void> {
  if (w.done) return;
  w.done = true;
  wardsOf(battle).delete(w.bearer.id);
  if (!w.shield.broken) { w.shield.broken = true; battle.trace.push({ t: "SHIELD_EXPIRE", id: w.bearer.id, shield: w.shield.id, remaining: GameMath.display(w.shield.value) }); }
  removeWardMark(w);
  const i = w.src;
  if (!i.alive) return;
  battle.trace.push({ t: "PASSIVE_PROC", actor: i.id, skill: "风符·护", effect: "风护消失（" + why + "）：对敌方全体造成生命上限12%伤害，击退20%行动条", target: w.bearer.id });
  await battle.withinResolution({ id: "HIT:风护#burst", type: "HIT" }, async () => {
    for (const v of enemies(battle, i)) if (v.alive && i.alive) await battle.damage(i, v, i.maxHp * ICHIMOKUREN.burst, DamageType.NORMAL, 1, null);
  });
  for (const v of enemies(battle, i)) shiftBar(battle, v, -ICHIMOKUREN.burstPush, "风符·护");
}

export function grantWard(battle: any, i: Entity, t: Entity, skill: string): void {
  if (!t?.alive) return;
  const old = wardsOf(battle).get(t.id);
  if (old) { old.done = true; old.shield.broken = true; removeWardMark(old); wardsOf(battle).delete(t.id); }
  const value = i.maxHp * ICHIMOKUREN.wardShield;
  const shield: any = t.addShield({ value, sourceId: i.id, dispellable: false, tag: "272_02" });
  battle.trace.push({ t: "SHIELD_APPLY", src: i.id, dst: t.id, value: GameMath.display(value), base: "maxHp", ratio: ICHIMOKUREN.wardShield * 100, skill, duration: ICHIMOKUREN.wardTurns });
  t.addStatus(wardDef(), i.id, 1, 99999, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: i.id, dst: t.id, status: WARD_ID, name: "风护", category: StatusCategory.BUFF_MARK, duration: ICHIMOKUREN.wardTurns, ref: WARD_ID, known: true, skill });
  wardsOf(battle).set(t.id, { src: i, bearer: t, shield, turns: ICHIMOKUREN.wardTurns, skipOwn: inOwnTurn(battle, t), done: false });
}

async function bless(battle: any, i: Entity, skill: string): Promise<void> {
  const def = blessDef();
  for (const m of allies(battle, i)) {
    const had = m.statuses.find(s => s.def.id === BLESS_ID);
    if (had) {
      const old = (m.shields as any[]).filter(s => !s.broken && String(s.id).startsWith("sh_272_03_"));
      const remaining = old.reduce((a, s) => a + Math.max(0, Number(s.value) || 0), 0);
      for (const s of old) s.broken = true;
      m.expireStatus(had);
      for (const st of [...m.statuses]) if (st.def.id === REPEAT_ID) m.expireStatus(st);
      m.addStatus(repeatDef(), i.id, 1, ICHIMOKUREN.repeatTurns, [{ prop: "atk", value: ICHIMOKUREN.repeatAtk, mode: "ADD_RATE" }, { prop: "efr", value: ICHIMOKUREN.repeatRes, mode: "FIXED" }], 1);
      battle.trace.push({ t: "STATUS_APPLY", src: i.id, dst: m.id, status: REPEAT_ID, name: "风佑·重复", category: StatusCategory.BUFF_STATE, duration: ICHIMOKUREN.repeatTurns, ref: REPEAT_ID, known: true, skill });
      if (remaining > 0) await battle.heal(i, m, remaining * ICHIMOKUREN.repeatHeal, { crit: false });
    }
    const value = i.maxHp * ICHIMOKUREN.blessShield;
    const sh: any = m.addShield({ value, sourceId: i.id, dispellable: false, tag: "272_03" });
    sh.ttl = ICHIMOKUREN.blessTurns + (inOwnTurn(battle, m) ? 1 : 0);
    battle.trace.push({ t: "SHIELD_APPLY", src: i.id, dst: m.id, value: GameMath.display(value), base: "maxHp", ratio: ICHIMOKUREN.blessShield * 100, skill, duration: ICHIMOKUREN.blessTurns });
    m.addStatus(def, i.id, 1, ICHIMOKUREN.blessTurns, [{ prop: "atk", value: ICHIMOKUREN.blessAtk, mode: "ADD_RATE" }, { prop: "efr", value: ICHIMOKUREN.blessRes, mode: "FIXED" }], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: i.id, dst: m.id, status: BLESS_ID, name: "风佑", category: StatusCategory.BUFF_MARK, duration: ICHIMOKUREN.blessTurns, ref: BLESS_ID, known: true, skill });
  }
}

function windBreak(x: any): Hook | null {
  if (x?.id !== "272_01") return null;
  return {
    kind: "WIND_BREAK",
    run: async (battle, i, hurt, primary) => {
      const t = primary && primary.alive && primary.teamId !== i.teamId ? primary : enemies(battle, i)[0];
      if (!t) return;
      if (!hurt.includes(t)) hurt.push(t);
      const ratio = Number(x.damage?.[0]?.ratioMax ?? x.damage?.[0]?.ratio ?? ICHIMOKUREN.s1Ratio) / 100;
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        await battle.damage(i, t, i.prop("atk") * ratio, DamageType.NORMAL, 1, x.lifesteal ?? null);
      });
      if (!t.alive || !i.alive) return;
      const r = applyStatSteal(battle, i, t, { prop: "atk", ratio: ICHIMOKUREN.steal, flat: null, duration: ICHIMOKUREN.stealTurns, durationSource: "SENTENCE", probability: 1, maxPerTarget: null, side: "ENEMY", evidence: "偷取20%攻击，持续2回合（仅目标）" } as any);
      if (!r.applied) battle.trace.push({ t: "STAT_STEAL_BLOCKED", src: i.id, dst: t.id, skill: x.name, reason: r.reason });
    },
  };
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isIchimokuren(self)) return null;
  const basic = skillById(self, "272_01"), ward = skillById(self, "272_02"), ult = skillById(self, "272_03");
  const can = (sk: any) => !!sk && (!(costOf(sk) > 0) || battle.teams[self.teamId].orbs.canPay(costOf(sk)));
  const low = allies(battle, self).some(m => ratioOf(m) < ICHIMOKUREN.aiLow);
  if (!low && can(ult)) return { skill: ult, rule: "一目连: 所有友方生命 ≥ 40% → 风神之佑 (KB AI)" };
  if (low && can(ward)) return { skill: ward, rule: "一目连: 存在友方生命 < 40% → 风符·护 (KB AI)" };
  return basic ? { skill: basic, rule: "一目连: 鬼火不足 → 风符·破" } : null;
}

function target(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || x?.id !== "272_02" || !isIchimokuren(self)) return null;
  const pool = cands.filter(m => m.alive && m.teamId === self.teamId && !isSummonUnit(m));
  if (!pool.length) return null;
  const low = pool.filter(m => ratioOf(m) < ICHIMOKUREN.aiLow);
  const t = low.length ? low.reduce((a, b) => (ratioOf(b) < ratioOf(a) ? b : a)) : pool.reduce((a, b) => (atkForTargeting(b) > atkForTargeting(a) ? b : a));
  lastTarget.set(self, t.id);
  return { target: t, rule: low.length ? "一目连: 风符·护 优先血量低于40%的单位 (KB)" : "一目连: 风符·护 → 攻击最高的友方" };
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isIchimokuren(self)) return false;
  if (x?.id === "272_02") {
    const id = lastTarget.get(self);
    lastTarget.delete(self);
    const t = (id !== undefined ? allies(battle, self).find(m => m.id === id) : null) ?? wardTarget(battle, self);
    if (t) grantWard(battle, self, t, x.name);
    return true;
  }
  if (x?.id === "272_03") { await bless(battle, self, x.name); return true; }
  return false;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const seen = new Set<number>();
  for (const i of entities.filter(isIchimokuren)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:272:" + code + ":" + i.id, i.id, code, fn, range, { passive: false });
    if (!seen.has(i.teamId)) {
      seen.add(i.teamId);
      reg(EV.BATTLE_START, () => {
        const pool = allies(battle, i);
        if (!pool.length) return;
        const top = pool.reduce((a, b) => (atkForTargeting(b) > atkForTargeting(a) ? b : a));
        battle.trace.push({ t: "SUBCAST", actor: i.id, ref: "272_02", skill: "风符·护", target: top.id, clause: "先机：唯一效果，对攻击最高的友方式神无消耗施放" });
        grantWard(battle, i, top, "风符·护");
      }, "SELF");
    }
    // Shields: 风佑 ttl on the bearer's turn ends; 风护 expiry → burst.
    reg(EV.TURN_END, async (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a) return;
      for (const sh of (a.shields ?? []) as any[]) {
        if (sh.broken || typeof sh.ttl !== "number" || !String(sh.id).startsWith("sh_272_03_") || sh.sourceId !== i.id) continue;
        if (--sh.ttl <= 0) { sh.broken = true; battle.trace.push({ t: "SHIELD_EXPIRE", id: a.id, shield: sh.id, remaining: GameMath.display(sh.value) }); }
      }
      const w = wardsOf(battle).get(a.id);
      if (!w || w.src.id !== i.id || w.done) return;
      if (w.skipOwn) { w.skipOwn = false; return; }
      if (--w.turns <= 0) await wardGone(battle, w, "到期");
    });
    reg(EV.AFTER_DAMAGE, async (ctx: any) => {
      const t: Entity | undefined = ctx?.input?.target;
      const w = t ? wardsOf(battle).get(t.id) : undefined;
      if (!w || w.src.id !== i.id || w.done) return;
      if (w.shield.broken || !(w.shield.value > 0) || !t!.alive) await wardGone(battle, w, t!.alive ? "护盾被击破" : "承受者阵亡");
    });
    // L5: debuff / control / banishment on the bearer ⇒ every enemy −5% bar (max 3 per round).
    let round = -1, count = 0;
    reg(EV.STATUS_ADD, (ctx: any) => {
      const e: Entity | undefined = ctx?.entity;
      const w = e ? wardsOf(battle).get(e.id) : undefined;
      if (!w || w.src.id !== i.id || w.done || ctx.merged) return;
      const def = StatusBook.get(String(ctx.status ?? "")) ?? e!.statuses.find((s: any) => s.def.id === ctx.status)?.def;
      if (!def || !(isDebuffOrControl(def) || (def as any).banish)) return;
      if (battle.turn !== round) { round = battle.turn; count = 0; }
      if (count >= ICHIMOKUREN.l5Cap) return;
      count++;
      battle.trace.push({ t: "PASSIVE_PROC", actor: i.id, skill: "风符·护", effect: "风护 L5：目标受到减益/控制，击退敌方全体5%行动条 (" + count + "/3)", target: e!.id });
      for (const v of enemies(battle, i)) shiftBar(battle, v, -ICHIMOKUREN.l5Push, "风符·护");
    });
    out.push({ entityId: i.id, mechanic: "风符·破 single-target steal · 风符·护 (20% max-HP shield 2 turns, burst 12% max HP + push 20% on loss, L4 先机, L5 push 5%) · 风神之佑 (18% shields 2 turns, +10% ATK / +15% RES, L4/L5 repeat) · KB AI" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "272_01": { note: "风符·破: damage + steal of the TARGET's ATK run by betting-ichimokuren.ts (the compiled steal hit every enemy)", patch: { steals: [] } },
    "272_02": { note: "风符·护: single-ally ward, burst on loss, L3/L4/L5 run by betting-ichimokuren.ts (compiled immediate 12% hits on all + self shield removed)", patch: { damage: [], shield: [], statusRefConditionOnly: [0, 1], targeting: ["友方目标"] } },
    "272_03": { note: "风神之佑: timed 18% shields, 风佑 +10% ATK / +15% RES, L4/L5 run by betting-ichimokuren.ts", patch: { shield: [], statusRefConditionOnly: [0] } },
  }),
  damageHook: (x: any) => (bettingActive() ? windBreak(x) : null),
  ruleSkill,
  target,
  afterCast,
  install,
};
