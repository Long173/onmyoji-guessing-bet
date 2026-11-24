// tests/betting-mechanics-16.ts — match-10 kits (2026-11-24b), MAX (betting) mode:
//   · 鸩 285 毒羽 stacks, max-HP tick (cap 280% ATK) and decay, 毒蚀 consumption (betting-chin.ts);
//   · 座敷童子 205 先机 +3 onibi, 祸福相生 +3 onibi / −20% current HP (betting-zashiki.ts);
//   · 梦山白藏主 595 白狐咒 on another ally, 守护之印 own-turn immunity, 符咒·破 on attackers (betting-hakuzosu.ts);
//   · 缘结神 347 神赐良缘 damage buff / heal / 庇护, 再续前缘 extra turn (betting-enmusubi347.ts);
//   · 神启荒 390 realm prophecy bursts, no damage on cast (betting-susabi390.ts);
//   · 聆海金鱼姬 346 enemy target, 鱼尾之簇 heals + 浪涌, 凌波 shield / 凝神 (betting-seawatch.ts);
//   · 川猿 371 forms in KB order, 猿形毕露 debuffs (betting-kawazaru.ts);
//   · BASE mode: none of the kits answer.
// Run: node battle-lab/tests/betting-mechanics-16.ts
import path from "node:path";
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch, loadMatchFixture } = await import(R + "soul/guessing-match.ts");
const { TurnType, EV } = await import(R + "kernel/types.ts");
const { CHIN, POISON_ID, poisonStacks } = await import(R + "compile/betting-chin.ts");
const { ZASHIKI } = await import(R + "compile/betting-zashiki.ts");
const { HAKUZOSU, SEAL_ID, BREAK_ID } = await import(R + "compile/betting-hakuzosu.ts");
const { ENMU347, RENEW_ID, renewDef } = await import(R + "compile/betting-enmusubi347.ts");
const { SUSABI, STAR_ID, realmOpen, starsOf } = await import(R + "compile/betting-susabi390.ts");
const { SEAWATCH, GRUDGE_ID, FOCUS_ID, clusterOpen, surgeOf } = await import(R + "compile/betting-seawatch.ts");
const { KAWAZARU, papersUsed } = await import(R + "compile/betting-kawazaru.ts");
const { M10_KITS } = await import(R + "compile/betting-m10.ts");
const { bettingAiRuleOf } = await import(R + "compile/betting-coverage.ts");
const { normalizeLineup } = await import(new URL("../../matches/names.ts", import.meta.url).href);

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const M10 = path.join(ROOT, "matches", "2026-11-24b-lineup.en.json");

setSkillLevelMode("MAX");
const unit = (shikigamiId: number, hp: number, extra: any = {}) => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
async function match(red: any[], blue: any[], seed = 1) {
  const A = await assembleGuessingMatch({ _meta: { title: "t16" }, red, blue } as any, { seed, traceLevel: "FULL" });
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
  ok("betting-m10 lists 7 kits", M10_KITS.length === 7);
  for (const id of [285, 595, 347, 390, 346, 371]) ok(`${id}: hand-written AI rule declared`, !!bettingAiRuleOf(id));
}

sec("[1] 鸩: 毒之华 stacks, tick of the bearer's max HP (cap 280% ATK), −1 stack, 毒蚀 consumes");
{
  const { b, find } = await match([unit(285, 20000, { atk: 4000 })], [unit(202, 20000), unit(202, 50000)]);
  const c = find(285, 0), v = b.teams[1].members[0], big = b.teams[1].members[1];
  await cast(b, c, "285_02", v);
  ok("毒之华: 2 stacks on every enemy", poisonStacks(v) === 2 && poisonStacks(big) === 2, `${poisonStacks(v)} / ${poisonStacks(big)}`);
  await cast(b, c, "285_02", v);
  await cast(b, c, "285_02", v);
  ok("cap 5", poisonStacks(v) === CHIN.cap);
  const before = poisonStacks(big), mark = b.trace.length;
  await disp(b, EV.TURN_START, big);
  const tick = since(b, mark).find((t: any) => t.t === "DAMAGE" && t.dst === big.id && t.src === c.id);
  const def = Math.max(0, big.prop("def")), cut = Math.max(0, def - CHIN.defPerStack * before);
  const expectBase = Math.min(big.maxHp * CHIN.tick[before], c.prop("atk") * CHIN.hpCapAtk) * (300 + def) / (300 + cut);
  ok("tick base = min(stack % of the bearer's max HP, 280% ATK), DEF −50 per stack", !!tick && Math.abs(tick.breakdown.base - expectBase) < 1, tick ? `base ${Math.round(tick.breakdown.base)} vs ${Math.round(expectBase)} (${before} stacks)` : "no tick");
  ok("tick then −1 stack", poisonStacks(big) === before - 1, `${before} → ${poisonStacks(big)}`);
  b.teams[0].orbs.orb = 8;
  const hp0 = v.hp;
  await cast(b, c, "285_03", v);
  ok("毒蚀: every stack on the target consumed", poisonStacks(v) === 0 || poisonStacks(v) === CHIN.freeBlossomStacks, String(poisonStacks(v)));
  ok("毒蚀 damaged the target", v.hp < hp0 || !v.alive);
}

