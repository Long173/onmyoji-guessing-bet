<script setup lang="ts">
// components/dev/DeveloperHud.vue — UI-6 开发者 HUD（可折叠底部抽屉，约 60vh，可滚动）
// 只读观察窗口：版本 / 数据规模 / 本次运行 / 策略快照 / 覆盖度 / 实测事实清单 / 文件地图。
//
// 两条纪律：
//   1) 本组件**不 import 任何引擎模块**：引擎版本号取自 adapters/simulate.ts 的常量，
//      覆盖度与策略快照取自 store 里的 DTO，事实清单取自 dev/facts.ts。
//   2) 能从索引 / store 里算出来的就动态算；算不出来的写「—」并指向事实编号，**不在组件里写死数字**。
import { computed, onMounted, ref, watch } from "vue";
import { useSimulationStore } from "../../stores/simulation";
import { SHIKIGAMI, SOULS, GLOSSARY } from "../../kb/useKb";
import { ENGINE_VERSION, GAME_DATA_VERSION } from "../../adapters/simulate.ts";
import { GUESSING_SCHEMA_VERSION } from "../../contracts/guessing-match.ts";
import { FACTS, countBySeverity } from "../../dev/facts.ts";
import type { FactSeverity } from "../../dev/facts.ts";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const sim = useSimulationStore();

// ───────── 版本 ─────────
// 引擎/数据版本优先用本次结果里的（那是引擎自报的），没有就用适配器常量（同一来源）。
const engineVersion = computed(() => sim.result?.engineVersion ?? ENGINE_VERSION);
const gameDataVersion = computed(() => sim.result?.gameDataVersion ?? GAME_DATA_VERSION);

// ───────── 数据规模（能从索引算的就动态算） ─────────
const withPinyin = computed(() => SHIKIGAMI.filter(x => !!x.p).length);
const aiUnits = computed(() => SHIKIGAMI.filter(x => x.has?.ai).length);
const skillSum = computed(() => SHIKIGAMI.reduce((a, x) => a + (x.has?.skills ?? 0), 0));
const soulSupport = computed(() => SOULS.reduce((a: Record<string, number>, s) => {
  a[s.engine.support] = (a[s.engine.support] ?? 0) + 1; return a;
}, {} as Record<string, number>));

/** 实验索引懒加载（78KB，打开抽屉时才取一次） */
const expCount = ref<number | null>(null);
const indexZones = ref<Array<{ zone: string; id: string; status: string }>>([]);
const expError = ref<string | null>(null);
let expTried = false;
async function ensureExperiments() {
  if (expTried) return;
  expTried = true;
  try {
    const mod: any = await import("../../kb/experiments.json");
    const d = mod.default ?? mod;
    expCount.value = Array.isArray(d?.experiments) ? d.experiments.length : null;
    indexZones.value = Array.isArray(d?.redZones)
      ? d.redZones.map((z: any) => ({ zone: String(z.zone ?? ""), id: String(z.id ?? "?"), status: String(z.status ?? "") }))
      : [];
  } catch (e: any) { expError.value = String(e?.message ?? e); }
}
watch(() => props.open, v => { if (v) ensureExperiments(); }, { immediate: true });
onMounted(() => { if (props.open) ensureExperiments(); });

const indexRows = computed(() => [
  { k: "Shikigami (betting-pool index)", v: String(SHIKIGAMI.length), src: "— (6 Onmyoji / heroes not indexed, see F10)" },
  { k: "Skills (index total)", v: String(skillSum.value), src: "— (source data includes Onmyoji skills, see F10)" },
  { k: "AI profiles (has.ai)", v: String(aiUnits.value), src: "— (see F10)" },
  { k: "Buff table", v: "—", src: "— (no buff table in the web index, see F10)" },
  { k: "Souls", v: String(SOULS.length), src: "Same source (kb/soul-index.json)" },
  { k: "Glossary", v: String(GLOSSARY.length), src: "Same source (kb/glossary.json)" },
  { k: "Experiments", v: expCount.value === null ? (expError.value ? "—" : "…") : String(expCount.value), src: expError.value ? "Index failed to load" : "Same source (kb/experiments.json)" },
  { k: "Pinyin coverage", v: withPinyin.value + " / " + SHIKIGAMI.length, src: "Same source (kb/shikigami-index.json)" },
]);

