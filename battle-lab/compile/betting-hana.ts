// compile/betting-hana.ts — 绘世花鸟卷 367 (Virtuoso Hana / SP Kachou Fuugetsu) at max level. MAX (betting) mode only.
//
// Sources: data/kb/shikigami.json 367_0x, buffs 3672_1 / 3674_1, tips 3673; English wiki "Kaisei Kachou Fuugetsu"
// (the 繁花坠露 / Blossom Rain form is only on the wiki: the KB has no text for it).
//   墨气常萦 367_02 · 墨萦 on all allies: +30% healing received (L2), +20% effect RES (L3); at battle start
//                    non-summon allies get +10% max HP permanently (L4). L5: when the painting disappears
//                    outside her turn, she gains 30% action bar.
//   绘梦浮生 367_03 · Summons 浮生画影 (the painting) for 4 turns, sustained (counted on her turns, the casting
//                    turn included, like every SOURCE_TURN status of the engine) and marks the selected non-summon
//                    enemy with 逐墨. The compiled IR put 逐墨 on Hana herself and recast the skill every turn
//                    (2 onibi each time). While the painting exists:
//                      · allies' AoE (群体) damage +20% (L5);
//                      · every non-transfer damage on another enemy deals 20% of it as transfer damage to the
//                        marked enemy (KB L4 "提升至20%"; the English wiki says 25% — the KB value is used);
//                      · the skill becomes 繁花坠露 (0 onibi): heal an ally other than herself by 12% of Hana's max
//                        HP (L4), bouncing to the lowest-HP allies, 4 heals in total (L5). A critical heal makes
//                        the painting deal 20% of the healed amount as transfer damage to the marked enemy.
//                    The painting disappears after its 4 turns, when the marked enemy dies, or when Hana dies.
//   AI (data/kb/ai.json): 绘梦浮生 when no enemy has 逐墨, 繁花坠露 otherwise; 3技能 targets the enemy with the
//   highest HP (KB target rule, compiled). 繁花坠露 targets the lowest HP ratio first (KB "4技能" rule).
// Not modelled: the painting occupying the enemy summon slot; the 1200%-of-max-HP cap on one painting hit.
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { bettingActive, isSummonUnit, skillById, entityById, ensureGlobalHandler, markDef, noteValue, setNote, shiftBar, PERSIST } from "./betting-shared.ts";
import { inOwnTurn, isAoeHit, isSupportDamage, dealUndefended } from "./betting-scope.ts";

export const HANA = Object.freeze({
  paintingTurns: 4, transfer: 0.2, aoeBoost: 0.2, healPct: 0.12, heals: 4, critTransfer: 0.2,
  inkHeal: 0.3, inkEfr: 0.2, inkMaxHp: 0.1, barOnVanish: 0.3,
});

export const HANA_PATCHES: Readonly<Record<string, { note: string; patch: Record<string, unknown> }>> = Object.freeze({
  "367_03": {
    note: "绘梦浮生: 逐墨 goes on the selected enemy and the painting / 繁花坠露 are run by betting-hana.ts (the compiled slot put 逐墨 on Hana)",
    patch: { statusRefConditionOnly: [0] },
  },
});

const PAINT_NOTE = "hana:painting=";   // "<turnsLeft>:<markedId>:<openedTurn>"
const HP_NOTE = "hana:inkMaxHp";

const INK_DEF = () => markDef({
  id: "bet:3672_1", name: "墨萦", category: StatusCategory.BUFF_MARK,
  desc: "betting-hana: 受到治疗时治疗量提升30%，效果抵抗+20%（墨气常萦 L2/L3）",
}, StatusBook);
const MARK_DEF = () => markDef({
  id: "bet:3674_1", name: "逐墨", category: StatusCategory.COMMON_MARK,
  desc: "betting-hana: 其他敌方受到非传导伤害时，浮生画影对其造成此伤害20%的传导伤害",
}, StatusBook);

const isHana = (e: Entity | null | undefined): boolean => !!e && !!skillById(e, "367_03");

export function paintingOf(hana: Entity): { left: number; marked: number; opened: number } | null {
  const v = noteValue(hana, PAINT_NOTE);
  if (v === null) return null;
  const [left, marked, opened] = v.split(":").map(Number);
  return { left, marked, opened };
}
const setPainting = (hana: Entity, p: { left: number; marked: number; opened: number } | null): void =>
  setNote(hana, PAINT_NOTE, p ? `${p.left}:${p.marked}:${p.opened}` : null);

