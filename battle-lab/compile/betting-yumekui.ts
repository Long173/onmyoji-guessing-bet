// compile/betting-yumekui.ts — 食梦貘 (SR 257, Global "Yumekui") at max skill level. MAX mode only (match 13).
//
// Sources: data/kb/shikigami.json 257_01..257_03, tips_102 沉睡 ("无法动作，受到伤害时自动移除此效果"), data/kb/ai.json
// row 257; data/kb/en-text.json (Global, same meaning). Before this module the compiled 食梦者 applied nothing (controlSkips
// NO_APPLY_VERB), 入眠's 1-turn sleep expired at the end of his own turn (stock sleep = SOURCE_TURN), nothing woke a sleeper
// on damage and 沉睡 (passive) never ran.
//   入眠 (257_01) · 100% ATK (L5); 20% dispel all buffs (compiled purge, unchanged); 20% base chance Sleep 1 turn.
//   沉睡 (257_02, passive) · his damage does not remove Sleep; whenever ANY unit gets Sleep, the non-summon ally with the
//        lowest HP ratio is healed 5% of max HP.
//   食梦者 (257_03, 3) · every enemy: 50% (L5) base chance Sleep for 1–2 turns.
//   沉睡 rule (tips_102) · a sleeping unit that takes damage wakes up (Sleep removed). Installed as a battle rule while a
//        食梦貘 is on the field (the engine had no wake rule at all; it is the only Sleep source of match 13).
//   AI · KB row: 敌方单位拥有的减疗buff<2 → 3技能; ≥2 → 普攻. That condition (heal-reduction debuffs, plus a target rule about
//        森之力) belongs to no mechanic of 食梦貘 — the row looks mis-transcribed — and read literally it means 食梦者 whenever
//        affordable, which gives Red 9.7% on the match-13 lineup, while the real match-13 result was a Red win.
//        Chosen reading (fits the result): the comparison inverted — 食梦者 only when ≥2 enemies carry a heal-reduction
//        debuff (and it is affordable), else 入眠. In match 13 that is 入眠 every turn (Red ≈62%), which is also what the
//        generic LOW-confidence fallback did before this module. Literal reading kept as YUMEKUI_AI_LITERAL (tests / what-if).
// Readings (unverified — noted in the report):
//   · "1 turn" / "1–2 turns" are the bearer's own turns (TARGET_TURN, betting-fengyang.ts bearerTurnControl): the sleeper
//     loses its next 1 (or 2) turns unless woken. 1 or 2 is a fair coin per target.
//   · "5% of max HP" = 5% of Yumekui's own max HP (the alternative, the healed ally's max HP, is smaller — he has the
//     largest HP of Red). One heal per Sleep application (re-applications count).
//   · Wake-up: any damage with a final amount > 0 (shield-absorbed included), except Yumekui's own damage while his
//     passive is not sealed.
//   · "减疗buff" = a status on an enemy whose name / description mentions 减疗 or reduced healing (nobody in match 13 has one).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV } from "../kernel/types.ts";
import type { BettingKit, Hook, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, ensureGlobalHandler, registerOwnerHandler, applyContested, passiveSuppressed } from "./betting-shared.ts";
import { bearerTurnControl } from "./betting-fengyang.ts";

export const YUMEKUI = Object.freeze({ basicRatio: 100, basicSleep: 0.2, ultSleep: 0.5, healRatio: 0.05 });
export const SLEEP_ID = "sleep";

export const isYumekui = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "257_02") && !!skillById(e, "257_03");
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);
const HEAL_CUT_RE = /减疗|治疗效果(降低|下降|减少)|受到的治疗(降低|下降|减少)/;
const hasHealCut = (v: Entity): boolean => v.statuses.some(s => String(s.def.category).startsWith("DEBUFF") && HEAL_CUT_RE.test(String(s.def.name ?? "") + String(s.def.desc ?? "")));

/** Sleep for `turns` of the bearer's own turns (contested like every enemy control). */
export async function applySleep(battle: any, src: Entity, v: Entity, p: number, turns: number, skill: string): Promise<boolean> {
  return applyContested(battle, src, v, bearerTurnControl(SLEEP_ID), p, turns, [], { skill, ref: "CONTROL:" + SLEEP_ID });
}

/** 沉睡 passive: heal the lowest-HP-ratio non-summon ally for 5% of Yumekui's max HP. */
export async function sleepHeal(battle: any, y: Entity): Promise<Entity | null> {
  if (!y.alive) return null;
  const pool = (battle.teams[y.teamId].aliveMembers() as Entity[]).filter(a => !isSummonUnit(a) && a.maxHp > 0);
  if (!pool.length) return null;
  const t = pool.reduce((m, a) => (a.hp / a.maxHp < m.hp / m.maxHp ? a : m), pool[0]);
  battle.trace.push({ t: "PASSIVE_PROC", actor: y.id, skill: "沉睡", effect: "治疗生命比例最低的友方", target: t.id });
  await battle.heal(y, t, y.maxHp * YUMEKUI.healRatio, { crit: false });
  return t;
}

