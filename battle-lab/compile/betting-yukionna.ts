// compile/betting-yukionna.ts — 雪女 (SR 201, Global "Yuki Onna") at max skill level. MAX mode only (match 8).
// (Not 雪御前 591 — that is compile/betting-yuki.ts.)
//
// Sources: data/kb/shikigami.json 201_01..201_03 (+ ai row), buff 2012_1 冰甲盾, tips_101 冰冻 / tips_112 深度冰冻 /
// tips_15 维持 / tips_2 基础概率; data/kb/en-text.json (Global); fandom "Yuki_Onna/Main".
//   雪球 (201_01) · 120% ATK (L4); L3/L5: 50% base chance to slow the target −10 SPD for 2 turns.
//   冰甲术 (201_02, passive) · at the end of her turn she and the 2 allies with the highest crit damage (other than
//       her, living non-summons, ties by lineup order) gain 冰甲盾: a shield of 12% (L4) of HER max HP, sustained
//       1 turn (维持 ⇒ counted on her turns: it lasts until the end of her next turn, when it is replaced by the new
//       grant). L3/L5: when a bearer is attacked by an enemy, 50% base chance to slow the attacker −10 SPD for 2
//       turns (one roll per bearer per enemy action). 冰甲盾 (buff text): the bearer's damage to a Frozen / Deep
//       Frozen target uses ATK + 40% of its initial ATK (KB panel ATK, souls excluded — betting-shared kbBaseAtk).
//   暴风雪 (201_03, 3 onibi) · 3 waves, each hitting every living enemy for 36% ATK (L4). Per hit: if the target is
//       already Frozen ⇒ 30% (plain chance, no RES contest: the control already landed) to convert it into Deep
//       Freeze (1 turn, −20 SPD); otherwise 8% base chance to Freeze for 1 turn, the FINAL chance +10 points when the
//       target carries a slow. Then L3/L5: 16% base chance to slow −10 SPD for 2 turns.
//   AI (KB) · enemies ≥ 2 → 暴风雪 when affordable; enemies < 2 and onibi > 5 → 50% 暴风雪 / 50% 雪球; enemies < 2
//       and 3 ≤ onibi ≤ 5 → 27.27% / 72.72%; otherwise 雪球. (The KB rows never compiled: condUnresolved.)
//       雪球's target rule ("优先血量20%以下的目标") stays with the generic compiled selector.
// Readings / doubts:
//   · Controls and slows are counted on the bearer's turns (TARGET_TURN, betting-fengyang.ts bearerTurnControl):
//     "冰冻1回合" = the target's next turn. The slow is one status per source (re-application refreshes, never
//     stacks −20); the KB does not say whether slows from different skills stack.
//   · "最终概率提升10%" is read as +10 percentage points on the final (after effect hit / RES) chance: under
//     SINGLE_ROLL_RATIO the base passed to the contest is raised by 0.10 × (1 + RES) / (1 + hit).
//   · The ice shields are removed when Yuki Onna dies (a sustained status has no source turns left).
//   · The +40% initial-ATK bonus scales the hit's final damage by (ATK + 0.4 × initial ATK) / ATK (normal damage only).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { StatusDef } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Hook, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler,
  applyContested, kbBaseAtk, PERSIST,
} from "./betting-shared.ts";
import { bearerTurnControl } from "./betting-fengyang.ts";

export const YUKI_ONNA = Object.freeze({
  snowballRatio: 120, snowballSlowP: 0.5,
  shieldOfHp: 0.12, shieldAllies: 2, shieldSlowP: 0.5, frozenAtkBonus: 0.4,
  blizzardWaves: 3, blizzardRatio: 36, freezeP: 0.08, slowedBonus: 0.1, deepP: 0.3, blizzardSlowP: 0.16,
  slowSpd: -10, slowTurns: 2, deepSpd: -20, controlTurns: 1,
  aiHighOnibi: 5, aiLowOnibi: 3, aiHighP: 0.5, aiLowP: 0.2727,
});

export const ICE_ID = "2012_1";
export const SLOW_ID = "201_slow";
const SHIELD_TAG = (yid: number) => "yukionna201-" + yid;
const N_SLOWED = "yukionna201:shield-slow=";

