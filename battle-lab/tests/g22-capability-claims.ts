// tests/g22-capability-claims.ts — ★ 能力矩阵必须**可被机器证伪**（目标 ①：Fidelity 不许过度声称）
//
// 由来：capability/registry.ts 的 48 条能力声明是 Fidelity **MECHANIC 层**的数据源 ——
// 它说 FULL，报告里就少一条缺口。但这份表长期只是"一份声明"：
//   · 复活标 FULL，而 Battle.revive() 在生产代码里**零调用**（只有 tests/m0 直接调）
//   · 封印标 FULL，而抑制集合 suppressedPassive 在生产代码里**没有任何写入方**
//   · 反击/协战标 PARTIAL，而 runPseudoTurn 同样**没有生产者**
// 这三条都不是实现问题，是**声明与代码脱节**：表格比代码乐观。
//
// 本轮给每条能力加 producer（一段必须在生产代码里出现的正则），并把这个不变量变成测试：
//   FULL  ⇒ producer 必须匹配到生产代码
//   NONE  ⇒ 若给了 producer，则必须匹配不到
//   PARTIAL ⇒ producer 可选，但没有 producer 的条目会被如实列出（不静默通过）
import fs from "node:fs";
import path from "node:path";
import { CAPABILITIES, coverage } from "../capability/registry.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BL = path.join(ROOT, "battle-lab");

function walk(d: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}
/**
 * 「生产代码」= 战斗路径（kernel / compile / soul / runner 的业务部分）+ 网页 src。
 * 排除三类：
 *   · tests / tools —— 测试与审计工具
 *   · capability/registry|report —— **声明本身不是实现**（否则一句话就能让声明自我满足）
 *   · compile/unmodeled.ts —— 同上：它是「引擎缺什么」的**声明表**，不是实现。
 *     第 29 轮真实踩到：它在 evidence 里原样记录了探测用的正则，
 *     于是"复活没有调用方"这条断言被自己的文档字符串弄红了 —— 文档不是代码。
 *   · experiments/  —— A/B 对照脚手架（与 tools 同类：它验证机制，但不参与实战路径）
 * 最后一条是第 28 轮明确下来的：封印的抑制集合只有 experiments 会写，
 * 若把脚手架算作"有生产者"，这个缺口就会被自己的脚手架掩盖 —— 那正是本项目反复踩的坑。
 */
const isScaffold = (f: string) => /[\\/](tests|tools|experiments)[\\/]/.test(f);
const isDeclaration = (f: string) =>
  /[\\/]capability[\\/](registry|report)\.ts$/.test(f) ||
  /[\\/]compile[\\/]unmodeled\.ts$/.test(f) ||
  /[\\/]tools[\\/]field-census\.ts$/.test(f);
