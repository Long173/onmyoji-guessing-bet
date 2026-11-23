// tests/g74-delta-economy.ts — ★★★ 第 118 轮：G2 的 Delta 体积与自证（a1-4.md §35/§38/§103）
//
// 由来：tools/_probe-size118.ts 实测（seed 123456 / **当时 597 帧**；第 244 轮补上规格 §60 的两端后为 599 帧）整份录像 730 KB：
//   frames 277 KB｜deltas 191 KB｜events 137 KB｜checkpoints 93 KB。
// 191 KB 里 2582 个标量 op，每个都要把 ["counts","trace"] 这样的路径整段写一遍 ——
// 而一局里不同路径只有几十条。这一轮做**路径字典（PATH_V1）**，并且两侧都钉死：
//   ① 体积真的降下来（同一份 rec：PLAIN vs PATH_V1 逐字节量，不靠"感觉更小"）；
//   ② 信息一点没丢（packed → expand 逐 op 还原；全部帧重建三方一致：PATH_V1 == PLAIN == 记录器内存链）；
//   ③ 老录像还放得动（v1 文件没有 deltaCodec 字段，一律按 PLAIN 读）；
//   ④ 反向：改一条 delta / 越界一个路径下标，verify 必须红 —— 否则这套编码就是没人验的空转。
import fs from "node:fs";
import path from "node:path";
import { recordReplay, verifyReplayFile } from "../tools/replay-cli.ts";
import { loadReplay, serializeReplay, plainDeltas, ReplayPlayer } from "../kernel/replay.ts";
import { applyDelta, packDeltas } from "../kernel/snapshot.ts";
import { stateHash } from "../kernel/state.ts";
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SEED = 123456;
const OUT = path.join(ROOT, "battle-lab", "fixtures", "replay-demo-" + SEED + ".json");

sec("[0] 前提：同一场战斗、同一份记录器，分别按 PATH_V1 与 PLAIN 打包");
const A = await recordReplay(SEED);
const v1 = A.file, plain = A.plainFile;
ok("★★★ 两个文件出自**同一份 rec**（不是跑了两遍战斗 —— 那样比的就不是编码了）",
  v1.deltas.length === A.rec.deltas.length && plain.deltas.length === A.rec.deltas.length,
  v1.deltas.length + " Delta");
ok("★★ 编码声明与版本号：新文件 = v2 + PATH_V1，对照文件 = PLAIN",
  v1.schemaVersion === 2 && v1.deltaCodec === "PATH_V1" && plain.deltaCodec === "PLAIN",
  v1.schemaVersion + "/" + v1.deltaCodec + " vs " + plain.schemaVersion + "/" + plain.deltaCodec);
const paths = v1.deltaPaths ?? [];
ok("★★ 路径字典去重生效（字典里没有重复路径）",
  paths.length > 0 && new Set(paths.map(p => JSON.stringify(p))).size === paths.length,
  paths.length + " 条路径 / " + v1.deltas.reduce((s, d) => s + d.ops.length, 0) + " 个 op");
ok("★★ 帧数 / Checkpoint / 终局指纹两文件完全一致（编码不该改变任何事实）",
  v1.frames.length === plain.frames.length && v1.checkpoints.length === plain.checkpoints.length && v1.finalHash === plain.finalHash,
  v1.frames.length + " 帧｜" + v1.finalHash);

sec("[1] 体积：省掉的正是「重复写路径」这一笔");
const plainBytes = serializeReplay(plain).length, v1Bytes = serializeReplay(v1).length;
const dPlain = plain.deltas.reduce((s, d) => s + d.bytes, 0), dV1 = v1.deltas.reduce((s, d) => s + d.bytes, 0);
const dictBytes = JSON.stringify(paths).length;
const pctD = (100 * (1 - dV1 / dPlain)).toFixed(1), pctF = (100 * (1 - v1Bytes / plainBytes)).toFixed(1);
console.log("    Delta " + dPlain + " → " + dV1 + " 字节（省 " + pctD + "%）｜整文件 " + plainBytes + " → " + v1Bytes + " 字节（省 " + pctF + "%）｜路径字典本身 " + dictBytes + " 字节");
ok("★★★ Delta 部分至少省 40%", dV1 <= dPlain * 0.6, pctD + "%");
ok("★★★ 整文件更小（含字典开销在内仍然更小）", v1Bytes < plainBytes, pctF + "%");
ok("★ 诚实记录：路径字典本身是新增开销，写在文件里（" + dictBytes + " 字节），不是零成本",
  v1.deltaCodec === "PATH_V1" && dictBytes > 0 && dictBytes < dPlain - dV1);
