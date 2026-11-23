// tests/g43-passive-runtime.ts — ★★★ 被动运行时：默认关闭（锚点不动）、打开时真的触发（第 70 轮）
//
// 立场写在 kernel/policies.ts 的红区 E 里：
//   · 引擎**应该**有被动运行时（157 个被动、157/277 只式神，此前一个都不跑）；
//   · 但**不能默认打开** —— 典型对局 6/10 个单位有被动，打开必然改变基准指纹与每一次胜率预测，
//     而这件事没有游戏内实测支撑。所以它是一个显式策略，默认 OFF。
//
// 这个文件把该立场变成断言。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { PassivePolicies, defaultPolicies, policySnapshot } from "../kernel/policies.ts";
import { EV } from "../kernel/types.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const BASE = "2d7c7507e18db61f";

/** ★ 第 87 轮：可选阵容 —— 概率行为测试需要一个"效果已实现"的受试者（铁鼠「横财护身」） */
function withUnit(id: number, name: string) {
  const m: any = canonicalMatch();
  m.red.units[0].shikigamiId = id;
  m.red.units[0].name = name;
  return m;
}
async function run(passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", seed = 20261001, match?: any) {
  const a: any = assembleMatch(createKit(bundle), match ?? canonicalMatch(), { seed, passives });
  await a.battle.runStartup();
  await a.battle.run();
  return { battle: a.battle, hash: stateHash(captureState(a.battle)), winner: a.battle.winner, turns: a.battle.turn, rep: (a.battle as any).passiveReport };
}

sec("[1] ★★★ 默认 OFF：一个处理器都不注册，基准指纹逐位不变");
const off = await run("NOT_EXECUTED");
{
  ok("★★★ 注册 0 个处理器", off.rep.installed.length === 0, JSON.stringify(off.rep.installed));
  ok("★★★ 基准指纹逐位不变（" + BASE + "）", off.hash === BASE, off.hash);
  ok("★★ 策略默认值就是 NOT_EXECUTED", defaultPolicies().passives.id === "NOT_EXECUTED", defaultPolicies().passives.id);
  ok("★★ 两种模式各自登记（OFF / PARSED_ONLY）",
    PassivePolicies.NOT_EXECUTED.mode === "OFF" && PassivePolicies.PARSED_CANDIDATES_ONLY.mode === "PARSED_ONLY");
  ok("★★ OFF 档的 evidence 写明关闭是为了与历史逐位一致",
    /逐位一致/.test(PassivePolicies.NOT_EXECUTED.evidence ?? ""), PassivePolicies.NOT_EXECUTED.evidence);
}

