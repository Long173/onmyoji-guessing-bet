// compile/betting-enenra.ts — 遥念烟烟罗 572 (Global "Nostalgic Enenra") at max skill level. MAX mode only (match 7).
//
// Sources: data/kb/shikigami.json 572_01..572_03, buff 5722_1 烟雾无形, tips_5723 烟之鬼 / tips_27 可行动状态;
// data/kb/en-text.json (Global); fandom "Younen Enenra/Main".
//   如影 (572_02, 0 onibi) · passive (唯一): when she takes enemy damage while actionable, she enters 烟雾无形 (at most
//       2 entries between two of her turns). Read: the entry takes effect once the hitting action is over (the rest
//       of the skill that hit her is not blocked by it). L5 先机: enters 烟雾无形.
//       [Cast]: enters 烟雾无形 and gives every non-summon ally a shield of 25% (L4) of HER max HP for 2 turns.
//       L3: while she is in 烟雾无形, a non-summon ally damaged by an enemy gains a 2-turn shield of 15% of that damage.
//   烟雾无形 (5722_1) · [Buff, Mark]: blocks all control effects, debuffs and damage of one enemy skill (status
//       immunity CONTROL / DEBUFF / DAMAGE through the kernel's own checks), then is removed when that enemy action
//       ends and she gains +15% action bar.
//   夜幕华彩 (572_03, 3 onibi) · 2 × 51% to all enemies, then 131% (L4) on the designated enemy (L5: ignores the
//       enemies' souls and passives), with a 58% base chance — 72% (L3) while she is in 烟雾无形 and no enemy is a
//       Smoke Phantom — to Morph it into 烟之鬼 for 1 turn (the bearer's next turn: undispellable, unable to act,
//       passives disabled). When 烟之鬼 disappears it deals 49% of her ATK to every enemy of hers (bearer included).
//       The compiled run dealt the segments of the damageSegments override only partly (replaced here).
//   AI (KB) · onibi for 夜幕华彩 → 夜幕华彩 on the highest current-HP enemy, otherwise 如影.
// Not modelled: debuffs applied outside the skill path (betting applyContested) do not consume 烟雾无形.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import type { BettingKit } from "./betting-m7.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureShieldTicker,
  grantTimedShield, shiftBar, applyContested, withEnemiesSuppressed,
} from "./betting-shared.ts";

export const ENENRA = Object.freeze({
  maxEntries: 2, smokeBar: 0.15, castShield: 0.25, shieldTurns: 2, hitShield: 0.15,
  waveRatio: 51, waves: 2, finalRatio: 131, morphP: 0.58, morphSmokeP: 0.72, morphTurns: 1, burstRatio: 49,
});

export const SMOKE_ID = "5722_1";
export const PHANTOM_ID = "5723_phantom";
const N_ENTRIES = "enen572:entries=", N_PENDING = "enen572:pending", N_BLOCKED = "enen572:blocked=";

const smokeDef = () => markDef({ id: SMOKE_ID, name: "烟雾无形", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  immuneTo: ["CONTROL", "DEBUFF", "DAMAGE"],
  desc: "【增益、印记】可抵挡敌方单次技能当中的所有控制效果、减益、伤害，抵挡之后移除并增加15%行动条。" }, StatusBook);
const phantomDef = () => markDef({ id: PHANTOM_ID, name: "烟之鬼", category: StatusCategory.DEBUFF_STATE, durationPolicy: "TARGET_TURN",
  preventsAction: true, suppressPassive: true, dispellable: false, removable: true,
  desc: "遥念烟烟罗专属变形效果。无法被驱散，无法动作，式神被动技能失效。消失时，对敌方全体造成攻击49%的伤害。" }, StatusBook);

export const isEnenra572 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "572_02") && !!skillById(e, "572_03");
export const inSmoke = (e: Entity): boolean => e.hasStatus(SMOKE_ID);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const nonSummonAllies = (battle: any, e: Entity): Entity[] => (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m));
const entries = (e: Entity): number => Number(noteValue(e, N_ENTRIES) ?? 0);
const anyPhantom = (battle: any, e: Entity): boolean => aliveEnemies(battle, e).some(v => v.hasStatus(PHANTOM_ID));

function enterSmoke(battle: any, s: Entity, reason: string): void {
  if (!s.alive || inSmoke(s)) return;
  const def = smokeDef();
  const a = s.addStatus(def, s.id, 1, PERSIST, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: s.id, status: SMOKE_ID, name: def.name, category: def.category, duration: PERSIST, ref: SMOKE_ID, known: true, tag: a.tag, reason, skill: "如影" });
}

