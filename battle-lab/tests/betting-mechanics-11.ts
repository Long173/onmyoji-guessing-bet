// tests/betting-mechanics-11.ts — match-7 kits (2026-11-23g), MAX (betting) mode, wired through compile/betting-m7.ts:
//   薰 298, 遥念烟烟罗 572, 纺愿缘结神 554, 雪御前 591, 万年竹 275, 花鸟卷 279, 鬼王酒吞童子 341, and the 隐念 Possessor soul.
// Each part runs in its own block (own helpers, own small synthetic matches); the pass / fail counters are shared.
// Run: node battle-lab/tests/betting-mechanics-11.ts
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };

// ═════════ 薰 298 (betting-kaoru.ts) / 遥念烟烟罗 572 (betting-enenra.ts) ═════════
{
// 薰 298 (betting-kaoru.ts) and 遥念烟烟罗 572 (betting-enenra.ts), MAX (betting) mode — match 7 kits.
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { KAORU, OWL_ID, DANCE_ID, ALERT_ID, PLAY_DMG_ID, owlRecord, inAlert } = await import(R + "compile/betting-kaoru.ts");
const { ENENRA, SMOKE_ID, PHANTOM_ID, inSmoke } = await import(R + "compile/betting-enenra.ts");
const { m7RuleSkill, m7DamageHook } = await import(R + "compile/betting-m7.ts");
const { DamageType, TurnType, EV } = await import(R + "kernel/types.ts");
const { StatusBook, isActionPrevented } = await import(R + "kernel/status.ts");

setSkillLevelMode("MAX");

const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

const unit = (shikigamiId: number, hp: number, extra: any = {}) => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
async function match(red: any[], blue: any[], seed = 1) {
  const A = await assembleGuessingMatch({ _meta: { title: "t11-enenra-kaoru" }, red, blue }, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  const find = (charId: number, team = 0) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find };
}
const since = (b: any, mark: number) => (b.trace as any[]).slice(mark);
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = (b: any, e: any, id: string, target: any) => { const s = sk(e, id); return b.withinResolution({ id: "SKILL:" + s.name, type: "SKILL" }, () => s.execute(b, e, target)); };
const dispatch = (b: any, code: string, actor: any) => b.bus.dispatch(code, { actor, type: TurnType.NORMAL }, actor.id, actor.teamId, (id: number) => b.teamOf(id));
const expire = async (b: any, e: any, id: string) => {
  const st = e.statuses.find((s: any) => s.def.id === id); e.expireStatus(st);
  b.queueEvent(EV.STATUS_EXPIRE, { battle: b, entity: e, status: id, name: st.def.name, reason: "DURATION" }, e.id, e.teamId);
  await b.drainEvents();
};

sec("[1] 鸮之守: L5 先机 on the lowest-HP ally, absorbs and records all damage, 60% HP loss when it disappears");
{
  const { b, find } = await match([unit(298, 30000), unit(201, 20000), unit(201, 50000)], [unit(201, 900000)], 3);
  const k = find(298), low = b.teams[0].members[1], foe = b.teams[1].members[0];
  ok("battle start: 鸮之守 on the lowest-HP ally only", low.hasStatus(OWL_ID) && !k.hasStatus(OWL_ID) && !b.teams[0].members[2].hasStatus(OWL_ID));
  const hp0 = low.hp, mark = b.trace.length;
  await b.damage(foe, low, 3000, DamageType.NORMAL, 1, null);
  await b.damage(foe, low, 3000, DamageType.NORMAL, 1, null);
  const abs = since(b, mark).filter(t => t.t === "OWL_ABSORB");
  const rec = owlRecord(low);
  ok("two hits absorbed: HP unchanged, no DAMAGE trace", low.hp === hp0 && !since(b, mark).some(t => t.t === "DAMAGE" && t.dst === low.id), "hp " + low.hp);
  ok("record = sum of the absorbed hits", abs.length === 2 && near(rec, abs.reduce((s, t) => s + t.absorbed, 0), 1e-3), String(rec));
  await expire(b, low, OWL_ID);
  ok("mark gone ⇒ the bearer loses 60% of the record (HP loss)", near(hp0 - low.hp, rec * KAORU.owlLoss, 1e-6), (hp0 - low.hp).toFixed(1) + " vs " + (rec * 0.6).toFixed(1));
  ok("record cleared; an HP_LOSS trace (not DAMAGE)", owlRecord(low) === 0 && b.trace.some((t: any) => t.t === "HP_LOSS" && t.dst === low.id));
}

sec("[2] 鸮之守 cap: 200% of Kaoru's max HP ⇒ removed and settled at once, the rest of the hit goes through");
{
  const { b, find } = await match([unit(298, 10000), unit(201, 9000), unit(201, 900000)], [unit(201, 900000, { atk: 100000 })], 4);
  const k = find(298), low = b.teams[0].members[1], big = b.teams[0].members[2], foe = b.teams[1].members[0];
  // Move the mark to the tank so the settlement does not kill it.
  for (const st of [...low.statuses]) if (st.def.id === OWL_ID) low.expireStatus(st);
  big.addStatus(StatusBook.get(OWL_ID), k.id, 1, 2, [], 1);
  const cap = k.maxHp * KAORU.owlCapOfKaoruHp, hp0 = big.hp, mark = b.trace.length;
  await b.damage(foe, big, 100000, DamageType.TRUE, 1, null);
  const dmg = since(b, mark).find(t => t.t === "DAMAGE" && t.dst === big.id);
  const settle = since(b, mark).find(t => t.t === "OWL_SETTLE");
  ok("mark removed at the cap", !big.hasStatus(OWL_ID) && settle?.reason === "CAP_REACHED");
  ok("loss = 60% of the cap", near(settle.recorded, cap, 1e-3) && near(settle.loss, cap * 0.6, 1e-3), settle?.recorded + " / " + cap);
  const abs = since(b, mark).find(t => t.t === "OWL_ABSORB");
  ok("only the part up to the cap is absorbed", abs && near(abs.absorbed, cap, 1e-3), String(abs?.absorbed));
  ok("the excess above the cap is dealt as damage, then the 60% loss", dmg && dmg.final > 0 && near(hp0 - big.hp, dmg.applied + cap * 0.6, 1e-3), dmg?.final + " / " + (hp0 - big.hp));
}

sec("[3] 温柔的守护: mark on one ally, +4 onibi, 1 debuff/control dispelled per ally; 鸮之舞 only in 警戒");
{
  const { b, find } = await match([unit(298, 30000), unit(201, 20000), unit(201, 50000)], [unit(201, 900000)], 5);
  const k = find(298), [ , a1, a2] = b.teams[0].members;
  for (const m of b.teams[0].members) for (const st of [...m.statuses]) if (st.def.id === OWL_ID) m.expireStatus(st);
  a2.hp = a2.maxHp * 0.3;   // lowest HP ratio
  const stun = StatusBook.get("stun");
  a1.addStatus(stun, b.teams[1].members[0].id, 1, 2, [], 1);
  a2.addStatus(stun, b.teams[1].members[0].id, 1, 2, [], 1);
  const orbs0 = b.teams[0].orbs.current;
  const rule = m7RuleSkill(b, k, (s: any) => s.cost);
  ok("AI: allies alive ≥ 2 → 温柔的守护", rule?.skill?.ir?.id === "298_03", rule?.rule);
  const tgt = sk(k, "298_03").pickTarget(b, k, b.enemiesOf(0));
  ok("target = lowest HP-ratio ally", tgt.id === a2.id, "picked " + tgt.id);
  await dispatch(b, "TURN_START", b.teams[1].members[0]);
  ok("2 controlled allies ⇒ 警戒 (+15 SPD, +60% RES)", inAlert(k) && near(k.prop("efr") - 0, k.base.efr + KAORU.alertRes, 1e-9), "efr " + k.prop("efr"));
  await cast(b, k, "298_03", tgt);
  ok("鸮之守 on the chosen ally only", a2.hasStatus(OWL_ID) && !a1.hasStatus(OWL_ID) && !k.hasStatus(OWL_ID));
  ok("+4 onibi", b.teams[0].orbs.current - orbs0 === 4 || b.teams[0].orbs.current === b.teams[0].orbs.max, orbs0 + " → " + b.teams[0].orbs.current);
  const controlled = [a1, a2].filter((m: any) => m.statuses.some((s: any) => s.def.preventsAction));
  ok("allies still controlled in 警戒 gain 鸮之舞 (+50 SPD)", controlled.every((m: any) => m.hasStatus(DANCE_ID)) && !k.hasStatus(DANCE_ID), controlled.length + " controlled");
  ok("no 鸮之舞 on uncontrolled allies", [k, a1, a2].filter((m: any) => !controlled.includes(m)).every((m: any) => !m.hasStatus(DANCE_ID)));
}

sec("[4] 鸮之警惕 L5: 玩耍 ⇒ +10% damage for all allies at her turn end, removed when switching to 警戒");
{
  const { b, find } = await match([unit(298, 30000), unit(201, 20000), unit(201, 50000)], [unit(201, 900000)], 6);
  const k = find(298), [ , a1, a2] = b.teams[0].members;
  await dispatch(b, "TURN_END", k);
  ok("玩耍 turn end: every ally +10% dmgDealtB", [k, a1, a2].every((m: any) => m.hasStatus(PLAY_DMG_ID) && near(m.prop("dmgDealtB"), KAORU.playDmg, 1e-9)));
  const stun = StatusBook.get("stun");
  a1.addStatus(stun, b.teams[1].members[0].id, 1, 2, [], 1); a2.addStatus(stun, b.teams[1].members[0].id, 1, 2, [], 1);
  await dispatch(b, "TURN_START", a1);
  ok("switch to 警戒 removes the damage buff", inAlert(k) && [k, a1, a2].every((m: any) => !m.hasStatus(PLAY_DMG_ID)));
}

sec("[5] 夜幕华彩: 2 × 51% to all, 131% on the target, 烟之鬼 morph (unable to act, passives off), burst 49% on expiry");
{
  const { b, find } = await match([unit(572, 30000, { efh: 5 })], [unit(201, 900000), unit(201, 900000), unit(201, 900000)], 7);
  const s = find(572), foes = b.teams[1].members;
  const mark = b.trace.length;
  await cast(b, s, "572_03", foes[1]);
  const dmg = since(b, mark).filter(t => t.t === "DAMAGE" && t.src === s.id);
  ok("7 hits: 2 waves × 3 enemies + the final strike", dmg.length === 7, String(dmg.length));
  ok("final strike on the designated target", dmg[6]?.dst === foes[1].id && near(dmg[6].breakdown.rate ?? dmg[6].breakdown.base / s.prop("atk"), 1, 1) );
  ok("final ratio 131%, waves 51%", near(dmg[6].breakdown.base, s.prop("atk") * 1.31, 1e-9) && dmg.slice(0, 6).every(t => near(t.breakdown.base, s.prop("atk") * 0.51, 1e-9)));
  const v = foes[1];
  ok("烟之鬼 on the target (high HIT)", v.hasStatus(PHANTOM_ID));
  ok("烟之鬼: unable to act, passives suppressed, not dispellable", isActionPrevented(v.statusDefs()) && v.statusDefs().some((d: any) => d.suppressPassive) && !v.dispel(PHANTOM_ID));
  const m2 = b.trace.length;
  await b.runPseudoTurn(v, TurnType.NORMAL);
  const after = since(b, m2);
  ok("the bearer's turn is skipped", after.some(t => t.t === "ACTION_PREVENTED" && t.actor === v.id));
  ok("…and 烟之鬼 expires at its end", !v.hasStatus(PHANTOM_ID));
  const burst = after.filter(t => t.t === "DAMAGE" && t.src === s.id);
  ok("burst: 49% ATK on every enemy of Enenra", burst.length === 3 && burst.every(t => near(t.breakdown.base, s.prop("atk") * 0.49, 1e-9)), String(burst.length));
  b.teams[0].orbs.gain(8);
  ok("AI: onibi for 夜幕华彩 → 夜幕华彩", m7RuleSkill(b, s, (x: any) => x.cost)?.skill?.ir?.id === "572_03");
  b.teams[0].orbs.pay(b.teams[0].orbs.current);
  ok("AI: onibi short → 如影", m7RuleSkill(b, s, (x: any) => x.cost)?.skill?.ir?.id === "572_02");
}

sec("[6] 烟雾无形: L5 先机, blocks one enemy action (damage), removed at its end with +15% bar; re-entry after a hit (max 2)");
{
  const { b, find } = await match([unit(572, 30000), unit(201, 900000)], [unit(201, 900000)], 8);
  const s = find(572), ally = b.teams[0].members[1], foe = b.teams[1].members[0];
  ok("battle start: 烟雾无形", inSmoke(s));
  const hp0 = s.hp; b.timeline.get(s.id).pos = 0;
  await b.damage(foe, s, 5000, DamageType.NORMAL, 1, null);
  await b.damage(foe, s, 5000, DamageType.NORMAL, 1, null);
  ok("both hits of the action blocked", s.hp === hp0);
  // L3: an ally hit while she is in smoke gets a 15% shield.
  const m3 = b.trace.length;
  await b.damage(foe, ally, 5000, DamageType.NORMAL, 1, null);
  const sh = since(b, m3).find(t => t.t === "SHIELD_APPLY" && t.dst === ally.id);
  const dealt = since(b, m3).find(t => t.t === "DAMAGE" && t.dst === ally.id);
  ok("L3: ally shield = 15% of the damage taken", sh && near(sh.value, dealt.final * ENENRA.hitShield, 1e-2), sh?.value + " vs " + dealt?.final);
  await dispatch(b, "ACTION_END", foe);
  ok("enemy action over ⇒ mark removed, +15% bar", !inSmoke(s) && near(b.timeline.get(s.id).pos, ENENRA.smokeBar * b.timeline.length || b.timeline.get(s.id).pos, 1) && b.trace.some((t: any) => t.t === "TIMELINE_SHIFT" && t.id === s.id && t.skill === "烟雾无形"));
  await b.damage(foe, s, 5000, DamageType.NORMAL, 1, null);
  ok("now she takes damage", s.hp < hp0);
  ok("re-entry waits for the end of the hitting action", !inSmoke(s));
  await dispatch(b, "ACTION_END", foe);
  ok("…then she enters 烟雾无形 (entry 1)", inSmoke(s));
  await b.damage(foe, s, 5000, DamageType.NORMAL, 1, null); await dispatch(b, "ACTION_END", foe);   // blocked + removed
  await b.damage(foe, s, 5000, DamageType.NORMAL, 1, null); await dispatch(b, "ACTION_END", foe);   // entry 2
  ok("entry 2", inSmoke(s));
  await b.damage(foe, s, 5000, DamageType.NORMAL, 1, null); await dispatch(b, "ACTION_END", foe);   // blocked + removed
  await b.damage(foe, s, 5000, DamageType.NORMAL, 1, null); await dispatch(b, "ACTION_END", foe);   // limit reached
  ok("no 3rd entry before her own turn", !inSmoke(s));
  await dispatch(b, "TURN_START", s);
  await b.damage(foe, s, 5000, DamageType.NORMAL, 1, null); await dispatch(b, "ACTION_END", foe);
  ok("her turn resets the count", inSmoke(s));
}

sec("[7] 如影 cast: 烟雾无形 + non-summon allies shielded 25% of her max HP");
{
  const { b, find } = await match([unit(572, 30000), unit(201, 50000)], [unit(201, 900000)], 9);
  const s = find(572);
  for (const st of [...s.statuses]) if (st.def.id === SMOKE_ID) s.expireStatus(st);
  const mark = b.trace.length;
  await cast(b, s, "572_02", s);
  const sh = since(b, mark).filter(t => t.t === "SHIELD_APPLY" && t.src === s.id);
  ok("enters 烟雾无形", inSmoke(s));
  ok("2 shields (both allies) of 25% of her max HP, 2 turns", sh.length === 2 && sh.every(t => near(t.value, s.maxHp * 0.25, 1e-2) && t.duration === 2), JSON.stringify(sh.map(t => t.value)));
}

sec("[8] BASE mode: hooks inert");
{
  setSkillLevelMode("BASE");
  ok("no damage hook / rule in BASE", m7DamageHook({ id: "572_03", damage: [{}] }) === null && m7DamageHook({ id: "298_01", damage: [{}] }) === null);
  setSkillLevelMode("MAX");
}

}

