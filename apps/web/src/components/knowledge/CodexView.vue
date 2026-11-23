<script setup lang="ts">
// CodexView.vue — UI-5 知识库页：式神图鉴 / 御魂图鉴 / 术语表
// 数据全部来自 kb/useKb 的索引（首屏加载），详情抽屉复用 knowledge/DetailDrawer.vue。
// 本组件不接触引擎：页面只读知识库索引，不引用任何引擎模块。
import { computed, ref } from "vue";
import {
  SHIKIGAMI, SOULS, GLOSSARY, RARITIES,
  searchShikigami, searchSouls, SOUL_SUPPORT_LABEL,
} from "../../kb/useKb";
import type { ShikigamiIndexEntry, SoulIndexEntry } from "../../kb/useKb";
import DetailDrawer from "./DetailDrawer.vue";
import { shikigamiName, soulName } from "../../kb/names.ts";
import { soulDescText, soulSuitText, tagText, tipDesc, tipName } from "../../kb/en-text.ts";
import type { GuessingUnitInput } from "../../contracts/guessing-match";

/** 数据来源与版本（与 adapters 的 GAME_DATA_VERSION 对齐） */
const DATA_VERSION = "GameData 2026-10-01";

type Tab = "shikigami" | "souls" | "glossary";
const tab = ref<Tab>("shikigami");
const TABS: Array<{ id: Tab; label: string; count: number }> = [
  { id: "shikigami", label: "Shikigami", count: SHIKIGAMI.length },
  { id: "souls", label: "Souls", count: SOULS.length },
  { id: "glossary", label: "Glossary", count: GLOSSARY.length },
];

// ───────────── 式神图鉴 ─────────────
const sq = ref("");
const rarity = ref<string | null>(null);
const list = computed(() => searchShikigami(sq.value, rarity.value));
function toggleRarity(r: string) { rarity.value = rarity.value === r ? null : r; }

const drawerUnit = ref<GuessingUnitInput | null>(null);
const drawerTab = ref<"skills" | "ai" | "soul">("skills");

/**
 * 图鉴卡片 → 抽屉输入（抽屉只需要 GuessingUnitInput 形状）。
 * stats 直接取该式神的六星觉醒面板 pn = [攻,生,防,速,暴击%,爆伤%,命中%,抵抗%]；
 * 源数据缺失的维度填 0（不猜、不插值），unitId 用稳定字符串仅作 UI 定位。
 */
function unitOf(x: ShikigamiIndexEntry): GuessingUnitInput {
  const pn = x.pn ?? [];
  const at = (i: number) => pn[i] ?? 0;
  return {
    unitId: "codex-" + x.i,
    shikigamiId: x.i,
    name: x.n,
    stats: {
      attack: at(0), hp: at(1), defense: at(2), speed: at(3),
      critRate: at(4), critDamage: at(5), effectHit: at(6), effectResist: at(7),
    },
    soulId: null,
  };
}
function open(x: ShikigamiIndexEntry) { drawerUnit.value = unitOf(x); drawerTab.value = "skills"; }

const rarityOf = (x: ShikigamiIndexEntry) => x.r || "?";
const panelMissing = computed(() => list.value.filter(x => !x.has.panel).length);

// ───────────── 御魂图鉴 ─────────────
const oq = ref("");
const soulList = computed(() => searchSouls(oq.value));
const SUPPORT_COLOR: Record<string, string> = {
  FULL: "var(--ok)", PARTIAL: "var(--warn)", UNSUPPORTED: "var(--danger)",
};
const supportCount = computed(() => soulList.value.reduce((a: Record<string, number>, s) => {
  a[s.engine.support] = (a[s.engine.support] ?? 0) + 1; return a;
}, {}));
const soulDetail = ref<SoulIndexEntry | null>(null);

