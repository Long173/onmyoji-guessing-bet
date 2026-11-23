import path from "node:path";
import { runAll } from "./runner.ts";
import { EXPERIMENTS } from "./definitions.ts";
import { EXPERIMENTS_BCD } from "./groups-bcd.ts";

const all = [...EXPERIMENTS, ...EXPERIMENTS_BCD];
const outDir = path.resolve(import.meta.dirname, "results");
const results = await runAll(all, outDir);

const byGroup: Record<string, { total: number; discriminating: number }> = {};
for (const r of results) {
  byGroup[r.group] ??= { total: 0, discriminating: 0 };
  byGroup[r.group].total++;
  if (r.discriminating) byGroup[r.group].discriminating++;
}
console.log("=== 红区实验台结果 ===");
console.log("实验总数:", results.length);
for (const [g, v] of Object.entries(byGroup)) console.log(`  组 ${g}: ${v.total} 个，其中 ${v.discriminating} 个能区分候选假设`);
const hyp = results.filter(r => r.kind !== "CONFORMANCE");
console.log("可区分比例（仅假设检验类 " + hyp.length + " 个）:", (hyp.filter(r => r.discriminating).length / hyp.length * 100).toFixed(1) + "%");
console.log("官方一致性校验（单假设）:", results.length - hyp.length, "个");
console.log("已确证(RESOLVED):", results.filter(r => r.status === "RESOLVED").length, "  ← 必须做游戏内观测才能变为 RESOLVED");
console.log("输出目录:", outDir);
