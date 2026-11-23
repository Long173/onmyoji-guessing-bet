<script setup lang="ts">
// components/simulation/FidelityPanel.vue — ★ Per-Match Fidelity（a1-4 §4-§10、§33）
// 铁律：**不给"真实性百分比"**。五层各自给非评价性状态分类，进度条只表示"这一层有多少项是完整的"。
import { computed, ref } from "vue";
// ★★★ 第 138 轮：结构类型与逐技能词汇都移到 contracts/fidelity-view.ts（唯一声明处）；
//   这里不再自己声明一份 Fidelity 形状 —— 面板 / 卡面 / 抽屉读的是同一份契约。
import { groupSkillStatus, skillNameOf, FIDELITY_LAYER_TITLE, FIDELITY_COUNT_LABEL } from "../../contracts/fidelity-view.ts";
import type { FidelityView } from "../../contracts/fidelity-view.ts";
import CompiledBadge from "../knowledge/CompiledBadge.vue";
import { displayName } from "../../kb/names.ts";

/** `expanded`: render every layer and the per-skill list open (static renders / tests); default collapsed. */
const props = defineProps<{ fidelity: unknown | null; expanded?: boolean }>();
const f = computed(() => (props.fidelity ?? null) as FidelityView | null);
const open = ref<string | null>(null);
/** ★ 第 138 轮：逐技能一节默认收起（30 行会把面板撑得很长），点标题展开 */
const openSkills = ref(!!props.expanded);
const isOpen = (layer: string) => !!props.expanded || open.value === layer;
const skillGroups = computed(() => groupSkillStatus(f.value?.skills ?? []));

/**
 * 界面文案（短版徽标）。★★ 第 61 轮加了一条机械约束（tests/ui10-fidelity.ts）：
 *   · 键必须与 kernel/fidelity.ts 的 FIDELITY_CLASS_LABEL **完全一致**（内核加一档，这里必须跟上）；
 *   · （界面英文化后）每一档必须有完整的英文短标签；原「每个词都能在内核中文原文里找到」的约束随翻译取消。
 * 为什么不是直接引用内核那张表：徽标要短。但"短"不能变成"另一套说法"，
 * 所以约束写成"用词子集"，而不是两处各写一份、然后慢慢写歪。
 *
 * ★★★ PARTIAL 必须保留「可以运行」：§10 的定义是「存在 PARTIAL，但可以运行」——
 *   这一档说的是"能不能用"，不是"好不好"。而它正是用户最常看到的一档
 *   （典型对局 #001 在第 60 轮修正分类口径之后就是 PARTIAL）。
 *   原先这里只写「部分实现」，把限定语丢了 —— 一个非评价性分类读起来就成了故障灯。
 */
const KLASS_LABEL: Record<string, string> = {
  VERIFIED: "Verified", COMPLETE_UNVERIFIED: "Code path complete · not tested in-game",
  PARTIAL: "Partially implemented · can run", INSUFFICIENT: "Not implemented · results unusable",
};
const KLASS_TONE: Record<string, string> = { VERIFIED: "ok", COMPLETE_UNVERIFIED: "warn", PARTIAL: "warn", INSUFFICIENT: "bad" };
const LAYER_TONE: Record<string, string> = { COMPLETE: "ok", PARTIAL: "warn", GAPS: "bad", UNKNOWN: "idle" };
</script>

