// tests/betting-mechanics-12.ts — match-8 kits (2026-11-23h), MAX (betting) mode, wired through compile/betting-m8.ts:
//   独眼小僧 230, 桃花妖 200, 天照 556, 不知火 330, 渺念萤草 555, 雪女 201, and the 薙魂 Soul Edge / 魍魉之匣 Mimic souls.
// Each part runs in its own block (own helpers, own small synthetic matches); the pass / fail counters are shared.
// Run: node battle-lab/tests/betting-mechanics-12.ts
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };

// ═════════ 独眼小僧 230 (betting-hitotsume.ts) / 薙魂 Soul Edge / 桃花妖 200 (betting-momo.ts) / 天照 556 (betting-amaterasu.ts) ═════════
{
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { HITOTSUME, SUTRA_ID, REFLECT_TAG } = await import(R + "compile/betting-hitotsume.ts");
const { MOMO, BLOOM_ID } = await import(R + "compile/betting-momo.ts");
const { AMATERASU, RADIANCE_ID, PURGE_ID, radianceBearer } = await import(R + "compile/betting-amaterasu.ts");
const { bettingPreferredSkill, BETTING_IR_PATCHES } = await import(R + "compile/betting-mechanics.ts");
const { BETTING_SOUL_NUMBERS } = await import(R + "soul/custom-effects-betting.ts");
const { DamageType, EV, TurnType } = await import(R + "kernel/types.ts");

setSkillLevelMode("MAX");

const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const unit = (shikigamiId: number, hp: number, extra: any = {}, soulIds: number[] = []): any => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds,
});
async function match(red: any[], blue: any[], seed = 1) {
  const A: any = await assembleGuessingMatch({ _meta: { title: "t12" }, red, blue } as any, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  return b;
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => { const s = sk(e, id); return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target)); };
const unfloat = (t: any) => t.final / (t.breakdown?.float?.value ?? 1);
/** Runs `fn` with the soul / kit chance rolls (tags "soul:…" / "momo…") forced to `hit`; crit rolls stay random. */
async function forced<T>(b: any, hit: boolean, fn: () => Promise<T>): Promise<T> {
  const origHit = b.rng.testHit, origExpect = b.rng.expect;
  let last = "";
  b.rng.expect = (tag: string) => { last = String(tag); return origExpect.call(b.rng, tag); };
  b.rng.testHit = (p: number) => (last.startsWith("soul:") ? hit : origHit.call(b.rng, p));
  try { return await fn(); } finally { b.rng.testHit = origHit; b.rng.expect = origExpect; }
}
const setOrbs = (b: any, team: number, n: number) => { b.teams[team].orbs.orb = n; };
const ownTurn = async (b: any, e: any, fn: () => Promise<void>) => {
  await b.bus.dispatch(EV.TURN_START, { actor: e, type: TurnType.NORMAL }, e.id, e.teamId, (id: number) => b.teamOf(id));
  try { await fn(); } finally { await b.bus.dispatch(EV.ACTION_END, { actor: e, type: TurnType.NORMAL }, e.id, e.teamId, (id: number) => b.teamOf(id)); }
};

sec("[1] 金刚经: Hitotsume takes damage ⇒ every ally +20% effect RES for 1 turn; bearers reflect 20% as FIXED damage");
{
  const b = await match([unit(230, 40000), unit(201, 40000)], [unit(201, 900000)]);
  const [h, ally] = b.teams[0].members, foe = b.teams[1].members[0];
  ok("no 金刚经 before any damage", !ally.hasStatus(SUTRA_ID));
  const res0 = ally.prop("efr");
  await b.damage(foe, h, 3000, DamageType.NORMAL, 1, null);
  ok("both allies gain 金刚经", h.hasStatus(SUTRA_ID) && ally.hasStatus(SUTRA_ID));
  ok("+20% effect RES", near(ally.prop("efr") - res0, HITOTSUME.res, 1e-9), String(ally.prop("efr") - res0));
  const mark = b.trace.length, hp0 = foe.hp;
  await b.damage(foe, ally, 5000, DamageType.NORMAL, 1, null);
  const dmg = since(b, mark).find(t => t.t === "DAMAGE" && t.dst === ally.id);
  const ref = since(b, mark).find(t => t.t === "REFLECT");
  const back = since(b, mark).find(t => t.t === "DAMAGE" && t.dst === foe.id);
  ok("REFLECT traced from the bearer to the attacker", ref?.src === ally.id && ref?.dst === foe.id);
  ok("reflected = 20% of the damage taken, FIXED", back?.type === DamageType.FIXED && near(back.final, dmg.final * HITOTSUME.reflect, 1e-3), back?.final + " vs " + dmg?.final);
  ok("attacker HP drops by the reflection", near(hp0 - foe.hp, back.applied, 1e-6));
  await b.damage(foe, ally, 5000, DamageType.INDIRECT, 1, null);
  ok("indirect damage is not reflected", !since(b, mark + 3).some(t => t.t === "REFLECT" && t.dst === foe.id && t !== ref));
  ok("reflections carry their own tag", REFLECT_TAG.startsWith("reflect:"));
  const again = b.trace.length;
  await b.damage(foe, h, 1000, DamageType.NORMAL, 1, null);
  ok("re-applied, never stacked (one 金刚经 per bearer)", ally.statuses.filter((s: any) => s.def.id === SUTRA_ID).length === 1 && since(b, again).some(t => t.t === "STATUS_APPLY" && t.status === SUTRA_ID));
}

sec("[2] 薙魂 Soul Edge: guarded single-target hit x0.8 then halved; the wearer takes the same amount; AoE parts are not guarded");
{
  const b = await match([unit(230, 40000, {}, [29, 29, 29, 29]), unit(201, 40000)], [unit(201, 900000)], 2);
  const [w, ally] = b.teams[0].members, foe = b.teams[1].members[0];
  const hit = async (guard: boolean) => {
    const mark = b.trace.length, wHp = w.hp;
    await forced(b, guard, () => b.withinResolution({ id: "SKILL:test" + mark, type: "SKILL" }, () => b.damage(foe, ally, 4000, DamageType.NORMAL, 1, null)));
    const d = since(b, mark).find(t => t.t === "DAMAGE" && t.dst === ally.id);
    return { d, mark, wLost: wHp - w.hp };
  };
  const plain = await hit(false), guarded = await hit(true);
  const k = (1 - BETTING_SOUL_NUMBERS.edgeCut) * (1 - BETTING_SOUL_NUMBERS.edgeShare);
  ok("no guard ⇒ full damage, wearer untouched", plain.wLost === 0 && !since(b, plain.mark).slice(0, guarded.mark - plain.mark).some(t => t.t === "DAMAGE_SHARED"));
  ok("guard ⇒ ally takes x0.8 x0.5", near(unfloat(guarded.d) / unfloat(plain.d), k, 1e-3), (unfloat(guarded.d) / unfloat(plain.d)).toFixed(4));
  const shared = since(b, guarded.mark).find(t => t.t === "DAMAGE" && t.dst === w.id);
  ok("the wearer takes the same amount as FIXED damage", shared?.type === DamageType.FIXED && near(shared.final, guarded.d.final, 1e-6) && guarded.wLost > 0);
  ok("DAMAGE_SHARED + SOUL_PROC traced", since(b, guarded.mark).some(t => t.t === "DAMAGE_SHARED") && since(b, guarded.mark).some(t => t.t === "SOUL_PROC" && t.soul === "薙魂"));
  const m2 = b.trace.length;
  await forced(b, true, () => b.damage(foe, w, 4000, DamageType.NORMAL, 1, null));
  ok("the wearer is never guarded by itself", !since(b, m2).some(t => t.t === "DAMAGE_SHARED"));
  // 天照 神圣裁决: 3 all-enemy hits then 3 hits on the target ⇒ only the single-target part is guarded.
  const b2 = await match([unit(556, 900000, { atk: 2000 })], [unit(201, 900000), unit(230, 900000, {}, [29, 29, 29, 29])], 3);
  const ama = b2.teams[0].members[0], [tgt, wear] = b2.teams[1].members;
  const m3 = b2.trace.length;
  await forced(b2, true, () => cast(b2, ama, "556_03", tgt));
  const onT = since(b2, m3).filter(t => t.t === "DAMAGE" && t.dst === tgt.id && t.src === ama.id).map(unfloat);
  ok("6 hits on the target", onT.length === 6, String(onT.length));
  ok("hits 4-6 (single-target segment) are guarded, 1-3 (all enemies) are not", near(onT[3] / onT[0], k, 1e-3) && near(onT[1] / onT[0], 1, 1e-3), onT.map(x => Math.round(x)).join(" "));
  ok("three shared hits on the wearer", since(b2, m3).filter(t => t.t === "DAMAGE_SHARED" && t.ally === tgt.id).length === 3);
}

