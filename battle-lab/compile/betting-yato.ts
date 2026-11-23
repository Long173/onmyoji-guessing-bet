// compile/betting-yato.ts — 夜刀神 (373, Global "Yato no Kami") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 373_01..373_03, buffs 3731_1 共舞 / 3733_1 夜之楔, tips_11 / 17 / 18;
// data/kb/en-text.json; fandom "Yato no Kami/Main" (the 7 Sigil texts are only on the wiki).
//   黑夜的庇护 (373_03)  · "战斗开始前…受到的伤害降低49%，并获得70%效果抵抗". Every 夜之契 lowers it by 7% / 10%
//                         (7 triggers use it up: 49 = 7 × 7, 70 = 7 × 10).
//   夜之邀约 (373_02)    · passive: 15% lifesteal on all his damage; +1 共舞 (3731_1, cap 7) per bat sent
//                         (赤子 1 bat, 七夜秘仪 3 bats; 赤子 L5: 50% one more stack). Each stack gained raises his
//                         action bar 10% (buff text "每层增加自身10%行动条"). At 7 stacks, if not 无法动作: consume
//                         all, 3 hits of 77% ATK true damage on the lowest-HP enemy. (Evolved form: Nightfall on an
//                         enemy summon instead — not modeled, no summon in the betting lineups.)
//   七夜秘仪 (373_03)    · 3 bats on the target (270% total at L2, IR override: 3 × 90%), then 夜之楔 (3733_1) on it:
//                         唯一效果 (moved if re-applied), 1 turn, never on summons / onmyoji. No chance is written
//                         ⇒ it lands unless the target is immune.
//   夜之楔              · at the start of the bearer's turn it picks 1 of 2 random wedges not chosen since the last
//                         reset and a timing: "skip own turn" (effect now, the turn is skipped) or "at the end of own
//                         turn" (stronger effect at its turn end; nothing if it dies first). The bearer's AI choice is
//                         not documented: both picks are uniform random (assumption). The mark then goes.
//                         Every wedge trigger is a 夜之契: Shelter -7% / -10%, and 100% ATK true damage to all
//                         enemies that triggers no souls (input.noSoul).
//                         All 7 wedges triggered and Yato not 无法动作 ⇒ reset, 7 strikes (L3) of 77% ATK true damage
//                         on random enemies, each pushing the struck enemy's bar back 20% (L4).
//   Wedges (wiki, Global; "enemy" = Yato's enemies = the bearer's team):
//     1 止息  skip: enemy team -2 onibi            end: -2 onibi and max onibi -2 (permanent)
//     2 涸魂  skip: front enemy bar -30%           end: all enemies bar -20%, all allies bar +20%
//     3 竭血  skip: all enemies 100% ATK true      end: 200% ATK true; allies healed 80% of it, split evenly
//     4 腐髓  skip: bearer crit -80% (2 turns)     end: bearer crit -100%, other enemies -80% (2 turns)
//     5 震骨  skip: bearer passives+souls sealed   end: bearer + 3 random enemies sealed (100% base chance, 2 turns)
//     6 祸心  skip: bearer 80% confuse (1 turn)    end: bearer 100% / other enemies 60% confuse (2 turns)
//     7 封命  skip: bearer max HP -50% (permanent) end: all enemies max HP -30% (permanent)
//   Durations "N turns" are counted on Yato's turns (source turns, like the engine's skill statuses). If Yato is
//   dead when a wedge triggers, nothing happens (no source).
// Sealing: 夜之邀约 (lifesteal, 共舞, 7-stack strike) is a passive (sealed by 压制); Shelter and the wedge rules come
// from the active 七夜秘仪 and are not.
// AI: KB "3技能" whenever affordable (generic path).
import type { Entity } from "../kernel/entity.ts";
import { EntityType } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import { dealDamage, applyLifesteal } from "../kernel/damage.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, stacksOn,
  setStackedStatus, shiftBar, drainOrbs, applyContested, scaleMaxHp, hasLevelLine, levelNumber,
} from "./betting-shared.ts";
import { currentHit } from "./betting-scope.ts";

