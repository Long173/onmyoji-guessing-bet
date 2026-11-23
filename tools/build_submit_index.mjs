// tools/build_submit_index.mjs — 按 submit/ 实际内容重算 token 并重生成 00-INDEX.md
// 单一权威来源：build_submit.mjs 写完产物后会 import 本脚本，避免两处 token 口径漂移。
// 只读 submit/ 与工作区体积，只写 submit/00-INDEX.md。
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "submit");
const BT = String.fromCharCode(96);
const code = s => BT + s + BT;

/** CJK 约 1 token/字；ASCII 约 3.5 字符/token（与 build_submit.mjs 同一口径） */
function estTokens(t) { let c = 0, o = 0; for (const ch of t) { if (/[\u3000-\u9fff\uff00-\uffef]/.test(ch)) c++; else o++; } return Math.round(c + o / 3.5); }
const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
const kbb = n => (n / 1024).toFixed(0) + " KB";

// ---------- 工作区实际体积（用来解释「为什么必须分包」）----------
const SKIP_DIR = new Set(["node_modules", "dist", ".git", "submit", ".vite",
  "_oas", "_nga", "reference", "omj_engine_probe", "raw", "raw_character_json", "raw_rendered_html"]);
const TEXT_EXT = /\.(ts|vue|mjs|js|css|json|md|html|txt|csv|py)$/;
async function workspace() {
  let bytes = 0, cjk = 0, other = 0;
  async function walk(d) {
    let ents; try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (SKIP_DIR.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      let st; try { st = await fs.stat(p); } catch { continue; }
      bytes += st.size;
      if (!TEXT_EXT.test(e.name)) continue;
      let t; try { t = await fs.readFile(p, "utf8"); } catch { continue; }
      const n = (t.match(/[\u3000-\u9fff\uff00-\uffef]/g) ?? []).length;
      cjk += n; other += t.length - n;
    }
  }
  await walk(ROOT);
  return { bytes, tok: Math.round(cjk + other / 3.5) };
}

// ---------- 文件账本 ----------
const DESC = {
  "01-项目总览.md": ["一页看懂项目：项目结构 / 三条冻结决定 / 里程碑与 M1.8 六个 Sprint / 关键数字 / 当前边界", "★ 必传"],
  "02-研究报告.md": ["9 份主报告合并：源码考古 → 知识库 → 规则地基 → 面板公式 → 竞猜/养成分层 → 典型对局 → M1.8 预测工作台 → **M1.9 全局战斗与真实性体系**（含 §172 十二项目标验收状态表 / §169 百目鬼接线交接 / §175 条件与分支载体设计）", "★ 强烈建议"],
  "03-源码汇编.md": ["battle-lab 引擎全部 .ts 源码（零第三方依赖，可擦除语法）", "改引擎时传"],
  "04-数据摘要.md": ["知识库 12 张表的 schema + 统计 + 真实样本；外加 apps/web 生成物清单（1.4 MB，只描述不收录）", "★ 必传（替代 2.8 MB JSON）"],
  "05-支撑材料.md": ["3 份考古报告：omj_simulator 引擎 / OAS 对弈竞猜 / AI 释放逻辑汇总", "可选"],
  "06-网页前端源码.md": ["apps/web 全部源码：3 份契约 / 真引擎适配 / Worker 协议 / Pinia store / 12 个 .vue（已剔 <style>）/ 6 个验收脚本 / 3 个生成脚本", "改前端时传"],
};
const rows = [];
for (const f of Object.keys(DESC)) {
  let t;
  try { t = await fs.readFile(path.join(OUT, f), "utf8"); }
  catch { throw new Error("submit/ 缺少 " + f + " —— 请先运行：node tools/build_submit.mjs"); }
  rows.push({ f, tok: estTokens(t), bytes: Buffer.byteLength(t), desc: DESC[f][0], hint: DESC[f][1] });
}
const total = rows.reduce((a, b) => a + b.tok, 0);
const totalBytes = rows.reduce((a, b) => a + b.bytes, 0);
const get = f => rows.find(r => r.f === f).tok;
const sum = (...fs) => fs.reduce((a, f) => a + get(f), 0);

