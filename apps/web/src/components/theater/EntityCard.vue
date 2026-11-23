<script setup lang="ts">
// components/theater/EntityCard.vue — 实时 Entity Card（a1-4 §13）
// 显示：HP / Shield / 行动条位置 / Buff·Debuff / 当前八维 / 死亡·变形状态
import type { UnitView } from "../../theater/presenter.ts";
import { displayName } from "../../kb/names.ts";
import { enEngine } from "../../kb/en-engine.ts";
import { enText } from "../../kb/en-text.ts";

defineProps<{ unit: UnitView; compact?: boolean }>();
/** Status chip tooltip name: KB buff ids ("3444_1") get their English name; betting-kit ids stay as they are. */
const statusName = (id: string) => enText("buff:" + id + ":name", id);
const fmt = (n: number) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k" : Math.round(n).toLocaleString());
// ★★ 第 63 轮：从 Record<string, string> 收紧成**闭合** Record<UnitView["state"], string>。
//   原来那样写，presenter 的 state 联合一旦多一个状态，这里就静默少一个键 ——
//   卡片上会显示空白（undefined），而没有任何检查会红。这正是第 61 轮 KLASS_LABEL 的同一形状。
//   收紧之后，"加状态忘了加标签"会在 vue-tsc 阶段报错，而 tests/ui12-typecheck.ts 把 vue-tsc 放进了套件。
const STATE_LABEL: Record<UnitView["state"], string> = {
  ALIVE: "Alive", HP_ZERO: "HP≤0", DEAD: "Dead", KILLED: "Killed", TRANSFORMED: "Transformed",
};
</script>

<template>
  <div class="card" :class="[unit.side, { dead: !unit.alive, actor: unit.isActor, target: unit.isTarget, transformed: unit.state === 'TRANSFORMED' }]">
    <div class="top">
      <span class="nm">{{ enEngine(displayName(unit.name)) }}</span>
      <!--
        ★★★ 第 139 轮：判据从「死没死」改成「**状态是不是 ALIVE**」。
          原来是 v-if="!unit.alive" ⇒ 变形中的单位（alive=true）**永远不显示徽标**，
          于是样式表里那条 .state.transformed（琥珀色）是**渲染不到的规则**，
          而 §18 要求「死亡状态机可视化」——变形是这条状态机的一态，画面上却一个字都没有。
          （SSR 渲染断言当场把这件事照出来了：类名在、文字不在。）
        ★ 锁定标记从 v-else-if 改成独立判断：变形与锁定是两件事，不该互相顶掉。
      -->
      <span v-if="unit.state !== 'ALIVE'" class="state" :class="unit.state.toLowerCase()">{{ STATE_LABEL[unit.state] }}</span>
      <span v-if="unit.locked" class="lock" title="Action bar locked">🔒</span>
    </div>

    <div class="hpbar" :title="`${Math.round(unit.hp)} / ${unit.maxHp}`">
      <i :style="{ width: unit.hpPct + '%' }" />
      <span class="hptxt mono">{{ Math.round(unit.hpPct) }}%</span>
    </div>
    <div class="hpline mono tiny">
      {{ fmt(unit.hp) }} / {{ fmt(unit.maxHp) }}
      <span v-if="unit.shield > 0" class="shield">🛡 {{ fmt(unit.shield) }}</span>
    </div>

    <!-- 行动条位置：这一格是"跑条"的可视化 -->
    <div class="track" :title="`Action bar ${(unit.timeline * 100).toFixed(1)}%`">
      <i :style="{ left: (unit.timeline * 100) + '%' }" />
    </div>

    <div v-if="unit.statuses.length" class="buffs">
      <span v-for="s in unit.statuses.slice(0, 6)" :key="s.tag ?? s.id" class="buff" :class="{ debuff: s.isDebuff }"
            :title="`${statusName(s.id)}${statusName(s.id) !== s.id ? ' (' + s.id + ')' : ''}\n${s.remaining} turn(s) left · ${s.stacks} stack(s) · tag ${s.tag ?? '—'}${s.effects ? ' · ' + s.effects + ' active effect(s)' : ''}`">
        {{ s.id.length > 8 ? s.id.slice(0, 8) : s.id }}<i v-if="s.stacks > 1">×{{ s.stacks }}</i>
      </span>
      <span v-if="unit.statuses.length > 6" class="tiny dim">+{{ unit.statuses.length - 6 }}</span>
    </div>

    <div v-if="!compact" class="stats mono tiny">
      <span title="ATK">ATK {{ fmt(unit.stats.atk) }}</span>
      <span title="DEF">DEF {{ Math.round(unit.stats.def) }}</span>
      <span title="Speed">SPD {{ unit.stats.spd.toFixed(2) }}</span>
      <span title="Crit / Crit DMG">CRT {{ (unit.stats.cri * 100).toFixed(0) }}/{{ (unit.stats.crid * 100).toFixed(0) }}</span>
      <!-- ★ 这两维在引擎里**没有任何消费者**（没有「先判定命中、再结算」这一级）。
           不加区分地显示，看的人会以为它在参与结算 —— 所以加「未结算」标记，
           与 Fidelity 报告里的同一条 caveat 对应。 -->
      <span class="unused" title="Effect HIT / Effect RES: not used by the engine (there is no hit-check-before-resolution stage); shown for reference only">HIT {{ (unit.stats.efh * 100).toFixed(0) }}/{{ (unit.stats.efr * 100).toFixed(0) }}<i>not applied</i></span>
    </div>
  </div>
