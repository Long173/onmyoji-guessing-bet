// compile/betting-tamamo.ts — 玉藻前 (SSR 300, Global "Tamamonomae") at max skill level. MAX mode only (match 11).
//
// Sources: data/kb/shikigami.json 300_01..300_03, data/kb/ai.json row 300; data/kb/en-text.json (Global).
// Before this module her KB AI did not compile (the "敌方单位存活数量" conditions were unresolved), so she only ever used
// 灵击, and the 堕天 L5 chain (skipped max-level line) never ran.
//   狐火 (300_02, 3)  · 389% ATK on one enemy.
//   堕天 (300_03, 3)  · 195% ATK on all enemies. L5: if 狐火 or 堕天 defeats an enemy, immediately cast the other
//                       sorcery skill at no cost, damage reduced by 20% each time (chain continues while kills happen).
//   AI (KB)          · ≥2 enemies alive → 堕天; 1 enemy alive → 狐火; the normal attack when the onibi are short.
//                       狐火 / 灵击 prefer an enemy below 50% HP (KB target rows, unchanged).
// Readings (conservative, unverified): "伤害依次递减20%" is read additively (80%, 60%, 40% …) rather than 0.8^n; the
// chained 狐火 targets the lowest-HP-ratio enemy below 50% HP, else the first living enemy; the chained casts are
// part of the same skill resolution (no extra skill-cast events).
import type { Entity } from "../kernel/entity.ts";
import { DamageType } from "../kernel/types.ts";
import type { BettingKit } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById } from "./betting-shared.ts";

export const TAMAMO = Object.freeze({ foxRatio: 389, fallRatio: 195, chainStep: 0.2, lowHp: 0.5 });

export const isTamamo300 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "300_02") && !!skillById(e, "300_03");
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const ratioOf = (ir: any, fallback: number): number => Number(ir?.damage?.[0]?.ratioMax ?? ir?.damage?.[0]?.ratio ?? fallback);

function chainTarget(battle: any, t: Entity): Entity | null {
  const foes = aliveEnemies(battle, t);
  const low = foes.filter(v => v.hp / v.maxHp < TAMAMO.lowHp);
  if (low.length) return low.reduce((a, b) => (a.hp / a.maxHp <= b.hp / b.maxHp ? a : b));
  return foes[0] ?? null;
}

/** One sorcery cast (狐火 on `primary` / 堕天 on all enemies) at `mult` of its damage; true = an enemy was defeated. */
async function sorcery(battle: any, t: Entity, ir: any, primary: Entity | null, mult: number, hurt: Entity[], label: string): Promise<boolean> {
  const fall = ir?.id === "300_03";
  const ratio = ratioOf(ir, fall ? TAMAMO.fallRatio : TAMAMO.foxRatio);
  const targets = fall ? aliveEnemies(battle, t) : (primary?.alive ? [primary] : []);
  if (!targets.length) return false;
  let killed = false;
  await battle.withinResolution({ id: "HIT:" + label + "#1", type: "HIT" }, async () => {
    for (const v of targets) {
      if (!v.alive || !t.alive) continue;
      if (!hurt.includes(v)) hurt.push(v);
      await battle.damage(t, v, t.prop("atk") * (ratio / 100) * mult, DamageType.NORMAL, 1, ir?.lifesteal ?? null);
      if (!v.alive) killed = true;
    }
  });
  return killed;
}

function damageHook(x: any): any {
  if (x?.id !== "300_02" && x?.id !== "300_03") return null;
  return {
    kind: "TAMAMO_SORCERY",
    run: async (battle: any, t: Entity, hurt: Entity[], primary?: Entity) => {
      let ir = x;
      let mult = 1, step = 0;
      let target: Entity | null = primary?.alive && primary.teamId !== t.teamId ? primary : chainTarget(battle, t);
      let killed = await sorcery(battle, t, ir, target, mult, hurt, x.name);
      if (!isTamamo300(t)) return;
      while (killed && t.alive && aliveEnemies(battle, t).length) {
        step++;
        mult = 1 - TAMAMO.chainStep * step;   // additive reading: 0.8, 0.6, 0.4 …
        if (!(mult > 0)) return;
        const next = skillById(t, ir.id === "300_02" ? "300_03" : "300_02")?.ir;
        if (!next) return;
        ir = next;
        target = ir.id === "300_02" ? chainTarget(battle, t) : null;
        battle.trace.push({ t: "SUBCAST", actor: t.id, ref: ir.id, skill: ir.name, target: target?.id ?? null, damageMul: mult,
          clause: "堕天 L5：若『狐火』或『堕天』击败敌方，立即免消耗施放另一妖术技能，伤害依次递减20%" });
        killed = await sorcery(battle, t, ir, target, mult, hurt, ir.name + "·连锁");
      }
    },
  };
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isTamamo300(self)) return null;
  const fall = skillById(self, "300_03"), fox = skillById(self, "300_02"), basic = skillById(self, "300_01");
  const can = (sk: any) => !!sk && (!(costOf(sk) > 0) || battle.teams[self.teamId].orbs.canPay(costOf(sk)));
  const n = aliveEnemies(battle, self).length;
  if (n >= 2 && can(fall)) return { skill: fall, rule: "玉藻前: 敌方存活≥2 → 堕天 (KB AI)" };
  if (n === 1 && can(fox)) return { skill: fox, rule: "玉藻前: 敌方存活1 → 狐火 (KB AI)" };
  return basic ? { skill: basic, rule: "玉藻前: 鬼火不足 → 灵击" } : null;
}

export const KIT: BettingKit = {
  damageHook: (x: any) => (bettingActive() ? damageHook(x) : null),
  ruleSkill,
};
