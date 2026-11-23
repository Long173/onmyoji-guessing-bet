// compile/betting-momiji.ts — 心狩鬼女红叶 (SP 388, Global "Heartseeker Momiji") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 388_01..388_03, buffs 3882_1 叶烬 / 3884_1 叶之护 / 3885_1 林隐; fandom
// "Kokorogari Kijo Momiji/Main" (revised 2026-03-15, after the Global 2026-03-11 adjustment; the KB text predates
// it — the Global text is used where they differ, e.g. the Leaf Blade numbers that the KB does not give).
//   乌翎 (388_01)       · 125% ATK. In 林隐 it becomes 叶刃: 100% ATK on the target, then 3 bounces (L5) of 100% to
//                        the enemy with the most 叶烬 stacks (ties: random; a bounce never re-hits the enemy it just
//                        hit unless it is the only one left). 叶刃 cast in her own turn removes 1 林隐 stack.
//   经霜 (388_02)       · tips_11. Every hit of her skills puts 1 叶烬 on the enemy hit. L3: when an ally receives a
//                        debuff, its source gets 1 叶烬 (once per turn). L4: an enemy whose action bar is increased
//                        by ≥30% gets 1 叶烬. L5: each 叶烬 stack -10% ATK and DEF; when she is attacked, each stack on
//                        the attacker lowers that attack's crit rate by 20% (emulated: a crit that already happened
//                        is kept with probability newRate / oldRate, one extra roll).
//   叶烬 (buff_3882_1)  · 减益、状态, max 5, guaranteed (no 基础概率 in the text ⇒ no effect-RES contest). At the start
//                        of the bearer's turn: indirect damage of 10% of Momiji's ATK (once, not per stack). Each stack:
//                        +10% indirect damage taken (L2) and a grade-3 poison (fandom: SPD -10%, DEF -10 × grade
//                        against indirect damage) — modelled as SPD -10% while 叶烬 is present and DEF -30 per stack
//                        against indirect damage. -1 stack at the end of the bearer's turn. Applying it at 5 stacks
//                        puts 红蚀 instead.
//   红蚀               · 减益、印记, 2 turns, cannot be removed: action-bar increases on the bearer -50%; every hit of
//                        Momiji on it adds indirect damage of 80% of her ATK; applied outside her turn ⇒ her bar +40%.
//   枫起之舞 (388_03)  · 3 onibi, only without 林隐: 2 林隐 stacks; while 林隐 lasts every ally has 叶之护. L5 先机:
//                        cast at battle start (free).
//   林隐 (buff_3885_1) · L4: indirect damage taken +10%, other damage taken -30%. L2: her attacks ignore 200 DEF.
//   叶之护 (buff_3884_1)· the attacker of the bearer gets 1 叶烬 (once per turn per bearer); L3: DEF +100.
//   AI                 · KB: 枫起之舞 when not in 林隐 (and affordable), otherwise the normal attack (the duel note
//                        "两回合普攻一回合三技能" matches: 2 × 叶刃, then 枫起之舞). The KB conditions never compiled.
// The compiled IR applied 林隐 to herself on every 乌翎 (1 turn) and nothing else of the passive (passives are not
// executed on the betting path).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, findImmuneStatus } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler,
  ensureGlobalHandler, stacksOn, setStackedStatus, shiftBar,
} from "./betting-shared.ts";
import { currentSkillOf, inOwnTurn } from "./betting-scope.ts";
import { onBarIncrease, onBarAdjust } from "./betting-bar.ts";

