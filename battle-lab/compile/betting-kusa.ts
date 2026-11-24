// compile/betting-kusa.ts — 渺念萤草 (SP 555, Global "Kusa Regrown", fandom "Byounen Hotarugusa") at max skill level.
// MAX (betting) mode only (match 8, 2026-11-23h).
//
// Sources: data/kb/shikigami.json 555_01..555_03, buff 5551_1 种子, tips_5552 蒲公英之力; data/kb/en-text.json (Global,
// preferred); fandom "Byounen_Hotarugusa/Main" (older wording: its L5 says the indirect-damage clause *decreases*
// the consumption — the KB / Global text says it increases; KB used).
//   蒲公英之力 Dandelion Force (tips_5552) · overflow healing received by non-summon allies (herself included) is
//       stored. At most 1800% of her initial ATK (kbBaseAtk) can be stored per window; the window (the stored-amount
//       counter, not the force) resets at the start of her own turn. Reading: the stored force itself persists
//       until spent (the text only resets the cap; she spends it during her own turns, so clearing it at her turn
//       start would make it unusable). Overflow = requested heal − applied heal, the requested heal being the heal
//       event's base × crit multiplier (crit-able heals carry it on the HEAL event) × (1 − heal reduction) × endgame
//       heal multiplier.
//   流光之箭 (555_01) · 120% ATK to the target, then spends min(force, 200% initial ATK) and deals the spent amount to
//       the same target as TRUE damage (ignores DEF, cannot crit; damage modifiers apply — doubt: the game may treat
//       it as fixed damage).
//   渺渺一旅 (555_02, passive, 唯一) · never cast (the KB lists cost 1; gated). At the end of her turn she gains 2 种子
//       (sustained 1 turn = through the end of her next turn); L4 the other allies also gain 2; L5 先机: all non-summon
//       allies gain 2 at battle start. On a normal attack (any 流光之箭, counters included), after the arrow: for
//       every 345% ATK of force still stored (max 3) roll 30%; each success spends 345% ATK of force and deals it to the
//       same target (TRUE). Doubt: "追击1次蒲公英之力的伤害" could also mean a hit that does not spend force.
//       L2: +30 DEF per seed she carries; +8 SPD for 1 turn per seed of hers removed. L3: one of her seeds removed by
//       something other than an enemy attack (HP loss, allied damage) ⇒ +15% ATK for 1 turn.
//   种子 5551_1 (general mark, 唯一, max 2) · when the bearer's HP decreases (damage that reaches HP, HP loss), 1 seed is
//       removed and the bearer is healed 35% of Kusa's ATK — every removed seed heals ("若种子消失" read per seed: match 8
//       shows a 3.4–4.9k green heal right after most Red hits on Blue units, already on the first hit of the battle).
//       Indirect damage instead converts the damage taken into force, heals the bearer 70% (doubled) of Kusa's ATK and
//       keeps the seed — at most once per attack (enemy action). Seeds are sourced by Kusa; their heals need her alive.
//   Heal crits (betting): all her heals can crit with her crit rate / crit damage — match 8: the seed heal 4067 =
//       1883 (her 35% heal, Bamboo-buffed ATK 5380) × 2.16 (her crit damage); later 4117 / 4922 / 3420 likewise.
//   萤光落世 (555_03, 2 onibi) · 183% ATK to every enemy; spends min(force, (340% + L5 bonus) initial ATK) and deals it
//       split evenly among the living enemies (TRUE); heals all allies 35% of her ATK. The compiled IR targeted an ally
//       and hit one enemy (patched: enemy scope, heal moved to afterCast). L5: after every skill use the consumption
//       rises by 120% (max +360%, never reset — the text names no reset); taking indirect damage herself also +120%
//       (once per attack, same cap).
//   AI (KB) · "3技能" unconditional — the generic rule casts 萤光落世 when affordable, else 流光之箭.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { envHealMultiplier } from "../kernel/environment.ts";
import type { BettingKit, Hook, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler,
  kbBaseAtk, stacksOn, setStackedStatus, entityById,
} from "./betting-shared.ts";

