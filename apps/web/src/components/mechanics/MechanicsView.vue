<script setup lang="ts">
// MechanicsView.vue — UI-5 机制实验台：红区状态 / 机制覆盖度 / 44 个实验 / 假设对比
// UI-6 追加：观测登记（实验表之后的独立区块，只往 localStorage 里记观测，绝不改实验状态）。
// 数据来自 tools/build-experiments-index.mjs 生成的 kb/experiments.json（懒加载，78KB）。
// 本组件不接触引擎：只读索引 JSON + lab/observations.ts，不引用任何引擎模块。
import { computed, onMounted, reactive, ref } from "vue";
import {
  loadAll, listFor, add, remove, exportJson, stats, isPersistent,
  OBSERVATION_SOURCES, OBSERVATION_SOURCE_LABEL, OBSERVATION_CONFIDENCES, OBSERVATION_CONFIDENCE_LABEL,
  OBSERVATION_POLICY_NOTE, OBSERVATIONS_KEY,
} from "../../lab/observations.ts";
import type { ObservationRecord, ObservationStats, ObservationSource, ObservationConfidence } from "../../lab/observations.ts";
import { groupRedZones, TONE_VAR } from "./redZoneGroups.ts";
import { tagText } from "../../kb/en-text.ts";
import { enEngine } from "../../kb/en-engine.ts";

interface Hypothesis { id: string; note: string; observable: unknown }
interface Experiment {
  id: string; group: string; title: string; hypothesis: string; method: string; result: string;
  verdict: string; verdictLevel: string; discriminating: boolean; redZone: string;
  kind: string | null; status: string | null; confidence: string | null; chosenHypothesis: string | null;
  distinctObservables: number | null; hypotheses: Hypothesis[]; recordedAt: string | null;
}
interface RedZone { zone: string; id: string; status: string; question: string; evidence: string; source: string; rawStatus?: string }
interface Coverage { capability: string; status: string; note: string; tag: string; evidence: string; freq: number | null }
interface ExpIndex {
  meta: { dataVersion: string; gameVersion: string | null; dataRecordedAt: string | null; sources: string[]; policySources: string[] };
  groups: Array<{ group: string; zone: string; total: number; discriminating: number }>;
  experiments: Experiment[];
  redZones: RedZone[];
  redZoneStatusCounts: Record<string, number>;
  verifiedRules: { count: number; ids: string[]; note: string };
  coverage: Coverage[];
  coverageSummary: { total: number; full: number; partial: number; none: number; kernelCoverage: number | null; hardCoverage: number | null; unsupported: string[] };
  anomalies: Array<{ kind: string; msg: string }>;
}

const data = ref<ExpIndex | null>(null);
const loadError = ref<string | null>(null);
onMounted(async () => {
  try {
    const mod: any = await import("../../kb/experiments.json");
    data.value = (mod.default ?? mod) as ExpIndex;
  } catch (e: any) { loadError.value = String(e?.message ?? e); }
  refreshObs();
});

const exps = computed(() => data.value?.experiments ?? []);
const redZones = computed(() => data.value?.redZones ?? []);
const coverage = computed(() => data.value?.coverage ?? []);
const GROUP_ORDER = ["A", "B", "C", "D"];
const GROUP_LABEL: Record<string, string> = { A: "Battle-start resolution order", B: "Simultaneous trigger priority", C: "Death / transform / revive", D: "Betting match ruleset" };

// ───────── 红区状态 ─────────
// ★★ 第 62 轮：分组逻辑抽到 redZoneGroups.ts（纯函数，可被测试直接断言）。
//   原来它遍历一张写死的 STATUS_ORDER，数据里多一个状态就**静默丢条目**；
//   而且圆点颜色的 else 兜底是绿色 —— 不认识的状态会被画成"已验证"。
//   现在：顺序由清单给，**覆盖由数据决定**，不认识的状态照样成组、用中性色。
const zonesByStatus = computed(() => groupRedZones(redZones.value));
const zoneNames = computed(() => [...new Set(redZones.value.map(z => enEngine(z.zone)))]);
/** 组内实验条数（来自索引的 groups 汇总，不在这里重算） */
const groupTotal = (g: string) => data.value?.groups.find(x => x.group === g)?.total ?? 0;
/** 组内红区名（索引里已按实验定义文件的段注释取好） */
const groupZone = (g: string) => data.value?.groups.find(x => x.group === g)?.zone ?? g;