export const YATO = Object.freeze({
  shelterCut: 0.49, shelterRes: 0.7, pactCut: 0.07, pactRes: 0.1, pactRatio: 1.0,
  lifesteal: 0.15, waltzCap: 7, waltzBar: 0.1, inviteHits: 3, inviteRatio: 0.77,
  resetHits: 3, resetHitsL3: 7, resetPushL4: 0.2, resetRatio: 0.77,
  s1ExtraWaltz: 0.5, s3Bats: 3, s1Bats: 1,
});

export const WALTZ_ID = "3731_1";
export const WEDGE_ID = "3733_1";
const SHELTER_ID = "373_shelter";
const SKIP_ID = "373_wedge_skip";
const CRIT_ID = "373_wedge_crit";
const SEAL_ID = "373_wedge_seal";
const NOTE_CHOSEN = "yato373:chosen=";
const NOTE_DONE = "yato373:done=";
const NOTE_PACTS = "yato373:pacts=";
const NOTE_S3_TARGET = "yato373:s3target=";
const NOTE_PENDING = "yato373:pending=";   // "<bearerId>:<wedge>" — an end-of-turn wedge waiting for its trigger

export const WEDGE_NAMES = ["", "止息", "涸魂", "竭血", "腐髓", "震骨", "祸心", "封命"];

