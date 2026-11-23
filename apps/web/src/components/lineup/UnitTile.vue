<script setup lang="ts">
// components/lineup/UnitTile.vue — UI 2.0 的式神格子（a1-4 §31/§32/§33）
// §31：式神**横排**，比左右长列更像游戏实际阵容，也更省纵向空间。
// §32：默认只显示八维数字，点「编辑」才展开输入框 —— 否则页面像 Excel。
// §33：格子上直接带数据可用性圆点（技能 / AI / 面板 / 御魂实现度）。
import { computed, ref } from "vue";
import { PERCENT_STAT_KEYS, STAT_KEYS, STAT_LABELS } from "../../contracts/guessing-match";
import type { GuessingUnitInput, StatKey } from "../../contracts/guessing-match";
import { shikigamiById, soulById } from "../../kb/useKb";
import { shikigamiName, soulName } from "../../kb/names.ts";
// ★★★ 第 138 轮（§33）：卡面上的**逐技能机制实现度**。数据来自 Per-Match Fidelity 的 skills[]；
//   记号与标签读 contracts/fidelity-view.ts（唯一声明处，与内核逐字节一致由 ui10 断言）。
import { SKILL_MARK, skillTally, worstSkillClass, skillLabelOf, skillNameOf } from "../../contracts/fidelity-view.ts";
import type { SkillFidelityView } from "../../contracts/fidelity-view.ts";
import type { UnitSupport } from "../../contracts/worker-api.ts";

const props = defineProps<{
  unit: GuessingUnitInput; side: "red" | "blue"; index: number; active?: boolean;
  /** 该单位的逐技能编译状态（Fidelity 载荷里按 side + 名字取；缺省 = 还没跑校验） */
  skillStatus?: SkillFidelityView[];
  /** Engine view of this unit's AI / soul support (validation payload); absent = local KB estimate */
  support?: UnitSupport | null;
}>();
const emit = defineEmits<{
  (e: "open-selector"): void; (e: "open-soul"): void; (e: "clear"): void;
  (e: "set-stat", key: StatKey, value: number): void;
  (e: "open-detail", tab: "skills" | "ai" | "soul"): void;
  (e: "activate"): void;
}>();
const editing = ref(false);
const meta = computed(() => (props.unit.shikigamiId ? shikigamiById(props.unit.shikigamiId) : null));
const soul = computed(() => soulById(props.unit.soulId));
const empty = computed(() => !props.unit.shikigamiId);
const s = computed(() => props.unit.stats);

/** One tooltip line per skill: mark, (English) name, tier — hand-written betting kits say so. */
function skillLine(s: SkillFidelityView): string {
  return SKILL_MARK[s.klass] + " " + skillNameOf(s) + ": " + skillLabelOf(s);
}
/** §33：数据可用性圆点 —— 说的是"数据在不在"，不是"真实性多少" */
const dots = computed(() => {
  const m = meta.value;
  const out: Array<{ key: string; tone: "ok" | "warn" | "bad" | "idle"; title: string }> = [];
  if (!m) return out;
  out.push({ key: "Stats", tone: m.has.panel ? "ok" : "bad", title: m.has.panel ? "6-star stat panel available" : "Stat panel data missing" });
  /**
   * ★★★ 第 138 轮：这一格以前只说「技能数据 N 条」= **数据在不在**；
   *   现在它说**编译到哪一档**（● 完整 / ◐ 部分 / ○ 被动 / ✕ 无数值）—— §33 要的正是后者。
   *   两向：没有 Fidelity 载荷时退回原来的"数据在不在"判据（不能因为拿不到载荷就不显示）。
   */
  const st = props.skillStatus ?? [];
  const worst = worstSkillClass(st);
  if (st.length) {
    out.push({
      key: "Skill compile", tone: (worst === "FULL" || worst === "NEVER_CAST") ? "ok" : worst === "NONE" ? "bad" : "warn",
      title: st.map(skillLine).join("\n"),
    });
  } else {
    out.push({ key: "Skills", tone: (m.has.skills ?? 0) >= 3 ? "ok" : (m.has.skills ? "warn" : "bad"), title: `${m.has.skills ?? 0} skill records (compile status not evaluated yet)` });
  }
  /**
   * AI / Soul: the engine's view when the validation payload is there (hand-written betting AI rules and
   * hand-written soul effects count as the battle runs them); otherwise the local KB estimate.
   */
  const ai = props.support?.ai;
  if (ai) {
    const high = !!ai.handWritten || ai.confidence === "HIGH" || ai.confidence === "MEDIUM";
    out.push({ key: "AI", tone: high ? "ok" : "warn", title: ai.handWritten ? `Hand-written betting AI (${ai.handWritten})` : `KB AI compiled with ${ai.confidence} confidence` });
  } else {
    out.push({ key: "AI", tone: m.has.ai ? "ok" : "warn", title: m.has.ai ? "AI rules available" : "No AI rules (2026 shikigami pending)" });
  }
  const es = props.support?.soul;
  if (es) {
    out.push({ key: "Soul", tone: es.support === "FULL" ? "ok" : es.support === "PARTIAL" ? "warn" : "bad", title: `Soul battle effect support: ${es.support}${es.custom ? " (hand-written)" : ""}: ${es.note}` });
  } else if (soul.value) {
    const sup = soul.value.engine.support;
    out.push({ key: "Soul", tone: sup === "FULL" ? "ok" : sup === "PARTIAL" ? "warn" : "bad", title: `Soul battle effect support: ${sup}` });
  }
  return out;
});
/** 逐技能记数串（形如 ●3 ◐1）+ 悬停逐条清单；没有载荷时是空串（模板里 v-if 掉） */
const compileTally = computed(() => (props.skillStatus ?? []).length ? skillTally(props.skillStatus ?? []) : "");
const worstTone = computed(() => {
  const w = worstSkillClass(props.skillStatus ?? []);
  return (w === "FULL" || w === "NEVER_CAST") ? "ok" : w === "NONE" ? "bad" : w ? "warn" : "";
});
const compileTitle = computed(() => (props.skillStatus ?? []).map(skillLine).join("\n"));
/** 卡面八维的短标签（英文缩写；完整名见 STAT_LABELS 的悬停提示） */
const STAT_SHORT: Record<StatKey, string> = {
  attack: "ATK", hp: "HP", defense: "DEF", speed: "SPD",
  critRate: "CRI", critDamage: "CDM", effectHit: "HIT", effectResist: "RES",
};
const displayName = computed(() => shikigamiName(props.unit.shikigamiId, props.unit.name));
function set(k: StatKey, v: string) { emit("set-stat", k, Number(v)); }
const fmt = (k: StatKey) => (PERCENT_STAT_KEYS.includes(k) ? s.value[k] + "%" : String(s.value[k]));
</script>

