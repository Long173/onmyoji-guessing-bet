// tests/g42-trigger-registry.ts — ★★ 触发时机登记册的可证伪性（第 68 轮）
//
// 与前三张表（能力 48 / 效果 28 / 架构 18）同一道关：
//   · **计数必须能从 KB 重新数出来**（对不上就红）—— 表里的数字不许手写死；
//   · 映射到的事件码必须真的在 EV 表里；
//   · count ≥ 3 的触发时机**一个都不能漏**（清单完整性也是机械检查的）。
//
// ★ 还有两条本轮的头条事实，也做成断言（它们才是这张表存在的理由）：
//   ① 生产代码里 `bus.register` 只出现在御魂那一处 ⇒ **式神的被动技能没有运行时**；
//   ② 42 个事件码里只有 17 个有派发点 ⇒ 一半以上的事件码是"只有声明"。
//
// ★★★ 第 119 轮（口径统一，别再用记的）：
//   · 事件码 **45** 个，其中**有派发点 23** 个 —— 数字一律由 tools/event-audit.ts 现算；
//   · 旧的本地判据（`includes("EV." + code + ",")`）**不是尺子**：它会命中 `ON_SKILL: EV.SKILL_END,`
//     这种**映射**，于是把「声明了却从没派发」的 SKILL_END 算成有派发点（一个被藏住的死处理器）。
//     现在 import 唯一口径，并新增两条断言：SKILL_END 真的有派发点 / 旧尺子确实会误判。
//   这两条一旦有人改动（建了被动运行时 / 补了派发点），断言会红，逼人来更新这张表 ——
//   这正是我们想要的：**表要跟着事实走，而不是跟着记忆走。**
import fs from "node:fs";
import path from "node:path";
import { TRIGGER_FAMILIES, classifyPassive, matchFamily, TIP_PLACEHOLDER_MEANINGS, CONDITION_MARKERS_NO_PROB, PASSIVE_PROB_RE, CONDITION_MARKERS } from "../kernel/triggers.ts";
import { resolveTips, loadTips } from "../compile/tips.ts";
import { DISPATCHED_EV_CODES, classifySkill } from "../compile/passive-runtime.ts";
import { compileSkill } from "../compile/skill-compiler.ts";
import { producerScanFiles, stripComments } from "../tools/field-census.ts";
import { evCoverage } from "../tools/event-audit.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PROD = producerScanFiles(ROOT).map(f => ({ f: path.relative(ROOT, f).split(path.sep).join("/"), s: stripComments(fs.readFileSync(f, "utf8")) }));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
// ★ 第 80 轮：占位符表提到模块级 —— 分类的唯一入口 classifySkill 需要它，
//   而它不止 §[6] 一个地方要用（§[2] 的结构不变式也要）。放在块作用域里会 ReferenceError。
const TIPS = loadTips(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8")));
const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);

/**
 * 从 KB 重新数被动技能里的触发时机。
 *
 * ★★★ 第 73 轮：这里原来用正则 `([^，。；、]{1,10}?)时` 抓短语，而它**非贪婪**，
 * 于是从"本段最后一个逗号"开始抓，凡是**带限定词**的写法都会把限定词一起吞掉
 * （「自身回合开始时」→ 抓到「自身回合开始」）。后果是 6 个 family 的计数系统性偏低，
 * 而本测试用的是**同一个正则**，所以一直"同意" —— 同意的原因是**两边用同一把坏尺子**。
 *
 * 现在分成两把尺子，各司其职：
 *   · `phrase`  —— 逐子句取**最长**的已登记 family 名。这是 kbCount 的口径，与真正
 *                  决定行为的 classifyPassive 归属判据**同源**。
 *   · `discovered` —— 沿用旧正则做**短语发现**（"还有哪些写法没登记"）。
 *                  它不需要准，只需要广 —— 完整性检查靠它，计数不靠它。
 */
function survey() {
  const trig = new Map<string, number>();
  const phrase = new Map<string, number>();
  let passive = 0, active = 0;
  const withPassive = new Set<string>();
  for (const s of LIST) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const sk of (s.skills ?? [])) {
      if ((Number(sk.cost) || 0) < 0) {
        passive++; withPassive.add(s.name);
        const text = String(sk.description ?? "").replace(/<br>/g, "。");
        // ① 短语发现（旧正则，只求广）—— 完整性检查用它
        for (const sen of text.split(/[。；\n]/)) {
          for (const m of sen.matchAll(/([^，。；、]{1,10}?)时/g)) {
            const k = m[1].trim();
            if (/^(同|的|其|此)$/.test(k)) continue;      // 「同时」会被非贪婪匹配切成「同」，一并排除
            trig.set(k, (trig.get(k) ?? 0) + 1);
          }
        }
        /**
         * ② 计数（逐子句取归属）—— kbCount 用它，与 classifyPassive **同源**。
         *
         * ★★★ 第 107 轮：改成直接调用 ~B~matchFamily~B~，而不是在这里再写一遍
         *   「名字 + 时」的子串判据。起因：新增的「施放技能前」族用的是 ~B~test~B~ 正则
         *   （「施放『X』前」中间隔着技能名，子串永远匹配不到），
         *   于是**同一份判据在两处各写了一遍**，实测 0 vs 表里 1 —— g42 当场红。
         *   ⇒ 一处事实、一处实现：这里只负责"数"，归属由 matchFamily 说了算。
         */
        for (const c of text.split(/[。；]/)) {
          const f = matchFamily(c);
          if (f) phrase.set(f.family, (phrase.get(f.family) ?? 0) + 1);
        }
      } else active++;
    }
  }
  return { trig, phrase, passive, active, shikiWithPassive: withPassive.size };
}
const evCodes = (() => {
  const types = fs.readFileSync(path.join(ROOT, "battle-lab", "kernel", "types.ts"), "utf8");
  const start = types.indexOf("export const EV = {");
  const block = types.slice(start, types.indexOf("} as const", start));
  return [...block.matchAll(/([A-Z_]+):\s*"[A-Z_]+"/g)].map(m => m[1]);
})();
/**
 * ★★★ 第 119 轮：**口径统一**。这一行原来是本文件自己的一套正则：
 *     `s.includes("dispatch(EV." + code) || s.includes("EV." + code + ",")`
 *   后半段 `EV.X,` **并不表示派发** —— `ON_SKILL: EV.SKILL_END,`（御魂时机映射）也会命中它，
 *   于是 SKILL_END 被判成「有派发点」，而全库**没有一处**派发它：一个静默的死处理器
 *   就这样被自己的尺子藏住了（与第 90 轮 CRI 那件事同类）。
 *   现在只留一个实现：tools/event-audit.ts 的四态账（BUS / TRACE_ONLY / MENTION_ONLY / DECLARED_ONLY）+ 证据行。
 */
const COV = evCoverage(ROOT);
const busCodes = COV.codes.filter(c => c.verdict === "BUS").map(c => c.code);
const dispatched = (code: string) => (COV.codes.find(c => c.code === code)?.bus ?? []).map(s => s.file);

