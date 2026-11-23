// tests/g119-explain-ledger.ts — ★★★ 第 239 轮：**解释台帐的内容也要可复算**（不只是"键在不在"）
//
// 由来（本轮实测，不是推理）：compile-census 对台帐只有一条判据 —— **键在不在**（diffCensus: !!explain[key]）。
//   tools/compile-explain.json 里每一条都写着一句「本条实际差异字段为 [...]」，那是给人看的散文；
//   第 239 轮给 skills:293/293_02 加了 counterCast 之后 census 依然 **393（已解释 393｜未解释 0）**，
//   而那条台帐的清单里没有 counterCast ⇒ 台帐的**存在性**被检查了，**内容**没有：
//   它可以一直停在旧事实上，而所有仪表都是绿。量化（tools/explain-refresh.ts 复算）：
//   **195/393** 条的清单停留在旧事实（e2e 例：skills:209/209_02 写 6 个字段、实际只剩 statusCaps；
//   skills:16/16_07 写 lifesteal/revive/shieldSkips…、实际是 controlRefs/recognized.1/statusStacks）；
//   **57 条**的散文连"变了哪些字段"都没点全（34 条漏 recognized）。
//
// 本尺子的判据：
//   ① 覆盖面：变化的每一条都有解释（census 那半条，固定前提，不重复它的工作）；
//   ② ★★★ 状态：台帐 == 复算（清单逐项相等、机器注幂等）—— 由 tools/explain-refresh.ts 的 auditLedger 判定；
//   ③ ★★★ 内容：每一条变化的台帐都**点名**了每一个变化字段（人写散文或机器注，必须在正文里出现）；
//   ④ ★★ 钉住本轮量出来的事实（223 带清单 / 170 散文式 / 57 未覆盖 / 80 处缺失）—— 数字变了要报告；
//   ⑤ ★★★ 反向对照：给清单塞假字段、把点名注删掉 ⇒ 复算必须立刻报"需要写回"（否则这条断言只是装饰）。
import fs from "node:fs";
import path from "node:path";
import { compileAll, diffCensus } from "../tools/compile-census.ts";
import { auditLedger, loadExplain, diffPaths, normJson } from "../tools/explain-refresh.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const base = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "compile-baseline.json"), "utf8"));
const exp = loadExplain();
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const r = diffCensus(base, input, exp);
const a = auditLedger(exp);

sec("[1] 覆盖面：变化的每一条都有解释（census 的那半条判据）");
{
  ok("★★★ 未解释的变化 = 0", r.unexplained.length === 0, JSON.stringify(r.unexplained.map((c: any) => c.ns + ":" + c.key)));
  ok("★★ 变化条数（" + r.changed.length + "）与台帐审计看到的一致（" + a.changed + "）", r.changed.length === a.changed && a.changed > 0, String(a.changed));
}

sec("[2] ★★★ 台帐的**内容**：清单 == 现在真正算出来的那组，且机器注幂等");
{
  ok("★★★ 需要写回的条目 = 0（清单逐项相等、点名注与散文一致；tools/explain-refresh.ts --check 的同一判据）",
    a.wrote === 0 && Object.keys(a.refreshed).length === 0, JSON.stringify({ wrote: a.wrote, keys: Object.keys(a.refreshed).slice(0, 5) }));
  ok("★★★ 清单已对 " + a.unchanged + " / 带清单 " + a.withList + "（不一致 " + a.rewritten + "）", a.rewritten === 0, JSON.stringify(a.mismatches.slice(0, 3)));
}

sec("[3] ★★★ 点名：每一个变化字段都必须在台帐正文里出现（人写散文或机器注）");
{
  const missing: Array<{ key: string; miss: string[] }> = [];
  let checked = 0;
  for (const c of r.changed) {
    checked++;
    const key = c.ns + ":" + c.key;
    const text = String(exp[key] ?? "");
    /** ★ 复算用 auditLedger 的同一份实现（diffPaths/normJson）—— 第一版误用了 a.mismatches，
     *  而那一列在"清单已全部落定"之后是**空的** ⇒ 断言会空转变成假绿（同一个坑：判据必须自己走一遍数据）。 */
    const fields = [...new Set(diffPaths(normJson(c.was), normJson(c.now)).map((f: string) => f.split(".")[0]))];
    const miss = fields.filter((f: string) => !text.includes(f));
    if (miss.length) missing.push({ key, miss });
  }
  ok("★★★ 台帐正文里没被点名的变化字段 = 0（" + r.changed.length + " 条全部检查；本轮实测最大项 recognized）", missing.length === 0, JSON.stringify(missing.slice(0, 5)));
  ok("★★ 审计口径自检：检查过的条目数 == auditLedger 看到的条目数（" + checked + " == " + a.changed + "）", checked === a.changed, String(checked));
}

