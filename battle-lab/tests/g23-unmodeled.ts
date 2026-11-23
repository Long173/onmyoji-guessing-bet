// tests/g23-unmodeled.ts — ★ 「自称完整编译」的水分必须被挤掉（目标 ①：Fidelity 不许过度声称）
//
// 由来：句子分类是**整句**级的 —— 只要匹配到任何一个模式（哪怕 [tips_1] 这种纯引用）就记 PARSED。
// 于是「战斗开始时获得[buff]，受到致命伤害时复活」这种句子被报成 confidence=HIGH / unparsed=0，
// Fidelity 的 SKILL 层据此算进「完整编译（无可执行缺口）」。
//
// 第 27 轮试过"子句里有机制词就判未建模"，结果大面积误报（印记自带效果、条件碎片）。
// 这一版只收**能证明引擎里没有行为代码**的动词，并排除三种误报。本测试同时锁住两边：
//   ① 真机制必须被标出来；② 误报类（过滤器/条件碎片/免疫声明）必须**不**被标出来。
import fs from "node:fs";
import path from "node:path";
import { compileSkill, splitClauses } from "../compile/skill-compiler.ts";
import { UNMODELED, findUnmodeled } from "../compile/unmodeled.ts";
import { assessFidelity } from "../kernel/fidelity.ts";
import type { FidelityInput } from "../kernel/fidelity.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const mk = (desc: string) => compileSkill(1, "探查单位", { id: "probe", name: "探查", cost: 0, description: desc });

sec("[1] 表本身：每条都写清「缺什么」和「怎么验证的」");
{
  ok("动词表非空", UNMODELED.length > 10, String(UNMODELED.length));
  ok("★ 每条都有 missing（缺的是什么）", UNMODELED.every(m => m.missing.length > 6));
  ok("★ 每条都有 evidence（验证依据）", UNMODELED.every(m => m.evidence.length > 6));
  ok("动词不重复", new Set(UNMODELED.map(m => m.verb)).size === UNMODELED.length);
}

sec("[2] ★ 真机制必须被标成未建模（否则又被自称完整编译）");
{
  const cases: Array<[string, string]> = [
    ["战斗开始时获得[buff]，受到致命伤害时复活阵亡的友方目标", "复活"],
    // 真正的召唤：会生成一个**留在场上**的单位（"番茄可使用『愤怒』"）
    ["召唤番茄，番茄可使用『愤怒』", "召唤"],
    ["在所有阵亡的友方位置均召唤1个棺材", "召唤"],
    // ★★★ 第 95 轮：这里原本是 ["受到伤害时，有30%概率反击发起攻击的敌方目标", "反击"]。
    //   那条断言**转向**了 —— 反击的**这一种写法**已经接线（`Battle.counterAttack` + 逐句触发路由，
    //   见 tests/g56），于是它不再算未建模机制。旧那行留在这里：它当时是对的。
    //   同一条原文现在钉在 [3] 的反向列表里（不许再被判为未建模）。
    // ★★★ 第 93 轮：这里原本是 ["造成伤害时，有50%概率附带20%吸血", "吸血"]。
    //   那条断言**转向**了 —— 吸血已经接进伤害管线（SkillIR.lifesteal + applyLifesteal + 被动运行时），
    //   所以它不再是"未建模机制"。旧那行留在注释里：它当时是对的，
    //   而且它正是**逼出这次实现**的那条断言（Fidelity 会照着它告诉用户"这条依赖未实现的吸血"）。
    //   同一条原文现在钉在 [3] 的反向列表里：不许再被判为未建模。
    ["免疫行动条击退效果", "免疫"],
    ["将指定敌方目标变形为[tips_5723]，持续1回合", "变形"],
    /**
     * ★★★ 第 104 轮：这条探针**按事实改写**。原来用的是「偷取1个增益状态」——
     *   而增益偷取这一轮实现了（kernel/steal.ts 的 stealBuff + character.ts 的执行点），
     *   于是那句话不再由未建模表负责。剩下的两种**没有执行点**的写法才是这一条的适用范围：
     *   「造成伤害时…偷取」（逐次伤害触发）与「施放『X』前，先偷取…」（施放前被动）。
     */
    /**
     * ★★★ 第 105 轮：探针**再改一次**。「造成伤害时…偷取」这一轮接上了执行点
     *   （被动运行时的 AFTER_DAMAGE，见 §90），于是它不再由未建模表负责。
     *   仍然没有执行点的是「**受到**伤害时…偷取」与「施放『X』前，先偷取…」——
     *   用前者作探针（与被替换的那条只差一个字，读者一眼能看出是同一族的边界）。
     */
    ["受到伤害时，偷取目标40%暴击，持续1回合", "偷取"],
    ["转移附身到另外一个友方单位", "转移"],
    ["受到的伤害由友方分摊", "分摊"],
  ];
  for (const [desc, verb] of cases) {
    const hits = findUnmodeled(desc, splitClauses);
    ok("★ 「" + verb + "」被识别为未建模", hits.some(h => h.verb === verb), JSON.stringify(hits));
  }
  const ir = mk("战斗开始时获得[buff_2173_1]，受到致命伤害时复活阵亡的友方目标");
  ok("★ 这类句子不再算 PARSED：unparsed 里有它", ir.unparsed.length > 0, JSON.stringify(ir.sentences));
  ok("★ 置信度不再自称 HIGH（有未解析机制就不该是 HIGH）", ir.confidence !== "HIGH", ir.confidence);
}

