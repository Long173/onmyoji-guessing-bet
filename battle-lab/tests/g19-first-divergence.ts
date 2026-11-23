// tests/g19-first-divergence.ts — ★ G6 仪器验收：定位游戏/模拟的**第一处**分歧（目标 ⑧）
//
// G6 的难点从来不是"要不要对照"，而是"对照结果放在哪里、以什么为准"。
// 真实的游戏内观测要由人在游戏里做（那一半只能等），但**仪器本身今天就能被验证**：
// 用合成的观测序列去喂它，看它能不能精确指出第一处分歧、会不会漏报、会不会把
// "玩家没记的字段"误判成分歧、会不会把"模拟有而游戏不显示"的内部帧当成差异。
//
// 这一轮同时补上了让对照**成为可能**的前提：DAMAGE/HEAL/HP_LOSS 现在记 hpBefore/hpAfter。
// 血量是玩家在画面上唯一能逐事件核对的量；没有它，两边根本没法逐条比。
import fs from "node:fs";
import path from "node:path";
import { diffTimelines, projectObserved, sameEvent, buildAlias } from "../kernel/diff.ts";
import type { ObsFrame } from "../kernel/diff.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

sec("[1] 身份判定：什么算「同一件事」");
{
  const a: ObsFrame = { kind: "DAMAGE", actor: "雪女", target: "三尾狐", amount: 100 };
  ok("种类/施动者/目标一致 → 同一件事", sameEvent(a, { ...a, amount: 999 }));
  ok("种类不同 → 不是", !sameEvent(a, { ...a, kind: "HEAL" }));
  ok("目标不同 → 不是", !sameEvent(a, { ...a, target: "日和坊" }));
  ok("人工没写技能名时不因技能名判否", sameEvent(a, { ...a, skill: "暴风雪" }));
  ok("两边都写了技能名且不同 → 不是", !sameEvent({ ...a, skill: "A" }, { ...a, skill: "B" }));
}

sec("[2] 完全一致 → 不报分歧（仪器不能自己造分歧）");
{
  const t: ObsFrame[] = [
    { kind: "SKILL", actor: "雪女", skill: "暴风雪" },
    { kind: "DAMAGE", actor: "雪女", target: "三尾狐", amount: 1200, hpAfter: 4800 },
    { kind: "STATUS", actor: "雪女", target: "三尾狐", status: "冰冻" },
  ];
  const d = diffTimelines(t, t);
  ok("★ ok = true，first = null", d.ok && d.first === null, d.summary);
  ok("匹配条数 = 观测条数", d.matched === 3, String(d.matched));
}

sec("[3] 第一处分歧必须**精确**指出，且只有一处被当作 first");
{
  const exp: ObsFrame[] = [
    { kind: "SKILL", actor: "雪女" },
    { kind: "DAMAGE", actor: "雪女", target: "三尾狐", amount: 1200 },
    { kind: "DAMAGE", actor: "雪女", target: "日和坊", amount: 1300 },   // ← 这里开始不一样
    { kind: "STATUS", actor: "雪女", target: "日和坊", status: "冰冻" },
  ];
  const act: ObsFrame[] = [
    { kind: "SKILL", actor: "雪女" },
    { kind: "DAMAGE", actor: "雪女", target: "三尾狐", amount: 1200 },
    { kind: "DAMAGE", actor: "雪女", target: "日和坊", amount: 1300 },
    { kind: "STATUS", actor: "雪女", target: "日和坊", status: "眩晕" },
  ];
  const d = diffTimelines(exp, act);
  ok("报出分歧", !d.ok && !!d.first);
  ok("★ 指向第 4 条观测（索引 3），不是第 1 条", d.first?.index === 3, JSON.stringify(d.first));
  ok("原因是字段不一致，并指出是哪个字段", d.first?.reason === "FIELD" && d.first?.field === "status", JSON.stringify([d.first?.reason, d.first?.field]));
  ok("把两边的值都列出来（可复核）", d.first?.expectedValue === "冰冻" && d.first?.actualValue === "眩晕", JSON.stringify([d.first?.expectedValue, d.first?.actualValue]));
  ok("分歧点带上下文（前 3 条 / 后 2 条）", (d.first?.context.before.length ?? 0) === 3, JSON.stringify(d.first?.context.before.length));
}