const waltzDef = () => markDef({ id: WALTZ_ID, name: "共舞", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】上限7层，每层增加自身10%行动条。" }, StatusBook);
const wedgeDef = () => markDef({ id: WEDGE_ID, name: "夜之楔", category: StatusCategory.DEBUFF_MARK, durationPolicy: "GLOBAL", dispellable: false, removable: false,
  desc: "【减益、印记】唯一效果。共7种楔子。被附加的目标回合开始前需从2种随机楔子中选择触发效果和时机。（betting: 选择结算后移除）" }, StatusBook);
const shelterDef = () => markDef({ id: SHELTER_ID, name: "黑夜的庇护", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  desc: "七夜秘仪：受到的伤害降低49%，获得70%效果抵抗；每次夜之契触发时减少7% / 10%。" }, StatusBook);
const skipDef = () => markDef({ id: SKIP_ID, name: "夜之楔·跳过回合", category: StatusCategory.COMMON_MARK, durationPolicy: "TARGET_TURN", preventsAction: true,
  desc: "夜之楔：选择「跳过自身回合」时，本回合无法行动。" }, StatusBook);
const critDef = () => markDef({ id: CRIT_ID, name: "腐髓", category: StatusCategory.DEBUFF_STATE, durationPolicy: "SOURCE_TURN", dispellable: true, removable: true,
  desc: "四の楔・腐髓：暴击降低。" }, StatusBook);
const sealDef = () => markDef({ id: SEAL_ID, name: "震骨", category: StatusCategory.DEBUFF_STATE, durationPolicy: "SOURCE_TURN", dispellable: true, removable: true,
  suppressPassive: true, suppressSoul: true, desc: "五の楔・震骨：被动技能与御魂效果被封印。" }, StatusBook);

export const isYato373 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "373_03") && !!skillById(e, "373_02");
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const aliveAllies = (battle: any, e: Entity): Entity[] => (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive);
const listNote = (e: Entity, key: string): number[] => (noteValue(e, key) ?? "").split(",").filter(Boolean).map(Number);
export const waltzStacks = (y: Entity): number => stacksOn(y, WALTZ_ID, y.id);
export const pactCount = (y: Entity): number => Number(noteValue(y, NOTE_PACTS) ?? 0);
export const wedgesDone = (y: Entity): number[] => listNote(y, NOTE_DONE);

function resetHitsOf(y: Entity): number {
  const x = skillById(y, "373_03")?.ir;
  return levelNumber(x, /攻击次数增加到(\d+)次/, null, YATO.resetHits);
}
const resetPushOf = (y: Entity): number => (hasLevelLine(skillById(y, "373_03")?.ir, /行动条击退/) ? YATO.resetPushL4 : 0);

// ───────────────────────── 黑夜的庇护 ─────────────────────────

function setShelter(y: Entity): void {
  const n = pactCount(y);
  const cut = Math.max(0, YATO.shelterCut - YATO.pactCut * n);
  const res = Math.max(0, YATO.shelterRes - YATO.pactRes * n);
  setStackedStatus(y, shelterDef(), 1, 1, y.id, [{ prop: "dmgTakenD", value: -cut, mode: "FIXED" }, { prop: "efr", value: res, mode: "FIXED" }]);
}

// ───────────────────────── damage helpers ─────────────────────────

async function trueHit(battle: any, y: Entity, v: Entity, ratio: number, id: string, o: { noSoul?: boolean; tag: string }): Promise<number> {
  let dealt = 0;
  await battle.withinResolution({ id, type: "HIT" }, async () => {
    if (!v.alive) return;
    const r = await dealDamage(battle, { source: y, target: v, base: y.prop("atk") * ratio, rate: 1, type: DamageType.TRUE, skillTag: "betting-yato:" + o.tag, ...(o.noSoul ? { noSoul: true } : {}) });
    dealt = Number(r?.applied ?? 0) + Number(r?.absorbed ?? 0);
  });
  return dealt;
}

async function trueAll(battle: any, y: Entity, ratio: number, tag: string, noSoul = false): Promise<number> {
  let total = 0;
  const pool = aliveEnemies(battle, y);
  for (let i = 0; i < pool.length; i++) total += await trueHit(battle, y, pool[i], ratio, "HIT:" + tag + "#" + (i + 1), { noSoul, tag });
  return total;
}

// ───────────────────────── 共舞 / 夜之邀约 ─────────────────────────

export async function gainWaltz(battle: any, y: Entity, n: number, reason: string): Promise<void> {
  if (!y.alive || !(n > 0) || y.statuses.some(s => s.def.suppressPassive)) return;
  for (let i = 0; i < n; i++) {
    const before = waltzStacks(y);
    if (before < YATO.waltzCap) {
      const after = setStackedStatus(y, waltzDef(), before + 1, YATO.waltzCap, y.id, []);
      battle.trace.push({ t: "STATUS_APPLY", src: y.id, dst: y.id, status: WALTZ_ID, name: "共舞", category: StatusCategory.COMMON_MARK, duration: PERSIST, ref: WALTZ_ID, known: true, stacks: after, threshold: YATO.waltzCap, reason, skill: "夜之邀约" });
      shiftBar(battle, y, YATO.waltzBar, "共舞");
    }
    if (waltzStacks(y) >= YATO.waltzCap) await invite(battle, y);
  }
}

/** 7 stacks and able to act: consume all, 3 × 77% ATK true damage on the lowest-HP enemy. */
async function invite(battle: any, y: Entity): Promise<void> {
  if (!y.alive || isActionPrevented(y.statusDefs())) return;
  const pool = aliveEnemies(battle, y);
  if (!pool.length) return;
  setStackedStatus(y, waltzDef(), 0, YATO.waltzCap, y.id, []);
  battle.trace.push({ t: "STACKS_CONSUMED", id: y.id, status: WALTZ_ID, name: "共舞", from: YATO.waltzCap, to: 0, reason: "INVITE", skill: "夜之邀约" });
  const target = pool.reduce((a, b) => (b.hp < a.hp ? b : a), pool[0]);
  battle.trace.push({ t: "SUBCAST", actor: y.id, ref: "373_02", skill: "夜之邀约", target: target.id, clause: "累计获得7层时，若未处于无法动作，消耗当前层数，对生命最低的敌方目标造成3段攻击77%的真实伤害" });
  for (let h = 0; h < YATO.inviteHits; h++) await trueHit(battle, y, target, YATO.inviteRatio, "HIT:夜之邀约#" + (h + 1), { tag: "夜之邀约" });
}

// ───────────────────────── 夜之楔 ─────────────────────────

function wedgeHolder(battle: any, y: Entity): Entity | null {
  return aliveEnemies(battle, y).find(v => v.statuses.some(s => s.def.id === WEDGE_ID && s.sourceId === y.id)) ?? null;
}

function removeWedge(battle: any, y: Entity, v: Entity, by: string): void {
  for (const st of [...v.statuses]) {
    if (st.def.id !== WEDGE_ID || st.sourceId !== y.id || !v.expireStatus(st)) continue;
    battle.trace.push({ t: "STATUS_REMOVE", id: v.id, status: WEDGE_ID, name: "夜之楔", by, side: "ENEMY", what: "MARK", src: y.id, skill: "七夜秘仪" });
  }
}

/** After 七夜秘仪: 夜之楔 on the cast target (唯一效果: moved), never on summons / onmyoji. */
export function placeWedge(battle: any, y: Entity, target: Entity | null): void {
  if (!target?.alive || target.teamId === y.teamId || isSummonUnit(target) || target.type === EntityType.ONMYOJI) return;
  for (const v of battle.enemiesOf(y.teamId) as Entity[]) if (v.id !== target.id) removeWedge(battle, y, v, "MOVED");
  const pend = noteValue(y, NOTE_PENDING);
  if (pend && Number(pend.split(":")[0]) !== target.id) setNote(y, NOTE_PENDING, null);
  if (target.statuses.some(s => s.def.id === WEDGE_ID && s.sourceId === y.id)) return;
  const def = wedgeDef();
  const a = target.addStatus(def, y.id, 1, PERSIST, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: y.id, dst: target.id, status: WEDGE_ID, name: def.name, category: def.category, duration: 1, ref: WEDGE_ID, known: true, tag: a.tag, skill: "七夜秘仪" });
}

