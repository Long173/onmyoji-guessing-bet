// compile/betting-yuki.ts — 雪御前 591 (Global "Yuki Gozen") at max skill level. MAX mode only (match 7).
//
// Sources: data/kb/shikigami.json 591_01..591_03, buff 5913_1 巫灵雪刃, tips_5911 龙胆蓝璃; fandom "Yuki Gozen/Main".
//   龙胆·绽 (591_02, cost 0) · every single-target attack (雪立·裁 / 千雪·斩 casts) gives 1 巫灵雪刃 after it lands
//       (cap 3). Killing a non-summon enemy summons 龙胆蓝璃 at the victim's action-bar position. While the Glass is
//       on the field Yuki is immune to damage (evolved effect; max level = awakened). [Cast] summons the Glass;
//       L5: summons it at battle start.
//       龙胆蓝璃 · HP 360% (L4) of Yuki's initial ATK (= her battle-start panel ATK, `base.atk`, souls included —
//       the same anchor the kernel uses for 雷冢's 「须佐之男初始攻击150%」), inherits her crit, crit damage, DEF
//       and 95% of her SPD; immune to debuffs and control. Re-summoned while alive: max HP +39% of initial ATK
//       (at most 3 times) and full heal. On its turn it deals 50% of its CURRENT max HP to the enemy with the lowest
//       (absolute) HP (normal damage; crit from the inherited stats). It does not count for victory.
//       Targetability: the kernel's enemiesOf() lists team members only (summons are never hit). The Glass is a
//       field summon that enemies attack in game (it has HP and a "restore all HP" rule), and without it Yuki would
//       be untouchable forever — so this module appends living Glasses to enemiesOf() of the opposing team
//       (per-battle wrapper, installed only when a Yuki is present).
//   千雪·斩 (591_03, 3 onibi) · 9 slashes × 27% ATK on the designated enemy. If she holds ≥ 2 巫灵雪刃, 2 are consumed
//       and the first slash becomes a 雪爆: 108% ATK to all enemies (L3), the designated enemy takes +50% (L4).
//       L5: once the target dies, the remaining slashes go to the enemy with the lowest HP (chains).
//   AI (KB) · "自身拥有剑的无敌buff时 → 3技能, 否则 → 2技能": Glass alive ⇒ 千雪·斩 when affordable, else 雪立·裁 (a
//       stack; recasting 龙胆·绽 would only refresh the Glass); no Glass ⇒ 龙胆·绽.
//   Betting HP scale (compile/betting-policies.ts, HYPOTHESIS "every unit's real max HP = Lineup HP × 2.42"): the
//       Glass is a unit on the field, so its max HP (and the +39% re-summon gains) get the same multiplier
//       (YUKI.glassHpScaled). Its strike is 50% of its max HP, so the scale also scales the strike — unverified.
// Doubts: stack timing (gained after the attack, consumed at cast start); the Glass occupying no summon slot;
// whether the betting HP scale reaches a mid-battle summon.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import type { BettingKit, Hook, Installed } from "./betting-m7.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler,
  setStackedStatus, stacksOn,
} from "./betting-shared.ts";
import { bettingHpScale } from "./betting-policies.ts";

export const YUKI = Object.freeze({
  glassHpAtk: 3.6, restackAtk: 0.39, restackCap: 3, glassSpd: 0.95, glassHit: 0.5,
  edgeCap: 3, edgeCost: 2, slashes: 9, slashRatio: 27, burstRatio: 108, burstTargetBonus: 0.5,
  glassHpScaled: true,
});
const hpScale = (): number => (YUKI.glassHpScaled ? bettingHpScale() : 1);
export const EDGE_ID = "5913_1";
export const GUARD_ID = "591_glass_guard";
const GLASS_TIPS = "5911";
const N_OWNER = "yuki591:glass-owner=", N_STACKS = "yuki591:glass-restack=";

