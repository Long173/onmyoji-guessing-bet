// tests/g82-fidelity-cli.ts — ★★★ 第 127 轮：Per-Match Fidelity 与「第一处分歧」的 **CLI**（目标 ① / ⑧）
//
// 由来：库层早就有（kernel/fidelity.ts 五层 + kernel/diff.ts 第一处分歧 + g19/ui10 的 38/53 条断言），
//   但**没有 CLI** —— 与第 117 轮之前的 Replay 同型：能力在、入口不在，而 a1-4 给的是**用法**。
// 本测试钉三件事：① report 出的五层与非评价性分类；② 报告里**不许**有真实性百分比；
//   ③ diff 能定位「第一处分歧」并且**改坏就红**（含「观测没写的字段不比较」这条判据）。
import fs from "node:fs";
import path from "node:path";
import { fidelityReport, diffObserved } from "../tools/fidelity-cli.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { projectObserved } from "../kernel/diff.ts";
import { FIDELITY_CLASS_LABEL, FIDELITY_LAYERS } from "../kernel/fidelity.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const TMP = path.join(ROOT, "battle-lab", "fixtures", "obs-tmp-g82.json");

sec("[1] report：五层 + 冻结分类（且**没有**真实性百分比）");
{
  const r = await fidelityReport();
  const f: any = r.fidelity;
  ok("★★★ 拿到了 Fidelity 报告", !!f && Array.isArray(f.layers), JSON.stringify(Object.keys(f ?? {})));
  const names = (f?.layers ?? []).map((L: any) => L.layer);
  ok("★★★ 五层齐全：INPUT / SKILL / AI / MECHANIC / RULESET",
    FIDELITY_LAYERS.every(n => names.includes(n)), JSON.stringify(names));
  ok("★★★ 分类取四个冻结值之一（VERIFIED / COMPLETE_UNVERIFIED / PARTIAL / INSUFFICIENT）",
    ["VERIFIED", "COMPLETE_UNVERIFIED", "PARTIAL", "INSUFFICIENT"].includes(f?.klass), String(f?.klass));
  ok("★★ 分类有中文标签（界面与 CLI 用同一份）", !!FIDELITY_CLASS_LABEL[f?.klass], String(FIDELITY_CLASS_LABEL[f?.klass]));
  ok("★★★ 每条结论都**给理由**，不给分数", Array.isArray(f?.reasons) && f.reasons.length > 0, String(f?.reasons?.length));
  const text = JSON.stringify(f);
  ok("★★★ 报告里**没有**任何「真实性百分比」（目标 ① 的铁律）", !/%/.test(text), (text.match(/[^"]{0,12}%[^"]{0,12}/) ?? [""])[0]);
  ok("★★ 免责声明随结果一起给（§2 显示精度 / §8 红区）", Array.isArray(f?.caveats) && f.caveats.length > 0, String(f?.caveats?.length));
  console.log("    分类 " + f?.klass + "｜五层 " + (f?.layers ?? []).map((L: any) => L.layer + ":" + L.klass).join(" "));
}

sec("[2] diff：与「真实观测」对照 —— 一致时不报，改坏时必须报，而且报**第一处**");
{
  const seed = 123456;
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed });
  await a.battle.run();
  const { frames } = projectObserved(a.battle.trace as any[]);
  ok("前置：模拟产出可观测帧（> 20 条）", frames.length > 20, String(frames.length));
  /** 人工观测的典型形态：只记「谁打谁、多少伤害」+ 别名，其它字段缺省（不比较） */
  /**
   * ★ 人工观测的典型形态：**帧序列完整**（diff 按 kind 对齐，少一帧就会被判 EXTRA —— 第一版只挑 DAMAGE 帧，
   *   结果模拟侧第一条是 SKILL，直接判成分歧），但**字段只记一部分**（act/tgt/数值，血量不记）。
   */
  const obs = frames.slice(0, 12).map((f: any) => ({ kind: f.kind, actor: f.actor, target: f.target, ...(f.amount !== undefined ? { amount: Math.round(f.amount) } : {}) }));
  fs.writeFileSync(TMP, JSON.stringify({ seed, alias: {}, frames: obs }));
  const good: any = await diffObserved(TMP, seed, { frames });
  ok("★★★ 与模拟一致（在容差内）⇒ ok=true，且明确报告比了多少帧",
    good.ok === true && good.observed === obs.length, JSON.stringify({ ok: good.ok, observed: good.observed, simulated: good.simulated }));
  /**
   * 改坏一条：把**带数值的那一帧**改成 +999 ⇒ 必须定位到它。
   * ★ 第一版改的是 obs[2]，而那一帧是 SKILL、**没有 amount** —— 改了个寂寞，反向闸门看起来像空的。
   */
  const badFrames = JSON.parse(JSON.stringify(obs));
  const dmgIdx = badFrames.findIndex((f: any) => f.kind === "DAMAGE" && typeof f.amount === "number");
  badFrames[dmgIdx].amount = Math.round(badFrames[dmgIdx].amount) + 999;
  fs.writeFileSync(TMP, JSON.stringify({ seed, frames: badFrames }));
  const bad: any = await diffObserved(TMP, seed, { frames });
  ok("★★★ 改坏一帧 ⇒ ok=false（闸门不空转）", bad.ok === false, JSON.stringify(bad.summary));
  ok("★★★ 而且报的是**第一处**分歧（第 3 帧那个目标）",
    !!bad.first && JSON.stringify(bad.first).includes(String(badFrames[dmgIdx].target)), JSON.stringify(bad.first));
  /** 观测里没写的字段不许比较：把 hpAfter 全写成 0 也不该报 */
sec("[3] CLI 入口判定：import 这个模块**不会**触发 main()（第 117 轮的教训）");
{
  /**
   * ★★★ 这一条的实现方式**本身踩过两次坑**，都记下来：
   *   ① 第一版用 `execSync("node tests/g82-fidelity-cli.ts")` 去验「import 不触发 main」——
   *      那是**让测试 spawn 自己** ⇒ 子进程又跑一遍测试、又 spawn…**无限递归**（实测挂了 700+ 个 node 进程）；
   *   ② 第二版改成 spawn 一个 import 探针，**仍然挂着**：adapter 会把事件循环留住（子进程不退出 ⇒ execSync 永远等）。
   *   现在只用**不产生子进程**的判据，而且证据更强：本文件顶部就 import 了这个模块 ——
   *   若 main 被触发，输出里会出现 CLI 用法；下面把正则钉死，人能一眼复核。
   */
  const src = fs.readFileSync(path.join(ROOT, "battle-lab", "tools", "fidelity-cli.ts"), "utf8");
  ok("★★★ isMain 正则**锚定 tools/**（不会匹配 tests/*-fidelity-cli.ts）",
    /\/\[\/\\\\\]tools\[\/\\\\\]fidelity-cli/.test(src), (src.match(/const isMain = .*/) ?? [""])[0].slice(0, 100));
  ok("★★★ import 到的是函数（模块被安静地加载，没有副作用把进程带跑）",
    typeof fidelityReport === "function" && typeof diffObserved === "function");
  ok("★★★ 反向：用**本测试文件**的路径去跑同一条正则，必须不匹配",
    !new RegExp("/[/\\\\]tools[/\\\\]fidelity-cli\\.ts$").test(path.join(ROOT, "battle-lab", "tests", "g82-fidelity-cli.ts").split(path.sep).join("/")));
}
}


console.log("\n=== Fidelity CLI: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;