// tests/ui6-hud-lab.ts — UI-6（Developer HUD + 观测登记）验收测试
// 运行：node tests/ui6-hud-lab.ts   （工作目录 apps/web）
// 风格与 ui1 / ui5 一致：无框架、手写 ok()/section()、Node 直接跑 .ts。
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

const FACTS_FILE = "dev/facts.ts";
const OBS_FILE = "lab/observations.ts";
const HUD_FILE = "components/dev/DeveloperHud.vue";
const MECH_FILE = "components/mechanics/MechanicsView.vue";

// ══════════════════════════════════════════════════════════
section("[0] 文件存在性");
for (const f of [FACTS_FILE, OBS_FILE, HUD_FILE, MECH_FILE]) ok(f + " 存在", existsSync(join(src, f)));

// ══════════════════════════════════════════════════════════
section("[1] facts.ts：事实清单的结构与必列条目的实测数值");
const factsMod = await import("../src/dev/facts.ts");
const FACTS: any[] = factsMod.FACTS;
ok("FACTS 是数组且至少 8 条", Array.isArray(FACTS) && FACTS.length >= 8, "got " + (FACTS?.length ?? "n/a"));
ok("每条 title / detail / evidence 非空（id 亦然）", FACTS.every(f =>
  ["id", "title", "detail", "evidence"].every(k => typeof f[k] === "string" && f[k].trim().length > 0)));
ok("severity 都是 INFO / WARN / BLOCK", FACTS.every(f => ["INFO", "WARN", "BLOCK"].includes(f.severity)));
ok("id 唯一且形如 F01 / F14", new Set(FACTS.map(f => f.id)).size === FACTS.length && FACTS.every(f => /^F[0-9]{2}$/.test(f.id)));
ok("三种 severity 都出现过（不是全 INFO）", new Set(FACTS.map(f => f.severity)).size === 3, FACTS.map(f => f.severity).join(","));
const sevCount = factsMod.countBySeverity();
ok("countBySeverity 与实算一致", ["INFO", "WARN", "BLOCK"].every(s => sevCount[s] === FACTS.filter(f => f.severity === s).length));
ok("每条 evidence 都能指到测试 / 数据 / 报告（不是空话）",
  FACTS.every(f => /tests\/|\.json|\.ts|\.md|报告/.test(f.evidence)));

const blob = FACTS.map(f => [f.id, f.title, f.detail, f.evidence].join(" ")).join("\n");
const REQUIRED: Array<[string, RegExp]> = [
  ["① 技能解析顺序无关性 + 全库 818 条锁死", /parse-determinism/],
  ["① 座敷童子「魂之火」被静默丢弃的 lastIndex bug", /lastIndex/],
  ["② AI 规则 141\/421 cond 为空 + 思金神 601", /141[^0-9][\s\S]{0,400}421|421[\s\S]{0,400}141/],
  ["② 0 鬼火被反复施放", /Omoikane[\s\S]{0,200}0 Onibi|0 Onibi[\s\S]{0,200}Omoikane/],
  ["③ 引擎没有暴击事件（EV 无 CRI）+ 针女 / 地藏像", /CRI[\s\S]{0,400}Seductress[\s\S]{0,400}Jizo Statue|Seductress[\s\S]{0,400}Jizo Statue/],
  ["④ 7 只缺失攻 / 生 / 防（433 … 593）", /433[\s\S]{0,120}593|593[\s\S]{0,120}433/],
  ["⑤ 44 条实验全 NOT_RUN、chosenHypothesis 全 null、VERIFIED = 0", /NOT_RUN[\s\S]{0,300}chosenHypothesis|null[\s\S]{0,120}VERIFIED = 0|VERIFIED = 0/],
  ["⑥ 顺序 seed 相关性未检出（卡方 49.7 / 散列 47.3 / df=39）", /49\.7[\s\S]{0,200}47\.3|47\.3[\s\S]{0,200}49\.7/],
  ["⑥ 明确写成否定结果", /not detected|negative result/],
  ["⑦ 引擎未记录鬼火消耗，avgOrbSpent 恒为 0", /avgOrbSpent[\s\S]{0,80}0|恒为 0|恒填 0/],
  ["⑧ 性能基线 1.6 ms / 642 局每秒", /1\.6\s?ms[\s\S]{0,120}642|642[\s\S]{0,200}1\.6/],
  ["⑨ 御魂静态属性不参与计算（面板即截图终值）", /static stats are not counted/],
];
for (const [label, re] of REQUIRED) ok("必列事实：" + label, re.test(blob), "正则 " + String(re));
ok("facts.ts 里出现「44」条实验与「df = 39」", /44/.test(blob) && /df\s?=\s?39/.test(blob));