export const KUSA = Object.freeze({
  arrowRatio: 120, arrowSpend: 2.0, pursuitStep: 3.45, pursuitChance: 0.3, pursuitMax: 3,
  storeCap: 18, seeds: 2, seedHeal: 0.35, seedDef: 30, seedSpd: 8, seedAtk: 0.15,
  smashRatio: 183, smashSpend: 3.4, smashStep: 1.2, smashStepMax: 3.6, smashHeal: 0.35,
  seedTurns: 2,
});

export const SEED_ID = "5551_1";
export const SEED_SPD_ID = "5551_spd";
export const SEED_ATK_ID = "5551_atk";
const N_FORCE = "kusa555:force=", N_WIN = "kusa555:window=", N_BONUS = "kusa555:bonus=", N_IND = "kusa555:indirect=", N_SELF_IND = "kusa555:selfIndirect=";

const seedDef = () => markDef({ id: SEED_ID, name: "种子", category: StatusCategory.COMMON_MARK, durationPolicy: "SOURCE_TURN",
  desc: "【通用、印记】唯一效果。生命降低时，移除1颗种子；若种子消失，治疗等同于渺念萤草攻击35%的生命。受到间接伤害时，将受到的间接伤害等量转化为蒲公英之力，同时治疗量翻倍且不移除种子，单次攻击最多触发1次。" }, StatusBook);
const spdDef = () => markDef({ id: SEED_SPD_ID, name: "种子·加速", category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "渺渺一旅：每消耗1个种子，自身提升8点速度，持续1回合。" }, StatusBook);
const atkDef = () => markDef({ id: SEED_ATK_ID, name: "种子·攻击提升", category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "渺渺一旅：非敌方攻击造成的种子减少时，提升15%攻击，持续1回合。" }, StatusBook);

export const isKusa555 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "555_02") && !!skillById(e, "555_03");
const num = (e: Entity, k: string): number => Number(noteValue(e, k) ?? 0) || 0;
export const forceOf = (k: Entity): number => num(k, N_FORCE);
export const smashBonusOf = (k: Entity): number => num(k, N_BONUS);
export const seedsOf = (e: Entity): number => stacksOn(e, SEED_ID);
const kusaOfTeam = (battle: any, teamId: number): Entity | null =>
  (battle.teams[teamId]?.members ?? []).find((m: Entity) => m.alive && isKusa555(m)) ?? null;
const kusaById = (battle: any, id: number): Entity | null => { const e = entityById(battle, id); return e && isKusa555(e) ? e : null; };

function setForce(k: Entity, v: number): void { setNote(k, N_FORCE, String(Math.max(0, v))); }

/** Adds force (respecting the per-window cap); returns the amount stored. */
function store(battle: any, k: Entity, amount: number, dst: Entity, reason: string): number {
  if (!(amount > 0)) return 0;
  const cap = kbBaseAtk(k) * KUSA.storeCap;
  const win = num(k, N_WIN);
  const add = Math.min(amount, Math.max(0, cap - win));
  if (!(add > 0)) return 0;
  const before = forceOf(k);
  setForce(k, before + add);
  setNote(k, N_WIN, String(win + add));
  battle.trace.push({ t: "DANDELION_STORE", id: k.id, dst: dst.id, amount: GameMath.display(add), before: GameMath.display(before), after: GameMath.display(before + add), reason, skill: "渺渺一旅" });
  return add;
}

/** Spends up to `want` force; returns the amount spent. */
function spend(battle: any, k: Entity, want: number, reason: string, skill: string, targets: Entity[]): number {
  const before = forceOf(k);
  const amt = Math.min(before, Math.max(0, want));
  if (!(amt > 0)) return 0;
  setForce(k, before - amt);
  battle.trace.push({ t: "DANDELION_SPEND", id: k.id, amount: GameMath.display(amt), before: GameMath.display(before), after: GameMath.display(before - amt), reason, skill, targets: targets.map(t => t.id) });
  return amt;
}

