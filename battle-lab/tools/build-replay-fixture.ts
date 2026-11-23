// tools/build-replay-fixture.ts — ★★★ 第 244 轮：**演示局录像**（fixtures/replay-demo-123456.json）的生成与核对
//
// 由来：第 244 轮把规格 §60 的两端（BATTLE_START / BATTLE_END）补进 trace 之后，录像的帧数从 597 变成 599 ——
//   而仓库里那份 fixture 是**签入的**：引擎改了、录像没重生成 ⇒ Theater 的首帧仍写着 ORB_INIT，与规格对不上。
//   这正是这一族（「会旧的产物」）的老毛病，所以配一个**常驻工具**：默认只核对，--write 才写盘。
//
// 用法：
//   node tools/build-replay-fixture.ts          核对（差异逐条打印，非零退出）
//   node tools/build-replay-fixture.ts --write  重新生成
import fs from "node:fs";
import path from "node:path";
import { createEngineAdapter } from "../../apps/web/src/adapters/engine-adapter.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "battle-lab", "fixtures", "replay-demo-123456.json");
const SEED = 123456;
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const adapter = createEngineAdapter(bundle);
const r: any = await adapter.replay(canonicalMatch(), SEED);
const fresh = r.replay;

const before: any = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
const summary = (x: any) => x ? { frames: x.frames?.length ?? 0, finalHash: x.finalHash, checkpoints: x.checkpoints?.length ?? 0, deltas: x.deltas?.length ?? 0, first: x.frames?.[0]?.t ?? null, last: x.frames?.[x.frames.length - 1]?.t ?? null } : null;
console.log("旧：" + JSON.stringify(summary(before)));
console.log("新：" + JSON.stringify(summary(fresh)));
if (before && before.finalHash !== fresh.finalHash) {
  console.log("★★★ 终局指纹变了（" + before.finalHash + " → " + fresh.finalHash + "）—— 这不是重生成，是行为变了，必须先解释");
  process.exit(2);
}
const write = process.argv.includes("--write");
if (write) {
  fs.writeFileSync(OUT, JSON.stringify(fresh, null, 1) + "\n", "utf8");
  console.log("已写出 " + path.relative(ROOT, OUT) + "（帧 " + (summary(before)?.frames ?? 0) + " → " + fresh.frames.length + "，终局指纹不变）");
} else {
  const same = JSON.stringify(before) === JSON.stringify(fresh);
  console.log(same ? "录像与当前引擎逐字节一致 ✓" : "★ 录像已过期（与当前引擎不一致）—— 用 --write 重生成，并在报告里记一笔");
  process.exit(same ? 0 : 1);
}