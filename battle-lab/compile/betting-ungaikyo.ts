// compile/betting-ungaikyo.ts — 云外镜 (Ungaikyo, 344) at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 344_04 / 344_05 / 344_06, tips_3442 阴/阳, tips_3443 镜中世界, tips_3933 翻转,
// buffs 3442_1 镜盾 / 3444_1 镜佑; the user's in-game confirmation (never casts 344_05 斗转; in both forms it
// only uses skill 3 or the normal attack) and the batch-2 review numbers for the Yang skills (not in the KB).
//
//   Form at battle start (tips_3442): initial ATK > 500% of initial DEF ⇒ 阴 (Yin), otherwise 阳 (Yang).
//     The only stated switch is casting 斗转, which never happens ⇒ the form never changes afterwards.
//   Split HP pools (344_05 / tips_3442): Yin and Yang HP are complementary, each starts at half ⇒ the unit
//     starts at 50% HP and fights on the pool of its form (damage lowers it, the other pool grows unseen).
//   阴: ATK + 200% of initial DEF.   阳: DEF + 10% of initial ATK.
//   镜盾 (buff_3442_1) at battle start: shield of 680% DEF, 2 turns.
//   镜中世界 (tips_3443): cannot be healed; 50% of any heal becomes a shield for 2 turns.
//   Skill table (per entity, swapped at battle start):
//     阴: 落影 125% ATK / 云岸净空 145% ATK all enemies, then 145% Black Lotus on the target,
//         L5: +1 Black Lotus hit for every 30% of Yin HP ratio lost (counted from 100%).
//     阳: 昙无 = 360% DEF to one enemy, then +20% action bar to the ally at the front of the action bar;
//         苦海浮生 = 镜佑 on all allies, +20% action bar to all allies, 镜盾 (680% DEF) on self.
//         Cost of 苦海浮生 = 2 (match-5 replay: Red cast it with 2 onibi; the KB has no Yang text).
//         镜佑 persists until dispelled or replaced (no duration in the buff text).
//     昭回 (Yang replacement of 斗转, no KB text): 镜佑 on Ungaikyo himself at battle start. Replay evidence
//         (match 5, f1366–1378): before 苦海浮生 was ever cast (first at f1556), Hannya's barrier closed, its
//         仇恨蔓延 was resisted by three Red units and landed on Ungaikyo, who at once showed Dispel + Move Bar
//         Raised while Oitsuki was healed 6139.
//   镜佑 (buff_3444_1): when the bearer receives a debuff or control ⇒ dispel 1 of them and +10% action bar;
//     at most once per turn (per Ungaikyo); when it fires, heal the lowest HP-ratio ally for 480% of
//     Ungaikyo's DEF. Losing or re-gaining 镜佑 grants 镜盾.
//     · 480%, not the buff text's 240%: the replay heal is 6139 = 4.80 × 1279 (Yang DEF 891 + 10% of 3878 ATK);
//       240% would be 3070.
//     · The dispel is Ungaikyo's passive effect: it does not fire while he is 压制 (passive-suppressed, e.g.
//       inside Hannya's 封印结界). Replay: debuffs landed during barrier 1 and nothing was dispelled; the first
//       dispel came right as the barrier closed.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import {
  bettingActive, isSummonUnit, skillById, entityById, markDef, isDebuffOrControl, noteValue, setNote,
  grantTimedShield, payOrFallback, shiftBar, levelNumber, ensureGlobalHandler, ensureShieldTicker, registerOwnerHandler,
  PERSIST, passiveSuppressed,
} from "./betting-shared.ts";
import { bettingCostOf } from "./betting-senhime.ts";

