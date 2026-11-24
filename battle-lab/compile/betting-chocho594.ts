// compile/betting-chocho594.ts — 梦引蝴蝶精 (SP 594, Global "Dreambound Chocho") at max skill level. MAX mode only (match 9).
//
// Sources: data/kb/shikigami.json 594_01..594_03, buff 5942_1 梦茧, data/kb/ai.json (KB AI rows);
// data/kb/en-text.json (Global); fandom "Yumebiki Kochou no Sei/Main".
//   AI (KB, compiles): always 梦引之声 when affordable (target: the highest-ATK ally without buffs); no rule here.
//   梦引之声 (594_03, 2 onibi) · heals every ally 15% of THEIR max HP (fandom "15% of their max HP"; the compiled IR
//       healed 15% of Chocho's max HP), the selected target 30% (L2) instead (the IR could not single it out);
//       L3: every ally +20% damage dealt for 1 turn; L4: the selected target gains 梦茧 = 50% of its heal, 2 turns;
//       L5 先机 (exclusive): at battle start, cast once (free) on the allied shikigami with the highest initial ATK.
//   灵梦 (594_02, 1 onibi) · Chocho gains 梦茧 = 20% (L2) of her max HP, 2 turns. L4: in any turn, once the damage she
//       has taken in that turn exceeds 20% of her initial max HP, she casts it (free; once until her next turn starts).
//   梦茧 (5942_1) · shield, max 2 (a third replaces the oldest), not dispellable, 2 turns of its bearer; the bearer
//       deals +20% damage (L5 of 594_02 raises the buff's 10%); L3: when a 梦茧 breaks, the excess damage of that hit
//       is negated (the hit is capped at what the bearer's shields can absorb).
// Readings (unverified):
//   · "治疗量50%" = 50% of the nominal heal (30% of the target's max HP), overheal included.
//   · L5 "携带者造成伤害提升20%" replaces the buff's 10% (total +20%, not +30%); one bonus per bearer, not per stack.
//   · The L4 counter adds the full damage of each hit (shield-absorbed part included) and resets at every turn start.
//   · The L4 trigger and the 先机 cast cost no onibi.
// Not modelled: "受到[tips_102]沉睡效果时…改为施放此技能" (no sleep effect in the match-9 lineups).
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, ensureShieldTicker, grantTimedShield, atkForTargeting } from "./betting-shared.ts";

export const CHOCHO594 = Object.freeze({ heal: 0.15, healMain: 0.3, songDmg: 0.2, cocoonOfHeal: 0.5, cocoonSelf: 0.2, cocoonDmg: 0.2,
  cocoonTurns: 2, cocoonCap: 2, triggerRatio: 0.2 });
export const COCOON_ID = "5942_1";
export const SONG_ID = "5943_song";
const COCOON_TAG = "cocoon594";

const cocoonDef = () => markDef({ id: COCOON_ID, name: "梦茧", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN",
  desc: "【增益、印记】上限2层，能够吸收一定量伤害，无法被驱散，携带者造成伤害提升20%。" }, StatusBook);