<template>
  <div class="fid">
    <div class="title">
      Simulation fidelity for this match
      <span v-if="f" class="kbadge" :class="KLASS_TONE[f.klass] ?? 'idle'">{{ KLASS_LABEL[f.klass] ?? f.klass }}</span>
    </div>

    <template v-if="f">
      <div v-for="L in f.layers" :key="L.layer" class="layer" :class="{ open: isOpen(L.layer) }">
        <button class="lhead" @click="open = open === L.layer ? null : L.layer">
          <span class="lname" :title="L.title">{{ FIDELITY_LAYER_TITLE[L.layer] ?? L.title }}</span>
          <span class="lbar"><i :style="{ width: L.bar ? (L.bar.filled / L.bar.total * 100) + '%' : '0%' }" /></span>
          <span class="lklass" :class="LAYER_TONE[L.klass]">{{ L.klass }}</span>
        </button>
        <div v-if="isOpen(L.layer)" class="lbody">
          <div v-for="c in L.counts" :key="c.label" class="kv">
            <span class="k" :title="c.label">{{ FIDELITY_COUNT_LABEL[c.label] ?? c.label }}</span><span class="mono">{{ c.value }}</span>
            <span v-if="c.note" class="tiny dim">{{ c.note }}</span>
          </div>
          <div v-for="(g, i) in L.gaps" :key="i" class="gap" :class="g.severity.toLowerCase()">
            <b>{{ g.what }}</b> {{ g.detail }}
          </div>
        </div>
      </div>

      <!--
        ★★★ 第 138 轮（§33）：「逐技能机制实现度 ● FULL / ◐ PARTIAL」。
        在这之前面板上只有 6 个**聚合计数**，问不出"这一个技能到底是哪一档"；
        而审核（第 137 轮）指出卡面上原本只有一个「数据在不在」的圆点。
      -->
      <div v-if="skillGroups.length" class="skills">
        <button class="shead" @click="openSkills = !openSkills">
          <span>Per-skill compile status</span>
          <span class="mono tiny dim">{{ (f.skills ?? []).length }} skills · {{ skillGroups.length }} units</span>
          <span class="tiny dim">{{ openSkills ? "Collapse" : "Expand" }}</span>
        </button>
        <div v-if="openSkills" class="sbody">
          <div v-for="g in skillGroups" :key="g.key" class="sgroup">
            <div class="suname">
              <b :title="g.unit">{{ displayName(g.unit) }}</b>
              <span class="mono tiny">{{ g.tally }}</span>
            </div>
            <div v-for="s in g.skills" :key="s.name" class="srow">
              <span class="sname">{{ skillNameOf(s) }}</span>
              <!-- ★ 与抽屉里是**同一个组件**：档位一旦改口径，两处一起改 -->
              <CompiledBadge :status="s" />
            </div>
          </div>
        </div>
      </div>

      <div v-if="f.reasons.length" class="reasons">
        <div class="tiny dim">Why this classification:</div>
        <div v-for="(r, i) in f.reasons" :key="i" class="tiny">· {{ r }}</div>
      </div>
      <div v-for="(c, i) in f.caveats" :key="i" class="caveat">{{ c }}</div>
    </template>
    <div v-else class="dim small">No match to assess yet (enter both lineups first).</div>
  </div>
</template>

<style scoped>
.fid { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 11px 13px; }
.title { font-size: 12px; color: var(--fg-dim); margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
.kbadge { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); }
.kbadge.ok { color: var(--ok); border-color: #2f5741; background: #16241c; }
.kbadge.warn { color: var(--warn); border-color: #6b5520; background: #2a2213; }
.kbadge.bad { color: var(--danger); border-color: #6b2f28; background: #2a1614; }
.kbadge.idle { color: var(--fg-faint); }
.layer { border-top: 1px solid #1b1f28; }
.lhead { display: grid; grid-template-columns: 1fr 56px 50px; gap: 7px; align-items: center; width: 100%; background: none; border: none; border-radius: 0; padding: 5px 0; text-align: left; font-size: 11.5px; }
.lname { color: var(--fg-dim); }
.lbar { display: block; height: 5px; background: #0f1116; border-radius: 3px; overflow: hidden; }
.lbar i { display: block; height: 100%; background: linear-gradient(90deg, #2b4a7a, #7fa8e0); }
.lklass { font-family: var(--mono); font-size: 9.5px; text-align: center; padding: 1px 4px; border-radius: 3px; }
.lklass.ok { background: #16241c; color: var(--ok); } .lklass.warn { background: #2a2213; color: var(--warn); }
.lklass.bad { background: #2a1614; color: var(--danger); } .lklass.idle { background: var(--panel2); color: var(--fg-faint); }
.lbody { padding: 4px 0 8px; }
.kv { display: grid; grid-template-columns: 118px auto 1fr; gap: 7px; font-size: 11px; align-items: baseline; }
.kv .k { color: var(--fg-faint); }
.gap { font-size: 10.5px; margin-top: 3px; padding: 3px 6px; border-radius: 5px; line-height: 1.5; }
.gap.block { background: #2a1614; color: #e3b6b0; }
.gap.warn { background: #2a2213; color: #e3d3a8; }
.gap.info { background: var(--panel2); color: var(--fg-dim); }
.reasons { margin-top: 8px; }
.skills { margin-top: 8px; border-top: 1px solid #1b1f28; padding-top: 6px; }
.shead { display: flex; align-items: center; gap: 8px; width: 100%; background: none; border: none; border-radius: 0; padding: 3px 0; text-align: left; font-size: 11px; color: var(--fg-dim); }
.sbody { padding: 2px 0 4px; }
.sgroup { margin-top: 4px; }
.suname { display: flex; gap: 7px; align-items: baseline; font-size: 11px; color: var(--fg); }
.srow { display: flex; gap: 6px; align-items: baseline; font-size: 10.5px; padding-left: 12px; line-height: 1.7; }
.srow .sname { color: var(--fg-dim); }
.mark { font-size: 10px; }
.mark.FULL { color: var(--ok); } .mark.PARTIAL { color: var(--warn); } .mark.PASSIVE { color: var(--fg-faint); } .mark.NONE { color: var(--danger); }
.warnline { color: var(--warn); }
.caveat { margin-top: 6px; font-size: 10.5px; color: var(--warn); background: #2a2213; border-radius: 6px; padding: 5px 8px; line-height: 1.6; }
.small { font-size: 12px; } .tiny { font-size: 10px; } .dim { color: var(--fg-dim); }
</style>
