// compile/betting-seawatch.ts — 聆海金鱼姬 (SP 346, Global "Seawatch Kingyo") at max skill level. MAX mode only (match 10).
// A different shikigami from 金鱼姬 282 (goldfish summon, betting-mechanics.ts): no goldfish, no shared mechanics.
//
// Sources: data/kb/shikigami.json 346_01..346_03, buffs 3461_1 结怨 / 3462_1 凝神 / 3464_1 灵鱼盾, tips_6006 浪涌 /
// tips_17 无法动作 / tips_7 / tips_11; data/kb/ai.json; data/kb/en-text.json (Global). Before this module 灵鱼抱蕊 was
// cast on an ALLY (heal 50% ATK + a 10% pull on herself) and nothing else of her kit ran: no shield, no 凝神, no 鱼尾之簇,
// no 浪涌 (she dealt ~450 damage per battle).
//   川流 (346_01)       · 100% ATK + dispel 1 buff (generic). Passive part: an ally taking a single enemy hit above 30%
//                        of its max HP ⇒ the source gets 3 结怨 for 2 turns.
//   凌波 (346_02)       · after each enemy turn: +1 凝神 (cap 8) and, without a 灵鱼盾, a 灵鱼盾 of 80% ATK (cannot be
//                        dispelled). 先机: 4 凝神. At 8 凝神: all consumed, her controls are removed and 鱼尾之簇 opens
//                        for 1 turn (already open: all allies +25% bar). 川流之缚 (2 turns on every enemy) has no text in
//                        the data: not modelled.
//   灵鱼抱蕊 (346_03, 2) · 唯一. 3 结怨 on the enemy target, opens 鱼尾之簇 for 1 turn: all allies +10% bar, +1 浪涌 (cap 3).
//                        While open: an enemy's action-bar boost ⇒ +1 浪涌; after each ally's turn, if she can act, that
//                        ally is healed 50% ATK (L4: ×3 at ≤50% HP; heals can crit) and 浪涌 triggers.
//                        L3: allies take 30% less non-crit damage, she 30% more less (60%).
//   浪涌 (tips_6006)    · per stack, 50% ATK indirect damage to a random enemy (different enemies first); +3% per trigger,
//                        at most 80%. A 结怨 bearer is struck first for 150% (L2) and loses 1 结怨.
//   AI (KB)            · ≥2 allies alive → 灵鱼抱蕊 on an enemy without 结怨; otherwise the normal attack.
// Readings (unverified): "1 turn" of 鱼尾之簇 = until the end of her next turn; 浪涌 stacks persist while the cluster is
// open until a recast opens a new cluster (count restarts at 1); a "single-target" boost = the only enemy boosted in that
// action; 结怨 lands without a resist roll.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler,
  stacksOn, setStackedStatus, shiftBar, grantTimedShield, ensureShieldTicker, controlsOn, clearControls, PERSIST,
} from "./betting-shared.ts";
import { inOwnTurn } from "./betting-scope.ts";
import { onBarIncrease } from "./betting-bar.ts";

export const SEAWATCH = Object.freeze({
  focusCap: 8, focusOpen: 4, shield: 0.8, grudge: 3, grudgeTurns: 2, bigHit: 0.3, openBar: 0.1, fullBar: 0.25,
  surgeCap: 3, surgeBase: 0.5, surgeStep: 0.03, surgeMax: 0.8, grudgeRatio: 1.5, heal: 0.5, lowHp: 0.5, lowHealX: 3,
  allyCut: 0.3, selfCut: 0.6,
});
export const GRUDGE_ID = "3461_1";
export const FOCUS_ID = "3462_1";
const SHIELD_TAG = "seawatch346";
const N_TURNS = "sea346:turns=", N_CLOSE = "sea346:closeAt=", N_SURGE = "sea346:surge=", N_TRIG = "sea346:trig=";

