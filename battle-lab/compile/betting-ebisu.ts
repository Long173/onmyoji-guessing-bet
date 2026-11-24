// compile/betting-ebisu.ts — 惠比寿 (SR 268, Global "Ebisu") at max skill level. MAX mode only (match 11).
//
// Sources: data/kb/shikigami.json 268_01..268_03, data/kb/ai.json row 268; data/kb/en-text.json (Global).
// Before this module 鲤鱼旗 compiled as a 40% max-HP self-heal (the summon sentence was unparsed), it was recast every
// turn, and the passive 转祸为福 never ran (generic passives are off).
//   赐福 (268_01)            · 125% ATK. L5: while the Carp Streamer is on the field, +30% to its action bar.
//   转祸为福 (268_02, passive) · when attacked: 30% (L3) chance to gain 1 onibi (once per enemy attack).
//   鲤鱼旗 (268_03, 2)        · summons the Carp Streamer (kernel summon, occupies the summon slot): 60% (L3) of
//                               Ebisu's max HP, 140% of his SPD, immune to debuffs and control effects.
//                               Before each non-summon ally acts (its turn start) the Carp heals it for 40% of the
//                               Carp's max HP. When the Carp acts: L2 dispel 2 debuffs / control effects from allies
//                               (controls first), L5 +1 onibi. L4: while it is on the field all non-summon allies
//                               +20 SPD, +30 more while below 30% HP.
//   AI (KB, compiles)       · 鲤鱼旗 (now refused while the Carp is alive / the slot is busy), else 赐福.
// Readings (conservative, unverified): the Carp's max HP follows the kernel summon rule (Ebisu's battle max HP, the
// betting HP scale included, as the Goldfish of 金鱼姬); the text gives the Carp no ATK / DEF ⇒ DEF 0 (fragile);
// the heal cannot crit; the Carp does not heal or speed up itself; the onibi gauge is not advanced by its turns.
// The kernel never lets an enemy target a summon; so that the Carp is not immortal, every enemy AoE hit on an ally
// also strikes it once (same base, no souls) — single-target attacks never pick it (favours Red).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, gainOrbs, shiftBar, isDebuffOrControl, isControlDef, PERSIST,
} from "./betting-shared.ts";
import { currentHit, isAoeHit } from "./betting-scope.ts";
import { dealDamage } from "../kernel/damage.ts";

export const EBISU = Object.freeze({ onibiChance: 0.3, carpHp: 0.6, carpSpd: 1.4, carpHeal: 0.4, dispels: 2, carpOrbs: 1, spd: 20, lowSpd: 30, lowHp: 0.3, carpBar: 0.3 });
export const CARP_NOTE = "ebisu268:carp-of=";
export const CARP_SPD_ID = "268_spd";

const spdDef = () => markDef({ id: CARP_SPD_ID, name: "鲤鱼旗·速度", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "鲤鱼旗在场时，友方全体增加20点速度；血量低于最大生命值30%的友方单位额外再增加30点速度（惠比寿 L4）。" }, StatusBook);

export const isEbisu268 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "268_02") && !!skillById(e, "268_03");
export const carpOf = (battle: any, owner: Entity): Entity | null =>
  (battle.teams[owner.teamId]?.summons ?? []).find((s: Entity) => s.alive && s.notes.includes(CARP_NOTE + owner.id)) ?? null;
const carpOwnerId = (s: Entity): number | null => {
  const n = (s?.notes ?? []).find(x => x.startsWith(CARP_NOTE));
  return n === undefined ? null : Number(n.slice(CARP_NOTE.length));
};
const slotBusy = (battle: any, owner: Entity): boolean => {
  const team = battle.teams[owner.teamId];
  return (team?.summons ?? []).filter((s: Entity) => s.alive && s.caps.occupiesSummonSlot).length >= (team?.summonSlots ?? 1);
};

