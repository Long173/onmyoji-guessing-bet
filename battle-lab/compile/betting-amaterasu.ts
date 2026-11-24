// compile/betting-amaterasu.ts — 天照 (SSR 556, Global "Amaterasu") at max skill level. MAX mode only (match 8).
//
// Sources: data/kb/shikigami.json 556_01..556_03, buffs 5561_1 天晖 / 5562_1 光涤, tips_27 可行动状态 / tips_15 维持;
// data/kb/en-text.json (Global); fandom "Amaterasu/Main" (evolution line "when attacked … Purged by Light").
//   神圣裁决 (556_03, 3 onibi) · 3 × 100% ATK to all enemies, then 3 × 100% to the target (compiled damage segments).
//       Target (KB aiText "三技能选择生命值最高敌方"): the enemy with the highest current HP.
//       天晖 goes to the ally shikigami OTHER THAN HER with the highest initial panel ATK (souls included; summons
//       excluded; match 8: Hitotsume 5726 over Vampira 5108 although Vampira's KB base ATK is higher),
//       sustained 2 turns (her turns: granted turn + 2 more ends). The compiled IR put it on herself.
//   天晖 5561_1 [general mark, unique] · ATK −15%; +20% action bar on every grant; while she lives, lethal damage leaves
//       the bearer at 1 HP (she "gives 1 point of her own HP": she loses 1 HP, never below 1).
//   无灭 (556_02, passive, unique) · while she is in 可行动状态 (alive, not controlled / banished), when the 天晖 bearer
//       deals skill damage during HER turn ("在自身回合内"; Global "during self's turn": e.g. a counter or assist of the
//       bearer inside her turn — match 8 showed no echo on the bearer's own turns), she deals the same kind of damage to the same enemy with 70% (L4) of that
//       hit's coefficient (hit base / bearer ATK) × HER ATK. When an enemy attacks her: 光涤 on the attacker for 1 turn
//       (damage it deals to her −40%, DEF −150; contested by effect RES under the betting resist policy).
//       L5: when she lands a kill, +50% action bar.
// Readings (unverified): echo hits are not attacks of the bearer (no recursion) and trigger her souls; the echo follows
// NORMAL / TRUE hits only (the bleed's indirect slot is not "skill damage"); 1 point of HP per save, no save limit.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, shiftBar, kbBaseAtk, applyContested } from "./betting-shared.ts";
import { currentSkillOf, inOwnTurn } from "./betting-scope.ts";
import { isReflectDamage } from "./betting-hitotsume.ts";

export const AMATERASU = Object.freeze({ atkCut: -0.15, bar: 0.2, echo: 0.7, killBar: 0.5, purgeCut: 0.4, purgeDef: -150, radianceTurns: 3, purgeTurns: 1 });
export const RADIANCE_ID = "5561_1";
export const PURGE_ID = "5562_1";
export const ECHO_TAG = "betting-echo:无灭";

const radianceDef = () => markDef({ id: RADIANCE_ID, name: "天晖", category: StatusCategory.COMMON_MARK, durationPolicy: "SOURCE_TURN", dispellable: false, removable: false,
  desc: "【通用、印记】唯一效果。攻击下降15%。立刻提升20%行动条，受到致命伤害时，天照给予目标自身的1点生命。" }, StatusBook);
