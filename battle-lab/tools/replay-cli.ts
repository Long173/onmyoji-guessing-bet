// tools/replay-cli.ts — ★★★ 第 117 轮：**G3 的 CLI 逐帧回放**（a1-4.md §36/§38/§58）
//
// 文档给 G3 的完成标准就是一句 CLI 用法：
//   「先用 CLI：node replay.ts seed=12345 打出 Frame 000 … Frame 382 BATTLE_END，
//     并证明 Frame 382 state == Engine final state。然后 UI 才接。」
//
// 库层（kernel/snapshot.ts 的 Checkpoint+Delta、kernel/replay.ts 的 buildReplay/ReplayPlayer）早在第 40 轮就齐了，
// 但**没有任何 CLI 入口**：g3-replay.ts 里那段"CLI 产出的 Replay 文件能被独立解析"因为文件不存在，
// 一直是一条**从不执行**的条件断言。这个文件补的就是那一步。
//
// 用法：
//   node tools/replay-cli.ts run [seed] [--out 路径] [--list]
//   node tools/replay-cli.ts play <文件> --frame N
//   node tools/replay-cli.ts verify <文件>
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch, assembleCount } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { SnapshotRecorder } from "../kernel/snapshot.ts";
import { applyFrameDelta, buildReplay, loadReplay, serializeReplay, ReplayPlayer } from "../kernel/replay.ts";
import type { ReplayFile } from "../kernel/replay.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

/** 录一局并产出 Replay 文件对象（与 g3-replay.ts 的 record() 同一套调用） */
export async function recordReplay(seed: number, opts: { deltaCodec?: "PLAIN" | "PATH_V1" } = {}): Promise<{ file: ReplayFile; plainFile: ReplayFile; rec: SnapshotRecorder; finalState: any; result: any }> {
  const kit = createKit(bundle);
  const a: any = assembleMatch(kit, canonicalMatch(), { seed });
  const rec = new SnapshotRecorder(64);
  a.battle.traceLevel = "FULL";
  a.battle.recorder = rec;
  const result = await a.battle.run();
  const finalState = captureState(a.battle);
  const meta = {
    engineVersion: bundle.engineVersion, gameDataVersion: bundle.gameDataVersion,
    matchId: "canonical-001", seed, maxTurns: 300,
    policyIds: { startup: "NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI", priority: "REGISTRATION_ORDER", tieBreak: "SPEED_THEN_RANDOM", death: "DEATH_AFTER_PREVENTION", resource: "OFFICIAL_GAUGE", guessing: "COMMUNITY_2020_UNVERIFIED" },
    red: canonicalMatch().red.units.map((u: any) => u.name), blue: canonicalMatch().blue.units.map((u: any) => u.name),
  };
  const res = { winner: result.winner, turns: result.turns, reason: result.reason };
  const codec = opts.deltaCodec ?? "PATH_V1";
  const file = buildReplay(a.battle, rec, meta, finalState, res, { deltaCodec: codec });
  // ★ §103 的 A/B 材料：同一份记录器再打一份 PLAIN 编码的文件。
  //   必须是**同一场战斗的同一份 rec** —— 重跑一遍战斗再比大小，比的就不是编码了。
  const plainFile = codec === "PLAIN" ? file : buildReplay(a.battle, rec, meta, finalState, res, { deltaCodec: "PLAIN" });
  return { file, plainFile, rec, finalState, result };
}

/** `run`：录制 + 写文件；返回路径与摘要（供 CLI 与测试共用） */
export async function runReplayCli(opts: { seed?: number; out?: string } = {}) {
  const seed = opts.seed ?? 123456;
  const out = opts.out ?? path.join(ROOT, "battle-lab", "fixtures", "replay-demo-" + seed + ".json");
  const { file, plainFile, result } = await recordReplay(seed);
  const json = serializeReplay(file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, json);
  return {
    out, seed, bytes: json.length, plainBytes: serializeReplay(plainFile).length,
    codec: file.deltaCodec ?? "PLAIN", deltaBytes: file.deltas.reduce((s, d) => s + d.bytes, 0),
    frames: file.frames.length, checkpoints: file.checkpoints.length,
    deltas: file.deltas.length, events: file.events.length, finalHash: file.finalHash, result,
  };
}

/**
 * `verify`：**逐帧回放的自证**。三条都不依赖引擎：
 *   ① 每个 Checkpoint 自证（重建出来的状态哈希 == 档里那个状态的哈希）；
 *   ② 终局帧重建 == 文件自带的 finalHash；
 *   ③ 纯播放期**一次装配都没发生**（§36：Replay 不是引擎第二次执行）。
 * ★ 反向能力由调用方提供：改掉文件里的一个 delta，`ok` 必须变 false（tests/g73 就是拿它当闸门的）。
 */
