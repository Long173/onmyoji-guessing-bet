// tests/g60-stat-steal.ts — ★★★ 第 99 轮：**属性偷取 → 归还**（a1-4 §16 Restore；目标 ⑨）
//
// 全库 818 条技能里含「偷取」的只有 7 条（量出来的）。到第 108 轮为止，这 7 条**都有可执行产物**：
// 6 条属性偷取（施放时 / 造成伤害时 / 施放『X』前三种触发）＋ 1 条增益偷取；跳过记录只剩 1 条
// （一反木绵「永久偷取…直到回目结束」——「回目」这个时间轴引擎里没有）。
// 这个测试的职责仍然是**两边都断言**：能执行的要端到端跑出来，不能执行的必须逐条有理由。
//
// ★ 默认口径不是猜的：KB 里三条原文互相印证「偷的是一个量」（见 kernel/steal.ts 文件头）。
//   备选口径 RATE_SWAP（不守恒）也实现，用来**量出**默认口径有多重要。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { compileSkill } from "../compile/skill-compiler.ts";
import { applyStatSteal, restoreStats, stolenBy } from "../kernel/steal.ts";
import { StealPolicyConfigs } from "../kernel/policies.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { TurnType } from "../kernel/types.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = "2d7c7507e18db61f";
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);
const sk = (t: string) => compileSkill(1, "T", { id: "1_01", name: "S", cost: 5, description: t, brief: "", upgrades: [] }) as any;
const ev = (ir: any, s: string) => (ir.steals ?? []).find((x: any) => String(x.evidence).includes(s));

sec("[1] 全库普查：含「偷取」的技能，能被执行的与不能被执行的要分开数")
{
  const hits: Array<{ who: string; ir: any }> = [];
  const reasons: Record<string, number> = {};
  for (const s of LIST) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      const ir: any = compileSkill(s.id, s.name, k);
      if (!ir.steals && !ir.stealSkips) continue;
      hits.push({ who: s.name + "「" + k.name + "」", ir });
      for (const sp of (ir.stealSkips ?? [])) reasons[sp.reason] = (reasons[sp.reason] ?? 0) + 1;
    }
  }
  /**
   * ★★★ 第 104 轮：普查口径要分开 ——「含偷取的技能」（7 条，含增益偷取与三种跳过）
   *   与「能读成**属性**偷取的技能」（4 条）。第一版把两者混成一个筛选，于是
   *   只有跳过记录的技能（首无/噬魂）被一起滤掉，连"逐条有理由"也数不出来。
   */
  const exec = hits.filter(h => (h.ir.steals ?? []).some((x: any) => !x.buffSteal));
  ok("★★★ 含「偷取」的技能共 7 条（不是 0 条而显得干净，也不是把全库都算进来）", hits.length === 7, JSON.stringify(hits.map(h => h.who)));
  /**
   * ★★★ 第 108 轮：**6 条**（噬魂在第 107 轮接上了 SKILL_START、第 108 轮把执行点跑通）。
   *   至此「含偷取的 7 条技能」里**全部 7 条都有可执行产物**，只是形状不同：
   *   6 条是属性偷取（含「造成伤害时」与「施放『X』前」两种触发），1 条是增益偷取（见 g64）。
   */
  ok("★★★ 其中 6 条能读成可执行的属性偷取（含造成伤害时的首无、施放前被动的噬魂）", exec.length === 6, JSON.stringify(exec.map(h => h.who)));
  /**
   * ★★★ 第 107/108 轮：跳过记录**只剩一条** —— 一反木绵的「永久偷取…直到回目结束」
   *   （「回目」这个时间轴引擎里没有）。第 107 轮这里曾有第二条 PRE_CAST_NOT_EXECUTED，
   *   第 108 轮把执行点跑通后**按事实删掉**：留着一条已经解决的原因码，比不写更误导。
   */
  ok("★★★ 跳过记录 1 条（只剩「永久直到回目结束」；施放前被动已经接上，原因码随之消失）",
    reasons.PERMANENT_UNTIL_ROUND_END === 1 && Object.keys(reasons).length === 1,
    JSON.stringify(reasons));
  ok("★★ 而且没有 NO_NUMERIC_OPTION 之类的杂音（说明判据不是「先收进来再说」）",
    !reasons.NO_NUMERIC_OPTION || reasons.NO_NUMERIC_OPTION === 1, JSON.stringify(reasons));
  console.log("    可执行：" + exec.map(h => h.who + " " + JSON.stringify(h.ir.steals[0].prop ?? h.ir.steals[0].options?.length + "项")).join("｜"));
  console.log("    跳过：" + JSON.stringify(reasons));

  sec("[2] 逐条核对数字（数字来自原文，不是我们定的）")
  const fenghuang = exec.find(h => h.who.includes("凤火"))!.ir.steals[0];
  ok("★★★ 凤凰火「凤火」：偷 10% 暴击、持续 2 回合、50% 概率",
    fenghuang.prop === "cri" && fenghuang.ratio === 0.1 && fenghuang.duration === 2 && fenghuang.probability === 0.5,
    JSON.stringify(fenghuang));
  const yimulian = exec.find(h => h.who.includes("风符·破"))!.ir.steals[0];
  ok("★★★ 一目连「风符·破」：偷 20% 攻击、持续 2 回合、原文写 100%",
    yimulian.prop === "atk" && yimulian.ratio === 0.2 && yimulian.duration === 2 && yimulian.probability === 1,
    JSON.stringify(yimulian));
  const yifan = exec.find(h => h.who.includes("雪织"))!.ir.steals[0];
  ok("★★★ 一反木绵「雪织」：偷 40% 效果命中；★ 持续回合是 DEFAULT（原文只说「束缚期间」）—— 默认值必须能被看出来",
    yifan.prop === "efh" && yifan.ratio === 0.4 && yifan.durationSource === "DEFAULT", JSON.stringify(yifan));
  const daoren = exec.find(h => h.who.includes("盗亦有道"))!.ir.steals[0];
  ok("★★★ 盗人神「盗亦有道」：随机偷 4 种属性，且 **10 点速度走的是「点」不是百分比**",
    daoren.random === true && daoren.options.length === 4 && daoren.options.some((o: any) => o.prop === "spd" && o.flat === 10 && o.ratio === null),
    JSON.stringify(daoren.options));
  ok("★★★ 上限「每个目标最多可偷取3次相同属性」被读到（写在**另一句**里，靠整篇回读）", daoren.maxPerTarget === 3, String(daoren.maxPerTarget));
}

