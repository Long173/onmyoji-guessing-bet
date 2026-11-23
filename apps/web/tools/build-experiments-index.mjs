// tools/build-experiments-index.mjs — 生成前端「机制实验台」索引
// 运行：node tools/build-experiments-index.mjs   （工作目录 apps/web）
//
// 原则：只做数据整形，不复制任何引擎逻辑。
//   · 44 个实验条目  ← battle-lab/experiments/results/_all.json（唯一数值来源）
//   · 红区规则元数据  ← 直接 import 引擎的 Policy 常量（id/status/question/evidence）
//   · 已验证规则      ← battle-lab/experiments/verified-rules.json
//   · 机制覆盖度      ← battle-lab/capability/coverage.json
// 任何字段都不得手写：源文件缺什么就留空，并记入 anomalies。
import fs from "node:fs/promises";
import path from "node:path";

import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../../../battle-lab/kernel/policies.ts";
import { ResourcePolicies } from "../../../battle-lab/kernel/resource.ts";
import { PriorityPolicies } from "../../../battle-lab/kernel/events.ts";
import { TieBreaks } from "../../../battle-lab/kernel/timeline.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const OUT = path.resolve(import.meta.dirname, "..", "src", "kb", "experiments.json");

const SRC = {
  all: "battle-lab/experiments/results/_all.json",
  definitions: "battle-lab/experiments/definitions.ts",
  groupsBcd: "battle-lab/experiments/groups-bcd.ts",
  verified: "battle-lab/experiments/verified-rules.json",
  coverage: "battle-lab/capability/coverage.json",
};
const readJSON = async p => JSON.parse(await fs.readFile(path.join(ROOT, p), "utf8"));
const readText = p => fs.readFile(path.join(ROOT, p), "utf8");

const anomalies = [];
const note = (kind, msg) => anomalies.push({ kind, msg });

// ───────────────────────── 1. 实验条目 ─────────────────────────
const raw = await readJSON(SRC.all);

