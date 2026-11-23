// tests/g3-replay.ts — ★ G3 验收：Full Replay（a1-4.md §36/§38/§40/§41/§58）
//
// 文档给 G3 的完成标准是一句话：
//   先用 CLI：node replay.ts seed=12345 打出 Frame 000 … Frame 382 BATTLE_END，
//   并证明 Frame 382 state == Engine final state。然后 UI 才接。
//
// 本测试把这句话拆成可执行断言，外加两条不变量：
//   §36 Replay 不应该是 Engine 第二次执行（播放期间装配次数必须纹丝不动）
//   §40/§41 Replay determinism / headless 与 Theater 一致
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch, assembleCount } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { SnapshotRecorder } from "../kernel/snapshot.ts";
import { buildReplay, loadReplay, serializeReplay, ReplayPlayer } from "../kernel/replay.ts";
import type { ReplayFile } from "../kernel/replay.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);

const SEED = 123456;
const meta = {
  engineVersion: bundle.engineVersion, gameDataVersion: bundle.gameDataVersion,
  matchId: "canonical-001", seed: SEED, maxTurns: 300,
  policyIds: { startup: "NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI", priority: "REGISTRATION_ORDER", tieBreak: "SPEED_THEN_RANDOM", death: "DEATH_AFTER_PREVENTION", resource: "COMMUNITY_4_8_5_345", guessing: "COMMUNITY_2020_UNVERIFIED" },
  red: canonicalMatch().red.units.map(u => u.name), blue: canonicalMatch().blue.units.map(u => u.name),
};

/** 跑一局并录像 */
async function record(seed: number) {
  const kit = createKit(bundle);
  const a = assembleMatch(kit, canonicalMatch(), { seed });
  const rec = new SnapshotRecorder(64);
  (a.battle as any).traceLevel = "FULL";
  a.battle.recorder = rec;
  const result = await a.battle.run();
  const finalState = captureState(a.battle);
  const file = buildReplay(a.battle, rec, { ...meta, seed }, finalState, { winner: result.winner, turns: result.turns, reason: result.reason });
  return { file, finalState, result, rec };
}

const { file, finalState, result, rec } = await record(SEED);
const json = serializeReplay(file);
const reloaded = loadReplay(json);
const player = new ReplayPlayer(reloaded);

sec("[1] Replay 文件成形（§38）");
console.log(`    ${file.frames.length} 帧 / ${file.checkpoints.length} Checkpoint / ${file.deltas.length} Delta / ${file.events.length} 事件链节点 / ${(json.length / 1024).toFixed(1)} KB`);
ok("文件带 schemaVersion / 版本号 / seed / 策略快照（可复现的前提）", file.schemaVersion === 2 && file.deltaCodec === "PATH_V1" && (file.deltaPaths ?? []).length > 0 && !!file.engineVersion && file.match.seed === SEED && Object.keys(file.match.policyIds).length === 6);
ok("事件流非空且帧号自洽", file.frames.length > 50 && file.frames.every((f, i) => f.frame === i), String(file.frames.length));
ok("每帧都带 ev/depth（可归属事件）", file.frames.every(f => f.depth !== undefined && (f.ev === null || typeof f.ev === "number")));
ok("文件里有红蓝双方名单", file.match.red.length === 5 && file.match.blue.length === 5);
ok("JSON 往返后内容完全一致", serializeReplay(loadReplay(json)) === json);

sec("[2] ★ Frame N state == Engine final state（§58 的验收点）");
const rebuilt = player.stateAt(rec.lastFrame)!;
ok("终局帧状态可重建", !!rebuilt);
ok("★ 重建状态与引擎终局状态**逐字节一致**", JSON.stringify(rebuilt) === JSON.stringify(finalState), `${stateHash(rebuilt)} vs ${stateHash(finalState)}`);
ok("★ 文件自带的指纹与重建结果一致", file.finalHash === stateHash(rebuilt), `${file.finalHash} vs ${stateHash(rebuilt)}`);
ok("文件里的胜负/回合与引擎一致", file.result.winner === result.winner && file.result.turns === result.turns && file.result.reason === result.reason);
ok("中间任意帧也能重建（抽查 5 帧）", [0, 10, 50, 120, 200].every(f => !!player.stateAt(f)));
/**
 * ★★★ 第 191 轮：把「Frame N state == Engine state」从**终局那一帧**扩到**每一帧**。
 *   记录器现在每帧顺手存一个引擎状态指纹（SnapshotRecorder.hashes → 文件的 frameHashes），
 *   于是这句话可以逐帧验，而不是只验最后那一帧。
 *   ★ 在这一轮之前，`[2]` 标题写着验收点，实际只比了 rec.lastFrame 一帧 —— 报表比代码乐观。
 */
{
  ok("★★★ 记录器逐帧存了指纹（与 trace 帧数 + 1 个终局补记帧对齐）",
    rec.hashes.length === file.frames.length + 1 && rec.hashes[file.frames.length] === file.finalHash,
    JSON.stringify({ hashes: rec.hashes.length, frames: file.frames.length }));
  let mismatch = 0, firstBad = -1;
  for (let f = 0; f < file.frames.length; f++) {
    const st = player.stateAt(f);
    if (!st || stateHash(st) !== rec.hashes[f]) { mismatch++; if (firstBad < 0) firstBad = f; }
  }
  console.log("  逐帧比对：" + file.frames.length + " 帧｜不一致 " + mismatch + (firstBad >= 0 ? "（第一处 " + firstBad + "）" : ""));
  ok("★★★ **每一帧**都与引擎记录的状态一致（不一致 0 帧）", mismatch === 0, JSON.stringify({ mismatch, firstBad }));
  ok("★★★ 文件里的 frameHashes 与记录器一致（不是回放时另算的）",
    JSON.stringify(file.frameHashes) === JSON.stringify(rec.hashes));
}

