// tests/betting-mechanics-18.ts — match-12 kits (2026-11-24d), MAX (betting) mode:
//   · 寻森小鹿男 551 森之灵 marks → steal / push / triggers cap, 森之心 absorb + L3 heal, 森之契 scaling / 牵缠 / extra
//     targets, KB AI by 森之心 (betting-shishio551.ts);
//   · 晴思日和坊 580 彩虹能量 (30% of ally damage, cap), 120% heals before her turn, L4 block, 霹雳娃娃 echo, L4 heals ×4,
//     先机, misparsed dispel removed (betting-hiyoribou580.ts);
//   · 元兴寺 soul: own-turn control on an enemy → allies +5% damage per target, cap 40% (soul/custom-effects-betting.ts);
//   · BASE mode: none of the kits answer.
// Run: node battle-lab/tests/betting-mechanics-18.ts
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { TurnType, EV, DamageType } = await import(R + "kernel/types.ts");
const { StatusBook } = await import(R + "kernel/status.ts");
const { SHISHIO551, SPIRIT_ID, HEART_ID, ENTANGLE_ID, heartsOf, setHearts, markSpirit, spiritTrigger } = await import(R + "compile/betting-shishio551.ts");
const { HIYORI, THUNDER_ID, energyOf, storeEnergy, rainbowHeal } = await import(R + "compile/betting-hiyoribou580.ts");
const { M12_KITS } = await import(R + "compile/betting-m12.ts");
const { M7_PATCHES, m7RuleSkill } = await import(R + "compile/betting-m7.ts");
const { bettingAiRuleOf, bettingKitSkillOf } = await import(R + "compile/betting-coverage.ts");
const { BELL_HAUNT_ID } = await import(R + "soul/custom-effects-betting.ts");
const { dealDamage } = await import(R + "kernel/damage.ts");

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
  const A = await assembleGuessingMatch({ _meta: { title: "t18" }, red, blue } as any, { seed, traceLevel: "FULL" });
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
const costOf = (s: any) => Number(s.cost) || 0;

sec("[0] Wiring");
{
  ok("betting-m12 lists 2 kits", M12_KITS.length === 2);
  ok("551 / 580: hand-written AI rules declared", !!bettingAiRuleOf(551) && !!bettingAiRuleOf(580));
  for (const id of ["551_02", "551_03", "580_02", "580_03"]) ok(`${id}: kit skill declared`, !!bettingKitSkillOf(id));
  ok("580_03 patch: misparsed dispel removed", Array.isArray(M7_PATCHES["580_03"]?.patch?.purge) && M7_PATCHES["580_03"].patch.purge.length === 0);
}

sec("[1] 寻森小鹿男: 森之灵 mark, steal, push, 3-trigger cap; absorb into 森之心 + L3 heal");
{
  const { b, find } = await match([unit(551, 20000, { spd: 150 })], [unit(220, 50000, { atk: 4000 })]);
  const s = find(551, 0), v = b.teams[1].members[0];
  const atk0 = v.prop("atk"), mine0 = s.prop("atk");
  markSpirit(b, s, v);
  ok("森之灵 on the enemy", v.statuses.some((x: any) => x.def.id === SPIRIT_ID));
  ok("1st trigger", spiritTrigger(b, s, v));
  ok("steal 20% of the bearer's initial ATK", Math.abs(atk0 - v.prop("atk") - 0.2 * 4000) < 1, `${atk0} → ${v.prop("atk")}`);
  ok("he gains the same amount", Math.abs(s.prop("atk") - mine0 - 0.2 * 4000) < 1);
  ok("L4: +60 SPD", s.statuses.some((x: any) => x.def.id === "551_spd"));
  spiritTrigger(b, s, v); spiritTrigger(b, s, v);
  ok("4th trigger refused (3 per mark)", !spiritTrigger(b, s, v));
  ok("steal capped at 3 stacks", Math.abs(atk0 - v.prop("atk") - 3 * 0.2 * 4000) < 1);
  await disp(b, EV.TURN_END, v);
  ok("bearer turn end: −2 steal stacks", Math.abs(atk0 - v.prop("atk") - 0.2 * 4000) < 1, String(atk0 - v.prop("atk")));
  s.hp = s.maxHp * 0.5;
  const hp0 = s.hp;
  await disp(b, EV.TURN_START, s);
  ok("turn start: mark absorbed", !v.statuses.some((x: any) => x.def.id === SPIRIT_ID));
  ok("1 森之心 (+20% RES)", heartsOf(s) === 1 && s.statuses.find((x: any) => x.def.id === HEART_ID)?.effects?.[0]?.value === 0.2);
  ok("L3: +13% max HP per heart", Math.abs(s.hp - hp0 - s.maxHp * 0.13) < 2, `${Math.round(hp0)} → ${Math.round(s.hp)}`);
}

