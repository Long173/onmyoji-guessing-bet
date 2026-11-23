// compile/betting-hannya.ts — 御怨般若 (SP 331, Global "Vengeful Hannya") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 331_01..331_03, buffs 3312_1 仇恨印记 / 3318_1 仇恨蔓延, tips_3312 封印结界,
// tips_105 封印 / tips_106 压制; fandom "Oura Hannya/Main" and Adjustments/Shikigami (2023-01-18 Global).
//   仇恨印记 (3312_1)   · max 9; per stack +10% effect RES and 5% damage reduction. Reaching 9: remove all control
//                        effects on him and +35% action bar (Global adjustment text; the KB buff still says 45%).
//                        No gain while 封印结界 is open.
//                        Gains: 恨返 +1, 予愿必还 +3, enemy crit +1 (100% at L4, once per enemy action), non-summon
//                        ally defeated +3 (L2), 先机 +6 (L5), each enemy with 仇恨蔓延 he attacks +1.
//   积重难返 (331_02)   · 0 onibi at max level, costs 9 stacks. Opens 封印结界 with 9 demon masks: every enemy has its
//                        passive skills suppressed (压制) and souls sealed (封印), soul effect replaced by 仇鬼
//                        (crit -30%); Hannya +30 SPD. 1 mask breaks at the end of each non-summon enemy turn. The last
//                        mask closes the field and puts 仇恨蔓延 (crit +50%, damage dealt -35%, 1 turn, 100% base
//                        chance ⇒ effect RES contest) on all enemies.
//   恨返 (331_01)       · 125% ATK; with the field open: 2 hits of 100% with 15% lifesteal each.
//   予愿必还 (331_03)   · 3 × 80% on the target, then 80% to all enemies (twice with the field open). L5: one extra 80%
//                        hit on a random enemy per non-summon ally below 50% HP.
//   AI                 · KB: 积重难返 first (available = 9 stacks, field closed), else 予愿必还 (lowest HP ratio
//                        enemy), else 恨返.
// Before this module the engine cast 积重难返 every turn for free with no stacks (no gate, no field), so he never
// attacked; the field / branch / stack rules were not executed (passives are off on the betting path).
// Assumptions: enemies never use 怨恨袪除 (the 1-onibi skill that replaces their passive; no AI rule exists for
// it); the field closes without 仇恨蔓延 if Hannya is defeated; the evolved form is assumed.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, findImmuneStatus } from "../kernel/status.ts";
import { rollStatusContest, reportResist } from "../kernel/resist.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler,
  stacksOn, setStackedStatus, shiftBar, clearControls,
} from "./betting-shared.ts";

export const HANNYA = Object.freeze({
  markCap: 9,
  markRes: 0.1,            // 3312_1: 每层提升10%效果抵抗
  markCut: 0.05,           //         5%伤害减免
  fullBar: 0.35,           // Global: raises his Move Bar by 35% (KB buff: 45%)
  masks: 9,
  fieldSpd: 30,            // tips_3312: 结界中提升30点速度
  demonCrit: -0.3,         // 仇鬼: 暴击降低30%
  hatredCrit: 0.5,         // 3318_1: 提升50%暴击
  hatredDealt: -0.35,      //         降低35%伤害
  basicRatio: 125, fieldBasicRatio: 100, fieldBasicHits: 2, fieldLifesteal: 0.15,
  ultRatio: 80, ultHits: 3,
  lowHp: 0.5,              // 331_03 L5: 生命比例低于50%
  senkiMarks: 6, allyDeathMarks: 3, ultMarks: 3, basicMarks: 1,
});

export const MARK_ID = "3312_1";
export const HATRED_ID = "3318_1";
export const SEAL_ID = "331_field";
const SPD_ID = "331_field_spd";
const NOTE_MASKS = "hannya331:masks=";

