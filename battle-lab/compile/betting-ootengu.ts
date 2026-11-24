// compile/betting-ootengu.ts — 大天狗 (SSR 217, Global "Ootengu") at max skill level. MAX mode only (match 11).
//
// Sources: data/kb/shikigami.json 217_01..217_03, buff 2173_1 雄姿英发, tips_14 庇护; data/kb/en-text.json (Global).
// Before this module the passive 钢铁之羽 never ran (generic passives are off) and 羽刃暴风 pulled its bar 5% once.
//   钢铁之羽 (217_02, passive) · 庇护 (tips_14) at battle start and at the end of each of his turns. Dealing damage:
//                               50% chance of +1 雄姿英发 (2173_1: +1% damage per stack), cap 80 at L4, "持续至回目结束"
//                               (a duel is a single 回目 ⇒ the whole battle). L5: after 庇护 blocks a control effect,
//                               free 羽刃暴风.
//   羽刃暴风 (217_03, 3)       · 4 × 75% ATK on all enemies. Each enemy hit: +1 雄姿英发 and +5% own action bar, at
//                               most 6 triggers per cast.
//   AI (KB, compiles)         · 羽刃暴风 when affordable, else 风袭 (unchanged).
// Readings (conservative, unverified): "单次攻击最多触发6次" is read as 6 triggers per cast (not per wave); the 50%
// roll is made per damage instance of his skills (soul procs such as 针女 do not roll); 庇护 is the engine's one-shot
// control immunity — it is removed at the end of the action in which it blocked (it "blocks all controls of one
// skill"), then the L5 free cast follows.
import type { Entity } from "../kernel/entity.ts";
import { DamageType, EV, StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook, isActionPrevented } from "../kernel/status.ts";
import type { BettingKit, Installed } from "./betting-m7.ts";
import {
  bettingActive, isSummonUnit, skillById, markDef, registerOwnerHandler, stacksOn, setStackedStatus, shiftBar, PERSIST, STATUS_TICK_TAG,
} from "./betting-shared.ts";

export const OOTENGU = Object.freeze({ heroCap: 80, heroDmg: 0.01, heroChance: 0.5, stormWaves: 4, stormRatio: 75, triggerCap: 6, barPerTrigger: 0.05 });
export const HERO_ID = "2173_1";
export const OOT_SHELTER_ID = "217_shelter";

const heroDef = () => markDef({ id: HERO_ID, name: "雄姿英发", category: StatusCategory.COMMON_MARK, durationPolicy: "GLOBAL",
  desc: "【通用、印记】每层提升1%伤害。（大天狗 L4：上限80层，持续至回目结束）" }, StatusBook);
const shelterDef = () => markDef({ id: OOT_SHELTER_ID, name: "庇护", category: StatusCategory.BUFF_MARK, durationPolicy: "GLOBAL",
  immuneTo: ["CONTROL", "BANISH"], consumeOnImmune: true, desc: "可抵挡单次技能当中的所有控制效果和放逐（betting: 抵挡后于该行动结束时移除）。" }, StatusBook);

export const isOotengu217 = (e: Entity): boolean => !isSummonUnit(e) && !!skillById(e, "217_02") && !!skillById(e, "217_03");
export const heroStacks = (e: Entity): number => stacksOn(e, HERO_ID, e.id);
const aliveEnemies = (battle: any, e: Entity): Entity[] => battle.enemiesOf(e.teamId).filter((v: Entity) => v.alive);

function addHero(battle: any, o: Entity, n: number, reason: string): void {
  if (!(n > 0) || !o.alive) return;
  const before = heroStacks(o);
  if (before >= OOTENGU.heroCap) return;
  const after = setStackedStatus(o, heroDef(), before + n, OOTENGU.heroCap, o.id, [{ prop: "dmgDealtB", value: OOTENGU.heroDmg, mode: "FIXED" }]);
  battle.trace.push({ t: "STATUS_APPLY", src: o.id, dst: o.id, status: HERO_ID, name: "雄姿英发", category: StatusCategory.COMMON_MARK, duration: PERSIST, ref: HERO_ID, known: true, stacks: after, threshold: OOTENGU.heroCap, reason, skill: "钢铁之羽" });
}

function grantShelter(battle: any, o: Entity, reason: string): void {
  if (!o.alive) return;
  for (const st of [...o.statuses]) if (st.def.id === OOT_SHELTER_ID) o.expireStatus(st);
  const def = shelterDef();
  const a: any = o.addStatus(def, o.id, 1, PERSIST, [], 1);
  battle.trace.push({ t: "STATUS_APPLY", src: o.id, dst: o.id, status: OOT_SHELTER_ID, name: def.name, category: def.category, duration: PERSIST, ref: "tips_14", known: true, tag: a?.tag ?? null, reason, skill: "钢铁之羽" });
}

