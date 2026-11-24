// compile/betting-hitotsume.ts — 独眼小僧 (R 230, Global "Hitotsume") at max skill level. MAX mode only (match 8).
//
// Sources: data/kb/shikigami.json 230_01..230_03, buff 2302_1 金刚经; data/kb/en-text.json (Global); fandom
// "Hitotsume Kozou/Main" (its L5 line says 15%, a copy of L3 — the KB / Global L5 is 20%).
//   投石 (230_01) / 石像冲击 (230_03, 195%, 25% base chance 眩晕 1 turn) · the compiled skills already do this.
//   金刚经 (230_02, passive) · whenever Hitotsume takes damage, every living ally (himself included) gains 金刚经 for
//       1 turn (re-applied = refreshed, never stacked): +20% effect RES (L4) and 20% damage reflection (L5).
//       The generic passive runtime is off on the betting path, so the buff never appeared before this kit.
//   Reflection · a 金刚经 bearer that takes soul-triggering damage from an enemy (attacks: no DoT / indirect /
//       conduction / soul procs / other reflections) returns 20% of the damage it took (HP + shield) to the attacker
//       as FIXED damage that triggers no souls (tag REFLECT_TAG; counters and "when attacked" rules ignore it).
// Readings (unverified): the reflected damage type (FIXED, like the 镜姬 soul); "受到伤害时" counts any damage of any
// source with a positive amount (shield-absorbed included), reflections and soul procs too.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { dealDamage } from "../kernel/damage.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler } from "./betting-shared.ts";

export const HITOTSUME = Object.freeze({ res: 0.2, reflect: 0.2, turns: 1 });
export const SUTRA_ID = "2302_1";
/** Skill tag of reflected damage (other kits skip it when they look for "attacks"). */
export const REFLECT_TAG = "reflect:金刚经";
export const isReflectDamage = (ctx: any): boolean => String(ctx?.input?.skillTag ?? "").startsWith("reflect:");

const sutraDef = () => markDef({ id: SUTRA_ID, name: "金刚经", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【增益、印记】提升20%效果抵抗、20%反伤。" }, StatusBook);

export const isHitotsume230 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "230_02") && !!skillById(e, "230_03");

function grantSutra(battle: any, h: Entity): void {
  for (const a of battle.teams[h.teamId].aliveMembers() as Entity[]) {
    for (const st of [...a.statuses]) if (st.def.id === SUTRA_ID) a.expireStatus(st);
    const def = sutraDef();
    const s = a.addStatus(def, h.id, 1, HITOTSUME.turns, [{ prop: "efr", value: HITOTSUME.res, mode: "FIXED" }], 1);
    battle.trace.push({ t: "STATUS_APPLY", src: h.id, dst: a.id, status: SUTRA_ID, name: def.name, category: def.category, duration: HITOTSUME.turns, ref: SUTRA_ID, known: true, tag: (s as any)?.tag ?? null, skill: "金刚经" });
  }
}

/** Damage that counts as an enemy attack for the reflection. */
const reflectable = (ctx: any): boolean => {
  const res = ctx?.result;
  if (!res?.triggersSoul || isReflectDamage(ctx)) return false;
  const tag = String(ctx?.input?.skillTag ?? "");
  return !tag.startsWith("soul:");
};

async function reflect(battle: any, bearer: Entity, ctx: any): Promise<void> {
  const src: Entity | undefined = ctx?.input?.source;
  if (!src || src.teamId === bearer.teamId || !src.alive || !(src.hp > 0) || !reflectable(ctx)) return;
  if (!bearer.statuses.some(s => s.def.id === SUTRA_ID)) return;
  const taken = Number(ctx.result.applied ?? 0) + Number(ctx.result.absorbed ?? 0);
  if (!(taken > 0)) return;
  const amount = taken * HITOTSUME.reflect;
  battle.trace.push({ t: "REFLECT", src: bearer.id, dst: src.id, taken: GameMath.display(taken), amount: GameMath.display(amount), ratio: HITOTSUME.reflect, skill: "金刚经" });
  await dealDamage(battle, { source: bearer, target: src, base: amount, rate: 1, type: DamageType.FIXED, skillTag: REFLECT_TAG, noSoul: true });
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const h of entities.filter(isHitotsume230)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, passive = true) =>
      registerOwnerHandler(battle, "betting:230:" + code + ":" + h.id, h.id, code, fn, "ALL", { passive });
    reg(EV.AFTER_DAMAGE, (ctx: any) => {
      if (ctx?.input?.target?.id !== h.id || !h.alive) return;
      const amount = Number(ctx?.result?.applied ?? 0) + Number(ctx?.result?.absorbed ?? 0);
      if (amount > 0) grantSutra(battle, h);
    });
    out.push({ entityId: h.id, mechanic: "金刚经 (on damage taken: allies +20% effect RES, 20% reflection, 1 turn)" });
  }
  // The reflection belongs to the buff (it keeps working while Hitotsume is dead or sealed): one global handler.
  if (out.length) {
    ensureGlobalHandler(battle, "betting:230:reflect", EV.AFTER_DAMAGE, async (ctx: any) => {
      const t: Entity | undefined = ctx?.input?.target;
      if (t?.alive && t.statuses.some(s => s.def.id === SUTRA_ID)) await reflect(battle, t, ctx);
    });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "230_02": { note: "金刚经: the on-damage grant (+20% effect RES, 20% reflection) is run by betting-hitotsume.ts", patch: { statusRefConditionOnly: [0] } },
  }),
  install,
};
