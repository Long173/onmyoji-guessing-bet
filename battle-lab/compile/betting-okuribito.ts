// compile/betting-okuribito.ts — 入殓师 (SSR 321, Global "Okuribito") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 321_02 / 321_03, buff 3214_1 魂隙, tips_5 间接伤害 / tips_17 无法动作;
// fandom "Noukanshi/Main".
//   荼蘼盛放之棺 (321_03, 3 onibi, cooldown 2 - 1 = 1) · summons 织雪 for 1 turn (his next turn included): SPD -50%,
//       base DEF +250%, effect RES +70%. After every enemy turn, if he is not unable to act: 30% ATK (L4) to that
//       enemy and to the other enemy with the lowest HP ratio, +20% ATK (L3) per onibi that enemy spent in its turn;
//       +2.5% damage per 1% of his HP ratio lost. The compiled skill dealt 30% on cast and nothing else.
//   离魂 (321_02, 2 onibi) · 244% to the target and 1 魂隙 stack (max 5). At the end of each of the bearer's turns:
//       indirect damage of 15 / 30 / 60 / 120 / 240% of the bearer's max HP by stacks, capped at 500% of his ATK
//       (reading: the target's max HP; stacks persist until the bearer normal-attacks him, which removes them all).
//       The compiled skill put 4 inert 魂隙 statuses on the target.
//   AI (KB) · coffin first, 离魂 when the coffin is unavailable (cooldown / onibi), otherwise 葬仪.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler, stacksOn, setStackedStatus } from "./betting-shared.ts";

export const OKURI = Object.freeze({
  spdCut: -0.5, defUp: 2.5, resUp: 0.7, coffinTurns: 2, ratio: 30, perOnibi: 20, perLostPct: 2.5, cooldown: 1,
  riftPct: [15, 30, 60, 120, 240], riftCap: 5, riftAtkCap: 5,
});
export const COFFIN_ID = "321_coffin";
export const RIFT_ID = "3214_1";
const N_TURN = "okuri321:turn=", N_CAST = "okuri321:cast=";

const coffinDef = () => markDef({ id: COFFIN_ID, name: "织雪", category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: false, removable: false,
  desc: "荼蘼盛放之棺：织雪在场，速度降低50%，基础防御提升250%，效果抵抗提升70%；任一敌方回合结束后反击。" }, StatusBook);
const riftDef = () => markDef({ id: RIFT_ID, name: "魂隙", category: StatusCategory.DEBUFF_STATE, durationPolicy: "GLOBAL", dispellable: true, removable: true,
  desc: "【减益、状态】回合后受到伤害（层数1~5：生命上限15/30/60/120/240%间接伤害，不超过入殓师攻击500%）。" }, StatusBook);

export const isOkuri321 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "321_02") && !!skillById(e, "321_03");
const ownTurns = (e: Entity): number => Number(noteValue(e, N_TURN) ?? 0);
const hpRatio = (e: Entity): number => (e.maxHp > 0 ? e.hp / e.maxHp : 0);

/** Onibi spent by each unit during its running turn (transient; reset at its turn start). */
const spent = new WeakMap<object, Map<number, number>>();

export function okuriGate(self: Entity, sk: any): string | null {
  if (sk?.ir?.id !== "321_03") return null;
  const last = noteValue(self, N_CAST);
  return last !== null && ownTurns(self) - Number(last) <= OKURI.cooldown ? "COOLDOWN" : null;
}

export function okuriRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isOkuri321(self)) return null;
  const canPay = (sk: any) => { const c = costOf(sk); return !(c > 0) || battle.teams[self.teamId].orbs.canPay(c); };
  const coffin = skillById(self, "321_03"), rift = skillById(self, "321_02");
  if (coffin && !okuriGate(self, coffin) && canPay(coffin)) return { skill: coffin, rule: "入殓师: 优先 → 荼蘼盛放之棺 (KB AI)" };
  if (rift && canPay(rift)) return { skill: rift, rule: "入殓师: 棺不可用 → 离魂 (KB AI)" };
  const basic = skillById(self, "321_01");
  return basic ? { skill: basic, rule: "入殓师: 鬼火不足 → 葬仪" } : null;
}