function damageHook(x: any): any {
  if (x?.id !== "217_03") return null;
  return {
    kind: "OOTENGU_STORM",
    run: async (battle: any, o: Entity, hurt: Entity[]) => {
      const ratio = Number(x.damage?.[0]?.ratioMax ?? x.damage?.[0]?.ratio ?? OOTENGU.stormRatio);
      let hits = 0;
      for (let w = 1; w <= OOTENGU.stormWaves; w++) {
        const foes = aliveEnemies(battle, o);
        if (!foes.length || !o.alive) break;
        await battle.withinResolution({ id: "HIT:" + x.name + "#" + w, type: "HIT" }, async () => {
          for (const v of foes) {
            if (!v.alive) continue;
            if (!hurt.includes(v)) hurt.push(v);
            await battle.damage(o, v, o.prop("atk") * (ratio / 100), DamageType.NORMAL, 1, x.lifesteal ?? null);
            hits++;
          }
        });
      }
      const n = Math.min(OOTENGU.triggerCap, hits);
      if (n > 0 && o.alive) {
        addHero(battle, o, n, "STORM_HITS");
        shiftBar(battle, o, OOTENGU.barPerTrigger * n, x.name);
      }
    },
  };
}

function install(battle: any, entities: Entity[]): Installed {
  const out: Installed = [];
  if (!bettingActive()) return out;
  for (const o of entities.filter(isOotengu217)) {
    registerOwnerHandler(battle, "betting:217:start:" + o.id, o.id, EV.BATTLE_START, () => {
      if (!o.statuses.some(s => s.def.id === OOT_SHELTER_ID)) grantShelter(battle, o, "BATTLE_START");
    });
    registerOwnerHandler(battle, "betting:217:turn-end:" + o.id, o.id, EV.TURN_END, (ctx: any) => {
      if (ctx?.actor?.id === o.id) grantShelter(battle, o, "TURN_END");
    });
    // 雄姿英发: 50% per damage instance of his skills (not soul procs / status ticks).
    registerOwnerHandler(battle, "betting:217:hero:" + o.id, o.id, EV.AFTER_DAMAGE, (ctx: any) => {
      const src = ctx?.input?.source, dst = ctx?.input?.target, res = ctx?.result;
      if (src?.id !== o.id || !dst || dst.teamId === o.teamId || !res) return;
      const tag = String(ctx.input.skillTag ?? "");
      if (tag.startsWith("soul:") || tag.startsWith(STATUS_TICK_TAG)) return;
      if (!(Number(res.applied ?? 0) + Number(res.absorbed ?? 0) > 0)) return;
      battle.rng.expect("ootengu:hero:" + o.id);
      if (battle.rng.testHit(OOTENGU.heroChance)) addHero(battle, o, 1, "DAMAGE_DEALT");
    }, "ALL");
    // 庇护 consumed during an action ⇒ removed at its end; L5 free 羽刃暴风.
    registerOwnerHandler(battle, "betting:217:shelter:" + o.id, o.id, EV.ACTION_END, async () => {
      const st = o.statuses.find(s => s.def.id === OOT_SHELTER_ID);
      if (!st || st.stacks > 0) return;
      o.expireStatus(st);
      battle.trace.push({ t: "STATUS_REMOVE", id: o.id, status: OOT_SHELTER_ID, name: "庇护", by: "CONSUMED", side: "ALLY", what: "BUFF", src: o.id, skill: "钢铁之羽" });
      const storm = skillById(o, "217_03");
      const target = aliveEnemies(battle, o)[0];
      if (!o.alive || !storm || !target || isActionPrevented(o.statusDefs())) return;
      battle.trace.push({ t: "SUBCAST", actor: o.id, ref: "217_03", skill: storm.name, target: target.id, clause: "钢铁之羽 L5：庇护抵挡控制效果后，无消耗施放『羽刃暴风』" });
      await battle.runPseudoTurn(o, TurnType.PSEUDO_TURN, { skill: storm, target, free: true });
    }, "ALL");
    out.push({ entityId: o.id, mechanic: "钢铁之羽 (庇护 at battle start / turn end, 50% 雄姿英发 +1% damage per stack up to 80, L5 free storm after a block) · 羽刃暴风 4×75%, +1 stack / +5% bar per enemy hit (max 6)" });
  }
  return out;
}

export const KIT: BettingKit = {
  patches: Object.freeze({
    "217_02": { note: "钢铁之羽: 庇护, 雄姿英发 and the L5 free storm are run by betting-ootengu.ts", patch: { statusRefConditionOnly: [0] } },
    "217_03": { note: "羽刃暴风: the per-hit stacks and +5% bar (max 6 per cast) are run by betting-ootengu.ts", patch: { timeline: [] } },
  }),
  damageHook: (x: any) => (bettingActive() ? damageHook(x) : null),
  install,
};
