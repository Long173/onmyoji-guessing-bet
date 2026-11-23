// tests/ui5-knowledge.ts — UI-5（知识库页面 + 机制实验台）验收测试
// 运行：node tests/ui5-knowledge.ts   （工作目录 apps/web）
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { groupRedZones, STATUS_ORDER, TONE_VAR } from "../src/components/mechanics/redZoneGroups.ts";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");
const root = join(here, "..", "..", "..");
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  — " + extra : "")); }
};
const section = (s: string) => console.log("\n" + s);

const J = (p: string) => JSON.parse(readFileSync(join(src, p), "utf8"));
const S = (p: string) => readFileSync(join(src, p), "utf8");
const RJ = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
const CODE = "components/knowledge/CodexView.vue";
const MECH = "components/mechanics/MechanicsView.vue";

// ══════════════════════════════════════════════════════════
section("[0] 生成物存在性");
const IDX_PATH = "kb/experiments.json";
if (!existsSync(join(src, IDX_PATH))) {
  console.log("  ✗ 缺少 " + IDX_PATH + " —— 先运行：node tools/build-experiments-index.mjs");
  console.log("\nUI-5 验收：0 通过 / 1 失败");
  process.exit(1);
}
ok(IDX_PATH + " 存在", true);
ok("生成脚本 tools/build-experiments-index.mjs 存在", existsSync(join(here, "..", "tools", "build-experiments-index.mjs")));
for (const f of [CODE, MECH]) ok(f + " 存在", existsSync(join(src, f)));

const idx = J(IDX_PATH) as any;
const srcAll = RJ("battle-lab/experiments/results/_all.json") as any[];
const verifiedSrc = RJ("battle-lab/experiments/verified-rules.json") as any;
const covSrc = RJ("battle-lab/capability/coverage.json") as any;

section("[1] 实验索引：44 条、四组齐全（A10 / B10 / C12 / D12）");
ok("experiments 恰好 44 条", idx.experiments.length === 44, "got " + idx.experiments.length);
const byGroup = (g: string) => idx.experiments.filter((e: any) => e.group === g).length;
ok("A 组 10 条", byGroup("A") === 10, "got " + byGroup("A"));
ok("B 组 10 条", byGroup("B") === 10, "got " + byGroup("B"));
ok("C 组 12 条", byGroup("C") === 12, "got " + byGroup("C"));
ok("D 组 12 条", byGroup("D") === 12, "got " + byGroup("D"));
const ids = idx.experiments.map((e: any) => e.id);
ok("id 唯一且 44 个", new Set(ids).size === 44);
ok("id 集合与源文件 _all.json 完全一致（无编造、无遗漏）",
  JSON.stringify(ids) === JSON.stringify(srcAll.map((e: any) => e.experiment)), ids.slice(0, 3).join(","));
ok("groups 汇总与实算一致（total / discriminating）", idx.groups.every((g: any) =>
  g.total === idx.experiments.filter((e: any) => e.group === g.group).length &&
  g.discriminating === idx.experiments.filter((e: any) => e.group === g.group && e.discriminating).length));

section("[2] 索引条目字段完整，且逐条来自源文件（不得手写捏造）");
const NF = ["id", "group", "title", "hypothesis", "method", "result", "verdict", "redZone"];
ok("每条都有 " + NF.join("/") + " 且非空", idx.experiments.every((e: any) =>
  NF.every(k => typeof e[k] === "string" && e[k].trim().length > 0)));
ok("discriminating 都是 boolean", idx.experiments.every((e: any) => typeof e.discriminating === "boolean"));
ok("verdictLevel ∈ {UNKNOWN, HYPOTHESIS, VERIFIED}", idx.experiments.every((e: any) =>
  ["UNKNOWN", "HYPOTHESIS", "VERIFIED"].includes(e.verdictLevel)));
ok("每条至少 1 个候选假设且 id/note 非空", idx.experiments.every((e: any) =>
  Array.isArray(e.hypotheses) && e.hypotheses.length >= 1 && e.hypotheses.every((h: any) => h.id && h.note)));
