// tests/ui21-reactive-replay.ts — ★★★ 第 256 轮：**剧场的白屏是怎么来的**（用户实测 · 错误条抓到的原话）
//
// 原话：Failed to execute 'structuredClone' on 'Window': #<Object> could not be cloned.
//
// 根因链：replay 文件存进 Pinia state ⇒ Vue 把它包成**响应式代理** ⇒ 引擎的 replay/snapshot 用 \`structuredClone\` 复制状态帧
//   ⇒ **代理不能被结构化克隆** ⇒ 剧场一渲染就抛，整块空白。
// ★ 为什么三条探针（引擎 / Worker / SSR）全绿：它们喂的都是**原始对象** —— 浏览器里喂的却是代理。
//   这一族（"测试路径与线上路径不是同一条"）在本仓库已经栽过，所以这条尺子**两个方向都钉**：
//   ① 复现（代理 ⇒ 必抛，且错误信息就是用户看到的那一句）；② 修法（markRaw / toRaw ⇒ 不抛），并守住那两处接线。
import fs from "node:fs";
import path from "node:path";
import { reactive, markRaw, toRaw } from "vue";
import { Presenter } from "../src/theater/presenter.ts";
import { createProtocol } from "../src/workers/protocol.ts";
import { createEngineAdapter } from "../src/adapters/engine-adapter.ts";
import { canonicalMatch } from "../src/mock/canonical-match.ts";

const here = import.meta.dirname;
const WEB = path.resolve(here, "..");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const S = (p: string) => fs.readFileSync(path.join(WEB, "src", p), "utf8");

/** 录一场真的（同 Worker 那条路径），拿原始 replay */
const bundle = JSON.parse(fs.readFileSync(path.join(WEB, "src", "engine", "bundle.json"), "utf8"));
const msgs: any[] = [];
const protocol = createProtocol(createEngineAdapter(bundle), (m: any) => msgs.push(m));
await protocol.handle({ type: "REPLAY", requestId: "ui21", match: canonicalMatch(), seed: 20261001 } as any);
const replay = (msgs.find((m) => m.type === "REPLAY_PREPARED") as any).replay;

const walk = (obj: any, n = 60) => { const p = Presenter.fromSerialized(obj); for (let i = 0; i < Math.min(n, replay.frames.length); i++) p.view(i); };
const throws = (fn: () => void): string | null => { try { fn(); return null; } catch (e) { return (e as Error).message; } };

sec("[1] ★★★ 复现：响应式代理进引擎 ⇒ 抛的正是用户看到的那一句");
{
  const m = throws(() => structuredClone(reactive({ a: 1, b: [1, 2] })));
  ok("★★★ structuredClone(响应式代理) 会抛（这是整个白屏的物理原因）", !!m && /could not be cloned/.test(m), String(m));
  const m2 = throws(() => walk(reactive(replay)));
  ok("★★★ 同一份 replay，被 reactive() 包过之后 Presenter 就走不动了（浏览器里就是这样传的）", !!m2 && /could not be cloned/.test(m2), String(m2));
}

sec("[2] ★★★ 修法：两层都脱代理 ⇒ 整场走得通");
{
  ok("★★★ markRaw(replay) ⇒ Presenter 走 60 帧不抛", throws(() => walk(markRaw(replay))) === null);
  ok("★★★ toRaw(reactive(replay)) ⇒ 同样不抛（引擎边界那一层）", throws(() => walk(toRaw(reactive(replay)))) === null);
  ok("★★ 原始对象本来就没问题（对照：说明问题只在代理，不在数据）", throws(() => walk(replay)) === null);
  ok("★★ 而且整场 489 帧都走得通（不是只过了前 60 帧）", throws(() => walk(toRaw(reactive(replay)), replay.frames.length)) === null, String(replay.frames.length));
}

sec("[3] ★★★ 接线守住：store 与组件各自把代理脱掉（哪一层被改回去都会变红）");
{
  const store = S("stores/simulation.ts");
  ok("★★★ store 对 replayFile 用 markRaw", /replayFile = markRaw\(/.test(store), (store.match(/replayFile = [^;]{0,40}/) ?? [""])[0]);
  ok("★★★ 对 replayData 也用 markRaw（事件/单位同样不该被代理）", /replayData = markRaw\(/.test(store));
  ok("★★★ 组件在**引擎边界**上再脱一次：Presenter.fromSerialized(toRaw(props.replay))",
    /Presenter\.fromSerialized\(toRaw\(props\.replay\)/.test(S("components/theater/BattleTheater.vue")));
  ok("★★ 反向：组件里**没有**把 toRaw 掉的那份又存回响应式（否则等于没修）",
    !/=\s*ref\(toRaw\(props\.replay\)\)/.test(S("components/theater/BattleTheater.vue")));
}

sec("[4] ★★ 报错出口仍在（这一次正是它把根因交出来的）");
{
  ok("★★ App.vue 的 onErrorCaptured + main.ts 的 errorHandler 都还在", /onErrorCaptured/.test(S("App.vue")) && /app\.config\.errorHandler/.test(S("main.ts")));
}

console.log("\nui21-reactive-replay: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