type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };

/** The coffin deals no damage on cast (the counters do). */
export function okuriDamageHook(x: any): Hook | null {
  return x?.id === "321_03" ? { kind: "OKURI_COFFIN", run: async () => {} } : null;
}

async function addRift(battle: any, o: Entity, v: Entity): Promise<void> {
  if (!v.alive) return;
  const before = stacksOn(v, RIFT_ID);
  const after = setStackedStatus(v, riftDef(), before + 1, OKURI.riftCap, o.id, []);
  battle.trace.push({ t: "STATUS_APPLY", src: o.id, dst: v.id, status: RIFT_ID, name: "魂隙", category: StatusCategory.DEBUFF_STATE, duration: 99999, ref: RIFT_ID, known: true, stacks: after, skill: "离魂" });
}

export async function okuriAfterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isOkuri321(self) || (x?.id !== "321_02" && x?.id !== "321_03")) return false;
  if (x.id === "321_03") {
    setNote(self, N_CAST, ownTurns(self));
    for (const st of [...self.statuses]) if (st.def.id === COFFIN_ID) self.expireStatus(st);
    const def = coffinDef();
    const a = self.addStatus(def, self.id, 1, OKURI.coffinTurns, [
      { prop: "spd", value: OKURI.spdCut, mode: "ADD_RATE" }, { prop: "def", value: OKURI.defUp * Number(self.base.def ?? 0), mode: "FIXED" },
      { prop: "efr", value: OKURI.resUp, mode: "FIXED" }], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: self.id, status: COFFIN_ID, name: def.name, category: def.category, duration: OKURI.coffinTurns, ref: "321_03", known: true, tag: a.tag, skill: x.name });
    return true;
  }
  const t = lastRiftTarget.get(self);
  lastRiftTarget.delete(self);
  if (t) await addRift(battle, self, t);
  return true;
}
const lastRiftTarget = new WeakMap<object, Entity>();

/** 离魂's target (recorded by the generic damage path through BEFORE_DAMAGE of the cast). */
function noteRiftTarget(battle: any, ctx: any): void {
  const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
  if (!src || !dst || !isOkuri321(src) || dst.teamId === src.teamId) return;
  const stack: any[] = battle?.resolutionStack ?? [];
  if (stack.some(s => s?.type === "SKILL" && String(s.id) === "SKILL:离魂")) lastRiftTarget.set(src, dst);
}

async function counter(battle: any, o: Entity, enemy: Entity): Promise<void> {
  if (!o.alive || !o.hasStatus(COFFIN_ID) || isActionPrevented(o.statusDefs())) return;
  const onibi = spent.get(battle)?.get(enemy.id) ?? 0;
  const lostPct = Math.max(0, 1 - hpRatio(o)) * 100;
  const ratio = (OKURI.ratio + OKURI.perOnibi * onibi) / 100;
  const mul = 1 + OKURI.perLostPct * lostPct / 100;
  const foes = battle.enemiesOf(o.teamId).filter((v: Entity) => v.alive);
  const other = foes.filter((v: Entity) => v.id !== enemy.id).reduce((a: Entity | null, b: Entity) => (!a || hpRatio(b) < hpRatio(a) ? b : a), null);
  const targets = [enemy, other].filter((v): v is Entity => !!v && v.alive);
  if (!targets.length) return;
  battle.trace.push({ t: "COFFIN_STRIKE", actor: o.id, after: enemy.id, targets: targets.map(v => v.id), onibi, ratio, mul, skill: "荼蘼盛放之棺" });
  await battle.withinResolution({ id: "SKILL:荼蘼盛放之棺·反击", type: "SKILL" }, async () => {
    await battle.withinResolution({ id: "HIT:荼蘼盛放之棺#c", type: "HIT" }, async () => {
      for (const v of targets) if (v.alive) await battle.damage(o, v, o.prop("atk") * ratio, DamageType.NORMAL, mul, null);
    });
  });
}

