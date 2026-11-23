// runner/stall-survey.ts — 全量卡住率普查（修正 M1 报告中"膀胱局"的归因）
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { Entity } from "../kernel/entity.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { loadCharacter, selectSkillByAI } from "../compile/load.ts";
const R = ResourcePolicies.COMMUNITY_4_8_5_345;
const POL = { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI, death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER", tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED };
const cache = new Map<number, any>();
async function clone(id: number, team: number, ent: number) {
  if (!cache.has(id)) cache.set(id, await loadCharacter(id, 0, 1));
  const b = cache.get(id);
  const e = new Entity(ent, b.entity.name, team, { ...b.entity.base });
  e.skills = b.entity.skills; return e;
}
async function tm(ids: number[], t: number, s: number) {
  const x = new Team(t, t === 0 ? "RED" : "BLUE", R, 1);
  let i = s; for (const id of ids) x.add(await clone(id, t, i++));
  return x;
}
async function run(red: number[], blue: number[], n: number, maxTurns = 500) {
  let stall = 0, r0 = 0, r1 = 0;
  for (let s = 0; s < n; s++) {
    const bt = new Battle([await tm(red, 0, 1), await tm(blue, 1, 101)], { seed: 400000 + s, rules: { ...DEFAULT_RULES, maxTurns }, policies: POL });
    bt.skillSelector = (b, a, e) => selectSkillByAI(b, a, e);
    const res = await bt.run();
    if (res.reason === "TURN_LIMIT") stall++; else if (res.winner === 0) r0++; else if (res.winner === 1) r1++;
  }
  return { stall, r0, r1, winRate: r0 + r1 ? r0 / (r0 + r1) : null };
}
const pool = [236, 201, 212, 246, 307, 347, 385, 390, 396, 555, 570, 571];
console.log("=== 1v1 全组合卡住率普查（每对 20 局，maxTurns=500）===");
let totalStall = 0, total = 0, worst: any[] = [];
for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
  const r = await run([pool[i]], [pool[j]], 20);
  totalStall += r.stall; total += 20;
  if (r.stall > 0) worst.push({ pair: pool[i] + "v" + pool[j], ...r });
}
console.log("总卡住率: " + totalStall + "/" + total + " = " + ((totalStall / total) * 100).toFixed(1) + "%");
if (worst.length) { console.log("有卡住的组合:"); for (const w of worst.sort((a,b)=>b.stall-a.stall).slice(0,8)) console.log("  " + w.pair + " 卡住 " + w.stall + "/20 红胜率 " + (w.winRate===null?"N/A":(w.winRate*100).toFixed(1)+"%")); }
else console.log("  无任何组合卡住");
console.log("\n=== 3v3 辅助阵容（原先 100% 卡住的那组）===");
const r3 = await run([201, 212, 236], [246, 307, 347], 30, 500);
console.log("  卡住 " + r3.stall + "/30  红胜 " + r3.r0 + " 蓝胜 " + r3.r1 + " 红胜率 " + (r3.winRate===null?"N/A":(r3.winRate*100).toFixed(1)+"%"));
