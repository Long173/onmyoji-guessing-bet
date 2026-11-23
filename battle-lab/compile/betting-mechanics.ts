// compile/betting-mechanics.ts — shikigami mechanics confirmed in game, active ONLY in MAX skill-level mode.
//
// Why a separate module: the regression suite runs in BASE mode and pins state fingerprints, so every
// rule here is behind `bettingMechanicsActive()` (skillLevelMode() === "MAX", set by matches/*.ts and the
// web worker). Hook points:
//   · compile/skill-overrides.ts  → BETTING_IR_PATCHES (status slots that are conditions / costs, not gains)
//   · compile/character.ts        → bettingDamageHook (replaces the generic damage loop),
//                                   bettingAfterCast (runs at the end of an active cast),
//                                   bettingGate / bettingPreferredSkill / resolveRuleSkill (AI skill choice)
//   · compile/subscribers.ts      → installBettingSubscribers (turn-end counters)
//
// Rules (KB text = data/kb/shikigami.json; user = in-game observation on the Global server):
//   金鱼姬 282   · AI "3技能" resolves by skill id suffix (_03 = 金鱼·助阵), never to the passive 282_02.
//                · 金鱼·助阵 summons the Goldfish (HP 66% at max level, ATK/SPD/effect RES 100%); it is not
//                  cast while a Goldfish (or any slot-occupying summon) is alive.
//                · 金鱼·反击 / 鱼之怒: while the Goldfish lives, every 8 non-summon enemy turns it deals 120% ATK
//                  to all enemies, 25% silence (1 turn), and at max level 50% to push back 30% action bar.
//                · 扇舞: with the Goldfish alive, heals it 10% of its max HP and it gains 1 stack of 扇舞
//                  (+20% ATK per stack, max 5).
//   饭笥 370     · 储备粮 stacks persist (cap 10, +10% ATK and +5% crit damage per stack).
//                · +1 stack after every non-summon ally turn (self included) unless she cannot act;
//                  with 食欲大增 also after non-summon enemy turns. 蓄食待发 grants 2 stacks + 食欲大增.
//                · 胃口大开 unlocks at 6 stacks: 150% (L5) to the highest-HP enemy, 8 × 33% to independent
//                  random enemies, then consumes 4 stacks.
//                · 10 stacks (user screenshot; not in KB): free immediate cast; if she is controlled,
//                  5 stacks are spent first to cleanse all control. 180% to the highest-HP enemy, 40% of that
//                  damage as TRUE damage split evenly among the other enemies, 9 × 33% random, consume all.
//   鲸汐千姬 562 / 云外镜 344 · see compile/betting-senhime.ts and compile/betting-ungaikyo.ts (rules in their headers).
//   犬神 220 · see compile/betting-inugami.ts; AI of 犬神 / 虫师 306 / 赤影妖刀姬 328 and 虫之护: compile/betting-ai-rules.ts.
//   迦楼罗 378 / 心狩鬼女红叶 388 / 御怨般若 331 / 入内雀 365 · see compile/betting-garuda.ts, betting-momiji.ts,
//                betting-hannya.ts, betting-nyunai.ts (bar-increase reactions: compile/betting-bar.ts).
//   夜刀神 373 / 流光追月神 395 / 小鹿男 259 / 神无月 596 · see compile/betting-yato.ts, betting-oitsuki.ts,
//                betting-shishio.ts, betting-kannazuki.ts.
//   追月神 295 / 童女 213 · see compile/betting-oitsuki295.ts, betting-doujo.ts (match-5 replay review).
//   封阳君 575 / 铃彦姬 376 / 麓铭大岳丸 355 / 因幡辉夜姬 372 / 蝴蝶精 241 + 蜜桃&芥子 310 / 黑童子 277 / 入殓师 321 ·
//                see compile/betting-fengyang.ts, betting-suzuhiko.ts, betting-otakemaru.ts, betting-inaba.ts,
//                betting-chocho.ts, betting-kuro.ts, betting-okuribito.ts (match 6).
//   随机多段      · "攻击N次，每次对随机敌方目标造成…" (339_03 / 263_03 / 313_03): every hit picks a random
//                  living enemy independently. 339_03 also applies its repeat-hit decay (additive, 15% at max).
import type { Entity } from "../kernel/entity.ts";
import { EntityType } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, CONTROL_EFFECTS, isActionPrevented, findImmuneStatus } from "../kernel/status.ts";
import type { StatusDef } from "../kernel/status.ts";
import { skillLevelMode } from "./max-level.ts";
// 鲸汐千姬 562 / 云外镜 344 (MAX only): illusion, whales, 海凝, ice-sleep; Yin/Yang form, skill-table swap.
import { senhimeGate, senhimeAfterCast, installSenhime, bettingCostOf as senhimeCostOf } from "./betting-senhime.ts";
import { ungaikyoGate, ungaikyoDamageHook, installUngaikyo, syncSkillTable } from "./betting-ungaikyo.ts";
// 犬神 220 / 虫师 306 / 赤影妖刀姬 328 (MAX only): 守护印记 counters, 心剑乱舞, AI rules, 虫之护.
import { installInugami, swordDanceHook } from "./betting-inugami.ts";
import { aiRuleSkill, mushishiWard, MUSHISHI_PATCH } from "./betting-ai-rules.ts";
// 妖刀姬·绯夜猎刃 593 (Global "Yoto Hime, Scarlet Nightedge") / 虫师 306 passive (MAX only).
import { installYoto, huntHook, afterTwilight, YOTO_IR_PATCHES } from "./betting-yoto.ts";
import { installMushishi } from "./betting-mushishi.ts";
import { rollStatusContest, reportResist } from "../kernel/resist.ts";
import { aiRuleTarget as aiRuleTargetBase } from "./betting-ai-rules.ts";
// 辉夜姬 280 / 绘世花鸟卷 367 / 食灵 369 / 炼狱茨木童子 322 (MAX only): support kits (see each module header).
import { KAGUYA_PATCHES, kaguyaCost, kaguyaRuleSkill, kaguyaAfterCast, installKaguya } from "./betting-kaguya.ts";
import { HANA_PATCHES, hanaCost, hanaRuleSkill, hanaAfterCast, installHana } from "./betting-hana.ts";
import { SHOKUREI_PATCHES, shokureiRuleSkill, shokureiTarget, shokureiAfterCast, installShokurei } from "./betting-shokurei.ts";
import { installIbaraki } from "./betting-ibaraki.ts";
import { installVampira } from "./betting-vampira.ts";
import { installTurnTracker } from "./betting-scope.ts";
// 迦楼罗 378 / 心狩鬼女红叶 388 / 御怨般若 331 / 入内雀 365 (MAX only): match-5 kits (see each module header).
import { GARUDA_PATCHES, garudaAfterCast, installGaruda } from "./betting-garuda.ts";
import { MOMIJI_PATCHES, momijiRuleSkill, momijiGate, momijiAfterCast, leafBladeHook, installMomiji } from "./betting-momiji.ts";
import { HANNYA_PATCHES, hannyaRuleSkill, hannyaGate, hannyaTarget, hannyaDamageHook, hannyaAfterCast, installHannya } from "./betting-hannya.ts";
import { NYUNAI_PATCHES, nyunaiRuleSkill, nyunaiGate, nyunaiTarget, peckHook, nyunaiAfterCast, installNyunai } from "./betting-nyunai.ts";
// 夜刀神 373 / 流光追月神 395 / 小鹿男 259 (MAX only): match-4 replay kits (see each module header).
import { YATO_PATCHES, yatoAfterCast, installYato } from "./betting-yato.ts";
import { OITSUKI_PATCHES, oitsukiAfterCast, installOitsuki } from "./betting-oitsuki.ts";
import { SHISHIO_PATCHES, shishioRuleSkill, antlerHook, installShishio } from "./betting-shishio.ts";
import { dreamCost, dreamAfterCast, kannazukiAfterCast, installKannazuki } from "./betting-kannazuki.ts";
// 封阳君 575 / 铃彦姬 376 / 麓铭大岳丸 355 / 因幡辉夜姬 372 / 蝴蝶精 241 · 黑童子 277 / 入殓师 321 / 蜜桃&芥子 310 (match 6).
import { FENGYANG_PATCHES, fengyangCost, fengyangDamageHook, fengyangAfterCast, fengyangRuleSkill, fengyangGate, installFengyang } from "./betting-fengyang.ts";
import { SUZU_PATCHES, suzuDamageHook, suzuAfterCast, suzuRuleSkill, installSuzu } from "./betting-suzuhiko.ts";
import { OTAKE_PATCHES, otakeCost, otakeDamageHook, otakeAfterCast, otakeRuleSkill, installOtake } from "./betting-otakemaru.ts";
import { INABA_PATCHES, inabaCost, inabaDamageHook, inabaAfterCast, inabaRuleSkill, inabaTarget, installInaba } from "./betting-inaba.ts";
import { chochoCost, installChocho } from "./betting-chocho.ts";
import { KURO_PATCHES, kuroDamageHook, installKuro } from "./betting-kuro.ts";
import { OKURI_PATCHES, okuriDamageHook, okuriAfterCast, okuriRuleSkill, okuriGate, installOkuri } from "./betting-okuribito.ts";
// 追月神 295 / 童女 213 (MAX only): match-5 replay review (see each module header).
import { OITSUKI295_PATCHES, oitsuki295Cost, oitsuki295AfterCast, installOitsuki295 } from "./betting-oitsuki295.ts";
import { DOUJO_PATCHES, doujoAfterCast } from "./betting-doujo.ts";
// Match 7: 薰 298 / 遥念烟烟罗 572 / 纺愿缘结神 554 / 雪御前 591 / 万年竹 275 / 花鸟卷 279 / 鬼王酒吞童子 341 (see betting-m7.ts).
import { M7_PATCHES, m7Cost, m7DamageHook, m7AfterCast, m7RuleSkill, m7Gate, m7Target, installM7 } from "./betting-m7.ts";

