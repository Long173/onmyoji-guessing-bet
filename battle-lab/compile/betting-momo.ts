// compile/betting-momo.ts — 桃花妖 (SR 200, Global "Momo") at max skill level. MAX mode only (match 8).
//
// Sources: data/kb/shikigami.json 200_01..200_03, buff 2002_1 盛开, data/kb/ai.json (KB AI rows); data/kb/en-text.json
// (Global); fandom "Momo no Sei/Main" (heals are 20% → 25% of HER max HP; revive cooldown 2 — not in the KB, not used).
//   AI (KB, confidence LOW before: none of the four rows compiled, she only ever basic-attacked):
//       a dead (revivable) non-summon ally and 3 onibi → 桃华灼灼; else the lowest ally HP ratio < 65% → 花之馨息;
//       65% ≤ lowest < 80% → 75% 花之馨息 / 25% 花舞; all allies ≥ 80% → 花舞. An unaffordable choice falls to 花舞.
//   花之馨息 (200_02, 2 onibi) · heals the ally with the lowest HP ratio (KB target row) 25% of Momo's max HP; the heal
//       can crit (her crit rate / crit damage); passive part ("治疗时"): every other living ally is healed 30% of the
//       REQUESTED heal (after Tree Spirit and crit, overheal included; the splash itself does not crit); every unit
//       healed by her gains 盛开 (+30% damage dealt, 1 turn).
//       Match 8 evidence: splash 13307 ×3 next to a main heal that only restored 21533 (13307 = 30% × 44357, i.e. of
//       the capped part too); a crit main heal 44333 (= 21521 × 2.06, her crit damage); 30137 = 14630 × 2.06.
//       Open: the main heal's base reads 21.5k = 35% of her (×2.42) max HP vs 30% modelled (25% × Tree Spirit 1.2).
//   桃华灼灼 (200_03, 3 onibi) · revives a fallen ally (lineup order) with 25% of Momo's max HP (generic revive + heal);
//       the passive splash (30% to the others) and 盛开 follow, as for any heal of hers.
// Readings: "本次治疗量" = the requested heal (match 8, see above); the splash heals do not splash again;
// 树妖 (Tree Spirit) amplifies every heal of hers (kernel healAmplifiers) — the splash is computed after it.
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, ensureGlobalHandler } from "./betting-shared.ts";

export const MOMO = Object.freeze({ heal: 0.25, splash: 0.3, bloomDmg: 0.3, bloomTurns: 1, healBelow: 0.65, mixBelow: 0.8, mixHeal: 0.75 });
export const BLOOM_ID = "2002_1";

