<script setup lang="ts">
// App.vue — UI 2.0 外壳（a1-4 §29-§34）
// §31 布局：Header → 红蓝横排阵容 → Validation → Simulation Control → Result
// §34 两条运行模式：模拟胜率 / 观看一场
// §29 只重做视觉层与布局，**不动** contracts / stores / adapters / workers / components 的分层
import { computed, onErrorCaptured, ref, watch } from "vue";
import { useMatchStore } from "./stores/match";
import { useSimulationStore } from "./stores/simulation";
import { canonicalMatch } from "./mock/canonical-match";
import UnitTile from "./components/lineup/UnitTile.vue";
import ShikigamiSelector from "./components/lineup/ShikigamiSelector.vue";
import SoulSelector from "./components/lineup/SoulSelector.vue";
import HealthCheck from "./components/simulation/HealthCheck.vue";
import FidelityPanel from "./components/simulation/FidelityPanel.vue";
import DetailDrawer from "./components/knowledge/DetailDrawer.vue";
import CodexView from "./components/knowledge/CodexView.vue";
import MechanicsView from "./components/mechanics/MechanicsView.vue";
import JsonIo from "./components/common/JsonIo.vue";
import ScreenshotImport from "./components/common/ScreenshotImport.vue";
import DeveloperHud from "./components/dev/DeveloperHud.vue";
import ResultDashboard from "./components/result/ResultDashboard.vue";
import ReplayViewer from "./components/result/ReplayViewer.vue";
import BattleTheater from "./components/theater/BattleTheater.vue";
import { panelPrefill } from "./kb/useKb";
import type { ShikigamiIndexEntry, SoulIndexEntry } from "./kb/useKb";
import type { StatKey, GuessingMatch, GuessingUnitInput } from "./contracts/guessing-match";
import { MatchSourceType } from "./contracts/guessing-match";
// ★★★ 第 138 轮（§33）：Per-Match Fidelity 的**逐技能**一层直接进阵容编辑器 ——
//   卡面拿它显示「●3 ◐1」，抽屉拿它显示 Raw 与 Compiled 并排。取数逻辑在 contracts/fidelity-view.ts（可单测）。
import { skillStatusOf } from "./contracts/fidelity-view.ts";

const match = useMatchStore();
const sim = useSimulationStore();

type View = "sim" | "theater" | "replay" | "codex" | "mechanics";
const view = ref<View>("sim");
const VIEWS: Array<{ id: View; label: string }> = [
  { id: "sim", label: "Workbench" }, { id: "theater", label: "Watch Battle" },
  { id: "replay", label: "Event Replay" }, { id: "codex", label: "Codex" }, { id: "mechanics", label: "Mechanics Lab" },
];
/** §34：两条运行模式 */
const mode = ref<"winrate" | "watch">("winrate");

/**
 * ★★★ 第 256 轮：**这一层也要有错误出口**。
 *   用户截图里「观看战斗」整块空白 —— 组件级 SSR / 逐帧 Presenter / Worker 三种探针全绿，
 *   说明那个空白是**渲染树里抛了异常而没人接**（Vue 把子树卸掉，页面就只剩空的）。
 *   这里接住子树的异常并**画出来**：空白页从此变成一句能截图的话。
 */
const crash = ref<string | null>(null);
onErrorCaptured((err, _inst, info) => {
  crash.value = info + ": " + ((err as any)?.message ?? String(err));
  console.error("[engine-ui][App] " + crash.value, err);
  return false;   // 已经画出来了，不再往上冒（全局那一层留给渲染树之外的错误）
});

const target = ref<{ side: "red" | "blue"; index: number } | null>(null);
const soulTarget = ref<{ side: "red" | "blue"; index: number } | null>(null);
/**
 * ★ 第 138 轮：抽屉要能回答「这个单位的逐技能编译状态」——所以除 unit 外还得记住它是哪一边、第几个。
 *   只按名字找是不行的：同一只式神可以合法地出现在双方（对弈两边各 5 只）。
 */
const drawer = ref<{ unit: GuessingUnitInput | null; tab: "skills" | "ai" | "soul"; side: "red" | "blue"; index: number }>({ unit: null, tab: "skills", side: "red", index: 0 });
const activeTile = ref<string | null>(null);
const ioError = ref<string | null>(null);
const hudOpen = ref(false);

const filled = computed(() => match.filledCount);
const unknownCount = computed(() => sim.validation?.strategySnapshot.unknownCount ?? null);
const engineReady = computed(() => !!sim.validation);