/** Effective onibi cost (MAX): 鲸汐千姬 / 犬神 discounts, then 花鸟卷 (繁花坠露 0) and 辉夜姬's illusion rules. */
export function bettingCostOf(battle: any, self: Entity, sk: any): number {
  const base = senhimeCostOf(battle, self, sk);
  if (!bettingMechanicsActive()) return base;
  const m6 = m7Cost(battle, self, sk, chochoCost(self, sk, otakeCost(self, sk, inabaCost(self, sk, fengyangCost(self, sk, base)))));
  return oitsuki295Cost(battle, self, sk, kaguyaCost(battle, self, sk, dreamCost(self, sk, hanaCost(battle, self, sk, m6))));
}

/** Target override (MAX): 食灵's meal target, then the 犬神 / 虫师 / 赤影妖刀姬 rules. */
export function aiRuleTarget(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  return m7Target(self, x, cands) ?? shokureiTarget(self, x, cands) ?? inabaTarget(self, x, cands) ?? hannyaTarget(self, x, cands) ?? nyunaiTarget(self, x, cands) ?? aiRuleTargetBase(self, x, cands);
}

export const bettingMechanicsActive = (): boolean => skillLevelMode() === "MAX";

/** Statuses that live until consumed (no turn count). */
const PERSIST = 99999;

