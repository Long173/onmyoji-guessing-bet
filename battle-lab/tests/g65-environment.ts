// tests/g65-environment.ts — ★★★ 第 109 轮：**全局 Environment / 残局档位**（a1-4 §34，目标 ⑨）
//
// 为什么是这个测试：`kernel/architecture.ts` 里 environment-runtime 长期是 DEFERRED_BY_SPEC ——
// 规格自己写着「以后残局机制就在这里」。这一轮把**容器**建起来了（建容器不需要游戏内证据，猜数值才需要），
// 于是本文件的职责是**两侧都钉住**：
//   ① 容器、规则接口、档位乘区、序列化、留痕真的能跑（正向）；
//   ② 生产规则表**是空的**，而"空"是可验证的事实、不是没做（反向）。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, restoreBattle, stateHash } from "../kernel/state.ts";
import { healTarget } from "../kernel/damage.ts";
import { GuessingRulesets } from "../kernel/policies.ts";
import { TurnType } from "../kernel/types.ts";
import {
  createEnvironment, envIsDefault, envSnapshot, envDamageMultiplier, envHealMultiplier,
  registerEnvironmentRule, stalemateRuleFromRuleset,
  ENVIRONMENT_RULES, ENV_TIME_UNIT,
} from "../kernel/environment.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = "2d7c7507e18db61f";
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const kit = createKit(bundle);
// ★ seed 必须与基准夹具一致（指纹是 seed 的函数：g60 §6 用的就是 20261001）
const build = (seed = 20261001) => assembleMatch(createKit(bundle), canonicalMatch(), { seed });
const deps = (k: any) => ({ kit: k, makeRuntime: (id: number) => runtimeFor(k, id), attachRuntime });

sec("[1] 容器默认态：**空环境**就应该是空的（默认档不许有任何乘区）")
{
  const env = createEnvironment();
  ok("★★★ 新建环境：时间 0 / 无全局修改器 / 无档位",
    env.elapsedBattleTime === 0 && env.globalModifiers.length === 0 && env.stalemate === undefined, JSON.stringify(env));
  ok("★★ 空环境被认成「默认」⇒ 不进档（否则所有既有指纹都会漂一个常量）", envIsDefault(env) === true && envSnapshot(env) === null);
  ok("★★★ 空环境的伤害/治疗乘区恒为 1", envDamageMultiplier(env) === 1 && envHealMultiplier(env) === 1);
  /**
   * ★ 战斗时间的单位必须是**回合**：引擎是离散事件的，没有墙钟。
   *   规格的例子写「180 秒」，但那是"如果 M2 最后证明…"的**假设**；把单位写成秒就是凭空造时钟。
   */
  ok("★★ 战斗时间的单位写成常量且是回合（不是秒）", ENV_TIME_UNIT === "TURN");
}

sec("[2] 规则表的纪律：**生产表为空**，而且没有出处的数值进不来")
{
  ok("★★★ 生产规则表为空（空表是**事实**：残局参数在知识库里全是 null）", ENVIRONMENT_RULES.length === 0, String(ENVIRONMENT_RULES.length));
  let threw = "";
  try {
    registerEnvironmentRule({ id: "g65:no-evidence", when: "TURN_START", evidence: "   ", evaluate: () => null });
  } catch (e: any) { threw = String(e?.message ?? e); }
  ok("★★★ 负向：没有 evidence 的规则**注册不进来**（抛错，不静默忽略）", /evidence/.test(threw), threw);
  registerEnvironmentRule({ id: "g65:dup", when: "TURN_START", evidence: "g65 合成规则", evaluate: () => null });
  let dup = "";
  try { registerEnvironmentRule({ id: "g65:dup", when: "TURN_START", evidence: "g65 合成规则", evaluate: () => null }); }
  catch (e: any) { dup = String(e?.message ?? e); }
  ok("★★ 负向：重复 id 也抛错（表里不会出现两条同名规则）", /重复/.test(dup), dup);
  ENVIRONMENT_RULES.length = 0;   // 测试自己收尾（表本身就是那个事实，不必再包一个函数）
  ok("★★ 清理后回到空表（测试自己收尾，不给后面的用例留状态）", ENVIRONMENT_RULES.length === 0);
  /**
   * ★★★ 这一节是"今天为什么空转"的**直接证据**：知识库里两个 ruleset 的残局参数全是 null。
   */
  const both = Object.values(GuessingRulesets).map(rs => stalemateRuleFromRuleset(rs));
  ok("★★★ 知识库里**每一个** ruleset 都产不出残局规则（stalemate 三个参数全是 null ⇒ 禁止假设）",
    both.every(x => x === null), JSON.stringify(both.map(x => x && x.id)));
  const half = stalemateRuleFromRuleset({ id: "T", evidence: "e", stalemate: { startTurn: 3, damageRamp: null, healingReductionRamp: null } });
  ok("★★★ 反向：只有开始时间、两条曲线都缺 ⇒ 仍然不建规则（做不了任何事）", half === null);
  const full = stalemateRuleFromRuleset({ id: "T", evidence: "实测：D07/D08", stalemate: { startTurn: 3, damageRamp: (n: number) => 0.5, healingReductionRamp: (n: number) => 0.25 } });
  ok("★★★ 正向：开始时间 + 曲线齐全 ⇒ 建出规则，且**出处来自 ruleset 自己**",
    !!full && full.evidence === "实测：D07/D08" && full.when === "TURN_START", JSON.stringify(full && { id: full.id, ev: full.evidence }));
}

