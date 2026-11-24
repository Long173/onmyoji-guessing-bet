// tests/betting-mechanics-15.ts — match-8 replay fixes (2026-11-24), MAX (betting) mode:
//   · referee = a speed-114 runner on the action-bar clock, +15% damage per pass, no healing cut (kernel/policies.ts
//     REFEREE_CLOCK_114, kernel/environment.ts envRefereeClock; REFEREE_15_10 kept to revert);
//   · heal crits through the kernel heal option (crit / onRequested / HEAL event crit), used by Kusa and Momo;
//   · 渺念萤草 种子: every removed seed heals 35% of her ATK (betting-kusa.ts);
//   · 桃花妖 花之馨息: crit main heal, splash = 30% of the REQUESTED heal (betting-momo.ts);
//   · 不知火 先机 barrier (+25 SPD) opens at the first turn start, not at t = 0 (betting-shiranui.ts);
//   · 天照 天晖 → highest initial panel ATK ally (betting-amaterasu.ts);
//   · 薰 鸮之守 settles 60% of the record at max level (Global up4).
// Run: node battle-lab/tests/betting-mechanics-15.ts
import path from "node:path";
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch, loadMatchFixture } = await import(R + "soul/guessing-match.ts");
const { EndgamePolicies, REFEREE_CLOCK_SPEED } = await import(R + "kernel/policies.ts");
const { DEFAULT_BETTING_ENDGAME, setBettingEndgame } = await import(R + "compile/betting-policies.ts");
const { refereeHealMultiplier } = await import(R + "kernel/environment.ts");
const { DamageType, TurnType, EV } = await import(R + "kernel/types.ts");
const { KUSA, seedsOf } = await import(R + "compile/betting-kusa.ts");
const { MOMO } = await import(R + "compile/betting-momo.ts");
const { RADIANCE_ID, radianceTarget } = await import(R + "compile/betting-amaterasu.ts");
const { KAORU } = await import(R + "compile/betting-kaoru.ts");
const { normalizeLineup, enShiki } = await import(new URL("../../matches/names.ts", import.meta.url).href);

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };
const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const M8 = path.join(ROOT, "matches", "2026-11-23h-lineup.en.json");
const M6 = path.join(ROOT, "matches", "2026-11-23f-lineup.en.json");

setSkillLevelMode("MAX");
const unit = (shikigamiId: number, hp: number, extra: any = {}) => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
async function match(red: any[], blue: any[], seed = 1) {
  const A = await assembleGuessingMatch({ _meta: { title: "t15" }, red, blue } as any, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  b.rules.damageFloat = 0;
  await b.runStartup();
  const find = (charId: number, team = 0) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find };
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => { const s = sk(e, id); return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target)); };
const setOrbs = (b: any, team: number, n: number) => { b.teams[team].orbs.orb = n; };
const names = (b: any) => {
  const nm = new Map<number, string>();
  b.teams.forEach((tm: any) => tm.members.forEach((e: any) => nm.set(e.id, enShiki(e.name))));
  return nm;
};

sec("[1] Referee preset: REFEREE_CLOCK_114 is the betting default, healing is not cut, the 8-action preset is kept");
{
  ok("default = REFEREE_CLOCK_114 (speed 114)", DEFAULT_BETTING_ENDGAME === "REFEREE_CLOCK_114" && REFEREE_CLOCK_SPEED === 114
    && EndgamePolicies.REFEREE_CLOCK_114.refereeSpeed === 114);
  ok("no healing cut at any round", [1, 5, 12].every(r => refereeHealMultiplier(EndgamePolicies.REFEREE_CLOCK_114, r) === 1));
  ok("evidence names the DMG Dealt Up reading and both replays", /DMG Dealt Up/.test(EndgamePolicies.REFEREE_CLOCK_114.evidence ?? "")
    && /m6/.test(EndgamePolicies.REFEREE_CLOCK_114.triggerEvidence ?? "") && /m8/.test(EndgamePolicies.REFEREE_CLOCK_114.triggerEvidence ?? ""));
  ok("revert preset REFEREE_15_10 still = 8 actions, −10% healing", EndgamePolicies.REFEREE_15_10.actionsPerRound === 8 && EndgamePolicies.REFEREE_15_10.healStep === 0.1);
}