sec("[2] 寻森小鹿男: 森之契 +25%/heart, push / sure 牵缠 at 3 hearts, 2 extra targets; KB AI");
{
  const { b, find } = await match([unit(551, 20000, { atk: 4000 })], [unit(205, 90000, { def: 0 }), unit(205, 90000, { def: 0 }), unit(205, 90000, { def: 0 })]);
  const s = find(551, 0), [v1, v2, v3] = b.teams[1].members;
  b.teams[0].orbs.orb = 8;
  ok("no 森之心 → 林间息", m7RuleSkill(b, s, costOf)?.skill?.ir?.id === "551_01");
  setHearts(b, s, 3, "TEST");
  ok("森之心 → 森之契", m7RuleSkill(b, s, costOf)?.skill?.ir?.id === "551_03");
  b.timeline.shift(v1.id, -1);   // already at the end ⇒ the 40% push keeps it there
  const mark = b.trace.length;
  await cast(b, s, "551_03", v1);
  const dmg = since(b, mark).filter((x: any) => x.t === "DAMAGE" && x.src === s.id);
  ok("main hit base = (228% + 3×25%) ATK", !!dmg[0] && Math.abs(dmg[0].breakdown.base - 4000 * 3.03) < 1, dmg[0] ? String(Math.round(dmg[0].breakdown.base)) : "none");
  ok("2 extra random enemies hit", new Set(dmg.map((x: any) => x.dst)).size === 3, String(dmg.length));
  ok("3 hearts: 牵缠 lands", v1.statuses.some((x: any) => x.def.id === ENTANGLE_ID));
  ok("牵缠 is not an official control", !StatusBook.get(ENTANGLE_ID)?.preventsAction);
  ok("every hit enemy gets 森之灵", [v1, v2, v3].every((v: any) => v.statuses.some((x: any) => x.def.id === SPIRIT_ID)));
  const m2 = b.trace.length;
  await dealDamage(b, { source: v1, target: s, base: 5000, rate: 1, type: DamageType.NORMAL, skillTag: "t18" });
  const hit = since(b, m2).find((x: any) => x.t === "DAMAGE" && x.src === v1.id);
  ok("牵缠: the bearer deals 0 damage", !!hit && hit.applied === 0, hit ? String(hit.applied) : "none");
  for (const v of [v2, v3]) v.alive = false;
  ok("1 enemy alive → 林间息 (KB AI)", m7RuleSkill(b, s, costOf)?.skill?.ir?.id === "551_01");
}