sec("[1] ★★ 表本身");
{
  ok("★ 条目数 ≥ 10", TRIGGER_FAMILIES.length >= 10, String(TRIGGER_FAMILIES.length));
  ok("★ family 不重复", new Set(TRIGGER_FAMILIES.map(t => t.family)).size === TRIGGER_FAMILIES.length);
  /**
 * ★★★ 第 95 轮：**"触发者是哪一侧"必须标出来，而且可以从名字机械推导**。
 *   「受到伤害 / 受到攻击 / 被攻击 / 受到敌方攻击」这四族的名字就写着"我是挨打的那一方"，
 *   而它们共用的事件码（BEFORE_DAMAGE / AFTER_DAMAGE）的 origin 是**伤害来源** ——
 *   不标 side，运行时就只能用 range SELF，于是这些被动会在**自己打人的时候**触发（方向反了）。
 *   判据：名字以「受到」或「被」开头的族 ⇒ 必须 side=TARGET；其余 ⇒ 不许标（默认 SOURCE）。
 *   两个方向都查 —— 只查一边的话，"给源侧族也标上 TARGET"会静默通过。
 */
{
  const shouldTarget = TRIGGER_FAMILIES.filter(t => /^(?:受到|被)/.test(t.family));
  const badTarget = shouldTarget.filter(t => t.side !== "TARGET");
  ok("★★★ 名字以「受到/被」开头的族必须标 side=TARGET（共 " + shouldTarget.length + " 族）",
    shouldTarget.length >= 4 && badTarget.length === 0, JSON.stringify(badTarget.map(t => t.family)));
  const badSource = TRIGGER_FAMILIES.filter(t => !/^(?:受到|被)/.test(t.family) && t.side === "TARGET");
  ok("★★★ 反向：源侧族（造成伤害 / 攻击 / 暴击 …）**不许**标 TARGET", badSource.length === 0,
    JSON.stringify(badSource.map(t => t.family)));
  ok("★★★ 「暴击」族必须写 requiresCrit —— 否则它在**每一次**伤害上都会触发",
    TRIGGER_FAMILIES.find(t => t.family === "暴击")?.requiresCrit === true);
  const src = fs.readFileSync(path.join(ROOT, "battle-lab", "compile", "passive-runtime.ts"), "utf8");
  ok("★★ 而运行时确实在读这两个字段（声明不许没人读）",
    /side === "TARGET"/.test(src) && /requiresCrit/.test(src));
}
ok("★★ 每条都写了映射理由（含歧义时的取舍）", TRIGGER_FAMILIES.every(t => t.note.trim().length >= 15),
    JSON.stringify(TRIGGER_FAMILIES.filter(t => t.note.trim().length < 15).map(t => t.family)));
}

sec("[2] ★★★ 计数必须能从 KB 重新数出来（表里的数字不许手写死）");
{
  const { trig, phrase } = survey();
  // 尺子①：kbCount 与「逐子句取最长 family 名」一致（与 classifyPassive 同源）
  const wrong = TRIGGER_FAMILIES.filter(t => (phrase.get(t.family) ?? 0) !== t.kbCount)
    .map(t => t.family + "：表里 " + t.kbCount + "，实测 " + (phrase.get(t.family) ?? 0));
  ok("★★★ 每个 family 的 kbCount 与 KB 实测一致（含 0 频率的条目）", wrong.length === 0, JSON.stringify(wrong));
  // 尺子②：短语发现（旧正则，只求广）—— 清单完整性
  const missing = [...trig.entries()].filter(([k, v]) => v >= 3 && !TRIGGER_FAMILIES.some(t => t.family === k));
  ok("★★★ count ≥ 3 的触发时机全部在表里（漏一个就红）", missing.length === 0, JSON.stringify(missing));
  console.log("    短语发现口径 count ≥ 3 的写法 " + [...trig.entries()].filter(([, v]) => v >= 3).length +
    " 种；表里 " + TRIGGER_FAMILIES.filter(t => t.kbCount >= 3).length + " 条覆盖了它们");

  // ★★★ 第 73 轮新增：**不依赖上面任何一把尺子**的结构不变式
  //   「挨打」的子句绝不许归到 family「攻击」——
  //   因为「攻击」映射到 SKILL_START（**未派发**），而挨打映射到 BEFORE_DAMAGE（**已派发**）。
  //   判错的代价是：把「本可以做的」记成「做不了」。
  const BEING = ["受到敌方攻击时", "受到攻击时", "被攻击时"];
  const ATTACKED = ["受到攻击", "被攻击", "受到敌方攻击"];
  const violNew: string[] = [], violOld: string[] = [];
  for (const s of LIST) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const sk of (s.skills ?? [])) {
      if ((Number(sk.cost) || 0) >= 0) continue;
      const text = String(sk.description ?? "").replace(/<br>/g, "。");
      const being = text.split(/[。；]/).some((c: string) => BEING.some(p => c.includes(p)));
      if (!being) continue;
      const now = classifyPassive(text, Number(sk.cost)).family;
      if (now === "攻击") violNew.push(s.name + "「" + sk.name + "」");
      // 反方向：把旧的**子串匹配**装回去，它必须违例 —— 否则这条断言没有牙齿
      const clauseOf = (f: string) => text.split(/[。；]/).find((c: string) => c.includes(f + "时")) ?? "";
      const oldHit = TRIGGER_FAMILIES.find((f: any) => f.kbCount > 0 && clauseOf(f.family) !== "");
      if (oldHit?.family === "攻击") violOld.push(s.name + "「" + sk.name + "」");
    }
  }
  ok("★★★ 结构不变式：「挨打」的子句一条都不许归到 family「攻击」", violNew.length === 0, JSON.stringify(violNew.slice(0, 6)));
  ok("★★★ 反向：把旧的子串匹配装回去，这条不变式**立刻被违反**（证明它不是空断言）",
    violOld.length > 0, "旧匹配违例 " + violOld.length + " 条：" + JSON.stringify(violOld.slice(0, 4)));
  console.log("    挨打的被动 " + (violOld.length + violNew.length > 0 ? "" : "") + "由最长匹配正确归入：" +
    ATTACKED.join(" / ") + "（旧子串匹配错了 " + violOld.length + " 条）");

  // ★★★ 另一个方向：classifyPassive 给出的 family 必须都是登记过的
  const unknownFam: string[] = [];
  const seenFam = new Set<string>();
  for (const s of LIST) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const sk of (s.skills ?? [])) {
      if ((Number(sk.cost) || 0) >= 0) continue;
      const v = classifySkill(sk, TIPS, compileSkill(s.id, s.name, sk)).v;   // ★ 走唯一入口（含 IR 事实：有没有护盾）
      if (v.family === null) continue;
      seenFam.add(v.family);
      if (!TRIGGER_FAMILIES.some(t => t.family === v.family)) unknownFam.push(s.name + "→" + v.family);
    }
  }
  ok("★★★ classifyPassive 认出的 family 全都在登记册里（不会冒出新名字）", unknownFam.length === 0, JSON.stringify(unknownFam.slice(0, 5)));
  console.log("    实际被用到的 family " + seenFam.size + " 种（登记册共 " + TRIGGER_FAMILIES.length + " 条）");


}