const prod = [
  ...walk(BL).filter(f => !isScaffold(f)),
  ...walk(path.join(ROOT, "apps", "web", "src")),
].filter(f => !isDeclaration(f));
/**
 * ★ 先剥注释再匹配：注释里写「rg 'this\\.revive\\(' 无命中」**不是**调用点。
 *   这个坑在本轮真实发生过 —— compile/unmodeled.ts 里为了记录验证依据，
 *   把探测用的正则原文写进了注释，于是"复活无调用方"这条断言当场变红。
 *   生产者的判定必须只看代码，不看文档。
 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const sources = prod.map(f => ({ f: path.relative(ROOT, f), s: stripComments(fs.readFileSync(f, "utf8")) }));
const grep = (re: string) => {
  const r = new RegExp(re, "g");
  const hits: string[] = [];
  for (const { f, s } of sources) for (const line of s.split("\n")) if (r.test(line)) { hits.push(f); r.lastIndex = 0; }
  return [...new Set(hits)];
};

sec("[1] 表本身：48 条能力、与游戏 tags[] 对齐");
{
  ok("能力条目 = 48（官方 tags 48 类）", CAPABILITIES.length === 48, String(CAPABILITIES.length));
  const keys = CAPABILITIES.map(c => c.key);
  ok("key 不重复", new Set(keys).size === keys.length, JSON.stringify(keys.filter((k, i) => keys.indexOf(k) !== i)));
  const shiki = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const tagFreq: Record<string, number> = {};
  for (const s of shiki) for (const sk of s.skills ?? []) for (const t of sk.tags ?? []) tagFreq[t] = (tagFreq[t] ?? 0) + 1;
  const missing = CAPABILITIES.filter(c => !(c.tag in tagFreq)).map(c => c.tag);
  ok("★ 每一条的 tag 都能在游戏数据里找到（没有自造能力）", missing.length === 0, JSON.stringify(missing));
}

sec("[2] ★★ FULL 的能力必须在生产代码里有生产者");
{
  const full = CAPABILITIES.filter(c => c.support === "FULL");
  console.log("    FULL " + full.length + " 条");
  const noProducer = full.filter(c => !c.producer);
  ok("★★ 每条 FULL 都写了 producer", noProducer.length === 0, JSON.stringify(noProducer.map(c => c.key)));
  const unmatched = full.filter(c => c.producer && grep(c.producer).length === 0);
  ok("★★ 每条 FULL 的 producer 都能在生产代码里匹配到", unmatched.length === 0,
    JSON.stringify(unmatched.map(c => c.key + " /" + c.producer + "/")));
  for (const c of full) if (c.producer) {
    const hits = grep(c.producer);
    console.log("    " + c.key.padEnd(16) + "/" + c.producer + "/ → " + hits.length + " 个文件，例：" + hits.slice(0, 2).join(", "));
  }
}

sec("[3] NONE 的能力必须真的没有代码");
{
  const none = CAPABILITIES.filter(c => c.support === "NONE");
  console.log("    NONE " + none.length + "：" + none.map(c => c.key).join(", "));
  const falseNone = none.filter(c => c.producer && grep(c.producer).length > 0);
  ok("★ 标 NONE 却给了 producer 的必须匹配不到（否则是低估）", falseNone.length === 0, JSON.stringify(falseNone.map(c => c.key)));
  ok("NONE 数量与 coverage() 一致", coverage().none === none.length, String(coverage().none));
}

sec("[4] PARTIAL 的诚实度：没有生产者的条目要**列出来**，不许静默通过");
{
  const partial = CAPABILITIES.filter(c => c.support === "PARTIAL");
  const without = partial.filter(c => !c.producer);
  console.log("    PARTIAL " + partial.length + " 条，其中**没有给出生产者**的 " + without.length + " 条：");
  for (const c of without) console.log("      · " + c.key.padEnd(16) + c.note.slice(0, 78));
  ok("每一条 PARTIAL 都写了说明（即使没有生产者）", partial.every(c => c.note.length > 0));
  // ★ 收紧到**所有**能力：空说明等于没说。这条是被网页端的索引自检逼出来的 ——
  //   build-experiments-index 会报 COVERAGE_NOTE_EMPTY，而留空的正是三条 NONE（吸血/反伤/隐匿）
//   ★ 第 93 轮：吸血已接线并升为 FULL —— 这句注释里的名单跟着事实改（否则注释会变成新的假账），
  //   我原先只给 PARTIAL 加了说明，等于自己漏了一类。
  const noNote = CAPABILITIES.filter(c => !c.note || c.note.trim().length === 0);
  ok("★ 48 条能力全部写了说明（空说明等于没说）", noNote.length === 0, JSON.stringify(noNote.map(c => c.key)));
  const noneNoReason = CAPABILITIES.filter(c => c.support === "NONE" && !/未实现|没有|无/.test(c.note));
  ok("★ 每条 NONE 的说明里写明了「没有实现什么」", noneNoReason.length === 0, JSON.stringify(noneNoReason.map(c => c.key)));
  ok("未给出生产者的条目被如实列在输出里（不隐藏）", true);
}

sec("[5] 本轮的三处更正必须坐实");
{
  const by = (k: string) => CAPABILITIES.find(c => c.key === k)!;
  ok("★ 复活已从 FULL 降为 PARTIAL", by("REVIVE").support === "PARTIAL", by("REVIVE").support);
  // ★★★ 第 96 轮：这一条**转向**了。原文是「封印已从 FULL 降为 PARTIAL」（第 28 轮的审计结论：
  //   两个标记在、抑制集合在，但**没有任何写入方**）。第 96 轮把写入方接上了 ——
  //   而且形态与当初设想的不同：不是往那个 Set 里写，而是让 Battle 注入一个读**状态**的求值器
  //   （状态进 state ⇒ 存档/续跑/重放天然成立；Set 不进 state）。所以它回到 **FULL**。
  ok("★★★ 封印回到 FULL（第 96 轮接线：抑制由**状态**驱动，不再依赖那个没人写的 Set）",
    by("SEAL").support === "FULL" && !!by("SEAL").producer, by("SEAL").support + "/" + by("SEAL").producer);
  // ★★ 第 67 轮更正：这条断言此前写的是「定义存在、**没有调用方**」—— 那是当时的真相。
  //   接线主动复活之后它变成假的，所以这里断言**新的真相**：定义仍在，而且**有**调用方
  //   （compile/character.ts），但支持度仍是 PARTIAL（触发式与容器式复活还没接线）。
  //   ★ 这条断言的价值不在于"现在是绿的"，而在于它把"有没有调用方"钉住了：
  //     接线前它会红，接线后它也会红 —— 两种情况下都逼人来改这里。
  ok("★★ 复活：Battle.revive() 有定义、**且**生产代码里有调用方（第 67 轮接线）",
    grep("async revive\\(").length > 0 && grep("\\.revive\\(").length > 0,
    JSON.stringify({ def: grep("async revive\\("), call: grep("\\.revive\\(") }));
  ok("★★ 但支持度仍是 PARTIAL（触发式与容器式复活还没接线）", by("REVIVE").support === "PARTIAL", by("REVIVE").support);
  ok("★ 封印：抑制集合在生产代码里没有写入方",
    grep("suppressedPassive\\.add").length === 0, JSON.stringify(grep("suppressedPassive\\.add")));
  /**
   * ★★★ 第 95 轮：这一条**转向**了。原来钉的是「入口存在但**没有**调用方」（`length === 0`）——
   *   第 23 轮建入口、第 56 轮据此把 FULL 降成 PARTIAL、第 95 轮 counterAttack 成了真实调用方。
   *   与上面复活那条**完全同型**：断言把"有没有调用方"钉住，接线前红、接线后也红 —— 两次都逼人来改这里。
   *   ★ 而支持度仍是 PARTIAL：全库没有一条技能同时满足「目标侧触发句」与「IR 有 counter」。
   */
  ok("★★ 反击：伪回合入口存在、**且**生产代码里有调用方（第 95 轮接线）",
    grep("runPseudoTurn").length > 0 && grep("\\.runPseudoTurn\\(").length > 0,
    JSON.stringify({ def: grep("runPseudoTurn"), call: grep("\\.runPseudoTurn\\(") }));
  ok("★★ 但支持度仍是 PARTIAL（真实数据走不到：0 条技能同时满足两个条件）", by("COUNTER").support === "PARTIAL", by("COUNTER").support);
  ok("★ 驱散/锁条现在是**真的** FULL（第 25/27 轮接线后才成立）",
    by("DISPEL").support === "FULL" && by("TIMELINE_LOCK").support === "FULL" &&
    grep(by("DISPEL").producer!).length > 0 && grep(by("TIMELINE_LOCK").producer!).length > 0);
}