export const UNGAIKYO = Object.freeze({
  yinThreshold: 5,          // tips_3442: 初始攻击高于初始防御的500% ⇒ 阴
  yinAtkFromDef: 2,         // tips_3442: 阴状态下额外增加初始防御200%的攻击
  yangDefFromAtk: 0.1,      // tips_3442: 阳状态下额外增加初始攻击10%的防御
  startHpRatio: 0.5,        // 344_05: 阴阳生命值初始各一半
  mirrorShieldDef: 6.8,     // buff_3442_1: 吸收云外镜防御680%伤害，持续2回合
  mirrorShieldTurns: 2,
  healToShield: 0.5,        // tips_3443: 治疗效果的50%转化为护盾，持续2回合
  healShieldTurns: 2,
  guardHealDef: 4.8,        // buff_3444_1 says 240%; match-5 replay 6139 = 480% of the Yang DEF (1279)
  guardPull: 0.1,           // buff_3444_1: 增加其10%行动条
  guardTurns: PERSIST,      // no duration in the buff text: until dispelled or replaced
  yangUltCost: 2,           // 苦海浮生 (match-5 replay: cast with 2 onibi)
  yangBasicDef: 3.6,        // 昙无 at max level (batch-2 review; not in the KB)
  yangBasicPull: 0.2,
  yangUltPull: 0.2,         // 苦海浮生 (batch-2 review; not in the KB)
  lotusStep: 0.3,           // 344_06 L5: 阴生命比例每降低30%
});

export type YinYang = "YIN" | "YANG";
const FORM_NOTE = "ungaikyo:form=";
const GUARD_NOTE = "ungaikyo:guard-turn=";
const GUARD_ID = "3444_1";

export const formOf = (e: Entity): YinYang | null => (noteValue(e, FORM_NOTE) as YinYang | null);
const isUngaikyo = (e: Entity): boolean => !isSummonUnit(e) && (!!skillById(e, "344_05") || !!skillById(e, "344_06") || !!skillById(e, "344_06y"));

const guardDef = () => markDef({ id: GUARD_ID, name: "镜佑", category: StatusCategory.BUFF_STATE, dispellable: true, removable: true,
  durationPolicy: "SOURCE_TURN",
  desc: "【增益、状态】受到减益效果或者控制效果时，立刻驱散1个减益状态或控制效果并增加其10%行动条；驱散效果每回合最多触发1次，触发时为当前生命比例最低的友方恢复云外镜防御240%的生命。失去或重复获得『镜佑』时，获得『镜盾』。" }, StatusBook);

/** The Ungaikyo that protects `teamId` (for 镜佑 / 镜盾 numbers). */
function ungaikyoOf(battle: any, teamId: number, preferId?: number): Entity | null {
  const pref = preferId === undefined ? null : entityById(battle, preferId);
  if (pref && formOf(pref)) return pref;
  return (battle.teams[teamId]?.members ?? []).find((m: Entity) => formOf(m) !== null) ?? null;
}

function mirrorShield(battle: any, src: Entity, dst: Entity, reason: string): void {
  grantTimedShield(battle, src, dst, UNGAIKYO.mirrorShieldDef * src.prop("def"), UNGAIKYO.mirrorShieldTurns,
    { tag: "3442", skill: "镜盾", reason, base: "def", ratio: UNGAIKYO.mirrorShieldDef * 100, dispellable: false });
}

// ───────────────────────── battle start: form, HP pools, 镜盾 ─────────────────────────

function setupForm(battle: any, e: Entity): void {
  if (formOf(e)) return;
  const atk0 = Number(e.base.atk ?? 0), def0 = Number(e.base.def ?? 0);
  const form: YinYang = atk0 > UNGAIKYO.yinThreshold * def0 ? "YIN" : "YANG";
  setNote(e, FORM_NOTE, form);
  e.hp = e.maxHp * UNGAIKYO.startHpRatio;
  if (form === "YIN") e.addModifier({ prop: "atk", value: UNGAIKYO.yinAtkFromDef * def0, mode: "FIXED", source: "betting:344:yin" });
  else e.addModifier({ prop: "def", value: UNGAIKYO.yangDefFromAtk * atk0, mode: "FIXED", source: "betting:344:yang" });
  e.caps.receivesHeal = false;
  battle.trace.push({
    t: "YINYANG_FORM", id: e.id, form, atk0, def0, threshold: UNGAIKYO.yinThreshold * def0,
    hp: GameMath.display(e.hp), otherHp: GameMath.display(e.maxHp - e.hp),
    atk: GameMath.display(e.prop("atk")), def: GameMath.display(e.prop("def")),
  });
  syncSkillTable(e, battle);
  mirrorShield(battle, e, e, "BATTLE_START");
  if (form === "YANG") {
    // 昭回 (Yang): 镜佑 on himself at battle start (match-5 replay; see the header).
    const def = guardDef();
    const a = e.addStatus(def, e.id, 1, UNGAIKYO.guardTurns, [], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: e.id, dst: e.id, status: GUARD_ID, name: def.name, category: def.category, duration: UNGAIKYO.guardTurns, ref: GUARD_ID, known: true, tag: a.tag, skill: "昭回" });
  }
}

