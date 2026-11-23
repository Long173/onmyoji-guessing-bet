<script setup lang="ts">
// 式神详情抽屉：Raw Data 与 Compiled Behavior 并排（文档第十七节的核心要求）
import { computed, onServerPrefetch, ref, watch } from "vue";
import { loadDetail, shikigamiById, soulById, SOUL_SUPPORT_LABEL } from "../../kb/useKb";
import { resolveRefs, collectSkillRefs } from "../../kb/resolve-refs.ts";
import { shikigamiName, soulName } from "../../kb/names.ts";
import { enRef, enRefTables, skillText, skillUpgradeText, soulDescText, soulSuitText, tagText } from "../../kb/en-text.ts";
import { enAiSkill, enEngine } from "../../kb/en-engine.ts";
import bundle from "../../engine/bundle.json";
import type { GuessingUnitInput } from "../../contracts/guessing-match";
// ★★★ 第 138 轮：这个文件的头注释一直写着「Raw Data 与 Compiled Behavior 并排」，
//   但模板里只有 Raw 侧 —— 编译产物到不了这里（Fidelity 载荷里当时也没有逐技能那一层）。
//   现在补上：逐技能的档位、未解析句数、引擎跳过条数、未建模机制，与原文逐条并排。
import { skillTally } from "../../contracts/fidelity-view.ts";
import type { SkillFidelityView } from "../../contracts/fidelity-view.ts";
import CompiledBadge from "./CompiledBadge.vue";

const props = defineProps<{
  open: boolean; unit: GuessingUnitInput | null; tab: "skills" | "ai" | "soul";
  /** 该单位的逐技能编译状态（无载荷时为空数组 —— 界面如实写「尚未评估」） */
  skillStatus?: SkillFidelityView[];
}>();
const emit = defineEmits<{ (e: "close"): void; (e: "tab", v: "skills" | "ai" | "soul"): void }>();
const active = computed({ get: () => props.tab, set: v => emit("tab", v) });
const detail = ref<any>(null);
const loading = ref(false);
const err = ref<string | null>(null);
const meta = computed(() => (props.unit?.shikigamiId ? shikigamiById(props.unit.shikigamiId) : null));
const soul = computed(() => soulById(props.unit?.soulId ?? null));
/** 逐技能编译状态：按技能名索引（Raw 侧一项对一项；对不上的如实留空） */
const compiled = computed(() => new Map((props.skillStatus ?? []).map(s => [s.name, s])));
/**
 * Raw 与 Compiled 的**并排**行：按技能名配对（引擎侧 skills[] 与知识库 skills[] 同名）。
 * ★ 配不上时 compiled=null，界面如实写「没有编译记录」—— 不许拿相邻技能顶上。
 */
const skillRows = computed<Array<{ raw: any; compiled: SkillFidelityView | null }>>(() =>
  (detail.value?.skills ?? []).map((k: any) => ({ raw: k, compiled: compiled.value.get(k.name) ?? null })));
/**
 * ★★★ 第 256 轮（用户要求：「要与阴阳师里每个技能右边附加的小框，一致，完全一致」）：
 *   左边 = 技能正文（占位符换成游戏里的名字），右边 = 这条技能引用到的**印记 / 术语**连同游戏原文。
 *   数据来自同一份 bundle（tips 122 条 + buffs 338 条）—— 也就是**游戏自己的说明文字**，不是我们重写的。
 *   规则（按用户给的四张式神录截图反推）：印记在前、术语在后，各自按**首次出现顺序**，且**传递一层**
 *   （新蕊的正文里提到「盛放」，小框里也要有 —— 见 kb/resolve-refs.ts 的注）。
 */
const refTables = computed(() => ({ tips: (bundle as any).tips ?? [], buffs: (bundle as any).buffs ?? [] }));
/**
 * 英文显示层（kb/en-text.ts）：正文 / 升级句 / 小框都换成英文（缺译回退中文），占位符照常由 resolveRefs 解析。
 * ★ 小框的**收集**仍用中文原文 + 中文表（按名字传递命中的规则是对着中文正文定的），收集完再按 id 换成英文显示。
 */
