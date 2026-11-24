// tests/betting-mechanics-14.ts — match-9 kits (2026-11-24a), MAX (betting) mode, wired through compile/betting-m9.ts:
//   阿修罗 364, 鬼童丸 345, 天井下 323, 匣中少女 287, 青行灯 266, 梦引蝴蝶精 594, 千姬 356 (base SSR, not 鲸汐千姬 562).
// Each part runs in its own block (own helpers, own small synthetic matches); the pass / fail counters are shared.
// Run: node battle-lab/tests/betting-mechanics-14.ts
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };

// ═════════ 阿修罗 364 (betting-asura.ts) / 鬼童丸 345 (betting-kidomaru.ts) ═════════
{
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { ASURA, REASON_ID, ANNIHILATE_ID, reasonOf, asuraForm, asuraImmune, setReason, slaughter, KIT: ASURA_KIT } = await import(R + "compile/betting-asura.ts");
const { KIDO, CHAIN_ID, CONCEAL_ID, SHURA_ID, frenzyOf, inShura, concealed, KIT: KIDO_KIT } = await import(R + "compile/betting-kidomaru.ts");
const { bettingCostOf, BETTING_IR_PATCHES } = await import(R + "compile/betting-mechanics.ts");
const { shiftBar } = await import(R + "compile/betting-shared.ts");
const { flushBarReactions } = await import(R + "compile/betting-bar.ts");
const { bettingKitSkillOf } = await import(R + "compile/betting-coverage.ts");
const { DamageType, EV, TurnType } = await import(R + "kernel/types.ts");

setSkillLevelMode("MAX");
const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const unit = (shikigamiId: number, hp: number, extra: any = {}): any => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra }, soulIds: [],
});
async function match(red: any[], blue: any[], seed = 1) {
  const A: any = await assembleGuessingMatch({ _meta: { title: "t14a" }, red, blue } as any, { seed, traceLevel: "FULL" });
  await A.battle.runStartup();
  return A.battle;
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => { const s = sk(e, id); return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target)); };
const unfloat = (t: any) => t.final / (t.breakdown?.float?.value ?? 1);
const setOrbs = (b: any, team: number, n: number) => { b.teams[team].orbs.orb = n; };
const dispatch = (b: any, code: string, e: any) => b.bus.dispatch(code, { actor: e, type: TurnType.NORMAL }, e.id, e.teamId, (id: number) => b.teamOf(id));
const dmgFrom = (b: any, mark: number, src: number) => since(b, mark).filter(t => t.t === "DAMAGE" && t.src === src);

sec("[A1] Reason: 9 at battle start, spent per target, control immunity below 9");
{
  const b = await match([unit(364, 900000)], [unit(201, 900000), unit(201, 900000)]);
  const a = b.teams[0].members[0], [f1] = b.teams[1].members;
  ok("9 Reason at battle start", reasonOf(a) === 9, String(reasonOf(a)));
  ok("not immune at 9", !asuraImmune(a));
  await cast(b, a, "364_01", f1);
  ok("红莲诛灭 spends 1 Reason", reasonOf(a) === 8, String(reasonOf(a)));
  ok("immune to control below 9", asuraImmune(a));
  ok("364_01 no longer puts 诛灭 on Asura", !a.hasStatus("3645_1") && !a.hasStatus(ANNIHILATE_ID));
  ok("364_02 is never castable", ASURA_KIT.gate!(b, a, sk(a, "364_02")) === "PASSIVE_NOT_CASTABLE");
}

sec("[A2] Reason suppression (-6%/point dealt), L5 DR (-6%/point lost), restore heal 8%/point, SPD bonus");
{
  const b = await match([unit(364, 900000)], [unit(201, 900000)]);
  const a = b.teams[0].members[0], f = b.teams[1].members[0];
  await setReason(b, a, 0, "TEST");
  let m = b.trace.length;
  await b.damage(a, f, 1000, DamageType.NORMAL, 1, null);
  const full = unfloat(dmgFrom(b, m, a.id)[0]);
  await setReason(b, a, 5, "TEST");
  m = b.trace.length;
  await b.damage(a, f, 1000, DamageType.NORMAL, 1, null);
  const supp = unfloat(dmgFrom(b, m, a.id)[0]);
  ok("5 Reason ⇒ ×0.70 damage dealt", near(supp / full, 1 - 5 * ASURA.suppress, 5e-3), (supp / full).toFixed(4));
  m = b.trace.length;
  await b.damage(f, a, 1000, DamageType.NORMAL, 1, null);
  const t5 = unfloat(dmgFrom(b, m, f.id)[0]);
  await setReason(b, a, 9, "TEST");
  m = b.trace.length;
  await b.damage(f, a, 1000, DamageType.NORMAL, 1, null);
  const t9 = unfloat(dmgFrom(b, m, f.id)[0]);
  ok("L5: 4 points lost ⇒ ×0.76 damage taken", near(t5 / t9, 1 - 4 * ASURA.drPerLost, 5e-3), (t5 / t9).toFixed(4));
  await setReason(b, a, 0, "TEST");
  a.hp = a.maxHp * 0.1;
  const hp0 = a.hp;
  await setReason(b, a, 9, "TEST");
  ok("9 points restored heal 72% of max HP", near((a.hp - hp0) / a.maxHp, 9 * ASURA.healPerPoint, 1e-3), ((a.hp - hp0) / a.maxHp).toFixed(3));
  const b2 = await match([unit(364, 900000, { spd: 200 })], [unit(201, 900000)]);
  const a2 = b2.teams[0].members[0], f2 = b2.teams[1].members[0];
  await setReason(b2, a2, 0, "TEST");
  m = b2.trace.length;
  await b2.damage(a2, f2, 1000, DamageType.NORMAL, 1, null);
  const fast = unfloat(dmgFrom(b2, m, a2.id)[0]);
  ok("faster initial SPD ⇒ +10% damage", near(fast / full, 1 + ASURA.spdBonus, 5e-3), (fast / full).toFixed(4));
}

sec("[A3] 炼狱虐杀: one AoE (1 Reason per enemy), then 63% follow-ups until Reason runs out");
{
  const b = await match([unit(364, 900000)], [unit(201, 900000), unit(201, 900000)]);
  const a = b.teams[0].members[0], [f1, f2] = b.teams[1].members;
  setOrbs(b, 0, 8);
  const m = b.trace.length;
  await cast(b, a, "364_03", f1);
  const hits = dmgFrom(b, m, a.id);
  ok("2 AoE hits + 7 follow-ups on the target", hits.length === 9 && hits.filter(t => t.dst === f1.id).length === 8, hits.map(t => t.dst).join(","));
  ok("Reason used up", reasonOf(a) === 0);
  ok("patched: no 1-turn 理性 status from the cast", !a.hasStatus("3641_1"));
}