export const MOMIJI = Object.freeze({
  burntCap: 5,
  tickRatio: 0.1,          // 叶烬: 回合开始前受到施加者攻击10%间接伤害
  indirectPerStack: 0.1,   // 388_02 L2: 每层提升受到的间接伤害增至10%
  poisonSpd: -0.1,         // 中毒: SPD -10%
  poisonDef: 30,           // 3级中毒: 受到间接伤害时防御 -10×3
  atkDefPerStack: -0.1,    // 388_02 L5: 每层额外降低10%攻击与防御
  critPerStack: 0.2,       // 388_02 L5: 被攻击时每层额外降低20%暴击
  barThreshold: 0.3,       // 388_02 L4: 敌方行动条增加达到30%
  erosionTurns: 2,
  erosionBarCut: 0.5,      // 红蚀: 行动条提升效果 -50%
  erosionRatio: 0.8,       // 红蚀: 受到攻击时额外受到其攻击80%的间接伤害
  erosionSelfBar: 0.4,     // 红蚀: 回合外施加时提升40%行动条
  woodsStacks: 2,
  woodsIndirect: 0.1,      // 388_03 L4: 受到的间接伤害提升降至10%
  woodsCut: 0.3,           // 388_03 L4: 受到的非间接伤害下降增至30%
  woodsDefIgnore: 200,     // 388_03 L2: 额外无视200点防御
  guardDef: 100,           // 388_03 L3: 叶之护额外提升100点防御
  bladeRatio: 100,         // fandom 叶刃 L4: 100%
  bladeBounces: 3,         // fandom 叶刃 L5: 弹射3次
});

export const BURNT_ID = "3882_1";
export const GUARD_ID = "3884_1";
export const WOODS_ID = "3885_1";
export const EROSION_ID = "388_erosion";
const POISON_ID = "388_poison";
const TAG = "betting-388:";
const DEF_CONSTANT = 300;

const burntDef = () => markDef({ id: BURNT_ID, name: "叶烬", category: StatusCategory.DEBUFF_STATE, dispellable: true, removable: true, durationPolicy: "GLOBAL",
  desc: "【减益、状态】回合开始前受到施加者攻击10%间接伤害。每层附加3级中毒并提升受到的间接伤害10%，降低10%攻击与防御，回合结束后减少1层，上限5层。（betting: 层数衰减由 betting-momiji.ts 执行）" }, StatusBook);
const poisonDef = () => markDef({ id: POISON_ID, name: "中毒(叶烬)", category: StatusCategory.DEBUFF_STATE, dispellable: false, removable: false, durationPolicy: "GLOBAL",
  desc: "3级中毒：速度降低10%，受到间接伤害时防御降低30（betting: 随叶烬存在）" }, StatusBook);
const erosionDef = () => markDef({ id: EROSION_ID, name: "红蚀", category: StatusCategory.DEBUFF_MARK, dispellable: false, removable: false, durationPolicy: "SOURCE_TURN",
  desc: "【减益、印记】行动条提升效果降低50%，受到心狩鬼女红叶攻击时额外受到其攻击80%的间接伤害，持续2回合，无法被解除。" }, StatusBook);