// ══════════════════════════════════════════════════════════
section("[2] facts.ts 的数值与源数据一致（防止清单被改飘）");
const aiRaw = RJ("data/kb/ai.json") as any[];
let castRules = 0, emptyCond = 0;
for (const u of aiRaw) for (const c of (u.cast ?? [])) { castRules++; if (!String(c.cond ?? "").trim()) emptyCond++; }
ok("源数据 ai.json：272 只 / 421 条 cast 规则 / 141 条空 cond",
  aiRaw.length === 272 && castRules === 421 && emptyCond === 141, aiRaw.length + "/" + castRules + "/" + emptyCond);
const full = RJ("data/kb/shikigami.full.json") as any[];
const onmyoji = full.filter(x => x.rarity === "阴阳师" || x.rarity === "英杰");
ok("源数据式神 282 只（含 6 阴阳师 / 英杰）/ 技能 818 条",
  full.length === 282 && full.reduce((a, x) => a + (x.skills?.length ?? 0), 0) === 818 && onmyoji.length === 6,
  full.length + "/" + full.reduce((a, x) => a + (x.skills?.length ?? 0), 0) + "/" + onmyoji.length);
const buffs = RJ("data/kb/buffs.json") as any;
ok("源数据 buff 338 条", Object.keys(buffs).length === 338, String(Object.keys(buffs).length));
const shiki = J("kb/shikigami-index.json") as any[];
ok("网页索引 276 只 / 拼音 276 / has.ai 272 / 技能合计 798",
  shiki.length === 276 && shiki.filter(x => x.p).length === 276 && shiki.filter(x => x.has?.ai).length === 272 &&
  shiki.reduce((a, x) => a + (x.has?.skills ?? 0), 0) === 798);
const souls = J("kb/soul-index.json") as any[];
const soulDist = souls.reduce((a: any, s: any) => (a[s.engine.support] = (a[s.engine.support] ?? 0) + 1, a), {});
// 同上：火灵在第 25 轮升为 FULL（ORB_START），索引重新生成后分布变为 6/32/32。
ok("御魂 70 条，支持度 FULL 6 / PARTIAL 32 / UNSUPPORTED 32（火灵已升为 FULL）",
  souls.length === 70 && soulDist.FULL === 6 && soulDist.PARTIAL === 32 && soulDist.UNSUPPORTED === 32, JSON.stringify(soulDist));
ok("术语 156 条", (J("kb/glossary.json") as any[]).length === 156);
const expIdx = J("kb/experiments.json") as any;
ok("实验 44 条，confidence 全 NOT_RUN / chosenHypothesis 全 null / VERIFIED 0",
  expIdx.experiments.length === 44 &&
  expIdx.experiments.every((e: any) => e.confidence === "NOT_RUN" && e.chosenHypothesis === null) &&
  expIdx.redZoneStatusCounts.VERIFIED === 0);
ok("parse-determinism.ts 存在且锁死 818 条技能", (() => {
  const p = join(root, "battle-lab", "tests", "parse-determinism.ts");
  return existsSync(p) && /818/.test(readFileSync(p, "utf8"));
})());
const adapter = S("adapters/engine-adapter.ts");
ok("适配器：avgOrbSpent 恒 0 且写进 unsupportedCapabilities",
  /avgOrbSpentRed: 0, avgOrbSpentBlue: 0/.test(adapter) &&
  /avgOrbSpent\* \(engine has no Onibi-spent counter\)/.test(adapter));