const songDef = () => markDef({ id: SONG_ID, name: "梦引之声", category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【增益、状态】伤害提升20%" }, StatusBook);

export const isChocho594 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "594_02") && !!skillById(e, "594_03");

/** Live 梦茧 shields of `e` (oldest first). */
export const cocoonsOf = (e: Entity): any[] => ((e.shields ?? []) as any[]).filter(s => !s.broken && s.value > 0 && String(s.id).includes("_" + COCOON_TAG + "_"));

/** Status 梦茧 follows the live shields: stacks = count, removed when none is left. */
function syncCocoon(e: Entity, granted = false): void {
  const live = cocoonsOf(e);
  const st = e.statuses.find(s => s.def.id === COCOON_ID);
  if (!live.length) { if (st) e.expireStatus(st); return; }
  if (!st) return;
  st.stacks = Math.min(CHOCHO594.cocoonCap, live.length);
  // Shields and status count down on the same bearer turn ends: align the status only when a cocoon is granted.
  if (granted) st.remaining = Math.max(st.remaining, ...live.map(s => s.ttl ?? 1));
}

export function grantCocoon(battle: any, src: Entity, dst: Entity, value: number, skill: string, reason: string): void {
  if (!dst?.alive || !(value > 0)) return;
  const live = cocoonsOf(dst);
  if (live.length >= CHOCHO594.cocoonCap) {
    const old = live[0];
    old.broken = true;
    battle.trace.push({ t: "SHIELD_EXPIRE", id: dst.id, shield: old.id, remaining: GameMath.display(old.value), reason: "CAP" });
  }
  grantTimedShield(battle, src, dst, value, CHOCHO594.cocoonTurns, { tag: COCOON_TAG, skill, reason, dispellable: false });
  const def = cocoonDef();
  const st = dst.statuses.find(s => s.def.id === COCOON_ID);
  if (!st) {
    const s = dst.addStatus(def, src.id, 1, CHOCHO594.cocoonTurns, [{ prop: "dmgDealtB", value: CHOCHO594.cocoonDmg, mode: "FIXED" }], CHOCHO594.cocoonCap);
    battle.trace.push({ t: "STATUS_APPLY", src: src.id, dst: dst.id, status: COCOON_ID, name: def.name, category: def.category, duration: CHOCHO594.cocoonTurns, ref: COCOON_ID, known: true, tag: (s as any)?.tag ?? null, skill });
  }
  syncCocoon(dst, true);
}

const allies = (battle: any, c: Entity): Entity[] => (battle.teams[c.teamId].aliveMembers() as Entity[]);
const hasBuff = (e: Entity): boolean => e.statuses.some(s => String(s.def.category).startsWith("BUFF"));

/** 梦引之声's selected target: the cast's target when it is a living ally, else the KB row (highest ATK without buffs). */
function songTarget(battle: any, c: Entity, skillName: string): Entity | null {
  const tr: any[] = battle.trace ?? [];
  for (let i = tr.length - 1; i >= 0; i--) {
    const t = tr[i];
    if (t.t !== "SKILL_CAST" || t.actor !== c.id) continue;
    if (t.skill !== skillName) break;
    const e = allies(battle, c).find(m => m.id === t.target);
    if (e) return e;
    break;
  }
  const pool = allies(battle, c).filter(m => !isSummonUnit(m));
  const clean = pool.filter(m => !hasBuff(m));
  const from = clean.length ? clean : pool;
  return from.reduce<Entity | null>((a, b) => (!a || atkForTargeting(b) > atkForTargeting(a) ? b : a), null);
}

async function song(battle: any, c: Entity, main: Entity | null, skill: string): Promise<void> {
  for (const m of allies(battle, c)) {
    const ratio = main && m.id === main.id ? CHOCHO594.healMain : CHOCHO594.heal;
    await battle.heal(c, m, m.maxHp * ratio, { crit: false });
  }
  const def = songDef();
  for (const m of allies(battle, c)) {
    for (const st of [...m.statuses]) if (st.def.id === SONG_ID) m.expireStatus(st);
    const s = m.addStatus(def, c.id, 1, 1, [{ prop: "dmgDealtB", value: CHOCHO594.songDmg, mode: "FIXED" }], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: c.id, dst: m.id, status: SONG_ID, name: def.name, category: def.category, duration: 1, ref: SONG_ID, known: true, tag: (s as any)?.tag ?? null, skill });
  }
  if (main?.alive) grantCocoon(battle, c, main, main.maxHp * CHOCHO594.healMain * CHOCHO594.cocoonOfHeal, skill, "HEAL");
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isChocho594(self)) return false;
  if (x?.id === "594_03") { await song(battle, self, songTarget(battle, self, x.name), x.name); return true; }
  if (x?.id === "594_02") { grantCocoon(battle, self, self, self.maxHp * CHOCHO594.cocoonSelf, x.name, "CAST"); return true; }
  return false;
}