// ───────────── 术语表 ─────────────
const gq = ref("");
/** 术语表的英文显示层（tip:<id>:name|desc；缺译回退中文）—— 搜索同时匹配英文与中文 */
const GLOSSARY_VIEW = GLOSSARY.map(g => ({ ...g, nameEn: tipName(g.id, g.name), textEn: tipDesc(g.id, g.text) }));
const gList = computed(() => {
  const s = gq.value.trim().toLowerCase();
  if (!s) return GLOSSARY_VIEW;
  return GLOSSARY_VIEW.filter(g => [g.nameEn, g.textEn, g.name, g.text].some(t => t.toLowerCase().includes(s)) || String(g.id) === s);
});
</script>

<template>
  <div class="codex">
    <!-- 页面顶部固定说明：数据来源与版本 -->
    <div class="sourcebar">
      <span class="mono k">Data source</span>
      <span>KB index <b class="mono">kb/shikigami-index.json</b> · <b class="mono">kb/soul-index.json</b> · <b class="mono">kb/glossary.json</b></span>
      <span class="spacer" />
      <span class="mono ver">{{ DATA_VERSION }}</span>
      <span class="chip mono">Shikigami {{ SHIKIGAMI.length }}</span>
      <span class="chip mono">Souls {{ SOULS.length }}</span>
      <span class="chip mono">Terms {{ GLOSSARY.length }}</span>
    </div>

    <nav class="tabs">
      <button v-for="t in TABS" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id">
        {{ t.label }}<span class="cnt mono">{{ t.count }}</span>
      </button>
    </nav>

    <!-- ───────── 式神图鉴 ───────── -->
    <section v-if="tab === 'shikigami'">
      <div class="filters">
        <input class="search" v-model="sq" placeholder="🔍 Search shikigami (English / Chinese name / alias / pinyin / initials / ID)" />
        <div class="rarities">
          <button v-for="r in RARITIES" :key="r" class="rar" :class="{ on: rarity === r }" @click="toggleRarity(r)">{{ r }}</button>
          <button class="rar" :class="{ on: rarity === null }" @click="rarity = null">All</button>
        </div>
      </div>
      <div class="hint">
        Showing <b class="mono">{{ list.length }}</b> / {{ SHIKIGAMI.length }} (max 60 at a time; type a keyword or pick a rarity to narrow)
        <span v-if="panelMissing" class="warn">· {{ panelMissing }} missing stat panel</span>
      </div>
      <div class="grid shiki">
        <button v-for="x in list" :key="x.i" class="card" @click="open(x)">
          <span class="row1">
            <span class="nm" :title="x.n">{{ shikigamiName(x.i, x.n) }}</span>
            <span class="rarity" :class="'r-' + rarityOf(x)">{{ rarityOf(x) }}</span>
          </span>
          <span class="row2 mono">
            <span>ID {{ x.i }}</span>
            <span v-if="x.y">· {{ x.y }}</span>
            <span v-if="shikigamiName(x.i, x.n) !== x.n" class="cn">· {{ x.n }}</span>
          </span>
          <span v-if="x.t.length" class="tags"><i v-for="t in x.t" :key="t">{{ tagText(t) }}</i></span>
          <span class="row3">
            <span class="badge mono" title="Skill count">Skills {{ x.has.skills }}</span>
            <span class="badge mono" :class="x.has.ai ? 'ok' : 'off'" :title="x.has.ai ? 'Has AI cast logic' : 'AI data missing (source data gap)'">AI {{ x.has.ai ? "✓" : "—" }}</span>
            <span class="badge mono" :class="x.has.panel ? 'ok' : 'off'" :title="x.has.panel ? 'Has 6-star awakened stats' : 'Stat panel missing (source data gap)'">Stats {{ x.has.panel ? "✓" : "—" }}</span>
          </span>
        </button>
        <div v-if="!list.length" class="empty">No matching shikigami</div>
      </div>
    </section>

    <!-- ───────── 御魂图鉴 ───────── -->
    <section v-else-if="tab === 'souls'">
      <div class="notice">
        ⚠ In betting mode soul static stats are not counted (panel values are final screenshot values); only the 4-piece battle effect is enabled.
      </div>
      <div class="filters">
        <input class="search" v-model="oq" placeholder="🔍 Search souls (English / Chinese name / type / 2-piece)" />
        <div class="legend">
          <span><i class="dot" style="background: var(--ok)" />Fully implemented {{ supportCount.FULL ?? 0 }}</span>
          <span><i class="dot" style="background: var(--warn)" />Partially implemented {{ supportCount.PARTIAL ?? 0 }}</span>
          <span><i class="dot" style="background: var(--danger)" />Not implemented {{ supportCount.UNSUPPORTED ?? 0 }}</span>
        </div>
      </div>
      <div class="grid souls">
        <button v-for="s in soulList" :key="s.i" class="card soul" @click="soulDetail = soulDetail && soulDetail.i === s.i ? null : s">
          <span class="row1">
            <i class="dot" :style="{ background: SUPPORT_COLOR[s.engine.support] }" />
            <span class="nm" :title="s.n">{{ soulName(s.i, s.n) }}<span v-if="soulName(s.i, s.n) !== s.n" class="cn"> {{ s.n }}</span></span>
            <span class="spacer" />
            <span class="mono sup" :style="{ color: SUPPORT_COLOR[s.engine.support] }">
              {{ s.engine.support }} · {{ SOUL_SUPPORT_LABEL[s.engine.support] }}
            </span>
          </span>
          <span class="kv"><span class="k">2-piece</span><span>{{ soulSuitText(s.i, s.suit) || "—" }}</span></span>
          <span class="kv"><span class="k">4-piece</span><span class="desc">{{ soulDescText(s.i, s.desc) || "—" }}</span></span>
          <span class="row2 mono dim">
            <span>ID {{ s.i }}</span><span v-if="s.tag">· {{ tagText(s.tag) }}</span>
            <span>· trigger {{ s.engine.trigger ?? "unrecognized" }}</span>
            <span>· effect {{ s.engine.effectKind }}</span>
          </span>
          <template v-if="soulDetail && soulDetail.i === s.i">
            <span class="engine">
              <span class="mono small dim">params magnitudes = {{ s.engine.magnitudes.join(", ") || "—" }}</span>
              <span class="small dim">{{ s.engine.note || "(no note from engine)" }}</span>
            </span>
            <span v-if="s.engine.support !== 'FULL'" class="warnbox">⚠ This soul's battle effect is not fully implemented; simulations will underestimate its impact.</span>
          </template>
        </button>
        <div v-if="!soulList.length" class="empty">No matching souls</div>
      </div>
    </section>

    <!-- ───────── 术语表 ───────── -->
    <section v-else>
      <div class="filters">
        <input class="search" v-model="gq" placeholder="🔍 Search terms (name / text / ID)" />
        <span class="hint mono">{{ gList.length }} / {{ GLOSSARY.length }} terms</span>
      </div>
      <div class="glossary">
        <article v-for="g in gList" :key="g.id" class="term">
          <div class="thead"><span class="nm" :title="g.nameEn !== g.name ? g.name : undefined">{{ g.nameEn }}</span><span class="mono dim tiny">#{{ g.id }}</span></div>
          <div class="text">{{ g.textEn }}</div>
        </article>
        <div v-if="!gList.length" class="empty">No matching terms</div>
      </div>
    </section>

    <!-- 复用已实现的详情抽屉：只传一个 GuessingUnitInput 形状的对象 -->
    <DetailDrawer :open="!!drawerUnit" :unit="drawerUnit" :tab="drawerTab"
      @close="drawerUnit = null" @tab="(t: 'skills' | 'ai' | 'soul') => drawerTab = t" />
  </div>
