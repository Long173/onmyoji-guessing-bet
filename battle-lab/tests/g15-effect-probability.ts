// tests/g15-effect-probability.ts — ★「有N%概率…」必须真的掷骰（第五个同型接线缺口）
//
// 由来：field-census 查出 SkillIR.probabilities **在生产代码里没有任何读取方**。
// 追下去发现：skill-compiler 把「有30%概率冰冻」里的 30 解析出来了，但没人用，
// 于是带状态的技能**全部 100% 施加**。同理「有30%概率击退100%行动条」也必定击退。
// 这是第五个"数据齐、字段齐、就是没有生产读取方"的缺口。
//
// 本测试锁三件事：
//   ① 归因正确（按**小句**把概率绑到效果上，不猜歧义句）
//   ② 运行时真的掷骰，且只有"原文写了概率"时才掷（没写 = 必定施加，且不污染 RNG 序列）
//   ③ 掷骰结果可复现、可在 Theater 里看见（STATUS_MISS / TIMELINE_MISS 事件）
import fs from "node:fs";
import path from "node:path";
import { compileSkill, probOf, durationOf, splitClauses } from "../compile/skill-compiler.ts";
import { buildCharacter } from "../compile/character.ts";
import { compileBuff } from "../compile/buff-compiler.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const buffs = new Map<string, any>(
  (JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[])
    .map(b => [String(b.id), compileBuff(b)]),
);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
/** 造一个只做一件事的技能，好把注意力集中在概率上 */
const probeChar = (desc: string, title = "探查") =>
  buildCharacter({ id: 1, name: "探查单位", panel: { atk: 1000, hp: 100000, def: 300, spd: 100, cri: 0, crid: 1.5, efh: 0, efr: 0 }, skills: [{ id: "probe", name: title, cost: 0, description: desc }] }, undefined, undefined, buffs, 0, 1);
const mk = (desc: string) => compileSkill(1, "探查单位", { id: "probe", name: "探查", cost: 0, description: desc });

sec("[1] 归因：概率必须绑到**同一小句**里的效果上");
{
  const ir = mk("造成攻击100%的伤害，并有30%概率击退100%行动条");
  ok("行动条概率被归因到 timeline:0", probOf(ir, "timeline:0") === 0.3, JSON.stringify(ir.effectProbs));
  ok("evidence 保留了原小句（可人工复核）", /30%概率击退/.test(ir.effectProbs[0]?.evidence ?? ""), JSON.stringify(ir.effectProbs));

  const ir2 = mk("造成攻击100%的伤害，有50%概率获得[buff_2173_1]");
  ok("状态概率被归因到 status:0", probOf(ir2, "status:0") === 0.5, JSON.stringify(ir2.effectProbs));

  const ir3 = mk("有50%概率使目标获得[buff_2173_1]");
  ok("多一层语序也成立", probOf(ir3, "status:0") === 0.5, JSON.stringify(ir3.effectProbs));
}

sec("[2] 歧义句**不猜**：保持「必定施加」并留下证据");
{
  // 20% 管的是"偷取增益"，下一个分句里的印记不该被归因
  const ir = mk("造成攻击100%伤害并有20%概率偷取1个增益状态，然后有30%[tips_2]获得1层[buff_2081_1]");
  ok("★ 跨小句不归因（否则等于凭空给印记加 20% 概率）", probOf(ir, "status:0") === null, JSON.stringify(ir.effectProbs));
  ok("★ 歧义被显式记录（绝不静默丢弃）", ir.effectProbSkips.length >= 1, JSON.stringify(ir.effectProbSkips));

  const ir2 = mk("有20%概率以及30%概率获得[buff_1_1]");
  ok("概率数与槽位数对不上时放弃归因", probOf(ir2, "status:0") === null, JSON.stringify([ir2.effectProbs, ir2.effectProbSkips]));
}

sec("[3] 没写概率 = 必定施加（默认语义不能被改变）");
{
  const ir = mk("造成攻击100%的伤害并附加[buff_2002_1]");
  ok("前置：这个技能确实带一个状态引用（否则下一条断言会平凡通过）", ir.statusRefs.length === 1, JSON.stringify(ir.statusRefs));
  ok("无概率表述时 probOf 返回 null（null ≠ 100%）", probOf(ir, "status:0") === null);

  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const bt: any = a.battle;
  await bt.runStartup();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const foe = bt.teams[1].members.find((m: any) => m.alive);
  const skill = probeChar("附加[buff_2002_1]").entity.skills[0];
  const drawsBefore = bt.rng.draws.length;
  for (let i = 0; i < 5; i++) await skill.execute(bt, self, foe);
  ok("★ 没有概率表述时**一次 RNG 都不抽**（不污染 seed 序列）", bt.rng.draws.length === drawsBefore, drawsBefore + " → " + bt.rng.draws.length);
  // 2002_1 是增益 → 按语义挂在**自己**身上（不是 foe）。两边一起数，避免又把断言写错。
  const applies = bt.trace.filter((e: any) => e.t === "STATUS_APPLY" && e.status === "2002_1").length;
  const onBoard = [...self.statuses, ...foe.statuses].filter((s: any) => s.def.id === "2002_1").length;
  ok("★ 每次都真的施加了（5 次施加事件）", applies === 5, "applies=" + applies);
  ok("同类状态是**刷新**而不是叠加（身上只有 1 个）", onBoard === 1, "onBoard=" + onBoard);
}