// ───────── 本次运行（允许为空） ─────────
const r = computed(() => sim.result);
const runRows = computed(() => {
  const x = r.value;
  const dash = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toLocaleString());
  return [
    { k: "N (battles)", v: x ? dash(x.simulations) : "—" },
    { k: "Red wins", v: x ? dash(x.redWins) : "—" },
    { k: "Blue wins", v: x ? dash(x.blueWins) : "—" },
    { k: "Draws", v: x ? dash(x.draws) : "—" },
    { k: "Unfinished", v: x ? dash(x.timeouts) : "—" },
    { k: "Errors", v: x ? dash(x.errors) : "—", bad: !!x && x.errors > 0 },
    { k: "Decisive samples", v: x ? dash(x.decisive) : "—" },
    { k: "Avg turns", v: x ? String(x.battleStats.avgTurns) : "—" },
    { k: "Sample seed", v: x?.seeds?.length ? String(x.seeds[0].seed) : "—" },
  ];
});
const validationLine = computed(() => {
  const v = sim.validation;
  if (!v) return "Validation report: — (not validated yet)";
  return "Validation report: blockers " + v.blockers.length + " · warnings " + v.warnings.length;
});

// ───────── 策略快照：5 个红区 ─────────
// 有本次运行 / 校验结果时用**冻结的**快照；没有就退回 kb/experiments.json 的静态红区规则。
// 两种情况分别标注来源，绝不把静态索引伪装成"本次运行的结果"。
const ZONES: Array<{ key: string; label: string; re: RegExp }> = [
  { key: "startup", label: "Battle-start resolution", re: /开局/ },
  { key: "triggerPriority", label: "Simultaneous triggers", re: /同时触发/ },
  { key: "death", label: "Death resolution", re: /死亡/ },
  { key: "endgame", label: "Betting endgame", re: /竞猜残局/ },
  { key: "resource", label: "Onibi", re: /鬼火/ },
];
const frozen = computed(() => r.value?.strategySnapshot ?? sim.validation?.strategySnapshot ?? null);
const strategyRows = computed(() => ZONES.map(z => {
  const f = frozen.value as any;
  if (f && f[z.key]) {
    return { label: z.label, ids: [String(f[z.key].id)], status: String(f[z.key].status), counts: null as Record<string, number> | null, source: "This run (frozen)" };
  }
  const rules = indexZones.value.filter(x => z.re.test(x.zone));
  const counts: Record<string, number> = {};
  for (const x of rules) counts[x.status] = (counts[x.status] ?? 0) + 1;
  const status = counts.UNKNOWN ? "UNKNOWN" : counts.HYPOTHESIS ? "HYPOTHESIS" : counts.VERIFIED ? "VERIFIED" : null;
  const ids = [...new Set(rules.map(x => x.id))];
  return {
    label: z.label,
    ids: ids.length ? ids : ["—"],
    status,
    counts: rules.length ? counts : null,
    source: rules.length ? "kb/experiments.json (static · weakest status)" : "Red zone not in the index",
  };
}));

// ───────── 覆盖度 ─────────
const cov = computed(() => r.value?.coverage ?? sim.validation?.coverage ?? null);
const covCells = computed(() => {
  const c = cov.value;
  if (!c) return [] as Array<{ k: string; v: string }>;
  return [
    { k: "Unit data", v: c.unitsJoined + " / " + c.unitsTotal },
    { k: "Skills available", v: c.skillsAvailable + " / " + c.skillsTotal },
    { k: "AI high confidence", v: c.aiHigh + " / " + c.aiTotal },
    { k: "Souls resolved", v: c.soulsResolved + " / " + c.soulsTotal },
    { k: "Soul battle effects", v: c.soulEffectsFull + " full / " + c.soulEffectsPartial + " partial" },
    { k: "Unknown buff refs", v: String(c.unknownBuffRefs.length) },
  ];
});

// ───────── 事实清单 ─────────
const sevCount = countBySeverity();
const SEV_CLASS: Record<FactSeverity, string> = { BLOCK: "sev-block", WARN: "sev-warn", INFO: "sev-info" };