// ───────────────────────── per-entity skill table ─────────────────────────

/**
 * Yang form swaps 落影 → 昙无 and 云岸净空 → 苦海浮生 at the same indexes (so the AI's "1技能 / 3技能"
 * and the basic-attack fallback keep working). Idempotent; derived from the saved form note, so a
 * restored battle re-swaps on the next AI decision.
 */
export function syncSkillTable(e: Entity, battle?: any): void {
  if (!bettingActive() || formOf(e) !== "YANG") return;
  if ((e.skills ?? []).some((s: any) => s?.ir?.yangOf)) return;
  e.skills = e.skills.map((s: any) => s?.ir?.id === "344_04" ? yangBasic(s) : s?.ir?.id === "344_06" ? yangUlt(s) : s);
  battle?.trace?.push({ t: "SKILL_TABLE_SWAP", id: e.id, form: "YANG", skills: e.skills.map((s: any) => s.name) });
}

function frontAlly(battle: any, self: Entity): Entity | null {
  const mates = battle.teams[self.teamId].aliveMembers().filter((m: Entity) => m.id !== self.id);
  return [...mates].sort((a: Entity, b: Entity) => (battle.timeline.get(b.id)?.pos ?? 0) - (battle.timeline.get(a.id)?.pos ?? 0) || a.id - b.id)[0] ?? null;
}

function yangBasic(orig: any): any {
  const name = "昙无";
  const sk: any = {
    name, cost: 0, selectable: true, index: orig.index, aiProfile: orig.aiProfile, pickTarget: orig.pickTarget,
    ir: { id: "344_04y", yangOf: "344_04", charId: 344, name, cost: 0, damage: [{ ratio: UNGAIKYO.yangBasicDef * 100, type: DamageType.NORMAL, base: "def" }] },
    execute: async (battle: any, self: Entity, target: Entity) => {
      self.usedSkills.add(name);
      const v = target?.alive && target.teamId !== self.teamId ? target : (battle.enemiesOf(self.teamId)[0] ?? target);
      battle.trace.push({ t: "SKILL_CAST", actor: self.id, skill: name, cost: 0, target: v?.id ?? null, hits: 1 });
      if (v?.alive) {
        await battle.withinResolution({ id: "HIT:" + name + "#1", type: "HIT" }, async () => {
          await battle.damage(self, v, self.prop("def") * UNGAIKYO.yangBasicDef, DamageType.NORMAL, 1, null);
        });
      }
      const ally = frontAlly(battle, self);
      if (ally && self.alive) shiftBar(battle, ally, UNGAIKYO.yangBasicPull, name);
    },
  };
  return sk;
}

