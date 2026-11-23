// compile/betting-inaba.ts — 因幡辉夜姬 (SP 372, Global "Inaba Kaguya Hime") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 372_01..372_03, buffs 3722_1 愿力 / 3723_1 愿佑, tips_10 邀战 / tips_7 先机;
// fandom "Inaba Kaguya Hime/Main" (月之洗礼 153%).
//   愿力 (Wish Power) · team store, max 8 (kept in the onibi pool's `willpower` field). When an ally lacks onibi for a
//       skill, the whole cost is paid with Wish Power instead (also 铃彦姬's per-repeat onibi). Usable while she is
//       alive. Every point spent counts as "provided" (max 24): L2 +5% crit damage per point (max 120%),
//       L3 a shield of 12% of her max HP per point (2 turns, at most 8 live shields).
//   愿满夜 (372_02, 2 onibi) · L5 先机 (free at battle start). Opens the illusion for 2 of her turns (L4) and gives
//       3 Wish Power; in the illusion: +80% effect RES, +3 Wish Power at the start of her turns (L3); every other
//       ally shikigami that casts a skill gets 愿佑 (30% of her crit damage / DEF, max 120% / 200) until the end of
//       its next turn ("维持1回合"). A cast during her turn covers her next 2 turns.
//   寂光映月 (372_03, 3 onibi) · 138% to all enemies; allies with 愿佑 are Challenged (邀战: basic attack on her
//       target); the next 愿满夜 costs 1 less. L4: provided ≥ 12 ⇒ enemy souls and passives are ignored.
//       L5: provided ≥ 24 ⇒ the Inaba Rabbit casts 月之洗礼, 153% of her ATK to all enemies, ignoring souls and
//       passives (provided is not consumed — the text does not say it is).
//   AI (KB) · no illusion or 1 turn left → 愿满夜, otherwise 寂光映月 (target: lowest current max HP, ties: lineup).
// Not modelled: L2 of 愿满夜 (soul onibi → Wish Power: no onibi soul on her side in the known lineups).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureShieldTicker,
  grantTimedShield, withEnemiesSuppressed,
} from "./betting-shared.ts";
import { inOwnTurn } from "./betting-scope.ts";

export const INABA = Object.freeze({
  wishCap: 8, wishPerCast: 3, wishPerTurn: 3, providedCap: 24,
  illusionTurns: 2, illusionRes: 0.8, blessShare: 0.3, blessCridCap: 1.2, blessDefCap: 200,
  critPerWish: 0.05, critCap: 1.2, shieldPerWish: 0.12, shieldCap: 8, shieldTurns: 2,
  ignoreAt: 12, rabbitAt: 24, rabbitRatio: 153, ultRatio: 138, discount: 1,
});

export const ILLUSION_ID = "372_illusion";
export const BLESS_ID = "3723_1";
const N_LEFT = "inaba372:illusion=", N_PROVIDED = "inaba372:provided=", N_DISCOUNT = "inaba372:discount";
const CRID_SRC = "betting:372:crid";

const illusionDef = () => markDef({ id: ILLUSION_ID, name: "愿满夜·幻境", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "幻境中自身效果抵抗增加80%，除自身外的友方式神施放技能时获得愿佑。" }, StatusBook);
const blessDef = () => markDef({ id: BLESS_ID, name: "愿佑", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN",
  desc: "【增益、印记】获得因幡辉夜姬暴击伤害和防御属性的30%，最多获得不超过120%暴击伤害和200防御。" }, StatusBook);

export const isInaba372 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "372_02") && !!skillById(e, "372_03");
export const illusionLeft = (k: Entity): number => Number(noteValue(k, N_LEFT) ?? 0);
export const provided = (k: Entity): number => Number(noteValue(k, N_PROVIDED) ?? 0);
const inabaOf = (battle: any, teamId: number): Entity | null =>
  (battle.teams[teamId]?.members ?? []).find((m: Entity) => m.alive && isInaba372(m)) ?? null;
