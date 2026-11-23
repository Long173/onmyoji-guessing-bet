// tests/ui7-guardrails.ts — ★ 十条 UX 护栏的逐条证据（M1.8 目标 ④）
// 每条护栏都必须有一条**可执行的断言**，而不是文档里的一句"已实现"。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const S = (p: string) => readFileSync(join(here, "..", "src", p), "utf8");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);

// 内存版 localStorage（Node 里没有），必须在创建 store 之前装好 —— 护栏 #10 要用
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};

const bundle = JSON.parse(readFileSync(join(here, "..", "src", "engine", "bundle.json"), "utf8"));
const { createEngineAdapter } = await import("../src/adapters/engine-adapter.ts");
const { canonicalMatch } = await import("../src/mock/canonical-match.ts");
const { swapSides } = await import("../src/contracts/guessing-match.ts");
const { createPinia, setActivePinia } = await import("pinia");
const { useMatchStore } = await import("../src/stores/match.ts");
const adapter = createEngineAdapter(bundle);

console.log("══ M1.8 十条 UX 护栏逐条验收 ══");

sec("护栏 #1 · 红蓝互换必须对称（换边不该凭空改变强弱）");
const N = 1000;   // 敏感性扫描的门槛是 800 局，低于它 modelUncertainty 会是 null
const a = await adapter.simulate(canonicalMatch(), { simulations: N, seed: 777, progressEvery: N }, () => {}, () => false);
const swapped = swapSides(canonicalMatch());
const b = await adapter.simulate(swapped, { simulations: N, seed: 777, progressEvery: N }, () => {}, () => false);
const pa = a.redWinRate!, pb = b.redWinRate!;
console.log(`      原局红方胜率 ${(pa * 100).toFixed(1)}%  ·  换边后(原蓝方为红) ${(pb * 100).toFixed(1)}%`);
// ★★★ 第 84 轮：容差从 **8 个百分点收紧到 4**（第 83 轮 §12 记下的那条待办）。
//   收紧前先**量了分布**，不是估：20 组（N ∈ {200,500,1000,2000} × 5 个 seed）实测
//     均值 0.948pp｜标准差 0.708pp｜**最大 3.00pp**（出现在 N=200）
//   本测试用 N=1000，同一 N 下的实测范围是 0.40 ~ 1.40pp。
//   ⇒ 4pp = 全局最大值的 1.33 倍、N=1000 最大值的 2.9 倍 —— 既不会闪，又把灵敏度翻了一倍
//     （旧的 8pp 是全局最大值的 2.67 倍，等于只挡得住 ≥8pp 的偏置）。
//   ★ 为什么容差不是 0：这条量的是**聚合**性质，任何合法的机制改动都会让它移动几个十分之一 pp；
//     容差要吸收的是"合法改动的正常抖动"，不是"运行噪声"（同 seed 同 N 的结果是确定的）。
ok("★ 换边后红方胜率 ≈ 原局蓝方胜率（差 < 4 个百分点）", Math.abs(pb - (1 - pa)) < 0.04, `差 ${((pb - (1 - pa)) * 100).toFixed(2)} 个百分点`);
ok("换边后仍无异常局", b.errors === 0);
ok("互换是 DTO 级一等操作（swapSides 不共享引用）", (() => { const m = canonicalMatch(); const s = swapSides(m); s.red.units[0].name = "X"; return s.blue.units[0].name !== "X" && m.red.units[0].name !== "X"; })());

sec("护栏 #2 · UNKNOWN 永不隐藏");
const app = S("App.vue");
ok("顶栏常驻 UNKNOWN 徽标", /UNKNOWN/.test(app) && /badge/.test(app));
ok("★ 未接引擎时显示「UNKNOWN 未评估」而不是 0", /UNKNOWN not evaluated/.test(app));
ok("校验报告里的 UNKNOWN 计数被真实使用", /strategySnapshot\.unknownCount/.test(app));
ok("结果页把 5 个红区的 id 与 status 全列出来", (() => {
  const s = S("components/result/ResultDashboard.vue");
  return ["startup", "triggerPriority", "death", "endgame", "resource"].every(k => new RegExp("s\\." + k).test(s))
    && ["Start-of-battle order", "Simultaneous trigger priority", "Death / transform", "Betting endgame", "Onibi start & regen"].every(x => s.includes(x));
})());
ok("★ 红色的 UNKNOWN 必须能点开看到「为什么」", (() => {
  const s = S("components/result/ResultDashboard.vue");
  return /zoneNotes/.test(s) && /why this status/.test(s) && /don't invent a reason/.test(s);
})());
ok("★ 「未评估」不得画成红色（红只留给真问题）", /mark\.idle/.test(S("components/simulation/HealthCheck.vue")) && /Not validated yet/.test(S("components/simulation/HealthCheck.vue")));

sec("护栏 #3 · 竞猜禁止六件御魂编辑器");
const gm = await import("../src/contracts/guessing-match.ts");
ok("★ GuessingUnitInput 结构里没有 soulPieces", !("soulPieces" in gm.emptyUnit()));
ok("STAT_KEYS 恰好 8 维（六件御魂才会有的那些维度不存在）", gm.STAT_KEYS.length === 8);
ok("UI 组件源码里搜不到 soulPieces 编辑入口", !/soulPieces/.test(S("components/lineup/UnitTile.vue")));