// ───────── 文件地图 ─────────
const FILE_MAP: Array<{ dir: string; text: string }> = [
  { dir: "contracts/", text: "Three frozen contracts (betting input / result / Worker protocol), zero dependencies, the only boundary between UI and engine" },
  { dir: "engine/", text: "bundle.json pre-packed KB slice (loaded only in the Worker) + assemble.ts browser-side battle assembly" },
  { dir: "adapters/", text: "The only place allowed to touch the engine: simulate.ts interface / engine-adapter.ts real engine / mock-adapter.ts offline mock" },
  { dir: "workers/", text: "simulation.worker.ts three-line thread glue + protocol.ts (protocol logic testable outside the browser)" },
  { dir: "stores/", text: "Pinia, DTOs only: match (lineup / draft), simulation (result / validation / replay)" },
  { dir: "components/", text: "View layer: lineup / simulation health check / knowledge codex / mechanics lab / result & replay / dev (this HUD)" },
  { dir: "tests/", text: "Acceptance tests run as .ts directly in Node: ui0 contracts / ui1 editor / ui2 engine / ui5 knowledge / ui6 HUD+observations / e2e full flow" },
  { dir: "tools/", text: "Generator scripts: build-kb-index.mjs / build-engine-bundle.mjs / build-experiments-index.mjs" },
];

function statusClass(s: string | null) {
  return s === "UNKNOWN" ? "unknown" : s === "VERIFIED" ? "verified" : s === "HYPOTHESIS" ? "hypothesis" : "none";
}
</script>

