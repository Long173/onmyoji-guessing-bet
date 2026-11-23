// compile/betting-senhime.ts — 鲸汐千姬 (Senhime Resurgent, 562) at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 562_02 / 562_03, buffs 5621_1 冰眠 / 5622_1 海凝 / 5623_1 汐流祝福,
// tips 5621 极昼鲸 / 5622 永夜鲸, plus the user's in-game confirmation (AI: always 562_03, never 562_02).
//
//   永生之海幻境 (562_03)   · L5 先机: opens at battle start. Recast while it is up ⇒ summons 1 极昼鲸.
//                          · 2 turns, counted on Senhime's own turns (the turn it is opened does not count);
//                            if she is dead it counts the turns of her non-summon allies instead (text silent).
//                          · while up: every skill of her team costs 1 onibi less (minimum 0)
//                            ⇒ 鲸息洄梦 itself costs 1 when recast;
//                          · while up: non-conducted damage dealt by her team to a non-summon enemy stores
//                            20% (L3: 30%) of that damage in 海凝 on the target (whale bursts excluded: they
//                            would feed themselves; the text does not say);
//                          · L2: after each non-summon enemy turn every whale of her team gains 10% action bar.
//   海凝 (buff_5622_1)     · stacks hold up to 5000% of Senhime's INITIAL ATK each, max 9 (pool of 9 × 5000%).
//                          · when a 极昼鲸 acts the stored amount is dealt as INDIRECT damage and the mark is
//                            removed (the stored amount is already damage ⇒ no second defense reduction).
//   极昼鲸 (tips_5621)     · max 2; lasts 2 of its own turns (L4); action-bar summon (untargetable, immune to
//                            damage, no onibi gauge); acts: 海凝 worth 158% of Senhime's ATK on the 3 lowest-HP
//                            enemies, THEN every 海凝 bursts (order not stated: apply-then-burst assumed).
//   汐流祝福 (buff_5623_1) · gained at battle start (562_02 passive, never cast): dispellable/removable control
//                            on her becomes 冰眠 (buff_5621_1: cannot act, removed at her turn start);
//                          · L4: damage taken during 冰眠 ⇒ equal shield for 1 turn;
//                          · L5: dropping below 80% HP ⇒ immediately enters 冰眠 (on the crossing);
//                          · on death: summons 1 永夜鲸 (L3: 2 turns).
//   永夜鲸 (tips_5622)     · max 2; acts: +1 onibi, shield all allies for 98% of Senhime's ATK.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { createField, clearField, fieldsOf } from "../kernel/field.ts";
import type { FieldState } from "../kernel/field.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { inugamiDiscount } from "./betting-inugami.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, entityById, markDef, isControlDef, noteValue, setNote,
  grantTimedShield, gainOrbs, shiftBar, levelNumber, hasLevelLine, ensureGlobalHandler, ensureShieldTicker, registerOwnerHandler,
} from "./betting-shared.ts";

export const SENHIME = Object.freeze({
  illusion: "永生之海幻境",
  seaPerStackAtk: 50,        // buff_5622_1: 每层至多可储存鲸汐千姬初始攻击5000%伤害
  seaMaxStacks: 9,           // buff_5622_1: 上限9层
  dayWhaleRatio: 1.58,       // tips_5621: 附加鲸汐千姬攻击158%伤害的海凝
  dayWhaleTargets: 3,        // tips_5621: 敌方生命最低的3个目标
  nightWhaleShield: 0.98,    // tips_5622: 为全体友方附加鲸汐千姬攻击98%的护盾
  nightWhaleOrbs: 1,         // tips_5622: 行动时获得1点鬼火
  whaleCap: 2,               // tips_5621 / 5622: 至多存在2只
});