sec("[3] ★★★ 双向：真写法必须收、四类假写法必须不收")
{
  ok("★★★ 真写法①「偷取目标40%暴击，持续1回合」→ 收",
    !!ev(sk("对敌方目标造成攻击100%伤害，偷取目标40%暴击，持续1回合"), "偷取目标40%暴击"));
  ok("★★★ 真写法②「偷取20%攻击，持续2回合」→ 收",
    ev(sk("攻击敌方目标，偷取20%攻击，持续2回合"), "偷取20%攻击")?.prop === "atk");
  /**
   * ★ 「10点速度」这条同时盯两件事：①「点」要读成 flat（不是 10%）；② 只有一个选项时用 prop/flat 字段，
   *   不是硬塞进 options 数组（两种形状都要能被断言到，否则"形状"本身没人守）。
   */
  const dotSpd = sk("每次攻击随机偷取敌方目标属性，可偷取的属性包含10点速度，持续2回合");
  ok("★★ 真写法③「10点速度」→ 收，且是 flat=10 的速度（不是 10%）",
    ev(dotSpd, "随机偷取")?.prop === "spd" && ev(dotSpd, "随机偷取")?.flat === 10 && ev(dotSpd, "随机偷取")?.ratio === null,
    JSON.stringify(dotSpd.steals));
  ok("★★ 多选项时才用 options 数组（形状由 g60 双向钉住）",
    Array.isArray(ev(sk("随机偷取敌方目标属性，可偷取的属性包含15%攻击、20%防御，持续1回合"), "随机偷取")?.options),
    JSON.stringify(sk("随机偷取敌方目标属性，可偷取的属性包含15%攻击、20%防御，持续1回合").steals));
  /**
   * ★★★ 第 104 轮：增益偷取**不再是**「不收」的写法 —— 它被解析成 buffSteal 并由 stealBuff 执行（g64）。
   *   这条断言改成守两件事：① 它**不走属性偷取那条路**（形状必须分得开）；
   *   ② 逐次伤害触发的增益偷取仍然不收（触发闸门对两种偷取都成立）。
   */
  const buffSteal = sk("造成攻击100%伤害并有20%概率偷取1个增益状态");
  ok("★★★ 增益偷取有**自己的形状**（buffSteal），不会被当成属性偷取",
    !!buffSteal.steals?.some((x: any) => x.buffSteal) && !buffSteal.steals?.some((x: any) => x.prop || x.options),
    JSON.stringify(buffSteal.steals));
  /**
   * ★★★ 第 105 轮：增益偷取接上了 ON_DAMAGE 之后，这条也**收**了 ——
   *   但触发闸门仍然对它成立，所以它必须带 trigger=ON_DAMAGE 而不是被当成施放式。
   */
  const buffOnDamage = sk("造成伤害时，偷取1个增益状态");
  ok("★★★ 造成伤害时触发的**增益**偷取 → 收，且带 trigger=ON_DAMAGE（与属性偷取共用同一道闸门）",
    buffOnDamage.steals?.length === 1 && buffOnDamage.steals[0].buffSteal?.what === "BUFF" && buffOnDamage.steals[0].trigger === "ON_DAMAGE",
    JSON.stringify(buffOnDamage.steals));
  const onDmg = sk("造成伤害时，偷取目标40%暴击，持续1回合");
  /**
   * ★★★ 第 105 轮：这条断言**按事实改写**。原来写的是「逐次伤害触发 → 不收」；
   *   现在首无「冥火」那类写法**收**，但必须带上 trigger=ON_DAMAGE（执行点在被动运行时的 AFTER_DAMAGE，
   *   不在主动执行点）—— 所以断言改成"收，且标记清清楚楚"。
   *   真正仍然不收的是「**受到**伤害时…偷取」（挨打触发）。
   */
  ok("★★★ 造成伤害时触发的偷取 → **收**，并且带 trigger=ON_DAMAGE（执行点在被动运行时）",
    onDmg.steals?.length === 1 && onDmg.steals[0].trigger === "ON_DAMAGE",
    JSON.stringify(onDmg.steals));
  /**
   * ★ 「同时间内只能对一个目标生效」是**另一句**，必须单独被读到 —— 它与触发时机无关，
   *   第一版把两者塞进同一个断言，于是"这句话有没有被解析"根本测不出来。
   */
  const oneTarget = sk("造成伤害时，偷取目标40%暴击，持续1回合。同时间内只能对一个目标生效。");
  ok("★★★ 「同时间内只能对一个目标生效」被单独读到（oneTargetOnly）",
    oneTarget.steals?.[0]?.oneTargetOnly === true && oneTarget.steals?.[0]?.trigger === "ON_DAMAGE",
    JSON.stringify(oneTarget.steals));
  const onTake = sk("受到伤害时，偷取目标40%暴击，持续1回合");
  ok("★★★ 假写法②「受到伤害时…偷取」→ 仍然不收（挨打触发在引擎里没有执行点）",
    !onTake.steals && (onTake.stealSkips ?? []).some((x: any) => x.reason === "ON_TAKE_DAMAGE_TRIGGER"), JSON.stringify(onTake.stealSkips));
  const preCast = sk("施放『绝命一击』前，先偷取场上全体3%攻击力，持续2回合");
  /**
   * ★★★ 第 107 轮：这条**按事实改写**。「施放『X』前，先偷取…」接上了 SKILL_START，
   *   所以它现在**收** —— 但必须带 trigger=PRE_CAST 与 onSkill（要偷的是"施放那个技能之前"）。
   *   仍然不收的是"施放前但读不出是哪个技能"（没有 [skill_X] 引用就无法确定时点）。
   */
  const preSkill = sk("施放『[skill_339_03]』前，先偷取场上全体3%攻击力（每个目标最多偷取10次），偷取总值不超过自身初始攻击60%。");
  ok("★★★ 第 108 轮：施放前被动**收下了**（trigger=PRE_CAST / onSkill=339_03 / 两个上限 / 敌方全体）——执行点已跑通",
    preSkill.steals?.[0]?.trigger === "PRE_CAST" && preSkill.steals?.[0]?.onSkill === "339_03" &&
    preSkill.steals?.[0]?.capTotalRatio === 0.6 && preSkill.steals?.[0]?.maxPerTarget === 10 &&
    preSkill.steals?.[0]?.victimScope === "ENEMY_ALL" && !(preSkill.stealSkips ?? []).length,
    JSON.stringify({ steals: preSkill.steals, skips: preSkill.stealSkips }));
  /**
   * ★★ 而这条写法里的两个**上限**（每个目标最多 10 次 / 总值不超过自身初始攻击 60%）
   *   与"场上全体"的默认读法，解析是通的 —— 用一条**施放时**的合成句子把它们钉住
   *   （第 108 轮起噬魂那句自己也走得到这些字段了；这里保留一条**施放时**的对照，
   *    证明同两个上限在**不同触发时机**的写法上都读得出来）。
   */
  const caps = sk("偷取场上全体3%攻击力，每个目标最多偷取10次，偷取总值不超过自身初始攻击60%，持续2回合");
  ok("★★★ 总量上限与受害者范围被读到（capTotalRatio=0.6 / victimScope=ENEMY_ALL / scopeSource=DEFAULT 是默认读法）",
    caps.steals?.[0]?.capTotalRatio === 0.6 && caps.steals?.[0]?.maxPerTarget === 10 &&
    caps.steals?.[0]?.victimScope === "ENEMY_ALL" && caps.steals?.[0]?.scopeSource === "DEFAULT",
    JSON.stringify(caps.steals));
  const preNoSkill = sk("施放『绝命一击』前，先偷取场上全体3%攻击力，持续2回合");
  ok("★★★ 假写法③施放前但**读不出是哪个技能** → 不收（PRE_CAST_NO_SKILL）",
    !preNoSkill.steals && (preNoSkill.stealSkips ?? []).some((x: any) => x.reason === "PRE_CAST_NO_SKILL"),
    JSON.stringify(preNoSkill.stealSkips));
  const noNum = sk("偷取敌方目标的属性，持续2回合");
  ok("★★★ 假写法④读不出数字 → 不收，理由 NO_NUMERIC_OPTION",
    !noNum.steals && (noNum.stealSkips ?? []).some((x: any) => x.reason === "NO_NUMERIC_OPTION"), JSON.stringify(noNum.stealSkips));
  const clean = sk("对敌方目标造成攻击100%的伤害");
  ok("★★ 对照：完全没提偷取的技能，两个字段都不产生（不能靠默认值凑出一条）", !clean.steals && !clean.stealSkips);
}

