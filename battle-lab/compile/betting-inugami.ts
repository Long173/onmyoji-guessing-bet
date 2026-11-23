// compile/betting-inugami.ts — 犬神 (Inugami, 220) at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 220_02 / 220_03, buffs 2202_1 守护印记 / 2204_1 紧盯, tips_11 唯一效果,
// and the user's in-game observation (matches/observed-behaviour.json): casts 220_03 whenever onibi is
// enough (the wiki's 50/50 is wrong); at battle start 2 (sometimes 3) allies are marked; damage to a
// marked ally makes Inugami counter the attacker.
//
//   守护印记 (buff_2202_1)  · at battle start and at the end of Inugami's own turns (wiki 220_02: "At the start of
//                            battle and at the end of Inugami's turn"): floor(living non-summon allies / 2) allies,
//                            lowest HP ratio first, hold the mark. Ties: an ally already holding the mark keeps it,
//                            the rest is random (the in-game marks at battle start differ between battles; lineup
//                            order made the first ally a permanent counter magnet). Inugami himself counts as an
//                            ally. The mark is moved, never stacked. When Inugami dies the marks go at once.
//                          · tips_11: one Inugami per team runs it (the first one in the lineup).
//                          · "友方受到非传导伤害时，若自身未处于无法动作，犬神将对造成伤害的敌方目标进行反击":
//                            a marked ally takes non-conducted damage from an enemy ⇒ Inugami counters that
//                            enemy (pseudo turn, 1 hit of 135% ATK at max level: 220_02 L5). Not stated, assumed:
//                            at most one counter per enemy action (multi-hit / AoE attacks trigger once), no
//                            counter while already inside a pseudo turn (counters do not chain), the damage
//                            must not be fully avoided (applied + absorbed > 0).
//   counter rider          · after each counter: +ATK equal to 30% of the countered enemy's current ATK,
//                            total capped at 210% of Inugami's BASE ATK = the soul-free max-level ATK 3002
//                            (wiki StatBox AtkMax2 / data/kb/shikigami.full.json 220 stats.atk), not the panel ATK
//                            (the guessing path sets entity.base = screenshot panel, souls included, which made the
//                            cap 2.1 × 4748 = 9971 in match 4 instead of 6304). "直到下个回合结束" = until his next
//                            own turn end.
//                          · the counter target gets 紧盯 (buff_2204_1, ATK -35%) "持续1回合", counted on
//                            Inugami's turns (tips_15 style): removed at his next own turn end.
//                          · while 2 or more enemies carry 紧盯, 心剑乱舞 costs 2 onibi less (min 0).
//   心剑乱舞 (220_03)       · 5 hits of 108% ATK (L5). Hit 1 strikes the chosen target; every later hit picks a
//                            random living enemy not hit yet, or any living enemy once all were hit.
//                          · "重复攻击同一目标时，伤害依次递减50%": read as multiplicative (100% → 50% → 25% …);
//                            additive would make the 3rd hit on one target deal 0, which the text never says.
//   AI                     · 220_03 whenever its (discounted) cost can be paid, otherwise 心斩; 守护 (220_02,
//                            the active part) is never cast (not in the AI table).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented, findImmuneStatus } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, levelNumber, ensureGlobalHandler,
} from "./betting-shared.ts";

export const INUGAMI = Object.freeze({
  counterRatioL1: 110,      // buff_2202_1: 反击造成攻击110%伤害 (L5 line of 220_02: 135%)
  atkFromEnemy: 0.3,        // 220_02: 提升攻击（等同受反击敌方30%攻击）
  atkCapOfBase: 2.1,        // 220_02: 最多提升基础攻击210%
  baseAtk: 3002,            // soul-free max-level ATK (wiki Inugami StatBox AtkMax2; KB shikigami.full.json 220)
  watchAtkDown: -0.35,      // buff_2204_1: 攻击力降低35%
  discountAt: 2,            // 220_02: 当敌方有2个或更多[buff_2204_1]时
  discount: 2,              //          「心剑乱舞」消耗鬼火减少2点
  repeatDecay: 0.5,         // 220_03: 重复攻击同一目标时，伤害依次递减50%
});

const MARK_ID = "2202_1";
const WATCH_ID = "2204_1";
const ATK_ID = "220_guard_atk";
/** Timed statuses of this kit are GLOBAL (counted down on every turn) and start at PERSIST; at Inugami's
 *  turn start the ones he already holds are set to DUE, and his turn end removes everything at or below DUE. */
const DUE = 50000;

const markDefOf = () => markDef({ id: MARK_ID, name: "守护印记", category: StatusCategory.COMMON_MARK,
  desc: "【通用、印记】友方受到非传导伤害时，若自身未处于无法动作，犬神将对造成伤害的敌方目标进行反击，反击造成攻击110%伤害。" }, StatusBook);
