// tests/betting-mechanics-21.ts — match-15 kits (2026-11-24g), MAX (betting) mode:
//   · 山兔 237 wiki AI (S2 with no 兔子舞 on the side, else S3), 兔子舞 +30% bar to all / +20% ATK (L4 40% lowest bar),
//     幸运套环 Morph on the target's turns + L5 free 兔子舞 (betting-yamausagi.ts);
//   · 一目连 272 KB AI, 风符·破 single-target steal, 风符·护 ward (shield on the ally, burst + push on break / expiry,
//     先机 at battle start), 风神之佑 timed shields + ATK / RES, L4/L5 re-cast (betting-ichimokuren.ts);
//   · 垢尝 361 搓澡澡 dispel after an enemy turn + 霉球 (cap 4, cleared at his turn end), 脏兮兮 −25% hit (betting-akaname.ts);
//   · 海月火玉 Wispzoa: +1 onibi, x1.4 damage (soul/custom-effects-betting.ts);
//   · BASE mode: none of the kits answer.
// Run: node battle-lab/tests/betting-mechanics-21.ts
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { TurnType, EV, DamageType } = await import(R + "kernel/types.ts");
const { StatusBook } = await import(R + "kernel/status.ts");
const { YAMAUSAGI, YAMAUSAGI_AI, DANCE_ID } = await import(R + "compile/betting-yamausagi.ts");
const { ICHIMOKUREN, WARD_ID, BLESS_ID } = await import(R + "compile/betting-ichimokuren.ts");
const { AKANAME, MOLD_ID, moldOn } = await import(R + "compile/betting-akaname.ts");
const { M15_KITS } = await import(R + "compile/betting-m15.ts");
const { M7_PATCHES, m7RuleSkill } = await import(R + "compile/betting-m7.ts");
const { bettingAiRuleOf, bettingKitSkillOf } = await import(R + "compile/betting-coverage.ts");
const { BETTING_ONLY_SOULS } = await import(R + "soul/custom-effects.ts");
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
  const A = await assembleGuessingMatch({ _meta: { title: "t21" }, red, blue } as any, { seed, traceLevel: "FULL" });
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
const hit = (b: any, src: any, dst: any, base: number, type = DamageType.NORMAL) =>
  b.withinResolution({ id: "SKILL:t21", type: "SKILL" }, () => dealDamage(b, { source: src, target: dst, base, rate: 1, type, skillTag: "t21" }));

sec("[0] Wiring");
{
  ok("betting-m15 lists 3 kits", M15_KITS.length === 3);
  ok("237 / 272: hand-written AI rules declared", !!bettingAiRuleOf(237) && !!bettingAiRuleOf(272));
  ok("361: KB AI kept (basic only)", bettingAiRuleOf(361) === null);
  for (const id of ["237_02", "237_03", "272_01", "272_02", "272_03", "361_01", "361_02"]) ok(`${id}: kit skill declared`, !!bettingKitSkillOf(id));
  ok("272_01 patch: compiled all-enemy steal removed", (M7_PATCHES["272_01"]?.patch as any)?.steals?.length === 0);
  ok("272_02 patch: compiled immediate hits / self shield removed", (M7_PATCHES["272_02"]?.patch as any)?.damage?.length === 0 && (M7_PATCHES["272_02"]?.patch as any)?.shield?.length === 0);
  ok("海月火玉 is a betting-only soul", BETTING_ONLY_SOULS.has("海月火玉"));
  ok("Yamausagi default AI = wiki summary (S2 without 兔子舞)", YAMAUSAGI_AI.s2WhenNoDance === true);
}

