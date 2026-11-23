// tools/build_submit.mjs — 把项目打包成「网页端 AI 可读」的少量大文件
// 原则：可运行性无所谓；**能被读完**才是关键。按 token 分层，原始 JSON 只留摘要。
//
// 【apps/web 收录与排除】（M1.8 网页工作台）
//   收录  apps/web 下的 .ts / .vue / .mjs / .json / .css / .html 源码
//   排除  ① node_modules/、dist/、.vite/ 等构建目录
//         ② 生成物：src/kb/*.json、src/engine/bundle.json、npm 的 package-lock.json
//         ③ 任何单个文件 > 200 KB
//   处理  .vue 只保留 <script> 与 <template>，<style> 段整段剔除（纯样式，对阅读逻辑无用）
//   去向  被排除的生成物只在 04-数据摘要.md 里描述 schema 与体积，绝不整份塞进来
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "submit");
const BL = path.join(ROOT, "battle-lab");
const KB = path.join(ROOT, "data", "kb");
const WEB = path.join(ROOT, "apps", "web");

// 反引号：在模板字符串里写 markdown 要转义两层，统一从这里取
const BT = String.fromCharCode(96);

/** CJK 约 1 token/字；ASCII 约 3.5 字符/token */
export function estTokens(t) {
  let cjk = 0, other = 0;
  for (const ch of t) { if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) cjk++; else other++; }
  return Math.round(cjk + other / 3.5);
}
const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
const kb = n => (n / 1024).toFixed(0) + " KB";

function isLocalJunk(name) {
  return name.startsWith("_") || name.startsWith("tmp-") || name === "node_modules"
    || name === "dist" || name === ".vite" || name === "coverage";
}

