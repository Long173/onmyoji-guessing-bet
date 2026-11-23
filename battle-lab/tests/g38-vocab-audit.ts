// tests/g38-vocab-audit.ts — ★★ 词汇重复普查的自检（第 63 轮）
//
// 按本项目规矩（§25 / §26 / §34 / §39）：**新检查器必须先能双向自证伪**，
// 否则它只是又一张"看起来很严"的清单。上一轮我拆掉的那条形状断言就是反面教材。
//
// 这个自检分两层：
//   [1]-[3] 合成源码 —— 精确压提取与分组的每一条规则，两个方向都查（该报的报、不该报的别报）；
//   [4]     真实仓库 —— 今天必须 0 组未说明，而且**组数必须 > 0**（防止"什么都没扫到"也算通过）。
import fs from "node:fs";
import path from "node:path";
import { extractVocab, crossFileGroups, auditVocab } from "../tools/vocab-audit.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");

sec("[1] ★★ 提取：三种形态都要认出来");
{
  const src = [
    'const LABEL: Record<string, string> = {',
    '  FULL: "完整", PARTIAL: "部分", NONE: "没有",',
    '};',
    'const ORDER = ["FULL", "PARTIAL", "NONE"];',
    'type X = "ALPHA" | "BETA" | "GAMMA";',
  ].join("\n");
  const hits = extractVocab("a.ts", src);
  ok("★★ 对象键（≥3 个全大写键）被认出", hits.some(h => h.kind === "对象键" && h.name === "LABEL"));
  ok("★★ 值是字符串 ⇒ 判定为映射表（isLabelMap）", hits.find(h => h.name === "LABEL")?.isLabelMap === true);
  ok("★★ 字符串数组被认出", hits.some(h => h.kind === "字符串数组"));
  ok("★★ 内联联合类型被认出", hits.some(h => h.kind === "联合类型" && h.members.join(",") === "ALPHA,BETA,GAMMA"));
  ok("★ 成员集合是去重且排序的（比对才稳定）",
    hits.find(h => h.name === "LABEL")?.members.join(",") === "FULL,NONE,PARTIAL");
}

sec("[2] ★★ 提取的反面：这些**不该**被认成词汇");
{
  const cases: Array<[string, string]> = [
    ["只有 2 个成员（太小，噪音）", 'const A = ["FULL", "NONE"];'],
    ["小写成员（不是枚举词汇）", 'const B = { a: 1, b: 2, c: 3 };'],
    ["混合大小写键（不是纯词汇表）", 'const C = { FULL: "x", partial: "y", NONE: "z" };'],
    ["只有 1 个字符串的数组", 'const D = ["ONLY"];'],
    ["普通代码里恰好有 3 个词", 'const e = f("A") || g("B") || h("C");'],
  ];
  for (const [name, src] of cases) {
    const hits = extractVocab("a.ts", src);
    ok("★★ 不报：" + name, hits.length === 0, JSON.stringify(hits.map(h => h.name + ":" + h.members.join("|"))));
  }
}