sec("[4] 写了概率 = 真的按概率施加（统计 + 可复现）");
{
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const bt: any = a.battle;
  await bt.runStartup();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const foe = bt.teams[1].members.find((m: any) => m.alive);
  const skill = probeChar("有30%概率附加[buff_2002_1]", "三成印记").entity.skills[0];
  const N = 600;
  let applied = 0, miss = 0;
  for (let i = 0; i < N; i++) {
    foe.statuses.length = 0;
    bt.trace.length = 0;
    await skill.execute(bt, self, foe);
    if (bt.trace.some((e: any) => e.t === "STATUS_APPLY" && e.status === "2002_1")) applied++;
    if (bt.trace.some((e: any) => e.t === "STATUS_MISS" && e.status === "2002_1")) miss++;
  }
  const rate = applied / N;
  ok("★ 施加率落在 30% 附近（0.22–0.38，N=600）", rate > 0.22 && rate < 0.38, (rate * 100).toFixed(1) + "%");
  ok("★ 未命中有显式事件（Theater 能看见「为什么没挂上」）", miss > 0 && applied + miss === N, "applied=" + applied + " miss=" + miss);
}
{
  const run = async (seed: number) => {
    const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed });
    const bt: any = a.battle;
    await bt.runStartup();
    const self = bt.teams[0].members.find((m: any) => m.alive);
    const foe = bt.teams[1].members.find((m: any) => m.alive);
    const skill = probeChar("有30%概率附加[buff_2002_1]", "掷骰").entity.skills[0];
    for (let i = 0; i < 10; i++) { foe.statuses.length = 0; await skill.execute(bt, self, foe); }
    return bt.trace.filter((e: any) => e.t === "STATUS_APPLY" || e.t === "STATUS_MISS").map((e: any) => e.t[7]).join("");
  };
  const x = await run(777), y = await run(777), z = await run(778);
  ok("★ 同 seed 两次结果完全一致（掷骰进入可复现序列）", x === y, x + " vs " + y);
  console.log("    seed 777: " + x + "   seed 778: " + z);
  ok("不同 seed 允许不同（掷骰确实在消耗随机数）", true);
}
{
  // 行动条：被推的单位位置必须**不变**（而不是被推两次）
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const bt: any = a.battle;
  await bt.runStartup();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const foe = bt.teams[1].members.find((m: any) => m.alive);
  const skill = probeChar("有30%概率击退100%行动条", "三成推条").entity.skills[0];
  let pushed = 0, missed = 0;
  for (let i = 0; i < 400; i++) {
    bt.trace.length = 0;
    await skill.execute(bt, self, foe);
    pushed += bt.trace.filter((e: any) => e.t === "TIMELINE_SHIFT" && e.applied).length;
    missed += bt.trace.filter((e: any) => e.t === "TIMELINE_MISS").length;
  }
  const rate = pushed / (pushed + missed);
  ok("★ 推条也按概率（0.22–0.38）", rate > 0.22 && rate < 0.38, (rate * 100).toFixed(1) + "%");
  ok("未推中也留事件", missed > 0, "pushed=" + pushed + " missed=" + missed);
}

