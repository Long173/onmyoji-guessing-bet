// compile/betting-susabi390.ts — 神启荒 (SP 390, Global "Divine Prophet Susabi") at max skill level. MAX mode only (match 10).
//
// Sources: data/kb/shikigami.json 390_01..390_03, buffs 3903_1 星辰之力, tips_5 / tips_11; data/kb/ai.json;
// data/kb/en-text.json (Global). Before this module 星罗云布 dealt 6 × 72% indirect hits at once on every cast (the
// compiler read "触发6次星爆后幻境结束" as 6 hits) and the realm itself (prophecy, ramp, damage cuts) did not exist.
//   星罗云布 (390_02, 2) · 唯一. Opens 命运星河 (6 star bursts). At the start of each enemy (non-Onmyoji) normal turn: if
//        that enemy does not spend onibi, a star burst: 72% ATK indirect damage to every enemy (L2: +25% per earlier
//        burst of this realm, at most +75%), she recovers 8% of her max HP and gains 1 星辰之力 (cap 6). After 6 bursts
//        the realm ends and her bar +30%. In the realm: allies take 20% less normal-attack damage; L3: she takes 40%
//        less damage. L4 先机: cast at battle start (free). Recasting opens a fresh realm.
//   陨星 (390_01) L5     · a normal attack in the realm adds 1 burst to its remaining count (at most 6).
//   星流霆击 (390_03, 3) · 139% ATK to every enemy, then one 68% hit on every enemy per 星辰之力 (all consumed). L4: cast
//        in the realm adds 3 bursts (at most 6).
//   AI (KB)              · 星辰之力 ≥ 3 → 星流霆击, otherwise 星罗云布; the normal attack when the onibi are short.
// Readings (unverified): the prophecy is settled when the enemy's action ends (did it pay onibi during its normal
// turn?), i.e. the burst lands after that action instead of before it; L5 runs the bursts with enemy passives
// suppressed (withEnemiesSuppressed; Inugami's guard counter honours it); the 星辰之力 control cleanse is not modelled.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler,
  stacksOn, setStackedStatus, shiftBar, withEnemiesSuppressed, PERSIST,
} from "./betting-shared.ts";
import { currentSkillOf } from "./betting-scope.ts";

export const SUSABI = Object.freeze({
  bursts: 6, burstRatio: 0.72, ramp: 0.25, rampCap: 0.75, heal: 0.08, starCap: 6, endBar: 0.3, normalCut: 0.2, selfCut: 0.4,
  aoe: 139, extra: 68, s3AddBursts: 3, s1AddBursts: 1, s3Stars: 3,
});
export const STAR_ID = "3903_1";
const N_LEFT = "susabi390:left=", N_DONE = "susabi390:done=";