const enTables = computed(() => enRefTables(refTables.value));
const skillViews = computed(() => skillRows.value.map((r: any) => {
  const id = r.raw.id;
  const texts = [r.raw.description, ...((r.raw.upgrades ?? []).map((u: any) => u.effect))];
  const box = collectSkillRefs(texts, refTables.value);
  return {
    row: r,
    name: skillText(id, "name", r.raw.name),
    tags: ((r.raw.tags ?? []) as string[]).map((t) => ({ key: t, label: tagText(t) })),
    brief: skillText(id, "brief", r.raw.brief),
    desc: resolveRefs(skillText(id, "desc", r.raw.description), enTables.value).parts,
    ups: (r.raw.upgrades ?? []).map((u: any) => ({ level: u.level, parts: resolveRefs(skillUpgradeText(id, u.level, u.effect), enTables.value).parts })),
    box: box.buffs.concat(box.tips).map(enRef).map((ref: any) => ({ ...ref, parts: resolveRefs(String(ref.text ?? ""), enTables.value).parts })),
  };
}));
/** AI 页签里的技能名（AI 数据只有中文名）⇒ 按本式神的技能表找 id 再取英文名 */
const skillNameByCn = computed(() => new Map<string, string>(
  (detail.value?.skills ?? []).map((k: any) => [String(k.name), skillText(k.id, "name", k.name)])));
/** Skill slot N ⇒ the skill whose id ends in _0N (the AI data sometimes spells names differently from the skill table) */
const skillNameBySlot = computed(() => new Map<number, string>(
  (detail.value?.skills ?? []).map((k: any) => [Number(String(k.id).split("_")[1] ?? 0), skillText(k.id, "name", k.name)])));
const skillLabel = (cn: unknown) => enAiSkill(cn, (n) => skillNameByCn.value.get(n), (n) => skillNameBySlot.value.get(n));
/** AI conditions / target rules / notes (data/kb/ai.json) are Chinese sentences: display-time English (kb/en-engine.ts). */
const aiText = (cn: unknown) => enEngine(cn);
/** 六星面板：源数据缺的维度（如 593 的 ATK/HP/DEF 为 null）显示「—」，不留光秃秃的标签 */
const fmtNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "—");
const fmtPct = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? (v * 100).toFixed(0) + "%" : "—");
const panelLine = computed(() => {
  const p = detail.value?.panel;
  if (!p) return "";
  return [
    "ATK " + fmtNum(p.atk), "HP " + fmtNum(p.hp), "DEF " + fmtNum(p.def), "SPD " + fmtNum(p.spd),
    "Crit " + fmtPct(p.cri), "Crit DMG " + fmtPct(p.crid),
  ].join(" · ");
});
const panelMissing = computed(() => {
  const p = detail.value?.panel;
  return p ? ["atk", "hp", "def", "spd"].some((k) => typeof p[k] !== "number") : false;
});
const compiledTally = computed(() => (props.skillStatus ?? []).length ? skillTally(props.skillStatus ?? []) : "");

async function load() {
  if (!props.open || !props.unit?.shikigamiId) return;
  loading.value = true; err.value = null;
  try { detail.value = (await loadDetail())[String(props.unit.shikigamiId)] ?? null; }
  catch (e: any) { err.value = String(e?.message ?? e); }
  finally { loading.value = false; }
}
watch(() => [props.open, props.unit?.shikigamiId], load, { immediate: true });
// Static rendering (tools/ssr-harness): wait for the detail before rendering, like the browser does after the import.
onServerPrefetch(load);
</script>

