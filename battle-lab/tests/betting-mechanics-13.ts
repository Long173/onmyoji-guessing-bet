// tests/betting-mechanics-13.ts — match-7 replay fixes (2026-11-23g), MAX (betting) mode:
//   雪御前 591 龙胆蓝璃 (unscaled HP, untargetable, never countered), 黑童子 277 回魂 / 魂之怒火 / 连斩 extra hits,
//   鲸汐千姬 562 illusion duration (2 of her own turns).
// Run: node battle-lab/tests/betting-mechanics-13.ts
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };

const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { YUKI, GUARD_ID, glassOf, summonGlass } = await import(R + "compile/betting-yuki.ts");
const { KURO, RETURN_ID, returnTurnsLeft } = await import(R + "compile/betting-kuro.ts");
const { illusionOf } = await import(R + "compile/betting-senhime.ts");
const { untargetableInBetting } = await import(R + "compile/betting-shared.ts");
const { bettingHpScale } = await import(R + "compile/betting-policies.ts");
const { DamageType, EV, TurnType } = await import(R + "kernel/types.ts");

setSkillLevelMode("MAX");

const sec = (s: string) => console.log("\n" + s);
const unit = (shikigamiId: number, hp: number, extra: any = {}, soulIds: number[] = []): any => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds,
});
async function match(red: any[], blue: any[], seed = 1) {
  const A: any = await assembleGuessingMatch({ _meta: { title: "t13" }, red, blue } as any, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  return b;
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
/** Forces every roll tagged `tag` to `hit` while `fn` runs. */
async function forced<T>(b: any, tag: string, hit: boolean, fn: () => Promise<T>): Promise<T> {
  const origHit = b.rng.testHit, origExpect = b.rng.expect;
  let last = "";
  b.rng.expect = (t: string) => { last = String(t); return origExpect.call(b.rng, t); };
  b.rng.testHit = (p: number) => (last === tag ? hit : origHit.call(b.rng, p));
  try { return await fn(); } finally { b.rng.testHit = origHit; b.rng.expect = origExpect; }
}
const endTurn = async (b: any, e: any) => {
  await b.bus.dispatch(EV.TURN_START, { actor: e, type: TurnType.NORMAL }, e.id, e.teamId, (id: number) => b.teamOf(id));
  await b.bus.dispatch(EV.ACTION_END, { actor: e, type: TurnType.NORMAL }, e.id, e.teamId, (id: number) => b.teamOf(id));
  await b.bus.dispatch(EV.TURN_END, { actor: e, type: TurnType.NORMAL }, e.id, e.teamId, (id: number) => b.teamOf(id));
  for (const x of b.allEntities()) for (const st of [...x.statuses]) {
    if (st.def.durationPolicy === "TARGET_TURN" && x.id !== e.id) continue;
    if (st.def.durationPolicy === "SOURCE_TURN" && st.sourceId !== e.id) continue;
    if (st.def.durationPolicy === "GLOBAL") continue;
    if (--st.remaining <= 0) x.expireStatus(st);
  }
};

// ═════════ 雪御前 591: 龙胆蓝璃 ═════════
const YU = () => unit(591, 20000, { atk: 4986, cri: 0, crid: 150, def: 692, spd: 141 });

sec("[1] Glass HP = 360% of Yuki's initial ATK, NOT × the betting HP scale (replay: 19893 = 3.99 × 4986)");
{
  const b = await match([YU()], [unit(201, 90000), unit(201, 60000)]);
  const y = b.teams[0].members[0], g = glassOf(b, y);
  ok("betting HP scale is active for shikigami", bettingHpScale() > 1 && y.maxHp === Math.round(20000 * bettingHpScale()), String(y.maxHp));
  ok("YUKI.glassHpScaled is off", YUKI.glassHpScaled === false);
  ok("battle-start Glass: 360% × 4986 = 17950", Math.abs(g.maxHp - 4986 * 3.6) <= 1, String(g.maxHp));
  summonGlass(b, y, 0, "TEST");
  ok("one re-summon: +39% ⇒ 19893 (the replay number)", Math.abs(g.maxHp - 19893) <= 2, String(g.maxHp));
  const n0 = b.trace.length;
  const gs = g.skills[0];
  await gs.execute(b, g, gs.pickTarget(b, g, b.enemiesOf(0)));
  const d = since(b, n0).filter((t: any) => t.t === "DAMAGE" && t.src === g.id);
  ok("strike base = 50% of the current max HP", d.length === 1 && Math.abs((d[0].breakdown?.base ?? 0) - g.maxHp * 0.5) < 1, JSON.stringify(d.map((t: any) => t.breakdown?.base)));
}

sec("[2] the Glass is untargetable: not in enemiesOf, never countered (Inugami / Mannendake)");
{
  const b = await match([YU()], [unit(220, 90000, { atk: 5000 }), unit(275, 80000, { atk: 5000 }), unit(201, 70000)]);
  const y = b.teams[0].members[0], g = glassOf(b, y);
  ok("Glass flagged untargetable", g.caps.canBeTargeted === false && untargetableInBetting(g));
  ok("not listed by enemiesOf(blue)", !b.enemiesOf(1).includes(g));
  ok("Yuki listed, immune", b.enemiesOf(1).includes(y) && y.hasStatus(GUARD_ID));
  // Mark every blue unit for Inugami and Mannendake, then let the Glass strike several times.
  for (const m of b.teams[1].members) {
    for (const st of [...m.statuses]) if (st.def.id === "2202_1") m.expireStatus(st);
  }
  const hp0 = g.hp;
  const n0 = b.trace.length;
  for (let i = 0; i < 4; i++) { const gs = g.skills[0]; await gs.execute(b, g, gs.pickTarget(b, g, b.enemiesOf(0))); }
  const tr = since(b, n0);
  ok("the Glass hit Blue", tr.some((t: any) => t.t === "DAMAGE" && t.src === g.id));
  ok("no COUNTER aimed at the Glass", !tr.some((t: any) => (t.t === "COUNTER" || t.t === "COUNTER_TRIGGER") && t.target === g.id), JSON.stringify(tr.filter((t: any) => t.t === "COUNTER").map((t: any) => [t.actor, t.target])));
  ok("Glass HP untouched", g.alive && g.hp === hp0);
  // Direct damage on Yuki is still negated while the Glass lives.
  const yhp = y.hp;
  await b.damage(b.teams[1].members[2], y, 9000, DamageType.NORMAL, 1, null);
  ok("Yuki takes 0 damage", y.hp === yhp);
}

sec("[3] untargetableInBetting is false in BASE mode");
{
  setSkillLevelMode("BASE");
  ok("BASE ⇒ false even for an untargetable unit", untargetableInBetting({ caps: { canBeTargeted: false } }) === false);
  setSkillLevelMode("MAX");
  ok("MAX ⇒ true for an untargetable unit, false for a normal one", untargetableInBetting({ caps: { canBeTargeted: false } }) && !untargetableInBetting({ caps: { canBeTargeted: true } }));
}

// ═════════ 黑童子 277: 回魂 / 魂之怒火 ═════════
const KU = () => unit(277, 14443, { atk: 6091, def: 703, spd: 121, cri: 0 });

sec("[4] 回魂 (先机): a lethal hit leaves Kuro at 1 HP with a 135% ATK shield, consumed");
{
  const b = await match([KU()], [unit(201, 900000, { atk: 4000 }), unit(201, 900000)]);
  const k = b.teams[0].members[0], foe = b.teams[1].members[0];
  ok("回魂 held at battle start (2 turns)", k.hasStatus(RETURN_ID) && returnTurnsLeft(k) === KURO.returnTurns);
  const n0 = b.trace.length;
  await forced(b, "kuro277_rage", false, () => b.damage(foe, k, 1e7, DamageType.NORMAL, 1, null));
  ok("alive at 1 HP", k.alive && k.hp === 1, String(k.hp));
  ok("UNDYING traced", since(b, n0).some((t: any) => t.t === "UNDYING" && t.id === k.id && t.by === RETURN_ID));
  ok("回魂 consumed", !k.hasStatus(RETURN_ID));
  const sh = since(b, n0).find((t: any) => t.t === "SHIELD_APPLY" && t.dst === k.id);
  ok("shield = 135% ATK for 2 turns", !!sh && Math.abs(sh.value - k.prop("atk") * 1.35) < 1 && sh.duration === 2, JSON.stringify(sh));
  await forced(b, "kuro277_rage", false, () => b.damage(foe, k, 1e7, DamageType.NORMAL, 1, null));
  ok("a second lethal hit kills (once only)", !k.alive);
}

sec("[5] 回魂 also stops a lethal COUNTER (pseudo turn) — no ordering hole");
{
  const b = await match([KU()], [unit(220, 900000, { atk: 400000 }), unit(201, 900000)]);
  const k = b.teams[0].members[0], inu = b.teams[1].members[0];
  // Inugami counters Kuro's attack on a marked ally (mark everyone).
  const n0 = b.trace.length;
  await forced(b, "kuro277_rage", false, () => b.counterAttack(inu, k.id));
  const tr = since(b, n0);
  ok("the counter landed on Kuro", tr.some((t: any) => t.t === "DAMAGE" && t.src === inu.id && t.dst === k.id));
  ok("Kuro survives the counter at 1 HP", k.alive && k.hp === 1, String(k.hp));
}

sec("[6] 回魂 lasts 2 of Kuro's own turns (pseudo turns do not count)");
{
  const b = await match([KU()], [unit(201, 900000), unit(201, 900000)]);
  const k = b.teams[0].members[0], foe = b.teams[1].members[0];
  await endTurn(b, foe);
  ok("an enemy turn does not tick it", returnTurnsLeft(k) === 2);
  await b.runPseudoTurn(k, TurnType.PSEUDO_TURN, { skill: sk(k, "277_01"), target: foe });
  ok("a pseudo turn does not tick it", returnTurnsLeft(k) === 2);
  await endTurn(b, k);
  ok("1 left after his first turn (replay icon 2 → 1)", returnTurnsLeft(k) === 1);
  await endTurn(b, k);
  ok("gone after his second turn", !k.hasStatus(RETURN_ID));
}

sec("[7] 连斩 at 1 HP: +1 attack per 30% lost ⇒ 4 attacks on each enemy");
{
  const b = await match([KU()], [unit(201, 9e6), unit(201, 9e6), unit(201, 9e6)]);
  const k = b.teams[0].members[0], foe = b.teams[1].members[0];
  k.hp = 1;
  const n0 = b.trace.length;
  b.teams[0].orbs.gain(8);
  const s = sk(k, "277_03");
  await b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, k, foe));
  const d = since(b, n0).filter((t: any) => t.t === "DAMAGE" && t.src === k.id);
  const per = b.teams[1].members.map((v: any) => d.filter((t: any) => t.dst === v.id).length);
  ok("4 hits per enemy", per.every((n: number) => n === 4), JSON.stringify(per));
  k.hp = k.maxHp * 0.71;
  const n1 = b.trace.length;
  await b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, k, foe));
  const d1 = since(b, n1).filter((t: any) => t.t === "DAMAGE" && t.src === k.id && t.dst === foe.id);
  ok("29% lost ⇒ 1 hit", d1.length === 1, String(d1.length));
}

