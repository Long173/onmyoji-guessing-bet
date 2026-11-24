// tests/betting-mechanics-19.ts — match-13 kits (2026-11-24e), MAX (betting) mode:
//   · 食梦貘 257 wake-on-damage rule (not from him), 5% max-HP heal per Sleep, 食梦者 50% Sleep 1–2 bearer turns, KB AI
//     (betting-yumekui.ts);
//   · 阿香 309 attack-start 蛇之影 stacks (−8% DEF, cap 3), 蛇卒·狂暴 +40%/stack and the 3-stack Stun, 25% counter once per
//     enemy attack (betting-oko.ts);
//   · 白童子 278 不灭 free attack on enemy death, 白之护 one-hit absorb + 40% RES, souls of dead allies (betting-shiro.ts);
//   · 久次良 332 骨盾 −40% crit damage + expiry, 鲸骨·驻 marks / true-damage bonus, 以守为攻 mark + counter (1 per turn),
//     鱼鳞之备 aura / stance switch / bar, turn-end mark or heal (betting-kujira.ts);
//   · BASE mode: none of the kits answer.
// Run: node battle-lab/tests/betting-mechanics-19.ts
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { TurnType, EV, DamageType } = await import(R + "kernel/types.ts");
const { StatusBook } = await import(R + "kernel/status.ts");
const { YUMEKUI, SLEEP_ID, applySleep, YUMEKUI_AI_LITERAL } = await import(R + "compile/betting-yumekui.ts");
const { OKO, SHADOW_ID, shadowStacks, addShadow } = await import(R + "compile/betting-oko.ts");
const { GUARD_ID } = await import(R + "compile/betting-shiro.ts");
const { KUJIRA, BONE_ID, AURA_ID, hasBone, giveBone, stanceOf } = await import(R + "compile/betting-kujira.ts");
const { M13_KITS } = await import(R + "compile/betting-m13.ts");
const { M7_PATCHES, m7RuleSkill } = await import(R + "compile/betting-m7.ts");
const { bettingAiRuleOf, bettingKitSkillOf } = await import(R + "compile/betting-coverage.ts");
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
  const A = await assembleGuessingMatch({ _meta: { title: "t19" }, red, blue } as any, { seed, traceLevel: "FULL" });
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
const hit = (b: any, src: any, dst: any, base: number, type = DamageType.NORMAL, tag = "t19") => dealDamage(b, { source: src, target: dst, base, rate: 1, type, skillTag: tag });
const costOf = (s: any) => Number(s.cost) || 0;
const has = (e: any, id: string) => e.statuses.some((x: any) => x.def.id === id);

sec("[0] Wiring");
{
  ok("betting-m13 lists 4 kits", M13_KITS.length === 4);
  ok("257: hand-written AI rule declared", !!bettingAiRuleOf(257));
  for (const id of ["257_01", "257_02", "257_03", "309_02", "309_03", "278_02", "278_03", "332_01", "332_02", "332_03"]) ok(`${id}: kit skill declared`, !!bettingKitSkillOf(id));
  ok("309_03 patch: compiled unconditional stun removed", Array.isArray(M7_PATCHES["309_03"]?.patch?.controlRefs) && M7_PATCHES["309_03"].patch.controlRefs.length === 0);
  ok("332_03 patch: compiled 15% bar removed", Array.isArray(M7_PATCHES["332_03"]?.patch?.timeline) && M7_PATCHES["332_03"].patch.timeline.length === 0);
}