<template>
  <div v-if="open" class="overlay" @click.self="emit('close')">
    <aside class="drawer">
      <header>
        <span class="name">{{ unit ? shikigamiName(unit.shikigamiId, unit.name) : "—" }}</span>
        <span v-if="meta" class="rar mono">{{ meta.r }}</span>
        <span class="spacer" />
        <button @click="emit('close')">✕</button>
      </header>
      <nav>
        <button :class="{ on: active === 'skills' }" @click="active = 'skills'">Skills</button>
        <button :class="{ on: active === 'ai' }" @click="active = 'ai'">AI</button>
        <button :class="{ on: active === 'soul' }" @click="active = 'soul'">Soul</button>
      </nav>
      <div class="body">
        <div v-if="loading" class="dim">Loading…</div>
        <div v-else-if="err" class="err">✗ {{ err }}</div>
        <template v-else-if="active === 'skills'">
          <div v-if="detail?.panel" class="panelbox">
            <div class="sub">6-star awakened stats (KB)</div>
            <div class="mono small">{{ panelLine }}</div>
            <div v-if="panelMissing" class="dim small">— = not in source data</div>
          </div>
          <!-- ★ 第 138 轮（§33）：Raw 侧之前先说清"编译侧有没有信息"，避免读者以为下面每一行都已被引擎实现 -->
          <div class="compilehead">
            <span class="sub" style="margin:0">Compiled Behavior (engine, per skill)</span>
            <span v-if="compiledTally" class="mono small">{{ compiledTally }}</span>
            <span v-else class="dim small">Not evaluated yet (appears after running a check)</span>
          </div>
          <!-- ★★★ 第 256 轮：左边 = 技能正文（占位符换成游戏里的名字），右边 = **与式神录那个小框一致**的印记/术语说明 -->
          <article v-for="v in skillViews" :key="v.row.raw.id" class="skill">
            <div class="skbody">
              <div class="skhead"><b>{{ v.name }}</b><span class="mono dim">Onibi {{ v.row.raw.cost }}</span>
                <span class="tags"><i v-for="t in v.tags" :key="t.key">{{ t.label }}</i></span></div>
              <div class="brief dim">{{ v.brief }}</div>
              <div class="desc"><template v-for="(p, i) in v.desc" :key="i"><span v-if="p.kind === 'ref'" class="kw" :title="p.text">{{ p.name }}</span><template v-else>{{ p.text }}</template></template></div>
              <div v-if="v.ups.length" class="ups">
                <div v-for="u in v.ups" :key="u.level" class="mono small">Lv.{{ u.level }}
                  <template v-for="(p, i) in u.parts" :key="i"><span v-if="p.kind === 'ref'" class="kw" :title="p.text">{{ p.name }}</span><template v-else>{{ p.text }}</template></template>
                </div>
              </div>
              <div class="compiled"><CompiledBadge :status="v.row.compiled" /></div>
            </div>
            <aside v-if="v.box.length" class="refbox">
              <div v-for="ref in v.box" :key="ref.source + ref.id" class="refitem">
                <div class="refname">{{ ref.name }}</div>
                <div class="reftext"><template v-for="(p, i) in ref.parts" :key="i"><span v-if="p.kind === 'ref'" class="kw">{{ p.name }}</span><template v-else>{{ p.text }}</template></template></div>
              </div>
            </aside>
          </article>
        </template>
        <template v-else-if="active === 'ai'">
          <div v-if="!detail?.ai" class="dim">No AI data for this shikigami yet</div>
          <template v-else>
            <div class="sub">Skill choice (by priority)</div>
            <div v-for="(c, i) in detail.ai.cast" :key="i" class="rule">
              <span class="prio mono">{{ detail.ai.cast.length - i }}</span>
              <span class="cond">{{ c.cond ? aiText(c.cond) : "Unconditional" }}</span>
              <span class="arrow">→</span>
              <span class="skillname">{{ skillLabel(c.skill) }}</span>
            </div>
            <template v-if="detail.ai.target?.length">
              <div class="sub" style="margin-top:10px">Target choice</div>
              <div v-for="(t, i) in detail.ai.target" :key="i" class="rule">
                <span class="skillname">{{ skillLabel(t.skill) }}</span><span class="arrow">→</span><span class="cond">{{ aiText(t.rule) }}</span>
              </div>
            </template>
            <div v-if="detail.ai.note" class="note">{{ aiText(detail.ai.note) }}</div>
          </template>
        </template>
        <template v-else>
          <div v-if="!soul" class="dim">No soul selected</div>
          <template v-else>
            <h4>{{ soulName(soul.i, soul.n) }}</h4>
            <div class="sub">2-piece</div><div class="desc">{{ soulSuitText(soul.i, soul.suit) || "—" }}</div>
            <div class="sub" style="margin-top:8px">4-piece</div><div class="desc">{{ soulDescText(soul.i, soul.desc) || "—" }}</div>
            <div class="sub" style="margin-top:8px">Engine Support</div>
            <div class="desc">
              {{ soul.engine.support }} · {{ SOUL_SUPPORT_LABEL[soul.engine.support] }}<br />
              <span class="mono small dim">trigger={{ soul.engine.trigger ?? "unrecognized" }} effect={{ soul.engine.effectKind }}</span>
            </div>
            <div class="okbox">✓ Battle effect enabled · static stats not double-counted</div>
          </template>
        </template>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.compilehead { display: flex; gap: 8px; align-items: baseline; margin-bottom: 6px; }
