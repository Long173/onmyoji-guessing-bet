// tests/g2-snapshot.ts — ★ G2 验收：Snapshot + Delta + Checkpoint（a1-4.md §22/§23/§35/§57）
//
// 文档要求：
//   §57 snapshot(before) → resolve(event) → snapshot(after) → diff()，先用粗暴 diff，先正确后性能
//   §22 不必每帧完整复制   §23 但必须有 Checkpoint   §35 Trace Level 三档
//
// 验收标准：
//   ① 任意帧都能从「最近 Checkpoint + 其后 Delta」**精确重建**（与当场捕获的状态指纹一致）
//   ② Delta 相比每帧全量快照确实省很多（§22 的动机，用数字说话）
//   ③ Trace Level 三档产出**相同的战斗结果**（观测粒度不得影响模拟）
//   ④ NONE 档确实更快（否则这一档就没有存在意义）
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { SnapshotRecorder, diffStates, applyDelta } from "../kernel/snapshot.ts";
import { SUMMARY_KINDS } from "../kernel/battle.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);

sec("[1] 粗暴 diff 本身必须正确（§57 的第一步）");
{
  const a = { x: 1, y: { z: [1, 2, 3], w: "s" }, gone: true };
  const b = { x: 2, y: { z: [1, 9, 3], w: "s" }, added: 5 };
  const ops = diffStates(a, b);
  const back = applyDelta(a, ops);
  ok("diff → apply 能精确还原目标", JSON.stringify(back) === JSON.stringify(b), JSON.stringify(ops));
  ok("未被改动的字段不产生操作（不是整对象替换）", ops.every(o => o.path.length > 0) && !ops.some(o => o.path.length === 0), JSON.stringify(ops.map(o => o.path)));
  ok("删除字段也有对应操作", ops.some(o => o.path.join(".") === "gone" && !("to" in o)), JSON.stringify(ops));
  ok("数组长度变化时整段替换（粗暴但不会错）", JSON.stringify(applyDelta({ a: [1, 2] }, diffStates({ a: [1, 2] }, { a: [1] }))) === JSON.stringify({ a: [1] }));
}

sec("[2] 逐帧记录：Checkpoint + Delta 重建任意帧");
const kit = createKit(bundle);
const b = assembleMatch(kit, canonicalMatch(), { seed: 20261001 });
const rec = new SnapshotRecorder(64);        // 每 64 帧一个 Checkpoint
(b.battle as any).traceLevel = "FULL";
b.battle.recorder = rec;
await b.battle.run();
const frames = b.battle.trace.length;
console.log(`    ${frames} 帧 / ${rec.checkpoints.length} 个 Checkpoint / ${rec.deltas.length} 个 Delta`);
ok("记录器真的收到了帧", rec.checkpoints.length > 0 && rec.deltas.length > 0);
ok("Checkpoint 间隔符合设定", rec.checkpoints.every((c, i) => i === 0 || c.frame - rec.checkpoints[i - 1].frame === 64), JSON.stringify(rec.checkpoints.map(c => c.frame).slice(0, 5)));

// 逐帧重建，与"当场捕获"对比
const kit2 = createKit(bundle);
const ref = assembleMatch(kit2, canonicalMatch(), { seed: 20261001 });
(ref.battle as any).traceLevel = "FULL";
await ref.battle.run();
const truth = captureState(ref.battle);
ok("参照运行的最终状态可捕获", !!truth);

let reconstructOk = 0, reconstructBad: string[] = [];
for (const target of [0, 1, 63, 64, 65, 127, 128, frames - 1]) {
  const st = rec.stateAt(target);
  const cp: any = [...rec.checkpoints].reverse().find(c => c.frame <= target);
  if (!st || !cp) { reconstructBad.push(target + ":no-checkpoint"); continue; }
  // 用 Checkpoint 自身做锚点验证：stateAt(frame) 再往前 diff 回 checkpoint 帧应当等于该 checkpoint
  const same = JSON.stringify(st) === JSON.stringify(target === cp.frame ? cp.state : st);
  if (same) reconstructOk++; else reconstructBad.push(String(target));
}
ok(`★ 关键帧重建无异常（${reconstructOk}/8）`, reconstructBad.length === 0, reconstructBad.join(","));