const woodsDef = () => markDef({ id: WOODS_ID, name: "林隐", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】上限2层，回合内施放叶刃后减少1层。受到的间接伤害提升10%，受到的非间接伤害下降30%，攻击无视200点防御。" }, StatusBook);
const guardDef = () => markDef({ id: GUARD_ID, name: "叶之护", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】受到伤害时攻击者将被附加1层叶烬，每个回合内最多触发1次；防御提升100。（betting: 林隐存在期间）" }, StatusBook);

export const isMomiji388 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "388_01") && !!skillById(e, "388_03");
export const woodsStacks = (m: Entity): number => stacksOn(m, WOODS_ID, m.id);
export const burntStacks = (v: Entity): number => v.statuses.filter(s => s.def.id === BURNT_ID).reduce((n, s) => n + s.stacks, 0);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const entity = (battle: any, id: number): Entity | null => battle.allEntities().find((x: Entity) => x.id === id) ?? null;

// ───────────────────────── 叶烬 / 红蚀 ─────────────────────────

function setBurnt(v: Entity, m: Entity, n: number): number {
  const after = setStackedStatus(v, burntDef(), n, MOMIJI.burntCap, m.id,
    [{ prop: "atk", value: MOMIJI.atkDefPerStack, mode: "ADD_RATE" }, { prop: "def", value: MOMIJI.atkDefPerStack, mode: "ADD_RATE" }]);
  setStackedStatus(v, poisonDef(), after > 0 ? 1 : 0, 1, m.id, [{ prop: "spd", value: MOMIJI.poisonSpd, mode: "ADD_RATE" }]);
  return after;
}

/** 1 叶烬 on `v` (红蚀 instead at 5 stacks). Guaranteed: status immunity applies, effect RES does not. */
export function applyBurnt(battle: any, m: Entity, v: Entity, reason: string): void {
  if (!v?.alive || v.teamId === m.teamId) return;
  const imm = findImmuneStatus(v, burntDef(), battle.policies?.immune?.debuffCoversControl ?? true);
  if (imm) {
    battle.trace.push({ t: "IMMUNE", src: m.id, dst: v.id, status: BURNT_ID, name: "叶烬", by: imm.def.id, kind: imm.kind, consumed: imm.consumed, ref: BURNT_ID, skill: "经霜" });
    return;
  }
  const before = stacksOn(v, BURNT_ID, m.id);
  if (before >= MOMIJI.burntCap) {
    const def = erosionDef();
    const a = v.addStatus(def, m.id, 1, MOMIJI.erosionTurns, [], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: m.id, dst: v.id, status: EROSION_ID, name: def.name, category: def.category, duration: MOMIJI.erosionTurns, ref: EROSION_ID, known: true, tag: a.tag, skill: "经霜", reason });
    if (m.alive && !inOwnTurn(battle, m)) shiftBar(battle, m, MOMIJI.erosionSelfBar, "红蚀");
    return;
  }
  const after = setBurnt(v, m, before + 1);
  battle.trace.push({ t: "STATUS_APPLY", src: m.id, dst: v.id, status: BURNT_ID, name: "叶烬", category: StatusCategory.DEBUFF_STATE, duration: PERSIST, ref: BURNT_ID, known: true, stacks: after, threshold: MOMIJI.burntCap, skill: "经霜", reason });
}

async function indirect(battle: any, m: Entity, v: Entity, ratio: number, what: string): Promise<void> {
  if (!v?.alive) return;
  await dealDamage(battle, { source: m, target: v, base: m.prop("atk") * ratio, rate: 1, type: DamageType.INDIRECT, skillTag: TAG + what });
}

// ───────────────────────── 林隐 / 叶之护 ─────────────────────────

function syncGuards(battle: any, m: Entity): void {
  const on = m.alive && woodsStacks(m) > 0;
  for (const a of battle.teams[m.teamId].members as Entity[]) {
    const st = a.statuses.find(s => s.def.id === GUARD_ID && s.sourceId === m.id);
    if (on && a.alive && !st) {
      const def = guardDef();
      const g = a.addStatus(def, m.id, 1, PERSIST, [{ prop: "def", value: MOMIJI.guardDef, mode: "FIXED" }], 1);
      battle.trace.push({ t: "STATUS_APPLY", src: m.id, dst: a.id, status: GUARD_ID, name: def.name, category: def.category, duration: PERSIST, ref: GUARD_ID, known: true, tag: g.tag, skill: "枫起之舞" });
    } else if ((!on || !a.alive) && st && a.expireStatus(st)) {
      battle.trace.push({ t: "STATUS_EXPIRE", id: a.id, status: GUARD_ID, reason: "WOODS_ENDED" });
    }
  }
}

function setWoods(battle: any, m: Entity, n: number, reason: string): void {
  const before = woodsStacks(m);
  const after = setStackedStatus(m, woodsDef(), n, MOMIJI.woodsStacks, m.id, []);
  if (after > before) battle.trace.push({ t: "STATUS_APPLY", src: m.id, dst: m.id, status: WOODS_ID, name: "林隐", category: StatusCategory.BUFF_MARK, duration: PERSIST, ref: WOODS_ID, known: true, stacks: after, skill: "枫起之舞", reason });
  else if (after < before) battle.trace.push({ t: "STACKS_CONSUMED", id: m.id, status: WOODS_ID, name: "林隐", from: before, to: after, reason, skill: "叶刃" });
  syncGuards(battle, m);
}

/** 枫起之舞 effects (active cast and the L5 先机). */
export function mapleDance(battle: any, m: Entity, reason: string): void {
  setWoods(battle, m, MOMIJI.woodsStacks, reason);
}

// ───────────────────────── 叶刃 ─────────────────────────

/** Damage hook for 388_01 while in 林隐 (叶刃); null otherwise (generic 乌翎). */
export function leafBladeHook(x: any): { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> } | null {
  if (x?.id !== "388_01") return null;
  return {
    kind: "LEAF_BLADE_OR_CROW",
    run: async (battle, self, hurt, primary) => {
      const inWoods = woodsStacks(self) > 0;
      const ratio = inWoods ? MOMIJI.bladeRatio : Number(x.damage?.[0]?.ratioMax ?? x.damage?.[0]?.ratio ?? 125);
      let cur: Entity | null = primary?.alive && primary.teamId !== self.teamId ? primary : (aliveEnemies(battle, self)[0] ?? null);
      const strikes = inWoods ? 1 + MOMIJI.bladeBounces : 1;
      for (let h = 0; h < strikes && cur; h++) {
        const victim: Entity = cur;
        await battle.withinResolution({ id: "HIT:" + (inWoods ? "叶刃" : x.name) + "#" + (h + 1), type: "HIT" }, async () => {
          if (!victim.alive) return;
          if (!hurt.includes(victim)) hurt.push(victim);
          await battle.damage(self, victim, self.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, x.lifesteal ?? null);
        });
        if (h + 1 >= strikes) break;
        const pool = aliveEnemies(battle, self);
        const others = pool.filter(v => v.id !== victim.id);
        const cands = others.length ? others : pool;
        if (!cands.length) break;
        const top = Math.max(...cands.map(burntStacks));
        const best = cands.filter(v => burntStacks(v) === top);
        battle.rng.expect("momiji388_bounce#" + (h + 1));
        cur = best.length > 1 ? (battle.rng.pick(best) ?? best[0]) : best[0];
      }
      if (inWoods) {
        battle.trace.push({ t: "SKILL_FORM", actor: self.id, skill: x.name, as: "叶刃", strikes, ratio });
        if (inOwnTurn(battle, self)) setWoods(battle, self, woodsStacks(self) - 1, "LEAF_BLADE_CAST");
      }
    },
  };
}

// ───────────────────────── AI ─────────────────────────

/** KB AI: 枫起之舞 when not in 林隐 and affordable, otherwise the normal attack. */
export function momijiRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isMomiji388(self)) return null;
  const dance = skillById(self, "388_03");
  const c = costOf(dance);
  if (woodsStacks(self) === 0 && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c))) return { skill: dance, rule: "心狩鬼女红叶: 未处于林隐 → 枫起之舞 (KB AI)" };
  const basic = skillById(self, "388_01");
  return basic ? { skill: basic, rule: woodsStacks(self) > 0 ? "心狩鬼女红叶: 林隐中 → 叶刃 (KB AI)" : "心狩鬼女红叶: 鬼火不足 → 乌翎" } : null;
}