const SEA_ID = "5622_1", BLESS_ID = "5623_1", SLEEP_ID = "5621_1";
const SEA_NOTE = "seafrost:stored=";
const WHALE_NOTE = "whale:kind=", WHALE_OWNER = "whale:owner=", WHALE_TURNS = "whale:turns=";
const SLEEP_SHIELD_TURNS = 1;
type WhaleKind = "DAY" | "NIGHT";
const WHALE: Record<WhaleKind, { tipsId: string; name: string; evidence: string }> = {
  DAY: { tipsId: "5621", name: "极昼鲸", evidence: "至多存在2只。行动时为敌方生命最低的3个目标，附加鲸汐千姬攻击158%伤害的海凝。" },
  NIGHT: { tipsId: "5622", name: "永夜鲸", evidence: "至多存在2只。行动时获得1点鬼火，并为全体友方附加鲸汐千姬攻击98%的护盾。" },
};

const seaDef = () => markDef({ id: SEA_ID, name: "海凝", category: StatusCategory.COMMON_MARK,
  desc: "【通用、印记】上限9层。每层至多可储存鲸汐千姬初始攻击5000%伤害。极昼鲸行动时，造成间接伤害并移除。" }, StatusBook);
const blessDef = () => markDef({ id: BLESS_ID, name: "汐流祝福", category: StatusCategory.BUFF_MARK,
  desc: "【增益、印记】将自身携带的控制效果转化成冰眠；阵亡时，在行动条上召唤1只永夜鲸，存在1个回合。" }, StatusBook);
const sleepDef = () => markDef({ id: SLEEP_ID, name: "冰眠", category: StatusCategory.COMMON_MARK, preventsAction: true,
  desc: "【通用、印记】无法动作。回合开始时解除。" }, StatusBook);

const ir = (e: Entity, id: string): any => skillById(e, id)?.ir ?? null;
const isSenhime = (e: Entity): boolean => !!skillById(e, "562_03") && !isSummonUnit(e);

// ───────────────────────── numbers from the skill text ─────────────────────────

const seaRatioOf = (owner: Entity): number => levelNumber(ir(owner, "562_03"), /附加海凝的系数提升至(\d+)%/, /附加此伤害(\d+)%的/, 20) / 100;
const dayTurnsOf = (owner: Entity): number => levelNumber(ir(owner, "562_03"), /(?:tips_5621|极昼鲸)\]?的存在时间延长至(\d+)个回合/, /重复展开幻境时，唤来1只[^，。]*，存在(\d+)个回合/, 1);
const nightTurnsOf = (owner: Entity): number => levelNumber(ir(owner, "562_02"), /(?:tips_5622|永夜鲸)\]?的存在时间延长至(\d+)个回合/, /阵亡时，唤来1只[^，。]*，存在(\d+)个回合/, 1);
const illusionTurnsOf = (owner: Entity): number => levelNumber(ir(owner, "562_03"), /^$/, /展开存在(\d+)个回合的永生之海幻境/, 2);
const whalePullOf = (owner: Entity): number => {
  const x = ir(owner, "562_03");
  return hasLevelLine(x, /敌方回合结束后/) ? levelNumber(x, /提升(\d+)%行动条/, null, 0) / 100 : 0;
};
const opensAtStart = (owner: Entity): boolean => hasLevelLine(ir(owner, "562_03"), /先机[:：]?施放永生之海幻境/);
const sleepShieldOn = (owner: Entity): boolean => hasLevelLine(ir(owner, "562_02"), /冰眠期间受到伤害时，获得等量护盾/);
const sleepBelowOf = (owner: Entity): number | null => {
  const x = ir(owner, "562_02");
  return hasLevelLine(x, /生命小于\d+%时，立刻进入冰眠/) ? levelNumber(x, /生命小于(\d+)%时，立刻进入冰眠/, null, 80) / 100 : null;
};

// ───────────────────────── 永生之海幻境 ─────────────────────────

export function illusionOf(battle: any, teamId: number): FieldState | null {
  return fieldsOf(battle).find(f => f.kind === "ILLUSION" && f.name === SENHIME.illusion && f.teamId === teamId) ?? null;
}

/** Effective onibi cost of a skill for `self` (betting mode): -1 while her team's illusion is up, minimum 0. */
export function bettingCostOf(battle: any, self: Entity, sk: any): number {
  const base = Number(sk?.cost ?? 0);
  if (!bettingActive() || !(base > 0) || !battle?.teams) return base;
  const off = (illusionOf(battle, self.teamId) ? 1 : 0) + inugamiDiscount(battle, self, sk);
  return off > 0 ? Math.max(0, base - off) : base;
}

