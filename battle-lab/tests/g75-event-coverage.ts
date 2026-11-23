// tests/g75-event-coverage.ts — ★★★ 第 119 轮：事件码覆盖率的**四态账**（唯一口径 + 证据行）
//
// 由来（实测，不是推理）：同一个问题在库里有两把尺子 ——
//   · tools/_probe-dispatch.ts 与 tests/g42 的旧 dispatched()：
//       s.includes("dispatch(EV." + code) || s.includes("EV." + code + ",")
//   · 事实：`ON_SKILL: EV.SKILL_END,`（御魂时机映射）命中了后半段 ⇒ SKILL_END 被算成「有派发点」，
//     而全库**没有一处**派发它 —— 一个被自己的尺子藏住的静默死处理器（与第 90 轮 CRI 同类）。
//
// 这一轮把口径统一到 tools/event-audit.ts，并把二值问题拆成四态账：
//   BUS           走事件总线 —— 被动 / 御魂 / 触发类机制今天就能挂
//   TRACE_ONLY    机制在跑，但只有 trace（Theater 看得见，触发类机制挂不上）
//   MENTION_ONLY  只是被别处提到（例如 mock 的时间线白名单）
//   DECLARED_ONLY 只有声明
// 声明表写在下面，**两个方向**都断言：漏一个红、多一个也红。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { coverageSummary, dispatchCallSites, maskComments } from "../tools/event-audit.ts";
import { DISPATCHED_EV_CODES } from "../compile/passive-runtime.ts";
import { EV } from "../kernel/types.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

const S: any = coverageSummary(ROOT);
const codesOf = (v: string): string[] => S.codes.filter((c: any) => c.verdict === v).map((c: any) => c.code).sort();
const sorted = (a: Iterable<string>) => [...a].sort();
const eq = (a: Iterable<string>, b: Iterable<string>) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** ★ 声明：四态账。谁接线 / 谁删码 / 谁新增事件码，都必须来改这里，否则红。 */
const DECLARED: Record<string, string[]> = {
  "BUS": [
    "SOUL_START",
    "PASSIVE_START",
    "SENKI",
    "BATTLE_START",
    "TURN_START",
    "TURN_END",
    "ACTION_END",
    "SKILL_SELECT",
    "SKILL_START",
    "SKILL_END",
    "ORB_GAUGE_ADVANCE",
    "ORB_GAIN",
    "ORB_OVERFLOW",
    "ORB_COST",
    "RESIST",
    "IMMUNE",
    "BEFORE_DAMAGE",
    "DAMAGE",
    "AFTER_DAMAGE",
    "HP_LOSS",
    "HEAL",
    "RECOVER",
    "SHIELD_CREATE",
    "SHIELD_DAMAGE",
    "SHIELD_BREAK",
    "STATUS_ADD",
    "STATUS_REMOVE",
    "STATUS_EXPIRE",
    "STATUS_MISS",
    "TIMELINE_MISS",
    "DEATH_PREVENTION",
    "LETHAL",
    "DEATH",
    "KILLED",
    "REVIVE",
    "TRANSFORM",
    "VICTORY_CHECK",
    "BATTLE_END"
  ],
  "TRACE_ONLY": [],
  "MENTION_ONLY": [
    "TARGET_SELECT",
    "HIT"
  ],
  "DECLARED_ONLY": [
    "BATTLE_CREATE",
    "PRE_BATTLE",
    "TIMELINE_ADVANCE",
    "ACTION_START",
    "BEFORE_HIT"
  ]
};
sec("[1] 四态账：声明与实测逐条对齐（两个方向）");
{
  for (const v of ["BUS", "TRACE_ONLY", "MENTION_ONLY", "DECLARED_ONLY"]) {
    const measured = codesOf(v);
    const missing = DECLARED[v].filter(c => !measured.includes(c));
    const extra = measured.filter(c => !DECLARED[v].includes(c));
    ok("★★★ " + v + " 名单一致（" + DECLARED[v].length + " 个）", missing.length === 0 && extra.length === 0,
      "声明漏了 " + JSON.stringify(missing) + "｜实测多了 " + JSON.stringify(extra));
  }
  const all = Object.values(DECLARED).flat();
  ok("★★★ 四态之和 == EV 表条数（不漏不重）", eq(all, Object.keys(EV)) && new Set(all).size === all.length,
    all.length + " vs EV " + Object.keys(EV).length + "｜重复 " + (all.length - new Set(all).size));
  ok("★★★ 扫描面非空（否则「0 个未派发」只说明没扫到文件）", S.files > 50 && S.total === 45, S.files + " 个文件 / " + S.total + " 个码");
}

