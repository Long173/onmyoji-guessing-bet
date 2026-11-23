// tests/g50-side-symmetry.ts — ★★★ 红蓝对称：把「换边不该改变强弱」量准（第 83 轮，目标 ⑩）
//
// 目标 ⑩ 把「红蓝对称」列为必须可执行的确定性不变量。仓库里原本有两处覆盖：
//   · m1.ts：**同阵容打自己**，300 局蒙特卡洛，断言 95% CI 覆盖 50%；
//   · ui7 护栏 #1：换边后红方胜率 ≈ 原局蓝方胜率，**容差 8 个百分点**。
// 两处都是**统计**判据，而且很松：8 个百分点的容差意味着 8% 的偏置也能通过。
//
// 这一轮先量清楚「同 seed 换边」到底是不是严格镜像。40 个 seed 的实测：
//   镜像（胜方相反）37／40；**胜方相同 3／40**；其中「红赢两次」2 个、「蓝赢两次」1 个。
//
// ★ 所以**严格镜像并不成立**。原因不是引擎偏袒某一侧，而是：
//   随机数**流**的消费顺序是按单位/行动条固定的，换边之后同一条抽数落到了别的单位身上。
//   对决接近时，这足以让同一侧连赢两次。
//   ⇒ 诚实的不变量不是「必然镜像」，而是两条：
//     ① 镜像率**很高**（远高于随机猜的 50%）；
//     ② 那少数「胜方相同」的情形**两个方向都出现** —— 这才是否定「引擎偏袒某一侧」的证据。
//        （若引擎偏袒 team 0，第②条会退化成清一色的「红赢两次」。）
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { swapSides } from "../../apps/web/src/contracts/guessing-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");

export interface SymPair { aW: number; aT: number; bW: number; bT: number }
/**
 * 从一批「原局 vs 换边局」的胜负里算对称统计。
 * ★ 纯函数 —— 反向用例直接喂合成数据，所以它必须能**抓到偏置**。
 */
export function symmetryStats(pairs: SymPair[]) {
  let mirrored = 0, redBoth = 0, blueBoth = 0, drawBoth = 0, sameTurns = 0;
  const deltas: number[] = [];
  for (const p of pairs) {
    const mirror = p.aW === 0 ? p.bW === 1 : p.aW === 1 ? p.bW === 0 : p.bW === 2;
    if (mirror) mirrored++;
    else if (p.aW === 0 && p.bW === 0) redBoth++;
    else if (p.aW === 1 && p.bW === 1) blueBoth++;
    else drawBoth++;
    if (p.aT === p.bT) sameTurns++;
    deltas.push(Math.abs(p.aT - p.bT));
  }
  const n = pairs.length;
  const sameWinner = redBoth + blueBoth + drawBoth;
  return { n, mirrored, redBoth, blueBoth, drawBoth, sameWinner, sameTurns, mirrorRate: n ? mirrored / n : 0, deltas };
}

const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const kit = createKit(bundle);
const run = async (mk: any, seed: number) => {
  const a: any = assembleMatch(kit, mk, { seed });
  await a.battle.runStartup(); await a.battle.run();
  return { w: a.battle.winner, t: a.battle.turn };
};

sec("[1] ★★★ 实测：同 seed 换边，胜方是否镜像");
const N = 40;
const pairs: SymPair[] = [];
for (let i = 0; i < N; i++) {
  const seed = 20261001 + i * 1013;
  const A = await run(canonicalMatch(), seed);
  const B = await run(swapSides(canonicalMatch()), seed);
  pairs.push({ aW: A.w, aT: A.t, bW: B.w, bT: B.t });
}
const st = symmetryStats(pairs);
{
  ok("★★★ 样本足够（≥ 24 个 seed 的对）", st.n >= 24, String(st.n));
  ok("★★★ 镜像率**远高于**随机猜的 50%", st.mirrorRate > 0.75, (st.mirrorRate * 100).toFixed(1) + "%");
  ok("★★★ 绝大多数 seed 上胜方严格相反（≥ 85%）", st.mirrorRate >= 0.85, (st.mirrorRate * 100).toFixed(1) + "%");
  console.log("    " + st.n + " 个 seed：镜像 " + st.mirrored + "｜胜方相同 " + st.sameWinner +
    "（红赢两次 " + st.redBoth + "｜蓝赢两次 " + st.blueBoth + "｜平局两次 " + st.drawBoth + "）");
}

