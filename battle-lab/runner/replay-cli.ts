// runner/replay-cli.ts — ★ G3：逐帧回放 CLI（a1-4.md §58）
//
// 文档要求先在命令行证明这一件事，UI 才接：
//   node replay.ts seed=12345
//   Frame 000 START
//   Frame 001 TIMELINE
//   ...
//   Frame 382 BATTLE_END
//   并且：Frame 382 state == Engine final state
//
// 用法：
//   node runner/replay-cli.ts seed=12345              跑一局并逐帧打印 + 校验
//   node runner/replay-cli.ts seed=12345 save=out.json 跑完存成 Replay 文件
//   node runner/replay-cli.ts file=out.json            **纯播放**：不装配、不执行引擎
//   node runner/replay-cli.ts file=out.json frame=137  跳到某一帧看战场状态
import fs from "node:fs/promises";
import path from "node:path";
import { createKit, assembleMatch, assembleCount } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { SnapshotRecorder } from "../kernel/snapshot.ts";
import { buildReplay, loadReplay, serializeReplay, ReplayPlayer } from "../kernel/replay.ts";

const here = import.meta.dirname;
const ROOT = path.resolve(here, "..", "..");
const args = Object.fromEntries(process.argv.slice(2).map(a => a.split("=") as [string, string]));