sec("[2] 每条结论都带证据行（人能按 file:line 复核）");
{
  const noEvidence = S.codes.filter((c: any) => c.verdict !== "DECLARED_ONLY" && (c.bus.length + c.trace.length + c.mention.length) === 0).map((c: any) => c.code);
  ok("★★★ 非 DECLARED_ONLY 的码都至少有一条证据", noEvidence.length === 0, JSON.stringify(noEvidence));
  const bad = S.codes.flatMap((c: any) => [...c.bus, ...c.trace]).filter((x: any) => !(x.line > 0) || String(x.snippet).length < 5);
  ok("★★ 证据行都有行号与片段", bad.length === 0, JSON.stringify(bad.slice(0, 3)));
  const heal = S.codes.find((c: any) => c.code === "HEAL");
  ok("★★ 抽一条复核：HEAL 的 trace 证据落在 kernel/damage.ts（正是治愈那一刻）",
    heal.trace.some((x: any) => x.file.endsWith("kernel/damage.ts")), JSON.stringify(heal.trace.slice(0, 2)));
  const se = S.codes.find((c: any) => c.code === "SKILL_END");
  ok("★★★ SKILL_END 的派发证据在 kernel/battle.ts（第 119 轮补的那一处）",
    se.bus.some((x: any) => x.file.endsWith("kernel/battle.ts")), JSON.stringify(se.bus));
}

sec("[3] 浏览器侧的声明表不许说谎（它是 deadCode 判据的输入）");
{
  const bus = DECLARED.BUS;
  ok("★★★ BUS 的 " + bus.length + " 个码**全部在** DISPATCHED_EV_CODES 里", bus.every(c => DISPATCHED_EV_CODES.has(c)),
    JSON.stringify(bus.filter(c => !DISPATCHED_EV_CODES.has(c))));
  ok("★★★ 反向：声明表里没有「实测不在 BUS」的码（第 119 轮的 SKILL_END 正是这一类）",
    eq([...DISPATCHED_EV_CODES], bus), JSON.stringify([...DISPATCHED_EV_CODES].filter(c => !bus.includes(c))));
  /**
   * ★★★ 第 120 轮：这里原来是「TRACE_ONLY 的码都不在声明表里」—— TRACE_ONLY 被清空之后，
   *   那条断言会**恒真**（空集），所以换成不可能空转的三条：TRACE_ONLY 必须为空、
   *   它的 8 个历史成员现在**都在 BUS 里**、而且都进了声明表。
   */
  ok("★★★ TRACE_ONLY 已清空（第 119 轮还有 8 个）", DECLARED.TRACE_ONLY.length === 0, JSON.stringify(DECLARED.TRACE_ONLY));
  const wired8 = ["ORB_GAIN", "HP_LOSS", "HEAL", "RECOVER", "STATUS_REMOVE", "STATUS_EXPIRE", "STATUS_MISS", "TIMELINE_MISS"];
  ok("★★★ 那 8 个历史 TRACE_ONLY 码现在**都在 BUS 里**（接线没把谁弄丢）",
    wired8.every(c => bus.includes(c)), JSON.stringify(wired8.filter(c => !bus.includes(c))));
  ok("★★ 反向：这 8 个码**确实在声明表里**（deadCode 判据随之变活）",
    wired8.every(c => DISPATCHED_EV_CODES.has(c)), JSON.stringify(wired8.filter(c => !DISPATCHED_EV_CODES.has(c))));
}

