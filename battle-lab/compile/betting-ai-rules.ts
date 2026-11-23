// compile/betting-ai-rules.ts — AI rules confirmed in game for 犬神 220 / 虫师 306 / 赤影妖刀姬 328, and
// 虫师's 虫之护 at max level. MAX mode only (callers check bettingActive / bettingMechanicsActive).
//
// Sources: matches/observed-behaviour.json (overrides data/kb/ai.json), data/kb/shikigami.json 306_03 / 328_*.
//   犬神 220      · 心剑乱舞 whenever its cost (after 紧盯's discount) can be paid, otherwise 心斩.
//   虫师 306      · 虫之护 only when a living non-summon ally (herself included) is below 70% HP and the cost
//                  can be paid; otherwise 虫之舞. 虫之舞 keeps the wiki target rule (below 50% HP first).
//                  The wiki row "友方单位血量大于70%时 → 普攻" never compiled (condUnresolved) — the rule here
//                  replaces both rows.
//   赤影妖刀姬 328 · 赤影一瞬 whenever the cost can be paid, otherwise 炎刃. Both target the enemy with the lowest
//                  HP ratio ("均满血时，根据站位选择目标": ties go to the lineup order). The wiki rule had no
//                  compiled selector, so the engine picked the first enemy. NOTE: the user-confirmed rule was
//                  written for "Yoto Hime, Scarlet Nightedge", which is the UR 593 (see betting-yoto.ts), not 328.
//   妖刀姬·绯夜猎刃 593 · 午夜猎歌 whenever affordable (user-confirmed); else 霞光小调 when no Bounty exists (KB AI
//                  row "敌方目标未存在悬赏时 → 2技能"); else 锋芒前奏. Targets from the KB rows (see aiRuleTarget).
//   虫之护 306_03 · L2: dispel up to 4 allies, 1 debuff or control effect each (controls first, then the
//                  oldest debuff; allies in lineup order). L5 heal 18% of max HP to all allies; dispelled allies
//                  get 20% less (L4). The heal base keeps the engine's reading of "治疗生命上限18%的生命":
//                  虫师's own max HP (the text names no owner). The compiled IR had two purge rows, one of them
//                  ("受驱散的友方治疗量降低30%" read as DISPEL ANY) dispelled a buff from every ally — removed.
import type { Entity } from "../kernel/entity.ts";
import { EV } from "../kernel/types.ts";
import { bettingActive, isSummonUnit, skillById, isControlDef, isDebuffOrControl, levelNumber } from "./betting-shared.ts";
import { bountyHolder, recordTwilightTarget } from "./betting-yoto.ts";

export const MUSHISHI = Object.freeze({ castBelow: 0.7 });

const basicOf = (self: Entity): any => self.skills.find((s: any) => Number(s.cost) === 0) ?? null;
const hpRatio = (e: Entity): number => (e.maxHp > 0 ? e.hp / e.maxHp : 0);

/**
 * Preferred skill for these three kits, or null (other units: KB rules).
 * `costOf` = effective cost (bettingCostOf), `canPay` = onibi check of the team.
 */
export function aiRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || isSummonUnit(self)) return null;
  const orbs = battle.teams[self.teamId].orbs;
  const canPay = (sk: any) => { const c = costOf(sk); return !(c > 0) || orbs.canPay(c); };
  const pick = (ult: any, ok: boolean, rule: string, fallback: string) => {
    if (ok && canPay(ult)) return { skill: ult, rule };
    const basic = basicOf(self);
    return basic ? { skill: basic, rule: fallback } : null;
  };
  const dance = skillById(self, "220_03");
  if (dance) return pick(dance, true, "犬神: 鬼火足够 → 心剑乱舞 (user-confirmed)", "犬神: 鬼火不足 → 心斩");
  const ward = skillById(self, "306_03");
  if (ward) {
    const low = (battle.teams[self.teamId].members as Entity[]).some(m => m.alive && !isSummonUnit(m) && hpRatio(m) < MUSHISHI.castBelow);
    return pick(ward, low, "虫师: 友方生命 < 70% → 虫之护", low ? "虫师: 鬼火不足 → 虫之舞" : "虫师: 友方生命均 ≥ 70% → 虫之舞");
  }
  const flash = skillById(self, "328_03");
  if (flash) return pick(flash, true, "赤影妖刀姬: 鬼火足够 → 赤影一瞬", "赤影妖刀姬: 鬼火不足 → 炎刃");
  const hunt = skillById(self, "593_03");
  if (hunt) {
    if (canPay(hunt)) return { skill: hunt, rule: "妖刀姬·绯夜猎刃: 鬼火足够 → 午夜猎歌 (user-confirmed)" };
    const twilight = skillById(self, "593_02");
    if (twilight && !bountyHolder(battle, self)) return { skill: twilight, rule: "妖刀姬·绯夜猎刃: 敌方没有悬赏 → 霞光小调 (KB AI)" };
    const basic = basicOf(self);
    return basic ? { skill: basic, rule: "妖刀姬·绯夜猎刃: 鬼火不足、悬赏存在 → 锋芒前奏" } : null;
  }
  return null;
}