const markDefOf = () => markDef({ id: MARK_ID, name: "仇恨印记", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】御怨般若的特殊机制，上限9层，每层自身提升10%效果抵抗和5%伤害减免。达到上限时解除自身所有控制效果并增加35%行动条（Global）。开启封印结界时无法获得。" }, StatusBook);
const hatredDef = () => markDef({ id: HATRED_ID, name: "仇恨蔓延", category: StatusCategory.DEBUFF_STATE, dispellable: true, removable: true, durationPolicy: "SOURCE_TURN",
  desc: "【减益、状态】提升50%暴击，降低35%伤害。" }, StatusBook);
const sealDef = () => markDef({ id: SEAL_ID, name: "封印结界", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  suppressPassive: true, suppressSoul: true,
  desc: "封印结界：被动技能视为受到压制、御魂效果视为受到封印（替换为仇鬼：暴击降低30%）。（betting: 结界关闭时移除）" }, StatusBook);
const spdDef = () => markDef({ id: SPD_ID, name: "封印结界·加速", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "结界中，御怨般若提升30点速度。" }, StatusBook);

export const isHannya331 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "331_02") && !!skillById(e, "331_01");
export const hatredMarks = (h: Entity): number => stacksOn(h, MARK_ID, h.id);
export const masksLeft = (h: Entity): number => Number(noteValue(h, NOTE_MASKS) ?? 0);
export const fieldOpen = (h: Entity): boolean => masksLeft(h) > 0;
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const hpRatio = (e: Entity): number => (e.maxHp > 0 ? e.hp / e.maxHp : 0);

function setMarks(h: Entity, n: number): number {
  return setStackedStatus(h, markDefOf(), n, HANNYA.markCap, h.id,
    [{ prop: "efr", value: HANNYA.markRes, mode: "FIXED" }, { prop: "dmgTakenD", value: -HANNYA.markCut, mode: "FIXED" }]);
}

/** Adds Hatred Marks (none while the field is open); reaching 9 clears controls and gives +35% bar. */
export function gainMarks(battle: any, h: Entity, n: number, reason: string): number {
  if (!h.alive || !(n > 0) || fieldOpen(h)) return hatredMarks(h);
  const before = hatredMarks(h);
  if (before >= HANNYA.markCap) return before;
  const after = setMarks(h, before + n);
  battle.trace.push({ t: "STATUS_APPLY", src: h.id, dst: h.id, status: MARK_ID, name: "仇恨印记", category: StatusCategory.COMMON_MARK, duration: PERSIST, ref: MARK_ID, known: true, stacks: after, threshold: HANNYA.markCap, reason, skill: "积重难返" });
  if (after >= HANNYA.markCap) {
    clearControls(battle, h, h, "仇恨印记");
    shiftBar(battle, h, HANNYA.fullBar, "仇恨印记");
  }
  return after;
}

// ───────────────────────── 封印结界 ─────────────────────────

function openField(battle: any, h: Entity): void {
  const before = hatredMarks(h);
  setMarks(h, 0);
  battle.trace.push({ t: "STACKS_CONSUMED", id: h.id, status: MARK_ID, name: "仇恨印记", from: before, to: 0, reason: "CAST_COST", skill: "积重难返" });
  setNote(h, NOTE_MASKS, HANNYA.masks);
  const sdef = spdDef();
  if (!h.hasStatus(SPD_ID)) h.addStatus(sdef, h.id, 1, PERSIST, [{ prop: "spd", value: HANNYA.fieldSpd, mode: "FIXED" }], 1);
  const def = sealDef();
  for (const v of aliveEnemies(battle, h)) {
    if (v.statuses.some(s => s.def.id === SEAL_ID && s.sourceId === h.id)) continue;
    const a = v.addStatus(def, h.id, 1, PERSIST, [{ prop: "cri", value: HANNYA.demonCrit, mode: "FIXED" }], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: h.id, dst: v.id, status: SEAL_ID, name: def.name, category: def.category, duration: PERSIST, ref: "tips_3312", known: true, tag: a.tag, skill: "积重难返" });
  }
  battle.trace.push({ t: "FIELD_OPEN", owner: h.id, name: "封印结界", masks: HANNYA.masks, skill: "积重难返" });
}

