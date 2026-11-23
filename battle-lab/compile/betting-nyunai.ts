// compile/betting-nyunai.ts — 入内雀 (SR 365, Global "Nyunai-suzume") at max skill level. MAX (betting) mode only.
//
// Sources: data/kb/shikigami.json 365_01..365_03, buff 3651_1 腐血, glossary 附身, tips_9 协战 / tips_7 先机 /
// tips_11 唯一效果; fandom "Nyuunai-suzume/Main" and Adjustments/Shikigami (2021-08-04 Global, evolved form).
// "初始" stats = battle-start panel (official [23]: base + souls) = the lineup stats (Entity.base).
//   雀啄 (365_01)  · 50% ATK + true damage of 90% DEF (L5 "额外伤害增加至90%"; the Global L2-L5 lines only say
//                   "Damage increases to …" — the CN text names the DEF part, used here). The compiled IR read the
//                   second part as 50% ATK and targeted "自身" (the SELF scope hit enemyPool[0]); patched.
//                   40% 协战 (tips_9: when an ally normal-attacks an enemy, he normal-attacks the same enemy; an
//                   assist never chains), 100% after 附身 was consumed (365_02 L4).
//   附身 (365_02)  · tips_11. 先机: possesses the ally with the highest ATK (other than himself; ties: random).
//                   The possessed ally gains his initial DEF (cap: 100% of that ally's own initial DEF, L2) and he
//                   gains its initial ATK (cap: 100% of his own initial ATK, L3) — caps as in the CN glossary
//                   ("最多不超过该单位自身初始防御" / "最多不超过自身初始攻击"); the Global "cannot exceed 100% of his
//                   DEF / their ATK" is ambiguous about whose stat caps it, so the explicit CN reading is used.
//                   Lethal damage on the possessed ally: negated, 附身 consumed, its max HP drops to 1 and it gains
//                   that much 腐血 (cap 4000% of his initial DEF); it can gain no more 腐血 afterwards. L5: all its
//                   control effects are removed and its action bar +100%. The active part (move 附身) is never cast:
//                   the AI only uses 腐化. 附身 ends if he is defeated.
//   腐化 (365_03)  · 3 onibi, ally target without 腐血: its max HP -2000% of his initial DEF (L4; cap 50% of the
//                   target's max HP), it gains that much 腐血. L2/L3/L5: per ally with 腐血, he gains +10 SPD,
//                   +20% effect RES, 10% damage reduction.
//   腐血 (3651_1) · 增益、印记: cannot be healed; damage taken is absorbed first, 3 damage per point (before shields);
//                   crit -10%, damage dealt +25%. Removed when its points run out.
//   AI            · KB "随机友方 → 3技能" (duel note "只会三技能，目标随机"): 腐化 on a random ally without 腐血 (not
//                   himself: the engine's ally candidate list) whenever affordable, otherwise 雀啄. The KB condition
//                   never compiled, so he only ever used 雀啄 (on himself).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler,
  ensureGlobalHandler, setStackedStatus, shiftBar, clearControls,
} from "./betting-shared.ts";

export const NYUNAI = Object.freeze({
  peckAtk: 50,            // 365_01: 攻击50%的伤害
  peckDef: 90,            // 365_01 L5: 额外伤害增加至90%（自身防御的真实伤害）
  assist: 0.4,            // 365_01: 40%概率协战
  assistAfter: 1,         // 365_02 L4: 附身被消耗时，协战概率提升至100%
  defShare: 1,            // 365_02 L2: 最多不超过该单位自身初始防御100%
  atkShare: 1,            // 365_02 L3: 最多不超过自身初始攻击100%
  lethalBloodCap: 40,     // 365_02: 不超过入内雀初始防御4000%
  lethalBar: 1,           // 365_02 L5: 增加100%行动条
  decayDef: 20,           // 365_03 L4: 入内雀防御2000%的生命上限
  decayCap: 0.5,          // 365_03: 不超过目标生命上限50%
  perSpd: 10, perRes: 0.2, perCut: 0.1,   // 365_03 L2 / L3 / L5
  absorb: 3,              // 3651_1: 每点腐血可以吸收3点伤害
  bloodCrit: -0.1, bloodDealt: 0.25,
});