const purgeDef = () => markDef({ id: PURGE_ID, name: "光涤", category: StatusCategory.DEBUFF_MARK, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【减益、印记】对天照造成的伤害降低40%，防御下降150点。" }, StatusBook);

export const isAmaterasu556 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "556_02") && !!skillById(e, "556_03");
const actionable = (e: Entity): boolean => e.alive && e.hp > 0 && !isActionPrevented(e.statusDefs());
export const radianceBearer = (battle: any, a: Entity): Entity | null =>
  (battle.teams[a.teamId].members as Entity[]).find(m => m.alive && m.statuses.some(s => s.def.id === RADIANCE_ID && s.sourceId === a.id)) ?? null;

/** Initial panel ATK (souls included, no buffs): the entity's base ATK (the Lineup-screen value in betting). */
const initialAtk = (e: Entity): number => Number(e?.base?.atk ?? 0) || kbBaseAtk(e);

/** 天晖's receiver: the other ally shikigami with the highest initial panel ATK; ties → lineup order.
 *  Match 8: it went to Hitotsume (panel 5726), not Vampira (panel 5108, but the higher KB base ATK 3002 vs 2519). */
export function radianceTarget(battle: any, a: Entity): Entity | null {
  const pool = (battle.teams[a.teamId].aliveMembers() as Entity[]).filter(m => m.id !== a.id && !isSummonUnit(m));
  return pool.reduce<Entity | null>((best, m) => (!best || initialAtk(m) > initialAtk(best) ? m : best), null);
}

function grantRadiance(battle: any, a: Entity, skill: string): void {
  const dst = radianceTarget(battle, a);
  // 唯一效果: one bearer at a time (a new grant moves it).
  for (const m of battle.teams[a.teamId].members as Entity[]) for (const st of [...m.statuses]) if (st.def.id === RADIANCE_ID) m.expireStatus(st);
  if (!dst) return;
  const def = radianceDef();
  // SOURCE_TURN ticks at the end of every turn of Amaterasu, the granting turn included ⇒ 3 = through 2 more turns.
  const s = dst.addStatus(def, a.id, 1, AMATERASU.radianceTurns, [{ prop: "atk", value: AMATERASU.atkCut, mode: "ADD_RATE" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: a.id, dst: dst.id, status: RADIANCE_ID, name: def.name, category: def.category, duration: 2, ref: RADIANCE_ID, known: true, tag: (s as any)?.tag ?? null, skill });
  shiftBar(battle, dst, AMATERASU.bar, def.name);
}

function target(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive() || x?.id !== "556_03" || !isAmaterasu556(self) || !cands.length || cands.some(c => c.teamId === self.teamId)) return null;
  const t = cands.reduce((a, b) => (b.hp > a.hp ? b : a), cands[0]);
  return { target: t, rule: "天照: 神圣裁决选择生命值最高的敌方 (KB aiText)" };
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "556_03" || !isAmaterasu556(self)) return false;
  grantRadiance(battle, self, x.name);
  return true;
}

const ECHO_TYPES = new Set<string>([DamageType.NORMAL, DamageType.TRUE]);

