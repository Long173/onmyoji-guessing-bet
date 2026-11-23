// compile/betting-otakemaru.ts — 麓铭大岳丸 (SP 355, Global "Monumental Otakemaru") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 355_01..355_03, buffs 3551_1 麓蚀 / 3553_1 麓泽, tips_7 先机 / tips_25;
// fandom "Rokumei Ootakemaru/Main" (麓压 and 逆魂尽断 are only on the wiki).
//   驭魂形态 (355_02, 0 onibi) · L5 先机 (battle start). 3 of his turns (L4; a cast in his own turn covers the next 3):
//       +100% effect RES; single-target damage taken -50% (L2: damage outside an all-enemy skill part counts as
//       single-target); every other ally's 妖术 (any active skill except the normal attack) gives 1 麓泽 (max 4,
//       -1 onibi each on 断末无铭, all consumed by it); L3: any non-summon death heals him 30% max HP.
//       With 3 or more non-summon units dead on the field: all his statuses / marks are removed and he enters
//       归骸 for good: +100 SPD, 50% damage reduction, immune to debuffs and banishment, 12% lifesteal, and every
//       turn he casts 逆魂尽断 (5 hits × 240% ATK, random enemies; wiki).
//   麓蚀 (3551_1) · debuff mark: total ATK -15%, healing received -30%; after the bearer's turn ends it becomes 麓压
//       (wiki): total SPD -30% and dazed (unable to act, not dispellable) until the start of its next turn — i.e. no
//       counters / out-of-turn actions meanwhile, and a slower next turn. Applied by 麓影·蚀 (125%) and by 断末无铭
//       in 驭魂形态; a debuff with no written chance ⇒ effect-RES contest.
//   断末无铭 (355_03, 4 onibi) · L5 dispels 1 buff from every enemy first, then 240% to all enemies.
//   AI (KB) · not in 驭魂形态 → 铭海之主, otherwise 断末无铭 (cost after 麓泽), otherwise 麓影·蚀; 归骸 → 逆魂尽断.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { applyLifesteal } from "../kernel/damage.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, registerOwnerHandler, ensureGlobalHandler, applyContested,
  stacksOn, setStackedStatus,
} from "./betting-shared.ts";
import { inOwnTurn, currentSkillOf } from "./betting-scope.ts";
import { targetModeOf } from "./skill-compiler.ts";

export const OTAKE = Object.freeze({
  commandTurns: 3, commandRes: 1, singleCut: 0.5, marshCap: 4, deathHeal: 0.3, bonesAt: 3,
  bonesSpd: 100, bonesCut: 0.5, bonesLifesteal: 0.12, bonesHits: 5, bonesRatio: 240,
  erosionAtk: -0.15, erosionHeal: 0.3, crushSpd: -0.3, basicRatio: 125, ultRatio: 240,
});

export const COMMAND_ID = "355_command";
export const BONES_ID = "355_bones";
export const MARSH_ID = "3553_1";
export const EROSION_ID = "3551_1";
export const CRUSH_ID = "3551_crush";

const commandDef = () => markDef({ id: COMMAND_ID, name: "驭魂形态", category: StatusCategory.BUFF_STATE, durationPolicy: "TARGET_TURN",
  dispellable: false, removable: false, desc: "驭魂形态：效果抵抗+100%，受到的单体伤害降低50%，友方施放妖术后获得麓泽。" }, StatusBook);
