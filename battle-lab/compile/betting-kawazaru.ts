// compile/betting-kawazaru.ts — 川猿 (SR 371, Global "Kawazaru") at max skill level. MAX mode only (match 10).
//
// Sources: data/kb/shikigami.json 371_01..371_03, tips_3711 变身花纸 / tips_3713 花纸盾; data/kb/ai.json and duiyi.json
// (order 你是坏人 → 别再追我啦 → 快躲起来, each once, 3 per battle; 你是坏人 on the highest-ATK enemy); data/kb/en-text.json.
// The three form skills have no text of their own in the KB / Global data, and fandom / bilibili gave none (2026-11-24);
// only their 变幻自在 level-up riders are known. Before this module she only normal-attacked (变幻自在 had no executable
// effect and 猿形毕露 is a passive, not run on the betting path).
//   变幻自在 (371_03, 0) · 3 变身花纸 per battle. Each cast changes form (KB AI order) and gives a 花纸盾 of 15% of her max
//        HP (cannot be dispelled; it replaces the previous form's shield). 你是坏人 (L3): 180% ATK damage to the
//        highest-ATK enemy. 别再追我啦: only the shield (its L4 buff 37152_1 has no data). 快躲起来 (L5): heals every ally
//        31% of her ATK (heals can crit).
//   猿形毕露 (371_02)    · once the papers are gone: each normal attack lowers the target's effect RES by 40% and applies
//        40% vulnerability (damage taken +40%), both for 2 turns (contested).
//   AI (KB)             · the forms in order while papers remain, then the normal attack.
// Doubts: the base effects of the three forms are unknown; "吸收系数30%" is read as the shield amount staying 15% of max HP
// (the coefficient wording is not modelled); the debuffs are rolled against effect RES.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, applyContested, grantTimedShield, atkForTargeting, PERSIST,
} from "./betting-shared.ts";

export const KAWAZARU = Object.freeze({ papers: 3, shield: 0.15, badGuy: 180, heal: 0.31, resCut: 0.4, vuln: 0.4, debuffTurns: 2 });
const FORMS = ["你是坏人", "别再追我啦", "快躲起来"] as const;
const N_USED = "kawazaru371:used=";
const SHIELD_TAG = "kawazaru371";
const RES_ID = "371_res", VULN_ID = "371_vuln";

const resDef = () => markDef({ id: RES_ID, name: "猿形毕露·抵抗降低", category: StatusCategory.DEBUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【减益、状态】效果抵抗降低40%，持续2回合（猿形毕露）。" }, StatusBook);
const vulnDef = () => markDef({ id: VULN_ID, name: "猿形毕露·易伤", category: StatusCategory.DEBUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【减益、状态】受到的伤害提升40%，持续2回合（猿形毕露）。" }, StatusBook);

export const isKawazaru371 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "371_02") && !!skillById(e, "371_03");
export const papersUsed = (e: Entity): number => Number(noteValue(e, N_USED) ?? 0);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);

function ruleSkill(_battle: any, self: Entity, _costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isKawazaru371(self)) return null;
  const morph = skillById(self, "371_03"), basic = skillById(self, "371_01");
  const used = papersUsed(self);
  if (morph && used < KAWAZARU.papers) return { skill: morph, rule: `川猿: 变幻自在「${FORMS[used]}」(KB AI 顺序)` };
  return basic ? { skill: basic, rule: "川猿: 变身花纸用尽 → 花纸散（猿形毕露）" } : null;
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isKawazaru371(self) || x?.id !== "371_03") return false;
  const i = papersUsed(self);
  if (i >= KAWAZARU.papers) return true;
  setNote(self, N_USED, i + 1);
  battle.trace.push({ t: "SKILL_FORM", actor: self.id, skill: x.name, as: FORMS[i], papersLeft: KAWAZARU.papers - i - 1 });
  for (const sh of (self.shields ?? []) as any[]) if (!sh.broken && String(sh.id ?? sh.tag ?? "").includes(SHIELD_TAG)) sh.broken = true;
  grantTimedShield(battle, self, self, self.maxHp * KAWAZARU.shield, PERSIST, { tag: SHIELD_TAG, skill: "花纸盾", reason: "FORM_CHANGE", base: "maxHp", ratio: KAWAZARU.shield, dispellable: false });
  if (i === 0) {
    const foes = aliveEnemies(battle, self);
    const t = foes.reduce<Entity | null>((a, b) => (!a || atkForTargeting(b) > atkForTargeting(a) ? b : a), null);
    if (t) await battle.withinResolution({ id: "HIT:你是坏人#1", type: "HIT" }, async () => {
      if (t.alive) await battle.damage(self, t, self.prop("atk") * (KAWAZARU.badGuy / 100), DamageType.NORMAL, 1, null);
    });
  } else if (i === 2) {
    for (const a of (battle.teams[self.teamId].members as Entity[]).filter(m => m.alive)) await battle.heal(self, a, self.prop("atk") * KAWAZARU.heal, { crit: true });
  }
  return true;
}

function damageHook(x: any): any {
  if (x?.id !== "371_01") return null;
  return {
    kind: "KAWAZARU_PAPER",
    run: async (battle: any, k: Entity, hurt: Entity[], primary?: Entity) => {
      const v = primary?.alive && primary.teamId !== k.teamId ? primary : aliveEnemies(battle, k)[0];
      if (!v) return;
      hurt.push(v);
      const ratio = Number(x.damage?.[0]?.ratioMax ?? x.damage?.[0]?.ratio ?? 125);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        if (v.alive) await battle.damage(k, v, k.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, x.lifesteal ?? null);
      });
      if (!isKawazaru371(k) || papersUsed(k) < KAWAZARU.papers || !v.alive) return;
      for (const [def, eff] of [[resDef(), { prop: "efr", value: -KAWAZARU.resCut, mode: "FIXED" as const }], [vulnDef(), { prop: "dmgTakenD", value: KAWAZARU.vuln, mode: "FIXED" as const }]] as const) {
        for (const st of [...v.statuses]) if (st.def.id === def.id) v.expireStatus(st);
        await applyContested(battle, k, v, def, null, KAWAZARU.debuffTurns, [eff], { skill: "猿形毕露", ref: def.id });
      }
    },
  };
}

function install(_battle: any, entities: Entity[]): Installed {
  if (!bettingActive()) return [];
  return entities.filter(isKawazaru371).map(k => ({ entityId: k.id, mechanic: "变幻自在 (3 forms in KB order, 15% max-HP paper shield, 你是坏人 180%, 快躲起来 heal) · 猿形毕露 (−40% RES, +40% damage taken) · KB AI" }));
}

export const KIT: BettingKit = {
  damageHook: (x: any) => (bettingActive() ? damageHook(x) : null),
  ruleSkill,
  afterCast,
  install,
};