sec("[4] 数值容差：游戏显示会四舍五入，不该被判成分歧");
{
  const e: ObsFrame[] = [{ kind: "DAMAGE", actor: "A", target: "B", amount: 1200, hpAfter: 4800 }];
  ok("差 0.4 → 不算分歧（默认容差 1）", diffTimelines(e, [{ ...e[0], amount: 1200.4, hpAfter: 4800.4 }]).ok);
  ok("差 5 → 算分歧", !diffTimelines(e, [{ ...e[0], amount: 1205 }]).ok);
  ok("可以显式收紧容差", !diffTimelines(e, [{ ...e[0], amount: 1200.4 }], { tolerance: 0.1 }).ok);
}

sec("[5] 人工没记的字段**不能**被判成分歧（这是最容易冤枉正确代码的地方）");
{
  const exp: ObsFrame[] = [{ kind: "DAMAGE", actor: "A", target: "B", amount: 1200 }];   // 人没记血量
  const act: ObsFrame[] = [{ kind: "DAMAGE", actor: "A", target: "B", amount: 1200, hpAfter: 4800, orbs: 5 }];
  ok("★ 观测侧没写的字段一律不比较", diffTimelines(exp, act).ok, diffTimelines(exp, act).summary);
  const exp2: ObsFrame[] = [{ kind: "DAMAGE", actor: "A", target: "B", hpAfter: 4800 }];  // 人只记了血量
  ok("只记血量的观测也只比血量", diffTimelines(exp2, [{ kind: "DAMAGE", actor: "A", target: "B", hpAfter: 4800, amount: 99999 }]).ok);
  ok("但记了血量的场合血量不对就要报", !diffTimelines(exp2, [{ kind: "DAMAGE", actor: "A", target: "B", hpAfter: 4000 }]).ok);
}

sec("[6] 漏报 / 多报");
{
  const exp: ObsFrame[] = [
    { kind: "DAMAGE", actor: "A", target: "B", amount: 100 },
    { kind: "DEATH", target: "B" },
  ];
  const act: ObsFrame[] = [{ kind: "DAMAGE", actor: "A", target: "B", amount: 100 }];
  const d = diffTimelines(exp, act);
  ok("★ 游戏里发生了、模拟里没有 → MISSING", d.first?.reason === "MISSING" && d.first?.expected?.kind === "DEATH", JSON.stringify(d.first));
  // ★ EXTRA 只在**观测窗口之内**成立：多出来的事件后面还有观测能对上，
  //   说明"人在看，且看到了后面的事，却没记这一件"。
  //   若多出来的事件落在最后一条观测之后，那只是"人看了一段就停了"，不算分歧（见 [7]）。
  const d2 = diffTimelines([
    { kind: "DAMAGE", actor: "A", target: "B", amount: 100 },
    { kind: "STATUS", actor: "A", target: "B", status: "冰冻" },
  ], [
    { kind: "DAMAGE", actor: "A", target: "B", amount: 100 },
    { kind: "DEATH", target: "B" },
    { kind: "STATUS", actor: "A", target: "B", status: "冰冻" },
  ]);
  ok("★ 窗口内：模拟里发生了、观测里没有 → EXTRA", d2.first?.reason === "EXTRA" && d2.first?.actual?.kind === "DEATH", JSON.stringify(d2.first));
}

sec("[7] 模拟侧的内部帧要**被跳过但不隐藏**");
{
  const exp: ObsFrame[] = [{ kind: "DAMAGE", actor: "A", target: "B", amount: 100 }];
  const act: ObsFrame[] = [
    { kind: "STATUS", actor: "A", target: "A", status: "内部触发" },   // 游戏画面看不到
    { kind: "DAMAGE", actor: "A", target: "B", amount: 100 },
  ];
  // ★ 语义澄清（第一版这里是错的）：模拟产生了「玩家应当看得见、观测里却没有」的事件，
  //   这是**真分歧** —— 要么模拟多做了，要么人漏记了，两种可能都要摆出来，不能替使用者选。
  const d = diffTimelines(exp, act);
  ok("★ 窗口内多出来的可见事件被报成 EXTRA（不静默跳过）", !d.ok && d.first?.reason === "EXTRA" && d.first?.actual?.status === "内部触发", JSON.stringify(d.first));
  ok("同时留下明细，供人工判断是模拟错了还是漏记了", d.skipped === 1 && d.skippedDetail[0]?.status === "内部触发", JSON.stringify(d.skippedDetail));
  const d2 = diffTimelines(exp, act, { lookahead: 0 });
  ok("把容差设为 0 时连位置都懒得挪 → 直接 MISSING", !d2.ok && d2.first?.reason === "MISSING", JSON.stringify(d2.first));
  // 观测窗口之外的模拟帧**不是**分歧：人只看了前几回合是完全正常的
  const partial = diffTimelines([{ kind: "DAMAGE", actor: "A", target: "B", amount: 100 }],
    [{ kind: "DAMAGE", actor: "A", target: "B", amount: 100 }, { kind: "DEATH", target: "B" }, { kind: "DEATH", target: "C" }]);
  ok("★★ 只观测了开头、后面还有一大段 → **不算分歧**（第一版会报 2 处分歧）", partial.ok, partial.summary);
  ok("但会如实说明观测范围只覆盖了一部分", partial.beyondObservation === 2 && /观测范围/.test(partial.summary), partial.summary);
}