<template>
  <div class="tile" :class="[side, { empty, active, editing }]">
    <!-- 收起态：身份 + 八维数字 + 数据圆点 -->
    <button class="head" @click="empty ? emit('open-selector') : (emit('activate'), editing = !editing)">
      <span class="idx mono">{{ index + 1 }}</span>
      <span v-if="empty" class="ph">Select shikigami</span>
      <template v-else>
        <span class="nm" :title="unit.name">{{ displayName }}</span>
        <span v-if="meta" class="rar mono">{{ meta.r }}</span>
      </template>
    </button>

    <div v-if="!empty" class="nums mono">
      <span v-for="k in STAT_KEYS" :key="k" :title="STAT_LABELS[k]"><i>{{ STAT_SHORT[k] }}</i>{{ fmt(k) }}</span>
    </div>

    <div v-if="!empty" class="foot">
      <button class="soulchip" :class="{ none: !soul }" @click.stop="emit('open-soul')">
        {{ soul ? soulName(soul.i, soul.n) : "No soul" }}
      </button>
      <span class="dots">
        <i v-for="d in dots" :key="d.key" class="dot" :class="d.tone" :title="d.key + ': ' + d.title" />
      </span>
      <!-- ★ 第 138 轮（§33）：逐技能机制实现度的**记数串**，鼠标悬停看逐条 -->
      <span v-if="compileTally" class="tally mono" :class="worstTone" :title="compileTitle">{{ compileTally }}</span>
      <span class="spacer" />
      <button class="mini" title="Skills / AI / Soul details" @click.stop="emit('open-detail', 'skills')">Details</button>
      <button class="mini" title="Clear" @click.stop="emit('clear')">×</button>
    </div>

    <!-- 展开态（§32）：只有点了「编辑」才出现输入框 -->
    <div v-if="editing && !empty" class="editor">
      <label v-for="k in STAT_KEYS" :key="k" class="field">
        <span class="lab">{{ STAT_LABELS[k] }}<i v-if="PERCENT_STAT_KEYS.includes(k)">%</i></span>
        <input type="number" :value="s[k]" @input="set(k, ($event.target as HTMLInputElement).value)" />
      </label>
      <div class="editorfoot mono tiny dim">Changes are saved to the local draft instantly</div>
    </div>
  </div>
</template>

<style scoped>
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 6px 8px; display: flex; flex-direction: column; gap: 4px; min-width: 168px; }
.tile.red { border-left: 3px solid var(--red); }
.tile.blue { border-left: 3px solid var(--blue); }
.tile.active { border-color: var(--gold-dim); box-shadow: 0 0 0 1px #c9a96133 inset; }
.tile.empty { border-style: dashed; opacity: .75; }
.head { display: flex; align-items: center; gap: 5px; width: 100%; text-align: left; background: none; border: none; border-radius: 0; padding: 0; }
.head:hover:not(:disabled) { background: none; }
.idx { font-size: 10px; color: var(--fg-faint); }
.ph { color: var(--fg-faint); font-size: 12px; }
.nm { font-size: 12.5px; font-weight: 600; }
.rar { font-size: 9px; color: var(--gold-dim); border: 1px solid var(--line); border-radius: 3px; padding: 0 3px; }
.nums { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px 6px; font-size: 10.5px; color: var(--fg-dim); }
.nums i { color: var(--fg-faint); font-style: normal; margin-right: 2px; }
.foot { display: flex; align-items: center; gap: 5px; }
.soulchip { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--panel2); color: var(--fg-dim); }
.soulchip.none { color: var(--fg-faint); }
.dots { display: inline-flex; gap: 3px; }
.tally { font-size: 9.5px; letter-spacing: .5px; }
.tally.ok { color: var(--ok); } .tally.warn { color: var(--warn); } .tally.bad { color: var(--danger); }
.dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); }
.dot.bad { background: var(--danger); } .dot.idle { background: var(--fg-faint); }
.spacer { flex: 1; }
.mini { font-size: 10px; padding: 1px 6px; }
.editor { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 6px; margin-top: 4px; padding-top: 5px; border-top: 1px dashed var(--line); }
.field { display: flex; align-items: center; gap: 4px; }
.lab { font-size: 10px; color: var(--fg-faint); width: 62px; }
.lab i { color: var(--gold-dim); font-style: normal; }
.field input { padding: 2px 5px; font-size: 11px; }
.editorfoot { grid-column: 1 / -1; }
.tiny { font-size: 10px; } .dim { color: var(--fg-dim); }
</style>
