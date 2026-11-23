// tests/g5-inspectors.ts — ★ G5 验收（引擎侧）：伤害拆解 / AI 决策 / 随机数用途 / 统计归属
// 对应 a1-4.md §19（每次伤害生成 Breakdown）、§20（RNG 成为事件的一部分）、
//            §25（AI 决策可视化）、§45（全局统计在引擎中生成）
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);

const kit = createKit(bundle);
const a = assembleMatch(kit, canonicalMatch(), { seed: 20261001 });
await a.battle.run();
const trace = a.battle.trace as any[];
const byCode = (c: string) => trace.filter(e => e.t === c);

sec("[1] 伤害拆解（§19/§26）：每个数字都要能追到来源");
const dmgs = byCode("DAMAGE");
ok(`存在伤害事件（${dmgs.length} 条）`, dmgs.length > 10);
ok("★ 每条伤害都带 breakdown", dmgs.every(d => !!d.breakdown));
const bd = dmgs[0].breakdown;
ok("breakdown 覆盖六个环节（倍率/暴击/增伤/防御/浮动/落账）", ["base", "rate", "crit", "modifiers", "defense", "float", "raw", "final", "applied", "steps"].every(k => k in bd), Object.keys(bd).join(","));
ok("★ 拆解里的算式能复算出最终伤害（误差 < 0.01）", dmgs.every(d => {
  const b = d.breakdown;
  const expect = b.type === "FIXED" ? b.base * b.rate : b.base * b.rate * b.crit.cridMultiplier * b.defense.multiplier * b.modifiers.product * b.float.value;
  return Math.abs(expect - b.final) < 0.01;
}), (() => { const b = dmgs[0].breakdown; const e = b.base * b.rate * b.crit.cridMultiplier * b.defense.multiplier * b.modifiers.product * b.float.value; return `${e} vs ${b.final}`; })());
ok("人话版算式逐步给出（至少 5 步）", dmgs.every(d => d.breakdown.steps.length >= 5), String(bd.steps.length));
ok("暴击事件一定带 roll（除非官方[5] 必暴）", dmgs.filter(d => d.breakdown.crit.isCrit).every(d => d.breakdown.crit.forced || d.breakdown.crit.roll !== null));
ok("非暴击事件的 roll 也在（用于证明「确实判过」）", dmgs.filter(d => d.breakdown.crit.canCrit && !d.breakdown.crit.isCrit).every(d => d.breakdown.crit.roll !== null));
ok("防御减伤按官方公式 300/(300+def)", dmgs.filter(d => d.type === "NORMAL").every(d => Math.abs(d.breakdown.defense.multiplier - 300 / (300 + d.breakdown.defense.value)) < 1e-9));
ok("吸收量与事件字段一致", dmgs.every(d => Math.abs(d.breakdown.applied - d.applied) < 1e-9 && Math.abs(d.breakdown.absorbed - (d.absorbed ?? 0)) < 1e-9));

sec("[2] 随机数成为事件的一部分（§20）");
const draws = a.battle.rng.draws;
ok(`本场抽数 ${draws.length} 次`, draws.length > 10);
ok("★ 每次抽数都有用途标签字段", draws.every(d => typeof d.tag === "string" && d.tag.length > 0));
const labeled = draws.filter(d => d.tag !== "unlabeled").length;
console.log(`    带标签 ${labeled}/${draws.length}（${((labeled / draws.length) * 100).toFixed(1)}%），未标注如实记为 unlabeled`);
ok("★ 暴击与浮动都被标注（crit: / float:）", draws.some(d => d.tag.startsWith("crit:")) && draws.some(d => d.tag.startsWith("float:")));
ok("★ 伤害事件里的 roll 序号能在抽数表里对上", dmgs.filter(d => d.breakdown.float.roll).every(d => {
  const r = d.breakdown.float.roll;
  const found = draws.find(x => x.n === r.n);
  return !!found && Math.abs(found.v - r.v) < 1e-12;
}));
ok("抽样检查：roll 的用途标签与所在事件一致", dmgs.filter(d => d.breakdown.crit.roll).every(d => {
  const r = d.breakdown.crit.roll;
  const found = draws.find(x => x.n === r.n);
  return !!found && found.tag.startsWith("crit");
}));

sec("[3] AI 决策可视化（§25）");
const decisions = byCode("AI_DECISION");
ok(`存在 AI 决策事件（${decisions.length} 条）`, decisions.length > 10);
ok("★ 每条决策都记下了逐条规则的判定结果", decisions.every(d => Array.isArray(d.rules) && d.rules.every((r: any) => "affordable" in r && "cond" in r)));
// 只有"某条规则命中"的决策才要求 chosen 出自候选；
// 走 fallback 的（没规则成立 → 退回 0 鬼火技能）本来就不在候选列表里，这是**正确**行为。
const matched = decisions.filter(d => d.reason === "COND_MATCH" || d.reason === "UNCONDITIONAL_RULE");
ok(`★ 规则命中的决策里，选中技能一定出自候选（${matched.length}/${decisions.length} 条走此路径）`,
   matched.every(d => d.rules.some((r: any) => r.skill === d.chosen)));