export function verifyReplayFile(filePath: string) {
  const file = loadReplay(fs.readFileSync(filePath, "utf8"));
  const player = new ReplayPlayer(file);
  const issues: string[] = [];
  /**
   * ★ §103：Checkpoint 交叉校验。旧写法是 player.stateAt(cp.frame) == cp.state —— 那在
   * Checkpoint 帧上**恒真**（播放器从"最近的 Checkpoint"起步，正好就是它自己），没有信息量。
   * 真正有信息量的问法是：从**上一个** Checkpoint 起，把区间内的 Delta 全走一遍，
   * 是否正好落在本 Checkpoint 存的状态上。v1 文件在 Checkpoint 帧不记 Delta（那一步只存在于
   * Checkpoint 内部），所以只能跳过 —— 跳过了就明说，不装作查过。
   */
  let cpCross = 0;
  const cpCrossSkipped = file.schemaVersion === 1;
  if (!cpCrossSkipped) {
    for (let k = 1; k < file.checkpoints.length; k++) {
      const prev = file.checkpoints[k - 1], cur = file.checkpoints[k];
      let st: any = structuredClone(prev.state);
      for (const d of file.deltas) { if (d.frame <= prev.frame) continue; if (d.frame > cur.frame) break; st = applyFrameDelta(st, file, d); }
      cpCross++;
      if (stateHash(st) !== stateHash(cur.state)) issues.push("checkpoint @" + cur.frame + " 与「上一 Checkpoint + 区间 Delta」不一致");
    }
  }
  /**
   * ★★★ 第 191 轮：**逐帧比对**（每一帧都与引擎记录那一刻的指纹比）。
   *   在这一轮之前，verify 只做三件事：Checkpoint 交叉校验 · 终局帧 == finalHash · 抽查 4 帧不崩。
   *   于是 CLI 那句「全部帧可重建」是**报表比代码乐观**：中间几百帧的 Delta 链没有任何地面真值。
   *   ★ 走的是**播放器自己的 stateAt**（Theater 拖动进度条用的就是它），不是另写一条重建路径。
   *   ★ 老文件没有 frameHashes —— 那就**如实说没验**（frameCompare = -1），不装作验过。
   */
  let frameCompare = -1, frameMismatch = 0, firstMismatch = -1, tailHashOk: boolean | null = null;
  if (Array.isArray(file.frameHashes) && file.frameHashes.length >= file.frames.length) {
    frameCompare = 0;
    for (let f = 0; f < file.frames.length; f++) {
      const st = player.stateAt(f);
      frameCompare++;
      if (!st || stateHash(st) !== file.frameHashes[f]) { frameMismatch++; if (firstMismatch < 0) firstMismatch = f; }
    }
    if (frameMismatch) issues.push("逐帧比对：第 " + firstMismatch + " 帧起共 " + frameMismatch + " 帧与引擎记录的状态不一致");
    /**
     * ★ 记录器还会在**最后一条 trace 之后**补记一帧（终局状态是胜负写进状态之后才定的，见 battle.ts 的注），
     *   所以 frameHashes 比 frames 多一个 —— 那一个正是 finalHash 覆盖的那一帧，单独比一次。
     */
    const tail = file.frameHashes[file.frames.length];
    if (typeof tail === "string") { tailHashOk = tail === file.finalHash; if (!tailHashOk) issues.push("补记的终局帧指纹与 finalHash 不一致"); }
  }
  const lastFrame = file.frames.length - 1;
  const last = player.stateAt(lastFrame);
  if (!last || stateHash(last) !== file.finalHash) issues.push("终局帧重建与 finalHash 不一致");
  // ★ §103：PATH_V1 的 op 用路径字典下标，字典外的下标会让重建静默偏移 —— 在这里显式查出来
  if (file.deltaCodec === "PATH_V1") {
    const paths = file.deltaPaths ?? [];
    let oob = 0, badResize = 0;
    for (const d of file.deltas) for (const o of d.ops as any[]) {
      if (!Array.isArray(o) || typeof o[0] !== "number" || o[0] < 0 || o[0] >= paths.length) oob++;
      else if (o[1] === 2 && (!o[2] || !Array.isArray(o[2].tail))) badResize++;
    }
    if (oob) issues.push("Delta 引用了路径字典外的下标 ×" + oob);
    if (badResize) issues.push("resize op 形状不对 ×" + badResize);
  }
  const before = assembleCount;
  for (const f of [0, Math.floor(lastFrame / 3), Math.floor((2 * lastFrame) / 3), lastFrame]) player.stateAt(f);
  player.ancestryOfFrame(Math.max(0, lastFrame - 1));
  if (assembleCount !== before) issues.push("纯播放期间发生了装配（" + before + " → " + assembleCount + "）");
  return { ok: issues.length === 0, issues, frames: file.frames.length, checkpoints: file.checkpoints.length, deltas: file.deltas.length, cpCross, cpCrossSkipped, frameCompare, frameMismatch, firstMismatch, tailHashOk, finalHash: file.finalHash };
}