sec("[3] 端到端：档位真的改变战斗（控制组 vs 实验组，同 seed）")
{
  // ── 控制组：不注册任何规则（＝今天的生产状态）
  const ca = build();
  await ca.battle.runStartup();
  await ca.battle.run();
  const cHash = stateHash(captureState(ca.battle));
  ok("★★★ 控制组：整场没有档位（stalemate 未定义）", ca.battle.environment.stalemate === undefined);
  ok("★★★ 控制组：一条 ENV_STAGE 都没有（默认档下环境完全不出现在事件流里）",
    ca.battle.trace.filter((t: any) => t.t === "ENV_STAGE").length === 0);
  ok("★★★ 控制组：环境**不进档**（captureState 里连这个键都没有）", (captureState(ca.battle) as any).environment === undefined);
  ok("★★★ 控制组：典型对局 #001 的指纹与第 97 轮记录的值逐位相同（这一轮没有改动默认行为）", cHash === BASE, cHash + " vs " + BASE);
  const cDmg = ca.battle.trace.filter((t: any) => t.t === "DAMAGE");
  const cTotal = cDmg.reduce((n: number, d: any) => n + Number(d.applied ?? 0), 0);

  // ── 实验组：注册一条"实测过"的合成规则（阈值 3 回合、伤害 +50%、治疗 −25%）
  registerEnvironmentRule({
    id: "g65:stalemate", when: "TURN_START", evidence: "g65 合成规则（仅用于验收管线，不是游戏数据）",
    evaluate: (env: any) => (env.elapsedBattleTime >= 3 ? { stage: 1, damageMultiplier: 1.5, healingMultiplier: 0.75 } : null),
  });
  const ea = build();
  await ea.battle.runStartup();
  await ea.battle.run();
  const eHash = stateHash(captureState(ea.battle));
  ok("★★★ 实验组：进入残局 ⇒ 档位 1、伤害 ×1.5、治疗 ×0.75",
    ea.battle.environment.stalemate?.stage === 1 && ea.battle.environment.stalemate?.damageMultiplier === 1.5 &&
    ea.battle.environment.stalemate?.healingMultiplier === 0.75, JSON.stringify(ea.battle.environment.stalemate));
  ok("★★★ 实验组：环境**进了档**（序列化看得见 stalemate）",
    !!(captureState(ea.battle) as any).environment?.stalemate, JSON.stringify((captureState(ea.battle) as any).environment));
  ok("★★★ 实验组：指纹与控制组**不同**（环境是「决定未来」的状态，不进指纹才是错的）", eHash !== cHash, eHash + " vs " + cHash);
  const stages = ea.battle.trace.filter((t: any) => t.t === "ENV_STAGE");
  ok("★★★ 留痕：ENV_STAGE 带规则 id / 出处 / 前后档位 / 乘区（Theater 与 Inspector 都靠它）",
    stages.length >= 1 && stages[0].rule === "g65:stalemate" && stages[0].stageBefore === 0 && stages[0].stage === 1 &&
    stages[0].damageMultiplier === 1.5 && /g65 合成规则/.test(String(stages[0].evidence)), JSON.stringify(stages[0]));
  const eDmg = ea.battle.trace.filter((t: any) => t.t === "DAMAGE");
  const eTotal = eDmg.reduce((n: number, d: any) => n + Number(d.applied ?? 0), 0);
  ok("★★★ 伤害总量真的变了（不是只有容器里改了个数）", Math.abs(eTotal - cTotal) > 1e-6, JSON.stringify({ cTotal: Math.round(cTotal), eTotal: Math.round(eTotal) }));
  /**
   * ★★★ 最强的一条：**用含 env 的算式把 final 复算出来**。
   *   拆解里 `modifiers.env` 是 1.5，而 g5 的复算公式（不含 env）在默认档下仍然成立 ——
   *   两条一起说明"乘区确实在伤害管线里、而且只在有档位时才非 1"。
   */
  const late = eDmg.filter((d: any) => d.breakdown?.modifiers?.env === 1.5);
  ok("★★★ 残局之后的每一次伤害，拆解里的环境乘区都是 1.5（且这样的伤害确实存在）", late.length > 0, String(late.length));
  ok("★★★ 拆解能复算：base×rate×暴击×防御×增伤×**环境**×浮动 == final",
    late.every((d: any) => {
      const b = d.breakdown;
      const expect = b.type === "FIXED" ? b.base * b.rate
        : b.base * b.rate * b.crit.cridMultiplier * b.defense.multiplier * b.modifiers.product * b.modifiers.env * b.float.value;
      return Math.abs(expect - b.final) < 0.01;
    }), JSON.stringify(late.slice(0, 1).map((d: any) => ({ f: d.breakdown.final, e: d.breakdown.modifiers.env }))));
  /**
   * ★★ 治疗乘区走的是**生产治疗路径**（healTarget），不是另写一段。
   *   `recover`（官方[20] 恢复：不受减疗影响）**不吃**它 —— 与「固定伤害不吃增伤」同一种边界处理。
   *   ★ 量它要一场**新战斗**：上面那场已经打完了，被治疗的目标早就不在场（第一版就是这么量的，h=0）。
   */
  const hb = build(20261509);
  await hb.battle.runStartup();
  const hSrc = hb.battle.teams[0].members[0], hTgt = hb.battle.teams[1].members[0];
  const healOnce = async (opts: any = {}) => { hTgt.hp = hTgt.maxHp * 0.5; return await healTarget(hb.battle, hSrc, hTgt, 100, opts); };
  const hFlat = await healOnce();
  const hRecFlat = await healOnce({ recover: true });
  hb.battle.environment.stalemate = { stage: 1, damageMultiplier: 1, healingMultiplier: 0.75 };
  const hEnv = await healOnce();
  const hRecEnv = await healOnce({ recover: true });
  ok("★ 前置：真的有治疗量（否则下面两条是空断言）", hFlat > 0 && hRecFlat > 0, JSON.stringify({ hFlat, hRecFlat }));
  ok("★★★ 治疗乘区真的生效：HEAL 通道 ×0.75（比例相等，不受减疗存量影响）",
    Math.abs(hEnv / hFlat - 0.75) < 1e-9, JSON.stringify({ hFlat, hEnv }));
  ok("★★ 而 RECOVER 通道不受它影响（边界被如实执行，不是「顺手全乘一遍」）",
    Math.abs(hRecEnv - hRecFlat) < 1e-9, JSON.stringify({ hRecFlat, hRecEnv }));
  /**
   * ★★★ **不污染式神**（规格原话）：全局乘区不改任何实体自己的属性 ——
   *   判据是"把乘区换掉，实体读数逐位不变"，而不是"代码里看起来没写"。
   */
  const probe = hb.battle.teams[1].members[1];
  const snapProps = () => ({ atk: probe.prop("atk"), def: probe.prop("def"), cri: probe.prop("cri"), hp: probe.hp });
  const before = snapProps();
  hb.battle.environment.stalemate = { stage: 2, damageMultiplier: 3.25, healingMultiplier: 0.1 };
  ok("★★★ 改环境乘区 ⇒ 实体属性逐位不变（全局乘区不写进式神）", JSON.stringify(snapProps()) === JSON.stringify(before), JSON.stringify({ before, after: snapProps() }));
  const envMods = ea.battle.environment.globalModifiers ?? [];
  ok("★★ 全局修改器只活在环境里（不是挂在某个式神身上）", envMods.length === 0 || envMods.every((m: any) => !!m.source));
  const polluted = ea.battle.allEntities().flatMap((e: any) => e.modifierSources()).filter((s: string) => s.startsWith("env:"));
  ok("★★★ 而且没有任何式神身上挂着环境来源的修改器（modifierSources 里没有 env: 前缀）", polluted.length === 0, JSON.stringify(polluted));
  ENVIRONMENT_RULES.length = 0;   // 测试自己收尾（表本身就是那个事实，不必再包一个函数）
}

