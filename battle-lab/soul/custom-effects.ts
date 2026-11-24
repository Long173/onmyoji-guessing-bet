// soul/custom-effects.ts — hand-written 4-piece soul effects the generic text interpreter
// (interpretEffect) cannot express. Each entry is keyed by the KB soul name and installs real
// EventBus handlers on the wearer.
//
// Shared rules:
//   · Damage created by a soul (tagged skillTag "soul:*") never re-triggers soul effects,
//     so reflect / proc damage cannot chain.
//   · Only damage whose result.triggersSoul is true counts as "dealing/taking damage" for souls.
//   · Every probability roll is tagged (a1-4 §20) and every effect leaves a trace entry.
//   · Unverified details (taunt penalties, exact proc damage typing) are listed in NOTES so the
//     report never claims more than what is implemented.
import { EV, DamageType, StatusCategory, TurnType } from "../kernel/types.ts";
import type { EventRange } from "../kernel/types.ts";
import { dealDamage, applyLifesteal, healTarget } from "../kernel/damage.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { StatusBook, controlDefByTipName, findImmuneStatus, incomingKinds, isActionPrevented } from "../kernel/status.ts";
import type { StatusDef } from "../kernel/status.ts";
import { grantExtraTurn } from "../kernel/extra-turn.ts";
import { rollStatusContest, reportResist } from "../kernel/resist.ts";
import { grantTimedShield, ensureShieldTicker, bettingActive, isSummonUnit, untargetableInBetting } from "../compile/betting-shared.ts";
import { makeBettingSouls, BETTING_SOUL_NOTES } from "./custom-effects-betting.ts";

export interface CustomSoulContext {
  battle: any;
  owner: any;
  soulId: number;
  name: string;
  /** called on every effect activation, for the install report */
  fired: (key: string) => void;
}

export type Installer = (c: CustomSoulContext) => void;

const SOUL_TAG = "soul:";
const isSoulDamage = (ctx: any) => typeof ctx?.input?.skillTag === "string" && ctx.input.skillTag.startsWith(SOUL_TAG);
const countsAsSoulDamage = (ctx: any) => !!ctx?.result?.triggersSoul && !isSoulDamage(ctx);

function register(c: CustomSoulContext, code: string, range: EventRange, fn: (ctx: any) => unknown) {
  c.battle.bus.register({
    id: `${c.owner.id}:SOUL${c.soulId}:${code}:custom`,
    ownerId: c.owner.id,
    code,
    range,
    priority: 20,
    passive: false,
    source: "SOUL",
    fn,
  });
}

function roll(c: CustomSoulContext, chance: number, what: string): boolean {
  const tag = `soul:${c.name}:${what}`;
  c.battle.rng.expect(tag);
  return c.battle.rng.testHit(chance);
}

function gainOrbs(c: CustomSoulContext, teamId: number, amount: number) {
  const orbs = c.battle.teams[teamId].orbs;
  const before = orbs.current;
  orbs.gain(amount);
  c.battle.queueEvent(EV.ORB_GAIN, { battle: c.battle, team: teamId, src: c.owner.id, skill: `${c.name}（4件套）` }, c.owner.id, teamId);
  c.battle.trace.push({ t: "ORB_GAIN", team: teamId, src: c.owner.id, skill: `${c.name}（4件套）`, requested: amount, before, after: orbs.current });
}

/** 破势 Shadow: +40% damage when the target's HP ratio is above 70%. */
const shadow: Installer = c => {
  register(c, EV.BEFORE_DAMAGE, "SELF", ctx => {
    if (!countsAsSoulDamage(ctx) || ctx.result.ignoresModifiers) return;
    const t = ctx.input.target;
    if (!(t.maxHp > 0) || t.hp / t.maxHp <= 0.7) return;
    ctx.result.final *= 1.4;
    c.fired("破势:boost");
    c.battle.trace.push({ t: "SOUL_PROC", soul: c.name, src: c.owner.id, dst: t.id, effect: "damage x1.4 (target HP > 70%)" });
  });
};

/** 针女 Seductress: on crit, 40% chance of defense-ignoring damage = 10% target max HP, capped at 120% ATK. */
const seductress: Installer = c => {
  register(c, EV.AFTER_DAMAGE, "SELF", async ctx => {
    if (!countsAsSoulDamage(ctx) || !ctx.result.isCrit) return;
    const t = ctx.input.target;
    if (!t.alive || !(t.hp > 0)) return;
    if (!roll(c, 0.4, "crit-proc")) return;
    const amount = Math.min(t.maxHp * 0.1, c.owner.prop("atk") * 1.2);
    c.fired("针女:proc");
    await dealDamage(c.battle, { source: c.owner, target: t, base: amount, rate: 1, type: DamageType.TRUE, skillTag: `${SOUL_TAG}针女` });
  });
};

/** 阴摩罗 Harpy: gain 3 onibi when the wearer defeats a target. */
const harpy: Installer = c => {
  register(c, EV.KILLED, "ENEMY", ctx => {
    if (ctx.killerId !== c.owner.id) return;
    c.fired("阴摩罗:kill");
    gainOrbs(c, c.owner.teamId, 3);
  });
};