const starDef = () => markDef({ id: STAR_ID, name: "星辰之力", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】上限6层。回合开始时，若自身处于控制状态且星辰之力不小于3层时，消耗3层解除或驱散所有控制效果。" }, StatusBook);

export const isSusabi390 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "390_02") && !!skillById(e, "390_03");
export const starsOf = (e: Entity): number => stacksOn(e, STAR_ID, e.id);
const left = (e: Entity): number => Number(noteValue(e, N_LEFT) ?? 0);
export const realmOpen = (e: Entity): boolean => e.alive && left(e) > 0;
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const opened = new WeakSet<object>();

function openRealm(battle: any, s: Entity, reason: string): void {
  setNote(s, N_LEFT, SUSABI.bursts);
  setNote(s, N_DONE, 0);
  battle.trace.push({ t: "FIELD_OPEN", owner: s.id, name: "命运星河", skill: "星罗云布", reason });
}
function addBursts(battle: any, s: Entity, n: number, skill: string): void {
  if (!realmOpen(s)) return;
  const before = left(s), after = Math.min(SUSABI.bursts, before + n);
  setNote(s, N_LEFT, after);
  battle.trace.push({ t: "STACKS_SET", id: s.id, name: "命运星河·星爆", from: before, to: after, skill });
}

async function starburst(battle: any, s: Entity, trigger: Entity): Promise<void> {
  const done = Number(noteValue(s, N_DONE) ?? 0);
  const ratio = SUSABI.burstRatio * (1 + Math.min(SUSABI.rampCap, SUSABI.ramp * done));
  battle.trace.push({ t: "SUBSKILL", actor: s.id, skill: "星罗云布", form: "星爆", target: trigger.id, ratio, burst: done + 1 });
  // L5: star bursts do not trigger enemy passives.
  await withEnemiesSuppressed(battle, s, { soul: false, passive: true }, () => battle.withinResolution({ id: "HIT:星爆#" + (done + 1), type: "HIT" }, async () => {
    for (const v of aliveEnemies(battle, s)) await dealDamage(battle, { source: s, target: v, base: s.prop("atk") * ratio, rate: 1, type: DamageType.INDIRECT, skillTag: "betting-390:burst" });
  }));
  if (s.alive) await battle.heal(s, s, s.maxHp * SUSABI.heal, { recover: true });
  const stars = setStackedStatus(s, starDef(), starsOf(s) + 1, SUSABI.starCap, s.id, []);
  battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: s.id, status: STAR_ID, name: "星辰之力", category: StatusCategory.COMMON_MARK, duration: PERSIST, ref: STAR_ID, known: true, stacks: stars, threshold: SUSABI.starCap, skill: "星罗云布" });
  setNote(s, N_DONE, done + 1);
  const rest = left(s) - 1;
  setNote(s, N_LEFT, Math.max(0, rest));
  if (rest <= 0 && s.alive) {
    battle.trace.push({ t: "FIELD_CLOSE", owner: s.id, name: "命运星河", reason: "BURSTS_DONE" });
    shiftBar(battle, s, SUSABI.endBar, "星罗云布");
  }
}

function damageHook(x: any): any {
  if (x?.id !== "390_03") return null;
  return {
    kind: "SUSABI_THUNDER",
    run: async (battle: any, s: Entity, hurt: Entity[]) => {
      const all = aliveEnemies(battle, s);
      if (!all.length) return;
      hurt.push(...all);
      if (realmOpen(s)) addBursts(battle, s, SUSABI.s3AddBursts, x.name);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        for (const v of all) if (v.alive) await battle.damage(s, v, s.prop("atk") * (SUSABI.aoe / 100), DamageType.NORMAL, 1, null);
      });
      const n = starsOf(s);
      for (let i = 0; i < n; i++) {
        await battle.withinResolution({ id: "HIT:" + x.name + "#star" + (i + 1), type: "HIT" }, async () => {
          for (const v of aliveEnemies(battle, s)) await battle.damage(s, v, s.prop("atk") * (SUSABI.extra / 100), DamageType.NORMAL, 1, null);
        });
      }
      if (n > 0) {
        setStackedStatus(s, starDef(), 0, SUSABI.starCap, s.id, []);
        battle.trace.push({ t: "STACKS_CONSUMED", id: s.id, status: STAR_ID, name: "星辰之力", from: n, to: 0, reason: "THUNDER", skill: x.name });
      }
    },
  };
}