// ───────────────────────── IR patches (MAX only, applied by applySkillOverrides) ─────────────────────────

export const BETTING_IR_PATCHES: Readonly<Record<string, { note: string; patch: Record<string, unknown> }>> = Object.freeze({
  "282_01": {
    note: "扇舞: [buff_2821_1] belongs to the Goldfish (handled by bettingAfterCast), not to Kingyo",
    patch: { statusRefConditionOnly: [0] },
  },
  "370_02": {
    note: "蓄食待发: slot 0 is the turn-end gain rule; 储备粮 / 食欲大增 on cast are handled by bettingAfterCast",
    patch: { statusRefConditionOnly: [0, 1, 2] },
  },
  "370_03": {
    note: "胃口大开: '达到6层时解锁' is the unlock condition and '消耗4层' a cost (bettingDamageHook), not gains",
    patch: { statusRefConditionOnly: [0, 1] },
  },
  "306_03": MUSHISHI_PATCH,
  ...YOTO_IR_PATCHES,
  "562_03": {
    note: "鲸息洄梦: the illusion (own-turn duration, cost -1, 海凝, recast whale) is run by betting-senhime.ts; [buff_5622_1] is stored by it, not applied on cast",
    patch: { field: null, statusRefConditionOnly: [0] },
  },
  ...KAGUYA_PATCHES,
  ...HANA_PATCHES,
  ...SHOKUREI_PATCHES,
  ...GARUDA_PATCHES,
  ...MOMIJI_PATCHES,
  ...HANNYA_PATCHES,
  ...NYUNAI_PATCHES,
  ...YATO_PATCHES,
  ...OITSUKI_PATCHES,
  ...SHISHIO_PATCHES,
  ...FENGYANG_PATCHES,
  ...SUZU_PATCHES,
  ...OTAKE_PATCHES,
  ...INABA_PATCHES,
  ...KURO_PATCHES,
  ...OKURI_PATCHES,
  ...OITSUKI295_PATCHES,
  ...DOUJO_PATCHES,
  ...M7_PATCHES,
});

// ───────────────────────── stack helpers ─────────────────────────

interface StackSpec {
  id: string; name: string; cap: number;
  category: StatusCategory;
  durationPolicy: StatusDef["durationPolicy"];
  perStack: Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE" }>;
  dispellable: boolean;
}

const FOOD: StackSpec = {
  id: "3702_1", name: "储备粮", cap: 10, category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  perStack: [{ prop: "atk", value: 0.1, mode: "ADD_RATE" }, { prop: "crid", value: 0.05, mode: "FIXED" }],
  dispellable: false,
};
const FAN: StackSpec = {
  id: "2821_1", name: "扇舞", cap: 5, category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  perStack: [{ prop: "atk", value: 0.2, mode: "ADD_RATE" }], dispellable: false,
};
const RAGE_COUNTER: StackSpec = {
  id: "282_rage_counter", name: "鱼之怒·计数", cap: 8, category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  perStack: [], dispellable: false,
};
const APPETITE: StackSpec = {
  id: "3704_1", name: "食欲大增", cap: 1, category: StatusCategory.BUFF_MARK, durationPolicy: "SOURCE_TURN",
  perStack: [], dispellable: true,
};
const APPETITE_ID = APPETITE.id;

function defOf(spec: StackSpec): StatusDef {
  const known = StatusBook.get(spec.id);
  if (known && known.durationPolicy === spec.durationPolicy && known.dispellable === spec.dispellable) return known;
  const def: StatusDef = {
    id: spec.id, name: spec.name, category: spec.category,
    dispellable: spec.dispellable, removable: spec.dispellable,
    preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false,
    durationPolicy: spec.durationPolicy, desc: "betting-mechanics: " + spec.name,
  };
  StatusBook.set(spec.id, def);
  return def;
}

export function stacksOf(e: Entity, id: string): number {
  return e.statuses.find(s => s.def.id === id)?.stacks ?? 0;
}
export const foodStacks = (e: Entity): number => stacksOf(e, FOOD.id);