/** 公开快照不得带本机绝对路径或第三方本地安装路径 */
function sanitize(t) {
  return t
    .replace(/E:\\py\\maayys\\阴阳师对战模拟/gi, ".")
    .replace(/E:\/py\/maayys\/阴阳师对战模拟/gi, ".")
    .replace(/E:\\py\\maayys\\MaaYYs-windows-x64-v[\d.]+/gi, "MaaYYs")
    .replace(/C:\\Users\\[^\s"'`]+/gi, "<user-home>");
}

async function walk(d, acc = []) {
  for (const e of await fs.readdir(d, { withFileTypes: true })) {
    if (e.name.startsWith(".") || isLocalJunk(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) await walk(p, acc); else acc.push(p);
  }
  return acc;
}
const read = p => fs.readFile(p, "utf8");
const code = s => BT + s + BT;                        // markdown 内联代码
const sizeOf = async p => { try { return (await fs.stat(p)).size; } catch { return 0; } };

/** 用足够长的围栏包住代码块（源码里可能出现连续反引号，会提前闭合围栏） */
function block(lang, text) {
  const runs = text.match(new RegExp(BT + "{3,}", "g")) ?? [];
  const fence = BT.repeat(runs.length ? Math.max(...runs.map(s => s.length)) + 1 : 3);
  return fence + lang + "\n" + text + (text.endsWith("\n") ? "" : "\n") + fence + "\n";
}

// ==================== apps/web 收录规则 ====================
const WEB_SKIP_DIRS = new Set(["node_modules", "dist", ".vite", "coverage"]);
const WEB_MAX_BYTES = 200 * 1024;
/** 生成物：由 apps/web/tools/*.mjs 或 npm 产出，只在 04 里描述，不整份收录 */
const isWebGenerated = r =>
  /^src\/kb\/.+\.json$/.test(r) || r === "src/engine/bundle.json" || r === "package-lock.json";
/** .vue 只留 <script> 与 <template>；<style> 换成一行占位标记 */
const slimVue = t => t.replace(/<style\b[^>]*>[\s\S]*?<\/style>[ \t]*\r?\n?/g,
  m => "<!-- <style> 已省略 " + kb(Buffer.byteLength(m)) + "（纯样式，无逻辑） -->\n");
const langOf = r => r.endsWith(".vue") ? "vue" : r.endsWith(".ts") ? "ts" : r.endsWith(".mjs") ? "js"
  : r.endsWith(".json") ? "json" : r.endsWith(".css") ? "css" : r.endsWith(".html") ? "html" : "text";
/** 阅读顺序：入口 → 契约 → 引擎装配 → 适配器 → Worker → store → 组件 → 测试 → 脚本 */
const WEB_ORDER = ["index.html", "package.json", "vite.config.ts", "tsconfig.json",
  "src/main.ts", "src/App.vue", "src/contracts/", "src/engine/", "src/adapters/", "src/workers/",
  "src/stores/", "src/mock/", "src/kb/", "src/components/", "src/styles/", "tests/", "tools/"];

async function collectWeb() {
  const kept = [], skipped = [];
  async function rec(d) {
    const ents = await fs.readdir(d, { withFileTypes: true });
    for (const e of ents.sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".") || isLocalJunk(e.name) || WEB_SKIP_DIRS.has(e.name)) continue;
      const p = path.join(d, e.name);
      const r = path.relative(WEB, p).replace(/\\/g, "/");
      if (e.isDirectory()) { await rec(p); continue; }
      if (!/\.(ts|vue|mjs|js|json|css|html)$/.test(r)) { skipped.push([r, "非源码后缀"]); continue; }
      if (isWebGenerated(r)) { skipped.push([r, "生成物"]); continue; }
      const size = await sizeOf(p);
      if (size > WEB_MAX_BYTES) { skipped.push([r, "> 200 KB"]); continue; }
      kept.push({ p, r, size });
    }
  }
  await rec(WEB);
  kept.sort((a, b) => {
    const ia = WEB_ORDER.findIndex(o => a.r === o || a.r.startsWith(o));
    const ib = WEB_ORDER.findIndex(o => b.r === o || b.r.startsWith(o));
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.r.localeCompare(b.r);
  });
  return { kept, skipped };
}

await fs.mkdir(OUT, { recursive: true });
const manifest = [];

// ---------- 01 项目总览 ----------
const OVERVIEW = `# 01 · 项目总览

## 一句话

给《阴阳师》**对弈竞猜**做战斗模拟器：输入双方各 5 只式神的截图八维面板与御魂，用高保真离散事件战斗引擎跑 Monte Carlo，输出双方胜率与置信区间。

现在有两个入口：命令行（\`battle-lab/\`）与**网页工作台**（\`apps/web/\`，里程碑 M1.8）。

## 项目结构

\`\`\`
阴阳师对战模拟/
├─ battle-lab/              引擎：零第三方依赖，Node ≥22 原生类型擦除即可直接运行
│  ├─ kernel/  soul/        战斗内核：事件、时间轴、资源、状态、伤害、御魂系统
│  ├─ compile/              AI 释放逻辑 → 可执行规则
│  ├─ runner/  dummy/       Monte Carlo 跑批 / Dummy 对战台
│  ├─ capability/           48 类技能 tag 的引擎覆盖度
│  ├─ experiments/          44 个红区实验的定义与结果
│  └─ fixtures/  tests/     黄金夹具与验收
├─ apps/web/                ★ 网页工作台（Vue 3 + Vite + Pinia，M1.8 Prediction Workbench）
│  ├─ src/contracts/        三份冻结契约：guessing-match / simulation-result / worker-api
│  ├─ src/engine/           assemble.ts（浏览器侧对局装配，复用 battle-lab/compile）+ bundle.json（生成物）
│  ├─ src/adapters/         engine-adapter（真引擎）/ mock-adapter / simulate（接口）
│  ├─ src/workers/          protocol.ts（可测的 Worker 协议）+ simulation.worker.ts（线程胶水）
│  ├─ src/stores/           Pinia store —— 只存 DTO，不 import 引擎
│  ├─ src/components/       lineup / simulation / knowledge / mechanics / result / common
│  ├─ src/kb/               useKb.ts + 生成的 *.json 索引
│  ├─ tests/                ui0 / ui1 / ui2 / ui5 / ui7 / e2e-workflow（Node 直接跑，无需浏览器）
│  └─ tools/                KB 索引与引擎数据包的生成脚本
├─ data/kb/                 知识库 12 张表（2.8 MB 原始 JSON）
├─ tools/                   构建脚本：build_kb / build_submit / build_submit_index …
├─ submit/                  ★ 本包：给网页端 AI 读的 Markdown 快照
└─ 02~09-*.md               9 份主报告
\`\`\`

**前端唯一允许碰引擎的地方**是 \`src/adapters/\` 与 \`src/workers/\`（vite alias \`@engine\` → \`battle-lab/\`）；
页面与 store 只能依赖 \`src/contracts/\` 与 KB 索引 —— 这条已经写成 UI-1 的验收断言，不是口头约定。

> 「零第三方依赖」只约束 **battle-lab 引擎**；\`apps/web\` 允许 vue / pinia / vite / pinyin-pro。

## 输入边界（已钉死）

\`\`\`
红方 5 × (式神ID + 八维面板 + 御魂图标)
蓝方 5 × (式神ID + 八维面板 + 御魂图标)
= 10 个身份 + 80 个面板值 + 10 个御魂身份
\`\`\`

技能 / 满技能 / 觉醒 / AI / Buff / 御魂机制**不随输入提供**，全部按 id 从知识库自动关联。

## 三条已冻结的架构决定

### 1. 面板来源三分，模式语义决定合法性

| | 对弈竞猜 | 完整养成 |
|---|---|---|
| 面板来源 | \`AUTHORITATIVE_OVERRIDE\`（截图即真值） | \`BASE + EQUIPMENT\`（六件御魂生成） |
| 御魂**静态**属性 | ❌ **绝不应用** | ✅ 应用 |
| 御魂**战斗**效果 | ✅ 加载 | ✅ 加载 |
| 合法性 | 任意面板 \`ACCEPT\` | 不可解释 → \`IMPOSSIBLE_BUILD\` |

**为什么关键**：竞猜面板已是装备结算后的终值。若再叠加 2 件套（如无刀取暴伤 +20%），
会把 164% 变成 184% —— 系统性偏高。已写成运行期抛错的不变量。

### 2. 数值三层，禁止中间取整

\`\`\`
御魂原始精度（防御+4.08 / 暴击+13.78%）
   ↓
ExactStats（参与战斗计算，不取整）
   ↓
DisplayStats（界面整数：2957 / 180 / 28%）
\`\`\`

全项目**唯一**取整入口是 \`kernel/gamemath.ts\`，并有 \`tools/lint-rounding.ts\` 强制护栏。
截图整数不坍缩：保留 \`feasibleRange\`，例如显示 180 对应 \`[179.5, 180.5)\`。

**为什么关键**：两个都显示"速度 180"的单位，真实值可能是 180.42 与 180.11 ——
先后关系被显示精度决定，而先手直接影响胜负。这是本项目已经踩过一次的坑。

### 3. 红区策略化，不允许靠猜测补值

四个未实测的机制参数全部做成**可切换策略**，每个都带
\`status: UNKNOWN | HYPOTHESIS | VERIFIED\`，任何模拟产物强制携带策略快照与警示：

\`\`\`
⚠️ 存在 UNKNOWN 策略时，本产物的数值不构成机制结论
\`\`\`

## 当前状态

### 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M0** | Empty Battlefield：不加载任何真实式神，纯 Dummy 跑通全环节 | ✅ 34/34 |
| **M1** | First Real Shikigami：真实数据装载 + AI 编译 + 端到端 | ✅ 23/23 |
| **M1.5** | Exact Stat & Soul System + 竞猜/养成分层 | ✅ 15/15 + 7/7 + 9/9 |
| **M1.8** | **Prediction Workbench**：把引擎搬进浏览器，UI-0 ~ UI-6 七个 Sprint | ✅ 七个 Sprint 均已落地，370 条前端验收 + 111 条引擎验收全绿 |
| **M2** | 红区实验游戏内观测 → 策略转 VERIFIED | ⏳ 待实测（仪器就是 M1.8 的工作台） |
| **M2.5** | 截图识别 → 自动填充工作台 | ⏳ 未开始 |

### M1.8 · 七个 Sprint

| Sprint | 目标 | 落地位置 | 验收 |
|---|---|---|---|
| **UI-0** | DTO + Worker 契约 + mock 数据（UI 不依赖 Kernel 内部类型） | \`src/contracts/\` \`src/workers/protocol.ts\` \`src/adapters/mock-adapter.ts\` | ✅ 28/28 |
| **UI-1** | 红蓝阵容编辑器（10 只式神 + 八维 + 御魂） | \`src/components/lineup/\` \`src/stores/match.ts\` | ✅ 63/63 |
| **UI-2** | 真 Engine 接入（100 / 1k / 10k 局，不阻塞 UI） | \`src/workers/simulation.worker.ts\` \`src/adapters/engine-adapter.ts\` \`src/engine/assemble.ts\` | ✅ 37/37 |
| **UI-3** | 结果 Dashboard：胜率 / Wilson CI / 超时 / Coverage / UNKNOWN | \`src/components/result/ResultDashboard.vue\` | ✅ 由 ui2 + e2e 覆盖 |
| **UI-4** | Seed Replay：任意代表局逐事件回放 + Event Inspector | \`src/components/result/ReplayViewer.vue\` | ✅ 由 ui2 [6] + e2e 步骤 8 覆盖 |
| **UI-5** | Knowledge + Lab：式神/AI/御魂图鉴 + 44 个红区实验 | \`src/components/knowledge/\` \`src/components/mechanics/\` \`src/kb/useKb.ts\` | ✅ 77/77 |

| **UI-6** | Developer HUD（引擎内部状态 / 实测事实清单 / 文件地图）+ 实验台**观测登记** | src/components/dev/DeveloperHud.vue · src/lab/observations.ts · src/dev/facts.ts | ✅ 96/96 |
跨 Sprint 的**十条 UX 护栏**（换边对称 / UNKNOWN 永不隐藏 / 竞猜禁止六件御魂编辑器 /
静态属性禁止重复应用 / Unsupported 开跑前显示 / 版本随结果保存 / seed 可 replay /
错误局不进分母 / 两类不确定性分开 / 草稿自动保存）也已经逐条落成断言：
\`tests/ui7-guardrails.ts\`。

前端验收共 7 个脚本，**Node 直接跑、无需浏览器**，合计 **370 条断言全部通过**（本包生成时的实测结果）：

\`\`\`
ui0-contracts.ts   28 通过 / 0 失败    契约 + Worker 协议 + mock 链路
ui1-editor.ts      63 通过 / 0 失败    阵容编辑器（含「组件不得 import 引擎」的静态断言）
ui2-engine.ts      37 通过 / 0 失败    真引擎接入（含浏览器路径 vs Node 路径同构校验）
ui5-knowledge.ts   77 通过 / 0 失败    知识库页 + 机制实验台
ui7-guardrails.ts  35 通过 / 0 失败    十条 UX 护栏逐条证据（真引擎跑 2×1000 局做换边对称）
e2e-workflow.ts    32 通过 / 0 失败    §30 端到端，默认 N=10000 局真模拟，约 20 s
\`\`\`

其中最关键的两条**不是功能测试而是正确性护栏**（另有十条 UX 护栏见上）：

- **同构校验**：浏览器侧 \`assemble.ts\` 与 Node 侧 \`battle-lab/compile\` 跑同一 seed 必须给出同一结果；
- **面板语义**：竞猜路径下 UI 传入的面板绝不叠加御魂静态属性（契约层再钉一次）。

**M1.8 不新增任何模型能力**：它只是把已经冻结的引擎与知识库搬进浏览器，
所以下面的「当前边界」与 M1.5 完全一致 —— 界面会显式标注 UNKNOWN，不会把假设当结论。

## 核心设计决定（每条都有官方或规格书依据）

| 决定 | 依据 |
|---|---|
| **5 种伤害类型** NORMAL / INDIRECT / CONDUCTION / TRUE / FIXED（+形毁） | 官方术语 [5][12][18][28] |
| **HP 变更四条独立管线** DAMAGE / LOSS / HEAL / RECOVER | 官方 [21] 失去≠伤害；[20] 恢复≠治疗 |
| **泛鬼火** 鬼火/愿力/义火，统一走 \`resources.pay()\` | 官方 [26] |
| **状态 5 分类** | 官方 [25] |
| **驱散 ≠ 解除** \`dispel()\` 看 dispellable，\`remove()\` 看 removable | 官方 [3][8][1] |
| **回合四类型** NORMAL/NEW/PSEUDO/SKILL_RESOLUTION | 规格书 + 社区研究 |
| **速度 ≠ 拉条** 属性走 effects，位置走 timeline.shift() | 官方 [117] 缚足 |
| **HP<=0 ≠ DEAD ≠ KILLED** 三字段独立 | 官方 [3252][3342] |
| **状态计时按来源回合** | 官方 [15] |
| **对弈竞猜不含阴阳师** | 用户确认，规则 \`GUESSING_NO_ONMYOJI\` |

## 关键数字

| 项 | 结果 |
|---|---|
| 式神图鉴 | **276 只 = 100%**（两独立来源交叉验证）；面板 276/276；技能 276/276（798 条） |
| AI 释放逻辑 | 272/276；规则编译 580/744，**真正不可量化仅 4 条（0.5%）** |
| 官方术语词典 | 156 条（98 条核心规则，游戏内 tooltip 原文） |
| 御魂 | 70 条（核验 0 遗漏） |
| 面板公式 | 用 679 条真实竞猜面板反推并验证（Golden Test 7/7） |
| 红区实验台 | 44 个实验（**42 个可判别**，B08/B10 的候选假设在观测上不可区分）；红区状态 UNKNOWN 7 / HYPOTHESIS 11 / **VERIFIED 0** |
| 引擎能力覆盖 | 58.3%（对照游戏自身 48 类技能 tags：FULL 20 / PARTIAL 16 / NONE 12） |
| 网页工作台 | 7 个 Sprint（UI-0~UI-6）、13 个 .vue 组件、**17 个验收脚本 / 772 条断言全绿**（M1.9 后按实跑更正：7/370 是 M1.8 时代的数字） |
| 工作台无法自动化的部分 | §30 的浏览器点击级 E2E（项目零依赖，未装 Playwright）；已验证的是同一条调用链，仅线程边界不同 |

## 已修复的两个会污染全部结论的 bug

1. **镜像不对称**：\`SPEED_THEN_RANDOM\` 名为随机实则从未随机 → 同速并列恒判红方，
   镜像胜率 86.7%；修后 50.3%。已固化为不变量断言（镜像 95% CI 必须覆盖 50%）。
2. **竞猜重复计算御魂静态属性**（见上）—— 已固化为运行期抛错。

## 当前边界

> **模拟器能跑，但产出的胜率目前不可用于下注。**
> 三个红区仍是 UNKNOWN。待实测项只有 4 个，都已做成可判别实验：
> ① 开局结算顺序 ② 同时触发优先级 ③ 死亡/转化/复活状态机 ④ 对弈竞猜残局规则
>
> 网页工作台把这件事变得可见：结果面板顶部会挂 UNKNOWN 警示，
> 机制实验台直接列出每个红区的状态与 44 个可判别实验 —— 它是 M2 的实验仪器，不是「前端美化」。
>
> **M1.9 之后这一层更细了**：battle-lab/tools/fidelity-cli.ts report 会把本局拆成 INPUT / SKILL / AI / MECHANIC / RULESET 五层，
> 给出**非评价性**的 Simulation Fidelity Class（VERIFIED / COMPLETE_UNVERIFIED / PARTIAL / INSUFFICIENT），并明确**不给「真实性百分比」**——
> 能力覆盖率与编译率都不许线性映射成真实性。十二项目标各自的守门人与最近实跑结果见 02 的 §172。
> 三件可跑仪器（都在 battle-lab/tools/）：fidelity-cli.ts report|diff（保真度 / 与真实观测对照找第一处分歧）·
> replay-cli.ts run --out f 然后 verify f（逐帧回放校验，597 帧零不一致）· state-cli.ts save|resume（暂停存档 → 换进程续跑，指纹逐位相同）。
`;
await fs.writeFile(path.join(OUT, "01-项目总览.md"), OVERVIEW, "utf8");
manifest.push({ f: "01-项目总览.md", desc: "一页看懂项目（建议必传）" });

// ---------- 02 研究报告（7 份主报告合并）----------
const MAIN = ["02-源码考古与复用矩阵.md", "03-知识库建设报告.md", "04-BattleRulesDB-v0.md",
  "05-阴阳师数据考古报告.md", "06-M1.5-ExactStat-SoulSystem.md",
  "07-M1.5-竞猜路径与完整御魂系统分层.md", "08-典型对局001.md",
  "09-M1.8-预测工作台.md",
  "10-M1.9-全局战斗与真实性体系.md"];
let buf = "# 02 · 研究报告合集（9 份主报告）\n\n";
buf += "> 按项目推进顺序排列。**想最快理解，先读 §09（当前工作台）→ §08 → §04。**\n\n---\n\n";
for (const f of MAIN) {
  const t = sanitize(await read(path.join(ROOT, f)));
  buf += "\n<!-- ===== 源文件：" + f + " ===== -->\n\n" + t.replace(/^# /, "## ") + "\n\n---\n\n";
}
await fs.writeFile(path.join(OUT, "02-研究报告.md"), buf, "utf8");
manifest.push({ f: "02-研究报告.md", desc: "9 份主报告（强烈建议传）" });

// ---------- 03 源码汇编（battle-lab 引擎）----------
const tsFiles = (await walk(BL)).filter(f => f.endsWith(".ts")).sort();
const order = ["kernel/", "soul/", "compile/", "runner/", "capability/", "experiments/", "dummy/", "tests/", "tools/"];
tsFiles.sort((a, b) => {
  const ra = path.relative(BL, a).replace(/\\/g, "/"), rb = path.relative(BL, b).replace(/\\/g, "/");
  const ia = order.findIndex(o => ra.startsWith(o)), ib = order.findIndex(o => rb.startsWith(o));
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || ra.localeCompare(rb);
});
let src = "# 03 · 源码汇编（引擎）\n\n";
src += "> \`battle-lab/\` 共 " + tsFiles.length + " 个 TypeScript 文件。**零第三方依赖**，Node ≥22 原生类型擦除即可直接运行。\n";
src += "> 只使用可擦除语法（无 enum / 无 namespace / 无参数属性）。\n";
src += "> 网页工作台的源码（\`apps/web/\`）在 **06-网页前端源码**；这里只有引擎。\n\n";
src += "## 文件清单\n\n";
for (const f of tsFiles) src += "- " + code(path.relative(BL, f).replace(/\\/g, "/")) + "\n";
src += "\n---\n\n";
for (const f of tsFiles) {
  const r = path.relative(BL, f).replace(/\\/g, "/");
  src += "\n### " + code("battle-lab/" + r) + "\n\n" + block("ts", sanitize(await read(f)));
}
await fs.writeFile(path.join(OUT, "03-源码汇编.md"), src, "utf8");
manifest.push({ f: "03-源码汇编.md", desc: "引擎全部 .ts（想让它改引擎就传）" });

// ---------- 04 数据摘要 ----------
let sum = "# 04 · 知识库摘要\n\n";
sum += "> 原始 JSON 共 2.8 MB（约 90 万 token），不适合直接提交。\n";
sum += "> 本文件给出**每张表的 schema、记录数、统计与真实样本**，足以让 AI 理解数据结构。\n\n";
const kbFiles = (await fs.readdir(KB)).filter(f => f.endsWith(".json")).sort();
sum += "| 文件 | 记录数 | 顶层结构 |\n|---|---:|---|\n";
const details = [];
for (const f of kbFiles) {
  let j; try { j = JSON.parse(await read(path.join(KB, f))); } catch { continue; }
  const isArr = Array.isArray(j);
  const n = isArr ? j.length : Object.keys(j).length;
  const top = isArr ? "数组[" + n + "]" : "对象{" + Object.keys(j).slice(0, 6).join(", ") + (Object.keys(j).length > 6 ? "…" : "") + "}";
  sum += "| " + code(f) + " | " + n + " | " + top + " |\n";
  const sample = isArr ? j.slice(0, 2) : j;
  const fields = isArr && j[0] && typeof j[0] === "object" ? Object.keys(j[0]).join(", ") : "";
  details.push({ f, n, isArr, fields, sample: JSON.stringify(sample, null, 1) });
}
sum += "\n---\n\n";
for (const d of details) {
  sum += "## " + code(d.f) + "（" + d.n + " 条）\n\n";
  if (d.fields) sum += "字段：" + code(d.fields) + "\n\n";
  const s = d.sample.length > 2200 ? d.sample.slice(0, 2200) + "\n  …（截断）" : d.sample;
  sum += block("json", s) + "\n";
}
// 覆盖率关键统计
const shiki = JSON.parse(await read(path.join(KB, "shikigami.full.json")));
const OMY = new Set([10, 11, 12, 13, 15, 16]);
const sk = shiki.filter(s => !OMY.has(Number(s.id)));
sum += "---\n\n## 覆盖率关键统计\n\n";
sum += "- 式神总数：**" + sk.length + "**（另有 6 个阴阳师/英杰，已确认不参与对弈竞猜）\n";
sum += "- 属性面板：**" + sk.filter(s => s.panel).length + "/" + sk.length + "**\n";
sum += "- 技能条目：**" + sk.reduce((a, s) => a + (s.skills ?? []).length, 0) + "**，空描述 0 条\n";
sum += "- AI 条目：**" + sk.filter(s => s.ai).length + "/" + sk.length + "**（缺的 4 只均为 2026 最新式神）\n";
const rar = {}; for (const s of sk) rar[s.rarity ?? "?"] = (rar[s.rarity ?? "?"] ?? 0) + 1;
sum += "- 稀有度分布：" + code(JSON.stringify(rar)) + "\n";
sum += "- 年份跨度：2016–2026\n";

// ---- 网页端生成物：只描述 schema 与体积，绝不整份收录 ----
/** 生成物结构摘要：数组给条数与字段，对象给键名 + 子表条数 */
async function shapeOf(p) {
  const size = await sizeOf(p);
  if (!size) return null;
  let shape = "（非 JSON / 无法解析）";
  try {
    const j = JSON.parse(await read(p));
    if (Array.isArray(j)) {
      shape = "数组[" + j.length + "]，字段 " + code(Object.keys(j[0] ?? {}).join(", "));
    } else {
      const keys = Object.keys(j);
      const numeric = keys.length > 0 && keys.every(k => /^\d+$/.test(k));
      shape = "对象{" + keys.length + "}";
      shape += numeric
        ? "，键=数字 id，值字段 " + code(Object.keys(j[keys[0]] ?? {}).join(", "))
        : "：" + keys.slice(0, 10).map(code).join(" ") + (keys.length > 10 ? " …" : "");
      const subs = keys.filter(k => Array.isArray(j[k])).map(k => code(k + "[" + j[k].length + "]"));
      if (subs.length) shape += "；子表 " + subs.join(" ");
    }
  } catch { /* 保持「无法解析」 */ }
  return { size, shape };
}
const WEB_GEN = [
  ["src/engine/bundle.json", "引擎数据包：编译好的浏览器侧知识库切片，Worker 启动时一次加载。重建：node apps/web/tools/build-engine-bundle.mjs"],
  ["src/kb/shikigami-detail.json", "式神详情（技能原文 + AI），点开图鉴抽屉时按 id 懒加载。重建：node apps/web/tools/build-kb-index.mjs"],
  ["src/kb/experiments.json", "红区实验索引：44 个实验 + 18 个红区 + 48 项能力覆盖度。重建：node apps/web/tools/build-experiments-index.mjs"],
  ["src/kb/shikigami-index.json", "式神精简索引（列表页与选择器用）。重建：node apps/web/tools/build-kb-index.mjs"],
  ["src/kb/soul-index.json", "御魂索引（含 2 件套静态加成与引擎支持度）。重建：node apps/web/tools/build-kb-index.mjs"],
  ["src/kb/glossary.json", "官方术语表（游戏内 tooltip 原文）。重建：node apps/web/tools/build-kb-index.mjs"],
  ["package-lock.json", "npm 锁文件 —— 生成物，对理解项目没有价值，不收录"],
];
sum += "\n---\n\n## 网页端生成物（\`apps/web/\`，**不收录**，只描述）\n\n";
sum += "> 这几个文件合计约 1.4 MB，是**生成物**不是源码，整份贴进来只会挤爆上下文。\n";
sum += "> 下面的 schema 足以让 AI 在需要时改写生成脚本（脚本本身在 **06-网页前端源码** 的 \`apps/web/tools/\`）。\n\n";
sum += "| 文件 | 体积 | 顶层结构 | 说明 |\n|---|---:|---|---|\n";
for (const [r, note] of WEB_GEN) {
  const info = await shapeOf(path.join(WEB, r));
  sum += info
    ? "| " + code(r) + " | " + kb(info.size) + " | " + info.shape + " | " + note + " |\n"
    : "| " + code(r) + " | — | 未找到 | " + note + " |\n";
}
sum += "| " + code("dist/") + " | — | 构建产物 | Vite 输出（HTML + JS + sourcemap），不收录 |\n";
sum += "\n> 另：\`data/kb/\` 是**引擎侧**的知识库原表（见本文上半部分），\`apps/web/src/kb/\` 是它在浏览器侧的派生索引，两者同源。\n";
await fs.writeFile(path.join(OUT, "04-数据摘要.md"), sum, "utf8");
manifest.push({ f: "04-数据摘要.md", desc: "知识库 schema + 统计 + 样本 + 前端生成物清单" });

// ---------- 05 支撑材料 ----------
const SUP = ["omj_simulator_战斗引擎考古报告.md", "OAS_FrogBoss_源码考古报告.md", "式神AI释放逻辑_资料汇总.md"];
let sup = "# 05 · 支撑材料（源码考古与资料汇总）\n\n> 可选。与主线关系较弱，但记录了完整的一手调研过程。\n\n---\n\n";
for (const f of SUP) {
  const t = sanitize(await read(path.join(ROOT, f)));
  sup += "\n<!-- ===== 源文件：" + f + " ===== -->\n\n" + t.replace(/^# /, "## ") + "\n\n---\n\n";
}
await fs.writeFile(path.join(OUT, "05-支撑材料.md"), sup, "utf8");
manifest.push({ f: "05-支撑材料.md", desc: "3 份考古报告（可选）" });

// ---------- 06 网页前端源码 ----------
const { kept, skipped } = await collectWeb();
let styleBytes = 0;
for (const { p, r } of kept) {
  if (!r.endsWith(".vue")) continue;
  const t = await read(p);
  for (const m of t.match(/<style\b[^>]*>[\s\S]*?<\/style>/g) ?? []) styleBytes += Buffer.byteLength(m);
}
let web = "# 06 · 网页前端源码（apps/web）\n\n";
web += "> **M1.8 Prediction Workbench** —— Vue 3 + Vite + Pinia 的浏览器工作台，共 " + kept.length + " 个文件。\n";
web += "> 与引擎不同，**这里允许第三方依赖**（vue / pinia / vite / pinyin-pro）；「零第三方依赖」只约束 \`battle-lab/\`。\n";
web += "> 引擎源码见 **03-源码汇编**；被本文件排除的生成物见 **04-数据摘要**。\n\n";
web += "## 精简说明（重要）\n\n";
web += "- **\`.vue\` 文件只保留 \`<script>\` 与 \`<template>\`**：\`<style>\` 段已整段剔除（共 " + kb(styleBytes) + " 纯样式，约占 .vue 体积的 28%）。\n";
web += "  被剔除处留一行 \`<!-- <style> 已省略 … KB（纯样式，无逻辑） -->\` 作为标记；样式不承载业务逻辑，剔除后组件语义完整。\n";
web += "- 除上述外**所有代码块都是原文照抄**，可以直接让 AI 基于它改代码。\n";
web += "- 未收录：\n";
for (const [r, why] of skipped.sort((a, b) => a[0].localeCompare(b[0]))) {
  const size = await sizeOf(path.join(WEB, r));
  web += "  - " + code(r) + (size ? "（" + kb(size) + "）" : "") + " —— " + why + "\n";
}
web += "- 构建目录 \`node_modules/\`、\`dist/\` 与隐藏目录一律不收录。\n\n";
web += "## 分层约束（唯一硬规则）\n\n";
web += "\`\`\`\n";
web += "components / stores / App.vue\n";
web += "        │  只允许依赖 ↓\n";
web += "        ├─▶ src/contracts/*   三份冻结 DTO 契约\n";
web += "        └─▶ src/kb/useKb.ts   KB 索引（只读 DTO）\n";
web += "\n";
web += "src/adapters/*  src/workers/*   ← 全项目仅有的两处允许 import @engine（= battle-lab/）\n";
web += "                                vite alias：@engine → ../../battle-lab\n";
web += "\`\`\`\n\n";
web += "这条约束有测试兜底：\`tests/ui1-editor.ts\` 用静态扫描断言\n";
web += "\`stores/**.ts\` 与 \`components/**/*.vue\` 里不出现 \`battle-lab\` / \`@engine\`。\n\n";
web += "## 文件清单\n\n";
for (const { r, size } of kept) web += "- " + code("apps/web/" + r) + "（" + kb(size) + "）\n";
web += "\n---\n\n";
for (const { p, r } of kept) {
  let body = sanitize(await read(p));
  if (r.endsWith(".vue")) body = slimVue(body);
  web += "\n### " + code("apps/web/" + r) + "\n\n" + block(langOf(r), body);
}
await fs.writeFile(path.join(OUT, "06-网页前端源码.md"), web, "utf8");
manifest.push({ f: "06-网页前端源码.md", desc: "前端全部源码（想让它改界面就传）" });

// ---------- 00 索引 ----------
// token 账本必须与实际产物一致 → 统一交给 build_submit_index.mjs 重算，
// 避免两处统计口径漂移（它只读 submit/ 再写 00-INDEX.md，不动别的文件）。
await import(new URL("./build_submit_index.mjs", import.meta.url).href);

console.log("\n=== submit 打包完成（网页端 AI 可读）===");
for (const m of manifest) console.log("  已写出  " + m.f.padEnd(20) + " " + m.desc);
