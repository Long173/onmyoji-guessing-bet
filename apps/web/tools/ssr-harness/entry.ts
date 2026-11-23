// tools/ssr-harness/entry.ts — ★★★ 第 138 轮：**不用 jsdom** 的组件运行时验收（a1-4 §33 / 目标 ⑪）
//
// 由来（第 137 轮审核的结构性结论）：本仓库没有 @vue/test-utils / jsdom / playwright，
// 所以**所有** .vue 断言都只能读源码正则 + vue-tsc —— 「组件行为」这一类要求属于「实现有、验收无」。
//
// 这一层把静态渲染那一半补上：vue 自带 vue/server-renderer，Node 里不需要 DOM 就能把 SFC 渲成 HTML 字符串。
// 于是「卡面上的记数串长什么样」「编译徽章对四个档位分别渲染成什么」可以被**真的渲染出来**再断言，
// 而不是靠正则在源码里找字符串。
//
// ★ 它不替代交互验收（点击、悬停、播放控制）：那些仍然靠 transport/presenter 分层 + 源码级接线断言。
//   这里明确只主张**静态渲染**：给定 props，产出什么 HTML。
// ★ 由 tests/ui16-ssr-render.ts 驱动：测试会现场调用 vite build --ssr 生成产物（约 300ms），跑完删掉。
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import UnitTile from "../../src/components/lineup/UnitTile.vue";
import CompiledBadge from "../../src/components/knowledge/CompiledBadge.vue";
import FidelityPanel from "../../src/components/simulation/FidelityPanel.vue";
import HealthCheck from "../../src/components/simulation/HealthCheck.vue";
// ★ 第 139 轮：Theater 与 Entity Card 也能真渲染 —— 这才是 §12-§19 那批「画面上必须看得见」的验收。
//   Theater 用的是 Presenter（纯函数层），SSR 里不需要 Worker、不需要计时器、不需要 DOM。
import EntityCard from "../../src/components/theater/EntityCard.vue";
import BattleTheater from "../../src/components/theater/BattleTheater.vue";
// ★ 第 256 轮：整页壳（用户截图里那块空白就在这一层）
import { createPinia } from "pinia";
import App from "../../src/App.vue";
// English-everywhere checks (tests/ui26-en-everywhere.ts): results, replay viewer, detail drawer.
import ResultDashboard from "../../src/components/result/ResultDashboard.vue";
import ReplayViewer from "../../src/components/result/ReplayViewer.vue";
import DetailDrawer from "../../src/components/knowledge/DetailDrawer.vue";

export async function renderTile(props: any): Promise<string> {
  return await renderToString(createSSRApp(UnitTile, props));
}

export async function renderBadge(status: any): Promise<string> {
  return await renderToString(createSSRApp(CompiledBadge, { status }));
}

export async function renderPanel(fidelity: any, expanded = false): Promise<string> {
  return await renderToString(createSSRApp(FidelityPanel, { fidelity, expanded }));
}

/** Readiness panel (HealthCheck) for a match and its engine validation report. */
export async function renderHealth(match: any, report: any): Promise<string> {
  return await renderToString(createSSRApp(HealthCheck, { match, report }));
}

export async function renderCard(unit: any): Promise<string> {
  return await renderToString(createSSRApp(EntityCard, { unit }));
}

/** 整场 Theater：喂真实 Replay 文件，渲出第一帧（10 张卡 + 行动条 + 鬼火 + 控制条） */
export async function renderTheater(replay: any, seed = 0, opts: { initialFrame?: number; initialInspector?: boolean; initialTab?: string } = {}): Promise<string> {
  return await renderToString(createSSRApp(BattleTheater, { replay, seed, ...opts }));
}

/** Simulation results dashboard on one tab (outcome / uncertainty / units / samples). */
export async function renderResults(result: any, fidelity: any, initialTab: string): Promise<string> {
  return await renderToString(createSSRApp(ResultDashboard, { result, fidelity, initialTab }));
}

/** Step-by-step replay viewer (event list + inspector of the first event). */
export async function renderReplay(rep: any, seed: number): Promise<string> {
  return await renderToString(createSSRApp(ReplayViewer, { seed, events: rep.events, units: rep.units, turns: rep.turns, winner: rep.winner }));
}

/** Shikigami detail drawer on one tab (skills / ai / soul); the KB detail is loaded through onServerPrefetch. */
export async function renderDrawer(unit: any, tab: "skills" | "ai" | "soul", skillStatus: any[] = []): Promise<string> {
  return await renderToString(createSSRApp(DetailDrawer, { open: true, unit, tab, skillStatus }));
}

/**
 * ★★★ 第 256 轮：**整页 App 的静态渲染**。
 *   由来：用户截图里「观看战斗」标签下**整块空白**（连兜底文案都没有）—— 组件级渲染都是绿的，
 *   所以要把**壳**也渲一遍：壳坏了的话，组件级再绿也说明不了页面能不能看。
 *   ★ 这里只主张静态渲染：SSR 不跑 onMounted（Worker 不会真的开），也不替代交互验收。
 */
export async function renderApp(): Promise<string> {
  const app = createSSRApp(App);
  app.use(createPinia());
  return await renderToString(app);
}