ok("★★ 单帧平均开销 < 2KB（长局要存得下）", v1Bytes / v1.frames.length < 2048, (v1Bytes / v1.frames.length).toFixed(0) + " 字节/帧");

sec("[2] 信息不丢：packed → expand 必须逐 op 还原成记录器里的原样");
/** op 的规范化形状（用来做深比较；path/resize/有无 to/有无 from 都要对上） */
const norm = (ops: any[]) => JSON.stringify(ops.map((o: any) => ({
  p: o.path, r: o.resize ? [o.resize.to, o.resize.tail] : null,
  hasTo: "to" in o, to: o.to ?? null, hasFrom: "from" in o, from: o.from ?? null,
})));
const back = plainDeltas(v1);
const diff: string[] = [];
for (let i = 0; i < back.length; i++) {
  if (norm(back[i].ops) !== norm(A.rec.deltas[i].ops)) { if (diff.length < 2) diff.push("frame " + back[i].frame); }
}
ok("★★★ 每一帧的 op 序列都能逐字段还原（" + back.length + " 帧全查）", back.length === A.rec.deltas.length && diff.length === 0, diff.join(","));
const pk = packDeltas(A.rec.deltas);
ok("★★ 纯函数层同一条路：packDeltas(rec) 的字典与帧数据 == 文件里那份",
  JSON.stringify(pk.paths) === JSON.stringify(paths) && JSON.stringify(pk.frames) === JSON.stringify(v1.deltas));

sec("[3] 全部帧重建：PATH_V1 == PLAIN == 记录器内存链（三方一致）");
const lastFrame = A.rec.lastFrame;
const backByFrame = new Map(back.map(d => [d.frame, d]));
const plainByFrame = new Map(plain.deltas.map(d => [d.frame, d]));
const recByFrame = new Map(A.rec.deltas.map(d => [d.frame, d]));
const cpByFrame = new Map<number, any>();
for (const c of v1.checkpoints) cpByFrame.set(c.frame, {
  v: c.state as any,
  p: plain.checkpoints.find(x => x.frame === c.frame)!.state,
  r: A.rec.checkpoints.find(x => x.frame === c.frame)!.state,
});
const valueAt = (s: any, p: any[]): any => { let c = s; for (const k of p) { if (c === null || c === undefined) return undefined; c = c[k]; } return c; };
const start = cpByFrame.get(0);
let walkV: any = structuredClone(start.v), walkP: any = structuredClone(start.p), walkR: any = structuredClone(start.r);
let cpChecked = 0, cpBad = 0, deltaFrames = 0, holes = 0, badFrames = 0;
let fromChecked = 0, fromBad = 0;
const firstBad: string[] = [], fromSample: string[] = [], cpNote: string[] = [];
for (let f = 1; f <= lastFrame; f++) {
  const dv = backByFrame.get(f), dp = plainByFrame.get(f), dr = recByFrame.get(f);
  if (!dv || !dp || !dr) { holes++; continue; }
  deltaFrames++;
  /** ★ [4] 的 from 自检同步在这里做（不再另走一遍链）：from 必须等于**前一帧**该路径的实际值 */
  for (const o of dv.ops as any[]) {
    if (o.resize) continue;
    const actual = valueAt(walkV, o.path);
    /** JSON 里 undefined 值本就不存在（set-to-undefined 与"缺键"同形），这一类不算自检样本 */
    if (actual === undefined && o.from === undefined) continue;
    fromChecked++;
    if (JSON.stringify(actual) !== JSON.stringify(o.from)) {
      fromBad++;
      if (fromSample.length < 3) fromSample.push("frame " + f + " " + JSON.stringify(o.path) + " 实为 " + JSON.stringify(actual) + " 但记的 from=" + JSON.stringify(o.from));
    }
  }
  walkV = applyDelta(walkV, dv.ops as any); walkP = applyDelta(walkP, dp.ops); walkR = applyDelta(walkR, dr.ops);
  if (JSON.stringify(walkV) !== JSON.stringify(walkP) || JSON.stringify(walkV) !== JSON.stringify(walkR)) {
    badFrames++; if (firstBad.length < 3) firstBad.push("frame " + f);
  }
  const cp = cpByFrame.get(f);
  if (cp) {
    cpChecked++;
    /**
     * ★★ v2 与 v1 的分水岭：v2 在 Checkpoint 帧**也记 Delta**，于是"上一 Checkpoint + 区间 Delta"
     *    必须**正好**落在本 Checkpoint 存的状态上。这就是旧写法那句恒真的 checkpoint 自证换来的东西。
     */
    if (JSON.stringify(walkV) !== JSON.stringify(cp.v)) { cpBad++; if (cpNote.length < 3) cpNote.push("cp@" + f + " 区间重建对不上"); }
    if (JSON.stringify(cp.v) !== JSON.stringify(cp.p) || JSON.stringify(cp.v) !== JSON.stringify(cp.r)) { cpBad++; if (cpNote.length < 3) cpNote.push("cp@" + f + " 三份文件档不一致"); }
    walkV = structuredClone(cp.v); walkP = structuredClone(cp.p); walkR = structuredClone(cp.r);
  }
}
ok("★★★ 每一帧都有 Delta（v2 = 完整链）：" + deltaFrames + "/" + lastFrame + " 帧，没有空洞", holes === 0 && deltaFrames === lastFrame, "洞 " + holes);
ok("★★★ 每个 Checkpoint 帧：「上一 Checkpoint + 区间 Delta」== 档里状态（" + cpChecked + " 个全查）", cpBad === 0, "坏 " + cpBad + " " + cpNote.join(","));
ok("★★★ 每个 Delta 帧：PATH_V1 == PLAIN == 记录器内存链（" + deltaFrames + " 帧逐字节比对）", badFrames === 0, "坏 " + badFrames + " " + firstBad.join(","));
ok("★★★ 走完链得到的状态指纹 == 文件 finalHash（Frame N == Engine final state）", stateHash(walkV) === v1.finalHash, stateHash(walkV) + " vs " + v1.finalHash);
ok("★★★ [4] 每个 op 的 from == 前一帧该路径的实际值（" + fromChecked + " 个 op 自检，不是装饰）", fromChecked > 500 && fromBad === 0, "坏 " + fromBad + " " + fromSample.join(" | "));
/** 播放器路径（含 Checkpoint 选择逻辑）单独抽查：每个 Checkpoint + 均匀 30 帧 */
const pv = new ReplayPlayer(v1), pp = new ReplayPlayer(plain);
let pvBad = 0, pvChecked = 0;
const sample = [...v1.checkpoints.map(c => c.frame), ...Array.from({ length: 30 }, (_, i) => Math.floor((i * lastFrame) / 30))].filter(f => f <= lastFrame);
for (const f of sample) {
  const a = pv.stateAt(f), b = pp.stateAt(f);
  pvChecked++;
  if (!a || !b || JSON.stringify(a) !== JSON.stringify(b)) pvBad++;
}
ok("★★★ ReplayPlayer（走 Checkpoint + Delta）抽查 " + pvChecked + " 帧同样一致", pvBad === 0 && pvChecked > 30, "坏 " + pvBad);