/** Shield capacity of `e` against one hit of `amount` (per-hit caps included). */
const absorbable = (e: Entity, amount: number): number => ((e.shields ?? []) as any[])
  .filter(s => !s.broken && s.value > 0)
  .reduce((a, s) => a + Math.min(s.value, s.perHitRatio !== undefined ? amount * s.perHitRatio : Number.POSITIVE_INFINITY), 0);

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const seen = new Set<number>();
  for (const c of entities.filter(isChocho594)) {
    ensureShieldTicker(battle);
    const initHp = c.maxHp;
    let taken = 0, used = false;
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:594:" + code + ":" + c.id, c.id, code, fn, range);
    if (!seen.has(c.teamId)) {   // 唯一效果: one 先机 cast per side
      seen.add(c.teamId);
      reg(EV.BATTLE_START, async () => {
        const pool = allies(battle, c).filter(m => !isSummonUnit(m));
        const top = pool.reduce<Entity | null>((a, b) => (!a || atkForTargeting(b) > atkForTargeting(a) ? b : a), null);
        if (!top) return;
        battle.trace.push({ t: "SUBCAST", actor: c.id, ref: "594_03", skill: "梦引之声", target: top.id, clause: "先机：[tips_11]，对初始攻击最高的友方式神施放" });
        await song(battle, c, top, "梦引之声");
      }, "SELF");
    }
    reg(EV.TURN_START, (ctx: any) => { taken = 0; if (ctx?.actor?.id === c.id) used = false; });
    reg(EV.AFTER_DAMAGE, (ctx: any) => {
      if (ctx?.input?.target?.id !== c.id || !c.alive || used) return;
      taken += Number(ctx?.result?.final ?? 0);
      if (taken <= initHp * CHOCHO594.triggerRatio) return;
      used = true;
      battle.trace.push({ t: "SUBCAST", actor: c.id, ref: "594_02", skill: "灵梦", target: c.id, clause: "任意回合，自身累计受到大于初始生命20%的伤害时，施放[skill_594_02]。（自身回合开始前限1次）" });
      grantCocoon(battle, c, c, c.maxHp * CHOCHO594.cocoonSelf, "灵梦", "DAMAGE_TAKEN");
    });
    out.push({ entityId: c.id, mechanic: "梦引之声 15% of own max HP / 30% selected, +20% damage, 梦茧 50% of heal, L5 先机 cast · 灵梦 梦茧 20% max HP, L4 auto-cast after 20% damage in a turn · 梦茧 +20% damage, L3 excess immunity" });
  }
  if (!out.length) return out;
  // 梦茧 L3: the hit that breaks a 梦茧 deals nothing beyond the shields (bearers of any Chocho 594's cocoon).
  ensureGlobalHandler(battle, "betting:594:cocoon-excess", EV.BEFORE_DAMAGE, (ctx: any) => {
    const res = ctx?.result, t: Entity | undefined = ctx?.input?.target;
    if (!res || !t || !(res.final > 0) || !cocoonsOf(t).length) return;
    const cap = absorbable(t, res.final);
    if (res.final <= cap) return;
    const ratio = 1 - cap / res.final;
    res.final = cap;
    battle.trace.push({ t: "DAMAGE_REDUCED", id: t.id, by: "梦茧", ratio });
  });
  const resync = (ctx: any) => { const e: Entity | undefined = ctx?.target ?? ctx?.actor; if (e && e.statuses.some(s => s.def.id === COCOON_ID)) syncCocoon(e); };
  ensureGlobalHandler(battle, "betting:594:cocoon-break", EV.SHIELD_BREAK, resync);
  ensureGlobalHandler(battle, "betting:594:cocoon-tick", EV.TURN_END, resync);
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "594_03": { note: "梦引之声: heals (15% of each ally's max HP, 30% on the selected target), +20% damage and 梦茧 run in betting-chocho594.ts", patch: { heal: [] } },
    "594_02": { note: "灵梦: the 梦茧 shield and its status are granted by betting-chocho594.ts", patch: { shield: [], statusRefConditionOnly: [0] } },
  }),
  afterCast,
  install,
};
