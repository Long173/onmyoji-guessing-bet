// adapters/engine-adapter.ts — ★ UI-2：真引擎适配器
// 对外接口与 mock-adapter **完全一致**，Worker 协议不变。
// 引擎只在 Worker 线程里跑；主线程拿到的永远是 DTO。
import type { SimulateAdapter } from "./simulate.ts";
import { ENGINE_VERSION, GAME_DATA_VERSION } from "./simulate.ts";
import type { GuessingMatch } from "../contracts/guessing-match.ts";
import type {
  SimulationOptions, SimulationResult, SimulationWarning, StrategySnapshot, CoverageSnapshot,
  PerUnitStats, RepresentativeSeed, WarningKind, ModelUncertainty,
} from "../contracts/simulation-result.ts";
import type { ValidationReport, ReplayEvent, ReplayUnit } from "../contracts/worker-api.ts";
import { createKit, assembleMatch, runOne, charInfo, mixSeed } from "../engine/assemble.ts";
import type { EngineBundle, EngineKit } from "../engine/assemble.ts";
import { wilson } from "../../../../battle-lab/runner/monte-carlo.ts";
import { SnapshotRecorder } from "../../../../battle-lab/kernel/snapshot.ts";
import { buildReplay } from "../../../../battle-lab/kernel/replay.ts";
import { captureState } from "../../../../battle-lab/kernel/state.ts";
import { assessFidelity } from "../../../../battle-lab/kernel/fidelity.ts";
import type { FidelityInput, FidelityUnitInput } from "../../../../battle-lab/kernel/fidelity.ts";

import { interpretEffect } from "../../../../battle-lab/soul/effect-system.ts";
import { customSoulFor } from "../../../../battle-lab/soul/custom-effects.ts";
import { bettingAiRuleOf, bettingKitSkillOf, bettingNeverCastOf } from "../../../../battle-lab/compile/betting-coverage.ts";
import { skillLevelMode } from "../../../../battle-lab/compile/max-level.ts";
import { BETTING_HP_SCALE_RULE } from "../../../../battle-lab/compile/betting-policies.ts";
import type { UnitSupport } from "../contracts/worker-api.ts";
import { displayName } from "../kb/names.ts";
import { skillText } from "../kb/en-text.ts";

/** Betting (MAX skill level) mode: the web worker always runs it; the regression tests keep BASE. */
const bettingMode = (): boolean => skillLevelMode() === "MAX";

/** 单局异常上限：超过就中止整轮（避免每局都抛同一个错，白白等十分钟） */
const MAX_ERRORS = 20;
/** 逐单位贡献统计的抽样上限：全量跑胜率，贡献度用有代表性的子样本（结果里会标注） */
const PER_UNIT_SAMPLE = 2000;

/**
 * ★★★ 第 137 轮：**观测档位 → 运行模式**的映射（§35 / §34）。
 *
 * 由来：审核结论里有一条「engine-adapter 的 NONE/FULL 映射无断言」——
 * 这两处原来各自写着一个字符串字面量（批量模拟写 "NONE"、观看一场写 "FULL"），
 * 谁都没法断言"哪个模式该用哪一档"，而且改错一个字也不会有任何测试变红。
 * 现在把它抽成一个**可调用的纯函数**：断言能直接问它（tests/ui13-trace-vocab.ts §[6]），
 * 两个调用点也都走它，代码里不再有第二处字面量。
 *
 *   · batch（模拟胜率，1k–10k 局）：观测关到 NONE —— 逐单位贡献由引擎 stats 提供，
 *     关掉 trace 不丢任何统计（g2/g20 已断言三档的**全部统计**逐字节一致）；
 *   · watch（观看一场）：FULL —— Theater 要拖到任意一帧，必须有事件流 + 逐帧快照。
 */
export function traceLevelFor(mode: "batch" | "watch"): "NONE" | "FULL" {
  return mode === "watch" ? "FULL" : "NONE";
}

/** 引擎未暴露的指标：**报 0 并显式声明**，绝不编造 */
const UNSUPPORTED_METRICS = ["avgOrbSpent* (engine has no Onibi-spent counter)"];

/**
 * Soul battle-effect support as the battle installs it (soul/effect-system.ts installSoulEffects):
 *   · betting (MAX) mode: a hand-written installer (customSoulFor — the same lookup the installer uses) ⇒ FULL;
 *   · otherwise the generic text interpreter's verdict (FULL only when its kind actually runs).
 * BASE keeps the historical generic verdict (regression tests pin it).
 */
function soulSupportOf(kit: EngineKit, id: number | null): { support: "FULL" | "PARTIAL" | "UNSUPPORTED"; custom: boolean; note: string } {
  if (id == null) return { support: "UNSUPPORTED", custom: false, note: "no soul" };
  const ir = kit.soulBook.get(Number(id));
  if (!ir) return { support: "UNSUPPORTED", custom: false, note: "soul not in the knowledge base" };
  if (bettingMode() && customSoulFor(ir.name)) {
    // The installer's own note (CUSTOM_SOUL_NOTES) is engine-internal and partly Chinese; the install report keeps it.
    return { support: "FULL", custom: true, note: "hand-written soul effect (battle-lab/soul/custom-effects.ts)" };
  }
  const interp = interpretEffect(ir);
  const ok = interp.kind !== "UNSUPPORTED" && !!ir.trigger;
  return ok
    ? { support: "FULL", custom: false, note: "generic soul effect: " + interp.kind }
    : { support: ir.trigger ? "PARTIAL" : "UNSUPPORTED", custom: false, note: "generic text interpreter found no executable pattern" };
}
function supportOf(kit: EngineKit, id: number | null): "FULL" | "PARTIAL" | "UNSUPPORTED" {
  return soulSupportOf(kit, id).support;
}