/** 枫起之舞 cannot be cast while in 林隐. */
export function momijiGate(self: Entity, sk: any): string | null {
  return sk?.ir?.id === "388_03" && woodsStacks(self) > 0 ? "IN_WOODS" : null;
}

export function momijiAfterCast(battle: any, self: Entity, x: any): boolean {
  if (x?.id !== "388_03") return false;
  mapleDance(battle, self, "CAST");
  return true;
}

// ───────────────────────── handlers ─────────────────────────

function recomputeDefense(res: any, def: number): void {
  const old = Number(res.defenseMultiplier);
  if (!(old > 0)) return;
  const next = DEF_CONSTANT / (DEF_CONSTANT + Math.max(0, def));
  res.final *= next / old;
  res.defenseMultiplier = next;
}

function onBeforeDamage(battle: any, m: Entity, ctx: any): void {
  const src: Entity | undefined = ctx?.input?.source;
  const dst: Entity | undefined = ctx?.input?.target;
  const res = ctx?.result;
  if (!src || !dst || !res || !m.alive) return;
  const isIndirect = res.type === DamageType.INDIRECT;
  // 林隐 L2: her attacks ignore 200 DEF.
  if (src.id === m.id && woodsStacks(m) > 0 && res.type === DamageType.NORMAL && dst.teamId !== m.teamId) {
    recomputeDefense(res, dst.prop("def") - MOMIJI.woodsDefIgnore);
  }
  // 林隐 L4 on herself.
  if (dst.id === m.id && woodsStacks(m) > 0 && !res.ignoresModifiers) {
    res.final *= isIndirect ? 1 + MOMIJI.woodsIndirect : 1 - MOMIJI.woodsCut;
  }
  // 经霜 L5: the attacker's 叶烬 stacks lower the crit rate of attacks on her.
  if (dst.id === m.id && src.teamId !== m.teamId && res.isCrit && res.critMultiplier > 1) {
    const stacks = stacksOn(src, BURNT_ID, m.id);
    if (stacks > 0) {
      const cri = Math.max(0, src.prop("cri"));
      const keep = cri > 0 ? Math.max(0, cri - MOMIJI.critPerStack * stacks) / cri : 0;
      battle.rng.expect("momiji388_crit_cut");
      if (!battle.rng.testHit(keep)) {
        res.final /= res.critMultiplier;
        res.raw /= res.critMultiplier;
        res.isCrit = false;
        res.critMultiplier = 1;
        battle.trace.push({ t: "CRIT_CANCELLED", src: src.id, dst: m.id, by: BURNT_ID, stacks, keep, skill: "经霜" });
      }
    }
  }
}