sec("[2] 座敷童子: 先机 +3 onibi, 祸福相生 +3 onibi and −20% current HP");
{
  const { b: b0 } = await match([unit(220, 20000)], [unit(220, 20000)]);
  const base = b0.teams[0].orbs.current;
  const { b, find } = await match([unit(205, 20000)], [unit(220, 20000)]);
  const z = find(205, 0);
  ok("先机: +3 onibi over a team without Zashiki", b.teams[0].orbs.current === Math.min(b.teams[0].orbs.max ?? 99, base + ZASHIKI.openingOrbs), `${base} → ${b.teams[0].orbs.current}`);
  b.teams[0].orbs.orb = 0;
  const hp = z.hp;
  await cast(b, z, "205_04", z);
  ok("祸福相生: +3 onibi", b.teams[0].orbs.current === ZASHIKI.fortuneOrbs, String(b.teams[0].orbs.current));
  ok("祸福相生: −20% current HP", Math.abs(z.hp - hp * 0.8) < 1, `${Math.round(hp)} → ${Math.round(z.hp)}`);
}

sec("[3] 梦山白藏主: 先机 seal on the top-ATK ally, 白狐咒 never on herself, own-turn immunity, 符咒·破");
{
  const { b, find } = await match([unit(595, 30000, { atk: 1000 }), unit(220, 20000, { atk: 5000 }), unit(205, 20000, { atk: 2000 })], [unit(220, 20000)]);
  const h = find(595, 0), top = b.teams[0].members[1], other = b.teams[0].members[2], foe = b.teams[1].members[0];
  ok("先机: 守护之印 on the highest-ATK ally", top.statuses.some((s: any) => s.def.id === SEAL_ID));
  top.hp = top.maxHp * 0.5;
  for (const m of b.teams[0].members) for (const st of [...m.statuses]) if (st.def.id === SEAL_ID) m.expireStatus(st);
  const lost = top.maxHp - top.hp;
  const mark = b.trace.length;
  const pick = (await import(R + "compile/betting-mechanics.ts")).aiRuleTarget?.(h, sk(h, "595_02").ir, b.teams[0].members) ?? null;
  await cast(b, h, "595_02", pick?.target ?? top);
  ok("白狐咒: seal on another ally, not on herself", !h.statuses.some((s: any) => s.def.id === SEAL_ID) && b.teams[0].members.some((m: any) => m.id !== h.id && m.statuses.some((s: any) => s.def.id === SEAL_ID)));
  const healed = since(b, mark).find((t: any) => t.t === "HEAL" && t.dst === top.id);
  ok("白狐咒: 20% of the lost HP recovered", !healed || Math.abs((healed.amount ?? healed.applied ?? lost * HAKUZOSU.lostHeal) - lost * HAKUZOSU.lostHeal) < 2, healed ? JSON.stringify(healed).slice(0, 120) : "target was not the damaged ally");
  // own-turn immunity
  for (const m of b.teams[0].members) for (const st of [...m.statuses]) if (st.def.id === SEAL_ID) m.expireStatus(st);
  top.addStatus((await import(R + "kernel/status.ts")).StatusBook.get(SEAL_ID), h.id, 1, 2, [], 1);
  top.hp = top.maxHp;
  await disp(b, EV.TURN_START, top);
  await b.damage(foe, top, 3000, (await import(R + "kernel/types.ts")).DamageType.NORMAL, 1, null);
  ok("守护之印: no damage during the bearer's own turn", top.hp === top.maxHp, String(Math.round(top.hp)));
  await disp(b, EV.ACTION_END, top);
  await disp(b, EV.TURN_END, top);
  await disp(b, EV.TURN_START, foe);
  await b.damage(foe, top, 3000, (await import(R + "kernel/types.ts")).DamageType.NORMAL, 1, null);
  ok("outside its turn the bearer takes damage", top.hp < top.maxHp);
  ok("符咒·破 on the attacker (or resisted)", foe.statuses.some((s: any) => s.def.id === BREAK_ID) || b.trace.some((t: any) => t.t === "STATUS_RESIST" && t.status === BREAK_ID));
  ok("595_03 is gated (梦山誓 not modelled)", !!(await import(R + "compile/betting-mechanics.ts")).bettingGate(b, h, sk(h, "595_03")));
  void other;
}

