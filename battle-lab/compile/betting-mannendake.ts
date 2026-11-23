// compile/betting-mannendake.ts — 万年竹 (SR 275, Global "Mannendake") at max skill level. MAX mode only.
//
// Sources: data/kb/shikigami.json 275_01..275_03, buff 2752_1 竹叶守护, tips_10 邀战 / tips_15 维持;
// fandom "Mannendake/Main".
//   笛中剑 (275_01) · 125% ATK; 30% chance to Challenge (邀战) a random other non-summon ally, which basic-attacks the
//       same target. Counters are basic attacks too, so they can also Challenge.
//   竹叶守护 (275_02, passive) · at the end of his turn he gains 竹叶守护 for 1 turn (his own turns).
//   竹语 (275_03, 3 onibi) · every ally gains 竹叶守护 and +15% (L5) of Mannendake's ATK as flat ATK, sustained 1 of
//       his turns.
//   竹叶守护 [Buff, Mark] · when a bearer is attacked by an enemy and Mannendake is not unable to act, he counters
//       the attacker with 60% (L4) chance; 100% when he is the bearer being attacked. Read as one counter at most
//       per enemy action (the first bearer hit whose roll succeeds; one roll per bearer per action); counters never
//       chain (Battle.counterAttack), transferred / indirect / soul damage does not count as an attack.
//   AI (KB) · "3技能" every turn (竹语 when affordable, else 笛中剑) — the generic KB rule already does this.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import type { BettingKit, Hook, Installed } from "./betting-m7.ts";
import { bettingActive, isSummonUnit, skillById, markDef, noteValue, setNote, registerOwnerHandler } from "./betting-shared.ts";

export const MANNENDAKE = Object.freeze({ basicRatio: 125, challenge: 0.3, counter: 0.6, selfCounter: 1, atkShare: 0.15, turns: 2 });

export const GUARD_ID = "2752_1";
export const BOOST_ID = "275_whisper_atk";
const N_ACTION = "mann275:action=", N_ROLLED = "mann275:rolled=";

const guardDef = () => markDef({ id: GUARD_ID, name: "竹叶守护", category: StatusCategory.BUFF_MARK, durationPolicy: "SOURCE_TURN", dispellable: true, removable: true,
  desc: "【增益、印记】友方受到攻击时，若自身未处于无法动作，万年竹有60%概率反击发起攻击的敌方目标。若为万年竹自身受到攻击，则概率提升至100%。" }, StatusBook);
const boostDef = () => markDef({ id: BOOST_ID, name: "竹语·攻击提升", category: StatusCategory.BUFF_STATE, durationPolicy: "SOURCE_TURN", dispellable: true, removable: true,
  desc: "竹语：提升攻击，提升等同万年竹攻击15%，维持1回合。" }, StatusBook);

export const isMannendake275 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "275_02") && !!skillById(e, "275_03");

function grant(battle: any, m: Entity, dst: Entity, def: any, effects: any[], skill: string): void {
  for (const st of [...dst.statuses]) if (st.def.id === def.id && st.sourceId === m.id) dst.expireStatus(st);
  // SOURCE_TURN ticks at the end of every turn of Mannendake, the granting turn included ⇒ 2 = through his next turn.
  const a = dst.addStatus(def, m.id, 1, MANNENDAKE.turns, effects, 1);
  battle.trace.push({ t: "STATUS_APPLY", src: m.id, dst: dst.id, status: def.id, name: def.name, category: def.category, duration: 1, ref: def.id, known: true, tag: (a as any)?.tag ?? null, skill });
}