/** Set the stack count in place; per-stack effects are rebuilt so the numbers always match the count. */
function setStacks(battle: any, e: Entity, spec: StackSpec, n: number, src: number): void {
  const next = Math.max(0, Math.min(spec.cap, n));
  const st = e.statuses.find(s => s.def.id === spec.id);
  const effects = spec.perStack.map(p => ({ prop: p.prop, value: p.value * next, mode: p.mode }));
  if (next === 0) {
    if (st) e.expireStatus(st);
    return;
  }
  if (!st) {
    e.addStatus(defOf(spec), src, next, PERSIST, effects, spec.cap);
    return;
  }
  const tags = new Set(st.effects.map(x => x.tag));
  e.effects = e.effects.filter(x => !tags.has(x.source));
  st.effects = [];
  effects.forEach((ef, i) => {
    const tag = st.tag + ":" + i;
    st.effects.push({ ...ef, tag });
    e.effects.push({ ...ef, source: tag });
  });
  st.stacks = next;
  st.remaining = PERSIST;
}

function traceStacks(battle: any, e: Entity, spec: StackSpec, before: number, after: number, reason: string, skill: string): void {
  if (after > before) {
    battle.trace.push({
      t: "STATUS_APPLY", src: e.id, dst: e.id, status: spec.id, name: spec.name, category: spec.category,
      duration: PERSIST, ref: spec.id, known: true, stacks: after, threshold: spec.cap, reason, skill,
    });
  } else if (after < before) {
    battle.trace.push({ t: "STACKS_CONSUMED", id: e.id, status: spec.id, name: spec.name, from: before, to: after, reason, skill });
    if (after === 0) {
      battle.queueEvent(EV.STATUS_EXPIRE, { battle, entity: e, status: spec.id, name: spec.name, reason: "CONSUMED" }, e.id, e.teamId);
    }
  }
}

function changeStacks(battle: any, e: Entity, spec: StackSpec, delta: number, reason: string, skill: string, src = e.id): number {
  const before = stacksOf(e, spec.id);
  setStacks(battle, e, spec, before + delta, src);
  const after = stacksOf(e, spec.id);
  traceStacks(battle, e, spec, before, after, reason, skill);
  return after;
}

const isSummonUnit = (e: any): boolean => e?.type === EntityType.SUMMON || e?.type === EntityType.SPECIAL_SUMMON;
const skillById = (e: Entity, id: string): any => (e.skills ?? []).find((s: any) => s?.ir?.id === id) ?? null;
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((x: Entity) => x.alive);
const highestHp = (list: Entity[]): Entity | null => list.reduce<Entity | null>((a, b) => (!a || b.hp > a.hp ? b : a), null);

// ───────────────────────── AI skill choice ─────────────────────────

/** "N技能" resolves to the skill whose id ends with `_0N` (KB arrays are not always in id order). */
export function resolveRuleSkill(self: Entity, ref: { index: number | null; raw: string }): any {
  const m = String(ref.raw ?? "").match(/([1-4])\s*技能/);
  if (m) {
    const bySuffix = (self.skills ?? []).find((s: any) => String(s?.ir?.id ?? "").endsWith("_0" + m[1]));
    if (bySuffix) return bySuffix;
  }
  return ref.index === null ? undefined : self.skills[ref.index];
}

const GOLDFISH_TIPS = "282_goldfish";
/** Our own ownership note (notes are saved with the state, so the link survives a restore). */
const GOLDFISH_NOTE = "goldfish:owner=";
export function goldfishOf(battle: any, owner: Entity): Entity | null {
  const team = battle.teams[owner.teamId];
  return (team?.summons ?? []).find((s: Entity) => s.alive && s.notes.includes(GOLDFISH_NOTE + owner.id)) ?? null;
}
function summonSlotBusy(battle: any, owner: Entity): boolean {
  const team = battle.teams[owner.teamId];
  const occupied = (team?.summons ?? []).filter((s: Entity) => s.alive && s.caps.occupiesSummonSlot).length;
  return occupied >= (team?.summonSlots ?? 1);
}

/** Why a skill cannot be chosen right now (null = allowed). */
export function bettingGate(battle: any, self: Entity, sk: any): string | null {
  if (!sk) return null;
  if (Number(sk.cost) < 0) return "PASSIVE_NOT_CASTABLE";
  const id = sk.ir?.id;
  if (id === "282_03" && (goldfishOf(battle, self) || summonSlotBusy(battle, self))) return "SUMMON_PRESENT";
  if (id === "370_03" && foodStacks(self) < 6) return "LOCKED_BELOW_6_STACKS";
  return senhimeGate(sk) ?? ungaikyoGate(sk) ?? momijiGate(self, sk) ?? hannyaGate(self, sk) ?? nyunaiGate(battle, self, sk)
    ?? fengyangGate(sk) ?? okuriGate(self, sk) ?? m7Gate(battle, self, sk);
}

/** Rules that take precedence over the KB cast list. */
export function bettingPreferredSkill(battle: any, self: Entity): { skill: any; rule: string } | null {
  syncSkillTable(self, battle);   // 云外镜: per-entity skill table of the current form (idempotent)
  const feast = skillById(self, "370_03");
  if (feast && foodStacks(self) >= 6 && battle.teams[self.teamId].orbs.canPay(bettingCostOf(battle, self, feast))) {
    return { skill: feast, rule: "储备粮≥6 → 胃口大开" };
  }
  const costOf = (sk: any) => bettingCostOf(battle, self, sk);
  return kaguyaRuleSkill(battle, self, costOf) ?? hanaRuleSkill(battle, self, costOf) ?? shokureiRuleSkill(battle, self, costOf)
    ?? momijiRuleSkill(battle, self, costOf) ?? hannyaRuleSkill(battle, self, costOf) ?? nyunaiRuleSkill(battle, self, costOf)
    ?? shishioRuleSkill(battle, self, costOf) ?? fengyangRuleSkill(battle, self, costOf) ?? suzuRuleSkill(battle, self)
    ?? otakeRuleSkill(battle, self, costOf) ?? inabaRuleSkill(battle, self, costOf) ?? okuriRuleSkill(battle, self, costOf)
    ?? m7RuleSkill(battle, self, costOf) ?? aiRuleSkill(battle, self, costOf);
}