/** The blocking enemy action ended: 烟雾无形 is removed, +15% action bar. */
function consumeSmoke(battle: any, s: Entity): void {
  setNote(s, N_BLOCKED, null);
  const st = s.statuses.find(x => x.def.id === SMOKE_ID);
  if (!st) return;
  s.expireStatus(st);
  battle.trace.push({ t: "STATUS_EXPIRE", id: s.id, status: SMOKE_ID, name: "烟雾无形", reason: "BLOCKED_ONE_SKILL" });
  if (s.alive) shiftBar(battle, s, ENENRA.smokeBar, "烟雾无形");
}

async function wave(battle: any, s: Entity, n: number, hurt: Entity[], x: any): Promise<void> {
  await battle.withinResolution({ id: "HIT:" + x.name + "#" + n, type: "HIT" }, async () => {
    for (const v of aliveEnemies(battle, s)) {
      if (!hurt.includes(v)) hurt.push(v);
      await battle.damage(s, v, s.prop("atk") * (ENENRA.waveRatio / 100), DamageType.NORMAL, 1, null);
    }
  });
}

function nightHook(x: any): any {
  if (x?.id !== "572_03") return null;
  return {
    kind: "ENENRA_NIGHT_SKY",
    run: async (battle: any, s: Entity, hurt: Entity[], primary?: Entity) => {
      for (let w = 1; w <= ENENRA.waves; w++) await wave(battle, s, w, hurt, x);
      const pool = aliveEnemies(battle, s);
      const v = primary?.alive && primary.teamId !== s.teamId ? primary : pool.reduce<Entity | null>((a, b) => (!a || b.hp > a.hp ? b : a), null);
      if (!v || !s.alive) return;
      if (!hurt.includes(v)) hurt.push(v);
      const p = inSmoke(s) && !anyPhantom(battle, s) ? ENENRA.morphSmokeP : ENENRA.morphP;
      await withEnemiesSuppressed(battle, s, { soul: true, passive: true }, async () => {
        await battle.withinResolution({ id: "HIT:" + x.name + "#final", type: "HIT" }, async () => {
          await battle.damage(s, v, s.prop("atk") * (Number(x.damage?.[1]?.ratio ?? ENENRA.finalRatio) / 100), DamageType.NORMAL, 1, null);
        });
        if (v.alive) await applyContested(battle, s, v, phantomDef(), p, ENENRA.morphTurns, [], { skill: x.name, ref: "tips_5723" });
      });
    },
  };
}

async function phantomBurst(battle: any, s: Entity, bearer: Entity, reason: string): Promise<void> {
  if (!s.alive) return;
  const targets = aliveEnemies(battle, s);
  battle.trace.push({ t: "SMOKE_PHANTOM_BURST", actor: s.id, bearer: bearer.id, reason, targets: targets.map(v => v.id), skill: "烟之鬼" });
  await battle.withinResolution({ id: "HIT:烟之鬼#burst", type: "HIT" }, async () => {
    for (const v of targets) if (v.alive) await battle.damage(s, v, s.prop("atk") * (ENENRA.burstRatio / 100), DamageType.NORMAL, 1, null);
  });
}

export const ENENRA_PATCHES = Object.freeze({
  "572_02": {
    note: "如影: 烟雾无形 (entries, blocking, +15% bar) and the cast shield (25% of her max HP, 2 turns, non-summon allies) are run by betting-enenra.ts",
    patch: { statusRefConditionOnly: [0, 1], shield: [] },
  },
});

