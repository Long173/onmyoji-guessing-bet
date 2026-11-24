// compile/betting-kagewani.ts — 影鳄 (R 375, Global "Kagewani") at max skill level. MAX mode only (match 11).
//
// Sources: data/kb/shikigami.json 375_01..375_03, buff 3752_1 影食, tips_113 影缚; data/kb/en-text.json (Global).
// Before this module the passive 影壳 never ran (generic passives are off) and 幕影盖地's 影缚 kept the level-1 20%
// chance (the max-level "基础概率增至35% / 50%" lines were skipped).
//   影壳 (375_02, passive) · attacking with 影袭 / 幕影盖地: 60% base chance (L4) to apply 影食 (3752_1) for 2 turns.
//                           影食: up to 2 stacks; at 2 stacks the stacks are consumed for shield-ignoring damage of
//                           30% ATK (L3). L5: when 影食 is consumed, Kagewani heals 3% of her max HP.
//   幕影盖地 (375_03, 3)    · 2 × 30% on all enemies, then 80% on the target with a 50% base chance (L5) of 影缚 for
//                           1 turn (generic path, probability patched to 50).
//   AI (KB, compiles)      · 幕影盖地 when affordable, else 影袭 (unchanged).
// Readings (conservative, unverified): 影壳 rolls once per enemy per cast (not per hit); the 30% ATK burst is dealt
// as indirect damage and shields still absorb it (the "shield-ignoring" rider is NOT modelled).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, findImmuneStatus } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
import { rollStatusContest, reportResist } from "../kernel/resist.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, stacksOn, setStackedStatus } from "./betting-shared.ts";
import { currentHit } from "./betting-scope.ts";

export const KAGEWANI = Object.freeze({ devourChance: 0.6, devourCap: 2, devourTurns: 2, burstAtk: 0.3, healMaxHp: 0.03, bindChance: 50 });
export const DEVOUR_ID = "3752_1";
const TAG = "betting-375:";

const devourDef = () => markDef({ id: DEVOUR_ID, name: "影食", category: StatusCategory.DEBUFF_STATE, dispellable: true, removable: true, durationPolicy: "TARGET_TURN",
  desc: "【减益、状态】最多可叠加2层，累计2层时，消耗当前层数并造成30%攻击的无视护盾伤害（影鳄 L3）。" }, StatusBook);

export const isKagewani375 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "375_02") && !!skillById(e, "375_03");

/** 影壳: one contested 影食 stack on `v`; at 2 stacks the burst. */
export async function applyDevour(battle: any, k: Entity, v: Entity, skill: string): Promise<void> {
  if (!v?.alive || v.teamId === k.teamId) return;
  const def = devourDef();
  const tag = "kagewani375:" + skill + ":" + v.id;
  const contest = rollStatusContest(battle, k, v, def, KAGEWANI.devourChance, "status_prob:" + tag, "resist:" + tag);
  if (contest.outcome === "MISS") {
    battle.trace.push({ t: "STATUS_MISS", src: k.id, dst: v.id, status: DEVOUR_ID, name: "影食", probability: KAGEWANI.devourChance * 100, skill, ref: DEVOUR_ID });
    return;
  }
  if (contest.outcome === "RESIST") { await reportResist(battle, k, v, def, contest, { probability: KAGEWANI.devourChance * 100, duration: KAGEWANI.devourTurns, ref: DEVOUR_ID, skill }); return; }
  const imm = findImmuneStatus(v, def, battle.policies?.immune?.debuffCoversControl ?? true);
  if (imm) {
    battle.trace.push({ t: "IMMUNE", src: k.id, dst: v.id, status: DEVOUR_ID, name: "影食", by: imm.def.id, kind: imm.kind, consumed: imm.consumed, ref: DEVOUR_ID, skill });
    return;
  }
  const n = setStackedStatus(v, def, stacksOn(v, DEVOUR_ID, k.id) + 1, KAGEWANI.devourCap, k.id, [], KAGEWANI.devourTurns);
  battle.trace.push({ t: "STATUS_APPLY", src: k.id, dst: v.id, status: DEVOUR_ID, name: "影食", category: def.category, duration: KAGEWANI.devourTurns, ref: DEVOUR_ID, known: true, stacks: n, threshold: KAGEWANI.devourCap, skill });
  if (n < KAGEWANI.devourCap) return;
  setStackedStatus(v, def, 0, KAGEWANI.devourCap, k.id, []);
  battle.trace.push({ t: "STACKS_CONSUMED", id: v.id, status: DEVOUR_ID, name: "影食", from: n, to: 0, reason: "TWO_STACKS", skill: "影壳" });
  await dealDamage(battle, { source: k, target: v, base: k.prop("atk") * KAGEWANI.burstAtk, rate: 1, type: DamageType.INDIRECT, skillTag: TAG + "devour" });
  if (k.alive) await battle.heal(k, k, k.maxHp * KAGEWANI.healMaxHp, { crit: false });
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const k of entities.filter(isKagewani375)) {
    const names = new Set([skillById(k, "375_01")?.name, skillById(k, "375_03")?.name].filter(Boolean));
    const rolled = new Set<number>();
    registerOwnerHandler(battle, "betting:375:devour:" + k.id, k.id, EV.AFTER_DAMAGE, async (ctx: any) => {
      const src = ctx?.input?.source, dst = ctx?.input?.target;
      if (src?.id !== k.id || !dst?.alive || dst.teamId === k.teamId || ctx?.result?.type === DamageType.INDIRECT) return;
      const skill = currentHit(battle).skill;
      if (!skill || !names.has(skill) || String(ctx.input.skillTag ?? "").startsWith("soul:")) return;
      if (rolled.has(dst.id)) return;
      rolled.add(dst.id);
      await applyDevour(battle, k, dst, "影壳");
    }, "ALL");
    ensureGlobalHandler(battle, "betting:375:devour-reset:" + k.id, EV.ACTION_END, () => rolled.clear());
    out.push({ entityId: k.id, mechanic: "影壳 (60% 影食 per enemy per cast, 2 stacks → 30% ATK burst + 3% max-HP heal) · 幕影盖地 影缚 50%" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "375_03": {
      note: "幕影盖地 L5: 影缚 base chance 50% (the max-level probability lines were skipped)",
      patch: {
        probabilities: [KAGEWANI.bindChance],
        controlRefs: [{ ref: "shadowBind", tipId: "113", name: "影缚", duration: 1, probability: KAGEWANI.bindChance, bearer: "EFFECT_TARGET",
          clause: "影子最后再对敌方目标猛冲造成攻击80%伤害并有50%[tips_2]附加[tips_113]" }],
      },
    },
  }),
  install,
};
