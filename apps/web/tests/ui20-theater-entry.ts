// tests/ui20-theater-entry.ts — ★★★ 第 256 轮：**「观看战斗」这个入口**的验收
//
// 由来（用户实测）：「点了观看战斗，看不了」—— 根因是那个标签页**只切视图**（`@click="view = v.id"`），
//   没录过录像时就只剩一句「还没有可观看的战斗。」；而录制本来只需要 ~100ms，界面却没有任何"正在录"的表示。
//
// 处置与第 137 轮 transport 那次同型：**逻辑搬出 <script setup>**（本仓库没有 jsdom / @vue/test-utils，
//   留在组件里就等于没有验收）—— 收成 store 的 `watchOrReplay`，组件只负责接线。这个文件按项目纪律配正反两面。
import fs from "node:fs";
import path from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { useSimulationStore } from "../src/stores/simulation.ts";
import { canonicalMatch } from "../src/mock/canonical-match.ts";

const here = import.meta.dirname;
const ROOT = path.resolve(here, "..", "..", "..");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const S = (p: string) => fs.readFileSync(path.join(here, "..", "src", p), "utf8");
const src = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** 假 worker：只记录 postMessage —— store 只要求 worker 有 postMessage/onmessage */
const mk = () => {
  setActivePinia(createPinia());
  const sim = useSimulationStore();
  const sent: any[] = [];
  sim.worker = { postMessage: (m: any) => sent.push(m) } as any;
  return { sim, sent };
};

sec("[1] ★★★ 没录像 ⇒ 当场录一场（这是用户点「观看战斗」时应该发生的事）");
{
  const { sim, sent } = mk();
  const r = sim.watchOrReplay(canonicalMatch() as any, 20261001);
  ok("★★★ 返回 recording，且真的发出 REPLAY 请求", r === "recording" && sent.length === 1 && sent[0].type === "REPLAY", JSON.stringify({ r, sent: sent.map((m) => m.type) }));
  ok("★★★ seed 原样传下去（观看到的就是他指定的那一场）", sent[0]?.seed === 20261001, String(sent[0]?.seed));
  ok("★★★ 而且立刻进入「正在录」状态（界面这才有东西可说，不是空白等待）", sim.replayPending === true, String(sim.replayPending));
}

sec("[2] ★★★ 已有录像 ⇒ **不重复录**（只是切视图）");
{
  const { sim, sent } = mk();
  sim.replayFile = { frames: [] };
  const r = sim.watchOrReplay(canonicalMatch() as any, 123);
  ok("★★★ 返回 reused 且一个请求都不发（否则每点一次就重录一场）", r === "reused" && sent.length === 0, JSON.stringify({ r, sent: sent.length }));
  ok("★★ 已有录像时 pending 不该被点亮", sim.replayPending === false, String(sim.replayPending));
}

sec("[3] ★★★ pending 的生命周期：成功要熄、失败也要熄（不许永远转圈）");
{
  const { sim, sent } = mk();
  sim.replay(canonicalMatch() as any, 7);
  /** ★ requestId 是 store 现生成的（newId()）—— 判据要用**真实那个**，不能自己编一个（第一版就是自己编的，两条都假红） */
  const rid = sent[0].requestId;
  ok("★★★ replay() 之后 pending = true", sim.replayPending === true);
  sim.onMessage({ type: "REPLAY_PREPARED", requestId: rid, seed: 7, events: [], units: [], turns: 3, winner: "red", replay: { frames: [] } } as any);
  ok("★★★ 收到 REPLAY_PREPARED ⇒ pending 熄掉、replayFile 落地", sim.replayPending === false && !!sim.replayFile, JSON.stringify({ pending: sim.replayPending, file: !!sim.replayFile }));
  const b = mk();
  b.sim.replay(canonicalMatch() as any, 8);
  b.sim.onMessage({ type: "SIMULATION_FAILED", requestId: b.sent[0].requestId, message: "引擎炸了" } as any);
  ok("★★★ 收到失败 ⇒ pending 也要熄（并留下错误信息给界面显示）", b.sim.replayPending === false && b.sim.error === "引擎炸了", JSON.stringify({ pending: b.sim.replayPending, error: b.sim.error }));
  const c = mk();
  c.sim.replay(canonicalMatch() as any, 9);
  c.sim.onMessage({ type: "SIMULATION_FAILED", requestId: "reqOther", message: "别人的请求" } as any);
  ok("★★ 反向：**别的** requestId 的消息不许清掉我的 pending（否则并发时会互相打断）", c.sim.replayPending === true, String(c.sim.replayPending));
}