// ───────── 机制覆盖度 ─────────
const covFilter = ref<string>("ALL");
const COV_ORDER = ["FULL", "PARTIAL", "NONE"];
const COV_COLOR: Record<string, string> = { FULL: "var(--ok)", PARTIAL: "var(--warn)", NONE: "var(--danger)" };
const COV_LABEL: Record<string, string> = { FULL: "Fully implemented", PARTIAL: "Partially implemented", NONE: "Not implemented" };
const covCounts = computed(() => coverage.value.reduce((a: Record<string, number>, c) => {
  a[c.status] = (a[c.status] ?? 0) + 1; return a;
}, {} as Record<string, number>));
const covList = computed(() => (covFilter.value === "ALL" ? coverage.value : coverage.value.filter(c => c.status === covFilter.value)));

// ───────── 实验表 ─────────
const groupFilter = ref<string>("ALL");
const discFilter = ref<string>("ALL");
const expanded = ref<string | null>(null);
const filtered = computed(() => exps.value.filter(e =>
  (groupFilter.value === "ALL" || e.group === groupFilter.value) &&
  (discFilter.value === "ALL" || (discFilter.value === "YES") === e.discriminating)
));
function toggle(id: string) { expanded.value = expanded.value === id ? null : id; }
/** 观测值压成一行展示；数值原样来自索引，不做四舍五入或改写 */
function compact(v: unknown) { return JSON.stringify(v ?? null); }
const discCount = computed(() => exps.value.filter(e => e.discriminating).length);

// ───────── 假设对比：同一红区内结论（verdictLevel）不同 ─────────
const contrastPairs = computed(() => {
  const byZone = new Map<string, Experiment[]>();
  for (const e of exps.value) {
    if (!byZone.has(e.redZone)) byZone.set(e.redZone, []);
    byZone.get(e.redZone)!.push(e);
  }
  const out: Array<{ zone: string; a: Experiment; b: Experiment }> = [];
  for (const [zone, list] of byZone) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (list[i].verdictLevel !== list[j].verdictLevel) out.push({ zone, a: list[i], b: list[j] });
    }
  }
  return out;
});
const VERDICT_LABEL: Record<string, string> = {
  VERIFIED: "Verified", HYPOTHESIS: "Hypothesis chosen (not tested in game)", UNKNOWN: "Unverified",
};

// ───────── 观测登记（UI-6） ─────────
// ★ 这一块**只记录**：保存一条观测不会改任何实验的 status / confidence / chosenHypothesis，
//   也不会让红区变成 VERIFIED。状态变更必须人工复核后手改实验目录里的 verified-rules.json。
//   页面顶部那句醒目说明的原话（与 lab/observations.ts 的 OBSERVATION_POLICY_NOTE 是同一句，单点维护）：
//   「登记观测只做记录，不会自动把任何规则改成 VERIFIED —— 状态变更必须人工复核后手改 verified-rules.json，
//     避免把「有人填了张表」当成「机制已被验证」。」
const obsList = ref<ObservationRecord[]>([]);
const obsStat = ref<ObservationStats>({ total: 0, bySource: {}, byExperiment: {} });
const obsPersistent = ref(true);
const obsFilter = ref<string>("ALL");
const obsError = ref<string | null>(null);
const obsSaved = ref(false);
const obsCopied = ref(false);
const obsExportText = ref<string | null>(null);
let obsSavedTimer: ReturnType<typeof setTimeout> | null = null;

const obsForm = reactive({
  experimentId: "",
  source: "IN_GAME" as ObservationSource,
  claim: "",
  evidenceText: "",
  confidence: "LOW" as ObservationConfidence,
  author: "",
});

function refreshObs() {
  obsList.value = loadAll();
  obsStat.value = stats();
  obsPersistent.value = isPersistent();
}
/** 筛选：全部走内存列表，按实验筛选走仓库 API（listFor 返回时间倒序） */
const obsShown = computed(() => (obsFilter.value === "ALL" ? obsList.value : listFor(obsFilter.value)));

