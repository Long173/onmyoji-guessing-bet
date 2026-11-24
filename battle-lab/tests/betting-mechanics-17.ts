// tests/betting-mechanics-17.ts — match-11 kits (2026-11-24c), MAX (betting) mode:
//   · 影鳄 375 影壳 影食 stacks → 30% ATK burst + 3% heal, 幕影盖地 影缚 50% (betting-kagewani.ts);
//   · 惠比寿 268 鲤鱼旗 summon (60% HP, 140% SPD), 40% heal before ally turns, no recast, L5 onibi (betting-ebisu.ts);
//   · 大天狗 217 庇护, 雄姿英发 cap / +1% damage, 羽刃暴风 4 waves and max 6 triggers (betting-ootengu.ts);
//   · 玉藻前 300 KB AI by enemy count, 堕天 L5 chain at −20% (betting-tamamo.ts);
//   · 涂佛 soul: normal-attack turn end → allies +15% RES / damage, wearer +30% (soul/custom-effects-betting.ts);
//   · BASE mode: none of the kits answer.
// Run: node battle-lab/tests/betting-mechanics-17.ts
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { TurnType, EV, DamageType } = await import(R + "kernel/types.ts");
const { KAGEWANI, DEVOUR_ID, applyDevour } = await import(R + "compile/betting-kagewani.ts");
const { EBISU, carpOf } = await import(R + "compile/betting-ebisu.ts");
const { OOTENGU, HERO_ID, OOT_SHELTER_ID, heroStacks } = await import(R + "compile/betting-ootengu.ts");
const { TAMAMO } = await import(R + "compile/betting-tamamo.ts");
const { M11_KITS } = await import(R + "compile/betting-m11.ts");
const { M7_PATCHES, m7RuleSkill, m7Gate } = await import(R + "compile/betting-m7.ts");
const { bettingAiRuleOf, bettingKitSkillOf } = await import(R + "compile/betting-coverage.ts");
const { NURIBOTOKE_ID } = await import(R + "soul/custom-effects-betting.ts");

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };
const sec = (s: string) => console.log("\n" + s);

setSkillLevelMode("MAX");
const unit = (shikigamiId: number, hp: number, extra: any = {}, soulIds: number[] = []) => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds,
});
async function match(red: any[], blue: any[], seed = 1) {
  const A = await assembleGuessingMatch({ _meta: { title: "t17" }, red, blue } as any, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  b.rules.damageFloat = 0;
  await b.runStartup();
  const find = (charId: number, team = 0) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find };
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => { const s = sk(e, id); return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target)); };
const disp = (b: any, code: string, e: any, type = TurnType.NORMAL) => b.bus.dispatch(code, { actor: e, type }, e.id, e.teamId, (id: number) => b.teamOf(id));
const stacks = (e: any, id: string) => e.statuses.filter((s: any) => s.def.id === id).reduce((n: number, s: any) => n + s.stacks, 0);

sec("[0] Wiring");
{
  ok("betting-m11 lists 4 kits", M11_KITS.length === 4);
  ok("300: hand-written AI rule declared", !!bettingAiRuleOf(300));
  for (const id of ["375_02", "375_03", "268_01", "268_02", "268_03", "217_02", "217_03", "300_03"]) ok(`${id}: kit skill declared`, !!bettingKitSkillOf(id));
  ok("375_03 patch: 影缚 50%", M7_PATCHES["375_03"]?.patch?.controlRefs?.[0]?.probability === 50);
  ok("217_03 patch: generic 5% bar removed", Array.isArray(M7_PATCHES["217_03"]?.patch?.timeline) && M7_PATCHES["217_03"].patch.timeline.length === 0);
  ok("268_03 patch: compiled self-heal removed", Array.isArray(M7_PATCHES["268_03"]?.patch?.heal) && M7_PATCHES["268_03"].patch.heal.length === 0);
}

