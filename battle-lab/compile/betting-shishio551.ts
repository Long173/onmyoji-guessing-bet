// compile/betting-shishio551.ts — 寻森小鹿男 (SP 551, Global "Greenwarden Shishio") at max skill level. MAX mode only
// (match 12). Not the SSR 小鹿男 259 (betting-shishio.ts).
//
// Sources: data/kb/shikigami.json 551_01..551_03, buffs 5511_1 森之灵 / 5512_1 森之心, tips_5513 牵缠, data/kb/ai.json
// row 551; data/kb/en-text.json (Global, same meaning). Before this module he only ever used 林间息 (the KB AI needs 森之心,
// which never existed: generic passives are off on the betting path).
//   寻鹿迹 (551_02, passive, 唯一) · every attack on an enemy target marks it with 森之灵 (1 turn). 森之灵: each time the
//        bearer attacks (attack action start, EV.SKILL_START), it loses 20% of its initial ATK and he gains that amount
//        (steal, max 3 stacks), and the bearer's bar is pushed back 15%; at the end of the bearer's turn 2 steal stacks
//        are removed; one mark triggers at most 3 times. At the start of his turn he absorbs every 森之灵 on the enemy
//        side and gains as many 森之心 (cap 3, +20% effect RES each, 2 turns).
//        L2: a debuff / control from an enemy: 30% to be immune (removed) and gain 1 森之心. L3: at turn start +13% max
//        HP per 森之心. L4: a 森之灵 trigger ⇒ he gains +60 SPD for 1 turn. L5: no 森之灵 on the enemy side ⇒ after each
//        non-summon enemy's turn, +10% bar.
//   森之契 (551_03, 3) · 228% ATK (+25% per 森之心, L2). With 森之心: 40% push; pushed to the end ⇒ 牵缠 1 turn (100% base
//        chance, contested; L5 with 3 森之心: always lands). L3/L4: 1 / ≥2 森之心 ⇒ 1 / 2 extra random enemies.
//   牵缠 (tips_5513) · the bearer cannot deal damage (its damage is set to 0); cannot be dispelled.
//   AI (KB)          · 敌方存活≤1 → 林间息; 拥有森之心 → 森之契 (when affordable); else 林间息.
// Readings (conservative, unverified — noted in the report):
//   · 森之灵 "1 turn" uses the engine's source-turn count (SOURCE_TURN, 2 ticks, as the other kits' "1 turn"): it lives
//     until he absorbs it at his next turn start. 森之心 "2 turns" = 2 of his turn ends, refreshed by a new gain (one pool,
//     not separate batches).
//   · The steal happens at the attack start, so it lowers the attacking enemy's damage for that attack; "回合结束时移除2次"
//     = at the end of the bearer's own turn. The 280% cap (of his initial ATK) is per steal and never binds.
//   · The extra random targets of 森之契 are other enemies (not the primary), take the same damage and get 森之灵, but no
//     push / 牵缠. 森之心 is not consumed by 森之契.
//   · 牵缠 is NOT one of the 16 official control effects (tips_3), so it is not treated as a control (元兴寺 does not count it,
//     control immunity does not stop it). Not modelled: its −60% to received bar boosts (favours Red).
//   · "初始攻击" = the panel ATK (e.base.atk).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, stacksOn, setStackedStatus,
  shiftBar, applyContested, isDebuffOrControl,
} from "./betting-shared.ts";
import { currentHit } from "./betting-scope.ts";

export const SHISHIO551 = Object.freeze({
  stealRatio: 0.2, stealCap: 3, stealDrop: 2, markTriggers: 3, push: 0.15, heartCap: 3, heartRes: 0.2, heartTurns: 2,
  immuneChance: 0.3, healPerHeart: 0.13, spd: 60, l5Bar: 0.1, ultRatio: 228, ultPerHeart: 25, ultPush: 0.4, entangleP: 1,
  markTurns: 2,
});
export const SPIRIT_ID = "5511_1";
export const HEART_ID = "5512_1";
export const ENTANGLE_ID = "5513_entangle";
const STEAL_UP_ID = "551_steal_up", STEAL_DOWN_ID = "551_steal_down", SPD_ID = "551_spd";

const spiritDef = () => markDef({ id: SPIRIT_ID, name: "森之灵", category: StatusCategory.COMMON_MARK, durationPolicy: "SOURCE_TURN",
  desc: "【通用、印记】携带者每次攻击时触发，偷取其20%初始攻击（至多不超过自身初始攻击280%），并击退其15%行动条，回合结束时移除2次偷取效果。每个印记最多触发3次且偷取效果最多叠加3次。" }, StatusBook);
const heartDef = () => markDef({ id: HEART_ID, name: "森之心", category: StatusCategory.COMMON_MARK, durationPolicy: "SOURCE_TURN",
  desc: "【通用、印记】上限3个，每个提升20%效果抵抗。" }, StatusBook);
