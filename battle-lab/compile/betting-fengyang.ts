// compile/betting-fengyang.ts — 封阳君 (SSR 575, Global "Fengyang") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 575_01..575_03, buffs 5752_1 通缉 / 5753_1 霁雪 / 5754_1 晴空, tips_14 庇护 /
// tips_112 深度冰冻; fandom "Fuuyoukun/Main" (the style variants are not in the KB).
//   流派 (575_02, passive) · casting 封阳刀法 switches to 霁雪 (Cold Snow), casting 望月星河 to 晴空 (Clear Sky).
//                         In any style: 50% damage reduction. L2: 庇护 at battle start and after every switch
//                         (blocks the control effects / banishment of one skill; consumed). L5: a switch during
//                         his own turn gives +100% action bar, "每回目限1次" = once per ROUND (回目), not per turn:
//                         the round is the betting referee round (kernel/environment.ts, env.round; HYPOTHESIS:
//                         回目 = referee round). Without a referee policy it falls back to once per turn.
//                         Match-6 replay: one bonus at the start (plain 望月星河 → 艳阳 at once), then 艳阳 every
//                         turn (5 casts); the per-turn reading let him chain basic ↔ ult switches (9.7 casts).
//                         Style switches only on casts in his own turn (邀战 / pseudo-turn basics do not switch;
//                         HYPOTHESIS from the same replay — see fengyangAfterCast).
//   通缉 (5752_1)         · after attacking, every enemy hit gets 通缉 (50% vulnerability, 2 of its turns; a debuff
//                         ⇒ effect-RES contest under the betting resist policy; a re-hit refreshes it).
//   Skill table by style (wiki):
//     no style · 封阳刀法 125% · 望月星河 3 × 25% all enemies (KB cost 1, L5 -1 ⇒ 0).
//     霁雪     · 寒雪 2 × 50%, each 30% base Deep Freeze 1 turn · 雪影 3 × 40% all enemies, 12% base Freeze per hit,
//                Deep Freeze at L2 (cost 3, L5 -1 ⇒ 2).
//     晴空     · 晴空 3 hits 25% / 35% / 165% · 艳阳 3 × all enemies 25% / 35% / 180% (cost 3 - 1 ⇒ 2).
//   AI (KB)  · "3技能" whenever affordable, otherwise the (style) normal attack; 龙韬豹略's active part (reset +75%
//              bar) is never chosen (no AI row).
// Not modelled: L3 counter when pushed back, L4 +40 SPD when an enemy freeze-type effect is removed.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import type { StatusDef } from "../kernel/status.ts";
import { bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, shiftBar, applyContested } from "./betting-shared.ts";
import { inOwnTurn } from "./betting-scope.ts";

export const FENGYANG = Object.freeze({
  styleCut: 0.5, wantedVuln: 0.5, wantedTurns: 2, switchBar: 1,
  styledCost: 3, costCut: 1,
  snowBasic: [50, 50], snowFreezeP: 0.3, skyBasic: [25, 35, 165],
  snowUlt: 40, snowUltP: 0.12, skyUlt: [25, 35, 180], plainUlt: 25,
});

export const WANTED_ID = "5752_1";
export const SNOW_ID = "5753_1";
export const SKY_ID = "5754_1";
export const F_SHELTER_ID = "575_shelter";
export type Style = "NONE" | "SNOW" | "SKY";

const wantedDef = () => markDef({ id: WANTED_ID, name: "通缉", category: StatusCategory.DEBUFF_MARK, durationPolicy: "TARGET_TURN",
  desc: "【减益、印记】50%易伤。（betting: 持续携带者2个回合）" }, StatusBook);