sec("[2] Match 8: first-cycle order and referee rounds match the replay");
{
  const fx: any = normalizeLineup(await loadMatchFixture(M8));
  const A: any = await assembleGuessingMatch(fx, { seed: 100002, traceLevel: "FULL" });
  await A.battle.run();
  const nm = names(A.battle);
  const order: string[] = [];
  const turnsAtRound: number[] = [];
  for (const t of A.battle.trace as any[]) {
    if (t.t === "REFEREE_ROUND") turnsAtRound.push(t.turn);
    if (t.t === "SKILL_CAST" && (t.depth ?? 1) <= 1 && order.length < 10 && !turnsAtRound.length) order.push(nm.get(t.actor) ?? "?");
  }
  // Replay f387–f720: Kaoru, Mannendake, Hitotsume, Momo, Vampira, Yuki Onna, Shiranui, Amaterasu, Inaba, Kusa.
  const want = ["Kaoru", "Mannendake", "Hitotsume", "Momo", "Vampira", "Yuki Onna", "Shiranui", "Amaterasu", "Inaba Kaguya Hime", "Kusa Regrown"];
  ok("first cycle in the replay order (Upper Hand +25 SPD from Kaoru's first turn)", want.every((w, i) => order[i] === w), order.join(", "));
  ok("round 1 right after all 10 units acted once (turn 10)", turnsAtRound[0] === 10, turnsAtRound.join(","));
  ok("later rounds every 10–16 actions (replay 13, ~11, ~15)", turnsAtRound.length >= 3
    && turnsAtRound.slice(1, 4).every((t, i) => t - turnsAtRound[i] >= 10 && t - turnsAtRound[i] <= 16), turnsAtRound.join(","));
  const rr = (A.battle.trace as any[]).filter(t => t.t === "REFEREE_ROUND");
  ok("REFEREE_ROUND healing multiplier stays 1", rr.length > 0 && rr.every(t => t.healingMultiplier === 1));
}

sec("[3] Match 6: the same clock gives rounds after ~8 and ~16 actions (slow Red units held back)");
{
  const fx: any = normalizeLineup(await loadMatchFixture(M6));
  let okCount = 0;
  for (let s = 0; s < 4; s++) {
    const A: any = await assembleGuessingMatch(fx, { seed: 100000 + s, traceLevel: "FULL" });
    await A.battle.run();
    const r = (A.battle.trace as any[]).filter(t => t.t === "REFEREE_ROUND").map(t => t.turn);
    if (r[0] >= 7 && r[0] <= 9) okCount++;
  }
  ok("round 1 after 7–9 actions in every seed", okCount === 4, String(okCount));
}

sec("[4] Kernel heal crit option (MAX kits only): crit roll and onRequested");
{
  const { b } = await match([unit(201, 30000, { cri: 100, crid: 200 }), unit(201, 30000)], [unit(201, 900000)]);
  const [src, dst] = b.teams[0].members;
  dst.hp = dst.maxHp * 0.1;
  let req = -1, cm = -1;
  const got = await b.heal(src, dst, 1000, { crit: true, onRequested: (r: number, c: number) => { req = r; cm = c; } });
  ok("100% crit ⇒ ×crit damage (2.0)", near(got, 2000, 1e-9) && near(req, 2000, 1e-9) && cm === 2, got + " / " + req + " / " + cm);
  dst.hp = dst.maxHp - 500;
  const capped = await b.heal(src, dst, 1000, { crit: true, onRequested: (r: number) => { req = r; } });
  ok("onRequested reports the request before the max-HP cap", near(capped, 500, 1e-9) && near(req, 2000, 1e-9), capped + " / " + req);
  dst.hp = dst.maxHp * 0.1;
  const plain = await b.heal(src, dst, 1000, { crit: false });
  ok("crit: false ⇒ no crit", near(plain, 1000, 1e-9));
}

sec("[5] 渺念萤草 种子: EVERY removed seed heals 35% of Kusa's ATK and the heal can crit");
{
  const { b, find } = await match([unit(555, 30000, { cri: 100, crid: 216 }), unit(201, 60000)], [unit(201, 900000)], 2);
  const k = find(555), ally = b.teams[0].members[1], foe = b.teams[1].members[0];
  let mark = b.trace.length;
  await b.damage(foe, ally, 30000, DamageType.NORMAL, 1, null);   // big enough that the heal is not capped by missing HP
  await b.drainEvents();
  let heals = since(b, mark).filter(t => t.t === "HEAL" && t.dst === ally.id && t.src === k.id);
  ok("first hit: 2 → 1 seed AND a heal (match 8: 4067 on the first Red hit)", seedsOf(ally) === 1 && heals.length === 1, String(heals.length));
  ok("heal = 35% ATK × 2.16 crit (4067 = 1883 × 2.16)", near(heals[0]?.amount ?? 0, k.prop("atk") * KUSA.seedHeal * 2.16, 1e-6), String(heals[0]?.amount));
  mark = b.trace.length;
  await b.damage(foe, ally, 3000, DamageType.NORMAL, 1, null);
  await b.drainEvents();
  heals = since(b, mark).filter(t => t.t === "HEAL" && t.dst === ally.id && t.src === k.id);
  ok("second hit: last seed removed, heals again", seedsOf(ally) === 0 && heals.length === 1);
  mark = b.trace.length;
  await b.damage(foe, ally, 3000, DamageType.NORMAL, 1, null);
  await b.drainEvents();
  ok("no seed left ⇒ no heal", !since(b, mark).some(t => t.t === "HEAL" && t.src === k.id));
}