sec("[3] ★★ 分组与判定：跨文件才算一组，边界要认得出");
{
  const mk = (file: string, members: string, kind: any = "联合类型", isLabelMap = false) => ({
    file, line: 1, kind, name: "N", members: members.split(","), isLabelMap,
  });
  const same = [mk("battle-lab/kernel/a.ts", "FULL,NONE,PARTIAL"), mk("battle-lab/kernel/b.ts", "FULL,NONE,PARTIAL")];
  ok("★★ 同集合出现在 2 个文件 ⇒ 1 组", crossFileGroups(same).length === 1);
  ok("★ 只出现在 1 个文件 ⇒ 不成组（同一处写两遍不算重复）", crossFileGroups([same[0]]).length === 0);

  const cross = crossFileGroups([mk("battle-lab/kernel/a.ts", "X,Y,Z"), mk("apps/web/src/b.ts", "X,Y,Z")]);
  ok("★★ 引擎 + 界面 ⇒ crossesBoundary", cross[0].crossesBoundary === true);
  const testOnly = crossFileGroups([mk("battle-lab/tests/t.ts", "X,Y,Z"), mk("apps/web/tests/u.ts", "X,Y,Z")]);
  ok("★★ 只在测试之间重复 ⇒ **不算**跨边界（测试列举是合法的第三份）", testOnly[0].crossesBoundary === false);
  const map = crossFileGroups([mk("battle-lab/kernel/a.ts", "X,Y,Z"), mk("apps/web/src/b.ts", "X,Y,Z", "对象键", true)]);
  ok("★★ 界面侧是映射表 ⇒ hasLabelMap（这是最该盯的形态）", map[0].hasLabelMap === true);

  // 门本身：两边都验
  const groups = crossFileGroups([mk("battle-lab/kernel/a.ts", "X,Y,Z"), mk("apps/web/src/b.ts", "X,Y,Z")]);
  ok("★★★ 没写说明 ⇒ 判为未说明（门会红）", auditVocab(groups, {}).unlisted.length === 1);
  ok("★★★ 写了说明 ⇒ 判为已说明", auditVocab(groups, { "X,Y,Z": "说明：这里写清楚为什么安全" }).unlisted.length === 0);
  ok("★★ 占位式说明（太短）不算说明 —— 不给「待复核」留位置",
    auditVocab(groups, { "X,Y,Z": "待复核" }).unlisted.length === 1);
}

sec("[4] ★★★ 真实仓库：今天必须 0 组未说明，且组数 > 0");
{
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (/node_modules|\\.git|reference|_oas|_nga|omj_engine_probe|tools|experiments/.test(p)) continue;
        walk(p, out);
      } else if (/\.(ts|vue)$/.test(e.name)) out.push(p);
    }
    return out;
  };
  const files = [...walk(path.join(ROOT, "battle-lab")), ...walk(path.join(ROOT, "apps", "web"))]
    .map(f => path.relative(ROOT, f).split(path.sep).join("/"));
  ok("★ 前置：真的扫到了文件（否则下面会平凡通过）", files.length > 100, String(files.length));
  const hits = files.flatMap(f => extractVocab(f, fs.readFileSync(path.join(ROOT, f), "utf8")));
  const groups = crossFileGroups(hits);
  ok("★ 前置：提取到了候选", hits.length > 50, String(hits.length));
  ok("★★ 前置：确实存在跨文件重复（否则这个工具是在空跑）", groups.length > 5, String(groups.length));
  const allowPath = path.join(ROOT, "battle-lab", "tools", "vocab-allowlist.json");
  const allow = JSON.parse(fs.readFileSync(allowPath, "utf8")).allowed ?? {};
  const { listed, unlisted } = auditVocab(groups, allow);
  ok("★★★ 每一组重复都有一句说明", unlisted.length === 0,
    JSON.stringify(unlisted.map(g => g.members.join(","))));
  console.log("    扫描 " + files.length + " 文件｜命中 " + hits.length + " 处｜" + groups.length + " 组（已说明 " + listed.length + "）");
  console.log("    跨引擎/界面边界 " + groups.filter(g => g.crossesBoundary).length + " 组，其中含映射表 " +
    groups.filter(g => g.crossesBoundary && g.hasLabelMap).length + " 组");
  // ★ 白名单不许留空话：每条说明都要够长、且不能是"待复核"这类占位
  const weak = Object.entries(allow).filter(([, v]) => String(v).trim().length < 20 || /待复核|TODO|未知/.test(String(v)));
  ok("★★ 白名单里没有占位式说明（每条都要真的说清为什么）", weak.length === 0, JSON.stringify(weak.map(w => w[0])));
  // ★ 反向：白名单里不许有已经不存在的组（僵尸条目会让"已说明"虚高）
  const zombie = Object.keys(allow).filter(k => !groups.some(g => g.key === k));
  ok("★★ 白名单里没有僵尸条目（组已经消失了就该删掉）", zombie.length === 0, JSON.stringify(zombie));
}

console.log("\n=== 词汇重复普查自检: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