sec("[1] 食梦貘: Sleep heal, wake on damage except from him, 食梦者, KB AI");
{
  const { b, find } = await match([unit(257, 30000, { efh: 5 }), unit(205, 20000)], [unit(220, 50000), unit(220, 50000)]);
  const y = find(257, 0), ally = b.teams[0].members[1], [v1, v2] = b.teams[1].members;
  ally.hp = ally.maxHp * 0.3;
  const h0 = ally.hp;
  ok("Sleep lands (p = 1)", await applySleep(b, y, v1, 1, 1, "t19"));
  await b.drainEvents();
  ok("Sleep counted on the bearer's turns", v1.statuses.find((s: any) => s.def.id === SLEEP_ID)?.def.durationPolicy === "TARGET_TURN");
  ok("沉睡: lowest-ratio ally healed 5% of his max HP", Math.abs(ally.hp - h0 - y.maxHp * YUMEKUI.healRatio) < 2, `${Math.round(h0)} → ${Math.round(ally.hp)}`);
  await hit(b, y, v1, 1000);
  ok("his damage does not wake the target", has(v1, SLEEP_ID));
  await hit(b, ally, v1, 1000);
  ok("another unit's damage wakes it", !has(v1, SLEEP_ID));
  b.teams[0].orbs.orb = 8;
  ok("AI (chosen, inverted KB comparison): no heal-cut enemies → 入眠", m7RuleSkill(b, y, costOf)?.skill?.ir?.id === "257_01");
  const cutDef = { id: "t19_cut", name: "减疗", category: "DEBUFF_STATE", desc: "减疗", dispellable: true, removable: true, preventsAction: false, preventsSkill: false, forcesBasicAttack: false, suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "GLOBAL" };
  for (const v of [v1, v2]) v.addStatus(cutDef as any, y.id, 1, 9, [], 1);
  ok("AI (chosen): ≥2 heal-cut enemies → 食梦者", m7RuleSkill(b, y, costOf)?.skill?.ir?.id === "257_03");
  for (const v of [v1, v2]) for (const st of [...v.statuses]) if (st.def.id === "t19_cut") v.expireStatus(st);
  YUMEKUI_AI_LITERAL.value = true;
  ok("AI (literal KB): 食梦者 when affordable", m7RuleSkill(b, y, costOf)?.skill?.ir?.id === "257_03");
  b.teams[0].orbs.orb = 0;
  ok("AI (literal KB): no onibi → 入眠", m7RuleSkill(b, y, costOf)?.skill?.ir?.id === "257_01");
  YUMEKUI_AI_LITERAL.value = false;
  b.teams[0].orbs.orb = 8;
  let slept = 0;
  for (let i = 0; i < 6; i++) {
    for (const v of [v1, v2]) for (const st of [...v.statuses]) if (st.def.id === SLEEP_ID) v.expireStatus(st);
    await cast(b, y, "257_03", v1);
    slept += [v1, v2].filter(v => has(v, SLEEP_ID)).length;
    b.teams[0].orbs.orb = 8;
  }
  ok("食梦者 puts enemies to sleep (≈50% base chance)", slept > 0 && slept < 12, `${slept}/12`);
  const durs = new Set((b.trace as any[]).filter(x => x.t === "STATUS_APPLY" && x.status === SLEEP_ID && x.skill === "食梦者").map(x => x.duration));
  ok("Sleep 1–2 turns", [...durs].every(d => d === 1 || d === 2), [...durs].join(","));
}

sec("[2] 阿香: 蛇之影 stacks, 狂暴 scaling + 3-stack Stun, 25% counter once per attack");
{
  const { b, find } = await match([unit(309, 30000, { atk: 4000, efh: 500 }), unit(205, 30000), unit(205, 30000)], [unit(220, 90000, { def: 0 })]);
  const o = find(309, 0), [, a1, a2] = b.teams[0].members, v = b.teams[1].members[0];
  await addShadow(b, o, v);
  ok("1 stack, −8% DEF", shadowStacks(v) === 1 && v.statuses.find((s: any) => s.def.id === SHADOW_ID)?.effects?.[0]?.value === OKO.shadowDef);
  for (let i = 0; i < 4; i++) await addShadow(b, o, v);
  ok("capped at 3 stacks", shadowStacks(v) === 3);
  b.teams[0].orbs.orb = 8;
  const m = b.trace.length;
  await cast(b, o, "309_03", v);
  const d = since(b, m).find((x: any) => x.t === "DAMAGE" && x.src === o.id);
  ok("狂暴 base = (216% + 3×40%) ATK", !!d && Math.abs(d.breakdown.base - 4000 * 3.36) < 1, d ? String(Math.round(d.breakdown.base)) : "none");
  ok("3 stacks → Stun", has(v, "stun"));
  // attack start (SKILL_START) adds a stack
  const { b: b2, find: f2 } = await match([unit(309, 30000, { efh: 500 })], [unit(220, 90000)]);
  const o2 = f2(309, 0), v2 = b2.teams[1].members[0];
  await b2.bus.dispatch(EV.SKILL_START, { battle: b2, actor: o2, skill: sk(o2, "309_01"), target: v2, type: TurnType.NORMAL }, o2.id, o2.teamId, (id: number) => b2.teamOf(id));
  ok("attack start → +1 stack", shadowStacks(v2) === 1);
  // counter: across many enemy attacks on 3 allies, at most one counter per attack, some counters happen
  let counters = 0, attacks = 0, maxPer = 0;
  for (let k = 0; k < 40; k++) {
    b.turn = 1000 + k;
    for (const st of [...o.statuses]) if (st.def.id === "stun") o.expireStatus(st);
    const m2 = b.trace.length;
    await b.withinResolution({ id: "SKILL:t19", type: "SKILL" }, async () => {
      for (const t of [o, a1, a2]) await hit(b, v, t, 10);
    });
    const c = since(b, m2).filter((x: any) => x.t === "COUNTER" && x.actor === o.id).length;
    counters += c; attacks++; maxPer = Math.max(maxPer, c);
    o.hp = o.maxHp; a1.hp = a1.maxHp; a2.hp = a2.maxHp;
  }
  ok("counters happen (25% per damaged ally)", counters > 0, `${counters}/${attacks}`);
  ok("at most 1 counter per enemy attack", maxPer <= 1);
  const m3 = b.trace.length;
  b.turn = 5000;
  await hit(b, v, a1, 10, DamageType.CONDUCTION);
  ok("conducted damage: no counter roll", !since(b, m3).some((x: any) => x.t === "COUNTER"));
}

