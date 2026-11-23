// compile/betting-mushishi.ts — 虫师 (306) passive 虫之痕 at max level. MAX mode only.
//
// Sources: data/kb/shikigami.json 306_02, buff 3062_1 虫之痕 ("【减益、印记】-30%易伤"), tips_17 无法动作;
// fandom Mushishi/Main: "When Mushishi receives damage, and if she's not immobile, she has a 25% of gaining
// immunity to that damage and has a 100% base chance of inflicting the attacker with Mark of Mushi, lasts for
// 2 turns. Only triggers once for a single attack. Evolution effect: when an enemy with Mark of Mushi receives
// damage, restores the HP of the ally with the lowest HP proportion by 15% of the damage they received.
// Mark of Mushi: Debuff, Mark: becomes vulnerable, damage received is increased by 30%."
// The passive has no level-up lines (306_02 upgrades: none). Before this module nothing of it ran: the
// compiled IR only had an unexecuted 25% immunity and no damage-taken effect on 3062_1.
//
//   trigger      · damage from an enemy (any type, the source must be a unit), Mushishi not 无法动作; once per
//                  enemy action ("单次攻击内最多触发1次": key = turn + attacker, the first hit of the action).
//   immunity     · 25%: that hit is cancelled (no damage, no on-hit effects — kernel BEFORE_DAMAGE cancel).
//   虫之痕        · 100% base chance (effect hit / resist contest of kernel/resist.ts) on the attacker, 2 turns
//                  (engine duration convention: SOURCE_TURN = counted on Mushishi's turns), +30% damage taken.
//   heal         · an enemy carrying 虫之痕 takes damage (any source) ⇒ the living ally (non-summon) with the
//                  lowest HP ratio heals 15% of the HP that damage removed; Mushishi must be alive.
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, isActionPrevented, findImmuneStatus } from "../kernel/status.ts";
import { rollStatusContest, reportResist } from "../kernel/resist.ts";
import { bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler } from "./betting-shared.ts";

export const MUSHI_MARK = Object.freeze({
  immuneChance: 0.25,   // 306_02: 25%概率免疫伤害
  baseChance: 1,        // 306_02: 100%基础概率
  turns: 2,             // 306_02: 持续2回合
  vulnerable: 0.3,      // buff_3062_1: 易伤 30%
  healRatio: 0.15,      // 306_02: 治疗等同该次伤害15%的生命
});

const MARK_ID = "3062_1";
const markDefOf = () => markDef({ id: MARK_ID, name: "虫之痕", category: StatusCategory.DEBUFF_MARK, dispellable: true, removable: true,
  durationPolicy: "SOURCE_TURN", desc: "【减益、印记】-30%易伤。（betting: 受到伤害提升30%）" }, StatusBook);

export const isMushishi = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "306_02") && !!skillById(e, "306_03");

/** Enemy actions that already triggered the passive (per Mushishi): "turn:attacker". Transient. */
const seen = new WeakMap<object, Map<number, string>>();

async function onBeforeDamage(battle: any, mu: Entity, ctx: any): Promise<void> {
  const src: Entity | undefined = ctx?.input?.source;
  if (ctx?.input?.target?.id !== mu.id || !src || src.teamId === mu.teamId || !mu.alive || ctx.cancelled) return;
  if (isActionPrevented(mu.statusDefs())) return;
  const key = battle.turn + ":" + src.id;
  const map = seen.get(battle) ?? new Map<number, string>();
  seen.set(battle, map);
  if (map.get(mu.id) === key) return;
  map.set(mu.id, key);
  battle.rng.expect("mushishi_immune:" + mu.id);
  if (battle.rng.testHit(MUSHI_MARK.immuneChance)) {
    ctx.cancelled = true;
    battle.trace.push({ t: "IMMUNE", src: src.id, dst: mu.id, by: "306_02", kind: "DAMAGE", damage: Number(ctx.result?.final ?? 0), consumed: false, skill: "虫之痕" });
  }
  await applyMark(battle, mu, src);
}

async function applyMark(battle: any, mu: Entity, v: Entity): Promise<void> {
  if (!v.alive) return;
  const def = markDefOf();
  const tag = "status_prob:" + MARK_ID + ":虫之痕:" + v.id;
  const contest = rollStatusContest(battle, mu, v, def, MUSHI_MARK.baseChance, tag, "resist:" + tag);
  if (contest.outcome === "MISS") {
    battle.trace.push({ t: "STATUS_MISS", src: mu.id, dst: v.id, status: MARK_ID, name: def.name, probability: 100, skill: "虫之痕" });
    return;
  }
  if (contest.outcome === "RESIST") {
    await reportResist(battle, mu, v, def, contest, { probability: 100, duration: MUSHI_MARK.turns, ref: MARK_ID, skill: "虫之痕" });
    return;
  }
  const imm = findImmuneStatus(v, def, battle.policies?.immune?.debuffCoversControl ?? true);
  if (imm) {
    battle.trace.push({ t: "IMMUNE", src: mu.id, dst: v.id, status: MARK_ID, name: def.name, by: imm.def.id, kind: imm.kind, consumed: imm.consumed, ref: MARK_ID, skill: "虫之痕" });
    return;
  }
  const ex = v.statuses.find(s => s.def.id === MARK_ID && s.sourceId === mu.id);
  if (ex) { ex.remaining = Math.max(ex.remaining, MUSHI_MARK.turns); return; }
  const a = v.addStatus(def, mu.id, 1, MUSHI_MARK.turns, [{ prop: "dmgTakenD", value: MUSHI_MARK.vulnerable, mode: "FIXED" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: mu.id, dst: v.id, status: MARK_ID, name: def.name, category: def.category, duration: MUSHI_MARK.turns, ref: MARK_ID, known: true, tag: a.tag, skill: "虫之痕" });
}

async function onAfterDamage(battle: any, mu: Entity, ctx: any): Promise<void> {
  const dst: Entity | undefined = ctx?.input?.target;
  if (!dst || !mu.alive || dst.teamId === mu.teamId) return;
  if (!dst.statuses.some(s => s.def.id === MARK_ID && s.sourceId === mu.id)) return;
  const dealt = Number(ctx.result?.applied ?? 0);
  if (!(dealt > 0)) return;
  const allies = (battle.teams[mu.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m));
  if (!allies.length) return;
  const ratio = (e: Entity) => (e.maxHp > 0 ? e.hp / e.maxHp : 1);
  const low = allies.reduce((a, b) => (ratio(b) < ratio(a) ? b : a), allies[0]);
  await battle.heal(mu, low, dealt * MUSHI_MARK.healRatio, { crit: false });
}

export function installMushishi(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const mu of entities.filter(isMushishi)) {
    out.push({ entityId: mu.id, mechanic: "虫之痕 (25% 免疫伤害 · 易伤 · 15% 治疗)" });
    const reg = (code: string, fn: (ctx: any) => Promise<void>) =>
      registerOwnerHandler(battle, "betting:306:" + code + ":" + mu.id, mu.id, code, fn, "ALL");
    reg(EV.BEFORE_DAMAGE, ctx => onBeforeDamage(battle, mu, ctx));
    reg(EV.AFTER_DAMAGE, ctx => onAfterDamage(battle, mu, ctx));
  }
  return out;
}