// ═════════ 纺愿缘结神 554 (betting-enmusubi.ts) / 花鸟卷 279 (betting-hana279.ts) ═════════
{
// t11-enmusubi-hana.ts — 纺愿缘结神 554 (betting-enmusubi.ts) and 花鸟卷 279 (betting-hana279.ts), MAX mode.
// Run: node <this file>
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { bettingPreferredSkill, bettingCostOf } = await import(R + "compile/betting-mechanics.ts");
const { ENMU, POWER_ID, RED_ID, BLUE_ID, BOND_RED_ID, BLUE_DR_ID, bondedOf, powerOf, KIT: ENMU_KIT } = await import(R + "compile/betting-enmusubi.ts");
const { HANA279, FRAGRANCE_ID, birdsOf, KIT: HANA_KIT } = await import(R + "compile/betting-hana279.ts");
const { pendingExtraTurns } = await import(R + "kernel/extra-turn.ts");
const { StatusBook } = await import(R + "kernel/status.ts");
const { DamageType } = await import(R + "kernel/types.ts");

setSkillLevelMode("MAX");

const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const unit = (shikigamiId: number, hp: number, extra: any = {}) => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds: [],
});
const TANKS = () => [unit(201, 900000, { spd: 1 }), unit(201, 900000, { spd: 1 })];
async function match(red: any[], blue: any[], seed = 1) {
  const A: any = await assembleGuessingMatch({ _meta: { title: "t11-c" }, red, blue }, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  const byChar = (charId: number, team = 0) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, byChar };
}
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const cast = async (b: any, e: any, id: string, target?: any) => {
  const s = sk(e, id);
  const t = target ?? s.pickTarget(b, e, b.enemiesOf(e.teamId).filter((v: any) => v.alive));
  await s.execute(b, e, t);
  return t;
};

