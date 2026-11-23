// tests/g125-diff-instrument.ts — ★★★ 第 247 轮：**G6 的 diff 仪器自证**（两条路径都要有例子）
//
// 由来：目标 ⑧ 缺的是**游戏内观测**（外部输入）—— 但"缺数据"不能当成"仪器没验过"。
//   实测：这一族此前只有**分歧**那一侧的例子（fixtures/observations-demo-ok.json，第 222 轮起就知道它过期/分歧），
//   **"一致"那一侧一个例子都没有** ⇒ 就算明天有人拿来正确观测，我们也没有证据表明 diff 会判它一致。
// 这一轮的夹具：fixtures/observations-demo-match.json（tools/build-observation-fixture.ts 生成）——
//   把模拟器自己的投影当成观测 ⇒ 按构造必然一致。★ 它是**仪器自检夹具**，不是真实性证据（真实观测必须来自游戏内）。
//
// 判据：① 一致路径真的返回 ok；② 篡改一处 ⇒ 必须报出**那一处**（反向对照）；③ 观测里没写的字段不比较（设计口径）；
//   ④ 旧的分歧夹具仍然给出明确裁决（不崩、不静默）；⑤ 同一份输入两次裁决逐字相同（仪器本身确定）。
import fs from "node:fs";
import path from "node:path";
import { diffObserved } from "../tools/fidelity-cli.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const FIX = (n: string) => path.join(ROOT, "battle-lab", "fixtures", n);
const MATCH = FIX("observations-demo-match.json");
const TMP = path.join(ROOT, "battle-lab", "tools", "_tmp-g125-tampered.json");
const SEED = 123456;

sec("[1] ★★★ 一致路径：合成夹具（模拟器自己的投影）⇒ diff 必须判「一致」");
const d1: any = await diffObserved(MATCH, SEED);
{
  ok("★★★ ok = true 且**没有**首处分歧（这是这一族此前的空白：一致那一侧从来没被证明过）",
    d1.ok === true && d1.first === null, JSON.stringify({ ok: d1.ok, first: d1.first }));
  ok("★★ 观测帧数与模拟帧数一致（" + d1.observed + " / " + d1.simulated + "）", d1.observed === d1.simulated && d1.observed > 100, JSON.stringify([d1.observed, d1.simulated]));
  ok("★★ 摘要里也没有分歧（summary 的形状由库层给）", !!d1.summary && (d1.summary.divergences === undefined || d1.summary.divergences === 0), JSON.stringify(d1.summary));
}

sec("[2] ★★★ 反向对照：篡改**一处**伤害 ⇒ 必须报出那一处（不是「全都报」也不是「没看见」）");
{
  const raw = JSON.parse(fs.readFileSync(MATCH, "utf8"));
  const idx = raw.frames.findIndex((f: any) => f.kind === "DAMAGE" && typeof f.amount === "number");
  ok("★★ 前置：夹具里找得到一条带 amount 的伤害帧（第 " + idx + " 帧）", idx >= 0, String(idx));
  /**
   * ★★ 实测（第一版踩的坑）：diff 的数值比较**默认容差 1**（游戏画面四舍五入）—— 篡改 +1 会被容差吃掉，
   *   于是"篡改一处"这条断言第一版是绿的假象（ok=true）。这里改成 +50（远超容差），并保留 +1 的对照。
   */
  const plus1 = raw.frames.map((f: any, i: number) => i === idx ? { ...f, amount: Number(f.amount) + 1 } : f);
  fs.writeFileSync(TMP, JSON.stringify({ note: "篡改 +1（容差内）", seed: SEED, frames: plus1 }, null, 1), "utf8");
  const dTol: any = await diffObserved(TMP, SEED);
  fs.unlinkSync(TMP);
  ok("★★ 容差口径：+1 的改动**不算**分歧（默认容差 1，游戏画面四舍五入）—— 这条把口径钉住",
    dTol.ok === true, JSON.stringify({ ok: dTol.ok, first: dTol.first }).slice(0, 160));
  const frames = raw.frames.map((f: any, i: number) => i === idx ? { ...f, amount: Number(f.amount) + 50 } : f);
  fs.writeFileSync(TMP, JSON.stringify({ note: "第 247 轮 g125 的临时篡改件", seed: SEED, frames }, null, 1), "utf8");
  const d2: any = await diffObserved(TMP, SEED);
  fs.unlinkSync(TMP);
  ok("★★★ 篡改一处 ⇒ ok = false", d2.ok === false, JSON.stringify({ ok: d2.ok }));
  ok("★★★ 而且报的就是**那一个下标**（" + (d2.first?.index ?? "?") + " == " + idx + "）—— 第一处分歧要能定位，不是笼统的「有差异」",
    Number(d2.first?.index) === idx, JSON.stringify(d2.first).slice(0, 200));
}

sec("[3] ★★ 设计口径：观测里**没写的字段不比较**（不然人工记录会被迫填满）");
{
  const raw = JSON.parse(fs.readFileSync(MATCH, "utf8"));
  /**
   * ★★ 实测（第二个坑）：**对齐用的字段不能删**。第一版只留 kind/actor，diff 立刻报 MISSING/索引 0 ——
   *   因为它是靠 kind/actor/target 把观测帧对到模拟帧上的（`target` 缺失 ⇒ 对不上）。
   *   正确口径：**数值字段**（amount/hpAfter/orbs/status/skill）缺省即不比较，而**对齐字段**要留着。
   */
  const lean = raw.frames.map((f: any) => ({ kind: f.kind, actor: f.actor, target: f.target }));
  fs.writeFileSync(TMP, JSON.stringify({ note: "只留 kind/actor", seed: SEED, frames: lean }, null, 1), "utf8");
  const d3: any = await diffObserved(TMP, SEED);
  fs.unlinkSync(TMP);
  ok("★★★ 只写对齐字段（kind/actor/target）也判一致 ⇒ 数值字段缺省确实被跳过，而不是当成「不匹配」", d3.ok === true, JSON.stringify({ ok: d3.ok, first: d3.first }).slice(0, 200));
}

sec("[4] ★★ 旧的分歧夹具仍然给出明确裁决（不崩、不静默）");
{
  const d4: any = await diffObserved(FIX("observations-demo-ok.json"), SEED);
  console.log("    裁决：ok=" + d4.ok + "｜首处分歧=" + (d4.first ? JSON.stringify(d4.first).slice(0, 160) : "无"));
  ok("★★ 仪器给出布尔裁决（无论 ok 与否，都不抛异常、不返回 null）", typeof d4.ok === "boolean", String(typeof d4.ok));
  ok("★★ 若判分歧 ⇒ 必须带得出**首处**的位置与形状（报告 §176 的用法依赖它）", d4.ok === true || (d4.first && d4.first.index !== undefined), JSON.stringify(d4.first).slice(0, 160));
}

sec("[5] ★★ 确定性：同一份输入两次裁决逐字相同（仪器自己也要可复现）");
{
  const a: any = await diffObserved(MATCH, SEED);
  const b: any = await diffObserved(MATCH, SEED);
  ok("★★ 两次裁决 JSON 逐字相同", JSON.stringify({ ok: a.ok, first: a.first, summary: a.summary }) === JSON.stringify({ ok: b.ok, first: b.first, summary: b.summary }), "两次结果不同");
}

console.log("\ng125-diff-instrument: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);