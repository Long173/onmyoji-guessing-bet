<script setup lang="ts">
// 输入健康检查 —— 按文档第七节：Validation → Compilation → Coverage Analysis
// 刻意**不给百分比评分**（无依据把 Coverage 映射成准确率）
import { computed } from "vue";
import type { GuessingMatch } from "../../contracts/guessing-match";
import type { ValidationReport } from "../../contracts/worker-api";
import { shikigamiById, soulById, SOUL_SUPPORT_LABEL } from "../../kb/useKb";

// report 来自真引擎（Worker 的 VALIDATE）。没有它时退回到本地知识库的估算，
// 并明确标注「未接引擎」—— 绝不把估算伪装成引擎结论。
const props = defineProps<{ match: GuessingMatch; report?: ValidationReport | null }>();
const engineData = computed(() => !!props.report);

const units = computed(() => [...props.match.red.units, ...props.match.blue.units].filter(u => u.shikigamiId > 0));
const rows = computed(() => {
  const rep = props.report;
  if (rep) {
    const c = rep.coverage;
    return [
      { label: "Unit data joined", v: `${c.unitsJoined}/${c.unitsTotal}`, ok: c.unitsJoined === c.unitsTotal, warn: false },
      { label: "Skills available", v: `${c.skillsAvailable}/${c.skillsTotal}`, ok: c.skillsAvailable === c.skillsTotal && c.skillsTotal > 0, warn: c.skillsAvailable < c.skillsTotal },
      // Betting mode: a unit whose skills a hand-written betting AI rule decides counts as high (tooltip says so).
      { label: "AI high confidence", v: `${c.aiHigh}/${c.aiTotal}`, ok: c.aiHigh === c.aiTotal && c.aiTotal > 0, warn: c.aiHigh < c.aiTotal,
        tip: c.aiHandWritten ? `${c.aiHandWritten} of them: hand-written betting AI. ${c.notes?.ai ?? ""}`.trim() : (c.notes?.ai ?? "KB AI compiled with HIGH / MEDIUM confidence") },
      // ★ ok 原先恒为 true → 这一行**永远**显示绿色 ✓，算出来的 warn 根本没人看（死代码）。
      //   现在：全部解析成功才 ✓；否则 ⚠（含"一个都没录"——那是输入缺口，不是错误，所以不给红）。
      { label: "Soul definitions", v: `${c.soulsResolved}/${c.soulsTotal}`, ok: c.soulsTotal > 0 && c.soulsResolved === c.soulsTotal, warn: !(c.soulsTotal > 0 && c.soulsResolved === c.soulsTotal) },
      { label: "Soul battle effects", v: `${c.soulEffectsFull} full / ${c.soulEffectsPartial} partial`, ok: c.soulEffectsPartial === 0 && c.soulEffectsFull === c.soulsResolved, warn: !(c.soulEffectsPartial === 0 && c.soulEffectsFull === c.soulsResolved),
        tip: c.notes?.souls ?? "Full = an executable battle effect; partial = trigger recognised only" },
    ];
  }
  const n = units.value.length;
  const metas = units.value.map(u => shikigamiById(u.shikigamiId));
  const skillsOk = metas.filter(m => (m?.has.skills ?? 0) > 0).length;
  const aiOk = metas.filter(m => m?.has.ai).length;
  const souls = units.value.map(u => soulById(u.soulId)).filter(Boolean) as any[];
  const soulFull = souls.filter(s => s.engine.support === "FULL").length;
  const soulBad = souls.filter(s => s.engine.support !== "FULL").length;
  return [
    { label: "Lineup complete", v: `${n}/10`, ok: n === 10 },
    { label: "Shikigami data joined", v: `${n}/10`, ok: n === 10 },
    { label: "Skills available", v: `${skillsOk}/${n || 10}`, ok: n > 0 && skillsOk === n },
    { label: "AI high confidence", v: `${aiOk}/${n || 10}`, ok: n > 0 && aiOk === n, warn: aiOk < n },
    // ★ 同上：ok 原先恒 true，warn 是死代码。全解析成功才 ✓，否则 ⚠。
    { label: "Soul definitions", v: `${souls.length}/${n || 10}`, ok: n > 0 && souls.length === n, warn: !(n > 0 && souls.length === n) },
    { label: "Soul effects fully implemented", v: `${soulFull}/${n || 10}`, ok: n > 0 && soulFull === n, warn: soulBad > 0 },
  ];
});
const unknownCount = computed(() => props.report?.strategySnapshot.unknownCount ?? null);
/** Endgame rule really in force (betting mode: policies.endgame) and what the replaced ruleset still does. */
const endgame = computed(() => props.report?.strategySnapshot.endgame ?? null);
/** Betting mode: max-HP multiplier rule (HYPOTHESIS) with its replay evidence. */
const hpScale = computed(() => props.report?.strategySnapshot.hpScale ?? null);
const policyTip = computed(() => props.report?.coverage.notes?.policies
  ?? (endgame.value ? `Endgame: ${endgame.value.id} (${endgame.value.status})` : "Not validated yet"));
