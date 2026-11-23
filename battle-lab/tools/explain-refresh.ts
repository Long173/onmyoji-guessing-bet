// tools/explain-refresh.ts — ★★★ 第 239 轮：台帐的「实际差异字段」按现在的事实重算 + 变化字段点名（可被尺子直接调用）
//
// 由来（本轮实测）：compile-explain.json 的 393 条说明里，**195 条**的字段清单停留在旧事实上 ——
//   因为 census 只检查"键在不在"（diffCensus: !!explain[key]），而清单是给人看的散文，后面的轮次往产物里
//   加字段（controlRefs / statusRefClauses / effectClauses / probabilities / counterCast …）时，没有人回头改它。
//   实测例：skills:209/209_02 台帐写 6 个字段、实际只剩 statusCaps 一个；
//   skills:16/16_07 台帐写 lifesteal/revive/shieldSkips…，实际是 controlRefs/recognized.1/statusStacks。
//   更隐蔽的一半：**57 条**的散文连"变了哪些字段"都没点全（34 条漏 recognized）—— 报表因此可以比代码乐观。
//
// 本工具（纯函数 auditLedger，可被 tests/g119 直接调用）做两件事，都不动散文：
//   ① **重算清单**：把 「实际差异字段为 [...]」 重写成复算出来的那组，并给新增/减少留一句可追溯的注；
//   ② **点名**：散文没提到的变化字段（顶层名）补一行 点名239，带上它在**编译器源码里**往上找最近的「第 N 轮」标记。
//   两处注都用 【复算239…】/【点名239…】 包裹，复算前先剥掉 ⇒ **幂等**（第二次跑必须 0 改动，尺子钉住这一点）。
//
// 运行：cd battle-lab && node tools/explain-refresh.ts [--check]
import fs from "node:fs";
import path from "node:path";
import { compileAll, diffCensus, comparable } from "./compile-census.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASELINE = path.join(ROOT, "battle-lab", "fixtures", "compile-baseline.json");
export const EXPLAIN = path.join(ROOT, "battle-lab", "tools", "compile-explain.json");

/** 最深分歧路径：两边都有的容器往下走，缺键/叶子不等就记这一层 */
export function diffPaths(a: any, b: any, prefix = ""): string[] {
  const isObj = (x: any) => x !== null && typeof x === "object";
  if (!isObj(a) || !isObj(b)) return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix];
  const out: string[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const p = prefix === "" ? k : prefix + "." + k;
    if (!(k in a) || !(k in b)) { out.push(p); continue; }
    out.push(...diffPaths(a[k], b[k], p));
  }
  return out;
}
export const normJson = (json: string) => JSON.parse(comparable(json));
export const embedded = (text: string): string[] | null => {
  const m = /实际差异字段为 \[([^\]]*)\]/.exec(text);
  if (!m) return null;
  try { return JSON.parse("[" + m[1] + "]").map((s: string) => String(s)); } catch { return null; }
};
/** 机器注的包裹标记：复算时先剥掉，保证幂等，也让"人写的散文"可以被单独检验 */
export const NOTE_RE = /【(?:复算|点名)239[^】]*】/g;
export const stripNotes = (t: string) => t.replace(NOTE_RE, "");

const SRC_DIRS = ["compile", "kernel"].map((d) => path.join(ROOT, "battle-lab", d));
/**
 * The MAX-only betting-mode overlay (compile/betting-*.ts, max-level.ts, skill-overrides.ts, skill-patches.gen.ts)
 * carries no round markers and sorts before most compiler files: if it were scanned, the first occurrence of
 * common field names (damage, probabilities…) would land there and every ledger note would read 未标轮次.
 */
const OVERLAY = /^(betting-|max-level\.ts$|skill-overrides\.ts$|skill-patches\.gen\.ts$)/;
const SRC = SRC_DIRS.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".ts") && !f.startsWith("_") && !OVERLAY.test(f)).map((f) => ({ f: path.join(d, f), t: fs.readFileSync(path.join(d, f), "utf8") })))
  .map((s) => ({ f: path.relative(path.join(ROOT, "battle-lab"), s.f).replace(/\\/g, "/"), t: s.t }));