/** `play --frame N`：不碰引擎地把第 N 帧与那一刻的战场状态打出来 */
export function playFrame(filePath: string, frame: number) {
  const file = loadReplay(fs.readFileSync(filePath, "utf8"));
  const player = new ReplayPlayer(file);
  const f = player.frame(frame);
  const st = player.stateAt(frame);
  if (!f) return null;
  const units = st ? [
    ...st.teams[0].members.map((m: any) => ({ side: "红", name: m.name, hp: Math.round(m.hp), alive: m.alive })),
    ...st.teams[1].members.map((m: any) => ({ side: "蓝", name: m.name, hp: Math.round(m.hp), alive: m.alive })),
  ] : [];
  return { frame, ev: f.ev ?? null, t: f.t, actor: f.actor ?? null, target: f.dst ?? null, applied: f.applied ?? null, depth: f.depth, units, stateHash: st ? stateHash(st) : null, ancestry: player.ancestryOfFrame(frame).length };
}

// ────────────────────────────── CLI 入口 ──────────────────────────────
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === "run") {
    const seed = Number(rest.find((x) => /^[0-9]+$/.test(x)) ?? 123456);
    const r = await runReplayCli({ seed, out: flag("--out") });
    console.log("=== Replay 写出 " + r.out + " ===");
    console.log("  " + r.frames + " 帧 / " + r.checkpoints + " Checkpoint / " + r.deltas + " Delta / " + r.events + " 事件链节点 / " + (r.bytes / 1024).toFixed(1) + " KB");
    console.log("  Delta 编码 " + r.codec + "：" + (r.deltaBytes / 1024).toFixed(1) + " KB｜PLAIN 编码整文件 " + (r.plainBytes / 1024).toFixed(1) + " KB → 现在 " + (r.bytes / 1024).toFixed(1) + " KB");
    console.log("  终局指纹 " + r.finalHash + "｜winner=" + r.result.winner + " turns=" + r.result.turns + " reason=" + r.result.reason);
    if (rest.includes("--list")) {
      const file = loadReplay(fs.readFileSync(r.out, "utf8"));
      for (let i = 0; i < file.frames.length; i++) {
        const f: any = file.frames[i];
        if (i < 3 || i % 25 === 0 || i === file.frames.length - 1) console.log("  Frame " + String(i).padStart(3, "0") + "  " + f.t + (f.applied != null ? " " + Math.round(f.applied) : ""));
      }
      console.log("  Frame " + String(file.frames.length - 1).padStart(3, "0") + "  finalHash == 重建状态 == " + (verifyReplayFile(r.out).ok ? "OK" : "FAIL"));
    }
    return 0;
  }
  if (cmd === "verify") {
    const p = rest.find((x) => !x.startsWith("--")) ?? "";
    const v = verifyReplayFile(p);
    console.log("=== 校验 " + p + " ===");
    console.log("  " + v.frames + " 帧 / " + v.checkpoints + " Checkpoint / " + v.deltas + " Delta｜finalHash=" + v.finalHash);
    /**
     * ★★★ 第 191 轮：**这句提示语必须与真正验过的东西逐字对应**（报表不许比代码乐观）。
     *   旧文案是「✓ 全部帧可重建，且与引擎终局状态一致」—— 而当时只抽查了 4 帧、且只与终局比过。
     */
    console.log("  逐帧比对：" + (v.frameCompare >= 0
      ? v.frameCompare + " 帧全部与引擎记录的状态逐一比对（不一致 " + v.frameMismatch + " 帧）"
      : "**未做**（这份文件没有 frameHashes —— 第 191 轮之前的录像只验到终局帧）"));
    console.log("  Checkpoint×Delta 交叉校验：" + (v.cpCrossSkipped ? "**跳过**（v1 文件在 Checkpoint 帧不记 Delta，那一档只能作罢）" : v.cpCross + " 个区间全部落在下一个 Checkpoint 上"));
    console.log("  纯播放期零装配：已查（抽查 4 帧 + 事件链回溯）");
    console.log(v.ok ? "  ✓ 上面**列出的**每一项都通过" : "  ✗ " + v.issues.join("；"));
    return v.ok ? 0 : 1;
  }
  if (cmd === "play") {
    const p = rest.find((x) => !x.startsWith("--")) ?? "";
    const n = Number(flag("--frame") ?? 0);
    const row = playFrame(p, n);
    if (!row) { console.log("没有这一帧：" + n); return 1; }
    console.log("Frame " + row.frame + "  " + row.t + (row.applied != null ? " " + Math.round(row.applied) : "") + "  depth=" + row.depth + "  stateHash=" + row.stateHash);
    for (const u of row.units) console.log("  " + u.side + " " + u.name + " hp=" + u.hp + (u.alive ? "" : "（已阵亡）"));
    return 0;
  }
  console.log("用法：");
  console.log("  node tools/replay-cli.ts run [seed] [--out 路径] [--list]");
  console.log("  node tools/replay-cli.ts play <文件> --frame N");
  console.log("  node tools/replay-cli.ts verify <文件>");
  return 1;
}

/**
 * ★★ 入口判定要**严格到路径分隔符**：第一版写 /replay-cli\.ts$/，于是名字以 replay-cli.ts 结尾的**测试文件**
 *   （tests/g73-replay-cli.ts）一 import 这个模块就触发了 main() —— 测试还没跑就打印了用法并 exit 1。
 */
const isMain = !!process.argv[1] && /[/\\]replay-cli\.ts$/.test(process.argv[1]);
if (isMain) process.exit(await main());