function summonCarp(battle: any, owner: Entity): Entity | null {
  const c = battle.addSummon(owner, {
    tipsId: "268_carp", name: "鲤鱼旗", hp: { prop: "hp", ratio: EBISU.carpHp }, inheritInitialStats: false, noAction: false,
    suppressSoul: false, suppressPassive: false, immuneTo: ["DEBUFF", "CONTROL"], inherit: [],
    spdBonus: (EBISU.carpSpd - 1) * Number(owner.base.spd ?? 0),
    evidence: "268_03：鲤鱼旗继承惠比寿60%生命值（L3），140%速度，免疫减益状态和控制效果",
  }, { hasSkills: false });
  if (!c) return null;
  c.caps.advancesOrbGauge = false;
  c.notes.push(CARP_NOTE + owner.id);
  battle.trace.push({ t: "SUBCAST", actor: owner.id, ref: "268_03", skill: "鲤鱼旗", target: c.id, clause: "召唤鲤鱼旗（继承60%生命值、140%速度）" });
  refreshSpd(battle, owner.teamId);
  return c;
}

/** L4 SPD aura on the non-summon allies of a team with a living Carp (re-evaluated at every turn start / end). */
function refreshSpd(battle: any, teamId: number): void {
  const team = battle.teams[teamId];
  const carp = (team?.summons ?? []).find((s: Entity) => s.alive && carpOwnerId(s) !== null);
  for (const m of team.members as Entity[]) {
    const want = carp && m.alive ? EBISU.spd + (m.hp / m.maxHp < EBISU.lowHp ? EBISU.lowSpd : 0) : 0;
    const st = m.statuses.find(s => s.def.id === CARP_SPD_ID);
    const have = st ? Number(st.effects[0]?.value ?? 0) : 0;
    if (have === want) continue;
    if (st) m.expireStatus(st);
    if (want > 0) m.addStatus(spdDef(), carp!.id, 1, PERSIST, [{ prop: "spd", value: want, mode: "FIXED" }], 1);
  }
}

async function carpTurn(battle: any, c: Entity): Promise<void> {
  const ownerId = carpOwnerId(c);
  const owner = battle.allEntities().find((e: Entity) => e.id === ownerId) ?? c;
  // L2: dispel 2 debuffs / controls among the allies (controls first, lineup order).
  let left = EBISU.dispels;
  const allies = (battle.teams[c.teamId].aliveMembers() as Entity[]).filter(m => !isSummonUnit(m));
  for (const pass of [true, false]) {
    for (const m of allies) {
      while (left > 0) {
        const st = m.statuses.find(s => s.def.dispellable && isDebuffOrControl(s.def) && isControlDef(s.def) === pass);
        if (!st || !m.dispel(st.def.id)) break;
        left--;
        const what = pass ? "CONTROL" : "DEBUFF";
        battle.trace.push({ t: "STATUS_REMOVE", id: m.id, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what, src: c.id, skill: "鲤鱼旗" });
        battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: m, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what, src: c.id, skill: "鲤鱼旗" }, m.id, m.teamId);
      }
    }
  }
  // L5: +1 onibi.
  gainOrbs(battle, owner, c.teamId, EBISU.carpOrbs, "鲤鱼旗");
}

