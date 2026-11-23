// compile/betting-yoto.ts — 妖刀姬·绯夜猎刃 (UR 593, Global "Yoto Hime, Scarlet Nightedge") at max skill level.
// MAX mode only.
//
// Identity: the Global name "Yoto Hime, Scarlet Nightedge" is the UR 593 (fandom "Youtou Hime · Hiyaryoujin",
// name_gl), not SP 328 赤影妖刀姬 (Global "Crimson Yoto"). The lineup panels agree: SPD 116 = 593's base SPD
// exactly (328 has 111 in data/kb/shikigami.full.json). data/kb/en-names.json maps the name to 593.
//
// Sources: data/kb/shikigami.json 593_01..593_04, buff 5931_1 悬赏, tips_7 先机 / tips_11 唯一效果 / tips_17
// 无法动作 / tips_19 孤立; fandom Youtou Hime · Hiyaryoujin/Main (same text in English); the observed-behaviour
// note "casts skill 3 whenever onibi is enough"; data/kb/ai.json 593 (2技能 when no Bounty exists).
//
//   悬赏 (buff_5931_1)  · 通用印记, at most 1 on the enemy side. While it exists she ignores 50% DEF on every
//                        attack. When its bearer's turn ends she gains 30% action bar, at most once before each
//                        of her turn starts.
//   霞光小调 (593_02)    · tips_11 (one per team: the first in the lineup). Active, 0 onibi: Bounty on the chosen
//                        enemy (moved, never doubled). L5 先机: cast at battle start on the fastest non-summon
//                        enemy (ties: random). L2: Bounty bearer below 90% HP ⇒ she gains 60 SPD. L3: while Bounty
//                        exists her damage counts as 孤立 (cannot be shared / redirected). L4: Bounty bearer below
//                        60% HP ⇒ 追猎新章's damage reduction and control-immunity chance are doubled (80% / 100%).
//   午夜猎歌 (593_03)    · 6 hits of 60% ATK (L4) on the target. If Bounty exists, one more hit on the Bounty bearer
//                        at half the coefficient (guides: "额外攻击该目标一次(伤害减半)"; the KB text gives no
//                        count). L3: +10 percentage points of coefficient per enemy non-summon defeated (whole
//                        battle, cap +50). L5: whenever an enemy non-summon is defeated, a free cast on the
//                        lowest-HP other enemy, at most once before each of her turn starts (needs her able to act).
//   追猎新章 (593_04)    · innate for the UR form (the 联结切换 part only applies to a linked lower tier): damage
//                        taken -40%; if not 无法动作, a control effect has a 50% chance to be immune; "此效果触发时
//                        进行反击（每个回合限1次）": she counters (basic attack, pseudo turn) when the damage reduction
//                        triggers on a hit from an enemy that landed, or when the control immunity triggers. "Once
//                        per turn" = once per battle.turn (any unit's turn): the match-4 replay shows ~12 counters,
//                        about one per round, more than her own turns. Needs her able to act; counters never chain.
//                        The immunity is resolved right after the control lands (STATUS_ADD): the status is removed
//                        again, nothing it did on application is undone.
//   Seals               · no 593 handler is a passive for the seal checks: 593_02 / 593_03 parts are active-skill
//                        rules, 593_04 is the UR form's innate trait (YOTO_04_SEALABLE = false) — chosen because the
//                        replay shows her countering while 御怨般若's 封印结界 (passives suppressed) was open.
//   AI                  · 午夜猎歌 whenever affordable (user-confirmed); else 霞光小调 when no Bounty exists (KB AI
//                        row); else 锋芒前奏. Targets (KB, HIGH): 午夜猎歌 the highest HP ratio enemy (ties: the
//                        higher HP), 霞光小调 the lowest HP ratio enemy ("存疑" in the KB). See betting-ai-rules.ts.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, levelNumber, ensureGlobalHandler,
  noteValue, setNote, shiftBar, isControlDef, registerOwnerHandler,
} from "./betting-shared.ts";

/**
 * 追猎新章 (593_04) and passive seals: false = not sealed by 压制 / 封印结界 / 震骨 (see the header).
 * Exported so the decision is visible and testable; the handlers read it through registerOwnerHandler.
 */
export const YOTO_04_SEALABLE = false;

