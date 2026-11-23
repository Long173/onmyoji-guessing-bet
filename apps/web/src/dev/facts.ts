// dev/facts.ts — 开发者事实清单（Developer HUD 用）
// 这里只放**已经在本工程里被验证过、并且能指出证据来源**的事实。
// 三条纪律：
//   1) 每条必须能指向一个证据文件或一次已记录的实测；指不出来就不要写进来；
//   2) 否定结果按否定结果写（"未检出"≠"修好了一个 bug"）；
//   3) 数值是实测值，改动前先重跑对应测试，别凭印象改数字。
export type FactSeverity = "INFO" | "WARN" | "BLOCK";

export interface DevFact {
  id: string;
  title: string;
  detail: string;
  /** 证据：文件路径 / 测试 / 报告章节。UI 直接展示，不缩写。 */
  evidence: string;
  severity: FactSeverity;
}

export const SEVERITY_ORDER: FactSeverity[] = ["BLOCK", "WARN", "INFO"];

export const FACTS: readonly DevFact[] = [
  {
    id: "F01",
    title: "Skill parsing is independent of call order (a shared /g regex lastIndex bug, now fixed)",
    detail:
      "The /g regexes in compile/skill-compiler.ts are **module-level shared objects**: a successful RegExp.test() advances lastIndex, " +
      "and String.matchAll() **inherits** lastIndex when it clones the regex. When the two collide, \"which unit is compiled first\" changes the parse result — " +
      "Zashiki \"Soul Fire\" (100% ATK damage) compiled correctly on its own, but became 0 damage after batch-compiling 40 shikigami first. " +
      "Fix: reset lastIndex before and after every use; all 818 skills now parse identically in forward / reverse / a third order.",
    evidence: "battle-lab/tests/parse-determinism.ts (all 818 skills compared across three orders); 09-M1.8-*.md (prediction workbench spec) §4.1",
    severity: "INFO",
  },
  {
    id: "F02",
    title: "AI cast rules missing trigger conditions: 141 / 421 (33.5%) have an empty cond",
    detail:
      "data/kb/ai.json has 421 cast rules, 141 of which have an empty cond (141 shikigami affected). The engine **does not guess conditions**: " +
      "it treats them as \"cast every turn\" and names them in the validation report; skills costing 0 Onibi are not limited by Onibi and get cast over and over — " +
      "Omoikane (id 601) \"Eternal Flame of Wisdom\" is one example: its only cast rule has an empty cond, so it never uses its basic attack and averages 0 damage.",
    evidence: "data/kb/ai.json (measured: 421 cast rules / 141 empty cond); the unconditional warning branch in apps/web/src/adapters/engine-adapter.ts; 09-M1.8-*.md (prediction workbench spec) §4.2",
    severity: "WARN",
  },
  {
    id: "F03",
    title: "The engine has no crit event: the \"on Crit\" effects of Seductress / Jizo Statue never trigger",
    detail:
      "The EV table in kernel/types.ts has **no CRI / CRIT**, and nothing in the codebase emits \"CRI\"; " +
      "yet soul/effect-system.ts maps ON_CRIT (on Crit) to EV.CRI ?? \"CRI\" — an event code that does not exist. " +
      "So the 4-piece battle effects of these two Souls (Seductress / Jizo Statue) never trigger. They have been honestly downgraded to UNSUPPORTED with the real reason " +
      "(they were already PARTIAL in coverage, so the numbers did not change; what changed is that users can now see why).",
    evidence: "battle-lab/soul/effect-system.ts:23 and :55-62; the EV table in battle-lab/kernel/types.ts",
    severity: "WARN",
  },
  {
    id: "F04",
    title: "7 shikigami are missing base ATK / HP / DEF (gaps in source Attribute.json)",
    detail:
      "panel.atk is null for 433 / 552 / 558 / 571 / 587 / 588 / 593. Panel prefill **leaves them blank instead of 0** — " +
      "0 would make \"missing in source data\" indistinguishable from \"measured as 0\". panelPrefill in kb/useKb.ts only writes non-null values.",
    evidence: "apps/web/src/kb/shikigami-detail.json (exactly these 7 have atk = null); apps/web/tests/ui1-editor.ts §5; apps/web/src/kb/useKb.ts panelPrefill",
    severity: "WARN",
  },
  {
    id: "F05",
    title: "Mechanic experiments 44 / 44 not run: confidence all NOT_RUN, VERIFIED = 0",
    detail:
      "In battle-lab/experiments/results/_all.json all 44 experiments have confidence NOT_RUN, chosenHypothesis null and " +
      "status AWAITING_IN_GAME_OBSERVATION; rules in verified-rules.json is empty. " +
      "So the mechanics lab shows VERIFIED = 0, and \"Hypothesis comparison\" honestly shows \"no experiment pairs with opposite conclusions\". " +
      "★ Observations logged in the UI **do not** change this number: status changes require manual review and an edit to verified-rules.json.",
    evidence: "apps/web/src/kb/experiments.json (deduplicated confidence / chosenHypothesis / verdictLevel); apps/web/tests/ui5-knowledge.ts §2; 09-M1.8-*.md (prediction workbench spec) §7.7",
    severity: "WARN",
  },
  {
    id: "F06",
    title: "Correlation between sequential seeds **not detected** (a negative result, not a fixed bug)",
    detail:
      "Chi-square test of block win rates over 40 blocks × 250 battles = 10,000 battles: sequential seeds (seedBase+i) χ² = 49.7 (df = 39), " +
      "avalanche hash χ² = 47.3; both fall inside the 95% interval for i.i.d. data (upper bound ≈ 56). " +
      "The \"abnormal fluctuation\" seen earlier was the uncertainty of the SD estimate itself with 10 blocks (≈ 24%). " +
      "Conclusion: keeping the hash is a defensive margin, not a fix — do not describe it as \"fixed a bug\".",
    evidence: "09-M1.8-*.md (prediction workbench spec) §4.3 (sequential vs hash comparison table); seedBase+i in battle-lab/runner/monte-carlo.ts and mixSeed in the adapter",
    severity: "INFO",
  },
  {
    id: "F07",
    title: "The engine does not record Onibi spent: avgOrbSpent* is always 0, and this is declared in coverage",
    detail:
      "The result contract has avgOrbSpentRed / avgOrbSpentBlue, but the engine has no such counter, so the adapter always fills 0 " +
      "and states it in coverage.unsupportedCapabilities. " +
      "Do not read 0 as \"no Onibi was spent in this battle\".",
    evidence: "apps/web/src/adapters/engine-adapter.ts:23 (UNSUPPORTED_METRICS) and :332 (constant 0); apps/web/src/contracts/simulation-result.ts:21-22",
    severity: "INFO",
  },
  {
    id: "F08",
    title: "Performance baseline: ~1.6 ms per battle (642 battles/s), 10,000 battles ≈ 16 s",
    detail:
      "Node 24 / measured locally: 10,000 battles take 15.6–16.6 s, so the UI default of 10k battles takes over ten seconds; progress is reported every N/20 battles. " +
      "tests/ui2-engine.ts only asserts a loose lower bound of \"≥ 20 battles/s\"; the real baseline is the measured table — do not treat it as an upper bound.",
    evidence: "09-M1.8-*.md (prediction workbench spec) §6 measurement table; the throughput assertion in apps/web/tests/ui2-engine.ts",
    severity: "INFO",
  },
  {
    id: "F09",
    title: "Betting scope: Soul static stats are not counted (the panel is the final screenshot value); only 4-piece battle effects apply",
    detail:
      "The panel is already the final value from the screenshot; adding Soul static stats again would double-count. GuessingUnitInput in the contract has no soulPieces field at all " +
      "(not expressible by structure), the engine throws at runtime in assertNoStaticDoubleCount, and the UI Soul selector only lists battle effects and states \"static stats are not counted\". " +
      "So questions like \"is damage low because Souls were not counted?\" do not apply to this tool.",
    evidence: "apps/web/src/contracts/guessing-match.ts (no soulPieces); assertNoStaticDoubleCount in battle-lab; apps/web/tests/ui1-editor.ts §4",
    severity: "INFO",
  },
  {
    id: "F10",
    title: "Data size: source data 282 shikigami / 818 skills / 272 AI / 338 buffs; web betting index 276 shikigami / 798 skills",
    detail:
      "Source data data/kb: 282 units (incl. 4 Onmyoji + 2 heroes, excluded from betting), 818 skills, 272 with AI profiles, 338 buffs, 70 Souls. " +
      "The web app only loads the betting-pool index: 276 units, 798 skills, has.ai 272, Souls 70, glossary 156, pinyin coverage 276 / 276. " +
      "The two skill counts differ by scope, not by bug — the 20-skill difference is exactly the skills of those 6 Onmyoji / heroes. " +
      "The bundle.json data pack is 621 KB; the raw KB is ~1280 KB (the trimmed slice is only loaded in the Worker).",
    evidence: "data/kb/shikigami.full.json (282 / 818), data/kb/ai.json (272 units / 421 rules), data/kb/buffs.json (338), measured from apps/web/src/kb/*.json and apps/web/src/engine/bundle.json",
    severity: "INFO",
  },
  {
    id: "F11",
    title: "The experiment index self-check produced 14 anomalies: \"discriminating\" experiments are not actually discriminating",
    detail:
      "A09 / B04 / B06 claim discriminating = true, but the observable of every candidate hypothesis is identical apart from the note text " +
      "(for B04 and B06 the observable is simply empty); the 12 group-C and 12 group-D experiments each share one set of candidate hypotheses. " +
      "The generator records them as anomalies and shows them on the page as-is, without inventing discriminating power for them.",
    evidence: "anomalies in apps/web/src/kb/experiments.json (14 entries); apps/web/tools/build-experiments-index.mjs",
    severity: "WARN",
  },
  {
    id: "F12",
    title: "Passive skills are not modelled (cost < 0), strictly separated from \"nothing parsed from an active skill\"",
    detail:
      "Skills with cost < 0 (e.g. Mio \"Allure\" 50% lifesteal, Kyonshi Ototo \"Expel\" ATK up when hit) have no trigger-condition model; " +
      "the report files them as \"passive skill, trigger condition not modelled by the engine\" (INFO), while an active skill with no parsed values at all is WARN. " +
      "The two kinds of gap are kept apart so \"not modelled\" and \"parse failed\" are never merged into one number.",
    evidence: "the passive / gap branches in apps/web/src/adapters/engine-adapter.ts; 09-M1.8-*.md (prediction workbench spec) §7.3",
    severity: "WARN",
  },
  {
    id: "F13",
    title: "Capability coverage: 48 capabilities, FULL 20 / PARTIAL 16 / NONE 12 (kernel 58.3% · hard 41.7%)",
    detail:
      "capability/coverage.json enters kb/experiments.json via the generator. The 12 unimplemented capabilities (GUARD / LIFESTEAL / SWITCH / ORB_SAVE / " +
      "SHIELD_PIERCE / REFLECT / DODGE / ISOLATE / STEALTH / PROTECTION / LINK / RESTORE) are listed one by one in the mechanics lab. " +
      "★ coverage in the result contract is scoped to **the 10 units in this battle** (unitsJoined / 10 etc.), not whole-KB coverage; do not mix the two.",
    evidence: "coverage / coverageSummary in apps/web/src/kb/experiments.json; coverageOf() in apps/web/src/adapters/engine-adapter.ts; battle-lab/capability/coverage.json",
    severity: "INFO",
  },
  {
    id: "F14",
    title: "Betting endgame rules are still UNKNOWN → no win rate is a mechanic conclusion",
    detail:
      "Turn limit, endgame damage-up / healing-down curves and the timeout winner rule have no credible 2026 source (COMMUNITY_2020_UNVERIFIED, status UNKNOWN). " +
      "Sensitivity measured: with the turn limit at 600 → 100, the red win rate of typical match #001 goes 67.0% → 47.6% (a 19.4-point shift), verdict SENSITIVE. " +
      "isConclusionReady returns \"no conclusion possible\" because unknownCount > 0: the numbers can be used to compare lineups, not as mechanic conclusions.",
    evidence: "redZones in apps/web/src/kb/experiments.json (group D UNKNOWN / COMMUNITY_2020_UNVERIFIED); isConclusionReady in apps/web/src/contracts/simulation-result.ts; 09-M1.8-*.md (prediction workbench spec) §5",
    severity: "BLOCK",
  },
];

/** 按 severity 计数（HUD 顶部徽标用；不写死条数） */
export function countBySeverity(): Record<FactSeverity, number> {
  const out: Record<FactSeverity, number> = { INFO: 0, WARN: 0, BLOCK: 0 };
  for (const f of FACTS) out[f.severity]++;
  return out;
}
