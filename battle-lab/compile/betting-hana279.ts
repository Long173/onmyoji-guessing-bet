// compile/betting-hana279.ts — 花鸟卷 279 (Global "Hana"; NOT 绘世花鸟卷 367, see betting-hana.ts) at max skill level.
// MAX mode only (match 7).
//
// Sources: data/kb/shikigami.json 279_01..279_03, buff 2793_1 芬芳; data/kb/en-text.json (Global); fandom
// "Kachou Fuugetsu/Main".
//   归鸟 (279_01)      · every bird she has attacks the target once, 40% ATK per hit; each hit has an 80% (L4) chance
//                       to heal the lowest-HP-ratio ally for 10% of max HP — HANA's max HP (fandom: "by 10% of her max
//                       HP"; the CN / Global text names no owner; the engine's generic heals use the caster's too).
//                       Birds: at the start of her own turn +1, cap 3 (L5); whenever she has none, 1 is replenished at
//                       once ⇒ she starts the battle with 1 and never has 0. Not modelled: "a counterattack consumes 1
//                       bird" — she has no counter source in the current lineups, and a counter cannot be told apart
//                       from an assist (万年竹's 邀战 basic attack) at the cast.
//   画境 (279_02)      · passive: at the end of each of her actions, 30% (L4) chance of +30% (L5) action bar. 唯一: when
//                       she or an ally receives a control effect from an enemy, 30% chance to consume 1 bird and block
//                       it (resolved right after the control lands, as 593's control immunity).
//   花鸟相闻 (279_03, 3) · heals all allies 12% (L4) of HANA's max HP (fandom "by 8% of her max HP") and gives 芬芳 for
//                       2 turns: before each of the bearer's next 2 turns it heals 11% then 10% (L5) of Hana's max HP.
//                       The generic path healed 12% + 11% at once and 芬芳 did nothing.
//   AI (KB)           · any living ally below 70% HP → 花鸟相闻 (when affordable), otherwise 归鸟. The second KB row
//                       did not compile (AI confidence LOW), so the engine only ever basic-attacked.
// Heals do not crit (engine convention for skill heals; the text says nothing about crits).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import type { BettingKit } from "./betting-m7.ts";
import {
  bettingActive, PERSIST, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureGlobalHandler,
  shiftBar, isControlDef,
} from "./betting-shared.ts";

export const HANA279 = Object.freeze({
  hitRatio: 40, healChance: 0.8, healPct: 0.1, birdCap: 3, startBirds: 1,
  barChance: 0.3, barPct: 0.3, blockChance: 0.3, castBelow: 0.7, ultHeal: 0.12, fragrance: [0.11, 0.1],
});
export const FRAGRANCE_ID = "2793_1";
const N_BIRDS = "hana279:birds=";
const N_TICK = "hana279:fragrance=";

const fragranceDef = () => markDef({ id: FRAGRANCE_ID, name: "芬芳", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  desc: "【增益、印记】行动前治疗（花鸟卷生命上限11%、10%，共2回合）。" }, StatusBook);

export const isHana279 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "279_02") && !!skillById(e, "279_03");
export const birdsOf = (e: Entity): number => Number(noteValue(e, N_BIRDS) ?? HANA279.startBirds);
const hpRatio = (e: Entity): number => (e.maxHp > 0 ? e.hp / e.maxHp : 0);
const team = (battle: any, e: Entity): Entity[] => (battle.teams[e.teamId].members as Entity[]).filter(m => m.alive);
const hanaOfTeam = (battle: any, teamId: number): Entity | null =>
  (battle.teams[teamId]?.members ?? []).find((m: Entity) => isHana279(m)) ?? null;

function setBirds(battle: any, h: Entity, n: number, reason: string): void {
  const before = birdsOf(h);
  let next = Math.max(0, Math.min(HANA279.birdCap, n));
  if (next === 0) next = 1;   // "没有飞鸟时，补充1只飞鸟"
  setNote(h, N_BIRDS, next);
  if (next !== before) battle.trace.push({ t: "BIRDS", id: h.id, from: before, to: next, reason, skill: "归鸟" });
}

type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };

function birdsHook(x: any): Hook | null {
  if (x?.id !== "279_01") return null;
  return {
    kind: "HANA279_BIRDS",
    run: async (battle, h, hurt, primary) => {
      const target = primary?.alive && primary.teamId !== h.teamId ? primary : battle.enemiesOf(h.teamId).find((v: Entity) => v.alive);
      if (!target) return;
      const n = birdsOf(h);
      for (let i = 0; i < n && target.alive; i++) {
        if (!hurt.includes(target)) hurt.push(target);
        await battle.withinResolution({ id: "HIT:" + x.name + "#" + (i + 1), type: "HIT" }, async () => {
          await battle.damage(h, target, h.prop("atk") * (HANA279.hitRatio / 100), DamageType.NORMAL, 1, x.lifesteal ?? null);
        });
        battle.rng.expect("hana279_bird_heal#" + (i + 1));
        if (!battle.rng.testHit(HANA279.healChance)) continue;
        const pool = team(battle, h).filter(m => !isSummonUnit(m));
        const low = pool.reduce<Entity | null>((a, b) => (!a || hpRatio(b) < hpRatio(a) ? b : a), null);
        if (low) await battle.heal(h, low, h.maxHp * HANA279.healPct, { crit: false });
      }
    },
  };
}