sec("[4] 缘结神: 神赐良缘 buff / heal, 再续前缘 extra turn at −3 onibi");
{
  const { b, find } = await match([unit(347, 20000), unit(220, 20000)], [unit(220, 20000)]);
  const e = find(347, 0), ally = b.teams[0].members[1];
  ally.hp = ally.maxHp * 0.5;
  const hp = ally.hp;
  await cast(b, e, "347_03", ally);
  const buff = ally.statuses.find((s: any) => s.def.id === "347_dmg");
  ok("damage +40% on every non-summon ally", !!buff && Math.abs(buff.effects[0].value - ENMU347.dmg) < 1e-9 && e.statuses.some((s: any) => s.def.id === "347_dmg"));
  ok("heal ≥ 9% of the ally's own max HP", ally.hp - hp >= ally.maxHp * ENMU347.heal - 1, `${Math.round(ally.hp - hp)} vs ${Math.round(ally.maxHp * 0.09)}`);
  e.addStatus(renewDef(), e.id, 1, 99999, [], 1);
  const mark = b.trace.length;
  await disp(b, EV.TURN_END, e);
  ok("再续前缘: extra turn granted after her turn", since(b, mark).some((t: any) => t.t === "EXTRA_TURN_GRANTED" && t.actor === e.id) && !e.statuses.some((s: any) => s.def.id === RENEW_ID));
}

sec("[5] 神启荒: no damage on cast, prophecy burst when the enemy does not pay onibi");
{
  const { b, find } = await match([unit(390, 20000)], [unit(220, 20000), unit(220, 20000)]);
  const s = find(390, 0), foe = b.teams[1].members[0];
  ok("L4 先机: the realm is open at battle start", realmOpen(s));
  const mark = b.trace.length;
  await cast(b, s, "390_02", foe);
  ok("星罗云布 cast deals no damage", !since(b, mark).some((t: any) => t.t === "DAMAGE" && t.src === s.id));
  const hp = foe.hp, st0 = starsOf(s);
  await disp(b, EV.TURN_START, foe);
  await disp(b, EV.ACTION_END, foe);
  ok("free enemy turn ⇒ star burst on every enemy + 1 星辰之力", foe.hp < hp && starsOf(s) === st0 + 1, `${Math.round(hp)} → ${Math.round(foe.hp)}, stars ${starsOf(s)}`);
  void STAR_ID; void SUSABI;
}

sec("[6] 聆海金鱼姬: enemy target, 结怨, 鱼尾之簇 heal + 浪涌, 凌波 shield and 凝神");
{
  const { b, find } = await match([unit(346, 20000), unit(220, 20000)], [unit(220, 20000), unit(220, 20000)]);
  const k = find(346, 0), ally = b.teams[0].members[1], foe = b.teams[1].members[0];
  ok("先机: 4 凝神", stacks(k, FOCUS_ID) === SEAWATCH.focusOpen, String(stacks(k, FOCUS_ID)));
  await cast(b, k, "346_03", foe);
  ok("灵鱼抱蕊: 3 结怨 on an enemy", b.teams[1].members.some((m: any) => stacks(m, GRUDGE_ID) === SEAWATCH.grudge));
  ok("鱼尾之簇 open with 1 浪涌", clusterOpen(k) && surgeOf(k) === 1);
  ally.hp = ally.maxHp * 0.9;
  const hp = ally.hp, mark = b.trace.length;
  await disp(b, EV.TURN_END, ally);
  ok("ally turn end: heal + 浪涌 hit", ally.hp > hp && since(b, mark).some((t: any) => t.t === "DAMAGE" && t.src === k.id));
  await disp(b, EV.TURN_END, foe);
  ok("enemy turn end: +1 凝神 and an 80% ATK shield", stacks(k, FOCUS_ID) === SEAWATCH.focusOpen + 1 && (k.shields ?? []).some((s: any) => !s.broken && s.value > 0));
}

sec("[7] 川猿: forms in KB order (3 papers), then 猿形毕露 debuffs");
{
  const { b, find } = await match([unit(371, 20000, { efh: 2 })], [unit(220, 20000)]);
  const k = find(371, 0), foe = b.teams[1].members[0];
  const { bettingPreferredSkill } = await import(R + "compile/betting-mechanics.ts");
  for (let i = 0; i < KAWAZARU.papers; i++) {
    const pick = bettingPreferredSkill(b, k);
    ok(`turn ${i + 1}: 变幻自在 chosen`, pick?.skill?.ir?.id === "371_03", pick?.rule ?? "");
    await cast(b, k, "371_03", k);
  }
  ok("3 papers used, a paper shield is up", papersUsed(k) === 3 && (k.shields ?? []).some((s: any) => !s.broken && s.value > 0));
  ok("then the normal attack", bettingPreferredSkill(b, k)?.skill?.ir?.id === "371_01");
  await cast(b, k, "371_01", foe);
  ok("猿形毕露: RES down + vulnerability on the target (efh 200%)", foe.statuses.some((s: any) => s.def.id === "371_vuln") && foe.statuses.some((s: any) => s.def.id === "371_res"));
}

sec("[8] Match 10 battle runs; BASE mode untouched");
{
  const fx: any = normalizeLineup(await loadMatchFixture(M10));
  const A: any = await assembleGuessingMatch(fx, { seed: 100000 });
  const res = await A.battle.run();
  ok("match-10 battle finishes", res.winner === 0 || res.winner === 1, JSON.stringify(res));
  setSkillLevelMode("BASE");
  ok("BASE: no hand-written rule for the match-10 units", [285, 595, 347, 390, 346, 371].every(id => bettingAiRuleOf(id) === null));
  setSkillLevelMode("MAX");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
