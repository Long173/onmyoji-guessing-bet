// tests/ui9-inspectors.ts — ★ G5 验收（界面侧）：四个检查器 + 接线
// 对应 a1-4.md §20 RNG / §25 AI / §26 Damage / §27 状态检查器 / §28 事件链
import fs from "node:fs";
import path from "node:path";
import { Presenter } from "../src/theater/presenter.ts";

const here = import.meta.dirname;
const ROOT = path.resolve(here, "..", "..", "..");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const S = (p: string) => fs.readFileSync(path.join(here, "..", "src", p), "utf8");

const p = Presenter.fromSerialized(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "replay-demo-123456.json"), "utf8"));
const frames = p.player.frames as any[];

sec("[1] Damage Inspector（§26）：每个伤害数字都能拆开看");
{
  const dmgIdx = frames.map((f, i) => ({ f, i })).filter(x => x.f.t === "DAMAGE");
  ok(`录像里有 ${dmgIdx.length} 条伤害`, dmgIdx.length > 5);
  const bd = p.damageBreakdown(dmgIdx[dmgIdx.length - 1].i);
  ok("★ 能取到伤害拆解", !!bd && !!bd.data);
  ok("拆解含六个环节", ["base", "rate", "crit", "modifiers", "defense", "float", "steps"].every(k => k in bd!.data));
  ok("★ 拆解的算式能复算出最终伤害", (() => {
    const b = bd!.data;
    const expect = b.type === "FIXED" ? b.base * b.rate : b.base * b.rate * b.crit.cridMultiplier * b.defense.multiplier * b.modifiers.product * b.float.value;
    return Math.abs(expect - b.final) < 1e-6;
  })());
  ok("人话版算式不少于 5 步", bd!.data.steps.length >= 5);
  ok("★ 从任意帧往前找，都能找到最近一次伤害拆解", [10, 60, p.frameCount - 1].every(f => !!p.damageBreakdown(f) || f < dmgIdx[0].i));
}

sec("[2] AI Inspector（§25）：为什么放这个技能");
{
  const d = p.aiDecision(p.frameCount - 1);
  ok("★ 能取到 AI 决策", !!d && !!d.skill);
  ok("决策带逐条规则的判定", Array.isArray(d!.skill.rules) && d!.skill.rules.length >= 1);
  ok("决策有明确原因与选中技能", typeof d!.skill.reason === "string" && !!d!.skill.chosen);
  ok("★ 能取到目标选择（打谁、依据是什么）", !!d!.target, JSON.stringify(d!.target ?? null).slice(0, 80));
  ok("规则表每行都有 鬼火是否够 / 条件是否成立", d!.skill.rules.every((r: any) => "affordable" in r && "cond" in r));
}

sec("[3] 状态检查器（§27）：看生命周期而不是快照");
{
  const tl = p.statusTimeline();
  ok(`录像里共 ${tl.length} 条状态记录`, tl.length > 0);
  ok("每条都带 单位/状态/起始帧", tl.every(s => s.unitId && s.status && typeof s.from === "number"));
  ok("★ 已结束的状态有终止帧，且终止晚于起始", tl.filter(s => s.to !== null).every(s => (s.to as number) > s.from));
  // 打开/关闭必须自洽：to===null 的不能标记为已过期，已过期的一定有终止帧
  ok("状态开关自洽（未结束的不算过期，已结束的必有终止帧）", tl.every(s => (s.to === null) === !s.expired));
  ok("按单位过滤可用", p.statusTimeline(tl[0].unitId).every(s => s.unitId === tl[0].unitId));
  ok("有时长与来源字段（数据缺失时如实为空）", tl.every(s => "duration" in s && "source" in s && typeof s.known === "boolean"));
}

sec("[4] RNG Inspector（§20）");
{
  const s = p.rngSummary();
  ok(`全场抽数 ${s.total} 次`, s.total > 0);
  ok("★ 带用途标签的抽数被统计出来", s.labeled > 0 && s.labeled + s.unlabeled === s.total);
  ok("★ 未标注的如实计入 unlabeled（不假装全知道）", s.unlabeled >= 0 && (s.byTag["unlabeled"] ?? 0) === s.unlabeled);
  ok("暴击/浮动标签可见", Object.keys(s.byTag).some(t => t.startsWith("crit:")) && Object.keys(s.byTag).some(t => t.startsWith("float:")));
  const dmgIdx = frames.findIndex(f => f.t === "DAMAGE");
  const r = p.rngAt(dmgIdx);
  ok("★ 伤害帧能列出它用掉的随机数（含序号与用途）", !!r && r.draws.length >= 1 && r.draws.every(d => typeof d.n === "number" && typeof d.tag === "string"));
  // 不消耗随机数的帧必须返回 null（而不是编一个出来）
  const noRoll = frames.findIndex(f => f.t === "SKILL_CAST");
  ok("不消耗随机数的帧如实返回 null", noRoll >= 0 ? p.rngAt(noRoll) === null : true, noRoll >= 0 ? `frame ${noRoll} (${frames[noRoll].t})` : "无此帧");
}

sec("[5] 界面接线：五个检查器页签都在");
{
  const th = S("components/theater/BattleTheater.vue");
  ok("★ 伤害拆解 / AI 决策 / 状态生命周期 / 随机数 / 事件链 五个页签", ["Damage breakdown", "AI decision", "Status lifecycle", "RNG", "Event chain"].every(t => th.includes(t)));
  ok("页签引用了 Presenter 的四个检查器方法", ["damageBreakdown", "aiDecision", "statusTimeline", "rngAt", "rngSummary"].every(m => th.includes(m)));
  ok("状态检查器把「源数据缺失」显式标出来", /source data missing/.test(th));
  ok("随机数页签说明未标注项不假装知道用途", /do not pretend to know the purpose of every roll/.test(th));
}

console.log(`\n══════════════════════════════════`);
console.log(`UI-9 Inspectors 验收：${pass} 通过 / ${fail} 失败`);
console.log(`══════════════════════════════════`);
if (fail > 0) process.exit(1);
