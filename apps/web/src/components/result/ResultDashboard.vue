<script setup lang="ts">
// components/result/ResultDashboard.vue — UI-3 结果仪表盘
// 四层结构（文档 §9）：结果摘要 → 不确定性 → 逐单位贡献 → 样本对局
// 原则：抽样误差与模型不确定性**分开展示**，绝不混成一个「置信度」数字。
import { computed, onMounted, ref } from "vue";
import type { SimulationResult } from "../../contracts/simulation-result.ts";
import { isConclusionReady } from "../../contracts/simulation-result.ts";
import FidelityPanel from "../simulation/FidelityPanel.vue";
import { displayName } from "../../kb/names.ts";
import { enEngine, enSkill } from "../../kb/en-engine.ts";

/**
 * 红区说明表（懒加载，来自机制实验台生成的红区登记）。
 * 目的：界面上红色的 UNKNOWN **必须能点开看到"为什么"** ——
 * 「竞猜残局 UNKNOWN」如果不给原因，用户只会看到一片红而不知道是谁的锅。
 */
interface ZoneNote { zone: string; question: string; evidence: string; status: string }
const zoneNotes = ref<Record<string, ZoneNote>>({});
const expanded = ref<string | null>(null);
onMounted(async () => {
  try {
    const mod: any = await import("../../kb/experiments.json");
    const zones: any[] = (mod.default ?? mod).redZones ?? [];
    const map: Record<string, ZoneNote> = {};
    for (const z of zones) map[z.id] = { zone: z.zone, question: z.question ?? "", evidence: z.evidence ?? "", status: z.status };
    zoneNotes.value = map;
  } catch { /* 拿不到说明表时只显示 id 与状态，绝不瞎编原因 */ }
});

const props = defineProps<{ result: SimulationResult; fidelity?: unknown | null; /** start tab (static rendering / tests) */ initialTab?: "outcome" | "uncertainty" | "units" | "samples" }>();
const emit = defineEmits<{ (e: "replay", seed: number): void; (e: "watch", seed: number): void; (e: "close"): void }>();

type Tab = "outcome" | "uncertainty" | "units" | "samples";
const tab = ref<Tab>(props.initialTab ?? "outcome");
const pct = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "—" : (x * 100).toFixed(d) + "%");
const num = (x: number) => x.toLocaleString();

const copied = ref(false);
async function copyJson() {
  try { await navigator.clipboard.writeText(JSON.stringify(props.result, null, 1)); copied.value = true; setTimeout(() => (copied.value = false), 1500); }
  catch { copied.value = false; }
}

const r = computed(() => props.result);
const ready = computed(() => isConclusionReady(props.result));
const ci = computed(() => r.value.confidenceInterval);
const mu = computed(() => r.value.modelUncertainty);

/** Wilson 区间可视化：点估计 + 区间带，坐标 0..1 */
const ciBand = computed(() => {
  const c = ci.value;
  if (!c) return null;
  return { left: (c.low * 100).toFixed(2), width: ((c.high - c.low) * 100).toFixed(2), point: ((r.value.redWinRate ?? 0) * 100).toFixed(2) };
});
/** 与 50% 的关系：区间是否跨过五五开 —— 这是"能不能说红方更强"的唯一依据 */
const crosses50 = computed(() => !!ci.value && ci.value.low <= 0.5 && ci.value.high >= 0.5);
const verdictWord = computed(() => {
  if (!ci.value || r.value.redWinRate === null) return "Not enough samples to judge";
  if (crosses50.value) return "No significant difference between Red and Blue (interval crosses 50%)";
  return r.value.redWinRate > 0.5 ? "Red is significantly stronger" : "Blue is significantly stronger";
});

/** 5 个红区的可解释行：状态 + 为什么是这个状态 */
const policyRows = computed(() => {
  const s = r.value.strategySnapshot;
  return [
    { label: "Start-of-battle order", id: s.startup.id, status: s.startup.status },
    { label: "Simultaneous trigger priority", id: s.triggerPriority.id, status: s.triggerPriority.status },
    { label: "Death / transform", id: s.death.id, status: s.death.status },
    { label: "Betting endgame", id: s.endgame.id, status: s.endgame.status },
    { label: "Onibi start & regen", id: s.resource.id, status: s.resource.status },
  ];
});
const unknownRows = computed(() => policyRows.value.filter(x => x.status === "UNKNOWN"));