const snowDef = () => markDef({ id: SNOW_ID, name: "霁雪", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】『封阳刀法』替换为『封阳刀法·寒雪』，『望月星河』替换为『望月星河·雪影』。处于流派时获得50%减伤。" }, StatusBook);
const skyDef = () => markDef({ id: SKY_ID, name: "晴空", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】『封阳刀法』替换为『封阳刀法·晴空』，『望月星河』替换为『望月星河·艳阳』。处于流派时获得50%减伤。" }, StatusBook);
const shelterDef = () => markDef({ id: F_SHELTER_ID, name: "庇护", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN",
  immuneTo: ["CONTROL", "BANISH"], consumeOnImmune: true, desc: "可抵挡单次技能当中的所有控制效果和放逐（betting: 抵挡1次）。" }, StatusBook);

/** Control defs counted on the bearer's turns ("持续1回合" = the bearer's next turn). */
const targetTurnDefs = new Map<string, StatusDef>();
export function bearerTurnControl(id: string): StatusDef {
  const known = targetTurnDefs.get(id);
  if (known) return known;
  const d = { ...StatusBook.get(id)!, durationPolicy: "TARGET_TURN" as const };
  targetTurnDefs.set(id, d);
  return d;
}

export const isFengyang575 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "575_02") && !!skillById(e, "575_03");
export const styleOf = (e: Entity): Style => (e.hasStatus(SNOW_ID) ? "SNOW" : e.hasStatus(SKY_ID) ? "SKY" : "NONE");
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);

function grantShelter(battle: any, f: Entity, turns: number, reason: string): void {
  for (const st of [...f.statuses]) if (st.def.id === F_SHELTER_ID) f.expireStatus(st);
  const def = shelterDef();
  const a = f.addStatus(def, f.id, 1, turns, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: f.id, dst: f.id, status: F_SHELTER_ID, name: def.name, category: def.category, duration: turns, ref: "tips_14", known: true, tag: a.tag, reason, skill: "龙韬豹略" });
}

function setStyle(battle: any, f: Entity, next: Style): boolean {
  const cur = styleOf(f);
  if (cur === next) return false;
  for (const st of [...f.statuses]) if (st.def.id === SNOW_ID || st.def.id === SKY_ID) f.expireStatus(st);
  if (next !== "NONE") {
    const def = next === "SNOW" ? snowDef() : skyDef();
    f.addStatus(def, f.id, 1, 99999, [{ prop: "dmgTakenD", value: -FENGYANG.styleCut, mode: "FIXED" }], 1);
  }
  battle.trace.push({ t: "STYLE_SWITCH", id: f.id, from: cur, to: next, skill: "龙韬豹略" });
  return true;
}

/** Onibi cost: the style variants of 望月星河 cost 3 (wiki) - 1 (L5). */
export function fengyangCost(self: Entity, sk: any, base: number): number {
  if (!bettingActive() || (sk?.ir?.id ?? sk?.id) !== "575_03" || !isFengyang575(self) || styleOf(self) === "NONE") return base;
  return Math.max(0, FENGYANG.styledCost - FENGYANG.costCut);
}

/** Enemies hit by the running cast (transient, per caster) ⇒ 通缉 after the attack. */
const hitThisCast = new WeakMap<object, Set<number>>();

async function strike(battle: any, self: Entity, v: Entity, ratio: number, id: string, hurt: Entity[]): Promise<boolean> {
  let landed = false;
  await battle.withinResolution({ id, type: "HIT" }, async () => {
    if (!v.alive) return;
    if (!hurt.includes(v)) hurt.push(v);
    (hitThisCast.get(self) ?? hitThisCast.set(self, new Set()).get(self)!).add(v.id);
    await battle.damage(self, v, self.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, null);
    landed = true;
  });
  return landed;
}

async function freezeRoll(battle: any, self: Entity, v: Entity, p: number, controlId: string, skill: string): Promise<void> {
  if (!v.alive) return;
  await applyContested(battle, self, v, bearerTurnControl(controlId), p, 1,
    controlId === "deepFreeze" ? [{ prop: "spd", value: -20, mode: "FIXED" }] : [], { skill, ref: "CONTROL:" + controlId });
}

type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };

export function fengyangDamageHook(x: any): Hook | null {
  if (x?.id !== "575_01" && x?.id !== "575_03") return null;
  return {
    kind: "FENGYANG_STYLE",
    run: async (battle, self, hurt, primary) => {
      const style = isFengyang575(self) ? styleOf(self) : "NONE";
      const t = primary?.alive && primary.teamId !== self.teamId ? primary : aliveEnemies(battle, self)[0];
      if (x.id === "575_01") {
        if (!t) return;
        if (style === "NONE") { await strike(battle, self, t, Number(x.damage?.[0]?.ratioMax ?? 125), "HIT:" + x.name + "#1", hurt); return; }
        const ratios = style === "SNOW" ? FENGYANG.snowBasic : FENGYANG.skyBasic;
        for (const [i, r] of ratios.entries()) {
          await strike(battle, self, t, r, "HIT:" + x.name + "#" + (i + 1), hurt);
          if (style === "SNOW") await freezeRoll(battle, self, t, FENGYANG.snowFreezeP, "deepFreeze", "封阳刀法·寒雪");
        }
        return;
      }
      const waves = style === "SKY" ? FENGYANG.skyUlt : style === "SNOW" ? [FENGYANG.snowUlt, FENGYANG.snowUlt, FENGYANG.snowUlt] : [FENGYANG.plainUlt, FENGYANG.plainUlt, FENGYANG.plainUlt];
      for (const [i, r] of waves.entries()) {
        for (const v of aliveEnemies(battle, self)) {
          await strike(battle, self, v, r, "HIT:" + x.name + "#" + (i + 1) + "." + v.id, hurt);
          if (style === "SNOW") await freezeRoll(battle, self, v, FENGYANG.snowUltP, "deepFreeze", "望月星河·雪影");
        }
      }
    },
  };
}