<template>
  <div class="hudwrap" :class="{ open: props.open }">
    <div class="mask" @click="emit('close')" />
    <aside class="drawer">
      <header class="dhead">
        <b>Developer HUD</b>
        <span class="tiny dim">Read-only view · numbers come from the index / store / facts.ts; anything that cannot be computed shows "—", never a guess</span>
        <span class="spacer" />
        <span class="chip mono" :class="sevCount.BLOCK ? 'bad' : 'dim'">Facts BLOCK {{ sevCount.BLOCK }} · WARN {{ sevCount.WARN }} · INFO {{ sevCount.INFO }}</span>
        <button class="xbtn" @click="emit('close')">✕ Close</button>
      </header>

      <div class="body">
        <!-- ───────── 版本 ───────── -->
        <section class="blk">
          <h4>Versions</h4>
          <div class="chips">
            <span class="vchip mono">Engine {{ engineVersion }}</span>
            <span class="vchip mono">Game data {{ gameDataVersion }}</span>
            <span class="vchip mono">GUESSING_SCHEMA_VERSION {{ GUESSING_SCHEMA_VERSION }}</span>
            <span class="vchip mono" title="Measured from the build output; the data pack is not imported, so 621KB stays out of the main chunk">Data pack 621 KB (raw 1280 KB)</span>
          </div>
          <p class="note">The data pack size is measured from the build output (see fact F10); the HUD does not load it — those 621 KB are fetched on demand only in the Worker.</p>
        </section>

        <!-- ───────── 数据规模 ───────── -->
        <section class="blk">
          <h4>Data size</h4>
          <table class="tbl">
            <thead><tr><th>Item</th><th class="r">Computed from web index</th><th>Source data</th></tr></thead>
            <tbody>
              <tr v-for="row in indexRows" :key="row.k">
                <td>{{ row.k }}</td>
                <td class="mono r">{{ row.v }}</td>
                <td class="tiny dim">{{ row.src }}</td>
              </tr>
            </tbody>
          </table>
          <p class="note">"—" = cannot be computed from the web index. Measured source-data values are in the fact list (F10), not hard-coded in this component.</p>
        </section>

        <!-- ───────── 本次运行 ───────── -->
        <section class="blk">
          <h4>This run <span class="tiny dim">(from useSimulationStore, may be empty)</span></h4>
          <div class="grid9">
            <div v-for="cell in runRows" :key="cell.k" class="cell">
              <span class="k">{{ cell.k }}</span>
              <b class="mono" :class="{ bad: (cell as any).bad }">{{ cell.v }}</b>
            </div>
          </div>
          <div class="rows">
            <div class="line mono tiny">{{ validationLine }}</div>
            <div v-if="sim.running" class="line mono tiny">Running · {{ sim.percent }}%</div>
            <div v-if="sim.error" class="line mono tiny bad">Error: {{ sim.error }}</div>
            <div v-if="!r && !sim.validation" class="line tiny dim">No results yet: numbers appear here after you run a simulation or edit the lineup to trigger validation.</div>
          </div>
        </section>

        <!-- ───────── 策略快照 ───────── -->
        <section class="blk">
          <h4>Strategy snapshot <span class="tiny dim">(5 red zones · UNKNOWN in warning colour)</span></h4>
          <div class="pols">
            <div v-for="z in strategyRows" :key="z.label" class="pol">
              <span class="k">{{ z.label }}</span>
              <span class="mono tiny ids" :title="z.ids.join(' · ')">{{ z.ids.join(" · ") }}</span>
              <span class="st mono" :class="statusClass(z.status)">{{ z.status ?? "—" }}</span>
              <span class="tiny dim src">{{ z.source }}<template v-if="z.counts"> · UNKNOWN {{ z.counts.UNKNOWN ?? 0 }} / HYPOTHESIS {{ z.counts.HYPOTHESIS ?? 0 }} / VERIFIED {{ z.counts.VERIFIED ?? 0 }}</template></span>
            </div>
          </div>
          <p class="note">When this run (or validation) has a result, the snapshot <b>frozen</b> in that result is shown; otherwise it falls back to the static rules in kb/experiments.json aggregated by "weakest status" — the source is labelled at the end of each row and the two are never mixed.</p>
        </section>

        <!-- ───────── 覆盖度 ───────── -->
        <section class="blk">
          <h4>Coverage <span class="tiny dim">(the result contract is scoped to <b>the 10 units in this battle</b>, not the whole KB)</span></h4>
          <div v-if="cov" class="grid6">
            <div v-for="c in covCells" :key="c.k" class="cell">
              <span class="k">{{ c.k }}</span>
              <b class="mono">{{ c.v }}</b>
            </div>
          </div>
          <div v-else class="line tiny dim">— (not run / validated yet: coverage is produced by the engine during validation)</div>
          <ul v-if="cov && cov.unsupportedCapabilities.length" class="caps">
            <li v-for="(c, i) in cov.unsupportedCapabilities" :key="i">⚠ {{ c }}</li>
          </ul>
          <div v-else-if="cov" class="line tiny dim">unsupportedCapabilities is empty.</div>
          <div class="line tiny dim">
            kb/soul-index.json static support: FULL {{ soulSupport.FULL ?? 0 }} · PARTIAL {{ soulSupport.PARTIAL ?? 0 }} · UNSUPPORTED {{ soulSupport.UNSUPPORTED ?? 0 }}
          </div>
        </section>

        <!-- ───────── 实测事实清单 ───────── -->
        <section class="blk">
          <h4>Verified fact list <span class="tiny dim">(dev/facts.ts · every entry points to evidence; negative results are recorded as such)</span></h4>
          <article v-for="f in FACTS" :key="f.id" class="fact" :class="SEV_CLASS[f.severity]">
            <div class="fhead">
              <span class="sev mono">{{ f.severity }}</span>
              <b class="mono fid">{{ f.id }}</b>
              <span class="ftitle">{{ f.title }}</span>
            </div>
            <div class="fdetail">{{ f.detail }}</div>
            <div class="tiny dim fev">Evidence: {{ f.evidence }}</div>
          </article>
        </section>

        <!-- ───────── 文件地图 ───────── -->
        <section class="blk">
          <h4>File map</h4>
          <table class="tbl">
            <tbody>
              <tr v-for="row in FILE_MAP" :key="row.dir">
                <td class="mono dir">{{ row.dir }}</td>
                <td>{{ row.text }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.hudwrap { position: fixed; inset: 0; z-index: 60; pointer-events: none; }
.hudwrap .mask { position: absolute; inset: 0; background: #0009; opacity: 0; transition: opacity .18s; }
.hudwrap.open { pointer-events: auto; }
.hudwrap.open .mask { opacity: 1; }
.drawer { position: absolute; left: 0; right: 0; bottom: 0; height: 60vh; display: flex; flex-direction: column;
  background: var(--panel); border-top: 1px solid var(--line); box-shadow: 0 -10px 30px #000a;
  transform: translateY(102%); transition: transform .2s ease; }
.hudwrap.open .drawer { transform: translateY(0); }
.dhead { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--line); background: var(--panel2); }
.dhead b { font-size: 13px; }
.spacer { flex: 1; }
.chip { font-size: 10px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--fg-faint); }
.chip.bad { color: var(--danger); border-color: #6b2f28; background: #2a1614; }
.chip.dim { color: var(--fg-faint); }
.xbtn { font-size: 11px; padding: 3px 10px; }
.body { overflow-y: auto; padding: 12px 16px 24px; display: flex; flex-direction: column; gap: 12px; }

.blk { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--panel); }
.blk h4 { margin: 0 0 8px; font-size: 12.5px; color: var(--fg-dim); font-weight: 600; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.vchip { font-size: 11px; padding: 2px 9px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel2); color: var(--fg); }
.note { margin: 8px 0 0; font-size: 11px; color: var(--fg-faint); line-height: 1.6; }
.tiny { font-size: 10px; } .small { font-size: 11.5px; }
.dim { color: var(--fg-dim); } .bad { color: var(--danger); }

