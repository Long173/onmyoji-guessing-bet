// compile/betting-hakuzosu.ts — 梦山白藏主 (SP 595, Global "Hakuzosu Unbound") at max skill level. MAX mode only (match 10).
//
// Sources: data/kb/shikigami.json 595_01..595_03, buffs 5951_1 守护之印 / 5952_1 符咒·破, tips_7 先机 / tips_11;
// data/kb/ai.json (KB AI rows); data/kb/en-text.json (Global). Fandom / bilibili gave no text for 『梦山誓』 (2026-11-24).
// Before this module she cast 白狐咒 on HERSELF every turn: the IR read "自身外的指定友方" as self-targeting, the
// Onmyoji's 30% bar as a 30% pull on herself, and nothing of the seal's riders ran (5951_1 only names Onmyoji spells).
//   白狐咒 (595_02, 1)  · 唯一. An ally other than herself (the highest-ATK ally, as the L5 Initiative picks) recovers 20%
//                        of its lost HP and gets 守护之印 for 2 of its turns (at most one on her side: the old one goes).
//                        The Onmyoji bar / Seimei riders do nothing (no Onmyoji in duel betting).
//                        L2: the bearer is immune to damage during its own turn. L4: when an enemy attacks the bearer
//                        (direct damage), that attacker gets 符咒·破 for 2 turns (contested; once per enemy action).
//                        L5 先机: 守护之印 on the highest-ATK ally shikigami at battle start.
//   符咒·破 (5952_1)    · damage dealt −30%; at the bearer's turn start indirect damage of 8% of HER max HP.
//   斩梦刀 (595_03)     · only with an allied Seimei; otherwise replaced by 『梦山誓』, whose text is not in the KB or
//                        Global data. Never cast here (gated); she normal-attacks instead.
//   AI (KB)            · no ally holds 守护之印 → 白狐咒; otherwise skill 3 (梦山誓: not modelled → 驭我之名).
// Doubts: 梦山誓 is missing entirely (its voice line "先过小白这一关！" hints at a protective / taunt skill);
// "行动时" is read as the bearer's own turn (its counters outside its turn are not covered).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, applyContested, atkForTargeting, STATUS_TICK_TAG,
} from "./betting-shared.ts";
import { inOwnTurn } from "./betting-scope.ts";

export const HAKUZOSU = Object.freeze({ lostHeal: 0.2, sealTurns: 2, breakTurns: 2, breakDealt: -0.3, breakTick: 0.08 });
export const SEAL_ID = "5951_1";
export const BREAK_ID = "5952_1";

const sealDef = () => markDef({ id: SEAL_ID, name: "守护之印", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN",
  desc: "【增益、印记】友方场上至多存在1个。携带者行动时免疫伤害；携带者受到敌方攻击时为攻击者施加符咒·破，持续2回合。（阴阳师相关效果在斗技竞猜中无效）" }, StatusBook);
const breakDef = () => markDef({ id: BREAK_ID, name: "符咒·破", category: StatusCategory.DEBUFF_MARK, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【减益、印记】造成伤害降低30%，回合开始时受到梦山白藏主生命上限8%间接伤害。" }, StatusBook);

export const isHakuzosu595 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "595_02") && !!skillById(e, "595_03");
const allies = (battle: any, e: Entity): Entity[] => (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m));
const entity = (battle: any, id: number): Entity | null => battle.allEntities().find((x: Entity) => x.id === id) ?? null;
const battles = new WeakMap<object, any>();
const castTarget = new WeakMap<object, Entity>();
const opened = new WeakSet<object>();

function highestAtkOther(battle: any, e: Entity, includeSelf: boolean): Entity | null {
  const pool = allies(battle, e).filter(m => includeSelf || m.id !== e.id);
  return pool.reduce<Entity | null>((a, b) => (!a || atkForTargeting(b) > atkForTargeting(a) ? b : a), null);
}
const sealOnSide = (battle: any, e: Entity): Entity | null =>
  (battle.teams[e.teamId].members as Entity[]).find(m => m.alive && m.statuses.some(s => s.def.id === SEAL_ID)) ?? null;

function putSeal(battle: any, h: Entity, t: Entity, skill: string): void {
  for (const m of battle.teams[h.teamId].members as Entity[]) for (const st of [...m.statuses]) if (st.def.id === SEAL_ID) m.expireStatus(st);
  const def = sealDef();
  const a = t.addStatus(def, h.id, 1, HAKUZOSU.sealTurns, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: h.id, dst: t.id, status: SEAL_ID, name: def.name, category: def.category, duration: HAKUZOSU.sealTurns, ref: SEAL_ID, known: true, tag: (a as any)?.tag ?? null, skill });
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isHakuzosu595(self)) return null;
  const curse = skillById(self, "595_02"), basic = skillById(self, "595_01");
  const c = curse ? costOf(curse) : 0;
  if (curse && !sealOnSide(battle, self) && highestAtkOther(battle, self, false) && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c)))
    return { skill: curse, rule: "梦山白藏主: 友方无守护之印 → 白狐咒 (KB AI)" };
  return basic ? { skill: basic, rule: "梦山白藏主: 守护之印已在场 → 3技能『梦山誓』未建模 → 驭我之名" } : null;
}

