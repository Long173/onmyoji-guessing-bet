// compile/betting-garuda.ts — 迦楼罗 (SR 378, Global "Garuda") at max skill level. MAX (betting) mode only.
//
// Sources: data/kb/shikigami.json 378_01..378_03, buff 3782_1 惜羽, tips_6 护盾 / tips_11 唯一效果; fandom "Garuda"
// (Global text; data/kb/en-names.json still says wiki "Karura", which does not exist). Global and CN agree.
//   惜羽 (buff_3782_1)  · 减益、印记. When the bearer's action bar is increased and Garuda is not 无法动作, he
//                        normal-attacks it (pseudo turn). Persistent until consumed (no duration in either text;
//                        the compiled status had the 1-turn default). Not dispellable (印记).
//                        Not modelled: the KB-only rule "removed after 10 triggered attacks that dealt no damage".
//   化生戟 (378_01)      · 125% ATK; consumes 惜羽 on the target when the hit deals damage or hits a shield. The
//                        compiled IR applied 惜羽 instead (slot patched to condition-only).
//   天衣妙翅 (378_02)    · +20% damage to enemies that have a shield (Global: "enemies with shields"; the KB reads
//                        "额外对护盾造成20%伤害"). tips_11: at the end of each enemy turn, 10% (L4) chance to put 惜羽
//                        on all enemies, guaranteed hit (必定命中: no effect-RES contest). Evolution: each 惜羽
//                        consumed heals the lowest-HP ally for 10% of Garuda's max HP. L5: after 5 consecutive
//                        enemy turn ends without a trigger, if he has no control effect, a free 龙息炽羽.
//                        Heal amount: 10% of his max HP as the text says. The match-5 replay shows a constant 4855 on
//                        every consumption = 10% × 20065 × 2.42: his real max HP is the Lineup HP × BETTING_HP_SCALE
//                        (compile/betting-policies.ts). The old 24.2% calibration double-counted that scale.
//                        Passives are not executed on the betting path, so all of this was missing.
//   龙息炽羽 (378_03)    · 134% ATK to all enemies; L5: 惜羽 is guaranteed on every enemy (the compiled slot rolled the
//                        resist contest; slot patched, applied after the cast).
//   AI                  · KB: 3技能 whenever affordable, otherwise the normal attack (unchanged).
// Assumptions: "enemy turn" counts non-summon enemies only; the evolved form is assumed (duel units are built).
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented, findImmuneStatus } from "../kernel/status.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, controlsOn,
} from "./betting-shared.ts";
import { currentSkillOf } from "./betting-scope.ts";
import { onBarIncrease } from "./betting-bar.ts";

export const GARUDA = Object.freeze({
  shieldBonus: 0.2,      // 378_02: 额外对护盾造成20%伤害
  featherChance: 0.1,    // 378_02 L4: 触发概率提升至10%
  freeAfter: 5,          // 378_02 L5: 连续5次不触发
  // 378_02 text: 恢复迦楼罗生命上限10%的生命. The match-5 replay (2026-11-23e) shows exactly 4855 on 15+ consumptions
  // (no crit / heal-reduction variance) = 10% × (20065 Lineup HP × 2.42 betting HP scale) = 4855.7 — text and replay agree.
  healRatio: 0.1,
});

export const FEATHER_ID = "3782_1";
const NOTE_MISS = "garuda378:miss=";

const featherDef = () => markDef({ id: FEATHER_ID, name: "惜羽", category: StatusCategory.DEBUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【减益、印记】敌方获得行动条增加效果时，若迦楼罗未处于无法动作状态，对其普攻1次。（betting: 持续到被化生戟消耗）" }, StatusBook);

export const isGaruda = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "378_01") && !!skillById(e, "378_03");
export const hasFeather = (v: Entity, g: Entity): boolean => v.statuses.some(s => s.def.id === FEATHER_ID && s.sourceId === g.id);
export const featherMisses = (g: Entity): number => Number(noteValue(g, NOTE_MISS) ?? 0);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const basicOf = (e: Entity): any => e.skills.find((s: any) => Number(s.cost) === 0) ?? null;

/** tips_11 唯一效果: the first Garuda of the team runs 天衣妙翅. */
function exclusiveOf(battle: any, teamId: number): Entity | null {
  return (battle.teams[teamId]?.members ?? []).find((m: Entity) => isGaruda(m) && !!skillById(m, "378_02")) ?? null;
}

/** 惜羽 on `v` (guaranteed: no effect-RES contest; status immunity still applies). */
export function applyFeather(battle: any, g: Entity, v: Entity, skill: string): boolean {
  if (!v?.alive || v.teamId === g.teamId || hasFeather(v, g)) return false;
  const def = featherDef();
  const imm = findImmuneStatus(v, def, battle.policies?.immune?.debuffCoversControl ?? true);
  if (imm) {
    battle.trace.push({ t: "IMMUNE", src: g.id, dst: v.id, status: def.id, name: def.name, by: imm.def.id, kind: imm.kind, consumed: imm.consumed, ref: FEATHER_ID, skill });
    return false;
  }
  const a = v.addStatus(def, g.id, 1, PERSIST, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: g.id, dst: v.id, status: def.id, name: def.name, category: def.category, duration: PERSIST, ref: FEATHER_ID, known: true, tag: a.tag, skill });
  return true;
}