/** Two random wedges not chosen since the last reset (if none is left: the chosen ones that never triggered). */
function offer(battle: any, y: Entity): number[] {
  const chosen = new Set(listNote(y, NOTE_CHOSEN));
  const done = new Set(wedgesDone(y));
  let pool = [1, 2, 3, 4, 5, 6, 7].filter(w => !chosen.has(w));
  if (!pool.length) pool = [1, 2, 3, 4, 5, 6, 7].filter(w => !done.has(w));
  const out: number[] = [];
  for (let i = 0; i < 2 && pool.length; i++) {
    battle.rng.expect("yato373_wedge_offer#" + (i + 1));
    const w = pool.length === 1 ? pool[0] : battle.rng.pick(pool);
    out.push(w);
    pool = pool.filter(x => x !== w);
  }
  return out;
}

async function onBearerTurnStart(battle: any, y: Entity, b: Entity): Promise<void> {
  const choices = offer(battle, y);
  if (!choices.length) { removeWedge(battle, y, b, "NO_WEDGE_LEFT"); return; }
  battle.rng.expect("yato373_wedge_pick");
  const wedge = choices.length === 1 ? choices[0] : battle.rng.pick(choices);
  battle.rng.expect("yato373_wedge_timing");
  const skip = battle.rng.testHit(0.5);
  setNote(y, NOTE_CHOSEN, [...listNote(y, NOTE_CHOSEN), wedge].join(","));
  battle.trace.push({ t: "WEDGE_CHOICE", src: y.id, bearer: b.id, offered: choices, wedge, name: WEDGE_NAMES[wedge], timing: skip ? "SKIP_TURN" : "TURN_END", note: "bearer AI choice: uniform random (assumption)" });
  if (!skip) { setNote(y, NOTE_PENDING, b.id + ":" + wedge); return; }
  removeWedge(battle, y, b, "TRIGGERED");
  const def = skipDef();
  const a = b.addStatus(def, y.id, 1, 1, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: y.id, dst: b.id, status: SKIP_ID, name: def.name, category: def.category, duration: 1, ref: WEDGE_ID, known: true, tag: a.tag, skill: "夜之楔" });
  await triggerWedge(battle, y, b, wedge, false);
}

async function onBearerTurnEnd(battle: any, y: Entity, b: Entity): Promise<void> {
  const pend = noteValue(y, NOTE_PENDING);
  if (!pend) return;
  const [id, w] = pend.split(":").map(Number);
  if (id !== b.id) return;
  setNote(y, NOTE_PENDING, null);
  removeWedge(battle, y, b, "TRIGGERED");
  if (b.alive) await triggerWedge(battle, y, b, w, true);
}