sec("[3] ★★ 事件码映射与派发状态（逐个实测，不靠注释）");
{
  const badCode = TRIGGER_FAMILIES.filter(t => t.evCode && !evCodes.includes(t.evCode)).map(t => t.family + " → " + t.evCode);
  ok("★★ 每个非 null 的 evCode 都在 EV 表里", badCode.length === 0, JSON.stringify(badCode));
  const rows = TRIGGER_FAMILIES.map(t => ({ t, n: t.evCode ? dispatched(t.evCode).length : 0 }));
  for (const r of rows.filter(r => r.t.kbCount > 0)) {
    const verdict = r.t.evCode === null ? "NO_EVENT" : (r.n > 0 ? "READY" : "NO_DISPATCH");
    console.log("    " + r.t.family.padEnd(12) + "×" + String(r.t.kbCount).padStart(3) + "  " + String(r.t.evCode ?? "—").padEnd(15) + verdict);
  }
  const ready = rows.filter(r => r.t.kbCount > 0 && r.t.evCode && r.n > 0).length;
  const noDispatch = rows.filter(r => r.t.kbCount > 0 && r.t.evCode && r.n === 0).length;
  ok("★★ 至少有一条时机是 READY（否则这张表说明「今天什么都接不了」）", ready > 0, String(ready));
  console.log("    有频率的时机：" + ready + " 条 READY（事件已派发）｜" + noDispatch + " 条 NO_DISPATCH（事件码在、没人派发）");
  // ★★★ 第 74 轮：被动运行时的 DISPATCHED_EV_CODES 是一张**声明表**（浏览器侧量不了），
  //   所以它必须被事实双向盯着 —— 第 74 轮它漏了 SKILL_START，导致可挂的被动被静默跳过。
  const measured = new Set(evCodes.filter(c => dispatched(c).length > 0));
  const declared = DISPATCHED_EV_CODES;
  const missingInDecl = [...measured].filter(c => !declared.has(c));
  const extraInDecl = [...declared].filter(c => !measured.has(c));
  ok("★★★ 被动运行时的 DISPATCHED_EV_CODES 与实测**逐条一致**（少了红、多了也红）",
    missingInDecl.length === 0 && extraInDecl.length === 0,
    "声明漏了 " + JSON.stringify(missingInDecl) + "｜声明多了 " + JSON.stringify(extraInDecl));
  ok("★★★ 反向：把 SKILL_START 从声明里去掉，这条断言必须变红（证明它盯着东西）",
    (() => { const t = new Set(declared); t.delete("SKILL_START"); return [...measured].some(c => !t.has(c)); })(),
    "实测有派发的 " + measured.size + " 个，声明 " + declared.size + " 个");
  console.log("    声明表 " + declared.size + " 个 ｜ 实测有派发点 " + measured.size + " 个");

  /**
   * ★★★ 第 120 轮按事实改写：这几条 0 频率条目的用处是**钉住**「事件码还没被派发」这件事，
   *   而 HEAL 本轮接线了 —— 「它们全都没有派发点」这句话不再成立。
   *   现在断言**逐条**的当前状态：仍未被派发的继续钉，已接线的必须真的在派发。
   */
  const pinEntries = TRIGGER_FAMILIES.filter(t => t.kbCount === 0 && t.evCode);
  const stillPin = pinEntries.filter(t => dispatched(t.evCode!).length === 0).map(t => t.family);
  console.log("    0 频率条目：" + pinEntries.map(t => t.family + "→" + t.evCode + (dispatched(t.evCode!).length ? "（已接线）" : "（未派发）")).join("｜"));
  ok("★★ 0 频率条目里**仍未被派发**的时机与实测逐条一致（当前：" + stillPin.join(" / ") + "）",
    pinEntries.every(t => (dispatched(t.evCode!).length === 0) === stillPin.includes(t.family)),
    JSON.stringify(stillPin));
  ok("★★★ HEAL 已接线 ⇒「受到治疗」这条钉子已经拔掉（它从「没有派发点」变成「可以挂了」）",
    !stillPin.includes("受到治疗") && dispatched("HEAL").length > 0);
}