/** 木魅 Tree Nymph: when any ally takes damage, 25% chance to remove 1 onibi from the attacker's team (max once per attack). */
const treeNymph: Installer = c => {
  let lastKey = "";
  register(c, EV.AFTER_DAMAGE, "ENEMY", ctx => {
    if (!countsAsSoulDamage(ctx)) return;
    const { source, target } = ctx.input;
    if (target.teamId !== c.owner.teamId) return;
    const key = `${c.battle.turn}:${source.id}`;
    if (key === lastKey) return;
    lastKey = key;
    if (!roll(c, 0.25, "drain")) return;
    const orbs = c.battle.teams[source.teamId].orbs;
    if (orbs.current < 1) return;
    const before = orbs.current;
    orbs.pay(1);
    c.fired("木魅:drain");
    c.battle.trace.push({ t: "ORB_DRAIN", team: source.teamId, src: c.owner.id, skill: `${c.name}（4件套）`, before, after: orbs.current });
  });
};

/** 镜姬 Mirror Lady: when the wearer takes damage, 30% chance to reflect 100% of it. */
const mirrorLady: Installer = c => {
  register(c, EV.AFTER_DAMAGE, "ENEMY", async ctx => {
    if (!countsAsSoulDamage(ctx)) return;
    const { source, target } = ctx.input;
    if (target.id !== c.owner.id || !source.alive || !(source.hp > 0)) return;
    const taken = ctx.result.applied + ctx.result.absorbed;
    if (!(taken > 0)) return;
    if (!roll(c, 0.3, "reflect")) return;
    c.fired("镜姬:reflect");
    await dealDamage(c.battle, { source: c.owner, target: source, base: taken, rate: 1, type: DamageType.FIXED, skillTag: `${SOUL_TAG}镜姬` });
    c.battle.trace.push({ t: "SOUL_PROC", soul: c.name, src: c.owner.id, dst: source.id, effect: `reflect ${GameMath.display(taken)}` });
  });
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Shared helpers for the status / proc / modifier souls below.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const soulSkill = (c: CustomSoulContext) => `${c.name}（4件套）`;
const isUp = (e: any) => !!e && e.alive && e.hp > 0;

function proc(c: CustomSoulContext, dst: number | null, effect: string) {
  c.battle.trace.push({ t: "SOUL_PROC", soul: c.name, src: c.owner.id, dst, effect });
}

/** 「对被嘲讽目标降低60%触发概率」: relative reduction (x0.4) when the other party is taunted / provoked. */
const TAUNT_PENALTY = 1 - 0.6;
const TAUNT_IDS = new Set(["taunt", "provoke"]);
const isTaunted = (e: any) => (e?.statuses ?? []).some((s: any) => TAUNT_IDS.has(s.def.id) || /嘲讽|挑衅/.test(String(s.def.name)));

/** A status counts as a slow when it lowers speed (a negative spd effect) or is named 减速. */
const isSlowed = (e: any) => (e?.statuses ?? []).some((s: any) =>
  /减速/.test(String(s.def.name)) || (s.effects ?? []).some((x: any) => x.prop === "spd" && x.value < 0));

/** Control effect by the engine's own criterion (kernel/status.ts incomingKinds). */
const hasControl = (e: any) => (e?.statuses ?? []).some((s: any) => incomingKinds(s.def, false).includes("CONTROL"));

function control(name: string): StatusDef {
  const d = controlDefByTipName(name);
  if (!d) throw new Error(`custom souls: control effect ${name} missing from kernel/status.ts`);
  return d;
}

/** 雪幽魂's slow (「使攻击者减速30点，持续1回合」). Not in the KB buff list ⇒ synthetic status, registered for restore. */
export const SNOW_SLOW_ID = "SOUL_SNOW_SLOW";
const SNOW_SLOW_SPD = -30;
const SNOW_SLOW: StatusDef = {
  id: SNOW_SLOW_ID, name: "减速", category: StatusCategory.DEBUFF_STATE,
  dispellable: true, removable: true, preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
  suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "SOURCE_TURN",
  desc: "雪幽魂（4件套）：速度降低30点，持续1回合",
};
if (!StatusBook.has(SNOW_SLOW_ID)) StatusBook.set(SNOW_SLOW_ID, SNOW_SLOW);

/**
 * Apply a status from a soul with the same rules as the skill executor (compile/character.ts, status
 * section): a written probability is one roll; an enemy debuff under a resist policy other than NONE is
 * contested even at 100% (SINGLE_ROLL_RATIO / COMMUNITY_TWO_ROLL, same effect-hit / effect-RES expression);
 * status immunity is checked last; every outcome leaves the same trace kinds and events as skills.
 * `chance === null` = the text gives no probability (applied unless resisted).
 */
async function applySoulStatus(c: CustomSoulContext, victim: any, def: StatusDef, chance: number | null, duration: number,
  effects: Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE" }> = []): Promise<boolean> {
  const { battle, owner: self } = c;
  if (!isUp(victim)) return false;
  const skill = soulSkill(c);
  // One contest for skills and souls (kernel/resist.ts): NONE ⇒ roll only a written chance; a resist
  // policy contests every enemy debuff (base 1 when unwritten) and reports RESIST via EV.RESIST.
  const contest = rollStatusContest(battle, self, victim, def, chance,
    `soul:${c.name}:status:${def.id}:${victim.id}`, `soul:${c.name}:resist:${def.id}:${victim.id}`);
  if (contest.outcome === "MISS") {
    battle.trace.push({
      t: "STATUS_MISS", src: self.id, dst: victim.id, status: def.id, name: def.name, probability: chance, skill,
      ...(contest.single ? { effective: contest.effective, efh: contest.efh, efr: contest.efr } : {}),
    });
    battle.queueEvent(EV.STATUS_MISS, { battle, src: self.id, dst: victim.id, status: def.id, name: def.name, probability: chance, skill }, self.id, self.teamId);
    return false;
  }
  if (contest.outcome === "RESIST") {
    await reportResist(battle, self, victim, def, contest, { probability: chance, duration, skill });
    return false;
  }
  const imm = findImmuneStatus(victim, def, battle.policies?.immune?.debuffCoversControl ?? true);
  if (imm) {
    battle.trace.push({ t: "IMMUNE", src: self.id, dst: victim.id, status: def.id, name: def.name, by: imm.def.id, kind: imm.kind, consumed: imm.consumed, skill });
    await battle.bus.dispatch(EV.IMMUNE, { target: victim, incoming: def, by: imm.def, kind: imm.kind },
      victim.id, victim.teamId, (id: number) => battle.teamOf(id));
    return false;
  }
  // Re-application from the same source refreshes the duration; stat effects are attached only once
  // (Entity.addStatus would push them again on merge).
  const already = victim.statuses.some((s: any) => s.def.id === def.id && s.sourceId === self.id);
  const applied = victim.addStatus(def, self.id, 1, duration, already ? [] : effects, 1);
  battle.trace.push({
    t: "STATUS_APPLY", src: self.id, dst: victim.id, status: def.id, name: def.name,
    category: def.category, duration, known: true, tag: applied?.tag ?? null, skill,
  });
  c.fired(`${c.name}:${def.id}`);
  return true;
}

/** Source-side damage multiplier (BEFORE_DAMAGE, the wearer is the attacker). */
function scaleDealt(c: CustomSoulContext, compute: (ctx: any) => { mul: number; effect: string } | null) {
  register(c, EV.BEFORE_DAMAGE, "SELF", ctx => {
    if (!countsAsSoulDamage(ctx) || ctx.result.ignoresModifiers) return;
    const r = compute(ctx);
    if (!r || r.mul === 1) return;
    ctx.result.final *= r.mul;
    c.fired(`${c.name}:boost`);
    proc(c, ctx.input.target.id, r.effect);
  });
}

/** Steps of HP lost, floored: `per` = 0.01 → whole percents, 0.15 → 15% bands. */
function lostSteps(e: any, per: number, where: string): number {
  if (!(e.maxHp > 0)) return 0;
  return GameMath.floorAt(Math.max(0, 1 - e.hp / e.maxHp) / per + 1e-9, where);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Control / proc souls
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** 魅妖 Temptress: on dealing damage, 25% base chance to confuse the target for 1 turn. */
const temptress: Installer = c => {
  register(c, EV.AFTER_DAMAGE, "SELF", async ctx => {
    if (!countsAsSoulDamage(ctx) || ctx.input.target.id === c.owner.id) return;
    await applySoulStatus(c, ctx.input.target, control("混乱"), 0.25, 1);
  });
};

/** 返魂香 Senecio: on taking damage, 25% base chance to stun the damager for 1 turn (x0.4 if the damager is taunted). */
const senecio: Installer = c => {
  register(c, EV.AFTER_DAMAGE, "ALL", async ctx => {
    if (!countsAsSoulDamage(ctx)) return;
    const { source, target } = ctx.input;
    if (target.id !== c.owner.id || source.id === c.owner.id || !isUp(source)) return;
    await applySoulStatus(c, source, control("眩晕"), isTaunted(source) ? 0.25 * TAUNT_PENALTY : 0.25, 1);
  });
};

/**
 * 雪幽魂 Snow Spirit: on dealing damage, 15% base chance (30% if the target is slowed) to freeze the
 * target for 1 turn; when attacked, the attacker is slowed by 30 speed for 1 turn (no probability written).
 */
const snowSpirit: Installer = c => {
  register(c, EV.AFTER_DAMAGE, "SELF", async ctx => {
    if (!countsAsSoulDamage(ctx) || ctx.input.target.id === c.owner.id) return;
    const t = ctx.input.target;
    await applySoulStatus(c, t, control("冰冻"), isSlowed(t) ? 0.3 : 0.15, 1);
  });
  register(c, EV.AFTER_DAMAGE, "ENEMY", async ctx => {
    if (!countsAsSoulDamage(ctx)) return;
    const { source, target } = ctx.input;
    if (target.id !== c.owner.id || !isUp(source)) return;
    await applySoulStatus(c, source, SNOW_SLOW, null, 1, [{ prop: "spd", value: SNOW_SLOW_SPD, mode: "FIXED" }]);
  });
};

/** 钟灵 Bell: on dealing damage, 10% base chance to stun the target for 1 turn; 20% when no enemy is stunned. */
const bell: Installer = c => {
  register(c, EV.AFTER_DAMAGE, "SELF", async ctx => {
    if (!countsAsSoulDamage(ctx) || ctx.input.target.id === c.owner.id) return;
    const anyStunned = c.battle.enemiesOf(c.owner.teamId).some((e: any) => e.hasStatus("stun"));
    await applySoulStatus(c, ctx.input.target, control("眩晕"), anyStunned ? 0.1 : 0.2, 1);
  });
};

/** 狰 Scarlet: on taking enemy damage, 35% chance to counter with a normal attack (x0.4 if the attacker is taunted). */
const scarlet: Installer = c => {
  register(c, EV.AFTER_DAMAGE, "ENEMY", async ctx => {
    if (!countsAsSoulDamage(ctx)) return;
    const { source, target } = ctx.input;
    const { battle, owner } = c;
    if (target.id !== owner.id || !isUp(owner) || !isUp(source)) return;
    if (untargetableInBetting(source)) return;   // betting: no counter on an untargetable attacker (BASE: always false)
    // Battle.counterAttack refuses immobile defenders and chained counters: check first, no wasted roll.
    if (isActionPrevented(owner.statusDefs())) return;
    const cur = battle.bus.currentEvent;
    if (cur !== null && battle.bus.ancestry(cur).some((n: any) => n.code === TurnType.PSEUDO_TURN)) return;
    const chance = isTaunted(source) ? 0.35 * TAUNT_PENALTY : 0.35;
    if (!roll(c, chance, "counter")) return;
    c.fired("狰:counter");
    proc(c, source.id, "counter");
    await battle.counterAttack(owner, source.id);
  });
};

/**
 * 应声虫 Echoer: 20% assist chance. 协战 (KB tips_9): when an ally normal-attacks an enemy target, the
 * wearer also normal-attacks the same target. An assist never triggers another assist.
 */
const assisting = new WeakSet<object>();
const echoer: Installer = c => {
  register(c, EV.SKILL_END, "TEAM", async ctx => {
    const { battle, owner } = c;
    const { actor, skill, target } = ctx;
    if (!actor || actor.id === owner.id || !skill || !target) return;
    const isBasic = (Number(skill.cost) || 0) === 0 && Array.isArray(skill.ir?.damage) && skill.ir.damage.length > 0;
    if (!isBasic || target.teamId === owner.teamId || !isUp(target) || !isUp(owner)) return;
    if (assisting.has(battle) || isActionPrevented(owner.statusDefs())) return;
    const basic = owner.skills.find((s: any) => (Number(s.cost) || 0) === 0) ?? null;
    if (!basic) return;
    if (!roll(c, 0.2, "assist")) return;
    c.fired("应声虫:assist");
    proc(c, target.id, `assist ally ${actor.id}`);
    assisting.add(battle);
    try {
      await battle.runPseudoTurn(owner, TurnType.PSEUDO_TURN, { skill: basic, target });
    } finally {
      assisting.delete(battle);
    }
  });
};

/**
 * 共潜 Merrow: at the end of the wearer's turn, dispel 1 random dispellable debuff from the wearer's side
 * (wearer or ally); 2 more when the wearer dealt no damage during that turn.
 */
const merrow: Installer = c => {
  let dealt = false;
  register(c, EV.TURN_START, "SELF", () => { dealt = false; });
  register(c, EV.AFTER_DAMAGE, "SELF", ctx => {
    if (ctx.input?.source?.id === c.owner.id && ctx.result.final > 0) dealt = true;
  });
  register(c, EV.TURN_END, "SELF", () => {
    const { battle, owner } = c;
    const skill = soulSkill(c);
    for (let i = 0; i < (dealt ? 1 : 3); i++) {
      const pool: Array<{ e: any; st: any }> = [];
      for (const e of battle.teams[owner.teamId].aliveMembers()) {
        for (const st of e.statuses) if (String(st.def.category).startsWith("DEBUFF") && st.def.dispellable) pool.push({ e, st });
      }
      if (!pool.length) return;
      battle.rng.expect(`soul:${c.name}:dispel`);
      const { e, st } = battle.rng.pick(pool)!;
      if (!e.dispel(st.def.id)) continue;
      c.fired("共潜:dispel");
      const what = { status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what: "DEBUFF", src: owner.id, skill };
      battle.trace.push({ t: "STATUS_REMOVE", id: e.id, ...what, order: "random" });
      battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: e, ...what }, e.id, e.teamId);
    }
  });
};