const C_OVERVIEW = "01-项目总览.md", C_REPORT = "02-研究报告.md", C_ENGINE = "03-源码汇编.md";
const C_DATA = "04-数据摘要.md", C_SUP = "05-支撑材料.md", C_WEB = "06-网页前端源码.md";

const combos = [
  ["**最小：只想建立认知**", "01 + 02", sum(C_OVERVIEW, C_REPORT), "几乎所有（≥32k）"],
  ["**只想让它看懂项目**", "01 + 02 + 04", sum(C_OVERVIEW, C_REPORT, C_DATA), "几乎所有（≥64k）"],
  ["**只想让它改网页前端**", "01 + 06", sum(C_OVERVIEW, C_WEB), "≥100k"],
  ["**只想让它改引擎**", "01 + 03", sum(C_OVERVIEW, C_ENGINE), "≥100k"],
  ["**全栈改代码**", "01 + 03 + 06", sum(C_OVERVIEW, C_ENGINE, C_WEB), "≥200k（贴得下但吃紧）"],
  ["**全量**", "01 ~ 06", total, "超出多数网页端，不建议一次贴"],
];

const ws = await workspace();

let idx = "# 00 · INDEX — 提交给网页端 AI 的读法\n\n";
idx += "本包是一份**阴阳师对弈竞猜战斗模拟器**项目的可读快照，含**引擎**（battle-lab/）与**网页工作台**（apps/web/，M1.8）两部分。\n\n";
idx += "工作区公开部分约 **" + (ws.bytes / 1048576).toFixed(1) + " MB / 约 " + (ws.tok / 1e6).toFixed(2) + "M token**"
  + "（含知识库 JSON 与前端生成物；原始抓取与第三方克隆不进公开仓库）。远超网页端上下文。\n";
idx += "本包把它重排成 **6 个内容文件**，按需选传 —— 单个文件都控制在 120k token 以内，任何一份都能单独贴进对话框。\n\n";
idx += "## 文件清单\n\n| 文件 | 约 token | 大小 | 内容 | 建议 |\n|---|---:|---:|---|---|\n";
for (const r of rows) {
  idx += "| [" + r.f + "](" + r.f + ") | **" + fmt(r.tok) + "** | " + kbb(r.bytes) + " | " + r.desc + " | " + r.hint + " |\n";
}
idx += "| **合计（6 个内容文件）** | **" + fmt(total) + "** | " + kbb(totalBytes) + " | | |\n\n";
idx += "## 推荐组合（都实测过，直接照抄）\n\n| 场景 | 传这些 | 约 token | 能装下它的模型 |\n|---|---|---:|---|\n";
for (const [name, files, tok, model] of combos) idx += "| " + name + " | " + files + " | **" + fmt(tok) + "** | " + model + " |\n";
idx += "\n";
idx += "> **最省又信息密度最高的两个：** " + code("01") + "（" + fmt(get(C_OVERVIEW)) + "）+ " + code("04") + "（" + fmt(get(C_DATA)) + "）= **"
  + fmt(sum(C_OVERVIEW, C_DATA)) + " token**，不到 10k 就能建立完整认知。\n";
idx += "> 想让它**动代码**：改前端只传 " + code("01 + 06") + "（" + fmt(sum(C_OVERVIEW, C_WEB)) + "），改引擎只传 "
  + code("01 + 03") + "（" + fmt(sum(C_OVERVIEW, C_ENGINE)) + "）—— 两边源码互相独立，不必一起传。\n";
idx += "> 两边都要动时，" + code("01 + 03 + 06") + " = " + fmt(sum(C_OVERVIEW, C_ENGINE, C_WEB)) + " token，200k 上下文刚好装得下。\n\n";
idx += "## 建议的读法\n\n";
idx += "1. **01-项目总览** —— 先建立全局：项目结构、三条已冻结的架构决定、里程碑（含 M1.8 网页工作台）、当前边界\n";
idx += "2. **04-数据摘要** —— 知识库长什么样（字段、条数、样本），以及前端那几个 MB 级生成物的 schema。\n";
idx += "   注意：**不要**要求看原始 JSON，它是本文件的 500 倍体积\n";
idx += "3. **02-研究报告** —— 完整推导链。其中三节最关键：\n";
idx += "   - §07 竞猜路径 vs 完整御魂系统**分层冻结**\n";
idx += "   - §08 典型对局 #001（真实数据 + 基准夹具）\n";
idx += "   - §04 战斗规则地基（官方术语词典 + 22 子系统）\n";
idx += "4. **03-源码汇编**（引擎）/ **06-网页前端源码**（界面）—— 需要动代码时按需选传\n";
idx += "5. **05-支撑材料** —— 一般不用传，只在追问「当初为什么这么定」时用\n\n";
idx += "## 06 的特殊说明（传之前请读）\n\n";
idx += "- " + code(".vue") + " 文件**只保留 " + code("<script>") + " 与 " + code("<template>") + "**，"
  + code("<style>") + " 段（约 32 KB 纯样式）已整段剔除，剔除处留一行 HTML 注释标记。\n";