const bloomDef = () => markDef({ id: BLOOM_ID, name: "盛开", category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【增益、状态】伤害提升30%" }, StatusBook);

export const isMomo200 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "200_02") && !!skillById(e, "200_03");
const ratio = (e: Entity): number => (e.maxHp > 0 ? e.hp / e.maxHp : 1);
const livingAllies = (battle: any, m: Entity): Entity[] => (battle.teams[m.teamId].aliveMembers() as Entity[]).filter(a => !isSummonUnit(a));
const lowestAlly = (battle: any, m: Entity): Entity | null =>
  livingAllies(battle, m).reduce<Entity | null>((a, b) => (!a || ratio(b) < ratio(a) ? b : a), null);
const deadAllies = (battle: any, m: Entity): Entity[] =>
  (battle.teams[m.teamId].members as Entity[]).filter(a => a.dead && !isSummonUnit(a) && !a.reviveBlocked && !a.transformed);

/** Unit revived by the running 桃华灼灼 (set by the REVIVE handler, read by afterCast). */
const lastRevived = new WeakMap<object, Map<number, number>>();

function bloom(battle: any, m: Entity, dst: Entity): void {
  if (!dst.alive) return;
  for (const st of [...dst.statuses]) if (st.def.id === BLOOM_ID && st.sourceId === m.id) dst.expireStatus(st);
  const def = bloomDef();
  const s = dst.addStatus(def, m.id, 1, MOMO.bloomTurns, [{ prop: "dmgDealtB", value: MOMO.bloomDmg, mode: "FIXED" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: m.id, dst: dst.id, status: BLOOM_ID, name: def.name, category: def.category, duration: MOMO.bloomTurns, ref: BLOOM_ID, known: true, tag: (s as any)?.tag ?? null, skill: "花之馨息" });
}

/** The passive part of 花之馨息: 30% of the heal to every other ally, 盛开 on everyone healed. */
async function splash(battle: any, m: Entity, main: Entity, healed: number, skill: string): Promise<void> {
  bloom(battle, m, main);
  const each = healed * MOMO.splash;
  battle.trace.push({ t: "HEAL_SPLASH", src: m.id, main: main.id, healed: GameMath.display(healed), each: GameMath.display(each), ratio: MOMO.splash, skill });
  for (const a of livingAllies(battle, m)) {
    if (a.id === main.id) continue;
    if (each > 0) await battle.heal(m, a, each, { crit: false });
    bloom(battle, m, a);
  }
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isMomo200(self)) return null;
  const orbs = battle.teams[self.teamId].orbs;
  const can = (sk: any) => { const c = costOf(sk); return !(c > 0) || orbs.canPay(c); };
  const basic = skillById(self, "200_01"), heal = skillById(self, "200_02"), revive = skillById(self, "200_03");
  if (revive && deadAllies(battle, self).length && can(revive)) return { skill: revive, rule: "桃花妖: 有可复活目标 → 桃华灼灼 (KB AI)" };
  const low = lowestAlly(battle, self);
  const r = low ? ratio(low) : 1;
  if (heal && r < MOMO.healBelow && can(heal)) return { skill: heal, rule: "桃花妖: 友方血量<65% → 花之馨息 (KB AI)" };
  if (heal && r < MOMO.mixBelow && can(heal)) {
    battle.rng.expect("momo200_mix");
    if (battle.rng.testHit(MOMO.mixHeal)) return { skill: heal, rule: "桃花妖: 65%≤友方血量<80% → 75% 花之馨息 (KB AI)" };
    return basic ? { skill: basic, rule: "桃花妖: 65%≤友方血量<80% → 25% 花舞 (KB AI)" } : null;
  }
  return basic ? { skill: basic, rule: r < MOMO.mixBelow ? "桃花妖: 鬼火不足 → 花舞" : "桃花妖: 友方血量均≥80% → 花舞 (KB AI)" } : null;
}

function target(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || !isMomo200(self) || !cands.length) return null;
  if (x?.id === "200_02") {
    const t = [...cands.filter(c => c.alive && !isSummonUnit(c) && c.teamId === self.teamId), ...(self.alive ? [self] : [])].reduce<Entity | null>((a, b) => (!a || ratio(b) < ratio(a) ? b : a), null);
    return t ? { target: t, rule: "桃花妖: 花之馨息优先选择生命比例最低的单位 (KB)" } : null;
  }
  return null;
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isMomo200(self)) return false;
  if (x?.id === "200_02") {
    const main = lowestAlly(battle, self);
    if (!main) return true;
    let requested = 0;
    await battle.heal(self, main, self.maxHp * MOMO.heal, { crit: true, onRequested: (r: number) => { requested = r; } });
    await splash(battle, self, main, requested, x.name);
    return true;
  }
  if (x?.id === "200_03") {
    const id = lastRevived.get(battle)?.get(self.id);
    lastRevived.get(battle)?.delete(self.id);
    const main = (battle.teams[self.teamId].members as Entity[]).find(a => a.id === id && a.alive);
    if (main) await splash(battle, self, main, Math.max(0, main.hp - 1), x.name);
    return true;
  }
  return false;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const m of entities.filter(isMomo200)) {
    ensureGlobalHandler(battle, "betting:200:revive:" + m.id, EV.REVIVE, (ctx: any) => {
      const t: Entity | undefined = ctx?.target;
      if (!t || t.teamId !== m.teamId || !m.alive) return;
      let map = lastRevived.get(battle);
      if (!map) { map = new Map(); lastRevived.set(battle, map); }
      map.set(m.id, t.id);
    });
    out.push({ entityId: m.id, mechanic: "桃花妖 KB AI (revive / heal thresholds) · 花之馨息 25% + 30% splash + 盛开 · 桃华灼灼 splash" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "200_02": { note: "花之馨息: the heal (25% of Momo's max HP), the 30% splash and 盛开 are run by betting-momo.ts", patch: { heal: [], statusRefConditionOnly: [0] } },
  }),
  ruleSkill,
  target,
  afterCast,
  install,
};