function saveObservation() {
  obsError.value = null;
  if (!obsForm.experimentId) { obsError.value = "Please select an experiment first"; return; }
  if (!obsForm.claim.trim()) { obsError.value = "Conclusion text must not be empty — an observation without a conclusion cannot be reviewed"; return; }
  try {
    add({
      experimentId: obsForm.experimentId,
      source: obsForm.source,
      claim: obsForm.claim,
      evidenceText: obsForm.evidenceText,
      confidence: obsForm.confidence,
      author: obsForm.author,
    });
    refreshObs();
    obsForm.claim = "";
    obsForm.evidenceText = "";
    obsSaved.value = true;
    if (obsSavedTimer) clearTimeout(obsSavedTimer);
    obsSavedTimer = setTimeout(() => (obsSaved.value = false), 4000);
  } catch (e: any) {
    obsError.value = String(e?.message ?? e);
  }
}

function deleteObservation(id: string) {
  remove(id);
  refreshObs();
}

/** 导出：优先写剪贴板；失败（无权限 / 非安全上下文）退化为展开只读 textarea 手动复制 */
async function exportObservations() {
  const json = exportJson();
  obsExportText.value = null;
  try {
    await navigator.clipboard.writeText(json);
    obsCopied.value = true;
    setTimeout(() => (obsCopied.value = false), 1500);
  } catch {
    obsCopied.value = false;
    obsExportText.value = json;
  }
}
</script>