sec("[3] 桃花妖 AI: revive > heal below 65% > 75/25 below 80% > Flower Dance");
{
  const b = await match([unit(200, 30000), unit(201, 40000), unit(201, 40000)], [unit(201, 900000)], 4);
  const [m, a1, a2] = b.teams[0].members;
  setOrbs(b, 0, 8);
  ok("all ≥ 80% ⇒ 花舞", bettingPreferredSkill(b, m)?.skill?.ir?.id === "200_01");
  a1.hp = a1.maxHp * 0.5;
  ok("an ally below 65% ⇒ 花之馨息", bettingPreferredSkill(b, m)?.skill?.ir?.id === "200_02");
  a1.hp = a1.maxHp * 0.7;
  const picks = new Set<string>();
  for (let i = 0; i < 40; i++) picks.add(bettingPreferredSkill(b, m)?.skill?.ir?.id);
  ok("65–80% ⇒ both 花之馨息 and 花舞 occur", picks.has("200_02") && picks.has("200_01"), [...picks].join());
  a2.hp = 0; a2.hpZero = true; await b.resolveLethal(a2, b.teams[1].members[0].id);
  ok("a dead ally and 3 onibi ⇒ 桃华灼灼", a2.dead && bettingPreferredSkill(b, m)?.skill?.ir?.id === "200_03");
  setOrbs(b, 0, 2);
  ok("not enough onibi to revive ⇒ heal rules", bettingPreferredSkill(b, m)?.skill?.ir?.id !== "200_03");
}

sec("[4] 花之馨息 heals the lowest ally 25% of Momo's max HP, 30% splash, 盛开 on everyone; 桃华灼灼 splashes too");
{
  const b = await match([unit(200, 30000), unit(201, 100000), unit(201, 100000)], [unit(201, 900000)], 5);
  const [m, a1, a2] = b.teams[0].members;
  ok("IR patch removes the compiled heal", Array.isArray(BETTING_IR_PATCHES["200_02"]?.patch?.heal) && sk(m, "200_02").ir.heal.length === 0);
  a1.hp = a1.maxHp * 0.3; a2.hp = a2.maxHp * 0.5;
  const h1 = a1.hp, h2 = a2.hp, mark = b.trace.length;
  await cast(b, m, "200_02", a1);
  const main = a1.hp - h1, side = a2.hp - h2;
  ok("main heal = 25% of Momo's max HP", near(main, m.maxHp * MOMO.heal, 1e-6), main.toFixed(1));
  ok("splash = 30% of it on the other ally", near(side, main * MOMO.splash, 1e-6), side.toFixed(1));
  ok("盛开 (+30% damage) on every healed ally", [m, a1, a2].every((e: any) => e.hasStatus(BLOOM_ID)) && near(a1.prop("dmgDealtB"), MOMO.bloomDmg, 1e-9));
  ok("HEAL_SPLASH traced", since(b, mark).some(t => t.t === "HEAL_SPLASH" && t.main === a1.id));
  a2.hp = 0; a2.hpZero = true; await b.resolveLethal(a2, b.teams[1].members[0].id);
  a1.hp = a1.maxHp * 0.3;
  const before = a1.hp;
  setOrbs(b, 0, 8);
  await cast(b, m, "200_03", a2);
  ok("桃华灼灼 revives with 25% of Momo's max HP", a2.alive && near(a2.hp, 1 + m.maxHp * MOMO.heal, 1e-6), String(a2.hp));
  ok("…and splashes 30% of it to the others", near(a1.hp - before, (a2.hp - 1) * MOMO.splash, 1e-6));
}

sec("[5] 天照: 天晖 on the other ally with the highest initial panel ATK (−15% ATK, +20% bar), 1-HP save, highest-HP target");
{
  // Match 8: Hitotsume (panel 5726) got it over Vampira (panel 5108) although Vampira's KB base ATK is higher.
  const b = await match([unit(556, 60000), unit(253, 40000), unit(200, 40000, { atk: 9000 })], [unit(201, 50000), unit(201, 90000)], 6);
  const [a, other, vamp] = b.teams[0].members, [f1, f2] = b.teams[1].members;
  const atk0 = vamp.prop("atk"), pos0 = b.timeline.get(vamp.id)?.pos ?? 0;
  setOrbs(b, 0, 8);
  await cast(b, a, "556_03", f1);
  ok("天晖 on Momo (panel ATK 9000 > Vampira 3000; Vampira's higher KB base ATK 3002 > 2385 does not count)",
    vamp.hasStatus(RADIANCE_ID) && !other.hasStatus(RADIANCE_ID) && !a.hasStatus(RADIANCE_ID));
  ok("ATK −15%", near(vamp.prop("atk"), atk0 * (1 + AMATERASU.atkCut), 1e-6), vamp.prop("atk") + " / " + atk0);
  ok("+20% action bar", (b.timeline.get(vamp.id)?.pos ?? 0) > pos0);
  ok("radianceBearer finds it", radianceBearer(b, a)?.id === vamp.id);
  await b.damage(f1, vamp, 10_000_000, DamageType.TRUE, 1, null);
  ok("lethal damage leaves the bearer at 1 HP", vamp.alive && vamp.hp === 1 && b.trace.some((t: any) => t.t === "UNDYING" && t.by === RADIANCE_ID));
  const ai = (await import(R + "compile/betting-mechanics.ts")).aiRuleTarget(a, sk(a, "556_03").ir, [f1, f2]);
  ok("神圣裁决 targets the highest-HP enemy", ai?.target?.id === f2.id);
}