ok("走 fallback 的决策明确说明原因", decisions.filter(d => !matched.includes(d)).every(d => /NO_RULE|UNaffordable|NO_AI_PROFILE/.test(d.reason)), JSON.stringify([...new Set(decisions.filter(d => !matched.includes(d)).map(d => d.reason))]));
ok("决策原因有明确定义（不是空字符串）", decisions.every(d => typeof d.reason === "string" && d.reason.length > 0), JSON.stringify([...new Set(decisions.map(d => d.reason))]));
ok("鬼火不足时能看出「是钱不够」而不是「条件不成立」", decisions.some(d => d.rules.some((r: any) => !r.affordable)));
ok("没有写明条件的规则会被点名", decisions.some(d => d.rules.some((r: any) => r.condRaw === "")) || byCode("AI_DECISION").length === 0);
const targets = byCode("AI_TARGET");
ok(`存在目标选择事件（${targets.length} 条）`, targets.length > 10);
ok("★ 目标事件记下了候选与最终选择", targets.every(t => Array.isArray(t.candidates) && (t.chosen === null || t.candidates.includes(t.chosen))));
ok("没有目标规则的技能会被如实标注", targets.filter(t => !t.applied).every(t => !!t.note));

sec("[4] 统计由引擎生成（§45）—— 关掉 trace 也不能丢");
{
  const st = a.battle.stats;
  ok("引擎侧统计非空", st.damageDealt.size > 0 && st.actions.size > 0);
  const b2 = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  (b2.battle as any).traceLevel = "NONE";
  await b2.battle.run();
  ok("★ NONE 档下 trace 为空", (b2.battle.trace as any[]).length === 0);
  ok("★ 但统计依然完整（伤害/治疗/行动/技能使用）", b2.battle.stats.damageDealt.size > 0 && b2.battle.stats.actions.size > 0 && b2.battle.stats.skillUsage.size > 0);
  const sumTrace = [...st.damageDealt.values()].reduce((x, y) => x + y, 0);
  const sumNone = [...b2.battle.stats.damageDealt.values()].reduce((x, y) => x + y, 0);
  ok("★ 两档的总伤害完全一致（统计口径唯一）", Math.abs(sumTrace - sumNone) < 1e-6, `${sumTrace} vs ${sumNone}`);
  ok("第一阵亡单位也被记录（NONE 档没有 trace 也要能算）", b2.battle.firstDeathId !== null, String(b2.battle.firstDeathId));
}

sec("[6] 作用范围也必须是可见事件（a1-4 §16 技能作用范围）");
{
  const scopes = byCode("TARGET_SCOPE");
  ok("★ 每次技能释放都留下 TARGET_SCOPE", scopes.length > 10, String(scopes.length));
  ok("每条都带 mode 与承受者名单", scopes.every(s => !!s.mode && Array.isArray(s.hurt)));
  const aoe = scopes.filter(s => s.mode === "ENEMY_ALL");
  ok("★ 群攻的承受者名单长度 > 1（不是只打一个）", aoe.length > 0 && aoe.some(s => s.hurt.length > 1),
     JSON.stringify(aoe.slice(0, 3).map((s: any) => s.skill + ":" + s.hurt.length)));
  const allModes = [...new Set(scopes.map(s => s.mode))];
  console.log("    本局出现过的范围：" + JSON.stringify(allModes));
  ok("不出现「友方技能打到敌人」这种方向性矛盾",
     scopes.every(s => !(s.mode === "ALLY_ALL" && s.hurt.length > 0)));
  // Banner 必须能把范围讲出来（否则 Theater 里只能靠数伤害条目猜）
  const { Presenter } = await import("../../apps/web/src/theater/presenter.ts");
  const s0 = scopes.find((s: any) => s.mode === "ENEMY_ALL") ?? scopes[0];
  // 只需要 match.red/blue 来建 entityId → unitId 映射，帧数据无关紧要
  const p: any = Presenter.fromSerialized({
    schemaVersion: 1, frames: [], result: null,
    match: { red: ["红1", "红2", "红3", "红4", "红5"], blue: ["蓝1", "蓝2", "蓝3", "蓝4", "蓝5"] },
  } as any);
  const b = p.banner(s0, []);
  // The web UI is in English now: the scope line's label is "Scope" (was 范围).
  ok("★ Presenter 把这个事件渲染成了带「范围 / Scope」的 Banner", (b?.lines ?? []).some((l: any) => l.label === "Scope"), JSON.stringify(b));
}

console.log(`\n=== G5: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
