// compile/betting-yamausagi.ts — 山兔 (R 237, Global "Yamausagi") at max skill level. MAX mode only (match 15).
//
// Sources: data/kb/shikigami.json 237_01..237_03, buff 2372_1 兔子舞, tips_107 变形, data/kb/ai.json row 237;
// data/kb/en-text.json (Global, same meaning). Before this module she only ever used 谁还不听话: both KB AI rows
// ("友方单位拥有兔子舞buff时" / "友方单位均无兔子舞buff时" → 3技能) were evaluated false, and the compiled 兔子舞 pulled
// only herself and gave a 兔子舞 buff without its ATK effect.
//   谁还不听话 (237_01) · 125% ATK (compiled, unchanged).
//   兔子舞 (237_02, 2) · every living non-summon ally +30% action bar and 兔子舞 (+20% ATK, L3) for 2 of the bearer's turns;
//        L4: after the cast, the ally with the lowest action bar gets +40% ATK instead.
//   幸运套环 (237_03, 3) · 285% ATK (L5) single target, 10% base chance (effect hit vs RES) to Morph (变形: cannot act,
//        passives off, not dispellable) for 2 of the target's turns; L5: when the Morph lands, a free 兔子舞 at once.
//   AI · no living ally has 兔子舞 → 兔子舞; an ally has it → 幸运套环; unaffordable → 谁还不听话. Source: the human
//        summary of the same wiki row (data/ai_rules.csv / data/kb/duiyi.json "无兔子舞BUFF二技能，有三技能"); the parsed
//        KB rows (data/kb/ai.json) say 3技能 for both conditions, an evident parse slip (the condition would be pointless).
// Readings (noted in the report):
//   · AI as above. KB-as-parsed alternative (always S3): YAMAUSAGI_AI.s2WhenNoDance = false.
//   · "行动条最底端的友方" = the lowest timeline position after the +30% pull, herself included.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { BettingKit, Hook } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, shiftBar, applyContested } from "./betting-shared.ts";
import { bearerTurnControl } from "./betting-fengyang.ts";

export const YAMAUSAGI = Object.freeze({ bar: 0.3, atk: 0.2, atkLow: 0.4, turns: 2, morphP: 0.1, morphTurns: 2, ultRatio: 285 });
/** Sensitivity switch (default true = the wiki summary "无兔子舞BUFF二技能，有三技能"; false = parsed KB rows: always S3). */
export const YAMAUSAGI_AI = { s2WhenNoDance: true };
export const DANCE_ID = "2372_1";

const danceDef = () => markDef({ id: DANCE_ID, name: "兔子舞", category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN",
  dispellable: true, removable: true, desc: "【增益、状态】提升20%攻击（L4：行动条最底端的友方40%）。" }, StatusBook);

export const isYamausagi = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "237_02") && !!skillById(e, "237_03");
const allies = (battle: any, e: Entity): Entity[] =>
  (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m));
const barOf = (battle: any, e: Entity): number => Number(battle.timeline.get(e.id)?.pos ?? 0);

/** 兔子舞 effects (the cast itself or the L5 free cast). */
export function rabbitDance(battle: any, y: Entity, skill = "兔子舞"): void {
  const team = allies(battle, y);
  for (const m of team) shiftBar(battle, m, YAMAUSAGI.bar, skill);
  if (!team.length) return;
  const low = team.reduce((a, b) => (barOf(battle, b) < barOf(battle, a) ? b : a));
  const def = danceDef();
  for (const m of team) {
    for (const st of [...m.statuses]) if (st.def.id === DANCE_ID) m.expireStatus(st);
    const v = m.id === low.id ? YAMAUSAGI.atkLow : YAMAUSAGI.atk;
    m.addStatus(def, y.id, 1, YAMAUSAGI.turns, [{ prop: "atk", value: v, mode: "ADD_RATE" }], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: y.id, dst: m.id, status: DANCE_ID, name: "兔子舞", category: def.category, duration: YAMAUSAGI.turns, ref: DANCE_ID, known: true, skill, note: "ATK +" + Math.round(v * 100) + "%" + (m.id === low.id ? " (L4: lowest action bar)" : "") });
  }
}

function ringToss(x: any): Hook | null {
  if (x?.id !== "237_03") return null;
  return {
    kind: "LUCKY_RING_TOSS",
    run: async (battle, y, hurt, primary) => {
      const t = primary && primary.alive && primary.teamId !== y.teamId ? primary : null;
      if (!t) return;
      const ratio = Number(x.damage?.[0]?.ratioMax ?? x.damage?.[0]?.ratio ?? YAMAUSAGI.ultRatio) / 100;
      if (!hurt.includes(t)) hurt.push(t);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        await battle.damage(y, t, y.prop("atk") * ratio, x.damage?.[0]?.type ?? DamageType.NORMAL, 1, x.lifesteal ?? null);
      });
      if (!t.alive || !y.alive) return;
      const landed = await applyContested(battle, y, t, bearerTurnControl("morph"), YAMAUSAGI.morphP, YAMAUSAGI.morphTurns, [], { skill: x.name, ref: "CONTROL:morph" });
      if (!landed) return;
      battle.trace.push({ t: "SUBCAST", actor: y.id, ref: "237_02", skill: "兔子舞", target: y.id, clause: "L5：成功触发变形，立即施放一次无消耗的『兔子舞』" });
      rabbitDance(battle, y, "兔子舞");
    },
  };
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isYamausagi(self)) return null;
  const basic = skillById(self, "237_01"), dance = skillById(self, "237_02"), ult = skillById(self, "237_03");
  const can = (sk: any) => !!sk && (!(costOf(sk) > 0) || battle.teams[self.teamId].orbs.canPay(costOf(sk)));
  if (YAMAUSAGI_AI.s2WhenNoDance && can(dance) && !allies(battle, self).some(m => m.hasStatus(DANCE_ID))) {
    return { skill: dance, rule: "山兔: 友方单位均无兔子舞 → 兔子舞 (wiki AI)" };
  }
  if (can(ult)) return { skill: ult, rule: YAMAUSAGI_AI.s2WhenNoDance ? "山兔: 友方单位拥有兔子舞 → 幸运套环 (wiki AI)" : "山兔: 幸运套环 (parsed KB rows: always 3技能)" };
  return basic ? { skill: basic, rule: "山兔: 鬼火不足 → 谁还不听话" } : null;
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "237_02" || !isYamausagi(self)) return false;
  rabbitDance(battle, self, x.name);
  return true;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "237_02": { note: "兔子舞: +30% bar to every ally, 兔子舞 +20% ATK (L4 40% on the lowest bar) run by betting-yamausagi.ts (compiled self-only pull and effect-less buff removed)", patch: { timeline: [], statusRefConditionOnly: [0] } },
    "237_03": { note: "幸运套环: damage, Morph (target turns) and the L5 free 兔子舞 run by betting-yamausagi.ts (compiled Morph removed)", patch: { controlRefs: [] } },
  }),
  damageHook: (x: any) => (bettingActive() ? ringToss(x) : null),
  ruleSkill,
  afterCast,
};
