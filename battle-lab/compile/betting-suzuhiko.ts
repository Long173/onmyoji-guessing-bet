// compile/betting-suzuhiko.ts — 铃彦姬 (SSR 376, Global "Suzuhikohime") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 376_01..376_03, buff 3761_1 神火, tips_20 恢复; fandom "Suzuhiko Hime/Main"
// (心火永明 / Undying Flame is only on the wiki).
//   五山火祭 (376_03, 0 onibi) · 72% to all enemies, then repeatedly: pay 13% of max HP (L4) and 1 onibi — or 1
//       愿力 (Wish Power, betting-inaba.ts pool) — for another 43% to all enemies, until HP < 50% or no onibi /
//       Wish Power is left. Killing a non-summon enemy restores her HP to max (once per turn). L5: a cast that
//       reaches 5 attacks gives a stack of "ignore 30 DEF" for her 五山火祭 attacks (max 5 stacks; read as
//       persistent stacks — the text does not say whether they reset).
//   铃焰灼心 (376_02) · passive: below 75% HP (L2) she permanently enters 神火. With 神火: when her HP reaches max and
//       she is not controlled / banished, she immediately casts a free 五山火祭 (cooldown 2 of her turns); its damage
//       ignores enemy souls. L3: at the end of every non-summon ally turn (her own included) she heals 8% max HP.
//       [Cast]: resets the 神火 cooldown, heals her 40% max HP, recovers (恢复) 12% of her max HP on the others.
//       L4/L5 (wiki): lethal damage ⇒ 心火永明: buffs / debuffs removed, she stays on the field (1 HP floor) until
//       the last non-summon ally falls, immobile, immune to debuffs / banishment, DEF +100% and Crit RES +100%
//       (other allies: Crit RES and DEF +40%, while she stays in the state), recovers 50% HP on entering and
//       whenever another non-summon unit dies, shield 120% ATK (2 turns, undispellable, L5). At max HP she
//       returns: 神火 cooldown reset (⇒ 神火 fires at once).
//       Crit RES = the `critRes` prop read by kernel/damage.ts: attacker crit − critRes, floored at 0 (Global
//       335_02 L5: "Crit RES, meaning the damage source is treated as having 30% less Crit").
//   AI (KB) · HP > 50% → 五山火祭, otherwise 铃焰灼心 (the KB conditions did not compile).
// Not modelled: "cannot be revived" (no reviver here);
// "cannot trigger healing / recover / lifesteal while casting" (nothing heals her during her own cast).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, HpMutation, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureShieldTicker,
  grantTimedShield, withEnemiesSuppressed, isControlDef,
} from "./betting-shared.ts";

export const SUZU = Object.freeze({
  firstRatio: 72, repeatRatio: 43, hpCost: 0.13, stopBelow: 0.5, fireBelow: 0.75, fireCd: 2,
  allyTurnHeal: 0.08, castHeal: 0.4, castRecover: 0.12, pierceDef: 30, pierceCap: 5, pierceHits: 5,
  undyingRecover: 0.5, undyingShieldAtk: 1.2, undyingShieldTurns: 2, undyingDef: 1, allyDef: 0.4,
  undyingCritRes: 1, allyCritRes: 0.4,
});

export const FIRE_ID = "3761_1";
export const UNDYING_ID = "376_undying";
const AURA_ID = "376_undying_aura";
const N_CD = "suzu376:cd=", N_PIERCE = "suzu376:pierce=", N_RESTORE = "suzu376:restore=", N_PENDING = "suzu376:pending";

