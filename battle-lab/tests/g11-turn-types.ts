// tests/g11-turn-types.ts — ★ Turn 四分类验收（a1-4 §12/§13，目标 ⑨）
// 文档要求：NORMAL / NEW_TURN / PSEUDO_TURN / ACTION_ONLY 必须**正式分类**，
// 且行为差异不得硬编码 —— 该不该推鬼火条、该不该触发回合开始/结束，全部由 TurnFlags 决定。
import fs from "node:fs";
import path from "node:path";
import { TurnType, TurnFlags } from "../kernel/types.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

sec("[1] 四分类定义齐备且各有明确 flag 语义");
{
  const kinds = Object.values(TurnType);
  ok(`四类都在：${kinds.join(" / ")}`, kinds.length === 4 && ["NORMAL", "NEW_TURN", "PSEUDO_TURN", "ACTION_ONLY"].every(k => kinds.includes(k as any)), kinds.join(","));
  ok("每一类都有 flags（不硬编码行为差异）", kinds.every(k => !!TurnFlags[k as any]));
  const f = (k: string) => TurnFlags[k as any] as any;
  ok("★ NORMAL 是唯一会推进鬼火条的类别", f("NORMAL").advancesOrbGauge === true && f("PSEUDO_TURN").advancesOrbGauge === false && f("ACTION_ONLY").advancesOrbGauge === false);
  ok("★ NEW_TURN 会触发回合开始（额外回合），PSEUDO_TURN/ACTION_ONLY 不会", f("NEW_TURN").triggersTurnStart === true && f("PSEUDO_TURN").triggersTurnStart === false && f("ACTION_ONLY").triggersTurnStart === false);
  ok("回合结束同样按类别区分", f("NORMAL").triggersTurnEnd === true && f("ACTION_ONLY").triggersTurnEnd === false);
}

sec("[2] 受控入口：伪回合不得污染回合数与鬼火条");
{
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const b: any = a.battle;
  // ★★★ 第 192 轮：SUMMARY 现在是**统计档**（只留 damage / death / skill usage / first kill），
  //   而这一节要看的正是逐帧细节（TURN_TYPE）⇒ 显式声明 FULL（此前是**碰巧**拿到全部事件）。
  b.traceLevel = "FULL";
  await b.runStartup();
  await b.runPartial(3);
  const turnBefore = b.turn;
  const orbs = b.teams[0].orbs;
  const gaugeBefore = orbs.gauge, orbBefore = orbs.orb;
  const actor = b.teams[0].members.find((m: any) => m.alive);
  await b.runPseudoTurn(actor, TurnType.PSEUDO_TURN);
  const tt = (b.trace as any[]).filter(e => e.t === "TURN_TYPE");
  ok("★ 伪回合留下 TURN_TYPE 事件（Theater 能看出这次不是普通回合）", tt.length === 1 && tt[0].type === "PSEUDO_TURN", JSON.stringify(tt));
  ok("★ 回合数不变（伪回合不计入 turn）", b.turn === turnBefore, `${turnBefore} → ${b.turn}`);
  ok("★ 鬼火条不推进（按 flags 决定，而不是到处写 if）", orbs.gauge === gaugeBefore, `${gaugeBefore} → ${orbs.gauge}`);
  ok("鬼火数值本身也不变", orbs.orb === orbBefore, `${orbBefore} → ${orbs.orb}`);
  ok("伪回合的事件挂在以类别命名的节点下（事件链可归类）", (b.bus.chain as any[]).some(n => n.code === "PSEUDO_TURN"), (b.bus.chain as any[]).map((n: any) => n.code).filter((c: string) => ["NORMAL", "PSEUDO_TURN", "ACTION_ONLY", "NEW_TURN", "TURN"].includes(c)).join(","));
  ok("受控入口没有破坏战斗（还能继续跑）", (await b.runPartial(2)) !== undefined);
}

sec("[3] 对照：普通回合确实会推进回合数与鬼火条");
{
  const a = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 7 });
  const b: any = a.battle;
  b.traceLevel = "NONE";
  await b.runStartup();
  const t0 = b.turn, g0 = b.teams[0].orbs.gauge + b.teams[1].orbs.gauge;
  await b.runPartial(4);
  ok("普通回合增加 turn", b.turn > t0, `${t0} → ${b.turn}`);
  ok("普通回合推进至少一方的鬼火条", b.teams[0].orbs.gauge + b.teams[1].orbs.gauge !== g0 || b.teams[0].orbs.cycle + b.teams[1].orbs.cycle > 0, `${g0} → ${b.teams[0].orbs.gauge + b.teams[1].orbs.gauge}`);
}

sec("[4] 诚实声明：目前还没有生产调用方");
{
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "kernel", "battle.ts"), "utf8");
  const callers = fs.readdirSync(path.join(import.meta.dirname, ".."), { recursive: true } as any)
    .filter((f: any) => String(f).endsWith(".ts"))
    .flatMap((f: any) => { try { return [fs.readFileSync(path.join(import.meta.dirname, "..", f), "utf8")]; } catch { return []; } })
    .filter((s: string) => /runPseudoTurn\(/.test(s)).length;
  console.log(`    含 runPseudoTurn( 的文件数：${callers}（含定义处与测试）`);
  ok("受控入口已就位（反击/协战/追击将来必须走它，而不是直接 runTurn）", /async runPseudoTurn/.test(src));
  console.log("    ⚠ 诚实说明：目前**没有**生产调用方 —— 反击/协战类技能本身尚未实现（属 Skill Fidelity 缺口），");
  console.log("      这一轮交付的是「分类 + 受控入口 + 行为由 flags 决定 + 有验收」，不是「反击已经能打」。" );
}

console.log(`\n=== Turn 四分类: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;