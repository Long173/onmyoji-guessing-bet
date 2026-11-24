// compile/betting-akaname.ts — 垢尝 (R 361, Global "Akaname") at max skill level. MAX mode only (match 15).
//
// Sources: data/kb/shikigami.json 361_01..361_03, buff 3612_1 霉球, tips_11 / tips_17 / tips_3, data/kb/ai.json row 361
// ("普攻" only); data/kb/en-text.json (Global, same meaning). Before this module 搓澡澡 (passive) never ran and 脏兮兮's
// effect-hit reduction was not applied.
//   脏兮兮 (361_01) · 120% ATK (L5) to the target, then −25% effect hit for 1 of the target's turns (a debuff with no written
//        chance: contested by the betting resist policy).
//   搓澡澡 (361_02, passive, unique per side) · after each enemy unit's turn ends, if Akaname is alive, not unable to act
//        (tips_17) and has fewer than 4 霉球: dispel up to 3 dispellable debuffs / control effects from ONE random ally that
//        has any, then gain 1 霉球 (−15% effect RES per stack). All 霉球 are removed at the end of his own turn.
//   一篓打尽 (361_03) · never chosen (KB AI: 普攻 only) — not hand-written (gap, irrelevant to the result).
// Readings (noted in the report):
//   · The random ally is drawn among the allies that carry something dispellable (summons included); when nobody does,
//     the trigger still spends a 霉球 (the text gains the mark after every trigger). Alternative: AKANAME_OPTS.stackOnlyOnDispel.
//   · Morph (变形), banishment and the other "无法被驱散" controls are not dispellable, so they stay.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import type { BettingKit, Hook, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, stacksOn, setStackedStatus, isDebuffOrControl, isControlDef,
  applyContested,
} from "./betting-shared.ts";

export const AKANAME = Object.freeze({ cap: 4, dispels: 3, resPerStack: -0.15, hitDown: -0.25, hitTurns: 1, s1Ratio: 120 });
export const AKANAME_OPTS = { stackOnlyOnDispel: false };
export const MOLD_ID = "3612_1";
const HITDOWN_ID = "361_hit_down";

const moldDef = () => markDef({ id: MOLD_ID, name: "霉球", category: StatusCategory.COMMON_MARK as any, durationPolicy: "GLOBAL",
  dispellable: false, removable: true, desc: "【通用、印记】每层降低15%效果抵抗，上限4层。" }, StatusBook);
const hitDownDef = () => markDef({ id: HITDOWN_ID, name: "脏兮兮·命中降低", category: StatusCategory.DEBUFF_STATE, durationPolicy: "TARGET_TURN",
  dispellable: true, removable: true, desc: "【减益、状态】降低25%效果命中，持续1回合。" }, StatusBook);

export const isAkaname = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "361_02") && !!skillById(e, "361_01");
export const moldOn = (a: Entity): number => stacksOn(a, MOLD_ID, a.id);
const dispellableOn = (e: Entity): any[] => e.statuses.filter(s => s.def.dispellable && isDebuffOrControl(s.def));
const unableToAct = (e: Entity): boolean => isActionPrevented(e.statusDefs()) || e.statuses.some(s => (s.def as any).banish);

function filthy(x: any): Hook | null {
  if (x?.id !== "361_01") return null;
  return {
    kind: "FILTHY",
    run: async (battle, a, hurt, primary) => {
      const t = primary && primary.alive && primary.teamId !== a.teamId ? primary : null;
      if (!t) return;
      if (!hurt.includes(t)) hurt.push(t);
      const ratio = Number(x.damage?.[0]?.ratioMax ?? x.damage?.[0]?.ratio ?? AKANAME.s1Ratio) / 100;
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        await battle.damage(a, t, a.prop("atk") * ratio, DamageType.NORMAL, 1, x.lifesteal ?? null);
      });
      if (!t.alive) return;
      for (const st of [...t.statuses]) if (st.def.id === HITDOWN_ID) t.expireStatus(st);
      await applyContested(battle, a, t, hitDownDef(), null, AKANAME.hitTurns, [{ prop: "efh", value: AKANAME.hitDown, mode: "FIXED" }], { skill: x.name, ref: HITDOWN_ID });
    },
  };
}

function setMold(battle: any, a: Entity, n: number): number {
  const got = setStackedStatus(a, moldDef(), n, AKANAME.cap, a.id, [{ prop: "efr", value: AKANAME.resPerStack, mode: "FIXED" }]);
  battle.trace.push({ t: "STATUS_APPLY", src: a.id, dst: a.id, status: MOLD_ID, name: "霉球", category: "COMMON_MARK", duration: 99999, ref: MOLD_ID, known: true, stacks: got, threshold: AKANAME.cap, skill: "搓澡澡" });
  return got;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const seen = new Set<number>();
  for (const a of entities.filter(isAkaname)) {
    if (seen.has(a.teamId)) continue;   // 唯一效果
    seen.add(a.teamId);
    registerOwnerHandler(battle, "betting:361:scrub:" + a.id, a.id, EV.TURN_END, (ctx: any) => {
      const actor: Entity | undefined = ctx?.actor;
      if (!actor || !a.alive) return;
      if (actor.id === a.id) {
        if (moldOn(a) > 0) { setStackedStatus(a, moldDef(), 0, AKANAME.cap, a.id, []); battle.trace.push({ t: "STATUS_REMOVE", id: a.id, status: MOLD_ID, name: "霉球", by: "TURN_END", side: "ALLY", what: "MARK", src: a.id, skill: "搓澡澡" }); }
        return;
      }
      if (actor.teamId === a.teamId || unableToAct(a) || moldOn(a) >= AKANAME.cap) return;
      const pool = (battle.teams[a.teamId].members as Entity[]).filter(m => m.alive && dispellableOn(m).length > 0);
      if (!pool.length && AKANAME_OPTS.stackOnlyOnDispel) return;
      if (pool.length) {
        battle.rng.expect("akaname361_pick");
        const m: Entity = pool.length === 1 ? pool[0] : battle.rng.pick(pool);
        let n = 0;
        for (const st of dispellableOn(m)) {
          if (n >= AKANAME.dispels) break;
          if (!m.dispel(st.def.id)) continue;
          n++;
          battle.trace.push({ t: "STATUS_REMOVE", id: m.id, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what: isControlDef(st.def) ? "CONTROL" : "DEBUFF", src: a.id, skill: "搓澡澡" });
          battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: m, status: st.def.id, name: st.def.name, by: "DISPEL", side: "ALLY", what: isControlDef(st.def) ? "CONTROL" : "DEBUFF", src: a.id, skill: "搓澡澡" }, m.id, m.teamId);
        }
        battle.trace.push({ t: "PASSIVE_PROC", actor: a.id, skill: "搓澡澡", effect: "敌方行动回合后，驱散友方" + n + "个减益/控制", target: m.id });
      }
      setMold(battle, a, moldOn(a) + 1);
    }, "ALL");
    out.push({ entityId: a.id, mechanic: "搓澡澡 (after each enemy turn: dispel up to 3 from a random debuffed ally, +1 霉球, cap 4, cleared at own turn end) · 脏兮兮 −25% effect hit 1 turn" });
  }
  return out;
}

export const KIT: BettingKit = {
  damageHook: (x: any) => (bettingActive() ? filthy(x) : null),
  install,
};