export const entangleDef = () => markDef({ id: ENTANGLE_ID, name: "牵缠", category: StatusCategory.DEBUFF_STATE, durationPolicy: "TARGET_TURN",
  dispellable: false, removable: true, desc: "被藤蔓牵缠，无法造成伤害，受到行动条提升效果下降60%，无法被驱散。" }, StatusBook);
const upDef = () => markDef({ id: STEAL_UP_ID, name: "森之灵·偷取", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "寻森小鹿男偷取的攻击（每层为被偷取者初始攻击20%）。" }, StatusBook);
const downDef = () => markDef({ id: STEAL_DOWN_ID, name: "森之灵·被偷取", category: StatusCategory.DEBUFF_MARK, durationPolicy: "GLOBAL",
  desc: "被寻森小鹿男偷取的攻击（每层为自身初始攻击20%），回合结束时移除2层。" }, StatusBook);
const spdDef = () => markDef({ id: SPD_ID, name: "寻鹿迹·速度", category: StatusCategory.BUFF_STATE, durationPolicy: "SOURCE_TURN",
  desc: "寻鹿迹 L4：森之灵触发时，提升60点速度，持续1回合。" }, StatusBook);

export const isShishio551 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "551_02") && !!skillById(e, "551_03");
export const heartsOf = (e: Entity): number => stacksOn(e, HEART_ID, e.id);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const initAtk = (e: Entity): number => Number((e as any)?.base?.atk ?? 0) || e.prop("atk");
/** Triggers used per marked enemy (battle → victim id → count); reset when a new mark is applied. */
const triggers = new WeakMap<object, Map<number, number>>();
const trigMap = (battle: any): Map<number, number> => { let m = triggers.get(battle); if (!m) { m = new Map(); triggers.set(battle, m); } return m; };

export function setHearts(battle: any, e: Entity, n: number, reason: string): number {
  const before = heartsOf(e);
  const after = setStackedStatus(e, heartDef(), n, SHISHIO551.heartCap, e.id, [{ prop: "efr", value: SHISHIO551.heartRes, mode: "FIXED" }], SHISHIO551.heartTurns);
  const st = e.statuses.find(s => s.def.id === HEART_ID && s.sourceId === e.id);
  if (st && after > before) st.remaining = SHISHIO551.heartTurns;   // a new gain refreshes the pool
  if (after !== before) battle.trace.push({ t: "STATUS_APPLY", src: e.id, dst: e.id, status: HEART_ID, name: "森之心", category: StatusCategory.COMMON_MARK, duration: SHISHIO551.heartTurns, ref: HEART_ID, known: true, stacks: after, threshold: SHISHIO551.heartCap, reason, skill: "寻鹿迹" });
  return after;
}

/** 寻鹿迹: an attacked enemy gets 森之灵 (refreshed; a new mark resets its 3 triggers). */
export function markSpirit(battle: any, s: Entity, v: Entity): void {
  if (!v?.alive || v.teamId === s.teamId) return;
  for (const st of [...v.statuses]) if (st.def.id === SPIRIT_ID) v.expireStatus(st);
  const a = v.addStatus(spiritDef(), s.id, 1, SHISHIO551.markTurns, [], 1);
  trigMap(battle).set(v.id, 0);
  battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: v.id, status: SPIRIT_ID, name: "森之灵", category: StatusCategory.COMMON_MARK, duration: SHISHIO551.markTurns, ref: SPIRIT_ID, known: true, tag: (a as any)?.tag ?? null, skill: "寻鹿迹" });
}

function setSteal(s: Entity, v: Entity, n: number): number {
  const amt = SHISHIO551.stealRatio * initAtk(v);
  setStackedStatus(s, upDef(), n, SHISHIO551.stealCap, v.id, [{ prop: "atk", value: amt, mode: "FIXED" }]);
  return setStackedStatus(v, downDef(), n, SHISHIO551.stealCap, s.id, [{ prop: "atk", value: -amt, mode: "FIXED" }]);
}

/** 森之灵 trigger: the marked enemy starts an attack. */
export function spiritTrigger(battle: any, s: Entity, v: Entity): boolean {
  if (!s.alive || !v?.alive || !v.statuses.some(st => st.def.id === SPIRIT_ID && st.sourceId === s.id)) return false;
  const used = trigMap(battle).get(v.id) ?? 0;
  if (used >= SHISHIO551.markTriggers) return false;
  trigMap(battle).set(v.id, used + 1);
  const n = setSteal(s, v, stacksOn(v, STEAL_DOWN_ID, s.id) + 1);
  battle.trace.push({ t: "MARK_TRIGGER", id: v.id, status: SPIRIT_ID, name: "森之灵", src: s.id, stacks: n, uses: used + 1, skill: "寻鹿迹" });
  shiftBar(battle, v, -SHISHIO551.push, "森之灵");
  for (const st of [...s.statuses]) if (st.def.id === SPD_ID) s.expireStatus(st);
  s.addStatus(spdDef(), s.id, 1, 2, [{ prop: "spd", value: SHISHIO551.spd, mode: "FIXED" }], 1);
  return true;
}