sec("[4] SKILL_END 真的会被派发：接一个探针，数它被调用几次");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const battle = a.battle;
  let fires = 0;
  battle.bus.register({ id: "PROBE:SKILL_END", ownerId: 0, code: EV.SKILL_END, range: "ALL", priority: 0, passive: false, fn: () => { fires++; } });
  const r = await battle.run();
  const executed = battle.turnLog.filter((t: any) => t.skill).length;
  const starts = battle.bus.chain.filter((n: any) => n.code === "SKILL_START").length;
  const ends = battle.bus.chain.filter((n: any) => n.code === "SKILL_END").length;
  ok("★★★ 探针在 SKILL_END 上真的被调用了（" + fires + " 次）", fires > 0, "winner=" + r.winner + " turns=" + r.turns);
  ok("★★★ 触发次数 == 真的释放了技能的次数（turnLog 里带 skill 的条目）", fires === executed, fires + " vs " + executed);
  ok("★★ 事件链里 SKILL_END 节点数 == 探针触发次数（派发与订阅是同一件事的两面）", ends === fires, ends + " vs " + fires);
  ok("★★ 它与 SKILL_START **不是一对**：后者只给攻击技能派发 ⇒ 次数 ≤ SKILL_END", starts <= ends, "SKILL_START " + starts + " vs SKILL_END " + ends);
}

sec("[5] 一把尺子：不许有人把第二把装回去");
{
  /**
   * ★ 判据只看**代码**：注释里可以引用旧规则（那样才讲得清它错在哪），
   *   所以先遮盖注释再匹配 —— 第一次写这条断言时它被自己的注释绊红了，正是这个原因。
   */
  const toolSrc = maskComments(fs.readFileSync(path.join(ROOT, "battle-lab", "tools", "event-audit.ts"), "utf8"));
  const g42Src = maskComments(fs.readFileSync(path.join(ROOT, "battle-lab", "tests", "g42-trigger-registry.ts"), "utf8"));
  const loose = /includes\("EV\."\s*\+/;
  ok("★★★ g42 不再自带尺子（import 了 event-audit，代码里没有旧的宽松判据）",
    /tools\/event-audit\.ts/.test(g42Src) && !loose.test(g42Src));
  ok("★★★ 工具里也没有旧的宽松判据（只看代码）", !loose.test(toolSrc));
  ok("★★★ 反向：合成一句御魂映射，旧判据命中而新口径不认（证明尺子真的换了）", (() => {
    const s = "const M = { ON_SKILL: EV.SKILL_END, };";
    return /EV\.SKILL_END,/.test(s) && !/(?:dispatch|emit|publish|fire|queueEvent)\s*\([\s\S]{0,48}?EV\.SKILL_END/.test(s);
  })());
  ok("★★ 旧的 _probe-dispatch.ts 已删除（第二把尺子的来源）", !fs.existsSync(path.join(ROOT, "battle-lab", "tools", "_probe-dispatch.ts")));
}

sec("[6] 完备性：按字面量扫描不会漏（派发与入队的第一个实参都是 EV.*）");
{
  const cs = dispatchCallSites(ROOT);
  ok("★★★ 生产代码 " + cs.total + " 处派发/入队点：变量码 " + cs.variable.length + " 个（有变量码就说明按字面量扫描会漏）",
    cs.variable.length === 0, JSON.stringify(cs.variable.slice(0, 3)));
  ok("★★★ 裸字符串 " + cs.bareString.length + " 个（打错字会静默不派发 —— 第 91 轮的 SOUL_START 就是这么漏的）",
    cs.bareString.length === 0, JSON.stringify(cs.bareString.slice(0, 3)));
  ok("★★ 三元字面量 " + cs.ternary.length + " 处（形如 recover ? EV.RECOVER : EV.HEAL：两个分支都是码，不是变量）",
    cs.ternary.length + cs.literal + cs.drainSites === cs.total, JSON.stringify(cs.ternary));
  ok("★★★ 变量码的**唯一**允许处是队列自己的 drain（battle.ts 的 drainEvents 把入队的 code 投出去）",
    cs.drainSites === 1, String(cs.drainSites));
  ok("★★ 字面量占绝对多数（" + cs.literal + "/" + cs.total + "）", cs.literal > 30, String(cs.literal));
  ok("★★ 反向：合成的变量码派发会被同一条判据抓到", (() => {
    const src = maskComments("await bus.dispatch(code, {}, 0, 0, f);");
    const m = [...src.matchAll(/(?:dispatch|emit|publish|fire|queueEvent)\s*\(\s*([^,)]{0,60})/g)][0];
    return !!m && !/^EV\.[A-Z_]+$/.test(m[1].trim());
  })());
}


console.log("\n=== 事件码覆盖四态账: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;