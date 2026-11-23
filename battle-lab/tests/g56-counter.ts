// tests/g56-counter.ts — ★★★ 反击 + 逐句触发路由 + 目标侧接线（第 95 轮，目标 ⑨）
//
// 三件事在同一处交汇：
//   ① `Battle.runPseudoTurn`（第 23 轮建的伪回合受控入口）**从来没有生产者** ——
//      capability 的 COUNTER 因此一直是「入口在、无生产者」；
//   ② 目标侧族（受到伤害/受到攻击/被攻击/受到敌方攻击）此前用 `range: SELF` 注册，
//      而这两个事件码的 origin 是**伤害来源** ⇒ 方向反了：一条「受到伤害时」的被动
//      会在**自己打人的时候**触发。这一轮修掉，并用铁鼠「横财护身」双向量出来；
//   ③ 一个被动**不止一个触发句**（九命猫 3 句 / 骨女 2 句 / 阿香 2 句），
//      旧模型只挑一族 ⇒ 另一句的效果永远挂不上、而一句话的条件会管住另一句。
import fs from "node:fs";
import path from "node:path";
import { compileSkill, splitClauses } from "../compile/skill-compiler.ts";
import { classifyPassiveUnits, TRIGGER_FAMILIES } from "../kernel/triggers.ts";
import { findUnmodeled } from "../compile/unmodeled.ts";
import { installPassiveSkills } from "../compile/passive-runtime.ts";
import { loadTips } from "../compile/tips.ts";
import { StatusBook } from "../kernel/status.ts";
import { CAPABILITIES } from "../capability/registry.ts";
import { producerScanFiles, stripComments } from "../tools/field-census.ts";
import { DamageType } from "../kernel/types.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = "2d7c7507e18db61f";
/**
 * ★★★ 打开被动时的指纹有**两次按事实改写**，两次的理由不同 —— 记在这里，免得下次误判成漂移：
 *
 *   · 第 132 轮：c47af66446febdb8 → ba4f8137c904d909。**状态里多了一个必须有的键**
 *     （五个后加的红区策略里 passives 偏离默认 ⇒ 入档），行为没变；
 *   · 第 135 轮：ba4f8137c904d909 → **6d7fb675c3d14eaf**。**行为真的变了**：
 *     新增「先机」触发族（tips_7 = 战斗开始时）之后，典型对局里
 *     座敷童子「福运昌隆」（开局 +1 鬼火）与聆海金鱼姬「凌波」（开局 4 层印记）第一次真的会执行
 *     —— 这两条此前**一条都挂不上**（写法里没有「战斗开始」四个字）。
 *   · 第 190 轮：6d7fb675c3d14eaf → **7bc24506bdcd349e**。**这不是漂移，是修好了一个 bug**：
 *     此前这里写的是 `runStartup(); run()`，而 `run()` 内部**也会**调 `runStartup()` ⇒ 开局跑了两遍
 *     （BATTLE_START 再派发一轮 ⇒ 先机触发两次）。第 190 轮给 `runStartup` 加了幂等闸门，
 *     于是本行测的是**单次开局**。★ 同一个常量在 g54 / g110 / g111 / g112 里也一起按事实改了。
 *   ★ 默认档（OFF）的指纹 2d7c7507e18db61f 三次都逐位不变。
 */
