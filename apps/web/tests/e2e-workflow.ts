// tests/e2e-workflow.ts — M1.8 §30 端到端验收（无需终端操作、无需手改 JSON）
// 走的是 UI 完全相同的链路：matchStore（Pinia）→ Worker 协议 → 引擎适配器 → 结果契约 → 回放。
// 与浏览器里点击的唯一差别是线程边界（Worker 换成了直接函数调用），协议逻辑是同一份代码。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { createProtocol } from "../src/workers/protocol.ts";
import { createEngineAdapter } from "../src/adapters/engine-adapter.ts";
import { canonicalMatch } from "../src/mock/canonical-match.ts";
import { isConclusionReady } from "../src/contracts/simulation-result.ts";
import { useMatchStore } from "../src/stores/match.ts";
import type { WorkerRequest, WorkerResponse } from "../src/contracts/worker-api.ts";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  — " + extra : "")); } };
const sec = (s: string) => console.log("\n" + s);

const bundle = JSON.parse(readFileSync(join(here, "..", "src", "engine", "bundle.json"), "utf8"));
const outbox: WorkerResponse[] = [];
const protocol = createProtocol(createEngineAdapter(bundle), (m) => outbox.push(m));
const send = (req: WorkerRequest) => protocol.handle(req);
const last = <T,>(type: string) => [...outbox].reverse().find(m => m.type === type) as T | undefined;
const N = Number(process.env.E2E_N ?? 10000);

setActivePinia(createPinia());
const match = useMatchStore();

console.log(`══ M1.8 §30 端到端验收（N=${N}） ══`);

sec("步骤 1/8 · 输入：把对局录进工作台（这里等价于『照着截图逐格填』的结果）");
match.replace(canonicalMatch());
ok("红蓝各 5 只，共 10 只", match.filledCount === 10, String(match.filledCount));
ok("★ 输入结构里没有御魂位置（护栏 #3）", JSON.stringify(match.match).includes("soulPieces") === false);
ok("草稿自动落盘（护栏 #10，无 localStorage 时静默）", match.savedAt === null || typeof match.savedAt === "string");

sec("步骤 2/8 · 校验（VALIDATE）");
const t0 = Date.now();
await send({ type: "VALIDATE", requestId: "v1", match: match.match });
const val = last<any>("VALIDATION_READY")!.report;
ok("校验返回且无阻断", val.ok, val.blockers.join("; "));
ok("10 只式神全部 Join 到知识库", val.coverage.unitsJoined === 10);

sec("步骤 3/8 · 覆盖度与 UNKNOWN（跑之前必须看到）");
ok("技能 10/10 可用", val.coverage.skillsAvailable === 10);
ok("AI 高置信度 10/10", val.coverage.aiHigh === 10, `${val.coverage.aiHigh}/${val.coverage.aiTotal}`);
ok("★ UNKNOWN 机制数量被显式给出（不是 0 也不是隐藏）", val.strategySnapshot.unknownCount >= 1, String(val.strategySnapshot.unknownCount));
ok("★ 结论可用性判定给出理由", (() => { const r = isConclusionReady({ strategySnapshot: val.strategySnapshot, decisive: 10000, timeouts: 0, errors: 0, simulations: 10000 } as any); return !r.ready && r.reasons.length > 0; })());
ok("数据/模型缺口逐条列出", val.warnings.length >= 2, String(val.warnings.length));

sec(`步骤 4/8 · 模拟 ${N.toLocaleString()} 局（进度不阻塞、可取消）`);
let progressCount = 0;
const tSim = Date.now();
await send({ type: "SIMULATE", requestId: "s1", match: match.match, options: { simulations: N, seed: 20261001, progressEvery: Math.max(100, N / 20) } });
const simMs = Date.now() - tSim;
progressCount = outbox.filter(m => m.type === "SIMULATION_PROGRESS").length;
const res = last<any>("SIMULATION_COMPLETED")!.result;
ok("模拟完成且无异常", res.errors === 0, `errors=${res.errors}`);
ok(`进度回调 ≥ 5 次（${progressCount} 次）`, progressCount >= 5);
ok(`${N} 局在 ${(simMs / 1000).toFixed(1)}s 内完成`, simMs < 600000);