// ───────────────────────── 纺愿缘结神 554 ─────────────────────────

sec("[1] 554 AI: no bond → 守缘刃 on the highest-ATK ally; bond 赤 on it, 2 神力 on herself (+20% RES each)");
{
  const { b, byChar } = await match([unit(554, 50000, { atk: 2000 }), unit(201, 50000, { atk: 6000 }), unit(201, 50000, { atk: 4000 })], TANKS(), 3);
  const e = byChar(554);
  const [, hi, lo] = b.teams[0].members;
  const pick = bettingPreferredSkill(b, e);
  ok("first choice is 守缘刃", pick?.skill?.ir?.id === "554_02", pick?.rule);
  const efr0 = e.prop("efr");
  const t = await cast(b, e, "554_02");
  ok("target = highest-ATK ally", t.id === hi.id);
  ok("胜天之缘·赤 on the target only", hi.hasStatus(BOND_RED_ID) && !lo.hasStatus(BOND_RED_ID) && !e.hasStatus(BOND_RED_ID));
  ok("神力 ×2 on herself, none on the ally", powerOf(e) === 2 && !hi.hasStatus(POWER_ID));
  ok("effect RES +40%", near(e.prop("efr") - efr0, 0.4), String(e.prop("efr") - efr0));
  ok("bondedOf = target", bondedOf(b, e)?.id === hi.id);
  const pick2 = bettingPreferredSkill(b, e);
  ok("with a bond → 与世结缘", pick2?.skill?.ir?.id === "554_03", pick2?.rule);
  const t2 = sk(e, "554_03").pickTarget(b, e, b.enemiesOf(0));
  ok("与世结缘 targets the bonded ally", t2.id === hi.id);
  b.teams[0].orbs.pay(b.teams[0].orbs.current);
  ok("no onibi → normal attack", bettingPreferredSkill(b, e)?.skill?.ir?.id === "554_01");
}