sec("[4] from 不是装饰：Delta 链自带逐 op 自检（在上面的走链里同步做，不另走一遍链）");
ok("★★ 这一步真的查了东西（不是空转）：自检样本 " + fromChecked + " 个 op", fromChecked > 500, String(fromChecked));

sec("[5] 反向：改坏 delta / 越界路径下标 / 缺字典 —— 三条都得红");
const tmp = path.join(ROOT, "battle-lab", "fixtures", "replay-tmp-g74.json");
const pathOf = (f: any, o: any): any[] => (f.deltaCodec === "PATH_V1" ? (f.deltaPaths?.[o[0]] ?? []) : (o.path ?? []));
const isCore = (f: any) => (o: any) => /^(teams|turn|timeline|winner)/.test(String(pathOf(f, o)[0]));
/** ★ 正向对照：原封不动的那份必须通过，且 Checkpoint 交叉校验真的跑了（否则下面那些"变红"没有意义） */
fs.writeFileSync(tmp, serializeReplay(v1));
const vOk = verifyReplayFile(tmp);
ok("★★★ 正向对照：原文件 verify 通过，且 Checkpoint 交叉校验跑了 " + vOk.cpCross + " 个（不是跳过）",
  vOk.ok === true && vOk.cpCross === v1.checkpoints.length - 1 && vOk.cpCrossSkipped === false,
  JSON.stringify({ ok: vOk.ok, cpCross: vOk.cpCross, skipped: vOk.cpCrossSkipped, issues: vOk.issues }));