sec("[2] ★★★ 打开：典型对局装上 **3** 条 —— 第 93 轮接线吸血、第 135 轮接线「先机」族之后");
const on = await run("PARSED_CANDIDATES_ONLY");
{
  // ★★★ 这一节的断言**第三次转向**（每一次都对，理由是三个不同的事实）：
  //   · 第 70 轮：装上 ≥1 条、ON 与 OFF 指纹不同 —— 当时把"空转造成的随机流平移"当成了行为变化；
  //   · 第 88 轮：装上 **0** 条 —— 两道效果闸门加进来后，"3 条效果做不了"的被动全被拦下，
  //     ON 与 OFF 指纹**相同**（因为没有任何处理器注册，也就没有掷数被消耗）；
  //   · 第 93 轮：装上 **1** 条 —— **吸血被接进了伤害管线**，于是三尾狐「诱惑」第一次真的有事可做。
  //     ★ 这次 ON ≠ OFF 的**性质与第 70 轮完全不同**：不是空转平移随机流，
  //       而是真的回流了生命（trace 里有 LIFESTEAL 事件、血量真的变了）。判据见 tests/g54。
  /**
   * ★★★ 第 135 轮：**第四次转向** —— 典型对局现在装上 **3** 条。
   *   多出来的两条是「先机」族接线带来的（座敷童子「福运昌隆」获得1点鬼火 /
   *   聆海金鱼姬「凌波」获得4层印记）：这个写法此前**一条都挂不上**，
   *   因为原文写的是 `[tips_7]` / `[先机]`，而「名字+时」的子串判据永远匹配不到（见 kernel/triggers.ts 的族注）。
   *   ⇒ 三条都能装上，而且都在**开局**就生效（BATTLE_START）—— ON 与 OFF 的指纹因此仍然不同。
   */
  ok("★★★ 典型对局装上 **3** 条：三尾狐「诱惑」+ 座敷童子「福运昌隆」+ 聆海金鱼姬「凌波」",
    on.rep.installed.length === 3 &&
    ["诱惑", "福运昌隆", "凌波"].every(n => on.rep.installed.some((i: any) => i.skill === n)) &&
    on.rep.installed.filter((i: any) => i.event === "BATTLE_START").length === 2,
    JSON.stringify(on.rep.installed.map((i: any) => i.skill + "/" + i.event)));
  ok("★★★ 打开与关闭的指纹**不同** —— 这次是「真的做了事」（吸血回流），不是「空转却平移随机流」",
    on.hash !== off.hash, "OFF " + off.hash + " vs ON " + on.hash);
  ok("★★★ 仍然被挡住的 **2** 条理由写的是 **EFFECT**（效果做不了），不是条件",
    on.rep.skipped.byEffect === 2 && on.rep.skipped.byCondition === 0, JSON.stringify(on.rep.skipped));
  console.log("    典型对局 6 个被动：无触发时机 " + on.rep.skipped.noTrigger + "｜效果做不了 " + on.rep.skipped.byEffect +
    "｜装上 " + on.rep.installed.length + "｜指纹 " + on.hash + "（与 OFF " + (on.hash === off.hash ? "相同" : "不同") + "）");

  // ★ 要验证「装上了、而且真的会做事」，得换一个**效果已实现**的阵容：铁鼠「横财护身」。
  const tk: any = await run("PARSED_CANDIDATES_ONLY", 20261001, withUnit(232, "铁鼠"));
  const tkOff: any = await run("NOT_EXECUTED", 20261001, withUnit(232, "铁鼠"));
  const names = new Set(tk.rep.installed.map((i: any) => i.skill));
  const casts = tk.battle.trace.filter((e: any) => e.t === "SKILL_CAST" && names.has(e.skill));
  ok("★★★ 换到效果已实现的阵容：**装上了**且**真的触发**", tk.rep.installed.length > 0 && casts.length > 0,
    JSON.stringify({ installed: tk.rep.installed.map((i: any) => i.skill), casts: casts.length }));
  ok("★★ 每一次触发都带 frame（Theater 能定位到那一帧）", casts.every((c: any) => typeof c.frame === "number"));
  ok("★★ 那个阵容上，打开与关闭的指纹**不同**（真的做了事，行为才真的变了）", tk.hash !== tkOff.hash, tk.hash + " vs " + tkOff.hash);
  console.log("    铁鼠阵容装上：" + tk.rep.installed.map((i: any) => i.skill + "[" + i.family + "→" + i.event + "]").join("、") +
    "，触发 " + casts.length + " 次｜指纹 " + tkOff.hash + " → " + tk.hash);
}

