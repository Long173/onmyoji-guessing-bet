// tools/fidelity-cli.ts — ★★★ 第 127 轮：Per-Match Fidelity 的 **CLI**（目标 ① / ⑧）
//
// 由来：五层报告与「第一处分歧」的**库层**早就有了（kernel/fidelity.ts + kernel/diff.ts + g19/ui10），
//   但**没有任何 CLI** —— 与第 117 轮之前的 Replay 一模一样：能力在，入口不在。
//   而 a1-4 对这两件事给的都是**用法**而不是数据结构（「跑之前先看五层」「与真实观测对照，定位第一处分歧」）。
//
// 用法：
//   node tools/fidelity-cli.ts report [--seed N]          五层 Per-Match Fidelity + 非评价性分类
//   node tools/fidelity-cli.ts diff <观测.json> [--seed N] 与真实观测对照 → 第一处分歧
//
// 观测文件格式（人工记录的最小形态，字段缺省即不比较 —— 见 kernel/diff.ts 的判据）：
//   { "seed": 123456,
//     "alias": { "201": "三尾狐", "301": "日和坊" },
//     "frames": [ { "kind": "DAMAGE", "actor": "三尾狐", "target": "日和坊", "amount": 1234, "hpAfter": 4321 } ] }
//
// ★ 铁律（与 g49 同一条）：报告里**不许**出现任何「真实性百分比」。分类只取四个冻结值之一，理由逐条写。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { createEngineAdapter } from "../../apps/web/src/adapters/engine-adapter.ts";
import { diffTimelines, projectObserved } from "../kernel/diff.ts";
import type { ObsFrame } from "../kernel/diff.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

/** 五层报告：**唯一实现**是 apps/web 的 adapter.validate（这里不再造一份 FidelityInput） */
export async function fidelityReport() {
  const adapter: any = createEngineAdapter(bundle);
  const rep: any = await adapter.validate(canonicalMatch());
  const f = rep.fidelity;
  return { fidelity: f, blockers: rep.blockers ?? [], warnings: rep.warnings ?? [], layers: f?.layers ?? [] };
}

/** 与真实观测对照：返回 { ok, first, summary } —— 观测里没写的字段不比较（diff.ts 的判据） */
export async function diffObserved(filePath: string, seed = 123456, precomputed?: { frames: ObsFrame[]; unobservable?: any[] }) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const frames: ObsFrame[] = raw.frames ?? [];
  const alias = raw.alias ? (v: any) => raw.alias[String(v)] ?? String(v ?? "") : undefined;
  /**
   * ★ 第 127 轮：允许复用**已经跑过的**模拟帧 —— 否则每比一次就重跑一场。
   *   测试要跑 4 次比较，没有这个参数就从"秒级"变成"分钟级"（这条是实现时就量出来的）。
   */
  let sim = precomputed;
  if (!sim) {
    const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: raw.seed ?? seed });
    await a.battle.run();
    const proj = projectObserved(a.battle.trace as any[]);
    sim = { frames: proj.frames as any, unobservable: proj.unobservable ?? [] };
  }
  const d: any = diffTimelines(frames, sim.frames as any, alias ? { alias } : {});
  return { ok: d.ok, first: d.first ?? d.divergences?.[0] ?? null, summary: d.summary, observed: frames.length, simulated: sim.frames.length, unobservable: sim.unobservable ?? [] };
}

const isMain = /[/\\]tools[/\\]fidelity-cli\.ts$/.test(process.argv[1] ?? "");
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n: string) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  if (cmd === "report" || cmd === undefined) {
    const r = await fidelityReport();
    const f: any = r.fidelity;
    if (!f) { console.log("✗ 没有拿到 Fidelity 报告（validate 返回空）"); process.exit(2); }
    console.log("=== Per-Match Fidelity（分类：" + f.klass + "） ===");
    for (const L of f.layers) {
      console.log("\n[" + L.layer + "] " + L.klass);
      for (const c of L.counts ?? []) console.log("   " + c.label + "：" + c.value + (c.note ? "（" + c.note + "）" : ""));
      for (const g of L.gaps ?? []) console.log("   [" + (g.severity ?? "INFO") + "] " + g.what + " —— " + g.detail);
    }
    console.log("\n分类理由：");
    for (const x of f.reasons ?? []) console.log("   · " + x);
    console.log("\n免责声明：");
    for (const x of f.caveats ?? []) console.log("   · " + x);
  } else if (cmd === "diff") {
    const file = rest.find(x => !x.startsWith("--"));
    if (!file) { console.log("用法：node tools/fidelity-cli.ts diff <观测.json> [--seed N]"); process.exit(2); }
    const d = await diffObserved(file, Number(flag("--seed") ?? 123456));
    console.log("=== 与真实观测对照：" + path.basename(file) + " ===");
    console.log("  观测帧 " + d.observed + "｜模拟帧 " + d.simulated + "｜" + (d.ok ? "✓ 未发现分歧" : "✗ 存在分歧"));
    if (d.first) console.log("  第一处分歧：" + JSON.stringify(d.first));
    if (d.summary) console.log("  " + d.summary);
    process.exit(d.ok ? 0 : 1);
  } else {
    console.log("用法：node tools/fidelity-cli.ts report [--seed N]｜diff <观测.json> [--seed N]");
    process.exit(2);
  }
}