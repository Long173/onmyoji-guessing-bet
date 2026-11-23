// tools/vocab-audit.ts — ★★ 「同一份词汇被声明了两遍」的机械普查（第 63 轮）
//
// 由来（报告 §46 / §47）：连续两轮抓到的真 bug 是同一个形状 ——
//   引擎定义了一份词汇，界面侧又写了一份，而**没有任何东西在比它们**。
//     · FidelityPanel 的 KLASS_LABEL / KLASS_TONE：内核加一档，界面缺键 ⇒ 退化成灰/原始枚举（§46）
//     · MechanicsView 的 STATUS_ORDER：拿写死的清单去 filter 数据 ⇒ 数据多一种状态就**静默丢条目**（§47）
//
// 这个工具把「还有几处」变成可执行的：提取源码里的**字符串词汇集合**，
// 找出跨文件同集合的组，然后要求**每一组**在白名单里有一句话 ——
// 要么指明"哪个测试在比它们"，要么说明为什么安全。
//
// ★★ 它只回答一个问题：**"这份词汇一共被声明了几次、都在哪"。**
//   它**不判断**哪一组危险 —— 那写在白名单的说明里，由人负责。
//   不给严重度排序，是因为按形态猜严重度会误导：第 62 轮最危险的那一处
//   （STATUS_ORDER）按"是不是映射表"来排只是中档，而它恰恰会静默丢数据。
//   覆盖完整 > 排序好看。
//
// 运行：cd battle-lab && node tools/vocab-audit.ts
import fs from "node:fs";
import path from "node:path";

export type VocabKind = "对象键" | "字符串数组" | "联合类型";

export interface VocabHit {
  file: string;
  line: number;
  kind: VocabKind;
  name: string;
  members: string[];
  /** 对象字面量且**值全是字符串字面量** ⇒ 这是一张"映射表"（标签/语气/帮助文案） */
  isLabelMap: boolean;
}

export interface VocabGroup {
  key: string;
  members: string[];
  files: string[];
  hits: VocabHit[];
  /** 同时出现在引擎侧与界面侧 —— 这一侧才是"拷贝"会发生的地方 */
  crossesBoundary: boolean;
  /** 界面/测试侧存在映射表形态的命中 */
  hasLabelMap: boolean;
}

const SCREAMING = /^[A-Z][A-Z0-9_]*$/;
const isEngine = (f: string) => /^battle-lab\/(kernel|compile|soul|capability|runner|dummy|adapters)\//.test(f);
const isWebSrc = (f: string) => /^apps\/web\/src\//.test(f);
const isTest = (f: string) => /\/tests\//.test(f);