</template>

<style scoped>
.codex { display: flex; flex-direction: column; gap: 12px; }
.k { color: var(--fg-faint); font-size: 10px; letter-spacing: 1px; }
.spacer { flex: 1; }
.tiny { font-size: 10px; }
.small { font-size: 11px; }
.dim { color: var(--fg-dim); } .warn { color: var(--warn); }

/* 顶部固定说明：贴在 App 顶栏（52px）之下 */
.sourcebar { position: sticky; top: 52px; z-index: 10; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 7px 11px; background: var(--panel2); border: 1px solid var(--line); border-radius: 8px; font-size: 11px; color: var(--fg-dim); }
.sourcebar b { color: var(--fg); font-weight: 500; }
.ver { color: var(--ok); font-size: 11px; border: 1px solid #2f5741; background: #16241c; border-radius: 5px; padding: 1px 7px; }
.chip { font-size: 10px; color: var(--fg-faint); border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; }

.tabs { display: flex; gap: 5px; }
.tabs button { font-size: 12px; display: flex; align-items: center; gap: 6px; }
.tabs button.on { background: #2b4a7a; border-color: #3a5f96; }
.cnt { font-size: 10px; color: var(--fg-faint); }
.tabs button.on .cnt { color: var(--fg); }

.filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.search { flex: 1; min-width: 260px; }
.rarities { display: flex; gap: 4px; }
.rar { font-size: 11px; padding: 3px 9px; }
.rar.on { background: #2b4a7a; border-color: #3a5f96; }
.hint { font-size: 11px; color: var(--fg-faint); margin-bottom: 8px; }

.notice { margin-bottom: 10px; padding: 8px 10px; border-radius: 7px; font-size: 11.5px; line-height: 1.5;
  background: #2a2213; border: 1px solid #6b5520; color: var(--warn); }
.legend { display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--fg-dim); }
.legend span { display: flex; align-items: center; gap: 5px; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; display: inline-block; }

.grid { display: grid; gap: 6px; align-content: start; }
.shiki { grid-template-columns: repeat(auto-fill, minmax(216px, 1fr)); }
.souls { grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); }
.card { display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 7px 9px; font-size: 12px; width: 100%; }
.card:hover { border-color: #4a5364; }
.soul { gap: 4px; }
.row1 { display: flex; align-items: center; gap: 6px; }
.row2 { display: flex; gap: 4px; font-size: 10px; color: var(--fg-faint); flex-wrap: wrap; }
.row3 { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
.nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cn { font-weight: 400; color: var(--fg-faint); }
.rarity { font-size: 10px; border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; color: var(--fg-dim); }
.r-SP { color: #d98ad9; border-color: #6b3a6b; } .r-SSR { color: #d9b06a; border-color: #6b5520; }
.r-SR { color: #9b8ad9; border-color: #443a6b; } .r-R { color: #7fb0d9; border-color: #2f4f6b; }
.r-N { color: var(--fg-faint); } .r-UR { color: var(--danger); border-color: #6b2f28; }
.tags { display: flex; gap: 3px; flex-wrap: wrap; }
.tags i { font-style: normal; font-size: 10px; color: var(--fg-faint); border: 1px solid var(--line); border-radius: 3px; padding: 0 3px; }
.badge { font-size: 10px; border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; color: var(--fg-faint); }
.badge.ok { color: var(--ok); border-color: #2f5741; }
.badge.off { color: var(--fg-faint); border-color: var(--line); }
.kv { display: flex; gap: 6px; font-size: 11.5px; }
.kv .k { color: var(--fg-faint); font-size: 10px; min-width: 42px; padding-top: 2px; }
.desc { color: var(--fg-dim); line-height: 1.5; }
.sup { font-size: 10px; white-space: nowrap; }
.engine { margin-top: 4px; padding-top: 5px; border-top: 1px dashed var(--line); display: flex; flex-direction: column; gap: 2px; }
.warnbox { margin-top: 4px; padding: 6px 8px; border-radius: 6px; background: #2a2213; border: 1px solid #6b5520; color: var(--warn); font-size: 10.5px; }
.glossary { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 6px; align-content: start; }
.term { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.thead { display: flex; align-items: baseline; gap: 6px; margin-bottom: 3px; }
.text { font-size: 11.5px; line-height: 1.55; color: var(--fg-dim); white-space: pre-wrap; }
.empty { padding: 24px; text-align: center; color: var(--fg-faint); font-size: 12px; grid-column: 1 / -1; }
</style>