/** ① 只改一条核心 delta 的值（finalHash 原样不动） */
/**
   * ① 改**最后一次**写核心路径的那个 op —— 保证后面没有任何写入把它盖回去。
   *    第一版改的是"第一个"核心 op：它被同路径的后续写入覆盖（后一个 op 的 to 是绝对值），
   *    verify 照样绿 ⇒ 那就是一条**空转的反向闸门**。这个坑是这一轮实测出来的。
   */
const bad1 = JSON.parse(serializeReplay(v1));
let hit: { d: any; o: any } | null = null;
for (const d of bad1.deltas) for (const o of d.ops) { if (isCore(bad1)(o)) hit = { d, o }; }
if (hit) hit.o[2] = typeof hit.o[2] === "number" ? hit.o[2] + 12345 : "TAMPERED";
fs.writeFileSync(tmp, serializeReplay(bad1));
const vb1 = verifyReplayFile(tmp);
const pv1 = new ReplayPlayer(loadReplay(fs.readFileSync(tmp, "utf8")));
ok("★★★ 改坏最后一条核心 op ⇒ verify 红，且**重建出的末帧指纹真的变了**（不是靠 finalHash 字段兜底）",
  !!hit && vb1.ok === false && stateHash(pv1.stateAt(lastFrame)!) !== v1.finalHash,
  JSON.stringify(hit ? pathOf(bad1, hit.o) : null) + " → " + JSON.stringify(vb1.issues));
/** ② 把某条 op 的路径下标改成字典外 */
const bad2 = JSON.parse(serializeReplay(v1));
const td = bad2.deltas.find((x: any) => x.ops.length > 0) ?? bad2.deltas[0];
td.ops[0][0] = (bad2.deltaPaths ?? []).length + 99;
fs.writeFileSync(tmp, serializeReplay(bad2));
const vb2 = verifyReplayFile(tmp);
ok("★★★ 路径下标越界 ⇒ verify 明确指出（不是静默偏移到别的字段上）",
  vb2.ok === false && vb2.issues.some((s: string) => s.indexOf("字典外") >= 0), JSON.stringify(vb2.issues));
/** ③ 声明 PATH_V1 却没有字典 ⇒ 解析期就拒绝 */
const bad3 = JSON.parse(serializeReplay(v1));
delete bad3.deltaPaths;
let threw = "";
try { loadReplay(bad3); } catch (e: any) { threw = String(e && e.message); }
ok("★★ 声明 PATH_V1 但缺 deltaPaths ⇒ loadReplay 直接报错", threw.indexOf("deltaPaths") >= 0, threw);
if (fs.existsSync(tmp)) fs.unlinkSync(tmp);

sec("[6] 老录像还放得动：v1 文件没有 deltaCodec 字段");
/** 忠实模拟 v1 文件：老记录器在 Checkpoint 帧**不记 Delta**（那一步的转移只存在于 Checkpoint 内部） */
const cpFrames = new Set(plain.checkpoints.map(c => c.frame));
const legacy = JSON.parse(serializeReplay(plain));
delete legacy.deltaCodec;
legacy.schemaVersion = 1;
legacy.deltas = legacy.deltas.filter((d: any) => !cpFrames.has(d.frame));
const lp = new ReplayPlayer(loadReplay(legacy));
ok("★★★ v1 老录像（无 deltaCodec、Checkpoint 帧缺 Delta）：仍能逐帧重建，末帧指纹 == finalHash",
  stateHash(lp.stateAt(lp.frameCount - 1)) === legacy.finalHash,
  stateHash(lp.stateAt(lp.frameCount - 1)) + " vs " + legacy.finalHash);
ok("★★ 前提成立：老格式 op 自带 path、无 deltaPaths，且 Delta 数 = 帧数 − Checkpoint 数",
  legacy.deltaPaths === undefined && Array.isArray(legacy.deltas[0].ops[0].path)
    && legacy.deltas.length === v1.deltas.length - (v1.checkpoints.length - 1),
  legacy.deltas.length + " vs " + v1.deltas.length + " − " + (v1.checkpoints.length - 1));
fs.writeFileSync(tmp, serializeReplay(legacy));
const vLegacy = verifyReplayFile(tmp);
ok("★★★ 老文件也过 verify，且**明说**跳过了 Checkpoint 交叉校验（不装作查过）",
  vLegacy.ok === true && vLegacy.cpCrossSkipped === true && vLegacy.cpCross === 0,
  JSON.stringify({ ok: vLegacy.ok, skipped: vLegacy.cpCrossSkipped, issues: vLegacy.issues }));

console.log("\n=== G2 Delta 体积与自证: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