function gate(battle: any, self: Entity, sk: any): string | null {
  if (!bettingActive() || sk?.ir?.id !== "268_03" || !isEbisu268(self)) return null;
  return carpOf(battle, self) || slotBusy(battle, self) ? "SUMMON_PRESENT" : null;
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isEbisu268(self)) return false;
  if (x?.id === "268_03") { if (!carpOf(battle, self)) summonCarp(battle, self); return true; }
  if (x?.id === "268_01") {
    const c = carpOf(battle, self);
    if (c) shiftBar(battle, c, EBISU.carpBar, x.name);
    return false;
  }
  return false;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isEbisu268);
  if (!units.length) return out;
  for (const e of units) {
    let lastScope: unknown = null;
    registerOwnerHandler(battle, "betting:268:fortune:" + e.id, e.id, EV.AFTER_DAMAGE, (ctx: any) => {
      const t = ctx?.input?.target, s = ctx?.input?.source;
      if (t?.id !== e.id || !s || s.teamId === e.teamId || ctx?.result?.type !== DamageType.NORMAL) return;
      const scope = (battle.resolutionStack ?? []).find((x: any) => x?.type === "SKILL");
      if (!scope || !currentHit(battle).skill || scope === lastScope) return;
      lastScope = scope;
      battle.rng.expect("ebisu:fortune:" + e.id);
      const hit = battle.rng.testHit(EBISU.onibiChance);
      battle.trace.push({ t: "PASSIVE_ROLL", src: e.id, skill: "转祸为福", dst: e.id, probability: EBISU.onibiChance, hit });
      if (hit) gainOrbs(battle, e, e.teamId, 1, "转祸为福");
    }, "ALL");
    out.push({ entityId: e.id, mechanic: "转祸为福 30% onibi when attacked · 鲤鱼旗 summon (60% HP, 140% SPD, 40% max-HP heal before each ally acts, L2 dispel 2, L4 SPD aura, L5 +1 onibi) · 赐福 L5 +30% Carp bar" });
  }
  // Carp: heal before each non-summon ally acts; its own turn: dispel + onibi. SPD aura refresh.
  ensureGlobalHandler(battle, "betting:268:turn-start", EV.TURN_START, async (ctx: any) => {
    const a: Entity | undefined = ctx?.actor;
    if (!a?.alive) return;
    if (isSummonUnit(a) && carpOwnerId(a) !== null) { await carpTurn(battle, a); refreshSpd(battle, a.teamId); return; }
    if (isSummonUnit(a)) return;
    const carp = (battle.teams[a.teamId]?.summons ?? []).find((s: Entity) => s.alive && carpOwnerId(s) !== null);
    if (carp) {
      battle.trace.push({ t: "PASSIVE_PROC", actor: carp.id, skill: "鲤鱼旗", effect: "友方行动前治疗（鲤鱼旗生命上限40%）", target: a.id });
      await battle.heal(carp, a, carp.maxHp * EBISU.carpHeal, { crit: false });
    }
    refreshSpd(battle, a.teamId);
  });
  // The kernel never lets enemies target a summon (Team.targetableMembers lists members only), which would make the
  // Carp immortal. Conservative stand-in: every enemy all-target (AoE) hit on a non-summon ally also strikes the
  // Carp once per hit scope, with the same base (no souls; DEF 0 ⇒ full damage).
  const spilled = new WeakSet<object>();
  ensureGlobalHandler(battle, "betting:268:aoe-spill", EV.AFTER_DAMAGE, async (ctx: any) => {
    const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
    if (!src || !dst || isSummonUnit(dst) || src.teamId === dst.teamId || ctx?.result?.type !== DamageType.NORMAL) return;
    if (String(ctx.input.skillTag ?? "").startsWith("soul:") || !isAoeHit(battle, src)) return;
    const carp = (battle.teams[dst.teamId]?.summons ?? []).find((s: Entity) => s.alive && carpOwnerId(s) !== null);
    if (!carp) return;
    const stack: any[] = battle.resolutionStack ?? [];
    const scope = [...stack].reverse().find((x: any) => x?.type === "HIT") ?? stack.find((x: any) => x?.type === "SKILL");
    if (!scope || spilled.has(scope)) return;
    spilled.add(scope);
    await dealDamage(battle, { source: src, target: carp, base: Number(ctx.input.base ?? 0), rate: Number(ctx.input.rate ?? 1), type: DamageType.NORMAL, skillTag: "betting-268:aoe-spill", noSoul: true });
  });
  ensureGlobalHandler(battle, "betting:268:turn-end", EV.TURN_END, (ctx: any) => {
    for (const t of battle.teams) refreshSpd(battle, t.id ?? battle.teams.indexOf(t));
  });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "268_03": { note: "鲤鱼旗: the summon, its heals / dispel / onibi / SPD aura are run by betting-ebisu.ts (the compiled 40% self-heal is removed)", patch: { heal: [] } },
  }),
  gate,
  afterCast,
  install,
};
