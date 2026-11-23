// tests/g24-policy-sweep.ts — ★ 策略敏感性：把「无法下结论」变成「这个判断稳不稳」
//
// 项目里有四个红区，每个都有若干**都说得通**的候选。此前只把 UNKNOWN 写进产物 + 声明免责，
// 那对"我该押哪边"毫无帮助。这一轮补的是：机制**是什么**我们决定不了（红区），
// 但"换成别的候选结论会不会翻"完全可以算 —— 而且同样是诚实的。
//
// 本测试锁四件事：
//   ① 每个组合都被跑到，且**只**用 plausible 候选判定；
//   ② verdict 的三态逻辑正确（全红 / 全蓝 / 跨越 50%）；
//   ③ 措辞不得越过边界：说"对这些候选稳健"，不能说"已确证"；
//   ④ 已知有偏的候选（并列按注册序）必须被排除在判定之外 —— 否则等于用噪声证明不稳。
import fs from "node:fs";
import path from "node:path";
import { sweepPolicies, formatSweep } from "../runner/policy-sweep.ts";
import type { SweepAxis, SweepResult } from "../runner/policy-sweep.ts";
import { assembleGuessingMatch, loadMatchFixture } from "../soul/guessing-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const FIX = path.join(ROOT, "battle-lab", "fixtures", "guessing-match-canonical-001.json");

sec("[1] 三个轴的定义必须如实标注可信度与「是否计入判定」");
{
  const { StartupPolicies, DeathPolicies } = await import("../kernel/policies.ts");
  const { TieBreaks } = await import("../kernel/timeline.ts");
  ok("开局：两个候选都是 HYPOTHESIS（都说得出理由）",
    StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI.status === "HYPOTHESIS" && StartupPolicies.SENKI_FIRST.status === "HYPOTHESIS");
  ok("击杀时点：两个候选都是 HYPOTHESIS",
    DeathPolicies.HP_ZERO_IS_KILLED.status === "HYPOTHESIS" && DeathPolicies.DEATH_AFTER_PREVENTION.status === "HYPOTHESIS");
  ok("并列先后：SPEED_THEN_RANDOM 有依据，UNRESOLVED 自述「已知有偏」",
    /有偏/.test(TieBreaks.UNRESOLVED.note) && /随机/.test(TieBreaks.SPEED_THEN_RANDOM.note), TieBreaks.UNRESOLVED.note);
}

// 轴定义（与 CLI 共用同一份形状）
const axes: SweepAxis[] = [
  { name: "开局", variants: [
    { id: "御魂→被动→先机", status: "HYPOTHESIS", plausible: true, apply: (p: any) => ({ ...p, startup: { id: "NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI", status: "HYPOTHESIS", order: ["SPAWN","INIT_STATS","SOUL_START","PASSIVE_START","SENKI","SUMMON","FIELD","ORB_INIT","TIMELINE_INIT"] } }) },
    { id: "先机优先", status: "HYPOTHESIS", plausible: true, apply: (p: any) => ({ ...p, startup: { id: "SENKI_FIRST", status: "HYPOTHESIS", order: ["SPAWN","INIT_STATS","SENKI","SOUL_START","PASSIVE_START","SUMMON","FIELD","ORB_INIT","TIMELINE_INIT"] } }) },
  ] },
  { name: "击杀时点", variants: [
    { id: "HP≤0即击杀", status: "HYPOTHESIS", plausible: true, apply: (p: any) => ({ ...p, death: { id: "HP_ZERO_IS_KILLED", status: "HYPOTHESIS", killedAt: "HP_ZERO", preventionBeforeDeath: false } }) },
    { id: "先拦截后击杀", status: "HYPOTHESIS", plausible: true, apply: (p: any) => ({ ...p, death: { id: "DEATH_AFTER_PREVENTION", status: "HYPOTHESIS", killedAt: "AFTER_DEATH_RESOLUTION", preventionBeforeDeath: true } }) },
  ] },
  { name: "并列先后", variants: [
    { id: "同速随机", status: "HYPOTHESIS", plausible: true, apply: (p: any) => ({ ...p, tieBreak: "SPEED_THEN_RANDOM" }) },
    { id: "注册序（已知有偏）", status: "UNKNOWN", plausible: false, note: "会造成红方结构性优势，仅作参照", apply: (p: any) => ({ ...p, tieBreak: "UNRESOLVED" }) },
  ] },
];