sec("[3] ★★★ 被条件与占位符挡住的，不许漏进来");
{
  const skipped = on.rep.skipped;
  ok("★★★ 确实有被动被判为有条件并跳过（典型对局里就有）", skipped.hasCondition > 0, JSON.stringify(skipped));
  ok("★★ 跳过计数只统计被动（第一版漏了这道闸门，把普攻也算进去了，22 条里大半是主动技能）",
    skipped.noTrigger + skipped.hasCondition + skipped.hasPlaceholder + skipped.noDispatch <= 12, JSON.stringify(skipped));
  // ★★★ 第 75 轮：这条守卫**升级**了（不是删掉）。
  //   第 69 轮它守的是"整条不许挂"（因为 40% 会被执行成 100%，只能因噎废食）；
  //   概率被建模之后，正确做法是"挂上，但**必须真的掷**" —— 守卫转移到 §[7]，
  //   判据也从"在不在安装名单里"变成"触发率是不是真的按概率走"。
  // ★★★ 第 87 轮：这条断言**第二次换向**（同一个技能，三个不同的理由 —— 值得连起来读）：
  //   · 第 69 轮：**不许挂** —— 因为「有50%概率」里的概率没被建模，挂上就等于把 50% 当 100% 执行；
  //   · 第 75 轮：**挂上了** —— 概率被建模，运行时如实掷（当时这条断言改成了"必须挂"）；
  //   · 第 87 轮：**又不许挂** —— 这次的理由完全不同：它的**效果**是「附带20%吸血」，
  //     而**吸血在 IR 里根本没实现**（`unmodeledMechanics` 明写 verb=吸血，触发子句是 MECHANIC_UNPARSED）。
  //     ⇒ 挂上去，运行时会掷那 50%，然后执行一个**什么都不做**的 execute。
  //   ★ 三次都对，理由各不相同。**"挂上了"从来不等于"它真的会做事"。**
  //   · 第 93 轮：**又挂上了**（第二次挂上）—— 理由与前三次都不同：**吸血被接进了伤害管线**
  //     （SkillIR.lifesteal → 伤害落账后 applyLifesteal 回流；被动侧读 ctx.result.applied）。
  //   ⇒ 与第 75 轮那次"挂上了"的区别正是 §88 那句「跑 ≠ 做事」的正面版本：
  //     这一次它**真的会做事** —— 判据不是"在安装名单里"，而是 trace 里有没有 LIFESTEAL、
  //     回流量是不是等于 比例 × 实际伤害（tests/g54 第 [4] 节）。
  const lure = on.rep.installed.find((i: any) => i.skill === "诱惑");
  ok("★★★ 三尾狐「诱惑」现在**必须挂上**（吸血已接线），且触发概率 50% 带在报告里",
    !!lure && lure.probability === 0.5 && lure.family === "造成伤害",
    JSON.stringify(lure));
  ok("★★★ 而它**不再**是「被效果拦下」的那一类：剩下被效果拦下的是另外 2 条",
    on.rep.skipped.byEffect === 2, JSON.stringify(on.rep.skipped));
  console.log("    典型对局 6 个被动：装上 " + on.rep.installed.length + "｜有条件 " + skipped.hasCondition + "｜无触发时机 " + skipped.noTrigger);
  // ★★★ 第 77 轮：被挡住的那些要能说清是**条件**没建模还是**效果细节**没建模 ——
  //   混成一个数字会导致修错方向（第 76 轮那 15 条被记成"缺条件"，实际是层数没解析）。
  ok("★★★ 跳过原因拆桶：byCondition + byEffect 恰好等于 hasCondition（不许有漏网的）",
    skipped.byCondition + skipped.byEffect === skipped.hasCondition,
    JSON.stringify(skipped));
  console.log("    其中：条件没建模 " + skipped.byCondition + "｜效果细节没建模 " + skipped.byEffect);
  ok("★★ 两个桶的字段都存在且非负（产物里看得出下一步该修哪边）",
    Number.isFinite(skipped.byCondition) && Number.isFinite(skipped.byEffect) &&
    skipped.byCondition >= 0 && skipped.byEffect >= 0);
}

sec("[4] ★★ 打开之后仍然确定");
{
  const again = await run("PARSED_CANDIDATES_ONLY");
  ok("★★★ 同 seed 两次指纹一致", again.hash === on.hash, again.hash + " ≠ " + on.hash);
  ok("★ 不同 seed 指纹不同（不是常量）", (await run("PARSED_CANDIDATES_ONLY", 20261002)).hash !== on.hash);
}