export const OKURI_PATCHES = Object.freeze({
  "321_02": { note: "离魂: 1 魂隙 stack per cast and its indirect damage are run by betting-okuribito.ts", patch: { statusRefConditionOnly: [0, 1, 2, 3] } },
});

export function installOkuri(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isOkuri321);
  for (const o of units) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = false) =>
      registerOwnerHandler(battle, "betting:321:" + code + ":" + o.id, o.id, code, fn, range, { passive });
    reg(EV.TURN_END, async (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a) return;
      if (a.id === o.id) { setNote(o, N_TURN, ownTurns(o) + 1); return; }
      if (a.teamId !== o.teamId && !isSummonUnit(a)) await counter(battle, o, a);
    });
    reg(EV.BEFORE_DAMAGE, (ctx: any) => noteRiftTarget(battle, ctx), "SELF");
    out.push({ entityId: o.id, mechanic: "荼蘼盛放之棺 (织雪 stats, counters after enemy turns, cooldown) · 离魂 魂隙 stacks / indirect damage" });
  }
  if (!units.length) return out;
  ensureGlobalHandler(battle, "betting:321:spent-reset", EV.TURN_START, (ctx: any) => { if (ctx?.actor) (spent.get(battle) ?? spent.set(battle, new Map()).get(battle)!).set(ctx.actor.id, 0); });
  ensureGlobalHandler(battle, "betting:321:spent", EV.ORB_COST, (ctx: any) => {
    const id = Number(ctx?.actor ?? NaN);
    if (!Number.isFinite(id)) return;
    const m = spent.get(battle) ?? spent.set(battle, new Map()).get(battle)!;
    m.set(id, (m.get(id) ?? 0) + Number(ctx?.amount ?? 0));
  });
  // 魂隙: damage after each of the bearer's turns; a normal attack on Okuribito removes all stacks.
  ensureGlobalHandler(battle, "betting:321:rift", EV.TURN_END, async (ctx: any) => {
    const v: Entity | undefined = ctx?.actor;
    const st = v?.statuses.find(s => s.def.id === RIFT_ID);
    if (!v || !st || !v.alive) return;
    const o = battle.allEntities().find((e: Entity) => e.id === st.sourceId);
    if (!o) return;
    const pct = OKURI.riftPct[Math.min(OKURI.riftCap, st.stacks) - 1] / 100;
    const amount = Math.min(v.maxHp * pct, o.prop("atk") * OKURI.riftAtkCap);
    battle.trace.push({ t: "RIFT_TICK", src: o.id, dst: v.id, stacks: st.stacks, amount: GameMath.display(amount), skill: "魂隙" });
    await battle.damage(o, v, amount, DamageType.INDIRECT, 1, null);
  });
  ensureGlobalHandler(battle, "betting:321:rift-clear", EV.SKILL_END, (ctx: any) => {
    const a: Entity | undefined = ctx?.actor, t: Entity | undefined = ctx?.target, sk = ctx?.skill;
    if (!a || !t || !isOkuri321(t) || Number(sk?.cost) !== 0 || !String(sk?.ir?.id ?? "").endsWith("_01")) return;
    for (const st of [...a.statuses]) if (st.def.id === RIFT_ID && st.sourceId === t.id && a.expireStatus(st)) battle.trace.push({ t: "STATUS_REMOVE", id: a.id, status: RIFT_ID, name: "魂隙", by: "DISPEL", side: "SELF", what: "DEBUFF", src: a.id, skill: "普攻入殓师" });
  });
  return out;
}
