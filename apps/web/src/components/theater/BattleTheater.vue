<script setup lang="ts">
// components/theater/BattleTheater.vue — ★ G4 Battle Theater 主界面（a1-4 §12）
// 布局照文档：顶部状态条 → 红蓝十张 Entity Card → 当前行动者 Banner → 双方鬼火 →
//            Action Bar（行动条） → 播放控制 + 进度条 →（右栏）事件流 + 事件链检查器
// 明确不做：立绘动画 / 技能特效 / 粒子 / 3D（§59）。这里是**机制可视化器**，不是游戏客户端。
import { computed, onBeforeUnmount, ref, toRaw, watch } from "vue";
import EntityCard from "./EntityCard.vue";
import { Presenter } from "../../theater/presenter.ts";
// ★★★ 第 137 轮：播放逻辑（帧号推进 / 关键时刻 / 倍速）搬进 theatre/transport.ts —— 纯模块才断言得了。
//   组件这边只剩"把 ref 暴露成 host"与"挂 setInterval"两件事。
import { createTransport, frameIntervalMs, SPEEDS } from "../../theater/transport.ts";
// ★ 这里原本写的是 ../../../../battle-lab/... —— 从 components/theater 往上数四层是 apps/，
//   路径短了一层。它是 **type-only** 导入，编译后被完全擦除，所以 vite 构建一直没报错，
//   只有 vue-tsc 看得见。改用 tsconfig 里已有的 @engine/* 别名，路径就不再靠人工数层级。
import type { ReplayFile } from "@engine/kernel/replay.ts";
import { displayName } from "../../kb/names.ts";
import { enBanner, enEngine, enSkill, enStatus } from "../../kb/en-engine.ts";

const props = defineProps<{
  replay: unknown; seed: number;
  /** Optional start state (static rendering / tests): frame index, inspector open, inspector tab. */
  initialFrame?: number; initialInspector?: boolean; initialTab?: "chain" | "damage" | "ai" | "status" | "rng";
}>();
const emit = defineEmits<{ (e: "close"): void }>();

/**
 * ★★★ 第 256 轮：**引擎边界只许收到"生"数据**（toRaw）。
 *   起因：replay 一旦以响应式代理的身份进到引擎，`structuredClone` 会抛
 *   「#<Object> could not be cloned」——剧场当场白屏（用户实测，见 stores/simulation.ts 的注）。
 *   store 那侧已经 markRaw；这一层是**边界上的第二道**：不管谁把 replay 传进来（props / ref / reactive），
 *   交到引擎手里之前一律脱掉代理。
 */
const presenter = computed(() => Presenter.fromSerialized(toRaw(props.replay) as ReplayFile));
const idx = ref(Math.max(0, props.initialFrame ?? 0));
const playing = ref(false);
const speed = ref(1);
const showInspector = ref(props.initialInspector ?? false);
let timer: any = null;

const frameCount = computed(() => presenter.value.frameCount);
const view = computed(() => presenter.value.view(idx.value));
const result = computed(() => presenter.value.result);
const events = computed(() => presenter.value.player.frames);

const redUnits = computed(() => view.value?.units.filter(u => u.side === "red") ?? []);
const blueUnits = computed(() => view.value?.units.filter(u => u.side === "blue") ?? []);

/**
 * ★★★ 第 137 轮：**逻辑在 transport.ts 里，状态在这里**。
 *   组件把三个 ref 暴露成 TransportHost；transport 是唯一决定"下一帧是第几帧"的地方。
 *   这样"播放/单步/跳关键时刻"就能在没有 DOM 的环境里被断言（tests/ui14-transport.ts）。
 */
const transport = createTransport({
  host: {
    getIdx: () => idx.value,
    setIdx: (i: number) => { idx.value = i; },
    getPlaying: () => playing.value,
    setPlaying: (p: boolean) => { playing.value = p; },
  },
  frameCount: () => frameCount.value,
  events: () => events.value,
  // 回合归属由 Presenter 给（与 Banner 上显示的回合是同一处真相）
  turnAt: (i: number) => presenter.value.view(i)?.turn ?? 0,
});