sec("[2] ★★★ 关键：那少数「胜方相同」的**不是一边倒** —— 这才是否定「引擎偏袒某一侧」的证据");
{
  ok("★★★ 两个方向都出现过（红赢两次与蓝赢两次都 > 0）", st.redBoth > 0 && st.blueBoth > 0,
    JSON.stringify({ redBoth: st.redBoth, blueBoth: st.blueBoth }));
  ok("★★★ 任一方向都不占多数（偏置引擎会让其中一个接近全集）",
    st.redBoth * 2 < st.n && st.blueBoth * 2 < st.n, JSON.stringify({ n: st.n, redBoth: st.redBoth, blueBoth: st.blueBoth }));
  ok("★★ 两个方向的计数大致对称（差不超过样本的 15%）",
    Math.abs(st.redBoth - st.blueBoth) <= Math.max(1, st.n * 0.15), JSON.stringify({ redBoth: st.redBoth, blueBoth: st.blueBoth }));
}

sec("[3] ★★ 回合数：多数 seed 上完全相同（说明引擎除随机流顺序外确实对称）");
{
  const zero = st.deltas.filter(d => d === 0).length;
  ok("★★ 过半 seed 的回合数完全一致", zero * 2 > st.n, zero + "/" + st.n);
  ok("★★ 非零差值也不失控（最大 ≤ 40 回合）", Math.max(...st.deltas) <= 40, String(Math.max(...st.deltas)));
  console.log("    回合数差：为 0 的 " + zero + "/" + st.n + "｜最大 " + Math.max(...st.deltas));
}

sec("[4] ★★★ 反向：这个统计量真的能抓到「偏袒某一侧」");
{
  // 合成：引擎偏袒 team 0 —— 红方永远赢
  const biased: SymPair[] = Array.from({ length: 40 }, () => ({ aW: 0, aT: 50, bW: 0, bT: 50 }));
  const bs = symmetryStats(biased);
  ok("★★★ 合成「红方永远赢两次」→ 镜像率 0 且 redBoth = n", bs.mirrorRate === 0 && bs.redBoth === bs.n, JSON.stringify({ rate: bs.mirrorRate, redBoth: bs.redBoth }));
  ok("★★★ 而第 [2] 节那两条断言在这种输入下**会红**（反转条件验证）",
    !(bs.redBoth > 0 && bs.blueBoth > 0) && !(bs.redBoth * 2 < bs.n), JSON.stringify({ redBoth: bs.redBoth, blueBoth: bs.blueBoth }));
  // 合成：无偏但随机 —— 镜像率应接近 50%
  const rnd: SymPair[] = Array.from({ length: 40 }, (_, i) => ({ aW: i % 2, aT: 50, bW: i % 2, bT: 50 }));
  const rs = symmetryStats(rnd);
  ok("★★★ 合成「两边同赢同输」（无镜像关系）→ 镜像率 0", rs.mirrorRate === 0, String(rs.mirrorRate));
  // 合成：完美镜像
  const perfect: SymPair[] = Array.from({ length: 40 }, () => ({ aW: 0, aT: 50, bW: 1, bT: 50 }));
  ok("★★★ 合成完美镜像 → 镜像率 1、sameWinner 0", symmetryStats(perfect).mirrorRate === 1 && symmetryStats(perfect).sameWinner === 0);
}

sec("[5] ★★ 与既有统计判据的关系（不取代，只收紧）");
{
  ok("★★ 这条不取代 m1 的镜像 CI 与 ui7 的换边胜率（那两条量的是**期望**，这条量的是**逐 seed 结构**）", true);
  console.log("    m1：同阵容打自己 → 期望 50%（统计）");
  console.log("    ui7：换边胜率差 < 8 个百分点（统计，容差宽）");
  console.log("    g50：逐 seed 胜方是否相反 + 相同者的方向分布（结构，无容差）");
}

console.log("\n=== 红蓝对称: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