// ───────────────────────── damage hooks ─────────────────────────

export interface BettingDamage { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> }

const PER_HIT_RANDOM = /攻击\d+次，每次对随机敌方目标造成/;
const DECAY = /重复攻击同一目标时，伤害依次递减(\d+(?:\.\d+)?)%/;
const DECAY_MAX = /递减百分比降低至(\d+(?:\.\d+)?)%/;

function sentencesOf(x: any): string[] { return (x.sentences ?? []).map((s: any) => String(s.text ?? "")); }

/** Repeat-hit decay per extra hit on the same target (0.15 = 15%), or null when the text has none. */
export function repeatDecayOf(x: any): number | null {
  const base = sentencesOf(x).map(t => t.match(DECAY)).find(Boolean);
  if (!base) return null;
  let pct = Number(base[1]);
  for (const l of [...(x.levelScale ?? [])].sort((a: any, b: any) => a.level - b.level)) {
    const m = String(l.effect ?? "").match(DECAY_MAX);
    if (m) pct = Number(m[1]);
  }
  return pct / 100;
}

async function hitRandom(battle: any, self: Entity, skillName: string, hitNo: number, base: number, type: any,
                         hurt: Entity[], lifesteal: any, mulOf?: (v: Entity) => number): Promise<void> {
  await battle.withinResolution({ id: "HIT:" + skillName + "#" + hitNo, type: "HIT" }, async () => {
    const pool = aliveEnemies(battle, self);
    if (!pool.length) return;
    battle.rng.expect("hit_target:" + skillName + "#" + hitNo);
    const victim: Entity = battle.rng.pick(pool);
    if (!hurt.includes(victim)) hurt.push(victim);
    const mul = mulOf ? mulOf(victim) : 1;
    if (mul <= 0) {
      battle.trace.push({ t: "HIT_DECAYED_OUT", src: self.id, dst: victim.id, skill: skillName, hit: hitNo });
      return;
    }
    await battle.damage(self, victim, base, type, mul, lifesteal ?? null);
  });
}

function perHitRandom(x: any): BettingDamage {
  const d = x.damage[0];
  const decay = repeatDecayOf(x);
  return {
    kind: "PER_HIT_RANDOM",
    run: async (battle, self, hurt) => {
      const seen = new Map<number, number>();
      for (let h = 0; h < Math.max(1, x.hits); h++) {
        const base = self.prop("atk") * ((d.ratioMax ?? d.ratio) / 100);
        await hitRandom(battle, self, x.name, h + 1, base, d.type, hurt, x.lifesteal, (v) => {
          const n = seen.get(v.id) ?? 0;
          seen.set(v.id, n + 1);
          return decay === null ? 1 : Math.max(0, 1 - decay * n);
        });
      }
    },
  };
}

/** 10-stack form numbers (user screenshot of the max-level Global text; not present in the KB). */
export const FEAST_FULL = Object.freeze({ firstRatio: 180, splitTrueRatio: 0.4, randomHits: 9, cleanseCost: 5 });
const FEAST_COST = 4;

/** Units currently resolving the free 10-stack cast (transient; never outlives one pseudo-turn). */
const fullFeast = new WeakMap<object, Set<number>>();

function feast(x: any): BettingDamage {
  return {
    kind: "FEAST",
    run: async (battle, self, hurt) => {
      const full = fullFeast.get(battle)?.has(self.id) === true || foodStacks(self) >= FOOD.cap;
      const segs: any[] = Array.isArray(x.damageSegments) ? x.damageSegments : [];
      const firstRatio = full ? FEAST_FULL.firstRatio : Number(segs[0]?.ratio ?? x.damage[0]?.ratioMax ?? x.damage[0]?.ratio ?? 100);
      const hitRatio = Number(segs[1]?.ratio ?? x.damage[1]?.ratio ?? 33);
      const hits = full ? FEAST_FULL.randomHits : Number(segs[1]?.hits ?? x.hits ?? 8);
      const primary = highestHp(aliveEnemies(battle, self));
      if (primary) {
        hurt.push(primary);
        let dealt = 0;
        await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
          const r = await battle.damage(self, primary, self.prop("atk") * (firstRatio / 100), DamageType.NORMAL, 1, x.lifesteal ?? null);
          dealt = Number(r?.final ?? 0);
        });
        if (full && dealt > 0) {
          const others = aliveEnemies(battle, self).filter(v => v.id !== primary.id);
          if (others.length) {
            const each = dealt * FEAST_FULL.splitTrueRatio / others.length;
            await battle.withinResolution({ id: "HIT:" + x.name + "#split", type: "HIT" }, async () => {
              for (const v of others) {
                if (!v.alive) continue;
                if (!hurt.includes(v)) hurt.push(v);
                await battle.damage(self, v, each, DamageType.TRUE, 1, null);
              }
            });
          }
        }
      }
      const base = () => self.prop("atk") * (hitRatio / 100);
      for (let h = 0; h < hits; h++) await hitRandom(battle, self, x.name, h + 2, base(), DamageType.NORMAL, hurt, x.lifesteal);
      const before = foodStacks(self);
      changeStacks(battle, self, FOOD, full ? -before : -FEAST_COST, full ? "FULL_FORM_CONSUME_ALL" : "CAST_COST", x.name);
    },
  };
}