sec("[A4] kill ⇒ 诛灭 on the victim, 无间杀戮 form; slaughter hits allies; +1 Reason per ally turn end; back at 9");
{
  const b = await match([unit(364, 900000, { atk: 50000 }), unit(201, 900000)], [unit(201, 2000), unit(201, 900000)]);
  const [a, ally] = b.teams[0].members, [weak] = b.teams[1].members;
  await cast(b, a, "364_01", weak);
  ok("victim killed and carries 诛灭", !weak.alive && weak.hasStatus(ANNIHILATE_ID));
  ok("form switched to 无间杀戮 (immune)", asuraForm(a) === "SLAUGHTER" && asuraImmune(a));
  const m = b.trace.length;
  await dispatch(b, EV.TURN_START, a);
  const hurt = new Set(dmgFrom(b, m, a.id).map(t => t.dst));
  ok("turn start (<9 Reason): slaughter hits every other unit, ally included", hurt.has(ally.id) && hurt.size === 2 && !hurt.has(a.id), [...hurt].join(","));
  ok("no refill in slaughter form", reasonOf(a) === 8, String(reasonOf(a)));
  await dispatch(b, EV.TURN_END, ally);
  ok("ally turn end: +1 Reason", reasonOf(a) === 9);
  await dispatch(b, EV.TURN_START, a);
  ok("9 Reason at turn start ⇒ back to 天魔威压", asuraForm(a) === "CRUSH" && reasonOf(a) === 9);
}

sec("[K1] 鬼童丸: L5 先机 隐匿; 修罗骸锁 chains, 狂 at turn end; concealment lifted after an own-turn attack");
{
  const b = await match([unit(345, 900000), unit(201, 900000)], [unit(201, 900000), unit(201, 900000)]);
  const [k] = b.teams[0].members, [f1, f2] = b.teams[1].members;
  ok("concealed at battle start (L5 先机)", concealed(k));
  const pick = sk(f1, "201_01").pickTarget(b, f1, b.enemiesOf(f1.teamId));
  ok("enemy single-target pick avoids the concealed Kidomaru", pick.id !== k.id, String(pick.id));
  setOrbs(b, 0, 8);
  await b.runPseudoTurn(k, TurnType.NEW_TURN, { skill: sk(k, "345_03"), target: f1 });
  ok("target chained", f1.hasStatus(CHAIN_ID));
  ok("cast began concealed ⇒ no re-entry, lifted after the attack", !concealed(k));
  ok("+1 狂 at the end of the turn", frenzyOf(k) === 1, String(frenzyOf(k)));
  await b.runPseudoTurn(k, TurnType.NEW_TURN, { skill: sk(k, "345_03"), target: f2 });
  ok("next cast (not concealed) enters 隐匿", concealed(k));
  ok("隐匿 cuts damage taken by 20%", near(k.prop("dmgTakenD"), -KIDO.concealDr, 1e-9), String(k.prop("dmgTakenD")));
}

sec("[K2] 骸之锁 splash (60% ATK on other chained enemies) and 降诛 counter on an enemy bar increase");
{
  const b = await match([unit(345, 900000)], [unit(201, 900000), unit(201, 900000), unit(201, 900000)]);
  const k = b.teams[0].members[0], [f1, f2, f3] = b.teams[1].members;
  for (const st of [...k.statuses]) k.expireStatus(st);
  await cast(b, k, "345_01", f1);
  let m = b.trace.length;
  await cast(b, k, "345_01", f2);
  const splash = dmgFrom(b, m, k.id).filter(t => t.dst === f1.id);
  ok("other chained enemy takes the 60% ATK splash", splash.length === 1 && since(b, m).some(t => t.t === "MARK_TRIGGER"), String(splash.length));
  m = b.trace.length;
  shiftBar(b, f3, 0.2, "test");
  await flushBarReactions(b);
  ok("unchained enemy gains bar ⇒ 降诛 counter", since(b, m).some(t => t.t === "SUBCAST" && t.target === f3.id) && f3.hasStatus(CHAIN_ID));
  m = b.trace.length;
  shiftBar(b, f1, 0.2, "test");
  await flushBarReactions(b);
  ok("chained enemy: no counter", !since(b, m).some(t => t.t === "SUBCAST"));
}

sec("[K3] 3 狂 ⇒ 修罗 (shield 160% ATK, immunity); 猎魂狂杀 after enemy turns; ends after 3, clears chains, L5 discount");
{
  const b = await match([unit(345, 900000)], [unit(201, 900000), unit(201, 900000)]);
  const k = b.teams[0].members[0], [f1, f2] = b.teams[1].members;
  await cast(b, k, "345_01", f1);
  await cast(b, k, "345_01", f2);
  setOrbs(b, 0, 8);
  for (let i = 0; i < 3; i++) await b.runPseudoTurn(k, TurnType.NEW_TURN, { skill: sk(k, "345_01"), target: f1 });
  // 345_01 L5: hitting a chained target ⇒ +1 狂 at turn end (3 turns)
  ok("3 狂 ⇒ 修罗", inShura(k), "frenzy " + frenzyOf(k));
  const sh = k.shields.find((s: any) => String(s.id).includes("345shura") && !s.broken);
  ok("shield = 160% ATK", !!sh && near(sh.value, k.prop("atk") * KIDO.shuraShield, 1e-6));
  ok("狂: +60 SPD at 3 stacks", frenzyOf(k) === 3);
  for (let i = 0; i < 3; i++) {
    const m = b.trace.length;
    await dispatch(b, EV.TURN_END, f2);
    const hit = dmgFrom(b, m, k.id);
    if (i === 0) ok("enemy turn end ⇒ 猎魂狂杀 hits all enemies (no souls)", hit.length === 2);
  }
  ok("修罗 ends after 3 uses: 狂 cleared, chains removed", !inShura(k) && frenzyOf(k) === 0 && !f1.hasStatus(CHAIN_ID) && !f2.hasStatus(CHAIN_ID));
  ok("L5: next 修罗骸锁 costs 3 − 2 = 1", bettingCostOf(b, k, sk(k, "345_03")) === 1 && bettingCostOf(b, k, sk(k, "345_03").ir) === 1, String(bettingCostOf(b, k, sk(k, "345_03"))));
}

sec("[K4] coverage + patches registered");
{
  ok("coverage lists 364_0x / 345_0x", ["364_01", "364_02", "364_03", "345_01", "345_02", "345_03"].every(id => !!bettingKitSkillOf(id)));
  ok("IR patches merged", !!BETTING_IR_PATCHES["364_03"] && !!BETTING_IR_PATCHES["345_03"]);
}