function stop() { transport.stop(); }
function play() {
  if (playing.value) return stop();
  transport.play();
  timer = setInterval(() => {
    // ★ tick() 在末尾会自己停；它返回 false 就是"该把计时器清掉"的信号
    if (!transport.tick() && timer) { clearInterval(timer); timer = null; }
  }, frameIntervalMs(speed.value));
}
function goto(i: number) { transport.goto(i); }
function stepBy(n: number) { transport.stepBy(n); }
function nextKeyFrame(dir: number) { transport.nextKeyFrame(dir); }
function nextTurn(dir: number) { transport.nextTurn(dir); }
/**
 * ★ 计时器跟着 playing 走：transport 自己停（单步/跳帧/到末尾）时，
 *   组件这边必须把 setInterval 清掉 —— 否则"暂停了但帧号还在动"。
 */
watch(playing, (p) => { if (!p && timer) { clearInterval(timer); timer = null; } });
watch(() => props.seed, () => { stop(); idx.value = 0; });
onBeforeUnmount(stop);

const ancestry = computed(() => presenter.value.ancestry(idx.value));
// ── ★ G5 Inspectors ──
const inspTab = ref<"chain" | "damage" | "ai" | "status" | "rng">(props.initialTab ?? "damage");
/** Engine strings (skill / status names, AI reasons, damage steps) are Chinese; translate them for display only. */
const banner = computed(() => enBanner(view.value?.banner));
const damage = computed(() => presenter.value.damageBreakdown(idx.value));
const ai = computed(() => presenter.value.aiDecision(idx.value));
const statuses = computed(() => presenter.value.statusTimeline());
const rng = computed(() => presenter.value.rngAt(idx.value));
const rngSummary = computed(() => presenter.value.rngSummary());
const OPEN_STATUS = computed(() => statuses.value.filter(s => s.to === null).length);
const KIND_TONE: Record<string, string> = { SKILL: "skill", DEATH: "death", REVIVE: "revive", STATUS: "status", ORB: "orb", TIMELINE: "timeline", OTHER: "" };
</script>

