// tests/betting-mechanics-20.ts — match-14 kits (2026-11-24f), MAX (betting) mode:
//   · 慧明灯 552 业障 on attackers, 拘魂 at 3 stacks while 明识灯 is out (ends at her turn start), guard 50% + heals,
//     L3 DEF top-up, compiled ally-buff removal gone (betting-miakashi.ts);
//   · 饴细工 368 苦中作甜 30% share, 一物一心 HP cost / 糖渍 3 turns / no self pull, 糖渍 heals ×3 per turn, overflow bar
//     (betting-amezaiku.ts);
//   · 鬼使黑 211 KB AI (S3 with an enemy >40%, S1 with an enemy <20%), 死亡宣判 ±50%, 索命 new turn (betting-kuromujou.ts);
//   · 跳跳哥哥 233 +40% RES, KB AI revive, automatic 不弃 on the killer, coffin revive (betting-kyonshiani.ts);
//   · BASE mode: none of the kits answer.
// Run: node battle-lab/tests/betting-mechanics-20.ts
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { TurnType, EV, DamageType } = await import(R + "kernel/types.ts");
const { pendingExtraTurns, clearExtraTurns } = await import(R + "kernel/extra-turn.ts");
const { MIAKASHI, KARMA_ID, karmaOn, lanternOut } = await import(R + "compile/betting-miakashi.ts");
const { AMEZAIKU, CANDY_ID } = await import(R + "compile/betting-amezaiku.ts");
const { KUROMUJOU } = await import(R + "compile/betting-kuromujou.ts");
const { KYONSHI, COFFIN_NOTE } = await import(R + "compile/betting-kyonshiani.ts");
const { M14_KITS } = await import(R + "compile/betting-m14.ts");
const { M7_PATCHES, m7RuleSkill } = await import(R + "compile/betting-m7.ts");
const { bettingAiRuleOf, bettingKitSkillOf } = await import(R + "compile/betting-coverage.ts");
const { dealDamage } = await import(R + "kernel/damage.ts");

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };
const sec = (s: string) => console.log("\n" + s);