function grantSeeds(battle: any, k: Entity, e: Entity, duration: number, reason: string): void {
  if (!e.alive || isSummonUnit(e)) return;
  const def = seedDef();
  for (const st of [...e.statuses]) if (st.def.id === SEED_ID && st.sourceId !== k.id) e.expireStatus(st);   // 唯一效果
  const per = e.id === k.id ? [{ prop: "def", value: KUSA.seedDef, mode: "FIXED" as const }] : [];
  const n = setStackedStatus(e, def, KUSA.seeds, KUSA.seeds, k.id, per, duration);
  battle.trace.push({ t: "STATUS_APPLY", src: k.id, dst: e.id, status: SEED_ID, name: def.name, category: def.category, duration, ref: SEED_ID, known: true, stacks: n, reason, skill: "渺渺一旅" });
}

/** One seed removed from `e` (HP decreased). `byEnemyAttack` drives L3. */
async function removeSeed(battle: any, e: Entity, byEnemyAttack: boolean, reason: string): Promise<void> {
  const st = e.statuses.find(s => s.def.id === SEED_ID);
  if (!st) return;
  const k = kusaById(battle, st.sourceId);
  const from = st.stacks;
  const per = k && e.id === k.id ? [{ prop: "def", value: KUSA.seedDef, mode: "FIXED" as const }] : [];
  const to = setStackedStatus(e, st.def, from - 1, KUSA.seeds, st.sourceId, per, st.remaining);
  battle.trace.push({ t: "STACKS_CONSUMED", id: e.id, status: SEED_ID, name: "种子", from, to, reason, skill: "渺渺一旅" });
  if (!k) return;
  if (e.id === k.id) {
    const spd = spdDef();
    const nSpd = stacksOn(k, SEED_SPD_ID) + 1;
    setStackedStatus(k, spd, nSpd, 99, k.id, [{ prop: "spd", value: KUSA.seedSpd, mode: "FIXED" }], 1);
    if (!byEnemyAttack) setStackedStatus(k, atkDef(), 1, 1, k.id, [{ prop: "atk", value: KUSA.seedAtk, mode: "ADD_RATE" }], 1);
  }
  if (k.alive && e.alive) await battle.heal(k, e, k.prop("atk") * KUSA.seedHeal, { crit: true });
}

/** Seed reactions to an HP decrease of a bearer. */
async function onHurt(battle: any, ctx: any): Promise<void> {
  const e: Entity | undefined = ctx?.input?.target;
  const src: Entity | undefined = ctx?.input?.source;
  if (!e?.alive) return;
  const type = ctx?.result?.type;
  if (type === DamageType.INDIRECT) {
    const action = battle.turn + ":" + (src?.id ?? 0);
    const dealt = Number(ctx.result.final ?? 0);
    // L5: Kusa herself takes indirect damage ⇒ +120% consumption (once per attack).
    if (isKusa555(e) && noteValue(e, N_SELF_IND) !== action) {
      setNote(e, N_SELF_IND, action);
      setNote(e, N_BONUS, String(Math.min(KUSA.smashStepMax, smashBonusOf(e) + KUSA.smashStep)));
    }
    if (!seedsOf(e) || noteValue(e, N_IND) === action) return;
    const st = e.statuses.find(s => s.def.id === SEED_ID)!;
    const k = kusaById(battle, st.sourceId);
    if (!k?.alive) return;
    setNote(e, N_IND, action);
    store(battle, k, dealt, e, "INDIRECT_DAMAGE");
    await battle.heal(k, e, k.prop("atk") * KUSA.seedHeal * 2, { crit: true });
    return;
  }
  if (!(Number(ctx?.result?.applied ?? 0) > 0) || !seedsOf(e)) return;
  const byEnemyAttack = !!src && src.teamId !== e.teamId;
  await removeSeed(battle, e, byEnemyAttack, byEnemyAttack ? "HP_DECREASED" : "HP_DECREASED_NON_ENEMY");
}

