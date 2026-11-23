// tests/ui10-fidelity.ts — ★ Per-Match Fidelity 验收（a1-4 §1-§10、§33）
//
// 文档最强调的一条（§3）：**不能说"当前模拟器有 80% 真实性"**。
// 所以这里既验证"五层都算得出来"，更验证"**没有任何地方输出百分比评分**"。
import fs from "node:fs";
import path from "node:path";
import { createEngineAdapter } from "../src/adapters/engine-adapter.ts";
import { canonicalMatch } from "../src/mock/canonical-match.ts";
import { assessFidelity, FIDELITY_CLASS_LABEL, classifySkill, SKILL_CLASS_LABEL as KERNEL_SKILL_LABEL, SKILL_CLASS_MARK as KERNEL_SKILL_MARK } from "../../../battle-lab/kernel/fidelity.ts";
// ★ 第 138 轮：§33 的**逐技能**一层（契约镜像 + 取数助手）
import { SKILL_LABEL, SKILL_MARK, SKILL_TIER_ORDER, SKILL_SEVERITY, skillStatusOf, skillTally, worstSkillClass, groupSkillStatus } from "../src/contracts/fidelity-view.ts";

const here = import.meta.dirname;
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const S = (p: string) => fs.readFileSync(path.join(here, "..", "src", p), "utf8");

const bundle = JSON.parse(fs.readFileSync(path.join(here, "..", "src", "engine", "bundle.json"), "utf8"));
const adapter = createEngineAdapter(bundle);