/** Replacement for the generic damage loop, or null (generic path). Callers check MAX mode first. */
export function bettingDamageHook(x: any, mode: string): BettingDamage | null {
  if (!x || !Array.isArray(x.damage) || !x.damage.length) return null;
  if (x.id === "370_03") return feast(x);
  const hunt = huntHook(x);
  if (hunt) return hunt;
  const dance = swordDanceHook(x);
  if (dance) return dance;
  const yin = ungaikyoDamageHook(x);
  if (yin) return yin;
  const m5 = leafBladeHook(x) ?? hannyaDamageHook(x) ?? peckHook(x) ?? antlerHook(x);
  if (m5) return m5;
  const m6 = fengyangDamageHook(x) ?? suzuDamageHook(x) ?? otakeDamageHook(x) ?? inabaDamageHook(x) ?? kuroDamageHook(x) ?? okuriDamageHook(x) ?? m7DamageHook(x);
  if (m6) return m6;
  const segs = Array.isArray(x.damageSegments) && x.damageSegments.length >= 2;
  if (mode === "ENEMY_RANDOM" && !segs && x.hits > 1 && x.damage.length === 1
      && sentencesOf(x).some(t => PER_HIT_RANDOM.test(t)) && !sentencesOf(x).some(t => /优先攻击未攻击过/.test(t))) {
    return perHitRandom(x);
  }
  return null;
}

// ───────────────────────── after-cast hooks ─────────────────────────

function summonGoldfish(battle: any, owner: Entity, x: any): void {
  const text = sentencesOf(x).join("。");
  let hpPct = Number(text.match(/继承金鱼姬(\d+(?:\.\d+)?)%生命值/)?.[1] ?? 48);
  for (const l of [...(x.levelScale ?? [])].sort((a: any, b: any) => a.level - b.level)) {
    const m = String(l.effect ?? "").match(/生命继承增至(\d+(?:\.\d+)?)%/);
    if (m) hpPct = Number(m[1]);
  }
  const spec: any = {
    tipsId: GOLDFISH_TIPS, name: "金鱼", hp: { prop: "hp", ratio: hpPct / 100 }, inheritInitialStats: false,
    noAction: true, suppressSoul: false, suppressPassive: false, immuneTo: [],
    inherit: [{ prop: "atk", ratio: 1 }], spdBonus: 0,
    evidence: "金鱼继承金鱼姬" + hpPct + "%生命值，100%攻击，100%速度，100%效果抵抗",
  };
  const g = battle.addSummon(owner, spec, { hasSkills: false });
  if (!g) return;
  g.base.efr = owner.base.efr ?? 0;
  g.notes.push(GOLDFISH_NOTE + owner.id);
}

async function fanDance(battle: any, owner: Entity): Promise<void> {
  const g = goldfishOf(battle, owner);
  if (!g) return;
  await battle.heal(owner, g, g.maxHp * 0.1, { crit: false });
  changeStacks(battle, g, FAN, 1, "FAN_DANCE", "扇舞", owner.id);
}

async function stockUp(battle: any, self: Entity): Promise<void> {
  const def = defOf(APPETITE);
  // "持续1回合" from the cast through her next turn (SOURCE_TURN ticks once at the end of the casting turn).
  self.addStatus(def, self.id, 1, 2, [], null);
  battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: self.id, status: APPETITE_ID, name: "食欲大增", category: def.category, duration: 2, ref: APPETITE_ID, known: true, skill: "蓄食待发" });
  await gainFood(battle, self, 2, "CAST");
}

/** Runs at the end of an active cast (MAX mode only). */
export async function bettingAfterCast(battle: any, self: Entity, x: any): Promise<void> {
  dreamAfterCast(battle, self, x);   // 入梦: any onibi skill of the bearer consumes 1 stack
  if (x?.id === "282_03") summonGoldfish(battle, self, x);
  else if (x?.id === "282_01") await fanDance(battle, self);
  else if (x?.id === "370_02") await stockUp(battle, self);
  else if (x?.id === "306_03") await mushishiWard(battle, self, x);
  else if (x?.id === "593_02") afterTwilight(battle, self);
  else if (x?.id === "280_01" || x?.id === "280_03") kaguyaAfterCast(battle, self, x);
  else if (x?.id === "367_03") await hanaAfterCast(battle, self, x);
  else if (x?.id === "369_03") shokureiAfterCast(battle, self, x);
  else if (x?.id === "373_01" || x?.id === "373_03") await yatoAfterCast(battle, self, x);
  else if (oitsukiAfterCast(battle, self, x) || kannazukiAfterCast(battle, self, x)) return;
  else if (await fengyangAfterCast(battle, self, x) || await suzuAfterCast(battle, self, x) || otakeAfterCast(battle, self, x)
    || await inabaAfterCast(battle, self, x) || await okuriAfterCast(battle, self, x)) return;
  else if (garudaAfterCast(battle, self, x) || momijiAfterCast(battle, self, x) || hannyaAfterCast(battle, self, x) || nyunaiAfterCast(battle, self, x)) return;
  else if (oitsuki295AfterCast(battle, self, x) || await doujoAfterCast(battle, self, x)) return;
  else if (await m7AfterCast(battle, self, x)) return;
  else senhimeAfterCast(battle, self, x);
}