function afterCast(battle: any, self: Entity, x: any): boolean {
  if (!bettingActive() || !isSusabi390(self)) return false;
  if (x?.id === "390_02") { openRealm(battle, self, "CAST"); return true; }
  if (x?.id === "390_01" && realmOpen(self)) addBursts(battle, self, SUSABI.s1AddBursts, x.name);
  return false;
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isSusabi390(self)) return null;
  const thunder = skillById(self, "390_03"), realm = skillById(self, "390_02"), basic = skillById(self, "390_01");
  const can = (sk: any) => !!sk && (!(costOf(sk) > 0) || battle.teams[self.teamId].orbs.canPay(costOf(sk)));
  if (starsOf(self) >= SUSABI.s3Stars) {
    if (can(thunder)) return { skill: thunder, rule: "神启荒: 星辰之力≥3 → 星流霆击 (KB AI)" };
  } else if (can(realm)) return { skill: realm, rule: "神启荒: 星辰之力<3 → 星罗云布 (KB AI)" };
  return basic ? { skill: basic, rule: "神启荒: 鬼火不足 → 陨星" } : null;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isSusabi390);
  if (!units.length) return out;
  const watch = new Map<number, { s: Entity; paid: boolean }>();
  for (const s of units) {
    // Prophecy: an enemy normal turn starts in the realm → watch whether it pays onibi.
    registerOwnerHandler(battle, "betting:390:watch:" + s.id, s.id, EV.TURN_START, (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || a.teamId === s.teamId || isSummonUnit(a) || ctx.type !== "NORMAL" || !realmOpen(s)) return;
      watch.set(a.id, { s, paid: false });
    }, "ALL", { passive: false });
    out.push({ entityId: s.id, mechanic: "命运星河 (prophecy bursts with ramp, 8% heal, 星辰之力, damage cuts, 先机) · 星流霆击 star hits · KB AI" });
  }
  ensureGlobalHandler(battle, "betting:390:paid", EV.ORB_COST, (ctx: any) => {
    const w = watch.get(ctx?.actor?.id ?? ctx?.actor);
    if (w && Number(ctx?.amount ?? 0) > 0) w.paid = true;
  });
  ensureGlobalHandler(battle, "betting:390:settle", EV.ACTION_END, async (ctx: any) => {
    const a: Entity | undefined = ctx?.actor;
    if (!a || ctx.type !== "NORMAL") return;
    const w = watch.get(a.id);
    if (!w) return;
    watch.delete(a.id);
    if (!w.paid && realmOpen(w.s) && w.s.alive) await starburst(battle, w.s, a);
  });
  // Realm damage cuts: allies −20% normal-attack damage; L3 Susabi −40%.
  ensureGlobalHandler(battle, "betting:390:cuts", EV.BEFORE_DAMAGE, (ctx: any) => {
    const res = ctx?.result, v: Entity | undefined = ctx?.input?.target, src: Entity | undefined = ctx?.input?.source;
    if (!res || !v || ctx.cancelled || !(res.final > 0) || !src || src.teamId === v.teamId) return;
    const s = units.find(u => u.teamId === v.teamId && realmOpen(u));
    if (!s) return;
    let k = 1;
    const sk = currentSkillOf(battle, src);
    if (res.type === DamageType.NORMAL && String((sk?.ir ?? sk)?.id ?? "").endsWith("_01")) k *= 1 - SUSABI.normalCut;
    if (v.id === s.id) k *= 1 - SUSABI.selfCut;
    if (k < 1) res.final *= k;
  });
  ensureGlobalHandler(battle, "betting:390:start", EV.BATTLE_START, () => {
    if (opened.has(battle)) return;
    opened.add(battle);
    const seen = new Set<number>();
    for (const s of units) {
      if (!s.alive || seen.has(s.teamId)) continue;   // 唯一效果
      seen.add(s.teamId);
      battle.trace.push({ t: "SUBCAST", actor: s.id, ref: "390_02", skill: "星罗云布", target: s.id, clause: "L4 先机：施放「星罗云布」" });
      openRealm(battle, s, "SENKI");
    }
  });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "390_02": { note: "星罗云布: no damage on cast — the realm, prophecy bursts and heals are run by betting-susabi390.ts", patch: { damage: [], heal: [], timeline: [], field: null, statusRefConditionOnly: [0] } },
  }),
  damageHook: (x: any) => (bettingActive() ? damageHook(x) : null),
  afterCast,
  ruleSkill,
  install,
};
