// compile/betting-kannazuki.ts — 神无月 (SSR 596, Global "Kannazuki") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 596_02 / 596_03, buffs 5965_1 入梦 / 5962_1 梦神, data/kb/ai.json 596.
//   入梦 (5965_1)      · "携带者施放妖术消耗鬼火减少3点并消耗1层": an onibi skill of the bearer costs 3 less (min 0)
//                       and consumes 1 stack. 美梦赐予 gives 2 stacks (generic status path, 2 turns). The match-4
//                       replay shows every 美梦赐予 followed by a free 鹿角冲撞 of its target (Shishio).
//   织梦曲 (596_02)    · passive, tips_11: 神无月 and 入梦 bearers take 40% less damage, other allies 20% less
//                       (applied on BEFORE_DAMAGE like the other kits' reductions; sealed by 压制).
//   AI target (KB)     · "优先选择攻击高的友方单位": compile/ai-compiler.ts reads the initial (panel) ATK in MAX mode.
// Not modeled: 梦神 damage bonus in the illusion, 美梦必成 (tips_5964), 596_03 L2/L3/L5 illusion riders.
import type { Entity } from "../kernel/entity.ts";
import { EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { bettingActive, isSummonUnit, skillById, registerOwnerHandler, stacksOn, markDef, noteValue, setNote } from "./betting-shared.ts";

export const KANNAZUKI = Object.freeze({ dreamCut: 3, selfCut: 0.4, allyCut: 0.2, dreamStacks: 2, dreamTurns: 2 });
export const DREAM_ID = "5965_1";
const REBUILT_NOTE = "kanna596:dream-tag=";

const dreamDef = () => markDef({ id: DREAM_ID, name: "入梦", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN", dispellable: true, removable: true,
  desc: "【增益、印记】至多2层，友方场上至多存在1个此效果。携带者施放妖术消耗鬼火减少3点并消耗1层。（betting: 维持携带者的2个回合）" }, StatusBook);

/**
 * After 美梦赐予: the compiled status path gave the target 1 stack for 1 of 神无月's turns (it expired at the end of
 * her casting turn, so the mark never reached its bearer's turn). Rebuilt here: 2 stacks for 2 of the bearer's
 * turns, at most one bearer on the team.
 */
export function kannazukiAfterCast(battle: any, self: Entity, x: any): boolean {
  if (!bettingActive() || x?.id !== "596_03") return false;
  const allies: Entity[] = battle.teams[self.teamId].members.filter((m: Entity) => m.alive);
  // The compiled slot just gave the target a 入梦 status: a fresh one (tag ≠ the tag of the last rebuild), or — when the
  // target already held the rebuilt mark — merged into it. Def identity cannot tell them apart: once dreamDef() is in
  // StatusBook the compiled slot uses it too (every battle after the first in a process — the old check found no
  // bearer there, so 入梦 vanished after battle 1 of a Monte Carlo run).
  const mine = (m: Entity) => m.statuses.filter(s => s.def.id === DREAM_ID && s.sourceId === self.id);
  const bearer = allies.find(m => mine(m).some(s => s.tag !== noteValue(m, REBUILT_NOTE))) ?? allies.find(m => mine(m).length > 0) ?? null;
  for (const m of allies) for (const st of [...m.statuses]) if (st.def.id === DREAM_ID) m.expireStatus(st);
  if (!bearer) return true;
  const def = dreamDef();
  const a = bearer.addStatus(def, self.id, KANNAZUKI.dreamStacks, KANNAZUKI.dreamTurns, [], KANNAZUKI.dreamStacks);
  setNote(bearer, REBUILT_NOTE, a.tag);
  battle.trace.push({ t: "STATUS_APPLY", src: self.id, dst: bearer.id, status: DREAM_ID, name: def.name, category: def.category, duration: KANNAZUKI.dreamTurns, ref: DREAM_ID, known: true, tag: a.tag, stacks: KANNAZUKI.dreamStacks, skill: x.name, note: "rebuilt: 2 stacks, 2 bearer turns" });
  return true;
}

export const isKannazuki596 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "596_02") && !!skillById(e, "596_03");
export const dreamStacks = (e: Entity): number => stacksOn(e, DREAM_ID);

/** 入梦: an onibi skill of the bearer costs 3 less (min 0). */
export function dreamCost(self: Entity, sk: any, base: number): number {
  if (!bettingActive() || !(Number(sk?.cost ?? 0) > 0) || !(base > 0) || dreamStacks(self) < 1) return base;
  return Math.max(0, base - KANNAZUKI.dreamCut);
}

/** After an onibi skill of a 入梦 bearer: 1 stack is consumed. */
export function dreamAfterCast(battle: any, self: Entity, x: any): void {
  if (!bettingActive() || !(Number(x?.cost ?? 0) > 0)) return;
  const st = self.statuses.find(s => s.def.id === DREAM_ID);
  if (!st) return;
  const from = st.stacks;
  if (from <= 1) self.expireStatus(st);
  else st.stacks = from - 1;
  battle.trace.push({ t: "STACKS_CONSUMED", id: self.id, status: DREAM_ID, name: "入梦", from, to: Math.max(0, from - 1), reason: "ONIBI_SKILL", skill: x.name });
}

/** tips_11: the first 596 of the team runs 织梦曲. */
function weaverOf(battle: any, teamId: number): Entity | null {
  return (battle.teams[teamId]?.members ?? []).find((m: Entity) => isKannazuki596(m)) ?? null;
}

export function installKannazuki(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const k of entities.filter(isKannazuki596)) {
    if (weaverOf(battle, k.teamId) !== k) continue;
    registerOwnerHandler(battle, "betting:596:dr:" + k.id, k.id, EV.BEFORE_DAMAGE, (ctx: any) => {
      const dst: Entity | undefined = ctx?.input?.target;
      const res = ctx?.result;
      if (!dst || !res || res.ignoresModifiers || dst.teamId !== k.teamId || !k.alive) return;
      if (ctx.input.source?.teamId === k.teamId) return;
      const cut = dst.id === k.id || dreamStacks(dst) > 0 ? KANNAZUKI.selfCut : KANNAZUKI.allyCut;
      res.final *= 1 - cut;
    }, "ALL");
    out.push({ entityId: k.id, mechanic: "织梦曲 damage reduction (40% / 20%) · 入梦 cost -3" });
  }
  return out;
}