sec("[6] 桃花妖 花之馨息: crit main heal; splash = 30% of the REQUESTED heal (overheal included), splash does not crit");
{
  const { b, find } = await match([unit(200, 40000, { cri: 100, crid: 206 }), unit(201, 40000), unit(201, 40000)], [unit(201, 900000)], 3);
  const m = find(200), [, a1, a2] = b.teams[0].members;
  a1.hp = a1.maxHp * 0.4; a2.hp = a2.maxHp * 0.6; m.hp = m.maxHp * 0.95;   // a1 = lowest ratio ⇒ the main target
  const want = m.maxHp * MOMO.heal * 2.06;
  setOrbs(b, 0, 8);
  const h2 = a2.hp, mark = b.trace.length;
  await cast(b, m, "200_02", a1);
  const main = since(b, mark).find(t => t.t === "HEAL" && t.dst === a1.id && t.src === m.id);
  const split = since(b, mark).find(t => t.t === "HEAL_SPLASH");
  ok("main heal crits (×2.06)", main && near(main.amount, Math.min(want, a1.maxHp - a1.maxHp * 0.4), 1e-6), String(main?.amount));
  ok("splash = 30% of the requested crit heal", split && near(Number(split.each), want * MOMO.splash, 1e-3), String(split?.each) + " vs " + (want * MOMO.splash).toFixed(1));
  ok("the other ally gets exactly that (no splash crit)", near(a2.hp - h2, Math.min(want * MOMO.splash, a2.maxHp - h2), 1e-6), String(a2.hp - h2));
  // Capped main heal: the splash still uses the full request (replay: 21533 applied, 13307 = 30% × 44357 splashed).
  const b2 = (await match([unit(200, 40000, { cri: 100, crid: 206 }), unit(201, 40000), unit(201, 40000)], [unit(201, 900000)], 4)).b;
  const m2 = b2.teams[0].members[0], [, c1, c2] = b2.teams[0].members;
  c1.hp = c1.maxHp - 1000; c2.hp = c2.maxHp - 1; m2.hp = m2.maxHp;
  setOrbs(b2, 0, 8);
  const mk = b2.trace.length;
  await cast(b2, m2, "200_02", c1);
  const sp = since(b2, mk).find(t => t.t === "HEAL_SPLASH");
  ok("capped main heal: splash still 30% of the request", sp && near(Number(sp.each), m2.maxHp * MOMO.heal * 2.06 * MOMO.splash, 1e-3), String(sp?.each));
}

sec("[7] 天照: 天晖 → the ally with the highest initial panel ATK (match 8: Hitotsume, not Vampira)");
{
  const fx: any = normalizeLineup(await loadMatchFixture(M8));
  const A: any = await assembleGuessingMatch(fx, { seed: 100000 });
  await A.battle.runStartup();
  const nm = names(A.battle);
  const amat = A.battle.teams[0].members.find((e: any) => nm.get(e.id) === "Amaterasu");
  const t = radianceTarget(A.battle, amat);
  ok("radianceTarget = Hitotsume (panel 5726 > Vampira 5108)", nm.get(t?.id) === "Hitotsume", nm.get(t?.id));
  setOrbs(A.battle, 0, 8);
  const foe = A.battle.teams[1].members[0];
  await cast(A.battle, amat, "556_03", foe);
  ok("the cast puts 天晖 on Hitotsume", !!t?.hasStatus(RADIANCE_ID));
}

sec("[8] 薰 鸮之守: 60% of the record at max level (Global: 80% base, up2 70%, up4 60%)");
{
  ok("KAORU.owlLoss = 0.6", KAORU.owlLoss === 0.6);
}

sec("[9] BASE mode is untouched: no referee, no heal crit roll in kits");
{
  setSkillLevelMode("BASE");
  const fx: any = normalizeLineup(await loadMatchFixture(M8));
  const A: any = await assembleGuessingMatch(fx, { seed: 100000, traceLevel: "FULL" });
  await A.battle.run();
  ok("BASE: endgame NONE, no REFEREE_ROUND", A.battle.policies.endgame.id === "NONE" && !(A.battle.trace as any[]).some(t => t.t === "REFEREE_ROUND"));
  ok("BASE: environment has no referee clock", !A.battle.environment.refereeClock);
  setSkillLevelMode("MAX");
  setBettingEndgame(null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