/** Overflow of a heal received by a non-summon ally of Kusa. */
function onHeal(battle: any, k: Entity, ctx: any): void {
  const dst: Entity | undefined = ctx?.target;
  if (!dst || dst.teamId !== k.teamId || isSummonUnit(dst) || ctx.recover) return;
  if (!(Number(ctx.hpAfter) >= dst.maxHp - 1e-9)) return;
  const requested = Number(ctx.base ?? 0) * Number(ctx.crit ?? 1) * (1 - Math.min(1, Math.max(0, dst.prop("healDown")))) * envHealMultiplier(battle.environment);
  const over = requested - Number(ctx.amount ?? 0);
  if (over > 1e-6) store(battle, k, over, dst, "OVERFLOW_HEAL");
}

const ratioOf = (x: any, dflt: number): number => Number(x?.damage?.[0]?.ratioMax ?? x?.damage?.[0]?.ratio ?? dflt);

function arrowHook(x: any): Hook {
  return {
    kind: "DANDELION_ARROW",
    run: async (battle, k, hurt, primary) => {
      const enemies = () => battle.enemiesOf(k.teamId).filter((v: Entity) => v.alive);
      const target: Entity | undefined = primary?.alive && primary.teamId !== k.teamId ? primary : enemies()[0];
      if (!target) return;
      hurt.push(target);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        await battle.damage(k, target, k.prop("atk") * (ratioOf(x, KUSA.arrowRatio) / 100), DamageType.NORMAL, 1, null);
      });
      if (!isKusa555(k)) return;
      if (target.alive) {
        const amt = spend(battle, k, kbBaseAtk(k) * KUSA.arrowSpend, "ARROW", x.name, [target]);
        if (amt > 0) await battle.withinResolution({ id: "HIT:" + x.name + "#force", type: "HIT" }, async () => {
          await battle.damage(k, target, amt, DamageType.TRUE, 1, null);
        });
      }
      // 渺渺一旅: pursuit rolls on a normal attack.
      const step = k.prop("atk") * KUSA.pursuitStep;
      const rolls = step > 0 ? Math.min(KUSA.pursuitMax, GameMath.floorAt(forceOf(k) / step, "KUSA_PURSUIT_ROLLS")) : 0;
      for (let i = 0; i < rolls; i++) {
        if (!target.alive || !k.alive) break;
        battle.rng.expect("kusa555_pursuit");
        if (!battle.rng.testHit(KUSA.pursuitChance)) continue;
        const amt = spend(battle, k, step, "PURSUIT", "渺渺一旅", [target]);
        if (!(amt > 0)) break;
        await battle.withinResolution({ id: "HIT:渺渺一旅#pursuit" + (i + 1), type: "HIT" }, async () => {
          await battle.damage(k, target, amt, DamageType.TRUE, 1, null);
        });
      }
    },
  };
}

function smashHook(x: any): Hook {
  return {
    kind: "DANDELION_SMASH",
    run: async (battle, k, hurt) => {
      const enemies = () => battle.enemiesOf(k.teamId).filter((v: Entity) => v.alive) as Entity[];
      const first = enemies();
      if (!first.length) return;
      for (const v of first) if (!hurt.includes(v)) hurt.push(v);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        for (const v of first) {
          if (!v.alive) continue;
          await battle.damage(k, v, k.prop("atk") * (ratioOf(x, KUSA.smashRatio) / 100), DamageType.NORMAL, 1, null);
        }
      });
      if (!isKusa555(k)) return;
      const alive = enemies();
      if (!alive.length) return;
      const amt = spend(battle, k, kbBaseAtk(k) * (KUSA.smashSpend + smashBonusOf(k)), "SMASH", x.name, alive);
      if (!(amt > 0)) return;
      const each = amt / alive.length;
      await battle.withinResolution({ id: "HIT:" + x.name + "#force", type: "HIT" }, async () => {
        for (const v of alive) if (v.alive) await battle.damage(k, v, each, DamageType.TRUE, 1, null);
      });
    },
  };
}