sec("[1] 影鳄: 影食 2 stacks → 30% ATK burst and 3% max-HP heal; 影缚 50% compiled");
{
  const { b, find } = await match([unit(375, 20000, { atk: 4000, efh: 500 })], [unit(220, 50000, { def: 0 })]);
  const k = find(375, 0), v = b.teams[1].members[0];
  ok("幕影盖地 IR: 影缚 probability 50", sk(k, "375_03").ir.controlRefs?.[0]?.probability === KAGEWANI.bindChance, String(sk(k, "375_03").ir.controlRefs?.[0]?.probability));
  b.rng.testHit = () => true;
  k.hp = k.maxHp * 0.5;
  await applyDevour(b, k, v, "影壳");
  ok("1st application: 1 stack", stacks(v, DEVOUR_ID) === 1, String(stacks(v, DEVOUR_ID)));
  const mark = b.trace.length, hp0 = k.hp;
  await applyDevour(b, k, v, "影壳");
  const burst = since(b, mark).find((t: any) => t.t === "DAMAGE" && t.src === k.id && t.dst === v.id);
  ok("2nd application: stacks consumed", stacks(v, DEVOUR_ID) === 0, String(stacks(v, DEVOUR_ID)));
  ok("burst base = 30% ATK", !!burst && Math.abs(burst.breakdown.base - k.prop("atk") * KAGEWANI.burstAtk) < 1, burst ? String(Math.round(burst.breakdown.base)) : "no burst");
  ok("L5 heal 3% max HP", Math.abs(k.hp - hp0 - k.maxHp * KAGEWANI.healMaxHp) < 2, `${Math.round(hp0)} → ${Math.round(k.hp)}`);
}

sec("[2] 惠比寿: 鲤鱼旗 summon, heal before ally turns, no recast, Carp turn onibi");
{
  const { b, find } = await match([unit(268, 20000, { spd: 150 }), unit(220, 20000)], [unit(220, 20000)]);
  const e = find(268, 0), ally = b.teams[0].members[1];
  b.teams[0].orbs.orb = 8;
  await cast(b, e, "268_03", b.teams[1].members[0]);
  const c = carpOf(b, e);
  ok("Carp summoned", !!c);
  ok("Carp max HP = 60% of Ebisu's", !!c && Math.abs(c.maxHp - e.base.hp * EBISU.carpHp) < 2, c ? `${Math.round(c.maxHp)} vs ${Math.round(e.base.hp * EBISU.carpHp)}` : "");
  ok("Carp SPD = 140% of Ebisu's", !!c && Math.abs(c.base.spd - 150 * EBISU.carpSpd) < 0.01, c ? String(c.base.spd) : "");
  ok("鲤鱼旗 refused while the Carp lives", m7Gate(b, e, sk(e, "268_03")) === "SUMMON_PRESENT");
  ok("no compiled self-heal on cast", e.hp === e.maxHp);
  ally.hp = ally.maxHp * 0.3;
  const hp0 = ally.hp;
  await disp(b, EV.TURN_START, ally);
  ok("ally turn start: heal 40% of the Carp's max HP", Math.abs(ally.hp - Math.min(ally.maxHp, hp0 + c.maxHp * EBISU.carpHeal)) < 2, `${Math.round(hp0)} → ${Math.round(ally.hp)}`);
  ok("L4 SPD aura on allies", ally.statuses.some((s: any) => s.def.id === "268_spd"));
  b.teams[0].orbs.orb = 2;
  await disp(b, EV.TURN_START, c);
  ok("Carp turn: +1 onibi (L5)", b.teams[0].orbs.current === 3, String(b.teams[0].orbs.current));
}

sec("[3] 大天狗: 庇护, 雄姿英发 (+1% damage, cap 80), 羽刃暴风 4 waves, max 6 triggers");
{
  const { b, find } = await match([unit(217, 30000, { atk: 4000 })], [unit(205, 90000), unit(205, 90000), unit(205, 90000)]);
  const o = find(217, 0);
  ok("庇护 at battle start", o.statuses.some((s: any) => s.def.id === OOT_SHELTER_ID));
  b.rng.testHit = () => false;   // isolate the storm's own triggers from the 50% passive
  const pos0 = b.timeline.get(o.id)?.pos ?? 0;
  const mark = b.trace.length;
  b.teams[0].orbs.orb = 8;
  await cast(b, o, "217_03", b.teams[1].members[0]);
  const hits = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === o.id && t.type === "NORMAL");
  ok("4 waves × 3 enemies = 12 hits", hits.length === OOTENGU.stormWaves * 3, String(hits.length));
  ok("each hit 75% ATK", hits.every((t: any) => Math.abs(t.breakdown.base - 4000 * 0.75) < 1), hits.map((t: any) => Math.round(t.breakdown.base)).join(","));
  ok("triggers capped at 6 stacks", heroStacks(o) === OOTENGU.triggerCap, String(heroStacks(o)));
  const shift = since(b, mark).find((t: any) => t.t === "TIMELINE_SHIFT" && t.id === o.id);
  ok("bar +30% (6 × 5%)", !!shift && Math.abs(shift.percent - 0.3) < 1e-9, shift ? String(shift.percent) : `no shift (pos ${pos0})`);
  ok("+1% damage per stack", Math.abs(o.prop("dmgDealtB") - 0.06) < 1e-9 || o.effects.some((x: any) => x.prop === "dmgDealtB" && Math.abs(x.value - 0.06) < 1e-9), String(o.prop("dmgDealtB")));
  b.rng.testHit = () => true;
  for (let i = 0; i < 100; i++) await b.damage(o, b.teams[1].members[0], 100, DamageType.NORMAL, 1, null);
  ok("cap 80 stacks", heroStacks(o) === OOTENGU.heroCap, String(heroStacks(o)));
}

