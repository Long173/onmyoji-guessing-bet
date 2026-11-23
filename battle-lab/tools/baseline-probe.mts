// tools/baseline-probe.mts — 基线胜率测量（任何机制改动后必须重新量，旧数字一律作废）
import path from "node:path";
import { assembleGuessingMatch, loadMatchFixture } from "../soul/guessing-match.ts";
import { monteCarlo, formatResult } from "../runner/monte-carlo.ts";
const FIX = path.resolve(import.meta.dirname, "..", "fixtures", "guessing-match-canonical-001.json");
const N = Number(process.argv[2] ?? 2000);
const fx = await loadMatchFixture(FIX);
const t0 = Date.now();
const mc = await monteCarlo(async (seed: number) => (await assembleGuessingMatch(fx, { seed, maxTurns: 300 })).battle, N, { seedBase: 20261001 });
console.log(formatResult(mc, "典型对局 #001（N=" + N + "）"));
console.log("耗时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