sec("[1] 纯函数层：分类规则（§10）");
{
  const base = (over: any = {}) => ({
    units: [{ name: "A", side: "red" as const, panelFilled: 4, soul: null,
      skills: [{ name: "s", confidence: "HIGH" as const, cost: 0, parsed: { damage: 1, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 }, unparsedSentences: 0 }],
      ai: { dataPresent: true, compiled: true, confidence: "HIGH" as const, gameVerified: true } }],
    ruleset: [{ id: "R", status: "VERIFIED" as const }],
    capabilities: [{ name: "DAMAGE", support: "FULL" as const, useCount: 1 }],
    displayPrecision: "EXACT" as const, ...over,
  });
  ok("★ 全 FULL + AI 已验证 + 规则全 VERIFIED → VERIFIED", assessFidelity(base()).klass === "VERIFIED");
  ok("★ 有 UNKNOWN 规则时**绝不允许**判成 VERIFIED", assessFidelity(base({ ruleset: [{ id: "R", status: "UNKNOWN" }] })).klass !== "VERIFIED");
  ok("主动技能无可执行数值 → INSUFFICIENT", assessFidelity(base({ units: [{ ...base().units[0], skills: [{ name: "s", confidence: "LOW", cost: 0, parsed: { damage: 0, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 }, unparsedSentences: 0 }] }] })).klass === "INSUFFICIENT");
  ok("★ 被动技能无可执行数值 → **不算** INSUFFICIENT（已知边界）", assessFidelity(base({ units: [{ ...base().units[0], skills: [{ name: "p", confidence: "LOW", cost: -1, parsed: { damage: 0, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 }, unparsedSentences: 0 }] }] })).klass === "VERIFIED");
  ok("机制未实现 → INSUFFICIENT", assessFidelity(base({ capabilities: [{ name: "X", support: "NONE", useCount: 1 }] })).klass === "INSUFFICIENT");
  // ★★ 第 60 轮把这条从「是 PARTIAL 或 COMPLETE_UNVERIFIED 都算过」收紧成**确定的那一个**。
  //   原来那种写法（两个都接受）正好把下面这张映射表的歧义盖住了：
  //   分类到底是按"代码路径完不完整"分，还是按"有没有 UNKNOWN"分，两边都算对。
  const skillPartialCase = (over: any = {}) => base({ units: [{ ...base().units[0], skills: [{ name: "s", confidence: "MEDIUM", cost: 0, parsed: { damage: 1, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 }, unparsedSentences: 2 }] }], ...over });
  ok("★★ 技能有未建模附加效果 → PARTIAL（代码路径不完整）", assessFidelity(skillPartialCase()).klass === "PARTIAL");

  /**
   * ★★★ 分类映射表（§10）—— 按**成因**分，四种组合各断言一次，两个方向都覆盖。
   *   规格的两条定义：
   *     COMPLETE_UNVERIFIED =「代码路径完整 + 没有 NONE + 但仍包含未游戏实测机制」
   *     PARTIAL             =「存在 PARTIAL，但可以运行」
   *   二者互斥：有 PARTIAL ⇒ 代码路径不完整 ⇒ 只能是 PARTIAL，
   *   此时**哪怕同时有一堆 UNKNOWN 规则**也不能改判成 COMPLETE_UNVERIFIED（那会过度声称）。
   *   第 60 轮之前这里错了 4 种组合，而且错的方向是过度声称 —— 见报告 §45。
   */
  const capPartial = { capabilities: [{ name: "DAMAGE", support: "PARTIAL" as const, useCount: 1 }] };
  const capNone = { capabilities: [{ name: "X", support: "NONE" as const, useCount: 1 }] };
  const aiNo = { units: [{ ...base().units[0], ai: { dataPresent: true, compiled: true, confidence: "HIGH" as const, gameVerified: false } }] };
  const ruleUnknown = { ruleset: [{ id: "R", status: "UNKNOWN" as const }] };
  const ruleHypo = { ruleset: [{ id: "R", status: "HYPOTHESIS" as const }] };
  const table: Array<[string, any, string]> = [
    ["① 全 FULL + AI 已验证 + 规则 VERIFIED", base(), "VERIFIED"],
    ["② 有机制 NONE", base(capNone), "INSUFFICIENT"],
    ["③ 有 PARTIAL 机制，规则全 VERIFIED", base(capPartial), "PARTIAL"],
    ["④ 有 PARTIAL 机制 **且** 有 UNKNOWN 规则 ⇒ 仍是 PARTIAL（不得改判）", base({ ...capPartial, ...ruleUnknown }), "PARTIAL"],
    ["⑤ 只有 AI 未验证（无 PARTIAL、无 UNKNOWN）⇒ 代码路径完整", base(aiNo), "COMPLETE_UNVERIFIED"],
    ["⑥ 技能有未建模附加效果", skillPartialCase(), "PARTIAL"],
    ["⑦ 技能有未建模附加效果 **且** 有 UNKNOWN 规则 ⇒ 仍是 PARTIAL", skillPartialCase(ruleUnknown), "PARTIAL"],
    ["⑧ 只有 HYPOTHESIS 规则 ⇒ 代码路径完整", base(ruleHypo), "COMPLETE_UNVERIFIED"],
  ];
  for (const [name, input, want] of table) {
    const got = assessFidelity(input).klass;
    ok("★★ 映射表 " + name, got === want, "期望 " + want + " 实得 " + got);
  }
  // 反向：NONE 优先级最高，压过 PARTIAL 与 UNKNOWN（否则会把不可用的局说成"可以运行"）
  ok("★★★ NONE 压过一切：同时有 NONE / PARTIAL / UNKNOWN ⇒ INSUFFICIENT",
    assessFidelity(base({ ...capNone, ...ruleUnknown, capabilities: [{ name: "X", support: "NONE" as const, useCount: 1 }, { name: "DAMAGE", support: "PARTIAL" as const, useCount: 1 }] })).klass === "INSUFFICIENT");
  // 反向：VERIFIED 是**最严**的一档 —— 任何一个成因缺席都不许出现
  ok("★★★ 四种成因各自缺席时都不许判 VERIFIED",
    assessFidelity(base(capPartial)).klass !== "VERIFIED" &&
    assessFidelity(base(aiNo)).klass !== "VERIFIED" &&
    assessFidelity(base(ruleUnknown)).klass !== "VERIFIED" &&
    assessFidelity(base({ ruleset: [] })).klass !== "VERIFIED");
  const f = assessFidelity(base());
  ok("★ 五层齐备", f.layers.length === 5 && f.layers.map(l => l.layer).join(",") === "INPUT,SKILL,AI,MECHANIC,RULESET");
  ok("★ 输出里**没有**任何百分比真实性评分", !JSON.stringify(f).match(/真实(性)?"?\s*[:：]?\s*\d+(\.\d+)?%/));
  ok("免责声明里明确写了「不给百分比」", f.caveats.some(c => /不给「真实性百分比」/.test(c)));
  // ★★ 御魂三态必须分开：null（输入缺失）/ resolved=false（解析不了）/ true（已识别）。
  //   合并任意两态都会产生"把没有信息当成信息没问题"或反过来的过度声称。
  const soulCase = (soul: any) => assessFidelity(base({ units: [{ ...base().units[0], soul }] }));
  const inputOf = (f: any) => f.layers.find((l: any) => l.layer === "INPUT");
  const missing = inputOf(soulCase(null));
  const unresolved = inputOf(soulCase({ id: 5, resolved: false, support: "UNSUPPORTED" }));
  const okSoul = inputOf(soulCase({ id: 0, resolved: true, support: "FULL" }));
  ok("★★ 态一 输入缺失（soul=null）→ 不判 COMPLETE，且计数里写「御魂输入缺失 1/1」",
    missing.klass !== "COMPLETE" && missing.counts.some((c: any) => /御魂输入缺失/.test(c.label) && c.value === "1/1"), JSON.stringify(missing.counts));
  ok("★★ 态二 解析不了（resolved=false）→ 也不判 COMPLETE，且报的是「无法解析」而不是「缺失」",
    unresolved.klass !== "COMPLETE" && unresolved.gaps.some((g: any) => /无法解析/.test(g.what)), JSON.stringify(unresolved.gaps));
  ok("★★ 态三 已识别（resolved=true）→ COMPLETE（正向对照，防止「永远判 PARTIAL」）",
    okSoul.klass === "COMPLETE", JSON.stringify(okSoul.counts));
  ok("★ 三态互不混淆：缺失态不产生「无法解析」条目，解析失败态不产生「没有御魂信息」条目",
    !missing.gaps.some((g: any) => /无法解析/.test(g.what)) && !unresolved.gaps.some((g: any) => /没有御魂信息/.test(g.what)));
}

sec("[2] 真实对局：典型对局 #001 的 Fidelity 报告");
const v = await adapter.validate(canonicalMatch());
const fid: any = v.fidelity;
ok("validate() 会给出 fidelity（§33：编辑器里就能看到）", !!fid);
ok(`分类 = ${fid.klass}`, ["VERIFIED", "COMPLETE_UNVERIFIED", "PARTIAL", "INSUFFICIENT"].includes(fid.klass));
ok("五层都有计数与结论", fid.layers.every((l: any) => l.counts.length >= 3 && ["COMPLETE", "PARTIAL", "GAPS", "UNKNOWN"].includes(l.klass)));
const input = fid.layers.find((l: any) => l.layer === "INPUT");
  // ★★ 这条断言以前写的是「Input 层 COMPLETE（…10/10 御魂）」—— 那是**假的**：
  //   典型对局的 10 个单位 soulId 全是 null，「没有信息」被算成了「已识别」。
  //   一个断言把过度声称锁了整整若干轮。现在它断言正确的行为。
  ok("★★ 御魂输入缺失必须报成缺失，不得算作已识别（10/10 无信息 → Input 层 PARTIAL）",
    input.klass === "PARTIAL" && input.counts.some((c: any) => /御魂输入缺失/.test(c.label) && /10\/10/.test(c.value)),
    JSON.stringify(input.counts));
  ok("★ 已识别计数如实为 0/10（而不是 10/10）",
    input.counts.some((c: any) => c.label === "御魂已识别" && c.value === "0/10"), JSON.stringify(input.counts));
  ok("★★ 后果写进**顶层** caveat：本局不可能触发御魂效果",
    fid.caveats.some((c: string) => /御魂输入缺失/.test(c)), JSON.stringify(fid.caveats));
  ok("★ 缺口条目说明这不是御魂机制的问题，而是这份输入检验不了它",
    input.gaps.some((g: any) => /没有御魂信息/.test(g.what) && /g30/.test(g.detail)), JSON.stringify(input.gaps));
  // 正向对照：没有它，上面的 PARTIAL 分不清是「输入缺失」还是「永远判 PARTIAL」。
  {
    const withSoul: any = canonicalMatch();
    for (const side of ["red", "blue"] as const) for (const u of withSoul[side].units) u.soulId = 0;
    const v2: any = await adapter.validate(withSoul);
    const in2 = v2.fidelity.layers.find((l: any) => l.layer === "INPUT");
    ok("★★ 正向对照：装上可解析的御魂后 Input 层回到 COMPLETE，且已识别 10/10",
      in2.klass === "COMPLETE" && in2.counts.some((c: any) => c.label === "御魂已识别" && c.value === "10/10"),
      JSON.stringify(in2.counts));
    ok("★ 正向对照里没有「御魂输入缺失」这条 caveat",
      !v2.fidelity.caveats.some((c: string) => /御魂输入缺失/.test(c)));
  }
ok("★ 明确标注显示精度为整数观测（§2）", fid.caveats.some((c: string) => /显示精度/.test(c)));
  ok("★★ 顶层 caveat 点明效果命中/抵抗未参与结算（面板上那两维没有消费者）",
    fid.caveats.some((c: string) => /效果命中 \/ 效果抵抗未参与任何结算/.test(c)), JSON.stringify(fid.caveats));
const skill = fid.layers.find((l: any) => l.layer === "SKILL");
ok("★ Skill 层把被动与主动缺口分开计数", skill.counts.some((c: any) => /被动技能/.test(c.label)) && skill.counts.some((c: any) => /主动技能但无可执行数值/.test(c.label)));
ok("★ 主动技能无缺口（否则本局不该被判为可用）", Number(skill.counts.find((c: any) => /主动技能但无可执行数值/.test(c.label)).value) === 0);
const ai = fid.layers.find((l: any) => l.layer === "AI");
ok("★ AI 层三态分开，且 GAME-VERIFIED 如实为 0（§6）", ai.counts.some((c: any) => /已验证/.test(c.label) && /0/.test(c.value)));
ok("AI 层缺口写明「未经验证」而不是「已实现」", ai.gaps.some((g: any) => /未经游戏内验证/.test(g.detail)));
const mech = fid.layers.find((l: any) => l.layer === "MECHANIC");
ok("★ Mechanic 层是「本局需要的能力」而不是全库覆盖度（§7）", mech.counts.some((c: any) => /本局涉及能力/.test(c.label)) && Number(mech.counts.find((c: any) => /本局涉及能力/.test(c.label)).value) < 20);
const rules = fid.layers.find((l: any) => l.layer === "RULESET");
ok("★ Ruleset 层如实报出 UNKNOWN 数（§8）", Number(rules.counts.find((c: any) => c.label === "UNKNOWN").value) >= 1);
ok("★ 存在 UNKNOWN 时给出明确免责", fid.caveats.some((c: string) => /不能宣称|UNKNOWN/.test(c)));
ok("理由逐条列出（不是一句话打发）", fid.reasons.length >= 3, JSON.stringify(fid.reasons));

sec("[3] 界面接线（§9 真实性报告 / §33 集成到编辑器）");
{
  const panel = S("components/simulation/FidelityPanel.vue");
  ok("FidelityPanel 存在且渲染五层", /layers/.test(panel) && /Simulation fidelity for this match/.test(panel));

  /**
   * ★★★ 第 61 轮：界面文案此前是一份**没人管的私有副本**（键对不对、用词从哪来，都没有约束）。
   *   这一节把它钉到内核那张表上：
   *     ① 键必须一一对应（内核加一档、界面漏掉 ⇒ 红）；
   *     ② 每个词必须在内核文案里原样找得到（界面自造措辞 ⇒ 红）；
   *     ③ PARTIAL 必须保留「可以运行」（§10 的限定语，丢掉它分类就读起来像故障灯）。
   */
  const grab = (name: string): Record<string, string> => {
    const m = panel.match(new RegExp("const " + name + "[^=]*=\\s*\\{([\\s\\S]*?)\\};"));
    const out: Record<string, string> = {};
    for (const e of (m?.[1] ?? "").matchAll(/(\w+)\s*:\s*"([^"]*)"/g)) out[e[1]] = e[2];
    return out;
  };
  const uiLabels = grab("KLASS_LABEL");
  const uiTones = grab("KLASS_TONE");
  const want = Object.keys(FIDELITY_CLASS_LABEL).sort().join(",");
  ok("★★★ 界面分类文案的键与内核完全一致（两个方向都查）",
    Object.keys(uiLabels).sort().join(",") === want, "界面 " + Object.keys(uiLabels).join(",") + "｜内核 " + want);
  ok("★★★ 配色表覆盖全部四档（新档不许悄悄退化成 idle 灰）",
    Object.keys(uiTones).sort().join(",") === want, JSON.stringify(uiTones));
  //   ★ 界面已英文化（内核文案仍为中文），「每个词都能在内核原文里找到」这条用词子集约束不再适用；
  //     改为：每一档都有非空、且已完整翻译（不残留中文）的英文短标签。
  const untranslated = Object.entries(uiLabels).filter(([, v]) => !v.trim() || /[一-鿿]/.test(v));
  ok("★★ 界面分类文案每一档都有完整的英文短标签", untranslated.length === 0, JSON.stringify(untranslated));
  ok("★★★ PARTIAL 保留了「可以运行」这个限定语（§10：存在 PARTIAL，**但可以运行**）",
    /can run/.test(uiLabels.PARTIAL ?? ""), uiLabels.PARTIAL);
  ok("★ 界面分类文案里没有百分比", !/[0-9]+\s*%/.test(Object.values(uiLabels).join(" ")), JSON.stringify(uiLabels));
  ok("★ 面板不展示百分比真实性评分（只展示层级状态与计数）", !/真实[性]?\s*[:：]\s*\{\{/.test(panel) && !/真实性\s*\d+%/.test(panel) && !/fidelity\s*[:：]?\s*\d+\s*%/i.test(panel) && /Simulation fidelity for this match/.test(panel));
  ok("面板面向「跑之前」的决策", /跑之前/.test(panel) || /Simulation fidelity for this match/.test(panel));
  const app = S("App.vue");
  ok("★ 阵容编辑器里就挂着 FidelityPanel（§33）", /FidelityPanel/.test(app) && /sim\.validation\?\.fidelity/.test(app));
  const dash = S("components/result/ResultDashboard.vue");
  ok("结果页也带上（结果与可信度一起看）", /FidelityPanel/.test(dash) && /fidelity/.test(dash));
  ok("契约给 ValidationReport 增加了可选 fidelity", /fidelity\?: unknown/.test(S("contracts/worker-api.ts")));
}

sec("[8] ★★★ §33 逐技能机制实现度：载荷 → 契约镜像 → 卡面/抽屉/面板")
{
  const rep: any = await adapter.validate(canonicalMatch());
  const f2 = rep.fidelity;
  const list: any[] = f2?.skills ?? [];
  ok("★★★ 载荷里带上了逐技能一层（30 个技能；第 137 轮之前只有聚合计数）", list.length === 30, String(list.length));
  const tiers = ["FULL", "PARTIAL", "PASSIVE", "NONE"];
  ok("★★★ 每一条都有一个合法的档位，且带得上 side / unit / name（界面按 side+名字取数）",
    list.every(s => tiers.includes(s.klass) && (s.side === "red" || s.side === "blue") && !!s.unit && !!s.name),
    JSON.stringify(list.filter(s => !tiers.includes(s.klass)).slice(0, 3)));
  const skillLayer = f2.layers.find((l: any) => l.layer === "SKILL");
  //   ★ 第一版这里忘了 Number()：value 是字符串 "22"，与数字 22 恒不相等 —— 断言写错（跑出来一对数字明明一样）。
  const cnt = (re: RegExp) => Number(skillLayer.counts.find((c: any) => re.test(c.label))?.value);
  const byClass = (k: string) => list.filter(s => s.klass === k).length;
  ok("★★★ 四档条数 == 面板上的四个计数（适配器不许在组装时丢字段或改口径）",
    byClass("FULL") === cnt(/完整编译/) && byClass("PARTIAL") === cnt(/部分编译/) && byClass("PASSIVE") === cnt(/被动技能/) && byClass("NONE") === cnt(/主动技能但无可执行数值/),
    JSON.stringify({ FULL: byClass("FULL"), PARTIAL: byClass("PARTIAL"), PASSIVE: byClass("PASSIVE"), NONE: byClass("NONE"), counts: [cnt(/完整编译/), cnt(/部分编译/), cnt(/被动技能/), cnt(/主动技能但无可执行数值/)] }));
  ok("★★★ 「四档合计」== 技能总数 == 载荷条数（穷尽性；第 138 轮之前 22+5=27≠30）",
    cnt(/四档合计/) === 30 && cnt(/本局技能总数/) === 30);
  ok("★★★ 仍然没有任何百分比真实性评分", !JSON.stringify(f2).includes("%"));

  // ── 契约镜像不漂移：界面词汇与内核词汇逐字节相等（两向） ──
  ok("★★★ 记号的键与值都与内核逐字节一致", JSON.stringify(SKILL_MARK) === JSON.stringify(KERNEL_SKILL_MARK), JSON.stringify([SKILL_MARK, KERNEL_SKILL_MARK]));
  //   ★ 界面短标签已英文化（内核仍是中文），所以只能逐字节比**键**（档位集合与顺序）；值改为要求非空英文。
  ok("★★★ 短标签的键与内核逐字节一致（值为英文译文）", JSON.stringify(Object.keys(SKILL_LABEL)) === JSON.stringify(Object.keys(KERNEL_SKILL_LABEL)), JSON.stringify([SKILL_LABEL, KERNEL_SKILL_LABEL]));
  ok("★★ 短标签每一档都是非空英文（不残留中文）", Object.values(SKILL_LABEL).every(v => !!v.trim() && !/[一-鿿]/.test(v)), JSON.stringify(SKILL_LABEL));
  const mutated = { ...SKILL_LABEL, EXTRA: "X" };
  ok("★★ 正向对照：上面那条比对不是空的（多一档就该不相等）", JSON.stringify(Object.keys(mutated)) !== JSON.stringify(Object.keys(KERNEL_SKILL_LABEL)));
  //   ★ 判据必须**去掉注释**再找：这个文件的头注释里就写着 @engine（说明为什么不能 import 它）。
  //     第一版直接在原文上找 ⇒ 被自己的注释判红 —— 与 g91 第 [5] 节踩的是同一个坑。
  const contractSrc = S("contracts/fidelity-view.ts").split("\n")
    .filter((l: string) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
  ok("★★ 界面层没有 import @engine（vite alias 的约束：页面只读契约，不读引擎源码）",
    !/from\s+"@engine/.test(contractSrc) && !/from\s+"@engine/.test(S("components/lineup/UnitTile.vue")));

  // ── 取数助手：按 side+名字过滤（同名不同边不许串） ──
  const one = skillStatusOf(f2, "red", "三尾狐");
  ok("★★ skillStatusOf 取到该单位的技能（3 条）", one.length === 3 && one.every(s => s.unit === "三尾狐" && s.side === "red"), JSON.stringify(one.map(s => s.name)));
  ok("★★★ 同名不同边不许串：红方的名字拿去蓝方查 → 空", skillStatusOf(f2, "blue", "三尾狐").length === 0);
  ok("★★ 载荷缺失 / 名字对不上 ⇒ 空数组（界面显示「尚未评估」，不是崩）",
    skillStatusOf(null, "red", "谁").length === 0 && skillStatusOf(f2, "red", "不存在").length === 0);
  const g = groupSkillStatus(list);
  ok("★★ groupSkillStatus 按单位分组且**保序**（红 5 只在前，蓝 5 只在后）",
    g.length === 10 && g.slice(0, 5).every(x => x.side === "red") && g.slice(5).every(x => x.side === "blue"),
    JSON.stringify(g.map(x => x.side + ":" + x.unit)));
  ok("★★ 每组都带记数串与「最重档」（卡面小圆点用它上色）",
    g.every(x => /[●◐○✕]/.test(x.tally) && ["FULL", "PARTIAL", "PASSIVE", "NONE"].includes(x.worst!)),
    JSON.stringify(g.map(x => x.unit + "=" + x.tally + "/" + x.worst)));
  ok("★★★ 记数串是可复算的：按档位排、且每个记号后面的数字 == 该档条数",
    g.every(x => x.skills.every(s => x.tally.includes(SKILL_MARK[s.klass]))) && skillTally(list) === SKILL_TIER_ORDER
      .filter(k => list.some(s => s.klass === k)).map(k => SKILL_MARK[k] + list.filter(s => s.klass === k).length).join(" "), skillTally(list));
  ok("★★★ 记数串按**档位表顺序**排（● 在前）—— 与「最重档」用的严重度顺序是两张表（混用会把记数串读成 ◐1 ●2）",
    skillTally([{ klass: "PARTIAL" } as any, { klass: "FULL" } as any]) === "●1 ◐1"
    && worstSkillClass([{ klass: "PARTIAL" } as any, { klass: "FULL" } as any]) === "PARTIAL"
    && JSON.stringify(SKILL_TIER_ORDER) !== JSON.stringify(SKILL_SEVERITY));
  ok("★★★ worstSkillClass 取「最重」而不是「最后一个」：含 PARTIAL 的单位不能报 FULL",
    worstSkillClass([{ klass: "FULL" } as any, { klass: "PARTIAL" } as any]) === "PARTIAL"
    && worstSkillClass([{ klass: "NONE" } as any, { klass: "FULL" } as any]) === "NONE"
    && worstSkillClass([]) === null);
  /**
   * ★★★ 载荷里**不带 parsed**（只带档位与两个计数）—— 这是有意的：分档是内核的事，界面不许自己重判。
   *   所以这里改成「可从载荷自证」的两向判据：档位与它给出的理由必须对得上。
   *   （第一版在这里调用了 classifySkill(payload 条目)，直接 TypeError —— 断言写错，代码没错。）
   */
  ok("★★★ 档位与理由自洽（两向）：FULL ⇒ 未解析 0 且跳过 0；PARTIAL ⇒ 至少有一个 > 0",
    list.every(s => s.klass === "FULL"
      ? (s.unparsed === 0 && s.skipped === 0)
      : s.klass === "PARTIAL"
        ? (s.unparsed > 0 || s.skipped > 0)
        : true),
    JSON.stringify(list.filter(s => s.klass === "FULL" && (s.unparsed > 0 || s.skipped > 0)).slice(0, 3)));
  ok("★★ 载荷条目里没有 parsed（界面不重算分档——分档只有内核一处）",
    list.every(s => !("parsed" in s)));
  //   ★ 又是断言写错：第一版写成 `typeof classifySkill(...) === k` —— typeof 的结果永远是 "string"，
  //     所以这条恒为假（分类器本身没问题，探针逐个档位验过）。
  ok("★★ 而内核侧的判据确实会给出同样的档位（同源：拿同一批输入再分一次）",
    list.every(s => tiers.includes(s.klass)) && tiers.every(k => classifySkill({
      name: "x", confidence: "HIGH", cost: k === "PASSIVE" ? -1 : 1,
      parsed: k === "NONE" || k === "PASSIVE" ? { damage: 0, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 } : { damage: 1, heal: 0, shield: 0, timeline: 0, status: 0, orb: 0 },
      unparsedSentences: k === "PARTIAL" ? 1 : 0,
    } as any) === k));

  // ── UI 接线（源码级：本仓库没有 DOM 测试环境，见 ui14 的分层处置） ──
  const panel = S("components/simulation/FidelityPanel.vue");
  const tile = S("components/lineup/UnitTile.vue");
  const drawer = S("components/knowledge/DetailDrawer.vue");
  const app = S("App.vue");
  ok("★★★ 面板新增了逐技能一节，且默认收起（30 行会把面板撑长）",
    /Per-skill compile status/.test(panel) && /openSkills/.test(panel) && /groupSkillStatus/.test(panel));
  /**
   * ★★ 第 138 轮改写（按事实）：记号与标签的**渲染**收敛到一个组件 CompiledBadge ——
   *   面板与抽屉都复用它，所以「契约里的记号与标签」只该在那一个组件里被读。
   *   判据随之改成：面板/抽屉都引用它，而它们自己**不再**出现任何档位字面量。
   *   （渲染出来的样子由 tests/ui16-ssr-render.ts 真渲染断言，不再靠正则猜。）
   */
  const badge = S("components/knowledge/CompiledBadge.vue");
  ok("★★★ 逐技能状态的渲染只有一处（CompiledBadge），面板与抽屉都复用它",
    /CompiledBadge/.test(panel) && /CompiledBadge/.test(drawer) && /SKILL_MARK\[/.test(badge) && /SKILL_LABEL\[/.test(badge));
  ok("★★★ 面板与抽屉自己不再写档位字面量（两处各写一遍一定会慢慢写歪）",
    !/FULL: "●"/.test(panel) && !/FULL: "●"/.test(drawer) && !/完整编译/.test(panel) && !/完整编译/.test(drawer));
  ok("★★★ 卡面（UnitTile）按逐技能实现度显示记数串，且带悬停逐条清单",
    /skill-status|skillStatus/.test(tile) && /skillTally/.test(tile) && /worstSkillClass/.test(tile) && /compileTitle/.test(tile));
  ok("★★★ 抽屉里 Raw 与 Compiled **并排**（这个文件的头注释宣称了很久，第 138 轮才真的做到）",
    /Compiled Behavior/.test(drawer) && /skillRows/.test(drawer) && /CompiledBadge/.test(drawer));
  //   ★ 措辞（「没有这个技能的编译记录」）现在住在 CompiledBadge 里，由 ui16 真渲染断言；
  //     这里盯的是**配对逻辑**：按技能名取，取不到就是 null，绝不拿相邻技能顶上。
  ok("★★ 抽屉按技能名配对，取不到就 null（不拿相邻技能顶上）",
    /compiled: compiled\.value\.get\(k\.name\) \?\? null/.test(drawer) && /No compile record for this skill/.test(S("components/knowledge/CompiledBadge.vue")));
  ok("★★★ App 把逐技能状态同时接到卡面与抽屉（按 side + 名字取数）",
    /skillStatusOf/.test(app) && /:skill-status="skillStatusFor\('red'/.test(app) && /:skill-status="skillStatusFor\('blue'/.test(app) && /:skill-status="drawer\.unit/.test(app));
  ok("★★ 抽屉记住了 side/index（同一只式神可以合法地出现在双方，只按名字会串）",
    /side: "red" \| "blue"; index: number/.test(app) || /side, index \}/.test(app), "");
}

console.log(`\n══════════════════════════════════`);
console.log(`Fidelity 验收：${pass} 通过 / ${fail} 失败`);
console.log(`══════════════════════════════════`);
if (fail > 0) process.exit(1);