const fx: any = await loadMatchFixture(FIX);
const N = 60;
// 真实的 base 就是**完整**的一套（CLI 也这么传）：扫描只覆盖被扫的轴，其余保持默认。
const { ResourcePolicies } = await import("../kernel/resource.ts");
const { StartupPolicies, DeathPolicies, GuessingRulesets } = await import("../kernel/policies.ts");
const base = {
  resource: ResourcePolicies.COMMUNITY_4_8_5_345,
  startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
  death: DeathPolicies.DEATH_AFTER_PREVENTION,
  priority: "REGISTRATION_ORDER",
  tieBreak: "SPEED_THEN_RANDOM",
  guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED,
};
const makeBattle = async (seed: number, policies: any) =>
  (await assembleGuessingMatch(fx, { seed, maxTurns: 300, policies })).battle;

sec("[2] 扫描：跑满组合，且只让 plausible 候选参与判定");
let result: SweepResult | null = null;
{
  result = await sweepPolicies(makeBattle, base, axes, N, { seedBase: 20261001 });
  ok("★ 组合数 = 2×2×2 = 8（不是去重后的 4）", result.counts.total === 8, JSON.stringify(result.counts));
  ok("★ 计入判定的只有 4 组（含「注册序」的 4 组被排除）", result.counts.towardVerdict === 4, JSON.stringify(result.counts));
  ok("被排除的组仍然被**跑过并列出**（不是丢掉）", result.counts.excluded === 4 && result.cells.length === 8);
  ok("每个组合都有胜率与样本数", result.cells.every(c => c.winRateRed !== null && c.n === N), JSON.stringify(result.cells.slice(0, 2)));
  console.log(formatSweep(result));
}

sec("[3] verdict 的三态逻辑");
{
  const r = result!;
  const counted = r.cells.filter(c => c.countsTowardVerdict).map(c => c.winRateRed as number);
  const allRed = counted.every(x => x > 0.5), allBlue = counted.every(x => x <= 0.5);
  const expect = allRed ? "STABLE_RED" : allBlue ? "STABLE_BLUE" : "FLIPS";
  ok("★ verdict 与逐组数据一致", r.verdict === expect, r.verdict + " vs " + expect + " " + JSON.stringify(counted.map(x => +(x * 100).toFixed(1))));
  ok("极差 = 最大值 − 最小值", r.spread !== null && Math.abs(r.spread - (Math.max(...counted) - Math.min(...counted))) < 1e-9, String(r.spread));
  ok("min/max 取自**计入判定的**组合", r.minRate === Math.min(...counted) && r.maxRate === Math.max(...counted),
    JSON.stringify([r.minRate, r.maxRate, Math.min(...counted), Math.max(...counted)]));
  // ★ 只报判定内的极差会误导：表格里明明有差异，标题却写「极差 0.0」。
  const allRates2 = r.cells.map(c => c.winRateRed as number);
  ok("★ 另报「含仅参照候选」的极差（spreadAll）", r.spreadAll !== null &&
    Math.abs(r.spreadAll - (Math.max(...allRates2) - Math.min(...allRates2))) < 1e-9, String(r.spreadAll));
  ok("★ 两者不同时，结论文字里把两个数都写出来（不让人以为什么都没变）",
    Math.abs((r.spreadAll ?? 0) - (r.spread ?? 0)) < 1e-9 || /连同仅作参照的候选一起看|含仅参照候选/.test(r.note + formatSweep(r)),
    r.note.slice(-80));
}

sec("[4] ★ 措辞不得越过边界（这是本项目最容易犯的错）");
{
  const r = result!;
  ok("★ 提到「不依赖于那几个未解的问题」或「会翻」，而不是含糊其辞",
    /不依赖于|会\*\*翻\*\*|不建议/.test(r.note), r.note);
  ok("★★ 明确写了「不等于机制已被确证」", /不等于机制已被确证/.test(r.note), r.note);
  ok("★ 不含任何「真实性 / 准确率」式的百分比包装", !/准确率|真实性\s*[:：]?\s*\d/.test(r.note + formatSweep(r)));
  ok("格式化输出里说明了「·」行的含义", /仅作参照/.test(formatSweep(r)));
}

sec("[5] 确定性：同 seed 两次扫描结果一致");
{
  const a = await sweepPolicies(makeBattle, base, [axes[0]], 30, { seedBase: 777 });
  const b = await sweepPolicies(makeBattle, base, [axes[0]], 30, { seedBase: 777 });
  ok("★ 逐组胜率与极差完全一致", JSON.stringify(a.cells) === JSON.stringify(b.cells) && a.spread === b.spread);
  ok("单轴 2 组合", a.counts.total === 2 && a.counts.towardVerdict === 2);
}

