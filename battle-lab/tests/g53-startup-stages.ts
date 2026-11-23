// tests/g53-startup-stages.ts — ★★★ 开局阶段表与 switch 分支必须**逐条对齐**（第 92 轮）
//
// 由来：这已经是"字符串当键 → 静默不生效"这一类的**第四次**（前三次：
//   §87 触发子句的两种文本形态、§90 御魂挂在没人派发的事件上、§91 三个事件码裸字符串派发）。
// 这一轮看的是开局阶段：`STARTUP_STAGES` 声明 9 个，`runStartupStage` 是个 `switch (stage)`。
// 两边一旦对不上，某个阶段就会**被静默跳过**（既不报错、也看不出来）。
//
// ★ 顺带纠正一次我自己的误读：`case "SUMMON": break;` 与 `case "FIELD": break;` 我一开始读成
//   "未建模阶段"，查完发现两个都**不是忘了**：SUMMON 是数据边界（KB 里没有召唤物），
//   FIELD 是开局本就无事可做（没有任何技能在战斗开始时创建结界/幻境）。
//   ⇒ 处置不是"去实现它们"，而是**让空的 case 必须有理由**，并且这个理由要被机器盯着。
import fs from "node:fs";
import path from "node:path";
import { STARTUP_STAGES, STAGE_NOOP_REASONS } from "../kernel/policies.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** 从 battle.ts 的 runStartupStage 里抽出 case → 分支体（到下一个 case 为止） */
export function parseStageCases(src: string): Map<string, string> {
  const i0 = src.indexOf("private async runStartupStage");
  if (i0 < 0) return new Map();
  const i1 = src.indexOf("\n  }", i0);
  const body = src.slice(i0, i1 < 0 ? src.length : i1);
  const out = new Map<string, string>();
  const parts = body.split(/case "([A-Z_]+)":/).slice(1);
  for (let i = 0; i < parts.length; i += 2) out.set(parts[i], parts[i + 1] ?? "");
  return out;
}

const src = fs.readFileSync(path.join(ROOT, "battle-lab", "kernel", "battle.ts"), "utf8");
const cases = parseStageCases(src);

sec("[1] ★★★ 声明表与 switch 分支必须一模一样");
{
  ok("★★★ 解析到了分支（不是 0 个而显得干净）", cases.size > 0, String(cases.size));
  const declared = [...STARTUP_STAGES];
  const missing = declared.filter(s => !cases.has(s));
  const extra = [...cases.keys()].filter(s => !declared.includes(s as any));
  ok("★★★ 每个声明的阶段都有 case（否则那个阶段会被**静默跳过**）", missing.length === 0, JSON.stringify(missing));
  ok("★★★ 每个 case 都是声明过的阶段（否则是野分支）", extra.length === 0, JSON.stringify(extra));
  ok("★★ 两边数量一致", cases.size === declared.length, cases.size + " vs " + declared.length);
  console.log("    声明 " + declared.length + " 个阶段｜switch 里 " + cases.size + " 个分支");
}

sec("[2] ★★★ 空阶段必须写明理由，没写理由的不许为空");
{
  const isEmpty = (body: string) => !/[a-zA-Z]/.test(body.replace(/\/\/.*$/gm, "").replace(/break;/g, ""));
  const empties = [...cases.entries()].filter(([, body]) => isEmpty(body)).map(([s]) => s);
  const unexplained = empties.filter(s => !(s in STAGE_NOOP_REASONS));
  ok("★★★ 确实有阶段是空的（不是 0 个而显得干净）", empties.length > 0, JSON.stringify(empties));
  ok("★★★ 每个空阶段都在 STAGE_NOOP_REASONS 里写明了理由", unexplained.length === 0, JSON.stringify(unexplained));
  const thin = Object.entries(STAGE_NOOP_REASONS).filter(([, r]) => r.length < 30).map(([s]) => s);
  ok("★★★ 理由够具体（≥30 字，不是「暂不支持」这类占位）", thin.length === 0, JSON.stringify(thin));
  const zombies = Object.keys(STAGE_NOOP_REASONS).filter(s => !empties.includes(s));
  ok("★★ 僵尸条目：写了理由却已经不是空的了（会让「已说明」虚高）", zombies.length === 0, JSON.stringify(zombies));
  console.log("    空阶段 " + empties.length + " 个（" + empties.join("/") + "），全部有理由");
}

sec("[3] ★★★ 反向：合成一个没有理由的空阶段，必须被抓");
{
  const fake = "private async runStartupStage(stage: string) {\n switch (stage) {\n case \"SPAWN\": break;\n case \"NEW_STAGE\": break;\n }\n  }\n";
  const fc = parseStageCases(fake);
  const fEmpty = [...fc.entries()].filter(([, b]) => !/[a-zA-Z]/.test(b.replace(/\/\/.*$/gm, "").replace(/break;/g, ""))).map(([s]) => s);
  ok("★★★ 合成解析器能抽出分支（合成里我写了 2 个 case）", fc.size === 2, JSON.stringify([...fc.keys()]));
  ok("★★★ 合成的空阶段 NEW_STAGE 不在理由表里 ⇒ 会被判为「没有理由」", fEmpty.includes("NEW_STAGE") && !("NEW_STAGE" in STAGE_NOOP_REASONS), JSON.stringify(fEmpty));
  // 反向 2：给一个假理由，僵尸条目检查必须响
  const fakeReasons: any = { ...STAGE_NOOP_REASONS, NOT_A_STAGE: "这是一个已经不存在的阶段的理由，占位占位占位占位" };
  const z = Object.keys(fakeReasons).filter(s => !fEmpty.includes(s) && ![...cases.keys()].includes(s));
  ok("★★★ 反向：僵尸条目检查会响", z.length > 0, JSON.stringify(z));
}

sec("[4] ★★ 那两个空阶段为什么是空的（把证据钉在断言里）");
{
  const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);
  let field = 0, atStart = 0;
  for (const s of (Array.isArray(KB) ? KB : [])) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      const d = String(k.description ?? "");
      if (!/幻境|结界/.test(d)) continue;
      field++;
      const clause = d.split(/[。；]/).find(c => /幻境|结界/.test(c)) ?? "";
      if (/战斗开始时/.test(clause)) atStart++;
    }
  }
  ok("★★ 确实有幻境/结界的技能（≥15 个）", field >= 15, String(field));
  ok("★★★ 而**在战斗开始时创建**的：0 个（同句过滤）—— 这就是 FIELD 阶段为空的原因", atStart === 0, String(atStart));
  console.log("    提到幻境/结界的技能 " + field + " 个；其中与「战斗开始时」同句的 " + atStart + " 个");
}

console.log("\n=== 开局阶段对齐: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