const BASE_ON = "7bc24506bdcd349e";
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : [];
const TIPS = loadTips(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8")));
const findUnm = (t: string) => findUnmodeled(t, splitClauses);
const desc = (nm: string, sk: string) => {
  const s = LIST.find((x: any) => x.name === nm);
  return String(s.skills.find((k: any) => k.name === sk).description ?? "").replace(/<br>/g, "。");
};

sec("[1] ★★★ 解析侧：全库「反击」收 10 处、跳过 5 处，两类假命中必须点名");
{
  let acc: string[] = []; const skips: Record<string, number> = {};
  for (const s of LIST) for (const k of (s.skills ?? [])) {
    const ir: any = compileSkill(s.id, s.name, k);
    for (const x of (ir.counterSkips ?? [])) skips[x.reason] = (skips[x.reason] ?? 0) + 1;
    if (ir.counter) acc.push(s.name + "「" + k.name + "」" + (ir.counter.chance === null ? "ALWAYS" : ir.counter.chance));
  }
  ok("★★★ 收 10 处（不是 0 而显得干净）", acc.length === 10, String(acc.length) + "：" + acc.join("｜"));
  ok("★★★ 跳过 5 处：抑制句 2 + 定语用法 3",
    skips.SUPPRESSION === 2 && skips.NOT_A_COUNTER === 3, JSON.stringify(skips));
  ok("★★★ 概率按小句归因：阿香 25%、犬夜叉 10%（括号说明不许把概率吃掉）",
    acc.some(x => x.startsWith("阿香") && x.endsWith("0.25")) && acc.some(x => x.startsWith("犬夜叉") && x.endsWith("0.1")),
    acc.join("｜"));
  const sy = compileSkill(1, "T", { id: "p", name: "S", cost: 5, description: "若非进行反击，则伤害提升30%" });
  // ★ 判据用 `!`（不是 === null）：这两个字段**只有非默认值才写出来**，所以"没有"是**键不存在**。
  //   第 94 轮在别的字段上刚踩过一次，这里又写了一遍 —— 同一个坑，两次。
  ok("★★★ 假命中①：「**若非进行反击**」（酒吞童子/以津真天的原文）是抑制声明，不是本技能在反击",
    !sy.counter && (sy.counterSkips ?? []).some((x: any) => x.reason === "SUPPRESSION"), JSON.stringify(sy.counterSkips));
  const f1 = compileSkill(1, "T", { id: "p", name: "S", cost: 5, description: "每次触发[buff_2202_1]的反击后，提升自身10%攻击" });
  const f2 = compileSkill(1, "T", { id: "p", name: "S", cost: 5, description: "并对反击目标附加[buff_2204_1]" });
  ok("★★★ 假命中②：「…的反击**后**」「对**反击目标**附加」是定语（别人的反击 / 反击的目标），不是动作",
    !f1.counter && !f2.counter &&
    (f1.counterSkips ?? []).some((x: any) => x.reason === "NOT_A_COUNTER") &&
    (f2.counterSkips ?? []).some((x: any) => x.reason === "NOT_A_COUNTER"));
  const good = compileSkill(1, "T", { id: "p", name: "S", cost: -1, description: "受到伤害时，有30%概率反击敌方" });
  ok("★★★ 反向：合成的真写法必须被收（否则这是个「永远不收」的解析器）",
    good.counter?.chance === 0.3, JSON.stringify(good.counter));
}

sec("[2] ★★★ 声明侧：目标侧族与「暴击」的条件都写成了声明，而且**运行时真的在读**");
{
  const target = TRIGGER_FAMILIES.filter(t => t.side === "TARGET").map(t => t.family);
  //   ★★★ 第 123 轮：5 → **6**。新增「被施加」（STATUS_ADD，目标侧）—— 它是「再次被施加[buff]时…」那一族。
  ok("★★★ 6 个目标侧族：受到伤害 / 受到攻击 / 被攻击 / 受到敌方攻击 / 受到治疗 / 被施加",
    target.length === 6 && ["受到伤害", "受到攻击", "被攻击", "受到敌方攻击", "受到治疗", "被施加"].every(f => target.includes(f)),
    JSON.stringify(target));
  ok("★★★ 源侧族不许标 TARGET（造成伤害/攻击/暴击）",
    ["造成伤害", "攻击", "暴击"].every(f => TRIGGER_FAMILIES.find(t => t.family === f)?.side !== "TARGET"));
  const pr = stripComments(fs.readFileSync(path.join(ROOT, "battle-lab", "compile", "passive-runtime.ts"), "utf8"));
  /**
   * ★★★ 第 123 轮：过滤改成**按事件形状取目标**（伤害事件 `input.target`、治愈/状态/护盾事件 `target`/`entity`），
   *   仍然**失败关闭**（三者都取不到就不放行）。旧写法只认 `input.target` —— 于是 STATUS_ADD / HEAL / SHIELD_* 上的
   *   目标侧被动永远不触发，而「永远不触发」与「没实现」在账上长得一样。
   */
  /**
   * ★★★ 第 179 轮**按事实改写**：range 的表达式不再是 `targetSide ? "ALL" : "SELF"` ——
   *   现在还要按**主语**挑（敌方⇒ENEMY · 任意⇒ALL · 其余⇒SELF，见报告 §151）。
   *   这里要守的两件事不变：① 目标侧族仍然是 range ALL；② 处理器里按**事件形状**取目标做失败关闭过滤。
   */
  ok("★★★ 运行时按 side（与第 179 轮起的**主语**）决定 range，并按事件形状取目标做**失败关闭**过滤（三种载荷都认）",
    /targetSide \? "ALL"/.test(pr) && /subject === "ENEMY" \? "ENEMY"/.test(pr) && /ctx\?\.input\?\.target\?\.id \?\? ctx\?\.target\?\.id \?\? ctx\?\.entity\?\.id/.test(pr) &&
    /if \(t !== e\.id\) return;/.test(pr));
  /**
   * ★★★ 第 177 轮**按事实收窄**：这条反向断言原先查的是「整份文件里不再出现 `ctx?.input?.target?.id !== e.id`」。
   *   现在这个写法**又出现了** —— 但出现在第 177 轮新增的「主动技能里的来源子句」处理器里，
   *   那里的事件码是 BEFORE_DAMAGE（**伤害**事件），按事件形状取目标用的正是 input.target，是对的。
   *   所以要查的是**目标侧那道闸门**本身：它必须仍是三种载荷都认的写法。
   */
  ok("★★★ 反向：目标侧闸门不再只认 input.target（否则上一条就是空转）",
    !/const t = ctx\?\.input\?\.target\?\.id;\s*\n\s*if \(t !== e\.id\) return;/.test(pr)
    && /if \(t !== e\.id\) return;/.test(pr));
  ok("★★★ 而且「暴击」族读 isCrit（此前每一次伤害都会触发它）", /requiresCrit && !ctx\?\.result\?\.isCrit/.test(pr));
}

// ── 夹具：把红方 1 号换成铁鼠（其被动「横财护身」= 受到攻击时 40% 概率给攻击者挂 buff）
// ★ both=true 时**两侧**都换成铁鼠（第 [4] 节要验"反击不连锁"，需要双方都有反击）。
//   第 [3] 节必须用**单侧**：两侧都换的话，红方打蓝方时**蓝方**的被动会正常触发 ——
//   第一版就是这么错的：我把"蓝方挨打触发"读成了"红方打人也触发"。
async function withRats(passives: any = "NOT_EXECUTED", both = true) {
  const m: any = canonicalMatch();
  m.red.units[0].shikigamiId = 232; m.red.units[0].name = "铁鼠";
  if (both) { m.blue.units[0].shikigamiId = 232; m.blue.units[0].name = "铁鼠"; }
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261001, passives });
  await a.battle.runStartup();
  const battle: any = a.battle;
  const rats = battle.allEntities().filter((e: any) => e.shikigamiId === 232);
  const red = rats.find((e: any) => e.teamId === 0);
  // ★ 单侧模式下蓝方**不是**铁鼠（要用一个普通单位当对手）—— 第一版在这里返回了 undefined，
  //   于是 battle.damage(red, undefined) 直接崩在 dealDamage 里（夹具错了，不是引擎错了）。
  const blue = both ? rats.find((e: any) => e.teamId === 1) : battle.allEntities().find((e: any) => e.teamId === 1);
  return { battle, red, blue };
}