export const BLOOD_ID = "3651_1";
export const POSSESS_ID = "365_possess";
const POSSESS_ATK_ID = "365_possess_atk";
const BONUS_ID = "365_decay_bonus";
const NOTE_BLOOD = "nyunai365:blood=";
const NOTE_NOMORE = "nyunai365:noMoreBlood";
const NOTE_HEAL = "nyunai365:healCap=";
const NOTE_ASSIST = "nyunai365:assist100";

const bloodDef = () => markDef({ id: BLOOD_ID, name: "腐血", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】无法被治疗、恢复，受到伤害后优先消耗腐血，每点腐血可以吸收3点伤害。具有腐血的单位降低10%暴击，提升25%伤害。（betting: 点数记在 notes）" }, StatusBook);
const possessDef = () => markDef({ id: POSSESS_ID, name: "附身", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "入内雀特殊机制，同一时间只能附身1个目标。附身单位获得入内雀的初始防御（不超过该单位自身初始防御100%）；受到致命伤害时免疫该次伤害并消耗附身。" }, StatusBook);
const possessAtkDef = () => markDef({ id: POSSESS_ATK_ID, name: "附身·攻击", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "入内雀获得附身单位的初始攻击（不超过自身初始攻击100%），附身结束时移除。" }, StatusBook);
const bonusDef = () => markDef({ id: BONUS_ID, name: "腐化·加成", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "友方每有一个单位获得腐血：入内雀提升10点速度、20%效果抵抗，受到的伤害降低10%。" }, StatusBook);

export const isNyunai365 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "365_01") && !!skillById(e, "365_03");
export const bloodOf = (e: Entity): number => (e.hasStatus(BLOOD_ID) ? Number(noteValue(e, NOTE_BLOOD) ?? 0) : 0);
export const possessedBy = (battle: any, n: Entity): Entity | null =>
  (battle.teams[n.teamId].members as Entity[]).find(m => m.alive && m.statuses.some(s => s.def.id === POSSESS_ID && s.sourceId === n.id)) ?? null;
const initial = (e: Entity, p: string): number => Number(e.base[p] ?? 0);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
/** Battle of each installed Nyunai (aiRuleTarget has no battle argument). */
const battleOf = new WeakMap<object, any>();

// ───────────────────────── 腐血 ─────────────────────────

/** Grants `points` of 腐血 (adds to an existing pool) and blocks heals while it lasts. */
export function grantBlood(battle: any, n: Entity, t: Entity, points: number, skill: string): void {
  if (!t?.alive || !(points > 0)) return;
  const def = bloodDef();
  if (!t.hasStatus(BLOOD_ID)) {
    setNote(t, NOTE_HEAL, t.caps.receivesHeal ? 1 : 0);
    const a = t.addStatus(def, n.id, 1, PERSIST, [{ prop: "cri", value: NYUNAI.bloodCrit, mode: "FIXED" }, { prop: "dmgDealtB", value: NYUNAI.bloodDealt, mode: "FIXED" }], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: n.id, dst: t.id, status: BLOOD_ID, name: def.name, category: def.category, duration: PERSIST, ref: BLOOD_ID, known: true, tag: a.tag, skill, points: GameMath.display(points) });
  }
  setNote(t, NOTE_BLOOD, bloodOf(t) + points);
  t.caps.receivesHeal = false;
  refreshBonus(battle, n);
}

function dropBlood(battle: any, t: Entity, reason: string): void {
  const st = t.statuses.find(s => s.def.id === BLOOD_ID);
  if (st && t.expireStatus(st)) battle.trace.push({ t: "STATUS_EXPIRE", id: t.id, status: BLOOD_ID, reason });
  setNote(t, NOTE_BLOOD, null);
  if (noteValue(t, NOTE_HEAL) === "1") t.caps.receivesHeal = true;
  setNote(t, NOTE_HEAL, null);
  for (const n of (battle.teams[t.teamId].members as Entity[]).filter(isNyunai365)) refreshBonus(battle, n);
}