async function applyWanted(battle: any, f: Entity, ids: Set<number>): Promise<void> {
  const def = wantedDef();
  for (const v of aliveEnemies(battle, f)) {
    if (!ids.has(v.id)) continue;
    const st = v.statuses.find(s => s.def.id === WANTED_ID && s.sourceId === f.id);
    if (st) { st.remaining = Math.max(st.remaining, FENGYANG.wantedTurns); continue; }
    await applyContested(battle, f, v, def, null, FENGYANG.wantedTurns, [{ prop: "dmgTakenD", value: FENGYANG.wantedVuln, mode: "FIXED" }], { skill: "龙韬豹略", ref: WANTED_ID });
  }
}

/** "每回目限1次": the referee round when the betting endgame runs referee rounds, otherwise the turn. */
function roundKey(battle: any): string {
  return battle?.policies?.endgame?.mode === "REFEREE_ROUNDS" ? "r" + Number(battle.environment?.round ?? 0) : String(battle.turn ?? 0);
}

/** After 封阳刀法 / 望月星河: 通缉 on the enemies hit, style switch, 庇护, L5 bar. */
export async function fengyangAfterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || (x?.id !== "575_01" && x?.id !== "575_03") || !isFengyang575(self)) return false;
  const ids = hitThisCast.get(self) ?? new Set<number>();
  hitThisCast.delete(self);
  if (self.alive) await applyWanted(battle, self, ids);
  // HYPOTHESIS (match-6 replay): only casts in his own turn switch the style. Inaba's 邀战 basic attack on her
  // turn would turn 晴空 into 霁雪 (and his next ultimate into 雪影), yet the replay shows 艳阳 on every one of his
  // turns while Inaba's 寂光映月 was in play.
  const own = inOwnTurn(battle, self);
  if (!self.alive || !own || !setStyle(battle, self, x.id === "575_01" ? "SNOW" : "SKY")) return true;
  grantShelter(battle, self, 2, "STYLE_SWITCH");
  const key = roundKey(battle);
  if (own && noteValue(self, "fengyang575:bar=") !== key) {
    setNote(self, "fengyang575:bar=", key);
    shiftBar(battle, self, FENGYANG.switchBar, "龙韬豹略");
  }
  return true;
}

/** KB AI: 3技能 whenever affordable, else the normal attack (the active part of 龙韬豹略 is never chosen). */
export function fengyangRuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isFengyang575(self)) return null;
  const ult = skillById(self, "575_03");
  const c = costOf(ult);
  if (ult && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c))) return { skill: ult, rule: "封阳君: 鬼火足够 → 望月星河 (KB AI)" };
  const basic = skillById(self, "575_01");
  return basic ? { skill: basic, rule: "封阳君: 鬼火不足 → 封阳刀法" } : null;
}

export function fengyangGate(sk: any): string | null {
  return sk?.ir?.id === "575_02" ? "NEVER_CAST (KB AI has no row for 龙韬豹略)" : null;
}

/** IR patches (MAX): styles, 通缉 and the variants are run by betting-fengyang.ts. */
export const FENGYANG_PATCHES = Object.freeze({
  "575_02": { note: "龙韬豹略: 通缉 / 霁雪 / 晴空 are run by betting-fengyang.ts", patch: { statusRefConditionOnly: [0, 1, 2] } },
});

export function installFengyang(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const f = entities.find(isFengyang575);   // 唯一效果
  if (!f) return out;
  registerOwnerHandler(battle, "betting:575:start:" + f.id, f.id, EV.BATTLE_START, () => {
    if (!f.hasStatus(F_SHELTER_ID) && styleOf(f) === "NONE") grantShelter(battle, f, 1, "BATTLE_START");
  });
  out.push({ entityId: f.id, mechanic: "流派 (霁雪/晴空, 50% 减伤, 庇护, +100% bar) · 通缉 · style skill variants" });
  return out;
}