<template>
  <section class="theater">
    <header class="top">
      <b>Battle Theater</b>
      <span class="mono tiny dim">seed {{ seed }} · {{ frameCount }} frames · {{ result.turns }} turns · {{ result.reason }}</span>
      <span class="badge" :class="result.winner === 0 ? 'red' : result.winner === 1 ? 'blue' : 'warn'">
        {{ result.winner === 0 ? "Red wins" : result.winner === 1 ? "Blue wins" : result.reason }}
      </span>
      <span class="spacer" />
      <label class="sp">Speed
        <button v-for="s in SPEEDS" :key="s" :class="{ on: speed === s }" @click="speed = s">{{ s }}×</button>
      </label>
      <button class="tiny-btn" @click="showInspector = !showInspector">{{ showInspector ? "Hide" : "Show" }} inspector</button>
      <button class="x" @click="emit('close')">✕</button>
    </header>

    <!-- 战场 -->
    <div class="stage">
      <div class="side red">
        <div class="sidehead">
          🔴 Red
          <span class="mono tiny">Alive {{ view?.teams[0].aliveCount ?? 0 }}/5</span>
          <span class="orb mono" :title="`Onibi ${view?.teams[0].orb} · Onibi cycle ${view?.teams[0].cycle}`">
            🔥 {{ view?.teams[0].orb }}/8
            <i v-for="i in 5" :key="i" :class="{ on: (view?.teams[0].gauge ?? 0) >= i }" />
          </span>
        </div>
        <div class="cards"><EntityCard v-for="u in redUnits" :key="u.unitId" :unit="u" /></div>
      </div>

      <div class="center">
        <div v-if="banner" class="banner" :class="KIND_TONE[banner.kind]">
          <div class="bhead">
            <span class="bkind">{{ banner.kind }}</span>
            <b>{{ banner.actor ?? banner.target ?? "—" }}</b>
            <span v-if="banner.skill" class="skill">"{{ banner.skill }}"</span>
            <span v-if="banner.target && banner.actor" class="arrow">→ {{ banner.target }}</span>
          </div>
          <div class="blines">
            <span v-for="(l, i) in banner.lines" :key="i" :class="l.tone ?? 'normal'">{{ l.label }} <b>{{ l.value }}</b></span>
          </div>
        </div>
        <div v-else class="banner empty">—</div>
        <div class="turn mono">Turn {{ view?.turn ?? 0 }} · frame {{ view?.frame ?? 0 }}/{{ frameCount - 1 }}</div>
        <div v-if="view?.warning" class="warnbox">⚠ {{ view.warning }}</div>
      </div>

      <div class="side blue">
        <div class="sidehead">
          <span class="orb mono" :title="`Onibi ${view?.teams[1].orb} · Onibi cycle ${view?.teams[1].cycle}`">
            🔥 {{ view?.teams[1].orb }}/8
            <i v-for="i in 5" :key="i" :class="{ on: (view?.teams[1].gauge ?? 0) >= i }" />
          </span>
          <span class="mono tiny">Alive {{ view?.teams[1].aliveCount ?? 0 }}/5</span>
          Blue 🔵
        </div>
        <div class="cards"><EntityCard v-for="u in blueUnits" :key="u.unitId" :unit="u" /></div>
      </div>
    </div>

    <!-- Action Bar：行动条的真实位置（拉条/推条会直接改变它） -->
    <div class="actionbar">
      <div class="abtitle mono tiny">ACTION BAR (further right = acts sooner)</div>
      <div v-for="u in view?.units ?? []" :key="u.unitId" class="abrow" :class="u.side">
        <span class="abname mono">{{ enEngine(displayName(u.name)) }}</span>
        <div class="abtrack">
          <div class="abfill" :style="{ width: (u.timeline * 100) + '%' }" />
          <span class="abdot" :style="{ left: (u.timeline * 100) + '%' }" />
        </div>
        <span class="abspd mono tiny">{{ u.stats.spd.toFixed(1) }}</span>
      </div>
    </div>

    <!-- 控制条 -->
    <div class="controls">
      <button @click="goto(0)" title="Go to start">⏮</button>
      <button @click="nextKeyFrame(-1)" title="Previous key moment">⏪</button>
      <button @click="nextTurn(-1)" title="Previous turn">⟲</button>
      <button @click="stepBy(-1)" title="Previous frame">◀</button>
      <button class="play" @click="play">{{ playing ? "⏸ Pause" : "▶ Play" }}</button>
      <button @click="stepBy(1)" title="Next frame">▶</button>
      <button @click="nextTurn(1)" title="Next turn">⟳</button>
      <button @click="nextKeyFrame(1)" title="Next key moment">⏩</button>
      <button @click="goto(frameCount - 1)" title="Go to end">⏭</button>
      <span class="mono tiny dim">{{ idx + 1 }} / {{ frameCount }}</span>
    </div>
    <input class="scrub" type="range" min="0" :max="Math.max(0, frameCount - 1)" :value="idx"
           @input="stop(); goto(+($event.target as HTMLInputElement).value)" />

    <!-- 事件流 + 事件链检查器 -->
    <div v-if="showInspector" class="inspector">
      <div class="stream">
        <button v-for="(e, i) in events" :key="i" class="evrow" :class="{ on: i === idx }" @click="stop(); goto(i)">
          <span class="mono tiny">#{{ e.frame }}</span>
          <span class="code mono tiny">{{ e.t }}</span>
          <span class="txt">{{ enEngine(displayName(view?.units.find(u => u.id === (e as any).src || u.id === (e as any).actor)?.name)) }}
            <template v-if="(e as any).dst || (e as any).target"> → {{ enEngine(displayName(view?.units.find(u => u.id === ((e as any).dst ?? (e as any).target))?.name)) }}</template>
            <template v-if="(e as any).skill"> "{{ enSkill((e as any).skill) }}"</template>
            <template v-if="(e as any).applied !== undefined"> -{{ Math.round((e as any).applied) }}</template>
            <template v-if="(e as any).amount !== undefined"> +{{ Math.round((e as any).amount) }}</template>
          </span>
        </button>
      </div>
      <aside class="chain">
        <div class="tabs">
          <button :class="{ on: inspTab === 'damage' }" @click="inspTab = 'damage'">Damage breakdown</button>
          <button :class="{ on: inspTab === 'ai' }" @click="inspTab = 'ai'">AI decision</button>
          <button :class="{ on: inspTab === 'status' }" @click="inspTab = 'status'">Status lifecycle</button>
          <button :class="{ on: inspTab === 'rng' }" @click="inspTab = 'rng'">RNG</button>
          <button :class="{ on: inspTab === 'chain' }" @click="inspTab = 'chain'">Event chain</button>
        </div>

        <!-- 伤害检查器（§26）：这个数字是怎么来的 -->
        <template v-if="inspTab === 'damage'">
          <template v-if="damage">
            <div class="tiny dim">Last damage at frame {{ damage.frame }} (skill: {{ damage.data.skill ? enEngine(damage.data.skill) : "—" }}, type {{ damage.data.type }})</div>
            <ol class="steps">
              <li v-for="(s, i) in damage.data.steps" :key="i">{{ enEngine(s) }}</li>
            </ol>
            <div class="kv"><span class="k">Raw</span><span class="mono">{{ damage.data.raw.toFixed(1) }}</span></div>
            <div class="kv"><span class="k">Final</span><span class="mono">{{ damage.data.final.toFixed(1) }}</span></div>
            <div class="kv"><span class="k">Applied</span><span class="mono">{{ damage.data.applied.toFixed(1) }}</span></div>
            <div v-if="damage.data.absorbed" class="kv"><span class="k">Shield absorbed</span><span class="mono">{{ damage.data.absorbed.toFixed(1) }}</span></div>
          </template>
          <div v-else class="dim small">No damage has occurred up to this frame.</div>
        </template>

        <!-- AI 检查器（§25）：为什么放这个技能、为什么打这个目标 -->
        <template v-else-if="inspTab === 'ai'">
          <template v-if="ai?.skill">
            <div class="kv"><span class="k">Chosen</span><b>{{ ai.skill.chosen ? enSkill(ai.skill.chosen) : "—" }}</b></div>
            <div class="kv"><span class="k">Reason</span><span class="mono tiny">{{ enEngine(ai.skill.reason) }}</span></div>
            <div v-if="ai.skill.note" class="warnbox">{{ enEngine(ai.skill.note) }}</div>
            <div class="tiny dim">Onibi {{ ai.skill.orbs }}<template v-if="ai.skill.maxOrbs">/{{ ai.skill.maxOrbs }}</template></div>
            <table class="ruletbl">
              <thead><tr><th>Rule</th><th>Skill</th><th>Onibi</th><th>Condition</th></tr></thead>
              <tbody>
                <tr v-for="r in ai.skill.rules" :key="r.index">
                  <td class="mono tiny">#{{ r.index }}</td>
                  <td>{{ r.skill ? enSkill(r.skill) : "—" }}</td>
                  <td class="mono tiny">{{ r.cost ?? "—" }}</td>
                  <td class="tiny">
                    <span :class="r.affordable ? 'ok' : 'bad'">{{ r.affordable ? "affordable" : "too costly" }}</span>
                    <span :class="r.cond ? 'ok' : 'bad'">{{ r.cond ? "condition met" : "condition not met" }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </template>
          <div v-else class="dim small">No AI decision up to this frame.</div>
          <template v-if="ai?.target">
            <div class="kv" style="margin-top:6px"><span class="k">Target</span><b>{{ enEngine(displayName(view?.units.find(u => u.id === ai!.target!.chosen)?.name)) || "—" }}</b></div>
            <div class="tiny dim">Rule: {{ ai.target.rule ? enEngine(ai.target.rule) : "(no target rule → defaults to first enemy)" }}<template v-if="ai.target.note"> · {{ enEngine(ai.target.note) }}</template></div>
          </template>
        </template>

        <!-- 状态检查器（§27）：生命周期而不是快照 -->
        <template v-else-if="inspTab === 'status'">
          <div class="tiny dim">{{ statuses.length }} status records, {{ OPEN_STATUS }} still active</div>
          <div class="stlist">
            <div v-for="(s, i) in statuses.slice(-40)" :key="i" class="strow" :class="{ open: s.to === null, unknown: !s.known }">
              <span class="mono tiny">{{ s.unitId }}</span>
              <span class="stname">{{ enStatus(s.name ?? s.status) }}</span>
              <span class="mono tiny">frame {{ s.from }}<template v-if="s.to !== null"> → {{ s.to }}</template><template v-else> → active</template></span>
              <span class="tiny dim">{{ s.duration ?? "?" }} turns · source {{ s.source ?? "—" }}</span>
              <span v-if="!s.known" class="tiny bad">source data missing</span>
            </div>
          </div>
        </template>

        <!-- 随机数检查器（§20） -->
        <template v-else-if="inspTab === 'rng'">
          <div class="tiny dim">{{ rngSummary.total }} draws in the battle: {{ rngSummary.labeled }} labeled, {{ rngSummary.unlabeled }} unlabeled</div>
          <div class="taglist">
            <span v-for="(n, t) in rngSummary.byTag" :key="t" class="tag" :class="{ unlabeled: t === 'unlabeled' }">{{ enEngine(t) }} ×{{ n }}</span>
          </div>
          <template v-if="rng">
            <div class="tiny dim" style="margin-top:6px">Used in this frame:</div>
            <div v-for="d in rng.draws" :key="d.n" class="kv">
              <span class="k">#{{ d.n }}</span><span class="mono">{{ d.v.toFixed(6) }}</span><span class="tiny dim">{{ enEngine(d.tag) }}</span>
            </div>
          </template>
          <div v-else class="dim small">No random numbers used in this frame.</div>
          <p class="note">Unlabeled draws are shown as unlabeled; we do not pretend to know the purpose of every roll.</p>
        </template>

        <!-- 事件链（§28） -->
        <template v-else>
          <div v-if="ancestry.length" class="clist">
            <div v-for="(n, i) in ancestry" :key="n.seq" class="cnode" :style="{ marginLeft: (i * 10) + 'px' }">
              <span class="mono tiny">#{{ n.seq }}</span> {{ n.code }}
              <span class="tiny dim">depth {{ n.depth }} · handlers {{ n.handlerCount }}</span>
            </div>
          </div>
          <div v-else class="dim small">This frame belongs to no event (pre-battle setup frame).</div>
          <p class="note">The event chain is the only record of which skill triggered this damage and what triggered that; battle setup and every turn are nodes.</p>
        </template>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.theater { background: var(--panel2); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
.top { display: flex; align-items: center; gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--line); background: var(--panel); }
.spacer { flex: 1; }
.sp { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--fg-faint); }
.sp button { font-size: 10.5px; padding: 2px 7px; } .sp button.on { background: #2b4a7a; border-color: #3a5f96; }
.tiny-btn { font-size: 11px; padding: 3px 8px; }
.badge { font-size: 11px; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--line); }
.badge.red { color: var(--red); border-color: #6b2f28; } .badge.blue { color: var(--blue); border-color: #2b4a7a; }
.badge.warn { color: var(--warn); border-color: #6b5520; }
.stage { display: grid; grid-template-columns: 1fr 300px 1fr; gap: 12px; padding: 12px 14px; }
.side { display: flex; flex-direction: column; gap: 6px; }
.sidehead { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--fg-dim); }
.side.blue .sidehead { justify-content: flex-end; }
.orb { color: var(--warn); display: inline-flex; align-items: center; gap: 2px; }
.orb i { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: #3a3f4a; }
.orb i.on { background: var(--warn); }
.cards { display: flex; flex-direction: column; gap: 6px; }
.center { display: flex; flex-direction: column; gap: 8px; align-items: stretch; justify-content: flex-start; }
.banner { min-height: 62px; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: var(--panel); }
.banner.skill { border-color: #3a5f96; } .banner.death { border-color: #6b2f28; } .banner.revive { border-color: #2f5741; }
.banner.orb { border-color: #6b5520; } .banner.timeline { border-color: #4a3f6b; } .banner.status { border-color: #2f5741; }
.banner.empty { display: grid; place-items: center; color: var(--fg-faint); font-size: 11px; }
.bhead { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.bkind { font-size: 9.5px; padding: 1px 5px; border-radius: 3px; background: var(--panel2); color: var(--fg-faint); }
.skill { color: #9fc0ea; } .arrow { color: var(--fg-dim); font-size: 11.5px; }
.blines { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 5px; font-size: 11.5px; color: var(--fg-dim); }
.blines b { color: var(--fg); } .blines .crit b { color: #ff8a5c; } .blines .heal b { color: var(--ok); }
.blines .warn b { color: var(--warn); } .blines .resist b { color: #7fa8e0; }
.turn { text-align: center; color: var(--fg-faint); font-size: 11px; }
.warnbox { background: #2a2213; color: var(--warn); border-radius: 7px; padding: 5px 8px; font-size: 11px; margin-top: 5px; }
.kv { display: grid; grid-template-columns: 72px 1fr auto; gap: 6px; font-size: 11.5px; padding: 1px 0; }
.kv .k { color: var(--fg-faint); }
.actionbar { padding: 6px 14px 10px; border-top: 1px solid var(--line); }
.abtitle { color: var(--fg-faint); margin-bottom: 4px; }
.abrow { display: grid; grid-template-columns: 86px 1fr 44px; gap: 8px; align-items: center; }
.abname { font-size: 10.5px; color: var(--fg-dim); text-align: right; overflow: hidden; white-space: nowrap; }
.abtrack { position: relative; height: 6px; background: #0f1116; border-radius: 3px; }
.abfill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #23303f, #3a5f96); border-radius: 3px; transition: width .12s linear; }
.abrow.red .abfill { background: linear-gradient(90deg, #2a1614, #8f2f2f); }
.abdot { position: absolute; top: -2px; width: 10px; height: 10px; border-radius: 50%; background: var(--fg); transform: translateX(-50%); transition: left .12s linear; }
.abrow.red .abdot { background: var(--red); } .abrow.blue .abdot { background: var(--blue); }
.abspd { color: var(--fg-faint); text-align: right; }
.controls { display: flex; align-items: center; gap: 5px; padding: 6px 14px; border-top: 1px solid var(--line); flex-wrap: wrap; }
.controls button { font-size: 12px; padding: 3px 8px; }
.controls .play { background: #2b4a7a; border-color: #3a5f96; }
.scrub { margin: 0 14px 10px; }
.inspector { display: grid; grid-template-columns: 1fr 320px; border-top: 1px solid var(--line); min-height: 0; }
.stream { max-height: 220px; overflow-y: auto; padding: 4px 0; }
.evrow { display: grid; grid-template-columns: 52px 104px 1fr; gap: 6px; width: 100%; text-align: left; background: none; border: none; border-radius: 0; padding: 2px 12px; font-size: 11.5px; color: var(--fg-dim); }
.evrow:hover { background: var(--panel); } .evrow.on { background: #1a2233; color: var(--fg); }
.evrow .code { color: var(--fg-faint); }
.chain { border-left: 1px solid var(--line); padding: 10px 12px; max-height: 320px; overflow-y: auto; }
.tabs { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 8px; }
.tabs button { font-size: 10.5px; padding: 2px 7px; border-radius: 5px; }
.tabs button.on { background: #2b4a7a; border-color: #3a5f96; }
.steps { margin: 6px 0; padding-left: 18px; font-size: 11px; line-height: 1.75; color: var(--fg-dim); }
.ruletbl { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 11px; }
.ruletbl th { text-align: left; color: var(--fg-faint); font-weight: 500; font-size: 10px; padding: 2px 4px; }
.ruletbl td { padding: 2px 4px; border-top: 1px solid #1b1f28; }
.ruletbl .ok { color: var(--ok); margin-right: 5px; } .ruletbl .bad { color: var(--danger); margin-right: 5px; }
.stlist { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.strow { display: grid; grid-template-columns: 30px 1fr auto; gap: 5px; font-size: 11px; padding: 2px 4px; border-radius: 4px; background: var(--panel); align-items: baseline; }
.strow.open { border-left: 2px solid var(--ok); }
.strow.unknown { border-left: 2px solid var(--danger); }
.stname { color: var(--fg); }
.strow .bad { color: var(--danger); }
.taglist { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.tag { font-size: 10px; padding: 1px 5px; border-radius: 3px; background: var(--panel); color: var(--fg-dim); font-family: var(--mono); }
.tag.unlabeled { background: #2a2213; color: var(--warn); }
.ctitle { font-size: 11.5px; color: var(--fg-dim); margin-bottom: 6px; }
.cnode { font-size: 11px; padding: 1px 0; }
.note { font-size: 10.5px; color: var(--fg-faint); line-height: 1.6; margin-top: 8px; }
.small { font-size: 12px; } .tiny { font-size: 10px; } .dim { color: var(--fg-dim); }
</style>
