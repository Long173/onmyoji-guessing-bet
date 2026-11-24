// compile/betting-amezaiku.ts — 饴细工 (SR 368, Global "Amezaiku") at max skill level. MAX mode only (match 14).
//
// Sources: data/kb/shikigami.json 368_02 / 368_03, buff 3681_1 糖渍, data/kb/ai.json row 368; data/kb/en-text.json
// (Global, same meaning). Before this module 一物一心 only put an inert 糖渍 (2 turns) on an ally and pulled HIS OWN
// bar 8% on every cast (which also fed 鬼童丸's single-target-bar-boost counter); 苦中作甜 did nothing.
//   苦中作甜 (368_02, passive, 唯一) · takes 30% (L5) of the damage dealt to the ally with the lowest current HP ratio
//        (when that ally is not himself). Damage that cannot be shared (INDIRECT) is not shared.
//   一物一心 (368_03, 2) · loses 15% of his current HP, gives 1 non-summon ally other than himself 糖渍 for 3 turns (L3).
//   糖渍 (3681_1) · each time he takes damage, every 糖渍 bearer is healed 15% (L4) of his max HP, at most 3 times per
//        turn per bearer; an overflowing heal adds 8% to the bearer's bar; L5: each such heal also heals him 5% of his
//        max HP.
//   AI (KB) · always 一物一心; target: an ally without 糖渍 first.
// Readings (conservative, noted in the report):
//   · The share is fixed damage dealt by the original attacker (no defence, no crit, no souls), so it counts as him
//     "taking damage" (糖渍 heals). Shared damage is never shared again.
//   · "消耗当前15%的血量" = HP loss (not damage: no 糖渍 trigger, cannot kill). "每回合" = per battle turn (battle.turn).
//   · 糖渍 duration counts on the bearer's turns. Its target among the allies without 糖渍: lowest HP ratio.
//   · "当糖渍治疗效果溢出，则为其增加8%的行动条": "其" = the healed 糖渍 bearer.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, shiftBar } from "./betting-shared.ts";

export const AMEZAIKU = Object.freeze({ share: 0.3, hpCost: 0.15, candyTurns: 3, candyHeal: 0.15, candyCap: 3, overflowBar: 0.08, selfHeal: 0.05 });
export const CANDY_ID = "3681_1";
/** skillTag of shared damage (苦中作甜 / 业回): never shared again. */
export const SHARE_TAG = "betting-share:";
export const isShareDamage = (ctx: any): boolean => String(ctx?.input?.skillTag ?? "").startsWith(SHARE_TAG);

const candyDef = () => markDef({ id: CANDY_ID, name: "糖渍", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN",
  dispellable: true, removable: true,
  desc: "【增益、印记】当饴细工受到伤害时，会为有糖渍的目标治疗饴细工生命上限15%的生命，同一目标糖渍效果每回合最多触发3次。" }, StatusBook);

export const isAmezaiku = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "368_02") && !!skillById(e, "368_03");
const ratioOf = (v: Entity): number => (v.maxHp > 0 ? v.hp / v.maxHp : 1);
const hasCandy = (v: Entity, src: Entity): boolean => v.statuses.some(s => s.def.id === CANDY_ID && s.sourceId === src.id);

/**
 * Moves `part` (0..1) of a pending damage onto `guard` as fixed damage from the same attacker (BEFORE_DAMAGE ctx).
 * Returns the amount moved (0 = nothing done).
 */
export async function redirectShare(battle: any, ctx: any, guard: Entity, part: number, skill: string): Promise<number> {
  const res = ctx?.result, src: Entity | undefined = ctx?.input?.source;
  if (!res || !src || !guard.alive || !(res.final > 0) || res.canBeShared === false || isShareDamage(ctx)) return 0;
  const moved = res.final * part;
  res.final -= moved;
  battle.trace.push({ t: "DAMAGE_SHARED", src: src.id, from: ctx.input.target?.id ?? null, to: guard.id, ratio: part, amount: Math.round(moved), skill });
  await dealDamage(battle, { source: src, target: guard, base: moved, rate: 1, type: DamageType.FIXED, skillTag: SHARE_TAG + skill, noSoul: true } as any);
  return moved;
}

