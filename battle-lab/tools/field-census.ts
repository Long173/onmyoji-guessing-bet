// tools/field-census.ts — ★ 字段级接线普查（函数级审计的下一层）
//
// 由来：连续发现四个**同型**缺口，测试全绿却功能不存在 ——
//   ① installSoulEffects 没人调用 → 御魂在实战中完全没作用
//   ② Battle.entity() 不看 summons → 召唤物永远不行动
//   ③ preventsAction / canCastSkill 没人读 → 被眩晕的单位照样放技能
//   ④ canBeTargeted 没人读 → 无敌 / 放逐 / 隐匿 完全无效
// 共同特征：**数据齐、字段齐、就是没有生产读取方**。
// tools/wiring-audit.ts 只能查"导出的函数有没有人调用"，
// 查不出③④这一类"结构体字段写进去了、从来没人读"的缺口。本工具补这一层。
//
// 判定：某字段在**全部生产代码**（battle-lab 非 tests/tools 文件 + apps/web/src）
// 里出现 **0 次读取**（成员访问 `.field` 或解构/裸引用），即判 DEAD。
// 写数据进去而无人读 = 该机制在实战中不可能存在。
//
// 枚举成员（DamageType / HpMutation / StatusCategory / TurnType / Phase）
// 用同一套标准：某个成员在生产代码里从未被引用 = 死分支（分支写了但永远不会走）。
//
// 运行：cd battle-lab && node tools/field-census.ts [--update]
import fs from "node:fs";
import path from "node:path";


export function walk(d: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}
/** 去掉注释，避免注释里的字段名被当成"读取"（这类假阳性会掩盖真问题） */
/**
 * ★ 已知局限（第 34 轮实测，两个方向都试过）：**字符串同名会污染判定**。
 *   本工具按 `\b成员名\b` 计证据，于是内容与枚举成员同名的**字符串字面量**也算一次「读」。
 *   这个代码库里事件码大量以字符串形式出现（`range: "SELF"`、`t: "STATUS_ADD"`），
 *   所以「字符串算证据」总体是对的 —— 一旦改成「字符串一律不算」，
 *   立刻多出 14 个**假缺口**（SELF / TEAM / ENEMY / ALL / STATUS_ADD / ORB_GAIN …），
 *   而那些机制全都在跑。两个方向都试过之后才选定现在的规则。
 *   代价：同名但不同域的碰撞会造成**假已接线**（危险方向）。
 *   已登记 1 例：EV.HIT（命中判定事件，引擎里不存在）与 a1-4 §31 规定的
 *   ResolutionScope 名 "HIT" 同名 —— 它现在被判成"有读取方"，
 *   所以必须**留在 field-allowlist.json 的 knownGaps 里**充当待办。
 *   g27 有一条断言锁住这件事，防止它被当成"已接线"悄悄销案。
 */
export function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}


/** 抓出 { ... } 的正文，支持嵌套 */
export function bodyOf(text: string, startIdx: number): string | null {
  const open = text.indexOf("{", startIdx);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(open + 1, i); }
  }
  return null;
}

export type Field = { name: string; owner: string; file: string; kind: "interface" | "class" | "enum"; line: number };

/**
 * 把契约正文切成**顶层成员**再逐个解析。
 * ★ 第一版按行解析，于是 `id: string; name: string; category: StatusCategory;` 这种
 *   一行多字段只认得出第一个 —— StatusDef 13 个字段只普查到 6 个，却报"0 个未接线"。
 *   这正是本工具要抓的"平凡通过"，所以解析器本身必须先正确。
 * 分隔符：深度 0 处的 `;` / `,` / 换行。
 */
export function splitMembers(body: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  let depth = 0, start = 0, line = 1, startLine = 1;
  const push = (end: number) => {
    const t = body.slice(start, end);
    if (t.trim()) out.push({ text: t, line: startLine });
    start = end + 1;
    startLine = line;
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\n") { line++; if (depth === 0) { push(i); startLine = line; continue; } }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if ((c === ";" || c === ",") && depth === 0) push(i);
  }
  push(body.length);
  return out;
}