sec("[1] 山兔: AI, 兔子舞 bar + ATK, L4 lowest bar 40%");
{
  const { b, find } = await match([unit(237, 30000, { spd: 200 }), unit(220, 30000), unit(220, 30000)], [unit(220, 90000)]);
  const y = find(237, 0), [, a1, a2] = b.teams[0].members;
  b.teams[0].orbs.orb = 8;
  ok("no 兔子舞 on the side ⇒ 兔子舞", m7RuleSkill(b, y, costOf)?.skill?.ir?.id === "237_02");
  b.timeline.shift(a1.id, 0.5);
  const atk0 = a1.prop("atk"), atk2 = a2.prop("atk");
  const mark = b.trace.length;
  await cast(b, y, "237_02", y);
  const pulls = since(b, mark).filter((t: any) => t.t === "TIMELINE_SHIFT" && t.skill === "兔子舞" && t.direction === "pull");
  ok("+30% bar to every ally (3 pulls)", pulls.length === 3 && pulls.every((t: any) => Math.abs(t.percent - YAMAUSAGI.bar) < 1e-9));
  ok("兔子舞 on every ally", [y, a1, a2].every((m: any) => m.hasStatus(DANCE_ID)));
  ok("+20% ATK on a non-lowest ally", Math.abs(a1.prop("atk") - atk0 * 1.2) < 2, `${atk0} → ${a1.prop("atk")}`);
  const lowest = [y, a2].find((m: any) => since(b, mark).some((t: any) => t.t === "STATUS_APPLY" && t.dst === m.id && /L4/.test(String(t.note))));
  ok("L4: one lowest-bar ally gets +40%", !!lowest);
  if (lowest === a2) ok("…its ATK is +40%", Math.abs(a2.prop("atk") - atk2 * 1.4) < 2, `${atk2} → ${a2.prop("atk")}`);
  b.teams[0].orbs.orb = 8;
  ok("an ally has 兔子舞 ⇒ 幸运套环", m7RuleSkill(b, y, costOf)?.skill?.ir?.id === "237_03");
  b.teams[0].orbs.orb = 1;
  ok("no onibi ⇒ 谁还不听话", m7RuleSkill(b, y, costOf)?.skill?.ir?.id === "237_01");
  YAMAUSAGI_AI.s2WhenNoDance = false;
  for (const m of [y, a1, a2]) for (const st of [...m.statuses]) if (st.def.id === DANCE_ID) m.expireStatus(st);
  b.teams[0].orbs.orb = 8;
  ok("alternative (parsed KB rows): always 幸运套环", m7RuleSkill(b, y, costOf)?.skill?.ir?.id === "237_03");
  YAMAUSAGI_AI.s2WhenNoDance = true;
}

sec("[2] 山兔: 幸运套环 Morph (target turns) + L5 free 兔子舞");
{
  const { b, find } = await match([unit(237, 30000, { efh: 99 }), unit(220, 30000)], [unit(220, 900000)]);
  const y = find(237, 0), foe = b.teams[1].members[0];
  let landed = false, seed = 0;
  for (let i = 0; i < 80 && !landed; i++) {
    b.teams[0].orbs.orb = 8;
    const mark = b.trace.length;
    await cast(b, y, "237_03", foe);
    if (i === 0) {
      const d = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === y.id);
      ok("one damage event on the target", d.length === 1 && d[0].dst === foe.id);
    }
    landed = foe.hasStatus("morph");
    if (landed) {
      seed = i;
      ok("Morph landed ⇒ free 兔子舞 (SUBCAST + 兔子舞 on Yamausagi)", since(b, mark).some((t: any) => t.t === "SUBCAST" && t.ref === "237_02") && y.hasStatus(DANCE_ID));
      ok("no onibi paid for the free 兔子舞", !since(b, mark).some((t: any) => t.t === "ORB_PAY" && t.skill === "兔子舞"));
      const st = foe.statuses.find((s: any) => s.def.id === "morph");
      ok("Morph counts the target's turns", st?.def?.durationPolicy === "TARGET_TURN" && st?.remaining === YAMAUSAGI.morphTurns);
      await disp(b, EV.TURN_END, y);
      ok("still morphed after Yamausagi's turn end", foe.hasStatus("morph"));
    }
  }
  ok("Morph landed within 80 casts", landed, "cast " + seed);
}

sec("[3] 一目连: AI, 风符·破 steals only from the target");
{
  const { b, find } = await match([unit(272, 30000), unit(220, 30000)], [unit(220, 90000), unit(220, 90000)]);
  const i = find(272, 0), ally = b.teams[0].members.find((e: any) => e.id !== i.id);
  const [f1, f2] = b.teams[1].members;
  b.teams[0].orbs.orb = 8;
  ok("all allies ≥ 40% ⇒ 风神之佑", m7RuleSkill(b, i, costOf)?.skill?.ir?.id === "272_03");
  ally.hp = ally.maxHp * 0.3;
  ok("an ally < 40% ⇒ 风符·护", m7RuleSkill(b, i, costOf)?.skill?.ir?.id === "272_02");
  b.teams[0].orbs.orb = 1;
  ok("no onibi ⇒ 风符·破", m7RuleSkill(b, i, costOf)?.skill?.ir?.id === "272_01");
  const a1 = f1.prop("atk"), a2 = f2.prop("atk");
  const mark = b.trace.length;
  await cast(b, i, "272_01", f1);
  const steals = since(b, mark).filter((t: any) => t.t === "STAT_STEAL");
  ok("one steal, on the target", steals.length === 1 && steals[0].dst === f1.id, JSON.stringify(steals.map((t: any) => t.dst)));
  ok("steals 20% of the target's ATK", steals.length === 1 && Math.abs(steals[0].toTarget - steals[0].targetBefore * ICHIMOKUREN.steal) < 1, `${steals[0]?.toTarget} of ${steals[0]?.targetBefore}`);
  ok("other enemy untouched", Math.abs(f2.prop("atk") - a2) < 1e-6);
}

