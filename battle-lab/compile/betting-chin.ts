// compile/betting-chin.ts — 鸩 (SR 285, Global "Chin") at max skill level. MAX mode only (match 10).
//
// Sources: data/kb/shikigami.json 285_01..285_03, buffs 2852_1 毒羽, tips_5 间接伤害, data/kb/ai.json (KB AI rows);
// data/kb/en-text.json (Global). Before this module 毒羽 was applied as a plain status that never dealt damage (the
// stack-level tick lives in the buff text, not in an executable slot), so Chin's poison did 0 damage in MAX battles.
//   毒羽 (2852_1)       · 减益、状态, up to 5 stacks. Before the bearer's turn (turn start): indirect damage of
//                        2% / 6% / 12% / 20% / 30% (285_02 L4) of the BEARER's max HP by stack count, capped at 280%
//                        of Chin's ATK; then −1 stack. L3: each stack on the target counts as −50 DEF for Chin's
//                        indirect damage. L5: applying 毒羽 to a target already at 5 stacks deals indirect damage of
//                        30% of its max HP (cap 280% ATK) instead.
//   鸩羽 (285_01)       · 100% ATK + 2 毒羽 on the target.
//   毒之华 (285_02, 2)  · 2 毒羽 on every enemy. Passive part: when Chin is attacked (direct damage), the attacker gets
//                        1 毒羽 (once per enemy action).
//   毒蚀 (285_03, 3)    · L4: 3 毒羽 on the target first; 210% ATK, then consumes every 毒羽 stack on the target for
//                        42% ATK indirect damage each. L5: target survives ⇒ free 毒之华 that applies 1 毒羽.
//   AI (KB)            · 1 enemy left or ≥3 enemies carry 毒羽 → 毒蚀; otherwise 毒之华; the normal attack when the
//                        onibi are short. 毒蚀 targets an enemy below 30% HP first.
// Readings (unverified): 毒羽 applications are contested by effect RES like other debuffs with no written chance
// (one roll per application); "持续2回合" is read as the stack decay (no separate 2-turn timer); the 280% cap is
// applied to the base before DEF; the passive retaliation needs a direct hit.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, findImmuneStatus } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
import { rollStatusContest, reportResist } from "../kernel/resist.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, stacksOn, setStackedStatus, PERSIST, STATUS_TICK_TAG,
} from "./betting-shared.ts";

export const CHIN = Object.freeze({
  cap: 5, tick: [0, 0.02, 0.06, 0.12, 0.2, 0.3] as readonly number[], hpCapAtk: 2.8, overflow: 0.3, defPerStack: 50,
  basicStacks: 2, blossomStacks: 2, freeBlossomStacks: 1, corrodeStacks: 3, corrodeRatio: 210, consumeRatio: 0.42, retaliate: 1,
});
export const POISON_ID = "2852_1";
const TAG = "betting-285:";

const poisonDef = () => markDef({ id: POISON_ID, name: "毒羽", category: StatusCategory.DEBUFF_STATE, dispellable: true, removable: true, durationPolicy: "GLOBAL",
  desc: "【减益、状态】附加毒羽层数等级的中毒效果，回合开始前造成间接伤害（层数1～5：生命上限2%、6%、12%、20%、30%，不超过鸩攻击280%），之后减少1层，上限5层。" }, StatusBook);

export const isChin285 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "285_02") && !!skillById(e, "285_03");
export const poisonStacks = (v: Entity): number => v.statuses.filter(s => s.def.id === POISON_ID).reduce((n, s) => n + s.stacks, 0);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const entity = (battle: any, id: number): Entity | null => battle.allEntities().find((x: Entity) => x.id === id) ?? null;

/** Chin's indirect damage on `v`: base before DEF; L3 treats each 毒羽 stack as −50 DEF (exact rescale of 300/(300+def)). */
async function indirect(battle: any, c: Entity, v: Entity, base: number, what: string): Promise<void> {
  if (!v?.alive || !(base > 0)) return;
  const def = Math.max(0, v.prop("def"));
  const cut = Math.max(0, def - CHIN.defPerStack * poisonStacks(v));
  const rate = (300 + def) / (300 + cut);
  await dealDamage(battle, { source: c, target: v, base: base * rate, rate: 1, type: DamageType.INDIRECT, skillTag: TAG + what });
}
const hpBased = (c: Entity, v: Entity, pct: number): number => Math.min(v.maxHp * pct, c.prop("atk") * CHIN.hpCapAtk);
/** Tick base with the L3 DEF rescale (same as `indirect`). */
function tickBase(c: Entity, v: Entity, n: number): number {
  const def = Math.max(0, v.prop("def"));
  const cut = Math.max(0, def - CHIN.defPerStack * poisonStacks(v));
  return hpBased(c, v, CHIN.tick[Math.min(CHIN.cap, n)] ?? 0) * (300 + def) / (300 + cut);
}

