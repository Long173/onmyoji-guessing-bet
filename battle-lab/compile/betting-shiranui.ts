// compile/betting-shiranui.ts — 不知火 (SSR 330, Global "Shiranui") at max skill level. MAX mode only (match 8).
//
// Sources: data/kb/shikigami.json 330_01..330_03, buff 3300_1 离殇, tips_11 唯一 / tips_7 先机; data/kb/en-text.json
// (Global); fandom "Shiranui/Main" (the 离殇 skill table and the evolution effect are only on the wiki — doubts below).
//   初舞 (330_01) · 2 × 60% (L5). In 离殇: 终舞 2 × 72% (wiki L5).
//   离影 (330_02, 唯一) · passive: an ally (herself included, summons excluded) that basic-attacks or cannot act during
//       its own turn → at that turn's end 50% (100% while the Sparkfire Barrier is up, L5): Shiranui loses 5% of her
//       current HP (HP loss) and that ally gains +80% effect RES (L4) through the end of its next turn.
//       Active part (cast below 50% HP → 离殇 + a free 烬染不夜) is never chosen: KB AI "一形态一三循环".
//   星火满天 (330_03, 2 onibi, 唯一) · Sparkfire Barrier for 2 of HER turns (counted like Inaba's illusion: a cast in
//       her own turn also covers the end of that turn). While up, every ally: +10% damage dealt, +25 SPD, 10% damage
//       reduction; L3 +2% damage and +2% reduction per onibi the team holds (read at each hit); after an ally's basic
//       attack (skill _01) in its own turn → 100% (L4) one extra basic attack on the same target: ignores 200 DEF and
//       carries 30% lifesteal (L2), does not trigger the attacker's passives nor the target's souls / passives; extra
//       attacks never chain (they are not turns: no SKILL_END). L5 先机: opened for free when the battle's first turn
//       starts (after the action bar advanced to the first actor; match-8 turn order), not at t = 0.
//       The barrier closes when she is defeated.
//   离殇 (buff 3300_1; evolution effect, wiki: "When Shiranui receives lethal damage, she enters Sorrowful state") ·
//       once: the lethal hit is prevented, HP restored to 100%, all her statuses and marks removed; +30% crit; at the
//       end of every turn (either side) she recovers 40% of her lost HP (恢复); at the end of her own turn she loses 15%
//       of her current max HP (read as a max-HP reduction: "失去当前15%的生命上限"); her attacks put 离火 on the
//       targets, attacking a 离火 target again consumes it and doubles that attack's damage. Skill table (wiki):
//       终舞 (2 × 72%), 离歌 (passive: +20 SPD, +5 SPD and +5% RES per onibi, +20% RES; L5 after 烬染不夜, 46% ATK
//       per onibi held — dealt as one hit of 46% × onibi to every enemy), 烬染不夜 (4 onibi, 144% to all enemies,
//       L5 −1 onibi per KO'd ally). AI in 离殇 (KB "二形态通用"): 烬染不夜 when affordable, else 终舞.
//   AI (KB) · no barrier → 星火满天 when affordable, else 初舞.
// Doubts: barrier length counted on her turns; damage bonus / reduction applied as separate multipliers on the
// final damage; the 离殇 numbers (72% / 144% / 46% / costs) are wiki-only; "失去15%生命上限" read as max-HP loss;
// 离火 is per attack (not per hit); dance includes Shiranui herself.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, HpMutation, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { applyLifesteal } from "../kernel/damage.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, payOrFallback, scaleMaxHp,
} from "./betting-shared.ts";
import { inOwnTurn } from "./betting-scope.ts";

export const SHIRANUI = Object.freeze({
  barrierTurns: 2, dmg: 0.1, dr: 0.1, spd: 25, perOrb: 0.02, extraChance: 1, extraIgnoreDef: 200, extraLifesteal: 0.3,
  danceChance: 0.5, danceChanceBarrier: 1, danceHpCost: 0.05, danceRes: 0.8, danceTurns: 2,
  sorrowCrit: 0.3, sorrowRegen: 0.4, sorrowMaxHpLoss: 0.15,
  finaleRatio: 72, finaleHits: 2, blazeRatio: 144, blazeCost: 4, songSpd: 20, songSpdPerOrb: 5, songRes: 0.2, songResPerOrb: 0.05,
  songBurstPerOrb: 46,
});