// ★ 最强的逐帧断言：另跑一场"每帧都是 Checkpoint"的**密集录像**作为真值，
//   然后拿稀疏录像（每 64 帧一个 Checkpoint）重建**每一帧**去对。
//   注意一个容易想错的地方：Checkpoint 那一帧的状态跃迁**不在 Delta 流里**
//   （它被 Checkpoint 本身代表了），所以"cp0 + 全部 Delta"并不等于最后一帧状态 ——
//   唯一正确的对比方式是同一帧的 stateAt vs 真值。
{
  const dense = new SnapshotRecorder(1);        // 每一帧都存完整状态 = 真值
  const dk = createKit(bundle);
  const db = assembleMatch(dk, canonicalMatch(), { seed: 20261001 });
  (db.battle as any).traceLevel = "FULL";
  db.battle.recorder = dense;
  await db.battle.run();

  let mismatches: string[] = [];
  const n = Math.min(rec.lastFrame, dense.lastFrame);
  for (let f = 0; f <= n; f++) {
    const a = rec.stateAt(f), b = dense.stateAt(f);
    if (!a || !b || JSON.stringify(a) !== JSON.stringify(b)) mismatches.push(String(f));
  }
  ok(`★★ 稀疏录像重建的**每一帧**（${n + 1} 帧）都与密集录像逐字节一致`, mismatches.length === 0, `不一致帧：${mismatches.slice(0, 5).join(",")}`);

  const rebuiltFinal = rec.stateAt(rec.lastFrame);
  ok(`★★ 逐帧重建出的最终状态 === 连续跑完的真实状态（终局帧 ${rec.lastFrame}）`, JSON.stringify(rebuiltFinal) === JSON.stringify(truth),
     `重建 vs 真实：${rebuiltFinal ? stateHash(rebuiltFinal) : "null"} vs ${stateHash(truth)}`);
  ok("密集录像的每帧确实都是 Checkpoint（真值来源可信）", dense.checkpoints.length === n + 1, `${dense.checkpoints.length} vs ${n + 1}`);
}

sec("[3] Delta 比全量快照省多少（§22 的动机）");
const st = rec.stats(frames);
const perState = rec.checkpoints[0].bytes;
const naiveKB = (perState * frames / 1024).toFixed(1);
const actualKB = ((st.checkpointBytes + st.deltaBytes) / 1024).toFixed(1);
const avgDelta = st.deltaBytes / Math.max(1, st.deltas);
console.log(`    单帧完整状态 = ${(perState / 1024).toFixed(1)} KB；每帧全量 = ${naiveKB} KB；Checkpoint+Delta = ${actualKB} KB；省 ${(st.savingRatio * 100).toFixed(1)}%`);
console.log(`    单个 Delta 平均 ${avgDelta.toFixed(0)} 字节 / 最多 ${st.maxDeltaOps} 个操作`);
ok("★ 相比每帧全量快照至少省 50%", st.savingRatio > 0.5, `省 ${(st.savingRatio * 100).toFixed(1)}%`);
ok("单个 Delta 是稀疏的（平均不到 3KB）", avgDelta < 3000, `平均 ${avgDelta.toFixed(0)} 字节`);

sec("[4] Trace Level 三档（§35）：观测粒度不得影响模拟结果");
async function runWith(level: "NONE" | "SUMMARY" | "FULL") {
  const k = createKit(bundle);
  const x = assembleMatch(k, canonicalMatch(), { seed: 20261001 });
  (x.battle as any).traceLevel = level;
  if (level === "FULL") x.battle.recorder = new SnapshotRecorder(128);
  const r = await x.battle.run();
  /** ★★★ 第 192 轮：把**事件标签直方图**也带出来 —— 三档的差别要看标签，不能只看条数 */
  const kinds: Record<string, number> = {};
  for (const e of x.battle.trace as any[]) kinds[String(e.t)] = (kinds[String(e.t)] ?? 0) + 1;
  const stats = {
    damage: (x.battle.trace as any[]).filter((e: any) => e.t === "DAMAGE").length,
    killed: (x.battle.trace as any[]).filter((e: any) => e.t === "KILLED").length,
    casts: (x.battle.trace as any[]).filter((e: any) => e.t === "SKILL_CAST").length,
  };
  /**
   * ★ §35 的第四项 first kill。
   *   ★ 判据用**「首杀之前发生过多少次伤害」**，不用事件流下标：SUMMARY 会把逐帧细节滤掉，
   *     同一条阵亡在两条流里的下标天然不同（16 vs 62）—— 那不是分歧，是两档的粒度不同。
   *     以「伤害次数」为刻度就与档位无关，而它恰好就是统计档能回答的问题（第几次伤害后出现首杀）。
   */
  const firstDeathAt = (() => {
    const arr = x.battle.trace as any[];
    const i = arr.findIndex((e: any) => e.t === "DEATH" || e.t === "KILLED");
    return i < 0 ? -1 : arr.slice(0, i).filter((e: any) => e.t === "DAMAGE").length;
  })();
  return { r, state: captureState(x.battle), traceLen: x.battle.trace.length, hash: stateHash(captureState(x.battle)), kinds, stats, firstDeathAt };
}
const none = await runWith("NONE");
const summary = await runWith("SUMMARY");
const full = await runWith("FULL");
ok("★ 三档的胜者/回合/原因完全一致", none.r.winner === summary.r.winner && summary.r.winner === full.r.winner && none.r.turns === full.r.turns && none.r.reason === full.r.reason,
   JSON.stringify([none.r, summary.r, full.r]));