sec("[3] ★★ 三种误报必须**不**被标出来（这是第 27 轮翻车的地方）");
{
  const negatives: Array<[string, string]> = [
    ["使非召唤物的友方全体获得护盾，能吸收12%生命上限的伤害", "过滤器：非召唤物"],
    ["为2个生命比例最低的非召唤物友方目标治疗生命上限12%的生命", "过滤器：非召唤物友方"],
    ["该护盾不可驱散，且无法被解除", "免疫声明"],
    ["冰冻无法被驱散", "免疫声明"],
    // ★★ 修辞用法：写了"召唤"，但整句讲的是**一次攻击**。第 29 轮实测：
    //    45 个被标为"召唤未建模"的技能里有 19 个是这一类；若不过滤，
    //    Fidelity 面板会告诉用户「雪女「暴风雪」依赖未建模的召唤机制」—— 那是假话。
    ["召唤暴风雪攻击敌方全体3次，每次造成攻击30%的伤害", "修辞：召唤+攻击"],
    ["召唤飓风形成大型的羽刃旋涡攻击敌方全体4次", "修辞：召唤+形成"],
    ["击鼓召唤雷云，降下数道闪电攻击敌方全体2次", "修辞：伤害在隔壁子句"],
    ["对召唤物造成双倍伤害", "过滤器：对召唤物"],
    // ★★★ 第 95 轮：反击**部分接线**（只有「受到伤害时 / 受到攻击时」这一族 + IR 里解析出 counter），
    //   所以这一句不许再报未建模；而「若非进行反击」这类抑制句本来就不该报（第 95 轮新加的判据）。
    ["受到伤害时，有30%概率反击发起攻击的敌方目标", "已建模：反击（第 95 轮接线；主动技能里的反击仍未接线）"],
    // ★★★ 第 93 轮：已建模的机制**不许**再报未建模 —— 这是 [2] 里那条转向断言的另一半。
    //   只钉"它不再出现"是不够的：还要钉住**同一句话**在两边得到相反结论，才说明这次改动真的生效。
    ["造成伤害时，有50%概率附带20%吸血", "已建模：吸血（第 93 轮接线）"],
    ["上限4层", "条件/上限碎片"],
    ["受到伤害时", "条件碎片（没有主句）"],
  ];
  for (const [desc, why] of negatives) {
    const hits = findUnmodeled(desc, splitClauses);
    ok("不误报：" + why, hits.length === 0, JSON.stringify(hits));
  }
  // 印记自带的属性效果**不是**机制缺失（第 27 轮的误报主体）
  const statClauses = ["使目标受到的伤害增加10%", "每层提升5%攻击", "降低10%效果命中", "永久提升自身5点速度"];
  const falseHits = statClauses.flatMap(c => findUnmodeled(c, splitClauses));
  ok("★ 印记属性类子句（增伤/攻击/命中/速度）一条都不误报", falseHits.length === 0, JSON.stringify(falseHits));
}

sec("[4] 全库口径：水分从 257 降到多少（且没有把 FLAVOR 也算进去）");
{
  const shiki = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const list = Array.isArray(shiki) ? shiki : (shiki.characters ?? shiki.items ?? []);
  let total = 0, masked = 0, byVerb: Record<string, number> = {};
  for (const c of list) for (const sk of (c.skills ?? [])) {
    const txt = String(sk.description ?? "");
    for (const s of txt.split(/[。\n]/)) {
      if (!s.trim()) continue;
      total++;
      const hits = findUnmodeled(s, splitClauses);
      if (hits.length) { masked++; byVerb[hits[0].verb] = (byVerb[hits[0].verb] ?? 0) + 1; }
    }
  }
  console.log("    全库句子 " + total + "｜含未建模机制的 " + masked);
  console.log("    按动词：" + JSON.stringify(byVerb));
  ok("★ 确实找出一批（不是 0）", masked > 0, String(masked));
  ok("★ 但远小于「所有带机制词的句子」（说明过滤器/条件/属性类被排除了）", masked < total * 0.25, masked + "/" + total);
  ok("每个动词的计数都是正数（没有空收的条目）", Object.values(byVerb).every(v => v > 0));
  // 召唤是过滤器最多的词 —— 必须明显少于"含召唤字样的句子数"
  let summonText = 0;
  for (const c of list) for (const sk of (c.skills ?? [])) if (String(sk.description ?? "").includes("召唤")) summonText++;
  ok("★ 「召唤」的命中数明显少于含该字样的技能数（过滤器被排除）",
    (byVerb["召唤"] ?? 0) < summonText * 0.6, (byVerb["召唤"] ?? 0) + " vs " + summonText);
}

