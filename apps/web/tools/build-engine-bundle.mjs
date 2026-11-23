// tools/build-engine-bundle.mjs — 把知识库切片打包成浏览器可直接 import 的引擎数据
// 为什么需要：引擎的装载器 compile/load.ts 依赖 node:fs，浏览器无法使用。
// 装配逻辑本身已抽到 compile/character.ts（纯函数），这里只负责把**数据**搬过去。
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const KB = path.join(ROOT, "data", "kb");
const OUT = path.resolve(import.meta.dirname, "..", "src", "engine");
const read = async f => JSON.parse(await fs.readFile(path.join(KB, f), "utf8"));

const shikiRaw = await read("shikigami.full.json");
const ai = await read("ai.json");
const buffs = await read("buffs.json");
const souls = await read("soul.json");
// ★ 第 71 轮：占位符表。[tips_2] 就是「基础概率」—— 被动文案里 721 处占位符全靠它才读得懂，
//   不带上它，"40% [tips_2]" 会被分类器看成"无条件"（第 69 轮踩过）。
// ★★★ 第 101 轮：**desc 也要带上**。原来这里写着"desc 用不到"，那是当时的实情；
//   第 101 轮起编译期要从 tips 的 desc 认出"姿态/化身"类放置单位（生命基准、免疫项、回归时机都写在 desc 里），
//   而网页侧装配用的是**这个 bundle**。只带 id/name 的后果是**静默的**：
//   引擎仓库里的测试（自己读 data/kb/tips.json）解析出 2 条形态，网页侧却是 0 条 ——
//   正是"两条装配路径装了两套不同的运行时"那一类（第 87 轮的教训）。实测抓法见 tests/g62 与 TIPS_NO_DESC 这个跳过原因。
const tipsRaw = await read("tips.json");
const tips = tipsRaw.map(t => ({ id: String(t.id), name: String(t.name ?? ""), desc: String(t.desc ?? "") }));
let onmyojiAI = { profiles: [] };
try { onmyojiAI = await read("onmyoji-ai.json"); } catch { /* 可选 */ }

// 只保留装配真正读取的字段（技能/面板/品阶），丢掉 wiki 原文与标签，体积可减半以上
const shiki = shikiRaw.map(s => ({
  id: Number(s.id), name: s.name, rarity: s.rarity ?? null, year: s.year ?? null,
  grade: s.grade ?? null, gradeRaw: s.gradeRaw ?? null,
  panel: s.panel ?? null,
  skills: (s.skills ?? []).map(k => ({
    id: k.id, name: k.name, cost: k.cost, brief: k.brief ?? "",
    description: k.description ?? "", upgrades: k.upgrades ?? [], tags: k.tags ?? [],
  })),
}));

// 能力覆盖矩阵：Fidelity 的 Mechanic 层要用它把"本局需要的能力"映射到支持度。
// 放进 bundle 而不是让适配器直接 import JSON —— Node 对裸 JSON import 要求 import attributes，
// 而 Vite 不需要；放这里两边都能跑，数据来源也只有一处。
let capabilities = { rows: [], cov: null };
try { capabilities = JSON.parse(await fs.readFile(path.join(ROOT, "battle-lab", "capability", "coverage.json"), "utf8")); } catch { /* 缺了就如实为空 */ }

const bundle = {
  schemaVersion: 1,
  capabilities,
  engineVersion: "battle-lab 0.1-experimental",
  gameDataVersion: "2026-10-01",
  builtAt: new Date().toISOString().slice(0, 10),
  shiki, ai, buffs, souls, onmyojiAI, tips,
};
await fs.mkdir(OUT, { recursive: true });
const file = path.join(OUT, "bundle.json");
await fs.writeFile(file, JSON.stringify(bundle), "utf8");
const kb = (await fs.stat(file)).size / 1024;
console.log("=== 引擎数据包已生成 ===");
console.log(`  文件          src/engine/bundle.json`);
console.log(`  体积          ${kb.toFixed(1)} KB`);
console.log(`  式神          ${shiki.length} 只（技能 ${shiki.reduce((a, s) => a + s.skills.length, 0)} 条）`);
console.log(`  AI 档案       ${ai.length} 条`);
console.log(`  buff 定义     ${buffs.length} 条`);
console.log(`  御魂          ${souls.length} 条`);
console.log(`  阴阳师 AI     ${(onmyojiAI.profiles ?? []).length} 条`);
console.log(`  能力矩阵      ${(capabilities.rows ?? []).length} 条（Fidelity 的 Mechanic 层数据源）`);
console.log(`  原始 KB 对照  ${((await Promise.all(["shikigami.full.json","ai.json","buffs.json","soul.json"].map(async f => (await fs.stat(path.join(KB, f))).size)))).reduce((a,b)=>a+b,0)/1024|0} KB`);