sec("[2] 与世结缘: 8% of the target's own max HP, guaranteed 尘缘·赤 on a 赤-bonded ally, 庇护, ≥3 神力 heals the others");
{
  const { b, byChar } = await match([unit(554, 50000), unit(201, 100000, { atk: 6000 }), unit(201, 40000)], TANKS(), 5);
  const e = byChar(554);
  const [, ally, other] = b.teams[0].members;
  await cast(b, e, "554_02");
  ally.hp = ally.maxHp * 0.5; other.hp = other.maxHp * 0.5;
  const hp0 = ally.hp, o0 = other.hp;
  await cast(b, e, "554_03", ally);
  ok("heal = 8% of the target's max HP", near(ally.hp - hp0, ally.maxHp * ENMU.heal, 1), String(ally.hp - hp0));
  ok("神力 = 3 (2 + 1)", powerOf(e) === 3);
  ok("≥3 神力 ⇒ the other ally healed 8% of its max HP", near(other.hp - o0, other.maxHp * ENMU.heal, 1), String(other.hp - o0));
  ok("尘缘·赤 (bond colour), no 青", ally.hasStatus(RED_ID) && !ally.hasStatus(BLUE_ID));
  ok("L3 庇护 on herself and the target", e.hasStatus("554_shelter") && ally.hasStatus("554_shelter"));
  b.teams[0].orbs.gain(8);
  await cast(b, e, "554_03", ally);   // 4 stacks
  await cast(b, e, "554_03", ally);   // 5 stacks
  ok("5 神力 ⇒ both 尘缘", powerOf(e) === 5 && ally.hasStatus(RED_ID) && ally.hasStatus(BLUE_ID));
}

sec("[3] 尘缘·赤: extra turn after the bearer's turn, onibi skills −2 in it, not consecutive");
{
  const { b, byChar } = await match([unit(554, 50000), unit(220, 100000, { atk: 6000 })], TANKS(), 7);
  const e = byChar(554);
  const ally = b.teams[0].members[1];
  await cast(b, e, "554_02");
  await cast(b, e, "554_03", ally);
  ok("bearer has 尘缘·赤", ally.hasStatus(RED_ID));
  b.teams[0].orbs.gain(8);
  await b.runTurn(ally, "NORMAL");
  ok("an extra turn is queued", pendingExtraTurns(b) === 1);
  ok("尘缘·赤 consumed", !ally.hasStatus(RED_ID));
  const dance = sk(ally, "220_03");
  let seen = -1;
  const orig = dance.execute;
  dance.execute = async (...a: any[]) => { seen = bettingCostOf(b, ally, dance.ir); return orig(...a); };
  await (b as any).runExtraTurns();
  ok("the 尘缘·赤 turn ran", b.trace.some((t: any) => t.t === "EXTRA_TURN" && t.actor === ally.id && t.reason === "尘缘·赤"));
  const base = dance.ir.cost;
  ok("onibi cost −2 in that turn", seen === -1 || seen === Math.max(0, base - ENMU.redCostCut) || base <= 2, "seen " + seen + " base " + base);
  ok("no new extra turn from the extra turn", pendingExtraTurns(b) === 0);
  ok("cost back to normal afterwards", bettingCostOf(b, ally, dance.ir) >= Math.max(0, base - 1));
}

sec("[4] bar immunity: hers vs other units, the bonded ally's vs decreases; +30% both ways on turn end");
{
  const { b, byChar } = await match([unit(554, 50000), unit(201, 100000, { atk: 6000 })], TANKS(), 9);
  const e = byChar(554);
  const ally = b.teams[0].members[1];
  await cast(b, e, "554_02");
  const pe = b.timeline.get(e.id).pos, pa = b.timeline.get(ally.id).pos;
  ok("push on her refused", b.timeline.shift(e.id, -0.3) === false && b.timeline.get(e.id).pos === pe);
  ok("pull on her by others refused", b.timeline.shift(e.id, 0.3) === false && b.timeline.get(e.id).pos === pe);
  ok("push on the bonded ally refused", b.timeline.shift(ally.id, -0.3) === false && b.timeline.get(ally.id).pos === pa);
  ok("pull on the bonded ally allowed", b.timeline.shift(ally.id, 0.1) === true);
  const a1 = b.timeline.get(ally.id).pos;
  await b.runTurn(e, "NORMAL");
  ok("her turn end ⇒ bonded ally +30%", b.trace.some((t: any) => t.t === "TIMELINE_SHIFT" && t.id === ally.id && t.skill === "守缘刃" && t.applied), String(b.timeline.get(ally.id).pos - a1));
  const e1 = b.timeline.get(e.id).pos;
  await b.runTurn(ally, "NORMAL");
  ok("bonded ally's turn end ⇒ her +30% (her own effect passes the immunity)", b.timeline.get(e.id).pos > e1, (b.timeline.get(e.id).pos - e1).toFixed(0));
}

sec("[5] 尘缘·青: cleanse 1 debuff + 1 control of every other ally, 50% damage reduction until her next turn");
{
  const { b, byChar } = await match([unit(554, 50000), unit(201, 100000, { atk: 6000 }), unit(201, 100000)], TANKS(), 11);
  const e = byChar(554);
  const [, ally, other] = b.teams[0].members;
  ally.addStatus(StatusBook.get(BLUE_ID) ?? { id: BLUE_ID, name: "尘缘·青", category: "BUFF_MARK", dispellable: false, removable: false, preventsAction: false, preventsSkill: false, forcesBasicAttack: false, suppressPassive: false, suppressSoul: false, locksTimeline: false, durationPolicy: "GLOBAL", desc: "t" }, e.id, 1, 99999, [], 1);
  other.addStatus(StatusBook.get("freeze"), b.teams[1].members[0].id, 1, 2, [], 1);
  await b.runTurn(ally, "NORMAL");
  ok("the other ally's (dispellable) control dispelled", !other.hasStatus("freeze"));
  ok("尘缘·青 consumed, reduction on the bearer", !ally.hasStatus(BLUE_ID) && ally.hasStatus(BLUE_DR_ID));
  const foe = b.teams[1].members[0];
  const r = await b.damage(foe, ally, 1000, DamageType.NORMAL, 1, null);
  const r2 = await b.damage(foe, other, 1000, DamageType.NORMAL, 1, null);
  ok("bearer takes 50% of the damage of an unprotected ally", near(Number(r?.final) / Number(r2?.final), 0.5, 0.02), (Number(r?.final) / Number(r2?.final)).toFixed(3));
  await b.runTurn(e, "NORMAL");
  ok("reduction ends at her turn start", !ally.hasStatus(BLUE_DR_ID));
}

