// compile/betting-shishio.ts — 小鹿男 (SSR 259, Global "Shishio") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 259_01..259_03, buffs 2591_1 森之力 / 2592_1 生生不息, data/kb/ai.json 259,
// data/kb/en-text.json (Global text, same meaning).
//   生生不息 (259_02, passive) · at the end of his own turn, if no 生生不息 was consumed during that turn: +1 stack
//                       (cap 3, persists). Read as "his own turn" (the text says 回合结束时; the stack is his).
//                     · afflicted by a control effect: 20% (L5) to reflect it onto a random enemy (same status and
//                       duration; it leaves him).
//                     · an enemy casts an onibi skill (pays onibi): +20% action bar.
//   鹿角冲撞 (259_03)   · 191% ATK (L5) on the target. With 生生不息: the target's bar is pushed back 40%; pushed
//                       to the very end ⇒ 100% base chance to stun it 1 turn; a stun that lands consumes 1 stack.
//                       L5: more than 1 stack ⇒ every stack beyond the first attacks 1 more random enemy; repeated
//                       damage on the same target -40% (additive per repeat, assumption).
//   AI (KB)            · 鹿角冲撞 when a Shishio of the team holds 生生不息, else 森之力. Before this module the
//                       stack never existed (passives are off on the betting path) ⇒ 0 casts of 鹿角冲撞 in 30 seeds
//                       while the match-4 replay shows 4.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, stacksOn,
  setStackedStatus, shiftBar, isControlDef, applyContested,
} from "./betting-shared.ts";

export const SHISHIO = Object.freeze({ lifeCap: 3, barOnEnemyOnibi: 0.2, push: 0.4, stunP: 1, reflectL1: 0.1, repeatCut: 0.4 });
export const LIFE_ID = "2592_1";
const NOTE_USED = "shishio259:usedTurn=";

const lifeDef = () => markDef({ id: LIFE_ID, name: "生生不息", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "【增益、状态】汇聚了森林之息，使小鹿男获得了强大力量。（betting: 上限3层，持续到被消耗）" }, StatusBook);

export const isShishio259 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "259_02") && !!skillById(e, "259_03");
export const lifeStacks = (e: Entity): number => stacksOn(e, LIFE_ID, e.id);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const reflectChance = (e: Entity): number => {
  let p = SHISHIO.reflectL1;
  for (const l of (skillById(e, "259_02")?.ir?.levelScale ?? [])) {
    const m = String(l.effect ?? "").match(/反弹概率增至(\d+(?:\.\d+)?)%/);
    if (m) p = Number(m[1]) / 100;
  }
  return p;
};

function setLife(battle: any, e: Entity, n: number, reason: string): void {
  const before = lifeStacks(e);
  const after = setStackedStatus(e, lifeDef(), n, SHISHIO.lifeCap, e.id, []);
  if (after > before) battle.trace.push({ t: "STATUS_APPLY", src: e.id, dst: e.id, status: LIFE_ID, name: "生生不息", category: StatusCategory.BUFF_STATE, duration: PERSIST, ref: LIFE_ID, known: true, stacks: after, threshold: SHISHIO.lifeCap, reason, skill: "生生不息" });
  else if (after < before) {
    battle.trace.push({ t: "STACKS_CONSUMED", id: e.id, status: LIFE_ID, name: "生生不息", from: before, to: after, reason, skill: "鹿角冲撞" });
    setNote(e, NOTE_USED, battle.turn);
  }
}

type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };

/** 鹿角冲撞: main hit, push / stun with 生生不息, L5 extra random hits. */
export function antlerHook(x: any): Hook | null {
  if (x?.id !== "259_03" || !Array.isArray(x.damage) || !x.damage.length) return null;
  const d = x.damage[0];
  const ratio = Number(d.ratioMax ?? d.ratio ?? 158) / 100;
  const l5 = (x.levelScale ?? []).some((l: any) => /多于1层时，每多1层可额外攻击1个随机敌方目标/.test(String(l.effect ?? "")));
  return {
    kind: "ANTLER_CHARGE",
    run: async (battle, self, hurt, primary) => {
      const t = primary?.alive && primary.teamId !== self.teamId ? primary : aliveEnemies(battle, self)[0];
      if (!t) return;
      const stacks = lifeStacks(self);
      const seen = new Map<number, number>();
      const strike = async (v: Entity, id: string) => {
        await battle.withinResolution({ id, type: "HIT" }, async () => {
          if (!v.alive) return;
          if (!hurt.includes(v)) hurt.push(v);
          const n = seen.get(v.id) ?? 0;
          seen.set(v.id, n + 1);
          await battle.damage(self, v, self.prop("atk") * ratio, d.type ?? DamageType.NORMAL, Math.max(0, 1 - SHISHIO.repeatCut * n), null);
        });
      };
      await strike(t, "HIT:" + x.name + "#1");
      if (stacks > 0 && t.alive) {
        shiftBar(battle, t, -SHISHIO.push, x.name);
        if ((battle.timeline.get(t.id)?.pos ?? 1) <= 1e-6) {
          const landed = await applyContested(battle, self, t, StatusBook.get("stun")!, SHISHIO.stunP, 1, [], { skill: x.name, ref: "CONTROL:stun" });
          if (landed) setLife(battle, self, lifeStacks(self) - 1, "STUN");
        }
      }
      const extra = l5 ? Math.max(0, stacks - 1) : 0;
      for (let i = 0; i < extra; i++) {
        const pool = aliveEnemies(battle, self);
        if (!pool.length) break;
        battle.rng.expect("shishio259_extra#" + (i + 1));
        await strike(battle.rng.pick(pool) ?? pool[0], "HIT:" + x.name + "#" + (i + 2));
      }
    },
  };
}