const edgeDef = () => markDef({ id: EDGE_ID, name: "巫灵雪刃", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】最多可叠加3层。施放「千雪·斩」时，消耗2层，将下次刀光进化成雪爆，对敌方全体造成攻击108%伤害。" }, StatusBook);
const guardDef = () => markDef({ id: GUARD_ID, name: "龙胆蓝璃·免伤", category: StatusCategory.BUFF_STATE, durationPolicy: "GLOBAL",
  immuneTo: ["DAMAGE"], desc: "龙胆蓝璃在场时，雪御前免疫受到的伤害（觉醒效果）。" }, StatusBook);

export const isYuki = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "591_02") && !!skillById(e, "591_03");
export const edgeStacks = (e: Entity): number => stacksOn(e, EDGE_ID);
const isGlass = (e: Entity): boolean => noteValue(e, N_OWNER) !== null;
export function glassOf(battle: any, owner: Entity): Entity | null {
  return (battle.teams[owner.teamId]?.summons ?? []).find((s: Entity) => s.alive && noteValue(s, N_OWNER) === String(owner.id)) ?? null;
}
const aliveFoes = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const lowestHp = (l: Entity[]): Entity | null => l.reduce<Entity | null>((a, b) => (!a || b.hp < a.hp ? b : a), null);

function setEdge(battle: any, y: Entity, n: number, reason: string, skill: string): void {
  const before = edgeStacks(y);
  const after = setStackedStatus(y, edgeDef(), n, YUKI.edgeCap, y.id, []);
  if (after > before) battle.trace.push({ t: "STATUS_APPLY", src: y.id, dst: y.id, status: EDGE_ID, name: "巫灵雪刃", category: StatusCategory.COMMON_MARK, duration: PERSIST, ref: EDGE_ID, known: true, stacks: after, reason, skill });
  else if (after < before) battle.trace.push({ t: "STACKS_CONSUMED", id: y.id, status: EDGE_ID, name: "巫灵雪刃", from: before, to: after, reason, skill });
}

// ───────────────────────── 龙胆蓝璃 ─────────────────────────

function glassSkill(): any {
  const name = "璃刃";
  return {
    name, cost: 0, selectable: true, index: 0,
    ir: { id: "591_glass", charId: 591, name, cost: 0, damage: [] },
    pickTarget: (_battle: any, self: Entity, enemies: Entity[]) => lowestHp(enemies.filter(v => v.alive)) ?? enemies[0] ?? self,
    execute: async (battle: any, self: Entity) => {
      const v = lowestHp(aliveFoes(battle, self));
      battle.trace.push({ t: "SKILL_CAST", actor: self.id, skill: name, cost: 0, target: v?.id ?? self.id, hits: 1 });
      if (!v) return;
      await battle.withinResolution({ id: "HIT:" + name + "#1", type: "HIT" }, async () => {
        await battle.damage(self, v, self.maxHp * YUKI.glassHit, DamageType.NORMAL, 1, null);
      });
    },
  };
}

export function summonGlass(battle: any, y: Entity, pos: number, reason: string): Entity | null {
  if (!y.alive) return null;
  const initAtk = Number(y.base.atk ?? 0);
  const existing = glassOf(battle, y);
  if (existing) {
    const n = Number(noteValue(existing, N_STACKS) ?? 0);
    const before = existing.maxHp;
    if (n < YUKI.restackCap) {
      existing.maxHp += GameMath.roundAt(initAtk * YUKI.restackAtk * hpScale(), "SUMMON_STAT_GAIN");
      setNote(existing, N_STACKS, n + 1);
    }
    existing.hp = existing.maxHp;
    battle.trace.push({ t: "PLACE_STACK", killer: y.id, summon: existing.id, name: existing.name, stacks: Math.min(n + 1, YUKI.restackCap),
      maxHpBefore: GameMath.display(before), maxHp: GameMath.display(existing.maxHp), reason, capped: n >= YUKI.restackCap });
    return existing;
  }
  const team = battle.teams[y.teamId];
  const slots = team.summonSlots;
  team.summonSlots = Number.MAX_SAFE_INTEGER;   // action-bar summon: the field summon slot is not checked
  let g: Entity | null = null;
  try {
    g = battle.addSummon(y, {
      tipsId: GLASS_TIPS, name: "龙胆蓝璃", hp: { prop: "atk", ratio: YUKI.glassHpAtk * hpScale() }, inheritInitialStats: false, noAction: false,
      suppressSoul: false, suppressPassive: false, immuneTo: ["DEBUFF", "CONTROL"], inherit: [{ prop: "def", ratio: 1 }],
      spdBonus: -(1 - YUKI.glassSpd) * Number(y.base.spd ?? 0), onDefeatRevive: null, victoryRule: null, oncePerTarget: false, maxEntries: null,
      evidence: "tips_5911：生命为雪御前初始攻击的360%，继承暴击、暴击伤害、防御和95%速度；免疫负面状态和控制效果",
    }, { skills: [glassSkill()], pos });
  } finally {
    team.summonSlots = slots;
  }
  if (!g) return null;
  g.caps.occupiesSummonSlot = false;
  g.caps.advancesOrbGauge = false;
  g.base.cri = Number(y.base.cri ?? 0);
  g.base.crid = Number(y.base.crid ?? 1.5);
  g.notes.push(N_OWNER + y.id);
  for (const st of [...y.statuses]) if (st.def.id === GUARD_ID) y.expireStatus(st);
  y.addStatus(guardDef(), g.id, 1, PERSIST, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: g.id, dst: y.id, status: GUARD_ID, name: "龙胆蓝璃·免伤", category: StatusCategory.BUFF_STATE, duration: PERSIST, ref: GUARD_ID, known: true, skill: "龙胆·绽" });
  battle.trace.push({ t: "GLASS_SUMMON", owner: y.id, summon: g.id, hp: GameMath.display(g.maxHp), spd: GameMath.display(g.speed), pos, reason });
  return g;
}