async function closeField(battle: any, h: Entity, reason: string): Promise<void> {
  setNote(h, NOTE_MASKS, null);
  const s = h.statuses.find(x => x.def.id === SPD_ID);
  if (s) h.expireStatus(s);
  for (const v of battle.enemiesOf(h.teamId) as Entity[]) {
    for (const st of [...v.statuses]) {
      if (st.def.id !== SEAL_ID || st.sourceId !== h.id || !v.expireStatus(st)) continue;
      battle.trace.push({ t: "STATUS_EXPIRE", id: v.id, status: SEAL_ID, reason: "FIELD_CLOSED" });
    }
  }
  battle.trace.push({ t: "FIELD_CLOSE", owner: h.id, name: "封印结界", reason });
  if (reason !== "MASKS_BROKEN" || !h.alive) return;
  const def = hatredDef();
  for (const v of aliveEnemies(battle, h)) {
    const contest = rollStatusContest(battle, h, v, def, 1, "status_prob:" + HATRED_ID + ":封印结界:" + v.id, "resist:" + HATRED_ID + ":封印结界:" + v.id);
    if (contest.outcome === "MISS") continue;
    if (contest.outcome === "RESIST") { await reportResist(battle, h, v, def, contest, { probability: 1, duration: 1, ref: HATRED_ID, skill: "积重难返" }); continue; }
    const imm = findImmuneStatus(v, def, battle.policies?.immune?.debuffCoversControl ?? true);
    if (imm) { battle.trace.push({ t: "IMMUNE", src: h.id, dst: v.id, status: def.id, name: def.name, by: imm.def.id, kind: imm.kind, consumed: imm.consumed, ref: HATRED_ID, skill: "积重难返" }); continue; }
    const a = v.addStatus(def, h.id, 1, 1, [{ prop: "cri", value: HANNYA.hatredCrit, mode: "FIXED" }, { prop: "dmgDealtB", value: HANNYA.hatredDealt, mode: "FIXED" }], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: h.id, dst: v.id, status: HATRED_ID, name: def.name, category: def.category, duration: 1, ref: HATRED_ID, known: true, tag: a.tag, skill: "积重难返" });
  }
}

// ───────────────────────── skills ─────────────────────────

type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };

/** Enemies with 仇恨蔓延 hit by the running cast (transient, per caster). */
const hatredHit = new WeakMap<object, Set<number>>();

async function hit(battle: any, self: Entity, v: Entity, ratio: number, id: string, hurt: Entity[], lifesteal: { ratio: number } | null): Promise<void> {
  await battle.withinResolution({ id, type: "HIT" }, async () => {
    if (!v.alive) return;
    if (!hurt.includes(v)) hurt.push(v);
    if (v.hasStatus(HATRED_ID)) (hatredHit.get(self) ?? hatredHit.set(self, new Set()).get(self)!).add(v.id);
    await battle.damage(self, v, self.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, lifesteal);
  });
}

/** Damage hooks for 331_01 (barrier branch) and 331_03 (segments, barrier extra hit, L5). */
export function hannyaDamageHook(x: any): Hook | null {
  if (x?.id === "331_01") return {
    kind: "HANNYA_BASIC",
    run: async (battle, self, hurt, primary) => {
      const t = primary?.alive && primary.teamId !== self.teamId ? primary : aliveEnemies(battle, self)[0];
      if (!t) return;
      if (!fieldOpen(self)) { await hit(battle, self, t, HANNYA.basicRatio, "HIT:" + x.name + "#1", hurt, null); return; }
      for (let i = 0; i < HANNYA.fieldBasicHits; i++) {
        await hit(battle, self, t, HANNYA.fieldBasicRatio, "HIT:" + x.name + "#" + (i + 1), hurt, { ratio: HANNYA.fieldLifesteal });
      }
    },
  };
  if (x?.id === "331_03") return {
    kind: "HANNYA_ULT",
    run: async (battle, self, hurt, primary) => {
      const t = primary?.alive && primary.teamId !== self.teamId ? primary : aliveEnemies(battle, self)[0];
      for (let i = 0; i < HANNYA.ultHits && t; i++) await hit(battle, self, t, HANNYA.ultRatio, "HIT:" + x.name + "#1." + (i + 1), hurt, null);
      const waves = fieldOpen(self) ? 2 : 1;
      for (let w = 0; w < waves; w++) {
        for (const v of aliveEnemies(battle, self)) await hit(battle, self, v, HANNYA.ultRatio, "HIT:" + x.name + "#2." + (w + 1), hurt, null);
      }
      const low = (battle.teams[self.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m) && hpRatio(m) < HANNYA.lowHp).length;
      for (let i = 0; i < low; i++) {
        const pool = aliveEnemies(battle, self);
        if (!pool.length) break;
        battle.rng.expect("hannya331_l5#" + (i + 1));
        const v = battle.rng.pick(pool) ?? pool[0];
        await hit(battle, self, v, HANNYA.ultRatio, "HIT:" + x.name + "#3." + (i + 1), hurt, null);
      }
    },
  };
  return null;
}

/** 积重难返 needs 9 marks and a closed field. */
export function hannyaGate(self: Entity, sk: any): string | null {
  if (sk?.ir?.id !== "331_02") return null;
  if (fieldOpen(self)) return "FIELD_OPEN";
  return hatredMarks(self) >= HANNYA.markCap ? null : "NEEDS_9_MARKS";
}