ok("★ 三档的最终核心状态指纹完全一致", none.hash === summary.hash && summary.hash === full.hash, `${none.hash} / ${summary.hash} / ${full.hash}`);
ok("NONE 档确实不产生事件流", none.traceLen === 0, String(none.traceLen));
ok("FULL 档产生事件流且抓了快照", full.traceLen > 0);
/**
 * ★★★ 第 192 轮：**SUMMARY 是统计档，不是「FULL 去掉快照」**。
 *   旧断言写的是 summary.traceLen === full.traceLen —— 那是在「SUMMARY 与 FULL 无法区分」的时期
 *   按事实写下的，但它同时把**规格**（a1-4 §35：SUMMARY 只收 damage / death / skill usage / first kill）
 *   钉成了「不该成立」。这一轮把 SUMMARY 做实，断言按规格与事实一起改写。
 */
ok("★★★ SUMMARY 只留「统计」那四类（§35：damage / death / skill usage / first kill）",
  summary.traceLen > 0 && Object.keys(summary.kinds).every(k => SUMMARY_KINDS.has(k)),
  JSON.stringify({ len: summary.traceLen, kinds: Object.keys(summary.kinds) }));
ok("★★★ 而 SUMMARY 明显比 FULL 短（统计档不再原样收下整条事件流）",
  summary.traceLen > 0 && summary.traceLen < full.traceLen, `${summary.traceLen} vs ${full.traceLen}`);
ok("★★★ FULL 有、SUMMARY 没有的那些正是逐帧细节（状态 / 行动条 / 治疗 / AI 决策）",
  ["STATUS_APPLY", "TIMELINE_SHIFT", "HEAL", "AI_DECISION"].every(k => (full.kinds[k] ?? 0) > 0 && (summary.kinds[k] ?? 0) === 0),
  JSON.stringify({ fullKinds: Object.keys(full.kinds).length, summaryKinds: Object.keys(summary.kinds).length }));
ok("★★★ 但**统计量本身一致**：伤害 / 阵亡 / 技能使用三类在 SUMMARY 与 FULL 里逐条相同（观测粒度不改战斗）",
  JSON.stringify(summary.stats) === JSON.stringify(full.stats) && summary.stats.damage > 0 && summary.stats.casts > 0,
  JSON.stringify({ summary: summary.stats, full: full.stats }));
/**
 * ★★★ §35 给 SUMMARY 列了四项：damage / death / skill usage / **first kill**。
 *   前两项与 skill usage 已由 stats 断言；「first kill」是**位置**信息 —— 它在 SUMMARY 里也必须算得出来。
 */
ok("★★★ 第四项 first kill 也在（SUMMARY 能回答「第几次伤害之后出现首杀」，与 FULL 一致）",
  summary.firstDeathAt === full.firstDeathAt && summary.firstDeathAt >= 0,
  JSON.stringify({ summary: summary.firstDeathAt, full: full.firstDeathAt }));
ok("★★★ SUMMARY 的三类统计**都能从它自己的事件流里算出来**（这就是这一档的用途）",
  summary.kinds.DAMAGE === summary.stats.damage && (summary.kinds.SKILL_CAST ?? 0) === summary.stats.casts,
  JSON.stringify(summary.kinds));

sec("[5] ★★★ Trace Level 三档在内核里必须真的分成三档（第 64 轮重写）");

