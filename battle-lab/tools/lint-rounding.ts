// tools/lint-rounding.ts — 禁止散落的取整调用
//
// 规则（kernel/gamemath.ts 的开头也写着同一条）：除取整的唯一入口外，全项目不得出现
//   Math.floor / Math.round / Math.ceil / Math.trunc / parseInt。
// 理由：游戏自己的取整点未知，散落的取整会污染中间结果且**无法一次性替换**。
//
// ★★★ 第 191 轮：这个工具此前**没有任何测试跑它**，而且一直以 exit=1 收场（12 处命中）——
//   也就是说「取整不许散落」这条规矩**没有被任何东西守着**。这一轮两件事一起做：
//   ① 把数值路径上的 10 处改成 GameMath.roundAt(v, "命名取整点")（与 Math.round **逐位等价**，
//      区别只是取整点从此**可枚举、可整体替换**——这正是这条规则原本要防的东西）；
//   ② 剩下的 2 处进 tools/rounding-allowlist.json，**每条写明理由**；新增的第 13 处会让本工具变红，
//      由 tests/g113-rounding-lint.ts 守着（含反向对照：合成一行 Math.round 必须被照出来）。
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ALLOW_FILES = new Set(["kernel/gamemath.ts", "kernel/rng.ts"]);
/** 只拦会污染数值路径的取整。toFixed 只产字符串（日志/报表），不参与计算，故不拦。 */
const PAT = /Math\.(floor|round|ceil|trunc)\s*\(|parseInt\s*\(/;
/** 只扫**数值路径**：kernel / soul / compile 三处才参与面板与战斗数值计算 */
const VALUE_DIRS = ["kernel", "soul", "compile"];
const ALLOWLIST = path.join(ROOT, "tools", "rounding-allowlist.json");

export interface RoundingFinding { file: string; line: number; text: string; key: string; reason: string | null }

/** 一条违规的**稳定键**：文件 + 归一化后的整行源码（行号会漂，内容不会 —— 与 compile-explain 同一条纪律） */
export function roundingKey(file: string, text: string): string {
  return file + " :: " + text.replace(/\s+/g, " ").trim();
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * 扫描一遍。**纯函数式入口**（测试与 CLI 共用）：
 *   · extraSources —— 合成源码（反向对照用：喂一行 Math.round 必须被照出来）；
 *   · allow —— 显式覆盖允许表（默认读 tools/rounding-allowlist.json）。
 */
export async function scanRounding(opts: { extraSources?: Array<{ file: string; source: string }>; allow?: Record<string, string> } = {}): Promise<{ scanned: number; findings: RoundingFinding[]; allowed: RoundingFinding[]; unexplained: RoundingFinding[] }> {
  let allow: Record<string, string> = opts.allow ?? {};
  if (!opts.allow) { try { allow = JSON.parse(await fs.readFile(ALLOWLIST, "utf8")); } catch { allow = {}; } }
  const files = (await walk(ROOT)).filter(f => VALUE_DIRS.includes(path.relative(ROOT, f).replace(/\\/g, "/").split("/")[0]));
  const sources: Array<{ file: string; text: string }> = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, "/");
    sources.push({ file: rel, text: await fs.readFile(f, "utf8") });
  }
  for (const s of opts.extraSources ?? []) sources.push({ file: s.file, text: s.source });
  const findings: RoundingFinding[] = [];
  for (const s of sources) {
    if (ALLOW_FILES.has(s.file)) continue;
    s.text.split(/\n/).forEach((l, i) => {
      if (!PAT.test(l) || /^\s*\/\//.test(l)) return;
      const text = l.trim();
      findings.push({ file: s.file, line: i + 1, text: text.slice(0, 90), key: roundingKey(s.file, text), reason: allow[roundingKey(s.file, text)] ?? null });
    });
  }
  return { scanned: files.length, findings, allowed: findings.filter(f => f.reason), unexplained: findings.filter(f => !f.reason) };
}

// ────────────────────────────── CLI ──────────────────────────────
const isMain = !!process.argv[1] && /[/\\]lint-rounding\.ts$/.test(process.argv[1]);
if (isMain) {
  const r = await scanRounding();
  console.log("=== 取整调用扫描 ===");
  console.log("扫描范围:", VALUE_DIRS.join(" / "), " 文件数:", r.scanned, " 白名单:", [...ALLOW_FILES].join(", "));
  for (const f of r.allowed) console.log("  ○ 已说明 " + f.file + ":" + f.line + "  — " + f.reason);
  if (!r.unexplained.length) {
    console.log("✅ 未发现**未说明**的取整调用（已说明 " + r.allowed.length + " 处）");
    process.exitCode = 0;
  } else {
    console.log("⚠️ 发现 " + r.unexplained.length + " 处未说明（应改为走 GameMath，或在 tools/rounding-allowlist.json 里写明理由）:");
    for (const v of r.unexplained.slice(0, 40)) console.log("  " + v.file + ":" + v.line + "  " + v.text);
    process.exitCode = 1;
  }
}