sec("[3] ★★★ 目标侧接线（真行为）：挨打时触发，**打人时不触发** —— 修掉的正是后者");
{
  const { battle, red, blue } = await withRats("PARSED_CANDIDATES_ONLY", false);   // ★ 单侧：只有红方是铁鼠
  const applyCount = () => battle.trace.filter((t: any) => t.t === "STATUS_APPLY" && t.status === "2322_1").length;
  // ① 打人：铁鼠是**伤害来源** —— 一条「受到攻击时」的被动在这里**不许**触发
  red.hp = red.maxHp;
  const before = applyCount();
  for (let i = 0; i < 20; i++) await battle.damage(red, blue, 50, DamageType.NORMAL, 1);
  const attacked = applyCount() - before;
  ok("★★★ 铁鼠**打人**的 20 次里一次都没触发「受到攻击时」（旧代码在这里恰恰会触发）",
    attacked === 0, "触发 " + attacked + " 次");
  // ② 挨打：同一条被动必须触发（40% 概率，20 次里几乎必然至少一次）
  blue.hp = blue.maxHp;
  const before2 = applyCount();
  for (let i = 0; i < 20; i++) await battle.damage(blue, red, 50, DamageType.NORMAL, 1);
  const hit = applyCount() - before2;
  ok("★★★ 铁鼠**挨打**时必须触发（40% 概率 × 20 次）", hit > 0, "触发 " + hit + " 次");
  const applied = battle.trace.filter((t: any) => t.t === "STATUS_APPLY" && t.status === "2322_1");
  ok("★★ 而且 buff 挂在**伤害来源**身上（受击方判定对了，受益方才是对的）",
    applied.every((t: any) => t.dst === blue.id), JSON.stringify([...new Set(applied.map((t: any) => t.dst))]));
  console.log("    铁鼠打人 " + attacked + " 次触发｜挨打 " + hit + " 次触发（20 次攻击，标称 40%）");
}