</template>

<style scoped>
.card { position: relative; background: var(--panel); border: 1px solid var(--line); border-radius: 9px; padding: 7px 9px; display: flex; flex-direction: column; gap: 3px; transition: border-color .15s, box-shadow .15s; }
.card.red { border-left: 3px solid var(--red); }
.card.blue { border-left: 3px solid var(--blue); }
.card.actor { border-color: var(--ok); box-shadow: 0 0 0 1px var(--ok) inset; }
.card.target { border-color: var(--warn); }
.card.dead { opacity: .42; filter: grayscale(.6); }
.card.transformed { opacity: .7; border-style: dashed; }
.top { display: flex; align-items: center; gap: 6px; }
.nm { font-size: 12.5px; font-weight: 600; }
.state { font-size: 9.5px; padding: 1px 5px; border-radius: 999px; background: #2a1614; color: var(--danger); }
.state.transformed { background: #2a2213; color: var(--warn); }
.lock { font-size: 10px; margin-left: auto; }
.hpbar { position: relative; height: 9px; background: #0f1116; border-radius: 4px; overflow: hidden; }
.hpbar i { display: block; height: 100%; transition: width .12s linear; }
.card.red .hpbar i { background: linear-gradient(90deg, #8f2f2f, var(--red)); }
.card.blue .hpbar i { background: linear-gradient(90deg, #2f4a8f, var(--blue)); }
.hptxt { position: absolute; inset: 0; text-align: center; font-size: 8.5px; line-height: 9px; color: #fff; text-shadow: 0 0 3px #000; }
.hpline { display: flex; gap: 6px; color: var(--fg-faint); }
.shield { color: #7fa8e0; }
.track { position: relative; height: 3px; background: #0f1116; border-radius: 2px; }
.track i { position: absolute; top: -2px; width: 7px; height: 7px; border-radius: 50%; background: var(--fg-dim); transition: left .12s linear; }
.card.red .track i { background: var(--red); } .card.blue .track i { background: var(--blue); }
.buffs { display: flex; flex-wrap: wrap; gap: 3px; }
.buff { font-size: 9.5px; padding: 0 4px; border-radius: 3px; background: #1b2a1f; color: #8fd0a5; }
.buff.debuff { background: #2a1b1b; color: #e0a1a1; }
.stats { display: flex; flex-wrap: wrap; gap: 7px; color: var(--fg-faint); }
  /* 未参与结算的维度：变暗 + 角标。不删掉它 —— 它确实是输入的一部分，只是没人消费。 */
  .stats .unused { opacity: .6; }
  .stats .unused i { font-style: normal; font-size: 8px; margin-left: 2px; padding: 0 2px; border-radius: 2px; background: #2a2213; color: var(--warn); }
.tiny { font-size: 10px; } .dim { color: var(--fg-dim); }
</style>