sec("[8] 别名归一：人工写名字、模拟给 id");
{
  const alias = buildAlias({ 101: "三尾狐", 201: "座敷童子" });
  ok("id → 名字", alias(101) === "三尾狐" && alias(201) === "座敷童子", alias(101));
  ok("名字保持名字", alias("三尾狐") === "三尾狐");
  ok("未知值原样返回（不静默变成空）", alias(999) === "999");
  const exp: ObsFrame[] = [{ kind: "DAMAGE", actor: "三尾狐", target: "座敷童子", amount: 100 }];
  const act: ObsFrame[] = [{ kind: "DAMAGE", actor: 101, target: 201, amount: 100 }];
  ok("★ 用别名归一后，人工记录与模拟 trace 可以直接比对", diffTimelines(exp, act, { alias }).ok, diffTimelines(exp, act).summary);
  ok("不归一时会被判成分歧（说明归一确实在起作用）", !diffTimelines(exp, act).ok);
}

sec("[9] 真实 trace 的投影：只取玩家看得见的量");
{
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.runPartial(8);
  const trace = a.battle.trace as any[];
  const { frames, unobservable } = projectObserved(trace);
  ok("前置：这一局产生了可观测帧", frames.length > 10, String(frames.length));
  ok("投影里出现伤害/技能/状态等玩家可见类型", ["DAMAGE", "SKILL"].every(k => frames.some(f => f.kind === k)), JSON.stringify([...new Set(frames.map(f => f.kind))]));
  ok("★ 伤害帧带着 hpAfter（G6 对照的硬前提）", frames.filter(f => f.kind === "DAMAGE").every(f => typeof f.hpAfter === "number"), JSON.stringify(frames.find(f => f.kind === "DAMAGE")));
  console.log("    可观测帧 " + frames.length + "｜内部帧（游戏画面看不到） " + unobservable + "｜类型 " + JSON.stringify([...new Set(frames.map(f => f.kind))]));
  ok("内部帧被计数而不是被丢弃", unobservable > 0, String(unobservable));
}

sec("[10] ★ 端到端：同一份 trace 自己和自己比必须一致；改一个数字必须被第一处抓到");
{
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.runPartial(8);
  const byId: Record<number, string> = {};
  for (const t of a.battle.teams) for (const m of t.members) byId[m.id] = m.name;
  const alias = buildAlias(byId);
  const { frames } = projectObserved(a.battle.trace as any[]);
  const selfDiff = diffTimelines(frames, frames, { alias });
  ok("★ 自己和自己比 → 无分歧（仪器不会凭空造分歧）", selfDiff.ok, selfDiff.summary);

  // 造一份"游戏观测"：把第 4 条伤害的数字改掉，模拟侧保持不变
  const dmgIdx = frames.findIndex(f => f.kind === "DAMAGE");
  ok("前置：找得到一条伤害帧来改", dmgIdx >= 2, String(dmgIdx));
  const observed = frames.map((f, i) => (i === dmgIdx ? { ...f, amount: (f.amount ?? 0) + 500 } : f));
  const d = diffTimelines(observed, frames, { alias });
  ok("★ 精确抓到那一条", !d.ok && d.first?.index === dmgIdx, JSON.stringify([d.first?.index, dmgIdx]));
  ok("★ 报出「观测 200 vs 模拟 100」这类可复核的数字", d.first?.field === "amount" && d.first?.actualValue === frames[dmgIdx].amount, JSON.stringify([d.first?.field, d.first?.expectedValue, d.first?.actualValue]));
  console.log("    第一处分歧：" + d.summary);
}

console.log("\n=== G6 第一处分歧: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
