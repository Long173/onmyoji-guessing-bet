// compile/betting-miakashi.ts — 慧明灯 (SR 552, Global "Miakashi") at max skill level. MAX mode only (match 14).
//
// Sources: data/kb/shikigami.json 552_02 / 552_03, buff 5522_1 业障, tips_5523 明识灯, tips_115 拘魂, tips_27 可行动状态,
// data/kb/ai.json row 552; data/kb/en-text.json (Global, same meaning). Before this module 业回 did nothing and 正念's
// compiled riders were wrong: it removed one ALLY status of any kind (it stripped 云外镜's 镜佑 buff), put 1 stack of
// 业障 and an unconditional 拘魂 on the cast target, and the DEF aura stayed at the L1 20%.
//   业回 (552_02, passive) · taking damage from an enemy ⇒ 1 stack of 业障 on it (−5% ATK per stack, cap 3). When a
//        non-summon ally other than herself takes single-target damage and she is actionable (tips_27): 50% to take
//        50% of it in its place, and heal herself and the lowest-HP-ratio non-summon ally 6% of her max HP.
//   正念 (552_03, 3) · 明识灯 (compiled summon: 45% HP, 100% DEF, immune, −40 SPD on her, +2 onibi when recalled at
//        her turn start, which also removes 业障 — kept). While it is out: non-summon allies +40% DEF (L3; the compiled
//        aura gives 20%, this module adds the other 20%) and every enemy carrying 3 业障 is put into 拘魂 (cannot act,
//        cannot be dispelled) until the recall. L5: on the summon, dispels 2 debuffs / controls from every allied
//        shikigami.
//   AI (KB) · always 正念 (generic AI, unchanged).
// Readings (conservative, noted in the report):
//   · 业障 is a mark from a passive with no base probability: applied without an effect-hit contest (alternative reading
//     — contested with her 0% hit — reported with its win rate). One stack per damage instance (status ticks excluded).
//   · 拘魂 ends when 明识灯 is recalled (her turn start) or when she dies.
//   · The 50% guard is fixed damage from the original attacker (so it gives the attacker 业障); shared damage is never
//     shared again; a damage that cannot be shared (INDIRECT) is not guarded. "Single-target" = a skill hit that is not
//     an all-enemy part (isAoeHit).
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, CONTROL_EFFECTS, isActionPrevented } from "../kernel/status.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, stacksOn, setStackedStatus,
  isDebuffOrControl, isControlDef, PERSIST, STATUS_TICK_TAG,
} from "./betting-shared.ts";
import { currentHit, isAoeHit } from "./betting-scope.ts";
import { redirectShare, isShareDamage } from "./betting-amezaiku.ts";

export const MIAKASHI = Object.freeze({ karmaAtk: -0.05, karmaCap: 3, guardChance: 0.5, guardPart: 0.5, guardHeal: 0.06, defExtra: 0.2, dispels: 2 });
export const KARMA_ID = "5522_1";
export const LANTERN_TIPS = "5523";
const DEF_ID = "552_def_l3";
const BIND_ID = "soulDetain";

const karmaDef = () => markDef({ id: KARMA_ID, name: "业障", category: StatusCategory.DEBUFF_MARK, durationPolicy: "GLOBAL",
  dispellable: true, removable: true, desc: "【减益、印记】上限3层，每层降低5%攻击。" }, StatusBook);
const defDef = () => markDef({ id: DEF_ID, name: "明识灯·防御", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "正念 L3：明识灯在场时，除召唤物外友方防御提升至40%（编译光环20% + 此处20%）。" }, StatusBook);
const bindDef = () => CONTROL_EFFECTS.find(d => d.id === BIND_ID) ?? StatusBook.get(BIND_ID)!;

export const isMiakashi = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "552_02") && !!skillById(e, "552_03");
export const karmaOn = (v: Entity, src: Entity): number => stacksOn(v, KARMA_ID, src.id);
const ratioOf = (v: Entity): number => (v.maxHp > 0 ? v.hp / v.maxHp : 1);
export const lanternOut = (battle: any, m: Entity): boolean =>
  (battle.teams[m.teamId]?.summons ?? []).some((s: Entity) => s.alive && (s.notes ?? []).includes("summon:" + LANTERN_TIPS));
const actionable = (e: Entity): boolean => e.alive && !isActionPrevented(e.statusDefs()) && !e.statuses.some(s => isControlDef(s.def));

function bind(battle: any, m: Entity, v: Entity, why: string): void {
  if (!v.alive || v.statuses.some(s => s.def.id === BIND_ID && s.sourceId === m.id)) return;
  const a = v.addStatus(bindDef(), m.id, 1, PERSIST, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: m.id, dst: v.id, status: BIND_ID, name: "拘魂", category: StatusCategory.DEBUFF_STATE, duration: PERSIST, ref: "CONTROL:" + BIND_ID, known: true, tag: (a as any)?.tag ?? null, skill: "正念", clause: why });
}
function unbindAll(battle: any, m: Entity, why: string): void {
  for (const v of battle.allEntities() as Entity[]) {
    for (const st of [...v.statuses]) {
      if (st.def.id !== BIND_ID || st.sourceId !== m.id) continue;
      if (v.expireStatus(st)) battle.trace.push({ t: "STATUS_REMOVE", id: v.id, status: BIND_ID, name: "拘魂", by: why, side: "ENEMY", what: "CONTROL", src: m.id, skill: "正念" });
    }
  }
}
function clearDefBonus(m: Entity, battle: any): void {
  for (const v of battle.teams[m.teamId].members as Entity[]) for (const st of [...v.statuses]) if (st.def.id === DEF_ID && st.sourceId === m.id) v.expireStatus(st);
}

