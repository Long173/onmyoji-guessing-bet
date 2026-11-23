// tests/g100-active-bearer.ts — ★★★ 第 177 轮：**写在主动 / 普攻技能里的来源子句**（装配点问题）
//
// 缺口清单第 176 轮留下来的三条尾巴之一：鸩「毒之华」（cost=2）的「受到攻击时，为攻击者附加1层[buff_2852_1]」
//   写在**主动技能**里，而被动运行时的 cost 闸门只收 cost<0 ⇒ 这一句此前永远不会被装上。
//   与第 172 轮「主动技能里的先机」同一类：装配点，不是判据。
//
// 本轮：装配点挪到 cost 闸门**之前**（只收「有来源证据 + 族认得出来 + 事件码真有派发点」的），
//   执行走 execute 的 **statusOnly** 模式 —— 否则挨一下打就把整门大招再放一遍（多算）。
import fs from "node:fs";
import path from "node:path";
import { DamageType } from "../kernel/types.ts";
import { matchFamily } from "../kernel/triggers.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { compileAll } from "../tools/compile-census.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const irs = (input.skills as any[]).map((e: any) => ({ key: String(e.key), ir: JSON.parse(String(e.json)) }));
const charOf = (key: string) => KB.find((c: any) => String(c.id) === key.split("/")[0])!;
const skillOf = (key: string) => (charOf(key).skills ?? []).find((s: any) => String(s.id) === key.split("/")[1])!;

async function mk(name: string, passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", seed = 20261014) {
  const s = KB.find((x: any) => x.name === name);
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name };
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives });
  await a.battle.runStartup();
  return a;
}
const has = (e: any, id: string) => (e?.statuses ?? []).some((s: any) => String(s.def?.id ?? "") === id);

sec("[1] ★★★ 形状：8 条带来源证据的技能里，只有 **2 条**写在主动 / 普攻里 —— 其中只有 1 条的族认得出来");
{
  const rows = irs.filter(x => (x.ir.sourceBearerRefs ?? []).length > 0).map(x => {
    const sk = skillOf(x.key);
    // ★ 族按**整句**判（证据子句是逗号切出来的小句，不含「受到攻击时」—— 见 passive-runtime 的同一条注）
    const ev = String(x.ir.sourceBearerRefs[0].clause ?? "");
    const sentence = (x.ir.sentences ?? []).map((s: any) => String(s?.text ?? "")).find((t: string) => t.includes(ev)) ?? ev;
    const fam = matchFamily(sentence);
    return { key: x.key, cost: Number(sk.cost ?? 0), family: fam?.family ?? "无族", code: fam?.evCode ?? null };
  });
  const active = rows.filter(r => r.cost >= 0);
  console.log("  主动/普攻：" + (active.map(r => r.key + "(cost=" + r.cost + " " + r.family + "→" + (r.code ?? "-") + ")").join(" · ") || "无"));
  ok("★★★ 主动/普攻里的来源子句恰好 2 条：285/285_02 与 346/346_01",
    active.map(r => r.key).sort().join(",") === "285/285_02,346/346_01", JSON.stringify(active.map(r => r.key)));
  ok("★★★ 其中只有鸩「毒之华」的族认得出来且有派发点（受到攻击 → BEFORE_DAMAGE）",
    active.filter(r => r.code !== null).map(r => r.key + ":" + r.code).join(",") === "285/285_02:BEFORE_DAMAGE",
    JSON.stringify(active.map(r => r.key + ":" + r.code)));
  ok("★★ 聆海金鱼姬「川流」是「无族」（「友方受到单次敌方伤害超过其生命上限30%时」）⇒ 本轮装不上，留着",
    active.some(r => r.key === "346/346_01" && r.family === "无族"));
}

sec("[2] ★★★ 运行时（被动档）：鸩挨打 ⇒ 状态落在**攻击者**身上，而且**没有**再放一遍大招");
{
  const a = await mk("鸩", "PARSED_CANDIDATES_ONLY");
  const b = a.battle;
  const all = b.allEntities();
  const zhen = all.find((e: any) => e.teamId === 0)!;
  const foes = all.filter((e: any) => e.teamId === 1);
  const attacker = foes[0];
  ok("★★★ 装配账上有它：activeBearerFields 记了 285_02 / BEFORE_DAMAGE / refs=[2852_1]",
    (b.passiveReport?.activeBearerFields ?? []).some((x: any) => x.skill === "毒之华" && x.code === "BEFORE_DAMAGE" && x.refs.join() === "2852_1"),
    JSON.stringify(b.passiveReport?.activeBearerFields));
  const dmg0 = b.trace.filter((t: any) => t.t === "DAMAGE").length;
  await b.damage(attacker, zhen, 1000, DamageType.NORMAL, 1);
  ok("★★★ 攻击者拿到了 2852_1", has(attacker, "2852_1"), JSON.stringify({ who: attacker.id, got: (attacker.statuses ?? []).map((s: any) => s.def?.id) }));
  ok("★★★ 其他敌人一个都没有", foes.filter((e: any) => e.id !== attacker.id && has(e, "2852_1")).length === 0,
    JSON.stringify(foes.map((e: any) => (e.statuses ?? []).map((s: any) => s.def?.id))));
  ok("★★★ 鸩自己也没有（这一句的承受者是攻击者，不是自己）", !has(zhen, "2852_1"),
    JSON.stringify((zhen.statuses ?? []).map((s: any) => s.def?.id)));
  ok("★★★ 而且**没有**多打一次：这次事件只产生 1 条 DAMAGE（statusOnly 挡住了伤害/治疗/护盾那几节）",
    b.trace.filter((t: any) => t.t === "DAMAGE").length === dmg0 + 1,
    JSON.stringify({ before: dmg0, after: b.trace.filter((t: any) => t.t === "DAMAGE").length }));
  ok("★★★ 也没有把「毒之华」当成一次技能释放记进来（没有 SKILL_CAST）",
    !b.trace.some((t: any) => t.t === "SKILL_CAST" && String(t.skill ?? "").includes("毒之华")),
    JSON.stringify(b.trace.filter((t: any) => t.t === "SKILL_CAST").map((t: any) => t.skill)));
}

sec("[3] ★★ 反向：默认档（被动 OFF）既没有处理器、也不会施加任何状态（指纹由 g43 守）");
{
  const a = await mk("鸩", "NOT_EXECUTED");
  const b = a.battle;
  const all = b.allEntities();
  const zhen = all.find((e: any) => e.teamId === 0)!;
  const attacker = all.find((e: any) => e.teamId === 1)!;
  ok("★★ 默认档没有 activeBearerFields 记账", (b.passiveReport?.activeBearerFields ?? []).length === 0);
  await b.damage(attacker, zhen, 1000, DamageType.NORMAL, 1);
  ok("★★ 挨打之后攻击者身上没有 2852_1（这一档不装任何机制类东西）", !has(attacker, "2852_1"),
    JSON.stringify((attacker.statuses ?? []).map((s: any) => s.def?.id)));
}

console.log("\n=== 主动/普攻里的来源子句: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