const watchDefOf = () => markDef({ id: WATCH_ID, name: "紧盯", category: StatusCategory.DEBUFF_MARK,
  desc: "【减益、印记】攻击力降低35%。（betting: 持续到犬神下个回合结束）" }, StatusBook);
const atkDefOf = () => markDef({ id: ATK_ID, name: "守护·攻击提升", category: StatusCategory.BUFF_STATE,
  desc: "犬神「守护」：每次反击后提升攻击（等同受反击敌方30%攻击），最多提升基础攻击210%，直到下个回合结束。" }, StatusBook);

export const isInugami = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "220_02") && !!skillById(e, "220_03");

/** tips_11 唯一效果: the first Inugami of the team runs 守护. */
function guardOf(battle: any, teamId: number): Entity | null {
  return (battle.teams[teamId]?.members ?? []).find((m: Entity) => isInugami(m)) ?? null;
}

const hpRatio = (e: Entity): number => (e.maxHp > 0 ? e.hp / e.maxHp : 0);
const watchCount = (battle: any, inu: Entity): number =>
  battle.enemiesOf(inu.teamId).filter((v: Entity) => v.alive && v.statuses.some(s => s.def.id === WATCH_ID && s.sourceId === inu.id)).length;

export const markedAllies = (battle: any, teamId: number): Entity[] =>
  (battle.teams[teamId]?.members ?? []).filter((m: Entity) => m.alive && m.hasStatus(MARK_ID));
export const guardAtkBonus = (e: Entity): number =>
  e.statuses.find(s => s.def.id === ATK_ID)?.effects.reduce((a, x) => a + Number(x.value), 0) ?? 0;

// ───────────────────────── cost / AI ─────────────────────────

/** Onibi discount of 心剑乱舞 (0 unless 2+ enemies carry 紧盯). Used by bettingCostOf. */
export function inugamiDiscount(battle: any, self: Entity, sk: any): number {
  // `sk` is a runtime skill (AI) or a SkillIR (the executor's payment step).
  if (!bettingActive() || (sk?.ir?.id ?? sk?.id) !== "220_03" || !battle?.enemiesOf) return 0;
  return watchCount(battle, self) >= INUGAMI.discountAt ? INUGAMI.discount : 0;
}

// ───────────────────────── 守护印记: assignment ─────────────────────────

function removeStatus(battle: any, e: Entity, id: string, sourceId: number | null, by: string, skill: string): void {
  for (const st of [...e.statuses]) {
    if (st.def.id !== id || (sourceId !== null && st.sourceId !== sourceId)) continue;
    if (!e.expireStatus(st)) continue;
    battle.trace.push({ t: "STATUS_REMOVE", id: e.id, status: id, name: st.def.name, by, side: "ALLY", what: "MARK", src: sourceId, skill });
    battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: e, status: id, name: st.def.name, by, side: "ALLY", what: "MARK", src: sourceId, skill }, e.id, e.teamId);
  }
}

export function assignMarks(battle: any, inu: Entity, reason: string): void {
  const team = battle.teams[inu.teamId];
  const allies: Entity[] = team.members.filter((m: Entity) => m.alive && !isSummonUnit(m));
  // Tie-break: holders keep the mark, then random (one draw per candidate, only while Inugami lives).
  const roll = new Map<number, number>();
  if (inu.alive) for (const m of allies) { battle.rng.expect("inugami_mark_tie:" + m.id); roll.set(m.id, battle.rng.next()); }
  const held = (m: Entity): number => (m.hasStatus(MARK_ID) ? 0 : 1);
  const want = new Set(inu.alive
    ? [...allies].sort((a, b) => hpRatio(a) - hpRatio(b) || held(a) - held(b) || roll.get(a.id)! - roll.get(b.id)!)
        .slice(0, GameMath.floorAt(allies.length / 2, "INUGAMI_MARK_COUNT")).map(m => m.id)
    : []);
  for (const m of team.members as Entity[]) {
    const has = m.hasStatus(MARK_ID);
    if (has && !want.has(m.id)) removeStatus(battle, m, MARK_ID, null, inu.alive ? "MOVED" : "OWNER_DEAD", "守护");
  }
  const def = markDefOf();
  for (const m of allies) {
    if (!want.has(m.id) || m.hasStatus(MARK_ID)) continue;
    const a = m.addStatus(def, inu.id, 1, PERSIST, [], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: inu.id, dst: m.id, status: MARK_ID, name: def.name, category: def.category, duration: PERSIST, ref: MARK_ID, known: true, tag: a.tag, skill: "守护", reason });
  }
}

// ───────────────────────── counter ─────────────────────────

/** Enemy actions that already caused a counter (per Inugami): "turn:attacker". Transient. */
const countered = new WeakMap<object, Map<number, string>>();