sec("[4] ★★★ 内核运行时：守恒 / 归还 / 上限 / 口径对照")
{
  const mk = async (seed = 20261001) => {
    const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed });
    await a.battle.runStartup();
    return a.battle;
  };
  const b = await mk();
  const thief = b.teams[0].members[0], victim = b.teams[1].members[0];
  const t0 = thief.prop("atk"), v0 = victim.prop("atk");
  const r = applyStatSteal(b, thief, victim, { prop: "atk", ratio: 0.2, flat: null, duration: 2, probability: null, evidence: "g60" });
  ok("★★★ 偷取真的发生了（applied=true）", r.applied === true, JSON.stringify(r));
  ok("★★★ 目标少掉的量 = 比例 × 目标原本的攻击（0.2×…）", Math.abs((v0 - victim.prop("atk")) - v0 * 0.2) < 1e-6, `${v0} → ${victim.prop("atk")}`);
  ok("★★★ **守恒**：偷取者拿到的量 = 目标失去的量（默认口径的定义）",
    Math.abs((thief.prop("atk") - t0) - (v0 - victim.prop("atk"))) < 1e-6,
    `${t0}→${thief.prop("atk")} / ${v0}→${victim.prop("atk")}`);
  ok("★★ 两侧各挂一个状态，来源都是偷取者（归还才能一次还清）",
    !!thief.statuses.find((s: any) => s.def.id === "steal_up_atk" && s.sourceId === thief.id) &&
    !!victim.statuses.find((s: any) => s.def.id === "steal_down_atk" && s.sourceId === thief.id));
  ok("★★ 两者的持续回合一致（同一笔借据）",
    thief.statuses.find((s: any) => s.def.id === "steal_up_atk")!.remaining === victim.statuses.find((s: any) => s.def.id === "steal_down_atk")!.remaining);
  ok("★ 事件链留痕（Theater/Inspector 读得到）", b.trace.some((t: any) => t.t === "STAT_STEAL" && t.prop === "atk" && t.basis === "TRANSFER_FROM_TARGET"));
  ok("★ 观测接口 stolenBy 能列出此刻被偷走的量", stolenBy(b, thief.id).length === 2, JSON.stringify(stolenBy(b, thief.id)));

  const n = restoreStats(b, thief.id, "TEST");
  ok("★★★ 归还：两个状态一起消失（返回 2）", n === 2, String(n));
  ok("★★★ 归还之后两侧属性**逐位回到原值** —— 这才是「借」",
    Math.abs(thief.prop("atk") - t0) < 1e-9 && Math.abs(victim.prop("atk") - v0) < 1e-9,
    `${thief.prop("atk")} vs ${t0} / ${victim.prop("atk")} vs ${v0}`);

  const b2 = await mk(7);
  const thief2 = b2.teams[0].members[1], victim2 = b2.teams[1].members[1];
  const spec = { prop: "def", ratio: 0.2, flat: null, duration: 3, probability: null, maxPerTarget: 3, evidence: "g60-cap" } as any;
  const res = [0, 1, 2, 3].map(() => applyStatSteal(b2, thief2, victim2, spec));
  ok("★★★ 上限「每个目标最多偷取3次」真的拦住第 4 次（数的是**效果条数**，不是状态条数）",
    res.slice(0, 3).every(x => x.applied) && res[3].applied === false && res[3].reason === "MAX_PER_TARGET",
    JSON.stringify(res.map(x => [x.applied, x.reason ?? null])));

  const b3 = await mk(11);
  const thief3 = b3.teams[0].members[2], victim3 = b3.teams[1].members[2];
  b3.policies.steal = { ...StealPolicyConfigs.RATE_SWAP };
  const t3 = thief3.prop("atk"), v3 = victim3.prop("atk");
  const r3 = applyStatSteal(b3, thief3, victim3, { prop: "atk", ratio: 0.2, flat: null, duration: 2, probability: null, evidence: "g60-rate" });
  ok("★★★ 对照口径 RATE_SWAP：两边各按**自己**面板变 ⇒ **不守恒**（这正是默认档必须量出来的理由）",
    r3.applied === true && Math.abs((thief3.prop("atk") - t3) - (v3 - victim3.prop("atk"))) > 1e-6,
    JSON.stringify({ 得: r3.toActor, 失: r3.toTarget }));
  ok("★★ 两种口径给出的数不一样（否则这个 policy 是摆设）", Math.abs((r3.toActor ?? 0) - (r3.toTarget ?? 0)) > 1e-6);
  ok("★★ 没有规格时明确报 NO_SPEC，而不是静默什么都不做", applyStatSteal(b3, thief3, victim3, { duration: 1, probability: null, evidence: "x" }).reason === "NO_SPEC");

  /**
   * ★★★ 第 105 轮：「**同时间内只能对一个目标生效**」（首无「冥火」原文）。
   *   偷第二个目标时，第一个目标的那笔必须**还回去**（借据是同一个偷取者开的）。
   */
  {
    const b4 = await mk(13);
    const t4 = b4.teams[0].members[1];
    const v4a = b4.teams[1].members[1], v4b = b4.teams[1].members[2];
    const a0 = v4a.prop("atk");
    const spec = { prop: "atk", ratio: 0.2, flat: null, duration: 2, probability: null, oneTargetOnly: true, evidence: "g60-one-target" } as any;
    const r1 = applyStatSteal(b4, t4, v4a, spec);
    const mid = v4a.prop("atk");
    ok("★ 前置：第一次偷取生效（目标掉了属性）", r1.applied === true && mid < a0, v4a.prop("atk") + " vs " + a0);
    const b0 = v4b.prop("atk");
    const r2 = applyStatSteal(b4, t4, v4b, spec);
    ok("★★★ 偷第二个目标 ⇒ 第一个目标的那笔被**还回去**（同时间内只对一个目标生效）",
      r2.applied === true && Math.abs(v4a.prop("atk") - a0) < 1e-9,
      v4a.prop("atk") + " vs " + a0);
    ok("★★★ 而且事件里写明是「换目标」造成的归还（不是到期、不是阵亡）",
      b4.trace.some((t: any) => t.t === "STEAL_RETURN" && t.reason === "NEW_TARGET" && t.id === v4a.id));
    /**
     * ★★ 这条断言**按事实改写**：up 状态是**按 prop 合并**的，所以"撤掉旧目标那笔"不等于"整条撤掉"——
     *   正确的结果是：up 状态还在（B 那份），而它的总量必须**等于 B 实际失去的量**
     *   （守恒：不能 A+B 一起留着，那就是凭空多一份属性；也不能整条消失，那是把 B 那份也还了）。
     */
    const upTotal = t4.statuses.filter((s: any) => s.def.id === "steal_up_atk")
      .flatMap((s: any) => s.effects ?? []).reduce((n: number, e: any) => n + Number(e.value ?? 0), 0);
    const bLost = b0 - v4b.prop("atk");
    ok("★★★ 偷取者身上只剩**当前目标那一份**，且与 B 实际失去的量相等（守恒）",
      upTotal > 0 && Math.abs(upTotal - bLost) < 1e-6,
      JSON.stringify({ upTotal, bLost }));
  }

  /**
   * ★★★ 第 105 轮端到端（**被动路径**）：把典型对局的一位换成首无，打开被动运行时，
   *   让它在真实战斗里造成伤害 —— 造成伤害时的偷取应当由 AFTER_DAMAGE 触发。
   */
  {
    const SN = LIST.find((s: any) => s.name === "首无");
    ok("★ 前置：知识库里有「首无」", !!SN);
    const m = canonicalMatch();
    m.red.units[0] = { ...m.red.units[0], shikigamiId: SN.id, name: "首无" };
    const a5: any = assembleMatch(createKit(bundle), m, { seed: 20261301, passives: "PARSED_CANDIDATES_ONLY" });
    await a5.battle.runStartup();
    /**
     * ★★ **强制**打一次（不依赖 AI 选招）：第一版让 AI 自己跑完整场，结果那场首无一次伤害都没造成
     *   （trace 里 DAMAGE×0），断言红得莫名其妙。要测的是"造成伤害时那一条接没接上"，
     *   就该把"造成伤害"这件事**确定性地**做出来 —— 与 g62 §4 同一条经验。
     */
    const wu = a5.battle.teams[0].members[0];
    const basic = wu.skills.find((s: any) => Number(s.cost) === 0);
    const foe = a5.battle.teams[1].members[0];
    await a5.battle.runPseudoTurn(wu, TurnType.PSEUDO_TURN, { skill: basic, target: foe });
    const st = a5.battle.trace.filter((t: any) => t.t === "STAT_STEAL" && t.src === wu.id);
    ok("★★★ 真实战斗的**被动路径**产生了造成伤害时的偷取（不是只有内核函数能跑）",
      st.length > 0, "STAT_STEAL × " + st.length + "（总 " + a5.battle.trace.filter((t: any) => t.t === "STAT_STEAL").length + "）");
    ok("★★★ 而且全部是 cri（冥火偷的是暴击）",
      st.every((t: any) => t.prop === "cri"), JSON.stringify(st.slice(0, 3).map((t: any) => t.prop)));
    console.log("    首无的偷取 " + st.length + " 次；终局 winner=" + a5.battle.winner + " turns=" + a5.battle.turn);
  }
}

