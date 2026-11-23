// tests/g99-source-bearer.ts — ★★★ 第 176 轮：**逐句承受者归属**（「对伤害来源 / 攻击者附加…」）
//
// 缺口清单里那条的第二步（接线）与第三步（验证）。第 175 轮的尺子（g98）已经钉住：
//   族 = 窄口径 17 个技能、「状态落到来源」9 条；现状是「一个少算（九命猫装都不装）+ 一个算错
//   （天照装上了但承受者来自技能级 targeting）"；三个触发点的载荷里都拿得到来源。
//
// 本轮实现三处：① 编译期 SkillIR.sourceBearerRefs（逐句证据，fail-closed）
//   ② 执行侧 compile/character.ts 的 damageSourceOf（三个触发点各一条路径，取不到就不施加 + 留痕）
//   ③ 被动运行时放行第 129 轮那道「阵亡族 + 伤害来源」闸门（前提：这一句的每个 buff 引用都有来源证据）
import fs from "node:fs";
import path from "node:path";
import { DamageType } from "../kernel/types.ts";
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
const irOf = (k: string) => irs.find(x => x.key === k)!.ir;

async function mk(name: string, passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", seed = 20261013) {
  const s = KB.find((x: any) => x.name === name);
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name };
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives });
  await a.battle.runStartup();
  return a;
}
const has = (e: any, id: string) => (e?.statuses ?? []).some((s: any) => String(s.def?.id ?? "") === id);

sec("[1] ★★★ 编译侧：逐句证据收进 IR（fail-closed：引用解析不出的不收）");
{
  const withField = irs.filter(x => (x.ir.sourceBearerRefs ?? []).length > 0);
  const keys = withField.map(x => x.key).sort();
  console.log("  名单：" + withField.map(x => x.key + "→" + x.ir.sourceBearerRefs.map((b: any) => b.ref).join(",")).join(" · "));
  ok("★★★ 带来源承受者证据的技能 = 8 条，且与探针名单逐条一致",
    keys.join(",") === "207/207_02,208/208_02,232/232_02,249/249_02,285/285_02,306/306_02,346/346_01,556/556_02", keys.join(","));
  ok("★★★ 每条证据都带**原句**（判错时要能一眼看出照哪句话判的）",
    withField.every(x => x.ir.sourceBearerRefs.every((b: any) => b.clause.length > 6 && /来源|攻击者/.test(b.clause))));
  ok("★★★ 反例：匣中少女「溢彩」写的是「为攻击者附加1个随机减益」—— 没有具体 buff 引用 ⇒ **一个字都不写**",
    !(irOf("287/287_02").sourceBearerRefs ?? []).length && /随机减益|tips_201/.test(JSON.stringify(irOf("287/287_02").statusRefs ?? []) + String((KB.find((c: any) => c.id === 287)?.skills ?? []).find((s: any) => s.id === "287_02")?.description ?? "")));
  const statusSkills = irs.filter(x => (x.ir.statusRefs ?? []).length > 0).length;
  ok("★★ 而全库带状态引用的技能远多于此（" + statusSkills + " 条）—— 说明这条字段是**逐句窄口径**，不是「给所有状态引用加标记」",
    statusSkills > 100, String(statusSkills));
}

sec("[2] ★★★ 天照「无灭」：以前是「装上了但目标不对」，现在落在**攻击者**身上");
{
  const a = await mk("天照", "PARSED_CANDIDATES_ONLY");
  const b = a.battle;
  const all = b.allEntities();
  const self = all.find((e: any) => e.teamId === 0)!;
  const foes = all.filter((e: any) => e.teamId === 1);
  const attacker = foes[0];
  ok("前置：天照的被动装上了（受击族）", (b.passiveReport?.installed ?? []).some((x: any) => x.skill === "无灭"),
    JSON.stringify((b.passiveReport?.installed ?? []).map((x: any) => x.skill)));
  await b.damage(attacker, self, 100, DamageType.NORMAL, 1);
  ok("★★★ 状态落在**攻击者**身上", has(attacker, "5562_1"), JSON.stringify({ who: attacker.id, got: (attacker.statuses ?? []).map((s: any) => s.def?.id) }));
  const wrong = foes.filter((e: any) => e.id !== attacker.id && has(e, "5562_1"));
  ok("★★★ 其他敌人一个都没拿到（旧的技能级 targeting 就是在这里算错的）", wrong.length === 0, JSON.stringify(wrong.map((e: any) => e.id)));
}