function openSelector(side: "red" | "blue", index: number) { target.value = { side, index }; }
function openSoul(side: "red" | "blue", index: number) { soulTarget.value = { side, index }; }
function pickShikigami(x: ShikigamiIndexEntry) {
  if (!target.value) return;
  const { side, index } = target.value;
  const u = match.unit(side, index);
  const untouched = !u.shikigamiId || (u.stats.attack === 0 && u.stats.hp === 0 && u.stats.defense === 0 && u.stats.speed === 0);
  match.setShikigami(side, index, x.i, x.n);
  if (untouched) {
    const pre = panelPrefill(x.i);
    if (pre) for (const [k, v] of Object.entries(pre)) match.setStat(side, index, k as StatKey, v);
  }
  target.value = null;
  activeTile.value = side + index;
  refreshValidation();
}
function pickSoul(s: SoulIndexEntry | null) {
  if (!soulTarget.value) return;
  match.setSoul(soulTarget.value.side, soulTarget.value.index, s ? s.i : null);
  soulTarget.value = null;
  refreshValidation();
}
function openDetail(side: "red" | "blue", index: number, tab: "skills" | "ai" | "soul") {
  drawer.value = { unit: match.unit(side, index), tab, side, index };
}
/**
 * ★★★ 第 138 轮：某个单位的逐技能编译状态。
 *   判据是 **side + 名字**（不是 index）：Fidelity 载荷按「红/蓝 + 式神名」组织，
 *   而名字是对弈里唯一稳定、也是报告里点名用的标识。
 */
/** Engine view of a unit's AI / soul support (hand-written betting AI and souls count as the battle runs them). */
function unitSupportFor(side: "red" | "blue", name: string) {
  return (sim.validation?.units ?? []).find(x => x.side === side && x.name === name) ?? null;
}
function skillStatusFor(side: "red" | "blue", name: string) {
  return skillStatusOf(sim.validation?.fidelity ?? null, side, name);
}

let timer: any = null;
function refreshValidation() { clearTimeout(timer); timer = setTimeout(() => sim.validate(match.match), 400); }
watch(() => JSON.stringify(match.match.red.units.map(u => [u.shikigamiId, u.soulId, u.stats])), refreshValidation);
watch(() => JSON.stringify(match.match.blue.units.map(u => [u.shikigamiId, u.soulId, u.stats])), refreshValidation);

function loadFixture() { match.replace(canonicalMatch()); refreshValidation(); }
function onImport(m: GuessingMatch) { match.replace(m); ioError.value = null; refreshValidation(); }
/** Import from screenshot: one reviewed table replaces that team's five units (the other team is kept). */
function onScreenshotApply(p: { side: "red" | "blue"; units: GuessingUnitInput[] }) {
  const now = new Date().toISOString();
  match.replace({
    ...match.match, [p.side]: { units: p.units },
    source: { type: MatchSourceType.SCREENSHOT, capturedAt: now, note: "Imported from Lineup screenshot" }, updatedAt: now,
  });
  ioError.value = null;
  refreshValidation();
}
function swap() { match.swap(); refreshValidation(); }

const simCount = ref(10000);
const adaptive = ref(false);
function run() {
  if (adaptive.value) { adaptive.value = false; runAdaptive(); return; }
  sim.simulate(match.match, { simulations: simCount.value, seed: "AUTO", progressEvery: 500 });
}
/** 自适应：先跑 1k，Wilson 区间仍宽于 6 个百分点就再加到 10k —— 省时间又不假装精确 */
async function runAdaptive() {
  sim.simulate(match.match, { simulations: 1000, seed: "AUTO", progressEvery: 250 });
  const wait = setInterval(() => {
    if (sim.running || !sim.result) return;
    clearInterval(wait);
    const ci = sim.result.confidenceInterval;
    const width = ci ? (ci.high - ci.low) * 100 : 100;
    if (width > 6 && sim.result.simulations < 10000) {
      sim.simulate(match.match, { simulations: 10000, seed: "AUTO", progressEvery: 500 });
    }
  }, 250);
}
const theaterSeed = ref(20261001);
function watchOne(seed: number) { theaterSeed.value = seed; view.value = "theater"; sim.replay(match.match, seed); }
/**
 * ★★★ 第 256 轮：**「观看战斗」这个标签页以前只切视图** —— 没录过录像时就只剩一句
 *   「还没有可观看的战斗。」（用户实测报的就是这个：点了却看不了）。
 *   现在它走 store 的 `watchOrReplay`：有录像只切视图（不重复录），没录像**当场录一场**。
 */
