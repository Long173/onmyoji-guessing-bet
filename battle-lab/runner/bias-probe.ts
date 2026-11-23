import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { Entity } from "../kernel/entity.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { loadCharacter, selectSkillByAI } from "../compile/load.ts";
import { TieBreaks } from "../kernel/timeline.ts";
const R = ResourcePolicies.COMMUNITY_4_8_5_345;
const POL = { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI, death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER", tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED };
const b0 = await loadCharacter(236, 0, 1);
async function mk(seed: number, tb: any) {
  const e0 = new Entity(1, b0.entity.name, 0, { ...b0.entity.base }); e0.skills = b0.entity.skills;
  const e1 = new Entity(101, b0.entity.name, 1, { ...b0.entity.base }); e1.skills = b0.entity.skills;
  const t0 = new Team(0, "R", R, 1); t0.add(e0);
  const t1 = new Team(1, "B", R, 1); t1.add(e1);
  const bt = new Battle([t0, t1], { seed, rules: { ...DEFAULT_RULES, maxTurns: 300 }, policies: { ...POL, tieBreak: tb } });
  bt.skillSelector = (b, a, en) => selectSkillByAI(b, a, en);
  return bt;
}
for (const tb of ["SPEED_THEN_RANDOM", "UNRESOLVED"]) {
  let firstRed = 0, redWin = 0, blueWin = 0, stall = 0, firstRedAndWin = 0;
  for (let s = 0; s < 300; s++) {
    const bt = await mk(900000 + s, tb);
    await bt.runStartup();
    const first = bt.timeline.advance();
    if (first === 1) firstRed++;
    // 重新跑完整对局（advance 已消耗一次，改用 run 的结果统计）
    const bt2 = await mk(900000 + s, tb);
    const r = await bt2.run();
    if (r.reason === "TURN_LIMIT") stall++;
    else if (r.winner === 0) { redWin++; if (first === 1) firstRedAndWin++; }
    else if (r.winner === 1) blueWin++;
  }
  console.log(tb + ": 先手为红 " + firstRed + "/300 (" + (firstRed / 3).toFixed(1) + "%) | 红胜 " + redWin + " 蓝胜 " + blueWin + " 卡住 " + stall + " | 红先手且红胜 " + firstRedAndWin);
}