sec("[5] Fidelity 的 SKILL 层会因此更诚实");
{
  const ir = mk("召唤1只[buff_5991]攻击敌方目标，造成攻击75%的伤害");
  ok("前置：这个技能确实解析出了伤害（不是空技能）", ir.damage.length > 0, JSON.stringify(ir.damage));
  ok("★ 但它同时带着未解析机制 —— 不会被算作「完整编译」", ir.unparsed.length > 0, JSON.stringify(ir.unparsed));
  const ir2 = mk("对敌方目标造成攻击100%的伤害");
  ok("对照：纯伤害技能仍然是 HIGH（不能把所有技能都判低）", ir2.confidence === "HIGH" && ir2.unparsed.length === 0, JSON.stringify([ir2.confidence, ir2.unparsed]));
}


sec("[6] ★ Fidelity 的 SKILL 层必须**逐条点名**未建模机制（而不是只说 N 句未解析）");
{
  // 直接构造 FidelityInput：两个技能，一个依赖召唤（真），一个是普通伤害
  const input = {
    units: [{ name: "探查甲", side: "red" as const, panelFilled: 4, soul: null,
      skills: [
        { name: "召魂", confidence: "HIGH" as const, cost: 3, parsed: { damage: 1, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 }, unparsedSentences: 1,
          unmodeled: [{ verb: "召唤", missing: "没有任何地方向 Team.summons 里放单位", severity: "WARN" as const }] },
        { name: "平砍", confidence: "HIGH" as const, cost: 0, parsed: { damage: 1, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 }, unparsedSentences: 0 },
      ],
      ai: { dataPresent: true, compiled: true, confidence: "HIGH" as const, gameVerified: false } }],
    ruleset: [{ id: "R1", status: "UNKNOWN" as const }],
    capabilities: [],
    displayPrecision: "INTEGER_OBSERVED" as const,
  };
  const f = assessFidelity(input);
  const skillLayer = f.layers.find((l: any) => l.layer === "SKILL");
  const counts = Object.fromEntries(skillLayer.counts.map((c: any) => [c.label, c.value]));
  ok("★ 计数里有「依赖未建模机制的技能」且为 1", counts["依赖未建模机制的技能"] === "1", JSON.stringify(counts));
  const gap = skillLayer.gaps.find((g: any) => /未建模机制/.test(g.what));
  ok("★★ 缺口里点名了机制（召唤）与涉及的单位", !!gap && /召唤/.test(gap.what) && /探查甲/.test(gap.what), JSON.stringify(gap));
  ok("★★ 缺口里写明了引擎缺什么（不是笼统一句没实现）", !!gap && /召唤物|summons/.test(gap.detail), JSON.stringify(gap?.detail));
  /**
   * ★★★ 第 112 轮：严重度**跟着记录走**（记录由动词表或编译器声明），报告层不再按名字猜。
   *   于是这条断言的输入必须自己声明 WARN；下面再加一条反向 —— 不声明就只能是 INFO。
   */
  ok("召唤被判为 WARN（影响战局的缺口由**记录**声明，不是报告层按名字猜）", gap?.severity === "WARN", String(gap?.severity));
  {
    const bare: any = JSON.parse(JSON.stringify(input));
    delete bare.units[0].skills[0].unmodeled[0].severity;
    const fb: any = assessFidelity(bare);
    const gb = fb.layers.find((l: any) => l.layer === "SKILL").gaps.find((g: any) => /未建模机制/.test(g.what));
    ok("★★★ 反向：记录没声明严重度 ⇒ INFO（报告层**不再**维护「召唤/复活」那张名单）",
      gb?.severity === "INFO", String(gb?.severity));
  }
  ok("对照：纯伤害技能不进缺口列表", !skillLayer.gaps.some((g: any) => /平砍/.test(g.what)), JSON.stringify(skillLayer.gaps.map((g: any) => g.what)));
}
console.log("\n=== 未建模机制识别: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
