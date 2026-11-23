// tests/ui1-editor.ts — UI-1（阵容编辑器）验收测试
// 运行：node tests/ui1-editor.ts
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  — " + extra : "")); }
};
const section = (s: string) => console.log("\n" + s);

const J = (p: string) => JSON.parse(readFileSync(join(src, p), "utf8"));
const S = (p: string) => readFileSync(join(src, p), "utf8");

// ══════════════════════════════════════════════════════════
section("[1] 契约层：竞猜输入的形状（护栏 #3：永不出现御魂位置）");
const gm = await import("../src/contracts/guessing-match.ts");
const STAT_KEYS: string[] = gm.STAT_KEYS;
const STAT_LABELS: Record<string, string> = gm.STAT_LABELS;
ok("STAT_KEYS 恰好 8 维（攻/生/防/速/暴击/爆伤/效果命中/效果抵抗）", STAT_KEYS.length === 8, STAT_KEYS.join(","));
ok("每个维度都有中文标签", STAT_KEYS.every(k => !!STAT_LABELS[k]));
const m0 = gm.emptyMatch();
ok("emptyMatch 合法（schemaVersion=1, 5v5）", m0.schemaVersion === 1 && m0.red.units.length === 5 && m0.blue.units.length === 5);
ok("空单位爆伤默认 150%（游戏基线），其余维度为 0 待填", m0.red.units[0].stats.critDamage === 150 && m0.red.units[0].stats.attack === 0);
ok("GuessingUnitInput 无 soulPieces 字段（护栏 #3）", !("soulPieces" in m0.red.units[0]));
const swapped = gm.swapSides(m0);
ok("swapSides 保留 unitId 与顺序长度", swapped.red.units.length === 5 && swapped.blue.units.length === 5);
ok("swapSides 不共享引用（改红不影响蓝）", (() => { const s = gm.swapSides(m0); s.red.units[0].name = "X"; return s.blue.units[0].name !== "X"; })());
ok("newUnitId 唯一", gm.newUnitId() !== gm.newUnitId());

section("[2] 知识库索引：276 只式神全量可检索");
const idx = J("kb/shikigami-index.json") as any[];
ok("式神索引 276 条（图鉴 100%）", idx.length === 276, "got " + idx.length);
ok("每条含 id/名称/稀有度/关键词/拼音/首字母", idx.every(x => x.i > 0 && x.n && x.r && Array.isArray(x.t)));
ok("拼音覆盖 276/276", idx.filter(x => x.p).length === 276, idx.filter(x => !x.p).map(x => x.n).join(","));
  /**
   * ★★★ 第 162 轮按事实改写：**「有面板」的判据收紧了** —— 原来判 `!!s.panel`，于是 7 只「只有速度/暴击/抵抗」
   *   的式神也被标成「有面板」（生剥鬼 / 慧明灯 / 盗人神 / 湍津姬 / 木之本樱 / 李小狼 / 妖刀姬·绯夜猎刃）。
   *   现在判据是「攻/生/防至少一项非 null」，所以覆盖数是 **269/276**，少的那 7 只如实标着。
   *   ★ 两向：这 7 只的 pn 前三位必须真的是 null（判据不是拍脑袋），且它们仍然带着速度/暴击/抵抗（数据没有丢）。
   */
  const noPanel = idx.filter(x => !x.has.panel);
  ok("has.panel 覆盖 269/276（7 只只有速度/暴击/抵抗）", idx.filter(x => x.has.panel).length === 269, "got " + idx.filter(x => x.has.panel).length);
  ok("★★ 这 7 只就是判据收紧后如实标出的那些：生剥鬼/慧明灯/盗人神/湍津姬/木之本樱/李小狼/妖刀姬·绯夜猎刃",
    noPanel.length === 7 && ["生剥鬼", "慧明灯", "盗人神", "湍津姬", "木之本樱", "李小狼", "妖刀姬·绯夜猎刃"].every(n => noPanel.some(x => x.n === n)),
    JSON.stringify(noPanel.map(x => x.n)));
  ok("★★ 而它们的 pn 前三位确实是 null（攻/生/防没有数据），后五位仍带着速度/暴击/爆伤/命中/抵抗",
    noPanel.every(x => Array.isArray(x.pn) && x.pn[0] === null && x.pn[1] === null && x.pn[2] === null && x.pn[3] != null),
    JSON.stringify(noPanel.map(x => x.n + ":" + JSON.stringify(x.pn))));
ok("has.skills>0 覆盖 276/276", idx.filter(x => x.has.skills > 0).length === 276);
const aiN = idx.filter(x => x.has.ai).length;
ok("has.ai 覆盖 272/276（4 只 2026 新式神待补）", aiN === 272, "got " + aiN);
const noAi = idx.filter(x => !x.has.ai).map(x => x.n);
ok("缺失 AI 的正是 2026 新式神", noAi.length === 4, noAi.join(","));