// ══════════════════════════════════════════════════════════
section("[3] observations.ts：没有 localStorage 时绝不抛");
const obs = await import("../src/lab/observations.ts");
const API = ["loadAll", "listFor", "add", "remove", "exportJson", "stats"];
ok("导出 loadAll / listFor / add / remove / exportJson / stats", API.every(k => typeof obs[k] === "function"),
  API.filter(k => typeof obs[k] !== "function").join(","));
ok("存储 key = yys.lab.observations.v1", obs.OBSERVATIONS_KEY === "yys.lab.observations.v1", String(obs.OBSERVATIONS_KEY));
ok("来源 4 选 1 / 置信度 3 选 1 的常量齐全",
  JSON.stringify([...obs.OBSERVATION_SOURCES]) === JSON.stringify(["IN_GAME", "COMMUNITY", "DATAMINE", "THEORY"]) &&
  JSON.stringify([...obs.OBSERVATION_CONFIDENCES]) === JSON.stringify(["LOW", "MEDIUM", "HIGH"]));
ok("政策说明写明「不会自动改成 VERIFIED」", /never marks a rule as VERIFIED automatically/.test(obs.OBSERVATION_POLICY_NOTE));

// 先确保真的没有 localStorage（Node 默认没有；有就显式置空，保证这段测的是容错分支）
try { Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true, writable: true }); } catch { /* ignore */ }
ok("当前环境确实没有 localStorage（前置条件）", typeof (globalThis as any).localStorage === "undefined");
ok("没有 localStorage：loadAll() 返回 [] 且不抛", (() => {
  try { const r = obs.loadAll(); return Array.isArray(r) && r.length === 0; } catch { return false; }
})());
ok("没有 localStorage：listFor() / stats() / exportJson() 也不抛", (() => {
  try {
    const a = obs.listFor("A01"), s = obs.stats(), e = obs.exportJson();
    return Array.isArray(a) && a.length === 0 && s.total === 0 && JSON.parse(e).length === 0;
  } catch { return false; }
})());
ok("没有 localStorage：remove() 返回 false 而不是抛", obs.remove("nope") === false);
ok("没有 localStorage：isPersistent() 为 false（不假装已持久化）", obs.isPersistent() === false);

// ══════════════════════════════════════════════════════════
section("[4] observations.ts：内存版 localStorage 打桩后完整工作");
const store = new Map<string, string>();
const stub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true });

const recA = obs.add({
  experimentId: "A01", source: "IN_GAME", claim: "先机先于御魂结算",
  evidenceText: "录屏 00:12", confidence: "MEDIUM", author: "tester",
  observedAt: "2026-01-01T00:00:00.000Z",
});
const recB = obs.add({
  experimentId: "B02", source: "THEORY", claim: "同优先级按注册顺序",
  evidenceText: "", confidence: "LOW", author: "", observedAt: "2026-02-01T00:00:00.000Z",
});
ok("add 返回完整记录（id / observedAt 自动补全）",
  !!recA.id && /^obs-/.test(recA.id) && !!recA.observedAt && recA.claim === "先机先于御魂结算");
ok("两条 id 不同", recA.id !== recB.id, recA.id + " / " + recB.id);
ok("确实写进了 localStorage（不是只留在内存）",
  JSON.parse(store.get(obs.OBSERVATIONS_KEY) ?? "[]").length === 2);
ok("loadAll() 返回 2 条且按时间倒序（新登记的在前）",
  obs.loadAll().length === 2 && obs.loadAll()[0].experimentId === "B02" && obs.loadAll()[1].experimentId === "A01");