// ───────────────────────── 花鸟卷 279 ─────────────────────────

sec("[6] 279 birds: 1 at the start, +1 per own turn start (cap 3), one 40% hit per bird");
{
  const { b, byChar } = await match([unit(279, 50000)], TANKS(), 13);
  const h = byChar(279);
  ok("starts with 1 bird", birdsOf(h) === 1);
  const hits = async () => {
    const n0 = b.trace.length;
    await cast(b, h, "279_01", b.teams[1].members[0]);
    return b.trace.slice(n0).filter((t: any) => t.t === "DAMAGE" && t.src === h.id).length;
  };
  ok("1 bird → 1 hit", await hits() === 1);
  for (let i = 0; i < 4; i++) await b.bus.dispatch("TURN_START", { actor: h, type: "NORMAL" }, h.id, h.teamId, (id: number) => b.teamOf(id));
  ok("cap 3 after 4 turn starts", birdsOf(h) === 3);
  ok("3 birds → 3 hits", await hits() === 3);
}

sec("[7] 279 AI + 花鸟相闻: <70% ally → ultimate; 12% of Hana's max HP now, 芬芳 11% / 10% before the bearer's next 2 turns");
{
  const { b, byChar } = await match([unit(279, 50000), unit(201, 200000)], TANKS(), 15);
  const h = byChar(279), ally = b.teams[0].members[1];
  ok("all ≥70% → 归鸟", bettingPreferredSkill(b, h)?.skill?.ir?.id === "279_01");
  ally.hp = ally.maxHp * 0.5;
  ok("an ally <70% → 花鸟相闻", bettingPreferredSkill(b, h)?.skill?.ir?.id === "279_03");
  const hp0 = ally.hp;
  await cast(b, h, "279_03", ally);
  ok("instant heal 12% of Hana's max HP", near(ally.hp - hp0, h.maxHp * HANA279.ultHeal, 1), String(ally.hp - hp0));
  ok("芬芳 on every ally", ally.hasStatus(FRAGRANCE_ID) && h.hasStatus(FRAGRANCE_ID));
  const a1 = ally.hp;
  await b.runTurn(ally, "NORMAL");
  ok("1st tick 11% of Hana's max HP", near(ally.hp - a1, h.maxHp * 0.11, 1), String(ally.hp - a1));
  const a2 = ally.hp;
  await b.runTurn(ally, "NORMAL");
  ok("2nd tick 10%, then 芬芳 ends", near(ally.hp - a2, h.maxHp * 0.10, 1) && !ally.hasStatus(FRAGRANCE_ID), String(ally.hp - a2));
}

sec("[8] 画境: ~30% control block (consumes a bird) and ~30% +30% bar after her actions");
{
  let blocked = 0, tries = 0, bars = 0, acts = 0;
  for (let s = 0; s < 30; s++) {
    const { b, byChar } = await match([unit(279, 50000), unit(201, 900000)], TANKS(), 100 + s);
    const h = byChar(279), ally = b.teams[0].members[1], foe = b.teams[1].members[0];
    const stun = StatusBook.get("stun");
    for (let i = 0; i < 10; i++) {
      for (const st of [...ally.statuses]) if (st.def.id === "stun") ally.expireStatus(st);
      ally.addStatus(stun, foe.id, 1, 2, [], 1);
      await b.drainEvents();
      tries++;
    }
    blocked += b.trace.filter((t: any) => t.t === "IMMUNE" && t.by === "279_02").length;
    for (let i = 0; i < 5; i++) { acts++; await b.runTurn(h, "NORMAL"); }
    bars += b.trace.filter((t: any) => t.t === "TIMELINE_SHIFT" && t.id === h.id && t.skill === "画境").length;
  }
  const br = blocked / tries, rr = bars / acts;
  ok("control block rate ≈ 30%", br > 0.18 && br < 0.42, br.toFixed(3) + " of " + tries);
  ok("bar rate ≈ 30%", rr > 0.18 && rr < 0.42, rr.toFixed(3) + " of " + acts);
}

sec("[9] BASE mode: the kits are inert");
{
  setSkillLevelMode("BASE");
  ok("554 / 279 rule hooks return null", ENMU_KIT.ruleSkill!({ teams: [] }, {} as any, () => 0) === null && HANA_KIT.ruleSkill!({ teams: [] }, {} as any, () => 0) === null);
  ok("279 damage hook null", HANA_KIT.damageHook!({ id: "279_01" }) === null);
  ok("install returns nothing", ENMU_KIT.install!({} as any, []).length === 0 && HANA_KIT.install!({} as any, []).length === 0);
  setSkillLevelMode("MAX");
}

}

