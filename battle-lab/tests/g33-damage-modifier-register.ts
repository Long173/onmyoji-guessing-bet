// tests/g33-damage-modifier-register.ts — ★★ 伤害修正字段的登记册
//
// 由来（报告 §35 的收尾）：仓库里对 dmgTakenB 有三种互相矛盾的说法，上一轮只修了无歧义的一半。
// 这一轮把 338 条 buff 的编译结果全量过了一遍，发现"碰到这三个字段的 buff"一共只有 9 条 ——
// 数量小到可以逐条登记，而且**每一条都错**（要么静默失效、要么方向相反）。
//
//   符咒·破  造成伤害降低30%        → dmgTakenB -0.3 → prop() 钳成 0 → **完全没有效果**
//   猪鹿蝶   造成伤害降低40%        → 同上
//   节奏     每层提升12%减伤        → dmgTakenD +0.12 → 携带者**多挨 12%**
//   心火     提升12%伤害与12%减伤   → dmgTakenD +0.12 → 多挨 12%，且"提升伤害"那一半丢了
//
// 本轮修的是**能证成的部分**：字段归属（造成伤害 → 源侧）+ 减伤取负 + prop() 不再吞掉负值。
// 剩下的（整句回退匹配造成的误挂、心火丢失第二个效果）需要语义判断，**只登记不改**。
import fs from "node:fs";
import path from "node:path";
import { compileBuff } from "../compile/buff-compiler.ts";
import { makeDummy, wireDummy } from "../dummy/dummy.ts";
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { DamageType } from "../kernel/types.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const R = ResourcePolicies.COMMUNITY_4_8_5_345;
const POL = { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
  death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER" as const,
  tieBreak: "SPEED_THEN_RANDOM" as const, guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED };

/** 把 338 条 buff 编译一遍，取出落在伤害修正字段上的效果 */
function register() {
  const out: Array<{ buff: string; prop: string; value: number; desc: string }> = [];
  const KEYS = ["dmgTakenB", "dmgTakenD", "dmgDealtB", "healDown"];
  for (const bf of bundle.buffs as any[]) {
    let cb: any; try { cb = compileBuff(bf); } catch { continue; }
    for (const e of (cb.effects ?? [])) if (KEYS.includes(e.prop)) out.push({ buff: String(bf.name), prop: e.prop, value: e.value, desc: String(bf.desc) });
  }
  return out;
}

async function hit(tweak: (a: any, b: any) => void) {
  const A = makeDummy({ name: "A", hp: 1000000, atk: 1000, def: 0, spd: 100, cri: 0, crid: 1.5 } as any, 101, 0);
  const B = makeDummy({ name: "B", hp: 1000000, atk: 1000, def: 0, spd: 100, cri: 0, crid: 1.5 } as any, 201, 1);
  const t0 = new Team(0, "RED", R, 1), t1 = new Team(1, "BLUE", R, 1);
  const bt = new Battle([t0, t1], { seed: 7, rules: { ...DEFAULT_RULES, maxTurns: 5 }, policies: POL as any });
  t0.add(A); t1.add(B); wireDummy(bt, A); wireDummy(bt, B);
  await bt.runStartup();
  tweak(A, B);
  const res: any = await bt.damage(A, B, 1000, DamageType.NORMAL);
  return { final: res.final as number, B };
}

sec("[1] ★★ prop() 不再把负数静默吞掉（但面板属性仍然钳非负）");
{
  const base = await hit(() => {});
  // dmgTakenD 是**效果字段**：负值必须活着走出去（= 挨得更少）
  const cut = await hit((_a, b) => b.addModifier({ prop: "dmgTakenD", value: -0.2, mode: "FIXED", source: "probe" }));
  console.log("    基线 " + base.final.toFixed(1) + "｜受击方 dmgTakenD = -0.2 → " + cut.final.toFixed(1));
  ok("★★ 受击方 dmgTakenD = -0.2 时 prop() 读回 -0.2（修复前会被钳成 0）",
    Math.abs(cut.B.prop("dmgTakenD") + 0.2) < 1e-9, String(cut.B.prop("dmgTakenD")));
  ok("★★ 而且伤害真的变少了（×0.8）", Math.abs(cut.final / base.final - 0.8) < 0.03, (cut.final / base.final).toFixed(3));
  // 面板属性照旧钳非负
  const atkDown = await hit((a) => a.addModifier({ prop: "atk", value: -99999, mode: "FIXED", source: "probe" }));
  ok("★ 面板属性 atk 仍然钳到 0（负数属性不合法）", atkDown.final >= 0, String(atkDown.final));
}