/** Opens (or re-opens) the illusion; returns true when it was already up (= a recast). */
function openIllusion(battle: any, owner: Entity, reason: string): boolean {
  const was = !!illusionOf(battle, owner.teamId);
  const turns = illusionTurnsOf(owner);
  const st: any = createField(battle, owner, {
    kind: "ILLUSION", name: SENHIME.illusion, duration: turns, durationSource: "CLAUSE", auras: [],
    evidence: "展开存在2个回合的永生之海幻境（" + reason + "；按鲸汐千姬自身回合计）",
  });
  if (st) {
    st.expiresTurn = Number.MAX_SAFE_INTEGER;   // expiry is counted on her turns (tickIllusions), not globally
    st.ownerTurnsLeft = turns;
    st.openedTurn = Number(battle.turn ?? 0);
  }
  return was;
}

function tickIllusions(battle: any, actor: Entity): void {
  for (const st of [...fieldsOf(battle)] as any[]) {
    if (st.name !== SENHIME.illusion || typeof st.ownerTurnsLeft !== "number") continue;
    const owner = entityById(battle, st.ownerId);
    const counts = owner?.alive ? actor.id === owner.id : (actor.teamId === st.teamId && !isSummonUnit(actor));
    if (!counts) continue;
    if (owner?.alive && st.openedTurn === Number(battle.turn ?? 0)) continue;
    st.ownerTurnsLeft--;
    if (st.ownerTurnsLeft <= 0) clearField(battle, st, "EXPIRED");
  }
}

// ───────────────────────── 海凝 ─────────────────────────

export const seaStored = (e: Entity): number => Number(noteValue(e, SEA_NOTE) ?? 0);

/** Adds `amount` to the 海凝 pool on `target` (capped at 9 stacks × 5000% of the owner's initial ATK). */
export function addSea(battle: any, owner: Entity, target: Entity, amount: number, reason: string, skill: string): void {
  if (!target?.alive || !(amount > 0)) return;
  const perStack = SENHIME.seaPerStackAtk * (owner.base.atk ?? 0);
  const max = perStack * SENHIME.seaMaxStacks;
  const before = seaStored(target);
  const after = Math.min(max, before + amount);
  const stacks = Math.min(SENHIME.seaMaxStacks, Math.max(1, GameMath.floorAt((after - 1e-9) / perStack, "SEA_FROST_STACKS") + 1));
  const st = target.statuses.find(s => s.def.id === SEA_ID);
  if (!st) {
    const def = seaDef();
    const a = target.addStatus(def, owner.id, stacks, PERSIST, [], SENHIME.seaMaxStacks);
    battle.trace.push({ t: "STATUS_APPLY", src: owner.id, dst: target.id, status: SEA_ID, name: def.name, category: def.category, duration: PERSIST, ref: SEA_ID, known: true, tag: a.tag, stacks, skill });
  } else {
    st.stacks = stacks;
  }
  setNote(target, SEA_NOTE, after);
  battle.trace.push({
    t: "SEA_FROST_STORE", src: owner.id, dst: target.id, added: GameMath.display(after - before),
    stored: GameMath.display(after), stacks, capped: before + amount > max, reason, skill,
  });
}

/** Every 海凝 on the enemies of `owner` bursts as INDIRECT damage from `whale`, then is removed. */
async function burstSea(battle: any, whale: Entity, owner: Entity): Promise<void> {
  const foes: Entity[] = battle.teams[1 - owner.teamId].members.filter((v: Entity) => v.alive);
  for (const v of foes) {
    const st = v.statuses.find(s => s.def.id === SEA_ID);
    const stored = seaStored(v);
    if (!st && !(stored > 0)) continue;
    if (st) v.expireStatus(st);
    setNote(v, SEA_NOTE, null);
    battle.trace.push({ t: "SEA_FROST_BURST", src: whale.id, dst: v.id, stored: GameMath.display(stored), skill: "海凝" });
    battle.queueEvent(EV.STATUS_EXPIRE, { battle, entity: v, status: SEA_ID, name: "海凝", reason: "CONSUMED" }, v.id, v.teamId);
    if (!(stored > 0) || !v.alive) continue;
    // The pool already holds damage: compensate the defense multiplier so it is not reduced twice.
    const def = Math.max(0, v.prop("def"));
    await battle.withinResolution({ id: "HIT:海凝#" + v.id, type: "HIT" }, async () => {
      await battle.damage(whale, v, stored, DamageType.INDIRECT, (300 + def) / 300, null);
    });
  }
}