export const YOTO = Object.freeze({
  defIgnore: 0.5,          // buff_5931_1: 攻击无视50%防御
  bountyBar: 0.3,          // buff_5931_1: 提升30%行动条
  spdBonus: 60,            // 593_02 L2: 自身提升60点速度
  spdBelow: 0.9,           //            处于悬赏的目标生命低于90%时
  doubleBelow: 0.6,        // 593_02 L4: 处于悬赏的目标生命低于60%时 … 加倍
  damageCut: 0.4,          // 593_04: 受到的伤害降低40%
  controlImmune: 0.5,      // 593_04: 受到控制效果时50%概率免疫
  huntRatioL1: 50,         // 593_03: 每次造成攻击50%伤害 (L4: 60%)
  huntHits: 6,             // 593_03: 攻击敌方目标6次
  extraHitFactor: 0.5,     // 593_03: 额外攻击…伤害系数减半
  perKill: 10,             // 593_03 L3: 伤害系数提升10%
  perKillCap: 50,          //            至多提升50%
});

const BOUNTY_ID = "5931_1";
const SPD_ID = "593_bounty_spd";
const DEF_CONSTANT = 300;  // kernel/damage.ts defenseMultiplier = 300 / (300 + def)
const NOTE_KILLS = "yoto593:kills=";
const NOTE_BAR = "yoto593:barUsed=";
const NOTE_FREE = "yoto593:freeUsed=";
const NOTE_S2 = "yoto593:s2target=";
const NOTE_COUNTER = "yoto593:counter=";

const bountyDefOf = () => markDef({ id: BOUNTY_ID, name: "悬赏", category: StatusCategory.COMMON_MARK, dispellable: true, removable: true,
  desc: "【通用、印记】敌方场上至多存在1个，存在时妖刀姬·绯夜猎刃攻击无视50%防御。携带者回合结束后，妖刀姬·绯夜猎刃提升30%行动条（每个回合开始前限1次）。（betting: 持续到被移走或携带者阵亡）" }, StatusBook);
const spdDefOf = () => markDef({ id: SPD_ID, name: "霞光小调·加速", category: StatusCategory.BUFF_STATE,
  desc: "霞光小调 L2：处于悬赏的目标生命低于90%时，自身提升60点速度。" }, StatusBook);

export const isYoto593 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "593_02") && !!skillById(e, "593_03");

const hpRatio = (e: Entity): number => (e.maxHp > 0 ? e.hp / e.maxHp : 0);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);

/** tips_11 唯一效果: the first 593 of the team runs 霞光小调. */
function hunterOf(battle: any, teamId: number): Entity | null {
  return (battle.teams[teamId]?.members ?? []).find((m: Entity) => isYoto593(m)) ?? null;
}

/** Living enemy carrying her Bounty, or null. */
export function bountyHolder(battle: any, self: Entity): Entity | null {
  return aliveEnemies(battle, self).find(v => v.statuses.some(s => s.def.id === BOUNTY_ID && s.sourceId === self.id)) ?? null;
}

export const huntKills = (e: Entity): number => Number(noteValue(e, NOTE_KILLS) ?? 0);

/** 午夜猎歌 coefficient (percent): max-level ratio + 10 points per enemy non-summon defeated (cap +50). */
export function huntRatioOf(self: Entity, x: any): number {
  const d = x?.damage?.[0];
  const base = Number(d?.ratioMax ?? d?.ratio ?? YOTO.huntRatioL1);
  const per = levelNumber(x, /伤害系数提升(\d+(?:\.\d+)?)%/, null, YOTO.perKill);
  const cap = levelNumber(x, /至多提升(\d+(?:\.\d+)?)%/, null, YOTO.perKillCap);
  return base + Math.min(cap, per * huntKills(self));
}

// ───────────────────────── Bounty ─────────────────────────

export function placeBounty(battle: any, self: Entity, target: Entity | null, reason: string): void {
  if (!target?.alive || target.teamId === self.teamId) return;
  for (const v of battle.enemiesOf(self.teamId) as Entity[]) {
    if (v.id === target.id) continue;
    for (const st of [...v.statuses]) {
      if (st.def.id !== BOUNTY_ID || st.sourceId !== self.id || !v.expireStatus(st)) continue;
      battle.trace.push({ t: "STATUS_REMOVE", id: v.id, status: BOUNTY_ID, name: st.def.name, by: "MOVED", side: "ENEMY", what: "MARK", src: self.id, skill: "霞光小调" });
      battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: v, status: BOUNTY_ID, name: st.def.name, by: "MOVED", side: "ENEMY", what: "MARK", src: self.id, skill: "霞光小调" }, v.id, v.teamId);
    }
  }
  const def = bountyDefOf();
  const ex = target.statuses.find(s => s.def.id === BOUNTY_ID && s.sourceId === self.id);
  if (ex) ex.remaining = PERSIST;
  else {
    const a = target.addStatus(def, self.id, 1, PERSIST, [], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: target.id, status: BOUNTY_ID, name: def.name, category: def.category, duration: PERSIST, ref: BOUNTY_ID, known: true, tag: a.tag, skill: "霞光小调", reason });
  }
  refreshSpeed(battle, self);
}