/** Start of his turn: absorb the enemy 森之灵 into 森之心, then L3 heal per 森之心. */
async function turnStart(battle: any, s: Entity): Promise<void> {
  let absorbed = 0;
  for (const v of battle.enemiesOf(s.teamId) as Entity[]) {
    const st = v.statuses.find(x => x.def.id === SPIRIT_ID && x.sourceId === s.id);
    if (!st || !v.expireStatus(st)) continue;
    absorbed++;
    battle.trace.push({ t: "STATUS_REMOVE", id: v.id, status: SPIRIT_ID, name: "森之灵", by: "ABSORB", side: "ENEMY", what: "MARK", src: s.id, skill: "寻鹿迹" });
  }
  if (absorbed > 0) setHearts(battle, s, heartsOf(s) + absorbed, "ABSORB");
  const h = heartsOf(s);
  if (h > 0 && s.alive) await battle.heal(s, s, s.maxHp * SHISHIO551.healPerHeart * h, { crit: false });
}

type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };

function pactHook(x: any): Hook | null {
  if (x?.id !== "551_03") return null;
  return {
    kind: "FOREST_PACT",
    run: async (battle, s, hurt, primary) => {
      const t = primary?.alive && primary.teamId !== s.teamId ? primary : aliveEnemies(battle, s)[0];
      if (!t) return;
      const h = heartsOf(s);
      const ratio = (SHISHIO551.ultRatio + SHISHIO551.ultPerHeart * h) / 100;
      const strike = async (v: Entity, id: string) => {
        await battle.withinResolution({ id, type: "HIT" }, async () => {
          if (!v.alive || !s.alive) return;
          if (!hurt.includes(v)) hurt.push(v);
          await battle.damage(s, v, s.prop("atk") * ratio, DamageType.NORMAL, 1, x.lifesteal ?? null);
        });
      };
      await strike(t, "HIT:" + x.name + "#1");
      if (h > 0 && t.alive) {
        shiftBar(battle, t, -SHISHIO551.ultPush, x.name);
        if ((battle.timeline.get(t.id)?.pos ?? 1) <= 1e-6) {
          const sure = h >= SHISHIO551.heartCap;
          if (sure) {
            for (const st of [...t.statuses]) if (st.def.id === ENTANGLE_ID) t.expireStatus(st);
            const a = t.addStatus(entangleDef(), s.id, 1, 1, [], 1);
            battle.trace.push({ t: "STATUS_APPLY", src: s.id, dst: t.id, status: ENTANGLE_ID, name: "牵缠", category: StatusCategory.DEBUFF_STATE, duration: 1, ref: ENTANGLE_ID, known: true, tag: (a as any)?.tag ?? null, skill: x.name, clause: "L5：拥有3个森之心时，牵缠必定命中" });
          } else {
            await applyContested(battle, s, t, entangleDef(), SHISHIO551.entangleP, 1, [], { skill: x.name, ref: ENTANGLE_ID });
          }
        }
      }
      const extra = h >= 2 ? 2 : h >= 1 ? 1 : 0;
      const picked = new Set<number>([t.id]);
      for (let i = 0; i < extra; i++) {
        const pool = aliveEnemies(battle, s).filter(v => !picked.has(v.id));
        if (!pool.length) break;
        battle.rng.expect("shishio551_extra#" + (i + 1));
        const v: Entity = battle.rng.pick(pool) ?? pool[0];
        picked.add(v.id);
        await strike(v, "HIT:" + x.name + "#" + (i + 2));
      }
    },
  };
}

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isShishio551(self)) return null;
  const ult = skillById(self, "551_03"), basic = skillById(self, "551_01");
  if (aliveEnemies(battle, self).length <= 1) return basic ? { skill: basic, rule: "寻森小鹿男: 敌方存活≤1 → 林间息 (KB AI)" } : null;
  const c = ult ? costOf(ult) : 0;
  if (ult && heartsOf(self) > 0 && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c))) return { skill: ult, rule: "寻森小鹿男: 拥有森之心 → 森之契 (KB AI)" };
  return basic ? { skill: basic, rule: heartsOf(self) > 0 ? "寻森小鹿男: 鬼火不足 → 林间息" : "寻森小鹿男: 未拥有森之心 → 林间息 (KB AI)" } : null;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isShishio551);
  if (!units.length) return out;
  for (const e of units) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:551:" + code + ":" + e.id, e.id, code, fn, range);
    // Every attack on an enemy (his skill hits) marks the target.
    const marked = new WeakMap<object, Set<number>>();
    reg(EV.AFTER_DAMAGE, (ctx: any) => {
      const src = ctx?.input?.source, dst = ctx?.input?.target;
      if (src?.id !== e.id || !dst || dst.teamId === e.teamId || isSummonUnit(dst)) return;
      if (String(ctx.input.skillTag ?? "").startsWith("soul:") || !currentHit(battle).skill) return;
      const scope = (battle.resolutionStack ?? []).find((x: any) => x?.type === "SKILL");
      if (!scope) return;
      let set = marked.get(scope);
      if (!set) { set = new Set(); marked.set(scope, set); }
      if (set.has(dst.id)) return;
      set.add(dst.id);
      markSpirit(battle, e, dst);
    });
    // 森之灵: a marked enemy starts an attack.
    reg(EV.SKILL_START, (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || a.teamId === e.teamId) return;
      spiritTrigger(battle, e, a);
    });
    // End of the bearer's turn: −2 steal stacks (global: runs after his death too). L5: +10% bar after a
    // non-summon enemy's turn with no 森之灵 out.
    ensureGlobalHandler(battle, "betting:551:steal-drop:" + e.id, EV.TURN_END, (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || a.teamId === e.teamId) return;
      const n = stacksOn(a, STEAL_DOWN_ID, e.id);
      if (n > 0) setSteal(e, a, n - SHISHIO551.stealDrop);
    });
    reg(EV.TURN_END, (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || a.teamId === e.teamId) return;
      if (!e.alive || isSummonUnit(a)) return;
      if ((battle.enemiesOf(e.teamId) as Entity[]).some(v => v.alive && v.statuses.some(st => st.def.id === SPIRIT_ID))) return;
      shiftBar(battle, e, SHISHIO551.l5Bar, "寻鹿迹");
    });
    reg(EV.TURN_START, async (ctx: any) => {
      if (ctx?.actor?.id !== e.id || !e.alive) return;
      await turnStart(battle, e);
    }, "SELF");
    // L2: 30% immunity to an enemy debuff / control, +1 森之心.
    reg(EV.STATUS_ADD, (ctx: any) => {
      if (ctx?.entity?.id !== e.id || !e.alive || ctx.merged) return;
      const def = StatusBook.get(String(ctx.status ?? "")) ?? e.statuses.find(x => x.def.id === ctx.status)?.def;
      if (!def || !isDebuffOrControl(def)) return;
      const st = [...e.statuses].reverse().find(x => x.def.id === def.id);
      if (!st || st.sourceId === e.id) return;
      const src = battle.allEntities().find((x: Entity) => x.id === st.sourceId);
      if (!src || src.teamId === e.teamId) return;
      battle.rng.expect("shishio551_immune:" + def.id);
      if (!battle.rng.testHit(SHISHIO551.immuneChance)) return;
      if (!e.expireStatus(st)) return;
      battle.trace.push({ t: "IMMUNE", src: src.id, dst: e.id, status: def.id, name: def.name, by: "551_02", kind: "PASSIVE", consumed: false, ref: def.id, skill: "寻鹿迹" });
      setHearts(battle, e, heartsOf(e) + 1, "IMMUNE");
    }, "SELF");
    out.push({ entityId: e.id, mechanic: "寻鹿迹 (森之灵 marks, steal 20% initial ATK, 15% push, 森之心 +20% RES, L2 30% immunity, L3 13% heal per heart, L4 +60 SPD, L5 +10% bar) · 森之契 (+25%/heart, push / 牵缠, extra targets) · KB AI" });
  }
  // 牵缠: the bearer cannot deal damage.
  ensureGlobalHandler(battle, "betting:551:entangle", EV.BEFORE_DAMAGE, (ctx: any) => {
    const src = ctx?.input?.source, res = ctx?.result;
    if (!src || !res || !src.statuses?.some((st: any) => st.def.id === ENTANGLE_ID)) return;
    if (!(Number(res.final ?? 0) > 0)) return;
    res.final = 0;
    battle.trace.push({ t: "PASSIVE_PROC", actor: src.id, skill: "牵缠", effect: "无法造成伤害", target: ctx.input.target?.id ?? null });
  });
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "551_02": { note: "寻鹿迹: 森之灵 / 森之心 and the L2-L5 riders are run by betting-shishio551.ts", patch: { statusRefConditionOnly: [0, 1] } },
    "551_03": { note: "森之契: 森之心 scaling, push / 牵缠 and extra targets are run by betting-shishio551.ts", patch: { statusRefConditionOnly: [0] } },
  }),
  damageHook: (x: any) => (bettingActive() ? pactHook(x) : null),
  ruleSkill,
  install,
};