function hanasOf(battle: any, teamId?: number): Entity[] {
  return (battle.allEntities() as Entity[]).filter(e => isHana(e) && !isSummonUnit(e) && (teamId === undefined || e.teamId === teamId));
}

/** 繁花坠露 costs 0 while the painting exists. */
export function hanaCost(battle: any, self: Entity, sk: any, base: number): number {
  // `sk` is a skill entry (AI: sk.ir.id) or the IR itself (character.ts execution: sk.id).
  if (!bettingActive() || (sk?.ir?.id ?? sk?.id) !== "367_03") return base;
  return paintingOf(self) ? 0 : base;
}

/** AI (MAX): 绘梦浮生 without painting (if affordable), 繁花坠露 with it, else normal attack. */
export function hanaRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || isSummonUnit(self)) return null;
  const s3 = skillById(self, "367_03");
  if (!s3) return null;
  if (paintingOf(self)) return { skill: s3, rule: "花鸟卷: 敌方存在逐墨 → 繁花坠露" };
  const c = costOf(s3);
  if (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c)) return { skill: s3, rule: "花鸟卷: 敌方不存在逐墨 → 绘梦浮生" };
  const basic = skillById(self, "367_01");
  return basic ? { skill: basic, rule: "花鸟卷: 鬼火不足 → 普攻" } : null;
}

function endPainting(battle: any, hana: Entity, reason: string): void {
  const p = paintingOf(hana);
  if (!p) return;
  setPainting(hana, null);
  const marked = entityById(battle, p.marked);
  const st = marked?.statuses.find(s => s.def.id === "bet:3674_1" && s.sourceId === hana.id);
  if (marked && st) marked.expireStatus(st);
  battle.trace.push({ t: "SUMMON_END", owner: hana.id, name: "浮生画影", reason });
  if (hana.alive && !inOwnTurn(battle, hana) && reason !== "OWNER_DEAD") shiftBar(battle, hana, HANA.barOnVanish, "墨气常萦");
}

async function bloomingRain(battle: any, hana: Entity, x: any): Promise<void> {
  const p = paintingOf(hana);
  const healed = new Set<number>();
  const allies = () => (battle.teams[hana.teamId].aliveMembers() as Entity[]).filter(m => !isSummonUnit(m));
  const ratio = (m: Entity) => (m.maxHp > 0 ? m.hp / m.maxHp : 1);
  battle.trace.push({ t: "SUBSKILL", actor: hana.id, skill: "繁花坠露", form: "绘梦浮生", heals: HANA.heals });
  for (let i = 0; i < HANA.heals; i++) {
    let pool = allies().filter(m => !healed.has(m.id) && (i > 0 || m.id !== hana.id));
    if (!pool.length) pool = allies().filter(m => i > 0 || m.id !== hana.id);
    if (!pool.length) break;
    const target = pool.reduce((a, b) => (ratio(b) < ratio(a) ? b : a), pool[0]);
    healed.add(target.id);
    battle.rng.expect("hana:heal-crit:" + i);
    const crit = battle.rng.testHit(hana.prop("cri"));
    const amount = hana.maxHp * HANA.healPct * (crit ? hana.prop("crid") : 1);
    const got = await battle.heal(hana, target, amount, { crit: false });
    if (!crit || !p) continue;
    const marked = entityById(battle, p.marked);
    if (marked?.alive && got > 0) await dealUndefended(battle, hana, marked, got * HANA.critTransfer, "繁花坠露");
  }
}

/** After an active cast of 367_03 (MAX). */
export async function hanaAfterCast(battle: any, self: Entity, x: any): Promise<void> {
  if (x?.id !== "367_03") return;
  if (paintingOf(self)) { await bloomingRain(battle, self, x); return; }
  const foes = (battle.enemiesOf(self.teamId) as Entity[]).filter(e => e.alive && !isSummonUnit(e));
  if (!foes.length) return;
  // KB target rule of 3技能: the enemy with the highest HP (same choice as the compiled pickTarget).
  const marked = foes.reduce((a, b) => (b.hp > a.hp ? b : a), foes[0]);
  marked.addStatus(MARK_DEF(), self.id, 1, PERSIST, [], null);
  setPainting(self, { left: HANA.paintingTurns, marked: marked.id, opened: Number(battle.turn ?? 0) });
  battle.trace.push({ t: "SUMMON", owner: self.id, name: "浮生画影", turns: HANA.paintingTurns, counted: "OWNER_TURNS", skill: x.name });
  battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: marked.id, status: "bet:3674_1", name: "逐墨", category: StatusCategory.COMMON_MARK, duration: PERSIST, known: true, skill: x.name });
}

