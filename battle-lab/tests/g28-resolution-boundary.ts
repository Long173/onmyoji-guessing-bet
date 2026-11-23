// tests/g28-resolution-boundary.ts — ★ a1-4 §30/§31：ResolutionScope 与 ResolutionBoundary
//
// 规格原文 §30「Victory Check 不应该到回合结束才检查」：
//   「每个可能改变生存状态的 resolution 后：VICTORY_CHECK。
//     但是不要过早结束。例如双方同时死亡，必须允许当前 Atomic Resolution 完成。
//     所以引入 ResolutionBoundary。只有边界处：commit deaths / check victory」
//
// 规格原文 §31「Atomic Resolution」：
//   interface ResolutionScope { id; type: "SKILL" | "HIT" | "EFFECT" | "TRIGGER"; }
//   「事件知道自己在哪个 Scope。」
//
// 改动前：checkVictory() 只在**回合结束**被调用两次，而且它是纯谓词 ——
// 既不派发任何事件，也从不清除上一次的判定。于是 Theater 看不到"这一回合为什么结束"，
// 而"打死 → 复活 → 继续打"会被上一条结论钉死。
//
// 与规格的**有意差异**（同时写在 kernel/battle.ts 的 resolveBoundary 上，不藏着）：
// 死亡状态仍然**即时落账**，没有推迟到边界才 commit deaths。理由是影响面 ——
// 推迟落地会让所有"结算中途读 alive"的代码改变行为。而 §30 真正要保证的观测量
// （不得提前宣布胜方）由"只在边界判定"直接保证，下面 [4] 把它钉死。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const mk = (traceLevel = "FULL") => assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, traceLevel }).battle as any;
/** VICTORY_CHECK 留痕（trace 通道） */
const vc = (b: any) => (b.trace as any[]).filter(e => e.t === "VICTORY_CHECK");
/** 直接写死亡标记（与 g14 同法）：本测试关心的是"何时判定"，不是"怎么死" */
const kill = (e: any) => { e.alive = false; e.dead = true; e.hp = 0; };

