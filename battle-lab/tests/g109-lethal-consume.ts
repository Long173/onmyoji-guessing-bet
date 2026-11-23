// tests/g109-lethal-consume.ts — ★★★ 第 187 轮：**消耗型换命**（石长姬「磐长纪」）
//
// 原文：「无法被复活。战斗开始时，记录所有式神的初始属性并将自身初始生命凝炼成4朵[buff_6082_1]。
//   受到致命伤害时，消耗1朵[buff_6082_1]，获得其中的生命。」
// 这是**第四种**活下来的方式（前三种：状态自带的 preventsLethal / 替友方拦死 / ON_LETHAL 形态转化），
//   与前三种的区别是**要花掉一个可数资源**（一朵 = 初始生命 / 4）。
// 编译产物：SkillIR.lethalConsume（fail-closed 解析）；运行时：kernel/lethal-consume.ts，挂在 EV.DEATH_PREVENTION 上，
//   与替友方拦死同一条纪律（**不受被动策略控制** —— 它写在技能原文里）。
import fs from "node:fs";
import path from "node:path";
import { compileBuff, toStatusDef } from "../compile/buff-compiler.ts";
import { StatusBook } from "../kernel/status.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { compileAll } from "../tools/compile-census.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const BUFFS: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8"));
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const irOf = (k: string) => JSON.parse(String((input.skills as any[]).find((e: any) => e.key === k)!.json));

sec("[1] ★★★ 编译产物：四条判据都满足才写出来");
{
  const ir = irOf("608/608_02");
  console.log("  lethalConsume = " + JSON.stringify(ir.lethalConsume));
  ok("★★★ 石长姬「磐长纪」解析出 { statusRef: 6082_1, perStack: 1, total: 4 }",
    ir.lethalConsume?.statusRef === "6082_1" && ir.lethalConsume?.perStack === 1 && ir.lethalConsume?.total === 4,
    JSON.stringify(ir.lethalConsume));
  ok("★★★ 而且那一句**不再记「未建模」**（放行口径跟着产物走）",
    !(ir.unmodeledMechanics ?? []).some((m: any) => /致命伤害/.test(String(m.verb) + String(m.clause))),
    JSON.stringify((ir.unmodeledMechanics ?? []).map((m: any) => m.verb)));
  const others = (input.skills as any[]).filter((e: any) => JSON.parse(String(e.json)).lethalConsume);
  ok("★★ 全库只有它一条（不许误伤别的「受到致命伤害时…」写法）", others.length === 1, JSON.stringify(others.map((e: any) => e.key)));
}

const def = toStatusDef(compileBuff(BUFFS.find((b: any) => String(b.id) === "6082_1")));
if (!StatusBook.has(def.id)) StatusBook.set(def.id, def);
async function arena(passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY") {
  const s = KB.find((c: any) => c.name === "石长姬")!;
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name: "石长姬" };
  const a: any = assembleMatch(createKit(bundle), m, { seed: 187, passives });
  await a.battle.runStartup();
  return { b: a.battle, e: a.battle.teams[0].members[0], foe: a.battle.teams[1].members[0] };
}
const stacksOf = (e: any, ref: string) => { const st = (e.statuses ?? []).find((s: any) => String(s.def?.id ?? "") === ref); return st ? Number(st.stacks ?? 0) : 0; };

sec("[2] ★★★ 装上去了（且不受被动档控制 —— 它写在技能原文里）");
{
  const { b, e } = await arena("NOT_EXECUTED");
  const h = (b.bus.handlers ?? []).filter((x: any) => String(x.id).startsWith("lethalConsume:"));
  ok("★★★ 默认档（被动 OFF）下也装着（与替友方拦死同一条纪律）", h.length === 1 && h[0].ownerId === e.id, JSON.stringify(h.map((x: any) => x.id)));
  ok("★★ 排在替友方拦死之后（priority -5 > -10）", h[0].priority === -5, String(h[0].priority));
}

sec("[3] ★★★ 一次致命伤害：花掉一朵，活着回来，生命 = 初始生命 / 4");
{
  const { b, e, foe } = await arena("NOT_EXECUTED");
  const initialMax = Number(e.maxHp);
  e.addStatus(def, e.id, 4, 5);
  ok("前置：4 朵在手", stacksOf(e, "6082_1") === 4, String(stacksOf(e, "6082_1")));
  e.hp = 0; e.hpZero = true;
  const t0 = b.trace.length;
  await b.resolveLethal(e, foe.id);
  const tr = b.trace.slice(t0);
  const consume = tr.find((t: any) => t.t === "LETHAL_CONSUME");
  ok("★★★ 没有死（alive 且 dead=false）", e.alive === true && e.dead === false, JSON.stringify({ alive: e.alive, dead: e.dead, hp: e.hp }));
  ok("★★★ 生命 = 初始生命 / 4（四舍五入，至少 1）", Math.abs(Number(e.hp) - Math.max(1, Math.round(initialMax / 4))) <= 1,
    JSON.stringify({ hp: e.hp, initialMax, expect: Math.round(initialMax / 4) }));
  ok("★★★ 花掉正好一朵（4 → 3）", stacksOf(e, "6082_1") === 3, String(stacksOf(e, "6082_1")));
  ok("★★★ 留痕 LETHAL_CONSUME（含消耗数 / 剩余 / 生命前后 / 原句）",
    !!consume && consume.consumed === 1 && consume.left === 3 && String(consume.clause).length > 6, JSON.stringify(consume));
  ok("★★ 走的是 DEATH_PREVENTION（事件链里看得见）", tr.some((t: any) => t.t === "DEATH_PREVENTED"), JSON.stringify(tr.map((t: any) => t.t)));
}

sec("[4] ★★★ 反向：一朵都没有 ⇒ 照常倒下（fail-closed，不许凭空免死）");
{
  const { b, e, foe } = await arena("NOT_EXECUTED");
  e.hp = 0; e.hpZero = true;
  const t0 = b.trace.length;
  await b.resolveLethal(e, foe.id);
  const tr = b.trace.slice(t0);
  ok("★★★ 这次真的死了", e.dead === true, JSON.stringify({ dead: e.dead, hp: e.hp }));
  ok("★★★ 而且留痕 LETHAL_CONSUME_BLOCKED / NO_STACK（「没做」看得见）",
    tr.some((t: any) => t.t === "LETHAL_CONSUME_BLOCKED" && t.reason === "NO_STACK"), JSON.stringify(tr.filter((t: any) => /LETHAL_CONSUME/.test(t.t))));
}

sec("[5] ★★★ 资源是用得完的：连吃 4 次，第 5 次要命");
{
  const { b, e, foe } = await arena("NOT_EXECUTED");
  e.addStatus(def, e.id, 4, 5);
  for (let i = 0; i < 4; i++) { e.hp = 0; e.hpZero = true; await b.resolveLethal(e, foe.id); }
  ok("★★★ 4 朵花完之后还活着（4 次都换回来了）", e.dead === false, JSON.stringify({ dead: e.dead, stacks: stacksOf(e, "6082_1") }));
  ok("★★★ 而朵数正好归零", stacksOf(e, "6082_1") === 0, String(stacksOf(e, "6082_1")));
  e.hp = 0; e.hpZero = true;
  await b.resolveLethal(e, foe.id);
  ok("★★★ 第 5 次：没有朵可花 ⇒ 死", e.dead === true, JSON.stringify({ dead: e.dead, hp: e.hp }));
}

console.log("\n=== 消耗型换命（石长姬）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