<template>
  <div class="mech">
    <div v-if="loadError" class="err">✗ Failed to load the experiment index: {{ loadError }}</div>
    <div v-else-if="!data" class="loading">Loading kb/experiments.json …</div>

    <template v-else>
      <!-- 顶部固定说明 -->
      <div class="sourcebar">
        <span class="mono k">Data sources</span>
        <span>Experiment summary <b class="mono">_all.json</b> · red-zone rule status <b class="mono">verified-rules.json</b> · capability coverage <b class="mono">coverage.json</b> · engine Policy constants</span>
        <span class="spacer" />
        <span class="mono ver">{{ data.meta.dataVersion }}</span>
        <span class="chip mono" :title="data.meta.sources.concat(data.meta.policySources).join(' · ')">
          {{ data.meta.sources.length + data.meta.policySources.length }} source files
        </span>
        <span class="chip mono">Experiments {{ exps.length }}</span>
        <span class="chip mono">Red-zone rules {{ redZones.length }}</span>
        <span class="chip mono">Coverage {{ coverage.length }}</span>
      </div>

      <!-- ───────── 红区状态 ───────── -->
      <section class="panel">
        <header class="phead">
          <h3>Red-zone status</h3>
          <span class="badge" :class="(data.redZoneStatusCounts.VERIFIED ?? 0) === 0 ? 'warn' : 'ok'">
            VERIFIED {{ data.redZoneStatusCounts.VERIFIED ?? 0 }} / HYPOTHESIS {{ data.redZoneStatusCounts.HYPOTHESIS ?? 0 }} / UNKNOWN {{ data.redZoneStatusCounts.UNKNOWN ?? 0 }}
          </span>
        </header>
        <div class="rule warnbig">
          ⚠ UNKNOWN mechanics are never guessed, only explicitly flagged: no win rate produced by the engine under an UNKNOWN policy is a mechanic conclusion.
        </div>
        <div class="muted">
          {{ zoneNames.length }} red-zone categories: {{ zoneNames.join(" · ") }}.
          "Verified" only counts the rules in <b class="mono">verified-rules.json</b> (currently {{ data.verifiedRules.count }});
          HYPOTHESIS is still a <b>hypothesis</b> even with an official / spec source, and is not the same as verified.
        </div>

        <div v-for="g in zonesByStatus" :key="g.status" class="statusgroup">
          <div class="ghead">
            <span class="dot" :style="{ background: TONE_VAR[g.tone] }" />
            <b>{{ g.label }}</b>
            <span class="mono count">{{ g.rules.length }} rules</span>
            <span class="spacer" />
            <span class="dim small">{{ g.help }}</span>
          </div>
          <div v-if="!g.rules.length" class="empty small">(none)</div>
          <div class="rules">
            <article v-for="z in g.rules" :key="z.source + ':' + z.id" class="rule" :class="{ unknown: z.status === 'UNKNOWN' }">
              <div class="rhead">
                <span class="zchip">{{ enEngine(z.zone) }}</span>
                <b class="mono rid">{{ z.id }}</b>
                <span v-if="z.rawStatus" class="mono raw" title="Raw status value in the source file">raw {{ z.rawStatus }}</span>
              </div>
              <div class="q">{{ z.question ? enEngine(z.question) : "(no question field in the source file)" }}</div>
              <div v-if="z.evidence" class="ev dim small">Basis: {{ enEngine(z.evidence) }}</div>
              <div class="mono src dim tiny">{{ z.source }}</div>
            </article>
          </div>
        </div>
      </section>

      <!-- ───────── 机制覆盖度 ───────── -->
      <section class="panel">
        <header class="phead">
          <h3>Mechanic coverage</h3>
          <span class="mono dim small">
            kernel {{ data.coverageSummary.kernelCoverage }}% · hard {{ data.coverageSummary.hardCoverage }}%
            · {{ data.coverageSummary.total }} capabilities
          </span>
        </header>
        <div class="covbar">
          <button v-for="s in ['ALL'].concat(COV_ORDER)" :key="s" class="covbtn" :class="{ on: covFilter === s }" @click="covFilter = s">
            <i v-if="s !== 'ALL'" class="dot" :style="{ background: COV_COLOR[s] }" />
            {{ s === "ALL" ? "All" : s + " · " + COV_LABEL[s] }}
            <b class="mono">{{ s === "ALL" ? coverage.length : (covCounts[s] ?? 0) }}</b>
          </button>
        </div>
        <div class="covlist">
          <article v-for="c in covList" :key="c.capability" class="covitem">
            <div class="chead">
              <i class="dot" :style="{ background: COV_COLOR[c.status] }" />
              <b :title="tagText(c.tag) !== c.tag ? c.tag : undefined">{{ tagText(c.tag) }}</b>
              <span class="mono dim tiny">{{ c.capability }}</span>
              <span class="spacer" />
              <span class="mono tiny" :style="{ color: COV_COLOR[c.status] }">{{ c.status }}</span>
              <span class="mono tiny dim" title="Number of skill / effect references in the data">×{{ c.freq }}</span>
            </div>
            <div class="cnote dim small">{{ c.note || "(no note in the source file)" }}</div>
            <div class="mono tiny dim">evidence {{ c.evidence }}</div>
          </article>
        </div>
      </section>

      <!-- ───────── 实验表 ───────── -->
      <section class="panel">
        <header class="phead">
          <h3>Experiments</h3>
          <span class="mono dim small">{{ exps.length }} total · discriminating {{ discCount }} / non-discriminating {{ exps.length - discCount }}</span>
        </header>
        <div class="rule warnbig small">
          All {{ exps.length }} experiments are <b>unverified · awaiting in-game observation</b> (confidence = NOT_RUN, chosenHypothesis = null):
          the "Result" column is <b>what the lab expects to observe under each hypothesis</b>, not an in-game test result, and must not be used as a mechanic conclusion.
        </div>
        <div class="filters">
          <button class="fbtn" :class="{ on: groupFilter === 'ALL' }" @click="groupFilter = 'ALL'">All groups</button>
          <button v-for="g in GROUP_ORDER" :key="g" class="fbtn" :class="{ on: groupFilter === g }" @click="groupFilter = g">
            {{ g }} · {{ GROUP_LABEL[g] }}<span class="mono cnt" :title="groupZone(g)">{{ groupTotal(g) }}</span>
          </button>
          <span class="spacer" />
          <button class="fbtn" :class="{ on: discFilter === 'ALL' }" @click="discFilter = 'ALL'">Discrimination: all</button>
          <button class="fbtn" :class="{ on: discFilter === 'YES' }" @click="discFilter = 'YES'">Discriminating</button>
          <button class="fbtn" :class="{ on: discFilter === 'NO' }" @click="discFilter = 'NO'">Non-discriminating</button>
        </div>
        <div class="tablewrap">
          <table class="exptable">
            <thead>
              <tr><th>ID</th><th>Group</th><th>Experiment</th><th>Discrimination</th><th>Verdict</th><th /></tr>
            </thead>
            <tbody>
              <template v-for="e in filtered" :key="e.id">
                <tr class="row" :class="{ open: expanded === e.id }" @click="toggle(e.id)">
                  <td class="mono">{{ e.id }}</td>
                  <td><span class="gtag" :class="'g-' + e.group">{{ e.group }}</span></td>
                  <td class="title">{{ e.title }}</td>
                  <td><span class="dchip" :class="e.discriminating ? 'yes' : 'no'">{{ e.discriminating ? "Discriminating" : "Non-discriminating" }}</span></td>
                  <td><span class="vchip" :class="'v-' + e.verdictLevel">{{ e.verdict }}</span></td>
                  <td class="mono dim">{{ expanded === e.id ? "▾" : "▸" }}</td>
                </tr>
                <tr v-if="expanded === e.id" class="detail">
                  <td colspan="6">
                    <div class="dgrid">
                      <div class="dblock">
                        <div class="dk">Hypotheses <span class="dim tiny">({{ e.hypotheses.length }} candidates)</span></div>
                        <ul class="hyp">
                          <li v-for="h in e.hypotheses" :key="h.id">
                            <b class="mono">{{ h.id }}</b> {{ h.note }}
                            <div class="mono tiny dim obs">{{ compact(h.observable) }}</div>
                          </li>
                        </ul>
                      </div>
                      <div class="dblock">
                        <div class="dk">Method</div>
                        <div class="dv">{{ e.method }}</div>
                        <div v-if="e.distinctObservables !== null" class="mono tiny dim">distinctObservables = {{ e.distinctObservables }}</div>
                      </div>
                      <div class="dblock">
                        <div class="dk">Result <span class="dim tiny">(lab observation: the discriminating phenomena expected under each hypothesis, not yet tested in game)</span></div>
                        <div class="dv">{{ e.result }}</div>
                      </div>
                      <div class="dblock">
                        <div class="dk">Verdict</div>
                        <div class="dv">
                          <span class="vchip" :class="'v-' + e.verdictLevel">{{ e.verdict }}</span>
                          <div class="mono tiny dim dmeta">
                            status {{ e.status }} · confidence {{ e.confidence }} · kind {{ e.kind }} · chosenHypothesis {{ e.chosenHypothesis === null ? "null" : e.chosenHypothesis }}<br />
                            Red zone {{ e.redZone }} · recorded at {{ e.recordedAt }}
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                </tr>
              </template>
              <tr v-if="!filtered.length"><td colspan="6" class="empty">No experiments match the filters</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- ───────── 观测登记（UI-6） ───────── -->
      <section class="panel">
        <header class="phead">
          <h3>Observation log</h3>
          <span class="mono dim small">
            {{ obsStat.total }} logged · {{ obsPersistent ? "saved to localStorage (" + OBSERVATIONS_KEY + ")" : "Persistence unavailable in this browser: valid for this session only, lost on refresh" }}
          </span>
          <span class="spacer" />
          <button class="fbtn" @click="exportObservations">{{ obsCopied ? "Copied ✓" : "Export all observations (JSON)" }}</button>
        </header>

        <div class="rule warnbig small">{{ OBSERVATION_POLICY_NOTE }}</div>
        <div class="muted small">
          Observations are <b>raw material for humans</b>, not mechanic conclusions: confidence here is the logger's certainty about the observation,
          a different field from <b class="mono">confidence</b> in the experiment table (engine states such as NOT_RUN); neither overwrites the other.
        </div>

        <div class="obsstats">
          <span class="chip mono">Total {{ obsStat.total }}</span>
          <span v-for="s in OBSERVATION_SOURCES" :key="s" class="chip mono">{{ OBSERVATION_SOURCE_LABEL[s] }} {{ obsStat.bySource[s] ?? 0 }}</span>
        </div>

        <div class="obsform">
          <label class="f">
            <span class="k">Experiment ({{ exps.length }} from kb/experiments.json)</span>
            <select v-model="obsForm.experimentId">
              <option value="">(select an experiment)</option>
              <option v-for="e in exps" :key="e.id" :value="e.id">{{ e.id }} · {{ e.title }}</option>
            </select>
          </label>
          <label class="f">
            <span class="k">Source</span>
            <select v-model="obsForm.source">
              <option v-for="s in OBSERVATION_SOURCES" :key="s" :value="s">{{ OBSERVATION_SOURCE_LABEL[s] }} ({{ s }})</option>
            </select>
          </label>
          <label class="f">
            <span class="k">Confidence (logger's certainty: low / medium / high)</span>
            <select v-model="obsForm.confidence">
              <option v-for="c in OBSERVATION_CONFIDENCES" :key="c" :value="c">{{ c }} · {{ OBSERVATION_CONFIDENCE_LABEL[c] }}</option>
            </select>
          </label>
          <label class="f">
            <span class="k">Logged by (optional)</span>
            <input v-model="obsForm.author" placeholder="Name or anonymous" />
          </label>
          <label class="f wide">
            <span class="k">Conclusion — what was observed (required)</span>
            <textarea v-model="obsForm.claim" rows="2" placeholder="e.g. battle-start first-strike resolves before Souls, consistent across three observations"></textarea>
          </label>
          <label class="f wide">
            <span class="k">Evidence — where it was seen (recording timestamp / post link / data field; recommended)</span>
            <textarea v-model="obsForm.evidenceText" rows="2" placeholder="Reviewers rely only on this to judge whether the observation can be trusted"></textarea>
          </label>
          <div class="f actions">
            <button class="fbtn on" @click="saveObservation">Save observation</button>
            <span v-if="obsError" class="mono tiny bad">{{ obsError }}</span>
            <span v-else-if="obsSaved" class="mono tiny oktext">Logged. Experiment status was not changed; verified-rules.json remains authoritative.</span>
          </div>
        </div>

        <div class="filters">
          <span class="k">Filter by experiment</span>
          <select class="obsfilter" v-model="obsFilter">
            <option value="ALL">All ({{ obsStat.total }})</option>
            <option v-for="e in exps" :key="e.id" :value="e.id">{{ e.id }} · {{ e.title }} ({{ obsStat.byExperiment[e.id] ?? 0 }})</option>
          </select>
          <span class="spacer" />
          <span class="mono tiny dim">Newest observation first</span>
        </div>

        <div v-if="obsShown.length" class="obslist">
          <article v-for="o in obsShown" :key="o.id" class="obsitem">
            <div class="ohead">
              <b class="mono">{{ o.experimentId }}</b>
              <span class="ochip">{{ OBSERVATION_SOURCE_LABEL[o.source] ?? ("Unknown source: " + o.source) }}</span>
              <span class="ochip" :class="'c-' + o.confidence">
                Confidence {{ o.confidence }}{{ OBSERVATION_CONFIDENCE_LABEL[o.confidence] ? " · " + OBSERVATION_CONFIDENCE_LABEL[o.confidence] : "" }}
              </span>
              <span class="mono tiny dim">{{ o.observedAt }}</span>
              <span v-if="o.author" class="tiny dim">@{{ o.author }}</span>
              <span class="spacer" />
              <button class="delbtn" @click="deleteObservation(o.id)">Delete</button>
            </div>
            <div class="oclaim">{{ o.claim }}</div>
            <div v-if="o.evidenceText" class="oev dim small">Evidence: {{ o.evidenceText }}</div>
            <div v-else class="oev dim small">(no evidence given — cannot be trusted on review)</div>
          </article>
        </div>
        <div v-else class="empty small">
          No observations logged yet{{ obsFilter === "ALL" ? "" : " (none for the current filter)" }}.
        </div>

        <div v-if="obsExportText !== null" class="obsexport">
          <div class="tiny dim">Clipboard unavailable; the full JSON is below, please copy it manually:</div>
          <textarea class="mono" readonly :value="obsExportText" rows="6"></textarea>
        </div>
      </section>

      <!-- ───────── 假设对比 ───────── -->
      <section class="panel">
        <header class="phead">
          <h3>Hypothesis comparison</h3>
          <span class="mono dim small">Experiment pairs with opposite conclusions in the same red zone · criterion: different verdictLevel</span>
        </header>
        <div v-if="contrastPairs.length" class="pairs">
          <div v-for="(p, i) in contrastPairs" :key="i" class="pair">
            <div class="pzone">{{ p.zone }}</div>
            <div class="cols">
              <article v-for="e in [p.a, p.b]" :key="e.id" class="side">
                <div class="rhead"><b class="mono">{{ e.id }}</b><span class="vchip" :class="'v-' + e.verdictLevel">{{ VERDICT_LABEL[e.verdictLevel] ?? e.verdictLevel }}</span></div>
                <div class="title">{{ e.title }}</div>
                <div class="dim small">{{ e.hypothesis }}</div>
                <div class="mono tiny dim">Verdict: {{ e.verdict }}</div>
              </article>
            </div>
          </div>
        </div>
        <div v-else class="empty">
          No experiment pairs with opposite conclusions
          <div class="dim small">
            All {{ exps.length }} experiments currently share the same verdict status ({{ VERDICT_LABEL.UNKNOWN }} ·
            awaiting in-game observation, confidence = NOT_RUN); no two give opposite conclusions — so there is nothing to compare side by side.
            Once a red zone is confirmed by testing (an entry appears in verified-rules.json), confirmed / unconfirmed experiments in that zone will be paired here automatically.
          </div>
        </div>
      </section>

      <!-- ───────── 数据异常与缺口 ───────── -->
      <section class="panel">
        <header class="phead">
          <h3>Data anomalies and gaps</h3>
          <span class="mono dim small">Self-check output of tools/build-experiments-index.mjs · {{ data.anomalies.length }} entries</span>
        </header>
        <div class="muted small">These are gaps or contradictions in the source data, not rendering issues; the index contains no VERIFIED conclusions and no invented confidence values.</div>
        <ul class="anoms">
          <li v-for="(a, i) in data.anomalies" :key="i"><span class="mono kind">{{ a.kind }}</span> {{ a.msg }}</li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.mech { display: flex; flex-direction: column; gap: 12px; }
.k { color: var(--fg-faint); font-size: 10px; letter-spacing: 1px; }
.spacer { flex: 1; }
.tiny { font-size: 10px; } .small { font-size: 11px; }
.dim { color: var(--fg-dim); } .muted { color: var(--fg-dim); font-size: 11.5px; line-height: 1.6; margin: 6px 0 4px; }
.loading, .empty { padding: 22px; text-align: center; color: var(--fg-faint); font-size: 12px; }
.err { padding: 12px; border-radius: 8px; background: #2a1614; border: 1px solid #6b2f28; color: var(--danger); font-size: 12px; }

.sourcebar { position: sticky; top: 52px; z-index: 10; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 7px 11px; background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; font-size: 11px; color: var(--fg-dim); }
.sourcebar b { color: var(--fg); font-weight: 500; }
.ver { color: var(--ok); font-size: 11px; border: 1px solid #2f5741; background: #16241c; border-radius: 5px; padding: 1px 7px; }
.chip { font-size: 10px; color: var(--fg-faint); border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; }

.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
.phead { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.phead h3 { margin: 0; font-size: 14px; }
.badge { font-family: var(--mono); font-size: 11px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line); color: var(--fg-dim); }
.badge.warn { color: var(--warn); border-color: #6b5520; background: #2a2213; }
.badge.ok { color: var(--ok); border-color: #2f5741; background: #16241c; }
.rule { padding: 7px 9px; border-radius: 7px; background: var(--panel2); font-size: 11.5px; line-height: 1.55; color: var(--fg-dim); }
.warnbig { margin-bottom: 8px; background: #2a1614; border: 1px solid #6b2f28; color: #f0a89f; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; display: inline-block; }

.statusgroup { margin-top: 10px; }
.ghead { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; border-bottom: 1px dashed var(--line); font-size: 12px; }
.count { font-size: 10px; color: var(--fg-faint); }
.rules { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 6px; margin-top: 7px; }
.rule { background: var(--panel2); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 3px; }
.rule.unknown { background: #2a1614; border-color: #6b2f28; }
.rule.unknown .q { color: #f0a89f; }
.rhead { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.zchip { font-size: 10px; color: var(--fg-faint); border: 1px solid var(--line); border-radius: 999px; padding: 0 6px; }
.rid { font-size: 11.5px; }
.raw { font-size: 9.5px; color: var(--warn); border: 1px solid #6b5520; border-radius: 4px; padding: 0 4px; }
.q { font-size: 11.5px; color: var(--fg); line-height: 1.5; }
.ev { line-height: 1.5; }
.src { font-size: 9.5px; }

.covbar { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 8px; }
.covbtn, .fbtn { font-size: 11px; padding: 3px 10px; display: inline-flex; align-items: center; gap: 5px; }
.covbtn.on, .fbtn.on { background: #2b4a7a; border-color: #3a5f96; }
.covlist { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 5px; max-height: 420px; overflow: auto; }
.covitem { background: var(--panel2); border: 1px solid var(--line); border-radius: 7px; padding: 6px 8px; }
.chead { display: flex; align-items: baseline; gap: 6px; font-size: 11.5px; }
.cnote { line-height: 1.5; }

.filters { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin: 8px 0; }
.cnt { font-size: 9.5px; color: var(--fg-faint); margin-left: 4px; }
.tablewrap { overflow-x: auto; }
.exptable { width: 100%; border-collapse: collapse; font-size: 12px; }
.exptable th { text-align: left; font-size: 10.5px; color: var(--fg-faint); font-weight: 500; padding: 4px 7px; border-bottom: 1px solid var(--line); }
.exptable td { padding: 5px 7px; border-bottom: 1px solid var(--line); vertical-align: top; }
.row { cursor: pointer; }
.row:hover { background: #20242e; }
.row.open { background: #20242e; }
.title { line-height: 1.45; }
.gtag { font-family: var(--mono); font-size: 10px; border: 1px solid var(--line); border-radius: 4px; padding: 0 5px; }
.g-A { color: var(--blue); border-color: #2f4f6b; } .g-B { color: var(--warn); border-color: #6b5520; }
.g-C { color: var(--red); border-color: #6b2f28; } .g-D { color: var(--ok); border-color: #2f5741; }
.dchip { font-size: 10px; border: 1px solid var(--line); border-radius: 999px; padding: 0 6px; color: var(--fg-faint); }
.dchip.yes { color: var(--blue); border-color: #2f4f6b; } .dchip.no { color: var(--fg-faint); }
.vchip { font-size: 10px; border: 1px solid var(--line); border-radius: 999px; padding: 0 6px; color: var(--fg-dim); white-space: nowrap; }
.v-VERIFIED { color: var(--ok); border-color: #2f5741; }
.v-HYPOTHESIS { color: var(--warn); border-color: #6b5520; }
.v-UNKNOWN { color: var(--danger); border-color: #6b2f28; }
.detail td { background: #191d25; }
.dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.dk { font-size: 10px; color: var(--fg-faint); margin-bottom: 3px; }
.dv { font-size: 11.5px; line-height: 1.55; }
.hyp { margin: 0; padding-left: 16px; font-size: 11.5px; line-height: 1.5; }
.hyp li { margin-bottom: 4px; }
.obs { word-break: break-all; }
.dmeta { margin-top: 5px; line-height: 1.6; }

.pairs { display: flex; flex-direction: column; gap: 10px; }
.pair { border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.pzone { font-size: 10.5px; color: var(--fg-faint); margin-bottom: 6px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.side { background: var(--panel2); border-radius: 7px; padding: 7px 9px; display: flex; flex-direction: column; gap: 3px; }
.anoms { margin: 4px 0 0; padding-left: 16px; font-size: 11px; line-height: 1.7; color: var(--fg-dim); }
.kind { font-size: 9.5px; color: var(--warn); border: 1px solid #6b5520; border-radius: 4px; padding: 0 4px; margin-right: 4px; }
/* ───────── 观测登记（UI-6） ───────── */
.obsstats { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 2px; }
.obsform { display: grid; grid-template-columns: repeat(auto-fit, minmax(215px, 1fr)); gap: 8px; margin: 8px 0 6px; }
.obsform .f { display: flex; flex-direction: column; gap: 3px; }
.obsform .f.wide { grid-column: 1 / -1; }
.obsform .k { font-size: 10px; color: var(--fg-faint); }
.obsform .actions { flex-direction: row; align-items: center; gap: 9px; }
.obsform textarea { font: inherit; color: inherit; background: #0f1116; border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; width: 100%; resize: vertical; }
.oktext { color: var(--ok); font-size: 10.5px; }
.bad { color: var(--danger); }
.obsfilter { max-width: 540px; }
.obslist { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.obsitem { background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; }
.ohead { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.ochip { font-size: 10px; border: 1px solid var(--line); border-radius: 999px; padding: 0 7px; color: var(--fg-dim); }
.ochip.c-HIGH { color: var(--ok); border-color: #2f5741; }
.ochip.c-MEDIUM { color: var(--warn); border-color: #6b5520; }
.ochip.c-LOW { color: var(--fg-faint); }
.oclaim { font-size: 12px; margin-top: 4px; line-height: 1.55; }
.oev { line-height: 1.5; }
.delbtn { font-size: 10.5px; padding: 1px 8px; }
.obsexport { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.obsexport textarea { font-family: var(--mono); font-size: 11px; background: #0f1116; color: var(--fg-dim); border: 1px solid var(--line); border-radius: 6px; padding: 6px; width: 100%; }
@media (max-width: 1100px) { .dgrid, .cols { grid-template-columns: 1fr; } }
</style>