export const wishPower = (battle: any, teamId: number): number => Number(battle.teams[teamId]?.orbs?.willpower ?? 0);

function gainWish(battle: any, k: Entity, n: number, reason: string): void {
  const pool = battle.teams[k.teamId].orbs;
  const before = Number(pool.willpower ?? 0);
  pool.willpower = Math.min(INABA.wishCap, before + n);
  battle.trace.push({ t: "WISH_GAIN", team: k.teamId, src: k.id, before, after: pool.willpower, reason, skill: "愿满夜" });
}

function onProvided(battle: any, k: Entity, n: number): void {
  const total = Math.min(INABA.providedCap, provided(k) + n);
  setNote(k, N_PROVIDED, total);
  k.removeModifiersBySource(CRID_SRC);
  k.addModifier({ prop: "crid", value: Math.min(INABA.critCap, INABA.critPerWish * total), mode: "FIXED", source: CRID_SRC });
  for (let i = 0; i < n; i++) {
    const live = (k.shields ?? []).filter((s: any) => !s.broken && String(s.id).startsWith("sh_372wish_")).length;
    if (live >= INABA.shieldCap) break;
    grantTimedShield(battle, k, k, k.maxHp * INABA.shieldPerWish, INABA.shieldTurns,
      { tag: "372wish", skill: "寂光映月", reason: "WISH_PROVIDED", base: "maxHp", ratio: INABA.shieldPerWish * 100 });
  }
}

/** Wish Power pays a whole skill cost when the team's onibi is short (wraps the team's pool once). */
function wrapPool(battle: any, teamId: number): void {
  const pool = battle.teams[teamId].orbs;
  if (pool.__wish) return;
  const canPay0 = pool.canPay.bind(pool), pay0 = pool.pay.bind(pool);
  const usable = (n: number) => !!inabaOf(battle, teamId) && Number(pool.willpower ?? 0) >= n;
  Object.defineProperty(pool, "__wish", { value: true, enumerable: false });
  pool.canPay = (n: number) => canPay0(n) || (n > 0 && usable(n));
  pool.pay = (n: number, kind: any = "orb", purpose: any = "DEDUCT") => {
    if (kind === "orb" && purpose === "COST" && n > 0 && !canPay0(n) && usable(n)) {
      const k = inabaOf(battle, teamId)!;
      const before = pool.willpower;
      pool.willpower -= n;
      battle.trace.push({ t: "WISH_SPEND", team: teamId, amount: n, before, after: pool.willpower, src: k.id, skill: "愿力" });
      onProvided(battle, k, n);
      return true;
    }
    return pay0(n, kind, purpose);
  };
}

function openIllusion(battle: any, k: Entity, turns: number, reason: string): void {
  setNote(k, N_LEFT, turns);
  if (!k.hasStatus(ILLUSION_ID)) k.addStatus(illusionDef(), k.id, 1, PERSIST, [{ prop: "efr", value: INABA.illusionRes, mode: "FIXED" }], 1);
  battle.trace.push({ t: "FIELD_OPEN", owner: k.id, name: "愿满夜·幻境", turns, reason, skill: "愿满夜" });
  gainWish(battle, k, INABA.wishPerCast, reason);
}

function closeIllusion(battle: any, k: Entity, reason: string): void {
  setNote(k, N_LEFT, null);
  for (const st of [...k.statuses]) if (st.def.id === ILLUSION_ID) k.expireStatus(st);
  battle.trace.push({ t: "FIELD_CLOSE", owner: k.id, name: "愿满夜·幻境", reason });
}