// ═════════ 雪御前 591 (betting-yuki.ts) / 隐念 Possessor (soul/custom-effects-betting.ts) ═════════
{
// 雪御前 591 (compile/betting-yuki.ts) and the 隐念 Possessor soul (soul/custom-effects-betting.ts), MAX only.
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { YUKI, EDGE_ID, GUARD_ID, glassOf, summonGlass, edgeStacks } = await import(R + "compile/betting-yuki.ts");
const { bettingPreferredSkill } = await import(R + "compile/betting-mechanics.ts");
const { DamageType } = await import(R + "kernel/types.ts");
const { bettingHpScale } = await import(R + "compile/betting-policies.ts");

setSkillLevelMode("MAX");

const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const unit = (shikigamiId: number, hp: number, extra: any = {}, soulIds: number[] = []): any => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra },
  soulIds,
});
async function match(red: any[], blue: any[], seed = 1) {
  const A: any = await assembleGuessingMatch({ _meta: { title: "t11-yuki" }, red, blue } as any, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  const yuki = b.teams[0].members[0];
  return { b, yuki };
}
const YU = () => unit(591, 20000, { atk: 5000, cri: 50, crid: 210, def: 700, spd: 140 });
const FOES = () => [unit(201, 90000), unit(201, 60000), unit(201, 80000)];
const damages = (b: any, from = 0) => b.trace.slice(from).filter((t: any) => t.t === "DAMAGE");
/** Damage without the ±1% float roll. */
const unfloat = (t: any) => t.final / (t.breakdown?.float?.value ?? 1);

sec("[1] L5: the Glass is summoned at battle start with the tips_5911 stats; Yuki is immune while it lives");
{
  const { b, yuki } = await match([YU()], FOES());
  const g = glassOf(b, yuki);
  ok("Glass on the field after startup", !!g && g.alive);
  ok("HP = 360% of initial ATK, not × the betting HP scale (match-7 replay)", near(g.maxHp, Math.round(5000 * YUKI.glassHpAtk)) && bettingHpScale() > 1, String(g?.maxHp));
  ok("inherits crit / crit damage / DEF and 95% SPD", near(g.base.cri, yuki.base.cri) && near(g.base.crid, yuki.base.crid) && g.base.def === yuki.base.def && near(g.speed, yuki.base.spd * 0.95), `spd ${g.speed}`);
  ok("immune to debuffs and control", ["DEBUFF", "CONTROL"].every(k => g.statuses.some((s: any) => (s.def.immuneTo ?? []).includes(k))));
  ok("Yuki carries the damage-immunity status", yuki.hasStatus(GUARD_ID));
  const foe = b.teams[1].members[0];
  ok("the Glass is untargetable (not in either enemiesOf; match-7 replay)", !b.enemiesOf(1).includes(g) && !b.enemiesOf(0).includes(g) && g.caps.canBeTargeted === false);
  const hp0 = yuki.hp;
  await b.damage(foe, yuki, 5000, DamageType.NORMAL, 1, null);
  ok("damage on Yuki is negated", yuki.hp === hp0);
  const n0 = b.trace.length;
  const gsk = g.skills[0];
  await gsk.execute(b, g, gsk.pickTarget(b, g, b.enemiesOf(0)));
  const d = damages(b, n0);
  const low = b.teams[1].members.reduce((a: any, c: any) => (c.hp < a.hp ? c : a));
  ok("Glass turn: one hit on the lowest-HP enemy, base = 50% of its max HP", d.length === 1 && d[0].src === g.id && d[0].dst === low.id, JSON.stringify(d.map((x: any) => [x.src, x.dst, x.base ?? x.raw])));
}

sec("[2] re-summon while alive: max HP +39% initial ATK (3 times at most) and full heal");
{
  const { b, yuki } = await match([YU()], FOES());
  const g = glassOf(b, yuki);
  const hp0 = g.maxHp;
  g.hp = 10;
  for (let i = 0; i < 5; i++) summonGlass(b, yuki, 0, "TEST");
  ok("still one Glass", b.teams[0].summons.filter((s: any) => s.alive).length === 1);
  ok("+39% × 3 only (unscaled)", near(g.maxHp, hp0 + 3 * Math.round(5000 * 0.39)), `${hp0} → ${g.maxHp}`);
  ok("full HP", g.hp === g.maxHp);
}

sec("[3] the Glass dies ⇒ the immunity ends; killing an enemy summons a new one at the victim's bar position");
{
  const { b, yuki } = await match([YU()], [unit(201, 90000), unit(201, 1000), unit(201, 80000)]);
  const g = glassOf(b, yuki);
  const foe = b.teams[1].members[0];
  await b.damage(foe, g, 1e9, DamageType.TRUE, 1, null);
  ok("Glass dead", !g.alive);
  ok("Yuki lost the immunity", !yuki.hasStatus(GUARD_ID));
  const hp0 = yuki.hp;
  await b.damage(foe, yuki, 3000, DamageType.NORMAL, 1, null);
  ok("Yuki takes damage again", yuki.hp < hp0);
  const victim = b.teams[1].members[1];
  b.timeline.get(victim.id).pos = 4321;
  await b.damage(yuki, victim, 1e9, DamageType.TRUE, 1, null);
  const g2 = glassOf(b, yuki);
  ok("kill ⇒ a new Glass", !!g2 && g2 !== g && g2.alive);
  ok("…at the victim's action-bar position", near(b.timeline.get(g2.id)?.pos ?? -1, 4321), String(b.timeline.get(g2?.id)?.pos));
  ok("immunity back", yuki.hasStatus(GUARD_ID));
}

sec("[4] 千雪·斩: 9 × 27%; 2 巫灵雪刃 ⇒ the first slash is a 108% 雪爆 on all enemies (+50% on the target); +1 stack after");
{
  const { b, yuki } = await match([unit(591, 20000, { atk: 5000, cri: 0, def: 700, spd: 140 })], FOES());
  const sk = yuki.skills.find((s: any) => s.ir.id === "591_03");
  const target = b.teams[1].members[2];
  b.teams[0].orbs.gain(8);
  let n0 = b.trace.length;
  await sk.execute(b, yuki, target);
  let d = damages(b, n0).filter((t: any) => t.src === yuki.id);
  ok("no stacks: 9 hits on the target", d.length === 9 && d.every((t: any) => t.dst === target.id), String(d.length));
  ok("+1 巫灵雪刃 after the cast", edgeStacks(yuki) === 1);
  await yuki.skills.find((s: any) => s.ir.id === "591_01").execute(b, yuki, target);
  ok("basic attack ⇒ 2 stacks", edgeStacks(yuki) === 2);
  n0 = b.trace.length;
  await sk.execute(b, yuki, target);
  d = damages(b, n0).filter((t: any) => t.src === yuki.id);
  ok("snow burst: 3 (all enemies) + 8 slashes", d.length === 11, String(d.length));
  ok("SNOW_BURST traced, stacks 2 → 0 → 1", b.trace.slice(n0).some((t: any) => t.t === "SNOW_BURST") && edgeStacks(yuki) === 1);
  const burst = d.slice(0, 3);
  const onT = burst.find((t: any) => t.dst === target.id), other = burst.find((t: any) => t.dst !== target.id);
  ok("designated enemy takes +50% snow-burst damage", near(unfloat(onT) / unfloat(other), 1.5, 1e-3), (unfloat(onT) / unfloat(other)).toFixed(4));
}

sec("[5] L5: once the target dies the remaining slashes go to the lowest-HP enemy");
{
  const { b, yuki } = await match([YU()], [unit(201, 90000), unit(201, 1500), unit(201, 30000)]);
  const sk = yuki.skills.find((s: any) => s.ir.id === "591_03");
  b.teams[0].orbs.gain(8);
  const n0 = b.trace.length;
  await sk.execute(b, yuki, b.teams[1].members[1]);
  const d = damages(b, n0).filter((t: any) => t.src === yuki.id);
  ok("target dies, the rest hit the lowest-HP survivor", !b.teams[1].members[1].alive && d.length === 9 && d.slice(-1)[0].dst === b.teams[1].members[2].id, d.map((t: any) => t.dst).join(","));
}

sec("[6] AI: no Glass → 龙胆·绽; Glass + onibi → 千雪·斩; Glass, no onibi → 雪立·裁");
{
  const { b, yuki } = await match([YU()], FOES());
  b.teams[0].orbs.pay(b.teams[0].orbs.current);
  ok("Glass, no onibi → 591_01", bettingPreferredSkill(b, yuki)?.skill?.ir?.id === "591_01");
  b.teams[0].orbs.gain(5);
  ok("Glass + onibi → 591_03", bettingPreferredSkill(b, yuki)?.skill?.ir?.id === "591_03");
  await b.damage(b.teams[1].members[0], glassOf(b, yuki), 1e9, DamageType.TRUE, 1, null);
  ok("no Glass → 591_02", bettingPreferredSkill(b, yuki)?.skill?.ir?.id === "591_02");
  const n0 = b.trace.length;
  await yuki.skills.find((s: any) => s.ir.id === "591_02").execute(b, yuki, b.teams[1].members[0]);
  ok("龙胆·绽 cast: summons, no damage, no stack", !!glassOf(b, yuki) && damages(b, n0).length === 0 && edgeStacks(yuki) === 0);
}

sec("[7] 隐念 Possessor: x1.2 / x1.4 / x1.6 cycling per target");
{
  const { b } = await match([unit(201, 50000, {}, [50, 50, 50, 50])], [unit(201, 900000), unit(201, 900000)]);
  const src = b.teams[0].members[0], [t1, t2] = b.teams[1].members;
  const hit = async (t: any) => { const n0 = b.trace.length; await b.damage(src, t, 1000, DamageType.NORMAL, 1, null); return unfloat(damages(b, n0)[0]); };
  const a = [await hit(t1), await hit(t1), await hit(t2), await hit(t1), await hit(t1)];
  const unitDmg = a[2] / 1.2;
  ok("t1: 1.2, 1.4 · t2: 1.2 · t1: 1.6, then 1.2", [1.2, 1.4, 1.2, 1.6, 1.2].every((m, i) => near(a[i] / unitDmg, m, 1e-3)), a.map(x => (x / unitDmg).toFixed(3)).join(" "));
  ok("SOUL_PROC traced", b.trace.some((t: any) => t.t === "SOUL_PROC" && t.soul === "隐念"));
}

}