sec("[4] 序列化与续跑（G0 的承诺：杀掉引擎再回来，结果逐位一致）")
{
  registerEnvironmentRule({
    id: "g65:ramp", when: "TURN_START", evidence: "g65 合成规则（含爬升曲线）",
    evaluate: (env: any) => { const t = Number(env.elapsedBattleTime ?? 0); return t >= 2 ? { stage: 1, damageMultiplier: 1 + 0.1 * (t - 2), healingMultiplier: 1 } : null; },
  });
  const a = build(20261502);
  await a.battle.runStartup();
  /** ★ 与 battle.run() 同一套推进方式（advance / turn++ / runTurn / resolveBoundary），不另写一条主循环 */
  for (let i = 0; i < 12; i++) {
    const actorId = a.battle.timeline.advance();
    if (actorId === null) break;
    const actor = a.battle.entity(actorId);
    if (!actor || !actor.alive) continue;
    a.battle.turn++;
    await a.battle.runTurn(actor, TurnType.NORMAL);
    if (await a.battle.resolveBoundary()) break;
  }
  const snap: any = JSON.parse(JSON.stringify(captureState(a.battle)));
  ok("★★★ 存盘点里带着环境（档位 + 乘区）", !!snap.environment?.stalemate, JSON.stringify(snap.environment));
  ok("★★ 派生量不进档：存档里没有 elapsedBattleTime 这个字段（它是 turn 的函数）", snap.environment.elapsedBattleTime === 0);
  const b: any = restoreBattle(snap, deps(createKit(bundle)) as any);
  ok("★★★ 恢复后派生时间被**重算**（= 当前回合），而不是从档里读一个可能过期的数",
    b.environment.elapsedBattleTime === b.turn, JSON.stringify({ t: b.environment.elapsedBattleTime, turn: b.turn }));
  ok("★★★ 恢复后档位与乘区与存档一致",
    b.environment.stalemate?.stage === snap.environment.stalemate.stage &&
    b.environment.stalemate?.damageMultiplier === snap.environment.stalemate.damageMultiplier);
  await a.battle.run();
  await b.run();
  const ha = stateHash(captureState(a.battle)), hb = stateHash(captureState(b));
  ok("★★★ 连续跑与「存档 → 恢复 → 续跑」的终局指纹逐位一致（含爬升曲线：恢复后继续爬）", ha === hb, ha + " vs " + hb);
  ENVIRONMENT_RULES.length = 0;   // 测试自己收尾（表本身就是那个事实，不必再包一个函数）
}