// ───────────────────────── whales ─────────────────────────

export function whalesOf(battle: any, teamId: number, kind?: WhaleKind): Entity[] {
  return (battle.teams[teamId]?.summons ?? []).filter((s: Entity) => s.alive && (kind ? s.notes.includes(WHALE_NOTE + kind) : noteValue(s, WHALE_NOTE) !== null));
}
const isWhale = (e: Entity): boolean => isSummonUnit(e) && noteValue(e, WHALE_NOTE) !== null;
/** Summon ids are 900 + team×50 + n; keep clear of the other team's id range. */
const SUMMON_ID_ROOM = 48;

function whaleSkill(kind: WhaleKind): any {
  const name = WHALE[kind].name;
  const sk: any = {
    name, cost: 0, selectable: true, index: 0,
    ir: { id: "562_whale_" + kind.toLowerCase(), charId: 562, name, cost: 0, damage: [] },
    pickTarget: (_b: any, self: Entity, enemies: Entity[]) => enemies[0] ?? self,
    execute: async (battle: any, self: Entity, target: Entity) => {
      const owner = entityById(battle, Number(noteValue(self, WHALE_OWNER)));
      battle.trace.push({ t: "SKILL_CAST", actor: self.id, skill: name, cost: 0, target: target?.id ?? self.id, hits: 1 });
      if (!owner) return;
      if (kind === "DAY") {
        const foes: Entity[] = battle.teams[1 - self.teamId].members.filter((v: Entity) => v.alive);
        const lowest = [...foes].sort((a, b) => a.hp - b.hp || a.id - b.id).slice(0, SENHIME.dayWhaleTargets);
        for (const v of lowest) addSea(battle, owner, v, SENHIME.dayWhaleRatio * owner.prop("atk"), "WHALE_ACTION", name);
        await burstSea(battle, self, owner);
      } else {
        gainOrbs(battle, self, self.teamId, SENHIME.nightWhaleOrbs, name);
        const value = SENHIME.nightWhaleShield * owner.prop("atk");
        for (const m of battle.teams[self.teamId].aliveMembers() as Entity[]) {
          m.addShield({ value, sourceId: self.id, dispellable: true, tag: "5622" });
          battle.trace.push({ t: "SHIELD_APPLY", src: self.id, dst: m.id, value: GameMath.display(value), base: "ownerAtk", ratio: SENHIME.nightWhaleShield * 100, skill: name });
        }
      }
    },
  };
  return sk;
}

export function summonWhale(battle: any, owner: Entity, kind: WhaleKind, reason: string): Entity | null {
  const team = battle.teams[owner.teamId];
  const spec = WHALE[kind];
  if (whalesOf(battle, owner.teamId, kind).length >= SENHIME.whaleCap || team.summons.length >= SUMMON_ID_ROOM) {
    battle.trace.push({ t: "WHALE_CAP", owner: owner.id, name: spec.name, cap: SENHIME.whaleCap, reason });
    return null;
  }
  const turns = kind === "DAY" ? dayTurnsOf(owner) : nightTurnsOf(owner);
  // Action-bar summons do not use the field summon slot: lift the slot check for this one creation.
  const slots = team.summonSlots;
  team.summonSlots = Number.MAX_SAFE_INTEGER;
  let w: Entity | null = null;
  try {
    w = battle.addSummon(owner, {
      tipsId: spec.tipsId, name: spec.name, hp: null, inheritInitialStats: false, noAction: false,
      suppressSoul: false, suppressPassive: false, immuneTo: ["DAMAGE"], inherit: [{ prop: "atk", ratio: 1 }],
      spdBonus: 0, onDefeatRevive: null, victoryRule: null, oncePerTarget: false, maxEntries: null, evidence: spec.evidence,
    }, { skills: [whaleSkill(kind)] });
  } finally {
    team.summonSlots = slots;
  }
  if (!w) return null;
  w.caps.occupiesSummonSlot = false;
  w.caps.advancesOrbGauge = false;
  w.setTargetable(false, "在行动条上召唤");
  w.base.cri = 0;
  w.notes.push(WHALE_NOTE + kind, WHALE_OWNER + owner.id);
  setNote(w, WHALE_TURNS, turns);
  battle.trace.push({ t: "WHALE_SUMMON", owner: owner.id, summon: w.id, name: spec.name, turns, reason });
  return w;
}