sec("[4] ★★★ 反击端到端：伪回合 + 强制普攻 + 不连锁 + 被控不反击");
{
  const { battle, red, blue } = await withRats("NOT_EXECUTED");
  // 给双方的「横财护身」打上 counter 补丁 —— IR 是运行时与解析器之间的契约，
  // 这里验的是**运行时那一半**（解析那一半在第 [1] 节）。真实数据里没有一条同时满足两个条件（见第 [6] 节）。
  for (const r of [red, blue]) {
    const sk = r.skills.find((s: any) => s.name === "横财护身");
    // ★ evidence 必须是**这个单元自己的句子** —— 运行时按它把反击归因到那一句（见 passive-runtime 注释）。
    //   第一版随手写了 "probe"，于是 counterUnit = -1，反击按设计**不该**生效（测试当场红了）。
    // ★ 句子从 **IR** 里取（装配后的 skill 对象上没有 description）。
    //   运行时是"归一化后双向包含"比较，所以整段文本也满足条件（单元子句是它的子串）。
    const text = String((sk.ir.sentences ?? []).map((s: any) => s.text).join("。"));
    sk.ir.counter = { chance: null, evidence: text };
  }
  const rep: any = installPassiveSkills(battle, [red, blue], { mode: "PARSED_CANDIDATES_ONLY", tips: TIPS });
  ok("前置：被打上补丁的那两句真的装上了（family=受到攻击 → 目标侧）",
    rep.installed.some((i: any) => i.event === "BEFORE_DAMAGE"), JSON.stringify(rep.installed.map((i: any) => i.family + "/" + i.event)));

  red.hp = red.maxHp; blue.hp = blue.maxHp;
  const orbBefore = battle.teams[red.teamId].orbs.current;
  const turnsBefore = battle.trace.filter((t: any) => t.t === "TURN_START").length;
  const hpBlue = blue.hp;
  /**
   * ★ 注意：被打补丁的那条被动**自带 40% 概率条件**，所以一次伤害不一定引出反击。
   *   这里最多打 25 次（0.6^25 ≈ 3e-6 次全不中），出现第一条 COUNTER 就停。
   *   「条件与反击共用同一条判定链」这件事本身是对的（原文就是"受到攻击时 40% 概率…"）。
   */
  for (let i = 0; i < 25 && battle.trace.filter((t: any) => t.t === "COUNTER").length === 0; i++) {
    red.hp = red.maxHp;
    await battle.damage(blue, red, 80, DamageType.NORMAL, 1);
  }
  const counters = battle.trace.filter((t: any) => t.t === "COUNTER");
  ok("★★★ 出现 COUNTER 事件，且目标是**伤害来源**", counters.length === 1 && counters[0].actor === red.id && counters[0].target === blue.id,
    JSON.stringify(counters));
  const pseudo = battle.trace.filter((t: any) => t.t === "TURN_TYPE" && t.type === "PSEUDO_TURN");
  ok("★★★ 反击走的是**伪回合**（TURN_TYPE=PSEUDO_TURN），并且不推鬼火条/不触发回合开始结束",
    pseudo.length >= 1 && pseudo[pseudo.length - 1].advancesOrbGauge === false &&
    pseudo[pseudo.length - 1].turnStart === false && pseudo[pseudo.length - 1].turnEnd === false,
    JSON.stringify(pseudo.slice(-1)));
  ok("★★★ 强制的是**普攻**（SKILL_FORCED reason=COUNTER），不是「再放一个技能」",
    battle.trace.some((t: any) => t.t === "SKILL_FORCED" && t.reason === "COUNTER" && t.actor === red.id),
    JSON.stringify(battle.trace.filter((t: any) => t.t === "SKILL_FORCED").slice(-2)));
  ok("★★★ 伤害来源真的掉了血（反击打出去了）", blue.hp < hpBlue, hpBlue + " → " + blue.hp);
  ok("★★★ 伪回合不推进鬼火（这与普通回合的区别是可观测的）",
    battle.teams[red.teamId].orbs.current === orbBefore, orbBefore + " → " + battle.teams[red.teamId].orbs.current);
  ok("★★★ 也不触发 TURN_START", battle.trace.filter((t: any) => t.t === "TURN_START").length === turnsBefore);

  /**
   * ★★★ 防连锁（原文：「**若非进行反击**」）。
   *   判据不看数量，看**事件树**：每一条 COUNTER 的祖先链里都不许再出现 PSEUDO_TURN ——
   *   也就是说"反击打出来的伤害"没有再引出下一次反击。
   *   ★ 数数量是不够的：一次深两层、另一次零层，总数照样可能相等。
   */
  for (let i = 0; i < 25; i++) {
    red.hp = red.maxHp; blue.hp = blue.maxHp;
    await battle.damage(i % 2 === 0 ? blue : red, i % 2 === 0 ? red : blue, 80, DamageType.NORMAL, 1);
  }
  const all = battle.trace.filter((t: any) => t.t === "COUNTER");
  const nested = all.filter((t: any) => typeof t.ev === "number" && battle.bus.ancestry(t.ev).some((n: any) => n.code === "PSEUDO_TURN"));
  ok("★★★ **反击不连锁**：没有任何一次反击是「从反击里打出来的」（祖先链里没有 PSEUDO_TURN）",
    all.length >= 2 && nested.length === 0, "共 " + all.length + " 次反击｜嵌套 " + nested.length);

  // 被控不反击
  const before3 = battle.trace.filter((t: any) => t.t === "COUNTER").length;
  red.addStatus(StatusBook.get("stun") as any, 0, 1, 3);
  red.hp = red.maxHp;
  await battle.damage(blue, red, 100, DamageType.NORMAL, 1);
  ok("★★★ 被眩晕的单位**不反击**（与 isActionPrevented 同一判据）",
    battle.trace.filter((t: any) => t.t === "COUNTER").length === before3);
  red.expireStatus(red.statuses.find((s: any) => s.def.id === "stun")!);

  // 阵亡者不反击
  const before4 = battle.trace.filter((t: any) => t.t === "COUNTER").length;
  red.hp = 0;
  await battle.damage(blue, red, 100, DamageType.NORMAL, 1);
  ok("★★★ 已经阵亡的单位不反击", battle.trace.filter((t: any) => t.t === "COUNTER").length === before4);
}