sec("[3] 白童子: 不灭, 白之护, souls");
{
  const { b, find } = await match([unit(278, 30000, { atk: 3000 }), unit(205, 30000, { atk: 5000 }), unit(205, 30000)], [unit(220, 90000, { def: 0 }), unit(220, 1)]);
  const s = find(278, 0), [, dead, ally] = b.teams[0].members, [v1, v2] = b.teams[1].members;
  const m = b.trace.length;
  await hit(b, ally, v2, 100000);
  ok("enemy dies → 不灭 normal attack", since(b, m).some((x: any) => x.t === "PASSIVE_PROC" && x.skill === "不灭") && since(b, m).some((x: any) => x.t === "DAMAGE" && x.src === s.id));
  dead.hp = 0; dead.alive = false; dead.dead = true;
  b.teams[0].orbs.orb = 8;
  const m2 = b.trace.length;
  await cast(b, s, "278_03", v1);
  ok("白之护 on every living ally", [s, ally].every((e: any) => has(e, GUARD_ID)) && Math.abs(ally.prop("efr") - 0.4) < 1e-9);
  const soul = since(b, m2).find((x: any) => x.t === "DAMAGE" && x.src === dead.id);
  ok("dead ally's soul strikes for 100% of its ATK", !!soul && Math.abs(soul.breakdown.base - dead.prop("atk")) < 1, soul ? String(Math.round(soul.breakdown.base)) : "none");
  const hp0 = ally.hp;
  await hit(b, v1, ally, 5000);
  ok("白之护 absorbs one hit entirely, then is gone", ally.hp === hp0 && !has(ally, GUARD_ID));
  await hit(b, v1, ally, 5000);
  ok("second hit lands", ally.hp < hp0);
}