/** English description of an endgame preset (kernel/policies.ts EndgamePolicies). */
function endgameText(e: any): string {
  if (!e || e.mode !== "REFEREE_ROUNDS") return `${e?.id ?? "?"}: no anti-stall rule; battles can stall at the turn cap.`;
  const pct = (x: number) => Math.round(x * 100) + "%";
  const late = e.lateFromRound != null ? `, +${pct(e.lateDamageStep)} per round from round ${e.lateFromRound}` : "";
  const trigger = e.refereeSpeed ? `a referee that runs on the action bar at speed ${e.refereeSpeed} (from the match-6 and match-8 replays)`
    : e.actionsPerRound ? `a referee round every ${e.actionsPerRound} actions` : "referee rounds after every unit has acted";
  const heal = e.healStep > 0 ? ` / -${pct(e.healStep)} healing` : " (healing unchanged)";
  return `${e.id} (${e.status}): ${trigger}: +${pct(e.damageStep)} damage${heal} per round${late}; `
    + (e.timeout === "ALIVE_THEN_HP" ? "a battle still undecided at the turn cap goes to the side with more survivors, then the higher remaining HP share. " : "")
    + "The damage step is the Arena (duel) referee's, not measured for duel betting.";
}

/** What the replaced guessing ruleset still does in betting mode (kernel/battle.ts, kernel/environment.ts). */
const GUESSING_RULESET_NOTE = "The guessing ruleset COMMUNITY_2020_UNVERIFIED (UNKNOWN) is still attached, but in betting mode only its "
  + "no-Onmyoji lineup check is used (user-confirmed rule GUESSING_NO_ONMYOJI). Its stalemate ramp and timeout fields are empty "
  + "(no environment rule is built from them), so stalls and the turn cap are decided by the endgame policy shown here.";

function strategyFrom(battle: any): StrategySnapshot {
  const p = battle?.policies ?? {};
  const mk = (x: any) => ({
    id: typeof x === "string" ? x : (x?.id ?? "?"),
    status: (x && typeof x === "object" && x.status) ? x.status : "HYPOTHESIS",
  });
  // Betting mode: policies.endgame (compile/betting-policies.ts) decides stalls and the turn cap; the guessing
  // ruleset only keeps its no-Onmyoji check (GUESSING_RULESET_NOTE). BASE: the guessing ruleset as before.
  const endgame = bettingMode() && p.endgame
    ? { ...mk(p.endgame), note: `${endgameText(p.endgame)} ${GUESSING_RULESET_NOTE}` }
    : mk(p.guessing);
  const snap: StrategySnapshot = {
    startup: mk(p.startup), triggerPriority: mk(p.priority), death: mk(p.death),
    endgame, resource: mk(p.resource), unknownCount: 0,
    // Betting mode: the max-HP multiplier is a battle-wide HYPOTHESIS rule too (shown in the readiness panel).
    ...(bettingMode() ? { hpScale: { id: BETTING_HP_SCALE_RULE.id, status: BETTING_HP_SCALE_RULE.status, value: BETTING_HP_SCALE_RULE.value,
      note: `Real max HP = Lineup HP × ${BETTING_HP_SCALE_RULE.value} (HYPOTHESIS). ${BETTING_HP_SCALE_RULE.evidence}` } } : {}),
  };
  snap.unknownCount = [snap.startup, snap.triggerPriority, snap.death, snap.endgame, snap.resource]
    .filter(x => x.status === "UNKNOWN").length;
  return snap;
}

const UNKNOWN_STRAT: StrategySnapshot = {
  startup: { id: "?", status: "HYPOTHESIS" }, triggerPriority: { id: "?", status: "HYPOTHESIS" },
  death: { id: "?", status: "HYPOTHESIS" }, endgame: { id: "?", status: "HYPOTHESIS" },
  resource: { id: "?", status: "HYPOTHESIS" }, unknownCount: 0,
};