/** 腐化 L2/L3/L5: per ally with 腐血. */
function refreshBonus(battle: any, n: Entity): void {
  const k = (battle.teams[n.teamId].members as Entity[]).filter(m => m.alive && m.hasStatus(BLOOD_ID)).length;
  setStackedStatus(n, bonusDef(), k, 5, n.id,
    [{ prop: "spd", value: NYUNAI.perSpd, mode: "FIXED" }, { prop: "efr", value: NYUNAI.perRes, mode: "FIXED" }, { prop: "dmgTakenD", value: -NYUNAI.perCut, mode: "FIXED" }]);
}

/** Absorbs damage with 腐血 (registered last among the BEFORE_DAMAGE handlers, so after every multiplier). */
function absorb(battle: any, ctx: any): void {
  const t: Entity | undefined = ctx?.input?.target;
  const res = ctx?.result;
  if (!t || !res || !(res.final > 0)) return;
  const pts = bloodOf(t);
  if (!(pts > 0)) return;
  const used = Math.min(res.final, pts * NYUNAI.absorb);
  res.final -= used;
  const left = pts - used / NYUNAI.absorb;
  battle.trace.push({ t: "BLOOD_ABSORB", dst: t.id, absorbed: GameMath.display(used), pointsLeft: GameMath.display(Math.max(0, left)), status: BLOOD_ID });
  if (left > 1e-9) setNote(t, NOTE_BLOOD, left);
  else dropBlood(battle, t, "DEPLETED");
}

// ───────────────────────── 附身 ─────────────────────────

function possess(battle: any, n: Entity, t: Entity, reason: string): void {
  const defGain = Math.min(initial(n, "def"), NYUNAI.defShare * initial(t, "def"));
  const atkGain = Math.min(initial(t, "atk"), NYUNAI.atkShare * initial(n, "atk"));
  const def = possessDef();
  const a = t.addStatus(def, n.id, 1, PERSIST, [{ prop: "def", value: defGain, mode: "FIXED" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: n.id, dst: t.id, status: POSSESS_ID, name: def.name, category: def.category, duration: PERSIST, ref: POSSESS_ID, known: true, tag: a.tag, skill: "附身", reason, defGain });
  n.addStatus(possessAtkDef(), n.id, 1, PERSIST, [{ prop: "atk", value: atkGain, mode: "FIXED" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: n.id, dst: n.id, status: POSSESS_ATK_ID, name: "附身·攻击", category: StatusCategory.BUFF_STATE, duration: PERSIST, ref: POSSESS_ATK_ID, known: true, skill: "附身", atkGain });
}

function endPossession(battle: any, n: Entity, t: Entity | null, reason: string): void {
  if (t) {
    const st = t.statuses.find(s => s.def.id === POSSESS_ID && s.sourceId === n.id);
    if (st && t.expireStatus(st)) battle.trace.push({ t: "STATUS_EXPIRE", id: t.id, status: POSSESS_ID, reason });
  }
  const own = n.statuses.find(s => s.def.id === POSSESS_ATK_ID);
  if (own) n.expireStatus(own);
}

/** 先机: the ally with the highest ATK other than himself (ties: random). */
function openingPossess(battle: any, n: Entity): void {
  const pool = (battle.teams[n.teamId].members as Entity[]).filter(m => m.alive && m.id !== n.id && !isSummonUnit(m));
  if (!pool.length || possessedBy(battle, n)) return;
  const top = Math.max(...pool.map(m => m.prop("atk")));
  const best = pool.filter(m => Math.abs(m.prop("atk") - top) < 1e-9);
  battle.rng.expect("nyunai365_possess");
  const t = best.length > 1 ? (battle.rng.pick(best) ?? best[0]) : best[0];
  battle.trace.push({ t: "SUBCAST", actor: n.id, ref: "365_02", skill: "附身", target: t.id, clause: "[tips_7]先机：附身友方攻击力最高的单位" });
  possess(battle, n, t, "SENKI");
}

function onLethal(battle: any, n: Entity, hook: any): void {
  const t: Entity | undefined = hook?.target;
  if (!t || hook.prevented || !t.statuses.some(s => s.def.id === POSSESS_ID && s.sourceId === n.id)) return;
  hook.prevented = true;
  const lost = Math.max(0, t.maxHp - 1);
  t.hpZero = false; t.alive = true; t.dead = false;
  t.maxHp = 1; t.hp = 1;
  endPossession(battle, n, t, "CONSUMED");
  battle.trace.push({ t: "POSSESS_CONSUMED", src: n.id, id: t.id, maxHpLost: GameMath.display(lost), skill: "附身" });
  if (bloodOf(t) > 0) dropBlood(battle, t, "REPLACED");
  if (noteValue(t, NOTE_NOMORE) === null) grantBlood(battle, n, t, Math.min(lost, NYUNAI.lethalBloodCap * initial(n, "def")), "附身");
  setNote(t, NOTE_NOMORE, 1);
  setNote(n, NOTE_ASSIST, 1);
  clearControls(battle, t, n, "附身");
  shiftBar(battle, t, NYUNAI.lethalBar, "附身");
}

// ───────────────────────── 腐化 / 雀啄 ─────────────────────────

const canDecay = (t: Entity): boolean => t.alive && !isSummonUnit(t) && !t.hasStatus(BLOOD_ID) && noteValue(t, NOTE_NOMORE) === null;
const decayTargets = (battle: any, n: Entity): Entity[] =>
  (battle.teams[n.teamId].members as Entity[]).filter(m => m.id !== n.id && canDecay(m));

export function nyunaiGate(battle: any, self: Entity, sk: any): string | null {
  if (sk?.ir?.id === "365_02") return "AI_NEVER_CASTS";
  if (sk?.ir?.id === "365_03" && !decayTargets(battle, self).length) return "NO_ALLY_WITHOUT_BLOOD";
  return null;
}

export function nyunaiRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isNyunai365(self)) return null;
  const decay = skillById(self, "365_03");
  const c = costOf(decay);
  if (!nyunaiGate(battle, self, decay) && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c))) return { skill: decay, rule: "入内雀: 随机友方 → 腐化 (KB AI)" };
  const peck = skillById(self, "365_01");
  return peck ? { skill: peck, rule: "入内雀: 鬼火不足或无可腐化的友方 → 雀啄" } : null;
}

