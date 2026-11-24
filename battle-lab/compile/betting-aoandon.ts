// compile/betting-aoandon.ts — 青行灯 (SSR 266, Global "Aoandon") at max skill level. MAX mode only (match 9).
//
// Sources: data/kb/shikigami.json 266_01..266_03, buffs 2663_1 / 2665_1 明灯, data/kb/ai.json (KB AI rows);
// data/kb/en-text.json (Global); fandom "Aoandon/Main".
//   AI (KB, compiles): 敌方单位剩余数量≥2 or onibi > 5 → 吸魂灯, else 幽光; no rule here.
//   幽光 (266_01) · 120% ATK, then 30% chance to drain 1 onibi from the target's side (吸取: the enemy loses 1, her
//       side gains it). The compiled IR had an unconditional "+1 onibi" (orb.gain 1 from "吸取1点鬼火") and no drain.
//   明灯 (266_02, exclusive) · at the start of another allied SHIKIGAMI's turn (summons excluded): chance
//       40% − 3% per onibi her side has (L5) to give it 明灯 (2665_1) until that turn ends: skills cast that turn cost
//       no onibi (bettingCostOf via KIT.cost), and each onibi her side still holds raises that cast's damage by 5%.
//       Removed when Aoandon dies. A passive: 压制 stops the grant.
//   吸魂灯 (266_03, 3 onibi) · 190% ATK to all enemies, 30% chance per enemy hit to drain 1 onibi (same fix as 幽光);
//       then, for each onibi her side holds over the enemy side, one extra TRUE damage hit on every enemy = 5% of that
//       target's max HP, capped at 100% of Aoandon's initial ATK (KB / Global text; "对怪物不生效" irrelevant in PvP).
//       L5: the allied shikigami with the highest ATK gains 明灯 (2663_1: skills cost no onibi).
// Readings (unverified):
//   · "每余1点鬼火" = her side's onibi at the moment of each hit (the cast itself is free under 明灯).
//   · 2663_1 states no duration: modelled as 1 turn of its bearer (TARGET_TURN, expires at the end of the bearer's
//     next turn), so it covers the bearer's next action. Granted to herself it would expire at the end of this turn.
//   · "初始攻击" = Aoandon's ATK when the battle starts (souls included).
//   · The extra true hits use the onibi counts after the drains of the same cast; fandom does not list them.
// Not modelled: the fandom-only "Candlelight" (ろうそくの炎) overflow counter — not in the KB nor the Global en-text.
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory, DamageType } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, gainOrbs, drainOrbs, atkForTargeting } from "./betting-shared.ts";

export const AOANDON = Object.freeze({ drain: 0.3, lampBase: 0.4, lampPerOrb: 0.03, lampDmgPerOrb: 0.05, trueRatio: 0.05, trueCapAtk: 1 });
export const LAMP_ID = "2665_1";        // 明灯 (passive, until the turn ends)
export const LANTERN_ID = "2663_1";     // 明灯 (吸魂灯 L5)

const lampDef = () => markDef({ id: LAMP_ID, name: "明灯", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN",
  desc: "【通用、印记】回合内施放技能时，无需消耗鬼火，青行灯阵亡时移除。每余1点鬼火使该次技能伤害提升5%。" }, StatusBook);
const lanternDef = () => markDef({ id: LANTERN_ID, name: "明灯", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN",
  desc: "【通用、印记】施放技能无需消耗鬼火。" }, StatusBook);

export const isAoandon266 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "266_02") && !!skillById(e, "266_03");

/** Aoandon's ATK at battle start (the cap of the extra true hits). */
const initialAtk = new WeakMap<object, Map<number, number>>();

/** Chance of the passive 明灯 for her side's onibi count (L5: 40% − 3% per onibi, never below 0). */
export const lampChance = (orbs: number): number => Math.max(0, AOANDON.lampBase - AOANDON.lampPerOrb * Math.max(0, orbs));

function grant(battle: any, src: Entity, dst: Entity, def: any, skill: string): void {
  if (!dst.alive) return;
  for (const st of [...dst.statuses]) if (st.def.id === def.id) dst.expireStatus(st);
  const s = dst.addStatus(def, src.id, 1, 1, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: src.id, dst: dst.id, status: def.id, name: def.name, category: def.category, duration: 1, ref: def.id, known: true, tag: (s as any)?.tag ?? null, skill });
}

/** 30% drain of 1 onibi (吸取): the enemy side loses it, Aoandon's side gains it. */
function rollDrain(battle: any, self: Entity, victim: Entity, skill: string): void {
  battle.rng.expect("aoandon266_drain");
  if (!battle.rng.testHit(AOANDON.drain)) return;
  const took = drainOrbs(battle, self, victim.teamId, 1, skill);
  if (took > 0) gainOrbs(battle, self, self.teamId, took, skill);
}

/** Number of extra true hits of 吸魂灯: her side's onibi lead over the enemy side. */
export const onibiLead = (battle: any, self: Entity): number =>
  Math.max(0, battle.teams[self.teamId].orbs.current - battle.teams[1 - self.teamId].orbs.current);