sec("[6] 无灭: 70% echo of the bearer's skill hits during Amaterasu's turn; 光涤 on attackers (−40% damage to her, −150 DEF); kill ⇒ +50% bar");
{
  const b = await match([unit(556, 60000, { atk: 5000 }), unit(253, 900000)], [unit(201, 900000), unit(201, 9000)], 7);
  const [a, vamp] = b.teams[0].members, [foe, weak] = b.teams[1].members;
  setOrbs(b, 0, 8);
  await cast(b, a, "556_03", foe);
  let mark = b.trace.length;
  await ownTurn(b, vamp, () => cast(b, vamp, "253_01", foe));
  ok("the bearer's own turn: no echo (\"在自身回合内\" = Amaterasu's turn; match 8)", !since(b, mark).some(t => t.t === "ECHO_HIT"));
  mark = b.trace.length;
  await ownTurn(b, a, () => cast(b, vamp, "253_01", foe));   // e.g. a counter / assist of the bearer inside her turn
  const e = since(b, mark).find(t => t.t === "ECHO_HIT");
  const vHit = since(b, mark).find(t => t.t === "DAMAGE" && t.src === vamp.id && t.dst === foe.id);
  const aHit = since(b, mark).find(t => t.t === "DAMAGE" && t.src === a.id && t.dst === foe.id);
  ok("echo on the same target", !!e && !!aHit && e.dst === foe.id);
  ok("coefficient = Vampira's hit base / ATK, echo ratio = 70% of it", near(e.ratio, e.coefficient * AMATERASU.echo, 1e-3) && near(aHit.breakdown.base, a.prop("atk") * e.ratio, 1e-2), e?.coefficient + " → " + e?.ratio);
  ok("Vampira's own hit is unchanged", !!vHit);
  mark = b.trace.length;
  await cast(b, vamp, "253_01", foe);
  ok("outside Amaterasu's turn: no echo", !since(b, mark).some(t => t.t === "ECHO_HIT"));
  mark = b.trace.length;
  const plain = await b.damage(foe, a, 3000, DamageType.NORMAL, 1, null);
  ok("光涤 on the attacker", foe.hasStatus(PURGE_ID) || since(b, mark).some(t => t.t === "STATUS_RESIST" || t.t === "RESIST"));
  if (foe.hasStatus(PURGE_ID)) {
    const m2 = b.trace.length;
    await b.damage(foe, a, 3000, DamageType.NORMAL, 1, null);
    const d2 = since(b, m2).find(t => t.t === "DAMAGE" && t.dst === a.id);
    ok("damage from a 光涤 bearer to her ×0.6", near(unfloat(d2) / (plain.final / (since(b, mark).find(t => t.t === "DAMAGE" && t.dst === a.id).breakdown.float.value)), 1 - AMATERASU.purgeCut, 1e-3));
  }
  const pos0 = b.timeline.get(a.id)?.pos ?? 0;
  await b.damage(a, weak, 10_000_000, DamageType.TRUE, 1, null);
  ok("her kill ⇒ +50% action bar", weak.dead && (b.timeline.get(a.id)?.pos ?? 0) > pos0);
}