async function fragrantFlowers(battle: any, h: Entity): Promise<void> {
  const def = fragranceDef();
  for (const m of team(battle, h)) {
    await battle.heal(h, m, h.maxHp * HANA279.ultHeal, { crit: false });
    if (!m.alive) continue;
    for (const st of [...m.statuses]) if (st.def.id === FRAGRANCE_ID) m.expireStatus(st);
    const a = m.addStatus(def, h.id, 1, PERSIST, [], 1);
    setNote(m, N_TICK, 0);
    battle.trace.push({ t: "STATUS_APPLY", src: h.id, dst: m.id, status: FRAGRANCE_ID, name: def.name, category: def.category, duration: 2, ref: FRAGRANCE_ID, known: true, tag: (a as any)?.tag ?? null, skill: "花鸟相闻" });
  }
}

async function fragranceTick(battle: any, ctx: any): Promise<void> {
  const a: Entity | undefined = ctx?.actor;
  if (!a?.alive || (ctx.type !== "NORMAL" && ctx.type !== "NEW_TURN")) return;
  const st = a.statuses.find(s => s.def.id === FRAGRANCE_ID);
  if (!st) return;
  const i = Number(noteValue(a, N_TICK) ?? 0);
  const src = (battle.allEntities() as Entity[]).find(x => x.id === st.sourceId) ?? a;
  const pct = HANA279.fragrance[Math.min(i, HANA279.fragrance.length - 1)];
  await battle.heal(src, a, src.maxHp * pct, { crit: false });
  if (i + 1 >= HANA279.fragrance.length) { a.expireStatus(st); setNote(a, N_TICK, null); }
  else setNote(a, N_TICK, i + 1);
}

async function blockControl(battle: any, h: Entity, ctx: any): Promise<void> {
  const e: Entity | undefined = ctx?.entity;
  if (!e || e.teamId !== h.teamId || !e.alive || ctx.merged || !h.alive) return;
  const def = StatusBook.get(String(ctx.status ?? ""));
  if (!def || !isControlDef(def)) return;
  const st = [...e.statuses].reverse().find(s => s.def.id === def.id);
  if (!st) return;
  const src = (battle.allEntities() as Entity[]).find(x => x.id === st.sourceId);
  if (!src || src.teamId === h.teamId) return;
  battle.rng.expect("hana279_block:" + e.id + ":" + def.id);
  if (!battle.rng.testHit(HANA279.blockChance)) return;
  if (!e.expireStatus(st)) return;
  battle.trace.push({ t: "IMMUNE", src: st.sourceId, dst: e.id, status: def.id, name: def.name, by: "279_02", kind: "CONTROL", consumed: true, skill: "画境", probability: HANA279.blockChance });
  setBirds(battle, h, birdsOf(h) - 1, "BLOCK_CONTROL");
}

export const KIT: BettingKit = {
  patches: {
    "279_02": { note: "画境: the action-end bar and the bird control block are run by betting-hana279.ts", patch: { timeline: [] } },
    "279_03": { note: "花鸟相闻: the 12% heal and 芬芳's 11% / 10% ticks are run by betting-hana279.ts", patch: { statusRefConditionOnly: [0], heal: [] } },
  },
  damageHook: (x) => (bettingActive() ? birdsHook(x) : null),
  ruleSkill: (battle, self, costOf) => {
    if (!bettingActive() || !isHana279(self)) return null;
    const ult = skillById(self, "279_03"), basic = skillById(self, "279_01");
    const low = team(battle, self).some(m => !isSummonUnit(m) && hpRatio(m) < HANA279.castBelow);
    const c = costOf(ult);
    if (low && ult && (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c))) return { skill: ult, rule: "花鸟卷: 存在友方生命比例低于70% → 花鸟相闻 (KB AI)" };
    return basic ? { skill: basic, rule: low ? "花鸟卷: 鬼火不足 → 归鸟" : "花鸟卷: 友方生命比例均不低于70% → 归鸟 (KB AI)" } : null;
  },
  afterCast: async (battle, self, x) => {
    if (!bettingActive() || x?.id !== "279_03" || !isHana279(self)) return false;
    await fragrantFlowers(battle, self);
    return true;
  },
  install: (battle, entities) => {
    if (!bettingActive()) return [];
    const out: Array<{ entityId: number; mechanic: string }> = [];
    let fragrance = false;
    for (const h of entities.filter(isHana279)) {
      fragrance = true;
      const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "SELF") =>
        registerOwnerHandler(battle, "betting:279:" + code + ":" + h.id, h.id, code, fn, range);
      // Birds are part of the normal attack (active skill): not sealed by passive suppression.
      registerOwnerHandler(battle, "betting:279:birds:" + h.id, h.id, EV.TURN_START, (ctx: any) => {
        if (ctx?.actor?.id !== h.id || (ctx.type !== "NORMAL" && ctx.type !== "NEW_TURN")) return;
        setBirds(battle, h, birdsOf(h) + 1, "TURN_START");
      }, "SELF", { passive: false });
      reg(EV.ACTION_END, (ctx: any) => {
        if (ctx?.actor?.id !== h.id || !h.alive || isActionPrevented(h.statusDefs())) return;
        battle.rng.expect("hana279_bar");
        if (battle.rng.testHit(HANA279.barChance)) shiftBar(battle, h, HANA279.barPct, "画境");
      });
      if (hanaOfTeam(battle, h.teamId) === h) reg(EV.STATUS_ADD, (ctx: any) => blockControl(battle, h, ctx), "ALL");   // 唯一效果
      out.push({ entityId: h.id, mechanic: "归鸟 birds (1-3 hits, 80% heal per hit) · 画境 bar / bird control block · 花鸟相闻 heal + 芬芳 ticks" });
    }
    // 芬芳 heals its bearers even after Hana falls.
    if (fragrance) ensureGlobalHandler(battle, "betting:279:fragrance", EV.TURN_START, (ctx: any) => fragranceTick(battle, ctx));
    return out;
  },
};
