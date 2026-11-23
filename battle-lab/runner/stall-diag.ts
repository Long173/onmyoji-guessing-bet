import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { loadCharacter, selectSkillByAI } from "../compile/load.ts";
const R = ResourcePolicies.COMMUNITY_4_8_5_345;
const POL = { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI, death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER", tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED };
for (const [a, b] of [[201, 390], [212, 570]]) {
  const la = await loadCharacter(a, 0, 1), lb = await loadCharacter(b, 1, 101);
  console.log("=== " + la.entity.name + " vs " + lb.entity.name + " ===");
  for (const lc of [la, lb]) {
    console.log("  " + lc.entity.name + " AI=" + lc.ai.confidence + " 规则:" + lc.ai.skillRules.map((r:any)=>r.skill.label+"<-"+(r.condRaw||"无条件")).join(" | "));
    for (const s of lc.ir) console.log("     ["+s.name+"] cost="+s.cost+" dmg="+JSON.stringify(s.damage.map((x:any)=>x.ratio+"%"+x.type))+" hits="+s.hits+" heal="+s.heal.length+" shield="+s.shield.length+" conf="+s.confidence);
  }
  const t0 = new Team(0,"R",R,1), t1 = new Team(1,"B",R,1); t0.add(la.entity); t1.add(lb.entity);
  const bt = new Battle([t0,t1], { seed: 1, rules: {...DEFAULT_RULES, maxTurns: 400}, policies: POL });
  bt.skillSelector = (x,y,z) => selectSkillByAI(x,y,z);
  await bt.run();
  const used: Record<string, number> = {};
  for (const rec of bt.turnLog) used[rec.skill ?? "(none)"] = (used[rec.skill ?? "(none)"] ?? 0) + 1;
  console.log("  回合 " + bt.turn + " | 技能使用: " + JSON.stringify(used) + " | 伤害事件 " + bt.trace.filter((x:any)=>x.t==="DAMAGE").length + " | 剩余HP " + la.entity.hp.toFixed(0) + "/" + lb.entity.hp.toFixed(0));
}