const bonesDef = () => markDef({ id: BONES_ID, name: "归骸形态", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  immuneTo: ["DEBUFF", "BANISH"], desc: "归骸形态：速度+100，受到的伤害降低50%，免疫减益和放逐，12%吸血，自身回合自动施放逆魂尽断。" }, StatusBook);
const marshDef = () => markDef({ id: MARSH_ID, name: "麓泽", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】上限4层，每层使『断末无铭』的鬼火消耗降低1点，施放『断末无铭』后消耗所有麓泽。" }, StatusBook);
const erosionDef = () => markDef({ id: EROSION_ID, name: "麓蚀", category: StatusCategory.DEBUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【减益、印记】总攻击降低15%，受到治疗的效果下降30%，携带者回合结束后转化为麓压。" }, StatusBook);
const crushDef = () => markDef({ id: CRUSH_ID, name: "麓压", category: StatusCategory.DEBUFF_MARK, durationPolicy: "GLOBAL",
  preventsAction: true, desc: "麓压（wiki）：总速度降低30%，眩晕（无法动作，无法驱散）直到下个回合开始。" }, StatusBook);

export const isOtake355 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "355_02") && !!skillById(e, "355_03");
export const inCommand = (e: Entity): boolean => e.hasStatus(COMMAND_ID);
export const inBones = (e: Entity): boolean => e.hasStatus(BONES_ID);
export const marshStacks = (e: Entity): number => stacksOn(e, MARSH_ID);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const deadNonSummons = (battle: any): number => battle.allEntities().filter((x: Entity) => x.dead && !isSummonUnit(x)).length;

function enterCommand(battle: any, o: Entity, turns: number, reason: string): void {
  for (const st of [...o.statuses]) if (st.def.id === COMMAND_ID) o.expireStatus(st);
  const def = commandDef();
  const a = o.addStatus(def, o.id, 1, turns, [{ prop: "efr", value: OTAKE.commandRes, mode: "FIXED" }], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: o.id, dst: o.id, status: COMMAND_ID, name: def.name, category: def.category, duration: turns, ref: "355_02", known: true, tag: a.tag, reason, skill: "铭海之主" });
}

function enterBones(battle: any, o: Entity): void {
  for (const st of [...o.statuses]) o.expireStatus(st);
  o.addStatus(bonesDef(), o.id, 1, PERSIST, [{ prop: "spd", value: OTAKE.bonesSpd, mode: "FIXED" }, { prop: "dmgTakenD", value: -OTAKE.bonesCut, mode: "FIXED" }], 1);
  battle.trace.push({ t: "FORM_ENTER", id: o.id, name: "归骸形态", dead: deadNonSummons(battle), skill: "铭海之主" });
}

function setMarsh(battle: any, o: Entity, n: number, reason: string): void {
  const before = marshStacks(o);
  const after = setStackedStatus(o, marshDef(), n, OTAKE.marshCap, o.id, []);
  if (after !== before) battle.trace.push({ t: after > before ? "STACKS_GAINED" : "STACKS_CONSUMED", id: o.id, status: MARSH_ID, name: "麓泽", from: before, to: after, reason, skill: "铭海之主" });
}

async function erode(battle: any, o: Entity, v: Entity, skill: string): Promise<void> {
  if (!v.alive || v.hasStatus(CRUSH_ID)) return;
  for (const st of [...v.statuses]) if (st.def.id === EROSION_ID) v.expireStatus(st);
  await applyContested(battle, o, v, erosionDef(), null, PERSIST,
    [{ prop: "atk", value: OTAKE.erosionAtk, mode: "ADD_RATE" }, { prop: "healDown", value: OTAKE.erosionHeal, mode: "FIXED" }], { skill, ref: EROSION_ID });
}

/** Cost: 断末无铭 -1 per 麓泽. */
export function otakeCost(self: Entity, sk: any, base: number): number {
  if (!bettingActive() || (sk?.ir?.id ?? sk?.id) !== "355_03" || !(base > 0)) return base;
  return Math.max(0, base - marshStacks(self));
}

/** 逆魂尽断: hand-written skill object (5 random hits × 240%), auto-cast in 归骸形态. */
function reversal(o: Entity): any {
  const name = "逆魂尽断";
  const basic = skillById(o, "355_01");
  return {
    name, cost: 0, selectable: true, index: basic?.index ?? 0, aiProfile: basic?.aiProfile, pickTarget: basic?.pickTarget,
    ir: { id: "355_rev", charId: 355, name, cost: 0, damage: [{ ratio: OTAKE.bonesRatio, type: DamageType.NORMAL, base: "atk" }], hits: OTAKE.bonesHits },
    execute: async (battle: any, self: Entity, target: Entity) => {
      self.usedSkills.add(name);
      battle.trace.push({ t: "SKILL_CAST", actor: self.id, skill: name, cost: 0, target: target?.id ?? null, hits: OTAKE.bonesHits });
      for (let h = 0; h < OTAKE.bonesHits; h++) {
        await battle.withinResolution({ id: "HIT:" + name + "#" + (h + 1), type: "HIT" }, async () => {
          const pool = aliveEnemies(battle, self);
          if (!pool.length) return;
          battle.rng.expect("hit_target:" + name + "#" + (h + 1));
          const v = battle.rng.pick(pool) ?? pool[0];
          await battle.damage(self, v, self.prop("atk") * (OTAKE.bonesRatio / 100), DamageType.NORMAL, 1, null);
        });
      }
    },
  };
}
const reversalOf = new WeakMap<object, any>();

export function otakeRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isOtake355(self)) return null;
  if (inBones(self)) {
    const sk = reversalOf.get(self) ?? reversalOf.set(self, reversal(self)).get(self);
    return { skill: sk, rule: "麓铭大岳丸: 归骸形态 → 自动施放逆魂尽断" };
  }
  if (!inCommand(self)) return { skill: skillById(self, "355_02"), rule: "麓铭大岳丸: 未进入驭魂状态 → 铭海之主 (KB AI)" };
  const ult = skillById(self, "355_03");
  const c = costOf(ult);
  if (ult && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c))) return { skill: ult, rule: "麓铭大岳丸: 驭魂形态 → 断末无铭 (KB AI)" };
  const basic = skillById(self, "355_01");
  return basic ? { skill: basic, rule: "麓铭大岳丸: 鬼火不足 → 麓影·蚀" } : null;
}