const srcOf = (id: string) => srcAll.find((x: any) => x.experiment === id);
ok("title = 源文件 question", idx.experiments.every((e: any) => e.title === srcOf(e.id).question));
ok("method = 源文件 inGameObservation", idx.experiments.every((e: any) => e.method === srcOf(e.id).inGameObservation));
ok("discriminating = 源文件", idx.experiments.every((e: any) => e.discriminating === srcOf(e.id).discriminating));
ok("hypothesis 覆盖源文件全部候选假设的 id 与 note", idx.experiments.every((e: any) => {
  const s = srcOf(e.id);
  return e.hypotheses.length === s.hypotheses.length &&
    s.hypotheses.every((h: any) => e.hypothesis.includes(h.id) && e.hypothesis.includes(h.note));
}));
const compact = (v: any) => JSON.stringify(v === undefined ? null : v).replace(/\s+/g, " ");
ok("result 逐条复用源文件各假设的 observable（未改写数值）", idx.experiments.every((e: any) =>
  srcOf(e.id).hypotheses.every((h: any) => e.result.includes(compact(h.observable)))));
ok("红区名带组号（来自定义文件段注释）", idx.experiments.every((e: any) => e.redZone.startsWith(e.group + " ")));
ok("status/confidence/chosenHypothesis 原样透传源文件", idx.experiments.every((e: any) => {
  const s = srcOf(e.id);
  return e.status === s.status && e.confidence === s.confidence && e.chosenHypothesis === s.chosenHypothesis;
}));
ok("confidence 是源文件里的字符串（不是自造的数字）", idx.experiments.every((e: any) =>
  e.confidence === null || typeof e.confidence === "string"));
ok("结论文案里不含任何置信度数字", idx.experiments.every((e: any) => !/[0-9]/.test(e.verdict)));
ok("源文件全部 NOT_RUN 时，索引里 0 条 VERIFIED（不越权宣称已验证）",
  srcAll.some((s: any) => s.confidence !== "NOT_RUN") || idx.experiments.every((e: any) => e.verdictLevel !== "VERIFIED"));

section("[3] 红区状态：UNKNOWN / HYPOTHESIS / VERIFIED 三态，且与 verified-rules.json 一致");
ok("redZones 条目 > 0", idx.redZones.length > 0, "got " + idx.redZones.length);
ok("status ∈ {UNKNOWN, HYPOTHESIS, VERIFIED}", idx.redZones.every((z: any) =>
  ["UNKNOWN", "HYPOTHESIS", "VERIFIED"].includes(z.status)));
ok("每条红区都有 zone / id / question 字段", idx.redZones.every((z: any) =>
  typeof z.zone === "string" && z.zone && typeof z.id === "string" && z.id && typeof z.question === "string"));
ok("redZoneStatusCounts 与实算一致", ["UNKNOWN", "HYPOTHESIS", "VERIFIED"].every(s =>
  idx.redZoneStatusCounts[s] === idx.redZones.filter((z: any) => z.status === s).length));
ok("VERIFIED 计数 = verified-rules.json 的 rules 条数（当前 " + (verifiedSrc.rules?.length ?? 0) + "）",
  idx.redZoneStatusCounts.VERIFIED === (verifiedSrc.rules?.length ?? 0));
ok("verifiedRules.count 与源文件一致", idx.verifiedRules.count === (verifiedSrc.rules?.length ?? 0));
const zoneText = idx.redZones.map((z: any) => z.zone).join("|");
for (const z of ["开局结算顺序", "同时触发优先级", "死亡", "竞猜残局", "鬼火"]) {
  ok("红区覆盖「" + z + "」", zoneText.includes(z));
}
ok("UNKNOWN 与 HYPOTHESIS 都有条目（两态可区分）",
  idx.redZoneStatusCounts.UNKNOWN > 0 && idx.redZoneStatusCounts.HYPOTHESIS > 0);

section("[4] 机制覆盖度：FULL / PARTIAL / NONE 计数与明细");
ok("coverage 条目 > 0", idx.coverage.length > 0, "got " + idx.coverage.length);
ok("status ∈ {FULL, PARTIAL, NONE}", idx.coverage.every((c: any) => ["FULL", "PARTIAL", "NONE"].includes(c.status)));
ok("每条有 capability 且在源文件 rows 里存在", idx.coverage.every((c: any) => c.capability && covSrc.rows.some((r: any) => r.key === c.capability)));
ok("note 字段存在（缺说明时为空串，不编造）", idx.coverage.every((c: any) => typeof c.note === "string"));
ok("coverageSummary 计数与实算一致", ["FULL", "PARTIAL", "NONE"].every((s: string) =>
  idx.coverageSummary[s.toLowerCase()] === idx.coverage.filter((c: any) => c.status === s).length));
ok("coverageSummary 与源文件 cov 一致", idx.coverageSummary.total === covSrc.cov.total &&
  idx.coverageSummary.full === covSrc.cov.full && idx.coverageSummary.partial === covSrc.cov.partial &&
  idx.coverageSummary.none === covSrc.cov.none);