sec("[3] ★ Replay 不是 Engine 第二次执行（§36）");
{
  const before = assembleCount;
  const p2 = new ReplayPlayer(loadReplay(json));
  for (const f of [0, 40, 90, 150, file.frames.length - 1]) p2.stateAt(f);
  const ancestry = p2.ancestryOfFrame(file.frames.length - 2);
  ok("★ 纯播放期间**一次装配都没有发生**", assembleCount === before, `${before} → ${assembleCount}`);
  ok("事件链回溯可用（Inspector 不需要引擎）", Array.isArray(ancestry));
}

sec("[4] 事件链在文件里也必须自洽（§28）");
{
  const bySeq = new Map(file.events.map(e => [e.seq, e]));
  ok("每个节点的 root 指向真实根", file.events.every(e => { const r = bySeq.get(e.root); return !!r && r.parent === null; }));
  ok("parent 指向真实存在的节点", file.events.every(e => e.parent === null || bySeq.has(e.parent)));
  ok("从最后一帧能回溯出一条完整链", player.ancestryOfFrame(file.frames.length - 2).length >= 1);
}

sec("[5] Replay determinism（§40）");
{
  const again = await record(SEED);
  ok("★ 同 seed 两次录制的帧流逐字节一致", JSON.stringify(again.file.frames) === JSON.stringify(file.frames));
  ok("★ 同 seed 两次录制的终局指纹一致", again.file.finalHash === file.finalHash);
  ok("★ 同 seed 两次录制的事件链一致", JSON.stringify(again.file.events) === JSON.stringify(file.events));
  const other = await record(SEED + 1);
  ok("换 seed 结果确实不同（否则上面的断言没有意义）", JSON.stringify(other.file.frames) !== JSON.stringify(file.frames));
}

sec("[6] Headless 与 Theater 一致（§41）");
{
  // headless：与 theater 同档跑（**都是 FULL** —— 本节比的就是「两条路径的事件流是否一致」）。
  // ★★★ 第 192 轮：这里此前写的是 SUMMARY，但当时的 SUMMARY 与 FULL 无法区分（只差快照），
  //   于是这条断言**看起来在比两条路**、实际上在比同一档。SUMMARY 做成统计档之后就露馅了。
  const headless = assembleMatch(createKit(bundle), canonicalMatch(), { seed: SEED });
  (headless.battle as any).traceLevel = "FULL";
  const hr = await headless.battle.run();
  ok("★ headless 与 Theater 的胜者/回合/原因一致", hr.winner === result.winner && hr.turns === result.turns && hr.reason === result.reason, JSON.stringify([hr, result]));
  ok("★ 两者的终局核心状态指纹一致", stateHash(captureState(headless.battle)) === file.finalHash, `${stateHash(captureState(headless.battle))} vs ${file.finalHash}`);
  // Theater 的帧流应当**包含** headless 的事件（多了归属信息，但事件本身一致）
  const headlessCodes = headless.battle.trace.map((e: any) => e.t + ":" + (e.applied ?? e.amount ?? ""));
  const theaterCodes = file.frames.map(f => f.t + ":" + (f.applied ?? f.amount ?? ""));
  ok("★ Theater 帧流与 headless 事件流内容一致（只多了归属字段）", JSON.stringify(headlessCodes) === JSON.stringify(theaterCodes));
}

sec("[7] 大样本下的体积与耗时（能不能真的存下来）");
{
  const t0 = Date.now();
  const many = await record(SEED + 7);
  const ms = Date.now() - t0;
  const size = serializeReplay(many.file).length;
  console.log(`    一局 ${many.file.frames.length} 帧 → ${(size / 1024).toFixed(1)} KB，录制耗时 ${ms}ms（${(size / Math.max(1, many.file.frames.length)).toFixed(0)} 字节/帧）`);
  ok("单帧平均开销 < 2KB（否则长局存不下）", size / many.file.frames.length < 2048, `${(size / many.file.frames.length).toFixed(0)} 字节/帧`);
  ok("录制开销 < 1 秒/局", ms < 1000, `${ms}ms`);
}

// 清理 CLI 留下的示例文件不算测试职责，这里只在文件存在时做一次往返校验
{
  /**
   * ★★★ 第 117 轮：**这条断言此前从不执行** —— 它守着一个"CLI 产出的 Replay 文件"，而当时**没有 CLI**，
   *   于是 `if (fs.existsSync(demo))` 永远是 false：一段看着像验收、实际什么都没检查的代码。
   *   现在 tools/replay-cli.ts 补上了，这条改成**无条件断言**，并且与本次测试自己录的那一局**交叉核对指纹**。
   */
  const demo = path.join(ROOT, "battle-lab", "fixtures", "replay-demo-123456.json");
  const cli = path.join(ROOT, "battle-lab", "tools", "replay-cli.ts");
  ok("★★★ CLI 入口存在（G3 的完成标准点名要 CLI）", fs.existsSync(cli));
  ok("★★★ CLI 产出的 Replay 文件在仓库里，且能被独立解析", fs.existsSync(demo) && loadReplay(fs.readFileSync(demo, "utf8")).frames.length > 0);
  const demoFile = loadReplay(fs.readFileSync(demo, "utf8"));
  ok("★★★ 交叉核对：CLI 录的那一局与本次测试录的**终局指纹一致**（同一 seed 同一条路径）",
    demoFile.finalHash === file.finalHash, demoFile.finalHash + " vs " + file.finalHash);
}

console.log(`\n=== G3: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
