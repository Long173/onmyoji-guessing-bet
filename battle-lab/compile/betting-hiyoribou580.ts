// compile/betting-hiyoribou580.ts — 晴思日和坊 (SP 580, Global "Sungraced Hiyoribou") at max skill level. MAX mode only
// (match 12).
//
// Sources: data/kb/shikigami.json 580_01..580_03, buffs 5803_1 霹雳娃娃 / 5804_1 晴空娃娃, tips_5802 彩虹能量, data/kb/ai.json
// row 580; data/kb/en-text.json (Global, same meaning). Before this module 晴日华光 did nothing (the compiled IR only held a
// misparsed "驱散阴霾" ally dispel — flavour text — and two unapplied marks) and the passive never ran.
//   澄空彩虹 (580_02, passive, 唯一) · when another ally deals damage, she stores 30% (L3) of it as 彩虹能量 (cap 2400% of her
//        initial ATK). Before her turn starts: up to 3 non-summon allies below 70% HP (lowest ratio first) are healed for
//        120% of her initial ATK, each heal consuming that much energy. L4: when she or the non-summon ally with the
//        highest initial ATK takes damage, up to 60% (L5: 90% for herself) of her initial ATK of energy blocks as much damage.
//   晴日华光 (580_03, 2) · 1 ally other than her gets 霹雳娃娃 (1 turn) and she stores 720% (L3) of her initial ATK. Every
//        600% of her initial ATK of energy gained gives 1 晴空娃娃 (cap 3). L4: after the 霹雳娃娃 bearer deals or takes damage,
//        the 3 non-summon allies with the lowest HP ratio are healed for 120% of her initial ATK (4 times per window, reset
//        at her turn start). L5 先机: cast on the ally with the highest initial ATK.
//   霹雳娃娃 (5803_1) · when the bearer deals indirect damage, 1 more indirect hit of 15% of it (cap 4000% of the bearer's
//        initial ATK).
//   晴空娃娃 (5804_1) · before any unit's turn: removes the freeze-type controls (冰冻 / 深度冰冻) of 1 non-summon ally and
//        consumes 1.
//   AI (KB)          · always 晴日华光 on the ally with the highest ATK (normal attack when the onibi are short).
// Readings (conservative, unverified — noted in the report):
//   · 澄空彩虹's bare "回合开始前" heal runs before HER turn only (HEAL_BEFORE_ANY_TURN = false). The same skill family says
//     "敌我双方回合开始前" / "自身回合开始前" elsewhere, so "before any turn" is a plausible alternative that spends the energy
//     several times faster (sensitivity measured and reported, not used).
//   · Every heal here is a fixed amount (energy-based) and cannot crit. A heal needs the full 120% of energy.
//   · L4 heals: at most one trigger per skill / tick resolution of the bearer (a multi-hit counts once).
//   · "1 turn" for 霹雳娃娃 uses the source-turn count (SOURCE_TURN, 2 ticks) like the other kits; 晴空娃娃 are counted on
//     the energy actually stored (the 2400% cap included); "冰冻类" = 冰冻 + 深度冰冻 (霜冻 cannot be removed, 冰眠 not counted).
//   · "初始攻击" = the panel ATK (e.base.atk).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, noteValue, setNote, atkForTargeting } from "./betting-shared.ts";
import { dealDamage } from "../kernel/damage.ts";
import { GameMath } from "../kernel/gamemath.ts";

export const HIYORI = Object.freeze({
  store: 0.3, cap: 24, lowHp: 0.7, healAtk: 1.2, healMax: 3, blockAlly: 0.6, blockSelf: 0.9,
  castStore: 7.2, dollEvery: 6, dollCap: 3, echo: 0.15, echoCap: 40, l4Heals: 4, l4Targets: 3, dollTurns: 2,
});
/** See the module header: false = the conservative reading (heal before her own turn only). */
export const HEAL_BEFORE_ANY_TURN = { value: false };
export const THUNDER_ID = "5803_1";
export const CLEAR_ID = "5804_1";
const N_ENERGY = "hiyori580:energy=", N_GAINED = "hiyori580:gained=", N_DOLLS = "hiyori580:dolls=", N_L4 = "hiyori580:l4=";
const ECHO_TAG = "betting-580:thunder";
const FREEZE_IDS = new Set(["freeze", "deepFreeze"]);

