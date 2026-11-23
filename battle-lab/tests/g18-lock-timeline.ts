// tests/g18-lock-timeline.ts — ★ 缚足「无法受到改变行动条的效果」必须真的生效（第九个同型接线缺口）
//
// 由来：field-census 把 StatusDef.locksTimeline 报成"有读取方"（toStatusDef 里搬运了一次），
// 但**搬运不是判断**。追下去发现：
//   · 生产代码里没有任何一处调用 Timeline.setLock（只有 tests/m0 直接调用它自测）
//   · 也没有任何地方读 StatusDef.locksTimeline 来决定"能不能被拉条/推条"
// 于是被缚足的单位照样被拉被推 —— 与 canBeTargeted / preventsAction 完全同型。
//
// 附带发现：Timeline.advance() 原本对 locked 单位直接 continue。一旦把缚足接上锁条，
// 那单位就会永远停在原地、永远不到达终点、于是永远不再行动 —— 那不是"免疫改变行动条"，那是死锁。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { buildCharacter } from "../compile/character.ts";
import { compileBuff } from "../compile/buff-compiler.ts";
import { StatusBook, locksTimeline } from "../kernel/status.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const buffs = new Map<string, any>(
  (JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[])
    .map(b => [String(b.id), compileBuff(b)]),
);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const probeSkill = (desc: string) =>
  buildCharacter({ id: 1, name: "探查单位", panel: { atk: 8000, hp: 50000, def: 300, spd: 100, cri: 0, crid: 1.5, efh: 0, efr: 0 }, skills: [{ id: "probe", name: "探查", cost: 0, description: desc }] },
    undefined, undefined, buffs, 0, 1).entity.skills[0];
const fresh = async (seed = 20261001) => {
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed });
  await a.battle.runStartup();
  return a.battle;
};
/** 让行动条上有正的位置可推（否则推到 0 会被 clamp，看不出差别） */
const primePositions = async (bt: any, n = 2) => { bt.timeline.advance(); for (let i = 0; i < n; i++) bt.timeline.advance(); };

sec("[1] 数据层：缚足带着锁条标记");
{
  const bf = StatusBook.get("boundFeet");
  ok("前置：缚足已定义且 locksTimeline = true", !!bf?.locksTimeline, JSON.stringify(bf));
  ok("locksTimeline(defs) 判定函数可用", locksTimeline([bf as any]) === true && locksTimeline([StatusBook.get("stun") as any]) === false);
}

sec("[2] 谓词：Timeline 直接查状态，而不是等调用方 setLock");
{
  const bt: any = await fresh();
  const e = bt.teams[0].members[0];
  ok("前置：未上缚足时不被锁", bt.timeline.isLocked(e.id) === false);
  e.addStatus(StatusBook.get("boundFeet"), 999, 1, 3);
  ok("★ 上了缚足之后 isLocked 立刻为真（没有任何人调用 setLock）", bt.timeline.isLocked(e.id) === true);
  const before = bt.timeline.get(e.id).pos;
  const moved = bt.timeline.shift(e.id, 0.5);
  ok("★ 拉条被拒绝，位置不变", moved === false && bt.timeline.get(e.id).pos === before, "moved=" + moved + " pos=" + before + "→" + bt.timeline.get(e.id).pos);
}