sec("[1] ★ §31：事件知道自己在哪个 Scope，而且 scope 有层次");
{
  const b = mk();
  await b.runStartup();
  const seen: string[] = [];
  const origW = b.withinResolution.bind(b);
  b.withinResolution = async (scope: any, fn: any) => { seen.push([...b.resolutionStack.map((s: any) => s.type), scope.type].join(">")); return origW(scope, fn); };
  const bounds: string[] = [];
  const origB = b.resolveBoundary.bind(b);
  b.resolveBoundary = async (scope: any) => { bounds.push(scope?.type ?? "TURN_END"); return origB(scope); };
  await b.runPartial(8);

  const scoped = b.bus.chain.filter((n: any) => n.scope);
  ok("★ 事件节点带上了 scope（不再全是 null）", scoped.length > 0, String(scoped.length));
  const types = new Set(scoped.map((n: any) => n.scope.type));
  // ★ 实测（第 34 轮，3 局共 2577 个节点）：技能级事件数为 0 —— 伤害/死亡类事件全部 @ HIT，
  //   而 TURN_START / SKILL_SELECT / ACTION_END 属于回合层、不在任何 resolution 里。
  //   SKILL scope 的职责是**定位边界**（见 [2]：边界只在 SKILL / TURN_END 上触发），
  //   不是给事件盖章。若以后给它加一个 bus.within 节点，这条注释会提醒你回来改断言。
  const byCode = new Map<string, Set<string>>();
  for (const n of scoped) { const s = byCode.get(n.code) ?? new Set<string>(); s.add(n.scope.type); byCode.set(n.code, s); }
  ok("★★ 伤害三段（BEFORE_DAMAGE / DAMAGE / AFTER_DAMAGE）全都知道自己 @ HIT",
    ["BEFORE_DAMAGE", "DAMAGE", "AFTER_DAMAGE"].every(c => byCode.get(c)?.has("HIT")), JSON.stringify([...byCode].slice(0, 6)));
  ok("★★ 死亡链（LETHAL / DEATH / KILLED）也带 scope —— §31 问的「死亡什么时候确认」现在可回答",
    ["LETHAL", "DEATH", "KILLED"].every(c => byCode.get(c)?.has("HIT")), JSON.stringify([...byCode.keys()].slice(0, 10)));
  ok("★ 回合层事件不属于任何 resolution（scope 为 null）",
    b.bus.chain.filter((n: any) => ["TURN_START", "TURN_END", "ACTION_END"].includes(n.code)).every((n: any) => n.scope === null));
  ok("★ HIT scope 真的进入了事件链", types.has("HIT"), JSON.stringify([...types]));
  ok("★★ HIT 是嵌在 SKILL 之内执行的（Atomic Resolution 有层次，不是平铺）",
    seen.includes("SKILL>HIT"), JSON.stringify([...new Set(seen)]));
  const hits = scoped.filter((n: any) => n.scope.type === "HIT");
  ok("★ scope.id 可读且稳定（SKILL:技能名 / HIT:技能名#段号）",
    hits.length > 0 && hits.every((n: any) => /^HIT:.+#\d+$/.test(n.scope.id)),
    JSON.stringify(hits.slice(0, 3).map((n: any) => n.scope.id)));
  ok("★ scope 是纯数据，能 JSON 往返（所以进得了 Replay 文件）",
    JSON.parse(JSON.stringify(scoped.slice(0, 5))).every((n: any) => n.scope && typeof n.scope.type === "string"));

  sec("  [2] 边界只在**最外层**触发");
  ok("★★ 边界里没有 HIT —— 多段技能只在整段结束后判一次，不是每段都判",
    !bounds.includes("HIT"), JSON.stringify([...new Set(bounds)]));
  ok("★ 边界类型只有 SKILL 与 TURN_END", bounds.every(x => x === "SKILL" || x === "TURN_END"), JSON.stringify([...new Set(bounds)]));
  ok("★★ 每回合至少一次边界判定（不再只在回合结束）", b.victoryChecks >= b.turn, "checks=" + b.victoryChecks + " turns=" + b.turn);
  ok("★ victoryChecks 与实际边界调用次数一致", b.victoryChecks === bounds.length, b.victoryChecks + " vs " + bounds.length);
}

sec("[3] ★★ 分出胜负时留下 VICTORY_CHECK（Theater 终于能看到「为什么结束」）");
{
  const b = mk();
  await b.runStartup();
  const r = await b.run();
  const evs = vc(b);
  ok("★★ 一场分出胜负的战斗恰好一条 VICTORY_CHECK", evs.length === 1, JSON.stringify(evs.map((e: any) => e.reason)));
  const e0: any = evs[0] ?? {};
  ok("★ won=true 且 winner 与最终结果一致", e0.won === true && e0.winner === b.winner, JSON.stringify([e0.won, e0.winner, b.winner]));
  ok("★ reason 与 endReason 一致", e0.reason === b.endReason, e0.reason + " vs " + b.endReason);
  ok("★ 带上 alive 计数，且确实有一方是 0", Array.isArray(e0.alive) && e0.alive.includes(0), JSON.stringify(e0.alive));
  ok("★ 带上边界类型与检查序号", typeof e0.boundary === "string" && e0.checked > 0, JSON.stringify([e0.boundary, e0.checked]));
  ok("★★ 事件链里也有这条节点（Theater 读的就是 ReplayFile.events）",
    b.bus.chain.filter((n: any) => n.code === "VICTORY_CHECK").length === 1);
  ok("★★ 检查次数远多于留痕次数：每次边界都**检查**，只在判定变化时**留痕**",
    b.victoryChecks > evs.length, b.victoryChecks + " checks vs " + evs.length + " events");
  ok("★ 战斗确实打满多个回合（否则上面都是平凡成立）", r.turns > 5, String(r.turns));
}

sec("[4] ★★★ §30 的核心：双方同时死亡必须判平局，且**不得提前宣布胜方**");
{
  const b = mk();
  await b.runStartup();
  const red = b.teams[0].members, blue = b.teams[1].members;
  for (const e of red.slice(1)) kill(e);
  for (const e of blue.slice(1)) kill(e);
  const before = vc(b).length;
  let midWinner: any = "unset", midReason = "unset", midEvents = -1;
  await b.withinResolution({ id: "TEST:double-ko", type: "EFFECT" }, async () => {
    kill(red[0]);
    // 第一人死亡之后、边界之前：此刻若判定，就会宣布蓝方胜 —— 规格明确禁止
    midWinner = b.winner; midReason = b.endReason; midEvents = vc(b).length - before;
    kill(blue[0]);
  });
  ok("★★★ 第一人死亡后**没有**立刻判定（边界未到，winner 仍为 null）", midWinner === null && midReason === "", "winner=" + midWinner + " reason=" + midReason);
  ok("★★★ 边界之前一条判定事件都没发", midEvents === 0, String(midEvents));
  ok("★★★ 边界处看到的是同归于尽 → DOUBLE_KO，而不是先死的那一方判负",
    b.endReason === "DOUBLE_KO" && b.winner === null, "winner=" + b.winner + " reason=" + b.endReason);
  const added = vc(b).slice(before);
  ok("★★ 整段 resolution 只产生一次判定", added.length === 1, JSON.stringify(added.map((e: any) => e.reason)));
  ok("★★ 那条判定看到的是 0 : 0", JSON.stringify(added[0]?.alive) === "[0,0]", JSON.stringify(added[0]?.alive));
  ok("★★ 全程从未出现过单边全灭的判定（没有提前宣布胜方）",
    vc(b).every((e: any) => e.reason !== "TEAM0_WIPED" && e.reason !== "TEAM1_WIPED"),
    JSON.stringify(vc(b).map((e: any) => e.reason)));
}

sec("[5] ★★ 打死 → 复活 → 继续打：判定必须能被推翻（checkVictory 是全函数）");
{
  const b = mk();
  await b.runStartup();
  const blue = b.teams[1].members;
  for (const e of blue.slice(1)) kill(e);
  await b.withinResolution({ id: "TEST:wipe", type: "EFFECT" }, async () => { kill(blue[0]); });
  ok("★ 全灭 → 判红方胜", b.winner === 0 && b.endReason === "TEAM1_WIPED", "winner=" + b.winner + " reason=" + b.endReason);
  const back = await b.revive(blue[0], 500);
  ok("★ 复活成功（边界判定不阻止复活）", back === true && blue[0].alive === true);
  await b.resolveBoundary();
  ok("★★ 复活后判定被**推翻**：winner 回到 null、endReason 清空（改全函数之前这里会被钉死在 0）",
    b.winner === null && b.endReason === "", "winner=" + b.winner + " reason=" + b.endReason);
  const evs = vc(b);
  ok("★★ 留痕两条：一条达成、一条被推翻，且写明推翻的是哪一条",
    evs.length === 2 && evs[0].won === true && evs[1].won === false && evs[1].overturned === true && evs[1].previousReason === "TEAM1_WIPED",
    JSON.stringify(evs.map((e: any) => [e.won, e.reason, e.previousReason])));
}

sec("[6] ★★ 三档观测粒度产出完全相同的胜负（判定不受观测影响）");
{
  const results: any[] = [];
  for (const lv of ["NONE", "SUMMARY", "FULL"]) {
    const b = mk(lv);
    await b.runStartup();
    const r = await b.run();
    results.push({ lv, winner: r.winner, turns: r.turns, reason: r.reason, checks: b.victoryChecks, trace: (b.trace as any[]).length });
  }
  const sig = new Set(results.map(r => JSON.stringify([r.winner, r.turns, r.reason])));
  ok("★★ 三档产出相同的 winner / turns / reason", sig.size === 1, JSON.stringify(results));
  const none = results.find(r => r.lv === "NONE")!;
  ok("★★ NONE 档 trace 一条不记（新加的 VICTORY_CHECK 留痕也必须守这条）", none.trace === 0, String(none.trace));
  ok("★ 但判定照常发生（观测档位不影响引擎记账）", none.checks > 0, String(none.checks));
}

sec("[7] ★★ G0 契约：新加的运行状态必须能进档");
{
  // 这条是**踩过之后补的**：victoryChecks 出现在 VICTORY_CHECK 的留痕里，
  // 但没有入档 —— 于是"续跑战斗"的那条留痕从 0 重新数，g0 的"逐条一致"当场失败。
  // 同型教训：凡是新增运行状态，必须同时想清楚它怎么进 state。
  const b = mk();
  await b.runStartup();
  await b.runPartial(6);
  const st: any = captureState(b);
  ok("★★ 存盘点落在边界之间（resolution 栈必须为空，否则续跑会在错误层级重开边界）",
    st.counts.resolutionDepth === 0, String(st.counts.resolutionDepth));
  ok("★★ victoryChecks 入档且与运行中一致（否则续跑留痕会从 0 重新数）",
    st.counts.victoryChecks === b.victoryChecks && st.counts.victoryChecks > 0,
    JSON.stringify([st.counts.victoryChecks, b.victoryChecks]));
  ok("★ 边界计数确实随回合增长（每回合至少一次）", st.counts.victoryChecks >= b.turn, JSON.stringify([st.counts.victoryChecks, b.turn]));
}

console.log("\n=== ResolutionBoundary 验收: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
