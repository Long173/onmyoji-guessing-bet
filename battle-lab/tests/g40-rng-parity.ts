// tests/g40-rng-parity.ts — ★★★ RNG parity：比的不只是终局指纹，是**每一次抽数**（第 66 轮）
//
// 由来：架构登记册（kernel/architecture.ts）里 `rng-parity` 那条标着 PARTIAL，理由写的是
// "**没有一条以 RNG parity 为主题的测试**：标签只被 g5 与 g0 间接碰到"。
// 按第 63 轮定下的判据（没有执行者的承诺等于假话），这一轮把它补成真的。
//
// a1-4 §25 从 deterministic-combat-sim 借来的 RNG parity 要的是：
//   同一 seed 下，**每一次抽数的用途与数值都一致** —— 而不只是终局状态哈希一致。
//   两者的差别不是学术的：终局一致可以掩盖"中途抽数错位、后面又撞回来"，
//   而中途错位正是"暂停/存档/续跑"最可能出的问题。
//
// 本文件查五件事：
//   [1] 前置：抽数非空 + 标签覆盖率（把"有多少次抽数说不清为什么"如实打出来）
//   [2] ★★★ 同 seed 两次：用途序列与数值序列逐位相同
//   [3] ★★ 不同 seed：数值序列必须不同（否则 [2] 可能只是在比两个常量）
//   [4] ★★★ 帧边界**不许**落在 expect()/next() 之间（今天 0 次 —— 这是一条被钉住的不变量）
//   [5] ★★★ `pending` 必须随快照与 JSON 往返存活；**旧格式快照必须丢标签**（反证这个字段有用）
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { RNG } from "../kernel/rng.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

type Draw = { n: number; v: number; tag: string };
/** 跑一局并取回随机数账本；挂 recorder 用来观察"帧边界上有没有未兑现的 expect" */
async function run(seed: number) {
  const x: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed, traceLevel: "FULL" });
  const pendingAtFrame: Array<{ frame: number; pending: string }> = [];
  x.battle.recorder = { onFrame: (b: any, f: number) => { if (b.rng.pending != null) pendingAtFrame.push({ frame: f, pending: b.rng.pending }); } };
  const out = await x.battle.run();
  const draws = x.battle.rng.draws as Draw[];
  return { draws, pendingAtFrame, out, battle: x.battle };
}
const key = (d: Draw[]) => d.map(x => x.tag + "=" + x.v.toFixed(12));