sec("[4] 玉藻前: KB AI by enemy count, 堕天 L5 chain at −20%");
{
  const { b, find } = await match([unit(300, 30000, { atk: 4000 })], [unit(220, 2000, { def: 0 }), unit(220, 90000, { def: 0 })]);
  const t = find(300, 0);
  b.teams[0].orbs.orb = 8;
  const costOf = (s: any) => Number(s.cost) || 0;
  ok("≥2 enemies → 堕天", m7RuleSkill(b, t, costOf)?.skill?.ir?.id === "300_03");
  const mark = b.trace.length;
  await cast(b, t, "300_03", b.teams[1].members[0]);
  const chain = since(b, mark).find((x: any) => x.t === "SUBCAST" && x.ref === "300_02");
  ok("kill → free 狐火 at 80%", !!chain && Math.abs(chain.damageMul - (1 - TAMAMO.chainStep)) < 1e-9, chain ? String(chain.damageMul) : "no chain");
  const fox = since(b, mark).filter((x: any) => x.t === "DAMAGE" && x.src === t.id && x.dst === b.teams[1].members[1].id);
  ok("狐火 base = 389% × 0.8", fox.length >= 2 && Math.abs(fox[1].breakdown.base - 4000 * 3.89 * 0.8) < 1, fox[1] ? String(Math.round(fox[1].breakdown.base)) : "");
  ok("1 enemy → 狐火", m7RuleSkill(b, t, costOf)?.skill?.ir?.id === "300_02");
}

sec("[5] 涂佛: normal-attack turn end → allies +15% RES / damage, wearer double");
{
  const { b, find } = await match([unit(220, 20000, {}, [41, 41, 41, 41]), unit(205, 20000)], [unit(220, 20000)]);
  const w = b.teams[0].members[0], ally = b.teams[0].members[1];
  await disp(b, EV.TURN_START, w);
  await b.bus.dispatch(EV.SKILL_END, { battle: b, actor: w, skill: sk(w, "220_01"), target: b.teams[1].members[0], type: TurnType.NORMAL }, w.id, w.teamId, (id: number) => b.teamOf(id));
  await disp(b, EV.TURN_END, w);
  const sw = w.statuses.find((s: any) => s.def.id === NURIBOTOKE_ID), sa = ally.statuses.find((s: any) => s.def.id === NURIBOTOKE_ID);
  ok("ally buff +15% RES / damage", !!sa && sa.effects.some((x: any) => x.prop === "efr" && Math.abs(x.value - 0.15) < 1e-9) && sa.effects.some((x: any) => x.prop === "dmgDealtB" && Math.abs(x.value - 0.15) < 1e-9));
  ok("wearer buff doubled", !!sw && sw.effects.some((x: any) => x.prop === "efr" && Math.abs(x.value - 0.3) < 1e-9));
  ok("lasts 2 turns", !!sa && sa.remaining === 2, String(sa?.remaining));
}

sec("[6] BASE mode: no kit answers");
{
  setSkillLevelMode("BASE");
  const { b, find } = await match([unit(300, 30000)], [unit(220, 20000), unit(220, 20000)]);
  const t = find(300, 0);
  ok("BASE: no Tamamonomae rule", m7RuleSkill(b, t, (s: any) => Number(s.cost) || 0) === null);
  ok("BASE: no coverage", bettingAiRuleOf(300) === null && bettingKitSkillOf("217_03") === null);
  setSkillLevelMode("MAX");
}

console.log(`\nbetting-mechanics-17: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