async function consumeFeather(battle: any, g: Entity, v: Entity): Promise<void> {
  const st = v.statuses.find(s => s.def.id === FEATHER_ID && s.sourceId === g.id);
  if (!st || !v.expireStatus(st)) return;
  battle.trace.push({ t: "STATUS_REMOVE", id: v.id, status: FEATHER_ID, name: st.def.name, by: "CONSUMED", side: "ENEMY", what: "MARK", src: g.id, skill: "化生戟" });
  battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: v, status: FEATHER_ID, name: st.def.name, by: "CONSUMED", side: "ENEMY", what: "MARK", src: g.id, skill: "化生戟" }, v.id, v.teamId);
  if (!skillById(g, "378_02") || !g.alive) return;
  const allies: Entity[] = battle.teams[g.teamId].aliveMembers();
  const low = allies.reduce<Entity | null>((a, b) => (!a || b.hp < a.hp ? b : a), null);
  // 恢复 (official [20] recover): no crit, not affected by heal reduction or heal amplifiers.
  if (low) await battle.heal(g, low, g.maxHp * GARUDA.healRatio, { recover: true });
}

/** After 龙息炽羽 (MAX): L5 guaranteed 惜羽 on every living enemy. */
export function garudaAfterCast(battle: any, self: Entity, x: any): boolean {
  if (x?.id !== "378_03") return false;
  for (const v of aliveEnemies(battle, self)) applyFeather(battle, self, v, x.name);
  return true;
}

async function onEnemyTurnEnd(battle: any, g: Entity, actor: Entity): Promise<void> {
  if (!g.alive || actor.teamId === g.teamId || isSummonUnit(actor)) return;
  battle.rng.expect("garuda378_feather");
  if (battle.rng.testHit(GARUDA.featherChance)) {
    setNote(g, NOTE_MISS, 0);
    battle.trace.push({ t: "PASSIVE_PROC", actor: g.id, skill: "天衣妙翅", effect: "惜羽 on all enemies", chance: GARUDA.featherChance });
    for (const v of aliveEnemies(battle, g)) applyFeather(battle, g, v, "天衣妙翅");
    return;
  }
  const miss = featherMisses(g) + 1;
  setNote(g, NOTE_MISS, miss);
  if (miss < GARUDA.freeAfter || controlsOn(g).length || isActionPrevented(g.statusDefs())) return;
  const ult = skillById(g, "378_03");
  const target = aliveEnemies(battle, g)[0];
  if (!ult || !target) return;
  setNote(g, NOTE_MISS, 0);
  battle.trace.push({ t: "SUBCAST", actor: g.id, ref: "378_03", skill: ult.name, target: target.id,
    clause: "若未受到控制效果且连续5次不触发，则无消耗施放「龙息炽羽」", misses: miss });
  await battle.runPseudoTurn(g, TurnType.PSEUDO_TURN, { skill: ult, target, free: true });
}

async function onBarUp(battle: any, g: Entity, v: Entity): Promise<void> {
  if (!g.alive || !hasFeather(v, g) || isActionPrevented(g.statusDefs())) return;
  const basic = basicOf(g);
  if (!basic) return;
  battle.trace.push({ t: "SUBCAST", actor: g.id, ref: "378_01", skill: basic.name, target: v.id, clause: "惜羽：敌方获得行动条增加效果时，迦楼罗对其普攻1次" });
  await battle.runPseudoTurn(g, TurnType.PSEUDO_TURN, { skill: basic, target: v });
}

/** IR patches (MAX): 惜羽 slots are handled here (consumed by 化生戟, guaranteed after 龙息炽羽). */
export const GARUDA_PATCHES = Object.freeze({
  "378_01": { note: "化生戟: 惜羽 is consumed (betting-garuda.ts), not applied", patch: { statusRefConditionOnly: [0] } },
  "378_03": { note: "龙息炽羽: L5 guaranteed 惜羽 is applied after the cast by betting-garuda.ts", patch: { statusRefConditionOnly: [0] } },
});

export function installGaruda(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const g of entities.filter(isGaruda)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void) =>
      registerOwnerHandler(battle, "betting:378:" + code + ":" + g.id, g.id, code, fn, "ALL");
    // 化生戟: consume 惜羽 when the hit dealt damage or hit a shield.
    reg(EV.AFTER_DAMAGE, async (ctx: any) => {
      const v: Entity | undefined = ctx?.input?.target;
      if (ctx?.input?.source?.id !== g.id || !v || !hasFeather(v, g)) return;
      if (currentSkillOf(battle, g)?.ir?.id !== "378_01") return;
      if (!(Number(ctx.result?.applied ?? 0) > 0 || Number(ctx.result?.absorbed ?? 0) > 0 || Number(ctx.result?.final ?? 0) > 0)) return;
      await consumeFeather(battle, g, v);
    });
    out.push({ entityId: g.id, mechanic: "惜羽 (bar increase → normal attack) · 化生戟 consume" });
    onBarIncrease(battle, "garuda:" + g.id, (v: Entity) => onBarUp(battle, g, v));
    if (!skillById(g, "378_02") || exclusiveOf(battle, g.teamId)?.id !== g.id) continue;
    reg(EV.BEFORE_DAMAGE, (ctx: any) => {
      const dst: Entity | undefined = ctx?.input?.target;
      const res = ctx?.result;
      if (ctx?.input?.source?.id !== g.id || !dst || !res || res.ignoresModifiers || !currentSkillOf(battle, g)) return;
      if ((dst.shields ?? []).some((s: any) => !s.broken && Number(s.value) > 0)) res.final *= 1 + GARUDA.shieldBonus;
    });
    reg(EV.TURN_END, (ctx: any) => (ctx?.actor ? onEnemyTurnEnd(battle, g, ctx.actor) : undefined));
    out.push({ entityId: g.id, mechanic: "天衣妙翅 (shield +20%, 10% 惜羽, L5 free 龙息炽羽, heal on consume)" });
  }
  return out;
}