/** 入眠: the hit, then the 20% Sleep (1 turn of the target). The 20% dispel stays the compiled purge. */
function lullHook(x: any): Hook | null {
  if (x?.id !== "257_01") return null;
  return {
    kind: "LULL_TO_SLEEP",
    run: async (battle, y, hurt, primary) => {
      const t = primary?.alive && primary.teamId !== y.teamId ? primary : aliveEnemies(battle, y)[0];
      if (!t) return;
      hurt.push(t);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        await battle.damage(y, t, y.prop("atk") * YUMEKUI.basicRatio / 100, DamageType.NORMAL, 1, x.lifesteal ?? null);
      });
      if (t.alive && isYumekui(y)) await applySleep(battle, y, t, YUMEKUI.basicSleep, 1, x.name);
    },
  };
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "257_03" || !isYumekui(self)) return false;
  for (const v of aliveEnemies(battle, self)) {
    battle.rng.expect("yumekui_sleep_turns:" + v.id);
    const turns = battle.rng.testHit(0.5) ? 2 : 1;
    await applySleep(battle, self, v, YUMEKUI.ultSleep, turns, x.name);
  }
  return true;
}

/** true = the literal KB comparison (食梦者 while fewer than 2 enemies carry heal reduction); false = the chosen, inverted one. */
export const YUMEKUI_AI_LITERAL = { value: false };

function ruleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive() || !isYumekui(self)) return null;
  const ult = skillById(self, "257_03"), basic = skillById(self, "257_01");
  const cut = aliveEnemies(battle, self).filter(hasHealCut).length;
  const wantUlt = YUMEKUI_AI_LITERAL.value ? cut < 2 : cut >= 2;
  const why = YUMEKUI_AI_LITERAL.value ? "敌方减疗buff<2 (KB, literal)" : "敌方减疗buff≥2 (KB comparison inverted)";
  if (ult && wantUlt) {
    const c = costOf(ult);
    if (!(c > 0) || battle.teams[self.teamId].orbs.canPay(c)) return { skill: ult, rule: "食梦貘: " + why + " → 食梦者" };
    return basic ? { skill: basic, rule: "食梦貘: 鬼火不足 → 入眠" } : null;
  }
  return basic ? { skill: basic, rule: "食梦貘: 否则 → 入眠 (" + (YUMEKUI_AI_LITERAL.value ? "KB, literal" : "KB comparison inverted") + ")" } : null;
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  const units = entities.filter(isYumekui);
  if (!units.length) return out;
  // tips_102: a sleeper that takes damage wakes up — except from a Yumekui whose 沉睡 is not sealed.
  ensureGlobalHandler(battle, "betting:257:wake", EV.AFTER_DAMAGE, (ctx: any) => {
    const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
    if (!dst?.alive || !(Number(ctx?.result?.final ?? 0) > 0)) return;
    const st = dst.statuses.find(s => s.def.id === SLEEP_ID);
    if (!st) return;
    if (src && isYumekui(src) && !passiveSuppressed(src)) return;
    if (!dst.expireStatus(st)) return;
    battle.trace.push({ t: "STATUS_REMOVE", id: dst.id, status: SLEEP_ID, name: st.def.name, by: "WAKE", side: "ENEMY", what: "CONTROL", src: src?.id ?? null, skill: "沉睡" });
    battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: dst, status: SLEEP_ID, name: st.def.name, by: "WAKE", src: src?.id ?? null, skill: "沉睡" }, dst.id, dst.teamId);
  });
  for (const y of units) {
    registerOwnerHandler(battle, "betting:257:sleep-heal:" + y.id, y.id, EV.STATUS_ADD, async (ctx: any) => {
      if (String(ctx?.status ?? "") !== SLEEP_ID || !y.alive) return;
      await sleepHeal(battle, y);
    }, "ALL");
    out.push({ entityId: y.id, mechanic: "沉睡 (no wake from his damage, 5% max-HP heal per Sleep) · 入眠 20% Sleep (bearer turn) · 食梦者 50% Sleep 1–2 turns · wake-on-damage rule · KB AI" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "257_01": { note: "入眠: the 20% Sleep (1 turn of the bearer) is applied by betting-yumekui.ts", patch: { controlRefs: [] } },
  }),
  damageHook: (x: any) => (bettingActive() ? lullHook(x) : null),
  afterCast,
  ruleSkill,
  install,
};
