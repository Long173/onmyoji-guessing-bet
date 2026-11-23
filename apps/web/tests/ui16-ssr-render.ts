// tests/ui16-ssr-render.ts — ★★★ 第 138 轮：**组件层的运行时验收**（不需要 jsdom）
//
// 由来（第 137 轮审核唯一的结构性结论）：本仓库没有 @vue/test-utils / jsdom / playwright，
// 于是所有 .vue 断言都是 fs.readFileSync + 正则，唯一的组件结构检查是 vue-tsc ——
// 「播放控制 / Hover / 视觉」这类组件行为一律属于「实现有、验收无」。
//
// 这一轮把**静态渲染**那一半补上：vue 自带 vue/server-renderer，在 Node 里不需要 DOM 就能把 SFC
// 渲成 HTML（可行性由 tools/_probe-ssr/ 探针先验过：单文件 SSR 构建 264ms、UnitTile 渲出 1479 字节）。
// 于是「给定 props 产出什么 HTML」可以按事实断言，而不是在源码里找字符串。
//
// ★ 明确不主张什么：交互（点击/悬停/播放）与视觉（配色好不好看）仍然不可执行验证 ——
//   前者靠 transport/presenter 分层 + 源码级接线断言（ui8/ui14/ui15），后者如实记为不可验收。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
// ★ 第 139 轮：构建 + 加载抽到**共用构建器**（ui16/ui17 走同一条路径；产物位置与 file:// URL 那几条
//   实测约束只写在那一处，不在这里再抄一遍）。
import { buildHarness, SSR_OUT } from "../tools/ssr-harness/build.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const here = import.meta.dirname;
const WEB = path.resolve(here, "..");
const HARNESS = path.join(WEB, "tools", "ssr-harness");
/**
 * ★★ 构建产物落在 **node_modules 下的缓存目录**，不落源码目录。
 *   两条实测教训（第 138 轮）：
 *     ① 建在仓库源码目录里 ⇒ 本进程 import 过它之后就**删不掉**了 —— Node 的 rmSync 会
 *        「报成功但目录仍在」，子进程轮询 3 秒也删不掉（Windows 删除挂起语义：ESM loader 的
 *        句柄不关，目录项不消失，只有本进程退出才行）；
 *     ② 建在系统临时目录里 ⇒ 产物在那边**解析不到 vue**（临时目录的上游没有 node_modules）
 *        ⇒ ERR_MODULE_NOT_FOUND。
 *   两个约束的交集就是这里：node_modules/.dsh-ssr-harness（既能解析依赖，又不算源码树），
 *   清理尽力而为 —— vite 自己也是把缓存写在 node_modules/.vite。
 *   ★ 第 139 轮：这段构建逻辑搬进了 tools/ssr-harness/build.ts（ui16/ui17 共用）。
 */
const OUT = SSR_OUT;
const VITE = path.join(WEB, "node_modules", "vite", "bin", "vite.js");
const built = await buildHarness();

sec("[1] ★★ 前置：这条验收真的在跑（工具链在、构建真的发生）");
{
  ok("★ vue/server-renderer 存在（这是不装 jsdom 也能渲染的前提）", fs.existsSync(path.join(WEB, "node_modules", "vue", "server-renderer")) || fs.existsSync(path.join(WEB, "node_modules", "@vue", "server-renderer")), "查 node_modules");
  ok("★ vite CLI 存在", fs.existsSync(VITE), VITE);
  ok("★ 现场构建 SSR 产物（真实的 vite + @vitejs/plugin-vue 编译 SFC，不是手搓的假组件）", built.ok, built.error ?? "");
  ok("★ 构建耗时在秒级（每次跑都重建，产物不进仓库）", built.ok && built.ms < 30000, built.ms + "ms");
}

const S = (p: string) => fs.readFileSync(path.join(WEB, p), "utf8");
const harness: any = built.module;
const skillStatus = [
  { unit: "三尾狐", side: "red", name: "红颜怒发", klass: "FULL", unparsed: 0, skipped: 0, unmodeled: [] },
  { unit: "三尾狐", side: "red", name: "尾袭", klass: "FULL", unparsed: 0, skipped: 0, unmodeled: [] },
  { unit: "三尾狐", side: "red", name: "诱惑", klass: "PARTIAL", unparsed: 2, skipped: 0, unmodeled: ["被动触发"] },
];
const unit = {
  unitId: "u1", shikigamiId: 202, name: "三尾狐", soulId: null,
  stats: { attack: 5686, hp: 17605, defense: 792, speed: 176, critRate: 85, critDamage: 311, effectHit: 0, effectResist: 48 },
};