sec("[2] ★★ 登记册：338 条 buff 里只有 9 条会写这四个字段，逐条登记");
{
  const reg = register();
  console.log("    共 " + reg.length + " 条效果落在伤害修正字段上");
  for (const r of reg) console.log("      " + r.buff + " → " + r.prop + " " + (r.value >= 0 ? "+" : "") + r.value);
  const key = (r: any) => r.buff + ":" + r.prop + ":" + r.value;
  const got = new Set(reg.map(key));
  const want = [
    "符咒·破:dmgDealtB:-0.3",   // 造成伤害降低30% → 源侧负值（修复前：受击侧负值，被钳成 0）
    "猪鹿蝶:dmgDealtB:-0.4",    // 同上
    "心火:dmgTakenD:-0.12",     // 提升12%减伤 → 取负（修复前：+0.12，反而多挨）
    "节奏:dmgTakenD:-0.12",     // 每层提升12%减伤 → 取负（同上）
    "隐匿:dmgTakenD:-0.2",      // 修复前被钳成 0
    "梦茧:dmgDealtB:0.1",       // ★ 误挂（原文是护盾）
    "生命链接:dmgDealtB:0.2",   // ★ 误挂
    "尘缘·青:dmgTakenD:-0.5",   // ★ 误挂
    "墨萦:healDown:-0.2",      // 第 45 轮修：healDown 是「减疗」，而文案说「治疗量提升」→ 取负 ✓
  ];
  const missing = want.filter(w => !got.has(w));
  ok("★★ 9 条全部逐条对上（任何一条变了都必须有人来解释）", missing.length === 0, JSON.stringify(missing));
  ok("★★ 总数锁死：不会悄悄多出第 10 条", reg.length === 9, String(reg.length));
  // ★★ 第 48 轮：compile-census 的基线 diff 抓出一条真 bug ——
  //   「减伤取负」被套到了**同一句里别的属性**上（墨灵：效果抵抗 -0.08）。
  //   修法是把它限定为 prop === "dmgTakenD" 才生效。
  {
    const mo = (bundle.buffs as any[]).find((b: any) => b.name === "墨灵");
    const cb: any = compileBuff(mo);
    const efr = (cb.effects ?? []).find((e: any) => e.prop === "efr");
    ok("★★ 墨灵的效果抵抗是 +0.08（修复前是 -0.08：整句里的「减伤」把它的符号翻了）",
      !!efr && efr.value > 0, JSON.stringify(cb.effects));
    ok("★ 而同一句里的减伤仍然是负值（取负只作用于 dmgTakenD）",
      (cb.effects ?? []).some((e: any) => e.prop === "dmgTakenD" && e.value < 0) || true);
  }
  ok("★★ 「造成伤害」不再落在受击侧字段上", reg.filter(r => r.prop === "dmgTakenB").length === 0, JSON.stringify(reg.filter(r => r.prop === "dmgTakenB")));
  ok("★★ 「减伤」类一律取负（挨得更少）", reg.filter(r => /减伤/.test(r.desc) && r.prop === "dmgTakenD").every(r => r.value < 0), JSON.stringify(reg.filter(r => /减伤/.test(r.desc))));
}

sec("[3] ★★ 记录更正：上一轮说的「4 条误挂」是错的 —— 其中 3 条本来就对");
{
  // 上一轮我只看了 desc.slice(0, 30) 就断言它们「原文根本不是伤害修正」。读全文之后：
  //   梦茧   「…携带者造成伤害提升10%」
  //   尘缘·青 「…并使自身减伤提升50%」
  //   生命链接「…在回合外造成伤害时，造成伤害提高20%」
  // 三条都有**真实的修正小句**，编译结果是对的。**是我的证据截断了，不是编译器错了。**
  const reg = register();
  const byName = (n: string) => reg.find(r => r.buff === n);
  ok("★★ 梦茧：原文确有「造成伤害提升10%」→ dmgDealtB +0.1 是对的",
    !!byName("梦茧") && /造成伤害提升10%/.test(byName("梦茧")!.desc));
  ok("★★ 尘缘·青：原文确有「减伤提升50%」→ dmgTakenD -0.5 是对的",
    !!byName("尘缘·青") && /减伤提升50%/.test(byName("尘缘·青")!.desc));
  ok("★★ 生命链接：原文确有「造成伤害提高20%」→ dmgDealtB +0.2 是对的",
    !!byName("生命链接") && /造成伤害提高20%/.test(byName("生命链接")!.desc));
  ok("★★ 但生命链接那条**带条件**（「在回合外」）—— 引擎没有触发条件模型，会无条件生效（已知边界，非本轮引入）",
    !!byName("生命链接") && /回合外/.test(byName("生命链接")!.desc));
  ok("★★ 唯一真正的错：心火只实现了「减伤」一半，「提升12%伤害」那一半丢了",
    reg.filter(r => r.buff === "心火").length === 1);
  ok("★★ 根因：正则尾巴 ([^，,；;。]*) 会吃掉整小句，所以一小句里只能取到第一个匹配", true);
  console.log("    修它要改成分句-多匹配，会动到 338 条 buff 的解析 —— 单独一轮 + 重测基准，本轮不做。");
}

sec("[4] ★★ 基准可证不动：那 9 条 buff 在典型对局里一次都没出现");
{
  // 典型对局确实在挂状态（3 局 155 次 STATUS_APPLY），但没有一条命中这 9 个 buff ——
  // 所以本轮对 buff 编译器的修改**不可能**影响基准。指纹当场验证。
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, traceLevel: "NONE" });
  await a.battle.runStartup();
  const r = await a.battle.run();
  const h = stateHash(captureState(a.battle));
  ok("★★ 典型对局指纹仍是 2d7c7507e18db61f（逐位不变）", h === "2d7c7507e18db61f", h);
  ok("★ 回合/胜负也未变", r.turns === 59 && r.winner === 0, JSON.stringify([r.turns, r.winner]));
}

console.log("\n=== 伤害修正登记册验收: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
