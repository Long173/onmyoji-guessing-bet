// compile/betting-oko.ts — 阿香 (309, Global "Oko") at max skill level. MAX mode only (match 13).
//
// Sources: data/kb/shikigami.json 309_01..309_03, buff 3092_1 蛇之影 (−8% DEF per stack), tips_12 传导伤害, tips_108 眩晕,
// data/kb/ai.json row 309; data/kb/en-text.json (Global, same meaning). Before this module 蛇之影 (passive) never ran, so
// 蛇卒·狂暴 had no stacks to scale with, while its compiled stun row stunned every target (no 3-stack condition) for a
// "1 turn" that expired at the end of her own turn.
//   蛇卒·毒牙 (309_01) · 125% ATK (compiled, unchanged).
//   蛇之影 (309_02, passive) · when attacking (attack start, EV.SKILL_START — counters included): 100% base chance to put
//        1 stack of 蛇之影 on the target (max 3, 3 turns). When she or an ally takes non-conducted damage from an enemy:
//        25% chance to counterattack that enemy; at most 1 counter per enemy attack.
//   蛇卒·狂暴 (309_03, 3) · 216% ATK (L5) +40% per 蛇之影 stack on the target; 100% base chance Stun 1 turn if it has 3 stacks.
//   AI (KB) · "3技能" every turn (the generic KB rule already does this) — not hand-written.
// Readings (unverified — noted in the report):
//   · The stack lands at the attack start, so 蛇卒·狂暴 counts the stack it applies itself (1st cast on a fresh target =
//     +40%, and a target at 2 stacks is stunned by the cast that brings it to 3). The alternative (stack after the hit)
//     delays every bonus and the stun by one attack.
//   · Counter: one 25% roll per damaged ally (Oko included) per enemy attack (not per hit segment), stopping at the first
//     success; status ticks, soul / reflected / conducted / indirect damage are not attacks; counters never chain and a
//     controlled Oko does not counter (Battle.counterAttack).
//   · 蛇之影 "3 turns" = 3 of the bearer's turns (TARGET_TURN), refreshed by every new stack; Stun "1 turn" = the bearer's
//     next turn (bearerTurnControl).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import { rollStatusContest, reportResist } from "../kernel/resist.ts";
import type { BettingKit, Hook, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, stacksOn, setStackedStatus, applyContested,
  untargetableInBetting, STATUS_TICK_TAG, noteValue, setNote,
} from "./betting-shared.ts";
import { bearerTurnControl } from "./betting-fengyang.ts";

export const OKO = Object.freeze({ shadowCap: 3, shadowTurns: 3, shadowDef: -0.08, shadowP: 1, counter: 0.25, ultRatio: 216, ultPerStack: 40, stunP: 1 });
export const SHADOW_ID = "3092_1";
const N_ACTION = "oko309:action=", N_ROLLED = "oko309:rolled=";