/** KB AI: 积重难返 first, else 予愿必还, else 恨返. */
export function hannyaRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isHannya331(self)) return null;
  const canPay = (sk: any) => { const c = costOf(sk); return !(c > 0) || battle.teams[self.teamId].orbs.canPay(c); };
  const field = skillById(self, "331_02");
  if (field && !hannyaGate(self, field) && canPay(field)) return { skill: field, rule: "御怨般若: 仇恨印记满9层 → 积重难返 (KB AI)" };
  const ult = skillById(self, "331_03");
  if (ult && canPay(ult)) return { skill: ult, rule: "御怨般若: 积重难返不可用 → 予愿必还 (KB AI)" };
  const basic = skillById(self, "331_01");
  return basic ? { skill: basic, rule: "御怨般若: 鬼火不足 → 恨返" } : null;
}

/** 予愿必还 targets the enemy with the lowest HP ratio (KB). */
export function hannyaTarget(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || x?.id !== "331_03" || !cands.length || cands.some(c => c.teamId === self.teamId)) return null;
  const target = cands.reduce((a, b) => (hpRatio(b) < hpRatio(a) ? b : a), cands[0]);
  return { target, rule: "御怨般若: 予愿必还优先选择血量百分比最低的敌方单位 (KB)" };
}

export function hannyaAfterCast(battle: any, self: Entity, x: any): boolean {
  if (!["331_01", "331_02", "331_03"].includes(x?.id)) return false;
  if (x.id === "331_02") { openField(battle, self); return true; }
  const hated = hatredHit.get(self)?.size ?? 0;
  hatredHit.delete(self);
  gainMarks(battle, self, x.id === "331_03" ? HANNYA.ultMarks : HANNYA.basicMarks, "CAST");
  if (hated > 0) gainMarks(battle, self, hated, "HATRED_TARGETS");
  return true;
}

/** IR patches (MAX): marks, the field and the branches are run by betting-hannya.ts. */
export const HANNYA_PATCHES = Object.freeze({
  "331_01": { note: "恨返: +1 仇恨印记 is granted by betting-hannya.ts (no gain while the field is open)", patch: { statusRefConditionOnly: [0] } },
  "331_02": { note: "积重难返: cost (9 marks), 封印结界 and 仇恨蔓延 are run by betting-hannya.ts", patch: { statusRefConditionOnly: [0, 1, 2, 3, 4] } },
  "331_03": { note: "予愿必还: +3 仇恨印记 is granted by betting-hannya.ts", patch: { statusRefConditionOnly: [0] } },
});

export function installHannya(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const h of entities.filter(isHannya331)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:331:" + code + ":" + h.id, h.id, code, fn, range);
    reg(EV.BATTLE_START, () => { if (hatredMarks(h) === 0 && !fieldOpen(h)) gainMarks(battle, h, HANNYA.senkiMarks, "SENKI"); }, "SELF");
    // Enemy crit: +1 (100% at L4), once per enemy action.
    reg(EV.AFTER_DAMAGE, (ctx: any) => {
      const src: Entity | undefined = ctx?.input?.source;
      if (!src || src.teamId === h.teamId || !ctx?.result?.isCrit) return;
      const key = battle.turn + ":" + src.id;
      if (noteValue(h, "hannya331:crit=") === key) return;
      setNote(h, "hannya331:crit=", key);
      gainMarks(battle, h, 1, "ENEMY_CRIT");
    });
    reg(EV.DEATH, async (ctx: any) => {
      const v: Entity | undefined = ctx?.target;
      if (!v || v.alive) return;
      if (v.id === h.id) { if (fieldOpen(h)) await closeField(battle, h, "OWNER_DEFEATED"); return; }
      if (v.teamId === h.teamId && !isSummonUnit(v)) gainMarks(battle, h, HANNYA.allyDeathMarks, "ALLY_DEFEATED");
    });
    reg(EV.TURN_END, async (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || a.teamId === h.teamId || isSummonUnit(a) || !fieldOpen(h)) return;
      const left = masksLeft(h) - 1;
      battle.trace.push({ t: "FIELD_MASK", owner: h.id, by: a.id, left: Math.max(0, left), name: "封印结界" });
      if (left > 0) { setNote(h, NOTE_MASKS, left); return; }
      await closeField(battle, h, "MASKS_BROKEN");
    });
    out.push({ entityId: h.id, mechanic: "仇恨印记 · 封印结界 (压制/封印/仇鬼) · 仇恨蔓延 · 恨返/予愿必还 branches" });
  }
  return out;
}
