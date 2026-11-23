// tools/citation-audit.ts — ★★★ 第 241 轮：把「报告引用的路径必须解析得到」做成**常驻仪器**（可被尺子调用）
//
// 由来：第 215 轮（报告 §173）做过一次证据链审计，结论 219/219、缺失 0 —— 但那次是**一次性脚本**，没留在仓库里。
//   于是第 238 轮又出现 `runner/diff-cli.ts` 这种"引用了但不存在"的路径（§176.1b 才修）。
//   「报表引用的东西必须真的在」与 census 的「变化必须被解释」是同一类闸门：**没有常驻仪器就会再犯**。
//   ★ 第 241 轮实测（第一次跑）：706 处引用里 41 处解析不到 —— 其中多数是**裸文件名**（如 `presenter.ts`），
//     那不是错，是引用写法；所以解析器要按「候选根 + 全仓基名」两级找。剩下的才是真缺口。
//
// 判据：抽出文档里所有反引号包起来的文件类引用（.ts/.mjs/.json/.vue/.md），逐级解析：
//   ① 候选根（仓库相对 / battle-lab / apps/web / tests / kernel / compile / tools / data）；
//   ② 全仓基名索引（排除 node_modules / dist / .git）；③ 路径后缀匹配（引用写的是路径尾部）。
// 运行：cd battle-lab && node tools/citation-audit.ts [--check] [--file <相对路径>]
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ROOTS = ["", "battle-lab/", "battle-lab/tools/", "battle-lab/tests/", "battle-lab/kernel/", "battle-lab/compile/", "apps/web/", "apps/web/src/", "apps/web/tests/", "tools/", "data/"];
const SKIP = new Set(["node_modules", "dist", ".git", ".vite", "coverage"]);

function walk(d: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(path.relative(ROOT, p).replace(/\\/g, "/"));
  }
  return acc;
}
const ALL = walk(ROOT);
const byBase = new Map<string, string[]>();
for (const p of ALL) { const b = p.split("/").pop()!; if (!byBase.has(b)) byBase.set(b, []); byBase.get(b)!.push(p); }

export interface CitationMiss { ref: string; where: string }
export function auditCitations(docs: string[]): { total: number; missing: CitationMiss[] } {
  const RE = /`([A-Za-z0-9_./\-]+\.(?:ts|mjs|json|vue|md))`/g;
  const missing: CitationMiss[] = [];
  let total = 0;
  for (const d of docs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    lines.forEach((line: string, i: number) => {
      for (const m of line.matchAll(RE)) {
        const ref = m[1];
        if (/\.\.\.|^https?:|^-/.test(ref)) continue;
        total++;
        /**
         * ★ 两级判据，且**带斜杠的引用不许只靠基名蒙混**：
         *   · 不带斜杠（`presenter.ts`）⇒ 全仓基名索引能找到即可（引用写法如此，不是错）；
         *   · 带斜杠（`theatre/transport.ts`）⇒ 必须**候选根命中**或**全路径后缀命中**；
         *     只靠基名算过会把「目录写错」当成 OK —— 第 215 轮修的正是这种（theatre vs theater）。
         */
        /** ★ §173.3 的规矩编码进来：**明写「已删除 / 已佚」的引用是合规的**（要么在磁盘上，要么明写已佚）。
         *  这不是白名单（不认名字），是认**那句话说了什么**。 */
        if (/(已删除|已佚|佚失)/.test(line)) continue;
        const hasSlash = ref.includes("/");
        const ok = ROOTS.some((r) => fs.existsSync(path.join(ROOT, r + ref)))
          || ALL.some((p) => p.endsWith("/" + ref))
          || (!hasSlash && (byBase.get(ref) ?? []).length > 0);
        if (!ok) missing.push({ ref, where: d + ":" + (i + 1) });
      }
    });
  }
  return { total, missing };
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]).replace(/\\/g, "/").endsWith("tools/citation-audit.ts");
if (isMain) {
  const i = process.argv.indexOf("--file");
  const docs = i >= 0 ? [process.argv[i + 1]] : ["10-M1.9-全局战斗与真实性体系.md"];
  const { total, missing } = auditCitations(docs);
  const uniq = new Map<string, string>();
  for (const m of missing) if (!uniq.has(m.ref)) uniq.set(m.ref, m.where);
  console.log("文档 " + docs.join(" / ") + "：反引号路径引用 " + total + " 处｜**解析不到 " + missing.length + " 处**（去重 " + uniq.size + " 个名字）");
  for (const [ref, where] of uniq) console.log("  · " + ref + "   （首次出现 " + where + "）");
  if (process.argv.includes("--check")) process.exit(missing.length === 0 ? 0 : 1);
}