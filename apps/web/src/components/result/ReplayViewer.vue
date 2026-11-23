<script setup lang="ts">
// components/result/ReplayViewer.vue — UI-4 逐步回放 + 事件检查器
// 事件流由 Worker 用**相同的 seed** 重跑得到，因此这就是刚才那一场战斗本身。
// 生命值快照由 DAMAGE / HP_LOSS / DEATH / REVIVE 事件累加还原（不依赖引擎额外记录）。
import { computed, ref, watch } from "vue";
import type { ReplayEvent, ReplayUnit } from "../../contracts/worker-api.ts";
import { displayName } from "../../kb/names.ts";
import { enEngine } from "../../kb/en-engine.ts";

const props = defineProps<{
  seed: number;
  events: ReplayEvent[];
  units: ReplayUnit[];
  turns: number;
  winner: "red" | "blue" | "draw" | "timeout";
}>();
const emit = defineEmits<{ (e: "close"): void }>();

const idx = ref(0);
const playing = ref(false);
const speed = ref(1);
const showRaw = ref(false);
let timer: any = null;

const copied = ref(false);
async function copySeed() {
  try { await navigator.clipboard.writeText(String(props.seed)); copied.value = true; setTimeout(() => (copied.value = false), 1500); }
  catch { copied.value = false; }
}

const ev = computed<ReplayEvent | null>(() => props.events[idx.value] ?? null);
const total = computed(() => props.events.length);
const byId = computed(() => new Map(props.units.map(u => [u.unitId, u])));

/** 逐事件累加出的生命值/存活状态（用于步进时还原战场） */
const states = computed(() => {
  const hp = new Map<string, number>();
  const alive = new Map<string, boolean>();
  for (const u of props.units) { hp.set(u.unitId, u.maxHp); alive.set(u.unitId, true); }
  const out: Array<{ hp: Map<string, number>; alive: Map<string, boolean> }> = [];
  for (const e of props.events) {
    const d = (e.detail ?? {}) as any;
    const uid = (id: any) => props.units.find(u => u.unitId === String(id))?.unitId;
    switch (e.code) {
      case "DAMAGE": case "HP_LOSS": {
        const t = e.targetUnitId ?? uid(d.dst);
        if (t && hp.has(t)) hp.set(t, Math.max(0, (hp.get(t) ?? 0) - Number(d.applied ?? d.amount ?? 0)));
        break;
      }
      case "DEATH": {
        const v = e.targetUnitId ?? uid(d.id);
        if (v) { alive.set(v, false); hp.set(v, 0); }
        break;
      }
      case "REVIVE": {
        const v = e.targetUnitId ?? uid(d.id);
        if (v) { alive.set(v, true); hp.set(v, Number(d.hp ?? 0)); }
        break;
      }
    }
    out.push({ hp: new Map(hp), alive: new Map(alive) });
  }
  return out;
});
const cur = computed(() => states.value[idx.value] ?? null);

const grouped = computed(() => {
  const g: Array<{ turn: number; from: number; to: number }> = [];
  props.events.forEach((e, i) => {
    const last = g[g.length - 1];
    if (last && last.turn === e.turn) last.to = i;
    else g.push({ turn: e.turn, from: i, to: i });
  });
  return g;
});

function stop() { playing.value = false; clearInterval(timer); timer = null; }
function play() {
  if (playing.value) return stop();
  playing.value = true;
  timer = setInterval(() => {
    if (idx.value >= total.value - 1) return stop();
    idx.value++;
  }, Math.max(30, 320 / speed.value));
}
function goto(i: number) { idx.value = Math.max(0, Math.min(total.value - 1, i)); }
function jumpTurn(dir: number) {
  const t = ev.value?.turn ?? 0;
  const target = grouped.value.find(g => dir > 0 ? g.turn > t : g.turn < t);
  if (target) idx.value = dir > 0 ? target.from : target.from;
}
watch(() => props.seed, () => { stop(); idx.value = 0; });
watch(total, () => { idx.value = 0; });
const pctHp = (u: ReplayUnit) => { const h = cur.value?.hp.get(u.unitId) ?? u.maxHp; return Math.max(0, Math.min(100, (h / u.maxHp) * 100)); };
const WIN: Record<string, string> = { red: "Red wins", blue: "Blue wins", draw: "Draw (both wiped out)", timeout: "Unfinished (turn limit exceeded)" };
</script>