ok("listFor('A01') 只返回该实验的观测", obs.listFor("A01").length === 1 && obs.listFor("A01")[0].id === recA.id);
ok("listFor('ZZ') 返回空数组", obs.listFor("ZZ").length === 0);
const st = obs.stats();
ok("stats：总数 2 / 按来源 IN_GAME 1 + THEORY 1 / 按实验各 1",
  st.total === 2 && st.bySource.IN_GAME === 1 && st.bySource.THEORY === 1 &&
  st.bySource.COMMUNITY === 0 && st.bySource.DATAMINE === 0 && st.byExperiment.A01 === 1 && st.byExperiment.B02 === 1,
  JSON.stringify(st));
const exported = obs.exportJson();
const reparsed = JSON.parse(exported) as any[];
ok("exportJson() 能被 JSON.parse 回来且条数一致", reparsed.length === obs.loadAll().length && reparsed.length === 2);
ok("导出的每条都带全部 8 个字段", reparsed.every(r =>
  ["id", "experimentId", "observedAt", "source", "claim", "evidenceText", "confidence", "author"].every(k => k in r)));
ok("remove 存在的 id 返回 true，删完只剩 1 条", obs.remove(recA.id) === true && obs.loadAll().length === 1);
ok("remove 同时落盘（localStorage 里也只剩 1 条）",
  JSON.parse(store.get(obs.OBSERVATIONS_KEY) ?? "[]").length === 1);

const ids = new Set<string>();
for (let i = 0; i < 200; i++) {
  ids.add(obs.add({ experimentId: "X99", source: "DATAMINE", claim: "第 " + i + " 条", evidenceText: "", confidence: "HIGH", author: "" }).id);
}
ok("add 生成的 id 唯一（200 条全不同，且都带 obs- 前缀）", ids.size === 200 && [...ids].every(x => /^obs-/.test(x)));

// 容错：损坏 / 结构不对 / 混入垃圾
store.set(obs.OBSERVATIONS_KEY, "{oops");
ok("JSON 损坏时 loadAll() 返回 [] 而不是抛", (() => {
  try { const r = obs.loadAll(); return Array.isArray(r) && r.length === 0; } catch { return false; }
})());
store.set(obs.OBSERVATIONS_KEY, '"not an array"');
ok("JSON 合法但不是数组时也返回 []", obs.loadAll().length === 0);
store.set(obs.OBSERVATIONS_KEY, JSON.stringify([{ experimentId: "C01", claim: "半残条目" }, 42, "junk", null]));
const salvaged = obs.loadAll();
ok("混入垃圾时保留对象条目、丢掉非对象（不抛、不改写原值）",
  salvaged.length === 1 && salvaged[0].experimentId === "C01" && salvaged[0].claim === "半残条目" &&
  typeof salvaged[0].id === "string" && salvaged[0].id.length > 0);

// add 的输入校验（明确报错，而不是静默存一条废记录）
let throws = 0;
try { obs.add({ experimentId: "", source: "THEORY", claim: "x", evidenceText: "", confidence: "LOW", author: "" }); } catch { throws++; }
try { obs.add({ experimentId: "A01", source: "THEORY", claim: "   ", evidenceText: "", confidence: "LOW", author: "" }); } catch { throws++; }
ok("add 对空 experimentId / 空 claim 明确抛错（不存废记录）", throws === 2, "throws=" + throws);

// 写入失败（配额满 / 隐私模式）→ 不抛，本会话内仍可读
store.set(obs.OBSERVATIONS_KEY, JSON.stringify([]));
stub.setItem = () => { throw new Error("QuotaExceededError"); };
let quotaThrew = false;
let quotaRec: any = null;
try { quotaRec = obs.add({ experimentId: "D04", source: "IN_GAME", claim: "配额满时仍要能登记", evidenceText: "", confidence: "HIGH", author: "" }); }
catch { quotaThrew = true; }
ok("setItem 抛异常（配额满）时 add 不抛，并返回记录", !quotaThrew && !!quotaRec && /^obs-/.test(quotaRec.id));
ok("配额满后本会话内仍能读到刚登记的观测（退化为内存，不假装已持久化）",
  obs.loadAll().some(r => r.id === quotaRec.id) && obs.isPersistent() === false);

