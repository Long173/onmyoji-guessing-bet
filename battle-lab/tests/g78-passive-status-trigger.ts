// tests/g78-passive-status-trigger.ts — ★★★ 第 123 轮：登记「被施加」这一族，并证明它真的会触发
//
// 由来：第 122 轮把 STATUS_ADD 接进了事件总线，但**没有任何一族触发时机**登记它 ——
//   于是「再次被施加[buff_X]时…」这类被动被算进 `skipped.noTrigger`（「没有触发时机」），
//   把「有时机但没登记」与「真的没有时机」说成同一件事（本登记册最该防的错）。
// 这一轮：登记 family「被施加」（test 正则，因为 [buff_N] 夹在名字与「时」之间），
//   并修掉目标侧过滤的一个静默失效（只认伤害事件的 `input.target`，其它事件形状全被 fail-closed 挡掉）。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { TRIGGER_FAMILIES } from "../kernel/triggers.ts";
import { StatusBook } from "../kernel/status.ts";
import { compileBuff, toStatusDef } from "../compile/buff-compiler.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const withUnit = (id: number, name: string) => { const m: any = JSON.parse(JSON.stringify(canonicalMatch())); m.red.units[0].shikigamiId = id; m.red.units[0].name = name; return m; };
const run = async (passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", match?: any, seed = 20261001) => {
  const a: any = assembleMatch(createKit(bundle), match ?? canonicalMatch(), { seed, passives });
  await a.battle.runStartup();
  return a.battle;
};

sec("[1] 登记事实：family「被施加」→ STATUS_ADD（TARGET 侧）");
{
  const fam = TRIGGER_FAMILIES.find((f: any) => f.family === "被施加");
  ok("★★★ 登记册里有「被施加」这一族", !!fam, JSON.stringify(TRIGGER_FAMILIES.map((f: any) => f.family).slice(-6)));
  ok("★★★ 它映射到 STATUS_ADD（第 122 轮才接上总线的事件码）", fam?.evCode === "STATUS_ADD", String(fam?.evCode));
  ok("★★★ 它是**目标侧**时机（被施加的是自己）", (fam as any)?.side === "TARGET", String((fam as any)?.side));
  ok("★★★ 用 test 正则而不是「名字+时」子串（[buff_N] 夹在中间，子串永远匹配不到）", !!fam?.test && fam.test.test("敌方被施加[tips_5671]时"), String(fam?.test));
  ok("★★ 计数 2 条（g42 会用 matchFamily 重新数一遍，对不上就红）", (fam as any)?.kbCount === 2, String((fam as any)?.kbCount));
}

sec("[2] 账目移动：那两条子句不再算「没有触发时机」");
{
  const off = await run("NOT_EXECUTED", withUnit(348, "浮世青行灯"));
  const on = await run("PARSED_CANDIDATES_ONLY", withUnit(348, "浮世青行灯"));
  const repOff = off.passiveReport, repOn = on.passiveReport;
  ok("★★★ 默认 OFF：一个都不注册（与历史逐位一致）", repOff.installed.length === 0 && repOff.mode === "OFF");
  ok("★★★ 打开后**装上了**浮世青行灯「茕灯焕夜」，家族正是「被施加」",
    repOn.installed.some((i: any) => i.skill === "茕灯焕夜" && i.family === "被施加" && i.event === "STATUS_ADD"),
    JSON.stringify(repOn.installed.map((i: any) => i.skill + "[" + i.family + "→" + i.event + "]")));
  console.log("    换阵容后的跳过：无时机 " + repOn.skipped.noTrigger + "｜有条件 " + repOn.skipped.hasCondition +
    "（条件 " + repOn.skipped.byCondition + " / 效果 " + repOn.skipped.byEffect + "）｜无派发 " + repOn.skipped.noDispatch);
  ok("★★★ 无派发（noDispatch）必须是 0 —— 那一族的事件码现在真的在派发", repOn.skipped.noDispatch === 0, String(repOn.skipped.noDispatch));
  const other = await run("PARSED_CANDIDATES_ONLY", withUnit(567, "申屠子夜"));
  ok("★★ 同族的另一条（申屠子夜「渊冰三尺」）**如实记为被条件/效果挡住**，不是静默消失",
    other.passiveReport.installed.every((i: any) => i.skill !== "渊冰三尺") &&
    (other.passiveReport.skipped.byCondition + other.passiveReport.skipped.byEffect) > 0,
    JSON.stringify(other.passiveReport.skipped));
}

sec("[3] 真的会触发：给本体上同一个状态两次 ⇒ 第二次触发「被施加」");
{
  const b = await run("PARSED_CANDIDATES_ONLY", withUnit(348, "浮世青行灯"));
  const me = b.teams[0].members[0];
  /** [buff_3481_1] 的运行时定义：StatusBook 只有控制类，别的要走 buff-compiler（character.ts 同款） */
  const kbBuffs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[];
  const cb = kbBuffs.map(b => compileBuff(b)).find((b: any) => String(b.id) === "3481_1" || String(b.id) === "3481");
  const def: any = StatusBook.get("3481_1") ?? (cb ? toStatusDef(cb as any) : null);
  ok("前置：KB 里的 [buff_3481_1] 在 StatusBook 里有定义", !!def, String(def));
  if (def) {
    const before = b.trace.filter((e: any) => e.t === "SKILL_CAST" && e.skill === "茕灯焕夜").length;
    me.addStatus(def as any, me.id, 1, 3);          // 第一次：满足「对于有[buff]的目标」这个前提
    await b.drainEvents();
    me.addStatus(def as any, me.id, 1, 3);          // 第二次：「再次被施加」
    await b.drainEvents();
    const after = b.trace.filter((e: any) => e.t === "SKILL_CAST" && e.skill === "茕灯焕夜").length;
    ok("★★★ 第二次施加触发了「茕灯焕夜」（trace 里出现它的 SKILL_CAST）", after > before, before + " → " + after);
  }
  /** 反向：把状态施加到**别人**身上，这条被动不该触发（目标侧过滤必须真的在过滤） */
  const b2 = await run("PARSED_CANDIDATES_ONLY", withUnit(348, "浮世青行灯"));
  const me2 = b2.teams[0].members[0], other2 = b2.teams[0].members[1];
  if (def && other2) {
    const before2 = b2.trace.filter((e: any) => e.t === "SKILL_CAST" && e.skill === "茕灯焕夜").length;
    other2.addStatus(def as any, other2.id, 1, 3);
    other2.addStatus(def as any, other2.id, 1, 3);
    await b2.drainEvents();
    const after2 = b2.trace.filter((e: any) => e.t === "SKILL_CAST" && e.skill === "茕灯焕夜").length;
    ok("★★★ 反向：施加在**队友**身上时，这条被动不触发（目标侧过滤真的在过滤）", after2 === before2, before2 + " → " + after2);
  }
}

sec("[4] 默认档位不变：OFF 时指纹仍是基准值");
{
  const off = await run("NOT_EXECUTED");
  await off.run();
  const h = stateHash(captureState(off));
  ok("★★★ 默认（NOT_EXECUTED）跑完整场后指纹仍是 2d7c7507e18db61f", h === "2d7c7507e18db61f", h);
}

console.log("\n=== 被施加 → STATUS_ADD: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;