sec("[5] ★★★ 逐句触发路由：一个被动不是一族、一个处理器");
{
  const unitsOf = (nm: string, sk: string) => classifyPassiveUnits(desc(nm, sk).replace(/<br>/g, "。"), -1);
  const jm = unitsOf("九命猫", "九命");
  ok("★★★ 九命猫「九命」= **3 句**（暴击时 / 阵亡时复活 / 阵亡时附加 buff）",
    jm.length === 3 && jm.map(u => u.family).join(",") === "暴击,阵亡,阵亡", JSON.stringify(jm.map(u => u.family)));
  ok("★★ 三句各自的判定不同：第 2 句被占位符挡住、第 3 句是候选（旧模型会把两句混成一句）",
    jm[1].verdict === "HAS_PLACEHOLDER" && jm[2].verdict === "CANDIDATE", JSON.stringify(jm.map(u => u.verdict)));
  const gn = unitsOf("骨女", "怨生");
  ok("★★★ 骨女「怨生」= **2 句**（受到攻击时 / 阵亡时）", gn.length === 2 && gn.map(u => u.family).join(",") === "受到攻击,阵亡",
    JSON.stringify(gn.map(u => u.family)));
  const ax = unitsOf("阿香", "蛇之影");
  ok("★★★ 阿香「蛇之影」= **2 句**，而反击写在**第二句**上 —— 那一句的族没有事件码（今天挂不上，如实记着）",
    ax.length === 2 && ax[1].clause.includes("反击") &&
    (TRIGGER_FAMILIES.find(t => t.family === ax[1].family)?.evCode ?? null) === null,
    JSON.stringify(ax.map(u => u.family)));
  ok("★★ 对照：单句被动仍然只有 1 个单元（不是把每一句都当成单元）",
    unitsOf("铁鼠", "横财护身").length === 1 && unitsOf("萤草", "生花").length === 1);
}