sec("步骤 5/8 · 胜率 + Wilson 置信区间");
ok("红蓝胜率都在 [0,1]", res.redWinRate > 0 && res.redWinRate < 1 && Math.abs(res.redWinRate + res.blueWinRate - 1) < 1e-9);
ok("★ Wilson 区间覆盖点估计", res.confidenceInterval.low < res.redWinRate && res.redWinRate < res.confidenceInterval.high);
ok("★ 分母口径：红+蓝 = decisive，超时/异常永不进入", res.redWins + res.blueWins === res.decisive && res.simulations === res.decisive + res.timeouts + res.draws);
ok("结果自带引擎版本与数据版本（可追溯）", !!res.engineVersion && !!res.gameDataVersion);
console.log(`      红方 ${(res.redWinRate * 100).toFixed(2)}%  Wilson95% [${(res.confidenceInterval.low * 100).toFixed(2)}%, ${(res.confidenceInterval.high * 100).toFixed(2)}%]  |  平均 ${res.battleStats.avgTurns} 回合`);

sec("步骤 6/8 · 策略敏感性（模型不确定性 ≠ 抽样误差）");
ok("敏感性扫描已执行", !!res.modelUncertainty, "N 不足 800 时会跳过");
ok("覆盖开局 / 死亡 / 回合上限三类假设", new Set(res.modelUncertainty.perStrategy.map((p: any) => p.group)).size >= 3);
ok("★ 漂移被量化，且与置信区间分开呈现", typeof res.modelUncertainty.spread === "number" && res.modelUncertainty.spread >= 0);
ok("★ 敏感时必须给出 BLOCK 级警告（不许淡化）", res.modelUncertainty.verdict !== "SENSITIVE" || res.warnings.some((w: any) => w.severity === "BLOCK"));

sec("步骤 7/8 · 选一个 seed 回放");
const seed = res.seeds?.[0]?.seed;
ok("结果给出了代表性 seed", typeof seed === "number", JSON.stringify(res.seeds));
await send({ type: "REPLAY", requestId: "r1", match: match.match, seed });
const rep = last<any>("REPLAY_PREPARED")!;
ok("回放事件流非空", rep.events.length > 10, `events=${rep.events.length}`);
ok("★ 回放的胜负与模拟里该 seed 的记录一致", rep.winner === res.seeds[0].winner, `replay=${rep.winner} seed-record=${res.seeds[0].winner}`);
ok("★ 回合数一致", rep.turns === res.seeds[0].turns, `replay=${rep.turns} seed-record=${res.seeds[0].turns}`);

sec("步骤 8/8 · 逐步回放所需的数据齐备（UI-4 的输入）");
ok("每个事件都有回合号（可分组步进）", rep.events.every((e: any) => typeof e.turn === "number"));
ok("事件带中文文案与结构化 detail", rep.events.every((e: any) => e.text && e.detail !== undefined));
ok("单位表含 maxHp（血条可还原）", rep.units.length === 10 && rep.units.every((u: any) => u.maxHp > 0));
ok("存在 DEATH/LETHAL 事件（战斗真的打完了）", rep.events.some((e: any) => ["DEATH", "LETHAL"].includes(e.code)));

sec("附加 · 取消与错误路径");
// 取消必须发生在**运行中**：先不 await 地发起，让出事件循环后再取消
const beforeCancel = outbox.filter(m => m.type === "SIMULATION_FAILED").length;
const pending = send({ type: "SIMULATE", requestId: "s2", match: match.match, options: { simulations: 200000, seed: 5, progressEvery: 500 } });
await new Promise(r => setTimeout(r, 250));
await send({ type: "CANCEL", requestId: "s2" });
await pending;
const afterCancel = outbox.filter(m => m.type === "SIMULATION_FAILED").length;
ok("★ 运行中取消 → 收到 SIMULATION_FAILED（而不是假装成功）", afterCancel > beforeCancel, `${beforeCancel} → ${afterCancel}`);
ok("取消的请求没有发出 SIMULATION_COMPLETED", !outbox.some(m => m.type === "SIMULATION_COMPLETED" && m.requestId === "s2"));

sec("附加 · 非法输入必须被挡住");
const broken = canonicalMatch();
broken.blue.units[4].stats.hp = 0;
await send({ type: "VALIDATE", requestId: "v2", match: broken });
const v2 = last<any>("VALIDATION_READY")!.report;
ok("面板未填 → 阻断并指明是哪一只", !v2.ok && v2.blockers.some((b: string) => /Blue slot 5/.test(b)), v2.blockers.join("; "));

console.log(`\n══════════════════════════════════`);
console.log(`§30 端到端：${pass} 通过 / ${fail} 失败   总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`══════════════════════════════════`);
if (fail > 0) process.exit(1);