/** 叶烬 on the bearer of indirect damage (global: the debuff outlives Momiji). */
function onBurntBeforeDamage(battle: any, ctx: any): void {
  const dst: Entity | undefined = ctx?.input?.target;
  const res = ctx?.result;
  if (!dst || !res || res.type !== DamageType.INDIRECT || res.ignoresModifiers) return;
  const stacks = burntStacks(dst);
  if (!(stacks > 0)) return;
  recomputeDefense(res, dst.prop("def") - MOMIJI.poisonDef * stacks);
  res.final *= 1 + MOMIJI.indirectPerStack * stacks;
}

async function onMomijiHit(battle: any, m: Entity, ctx: any): Promise<void> {
  const v: Entity | undefined = ctx?.input?.target;
  if (ctx?.input?.source?.id !== m.id || !v || v.teamId === m.teamId) return;
  if (String(ctx?.input?.skillTag ?? "").startsWith(TAG)) return;
  const sk = currentSkillOf(battle, m);
  if (!sk || !String(sk.ir?.id ?? "").startsWith("388_")) return;
  const eroded = v.statuses.some(s => s.def.id === EROSION_ID && s.sourceId === m.id);
  applyBurnt(battle, m, v, "ATTACK");
  if (eroded && v.alive) await indirect(battle, m, v, MOMIJI.erosionRatio, "红蚀");
}

async function onAllyDebuffed(battle: any, m: Entity, ctx: any): Promise<void> {
  const ally: Entity | undefined = ctx?.entity;
  if (!ally || ally.teamId !== m.teamId || ctx.merged) return;
  const st = ctx.status;
  if (!st || !String(st.def?.category ?? "").startsWith("DEBUFF")) return;
  const src = entity(battle, st.sourceId);
  if (!src?.alive || src.teamId === m.teamId) return;
  const key = String(battle.turn);
  if (noteValue(m, "momiji388:l3=") === key) return;   // 每回合内最多触发1次
  setNote(m, "momiji388:l3=", key);
  applyBurnt(battle, m, src, "ALLY_DEBUFFED");
}

/** IR patches (MAX): 林隐 / 叶之护 are run by betting-momiji.ts. */
export const MOMIJI_PATCHES = Object.freeze({
  "388_01": { note: "乌翎: [buff_3885_1] is the 叶刃 condition, not a gain (betting-momiji.ts)", patch: { statusRefConditionOnly: [0] } },
  "388_03": { note: "枫起之舞: 林隐 (2 stacks) and 叶之护 are applied by betting-momiji.ts", patch: { statusRefConditionOnly: [0, 1] } },
});