const grudgeDef = () => markDef({ id: GRUDGE_ID, name: "结怨", category: StatusCategory.DEBUFF_MARK, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【减益、印记】上限3层。鱼尾之簇中浪涌会优先攻击携带者，造成聆海金鱼姬攻击100%的伤害并消耗1层结怨。" }, StatusBook);
const focusDef = () => markDef({ id: FOCUS_ID, name: "凝神", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】上限8层。当达到上限时，消耗全部层数，解除自身所有控制效果，为敌方全体施加持续2回合的川流之缚并开启持续1回合的鱼尾之簇，若鱼尾之簇已开启则改为提升友方全体25%行动条。" }, StatusBook);

export const isSeawatch346 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "346_02") && !!skillById(e, "346_03");
const num = (e: Entity, k: string): number => Number(noteValue(e, k) ?? 0);
export const clusterOpen = (k: Entity): boolean => k.alive && noteValue(k, N_CLOSE) !== null;
export const surgeOf = (k: Entity): number => num(k, N_SURGE);
const grudgeOn = (v: Entity): number => v.statuses.filter(s => s.def.id === GRUDGE_ID).reduce((n, s) => n + s.stacks, 0);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const allies = (battle: any, e: Entity): Entity[] => (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive);
const battles = new WeakMap<object, any>();
const opened = new WeakSet<object>();

function addGrudge(battle: any, k: Entity, v: Entity, n: number, skill: string): void {
  if (!v?.alive || v.teamId === k.teamId) return;
  const after = setStackedStatus(v, grudgeDef(), stacksOn(v, GRUDGE_ID, k.id) + n, SEAWATCH.grudge, k.id, [], SEAWATCH.grudgeTurns);
  battle.trace.push({ t: "STATUS_APPLY", src: k.id, dst: v.id, status: GRUDGE_ID, name: "结怨", category: StatusCategory.DEBUFF_MARK, duration: SEAWATCH.grudgeTurns, ref: GRUDGE_ID, known: true, stacks: after, threshold: SEAWATCH.grudge, skill });
}
function addSurge(battle: any, k: Entity, n: number, reason: string): void {
  const before = surgeOf(k), after = Math.min(SEAWATCH.surgeCap, before + n);
  setNote(k, N_SURGE, after);
  battle.trace.push({ t: "STACKS_GAINED", id: k.id, status: "tips_6006", name: "浪涌", from: before, to: after, reason, skill: "灵鱼抱蕊" });
}

/** Opens (or, on a recast, re-opens: fresh duration) 鱼尾之簇. The 凝神 cap only bars the team when it is already open. */
function openCluster(battle: any, k: Entity, reason: string): void {
  if (reason === "FOCUS_CAP" && clusterOpen(k)) {
    for (const a of allies(battle, k)) shiftBar(battle, a, SEAWATCH.fullBar, "凝神");
    return;
  }
  setNote(k, N_CLOSE, num(k, N_TURNS) + (inOwnTurn(battle, k) ? 2 : 1));
  setNote(k, N_SURGE, 0);   // a new cluster: its 浪涌 count starts again
  battle.trace.push({ t: "FIELD_OPEN", owner: k.id, name: "鱼尾之簇", skill: "灵鱼抱蕊", reason });
  for (const a of allies(battle, k)) shiftBar(battle, a, SEAWATCH.openBar, "灵鱼抱蕊");
  addSurge(battle, k, 1, "OPEN");
}
function closeCluster(battle: any, k: Entity, reason: string): void {
  if (noteValue(k, N_CLOSE) === null) return;
  setNote(k, N_CLOSE, null);
  setNote(k, N_SURGE, 0);
  battle.trace.push({ t: "FIELD_CLOSE", owner: k.id, name: "鱼尾之簇", reason });
}

async function surge(battle: any, k: Entity): Promise<void> {
  const n = surgeOf(k);
  const hit = new Set<number>();
  for (let i = 0; i < n && k.alive; i++) {
    const foes = aliveEnemies(battle, k);
    if (!foes.length) return;
    const trig = num(k, N_TRIG);
    setNote(k, N_TRIG, trig + 1);
    const coef = Math.min(SEAWATCH.surgeMax, SEAWATCH.surgeBase + SEAWATCH.surgeStep * trig);
    const grudged = foes.filter(v => grudgeOn(v) > 0);
    let v: Entity;
    let ratio = coef;
    if (grudged.length) {
      v = grudged[0];
      ratio = SEAWATCH.grudgeRatio;
      const st = v.statuses.find(s => s.def.id === GRUDGE_ID)!;
      setStackedStatus(v, grudgeDef(), st.stacks - 1, SEAWATCH.grudge, st.sourceId, [], st.remaining);
    } else {
      const fresh = foes.filter(f => !hit.has(f.id));
      const pool = fresh.length ? fresh : foes;
      battle.rng.expect("seawatch346_surge#" + (i + 1));
      v = pool.length > 1 ? (battle.rng.pick(pool) ?? pool[0]) : pool[0];
    }
    hit.add(v.id);
    battle.trace.push({ t: "SUBSKILL", actor: k.id, skill: "灵鱼抱蕊", form: "浪涌", target: v.id, ratio });
    await dealDamage(battle, { source: k, target: v, base: k.prop("atk") * ratio, rate: 1, type: DamageType.INDIRECT, skillTag: "betting-346:surge" });
  }
}

async function onAllyTurnEnd(battle: any, k: Entity, a: Entity): Promise<void> {
  if (!clusterOpen(k) || controlsOn(k).length) return;
  if (a.alive) {
    const amt = k.prop("atk") * SEAWATCH.heal * (a.hp <= a.maxHp * SEAWATCH.lowHp ? SEAWATCH.lowHealX : 1);
    await battle.heal(k, a, amt, { crit: true });
  }
  await surge(battle, k);
}

function onEnemyTurnEnd(battle: any, k: Entity): void {
  const after = setStackedStatus(k, focusDef(), stacksOn(k, FOCUS_ID, k.id) + 1, SEAWATCH.focusCap, k.id, []);
  const hasShield = ((k.shields ?? []) as any[]).some(s => !s.broken && String(s.id ?? "").includes(SHIELD_TAG) && Number(s.value) > 0);
  if (!hasShield) grantTimedShield(battle, k, k, k.prop("atk") * SEAWATCH.shield, PERSIST, { tag: SHIELD_TAG, skill: "凌波", reason: "ENEMY_TURN_END", base: "atk", ratio: SEAWATCH.shield, dispellable: false });
  if (after >= SEAWATCH.focusCap) {
    setStackedStatus(k, focusDef(), 0, SEAWATCH.focusCap, k.id, []);
    battle.trace.push({ t: "STACKS_CONSUMED", id: k.id, status: FOCUS_ID, name: "凝神", from: after, to: 0, reason: "CAP", skill: "凌波" });
    clearControls(battle, k, k, "凌波");
    openCluster(battle, k, "FOCUS_CAP");
  }
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isSeawatch346(self)) return null;
  const bud = skillById(self, "346_03"), basic = skillById(self, "346_01");
  const c = bud ? costOf(bud) : 0;
  if (bud && allies(battle, self).filter(m => !isSummonUnit(m)).length >= 2 && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c)))
    return { skill: bud, rule: "聆海金鱼姬: 友方剩余单位≥2 → 灵鱼抱蕊 (KB AI)" };
  return basic ? { skill: basic, rule: "聆海金鱼姬: 普攻 (KB AI / 鬼火不足)" } : null;
}