// ───────────────────────── 饭笥: stack gain and the 10-stack form ─────────────────────────

const isControlled = (e: Entity): boolean => isActionPrevented(e.statusDefs());
const CONTROL_IDS = new Set(CONTROL_EFFECTS.filter(d => d.category === StatusCategory.DEBUFF_STATE).map(d => d.id));
const isControlStatus = (d: StatusDef): boolean => CONTROL_IDS.has(d.id)
  || (String(d.category).startsWith("DEBUFF") && (d.preventsAction || d.preventsSkill || d.forcesBasicAttack));

async function gainFood(battle: any, e: Entity, n: number, reason: string): Promise<void> {
  const after = changeStacks(battle, e, FOOD, n, reason, "蓄食待发");
  if (after >= FOOD.cap) await fullFeastNow(battle, e);
}

async function fullFeastNow(battle: any, e: Entity): Promise<void> {
  const sk = skillById(e, "370_03");
  if (!sk || !e.alive) return;
  const running = fullFeast.get(battle) ?? new Set<number>();
  if (running.has(e.id)) return;
  const controls = e.statuses.filter(s => isControlStatus(s.def));
  if (controls.length) {
    changeStacks(battle, e, FOOD, -FEAST_FULL.cleanseCost, "CLEANSE_CONTROL", sk.name);
    for (const st of controls) {
      if (!e.expireStatus(st)) continue;
      battle.trace.push({ t: "STATUS_REMOVE", id: e.id, status: st.def.id, name: st.def.name, by: "CLEANSE", side: "ALLY", what: "CONTROL", src: e.id, skill: sk.name });
      battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: e, status: st.def.id, name: st.def.name, by: "CLEANSE", side: "ALLY", what: "CONTROL", src: e.id, skill: sk.name }, e.id, e.teamId);
    }
  }
  const target = highestHp(aliveEnemies(battle, e));
  if (!target) return;
  battle.trace.push({
    t: "SUBCAST", actor: e.id, ref: "370_03", skill: sk.name, target: target.id,
    clause: "储备粮达到10层：立即免费施放", note: "10-stack form (user-confirmed, not in KB)",
  });
  running.add(e.id);
  fullFeast.set(battle, running);
  try {
    await battle.runPseudoTurn(e, TurnType.PSEUDO_TURN, { skill: sk, target, free: true });
  } finally {
    running.delete(e.id);
  }
}

// ───────────────────────── 金鱼姬: 鱼之怒 ─────────────────────────

const RAGE_EVERY = 8;
const RAGE_RATIO = 1.2;
const RAGE_SILENCE_PCT = 25;

async function goldfishRage(battle: any, owner: Entity, g: Entity, pushProb: number | null, pushPct: number): Promise<void> {
  const targets = aliveEnemies(battle, owner);
  battle.trace.push({ t: "GOLDFISH_RAGE", actor: g.id, owner: owner.id, skill: "鱼之怒", targets: targets.map(v => v.id), every: RAGE_EVERY });
  const silence = StatusBook.get("silence")!;
  await battle.withinResolution({ id: "HIT:鱼之怒#1", type: "HIT" }, async () => {
    for (const v of targets) {
      if (!v.alive) continue;
      await battle.damage(g, v, g.prop("atk") * RAGE_RATIO, DamageType.NORMAL, 1, null);
      if (!v.alive) continue;
      // Same probability / effect-resist contest as skills and souls (kernel/resist.ts).
      const contest = rollStatusContest(battle, g, v, silence, RAGE_SILENCE_PCT / 100,
        "control_prob:silence:鱼之怒:" + v.id, "resist:control_prob:silence:鱼之怒:" + v.id);
      if (contest.outcome === "MISS") {
        battle.trace.push({ t: "CONTROL_MISS", src: g.id, dst: v.id, probability: RAGE_SILENCE_PCT, skill: "鱼之怒", status: "silence", name: silence.name });
      } else if (contest.outcome === "RESIST") {
        await reportResist(battle, g, v, silence, contest, { probability: RAGE_SILENCE_PCT, duration: 1, ref: "CONTROL:silence", skill: "鱼之怒" });
      } else {
        const imm = findImmuneStatus(v, silence, battle.policies?.immune?.debuffCoversControl ?? true);
        if (imm) {
          battle.trace.push({ t: "IMMUNE", src: g.id, dst: v.id, status: silence.id, name: silence.name, by: imm.def.id, kind: imm.kind, consumed: imm.consumed, ref: "CONTROL:silence", skill: "鱼之怒" });
        } else {
          // Source = Kingyo: SOURCE_TURN statuses tick on the source's turns and the Goldfish never acts.
          const a = v.addStatus(silence, owner.id, 1, 1, [], null);
          battle.trace.push({ t: "STATUS_APPLY", src: g.id, dst: v.id, status: silence.id, name: silence.name, category: silence.category, duration: 1, ref: "CONTROL:silence", known: true, tag: (a as any)?.tag ?? null, skill: "鱼之怒" });
        }
      }
      if (pushProb === null) continue;
      battle.rng.expect("timeline_prob:鱼之怒:" + v.id);
      if (!battle.rng.testHit(pushProb)) continue;
      const posBefore = battle.timeline.get(v.id)?.pos ?? null;
      const moved = battle.timeline.shift(v.id, -pushPct / 100);
      if (!moved && battle.timeline.isLocked?.(v.id)) {
        battle.trace.push({ t: "TIMELINE_LOCKED", id: v.id, direction: "push", percent: -pushPct / 100, skill: "鱼之怒", reason: "锁条（缚足/放逐/石化）" });
        continue;
      }
      battle.trace.push({ t: "TIMELINE_SHIFT", id: v.id, direction: "push", percent: -pushPct / 100, posBefore, posAfter: battle.timeline.get(v.id)?.pos ?? null, applied: moved, skill: "鱼之怒" });
    }
  });
}

