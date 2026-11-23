// tests/g90-orb-gauge.ts — ★★★ 第 136 轮：**额外推进鬼火行动条**接线 + **花海**记账
//
// 两件事都是第 135 轮报告 §119.6 里点名的入口：
//   ① 「额外推进N格鬼火行动条」在引擎里**没有任何字段接** —— 追月神「明月潮生」因此连"可执行面"都没有
//      （先机族接线之后仍然装不上），流光追月神「绮罗舞」则是**少做了半句**（buff 发了、鬼火条没推）；
//   ② 「花海」是一个叠层计数器 + 每回合伤害，全库 8 条子句此前**一条都没报**（silent）。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { findUnmodeled, UNMODELED } from "../compile/unmodeled.ts";
import { splitClauses } from "../compile/skill-compiler.ts";
import { loadTips, setTipsTable } from "../compile/tips.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const tipsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
setTipsTable(loadTips(Array.isArray(tipsRaw) ? tipsRaw : (Object.values(tipsRaw).find((v: any) => Array.isArray(v)) as any[]) ?? []));
const irOf = (who: string, skill: string) => {
  const s = LIST.find((x: any) => x.name === who)!;
  const sk = (s.skills ?? []).find((x: any) => x.name === skill)!;
  return compileSkill(s.id, s.name, sk);
};
const allIR = () => {
  const out: Array<{ who: string; skill: string; ir: any }> = [];
  for (const s of LIST) for (const sk of (s.skills ?? [])) out.push({ who: s.name, skill: sk.name, ir: compileSkill(s.id, s.name, sk) });
  return out;
};

sec("[1] ★★★ 编译：orbGaugeAdvance 收两条（1 格 / 3 格），越界写法不收");
{
  const hits = allIR().filter(x => (x.ir.orbGaugeAdvance ?? 0) > 0);
  ok("★★★ 全库恰好 2 条「额外推进鬼火行动条」（追月神 1 格 / 流光追月神 3 格）",
    hits.length === 2 &&
    hits.some(x => x.who === "追月神" && x.ir.orbGaugeAdvance === 1) &&
    hits.some(x => x.who === "流光追月神" && x.ir.orbGaugeAdvance === 3),
    JSON.stringify(hits.map(x => x.who + ":" + x.ir.orbGaugeAdvance)));
  const ir: any = compileSkill(1, "探查", { id: "p", name: "探查", cost: 0, description: "使鬼火行动条额外推进99格" });
  ok("★★★ 越界（99 格）⇒ **不写字段**（fail-closed：宁可保持未建模，也不猜一个数）",
    ir.orbGaugeAdvance === undefined, JSON.stringify(ir.orbGaugeAdvance));
  ok("★★ 两种语序都认（推进N格鬼火行动条 / 鬼火行动条推进N格）",
    (compileSkill(1, "探查", { id: "p2", name: "探查2", cost: 0, description: "额外推进3格鬼火行动条" }) as any).orbGaugeAdvance === 3 &&
    (compileSkill(1, "探查", { id: "p3", name: "探查3", cost: 0, description: "鬼火行动条额外推进2格" }) as any).orbGaugeAdvance === 2);
}

const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return {
    unitId: "u-" + name, shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 20000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 },
    soulId: null,
  };
};

sec("[2] ★★★ 行为面：先机族 + 推条 —— 追月神开局真的把鬼火条推 1 格");
{
  const m: any = canonicalMatch();
  m.red.units[0] = unit("追月神");
  const a: any = assembleMatch(createKit(bundle), m, { seed: 136, passives: "PARSED_CANDIDATES_ONLY", traceLevel: "FULL" });
  const pool = a.battle.teams[0].orbs;
  const size = pool.policy.gaugeSize;
  await a.battle.runStartup();
  const inst = (a.battle.passiveReport?.installed ?? []).filter((x: any) => x.skill === "明月潮生");
  ok("★★★ 追月神「明月潮生」**第一次装上了**（先机 → BATTLE_START；此前没有可执行面）",
    inst.length === 1 && inst[0].event === "BATTLE_START", JSON.stringify((a.battle.passiveReport?.installed ?? []).map((x: any) => x.skill)));
  const tr = a.battle.trace.filter((t: any) => t.t === "ORB_GAUGE_ADVANCE_EXTRA");
  ok("★★★ 开局那一次推进留了痕（cells=1，来源点名这条技能）",
    tr.length === 1 && tr[0].cells === 1 && /明月潮生/.test(String(tr[0].reason)), JSON.stringify(tr));
  ok("★★★ 鬼火条真的动了：gauge = 1（size=" + size + "）",
    pool.gauge === 1 % Math.max(1, size) && pool.cycle === (1 >= size ? 1 : 0), JSON.stringify(pool.snapshot()));

  const off: any = assembleMatch(createKit(bundle), m, { seed: 136, passives: "NOT_EXECUTED" });
  await off.battle.runStartup();
  ok("★★★ 反向：OFF 档不装、也不推（默认路径逐位不变）",
    (off.battle.passiveReport?.installed ?? []).length === 0 &&
    !off.battle.trace.some((t: any) => t.t === "ORB_GAUGE_ADVANCE_EXTRA"),
    JSON.stringify({ installed: (off.battle.passiveReport?.installed ?? []).length, gauge: off.battle.teams[0].orbs.gauge }));
}