function counterSkill(ratio: number): any {
  const name = "守护·反击";
  return {
    name, cost: 0, selectable: false, index: -1,
    ir: { id: "220_02c", charId: 220, name, cost: 0, hits: 1, damage: [{ ratio, type: DamageType.NORMAL, base: "atk" }] },
    execute: async (battle: any, self: Entity, target: Entity) => {
      battle.trace.push({ t: "SKILL_CAST", actor: self.id, skill: name, cost: 0, target: target?.id ?? null, hits: 1 });
      if (!target?.alive) return;
      await battle.withinResolution({ id: "HIT:" + name + "#1", type: "HIT" }, async () => {
        await battle.damage(self, target, self.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, null);
      });
    },
  };
}

export function counterRatioOf(inu: Entity): number {
  return levelNumber(skillById(inu, "220_02")?.ir, /反击伤害增加至(\d+(?:\.\d+)?)%/, null, INUGAMI.counterRatioL1);
}

function gainGuardAtk(battle: any, inu: Entity, amount: number, from: Entity): void {
  const cap = INUGAMI.atkCapOfBase * INUGAMI.baseAtk;
  const before = guardAtkBonus(inu);
  const next = Math.min(cap, before + Math.max(0, amount));
  const def = atkDefOf();
  let st = inu.statuses.find(s => s.def.id === ATK_ID);
  if (!st) {
    st = inu.addStatus(def, inu.id, 1, PERSIST, [{ prop: "atk", value: next, mode: "FIXED" }], 1);
  } else {
    // Rebuild the single FIXED effect so the number always equals the running total (refresh: until his next turn end).
    const tags = new Set(st.effects.map(x => x.tag));
    inu.effects = inu.effects.filter(x => !tags.has(x.source));
    const tag = st.tag + ":0";
    st.effects = [{ prop: "atk", value: next, mode: "FIXED", tag }];
    inu.effects.push({ prop: "atk", value: next, mode: "FIXED", source: tag });
    st.remaining = PERSIST;
  }
  battle.trace.push({
    t: "STATUS_APPLY", src: inu.id, dst: inu.id, status: ATK_ID, name: def.name, category: def.category, duration: PERSIST,
    ref: ATK_ID, known: true, tag: st.tag, skill: "守护",
    note: "ATK +" + GameMath.display(next) + " (+" + GameMath.display(next - before) + " = 30% of " + from.id + "'s ATK; cap " + GameMath.display(cap) + ")",
  });
}