export function createEngineAdapter(bundle: EngineBundle): SimulateAdapter {
  ensureCapSupport(bundle as any);
  let kit: EngineKit | null = null;
  const getKit = (): EngineKit => (kit ??= createKit(bundle));

  /** 装配一次探针对局：校验 / 覆盖度 / 策略快照（不跑战斗） */
  function probe(match: GuessingMatch) {
    return assembleMatch(getKit(), match, { seed: 1 });
  }

  function coverageOf(match: GuessingMatch, issues: string[]): CoverageSnapshot {
    const k = getKit();
    const units = [...match.red.units, ...match.blue.units].filter(u => u.shikigamiId > 0);
    const joined = units.filter(u => k.shikiById.has(u.shikigamiId));
    let skillsAvailable = 0, aiHigh = 0, aiHandWritten = 0;
    for (const u of joined) {
      // ★ 用**编译后**的 AI 置信度，而不是数据文件里的字段（后者在 ai.json 里根本不存在）
      const info = charInfo(k, u.shikigamiId);
      if (info.skills > 0) skillsAvailable++;
      // Betting mode: a hand-written betting rule decides the unit's skills (the KB rules never run for it).
      if (bettingAiRuleOf(u.shikigamiId)) { aiHigh++; aiHandWritten++; }
      else if (info.aiConfidence === "HIGH" || info.aiConfidence === "MEDIUM") aiHigh++;
    }
    const souls = units.map(u => u.soulId).filter((x): x is number => x != null);
    /**
     * ★★ 第 37 轮：这里原先是 `souls.length` —— 也就是"填了御魂 id"就算"已解析"。
     *   于是 id 根本不在知识库里的御魂也会被算成已解析，界面（DeveloperHud「御魂已解析」、
     *   HealthCheck「御魂定义」）就会显示满分。这正是 §29 那类**把"有输入"说成"解析成功"**的过度声称。
     *   现在它等于标签真正承诺的东西：该 id 在知识库里查得到定义。
     *   注意区分第二个轴：**战斗效果支持度**由 soulEffectsFull/Partial 单独报（FULL/PARTIAL/UNSUPPORTED），
     *   两者不是一回事 —— "定义解析成功"绝不等于"战斗效果已实现"。
     */
    const soulsUnknown = souls.filter(id => !k.soulDefs.has(id)).length;
    const soulRows = souls.map(id => soulSupportOf(k, id));
    const supports = soulRows.map(r => r.support);
    const unsupported = supports.filter(s => s === "UNSUPPORTED").length;
    const partial = supports.filter(s => s === "PARTIAL").length;
    const custom = soulRows.filter(r => r.custom).length;
    const nUncond = units.reduce((acc, u) => acc + charInfo(k, u.shikigamiId).unconditional.length, 0);
    const unconditionalNote: string[] = nUncond ? [`${nUncond} AI cast rule(s) have no trigger condition (treated as cast every turn)`] : [];
    return {
      unitsJoined: joined.length, unitsTotal: 10,
      skillsAvailable, skillsTotal: joined.length,
      aiHigh, aiTotal: joined.length,
      soulsResolved: souls.length - soulsUnknown, soulsTotal: joined.length,
      soulEffectsFull: supports.filter(s => s === "FULL").length,
      soulEffectsPartial: partial,
      ...(bettingMode() ? {
        aiHandWritten, soulEffectsCustom: custom,
        notes: {
          ai: `High = KB AI compiled HIGH/MEDIUM, or a hand-written betting AI rule (${aiHandWritten} unit(s): compile/betting-*.ts decides their skills). Not verified in-game.`,
          souls: `Full = the effect really runs in battle: ${custom} hand-written soul effect(s) (soul/custom-effects.ts) + ${supports.filter(s => s === "FULL").length - custom} generic. Partial = trigger recognised, effect not executable; unsupported = no effect at all (${unsupported}).`,
        },
      } : {}),
      unknownBuffRefs: [],
      unsupportedCapabilities: [
        ...unconditionalNote,
        ...(unsupported ? [`${unsupported} Soul(s) have no implemented battle effect`] : []),
        ...(soulsUnknown ? [`${soulsUnknown} Soul id(s) not in the knowledge base (definition unresolved)`] : []),
        ...(issues.some(i => i.includes("LOW")) ? [bettingMode() ? "Some Shikigami skills compiled with LOW confidence (see the Fidelity panel)" : "Some Shikigami skills/AI compiled with LOW confidence"] : []),
        ...UNSUPPORTED_METRICS,
      ],
    };
  }

  return {
    async validate(match): Promise<ValidationReport> {
      const blockers: string[] = [];
      const warnings: SimulationWarning[] = [];
      for (const side of ["red", "blue"] as const) {
        match[side].units.forEach((u, i) => {
          const tag = `${side === "red" ? "Red" : "Blue"} slot ${i + 1}`;
          if (!u.shikigamiId) { blockers.push(`${tag}: no Shikigami selected`); return; }
          if (!u.stats.attack || !u.stats.hp) blockers.push(`${tag} "${displayName(u.name)}": stats not filled in (ATK/HP is 0)`);
          if (u.shikigamiId >= 10 && u.shikigamiId <= 16) blockers.push(`${tag} "${displayName(u.name)}" is an Onmyoji/hero, not allowed in betting matches (rule GUESSING_NO_ONMYOJI)`);
        });
      }
      const a = blockers.length ? null : probe(match);
      const issues = a ? a.issues : [];
      // ★ 把**本局这 10 只**的技能编译问题一并纳入报告（按 unitId 作用域取，避免跨对局串味）
      const k = getKit();
      for (const side of ["red", "blue"] as const) {
        for (const u of match[side].units) {
          if (!u.shikigamiId) continue;
          for (const i of charInfo(k, u.shikigamiId).issues) {
            if (coveredSkillIssue(k, u.shikigamiId, i)) continue;   // betting mode: the module runs that skill
            issues.push(`${displayName(u.name)}: ${i}`);
          }
        }
      }
      for (const i of issues.filter(x => x.includes("stat echo mismatch"))) blockers.push(i);
      const cov = coverageOf(match, issues);
      const strat = a ? strategyFrom(a.battle) : UNKNOWN_STRAT;
      if (bettingMode() && strat.endgame.note) cov.notes = { ...(cov.notes ?? {}), policies: `Endgame rule in force: ${strat.endgame.note}` };
      /**
       * ★★ 第 41 轮：御魂的**可执行效果**必须逐局报出来。
       *
       * coverage 里的 soulEffectsFull / Partial 说的是「知识库对这件御魂的支持度」，
       * 与「本局装上它会不会真的发生什么」是两件事。tests/g31-soul-liveness.ts 逐件实测：
       * 70 件里只有 3 件改变对局；32 件标 PARTIAL 的**全部**零可观测效果。
       *
       * 原因在 soul/effect-system.ts 的设计里：未匹配到可执行句式的御魂仍然注册 handler，
       * 事件会被投递、会被计数，但**不改变任何状态**。于是「已加载 N 件御魂」
       * 很容易被读成「N 件御魂在起作用」—— 这个数字以前只存在于装配返回值里，
       * 没有任何界面读它。现在按局报出来。
       */
      const sr: any = a?.soulReport;
      if (sr && sr.installed.length) {
        const real = (sr.installed as any[]).filter(x => x.kind !== "UNSUPPORTED").length;
        const empty = sr.installed.length - real;
        const detail = "Souls whose text matched no executable pattern only register an empty handler: events reach them but change no state. "
          + "See battle-lab/tests/g31-soul-liveness.ts (only 3 of 70 Souls change the battle).";
        if (real === 0) {
          warnings.push({
            kind: "SOUL_EFFECT_UNSUPPORTED", severity: "WARN",
            message: `${sr.installed.length} Soul effect(s) in this match — **none is executable** (${empty} registered but inert)`,
            detail,
          });
        } else if (empty > 0) {
          warnings.push({
            kind: "SOUL_EFFECT_UNSUPPORTED", severity: "INFO",
            message: `${sr.installed.length} Soul effect(s) in this match: ${real} executable, ${empty} registered but inert`,
            detail,
          });
        }
      }

      if (strat.unknownCount > 0) warnings.push({
        kind: "UNKNOWN_STRATEGY", severity: "WARN",
        message: `${strat.unknownCount} UNKNOWN mechanic policies in use`,
        detail: "Betting endgame rules are untested in-game; start-of-battle order / simultaneous-trigger priority / death resolution are community assumptions. Numbers are fine for comparison but are not mechanic conclusions." + (strat.endgame.note ? " " + strat.endgame.note : ""),
      });
      const uniq = [...new Set(issues)];
      const passive = uniq.filter(i => i.includes("被动技能，引擎未建模"));
      const partial = uniq.filter(i => i.includes("已解析出可执行数值"));
      const gap = uniq.filter(i => i.includes("未解析出任何可执行数值"));
      if (passive.length) warnings.push({
        kind: "LOW_AI_CONFIDENCE", severity: "INFO",
        message: `${passive.length} passive skill(s) not modelled (engine has no trigger model for them)`,
        detail: passive.join("；"),
      });
      if (partial.length) warnings.push({
        kind: "LOW_AI_CONFIDENCE", severity: "INFO",
        message: `${partial.length} skill(s): main effect parsed, extra effects in the description not modelled`,
        detail: partial.join("；"),
      });
      for (const i of gap) warnings.push({ kind: "LOW_AI_CONFIDENCE", severity: "WARN", message: i, detail: "This skill has no executable values at all; it will be noticeably weaker in simulation" });
      for (const i of uniq) {
        if (i.includes("AI confidence LOW")) warnings.push({ kind: "LOW_AI_CONFIDENCE", severity: "WARN", message: i });
        else if (i.includes("no skill data") || i.includes("not in the knowledge base")) warnings.push({ kind: "DATA_MISSING", severity: "WARN", message: i });
      }
      // ★ AI 施放规则的**触发条件缺口**：数据里根本没写条件 → 引擎只能每回合都放
      const uncond: Array<{ who: string; label: string; cost: number; spamRisk: boolean }> = [];
      for (const side of ["red", "blue"] as const) {
        for (const u of match[side].units) {
          if (!u.shikigamiId) continue;
          for (const r of charInfo(getKit(), u.shikigamiId).unconditional) {
            // 0 鬼火的技能不受鬼火约束 → 会真的被无限重复施放（思金神 601「智火长明」即此例）
            uncond.push({ who: u.name, label: r.label, cost: r.cost, spamRisk: r.cost === 0 && !r.isBasic });
          }
        }
      }
      if (uncond.length) {
        const risky = uncond.filter(x => x.spamRisk);
        warnings.push({
          kind: "LOW_AI_CONFIDENCE",
          severity: risky.length ? "WARN" : "INFO",
          message: `${uncond.length} AI cast rule(s) have no trigger condition in the data; the engine casts them every turn${risky.length ? `, ${risky.length} of them cost 0 Onibi (not limited by Onibi, will be cast repeatedly)` : " (still limited by Onibi)"}`,
          detail: uncond.map(x => `${displayName(x.who)}: ${x.label} (${x.cost < 0 ? "passive" : x.cost + " Onibi"})`).join("; "),
        });
      }
      if (cov.soulEffectsPartial > 0) warnings.push({
        kind: "SOUL_EFFECT_UNSUPPORTED", severity: "WARN",
        message: `${cov.soulEffectsPartial} Soul(s) have only some trigger conditions implemented`,
        detail: "Static Soul stats are not added (panel values are already final from the screenshot), but battle effects will be underestimated.",
      });
      if (a?.displayTies.length) warnings.push({
        kind: "MODEL_SENSITIVE", severity: "INFO",
        message: `Displayed Speed ties: ${a.displayTies.map(t => `Speed ${t.spd}: ${t.members.join("/")}`).join("; ")}`,
        detail: "Screenshots only show integer Speed; turn order between tied units comes from the feasible range and may flip the result.",
      });

      // ★ Per-Match Fidelity（§1-§10、§33）：阵容编辑器在**跑之前**就能看到五层状态
      const fidelity = blockers.length && !a ? null : buildFidelity(getKit(), match, strat, a?.battle?.policies ?? null);
      return { ok: blockers.length === 0, blockers, warnings, coverage: cov, strategySnapshot: strat, fidelity, units: unitSupport(getKit(), match) };
    },

    async simulate(match, options, onProgress, shouldCancel): Promise<SimulationResult> {
      const k = getKit();
      const total = Math.max(1, options.simulations);
      const seedBase = options.seed === "AUTO" ? (Date.now() % 1_000_000_000) : Number(options.seed);
      const maxTurns = options.maxTurns ?? 300;
      const t0 = Date.now();
      const every = Math.max(10, Math.min(options.progressEvery ?? 500, Math.ceil(total / 20)));

      // 警告与模型不确定性都在主循环之后追加，但 warn() 需要提前可用
      const warnings: SimulationWarning[] = [];
      const warn = (kind: WarningKind, severity: SimulationWarning["severity"], message: string, detail?: string) =>
        warnings.push({ kind, severity, message, ...(detail ? { detail } : {}) });

      let redWins = 0, blueWins = 0, draws = 0, timeouts = 0, errors = 0;
      let firstKillRedBattles = 0, firstKillKnown = 0;
      let survRed = 0, survBlue = 0, hpRed = 0, hpBlue = 0;
      const turnsAll: number[] = [];
      const seeds: RepresentativeSeed[] = [];
      const issues = new Set<string>();
      const acc = new Map<string, PerUnitStats>();
      let strat: StrategySnapshot | null = null;
      let lastError = "";
      let sampled = 0;

      // 引擎实体 id -> UI unitId（红 101..105 / 蓝 201..205）
      const idMap = new Map<number, { unitId: string; side: "red" | "blue"; name: string }>();
      for (const side of ["red", "blue"] as const) {
        match[side].units.forEach((u, i) => {
          if (u.shikigamiId) idMap.set((side === "red" ? 100 : 200) + i + 1, { unitId: u.unitId, side, name: u.name });
        });
      }
      for (const [, m] of idMap) acc.set(m.unitId, {
        unitId: m.unitId, name: m.name, side: m.side, avgDamageDealt: 0, avgDamageTaken: 0, avgHealing: 0,
        kills: 0, deaths: 0, deathRate: 0, avgActions: 0, skillUsage: {}, soulTriggerCount: 0,
        controlApplied: 0, controlResisted: 0,
      });

      for (let i = 0; i < total; i++) {
        const seed = mixSeed(seedBase, i);   // ★ 雪崩散列，避免相邻 seed 相关导致 CI 偏窄
        try {
          // ★ G5/§35：批量模拟把观测关到 NONE —— 10k 局不需要事件流，
        //   逐单位贡献改由引擎自己的 stats 提供（§45），因此关掉 trace 不丢任何统计。
        const a = await runOne(k, match, seed, { maxTurns, annotate: false, traceLevel: traceLevelFor("batch") });
          strat ??= strategyFrom(a.battle);
          for (const x of a.issues) issues.add(x);
          const r = a.result;
          turnsAll.push(r.turns);
          let kind: RepresentativeSeed["winner"];
          if (r.reason === "TURN_LIMIT") { timeouts++; kind = "timeout"; }
          else if (r.winner === 0) { redWins++; kind = "red"; }
          else if (r.winner === 1) { blueWins++; kind = "blue"; }
          else { draws++; kind = "draw"; }
          if (!seeds.some(s => s.winner === kind)) seeds.push({ seed, winner: kind, turns: r.turns });

          survRed += a.battle.teams[0].aliveMembers().length;
          survBlue += a.battle.teams[1].aliveMembers().length;
          hpRed += a.battle.teams[0].aliveMembers().reduce((s: number, m: any) => s + m.hp, 0);
          hpBlue += a.battle.teams[1].aliveMembers().reduce((s: number, m: any) => s + m.hp, 0);
          const fd = (a.battle as any).firstDeathId;
          if (fd != null) { firstKillKnown++; if (fd >= 200) firstKillRedBattles++; }

          if (sampled < PER_UNIT_SAMPLE) { accumulateStats(a, acc, idMap); sampled++; }
        } catch (err: any) {
          errors++; lastError = String(err?.message ?? err);
          if (errors >= MAX_ERRORS) break;
        }
        if ((i + 1) % every === 0 || i === total - 1) {
          onProgress({ completed: i + 1, total, redWins, blueWins, draws, timeouts, errors, elapsedMs: Date.now() - t0 });
          await new Promise(res => setTimeout(res, 0));   // 让出事件循环，才能收到 CANCEL
          if (shouldCancel()) throw new Error("CANCELLED");
        }
      }

      // ── 模型不确定性：把 UNKNOWN/HYPOTHESIS 策略换一种假设，看结论会不会翻转 ──
      // 与抽样误差**严格分开**：抽样误差靠加大 N 缩小，模型不确定性加大 N 也不会变小。
      let uncertainty: ModelUncertainty | null = null;
      if (total >= 800 && redWins + blueWins > 0) {
        const nSens = Math.max(150, Math.min(500, Math.round(total / 10)));
        const variants: Array<{ label: string; group: ModelUncertainty["perStrategy"][number]["group"]; opts: any; note: string }> = [
          { label: `Baseline (${(strat ?? UNKNOWN_STRAT).startup.id.slice(0, 22)})`, group: "STARTUP", opts: {}, note: "Assumption currently in use" },
          { label: "Start: Initiative before Souls/passives", group: "STARTUP", opts: { startup: "SENKI_FIRST" }, note: "Officially Initiative only 'acts at battle start'; its order vs. Souls is unknown" },
          { label: "Death: HP≤0 counts as defeated", group: "DEATH", opts: { death: "HP_ZERO_IS_KILLED" }, note: "Untested whether death prevention / transform resolves before death" },
          { label: "Turn limit 100 (strong endgame ramp)", group: "TURN_LIMIT", opts: { maxTurns: 100 }, note: "Betting endgame damage ramp is untested" },
          { label: "Turn limit 600 (weak endgame ramp)", group: "TURN_LIMIT", opts: { maxTurns: 600 }, note: "Same as above, other extreme" },
        ];
        const per: ModelUncertainty["perStrategy"] = [];
        for (const v of variants) {
          let r0 = 0, b0 = 0;
          for (let i = 0; i < nSens; i++) {
            try {
              const a = await runOne(k, match, mixSeed(seedBase + 7919, i), { maxTurns: v.opts.maxTurns ?? maxTurns, ...v.opts, annotate: false });
              if (a.result.reason === "TURN_LIMIT") continue;
              if (a.result.winner === 0) r0++; else if (a.result.winner === 1) b0++;
            } catch { /* 敏感性扫描的个别异常不计入主结果 */ }
          }
          const d = r0 + b0;
          per.push({ label: v.label, group: v.group, redWinRate: d ? r0 / d : null, note: `${v.note} (N=${nSens})` });
          onProgress({ completed: total, total, redWins, blueWins, draws, timeouts, errors, elapsedMs: Date.now() - t0 });
          if (shouldCancel()) throw new Error("CANCELLED");
        }
        const rates = per.map(p => p.redWinRate).filter((x): x is number => x !== null);
        const min = rates.length ? Math.min(...rates) : null;
        const max = rates.length ? Math.max(...rates) : null;
        const spread = min !== null && max !== null ? max - min : null;
        uncertainty = {
          perStrategy: per, min, max, spread,
          verdict: spread === null ? "INCONCLUSIVE" : spread > 0.1 ? "SENSITIVE" : "STABLE",
        };
        if (uncertainty.verdict === "SENSITIVE") warn("MODEL_SENSITIVE", "BLOCK",
          `Conclusion is sensitive to untested mechanics: under other assumptions the Red win rate drifts between ${(min! * 100).toFixed(1)}% and ${(max! * 100).toFixed(1)}%`,
          "Drift of " + (spread! * 100).toFixed(1) + " percentage points. This is not sampling error; more simulations will not remove it.");
        else if (uncertainty.verdict === "STABLE") warn("MODEL_SENSITIVE", "INFO",
          `Conclusion is not sensitive to the known untested mechanics (drift ${(spread! * 100).toFixed(1)} percentage points)`,
          "This does not mean the mechanics are verified, only that these candidate assumptions give similar conclusions.");
      }

      const ran = redWins + blueWins + draws + timeouts;
      const decisive = redWins + blueWins;
      const sorted = turnsAll.slice().sort((a, b) => a - b);
      const pick = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
      const n = Math.max(1, ran);

      if (strat && strat.unknownCount > 0) warn("UNKNOWN_STRATEGY", "WARN", `${strat.unknownCount} UNKNOWN mechanic policies in use`, "Results are fine for comparing lineups but are not mechanic conclusions");
      if (timeouts / n > 0.2) warn("HIGH_STALL_RATE", "WARN", `${((timeouts / n) * 100).toFixed(1)}% of battles did not finish within ${maxTurns} turns`, "Unfinished battles count toward neither side's win rate, so Red + Blue win rates exclude them");
      if (decisive < 100) warn("SMALL_SAMPLE", "WARN", `Only ${decisive} decisive battles`, "The Wilson interval will be wide; not enough to judge which side is stronger");
      if (sampled < ran) warn("SMALL_SAMPLE", "INFO", `Per-unit contribution uses only the first ${sampled} battles`, "Win rate uses the full sample; contribution uses a representative subsample");
      if (errors) warn("DATA_MISSING", errors >= MAX_ERRORS ? "BLOCK" : "WARN", `${errors} battle(s) errored`, lastError + (errors >= MAX_ERRORS ? " (limit reached, aborted early)" : ""));
      if (ran < total) warn("DATA_MISSING", "WARN", `Only ${ran}/${total} battles completed`, "Results are based on an incomplete sample");

      const perUnit = [...acc.values()].map(p => ({
        ...p,
        avgDamageDealt: Math.round(p.avgDamageDealt / Math.max(1, sampled)),
        avgDamageTaken: Math.round(p.avgDamageTaken / Math.max(1, sampled)),
        avgActions: +(p.avgActions / Math.max(1, sampled)).toFixed(1),
        deathRate: +(p.deaths / Math.max(1, sampled)).toFixed(3),
      }));

      return {
        schemaVersion: 1,
        resultId: "r" + seedBase.toString(36) + "-" + total,
        matchId: match.id,
        simulations: ran, redWins, blueWins, draws, timeouts, errors, decisive,
        redWinRate: decisive ? redWins / decisive : null,
        blueWinRate: decisive ? blueWins / decisive : null,
        confidenceInterval: decisive ? { method: "WILSON", level: 0.95, ...ci(wilson(redWins, decisive)) } : null,
        blueConfidenceInterval: decisive ? { method: "WILSON", level: 0.95, ...ci(wilson(blueWins, decisive)) } : null,
        battleStats: {
          avgTurns: sorted.length ? +(sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1) : 0,
          medianTurns: pick(0.5), p95Turns: pick(0.95),
          firstKillRedRate: firstKillKnown ? firstKillRedBattles / firstKillKnown : null,
          avgSurvivorsRed: +(survRed / n).toFixed(2), avgSurvivorsBlue: +(survBlue / n).toFixed(2),
          avgRemainHpRed: Math.round(hpRed / n), avgRemainHpBlue: Math.round(hpBlue / n),
          avgOrbSpentRed: 0, avgOrbSpentBlue: 0,   // 引擎无此计数器 —— 已在 unsupportedCapabilities 声明
          perUnit,
        },
        strategySnapshot: strat ?? UNKNOWN_STRAT,
        modelUncertainty: uncertainty,
        coverage: coverageOf(match, [...issues]),
        warnings,
        engineVersion: ENGINE_VERSION,
        gameDataVersion: GAME_DATA_VERSION,
        createdAt: new Date().toISOString(),
        seeds: seeds.slice(0, 4),
      };
    },

    async replay(match, seed) {
      const k = getKit();
      // ★ G4：回放走 FULL 档（事件流 + 逐帧 Checkpoint/Delta），
      //   这样 Theater 拖到任意一帧都能重建战场，而不是只能顺着事件列表读。
      const recorder = new SnapshotRecorder(64);
      const a = await runOne(k, match, seed, { maxTurns: 300, annotate: true, traceLevel: traceLevelFor("watch"), recorder });
      const idMap = new Map<number, { unitId: string; side: "red" | "blue"; name: string }>();
      for (const side of ["red", "blue"] as const) {
        match[side].units.forEach((u, i) => {
          if (u.shikigamiId) idMap.set((side === "red" ? 100 : 200) + i + 1, { unitId: u.unitId, side, name: u.name });
        });
      }
      const units: ReplayUnit[] = [];
      for (const side of ["red", "blue"] as const) {
        for (const b of a[side]) {
          const u = idMap.get(b.entity.id);
          if (u) units.push({ unitId: u.unitId, side, name: b.entity.name, maxHp: b.entity.maxHp });
        }
      }
      const nm = (id: any) => { const n = idMap.get(id)?.name; return n != null ? displayName(n) : (id != null ? "#" + id : "?"); };
      const events: ReplayEvent[] = (a.battle.trace as any[]).map((e, i) => ({
        index: i, turn: e.turn ?? 0, code: e.t,
        actorUnitId: idMap.get(e.src)?.unitId,
        targetUnitId: idMap.get(e.dst ?? e.id)?.unitId,
        text: renderEvent(e, nm),
        detail: safeJson(e),
      }));
      // 完整 Replay 文件：帧流 + 事件链 + Checkpoint/Delta + 终局状态指纹
      const replay = buildReplay(a.battle as any, recorder, {
        engineVersion: ENGINE_VERSION, gameDataVersion: GAME_DATA_VERSION,
        matchId: match.id, seed, maxTurns: 300,
        policyIds: {
          startup: (a.battle as any).policies.startup.id, priority: (a.battle as any).policies.priority,
          tieBreak: (a.battle as any).policies.tieBreak, death: (a.battle as any).policies.death.id,
          resource: (a.battle as any).policies.resource.id, guessing: (a.battle as any).policies.guessing.id,
        },
        red: match.red.units.map(u => u.name), blue: match.blue.units.map(u => u.name),
      }, captureState(a.battle), { winner: a.result.winner, turns: a.result.turns, reason: a.result.reason });

      return {
        events, units, turns: a.result.turns,
        winner: a.result.reason === "TURN_LIMIT" ? "timeout" : (a.result.winner === 0 ? "red" : a.result.winner === 1 ? "blue" : "draw"),
        replay,
      };
    },
  };
}