async function triggerWedge(battle: any, y: Entity, b: Entity, w: number, end: boolean): Promise<void> {
  if (!y.alive) { battle.trace.push({ t: "WEDGE_SKIPPED", src: y.id, bearer: b.id, wedge: w, reason: "SOURCE_DEAD" }); return; }
  battle.trace.push({ t: "WEDGE_TRIGGER", src: y.id, bearer: b.id, wedge: w, name: WEDGE_NAMES[w], timing: end ? "TURN_END" : "SKIP_TURN" });
  const skill = "夜之楔·" + WEDGE_NAMES[w];
  const foes = () => aliveEnemies(battle, y);
  const others = () => foes().filter(v => v.id !== b.id);
  switch (w) {
    case 1:
      drainOrbs(battle, y, b.teamId, 2, skill);
      if (end) {
        const pool = battle.teams[b.teamId].orbs;
        pool.policy = { ...pool.policy, maxOrb: Math.max(0, pool.policy.maxOrb - 2) };
        if (pool.orb > pool.policy.maxOrb) pool.orb = pool.policy.maxOrb;
        battle.trace.push({ t: "MAX_ORB_CHANGE", team: b.teamId, maxOrb: pool.policy.maxOrb, delta: -2, skill });
      }
      break;
    case 2:
      if (!end) {
        const front = foes().reduce<Entity | null>((a, v) => (!a || (battle.timeline.get(v.id)?.pos ?? 0) > (battle.timeline.get(a.id)?.pos ?? 0) ? v : a), null);
        if (front) shiftBar(battle, front, -0.3, skill);
      } else {
        for (const v of foes()) shiftBar(battle, v, -0.2, skill);
        for (const m of aliveAllies(battle, y)) shiftBar(battle, m, 0.2, skill);
      }
      break;
    case 3: {
      const dealt = await trueAll(battle, y, end ? 2 : 1, skill);
      if (end && dealt > 0) {
        const allies = aliveAllies(battle, y);
        for (const m of allies) await battle.heal(y, m, dealt * 0.8 / allies.length, { crit: false });
      }
      break;
    }
    case 4:
      await applyContested(battle, y, b, critDef(), null, 2, [{ prop: "cri", value: end ? -1 : -0.8, mode: "FIXED" }], { skill, ref: WEDGE_ID });
      if (end) for (const v of others()) await applyContested(battle, y, v, critDef(), null, 2, [{ prop: "cri", value: -0.8, mode: "FIXED" }], { skill, ref: WEDGE_ID });
      break;
    case 5: {
      const targets = [b];
      if (end) {
        let pool = others();
        for (let i = 0; i < 3 && pool.length; i++) {
          battle.rng.expect("yato373_seal_target#" + (i + 1));
          const v = battle.rng.pick(pool) ?? pool[0];
          targets.push(v);
          pool = pool.filter(x => x.id !== v.id);
        }
      }
      for (const v of targets) await applyContested(battle, y, v, sealDef(), 1, 2, [], { skill, ref: WEDGE_ID });
      break;
    }
    case 6: {
      const confuse = StatusBook.get("confuse")!;
      await applyContested(battle, y, b, confuse, end ? 1 : 0.8, end ? 2 : 1, [], { skill, ref: "CONTROL:confuse" });
      if (end) for (const v of others()) await applyContested(battle, y, v, confuse, 0.6, 2, [], { skill, ref: "CONTROL:confuse" });
      break;
    }
    case 7:
      if (!end) scaleMaxHp(battle, b, -0.5, skill);
      else for (const v of foes()) scaleMaxHp(battle, v, -0.3, skill);
      break;
  }
  await nightPact(battle, y);
  const done = [...new Set([...wedgesDone(y), w])];
  setNote(y, NOTE_DONE, done.join(","));
  if (done.length >= 7) await resetWedges(battle, y);
}

/** 夜之契: Shelter -7% / -10%, 100% ATK true damage to all enemies that triggers no souls. */
async function nightPact(battle: any, y: Entity): Promise<void> {
  if (!y.alive) return;
  setNote(y, NOTE_PACTS, pactCount(y) + 1);
  if (y.hasStatus(SHELTER_ID)) setShelter(y);
  battle.trace.push({ t: "NIGHT_PACT", src: y.id, count: pactCount(y), skill: "夜之契" });
  await trueAll(battle, y, YATO.pactRatio, "夜之契", true);
}