ok("anomalies 是自检产出（数组，记录数据缺口）", Array.isArray(idx.anomalies) && idx.anomalies.length > 0);

section("[5] 知识库一致性：术语 156 条 / 御魂 70 条（与既有索引相同）");
const glossary = J("kb/glossary.json") as any[];
ok("术语表 156 条", glossary.length === 156, "got " + glossary.length);
ok("每条含 id/name/text 且正文非空", glossary.every(g => Number.isInteger(g.id) && g.name && g.text));
const souls = J("kb/soul-index.json") as any[];
ok("御魂索引 70 条", souls.length === 70, "got " + souls.length);
ok("每条含 2 件套 / 4 件套 / Engine Support", souls.every(s => "suit" in s && "desc" in s && ["FULL", "PARTIAL", "UNSUPPORTED"].includes(s.engine.support)));
const shiki = J("kb/shikigami-index.json") as any[];
ok("式神索引 276 条且每条带完整度字段 has", shiki.length === 276 && shiki.every(s => s.has && typeof s.has.skills === "number" && typeof s.has.ai === "boolean"));

section("[6] 组件接线：只依赖契约与知识库索引，不碰引擎");
for (const f of [CODE, MECH]) {
  const s = S(f);
  ok(f + " import 了 experiments.json 或 useKb", /experiments\.json|useKb/.test(s));
  ok(f + " 不 import 引擎（无 battle-lab / @engine 字样）", !/battle-lab|@engine/.test(s));
  // 只看 script + template（样式里的 100% 之类不算文案），确保不出现数据之外的百分比
  const view = s.split("<style")[0];
  ok(f + " 不含任何置信度数字（不给出数据外的比例）", !/[0-9]{1,3}(\.[0-9]+)?%/.test(view));
}
const code = S(CODE), mech = S(MECH);
ok("CodexView 复用 DetailDrawer（未重写抽屉）", /import DetailDrawer from "\.\/DetailDrawer\.vue"/.test(code) && /<DetailDrawer/.test(code));
ok("CodexView 传入 GuessingUnitInput 形状（unitId + shikigamiId + stats）",
  /unitId: "codex-"/.test(code) && /shikigamiId: x\.i/.test(code) && /stats: \{/.test(code));
ok("CodexView stats 取 pn 面板且缺项填 0", /x\.pn \?\? \[\]/.test(code) && /pn\[i\] \?\? 0/.test(code));
ok("CodexView 三个页签：式神图鉴 / 御魂图鉴 / 术语表",
  /label: "Shikigami"/.test(code) && /label: "Souls"/.test(code) && /label: "Glossary"/.test(code));
ok("CodexView 顶部说明数据来源与版本（GameData 2026-10-01）", /GameData 2026-10-01/.test(code) && /sourcebar/.test(code));
ok("CodexView 搜索复用 searchShikigami / searchSouls", /searchShikigami/.test(code) && /searchSouls/.test(code));
ok("CodexView 稀有度筛选来自 RARITIES", /RARITIES/.test(code));
ok("CodexView 御魂三色圆点 + 中文标签", /var\(--ok\)/.test(code) && /var\(--warn\)/.test(code) && /var\(--danger\)/.test(code) && /SOUL_SUPPORT_LABEL/.test(code));
ok("CodexView 明写「静态属性不参与计算」", /soul static stats are not counted/.test(code));
ok("CodexView 显示完整度徽标（技能 / AI / 面板）", /has\.skills/.test(code) && /has\.ai/.test(code) && /has\.panel/.test(code));
ok("CodexView 计数取自知识库长度（不写死条数）", /SHIKIGAMI\.length/.test(code) && /SOULS\.length/.test(code) && /GLOSSARY\.length/.test(code));

ok("MechanicsView 懒加载 experiments.json", /await import\("\.\.\/\.\.\/kb\/experiments\.json"\)/.test(mech));
  // ★★★ 第 62 轮：这一条原来是**形状断言**（"源码里有 STATUS_ORDER / zonesByStatus / v-UNKNOWN 这几个名字"）——
  //   它看起来在守"分组"，实际上守不了任何东西：原来那段代码遍历写死的清单去 filter，
  //   数据里多一个状态就静默丢条目，而这条断言照样是绿的。
  //   现在改成对**抽出来的纯函数**做行为断言（见下），形状断言只保留"接线"那一层。
  ok("MechanicsView 的分组走纯函数（接线，不是形状）",
    /groupRedZones\(redZones\.value\)/.test(mech) && !/STATUS_ORDER\.map/.test(mech),
    "仍在源码里自己遍历写死的清单");
  ok("MechanicsView 圆点颜色取自语气映射（不再是嵌套三元的绿色兜底）",
    /TONE_VAR\[g\.tone\]/.test(mech), "颜色仍在用三元兜底");

  // ★★★ 行为断言 ①：今天的数据里，每一条红区都必须落在某个组里（总数守恒）
  {
    const groups = groupRedZones(idx.redZones as any);
    const rendered = groups.reduce((n, g) => n + g.rules.length, 0);
    ok("★★★ 每条红区都被渲染（分组总数 == 数据条数）", rendered === idx.redZones.length,
      rendered + " vs " + idx.redZones.length);
    const covered = new Set(groups.map(g => g.status));
    const present = new Set(idx.redZones.map((z: any) => z.status));
    ok("★★★ 数据里出现的每个状态都有对应的组", [...present].every(s => covered.has(s as string)),
      JSON.stringify([[...present], [...covered]]));
  }
  // ★★★ 行为断言 ②：喂一个**清单里没有的状态** —— 这正是原来会静默丢条目的场景
  {
    const fake = [
      ...(idx.redZones as any[]),
      { zone: "Z 假想", id: "FAKE_1", status: "DISPUTED", question: "?", evidence: "?", source: "test" },
      { zone: "Z 假想", id: "FAKE_2", status: "DISPUTED", question: "?", evidence: "?", source: "test" },
    ];
    ok("★★ 前置：DISPUTED 确实不在显示清单里", !STATUS_ORDER.includes("DISPUTED"));
    const groups = groupRedZones(fake as any);
    ok("★★★ 清单外的状态照样成组（不会静默丢条目）", groups.some(g => g.status === "DISPUTED"),
      JSON.stringify(groups.map(g => g.status)));
    ok("★★★ 总数守恒：清单外的条目也全在", groups.reduce((n, g) => n + g.rules.length, 0) === fake.length);
    const g = groups.find(x => x.status === "DISPUTED")!;
    ok("★★★ 清单外的状态用中性色（**不许**被画成 ok 绿）", g.tone === "idle" && TONE_VAR[g.tone] !== TONE_VAR.ok,
      g.tone);
    ok("★★ 清单外的状态文案写明界面未适配，且提示要补什么",
      /not yet supported by the UI/.test(g.label) && /STATUS_LABEL/.test(g.help), g.label + "｜" + g.help);
    ok("★ 已知状态的顺序不受影响（清单只管顺序）",
      groups.slice(0, STATUS_ORDER.filter(s => new Set(fake.map(z => z.status)).has(s)).length).map(x => x.status)
        .join(",") === STATUS_ORDER.filter(s => new Set(fake.map(z => z.status)).has(s)).join(","));
  }
ok("MechanicsView 明写「UNKNOWN 机制不会被猜测，只会被显式标注」", /UNKNOWN mechanics are never guessed, only explicitly flagged/.test(mech));
ok("MechanicsView 覆盖度面板含 FULL/PARTIAL/NONE 计数与明细", /COV_ORDER/.test(mech) && /covCounts/.test(mech) && /covList/.test(mech));
ok("MechanicsView 实验表可按组筛选（A/B/C/D）", /GROUP_ORDER/.test(mech) && /groupFilter/.test(mech));
ok("MechanicsView 实验表可按判别力筛选", /discFilter/.test(mech) && /discriminating/.test(mech));
ok("MechanicsView 每行展开显示 假设/方法/结果/结论", />Hypotheses </.test(mech) && />Method</.test(mech) && />Result </.test(mech) && />Verdict</.test(mech) && /expanded/.test(mech));
ok("MechanicsView 假设对比工具（同红区、结论相反；否则显示「无相反结论的实验对」）",
  /contrastPairs/.test(mech) && /No experiment pairs with opposite conclusions/.test(mech));
ok("MechanicsView 计数取自索引长度（不写死 44）", /exps\.length/.test(mech) && !/=== 44/.test(mech));
ok("MechanicsView 明确区分已验证与仍是假设", /is still a <b>hypothesis<\/b>/.test(mech) && /"Verified"/.test(mech));

console.log("\n══════════════════════════════════");
console.log("UI-5 验收：" + pass + " 通过 / " + fail + " 失败");
console.log("══════════════════════════════════");
if (fail > 0) process.exit(1);