sec("[3] ★★★ 多次满格：推进 N 格必须循环调用（一次加 N 会漏掉中间的 cycle++）");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 1, traceLevel: "FULL" });
  const pool = a.battle.teams[1].orbs;
  const size = pool.policy.gaugeSize;
  const before = { gauge: pool.gauge, cycle: pool.cycle };
  const filled = a.battle.advanceOrbGauge(1, size + 2, "PROBE");
  const expGauge = (before.gauge + size + 2) % size;
  const expCycle = before.cycle + Math.floor((before.gauge + size + 2) / size);
  ok("★★★ gauge / cycle 与逐格推进完全一致（size=" + size + "，推 " + (size + 2) + " 格）",
    pool.gauge === expGauge && pool.cycle === expCycle, JSON.stringify({ got: { g: pool.gauge, c: pool.cycle }, want: { g: expGauge, c: expCycle } }));
  ok("★★★ 满格次数如实返回（filled=" + filled + "）且记了 pendingReward",
    filled === Math.floor((before.gauge + size + 2) / size) && (filled === 0 || pool.pendingReward >= 0), String(filled));
}

sec("[4] ★★★ 花海：8 条子句记账，「点燃花海」那种修辞不收（双向）");
{
  /**
   * ★★★ 第 145 轮按事实改写：机制**接线并验证**之后（g93 23 条全绿），这一条从 WARN 降为 INFO ——
   *   动词表里保留它，是为了留下"当年缺什么"的可追溯说明，而不是继续主张它是缺口。
   */
  ok("★★★ 动词表里仍有「花海」（留档用），但严重度已降为 INFO", UNMODELED.some((e: any) => e.verb === "花海" && e.severity === "INFO"),
    JSON.stringify(UNMODELED.filter((e: any) => e.verb === "花海").map((e: any) => e.severity)));
  const hits = allIR().flatMap(x => (x.ir.unmodeledMechanics ?? []).filter((m: any) => m.verb === "花海").map((m: any) => ({ who: x.who, skill: x.skill, clause: String(m.clause) })));
  /**
   * ★★★ 第 145 轮按事实改写：8 条子句**全部放行**（逐子句收窄，判据是编译器真的解析出了产物）。
   *   两向仍在：下面那条"合成文本仍会被动词表抓到"证明闸门本身没被关掉 ——
   *   放行的是**编译产物覆盖到的真实子句**，不是"把这个动词从表里删掉"。
   */
  ok("★★★ 全库 0 条花海记录（8 条全部放行）", hits.length === 0, JSON.stringify({ total: hits.length, bySkill: [...new Set(hits.map(h => h.skill))] }));
  ok("★★ 每条都真的含「花海」两个字（没有误伤）", hits.every(h => /花海/.test(h.clause)), JSON.stringify(hits.filter(h => !/花海/.test(h.clause))));
  ok("★★★ 反向：荒骷髅「花吻烈魂」的「于战场上**点燃**花海」**不算缺口**（修辞用法，filterPattern 排除）",
    !hits.some(h => h.who === "荒骷髅") && !findUnmodeled("荒骷髅于战场上点燃花海，战斗开始时，使攻击最高的友方式神获得[buff_5852_1]", splitClauses).some(h => h.verb === "花海"),
    JSON.stringify(hits.map(h => h.who)));
  ok("★★ 而真正的机制句必须收（合成文本双向）",
    findUnmodeled("花海中的敌方，在回合开始时，每层花海对其造成攻击39%伤害", splitClauses).some(h => h.verb === "花海") &&
    findUnmodeled("回合开始时自动减少1层花海，最少不低于1层", splitClauses).some(h => h.verb === "花海"));
}

console.log("\ng90-orb-gauge: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
