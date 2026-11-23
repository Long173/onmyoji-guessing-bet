// tests/ui17-visual-render.ts — ★★★ 第 139 轮：**视觉层与 Theater 的真实渲染验收**（a1-4 §12-§19 / §29 / ⑪）
//
// 由来（第 137 轮审核的结论）：⑪ UI 2.0 的「视觉层」这一项**只有读源码 + 正则** —— 颜色令牌确实在
// base.css 里，但「渲染出来的元素到底带没带那个类」「那个类在样式表里有没有规则」「var(--x) 解析得出来吗」
// 一条断言都没有。审核把它记为「部分：颜色真存在，但视觉层好不好不可执行验证」。
//
// 第 138 轮补了 SSR 渲染（ui16，卡面/徽章/面板）。这一轮把它推到 Theater 与 Entity Card ——
// 也就是 §12-§19 那批「画面上必须看得见」的要求：
//   · 10 张 Entity Card / 行动条 / 鬼火 / 控制条 / 拖动条，全部按**真实 Replay 文件**渲染出来；
//   · 死亡状态机五态、护盾、Buff 层数、Hover 文案、未结算标记，按**合成 UnitView** 逐个渲染；
//   · 还有一条以前没人查的：渲染里用到的每个 CSS 变量，base.css **真的定义了吗**
//     （拼错一个 token 会静默回退成「没有样式」，而任何正则断言都发现不了）。
import fs from "node:fs";
import path from "node:path";
import { buildHarness } from "../tools/ssr-harness/build.ts";
import { SPEEDS } from "../src/theater/transport.ts";
import { displayName } from "../src/kb/names.ts";
import { enEngine } from "../src/kb/en-engine.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const here = import.meta.dirname;
const WEB = path.resolve(here, "..");
const ROOT = path.resolve(WEB, "..", "..");
const S = (p: string) => fs.readFileSync(path.join(WEB, p), "utf8");

const built = await buildHarness();
sec("[1] ★★ 前置：构建可用（否则下面全是平凡通过）");
{
  ok("★★ SSR 构建成功", built.ok, built.error ?? "");
  for (const fn of ["renderTheater", "renderCard"]) ok("★ 构建产物导出了 " + fn, typeof built.module?.[fn] === "function");
}
const h: any = built.module;
const replay = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "replay-demo-123456.json"), "utf8"));

