// tools/options-audit.ts — ★「声明了却没人读的选项」审计（第 32 轮）
//
// 由来：第 31 轮写策略敏感性扫描时踩了一个坑 ——
//   assembleGuessingMatch(fixture, opts: { seed, maxTurns? })
// 它的 opts 类型里**根本没有 policies**，而函数体把四个红区候选写死了；
// 传进去的 policies 被静默忽略，8 个组合跑出同一份结果，看起来像"结论对候选不敏感"。
// 那是"数据齐、参数齐、没人用"的又一次复现，只不过这次发生在 API 层。
//
// 这个工具把那件事变成机械检查：**配置对象里声明的字段，必须在某处被读过**。
// 与 tools/field-census.ts（契约字段有没有读）互补：那个查结构体，这个查函数选项。
//
// ★ 三条自我约束（因为一个乱叫的审计会被无视，等于没有）：
//   ① 只查**配置对象**：参数名 opts/options/cfg/config/settings，或类型名以 Opts/Options/Config/Settings 结尾。
//      第一版对所有对象参数一视同仁，把 sameEvent(a: ObsFrame) 里"没读 a.amount"也报成缺口 ——
//      可那是**数据**参数，只比身份字段本来就是对的。
//   ② 判定粒度是**类型**而不是函数：共享选项类型（DiffOptions）会被多个函数使用，
//      辅助函数只读其中一部分是正常写法。只要有一个使用方读过，就不是缺口。
//   ③ 出现 `...opts` 就判为**合并/转发**（`const o = {...默认, ...opts}` 之后按 o.x 读，静态追不到）：
//      既不算缺口，也不算已验证 —— 单独列出来，明确说"这里没查"。
//
// 运行：cd battle-lab && node tools/options-audit.ts
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const BL = path.join(root, "battle-lab");

function walk(d: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}
const isScaffold = (f: string) => /[\\/](tests|tools|experiments)[\\/]/.test(f);
const files = [...walk(BL).filter(f => !isScaffold(f)), ...walk(path.join(root, "apps", "web", "src"))];

interface Hit { typeKey: string; param: string; field: string; file: string; read: boolean; merged: boolean }

/**
 * 按**括号深度**切参数表。
 * ★ 第一版用 \`split(/,(?![^{]*\})/)\`（逗号后面若还有 } 就不切），
 *   于是 \`(expected: T[], actual: T[], options: DiffOptions = {})\` 里的最后一个逗号被吞掉，
 *   两个形参粘成一个 —— \`options\` **从来没有被检查过**，
 *   连带把共享类型 DiffOptions 的字段误报成"没人读"。
 *   解析器上的取巧，最后都会以"某处静默漏检"的形式还回来。
 */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0, buf = "";
  for (const c of args) {
    if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === "}" || c === ">") depth--;
    if (c === "," && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/**
 * 取出对象类型里的字段名。
 * ★ 必须按 \`;\` / \`,\` / 换行**切分**，不能按行扫。
 *   第一版按行扫，于是 \`{ used?: number; never?: string }\` 这种单行写法只认得出第一个字段 ——
 *   「声明了却没人读」的字段只要和别的字段写在同一行就永远查不出来。
 *   这与第 23 轮 field-census 犯的是同一个错（一行多字段只认第一个），
 *   而且这次它让审计**漏报**，比误报更危险。
 */
function fieldsOfInline(typeRaw: string): string[] {
  const out: string[] = [];
  const inner = typeRaw.slice(1, -1);
  let depth = 0, buf = "";
  const flush = () => {
    const t = buf.trim();
    buf = "";
    if (!t) return;
    const f = /^(?:readonly\s+)?(\w+)\??\s*[:=]/.exec(t);
    if (f) out.push(f[1]);
  };
  for (const c of inner) {
    if (c === "{" || c === "[" || c === "(" || c === "<") depth++;
    else if (c === "}" || c === "]" || c === ")" || c === ">") depth--;
    if ((c === ";" || c === "," || c === "\n") && depth === 0) { flush(); continue; }
    buf += c;
  }
  flush();
  return out;
}

function scanFile(file: string, src: string): { hits: Hit[]; uncovered: number } {
  const hits: Hit[] = [];
  let uncovered = 0;
  const ifaces = new Map<string, string[]>();
  // ★ 用花括号配对而不是 \`([\s\S]*?)\n\}\`：后者抓不到**单行**声明的接口
  //   （\`export interface Cfg { x?: number; y?: number }\`），字段表就空了，
  //   而空的字段表既不报缺口也不报 uncovered —— 静默漏检。
  for (const m of src.matchAll(/export\s+interface\s+(\w+)\s*\{/g)) {
    const open = src.indexOf("{", m.index);
    let depth = 0, j = open;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") { depth--; if (depth === 0) break; }
    }
    ifaces.set(m[1], fieldsOfInline(src.slice(open, j + 1)));
  }
  const re = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const fnName = m[1];
    const parenStart = m.index + m[0].length - 1;
    let depth = 0, i = parenStart, args = "";
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) break; }
      if (depth >= 1) args += c;
    }
    args = args.slice(1);
    // 函数体：本项目所有顶层函数都以第 0 列的 } 收尾。
    // ★ 不要数花括号：带对象返回类型的签名（function f(o): { a: T } {...}）会让计数器从返回类型开始，
    //   于是"函数体"其实是返回类型字面量 —— 第一版就是这么把 read 误判成 unread 的。
    const rest = src.slice(i);
    const endM = /\n\}/.exec(rest);
    const body = endM ? rest.slice(0, endM.index + 2) : rest;

    for (const part of splitArgs(args)) {
      const pm = /^\s*(?:\.\.\.)?(\w+)\s*\??\s*:\s*(\{[\s\S]*\}|\w+)(\[\])?/.exec(part);
      if (!pm) continue;
      const pname = pm[1], typeRaw = pm[2], isArray = pm[3];
      const isOptions = /^(opts?|options?|cfg|cfgs|config|settings)$/i.test(pname)
        || /(Opts|Options|Config|Settings|Cfg)$/.test(typeRaw);
      if (isArray || !isOptions) continue;
      let fields: string[];
      let kind: string;
      if (typeRaw.startsWith("{")) { fields = fieldsOfInline(typeRaw); kind = fnName + "#inline"; }
      else if (ifaces.has(typeRaw)) { fields = ifaces.get(typeRaw)!; kind = typeRaw; }
      else { uncovered++; continue; }
      if (!fields.length) continue;
      const merged = new RegExp("\\.\\.\\.\\s*" + pname + "\\b").test(body);
      for (const fd of fields) {
        // ★ read 与 merged 是两件事，第一版把 merged 并进 read，
        //   于是"整体转发"的字段全被标成 read，merged 列表永远是空的 —— 报告里少了一整类。
        const read =
          new RegExp("\\b" + pname + "\\s*\\.\\s*" + fd + "\\b").test(body) ||
          new RegExp("\\b" + pname + "\\s*\\?\\.\\s*" + fd + "\\b").test(body) ||
          new RegExp("\\{[^}]*\\b" + fd + "\\b[^}]*\\}\\s*=\\s*" + pname + "\\b").test(body);
        hits.push({ typeKey: kind, param: pname, field: fd, file, read, merged });
      }
    }
  }
  return { hits, uncovered };
}