setSkillLevelMode("MAX");
const unit = (shikigamiId: number, hp: number, extra: any = {}) => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
async function match(red: any[], blue: any[], seed = 1) {
  const A = await assembleGuessingMatch({ _meta: { title: "t20" }, red, blue } as any, { seed, traceLevel: "FULL" });
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
  b.withinResolution({ id: "SKILL:t20", type: "SKILL" }, () => dealDamage(b, { source: src, target: dst, base, rate: 1, type, skillTag: "t20" }));

sec("[0] Wiring");
{
  ok("betting-m14 lists 4 kits", M14_KITS.length === 4);
  ok("211 / 233: hand-written AI rules declared", !!bettingAiRuleOf(211) && !!bettingAiRuleOf(233));
  ok("552 / 368: KB AI kept (no hand-written rule)", bettingAiRuleOf(552) === null && bettingAiRuleOf(368) === null);
  for (const id of ["552_02", "552_03", "368_02", "368_03", "211_02", "211_03", "233_02", "233_03"]) ok(`${id}: kit skill declared`, !!bettingKitSkillOf(id));
  ok("552_03 patch: compiled ally purge / control removed", (M7_PATCHES["552_03"]?.patch as any)?.purge?.length === 0 && (M7_PATCHES["552_03"]?.patch as any)?.controlRefs?.length === 0);
  ok("368_03 patch: compiled self pull removed", (M7_PATCHES["368_03"]?.patch as any)?.timeline?.length === 0);
}

sec("[1] 慧明灯: 业障 on attackers; 正念 lantern ⇒ 拘魂 at 3 stacks, L3 DEF, no ally-buff removal; recall ends it");
{
  const { b, find } = await match([unit(552, 30000, { spd: 150 }), unit(220, 30000)], [unit(220, 90000, { atk: 4000 })]);
  const m = find(552, 0), ally = b.teams[0].members.find((e: any) => e.id !== m.id), foe = b.teams[1].members[0];
  const atk0 = foe.prop("atk");
  await hit(b, foe, m, 100);
  ok("1 业障 on the attacker", karmaOn(foe, m) === 1);
  ok("−5% ATK per stack", Math.abs(foe.prop("atk") - atk0 * 0.95) < 2, `${atk0} → ${foe.prop("atk")}`);
  await hit(b, foe, m, 100);
  ok("no 拘魂 without the lantern", !foe.statuses.some((s: any) => s.def.id === "soulDetain"));
  b.teams[0].orbs.orb = 8;
  const def0 = ally.prop("def");
  const mark = b.trace.length;
  await cast(b, m, "552_03", ally);
  ok("明识灯 summoned", lanternOut(b, m));
  ok("compiled 业障 / 拘魂 on the cast target gone", !since(b, mark).some((t: any) => t.t === "STATUS_APPLY" && t.status === KARMA_ID && t.skill === "正念"));
  ok("no ally status removed by the cast", !since(b, mark).some((t: any) => t.t === "STATUS_REMOVE" && t.by === "REMOVE"));
  ok("L3: ally DEF +40% in total", Math.abs(ally.prop("def") - def0 * 1.4) < 2, `${def0} → ${ally.prop("def")}`);
  await hit(b, foe, m, 100);
  ok("3rd 业障 while the lantern is out ⇒ 拘魂", karmaOn(foe, m) === 3 && foe.statuses.some((s: any) => s.def.id === "soulDetain"));
  await disp(b, EV.TURN_START, m);
  ok("her turn start ⇒ 拘魂 ends", !foe.statuses.some((s: any) => s.def.id === "soulDetain"));
}

sec("[2] 慧明灯: guard 50% of a single-target hit on an ally + 6% heals (seeded scan)");
{
  let guarded = 0, healed = false, shareOk = false;
  for (let seed = 1; seed <= 12; seed++) {
    const { b, find } = await match([unit(552, 30000), unit(220, 30000)], [unit(220, 90000)], seed);
    const m = find(552, 0), ally = b.teams[0].members.find((e: any) => e.id !== m.id), foe = b.teams[1].members[0];
    m.hp = m.maxHp * 0.5;
    const mHp = m.hp, aHp = ally.hp;
    const mark = b.trace.length;
    await hit(b, foe, ally, 1000, DamageType.TRUE);
    const sh = since(b, mark).find((t: any) => t.t === "DAMAGE_SHARED");
    if (!sh) continue;
    guarded++;
    if (Math.abs(aHp - ally.hp - 500) < 2) shareOk = true;
    if (m.hp > mHp - 500 + m.maxHp * MIAKASHI.guardHeal * 0.99 - 1) healed = true;
  }
  ok("guard triggers on some seeds (50%)", guarded > 0 && guarded < 12, `${guarded}/12`);
  ok("ally takes only 50%", shareOk);
  ok("she heals 6% of her max HP", healed);
}

sec("[3] 饴细工: 苦中作甜 30% share; 一物一心 HP cost + 糖渍 3 turns; 糖渍 heals ×3 per turn, overflow bar");
{
  const { b, find } = await match([unit(368, 40000), unit(220, 30000)], [unit(220, 90000)]);
  const a = find(368, 0), ally = b.teams[0].members.find((e: any) => e.id !== a.id), foe = b.teams[1].members[0];
  ally.hp = ally.maxHp * 0.5;
  const aHp = ally.hp;
  await hit(b, foe, ally, 1000, DamageType.TRUE);
  ok("ally takes 70%", Math.abs(aHp - ally.hp - 700) < 2, String(aHp - ally.hp));
  b.teams[0].orbs.orb = 8;
  const hp0 = a.hp;
  const pos0 = b.timeline.get(a.id)?.pos ?? 0;
  await cast(b, a, "368_03", ally);
  ok("15% current HP lost", Math.abs(hp0 - a.hp - hp0 * AMEZAIKU.hpCost) < 2);
  ok("no self pull", Math.abs((b.timeline.get(a.id)?.pos ?? 0) - pos0) < 1e-6);
  const candy = ally.statuses.find((s: any) => s.def.id === CANDY_ID);
  ok("糖渍 on the ally for 3 turns", !!candy && candy.remaining === AMEZAIKU.candyTurns, String(candy?.remaining));
  ally.hp = 1;
  const before = ally.hp;
  await hit(b, foe, a, 10);
  ok("he takes damage ⇒ ally healed 15% of his max HP", Math.abs(ally.hp - before - a.maxHp * AMEZAIKU.candyHeal) < 2);
  for (let i = 0; i < 4; i++) await hit(b, foe, a, 10);
  ok("at most 3 heals per turn", since(b, 0).filter((t: any) => t.t === "MARK_TRIGGER" && t.status === CANDY_ID).length === 3);
  b.turn += 1;
  ally.hp = ally.maxHp;
  const p1 = b.timeline.get(ally.id)?.pos ?? 0;
  await hit(b, foe, a, 10);
  ok("overflowing heal ⇒ +8% bar", (b.timeline.get(ally.id)?.pos ?? 0) > p1, `${p1} → ${b.timeline.get(ally.id)?.pos}`);
}

sec("[4] 鬼使黑: KB AI, 死亡宣判 ±50%, 索命 new turn");
{
  const { b, find } = await match([unit(211, 30000, { atk: 4000 })], [unit(220, 90000, { def: 0 }), unit(220, 90000, { def: 0 })]);
  const k = find(211, 0), [f1, f2] = b.teams[1].members;
  b.teams[0].orbs.orb = 8;
  ok("enemy >40% ⇒ 死亡宣判", m7RuleSkill(b, k, costOf)?.skill?.ir?.id === "211_03");
  f1.hp = f1.maxHp * 0.15;
  ok("enemy <20% ⇒ 惩戒", m7RuleSkill(b, k, costOf)?.skill?.ir?.id === "211_01");
  f1.hp = f1.maxHp * 0.3;
  const h1 = f1.hp, h2 = f2.hp;
  await cast(b, k, "211_03", f1);
  const d1 = h1 - f1.hp, d2 = h2 - f2.hp;
  ok("high-HP target takes 3× (4.5× if its +50% crit landed) the low-HP target's damage", Math.abs(d2 / d1 - 3) < 0.05 || Math.abs(d2 / d1 - 4.5) < 0.05, `${Math.round(d1)} / ${Math.round(d2)}`);
  clearExtraTurns(b);
  f1.hp = 1;
  await cast(b, k, "211_01", f1);
  ok("kill ⇒ 1 new turn queued", !f1.alive && pendingExtraTurns(b) === 1);
  clearExtraTurns(b);
}

sec("[5] 跳跳哥哥: +40% RES, automatic 不弃 on the killer, revive AI, coffin revive");
{
  const { b, find } = await match([unit(233, 30000, { efh: 1 }), unit(220, 30000)], [unit(220, 90000)]);
  const j = find(233, 0), ally = b.teams[0].members.find((e: any) => e.id !== j.id), foe = b.teams[1].members[0];
  ok("+40% effect RES", Math.abs(j.prop("efr") - KYONSHI.res) < 1e-9, String(j.prop("efr")));
  ally.hp = 1;
  const mark = b.trace.length;
  await hit(b, foe, ally, 1000, DamageType.TRUE);
  ok("ally killed", !ally.alive);
  ok("automatic 不弃 on the killer", since(b, mark).some((t: any) => t.t === "SUBCAST" && t.ref === "233_02" && t.target === foe.id));
  ok("…with damage", since(b, mark).some((t: any) => t.t === "DAMAGE" && t.src === j.id && t.dst === foe.id));
  b.teams[0].orbs.orb = 8;
  ok("dead ally ⇒ 死而复生", m7RuleSkill(b, j, costOf)?.skill?.ir?.id === "233_03");
  await cast(b, j, "233_03", ally);
  const coffin = b.teams[0].summons.find((s: any) => s.alive && s.notes.includes(COFFIN_NOTE + ally.id));
  ok("coffin summoned", !!coffin);
  await disp(b, EV.TURN_START, coffin);
  ok("coffin's action ⇒ ally revived at full HP", ally.alive && Math.abs(ally.hp - ally.maxHp) < 1, `${ally.hp}/${ally.maxHp}`);
  ok("coffin gone", !b.teams[0].summons.some((s: any) => s.alive && s.notes.includes(COFFIN_NOTE + ally.id)));
  ok("no revivable ally ⇒ 不弃", m7RuleSkill(b, j, costOf)?.skill?.ir?.id === "233_02");
}

sec("[6] BASE mode: no kit answers");
{
  setSkillLevelMode("BASE");
  const { b, find } = await match([unit(211, 30000), unit(233, 30000)], [unit(220, 20000), unit(220, 20000)]);
  ok("BASE: no Kuro Mujou rule", m7RuleSkill(b, find(211, 0), costOf) === null);
  ok("BASE: no Kyonshi Ani rule", m7RuleSkill(b, find(233, 0), costOf) === null);
  ok("BASE: no coverage", bettingAiRuleOf(211) === null && bettingKitSkillOf("552_03") === null);
  setSkillLevelMode("MAX");
}

console.log(`\nbetting-mechanics-20: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