.compiled { margin-top: 6px; padding: 4px 7px; border-radius: 6px; background: var(--panel2); display: flex; gap: 7px; align-items: baseline; flex-wrap: wrap; }
.overlay { position: fixed; inset: 0; background: #0008; z-index: 90; display: flex; justify-content: flex-end; }
.drawer { width: min(560px, 94vw); height: 100%; background: var(--panel); border-left: 1px solid var(--line); display: flex; flex-direction: column; }
header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.name { font-weight: 600; font-size: 15px; }
.rar { font-size: 11px; border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; color: var(--fg-dim); }
.spacer { flex: 1; }
nav { display: flex; gap: 4px; padding: 8px 14px; border-bottom: 1px solid var(--line); }
nav button { font-size: 12px; padding: 3px 12px; }
nav button.on { background: #2b4a7a; border-color: #3a5f96; }
.body { overflow: auto; padding: 14px; }
.sub { font-size: 11px; color: var(--fg-faint); margin-bottom: 5px; }
.panelbox { background: var(--panel2); border-radius: 7px; padding: 9px 11px; margin-bottom: 12px; }
/**
 * ★★★ 第 256 轮：技能行改成**两栏** —— 左正文、右「印记 / 术语」小框（与游戏式神录里那个框一致）。
 *   窄屏退回单栏（小框落到正文下面），不靠横向滚动。
 */
.skill { border-top: 1px solid var(--line); padding: 10px 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(196px, 34%); gap: 12px; align-items: start; }
.skbody { min-width: 0; }
.refbox { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px 10px; background: var(--panel2); }
.refitem + .refitem { margin-top: 8px; border-top: 1px dashed var(--line); padding-top: 8px; }
.refname { color: var(--gold); font-weight: 600; font-size: 12px; }
.reftext { color: var(--fg-dim); font-size: 12px; line-height: 1.55; }
.kw { color: var(--gold); border-bottom: 1px dotted currentColor; cursor: help; }
@media (max-width: 760px) { .skill { grid-template-columns: 1fr; } }
.skill:first-of-type { border-top: none; }
.skhead { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.tags { display: flex; gap: 3px; }
.tags i { font-style: normal; font-size: 10px; color: var(--fg-faint); border: 1px solid var(--line); border-radius: 3px; padding: 0 3px; }
.brief { font-size: 11px; margin-bottom: 3px; }
.desc { font-size: 12px; line-height: 1.55; color: var(--fg); }
.ups { margin-top: 5px; color: var(--fg-dim); }
.rule { display: flex; align-items: baseline; gap: 7px; padding: 4px 0; font-size: 12px; border-bottom: 1px dashed var(--line); }
.prio { color: var(--fg-faint); font-size: 10px; min-width: 14px; }
.cond { color: var(--fg-dim); } .arrow { color: var(--fg-faint); }
.skillname { color: var(--fg); font-weight: 600; }
.note { margin-top: 10px; font-size: 11px; color: var(--fg-dim); }
.okbox { margin-top: 12px; padding: 8px; border-radius: 6px; background: #16241c; border: 1px solid #2f5741; color: var(--ok); font-size: 11px; }
.err { color: var(--danger); } .dim { color: var(--fg-dim); } .small { font-size: 11px; }
</style>