function dropGuard(battle: any, y: Entity, reason: string): void {
  for (const st of [...y.statuses]) {
    if (st.def.id !== GUARD_ID || !y.expireStatus(st)) continue;
    battle.trace.push({ t: "STATUS_REMOVE", id: y.id, status: GUARD_ID, name: st.def.name, by: "EXPIRE", side: "ALLY", what: "BUFF", src: y.id, skill: "龙胆·绽", reason });
  }
}

/** Living Glasses become valid enemy targets (kernel enemiesOf lists members only). One wrapper per battle. */
const exposed = new WeakSet<object>();
function exposeGlasses(battle: any): void {
  if (exposed.has(battle)) return;
  exposed.add(battle);
  const orig = battle.enemiesOf.bind(battle);
  battle.enemiesOf = (teamId: number): Entity[] => {
    const base: Entity[] = orig(teamId);
    const glasses = (battle.teams[1 - teamId]?.summons ?? []).filter((s: Entity) => s.alive && isGlass(s) && s.caps.canBeTargeted);
    return glasses.length ? [...base, ...glasses] : base;
  };
}

// ───────────────────────── 千雪·斩 ─────────────────────────

function snowSlash(x: any): Hook | null {
  if (x?.id !== "591_03") return null;
  return {
    kind: "SNOW_SLASH",
    run: async (battle, y, hurt, primary) => {
      let target: Entity | null = primary?.alive && primary.teamId !== y.teamId ? primary : lowestHp(aliveFoes(battle, y));
      const designated = target;
      const ratio = Number(x.damage?.[0]?.ratioMax ?? YUKI.slashRatio);
      let burst = false;
      if (edgeStacks(y) >= YUKI.edgeCost) { setEdge(battle, y, edgeStacks(y) - YUKI.edgeCost, "SNOW_BURST", x.name); burst = true; }
      for (let h = 1; h <= YUKI.slashes; h++) {
        if (!target?.alive) target = lowestHp(aliveFoes(battle, y));   // L5: continue on the lowest-HP enemy
        if (!target || !y.alive) return;
        const t = target;
        await battle.withinResolution({ id: "HIT:" + x.name + "#" + h, type: "HIT" }, async () => {
          if (h === 1 && burst) {
            battle.trace.push({ t: "SNOW_BURST", src: y.id, designated: designated?.id ?? null, ratio: YUKI.burstRatio, skill: x.name });
            for (const v of aliveFoes(battle, y)) {
              if (!hurt.includes(v)) hurt.push(v);
              const mul = designated && v.id === designated.id ? 1 + YUKI.burstTargetBonus : 1;
              await battle.damage(y, v, y.prop("atk") * (YUKI.burstRatio / 100), DamageType.NORMAL, mul, null);
            }
            return;
          }
          if (!hurt.includes(t)) hurt.push(t);
          await battle.damage(y, t, y.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, null);
        });
      }
    },
  };
}

