<script setup lang="ts">
// 御魂选择器：70 条图标网格 + Engine Support 前置告知（UX 护栏 #5）
import { computed, ref, watch } from "vue";
import { searchSouls, SOUL_SUPPORT_LABEL } from "../../kb/useKb";
import type { SoulIndexEntry } from "../../kb/useKb";
import { soulName } from "../../kb/names.ts";
import { soulDescText, soulSuitText } from "../../kb/en-text.ts";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: "pick", v: SoulIndexEntry | null): void; (e: "close"): void }>();

const q = ref("");
const hover = ref<SoulIndexEntry | null>(null);
const list = computed(() => searchSouls(q.value));
watch(() => props.open, v => { if (v) { q.value = ""; hover.value = null; } });

const SUPPORT_COLOR: Record<string, string> = { FULL: "var(--ok)", PARTIAL: "var(--warn)", UNSUPPORTED: "var(--danger)" };
</script>

<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <div class="dialog">
      <header>
        <input class="search" v-model="q" placeholder="🔍 Search souls (English / Chinese name / type / 2-piece)" autofocus />
        <button @click="emit('pick', null)">No soul</button>
        <button @click="emit('close')">✕</button>
      </header>
      <div class="body">
        <div class="grid">
          <button v-for="s in list" :key="s.i" class="cell" :class="{ on: hover?.i === s.i }"
                  @mouseenter="hover = s" @click="emit('pick', s)">
            <span class="dot" :style="{ background: SUPPORT_COLOR[s.engine.support] }" :title="SOUL_SUPPORT_LABEL[s.engine.support]" />
            <span class="nm" :title="s.n">{{ soulName(s.i, s.n) }}</span>
          </button>
        </div>
        <aside class="detail">
          <template v-if="hover">
            <h4>{{ soulName(hover.i, hover.n) }}<span v-if="soulName(hover.i, hover.n) !== hover.n" class="cn">{{ hover.n }}</span></h4>
            <div class="block"><span class="k">2-piece</span><span>{{ soulSuitText(hover.i, hover.suit) || "—" }}</span></div>
            <div class="block"><span class="k">4-piece</span><span class="desc">{{ soulDescText(hover.i, hover.desc) || "—" }}</span></div>
            <div class="block">
              <span class="k">Betting mode</span>
              <span class="ok">✓ Battle effect enabled</span>
              <span class="dim">— static stats not double-counted</span>
            </div>
            <div class="block">
              <span class="k">Engine Support</span>
              <span :style="{ color: SUPPORT_COLOR[hover.engine.support] }">
                {{ hover.engine.support }} · {{ SOUL_SUPPORT_LABEL[hover.engine.support] }}
              </span>
            </div>
            <div class="mono small dim">
              trigger: {{ hover.engine.trigger ?? "unrecognized" }}<br />
              effect: {{ hover.engine.effectKind }}<br />
              params: {{ hover.engine.magnitudes.join(", ") || "—" }}
            </div>
            <div v-if="hover.engine.support !== 'FULL'" class="warnbox">
              ⚠ This soul's battle effect is not fully implemented; simulations will underestimate its impact.
            </div>
          </template>
          <div v-else class="dim small">Hover a soul to see details and engine support status</div>
        </aside>
      </div>
      <footer class="legend">
        <span><i class="dot" style="background: var(--ok)" />Fully implemented</span>
        <span><i class="dot" style="background: var(--warn)" />Partially implemented</span>
        <span><i class="dot" style="background: var(--danger)" />Not implemented</span>
        <span class="dim">{{ list.length }} total</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: #0009; display: grid; place-items: center; z-index: 100; }
.dialog { width: min(940px, 94vw); max-height: 82vh; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
header { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid var(--line); }
.search { flex: 1; padding: 8px 10px; font-size: 14px; }
.body { display: grid; grid-template-columns: 1fr 300px; min-height: 0; }
.grid { overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 5px; padding: 12px; align-content: start; }
.cell { display: flex; align-items: center; gap: 6px; padding: 6px 8px; font-size: 12px; text-align: left; }
.cell.on { background: #2b4a7a; border-color: #3a5f96; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; }
.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail { border-left: 1px solid var(--line); padding: 12px; overflow: auto; }
.detail h4 { margin: 0 0 10px; font-size: 14px; }
.detail h4 .cn { margin-left: 8px; font-size: 11px; font-weight: 400; color: var(--fg-faint); }
.block { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; font-size: 12px; }
.k { color: var(--fg-faint); font-size: 11px; }
.desc { color: var(--fg-dim); line-height: 1.5; }
.ok { color: var(--ok); } .dim { color: var(--fg-dim); } .small { font-size: 11px; }
.warnbox { margin-top: 10px; padding: 8px; border-radius: 6px; background: #2a2213; border: 1px solid #6b5520; color: var(--warn); font-size: 11px; line-height: 1.5; }
.legend { display: flex; gap: 14px; align-items: center; padding: 7px 12px; border-top: 1px solid var(--line); font-size: 11px; color: var(--fg-dim); }
.legend span { display: flex; align-items: center; gap: 5px; }
@media (max-width: 900px) { .body { grid-template-columns: 1fr; } .detail { border-left: none; border-top: 1px solid var(--line); } }
</style>
