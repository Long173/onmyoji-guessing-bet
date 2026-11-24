// compile/betting-kyonshiani.ts — 跳跳哥哥 (SR 233, Global "Kyonshi Ani") at max skill level. MAX mode only (match 14).
//
// Sources: data/kb/shikigami.json 233_02 / 233_03, tips_20 恢复, data/kb/ai.json row 233; data/kb/en-text.json (Global,
// same meaning). Before this module the KB condition "友方有可复活目标时" was unresolved (死而复生 never cast), the RES
// passive and the automatic 不弃 did nothing.
//   不弃 (233_02) · +40% effect RES (L5, permanent). [Cast] 125% ATK + 30% base chance 眩晕 1 turn (compiled, kept).
//        When an ally is defeated: automatically uses 不弃 on the one who defeated it with 100% base chance (free).
//   死而复生 (233_03, 3) · a coffin at every dead non-summon ally's position (30% (L5) of that ally's max HP + an equal
//        share of 30% of his max HP, 100% of the ally's SPD). On its next action the coffin sacrifices itself and the
//        ally is revived with 100% of its max HP (恢复). Each defeated coffin: +15% bar to the others (never happens:
//        enemies never target summons in this engine — known limitation, favours Blue).
//   AI (KB) · a revivable ally → 死而复生; else 不弃 (target: random, compiled); 棺击 when short of onibi.
// Readings: the automatic 不弃 needs him alive and actionable, the killer alive and an enemy; it is a free cast that
// does not consume his turn. Coffins do not take a summon slot and do not advance the onibi gauge.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, CONTROL_EFFECTS, isActionPrevented } from "../kernel/status.ts";
import { removeSummon } from "../kernel/summon.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, applyContested, isControlDef, PERSIST } from "./betting-shared.ts";

export const KYONSHI = Object.freeze({ res: 0.4, autoRatio: 125, stunP: 1, stunTurns: 1, coffinInherit: 0.3, coffinBonus: 0.3, reviveHp: 1 });
const RES_ID = "233_res";
export const COFFIN_NOTE = "kyonshi233:coffin-for=";
const resDef = () => markDef({ id: RES_ID, name: "不弃·效果抵抗", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "不弃 L5：提升40%效果抵抗。" }, StatusBook);
const stunDef = () => CONTROL_EFFECTS.find(d => d.id === "stun")!;

export const isKyonshiAni = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "233_02") && !!skillById(e, "233_03");
const revivable = (battle: any, e: Entity): Entity[] =>
  (battle.teams[e.teamId].members as Entity[]).filter(m => !m.alive && m.dead && !m.reviveBlocked && !isSummonUnit(m) && m.id !== e.id
    && !coffinFor(battle, m));
const coffinFor = (battle: any, m: Entity): Entity | null =>
  (battle.teams[m.teamId]?.summons ?? []).find((s: Entity) => s.alive && (s.notes ?? []).includes(COFFIN_NOTE + m.id)) ?? null;
const actionable = (e: Entity): boolean => e.alive && !isActionPrevented(e.statusDefs()) && !e.statuses.some(s => isControlDef(s.def));

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isKyonshiAni(self)) return null;
  const can = (sk: any) => { const c = sk ? costOf(sk) : 0; return !!sk && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c)); };
  const ult = skillById(self, "233_03"), s2 = skillById(self, "233_02"), basic = skillById(self, "233_01");
  if (revivable(battle, self).length && can(ult)) return { skill: ult, rule: "跳跳哥哥: 友方有可复活目标 → 死而复生 (KB AI)" };
  if (can(s2)) return { skill: s2, rule: "跳跳哥哥: 否则 → 不弃 (KB AI)" };
  return basic ? { skill: basic, rule: "跳跳哥哥: 鬼火不足 → 棺击" } : null;
}

