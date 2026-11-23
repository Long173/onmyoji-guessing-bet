// tests/g73-replay-cli.ts — ★★★ 第 117 轮：**G3 的 CLI 逐帧回放**（a1-4.md §36/§38/§58，目标 ⑤）
//
// 由来：库层（Checkpoint+Delta / buildReplay / ReplayPlayer）第 40 轮就齐了，但**没有 CLI 入口**，
// 于是 g3-replay.ts 里那条「CLI 产出的 Replay 文件能被独立解析」一直是一条**从不执行**的条件断言。
// 这一轮补上 tools/replay-cli.ts，并把这条路径两侧都钉住：
//   ① run → 文件真的写出来、能被独立解析、摘要与重建结果一致；
//   ② verify → 全部帧可重建；★ **改坏一个 delta，verify 必须变红**（否则闸门就是空转的）。
import fs from "node:fs";
import path from "node:path";
import { runReplayCli, verifyReplayFile, playFrame, recordReplay } from "../tools/replay-cli.ts";
import { loadReplay, serializeReplay } from "../kernel/replay.ts";
import { stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SEED = 123456;
const OUT = path.join(ROOT, "battle-lab", "fixtures", "replay-demo-" + SEED + ".json");

sec("[1] `run`：把一局录成 Replay 文件")
const summary = await runReplayCli({ seed: SEED });
{
  ok("★★★ 文件写到 g3 期待的那个路径（此前它是一段从不执行的断言）", fs.existsSync(OUT) && summary.out === OUT, summary.out);
  ok("★★★ 帧/Checkpoint/Delta/事件链都非空，且帧数合理",
    summary.frames > 50 && summary.checkpoints > 0 && summary.deltas > 0 && summary.events > 50,
    JSON.stringify({ frames: summary.frames, cp: summary.checkpoints, d: summary.deltas, ev: summary.events }));
  const file = loadReplay(fs.readFileSync(OUT, "utf8"));
  ok("★★★ 文件能被**独立解析**（不碰引擎），且 JSON 往返逐字节一致",
    serializeReplay(loadReplay(serializeReplay(file))) === serializeReplay(file));
  ok("★★★ 文件自带指纹与终局状态一致", file.finalHash === summary.finalHash && !!file.finalHash, file.finalHash);
  ok("★★ 单帧平均开销 < 2KB（长局要存得下）", summary.bytes / summary.frames < 2048, (summary.bytes / summary.frames).toFixed(0) + " 字节/帧");
}

sec("[2] `verify`：全部帧可重建 —— 而且**改坏就红**（两侧）")
{
  const v = verifyReplayFile(OUT);
  ok("★★★ 正式文件校验通过（每个 Checkpoint 自证 + 终局帧 == finalHash）", v.ok, JSON.stringify(v.issues));
  /**
   * ★★★ 第 191 轮：**逐帧比对**（此前 verify 只比对**终局那一帧**，中间几百帧没有地面真值）。
   *   记录器现在每帧顺手存一个引擎状态指纹（kernel/snapshot.ts 的 hashes → 文件的 frameHashes），
   *   verify 于是能把「逐帧回放」验到**每一帧**：Frame N state == 引擎在第 N 帧的状态。
   */
  const file0 = loadReplay(fs.readFileSync(OUT, "utf8"));
  ok("★★★ 文件带 frameHashes（与 frames 同下标；多出来的那一个是终局补记帧）",
    Array.isArray(file0.frameHashes) && file0.frameHashes.length === file0.frames.length + 1,
    JSON.stringify({ hashes: file0.frameHashes?.length ?? null, frames: file0.frames.length }));
  ok("★★★ 逐帧比对**真的跑了每一帧**（不是抽查 4 帧）", v.frameCompare === file0.frames.length && v.frameCompare > 500, String(v.frameCompare));
  /** ★ 第 244 轮按事实改写：补上规格 §60 的两端（BATTLE_START / BATTLE_END）之后是 **599** 帧 */
  ok("★★★ **每一帧**都与引擎记录的状态一致（不一致 0 帧；第 244 轮起 599 帧）", v.frameMismatch === 0 && v.firstMismatch === -1, JSON.stringify({ m: v.frameMismatch, first: v.firstMismatch, frames: v.frames ?? null }));
  ok("★★★ 补记的终局帧指纹 == finalHash", v.tailHashOk === true, String(v.tailHashOk));
  ok("★★★ Checkpoint×Delta 交叉校验也真的跑了（v2 文件不再跳过）", v.cpCrossSkipped === false && v.cpCross === file0.checkpoints.length - 1, JSON.stringify({ cp: v.cpCross, skipped: v.cpCrossSkipped }));
  /** ★ 反向：把第 3 个 delta 的第一个 op 的目标值改掉 ⇒ 重建状态必然偏离 */
  const file = loadReplay(fs.readFileSync(OUT, "utf8"));
  const bad = JSON.parse(JSON.stringify(file));
  /** ★ 两处都改：① 文件自带指纹；② 一条**核心路径**（teams/timeline/turn）上的 delta 操作 */
  bad.finalHash = "deadbeefdeadbeef";
  /** ★ §103：op 可能是 PATH_V1 元组（[路径下标, 种类, 值, 旧值]），取路径要走字典 */
  const pathOf = (o: any): any[] => (bad.deltaCodec === "PATH_V1" ? (bad.deltaPaths?.[o[0]] ?? []) : (o.path ?? []));
  const isCore = (o: any) => /^(teams|turn|timeline|winner)/.test(String(pathOf(o)[0]));
  const core = bad.deltas.find((x: any) => x.ops.some(isCore));
  const op: any = core ? core.ops.find(isCore) : null;
  if (op) {
    if (bad.deltaCodec === "PATH_V1") op[2] = (typeof op[2] === "number" ? op[2] + 12345 : "TAMPERED");
    else op.to = (typeof op.to === "number" ? op.to + 12345 : "TAMPERED");
  }
  /** 反向闸门必须**确实改到了 delta**：只改 finalHash 的话这条断言就是空转 */
  ok("★★ 反向闸门改到的是 delta 核心路径，不只是指纹", !!op, JSON.stringify(pathOf(op)));
  const tampered = path.join(ROOT, "battle-lab", "fixtures", "replay-tampered-tmp.json");
  fs.writeFileSync(tampered, serializeReplay(bad));
  const vb = verifyReplayFile(tampered);
  ok("★★★ 反向：改坏一个 delta ⇒ verify **变红**（证明这条闸门不是空转）", vb.ok === false && vb.issues.length > 0, JSON.stringify(vb.issues));
  /**
   * ★★★ 第 191 轮：反向还要**指名道姓** —— 逐帧比对必须报出**第一处**不一致的帧号，
   *   而且那个帧号应当正好是被改坏的那条 delta 的帧（下一个 Checkpoint 会把它盖回去）。
   *   「只报红不说在哪」的闸门在长局里等于没有。
   */
  ok("★★★ 反向：逐帧比对报出**第一处**不一致的帧号，且正好是被改坏的那条 delta 的帧",
    vb.firstMismatch === core.frame && vb.frameMismatch > 0,
    JSON.stringify({ first: vb.firstMismatch, tamperedFrame: core.frame, count: vb.frameMismatch, issues: vb.issues }));
  fs.unlinkSync(tampered);
}

sec("[3] `play --frame N`：不碰引擎地打印第 N 帧与那一刻的战场")
{
  const file = loadReplay(fs.readFileSync(OUT, "utf8"));
  const last = file.frames.length - 1;
  const row = playFrame(OUT, last);
  ok("★★★ 末帧能打印出来，且带 10 个单位的血量", !!row && row.units.length === 10, JSON.stringify(row && { frame: row.frame, t: row.t, units: row.units.length }));
  ok("★★★ 第 N 帧重建出的状态哈希 == 文件终局指纹（Frame N state == Engine final state 的那条断言，在 CLI 路径上也成立）",
    row?.stateHash === file.finalHash, (row?.stateHash ?? "-") + " vs " + file.finalHash);
  /**
   * ★★★ 第 244 轮按事实改写：末帧现在是 **BATTLE_END**（规格 §60 的收尾）——
   *   它是**战斗级**事件、不属于任何父事件 ⇒ ancestry 合理地为 0。
   *   原来这条断言直接在末帧上要 ancestry > 0，那是因为旧的末帧是 VICTORY_CHECK（挂在事件里）。
   *   判据拆成两条：① 往前找最后一个**带父链**的帧，它必须能回溯（Inspector 不需要引擎）；
   *   ② 末帧的 0 父链是**预期**，并且它确实是 BATTLE_END（不许因为改了断言就把收尾弄丢）。
   */
  let withChain = last;
  while (withChain > 0 && ((playFrame(OUT, withChain)?.ancestry ?? 0) === 0)) withChain--;
  const chainRow = playFrame(OUT, withChain);
  ok("★★ 事件链回溯可用（Inspector 不需要引擎；取最后一个带父链的帧 #" + withChain + "）", (chainRow?.ancestry ?? 0) > 0, String(chainRow?.ancestry));
  ok("★★★ 末帧是 BATTLE_END（规格 §60 的收尾），它的 0 父链是预期而不是丢失",
    row?.t === "BATTLE_END" && (row?.ancestry ?? -1) === 0, JSON.stringify({ t: row?.t, ancestry: row?.ancestry }));
  const mid = playFrame(OUT, Math.floor(last / 2));
  ok("★★ 中间帧同样能重建（抽查中点）", !!mid && !!mid.stateHash && mid.frame === Math.floor(last / 2));
  ok("★★ 越界帧返回 null（不是抛错也不是编一个空状态）", playFrame(OUT, last + 999) === null);
}

sec("[4] Replay determinism：同 seed 两次录制逐字节一致；换 seed 必须不同")
{
  const a = await recordReplay(SEED);
  const b = await recordReplay(SEED);
  const ja = serializeReplay(a.file), jb = serializeReplay(b.file);
  /**
   * ★★★ 第 117 轮：文件里有一个**声明过的**非确定字段 `createdAt`（录制的墙钟时间）。
   *   所以判据写成「除 createdAt 外逐字节一致」，并且把「只差这一个字段」也断言出来 ——
   *   否则「同 seed 一致」这句话要么被一个时间戳悄悄破坏，要么被一句「差不多一致」糊过去。
   */
  const strip = (j: string) => j.replace(/"createdAt":"[^"]*"/, '"createdAt":"STRIPPED"');
  ok("★★★ 同 seed 两次录制：除 createdAt 外**逐字节一致**", strip(ja) === strip(jb), ja.length + " vs " + jb.length);
  ok("★★★ 而且差异**只有** createdAt 一个字段", (() => { const A: any = JSON.parse(ja), B: any = JSON.parse(jb); const diff = Object.keys(A).filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k])); return diff.length === 1 && diff[0] === "createdAt"; })(), "");
  const c = await recordReplay(SEED + 1);
  ok("★★★ 换 seed ⇒ 帧流确实不同（否则上一条没有意义）", JSON.stringify(c.file.frames) !== JSON.stringify(a.file.frames));
  ok("★★ 而且指纹也不同", c.file.finalHash !== a.file.finalHash, c.file.finalHash + " vs " + a.file.finalHash);
}

console.log("\n=== G3 CLI 逐帧回放: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;