function yangUlt(orig: any): any {
  const name = "苦海浮生";
  const cost = UNGAIKYO.yangUltCost;
  const sk: any = {
    name, cost, selectable: true, index: orig.index, aiProfile: orig.aiProfile, pickTarget: orig.pickTarget,
    ir: { id: "344_06y", yangOf: "344_06", charId: 344, name, cost, damage: [] },
    execute: async (battle: any, self: Entity, target: Entity, _ctx?: any, opts?: { free?: boolean }) => {
      self.usedSkills.add(name);
      const pay = bettingCostOf(battle, self, sk);
      battle.trace.push({ t: "SKILL_CAST", actor: self.id, skill: name, cost: pay, target: target?.id ?? self.id, hits: 1 });
      if (!(await payOrFallback(battle, self, sk, pay, target, !!opts?.free))) return;
      const allies: Entity[] = battle.teams[self.teamId].aliveMembers();
      const def = guardDef();
      for (const m of allies) {
        const regain = m.hasStatus(GUARD_ID);
        const a = m.addStatus(def, self.id, 1, UNGAIKYO.guardTurns, [], 1);
        battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: m.id, status: GUARD_ID, name: def.name, category: def.category, duration: UNGAIKYO.guardTurns, ref: GUARD_ID, known: true, tag: a.tag, skill: name });
        if (regain) mirrorShield(battle, self, m, "MIRROR_GUARD_REGAINED");
      }
      for (const m of allies) shiftBar(battle, m, UNGAIKYO.yangUltPull, name);
      mirrorShield(battle, self, self, "CAST:" + name);
    },
  };
  return sk;
}

// ───────────────────────── 云岸净空 (Yin): sweep, Black Lotus, L5 extra lotus ─────────────────────────

/** Extra Black Lotus hits at max level: one per 30% of Yin HP ratio lost (0 outside Yin form). */
export function extraLotusHits(self: Entity, x: any): number {
  if (formOf(self) !== "YIN") return 0;
  const step = levelNumber(x, /阴生命比例每降低(\d+)%/, null, 0) / 100;
  if (!(step > 0)) return 0;
  return GameMath.floorAt((1 - self.hp / self.maxHp) / step + 1e-9, "BLACK_LOTUS_EXTRA_HITS");
}

export function ungaikyoDamageHook(x: any): { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> } | null {
  if (x?.id !== "344_06" || !Array.isArray(x.damageSegments) || x.damageSegments.length < 2) return null;
  return {
    kind: "YIN_LOTUS",
    run: async (battle, self, hurt, primary) => {
      const [sweep, lotus] = x.damageSegments;
      const extra = extraLotusHits(self, x);
      const foes = (): Entity[] => battle.enemiesOf(self.teamId).filter((v: Entity) => v.alive);
      const first = primary?.alive && primary.teamId !== self.teamId ? primary : foes()[0];
      for (const v of [first, ...foes()]) if (v && !hurt.includes(v)) hurt.push(v);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        for (const v of hurt) if (v.alive) await battle.damage(self, v, self.prop("atk") * (Number(sweep.ratio) / 100), DamageType.NORMAL, 1, x.lifesteal ?? null);
      });
      if (extra > 0) battle.trace.push({ t: "BLACK_LOTUS_EXTRA", actor: self.id, skill: x.name, extra, yinHpRatio: GameMath.display(self.hp / self.maxHp) });
      for (let h = 0; h < 1 + extra; h++) {
        const alive = foes();
        if (!alive.length) break;
        // "天坠黑莲攻击敌方目标": the chosen target; if it fell, the AI's rule for skill 3 (highest absolute HP).
        const v = first?.alive ? first : alive.reduce((a, b) => (b.hp > a.hp ? b : a));
        await battle.withinResolution({ id: "HIT:" + x.name + "#lotus" + (h + 1), type: "HIT" }, async () => {
          await battle.damage(self, v, self.prop("atk") * (Number(lotus.ratio) / 100), DamageType.NORMAL, 1, x.lifesteal ?? null);
        });
      }
    },
  };
}

/** Gate for the AI (null = allowed). */
export function ungaikyoGate(sk: any): string | null {
  return sk?.ir?.id === "344_05" ? "NEVER_CAST (user-confirmed: 斗转 is never cast)" : null;
}

// ───────────────────────── 镜佑 / 镜中世界 ─────────────────────────