const thunderDef = () => markDef({ id: THUNDER_ID, name: "霹雳娃娃", category: StatusCategory.COMMON_MARK, durationPolicy: "SOURCE_TURN",
  desc: "【通用、印记】携带者造成间接伤害时，额外对目标造成1次该次伤害的15%间接伤害（伤害至多不超过自身初始攻击4000%）。" }, StatusBook);

export const isHiyori580 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "580_02") && !!skillById(e, "580_03");
const initAtk = (e: Entity): number => Number((e as any)?.base?.atk ?? 0) || e.prop("atk");
const num = (e: Entity, k: string): number => Number(noteValue(e, k) ?? 0);
export const energyOf = (e: Entity): number => num(e, N_ENERGY);
export const dollsOf = (e: Entity): number => num(e, N_DOLLS);
const allies = (battle: any, e: Entity): Entity[] => (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m));
const hiyoriOf = (battle: any, teamId: number): Entity | null =>
  (battle.teams[teamId]?.members ?? []).find((m: Entity) => m.alive && isHiyori580(m)) ?? null;

/** Stores energy (capped); every 600% of initial ATK actually stored gives 1 晴空娃娃 (cap 3). */
export function storeEnergy(battle: any, h: Entity, amount: number, why: string): number {
  const cap = HIYORI.cap * initAtk(h);
  const before = energyOf(h);
  const after = Math.min(cap, before + Math.max(0, amount));
  const got = after - before;
  if (!(got > 0)) return 0;
  setNote(h, N_ENERGY, after);
  const unit = HIYORI.dollEvery * initAtk(h);
  const g0 = num(h, N_GAINED), g1 = g0 + got;
  setNote(h, N_GAINED, g1);
  const newDolls = Math.floor(g1 / unit) - Math.floor(g0 / unit);
  if (newDolls > 0) setNote(h, N_DOLLS, Math.min(HIYORI.dollCap, dollsOf(h) + newDolls));
  if (why !== "DAMAGE") battle.trace.push({ t: "PASSIVE_PROC", actor: h.id, skill: "澄空彩虹", effect: "彩虹能量 +" + GameMath.display(got) + " (" + why + ")", target: h.id });
  return got;
}
function spend(h: Entity, amount: number): void { setNote(h, N_ENERGY, Math.max(0, energyOf(h) - amount)); }

/** 澄空彩虹: before her turn, up to 3 allies below 70% HP healed for 120% of her initial ATK each (energy-paid). */
export async function rainbowHeal(battle: any, h: Entity): Promise<number> {
  const cost = HIYORI.healAtk * initAtk(h);
  const low = allies(battle, h).filter(m => m.hp / m.maxHp < HIYORI.lowHp).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, HIYORI.healMax);
  let n = 0;
  for (const m of low) {
    if (energyOf(h) < cost) break;
    spend(h, cost);
    battle.trace.push({ t: "PASSIVE_PROC", actor: h.id, skill: "澄空彩虹", effect: "消耗彩虹能量治疗（初始攻击120%）", target: m.id });
    await battle.heal(h, m, cost, { crit: false });
    n++;
  }
  return n;
}

/** 晴日华光 effect on `t` (a real cast or the 先机 cast). */
export function sunnyRadiance(battle: any, h: Entity, t: Entity | null): void {
  if (t?.alive && t.id !== h.id) {
    for (const m of allies(battle, h)) for (const st of [...m.statuses]) if (st.def.id === THUNDER_ID && st.sourceId === h.id) m.expireStatus(st);
    const a = t.addStatus(thunderDef(), h.id, 1, HIYORI.dollTurns, [], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: h.id, dst: t.id, status: THUNDER_ID, name: "霹雳娃娃", category: StatusCategory.COMMON_MARK, duration: HIYORI.dollTurns, ref: THUNDER_ID, known: true, tag: (a as any)?.tag ?? null, skill: "晴日华光" });
  }
  storeEnergy(battle, h, HIYORI.castStore * initAtk(h), "CAST");
}