sec("[3] 晴思日和坊: energy, own-turn heal, block, 霹雳娃娃 echo, L4 heals ×4, 先机");
{
  const { b, find } = await match([unit(580, 20000, { atk: 3000, spd: 150 }), unit(285, 20000, { atk: 6000 }), unit(205, 20000)], [unit(220, 90000, { def: 0 })]);
  const h = find(580, 0), chin = find(285, 0), z = b.teams[0].members[2], foe = b.teams[1].members[0];
  ok("先机: 霹雳娃娃 on the highest initial ATK ally", chin.statuses.some((x: any) => x.def.id === THUNDER_ID));
  ok("先机: +720% initial ATK energy", Math.abs(energyOf(h) - 7.2 * 3000) < 1, String(energyOf(h)));
  const e0 = energyOf(h);
  await dealDamage(b, { source: z, target: foe, base: 10000, rate: 1, type: DamageType.NORMAL, skillTag: "t18" });
  ok("ally damage → +30% energy", Math.abs(energyOf(h) - e0 - 0.3 * 10000) < 2, String(energyOf(h) - e0));
  storeEnergy(b, h, 1e9, "TEST");
  ok("energy capped at 2400% initial ATK", Math.abs(energyOf(h) - 24 * 3000) < 1);
  z.hp = z.maxHp * 0.5;
  const hz = z.hp, en = energyOf(h);
  await rainbowHeal(b, h);
  ok("heal 120% initial ATK, energy paid", Math.abs(z.hp - hz - 1.2 * 3000) < 1 && Math.abs(en - energyOf(h) - 1.2 * 3000) < 1);
  const m1 = b.trace.length, hc = chin.hp;
  await dealDamage(b, { source: foe, target: chin, base: 1000, rate: 1, type: DamageType.TRUE, skillTag: "t18" });
  ok("L4: top-ATK ally hit blocked by energy (≤60% initial ATK)", since(b, m1).some((x: any) => x.t === "PASSIVE_PROC" && /抵挡/.test(x.effect)) && chin.hp >= hc - 1);
  const m2 = b.trace.length;
  await dealDamage(b, { source: chin, target: foe, base: 2000, rate: 1, type: DamageType.INDIRECT, skillTag: "t18" });
  const hits = since(b, m2).filter((x: any) => x.t === "DAMAGE" && x.src === chin.id);
  ok("霹雳娃娃: 1 extra indirect hit, base = 15% of the damage dealt", hits.length === 2 && Math.abs(hits[1].breakdown.base - 0.15 * hits[0].applied) < 2, hits.map((x: any) => Math.round(x.breakdown?.base ?? 0) + "/" + Math.round(x.applied)).join(" "));
  await disp(b, EV.TURN_START, h);
  const m3 = b.trace.length;
  for (let i = 0; i < 6; i++) await dealDamage(b, { source: chin, target: foe, base: 100, rate: 1, type: DamageType.NORMAL, skillTag: "t18" });
  const l4 = since(b, m3).filter((x: any) => x.t === "PASSIVE_PROC" && /L4/.test(x.effect));
  ok("L4 heals: at most 4 per window", l4.length === HIYORI.l4Heals, String(l4.length));
  b.teams[0].orbs.orb = 8;
  ok("KB AI: 晴日华光", m7RuleSkill(b, h, costOf)?.skill?.ir?.id === "580_03");
}

sec("[4] 元兴寺: own-turn control on enemies → allies +5% per target, max 40%");
{
  const { b } = await match([unit(220, 20000, { efh: 500 }, [53, 53, 53, 53]), unit(205, 20000)], [unit(220, 20000), unit(220, 20000)]);
  const w = b.teams[0].members[0], ally = b.teams[0].members[1], [v1, v2] = b.teams[1].members;
  const stun = StatusBook.get("stun");
  await disp(b, EV.TURN_START, w);
  await b.withinResolution({ id: "SKILL:t18", type: "SKILL" }, async () => {
    for (const v of [v1, v2, v1]) {
      v.addStatus(stun, w.id, 1, 1, [], 1);
      await b.bus.dispatch(EV.STATUS_ADD, { battle: b, entity: v, status: "stun" }, v.id, v.teamId, (id: number) => b.teamOf(id));
    }
  });
  const st = ally.statuses.find((s: any) => s.def.id === BELL_HAUNT_ID);
  ok("2 targets → +10% damage (same target counted once)", !!st && Math.abs(st.effects[0].value - 0.1) < 1e-9, st ? String(st.effects[0].value) : "none");
  ok("lasts 2 turns", st?.remaining === 2);
  await disp(b, EV.ACTION_END, w);
  await b.withinResolution({ id: "SKILL:t18b", type: "SKILL" }, async () => {
    v2.addStatus(stun, w.id, 1, 1, [], 1);
    await b.bus.dispatch(EV.STATUS_ADD, { battle: b, entity: v2, status: "stun" }, v2.id, v2.teamId, (id: number) => b.teamOf(id));
  });
  ok("outside the wearer's turn: no stack", Math.abs(ally.statuses.find((s: any) => s.def.id === BELL_HAUNT_ID).effects[0].value - 0.1) < 1e-9);
}

sec("[5] BASE mode: no kit answers");
{
  setSkillLevelMode("BASE");
  const { b, find } = await match([unit(551, 30000), unit(580, 30000)], [unit(220, 20000), unit(220, 20000)]);
  ok("BASE: no Greenwarden rule", m7RuleSkill(b, find(551, 0), costOf) === null);
  ok("BASE: no Hiyoribou rule", m7RuleSkill(b, find(580, 0), costOf) === null);
  ok("BASE: no coverage", bettingAiRuleOf(551) === null && bettingKitSkillOf("580_03") === null);
  setSkillLevelMode("MAX");
}

console.log(`\nbetting-mechanics-18: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
