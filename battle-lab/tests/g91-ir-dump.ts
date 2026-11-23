// tests/g91-ir-dump.ts — ★★★ 第 137 轮：把「只写不读的全量 IR 转储」变成**可被断言**的产物
//
// 由来：报告 §39.5（第 47 轮）的处置是「skill-ir.json 保持原样 —— 它是转储，不是检查」。
// 那条处置留了一个没兑现的前提：转储得是**当前**编译器的产物。第 137 轮实测它已经不是了 ——
// 转储里 288_03「血之花海」的 shield 仍是 `{"ratio":20,"base":"maxHp"}`，
// 而第 80 轮修好后的活产物是 `{"ratio":20,"base":"lostHp","evidence":"…已损失生命…"}`。
// 一份"没人比对"的文件与真相矛盾时，**不会报错**：读它的人只会得到与事实相反的结论。
//
// 所以这一轮：① 生成方式统一到生产环境（compileAll，装 tips 表）；② 把"转储 == 生产产物"
// 做成断言，并且按项目纪律配**正向对照**（改一个字节必须红）—— 否则这条断言可能根本没在工作。
import fs from "node:fs";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";
import { compareDump, dumpKey } from "../tools/ir-dump.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const root = path.resolve(import.meta.dirname, "..", "..");
const DUMP = path.join(root, "battle-lab", "fixtures", "skill-ir.json");

const dump: any[] = JSON.parse(fs.readFileSync(DUMP, "utf8"));
const { input } = compileAll(path.join(root, "data", "kb"));

sec("[1] 转储的形状：它得是一份**能对得上键**的全量转储");
{
  ok("★ 转储是数组", Array.isArray(dump), typeof dump);
  ok("★★ 条数与生产产物一致（" + input.skills.length + "）", dump.length === input.skills.length, String(dump.length));
  const keys = dump.map(dumpKey);
  ok("★★★ 键唯一（重复键会让后一条覆盖前一条，把真差异藏起来）",
    new Set(keys).size === keys.length, keys.length - new Set(keys).size + " 个重复");
  ok("★ 每条都能反推出 charId/id（键不是空壳）",
    dump.every((ir: any) => ir && ir.charId !== undefined && ir.id), JSON.stringify(dump.find((ir: any) => !ir?.id) ?? null));
}

sec("[2] ★★★ 转储 == 生产产物（这一条就是本轮补的那张网）");
{
  const d = compareDump(dump, input.skills);
  ok("★★★ 逐字节相同 " + d.same + "/" + input.skills.length,
    d.same === input.skills.length && d.diff.length === 0 && d.missing.length === 0 && d.extra.length === 0 && d.dupInDump.length === 0,
    JSON.stringify({ diff: d.diff.slice(0, 3), missing: d.missing.slice(0, 3), extra: d.extra.slice(0, 3), dup: d.dupInDump.slice(0, 3) }));
}