function applyWatch(battle: any, inu: Entity, v: Entity): void {
  if (!v.alive) return;
  const def = watchDefOf();
  const imm = findImmuneStatus(v, def, battle.policies?.immune?.debuffCoversControl ?? true);
  if (imm) {
    battle.trace.push({ t: "IMMUNE", src: inu.id, dst: v.id, status: WATCH_ID, name: def.name, by: imm.def.id, kind: imm.kind, consumed: imm.consumed, ref: WATCH_ID, skill: "守护" });
    return;
  }
  const ex = v.statuses.find(s => s.def.id === WATCH_ID && s.sourceId === inu.id);
  if (ex) { ex.remaining = PERSIST; return; }
  const a = v.addStatus(def, inu.id, 1, PERSIST, [{ prop: "atk", value: INUGAMI.watchAtkDown, mode: "ADD_RATE" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: inu.id, dst: v.id, status: WATCH_ID, name: def.name, category: def.category, duration: 1, ref: WATCH_ID, known: true, tag: a.tag, skill: "守护" });
}

async function onDamage(battle: any, ctx: any): Promise<void> {
  const src: Entity | undefined = ctx?.input?.source;
  const dst: Entity | undefined = ctx?.input?.target;
  if (!src || !dst || src.teamId === dst.teamId || ctx.input.type === DamageType.CONDUCTION) return;
  if (!dst.hasStatus(MARK_ID)) return;
  if (!(Number(ctx.result?.applied ?? 0) + Number(ctx.result?.absorbed ?? 0) > 0)) return;
  const inu = guardOf(battle, dst.teamId);
  if (!inu?.alive || !src.alive || isActionPrevented(inu.statusDefs())) return;
  const cur = battle.bus.currentEvent;
  if (cur !== null && battle.bus.ancestry(cur).some((n: any) => n.code === TurnType.PSEUDO_TURN)) return;
  const key = battle.turn + ":" + src.id;
  const seen = countered.get(battle) ?? new Map<number, string>();
  countered.set(battle, seen);
  if (seen.get(inu.id) === key) return;
  seen.set(inu.id, key);
  const ratio = counterRatioOf(inu);
  const enemyAtk = src.prop("atk");
  battle.trace.push({ t: "COUNTER", actor: inu.id, target: src.id, skill: "守护·反击", turn: battle.turn, reason: "守护印记", marked: dst.id, ratio });
  await battle.runPseudoTurn(inu, TurnType.PSEUDO_TURN, { skill: counterSkill(ratio), target: src });
  if (!inu.alive) return;
  gainGuardAtk(battle, inu, INUGAMI.atkFromEnemy * enemyAtk, src);
  applyWatch(battle, inu, src);
}

// ───────────────────────── Inugami's own turn: expiry of 紧盯 / ATK bonus ─────────────────────────

function kitStatuses(battle: any, inu: Entity): Array<{ e: Entity; st: any }> {
  const out: Array<{ e: Entity; st: any }> = [];
  for (const e of battle.allEntities() as Entity[]) {
    for (const st of e.statuses) if ((st.def.id === WATCH_ID || st.def.id === ATK_ID) && st.sourceId === inu.id) out.push({ e, st });
  }
  return out;
}

function onTurnStart(battle: any, actor: Entity): void {
  if (!isInugami(actor)) return;
  for (const { st } of kitStatuses(battle, actor)) st.remaining = Math.min(st.remaining, DUE);
}

function onTurnEnd(battle: any, actor: Entity): void {
  if (isInugami(actor)) {
    for (const { e, st } of kitStatuses(battle, actor)) {
      if (st.remaining > DUE || !e.expireStatus(st)) continue;
      battle.trace.push({ t: "STATUS_EXPIRE", id: e.id, status: st.def.id });
      battle.queueEvent(EV.STATUS_EXPIRE, { battle, entity: e, status: st.def.id, name: st.def.name, reason: "DURATION" }, e.id, e.teamId);
    }
  }
  for (let ti = 0; ti < battle.teams.length; ti++) {
    const inu = guardOf(battle, ti);
    // Re-assigned at his own turn end only; a dead Inugami's marks are cleared at the next turn end.
    if (inu && (inu === actor || (!inu.alive && markedAllies(battle, ti).length))) assignMarks(battle, inu, "TURN_END");
  }
}

// ───────────────────────── 心剑乱舞 ─────────────────────────

export function swordDanceHook(x: any): { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> } | null {
  if (x?.id !== "220_03" || !Array.isArray(x.damage) || !x.damage.length) return null;
  const d = x.damage[0];
  const text = (x.sentences ?? []).map((s: any) => String(s.text ?? "")).join("。");
  const decay = Number(text.match(/伤害依次递减(\d+(?:\.\d+)?)%/)?.[1] ?? INUGAMI.repeatDecay * 100) / 100;
  return {
    kind: "SWORD_DANCE",
    run: async (battle, self, hurt, primary) => {
      const seen = new Map<number, number>();
      for (let h = 0; h < Math.max(1, Number(x.hits ?? 5)); h++) {
        await battle.withinResolution({ id: "HIT:" + x.name + "#" + (h + 1), type: "HIT" }, async () => {
          const pool: Entity[] = battle.enemiesOf(self.teamId).filter((v: Entity) => v.alive);
          if (!pool.length) return;
          let victim: Entity;
          if (h === 0 && primary?.alive && primary.teamId !== self.teamId) victim = primary;
          else {
            const fresh = pool.filter(v => !seen.has(v.id));
            battle.rng.expect("hit_target:" + x.name + "#" + (h + 1));
            victim = battle.rng.pick(fresh.length ? fresh : pool);
          }
          const n = seen.get(victim.id) ?? 0;
          seen.set(victim.id, n + 1);
          if (!hurt.includes(victim)) hurt.push(victim);
          const mul = Math.pow(1 - decay, n);
          await battle.damage(self, victim, self.prop("atk") * (Number(d.ratioMax ?? d.ratio) / 100), d.type ?? DamageType.NORMAL, mul, x.lifesteal ?? null);
        });
      }
    },
  };
}

// ───────────────────────── installation ─────────────────────────

export function installInugami(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isInugami);
  for (const e of units) out.push({ entityId: e.id, mechanic: "守护印记 · 反击 · 紧盯" });
  if (!units.length) return out;
  ensureGlobalHandler(battle, "betting:220:start", EV.BATTLE_START, () => {
    for (let ti = 0; ti < battle.teams.length; ti++) {
      const inu = guardOf(battle, ti);
      if (inu) assignMarks(battle, inu, "BATTLE_START");
    }
  });
  ensureGlobalHandler(battle, "betting:220:turn-start", EV.TURN_START, (ctx: any) => { if (ctx?.actor) onTurnStart(battle, ctx.actor); });
  ensureGlobalHandler(battle, "betting:220:turn-end", EV.TURN_END, (ctx: any) => { if (ctx?.actor) onTurnEnd(battle, ctx.actor); });
  ensureGlobalHandler(battle, "betting:220:counter", EV.AFTER_DAMAGE, (ctx: any) => onDamage(battle, ctx));
  return out;
}