sec("护栏 #4 · 御魂静态属性禁止重复应用");
const { createKit, assembleMatch } = await import("../src/engine/assemble.ts");
const kit = createKit(bundle);
const noSoul = assembleMatch(kit, canonicalMatch(), { seed: 1 });
const withSoulMatch = canonicalMatch(); withSoulMatch.red.units[0].soulId = 3;   // 网切
const withSoul = assembleMatch(kit, withSoulMatch, { seed: 1 });
ok("★ 换御魂后八维面板逐项不变", JSON.stringify(noSoul.red.map((x: any) => x.resolution.exact)) === JSON.stringify(withSoul.red.map((x: any) => x.resolution.exact)));
ok("★ soulStaticApplied 恒为 false", withSoul.red.every((x: any) => x.resolution.soulStaticApplied === false));
ok("但 4 件套战斗效果确实被加载", withSoul.red[0].resolution.soulBattleEffects.length === 1);
ok("UI 明写「静态面板不重复计算」", /static stats not double-counted|static stats are not counted/.test(S("components/lineup/SoulSelector.vue") + S("components/knowledge/CodexView.vue")));

sec("护栏 #5 · Unsupported 必须在开跑前显示");
const vm = canonicalMatch(); vm.red.units[0].soulId = 0;   // 雪幽魂（PARTIAL）
const vres = await adapter.validate(vm);
ok("★ 校验阶段就报出御魂实现度不足", vres.warnings.some(w => w.kind === "SOUL_EFFECT_UNSUPPORTED"), JSON.stringify(vres.warnings.map(w => w.kind)));
ok("御魂索引带三态 support 供 UI 着色", (() => { const idx = JSON.parse(readFileSync(join(here, "..", "src", "kb", "soul-index.json"), "utf8")); return idx.every((x: any) => ["FULL", "PARTIAL", "UNSUPPORTED"].includes(x.engine.support)); })());
ok("HealthCheck 在跑之前就渲染覆盖度", /soulEffectsPartial/.test(S("components/simulation/HealthCheck.vue")));

sec("护栏 #6 · 版本号随结果一起保存");
ok("结果带引擎版本与游戏数据版本", !!a.engineVersion && !!a.gameDataVersion, a.engineVersion + " / " + a.gameDataVersion);
ok("结果带创建时间与 matchId（可追溯）", !!a.createdAt && a.matchId === "canonical-001");
ok("UI 把版本显示在结果头部", /engineVersion/.test(S("components/result/ResultDashboard.vue")));

sec("护栏 #7 · Seed 可复制、可 replay");
const seed = a.seeds![0].seed;
const rp = await adapter.replay(canonicalMatch(), seed);
ok("★ 同 seed 回放的胜负与回合数与模拟记录一致", rp.winner === a.seeds![0].winner && rp.turns === a.seeds![0].turns, `${rp.winner}/${rp.turns} vs ${a.seeds![0].winner}/${a.seeds![0].turns}`);
ok("回放器提供「复制 seed」", /Copy seed/.test(S("components/result/ReplayViewer.vue")));
ok("结果页可从代表 seed 直接进入回放/观看", (() => {
  const dash = S("components/result/ResultDashboard.vue");
  const app = S("App.vue");
  // G4 起主入口是「观看战斗」（Theater），事件级回放仍保留；两者都必须从样本对局一键可达
  return /emit\('watch'/.test(dash) && /BattleTheater/.test(app) && /ReplayViewer/.test(app);
})());

sec("护栏 #8 · 错误局永不进分母");
ok("★ decisive 严格等于红胜 + 蓝胜", a.decisive === a.redWins + a.blueWins);
ok("★ 全部局数可以配平（红+蓝+平+超时=总局数）", a.redWins + a.blueWins + a.draws + a.timeouts === a.simulations);
ok("胜率分母用的是 decisive 而不是 simulations", Math.abs(a.redWinRate! - a.redWins / a.decisive) < 1e-12);
ok("有异常局时会给出 BLOCK/WARN 级警告", /errors/.test(S("../src/adapters/engine-adapter.ts")) && /DATA_MISSING/.test(S("../src/adapters/engine-adapter.ts")));

sec("护栏 #9 · sampling uncertainty 与 model uncertainty 分开");
ok("★ 抽样误差：Wilson 区间独立成字段", a.confidenceInterval!.method === "WILSON" && a.confidenceInterval!.level === 0.95);
ok("★ 模型不确定性：策略敏感性独立成字段", !!a.modelUncertainty && a.modelUncertainty.perStrategy.length >= 4);
ok("两者在界面上是两个分开的区块", /Sampling error \(shrinks with more simulations\)/.test(S("components/result/ResultDashboard.vue")) && /Model uncertainty \(does not shrink with more simulations\)/.test(S("components/result/ResultDashboard.vue")));
ok("★ 敏感时给出 BLOCK 级警告（不许淡化）", a.modelUncertainty!.verdict !== "SENSITIVE" || a.warnings.some(w => w.severity === "BLOCK"));

sec("护栏 #10 · 输入草稿自动保存");
setActivePinia(createPinia());
const store = useMatchStore();
store.replace(canonicalMatch());
ok("★ 改动后写入 localStorage", mem.has("yys.workbench.match.draft.v1"));
ok("★ 草稿内容是可恢复的合法 DTO", (() => { const d = JSON.parse(mem.get("yys.workbench.match.draft.v1")!); return d.schemaVersion === 1 && d.red.units.length === 5; })());
ok("savedAt 被记录", typeof store.savedAt === "string");
ok("配额异常不阻塞（store 内 try/catch 静默）", /catch \{ \/\* 配额满时静默/.test(S("stores/match.ts")));

console.log(`\n══════════════════════════════════`);
console.log(`护栏验收：${pass} 通过 / ${fail} 失败`);
console.log(`══════════════════════════════════`);
if (fail > 0) process.exit(1);
