<script setup lang="ts">
// Import from screenshot: paste (Ctrl+V) / drop / pick 1–2 Global-client Lineup screenshots → each table found
// becomes an editable review grid (names, 8 stats, soul) with doubtful cells highlighted → "Apply to Red/Blue".
// All OCR runs in the browser (tesseract.js served from /tesseract/), nothing leaves the machine.
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { GuessingUnitInput } from "../../contracts/guessing-match";
import { STAT_LABELS, PERCENT_STAT_KEYS } from "../../contracts/guessing-match";
import ScreenshotOverlay from "./ScreenshotOverlay.vue";
import type { ReviewTable, ReviewUnit } from "../../screenshot/review";
import { blockingIssues, countFlags, toGuessingUnits, toReview } from "../../screenshot/review";
import { ROW_KEYS } from "../../screenshot/parse";
import type { RowKey } from "../../screenshot/parse";
import { nameCandidates, shikigamiEnName, soulOptions } from "../../screenshot/kb-bridge";
import { SHIKIGAMI } from "../../kb/useKb";

type Side = "red" | "blue";
const emit = defineEmits<{ (e: "apply", payload: { side: Side; units: GuessingUnitInput[] }): void }>();

const open = ref(false);
const busy = ref(false);
const progress = ref<{ done: number; total: number; label: string } | null>(null);
const error = ref<string | null>(null);
const tables = ref<ReviewTable[]>([]);
const activeKey = ref<string | null>(null);
const focus = ref<{ c: number; r: number } | null>(null);
const applied = ref<Record<string, Side>>({});
const otherName = ref<Record<number, string>>({});
const fileInput = ref<HTMLInputElement | null>(null);
let seq = 0;

const ALL_NAMES = nameCandidates(new Set(SHIKIGAMI.map(s => s.i))).sort((a, b) => a.en.localeCompare(b.en));
const SOULS = soulOptions();
const OTHER = -1;

const active = computed(() => tables.value.find(t => t.key === activeKey.value) ?? null);
const issues = computed(() => (active.value ? blockingIssues(active.value) : []));
const flagged = computed(() => (active.value?.units ?? []).map(u => [
  u.nameDoubtful, ...ROW_KEYS.map(k => u.statFlags[k].doubtful), u.soulDoubtful,
]));
const sidesPresent = computed(() => new Set(tables.value.map(t => t.side).filter(Boolean)));

function show() { open.value = true; error.value = null; }
function close() { open.value = false; focus.value = null; }

function isEditable(el: EventTarget | null): boolean {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable);
}

function imagesFrom(list: DataTransferItemList | FileList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const it of Array.from(list as ArrayLike<DataTransferItem | File>)) {
    const f = it instanceof File ? it : it.kind === "file" ? it.getAsFile() : null;
    if (f && f.type.startsWith("image/")) out.push(f);
  }
  return out;
}

function onWindowPaste(e: ClipboardEvent) {
  const files = imagesFrom(e.clipboardData?.items);
  if (!files.length) return;
  if (!open.value && isEditable(e.target)) return;
  e.preventDefault();
  open.value = true;
  void addFiles(files);
}
function onDrop(e: DragEvent) { void addFiles(imagesFrom(e.dataTransfer?.files)); }
function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  void addFiles(imagesFrom(input.files));
  input.value = "";
}