/** 蝠翼 Nightwing: damage dealt carries 20% lifesteal (basis from policies.lifesteal, like skill lifesteal). */
const nightwing: Installer = c => {
  register(c, EV.AFTER_DAMAGE, "SELF", async ctx => {
    if (!countsAsSoulDamage(ctx)) return;
    if (await applyLifesteal(c.battle, c.owner, 0.2, ctx.result, `${SOUL_TAG}蝠翼`) > 0) c.fired("蝠翼:lifesteal");
  });
};

/** 涅槃之火 Phoenix Fire: at the end of the wearer's action, if HP ratio < 30%, heal 15% of max HP. */
const phoenixFire: Installer = c => {
  register(c, EV.ACTION_END, "SELF", async () => {
    const o = c.owner;
    if (!isUp(o) || !(o.maxHp > 0) || o.hp / o.maxHp >= 0.3) return;
    c.fired("涅槃之火:heal");
    proc(c, o.id, "heal 15% max HP (HP < 30%)");
    await healTarget(c.battle, o, o, o.maxHp * 0.15);
  });
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Damage modifier souls
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** 镇墓兽 Tomb Guard: +0.5% crit damage (additive) per whole 1% of HP the wearer has lost, on its crits. */
const tombGuard: Installer = c => {
  register(c, EV.BEFORE_DAMAGE, "SELF", ctx => {
    if (!countsAsSoulDamage(ctx) || !ctx.result.isCrit) return;
    const lost = lostSteps(c.owner, 0.01, "soul:镇墓兽:lostPct");
    const cm = ctx.result.critMultiplier;
    if (!(lost > 0) || !(cm > 0)) return;
    const bonus = lost * 0.005;
    ctx.result.final *= (cm + bonus) / cm;
    ctx.result.critMultiplier = cm + bonus;
    c.fired("镇墓兽:crit");
    proc(c, ctx.input.target.id, `crit damage +${GameMath.display(bonus * 100)}% (HP lost ${lost}%)`);
  });
};

/** 鸣屋: on attack, +45% damage when the target has a control effect. */
const mingwu: Installer = c => scaleDealt(c, ctx =>
  hasControl(ctx.input.target) ? { mul: 1.45, effect: "damage x1.45 (target controlled)" } : null);

/** 心眼 Watcher: +10% damage per 15% of HP the target has lost. */
const watcher: Installer = c => scaleDealt(c, ctx => {
  const steps = lostSteps(ctx.input.target, 0.15, "soul:心眼:steps");
  return steps > 0 ? { mul: 1 + 0.1 * steps, effect: `damage +${steps * 10}% (target HP lost ${steps}x15%)` } : null;
});

/** 狂骨 Kyoukotsu: +8% damage per onibi the wearer's team holds when the damage is dealt. */
const kyoukotsu: Installer = c => scaleDealt(c, () => {
  const n = c.battle.teams[c.owner.teamId].orbs.current;
  return n > 0 ? { mul: 1 + 0.08 * n, effect: `damage +${n * 8}% (${n} onibi)` } : null;
});

/** 片叶之苇: +45% damage while the wearer's HP equals its max HP. */
const reed: Installer = c => scaleDealt(c, () =>
  c.owner.hp >= c.owner.maxHp ? { mul: 1.45, effect: "damage x1.45 (full HP)" } : null);

/** 网切: on attack, 50% chance to ignore 45% of the target's defense. */
const DEF_CONSTANT = 300;   // kernel/damage.ts defenseMultiplier = 300 / (300 + def)
const netCutter: Installer = c => {
  register(c, EV.BEFORE_DAMAGE, "SELF", ctx => {
    if (!countsAsSoulDamage(ctx)) return;
    const old = ctx.result.defenseMultiplier;
    const def = Math.max(0, ctx.input.target.prop("def"));
    if (!(old > 0) || old >= 1 || !(def > 0)) return;   // defense-ignoring types / zero defense: nothing to ignore
    if (!roll(c, 0.5, "ignoreDef")) return;
    const next = DEF_CONSTANT / (DEF_CONSTANT + def * (1 - 0.45));
    ctx.result.final *= next / old;
    ctx.result.defenseMultiplier = next;
    c.fired("网切:ignoreDef");
    proc(c, ctx.input.target.id, "ignore 45% defense");
  });
};

/** 被服: 30% damage reduction on soul-triggering, modifier-respecting damage the wearer takes. */
const kimono: Installer = c => {
  register(c, EV.BEFORE_DAMAGE, "ALL", ctx => {
    if (!countsAsSoulDamage(ctx) || ctx.result.ignoresModifiers || ctx.input.target.id !== c.owner.id) return;
    ctx.result.final *= 1 - 0.3;
    c.fired("被服:reduce");
    proc(c, c.owner.id, "damage taken x0.7");
  });
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Turn / shield / reflect souls
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 轮入道 Soultaker: 「回合结束时，有20%概率获得新的回合」. Rolled at every turn end of the wearer (an extra
 * turn included, so it can chain); the new turn is queued and played after the current one has finished
 * (kernel/extra-turn.ts → TurnType.NEW_TURN: counts as a turn, no onibi-gauge advance).
 */
const soultaker: Installer = c => {
  register(c, EV.TURN_END, "SELF", ctx => {
    if (ctx?.actor?.id !== c.owner.id || !isUp(c.owner)) return;
    if (!roll(c, 0.2, "extra-turn")) return;
    c.fired("轮入道:extra-turn");
    proc(c, c.owner.id, "extra turn (20%)");
    grantExtraTurn(c.battle, c.owner, `${c.name}（4件套）`);
  });
};

/**
 * 地藏像 Jizo Statue: 「受到暴击时，自身100%、友方30%概率获得1回合护盾，能吸收10%生命上限的伤害；对被嘲讽目标降低60%触发概率」.
 * Trigger: the wearer takes a soul-triggering crit from an enemy. The wearer (100%) and every other living
 * ally (30% each, one roll per ally) get a shield of 10% of THEIR OWN max HP (the receiver "获得…护盾，能吸收
 * 10%生命上限的伤害"; the text names no other owner) lasting 1 turn of the receiver (timed shield, the
 * creation turn counts). Chances x0.4 when the attacker is taunted / provoked. A new Jizo shield replaces
 * the receiver's previous one (no stacking).
 */
const JIZO_TAG = "soul-jizo";
const jizo: Installer = c => {
  ensureShieldTicker(c.battle);
  register(c, EV.AFTER_DAMAGE, "ENEMY", ctx => {
    if (!countsAsSoulDamage(ctx) || !ctx.result.isCrit) return;
    const { source, target } = ctx.input;
    const { battle, owner } = c;
    if (target.id !== owner.id || source.teamId === owner.teamId) return;
    const penalty = isTaunted(source) ? TAUNT_PENALTY : 1;
    const receivers: Array<{ e: any; p: number }> = [
      { e: owner, p: 1 * penalty },
      ...battle.teams[owner.teamId].aliveMembers().filter((m: any) => m.id !== owner.id).map((m: any) => ({ e: m, p: 0.3 * penalty })),
    ];
    for (const { e, p } of receivers) {
      if (!isUp(e)) continue;
      if (p < 1 && !roll(c, p, `shield:${e.id}`)) continue;
      for (const sh of e.shields ?? []) if (!sh.broken && String(sh.id).startsWith(`sh_${JIZO_TAG}_`)) sh.broken = true;
      grantTimedShield(battle, owner, e, e.maxHp * 0.1, 1,
        { tag: JIZO_TAG, skill: soulSkill(c), reason: e.id === owner.id ? "CRIT_TAKEN:SELF" : "CRIT_TAKEN:ALLY", base: "maxHp", ratio: 10 });
      c.fired(`地藏像:shield:${e.id === owner.id ? "self" : "ally"}`);
    }
  });
};

/**
 * 幽谷响 Yamabiko: 「抵抗控制效果时，有50%概率将该效果反弹给来源目标，且必定命中」. Hooked on EV.RESIST (only
 * produced when the resist policy is SINGLE_ROLL_RATIO / COMMUNITY_TWO_ROLL — the default policy never
 * resists, so the soul is silent there). The reflected control has the resisted one's duration (1 if the
 * producer did not say), skips probability and resist ("必定命中"), and still respects status immunity.
 */
const yamabiko: Installer = c => {
  register(c, EV.RESIST, "SELF", async ctx => {
    const { battle, owner } = c;
    const src = ctx?.source, def: StatusDef | undefined = ctx?.status;
    if (ctx?.target?.id !== owner.id || !src || !def || src.id === owner.id || src.teamId === owner.teamId) return;
    if (!incomingKinds(def, false).includes("CONTROL") || !isUp(src) || !isUp(owner)) return;
    if (!roll(c, 0.5, "reflect")) return;
    const skill = soulSkill(c);
    const duration = Math.max(1, Number(ctx.duration ?? 1));
    proc(c, src.id, `reflect ${def.name}`);
    const imm = findImmuneStatus(src, def, battle.policies?.immune?.debuffCoversControl ?? true);
    if (imm) {
      battle.trace.push({ t: "IMMUNE", src: owner.id, dst: src.id, status: def.id, name: def.name, by: imm.def.id, kind: imm.kind, consumed: imm.consumed, skill });
      await battle.bus.dispatch(EV.IMMUNE, { target: src, incoming: def, by: imm.def, kind: imm.kind }, src.id, src.teamId, (id: number) => battle.teamOf(id));
      return;
    }
    const applied = src.addStatus(def, owner.id, 1, duration, [], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: owner.id, dst: src.id, status: def.id, name: def.name, category: def.category, duration, known: true, tag: applied?.tag ?? null, skill, reason: "REFLECTED" });
    c.fired("幽谷响:reflect");
  });
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Betting mode (MAX) only — see BETTING_ONLY_SOULS / customSoulFor. In BASE these souls keep the
// generic interpretEffect path, so the regression fingerprints stay byte-identical.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Stacks this soul already wrote on the wearer (restore-safe: derived from its own modifier sources). */
const ownStacks = (c: CustomSoulContext, prefix: string) =>
  c.owner.effects.filter((x: any) => typeof x.source === "string" && x.source.startsWith(prefix)).length;

/** Breaks the bearer's previous shield carrying `tag` (a new one of the same soul replaces it, no stacking). */
function replaceTaggedShield(e: any, tag: string) {
  for (const sh of e.shields ?? []) if (!sh.broken && String(sh.id).startsWith(`sh_${tag}_`)) sh.broken = true;
}

/** true while the wearer's souls are sealed (hooks outside the EventBus must honour the seal themselves). */
const soulSealed = (c: CustomSoulContext) => !!c.battle.bus.suppressProvider?.(c.owner.id)?.soul;

/**
 * 伤魂鸟 Fenikkusu: 「任一非怪物目标阵亡时，治疗生命上限20%的生命，并提升20%伤害（上限120%）直到战斗结束」.
 * Any unit's death (either side, summons excluded — the reading of 非怪物 is unverified) while the wearer is
 * alive: heal 20% of the wearer's max HP and +20% damage dealt (dmgDealtB), at most 6 stacks.
 */
const FENIKKUSU_STEP = 0.2;
const FENIKKUSU_CAP = 6;
const fenikkusu: Installer = c => {
  register(c, EV.DEATH, "ALL", async ctx => {
    const { battle, owner } = c;
    const dead = ctx?.target;
    // DEATH is a death-cascade code: the bus delivers it to dead owners too ⇒ check the wearer here.
    if (!dead || dead.id === owner.id || isSummonUnit(dead) || !isUp(owner)) return;
    const prefix = `soul${c.soulId}:stack`;
    const stacks = ownStacks(c, prefix);
    c.fired("伤魂鸟:death");
    if (stacks < FENIKKUSU_CAP) owner.addModifier({ prop: "dmgDealtB", value: FENIKKUSU_STEP, mode: "FIXED", source: `${prefix}${stacks + 1}` });
    const now = Math.min(FENIKKUSU_CAP, stacks + 1);
    proc(c, dead.id, `death of ${dead.id}: heal 20% max HP, damage +${now * 20}% (${now}/${FENIKKUSU_CAP})`);
    await healTarget(battle, owner, owner, owner.maxHp * 0.2);
  });
};

/**
 * 珍珠 Pearl: 「治疗时，目标获得不可驱散的护盾2回合，能吸收等同基础治疗30%的伤害」.
 * Every heal by the wearer (not a 恢复/recover) gives its target a non-dispellable shield of 30% of the base
 * heal (the amount before crit / heal reduction; EV.HEAL payload `base`), lasting 2 of the target's turns
 * (creation turn included, like statuses). A new Pearl shield replaces the target's previous one.
 */
const PEARL_TAG = "soul-pearl";
const pearl: Installer = c => {
  ensureShieldTicker(c.battle);
  register(c, EV.HEAL, "SELF", ctx => {
    const { battle, owner } = c;
    if (ctx?.recover || ctx?.source?.id !== owner.id) return;
    const t = ctx.target;
    const base = Number(ctx.base ?? 0);
    if (!isUp(t) || !(base > 0)) return;
    replaceTaggedShield(t, PEARL_TAG);
    grantTimedShield(battle, owner, t, base * 0.3, 2,
      { tag: PEARL_TAG, skill: soulSkill(c), reason: "HEAL", base: "baseHeal", ratio: 30, dispellable: false });
    c.fired("珍珠:shield");
    proc(c, t.id, `shield ${GameMath.display(base * 0.3)} (30% of base heal ${GameMath.display(base)}), 2 turns`);
  });
};

/**
 * 树妖 Tree Spirit: 「治疗时，增加20%（若目标生命低于20%，改为增加50%）基础治疗」.
 * Base-heal amplifier on the wearer's heals (not recover), through the kernel hook battle.healAmplifiers
 * (kernel/damage.ts healTarget; unset outside this soul). Honours soul seals like a bus handler would.
 */
const treeSpirit: Installer = c => {
  const b: any = c.battle;
  b.healAmplifierKeys ??= new Set<string>();
  const key = `${c.owner.id}:SOUL${c.soulId}`;
  if (b.healAmplifierKeys.has(key)) return;
  b.healAmplifierKeys.add(key);
  (b.healAmplifiers ??= []).push((source: any, target: any, base: number) => {
    if (source?.id !== c.owner.id || !isUp(c.owner) || soulSealed(c) || !(base > 0)) return base;
    const low = target.maxHp > 0 && target.hp / target.maxHp < 0.2;
    const mul = low ? 1.5 : 1.2;
    c.fired(`树妖:${low ? "low" : "heal"}`);
    proc(c, target.id, `base heal x${mul}${low ? " (target HP < 20%)" : ""}`);
    return base * mul;
  });
};

/**
 * 钓瓶火 Dangler: 「回合结束后，额外推进1格鬼火行动条，并为当前生命比例最低的非召唤物友方目标治疗自身防御700%的生命」.
 * At the end of each of the wearer's own turns (normal or extra turn): +1 cell on its team's onibi gauge
 * (Battle.advanceOrbGauge — a fill sets pendingReward, which battle.ts pays right after TURN_END of a normal
 * turn; after an extra turn it waits for the team's next normal turn end), then heal the living non-summon
 * ally with the lowest HP ratio (ties: lineup order) for 700% of the wearer's DEF.
 */
const dangler: Installer = c => {
  register(c, EV.TURN_END, "SELF", async ctx => {
    const { battle, owner } = c;
    if (ctx?.actor?.id !== owner.id || !isUp(owner)) return;
    battle.advanceOrbGauge(owner.teamId, 1, soulSkill(c), owner.id);
    c.fired("钓瓶火:gauge");
    const allies = battle.teams[owner.teamId].aliveMembers().filter((m: any) => !isSummonUnit(m) && m.maxHp > 0);
    if (!allies.length) return;
    const t = allies.reduce((a: any, m: any) => (m.hp / m.maxHp < a.hp / a.maxHp ? m : a), allies[0]);
    const amount = owner.prop("def") * 7;
    proc(c, t.id, `onibi gauge +1, heal ${GameMath.display(amount)} (700% DEF) to the lowest HP ratio ally`);
    c.fired("钓瓶火:heal");
    await healTarget(battle, owner, t, amount);
  });
};

/**
 * 蚌精 Sea Sprite: 「战斗开始时，友方全体获得无法驱散的护盾1回合，能吸收等同生命上限10%的伤害」.
 * Battle start: every living ally gets a non-dispellable shield of 10% of its OWN max HP, lasting 1 of its
 * turns (the generic path gave a shield with no duration). A second wearer's shield replaces the first.
 */
const SEA_SPRITE_TAG = "soul-seasprite";
const seaSprite: Installer = c => {
  ensureShieldTicker(c.battle);
  register(c, EV.BATTLE_START, "SELF", () => {
    const { battle, owner } = c;
    if (!isUp(owner)) return;
    for (const m of battle.teams[owner.teamId].aliveMembers()) {
      replaceTaggedShield(m, SEA_SPRITE_TAG);
      grantTimedShield(battle, owner, m, m.maxHp * 0.1, 1,
        { tag: SEA_SPRITE_TAG, skill: soulSkill(c), reason: "BATTLE_START", base: "maxHp", ratio: 10, dispellable: false });
    }
    c.fired("蚌精:shield");
  });
};

/** 日女巳时 / 三味 / 骰子鬼 (MAX only): soul/custom-effects-betting.ts, built with this module's helpers. */
const BETTING_SOULS = makeBettingSouls({ register, roll, proc, countsAsSoulDamage, isUp, soulSkill, applyStatus: applySoulStatus });

export const CUSTOM_SOULS: Readonly<Record<string, Installer>> = Object.freeze({
  破势: shadow,
  针女: seductress,
  阴摩罗: harpy,
  木魅: treeNymph,
  镜姬: mirrorLady,
  魅妖: temptress,
  返魂香: senecio,
  雪幽魂: snowSpirit,
  钟灵: bell,
  狰: scarlet,
  应声虫: echoer,
  共潜: merrow,
  蝠翼: nightwing,
  涅槃之火: phoenixFire,
  镇墓兽: tombGuard,
  鸣屋: mingwu,
  心眼: watcher,
  狂骨: kyoukotsu,
  片叶之苇: reed,
  网切: netCutter,
  被服: kimono,
  轮入道: soultaker,
  地藏像: jizo,
  幽谷响: yamabiko,
  伤魂鸟: fenikkusu,
  珍珠: pearl,
  树妖: treeSpirit,
  钓瓶火: dangler,
  蚌精: seaSprite,
  ...BETTING_SOULS,
});

/** Installed only in betting (MAX) mode; in BASE these souls keep the generic interpretEffect path. */
export const BETTING_ONLY_SOULS: ReadonlySet<string> = new Set(["伤魂鸟", "珍珠", "树妖", "钓瓶火", "蚌精", ...Object.keys(BETTING_SOULS)]);

/** The hand-written installer this soul uses in the current mode, or null (generic path). */
export function customSoulFor(name: string): Installer | null {
  const f = CUSTOM_SOULS[name];
  if (!f) return null;
  if (BETTING_ONLY_SOULS.has(name) && !bettingActive()) return null;
  return f;
}

/** What is deliberately approximated — surfaced in the install report. */
export const CUSTOM_SOUL_NOTES: Readonly<Record<string, string>> = Object.freeze({
  破势: "custom: x1.4 on soul-triggering damage when target HP > 70%",
  针女: "custom: on crit 40% → TRUE damage min(10% target max HP, 120% ATK); proc cannot re-trigger souls",
  阴摩罗: "custom: +3 onibi to own team when the wearer lands the killing blow",
  木魅: "custom: ally hit → 25% drain 1 onibi from attacker team, once per attack per wearer; taunt penalty not modelled",
  镜姬: "custom: 30% reflect 100% of damage taken as FIXED damage; taunt penalty not modelled",
  魅妖: "custom: per soul-triggering hit dealt, 25% base chance 混乱 1 turn (skill status rules: resist policy, immunity)",
  返魂香: "custom: per soul-triggering hit taken, 25% base chance 眩晕 the damager 1 turn; x0.4 if the damager is taunted/provoked",
  雪幽魂: "custom: per hit dealt 15% base chance 冰冻 1 turn (30% if target has a slow); hit by an enemy → attacker -30 SPD 1 turn (synthetic status, refreshes)",
  钟灵: "custom: per hit dealt 10% base chance 眩晕 1 turn, 20% when no enemy is stunned",
  狰: "custom: per soul-triggering enemy hit taken, 35% (x0.4 vs taunted attacker) Battle.counterAttack; no chain, not while immobile",
  应声虫: "custom: ally normal attack on an enemy → 20% assist (forced normal attack on the same target, pseudo turn); assists do not chain",
  共潜: "custom: wearer turn end → dispel 1 random dispellable debuff among allies; 3 in total if the wearer dealt no damage that turn",
  蝠翼: "custom: 20% lifesteal on soul-triggering damage dealt (policies.lifesteal basis)",
  涅槃之火: "custom: wearer action end with HP < 30% → heal 15% max HP",
  镇墓兽: "custom: wearer crit → crit damage +0.5% per whole 1% HP lost (additive to the crit multiplier)",
  鸣屋: "custom: x1.45 damage when the target has a control effect",
  心眼: "custom: +10% damage per full 15% of HP the target has lost",
  狂骨: "custom: +8% damage per onibi currently held by the wearer's team",
  片叶之苇: "custom: x1.45 damage while the wearer is at full HP",
  网切: "custom: per soul-triggering hit, 50% chance to ignore 45% of target defense",
  被服: "custom: x0.7 on soul-triggering, modifier-respecting damage taken",
  轮入道: "custom: wearer turn end → 20% extra turn (queued NEW_TURN after the current turn; can chain)",
  地藏像: "custom: wearer takes an enemy crit → shield 10% of the receiver's own max HP for 1 turn: wearer 100%, each other ally 30%; x0.4 vs taunted attacker; replaces the previous Jizo shield",
  幽谷响: "custom: wearer resists a control (EV.RESIST) → 50% reflect it to the source, no resist roll, immunity respected; silent under the default resist policy (never resists)",
  伤魂鸟: "custom (MAX only): any non-summon death (either side) while the wearer lives → heal 20% own max HP and +20% damage dealt, max 6 stacks (120%); summons excluded (非怪物 reading unverified)",
  珍珠: "custom (MAX only): wearer heals (not recover) → target gets a non-dispellable shield = 30% of the base heal (pre-crit, pre-heal-reduction) for 2 of the target's turns; replaces the previous Pearl shield",
  树妖: "custom (MAX only): wearer's heals (not recover) get +20% base heal, +50% when the target is below 20% HP (kernel healAmplifiers hook; honours soul seals)",
  钓瓶火: "custom (MAX only): wearer turn end → +1 cell on own onibi gauge (a fill is paid at the team's next normal turn end) and heal the lowest-HP-ratio non-summon ally for 700% of the wearer's DEF",
  蚌精: "custom (MAX only): battle start → every ally gets a non-dispellable shield of 10% of its own max HP for 1 of its turns (generic path had no duration); a second wearer replaces it",
  ...BETTING_SOUL_NOTES,
});