const blockers = computed(() => props.report?.blockers ?? []);
const warnCount = computed(() => (props.report?.warnings ?? []).filter(w => w.severity !== "INFO").length);
</script>

<template>
  <div class="health">
    <div class="title">Simulation readiness</div>
    <div class="rows">
      <div v-for="r in rows" :key="r.label" class="row" :title="(r as any).tip ?? ''">
        <span class="mark" :class="r.ok ? 'ok' : (r.warn ? 'warn' : 'bad')">{{ r.ok ? "✓" : (r.warn ? "⚠" : "✗") }}</span>
        <span class="label">{{ r.label }}</span>
        <span class="val mono">{{ r.v }}</span>
      </div>
      <!-- 三态必须分清：未评估(灰) / 有 UNKNOWN(橙) / 无 UNKNOWN(绿)。
           早先这里把"未评估"也画成红色 ⚠，看起来像出了错，其实只是还没校验 —— 红只留给真问题。 -->
      <div class="row" :title="policyTip">
        <span class="mark" :class="unknownCount === null ? 'idle' : (unknownCount ? 'warn' : 'ok')">
          {{ unknownCount === null ? "–" : (unknownCount ? "⚠" : "✓") }}
        </span>
        <span class="label">Mechanic policies</span>
        <span class="val mono">{{ unknownCount === null ? "Not validated yet" : unknownCount ? `UNKNOWN ×${unknownCount}` : "No UNKNOWN" }}</span>
      </div>
      <div v-if="endgame" class="row" :title="policyTip">
        <span class="mark" :class="endgame.status === 'VERIFIED' ? 'ok' : endgame.status === 'UNKNOWN' ? 'warn' : 'idle'">·</span>
        <span class="label">Endgame rule</span>
        <span class="val mono">{{ endgame.id }} ({{ endgame.status }})</span>
      </div>
      <div v-if="hpScale" class="row" :title="hpScale.note">
        <span class="mark" :class="hpScale.status === 'VERIFIED' ? 'ok' : hpScale.status === 'UNKNOWN' ? 'warn' : 'idle'">·</span>
        <span class="label">Max HP scale</span>
        <span class="val mono">×{{ hpScale.value }} ({{ hpScale.status }})</span>
      </div>
    </div>
    <div v-if="blockers.length" class="blockers">
      <div v-for="(b, i) in blockers" :key="i">✗ {{ b }}</div>
    </div>
    <div class="verdict" :class="blockers.length ? 'bad' : (units.length === 10 ? 'warn' : 'bad')">
      {{ blockers.length ? `${blockers.length} blocker(s), cannot run` : units.length === 10 ? (warnCount ? `Ready to run · ${warnCount} warning(s) (see results)` : "Ready to run") : `Enter ${10 - units.length} more Shikigami` }}
    </div>
    <p class="note">
      {{ engineData ? "Coverage and policy snapshot come from the real engine's validation." : "Engine validation has not run yet; these are local knowledge-base estimates." }}
      No "accuracy" score is given — there is no basis for mapping coverage to prediction accuracy.
    </p>
  </div>
</template>

<style scoped>
.health { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.title { font-size: 12px; color: var(--fg-dim); margin-bottom: 8px; }
.rows { display: flex; flex-direction: column; gap: 3px; }
.row { display: grid; grid-template-columns: 16px 1fr auto; align-items: center; gap: 6px; font-size: 12px; }
.mark.ok { color: var(--ok); } .mark.warn { color: var(--warn); } .mark.bad { color: var(--danger); }
.mark.idle { color: var(--fg-faint); }
.label { color: var(--fg-dim); }
.val { font-size: 11px; color: var(--fg-faint); }
.blockers { margin-top: 8px; display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: var(--danger); }
.verdict { margin-top: 10px; padding: 7px 10px; border-radius: 7px; font-size: 12px; }
.verdict.warn { background: #2a2213; border: 1px solid #6b5520; color: var(--warn); }
.verdict.bad { background: #2a1614; border: 1px solid #6b2f28; color: var(--danger); }
.note { margin: 8px 0 0; font-size: 10px; color: var(--fg-faint); }
</style>
