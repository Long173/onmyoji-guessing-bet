// tests/g123-drunk.ts — ★★★ 第 245 轮：**「醉倒」类自伤状态标记**（狸猫 208_02）—— 以及它揭出来的「编译率冒充真实性」
//
// 由来（本轮实测）：208_02 的两句此前 `sentences` 都写着 **PARSED**、`unparsed` 为空、`confidence: HIGH`，
//   而「醉倒」这个状态**根本不存在**（338 条 buff 里没有）、「直至下回合醒来并治疗生命上限6%的生命」的治疗
//   也**一处都没读出来**（`heal: []`）—— 报表说"完整编译"，事实是这句没做。
// 这一轮把它做成真机制：合成状态 `DRUNK` + IR 键 `drunk` + 三条运行时行为（全取自原文）。
// 判据：产物逐字 · 记账点名 · 三条行为各自双向 · 条件不掷骰 · 上限封顶 · 指纹不变。
import fs from "node:fs";
import path from "node:path";
import { EV } from "../kernel/types.ts";
import { DRUNK_ID, drunkDef, StatusBook } from "../kernel/status.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const dump: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "skill-ir.json"), "utf8"));

sec("[1] ★★★ 产物：全库恰好 1 条带 drunk（狸猫 208_02），字段逐字对齐原文");
{
  const withD = dump.filter((ir: any) => ir.drunk);
  ok("★★★ 带 drunk 的技能恰好 1 条（狸猫「醉倒」208_02）", withD.length === 1 && withD[0].id === "208_02", JSON.stringify(withD.map((ir: any) => ir.id)));
  const d = withD[0]?.drunk ?? {};
  ok("★★★ 三段全部读到：20% 概率醉倒 / 醒来治疗生命上限6% / 被攻击 50% 概率吵醒 + 给攻击者 1 层 buff_2081_1（上限5）",
    String(d.name) === "醉倒" && Number(d.chance) === 20 && Number(d.healRatio) === 6 && d.healBase === "maxHp" &&
    Number(d.wakeChance) === 50 && String(d.wakeBuffRef) === "2081_1" && Number(d.wakeBuffCap) === 5,
    JSON.stringify(d));
  ok("★★ 判据原句可复核（带「回合结束时…有N%概率」）", /回合结束时/.test(String(d.clause)) && /概率/.test(String(d.clause)), String(d.clause));
  ok("★★★ 报表能一眼看出这条技能靠哪个机制（recognized 里点名，不再是「看着像完整编译」）",
    (withD[0]?.recognized ?? []).some((r: string) => /^drunk:醉倒@20%$/.test(r)), JSON.stringify(withD[0]?.recognized));
  ok("★★★ 别的 817 条技能没有这个键", dump.filter((ir: any) => ir.drunk).length === 1, String(dump.length));
}

sec("[2] ★★★ 行为①：回合结束 20% 概率醉倒（真掷 + 条件不掷）");
const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return { unitId: "u-" + name, shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 40000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 }, soulId: null };
};
async function arena(who: string, seed: number) {
  const m: any = canonicalMatch();
  m.red.units[0] = unit(who);
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives: "PARSED_CANDIDATES_ONLY", traceLevel: "FULL" });
  await a.battle.runStartup();
  return { b: a.battle, e: a.battle.teams[0].members[0], foe: a.battle.teams[1].members[0] };
}
const drunkOn = (b: any, e: any) => (e.statuses ?? []).some((x: any) => String(x?.def?.id) === DRUNK_ID);
{
  const A = await arena("狸猫", 245);
  ok("★★ 装机：三个处理器都在（drunk_end / drunk_wake / drunk_hit）",
    A.b.bus.hasHandler("drunk_end:" + A.e.id + ":醉倒") && A.b.bus.hasHandler("drunk_wake:" + A.e.id + ":醉倒") && A.b.bus.hasHandler("drunk_hit:" + A.e.id + ":醉倒"),
    JSON.stringify([A.b.bus.hasHandler("drunk_end:" + A.e.id + ":醉倒"), A.b.bus.hasHandler("drunk_wake:" + A.e.id + ":醉倒"), A.b.bus.hasHandler("drunk_hit:" + A.e.id + ":醉倒")]));
  let applied = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    for (const s of [...(A.e.statuses ?? [])]) if (String(s?.def?.id) === DRUNK_ID) A.e.expireStatus(s);   // 每次都从"没醉"开始，只看这一掷
    await A.b.bus.dispatch(EV.TURN_END, { battle: A.b, self: A.e }, A.e.id, A.e.teamId, (id: number) => A.b.teamOf(id));
    if (drunkOn(A.b, A.e)) applied++;
  }
  const rolls = (A.b.rng.draws ?? []).filter((x: any) => String(x.tag).startsWith("drunk_roll:"));
  ok("★★★ 每次回合结束恰好掷一次（" + rolls.length + " == " + N + "）", rolls.length === N, String(rolls.length));
  const rate = applied / N;
  ok("★★★ 20% 是真掷出来的（醉倒 " + (rate * 100).toFixed(1) + "%，3σ 带内）", rate >= 0.10 && rate <= 0.32, applied + "/" + N);
}