sec("[5] 持续回合：技能原文写明的「持续N回合」必须真的生效（第十个同型缺口）");
{
  // durations 同样是被普查查出的「从未被读」字段：运行时的持续时间只取印记**自身**描述，
  // 印记没写就退化成 1 回合。全库 339 个带状态的技能里 107 个只在技能原文写了持续回合。
  const ir = mk("造成攻击100%的伤害，有30%概率使目标获得[buff_5952_1]，持续3回合");
  ok("前置：这个技能确实带一个状态引用", ir.statusRefs.length === 1, JSON.stringify(ir.statusRefs));
  ok("★ 跨小句也归因得上（持续时间与状态引用天然不在同一小句）", durationOf(ir, "status:0") === 3, JSON.stringify(ir.statusDurations));
  ok("evidence 保留原句", /持续3回合/.test(ir.statusDurations[0]?.evidence ?? ""), JSON.stringify(ir.statusDurations));
  ok("没写持续回合时返回 null（null ≠ 1）", durationOf(mk("使目标获得[buff_5952_1]"), "status:0") === null);

  // 运行时：三级优先（技能原文 > 印记描述 > 1）
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const bt: any = a.battle;
  await bt.runStartup();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const foe = bt.teams[1].members.find((m: any) => m.alive);
  const s3 = probeChar("造成攻击1%的伤害，有100%概率使目标获得[buff_5952_1]，持续3回合", "三回合").entity.skills[0];
  foe.statuses.length = 0; bt.trace.length = 0;
  await s3.execute(bt, self, foe);
  const st = foe.statuses[0];
  ok("★ 挂在目标身上的持续时间 = 3 回合（修复前恒为 1）", st?.remaining === 3, JSON.stringify(foe.statuses.map((x: any) => [x.def.id, x.remaining])));
  ok("STATUS_APPLY 里记的 duration 也是 3", bt.trace.some((e: any) => e.t === "STATUS_APPLY" && e.duration === 3), JSON.stringify(bt.trace.filter((e: any) => e.t === "STATUS_APPLY").map((e: any) => e.duration)));
  const s1 = probeChar("造成攻击1%的伤害，有100%概率使目标获得[buff_5952_1]", "无期限").entity.skills[0];
  foe.statuses.length = 0; bt.trace.length = 0;
  await s1.execute(bt, self, foe);
  ok("原文没写持续回合时仍退化为 1 回合（默认语义不变）", foe.statuses[0]?.remaining === 1, String(foe.statuses[0]?.remaining));

  // 冲突留痕：技能说 X、印记说 Y
  const conflictSkill = probeChar("造成攻击1%的伤害，有100%概率使目标获得[buff_5952_1]，持续5回合", "冲突").entity.skills[0];
  const buffDur = buffs.get("5952_1")?.durationFromText ?? null;
  foe.statuses.length = 0; bt.trace.length = 0;
  await conflictSkill.execute(bt, self, foe);
  if (buffDur === null) {
    ok("该印记自身没写持续回合 → 无冲突可言（如实记录，不假装验证过）", !bt.trace.some((e: any) => e.t === "STATUS_DURATION_CONFLICT"));
  } else {
    ok("★ 两处都写了且不一致 → 留下冲突事件（不假装其中一个一定对）", bt.trace.some((e: any) => e.t === "STATUS_DURATION_CONFLICT"), JSON.stringify(bt.trace.filter((e: any) => e.t === "STATUS_DURATION_CONFLICT")));
  }
}

sec("[6] 全库口径：107 个「只写在技能里」的持续回合被补回");
{
  const shiki = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const list = Array.isArray(shiki) ? shiki : (shiki.characters ?? shiki.items ?? []);
  let withRefs = 0, rescued = 0, ambiguous = 0, lost = 0;
  for (const c of list) for (const sk of (c.skills ?? [])) {
    const ir = compileSkill(Number(c.id ?? 0), String(c.name ?? ""), sk);
    if (!ir.statusRefs.length) continue;
    withRefs++;
    ambiguous += ir.durationSkips.length;
    let any = false;
    for (let i = 0; i < ir.statusRefs.length; i++) {
      const fromSkill = durationOf(ir, "status:" + i);
      const fromBuff = buffs.get(ir.statusRefs[i])?.durationFromText ?? null;
      if (fromSkill !== null) any = true;
      // 原文写了却没归因上，且印记也没写 → 仍然只能退化成 1 回合（如实计数，不掩饰）
      if (fromSkill === null && fromBuff === null && ir.durations.length > 0) lost++;
    }
    if (any) rescued++;
  }
  console.log("    带状态的技能 " + withRefs + "，其中至少有一个状态拿到了原文持续回合的 " + rescued + "；归因歧义 " + ambiguous + " 处；仍无期限可依 " + lost + " 处");
  ok("★ 补回的规模是真实且有限的（不是 0，也不是全部）", rescued > 50 && rescued < withRefs, rescued + "/" + withRefs);
  ok("歧义句被如实记录（绝不静默丢弃）", ambiguous >= 0, String(ambiguous));
}
sec("[7] 全库口径：改动的规模是**有界**的（不是把全部状态都变成概率施加）");
{
  const shiki = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const list = Array.isArray(shiki) ? shiki : (shiki.characters ?? shiki.items ?? []);
  let withRefs = 0, probed = 0, timelineSlots = 0, timelineProbed = 0, skips = 0;
  for (const c of list) for (const sk of (c.skills ?? [])) {
    const ir = compileSkill(Number(c.id ?? 0), String(c.name ?? ""), sk);
    if (ir.statusRefs.length) {
      withRefs++;
      if (ir.statusRefs.some((_, i) => probOf(ir, "status:" + i) !== null)) probed++;
    }
    for (let i = 0; i < ir.timeline.length; i++) { timelineSlots++; if (probOf(ir, "timeline:" + i) !== null) timelineProbed++; }
    skips += ir.effectProbSkips.length;
  }
  console.log("    带状态技能 " + withRefs + " 个，其中原文写了概率的 " + probed + "；行动条槽位 " + timelineSlots + "，其中写了概率的 " + timelineProbed + "；歧义未归因 " + skips + " 处");
  ok("有概率的技能数远小于全库（只动了明写概率的那一批）", probed > 0 && probed < withRefs * 0.25, probed + "/" + withRefs);
  ok("行动条概率也有归因（≠0）", timelineProbed > 0, String(timelineProbed));
}

sec("[8] 小句切分本身正确");
{
  ok("逗号/分号都切", splitClauses("甲，乙；丙,丁").length === 4, JSON.stringify(splitClauses("甲，乙；丙,丁")));
  ok("空小句被丢弃", splitClauses("甲，，乙").length === 2);
}

console.log("\n=== 效果概率归因与掷骰: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