sec("[4] ★★★ 组件接线：标签页真的走 openTheater，空状态把三种情况分开说");
{
  const app = S("App.vue");
  ok("★★★ 「观看战斗」标签的点击走 openTheater（不再是裸的 view = v.id）",
    /v\.id === 'theater' \? openTheater\(\)/.test(app), (app.match(/@click="v\.id[^"]*"/) ?? [""])[0]);
  ok("★★★ openTheater 里调 watchOrReplay（接线到 store，而不是又抄一遍逻辑）", /function openTheater\(\)[\s\S]{0,160}watchOrReplay\(/.test(app));
  ok("★★★ 正在录时界面说「正在录这一场」", /replayPending">Recording this battle/.test(app));
  ok("★★★ 录制失败时界面说「录制失败」（不许冒充「还没有」）", /sim\.error" class="errbar">✗ Recording failed/.test(app));
  ok("★★ 正在录时那个按钮是禁用的（防连点）", /:disabled="filled < 10 \|\| sim\.replayPending"/.test(app));
  ok("★★ 反向：组件里**没有**再写一遍「有录像就不录」的判断（逻辑只有 store 一份）",
    !/if \(sim\.replayFile\)/.test(app));
}

sec("[5] ★★ worker 侧仍然认识 REPLAY（源码级；真跑一遍见 tools/_probe-watch256.ts 与 _probe-watch256b.ts）");
{
  ok("★★ protocol 里有 REPLAY 分支，且回的是 REPLAY_PREPARED", /case "REPLAY"/.test(src("apps/web/src/workers/protocol.ts")) && /REPLAY_PREPARED/.test(src("apps/web/src/workers/protocol.ts")));
  ok("★★ store 的 replay 请求带上 match 的**深拷贝**（worker 改不到主线程的对象）",
    /replay\(match: GuessingMatch, seed: number\)[\s\S]{0,220}JSON\.parse\(JSON\.stringify\(match\)\)/.test(S("stores/simulation.ts")));
}

sec("[6] ★★★ 出错不许静默：两层错误出口都要在（用户截图里那块空白就是没人接的异常）");
{
  const app = S("App.vue");
  const main = S("main.ts");
  ok("★★★ App.vue 接住子树异常（onErrorCaptured）并把信息存下来", /onErrorCaptured\(\(err/.test(app) && /crash\.value = info/.test(app));
  ok("★★★ 而且**画出来**了（不是只 console.error）", /v-if="crash"/.test(app) && /UI error/.test(app));
  ok("★★★ main.ts 装了全局 errorHandler，且往页面塞一条看得见的错误条", /app\.config\.errorHandler/.test(main) && /dsh-crash/.test(main));
  ok("★★ 全局那条**不依赖 Vue 渲染树**（树自己坏了它才最需要工作）：直接 createElement 挂到 #app", /createElement\("pre"\)/.test(main) && /getElementById\("app"\)/.test(main));
  ok("★★ 反向：接住之后**仍然** console.error（不许把错误吞掉 —— 那是另一种静默）", /console\.error\("\[engine-ui\]/.test(main) && /console\.error\("\[engine-ui\]\[App\]/.test(app));
  ok("★★ 两条出口分工写清了：App 层 return false（不再上冒），全局层留给渲染树之外的错误", /return false;\s*\/\/ 已经画出来了/.test(app));
}

console.log("\nui20-theater-entry: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