/**
 * Target override (MAX only): 328_01 / 328_03 → lowest HP ratio, ties by lineup order.
 * 593_03 午夜猎歌 → highest HP ratio (ties: higher HP); 593_02 霞光小调 → lowest HP ratio (KB 593 target rows).
 */
export function aiRuleTarget(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || !cands.length) return null;
  if (cands.some(c => c.teamId === self.teamId)) return null;
  if (x?.id === "593_03") {
    // KB "优先选择血量高的敌方单位" read like the generic dictionary (ai-compiler: 血量高的敌方 = highest absolute HP),
    // ties to the Bounty bearer. The match-4 replay shows both hunts on the Bounty bearer (Mushishi, the
    // highest-HP enemy); the former highest-HP-ratio reading moved the hunt to whoever was still full.
    // 血量高 = highest MAX HP: replays show her hunting the max-HP-highest enemy every cast even after it was
    // damaged (match 4: Mushishi 32882; match 5: Doujo 25431, user-confirmed "always on Doujo").
    const holder = cands.find(v => v.statuses.some(st => st.def.id === "5931_1" && st.sourceId === self.id)) ?? null;
    const better = (a: Entity, b: Entity) => b.maxHp > a.maxHp || (b.maxHp === a.maxHp && holder !== null && b.id === holder.id);
    const target = cands.reduce((a, b) => (better(a, b) ? b : a), cands[0]);
    return { target, rule: "Yoto Hime, Scarlet Nightedge: Midnight Hunt targets the highest max-HP enemy (replay-confirmed; ties → Wanted holder)" };
  }
  if (x?.id === "593_02") {
    const target = cands.reduce((a, b) => (hpRatio(b) < hpRatio(a) ? b : a), cands[0]);
    recordTwilightTarget(self, target);
    return { target, rule: "妖刀姬·绯夜猎刃: 霞光小调优先选择血量低的敌方单位 (KB, 存疑)" };
  }
  if (x?.id !== "328_01" && x?.id !== "328_03") return null;
  const target = cands.reduce((a, b) => (hpRatio(b) < hpRatio(a) ? b : a), cands[0]);
  return { target, rule: "赤影妖刀姬: 优先选择敌方生命比例低的单位（均满血时按站位）" };
}

/** IR patch for 306_03 (applied with BETTING_IR_PATCHES): dispel and heal are run by mushishiWard. */
export const MUSHISHI_PATCH = Object.freeze({
  note: "虫之护: the compiled purge rows dispelled every ally (one of them a buff) — dispel (max 4) and the reduced heal run in bettingAfterCast",
  patch: { purge: [], heal: [] },
});

/** 虫之护 at max level: dispel, then heal everyone (dispelled allies heal less). */
export async function mushishiWard(battle: any, self: Entity, x: any): Promise<void> {
  const maxTargets = levelNumber(x, /可驱散友方目标增至(\d+)个/, /为最多(\d+)个友方目标驱散/, 3);
  const healPct = levelNumber(x, /治疗增至(\d+(?:\.\d+)?)%/, /治疗生命上限(\d+(?:\.\d+)?)%/, 12);
  const reducePct = levelNumber(x, /治疗量降低降至(\d+(?:\.\d+)?)%/, /治疗量降低(\d+(?:\.\d+)?)%/, 30);
  const allies: Entity[] = battle.teams[self.teamId].aliveMembers();
  const dispelled = new Set<number>();
  for (const m of allies) {
    if (dispelled.size >= maxTargets) break;
    const pool = m.statuses.filter(s => isDebuffOrControl(s.def) && s.def.dispellable);
    const st = pool.find(s => isControlDef(s.def)) ?? pool[0];
    if (!st || !m.dispel(st.def.id)) continue;
    dispelled.add(m.id);
    const what = isControlDef(st.def) ? "CONTROL" : "DEBUFF";
    battle.trace.push({ t: "STATUS_REMOVE", id: m.id, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what, src: self.id, skill: x.name, order: "control first, then oldest debuff" });
    battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: m, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what, src: self.id, skill: x.name }, m.id, m.teamId);
  }
  for (const m of battle.teams[self.teamId].aliveMembers() as Entity[]) {
    const amount = self.maxHp * (healPct / 100) * (dispelled.has(m.id) ? 1 - reducePct / 100 : 1);
    await battle.heal(self, m, amount, { crit: false });
  }
}
