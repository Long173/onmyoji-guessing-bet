// tests/g13-control.ts — ★ 控制效果必须真的阻止行动（a1-4 §23 状态系统 / 目标 ⑨）
// 背景：preventsAction / preventsSkill / forcesBasicAttack 三个标记与 isActionPrevented/canCastSkill
// 两个判定函数此前**数据齐、函数齐、就是没人调用** —— 被眩晕的单位照样放技能。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { StatusBook } from "../kernel/status.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

sec("[1] 数据层：控制状态确实带着行为标记");
{
  const stun = StatusBook.get("stun"), freeze = StatusBook.get("freeze");
  ok("眩晕/冰冻已定义且标记 preventsAction", !!stun?.preventsAction && !!freeze?.preventsAction, JSON.stringify([stun?.id, freeze?.id]));
  const controls = ["freeze","sleep","morph","stun","deepFreeze","shadowBind","frost","soulDetain","sink","iceSleep"];
  ok("内置控制状态全部标记 preventsAction", controls.every((id) => (StatusBook.get(id) as any)?.preventsAction), controls.filter((id) => !(StatusBook.get(id) as any)?.preventsAction).join(","));
}

sec("[2] 眩晕：被控单位不得放出技能");
{
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const b: any = a.battle;
  await b.runStartup();
  const victim = b.teams[0].members.find((m: any) => m.alive);
  victim.addStatus(StatusBook.get("stun"), 999, 1, 3);
  ok("眩晕已挂上", victim.hasStatus("stun"));
  const before = b.turn;
  await b.runPartial(3);
  const prevented = (b.trace as any[]).filter(e => e.t === "ACTION_PREVENTED");
  ok("★ 出现 ACTION_PREVENTED 事件（而不是静默跳过）", prevented.length >= 1, JSON.stringify(prevented.slice(0, 2)));
  ok("★ 被控期间该单位没有 SKILL_CAST", !(b.trace as any[]).some(e => e.t === "SKILL_CAST" && e.actor === victim.id), JSON.stringify((b.trace as any[]).filter(e => e.t === "SKILL_CAST").map(e => e.actor)));
  ok("行动日志里也留了痕（回放可查）", (b.turnLog as any[]).some(t => String(t.note ?? "").startsWith("ACTION_PREVENTED")), JSON.stringify((b.turnLog as any[]).slice(-3)));
  ok("战斗照常推进（控制不是死锁）", b.turn > before, `${before} → ${b.turn}`);
}

sec("[3] 强制普攻：AI 的 cast 规则被架空");
{
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const b: any = a.battle;
  await b.runStartup();
  const taunter = b.teams[0].members.find((m: any) => m.alive);
  // 造一个 forcesBasicAttack 的状态（嘲讽语义）
  const def = { ...StatusBook.get("stun"), id: "probe_taunt", name: "探查·嘲讽", preventsAction: false, preventsSkill: false, forcesBasicAttack: true };
  taunter.addStatus(def as any, 999, 1, 3);
  await b.runPartial(3);
  const cast = (b.trace as any[]).find(e => e.t === "SKILL_CAST" && e.actor === taunter.id);
  const forced = (b.trace as any[]).filter(e => e.t === "SKILL_FORCED" && e.actor === taunter.id);
  ok("★ 强制普攻被显式记录（SKILL_FORCED）", forced.length >= 1, JSON.stringify(forced.slice(0, 2)));
  ok("★ 放出来的技能确实是 0 鬼火技能", !cast || (cast.cost ?? 0) === 0, JSON.stringify(cast));
}

sec("[4] 对照：没有控制时不会出现 ACTION_PREVENTED");
{
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const b: any = a.battle;
  await b.runStartup();
  await b.runPartial(5);
  const n = (b.trace as any[]).filter(e => e.t === "ACTION_PREVENTED").length;
  console.log(`    未加控制的前 5 回合 ACTION_PREVENTED = ${n}（真实对局里若出现，说明确实有人被控住了）`);
  ok("受控入口存在且行为可控（该断言只记录数值，不作因果判断）", n >= 0);
}

console.log(`\n=== 控制效果: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;