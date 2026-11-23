// compile/betting-kuro.ts — 黑童子 (SR 277, Global "Kuro") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 277_02 / 277_03, buff 2772_1 回魂, tips_12 传导伤害; fandom "Kuro Douji/Main".
//   魂之怒火 (277_02, passive part) · when hit by an enemy attack that is not transferred (传导) damage: 20% (L3)
//       + 3% per 30% of HP ratio lost (L4) to cast 连斩 for free. Read as: one roll per enemy attack action ("受到…
//       的攻击时" = per attack; a per-hit roll made multi-hit AoEs trigger it almost every time: match 23b went from
//       Red 7% to 78% with it, 55% with the per-action roll), not while unable to act, and a
//       2-turn cooldown after a trigger (fandom skill box: "Cooldown = 2" on Soul Rage; the KB text has none —
//       read as the trigger's cooldown, counted on his own turn ends).
//       [Cast] / L5 先机: 回魂 for 2 turns — lethal damage leaves him at 1 HP with a shield of 135% ATK (2 turns),
//       consumed. The AI never casts the active part (KB: "3技能" only), so 回魂 comes from the 先机 only.
//   连斩 (277_03, 3 onibi) · 99% to all enemies, +1 attack per 30% of HP ratio lost; evolved: if it defeats an
//       enemy, a free 连斩 follows with 40% less damage (each follow-up can chain; the reduction does not compound).
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler, ensureShieldTicker, grantTimedShield } from "./betting-shared.ts";

export const KURO = Object.freeze({ rageCd: 2, trigger: 0.2, perStep: 0.03, step: 0.3, returnTurns: 2, shieldAtk: 1.35, shieldTurns: 2, ratio: 99, followCut: 0.4 });
export const RETURN_ID = "2772_1";
const returnDef = () => markDef({ id: RETURN_ID, name: "回魂", category: StatusCategory.BUFF_MARK, durationPolicy: "TARGET_TURN",
  desc: "【增益、印记】受到致命伤害时将剩余1点生命并立即获得攻击135%的护盾，持续2回合" }, StatusBook);

export const isKuro277 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "277_02") && !!skillById(e, "277_03");
const lostSteps = (e: Entity): number => (e.maxHp > 0 ? GameMath.floorAt(Math.max(0, 1 - e.hp / e.maxHp) / KURO.step + 1e-9, "KURO_LOST_STEPS") : 0);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);

/** Follow-up depth of the running 连斩 (0 = the cast itself; transient). */
const follow = new WeakMap<object, number>();

type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };

export function kuroDamageHook(x: any): Hook | null {
  if (x?.id !== "277_03") return null;
  return {
    kind: "KURO_CHAIN",
    run: async (battle, k, hurt) => {
      const depth = follow.get(k) ?? 0;
      const mul = depth > 0 ? 1 - KURO.followCut : 1;
      const hits = 1 + lostSteps(k);
      let killed = false;
      for (let h = 0; h < hits; h++) {
        await battle.withinResolution({ id: "HIT:" + x.name + "#" + (h + 1), type: "HIT" }, async () => {
          for (const v of aliveEnemies(battle, k)) {
            if (!hurt.includes(v)) hurt.push(v);
            await battle.damage(k, v, k.prop("atk") * (Number(x.damage?.[0]?.ratioMax ?? KURO.ratio) / 100), DamageType.NORMAL, mul, null);
            if (!v.alive) killed = true;
          }
        });
      }
      if (!killed || !k.alive || !aliveEnemies(battle, k).length) return;
      const sk = skillById(k, "277_03");
      battle.trace.push({ t: "SUBCAST", actor: k.id, ref: "277_03", skill: x.name, target: aliveEnemies(battle, k)[0].id, clause: "若击败敌方，接着免消耗施放一次降低40%伤害的『连斩』", depth: depth + 1 });
      follow.set(k, depth + 1);
      try { await battle.runPseudoTurn(k, TurnType.PSEUDO_TURN, { skill: sk, target: aliveEnemies(battle, k)[0], free: true }); }
      finally { follow.set(k, depth); }
    },
  };
}