/** Whale leaves after its last turn (not removeSummon: that splices team.summons and summon ids get reused). */
function whaleTurnDone(battle: any, w: Entity): void {
  const left = Number(noteValue(w, WHALE_TURNS) ?? 1) - 1;
  setNote(w, WHALE_TURNS, left);
  if (left > 0) return;
  w.alive = false;
  battle.timeline.remove(w.id);
  battle.bus.unregisterOwner(w.id);
  w.notes.push("summon:removed:EXPIRED");
  battle.trace.push({ t: "SUMMON_REMOVE", summon: w.id, name: w.name, tipsId: WHALE[(noteValue(w, WHALE_NOTE) ?? "DAY") as WhaleKind]?.tipsId ?? "", reason: "EXPIRED" });
}

// ───────────────────────── 汐流祝福 / 冰眠 ─────────────────────────

function enterIceSleep(battle: any, e: Entity, reason: string): void {
  if (!e.alive || e.hasStatus(SLEEP_ID)) return;
  const def = sleepDef();
  const a = e.addStatus(def, e.id, 1, PERSIST, [], null);
  battle.trace.push({ t: "ICE_SLEEP", id: e.id, status: SLEEP_ID, name: def.name, reason, tag: a.tag });
}

function convertControls(battle: any, e: Entity): void {
  if (!e.alive || !e.hasStatus(BLESS_ID)) return;
  const hits = e.statuses.filter(s => s.def.id !== SLEEP_ID && isControlDef(s.def) && (s.def.dispellable || s.def.removable));
  if (!hits.length) return;
  for (const st of hits) {
    if (!e.expireStatus(st)) continue;
    battle.trace.push({ t: "STATUS_REMOVE", id: e.id, status: st.def.id, name: st.def.name, by: "CONVERT", side: "ALLY", what: "CONTROL", src: e.id, skill: "汐流祝福" });
    battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: e, status: st.def.id, name: st.def.name, by: "CONVERT", side: "ALLY", what: "CONTROL", src: e.id, skill: "汐流祝福" }, e.id, e.teamId);
  }
  enterIceSleep(battle, e, "CONVERT:" + hits.map(s => s.def.name).join("/"));
}

// ───────────────────────── hooks ─────────────────────────

/** Gate for the AI (null = allowed). */
export function senhimeGate(sk: any): string | null {
  return sk?.ir?.id === "562_02" ? "NEVER_CAST (user-confirmed: 鲛人歌 is never cast by the AI)" : null;
}

/** End of an active cast of 鲸息洄梦: (re)open the illusion; a recast summons 极昼鲸. */
export function senhimeAfterCast(battle: any, self: Entity, x: any): void {
  if (x?.id !== "562_03") return;
  const recast = openIllusion(battle, self, "施放");
  if (recast) summonWhale(battle, self, "DAY", "RECAST");
}

