// runner/duiyi-demo.ts — 对弈竞猜端到端胜率 demo
// 关键设计：**不只给一个数字，而是给「策略不确定性带宽」** ——
// 同一对阵容在候选 UNKNOWN 策略下胜率会漂移多少，直接告诉你"这个结论有多可信"。
import fs from "node:fs/promises";
import path from "node:path";
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets, policySnapshot, hasUnknownPolicy } from "../kernel/policies.ts";
import { loadCharacter, selectSkillByAI } from "../compile/load.ts";
import { monteCarlo, formatResult } from "./monte-carlo.ts";

const R = ResourcePolicies.COMMUNITY_4_8_5_345;
const cache = new Map<number, any>();
async function lc(id: number, team: number, ent: number) {
  if (!cache.has(id)) cache.set(id, await loadCharacter(id, 0, 0));
  const base = cache.get(id);
  const { Entity } = await import("../kernel/entity.ts");
  const e = new Entity(ent, base.entity.name, team, { ...base.entity.base });
  e.skills = base.entity.skills; e.notes = base.entity.notes;
  return e;
}

async function makeLineup(ids: number[], teamId: number, startEnt: number) {
  const t = new Team(teamId, teamId === 0 ? "RED" : "BLUE", R, 1);
  let i = startEnt;
  for (const id of ids) t.add(await lc(id, teamId, i++));
  return t;
}

function factory(redIds: number[], blueIds: number[], policies: any) {
  return async (seed: number) => {
    const t0 = await makeLineup(redIds, 0, 1);
    const t1 = await makeLineup(blueIds, 1, 101);
    const bt = new Battle([t0, t1], { seed, rules: { ...DEFAULT_RULES, maxTurns: 300 }, policies });
    bt.skillSelector = (b, a, e) => selectSkillByAI(b, a, e);
    return bt;
  };
}

const RED = [236];    // 管狐
const BLUE = [246];   // 赤舌
const MIRROR = true;  // 额外跑一组镜像对照（引擎自检）
const N = Number(process.argv[2] ?? 300);

const basePolicies = {
  resource: R,
  startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
  death: DeathPolicies.DEATH_AFTER_PREVENTION,
  priority: "REGISTRATION_ORDER",
  tieBreak: "SPEED_THEN_RANDOM",
  guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED,
};

const out: string[] = [];
out.push("# 对弈竞猜端到端胜率 Demo", "");
out.push("阵容：红方 " + RED.join("/") + " vs 蓝方 " + BLUE.join("/") + "（真实式神，数据来自灰机 wiki 2026 快照）");
out.push("");
out.push("> ⚠️ 本 demo 的唯一目的是**打通链路并量化不确定性**，不是给出可下注的胜率。");
out.push("> 四个红区中仍有 3 个是 UNKNOWN，见文末策略快照。");
out.push("");

const scenarios: Array<[string, any]> = [
  ["S0 镜像对照（同阵容打自己，期望≈50%）", { ...basePolicies }],
  ["S1 开局顺序 = 御魂→被动→先机", { ...basePolicies, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI }],
  ["S2 开局顺序 = 先机最先", { ...basePolicies, startup: StartupPolicies.SENKI_FIRST }],
  ["S3 击杀时点 = HP<=0 即 KILLED", { ...basePolicies, death: DeathPolicies.HP_ZERO_IS_KILLED }],
  ["S4 行动条并列 = 未定（按注册序）", { ...basePolicies, tieBreak: "UNRESOLVED" }],
];

const results: any[] = [];
for (const [label, pol] of scenarios) {
  const [ra, rb] = label.startsWith("S0") ? [RED, RED] : [RED, BLUE];
  const r = await monteCarlo(await factory(ra, rb, pol), N, { seedBase: 500000 });
  results.push({ label, r });
  out.push(formatResult(r, label));
  out.push("");
}

