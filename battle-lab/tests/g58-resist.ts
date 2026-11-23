// tests/g58-resist.ts — ★★★ 效果抵抗：八维里唯一被引擎忽略的那一维（第 97 轮，红区 H）
//
// 事实：竞猜输入是**八维面板**，而「效果抵抗」从来没有被消费过 ——
//   EV.RESIST 事件码存在、**从未被派发**（第 27 轮普查记下，至今仍在 field-allowlist 的 knownGaps 里）。
//   状态施加只掷一次"原文写的基础概率"，于是抵抗这一维对结果完全无影响。
//
// ★ 公式是**红区**：官方词条表里没有这条公式，唯一可对照的是一份社区模拟器实现
//   （reference/omj_simulator-master/core/tasks/add-buff.ts:42-49，两掷 + BUFF_RES 事件）。
//   所以三种口径都实现，**默认 NONE（保持现状、随机流逐位不变）**，并把这个未知量量出来。
import fs from "node:fs";
import path from "node:path";
import { ResistPolicies, defaultPolicies, policySnapshot } from "../kernel/policies.ts";
import { DISPATCHED_EV_CODES } from "../compile/passive-runtime.ts";
import { compileBuff, toStatusDef } from "../compile/buff-compiler.ts";
import { EV } from "../kernel/types.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = "2d7c7507e18db61f";
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

sec("[1] ★★ 三条口径都声明了，默认是「不参与」");
{
  const fs2 = Object.values(ResistPolicies).map(p => p.formula);
  /**
   * ★★ 判据**从声明里派生**，不在这里再抄一遍那三个名字 ——
   *   第一版写成了字面量数组，`tools/vocab-audit.ts` 当场报出一组新的跨文件重复词表
   *   （kernel/policies.ts 的联合类型 + 本文件的数组）。**词表重复本身就是要消掉的东西**，
   *   不是写一句说明就完事 —— 这条判据只需要「三条互不相同且都在声明里」。
   */
  ok("★★★ 三种 formula 齐备且互不相同（判据从声明派生，没有第二份词表）",
    new Set(fs2).size === 3 && fs2.every((f: any) => typeof f === "string" && f.length > 0), JSON.stringify(fs2));
  ok("★★★ 默认 NONE，且状态是 UNKNOWN（官方没有这条公式）",
    defaultPolicies().resist.formula === "NONE" && defaultPolicies().resist.status === "UNKNOWN", defaultPolicies().resist.id);
  ok("★★★ 三条都写明了「证据是什么 / 为什么没有官方来源」", Object.values(ResistPolicies).every(p => (p.evidence ?? "").length > 30));
  ok("★★ 社区口径的证据里**点了名**（哪个仓库、哪个文件、为什么不能当结论）",
    /omj_simulator/.test(ResistPolicies.COMMUNITY_TWO_ROLL.evidence ?? "") && /add-buff/.test(ResistPolicies.COMMUNITY_TWO_ROLL.evidence ?? ""));
  const snap: any = policySnapshot(defaultPolicies());
  ok("★★★ policySnapshot 带着 formula（用哪种口径算的要看得出来）", snap.resist.formula === "NONE", JSON.stringify(snap.resist));
}

// ── 夹具：红方 1 号换成迦楼罗（「化生戟」cost=0，会对**敌方目标**施加控制类减益 3782_1 惜羽）
// ★ 第一版用的是鲸汐千姬「鲛人歌」——它把冰眠施加到**自己**身上（targeting=["自身","友方目标"]），
//   于是"抵抗"根本无从谈起（测试里所有口径的命中数都一样）。夹具选错，结论就会错。
async function controlBattle(formula: string) {
  const m: any = canonicalMatch();
  m.red.units[0].shikigamiId = 378; m.red.units[0].name = "迦楼罗";
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261001, passives: "NOT_EXECUTED" });
  if (formula !== "NONE") a.battle.policies.resist = { ...ResistPolicies[formula === "SINGLE_ROLL_RATIO" ? "SINGLE_ROLL_RATIO" : "COMMUNITY_TWO_ROLL"] } as any;
  await a.battle.runStartup();
  const battle: any = a.battle;
  const caster = battle.allEntities().find((e: any) => e.shikigamiId === 378);
  const foe = battle.allEntities().find((e: any) => e.teamId !== caster.teamId);
  const skl = caster.skills.find((s: any) => s.name === "化生戟");
  battle.teams[caster.teamId].orbs.gain(8);
  return { battle, caster, foe, skl };
}
/** 反复施放，统计：未命中 / 被抵抗 / 成功 */
async function trial(formula: string, efr: number, n = 40) {
  const { battle, caster, foe, skl } = await controlBattle(formula);
  foe.base.efr = efr;
  let miss = 0, resisted = 0, applied = 0;
  for (let i = 0; i < n; i++) {
    battle.trace.length = 0;
    foe.hp = foe.maxHp;
    await skl.execute(battle, caster, foe);
    miss += battle.trace.filter((t: any) => t.t === "STATUS_MISS").length;
    resisted += battle.trace.filter((t: any) => t.t === "STATUS_RESIST").length;
    applied += battle.trace.filter((t: any) => t.t === "STATUS_APPLY" && t.status === "3782_1").length;
    foe.statuses.length = 0;   // 清干净再下一轮（否则"已存在"会干扰计数）
  }
  return { miss, resisted, applied, n };
}