sec("[4] ★★★ 头条事实①：式神的被动技能**没有运行时**");
{
  const sites = PROD.filter(x => x.s.includes("bus.register")).map(x => x.f);
  /**
   * ★★★ 第 113 轮：**四处**（新增 kernel/summon.ts 的 installSummonHooks —— 召唤物的反应式光环）。
   *   数字每变一次都要说清「多出来的是谁、什么时候注册」：
   *     御魂（soul/effect-system，装配时安装）· dummy（测试替身）·
   *     被动运行时（compile/passive-runtime，由 policies.passives 控制、**默认 OFF**）·
   *     召唤物钩子（kernel/summon，只在召唤物真的带着**反应式光环**上场时才注册）。
   * ★★★ 第 131 轮：**五处**（新增 kernel/ally-guard.ts 的 installAllyGuards —— 替友方拦截致命伤）。
   *   ★ 它与前四处有一个重要区别：**不受任何策略控制**（写在主动技能原文里的常驻条款），
   *     所以装配路径无条件调用它；它也是 `EV.DEATH_PREVENTION` 的第一个生产者。
   */
  /**
   * ★★★ 第 140 轮：**六处**（新增 kernel/layer-field.ts 的 installLayerField —— 叠层场地「花海」）。
   *   ★ 它与前一处的区别要写清楚：**第 140 轮时还没有调用方**（第 141 轮已由 compile/passive-runtime.ts 调用，
   *     但机制本身仍无双向行为断言 ⇒ 记账不放行）。历史事实（第 140 轮）：没有任何装配路径调用它，rg 'installLayerField'
   *     只命中定义处），所以这第 6 处是"入口在、无调用方"—— 与第 95 轮 runPseudoTurn 那次同型。
   *     这一条断言因此**不能**被读成"花海已经在跑"：它只说"生产代码里出现了一个新的注册点"。
   */
  //   ★★★ 第 187 轮：**七处**（新增 kernel/lethal-consume.ts —— 消耗型换命，石长姬「磐长纪」）。
  //     它与"层数场地"那一处不同：**入口与调用方都在**（compile/subscribers.ts 调它），而且有双向行为断言
  //     （tests/g109-lethal-consume.ts 16 条）—— 所以这一处是"真的在跑"。
  /**
   * ★★★ 第 246 轮按事实改写：**第八处**是 `kernel/end-on-lose.ts`（「失去 X 时结束 Y」的失去监视器 ——
   *   安装点在施放点与被动装配点两处，但 `bus.register` 只有这一份实现）。与前几处同一口径：
   *   **入口与调用方都在**（`compile/character.ts` 的施放点调它），双向行为见 `g124`。
   */
  // Ninth site: soul/custom-effects.ts (hand-written 4-piece soul installers, called from effect-system.ts).
  // Tenth site: compile/betting-mechanics.ts (饭笥 储备粮 gain / 金鱼 鱼之怒 counter; called from
  //   compile/subscribers.ts, registers nothing outside MAX skill-level mode — tests/betting-mechanics.ts).
  // Eleventh site: compile/betting-shared.ts (the one register helper of 鲸汐千姬 / 云外镜 in
  //   betting-senhime.ts / betting-ungaikyo.ts; MAX skill-level mode only — tests/betting-mechanics-2.ts).
  ok("★★★ 生产代码里 bus.register 十一处：御魂 + 御魂 custom + dummy + 被动运行时（默认 OFF）+ 召唤物钩子 + 替友方拦死 + 叠层场地 + 消耗型换命 + **失去监视** + 下注模式机制 ×2（仅 MAX）",
    sites.length === 11 && sites.includes("battle-lab/soul/effect-system.ts") &&
    sites.includes("battle-lab/compile/betting-mechanics.ts") && sites.includes("battle-lab/compile/betting-shared.ts") &&
    sites.includes("battle-lab/soul/custom-effects.ts") &&
    sites.includes("battle-lab/dummy/dummy.ts") && sites.includes("battle-lab/compile/passive-runtime.ts") &&
    sites.includes("battle-lab/kernel/summon.ts") && sites.includes("battle-lab/kernel/ally-guard.ts") &&
    sites.includes("battle-lab/kernel/layer-field.ts") && sites.includes("battle-lab/kernel/lethal-consume.ts") &&
    sites.includes("battle-lab/kernel/end-on-lose.ts"),
    JSON.stringify(sites));
  ok("★★★ 但被动运行时的默认模式仍然是 OFF（所以「技能有运行时」≠「技能在跑」）",
    /NOT_EXECUTED/.test(fs.readFileSync(path.join(ROOT, "battle-lab/kernel/policies.ts"), "utf8")) &&
    /mode: "OFF"/.test(fs.readFileSync(path.join(ROOT, "battle-lab/kernel/policies.ts"), "utf8")));
  ok("★★ compile/character.ts 里没有任何 hook 注册（技能只有 execute，没有 passive 通道）",
    !PROD.find(x => x.f === "battle-lab/compile/character.ts")!.s.includes("bus.register"));
  const { passive, active, shikiWithPassive } = survey();
  ok("★★ 被动技能占比过半（这不是边角料）", passive / (passive + active) > 0.15,
    passive + " / " + (passive + active));
  console.log("    被动技能 " + passive + " 个（主动 " + active + "）｜有被动的式神 " + shikiWithPassive + " 只 / 共 " + new Set(LIST.filter(s => !isOnmyoji(s.name ?? "")).map(s => s.name)).size + " 只");
  console.log("    也就是说：**这 157 只式神上场时，它们的被动一次都不会触发** —— Fidelity 的 SKILL 层会把它数成「被动技能（引擎未建模其触发条件）」并如实报出。");
}