/** 提取一份源码里的字符串词汇集合。纯函数 —— 可以喂合成源码测它。 */
export function extractVocab(file: string, src: string): VocabHit[] {
  const out: VocabHit[] = [];
  const lineOf = (idx: number) => src.slice(0, idx).split("\n").length;
  const push = (idx: number, kind: VocabKind, name: string, members: string[], isLabelMap = false) => {
    const uniq = [...new Set(members)];
    if (uniq.length < 3) return;
    if (!uniq.every(m => SCREAMING.test(m))) return;
    out.push({ file, line: lineOf(idx), kind, name, members: uniq.slice().sort(), isLabelMap });
  };
  // ① const NAME ... = { A: "...", B: "...", C: "..." };  （只看一层键）
  for (const m of src.matchAll(/const\s+(\w+)[^=]*=\s*\{([\s\S]{0,1200}?)\n\};/g)) {
    // ★★ 键的分隔符必须是"行首 / 逗号 / 左花括号"三种 —— **不能只认行首**。
    //   第 63 轮自检抓到的盲区：只认行首会漏掉**单行写的映射表**，
    //   而 FidelityPanel 的 KLASS_TONE 恰好就是单行写的 —— 也就是第 61 轮那个 bug 所在的那张表。
    //   一个检测器漏掉它自己引以为据的那个例子，等于没检测。
    const keys = [...m[2].matchAll(/(?:^|[\n,{])\s*([A-Za-z_$][\w$]*)\s*:/g)].map(x => x[1]);
    const valStrs = [...m[2].matchAll(/(?:^|[\n,{])\s*[A-Za-z_$][\w$]*\s*:\s*"/g)].length;
    push(m.index ?? 0, "对象键", m[1], keys, keys.length > 0 && valStrs === keys.length);
  }
  // ② 字符串数组字面量
  for (const m of src.matchAll(/\[((?:\s*"[A-Z][A-Z0-9_]*"\s*,?)+)\]/g)) {
    push(m.index ?? 0, "字符串数组", "(字面量)", [...m[1].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map(x => x[1]));
  }
  // ③ 内联联合类型 "A" | "B" | "C"
  for (const m of src.matchAll(/"[A-Z][A-Z0-9_]*"(?:\s*\|\s*"[A-Z][A-Z0-9_]*"){2,}/g)) {
    push(m.index ?? 0, "联合类型", "(内联)", [...m[0].matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map(x => x[1]));
  }
  return out;
}

/** 把命中按"成员集合"分组，只留下跨 ≥2 个文件的那些 */
export function crossFileGroups(hits: VocabHit[]): VocabGroup[] {
  const bySet = new Map<string, VocabHit[]>();
  for (const h of hits) {
    const key = h.members.join(",");
    if (!bySet.has(key)) bySet.set(key, []);
    bySet.get(key)!.push(h);
  }
  const groups: VocabGroup[] = [];
  for (const [key, v] of bySet) {
    const files = [...new Set(v.map(x => x.file))];
    if (files.length < 2) continue;
    const sides = files.filter(f => !isTest(f));
    groups.push({
      key, members: key.split(","), files,
      hits: v,
      crossesBoundary: sides.some(isEngine) && sides.some(isWebSrc),
      hasLabelMap: v.some(x => x.isLabelMap),
    });
  }
  return groups.sort((a, b) => (b.crossesBoundary ? 1 : 0) - (a.crossesBoundary ? 1 : 0) || b.files.length - a.files.length);
}

/** 每一组都必须在白名单里有说明；返回没写说明的那些 */
export function auditVocab(groups: VocabGroup[], allow: Record<string, string>) {
  const listed = groups.filter(g => (allow[g.key] ?? "").trim().length >= 8);
  const unlisted = groups.filter(g => (allow[g.key] ?? "").trim().length < 8);
  return { listed, unlisted };
}

// ───────── CLI（被 import 时不执行） ─────────
const here = import.meta.dirname;
const root = path.resolve(here, "..", "..");
const ALLOW = path.join(here, "vocab-allowlist.json");

function walk(d: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (/node_modules|\.git|reference|_oas|_nga|omj_engine_probe|tools|experiments/.test(p)) continue;
      walk(p, out);
    } else if (/\.(ts|vue)$/.test(e.name)) out.push(p);
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const files = [...walk(path.join(root, "battle-lab")), ...walk(path.join(root, "apps", "web"))]
    .map(f => path.relative(root, f).split(path.sep).join("/"));
  const hits = files.flatMap(f => extractVocab(f, fs.readFileSync(path.join(root, f), "utf8")));
  const groups = crossFileGroups(hits);
  const allow: Record<string, string> = fs.existsSync(ALLOW) ? JSON.parse(fs.readFileSync(ALLOW, "utf8")).allowed ?? {} : {};
  const { listed, unlisted } = auditVocab(groups, allow);

  console.log("=== 词汇重复普查 ===");
  console.log("扫描 " + files.length + " 个文件｜命中 " + hits.length + " 处｜跨文件同集合 " + groups.length + " 组" +
    "（其中跨引擎/界面边界 " + groups.filter(g => g.crossesBoundary).length + " 组）");
  for (const g of groups) {
    const mark = allow[g.key] ? "○" : "✗";
    console.log("\n" + mark + " [" + g.members.join(",") + "]" + (g.crossesBoundary ? "  ← 跨边界" : "") + (g.hasLabelMap ? "｜含映射表" : ""));
    for (const h of g.hits) console.log("    " + h.kind + " " + h.name + "  " + h.file + ":" + h.line);
    if (allow[g.key]) console.log("    理由：" + allow[g.key]);
  }
  console.log("\n已说明 " + listed.length + "｜**未说明 " + unlisted.length + "**");
  if (unlisted.length) {
    console.log("\n处理方式：在 tools/vocab-allowlist.json 里为**每一组**写明 ——");
    console.log("  · 若某个测试在比对它们：写「COMPARED:<测试文件>」并说明比的是哪一层；");
    console.log("  · 若重复是安全的：写清为什么（例如「是同一份类型联合的再次声明，不驱动渲染」）。");
    process.exitCode = 1;
  } else {
    console.log("✓ 每一组重复都有一句说明");
  }
}