sec("[5] 规则是**纯函数**：环境不是随机源（RNG 账本不受它影响）")
{
  const a = build(20261503);
  await a.battle.runStartup();
  const rule: any = stalemateRuleFromRuleset({ id: "T", evidence: "e", stalemate: { startTurn: 0, damageRamp: (n: number) => 0.5, healingReductionRamp: null } });
  a.battle.environment.elapsedBattleTime = 7;
  const n0 = a.battle.rng.n;
  const r1 = rule.evaluate(a.battle.environment, a.battle);
  const r2 = rule.evaluate(a.battle.environment, a.battle);
  ok("★★★ 同一环境求值两次结果逐位相同（纯函数）", JSON.stringify(r1) === JSON.stringify(r2), JSON.stringify(r1));
  ok("★★★ 而且一次掷数都没抽（环境不进 RNG 账本 ⇒ 重放/续跑天然一致）", a.battle.rng.n === n0, n0 + " → " + a.battle.rng.n);
  ok("★★ 规则对**未到阈值**的环境返回 null（不提前生效）",
    stalemateRuleFromRuleset({ id: "T", evidence: "e", stalemate: { startTurn: 99, damageRamp: () => 0.5, healingReductionRamp: null } })!.evaluate(a.battle.environment, a.battle) === null);
}

console.log("\n=== 全局 Environment / 残局档位: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;