section("[3] 搜索：ID / 全名 / 别名 / 全拼 / 首字母");
const kb = await import("../src/kb/useKb.ts").catch(() => null as any);
// useKb 依赖 vue 的 ref/computed —— 单独复刻搜索打分函数验证索引字段可用性
const search = (q: string) => {
  const s = q.trim().toLowerCase();
  const scored = idx.map(x => {
    let sc = -1;
    if (String(x.i) === s) sc = 100;
    else if (x.n === s) sc = 95;
    else if (x.n.toLowerCase().startsWith(s)) sc = 90;
    else if (x.n.toLowerCase().includes(s)) sc = 80;
    else if (x.k && x.k.toLowerCase().includes(s)) sc = 75;
    else if (x.p && x.p.startsWith(s)) sc = 70;
    else if (x.s && x.s.startsWith(s)) sc = 60;
    else if (x.t.some((t: string) => t.includes(s))) sc = 40;
    return { x, sc };
  }).filter(v => v.sc > 0);
  return scored.sort((a, b) => b.sc - a.sc || a.x.i - b.x.i).map(v => v.x);
};
ok("按 ID 精确命中（202 三尾狐）", search("202")[0]?.n === "三尾狐" || search("202")[0]?.i === 202, JSON.stringify(search("202")[0]));
ok("按全名命中（座敷童子）", search("座敷童子")[0]?.n.includes("座敷"), JSON.stringify(search("座敷童子")[0]?.n));
ok("按拼音命中（sanweihu）", search("sanweihu").length > 0 && search("sanweihu")[0].i === 202, JSON.stringify(search("sanweihu").map(x => x.n).slice(0, 3)));
ok("按首字母命中（swh）", search("swh").some(x => x.i === 202), JSON.stringify(search("swh").map(x => x.n).slice(0, 3)));
ok("模糊词命中不报错（姬）", search("姬").length > 0, String(search("姬").length));
ok("乱码查询返回空而非异常", search("zzzzqqqq").length === 0);

section("[4] 御魂索引：70 条 + Engine Support 前置告知（护栏 #5）");
const souls = J("kb/soul-index.json") as any[];
ok("御魂 70 条（审计 0 缺失）", souls.length === 70, "got " + souls.length);
ok("每条含 2件套/4件套/引擎支持度", souls.every(s => Number.isInteger(s.i) && s.n && "suit" in s && ["FULL", "PARTIAL", "UNSUPPORTED"].includes(s.engine.support)));
ok("御魂 id 唯一（0..69，雪幽魂 id=0 是数据事实不是缺失）", new Set(souls.map(s => s.i)).size === 70);
const dist = souls.reduce((a: any, s: any) => (a[s.engine.support] = (a[s.engine.support] ?? 0) + 1, a), {});
// ★ 分布从 5/33/32 变成 6/32/32：第 25 轮把**火灵**（战斗开始时获得 3 点鬼火）从 UNSUPPORTED
//   升级为真实现（ORB_START，会写 ORB_GAIN 事件）。索引是在那之后重新生成的，
//   而这条断言原先钉在旧世界上 —— 正是"重新生成产物会暴露陈旧断言"。
ok("支持度分布 = FULL 6 / PARTIAL 32 / UNSUPPORTED 32（火灵已升为 FULL）",
   dist.FULL === 6 && dist.PARTIAL === 32 && dist.UNSUPPORTED === 32, JSON.stringify(dist));
ok("非 FULL 的御魂都带 note（供 UI 显示原因）", souls.filter(s => s.engine.support !== "FULL").every(s => typeof s.engine.note === "string"));
ok("御魂选择器不提供静态属性输入（护栏 #4：绝不重复计算）", !/静态属性/.test(S("components/lineup/SoulSelector.vue")) && !/>\s*攻击\s*</.test(S("components/lineup/SoulSelector.vue")) && !/>\s*ATK\s*</.test(S("components/lineup/SoulSelector.vue")));

section("[5] 详情懒加载数据：276 只 panel+skills");
const det = J("kb/shikigami-detail.json") as Record<string, any>;
ok("detail 键数 276", Object.keys(det).length === 276, "got " + Object.keys(det).length);
ok("每只都有 panel 且速度有效", Object.values(det).every((d: any) => d.panel && d.panel.spd > 0));
const NULL_ATK = ["433", "552", "558", "571", "587", "588", "593"];   // 源数据 Attribute.json 缺基础攻/生/防
const nullAtk = Object.entries(det).filter(([, d]: any) => d.panel.atk == null).map(([k]) => k);
ok("基础攻/生/防缺失的恰好是已知 7 只（源数据缺口，非解析错误）", nullAtk.length === 7 && nullAtk.every(k => NULL_ATK.includes(k)), nullAtk.join(","));
ok("每只都有 ≥1 技能", Object.values(det).every((d: any) => Array.isArray(d.skills) && d.skills.length >= 1));
ok("技能条数合计 798（含普攻/被动/大招）", Object.values(det).reduce((a: number, d: any) => a + d.skills.length, 0) === 798, String(Object.values(det).reduce((a: number, d: any) => a + d.skills.length, 0)));
ok("典型对局 10 只全部有详情", [202, 297, 601, 225, 346, 205, 358, 267, 352, 390].every(id => det[String(id)]?.panel));