sec("[6] 边界：全部候选都不可信时，不给结论");
{
  const onlyRef: SweepAxis[] = [{ name: "并列先后", variants: [axes[2].variants[1]] }];
  const r = await sweepPolicies(makeBattle, base, onlyRef, 30, { seedBase: 7 });
  ok("★ 只有「仅作参照」候选 → INCONCLUSIVE（不硬给结论）", r.verdict === "INCONCLUSIVE", r.verdict);
  ok("并说明了原因", /无法给出稳健性判断/.test(r.note), r.note);
  ok("该组仍被跑过并列出", r.cells.length === 1 && r.cells[0].winRateRed !== null);
}


sec("[7] ★★ 正向对照：扫描必须**能测出差异** —— 否则它可能什么都没测");
{
  // 这一节是被一次真实事故逼出来的：assembleGuessingMatch 曾把四个红区候选**写死**在函数体里，
  // 于是 8 个组合跑出一模一样的胜率，看起来像「结论对候选不敏感」，其实传入的候选被静默忽略。
  // 当时的断言全是结构性的（组合数、verdict 逻辑），**没有一条能发现『什么都没测』**。
  const r = result!;
  const rates = r.cells.map(c => c.winRateRed);
  ok("★★ 8 个组合并非全部相同（扫描确实在测东西）", new Set(rates).size > 1, JSON.stringify(rates.map(x => x === null ? null : +(x * 100).toFixed(1))));
  const rand = r.cells.filter(c => c.combo["并列先后"] === "同速随机").map(c => c.winRateRed);
  const reg = r.cells.filter(c => c.combo["并列先后"] !== "同速随机").map(c => c.winRateRed);
  ok("★ 差异出现在**应有差异**的那根轴上（并列先后：同速随机 vs 注册序）",
    new Set(rand).size === 1 && new Set(reg).size === 1 && rand[0] !== reg[0],
    JSON.stringify({ rand, reg }));
}

sec("[8] ★★ 逐轴接线证明：每个轴的候选必须真的传进 Battle");
{
  // 只断言「结果不同」还不够 —— 有些轴在本局**本来就不该有影响**（本局无先机、无免死），
  // 结果相同是正确行为。所以改为直接检查：工厂收到的 policies 里确实带着该轴的候选。
  const seen: any[] = [];
  const spy = async (seed: number, policies: any) => { seen.push(policies); return makeBattle(seed, policies); };
  await sweepPolicies(spy, base, axes, 8, { seedBase: 12345 });
  ok("★ 工厂被调用（每组合 N 次）", seen.length === 8 * 8, String(seen.length));
  const startupIds = new Set(seen.map(p => p.startup?.id));
  const deathIds = new Set(seen.map(p => p.death?.id));
  const tieIds = new Set(seen.map(p => p.tieBreak));
  ok("★★ 开局轴的两个候选都真的到达了 Battle", startupIds.size === 2, JSON.stringify([...startupIds]));
  ok("★★ 击杀时点轴的两个候选都真的到达了 Battle", deathIds.size === 2, JSON.stringify([...deathIds]));
  ok("★★ 并列先后轴的两个候选都真的到达了 Battle", tieIds.size === 2, JSON.stringify([...tieIds]));
  ok("未扫的字段原样保留（resource / guessing 不被误改）",
    seen.every(p => p.resource?.id === base.resource.id && p.guessing?.id === base.guessing.id),
    JSON.stringify(seen[0] && { resource: seen[0].resource?.id, guessing: seen[0].guessing?.id }));
  // ★ 另锁一条装配层的行为：即使调用方只给**部分** policies，assembleGuessingMatch 也要把其余补成默认。
  //   扫描器本身不做补全（它按调用方给的来），补全责任在装配层 —— 两处分工要写清楚。
  const partial = await assembleGuessingMatch(fx, { seed: 999, maxTurns: 60, policies: { tieBreak: "UNRESOLVED" } as any });
  ok("★ 只覆盖 tieBreak 时，其余策略被装配层补成默认（不是 undefined）",
    (partial.battle as any).policies.tieBreak === "UNRESOLVED" &&
    (partial.battle as any).policies.resource?.id === base.resource.id &&
    (partial.battle as any).policies.guessing?.id === base.guessing.id,
    JSON.stringify({ tie: (partial.battle as any).policies.tieBreak, res: (partial.battle as any).policies.resource?.id }));
}
console.log("\n=== 策略敏感性: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