/** 能力矩阵：来自引擎自己的覆盖度数据（随 bundle 一起下发），**不手写支持度** */
let CAP_SUPPORT: Record<string, "FULL" | "PARTIAL" | "NONE"> = {};
function ensureCapSupport(bundle: any) {
  if (Object.keys(CAP_SUPPORT).length) return;
  CAP_SUPPORT = Object.fromEntries(((bundle?.capabilities?.rows ?? []) as any[]).map(r => [String(r.key), r.support as any]));
}

/**
 * 组装 FidelityInput：全部数据都来自引擎与知识库，没有任何一处是"估"出来的。
 * 特别地：GAME-VERIFIED 恒为 false —— 我们从没做过游戏内大规模验证，不许假装做过。
 */
/** Compile issues of a skill that a betting kit implements / the betting AI never casts (betting mode only). */
function coveredSkillIssue(k: EngineKit, shikigamiId: number, issue: string): boolean {
  if (!bettingMode()) return false;
  return charInfo(k, shikigamiId).skillDetails.some(sd =>
    (bettingKitSkillOf(sd.skillId) || bettingNeverCastOf(sd.skillId)) && issue.includes("「" + sd.name + "」"));
}

/** Per-unit AI / soul support as the battle runs it (unit tiles). */
function unitSupport(k: EngineKit, match: GuessingMatch): UnitSupport[] {
  const out: UnitSupport[] = [];
  for (const side of ["red", "blue"] as const) {
    for (const u of match[side].units) {
      if (!u.shikigamiId) continue;
      const info = charInfo(k, u.shikigamiId);
      const soul = u.soulId == null ? null : { id: u.soulId, ...soulSupportOf(k, u.soulId) };
      out.push({ side, name: u.name, ai: { confidence: info.aiConfidence, handWritten: bettingAiRuleOf(u.shikigamiId) }, soul });
    }
  }
  return out;
}

