// compile/betting-shiro.ts — 白童子 (SR 278, Global "Shiro") at max skill level. MAX mode only (match 13).
//
// Sources: data/kb/shikigami.json 278_01..278_03, buff 2783_1 白之护 ("视为护盾，吸收1次伤害后消失。存在期间，提升40%效果抵抗"),
// tips_15 维持, data/kb/ai.json row 278; data/kb/en-text.json (Global, same meaning). Before this module 不灭 (passive)
// never ran and the souls of 招魂 were not summoned (unmodeledMechanics).
//   罪罚·白 (278_01) · 125% ATK (compiled, unchanged).
//   不灭 (278_02, passive) · when an enemy shikigami (non-summon) dies, he normal-attacks a random enemy.
//   招魂 (278_03, 3) · 126% ATK to all enemies (compiled, unchanged); every ally gains 白之护 sustained 1 of his turns
//        (one hit absorbed, then gone; +40% effect RES while present); the soul of every dead ally rises at its position
//        and immediately normal-attacks a random enemy with 100% of that ally's ATK.
//   AI (KB) · "3技能" every turn (the generic KB rule already does this) — not hand-written.
// Readings / simplifications (unverified — noted in the report):
//   · "所有阵亡目标" = his dead allies (the alternative, dead units of both sides, would add enemy souls on his side).
//   · A soul is not created as a unit: its summon attack is dealt as one 100%-ATK normal hit whose source is the dead
//     ally (its ATK / crit / crit damage; its souls and passives do not run while it is dead). Not modelled: the soul's
//     own possible turn during its 1-turn life (it "can only normal attack") and being a target (enemies never target
//     summons in this engine anyway).
//   · 白之护 absorbs one hit of any damage (fully, whatever the amount), counted through the bearer's BEFORE_DAMAGE.
//   · 不灭's free attack is a pseudo turn (like a counter): not when he cannot act; one per enemy death.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler } from "./betting-shared.ts";

export const SHIRO = Object.freeze({ guardRes: 0.4, guardTurns: 2, soulRatio: 1 });
export const GUARD_ID = "2783_1";

const guardDef = () => markDef({ id: GUARD_ID, name: "白之护", category: StatusCategory.BUFF_MARK, durationPolicy: "SOURCE_TURN", dispellable: true, removable: true,
  desc: "【增益、印记】视为护盾，吸收1次伤害后消失。存在期间，提升40%效果抵抗。" }, StatusBook);

export const isShiro = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "278_02") && !!skillById(e, "278_03");
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);

/** 不灭: a normal attack on a random enemy (pseudo turn). */
export async function freeAttack(battle: any, s: Entity, reason: string): Promise<boolean> {
  if (!s.alive || isActionPrevented(s.statusDefs())) return false;
  const pool = aliveEnemies(battle, s);
  if (!pool.length) return false;
  const basic = s.skills.find((k: any) => Number(k.cost) === 0);
  if (!basic) return false;
  battle.rng.expect("shiro278_free_target");
  const t: Entity = battle.rng.pick(pool) ?? pool[0];
  battle.trace.push({ t: "PASSIVE_PROC", actor: s.id, skill: "不灭", effect: "普攻随机敌方目标", target: t.id, reason });
  await battle.runPseudoTurn(s, TurnType.PSEUDO_TURN, { skill: basic, target: t });
  return true;
}

/** 招魂: 白之护 on every ally, then the souls of the dead allies strike. */
async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "278_03" || !isShiro(self)) return false;
  for (const a of battle.teams[self.teamId].aliveMembers() as Entity[]) {
    for (const st of [...a.statuses]) if (st.def.id === GUARD_ID) a.expireStatus(st);
    const r = a.addStatus(guardDef(), self.id, 1, SHIRO.guardTurns, [{ prop: "efr", value: SHIRO.guardRes, mode: "FIXED" }], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: a.id, status: GUARD_ID, name: "白之护", category: StatusCategory.BUFF_MARK, duration: 1, ref: GUARD_ID, known: true, tag: (r as any)?.tag ?? null, skill: x.name });
  }
  const dead = (battle.teams[self.teamId].members as Entity[]).filter(m => !m.alive && !isSummonUnit(m) && m.id !== self.id);
  let i = 0;
  for (const d of dead) {
    const pool = aliveEnemies(battle, self);
    if (!pool.length) break;
    battle.rng.expect("shiro278_soul_target#" + (++i));
    const t: Entity = battle.rng.pick(pool) ?? pool[0];
    battle.trace.push({ t: "SUMMON_STRIKE", src: self.id, soulOf: d.id, target: t.id, skill: x.name, note: "魂魄（继承100%攻击）召唤时普攻" });
    await battle.withinResolution({ id: "HIT:魂魄#" + i, type: "HIT" }, async () => {
      await battle.damage(d, t, d.prop("atk") * SHIRO.soulRatio, DamageType.NORMAL, 1, null);
    });
  }
  return true;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isShiro);
  if (!units.length) return out;
  // 白之护: absorbs one hit (whole), then disappears. The mark acts as a shield, so it runs after the caster's death too.
  ensureGlobalHandler(battle, "betting:278:guard", EV.BEFORE_DAMAGE, (ctx: any) => {
    const dst: Entity | undefined = ctx?.input?.target, res = ctx?.result;
    if (!dst?.alive || !res || !(Number(res.final ?? 0) > 0)) return;
    const st = dst.statuses.find(s => s.def.id === GUARD_ID);
    if (!st || !dst.expireStatus(st)) return;
    battle.trace.push({ t: "SHIELD_BREAK", id: dst.id, status: GUARD_ID, name: "白之护", absorbed: Math.round(res.final), src: ctx.input.source?.id ?? null });
    res.final = 0;
  });
  for (const s of units) {
    registerOwnerHandler(battle, "betting:278:death:" + s.id, s.id, EV.DEATH, async (ctx: any) => {
      const v: Entity | undefined = ctx?.target;
      if (!v || v.teamId === s.teamId || isSummonUnit(v) || !s.alive) return;
      await freeAttack(battle, s, "ENEMY_DEATH:" + v.id);
    }, "ALL");
    out.push({ entityId: s.id, mechanic: "不灭 (free normal attack on enemy death) · 招魂 (白之护 one-hit shield +40% RES; dead allies' souls strike for 100% ATK)" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "278_03": { note: "招魂: 白之护 and the souls' summon attacks are run by betting-shiro.ts", patch: { statusRefConditionOnly: [0] } },
  }),
  afterCast,
  install,
};