const shadowDef = () => markDef({ id: SHADOW_ID, name: "蛇之影", category: StatusCategory.DEBUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【减益、状态】每层降低-8%防御。" }, StatusBook);

export const isOko = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "309_02") && !!skillById(e, "309_03");
export const shadowStacks = (v: Entity): number => stacksOn(v, SHADOW_ID);

/** 蛇之影: +1 stack on `v` (100% base chance, contested by effect RES); refreshes the 3 turns. */
export async function addShadow(battle: any, o: Entity, v: Entity, skill = "蛇之影"): Promise<boolean> {
  if (!v?.alive || v.teamId === o.teamId) return false;
  const def = shadowDef();
  const tag = SHADOW_ID + ":" + skill + ":" + v.id;
  const contest = rollStatusContest(battle, o, v, def, OKO.shadowP, "status_prob:" + tag, "resist:" + tag);
  if (contest.outcome === "MISS") return false;
  if (contest.outcome === "RESIST") {
    await reportResist(battle, o, v, def, contest, { probability: OKO.shadowP, duration: OKO.shadowTurns, ref: SHADOW_ID, skill });
    return false;
  }
  // One pool of stacks whatever the source (one 阿香 per side in practice).
  const src = v.statuses.find(s => s.def.id === SHADOW_ID)?.sourceId ?? o.id;
  const n = setStackedStatus(v, def, shadowStacks(v) + 1, OKO.shadowCap, src, [{ prop: "def", value: OKO.shadowDef, mode: "ADD_RATE" }], OKO.shadowTurns);
  const st = v.statuses.find(s => s.def.id === SHADOW_ID);
  if (st) st.remaining = OKO.shadowTurns;
  battle.trace.push({ t: "STATUS_APPLY", src: o.id, dst: v.id, status: SHADOW_ID, name: "蛇之影", category: def.category, duration: OKO.shadowTurns, ref: SHADOW_ID, known: true, stacks: n, threshold: OKO.shadowCap, skill });
  return true;
}

/** 蛇卒·狂暴: 216% + 40% per stack, then Stun (1 bearer turn) on a 3-stack target. */
function frenzyHook(x: any): Hook | null {
  if (x?.id !== "309_03") return null;
  return {
    kind: "SERPENT_FRENZY",
    run: async (battle, o, hurt, primary) => {
      const t = primary?.alive && primary.teamId !== o.teamId ? primary : battle.enemiesOf(o.teamId).find((v: Entity) => v.alive);
      if (!t) return;
      hurt.push(t);
      const n = shadowStacks(t);
      const ratio = (OKO.ultRatio + OKO.ultPerStack * n) / 100;
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        await battle.damage(o, t, o.prop("atk") * ratio, DamageType.NORMAL, 1, x.lifesteal ?? null);
      });
      if (t.alive && n >= OKO.shadowCap) await applyContested(battle, o, t, bearerTurnControl("stun"), OKO.stunP, 1, [], { skill: x.name, ref: "CONTROL:stun" });
    },
  };
}

/** Enemy damage on her side: one 25% roll per damaged ally per enemy attack, at most one counter. */
async function onAllyHit(battle: any, o: Entity, ctx: any): Promise<void> {
  const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
  if (!src || !dst || !o.alive || !src.alive || src.teamId === o.teamId || dst.teamId !== o.teamId) return;
  if (untargetableInBetting(src)) return;
  const t = ctx?.result?.type ?? ctx?.input?.type;
  const tag = String(ctx.input.skillTag ?? "");
  if (t === DamageType.CONDUCTION || t === DamageType.INDIRECT || tag.startsWith("soul:") || tag.startsWith("reflect:") || tag.startsWith(STATUS_TICK_TAG)) return;
  if (isActionPrevented(o.statusDefs())) return;
  const action = battle.turn + ":" + src.id;
  if (noteValue(o, N_ACTION) !== action) { setNote(o, N_ACTION, action); setNote(o, N_ROLLED, ""); }
  const rolled = String(noteValue(o, N_ROLLED) ?? "");
  if (rolled === "done" || rolled.split(",").includes(String(dst.id))) return;
  setNote(o, N_ROLLED, rolled ? rolled + "," + dst.id : String(dst.id));
  battle.rng.expect("oko309_counter");
  if (!battle.rng.testHit(OKO.counter)) return;
  setNote(o, N_ROLLED, "done");
  await battle.counterAttack(o, src.id);
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const o of entities.filter(isOko)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:309:" + code + ":" + o.id, o.id, code, fn, range);
    reg(EV.SKILL_START, async (ctx: any) => {
      if (ctx?.actor?.id !== o.id) return;
      const v: Entity | undefined = ctx?.target;
      if (v?.alive && v.teamId !== o.teamId) await addShadow(battle, o, v);
    }, "SELF");
    reg(EV.AFTER_DAMAGE, (ctx: any) => onAllyHit(battle, o, ctx));
    out.push({ entityId: o.id, mechanic: "蛇之影 (attack-start stacks −8% DEF, max 3, 3 turns; 25% counter once per enemy attack) · 蛇卒·狂暴 (+40%/stack, Stun at 3 stacks)" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "309_03": { note: "蛇卒·狂暴: per-stack scaling and the 3-stack Stun are run by betting-oko.ts", patch: { controlRefs: [], statusRefConditionOnly: [0, 1] } },
  }),
  damageHook: (x: any) => (bettingActive() ? frenzyHook(x) : null),
  install,
};