<template>
  <section class="viewer">
    <header class="head">
      <b>Step-by-step replay</b>
      <span class="mono tiny dim">seed {{ seed }} · {{ total }} events · {{ turns }} turns</span>
      <span class="badge" :class="winner">{{ WIN[winner] }}</span>
      <span class="spacer" />
      <button class="tiny-btn" @click="copySeed" :title="'Copy the seed that reproduces this battle'">{{ copied ? "Copied ✓" : "Copy seed" }}</button>
      <button class="x" @click="emit('close')">✕</button>
    </header>

    <!-- 战场快照 -->
    <div class="board">
      <div v-for="side in (['red','blue'] as const)" :key="side" class="team" :class="side">
        <div class="tname">{{ side === "red" ? "🔴 Red" : "🔵 Blue" }}</div>
        <div v-for="u in units.filter(x => x.side === side)" :key="u.unitId" class="unit"
             :class="{ dead: !(cur?.alive.get(u.unitId) ?? true), active: ev?.actorUnitId === u.unitId || ev?.targetUnitId === u.unitId }">
          <div class="nm">{{ enEngine(displayName(u.name)) }}</div>
          <div class="hpbar"><i :style="{ width: pctHp(u) + '%' }" /></div>
          <div class="mono tiny dim">{{ Math.round(cur?.hp.get(u.unitId) ?? u.maxHp) }} / {{ u.maxHp }}</div>
        </div>
      </div>
    </div>

    <!-- 控制条 -->
    <div class="controls">
      <button @click="goto(0)">⏮</button>
      <button @click="jumpTurn(-1)">⏪ Prev turn</button>
      <button @click="goto(idx - 1)">◀</button>
      <button class="play" @click="play">{{ playing ? "⏸ Pause" : "▶ Play" }}</button>
      <button @click="goto(idx + 1)">▶</button>
      <button @click="jumpTurn(1)">⏩ Next turn</button>
      <button @click="goto(total - 1)">⏭</button>
      <label class="sp">Speed <input type="range" min="1" max="8" v-model.number="speed" /></label>
      <span class="mono small dim">{{ idx + 1 }} / {{ total }}</span>
    </div>
    <input class="scrub" type="range" min="0" :max="Math.max(0, total - 1)" :value="idx" @input="goto(+($event.target as HTMLInputElement).value)" />

    <div class="panes">
      <!-- 事件流 -->
      <div class="stream">
        <template v-for="g in grouped" :key="g.turn">
          <div class="turnsep" :class="{ cur: ev && ev.turn === g.turn }">Turn {{ g.turn }}</div>
          <button v-for="i in (g.to - g.from + 1)" :key="g.from + i - 1"
                  class="evrow" :class="{ on: idx === g.from + i - 1 }"
                  @click="goto(g.from + i - 1)">
            <span class="code mono">{{ events[g.from + i - 1].code }}</span>
            <span class="txt">{{ enEngine(events[g.from + i - 1].text) }}</span>
          </button>
        </template>
        <div v-if="!total" class="dim small">No events.</div>
      </div>

      <!-- 事件检查器 -->
      <aside class="insp">
        <div class="ititle">Event inspector</div>
        <template v-if="ev">
          <div class="kv"><span class="k">Index</span><span class="mono">#{{ ev.index }}</span></div>
          <div class="kv"><span class="k">Turn</span><span class="mono">{{ ev.turn }}</span></div>
          <div class="kv"><span class="k">Type</span><span class="mono">{{ ev.code }}</span></div>
          <div class="kv"><span class="k">Actor</span><span>{{ ev.actorUnitId ? (byId.get(ev.actorUnitId) ? enEngine(displayName(byId.get(ev.actorUnitId)!.name)) : ev.actorUnitId) : "—" }}</span></div>
          <div class="kv"><span class="k">Target</span><span>{{ ev.targetUnitId ? (byId.get(ev.targetUnitId) ? enEngine(displayName(byId.get(ev.targetUnitId)!.name)) : ev.targetUnitId) : "—" }}</span></div>
          <p class="desc">{{ enEngine(ev.text) }}</p>
          <button class="tiny-btn" @click="showRaw = !showRaw">{{ showRaw ? "Hide" : "Show" }} raw fields</button>
          <pre v-if="showRaw" class="raw">{{ JSON.stringify(ev.detail, null, 1) }}</pre>
          <p class="note">The engine's event stream is the <b>only</b> source of battle facts: every number on the dashboard can be traced to an event here.</p>
        </template>
        <div v-else class="dim small">Select an event to see its details.</div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.viewer { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
.head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.spacer { flex: 1; }
.badge { font-size: 11px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line); }
.badge.red { color: var(--red); border-color: #6b2f28; } .badge.blue { color: var(--blue); border-color: #2b4a7a; }
.badge.draw, .badge.timeout { color: var(--warn); border-color: #6b5520; }
.board { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 12px 14px; }
.team { display: flex; flex-direction: column; gap: 5px; }
.tname { font-size: 11px; color: var(--fg-faint); }
.unit { padding: 5px 8px; border: 1px solid var(--line); border-radius: 7px; transition: .15s; }
.unit.active { border-color: var(--blue); background: #1a2233; }
.unit.dead { opacity: .38; }
.unit .nm { font-size: 12px; }
.hpbar { height: 4px; background: #0f1116; border-radius: 2px; overflow: hidden; margin: 3px 0 2px; }
.team.red .hpbar i { display: block; height: 100%; background: var(--red); }
.team.blue .hpbar i { display: block; height: 100%; background: var(--blue); }
.controls { display: flex; align-items: center; gap: 6px; padding: 0 14px 6px; flex-wrap: wrap; }
.controls button { font-size: 12px; padding: 4px 9px; }
.controls .play { background: #2b4a7a; border-color: #3a5f96; }
.controls .sp { font-size: 11px; color: var(--fg-faint); display: flex; align-items: center; gap: 5px; }
.scrub { margin: 0 14px 10px; }
.panes { display: grid; grid-template-columns: 1fr 340px; border-top: 1px solid var(--line); min-height: 0; }
.stream { max-height: 46vh; overflow-y: auto; padding: 6px 0; }
.turnsep { position: sticky; top: 0; background: var(--panel2); color: var(--fg-faint); font-size: 10.5px; padding: 3px 12px; z-index: 1; }
.turnsep.cur { color: var(--fg); }
.evrow { display: grid; grid-template-columns: 128px 1fr; gap: 8px; width: 100%; text-align: left; background: none; border: none; border-radius: 0; padding: 3px 12px; font-size: 12px; color: var(--fg-dim); }
.evrow:hover { background: var(--panel2); }
.evrow.on { background: #1a2233; color: var(--fg); }
.evrow .code { font-size: 10px; color: var(--fg-faint); }
.evrow.on .code { color: var(--blue); }
.insp { border-left: 1px solid var(--line); padding: 12px; display: flex; flex-direction: column; gap: 6px; }
.ititle { font-size: 12px; color: var(--fg-dim); font-weight: 600; margin-bottom: 4px; }
.kv { display: grid; grid-template-columns: 60px 1fr; gap: 8px; font-size: 12px; }
.kv .k { color: var(--fg-faint); }
.desc { font-size: 12px; color: var(--fg); margin: 6px 0; line-height: 1.6; }
.tiny-btn { font-size: 11px; padding: 3px 8px; align-self: flex-start; }
.raw { max-height: 200px; overflow: auto; background: #0f1116; border: 1px solid var(--line); border-radius: 6px; padding: 8px; font-family: var(--mono); font-size: 10.5px; color: var(--fg-dim); }
.note { font-size: 10.5px; color: var(--fg-faint); line-height: 1.6; margin-top: auto; }
.small { font-size: 12px; } .tiny { font-size: 10px; } .dim { color: var(--fg-dim); }
</style>