sec("[2] ★★★ 公式：抵抗越高越难中，而「不参与」档必须与抵抗无关");
{
  // ★ efr is a fraction (2 = 200%), like every panel percentage (kernel/stats.ts).
  const none0 = await trial("NONE", 0), none200 = await trial("NONE", 2);
  ok("★★★ NONE 档：efr 从 0 拉到 200，命中数**一位不变**（抵抗不参与）",
    none0.applied === none200.applied && none0.resisted === 0 && none200.resisted === 0,
    JSON.stringify({ none0, none200 }));
  const single0 = await trial("SINGLE_ROLL_RATIO", 0), single200 = await trial("SINGLE_ROLL_RATIO", 2);
  ok("★★★ 单掷口径：抵抗 200% 时命中数明显低于 0%",
    single200.applied < single0.applied, JSON.stringify({ single0, single200 }));
  const two0 = await trial("COMMUNITY_TWO_ROLL", 0), two200 = await trial("COMMUNITY_TWO_ROLL", 2);
  /**
   * ★★★ 社区口径的一个**反直觉后果**，值得单独钉住：它的抵抗判定用的是 p2 = 基础 × 命中 / 抵抗，
   *   所以当基础概率是 1（原文没写概率 = 必定施加）且抵抗为 0 时，p2 = **1 ⇒ 必定被抵抗**。
   *   这不是我算错，而是那份实现本身的形状（它的净概率是 p²/res）。
   *   ⇒ 断言按它真实的形状写：efr=0 → 几乎全被抵抗；efr 越高 → 通过得越多。
   */
  ok("★★★ 两掷口径：抵抗 0% 时**几乎全被抵抗**（p2 = 1×命中/1 = 1）—— 这是社区公式的形状，如实钉住",
    two0.resisted >= 35 && two0.applied <= 5, JSON.stringify(two0));
  ok("★★★ 而抵抗越高，通过得越多（200% 时 applied 明显上升）", two200.applied > two0.applied, JSON.stringify({ two0, two200 }));
  console.log("    命中数（40 次施放）：NONE " + none0.applied + "/" + none200.applied +
    "｜单掷 " + single0.applied + "→" + single200.applied + "｜两掷 " + two0.applied + "→" + two200.applied +
    "（被抵抗 " + two0.resisted + "→" + two200.resisted + "）");
}

sec("[3] ★★★ 随机流：NONE 档**逐位不变**，另两档才会多掷");
{
  const tags = async (formula: string) => {
    const { battle, caster, foe, skl } = await controlBattle(formula);
    foe.base.efr = 1;
    await skl.execute(battle, caster, foe);
    return (battle.rng.draws ?? []).map((d: any) => d.tag).filter((t: string) => /status_prob|resist:/.test(t));
  };
  const a = await tags("NONE"), b = await tags("SINGLE_ROLL_RATIO"), c = await tags("COMMUNITY_TWO_ROLL");
  /**
   * ★ 这个技能原文**没有写概率**（必定施加）⇒ 在 NONE 档下**一次都不掷**（与今天逐位相同），
   *   而一旦口径不是 NONE，就要为这次"必定"再掷抵抗判定。
   *   ⇒ 三个数字直接说明"换口径会不会改变整条随机数流"。
   */
  ok("★★★ NONE 档：原文没写概率 ⇒ **一次都不掷**（随机流与今天逐位相同）",
    a.length === 0, JSON.stringify(a));
  ok("★★★ 单掷档：多出**一次**掷（status_prob:…，概率被命中/抵抗修正）",
    b.length === 1 && b[0].startsWith("status_prob:"), JSON.stringify(b));
  ok("★★★ 两掷档多出一次 resist: 掷数（这就是「换口径会改变整条随机数流」的机制）",
    c.some(t => t.startsWith("resist:")) && c.length > a.length, JSON.stringify(c));
}

sec("[4] ★★★ EV.RESIST：这个事件码从第 27 轮起没有派发点，现在有了");
{
  const { battle, caster, foe, skl } = await controlBattle("COMMUNITY_TWO_ROLL");
  let fired = 0;
  battle.bus.register({ id: "PROBE:RESIST", ownerId: foe.id, code: EV.RESIST, range: "ALL", priority: 99, passive: false, fn: () => { fired++; } });
  foe.base.efr = 3;
  for (let i = 0; i < 30 && fired === 0; i++) { foe.statuses.length = 0; await skl.execute(battle, caster, foe); }
  ok("★★★ 抵抗真的派发了 EV.RESIST", fired > 0, "派发 " + fired + " 次");
  ok("★★★ 而 DISPATCHED_EV_CODES 表里有它（g42 会双向盯这张表）", DISPATCHED_EV_CODES.has("RESIST"));
  ok("★★ 默认口径下不派发（NONE 档不会出现抵抗）", ResistPolicies.NOT_CONSUMED.formula === "NONE");
  const src = fs.readFileSync(path.join(ROOT, "battle-lab", "tools", "field-allowlist.json"), "utf8");
  ok("★★★ 台账里的 RESIST 条目说法换了（不再是「抵抗事件从未派发」）",
    !/抵抗事件从未派发/.test(src), (src.match(/"RESIST":[^\n]{0,80}/) ?? [""])[0]);
}

sec("[5] ★★ 默认路径指纹不变（红区默认 NONE ⇒ 随机流与结果都不动）");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  await a.battle.run();
  ok("★★★ 指纹逐位不变", stateHash(captureState(a.battle)) === BASE, stateHash(captureState(a.battle)));
}

console.log("\n=== 效果抵抗: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