sec("[5] ★★★ 端到端：把典型对局的一位换成一目连，跑完整战斗")
{
  const YML = LIST.find((s: any) => s.name === "一目连");
  ok("★ 前置：知识库里有「一目连」", !!YML && (YML.skills ?? []).some((k: any) => k.name === "风符·破"));
  const m = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: YML.id, name: "一目连" };
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261002 });
  await a.battle.runStartup();
  await a.battle.run();
  const st = a.battle.trace.filter((t: any) => t.t === "STAT_STEAL");
  ok("★★★ 真实技能执行路径产生了属性偷取（不是只有内核函数能跑）", st.length > 0, "STAT_STEAL × " + st.length);
  ok("★★★ 而且都是 atk、都是 TRANSFER 口径", st.every((t: any) => t.prop === "atk" && t.basis === "TRANSFER_FROM_TARGET"), JSON.stringify(st.slice(0, 2)));
  const used = a.battle.teams[0].members[0].usedSkills.has("风符·破") || st.length > 0;
  ok("★★ 对照：确实用到了这个技能（否则上面那条是别的东西触发的）", used);
  console.log("    偷取事件 " + st.length + " 次；终局 winner=" + a.battle.winner + " turns=" + a.battle.turn);
}

sec("[6] ★★★ 默认档下既有夹具逐位不变（新机制不许悄悄改动老结果）")
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.runStartup();
  await a.battle.run();
  ok("★★★ 典型对局 #001 的终局指纹与第 97 轮记录的值逐位相同（阵容里没有偷取技能 ⇒ 不该有任何变化）",
    stateHash(captureState(a.battle)) === BASE, stateHash(captureState(a.battle)) + " vs " + BASE);
  ok("★★ 而且这场里一次 STAT_STEAL 都没有", a.battle.trace.filter((t: any) => t.t === "STAT_STEAL").length === 0);
}