.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th { text-align: left; font-size: 10.5px; color: var(--fg-faint); font-weight: 500; padding: 4px 7px; border-bottom: 1px solid var(--line); }
.tbl td { padding: 4px 7px; border-bottom: 1px solid #1b1f28; vertical-align: top; }
.tbl .r { text-align: right; white-space: nowrap; }
.tbl .dir { color: var(--blue); white-space: nowrap; }

.grid9 { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px; }
.grid6 { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.cell { display: flex; flex-direction: column; gap: 2px; padding: 6px 9px; background: var(--panel2); border-radius: 8px; }
.cell .k { font-size: 10.5px; color: var(--fg-faint); }
.cell b { font-size: 13px; }
.rows { margin-top: 7px; display: flex; flex-direction: column; gap: 3px; }
.line { line-height: 1.5; }

.pols { display: flex; flex-direction: column; gap: 5px; }
.pol { display: grid; grid-template-columns: 84px 1.4fr 92px 1.6fr; gap: 8px; align-items: center; font-size: 12px; }
.pol .k { color: var(--fg-faint); font-size: 11.5px; }
.pol .ids { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pol .st { font-size: 10px; text-align: center; padding: 1px 6px; border-radius: 999px; }
.pol .st.unknown { background: #2a1614; color: var(--danger); }
.pol .st.hypothesis { background: #2a2213; color: var(--warn); }
.pol .st.verified { background: #16241c; color: var(--ok); }
.pol .st.none { background: var(--panel2); color: var(--fg-faint); }

.caps { margin: 7px 0 0; padding-left: 16px; font-size: 11.5px; color: var(--warn); line-height: 1.6; }

.fact { border: 1px solid var(--line); border-left-width: 3px; border-radius: 8px; padding: 7px 9px; margin-bottom: 6px; background: var(--panel2); }
.fact.sev-block { border-left-color: var(--danger); }
.fact.sev-warn { border-left-color: var(--warn); }
.fact.sev-info { border-left-color: var(--fg-faint); }
.fhead { display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap; }
.sev { font-size: 9.5px; padding: 1px 6px; border-radius: 4px; }
.sev-block .sev { background: #2a1614; color: var(--danger); }
.sev-warn .sev { background: #2a2213; color: var(--warn); }
.sev-info .sev { background: #1b1f28; color: var(--fg-faint); }
.fid { font-size: 11px; }
.ftitle { font-size: 12px; }
.fdetail { font-size: 11.5px; line-height: 1.65; color: var(--fg-dim); margin-top: 4px; }
.fev { margin-top: 3px; line-height: 1.5; word-break: break-all; }

@media (max-width: 900px) { .pol { grid-template-columns: 1fr; gap: 2px; } }
</style>