type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };

export function otakeDamageHook(x: any): Hook | null {
  if (x?.id === "355_01") return {
    kind: "OTAKE_BASIC",
    run: async (battle, o, hurt, primary) => {
      const t = primary?.alive && primary.teamId !== o.teamId ? primary : aliveEnemies(battle, o)[0];
      if (!t) return;
      hurt.push(t);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, () =>
        battle.damage(o, t, o.prop("atk") * (OTAKE.basicRatio / 100), DamageType.NORMAL, 1, null));
      await erode(battle, o, t, x.name);
    },
  };
  if (x?.id === "355_03") return {
    kind: "OTAKE_ULT",
    run: async (battle, o, hurt) => {
      for (const v of aliveEnemies(battle, o)) {
        const buff = v.statuses.find(s => String(s.def.category).startsWith("BUFF") && s.def.dispellable);
        if (buff && v.dispel(buff.def.id)) {
          battle.trace.push({ t: "STATUS_REMOVE", id: v.id, status: buff.def.id, name: buff.def.name, by: "DISPEL", side: "ENEMY", what: "BUFF", src: o.id, skill: x.name });
          battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: v, status: buff.def.id, name: buff.def.name, by: "DISPEL", side: "ENEMY", what: "BUFF", src: o.id, skill: x.name }, v.id, v.teamId);
        }
      }
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        for (const v of aliveEnemies(battle, o)) {
          hurt.push(v);
          await battle.damage(o, v, o.prop("atk") * (OTAKE.ultRatio / 100), DamageType.NORMAL, 1, null);
        }
      });
      if (inCommand(o)) for (const v of aliveEnemies(battle, o)) await erode(battle, o, v, x.name);
    },
  };
  return null;
}

export function otakeAfterCast(battle: any, self: Entity, x: any): boolean {
  if (!bettingActive() || !isOtake355(self) || (x?.id !== "355_02" && x?.id !== "355_03")) return false;
  if (x.id === "355_02") enterCommand(battle, self, OTAKE.commandTurns + (inOwnTurn(battle, self) ? 1 : 0), "CAST");
  else setMarsh(battle, self, 0, "CAST_CONSUME");
  return true;
}

/** IR patches (MAX): forms, 麓泽 and 麓蚀 / 麓压 are run by betting-otakemaru.ts. */
export const OTAKE_PATCHES = Object.freeze({
  "355_01": { note: "麓影·蚀: 麓蚀 (→ 麓压) is applied by betting-otakemaru.ts", patch: { statusRefConditionOnly: [0] } },
  "355_02": { note: "铭海之主: 驭魂形态 / 麓泽 / 归骸形态 are run by betting-otakemaru.ts", patch: { statusRefConditionOnly: [0] } },
  "355_03": { note: "断末无铭: L5 dispel, 麓蚀 in 驭魂形态 and the 麓泽 cost are run by betting-otakemaru.ts", patch: { statusRefConditionOnly: [0] } },
});