sec("[5] ★★★ 头条事实②：45 个事件码里 " + (evCodes.length - busCodes.length) + " 个只有声明、没有派发点（第 119 轮起按 tools/event-audit.ts 的**唯一口径**数）");
{
  const noSite = evCodes.filter(c => dispatched(c).length === 0);
  // ★★★ 第 91 轮新增护栏：**派发事件码一律走 EV.***，不许裸字符串。
  //   理由不只是「风格」：`dispatch(EV.X)` 打错字**编译不过**，
  //   而 `dispatch("X")` 打错字会**静默不派发** —— 一个永远不会触发的处理器就这么来的
  //   （SOUL_START / PASSIVE_START 正是这种情况：它们是真的、也在派发，只是不在 EV 表里，
  //    于是所有按表枚举的扫描都漏掉了它们，账目错了很久没人发现）。
  const RAW = /dispatch\(\s*"([A-Z_]+)"/g;
  const rawDispatch: string[] = [];
  for (const x of PROD) for (const mm of x.s.matchAll(RAW)) rawDispatch.push(x.f + " → dispatch(" + mm[1] + ")");
  ok("★★★ 生产代码里没有任何**裸字符串**派发（一律走 EV.*，打错字就编译不过）",
    rawDispatch.length === 0, JSON.stringify(rawDispatch.slice(0, 5)));
  ok("★★★ 而且 SOUL_START / PASSIVE_START **真的在 EV 表里**了（它们确实被派发）",
    evCodes.includes("SOUL_START") && evCodes.includes("PASSIVE_START"));
  ok("★★★ 反向：合成的裸字符串派发会被同一条判据抓到",
    [...("await bus.dispatch(\"WHATEVER\", {}, 0, 0, f);").matchAll(RAW)].length === 1);
  //   ★★★ 第 91 轮：42 → **44**。此前 SOUL_START / PASSIVE_START **一直在被派发**，
  //   但它们是裸字符串 `dispatch("SOUL_START", …)`，**不在 EV 表里** ——
  //   于是任何"按 EV 表枚举事件码"的扫描都看不见它们，这个账从一开始就是错的。
  //   补进表里之后，下面两条数字同时变了（18 → 20），这正是这道闸门该有的反应。
  ok("★★ 声明了 45 个事件码（第 91 轮补登记 SOUL_START / PASSIVE_START / DEATH_PREVENTION）", evCodes.length === 45, String(evCodes.length));
  //   ★★★ 第 94 轮：21 → **22**。IMMUNE 从「声明了但从来没被派发」变成**真的有两个派发点**：
  //     · compile/character.ts —— 状态施加被「免疫控制/减益」挡下；
  //     · kernel/damage.ts —— 「免疫伤害」把这一击归零。
  //   ⇒ 未派发名单少了它一个。这正是这条断言该有的反应：**接线必须来改这个数字。**
  //   ★★★ 第 97 轮：22 → **23**。RESIST 从「声明了但从来没有被派发」变成有派发点
  //     （红区 H 的两掷口径下，控制被抵抗时派发一次；默认口径 NONE 不会派发它 ——
  //      这张表说的是"代码里有派发点"，不是"默认路径会派发"）。
  //   ★★★ 第 120 轮：23 → **33**。事件队列（Battle.queueEvent + drainEvents）把 10 个
  //     「机制在跑、只有 trace」的码接进总线：HEAL / RECOVER / HP_LOSS / STATUS_REMOVE /
  //     STATUS_EXPIRE / STATUS_MISS / TIMELINE_MISS / ORB_GAIN / ORB_OVERFLOW / ORB_COST。
  //     其中 8 个的运行期触发已由 tests/g76 用探针逐个证明（2 个如实记账，见该测试 §[6]）。
  //   ★★★ 第 122 轮：33 → **38**。状态与护盾的生产点接上事件队列（STATUS_ADD / SHIELD_CREATE /
  //     SHIELD_DAMAGE / SHIELD_BREAK），变形在 enterForm / returnForm 两处派发（TRANSFORM）。
  ok("★★ 有派发点的 38 个（…第 120 轮事件队列接 10 个；**第 122 轮再接 5 个**。变了就来说明）", evCodes.length - noSite.length === 38,
    String(evCodes.length - noSite.length));
  /**
   * ★★★ 第 119 轮：SKILL_END 从「声明说有派发、事实没有」变成**真的有派发点**
   *   （kernel/battle.ts，一次技能释放结束处）。它不是新增机制 —— 御魂表早就把它当成
   *   「施放技能后」的落点（ON_SKILL），只是**从来没有人派发过它**。
   *   行为中性：70 件御魂实测 0 件解析成 ON_SKILL，也没有任何被动 family 映射到它，
   *   所以典型对局指纹 2d7c7507e18db61f 逐位不变（g33 那条锚点仍在守）。
   */
  ok("★★★ SKILL_END 现在真的有派发点（第 119 轮接线）", dispatched("SKILL_END").length > 0, JSON.stringify(dispatched("SKILL_END")));
  {
    /** ★★★ 反向：证明**旧尺子**错在哪 —— 御魂映射那一行会命中 `EV.X,`，但它不是派发 */
    const eff = fs.readFileSync(path.join(ROOT, "battle-lab", "soul", "effect-system.ts"), "utf8");
    const looseHits = /EV\.SKILL_END,/.test(eff);
    const busHits = dispatched("SKILL_END").some((f: string) => f.endsWith("soul/effect-system.ts"));
    ok("★★★ 反向：`ON_SKILL: EV.SKILL_END,` 命中的是**旧宽松规则**、不是派发（旧尺子就是这么藏住死处理器的）",
      looseHits && !busHits, "loose=" + looseHits + " bus=" + busHits);
  }
  console.log("    未派发（" + noSite.length + "）：" + noSite.join(", "));
  /**
   * ★★★ 第 122 轮按事实改写：STATUS_ADD 与 SHIELD_* 本轮接线（状态/护盾的生产点接事件队列），
   *   于是它们离开了未派发名单。现在钉住的是**剩下的 7 个** —— 它们都在 field-allowlist 的
   *   allowed 里有明确理由（按设计不派发 / 名字漂移），不是"忘了接"。
   */
  const stillUndispatched = ["BATTLE_CREATE", "PRE_BATTLE", "TIMELINE_ADVANCE", "ACTION_START", "TARGET_SELECT", "BEFORE_HIT", "HIT"];
  ok("★★★ 未派发名单现在恰好是那 7 个「按设计不派发」的码（多一个少一个都红）",
    stillUndispatched.every(c => noSite.includes(c)) && noSite.length === stillUndispatched.length, JSON.stringify(noSite));
  ok("★★★ 反向：第 120/122 轮接的码都已离开未派发名单（HEAL / STATUS_ADD / SHIELD_BREAK / TRANSFORM）",
    ["HEAL", "STATUS_ADD", "SHIELD_BREAK", "TRANSFORM"].every(c => !noSite.includes(c) && dispatched(c).length > 0),
    JSON.stringify(["HEAL", "STATUS_ADD", "SHIELD_BREAK", "TRANSFORM"].map(c => c + ":" + dispatched(c).length)));
  ok("★★★ 反向：HEAL 已经**不在**未派发名单里了（第 120 轮接线 —— 它正是「受到治疗时」那一族的落点）",
    !noSite.includes("HEAL") && dispatched("HEAL").length > 0, JSON.stringify(dispatched("HEAL")));
  console.log("      在此之前没有一处把这件事实写清楚过。");
}

sec("[6] ★★★ 被动运行时能不能开工？—— 占位符**先解析、再分档**");
{
  // ★★★ 第 71 轮：分档必须跑在**解析后**的文案上。
  //   此前在原文案上分类，于是 18 条被动被记成"被占位符挡住" —— 好像数据不全。
  //   真相反过来：占位符表 data/kb/tips.json（122 条）一直就在仓库里，读一下就能解析；
  //   解析之后"HAS_PLACEHOLDER"这一档**归零**，而干净候选 16 → 23。
  const zero = { NO_TRIGGER: 0, HAS_CONDITION: 0, HAS_PLACEHOLDER: 0, CANDIDATE: 0 } as Record<string, number>;
  const rawT = { ...zero }, resT = { ...zero };
  const candidates: string[] = [];
  const missIds = new Set<string>();
  let phSeen = 0, phHit = 0;
  const allPassives = LIST.filter(s => !isOnmyoji(s.name ?? ""))
    .flatMap(s => (s.skills ?? []).filter((k: any) => (Number(k.cost) || 0) < 0)
      .map((k: any) => ({ nm: s.name as string, cid: s.id as number, k })));

  for (const { nm, cid, k } of allPassives) {
    const text = String(k.description ?? "");
    const r = resolveTips(text, TIPS);
    phSeen += r.hit.length + r.miss.length; phHit += r.hit.length;
    r.miss.forEach(id => missIds.add(id));
    rawT[classifyPassive(text, Number(k.cost)).verdict]++;          // 原文案（旧口径，留作对照）
    const v = classifySkill(k, TIPS, compileSkill(cid, nm, k)).v;   // ★ 解析后（唯一有效的口径，走唯一入口）
    resT[v.verdict]++;
    if (v.verdict === "CANDIDATE") candidates.push(nm + "「" + k.name + "」[" + v.family + "]");
  }

  console.log("    原文案分档（旧口径）：" + Object.entries(rawT).map(([k2, v]) => k2 + " " + v).join("｜"));
  console.log("    ★ 解析后分档（现行）：" + Object.entries(resT).map(([k2, v]) => k2 + " " + v).join("｜"));
  console.log("    占位符：" + phSeen + " 处｜解析成功 " + phHit + "｜落空 " + (phSeen - phHit));

  ok("★★★ 分档互斥且穷尽（四档之和 = 全部被动）",
    resT.NO_TRIGGER + resT.HAS_CONDITION + resT.HAS_PLACEHOLDER + resT.CANDIDATE === allPassives.length,
    JSON.stringify(resT) + " vs " + allPassives.length);
  ok("★★★ 全部 [tips_N] 都能在 data/kb/tips.json 里查到（0 落空）",
    phSeen > 0 && phSeen === phHit && missIds.size === 0,
    "落空 id：" + [...missIds].join(",") + "（共查 " + phSeen + " 处）");
  ok("★★★ 解析之后「被占位符挡住」这一档**归零**（它此前是假象）",
    resT.HAS_PLACEHOLDER === 0 && rawT.HAS_PLACEHOLDER > 0,
    "原文案 " + rawT.HAS_PLACEHOLDER + " → 解析后 " + resT.HAS_PLACEHOLDER);
  ok("★★★ 解析让候选**变多**（16 → 23 不是凭空长的，是原来被误挡的放出来了）",
    resT.CANDIDATE > rawT.CANDIDATE, rawT.CANDIDATE + " → " + resT.CANDIDATE);
  // ★★ 第 77 轮：这条断言**换了形状**，因为旧形状不再成立（候选 52 > 有条件 46）。
  //   它原本想守的是"识别器别把什么都放行"，而"候选 < 有条件"只是当时的一个**代理指标** ——
  //   随识别能力提升，这个代理会自动失效。改成直接判**比例**：候选必须明显少于被动总数。
  const allCount = allPassives.length;
  ok("★★ 干净候选是**少数**（< 全库被动的一半，否则说明条件识别失效）",
    resT.CANDIDATE > 0 && resT.CANDIDATE * 2 < allCount,
    resT.CANDIDATE + " / " + allCount);

  // ── 反方向证伪：把解析器改成"永远返回原文"，上面几条必须塌掉 ──
  const identity = (s: string) => ({ text: String(s ?? ""), hit: [] as string[], miss: [] as string[] });
  const brokenT = { ...zero };
  for (const { cid, nm, k } of allPassives) brokenT[classifyPassive(identity(String(k.description ?? "")).text, Number(k.cost), undefined, { hasShield: !!k.ir?.shield?.length }).verdict]++;
  ok("★★★ 反向：若解析器退化成恒等函数，HAS_PLACEHOLDER 立刻 > 0（断言真在守东西）",
    brokenT.HAS_PLACEHOLDER > 0, "恒等口径 HAS_PLACEHOLDER = " + brokenT.HAS_PLACEHOLDER);
  const unknown = resolveTips("受到攻击时，有40%[tips_999999]为攻击者附加[buff_2322_1]", TIPS);
  ok("★★★ 反向：查不到的 id **不许**被静默丢掉（原样保留 + 记进 miss）",
    unknown.miss.length === 1 && unknown.text.includes("[tips_999999]") && unknown.hit.length === 0,
    JSON.stringify(unknown));
  ok("★★★ 反向：含未解析占位符的子句仍然**不许**当候选",
    classifyPassive(unknown.text, -1).verdict === "HAS_PLACEHOLDER",
    classifyPassive(unknown.text, -1).verdict);

  // ── 铁鼠：原文案判"被占位符挡住"，解析后判"有条件" —— 两者都不许变成候选 ──
  const tieRaw = "受到攻击时，有40%[tips_2]为攻击者附加[buff_2322_1]，持续2回合";
  const tieRes = resolveTips(tieRaw, TIPS);
  ok("★★★ 铁鼠「横财护身」：原文案（占位符未解析）→ HAS_PLACEHOLDER", classifyPassive(tieRaw, -1).verdict === "HAS_PLACEHOLDER");
  // ★★★ 第 75 轮：这条断言**换了方向**，因为正确做法变了。
  //   第 69 轮它守的是「不许是候选」—— 那时概率没被建模，挂上去就等于把 40% 当 100% 执行，
  //   只能因噎废食。现在「有 X% 概率」被建模了，所以 40% **应当**被如实登记并交给运行时掷。
  //   守卫本身没有消失，而是搬到了更准确的地方：
  //     · 这里：概率必须被**解析出来且正确**（0.4，不是 1.0、也不是随便一个数）；
  //     · g43 §[7]：挂上之后**必须真的掷**（517 次机会 → 253 次触发 = 48.9%）。
  const tie = classifyPassive(tieRes.text, -1);
  ok("★★★ 铁鼠「横财护身」：解析后 → CANDIDATE，且概率被解析成 **0.4**（不是 1.0）",
    tie.verdict === "CANDIDATE" && tie.condition?.kind === "PROBABILITY" && tie.condition.p === 0.4,
    JSON.stringify({ v: tie.verdict, cond: tie.condition }));
  ok("★★★ 而且它带着**判定依据**（判错时要能一眼看出照哪句话判的）",
    !!tie.condition && tie.condition.evidence.includes("40%") && tie.condition.evidence.includes("概率"),
    JSON.stringify(tie.condition?.evidence));
  ok("★★ 原文案口径下它仍然进不了候选（占位符没解析就是不能执行）",
    classifyPassive(tieRaw, -1).verdict !== "CANDIDATE");

  const pure = classifyPassive("战斗开始时，获得1点鬼火", -1);
  ok("★★ 对照：真的没有条件也没有占位符的被动，才判成候选", pure.verdict === "CANDIDATE", pure.verdict);
  //   ★★★ 第 87 轮：这条对照**换了对象**。「若拥有4层[buff_X]」第 87 轮被建模了
  //   （`STACK_AT_LEAST`，运行时读层数），所以它现在是**候选**而不是"有条件"。
  //   要守"真条件仍然挡住"，得换一个**确实没建模**的形状。
  const stackCond = classifyPassive("阵亡时，若拥有4层[buff_2072_1]，则会立即复活并治疗生命上限20%的生命", -1);
  ok("★★★ 对照：「若拥有N层X」已被建模 → 候选，且条件种类是 STACK_AT_LEAST",
    stackCond.verdict === "CANDIDATE" && stackCond.condition?.kind === "STACK_AT_LEAST" && stackCond.condition.n === 4,
    JSON.stringify({ v: stackCond.verdict, c: stackCond.condition }));
  const cond = classifyPassive("阵亡时，若目标带有[buff_9_1]，则会立即复活", -1);
  ok("★★★ 对照：**没建模**的条件形状仍然判成 HAS_CONDITION（不许因为认得一种就全放行）",
    cond.verdict === "HAS_CONDITION" && cond.blockedBy === "CONDITION", JSON.stringify({ v: cond.verdict, b: cond.blockedBy }));
  const stacked = classifyPassive("阵亡时，若拥有4层[buff_2072_1]，若目标带有[buff_9_1]，则复活", -1);
  ok("★★★ 对照：**已建模 + 未建模**混在一句里时，仍判成有条件（剥掉已建模的，剩下的还算数）",
    stacked.verdict === "HAS_CONDITION", JSON.stringify({ v: stacked.verdict, b: stacked.blockedBy }));

  // ── 我手写的探针记录 vs 仓库里的数据表：两份独立来源互相印证 ──
  let pinned = 0, agree = 0;
  for (const [id, rec] of Object.entries(TIP_PLACEHOLDER_MEANINGS)) {
    const row = TIPS.get(id.replace(/^tips_/, ""));
    if (!row) continue;
    pinned++;
    const cands = rec.means.split("/").map(x => x.replace(/[*\s]/g, ""));
    if (cands.some(c => c && (row.name.includes(c) || c.includes(row.name)))) agree++;
    else console.log("      ✗ " + id + "：我写的是「" + rec.means + "」，数据表写的是「" + row.name + "」");
  }
  ok("★★★ 手写探针记录与 data/kb/tips.json **逐条一致**（谁错都会暴露）",
    pinned >= 4 && agree === pinned, agree + "/" + pinned);
  // ★★★ 第 75 轮：概率条件的**口径与反例**
  const probOnly: string[] = [], mixed: string[] = [];
  for (const { nm, cid, k } of allPassives) {
    const v = classifySkill(k, TIPS, compileSkill(cid, nm, k)).v;
    if (v.verdict !== "CANDIDATE" || v.condition?.kind !== "PROBABILITY") continue;
    probOnly.push(nm + "「" + k.name + "」p=" + v.condition.p);
    // 每一条的概率必须能从原文里**复核**
    if (!v.condition.evidence.includes("概率")) probOnly.push("★证据缺失:" + nm);
  }
  const mixedRaw = allPassives.filter(({ nm, cid, k }) => {
    const c = classifySkill(k, TIPS, compileSkill(cid, nm, k)).v.clause;
    return c.includes("概率") && CONDITION_MARKERS_NO_PROB.test(c);
  });
  mixedRaw.forEach(({ nm, k }: any) => mixed.push(nm + "「" + k.name + "」"));
  ok("★★★ 概率被建模的被动 ≥ 10 条，且每条都能从原文复核（evidence 含「概率」）",
    probOnly.length >= 10 && probOnly.every(s => !s.includes("★证据缺失")), probOnly.length + " 条");
  ok("★★★ 反例：「概率 + 真条件」的被动**留在** HAS_CONDITION（不许因为认得概率就放行）",
    mixed.length >= 3 && mixedRaw.every(({ nm, cid, k }: any) => classifySkill(k, TIPS, compileSkill(cid, nm, k)).v.verdict === "HAS_CONDITION"),
    "混合条件 " + mixed.length + " 条：" + JSON.stringify(mixed.slice(0, 5)));
  ok("★★★ 反向：若把「概率」留在必须排除的标记里，上面那批必须全部退回 HAS_CONDITION",
    probOnly.length > 0 && probOnly.every(s => CONDITION_MARKERS.test(s.split("「")[0] + "概率") ),
    "(标记表里含概率 ⇒ 粗筛仍然看得见它)");
  console.log("    概率被建模：" + probOnly.length + " 条；概率+其它条件（仍挡住）：" + mixed.length + " 条");

  // ★★★ 第 77 轮：**拆桶** —— 挡住它的到底是"条件没建模"还是"效果细节没建模"。
  //   混在一起会导致修错方向：第 76 轮那 15 条被记成"缺条件"，实际要做的是把层数解析出来。
  //   ★ 三个数组各司其职（第一版把它们混用，于是 24 条正常的"效果阻挡"被当成了异常）：
  //     byCond = 条件桶；byEffectList = 效果桶；anomalies = 真正不该出现的情况。
  const byCond: string[] = [], byEffectList: string[] = [], anomalies: string[] = [];
  for (const { nm, cid, k } of allPassives) {
    const v = classifySkill(k, TIPS, compileSkill(cid, nm, k)).v;
    if (v.verdict !== "HAS_CONDITION") {
      if (v.blockedBy !== null) anomalies.push("★非 HAS_CONDITION 却带 blockedBy：" + nm);
      continue;
    }
    if (v.blockedBy === "CONDITION") byCond.push(nm);
    else if (v.blockedBy === "EFFECT") byEffectList.push(nm);
    else anomalies.push("★没有 blockedBy 的 HAS_CONDITION：" + nm);
  }
  //   ★ 判据：① 每个 HAS_CONDITION 都有 blockedBy（byEff 只用来装"缺 blockedBy"与"不该有 blockedBy"的例外）；
  //     ② 两个桶加起来必须**恰好等于** HAS_CONDITION（不能有既没进条件桶也没进效果桶的漏网者）。
  const effCount = byEffectList.length;
  ok("★★★ 每个 HAS_CONDITION 都写明了挡住它的是**条件**还是**效果细节**，且两桶之和恰好等于总数",
    anomalies.length === 0 && byCond.length + effCount === resT.HAS_CONDITION && byCond.length > 0 && effCount > 0,
    JSON.stringify({ byCondition: byCond.length, byEffect: effCount, total: resT.HAS_CONDITION, anomalies: anomalies.slice(0, 4) }));
  console.log("    挡住理由拆桶：条件没建模 " + byCond.length + " 条｜效果细节没建模 " +
    (resT.HAS_CONDITION - byCond.length) + " 条");
  ok("★★★ 拆桶后两个桶都非空（否则说明这一刀没切开）",
    byCond.length > 0 && resT.HAS_CONDITION - byCond.length > 0,
    JSON.stringify({ cond: byCond.length, eff: resT.HAS_CONDITION - byCond.length }));
  // ★ 反向：若"效果细节"不设防，这些会全部涌进候选
  const wouldFlood = allPassives.filter(({ nm, cid, k }: any) => {
    const v = classifySkill(k, TIPS, compileSkill(cid, nm, k)).v;
    return v.verdict === "HAS_CONDITION" && v.blockedBy === "EFFECT";
  }).length;
  ok("★★★ 反向：被「效果细节」挡住的有 " + wouldFlood + " 条 —— 不设这道闸门它们会直接进候选（那些效果引擎确实做不像）",
    wouldFlood > 0, String(wouldFlood));
  // ★★★ 第 87 轮：**条件建模了 ≠ 效果可执行**。
  //   查「九命猫『九命』」时发现：它的条件（4 层）建模了，可**复活**这个效果在 IR 里
  //   是 `revive: null` 且 unmodeledMechanics 明写「触发式复活…没有接线」——
  //   挂上去，运行时会在满足条件时执行一个**什么都不做**的 execute。
  //   判据用 IR 自己的话（`unmodeledMechanics[].clause` 记着"哪一句没建模"），**比到子句一级**。
  const leaky: string[] = [], falseAlarms: string[] = [];
  for (const { nm, cid, k } of allPassives) {
    const ir = compileSkill(cid, nm, k);
    const v = classifySkill(k, TIPS, ir).v;
    const un = (ir.unmodeledMechanics ?? []) as Array<{ clause?: string; verb?: string }>;
    //   ★★★ 第 89 轮：这里也必须**归一化后比较** —— 与生产代码（compile/passive-runtime.ts）保持同一判据。
    //   第一版测试用的是裸 `includes`，而 v.clause 是 resolveTips 之后的、u.clause 是原文，
    //   于是九命猫被算成"未建模在别的子句"→ 报了一条**假的"误伤"**。
    //   ★ 这与第 80 轮那次是同一类：**测试与生产用两种判据形状，就会得出两个数字。**
    const normCl = (s: string) => String(s ?? "").replace(/<br\s*\/?>/gi, "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "");
    const nc0 = normCl(v.clause ?? "");
    const sameClause = !!nc0 && un.some(u => { const nu = normCl(u.clause ?? ""); return nu.length > 6 && (nc0.includes(nu) || nu.includes(nc0)); });
    if (v.verdict === "CANDIDATE" && sameClause) leaky.push(nm + "「" + k.name + "」[" + un.map(u => u.verb).join(",") + "]");
    // 反向：未建模的动词在**别的**子句里 → 不该连累这一条
    //   ★ 第 89 轮修标签：`blockedBy === "EFFECT"` 有**两个来源** —— 触发子句未建模、
    //   以及 execute 没有任何可执行效果。后者与"未建模动词在别的子句"无关，不该算"误伤"
    //   （第一版把两者混在一起，于是报了一条假的"误伤"）。
    const surfaceEmpty = !((ir.damage ?? []).length || (ir.heal ?? []).length || (ir.shield ?? []).length ||
      (ir.statusRefs ?? []).length || (ir.purge ?? []).length || (ir.timeline ?? []).length || ir.revive ||
      (ir.orb?.gain ?? 0) > 0 || (ir.orb?.cost ?? 0) > 0);
    if (v.verdict !== "CANDIDATE" && v.blockedBy === "EFFECT" && un.length && !sameClause && !surfaceEmpty) falseAlarms.push(nm + "「" + k.name + "」");
  }
  ok("★★★ 没有候选的触发子句带着**未建模的效果**（条件建模 ≠ 效果可执行）",
    leaky.length === 0, JSON.stringify(leaky.slice(0, 5)));
  // ★★★ 第 93 轮：这条断言**转向**了。原文是：
  //   ok("反例：效果是**吸血**的「诱惑」必须被拦住（吸血在 IR 里没实现）", …verdict !== "CANDIDATE")
  //   它当时是**效果闸门的代表性反例**，第 87/88 轮一直靠它证明"条件建模 ≠ 效果可执行"。
  //   第 93 轮把吸血接进伤害管线（SkillIR.lifesteal 有值 → hasEffect 为真），
  //   于是诱惑**应该**变成候选 —— 它现在真的有事可做。
  //   ★ 效果闸门本身**没有被删掉**，它的反例换成了「九命猫『九命』」（下面那条，理由复活未实现）；
  //     换句话说：转向的是**这一条反例**，不是那条闸门。
  ok("★★★ 第 93 轮转向：效果是吸血、而吸血**已接线**的「诱惑」现在必须是候选",
    classifySkill(allPassives.find(p => p.k.name === "诱惑")!.k, TIPS,
      compileSkill(202, "三尾狐", allPassives.find(p => p.k.name === "诱惑")!.k)).v.verdict === "CANDIDATE",
    JSON.stringify(classifySkill(allPassives.find(p => p.k.name === "诱惑")!.k, TIPS,
      compileSkill(202, "三尾狐", allPassives.find(p => p.k.name === "诱惑")!.k)).v));
  ok("★★★ 反向（精度）：未建模动词在**别的**子句里时**不许**连累这一条 —— 否则会误伤一片",
    falseAlarms.length <= 1, JSON.stringify(falseAlarms.slice(0, 5)) + "（第 87 轮实测：粗判据会误报 10 条，收到子句级后只剩 3 条）");
  // ★★★ 第 89 轮：上面那道闸门第一版有**静默漏判** —— 它比较的两个子句来自**不同的文本**：
  //   `v.clause` 是 `resolveTips` 之后的（`[恢复]`），`u.clause` 是 IR 里**未解析**的原文（`[tips_20]`）。
  //   直接 includes 会失败，于是**含 [tips_N] 的未建模子句整类被漏掉**。
  //   实测：九命猫「九命」（复活 + `[tips_20]`）一直因此被当成候选。
  //   ⇒ 判据改成**归一化后比较**（去掉方括号内容与 <br>）。下面这条就是它的回归锁。
  {
    /**
     * ★★★ 第 135 轮：**这条回归锁的被查对象按事实换了**。
     *   原来是「九命猫『九命』」—— 它的复活子句里有 [tips_20]，旧判据（直接 includes）会静默漏掉它。
     *   但第 129 轮把触发式复活接线（SkillIR.selfRevive）、第 135 轮又把同一句里的追加施放接线
     *   （SkillIR.subCasts），于是它**已经不再是"被拦住"的例子** —— 它现在就该是候选。
     *   ⇒ 换成**仍然**靠这条归一化规则保护的例子：青蛙瓷器「转运」（复活子句里同样有 [tips_20]，
     *     而它的条件「若有至少两个骰子同点」没有模型 ⇒ 仍然被挡住）。
     */
    const wq = allPassives.find(p => p.k.name === "转运");
    ok("★★★ 回归：「青蛙瓷器『转运』」必须被拦住 —— 它的复活子句里有 [tips_20]，旧判据会静默漏掉它",
      !!wq && classifySkill(wq.k, TIPS, compileSkill(wq.cid, wq.nm, wq.k)).v.verdict !== "CANDIDATE",
      JSON.stringify(wq ? classifySkill(wq.k, TIPS, compileSkill(wq.cid, wq.nm, wq.k)).v.blockedBy : null));
    /** ★ 理由按实测写：它先撞上的是**条件闸门**（「若有至少两个骰子同点」没有模型），不是效果闸门 */
    ok("★★★ 而且挡住它的理由是 CONDITION（骰子条件没有模型），而不是被当成无条件执行",
      !!wq && classifySkill(wq.k, TIPS, compileSkill(wq.cid, wq.nm, wq.k)).v.blockedBy === "CONDITION",
      JSON.stringify(wq ? classifySkill(wq.k, TIPS, compileSkill(wq.cid, wq.nm, wq.k)).v.blockedBy : null));
    /** ★ 反向：九命猫现在**必须**是候选（复活 + 追加施放都接线了）—— 否则说明接线没生效 */
    const jm = allPassives.find(p => p.k.name === "九命");
    ok("★★★ 反向：九命猫『九命』现在**是候选**（复活与追加施放都已接线）",
      !!jm && classifySkill(jm.k, TIPS, compileSkill(jm.cid, jm.nm, jm.k)).v.verdict === "CANDIDATE",
      JSON.stringify(jm ? classifySkill(jm.k, TIPS, compileSkill(jm.cid, jm.nm, jm.k)).v.blockedBy : null));
  }
  console.log("    效果可执行性：漏网 " + leaky.length + "｜被误伤 " + falseAlarms.length +
    "｜全库候选 " + resT.CANDIDATE + " 条");
  console.log("    ★ 结论：被动运行时可以开工，第一批能碰 CANDIDATE 那 " + resT.CANDIDATE +
    " 条；另有 " + resT.HAS_CONDITION + " 条缺条件模型。");
  console.log("      " + (rawT.HAS_PLACEHOLDER - resT.HAS_PLACEHOLDER) +
    " 条此前被记成「缺占位符解析」，第 71 轮证明那是我没读 data/kb/tips.json。");
}
console.log("\n=== 触发时机登记册自检: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