/** 笛中剑: the hit, then the 30% Challenge roll. */
function fluteHook(x: any): Hook | null {
  if (x?.id !== "275_01") return null;
  return {
    kind: "SWORD_FLUTE",
    run: async (battle, m, hurt, primary) => {
      const target = primary?.alive && primary.teamId !== m.teamId ? primary : battle.enemiesOf(m.teamId).find((v: Entity) => v.alive);
      if (!target) return;
      hurt.push(target);
      await battle.withinResolution({ id: "HIT:" + x.name + "#1", type: "HIT" }, async () => {
        await battle.damage(m, target, m.prop("atk") * (Number(x.damage?.[0]?.ratioMax ?? MANNENDAKE.basicRatio) / 100), DamageType.NORMAL, 1, null);
      });
      if (!isMannendake275(m) || !target.alive) return;
      battle.rng.expect("mann275_challenge");
      if (!battle.rng.testHit(MANNENDAKE.challenge)) return;
      const pool = (battle.teams[m.teamId].members as Entity[]).filter(a => a.alive && a.id !== m.id && !isSummonUnit(a) && !isActionPrevented(a.statusDefs()));
      if (!pool.length) return;
      battle.rng.expect("mann275_challenge_pick");
      const ally: Entity = battle.rng.pick(pool);
      const basic = ally.skills.find((s: any) => Number(s.cost) === 0);
      if (!basic) return;
      battle.trace.push({ t: "CHALLENGE", src: m.id, actor: ally.id, target: target.id, skill: x.name });
      await battle.runPseudoTurn(ally, TurnType.PSEUDO_TURN, { skill: basic, target });
    },
  };
}

async function afterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive() || x?.id !== "275_03" || !isMannendake275(self)) return false;
  const atk = self.prop("atk") * MANNENDAKE.atkShare;
  for (const a of battle.teams[self.teamId].aliveMembers() as Entity[]) {
    grant(battle, self, a, guardDef(), [], x.name);
    grant(battle, self, a, boostDef(), [{ prop: "atk", value: atk, mode: "FIXED" }], x.name);
  }
  return true;
}

/** An enemy attack on a 竹叶守护 bearer: at most one counter per enemy action. */
async function onAttacked(battle: any, m: Entity, ctx: any): Promise<void> {
  const src: Entity | undefined = ctx?.input?.source, dst: Entity | undefined = ctx?.input?.target;
  if (!src || !dst || !m.alive || !src.alive || src.teamId === m.teamId || dst.teamId !== m.teamId) return;
  if (!dst.statuses.some(s => s.def.id === GUARD_ID && s.sourceId === m.id)) return;
  const t = ctx?.result?.type;
  if (t === DamageType.CONDUCTION || t === DamageType.INDIRECT || String(ctx.input.skillTag ?? "").startsWith("soul:")) return;
  if (isActionPrevented(m.statusDefs())) return;
  const action = battle.turn + ":" + src.id;
  if (noteValue(m, N_ACTION) !== action) { setNote(m, N_ACTION, action); setNote(m, N_ROLLED, ""); }
  const rolled = String(noteValue(m, N_ROLLED) ?? "");
  if (rolled === "done" || rolled.split(",").includes(String(dst.id))) return;
  setNote(m, N_ROLLED, rolled ? rolled + "," + dst.id : String(dst.id));
  const p = dst.id === m.id ? MANNENDAKE.selfCounter : MANNENDAKE.counter;
  battle.rng.expect("mann275_counter");
  if (!battle.rng.testHit(p)) return;
  setNote(m, N_ROLLED, "done");
  await battle.counterAttack(m, src.id);
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const m of entities.filter(isMannendake275)) {
    const reg = (code: string, fn: (ctx: any) => Promise<void> | void, range: "SELF" | "ALL" = "ALL", passive = true) =>
      registerOwnerHandler(battle, "betting:275:" + code + ":" + m.id, m.id, code, fn, range, { passive });
    reg(EV.TURN_END, (ctx: any) => { if (ctx?.actor?.id === m.id && m.alive) grant(battle, m, m, guardDef(), [], "竹叶守护"); }, "SELF");
    // The mark's counter belongs to the buff (granted by the active skill too) ⇒ not sealed with his passive.
    reg(EV.AFTER_DAMAGE, (ctx: any) => onAttacked(battle, m, ctx), "ALL", false);
    out.push({ entityId: m.id, mechanic: "竹叶守护 (turn-end self mark, 60% / 100% counter) · 竹语 (+15% ATK) · 笛中剑 30% 邀战" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "275_02": { note: "竹叶守护: the turn-end mark and its counters are run by betting-mannendake.ts", patch: { statusRefConditionOnly: [0] } },
    "275_03": { note: "竹语: 竹叶守护 and the +15% ATK (sustained by Mannendake) are granted by betting-mannendake.ts", patch: { statusRefConditionOnly: [0] } },
  }),
  damageHook: fluteHook,
  afterCast,
  install,
};