const bundle = JSON.parse(await fs.readFile(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const ENGINE_VERSION = bundle.engineVersion, GAME_DATA_VERSION = bundle.gameDataVersion;

const pad = (n: number, w = 3) => String(n).padStart(w, "0");

function line(frame: any, state: any): string {
  const who = (id: any) => state?.teams?.flatMap((t: any) => t.members).find((m: any) => m.id === id)?.name ?? (id != null ? "#" + id : "—");
  const extra: string[] = [];
  if (frame.actor !== undefined) extra.push("actor=" + who(frame.actor));
  if (frame.target !== undefined) extra.push("target=" + who(frame.target));
  if (frame.src !== undefined && frame.dst !== undefined) extra.push(who(frame.src) + "→" + who(frame.dst));
  if (frame.skill) extra.push("skill=" + frame.skill);
  if (frame.applied !== undefined) extra.push("dmg=" + frame.applied);
  if (frame.crit) extra.push("CRIT");
  if (frame.amount !== undefined) extra.push("amount=" + frame.amount);
  if (frame.before !== undefined && frame.after !== undefined) extra.push(`orb ${frame.before}→${frame.after}`);
  if (frame.status) extra.push("status=" + frame.status);
  if (frame.id !== undefined) extra.push("unit=" + who(frame.id));
  if (frame.killer !== undefined) extra.push("killer=" + who(frame.killer));
  if (frame.hp !== undefined && frame.t !== "DAMAGE") extra.push("hp=" + Math.round(frame.hp));
  if (frame.team !== undefined) extra.push((frame.team === 0 ? "红" : "蓝") + "方回火 +" + (frame.gained ?? frame.requested ?? 0) + (frame.overflow ? `（溢出 ${frame.overflow}）` : ""));
  if (frame.percent !== undefined) extra.push(`${frame.direction === "pull" ? "拉条" : "推条"} ${(frame.percent * 100).toFixed(0)}%`);
  return `Frame ${pad(frame.frame)}  ${String(frame.t).padEnd(16)} ${extra.join("  ")}`;
}

// ─────────── 模式一：跑一局并录像 ───────────
if (args.seed !== undefined) {
  const seed = Number(args.seed);
  const kit = createKit(bundle);
  const a = assembleMatch(kit, canonicalMatch(), { seed });
  const rec = new SnapshotRecorder(64);
  (a.battle as any).traceLevel = "FULL";
  a.battle.recorder = rec;
  const result = await a.battle.run();
  const finalState = captureState(a.battle);

  console.log(`=== Replay seed=${seed} （${result.turns} 回合，winner=${result.winner}，${a.battle.trace.length} 帧）===`);
  const all = args.all !== undefined;
  const from = args.from !== undefined ? Number(args.from) : 0;
  const to = args.to !== undefined ? Number(args.to) : a.battle.trace.length - 1;
  const step = args.step !== undefined ? Number(args.step) : 1;
  for (let i = from; i <= to && i < a.battle.trace.length; i += step) {
    if (!all && step === 1 && a.battle.trace.length > 40 && i !== from && i !== to && i % Math.ceil(a.battle.trace.length / 30) !== 0) continue;
    console.log(line(a.battle.trace[i], finalState));
  }
  console.log(`Frame ${pad(a.battle.trace.length)}  BATTLE_END        ${result.reason}  winner=${result.winner}`);

  const replay = buildReplay(a.battle, rec, {
    engineVersion: ENGINE_VERSION, gameDataVersion: GAME_DATA_VERSION,
    matchId: canonicalMatch().id, seed, maxTurns: a.battle.rules.maxTurns,
    policyIds: {
      startup: a.battle.policies.startup.id, priority: a.battle.policies.priority, tieBreak: a.battle.policies.tieBreak,
      death: a.battle.policies.death.id, resource: a.battle.policies.resource.id, guessing: a.battle.policies.guessing.id,
    },
    red: canonicalMatch().red.units.map(u => u.name), blue: canonicalMatch().blue.units.map(u => u.name),
  }, finalState, { winner: result.winner, turns: result.turns, reason: result.reason });

  // ★ 文档的验收点：Frame N state == Engine final state
  const player = new ReplayPlayer(loadReplay(serializeReplay(replay)));
  const rebuilt = player.stateAt(rec.lastFrame);
  const okSame = JSON.stringify(rebuilt) === JSON.stringify(finalState);
  console.log(`\n[校验] Frame ${rec.lastFrame} 重建状态 == Engine 终局状态 : ${okSame ? "✓ 一致" : "✗ 不一致"}`);
  console.log(`[校验] 指纹：重建 ${rebuilt ? stateHash(rebuilt) : "null"} / 终局 ${stateHash(finalState)}`);

  if (args.save) {
    const out = path.isAbsolute(args.save) ? args.save : path.join(here, args.save);
    const json = serializeReplay(replay);
    await fs.writeFile(out, json, "utf8");
    console.log(`[保存] ${out}  ${(json.length / 1024).toFixed(1)} KB（${replay.frames.length} 帧 / ${replay.checkpoints.length} Checkpoint / ${replay.deltas.length} Delta / ${replay.events.length} 事件链节点）`);
  }
  if (!okSame) process.exitCode = 1;
}

// ─────────── 模式二：纯播放（不装配、不执行引擎）───────────
else if (args.file) {
  const before = assembleCount;
  const p = path.isAbsolute(args.file) ? args.file : path.join(here, args.file);
  const file = loadReplay(await fs.readFile(p, "utf8"));
  const player = new ReplayPlayer(file);
  console.log(`=== 纯播放 ${path.basename(p)}（seed=${file.match.seed}，${player.frameCount} 帧）===`);
  const frame = args.frame !== undefined ? Number(args.frame) : player.frameCount - 1;
  const state = player.stateAt(Number.isFinite(frame) ? frame : player.lastFrame);
  console.log(line({ frame, t: "(状态)", ...player.frame(Math.min(frame, player.frameCount - 1)) }, state));
  if (state) {
    for (const t of state.teams) {
      const side = t.id === 0 ? "红" : "蓝";
      const units = t.members.map((m: any) => `${m.name} ${Math.round(m.hp)}/${m.maxHp}${m.alive ? "" : "†"}`).join("  ");
      console.log(`  ${side}  鬼火 ${t.orbs.orb}  回火计数 ${t.orbs.cycle}  ${units}`);
    }
    console.log(`  该帧指纹 ${stateHash(state)}（终局指纹 ${file.finalHash}）`);
  }
  const anc = player.ancestryOfFrame(Math.min(frame, player.frameCount - 1));
  if (anc.length) console.log(`  事件链：${anc.map((n: any) => n.code + "#" + n.seq).join(" → ")}`);
  console.log(`\n[校验] 纯播放期间引擎装配次数：${before} → ${assembleCount}（必须不变，§36：回放不是第二次执行）`);
  if (assembleCount !== before) process.exitCode = 1;
}

else {
  console.log("用法：");
  console.log("  node runner/replay-cli.ts seed=12345 [all=1] [from=0] [to=100] [step=5] [save=out.replay.json]");
  console.log("  node runner/replay-cli.ts file=out.replay.json [frame=137]");
}