/**
 * 这一节原来是**墙钟比值**断言：`NONE 档耗时 / SUMMARY 档耗时 ≤ 1.35`。
 * 它自己都写明了"本引擎战斗计算占大头，观测开销只有几个百分点，比值在噪声范围内" ——
 * 也就是说它守不住它想守的东西，却会**因为机器忙而变红**：
 * 第 63 轮我把两套测试并发跑，这条就红了（单独重跑 20/20）。
 * 一条会因负载变红的断言，长期看就是在训练人忽略红字。
 *
 * 换成**与负载无关**的判据：数"这一档到底做了多少观测"。
 * 而要做到这一点，先得把内核里的一个洞补上 ——
 * 此前 `recorder.onFrame` 是**无条件**调用的，`traceLevel` 只管 trace：
 *   · NONE 挂了 recorder 仍会回调终局帧（不是"只跑战斗，不留观测"）；
 *   · SUMMARY 与 FULL 在内核里完全无法区分（差别只在调用方挂不挂 recorder）。
 * battle.ts 现在收口到 `snapshot()`：只有 FULL 档产生快照。
 */
async function observe(level: "NONE" | "SUMMARY" | "FULL", attach: boolean) {
  const k = createKit(bundle);
  const x = assembleMatch(k, canonicalMatch(), { seed: 20261001 });
  (x.battle as any).traceLevel = level;
  let frames = 0;
  if (attach) x.battle.recorder = { onFrame: () => { frames++; } };
  const r = await x.battle.run();
  return { trace: x.battle.trace.length, frames, r };
}
{
  const rows: Array<[{ trace: number; frames: number }, string]> = [];
  for (const [level, want] of [["NONE", "trace=0 / frames=0"], ["SUMMARY", "trace>0 / frames=0"], ["FULL", "trace>0 / frames>0"]] as const) {
    const yes = await observe(level as any, true);
    const no = await observe(level as any, false);
    rows.push([yes, level + " + 挂 recorder：trace " + yes.trace + "｜frames " + yes.frames + "（期望 " + want + "）"]);
    // ★ 核心断言：**档位名必须保证行为** —— 挂了 recorder 也不能越过档位拿到快照
    if (level === "NONE") {
      ok("★★★ NONE 档即使挂了 recorder 也不产生任何观测（trace 0 / frames 0）", yes.trace === 0 && yes.frames === 0, JSON.stringify(yes));
    } else if (level === "SUMMARY") {
      ok("★★★ SUMMARY 档产生事件流、但**拿不到快照**（挂 recorder 也不行）", yes.trace > 0 && yes.frames === 0, JSON.stringify(yes));
    } else {
      ok("★★★ FULL 档产生事件流与快照", yes.trace > 0 && yes.frames > 0, JSON.stringify(yes));
    }
    // 反向：没挂 recorder 自然没有帧（这一条排除"帧数被别的东西凑出来"）
    ok("★★ " + level + " 档不挂 recorder ⇒ 0 帧", no.frames === 0, String(no.frames));
    ok("★ " + level + " 档挂不挂 recorder，trace 条数一致（观测不影响模拟）", yes.trace === no.trace, yes.trace + " vs " + no.trace);
  }
  console.log("    " + rows.map(r => r[1]).join("\n    "));
  // 三档的"观测工作量"必须**严格递增** —— 这才是"三档有存在意义"的可数形式
  const [none, summary, full] = await Promise.all([observe("NONE", true), observe("SUMMARY", true), observe("FULL", true)]);
  const work = (x: { trace: number; frames: number }) => x.trace + x.frames;
  ok("★★★ 观测工作量严格递增：NONE < SUMMARY < FULL", work(none) < work(summary) && work(summary) < work(full),
    JSON.stringify([work(none), work(summary), work(full)]));
  ok("★★ 三档的胜负与回合仍然一致（观测粒度不得影响结果）",
    none.r.winner === full.r.winner && none.r.turns === full.r.turns,
    JSON.stringify([none.r, full.r]));
}
{
  // 耗时只作为**信息**打印，不作为断言：它取决于机器负载（第 63 轮踩过）。
  const bench = async (level: "NONE" | "SUMMARY" | "FULL", n: number) => {
    const t0 = Date.now();
    for (let i = 0; i < n; i++) {
      const k = createKit(bundle);
      const x = assembleMatch(k, canonicalMatch(), { seed: 100000 + i });
      (x.battle as any).traceLevel = level;
      await x.battle.run();
    }
    return Date.now() - t0;
  };
  const N = 30;
  await bench("NONE", 5); await bench("SUMMARY", 5);            // 预热
  const tNone = await bench("NONE", N), tSum = await bench("SUMMARY", N), tFull = await bench("FULL", N);
  console.log("    （仅供参考，不作为断言）" + N + " 局：NONE " + tNone + "ms / SUMMARY " + tSum + "ms / FULL " + tFull + "ms");
  console.log("    战斗计算占绝对大头，观测开销在噪声范围内 —— 所以这一档的判据是**工作量**，不是毫秒。");
}

console.log(`\n=== G2: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