const reds = results.map(x => x.r.winRateRed).filter((x: any) => x !== null) as number[];
if (reds.length > 1) {
  const lo = Math.min(...reds), hi = Math.max(...reds);
  out.push("## 策略不确定性带宽", "");
  out.push("同一对阵容，仅因四个红区取不同候选假设，红方胜率在 **" + (lo * 100).toFixed(2) + "% ~ " + (hi * 100).toFixed(2) + "%** 之间漂移。");
  out.push("");
  out.push("带宽 " + ((hi - lo) * 100).toFixed(2) + " 个百分点 —— **这就是当前不做游戏内实测所能达到的精度上限**。");
  out.push("作为对照：N=" + N + " 时 Wilson 95% 区间宽度约 " + (((results[0].r.ci95Red?.[1] ?? 0) - (results[0].r.ci95Red?.[0] ?? 0)) * 100).toFixed(2) + " 个百分点。");
  out.push("");
  out.push(hi - lo > 0.1 ? "结论：**策略不确定性远大于统计误差**，必须先做红区实验再谈胜率。" : "结论：策略不确定性小于统计误差，可先扩大样本。");
}

out.push("");
out.push("## 策略快照（每次模拟都强制携带）", "");
out.push("```json");
out.push(JSON.stringify(policySnapshot(basePolicies), null, 1));
out.push("```");

// 回合上限敏感性（D 组未实测时唯一诚实的精度声明）
{
  const { turnLimitSensitivity } = await import("./monte-carlo.ts");
  const sens = await turnLimitSensitivity(async (seed, maxTurns) => {
    const bt = await (await factory(RED, BLUE, basePolicies))(seed);
    (bt as any).rules.maxTurns = maxTurns;
    return bt;
  }, [50, 150, 300, 800], Math.max(60, Math.floor(N / 2)));
  out.push("");
  out.push("## 回合上限敏感性（对应 D 组未实测的残局机制）", "");
  out.push("| maxTurns | 红方胜率 | 卡住 | 有效样本 |");
  out.push("|---:|---:|---:|---:|");
  for (const p of sens.points) out.push("| " + p.maxTurns + " | " + (p.winRateRed === null ? "N/A" : (p.winRateRed * 100).toFixed(2) + "%") + " | " + p.stalls + " | " + p.decisive + " |");
  out.push("");
  out.push("**" + sens.verdict + "**（漂移 " + (sens.spread * 100).toFixed(2) + " 个百分点）");
}

// 第二组：会卡住的 3v3 辅助阵容 —— 这才是残局机制真正影响的地方
{
  const { turnLimitSensitivity } = await import("./monte-carlo.ts");
  const R3 = [201, 212, 236], B3 = [246, 307, 347];
  const sens = await turnLimitSensitivity(async (seed, maxTurns) => {
    const bt = await (await factory(R3, B3, basePolicies))(seed);
    (bt as any).rules.maxTurns = maxTurns;
    return bt;
  }, [100, 300, 800, 2000], Math.max(40, Math.floor(N / 4)));
  out.push("");
  out.push("### 第二组：3v3 辅助阵容（" + R3.join("/") + " vs " + B3.join("/") + "）");
  out.push("");
  out.push("| maxTurns | 红方胜率 | 卡住 | 有效样本 |");
  out.push("|---:|---:|---:|---:|");
  for (const p of sens.points) out.push("| " + p.maxTurns + " | " + (p.winRateRed === null ? "N/A" : (p.winRateRed * 100).toFixed(2) + "%") + " | " + p.stalls + " | " + p.decisive + " |");
  out.push("");
  out.push("**" + sens.verdict + "**");
  out.push("");
  out.push("> 这就是**膀胱局**的量化：辅助型阵容在没有残局加速机制时会打不完，");
  out.push("> 而残局增伤/减疗曲线正是 D 组 12 个实验要测的东西。");
}

const outPath = path.resolve(import.meta.dirname, "..", "traces", "duiyi-demo.md");
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, out.join("\n"), "utf8");
console.log(out.join("\n"));
console.log("\n-> " + outPath);
