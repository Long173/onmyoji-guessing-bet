// compile/betting-kuromujou.ts — 鬼使黑 (SR 211, Global "Kuro Mujou") at max skill level. MAX mode only (match 14).
//
// Sources: data/kb/shikigami.json 211_01..211_03, data/kb/ai.json row 211; data/kb/en-text.json (Global, same meaning).
// Before this module he only ever used 惩戒: the KB AI conditions ("敌方存在生命比例小于20%的单位或剩余单位小于2时" /
// "敌方有单位血量高于40%") were unresolved, so the cast list fell through to "否则 → 普攻" even with 8 onibi.
//   惩戒 (211_01) · 125% ATK. KB target rule: prefer an enemy below 30% HP, a debuffed enemy counting 20% lower.
//   索命 (211_02, passive) · defeating an enemy grants a new turn (kernel/extra-turn.ts; one grant per action).
//   死亡宣判 (211_03, 3) · 128% ATK to all enemies; against an enemy above 40% HP ratio: +50% crit and +50% damage,
//        otherwise −50% damage (ratio read at the moment of each hit).
//   AI (KB) · an enemy below 20% HP or fewer than 2 enemies left → 惩戒; an enemy above 40% HP → 死亡宣判 (when
//        affordable); else 惩戒. (The duel aiText says "敌方有生命大于60%的开技能" — S3_HP_THRESHOLD; see report.)
// Not modelled: 『追魂』, the replacement of 惩戒 during a 索命 new turn — its text is in no KB file, so the new turn
// uses 惩戒 (gap).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { grantExtraTurn } from "../kernel/extra-turn.ts";
import type { BettingKit, Hook, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, isDebuffOrControl } from "./betting-shared.ts";

export const KUROMUJOU = Object.freeze({
  s3Hp: 0.4, s3Crit: 0.5, s3Up: 1.5, s3Down: 0.5, ultRatio: 128,
  aiLowHp: 0.2, aiS3Hp: 0.4, aiMinEnemies: 2, targetLow: 0.3, targetDebuff: 0.2,
});
const CRIT_ID = "211_s3_crit";
const critDef = () => markDef({ id: CRIT_ID, name: "死亡宣判·暴击", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "死亡宣判：对生命比例高于40%的敌方，暴击提升50%（仅在该次攻击中）。" }, StatusBook);

export const isKuroMujou = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "211_02") && !!skillById(e, "211_03");
const aliveEnemies = (battle: any, e: Entity): Entity[] =>
  battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive && !isSummonUnit(v));
const ratioOf = (v: Entity): number => (v.maxHp > 0 ? v.hp / v.maxHp : 0);

function deathSentence(x: any): Hook | null {
  if (x?.id !== "211_03") return null;
  return {
    kind: "DEATH_SENTENCE",
    run: async (battle, k, hurt) => {
      const ratio = Number(x.damage?.[0]?.ratioMax ?? x.damage?.[0]?.ratio ?? KUROMUJOU.ultRatio) / 100;
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        for (const v of aliveEnemies(battle, k)) {
          if (!v.alive || !k.alive) continue;
          if (!hurt.includes(v)) hurt.push(v);
          const high = ratioOf(v) > KUROMUJOU.s3Hp;
          const st = high ? k.addStatus(critDef(), k.id, 1, 99999, [{ prop: "cri", value: KUROMUJOU.s3Crit, mode: "FIXED" }], 1) : null;
          try {
            await battle.damage(k, v, k.prop("atk") * ratio, DamageType.NORMAL, high ? KUROMUJOU.s3Up : KUROMUJOU.s3Down, x.lifesteal ?? null);
          } finally {
            for (const s of [...k.statuses]) if (s.def.id === CRIT_ID) k.expireStatus(s);
          }
          battle.trace.push({ t: "PASSIVE_PROC", actor: k.id, skill: x.name, effect: high ? "生命比例高于40%：暴击和伤害提升50%" : "生命比例不高于40%：伤害降低50%", target: v.id });
        }
      });
    },
  };
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isKuroMujou(self)) return null;
  const basic = skillById(self, "211_01"), ult = skillById(self, "211_03");
  const foes = aliveEnemies(battle, self);
  if (foes.some(v => ratioOf(v) < KUROMUJOU.aiLowHp) || foes.length < KUROMUJOU.aiMinEnemies) {
    return basic ? { skill: basic, rule: "鬼使黑: 敌方存在生命比例<20%的单位或剩余单位<2 → 惩戒 (KB AI)" } : null;
  }
  const c = ult ? costOf(ult) : 0;
  if (ult && foes.some(v => ratioOf(v) > KUROMUJOU.aiS3Hp) && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c))) {
    return { skill: ult, rule: "鬼使黑: 敌方有单位血量高于" + Math.round(KUROMUJOU.aiS3Hp * 100) + "% → 死亡宣判 (KB AI)" };
  }
  return basic ? { skill: basic, rule: "鬼使黑: 否则 → 惩戒 (KB AI)" } : null;
}

/** KB target rule of 惩戒: prefer an enemy below 30% HP; a debuffed enemy counts 20% lower. */
function target(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || x?.id !== "211_01" || !isKuroMujou(self)) return null;
  const score = (v: Entity) => ratioOf(v) - (v.statuses.some(s => isDebuffOrControl(s.def)) ? KUROMUJOU.targetDebuff : 0);
  const low = cands.filter(v => v.alive && v.teamId !== self.teamId && score(v) < KUROMUJOU.targetLow);
  if (!low.length) return null;
  const t = low.reduce((a, b) => (score(b) < score(a) ? b : a));
  return { target: t, rule: "鬼使黑: 优先血量低于30%的单位（有减益时-20%）(KB)" };
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const k of entities.filter(isKuroMujou)) {
    let granted = false;
    registerOwnerHandler(battle, "betting:211:reset:" + k.id, k.id, EV.TURN_START, (ctx: any) => {
      if (ctx?.actor?.id === k.id) granted = false;
    }, "ALL");
    // 索命: defeating an enemy ⇒ a new turn (at most one per action).
    registerOwnerHandler(battle, "betting:211:reap:" + k.id, k.id, EV.KILLED, (ctx: any) => {
      const v: Entity | undefined = ctx?.target;
      if (ctx?.killerId !== k.id || !v || v.teamId === k.teamId || isSummonUnit(v) || !k.alive || granted) return;
      if (!aliveEnemies(battle, k).length) return;
      granted = true;
      battle.trace.push({ t: "PASSIVE_PROC", actor: k.id, skill: "索命", effect: "击败敌方，获得新的回合", target: v.id });
      grantExtraTurn(battle, k, "索命");
    }, "ALL");
    out.push({ entityId: k.id, mechanic: "死亡宣判 (>40% HP: +50% crit / damage, else −50%) · 索命 new turn on a kill · KB AI / 惩戒 target rule" });
  }
  return out;
}

export const KIT: BettingKit = {
  damageHook: (x: any) => (bettingActive() ? deathSentence(x) : null),
  ruleSkill,
  target,
  install,
};