export const KIT: BettingKit = {
  patches: ENENRA_PATCHES,
  damageHook: (x: any) => (bettingActive() ? nightHook(x) : null),
  ruleSkill: (battle, self, costOf) => {
    if (!bettingActive() || !isEnenra572(self)) return null;
    const night = skillById(self, "572_03");
    if (battle.teams[self.teamId].orbs.canPay(costOf(night))) return { skill: night, rule: "遥念烟烟罗: 鬼火充足 → 夜幕华彩 (KB AI)" };
    return { skill: skillById(self, "572_02"), rule: "遥念烟烟罗: 鬼火不足 → 如影 (KB AI)" };
  },
  target: (self, x, cands) => {
    if (!bettingActive() || x?.id !== "572_03" || !isEnenra572(self)) return null;
    const pool = cands.filter(c => c.alive && c.teamId !== self.teamId);
    if (!pool.length) return null;
    return { target: pool.reduce((a, b) => (b.hp > a.hp ? b : a), pool[0]), rule: "遥念烟烟罗: 夜幕华彩优先选择绝对血量更高的敌方 (KB)" };
  },
  afterCast: (battle, self, x) => {
    if (!bettingActive() || x?.id !== "572_02" || !isEnenra572(self)) return false;
    ensureShieldTicker(battle);
    enterSmoke(battle, self, "CAST");
    for (const m of nonSummonAllies(battle, self)) {
      grantTimedShield(battle, self, m, self.maxHp * ENENRA.castShield, ENENRA.shieldTurns,
        { tag: "572cast", skill: x.name, reason: "CAST", base: "maxHp", ratio: ENENRA.castShield * 100 });
    }
    return true;
  },
  install: (battle, entities) => {
    const out: Array<{ entityId: number; mechanic: string }> = [];
    if (!bettingActive()) return out;
    const s = entities.find(isEnenra572);   // 唯一效果
    if (!s) return out;
    ensureShieldTicker(battle);
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = true) =>
      registerOwnerHandler(battle, "betting:572:" + code + ":" + s.id, s.id, code, fn, range, { passive });
    reg(EV.BATTLE_START, () => enterSmoke(battle, s, "SENKI"), "SELF");
    reg(EV.TURN_START, (ctx: any) => { if (ctx?.actor?.id === s.id) setNote(s, N_ENTRIES, 0); }, "SELF");
    // 烟雾无形 blocked something: remember the enemy action (removed when it ends). A mark rule ⇒ not a passive.
    reg(EV.IMMUNE, (ctx: any) => {
      if (ctx?.target?.id !== s.id || ctx?.by?.id !== SMOKE_ID || noteValue(s, N_BLOCKED) !== null) return;
      setNote(s, N_BLOCKED, ctx.source?.id ?? "any");
      battle.trace.push({ t: "SMOKE_BLOCK", id: s.id, src: ctx.source?.id ?? null, kind: ctx.kind, skill: "烟雾无形" });
    }, "SELF", false);
    reg(EV.AFTER_DAMAGE, (ctx: any) => {
      const dst: Entity | undefined = ctx?.input?.target, src: Entity | undefined = ctx?.input?.source;
      if (!dst || !src || src.teamId === dst.teamId || dst.teamId !== s.teamId || !(ctx.result?.final > 0)) return;
      if (dst.id === s.id && !inSmoke(s) && entries(s) < ENENRA.maxEntries && !isActionPrevented(s.statusDefs())) setNote(s, N_PENDING, 1);
      if (inSmoke(s) && dst.alive && !isSummonUnit(dst)) {
        grantTimedShield(battle, s, dst, ctx.result.final * ENENRA.hitShield, ENENRA.shieldTurns,
          { tag: "572smoke", skill: "如影", reason: "L3_HIT_IN_SMOKE", base: "damage", ratio: ENENRA.hitShield * 100 });
      }
    });
    const actionOver = (ctx: any) => {
      const blocked = noteValue(s, N_BLOCKED);
      if (blocked !== null && (blocked === "any" ? ctx?.actor?.teamId !== s.teamId : Number(blocked) === ctx?.actor?.id)) consumeSmoke(battle, s);
      if (noteValue(s, N_PENDING) === null) return;
      setNote(s, N_PENDING, null);
      if (!s.alive || inSmoke(s) || isActionPrevented(s.statusDefs())) return;
      setNote(s, N_ENTRIES, entries(s) + 1);
      enterSmoke(battle, s, "HIT_BY_ENEMY");
    };
    reg(EV.ACTION_END, actionOver, "ALL", false);
    reg(EV.TURN_END, () => { if (noteValue(s, N_BLOCKED) !== null) consumeSmoke(battle, s); }, "ALL", false);
    const gone = async (ctx: any) => {
      const e: Entity | undefined = ctx?.entity;
      if (ctx?.status !== PHANTOM_ID || !e || e.hasStatus(PHANTOM_ID)) return;
      await phantomBurst(battle, s, e, String(ctx.reason ?? ctx.by ?? "GONE"));
    };
    reg(EV.STATUS_EXPIRE, gone, "ALL", false);
    reg(EV.STATUS_REMOVE, gone, "ALL", false);
    out.push({ entityId: s.id, mechanic: "如影 (烟雾无形 entries / blocking / +15% bar, cast + L3 shields, L5 先机) · 夜幕华彩 2×51% + 131% + 烟之鬼 morph and burst" });
    return out;
  },
};