const isSingleTarget = (battle: any, src: Entity): boolean => {
  const ir = currentSkillOf(battle, src)?.ir;
  return !ir || targetModeOf(ir) !== "ENEMY_ALL";
};

export function installOtake(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const o = entities.find(isOtake355);   // 唯一效果
  if (o) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:355:" + code + ":" + o.id, o.id, code, fn, range);
    reg(EV.BATTLE_START, () => {
      if (inCommand(o) || inBones(o)) return;
      battle.trace.push({ t: "SUBCAST", actor: o.id, ref: "355_02", skill: "铭海之主", target: o.id, clause: "[tips_7]先机：施放『铭海之主』" });
      enterCommand(battle, o, OTAKE.commandTurns, "SENKI");
    }, "SELF");
    reg(EV.SKILL_END, (ctx: any) => {
      const a: Entity | undefined = ctx?.actor, sk = ctx?.skill;
      if (!a || a.id === o.id || a.teamId !== o.teamId || isSummonUnit(a) || !inCommand(o)) return;
      const id = String(sk?.ir?.id ?? "");
      if (!sk || Number(sk.cost) < 0 || id.endsWith("_01") || (Number(sk.cost) === 0 && id === "")) return;
      setMarsh(battle, o, marshStacks(o) + 1, "ALLY_ONMYOJUTSU:" + a.id);
    });
    reg(EV.BEFORE_DAMAGE, (ctx: any) => {
      const res = ctx?.result, src: Entity | undefined = ctx?.input?.source;
      if (ctx?.input?.target?.id !== o.id || !res || res.ignoresModifiers || !src || src.teamId === o.teamId) return;
      if (inCommand(o) && isSingleTarget(battle, src)) res.final *= 1 - OTAKE.singleCut;
    });
    reg(EV.AFTER_DAMAGE, async (ctx: any) => {
      if (ctx?.input?.source?.id !== o.id || !inBones(o) || !ctx.result) return;
      await applyLifesteal(battle, o, OTAKE.bonesLifesteal, ctx.result, "归骸形态");
    }, "SELF");
    reg(EV.DEATH, async (ctx: any) => {
      const v: Entity | undefined = ctx?.target;
      if (!v || v.id === o.id || v.alive || isSummonUnit(v) || !o.alive || !inCommand(o)) return;
      if (deadNonSummons(battle) >= OTAKE.bonesAt) { enterBones(battle, o); return; }
      await battle.heal(o, o, o.maxHp * OTAKE.deathHeal, { crit: false });
    });
    out.push({ entityId: o.id, mechanic: "驭魂形态 先机 (RES, single-target -50%, 麓泽, death heal) · 归骸形态 / 逆魂尽断 · 麓蚀 → 麓压" });
  }
  // 麓蚀 → 麓压 at the bearer's turn end; 麓压 ends when its next turn starts (global: the debuffs outlive him).
  if (o || entities.some(isOtake355)) {
    ensureGlobalHandler(battle, "betting:355:erosion", EV.TURN_END, (ctx: any) => {
      const v: Entity | undefined = ctx?.actor;
      const st = v?.statuses.find(s => s.def.id === EROSION_ID);
      if (!v || !st || !v.alive) return;
      v.expireStatus(st);
      const def = crushDef();
      const a = v.addStatus(def, st.sourceId, 1, PERSIST, [{ prop: "spd", value: OTAKE.crushSpd, mode: "ADD_RATE" }], 1);
      battle.trace.push({ t: "STATUS_APPLY", src: st.sourceId, dst: v.id, status: CRUSH_ID, name: def.name, category: def.category, duration: PERSIST, ref: "麓压", known: true, tag: a.tag, reason: "EROSION_CONVERTED", skill: "麓蚀" });
    });
    ensureGlobalHandler(battle, "betting:355:crush", EV.TURN_START, (ctx: any) => {
      const v: Entity | undefined = ctx?.actor;
      if (!v || (ctx.type !== "NORMAL" && ctx.type !== "NEW_TURN")) return;
      for (const st of [...v.statuses]) if (st.def.id === CRUSH_ID && v.expireStatus(st)) battle.trace.push({ t: "STATUS_EXPIRE", id: v.id, status: CRUSH_ID, reason: "NEXT_TURN_START" });
    });
  }
  return out;
}