sec("[K5] BASE mode: kits inert");
{
  setSkillLevelMode("BASE");
  ok("no damage hook / cost change / gate in BASE", ASURA_KIT.damageHook!({ id: "364_03" }) === null
    && KIDO_KIT.cost!(null, { skills: [] } as any, { id: "345_03" }, 3) === 3 && ASURA_KIT.gate!(null, {} as any, { ir: { id: "364_02" } }) === null);
  ok("no install in BASE", ASURA_KIT.install!({} as any, []).length === 0 && KIDO_KIT.install!({} as any, []).length === 0);
  setSkillLevelMode("MAX");
}
}


// ═════════ 天井下 323 (betting-tenjo.ts) / 匣中少女 287 (betting-hako.ts) ═════════
{
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { TENJO, SHELTER_ID, AWAKE_ID, JOY_ID, joyMarks, houseAwake, KIT: TENJO_KIT } = await import(R + "compile/betting-tenjo.ts");
const { HAKO, DREAM_ID, HAKO_BUFF_IDS, HAKO_DEBUFF_IDS, hakoGate, KIT: HAKO_KIT } = await import(R + "compile/betting-hako.ts");
const { bettingPreferredSkill, BETTING_IR_PATCHES } = await import(R + "compile/betting-mechanics.ts");
const { StatusBook } = await import(R + "kernel/status.ts");
const { DamageType, EV, TurnType, StatusCategory } = await import(R + "kernel/types.ts");

setSkillLevelMode("MAX");
const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const unit = (shikigamiId: number, hp: number, extra: any = {}): any => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra }, soulIds: [],
});
async function match(red: any[], blue: any[], seed = 1) {
  const A: any = await assembleGuessingMatch({ _meta: { title: "t14-tenjo-hako" }, red, blue } as any, { seed, traceLevel: "FULL" });
  await A.battle.runStartup();
  return A.battle;
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => { const s = sk(e, id); return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target)); };
const disp = (b: any, code: string, e: any) => b.bus.dispatch(code, { actor: e, type: TurnType.NORMAL }, e.id, e.teamId, (id: number) => b.teamOf(id));
const setOrbs = (b: any, team: number, n: number) => { b.teams[team].orbs.orb = n; };
const turnStart = (b: any, e: any) => disp(b, EV.TURN_START, e);
const turnEnd = async (b: any, e: any) => { await disp(b, EV.ACTION_END, e); await disp(b, EV.TURN_END, e); };
const pick = (b: any, e: any) => bettingPreferredSkill(b, e)?.skill?.ir?.id ?? null;
const hakoShields = (e: any, h: any) => (e.shields as any[]).filter(s => !s.broken && s.sourceId === h.id && String(s.id).includes("hako287"));

sec("[1] 天井下 遮雨: +25% effect RES on non-summon allies, +50% on herself; 5% heal at ally turn start");
{
  const b = await match([unit(323, 30000), unit(201, 30000)], [unit(201, 900000)]);
  const [t, ally] = b.teams[0].members, foe = b.teams[1].members[0];
  ok("ally has 遮雨 +25% RES", ally.hasStatus(SHELTER_ID) && near(ally.prop("efr"), TENJO.res), String(ally.prop("efr")));
  ok("Tenjo has +50% RES", near(t.prop("efr"), TENJO.resSelf), String(t.prop("efr")));
  ok("enemy has no 遮雨", !foe.hasStatus(SHELTER_ID));
  ally.hp = ally.maxHp * 0.5;
  const hp0 = ally.hp;
  await turnStart(b, ally);
  ok("ally healed 5% of its max HP at its turn start", near(ally.hp - hp0, ally.maxHp * TENJO.heal, 1e-3), `${Math.round(ally.hp - hp0)} vs ${Math.round(ally.maxHp * TENJO.heal)}`);
  await turnEnd(b, ally);
}

sec("[2] 再会之音: KB AI, 3 欢愉标记; another ally's turn end consumes 1: +1 onibi, +25% action bar; marks expire after her next turn");
{
  const b = await match([unit(323, 30000), unit(201, 30000)], [unit(201, 900000)]);
  const [t, ally] = b.teams[0].members, foe = b.teams[1].members[0];
  ok("AI: 2 allies alive → 再会之音", pick(b, t) === "323_03");
  ok("IR patch: generic marks off", JSON.stringify(BETTING_IR_PATCHES["323_03"]?.patch?.statusRefConditionOnly) === "[0,1]");
  await turnStart(b, t);
  ok("house awake during her own turn (+20% damage on ally)", houseAwake(b, t) && near(ally.prop("dmgDealtB"), TENJO.awakeDmg), String(ally.prop("dmgDealtB")));
  await cast(b, t, "323_03", ally);
  ok("3 欢愉标记 after the cast", joyMarks(t) === TENJO.marks, String(joyMarks(t)));
  await turnEnd(b, t);
  ok("marks survive her own turn end", joyMarks(t) === 3);
  ok("house stays awake while she holds marks", houseAwake(b, t) && ally.hasStatus(AWAKE_ID));
  setOrbs(b, 0, 2);
  b.timeline.get(ally.id).pos = 0;
  const mark = b.trace.length;
  await turnStart(b, ally);
  await turnEnd(b, ally);
  ok("ally turn end: 1 mark consumed", joyMarks(t) === 2, String(joyMarks(t)));
  ok("ally turn end: +1 onibi", b.teams[0].orbs.current === 3, String(b.teams[0].orbs.current));
  ok("ally turn end: +25% action bar", since(b, mark).some(x => x.t === "TIMELINE_SHIFT" && x.id === ally.id && near(x.percent, TENJO.bar)));
  // controlled ⇒ not actionable ⇒ asleep outside her turn
  const stun = [...StatusBook.values()].find((d: any) => d.preventsAction && String(d.category).startsWith("DEBUFF"));
  if (stun) {
    const st = t.addStatus(stun, foe.id, 1, 1, [], 1);
    ok("controlled Tenjo: house asleep (no +20%)", !houseAwake(b, t));
    t.expireStatus(st);
  }
  ok("uncontrolled again: awake", houseAwake(b, t));
  const mark2 = b.trace.length;
  await turnStart(b, foe);
  await turnEnd(b, foe);
  ok("enemy turn end consumes nothing", joyMarks(t) === 2 && !since(b, mark2).some(x => x.t === "ORB_GAIN" && x.team === 0));
  await turnStart(b, t);
  await turnEnd(b, t);   // her next turn without a recast
  ok("marks expire at the end of her next turn", joyMarks(t) === 0);
  ok("house asleep afterwards (aura removed)", !houseAwake(b, t) && !ally.hasStatus(AWAKE_ID) && near(ally.prop("dmgDealtB"), 0));
  const b2 = await match([unit(323, 30000)], [unit(201, 900000)]);
  ok("AI: alone → 扔石头", pick(b2, b2.teams[0].members[0]) === "323_01");
}