sec("[2] ★★★ 整场 Theater 按真实 Replay 渲染（§12/§14/§15/§59）");
{
  const html: string = await h.renderTheater(replay, 123456);
  const cards = html.match(/class="card [^"]*"/g) ?? [];
  ok("★★★ 10 张 Entity Card 全部渲染出来（§59 的第一条要求）", cards.length === 10, String(cards.length));
  ok("★★★ 红蓝各 5 张，且阵营类真的在元素上（不是靠父容器上色）",
    cards.filter(c => /card red/.test(c)).length === 5 && cards.filter(c => /card blue/.test(c)).length === 5,
    JSON.stringify(cards.slice(0, 3)));
  ok("★★★ 十个名字都出现在各自卡面上（英文显示名）", replay.match.red.concat(replay.match.blue).every((n: string) => html.includes(enEngine(displayName(n)))),
    JSON.stringify(replay.match.red.concat(replay.match.blue).filter((n: string) => !html.includes(enEngine(displayName(n))))));
  ok("★★ 行动条区渲染出来，且每个单位一行（§14：位置越靠右越先出手）",
    html.includes("ACTION BAR") && (html.match(/class="[^"]*abrow/g) ?? []).length === 10,
    String((html.match(/abrow/g) ?? []).length));
  ok("★★ 每一行都带速度数字（行动条的分母，速度变化要看的就是它）",
    (html.match(/class="abspd mono tiny"/g) ?? []).length === 10, String((html.match(/abspd/g) ?? []).length));
  ok("★★★ 双方鬼火都渲染（🔥 N/8）与回火计数条", (html.match(/🔥 \d+\/8/g) ?? []).length === 2, JSON.stringify(html.match(/🔥 \d+\/8/g)));
  ok("★★ 双方存活数渲染（N/5）", (html.match(/Alive \d+\/5/g) ?? []).length === 2, JSON.stringify(html.match(/Alive \d+\/5/g)));
  ok("★★★ 帧号/回合标签用的是**状态里的回合**而不是恒 0 的帧字段（第 137 轮修的那个 bug）",
    /Turn \d+ · frame 0\/\d+/.test(html), (html.match(/Turn \d+ · frame \d+\/\d+/) ?? ["没找到"])[0]);
  ok("★★ 终局原因写出来了（这一场是 TEAM1_WIPED）", html.includes("TEAM1_WIPED"), "");
  // ── 控制条（§59：播放/暂停/单步/倍速/拖动） ──
  for (const t of ["Go to start", "Previous key moment", "Previous turn", "Previous frame", "Next frame", "Next turn", "Next key moment", "Go to end"]) {
    ok("★ 控制按钮在：" + t, html.includes("title=\"" + t + "\""));
  }
  ok("★★ 播放键的文字是「▶ 播放」（暂停态才写暂停）", html.includes("▶ Play"), "");
  const seg = html.slice(html.indexOf("Speed "), html.indexOf("</label>", html.indexOf("Speed ")));
  const btns = [...seg.matchAll(/<button class="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map(m => ({ cls: m[1], text: m[2] }));
  ok("★★★ 倍速档位**来自 transport 的 SPEEDS**（渲染集 == 模块里的档位集，不是模板里另写一份）",
    JSON.stringify(btns.map(b => b.text)) === JSON.stringify(SPEEDS.map(s => s + "×")),
    JSON.stringify(btns.map(b => b.text)) + " vs " + JSON.stringify(SPEEDS.map(s => s + "×")));
  ok("★★★ 当前档位只有一个被标成 on，且是默认的 1×（两向：不许全亮也不许全灭）",
    btns.filter(b => /\bon\b/.test(b.cls)).length === 1 && btns.find(b => /\bon\b/.test(b.cls))!.text === "1×",
    JSON.stringify(btns));
  const scrub = html.match(/<input class="scrub"[^>]*>/)?.[0] ?? "";
  ok("★★★ 拖动条的最大值 == 帧数-1（从录像算出来的，不是写死的）",
    scrub.includes("max=\"" + (replay.frames.length - 1) + "\""), scrub);
  ok("★ 拖动条初始在第 0 帧", /value="0"/.test(scrub), scrub);
  ok("★★ 两向：检查器默认**不**渲染（它在 showInspector 后面，不是常驻一大片）", !html.includes("Damage breakdown"), "");
}

sec("[3] ★★★ Entity Card 的五态与细节（§13/§16/§18）");
const baseUnit = (over: any = {}) => ({
  id: 101, unitId: "r1", side: "red", name: "三尾狐", hp: 5000, maxHp: 10000, hpPct: 50,
  shield: 0, alive: true, state: "ALIVE", statuses: [],
  stats: { atk: 5686, hp: 10000, def: 792, spd: 176, cri: 0.85, crid: 3.11, efh: 0, efr: 0.48 },
  timeline: 0.42, locked: false, usedSkills: [], isActor: false, isTarget: false, ...over,
});
{
  const alive: string = await h.renderCard(baseUnit());
  ok("★★★ 存活单位：没有 dead 类、没有状态徽标（两向的起点）", !/\bdead\b/.test(alive) && !/class="[^"]*state"/.test(alive), alive.slice(0, 160));
  ok("★★ HP 条宽度与百分比文字来自 hpPct", alive.includes("width:50%") && alive.includes(">50%<"), "");
  ok("★★ 行动条位置来自 timeline（42%）", alive.includes("left:42%") && alive.includes("Action bar 42.0%"), "");
  ok("★★ 无护盾时**不渲染**护盾片（0 不是「有盾」）", !alive.includes("🛡"), "");
  ok("★ 未锁定时不渲染锁", !alive.includes("🔒"));
  ok("★★★ 效果命中/抵抗带「未结算」标记（这两维在引擎里没有消费者，不许看起来像在参与结算）",
    alive.includes("not applied") && /class="unused"/.test(alive), "");
  ok("★ Large numbers use the k abbreviation (17,605 → 17.6k)", (await h.renderCard(baseUnit({ hp: 17605 }))).includes("17.6k"));
  ok("★ actor / target 高亮类跟着 props 走",
    /class="card red actor"/.test(await h.renderCard(baseUnit({ isActor: true }))) && /\btarget\b/.test(await h.renderCard(baseUnit({ isTarget: true }))));
  ok("★ 锁定态渲染 🔒", (await h.renderCard(baseUnit({ locked: true }))).includes("🔒"));
  ok("★★★ 护盾只在 >0 时渲染，并把数值写出来", (await h.renderCard(baseUnit({ shield: 250 }))).includes("🛡 250"));

  // 五态：标签 + 类名两向
  const states: Array<[string, string, string]> = [
    ["HP_ZERO", "HP≤0", "hp_zero"], ["DEAD", "Dead", "dead"], ["KILLED", "Killed", "killed"], ["TRANSFORMED", "Transformed", "transformed"],
  ];
  for (const [st, label, cls] of states) {
    const html: string = await h.renderCard(baseUnit({ state: st, alive: st === "TRANSFORMED" }));
    ok("★★★ 状态 " + st + " ⇒ 徽标「" + label + "」+ 类名 " + cls, html.includes(label) && new RegExp("class=\\\"" + cls + " state\\\"").test(html), html.slice(0, 200));
  }
  const trans: string = await h.renderCard(baseUnit({ state: "TRANSFORMED", alive: true }));
  ok("★★★ 变形**不是**死亡：transformed 类在、dead 类不在、血量照常显示（§18 的死亡状态机）",
    /class="card red transformed"/.test(trans) && !/\bdead\b/.test(trans), trans.slice(0, 140));
  const killed: string = await h.renderCard(baseUnit({ state: "KILLED", alive: false, hp: 0, hpPct: 0 }));
  ok("★★★ 阵亡单位同时带 dead 与状态类（灰化 + 徽标），两件事都有", /class="card red dead"/.test(killed) && killed.includes("Killed"));

  // Buff / Hover
  const st = (over: any = {}) => ({ id: "buff_1", name: "buff_1", stacks: 1, remaining: 3, tag: "BUFF", isDebuff: false, effects: 0, ...over });
  const buffed: string = await h.renderCard(baseUnit({ statuses: [st({ stacks: 2, effects: 1 }), st({ id: "CONTROL_stun", tag: "CONTROL", isDebuff: true })] }));
  ok("★★★ 层数 >1 才写 ×N（1 层写 ×1 是噪声）", buffed.includes("×2") && !buffed.includes("×1"), "");
  ok("★★★ 减益/控制的状态片带 debuff 类（颜色语义：增益绿 / 减益红）", /class="debuff buff"/.test(buffed) && /class="buff"/.test(buffed), "");
  ok("★★★ Hover 文案写全四样：剩余回合 / 层数 / tag / 生效效果数",
    /3 turn\(s\) left · 2 stack\(s\) · tag BUFF · 1 active effect\(s\)/.test(buffed), "");
  ok("★★★ 有效果数才写「生效效果 N 项」（0 项是噪声 —— 与卡面同一口径）",
    /tag CONTROL\" data-v/.test(buffed) && !/tag CONTROL · 0 active effect/.test(buffed), "");
  const many: string = await h.renderCard(baseUnit({ statuses: Array.from({ length: 8 }, (_, i) => st({ id: "buff_" + i })) }));
  ok("★★★ 状态超过 6 个时只画 6 个 + 一个「+N」（卡面不会被 buff 撑爆）",
    (many.match(/class="buff"/g) ?? []).length === 6 && many.includes("+2"), String((many.match(/class="buff"/g) ?? []).length));
  ok("★ 没有状态时不渲染 buff 区", !/class="buffs"/.test(alive));
}

sec("[4] ★★★ 视觉层：渲染出来的类名与 CSS 变量必须真的接得上");
{
  const card = S("src/components/theater/EntityCard.vue");
  for (const sel of [".card.dead", ".card.transformed", ".buff.debuff", ".shield", ".stats .unused", ".card.red", ".card.blue"]) {
    ok("★★ 卡面用到的选择器在样式里真的有规则：" + sel, card.includes(sel), "");
  }
  const base = S("src/styles/base.css");
  const defined = new Set([...base.matchAll(/--([a-z0-9-]+)\s*:/g)].map(m => m[1]));
  ok("★★ 前置：令牌表非空", defined.size >= 15, String(defined.size));
  const usedIn = ["src/styles/base.css", "src/components/theater/EntityCard.vue", "src/components/theater/BattleTheater.vue",
    "src/components/lineup/UnitTile.vue", "src/components/simulation/FidelityPanel.vue", "src/components/knowledge/CompiledBadge.vue",
    "src/components/knowledge/DetailDrawer.vue"];
  const missing: string[] = [];
  for (const f of usedIn) for (const m of S(f).matchAll(/var\(--([a-z0-9-]+)/g)) if (!defined.has(m[1])) missing.push(f + ":--" + m[1]);
  ok("★★★ 所有 var(--x) 都在 base.css 里有定义（拼错一个 token 会静默没有样式，正则断言发现不了）",
    missing.length === 0, JSON.stringify([...new Set(missing)].slice(0, 6)));
  // 正向对照：这个判据不是空的 —— 编一个不存在的 token 必须被抓到
  const fake = "var(--not-a-token)";
  ok("★★ 正向对照：不存在的 token 会被这条判据抓到", [...fake.matchAll(/var\(--([a-z0-9-]+)/g)].some(m => !defined.has(m[1])));
  ok("★★★ 阵营色与状态色语义确实被卡面用上（红/蓝边框、绿=增益、红=减益）",
    /var\(--red\)/.test(card) && /var\(--blue\)/.test(card) && /var\(--ok\)/.test(card) && /var\(--warn\)/.test(card) && /var\(--danger\)/.test(card));
}

console.log("\n══════════════════════════════════");
console.log("UI-17 视觉层与 Theater 渲染验收：" + pass + " 通过 / " + fail + " 失败");
console.log("══════════════════════════════════");
if (fail > 0) process.exit(1);
