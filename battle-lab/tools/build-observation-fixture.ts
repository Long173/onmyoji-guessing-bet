// tools/build-observation-fixture.ts — ★★★ 第 247 轮：**观测对照的「一致路径」也要有正例**
//
// 由来：G6（目标 ⑧）缺的是**游戏内观测**（外部输入），但仪器本身的两条路径应当先自证：
//   · 「有分歧」那条有例子（fixtures/observations-demo-ok.json，第 222 轮实测已过期/分歧）；
//   · **「一致」那条一个例子都没有** —— 也就是说，就算明天有人拿来一份正确的观测，
//     我们也没有任何证据表明 diff 会判它"一致"（而不是把一切都报成分歧）。
//
// 这个工具生成一份**合成观测**：把模拟器自己的投影（kernel/diff.ts 的 projectObserved）当成观测写下来。
//   ★ 它**不是真实性证据** —— 它是仪器的**自检夹具**：证明 diff 在"观测 == 模拟"时确实返回 ok。
//     真实观测定稿必须来自游戏（见报告 §52 的验收方法）。
//
// 用法：
//   node tools/build-observation-fixture.ts          核对（与当前引擎的投影比对，过期则非零退出）
//   node tools/build-observation-fixture.ts --write  重新生成
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { projectObserved } from "../kernel/diff.ts";
import { diffObserved } from "./fidelity-cli.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "battle-lab", "fixtures", "observations-demo-match.json");
const SEED = 123456;
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: SEED });
await a.battle.run();
const proj = projectObserved(a.battle.trace as any[]);
const doc = {
  note: "**合成夹具**（由模拟器自己的投影生成，seed 123456）：只用来证明 diff 的**一致路径**可用 —— 它不是真实性证据；真实观测必须来自游戏内（报告 §52）。生成器 tools/build-observation-fixture.ts。",
  seed: SEED,
  synthetic: true,
  frames: proj.frames,
};

const before = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
console.log("投影帧数：" + proj.frames.length + "（不可观测项 " + (proj.unobservable ?? []).length + "）");
if (before) console.log("已有夹具帧数：" + (before.frames?.length ?? 0) + "｜逐字节相同 = " + (JSON.stringify(before.frames) === JSON.stringify(doc.frames)));
const write = process.argv.includes("--write");
if (write) {
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + "\n", "utf8");
  console.log("已写出 " + path.relative(ROOT, OUT));
} else if (before && JSON.stringify(before.frames) !== JSON.stringify(doc.frames)) {
  console.log("★ 夹具已过期（与当前引擎的投影不一致）—— 用 --write 重生成");
  process.exit(1);
} else if (!before) {
  console.log("★ 夹具不存在 —— 用 --write 生成");
  process.exit(1);
} else {
  console.log("夹具与当前引擎的投影逐字节一致 ✓");
}

/** ★ 自证：把这份夹具喂回 diff，必须判"一致"（否则工具在造一份自己都过不了的观测） */
const d: any = await diffObserved(OUT, SEED);
console.log("diff 裁决：ok=" + d.ok + "｜首处分歧=" + (d.first ? JSON.stringify(d.first).slice(0, 120) : "无") + "｜观测 " + d.observed + " 帧 / 模拟 " + d.simulated + " 帧");
if (!d.ok) { console.log("★★★ 合成夹具竟然与模拟不一致 —— 这是工具自己的问题，必须修"); process.exit(2); }