/** 50% / 30% from the max-level line of 金鱼·助阵 ("鱼之怒有50%概率击退30%行动条"). */
function ragePushOf(owner: Entity): { p: number | null; pct: number } {
  const x = skillById(owner, "282_03")?.ir;
  for (const l of (x?.levelScale ?? [])) {
    const m = String(l.effect ?? "").match(/鱼之怒有(\d+)%概率击退(\d+)%行动条/);
    if (m) return { p: Number(m[1]) / 100, pct: Number(m[2]) };
  }
  return { p: null, pct: 0 };
}

// ───────────────────────── installation ─────────────────────────

export function installBettingSubscribers(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingMechanicsActive()) return out;
  out.push(...installSenhime(battle, entities), ...installUngaikyo(battle, entities), ...installInugami(battle, entities),
    ...installYoto(battle, entities), ...installMushishi(battle, entities));
  installTurnTracker(battle);
  out.push(...installKaguya(battle, entities, (actor: Entity, sk: any) => hanaCost(battle, actor, sk, senhimeCostOf(battle, actor, sk))),
    ...installHana(battle, entities), ...installShokurei(battle, entities), ...installIbaraki(battle, entities),
    ...installVampira(battle, entities));
  // Match-5 kits; 入内雀 last: its 腐血 absorption must run after every other BEFORE_DAMAGE multiplier.
  out.push(...installGaruda(battle, entities), ...installMomiji(battle, entities), ...installHannya(battle, entities),
    ...installNyunai(battle, entities));
  // Match-4 replay kits.
  out.push(...installYato(battle, entities), ...installOitsuki(battle, entities), ...installShishio(battle, entities),
    ...installKannazuki(battle, entities));
  // Match-6 kits.
  out.push(...installFengyang(battle, entities), ...installSuzu(battle, entities), ...installOtake(battle, entities),
    ...installInaba(battle, entities), ...installChocho(battle, entities), ...installKuro(battle, entities), ...installOkuri(battle, entities));
  // Match-5 replay review: 追月神 295.
  out.push(...installOitsuki295(battle, entities));
  // Match-7 kits (betting-m7.ts).
  out.push(...installM7(battle, entities));
  for (const e of entities) {
    if (skillById(e, "370_02")) {
      const id = "betting:370:food:" + e.id;
      if (!battle.bus.hasHandler(id)) battle.bus.register({
        id, ownerId: e.id, code: "TURN_END", range: "ALL", priority: 0, passive: true, source: "PASSIVE",
        fn: async (ctx: any) => {
          const actor = ctx?.actor;
          if (!actor || !e.alive || isSummonUnit(actor)) return;
          const allyTurn = actor.teamId === e.teamId;
          if (!allyTurn && !e.hasStatus(APPETITE_ID)) return;
          if (isControlled(e)) return;
          await gainFood(battle, e, 1, allyTurn ? "ALLY_TURN_END" : "ENEMY_TURN_END");
        },
      });
      out.push({ entityId: e.id, mechanic: "储备粮" });
    }
    if (skillById(e, "282_02") && skillById(e, "282_03")) {
      const id = "betting:282:rage:" + e.id;
      const push = ragePushOf(e);
      if (!battle.bus.hasHandler(id)) battle.bus.register({
        id, ownerId: e.id, code: "TURN_END", range: "ALL", priority: 0, passive: true, source: "PASSIVE",
        fn: async (ctx: any) => {
          const actor = ctx?.actor;
          if (!actor || actor.teamId === e.teamId || isSummonUnit(actor)) return;
          const g = goldfishOf(battle, e);
          if (!g) return;
          const n = changeStacks(battle, g, RAGE_COUNTER, 1, "ENEMY_TURN_END", "金鱼·反击", e.id);
          if (n < RAGE_EVERY) return;
          changeStacks(battle, g, RAGE_COUNTER, -n, "RAGE_RELEASED", "金鱼·反击", e.id);
          await goldfishRage(battle, e, g, push.p, push.pct);
        },
      });
      out.push({ entityId: e.id, mechanic: "鱼之怒" });
    }
  }
  return out;
}