sec("[3] ★★★ 正向对照：这张网不是空的（改一个字节必须红）");
{
  /**
   * ① 改**值**（不碰键）。
   *   ★ 这条对照被写错过两次，两次都红：
   *     · 第一次 `replace(/\d/, "7")` —— 第 0 条 JSON 的首个数字本来就是 7 ⇒ 改了个寂寞；
   *     · 第二次 `replace(/\d/, 换成别的数字)` —— 文本里第一个数字落在 **"id"** 上 ⇒ **键跟着变**，
   *       于是 compareDump 报的是「缺一条 + 多一条」（diff 是空的），而不是「同一条不同」。
   *   两次都是**断言写错**，不是代码错。现在把这两件事都显式断言下来：
   *   对照必须"改了值、没改键"；改键的语义（键是身份）由 ①b 单独钉。
   */
  const mutated = JSON.parse(JSON.stringify(dump));
  const m0 = JSON.parse(JSON.stringify(dump[0]));
  m0.name = String(m0.name) + "X";
  mutated[0] = m0;
  ok("★★ 对照自身：改了内容、**没动键**（否则下面那条测的是另一回事）",
    JSON.stringify(mutated[0]) !== JSON.stringify(dump[0]) && dumpKey(mutated[0]) === dumpKey(dump[0]),
    dumpKey(dump[0]));
  const m1 = compareDump(mutated, input.skills);
  ok("★★★ 只改一条的值 → 恰好报 1 条不同（并把 same 也一起钉住，防止「少算一条」被当成通过）",
    m1.diff.length === 1 && m1.same === input.skills.length - 1 && m1.missing.length === 0 && m1.extra.length === 0 && m1.dupInDump.length === 0,
    JSON.stringify({ diff: m1.diff, same: m1.same, missing: m1.missing.length, extra: m1.extra.length }));

  // ①b 改**键**：键是身份，不是内容 ⇒ 应当报「缺 1 + 多 1」，而不是「同一条不同」
  const rekey = JSON.parse(JSON.stringify(dump));
  rekey[0] = { ...rekey[0], id: String(rekey[0].id) + "X" };
  const m1b = compareDump(rekey, input.skills);
  ok("★★ 改键 ⇒ 报「缺 1 + 多 1」（这正是上面第二次写错时踩到的那条路径）",
    m1b.missing.length === 1 && m1b.extra.length === 1 && m1b.diff.length === 0,
    JSON.stringify({ missing: m1b.missing, extra: m1b.extra, diff: m1b.diff.length }));

  // ② 少一条：必须报"缺"，不能因为剩下的都对就判绿
  const m2 = compareDump(dump.slice(1), input.skills);
  ok("★★★ 少一条 → 报 1 条缺失（不许当成「都还在」）", m2.missing.length === 1 && m2.same === input.skills.length - 1, JSON.stringify(m2.missing));

  // ③ 多一条：也要报
  const m3 = compareDump([...dump, { charId: 99999, id: "99999_01" }], input.skills);
  ok("★★ 多一条 → 报 1 条多余", m3.extra.length === 1, JSON.stringify(m3.extra));

  // ④ 重复键：后一条会覆盖前一条 —— 只有查重才能抓到
  const dupDump = [...dump, JSON.parse(JSON.stringify(dump[0]))];
  const m4 = compareDump(dupDump, input.skills);
  ok("★★★ 重复键被查出来（否则「覆盖」会把差异藏起来）", m4.dupInDump.length === 1, JSON.stringify(m4.dupInDump));
}

sec("[4] ★★★ 本轮找到的那处具体矛盾：已损失生命的护盾在**转储里也必须是对的**");
{
  const pick = (id: string) => dump.find((ir: any) => ir.id === id);
  const a = pick("288_03"), b = pick("427_02");
  ok("★★★ 彼岸花「血之花海」：20% 已损失生命 ⇒ base=lostHp（第 80 轮修的那个 bug，转储里也得是修好的值）",
    a?.shield?.[0]?.base === "lostHp" && a?.shield?.[0]?.ratio === 20, JSON.stringify(a?.shield));
  ok("★★★ 彼岸花呱「呱·血之花海」：2% 已损失生命 ⇒ 同样 base=lostHp", b?.shield?.[0]?.base === "lostHp", JSON.stringify(b?.shield));
  ok("★ 反向：全库仍然只有 2 条 lostHp 护盾（不是「全都变成了 lostHp」这种放水）",
    dump.filter((ir: any) => (ir.shield ?? []).some((s: any) => s.base === "lostHp")).length === 2,
    String(dump.filter((ir: any) => (ir.shield ?? []).some((s: any) => s.base === "lostHp")).length));
}

sec("[5] ★★ 生成器自检过：report.ts 写完就比对（同一条判据，两个入口）");
{
  // report.ts 里的自检与这里的 [2] 用的是同一个 compareDump，这里只钉住"它确实被调用了"这件事
  // —— 判据是 compile/report.ts 的源码里出现 compareDump（改回"只写不比对"会让这条红）。
  //   ★ 判据必须**去掉注释行**再找：report.ts 的头部注释里就写着 `compileSkill(id, name, sk)`
  //     （第一版直接在原文上找 ⇒ 被自己的注释判红，又是一条"断言写错"）。
  const src = fs.readFileSync(path.join(root, "battle-lab", "compile", "report.ts"), "utf8")
    .split("\n").filter((l: string) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
  ok("★★★ compile/report.ts 写完转储后调用 compareDump 自检（不许退回「只写不读」）",
    /compareDump\s*\(/.test(src) && /process\.exitCode\s*=\s*1/.test(src), "report.ts 里没找到自检调用");
  ok("★★ 而且它走的是**生产环境**（compileAll，含 tips 表）—— 不是自己再编一遍",
    /compileAll\s*\(/.test(src) && !/compileSkill\s*\(/.test(src), "report.ts 仍在直接调 compileSkill");
}

console.log("\n=== 全量 IR 转储的一致性: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