function buildFidelity(k: EngineKit, match: GuessingMatch, strat: any, policies: any = null): any {
  const betting = bettingMode();
  const units: FidelityUnitInput[] = [];
  const capUse = new Map<string, number>();

  for (const side of ["red", "blue"] as const) {
    for (const u of match[side].units) {
      if (!u.shikigamiId) continue;
      const info = charInfo(k, u.shikigamiId);
      const soulSupport = u.soulId == null ? null : supportOf(k, u.soulId);
      const handAI = bettingAiRuleOf(u.shikigamiId);
      units.push({
        name: u.name, side, ...(betting ? { label: displayName(u.name) } : {}),
        // ★ 「填了没」只能看四个**绝对值**维度：暴击/爆伤/命中/抵抗在游戏里本来就可能是 0，
        //   拿"非 0"当判据会把合法面板误判成没填（第一版就是这么错的：8/80）。
        panelFilled: ["attack", "hp", "defense", "speed"].filter(x => Number((u.stats as any)[x]) > 0).length,
        soul: u.soulId == null ? null : { id: u.soulId, resolved: k.soulDefs.has(u.soulId), support: soulSupport as any },
        skills: info.skillDetails.map(s => ({
          ...s, confidence: s.confidence as any,
          // Betting mode: hand-written kit / never-cast gate (compile/betting-coverage.ts) and the English name.
          ...(betting ? { label: skillText(s.skillId, "name", s.name), kit: bettingKitSkillOf(s.skillId), neverCast: bettingNeverCastOf(s.skillId) } : {}),
        })),
        ai: handAI
          // The hand-written rule decides every turn: the KB rules (and their unparseable conditions) never run.
          ? { dataPresent: k.aiById.has(u.shikigamiId), unresolvedConds: 0, compiled: true, confidence: "HIGH" as any, gameVerified: false, handWritten: handAI }
          : { dataPresent: k.aiById.has(u.shikigamiId), unresolvedConds: (info as any).aiUnresolvedConds ?? 0, compiled: info.aiConfidence !== "NONE" && info.aiConfidence !== "LOW", confidence: info.aiConfidence as any, gameVerified: false },
      });
      // 本局会用到的能力：从这个单位技能的解析结果推
      for (const s of info.skillDetails) {
        if (s.parsed.damage) capUse.set("DAMAGE", (capUse.get("DAMAGE") ?? 0) + s.parsed.damage);
        if (s.parsed.heal) capUse.set("HEAL", (capUse.get("HEAL") ?? 0) + s.parsed.heal);
        if (s.parsed.shield) capUse.set("SHIELD", (capUse.get("SHIELD") ?? 0) + s.parsed.shield);
        if (s.parsed.timeline) capUse.set("PULL", (capUse.get("PULL") ?? 0) + s.parsed.timeline);
        if (s.parsed.status) capUse.set("CONTROL", (capUse.get("CONTROL") ?? 0) + s.parsed.status);
        if (s.parsed.orb) capUse.set("ORB", (capUse.get("ORB") ?? 0) + s.parsed.orb);
      }
    }
  }

  // ★ 「有N%概率…」的归因歧义必须进入 Fidelity —— 否则"必定施加"会伪装成已建模。
  //   这是本局实际的**过度施加**处数，属于 MECHANIC 层的真实缺口。
  const probAmbiguous = units.reduce((s, u) => s + u.skills.reduce((a, sk) => a + (sk.probAmbiguous ?? 0), 0), 0);
  const probAttributed = units.reduce((s, u) => s + u.skills.reduce((a, sk) => a + (sk.probAttributed ?? 0), 0), 0);
  if (probAttributed || probAmbiguous) {
    capUse.set("STATUS_PROBABILITY", probAttributed + probAmbiguous);
  }
  // 持续回合同理：原文写了但归因不出 → 只能退回印记描述或 1 回合，属于已知偏差。
  const durationStated = units.reduce((s, u) => s + u.skills.reduce((a, sk) => a + (sk.durationStated ?? 0), 0), 0);
  const durationAmbiguous = units.reduce((s, u) => s + u.skills.reduce((a, sk) => a + (sk.durationAmbiguous ?? 0), 0), 0);
  if (durationStated || durationAmbiguous) {
    capUse.set("EFFECT_DURATION", durationStated + durationAmbiguous);
  }

  const capabilities = [...capUse.entries()].map(([name, useCount]) => ({
    name, useCount,
    // 矩阵里没有的能力如实标 UNKNOWN→按 NONE 处理会让分类过重；这里标 PARTIAL 并让 gap 说明"未登记"
    support: (CAP_SUPPORT[name] ?? "PARTIAL") as "FULL" | "PARTIAL" | "NONE",
  }));
  if (durationAmbiguous > 0) {
    const c = capabilities.find(x => x.name === "EFFECT_DURATION");
    if (c) c.support = "PARTIAL";
  } else {
    const c = capabilities.find(x => x.name === "EFFECT_DURATION");
    if (c) c.support = "FULL";
  }
  // 有歧义就是 PARTIAL（能掷骰的部分已实现，归因不出的部分仍在"必定施加"）
  if (probAmbiguous > 0) {
    const c = capabilities.find(x => x.name === "STATUS_PROBABILITY");
    if (c) c.support = "PARTIAL";
  } else if (probAttributed > 0) {
    const c = capabilities.find(x => x.name === "STATUS_PROBABILITY");
    if (c) c.support = "FULL";
  }

  const input: FidelityInput = {
    units,
    ruleset: [
      { id: strat.startup.id, status: strat.startup.status },
      { id: strat.triggerPriority.id, status: strat.triggerPriority.status },
      { id: strat.death.id, status: strat.death.status },
      { id: strat.endgame.id, status: strat.endgame.status },
      { id: strat.resource.id, status: strat.resource.status },
    ],
    capabilities,
    displayPrecision: "INTEGER_OBSERVED",
    ...(betting ? {
      lang: "en" as const,
      resist: policies?.resist ? { id: String(policies.resist.id), status: String(policies.resist.status ?? "HYPOTHESIS") } : null,
      rulesetNotes: strat.endgame?.note ? [String(strat.endgame.note)] : [],
    } : {}),
  };
  return assessFidelity(input);
}
function ci(w: [number, number]) { return { low: w[0], high: w[1] }; }
function safeJson(x: any) { try { return JSON.parse(JSON.stringify(x, (kk, vv) => (typeof vv === "function" ? undefined : vv))); } catch { return undefined; } }

