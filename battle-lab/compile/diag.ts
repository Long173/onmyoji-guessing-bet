import { loadCharacter, selectSkillByAI } from "../compile/load.ts";
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { Team } from "../kernel/team.ts";
const R = ResourcePolicies.COMMUNITY_4_8_5_345;
const lc = await loadCharacter(236, 0, 1);
for (const s of lc.ir) {
  console.log(`[${s.name}] cost=${s.cost} conf=${s.confidence} hits=${s.hits} dmg=${JSON.stringify(s.damage.map(d=>d.ratio+"%"+d.type))} heal=${s.heal.length} shield=${s.shield.length} buffs=${s.statusRefs.length} tl=${s.timeline.length}`);
  console.log("   desc:", s.sentences.map(x=>x.kind[0]+":"+x.text.slice(0,34)).join(" | ").slice(0, 220));
}
console.log("\nAI:", JSON.stringify(lc.ai.skillRules.map(r=>({cond:r.condRaw, skill:r.skill.label, idx:r.skill.index, ok:!!r.cond})), null, 1));
const t0 = new Team(0,"R",R,1), t1 = new Team(1,"B",R,1); t0.add(lc.entity);
const lc2 = await loadCharacter(246, 1, 2); t1.add(lc2.entity);
const bt = new Battle([t0,t1], { seed: 1, rules: {...DEFAULT_RULES, maxTurns: 60} });
bt.skillSelector = (b,a,e) => selectSkillByAI(b,a,e);
await bt.run();
const noDmg = bt.turnLog.filter(r => !r.skill).length;
console.log("\n回合数:", bt.turn, " 无技能记录回合:", noDmg, " 伤害事件:", bt.trace.filter((x:any)=>x.t==="DAMAGE").length);
console.log("前 12 回合:", JSON.stringify(bt.turnLog.slice(0,12)));
console.log("双方剩余 HP:", t0.members.map(m=>m.hp+"/"+m.maxHp), t1.members.map(m=>m.hp+"/"+m.maxHp));