async function echo(battle: any, a: Entity, ctx: any): Promise<void> {
  const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
  if (!src || !dst || src.id === a.id || src.teamId !== a.teamId || dst.teamId === a.teamId || !dst.alive) return;
  if (!src.statuses.some(s => s.def.id === RADIANCE_ID && s.sourceId === a.id) || !actionable(a)) return;
  const tag = String(ctx.input.skillTag ?? "");
  if (!ECHO_TYPES.has(String(ctx.result?.type)) || tag.startsWith("soul:") || isReflectDamage(ctx) || tag.startsWith("betting-")) return;
  const sk = currentSkillOf(battle, src);
  // "在自身回合内" = during AMATERASU's turn (Global: "during self's turn"): the bearer's counters / assists / extra hits
  // inside her turn echo, the bearer's own turns do not (match 8: no echo seen on the bearer's turns).
  if (!sk || Number(sk.cost) < 0 || !inOwnTurn(battle, a)) return;
  const atk = src.prop("atk");
  if (!(atk > 0)) return;
  const coef = Number(ctx.input.base) * Number(ctx.input.rate ?? 1) / atk;
  if (!(coef > 0)) return;
  const ratio = coef * AMATERASU.echo;
  battle.trace.push({ t: "ECHO_HIT", src: a.id, ally: src.id, dst: dst.id, coefficient: coef, ratio, skill: "无灭", allySkill: sk.name });
  await battle.withinResolution({ id: "HIT:无灭#echo", type: "HIT" }, async () => {
    await dealDamage(battle, { source: a, target: dst, base: a.prop("atk") * ratio, rate: 1, type: ctx.result.type, skillTag: ECHO_TAG });
  });
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const a = entities.find(isAmaterasu556);   // 唯一效果
  if (!a) return out;
  const reg = (code: string, fn: (ctx: any) => Promise<void> | void, passive = true) =>
    registerOwnerHandler(battle, "betting:556:" + code + ":" + a.id, a.id, code, fn, "ALL", { passive });
  // 无灭: the echo and 光涤 are passive lines (sealed with her passive; stop when she dies).
  reg(EV.AFTER_DAMAGE, async (ctx: any) => {
    await echo(battle, a, ctx);
    const src: Entity | undefined = ctx?.input?.source;
    if (ctx?.input?.target?.id !== a.id || !src || src.teamId === a.teamId || !src.alive || !a.alive) return;
    const tag = String(ctx.input.skillTag ?? "");
    if (!ctx.result?.triggersSoul || tag.startsWith("soul:") || isReflectDamage(ctx)) return;
    if (src.statuses.some(s => s.def.id === PURGE_ID && s.sourceId === a.id)) return;
    await applyContested(battle, a, src, purgeDef(), null, AMATERASU.purgeTurns, [{ prop: "def", value: AMATERASU.purgeDef, mode: "FIXED" }], { skill: "无灭", ref: PURGE_ID });
  });
  reg(EV.BEFORE_DAMAGE, (ctx: any) => {
    const src: Entity | undefined = ctx?.input?.source;
    if (ctx?.input?.target?.id !== a.id || !src || !ctx.result || ctx.result.ignoresModifiers) return;
    if (src.statuses.some(s => s.def.id === PURGE_ID && s.sourceId === a.id)) ctx.result.final *= 1 - AMATERASU.purgeCut;
  });
  reg(EV.DEATH, (ctx: any) => {
    const v: Entity | undefined = ctx?.target;
    if (!v || v.teamId === a.teamId || ctx?.killerId !== a.id || !a.alive) return;
    shiftBar(battle, a, AMATERASU.killBar, "无灭");
  });
  // 天晖's lethal save belongs to the mark (not to the passive): it works while she lives.
  ensureGlobalHandler(battle, "betting:556:radiance-save:" + a.id, EV.AFTER_DAMAGE, (ctx: any) => {
    const t: Entity | undefined = ctx?.input?.target;
    if (!t || !t.hpZero || t.dead || !a.alive || !(a.hp > 0)) return;
    if (!t.statuses.some(s => s.def.id === RADIANCE_ID && s.sourceId === a.id)) return;
    t.hp = 1; t.hpZero = false;
    if (a.hp > 1) a.hp -= 1;
    battle.trace.push({ t: "UNDYING", id: t.id, src: ctx?.input?.source?.id ?? null, by: RADIANCE_ID, keep: "ONE", hpBefore: 0, hpAfter: 1, exhausted: false, undeathUsed: false, giver: a.id });
  });
  out.push({ entityId: a.id, mechanic: "天晖 (highest-initial-ATK ally: −15% ATK, +20% bar, 1-HP save) · 无灭 echo 70% · 光涤 · L5 kill +50% bar · 神圣裁决 → highest-HP enemy" });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "556_02": { note: "无灭: echo, 光涤 and the L5 kill bar are run by betting-amaterasu.ts", patch: { damage: [], statusRefConditionOnly: [0, 1] } },
    "556_03": { note: "神圣裁决: 天晖 goes to the other ally with the highest initial ATK (betting-amaterasu.ts), not to Amaterasu", patch: { statusRefConditionOnly: [0] } },
  }),
  target,
  afterCast,
  install,
};