function openTheater() { view.value = "theater"; sim.watchOrReplay(match.match, theaterSeed.value); }
function openReplay(seed: number) { view.value = "replay"; sim.replay(match.match, seed); }
function startMode() { if (mode.value === "watch") watchOne(theaterSeed.value); else run(); }
</script>

<template>
  <div class="shell">
    <header class="top">
      <div class="brand">
        <span class="crest">⛩</span>
        <span>Onmyoji · Duel Betting Simulator</span>
        <span class="ver mono">Engine v0.1 · GameData 2026-10</span>
      </div>
      <nav>
        <!-- ★ 第 256 轮：「观看战斗」这个标签走 openTheater（没录像就当场录一场），其余标签只切视图 -->
        <button v-for="v in VIEWS" :key="v.id" class="tab" :class="{ active: view === v.id }"
                @click="v.id === 'theater' ? openTheater() : (view = v.id)">{{ v.label }}</button>
      </nav>
      <div class="hud">
        <span class="badge" :class="unknownCount === 0 ? 'ok' : 'warn'"
              :title="unknownCount === null ? 'Engine check not run yet' : 'UNKNOWN mechanic policies present — results are not mechanic conclusions'">
          ⚠ {{ unknownCount === null ? "UNKNOWN not evaluated" : unknownCount + " UNKNOWN" }}
        </span>
        <span class="badge" :class="engineReady ? 'ok' : 'dim'">{{ engineReady ? "Engine ready" : "Awaiting check" }}</span>
        <button class="tab hudbtn" :class="{ active: hudOpen }" @click="hudOpen = !hudOpen">HUD</button>
      </div>
    </header>

    <!-- ★ 第 256 轮：子树抛异常时，这里必须出现一句看得见的话（而不是整块空白） -->
    <div v-if="crash" class="errbar" style="margin:10px 16px">
      ⚠ UI error ({{ crash }}) — shown automatically so errors are never silent. Send a screenshot of this to the maintainer.
      <button @click="crash = null" style="margin-left:8px">✕</button>
    </div>

    <template v-if="view === 'sim'">
      <!-- §34：两条运行模式 -->
      <div class="modebar">
        <button class="mode" :class="{ on: mode === 'winrate' }" @click="mode = 'winrate'">
          <b>Simulate win rate</b><span class="tiny dim">Run N battles; see win rate and uncertainty</span>
        </button>
        <button class="mode" :class="{ on: mode === 'watch' }" @click="mode = 'watch'">
          <b>Watch one battle</b><span class="tiny dim">Record a full battle and step through mechanics frame by frame</span>
        </button>
        <span class="spacer" />
        <button @click="loadFixture">Load sample match #001</button>
        <JsonIo :match="match.match" @import="onImport" @swap="swap" @error="(e: string) => ioError = e" />
        <ScreenshotImport @apply="onScreenshotApply" />
        <button @click="match.reset()">Clear</button>
        <span class="dim small">Filled <b class="mono">{{ filled }}</b>/10</span>
        <span v-if="match.savedAt" class="dim tiny">Draft saved</span>
      </div>
      <div v-if="ioError" class="errbar">✗ {{ ioError }} <button @click="ioError = null">✕</button></div>

      <!-- §31：红蓝横排（更像游戏阵容，也省纵向空间） -->
      <main class="board">
        <section class="row red">
          <div class="sidehead">🔴 Red</div>
          <div class="tiles">
            <UnitTile v-for="(u, i) in match.match.red.units" :key="u.unitId" :unit="u" side="red" :index="i"
              :active="activeTile === 'red' + i" :skill-status="skillStatusFor('red', u.name)" :support="unitSupportFor('red', u.name)"
              @open-selector="openSelector('red', i)" @open-soul="openSoul('red', i)"
              @clear="match.clearUnit('red', i); refreshValidation()"
              @set-stat="(k: StatKey, v: number) => { match.setStat('red', i, k, v) }"
              @open-detail="(t: 'skills' | 'ai' | 'soul') => openDetail('red', i, t)"
              @activate="activeTile = 'red' + i" />
          </div>
        </section>

        <div class="vs">VS</div>

        <section class="row blue">
          <div class="sidehead">Blue 🔵</div>
          <div class="tiles">
            <UnitTile v-for="(u, i) in match.match.blue.units" :key="u.unitId" :unit="u" side="blue" :index="i"
              :active="activeTile === 'blue' + i" :skill-status="skillStatusFor('blue', u.name)" :support="unitSupportFor('blue', u.name)"
              @open-selector="openSelector('blue', i)" @open-soul="openSoul('blue', i)"
              @clear="match.clearUnit('blue', i); refreshValidation()"
              @set-stat="(k: StatKey, v: number) => { match.setStat('blue', i, k, v) }"
              @open-detail="(t: 'skills' | 'ai' | 'soul') => openDetail('blue', i, t)"
              @activate="activeTile = 'blue' + i" />
          </div>
        </section>
      </main>

      <!-- Validation：健康检查 + 本局可信度（§33） -->
      <section class="validation">
        <HealthCheck :match="match.match" :report="sim.validation" />
        <FidelityPanel :fidelity="sim.validation?.fidelity ?? null" />
      </section>

      <!-- Simulation Control -->
      <section class="control">
        <div class="ctlrow">
          <span class="ctllabel">Simulations</span>
          <button v-for="n in [100, 1000, 10000]" :key="n" class="nbtn" :class="{ on: !adaptive && simCount === n }"
                  @click="adaptive = false; simCount = n">{{ n >= 1000 ? n / 1000 + "k" : n }}</button>
          <button class="nbtn" :class="{ on: adaptive }" @click="adaptive = true" title="Run 1k first; extend to 10k if the interval is too wide">Adaptive</button>
          <span class="spacer" />
          <label v-if="mode === 'watch'" class="seed">seed <input type="number" v-model.number="theaterSeed" style="width:110px" /></label>
          <button class="primary big" :disabled="sim.running || filled < 10" @click="startMode">
            {{ mode === "watch" ? "▶ Watch this battle" : "▶ Start simulation" }}
          </button>
          <button v-if="sim.running" @click="sim.cancel()">Stop</button>
        </div>
        <div v-if="sim.progress" class="prog">
          <div class="bar"><i :style="{ width: sim.percent + '%' }"></i></div>
          <div class="mono tiny dim">{{ sim.progress.completed.toLocaleString() }} / {{ sim.progress.total.toLocaleString() }}
            <template v-if="sim.progress.runningRedWinRate !== null"> · Red {{ (sim.progress.runningRedWinRate * 100).toFixed(1) }}%</template>
          </div>
        </div>
        <div v-if="sim.error" class="errbox">✗ {{ sim.error }}</div>
      </section>

      <div v-if="sim.result || sim.running" class="resultwrap">
        <ResultDashboard v-if="sim.result" :result="sim.result" :fidelity="sim.validation?.fidelity ?? null"
                         @replay="openReplay" @watch="watchOne" @close="sim.result = null" />
      </div>
    </template>

    <template v-else-if="view === 'theater'">
      <div class="page">
        <BattleTheater v-if="sim.replayFile" :replay="sim.replayFile" :seed="theaterSeed" @close="view = 'sim'" />
        <div v-else class="empty">
          <!-- ★ 第 256 轮：三种状态分开说 —— 「正在录」不再是空白等待，「录失败」也不再冒充「还没有」 -->
          <p v-if="sim.replayPending">Recording this battle… (seed <b class="mono">{{ theaterSeed }}</b>)</p>
          <p v-else-if="sim.error" class="errbar">✗ Recording failed: {{ sim.error }}</p>
          <p v-else>No battle to watch yet.</p>
          <p class="dim small">Record one via [Workbench → Watch one battle], or click "Watch battle" on a sample match in the results.</p>
          <div class="seedbox">
            <input type="number" v-model.number="theaterSeed" placeholder="Enter seed" />
            <button :disabled="filled < 10 || sim.replayPending" @click="openTheater()">Watch this battle</button>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="view === 'replay'">
      <div class="page">
        <ReplayViewer v-if="sim.replayData" :seed="sim.replayData.seed" :events="sim.replayData.events" :units="sim.replayData.units"
                      :turns="sim.replayData.turns" :winner="sim.replayData.winner as any" @close="view = 'sim'" />
        <div v-else class="empty">
          <p>No match to replay yet.</p>
          <div class="seedbox">
            <input type="number" v-model.number="theaterSeed" placeholder="Enter seed" />
            <button :disabled="filled < 10" @click="openReplay(theaterSeed)">Replay by seed</button>
          </div>
        </div>
      </div>
    </template>

    <template v-else-if="view === 'codex'"><div class="page"><CodexView /></div></template>
    <template v-else><div class="page"><MechanicsView /></div></template>

    <DeveloperHud :open="hudOpen" @close="hudOpen = false" />
    <ShikigamiSelector :open="!!target" @pick="pickShikigami" @close="target = null" />
    <SoulSelector :open="!!soulTarget" @pick="pickSoul" @close="soulTarget = null" />
    <DetailDrawer :open="!!drawer.unit" :unit="drawer.unit" :tab="drawer.tab"
      :skill-status="drawer.unit ? skillStatusFor(drawer.side, drawer.unit.name) : []"
      @close="drawer.unit = null" @tab="(t: 'skills' | 'ai' | 'soul') => drawer.tab = t" />
  </div>