/**
 * ★ G5/§45：逐单位贡献直接读**引擎自己的统计**，不再事后从 trace 里刨。
 * 好处有两个：① NONE 档（不记事件）也能拿到完整贡献数据；
 * ② 统计口径只有一处（引擎），不会出现"trace 少一条事件，统计就少一块"。
 */
function accumulateStats(a: any, acc: Map<string, PerUnitStats>, idMap: Map<number, any>) {
  const st = a.battle.stats;
  for (const [eid, m] of idMap) {
    const p = acc.get(m.unitId);
    if (!p) continue;
    p.avgDamageDealt += st.damageDealt.get(eid) ?? 0;
    p.avgDamageTaken += st.damageTaken.get(eid) ?? 0;
    p.avgHealing += st.healing.get(eid) ?? 0;
    p.kills += st.kills.get(eid) ?? 0;
    p.deaths += st.deaths.get(eid) ?? 0;
    p.avgActions += st.actions.get(eid) ?? 0;
    const usage = st.skillUsage.get(eid);
    if (usage) for (const [name, n] of usage) p.skillUsage[name] = (p.skillUsage[name] ?? 0) + n;
  }
}

function renderEvent(e: any, nm: (id: any) => string): string {
  switch (e.t) {
    case "DAMAGE": return `${nm(e.src)} → ${nm(e.dst)} ${e.applied} damage${e.crit ? " (Crit)" : ""}${e.absorbed ? ` (${e.absorbed} absorbed)` : ""}`;
    case "HP_LOSS": return `${nm(e.dst)} loses ${e.amount} HP`;
    case "DEATH": return `${nm(e.id)} is defeated (by ${nm(e.killer)})`;
    case "LETHAL": return `${nm(e.id)} takes lethal damage (${e.hp} left)`;
    case "DEATH_PREVENTED": return `${nm(e.id)}: lethal damage prevented`;
    case "REVIVE": return `${nm(e.id)} revives (${e.hp} HP)`;
    case "TRANSFORMED": return `${nm(e.id)} transforms, immune to this death`;
    case "STATUS_EXPIRE": return /CONSUMED|SPENT/.test(String(e.reason ?? ""))
      ? `${nm(e.id)}: ${e.status} consumed (${e.reason})`
      : `${nm(e.id)}: ${e.status} expired`;
    case "ORB_INIT": return `Initial Onibi Red ${JSON.stringify(e.red)} / Blue ${JSON.stringify(e.blue)}`;
    case "ORB_REWARD": return `${e.team === 0 ? "Red" : "Blue"} gains ${e.gained} Onibi${e.overflow ? ` (${e.overflow} overflow)` : ""}`;
    default: return e.t + (e.note ? " " + e.note : "");
  }
}
