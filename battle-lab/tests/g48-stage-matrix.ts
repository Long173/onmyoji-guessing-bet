// tests/g48-stage-matrix.ts — ★★★ G0–G7 验收矩阵的**声明完整性**（第 81 轮，目标 ⑫）
//
// 报告 §2 那张「八个阶段」表此前是**手写**的，第 81 轮去核对时发现它已经烂了：
//   g1 写 41/41（实测 42）、g2 写 20/20（实测 29）、ui8 写 37/37（实测 40）、
//   ui10 写 28/28（实测 53）、g5 写 29/29（实测 34）。
// —— 与项目里反复出现的「表比事实乐观」同类，只是这次烂的是**验收表本身**。
//
// 处置：阶段→测试写成声明（tools/stage-matrix.ts 的 STAGES），数字**跑出来**。
// 这个文件守的是**声明本身**：阶段齐不齐、文件在不在、未完成的有没有写明原因。
// （数字由 `node tools/stage-matrix.ts` 产生，报告 §2 的数字直接抄它的输出。）
import fs from "node:fs";
import path from "node:path";
import { STAGES, MATRIX_BEGIN, MATRIX_END, buildTable, compareTable } from "../tools/stage-matrix.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");

sec("[1] ★★★ 八个阶段一个都不能少");
{
  const want = ["G0", "G1", "G2", "G3", "G4", "G5", "G6", "G7"];
  const got = STAGES.map(s => s.id);
  ok("★★★ G0–G7 全部在表里", want.every(w => got.includes(w)), JSON.stringify(got));
  ok("★★★ 没有多余/重复的阶段", got.length === new Set(got).size && got.length === want.length, JSON.stringify(got));
  ok("★★★ 每个阶段至少一个**可执行**验收测试（目标 ⑫ 的字面要求）",
    STAGES.every(s => s.tests.length >= 1), JSON.stringify(STAGES.filter(s => !s.tests.length).map(s => s.id)));
  ok("★★ 每个阶段都写明了它的要求原文", STAGES.every(s => s.require.trim().length >= 10));
}

sec("[2] ★★★ 声明的测试文件必须真的存在（表不许引用不存在的验收）");
{
  const missing: string[] = [];
  for (const s of STAGES) for (const t of s.tests) {
    const cwd = t.suite === "engine" ? path.join(ROOT, "battle-lab") : path.join(ROOT, "apps", "web");
    if (!fs.existsSync(path.join(cwd, t.file))) missing.push(s.id + " → " + t.suite + "/" + t.file);
  }
  ok("★★★ 全部存在", missing.length === 0, JSON.stringify(missing));
  const dup = STAGES.flatMap(s => s.tests.map(t => s.id + ":" + t.file));
  ok("★★ 同一个阶段内不重复引用同一个文件", dup.length === new Set(dup).size);
  ok("★★ suite 只有 engine / web 两种（跑法才有定义）",
    STAGES.every(s => s.tests.every(t => t.suite === "engine" || t.suite === "web")));
}

sec("[3] ★★★ 做不完的阶段必须写明原因，做完的不许留原因");
{
  const blocked = STAGES.filter(s => s.blockedBy);
  ok("★★★ 未完成的阶段写明了原因（且原因具体，不是「待办」两个字）",
    blocked.every(s => (s.blockedBy ?? "").length >= 20), JSON.stringify(blocked.map(s => s.id + ":" + (s.blockedBy ?? "").slice(0, 20))));
  ok("★★★ 做完的阶段**不许**留 blockedBy（否则是拿待办名单掩盖已完成项）",
    STAGES.filter(s => !s.blockedBy).every(s => s.blockedBy === undefined),
    JSON.stringify(STAGES.filter(s => !s.blockedBy && s.blockedBy !== undefined).map(s => s.id)));
  ok("★★ 今天仍被阻塞的只有需要**游戏内观测**的那两个（这不是能力边界，是物理边界）",
    blocked.map(s => s.id).join(",") === "G6,G7", JSON.stringify(blocked.map(s => s.id)));
  console.log("    已验收 " + (STAGES.length - blocked.length) + " 个阶段｜被观测阻塞 " + blocked.length + " 个（" + blocked.map(s => s.id).join("/") + "）");
}

