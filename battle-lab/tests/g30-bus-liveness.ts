// tests/g30-bus-liveness.ts — ★ 事件总线的**活性**：产品路径上它到底有没有订阅者
//
// 由来：第 36 轮做完 ResolutionKey（a1-4 §22）后想证明"排序层没有改变行为"，
// 于是写了个探针去对比新旧排序 —— 结果探针报告"多候选 dispatch 次数: 0"，
// 也就是**一条都没比到**：一个平凡通过的等价性证明。
//
// 追下去发现的是一个比排序更大的事实：典型对局里事件总线的订阅者是 **0**。
// 562 次 dispatch、641 个事件节点，全部 handlerCount === 0。
// 原因不是总线坏了，而是 fixture 的 10 个单位 **soulId 全是 null**（§15.8 记过这件事，
// 当时只写了"御魂在实战中跑不到"，没量化到「订阅者 0」）。
//
// 所以这个测试做两件事：
//   ① 把"典型对局总线空转"变成**实测数字**，而不是一句没人看的说明；
//   ② 给一个**正向对照**（装上御魂）—— 否则那个 0 分不清是"没人订阅"还是"总线坏了"。
//      这是本项目的老规矩：只报 0 而不给反例，等于什么都没说。
import fs from "node:fs";
import path from "node:path";
import { EventBus } from "../kernel/events.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

/** 跑一局，同时统计：订阅者、dispatch 次数、多候选次数、真正投递过的节点数 */
async function measure(match: any, seed = 20261001) {
  let calls = 0, multi = 0, maxCand = 0;
  const orig = (EventBus.prototype as any).dispatch;
  (EventBus.prototype as any).dispatch = async function (code: string, ctx: any, selfId: number, teamId: number, teamOf: any) {
    calls++;
    const n = this.collect(code, selfId, teamId, teamOf).length;
    if (n > 1) multi++;
    if (n > maxCand) maxCand = n;
    return orig.call(this, code, ctx, selfId, teamId, teamOf);
  };
  try {
    const a: any = assembleMatch(createKit(bundle), match, { seed, traceLevel: "NONE" });
    const subs = (a.battle.bus.handlers as any[]).length;
    await a.battle.runStartup();
    const r = await a.battle.run();
    const nodes = a.battle.bus.chain as any[];
    return {
      subs, calls, multi, maxCand,
      nodes: nodes.length,
      delivered: nodes.filter(n => n.handlerCount > 0).length,
      winner: r.winner, turns: r.turns, reason: r.reason,
      soulReport: a.soulReport,
      soulIds: match.red.units.map((u: any) => u.soulId),
    };
  } finally { (EventBus.prototype as any).dispatch = orig; }
}

const withSoul = (id: number) => {
  const m: any = JSON.parse(JSON.stringify(canonicalMatch()));
  for (const side of ["red", "blue"]) for (const u of m[side].units) u.soulId = id;
  return m;
};

const plain = await measure(canonicalMatch());
// 正向对照用一件「只登记、无效果」的御魂（id 5 魍魉之匣）。原来的 id 0 雪幽魂 在 custom-effects.ts 里已实现，
// 会真正改变对局（加事件、改胜负），不再适合当「只投递不改状态」的对照。
const souled = await measure(withSoul(5));

sec("[1] ★★ 产品路径（典型对局）的事件总线是空转的 —— 实测");
{
  console.log("    订阅者 " + plain.subs + "｜dispatch " + plain.calls + "｜多候选 " + plain.multi +
    "｜节点 " + plain.nodes + "｜真正投递过的节点 " + plain.delivered);
  ok("★ 10 个单位的 soulId 全是 null（空转的**原因**，不是现象）", plain.soulIds.every((s: any) => s === null), JSON.stringify(plain.soulIds));
  ok("★★ 订阅者 0", plain.subs === 0, String(plain.subs));
  ok("★★ 总线确实被调用了（不是「没跑」）", plain.calls > 100, String(plain.calls));
  ok("★★ 没有任何一次 dispatch 有候选", plain.multi === 0 && plain.maxCand === 0, JSON.stringify([plain.multi, plain.maxCand]));
  ok("★★ 641 个事件节点里，真正投递过的 = 0", plain.nodes > 100 && plain.delivered === 0, JSON.stringify([plain.nodes, plain.delivered]));
  ok("★ soulReport 为 null（没有御魂可装）", plain.soulReport === null, JSON.stringify(plain.soulReport));
}

