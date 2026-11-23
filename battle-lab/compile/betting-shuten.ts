// compile/betting-shuten.ts — 鬼王酒吞童子 (SSR 341, Global "Demoniac Shuten Doji") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 341_01..341_03, buff 3411_1 大妖之力 / 3413_1 鬼王姿态, tips_20 恢复;
// fandom "Oniou Shuten Douji/Main" (烈焰焚天 / Torch the Sky numbers are only on the wiki).
//   焚天 (341_01) · 125% ATK. In 鬼王姿态 it is replaced by 烈焰焚天: 245% ATK on the target, then TRUE damage
//       equal to 40% of the damage the target received to every other enemy; the splash triggers no souls.
//   红莲 (341_02, passive) · immune to control effects and banishment; healing received −30% (L4).
//       All allies have 大妖之力: +1% damage dealt per 1% of HP lost; L3: +1% damage reduction per 1% of HP lost;
//       L5: doubled on himself. Not stackable between several 341s (one aura per team).
//       Damage reduction cap: NOT in any text — capped at 75% here (otherwise he is immune below 50% HP).
//   天火怒焱 (341_03, 3 onibi) · pushes every enemy back 40% (L4), dispels 2 buffs (L2) from each, then he enters
//       鬼王姿态 for 2 of his turns (the casting turn is not counted). Only castable outside the stance.
//       鬼王姿态: at the start of each ally's turn (himself included) the ally loses 24% of its current HP (HP loss;
//       removes Sleep) and is immune to damage until the next turn starts (any unit's: counters / reflects in its
//       own turn). L3: when the stance ends, all allies recover (恢复) 20% of the damage he dealt during it.
//       L5: after the burn, an ally below 30% HP has all control effects removed.
//   AI (KB) · "3技能" every turn: 天火怒焱 when affordable and not in the stance, else 焚天 / 烈焰焚天.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Hook, Installed } from "./betting-m7.ts";
import { bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, clearControls } from "./betting-shared.ts";

export const SHUTEN = Object.freeze({
  basicRatio: 125, cometRatio: 245, splashTrue: 0.4,
  healDown: 0.3, gypDamage: 0.01, gypReduction: 0.01, selfDouble: 2, reductionCap: 0.75,
  push: 0.4, dispel: 2, stanceTurns: 2, burn: 0.24, recoverShare: 0.2, freeBelow: 0.3,
});

export const STANCE_ID = "3413_1";
export const LOTUS_ID = "341_crimson_lotus";
export const GUARD_ID = "341_stance_guard";
const SPLASH_TAG = "betting-shuten:splash";
const N_TURNS = "shuten341:stance=", N_CAST = "shuten341:castTurn=", N_DEALT = "shuten341:dealt=";

