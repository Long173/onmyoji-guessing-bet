// tools/wiring-audit.ts — ★「写了但没接线」审计（防止同类缺口第四次躲过测试）
//
// 由来：连续发现三个同型缺口，测试全绿却功能不存在 ——
//   ① installSoulEffects 只有测试调用过 → 御魂在实战中完全没作用
//   ② Battle.entity() 不看 summons → 召唤物永远不会行动
//   ③ preventsAction/canCastSkill 无人读取 → 被眩晕的单位照样放技能
// 共同特征：**数据齐、函数齐、就是没有生产调用方**。既不是语法错也不是逻辑错，
// 而是接线错；而测试大多在验证"被调用之后行为正确"，很少验证"它确实被调用了"。
//
// 规则：导出的函数在**全部生产代码**（引擎非测试文件 + apps/web/src）里若只出现 1 次
// （即只有定义本身），判定为"未接线"。已知合理未使用的写进 allowlist 并注明原因。
//
// ★ 第 32 轮修掉一个**静默漏报**：原先在**未剥注释**的源码上数出现次数，
//   于是"函数名只在注释里被提到过"也算成已接线。实测因此漏掉了两个：
//     · restoreBattle（G0 的"暂停→保存→重载→续跑"能力，只有测试调用）
//     · solveCompatibleSoulBuilds（御魂反解器，只有测试调用）
//   文档里的名字不是调用点 —— 这条教训在 options-audit 里也出现过一次。
//
// 运行：cd battle-lab && node tools/wiring-audit.ts [--update]
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const BL = path.join(root, "battle-lab");
const ALLOW = path.join(import.meta.dirname, "wiring-allowlist.json");

export function walk(d: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

/** 去掉注释：注释里的函数名不是调用点 */
export function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

export interface WiringInput {
  /** 参与"有没有人调用"统计的生产文件 */
  prodFiles: Array<{ path: string; src: string }>;
  /** 参与"哪些函数被导出"的引擎文件（测试文件会被排除） */
  engineFiles: Array<{ path: string; src: string }>;
}

/** 纯函数核心：给定文件集合，算出哪些导出函数没有生产调用方 */
export function auditWiring(input: WiringInput): { exported: number; unwired: Array<{ name: string; file: string }> } {
  const exported: Array<{ name: string; file: string }> = [];
  for (const f of input.engineFiles) {
    if (/[\\/]tests[\\/]/.test(f.path)) continue;
    for (const m of f.src.matchAll(/export (?:async )?function ([A-Za-z0-9_]+)/g)) exported.push({ name: m[1], file: f.path });
  }
  const sources = input.prodFiles.map(x => ({ path: x.path, s: stripComments(x.src) }));
  const unwired: Array<{ name: string; file: string }> = [];
  for (const { name, file } of exported) {
    const re = new RegExp("\\b" + name + "\\b", "g");
    let hits = 0;
    for (const { s } of sources) hits += (s.match(re) ?? []).length;
    if (hits <= 1) unwired.push({ name, file });
  }
  return { exported: exported.length, unwired };
}

// ───────── CLI（被 import 时不执行） ─────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const engineFiles = walk(BL);
  const webFiles = walk(path.join(root, "apps", "web", "src"));
  const prodFiles = [...engineFiles.filter(f => !/[\\/]tests[\\/]/.test(f)), ...webFiles];
  const toEntry = (f: string) => ({ path: path.relative(root, f), src: fs.readFileSync(f, "utf8") });
  const r = auditWiring({ prodFiles: prodFiles.map(toEntry), engineFiles: engineFiles.map(toEntry) });

  const allow = fs.existsSync(ALLOW) ? JSON.parse(fs.readFileSync(ALLOW, "utf8")) : { note: "", allowed: {} as Record<string, string> };
  if (process.argv.includes("--update")) {
    for (const u of r.unwired) if (!allow.allowed[u.name]) allow.allowed[u.name] = "待复核：" + u.file;
    fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 1), "utf8");
    console.log("已写入 allowlist：" + Object.keys(allow.allowed).length + " 项");
  }
  const newly = r.unwired.filter(u => !(u.name in allow.allowed));
  console.log("导出函数 " + r.exported + " 个｜未接线 " + r.unwired.length + " 个｜已知合理 " + Object.keys(allow.allowed).length + " 个｜**新增未接线 " + newly.length + " 个**");
  if (newly.length) {
    console.log("\n⚠ 以下函数在生产代码里没有任何调用方（这是「写了但没接线」的信号）：");
    for (const u of newly) console.log("   " + u.name + "   (" + u.file + ")");
    console.log("\n若确认是刻意保留（CLI 入口 / 测试脚手架 / 未启用的模式），把它加进 tools/wiring-allowlist.json 并写明原因。");
    process.exitCode = 1;
  } else {
    console.log("✓ 没有新增的未接线函数");
  }
}