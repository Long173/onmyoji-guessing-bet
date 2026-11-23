// tests/g105-ref-damage.ts — ★★★ 第 183 轮：**引用式写法的假阳性伤害**（「等同于伤害N%」不是「造成伤害」）
//
// 由来：晴思日和坊「澄空彩虹」写的是「其他友方造成伤害时，**储存等同于伤害20%**的[彩虹能量]」。
//   编译器把那个 20% 当成了一次伤害（damage=[{ratio:20}]）—— 于是这个被动"看起来有可执行效果"，
//   被被动运行时装上了（hasExecutableSurface 认 damage）。**一条假产物一路骗到了装配层。**
// 修法：子句里出现「等同于/相当于 … 伤害N%」**且这一句没有「造成/打出/施加」这类动词** ⇒ 那个 N% 不是伤害
//   （是"以伤害为参照做别的事"：治疗 / 转护盾 / 储存…），拒绝它并留痕（damageSkips）。
//   ★ 反向不许误伤：茨木童子「对敌方全体造成**等同过量伤害**100%伤害」有「造成」动词 ⇒ 保留。
import fs from "node:fs";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const irs = (input.skills as any[]).map((e: any) => ({ key: String(e.key), ir: JSON.parse(String(e.json)) }));
const irOf = (k: string) => irs.find((x) => x.key === k)!.ir;
sec("[1] ★★★ 被拒的假阳性伤害：6 条，每条都带理由码与证据子句");
{
  const hits = irs.filter((x) => (x.ir.damageSkips ?? []).length > 0);
  console.log("  " + hits.map((x) => x.key + " " + JSON.stringify(x.ir.damageSkips.map((s: any) => s.reason + ":" + s.ratio + "@" + String(s.evidence).slice(0, 26)))).join("\n  "));
  ok("★★★ 有 damageSkips 的技能 = 6（第 183 轮的 4 条 + 第 188 轮的 2 条）",
    hits.length === 6 && hits.map((x) => x.key).sort().join() === "247/247_02,253/253_03,292/292_02,304/304_01,306/306_02,580/580_02",
    JSON.stringify(hits.map((x) => x.key)));
  ok("★★★ 理由码只有两种（第 183 轮的引用式 + 第 188 轮的概率式），且**证据子句一律非空**",
    hits.every((x) => x.ir.damageSkips.every((s: any) => ["DAMAGE_REFERENCE_NOT_DEALT", "PROBABILITY_NOT_DAMAGE"].includes(s.reason) && String(s.evidence).length > 6)),
    JSON.stringify(hits.flatMap((x) => x.ir.damageSkips)));
  ok("★★★ 而**被拒的那个 ratio 确实不在** damage 里（拒绝是真的生效，不是只记账）",
    hits.every((x) => x.ir.damageSkips.every((s: any) => !(x.ir.damage ?? []).some((d: any) => d.ratio === s.ratio))));
  ok("★★★ 第 183 轮那一种（引用式）的性质不变：**都不是「造成伤害」** —— 判据就是这一句里没有「造成/打出/施加」这类动词",
    hits.flatMap((x) => x.ir.damageSkips).filter((s: any) => s.reason === "DAMAGE_REFERENCE_NOT_DEALT")
      .every((s: any) => !/造成|打出|施加|受到/.test(String(s.evidence))),
    JSON.stringify(hits.flatMap((x) => x.ir.damageSkips).filter((s: any) => s.reason === "DAMAGE_REFERENCE_NOT_DEALT")));
  /**
   * ★★★ 第 188 轮：**第二种理由码**（PROBABILITY_NOT_DAMAGE）的判据与上面那一种**完全不同** ——
   *   上面是「这句话里没有造成类动词」，这里是「紧跟数字的那个 tips 是概率」。
   *   所以断言必须**按理由码分开写**：混在一条里，新理由码一出现就会让旧断言的红点指错方向
   *   （第 188 轮实测：旧断言 `every(不是造成动词)` 被 292/292_02 的「附加」当场照红）。
   */
  const probSkips = hits.flatMap((x) => x.ir.damageSkips).filter((s: any) => s.reason === "PROBABILITY_NOT_DAMAGE");
  ok("★★★ 概率式那一种：证据子句里能看到 [tips_2]（=「基础概率」—— 数字紧跟的那个占位符）",
    probSkips.length === 2 && probSkips.every((s: any) => String(s.evidence).includes("[tips_2]")),
    JSON.stringify(probSkips));
  ok("★★ 其中至少两条的证据里能直接看到「治疗 / 护盾 / 储存」字样（其余是 raw 形态的 tips 占位符，解析后才看得出是护盾 / 彩虹能量）",
    hits.flatMap((x) => x.ir.damageSkips).filter((s: any) => /治疗|护盾|储存|恢复/.test(String(s.evidence))).length >= 2);
}
sec("[2] ★★★ 反向：不许误伤「造成等同过量伤害100%伤害」这种**真伤害**");
{
  const ir = irOf("265/265_02");
  ok("★★★ 茨木童子「迁怒」的伤害**保留**（子句里有「造成」动词）", (ir.damage ?? []).some((d: any) => d.ratio === 100) && !(ir.damageSkips ?? []).length,
    JSON.stringify({ damage: ir.damage, skips: ir.damageSkips ?? null }));
}

sec("[3] ★★★ 端到端：假产物没了 ⇒ 那个被动**不再被装上**");
{
  const s = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8")).find((c: any) => c.id === 580)!;
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name: s.name };
  const a: any = assembleMatch(createKit(bundle), m, { seed: 183, passives: "PARSED_CANDIDATES_ONLY" });
  await a.battle.runStartup();
  const e = a.battle.teams[0].members[0];
  const mine = (a.battle.passiveReport?.installed ?? []).filter((x: any) => x.entityId === e.id);
  ok("★★★ 晴思日和坊**一条都没装**（此前靠那条假阳性伤害才装上）", mine.length === 0, JSON.stringify(mine.map((x: any) => x.skill)));
  ok("★★ 而它的 IR damage 现在是空的", (irOf("580/580_02").damage ?? []).length === 0);
}

sec("[4] ★★ 基数记账（只记不改）：子句写「生命上限N%」而产物记 base=atk");
{
  const hits = irs.filter((x) => (x.ir.damageBaseMismatch ?? []).length > 0);
  console.log("  带 damageBaseMismatch 的技能 = " + hits.length + "：" + hits.map((x) => x.key).join(" · "));
  ok("★★★ 有 damageBaseMismatch 的技能 = 10", hits.length === 10, String(hits.length));
  ok("★★★ 每一条都**对应一个真实存在的伤害槽位**（不许把纯条件句收进来）",
    hits.every((x) => x.ir.damageBaseMismatch.every((m: any) => (x.ir.damage ?? []).some((d: any) => d.ratio === m.ratio))));
  ok("★★★ 而产物里的 base **仍然**是 atk（本轮只记账、不改行为 —— 改它会动默认档指纹）",
    hits.every((x) => (x.ir.damage ?? []).every((d: any) => (d.base ?? "atk") === "atk")));
}

console.log("\n=== 引用式假阳性伤害: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