async function afterCast(battle: any, k: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || (x?.id !== "555_01" && x?.id !== "555_03") || !isKusa555(k)) return false;
  if (x.id === "555_03") {
    for (const m of battle.teams[k.teamId].aliveMembers() as Entity[]) {
      if (m.alive) await battle.heal(k, m, k.prop("atk") * KUSA.smashHeal, { crit: true });
    }
  }
  // L5: every skill use raises 萤光落世's consumption by 120% (max +360%).
  setNote(k, N_BONUS, String(Math.min(KUSA.smashStepMax, smashBonusOf(k) + KUSA.smashStep)));
  return true;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const seen = new Set<number>();
  for (const k of entities.filter(isKusa555)) {
    if (seen.has(k.teamId)) continue;   // 唯一效果: one Kusa per side
    seen.add(k.teamId);
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = true) =>
      registerOwnerHandler(battle, "betting:555:" + code + ":" + k.id, k.id, code, fn, range, { passive });
    const mates = () => (battle.teams[k.teamId].members as Entity[]).filter(m => m.alive && !isSummonUnit(m));
    reg(EV.BATTLE_START, () => {
      battle.trace.push({ t: "SUBCAST", actor: k.id, ref: "555_02", skill: "渺渺一旅", target: k.id, clause: "[tips_7]先机：为非召唤物全体友方附加2颗[buff_5551_1]" });
      for (const m of mates()) grantSeeds(battle, k, m, 1, "SENKI");
    }, "SELF");
    reg(EV.TURN_START, (ctx: any) => { if (ctx?.actor?.id === k.id) setNote(k, N_WIN, "0"); }, "SELF");
    reg(EV.TURN_END, (ctx: any) => {
      if (ctx?.actor?.id !== k.id || !k.alive) return;
      grantSeeds(battle, k, k, KUSA.seedTurns, "TURN_END");
      for (const m of mates()) if (m.id !== k.id) grantSeeds(battle, k, m, KUSA.seedTurns, "TURN_END_L4");
    }, "SELF");
    reg(EV.HEAL, (ctx: any) => onHeal(battle, k, ctx), "ALL");
    // Seeds are marks: their reactions run whatever happens to Kusa's passive (global handlers, once per battle).
    ensureGlobalHandler(battle, "betting:555:seed-hurt", EV.AFTER_DAMAGE, (ctx: any) => onHurt(battle, ctx));
    ensureGlobalHandler(battle, "betting:555:seed-loss", EV.HP_LOSS, async (ctx: any) => {
      const e: Entity | undefined = ctx?.target;
      if (e?.alive && seedsOf(e) && Number(ctx.amount ?? 0) > 0) await removeSeed(battle, e, false, "HP_LOST");
    });
    out.push({ entityId: k.id, mechanic: "蒲公英之力 (overflow heal store, 1800% cap per window) · 种子 (L5 先机, turn-end 2 seeds, L4 allies) · 流光之箭 spend 200% + pursuits · 萤光落世 AOE + split force + heal 35% ATK, L5 +120%/use" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "555_01": { note: "流光之箭: an enemy-target attack (IR targeting read 自身); force spending and pursuits run in betting-kusa.ts", patch: { targeting: ["敌方目标"] } },
    "555_03": { note: "萤光落世: all-enemy damage + split force (betting-kusa.ts damage hook); ally heal 35% ATK in afterCast", patch: { targeting: ["敌方全体"], heal: [] } },
  }),
  damageHook: (x: any) => (!bettingActive() ? null : x?.id === "555_01" ? arrowHook(x) : x?.id === "555_03" ? smashHook(x) : null),
  gate: (_battle, self, sk) => (bettingActive() && sk?.ir?.id === "555_02" && isKusa555(self) ? "PASSIVE_NOT_CASTABLE" : null),
  afterCast,
  install,
};