function summonCoffins(battle: any, self: Entity, x: any): number {
  const dead = revivable(battle, self);
  if (!dead.length) return 0;
  const team = battle.teams[self.teamId];
  const bonus = (self.maxHp * KYONSHI.coffinBonus) / dead.length;
  let made = 0;
  for (const m of dead) {
    const hp = m.maxHp * KYONSHI.coffinInherit + bonus;
    const slots = team.summonSlots ?? 1;
    team.summonSlots = slots + 1;   // coffins do not take the summon slot
    let c: Entity | null = null;
    try {
      c = battle.addSummon(self, {
        tipsId: "233_coffin", name: "棺材", hp: { prop: "hp", ratio: hp / Math.max(1, Number(self.base.hp ?? self.maxHp)) }, inheritInitialStats: false,
        noAction: false, suppressSoul: true, suppressPassive: true, immuneTo: [], inherit: [],
        spdBonus: Number(m.base.spd ?? m.speed ?? 100) - Number(self.base.spd ?? 100),
        evidence: "233_03：棺材继承该位置友方30%生命值（L5），100%速度；跳跳哥哥生命上限30%平均分给所有棺材",
      }, { hasSkills: false });
    } finally {
      team.summonSlots = slots;
    }
    if (!c) continue;
    c.caps.occupiesSummonSlot = false;
    c.caps.advancesOrbGauge = false;
    c.notes.push(COFFIN_NOTE + m.id);
    made++;
    battle.trace.push({ t: "SUBCAST", actor: self.id, ref: "233_03", skill: x?.name ?? "死而复生", target: c.id, clause: "在阵亡友方位置召唤棺材（复活 " + m.id + "）" });
  }
  return made;
}

async function coffinTurn(battle: any, c: Entity): Promise<void> {
  const n = (c.notes ?? []).find(s => s.startsWith(COFFIN_NOTE));
  const ally: Entity | undefined = n ? battle.allEntities().find((e: Entity) => e.id === Number(n.slice(COFFIN_NOTE.length))) : undefined;
  await removeSummon(battle, c, "COFFIN_SACRIFICE");
  if (!ally || ally.alive) return;
  if (await battle.revive(ally, ally.maxHp * KYONSHI.reviveHp)) {
    battle.trace.push({ t: "PASSIVE_PROC", actor: c.id, skill: "死而复生", effect: "棺材牺牲，复活并恢复生命上限100%", target: ally.id });
  }
}

async function autoNeverGiveUp(battle: any, k: Entity, killer: Entity): Promise<void> {
  const sk = skillById(k, "233_02");
  const ratio = Number(sk?.ir?.damage?.[0]?.ratioMax ?? KYONSHI.autoRatio) / 100;
  battle.trace.push({ t: "SUBCAST", actor: k.id, ref: "233_02", skill: "不弃", target: killer.id, clause: "友方被击败时，自动对击败者使用此技能，并提升至100%基础概率" });
  await battle.withinResolution({ id: "SKILL:不弃", type: "SKILL" }, async () => {
    await battle.withinResolution({ id: "HIT:不弃#1", type: "HIT" }, async () => {
      if (killer.alive && k.alive) await battle.damage(k, killer, k.prop("atk") * ratio, DamageType.NORMAL, 1, null);
    });
    if (killer.alive && k.alive) await applyContested(battle, k, killer, stunDef(), KYONSHI.stunP, KYONSHI.stunTurns, [], { skill: "不弃", ref: "CONTROL:stun" });
  });
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "233_03" || !isKyonshiAni(self)) return false;
  summonCoffins(battle, self, x);
  return true;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isKyonshiAni);
  for (const k of units) {
    k.addStatus(resDef(), k.id, 1, PERSIST, [{ prop: "efr", value: KYONSHI.res, mode: "FIXED" }], 1);
    registerOwnerHandler(battle, "betting:233:auto:" + k.id, k.id, EV.KILLED, async (ctx: any) => {
      const v: Entity | undefined = ctx?.target;
      if (!v || v.id === k.id || v.teamId !== k.teamId || isSummonUnit(v) || !actionable(k)) return;
      const killer: Entity | undefined = battle.allEntities().find((e: Entity) => e.id === ctx?.killerId);
      if (!killer?.alive || killer.teamId === k.teamId) return;
      await autoNeverGiveUp(battle, k, killer);
    }, "ALL");
    out.push({ entityId: k.id, mechanic: "不弃 (+40% RES, automatic 100% stun cast on an ally's killer) · 死而复生 (coffins revive the dead allies at full HP on their next action) · KB AI" });
  }
  if (units.length) {
    ensureGlobalHandler(battle, "betting:233:coffin-turn", EV.TURN_START, async (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (a?.alive && isSummonUnit(a) && (a.notes ?? []).some(s => s.startsWith(COFFIN_NOTE))) await coffinTurn(battle, a);
    });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "233_03": { note: "死而复生: coffins and the revive are run by betting-kyonshiani.ts (the compiled 15% pull is removed)", patch: { timeline: [] } },
  }),
  ruleSkill,
  afterCast,
  install,
};
