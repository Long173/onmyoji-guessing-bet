// compile/betting-asura.ts — 阿修罗 (SSR 364, Global "Asura") at max skill level. MAX mode only (match 9).
//
// Sources: data/kb/shikigami.json 364_01..364_03, buffs 3641_1 理性 / 3645_1 诛灭; data/kb/en-text.json (Global);
// fandom "Asura/Main" (Endless Slaughter text and numbers — not in the KB); a CN guide (via web search) for the
// slaughter targets ("除自身外全场随机目标" — allies included).
// Before (engine trace, 24a): none of 364_02 ran (no Reason at all ⇒ no damage suppression, no heals, no control
// immunity, no DR), 364_01 put 诛灭 (ATK -50%) on ASURA himself after a kill, 364_03 put a 1-turn 理性 on him.
//   理性 Reason (364_02 / 3641_1) · 0..9 points (a stacked mark here). 9 at battle start and at the start of each of
//       his turns (Mighty Crush form). Every point restored heals 8% of his max HP. Before each attack he spends as
//       many points as the attack has targets. Each point held suppresses the damage he deals by 6% (L4; applied at
//       hit time, after the spend, multiplicatively). L5: each point lost (9 − held) reduces his damage taken by 6%.
//       Below 9 points: immune to control and banish (a hidden-rule status 天魔威压 with immuneTo CONTROL/BANISH).
//       Evolution: +10% damage against a target whose initial SPD is lower than his (initial = panel at install).
//   红莲诛灭 (364_01) · 1 point, 120%. Any kill by Asura: 诛灭 (ATK -50%, permanent) on the VICTIM, and 天魔威压 is
//       replaced by 无间杀戮 (Endless Slaughter form).
//   炼狱虐杀 (364_03, 3 onibi) · spends one point per living enemy, 315% to all enemies; then 63% follow-ups on the
//       selected target, one point each, until Reason runs out. L5: the target dies with points left ⇒ the
//       follow-ups move to the living enemy with the lowest HP.
//   无间杀戮 Endless Slaughter (fandom) · immune to control / banish; no turn-start refill. At the end of another
//       non-summon ally's turn: +1 point (heals 8%). At the start of his turn: 9 points ⇒ back to Mighty Crush (and
//       its refill); fewer ⇒ a giant sword hits a random unit other than himself (either side) for 263%, then a
//       sword rain hits every other living unit (either side) for 113%. He then acts normally.
// Readings (unverified, see the report): the suppression / DR / SPD bonus are multiplicative with the other damage
// modifiers; the slaughter strike spends no Reason (its text does not say so) while his skills keep spending it
// in both forms (炼狱虐杀's follow-ups need the spend); the Reason mark rule (suppression) is not a passive, every
// other rule is (sealed by 压制); 诛灭 only matters if the victim is revived (no reviver in 24a).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, setStackedStatus, stacksOn,
} from "./betting-shared.ts";

export const ASURA = Object.freeze({
  cap: 9, suppress: 0.06, healPerPoint: 0.08, drPerLost: 0.06, spdBonus: 0.10,
  basicRatio: 120, aoeRatio: 315, followRatio: 63, swordRatio: 263, rainRatio: 113, annihilateAtk: -0.5,
});
export const REASON_ID = "364_reason";
export const GUARD_ID = "364_guard";
export const ANNIHILATE_ID = "364_annihilate";
const N_FORM = "asura364:form=";