/** 收集一批文件并归并成「每个配置字段有没有被读」 */
export function collect(files: Array<{ path: string; src: string }>) {
  const hits: Hit[] = [];
  let uncoveredTotal = 0;
  for (const f of files) {
    const r = scanFile(f.path, f.src);
    uncoveredTotal += r.uncovered;
    for (const h of r.hits) hits.push({ ...h, file: f.path });
  }
  const byKey = new Map<string, Hit>();
  for (const h of hits) {
    const k = h.typeKey + "::" + h.field;
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, { ...h });
    // read 用 OR（任一处读过就算读到）；merged 也用 OR ——
    // "只要有一条调用路径把整个对象交出去，就不能断言这个字段没人用"。
    // 第一版 merged 用了 AND，于是共享类型里先出现的那个不转发的使用方把整类压成 unread，
    // 报出 DiffOptions.tolerance 这种假缺口。
    else { prev.read = prev.read || h.read; prev.merged = prev.merged || h.merged; }
  }
  const uniq = [...byKey.values()];
  return {
    fields: uniq,
    gaps: uniq.filter(h => !h.read && !h.merged),
    merged: uniq.filter(h => !h.read && h.merged),
    uncovered: uncoveredTotal,
  };
}

export type { Hit };

// ───────── CLI（被 import 时不执行） ─────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const hits: Hit[] = [];
  let uncoveredTotal = 0;
  for (const f of files) {
    const r = scanFile(f, fs.readFileSync(f, "utf8"));
    uncoveredTotal += r.uncovered;
    for (const h of r.hits) hits.push({ ...h, file: path.relative(root, f) });
  }
  
  // 按 (类型, 字段) 归并：任一个使用方读过，就不是缺口
  const byKey = new Map<string, Hit>();
  for (const h of hits) {
    const k = h.typeKey + "::" + h.field;
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, { ...h });
    // read 用 OR（任一处读过就算读到）；merged 也用 OR ——
    // "只要有一条调用路径把整个对象交出去，就不能断言这个字段没人用"。
    // 第一版 merged 用了 AND，于是共享类型里先出现的那个不转发的使用方把整类压成 unread，
    // 报出 DiffOptions.tolerance 这种假缺口。
    else { prev.read = prev.read || h.read; prev.merged = prev.merged || h.merged; }
  }
  const uniq = [...byKey.values()];
  const mergedList = uniq.filter(h => !h.read && h.merged);
  const gaps = uniq.filter(h => !h.read && !h.merged);
  
  console.log("=== 选项审计：配置对象里声明的字段，必须在某处被读过 ===");
  console.log("扫描 " + files.length + " 个文件｜配置字段 " + uniq.length + " 个");
  console.log("跨文件选项类型未追（如实计数，不假装查过）：" + uncoveredTotal + " 处");
  console.log("");
  if (mergedList.length) {
    console.log("○ 合并/转发的类型（\`{...opts}\`，静态追不到下游，未验证也非缺口）：" + mergedList.length + " 个");
    for (const h of mergedList) console.log("   " + h.typeKey + " 的 " + h.field + "   (" + h.file + ")");
    console.log("");
  }
  if (gaps.length) {
    console.log("⚠ 以下字段被声明但**没有任何地方读** —— 传进来也不会生效：");
    for (const g of gaps) console.log("   " + g.typeKey + " 的 " + g.field + "   (" + g.file + ", 形参 " + g.param + ")");
    console.log("");
    console.log("处理方式：要么真的用它，要么把字段从签名里删掉（别留一个看起来能配、实际没用的旋钮）。");
    process.exitCode = 1;
  } else {
    console.log("✓ 没有「声明了却没人读」的选项字段");
  }
}