function onGuardStatusAdd(battle: any, ctx: any): void {
  const e: Entity | undefined = ctx?.entity;
  if (!e?.alive) return;
  const guard = e.statuses.find(s => s.def.id === GUARD_ID);
  if (!guard) return;
  const added = e.statuses.find(s => s.def.id === ctx.status);
  if (!added || !isDebuffOrControl(added.def)) return;
  const src = ungaikyoOf(battle, e.teamId, guard.sourceId);
  if (!src || passiveSuppressed(src)) return;                               // sealed by 压制 (replay, barrier 1)
  const turn = Number(battle.turn ?? 0);
  if (Number(noteValue(src, GUARD_NOTE) ?? -1) === turn) return;            // 每回合最多触发1次
  const pick = added.def.dispellable ? added : e.statuses.find(s => isDebuffOrControl(s.def) && s.def.dispellable);
  if (!pick || !e.dispel(pick.def.id)) return;
  setNote(src, GUARD_NOTE, turn);
  battle.trace.push({ t: "STATUS_REMOVE", id: e.id, status: pick.def.id, name: pick.def.name, by: "DISPEL", side: "ALLY", what: "DEBUFF", src: src.id, skill: "镜佑" });
  battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: e, status: pick.def.id, name: pick.def.name, by: "DISPEL", side: "ALLY", what: "DEBUFF", src: src.id, skill: "镜佑" }, e.id, e.teamId);
  shiftBar(battle, e, UNGAIKYO.guardPull, "镜佑");
  const low = (battle.teams[e.teamId].aliveMembers() as Entity[]).reduce<Entity | null>((a, b) => (!a || b.hp / b.maxHp < a.hp / a.maxHp ? b : a), null);
  // 恢复 (official [20] recover): no crit, no heal reduction (the replay heal is exactly 480% DEF).
  if (low) battle.heal(src, low, UNGAIKYO.guardHealDef * src.prop("def"), { recover: true });
}

function onGuardLost(battle: any, ctx: any): void {
  const e: Entity | undefined = ctx?.entity;
  if (ctx?.status !== GUARD_ID || !e?.alive) return;
  const src = ungaikyoOf(battle, e.teamId);
  if (src?.alive) mirrorShield(battle, src, e, "MIRROR_GUARD_LOST");
}

/** healTarget hook (kernel/damage.ts): Ungaikyo turns 50% of a blocked heal into a 2-turn shield. */
function onHealBlocked(battle: any, source: Entity, target: Entity, amount: number): void {
  if (!formOf(target) || !target.alive || !(amount > 0)) return;
  battle.trace.push({ t: "HEAL_TO_SHIELD", src: source.id, dst: target.id, heal: GameMath.display(amount), ratio: UNGAIKYO.healToShield, skill: "镜中世界" });
  grantTimedShield(battle, source, target, amount * UNGAIKYO.healToShield, UNGAIKYO.healShieldTurns,
    { tag: "3443", skill: "镜中世界", reason: "HEAL_CONVERTED", base: "heal", ratio: UNGAIKYO.healToShield * 100 });
}

export function installUngaikyo(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isUngaikyo);
  for (const e of units) {
    registerOwnerHandler(battle, "betting:344:start:" + e.id, e.id, EV.BATTLE_START, () => setupForm(battle, e));
    syncSkillTable(e);
    if (formOf(e)) e.caps.receivesHeal = false;
    out.push({ entityId: e.id, mechanic: "阴/阳 · 镜中世界 · 镜盾" });
  }
  if (units.length) {
    ensureShieldTicker(battle);
    ensureGlobalHandler(battle, "betting:344:guard", EV.STATUS_ADD, (ctx: any) => onGuardStatusAdd(battle, ctx));
    ensureGlobalHandler(battle, "betting:344:guard-expire", EV.STATUS_EXPIRE, (ctx: any) => onGuardLost(battle, ctx));
    ensureGlobalHandler(battle, "betting:344:guard-remove", EV.STATUS_REMOVE, (ctx: any) => onGuardLost(battle, ctx));
    battle.onHealBlocked = (s: Entity, t: Entity, amount: number) => onHealBlocked(battle, s, t, amount);
  }
  return out;
}