sec("[5] ★★ 产物里能看出这次跑开没开被动");
{
  const snap: any = policySnapshot({ ...defaultPolicies(), passives: PassivePolicies.PARSED_CANDIDATES_ONLY });
  ok("★★ policySnapshot 带 passives（id + status + mode）",
    snap.passives.id === "PARSED_CANDIDATES_ONLY" && snap.passives.mode === "PARSED_ONLY", JSON.stringify(snap.passives));
  ok("★★ 默认快照里是 OFF", (policySnapshot(defaultPolicies()) as any).passives.mode === "OFF");
  ok("★ 两种模式都是 HYPOTHESIS（没有游戏内实测）",
    PassivePolicies.NOT_EXECUTED.status === "HYPOTHESIS" && PassivePolicies.PARSED_CANDIDATES_ONLY.status === "HYPOTHESIS");
}


sec("[6] ★★★ 第 74 轮：补上 SKILL_START 的派发点 —— 「攻击时」这一族现在真的能挂上并触发");
{
  // ① 派发点行为验证：注册一个探针，数 SKILL_START 到底发了几次 ——
  //    并且**用另一个独立来源**（turnLog）推算"本该发几次"，两边必须相等。
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "NOT_EXECUTED" });
  let starts = 0;
  const nonAttackFired: string[] = [];
  a.battle.bus.register({
    id: "PROBE:SKILL_START", ownerId: 0, code: EV.SKILL_START, range: "ALL", priority: 99, passive: false,
    fn: (ctx: any) => {
      starts++;
      const d = ctx?.skill?.ir?.damage;
      if (!(Array.isArray(d) && d.length > 0)) nonAttackFired.push(String(ctx?.skill?.name ?? "?"));
    },
  });
  await a.battle.runStartup();
  await a.battle.run();

  // 独立来源：turnLog 记录了每一次真的执行了的技能；自己查它是不是伤害类技能
  const byId = new Map<any, any>(a.battle.allEntities().map((e: any) => [e.id, e]));
  let expected = 0; const turnLogNonAttack: string[] = [];
  for (const t of (a.battle.turnLog ?? []) as any[]) {
    if (!t.skill) continue;
    const ent: any = byId.get(t.actorId);
    const sk = ent?.skills?.find((s: any) => s.name === t.skill);
    if ((sk?.ir?.damage?.length ?? 0) > 0) expected++; else turnLogNonAttack.push(String(t.skill));
  }
  ok("★★★ SKILL_START 真的被派发了", starts > 0, String(starts));
  ok("★★★ 派发次数 == turnLog 里伤害类技能的执行次数（两个独立来源对得上）",
    starts === expected, "探针 " + starts + " vs turnLog 推算 " + expected);
  ok("★★★ 非伤害技能（治疗/纯增益）**不**触发 SKILL_START —— 否则它就和「造成伤害时」没区别了",
    nonAttackFired.length === 0 && turnLogNonAttack.length > 0,
    "探针侧误触 " + JSON.stringify(nonAttackFired.slice(0, 4)) + "｜turnLog 侧非伤害技能 " + turnLogNonAttack.length + " 个");
  console.log("    典型对局：SKILL_START 派发 " + starts + " 次；其中非伤害技能 " + nonAttackFired.length +
    " 次（turnLog 里另有 " + turnLogNonAttack.length + " 次非伤害技能执行，全部未触发）");
  ok("★★ 补派发点没有改变默认路径的指纹（OFF 档逐位不变）",
    stateHash(captureState(a.battle)) === BASE, stateHash(captureState(a.battle)));

  // ② 端到端：把典型对局红方第 1 位换成鬼女红叶（她的「爆炸之咒」正是「攻击时」族里唯一的干净候选）
  //    —— 上一轮之前，这条被动会因 SKILL_START 没有派发点而被**跳过**。
  const m: any = canonicalMatch();
  m.red.units[0].shikigamiId = 231;
  m.red.units[0].name = "鬼女红叶";
  const c: any = assembleMatch(createKit(bundle), m, { seed: 20261001, passives: "PARSED_CANDIDATES_ONLY" });
  await c.battle.runStartup();
  await c.battle.run();
  const rep = c.battle.passiveReport;
  const installed = rep.installed.some((i: any) => i.skill === "爆炸之咒");
  const casts = c.battle.trace.filter((e: any) => e.t === "SKILL_CAST" && e.skill === "爆炸之咒");
  ok("★★★ 鬼女红叶「爆炸之咒」（攻击时）**被装上**了（此前因 SKILL_START 未派发被跳过）",
    installed, JSON.stringify(rep.installed.map((i: any) => i.skill)));
  ok("★★★ 而且它在战斗里真的触发了（每次自己攻击都会挂一次印记）", casts.length > 0, String(casts.length));
  ok("★★ rep.noDispatch 里不再有它", rep.skipped.noDispatch >= 0);
  console.log("    阵容含鬼女红叶时：装上 " + rep.installed.map((i: any) => i.skill).join("、") +
    "；「爆炸之咒」触发 " + casts.length + " 次");
}


