// tools/g0-state-audit.ts — G0「BattleState 收口」的残酷测试（a1-4.md §55）
//
// 文档要求先做这一件事，再谈动画：
//   JSON.stringify(battle.state)
// 如果关键状态 序列化不了 / 藏在 closure / 藏在 class private / 藏在 Skill runtime / 依赖函数引用，
// 就先解决它。目标是：暂停 → 保存 state → 杀掉 Engine → 重载 → 继续完全相同地战斗。
//
// 本脚本不修改任何引擎代码，只做**体检**：把 Battle 的全部可达对象走一遍，
// 按「可序列化 / 函数 / Map-Set / 循环引用 / 类实例」分类，输出到 fixtures/g0-state-audit.json。
//
// 运行：cd battle-lab && node tools/g0-state-audit.ts
import fs from "node:fs/promises";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

const here = import.meta.dirname;
const ROOT = path.resolve(here, "..", "..");

const bundle = JSON.parse(await fs.readFile(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const kit = createKit(bundle);
const a = assembleMatch(kit, canonicalMatch(), { seed: 20261001 });
const battle: any = a.battle;
const result = await battle.run();

interface Finding { path: string; kind: string; detail: string }
const findings: Finding[] = [];
/** 祖先链：只有"访问到自己"才是真环；重复访问非祖先对象只是**共享引用**（JSON 会复制一份，不报错） */
const stack = new WeakSet<object>();
const visited = new WeakSet<object>();
let leaves = 0, sharedRefs = 0;

function kindOf(v: any): string {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "function") return "function";
  if (t !== "object") return "value";
  if (Array.isArray(v)) return "array";
  if (v instanceof Map) return "Map";
  if (v instanceof Set) return "Set";
  const ctor = v.constructor?.name ?? "Object";
  if (ctor !== "Object") return "class:" + ctor;
  return "object";
}

function walk(v: any, p: string, depth: number) {
  const k = kindOf(v);
  if (k === "function") { findings.push({ path: p, kind: "function", detail: "函数引用无法序列化（closure / 运行时对象）" }); return; }
  if (k === "Map" || k === "Set") { findings.push({ path: p, kind: k, detail: k + " 不会被 JSON.stringify 保留（会变成 {}）" }); return; }
  if (k.startsWith("class:")) findings.push({ path: p, kind: k, detail: "类实例：JSON 只保留自有可枚举字段，原型方法丢失" });
  if (k === "value" || k === "null") { leaves++; return; }
  if (typeof v === "object") {
    if (stack.has(v)) { findings.push({ path: p, kind: "true-cycle", detail: "祖先链回环：JSON.stringify 会抛 TypeError" }); return; }
    if (visited.has(v)) { sharedRefs++; return; }   // 共享引用：序列化会复制，不阻断 G0
    visited.add(v); stack.add(v);
    if (depth > 12) { stack.delete(v); return; }
    if (Array.isArray(v)) {
      for (let i = 0; i < Math.min(v.length, 40); i++) walk(v[i], p + "[" + i + "]", depth + 1);
    } else {
      for (const key of Object.keys(v)) walk(v[key], p + "." + key, depth + 1);
    }
    stack.delete(v);
  }
}

// ① Battle 自身字段
for (const key of Object.keys(battle)) walk(battle[key], "battle." + key, 0);

// ② 尝试真的 JSON.stringify
let stringifyOk = false, stringifyErr = "";
try { JSON.stringify(battle); stringifyOk = true; } catch (e: any) { stringifyErr = String(e?.message ?? e); }

// ③ 逐类统计
const byKind: Record<string, number> = {};
for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;

// ④ Skill runtime 专项（文档点名的"藏在 Skill runtime"）
const skillFindings = findings.filter(f => /skills\[/.test(f.path));

const report = {
  meta: {
    title: "G0 BattleState 体检",
    source: "a1-4.md §55",
    generatedAt: new Date().toISOString(),
    seed: 20261001,
    turns: result.turns,
    winner: result.winner,
  },
  stringify: { ok: stringifyOk, error: stringifyErr, bytes: stringifyOk ? JSON.stringify(battle).length : null },
  summary: { findings: findings.length, leaves, sharedRefs, trueCycles: findings.filter(f => f.kind === "true-cycle").length, byKind, skillRuntimeIssues: skillFindings.length },
  findings: findings.slice(0, 400),
};

await fs.mkdir(path.join(here, "..", "fixtures"), { recursive: true });
await fs.writeFile(path.join(here, "..", "fixtures", "g0-state-audit.json"), JSON.stringify(report, null, 1), "utf8");

console.log("=== G0 BattleState 体检（a1-4.md §55）===");
console.log(`对局：${result.turns} 回合，winner=${result.winner}`);
console.log(`JSON.stringify(battle) → ${stringifyOk ? "成功（" + report.stringify.bytes + " 字节）" : "❌ 抛错：" + stringifyErr}`);
console.log(`扫描到 ${findings.length} 处阻碍，按类型：${JSON.stringify(byKind)}`);
console.log("\n最先要处理的 15 处：");
for (const f of findings.slice(0, 15)) console.log(`  [${f.kind}] ${f.path}  — ${f.detail}`);
console.log("\nSkill runtime 内的阻碍（文档点名）：" + skillFindings.length + " 处");
for (const f of skillFindings.slice(0, 5)) console.log(`  ${f.path}  (${f.kind})`);
console.log("\n完整报告：battle-lab/fixtures/g0-state-audit.json");