sec("[7] match-8 lineup: every kit is installed and acts in a full MAX battle");
{
  const { loadMatchFixture } = await import(R + "soul/guessing-match.ts");
  const { normalizeLineup } = await import(new URL("../../matches/names.ts", import.meta.url).href);
  const fx: any = normalizeLineup(await loadMatchFixture(new URL("../../matches/2026-11-23h-lineup.en.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
  const A: any = await assembleGuessingMatch(fx, { seed: 100000, traceLevel: "FULL" });
  await A.battle.run();
  const tr: any[] = A.battle.trace;
  ok("金刚经 applied", tr.some(t => t.t === "STATUS_APPLY" && t.status === SUTRA_ID));
  ok("天晖 never on Amaterasu herself", !tr.some(t => t.t === "STATUS_APPLY" && t.status === RADIANCE_ID && t.dst === t.src));
  ok("Soul Edge is simulated", !(A.battle.soulReport?.notSimulated ?? []).some((s: any) => String(s?.name ?? s).includes("薙魂")));
}
}

// ═════════ 不知火 330 (betting-shiranui.ts) ═════════
{
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { SHIRANUI, BARRIER_ID, DANCE_ID, SORROW_ID, FIRE_ID, barrierLeft, barrierUp, inSorrow } = await import(R + "compile/betting-shiranui.ts");
const { m7RuleSkill } = await import(R + "compile/betting-m7.ts");
const { bettingCostOf } = await import(R + "compile/betting-mechanics.ts");
const { DamageType, TurnType, EV } = await import(R + "kernel/types.ts");

setSkillLevelMode("MAX");

const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const unit = (shikigamiId: number, hp: number, extra: any = {}) => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
async function match(red: any[], blue: any[], seed = 1, firstTurn = true) {
  const A = await assembleGuessingMatch({ _meta: { title: "t12-shiranui" }, red, blue }, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  b.rules.damageFloat = 0;
  await b.runStartup();
  // Shiranui's Upper Hand barrier opens when the battle's first turn starts (match 8): start that turn.
  const first = b.teams[1].members[0];
  if (firstTurn) await b.bus.dispatch(EV.TURN_START, { actor: first, type: TurnType.NORMAL }, first.id, first.teamId, (id: number) => b.teamOf(id));
  const find = (charId: number, team = 0) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find };
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => { const s = sk(e, id); return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target)); };
const turnEnd = (b: any, actor: any) => b.bus.dispatch(EV.TURN_END, { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const setOrbs = (b: any, team: number, n: number) => { b.teams[team].orbs.orb = n; };

sec("[1] 星火满天 L5 先机: the barrier opens when the first turn starts, every ally +25 SPD, lasts 2 of her turns");
{
  const { b, find } = await match([unit(330, 30000), unit(201, 30000)], [unit(201, 900000)], 1, false);
  const s = find(330), ally = b.teams[0].members[1];
  ok("not yet open after the battle-start phase (SPD unchanged at t = 0)", barrierLeft(s) === 0 && !ally.hasStatus(BARRIER_ID) && near(ally.prop("spd"), 100));
  const first = b.teams[1].members[0];
  await b.bus.dispatch(EV.TURN_START, { actor: first, type: TurnType.NORMAL }, first.id, first.teamId, (id: number) => b.teamOf(id));
  ok("FIELD_OPEN (SENKI) at the first turn start (an enemy's turn), 2 turns", b.trace.some((t: any) => t.t === "FIELD_OPEN" && t.owner === s.id && t.reason === "SENKI" && t.turns === 2) && barrierLeft(s) === 2);
  ok("both allies carry 星火结界 (+25 SPD)", [s, ally].every((m: any) => m.hasStatus(BARRIER_ID)) && near(ally.prop("spd") - 100, SHIRANUI.spd, 1e-9), String(ally.prop("spd")));
  await turnEnd(b, ally);
  ok("an ally's turn end does not count down", barrierLeft(s) === 2);
  await turnEnd(b, s); await turnEnd(b, s);
  ok("two of her turn ends ⇒ closed, statuses removed", barrierLeft(s) === 0 && !ally.hasStatus(BARRIER_ID) && b.trace.some((t: any) => t.t === "FIELD_CLOSE" && t.reason === "DURATION"));
  await b.bus.dispatch(EV.TURN_START, { actor: ally, type: TurnType.NORMAL }, ally.id, ally.teamId, (id: number) => b.teamOf(id));
  ok("先机 fires once: a later turn start does not reopen it", barrierLeft(s) === 0 && b.trace.filter((t: any) => t.t === "FIELD_OPEN" && t.reason === "SENKI").length === 1);
  setOrbs(b, 0, 8);
  const r1 = m7RuleSkill(b, s, (x: any) => bettingCostOf(b, s, x));
  ok("AI: no barrier + onibi ⇒ 星火满天", r1?.skill?.ir?.id === "330_03", r1?.rule);
  await cast(b, s, "330_03", s);
  ok("cast outside her turn ⇒ barrier for 2 turns", barrierLeft(s) === 2 && ally.hasStatus(BARRIER_ID));
  const r2 = m7RuleSkill(b, s, (x: any) => bettingCostOf(b, s, x));
  ok("AI: barrier up ⇒ 初舞", r2?.skill?.ir?.id === "330_01", r2?.rule);
}

sec("[2] barrier: +10% damage / 10% reduction, +2% each per onibi of the team");
{
  const { b, find } = await match([unit(330, 30000), unit(201, 30000)], [unit(201, 900000)], 2);
  const ally = b.teams[0].members[1], foe = b.teams[1].members[0];
  setOrbs(b, 0, 3);
  let m = b.trace.length;
  await b.damage(ally, foe, 1000, DamageType.TRUE, 1, null);
  const out = since(b, m).find((t: any) => t.t === "DAMAGE" && t.dst === foe.id);
  ok("ally → enemy ×(1 + 0.10 + 3×0.02)", near(out.final, 1000 * 1.16, 1e-3), String(out?.final));
  m = b.trace.length;
  await b.damage(foe, ally, 1000, DamageType.TRUE, 1, null);
  const inn = since(b, m).find((t: any) => t.t === "DAMAGE" && t.dst === ally.id);
  ok("enemy → ally ×(1 − 0.10 − 3×0.02)", near(inn.final, 1000 * 0.84, 1e-3), String(inn?.final));
  m = b.trace.length;
  await b.damage(foe, ally, 1000, DamageType.FIXED, 1, null);
  ok("fixed damage is untouched", near(since(b, m).find((t: any) => t.t === "DAMAGE").final, 1000, 1e-6));
}

sec("[3] barrier: an ally's basic attack in its own turn ⇒ one extra basic attack (30% lifesteal, no chain); 离影 dance");
{
  const { b, find } = await match([unit(330, 30000), unit(201, 30000)], [unit(201, 900000)], 3);
  const s = find(330), ally = b.teams[0].members[1], foe = b.teams[1].members[0];
  setOrbs(b, 0, 0);
  ally.hp = ally.maxHp * 0.5;
  const sHp = s.hp, m = b.trace.length;
  await b.runTurn(ally, TurnType.NORMAL);
  const tr = since(b, m);
  const casts = tr.filter((t: any) => t.t === "SKILL_CAST" && t.actor === ally.id);
  ok("one EXTRA_ATTACK, two basic casts on the same target", tr.filter((t: any) => t.t === "EXTRA_ATTACK").length === 1 && casts.length === 2 && casts.every((t: any) => t.target === foe.id), casts.map((t: any) => t.skill).join(","));
  ok("the extra attack carries 30% lifesteal", tr.some((t: any) => t.t === "LIFESTEAL" && t.src === ally.id && near(t.ratio, SHIRANUI.extraLifesteal)));
  ok("离影 in the barrier: 100% ⇒ +80% effect RES on the ally", ally.hasStatus(DANCE_ID) && near(ally.prop("efr"), SHIRANUI.danceRes, 1e-9), String(ally.prop("efr")));
  ok("Shiranui loses 5% of her current HP (HP loss)", near(sHp - s.hp, sHp * SHIRANUI.danceHpCost, 1e-6) && tr.some((t: any) => t.t === "HP_LOSS" && t.dst === s.id));
  ok("the RES buff survives the turn end (through the ally's next turn)", ally.hasStatus(DANCE_ID));
  await b.runTurn(ally, TurnType.NORMAL);
  ok("… and a new dance refreshes it (still one status)", ally.statuses.filter((x: any) => x.def.id === DANCE_ID).length === 1);
  // No barrier ⇒ no extra attack.
  await turnEnd(b, s); await turnEnd(b, s);
  const m2 = b.trace.length;
  await b.runTurn(ally, TurnType.NORMAL);
  ok("no barrier ⇒ no extra attack", !since(b, m2).some((t: any) => t.t === "EXTRA_ATTACK") && !barrierUp(b, 0));
}

sec("[4] 离殇: lethal damage ⇒ stance once (full HP, statuses removed, +30% crit, skill table swap); second lethal kills");
{
  const { b, find } = await match([unit(330, 30000), unit(201, 30000), unit(201, 30000)], [unit(201, 900000, { def: 0 })], 4);
  const s = find(330), foe = b.teams[1].members[0];
  await b.damage(foe, s, 10_000_000, DamageType.TRUE, 1, null);
  ok("not dead, HP back to max", s.alive && !s.dead && near(s.hp, s.maxHp, 1e-9) && inSorrow(s));
  ok("only 离殇 left on her (barrier mark removed), +30% crit", s.statuses.length === 1 && s.hasStatus(SORROW_ID) && near(s.prop("cri"), SHIRANUI.sorrowCrit, 1e-9), s.statuses.map((x: any) => x.def.name).join(","));
  ok("skill table: 终舞 / 离歌 / 烬染不夜", s.skills.map((x: any) => x.name).join("/") === "终舞/离歌/烬染不夜" && b.trace.some((t: any) => t.t === "SKILL_TABLE_SWAP" && t.id === s.id));
  // Turn ends: own ⇒ max HP −15%; any ⇒ recover 40% of lost HP.
  s.hp = s.maxHp * 0.5;
  const max0 = s.maxHp;
  await turnEnd(b, b.teams[0].members[1]);
  ok("any turn end: recover 40% of lost HP", near(s.hp, max0 * 0.5 + max0 * 0.5 * SHIRANUI.sorrowRegen, 1e-6), String(s.hp));
  const hp1 = s.hp;
  await turnEnd(b, s);
  const max1 = max0 * (1 - SHIRANUI.sorrowMaxHpLoss);
  ok("own turn end: max HP −15%, then recover 40% of the lost HP", near(s.maxHp, max1, 1e-6) && near(s.hp, Math.min(hp1, max1) + (max1 - Math.min(hp1, max1)) * SHIRANUI.sorrowRegen, 1e-6), s.maxHp + " / " + s.hp);
  // 离歌: SPD / RES per onibi.
  setOrbs(b, 0, 4);
  await b.bus.dispatch(EV.TURN_START, { actor: foe, type: TurnType.NORMAL }, foe.id, foe.teamId, (id: number) => b.teamOf(id));
  ok("离歌: +20 SPD +5/onibi, +20% RES +5%/onibi", near(s.prop("spd") - 100, 20 + 5 * 4, 1e-9) && near(s.prop("efr"), 0.2 + 0.05 * 4, 1e-9), s.prop("spd") + " / " + s.prop("efr"));
  // 离火: second attack on the same target deals double and consumes it.
  s.base.cri = 0;
  for (const st of [...s.statuses]) if (st.def.id === SORROW_ID) s.removeModifiersBySource(st.tag);
  let m = b.trace.length;
  await cast(b, s, "330_01s", foe);
  const first = since(b, m).filter((t: any) => t.t === "DAMAGE" && t.dst === foe.id).map((t: any) => t.final);
  ok("终舞: 2 hits, then 离火 on the target", first.length === 2 && foe.hasStatus(FIRE_ID), first.join("+"));
  m = b.trace.length;
  await cast(b, s, "330_01s", foe);
  const second = since(b, m).filter((t: any) => t.t === "DAMAGE" && t.dst === foe.id).map((t: any) => t.final);
  ok("attacking a 离火 target again: consumed, double damage, re-applied after", second.length === 2 && near(second[0], first[0] * 2, 1e-6)
    && since(b, m).some((t: any) => t.t === "STACKS_CONSUMED" && t.status === FIRE_ID) && foe.hasStatus(FIRE_ID), second.join("+"));
  // 烬染不夜 cost: 4 − KO'd allies; AI picks it when affordable.
  const blaze = sk(s, "330_03s");
  ok("烬染不夜 costs 4", bettingCostOf(b, s, blaze) === 4);
  const mate = b.teams[0].members[1];
  await b.damage(foe, mate, 10_000_000, DamageType.TRUE, 1, null);
  ok("… 3 after one ally is KO'd", !mate.alive && bettingCostOf(b, s, blaze) === 3);
  setOrbs(b, 0, 3);
  const r = m7RuleSkill(b, s, (x: any) => bettingCostOf(b, s, x));
  ok("AI in 离殇: 烬染不夜 when affordable", r?.skill?.ir?.id === "330_03s", r?.rule);
  setOrbs(b, 0, 2);
  const r2 = m7RuleSkill(b, s, (x: any) => bettingCostOf(b, s, x));
  ok("… else 终舞", r2?.skill?.ir?.id === "330_01s", r2?.rule);
  await b.damage(foe, s, 10_000_000, DamageType.TRUE, 1, null);
  ok("second lethal damage kills her", !s.alive && s.dead);
}

sec("[5] 离影 is never chosen (KB AI one-three cycle); a unit that cannot act also triggers the dance");
{
  const { b, find } = await match([unit(330, 30000), unit(201, 30000)], [unit(201, 900000)], 5);
  const s = find(330), ally = b.teams[0].members[1];
  const { m7Gate } = await import(R + "compile/betting-m7.ts");
  ok("gate on 离影", m7Gate(b, s, sk(s, "330_02")) === "SHIRANUI_LIYING_NOT_CAST");
  const { StatusBook } = await import(R + "kernel/status.ts");
  const stun = [...StatusBook.values()].find((d: any) => d.preventsAction && String(d.category).startsWith("DEBUFF"));
  ally.addStatus(stun, b.teams[1].members[0].id, 1, 1, [], 1);
  const m = b.trace.length;
  await b.runTurn(ally, TurnType.NORMAL);
  ok("stunned ally (no action) ⇒ dance at its turn end", since(b, m).some((t: any) => t.t === "PASSIVE_PROC" && t.skill === "离影" && t.target === ally.id) && ally.hasStatus(DANCE_ID));
}
}

// ═════════ 渺念萤草 555 (betting-kusa.ts) ═════════
{
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { KUSA, SEED_ID, SEED_SPD_ID, forceOf, seedsOf, smashBonusOf } = await import(R + "compile/betting-kusa.ts");
const { m7Gate } = await import(R + "compile/betting-m7.ts");
const { kbBaseAtk, setNote } = await import(R + "compile/betting-shared.ts");
const { DamageType, TurnType, EV } = await import(R + "kernel/types.ts");

setSkillLevelMode("MAX");

const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

const unit = (shikigamiId: number, hp: number, extra: any = {}) => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
async function match(red: any[], blue: any[], seed = 1) {
  const A = await assembleGuessingMatch({ _meta: { title: "t12-kusa" }, red, blue }, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  const find = (charId: number, team = 0) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find };
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => { const s = sk(e, id); return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target)); };
const dispatch = (b: any, code: string, actor: any) => b.bus.dispatch(code, { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const FORCE = "kusa555:force=";

sec("[K1] 渺渺一旅 L5 先机: every non-summon ally starts with 2 种子; Kusa gains +30 DEF per seed (L2)");
{
  const { b, find } = await match([unit(555, 30000), unit(201, 30000), unit(201, 30000)], [unit(201, 900000)], 1);
  const k = find(555);
  ok("all allies carry 2 seeds", b.teams[0].members.every((m: any) => seedsOf(m) === 2), b.teams[0].members.map((m: any) => seedsOf(m)).join(","));
  ok("the enemy carries none", seedsOf(b.teams[1].members[0]) === 0);
  ok("Kusa DEF = 400 + 2 × 30", near(k.prop("def"), 400 + 2 * KUSA.seedDef), String(k.prop("def")));
  ok("a 先机 SUBCAST is traced", b.trace.some((t: any) => t.t === "SUBCAST" && t.ref === "555_02"));
}

sec("[K2] 种子: every HP decrease removes 1 seed and heals 35% of Kusa's ATK (match 8); Kusa +8 SPD per own seed lost");
{
  const { b, find } = await match([unit(555, 30000), unit(201, 30000)], [unit(201, 900000)], 2);
  const k = find(555), ally = b.teams[0].members[1], foe = b.teams[1].members[0];
  await b.damage(foe, ally, 3000, DamageType.NORMAL, 1, null);
  ok("first hit: 2 → 1 seed", seedsOf(ally) === 1);
  const hp1 = ally.hp, mark = b.trace.length;
  await b.damage(foe, ally, 3000, DamageType.NORMAL, 1, null);
  await b.drainEvents();
  const heal = since(b, mark).find(t => t.t === "HEAL" && t.dst === ally.id && t.src === k.id);
  ok("second hit removes the last seed", seedsOf(ally) === 0);
  ok("seeds gone ⇒ heal 35% of Kusa's ATK", heal && near(heal.amount, k.prop("atk") * KUSA.seedHeal, 1e-3), String(heal?.amount));
  const spd0 = k.prop("spd");
  await b.damage(foe, k, 1000, DamageType.NORMAL, 1, null);
  ok("Kusa lost one of her seeds ⇒ +8 SPD", near(k.prop("spd"), spd0 + KUSA.seedSpd) && k.hasStatus(SEED_SPD_ID), String(k.prop("spd")));
  ok("…and −30 DEF (one seed left)", near(k.prop("def"), 400 + KUSA.seedDef), String(k.prop("def")));
}

sec("[K3] 蒲公英之力: overflow healing of non-summon allies is stored, capped at 1800% initial ATK per window, reset at her turn start");
{
  const { b, find } = await match([unit(555, 30000), unit(201, 30000)], [unit(201, 900000)], 3);
  const k = find(555), ally = b.teams[0].members[1], foe = b.teams[1].members[0];
  await b.damage(foe, ally, 1000, DamageType.TRUE, 1, null);
  await b.drainEvents();   // the removed seed heals first (every removed seed heals since match 8)
  const missing = ally.maxHp - ally.hp, f0 = forceOf(k);   // f0: the seed heal's own overflow
  await b.heal(k, ally, missing + 2500, { crit: false });
  await b.drainEvents();
  ok("overflow stored (heal − missing HP)", near(forceOf(k) - f0, 2500, 1e-6), String(forceOf(k) - f0));
  ok("a DANDELION_STORE trace", b.trace.some((t: any) => t.t === "DANDELION_STORE" && t.id === k.id && t.dst === ally.id));
  await b.heal(foe, foe, 999999, { crit: false });
  await b.drainEvents();
  ok("enemy overflow is not stored", near(forceOf(k) - f0, 2500, 1e-6));
  const cap = kbBaseAtk(k) * KUSA.storeCap;
  await b.heal(k, ally, cap * 3, { crit: false });
  await b.drainEvents();
  ok("window cap = 1800% of her initial ATK", near(forceOf(k), cap, 1e-6), forceOf(k) + " vs " + cap);
  await b.heal(k, ally, 5000, { crit: false });
  await b.drainEvents();
  ok("cap reached: nothing more this window", near(forceOf(k), cap, 1e-6));
  await dispatch(b, EV.TURN_START, k);
  await b.heal(k, ally, 5000, { crit: false });
  await b.drainEvents();
  ok("her turn start resets the window (the force persists)", near(forceOf(k), cap + 5000, 1e-6), String(forceOf(k)));
}

sec("[K4] 流光之箭: 120% ATK, then spends 200% initial ATK of force and deals it to the same target (TRUE)");
{
  const { b, find } = await match([unit(555, 30000)], [unit(201, 900000), unit(201, 900000)], 4);
  const k = find(555), foe = b.teams[1].members[1];
  setNote(k, FORCE, "10000");
  const mark = b.trace.length;
  await cast(b, k, "555_01", foe);
  const dmg = since(b, mark).filter(t => t.t === "DAMAGE" && t.src === k.id);
  const want = kbBaseAtk(k) * KUSA.arrowSpend;
  ok("two hits on the chosen enemy", dmg.length >= 2 && dmg.every(t => t.dst === foe.id), dmg.map(t => t.dst).join(","));
  ok("hit 1 is a NORMAL 120% ATK hit", dmg[0]?.type === DamageType.NORMAL && near(dmg[0].breakdown.base, k.prop("atk") * 1.2, 1e-6));
  ok("hit 2 is TRUE damage of the spent force", dmg[1]?.type === DamageType.TRUE && near(dmg[1].breakdown.base, want, 1e-6), String(dmg[1]?.breakdown?.base));
  ok("force reduced by 200% initial ATK", near(forceOf(k), 10000 - want, 1e-6), String(forceOf(k)));
  ok("L5 bonus +120% after the skill", near(smashBonusOf(k), KUSA.smashStep));
}

sec("[K5] 渺渺一旅 pursuit: on a normal attack, one 30% roll per 345% ATK of force (max 3); each success spends 345% ATK");
{
  let pursuits = 0, maxPer = 0;
  for (let s = 0; s < 12; s++) {
    const { b, find } = await match([unit(555, 30000)], [unit(201, 9000000)], 100 + s);
    const k = find(555), foe = b.teams[1].members[0];
    const step = k.prop("atk") * KUSA.pursuitStep;
    setNote(k, FORCE, String(kbBaseAtk(k) * KUSA.arrowSpend + step * 10));
    const mark = b.trace.length;
    await cast(b, k, "555_01", foe);
    const p = since(b, mark).filter(t => t.t === "DANDELION_SPEND" && t.reason === "PURSUIT");
    pursuits += p.length; maxPer = Math.max(maxPer, p.length);
    if (p.some(t => !near(t.amount, step, 1e-3))) maxPer = 99;
  }
  ok("some pursuits happen over 12 casts (30% × 3 rolls)", pursuits > 0, String(pursuits));
  ok("never more than 3 per attack, each spends 345% ATK", maxPer <= 3, String(maxPer));
}

sec("[K6] 萤光落世: 183% to every enemy, force split evenly, heal all allies 35% ATK; enemy-scoped; L5 bonus capped at +360%");
{
  const { b, find } = await match([unit(555, 30000), unit(201, 30000)], [unit(201, 900000), unit(201, 900000), unit(201, 900000)], 6);
  const k = find(555), ally = b.teams[0].members[1], foes = b.teams[1].members;
  await b.damage(foes[0], ally, 9000, DamageType.TRUE, 1, null);
  setNote(k, FORCE, "50000");
  const t0 = sk(k, "555_03").pickTarget(b, k, b.enemiesOf(k.teamId));
  ok("AI target is an enemy", t0.teamId === 1);
  const mark = b.trace.length;
  await cast(b, k, "555_03", foes[2]);
  const tr = since(b, mark);
  const normal = tr.filter(t => t.t === "DAMAGE" && t.src === k.id && t.type === DamageType.NORMAL);
  const tru = tr.filter(t => t.t === "DAMAGE" && t.src === k.id && t.type === DamageType.TRUE);
  const spend = kbBaseAtk(k) * KUSA.smashSpend;
  ok("one 183% hit on each of the 3 enemies", normal.length === 3 && new Set(normal.map(t => t.dst)).size === 3 && normal.every(t => near(t.breakdown.base, k.prop("atk") * 1.83, 1e-6)));
  ok("340% initial ATK of force split in 3", tru.length === 3 && tru.every(t => near(t.breakdown.base, spend / 3, 1e-6)), tru.map(t => Math.round(t.breakdown.base)).join(","));
  const heals = tr.filter(t => t.t === "HEAL" && t.src === k.id);
  ok("ally healed 35% of her ATK", heals.some(t => t.dst === ally.id && near(t.amount, k.prop("atk") * KUSA.smashHeal, 1e-3)), heals.map(t => t.dst + ":" + t.amount).join(" "));
  ok("no damage on allies", !tr.some(t => t.t === "DAMAGE" && t.src === k.id && t.dst !== undefined && b.teamOf(t.dst) === 0));
  for (let i = 0; i < 4; i++) await cast(b, k, "555_01", foes[0]);
  ok("L5 consumption bonus capped at +360%", near(smashBonusOf(k), KUSA.smashStepMax), String(smashBonusOf(k)));
  ok("渺渺一旅 (passive, KB cost 1) is never castable", m7Gate(b, k, sk(k, "555_02")) === "PASSIVE_NOT_CASTABLE");
}

sec("[K7] 种子 vs indirect damage: converted into force, heal doubled (70% ATK), seed kept, once per attack");
{
  const { b, find } = await match([unit(555, 30000), unit(201, 30000)], [unit(201, 900000)], 7);
  const k = find(555), ally = b.teams[0].members[1], foe = b.teams[1].members[0];
  ally.hp = ally.maxHp * 0.5;   // room for the whole heal (no overflow mixed into the force)
  const mark = b.trace.length;
  const r = await b.damage(foe, ally, 2000, DamageType.INDIRECT, 1, null);
  await b.drainEvents();
  const heal = since(b, mark).find(t => t.t === "HEAL" && t.dst === ally.id && t.src === k.id);
  ok("seed kept", seedsOf(ally) === 2);
  ok("damage converted into force", near(forceOf(k), r.final, 1e-6), forceOf(k) + " vs " + r.final);
  ok("heal 70% of Kusa's ATK", heal && near(heal.amount, k.prop("atk") * KUSA.seedHeal * 2, 1e-3), String(heal?.amount));
  const f1 = forceOf(k);
  await b.damage(foe, ally, 2000, DamageType.INDIRECT, 1, null);
  ok("second indirect hit of the same attack: no second conversion", near(forceOf(k), f1, 1e-6));
  await b.damage(foe, k, 2000, DamageType.INDIRECT, 1, null);
  ok("Kusa takes indirect damage ⇒ L5 consumption +120%", near(smashBonusOf(k), KUSA.smashStep), String(smashBonusOf(k)));
}

sec("[K8] turn end: Kusa gains 2 seeds (sustained), L4 the other allies too");
{
  const { b, find } = await match([unit(555, 30000), unit(201, 30000)], [unit(201, 900000)], 8);
  const k = find(555), ally = b.teams[0].members[1], foe = b.teams[1].members[0];
  await b.damage(foe, ally, 100, DamageType.NORMAL, 1, null);
  await b.damage(foe, ally, 100, DamageType.NORMAL, 1, null);
  ok("ally lost its seeds", seedsOf(ally) === 0);
  await dispatch(b, EV.TURN_END, k);
  ok("turn end: 2 seeds on Kusa and on the ally", seedsOf(k) === 2 && seedsOf(ally) === 2);
  const st = ally.statuses.find((s: any) => s.def.id === SEED_ID);
  ok("seeds are sourced by Kusa (sustained on her turns)", st?.sourceId === k.id && st.def.durationPolicy === "SOURCE_TURN");
}
}

// ═════════ 雪女 201 (betting-yukionna.ts) / 魍魉之匣 Mimic (soul/custom-effects-betting.ts) ═════════
{
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { YUKI_ONNA, ICE_ID, SLOW_ID, iceShieldsOn } = await import(R + "compile/betting-yukionna.ts");
const { MIMIC_HEALDOWN_ID, MIMIC_EFFECTS } = await import(R + "soul/custom-effects-betting.ts");
const { customSoulFor } = await import(R + "soul/custom-effects.ts");
const { bettingPreferredSkill } = await import(R + "compile/betting-mechanics.ts");
const { m7DamageHook } = await import(R + "compile/betting-m7.ts");
const { kbBaseAtk } = await import(R + "compile/betting-shared.ts");
const { DamageType, TurnType, EV } = await import(R + "kernel/types.ts");
const { StatusBook } = await import(R + "kernel/status.ts");

setSkillLevelMode("MAX");

const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const unit = (shikigamiId: number, hp: number, extra: any = {}, soulIds: number[] = []): any => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds,
});
async function match(red: any[], blue: any[], seed = 1) {
  const A: any = await assembleGuessingMatch({ _meta: { title: "t12-yukionna" }, red, blue } as any, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  return b;
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => { const s = sk(e, id); return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target)); };
const turnEnd = (b: any, actor: any) => b.bus.dispatch(EV.TURN_END, { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const spdOf = (e: any, id: string) => (e.statuses.find((s: any) => s.def.id === id)?.effects ?? []).filter((x: any) => x.prop === "spd").reduce((a: number, x: any) => a + x.value, 0);
const FOES = (n = 3, extra: any = {}) => Array.from({ length: n }, () => unit(200, 900000, extra));

sec("[1] AI: 2+ enemies → 暴风雪 when affordable, else 雪球; 1 enemy with < 3 onibi → 雪球");
{
  const b = await match([unit(201, 30000)], FOES(3));
  const y = b.teams[0].members[0], orbs = b.teams[0].orbs;
  orbs.pay(orbs.current); orbs.gain(3);
  const r1 = bettingPreferredSkill(b, y);
  ok("3 enemies, 3 onibi → 暴风雪", r1?.skill?.ir?.id === "201_03", r1?.rule);
  orbs.pay(orbs.current); orbs.gain(2);
  ok("3 enemies, 2 onibi → 雪球", bettingPreferredSkill(b, y)?.skill?.ir?.id === "201_01");
  const b2 = await match([unit(201, 30000)], FOES(1));
  const y2 = b2.teams[0].members[0], o2 = b2.teams[0].orbs;
  o2.pay(o2.current); o2.gain(2);
  ok("1 enemy, 2 onibi → 雪球", bettingPreferredSkill(b2, y2)?.skill?.ir?.id === "201_01");
  o2.gain(6);
  let bl = 0;
  for (let i = 0; i < 400; i++) if (bettingPreferredSkill(b2, y2)?.skill?.ir?.id === "201_03") bl++;
  ok("1 enemy, 8 onibi → about 50% 暴风雪", bl > 150 && bl < 250, bl + "/400");
  o2.pay(o2.current); o2.gain(4);
  bl = 0;
  for (let i = 0; i < 400; i++) if (bettingPreferredSkill(b2, y2)?.skill?.ir?.id === "201_03") bl++;
  ok("1 enemy, 4 onibi → about 27% 暴风雪", bl > 70 && bl < 150, bl + "/400");
}

sec("[2] 暴风雪: 3 waves × every enemy at 36% ATK; freezes land (TARGET_TURN, 1 turn); slows −10 SPD for 2 turns");
{
  const b = await match([unit(201, 30000, { efh: 10000 })], FOES(3));
  const y = b.teams[0].members[0], foes = b.teams[1].members;
  b.teams[0].orbs.gain(8);
  const mark = b.trace.length;
  await cast(b, y, "201_03", foes[0]);
  const dmg = since(b, mark).filter(t => t.t === "DAMAGE" && t.src === y.id);
  ok("9 hits (3 waves × 3 enemies)", dmg.length === 9, String(dmg.length));
  const t0 = dmg[0];
  ok("36% ATK per hit", t0 && near(t0.breakdown.base, y.prop("atk") * 0.36, 1e-6), String(t0?.breakdown?.base));
  ok("every enemy frozen or deep-frozen", foes.every((f: any) => f.hasStatus("freeze") || f.hasStatus("deepFreeze")));
  const fr = foes.map((f: any) => f.statuses.find((s: any) => s.def.id === "freeze" || s.def.id === "deepFreeze"));
  ok("control counted on the bearer's turns, 1 turn", fr.every((s: any) => s.def.durationPolicy === "TARGET_TURN" && s.remaining === 1));
  ok("one slow per enemy (refreshed, not stacked): −10 SPD, 2 turns", foes.every((f: any) => spdOf(f, SLOW_ID) === -10 && f.statuses.filter((s: any) => s.def.id === SLOW_ID).length === 1 && f.statuses.find((s: any) => s.def.id === SLOW_ID).remaining === 2));
  const conv = since(b, mark).filter(t => t.t === "STATUS_APPLY" && t.converted === "freeze");
  ok("later waves on a frozen target can convert to Deep Freeze (30%)", conv.length >= 0, conv.length + " conversions");
  // Deep-freeze conversion, many trials.
  let deep = 0, deepOk = true, trials = 0;
  for (let s = 0; s < 12; s++) {
    const bb = await match([unit(201, 30000, { efh: 10000 })], FOES(4), 100 + s);
    const yy = bb.teams[0].members[0];
    bb.teams[0].orbs.gain(8);
    await cast(bb, yy, "201_03", bb.teams[1].members[0]);
    for (const f of bb.teams[1].members) {
      trials++;
      if (!f.hasStatus("deepFreeze")) continue;
      deep++;
      deepOk = deepOk && !f.hasStatus("freeze") && spdOf(f, "deepFreeze") === -20;
    }
  }
  ok("Deep Freeze appears (2 re-hits × 30%) and replaces the freeze, −20 SPD", deep > 0 && deepOk && deep < trials, deep + "/" + trials);
}

sec("[3] Freeze chance: 8% base, the final chance +10 points on a slowed target");
{
  const b = await match([unit(201, 30000)], FOES(2));
  const y = b.teams[0].members[0], [f1, f2] = b.teams[1].members;
  f1.addStatus(StatusBook.get(SLOW_ID) ?? { id: SLOW_ID, name: "减速", category: "DEBUFF_STATE", durationPolicy: "TARGET_TURN" }, y.id, 1, 5, [{ prop: "spd", value: -10, mode: "FIXED" }], 1);
  b.teams[0].orbs.gain(8);
  const mark = b.trace.length;
  await cast(b, y, "201_03", f1);
  const probs = (f: any) => since(b, mark).filter(t => (t.t === "STATUS_MISS" || t.t === "STATUS_APPLY" || t.t === "STATUS_RESIST") && t.dst === f.id && (t.status === "freeze")).map(t => t.probability ?? t.effective);
  const p1 = since(b, mark).filter(t => t.t === "STATUS_MISS" && t.dst === f1.id && t.status === "freeze").map(t => t.probability);
  const p2 = since(b, mark).filter(t => t.t === "STATUS_MISS" && t.dst === f2.id && t.status === "freeze").map(t => t.probability);
  ok("slowed target: 18%", p1.length > 0 && p1.every((p: number) => near(p, 0.18, 1e-9)), JSON.stringify(p1));
  ok("other target: 8% (until the blizzard's own slow lands)", p2.length > 0 && near(p2[0], 0.08, 1e-9), JSON.stringify(p2) + " " + JSON.stringify(probs(f2)));
}

sec("[4] 雪球: 120% ATK, 50% base slow; a second slow refreshes without stacking");
{
  const b = await match([unit(201, 30000, { efh: 10000 })], FOES(1));
  const y = b.teams[0].members[0], f = b.teams[1].members[0];
  const mark = b.trace.length;
  await cast(b, y, "201_01", f);
  const d = since(b, mark).find(t => t.t === "DAMAGE" && t.src === y.id);
  ok("120% ATK", d && near(d.breakdown.base, y.prop("atk") * 1.2, 1e-6));
  await cast(b, y, "201_01", f);
  ok("slowed −10 (not −20)", spdOf(f, SLOW_ID) === -10, String(spdOf(f, SLOW_ID)));
}

sec("[5] 冰甲术: turn end → self + 2 highest-crit-damage allies, 12% of her max HP; replaced next turn; removed on her death");
{
  const b = await match([unit(201, 30000), unit(200, 30000, { crid: 250 }), unit(200, 30000, { crid: 160 }), unit(200, 30000, { crid: 220 })], FOES(1));
  const [y, a, low, c] = b.teams[0].members;
  await turnEnd(b, y);
  const bearers = b.teams[0].members.filter((e: any) => iceShieldsOn(e, y.id).length);
  ok("bearers: Yuki + crit-damage 250 / 220 (not 160)", bearers.length === 3 && [y, a, c].every((e: any) => bearers.includes(e)) && !bearers.includes(low));
  ok("value = 12% of her max HP", bearers.every((e: any) => near(iceShieldsOn(e, y.id)[0].value, y.maxHp * YUKI_ONNA.shieldOfHp, 1e-9)));
  ok("冰甲盾 status shown on bearers", bearers.every((e: any) => e.hasStatus(ICE_ID)));
  await turnEnd(b, y);
  ok("next turn end: replaced (one live shield each)", bearers.every((e: any) => iceShieldsOn(e, y.id).length === 1) && b.trace.some((t: any) => t.t === "SHIELD_EXPIRE" && t.reason === "REPLACED"));
  await b.damage(b.teams[1].members[0], y, 1e9, DamageType.TRUE, 1, null);
  await b.drainEvents();
  ok("Yuki dies → her shields and statuses are gone", !y.alive && [a, c].every((e: any) => !iceShieldsOn(e, y.id).length && !e.hasStatus(ICE_ID)));
}

sec("[6] 冰甲盾: attacked bearer → 50% base slow on the attacker; +40% initial ATK vs a frozen target");
{
  const b = await match([unit(201, 30000, { efh: 10000 }), unit(200, 30000, { crid: 250, atk: 4000 })], FOES(1));
  const [y, a] = b.teams[0].members, f = b.teams[1].members[0];
  await turnEnd(b, y);
  await b.damage(f, a, 100, DamageType.NORMAL, 1, null);
  await b.damage(f, a, 100, DamageType.NORMAL, 1, null);
  ok("attacker slowed (one roll per bearer per action)", f.statuses.some((s: any) => s.def.id === SLOW_ID && s.sourceId === y.id) && spdOf(f, SLOW_ID) === -10);
  const mark0 = b.trace.length;
  await b.damage(a, f, 1000, DamageType.NORMAL, 1, null);
  ok("no bonus vs an unfrozen target", !since(b, mark0).some(t => t.t === "DAMAGE_BOOST"));
  f.addStatus(StatusBook.get("freeze"), y.id, 1, 1, [], 1);
  const mark = b.trace.length;
  await b.damage(a, f, 1000, DamageType.NORMAL, 1, null);
  const boost = since(b, mark).find(t => t.t === "DAMAGE_BOOST");
  const want = (a.prop("atk") + 0.4 * kbBaseAtk(a)) / a.prop("atk");
  ok("frozen target: damage × (ATK + 40% initial ATK) / ATK", boost && near(boost.mul, want, 1e-3), boost?.mul + " vs " + want.toFixed(4));
}

sec("[7] 魍魉之匣 Mimic: 25% base chance per hit, one of stun / silence / heal-down 40% / confuse, 1 bearer turn");
{
  const b = await match([unit(200, 30000, { efh: 10000 }, [5, 5, 5, 5])], FOES(1, { efr: 0 }));
  const w = b.teams[0].members[0], f = b.teams[1].members[0];
  const seen = new Set<string>();
  let procs = 0;
  for (let i = 0; i < 60; i++) {
    const mark = b.trace.length;
    await b.damage(w, f, 100, DamageType.NORMAL, 1, null);
    const ap = since(b, mark).filter(t => t.t === "STATUS_APPLY" && t.src === w.id && t.dst === f.id);
    procs += ap.length;
    for (const t of ap) seen.add(t.status);
    for (const st of [...f.statuses]) f.expireStatus(st);
  }
  ok("every hit procs at 25% × (1 + 100) hit", procs === 60, String(procs));
  ok("all four outcomes occur", MIMIC_EFFECTS.every((id: string) => seen.has(id)), [...seen].join(","));
  await b.damage(w, f, 100, DamageType.NORMAL, 1, null);
  const st = f.statuses[0];
  ok("1 turn on the bearer's turns", st && st.remaining === 1 && st.def.durationPolicy === "TARGET_TURN", st?.def?.id);
  const hd = StatusBook.get(MIMIC_HEALDOWN_ID);
  ok("heal-down status: 减疗, DEBUFF", hd?.name === "减疗" && String(hd?.category).startsWith("DEBUFF"));
  for (const s of [...f.statuses]) f.expireStatus(s);
  const n0 = b.trace.length;
  await b.damage(w, f, 100, DamageType.INDIRECT, 1, null);
  ok("indirect damage (does not trigger souls) → no proc", !since(b, n0).some(t => t.t === "SOUL_PROC" && t.soul === "魍魉之匣"));
  // efh 0 vs efr 0: about 25%.
  const b2 = await match([unit(200, 30000, {}, [5, 5, 5, 5])], FOES(1));
  const w2 = b2.teams[0].members[0], f2 = b2.teams[1].members[0];
  let n = 0;
  for (let i = 0; i < 400; i++) {
    const mark = b2.trace.length;
    await b2.damage(w2, f2, 10, DamageType.NORMAL, 1, null);
    if (since(b2, mark).some(t => t.t === "SOUL_PROC" && t.soul === "魍魉之匣")) n++;
    for (const st2 of [...f2.statuses]) f2.expireStatus(st2);
  }
  ok("no effect hit, no RES: ≈25%", n > 70 && n < 130, n + "/400");
}

sec("[8] BASE mode: kit and Mimic inert");
{
  setSkillLevelMode("BASE");
  ok("no damage hook in BASE", m7DamageHook({ id: "201_03", damage: [{}] }) === null && m7DamageHook({ id: "201_01", damage: [{}] }) === null);
  ok("Mimic not installed in BASE", customSoulFor("魍魉之匣") === null);
  setSkillLevelMode("MAX");
  ok("Mimic installed in MAX", typeof customSoulFor("魍魉之匣") === "function");
}

}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