function target(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || !isSeawatch346(self) || x?.id !== "346_03") return null;
  const battle = battles.get(self);
  const foes = battle ? aliveEnemies(battle, self) : cands.filter(v => v.alive && v.teamId !== self.teamId);
  const t = foes.find(v => grudgeOn(v) === 0) ?? foes[0];
  return t ? { target: t, rule: "聆海金鱼姬: 灵鱼抱蕊优先选择没有结怨的敌方单位 (KB AI)" } : null;
}

function afterCast(battle: any, self: Entity, x: any, ): boolean {
  if (!bettingActive() || !isSeawatch346(self) || x?.id !== "346_03") return false;
  const foes = aliveEnemies(battle, self);
  const t = foes.find(v => grudgeOn(v) === 0) ?? foes[0];
  if (t) addGrudge(battle, self, t, SEAWATCH.grudge, x.name);
  openCluster(battle, self, "CAST");
  return true;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isSeawatch346);
  if (!units.length) return out;
  ensureShieldTicker(battle);
  for (const k of units) {
    battles.set(k, battle);
    registerOwnerHandler(battle, "betting:346:turn-end:" + k.id, k.id, EV.TURN_END, async (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a) return;
      if (a.id === k.id) {
        setNote(k, N_TURNS, num(k, N_TURNS) + 1);
      }
      if (a.teamId === k.teamId) await onAllyTurnEnd(battle, k, a);
      else if (!isSummonUnit(a)) onEnemyTurnEnd(battle, k);
      if (a.id === k.id && noteValue(k, N_CLOSE) !== null && num(k, N_TURNS) >= num(k, N_CLOSE)) closeCluster(battle, k, "DURATION");
    }, "ALL", { passive: false });
    // 川流 passive part: a big hit on an ally ⇒ 3 结怨 on the source.
    registerOwnerHandler(battle, "betting:346:big-hit:" + k.id, k.id, EV.AFTER_DAMAGE, (ctx: any) => {
      const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
      if (!src || !dst || dst.teamId !== k.teamId || src.teamId === k.teamId || !src.alive) return;
      const dealt = Number(ctx?.result?.applied ?? 0) + Number(ctx?.result?.absorbed ?? 0);
      if (dealt > dst.maxHp * SEAWATCH.bigHit) addGrudge(battle, k, src, SEAWATCH.grudge, "川流");
    }, "ALL");
    registerOwnerHandler(battle, "betting:346:death:" + k.id, k.id, EV.DEATH, (ctx: any) => { if (ctx?.target?.id === k.id) closeCluster(battle, k, "DEATH"); }, "ALL", { passive: false });
    // A single-target bar boost on an enemy: one boosted enemy in the whole action (team boosts do not count).
    const boosted = new Set<number>();
    onBarIncrease(battle, "seawatch346:" + k.id, (v: Entity, percent: number) => {
      if (clusterOpen(k) && v.teamId !== k.teamId && percent > 0) boosted.add(v.id);
    });
    ensureGlobalHandler(battle, "betting:346:bar-settle:" + k.id, EV.ACTION_END, () => {
      if (boosted.size === 1 && clusterOpen(k)) addSurge(battle, k, 1, "ENEMY_BAR_UP");
      boosted.clear();
    });
    out.push({ entityId: k.id, mechanic: "凌波 (80% ATK shield, 凝神, 先机 4) · 鱼尾之簇 (heals, 浪涌 surges, damage cuts, bar) · 结怨 · KB AI" });
  }
  // L3: damage cuts while the cluster is open (non-crit only).
  ensureGlobalHandler(battle, "betting:346:cuts", EV.BEFORE_DAMAGE, (ctx: any) => {
    const res = ctx?.result, v: Entity | undefined = ctx?.input?.target, src: Entity | undefined = ctx?.input?.source;
    if (!res || !v || ctx.cancelled || !(res.final > 0) || res.isCrit || (src && src.teamId === v.teamId)) return;
    const k = units.find(u => u.teamId === v.teamId && clusterOpen(u));
    if (!k) return;
    res.final *= 1 - (v.id === k.id ? SEAWATCH.selfCut : SEAWATCH.allyCut);
  });
  ensureGlobalHandler(battle, "betting:346:start", EV.BATTLE_START, () => {
    if (opened.has(battle)) return;
    opened.add(battle);
    for (const k of units) if (k.alive) setStackedStatus(k, focusDef(), SEAWATCH.focusOpen, SEAWATCH.focusCap, k.id, []);
  });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "346_01": { note: "川流: the 结怨 passive part is run by betting-seawatch.ts", patch: { statusRefConditionOnly: [0] } },
    "346_03": { note: "灵鱼抱蕊: enemy target; 结怨, 鱼尾之簇, heals and 浪涌 are run by betting-seawatch.ts", patch: { heal: [], timeline: [], targeting: ["敌方目标"] } },
  }),
  ruleSkill,
  target,
  afterCast,
  install,
};