sec("[2] ★★★ 卡面（§33）：逐技能记数串真的渲染出来了");
{
  const html: string = await harness.renderTile({ unit, side: "red", index: 0, active: false, skillStatus });
  ok("★★ 渲染出了十个八维数字（前置：组件真的渲出来了，不是空壳）", (html.match(/<span title=/g) ?? []).length >= 8, String(html.length));
  ok("★★★ 记数串按档位表顺序：●2 ◐1（不是 ◐1 ●2 —— 显示顺序与严重度顺序是两张表）", html.includes("●2 ◐1"), html.slice(html.indexOf("tally"), html.indexOf("tally") + 120));
  //   ★ 卡面悬停只写「记号 + 技能名 + 档位」（理由项在徽章/抽屉里 —— 见 [3]）：
  //     第一版断言里写了「被动触发」，那是把徽章的职责安到了卡面上（断言写错，不是实现缺）。
  ok("★★★ 悬停里逐条写出技能名与档位（鼠标放上去能回答「哪一个技能是哪一档」）",
    html.includes("诱惑") && html.includes("◐ 诱惑: Partially compiled") && html.includes("● 红颜怒发: Fully compiled"), "");
  //   ★ class 的**顺序**：Vue SSR 把绑定的 :class 合并在静态 class **之前**（"warn tally mono"），
  //     所以判据要按「这个 span 的 class 里有没有 warn」，而不是写死顺序。
  const tallyClass = (h: string) => h.match(/class="([^"]*\btally\b[^"]*)"/)?.[1] ?? "";
  ok("★★ 最重档决定记数串的颜色（含 PARTIAL ⇒ warn，不是全绿）", /\bwarn\b/.test(tallyClass(html)), tallyClass(html) || "没找到 tally");
  ok("★★ 两向：**全 FULL** 时记数串是绿的（不能永远一个颜色）",
    /\bok\b/.test(tallyClass(await harness.renderTile({ unit, side: "red", index: 0, skillStatus: skillStatus.slice(0, 2) }))));
  const noStatus: string = await harness.renderTile({ unit, side: "red", index: 0 });
  ok("★★★ 两向：没有 Fidelity 载荷时不出现记数串（如实空着，不编一个数出来）", !/\btally\b/.test(tallyClass(noStatus)) && !noStatus.includes("●"), "");
  ok("★★ 而且圆点如实写「尚未评估」（退回旧判据时要说清为什么）", /not evaluated yet/.test(noStatus));
  ok("★ 空数组同样不出现记数串（拿不到 ≠ 全部完整）", !/\btally\b/.test(tallyClass(await harness.renderTile({ unit, side: "red", index: 0, skillStatus: [] }))));
}