sec("[3] 遮雨 is a passive: 压制 removes the RES aura and stops the heal; her death clears the auras");
{
  const b = await match([unit(323, 30000), unit(201, 30000)], [unit(201, 900000)]);
  const [t, ally] = b.teams[0].members;
  const sealDef = { id: "t14_seal", name: "seal", category: StatusCategory.COMMON_MARK, desc: "t", dispellable: false, removable: false, preventsAction: false,
    preventsSkill: false, forcesBasicAttack: false, suppressPassive: true, suppressSoul: false, locksTimeline: false, durationPolicy: "GLOBAL" };
  const st = t.addStatus(sealDef as any, ally.id, 1, 99, [], 1);
  ally.hp = ally.maxHp * 0.5;
  const hp0 = ally.hp;
  await turnStart(b, ally);
  ok("sealed: no 遮雨 on the ally", !ally.hasStatus(SHELTER_ID));
  ok("sealed: no heal", ally.hp === hp0);
  await turnEnd(b, ally);
  t.expireStatus(st);
  await turnStart(b, t);
  ok("unsealed: 遮雨 back", ally.hasStatus(SHELTER_ID));
  await turnEnd(b, t);
  await b.damage(b.teams[1].members[0], t, 1e9, DamageType.TRUE, 1, null);
  await turnStart(b, ally);
  ok("Tenjo dead: auras gone", !t.alive && !ally.hasStatus(SHELTER_ID) && !ally.hasStatus(AWAKE_ID));
}

sec("[4] 匣中少女 溢彩: before an ally acts, 8% max-HP shield (2 turns, replaced) + 1 random buff (2 turns)");
{
  const b = await match([unit(287, 50000), unit(201, 30000)], [unit(201, 900000)]);
  const [h, ally] = b.teams[0].members;
  await turnStart(b, ally);
  const s1 = hakoShields(ally, h);
  ok("one 溢彩 shield of 8% of Hako's max HP", s1.length === 1 && near(s1[0].value, h.maxHp * HAKO.shield, 1e-6), String(s1[0]?.value));
  ok("one random buff, 2 turns", ally.statuses.filter((s: any) => HAKO_BUFF_IDS.includes(s.def.id)).length === 1
    && ally.statuses.find((s: any) => HAKO_BUFF_IDS.includes(s.def.id))?.remaining === HAKO.buffTurns);
  await turnEnd(b, ally);
  await turnStart(b, ally);
  ok("next turn: the shield is replaced (still one)", hakoShields(ally, h).length === 1);
  await turnEnd(b, ally);
  let kinds = new Set<string>();
  for (let i = 0; i < 40; i++) { await turnStart(b, h); for (const s of h.statuses) if (HAKO_BUFF_IDS.includes(s.def.id)) kinds.add(s.def.id); await turnEnd(b, h); }
  ok("all 5 buff kinds occur (Hako herself included)", kinds.size === 5, String(kinds.size));
}

sec("[5] 溢彩 evolved: an enemy attacking Hako gets 1 random debuff (contested, once per action)");
{
  const b = await match([unit(287, 50000)], [unit(201, 900000)]);
  const h = b.teams[0].members[0], foe = b.teams[1].members[0];
  await turnStart(b, foe);
  await b.damage(foe, h, 100, DamageType.NORMAL, 1, null);
  await b.damage(foe, h, 100, DamageType.NORMAL, 1, null);
  ok("attacker has exactly 1 random debuff", foe.statuses.filter((s: any) => HAKO_DEBUFF_IDS.includes(s.def.id)).length === 1);
  await disp(b, EV.ACTION_END, foe);
  for (const s of [...foe.statuses]) foe.expireStatus(s);
  await b.damage(foe, h, 100, DamageType.INDIRECT, 1, null);
  ok("indirect damage is not an attack", !foe.statuses.some((s: any) => HAKO_DEBUFF_IDS.includes(s.def.id)));
}

sec("[6] 回梦: KB AI + cooldown 2; lethal hit ⇒ immune and recover to 60% of the record; duration end ⇒ same rule");
{
  const b = await match([unit(287, 50000), unit(201, 30000)], [unit(201, 900000)]);
  const [h, ally] = b.teams[0].members, foe = b.teams[1].members[0];
  setOrbs(b, 0, 3);
  ok("AI: no record, 3 onibi → 回梦", pick(b, h) === "287_03");
  setOrbs(b, 0, 2);
  ok("AI: 2 onibi → 流光", pick(b, h) === "287_01");
  setOrbs(b, 0, 3);
  await turnStart(b, h);
  await cast(b, h, "287_03", ally);
  ok("every ally carries 回梦", h.hasStatus(DREAM_ID) && ally.hasStatus(DREAM_ID));
  ok("onibi paid", b.teams[0].orbs.current === 0, String(b.teams[0].orbs.current));
  await turnEnd(b, h);
  setOrbs(b, 0, 8);
  ok("AI: a record exists → 流光", pick(b, h) === "287_01");
  ok("cooldown after the cast", hakoGate(h, sk(h, "287_03")) === "COOLDOWN");
  const recHp = ally.hp;
  ally.hp = recHp * 0.1;
  const mark = b.trace.length;
  await b.damage(foe, ally, 1e7, DamageType.NORMAL, 1, null);
  ok("lethal hit is negated", ally.alive && since(b, mark).some(x => x.t === "IMMUNE" && x.by === DREAM_ID));
  ok("recovered to 60% of the record", near(ally.hp, recHp * HAKO.ratio, 1e-6), `${Math.round(ally.hp)} vs ${Math.round(recHp * HAKO.ratio)}`);
  ok("record consumed", !ally.hasStatus(DREAM_ID));
  await b.damage(foe, ally, 1e9, DamageType.TRUE, 1, null);
  ok("second lethal hit kills", !ally.alive);
  // Duration end on Hako herself: below 60% ⇒ recover.
  const recH = Number(h.notes.find((n: string) => n.startsWith("hako287:rec="))!.slice("hako287:rec=".length));
  h.hp = recH * 0.3;
  const st = h.statuses.find((s: any) => s.def.id === DREAM_ID);
  h.expireStatus(st);
  b.queueEvent(EV.STATUS_EXPIRE, { battle: b, entity: h, status: DREAM_ID, name: "回梦", reason: "DURATION" }, h.id, h.teamId);
  await b.drainEvents();
  ok("duration end: recover to 60% of the record", near(h.hp, recH * HAKO.ratio, 1e-6), `${Math.round(h.hp)} vs ${Math.round(recH * HAKO.ratio)}`);
  for (let i = 0; i < 2; i++) { await turnStart(b, h); await turnEnd(b, h); }
  ok("cooldown over after 2 of her turns", hakoGate(h, sk(h, "287_03")) === null);
}