sec("[4] ★★ 钉住本轮量出来的事实（数字变了必须报告，不许悄悄漂）");
{
  /** ★ 第 249 轮按事实改写：新增的 241_03 台帐是**散文式**（人写的一段），所以散文式 170 → 171、带清单仍是 223。 */
  /** ★★ 第 252 轮按事实改写：本轮新写 **8 条**台帐（262_03 / 281_03 / 324_03 / 392_02 / 399_03 / 556_03 / 592_03 / 607_03），
   *  每条都带「实际差异字段」清单 ⇒ 带清单 223 → **231**；散文式仍是 171（新写的 8 条不是散文式）。 */
  /** ★★ 第 253 轮按事实改写：本轮新写的 8 条是**散文式**（没有「实际差异字段」清单那一段）⇒ 散文式 171 → **179**、带清单仍是 231。 */
  /** ★★ 第 254 轮再按事实改写：本轮新写 4 条散文式台帐（两个新缺口动词涉及的 218_01 / 218_03 / 578_02 / 607_01）⇒ 散文式 179 → **183**；
   *  另把 556_03 / 607_03 两条**改写成带清单**的形式（它们从「记账」变成「已收 + 剩下的那两句另有账」）—— 带清单仍是 231（那两条本来就有清单）。 */
  /** ★★ 第 255 轮再按事实改写：本轮把三条 607 台帐从**散文式**改成**带清单**（它们现在写得出「实际差异字段」那一行，
   *  因为执行面真的接上了：selfHpLoss）⇒ 带清单 231 → **233**、散文式 183 → **181**。数字是事实，不是目标。 */
  ok("★★ 带「实际差异字段」清单的 = 233；散文式（第 194 轮那批 + 第 249/253/254/255 轮新写的）= 181", a.withList === 233 && a.proseOnly === 181, JSON.stringify({ withList: a.withList, proseOnly: a.proseOnly }));
  /** ★ 80 → 79 的原因如实写：本轮给 skills:293/293_02 补了**人写**的第 239 轮说明（它点了 counterCast 的名），
   *  于是机器需要补的那个字段少了一个。数字是事实，不是目标。 */
  /** ★ 第 249 轮按事实改写：新写的 241_03 说明点名了 overflowShield，但没点全（`recognized` 那类照旧要机器补）⇒ 57 → 58 条 / 79 → 80 处。 */
  /** ★★ 第 252 轮按事实改写：新写的 8 条台帐里，recognized / unmodeledMechanics 这类**结构字段**人写散文时不会逐个点名
   *  ⇒ 机器注要补的条目 58 → **60**、字段处数 80 → **97**（多出来的 17 处集中在 unmodeledMechanics 与 recognized 两族）。 */
  /** ★★ 第 253 轮再按事实改写：本轮又新写 8 条**散文式**台帐（伤害类型那一族）⇒ 散文式 171 → **179**；
   *  机器注要补的条目 60 → **62**、字段处数 97 → **107**（新条目点名了 damage，但 recognized 那一项照旧要机器补）。 */
  /** ★★ 第 254 轮按事实改写：新写的 4 条台帐里 sentences / unparsed 这类结构字段照旧要机器补名 ⇒ 条目 62 → **63**、处数 107 → **108**。 */
  /** ★★ 第 255 轮按事实改写：三条 607 台帐改成带清单之后，机器注要补的名反而**少了**（清单本身点了 recognized / selfHpLoss 等）
   *  ⇒ 条目 63 → **62**、处数 108 → **107**。 */
  ok("★★ 散文没点名全部变化字段的 = 62 条 / 共 107 处（机器注补的名，逐条带引入轮次）", a.named === 62 && a.missingFields === 107, JSON.stringify({ named: a.named, missingFields: a.missingFields }));
  console.log("    被点名最多的字段：" + a.missCounter.slice(0, 6).map(([f, n]) => f + " × " + n).join("｜"));
  console.log("    旧清单新增最多的字段：" + (a.addCounter.length ? a.addCounter.slice(0, 6).map(([f, n]) => f + " × " + n).join("｜") : "（本轮已全部落定，0 处待补）"));
}

sec("[5] ★★★ 反向对照：这一格真的在被看（塞假字段 / 删点名注 ⇒ 复算立刻报写回）");
{
  const sample = r.changed.find((c: any) => /实际差异字段为 \[/.test(String(exp[c.ns + ":" + c.key] ?? "")));
  const withNote = r.changed.find((c: any) => /【点名239/.test(String(exp[c.ns + ":" + c.key] ?? "")));
  ok("★★ 反向前置：样本齐（一条带清单、一条带点名注）", !!sample && !!withNote, JSON.stringify({ sample: sample?.key, withNote: withNote?.key }));
  if (sample) {
    const k = sample.ns + ":" + sample.key;
    const tampered = { ...exp, [k]: String(exp[k]).replace(/实际差异字段为 \[([^\]]*)\]/, (m0, g1) => "实际差异字段为 [" + g1 + (g1.trim().endsWith(",") ? "" : ",") + JSON.stringify("__TAMPER__") + "]") };
    const b = auditLedger(tampered);
    ok("★★★ 给清单塞一个假字段 ⇒ 复算报「需要写回」（清单不再等于事实）", b.wrote >= 1 && b.rewritten >= 1, JSON.stringify({ wrote: b.wrote, rewritten: b.rewritten }));
  }
  if (withNote) {
    const k = withNote.ns + ":" + withNote.key;
    const stripped = { ...exp, [k]: String(exp[k]).replace(/ ?【点名239[^】]*】/g, "") };
    const c2 = auditLedger(stripped);
    ok("★★★ 把机器补的点名注删掉 ⇒ 复算又把它补回来（说明它是**算出来的**，不是陈设）", c2.wrote >= 1, JSON.stringify({ wrote: c2.wrote }));
  }
}

console.log("\ng119-explain-ledger: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);