sec("[3] ★★★ 行为②：下回合醒来 ⇒ 移除状态 + 治疗生命上限 6%（条件不掷骰）");
{
  const B = await arena("狸猫", 245);
  const before = (B.b.rng.draws ?? []).length;
  B.e.hp = 1000;
  B.e.addStatus(drunkDef("醉倒"), B.e.id, 1, 99999, [], null);
  const t0 = B.b.trace.length;
  await B.b.bus.dispatch(EV.TURN_START, { battle: B.b, self: B.e }, B.e.id, B.e.teamId, (id: number) => B.b.teamOf(id));
  const ev = B.b.trace.slice(t0);
  ok("★★★ 醒来：状态被移除（走 expireStatus，不是静默留着）", !drunkOn(B.b, B.e) && ev.some((x: any) => x.t === "STATUS_EXPIRE" && x.status === DRUNK_ID && x.reason === "DRUNK_WOKE_TURN"), JSON.stringify(ev.map((x: any) => x.t)));
  ok("★★★ 并且治疗了生命上限 6%（1000 → " + B.e.hp + "，期望 " + (1000 + Math.floor(B.e.maxHp * 0.06)) + "）", B.e.hp === 1000 + Math.floor(B.e.maxHp * 0.06), String(B.e.hp));
  ok("★★★ 而且**一次骰都没掷**（醒来是条件成立的结果，不是概率）", (B.b.rng.draws ?? []).length === before, String((B.b.rng.draws ?? []).length - before));
  const C = await arena("狸猫", 245);
  C.e.hp = 1000;
  const t1 = C.b.trace.length;
  await C.b.bus.dispatch(EV.TURN_START, { battle: C.b, self: C.e }, C.e.id, C.e.teamId, (id: number) => C.b.teamOf(id));
  ok("★★★ 反向：没醉时回合开始 ⇒ 既不治疗也不留痕", C.e.hp === 1000 && !C.b.trace.slice(t1).some((x: any) => x.t === "STATUS_EXPIRE"), String(C.e.hp));
}

sec("[4] ★★★ 行为③：醉倒时被敌方攻击 ⇒ 50% 被吵醒 + 给攻击者 1 层 buff_2081_1（上限 5 层封顶）");
{
  const D = await arena("狸猫", 245);
  const hit = (crit: boolean, src: any) => D.b.bus.dispatch(EV.AFTER_DAMAGE, { input: { source: src, target: D.e }, result: { isCrit: crit, applied: 100 } }, src.id, src.teamId, (id: number) => D.b.teamOf(id));
  const before = (D.b.rng.draws ?? []).length;
  await hit(false, D.foe);
  ok("★★★ 反向（没醉）：被攻击时**一次骰都不掷**（条件是读状态，不是概率）", (D.b.rng.draws ?? []).length === before, String((D.b.rng.draws ?? []).length - before));
  let woken = 0;
  const M = 240;
  for (let i = 0; i < M; i++) {
    for (const s of [...(D.e.statuses ?? [])]) if (String(s?.def?.id) === DRUNK_ID) D.e.expireStatus(s);
    D.e.addStatus(drunkDef("醉倒"), D.e.id, 1, 99999, [], null);
    D.e.hp = 1000;
    await hit(false, D.foe);
    if (!drunkOn(D.b, D.e)) woken++;
  }
  const wr = (D.b.rng.draws ?? []).filter((x: any) => String(x.tag).startsWith("drunk_wake_roll:"));
  ok("★★★ 醉着被攻击：每次恰好掷一次（" + wr.length + " == " + M + "）", wr.length === M, String(wr.length));
  ok("★★★ 50% 是真掷出来的（吵醒 " + (woken / M * 100).toFixed(1) + "%）", woken / M >= 0.38 && woken / M <= 0.62, woken + "/" + M);
  const srcBuffs = (D.foe.statuses ?? []).filter((x: any) => String(x?.def?.id) === "2081_1");
  ok("★★★ 吵醒时给**攻击者**附上了 buff_2081_1，且层数被上限 5 封顶（实测 " + (srcBuffs[0]?.stacks ?? 0) + " 层）",
    srcBuffs.length === 1 && Number(srcBuffs[0].stacks) === 5, JSON.stringify(srcBuffs.map((s: any) => [s.def.id, s.stacks])));
  ok("★★ 而狸猫自己身上没有这个 buff（「附上给攻击者」不是给自己）", !(D.e.statuses ?? []).some((x: any) => String(x?.def?.id) === "2081_1"));
  /** 友方来源不算"被攻击" */
  const E2 = await arena("狸猫", 245);
  E2.e.addStatus(drunkDef("醉倒"), E2.e.id, 1, 99999, [], null);
  const b2 = (E2.b.rng.draws ?? []).length;
  await E2.b.bus.dispatch(EV.AFTER_DAMAGE, { input: { source: E2.b.teams[0].members[1], target: E2.e }, result: { isCrit: false, applied: 10 } }, E2.b.teams[0].members[1].id, 0, (id: number) => E2.b.teamOf(id));
  ok("★★★ 反向：友方造成的伤害不触发吵醒（也不掷骰）", drunkOn(E2.b, E2.e) && (E2.b.rng.draws ?? []).length === b2, String((E2.b.rng.draws ?? []).length - b2));
}

sec("[5] ★★ 爆炸半径：狸猫不在典型阵容里（指纹的护栏）");
{
  const LINEUP = [202, 297, 601, 225, 346, 205, 358, 267, 352, 390];
  ok("★★ 208 不在典型对局阵容里 ⇒ 两个指纹不该动（另见 g0/g3 的指纹断言）", !LINEUP.includes(208));
  ok("★★ 合成状态的定义是常量（进 stateHash 的 id 不许有随机成分）", drunkDef().id === DRUNK_ID && drunkDef("醉倒").id === DRUNK_ID);
}

console.log("\ng123-drunk: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);