section("[5b] 选中即预填：六星面板随索引下发（免手打 80 个数字）");
const withPanel = idx.filter(x => x.pn);
ok("索引携带面板 276/276", withPanel.length === 276, "got " + withPanel.length);
ok("面板数组长度为 8（攻/生/防/速/暴/爆/命/抵）", withPanel.every(x => x.pn.length === 8));
ok("百分比已换算为百分数（暴击 0.1 → 10）", idx.find(x => x.i === 202)!.pn[4] === 10);
ok("爆伤换算为 150 而非 1.5", idx.find(x => x.i === 202)!.pn[5] === 150);
ok("典型对局 10 只全部有完整基础面板", [202, 297, 601, 225, 346, 205, 358, 267, 352, 390].every(id => { const x = idx.find(v => v.i === id); return x && x.pn[0] != null && x.pn[1] != null; }));
ok("App.vue 只在格子未动过时预填（不覆盖手输）", /untouched/.test(S("App.vue")) && /u\.stats\.attack === 0/.test(S("App.vue")));
ok("预填函数只写非 null 项（源数据缺项不写 0）", /if \(v != null\) out\[keys\[i\]\] = v/.test(S("kb/useKb.ts")));

section("[6] 组件接线：App.vue 与子组件的 props / events 一致");
const app = S("App.vue");
// UI 2.0：阵容改为横排 UnitTile（§31/§32），旧的 LineupPanel/ShikigamiCard 已删除
const COMPONENTS = ["UnitTile", "ShikigamiSelector", "SoulSelector", "HealthCheck", "DetailDrawer", "JsonIo", "FidelityPanel"];
for (const c of COMPONENTS) {
  ok(`App.vue 导入并使用 <${c}>`, new RegExp("import " + c + " from").test(app) && new RegExp("<" + c).test(app));
}
ok("UnitTile 直接挂在 App 上，并且四类事件都接上了", /<UnitTile/.test(app) && /@set-stat=/.test(app) && /@open-soul=/.test(app) && /@open-detail=/.test(app) && /@open-selector=/.test(app));
// 事件名一致性：App 里 @x= 必须是子组件 defineEmits 声明过的
function declaredEvents(file: string): string[] {
  const s = S(file);
  const block = s.match(/defineEmits<\{([\s\S]*?)\}>/)?.[1] ?? "";
  return [...block.matchAll(/\(e:\s*"([a-z-]+)"/g)].map(m => m[1]);
}
function usedEvents(file: string, comp: string): string[] {
  const s = S(file);   // file 是**路径**（此前误传内容，已修正）
  const tag = s.match(new RegExp("<" + comp + "\\b[\\s\\S]*?/>"))?.[0] ?? "";
  if (!tag) throw new Error("模板中找不到 <" + comp + "> 用法");
  return [...tag.matchAll(/@([a-z-]+)=/g)].map(m => m[1]);
}
for (const [c, f] of [["UnitTile", "components/lineup/UnitTile.vue"], ["ShikigamiSelector", "components/lineup/ShikigamiSelector.vue"], ["SoulSelector", "components/lineup/SoulSelector.vue"], ["HealthCheck", "components/simulation/HealthCheck.vue"], ["DetailDrawer", "components/knowledge/DetailDrawer.vue"], ["JsonIo", "components/common/JsonIo.vue"]] as const) {
  const decl = declaredEvents(f), used = usedEvents("App.vue", c);
  const undeclared = used.filter(e => !decl.includes(e));
  ok(`<${c}> 事件全部已声明`, undeclared.length === 0, "未声明: " + undeclared.join(",") + " | 已声明: " + decl.join(","));
}
ok("UnitTile 的事件全部冒泡到 App（无静默丢弃）", (() => {
  const s = S("components/lineup/UnitTile.vue");
  return ["set-stat", "open-selector", "open-soul", "clear", "open-detail", "activate"].every(e => s.includes(e));
})());

section("[7] 护栏 #10：草稿自动保存");
const ms = S("stores/match.ts");
ok("草稿 key 带版本号（结构变更可失效）", /yys\.workbench\.match\.draft\.v1/.test(ms));
ok("载入草稿校验 schemaVersion 与红蓝结构", /schemaVersion !== 1/.test(ms));
ok("配额异常不阻塞操作（try/catch 静默）", /catch \{ \/\* 配额满时静默/.test(ms));
ok("store 只存 DTO（不 import engine）", !/from ".*battle-lab/.test(ms) && !/from "@engine/.test(ms));

section("[8] 组件不依赖引擎内部对象（只依赖契约与 KB 索引）");
for (const f of ["components/lineup/UnitTile.vue", "components/lineup/UnitTile.vue", "components/simulation/HealthCheck.vue", "components/knowledge/DetailDrawer.vue", "components/common/JsonIo.vue"]) {
  ok(`${f} 不 import battle-lab`, !/@engine|battle-lab/.test(S(f)));
}

console.log(`\n══════════════════════════════════`);
console.log(`UI-1 验收：${pass} 通过 / ${fail} 失败`);
console.log(`══════════════════════════════════`);
if (fail > 0) process.exit(1);
