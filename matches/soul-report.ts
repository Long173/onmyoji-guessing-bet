// matches/soul-report.ts — in báo cáo ngự hồn nào được engine thực thi cho một file đội hình.
// Dùng: node matches/soul-report.ts file=matches/2026-11-23-lineup.json
import path from "node:path";
import { setSkillLevelMode } from "../battle-lab/compile/max-level.ts";
import { assembleGuessingMatch, loadMatchFixture } from "../battle-lab/soul/guessing-match.ts";

// Betting mode uses max skill levels.
setSkillLevelMode("MAX");
const args = Object.fromEntries(process.argv.slice(2).map(a => a.split("=") as [string, string]));
const fx: any = await loadMatchFixture(path.resolve(args.file));
const A: any = await assembleGuessingMatch(fx, { seed: 1 });
console.log(JSON.stringify(A.battle.soulReport, null, 1).slice(0, 4000));