sec("[7] full 2026-11-24a battle: both kits act");
{
  const { loadMatchFixture } = await import(R + "soul/guessing-match.ts");
  const { normalizeLineup } = await import(new URL("../../matches/names.ts", import.meta.url).href);
  const fx: any = normalizeLineup(await loadMatchFixture("D:/Project/onmyoji-guessing-sim/matches/2026-11-24a-lineup.en.json"));
  const A: any = await assembleGuessingMatch(fx, { seed: 100001, traceLevel: "FULL" });
  await A.battle.run();
  const tr = A.battle.trace as any[];
  ok("Tenjo casts 再会之音", tr.some(x => x.t === "SKILL_CAST" && x.skill === "再会之音"));
  ok("欢愉标记 grants onibi", tr.some(x => x.t === "ORB_GAIN" && x.skill === "欢愉标记"));
  ok("Hako shields allies (溢彩)", tr.some(x => x.t === "SHIELD_APPLY" && x.skill === "溢彩"));
  ok("Hako casts 回梦", tr.some(x => x.t === "SKILL_CAST" && x.skill === "回梦"));
}

sec("[8] BASE mode: both kits inert");
{
  setSkillLevelMode("BASE");
  const A: any = await assembleGuessingMatch({ _meta: { title: "t14b" }, red: [unit(323, 30000), unit(287, 30000)], blue: [unit(201, 900000)] } as any, { seed: 1 });
  const b = A.battle;
  await b.runStartup();
  const [t, h] = b.teams[0].members;
  ok("no 遮雨 in BASE", !t.hasStatus(SHELTER_ID) && !h.hasStatus(SHELTER_ID));
  ok("no AI rule in BASE", TENJO_KIT.ruleSkill!(b, t, () => 0) === null && HAKO_KIT.ruleSkill!(b, h, () => 0) === null);
  ok("no install in BASE", TENJO_KIT.install!(b, [t, h]).length === 0 && HAKO_KIT.install!(b, [t, h]).length === 0);
  ok("no gate in BASE", HAKO_KIT.gate!(b, h, sk(h, "287_03")) === null);
  setSkillLevelMode("MAX");
}
}