// ───────────────────────── AI ─────────────────────────

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isYuki(self)) return null;
  if (!glassOf(battle, self)) return { skill: skillById(self, "591_02"), rule: "雪御前: 龙胆蓝璃不在场 → 龙胆·绽 (KB AI)" };
  const slash = skillById(self, "591_03");
  if (slash && battle.teams[self.teamId].orbs.canPay(costOf(slash))) return { skill: slash, rule: "雪御前: 龙胆蓝璃在场（免伤） → 千雪·斩 (KB AI)" };
  return { skill: skillById(self, "591_01"), rule: "雪御前: 龙胆蓝璃在场、鬼火不足 → 雪立·裁" };
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || !isYuki(self)) return false;
  if (x?.id === "591_02") { summonGlass(battle, self, 0, "CAST"); return true; }
  if (x?.id === "591_01" || x?.id === "591_03") { setEdge(battle, self, edgeStacks(self) + 1, "SINGLE_TARGET_ATTACK", x.name); return true; }
  return false;
}

// ───────────────────────── installation ─────────────────────────

/** Victim action-bar position seen at Yuki's last hit on it (transient; read by the on-kill summon). */
const lastPos = new WeakMap<object, Map<number, number>>();

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const y of entities.filter(isYuki)) {
    exposeGlasses(battle);
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:591:" + code + ":" + y.id, y.id, code, fn, range);
    reg(EV.BATTLE_START, () => { if (!glassOf(battle, y)) summonGlass(battle, y, 0, "L5_BATTLE_START"); }, "SELF");
    reg(EV.BEFORE_DAMAGE, (ctx: any) => {
      const v: Entity | undefined = ctx?.input?.target;
      if (ctx?.input?.source?.id !== y.id || !v || v.teamId === y.teamId) return;
      const m = lastPos.get(battle) ?? new Map<number, number>();
      m.set(v.id, battle.timeline.get(v.id)?.pos ?? 0);
      lastPos.set(battle, m);
    });
    // The Glass leaving ends the immunity even while Yuki's passive is sealed (not a passive rule).
    registerOwnerHandler(battle, "betting:591:GLASS_DEATH:" + y.id, y.id, EV.DEATH, (ctx: any) => {
      const v: Entity | undefined = ctx?.target;
      if (v && isGlass(v) && noteValue(v, N_OWNER) === String(y.id)) dropGuard(battle, y, "GLASS_DEFEATED");
    }, "ALL", { passive: false });
    reg(EV.DEATH, (ctx: any) => {
      const v: Entity | undefined = ctx?.target;
      if (!v || isGlass(v)) return;
      if (v.teamId === y.teamId || isSummonUnit(v) || ctx.killerId !== y.id || !y.alive) return;
      summonGlass(battle, y, lastPos.get(battle)?.get(v.id) ?? 0, "KILL");
    });
    out.push({ entityId: y.id, mechanic: "龙胆·绽 (Glass summon on cast / kill / battle start, damage immunity, 巫灵雪刃) · 千雪·斩 (9 slashes, 雪爆, L5 retarget)" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "591_02": { note: "龙胆·绽: no damage on cast (the 50% line belongs to the Glass) and 巫灵雪刃 is gained on attacks; summon / immunity run by betting-yuki.ts (the kernel ON_KILL placement — 240% HP, no Glass action — is dropped so it cannot add a second Glass)",
      patch: { damage: [], statusRefConditionOnly: [0], forms: [] } },
  }),
  damageHook: snowSlash,
  ruleSkill,
  afterCast,
  install,
};
