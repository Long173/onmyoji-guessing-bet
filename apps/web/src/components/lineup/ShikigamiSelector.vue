<script setup lang="ts">
// 式神选择器：276 只完整图鉴，支持 正式名 / 别名 / 拼音 / 首字母 / ID
import { computed, ref, watch } from "vue";
import { searchShikigami, recentShikigami, RARITIES, pushRecent } from "../../kb/useKb";
import type { ShikigamiIndexEntry } from "../../kb/useKb";
import { shikigamiName } from "../../kb/names.ts";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "pick", v: ShikigamiIndexEntry): void; (e: "close"): void }>();

const q = ref("");
const rarity = ref<string | null>(null);
const results = computed(() => searchShikigami(q.value, rarity.value));
const recent = computed(() => recentShikigami());

watch(() => props.open, (v) => { if (v) { q.value = ""; rarity.value = null; } });

function pick(x: ShikigamiIndexEntry) { pushRecent(x.i); emit("pick", x); }
const RCOLOR: Record<string, string> = { SP: "#c96bd6", SSR: "#e0a34f", SR: "#7fa8e0", R: "#6fb98a", N: "#8b93a5", UR: "#e0654f" };
</script>

<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <div class="dialog">
      <header>
        <input class="search" v-model="q" placeholder="🔍 Search shikigami (English / Chinese name / alias / pinyin / initials / ID)" autofocus />
        <button @click="emit('close')">✕</button>
      </header>

      <div v-if="!q && recent.length" class="section">
        <div class="label">Recently used</div>
        <div class="recent">
          <button v-for="x in recent" :key="x.i" class="chip" @click="pick(x)" :title="x.n">{{ shikigamiName(x.i, x.n) }}</button>
        </div>
      </div>

      <div class="rarities">
        <button :class="{ on: rarity === null }" @click="rarity = null">All</button>
        <button v-for="r in RARITIES" :key="r" :class="{ on: rarity === r }" @click="rarity = r">{{ r }}</button>
      </div>

      <div class="grid">
        <button v-for="x in results" :key="x.i" class="item" @click="pick(x)">
          <span class="r" :style="{ color: RCOLOR[x.r] ?? '#999', borderColor: RCOLOR[x.r] ?? '#999' }">{{ x.r }}</span>
          <span class="nm" :title="x.k ? x.n + ' / ' + x.k : x.n">{{ shikigamiName(x.i, x.n) }}<span v-if="shikigamiName(x.i, x.n) !== x.n" class="alias">{{ x.n }}</span></span>
          <span class="meta mono">#{{ x.i }}<template v-if="x.y"> · {{ x.y }}</template></span>
        </button>
        <div v-if="!results.length" class="empty">No matching shikigami</div>
      </div>
      <footer class="hint">{{ results.length }} results<template v-if="results.length >= 60"> (showing first 60; keep typing to narrow)</template></footer>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: #0009; display: grid; place-items: center; z-index: 100; }
.dialog { width: min(880px, 92vw); max-height: 82vh; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
header { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid var(--line); }
.search { flex: 1; padding: 8px 10px; font-size: 14px; }
.section { padding: 8px 12px; border-bottom: 1px solid var(--line); }
.label { font-size: 11px; color: var(--fg-faint); margin-bottom: 6px; }
.recent { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { padding: 3px 9px; font-size: 12px; }
.rarities { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
.rarities button { padding: 3px 10px; font-size: 12px; }
.rarities button.on { background: #2b4a7a; border-color: #3a5f96; }
.grid { overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px; padding: 12px; }
.item { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; gap: 0 6px; text-align: left; padding: 7px 9px; }
.r { grid-row: span 2; align-self: center; font-size: 10px; border: 1px solid; border-radius: 4px; padding: 1px 4px; font-family: var(--mono); }
.nm { font-weight: 600; font-size: 13px; }
.alias { color: var(--fg-faint); font-size: 11px; margin-left: 6px; font-weight: 400; }
.meta { grid-column: 2; color: var(--fg-faint); font-size: 10px; }
.empty { grid-column: 1/-1; text-align: center; color: var(--fg-faint); padding: 30px; }
.hint { padding: 6px 12px; border-top: 1px solid var(--line); color: var(--fg-faint); font-size: 11px; }
</style>