sec("[4] 久次良: 骨盾, 鲸骨·驻, 以守为攻, 鱼鳞之备");
{
  const { b, find } = await match([unit(332, 30000, { atk: 4000, spd: 200 }), unit(205, 30000), unit(205, 30000)], [unit(220, 90000, { def: 0, cri: 100, crid: 200 }), unit(205, 90000)]);
  const k = find(332, 0), [, a1, a2] = b.teams[0].members, [v, v2] = b.teams[1].members;
  ok("Defense stance aura: +20% RES on allies", [k, a1, a2].every((e: any) => has(e, AURA_ID)) && Math.abs(a1.prop("efr") - KUJIRA.auraRes) < 1e-9);
  // passive: unmarked ally hit ⇒ mark + counter, once per turn
  b.turn = 10;
  const m = b.trace.length;
  await hit(b, v2, a1, 100);
  ok("unmarked ally hit → 骨盾 + counter", hasBone(a1) && since(b, m).some((x: any) => x.t === "COUNTER" && x.actor === k.id && x.target === v2.id));
  const m2 = b.trace.length;
  await hit(b, v2, a2, 100);
  ok("second unmarked ally same turn → nothing", !hasBone(a2) && !since(b, m2).some((x: any) => x.t === "COUNTER"));
  // bone shield crit cut
  giveBone(b, k, a2, "t19");
  const m3 = b.trace.length;
  await hit(b, v, a2, 1000);
  const d = since(b, m3).find((x: any) => x.t === "DAMAGE" && x.dst === a2.id);
  const noBone = 1000 * 2 * 300 / (300 + a2.prop("def"));
  ok("crit damage −40% under 骨盾", !!d && d.crit && Math.abs(d.final - noBone * (1 - KUJIRA.critCut)) < 1, d ? `${Math.round(d.final)} vs ${Math.round(noBone)}` : "none");
  await disp(b, EV.TURN_END, v);
  ok("骨盾 gone at turn end after a crit", !hasBone(a2));
  // S1: all allies marked ⇒ true-damage bonus (犬神 may counter the hit and lower his ATK: the cap reads his ATK at the bonus)
  for (const e of [k, a1, a2]) giveBone(b, k, e, "t19");
  await disp(b, EV.TURN_START, k);
  const m4 = b.trace.length;
  await cast(b, k, "332_01", v2);
  const hits = since(b, m4).filter((x: any) => x.t === "DAMAGE" && x.src === k.id);
  ok("鲸骨·驻: 100% hit + true damage min(10% max HP, 120% ATK)", hits.length === 2 && hits[1].type === "TRUE" && Math.abs(hits[1].breakdown.base - Math.min(v2.maxHp * 0.1, k.prop("atk") * 1.2)) < 1, hits.map((x: any) => x.type + ":" + Math.round(x.breakdown?.base ?? 0)).join(" ") + " maxHp=" + Math.round(v2.maxHp) + " atk=" + k.prop("atk"));
  // cast S3: stance + bars
  b.teams[0].orbs.orb = 8;
  const pos0 = b.timeline.get(a1.id)?.pos;
  const m5 = b.trace.length;
  await cast(b, k, "332_03", k);
  ok("鱼鳞之备 → Offense stance, aura removed", stanceOf(k) === "OFFENSE" && !has(a1, AURA_ID));
  const sh = since(b, m5).filter((x: any) => x.t === "TIMELINE_SHIFT");
  ok("allies +30% bar, self +60%", sh.some((x: any) => x.id === k.id && x.percent === 0.6) && sh.some((x: any) => x.id === a1.id && x.percent === 0.3) && b.timeline.get(a1.id)?.pos !== pos0);
  b.turn = 20;
  const m6 = b.trace.length;
  for (const st of [...a2.statuses]) if (st.def.id === BONE_ID) a2.expireStatus(st);
  await hit(b, v2, a2, 100);
  ok("Offense stance: no 以守为攻", !hasBone(a2) && !since(b, m6).some((x: any) => x.t === "COUNTER"));
  await cast(b, k, "332_03", k);
  ok("方圆之备 (minimal) → back to Defense stance, aura back", stanceOf(k) === "DEFENSE" && has(a1, AURA_ID));
  // turn-end: 80% mark, or heal when already marked
  a1.hp = a1.maxHp * 0.5;
  let healed = 0, marked = 0;
  for (let i = 0; i < 20; i++) {
    const before = a1.hp;
    for (const st of [...a2.statuses]) if (st.def.id === BONE_ID) a2.expireStatus(st);
    await disp(b, EV.TURN_END, a1);
    await disp(b, EV.TURN_END, a2);
    if (a1.hp > before) healed++;
    if (hasBone(a2)) marked++;
    a1.hp = a1.maxHp * 0.5;
  }
  ok("turn end: marked ally heals (≈80%)", healed >= 10 && healed < 20, `${healed}/20`);
  ok("turn end: unmarked ally gets 骨盾 (≈80%)", marked >= 10 && marked < 20, `${marked}/20`);
  const lost = a1.maxHp * 0.5;
  const h0 = a1.hp;
  for (let i = 0; i < 10 && a1.hp === h0; i++) await disp(b, EV.TURN_END, a1);
  ok("heal = min(15% lost HP, 120% ATK)", Math.abs(a1.hp - h0 - Math.min(lost * 0.15, k.prop("atk") * 1.2)) < 2, String(Math.round(a1.hp - h0)));
}

sec("[5] BASE mode: no kit answers");
{
  setSkillLevelMode("BASE");
  const { b, find } = await match([unit(257, 30000), unit(332, 30000)], [unit(220, 20000), unit(220, 20000)]);
  ok("BASE: no Yumekui rule", m7RuleSkill(b, find(257, 0), costOf) === null);
  ok("BASE: no Kujira aura", !find(332, 0).statuses.some((s: any) => s.def.id === AURA_ID));
  ok("BASE: no coverage", bettingAiRuleOf(257) === null && bettingKitSkillOf("332_03") === null);
  setSkillLevelMode("MAX");
}

console.log(`\nbetting-mechanics-19: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