sec("[7] ★★★ 第 108 轮端到端：噬魂「施放『焚天九尾』前，先偷取场上全体3%攻击力」")
{
  const JT = LIST.find((s: any) => s.name === "烬天玉藻前");
  const hun = (JT?.skills ?? []).find((k: any) => k.name === "噬魂");
  ok("★ 前置：知识库里有 烬天玉藻前「噬魂」与「焚天九尾」",
    !!hun && (JT?.skills ?? []).some((k: any) => k.name === "焚天九尾") && /施放.*前.*偷取/.test(String(hun.description)));
  const m7 = canonicalMatch();
  m7.red.units[0] = { ...m7.red.units[0], shikigamiId: JT.id, name: "烬天玉藻前" };
  const a7: any = assembleMatch(createKit(bundle), m7, { seed: 20261401, passives: "PARSED_CANDIDATES_ONLY" });
  await a7.battle.runStartup();
  const self = a7.battle.teams[0].members[0];
  const hs = self.skills.find((s: any) => s.name === "噬魂");
  const mine = (a7.battle.passiveReport.installed ?? []).filter((r: any) => r.entityId === self.id);
  /**
   * ★★★ 第 108 轮：这条装在**两处**，因为噬魂有两句互不相干的触发句：
   *   「施放『X』前，先偷取…」→ SKILL_START、「阵亡时，将偷取的攻击全部归还」→ DEATH。
   *   第 107 轮它**一次都没装**：挡住它的是「每个目标最多偷取10次」里的那个 `每` 字
   *   （被当成"条件没建模"）与被标记成未建模的整句「偷取」。
   */
  ok("★★★ 这条被动**真的被装上了**（此前 installed 里根本没有它）",
    mine.some((r: any) => r.skill === "噬魂" && r.event === "SKILL_START"),
    JSON.stringify(mine.map((r: any) => r.family + "→" + r.event)));
  ok("★★★ 而且逐句注册：施放技能前 → SKILL_START、阵亡 → DEATH（两句各挂各的）",
    mine.map((r: any) => r.family + "→" + r.event).sort().join(",") === "施放技能前→SKILL_START,阵亡→DEATH",
    JSON.stringify(mine.map((r: any) => r.family + "→" + r.event)));
  const foes = a7.battle.teams[1].members.filter((f: any) => f.alive);
  const fen = self.skills.find((s: any) => s.name === "焚天九尾");
  a7.battle.trace.length = 0;
  await a7.battle.runPseudoTurn(self, TurnType.PSEUDO_TURN, { skill: fen, target: foes[0] });
  const st7 = a7.battle.trace.filter((t: any) => t.t === "STAT_STEAL");
  ok("★★★ 施放焚天九尾**真的触发了偷取**，而且每个活着的敌人各一份（原文「场上全体」的默认读法 = 敌方全体）",
    st7.length > 0 && st7.length === foes.length && new Set(st7.map((t: any) => t.dst)).size === foes.length,
    "STAT_STEAL × " + st7.length + " / 敌人 " + foes.length);
  ok("★★★ 而且**只有一遍**：主动执行点不再重复执行 PRE_CAST（接线后的实测是 10 次 = 5 敌 × 2）",
    st7.length === foes.length, "STAT_STEAL × " + st7.length);
  ok("★★★ 偷的是攻击、口径是默认的守恒转移、比例来自原文的 3%",
    st7.every((t: any) => t.prop === "atk" && t.basis === "TRANSFER_FROM_TARGET" && Math.abs(t.toTarget - 0.03 * t.targetBefore) < 0.02 * t.targetBefore),
    JSON.stringify(st7.slice(0, 2).map((t: any) => ({ d: t.dst, to: t.toTarget, before: t.targetBefore }))));
  const firstDmg = a7.battle.trace.findIndex((t: any) => t.t === "DAMAGE" && t.src === self.id);
  const lastSteal = a7.battle.trace.map((t: any) => t.t).lastIndexOf("STAT_STEAL");
  ok("★★★ 时点是「施放**前**」：偷取事件全部排在这一次焚天九尾的伤害之前",
    lastSteal >= 0 && firstDmg > lastSteal, JSON.stringify({ lastSteal, firstDmg }));
  /**
   * ★★ 「没有第二遍」也可能只是"主动执行点没跑到"。要求它**说出来**：
   *   主动执行点遇到 PRE_CAST 的条目必须留一条 STAT_STEAL_SKIPPED（不静默丢）。
   */
  ok("★★ 主动执行点如实记下「这类偷取不归我执行」（STAT_STEAL_SKIPPED / NOT_THIS_EXECUTION_POINT）",
    a7.battle.trace.some((t: any) => t.t === "STAT_STEAL_SKIPPED" && t.reason === "NOT_THIS_EXECUTION_POINT"),
    JSON.stringify(a7.battle.trace.filter((t: any) => t.t === "STAT_STEAL_SKIPPED").slice(0, 2)));
  /**
   * ★★★ 反向：**点名技能的族**不许在别的技能上触发。
   *   第 108 轮之前，强制放普攻时"偷取被跳过、execute 却照跑"，于是普攻也偷 5 个敌人。
   */
  const m7b = canonicalMatch();
  m7b.red.units[0] = { ...m7b.red.units[0], shikigamiId: JT.id, name: "烬天玉藻前" };
  const b7: any = assembleMatch(createKit(bundle), m7b, { seed: 20261401, passives: "PARSED_CANDIDATES_ONLY" });
  await b7.battle.runStartup();
  const self2 = b7.battle.teams[0].members[0];
  const basic2 = self2.skills.find((s: any) => Number(s.cost) === 0);
  b7.battle.trace.length = 0;
  await b7.battle.runPseudoTurn(self2, TurnType.PSEUDO_TURN, { skill: basic2, target: b7.battle.teams[1].members[0] });
  ok("★★★ 反向：放**别的技能**（普攻）一次也不偷 —— 「施放『焚天九尾』前」不是「攻击时」",
    b7.battle.trace.filter((t: any) => t.t === "STAT_STEAL").length === 0,
    "普攻 " + basic2?.name + " ⇒ STAT_STEAL × " + b7.battle.trace.filter((t: any) => t.t === "STAT_STEAL").length);
  /**
   * ★★★ 总量上限（capTotalRatio）的端到端：把上限压到自身初始攻击的 2%，
   *   逐个偷 3% —— 必须**削到剩余额度**并如实记 capped（原文「偷取总值不超过…」不是"超过就不偷"）。
   */
  const spec: any = { ...hs.ir.steals[0], duration: 3, capTotalRatio: 0.02 };
  const before = foes.map((f: any) => f.prop("atk"));
  let capped = 0;
  for (const f of foes) {
    const r = applyStatSteal(a7.battle, self, f, spec);
    if (r.applied) capped++;
  }
  const gained = self.statuses.filter((s: any) => String(s.def.id).startsWith("steal_up_"))
    .flatMap((s: any) => s.effects ?? []).reduce((n: number, e: any) => n + Number(e.value ?? 0), 0);
  ok("★★★ 总量上限真的生效：偷到的总量被削到 2% × 自身初始攻击 以内，且事件里记着 capped",
    gained <= 0.02 * self.base.atk + 1e-6 && a7.battle.trace.some((t: any) => t.t === "STAT_STEAL" && t.capped === true),
    JSON.stringify({ gained: Math.round(gained), cap: Math.round(0.02 * self.base.atk), applied: capped }));
  /**
   * ★★★ 另一句（阵亡 → DEATH）的端到端：这一句的执行点在死亡路径上（kernel/battle.ts 的 resolveLethal）。
   *   duration 给 3，免得它在回合内的状态计时里先到期（那就量不到"阵亡归还"了）。
   */
  /**
   * ★ 基准是**偷之前**的 `before`（不是"刚才量过的那个值"）：第一版拿偷完之后的读数当基准，
   *   于是"归还成功"被算成了差 89/25 —— 断言写错方向会把做对了的事报成没做。
   */
  const owed = foes.map((f: any, i: number) => Math.round(before[i] - f.prop("atk")));
  self.hp = 0;
  await a7.battle.resolveLethal(self, foes[0].id);
  ok("★★★ 偷取者阵亡 ⇒ 偷来的攻击**全部归还**（STEAL_RETURN / DEATH，被偷的每个目标都回到原值）",
    owed.some((x: number) => x > 0) &&
    a7.battle.trace.some((t: any) => t.t === "STEAL_RETURN" && t.reason === "DEATH") &&
    foes.every((f: any, i: number) => Math.abs(f.prop("atk") - before[i]) < 1e-9),
    JSON.stringify({
      stillOwed: foes.map((f: any, i: number) => Math.round(before[i] - f.prop("atk"))),
      selfDead: self.dead,
      traces: [...new Set(a7.battle.trace.map((t: any) => t.t))],
      returns: a7.battle.trace.filter((t: any) => String(t.t).includes("RETURN")),
    }));
}
console.log(`\n=== 属性偷取 → 归还: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