function grantReturn(battle: any, k: Entity, reason: string): void {
  for (const st of [...k.statuses]) if (st.def.id === RETURN_ID) k.expireStatus(st);
  const def = returnDef();
  const a = k.addStatus(def, k.id, 1, KURO.returnTurns, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: k.id, dst: k.id, status: RETURN_ID, name: def.name, category: def.category, duration: KURO.returnTurns, ref: RETURN_ID, known: true, tag: a.tag, reason, skill: "魂之怒火" });
}

export const KURO_PATCHES = Object.freeze({
  "277_02": { note: "魂之怒火: 回魂 (先机) and the free 连斩 trigger are run by betting-kuro.ts", patch: { statusRefConditionOnly: [0] } },
});

export function installKuro(battle: any, entities: Entity[]): Array<{ entityId: number; mechanic: string }> {
  const out: Array<{ entityId: number; mechanic: string }> = [];
  if (!bettingActive()) return out;
  for (const k of entities.filter(isKuro277)) {
    ensureShieldTicker(battle);
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL") =>
      registerOwnerHandler(battle, "betting:277:" + code + ":" + k.id, k.id, code, fn, range);
    reg(EV.BATTLE_START, () => {
      if (k.hasStatus(RETURN_ID)) return;
      battle.trace.push({ t: "SUBCAST", actor: k.id, ref: "277_02", skill: "魂之怒火", target: k.id, clause: "[tips_7]先机：施放「魂之怒火」" });
      grantReturn(battle, k, "SENKI");
    }, "SELF");
    reg(EV.DEATH_PREVENTION, (hook: any) => {
      if (hook?.target?.id !== k.id || hook.prevented) return;
      const st = k.statuses.find(s => s.def.id === RETURN_ID);
      if (!st) return;
      hook.prevented = true;
      k.hpZero = false; k.alive = true; k.dead = false; k.hp = 1;
      k.expireStatus(st);
      battle.trace.push({ t: "UNDYING", id: k.id, by: RETURN_ID, keep: "1HP", skill: "回魂" });
      grantTimedShield(battle, k, k, k.prop("atk") * KURO.shieldAtk, KURO.shieldTurns,
        { tag: "2772", skill: "回魂", reason: "LETHAL", base: "atk", ratio: KURO.shieldAtk * 100 });
    }, "SELF");
    reg(EV.AFTER_DAMAGE, async (ctx: any) => {
      const src: Entity | undefined = ctx?.input?.source;
      if (ctx?.input?.target?.id !== k.id || !src || src.teamId === k.teamId || !k.alive || !src.alive) return;
      if (ctx.result?.type === DamageType.CONDUCTION || String(ctx.input.skillTag ?? "").startsWith("soul:")) return;
      if (isActionPrevented(k.statusDefs()) || Number(noteValue(k, "kuro277:cd=") ?? 0) > 0) return;
      const key = battle.turn + ":" + src.id;
      if (noteValue(k, "kuro277:rage=") === key) return;
      setNote(k, "kuro277:rage=", key);   // one roll per enemy attack action (the first hit that lands)
      const p = KURO.trigger + KURO.perStep * lostSteps(k);
      battle.rng.expect("kuro277_rage");
      if (!battle.rng.testHit(p)) return;
      setNote(k, "kuro277:cd=", KURO.rageCd);
      const sk = skillById(k, "277_03");
      battle.trace.push({ t: "SUBCAST", actor: k.id, ref: "277_03", skill: sk.name, target: src.id, clause: "受到非传导伤害的攻击时，有" + GameMath.display(p * 100) + "%概率免消耗施放一次『连斩』" });
      await battle.runPseudoTurn(k, TurnType.PSEUDO_TURN, { skill: sk, target: src, free: true });
    });
    reg(EV.TURN_END, (ctx: any) => {
      const cd = Number(noteValue(k, "kuro277:cd=") ?? 0);
      if (ctx?.actor?.id === k.id && cd > 0) setNote(k, "kuro277:cd=", cd - 1);
    }, "SELF");
    out.push({ entityId: k.id, mechanic: "魂之怒火 (free 连斩 on hit, 回魂 先机) · 连斩 extra hits / kill follow-up" });
  }
  return out;
}