export const BARRIER_ID = "330_barrier";
export const DANCE_ID = "330_dance_res";
export const SORROW_ID = "3300_1";
export const FIRE_ID = "330_fire";
const BARRIER_NAME = "星火结界";
const N_LEFT = "shir330:barrier=", N_STANCE = "shir330:stance", N_SENKI = "shir330:senki=";
const SONG_SRC = "betting:330:song";

const barrierDef = () => markDef({ id: BARRIER_ID, name: BARRIER_NAME, category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "星火结界：友方全体提升10%伤害、25点速度、获得10%减伤；每点鬼火额外增加2%伤害、2%减伤；普攻后额外普攻一次。" }, StatusBook);
const danceDef = () => markDef({ id: DANCE_ID, name: "离影·起舞", category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "离影：不知火起舞，提升80%效果抵抗，持续1回合。" }, StatusBook);
const sorrowDef = () => markDef({ id: SORROW_ID, name: "离殇", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】提升30%暴击。在每个回合（不论敌我）结束时恢复40%已损失的生命。在自身回合结束时，失去当前15%的生命上限。攻击时附加离火，不知火再次攻击承受离火的目标时，消耗离火并造成双倍伤害。" }, StatusBook);
const fireDef = () => markDef({ id: FIRE_ID, name: "离火", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "离火：不知火再次攻击承受离火的目标时，消耗离火并造成双倍伤害。" }, StatusBook);

export const isShiranui330 = (e: Entity): boolean => !isSummonUnit(e)
  && (!!skillById(e, "330_03") || !!skillById(e, "330_03s")) && (!!skillById(e, "330_02") || !!skillById(e, "330_02s"));
export const inSorrow = (e: Entity): boolean => noteValue(e, N_STANCE) !== null;
export const barrierLeft = (s: Entity): number => Number(noteValue(s, N_LEFT) ?? 0);
const shiranuiOf = (battle: any, teamId: number): Entity | null =>
  (battle.teams[teamId]?.members ?? []).find((m: Entity) => isShiranui330(m)) ?? null;
/** The team's Sparkfire Barrier is up (its owner alive and turns left). */
export function barrierUp(battle: any, teamId: number): Entity | null {
  const s = shiranuiOf(battle, teamId);
  return s && s.alive && barrierLeft(s) > 0 ? s : null;
}
const teamOrbs = (battle: any, teamId: number): number => Number(battle.teams[teamId]?.orbs?.current ?? 0);
const isOwnTurnType = (t: any) => t === "NORMAL" || t === "NEW_TURN";
/** Normal attack = skill 1 (id ends with _01; 终舞 is 330_01s). */
const isNormalAttack = (sk: any): boolean => /_01s?$/.test(String(sk?.ir?.id ?? ""));
const basicOf = (e: Entity): any => (e.skills ?? []).find(isNormalAttack) ?? (e.skills ?? []).find((s: any) => Number(s.cost) === 0) ?? null;
const koAllies = (battle: any, s: Entity): number =>
  (battle.teams[s.teamId].members as Entity[]).filter(m => m.id !== s.id && !isSummonUnit(m) && !m.alive).length;

// ───────────────────────── Sparkfire Barrier ─────────────────────────

function grantBarrierStatus(battle: any, s: Entity, m: Entity): void {
  if (!m.alive || m.statuses.some(st => st.def.id === BARRIER_ID)) return;
  m.addStatus(barrierDef(), s.id, 1, PERSIST, [{ prop: "spd", value: SHIRANUI.spd, mode: "FIXED" }], 1);
}

function openBarrier(battle: any, s: Entity, turns: number, reason: string): void {
  setNote(s, N_LEFT, turns);
  battle.trace.push({ t: "FIELD_OPEN", owner: s.id, name: BARRIER_NAME, turns, reason, skill: "星火满天" });
  const team = battle.teams[s.teamId];
  for (const m of [...team.members, ...(team.summons ?? [])] as Entity[]) grantBarrierStatus(battle, s, m);
}

function closeBarrier(battle: any, s: Entity, reason: string): void {
  setNote(s, N_LEFT, null);
  for (const m of battle.allEntities() as Entity[]) for (const st of [...m.statuses]) if (st.def.id === BARRIER_ID && st.sourceId === s.id) m.expireStatus(st);
  battle.trace.push({ t: "FIELD_CLOSE", owner: s.id, name: BARRIER_NAME, reason });
}

/** The running extra basic attack (transient; never outlives one SKILL_END handler). */
const extra = new WeakMap<object, { actor: number; target: number }>();

/** Runs `fn` with the attacker's passives and the target's souls / passives suppressed (bus suppression check). */
async function withExtraSuppression<T>(battle: any, attacker: Entity, target: Entity, fn: () => Promise<T>): Promise<T> {
  const bus = battle.bus;
  const prev = bus.suppressProvider;
  bus.suppressProvider = (id: number) => {
    const base = prev?.(id) ?? { passive: false, soul: false };
    if (id === target.id) return { passive: true, soul: true };
    if (id === attacker.id) return { passive: true, soul: base.soul };
    return base;
  };
  try { return await fn(); } finally { bus.suppressProvider = prev; }
}

async function extraAttack(battle: any, s: Entity, ctx: any): Promise<void> {
  const a: Entity | undefined = ctx?.actor, v: Entity | undefined = ctx?.target;
  if (!a || !v || !a.alive || !v.alive || a.teamId !== s.teamId || v.teamId === a.teamId || extra.has(battle)) return;
  if (!isOwnTurnType(ctx.type) || !isNormalAttack(ctx.skill) || !barrierUp(battle, s.teamId)) return;
  if (SHIRANUI.extraChance < 1) { battle.rng.expect("shir330_extra"); if (!battle.rng.testHit(SHIRANUI.extraChance)) return; }
  const basic = basicOf(a);
  if (!basic) return;
  battle.trace.push({ t: "EXTRA_ATTACK", src: s.id, actor: a.id, target: v.id, skill: basic.name, field: BARRIER_NAME, chance: SHIRANUI.extraChance });
  extra.set(battle, { actor: a.id, target: v.id });
  try {
    await withExtraSuppression(battle, a, v, () =>
      battle.withinResolution({ id: "SKILL:" + basic.name, type: "SKILL" }, () => basic.execute(battle, a, v)));
  } finally { extra.delete(battle); }
}

function onBeforeDamage(battle: any, s: Entity, ctx: any): void {
  const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target, res = ctx?.result;
  if (!src || !dst || !res || res.ignoresModifiers) return;
  if (barrierLeft(s) > 0 && s.alive) {
    const orbs = (t: number) => teamOrbs(battle, t);
    if (src.teamId === s.teamId && dst.teamId !== s.teamId) res.final *= 1 + SHIRANUI.dmg + SHIRANUI.perOrb * orbs(s.teamId);
    if (dst.teamId === s.teamId && src.teamId !== s.teamId) res.final *= Math.max(0, 1 - SHIRANUI.dr - SHIRANUI.perOrb * orbs(s.teamId));
  }
  // L2: the extra basic attack ignores 200 DEF.
  const ex = extra.get(battle);
  if (ex && ex.actor === src.id && ex.target === dst.id && res.type === DamageType.NORMAL) {
    const old = res.defenseMultiplier, def = Math.max(0, dst.prop("def"));
    if (!(old > 0) || old >= 1) return;
    const next = 300 / (300 + Math.max(0, def - SHIRANUI.extraIgnoreDef));
    res.final *= next / old;
    res.defenseMultiplier = next;
  }
}

async function onAfterDamage(battle: any, ctx: any): Promise<void> {
  const ex = extra.get(battle);
  const src: Entity | undefined = ctx?.input?.source;
  if (!ex || !src || ex.actor !== src.id || ctx?.input?.target?.id !== ex.target) return;
  await applyLifesteal(battle, src, SHIRANUI.extraLifesteal, ctx.result, "星火满天·额外普攻");
}

// ───────────────────────── 离影 (dance) ─────────────────────────

const turnInfo = new WeakMap<object, { id: number; acted: boolean; basic: boolean }>();

async function onAllyTurnEnd(battle: any, s: Entity, ctx: any): Promise<void> {
  const a: Entity | undefined = ctx?.actor;
  const info = turnInfo.get(battle);
  if (!a || !info || info.id !== a.id) return;
  turnInfo.delete(battle);
  if (!s.alive || inSorrow(s) || !a.alive || a.teamId !== s.teamId || isSummonUnit(a) || !(info.basic || !info.acted)) return;
  const p = barrierUp(battle, s.teamId) ? SHIRANUI.danceChanceBarrier : SHIRANUI.danceChance;
  if (p < 1) { battle.rng.expect("shir330_dance"); if (!battle.rng.testHit(p)) return; }
  battle.trace.push({ t: "PASSIVE_PROC", actor: s.id, skill: "离影", effect: "起舞：" + (info.basic ? "普攻" : "无法动作") + " → +80%效果抵抗", chance: p, target: a.id });
  battle.lose(s, s.hp * SHIRANUI.danceHpCost);
  for (const st of [...a.statuses]) if (st.def.id === DANCE_ID) a.expireStatus(st);
  const def = danceDef();
  const r = a.addStatus(def, s.id, 1, SHIRANUI.danceTurns, [{ prop: "efr", value: SHIRANUI.danceRes, mode: "FIXED" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: a.id, status: DANCE_ID, name: def.name, category: def.category, duration: 1, ref: DANCE_ID, known: true, tag: (r as any)?.tag ?? null, skill: "离影" });
}

// ───────────────────────── 离殇 stance ─────────────────────────

function refreshSong(battle: any, s: Entity): void {
  if (!inSorrow(s)) return;
  const orbs = teamOrbs(battle, s.teamId);
  s.removeModifiersBySource(SONG_SRC);
  s.addModifier({ prop: "spd", value: SHIRANUI.songSpd + SHIRANUI.songSpdPerOrb * orbs, mode: "FIXED", source: SONG_SRC + ":spd" });
  s.addModifier({ prop: "efr", value: SHIRANUI.songRes + SHIRANUI.songResPerOrb * orbs, mode: "FIXED", source: SONG_SRC + ":efr" });
}

/** 离火: true when the target already bore it (consumed ⇒ this attack deals double). */
function consumeFire(battle: any, s: Entity, v: Entity, skill: string): boolean {
  const st = v.statuses.find(x => x.def.id === FIRE_ID && x.sourceId === s.id);
  if (!st) return false;
  v.expireStatus(st);
  battle.trace.push({ t: "STACKS_CONSUMED", id: v.id, status: FIRE_ID, name: "离火", from: 1, to: 0, reason: "DOUBLE_DAMAGE", skill });
  return true;
}
function putFire(battle: any, s: Entity, v: Entity, skill: string): void {
  if (!v.alive || v.statuses.some(x => x.def.id === FIRE_ID && x.sourceId === s.id)) return;
  const def = fireDef();
  const r = v.addStatus(def, s.id, 1, PERSIST, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: v.id, status: FIRE_ID, name: def.name, category: def.category, duration: PERSIST, ref: FIRE_ID, known: true, tag: (r as any)?.tag ?? null, skill });
}

/** One attack of hers in 离殇: double on 离火 bearers (consumed), then 离火 on the targets. */
async function sorrowStrike(battle: any, s: Entity, targets: Entity[], name: string, ratio: number, hits: number): Promise<void> {
  const doubled = new Set(targets.filter(v => consumeFire(battle, s, v, name)).map(v => v.id));
  for (let h = 0; h < hits; h++) {
    await battle.withinResolution({ id: "HIT:" + name + "#" + (h + 1), type: "HIT" }, async () => {
      for (const v of targets) if (v.alive) await battle.damage(s, v, s.prop("atk") * (ratio / 100), DamageType.NORMAL, doubled.has(v.id) ? 2 : 1, null);
    });
  }
  for (const v of targets) putFire(battle, s, v, name);
}

function finale(orig: any): any {
  const name = "终舞";
  const sk: any = {
    name, cost: 0, selectable: true, index: orig.index, aiProfile: orig.aiProfile, pickTarget: orig.pickTarget,
    ir: { id: "330_01s", sorrowOf: "330_01", charId: 330, name, cost: 0, hits: SHIRANUI.finaleHits, damage: [{ ratio: SHIRANUI.finaleRatio, type: DamageType.NORMAL, base: "atk" }] },
    execute: async (battle: any, self: Entity, target: Entity) => {
      self.usedSkills.add(name);
      const v = target?.alive && target.teamId !== self.teamId ? target : (battle.enemiesOf(self.teamId).find((e: Entity) => e.alive) ?? null);
      battle.trace.push({ t: "SKILL_CAST", actor: self.id, skill: name, cost: 0, target: v?.id ?? null, hits: SHIRANUI.finaleHits });
      if (v) await sorrowStrike(battle, self, [v], name, SHIRANUI.finaleRatio, SHIRANUI.finaleHits);
    },
  };
  return sk;
}

function song(orig: any): any {
  const name = "离歌";
  return {
    name, cost: -1, selectable: false, index: orig.index, aiProfile: orig.aiProfile, pickTarget: orig.pickTarget,
    ir: { id: "330_02s", sorrowOf: "330_02", charId: 330, name, cost: -1, damage: [] },
    execute: async () => { /* passive: run by refreshSong / the 烬染不夜 rider */ },
  };
}

function blaze(orig: any, basic: any): any {
  const name = "烬染不夜";
  const sk: any = {
    name, cost: SHIRANUI.blazeCost, selectable: true, index: orig.index, aiProfile: orig.aiProfile, pickTarget: basic?.pickTarget ?? orig.pickTarget,
    ir: { id: "330_03s", sorrowOf: "330_03", charId: 330, name, cost: SHIRANUI.blazeCost, damage: [{ ratio: SHIRANUI.blazeRatio, type: DamageType.NORMAL, base: "atk" }] },
    execute: async (battle: any, self: Entity, target: Entity, _ctx?: any, opts?: { free?: boolean }) => {
      self.usedSkills.add(name);
      const pay = blazeCost(battle, self);
      battle.trace.push({ t: "SKILL_CAST", actor: self.id, skill: name, cost: pay, target: target?.id ?? null, hits: 1 });
      if (!(await payOrFallback(battle, self, sk, pay, target, !!opts?.free))) return;
      const foes = (): Entity[] => battle.enemiesOf(self.teamId).filter((e: Entity) => e.alive);
      await sorrowStrike(battle, self, foes(), name, SHIRANUI.blazeRatio, 1);
      // 离歌 L5: 46% ATK per onibi held, after 烬染不夜.
      const orbs = teamOrbs(battle, self.teamId);
      if (orbs > 0 && self.alive && foes().length) {
        battle.trace.push({ t: "SKILL_FORM", actor: self.id, skill: "离歌", as: "烬染不夜后追加", strikes: 1, ratio: SHIRANUI.songBurstPerOrb * orbs });
        await sorrowStrike(battle, self, foes(), "离歌", SHIRANUI.songBurstPerOrb * orbs, 1);
      }
      refreshSong(battle, self);
    },
  };
  return sk;
}

const blazeCost = (battle: any, s: Entity): number => Math.max(0, SHIRANUI.blazeCost - koAllies(battle, s));

/** 离殇 swaps 初舞 / 离影 / 星火满天 → 终舞 / 离歌 / 烬染不夜 at the same indexes. Idempotent (note-driven). */
export function syncShiranuiTable(battle: any, s: Entity): void {
  if (!bettingActive() || !inSorrow(s) || (s.skills ?? []).some((x: any) => x?.ir?.sorrowOf)) return;
  const basic = skillById(s, "330_01");
  s.skills = s.skills.map((x: any) => x?.ir?.id === "330_01" ? finale(x) : x?.ir?.id === "330_02" ? song(x) : x?.ir?.id === "330_03" ? blaze(x, basic) : x);
  battle?.trace?.push({ t: "SKILL_TABLE_SWAP", id: s.id, form: "离殇", skills: s.skills.map((x: any) => x.name) });
}

function enterSorrow(battle: any, s: Entity, hook: any): void {
  if (hook?.target?.id !== s.id || hook.prevented || inSorrow(s)) return;
  hook.prevented = true;
  s.hpZero = false; s.alive = true; s.dead = false; s.hp = 0;
  setNote(s, N_STANCE, 1);
  for (const st of [...s.statuses]) s.expireStatus(st);
  battle.trace.push({ t: "STATE_SWITCH", id: s.id, state: "离殇", skill: "离影", reason: "LETHAL" });
  const m = s.mutateHp(HpMutation.RECOVER, s.maxHp, "recover");
  battle.trace.push({ t: "RECOVER", src: s.id, dst: s.id, amount: GameMath.display(m.applied), hpBefore: GameMath.display(m.hpBefore), hpAfter: GameMath.display(m.hpAfter), skill: "离殇" });
  const def = sorrowDef();
  const r = s.addStatus(def, s.id, 1, PERSIST, [{ prop: "cri", value: SHIRANUI.sorrowCrit, mode: "FIXED" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: s.id, status: SORROW_ID, name: def.name, category: def.category, duration: PERSIST, ref: SORROW_ID, known: true, tag: (r as any)?.tag ?? null, skill: "离影" });
  syncShiranuiTable(battle, s);
  refreshSong(battle, s);
}

async function sorrowTurnEnd(battle: any, s: Entity, ctx: any): Promise<void> {
  if (!s.alive || !inSorrow(s) || !ctx?.actor) return;
  if (ctx.actor.id === s.id) scaleMaxHp(battle, s, -SHIRANUI.sorrowMaxHpLoss, "离殇");
  const lost = s.maxHp - s.hp;
  if (lost > 1e-9) {
    const m = s.mutateHp(HpMutation.RECOVER, lost * SHIRANUI.sorrowRegen, "recover");
    battle.trace.push({ t: "RECOVER", src: s.id, dst: s.id, amount: GameMath.display(m.applied), hpBefore: GameMath.display(m.hpBefore), hpAfter: GameMath.display(m.hpAfter), skill: "离殇" });
  }
  refreshSong(battle, s);
}

// ───────────────────────── hooks ─────────────────────────

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isShiranui330(self)) return null;
  syncShiranuiTable(battle, self);
  const canPay = (sk: any) => { const c = costOf(sk); return !(c > 0) || battle.teams[self.teamId].orbs.canPay(c); };
  if (inSorrow(self)) {
    const b = skillById(self, "330_03s"), f = skillById(self, "330_01s");
    if (b && canPay(b)) return { skill: b, rule: "不知火: 离殇 → 烬染不夜 (鬼火足够)" };
    return f ? { skill: f, rule: "不知火: 离殇 → 终舞" } : null;
  }
  const star = skillById(self, "330_03"), basic = skillById(self, "330_01");
  if (star && barrierLeft(self) <= 0 && canPay(star)) return { skill: star, rule: "不知火: 没有结界 → 星火满天 (KB AI)" };
  return basic ? { skill: basic, rule: barrierLeft(self) > 0 ? "不知火: 结界中 → 初舞 (KB AI)" : "不知火: 鬼火不足 → 初舞" } : null;
}

function cost(battle: any, self: Entity, sk: any, base: number): number {
  if (!bettingActive() || (sk?.ir?.id ?? sk?.id) !== "330_03s") return base;
  return blazeCost(battle, self);
}

function gate(_battle: any, self: Entity, sk: any): string | null {
  const id = sk?.ir?.id;
  if (!bettingActive() || !isShiranui330(self) || (id !== "330_02" && id !== "330_02s")) return null;
  return "SHIRANUI_LIYING_NOT_CAST";
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "330_03" || !isShiranui330(self)) return false;
  openBarrier(battle, self, inOwnTurn(battle, self) ? SHIRANUI.barrierTurns + 1 : SHIRANUI.barrierTurns, "CAST");
  return true;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const s = entities.find(isShiranui330);   // 唯一效果
  if (!s) return out;
  let seq = 0;   // several handlers share an event code: the id carries a sequence number (registered once per battle)
  const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = false) =>
    registerOwnerHandler(battle, "betting:330:" + code + ":" + s.id + ":" + (seq++), s.id, code, fn, range, { passive });
  // L5 先机 (passive line of 星火满天). Opened when the first turn of the battle starts — after the action bar has
  // advanced to the first actor, not at t = 0 (match 8: the Upper Hand animations play just before Kaoru's first turn,
  // and the first-cycle order Kaoru 213 > Mannendake 205(+25) > Hitotsume > Momo > Vampira > Yuki 163(+25) > Shiranui
  // 135(+25) > Amaterasu 143 > Inaba > Kusa only fits a +25 SPD that starts at Kaoru's first turn: with +25 from t = 0
  // Mannendake (230) would act first and Yuki (188) before Hitotsume (184)).
  reg(EV.TURN_START, () => {
    if (noteValue(s, N_SENKI) !== null) return;
    setNote(s, N_SENKI, 1);
    if (barrierLeft(s) > 0 || !s.alive) return;
    battle.trace.push({ t: "SUBCAST", actor: s.id, ref: "330_03", skill: "星火满天", target: s.id, clause: "[tips_7]先机：施放『星火满天』" });
    openBarrier(battle, s, SHIRANUI.barrierTurns, "SENKI");
  }, "ALL", true);
  // 离影 tracking (passive): own turns of allies; dance at their turn end. Registered before the barrier countdown.
  reg(EV.TURN_START, (ctx: any) => {
    const a: Entity | undefined = ctx?.actor;
    if (a && a.teamId === s.teamId && !isSummonUnit(a) && isOwnTurnType(ctx.type)) turnInfo.set(battle, { id: a.id, acted: false, basic: false });
    const up = barrierUp(battle, s.teamId);
    if (up && a && a.teamId === s.teamId) grantBarrierStatus(battle, s, a);
    refreshSong(battle, s);
  }, "ALL", true);
  reg(EV.SKILL_END, (ctx: any) => {
    const info = turnInfo.get(battle);
    if (info && ctx?.actor?.id === info.id && isOwnTurnType(ctx.type)) { info.acted = true; info.basic = info.basic || isNormalAttack(ctx.skill); }
  }, "ALL", true);
  reg(EV.TURN_END, (ctx: any) => onAllyTurnEnd(battle, s, ctx), "ALL", true);
  // Barrier (active skill): countdown on her turns, damage bonus / reduction, extra basic attacks.
  reg(EV.TURN_END, (ctx: any) => {
    if (ctx?.actor?.id !== s.id || barrierLeft(s) <= 0) return;
    const left = barrierLeft(s) - 1;
    if (left <= 0) closeBarrier(battle, s, "DURATION"); else setNote(s, N_LEFT, left);
  }, "SELF");
  reg(EV.BEFORE_DAMAGE, (ctx: any) => onBeforeDamage(battle, s, ctx));
  reg(EV.AFTER_DAMAGE, (ctx: any) => onAfterDamage(battle, ctx));
  reg(EV.SKILL_END, (ctx: any) => extraAttack(battle, s, ctx));
  reg(EV.DEATH, (ctx: any) => { if (ctx?.target?.id === s.id && barrierLeft(s) > 0) closeBarrier(battle, s, "OWNER_DEFEATED"); }, "SELF");
  // 离殇 (evolution effect: passive) and the stance mark's own turn-end rules.
  reg(EV.DEATH_PREVENTION, (hook: any) => enterSorrow(battle, s, hook), "SELF", true);
  reg(EV.TURN_END, (ctx: any) => sorrowTurnEnd(battle, s, ctx), "ALL", false);
  reg(EV.ORB_GAIN, () => refreshSong(battle, s));
  reg(EV.ORB_COST, () => refreshSong(battle, s));
  out.push({ entityId: s.id, mechanic: "星火满天 先机 / 结界 (+dmg, +SPD, DR, per-onibi, extra basic) · 离影 dance · 离殇 stance (终舞 / 离歌 / 烬染不夜)" });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "330_02": { note: "离影: the dance, the RES buff and 离殇 are run by betting-shiranui.ts (the active part is never cast)", patch: { statusRefConditionOnly: [0] } },
    "330_03": { note: "星火满天: the Sparkfire Barrier (auras, extra basic attacks, 先机) is run by betting-shiranui.ts", patch: { field: null } },
  }),
  cost,
  ruleSkill,
  gate,
  afterCast,
  install,
};