/** n 毒羽 on `v` (one contest). At 5 stacks the L5 overflow strikes instead. */
export async function applyPoison(battle: any, c: Entity, v: Entity, n: number, skill: string): Promise<void> {
  if (!v?.alive || v.teamId === c.teamId || n <= 0) return;
  const def = poisonDef();
  const tag = "chin285:" + skill + ":" + v.id;
  const contest = rollStatusContest(battle, c, v, def, null, "status_prob:" + tag, "resist:" + tag);
  if (contest.outcome === "MISS") return;
  if (contest.outcome === "RESIST") { await reportResist(battle, c, v, def, contest, { probability: null, duration: PERSIST, ref: POISON_ID, skill }); return; }
  const imm = findImmuneStatus(v, def, battle.policies?.immune?.debuffCoversControl ?? true);
  if (imm) {
    battle.trace.push({ t: "IMMUNE", src: c.id, dst: v.id, status: POISON_ID, name: "毒羽", by: imm.def.id, kind: imm.kind, consumed: imm.consumed, ref: POISON_ID, skill });
    return;
  }
  const before = stacksOn(v, POISON_ID, c.id);
  if (before >= CHIN.cap) {
    battle.trace.push({ t: "SUBSKILL", actor: c.id, skill: "毒之华", form: "毒羽溢出", target: v.id });
    await indirect(battle, c, v, hpBased(c, v, CHIN.overflow), "overflow");
    return;
  }
  const after = setStackedStatus(v, def, before + n, CHIN.cap, c.id, []);
  battle.trace.push({ t: "STATUS_APPLY", src: c.id, dst: v.id, status: POISON_ID, name: "毒羽", category: def.category, duration: PERSIST, ref: POISON_ID, known: true, stacks: after, threshold: CHIN.cap, skill });
}

async function blossom(battle: any, c: Entity, n: number, skill: string): Promise<void> {
  for (const v of aliveEnemies(battle, c)) await applyPoison(battle, c, v, n, skill);
}

function damageHook(x: any): any {
  if (x?.id === "285_01") return {
    kind: "CHIN_FEATHER",
    run: async (battle: any, c: Entity, hurt: Entity[], primary?: Entity) => {
      const v = primary?.alive && primary.teamId !== c.teamId ? primary : aliveEnemies(battle, c)[0];
      if (!v) return;
      hurt.push(v);
      const ratio = Number(x.damage?.[0]?.ratioMax ?? x.damage?.[0]?.ratio ?? 100);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        if (v.alive) await battle.damage(c, v, c.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, x.lifesteal ?? null);
      });
      if (isChin285(c)) await applyPoison(battle, c, v, CHIN.basicStacks, x.name);
    },
  };
  if (x?.id === "285_03") return {
    kind: "CHIN_CORRODE",
    run: async (battle: any, c: Entity, hurt: Entity[], primary?: Entity) => {
      const v = primary?.alive && primary.teamId !== c.teamId ? primary : aliveEnemies(battle, c)[0];
      if (!v) return;
      hurt.push(v);
      await applyPoison(battle, c, v, CHIN.corrodeStacks, x.name);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        if (v.alive) await battle.damage(c, v, c.prop("atk") * (CHIN.corrodeRatio / 100), DamageType.NORMAL, 1, x.lifesteal ?? null);
      });
      const n = stacksOn(v, POISON_ID, c.id);
      if (n > 0 && v.alive) {
        await indirect(battle, c, v, c.prop("atk") * CHIN.consumeRatio * n, "corrode");
        setStackedStatus(v, poisonDef(), 0, CHIN.cap, c.id, []);
        battle.trace.push({ t: "STACKS_CONSUMED", id: v.id, status: POISON_ID, name: "毒羽", from: n, to: 0, reason: "CORRODE", skill: x.name });
      }
      if (v.alive && c.alive) {
        battle.trace.push({ t: "SUBCAST", actor: c.id, ref: "285_02", skill: "毒之华", target: v.id, clause: "毒蚀 L5：未击杀 ⇒ 无消耗施放毒之华（附加1层毒羽）" });
        await blossom(battle, c, CHIN.freeBlossomStacks, "毒之华");
      }
    },
  };
  return null;
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isChin285(self) || x?.id !== "285_02") return false;
  await blossom(battle, self, CHIN.blossomStacks, x.name);
  return true;
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isChin285(self)) return null;
  const corrode = skillById(self, "285_03"), bloom = skillById(self, "285_02"), basic = skillById(self, "285_01");
  const can = (sk: any) => !!sk && (!(costOf(sk) > 0) || battle.teams[self.teamId].orbs.canPay(costOf(sk)));
  const foes = aliveEnemies(battle, self);
  const carriers = foes.filter(v => poisonStacks(v) > 0).length;
  if (foes.length <= 1 || carriers > 2) {
    if (can(corrode)) return { skill: corrode, rule: foes.length <= 1 ? "鸩: 敌方剩余1名 → 毒蚀 (KB AI)" : "鸩: 敌方毒羽单位>2 → 毒蚀 (KB AI)" };
    return basic ? { skill: basic, rule: "鸩: 毒蚀鬼火不足 → 鸩羽" } : null;
  }
  if (can(bloom)) return { skill: bloom, rule: "鸩: 敌方毒羽单位≤2 → 毒之华 (KB AI)" };
  return basic ? { skill: basic, rule: "鸩: 毒之华鬼火不足 → 鸩羽" } : null;
}