const iceDef = (): StatusDef => markDef({ id: ICE_ID, name: "冰甲盾", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  dispellable: false, removable: false,
  desc: "【增益、状态】雪女提供的特殊护盾，带有冰甲盾的角色对冰冻及深度冰冻单位造成伤害时，攻击提升初始攻击的40%。" }, StatusBook);
const slowDef = (): StatusDef => markDef({ id: SLOW_ID, name: "减速", category: StatusCategory.DEBUFF_STATE, durationPolicy: "TARGET_TURN",
  dispellable: true, removable: true, desc: "雪女：速度降低10点，持续2回合" }, StatusBook);

export const isYukiOnna = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "201_02") && !!skillById(e, "201_03");
const aliveFoes = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
export const isSlowed = (e: Entity): boolean => e.statuses.some(s =>
  /减速/.test(String(s.def.name)) || (s.effects ?? []).some((x: any) => x.prop === "spd" && x.value < 0) && String(s.def.category).startsWith("DEBUFF"));
const isFrozen = (e: Entity): boolean => e.hasStatus("freeze");
const isFrozenAny = (e: Entity): boolean => e.hasStatus("freeze") || e.hasStatus("deepFreeze");

/** Live 冰甲盾 shields granted by `yid` on `e`. */
export const iceShieldsOn = (e: Entity, yid: number): any[] =>
  (e.shields ?? []).filter((sh: any) => !sh.broken && String(sh.id).startsWith("sh_" + SHIELD_TAG(yid) + "_"));

/** Slow −10 SPD for 2 turns: one status per source, a re-application refreshes the duration (no extra −10). */
async function slow(battle: any, src: Entity, v: Entity, p: number, skill: string): Promise<boolean> {
  if (!v?.alive) return false;
  const already = v.statuses.some(s => s.def.id === SLOW_ID && s.sourceId === src.id);
  return applyContested(battle, src, v, slowDef(), p, YUKI_ONNA.slowTurns,
    already ? [] : [{ prop: "spd", value: YUKI_ONNA.slowSpd, mode: "FIXED" }], { skill, ref: SLOW_ID, tag: SLOW_ID + ":" + skill + ":" + v.id });
}

/** Freeze roll with the "+10 points on the final chance when slowed" rule. */
async function freeze(battle: any, src: Entity, v: Entity, skill: string): Promise<void> {
  let p = YUKI_ONNA.freezeP;
  if (isSlowed(v)) {
    const single = String(battle?.policies?.resist?.formula ?? "NONE") === "SINGLE_ROLL_RATIO";
    p += single ? YUKI_ONNA.slowedBonus * (1 + Number(v.prop("efr") ?? 0)) / (1 + Number(src.prop("efh") ?? 0)) : YUKI_ONNA.slowedBonus;
  }
  await applyContested(battle, src, v, bearerTurnControl("freeze"), Math.min(1, p), YUKI_ONNA.controlTurns, [], { skill, ref: "CONTROL:freeze" });
}