function inkbound(battle: any, hana: Entity): void {
  for (const m of battle.teams[hana.teamId].members as Entity[]) {
    if (isSummonUnit(m) || m.statuses.some(s => s.def.id === "bet:3672_1")) continue;
    m.addStatus(INK_DEF(), hana.id, 1, PERSIST, [
      { prop: "healDown", value: -HANA.inkHeal, mode: "FIXED" },
      { prop: "efr", value: HANA.inkEfr, mode: "FIXED" },
    ], null);
    if (!(m.notes ?? []).includes(HP_NOTE)) {
      m.notes.push(HP_NOTE);
      const ratio = m.maxHp > 0 ? m.hp / m.maxHp : 1;
      m.maxHp = m.maxHp * (1 + HANA.inkMaxHp);
      m.hp = m.maxHp * ratio;
      battle.trace.push({ t: "MAX_HP_UP", id: m.id, ratio: HANA.inkMaxHp, maxHp: m.maxHp, skill: "墨气常萦" });
    }
  }
}

export function installHana(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const hanas = entities.filter(e => isHana(e) && !isSummonUnit(e));
  if (!hanas.length) return out;
  for (const h of hanas) {
    inkbound(battle, h);
    out.push({ entityId: h.id, mechanic: "墨萦 / 浮生画影" });
  }
  // Painting duration: her turn ends (the casting turn included).
  ensureGlobalHandler(battle, "betting:367:tick", EV.TURN_END, (ctx: any) => {
    const actor: Entity = ctx?.actor;
    if (!actor || !isHana(actor)) return;
    const p = paintingOf(actor);
    if (!p) return;
    if (p.left - 1 <= 0) endPainting(battle, actor, "EXPIRED");
    else setPainting(actor, { ...p, left: p.left - 1 });
  });
  // AoE +20% for the allies of a Hana whose painting exists.
  ensureGlobalHandler(battle, "betting:367:aoe", EV.BEFORE_DAMAGE, (ctx: any) => {
    const src: Entity = ctx?.input?.source;
    if (!src || ctx?.result?.ignoresModifiers || isSupportDamage(ctx)) return;
    if (!hanasOf(battle, src.teamId).some(h => h.alive && paintingOf(h))) return;
    if (!isAoeHit(battle, src)) return;
    ctx.result.final *= 1 + HANA.aoeBoost;
  });
  // Transfer to the marked enemy; painting ends when the marked enemy or Hana dies.
  ensureGlobalHandler(battle, "betting:367:transfer", EV.AFTER_DAMAGE, async (ctx: any) => {
    const t: Entity = ctx?.input?.target;
    if (!t) return;
    for (const h of hanasOf(battle)) {
      const p = paintingOf(h);
      if (!p) continue;
      const marked = entityById(battle, p.marked);
      if (!h.alive || h.hpZero) { endPainting(battle, h, "OWNER_DEAD"); continue; }
      if (!marked?.alive || marked.hpZero) { endPainting(battle, h, "MARK_KO"); continue; }
      if (t.teamId === h.teamId || t.id === marked.id || isSupportDamage(ctx)) continue;
      const dmg = Number(ctx?.result?.final ?? 0);
      if (dmg > 0) await dealUndefended(battle, h, marked, dmg * HANA.transfer, "逐墨");
      if (marked.hpZero) endPainting(battle, h, "MARK_KO");
    }
  });
  ensureGlobalHandler(battle, "betting:367:death", EV.DEATH, (ctx: any) => {
    for (const h of hanasOf(battle)) {
      const p = paintingOf(h);
      if (!p) continue;
      if (!h.alive) endPainting(battle, h, "OWNER_DEAD");
      else if (!entityById(battle, p.marked)?.alive) endPainting(battle, h, "MARK_KO");
    }
  });
  return out;
}