function bless(battle: any, k: Entity, m: Entity): void {
  for (const st of [...m.statuses]) if (st.def.id === BLESS_ID) m.expireStatus(st);
  const def = blessDef();
  const crid = Math.min(INABA.blessCridCap, INABA.blessShare * k.prop("crid"));
  const dv = Math.min(INABA.blessDefCap, INABA.blessShare * k.prop("def"));
  const a = m.addStatus(def, k.id, 1, 2, [{ prop: "crid", value: crid, mode: "FIXED" }, { prop: "def", value: dv, mode: "FIXED" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: k.id, dst: m.id, status: BLESS_ID, name: def.name, category: def.category, duration: 2, ref: BLESS_ID, known: true, tag: a.tag, skill: "愿满夜" });
}

/** Cost: 愿满夜 -1 after 寂光映月. */
export function inabaCost(self: Entity, sk: any, base: number): number {
  if (!bettingActive() || (sk?.ir?.id ?? sk?.id) !== "372_02" || !(base > 0) || noteValue(self, N_DISCOUNT) === null) return base;
  return Math.max(0, base - INABA.discount);
}

export function inabaRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isInaba372(self)) return null;
  const canPay = (sk: any) => { const c = costOf(sk); return !(c > 0) || battle.teams[self.teamId].orbs.canPay(c); };
  const night = skillById(self, "372_02"), moon = skillById(self, "372_03");
  const left = illusionLeft(self);
  if (left <= 1 && night && canPay(night)) return { skill: night, rule: left === 0 ? "因幡辉夜姬: 无幻境 → 愿满夜 (KB AI)" : "因幡辉夜姬: 幻境剩余1回合 → 愿满夜 (KB AI)" };
  if (left > 1 && moon && canPay(moon)) return { skill: moon, rule: "因幡辉夜姬: 幻境中 → 寂光映月 (KB AI)" };
  const basic = skillById(self, "372_01");
  return basic ? { skill: basic, rule: "因幡辉夜姬: 鬼火 / 愿力不足 → 琉璃光" } : null;
}

/** 寂光映月: lowest current max HP enemy (ties: lineup order). */
export function inabaTarget(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || x?.id !== "372_03" || !cands.length || cands.some(c => c.teamId === self.teamId)) return null;
  const target = cands.reduce((a, b) => (b.maxHp < a.maxHp ? b : a), cands[0]);
  return { target, rule: "因幡辉夜姬: 寂光映月优先选择当前生命上限最低的敌方单位 (KB)" };
}

/** Target of the running 寂光映月 (邀战 target; transient). */
const moonTarget = new WeakMap<object, Entity>();

type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };

/** 寂光映月 damage (L4: enemy souls and passives ignored once 12 Wish Power were provided). */
export function inabaDamageHook(x: any): Hook | null {
  if (x?.id !== "372_03") return null;
  return {
    kind: "INABA_MOON",
    run: async (battle, k, hurt, primary) => {
      if (primary?.alive && primary.teamId !== k.teamId) moonTarget.set(k, primary);
      const sweep = async () => {
        await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
          for (const v of battle.enemiesOf(k.teamId).filter((e: Entity) => e.alive)) {
            if (!hurt.includes(v)) hurt.push(v);
            await battle.damage(k, v, k.prop("atk") * (INABA.ultRatio / 100), DamageType.NORMAL, 1, null);
          }
        });
      };
      if (provided(k) >= INABA.ignoreAt) {
        battle.trace.push({ t: "IGNORE_SOULS_PASSIVES", actor: k.id, skill: x.name, provided: provided(k) });
        await withEnemiesSuppressed(battle, k, { soul: true, passive: true }, sweep);
      } else await sweep();
    },
  };
}