sec("[4] 一目连: 先机 ward; 风符·护 on the ally; burst + push when it breaks; expiry after 2 bearer turns");
{
  const { b, find } = await match([unit(272, 30000), unit(220, 30000, { atk: 6000 })], [unit(220, 90000), unit(220, 90000)]);
  const i = find(272, 0), ally = b.teams[0].members.find((e: any) => e.id !== i.id);
  const [f1, f2] = b.teams[1].members;
  ok("先机: ward on the top-ATK ally at battle start", ally.hasStatus(WARD_ID) && b.trace.some((t: any) => t.t === "SUBCAST" && t.ref === "272_02" && t.target === ally.id));
  const sh = (ally.shields as any[]).find((s: any) => !s.broken && String(s.id).startsWith("sh_272_02_"));
  ok("shield = 20% of his max HP", !!sh && Math.abs(sh.value - i.maxHp * ICHIMOKUREN.wardShield) < 1, `${sh?.value} vs ${i.maxHp * 0.2}`);
  const hp1 = f1.hp, hp2 = f2.hp;
  const mark = b.trace.length;
  await hit(b, f1, ally, sh.value * 5, DamageType.TRUE);
  ok("ward gone after the break", !ally.hasStatus(WARD_ID));
  ok("burst on both enemies", f1.hp < hp1 && f2.hp < hp2 && since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === i.id).length >= 2);
  ok("L3 push 20% on both enemies", since(b, mark).filter((t: any) => t.t === "TIMELINE_SHIFT" && t.direction === "push" && t.skill === "风符·护").length >= 2);
  b.teams[0].orbs.orb = 8;
  ally.hp = ally.maxHp * 0.3;
  const m2 = b.trace.length;
  await cast(b, i, "272_02", ally);
  ok("cast: ward on the ally, no immediate damage", ally.hasStatus(WARD_ID) && !since(b, m2).some((t: any) => t.t === "DAMAGE"));
  ok("cast: no shield on Ichimokuren himself", !(i.shields as any[]).some((s: any) => !s.broken && String(s.id).startsWith("sh_272_02_")));
  // L5: a debuff on the bearer ⇒ enemies −5%.
  const m3 = b.trace.length;
  const deb = [...StatusBook.values()].find((d: any) => String(d.category) === "DEBUFF_STATE" && d.dispellable && !d.preventsAction);
  if (deb) {
    ally.addStatus(deb, f1.id, 1, 2, [], 1);
    await b.drainEvents();
    ok("L5: debuff on the bearer ⇒ push 5%", since(b, m3).some((t: any) => t.t === "TIMELINE_SHIFT" && Math.abs(t.percent + ICHIMOKUREN.l5Push) < 1e-9));
  }
  await disp(b, EV.TURN_END, ally);
  ok("still warded after 1 bearer turn", ally.hasStatus(WARD_ID));
  const m4 = b.trace.length;
  await disp(b, EV.TURN_END, ally);
  ok("expired after 2 bearer turns ⇒ burst", !ally.hasStatus(WARD_ID) && since(b, m4).some((t: any) => t.t === "PASSIVE_PROC" && /到期/.test(t.effect)));
}

sec("[5] 一目连: 风神之佑 shields expire, +10% ATK / +15% RES, L4/L5 re-cast");
{
  const { b, find } = await match([unit(272, 30000), unit(220, 30000)], [unit(220, 90000)]);
  const i = find(272, 0), ally = b.teams[0].members.find((e: any) => e.id !== i.id);
  const atk0 = ally.prop("atk"), res0 = ally.prop("efr");
  b.teams[0].orbs.orb = 8;
  await cast(b, i, "272_03", ally);
  const shields = () => (ally.shields as any[]).filter((s: any) => !s.broken && String(s.id).startsWith("sh_272_03_"));
  ok("风佑 shield 18% of his max HP", shields().length === 1 && Math.abs(shields()[0].value - i.maxHp * ICHIMOKUREN.blessShield) < 1);
  ok("+10% ATK, +15% RES", Math.abs(ally.prop("atk") - atk0 * 1.1) < 2 && Math.abs(ally.prop("efr") - res0 - 0.15) < 1e-6, `${ally.prop("atk")} / ${ally.prop("efr")}`);
  shields()[0].value = 1000;
  ally.hp = ally.maxHp * 0.5;
  const hp0 = ally.hp;
  b.teams[0].orbs.orb = 8;
  await cast(b, i, "272_03", ally);
  ok("L5: re-cast heals 80% of the remaining shield", Math.abs(ally.hp - hp0 - 800) < 2, `${hp0} → ${ally.hp}`);
  ok("L4: +20% ATK / +30% RES for 1 turn", Math.abs(ally.prop("atk") - atk0 * 1.3) < 2 && Math.abs(ally.prop("efr") - res0 - 0.45) < 1e-6, `${ally.prop("atk")} / ${ally.prop("efr")}`);
  ok("one live 风佑 shield", shields().length === 1);
  await disp(b, EV.TURN_END, ally);
  await disp(b, EV.TURN_END, ally);
  ok("shield gone after 2 bearer turns", shields().length === 0);
  const bst = ally.statuses.find((x: any) => x.def.id === BLESS_ID);
  ok("风佑 counts 2 bearer turns", bst?.def?.durationPolicy === "TARGET_TURN" && bst?.remaining === ICHIMOKUREN.blessTurns);
}