/** L2: +60 SPD while the Bounty bearer is below 90% HP (re-evaluated after damage / heals / turns). */
export function refreshSpeed(battle: any, self: Entity): void {
  const h = self.alive ? bountyHolder(battle, self) : null;
  const want = !!h && hpRatio(h) < YOTO.spdBelow;
  const st = self.statuses.find(s => s.def.id === SPD_ID);
  if (want && !st) {
    const def = spdDefOf();
    const a = self.addStatus(def, self.id, 1, PERSIST, [{ prop: "spd", value: YOTO.spdBonus, mode: "FIXED" }], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: self.id, status: SPD_ID, name: def.name, category: def.category, duration: PERSIST, ref: SPD_ID, known: true, tag: a.tag, skill: "霞光小调", note: "Bounty bearer " + h!.id + " below 90% HP" });
  } else if (!want && st && self.expireStatus(st)) {
    battle.trace.push({ t: "STATUS_EXPIRE", id: self.id, status: SPD_ID, reason: "CONDITION" });
  }
}

/** L4: the Bounty bearer is below 60% HP ⇒ 追猎新章 doubled. */
function doubled(battle: any, self: Entity): boolean {
  const h = bountyHolder(battle, self);
  return !!h && hpRatio(h) < YOTO.doubleBelow;
}
export const damageCutOf = (battle: any, self: Entity): number => Math.min(1, YOTO.damageCut * (doubled(battle, self) ? 2 : 1));
export const controlImmuneOf = (battle: any, self: Entity): number => Math.min(1, YOTO.controlImmune * (doubled(battle, self) ? 2 : 1));

/** After an AI cast of 霞光小调 (the target was recorded by aiRuleTarget). */
export function afterTwilight(battle: any, self: Entity): void {
  const id = Number(noteValue(self, NOTE_S2) ?? NaN);
  const target = aliveEnemies(battle, self).find(v => v.id === id) ?? aliveEnemies(battle, self)[0] ?? null;
  placeBounty(battle, self, target, "CAST");
}
export const recordTwilightTarget = (self: Entity, target: Entity): void => setNote(self, NOTE_S2, target.id);

// ───────────────────────── 午夜猎歌 ─────────────────────────

export function huntHook(x: any): { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> } | null {
  if (x?.id !== "593_03" || !Array.isArray(x.damage) || !x.damage.length) return null;
  const d = x.damage[0];
  return {
    kind: "MIDNIGHT_HUNT",
    run: async (battle, self, hurt, primary) => {
      const ratio = huntRatioOf(self, x);
      const target = primary?.alive && primary.teamId !== self.teamId ? primary : null;
      const hits = Math.max(1, Number(x.hits ?? YOTO.huntHits));
      for (let h = 0; h < hits && target; h++) {
        await battle.withinResolution({ id: "HIT:" + x.name + "#" + (h + 1), type: "HIT" }, async () => {
          if (!target.alive) return;
          if (!hurt.includes(target)) hurt.push(target);
          await battle.damage(self, target, self.prop("atk") * (ratio / 100), d.type ?? DamageType.NORMAL, 1, x.lifesteal ?? null);
        });
      }
      const holder = bountyHolder(battle, self);
      if (!holder) return;
      await battle.withinResolution({ id: "HIT:" + x.name + "#bounty", type: "HIT" }, async () => {
        if (!holder.alive) return;
        if (!hurt.includes(holder)) hurt.push(holder);
        await battle.damage(self, holder, self.prop("atk") * (ratio * YOTO.extraHitFactor / 100), d.type ?? DamageType.NORMAL, 1, x.lifesteal ?? null);
      });
    },
  };
}

// ───────────────────────── handlers ─────────────────────────