/** AI target of 一物一心 (KB: an ally without 糖渍 first; then the lowest HP ratio). */
function target(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || x?.id !== "368_03" || !isAmezaiku(self)) return null;
  const pool = cands.filter(v => v.alive && v.teamId === self.teamId && v.id !== self.id && !isSummonUnit(v));
  if (!pool.length) return null;
  const fresh = pool.filter(v => !hasCandy(v, self));
  const from = fresh.length ? fresh : pool;
  const t = from.reduce((a, b) => (ratioOf(b) < ratioOf(a) ? b : a));
  return { target: t, rule: fresh.length ? "饴细工: 优先选择没有糖渍的友方 (KB)，生命比例最低" : "饴细工: 全员已有糖渍 → 生命比例最低" };
}

/** 一物一心: 15% current HP loss, 糖渍 for 3 turns on the chosen ally. */
async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "368_03" || !isAmezaiku(self)) return false;
  const loss = self.hp * AMEZAIKU.hpCost;
  if (loss > 0 && self.hp - loss >= 1) battle.lose(self, loss);
  const allies = (battle.teams[self.teamId].members as Entity[]).filter(v => v.alive && v.id !== self.id && !isSummonUnit(v));
  const picked = target(self, x, allies)?.target;
  if (!picked) return true;
  for (const st of [...picked.statuses]) if (st.def.id === CANDY_ID) picked.expireStatus(st);
  const a = picked.addStatus(candyDef(), self.id, 1, AMEZAIKU.candyTurns, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: picked.id, status: CANDY_ID, name: "糖渍", category: StatusCategory.BUFF_MARK, duration: AMEZAIKU.candyTurns, ref: CANDY_ID, known: true, tag: (a as any)?.tag ?? null, skill: x.name });
  return true;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const m of entities.filter(isAmezaiku)) {
    const used = new Map<number, { turn: number; n: number }>();
    // 糖渍: he takes damage ⇒ heal every bearer (3 per turn per bearer), overflow ⇒ +8% bar, L5 self heal.
    registerOwnerHandler(battle, "betting:368:candy:" + m.id, m.id, EV.AFTER_DAMAGE, async (ctx: any) => {
      if (ctx?.input?.target?.id !== m.id || !m.alive) return;
      if (!(Number(ctx?.result?.applied ?? 0) > 0 || Number(ctx?.result?.absorbed ?? 0) > 0)) return;
      const turn = Number(battle.turn ?? 0);
      for (const v of (battle.teams[m.teamId].members as Entity[]).filter(b => b.alive && hasCandy(b, m))) {
        const u = used.get(v.id);
        const n = u && u.turn === turn ? u.n : 0;
        if (n >= AMEZAIKU.candyCap) continue;
        used.set(v.id, { turn, n: n + 1 });
        const amount = m.maxHp * AMEZAIKU.candyHeal;
        const missing = v.maxHp - v.hp;
        battle.trace.push({ t: "MARK_TRIGGER", id: v.id, status: CANDY_ID, name: "糖渍", src: m.id, uses: n + 1, skill: "一物一心" });
        await battle.heal(m, v, amount, { crit: false });
        if (amount > missing + 1e-9 && v.alive) shiftBar(battle, v, AMEZAIKU.overflowBar, "糖渍");
        if (m.alive) await battle.heal(m, m, m.maxHp * AMEZAIKU.selfHeal, { crit: false });
      }
    }, "ALL", { passive: false });
    // 苦中作甜: 30% of the damage dealt to the lowest-HP-ratio ally.
    registerOwnerHandler(battle, "betting:368:share:" + m.id, m.id, EV.BEFORE_DAMAGE, async (ctx: any) => {
      const v: Entity | undefined = ctx?.input?.target, src: Entity | undefined = ctx?.input?.source;
      if (!v || !src || v.id === m.id || v.teamId !== m.teamId || isSummonUnit(v) || src.teamId === m.teamId || !m.alive) return;
      const allies = (battle.teams[m.teamId].members as Entity[]).filter(b => b.alive && !isSummonUnit(b));
      const low = allies.reduce((a, b) => (ratioOf(b) < ratioOf(a) ? b : a), allies[0]);
      if (low?.id !== v.id) return;
      await redirectShare(battle, ctx, m, AMEZAIKU.share, "苦中作甜");
    }, "ALL");
    out.push({ entityId: m.id, mechanic: "苦中作甜 (30% of the lowest-HP ally's damage) · 一物一心 (15% HP cost, 糖渍 3 turns) · 糖渍 (15% max-HP heals x3/turn, overflow +8% bar, L5 5% self heal)" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "368_03": { note: "一物一心: HP cost, 糖渍 (3 turns, heals) and the overflow bar boost are run by betting-amezaiku.ts (the compiled self pull and 2-turn mark are removed)", patch: { timeline: [], statusRefConditionOnly: [0] } },
  }),
  target,
  afterCast,
  install,
};