// ══════════════════════════════════════════════════════════
section("[5] observations.ts：只存观测，绝不动实验状态");
const obsSrc = S(OBS_FILE);
ok("只碰 localStorage，不 import / 不读实验索引与 verified-rules（注释里点名不算）",
  /localStorage/.test(obsSrc) &&
  !/from\s+["'][^"']*experiments/.test(obsSrc) && !/verified-rules["']/.test(obsSrc) &&
  !/readFileSync|fetch\(|XMLHttpRequest|require\(/.test(obsSrc));
ok("模块内没有任何 VERIFIED 赋值（只出现在说明文案里）",
  !/=\s*["']VERIFIED["']/.test(obsSrc));

// ══════════════════════════════════════════════════════════
section("[6] DeveloperHud.vue：只读 HUD，不碰引擎");
ok(HUD_FILE + " 存在", existsSync(join(src, HUD_FILE)));
const hud = S(HUD_FILE);
ok("props: { open: boolean }", /defineProps<\{\s*open:\s*boolean\s*\}>/.test(hud));
ok("emit: close", /defineEmits<\{\s*\(e:\s*"close"\)/.test(hud));
ok("不 import 引擎模块（全文无引擎路径字样）", !/battle-lab|@engine/.test(hud));
ok("引用 dev/facts.ts 的 FACTS", /dev\/facts\.ts/.test(hud) && /FACTS/.test(hud));
const hudImports = [...hud.matchAll(/import[^;]*?from\s+"([^"]+)"/g)].map(m => m[1])
  .concat([...hud.matchAll(/import\("([^"]+)"\)/g)].map(m => m[1]));
ok("import 清单里没有 621KB 数据包（不把 bundle.json 拉进主 chunk）",
  hudImports.length > 0 && !hudImports.some(p => /bundle\.json/.test(p)), hudImports.join(" · "));
ok("版本：引擎 / 游戏数据 / 契约 schemaVersion 都来自常量或结果 DTO",
  /ENGINE_VERSION/.test(hud) && /GAME_DATA_VERSION/.test(hud) && /GUESSING_SCHEMA_VERSION/.test(hud));
ok("数据规模从索引动态算（SHIKIGAMI / SOULS / GLOSSARY 的 length）",
  /SHIKIGAMI\.length/.test(hud) && /SOULS\.length/.test(hud) && /GLOSSARY\.length/.test(hud));
ok("算不出来的写「—」而不是编数字", /"—"/.test(hud));
ok("本次运行读 useSimulationStore", /useSimulationStore/.test(hud) && /sim\.result/.test(hud) && /sim\.validation/.test(hud));
ok("校验报告展示 blockers 与 warnings 数量", /blockers\.length/.test(hud) && /warnings\.length/.test(hud));
ok("策略快照覆盖 5 个红区（开局结算 / 同时触发 / 死亡结算 / 竞猜残局 / 鬼火）",
  /Battle-start resolution/.test(hud) && /Simultaneous triggers/.test(hud) && /Death resolution/.test(hud) && /Betting endgame/.test(hud) && /"Onibi"/.test(hud) &&
  /strategySnapshot/.test(hud));
ok("UNKNOWN 用警示色（.st.unknown → var(--danger)）", /\.pol \.st\.unknown/.test(hud) && /var\(--danger\)/.test(hud));
ok("覆盖度：units / skills / ai / souls + unsupportedCapabilities 逐条",
  /unitsJoined/.test(hud) && /skillsAvailable/.test(hud) && /aiHigh/.test(hud) && /soulsResolved/.test(hud) &&
  /unsupportedCapabilities/.test(hud));
ok("覆盖度标注了口径：本局 10 只，不是全库", /the 10 units in this battle/.test(hud));
ok("实测事实清单渲染 facts.ts 并按 severity 着色",
  /v-for="f in FACTS"/.test(hud) && /SEV_CLASS\[f\.severity\]/.test(hud) &&
  /sev-block/.test(hud) && /sev-warn/.test(hud) && /sev-info/.test(hud));
ok("文件地图含 contracts / engine / adapters / workers / stores / components / tests / tools",
  ["contracts/", "engine/", "adapters/", "workers/", "stores/", "components/", "tests/", "tools/"].every(d => hud.includes(d)));
ok("底部抽屉：fixed 定位 + 约 60vh + 可滚动",
  /position: fixed/.test(hud) && /height: 60vh/.test(hud) && /overflow-y: auto/.test(hud));
ok("折叠由 props.open 控制（关着时不占指针事件）", /\.hudwrap\.open/.test(hud) && /pointer-events: none/.test(hud));
ok("懒加载 experiments.json（不在主 chunk 里塞 78KB 索引）", /await import\("\.\.\/\.\.\/kb\/experiments\.json"\)/.test(hud));

// ══════════════════════════════════════════════════════════
section("[7] MechanicsView.vue：新增「观测登记」区块（其余部分保持原样）");
const mech = S(MECH_FILE);
ok("含「观测登记」区块", /观测登记/.test(mech));
ok("import 了 lab/observations.ts", /from "\.\.\/\.\.\/lab\/observations\.ts"/.test(mech));
ok("写明「不会自动…VERIFIED」的意思（文件内字面 + 渲染仓库常量）",
  /不会自动把任何规则改成 VERIFIED/.test(mech) && /OBSERVATION_POLICY_NOTE/.test(mech));
ok("表单：实验下拉（来自 experiments.json 的 exps）+ 来源 4 选 1 + 置信度 3 选 1",
  /v-model="obsForm\.experimentId"/.test(mech) && /v-for="e in exps"/.test(mech) &&
  /OBSERVATION_SOURCES/.test(mech) && /OBSERVATION_CONFIDENCES/.test(mech));
ok("表单：结论文本 / 证据文本 / 登记人", /obsForm\.claim/.test(mech) && /obsForm\.evidenceText/.test(mech) && /obsForm\.author/.test(mech));
ok("保存前校验（空实验 / 空结论给出明确错误）", /Please select an experiment first/.test(mech) && /Conclusion text must not be empty/.test(mech));
ok("列表按时间倒序 + 可删除", /obsShown/.test(mech) && /deleteObservation/.test(mech) && /Newest observation first/.test(mech));
ok("统计：总数 / 按来源", /obsStat\.total/.test(mech) && /obsStat\.bySource/.test(mech));
ok("支持按实验筛选", /obsFilter/.test(mech) && /按实验筛选/.test(mech));
ok("导出按钮：复制到剪贴板，失败退化为只读 textarea",
  /navigator\.clipboard\.writeText/.test(mech) && /obsExportText/.test(mech) && /readonly/.test(mech));
ok("保存成功后仍强调状态没有被改动", /Experiment status was not changed/.test(mech));
const mechTpl = mech.slice(mech.indexOf("<template>"), mech.indexOf("<style"));
ok("区块排在实验表之后（模板里「观测登记」晚于实验表标题）",
  mechTpl.indexOf("<!-- ───────── 实验表 ───────── -->") >= 0 &&
  mechTpl.indexOf("观测登记") > mechTpl.indexOf("<!-- ───────── 实验表 ───────── -->"),
  "实验表@" + mechTpl.indexOf("<!-- ───────── 实验表 ───────── -->") + " 观测登记@" + mechTpl.indexOf("观测登记"));
ok("原 UI-5 结构仍在（红区状态 / 机制覆盖度 / 假设对比 / 数据异常）",
  /红区状态/.test(mech) && /机制覆盖度/.test(mech) && /假设对比/.test(mech) && /数据异常与缺口/.test(mech));
ok("不 import 引擎（全文无引擎路径字样）", !/battle-lab|@engine/.test(mech));

console.log("\n══════════════════════════════════");
console.log("UI-6 验收：" + pass + " 通过 / " + fail + " 失败");
console.log("══════════════════════════════════");
if (fail > 0) process.exit(1);