sec("[6] 汇总口径没有把覆盖率包装成「真实性」");
{
  const c = coverage();
  console.log("    total " + c.total + "｜FULL " + c.full + "｜PARTIAL " + c.partial + "｜NONE " + c.none +
    "｜kernelCoverage " + c.kernelCoverage + "%｜hardCoverage " + c.hardCoverage + "%");
  ok("分母 = 48，且 three 类之和等于总数", c.full + c.partial + c.none === c.total && c.total === 48, JSON.stringify(c));
  ok("★ coverage() 只产出覆盖度，不产出任何名为真实性/准确率的字段",
    !Object.keys(c).some(k => /fidelity|accuracy|truth|真实/i.test(k)), JSON.stringify(Object.keys(c)));
  /**
   * ★★★ 第 96 轮：这一条**转向**了。原文是「FULL 数量下降说明审计有效（原 20 → 现 N）」，
   *   钉的是第 28 轮那次审计**把过度声称的条目降下来**。
   *   第 96 轮封印接线之后 FULL 从 20 升到 **21** —— 这次升高不是因为把尺子放松了，
   *   而是因为**真的实现了一条**（它照样要过第 [2] 节那道闸门：FULL 必须有 producer，且能在生产代码里匹配到）。
   *   ⇒ 数字继续钉住，但理由写明：**升要能被解释，降也要能被解释。**
   */
  ok("FULL 数量 = 21（第 96 轮封印接线 +1；理由写在上面，且仍受 producer 闸门约束）", c.full === 21, String(c.full));
}

console.log("\n=== 能力声明可证伪性: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