/** A hit on an already Frozen target: 30% to convert the freeze into Deep Freeze (plain chance). */
function convert(battle: any, src: Entity, v: Entity, skill: string): void {
  battle.rng.expect("yukionna201_deep:" + v.id);
  if (!battle.rng.testHit(YUKI_ONNA.deepP)) return;
  for (const st of [...v.statuses]) if (st.def.id === "freeze") v.expireStatus(st);
  const def = bearerTurnControl("deepFreeze");
  if (!StatusBook.has(def.id)) StatusBook.set(def.id, def);
  const a = v.addStatus(def, src.id, 1, YUKI_ONNA.controlTurns, [{ prop: "spd", value: YUKI_ONNA.deepSpd, mode: "FIXED" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: src.id, dst: v.id, status: def.id, name: def.name, category: def.category, duration: YUKI_ONNA.controlTurns,
    ref: "CONTROL:deepFreeze", known: true, tag: (a as any)?.tag ?? null, skill, converted: "freeze", probability: YUKI_ONNA.deepP });
}

async function hit(battle: any, self: Entity, v: Entity, ratio: number, id: string, hurt: Entity[]): Promise<boolean> {
  let landed = false;
  await battle.withinResolution({ id, type: "HIT" }, async () => {
    if (!v.alive) return;
    if (!hurt.includes(v)) hurt.push(v);
    await battle.damage(self, v, self.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, null);
    landed = true;
  });
  return landed;
}

function damageHook(x: any): Hook | null {
  if (x?.id !== "201_01" && x?.id !== "201_03") return null;
  return {
    kind: x.id === "201_01" ? "YUKI_ONNA_SNOWBALL" : "YUKI_ONNA_BLIZZARD",
    run: async (battle, self, hurt, primary) => {
      if (x.id === "201_01") {
        const t = primary?.alive && primary.teamId !== self.teamId ? primary : aliveFoes(battle, self)[0];
        if (!t) return;
        await hit(battle, self, t, Number(x.damage?.[0]?.ratioMax ?? YUKI_ONNA.snowballRatio), "HIT:" + x.name + "#1", hurt);
        if (t.alive) await slow(battle, self, t, YUKI_ONNA.snowballSlowP, x.name);
        return;
      }
      const ratio = Number(x.damage?.[0]?.ratioMax ?? YUKI_ONNA.blizzardRatio);
      for (let w = 0; w < YUKI_ONNA.blizzardWaves; w++) {
        for (const v of aliveFoes(battle, self)) {
          if (!(await hit(battle, self, v, ratio, "HIT:" + x.name + "#" + (w + 1) + ":" + v.id, hurt)) || !v.alive) continue;
          if (isFrozen(v)) convert(battle, self, v, x.name);
          else if (!v.hasStatus("deepFreeze")) await freeze(battle, self, v, x.name);
          if (v.alive) await slow(battle, self, v, YUKI_ONNA.blizzardSlowP, x.name);
        }
      }
    },
  };
}

/** AI (KB rows; they never compiled). */
function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isYukiOnna(self)) return null;
  const blizzard = skillById(self, "201_03"), ball = skillById(self, "201_01");
  if (!blizzard || !ball) return null;
  const orbs = battle.teams[self.teamId].orbs;
  const cost = costOf(blizzard);
  const affordable = !(cost > 0) || orbs.canPay(cost);
  const foes = aliveFoes(battle, self).length;
  if (foes >= 2) return affordable ? { skill: blizzard, rule: "Yuki Onna: 2+ enemies → Blizzard (KB AI)" } : { skill: ball, rule: "Yuki Onna: 2+ enemies, not enough Onibi → Snowball" };
  const n = orbs.current;
  const p = n > YUKI_ONNA.aiHighOnibi ? YUKI_ONNA.aiHighP : n >= YUKI_ONNA.aiLowOnibi ? YUKI_ONNA.aiLowP : 0;
  if (p > 0 && affordable) {
    battle.rng.expect("yukionna201_ai");
    if (battle.rng.testHit(p)) return { skill: blizzard, rule: `Yuki Onna: 1 enemy, ${n} Onibi → ${GameMath.display(p * 100)}% Blizzard (KB AI)` };
  }
  return { skill: ball, rule: `Yuki Onna: 1 enemy, ${n} Onibi → Snowball (KB AI)` };
}

function expireIce(battle: any, y: Entity, reason: string): void {
  for (const e of battle.allEntities() as Entity[]) {
    for (const sh of iceShieldsOn(e, y.id)) {
      sh.broken = true;
      battle.trace.push({ t: "SHIELD_EXPIRE", id: e.id, shield: sh.id, remaining: GameMath.display(sh.value), reason });
    }
    for (const st of [...e.statuses]) if (st.def.id === ICE_ID && st.sourceId === y.id) e.expireStatus(st);
  }
}