</template>

<style scoped>
.shell { display: flex; flex-direction: column; min-height: 100%; }
.top { display: flex; align-items: center; gap: 16px; padding: 8px 16px; background: #171411ee; border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 20; backdrop-filter: blur(6px); }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }
.crest { display: grid; place-items: center; width: 20px; height: 20px; border: 1px solid var(--gold-dim); border-radius: 50%; color: var(--gold); font-size: 11px; }
.ver { color: var(--fg-faint); font-size: 10.5px; }
nav { display: flex; gap: 2px; margin-left: auto; }
.tab { padding: 4px 11px; border-radius: var(--radius-sm); color: var(--fg-faint); font-size: 12px; background: none; border: 1px solid transparent; }
.tab.active { background: var(--panel2); color: var(--fg); border-color: var(--line); }
.hud { display: flex; gap: 6px; align-items: center; }
.hudbtn { font-family: var(--mono); font-size: 11px; padding: 3px 9px; }
.badge { font-family: var(--mono); font-size: 10.5px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--line); }
.badge.warn { color: var(--warn); border-color: #6b5520; background: #2a2213; }
.badge.ok { color: var(--ok); border-color: #2f5741; background: #16241c; }
.badge.dim { color: var(--fg-faint); }
.modebar { display: flex; align-items: center; gap: 8px; padding: 9px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.mode { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 12px; line-height: 1.25; }
.mode.on { border-color: var(--gold-dim); background: linear-gradient(180deg, #2b2415, #221e19); }
.mode b { font-size: 12.5px; }
.spacer { flex: 1; }
.dim { color: var(--fg-dim); } .small { font-size: 12px; } .tiny { font-size: 10px; }
.errbar { background: #2a1614; border-bottom: 1px solid #6b2f28; color: var(--danger); padding: 6px 16px; font-size: 12px; display: flex; gap: 10px; }
.errbox { background: #2a1614; border: 1px solid #6b2f28; color: var(--danger); padding: 8px 10px; border-radius: var(--radius-sm); font-size: 12px; }
/* §31 布局：横排 */
.board { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: start; padding: 14px 16px 4px; max-width: 1720px; margin: 0 auto; width: 100%; }
.row { display: flex; flex-direction: column; gap: 6px; }
.sidehead { font-size: 11.5px; color: var(--fg-dim); }
.row.blue .sidehead { text-align: right; }
.tiles { display: flex; gap: 8px; flex-wrap: wrap; }
.row.blue .tiles { justify-content: flex-end; }
.vs { align-self: center; color: var(--gold-dim); font-family: var(--mono); font-size: 13px; letter-spacing: 2px; padding: 0 4px; }
.validation { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 8px 16px; max-width: 1720px; margin: 0 auto; width: 100%; }
.control { padding: 6px 16px 10px; max-width: 1720px; margin: 0 auto; width: 100%; }
.ctlrow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ctllabel { font-size: 11px; color: var(--fg-faint); }
.nbtn { font-size: 11.5px; padding: 3px 10px; }
.nbtn.on { background: linear-gradient(180deg, #4a6f96, #35526f); border-color: #5b83aa; }
.seed { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--fg-faint); }
.big { padding: 7px 18px; font-size: 13px; font-weight: 600; }
.prog { margin-top: 6px; }
.prog .bar { height: 4px; background: #0e0c0a; border-radius: 2px; overflow: hidden; margin-bottom: 3px; }
.prog .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--red), var(--gold), var(--blue)); }
.resultwrap { max-width: 1720px; margin: 0 auto 22px; padding: 0 16px; width: 100%; }
.page { max-width: 1720px; margin: 0 auto; padding: 16px; width: 100%; }
.empty { padding: 40px; text-align: center; color: var(--fg-dim); }
.seedbox { display: flex; gap: 8px; justify-content: center; margin-top: 12px; }
@media (max-width: 1439px) { .validation { grid-template-columns: 1fr; } }
@media (max-width: 1023px) { .board { grid-template-columns: 1fr; } .vs { display: none; } }
</style>