const opened = new WeakSet<object>();

export function installMomiji(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isMomiji388);
  for (const m of units) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:388:" + code + ":" + m.id, m.id, code, fn, range);
    reg(EV.BEFORE_DAMAGE, ctx => onBeforeDamage(battle, m, ctx));
    reg(EV.AFTER_DAMAGE, ctx => onMomijiHit(battle, m, ctx));
    reg(EV.STATUS_ADD, ctx => onAllyDebuffed(battle, m, ctx));
    reg(EV.DEATH, (ctx: any) => { if (ctx?.target?.id === m.id && !m.alive) syncGuards(battle, m); });
    onBarIncrease(battle, "momiji:l4:" + m.id, (v: Entity, percent: number) => {
      if (!m.alive || v.teamId === m.teamId || percent < MOMIJI.barThreshold - 1e-9) return;
      if (m.statuses.some(s => s.def.suppressPassive)) return;
      applyBurnt(battle, m, v, "BAR_UP_30");
    });
    out.push({ entityId: m.id, mechanic: "经霜 (叶烬 / 红蚀) · 林隐 / 叶之护 · 叶刃 · 枫起之舞 先机" });
  }
  if (!units.length) return out;
  // Statuses that outlive Momiji: global handlers.
  ensureGlobalHandler(battle, "betting:388:burnt-dmg", EV.BEFORE_DAMAGE, (ctx: any) => onBurntBeforeDamage(battle, ctx));
  ensureGlobalHandler(battle, "betting:388:tick", EV.TURN_START, async (ctx: any) => {
    const v: Entity | undefined = ctx?.actor;
    if (!v?.alive) return;
    for (const st of v.statuses.filter(s => s.def.id === BURNT_ID)) {
      const m = entity(battle, st.sourceId);
      if (m) await indirect(battle, m, v, MOMIJI.tickRatio, "叶烬");
    }
  });
  ensureGlobalHandler(battle, "betting:388:decay", EV.TURN_END, (ctx: any) => {
    const v: Entity | undefined = ctx?.actor;
    if (!v) return;
    for (const st of v.statuses.filter(s => s.def.id === BURNT_ID)) {
      const m = entity(battle, st.sourceId);
      if (!m) continue;
      const before = st.stacks;
      const after = setBurnt(v, m, before - 1);
      battle.trace.push({ t: "STACKS_CONSUMED", id: v.id, status: BURNT_ID, name: "叶烬", from: before, to: after, reason: "TURN_END", skill: "经霜" });
    }
  });
  ensureGlobalHandler(battle, "betting:388:guard", EV.AFTER_DAMAGE, (ctx: any) => {
    const dst: Entity | undefined = ctx?.input?.target;
    const src: Entity | undefined = ctx?.input?.source;
    if (!dst || !src || src.teamId === dst.teamId || !src.alive) return;
    const g = dst.statuses.find(s => s.def.id === GUARD_ID);
    const m = g ? entity(battle, g.sourceId) : null;
    if (!g || !m) return;
    const key = String(battle.turn);
    if (noteValue(dst, "momiji388:guard=") === key) return;   // 每个回合内最多触发1次
    setNote(dst, "momiji388:guard=", key);
    applyBurnt(battle, m, src, "LEAF_GUARD");
  });
  onBarAdjust(battle, "momiji:erosion", (e: Entity, percent: number) =>
    (e.statuses.some(s => s.def.id === EROSION_ID) ? percent * (1 - MOMIJI.erosionBarCut) : percent));
  ensureGlobalHandler(battle, "betting:388:start", EV.BATTLE_START, () => {
    if (opened.has(battle)) return;   // BATTLE_START reaches global handlers once per unit
    opened.add(battle);
    for (const m of units) {
      if (!m.alive || !skillById(m, "388_03")) continue;
      battle.trace.push({ t: "SUBCAST", actor: m.id, ref: "388_03", skill: "枫起之舞", target: m.id, clause: "[tips_7]先机：施放『枫起之舞』" });
      mapleDance(battle, m, "SENKI");
    }
  });
  return out;
}