function target(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || !isChin285(self) || (x?.id !== "285_03" && x?.id !== "285_01")) return null;
  const low = cands.filter(v => v.alive && v.teamId !== self.teamId && v.hp / v.maxHp < (x.id === "285_03" ? 0.3 : 0.2));
  if (!low.length) return null;
  const t = low.reduce((a, b) => (a.hp / a.maxHp <= b.hp / b.maxHp ? a : b));
  return { target: t, rule: x.id === "285_03" ? "鸩: 毒蚀优先血量低于30%的单位 (KB AI)" : "鸩: 鸩羽优先血量低于20%的单位 (KB AI)" };
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isChin285);
  if (!units.length) return out;
  for (const c of units) {
    const hitBy = new Set<number>();
    registerOwnerHandler(battle, "betting:285:retaliate:" + c.id, c.id, EV.DAMAGE, async (ctx: any) => {
      const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
      if (!src || dst?.id !== c.id || src.teamId === c.teamId || !src.alive || ctx?.result?.type === DamageType.INDIRECT) return;
      if (hitBy.has(src.id)) return;
      hitBy.add(src.id);
      await applyPoison(battle, c, src, CHIN.retaliate, "毒之华");
    }, "ALL");
    ensureGlobalHandler(battle, "betting:285:retaliate-reset:" + c.id, EV.ACTION_END, () => hitBy.clear());
    out.push({ entityId: c.id, mechanic: "毒羽 (stack-level max-HP tick, cap 280% ATK, −50 DEF per stack, overflow 30%) · 毒之华 retaliation · 毒蚀 consume + free 毒之华 · KB AI" });
  }
  // 毒羽 tick (outlives Chin: the stacks keep their source).
  ensureGlobalHandler(battle, "betting:285:tick", EV.TURN_START, async (ctx: any) => {
    const v: Entity | undefined = ctx?.actor;
    if (!v?.alive) return;
    for (const st of v.statuses.filter(s => s.def.id === POISON_ID)) {
      const c = entity(battle, st.sourceId);
      if (!c) continue;
      const n = st.stacks;
      await dealDamage(battle, { source: c, target: v, base: tickBase(c, v, n), rate: 1, type: DamageType.INDIRECT, skillTag: STATUS_TICK_TAG + "285" });
      if (!v.statuses.includes(st)) continue;
      const after = setStackedStatus(v, poisonDef(), n - 1, CHIN.cap, c.id, []);
      battle.trace.push({ t: "STACKS_CONSUMED", id: v.id, status: POISON_ID, name: "毒羽", from: n, to: after, reason: "TURN_START", skill: "毒羽" });
    }
  });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "285_01": { note: "鸩羽: the 2 毒羽 stacks are applied by betting-chin.ts", patch: { statusRefConditionOnly: [0] } },
    "285_02": { note: "毒之华: the stacks, the tick and the retaliation are run by betting-chin.ts", patch: { statusRefConditionOnly: [0, 1, 2] } },
    "285_03": { note: "毒蚀: L4 stacks, consumption and the L5 free 毒之华 are run by betting-chin.ts", patch: { statusRefConditionOnly: [0] } },
  }),
  damageHook: (x: any) => (bettingActive() ? damageHook(x) : null),
  afterCast,
  ruleSkill,
  target,
  install,
};