/** 腐化: a random ally without 腐血. */
export function nyunaiTarget(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || x?.id !== "365_03") return null;
  const pool = cands.filter(c => c.teamId === self.teamId && c.id !== self.id && canDecay(c));
  if (!pool.length) return null;
  const battle = battleOf.get(self);
  battle?.rng?.expect?.("nyunai365_decay_target");
  const target = pool.length > 1 && battle ? (battle.rng.pick(pool) ?? pool[0]) : pool[0];
  recordDecayTarget(self, target);
  return { target, rule: "入内雀: 腐化目标随机（无腐血的友方）(KB AI)" };
}

export function nyunaiAfterCast(battle: any, self: Entity, x: any): boolean {
  if (x?.id !== "365_03") return false;
  const target = decayTargetOf(battle, self);
  lastDecayTarget.delete(self);
  const t = target && target.teamId === self.teamId && canDecay(target) ? target : null;
  if (!t) return true;
  const cut = Math.min(NYUNAI.decayDef * initial(self, "def"), NYUNAI.decayCap * t.maxHp);
  t.maxHp -= cut;
  t.hp = Math.min(t.hp, t.maxHp);
  battle.trace.push({ t: "MAX_HP_CHANGE", id: t.id, by: -GameMath.display(cut), maxHp: GameMath.display(t.maxHp), src: self.id, skill: x.name });
  grantBlood(battle, self, t, cut, x.name);
  return true;
}

type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };

/** 雀啄: 50% ATK + 90% DEF true damage on the chosen enemy. */
export function peckHook(x: any): Hook | null {
  if (x?.id !== "365_01") return null;
  return {
    kind: "SPARROW_PECK",
    run: async (battle, self, hurt, primary) => {
      const t = primary?.alive && primary.teamId !== self.teamId ? primary : aliveEnemies(battle, self)[0];
      if (!t) return;
      hurt.push(t);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        await battle.damage(self, t, self.prop("atk") * (NYUNAI.peckAtk / 100), DamageType.NORMAL, 1, null);
        if (t.alive) await battle.damage(self, t, self.prop("def") * (NYUNAI.peckDef / 100), DamageType.TRUE, 1, null);
      });
    },
  };
}

/** IR patches (MAX). */
export const NYUNAI_PATCHES = Object.freeze({
  "365_01": { note: "雀啄: enemy target; damage (50% ATK + 90% DEF true) is run by betting-nyunai.ts", patch: { targeting: ["敌方目标"] } },
  "365_03": { note: "腐化: max-HP cut and 腐血 are run by betting-nyunai.ts after the cast", patch: { statusRefConditionOnly: [0, 1] } },
});

/** The target of the running 腐化 cast (aiRuleTarget → afterCast). */
const lastDecayTarget = new WeakMap<object, number>();
export const recordDecayTarget = (self: Entity, t: Entity): void => { lastDecayTarget.set(self, t.id); };
export const decayTargetOf = (battle: any, self: Entity): Entity | null => {
  const id = lastDecayTarget.get(self);
  return id === undefined ? null : ((battle.teams[self.teamId].members as Entity[]).find(m => m.id === id) ?? null);
};

const assisting = new WeakSet<object>();

export function installNyunai(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isNyunai365);
  for (const n of units) {
    battleOf.set(n, battle);
    // 附身 and 雀啄 are not passive skills (365_02 is a castable special skill): 压制 (封印结界) does not stop them,
    // so they use global handlers (a defeated Nyunai ends 附身 first, and the handlers check that he is alive).
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL") =>
      range === "SELF" ? registerOwnerHandler(battle, "betting:365:" + code + ":" + n.id, n.id, code, fn, range)
        : ensureGlobalHandler(battle, "betting:365:" + code + ":" + n.id, code, fn);
    reg(EV.BATTLE_START, () => openingPossess(battle, n), "SELF");
    reg(EV.DEATH_PREVENTION, (hook: any) => { if (n.alive) onLethal(battle, n, hook); });
    reg(EV.DEATH, (ctx: any) => {
      const v: Entity | undefined = ctx?.target;
      if (v?.id === n.id && !n.alive) endPossession(battle, n, possessedBy(battle, n), "OWNER_DEFEATED");
      if (v && v.teamId === n.teamId) refreshBonus(battle, n);
    });
    // 协战: an ally's normal attack on an enemy ⇒ 40% (100% after 附身 was consumed) 雀啄 on the same enemy.
    reg(EV.SKILL_END, async (ctx: any) => {
      const { actor, skill, target } = ctx ?? {};
      if (!actor || actor.id === n.id || actor.teamId !== n.teamId || !skill || !target || !n.alive || !target.alive) return;
      const isBasic = Number(skill.cost) === 0 && Array.isArray(skill.ir?.damage) && skill.ir.damage.length > 0;
      if (!isBasic || target.teamId === n.teamId || assisting.has(battle) || isActionPrevented(n.statusDefs())) return;
      const peck = skillById(n, "365_01");
      if (!peck) return;
      const p = noteValue(n, NOTE_ASSIST) ? NYUNAI.assistAfter : NYUNAI.assist;
      battle.rng.expect("nyunai365_assist");
      if (!battle.rng.testHit(p)) return;
      battle.trace.push({ t: "ASSIST", actor: n.id, ally: actor.id, target: target.id, skill: peck.name, chance: p });
      assisting.add(battle);
      try { await battle.runPseudoTurn(n, TurnType.PSEUDO_TURN, { skill: peck, target }); } finally { assisting.delete(battle); }
    });
    out.push({ entityId: n.id, mechanic: "附身 先机 / lethal · 腐化 腐血 · 雀啄 协战" });
  }
  if (units.length) ensureGlobalHandler(battle, "betting:365:blood", EV.BEFORE_DAMAGE, (ctx: any) => absorb(battle, ctx));
  return out;
}