const reasonDef = () => markDef({ id: REASON_ID, name: "理性", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】上限9点。每回复1点理性，恢复最大生命值8%的生命。每点理性使阿修罗造成的伤害降低6%（L4）。" }, StatusBook);
const guardDef = (form: string) => markDef({ id: GUARD_ID + (form === "SLAUGHTER" ? "_s" : ""), name: form === "SLAUGHTER" ? "无间杀戮" : "天魔威压",
  category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL", immuneTo: ["CONTROL", "BANISH"],
  desc: form === "SLAUGHTER" ? "无间杀戮：免疫控制和放逐效果。" : "天魔威压：理性不足9点时，免疫控制和放逐效果。" }, StatusBook);
const annihilateDef = () => markDef({ id: ANNIHILATE_ID, name: "诛灭", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】攻击永久下降50%。" }, StatusBook);

export const isAsura364 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "364_02") && !!skillById(e, "364_03");
export const reasonOf = (e: Entity): number => stacksOn(e, REASON_ID);
export const asuraForm = (e: Entity): "CRUSH" | "SLAUGHTER" => (noteValue(e, N_FORM) === "SLAUGHTER" ? "SLAUGHTER" : "CRUSH");
export const asuraImmune = (e: Entity): boolean => e.statuses.some(s => s.def.id.startsWith(GUARD_ID));

/** Initial SPD per battle (recorded at install). */
const initialSpd = new WeakMap<object, Map<number, number>>();
const spd0 = (battle: any, e: Entity): number => initialSpd.get(battle)?.get(e.id) ?? e.prop("spd");

function refreshGuard(a: Entity): void {
  const form = asuraForm(a);
  const want = a.alive && (form === "SLAUGHTER" || reasonOf(a) < ASURA.cap);
  const wantId = GUARD_ID + (form === "SLAUGHTER" ? "_s" : "");
  for (const st of [...a.statuses]) if (st.def.id.startsWith(GUARD_ID) && (!want || st.def.id !== wantId)) a.expireStatus(st);
  if (want && !a.hasStatus(wantId)) a.addStatus(guardDef(form), a.id, 1, PERSIST, [], 1);
}

/** Sets Reason to `n` (clamped); every point restored heals 8% of max HP. */
export async function setReason(battle: any, a: Entity, n: number, reason: string, skill = "天魔威压"): Promise<number> {
  const before = reasonOf(a);
  const next = setStackedStatus(a, reasonDef(), n, ASURA.cap, a.id, []);
  if (next !== before) battle.trace.push({ t: "STACKS_SET", id: a.id, status: REASON_ID, name: "理性", from: before, to: next, reason, skill });
  refreshGuard(a);
  if (next > before && a.alive) await battle.heal(a, a, a.maxHp * ASURA.healPerPoint * (next - before), { crit: false });
  return next;
}

/** "每次攻击前消耗对应攻击目标数量的理性". */
async function spend(battle: any, a: Entity, targets: number, skill: string): Promise<void> {
  const r = reasonOf(a);
  if (r > 0 && targets > 0) await setReason(battle, a, r - Math.min(r, targets), "ATTACK", skill);
}

const aliveEnemies = (battle: any, a: Entity): Entity[] => (battle.enemiesOf(a.teamId) as Entity[]).filter(v => v.alive);
const lowestHp = (l: Entity[]): Entity | null => l.reduce<Entity | null>((m, v) => (!m || v.hp < m.hp ? v : m), null);

async function hit(battle: any, a: Entity, v: Entity, ratio: number, id: string): Promise<void> {
  await battle.withinResolution({ id, type: "HIT" }, async () => {
    if (v.alive) await battle.damage(a, v, a.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, null);
  });
}

function damageHook(x: any): any {
  if (x?.id === "364_01") return {
    kind: "ASURA_BASIC",
    run: async (battle: any, a: Entity, hurt: Entity[], primary?: Entity) => {
      const v = primary?.alive && primary.teamId !== a.teamId ? primary : aliveEnemies(battle, a)[0];
      if (!v) return;
      hurt.push(v);
      await spend(battle, a, 1, x.name);
      await hit(battle, a, v, Number(x.damage?.[0]?.ratioMax ?? ASURA.basicRatio), "HIT:" + x.name + "#1");
    },
  };
  if (x?.id === "364_03") return {
    kind: "ASURA_PURGATORY",
    run: async (battle: any, a: Entity, hurt: Entity[], primary?: Entity) => {
      const all = aliveEnemies(battle, a);
      if (!all.length) return;
      hurt.push(...all);
      await spend(battle, a, all.length, x.name);
      await battle.withinResolution({ id: "HIT:" + x.name + "#aoe", type: "HIT" }, async () => {
        for (const v of all) if (v.alive) await battle.damage(a, v, a.prop("atk") * (ASURA.aoeRatio / 100), DamageType.NORMAL, 1, null);
      });
      let v: Entity | null = primary?.alive && primary.teamId !== a.teamId ? primary : null;
      let n = 0;
      while (a.alive && reasonOf(a) > 0) {
        if (!v?.alive) v = lowestHp(aliveEnemies(battle, a));   // L5: the follow-ups move to the lowest-HP enemy
        if (!v) break;
        n++;
        await spend(battle, a, 1, x.name);
        await hit(battle, a, v, ASURA.followRatio, "HIT:" + x.name + "#follow" + n);
      }
    },
  };
  return null;
}

/** 无间杀戮 at the start of his turn (Reason < 9): 263% to a random other unit, 113% to every other unit. */
export async function slaughter(battle: any, a: Entity): Promise<void> {
  const pool = (battle.allEntities() as Entity[]).filter(u => u.alive && u.id !== a.id);
  if (!pool.length) return;
  battle.rng.expect("asura364_sword");
  const big = battle.rng.pick(pool) as Entity;
  battle.trace.push({ t: "SUBSKILL", actor: a.id, skill: "无间杀戮", form: "无间杀戮", target: big.id });
  await hit(battle, a, big, ASURA.swordRatio, "HIT:无间杀戮#sword");
  await battle.withinResolution({ id: "HIT:无间杀戮#rain", type: "HIT" }, async () => {
    for (const u of pool) if (u.id !== big.id && u.alive && a.alive) await battle.damage(a, u, a.prop("atk") * (ASURA.rainRatio / 100), DamageType.NORMAL, 1, null);
  });
}

export function setForm(battle: any, a: Entity, form: "CRUSH" | "SLAUGHTER", reason: string): void {
  const from = asuraForm(a);
  if (from === form) return;
  setNote(a, N_FORM, form === "SLAUGHTER" ? "SLAUGHTER" : null);
  battle.trace.push({ t: "SKILL_VARIANT", actor: a.id, skill: from === "SLAUGHTER" ? "无间杀戮" : "天魔威压", variant: form === "SLAUGHTER" ? "无间杀戮" : "天魔威压", reason });
  refreshGuard(a);
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isAsura364);
  if (!units.length) return out;
  const m = new Map<number, number>();
  for (const e of battle.allEntities() as Entity[]) m.set(e.id, e.prop("spd"));
  initialSpd.set(battle, m);
  for (const a of units) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = true, k = "") =>
      registerOwnerHandler(battle, "betting:364:" + code + k + ":" + a.id, a.id, code, fn, range, { passive });
    reg(EV.BATTLE_START, async () => { if (asuraForm(a) === "CRUSH") await setReason(battle, a, ASURA.cap, "BATTLE_START"); }, "SELF");
    reg(EV.TURN_START, async (ctx: any) => {
      if (ctx?.actor?.id !== a.id || !a.alive) return;
      if (asuraForm(a) === "SLAUGHTER") {
        if (reasonOf(a) >= ASURA.cap) setForm(battle, a, "CRUSH", "REASON_FULL");
        else { await slaughter(battle, a); return; }
      }
      await setReason(battle, a, ASURA.cap, "TURN_START");
    });
    reg(EV.TURN_END, async (ctx: any) => {
      const u: Entity | undefined = ctx?.actor;
      if (!u || u.id === a.id || u.teamId !== a.teamId || isSummonUnit(u) || !a.alive || asuraForm(a) !== "SLAUGHTER") return;
      await setReason(battle, a, reasonOf(a) + 1, "ALLY_TURN_END", "无间杀戮");
    });
    reg(EV.DEATH, (ctx: any) => {
      const v: Entity | undefined = ctx?.target;
      if (ctx?.killerId !== a.id || !v || v.teamId === a.teamId) return;
      if (!v.hasStatus(ANNIHILATE_ID)) {
        const def = annihilateDef();
        const s = v.addStatus(def, a.id, 1, PERSIST, [{ prop: "atk", value: ASURA.annihilateAtk, mode: "ADD_RATE" }], 1);
        battle.trace.push({ t: "STATUS_APPLY", src: a.id, dst: v.id, status: ANNIHILATE_ID, name: def.name, category: def.category, duration: PERSIST, ref: "3645_1", known: true, tag: s.tag, skill: "红莲诛灭" });
      }
      if (a.alive) setForm(battle, a, "SLAUGHTER", "KILL");
    });
    // L5 damage reduction (passive) and the initial-SPD bonus (evolution, passive).
    reg(EV.BEFORE_DAMAGE, (ctx: any) => {
      const res = ctx?.result, src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
      if (!res || res.ignoresModifiers || !(res.final > 0)) return;
      if (dst?.id === a.id) {
        const lost = ASURA.cap - reasonOf(a);
        if (lost > 0) { res.final *= Math.max(0, 1 - ASURA.drPerLost * lost); battle.trace.push({ t: "DAMAGE_REDUCED", id: a.id, by: "天魔威压", ratio: ASURA.drPerLost * lost }); }
      }
      if (src?.id === a.id && dst && dst.teamId !== a.teamId && spd0(battle, a) > spd0(battle, dst)) res.final *= 1 + ASURA.spdBonus;
    });
    // Reason suppression: a rule of the mark itself (not sealed with the passive).
    reg(EV.BEFORE_DAMAGE, (ctx: any) => {
      const res = ctx?.result;
      if (ctx?.input?.source?.id !== a.id || !res || res.ignoresModifiers || !(res.final > 0)) return;
      const r = reasonOf(a);
      if (r > 0) res.final *= Math.max(0, 1 - ASURA.suppress * r);
    }, "ALL", false, ":mark");
    out.push({ entityId: a.id, mechanic: "理性 (9 per turn start, spend per target, -6%/point dealt, +8% heal/point, L5 DR, control immunity) · 诛灭 on the victim · 无间杀戮 form · 炼狱虐杀 follow-ups until Reason runs out" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "364_01": { note: "红莲诛灭: 诛灭 goes on the defeated enemy (betting-asura.ts), not on Asura", patch: { statusRefConditionOnly: [0] } },
    "364_03": { note: "炼狱虐杀: Reason (spend, follow-ups) is run by betting-asura.ts; no 1-turn 理性 status on cast", patch: { statusRefConditionOnly: [0] } },
  }),
  damageHook: (x: any) => (bettingActive() ? damageHook(x) : null),
  gate: (_battle, self, sk) => (bettingActive() && sk?.ir?.id === "364_02" && isAsura364(self) ? "PASSIVE_NOT_CASTABLE" : null),
  install,
};