const stanceDef = () => markDef({ id: STANCE_ID, name: "鬼王姿态", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】燃起火海，使友方在回合开始时被灼烧自身24%当前生命，并免疫伤害直至下一回合开始；灼烧视同失去生命，且可以解除睡眠状态。" }, StatusBook);
const lotusDef = () => markDef({ id: LOTUS_ID, name: "红莲", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  immuneTo: ["CONTROL", "BANISH"], desc: "红莲：免疫控制效果和放逐，受到治疗效果减少30%（L4）。" }, StatusBook);
const guardDef = () => markDef({ id: GUARD_ID, name: "鬼王姿态·免伤", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  immuneTo: ["DAMAGE"], desc: "鬼王姿态：灼烧后免疫伤害直至下一回合开始。" }, StatusBook);

export const isShuten341 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "341_02") && !!skillById(e, "341_03");
export const inStance = (e: Entity): boolean => !!e?.hasStatus?.(STANCE_ID);
const lostRatio = (e: Entity): number => (e.maxHp > 0 ? Math.max(0, 1 - e.hp / e.maxHp) : 0);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
/** "多个鬼王酒吞童子的大妖之力效果不叠加" ⇒ the first living 341 of a team runs the aura. */
const auraOwner = (battle: any, teamId: number): Entity | null =>
  (battle.teams[teamId]?.members ?? []).find((m: Entity) => m.alive && isShuten341(m)) ?? null;

/** 大妖之力 multipliers for one hit (exported for the tests). */
export function greatYokaiFactor(s: Entity, src: Entity, dst: Entity): number {
  let f = 1;
  if (src.teamId === s.teamId && dst.teamId !== s.teamId && !isSummonUnit(src)) {
    f *= 1 + lostRatio(src) * 100 * SHUTEN.gypDamage * (src.id === s.id ? SHUTEN.selfDouble : 1);
  }
  if (dst.teamId === s.teamId && src.teamId !== s.teamId && !isSummonUnit(dst)) {
    f *= 1 - Math.min(SHUTEN.reductionCap, lostRatio(dst) * 100 * SHUTEN.gypReduction * (dst.id === s.id ? SHUTEN.selfDouble : 1));
  }
  return f;
}

/** 焚天 / 烈焰焚天 (the variant is read on the caster when the hit runs). */
function burnerHook(x: any): Hook | null {
  if (x?.id !== "341_01") return null;
  return {
    kind: "HEAVEN_BURNER",
    run: async (battle, s, hurt, primary) => {
      const target = primary?.alive && primary.teamId !== s.teamId ? primary : aliveEnemies(battle, s)[0];
      if (!target) return;
      hurt.push(target);
      if (!inStance(s)) {
        await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
          await battle.damage(s, target, s.prop("atk") * (SHUTEN.basicRatio / 100), DamageType.NORMAL, 1, null);
        });
        return;
      }
      battle.trace.push({ t: "SKILL_VARIANT", actor: s.id, skill: x.name, variant: "烈焰焚天", reason: "鬼王姿态" });
      let received = 0;
      await battle.withinResolution({ id: "HIT:烈焰焚天#1", type: "HIT" }, async () => {
        const r = await battle.damage(s, target, s.prop("atk") * (SHUTEN.cometRatio / 100), DamageType.NORMAL, 1, null);
        received = Number(r?.final ?? 0);
      });
      if (!(received > 0)) return;
      await battle.withinResolution({ id: "HIT:烈焰焚天#splash", type: "HIT" }, async () => {
        for (const v of aliveEnemies(battle, s)) {
          if (v.id === target.id) continue;
          if (!hurt.includes(v)) hurt.push(v);
          await dealDamage(battle, { source: s, target: v, base: received * SHUTEN.splashTrue, rate: 1, type: DamageType.TRUE, skillTag: SPLASH_TAG, noSoul: true });
        }
      });
    },
  };
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isShuten341(self)) return null;
  const roar = skillById(self, "341_03"), basic = skillById(self, "341_01");
  if (roar && !inStance(self) && battle.teams[self.teamId].orbs.canPay(costOf(roar))) {
    return { skill: roar, rule: "鬼王酒吞童子: 鬼火足够且非鬼王姿态 → 天火怒焱 (KB AI)" };
  }
  return basic ? { skill: basic, rule: inStance(self) ? "鬼王酒吞童子: 鬼王姿态 → 烈焰焚天" : "鬼王酒吞童子: 鬼火不足 → 焚天" } : null;
}

function gate(_battle: any, self: Entity, sk: any): string | null {
  return sk?.ir?.id === "341_03" && isShuten341(self) && inStance(self) ? "IN_DEMON_STANCE" : null;
}

function enterStance(battle: any, s: Entity): void {
  if (inStance(s)) return;
  const def = stanceDef();
  const a = s.addStatus(def, s.id, 1, PERSIST, [], 1);
  setNote(s, N_TURNS, SHUTEN.stanceTurns);
  setNote(s, N_CAST, String(battle.turn ?? 0));
  setNote(s, N_DEALT, 0);
  battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: s.id, status: STANCE_ID, name: def.name, category: def.category, duration: SHUTEN.stanceTurns, ref: STANCE_ID, known: true, tag: (a as any)?.tag ?? null, skill: "天火怒焱" });
}

async function endStance(battle: any, s: Entity): Promise<void> {
  for (const st of [...s.statuses]) if (st.def.id === STANCE_ID) s.expireStatus(st);
  const dealt = Number(noteValue(s, N_DEALT) ?? 0);
  setNote(s, N_TURNS, null); setNote(s, N_CAST, null); setNote(s, N_DEALT, null);
  battle.trace.push({ t: "STATUS_EXPIRE", id: s.id, status: STANCE_ID, reason: "DURATION", dealt: GameMath.display(dealt) });
  if (!(dealt > 0)) return;
  for (const m of battle.teams[s.teamId].aliveMembers() as Entity[]) {
    await battle.heal(s, m, dealt * SHUTEN.recoverShare, { recover: true });
  }
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "341_03" || !isShuten341(self)) return false;
  enterStance(battle, self);
  return true;
}

