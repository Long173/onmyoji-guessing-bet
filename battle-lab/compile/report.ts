// compile/report.ts — 编译覆盖率报告 + **人可读的全量 IR 转储**
//
// ★★★ 第 137 轮：转储的生成方式统一到**生产环境**，并在写完后**自检**。
//
// 原来这里用 `compileSkill(id, name, sk)` 直接编，**不装 tips 表**；而生产路径
// （tools/compile-census.ts 的 compileAll）装了。于是同一份 KB 有两条编译产出，
// 其中一条（本文件的转储）有 12 条与生产不一致（形态类 forms / formSkips）。
// 更要命的是：转储是**只写不读**的，所以它与生产产物矛盾也不会报错 ——
// 第 137 轮实测 288_03 的 shield 在转储里还写着修复前的 "maxHp"，
// 谁拿它当证据都会得出与事实相反的结论。详见 tools/ir-dump.ts 与 tests/g91-ir-dump.ts。
import fs from "node:fs/promises";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";
import { compareDump } from "../tools/ir-dump.ts";

const KBdir = path.resolve(import.meta.dirname, "..", "..", "data", "kb");
const shiki = JSON.parse(await fs.readFile(path.join(KBdir, "shikigami.full.json"), "utf8"));
/** ★ 唯一入口：与普查/生产同一套环境（含 tips 表） */
const { input } = compileAll(KBdir);

const allIrs: any[] = [];
const byChar = new Map<string, any[]>();
for (const e of input.skills) {
  const ir = JSON.parse(e.json);
  allIrs.push(ir);
  const cid = String(e.key.split("/")[0]);
  const arr = byChar.get(cid) ?? [];
  arr.push(ir);
  byChar.set(cid, arr);
}

const perChar: any[] = [];
for (const s of shiki) {
  const irs = byChar.get(String(s.id)) ?? [];
  const conf = { HIGH: 0, MEDIUM: 0, LOW: 0 } as any;
  for (const ir of irs) conf[ir.confidence]++;
  const withCore = irs.filter((ir: any) => ir.damage.length || ir.heal.length || ir.shield.length || ir.statusRefs.length || ir.timeline.length).length;
  perChar.push({
    id: s.id, name: s.name, rarity: s.rarity, skills: irs.length, ...conf,
    withCore, aiCast: (s.ai?.cast ?? []).length,
    mechanicWidth: new Set(irs.flatMap((ir: any) => ir.recognized.map((r: string) => r.split(":")[0]))).size,
    irs,
  });
}

const total = allIrs.length;
const byConf = { HIGH: 0, MEDIUM: 0, LOW: 0 } as any;
for (const ir of allIrs) byConf[ir.confidence]++;
console.log("=== 技能编译器 v2 覆盖率 ===");
console.log("技能总数:", total);
for (const k of ["HIGH", "MEDIUM", "LOW"]) console.log(`  ${k}: ${byConf[k]} (${((byConf[k] / total) * 100).toFixed(1)}%)`);

const noCore = allIrs.filter((ir: any) => ir.confidence === "LOW" && !(ir.damage.length || ir.heal.length || ir.shield.length || ir.statusRefs.length || ir.timeline.length)).length;
console.log(`\nLOW 拆分：无机制核心(被动/辅助) ${noCore}  |  有核心但存在未解析机制句 ${byConf.LOW - noCore}`);
console.log("  -> 前者是预期内（纯被动/叙事技能），后者才是人工复核队列");

const ready = perChar.filter(c => c.LOW === 0 && c.withCore > 0);
console.log(`\n=== M1 可装载式神（全部技能 HIGH/MEDIUM）: ${ready.length} / ${perChar.length} ===`);
const ranked = ready.slice().sort((a, b) => (b.withCore + b.mechanicWidth) - (a.withCore + a.mechanicWidth));
console.log("机制覆盖面最广的 15 只：");
for (const c of ranked.slice(0, 15)) {
  console.log(`  ${c.name}(${c.rarity}) id=${c.id} 技能${c.skills} 有核心${c.withCore} 机制宽度${c.mechanicWidth} AI规则${c.aiCast}`);
}

await fs.mkdir(path.resolve(import.meta.dirname, "..", "fixtures"), { recursive: true });
await fs.writeFile(path.resolve(import.meta.dirname, "..", "fixtures", "skill-ir.json"), JSON.stringify(allIrs, null, 1), "utf8");
await fs.writeFile(path.resolve(import.meta.dirname, "..", "fixtures", "char-compile-score.json"), JSON.stringify(perChar.map(({ irs, ...r }) => r), null, 1), "utf8");
await fs.writeFile(path.resolve(import.meta.dirname, "..", "fixtures", "m1-candidates.json"), JSON.stringify(ranked.slice(0, 20).map(({ irs, ...r }) => r), null, 1), "utf8");
console.log("\n已写入 fixtures/skill-ir.json, char-compile-score.json, m1-candidates.json");

/**
 * ★★★ 写完**立刻自检**：转储必须与刚写出去的生产产物逐条一致。
 *   不做这一步的话，转储与产物之间的矛盾只能靠"下一个人恰好去读它"才发现 ——
 *   而它恰恰是一份没人读的文件（第 137 轮的实测就是这么来的）。
 */
const d = compareDump(allIrs, input.skills);
const clean = d.diff.length === 0 && d.missing.length === 0 && d.extra.length === 0 && d.dupInDump.length === 0;
console.log("转储自检：逐字节相同 " + d.same + "/" + input.skills.length + (clean ? " ✓（转储 == 生产产物）" : " ✗"));
if (!clean) {
  console.log("  不同 " + d.diff.length + "｜缺 " + d.missing.length + "｜多 " + d.extra.length + "｜重复键 " + d.dupInDump.length);
  console.log("  样例: " + JSON.stringify([...d.diff.slice(0, 3), ...d.missing.slice(0, 3), ...d.extra.slice(0, 3), ...d.dupInDump.slice(0, 3)]));
  process.exitCode = 1;
}