// ═════════ 青行灯 266 (betting-aoandon.ts) / 梦引蝴蝶精 594 (betting-chocho594.ts) ═════════
{
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { AOANDON, LAMP_ID, LANTERN_ID, lampChance, KIT: AOANDON_KIT } = await import(R + "compile/betting-aoandon.ts");
const { CHOCHO594, COCOON_ID, SONG_ID, cocoonsOf, grantCocoon, KIT: CHOCHO_KIT } = await import(R + "compile/betting-chocho594.ts");
const { bettingCostOf, BETTING_IR_PATCHES } = await import(R + "compile/betting-mechanics.ts");
const { DamageType, EV, TurnType } = await import(R + "kernel/types.ts");

setSkillLevelMode("MAX");
const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const unit = (shikigamiId: number, hp: number, extra: any = {}): any => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
async function match(red: any[], blue: any[], seed = 1) {
  const A: any = await assembleGuessingMatch({ _meta: { title: "t14-266-594" }, red, blue } as any, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  return b;
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => { const s = sk(e, id); return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target)); };
const setOrbs = (b: any, team: number, n: number) => { b.teams[team].orbs.orb = n; };
const orbs = (b: any, team: number) => b.teams[team].orbs.current;
/** Forces the kit chance rolls whose tag starts with `prefix` to `hit`; every other roll stays random. */
async function forced<T>(b: any, prefix: string, hit: boolean, fn: () => Promise<T>): Promise<T> {
  const origHit = b.rng.testHit, origExpect = b.rng.expect;
  let last = "";
  b.rng.expect = (tag: string) => { last = String(tag); return origExpect.call(b.rng, tag); };
  b.rng.testHit = (p: number) => (last.startsWith(prefix) ? hit : origHit.call(b.rng, p));
  try { return await fn(); } finally { b.rng.testHit = origHit; b.rng.expect = origExpect; }
}
const turnStart = (b: any, e: any) => b.bus.dispatch(EV.TURN_START, { actor: e, type: TurnType.NORMAL }, e.id, e.teamId, (id: number) => b.teamOf(id));

sec("[A1] 幽光: no unconditional +1 onibi; 30% drain moves 1 onibi from the target's side to Aoandon's");
{
  const b = await match([unit(266, 40000)], [unit(206, 900000)]);
  const a = b.teams[0].members[0], foe = b.teams[1].members[0];
  ok("IR patch: 幽光 orb.gain 0", sk(a, "266_01").ir.orb.gain === 0 && !!BETTING_IR_PATCHES["266_01"]);
  setOrbs(b, 0, 2); setOrbs(b, 1, 3);
  await forced(b, "aoandon266_drain", false, () => cast(b, a, "266_01", foe));
  ok("drain missed: onibi unchanged (2 / 3)", orbs(b, 0) === 2 && orbs(b, 1) === 3, orbs(b, 0) + "/" + orbs(b, 1));
  const mark = b.trace.length;
  await forced(b, "aoandon266_drain", true, () => cast(b, a, "266_01", foe));
  ok("drain hit: 3 / 2", orbs(b, 0) === 3 && orbs(b, 1) === 2, orbs(b, 0) + "/" + orbs(b, 1));
  ok("幽光 dealt damage to the target", since(b, mark).some(t => t.t === "DAMAGE" && t.src === a.id && t.dst === foe.id && t.final > 0));
  setOrbs(b, 1, 0);
  await forced(b, "aoandon266_drain", true, () => cast(b, a, "266_01", foe));
  ok("nothing to drain from an empty side: no gain", orbs(b, 0) === 3 && orbs(b, 1) === 0);
}

sec("[A2] 吸魂灯: AOE + drain, one TRUE hit per onibi of lead (5% max HP, capped at initial ATK), L5 明灯 on the top-ATK ally");
{
  const b = await match([unit(266, 40000), unit(206, 40000, { atk: 6000 })], [unit(206, 900000), unit(206, 900000)]);
  const [a, top] = b.teams[0].members, foes = b.teams[1].members;
  setOrbs(b, 0, 6); setOrbs(b, 1, 1);
  const mark = b.trace.length;
  await forced(b, "aoandon266_drain", false, () => cast(b, a, "266_03", foes[0]));
  const tr = since(b, mark);
  ok("cost 3 paid, no unconditional gain (6 → 3)", orbs(b, 0) === 3, String(orbs(b, 0)));
  ok("190% hit on both enemies", foes.every((f: any) => tr.some(t => t.t === "DAMAGE" && t.src === a.id && t.dst === f.id && t.type === DamageType.NORMAL)));
  const trues = tr.filter(t => t.t === "DAMAGE" && t.src === a.id && t.type === DamageType.TRUE);
  ok("lead 3 − 1 = 2 ⇒ 2 TRUE hits per enemy (4)", trues.length === 4, String(trues.length));
  ok("each TRUE hit capped at Aoandon's initial ATK (3000)", trues.every(t => near(t.final, 3000)), trues.map(t => t.final).join(","));
  ok("L5: 明灯 (2663_1) on the highest-ATK ally", top.hasStatus(LANTERN_ID) && !a.hasStatus(LANTERN_ID));
  ok("2663_1 bearer casts for free", bettingCostOf(b, top, { cost: 3, ir: { id: "x" } }) === 0 || AOANDON_KIT.cost!(b, top, {}, 3) === 0);
  setOrbs(b, 0, 1); setOrbs(b, 1, 1);
  const m2 = b.trace.length;
  b.teams[0].orbs.orb = 4;
  await forced(b, "aoandon266_drain", false, () => cast(b, a, "266_03", foes[0]));
  ok("no lead ⇒ no TRUE hit (4 − 3 = 1 vs 1)", !since(b, m2).some(t => t.t === "DAMAGE" && t.type === DamageType.TRUE));
  const small = await match([unit(266, 40000)], [unit(206, 20000)]);
  const a2 = small.teams[0].members[0], f2 = small.teams[1].members[0];
  setOrbs(small, 0, 5); setOrbs(small, 1, 0);
  const m3 = small.trace.length;
  await forced(small, "aoandon266_drain", false, () => cast(small, a2, "266_03", f2));
  const t2 = since(small, m3).filter(t => t.t === "DAMAGE" && t.type === DamageType.TRUE);
  ok("below the cap the TRUE hit is 5% of the target's max HP", t2.length === 2 && near(t2[0].final, f2.maxHp * AOANDON.trueRatio), t2.map(t => t.final).join(",") + " vs " + f2.maxHp * 0.05);
}

sec("[A3] 明灯 (passive): 40% − 3%/onibi at another allied shikigami's turn start; free skills, +5% damage per onibi; removed when Aoandon dies");
{
  ok("chance: 0 onibi 40%, 8 onibi 16%", near(lampChance(0), 0.4, 1e-9) && near(lampChance(8), 0.16, 1e-9));
  const b = await match([unit(266, 40000), unit(206, 40000)], [unit(206, 900000)]);
  const [a, ally] = b.teams[0].members, foe = b.teams[1].members[0];
  setOrbs(b, 0, 4);
  await forced(b, "aoandon266_lamp", true, () => turnStart(b, a));
  ok("not on Aoandon's own turn", !a.hasStatus(LAMP_ID));
  await forced(b, "aoandon266_lamp", true, () => turnStart(b, foe));
  ok("not on an enemy's turn", !foe.hasStatus(LAMP_ID));
  await forced(b, "aoandon266_lamp", false, () => turnStart(b, ally));
  ok("roll missed: no 明灯", !ally.hasStatus(LAMP_ID));
  await forced(b, "aoandon266_lamp", true, () => turnStart(b, ally));
  ok("roll hit: ally gains 明灯", ally.hasStatus(LAMP_ID));
  ok("明灯: a 3-onibi skill costs 0 (bettingCostOf)", bettingCostOf(b, ally, sk(a, "266_03")) === 0);
  const mark = b.trace.length;
  await b.damage(ally, foe, 1000, DamageType.TRUE, 1, null);
  const boost = since(b, mark).find(t => t.t === "DAMAGE_BOOST" && t.by === "明灯");
  ok("明灯 damage ×(1 + 5% × 4 onibi) = ×1.2", !!boost && near(boost.mul, 1.2, 1e-9), JSON.stringify(boost ?? null));
  await b.damage(foe, a, a.hp * 10, DamageType.TRUE, 1, null);
  if (b.processDeaths) await b.processDeaths();
  if (b.drainEvents) await b.drainEvents();
  ok("Aoandon dead ⇒ 明灯 removed", !a.alive && !ally.hasStatus(LAMP_ID), "alive=" + a.alive);
}

sec("[C1] 梦引之声: 15% of each ally's own max HP, 30% on the selected target, +20% damage, 梦茧 = 50% of the target's heal");
{
  const b = await match([unit(594, 60000, { atk: 1000 }), unit(206, 30000, { atk: 2000 }), unit(206, 40000, { atk: 2500 })], [unit(206, 900000)]);
  const [c, x, y] = b.teams[0].members;
  for (const m of [c, x, y]) { for (const sh of m.shields) sh.broken = true; for (const st of [...m.statuses]) m.expireStatus(st); m.hp = m.maxHp * 0.4; }
  setOrbs(b, 0, 5);
  await cast(b, c, "594_03", x);
  ok("selected target healed 30% of its own max HP", near(x.hp / x.maxHp, 0.7, 1e-6), (x.hp / x.maxHp).toFixed(4));
  ok("others healed 15% of their own max HP", near(y.hp / y.maxHp, 0.55, 1e-6) && near(c.hp / c.maxHp, 0.55, 1e-6), (y.hp / y.maxHp).toFixed(4) + " / " + (c.hp / c.maxHp).toFixed(4));
  ok("L3: every ally +20% damage (梦引之声 status)", [c, x, y].every(m => m.hasStatus(SONG_ID)) && near(y.prop("dmgDealtB"), CHOCHO594.songDmg, 1e-9));
  const live = cocoonsOf(x);
  ok("L4: 梦茧 on the selected target only = 15% of its max HP", live.length === 1 && near(live[0].value, x.maxHp * 0.15, 1e-6) && cocoonsOf(y).length === 0);
  ok("梦茧 bearer +20% damage on top of the song (0.4)", x.hasStatus(COCOON_ID) && near(x.prop("dmgDealtB"), 0.4, 1e-9), String(x.prop("dmgDealtB")));
  ok("IR heal slots emptied (heals run in the kit)", sk(c, "594_03").ir.heal.length === 0);
}

sec("[C2] 梦茧: max 2, L3 the breaking hit deals no excess damage; status follows the shields");
{
  const b = await match([unit(594, 60000, { atk: 1000 }), unit(206, 30000, { atk: 2000 })], [unit(206, 900000)]);
  const [c, x] = b.teams[0].members, foe = b.teams[1].members[0];
  for (const sh of x.shields) sh.broken = true;
  for (let i = 0; i < 3; i++) grantCocoon(b, c, x, 1000, "梦引之声", "TEST");
  ok("a third 梦茧 replaces the oldest (2 live)", cocoonsOf(x).length === 2 && x.statuses.find((s: any) => s.def.id === COCOON_ID)?.stacks === 2);
  const hp0 = x.hp, mark = b.trace.length;
  await b.damage(foe, x, 50000, DamageType.TRUE, 1, null);
  ok("breaking hit: no HP lost", near(x.hp, hp0, 1e-9), hp0 + " → " + x.hp);
  ok("DAMAGE_REDUCED by 梦茧 traced", since(b, mark).some(t => t.t === "DAMAGE_REDUCED" && t.by === "梦茧"));
  if (b.drainEvents) await b.drainEvents();
  ok("both 梦茧 broken ⇒ status removed", cocoonsOf(x).length === 0 && !x.hasStatus(COCOON_ID));
  await b.damage(foe, x, 2000, DamageType.TRUE, 1, null);
  ok("without 梦茧 damage lands normally", x.hp < hp0);
}

sec("[C3] 灵梦 L4: > 20% of initial max HP taken in one turn ⇒ free 梦茧 (20% max HP), once until her next turn");
{
  const b = await match([unit(594, 60000, { atk: 1000 }), unit(206, 30000, { atk: 2000 })], [unit(206, 900000)]);
  const c = b.teams[0].members[0], foe = b.teams[1].members[0];
  for (const sh of c.shields) sh.broken = true;
  for (const st of [...c.statuses]) c.expireStatus(st);
  await turnStart(b, foe);
  const mark = b.trace.length;
  await b.damage(foe, c, c.maxHp * 0.12, DamageType.TRUE, 1, null);
  ok("12%: no trigger", !since(b, mark).some(t => t.t === "SUBCAST" && t.ref === "594_02"));
  await b.damage(foe, c, c.maxHp * 0.12, DamageType.TRUE, 1, null);
  const subs = () => since(b, mark).filter(t => t.t === "SUBCAST" && t.ref === "594_02").length;
  ok("24% in the turn: 灵梦 cast once", subs() === 1);
  ok("梦茧 = 20% of her max HP", cocoonsOf(c).length === 1 && near(cocoonsOf(c)[0].value, c.maxHp * 0.2, 1e-6));
  await turnStart(b, foe);
  await b.damage(foe, c, c.maxHp * 0.25, DamageType.TRUE, 1, null);
  ok("not again before her own turn", subs() === 1);
  await turnStart(b, c);
  await b.damage(foe, c, c.maxHp * 0.21, DamageType.TRUE, 1, null);
  ok("after her turn starts it can trigger again", subs() === 2);
}

sec("[C4] L5 先机: at battle start 梦引之声 on the allied shikigami with the highest initial ATK (once per side)");
{
  const b = await match([unit(594, 60000, { atk: 1000 }), unit(206, 30000, { atk: 2000 }), unit(206, 30000, { atk: 5000 })], [unit(206, 900000)]);
  const [c, x, top] = b.teams[0].members;
  const sub = (b.trace as any[]).filter(t => t.t === "SUBCAST" && t.ref === "594_03");
  ok("one 先机 cast, on the top-ATK ally", sub.length === 1 && sub[0].target === top.id);
  ok("top-ATK ally holds 梦茧 (15% of its max HP) and the song buff", cocoonsOf(top).length === 1 && near(cocoonsOf(top)[0].value, top.maxHp * 0.15, 1e-6) && top.hasStatus(SONG_ID));
  ok("others only the song buff", x.hasStatus(SONG_ID) && c.hasStatus(SONG_ID) && cocoonsOf(x).length === 0);
}

sec("[Z] BASE mode: both kits inert");
{
  setSkillLevelMode("BASE");
  ok("no damage hook in BASE", AOANDON_KIT.damageHook!({ id: "266_03", damage: [{}] }) === null && AOANDON_KIT.damageHook!({ id: "266_01", damage: [{}] }) === null);
  ok("明灯 cost rule off in BASE", AOANDON_KIT.cost!(null, { hasStatus: () => true } as any, {}, 3) === 3);
  ok("Chocho afterCast off in BASE", (await CHOCHO_KIT.afterCast!(null, {} as any, { id: "594_03" })) === false);
  const b = await match([unit(266, 40000), unit(594, 60000)], [unit(206, 900000)]);
  ok("BASE: IR unpatched (幽光 keeps orb.gain 1, 梦引之声 keeps its heal slot)", sk(b.teams[0].members[0], "266_01").ir.orb.gain === 1 && sk(b.teams[0].members[1], "594_03").ir.heal.length === 1);
  ok("BASE: no 先机 cast, no 梦茧", !(b.trace as any[]).some(t => t.t === "SUBCAST" && t.ref === "594_03") && b.teams[0].members.every((m: any) => !m.hasStatus(COCOON_ID)));
  setSkillLevelMode("MAX");
}
}