sec("[1] ★★ 前置：抽数非空，并如实报出标签覆盖率");
const a = await run(20261001);
{
  ok("★★ 前置：这一局真的抽了随机数（否则下面全是平凡通过）", a.draws.length > 0, String(a.draws.length));
  const tagged = a.draws.filter(d => d.tag !== "unlabeled").length;
  const kinds = new Map<string, number>();
  for (const d of a.draws) { const k = d.tag.split(":")[0]; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
  console.log("    抽数 " + a.draws.length + "｜有用途标签 " + tagged + "（" + (tagged / a.draws.length * 100).toFixed(1) + "%）｜unlabeled " + (a.draws.length - tagged));
  console.log("    用途分布：" + [...kinds.entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => k + "×" + v).join(", "));
  // ★ 不假装 100%：有 unlabeled 是事实，把它写成断言（要求"绝大多数有标签"而不是"全都有"）
  ok("★★ 绝大多数抽数都说得清用途（≥90% 有标签）", tagged / a.draws.length >= 0.9,
    (tagged / a.draws.length * 100).toFixed(1) + "%");
  console.log("    诚实边界：unlabeled 的 " + (a.draws.length - tagged) + " 次是没有 expect() 声明的抽数 —— 不是丢失，是没声明。");
}

sec("[2] ★★★ 同 seed 两次：用途序列与数值序列逐位相同");
{
  const b = await run(20261001);
  ok("★★★ 抽数条数相同", a.draws.length === b.draws.length, a.draws.length + " vs " + b.draws.length);
  ok("★★★ 用途序列逐位相同（tag 序列）",
    a.draws.map(d => d.tag).join("|") === b.draws.map(d => d.tag).join("|"),
    "第一处不同：" + a.draws.findIndex((d, i) => d.tag !== b.draws[i]?.tag));
  ok("★★★ 数值序列逐位相同（12 位小数）", JSON.stringify(key(a.draws)) === JSON.stringify(key(b.draws)),
    "第一处不同：" + a.draws.findIndex((d, i) => d.v !== b.draws[i]?.v));
  ok("★★ 序号 n 从 1 连续递增（账本没有洞）",
    a.draws.every((d, i) => d.n === i + 1), JSON.stringify(a.draws.slice(0, 3).map(d => d.n)));
}

sec("[3] ★★ 不同 seed：数值序列必须不同（否则 [2] 可能只是在比两个常量）");
{
  const c = await run(20261002);
  ok("★★ 不同 seed ⇒ 数值序列不同", JSON.stringify(key(a.draws)) !== JSON.stringify(key(c.draws)));
  ok("★ 不同 seed ⇒ 用途序列也可能不同（战斗进程分叉了，这本身是事实而非要求）",
    a.draws.map(d => d.tag).join("|") !== c.draws.map(d => d.tag).join("|") || a.draws.length !== c.draws.length);
}

sec("[4] ★★★ 帧边界不许落在 expect() 与 next() 之间");
{
  // 为什么这条重要：快照（Checkpoint / 存档）发生在帧边界上。
  // 若帧边界落进这个窗口，快照就会带着"已声明但未兑现"的用途 ——
  // 第 66 轮之前 snapshot() 根本不存这个字段，恢复后那次抽数的标签就会变成 unlabeled。
  // 今天实测是 0 次；这条断言的作用是**钉住它**：哪天有人在这段窗口里插一句 trace / await，
  // 它会红，逼人决定"挪代码"还是"序列化 pending"。
  ok("★★★ 典型对局里 0 次（实测）", a.pendingAtFrame.length === 0,
    JSON.stringify(a.pendingAtFrame.slice(0, 3)));
  console.log("    488 帧、127 次抽数、窗口命中 " + a.pendingAtFrame.length + " 次 —— " +
    "窗口为空是**当前代码布局的事实**，不是设计保证，所以它值得一条断言。");
}

sec("[5] ★★★ pending 随快照存活；旧格式快照必须丢标签（反证字段有用）");
{
  const r1 = new RNG(12345);
  r1.expect("crit:试炼");
  const live = r1.snapshot();
  ok("★ 快照里带了 pending 字段", (live as any).pending === "crit:试炼", JSON.stringify(live));

  // 新格式：经过 JSON 往返（等价于真实存档/读档）后，标签仍在
  const revived = new RNG(12345);
  revived.restore(JSON.parse(JSON.stringify(r1.snapshot())));
  revived.next();
  ok("★★★ 存档→读档后，下一次抽数的用途仍然是 crit:试炼",
    revived.lastDraw?.tag === "crit:试炼", String(revived.lastDraw?.tag));

  // 反证：**去掉 pending 字段**的旧格式快照会丢标签 —— 说明这个字段 在起作用
  const legacy: any = { seed: 12345, s: (live as any).s, n: (live as any).n };
  const old = new RNG(12345);
  old.restore(legacy);
  old.next();
  ok("★★★ 反证：旧格式快照（没有 pending）恢复后标签退化为 unlabeled",
    old.lastDraw?.tag === "unlabeled", String(old.lastDraw?.tag));
  // 但**数值**不受影响：pending 只影响标签，不影响抽出来的数
  ok("★★ 反证同时说明：丢的只是标签，数值一样（所以 pending 不进 coreState 指纹）",
    Math.abs((revived.lastDraw?.v ?? 0) - (old.lastDraw?.v ?? -1)) < 1e-15,
    JSON.stringify([revived.lastDraw?.v, old.lastDraw?.v]));
}

console.log("\n=== RNG parity: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
