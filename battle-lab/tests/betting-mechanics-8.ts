// tests/betting-mechanics-8.ts — match-5 replay review (2026-11-23e, real result BLUE): MAX-mode fixes for
//   迦楼罗 378 惜羽 heal (betting-garuda.ts), 童女 213 命之祭献 (betting-doujo.ts), 云外镜 344 Yang form
//   (betting-ungaikyo.ts), 追月神 295 (betting-oitsuki295.ts), and the 辉夜姬 280 / 花鸟卷 367 cost hooks that
//   ignored the IR form passed by character.ts at execution.
// Run: node battle-lab/tests/betting-mechanics-8.ts
import { setSkillLevelMode } from "../compile/max-level.ts";
import { assembleGuessingMatch } from "../soul/guessing-match.ts";
import type { MatchFixture, MatchEntry } from "../soul/guessing-match.ts";
import { selectSkillByAI } from "../compile/character.ts";
import { shiftBar, markDef, setNote } from "../compile/betting-shared.ts";
import { flushBarReactions } from "../compile/betting-bar.ts";
import { bettingCostOf } from "../compile/betting-mechanics.ts";
import { GARUDA, hasFeather } from "../compile/betting-garuda.ts";
import { BETTING_HP_SCALE } from "../compile/betting-policies.ts";
import { DOUJO } from "../compile/betting-doujo.ts";
import { UNGAIKYO, formOf } from "../compile/betting-ungaikyo.ts";
import { OITSUKI295, BLESS_ID, blessingActive, senkiCells } from "../compile/betting-oitsuki295.ts";
import { kaguyaIllusion } from "../compile/betting-kaguya.ts";
import { hanaCost } from "../compile/betting-hana.ts";
import { StatusCategory, TurnType } from "../kernel/types.ts";
import { StatusBook } from "../kernel/status.ts";

