// adapters/mock-adapter.ts — UI-0 用：生成形状正确、数值可信的假结果
// 目的：让 UI 完全不依赖 Kernel 就能开发与验收（UI-0 的验收标准）
import type { SimulateAdapter } from "./simulate.ts";
import { ENGINE_VERSION, GAME_DATA_VERSION } from "./simulate.ts";
import type { GuessingMatch } from "../contracts/guessing-match.ts";
import type { SimulationOptions, SimulationResult, SimulationWarning, StrategySnapshot, CoverageSnapshot, PerUnitStats, ModelUncertainty, RepresentativeSeed } from "../contracts/simulation-result.ts";
import type { ValidationReport, ReplayEvent, ReplayUnit } from "../contracts/worker-api.ts";

/** 可复现伪随机（与引擎同为 mulberry32 思路，便于测试） */
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function wilson(k: number, n: number, z = 1.96): { low: number; high: number } {
  if (!n) return { low: 0, high: 0 };
  const p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: (c - s) / d, high: (c + s) / d };
}

const STRATEGY: StrategySnapshot = {
  startup: { id: "NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI", status: "HYPOTHESIS" },
  triggerPriority: { id: "REGISTRATION_ORDER", status: "HYPOTHESIS" },
  death: { id: "DEATH_AFTER_PREVENTION", status: "HYPOTHESIS" },
  endgame: { id: "COMMUNITY_2020_UNVERIFIED", status: "UNKNOWN" },
  resource: { id: "COMMUNITY_4_8_5_345", status: "HYPOTHESIS" },
  unknownCount: 3,
};

function coverageOf(m: GuessingMatch): CoverageSnapshot {
  const units = [...m.red.units, ...m.blue.units].filter(u => u.shikigamiId > 0);
  return {
    unitsJoined: units.length, unitsTotal: 10,
    skillsAvailable: units.length * 3, skillsTotal: units.length * 3,
    aiHigh: 7, aiTotal: units.length,
    // ★ 原先是 `filter(u => u.soulId)` —— 0 是**合法的御魂 id**（雪幽魂），被当成「没填」漏掉。
    //   这个桩没有引擎知识库，只能报「填了几个」；真值由 engine-adapter 按知识库解析（见那里的注释）。
    soulsResolved: units.filter(u => u.soulId != null).length, soulsTotal: units.length,
    soulEffectsFull: 0, soulEffectsPartial: 0,
    unknownBuffRefs: [], unsupportedCapabilities: ["GUARD", "LIFESTEAL", "SHIELD_PIERCE"],
  };
}