function gate(_battle: any, self: Entity, sk: any): string | null {
  if (!bettingActive() || !isHakuzosu595(self)) return null;
  return (sk?.ir ?? sk)?.id === "595_03" ? "NO_SEIMEI (梦山誓 not modelled)" : null;
}

function target(self: Entity, x: any, _cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || !isHakuzosu595(self) || x?.id !== "595_02") return null;
  const battle = battles.get(self);
  const t = battle ? highestAtkOther(battle, self, false) : null;
  if (!t) return null;
  castTarget.set(self, t);
  return { target: t, rule: "梦山白藏主: 白狐咒 → 自身外攻击最高的友方" };
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isHakuzosu595(self) || x?.id !== "595_02") return false;
  const picked = castTarget.get(self);
  castTarget.delete(self);
  const t = picked?.alive && picked.id !== self.id ? picked : highestAtkOther(battle, self, false);
  if (!t) return true;
  const lost = t.maxHp - t.hp;
  if (lost > 0) await battle.heal(self, t, lost * HAKUZOSU.lostHeal, { recover: true });
  putSeal(battle, self, t, x.name);
  return true;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isHakuzosu595);
  if (!units.length) return out;
  for (const h of units) {
    battles.set(h, battle);
    // L4: the seal bearer's attacker gets 符咒·破 (once per enemy action).
    const hitBy = new Set<number>();
    registerOwnerHandler(battle, "betting:595:break:" + h.id, h.id, EV.DAMAGE, async (ctx: any) => {
      const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
      if (!src || !dst || src.teamId === h.teamId || dst.teamId !== h.teamId || !src.alive || ctx?.result?.type === DamageType.INDIRECT) return;
      if (!dst.statuses.some(s => s.def.id === SEAL_ID && s.sourceId === h.id) || hitBy.has(src.id)) return;
      hitBy.add(src.id);
      for (const st of [...src.statuses]) if (st.def.id === BREAK_ID) src.expireStatus(st);
      await applyContested(battle, h, src, breakDef(), null, HAKUZOSU.breakTurns, [{ prop: "dmgDealtB", value: HAKUZOSU.breakDealt, mode: "FIXED" }], { skill: "白狐咒", ref: BREAK_ID });
    }, "ALL");
    ensureGlobalHandler(battle, "betting:595:break-reset:" + h.id, EV.ACTION_END, () => hitBy.clear());
    out.push({ entityId: h.id, mechanic: "白狐咒 (ally other than self, 20% lost HP, 守护之印: own-turn damage immunity, 符咒·破 on attackers) · 先机 seal · KB AI (梦山誓 not modelled)" });
  }
  // L2: the bearer is immune to damage during its own turn.
  ensureGlobalHandler(battle, "betting:595:seal-immune", EV.BEFORE_DAMAGE, (ctx: any) => {
    const res = ctx?.result, v: Entity | undefined = ctx?.input?.target, src: Entity | undefined = ctx?.input?.source;
    if (!res || !v || ctx.cancelled || !(res.final > 0) || !v.statuses.some(s => s.def.id === SEAL_ID) || !inOwnTurn(battle, v)) return;
    ctx.cancelled = true;
    battle.trace.push({ t: "IMMUNE", src: src?.id ?? null, dst: v.id, by: SEAL_ID, name: "守护之印", kind: "DAMAGE", damage: GameMath.display(res.final), consumed: false, skill: "白狐咒" });
  });
  // 符咒·破 tick (outlives her: the status keeps its source).
  ensureGlobalHandler(battle, "betting:595:break-tick", EV.TURN_START, async (ctx: any) => {
    const v: Entity | undefined = ctx?.actor;
    if (!v?.alive) return;
    for (const st of v.statuses.filter(s => s.def.id === BREAK_ID)) {
      const h = entity(battle, st.sourceId);
      if (h) await dealDamage(battle, { source: h, target: v, base: h.maxHp * HAKUZOSU.breakTick, rate: 1, type: DamageType.INDIRECT, skillTag: STATUS_TICK_TAG + "595" });
    }
  });
  // L5 先机: the seal on the highest-ATK ally shikigami.
  ensureGlobalHandler(battle, "betting:595:start", EV.BATTLE_START, () => {
    if (opened.has(battle)) return;
    opened.add(battle);
    const seen = new Set<number>();
    for (const h of units) {
      if (!h.alive || seen.has(h.teamId)) continue;   // 唯一效果
      seen.add(h.teamId);
      const t = highestAtkOther(battle, h, true);
      if (!t) continue;
      battle.trace.push({ t: "SUBCAST", actor: h.id, ref: "595_02", skill: "白狐咒", target: t.id, clause: "[tips_7]先机：为攻击最高的友方式神施加守护之印" });
      putSeal(battle, h, t, "白狐咒");
    }
  });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "595_02": { note: "白狐咒: an ally other than herself; heal, 守护之印 and its riders are run by betting-hakuzosu.ts (the 30% bar is the Onmyoji's)", patch: { statusRefConditionOnly: [0], timeline: [], purge: [], targeting: ["友方目标"] } },
  }),
  ruleSkill,
  gate,
  target,
  afterCast,
  install,
};