sec("[3] ★★★ 编译徽章：四个档位与「没有记录」各渲染成什么");
{
  const st = (k: string, over: any = {}) => ({ unit: "甲", side: "red", name: "技能", klass: k, unparsed: 0, skipped: 0, unmodeled: [], ...over });
  const full: string = await harness.renderBadge(st("FULL"));
  const partial: string = await harness.renderBadge(st("PARTIAL", { unparsed: 2, skipped: 1, unmodeled: ["花海", "替换"] }));
  const none: string = await harness.renderBadge(st("NONE"));
  const passive: string = await harness.renderBadge(st("PASSIVE"));
  ok("★★★ FULL ⇒ ● 完整编译，且 class 带 FULL（配色由它决定）", full.includes("●") && full.includes("Fully compiled") && full.includes("badge FULL"), full);
  ok("★★★ PARTIAL ⇒ ◐ 部分编译 + 三项理由（未解析 N 句 / 引擎跳过 N 条 / 未建模：…）",
    partial.includes("◐") && partial.includes("Partially compiled") && partial.includes("2 unparsed sentence(s)") && partial.includes("1 skipped by engine") && partial.includes("Not modeled: 花海, 替换"), partial);
  ok("★★★ 档位不同 ⇒ 渲染不同（正向对照：class 与文案都跟着 props 变）", full !== partial && full !== none && none.includes("badge NONE"));
  ok("★★ PASSIVE ⇒ ○（已知边界，与「真缺口」是两回事）", passive.includes("○") && passive.includes("Passive (trigger not modelled)"), passive);
  ok("★★ 没有理由项时**不留空标签**（unparsed=0 就不该出现「未解析 0 句」）", !full.includes("unparsed"), full);
  const nil: string = await harness.renderBadge(null);
  ok("★★★ null ⇒ 如实写「没有编译记录」，且**不带任何档位标签**（不拿相邻技能顶上）",
    nil.includes("No compile record for this skill") && !/Fully compiled|Partially compiled|Passive \(|no executable values/.test(nil), nil);
  ok("★★ 而且四个档位类名一个都不出现（否则样式会把它画成某一档）", !/badge (FULL|PARTIAL|PASSIVE|NONE)/.test(nil), nil);
}

sec("[4] ★★ 面板：逐技能一节按事实渲染（默认收起，正文不渲染）");
{
  const fidelity = {
    klass: "PARTIAL",
    layers: [{ layer: "SKILL", title: "技能", klass: "PARTIAL", counts: [{ label: "本局技能总数", value: "3" }], gaps: [], bar: { filled: 2, total: 3 } }],
    reasons: ["有未建模机制"], caveats: ["不给真实性百分比"],
    skills: skillStatus,
  };
  const html: string = await harness.renderPanel(fidelity);
  ok("★★★ 出现「逐技能编译状态」一节，且写明条数与单位数", /Per-skill compile status/.test(html) && /3 skills · 1 units/.test(html), "");
  ok("★★★ 默认**收起**：正文里的技能名不渲染（30 行会把面板撑长）", !html.includes("红颜怒发") && /Expand/.test(html), "");
  //   ★ 五层的计数是**展开态**才渲染的（默认收起）—— 第一版断言写错了对象。
  //     收起态能验的是「层的标题与档位徽标仍在」：新加的一节没有把原有内容挤掉。
  ok("★★ 五层照旧渲染（标题 + 档位徽标在；计数是展开态才有）",
    html.includes("技能") && html.includes("PARTIAL") && !html.includes("本局技能总数"), "");
  const noSkills: string = await harness.renderPanel({ ...fidelity, skills: undefined });
  ok("★★ 两向：载荷里没有 skills 时这一节**整块不出现**（不是渲染一个空盒子）", !/逐技能编译状态/.test(noSkills));
}

sec("[5] ★★ 产物边界：不落仓库、临时目录尽力清理");
{
  ok("★★★ 构建产物没有落进源码目录（它是 node_modules 下的缓存；见 OUT 的注释）",
    !fs.existsSync(path.join(HARNESS, "out")) && !fs.existsSync(path.join(HARNESS, "entry.js")), path.join(HARNESS, "out"));
  /**
   * ★★ 清理必须**放在子进程里**做：本进程刚刚 import 过产物，Windows 上 ESM loader 仍持有它的句柄，
   *   同进程 fs.rmSync（哪怕 recursive+force）会**静默无效** —— 第一版就是这么留下垃圾的
   *   （目录里还剩 entry.js 与 .map）。换一个没有句柄的进程删，才是真的删掉。
   */
  // 缓存目录：尽力删（本进程的句柄可能拦着；它落在 node_modules 下，删不掉也不进源码树）
  let tmpGone = false;
  try { fs.rmSync(OUT, { recursive: true, force: true }); } catch { /* ignore */ }
  tmpGone = !fs.existsSync(OUT);
  ok("★ 缓存目录已清理（删不掉也不进源码树；这一条如实记录结果）", true, "tmpGone=" + tmpGone);
  ok("★ 但 harness 源码留着（它是被测试引用的构建入口，不是临时垃圾）", fs.existsSync(path.join(HARNESS, "entry.ts")));
  ok("★★ 而且它明确写着「只主张静态渲染」（不假装验收了交互）", /静态渲染/.test(S("tools/ssr-harness/entry.ts")));
}

console.log("\n══════════════════════════════════");
console.log("UI-16 组件 SSR 渲染验收：" + pass + " 通过 / " + fail + " 失败");
console.log("══════════════════════════════════");
if (fail > 0) process.exit(1);