async function reflect(battle: any, e: Entity, ctx: any): Promise<void> {
  if (ctx?.entity?.id !== e.id || !e.alive || ctx.merged) return;
  const def = StatusBook.get(String(ctx.status ?? ""));
  if (!def || !isControlDef(def)) return;
  const st = [...e.statuses].reverse().find(s => s.def.id === def.id);
  if (!st || st.sourceId === e.id) return;
  const src = battle.allEntities().find((x: Entity) => x.id === st.sourceId);
  if (!src || src.teamId === e.teamId) return;
  battle.rng.expect("shishio259_reflect:" + def.id);
  if (!battle.rng.testHit(reflectChance(e))) return;
  const pool = aliveEnemies(battle, e);
  if (!pool.length || !e.expireStatus(st)) return;
  battle.rng.expect("shishio259_reflect_target");
  const v: Entity = battle.rng.pick(pool) ?? pool[0];
  const a = v.addStatus(def, e.id, 1, st.remaining, [], null);
  battle.trace.push({ t: "STATUS_REFLECT", src: e.id, from: st.sourceId, dst: v.id, status: def.id, name: def.name, duration: st.remaining, tag: a.tag, skill: "生生不息" });
}

/**
 * KB AI: 鹿角冲撞 when a Shishio of the team holds 生生不息 (and it is affordable), else 森之力. The generic condition
 * compiled to hasBuff(self, "小鹿男拥有生生不息"), which can never match a status name.
 */
export function shishioRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isShishio259(self)) return null;
  const ult = skillById(self, "259_03");
  const holder = (battle.teams[self.teamId].members as Entity[]).some(m => m.alive && isShishio259(m) && lifeStacks(m) > 0);
  const c = ult ? costOf(ult) : 0;
  if (ult && holder && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c))) return { skill: ult, rule: "小鹿男: 友方小鹿男拥有生生不息 → 鹿角冲撞 (KB AI)" };
  const basic = skillById(self, "259_01");
  return basic ? { skill: basic, rule: holder ? "小鹿男: 鬼火不足 → 森之力" : "小鹿男: 无生生不息 → 森之力 (KB AI)" } : null;
}

/** IR patch (MAX): push / stun / stacks are run by antlerHook (the compiled push was unconditional). */
export const SHISHIO_PATCHES = Object.freeze({
  "259_03": { note: "鹿角冲撞: the 40% push needs 生生不息, the stun consumes it, L5 extra hits — all run by betting-shishio.ts", patch: { timeline: [], statusRefConditionOnly: [0, 1] } },
});

export function installShishio(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const e of entities.filter(isShishio259)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:259:" + code + ":" + e.id, e.id, code, fn, range);
    reg(EV.TURN_END, (ctx: any) => {
      if (ctx?.actor?.id !== e.id || !e.alive || (ctx.type !== "NORMAL" && ctx.type !== "NEW_TURN")) return;
      if (noteValue(e, NOTE_USED) === String(battle.turn)) return;   // consumed during this turn
      if (lifeStacks(e) < SHISHIO.lifeCap) setLife(battle, e, lifeStacks(e) + 1, "TURN_END");
    }, "SELF");
    reg(EV.ORB_COST, (ctx: any) => {
      const payer = battle.allEntities().find((x: Entity) => x.id === ctx?.actor);
      if (!payer || payer.teamId === e.teamId || !e.alive || !(Number(ctx?.amount ?? 0) > 0)) return;
      shiftBar(battle, e, SHISHIO.barOnEnemyOnibi, "生生不息");
    });
    reg(EV.STATUS_ADD, (ctx: any) => reflect(battle, e, ctx));
    out.push({ entityId: e.id, mechanic: "生生不息 (stacks, reflect, +20% bar on enemy onibi skill) · 鹿角冲撞 push/stun/L5" });
  }
  return out;
}