sec("[8] 魂之怒火 after the save: the next enemy attack can trigger a free 连斩 with 4 hits each; none from a dying Kuro");
{
  const b = await match([KU()], [unit(201, 9e6, { atk: 3000 }), unit(201, 9e6)]);
  const k = b.teams[0].members[0], foe = b.teams[1].members[0];
  let n0 = b.trace.length;
  await forced(b, "kuro277_rage", true, () => b.damage(foe, k, 1e7, DamageType.NORMAL, 1, null));
  ok("no rage roll on the lethal hit itself (0 HP until the save resolves)", !since(b, n0).some((t: any) => t.t === "SUBCAST" && t.actor === k.id && t.ref === "277_03"));
  ok("saved at 1 HP", k.alive && k.hp === 1);
  b.turn += 1;   // a new enemy action
  n0 = b.trace.length;
  await forced(b, "kuro277_rage", true, () => b.damage(foe, k, 100, DamageType.NORMAL, 1, null));
  const tr = since(b, n0);
  ok("free 连斩 cast", tr.some((t: any) => t.t === "SUBCAST" && t.actor === k.id && t.ref === "277_03"));
  const per = b.teams[1].members.map((v: any) => tr.filter((t: any) => t.t === "DAMAGE" && t.src === k.id && t.dst === v.id).length);
  ok("…4 attacks on each enemy (the shield kept HP at 1)", per.every((n: number) => n === 4), JSON.stringify(per) + " hp " + k.hp);
}