/** Any turn start: the previous guard ends; an ally's turn in the stance: burn 24% current HP, Sleep removed, guard. */
async function stanceTurnStart(battle: any, s: Entity, actor: Entity): Promise<void> {
  for (const m of battle.allEntities() as Entity[]) {
    for (const st of [...m.statuses]) if (st.def.id === GUARD_ID && st.sourceId === s.id) m.expireStatus(st);
  }
  if (!actor?.alive || actor.teamId !== s.teamId || !s.alive || !inStance(s)) return;
  const loss = actor.hp * SHUTEN.burn;
  if (loss > 0) {
    battle.lose(actor, loss);
    battle.trace.push({ t: "BURN", src: s.id, dst: actor.id, amount: GameMath.display(loss), skill: "鬼王姿态" });
  }
  for (const st of [...actor.statuses]) {
    if (st.def.id !== "sleep" || !actor.expireStatus(st)) continue;
    battle.trace.push({ t: "STATUS_REMOVE", id: actor.id, status: "sleep", name: st.def.name, by: "REMOVE", side: "ALLY", what: "CONTROL", src: s.id, skill: "鬼王姿态" });
  }
  if (actor.maxHp > 0 && actor.hp / actor.maxHp < SHUTEN.freeBelow) clearControls(battle, actor, s, "鬼王姿态");
  const def = guardDef();
  actor.addStatus(def, s.id, 1, PERSIST, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: actor.id, status: GUARD_ID, name: def.name, category: def.category, duration: 1, ref: STANCE_ID, known: true, skill: "鬼王姿态" });
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const s of entities.filter(isShuten341)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = true) =>
      registerOwnerHandler(battle, "betting:341:" + code + ":" + s.id, s.id, code, fn, range, { passive });
    // 红莲 (passive): control / banish immunity and the heal cut.
    reg(EV.BATTLE_START, () => {
      if (s.hasStatus(LOTUS_ID)) return;
      const def = lotusDef();
      s.addStatus(def, s.id, 1, PERSIST, [{ prop: "healDown", value: SHUTEN.healDown, mode: "FIXED" }], 1);
      battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: s.id, status: LOTUS_ID, name: def.name, category: def.category, duration: PERSIST, ref: "341_02", known: true, skill: "红莲" });
    }, "SELF");
    // 大妖之力: damage dealt / taken by allies scales with the HP they have lost.
    reg(EV.BEFORE_DAMAGE, (ctx: any) => {
      const res = ctx?.result, src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
      if (!res || res.ignoresModifiers || !src || !dst || auraOwner(battle, s.teamId) !== s) return;
      if (ctx.input.skillTag === SPLASH_TAG) return;   // the splash is a share of a hit that already had the bonus
      res.final *= greatYokaiFactor(s, src, dst);
    });
    // 鬼王姿态 (from the active skill): turn-start burn / guard, damage tally, countdown on his own turn ends.
    reg(EV.TURN_START, (ctx: any) => stanceTurnStart(battle, s, ctx?.actor), "ALL", false);
    reg(EV.AFTER_DAMAGE, (ctx: any) => {
      if (ctx?.input?.source?.id !== s.id || !inStance(s)) return;
      setNote(s, N_DEALT, Number(noteValue(s, N_DEALT) ?? 0) + Number(ctx?.result?.final ?? 0));
    }, "ALL", false);
    reg(EV.TURN_END, async (ctx: any) => {
      if (ctx?.actor?.id !== s.id || !inStance(s)) return;
      if (noteValue(s, N_CAST) === String(battle.turn ?? 0)) { setNote(s, N_CAST, "-"); return; }
      const left = Number(noteValue(s, N_TURNS) ?? 0) - 1;
      setNote(s, N_TURNS, left);
      if (left <= 0) await endStance(battle, s);
    }, "SELF", false);
    out.push({ entityId: s.id, mechanic: "红莲 (control/banish immunity, heal −30%, 大妖之力) · 天火怒焱 stance (burn, guard, L3 recover) · 烈焰焚天" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "341_02": { note: "红莲: immunity, heal cut and 大妖之力 are run by betting-shuten.ts", patch: { statusRefConditionOnly: [0] } },
    "341_03": {
      note: "天火怒焱 at max: push 40% (L4), dispel 2 buffs (L2); 鬼王姿态 is entered by betting-shuten.ts (slot 1 is the cast condition)",
      patch: {
        timeline: [{ percent: SHUTEN.push, direction: "push" }],
        purge: [{ kind: "DISPEL", side: "ENEMY", what: "BUFF", evidence: "击退敌方全体40%行动条并驱散2个增益效果 (L2/L4)", count: SHUTEN.dispel }],
        statusRefConditionOnly: [0, 1],
      },
    },
  }),
  damageHook: burnerHook,
  afterCast,
  ruleSkill,
  gate,
  install,
};