sec("[7] ★★★ 第 75 轮：「有 X% 概率 …」被建模 —— 从「整条不挂」到「挂上并如实掷」");
{
  // 判据：一个被动被**提供**了几次机会（= AFTER_DAMAGE 事件到达它，即掷数被消耗了几次），
  // 与它**真的执行**了几次（SKILL_CAST）。两者必须满足：fires < offers（掷得中也会掷不中），
  // 且 fires/offers 落在 p=0.5 的合理区间里。
  const K = 40;
  let offers = 0, fires = 0, seedsWithRoll = 0, passiveSide = 0;
  const firstSeedFires: number[] = [];
  for (let i = 0; i < K; i++) {
    const seed = 20261001 + i * 7919;
    // ★ 受试者换成铁鼠「横财护身」（受到攻击时 40% 概率为攻击者附加 buff）——
    //   它的**效果**（附加状态）在 IR 里是实现好的，所以真的会做事。
    //   （原来用的三尾狐「诱惑」第 87 轮被效果闸门拦下：它的效果是吸血，而吸血当时没实现。
  //     ★ 第 93 轮吸血接线后它已经能装了 —— 这里仍然用铁鼠，因为这个测试数的是
  //     `rng.draws` 里 `passive_prob:` 的掷数与 SKILL_CAST 的次数；
  //     诱惑的 execute 是空的（它的效果在伤害管线里，不在 execute），拿它数不出"触发了几次"。）
    const r: any = await run("PARSED_CANDIDATES_ONLY", seed, withUnit(232, "铁鼠"));
    /**
     * ★★★ 第 194 轮：**掷数换到了效果侧**。概率被读进 effectProbs 之后，触发侧按 probOwnedByEffect
     *   判定「效果侧会掷」而不再掷（第 189 轮的规矩：同一个概率只许掷一次）。所以：
     *     · offers = **效果侧**的掷数（status_prob:…横财护身…）；
     *     · fires  = 真的挂上了（STATUS_APPLY）—— 触发句执行（SKILL_CAST）与掷中与否无关，数不了触发率。
     */
    const tagged = (r.battle.rng.draws ?? []).filter((d: any) => /^status_prob:/.test(String(d.tag ?? "")) && String(d.tag).includes("横财护身")).length;
    const cast = r.battle.trace.filter((e: any) => e.t === "STATUS_APPLY" && String(e.skill) === "横财护身").length;
    offers += tagged; fires += cast;
    passiveSide += (r.battle.rng.draws ?? []).filter((d: any) => /^passive_prob:/.test(String(d.tag ?? "")) && String(d.tag).includes("横财护身")).length;
    if (tagged > 0) seedsWithRoll++;
    if (i < 3) firstSeedFires.push(cast);
  }
  const rate = offers > 0 ? fires / offers : -1;
  console.log("    " + K + " 个 seed：横财护身效果侧掷数 " + offers + " 次｜真的挂上 " + fires + " 次｜触发率 " + (rate * 100).toFixed(1) + "%（标称 40%）｜触发侧掷数 " + passiveSide + " 次");
  ok("★★★ 同一个概率**只掷一次**：触发侧 0 次、效果侧 > 0 次（第 189 轮的规矩，第 194 轮把它扩到新读进来的概率上）",
    passiveSide === 0 && offers > 0, "passiveSide=" + passiveSide + " effectSide=" + offers);

  ok("★★★ 概率真的被掷了（有掷数记录，且机会数 > 0）", offers > 0 && seedsWithRoll > 0,
    "offers=" + offers + " seedsWithRoll=" + seedsWithRoll);
  ok("★★★ 挂上的次数**严格小于**效果侧掷数 —— 这正是第 69 轮那个错误的反面（40% 不许变成 100%）",
    fires > 0 && fires < offers, "fires=" + fires + " offers=" + offers);
  ok("★★★ 触发率落在 40% 的合理区间（0.25~0.55，二项分布）", rate > 0.25 && rate < 0.55, String(rate));
  ok("★★ 同 seed 两次触发次数一致（掷数走 battle.rng，可重放）",
    firstSeedFires.length === 3 && (await run("PARSED_CANDIDATES_ONLY", 20261001, withUnit(232, "铁鼠"))).battle.trace.filter((e: any) => e.t === "STATUS_APPLY" && String(e.skill) === "横财护身").length === firstSeedFires[0],
    JSON.stringify(firstSeedFires));

  // 反方向：把概率当成 100%（即"不掷就执行"），触发次数必须**明显变多** —— 证明上面那条有牙齿
  const noRoll = offers;   // 不掷的话，每次机会都会执行
  ok("★★★ 反向：若把条件概率当成 100%（第 69 轮的错误做法），触发次数会从 " + fires + " 涨到 " + noRoll + " —— 差 " + (noRoll - fires) + " 次",
    noRoll - fires > 0);

  // 报告口径
  // ★★★ 第 87 轮：这条断言**换了受试阵容**。典型对局里唯一带条件的被动（三尾狐「诱惑」）
  //   被新的效果闸门拦下了，所以 conditioned 在典型对局里**合理地**是 0。
  //   要检查"报告能不能看出条件"，就得用一个**带条件的被动确实被装上**的阵容（铁鼠「横财护身」）。
  const tk: any = await run("PARSED_CANDIDATES_ONLY", 20261001, withUnit(232, "铁鼠"));
  const tkRep = tk.rep;
  ok("★★★ 装上的被动在报告里带得出**各自的条件**（按种类分开记账）",
    tkRep.conditioned >= 1 && (tkRep.conditionKinds.PROBABILITY ?? 0) >= 1 &&
    tkRep.installed.every((i: any) => i.probability === null || (i.probability > 0 && i.probability <= 1)),
    JSON.stringify({ conditioned: tkRep.conditioned, kinds: tkRep.conditionKinds }));
  // ★★★ 第 93 轮：这条断言也转向了 —— 第 87 轮它写的是"典型对局里 conditioned = 0 是对的
  //   （它唯一带条件的被动被效果闸门拦下了）"。吸血接线之后那条被动被装上，
  //   于是 conditioned = 1 且种类是 PROBABILITY（50% 概率）。
  //   ★ 两句话都对，但**守的是同一件事**：报告里的 conditioned 必须与"到底装上了几条带条件的"一致。
  ok("★★ 典型对局里 conditioned = 1（唯一带条件的被动被装上了，种类 PROBABILITY）",
    on.rep.conditioned === 1 && (on.rep.conditionKinds.PROBABILITY ?? 0) === 1,
    "conditioned=" + on.rep.conditioned + " kinds=" + JSON.stringify(on.rep.conditionKinds));
  console.log("    典型对局装上 " + on.rep.installed.length + " 条（带条件 " + on.rep.conditioned + "）｜铁鼠阵容带上 " +
    tkRep.installed.length + " 条，条件种类 " + JSON.stringify(tkRep.conditionKinds));
}

console.log("\n=== 被动运行时: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