setSkillLevelMode("MAX");

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };
const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const unit = (shikigamiId: number, hp: number, extra: Partial<MatchEntry["stats"]> = {}): MatchEntry => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
const RED = () => [unit(201, 20000), unit(201, 40000), unit(201, 25000, { spd: 180 }), unit(201, 30000), unit(201, 22000)];
async function match(blue: MatchEntry[], seed = 1, startup = true, red: MatchEntry[] = RED()) {
  const fx: MatchFixture = { _meta: { title: "betting-mechanics-8" }, red, blue };
  const A = await assembleGuessingMatch(fx, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  if (startup) await b.runStartup();
  const find = (charId: number, team = 1) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find, enemies: () => b.enemiesOf(1) as any[], allies: () => b.teams[1].members as any[] };
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const turnEnd = (b: any, actor: any) => b.bus.dispatch("TURN_END", { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const turnStart = (b: any, actor: any) => b.bus.dispatch("TURN_START", { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => {
  const s = sk(e, id);
  return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target));
};

sec("[1] 迦楼罗 378: 惜羽 consumed ⇒ the lowest-HP ally recovers 10% of Garuda's real max HP (replay: 4855 for Lineup 20065 × 2.42)");
{
  ok("constant: 10% × round(20065 × 2.42) displays 4855", GARUDA.healRatio === 0.1 && Math.floor(GARUDA.healRatio * Math.round(20065 * BETTING_HP_SCALE)) === 4855, String(GARUDA.healRatio * 20065 * BETTING_HP_SCALE));
  const { b, find, enemies, allies } = await match([unit(378, 20065, { atk: 3908, spd: 120 }), unit(201, 20000), unit(201, 20000)], 4);
  const g = find(378), foes = enemies();
  b.teams[1].orbs.orb = 8;
  await sk(g, "378_03").execute(b, g, foes[0]);
  ok("龙息炽羽: 惜羽 on the target", hasFeather(foes[1], g));
  const ally = allies()[1];
  ally.hp = 5000;
  ally.addStatus(markDef({ id: "test_healdown", name: "减疗", category: StatusCategory.DEBUFF_STATE, desc: "test" }, StatusBook), foes[0].id, 1, 5,
    [{ prop: "healDown", value: 0.5, mode: "FIXED" }], 1);
  const mark = b.trace.length;
  shiftBar(b, foes[1], 0.2, "test");
  await flushBarReactions(b);
  const rec = since(b, mark).find((t: any) => (t.t === "HEAL" || t.t === "RECOVER") && t.src === g.id);
  ok("…it is a RECOVER (恢复: no crit, no heal reduction)", rec?.t === "RECOVER", JSON.stringify(rec));
  ok("…amount 10% of 20065 × 2.42 = 4855.7 despite a 50% heal reduction", !!rec && near(Number(rec.amount), 20065 * BETTING_HP_SCALE * 0.1, 1) && rec.dst === ally.id, String(rec?.amount));
}

sec("[2] 童女 213 命之祭献: sacrifice 20% current HP, every other ally healed 10% of that HP (replay: 2304, 2016, 1728…)");
{
  const { b, find, allies } = await match([unit(213, 25431, { spd: 120 }), unit(201, 20000), unit(201, 15000), unit(201, 30000)], 5);
  const d = find(213);
  ok("IR: the compiled 22.5% max-HP heal slot is removed", (sk(d, "213_03").ir.heal ?? []).length === 0, JSON.stringify(sk(d, "213_03").ir.heal));
  const others = allies().filter((m: any) => m.id !== d.id);
  for (const m of others) m.hp = m.maxHp * 0.3;
  d.hp = 23040;
  b.teams[1].orbs.orb = 8;
  let mark = b.trace.length;
  await cast(b, d, "213_03", others[0]);
  let tr = since(b, mark);
  ok("Doujo loses 20% of her current HP (23040 → 18432)", near(d.hp, 23040 * (1 - DOUJO.sacrifice), 1e-6), String(d.hp));
  const heals = tr.filter((t: any) => t.t === "HEAL" && t.src === d.id);
  ok("every other ally healed 2304 (10% of 23040), the same amount regardless of its max HP",
    heals.length === others.length && heals.every((t: any) => near(Number(t.amount), 2304, 1)), heals.map((t: any) => t.amount).join(","));
  ok("…Doujo herself is not healed above 30% HP", !heals.some((t: any) => t.dst === d.id));
  ok("…trace DOUJO_SACRIFICE", tr.some((t: any) => t.t === "DOUJO_SACRIFICE" && near(Number(t.sacrifice), 4608, 1)));
  d.hp = 0.25 * d.maxHp;
  const hp0 = d.hp;
  mark = b.trace.length;
  await cast(b, d, "213_03", others[0]);
  tr = since(b, mark);
  const self = tr.find((t: any) => t.t === "HEAL" && t.src === d.id && t.dst === d.id);
  ok("below 30% HP: she heals herself too (10% of her HP before the sacrifice)", !!self && near(Number(self.amount), hp0 * DOUJO.healOfHp, 1), JSON.stringify(self));
}

sec("[3] 云外镜 344 Yang: 镜佑 at battle start, 苦海浮生 costs 2, heal 480% DEF, sealed by 压制");
{
  const { b, find, enemies, allies } = await match([unit(344, 10370, { atk: 3878, def: 891, spd: 145 }), unit(201, 26935), unit(201, 20000)], 6);
  const u = find(344), foes = enemies();
  ok("ATK 3878 ≤ 500% DEF ⇒ Yang, DEF 891 + 387.8 = 1278.8", formOf(u) === "YANG" && near(u.prop("def"), 1278.8, 1e-6), String(u.prop("def")));
  ok("昭回: 镜佑 on Ungaikyo at battle start (persistent)", u.statuses.some((s: any) => s.def.id === "3444_1" && s.remaining > 1000));
  ok("…only on himself (苦海浮生 not cast yet)", !allies().some((m: any) => m.id !== u.id && m.hasStatus("3444_1")));
  b.teams[1].orbs.orb = 1;
  ok("1 onibi: 昙无", selectSkillByAI(b, u, foes)?.name === "昙无");
  b.teams[1].orbs.orb = 2;
  const p = selectSkillByAI(b, u, foes);
  ok("2 onibi: 苦海浮生 (cost 2)", p?.name === "苦海浮生" && p.cost === UNGAIKYO.yangUltCost && UNGAIKYO.yangUltCost === 2, String(p?.name) + "/" + p?.cost);
  const low = allies()[1];
  low.hp = low.maxHp * 0.2;
  const seal = markDef({ id: "test_seal", name: "压制(test)", category: StatusCategory.DEBUFF_STATE, desc: "test", suppressPassive: true } as any, StatusBook);
  u.addStatus(seal, foes[0].id, 1, 5, [], 1);
  let mark = b.trace.length;
  u.addStatus(StatusBook.get("freeze")!, foes[0].id, 1, 2, [], null);
  await b.drainEvents();
  ok("sealed (压制): a control on him is NOT dispelled (replay: no dispel inside Hannya's barrier)",
    u.hasStatus("freeze") && !since(b, mark).some((t: any) => t.t === "STATUS_REMOVE" && t.skill === "镜佑"));
  for (const st of [...u.statuses]) if (st.def.id === "test_seal" || st.def.id === "freeze") u.expireStatus(st);
  b.turn = Number(b.turn ?? 0) + 1;
  mark = b.trace.length;
  u.addStatus(StatusBook.get("freeze")!, foes[0].id, 1, 2, [], null);
  await b.drainEvents();
  const tr = since(b, mark);
  ok("unsealed: the control is dispelled at once and his bar +10%", !u.hasStatus("freeze")
    && tr.some((t: any) => t.t === "TIMELINE_SHIFT" && t.id === u.id && near(t.percent, 0.1)));
  const rec = tr.find((t: any) => (t.t === "RECOVER" || t.t === "HEAL") && t.src === u.id);
  ok("…the lowest HP-ratio ally recovers 480% DEF = 6138 (replay 6139)", rec?.t === "RECOVER" && rec.dst === low.id && near(Number(rec.amount), 4.8 * 1278.8, 1), JSON.stringify(rec));
}

sec("[4] 追月神 295: 先机 +4 gauge cells, 月之祝福 (aura, +1 cell per ally turn end, lifetime), L5 partial cast");
{
  const blue = [unit(295, 26935, { atk: 2791, spd: 169 }), unit(201, 20000, { atk: 4000 }), unit(201, 20000, { atk: 5000 })];
  const { b, find, allies } = await match(blue, 7);
  const o = find(295), pool = b.teams[1].orbs;
  ok("明月潮生 L4 reads 4 cells", senkiCells(o) === 4);
  ok("battle start: Blue gauge at 4/5, Red gauge untouched", pool.gauge === 4 && pool.cycle === 0 && b.teams[0].orbs.gauge === 0, `${pool.gauge}/${pool.cycle}`);
  const mates = allies().filter((m: any) => m.id !== o.id);
  const spd0 = mates.map((m: any) => m.prop("spd")), atk0 = mates.map((m: any) => m.prop("atk"));
  const ospd = o.prop("spd");
  pool.orb = 4;
  await turnStart(b, o);
  await cast(b, o, "295_03", mates[0]);
  ok("清辉月华: 月之祝福 on Oitsuki", o.hasStatus(BLESS_ID) && blessingActive(o));
  ok("…other allies +20 SPD", mates.every((m: any, i: number) => near(m.prop("spd") - spd0[i], OITSUKI295.blessSpd)), mates.map((m: any, i: number) => m.prop("spd") - spd0[i]).join(","));
  ok("…other allies ATK up (20% of base ATK)", mates.every((m: any, i: number) => m.prop("atk") > atk0[i]), mates.map((m: any, i: number) => m.prop("atk") - atk0[i]).join(","));
  ok("…Oitsuki herself unchanged", near(o.prop("spd"), ospd));
  await turnEnd(b, o);
  ok("…kept through the casting turn's end", blessingActive(o));
  const g0 = pool.gauge, c0 = pool.cycle;
  await turnEnd(b, mates[0]);
  ok("an ally's turn end: gauge +1 extra cell", pool.gauge === (g0 + 1) % 5 && pool.cycle === c0 + (g0 + 1 >= 5 ? 1 : 0), `${g0}→${pool.gauge}`);
  await turnStart(b, o);
  await turnEnd(b, o);
  ok("ends at the end of her next own turn (no recast)", !blessingActive(o) && !o.hasStatus(BLESS_ID)
    && mates.every((m: any, i: number) => near(m.prop("spd"), spd0[i])));
  const g1 = pool.gauge;
  await turnEnd(b, mates[0]);
  ok("…no extra cell afterwards", pool.gauge === g1);
  const s3 = sk(o, "295_03");
  pool.orb = 1; pool.gauge = 2;
  ok("L5: 1 onibi + 2 gauge cells ⇒ 清辉月华 costs 1 (skill entry and IR form)", bettingCostOf(b, o, s3) === 1 && bettingCostOf(b, o, s3.ir) === 1);
  const mark = b.trace.length;
  await cast(b, o, "295_03", mates[0]);
  await b.drainEvents();
  ok("…paid 1 onibi, the shortfall (1) taken from the gauge", pool.orb === 0 && pool.gauge === 1
    && since(b, mark).some((t: any) => t.t === "OITSUKI295_PARTIAL_CAST" && t.gaugeCells === 1), `${pool.orb}/${pool.gauge}`);
  pool.orb = 1; pool.gauge = 0;
  ok("…gauge empty ⇒ full cost 2", bettingCostOf(b, o, s3) === 2);
}

sec("[5] 辉夜姬 280 / 花鸟卷 367: cost hooks accept the IR (execution) as well as the skill entry (AI)");
{
  const { b, find } = await match([unit(280, 20000, { spd: 150 }), unit(201, 20000)], 8);
  const k = find(280), jewel = sk(k, "280_03");
  b.teams[1].orbs.orb = 8;
  if (!kaguyaIllusion(b, 1)) await cast(b, k, "280_03", k);
  ok("Kaguya's illusion is up", !!kaguyaIllusion(b, 1));
  const viaSkill = bettingCostOf(b, k, jewel), viaIr = bettingCostOf(b, k, jewel.ir);
  ok("龙首之玉 −1 in the illusion, for both forms", viaSkill === Number(jewel.cost) - 1 && viaIr === viaSkill, `${jewel.cost}: skill ${viaSkill}, ir ${viaIr}`);
}
{
  const { b, find } = await match([unit(367, 20000, { spd: 150 }), unit(201, 20000)], 9);
  const h = find(367), s3 = sk(h, "367_03");
  setNote(h, "hana:painting=", "2:0:0");
  ok("繁花坠露 costs 0 while painting, for both forms", hanaCost(b, h, s3, 3) === 0 && hanaCost(b, h, s3.ir, 3) === 0);
  setNote(h, "hana:painting=", null);
  ok("…normal cost without painting", hanaCost(b, h, s3.ir, 3) === 3);
}

sec("[6] BASE mode: no betting module installed");
{
  setSkillLevelMode("BASE");
  const { b, find } = await match([unit(295, 26935, { spd: 169 }), unit(344, 10370, { atk: 3878, def: 891 }), unit(213, 25431)], 10);
  ok("BASE: no 先机 gauge cells, no Yang 镜佑, Doujo IR heal intact",
    b.teams[1].orbs.gauge === 0 && !find(344).hasStatus("3444_1") && (sk(find(213), "213_03").ir.heal ?? []).length > 0);
  setSkillLevelMode("MAX");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