const pickTarget = (battle: any, h: Entity, by: (e: Entity) => number): Entity | null =>
  allies(battle, h).filter(m => m.id !== h.id).reduce<Entity | null>((a, b) => (!a || by(b) > by(a) ? b : a), null);
const topInitAtkAlly = (battle: any, h: Entity): Entity | null =>
  allies(battle, h).reduce<Entity | null>((a, b) => (!a || initAtk(b) > initAtk(a) ? b : a), null);
const castTarget = new WeakMap<object, Entity>();
const battles = new WeakMap<object, any>();
const opened = new WeakSet<object>();

async function dollFreeze(battle: any, h: Entity): Promise<void> {
  if (!(dollsOf(h) > 0)) return;
  for (const m of allies(battle, h)) {
    const sts = m.statuses.filter(s => FREEZE_IDS.has(s.def.id));
    if (!sts.length) continue;
    for (const st of sts) {
      if (!m.expireStatus(st)) continue;
      battle.trace.push({ t: "STATUS_REMOVE", id: m.id, status: st.def.id, name: st.def.name, by: "REMOVE", side: "ALLY", what: "CONTROL", src: h.id, skill: "晴空娃娃" });
      battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: m, status: st.def.id, name: st.def.name, by: "REMOVE", side: "ALLY", what: "CONTROL", src: h.id, skill: "晴空娃娃" }, m.id, m.teamId);
    }
    setNote(h, N_DOLLS, dollsOf(h) - 1);
    return;
  }
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isHiyori580);
  if (!units.length) return out;
  for (const h of units) {
    battles.set(h, battle);
    const reg = (id: string, code: string, fn: (ctx: any) => Promise<void> | void) =>
      registerOwnerHandler(battle, "betting:580:" + id + ":" + h.id, h.id, code, fn, "ALL");
    const unique = () => hiyoriOf(battle, h.teamId) === h;   // 唯一效果
    // Energy from the other allies' damage.
    reg("store", EV.AFTER_DAMAGE, (ctx: any) => {
      const src = ctx?.input?.source, dst = ctx?.input?.target;
      if (!src || !dst || src.id === h.id || src.teamId !== h.teamId || dst.teamId === h.teamId || !unique()) return;
      const dealt = Number(ctx?.result?.applied ?? 0) + Number(ctx?.result?.absorbed ?? 0);
      if (dealt > 0) storeEnergy(battle, h, dealt * HIYORI.store, "DAMAGE");
    });
    // L4 / L5 block: her and the highest-initial-ATK non-summon ally.
    reg("block", EV.BEFORE_DAMAGE, (ctx: any) => {
      const dst = ctx?.input?.target, res = ctx?.result;
      if (!dst || !res || dst.teamId !== h.teamId || !unique() || res.ignoresModifiers) return;
      const self = dst.id === h.id;
      if (!self && topInitAtkAlly(battle, h)?.id !== dst.id) return;
      const want = Math.min(Number(res.final ?? 0), energyOf(h), (self ? HIYORI.blockSelf : HIYORI.blockAlly) * initAtk(h));
      if (!(want > 0)) return;
      spend(h, want);
      res.final -= want;
      battle.trace.push({ t: "PASSIVE_PROC", actor: h.id, skill: "澄空彩虹", effect: "彩虹能量抵挡伤害 " + GameMath.display(want), target: dst.id });
    });
    // Before turns: her own turn = 澄空彩虹 heal and the L4 window reset; any turn = 晴空娃娃.
    reg("turn", EV.TURN_START, async (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || !h.alive || !unique()) return;
      await dollFreeze(battle, h);
      const own = a.id === h.id;
      if (own) setNote(h, N_L4, 0);
      if ((own && ctx.type === "NORMAL") || (HEAL_BEFORE_ANY_TURN.value && !own && ctx.type === "NORMAL")) await rainbowHeal(battle, h);
    });
    // 霹雳娃娃 echo on indirect damage + L4 heals after the bearer deals / takes damage.
    const healed = new WeakSet<object>();
    reg("thunder", EV.AFTER_DAMAGE, async (ctx: any) => {
      const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target, res = ctx?.result;
      if (!src || !dst || !res || !h.alive) return;
      const bearerOf = (e: Entity) => e.teamId === h.teamId && e.statuses.some(s => s.def.id === THUNDER_ID && s.sourceId === h.id);
      const dealt = Number(res.applied ?? 0) + Number(res.absorbed ?? 0);
      if (!(dealt > 0)) return;
      const srcBearer = bearerOf(src), dstBearer = bearerOf(dst);
      if (srcBearer && dst.teamId !== src.teamId && res.type === DamageType.INDIRECT && ctx.input.skillTag !== ECHO_TAG && dst.alive) {
        const v = Math.min(dealt * HIYORI.echo, HIYORI.echoCap * initAtk(src));
        await dealDamage(battle, { source: src, target: dst, base: v, rate: 1, type: DamageType.INDIRECT, skillTag: ECHO_TAG });
      }
      if (!srcBearer && !(dstBearer && src.teamId !== dst.teamId)) return;
      if (ctx.input.skillTag === ECHO_TAG) return;
      const stack: any[] = battle.resolutionStack ?? [];
      const scope = stack.find((x: any) => x?.type === "SKILL") ?? res;
      if (healed.has(scope)) return;
      const used = num(h, N_L4);
      if (used >= HIYORI.l4Heals) return;
      healed.add(scope);
      setNote(h, N_L4, used + 1);
      const amount = HIYORI.healAtk * initAtk(h);
      const low = allies(battle, h).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp).slice(0, HIYORI.l4Targets);
      battle.trace.push({ t: "PASSIVE_PROC", actor: h.id, skill: "晴日华光", effect: "霹雳娃娃 L4 治疗（初始攻击120%）", target: (srcBearer ? src : dst).id });
      for (const m of low) await battle.heal(h, m, amount, { crit: false });
    });
    out.push({ entityId: h.id, mechanic: "澄空彩虹 (30% damage → energy, 120% ATK heals before her turn, L4/L5 block) · 晴日华光 (霹雳娃娃 15% indirect echo, 720% energy, 晴空娃娃 freeze removal, L4 heals ×4, L5 先机) · KB AI" });
  }
  ensureGlobalHandler(battle, "betting:580:start", EV.BATTLE_START, () => {
    if (opened.has(battle)) return;
    opened.add(battle);
    for (const h of units) {
      if (!h.alive || hiyoriOf(battle, h.teamId) !== h) continue;
      const t = pickTarget(battle, h, initAtk);
      battle.trace.push({ t: "SUBCAST", actor: h.id, ref: "580_03", skill: "晴日华光", target: t?.id ?? null, clause: "先机：对初始攻击最高的友方施放「晴日华光」" });
      sunnyRadiance(battle, h, t);
    }
  });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "580_03": { note: "晴日华光: 霹雳娃娃 / energy / 晴空娃娃 / L4 heals run by betting-hiyoribou580.ts; the misparsed '驱散阴霾' ally dispel is removed", patch: { purge: [], statusRefConditionOnly: [0, 1] } },
  }),
  ruleSkill: (battle, self, costOf) => {
    if (!bettingActive() || !isHiyori580(self)) return null;
    const sun = skillById(self, "580_03"), basic = skillById(self, "580_01");
    if (sun && (!(costOf(sun) > 0) || battle.teams[self.teamId].orbs.canPay(costOf(sun)))) return { skill: sun, rule: "晴思日和坊: 晴日华光 (KB AI)" };
    return basic ? { skill: basic, rule: "晴思日和坊: 鬼火不足 → 轰隆隆" } : null;
  },
  target: (self, x, _cands) => {
    if (!bettingActive() || !isHiyori580(self) || x?.id !== "580_03") return null;
    const battle = battles.get(self);
    if (!battle) return null;
    const t = pickTarget(battle, self, atkForTargeting);
    if (!t) return null;
    castTarget.set(self, t);
    return { target: t, rule: "晴思日和坊: 晴日华光优先选择攻击高的友方单位 (KB AI)" };
  },
  afterCast: (battle, self, x) => {
    if (!bettingActive() || !isHiyori580(self) || x?.id !== "580_03") return false;
    const t = castTarget.get(self) ?? pickTarget(battle, self, atkForTargeting);
    castTarget.delete(self);
    sunnyRadiance(battle, self, t);
    return true;
  },
  install,
};