const fireDef = () => markDef({ id: FIRE_ID, name: "神火", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】当自身血量达到生命上限且未处于控制效果和放逐时，立刻施放1次无鬼火消耗的「五山火祭」，该效果冷却2回合。" }, StatusBook);
const undyingDef = () => markDef({ id: UNDYING_ID, name: "心火永明", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  preventsAction: true, immuneTo: ["DEBUFF", "BANISH"],
  desc: "心火永明（wiki）：留在场上直到最后一名非召唤物友方阵亡；无法动作，免疫减益与放逐，防御+100%，暴击抵抗+100%；生命回满时复活。" }, StatusBook);
const auraDef = () => markDef({ id: AURA_ID, name: "心火永明·庇佑", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "心火永明：其他友方暴击抵抗与防御提升40%。" }, StatusBook);

export const isSuzu376 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "376_02") && !!skillById(e, "376_03");
export const inUndying = (e: Entity): boolean => e.hasStatus(UNDYING_ID);
export const pierceStacks = (e: Entity): number => Number(noteValue(e, N_PIERCE) ?? 0);
export const fireCooldown = (e: Entity): number => Number(noteValue(e, N_CD) ?? 0);
const hpRatio = (e: Entity): number => (e.maxHp > 0 ? e.hp / e.maxHp : 0);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const otherAllies = (battle: any, e: Entity): Entity[] =>
  (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive && m.id !== e.id && !isSummonUnit(m));
const banishedOrControlled = (e: Entity): boolean => e.statuses.some(s => isControlDef(s.def) || (s.def.immuneTo ?? []).length === 0 && /放逐/.test(s.def.name));

/** Units running 五山火祭 right now (transient), and the casts fired by 神火 (souls ignored). */
const casting = new WeakSet<object>();

function enterFire(battle: any, s: Entity): void {
  if (s.hasStatus(FIRE_ID) || !s.alive || hpRatio(s) >= SUZU.fireBelow) return;
  const def = fireDef();
  s.addStatus(def, s.id, 1, PERSIST, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: s.id, status: FIRE_ID, name: def.name, category: def.category, duration: PERSIST, ref: FIRE_ID, known: true, reason: "HP_BELOW_75", skill: "铃焰灼心" });
}

/** HP reached max with 神火 ready ⇒ fire after the running action (ACTION_END / TURN_END). */
function markFireIfFull(s: Entity): void {
  if (s.hasStatus(FIRE_ID) && s.hp >= s.maxHp - 1e-6 && fireCooldown(s) <= 0 && !inUndying(s)) setNote(s, N_PENDING, 1);
}

async function fireNow(battle: any, s: Entity): Promise<void> {
  if (noteValue(s, N_PENDING) === null) return;
  setNote(s, N_PENDING, null);
  if (!s.alive || inUndying(s) || !s.hasStatus(FIRE_ID) || fireCooldown(s) > 0 || banishedOrControlled(s) || isActionPrevented(s.statusDefs())) return;
  const sk = skillById(s, "376_03");
  const target = aliveEnemies(battle, s)[0];
  if (!sk || !target) return;
  setNote(s, N_CD, SUZU.fireCd);
  battle.trace.push({ t: "SUBCAST", actor: s.id, ref: "376_03", skill: sk.name, target: target.id, clause: "神火：血量达到生命上限 → 免费施放五山火祭（冷却2回合）" });
  await withEnemiesSuppressed(battle, s, { soul: true, passive: false }, () =>
    battle.runPseudoTurn(s, TurnType.PSEUDO_TURN, { skill: sk, target, free: true }));
}

async function restoreFull(battle: any, s: Entity, reason: string): Promise<void> {
  const m = s.mutateHp(HpMutation.RECOVER, s.maxHp, "recover");
  battle.trace.push({ t: "RECOVER", src: s.id, dst: s.id, amount: GameMath.display(m.applied), hpBefore: GameMath.display(m.hpBefore), hpAfter: GameMath.display(m.hpAfter), reason, skill: "五山火祭" });
  markFireIfFull(s);
}

async function wave(battle: any, s: Entity, ratio: number, n: number, hurt: Entity[], x: any): Promise<void> {
  await battle.withinResolution({ id: "HIT:" + x.name + "#" + n, type: "HIT" }, async () => {
    for (const v of aliveEnemies(battle, s)) {
      if (!hurt.includes(v)) hurt.push(v);
      await battle.damage(s, v, s.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, null);
      if (v.alive || isSummonUnit(v) || !s.alive) continue;
      const key = String(battle.turn ?? 0);
      if (noteValue(s, N_RESTORE) === key) continue;
      setNote(s, N_RESTORE, key);
      await restoreFull(battle, s, "KILL_RESTORE");
    }
  });
}

type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };

export function suzuDamageHook(x: any): Hook | null {
  if (x?.id !== "376_03") return null;
  return {
    kind: "FIVE_MOUNTAINS",
    run: async (battle, s, hurt) => {
      casting.add(s);
      let attacks = 0;
      try {
        await wave(battle, s, SUZU.firstRatio, ++attacks, hurt, x);
        const pool = battle.teams[s.teamId].orbs;
        while (s.alive && hpRatio(s) >= SUZU.stopBelow && aliveEnemies(battle, s).length && pool.canPay(1)) {
          const before = pool.current;
          pool.pay(1, "orb", "COST");
          battle.queueEvent(EV.ORB_COST, { battle, team: s.teamId, actor: s.id, skill: x.name, amount: 1, before, after: pool.current }, s.id, s.teamId);
          battle.trace.push({ t: "ORB_PAY", team: s.teamId, actor: s.id, skill: x.name, amount: 1, before, after: pool.current, reason: "FIVE_MOUNTAINS_REPEAT" });
          const m = s.mutateHp(HpMutation.LOSS, s.maxHp * SUZU.hpCost, "loss");
          battle.trace.push({ t: "HP_LOSS", id: s.id, amount: GameMath.display(m.applied), hpAfter: GameMath.display(s.hp), skill: x.name, reason: "COST_13_PCT" });
          if (s.hp <= 0) { s.hp = 1; s.hpZero = false; }
          await wave(battle, s, SUZU.repeatRatio, ++attacks, hurt, x);
        }
      } finally { casting.delete(s); }
      if (attacks >= SUZU.pierceHits && pierceStacks(s) < SUZU.pierceCap) {
        setNote(s, N_PIERCE, pierceStacks(s) + 1);
        battle.trace.push({ t: "STACKS_GAINED", id: s.id, name: "无视防御", stacks: pierceStacks(s), skill: x.name, reason: "5_ATTACKS" });
      }
      enterFire(battle, s);
    },
  };
}

/** KB AI: HP > 50% → 五山火祭, otherwise 铃焰灼心. */
export function suzuRuleSkill(battle: any, self: Entity): { skill: any; rule: string } | null {
  if (!bettingActive() || !isSuzu376(self)) return null;
  if (hpRatio(self) > SUZU.stopBelow) return { skill: skillById(self, "376_03"), rule: "铃彦姬: 自身生命大于50% → 五山火祭 (KB AI)" };
  return { skill: skillById(self, "376_02"), rule: "铃彦姬: 自身生命小于50% → 铃焰灼心 (KB AI)" };
}

/** 铃焰灼心 [Cast]: cooldown reset, 40% heal on herself, 12% recover on the others. */
export async function suzuAfterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "376_02" || !isSuzu376(self)) return false;
  setNote(self, N_CD, 0);
  await battle.heal(self, self, self.maxHp * SUZU.castHeal, { crit: false });
  for (const m of otherAllies(battle, self)) await battle.heal(self, m, self.maxHp * SUZU.castRecover, { recover: true });
  markFireIfFull(self);
  return true;
}

// ───────────────────────── 心火永明 ─────────────────────────

function setAura(battle: any, s: Entity, on: boolean): void {
  for (const m of battle.teams[s.teamId].members as Entity[]) {
    for (const st of [...m.statuses]) if (st.def.id === AURA_ID && st.sourceId === s.id) m.expireStatus(st);
    if (on && m.alive && m.id !== s.id) m.addStatus(auraDef(), s.id, 1, PERSIST,
      [{ prop: "def", value: SUZU.allyDef, mode: "ADD_RATE" }, { prop: "critRes", value: SUZU.allyCritRes, mode: "FIXED" }], 1);
  }
}

function onLethal(battle: any, s: Entity, hook: any): void {
  if (hook?.target?.id !== s.id || hook.prevented || !otherAllies(battle, s).length) return;
  hook.prevented = true;
  s.hpZero = false; s.alive = true; s.dead = false; s.hp = 1;
  if (inUndying(s)) { battle.trace.push({ t: "UNDYING_HOLD", id: s.id, skill: "心火永明" }); return; }
  for (const st of [...s.statuses]) if (st.def.id !== FIRE_ID) s.expireStatus(st);
  s.addStatus(undyingDef(), s.id, 1, PERSIST,
    [{ prop: "def", value: SUZU.undyingDef, mode: "ADD_RATE" }, { prop: "critRes", value: SUZU.undyingCritRes, mode: "FIXED" }], 1);
  setAura(battle, s, true);
  battle.trace.push({ t: "LETHAL_FORM", id: s.id, name: "心火永明", note: "致命伤害 ⇒ 心火永明（留场直到最后一名非召唤物友方阵亡）" });
  const m = s.mutateHp(HpMutation.RECOVER, s.maxHp * SUZU.undyingRecover, "recover");
  battle.trace.push({ t: "RECOVER", src: s.id, dst: s.id, amount: GameMath.display(m.applied), hpBefore: GameMath.display(m.hpBefore), hpAfter: GameMath.display(m.hpAfter), skill: "心火永明" });
  grantTimedShield(battle, s, s, s.prop("atk") * SUZU.undyingShieldAtk, SUZU.undyingShieldTurns,
    { tag: "376undying", skill: "心火永明", reason: "ENTER", base: "atk", ratio: SUZU.undyingShieldAtk * 100, dispellable: false });
}