function onBeforeDamage(battle: any, self: Entity, ctx: any): void {
  const src: Entity | undefined = ctx?.input?.source;
  const dst: Entity | undefined = ctx?.input?.target;
  const res = ctx?.result;
  if (!src || !dst || !res || !self.alive) return;
  if (src.id === self.id && dst.teamId !== self.teamId && bountyHolder(battle, self)) {
    // 悬赏: ignore 50% DEF (same recomputation as 网切, soul/custom-effects.ts); L3: counts as 孤立.
    const old = Number(res.defenseMultiplier);
    const def = Math.max(0, dst.prop("def"));
    if (old > 0 && old < 1 && def > 0) {
      const next = DEF_CONSTANT / (DEF_CONSTANT + def * (1 - YOTO.defIgnore));
      res.final *= next / old;
      res.defenseMultiplier = next;
    }
    res.canBeShared = false;
  }
  if (dst.id === self.id && !res.ignoresModifiers && src.teamId !== self.teamId) {
    res.final *= 1 - damageCutOf(battle, self);   // 追猎新章 (L4: doubled)
    (reductionHit.get(battle) ?? reductionHit.set(battle, new WeakSet()).get(battle)!).add(ctx.input);
  }
}

/** Damage inputs on which 追猎新章's damage reduction triggered (transient, per battle). */
const reductionHit = new WeakMap<object, WeakSet<object>>();

/** 追猎新章 counter: at most once per turn (any unit's turn: battle.turn), only if she can act. */
async function huntCounter(battle: any, self: Entity, attackerId: number, reason: string): Promise<void> {
  const key = String(battle.turn);
  if (noteValue(self, NOTE_COUNTER) === key) return;   // 每个回合限1次
  const attacker = aliveEnemies(battle, self).find(v => v.id === attackerId);
  if (!attacker || !self.alive || isActionPrevented(self.statusDefs())) return;
  const cur = battle.bus.currentEvent;
  if (cur !== null && battle.bus.ancestry(cur).some((n: any) => n.code === TurnType.PSEUDO_TURN)) return;   // counters do not chain
  setNote(self, NOTE_COUNTER, key);
  battle.trace.push({ t: "COUNTER_TRIGGER", actor: self.id, target: attackerId, skill: "追猎新章", reason });
  await battle.counterAttack(self, attackerId);
}

/** "受到的伤害降低40%…此效果触发时进行反击": the reduction triggered on a hit that landed ⇒ counter. */
async function onAfterDamage(battle: any, self: Entity, ctx: any): Promise<void> {
  refreshSpeed(battle, self);
  const src: Entity | undefined = ctx?.input?.source;
  if (!src || ctx?.input?.target?.id !== self.id || !reductionHit.get(battle)?.has(ctx.input)) return;
  if (!(Number(ctx.result?.applied ?? 0) + Number(ctx.result?.absorbed ?? 0) > 0)) return;
  await huntCounter(battle, self, src.id, "DAMAGE_REDUCED");
}

async function onStatusAdd(battle: any, self: Entity, ctx: any): Promise<void> {
  if (ctx?.entity?.id !== self.id || !self.alive || ctx.merged) return;
  const def = StatusBook.get(String(ctx.status ?? ""));
  if (!def || !isControlDef(def)) return;
  const st = [...self.statuses].reverse().find(s => s.def.id === def.id);
  if (!st || st.sourceId === self.id) return;
  // "若未处于无法动作": judged without the control that just landed.
  if (isActionPrevented(self.statuses.filter(s => s !== st).map(s => s.def))) return;
  const p = controlImmuneOf(battle, self);
  battle.rng.expect("yoto593_control_immune:" + def.id);
  if (!battle.rng.testHit(p)) return;
  if (!self.expireStatus(st)) return;
  battle.trace.push({ t: "IMMUNE", src: st.sourceId, dst: self.id, status: def.id, name: def.name, by: "593_04", kind: "CONTROL", consumed: false, skill: "追猎新章", probability: p });
  await huntCounter(battle, self, st.sourceId, "CONTROL_IMMUNE");
}

async function onDeath(battle: any, self: Entity, ctx: any): Promise<void> {
  const v: Entity | undefined = ctx?.target;
  if (!v || v.teamId === self.teamId || isSummonUnit(v) || v.alive) return;
  setNote(self, NOTE_KILLS, Math.min(99, huntKills(self) + 1));
  refreshSpeed(battle, self);
  if (!self.alive || noteValue(self, NOTE_FREE) === "1" || isActionPrevented(self.statusDefs())) return;
  const hunt = skillById(self, "593_03");
  const pool = aliveEnemies(battle, self);
  if (!hunt || !pool.length) return;
  const target = pool.reduce((a, b) => (b.hp < a.hp ? b : a), pool[0]);
  setNote(self, NOTE_FREE, 1);
  battle.trace.push({ t: "SUBCAST", actor: self.id, ref: "593_03", skill: hunt.name, target: target.id,
    clause: "每当敌方非召唤物目标被击败时，对生命最低的其他敌方无消耗施放（自身每个回合开始前限1次）", killed: v.id });
  await battle.runPseudoTurn(self, TurnType.PSEUDO_TURN, { skill: hunt, target, free: true });
}