sec("[9] no 回魂: a lethal hit kills and does not hand Kuro a free 连斩 first");
{
  const b = await match([KU()], [unit(201, 9e6, { atk: 3000 }), unit(201, 9e6)]);
  const k = b.teams[0].members[0], foe = b.teams[1].members[0];
  for (const st of [...k.statuses]) if (st.def.id === RETURN_ID) k.expireStatus(st);
  const n0 = b.trace.length;
  await forced(b, "kuro277_rage", true, () => b.damage(foe, k, 1e7, DamageType.NORMAL, 1, null));
  ok("dead", !k.alive);
  ok("no free 连斩 from the corpse", !since(b, n0).some((t: any) => t.t === "SKILL_CAST" && t.actor === k.id));
}

// ═════════ 鲸汐千姬 562: illusion duration ═════════
sec("[10] 永生之海幻境 (先机) lasts 2 of Senhime's own turns; other turns never shorten it");
{
  const b = await match([unit(201, 900000), unit(201, 900000)], [unit(562, 50000), unit(201, 900000)]);
  const s = b.teams[1].members[0], other = b.teams[1].members[1], foe = b.teams[0].members[0];
  ok("open after startup", !!illusionOf(b, 1));
  for (let i = 0; i < 6; i++) { b.turn += 1; await endTurn(b, i % 2 ? other : foe); }
  ok("6 turns of other units: still open", !!illusionOf(b, 1));
  b.turn += 1; await endTurn(b, s);
  ok("after her 1st turn: open", !!illusionOf(b, 1));
  b.turn += 1; await endTurn(b, s);
  ok("after her 2nd turn: closed", !illusionOf(b, 1));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