sec("[3] ★★★ 反例：被动档下拿不到来源 ⇒ **不施加**并留痕（主动施放这条技能就是这种情况）");
{
  const a = await mk("鸩", "PARSED_CANDIDATES_ONLY");
  const b = a.battle;
  const all = b.allEntities();
  const self = all.find((e: any) => e.teamId === 0)!;
  const foe = all.find((e: any) => e.teamId === 1)!;
  const sk = (self.skills ?? []).find((s: any) => String(s.ir?.id ?? "") === "285_02");
  ok("前置：鸩装着 285_02「毒之华」，且它的状态引用带来源证据",
    !!sk && (sk.ir.sourceBearerRefs ?? []).length > 0, JSON.stringify(sk?.ir?.sourceBearerRefs ?? null));
  await sk.execute(b, self, foe);
  const skip = b.trace.find((t: any) => t.t === "STATUS_BEARER_SKIPPED");
  ok("★★★ 主动施放（没有事件载荷）⇒ 留痕 STATUS_BEARER_SKIPPED / NO_DAMAGE_SOURCE",
    skip?.ref === "2852_1" && skip?.reason === "NO_DAMAGE_SOURCE", JSON.stringify(skip));
  const foeStatuses = all.filter((e: any) => e.teamId === 1)
    .map((e: any) => ({ id: e.id, got: (e.statuses ?? []).map((s: any) => s.def?.id) }));
  ok("★★★ 而且**没有任何敌人**拿到 2852_1 —— 宁可少算，不许算错",
    foeStatuses.every((x: any) => !x.got.includes("2852_1")), JSON.stringify(foeStatuses));
}

sec("[4] ★★★ 反向：默认档（被动 OFF）**一个字都不变** —— 红区 E 的行为面钉子（指纹由 g43/g54/g78 守）");
{
  const a = await mk("天照", "NOT_EXECUTED");
  ok("★★ 默认档没有装任何被动处理器", (a.battle.passiveReport?.installed ?? []).length === 0,
    JSON.stringify((a.battle.passiveReport?.installed ?? []).length));
  ok("★★ 也没有任何 STATUS_BEARER_SKIPPED 痕（那条路径根本没跑到）",
    !a.battle.trace.some((t: any) => t.t === "STATUS_BEARER_SKIPPED"));

  /**
   * ★★★ 这一条是**红区 E** 的行为面钉子：默认档下，主动施放一条写着"来源子句"的技能，
   *   状态**照旧按技能级 targeting 施加**（与第 176 轮之前逐位相同）——
   *   第一版没有这道被动档闸门，实测指纹从 2d7c7507e18db61f 变成了 ebe69db360755da9，
   *   被 g43 / g54 / g78 三条断言当场照出来。
   */
  const b = await mk("鸩", "NOT_EXECUTED");
  const all = b.battle.allEntities();
  const self = all.find((e: any) => e.teamId === 0)!;
  const foe = all.find((e: any) => e.teamId === 1)!;
  const sk = (self.skills ?? []).find((s: any) => String(s.ir?.id ?? "") === "285_02");
  await sk.execute(b.battle, self, foe);
  ok("★★★ 默认档：**没有** STATUS_BEARER_SKIPPED 痕（闸门没开）",
    !b.battle.trace.some((t: any) => t.t === "STATUS_BEARER_SKIPPED"),
    JSON.stringify(b.battle.trace.filter((t: any) => t.t === "STATUS_BEARER_SKIPPED")));
  ok("★★★ 而且状态照旧落在技能级范围上（敌方拿到了 2852_1）—— 与接线前逐位相同",
    all.filter((e: any) => e.teamId === 1).some((e: any) => has(e, "2852_1")),
    JSON.stringify(all.filter((e: any) => e.teamId === 1).map((e: any) => (e.statuses ?? []).map((s: any) => s.def?.id))));
}

console.log("\n=== 逐句承受者归属: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
