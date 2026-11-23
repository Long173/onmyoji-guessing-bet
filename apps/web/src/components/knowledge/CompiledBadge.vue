<script setup lang="ts">
// components/knowledge/CompiledBadge.vue — ★★★ 第 138 轮：**一格逐技能编译状态**（a1-4 §33）
//
// 抽成独立组件有两个理由：
//   ① 抽屉与面板要显示**同一件事**（档位 + 未解析句数 + 引擎跳过条数 + 未建模机制），
//      两处各写一遍一定会慢慢写歪；
//   ② 它只吃一个 sync props ⇒ 可以**真的渲染出来**再断言（见 tests/ui16-ssr-render.ts，
//      用 vue/server-renderer 在 Node 里渲染，不需要 jsdom）。
import { SKILL_LABEL, SKILL_MARK, skillLabelOf } from "../../contracts/fidelity-view.ts";
import type { SkillFidelityView } from "../../contracts/fidelity-view.ts";

defineProps<{ status: SkillFidelityView | null }>();
</script>

<template>
  <span class="badge" :class="status ? status.klass : 'UNKNOWN'">
    <template v-if="status">
      <span class="mark">{{ SKILL_MARK[status.klass] }}</span>
      <!-- SKILL_LABEL[status.klass] is the compile tier; a hand-written betting kit says so (skillLabelOf) -->
      <span class="clabel" :title="status.handWritten ?? status.neverCast ?? SKILL_LABEL[status.klass]">{{ skillLabelOf(status) }}</span>
      <span v-if="status.neverCast" class="tiny">{{ status.neverCast }}</span>
      <span v-else-if="status.handWritten" class="tiny dim">{{ status.handWritten }}</span>
      <span v-if="status.unparsed" class="tiny">{{ status.unparsed }} unparsed sentence(s)</span>
      <span v-if="status.skipped" class="tiny">{{ status.skipped }} skipped by engine</span>
      <span v-if="status.unmodeled.length" class="tiny">Not modeled: {{ status.unmodeled.join(", ") }}</span>
    </template>
    <span v-else class="tiny dim">No compile record for this skill in this check (name mismatch or not evaluated)</span>
  </span>
</template>

<style scoped>
.badge { display: inline-flex; gap: 6px; align-items: baseline; flex-wrap: wrap; font-size: 10.5px; }
.mark { font-size: 10px; }
.badge.FULL .mark, .badge.FULL .clabel { color: var(--ok); }
.badge.PARTIAL .mark, .badge.PARTIAL .clabel { color: var(--warn); }
.badge.PASSIVE .mark, .badge.PASSIVE .clabel { color: var(--fg-faint); }
.badge.NONE .mark, .badge.NONE .clabel { color: var(--danger); }
.badge.NEVER_CAST .mark, .badge.NEVER_CAST .clabel { color: var(--fg-dim); }
.badge.UNKNOWN .clabel { color: var(--fg-faint); }
.tiny { font-size: 10px; } .dim { color: var(--fg-dim); }
</style>
