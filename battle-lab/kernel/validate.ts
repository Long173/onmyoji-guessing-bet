// kernel/validate.ts — 运行期规则校验：违反已确证规则的阵容直接拒绝，不静默跑
import { guessingHasOnmyoji, RuleIndex } from "./evidence.ts";
import type { Team } from "./team.ts";

export class RuleViolation extends Error {
  ruleId: string;
  constructor(ruleId: string, message: string) { super(message); this.name = "RuleViolation"; this.ruleId = ruleId; }
}

/**
 * 按已确证规则校验对局配置。
 * 目前只有一条：对弈竞猜不含阴阳师。
 */
export function validateGuessingLineups(teams: Team[], opts: { enforce?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (guessingHasOnmyoji()) return problems;
  for (const t of teams) {
    for (const e of t.members) {
      if (e.type === "ONMYOJI") {
        problems.push(`队伍 ${t.name} 含阴阳师「${e.name}」，但规则 ${"GUESSING_NO_ONMYOJI"} 规定对弈竞猜不含阴阳师`);
      }
    }
  }
  if (problems.length && opts.enforce !== false) {
    const rule = RuleIndex.get("GUESSING_NO_ONMYOJI")!;
    throw new RuleViolation("GUESSING_NO_ONMYOJI",
      "违反已确证规则（来源 " + rule.source + "）：\n  " + problems.join("\n  ") +
      "\n  出处：" + rule.origin);
  }
  return problems;
}