function leaveUndyingIfFull(battle: any, s: Entity): void {
  if (!inUndying(s) || s.hp < s.maxHp - 1e-6) return;
  for (const st of [...s.statuses]) if (st.def.id === UNDYING_ID) s.expireStatus(st);
  setAura(battle, s, false);
  setNote(s, N_CD, 0);
  battle.trace.push({ t: "FORM_RETURN", id: s.id, name: "心火永明", reason: "HP_FULL", note: "生命回满 ⇒ 复活，神火冷却重置" });
  markFireIfFull(s);
}

async function onDeath(battle: any, s: Entity, ctx: any): Promise<void> {
  const v: Entity | undefined = ctx?.target;
  if (!v || v.id === s.id || v.alive || isSummonUnit(v) || !inUndying(s) || !s.alive) return;
  if (v.teamId === s.teamId && !otherAllies(battle, s).length) {
    for (const st of [...s.statuses]) if (st.def.id === UNDYING_ID) s.expireStatus(st);
    battle.trace.push({ t: "UNDYING_END", id: s.id, reason: "LAST_ALLY_FELL", skill: "心火永明" });
    s.hp = 0; s.hpZero = true;
    await battle.resolveLethal(s, ctx?.killerId ?? null);
    return;
  }
  const m = s.mutateHp(HpMutation.RECOVER, s.maxHp * SUZU.undyingRecover, "recover");
  battle.trace.push({ t: "RECOVER", src: s.id, dst: s.id, amount: GameMath.display(m.applied), hpBefore: GameMath.display(m.hpBefore), hpAfter: GameMath.display(m.hpAfter), skill: "心火永明", reason: "UNIT_DEFEATED" });
  leaveUndyingIfFull(battle, s);
}

export function installSuzu(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const s = entities.find(isSuzu376);   // 唯一效果
  if (!s) return out;
  ensureShieldTicker(battle);
  const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = true) =>
    registerOwnerHandler(battle, "betting:376:" + code + ":" + s.id, s.id, code, fn, range, { passive });
  // 心火永明 is a skill replacement written on 铃焰灼心 (passive part) ⇒ passive handler.
  reg(EV.DEATH_PREVENTION, (hook: any) => onLethal(battle, s, hook));
  reg(EV.DEATH, (ctx: any) => onDeath(battle, s, ctx));
  reg(EV.AFTER_DAMAGE, (ctx: any) => { if (ctx?.input?.target?.id === s.id) enterFire(battle, s); });
  reg(EV.BEFORE_DAMAGE, (ctx: any) => {
    // L5: ignore 30 DEF per stack on 五山火祭 attacks.
    const res = ctx?.result, dst: Entity | undefined = ctx?.input?.target;
    if (ctx?.input?.source?.id !== s.id || !casting.has(s) || !res || !dst || !(pierceStacks(s) > 0)) return;
    const old = res.defenseMultiplier, def = Math.max(0, dst.prop("def"));
    if (!(old > 0) || old >= 1) return;
    const next = 300 / (300 + Math.max(0, def - SUZU.pierceDef * pierceStacks(s)));
    res.final *= next / old;
    res.defenseMultiplier = next;
  }, "SELF");
  reg(EV.TURN_END, async (ctx: any) => {
    const a: Entity | undefined = ctx?.actor;
    if (!a || a.teamId !== s.teamId || isSummonUnit(a) || !s.alive) return;
    if (a.id === s.id && fireCooldown(s) > 0) setNote(s, N_CD, fireCooldown(s) - 1);
    if (s.hasStatus(FIRE_ID) && !inUndying(s)) {
      await battle.heal(s, s, s.maxHp * SUZU.allyTurnHeal, { crit: false });
      markFireIfFull(s);
    }
    leaveUndyingIfFull(battle, s);
    await fireNow(battle, s);
  });
  reg(EV.HEAL, () => { if (s.alive) { markFireIfFull(s); leaveUndyingIfFull(battle, s); } });
  reg(EV.ACTION_END, async () => { if (s.alive) { markFireIfFull(s); leaveUndyingIfFull(battle, s); await fireNow(battle, s); } });
  out.push({ entityId: s.id, mechanic: "五山火祭 loop (HP / onibi / Wish Power), kill restore, L5 pierce · 神火 · 心火永明" });
  return out;
}

/** IR patches (MAX): 神火 is entered / fired by betting-suzuhiko.ts (the compiled slots granted it on cast). */
export const SUZU_PATCHES = Object.freeze({
  "376_02": { note: "铃焰灼心: 神火 is entered below 75% HP and fired by betting-suzuhiko.ts; the cast heals are run there too", patch: { statusRefConditionOnly: [0, 1], heal: [] } },
});