// 组 → 红区名：从两个实验定义文件的段注释里取，不手写
function parseGroupZones(ts) {
  const out = {};
  for (const line of ts.split(/\r?\n/)) {
    const m = line.match(/^\s*\/\/\s*-{4,}\s*([ABCD])\s+(.+?)\s*-{4,}\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const defsTs = await readText(SRC.definitions);
const bcdTs = await readText(SRC.groupsBcd);
const GROUP_ZONE = Object.assign({}, parseGroupZones(defsTs), parseGroupZones(bcdTs));
for (const g of ["A", "B", "C", "D"]) {
  if (!GROUP_ZONE[g]) {
    note("GROUP_ZONE_MISSING", "实验定义文件缺少 " + g + " 组的段注释，redZone 退化为组号");
  }
}
const zoneOf = g => (GROUP_ZONE[g] ? g + " " + GROUP_ZONE[g] : g);

// TS 定义文件里的实验 id（用于与 _all.json 交叉校验，防漏跑/多跑）
const idsInTs = ts => [...ts.matchAll(/"([ABCD]\d{2})"/g)].map(m => m[1]);
const tsIds = new Set([...idsInTs(defsTs), ...idsInTs(bcdTs)]);
for (const e of raw) if (!tsIds.has(e.experiment)) note("EXPERIMENT_NOT_IN_TS", e.experiment + " 出现在 _all.json，但定义文件里找不到");
for (const id of tsIds) if (!raw.some(e => e.experiment === id)) note("EXPERIMENT_NOT_RUN", id + " 在定义文件里，但 _all.json 里没有结果");

// verdict：只反映数据里的「是否已实测 / 是否已选定假设」，绝不编造置信度数值
function verdictOf(e, verified) {
  if (verified.has(e.experiment)) return { level: "VERIFIED", text: "已验证 · 游戏内实测确认" };
  if (e.chosenHypothesis) return { level: "HYPOTHESIS", text: "已选定假设 " + e.chosenHypothesis + " · 尚未游戏内实测" };
  if (e.status === "AWAITING_IN_GAME_OBSERVATION") return { level: "UNKNOWN", text: "未验证 · 待游戏内观测" };
  if (e.status === "NOT_RUN") return { level: "UNKNOWN", text: "未验证 · 未运行" };
  return { level: "UNKNOWN", text: "未验证 · 状态 " + e.status };
}

const verifiedJson = await readJSON(SRC.verified);
const verifiedIds = new Set((verifiedJson.rules || []).map(r => r.id || r.experiment || ""));
if (verifiedIds.size === 0) {
  note("NO_VERIFIED_RULE", "verified-rules.json 的 rules 为空：当前没有任何机制被标为 VERIFIED（" + (verifiedJson._note || "") + "）");
}

// 观测值压缩成一行，供表格「结果」列展示（不改数值，只去掉空白）
const compact = v => JSON.stringify(v === undefined ? null : v).replace(/\s+/g, " ");

// 判别性自检：同一实验内各假设的观测（去掉 note 字段后）完全相同 → 实际不可判别
const NON_OBS_KEYS = ["note", "hypothesis", "specNote", "source"];
function observableFingerprint(obs) {
  if (obs === null || typeof obs !== "object" || Array.isArray(obs)) return JSON.stringify(obs);
  const o = {};
  for (const k of Object.keys(obs).sort()) if (NON_OBS_KEYS.indexOf(k) < 0) o[k] = obs[k];
  return JSON.stringify(o);
}
function observableIsEmpty(obs) {
  if (obs === null || obs === undefined) return true;
  if (Array.isArray(obs)) return obs.length === 0;
  if (typeof obs !== "object") return false;
  const keys = Object.keys(obs).filter(k => NON_OBS_KEYS.indexOf(k) < 0);
  if (keys.length === 0) return true;
  return keys.every(k => {
    const v = obs[k];
    return v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && Object.keys(v).length === 0);
  });
}

const experiments = raw.map(e => {
  const hyps = e.hypotheses || [];
  const fps = new Set(hyps.map(h => observableFingerprint(h.observable)));
  if (e.discriminating && hyps.length > 1 && fps.size === 1) {
    note("NON_DISCRIMINATING_OBSERVABLE", e.experiment + " 标称可判别，但各假设的观测（除 note 外）完全相同");
  }
  if (hyps.length > 1 && hyps.every(h => observableIsEmpty(h.observable))) {
    note("EMPTY_OBSERVABLE", e.experiment + " 各假设的观测为空，实验台未产出可判别的现象");
  }
  const v = verdictOf(e, verifiedIds);
  return {
    id: e.experiment,
    group: e.group,
    title: e.question || "",
    hypothesis: hyps.map(h => h.id + "：" + h.note).join("；"),
    method: e.inGameObservation || "",
    result: hyps.map(h => h.id + " → " + compact(h.observable)).join("；"),
    verdict: v.text,
    verdictLevel: v.level,
    discriminating: !!e.discriminating,
    redZone: zoneOf(e.group),
    // 以下为可追溯字段（UI 展开行 / 交叉校验用）
    kind: e.kind === undefined ? null : e.kind,
    status: e.status === undefined ? null : e.status,
    confidence: e.confidence === undefined ? null : e.confidence,
    chosenHypothesis: e.chosenHypothesis === undefined ? null : e.chosenHypothesis,
    distinctObservables: e.distinctObservables === undefined ? null : e.distinctObservables,
    hypotheses: hyps.map(h => ({ id: h.id, note: h.note, observable: h.observable === undefined ? null : h.observable })),
    recordedAt: e.recordedAt || null,
  };
});

const GROUP_ORDER = ["A", "B", "C", "D"];
const groupCounts = GROUP_ORDER.map(g => {
  const list = experiments.filter(e => e.group === g);
  return { group: g, zone: zoneOf(g), total: list.length, discriminating: list.filter(e => e.discriminating).length };
});
for (const g of GROUP_ORDER) if (groupCounts.filter(x => x.group === g)[0].total === 0) note("GROUP_EMPTY", g + " 组没有任何实验");

// 同组内多个实验共用同一套候选假设 → 说明判别力在组内是重复的
const bySig = new Map();
for (const e of raw) {
  const sig = e.group + "|" + (e.hypotheses || []).map(h => h.id).sort().join(",");
  if (!bySig.has(sig)) bySig.set(sig, []);
  bySig.get(sig).push(e.experiment);
}
for (const entry of bySig) {
  const sig = entry[0], list = entry[1];
  if (list.length > 2) note("DUPLICATE_HYPOTHESIS_SET", sig.split("|")[0] + " 组 " + list.length + " 个实验共用同一套候选假设（" + list.join(",") + "）");
}

// ───────────────────────── 2. 红区规则 ─────────────────────────
const POLICY_STATUS = ["UNKNOWN", "HYPOTHESIS", "VERIFIED"];
const redZones = [];
function pushPolicy(zone, source, p, questionKey) {
  let status = p.status;
  let rawStatus = null;
  if (POLICY_STATUS.indexOf(status) < 0) {   // 源文件出现了 PolicyStatus 之外的状态值
    rawStatus = status;
    status = "UNKNOWN";
    note("POLICY_STATUS_OUT_OF_ENUM", source + " 的 " + p.id + " status=" + rawStatus + " 不在 {UNKNOWN,HYPOTHESIS,VERIFIED} 内，已按 UNKNOWN 归一");
  }
  const q = (questionKey ? p[questionKey] : undefined) || p.question || "";
  if (!q) note("POLICY_QUESTION_MISSING", source + " 的 " + p.id + " 没有 question 字段，索引中留空");
  const item = { zone: zone, id: p.id, status: status, question: q, evidence: p.evidence || "", source: source };
  if (rawStatus) item.rawStatus = rawStatus;
  redZones.push(item);
}
const ZONE_A = zoneOf("A"), ZONE_B = zoneOf("B"), ZONE_C = zoneOf("C");
const ZONE_D_GUESS = zoneOf("D") + " · 竞猜残局";
const ZONE_D_ORB = zoneOf("D") + " · 鬼火初始化与回火";
for (const p of Object.values(StartupPolicies)) pushPolicy(ZONE_A, "battle-lab/kernel/policies.ts", p);
for (const p of Object.values(PriorityPolicies)) pushPolicy(ZONE_B, "battle-lab/kernel/events.ts", p);
for (const p of Object.values(TieBreaks)) pushPolicy(ZONE_B, "battle-lab/kernel/timeline.ts", p, "note");
for (const p of Object.values(DeathPolicies)) pushPolicy(ZONE_C, "battle-lab/kernel/policies.ts", p);
for (const p of Object.values(GuessingRulesets)) pushPolicy(ZONE_D_GUESS, "battle-lab/kernel/policies.ts", p);
for (const p of Object.values(ResourcePolicies)) pushPolicy(ZONE_D_ORB, "battle-lab/kernel/resource.ts", p);

const redZoneStatusCounts = POLICY_STATUS.reduce((a, s) => (a[s] = redZones.filter(z => z.status === s).length, a), {});
if (redZoneStatusCounts.VERIFIED === 0 && verifiedIds.size === 0) {
  note("NO_VERIFIED_RED_ZONE", "红区规则 0 条 VERIFIED —— 与 verified-rules.json 为空一致（不是解析错误）");
}

// ───────────────────────── 3. 机制覆盖度 ─────────────────────────
const covJson = await readJSON(SRC.coverage);
const cov = covJson.cov || {};
const coverage = (covJson.rows || []).map(r => ({
  capability: r.key,
  status: r.support,
  note: r.note || "",
  tag: r.tag || "",
  evidence: r.evidence || "",
  freq: r.freq === undefined ? null : r.freq,
}));
const covStatus = ["FULL", "PARTIAL", "NONE"];
for (const r of coverage) if (covStatus.indexOf(r.status) < 0) note("COVERAGE_STATUS_OUT_OF_ENUM", r.capability + " support=" + r.status);
const counted = covStatus.reduce((a, s) => (a[s] = coverage.filter(c => c.status === s).length, a), {});
if (coverage.length !== cov.total) note("COVERAGE_TOTAL_MISMATCH", "rows " + coverage.length + " != cov.total " + cov.total);
for (const pair of [["FULL", "full"], ["PARTIAL", "partial"], ["NONE", "none"]]) {
  if (counted[pair[0]] !== cov[pair[1]]) note("COVERAGE_COUNT_MISMATCH", pair[0] + " rows=" + counted[pair[0]] + " != cov." + pair[1] + "=" + cov[pair[1]]);
}
const emptyNote = coverage.filter(c => !c.note);
if (emptyNote.length) note("COVERAGE_NOTE_EMPTY", emptyNote.length + " 条覆盖度没有 note（" + emptyNote.map(c => c.capability).join(",") + "）");
const noneNoNote = emptyNote.filter(c => c.status === "NONE");
if (noneNoNote.length) note("COVERAGE_NONE_NO_REASON", noneNoNote.length + " 条 NONE 没有写未实现原因（" + noneNoNote.map(c => c.capability).join(",") + "）");
const missingInRows = (cov.unsupported || []).filter(k => !coverage.some(c => c.capability === k));
if (missingInRows.length) note("COVERAGE_UNSUPPORTED_MISSING", "cov.unsupported 里的 " + missingInRows.join(",") + " 在 rows 里找不到");

// ───────────────────────── 4. 汇总与写出 ─────────────────────────
const recordedAt = raw.map(e => e.recordedAt).filter(Boolean).sort().pop() || null;
const gameVersions = [...new Set(raw.map(e => e.gameVersion).filter(Boolean))];
if (gameVersions.length > 1) note("GAME_VERSION_MIXED", "实验的 gameVersion 不一致：" + gameVersions.join(" / "));

const out = {
  meta: {
    dataVersion: "GameData 2026-10-01",
    gameVersion: gameVersions[0] || null,
    dataRecordedAt: recordedAt,
    generatedBy: "apps/web/tools/build-experiments-index.mjs",
    sources: Object.values(SRC),
    policySources: [
      "battle-lab/kernel/policies.ts", "battle-lab/kernel/resource.ts",
      "battle-lab/kernel/events.ts", "battle-lab/kernel/timeline.ts",
    ],
  },
  groups: groupCounts,
  experiments: experiments,
  redZones: redZones,
  redZoneStatusCounts: redZoneStatusCounts,
  verifiedRules: {
    count: verifiedIds.size,
    ids: [...verifiedIds],
    note: verifiedJson._note || "",
  },
  coverage: coverage,
  coverageSummary: {
    total: cov.total === undefined ? coverage.length : cov.total,
    full: cov.full === undefined ? counted.FULL : cov.full,
    partial: cov.partial === undefined ? counted.PARTIAL : cov.partial,
    none: cov.none === undefined ? counted.NONE : cov.none,
    kernelCoverage: cov.kernelCoverage === undefined ? null : cov.kernelCoverage,
    hardCoverage: cov.hardCoverage === undefined ? null : cov.hardCoverage,
    unsupported: cov.unsupported || [],
  },
  anomalies: anomalies,
};

await fs.writeFile(OUT, JSON.stringify(out), "utf8");

// ───────────────────────── 5. 打印统计 ─────────────────────────
const kb = (await fs.stat(OUT)).size / 1024;
const dist = g => groupCounts.filter(x => x.group === g)[0].total;
const verdictDist = experiments.reduce((a, e) => (a[e.verdictLevel] = (a[e.verdictLevel] || 0) + 1, a), {});
const byZone = new Map();
for (const e of experiments) { if (!byZone.has(e.redZone)) byZone.set(e.redZone, []); byZone.get(e.redZone).push(e); }
let contrastPairs = 0;
for (const list of byZone.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
  if (list[i].verdictLevel !== list[j].verdictLevel) contrastPairs++;
}
console.log("=== 机制实验索引已生成 ===");
console.log("  输出 " + path.relative(ROOT, OUT).replace(/\\/g, "/") + "  (" + kb.toFixed(1) + " KB)");
console.log("  experiments  " + experiments.length + " 条（A " + dist("A") + " / B " + dist("B") + " / C " + dist("C") + " / D " + dist("D") + "）"
  + "｜可判别 " + experiments.filter(e => e.discriminating).length + " / 不可判别 " + experiments.filter(e => !e.discriminating).length);
console.log("  verdictLevel  " + JSON.stringify(verdictDist));
console.log("  redZones     " + redZones.length + " 条（" + POLICY_STATUS.map(s => s + " " + redZoneStatusCounts[s]).join(" / ") + "）"
  + "｜VERIFIED 规则 " + verifiedIds.size + " 条");
console.log("  coverage     " + coverage.length + " 条（" + covStatus.map(s => s + " " + counted[s]).join(" / ") + "）"
  + "｜kernelCoverage " + cov.kernelCoverage + "% / hardCoverage " + cov.hardCoverage + "%");
console.log("  假设对比     " + contrastPairs + " 对（同一红区内 verdictLevel 不同）");
console.log("  异常/缺口    " + anomalies.length + " 条");
for (const a of anomalies) console.log("    · [" + a.kind + "] " + a.msg);
