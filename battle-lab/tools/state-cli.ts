// tools/state-cli.ts — ★★★ 第 190 轮：**跨进程的存档 / 续跑**（a1-4 §55 的字面要求：杀掉 Engine → 重新加载）
//
// 为什么需要它：tests/g0-state.ts 验的是**同一个进程内**丢弃实例后重建 —— 那挡不住
//   「依赖进程状态」的那一类 bug（模块级单例：StatusBook / tips 表 / 名字表 / 缓存）。
//   真正的「杀掉 Engine」是**换一个进程**：存档只能是一份 JSON，恢复只能靠知识库。
//
// 用法：
//   node tools/state-cli.ts reference --seed 20261001
//   node tools/state-cli.ts save --seed 20261001 --pause-at 20 --out tmp-state.json
//   node tools/state-cli.ts resume --in tmp-state.json
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, restoreBattle, stateHash } from "../kernel/state.ts";
import type { BattleState } from "../kernel/state.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const deps = (kit: any) => ({ kit, makeRuntime: (id: number) => runtimeFor(kit, id), attachRuntime });

/** 存档里的「恢复不了」痕迹（续跑前先数一遍 —— 静默丢状态是这一族最坏的失败） */
function restoreTroubles(b: any): string[] {
  const out: string[] = [];
  for (const e of b.allEntities()) for (const n of (e.notes ?? [])) if (String(n).startsWith("restore:")) out.push(e.id + ":" + n);
  return out;
}

function arg(name: string, dflt: string | null = null): string | null {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const cmd = process.argv[2];
const seed = Number(arg("seed", "20261001"));
/** 被动档（默认 NOT_EXECUTED）—— 续跑必须连**策略档位**一起还原，不只是数值 */
const passives = String(arg("passives", "NOT_EXECUTED")) as any;

if (cmd === "reference") {
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed, passives });
  const r = await a.battle.run();
  console.log(JSON.stringify({ hash: stateHash(captureState(a.battle)), winner: r.winner, turns: r.turns, reason: r.reason, trace: a.battle.trace.length }));
} else if (cmd === "save") {
  const pauseAt = Number(arg("pause-at", "20"));
  const out = String(arg("out", "tmp-state.json"));
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed, passives });
  await a.battle.runStartup();
  await a.battle.runPartial(pauseAt);
  const st = captureState(a.battle);
  fs.writeFileSync(out, JSON.stringify(st), "utf8");
  console.log(JSON.stringify({ file: out, bytes: fs.statSync(out).size, turn: st.turn, rngN: st.rng.n, pauseHash: stateHash(st), trace: a.battle.trace.length }));
} else if (cmd === "resume") {
  const file = String(arg("in", "tmp-state.json"));
  const st = JSON.parse(fs.readFileSync(file, "utf8")) as BattleState;
  const kit = createKit(bundle);
  /** ★ 反向对照：把兜底拿掉（这条开关存在的意义就是证明兜底是**承重**的，不是装饰） */
  if (process.argv.includes("--no-fallback")) delete (kit as any).statusDefOf;
  const restored = restoreBattle(st, deps(kit) as any);
  const troubles = restoreTroubles(restored);
  await restored.runPartial(Infinity);
  console.log(JSON.stringify({ hash: stateHash(captureState(restored)), winner: restored.winner, turns: restored.turn, reason: restored.endReason, troubles, trace: restored.trace.length }));
} else {
  console.error("用法：node tools/state-cli.ts reference|save|resume [--seed N] [--pause-at K] [--out f] [--in f]");
  process.exitCode = 2;
}