idx += "  这是为了让 06 控制在 " + fmt(get(C_WEB)) + " token；组件逻辑一字未改。\n";
idx += "- 生成物（" + code("src/engine/bundle.json") + " 621 KB、" + code("src/kb/*.json") + " 730 KB、"
  + code("package-lock.json") + "）**不在 06 里**，它们的 schema 与体积在 04。\n";
idx += "- 因此 06 里的代码是「可读、可改」的，但**不是**一个能原样复制回项目就构建的完整目录（缺样式与生成物）。\n\n";
idx += "## 如果你只想知道「这东西现在能干什么」\n\n";
idx += "看 **01-项目总览** 的最后一节「当前边界」：\n\n";
idx += "> 模拟器能跑完整对局，但**产出的胜率目前不可用于下注** ——\n";
idx += "> 四个未实测的机制参数（开局结算顺序 / 同时触发优先级 / 死亡转化复活状态机 / 竞猜残局规则）\n";
idx += "> 全部做成了可切换策略并强制带 UNKNOWN 警示，不允许靠猜测补值。\n\n";
idx += "M1.8 网页工作台（06）没有改变这一点：它只是把同一套引擎与知识库搬进浏览器；M1.9 之后这一条多了三件**可跑的仪器**（都在 battle-lab/tools/）：`fidelity-cli.ts report|diff`（五层保真度 + 与真实观测对照找第一处分歧）· `replay-cli.ts run --out f` + `verify f`（逐帧回放校验）· `state-cli.ts save|resume`（暂停存档 → 换进程续跑）。十二项目标各自的守门人与最近实跑结果见 02 的 **§172**。\n";
idx += "结果面板顶部会挂 UNKNOWN 警示，机制实验台直接列出每个红区的状态与 44 个可判别实验。\n\n";
idx += "## 未包含\n\n";
idx += "- **前端生成物**（apps/web/src/engine/bundle.json 621 KB + apps/web/src/kb/*.json 730 KB = 约 1.4 MB）\n";
idx += "  —— 只在 **04** 里描述 schema、条数与重建命令\n";
idx += "- **原始抓取产物与第三方克隆**（" + code("data/raw/") + "、" + code("_oas/") + "、" + code("_nga/") + "、" + code("reference/") + "）——"
  + "不进公开 Git 仓库，也不收录进本包\n";
idx += "- **二进制文档**（" + code(".docx") + "）—— 网页端 AI 读不了，其内容已大量引用于报告 02\n";
idx += "- **可运行副本** —— 本项目需要 Node ≥22 原生 TS 类型擦除，网页端 AI 无法执行；\n";
idx += "  所有测试的**实测结果**已写进 01 与 02\n";
await fs.writeFile(path.join(OUT, "00-INDEX.md"), idx, "utf8");

console.log("=== submit/ token 账本（按实际产物重算）===");
for (const r of rows) console.log("  " + r.f.padEnd(22) + fmt(r.tok).padStart(8) + " tok  " + kbb(r.bytes).padStart(8));
console.log("  " + "合计".padEnd(22) + fmt(total).padStart(8) + " tok  " + kbb(totalBytes).padStart(8));
console.log("\n工作区实际：" + (ws.bytes / 1048576).toFixed(1) + " MB / 约 " + (ws.tok / 1e6).toFixed(2) + "M token");
console.log("推荐组合：");
for (const [name, files, tok] of combos) console.log("  " + files.padEnd(14) + fmt(tok).padStart(8) + " tok   " + name.replace(/\*\*/g, ""));
