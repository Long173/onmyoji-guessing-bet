// runner/balance-probe.ts — ①镜像对局自检（同阵容打自己应≈50%）②找平衡对局
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { Entity } from "../kernel/entity.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { loadCharacter, selectSkillByAI } from "../compile/load.ts";
import { monteCarlo, formatResult } from "./monte-carlo.ts";

const R = ResourcePolicies.COMMUNITY_4_8_5_345;
const POL = { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
  death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER",
  tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED };

const cache = new Map<number, any>();
async function clone(id: number, team: number, ent: number) {
  if (!cache.has(id)) cache.set(id, await loadCharacter(id, 0, 1));
  const b = cache.get(id);
  const e = new Entity(ent, b.entity.name, team, { ...b.entity.base });
  e.skills = b.entity.skills; e.notes = b.entity.notes;
  return e;
}
async function team(ids: number[], t: number, start: number) {
  const tm = new Team(t, t === 0 ? "RED" : "BLUE", R, 1);
  let i = start; for (const id of ids) tm.add(await clone(id, t, i++));
  return tm;
}
function fac(red: number[], blue: number[]) {
  return async (seed: number) => {
    const bt = new Battle([await team(red, 0, 1), await team(blue, 1, 101)], { seed, rules: { ...DEFAULT_RULES, maxTurns: 300 }, policies: POL });
    bt.skillSelector = (b, a, e) => selectSkillByAI(b, a, e);
    return bt;
  };
}

console.log("=== ① 镜像对局自检（同阵容 vs 自己，期望≈50%）===");
for (const ids of [[236], [201], [246], [347]]) {
  const r = await monteCarlo(fac(ids, ids), 100, { seedBase: 700000 });
  console.log("  " + ids.join("/") + " 红胜 " + r.winsRed + " 蓝胜 " + r.winsBlue + " 卡住 " + r.stalls +
    " -> 红 " + (r.winRateRed === null ? "N/A" : (r.winRateRed * 100).toFixed(1) + "%"));
}

console.log("\n=== ② 平衡对局搜索（N=40 快速筛）===");
const pool = [236, 201, 212, 246, 307, 347, 385, 390, 396, 555, 570, 571];
const pairs: Array<{ red: number[]; blue: number[]; wr: number }> = [];
for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
  const r = await monteCarlo(fac([pool[i]], [pool[j]]), 40, { seedBase: 800000 });
  if (r.winRateRed !== null) pairs.push({ red: [pool[i]], blue: [pool[j]], wr: r.winRateRed });
}
pairs.sort((a, b) => Math.abs(a.wr - 0.5) - Math.abs(b.wr - 0.5));
console.log("最接近 50% 的 6 对：");
for (const p of pairs.slice(0, 6)) console.log("  " + p.red + " vs " + p.blue + " -> 红 " + (p.wr * 100).toFixed(1) + "%");