sec("[4] ★★ 数字由运行产生 —— 表里不许写死条数");
{
  const src = fs.readFileSync(path.join(ROOT, "battle-lab", "tools", "stage-matrix.ts"), "utf8");
  // 声明里只允许出现「文件路径」，不允许出现「N/N 条」这种抄进来的数字
  const hardcoded = STAGES.flatMap(s => s.tests.map(t => t.file)).filter(f => /\d+\s*条|\d+\/\d+/.test(f));
  ok("★★★ 声明里没有任何写死的条数（数字只在运行时产生）", hardcoded.length === 0, JSON.stringify(hardcoded));
  ok("★★ 工具确实在**运行**测试（regex 解析 passed/通过，而不是读常量）", /execFileSync/.test(src) && /passed|通过/.test(src));
}

sec("[5] ★★★ 报告 §2 的表由**运行**产生，不许手抄（第 92 轮：它又烂了一次）");
{
  const REPORT = path.join(ROOT, "10-M1.9-全局战斗与真实性体系.md");
  const report = fs.readFileSync(REPORT, "utf8");
  const src5 = fs.readFileSync(path.join(ROOT, "battle-lab", "tools", "stage-matrix.ts"), "utf8");
  const nb = report.split(MATRIX_BEGIN).length - 1;
  const ne = report.split(MATRIX_END).length - 1;
  ok("★★★ 报告里 marker 各恰好一个（否则 --write 不知道该改哪一处，宁可不写）", nb === 1 && ne === 1, "BEGIN " + nb + " / END " + ne);
  const block = nb === 1 && ne === 1 ? report.slice(report.indexOf(MATRIX_BEGIN), report.indexOf(MATRIX_END) + MATRIX_END.length) : "";
  const lines = block.split("\n");
  const rows = lines.filter(l => /^\| \*\*G\d\*\*/.test(l));
  ok("★★★ 块里的阶段行与声明**一一对应**（数量与顺序都一致）",
    rows.length === STAGES.length && rows.every((l, i) => l.startsWith("| **" + STAGES[i].id + "**")),
    rows.length + " 行 vs 声明 " + STAGES.length + " 个");
  // 合计那一格写作「**425 条**」，阶段格写作「**20**」/「**33**」—— 所以「条」必须可选
  // （第 92 轮第一次就写漏了，被这条自检自己抓住：表内 0 vs 逐行相加 425）
  const num = (l: string) => { const m = l.match(/\*\*(\d+)(?:\s*条)?\*\*/g) ?? []; const last = m[m.length - 1] ?? "**0**"; return Number(last.replace(/[^0-9]/g, "")); };
  const sumRow = lines.find(l => l.startsWith("| **合计**")) ?? "";
  const sum = rows.reduce((a, l) => a + num(l), 0);
  ok("★★ 合计 = 各行条数之和（手改一个格子就会在这里露馅）", sumRow !== "" && num(sumRow) === sum, "表内 " + num(sumRow) + " vs 逐行相加 " + sum);
  const blockedInTable = rows.filter(l => /被观测阻塞/.test(l)).map(l => (l.match(/\*\*(G\d)\*\*/) ?? ["", "?"])[1]);
  const blockedInDecl = STAGES.filter(s => s.blockedBy).map(s => s.id);
  ok("★★★ 状态列与声明的 blockedBy **双向**一致（表不许自己宣布完成）",
    blockedInTable.join(",") === blockedInDecl.join(","), "表 " + blockedInTable.join(",") + " vs 声明 " + blockedInDecl.join(","));
  const good = MATRIX_BEGIN + "\n| x |\n" + MATRIX_END;
  const codes = [
    compareTable("报告里根本没有 marker", good),
    compareTable(good + "\n" + good, good),
    compareTable(MATRIX_BEGIN + "\n| y |\n" + MATRIX_END, good),
  ].map(r => (r.ok ? "OK" : r.code));
  ok("★★★ 反向自检：删 marker → NO_MARKER｜重复 marker → DUP_MARKER｜内容不同 → STALE",
    codes.join(",") === "NO_MARKER,DUP_MARKER,STALE", codes.join(","));
  ok("★★ 而正确的块必须被判为一致（否则这是个「永远报错」的检查器）",
    compareTable(MATRIX_BEGIN + "\n| x |\n" + MATRIX_END, good).ok);
  const synth = [{ id: "G0", require: "r", total: 5, tests: ["t.ts 5 条"], detail: [{ file: "t.ts", n: 5, ok: true }], blockedBy: null }];
  const t2 = buildTable(synth);
  ok("★★ buildTable 生成的表能被 compareTable 认下来（生成与比对是同一套定义）",
    compareTable(t2, t2).ok && /\*\*5\*\*/.test(t2), t2.split("\n")[1]);
  ok("★★ 工具确实提供 --write（报告的表有**生成路径**，不靠手抄）", /--write/.test(src5) && /buildTable/.test(src5));
}

console.log("\n=== 验收矩阵声明: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
