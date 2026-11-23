// runner/policy-sweep-cli.ts — 对某一组对阵跑策略敏感性扫描
//
// 用法：node runner/policy-sweep-cli.ts [N=120] [seed=20261001] [fixture=fixtures/guessing-match-canonical-001.json]
//
// 它回答的是使用者真正关心的问题：**换成别的合理候选，"押哪边"会不会变。**
// 机制本身是什么仍然是红区（只能靠游戏内观测），但"结论稳不稳"是可以算的。
import path from "node:path";
import { assembleGuessingMatch, loadMatchFixture } from "../soul/guessing-match.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { sweepPolicies, formatSweep } from "./policy-sweep.ts";
import type { SweepAxis } from "./policy-sweep.ts";

const args = Object.fromEntries(process.argv.slice(2).map(a => a.split("=") as [string, string]));
const N = Number(args.N ?? 120);
const seedBase = Number(args.seed ?? 20261001);
const ROOT = path.resolve(import.meta.dirname, "..");
const fixPath = path.resolve(args.fixture ?? path.join(ROOT, "fixtures", "guessing-match-canonical-001.json"));

const base = {
  resource: ResourcePolicies.COMMUNITY_4_8_5_345,
  startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
  death: DeathPolicies.DEATH_AFTER_PREVENTION,
  priority: "REGISTRATION_ORDER",
  tieBreak: "SPEED_THEN_RANDOM",
  guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED,
};

// 轴：只列**说得通**的候选；已知有偏的候选计入参照、不参与判定（见 policy-sweep.ts 的两条纪律）
const axes: SweepAxis[] = [
  { name: "开局顺序", variants: [
    { id: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI.id, status: "HYPOTHESIS", plausible: true,
      apply: (p: any) => ({ ...p, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI }) },
    { id: StartupPolicies.SENKI_FIRST.id, status: "HYPOTHESIS", plausible: true,
      apply: (p: any) => ({ ...p, startup: StartupPolicies.SENKI_FIRST }) },
  ] },
  { name: "击杀时点", variants: [
    { id: DeathPolicies.HP_ZERO_IS_KILLED.id, status: "HYPOTHESIS", plausible: true,
      apply: (p: any) => ({ ...p, death: DeathPolicies.HP_ZERO_IS_KILLED }) },
    { id: DeathPolicies.DEATH_AFTER_PREVENTION.id, status: "HYPOTHESIS", plausible: true,
      apply: (p: any) => ({ ...p, death: DeathPolicies.DEATH_AFTER_PREVENTION }) },
  ] },
  { name: "并列先后", variants: [
    { id: "SPEED_THEN_RANDOM", status: "HYPOTHESIS", plausible: true, note: "同速均匀随机",
      apply: (p: any) => ({ ...p, tieBreak: "SPEED_THEN_RANDOM" }) },
    { id: "REGISTRATION_ORDER", status: "UNKNOWN", plausible: false, note: "已知会造成红方结构性优势，仅作参照",
      apply: (p: any) => ({ ...p, tieBreak: "UNRESOLVED" }) },
  ] },
];

const fx: any = await loadMatchFixture(fixPath);
console.log("对阵：" + path.basename(fixPath) + "｜N=" + N + "｜seedBase=" + seedBase);
console.log("（每格都是独立的一次 Monte Carlo；仅参照的候选用 · 标出，不参与结论）");
console.log("");
const r = await sweepPolicies(
  async (seed, policies) => (await assembleGuessingMatch(fx, { seed, maxTurns: 300, policies })).battle,
  base, axes, N, { seedBase },
);
console.log(formatSweep(r));
console.log("");
console.log("这对使用者意味着什么：");
if (r.verdict === "FLIPS") console.log("  → 不要下注。换一条尚未确定的规则就能翻转胜负，此时任何下注都是在赌那条规则。");
else if (r.verdict === "INCONCLUSIVE") console.log("  → 没有可判定的候选，先补充候选再谈稳健性。");
else console.log("  → 可以按结论方向考虑，但请记住：稳健 ≠ 正确。它只说明这个判断不取决于已列出的那几个候选。");