/** 字段 → 引入轮次：在编译器/内核源码里，字段名往上找最近的一个「第 N 轮」标记 */
export const roundOf = (field: string): string => {
  const base0 = field.split(".")[0];
  const word = new RegExp("\\b" + base0.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
  for (const s of SRC) {
    const m = word.exec(s.t);
    if (!m) continue;
    const marks = [...s.t.slice(0, m.index).matchAll(/第\s*(\d+)\s*轮/g)].map((x: any) => Number(x[1]));
    return marks.length ? "第 " + marks[marks.length - 1] + " 轮" : "未标轮次";
  }
  return "未标轮次";
};

export interface LedgerAudit {
  changed: number; withList: number; proseOnly: number; unchanged: number; rewritten: number;
  named: number; missingFields: number; wrote: number;
  addCounter: Array<[string, number]>; missCounter: Array<[string, number]>;
  mismatches: Array<{ key: string; was: string[]; now: string[] }>;
  refreshed: Record<string, string>;
}
/** 审计 + 复算（纯函数：只读入一份台帐，返回"应该长成什么样"） */
export function auditLedger(expIn: Record<string, string>): LedgerAudit {
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  const { input } = compileAll(path.join(ROOT, "data", "kb"));
  const r = diffCensus(base, input, expIn);
  const refreshed: Record<string, string> = {};
  const mismatches: Array<{ key: string; was: string[]; now: string[] }> = [];
  const addCounter = new Map<string, number>(), missCounter = new Map<string, number>();
  let unchanged = 0, rewritten = 0, proseOnly = 0, withList = 0, named = 0, missingFields = 0, wrote = 0;
  for (const c of r.changed) {
    const key = c.ns + ":" + c.key;
    const raw = expIn[key] ?? "";
    const human = stripNotes(raw);
    const got = diffPaths(normJson(c.was), normJson(c.now)).sort();
    let text = human;
    const want = embedded(human);
    if (want === null) proseOnly++;
    else {
      withList++;
      const w = [...want].sort();
      if (JSON.stringify(w) === JSON.stringify(got)) unchanged++;
      else {
        const added = got.filter((f: string) => !w.includes(f));
        const removed = w.filter((f: string) => !got.includes(f));
        for (const f of added) addCounter.set(f.split(".")[0], (addCounter.get(f.split(".")[0]) ?? 0) + 1);
        mismatches.push({ key, was: w, now: got });
        text = human.replace(/实际差异字段为 \[[^\]]*\]/, "实际差异字段为 " + JSON.stringify(got)) +
          " 【复算239：旧清单停在旧事实上 —— " +
          (added.length ? "新增 " + added.map((f: string) => f + "（" + roundOf(f) + "）").join("、") : "") +
          (added.length && removed.length ? "；" : "") +
          (removed.length ? "减少 " + removed.join("、") : "") + "】";
        rewritten++;
      }
    }
    const tops = [...new Set(got.map((f: string) => f.split(".")[0]))];
    const miss = tops.filter((f: string) => !human.includes(f));
    if (miss.length) {
      named++; missingFields += miss.length;
      for (const f of miss) missCounter.set(f, (missCounter.get(f) ?? 0) + 1);
      /** ★ 尾部空白先归一化：否则「人写的尾巴空格 + 我加的前导空格」会每跑一次多一个空格（实测：2 → 3，永不幂等） */
      text = text.replace(/\s+$/, "") + " 【点名239：本条散文未提到的变化字段 —— " + miss.map((f: string) => f + "（" + roundOf(f) + "）").join("、") + "】";
    }
    if (text !== raw) { refreshed[key] = text; wrote++; }
  }
  const sortDesc = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return { changed: r.changed.length, withList, proseOnly, unchanged, rewritten, named, missingFields, wrote, addCounter: sortDesc(addCounter), missCounter: sortDesc(missCounter), mismatches, refreshed };
}

export function loadExplain(): Record<string, string> { return JSON.parse(fs.readFileSync(EXPLAIN, "utf8")); }

/** ★ 判"是不是直接跑的"要用 process.argv[1]：用 import.meta.filename 会让**任何 import 它的尺子**都触发写盘（实测踩过） */
const isMain = !!process.argv[1] && path.resolve(process.argv[1]).replace(/\\/g, "/").endsWith("tools/explain-refresh.ts");
if (isMain) {
  const CHECK = process.argv.includes("--check");
  const exp = loadExplain();
  const a = auditLedger(exp);
  console.log("变化 " + a.changed + " 条：带清单 " + a.withList + "（清单已对 " + a.unchanged + "｜**重写 " + a.rewritten + "**）｜散文式 " + a.proseOnly);
  console.log("**点名补齐 " + a.named + " 条**（共 " + a.missingFields + " 个字段）；需要写回 " + a.wrote + " 条");
  console.log("新增字段按条目数（前 8）：\n" + a.addCounter.slice(0, 8).map(([f, n]) => "  " + f + " × " + n).join("\n"));
  console.log("被点名最多的字段（前 8）：\n" + a.missCounter.slice(0, 8).map(([f, n]) => "  " + f + " × " + n).join("\n"));
  if (CHECK) {
    console.log(a.wrote === 0 ? "\n[--check] 台帐 == 复算结果，且变化字段全部被点名 ✓" : "\n[--check] 有 " + a.wrote + " 条需要重算 ✗");
    process.exit(a.wrote === 0 ? 0 : 1);
  }
  const next = { ...exp };
  for (const [k, v] of Object.entries(a.refreshed)) next[k] = v;
  fs.writeFileSync(EXPLAIN, JSON.stringify(next, null, 1), "utf8");
  console.log("已写入 " + path.relative(ROOT, EXPLAIN) + "（键总数 " + Object.keys(next).length + "）");
}