export const mockAdapter: SimulateAdapter = {
  async validate(match) {
    const cov = coverageOf(match);
    const blockers: string[] = [];
    for (const side of ["red", "blue"] as const) {
      match[side].units.forEach((u, i) => {
        if (!u.shikigamiId) blockers.push(`${side === "red" ? "Red" : "Blue"} slot ${i + 1}: no Shikigami selected`);
        else if (!u.stats.attack || !u.stats.hp) blockers.push(`${u.name}: stats not fully filled in`);
      });
    }
    const warnings: SimulationWarning[] = [
      { kind: "UNKNOWN_STRATEGY", severity: "WARN", message: "3 UNKNOWN mechanic policies in use", detail: "Start-of-battle order / simultaneous trigger priority / betting endgame rules" },
      { kind: "LOW_AI_CONFIDENCE", severity: "INFO", message: `AI high confidence ${cov.aiHigh}/${cov.aiTotal}` },
      { kind: "SOUL_EFFECT_UNSUPPORTED", severity: "INFO", message: "Soul icon not recognised; 4-piece battle effect not loaded" },
    ];
    return { ok: blockers.length === 0, blockers, warnings, coverage: cov, strategySnapshot: STRATEGY };
  },

  async simulate(match, options, onProgress, shouldCancel) {
    const total = options.simulations;
    const seed0 = options.seed === "AUTO" ? Math.floor(Math.random() * 1e9) : options.seed;
    const r = rng(seed0);
    const t0 = Date.now();
    let redWins = 0, blueWins = 0, draws = 0, timeouts = 0, errors = 0;
    const turnsAll: number[] = [];
    const every = Math.max(50, Math.min(options.progressEvery ?? 500, Math.ceil(total / 20)));
    for (let i = 0; i < total; i++) {
      const x = r();
      const turns = 20 + Math.floor(r() * 60);
      turnsAll.push(turns);
      if (x < 0.573) redWins++; else if (x < 0.998) blueWins++; else draws++;
      if ((i + 1) % every === 0 || i === total - 1) {
        onProgress({ completed: i + 1, total, redWins, blueWins, draws, timeouts, errors, elapsedMs: Date.now() - t0 });
        await new Promise(res => setTimeout(res, 0));   // 让 Worker 有机会收到 CANCEL
        if (shouldCancel()) throw new Error("CANCELLED");
      }
    }
    const decisive = redWins + blueWins;
    const ci = decisive ? wilson(redWins, decisive) : null;
    const bi = decisive ? wilson(blueWins, decisive) : null;
    const sorted = turnsAll.slice().sort((a, b) => a - b);
    const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

    const perUnit: PerUnitStats[] = [];
    for (const side of ["red", "blue"] as const) {
      for (const u of match[side].units) {
        if (!u.shikigamiId) continue;
        perUnit.push({
          unitId: u.unitId, name: u.name, side,
          avgDamageDealt: Math.round(u.stats.attack * (1.2 + r())),
          avgDamageTaken: Math.round(u.stats.hp * 0.4 * (0.5 + r())),
          avgHealing: Math.round(u.stats.attack * 0.2 * r()),
          kills: Math.round(r() * 2), deaths: Math.round(r() * 2),
          deathRate: +(r() * 0.8).toFixed(3),
          avgActions: +(3 + r() * 8).toFixed(1),
          skillUsage: { "Normal attack": Math.round(r() * 12), "Skill 2": Math.round(r() * 6), "Skill 3": Math.round(r() * 8) },
          soulTriggerCount: 0,
          controlApplied: Math.round(r() * 4), controlResisted: Math.round(r() * 3),
        });
      }
    }

    const perStrategy = [
      { label: "Current policy", group: "STARTUP" as const, redWinRate: redWins / Math.max(1, decisive) },
      { label: "Startup H1", group: "STARTUP" as const, redWinRate: 0.568 },
      { label: "Startup H2", group: "STARTUP" as const, redWinRate: 0.619 },
      { label: "Trigger H1", group: "TRIGGER" as const, redWinRate: 0.552 },
      { label: "Trigger H2", group: "TRIGGER" as const, redWinRate: 0.580 },
      { label: "Turn Limit 500", group: "TURN_LIMIT" as const, redWinRate: 0.571 },
      { label: "Turn Limit 2000", group: "TURN_LIMIT" as const, redWinRate: 0.574 },
    ];
    const rates = perStrategy.map(s => s.redWinRate).filter((v): v is number => v !== null);
    const mn = Math.min(...rates), mx = Math.max(...rates);
    const spread = mx - mn;
    const modelUncertainty: ModelUncertainty = {
      perStrategy, min: mn, max: mx, spread,
      verdict: spread > 0.15 ? "INCONCLUSIVE" : spread > 0.05 ? "SENSITIVE" : "STABLE",
    };

    const seeds: RepresentativeSeed[] = [
      { seed: seed0 + 143822, winner: "red", turns: 31, label: "Representative Red win" },
      { seed: seed0 + 927114, winner: "blue", turns: 42, label: "Representative Blue win" },
      { seed: seed0 + 192844, winner: "red", turns: 19, label: "Short battle" },
    ];

    const warnings: SimulationWarning[] = [
      { kind: "UNKNOWN_STRATEGY", severity: "WARN", message: "3 UNKNOWN mechanic policies in use" },
      { kind: "MODEL_SENSITIVE", severity: spread > 0.05 ? "WARN" : "INFO", message: `Policy sensitivity ${(spread * 100).toFixed(1)} percentage points` },
    ];
    if (decisive < 1000) warnings.push({ kind: "SMALL_SAMPLE", severity: "WARN", message: `Only ${decisive} decisive battles; confidence interval too wide` });

    return {
      schemaVersion: 1, resultId: "r" + Date.now().toString(36), matchId: match.id,
      simulations: total, redWins, blueWins, draws, timeouts, errors, decisive,
      redWinRate: decisive ? redWins / decisive : null,
      blueWinRate: decisive ? blueWins / decisive : null,
      confidenceInterval: ci ? { method: "WILSON", level: 0.95, low: ci.low, high: ci.high } : null,
      blueConfidenceInterval: bi ? { method: "WILSON", level: 0.95, low: bi.low, high: bi.high } : null,
      battleStats: {
        avgTurns: +(turnsAll.reduce((a, b) => a + b, 0) / Math.max(1, turnsAll.length)).toFixed(1),
        medianTurns: pick(0.5), p95Turns: pick(0.95),
        firstKillRedRate: 0.612,
        avgSurvivorsRed: 2.4, avgSurvivorsBlue: 1.8,
        avgRemainHpRed: 0.31, avgRemainHpBlue: 0.22,
        avgOrbSpentRed: 18.2, avgOrbSpentBlue: 16.7,
        perUnit,
      },
      strategySnapshot: STRATEGY, modelUncertainty, coverage: coverageOf(match), warnings,
      engineVersion: ENGINE_VERSION, gameDataVersion: GAME_DATA_VERSION,
      createdAt: new Date().toISOString(), seeds,
    };
  },

  async replay(match, seed) {
    const units: ReplayUnit[] = [];
    for (const side of ["red", "blue"] as const) for (const u of match[side].units) {
      if (u.shikigamiId) units.push({ unitId: u.unitId, side, name: u.name, maxHp: u.stats.hp });
    }
    const r = rng(seed);
    const events: ReplayEvent[] = [];
    const CODES = ["BATTLE_START", "TURN_START", "ORB_GAUGE_ADVANCE", "SKILL_SELECT", "TARGET_SELECT", "DAMAGE", "STATUS_ADD", "DEATH", "TURN_END"];
    let turn = 0;
    for (let i = 0; i < 120; i++) {
      const code = CODES[Math.floor(r() * CODES.length)];
      if (code === "TURN_START") turn++;
      const actor = units[Math.floor(r() * units.length)];
      const target = units[Math.floor(r() * units.length)];
      events.push({
        index: i, turn, code,
        actorUnitId: actor?.unitId, targetUnitId: target?.unitId,
        text: `${code} ${actor?.name ?? ""}${code === "DAMAGE" ? " → " + (target?.name ?? "") + " " + Math.round(r() * 6000) : ""}`,
        detail: code === "DAMAGE" ? { type: "NORMAL", baseAtk: 5946, skillRatio: 1.25, defense: 506, crit: r() > 0.5, randomRoll: +r().toFixed(6), finalDamage: Math.round(r() * 6000), seed } : { seed },
      });
    }
    return { events, units, turns: Math.max(1, turn), winner: r() > 0.45 ? "red" : "blue" };
  },
};