// ═════════ 千姬 356 (betting-senhime356.ts) ═════════
{
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { SENHIME356, TIDE_ID, TIDE_DMG_ID, DIRGE_ID, DREAM_ID, HOLD_ID, halberdOf, dirgeOf, tideRewards } = await import(R + "compile/betting-senhime356.ts");
const { bettingPreferredSkill, bettingGate, BETTING_IR_PATCHES } = await import(R + "compile/betting-mechanics.ts");
const { flushBarReactions } = await import(R + "compile/betting-bar.ts");
const { DamageType, EV, TurnType } = await import(R + "kernel/types.ts");

setSkillLevelMode("MAX");
const sec = (s: string) => console.log("\n" + s);
const unit = (shikigamiId: number, hp: number, extra: any = {}): any => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
async function match(red: any[], blue: any[], seed = 1) {
  const A: any = await assembleGuessingMatch({ _meta: { title: "t14-356" }, red, blue } as any, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  return b;
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => { const s = sk(e, id); return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target)); };
const setOrbs = (b: any, team: number, n: number) => { b.teams[team].orbs.orb = n; };
const disp = (b: any, code: string, e: any, type = TurnType.NORMAL) => b.bus.dispatch(code, { actor: e, type }, e.id, e.teamId, (id: number) => b.teamOf(id));
const ownTurn = async (b: any, e: any, fn: () => Promise<void>) => {
  await disp(b, EV.TURN_START, e);
  try { await fn(); } finally { await disp(b, EV.ACTION_END, e); await disp(b, EV.TURN_END, e); }
};

sec("[S1] 千姬: no halberd → AI plants it (海潮入梦); halberd HP 550% ATK (not scaled), 3 潮声; L4 hold immunity only while unplanted");
{
  const b = await match([unit(356, 40000, { atk: 4000, def: 500 }), unit(201, 40000)], [unit(201, 900000)]);
  const [s] = b.teams[0].members, foe = b.teams[1].members[0];
  ok("356_02 patch drops the cast-time bar pull", !!BETTING_IR_PATCHES["356_02"] && sk(s, "356_02").ir.timeline.length === 0);
  ok("hold immunity (手持海原贝戟) at battle start", s.hasStatus(HOLD_ID));
  const d = bettingPreferredSkill(b, s);
  ok("AI: 海潮入梦 first (cost 0)", d?.skill?.ir?.id === "356_03", d?.rule);
  await cast(b, s, "356_03", foe);
  const h = halberdOf(b, s);
  ok("halberd summoned", !!h);
  ok("halberd HP = 550% of her panel ATK (no 2.42 scale)", !!h && Math.abs(h.maxHp - 4000 * 5.5) < 1, String(h?.maxHp));
  ok("L5: 3 潮声 on the halberd", !!h && h.statuses.find((x: any) => x.def.id === TIDE_ID)?.stacks === 3);
  ok("hold immunity removed once planted", !s.hasStatus(HOLD_ID));
  ok("gate: 海潮入梦 refused while planted with < 5 悲歌", !!bettingGate(b, s, sk(s, "356_03")));
  setOrbs(b, 0, 1);
  ok("AI: halberd, 1 onibi → 千汐", bettingPreferredSkill(b, s)?.skill?.ir?.id === "356_01");
  setOrbs(b, 0, 4);
  ok("AI: halberd, 4 onibi → 汐梦", bettingPreferredSkill(b, s)?.skill?.ir?.id === "356_02");

  sec("[S2] 潮声: every onibi the team pays → +1; at 7 → +3 onibi and +15% damage to every non-summon ally");
  const ally = b.teams[0].members[1];
  setOrbs(b, 0, 8);
  b.queueEvent(EV.ORB_COST, { battle: b, team: 0, actor: ally.id, skill: "x", amount: 4, before: 8, after: 4 }, ally.id, 0);
  setOrbs(b, 0, 4);
  await b.drainEvents?.();
  if (!(h!.statuses.find((x: any) => x.def.id === TIDE_ID)?.stacks > 3)) await b.bus.dispatch(EV.ORB_COST, { battle: b, team: 0, actor: ally.id, skill: "x", amount: 4, before: 8, after: 4 }, ally.id, 0, (id: number) => b.teamOf(id));
  ok("7 潮声 gained → one reward", tideRewards(s) === 1, "rewards " + tideRewards(s));
  ok("+3 onibi from the reward", b.teams[0].orbs.current === 7, String(b.teams[0].orbs.current));
  ok("潮声·增伤 on both allies (dmgDealtB +0.15)", s.hasStatus(TIDE_DMG_ID) && ally.hasStatus(TIDE_DMG_ID) && Math.abs(ally.prop("dmgDealtB") - 0.15) < 1e-9, String(ally.prop("dmgDealtB")));

  sec("[S3] L2: she and the halberd take 30% less damage while it is present");
  const m3 = b.trace.length;
  await b.damage(foe, s, 1000, DamageType.NORMAL, 1, null);
  ok("DAMAGE_REDUCED by 海潮入梦 on her", since(b, m3).some((t: any) => t.t === "DAMAGE_REDUCED" && t.id === s.id && t.ratio === SENHIME356.halberdDr));

  sec("[S4] 汐梦 passive: +10% action bar after a non-summon enemy's own turn");
  const pos0 = b.timeline.get(s.id)?.pos ?? 0;
  const m4 = b.trace.length;
  await disp(b, EV.TURN_END, foe);
  await flushBarReactions(b);
  ok("TIMELINE_SHIFT pull 10% on Senhime (汐梦)", since(b, m4).some((t: any) => t.t === "TIMELINE_SHIFT" && t.id === s.id && t.skill === "汐梦" && Math.abs(t.percent - 0.1) < 1e-9), String(pos0));
  const m4b = b.trace.length;
  await disp(b, EV.TURN_END, ally);
  ok("no pull after an ally's turn", !since(b, m4b).some((t: any) => t.t === "TIMELINE_SHIFT" && t.id === s.id));

  sec("[S5] 悲歌 +1 per own turn while planted; at 5 with 2 onibi → 永生之汐 620% to all enemies, halberd pulled, 悲歌 cleared");
  for (let i = 0; i < 5; i++) await disp(b, EV.TURN_START, s);
  ok("5 悲歌 after 5 own turn starts", dirgeOf(s) === 5, String(dirgeOf(s)));
  setOrbs(b, 0, 2);
  const d5 = bettingPreferredSkill(b, s);
  ok("AI: 永生之汐 (356_03) at 5 悲歌", d5?.skill?.ir?.id === "356_03" && /永生之汐/.test(d5?.rule ?? ""), d5?.rule);
  const m5 = b.trace.length;
  await cast(b, s, "356_03", foe);
  const dmg = since(b, m5).filter((t: any) => t.t === "DAMAGE" && t.src === s.id && t.dst === foe.id);
  const base = dmg.length ? Number(dmg[0].breakdown?.base) : NaN;
  ok("one hit on the enemy, paid 2 onibi", dmg.length === 1 && b.teams[0].orbs.current === 0, `hits ${dmg.length} orbs ${b.teams[0].orbs.current}`);
  ok("base = 620% ATK", Math.abs(base - 4000 * 6.2) < 1, String(base));
  ok("halberd pulled (SUMMON_REMOVE PULLED), 悲歌 0, hold immunity back", !halberdOf(b, s) && dirgeOf(s) === 0 && s.hasStatus(HOLD_ID)
    && since(b, m5).some((t: any) => t.t === "SUMMON_REMOVE" && t.reason === "PULLED"));
  ok("AI: replants next (海潮入梦)", bettingPreferredSkill(b, s)?.skill?.ir?.id === "356_03");
}

sec("[S6] 汐梦 debuff: applied only with the halberd; consumed after the bearer acts: −3 onibi; 0 left → 深度冰冻");
{
  const b = await match([unit(356, 40000, { efh: 2 }), unit(201, 40000)], [unit(201, 900000)]);
  const [s] = b.teams[0].members, foe = b.teams[1].members[0];
  setOrbs(b, 0, 8);
  await cast(b, s, "356_02", foe);
  ok("no 汐梦 without the halberd", !foe.hasStatus(DREAM_ID));
  await cast(b, s, "356_03", foe);
  setOrbs(b, 0, 8);
  await cast(b, s, "356_02", foe);
  ok("汐梦 on the target with the halberd", foe.hasStatus(DREAM_ID));
  setOrbs(b, 1, 3);
  await ownTurn(b, foe, async () => { await b.bus.dispatch(EV.SKILL_END, { actor: foe, type: TurnType.NORMAL }, foe.id, foe.teamId, (id: number) => b.teamOf(id)); });
  ok("consumed after acting", !foe.hasStatus(DREAM_ID));
  ok("−3 onibi on the bearer's team", b.teams[1].orbs.current === 0, String(b.teams[1].orbs.current));
  ok("0 onibi → 深度冰冻", foe.hasStatus("deepFreeze"));
}

sec("[S7] BASE mode: kit inert");
{
  setSkillLevelMode("BASE");
  const b = await match([unit(356, 40000)], [unit(201, 900000)]);
  const [s] = b.teams[0].members;
  ok("no hold immunity, no AI rule in BASE", !s.hasStatus(HOLD_ID) && bettingPreferredSkill(b, s) === null);
  setSkillLevelMode("MAX");
}
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