export async function inabaAfterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isInaba372(self) || (x?.id !== "372_02" && x?.id !== "372_03")) return false;
  if (x.id === "372_02") {
    setNote(self, N_DISCOUNT, null);
    openIllusion(battle, self, inOwnTurn(battle, self) ? INABA.illusionTurns + 1 : INABA.illusionTurns, "CAST");
    return true;
  }
  setNote(self, N_DISCOUNT, 1);
  if (provided(self) >= INABA.rabbitAt && self.alive) {
    battle.trace.push({ t: "SUBCAST", actor: self.id, ref: "372_03", skill: "月之洗礼", target: null, clause: "累计提供24点愿力：因幡兔施放月之洗礼" });
    await withEnemiesSuppressed(battle, self, { soul: true, passive: true }, async () => {
      await battle.withinResolution({ id: "HIT:月之洗礼#1", type: "HIT" }, async () => {
        for (const v of battle.enemiesOf(self.teamId).filter((e: Entity) => e.alive)) await battle.damage(self, v, self.prop("atk") * (INABA.rabbitRatio / 100), DamageType.NORMAL, 1, null);
      });
    });
  }
  // 邀战: allies with 愿佑 basic-attack her target.
  const target = moonTarget.get(self);
  moonTarget.delete(self);
  const foe = target?.alive ? target : battle.enemiesOf(self.teamId).find((e: Entity) => e.alive);
  for (const m of battle.teams[self.teamId].members as Entity[]) {
    if (!foe?.alive || !m.alive || m.id === self.id || isSummonUnit(m) || !m.hasStatus(BLESS_ID) || isActionPrevented(m.statusDefs())) continue;
    const basic = m.skills.find((s: any) => Number(s.cost) === 0);
    if (!basic) continue;
    battle.trace.push({ t: "CHALLENGE", src: self.id, actor: m.id, target: foe.id, skill: "寂光映月" });
    await battle.runPseudoTurn(m, TurnType.PSEUDO_TURN, { skill: basic, target: foe });
  }
  return true;
}

/** IR patches (MAX): Wish Power, the illusion and 愿佑 are run by betting-inaba.ts. */
export const INABA_PATCHES = Object.freeze({
  "372_02": { note: "愿满夜: 愿力 / 愿佑 / the illusion are run by betting-inaba.ts", patch: { statusRefConditionOnly: [0, 1], field: null } },
  "372_03": { note: "寂光映月: 愿佑 is a condition (邀战 target), run by betting-inaba.ts", patch: { statusRefConditionOnly: [0] } },
});

export function installInaba(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const k = entities.find(isInaba372);   // 唯一效果
  if (!k) return out;
  ensureShieldTicker(battle);
  wrapPool(battle, k.teamId);
  const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = false) =>
    registerOwnerHandler(battle, "betting:372:" + code + ":" + k.id, k.id, code, fn, range, { passive });
  reg(EV.BATTLE_START, () => {
    if (illusionLeft(k) > 0) return;
    battle.trace.push({ t: "SUBCAST", actor: k.id, ref: "372_02", skill: "愿满夜", target: k.id, clause: "[tips_7]先机：施放「愿满夜」" });
    openIllusion(battle, k, INABA.illusionTurns, "SENKI");
  }, "SELF", true);
  reg(EV.TURN_START, (ctx: any) => {
    if (ctx?.actor?.id !== k.id || illusionLeft(k) <= 0 || (ctx.type !== "NORMAL" && ctx.type !== "NEW_TURN")) return;
    gainWish(battle, k, INABA.wishPerTurn, "TURN_START");
  }, "SELF");
  reg(EV.TURN_END, (ctx: any) => {
    if (ctx?.actor?.id !== k.id || illusionLeft(k) <= 0) return;
    const left = illusionLeft(k) - 1;
    if (left <= 0) closeIllusion(battle, k, "DURATION"); else setNote(k, N_LEFT, left);
  }, "SELF");
  reg(EV.SKILL_END, (ctx: any) => {
    const a: Entity | undefined = ctx?.actor;
    if (!a || a.id === k.id || a.teamId !== k.teamId || isSummonUnit(a) || !a.alive || illusionLeft(k) <= 0) return;
    bless(battle, k, a);
  });
  reg(EV.DEATH, (ctx: any) => { if (ctx?.target?.id === k.id && illusionLeft(k) > 0) closeIllusion(battle, k, "OWNER_DEFEATED"); }, "SELF");
  out.push({ entityId: k.id, mechanic: "愿力 (pool, provided riders) · 愿满夜 先机 / 幻境 / 愿佑 · 寂光映月 邀战, L4 ignore, L5 rabbit" });
  return out;
}
