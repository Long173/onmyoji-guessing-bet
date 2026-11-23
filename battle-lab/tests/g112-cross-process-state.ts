// tests/g112-cross-process-state.ts — ★★★ 第 190 轮：**真的杀掉 Engine**（换进程存档 → 续跑）
//
// a1-4 §55 的字面要求是「暂停战斗 → 保存 state → **杀掉 Engine** → 重新加载 → 可以继续完全相同地战斗」。
// tests/g0-state.ts 验的是**同一个进程内**丢弃实例、用另一份 kit 重建 —— 那挡不住
// 「依赖进程状态」的那一类 bug（模块级单例）。本测试把同一件事放到**子进程**里做：
//   存档只能是一份 JSON，恢复只能靠知识库。
//
// ★ 它当场照出了一个真缺口（本轮修掉）：StatusBook 是模块级单例、此前只在技能执行到某个状态时顺手注册，
//   于是换进程恢复时状态被**静默丢掉**（只留一条 restore:missing-statusdef 的痕），指纹从
//   2d7c7507e18db61f 漂到 a85410dcc35735ea。修法：kit 提供 statusDefOf（按 defId 现编译），
//   restoreBattle 在 StatusBook 落空时用它兜底。★ 第 [5] 节用 --no-fallback 证明这个兜底是**承重**的。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LAB = path.join(ROOT, "battle-lab");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const TMP = path.join(LAB, "tmp-g112");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

/** 在**子进程**里跑 state-cli（真正的「另一个 Engine」），返回它打印的那行 JSON */
function child(args: string[]): any {
  const r = spawnSync(process.execPath, [path.join(LAB, "tools", "state-cli.ts"), ...args], { cwd: LAB, encoding: "utf8" });
  if (r.status !== 0) throw new Error("子进程失败 " + args.join(" ") + "\n" + String(r.stderr).slice(-600));
  return JSON.parse(String(r.stdout).trim().split("\n").pop()!);
}

const SEED = 20261001, PAUSE_AT = 20;

sec("[1] 参照：本进程一口气跑完");
{
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: SEED });
  const r = await a.battle.run();
  const h = stateHash(captureState(a.battle));
  console.log("  参照：winner=" + r.winner + " turns=" + r.turns + " hash=" + h);
  ok("★★★ 参照指纹 = 2d7c7507e18db61f（典型对局默认档，逐位）", h === "2d7c7507e18db61f", h);
  (globalThis as any).REF = { hash: h, winner: r.winner, turns: r.turns, reason: r.reason };
}

sec("[2] 子进程存档（第一个 Engine），本进程在同一个暂停点再存一次");
const savedFile = path.join(TMP, "state.json");
const saved = child(["save", "--seed", String(SEED), "--pause-at", String(PAUSE_AT), "--out", savedFile]);
console.log("  子进程存档：" + JSON.stringify(saved));
ok("★★ 子进程确实停在暂停点（turn=20、还没结束）", saved.turn === PAUSE_AT, JSON.stringify(saved));
ok("★★ 存档是纯 JSON 且落在磁盘上", fs.existsSync(savedFile) && saved.bytes > 2000, String(saved.bytes));
{
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: SEED });
  await a.battle.runStartup();
  await a.battle.runPartial(PAUSE_AT);
  const mine = stateHash(captureState(a.battle));
  console.log("  本进程同点存档指纹=" + mine + "｜子进程=" + saved.pauseHash);
  ok("★★★ 同一个暂停点的存档指纹**与进程无关**（逐位相同）", mine === saved.pauseHash, mine + " vs " + saved.pauseHash);
}


sec("[3] ★★★ 换进程续跑（第二个 Engine）：逐位一致 + 零恢复痕迹");
const resumed = child(["resume", "--in", savedFile]);
console.log("  子进程续跑：" + JSON.stringify(resumed));
const REF = (globalThis as any).REF;
ok("★★★ 续跑终局指纹 == 一口气跑完的指纹（这就是「可以继续完全相同地战斗」）", resumed.hash === REF.hash, resumed.hash + " vs " + REF.hash);
ok("★★★ 而且**零恢复痕迹**（没有 restore:missing-statusdef / NO_RUNTIME 之类）", Array.isArray(resumed.troubles) && resumed.troubles.length === 0, JSON.stringify(resumed.troubles));
ok("★★ 胜者 / 回合数 / 结束原因三项也一致", resumed.winner === REF.winner && resumed.turns === REF.turns && resumed.reason === REF.reason, JSON.stringify({ a: resumed, b: REF }));

sec("[4] ★★★ 反向：这份测试不是空的（篡改一个数值必须照出漂移）");
{
  const st = JSON.parse(fs.readFileSync(savedFile, "utf8"));
  // ★ 篡改**随机数发生器的内部状态**：它决定后面每一次掷数，是最灵敏的「这个存档被改过」探测器
  //   （改生命不一定改结局 —— 第一版就是改 hp，结果终局一模一样，那条断言什么也没测到）
  st.rng.s = (Number(st.rng.s) ^ 0x5bf03635) >>> 0;
  const bad = path.join(TMP, "tampered.json");
  fs.writeFileSync(bad, JSON.stringify(st), "utf8");
  const r2 = child(["resume", "--in", bad]);
  console.log("  篡改后：" + JSON.stringify({ hash: r2.hash, troubles: r2.troubles }));
  ok("★★★ 改了一个单位的生命 ⇒ 终局指纹**不再**等于参照（否则上面几条什么也没测到）", r2.hash !== REF.hash, r2.hash);
}

sec("[5] ★★★ 承重性：把兜底拿掉 ⇒ 同一个存档当场漂移（`--no-fallback`）");
{
  const noFb = child(["resume", "--in", savedFile, "--no-fallback"]);
  console.log("  去掉 statusDefOf：" + JSON.stringify({ hash: noFb.hash, troubles: noFb.troubles }));
  ok("★★★ 拿掉兜底 ⇒ 恢复痕迹非空（状态定义在冷进程里取不到）", Array.isArray(noFb.troubles) && noFb.troubles.length > 0, JSON.stringify(noFb.troubles));
  ok("★★★ 而且终局指纹当场漂移（这就是本轮修掉的那个缺口）", noFb.hash !== REF.hash, noFb.hash + " vs " + REF.hash);
  ok("★★★ 兜底在场时那一条**恰好**不出现（对照：同一份存档、同一个进程类型）", resumed.troubles.length === 0 && noFb.troubles.length > 0);
}

sec("[6] ★★ 反向：默认档指纹仍然逐位不变（本轮的改动不碰默认路径）");
{
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.run();
  ok("★★★ 默认档指纹 2d7c7507e18db61f", stateHash(captureState(a.battle)) === "2d7c7507e18db61f");
  const a2 = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "PARSED_CANDIDATES_ONLY" });
  await a2.battle.runStartup(); await a2.battle.run();
  // ★★★ 第 190 轮：被动档常量 6d7fb675c3d14eaf → **7bc24506bdcd349e**（runStartup 幂等）
  ok("★★★ 被动档指纹 7bc24506bdcd349e", stateHash(captureState(a2.battle)) === "7bc24506bdcd349e");
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log("\n=== 跨进程存档/续跑: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