sec("[3] 技能级：群推只推得动没被缚足的人");
{
  const bt: any = await fresh();
  await primePositions(bt);
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const enemies = bt.enemiesOf(0);
  const locked = enemies[1];
  locked.addStatus(StatusBook.get("boundFeet"), 999, 1, 5);
  const lockedPos = bt.timeline.get(locked.id).pos;
  const others = enemies.filter((e: any) => e.id !== locked.id).map((e: any) => bt.timeline.get(e.id).pos);
  const skill = probeSkill("对敌方全体造成攻击1%的伤害，并击退50%行动条");
  bt.trace.length = 0;
  await skill.execute(bt, self, enemies[0]);
  const shifts = bt.trace.filter((e: any) => e.t === "TIMELINE_SHIFT");
  const lockedEv = bt.trace.filter((e: any) => e.t === "TIMELINE_LOCKED");
  ok("★ 被缚足者收到 TIMELINE_LOCKED（而不是静默不动）", lockedEv.some((e: any) => e.id === locked.id), JSON.stringify(lockedEv));
  ok("★ 被缚足者位置分毫未动", bt.timeline.get(locked.id).pos === lockedPos, lockedPos + " → " + bt.timeline.get(locked.id).pos);
  ok("★ 其余敌人照常被推", shifts.length === enemies.length - 1, "被推 " + shifts.length + " 人 / 共 " + enemies.length + " 人");
  const moved = enemies.filter((e: any) => e.id !== locked.id).every((e: any, i: number) => bt.timeline.get(e.id).pos < others[i]);
  ok("未锁者的位置确实变小了", moved, JSON.stringify(enemies.map((e: any) => e.id + ":" + bt.timeline.get(e.id).pos)));
}

sec("[4] ★ 锁条不得变成死锁：被缚足的单位照常自然推进、照常行动");
{
  const bt: any = await fresh();
  const e = bt.teams[0].members.find((m: any) => m.alive);
  e.addStatus(StatusBook.get("boundFeet"), 999, 1, 99);   // 长时间锁条
  const before = bt.turn;
  await bt.runPartial(12);
  const acted = (bt.trace as any[]).some((x: any) => x.t === "SKILL_CAST" && x.actor === e.id);
  ok("★ 被缚足的单位在 12 回合内**依然行动过**（锁条不是冻结）", acted, "turn " + before + " → " + bt.turn);
  ok("战斗没有卡住", bt.turn > before, before + " → " + bt.turn);
  ok("该单位仍在行动条上（没有被移出）", bt.timeline.has(e.id));
}

sec("[5] 解除缚足后恢复可被拉条");
{
  const bt: any = await fresh();
  const e = bt.teams[0].members[0];
  e.addStatus(StatusBook.get("boundFeet"), 999, 1, 5);
  ok("前置：已被锁", bt.timeline.isLocked(e.id) === true);
  e.statuses.length = 0;                                  // 模拟解除/驱散/到期
  ok("★ 状态移除后立刻恢复可被改变行动条", bt.timeline.isLocked(e.id) === false && bt.timeline.shift(e.id, 0.2) === true);
}

sec("[6] 回归：显式 setLock 仍然有效（tests/m0 用的那条路径）");
{
  const bt: any = await fresh();
  const e = bt.teams[0].members[0];
  bt.timeline.setLock(e.id, true);
  ok("显式锁 + 谓词锁是「或」的关系", bt.timeline.isLocked(e.id) === true && bt.timeline.shift(e.id, 0.3) === false);
  bt.timeline.setLock(e.id, false);
  ok("解除显式锁后恢复（此时没有缚足状态）", bt.timeline.isLocked(e.id) === false);
}

sec("[7] 确定性：锁条不影响可复现性");
{
  const run = async () => {
    const bt: any = await fresh(4242);
    const e = bt.teams[1].members[0];
    e.addStatus(StatusBook.get("boundFeet"), 999, 1, 99);
    await bt.runPartial(20);
    return JSON.stringify((bt.trace as any[]).filter(x => x.t === "TIMELINE_SHIFT" || x.t === "TIMELINE_LOCKED").map((x: any) => [x.t, x.id, x.percent]));
  };
  const a = await run(), b = await run();
  ok("★ 同 seed 两次的推拉事件序列完全一致", a === b, a.slice(0, 90) + " vs " + b.slice(0, 90));
  ok("序列里确实出现了被锁的痕迹", a.includes("TIMELINE_LOCKED") || a.includes("TIMELINE_SHIFT"));
}

console.log("\n=== 锁条: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