async function addFiles(files: File[]) {
  if (!files.length || busy.value) return;
  busy.value = true; error.value = null;
  try {
    const { blobToRgba, parseImage } = await import("../../screenshot/browser");
    for (const [i, f] of files.slice(0, 2).entries()) {
      const label = `${f.name || "pasted image"} (${i + 1}/${Math.min(2, files.length)})`;
      progress.value = { done: 0, total: 1, label: "Loading OCR… " + label };
      const img = await blobToRgba(f);
      const parsed = await parseImage(img, (done, total) => { progress.value = { done, total, label }; });
      if (!parsed.length) { error.value = `No Lineup table found in ${f.name || "the pasted image"}. Use the in-game Lineup screen (English client).`; continue; }
      for (const p of parsed) addTable(toReview(p, f.name || "pasted image", "t" + ++seq));
    }
  } catch (e: unknown) {
    error.value = "Screenshot import failed: " + (e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false; progress.value = null;
  }
}

/** A newer table for the same team replaces the older one. */
function addTable(t: ReviewTable) {
  const rest = t.side ? tables.value.filter(x => x.side !== t.side) : tables.value;
  tables.value = [...rest, t];
  activeKey.value = t.key;
}

function removeTable(key: string) {
  tables.value = tables.value.filter(t => t.key !== key);
  if (activeKey.value === key) activeKey.value = tables.value[0]?.key ?? null;
}

function nameOptions(u: ReviewUnit) {
  const top = u.nameCandidates.slice(0, 6);
  if (u.shikigamiId && !top.some(c => c.id === u.shikigamiId)) {
    return [{ id: u.shikigamiId, en: shikigamiEnName(u.shikigamiId), score: NaN }, ...top];
  }
  return top;
}
function onNameSelect(c: number, u: ReviewUnit, v: string) {
  const id = Number(v);
  if (id === OTHER) { otherName.value = { ...otherName.value, [c]: "" }; return; }
  u.shikigamiId = id || null; u.nameDoubtful = false;
  const { [c]: _drop, ...rest } = otherName.value; otherName.value = rest;
}
function onOtherName(c: number, u: ReviewUnit, v: string) {
  otherName.value = { ...otherName.value, [c]: v };
  const hit = ALL_NAMES.find(n => n.en.toLowerCase() === v.trim().toLowerCase());
  if (hit) { u.shikigamiId = hit.id; u.nameDoubtful = false; }
}
function onStat(u: ReviewUnit, k: RowKey, v: string) {
  const n = v.trim() === "" ? null : Number(v);
  u.stats[k] = n != null && Number.isFinite(n) ? n : null;
  u.statFlags[k] = { ...u.statFlags[k], doubtful: false };
}
function onSoul(u: ReviewUnit, v: string) { u.soulId = v === "" ? null : Number(v); u.soulDoubtful = false; }

function nameCaption(u: ReviewUnit): string {
  const c = u.nameCandidates.find(x => x.id === u.shikigamiId);
  if (!u.shikigamiId) return "not recognised";
  return c ? `match ${Math.round(Math.min(1, c.score) * 100)}%` : "set by hand";
}
function soulCaption(u: ReviewUnit): string {
  if (u.soulId == null) return u.soulCandidates.length ? `closest: ${u.soulCandidates[0].en}` : "no icon found";
  const c = u.soulCandidates.find(x => x.soulId === u.soulId);
  return c ? `icon distance ${Math.max(0, c.distance).toFixed(2)}` : "set by hand";
}
function statTitle(u: ReviewUnit, k: RowKey): string {
  const f = u.statFlags[k];
  return [f.raw ? `OCR read "${f.raw}"` : "", f.note].filter(Boolean).join(" · ");
}

function apply(t: ReviewTable) {
  if (!t.side || blockingIssues(t).length) return;
  emit("apply", { side: t.side, units: toGuessingUnits(t) });
  applied.value = { ...applied.value, [t.key]: t.side };
}
function applyAll() {
  const ready = tables.value.filter(t => t.side && !blockingIssues(t).length);
  for (const t of ready) apply(t);
  if (ready.length === tables.value.length) close();
}

onMounted(() => window.addEventListener("paste", onWindowPaste));
onBeforeUnmount(() => {
  window.removeEventListener("paste", onWindowPaste);
  void import("../../screenshot/browser").then(m => m.disposeOcr());
});
</script>

<template>
  <button @click="show" title="Read a team from an in-game Lineup screenshot (Ctrl+V anywhere also works)">Import screenshot</button>
  <div v-if="open" class="overlay" @click.self="close">
    <div class="dialog" @dragover.prevent @drop.prevent="onDrop">
      <header>
        <b>Import from Lineup screenshot</b>
        <span class="dim tiny">Global client, English · each table = one team · OCR runs locally</span>
        <span class="spacer" />
        <button @click="close">✕</button>
      </header>

      <div class="drop" :class="{ busy }" @click="!busy && fileInput?.click()">
        <template v-if="!busy">Paste (<b>Ctrl+V</b>), drop or <u>choose</u> 1–2 Lineup screenshots</template>
        <template v-else>{{ progress?.label ?? "Working…" }}</template>
        <div v-if="progress" class="bar"><i :style="{ width: (100 * progress.done / Math.max(1, progress.total)) + '%' }" /></div>
        <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onPick" />
      </div>
      <div v-if="error" class="err">✗ {{ error }}</div>

      <nav v-if="tables.length" class="tabs">
        <button v-for="t in tables" :key="t.key" class="tab" :class="[t.side ?? 'none', { on: t.key === activeKey }]" @click="activeKey = t.key">
          {{ t.side === "red" ? "Red" : t.side === "blue" ? "Blue" : "Team ?" }} · {{ t.source }}
          <span v-if="countFlags(t)" class="pill warn">{{ countFlags(t) }} to review</span>
          <span v-if="applied[t.key]" class="pill ok">applied</span>
          <span class="x" title="Remove" @click.stop="removeTable(t.key)">✕</span>
        </button>
      </nav>

      <section v-if="active" class="body">
        <div class="left">
          <ScreenshotOverlay :table="active.parsed" :flagged="flagged" :focus="focus" />
          <p v-for="w in active.parsed.warnings" :key="w" class="dim tiny">⚠ {{ w }}</p>
        </div>
        <div class="right" @mouseleave="focus = null">
          <table class="grid">
            <thead>
              <tr>
                <th>
                  <select v-model="active.side" class="side" :class="active.side ?? ''">
                    <option :value="null" disabled>Team?</option><option value="red">Red</option><option value="blue">Blue</option>
                  </select>
                </th>
                <th v-for="(u, c) in active.units" :key="c" :class="{ warn: u.nameDoubtful }" @mouseenter="focus = { c, r: 0 }"
                    :title="'OCR read: ' + (u.nameRaw.join(' | ') || '—')">
                  <select :value="otherName[c] !== undefined ? OTHER : (u.shikigamiId ?? '')" @change="onNameSelect(c, u, ($event.target as HTMLSelectElement).value)" @focus="focus = { c, r: 0 }">
                    <option value="" disabled>Pick…</option>
                    <option v-for="o in nameOptions(u)" :key="o.id" :value="o.id">{{ o.en }}</option>
                    <option :value="OTHER">Other…</option>
                  </select>
                  <input v-if="otherName[c] !== undefined" class="other" list="ssi-names" placeholder="Type a name"
                         :value="otherName[c]" @input="onOtherName(c, u, ($event.target as HTMLInputElement).value)" />
                  <div class="cap">{{ nameCaption(u) }}</div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(k, r) in ROW_KEYS" :key="k">
                <td class="lbl">{{ STAT_LABELS[k] }}<span v-if="PERCENT_STAT_KEYS.includes(k)" class="dim"> %</span></td>
                <td v-for="(u, c) in active.units" :key="c" :class="{ warn: u.statFlags[k].doubtful }" @mouseenter="focus = { c, r: r + 1 }">
                  <input type="number" :value="u.stats[k] ?? ''" :title="statTitle(u, k)"
                         @focus="focus = { c, r: r + 1 }" @change="onStat(u, k, ($event.target as HTMLInputElement).value)" />
                </td>
              </tr>
              <tr>
                <td class="lbl">Soul</td>
                <td v-for="(u, c) in active.units" :key="c" :class="{ warn: u.soulDoubtful }" @mouseenter="focus = { c, r: 9 }">
                  <select :value="u.soulId ?? ''" @focus="focus = { c, r: 9 }" @change="onSoul(u, ($event.target as HTMLSelectElement).value)">
                    <option value="">— unknown —</option>
                    <optgroup v-if="u.soulCandidates.length" label="Closest icons">
                      <option v-for="s in u.soulCandidates" :key="'c' + s.soulId" :value="s.soulId">{{ s.en }}</option>
                    </optgroup>
                    <optgroup label="All souls">
                      <option v-for="s in SOULS" :key="s.id" :value="s.id">{{ s.en }}</option>
                    </optgroup>
                  </select>
                  <div class="cap">{{ soulCaption(u) }}</div>
                </td>
              </tr>
            </tbody>
          </table>
          <ul v-if="issues.length" class="issues"><li v-for="i in issues" :key="i">{{ i }}</li></ul>
          <p v-else-if="countFlags(active)" class="dim tiny">Orange cells were read with low confidence — check them against the picture (hover a cell to locate it), then apply.</p>
          <footer>
            <button class="primary" :disabled="!active.side || issues.length > 0" @click="apply(active)">
              Apply to {{ active.side === "blue" ? "Blue" : active.side === "red" ? "Red" : "…" }}
            </button>
            <button v-if="tables.length > 1 && sidesPresent.size === 2" @click="applyAll">Apply both teams</button>
            <span v-if="applied[active.key]" class="dim small">Written to {{ applied[active.key] === "red" ? "Red" : "Blue" }} — the current lineup of that team was replaced.</span>
          </footer>
        </div>
      </section>
      <datalist id="ssi-names"><option v-for="n in ALL_NAMES" :key="n.id" :value="n.en" /></datalist>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: #0009; display: grid; place-items: center; z-index: 100; }
.dialog { width: min(1280px, 96vw); max-height: 92vh; display: flex; flex-direction: column; background: var(--panel2); border: 1px solid var(--line); border-radius: 12px; overflow: auto; }
header { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--panel2); z-index: 1; }
.spacer { flex: 1; }
.dim { color: var(--fg-dim); } .tiny { font-size: 10.5px; } .small { font-size: 12px; }
.drop { margin: 12px; padding: 14px; border: 1px dashed var(--gold-dim); border-radius: var(--radius-sm); text-align: center; color: var(--fg-dim); cursor: pointer; }
.drop:hover:not(.busy) { border-color: var(--gold); color: var(--fg); }
.drop.busy { cursor: progress; }
.bar { height: 3px; background: #0e0c0a; border-radius: 2px; overflow: hidden; margin-top: 8px; }
.bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--red), var(--gold), var(--blue)); transition: width .2s; }
.err { margin: 0 12px 8px; background: #2a1614; border: 1px solid #6b2f28; color: var(--danger); padding: 6px 10px; border-radius: var(--radius-sm); font-size: 12px; }
.tabs { display: flex; gap: 6px; padding: 0 12px; flex-wrap: wrap; }
.tab { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.tab.on { border-color: var(--gold-dim); background: linear-gradient(180deg, #2b2415, #221e19); }
.tab.red { box-shadow: inset 3px 0 0 var(--red); } .tab.blue { box-shadow: inset 3px 0 0 var(--blue); }
.tab .x { color: var(--fg-faint); padding-left: 2px; } .tab .x:hover { color: var(--danger); }
.pill { font-family: var(--mono); font-size: 10px; padding: 0 6px; border-radius: 999px; border: 1px solid var(--line); }
.pill.warn { color: var(--warn); border-color: #6b5520; background: #2a2213; }
.pill.ok { color: var(--ok); border-color: #2f5741; background: #16241c; }
.body { display: grid; grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); gap: 14px; padding: 12px; align-items: start; }
.grid { width: 100%; border-collapse: collapse; font-size: 12px; }
.grid th, .grid td { border: 1px solid var(--line); padding: 2px; }
.grid td.lbl { color: var(--fg-dim); white-space: nowrap; padding: 2px 6px; }
.grid input, .grid select { width: 100%; min-width: 0; padding: 3px 4px; font-size: 12px; }
.grid input[type="number"] { font-family: var(--mono); text-align: right; }
.grid .warn { background: #3a2a12; }
.grid .warn input, .grid .warn select { border-color: var(--warn); }
.side.red { color: #e9a199; border-color: var(--red); } .side.blue { color: #9fbfe2; border-color: var(--blue); }
.other { margin-top: 2px; }
.cap { font-size: 9.5px; color: var(--fg-faint); font-weight: normal; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grid .warn .cap { color: var(--warn); }
.issues { margin: 8px 0 0; padding-left: 18px; color: var(--warn); font-size: 11.5px; }
footer { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
@media (max-width: 1023px) { .body { grid-template-columns: 1fr; } }
</style>