export function addKarma(battle: any, m: Entity, v: Entity): number {
  const n = setStackedStatus(v, karmaDef(), karmaOn(v, m) + 1, MIAKASHI.karmaCap, m.id, [{ prop: "atk", value: MIAKASHI.karmaAtk, mode: "ADD_RATE" }]);
  battle.trace.push({ t: "STATUS_APPLY", src: m.id, dst: v.id, status: KARMA_ID, name: "业障", category: StatusCategory.DEBUFF_MARK, duration: PERSIST, ref: KARMA_ID, known: true, stacks: n, threshold: MIAKASHI.karmaCap, skill: "业回" });
  if (n >= MIAKASHI.karmaCap && lanternOut(battle, m)) bind(battle, m, v, "明识灯在场：携带3层业障的敌方陷入拘魂");
  return n;
}

/** 正念: L3 DEF top-up, 拘魂 on the 3-stack enemies, L5 dispel 2 per allied shikigami. */
async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "552_03" || !isMiakashi(self)) return false;
  if (!lanternOut(battle, self)) return true;
  clearDefBonus(self, battle);
  for (const v of (battle.teams[self.teamId].members as Entity[]).filter(a => a.alive && !isSummonUnit(a))) {
    v.addStatus(defDef(), self.id, 1, PERSIST, [{ prop: "def", value: MIAKASHI.defExtra, mode: "ADD_RATE" }], 1);
    for (let left = MIAKASHI.dispels; left > 0; left--) {
      const st = v.statuses.find(s => s.def.dispellable && isDebuffOrControl(s.def));
      if (!st || !v.dispel(st.def.id)) break;
      battle.trace.push({ t: "STATUS_REMOVE", id: v.id, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what: isControlDef(st.def) ? "CONTROL" : "DEBUFF", src: self.id, skill: x.name });
    }
  }
  for (const v of battle.enemiesOf(self.teamId) as Entity[]) if (v.alive && karmaOn(v, self) >= MIAKASHI.karmaCap) bind(battle, self, v, "召唤明识灯：携带3层业障的敌方陷入拘魂");
  return true;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const m of entities.filter(isMiakashi)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = true) =>
      registerOwnerHandler(battle, "betting:552:" + code + ":" + m.id, m.id, code, fn, range, { passive });
    // 业回 (a): damage from an enemy ⇒ 1 业障 on it.
    reg(EV.AFTER_DAMAGE, (ctx: any) => {
      const src: Entity | undefined = ctx?.input?.source;
      if (ctx?.input?.target?.id !== m.id || !src || src.teamId === m.teamId || isSummonUnit(src) || !src.alive) return;
      if (String(ctx.input.skillTag ?? "").startsWith(STATUS_TICK_TAG)) return;
      if (!(Number(ctx?.result?.applied ?? 0) > 0 || Number(ctx?.result?.absorbed ?? 0) > 0)) return;
      addKarma(battle, m, src);
    });
    // 业回 (b): 50% guard of 50% of a single-target hit on another non-summon ally, + two 6% heals.
    reg(EV.BEFORE_DAMAGE, async (ctx: any) => {
      const v: Entity | undefined = ctx?.input?.target, src: Entity | undefined = ctx?.input?.source;
      if (!v || !src || v.id === m.id || v.teamId !== m.teamId || isSummonUnit(v) || src.teamId === m.teamId) return;
      if (isShareDamage(ctx) || !(ctx?.result?.final > 0) || ctx.result.canBeShared === false) return;
      if (!currentHit(battle).skill || isAoeHit(battle, src) || !actionable(m)) return;
      battle.rng.expect("miakashi552_guard");
      if (!battle.rng.testHit(MIAKASHI.guardChance)) return;
      const moved = await redirectShare(battle, ctx, m, MIAKASHI.guardPart, "业回");
      if (!(moved > 0) || !m.alive) return;
      await battle.heal(m, m, m.maxHp * MIAKASHI.guardHeal, { crit: false });
      const allies = (battle.teams[m.teamId].members as Entity[]).filter(a => a.alive && !isSummonUnit(a) && a.id !== m.id);
      if (!allies.length) return;
      const low = allies.reduce((a, b) => (ratioOf(b) < ratioOf(a) ? b : a));
      await battle.heal(m, low, m.maxHp * MIAKASHI.guardHeal, { crit: false });
    });
    // Her turn start: 明识灯 is recalled (kernel) ⇒ 拘魂 and the DEF top-up end.
    reg(EV.TURN_START, (ctx: any) => {
      if (ctx?.actor?.id !== m.id) return;
      unbindAll(battle, m, "RECALL");
      clearDefBonus(m, battle);
    }, "ALL", false);
    out.push({ entityId: m.id, mechanic: "业回 (业障 on attackers, 50%/50% single-target guard + 6% heals) · 正念 (L3 +40% DEF, 拘魂 on 3-stack enemies while the lantern is out, L5 dispel 2)" });
  }
  // Her death: the 拘魂 she applied and the DEF top-up end (global: runs after her death).
  ensureGlobalHandler(battle, "betting:552:death", EV.KILLED, (ctx: any) => {
    const t: Entity | undefined = ctx?.target;
    if (!t || !isMiakashi(t)) return;
    unbindAll(battle, t, "OWNER_DEAD");
    clearDefBonus(t, battle);
  });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "552_03": { note: "正念: 拘魂 on 3-stack enemies, the L3 DEF top-up and the L5 dispel are run by betting-miakashi.ts (the compiled ALLY 'remove any', the 业障 on cast and the unconditional 拘魂 are removed; summon / recall kept)", patch: { purge: [], controlRefs: [], statusRefConditionOnly: [0, 1] } },
  }),
  afterCast,
  install,
};