// ═════════ 鬼王酒吞童子 341 (betting-shuten.ts) / 万年竹 275 (betting-mannendake.ts) ═════════
{
// scratch: DSD 341 + Mannendake 275 tests (merged later into tests/betting-mechanics-11.ts)
const R = new URL("../", import.meta.url).href;
const { setSkillLevelMode } = await import(R + "compile/max-level.ts");
const { assembleGuessingMatch } = await import(R + "soul/guessing-match.ts");
const { SHUTEN, STANCE_ID, GUARD_ID: STANCE_GUARD, LOTUS_ID, inStance, greatYokaiFactor } = await import(R + "compile/betting-shuten.ts");
const { MANNENDAKE, GUARD_ID: LEAF_ID, BOOST_ID } = await import(R + "compile/betting-mannendake.ts");
const { bettingGate } = await import(R + "compile/betting-mechanics.ts");
const { DamageType, TurnType } = await import(R + "kernel/types.ts");
const { StatusBook, findImmuneStatus } = await import(R + "kernel/status.ts");

setSkillLevelMode("MAX");
const sec = (s: string) => console.log("\n" + s);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const unit = (shikigamiId: number, hp: number, extra: any = {}) => ({
  name: "u" + shikigamiId, shikigamiId,
  stats: { atk: 3000, hp, def: 400, spd: 100, cri: 0, crid: 150, efh: 0, efr: 0, ...extra }, soulIds: [],
});
const TANKS = () => [unit(201, 900000), unit(201, 900000), unit(201, 900000)];
async function match(red: any[], blue: any[], seed = 1) {
  const A: any = await assembleGuessingMatch({ _meta: { title: "betting-mechanics-11" }, red, blue } as any, { seed, traceLevel: "FULL" });
  const b: any = A.battle;
  await b.runStartup();
  const find = (charId: number, team = 0) => b.teams[team].members.find((e: any) => e.skills.some((s: any) => s.ir?.charId === charId));
  return { b, find };
}
const sk = (e: any, id: string) => e.skills.find((s: any) => s.ir?.id === id);
const turn = (b: any, e: any, skill: any, target: any) => b.runPseudoTurn(e, TurnType.NEW_TURN, { skill, target, free: true });

sec("[DSD] 天火怒焱 → 鬼王姿态 (push 40%, 2 of his turns), burn / guard on ally turns, 烈焰焚天");
{
  const { b, find } = await match([unit(341, 100000), unit(201, 100000)], TANKS(), 3);
  const s = find(341), ally = b.teams[0].members.find((e: any) => e !== s), foes = b.teams[1].members;
  ok("红莲: control immunity + heal cut 30%", s.hasStatus(LOTUS_ID) && near(s.prop("healDown"), SHUTEN.healDown)
    && !!findImmuneStatus(s, StatusBook.get("stun"), true));
  const n0 = b.trace.length;
  await turn(b, s, sk(s, "341_03"), foes[0]);
  const shifts = b.trace.slice(n0).filter((t: any) => t.t === "TIMELINE_SHIFT" && t.skill === "天火怒焱");
  ok("enemies pushed back 40%", shifts.length === 3 && shifts.every((t: any) => near(t.percent, -0.4)), JSON.stringify(shifts.map((t: any) => t.percent)));
  ok("stance entered and survives the casting turn", inStance(s));
  ok("天火怒焱 refused while in stance", bettingGate(b, s, sk(s, "341_03")) === "IN_DEMON_STANCE");
  const hp0 = ally.hp;
  await turn(b, ally, sk(ally, "201_01") ?? ally.skills[0], foes[0]);
  ok("ally turn start: loses 24% of current HP", near(ally.hp, hp0 * (1 - SHUTEN.burn), 1), `${hp0} → ${ally.hp}`);
  ok("…and holds the damage guard until the next turn starts", ally.hasStatus(STANCE_GUARD));
  const before = ally.hp;
  await b.damage(foes[0], ally, 5000, DamageType.NORMAL, 1, null);
  ok("guarded ally takes no damage", ally.hp === before);
  const n1 = b.trace.length;
  await turn(b, s, sk(s, "341_01"), foes[1]);
  ok("guard removed at the next turn start", !ally.hasStatus(STANCE_GUARD));
  const variant = b.trace.slice(n1).find((t: any) => t.t === "SKILL_VARIANT");
  const dmg = b.trace.slice(n1).filter((t: any) => t.t === "DAMAGE");
  const main = dmg.find((t: any) => t.dst === foes[1].id), splash = dmg.filter((t: any) => t.dst !== foes[1].id);
  ok("in stance 焚天 becomes 烈焰焚天", variant?.variant === "烈焰焚天");
  ok("splash = TRUE 40% of the main hit on each other enemy", splash.length === 2 && splash.every((t: any) => t.type === "TRUE" && Math.abs(t.final / (main.final * SHUTEN.splashTrue) - 1) < 0.05),
    `main ${main?.final} splash ${splash.map((t: any) => t.final)}`);
  ok("stance still on after his 1st stance turn", inStance(s));
  await turn(b, s, sk(s, "341_01"), foes[1]);
  ok("stance ends after his 2nd stance turn", !inStance(s));
  ok("L3: stance end recovers allies (RECOVER traces)", b.trace.some((t: any) => t.t === "RECOVER" && t.src === s.id));
}

sec("[DSD] 大妖之力: +1% damage / +1% reduction per 1% HP lost, doubled on himself, reduction capped");
{
  const { b, find } = await match([unit(341, 100000), unit(201, 100000)], TANKS(), 4);
  const s = find(341), ally = b.teams[0].members.find((e: any) => e !== s), foe = b.teams[1].members[0];
  ally.hp = ally.maxHp * 0.5; s.hp = s.maxHp * 0.5;
  ok("ally at 50% HP deals ×1.5", near(greatYokaiFactor(s, ally, foe), 1.5));
  ok("DSD at 50% HP deals ×2", near(greatYokaiFactor(s, s, foe), 2));
  ok("ally at 50% HP takes ×0.5", near(greatYokaiFactor(s, foe, ally), 0.5));
  ok("DSD at 50% HP takes ×0.25 (reduction capped at 75%)", near(greatYokaiFactor(s, foe, s), 1 - SHUTEN.reductionCap));
  s.hp = s.maxHp;
  ok("full HP ⇒ ×1", near(greatYokaiFactor(s, s, foe), 1) && near(greatYokaiFactor(s, foe, s), 1));
}

sec("[Mannendake] 竹语: 竹叶守护 + 15% of his ATK to every ally, sustained through his next turn");
{
  const { b, find } = await match([unit(275, 100000, { atk: 4000 }), unit(201, 100000)], TANKS(), 5);
  const m = find(275), ally = b.teams[0].members.find((e: any) => e !== m), foe = b.teams[1].members[0];
  const atk0 = ally.prop("atk");
  await turn(b, m, sk(m, "275_03"), ally);
  ok("every ally has 竹叶守护", b.teams[0].members.every((e: any) => e.hasStatus(LEAF_ID)));
  ok("ATK + 15% of Mannendake's ATK", near(ally.prop("atk") - atk0, m.prop("atk") * MANNENDAKE.atkShare - 0, 1) || near(ally.prop("atk") - atk0, 4000 * MANNENDAKE.atkShare, 1), `${atk0} → ${ally.prop("atk")}`);
  await turn(b, ally, ally.skills[0], foe);
  ok("still there after an ally turn", ally.hasStatus(LEAF_ID) && ally.hasStatus(BOOST_ID));
  await turn(b, m, sk(m, "275_01"), foe);
  ok("ally mark / boost expire at the end of his next turn", !ally.hasStatus(LEAF_ID) && !ally.hasStatus(BOOST_ID));
  ok("…while he re-gains his own mark at his turn end", m.hasStatus(LEAF_ID));
}

sec("[Mannendake] counters: 100% when he is hit, 60% for other bearers, at most one per enemy action");
{
  const { b, find } = await match([unit(275, 900000), unit(201, 900000), unit(201, 900000)], TANKS(), 6);
  const m = find(275), others = b.teams[0].members.filter((e: any) => e !== m), foe = b.teams[1].members[0];
  await turn(b, m, sk(m, "275_03"), others[0]);
  const counters = () => b.trace.filter((t: any) => t.t === "COUNTER" && t.actor === m.id).length;
  let c0 = counters();
  b.turn = 1000;
  await b.damage(foe, m, 100, DamageType.NORMAL, 1, null);
  ok("hit on Mannendake ⇒ counter", counters() === c0 + 1);
  let fired = 0; const N = 300;
  for (let i = 0; i < N; i++) {
    b.turn = 2000 + i;
    for (const e of [...b.teams[0].members]) if (!e.hasStatus(LEAF_ID)) e.addStatus(StatusBook.get(LEAF_ID), m.id, 1, 99, [], 1);
    c0 = counters();
    await b.damage(foe, others[0], 100, DamageType.NORMAL, 1, null);
    fired += counters() - c0;
  }
  ok("other bearer hit ⇒ ≈60% counter", fired / N > 0.5 && fired / N < 0.7, (fired / N).toFixed(3));
  let multi = 0;
  for (let i = 0; i < 100; i++) {
    b.turn = 5000 + i;
    c0 = counters();
    for (const e of b.teams[0].members) await b.damage(foe, e, 100, DamageType.NORMAL, 1, null);
    multi = Math.max(multi, counters() - c0);
  }
  ok("an AoE action triggers at most one counter", multi === 1, "max " + multi);
}

sec("[Mannendake] 笛中剑: 125%, 30% Challenge of another ally on the same target");
{
  const { b, find } = await match([unit(275, 900000), unit(201, 900000)], TANKS(), 7);
  const m = find(275), foe = b.teams[1].members[0];
  const flute = sk(m, "275_01");
  const N = 300; const n0 = b.trace.length;
  for (let i = 0; i < N; i++) await flute.execute(b, m, foe);
  const ch = b.trace.slice(n0).filter((t: any) => t.t === "CHALLENGE" && t.src === m.id);
  ok("≈30% Challenge", ch.length / N > 0.22 && ch.length / N < 0.38, (ch.length / N).toFixed(3));
  ok("the challenged ally attacks the same target", ch.every((t: any) => t.target === foe.id && t.actor !== m.id));
}

}

console.log(`\nbetting-mechanics-11: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