sec("[6] 垢尝: 搓澡澡 dispel after an enemy turn, 霉球 cap 4, cleared at his turn end; 脏兮兮 −25% hit");
{
  const { b, find } = await match([unit(220, 30000, { efh: 50 })], [unit(361, 60000), unit(220, 60000)]);
  const a = find(361, 1), ally = b.teams[1].members.find((e: any) => e.id !== a.id), foe = b.teams[0].members[0];
  const deb = [...StatusBook.values()].filter((d: any) => String(d.category) === "DEBUFF_STATE" && d.dispellable && !d.preventsAction).slice(0, 4);
  for (const d of deb) ally.addStatus(d, foe.id, 1, 5, [], 1);
  const n0 = ally.statuses.filter((s: any) => s.def.dispellable && String(s.def.category).startsWith("DEBUFF")).length;
  await disp(b, EV.TURN_END, foe);
  const n1 = ally.statuses.filter((s: any) => s.def.dispellable && String(s.def.category).startsWith("DEBUFF")).length;
  ok("enemy turn end ⇒ up to 3 dispelled", n0 - n1 === Math.min(3, n0), `${n0} → ${n1}`);
  ok("+1 霉球", moldOn(a) === 1);
  for (let k = 0; k < 5; k++) await disp(b, EV.TURN_END, foe);
  ok("霉球 capped at 4", moldOn(a) === AKANAME.cap);
  await disp(b, EV.TURN_END, a);
  ok("his turn end clears 霉球", moldOn(a) === 0);
  const h0 = foe.prop("efh");
  await cast(b, a, "361_01", foe);
  ok("脏兮兮: −25% effect hit (or resisted)", Math.abs(foe.prop("efh") - (h0 + AKANAME.hitDown)) < 1e-6 || b.trace.some((t: any) => t.t === "RESIST" || t.t === "STATUS_RESIST"), String(foe.prop("efh")));
}

sec("[7] 海月火玉: extra onibi + x1.4 on an onibi skill; nothing on a basic attack");
{
  const run = async (soul: number[]) => {
    const { b, find } = await match([unit(237, 30000, {}, soul)], [unit(220, 900000)]);
    const y = find(237, 0), foe = b.teams[1].members[0];
    b.teams[0].orbs.orb = 8;
    b.rules.damageFloat = 0;
    const mark = b.trace.length;
    await b.runPseudoTurn(y, TurnType.PSEUDO_TURN, { skill: sk(y, "237_03"), target: foe });
    const dmg = since(b, mark).filter((t: any) => t.t === "DAMAGE" && t.src === y.id).reduce((s: number, t: any) => s + t.final, 0);
    return { dmg, orbs: b.teams[0].orbs.current, trace: since(b, mark) };
  };
  const plain = await run([]);
  const wisp = await run([47, 47, 47, 47]);
  ok("Wispzoa: one more onibi spent", plain.orbs - wisp.orbs === 1, `${plain.orbs} vs ${wisp.orbs}`);
  ok("Wispzoa: damage x1.4", Math.abs(wisp.dmg / plain.dmg - 1.4) < 0.01, `${plain.dmg} → ${wisp.dmg}`);
}

sec("[8] BASE mode: no kit answers");
{
  setSkillLevelMode("BASE");
  const { b, find } = await match([unit(237, 30000), unit(272, 30000)], [unit(361, 20000)]);
  ok("BASE: no Yamausagi rule", m7RuleSkill(b, find(237, 0), costOf) === null);
  ok("BASE: no Ichimokuren rule", m7RuleSkill(b, find(272, 0), costOf) === null);
  ok("BASE: no coverage", bettingAiRuleOf(237) === null && bettingKitSkillOf("361_02") === null);
  ok("BASE: no 先机 ward", !find(272, 0).hasStatus(WARD_ID) && !b.teams[0].members.some((m: any) => m.hasStatus(WARD_ID)));
  ok("BASE: no 霉球 rule installed", moldOn(find(361, 1)) === 0 && MOLD_ID === "3612_1");
  setSkillLevelMode("MAX");
}

console.log(`\nbetting-mechanics-21: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
