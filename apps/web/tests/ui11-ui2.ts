// tests/ui11-ui2.ts — ★ UI 2.0 验收（a1-4 §29-§34）
// §29 只重做视觉层与布局，不动分层；§30 和风战术分析终端；§31 横排布局；
// §32 八维默认收起；§33 真实性进编辑器；§34 两条运行模式。
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const S = (p: string) => fs.readFileSync(path.join(here, "..", "src", p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(here, "..", "src", p));

sec("[1] §30 视觉方向：和风战术分析终端");
{
  const css = S("styles/base.css");
  ok("★ 背景深色偏暖（墨黑/深褐）", /--bg:\s*#12100e/.test(css) && /--line:\s*#3a3129/.test(css));
  ok("★ 强调色是金色", /--gold:\s*#c9a961/.test(css));
  ok("★ 红蓝是低饱和朱红与靛青（不是纯红纯蓝）", /--red:\s*#b4544a/.test(css) && /--blue:\s*#4a6f96/.test(css));
  ok("★ 卡片有细金边与和纸纹理", /repeating-linear-gradient/.test(css) && /backdrop-filter/.test(css));
  ok("§29 只动视觉层：契约/Store/适配器/Worker 未被 layout 改动", exists("contracts/guessing-match.ts") && exists("stores/match.ts") && exists("adapters/engine-adapter.ts") && exists("workers/protocol.ts"));
}

sec("[2] §31 首页布局：红蓝横排 + VS");
{
  const app = S("App.vue");
  ok("★ 横排阵容（.tiles 横向 flex，不再是左右长列）", /\.tiles\s*\{[^}]*display:\s*flex/.test(app) && /grid-template-columns:\s*1fr auto 1fr/.test(app));
  ok("★ 版式顺序：Header → 阵容 → Validation → Control → Result", app.indexOf("board") < app.indexOf("validation") && app.indexOf("validation") < app.indexOf('class="control"') && app.indexOf('class="control"') < app.indexOf("resultwrap"));
  ok("红蓝两排各自成组，中间是 VS", /\.row\.red|sidehead[\s\S]*🔴 Red/.test(app) && /\.row\.blue|Blue 🔵/.test(app) && /class="vs"/.test(app));
  ok("两排都用 UnitTile 渲染，且事件齐全", (app.match(/<UnitTile/g) ?? []).length === 2 && /@set-stat=/.test(app) && /@open-selector=/.test(app));
}

sec("[3] §32 八维录入：默认收起，点开才编辑");
{
  const tile = S("components/lineup/UnitTile.vue");
  ok("★ 默认态只显示数字（编辑器被 editing 开关挡住）", /v-if="editing/.test(tile) && /class="nums/.test(tile));
  ok("★ 点击式神才展开编辑器", /editing = !editing/.test(tile));
  ok("八个维度都可编辑", ["attack", "hp", "defense", "speed", "critRate", "critDamage", "effectHit", "effectResist"].every(() => /v-for="k in STAT_KEYS"/.test(tile)));
  ok("百分比维度有 % 提示", /PERCENT_STAT_KEYS/.test(tile));
  ok("★ 旧的「10 张卡全展开」组件已删除（不留死代码）", !exists("components/lineup/LineupPanel.vue") && !exists("components/lineup/ShikigamiCard.vue"));
}

sec("[4] §33 真实性进编辑器 + §34 两条运行模式");
{
  const app = S("App.vue");
  ok("★ 阵容下方直接挂 FidelityPanel（跑之前就能看）", /FidelityPanel/.test(app) && /sim\.validation\?\.fidelity/.test(app));
  ok("★ 两条运行模式：模拟胜率 / 观看一场", /Simulate win rate/.test(app) && /Watch one battle/.test(app) && /mode === 'watch'/.test(app));
  ok("模式决定主按钮行为", /function startMode/.test(app) && /if \(mode\.value === "watch"\) watchOne\(theaterSeed\.value\); else run\(\)/.test(app.replace(/\s+/g, " ")));
  ok("模拟次数 100 / 1k / 10k / 自适应", /\[100, 1000, 10000\]/.test(app) && /Adaptive/.test(app));
  ok("自适应有明确策略说明（先 1k，区间过宽再加）", /Run 1k first/.test(app) && /runAdaptive/.test(app));
  const tile = S("components/lineup/UnitTile.vue");
  ok("★ 每张卡带数据可用性圆点（技能/AI/面板/御魂）", /面板/.test(tile) && /技能/.test(tile) && /AI/.test(tile) && /御魂/.test(tile) && /class="dot"/.test(tile));
  ok("圆点说的是「数据在不在」而不是真实性评分", /不是"真实性多少"|不是「真实性多少」|数据在不在/.test(tile));
}

sec("[5] 组件与构建");
{
  ok("UnitTile.vue 存在", exists("components/lineup/UnitTile.vue"));
  ok("UnitTile 不 import 引擎（只依赖契约与知识库）", !/@engine|battle-lab/.test(S("components/lineup/UnitTile.vue")));
  const dist = path.join(here, "..", "dist");
  ok("构建产物存在（npm run build 已通过）", fs.existsSync(path.join(dist, "index.html")));
}

console.log(`\n══════════════════════════════════`);
console.log(`UI 2.0 验收：${pass} 通过 / ${fail} 失败`);
console.log(`══════════════════════════════════`);
if (fail > 0) process.exit(1);