function hits(x: any, lantern: boolean) {
  return {
    kind: "aoandon266:" + x.id,
    run: async (battle: any, self: Entity, _hurt: Entity[], primary?: Entity) => {
      // Damage hooks receive no target list: same scopes as the generic loop (幽光 single, 吸魂灯 all enemies).
      const pool: Entity[] = battle.enemiesOf(self.teamId);
      const first = primary?.alive && primary.teamId !== self.teamId ? primary : pool[0];
      const hurt: Entity[] = lantern ? [...new Set([first, ...pool].filter(Boolean))] as Entity[] : (first ? [first] : []);
      const slot = x.damage?.[0];
      const ratio = Number(slot?.ratioMax ?? slot?.ratio ?? 0) / 100;
      const hit: Entity[] = [];
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        for (const v of hurt) {
          if (!v.alive) continue;
          await battle.damage(self, v, self.prop("atk") * ratio, slot?.type ?? DamageType.NORMAL, 1, x.lifesteal ?? null);
          hit.push(v);
        }
      });
      for (const v of hit) rollDrain(battle, self, v, x.name);
      if (!lantern) return;
      const lead = onibiLead(battle, self);
      const cap = (initialAtk.get(battle)?.get(self.id) ?? self.prop("atk")) * AOANDON.trueCapAtk;
      for (let i = 0; i < lead; i++) {
        await battle.withinResolution({ id: "HIT:" + x.name + "#true" + (i + 1), type: "HIT" }, async () => {
          for (const v of battle.teams[1 - self.teamId].aliveMembers() as Entity[]) {
            if (!v.alive) continue;
            await battle.damage(self, v, Math.min(cap, v.maxHp * AOANDON.trueRatio), DamageType.TRUE, 1, null);
          }
        });
      }
      // L5: the allied shikigami with the highest ATK gains 明灯 (2663_1).
      const allies = (battle.teams[self.teamId].aliveMembers() as Entity[]).filter(m => !isSummonUnit(m));
      const top = allies.reduce<Entity | null>((a, b) => (!a || atkForTargeting(b) > atkForTargeting(a) ? b : a), null);
      if (top) grant(battle, self, top, lanternDef(), x.name);
    },
  };
}

function damageHook(x: any) {
  if (!bettingActive()) return null;
  if (x?.id === "266_01") return hits(x, false);
  if (x?.id === "266_03") return hits(x, true);
  return null;
}

/** 明灯 (either kind): skills cost no onibi. */
function cost(_battle: any, self: Entity, _sk: any, base: number): number {
  if (!bettingActive() || !(base > 0)) return base;
  return self.hasStatus(LAMP_ID) || self.hasStatus(LANTERN_ID) ? 0 : base;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const seen = new Set<number>();
  for (const a of entities.filter(isAoandon266)) {
    if (seen.has(a.teamId)) continue;   // 唯一效果: one Aoandon per side
    seen.add(a.teamId);
    let map = initialAtk.get(battle);
    if (!map) { map = new Map(); initialAtk.set(battle, map); }
    map.set(a.id, a.prop("atk"));
    registerOwnerHandler(battle, "betting:266:lamp:" + a.id, a.id, EV.TURN_START, (ctx: any) => {
      const e: Entity | undefined = ctx?.actor;
      if (!e || !a.alive || e.id === a.id || e.teamId !== a.teamId || isSummonUnit(e) || !e.alive) return;
      battle.rng.expect("aoandon266_lamp");
      if (!battle.rng.testHit(lampChance(battle.teams[a.teamId].orbs.current))) return;
      grant(battle, a, e, lampDef(), "明灯");
    }, "ALL");
    // 明灯 is removed when Aoandon dies (whatever happens to her passive).
    ensureGlobalHandler(battle, "betting:266:death:" + a.id, EV.DEATH, (ctx: any) => {
      if (ctx?.target?.id !== a.id) return;
      for (const m of battle.teams[a.teamId].members as Entity[]) {
        for (const st of [...m.statuses]) {
          if (st.def.id !== LAMP_ID || st.sourceId !== a.id || !m.expireStatus(st)) continue;
          battle.trace.push({ t: "STATUS_REMOVE", id: m.id, status: LAMP_ID, name: st.def.name, by: "REMOVE", side: "ALLY", what: "BUFF", src: a.id, skill: "明灯" });
        }
      }
    });
    out.push({ entityId: a.id, mechanic: "明灯 (40% − 3%/onibi at allied turn start: free skills, +5% damage per onibi) · 幽光 / 吸魂灯 30% onibi drain · 吸魂灯 true hits per onibi lead + L5 明灯 on the top-ATK ally" });
  }
  // 明灯 damage bonus: +5% per onibi of the bearer's side (the status lasts the bearer's turn only).
  if (seen.size) ensureGlobalHandler(battle, "betting:266:lamp-dmg", EV.BEFORE_DAMAGE, (ctx: any) => {
    const res = ctx?.result, src: Entity | undefined = ctx?.input?.source;
    if (!res || !src || res.ignoresModifiers || !(res.final > 0) || !src.hasStatus(LAMP_ID)) return;
    const orbs = battle.teams[src.teamId].orbs.current;
    if (!(orbs > 0)) return;
    const mul = 1 + AOANDON.lampDmgPerOrb * orbs;
    res.final *= mul;
    battle.trace.push({ t: "DAMAGE_BOOST", src: src.id, dst: ctx.input.target?.id ?? null, by: "明灯", mul, reason: orbs + " onibi" });
  });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "266_01": { note: "幽光: '30%概率吸取1点鬼火' is a 30% drain from the enemy (betting-aoandon.ts), not an unconditional +1 onibi", patch: { orb: { gain: 0, cost: 0 } } },
    "266_03": { note: "吸魂灯: the 30% drain per enemy, the true hits per onibi lead and L5 明灯 run in betting-aoandon.ts (not an unconditional +1 onibi)", patch: { orb: { gain: 0, cost: 3 } } },
  }),
  damageHook,
  cost,
  install,
};