sec("[2] ★★ 正向对照：有订阅者时总线真的投递（否则上面的 0 无法解释）");
{
  console.log("    订阅者 " + souled.subs + "｜dispatch " + souled.calls + "｜多候选 " + souled.multi +
    "｜节点 " + souled.nodes + "｜真正投递过的节点 " + souled.delivered + "｜单次最多候选 " + souled.maxCand);
  ok("★★ 装上御魂后订阅者 > 0", souled.subs > 0, String(souled.subs));
  // ★★ 第 42 轮更正：这一条原写「真的有多候选 dispatch（排序层这时才参与）」并被 61 次满足 ——
  //   那 61 次是**注册重复**的产物（同一件御魂穿 N 个单位会注册 N² 个 handler，见 g31 [4]）。
  //   修好之后单次最多候选 = 1：SELF 范围下同一个事件码只有一个收件人。
  ok("★★ 单次最多候选 = 1（SELF 范围：同一事件码只有一个收件人）", souled.maxCand === 1, String(souled.maxCand));
  // ★ 第 40 轮的更正：这条断言**只**证明"总线会把事件交给订阅者"，**不**证明效果发生 ——
  //   雪幽魂（本测试用的 id=0）注册的是一批**空 handler**：会被调用、会被计数，但不改任何状态。
  //   "御魂到底有没有效果"由 tests/g31-soul-liveness.ts 用可观测状态逐件实测（70 件里只有 3 件有效果）。
  ok("★★ 真有节点把事件投递给了 handler（只证明投递，不证明效果 —— 见 g31）", souled.delivered > 0, String(souled.delivered));
  ok("★ soulReport 非 null", souled.soulReport !== null);
  ok("★ 战斗仍然正常结束", souled.turns > 0 && souled.reason !== "", JSON.stringify([souled.turns, souled.reason]));
}

sec("[3] ★★ 由 [1][2] 得出的结论：§22 排序层在典型对局里**不可观测**");
{
  ok("★★ 典型对局：候选恒为空 → 排序 0 元素列表是恒等操作 → 排序规则不可能影响它",
    plain.maxCand === 0, String(plain.maxCand));
  // ★★★ 这是本轮修正的**主要结论**：原来的说法（有御魂时排序层真的决定顺序）是错的。
  //   真实对局里——不管有没有御魂——单次 dispatch 的候选数最多是 1，
  //   所以 §22 的六级排序链在生产路径上**从不被触发**；它目前只在 g29 这类直接压比较链的测试里被验证。
  ok("★★★ 修正：有御魂时最多候选仍是 1 —— §22 排序层在真实对局里不被触发", souled.maxCand === 1, String(souled.maxCand));
  ok("★ 御魂**不改变** dispatch 次数（它只增加订阅者，不增加事件）",
    plain.calls === souled.calls, plain.calls + " vs " + souled.calls);
}

sec("[4] 诚实边界：这一轮**不能**从这组对照推出的东西");
{
  ok("★ 装御魂前后胜负相同 —— 只能说「典型对局的结果对这件御魂不敏感」，**不能**说御魂无效果",
    plain.winner === souled.winner && plain.turns === souled.turns,
    JSON.stringify([plain.winner, plain.turns, souled.winner, souled.turns]));
  console.log("    未验证：御魂效果是否生效（soulReport.unsupported 非 0 时，那部分本来就不会触发）；");
  console.log("    未验证：其它 69 件御魂各自的影响 —— 这里只测了 1 件，作为总线的正向对照。");
}

console.log("\n=== 事件总线活性验收: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