export function addFields(file: string, owner: string, body: string, kind: Field["kind"], baseLine: number, sink: Field[]) {
  for (const mem of splitMembers(body)) {
    const t = mem.text.trim();
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    const m = kind === "enum"
      ? /^([A-Za-z_$][\w$]*)\s*:/.exec(t)
      : /^(?:readonly\s+)?(?:static\s+)?([A-Za-z_$][\w$]*)\??\s*[:=(]/.exec(t);
    if (!m || m[1] === "constructor") continue;
    // 方法声明（`foo(): T` / `foo(a: X): T`）不是字段
    if (/^[A-Za-z_$][\w$]*\s*[<(]/.test(t) || /^[A-Za-z_$][\w$]*\??\s*\(/.test(t)) continue;
    // ★ 成员文本可能以多行 JSDoc 开头（分句是按顶层换行切的），所以要**再数一次**
    //   标识符之前有几个换行，才能定位到真正的声明行。否则声明行不在 declLines 里，
    //   就会被当成一次"读取" —— 一个永远不读的字段会伪装成已接线。
    const beforeIdent = t.slice(0, t.indexOf(m[1]));
    sink.push({ name: m[1], owner, file, kind, line: baseLine + mem.line - 1 + (beforeIdent.match(/\n/g) ?? []).length });
  }
}

export type Row = Field & { dots: number; bares: number; writes: number; readers: string[] };

export interface CensusSpec { file: string; names: string[]; kind: "decl" | "enum" }
export interface CensusInput {
  /** 契约文件：path 用相对路径（会原样出现在结果里），src 是**未剥注释**的原文 */
  contractFiles: Array<{ path: string; src: string }>;
  specs: CensusSpec[];
  /** 参与「读 / 写」统计的生产文件（引擎非测试文件 + 网页 src） */
  prodFiles: Array<{ path: string; src: string }>;
}

/**
 * ★ 纯函数核心（第 33 轮抽出）：给定文件集合就能算，不碰文件系统。
 *   抽出来的理由是**它必须能被 fixture 测试** —— 这个解析器第 23 轮自己错过一次
 *   （按行扫、一行多字段只认第一个，却报「0 个未接线」），当时只有真实数据能纠正它，
 *   而真实数据只能说"结果不对"，说不出"哪条规则失效"。
 */
export function censusContracts(input: CensusInput): Row[] {
  const contracts = new Map(input.contractFiles.map(f => [f.path, stripComments(f.src)]));
  const fields: Field[] = [];
  for (const spec of input.specs) {
    const text = contracts.get(spec.file);
    if (text === undefined) continue;
    for (const name of spec.names) {
      const kw = spec.kind === "enum" ? "const" : "(?:interface|class)";
      const re = new RegExp("export\\s+" + kw + "\\s+" + name + "\\b", "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const body = bodyOf(text, m.index);
        if (!body) continue;
        const kindOf = spec.kind === "enum" ? "enum" : (text.slice(m.index, m.index + 40).includes("class") ? "class" : "interface");
        const baseLine = text.slice(0, m.index).split("\n").length + text.slice(m.index, text.indexOf("{", m.index)).split("\n").length - 1;
        addFields(spec.file, name, body, kindOf as Field["kind"], baseLine, fields);
      }
    }
  }

  /**
   * 声明行集合：接口/类/枚举里那一行 \`preventsAction: boolean;\` 只是**声明**，不是读取。
   * 第一版靠正则猜"这行像不像声明"，把 \`seedLabel: "..."\` 这类也算了进去，
   * 于是"读 1"其实只有声明本身 —— 又是一次平凡通过。这里改成用解析器的确切行号排除。
   */
  const declLines = new Set<string>(fields.map(f => f.file + ":" + f.line));
  const sources = input.prodFiles.map(f => ({ f: f.path, s: stripComments(f.src) }));

  const rows: Row[] = [];
  for (const fd of fields) {
    const declFile = fd.file;
    let dots = 0, writes = 0, bares = 0;
    const readers: string[] = [];
    for (const { f, s } of sources) {
      const ls = s.split("\n");
      for (let li = 0; li < ls.length; li++) {
        const line = ls[li];
        const hits = (line.match(new RegExp("\\b" + fd.name + "\\b", "g")) ?? []).length;
        if (!hits) continue;
        if (declLines.has(f + ":" + (li + 1))) continue;   // 纯声明行：既不算读也不算写
        const dot = (line.match(new RegExp("\\.\\s*" + fd.name + "\\b", "g")) ?? []).length;
        const wr = (line.match(new RegExp("\\b" + fd.name + "\\s*[:=]", "g")) ?? []).length;
        dots += dot;
        writes += wr;
        // 对象字面量的简写属性（`{ statusRefs, tipRefs }`）看着像"裸读"，其实是**写入**。
        const isShorthandList = /^[\sA-Za-z_$0-9,]+,?$/.test(line) && /^\s*[A-Za-z_$]/.test(line) && line.includes(",");
        const shorthand = isShorthandList ? (line.match(new RegExp("(?<![.\\w$])" + fd.name + "\\b", "g")) ?? []).length : 0;
        if (shorthand) { writes += shorthand; continue; }
        // 改自身容器的方法是**写入**（`xs.push(...)`），不是读取。
        const mutating = (line.match(new RegExp("(?<![.\\w$])" + fd.name + "\\s*\\.\\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|add|set|delete|clear)\\s*\\(", "g")) ?? []).length
          + (line.match(new RegExp("(?<![.\\w$])" + fd.name + "\\s*\\.\\s*length\\s*=", "g")) ?? []).length;
        // 类型层引用（`SkillIR["statusDurations"]`）不是运行期读取。
        const typeRef = (line.match(new RegExp("\\[\\s*[\"'][^\"']*[\"']\\s*\\][^;]*" + fd.name, "g")) ?? []).length
          + (line.match(new RegExp("[\"']" + fd.name + "[\"']\\s*\\]", "g")) ?? []).length;
        const bareOnly = hits - dot - wr - mutating - typeRef;
        if (bareOnly > 0) { bares += bareOnly; if (readers.length < 3 && f !== declFile) readers.push(f); }
        if (dot > 0 && readers.length < 3 && !readers.includes(f)) readers.push(f);
      }
    }
    rows.push({ ...fd, dots, bares, writes, readers });
  }
  return rows;
}

/**
 * ★ 生产文件集合（引擎非测试/非工具文件 + 网页 src）。
 *   自检与 CLI 共用，避免两处各写一份、然后慢慢写歪。
 */
export function prodFilesOf(root: string): string[] {
  const isTest = (p: string) => /[\\/]tests[\\/]/.test(p);
  const isTool = (p: string) => /[\\/]tools[\\/]/.test(p);
  return [
    ...walk(path.join(root, "battle-lab")).filter(f => !isTest(f) && !isTool(f)),
    ...walk(path.join(root, "apps", "web", "src")),
  ];
}

/**
 * ★★ 「声明本身不是实现」（§24）—— 这些文件是**表/声明**，不是实现。
 *   任何「生产代码里有没有 X」的扫描都必须排除它们，否则一句话就能让声明自我满足。
 *   · 第 29 轮：compile/unmodeled.ts 的 evidence 里原样写下探测正则，
 *     于是「复活没有调用方」这条断言被它自己的文档弄红了 —— 文档不是代码。
 *   · 第 56 轮：kernel/effects.ts 刚建就踩到同一条 —— 它的 producer 字段把自己匹配上了。
 *   判定集中在这里一份，不在各测试里各写一份、然后慢慢写歪。
 */
export function isDeclarationFile(p: string): boolean {
  return /[\\/]capability[\\/](registry|report)\.ts$/.test(p)
    || /[\\/]compile[\\/]unmodeled\.ts$/.test(p)
    || /[\\/]kernel[\\/]effects\.ts$/.test(p)
    // ★ 第 65 轮：同一个坑**第二次**发作。新建 kernel/architecture.ts（架构登记册）时
    //   忘了把它登记为声明文件 —— 于是它进了"生产代码"集合，而它的 producer 字段里
    //   写着 EFFECT_KINDS，正好把 g39 那条「声明里的把手不该出现在生产集合」的断言弄红。
    //   教训：**建一张新声明表时，同时把它登记在这里**；只加表不登记，等于给扫描集合投毒。
    || /[\\/]kernel[\\/]architecture\.ts$/.test(p)
    // ★ 第 68 轮：**第三次**同一个坑。新建 kernel/triggers.ts（触发时机登记册）时又忘了登记 ——
    //   它把事件码当作字符串写在表里（evCode: "BATTLE_START" …），而字段普查把字符串出现也算作"读取"，
    //   于是「从未被读」的字段数与「从未被引用的枚举成员」数双双变小（21 → 18）——
    //   那不是接线变好了，是我的表在冒充读取方。
    //   ★ 三次踩同一个坑说明：这件事不该靠记性 —— 建任何**声明表**时，第一件事就是登记到这一行。
    || /[\\/]kernel[\\/]triggers\.ts$/.test(p)
    || /[\\/]tools[\\/]field-census\.ts$/.test(p);
}

/**
 * ★★★ 生产者扫描集合：**只在做「有没有代码」判定时用它**。
 *   与 prodFilesOf 的差别有两处，都是有理由的：
 *     · 排除 experiments/ —— A/B 脚手架（与 tools 同类）。第 28 轮定下：
 *       若把脚手架算作"有生产者"，缺口就会被自己的脚手架掩盖。
 *     · 排除 isDeclarationFile() —— 见上。
 *   注意这里**比 g22 的集合更宽**（g22 未排除 experiments/，也没排除 effects.ts）。
 *   不是忘了改 g22：g22 是能力声明表，改它的集合会改变它已有的结论，
 *   那种改动必须先快照再逐条解释（§38.4）。此处仅新增，不动既有口径。
 */
export function producerScanFiles(root: string): string[] {
  const isScaffold = (p: string) => /[\\/](tests|tools|experiments)[\\/]/.test(p);
  return [
    ...walk(path.join(root, "battle-lab")).filter(f => !isScaffold(f)),
    ...walk(path.join(root, "apps", "web", "src")),
  ].filter(f => !isDeclarationFile(f));
}

/** 统一成相对 root 的 **正斜杠** 形式（declLines 的键靠它对齐） */
const norm = (root: string, p: string) => path.relative(root, p).split(path.sep).join("/");

/**
 * ★★ 真实普查输入（CLI 与自检共用）。
 *   第 33 轮抽纯函数时，契约路径与生产路径用了两套形式，declLines 永远匹配不上，
 *   从未被读 23 → 7（静默弱化 16 个）—— 而且是「前后数字对比」才发现的。
 *   现在契约清单和生产文件都在这里组装、都在这里归一化，那种错法没有地方可以发生。
 */
export function realCensusInput(root: string): CensusInput {
  const BL = path.join(root, "battle-lab");
  const relToRoot = (p: string) => norm(root, path.join(BL, p));
  const specs: CensusSpec[] = [
    ...CONTRACTS.map(c => ({ file: relToRoot(c.file), names: c.names, kind: "decl" as const })),
    ...ENUMS.map(c => ({ file: relToRoot(c.file), names: c.names, kind: "enum" as const })),
  ];
  return {
    contractFiles: specs.map(s => ({ path: s.file, src: fs.readFileSync(path.join(root, s.file), "utf8") })),
    specs,
    // ★★ 第 68 轮：读取方的扫描集合改用 producerScanFiles（= prodFilesOf 再排除声明文件与 experiments）。
    //   起因：触发时机登记册把事件码、字段名当**字符串数据**写在表里，而这里原本把"字符串出现"也算作读取 ——
    //   于是"从未被读"的字段数凭空少了 3 个。那不是接线变好了，是声明表在冒充读取方。
    //   与第 23 轮那次 "HIT 同名污染"（把 §31 的 ResolutionScope 名当成事件码被读）是同一类假读取。
    prodFiles: producerScanFiles(root).map(f => ({ path: norm(root, f), src: fs.readFileSync(f, "utf8") })),
  };
}

// ───────── CLI（被 import 时不执行） ─────────
const root = path.resolve(import.meta.dirname, "..", "..");
const BL = path.join(root, "battle-lab");
const ALLOW = path.join(import.meta.dirname, "field-allowlist.json");

/** 要普查的契约：状态 / 能力 / 规则 / 策略 / 技能 IR / 御魂 */
const CONTRACTS: Array<{ file: string; names: string[] }> = [
  { file: "kernel/status.ts", names: ["StatusDef", "ActiveStatus"] },
  { file: "kernel/entity.ts", names: ["EntityCapabilities", "Entity"] },
  { file: "kernel/battle.ts", names: ["BattleRules"] },
  { file: "kernel/policies.ts", names: ["BattlePolicies"] },
  { file: "compile/skill-compiler.ts", names: ["SkillIR"] },
  { file: "soul/loadout.ts", names: ["SoulDef"] },
];
const ENUMS: Array<{ file: string; names: string[] }> = [
  { file: "kernel/types.ts", names: ["DamageType", "HpMutation", "StatusCategory", "TurnType", "Phase", "EventRange", "EV"] },
];

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const rows = censusContracts(realCensusInput(root));

  /**
   * 两份名单，语义完全不同：
   *   allowed   —— **按设计**就不需要被读（例如纯展示字段）。写进来说明理由，可以永远不读。
   *   knownGaps —— **未完成**：机制该读它、但还没接线。它是待办清单，不是免罪符。
   * 只有"两份名单都不在"的字段才算**新增缺口**并让检查失败。
   */
  const allow: { note: string; allowed: Record<string, string>; knownGaps: Record<string, string> } =
    fs.existsSync(ALLOW) ? JSON.parse(fs.readFileSync(ALLOW, "utf8")) : { note: "字段级接线普查：allowed = 按设计不读；knownGaps = 未完成待办", allowed: {}, knownGaps: {} };
  const neverRead = rows.filter(r => r.dots + r.bares === 0);
  const dead = neverRead.filter(r => !(r.name in allow.allowed) && !(r.name in allow.knownGaps));
  const known = neverRead.filter(r => r.name in allow.allowed);
  const gaps = neverRead.filter(r => r.name in allow.knownGaps);

  if (process.argv.includes("--update")) {
    for (const d of dead) if (!allow.allowed[d.name]) allow.allowed[d.name] = "待复核：" + d.owner + " @ " + d.file;
    allow.knownGaps = allow.knownGaps ?? {};
    fs.writeFileSync(ALLOW, JSON.stringify(allow, null, 1), "utf8");
    console.log("已写入 allowlist：" + Object.keys(allow.allowed).length + " 项允许 / " + Object.keys(allow.knownGaps).length + " 项待办");
  }

  const byOwner = new Map<string, Row[]>();
  for (const r of rows) { const a = byOwner.get(r.owner) ?? []; a.push(r); byOwner.set(r.owner, a); }

  console.log("=== 字段级接线普查 ===");
  console.log("契约字段 " + rows.length + " 个｜有生产读取方 " + (rows.length - neverRead.length) + " 个｜从未被读 " + neverRead.length + " 个（按设计 " + known.length + "｜**未完成 " + gaps.length + "**｜新增 " + dead.length + "）");
  console.log("");
  for (const [owner, list] of byOwner) {
    const bad = list.filter(r => r.dots + r.bares === 0);
    console.log("[" + owner + "] " + list.length + " 字段" + (bad.length ? "  ⚠ 未读 " + bad.length + "：" + bad.map(b => b.name).join(" ") : "  ✓"));
    for (const r of list) {
      const mark = r.dots + r.bares === 0 ? (r.name in allow.allowed ? "○" : (r.name in allow.knownGaps ? "△" : "✗")) : "✓";
      console.log("   " + mark + " " + r.name.padEnd(24) + " 读 " + String(r.dots + r.bares).padStart(3) + "｜写 " + String(r.writes).padStart(3) + "  " + r.readers.slice(0, 2).join(", "));
    }
  }
  console.log("");
  if (gaps.length) {
    console.log("△ 未完成（机制该读它，但还没接线 —— 这是待办，不是通过）：");
    for (const g of gaps) console.log("   " + g.name.padEnd(22) + " " + g.owner + " @ " + g.file + "\n      " + allow.knownGaps[g.name]);
    console.log("");
  }
  if (dead.length) {
    console.log("✗ 以下字段在生产代码里**从未被读取**（写进去也没人用 = 该机制在实战中不存在）：");
    for (const d of dead) console.log("   " + d.name + "   " + d.owner + " @ " + d.file);
    console.log("");
    console.log("处理方式二选一：① 接线（让机制真的生效）；② 写进 tools/field-allowlist.json 并写明为何可以永远不读。");
    process.exitCode = 1;
  } else {
    console.log("✓ 没有未接线的契约字段");
  }
}