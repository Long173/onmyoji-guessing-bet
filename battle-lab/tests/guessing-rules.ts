// tests/guessing-rules.ts — 已确证规则的强制校验
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { loadCharacter } from "../compile/load.ts";
import { RuleIndex, VERIFIED_RULES } from "../kernel/evidence.ts";
import { RuleViolation, validateGuessingLineups } from "../kernel/validate.ts";

const R = ResourcePolicies.COMMUNITY_4_8_5_345;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };

console.log("=== 对弈竞猜规则校验 ===");

const rule = RuleIndex.get("GUESSING_NO_ONMYOJI")!;
ok("规则已登记且来源为 USER_CONFIRMED", rule.source === "USER_CONFIRMED");
ok("规则关闭了此前的待核实项", (rule.supersedes ?? []).length >= 4, `supersedes=${rule.supersedes!.length} 条`);
ok("证据表可枚举", VERIFIED_RULES.length >= 1);

const mk = async (ids: number[], kind: "shikigami" | "onmyoji", guessing: any) => {
  const t0 = new Team(0, "RED", R, 1), t1 = new Team(1, "BLUE", R, 1);
  t0.add((await loadCharacter(ids[0], 0, 1)).entity);
  t1.add((await loadCharacter(ids[1], 1, 101)).entity);
  return new Battle([t0, t1], { seed: 1, rules: { ...DEFAULT_RULES, maxTurns: 50 },
    policies: { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
      death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER",
      tieBreak: "SPEED_THEN_RANDOM", guessing } });
};

// 纯式神 -> 允许
let okShiki = true;
try { await mk([236, 246], "shikigami", GuessingRulesets.COMMUNITY_2020_UNVERIFIED); } catch { okShiki = false; }
ok("纯式神阵容在对弈竞猜 ruleset 下可构造", okShiki);

// 含阴阳师 -> 拒绝
let thrown: any = null;
try { await mk([10, 246], "onmyoji", GuessingRulesets.COMMUNITY_2020_UNVERIFIED); } catch (e) { thrown = e; }
ok("含阴阳师的阵容被拒绝", thrown instanceof RuleViolation, thrown ? String(thrown.message).split("\n")[0] : "未抛出");
ok("拒绝信息指明规则与出处", !!thrown && String(thrown.message).includes("GUESSING_NO_ONMYOJI") && String(thrown.message).includes("出处"));

// 显式研究 ruleset -> 放行
let okResearch = true;
try { await mk([10, 246], "onmyoji", GuessingRulesets.RESEARCH_WITH_ONMYOJI); } catch { okResearch = false; }
ok("显式研究 ruleset 下可构造（允许阴阳师）", okResearch);

// validate 可单独调用且不抛
const t0 = new Team(0, "R", R, 1);
t0.add((await loadCharacter(10, 0, 7)).entity);
const probs = validateGuessingLineups([t0], { enforce: false });
ok("非强制模式返回问题清单而不抛", probs.length === 1, probs[0]?.slice(0, 46));

console.log(`\n=== 规则校验: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