/** 7 wedges triggered, Yato able to act: reset, 7 strikes of 77% true damage on random enemies (L4: 20% push each). */
async function resetWedges(battle: any, y: Entity): Promise<void> {
  if (!y.alive || isActionPrevented(y.statusDefs())) return;
  setNote(y, NOTE_DONE, null);
  setNote(y, NOTE_CHOSEN, null);
  const hits = resetHitsOf(y), push = resetPushOf(y);
  battle.trace.push({ t: "WEDGE_RESET", src: y.id, hits, push, skill: "夜之楔" });
  for (let h = 0; h < hits; h++) {
    const pool = aliveEnemies(battle, y);
    if (!pool.length) break;
    battle.rng.expect("yato373_reset_hit#" + (h + 1));
    const v = battle.rng.pick(pool) ?? pool[0];
    await trueHit(battle, y, v, YATO.resetRatio, "HIT:夜之楔#" + (h + 1), { tag: "夜之楔·重置" });
    if (push > 0 && v.alive) shiftBar(battle, v, -push, "夜之楔");
  }
}

// ───────────────────────── hooks ─────────────────────────

/** After an active cast of 赤子 / 七夜秘仪: wedge on the S3 target, then the bats' 共舞 stacks. */
export async function yatoAfterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isYato373(self) || (x?.id !== "373_01" && x?.id !== "373_03")) return false;
  if (x.id === "373_03") {
    const id = Number(noteValue(self, NOTE_S3_TARGET) ?? NaN);
    setNote(self, NOTE_S3_TARGET, null);
    placeWedge(battle, self, aliveEnemies(battle, self).find(v => v.id === id) ?? null);
    await gainWaltz(battle, self, YATO.s3Bats, "BATS");
    return true;
  }
  let n = YATO.s1Bats;
  if (hasLevelLine(x, /概率额外获得1层/)) {
    battle.rng.expect("yato373_s1_extra_waltz");
    if (battle.rng.testHit(YATO.s1ExtraWaltz)) n++;
  }
  await gainWaltz(battle, self, n, "BATS");
  return true;
}

/** IR patch (MAX): the wedge is placed by betting-yato.ts after the cast (唯一效果, rules above). */
export const YATO_PATCHES = Object.freeze({
  "373_03": { note: "七夜秘仪: 夜之楔 is placed by betting-yato.ts (moved, never on summons) and run there", patch: { statusRefConditionOnly: [0] } },
});

export function installYato(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const y of entities.filter(isYato373)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, passive: boolean, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:373:" + code + (passive ? ":p:" : ":a:") + y.id, y.id, code, fn, range, { passive });
    // 黑夜的庇护 (active skill text, battle start).
    reg(EV.BATTLE_START, () => { if (!y.hasStatus(SHELTER_ID)) setShelter(y); }, false, "SELF");
    // 夜之邀约: 15% lifesteal on every damage he deals (passive).
    reg(EV.AFTER_DAMAGE, async (ctx: any) => {
      if (ctx?.input?.source?.id !== y.id || !y.alive) return;
      if (ctx.input.lifesteal) return;   // the skill already carries its own lifesteal
      await applyLifesteal(battle, y, YATO.lifesteal, ctx.result, "夜之邀约");
    }, true);
    // 七夜秘仪: remember the bats' target (the wedge goes there after the cast).
    reg(EV.AFTER_DAMAGE, (ctx: any) => {
      if (ctx?.input?.source?.id !== y.id) return;
      if (currentHit(battle).skill !== (skillById(y, "373_03")?.name ?? "七夜秘仪")) return;
      setNote(y, NOTE_S3_TARGET, ctx.input.target.id);
    }, false);
    reg(EV.TURN_START, async (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (!a || a.teamId === y.teamId || (ctx.type !== "NORMAL" && ctx.type !== "NEW_TURN")) return;
      if (wedgeHolder(battle, y)?.id !== a.id || noteValue(y, NOTE_PENDING)) return;
      await onBearerTurnStart(battle, y, a);
    }, false);
    reg(EV.TURN_END, async (ctx: any) => {
      const a: Entity | undefined = ctx?.actor;
      if (a && a.teamId !== y.teamId) await onBearerTurnEnd(battle, y, a);
    }, false);
    out.push({ entityId: y.id, mechanic: "黑夜的庇护 · 夜之楔 (7 wedges, 夜之契, reset) · 夜之邀约 (共舞, lifesteal)" });
  }
  return out;
}