sec("[6] ★★★ 登记册：接线的那一类不再算未建模，没接线的继续算");
{
  ok("★★★ 「受到伤害时，有30%概率反击敌方」**不再**报未建模（这一类的运行时有了）",
    findUnm("受到伤害时，有30%概率反击敌方").length === 0, JSON.stringify(findUnm("受到伤害时，有30%概率反击敌方")));
  ok("★★★ 而「施放后…则反击攻击来源」（**主动技能**里的反击）仍然报 —— 部分接线要能如实表达",
    findUnm("对敌方目标造成攻击100%伤害，若目标未阵亡则反击攻击来源").some(h => h.verb === "反击"),
    JSON.stringify(findUnm("对敌方目标造成攻击100%伤害，若目标未阵亡则反击攻击来源")));
  const cap = CAPABILITIES.find(c => c.key === "COUNTER")!;
  ok("★★★ 能力表：反击的说明改写（不再是「没有任何生产者调用它」），但仍标 PARTIAL",
    cap.support === "PARTIAL" && !/没有任何生产者/.test(cap.note) && !!cap.producer, cap.note.slice(0, 40));
  const prod = producerScanFiles(ROOT).map(f => stripComments(fs.readFileSync(f, "utf8"))).join("\n");
  ok("★★ 那个 producer 真的在生产代码里", new RegExp(cap.producer!).test(prod));
  // ★ 诚实边界：全库**没有一条**技能同时满足"触发句是目标侧族"与"IR 里有 counter"
  let both = 0;
  for (const s of LIST) for (const k of (s.skills ?? [])) {
    const ir: any = compileSkill(s.id, s.name, k);
    if (!ir.counter) continue;
    const us = classifyPassiveUnits(String(k.description ?? "").replace(/<br>/g, "。"), Number(k.cost) || 0);
    // ★ 判据与运行时同源：**写着反击的那一句**（counter.evidence）必须落在某个目标侧单元里
    const ev = String(ir.counter.evidence ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "");
    if (us.some(u => {
      const nu = String(u.clause).replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "");
      return TRIGGER_FAMILIES.find(t => t.family === u.family)?.side === "TARGET" && nu.length > 4 && (nu.includes(ev) || ev.includes(nu));
    })) both++;
  }
  ok("★★★ 边界：全库同时满足两个条件的技能 = **0** —— 机制可达性是「用打了补丁的 IR 验的」，不是「真实数据验的」",
    both === 0, String(both));
}

sec("[7] ★★ 默认路径与 ON 路径的指纹逐位不变（这一轮改的是路由，不是默认行为）");
{
  for (const [mode, want] of [["NOT_EXECUTED", BASE], ["PARSED_CANDIDATES_ONLY", BASE_ON]] as const) {
    const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: mode });
    await a.battle.runStartup();
    await a.battle.run();
    const h = stateHash(captureState(a.battle));
    ok("★★★ " + mode + " 指纹 " + want + " 逐位不变", h === want, h);
  }
}

console.log("\n=== 反击 + 逐句路由: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