/** 冰甲术: at the end of her turn, replace the previous shields with new ones. */
function grantIce(battle: any, y: Entity): void {
  expireIce(battle, y, "REPLACED");
  const others = (battle.teams[y.teamId].members as Entity[])
    .filter(a => a.alive && a.id !== y.id && !isSummonUnit(a))
    .map((a, i) => ({ a, i, c: Number(a.prop("crid") ?? 0) }))
    .sort((p, q) => q.c - p.c || p.i - q.i)
    .slice(0, YUKI_ONNA.shieldAllies).map(p => p.a);
  const value = y.maxHp * YUKI_ONNA.shieldOfHp;
  for (const dst of [y, ...others]) {
    dst.addShield({ value, sourceId: y.id, dispellable: true, tag: SHIELD_TAG(y.id) });
    const a = dst.addStatus(iceDef(), y.id, 1, PERSIST, [], 1);
    battle.trace.push({ t: "SHIELD_APPLY", src: y.id, dst: dst.id, value: GameMath.display(value), base: "maxHp", ratio: YUKI_ONNA.shieldOfHp * 100, skill: "冰甲术", reason: "TURN_END", duration: 1 });
    battle.trace.push({ t: "STATUS_APPLY", src: y.id, dst: dst.id, status: ICE_ID, name: "冰甲盾", category: StatusCategory.BUFF_STATE, duration: 1, ref: ICE_ID, known: true, tag: (a as any)?.tag ?? null, skill: "冰甲术" });
  }
}

/** A bearer is attacked by an enemy: 50% base chance to slow the attacker (one roll per bearer per enemy action). */
async function onBearerHit(battle: any, y: Entity, ctx: any): Promise<void> {
  const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
  if (!src || !dst || !src.alive || src.teamId === y.teamId || dst.teamId !== y.teamId) return;
  if (!dst.statuses.some(s => s.def.id === ICE_ID && s.sourceId === y.id)) return;
  const t = ctx?.result?.type;
  if (t === DamageType.CONDUCTION || t === DamageType.INDIRECT || String(ctx.input.skillTag ?? "").startsWith("soul:")) return;
  const key = battle.turn + ":" + src.id + ":" + dst.id;
  if (noteValue(dst, N_SLOWED) === key) return;
  setNote(dst, N_SLOWED, key);
  await slow(battle, y, src, YUKI_ONNA.shieldSlowP, "冰甲术");
}

/** Bearer of her shield deals damage to a Frozen / Deep Frozen enemy: ATK + 40% of initial ATK. */
function frozenBonus(battle: any, y: Entity, ctx: any): void {
  const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
  if (!src || !dst || src.teamId !== y.teamId || dst.teamId === y.teamId || ctx.result?.type !== DamageType.NORMAL) return;
  if (!isFrozenAny(dst) || !iceShieldsOn(src, y.id).length) return;
  const atk = Number(src.prop("atk") ?? 0);
  if (!(atk > 0)) return;
  const mul = (atk + YUKI_ONNA.frozenAtkBonus * kbBaseAtk(src)) / atk;
  ctx.result.final *= mul;
  battle.trace.push({ t: "DAMAGE_BOOST", src: src.id, dst: dst.id, by: ICE_ID, name: "冰甲盾", mul, reason: "target frozen", skill: "冰甲术" });
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const y of entities.filter(isYukiOnna)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL", passive: boolean) =>
      registerOwnerHandler(battle, "betting:201:" + code + ":" + y.id, y.id, code, fn, range, { passive });
    reg(EV.TURN_END, (ctx: any) => { if (ctx?.actor?.id === y.id && y.alive) grantIce(battle, y); }, "SELF", true);
    // The slow and the ATK bonus belong to the shield buff ⇒ not sealed with her passive.
    reg(EV.AFTER_DAMAGE, (ctx: any) => onBearerHit(battle, y, ctx), "ALL", false);
    reg(EV.BEFORE_DAMAGE, (ctx: any) => frozenBonus(battle, y, ctx), "ALL", false);
    ensureGlobalHandler(battle, "betting:201:death:" + y.id, EV.DEATH, (ctx: any) => { if (ctx?.target?.id === y.id) expireIce(battle, y, "SOURCE_DEFEATED"); });
    out.push({ entityId: y.id, mechanic: "冰甲术 (turn-end 12% max-HP shields, attacker slow, +40% ATK vs frozen) · 暴风雪 freeze / deep freeze / slow · 雪球 slow · KB AI" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "201_03": { note: "暴风雪: freeze / deep freeze (per hit, +10 points when slowed) and the L5 slow are rolled per hit by betting-yukionna.ts; the compiled once-per-cast freeze row is removed", patch: { controlRefs: [] } },
    "201_02": { note: "冰甲术: the turn-end shields (12% of her max HP), the slow and the frozen-target bonus are run by betting-yukionna.ts", patch: { shield: [], statusRefConditionOnly: [0] } },
  }),
  damageHook,
  ruleSkill,
  install,
};