function onTurnEnd(battle: any, self: Entity, actor: Entity): void {
  if (!self.alive) return;
  const h = bountyHolder(battle, self);
  if (h && actor.id === h.id && noteValue(self, NOTE_BAR) !== "1") {
    setNote(self, NOTE_BAR, 1);
    shiftBar(battle, self, YOTO.bountyBar, "悬赏");
  }
  refreshSpeed(battle, self);
}

function onTurnStart(battle: any, self: Entity, actor: Entity): void {
  if (actor.id === self.id) { setNote(self, NOTE_BAR, null); setNote(self, NOTE_FREE, null); }
  refreshSpeed(battle, self);
}

/** 先机: Bounty on the fastest non-summon enemy (ties: random). */
function openingBounty(battle: any, self: Entity): void {
  const pool = aliveEnemies(battle, self).filter(v => !isSummonUnit(v));
  if (!pool.length) return;
  const top = Math.max(...pool.map(v => v.prop("spd")));
  const fastest = pool.filter(v => Math.abs(v.prop("spd") - top) < 1e-9);
  battle.rng.expect("yoto593_opening_bounty");
  const target = fastest.length > 1 ? battle.rng.pick(fastest) : fastest[0];
  battle.trace.push({ t: "SUBCAST", actor: self.id, ref: "593_02", skill: "霞光小调", target: target.id, clause: "[tips_7]先机：对敌方速度最快的非召唤物目标施放" });
  placeBounty(battle, self, target, "SENKI");
}

// ───────────────────────── installation ─────────────────────────

/** IR patches (MAX): the Bounty slots are conditions; the mark itself is placed by placeBounty. */
export const YOTO_IR_PATCHES = Object.freeze({
  "593_02": { note: "霞光小调: Bounty (max 1 on the enemy side, moved) is placed by betting-yoto.ts after the cast", patch: { statusRefConditionOnly: [0] } },
  "593_03": { note: "午夜猎歌: both Bounty slots are conditions ('若悬赏存在' / '额外攻击处于悬赏的目标'), not gains", patch: { statusRefConditionOnly: [0, 1] } },
});

/** Battles whose 先机 Bounty was already placed (transient). */
const opened = new WeakSet<object>();

export function installYoto(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const e of entities.filter(isYoto593)) {
    out.push({ entityId: e.id, mechanic: "悬赏 · 追猎新章 (counter) · 午夜猎歌 L3/L5" });
    // None of these handlers is sealed by "passives fail" (压制, 封印结界, 震骨): Bounty / DEF ignore / bar gain /
    // speed (593_02) and the kill rules (593_03 L3/L5) come from active skills; 追猎新章 (593_04) is treated as an
    // innate trait of the UR form (YOTO_04_SEALABLE: the match-4 replay shows her countering under 封印结界).
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void) =>
      registerOwnerHandler(battle, "betting:593:" + code + ":" + e.id, e.id, code, fn, "ALL", { passive: false });
    reg(EV.BEFORE_DAMAGE, ctx => onBeforeDamage(battle, e, ctx));
    reg(EV.AFTER_DAMAGE, ctx => onAfterDamage(battle, e, ctx));
    reg(EV.STATUS_ADD, ctx => onStatusAdd(battle, e, ctx));
    reg(EV.DEATH, ctx => onDeath(battle, e, ctx));
    reg(EV.TURN_END, ctx => { if (ctx?.actor) onTurnEnd(battle, e, ctx.actor); });
    reg(EV.TURN_START, ctx => { if (ctx?.actor) onTurnStart(battle, e, ctx.actor); });
  }
  if (!out.length) return out;
  ensureGlobalHandler(battle, "betting:593:start", EV.BATTLE_START, () => {
    if (opened.has(battle)) return;   // BATTLE_START reaches global handlers once per unit
    opened.add(battle);
    for (let ti = 0; ti < battle.teams.length; ti++) {
      const y = hunterOf(battle, ti);
      if (y?.alive) openingBounty(battle, y);
    }
  });
  return out;
}
