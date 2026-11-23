// tools/check-kb-index.mjs — ★★ 第 170 轮：**图鉴索引 vs 知识库 的一致性闸门**
//
// 风险：改了 data/kb/*.json（知识库）却忘了重建前端索引 —— 界面就会一直显示旧数据，
//   而且**不报错**（第 162 轮那次 has.panel 判据过宽，就是在这条链路上被发现的）。
//   同族的错位在这个项目里出现过四次（stale dist / stale IR 转储 / stale 验收表 / stale 快照），
//   每一处最后都补了一道机械闸门；这一处此前没有。
//
// 用法：node tools/check-kb-index.mjs   （不一致 → 退出 1，并打印前若干条差异与重建命令）
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ONMYOJI = new Set([10, 11, 12, 13, 15, 16]);   // 与 build-kb-index.mjs 同一口径（阴阳师不进图鉴）
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"))
  .filter(s => !ONMYOJI.has(Number(s.id)));
const IDX = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "kb", "shikigami-index.json"), "utf8"));
const FULL_PANEL = (p) => !!(p && (p.atk != null || p.hp != null || p.def != null));

const diffs = [];
if (KB.length !== IDX.length) diffs.push("条数：" + KB.length + " vs " + IDX.length);
const byId = new Map(IDX.map(e => [e.i, e]));
for (const s of KB) {
  const e = byId.get(Number(s.id));
  if (!e) { diffs.push("缺卡片：" + s.id + " " + s.name); continue; }
  const want = { skills: (s.skills ?? []).length, ai: !!s.ai, panel: FULL_PANEL(s.panel) };
  for (const [k, v] of Object.entries(want)) {
    if (e.has?.[k] !== v) diffs.push(s.name + " has." + k + "：" + JSON.stringify(e.has?.[k]) + " vs " + JSON.stringify(v));
  }
  if (e.n !== s.name) diffs.push("名字不一致 #" + s.id + "：" + e.n + " vs " + s.name);
}
for (const e of IDX) if (!KB.some(s => Number(s.id) === e.i)) diffs.push("多出卡片：" + e.i + " " + e.n);

if (diffs.length === 0) {
  console.log("✓ 图鉴索引与知识库一致（" + KB.length + " 只式神 / " + IDX.length + " 张卡片）");
  process.exit(0);
}
console.error("✗ 图鉴索引落后于知识库：" + diffs.length + " 处差异（只列前 12 条）");
for (const d of diffs.slice(0, 12)) console.error("   " + d);
console.error("\n重建：  node apps/web/tools/build-kb-index.mjs");
process.exit(1);