const units = computed(() => [...r.value.battleStats.perUnit].sort((a, b) => b.avgDamageDealt - a.avgDamageDealt));
const maxDmg = computed(() => Math.max(1, ...units.value.map(u => u.avgDamageDealt)));
const topSkills = (u: any) => Object.entries(u.skillUsage ?? {}).sort((a: any, b: any) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${enSkill(k)}×${v}`).join(" · ") || "—";
const SEV: Record<string, string> = { BLOCK: "danger", WARN: "warn", INFO: "dim" };
</script>

<template>
  <section class="dash">
    <header class="head">
      <b>Simulation results</b>
      <span class="mono tiny dim">{{ r.engineVersion }} · data {{ r.gameDataVersion }} · N={{ num(r.simulations) }}</span>
      <span class="badge" :class="ready.ready ? 'ok' : 'warn'">
        {{ ready.ready ? "Conclusive" : "Not conclusive" }}
      </span>
      <span class="spacer" />
      <button class="tiny-btn" @click="copyJson">{{ copied ? "Copied ✓" : "Copy result JSON" }}</button>
      <button class="x" @click="emit('close')">✕</button>
    </header>

    <nav class="tabs">
      <button :class="{ on: tab === 'outcome' }" @click="tab = 'outcome'">① Summary</button>
      <button :class="{ on: tab === 'uncertainty' }" @click="tab = 'uncertainty'">② Uncertainty <i v-if="r.warnings.length" class="dot" /></button>
      <button :class="{ on: tab === 'units' }" @click="tab = 'units'">③ Per-unit contribution</button>
      <button :class="{ on: tab === 'samples' }" @click="tab = 'samples'">④ Sample battles</button>
    </nav>

    <!-- ① 结果摘要 -->
    <div v-if="tab === 'outcome'" class="body">
      <div class="two">
        <div class="side red">
          <div class="lab">Red win rate</div>
          <div class="big">{{ pct(r.redWinRate) }}</div>
          <div class="mono small dim">{{ num(r.redWins) }} wins</div>
        </div>
        <div class="side blue">
          <div class="lab">Blue win rate</div>
          <div class="big">{{ pct(r.blueWinRate) }}</div>
          <div class="mono small dim">{{ num(r.blueWins) }} wins</div>
        </div>
      </div>

      <!-- Tug of war: Red share of decisive battles, with the Wilson 95% band and the 50% line -->
      <div v-if="r.redWinRate !== null" class="tug" role="img"
           :aria-label="'Red ' + pct(r.redWinRate) + ' vs Blue ' + pct(r.blueWinRate) + (ci ? ', 95% interval ' + pct(ci.low) + ' to ' + pct(ci.high) : '')">
        <div class="tugtrack">
          <div class="tugred" :style="{ width: (r.redWinRate * 100).toFixed(2) + '%' }" />
          <div v-if="ciBand" class="tugband" :style="{ left: ciBand.left + '%', width: ciBand.width + '%' }" />
          <div class="tugmid" />
        </div>
        <div class="tugscale mono"><span>Red</span><span>50%</span><span>Blue</span></div>
      </div>

      <div class="verdict" :class="crosses50 ? 'warn' : 'ok'">{{ verdictWord }}</div>

      <div class="grid4">
        <div class="cell"><span class="k">Decisive battles</span><b class="mono">{{ num(r.decisive) }}</b><span class="tiny dim">unfinished battles are excluded</span></div>
        <div class="cell"><span class="k">Unfinished</span><b class="mono">{{ num(r.timeouts) }}</b><span class="tiny dim">turn limit exceeded</span></div>
        <div class="cell"><span class="k">Draws</span><b class="mono">{{ num(r.draws) }}</b><span class="tiny dim">both wiped out</span></div>
        <div class="cell"><span class="k">Errors</span><b class="mono" :class="{ bad: r.errors > 0 }">{{ num(r.errors) }}</b><span class="tiny dim">never counted</span></div>
      </div>

      <div class="grid4">
        <div class="cell"><span class="k">Avg turns</span><b class="mono">{{ r.battleStats.avgTurns }}</b></div>
        <div class="cell"><span class="k">Median turns</span><b class="mono">{{ r.battleStats.medianTurns }}</b></div>
        <div class="cell"><span class="k">p95 turns</span><b class="mono">{{ r.battleStats.p95Turns }}</b></div>
        <div class="cell"><span class="k">Red first-kill rate</span><b class="mono">{{ pct(r.battleStats.firstKillRedRate, 1) }}</b></div>
      </div>

      <div class="grid4">
        <div class="cell"><span class="k">Red avg survivors</span><b class="mono">{{ r.battleStats.avgSurvivorsRed }}</b></div>
        <div class="cell"><span class="k">Blue avg survivors</span><b class="mono">{{ r.battleStats.avgSurvivorsBlue }}</b></div>
        <div class="cell"><span class="k">Red total HP left</span><b class="mono">{{ num(r.battleStats.avgRemainHpRed) }}</b></div>
        <div class="cell"><span class="k">Blue total HP left</span><b class="mono">{{ num(r.battleStats.avgRemainHpBlue) }}</b></div>
      </div>

      <p class="note">Denominator: Red/Blue win rates are computed over decisive battles = Red wins + Blue wins. Unfinished and errored battles are <b>never</b> in the denominator, so the two rates are not padded to 100%.</p>
    </div>

    <!-- ② 不确定性 -->
    <div v-else-if="tab === 'uncertainty'" class="body">
      <!-- ★ 结果与"本局可信度"必须一起看：不给百分比，只给五层状态分类 -->
      <FidelityPanel :fidelity="fidelity ?? null" />
      <div class="block">
        <h4>Sampling error (shrinks with more simulations)</h4>
        <div v-if="ciBand" class="cibar">
          <div class="track">
            <div class="band" :style="{ left: ciBand.left + '%', width: ciBand.width + '%' }" />
            <div class="mid" />
            <div class="pt" :style="{ left: ciBand.point + '%' }" />
          </div>
          <div class="mono small">Red {{ pct(r.redWinRate) }}, Wilson 95% confidence interval <b>[{{ pct(ci!.low) }}, {{ pct(ci!.high) }}]</b> (width {{ (ci!.high - ci!.low > 0 ? ((ci!.high - ci!.low) * 100).toFixed(2) : "0") }} percentage points)</div>
          <div class="tiny dim">Dashed line = 50%; if the interval crosses it, there is no significant difference between the sides. Interval width only reflects sample size, not whether the mechanics are correct.</div>
        </div>
        <div v-else class="dim small">Not enough samples for an interval.</div>
      </div>

      <div class="block">
        <h4>Model uncertainty (does not shrink with more simulations)</h4>
        <template v-if="mu">
          <div class="verdictbadge" :class="mu.verdict === 'SENSITIVE' ? 'bad' : mu.verdict === 'STABLE' ? 'ok' : 'warn'">
            {{ mu.verdict === "SENSITIVE" ? "Conclusion is sensitive to untested mechanics" : mu.verdict === "STABLE" ? "Conclusion is not sensitive to these assumptions" : "Cannot assess" }}
            <span v-if="mu.spread !== null" class="mono">drift {{ (mu.spread * 100).toFixed(1) }} percentage points</span>
          </div>
          <table class="tbl">
            <thead><tr><th>Assumption</th><th>Group</th><th class="r">Red win rate</th></tr></thead>
            <tbody>
              <tr v-for="(p, i) in mu.perStrategy" :key="i">
                <td>{{ p.label }}<div class="tiny dim">{{ p.note }}</div></td>
                <td class="mono tiny">{{ p.group }}</td>
                <td class="mono r">
                  <span class="minibar" :style="{ width: ((p.redWinRate ?? 0) * 100) + '%' }" />{{ pct(p.redWinRate, 1) }}
                </td>
              </tr>
            </tbody>
          </table>
          <p class="note">These are red-zone mechanics (start order / death resolution / turn limit) that are <b>not yet tested in-game</b>. Under an equally reasonable assumption the win rate drifts — that is the model's limit, not sampling noise. In sample match #001, lowering the turn limit from 600 to 100 drops Red's win rate from 67.0% to 47.6%, because there is still no reliable source for the betting endgame damage ramp.</p>
        </template>
        <div v-else class="dim small">No sensitivity sweep this run (skipped automatically below 800 simulations, to avoid pretending to assess with a tiny sample).</div>
      </div>

      <div class="block">
        <h4>Mechanic policy snapshot (saved with the result)</h4>
        <div class="legend">
          <span><i class="sw unknown" />UNKNOWN — never reliably verified in-game; the engine <b>refuses to guess</b></span>
          <span><i class="sw hypothesis" />HYPOTHESIS — community/doc hints exist, but also untested</span>
          <span><i class="sw verified" />VERIFIED — confirmed by in-game observation</span>
        </div>
        <p v-if="unknownRows.length" class="whyred">
          Red does not mean a bug; it means "<b>the conclusion depends on it</b>":
          <template v-for="(u, i) in unknownRows" :key="u.id">{{ i ? "; " : "" }}{{ u.label }} = <span class="mono">{{ u.id }}</span></template>.
          Click any row to see exactly what is missing.
        </p>
        <div class="policies">
          <template v-for="p in policyRows" :key="p.label">
            <button class="pol" :class="{ open: expanded === p.label }" @click="expanded = expanded === p.label ? null : p.label">
              <span class="k">{{ p.label }}</span>
              <span class="mono tiny">{{ p.id }}</span>
              <span class="st" :class="p.status.toLowerCase()">{{ p.status }}</span>
            </button>
            <div v-if="expanded === p.label" class="poldetail">
              <template v-if="zoneNotes[p.id]">
                <div class="q">{{ enEngine(zoneNotes[p.id].question) || "(source has no question field)" }}</div>
                <div class="ev"><b>Evidence / why this status: </b>{{ enEngine(zoneNotes[p.id].evidence) || "(source has no evidence field)" }}</div>
                <div class="tiny dim">Red zone: {{ enEngine(zoneNotes[p.id].zone) }}</div>
              </template>
              <div v-else class="tiny dim">No note found for this policy — we don't invent a reason; see the red-zone register on the Mechanics Lab page.</div>
            </div>
          </template>
        </div>
        <p class="note">
          UNKNOWN mechanics are never guessed, only flagged. With UNKNOWNs present, results are fine for comparing lineups but are not mechanic conclusions.
          The biggest one is the <b>betting endgame</b>: starting Onibi, the endgame damage-up/healing-down ramp and the timeout winner rule have no reliable 2026 source,
          so the engine leaves the turn limit to you (default 300 turns) and the sensitivity sweep shows directly what changes under other assumptions.
        </p>
      </div>

      <div class="block">
        <h4>Data & model coverage</h4>
        <div class="grid4">
          <div class="cell"><span class="k">Unit data</span><b class="mono">{{ r.coverage.unitsJoined }}/{{ r.coverage.unitsTotal }}</b></div>
          <div class="cell"><span class="k">Skills available</span><b class="mono">{{ r.coverage.skillsAvailable }}/{{ r.coverage.skillsTotal }}</b></div>
          <div class="cell"><span class="k">AI high confidence</span><b class="mono">{{ r.coverage.aiHigh }}/{{ r.coverage.aiTotal }}</b></div>
          <div class="cell"><span class="k">Soul battle effects</span><b class="mono">{{ r.coverage.soulEffectsFull }} full / {{ r.coverage.soulEffectsPartial }} partial</b></div>
        </div>
        <ul v-if="r.coverage.unsupportedCapabilities.length" class="caps">
          <li v-for="(c, i) in r.coverage.unsupportedCapabilities" :key="i">⚠ {{ enEngine(c) }}</li>
        </ul>
      </div>

      <div class="block">
        <h4>Warnings ({{ r.warnings.length }})</h4>
        <div v-for="(w, i) in r.warnings" :key="i" class="warnrow" :class="SEV[w.severity]">
          <span class="sev mono">{{ w.severity }}</span>
          <div>
            <div>{{ enEngine(w.message) }}</div>
            <div v-if="w.detail" class="tiny dim">{{ enEngine(w.detail) }}</div>
          </div>
        </div>
        <div v-if="!r.warnings.length" class="dim small">No warnings.</div>
      </div>

      <div v-if="!ready.ready" class="block">
        <h4>Why "not conclusive"</h4>
        <ul class="caps"><li v-for="(x, i) in ready.reasons" :key="i">· {{ enEngine(x) }}</li></ul>
      </div>
    </div>

    <!-- ③ 逐单位贡献 -->
    <div v-else-if="tab === 'units'" class="body">
      <table class="tbl">
        <thead>
          <tr><th>Unit</th><th class="r">Avg damage</th><th></th><th class="r">Taken</th><th class="r">Kills</th><th class="r">Death rate</th><th class="r">Actions</th><th>Skill usage</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in units" :key="u.unitId" :class="u.side">
            <td><span class="side-dot" :class="u.side" />{{ enEngine(displayName(u.name)) }}</td>
            <td class="mono r">{{ num(u.avgDamageDealt) }}</td>
            <td class="barcell"><span class="minibar" :style="{ width: (u.avgDamageDealt / maxDmg * 100) + '%' }" /></td>
            <td class="mono r">{{ num(u.avgDamageTaken) }}</td>
            <td class="mono r">{{ u.kills }}</td>
            <td class="mono r">{{ (u.deathRate * 100).toFixed(0) }}%</td>
            <td class="mono r">{{ u.avgActions }}</td>
            <td class="tiny dim">{{ topSkills(u) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="note">Per-unit numbers come from the engine's real DAMAGE / DEATH events and action log; metrics the engine does not record (such as Onibi spent) stay 0 and are declared in coverage — never estimated.</p>
    </div>

    <!-- ④ 样本对局 -->
    <div v-else class="body">
      <p class="small dim">These are representative battles that <b>actually occurred</b> in this run. Pick a seed to watch it turn by turn.</p>
      <div class="samples">
        <button v-for="s in r.seeds ?? []" :key="s.seed" class="sample" :class="s.winner" @click="emit('watch', s.seed)">
          <span class="w">{{ s.winner === "red" ? "Red win" : s.winner === "blue" ? "Blue win" : s.winner === "draw" ? "Draw" : "Unfinished" }}</span>
          <span class="mono tiny">seed {{ s.seed }}</span>
          <span class="mono tiny dim">{{ s.turns }} turns</span>
          <span class="go">Watch battle ▶</span>
        </button>
        <div v-if="!(r.seeds ?? []).length" class="dim small">No representative seeds recorded for this result.</div>
      </div>
      <p class="note">The replay re-assembles and runs with <b>exactly the same</b> seed, so it is the same battle, not another sample.</p>
    </div>
  </section>
</template>

<style scoped>
.dash { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; box-shadow: var(--elev-2); }
.head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg, #26211a, #1c1915); }
.head b { font-family: var(--font-display); font-size: 15px; }
.spacer { flex: 1; }
.tiny-btn { font-size: 11px; padding: 3px 8px; }
.badge { font-size: 11px; padding: 2px 9px; border-radius: 999px; border: 1px solid; }
.badge.ok { color: var(--ok); border-color: #2f5741; background: #16241c; }
.badge.warn { color: var(--warn); border-color: #6b5520; background: #2a2213; }
.tabs { display: flex; gap: 2px; padding: 6px 10px 0; border-bottom: 1px solid var(--line); }
.tabs button { background: none; border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 7px 12px; color: var(--fg-faint); font-size: 12px; }
.tabs button:hover:not(:disabled) { color: var(--fg); background: none; }
.tabs button.on { color: var(--fg); border-bottom-color: var(--gold); }
.tabs .dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--warn); vertical-align: super; margin-left: 3px; }
.body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.side { position: relative; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 14px 18px 12px; }
.side.red { border-top: 2px solid var(--red); background: radial-gradient(120% 140% at 0% 0%, #5e272240, transparent 60%), var(--panel2); }
.side.blue { border-top: 2px solid var(--blue); background: radial-gradient(120% 140% at 100% 0%, #243a5255, transparent 60%), var(--panel2); text-align: right; }
.side .lab { font-size: 11.5px; color: var(--fg-faint); text-transform: uppercase; letter-spacing: .08em; }
.side .big { font-family: var(--font-display); font-size: 44px; font-weight: 700; line-height: 1.1; margin: 2px 0; font-variant-numeric: tabular-nums; }
.side.red .big { color: var(--red-text); } .side.blue .big { color: var(--blue-text); }
.tug { display: flex; flex-direction: column; gap: 4px; }
.tugtrack { position: relative; height: 14px; border-radius: 7px; overflow: hidden; background: linear-gradient(90deg, #243a52, var(--blue)); box-shadow: inset 0 1px 2px #000a; }
.tugred { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, var(--red), #c96a5e); box-shadow: 2px 0 0 #100e0c; transition: width var(--dur) var(--ease); }
.tugband { position: absolute; top: 0; bottom: 0; background: #efe8dc33; border-left: 1px solid #efe8dcaa; border-right: 1px solid #efe8dcaa; }
.tugmid { position: absolute; left: 50%; top: -2px; bottom: -2px; border-left: 1px dashed #efe8dccc; }
.tugscale { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--fg-faint); }
.verdict { padding: 10px 14px; border-radius: var(--radius-sm); font-size: 13px; border: 1px solid transparent; }
.verdict.ok { background: #16241c; color: var(--ok); } .verdict.warn { background: #2a2213; color: var(--warn); }
.grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.cell { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; background: var(--panel2); border: 1px solid #ffffff06; border-radius: var(--radius-sm); }
.cell .k { font-size: 11px; color: var(--fg-faint); text-transform: uppercase; letter-spacing: .06em; }
.cell b { font-size: 17px; font-weight: 600; } .cell b.bad { color: var(--danger); }
.block { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.block h4 { margin: 0 0 10px; font-size: 12.5px; color: var(--fg-dim); font-weight: 600; }
.cibar .track { position: relative; height: 22px; background: #0f1116; border-radius: 5px; overflow: hidden; margin-bottom: 8px; }
.cibar .band { position: absolute; top: 0; bottom: 0; background: #2b4a7a88; }
.cibar .pt { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--red); }
.cibar .mid { position: absolute; left: 50%; top: 0; bottom: 0; border-left: 1px dashed var(--fg-faint); }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th { text-align: left; color: var(--fg-faint); font-weight: 500; font-size: 11px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
.tbl td { padding: 6px 8px; border-bottom: 1px solid #1b1f28; }
.tbl .r { text-align: right; }
.tbl tr.red td:first-child { color: #e5a1a1; } .tbl tr.blue td:first-child { color: #a1bde5; }
.side-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; }
.side-dot.red { background: var(--red); } .side-dot.blue { background: var(--blue); }
.barcell { width: 90px; }
.minibar { display: inline-block; height: 6px; border-radius: 3px; background: linear-gradient(90deg, #3a5f96, #7fa8e0); margin-right: 6px; vertical-align: middle; min-width: 2px; }
.verdictbadge { display: flex; gap: 10px; align-items: center; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 10px; }
.verdictbadge.ok { background: #16241c; color: var(--ok); }
.verdictbadge.warn { background: #2a2213; color: var(--warn); }
.verdictbadge.bad { background: #2a1614; color: var(--danger); }
.legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 11px; color: var(--fg-dim); margin-bottom: 8px; }
.legend .sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; }
.sw.unknown { background: var(--danger); } .sw.hypothesis { background: var(--warn); } .sw.verified { background: var(--ok); }
.whyred { background: #2a1614; border-left: 3px solid var(--danger); color: #e3b6b0; font-size: 11.5px; line-height: 1.7; padding: 7px 10px; border-radius: 0 6px 6px 0; margin: 0 0 8px; }
.poldetail { grid-column: 1 / -1; background: var(--panel2); border-radius: 7px; padding: 8px 10px; margin: -2px 0 4px; font-size: 11.5px; line-height: 1.7; }
.poldetail .q { color: var(--fg); }
.poldetail .ev { color: var(--fg-dim); margin-top: 3px; }
.policies { display: flex; flex-direction: column; gap: 5px; }
.pol { display: grid; grid-template-columns: 92px 1fr 90px; gap: 8px; align-items: center; font-size: 12px; width: 100%; text-align: left; }
.pol.open { border-color: var(--blue); }
.pol .k { color: var(--fg-faint); }
.pol .st { font-family: var(--mono); font-size: 10px; text-align: center; padding: 1px 6px; border-radius: 999px; }
.pol .st.unknown { background: #2a1614; color: var(--danger); }
.pol .st.hypothesis { background: #2a2213; color: var(--warn); }
.pol .st.verified { background: #16241c; color: var(--ok); }
.caps { margin: 8px 0 0; padding-left: 16px; font-size: 12px; color: var(--warn); }
.warnrow { display: flex; gap: 9px; padding: 6px 0; border-bottom: 1px solid #1b1f28; font-size: 12px; }
.warnrow .sev { font-size: 10px; padding: 1px 6px; border-radius: 4px; height: fit-content; }
.warnrow.danger .sev { background: #2a1614; color: var(--danger); }
.warnrow.warn .sev { background: #2a2213; color: var(--warn); }
.warnrow.dim .sev { background: var(--panel2); color: var(--fg-faint); }
.samples { display: flex; flex-direction: column; gap: 8px; }
.sample { display: grid; grid-template-columns: 70px 1fr 90px auto; gap: 10px; align-items: center; text-align: left; padding: 10px 12px; }
.sample .w { font-weight: 600; }
.sample.red .w { color: var(--red); } .sample.blue .w { color: var(--blue); }
.sample.timeout .w { color: var(--warn); }
.sample .go { color: var(--blue); font-size: 12px; }
.note { margin: 4px 0 0; font-size: 11px; color: var(--fg-faint); line-height: 1.6; }
.small { font-size: 12px; } .tiny { font-size: 10px; } .dim { color: var(--fg-dim); }
@media (max-width: 900px) { .grid4 { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .two { grid-template-columns: 1fr; } .side.blue { text-align: left; } .side .big { font-size: 36px; } }
</style>