async function onAfterDamage(battle: any, ctx: any): Promise<void> {
  const src: Entity | undefined = ctx?.input?.source;
  const dst: Entity | undefined = ctx?.input?.target;
  const final = Number(ctx?.result?.final ?? 0);
  if (!src || !dst || !(final > 0)) return;
  // 海凝 from ally damage while the illusion is up
  const ill = illusionOf(battle, src.teamId);
  if (ill && dst.teamId !== src.teamId && !isSummonUnit(dst) && !isWhale(src) && ctx.input.type !== DamageType.CONDUCTION) {
    const owner = entityById(battle, ill.ownerId);
    if (owner) addSea(battle, owner, dst, final * seaRatioOf(owner), "ALLY_DAMAGE", src.name);
  }
  // 冰眠 (L4 shield / L5 threshold) on a blessing bearer
  if (!dst.alive || !dst.hasStatus(BLESS_ID) || !isSenhime(dst)) return;
  if (dst.hasStatus(SLEEP_ID) && sleepShieldOn(dst)) {
    grantTimedShield(battle, dst, dst, final, SLEEP_SHIELD_TURNS, { tag: "5621", skill: "冰眠", reason: "DAMAGE_DURING_ICE_SLEEP", base: "damageTaken", ratio: 100 });
  }
  const below = sleepBelowOf(dst);
  const applied = Number(ctx?.result?.applied ?? 0);
  if (below !== null && dst.hp / dst.maxHp < below && (dst.hp + applied) / dst.maxHp >= below) {
    enterIceSleep(battle, dst, "HP_BELOW_" + GameMath.displayPercent(below));
  }
}

/** TURN_END of any actor (global handler). */
async function onTurnEnd(battle: any, actor: Entity): Promise<void> {
  if (isWhale(actor)) whaleTurnDone(battle, actor);
  tickIllusions(battle, actor);
  if (isSummonUnit(actor)) return;
  for (const st of fieldsOf(battle)) {
    if (st.name !== SENHIME.illusion || st.teamId === actor.teamId) continue;
    const owner = entityById(battle, st.ownerId);
    const pct = owner ? whalePullOf(owner) : 0;
    if (!(pct > 0)) continue;
    for (const w of whalesOf(battle, st.teamId)) shiftBar(battle, w, pct, SENHIME.illusion);
  }
}

function registerOwnHandlers(battle: any, e: Entity): void {
  const reg = (suffix: string, code: string, fn: (ctx: any) => Promise<void> | void) =>
    registerOwnerHandler(battle, "betting:562:" + suffix + ":" + e.id, e.id, code, fn);
  reg("start", EV.BATTLE_START, () => {
    if (!e.hasStatus(BLESS_ID)) {
      const def = blessDef();
      const a = e.addStatus(def, e.id, 1, PERSIST, [], null);
      battle.trace.push({ t: "STATUS_APPLY", src: e.id, dst: e.id, status: BLESS_ID, name: def.name, category: def.category, duration: PERSIST, ref: BLESS_ID, known: true, tag: a.tag, skill: "鲛人歌" });
    }
    if (opensAtStart(e) && !illusionOf(battle, e.teamId)) openIllusion(battle, e, "先机");
  });
  reg("convert", EV.STATUS_ADD, () => convertControls(battle, e));
  reg("wake", EV.TURN_START, (ctx: any) => {
    if (ctx?.actor?.id !== e.id) return;
    const st = e.statuses.find(s => s.def.id === SLEEP_ID);
    if (st && e.expireStatus(st)) battle.trace.push({ t: "STATUS_EXPIRE", id: e.id, status: SLEEP_ID, name: "冰眠", reason: "TURN_START" });
  });
  reg("death", EV.DEATH, (ctx: any) => {
    if (ctx?.target?.id === e.id) summonWhale(battle, e, "NIGHT", "DEATH");
  });
}

export function installSenhime(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  const owners = entities.filter(isSenhime);
  for (const e of owners) {
    registerOwnHandlers(battle, e);
    out.push({ entityId: e.id, mechanic: "永生之海幻境 / 汐流祝福" });
  }
  // Global handlers (owner 0): the illusion and the whales outlive Senhime.
  if (owners.length) {
    ensureShieldTicker(battle);
    ensureGlobalHandler(battle, "betting:562:damage", EV.AFTER_DAMAGE, (ctx: any) => onAfterDamage(battle, ctx));
    ensureGlobalHandler(battle, "betting:562:turnEnd", EV.TURN_END, (ctx: any) => ctx?.actor ? onTurnEnd(battle, ctx.actor) : undefined);
  }
  return out;
}
