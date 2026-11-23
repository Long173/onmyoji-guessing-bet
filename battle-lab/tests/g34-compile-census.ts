// tests/g34-compile-census.ts — ★★ 给「编译产物全量 diff」补自检（第 47 轮）
//
// 由来（报告 §38）：我改了一次解析器，338 条 buff 里 146 条变了、两条符号翻转 ——
// 而那个改动在**所有现有信号下都是绿的**（没有测试逐条断言编译结果，典型对局指纹也不动）。
// tools/compile-census.ts 把"快照 + 逐条 diff + 每条变化必须解释"机械化了，
// 这个测试按项目惯例给它补**正反两面**的自检（§25/§26/§33 的规矩）：
//   ① 它能抓到真变化；② 它不会冤枉没变的；③ 它在真实代码库上今天是通过的。
import fs from "node:fs";
import path from "node:path";
import { diffCensus, firstDifference, compileAll, comparable } from "../tools/compile-census.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const root = path.resolve(import.meta.dirname, "..", "..");

sec("[1] ★★ 纯函数：变化 / 新增 / 消失 / 已解释 / 未解释");
{
  const base = { skills: { "217/s1": "A", "217/s2": "B" }, buffs: { "1": "X" } };
  const same = { skills: [{ key: "217/s1", json: "A" }, { key: "217/s2", json: "B" }], buffs: [{ key: "1", json: "X" }] };
  const r0 = diffCensus(base, same, {});
  ok("★ 完全一致 → 什么都不报", r0.changed.length === 0 && r0.added.length === 0 && r0.removed.length === 0, JSON.stringify(r0));

  const one = { skills: [{ key: "217/s1", json: "A2" }, { key: "217/s2", json: "B" }], buffs: [{ key: "1", json: "X" }] };
  const r1 = diffCensus(base, one, {});
  ok("★★ 一条变了 → 报 1 条**未解释**", r1.changed.length === 1 && r1.unexplained.length === 1 && r1.explained.length === 0, JSON.stringify(r1.changed));

  const r2 = diffCensus(base, one, { "skills:217/s1": "我改了解析器，理由如下" });
  ok("★★ 同一条变化写了理由 → 变成**已解释**，不再算失败", r2.explained.length === 1 && r2.unexplained.length === 0, JSON.stringify(r2.explained));

  const addRemove = { skills: [{ key: "217/s1", json: "A" }, { key: "217/s3", json: "C" }], buffs: [{ key: "1", json: "X" }] };
  const r3 = diffCensus(base, addRemove, {});
  ok("★★ 新增与消失各自单独报（不许静默）", r3.added.join(",") === "skills:217/s3" && r3.removed.join(",") === "skills:217/s2", JSON.stringify([r3.added, r3.removed]));

  const r4 = diffCensus(base, { skills: [], buffs: [] }, {});
  ok("★ 全空输入 → 全部算消失（防止「基线读不到」被当成「没变化」）", r4.removed.length === 3, JSON.stringify(r4.removed));

  ok("★ 空基线上什么都算新增（同理，空基线不许平凡通过）", diffCensus({ skills: {}, buffs: {} }, same, {}).added.length === 3);
}

sec("[2] ★★ firstDifference：要能一眼看出变了什么");
{
  const a = '{"damage":[{"ratio":100,"type":"NORMAL"}],"hits":1}';
  const b = '{"damage":[{"ratio":150,"type":"NORMAL"}],"hits":1}';
  const d = firstDifference(a, b);
  ok("★★ 差异定位到 100 → 150 那一处", /100/.test(d) && /150/.test(d) && d.includes("⟶"), d);
  ok("★ 相同字符串不产生误导性差异", firstDifference(a, a).includes("⟶"));
}

sec("[3] ★★ 真实代码库：今天必须 0 未解释变化（这条是闸门）");
{
  const kb = path.join(root, "data", "kb");
  const { input, dupSkillKeys } = compileAll(kb);
  ok("★ 前置：编译出了全部产物（818 技能 / 338 buff）", input.skills.length === 818 && input.buffs.length === 338,
    JSON.stringify([input.skills.length, input.buffs.length]));
  ok("★ 技能键唯一（键重复会让 diff 失真）", dupSkillKeys.length === 0, JSON.stringify(dupSkillKeys.slice(0, 5)));
  const baselinePath = path.join(root, "battle-lab", "fixtures", "compile-baseline.json");
  ok("★★ 基线文件存在且非空（否则下面的断言会平凡通过）", fs.existsSync(baselinePath) && fs.statSync(baselinePath).size > 100000,
    fs.existsSync(baselinePath) ? String(fs.statSync(baselinePath).size) : "缺失");
  const base = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  ok("★★ 基线自身条目数正确（不是空壳）", Object.keys(base.skills).length === 818 && Object.keys(base.buffs).length === 338,
    JSON.stringify([Object.keys(base.skills).length, Object.keys(base.buffs).length]));
  const explainPath = path.join(root, "battle-lab", "tools", "compile-explain.json");
  const explain = fs.existsSync(explainPath) ? JSON.parse(fs.readFileSync(explainPath, "utf8")) : {};
  const r = diffCensus(base, input, explain);
  ok("★★★ 今日 0 未解释变化（任何解析器改动都必须先过这一关）", r.unexplained.length === 0,
    JSON.stringify(r.unexplained.slice(0, 3).map(c => c.ns + ":" + c.key)));
  ok("★ 也没有凭空多出/消失的产物", r.added.length === 0 && r.removed.length === 0,
    JSON.stringify([r.added.slice(0, 3), r.removed.slice(0, 3)]));

  // 正向对照：把输入里**一条**的产物换掉，必须立刻被抓到 —— 否则上面那条闸门是空的。
  const mutated = { skills: input.skills.map((e, i) => i === 0 ? { ...e, json: e.json.replace(/\d/, "9") } : e), buffs: input.buffs };
  const rm = diffCensus(base, mutated, explain);
  // ★ 第 48 轮更正：基线可以带**已解释**的变化（那是审计轨迹，见 §40.5），
  //   所以这里不能断言「总变化数 === 1」，只能断言「我改的那条被算成未解释」。
  ok("★★★ 正向对照：只改一条也要被抓到（证明这条闸门不是空的）",
    rm.unexplained.length === 1 && rm.unexplained[0].key === input.skills[0].key,
    JSON.stringify(rm.unexplained.map(c => c.key)));
  ok("★ 已解释的变化不会因为我做对照就变成失败", rm.explained.every(c => c.key !== input.skills[0].key));
}

sec("[4] ★★ 这条闸门本来能拦住第 46 轮那次改动");
{
  // §38 的实验：把 buff 解析改成"分句-多匹配"，338 条里 146 条变了。
  // 用当时的差异形态造一个 fixture：基线里某条 buff 的效果是 atk:-1，新解析给出 atk:+1（符号翻转）。
  const base = { skills: {}, buffs: { "2343_1": JSON.stringify({ effects: [{ prop: "atk", value: -1 }] }) } };
  const cur = { skills: [], buffs: [{ key: "2343_1", json: JSON.stringify({ effects: [{ prop: "atk", value: 1 }] }) }] };
  const r = diffCensus(base, cur, {});
  ok("★★★ 符号翻转会被抓到（蝎毒 atk:-1 → +1 那种）", r.unexplained.length === 1, JSON.stringify(r.changed));
  ok("★★ 而且差异描述里能直接看到 -1 与 1", /-1/.test(firstDifference(r.changed[0].was, r.changed[0].now)));
  console.log("    当时的实测：变化 146 条（我只能解释其中 1 条）→ 这道闸门会以 145 条未解释失败。");
}

sec("[5] ★★★ 比「编译结果」，不比「随产物带出去的说明文字」（第 56 轮）");
{
  // 由来：给 compile/unmodeled.ts 的「复活」条补了一句 missing（纯文档），
  // 11 条技能的产物当场"变了"，而解析结果一个字节没动。
  // 下面四条把这个边界钉死：verb / clause 变了要红，missing / evidence 变了要绿。
  const mk = (mech: any) => JSON.stringify({ damage: [{ ratio: 100 }], unmodeledMechanics: [mech] });
  const base = mk({ verb: "复活", missing: "旧说明", evidence: "旧依据", clause: "受到致命伤害时复活" });

  ok("★★★ 只改 missing（说明文字）→ 不算变化", comparable(base) === comparable(mk({ verb: "复活", missing: "新说明", evidence: "旧依据", clause: "受到致命伤害时复活" })));
  ok("★★★ 只改 evidence（验证依据）→ 不算变化", comparable(base) === comparable(mk({ verb: "复活", missing: "旧说明", evidence: "新依据", clause: "受到致命伤害时复活" })));
  ok("★★★ 改 verb（机制身份）→ **算**变化（这条是「有没有缺口」，是行为）", comparable(base) !== comparable(mk({ verb: "变形", missing: "旧说明", evidence: "旧依据", clause: "受到致命伤害时复活" })));
  ok("★★★ 改 clause（归因到哪句话）→ **算**变化（这条是「判给谁」，也是行为）", comparable(base) !== comparable(mk({ verb: "复活", missing: "旧说明", evidence: "旧依据", clause: "另一句话" })));
  // 防放水：解析不出 JSON 的输入必须退回原样比较（g34 自己的合成 fixture 走的正是这条退路）
  ok("★★ 不是 JSON 的输入按原样比（不许因为解析失败就判「没变化」）", comparable("A") !== comparable("A2") && comparable("A") === comparable("A"));
  // 键序不是行为：同一对象换一个键序，不该报变化
  ok("★ 同一对象换个键序 → 不算变化", comparable('{"a":1,"b":2}') === comparable('{"b":2,"a":1}'));
  // 与真实产物连起来：今天的 11 条文档变化必须已经消失，但真正的解析变化仍会被抓
  const kb = path.join(root, "data", "kb");
  const { input } = compileAll(kb);
  const baseFile = JSON.parse(fs.readFileSync(path.join(root, "battle-lab", "fixtures", "compile-baseline.json"), "utf8"));
  const docOnly = { skills: input.skills.map(e => ({ ...e, json: e.json.replace(/"missing":"[^"]*"/, '"missing":"换一句说明"') })), buffs: input.buffs };
  // ★ 说明表必须一起传：基线里带着一条**已解释**的历史变化（墨灵，见报告 §40.5）。
  //   第一次写这条断言时传了 {}，于是它把那条历史变化算成未解释、报出 buffs 侧的 3991_1 ——
  //   断言写错了，不是代码错了。真实闸门从来都是带着说明表跑的，这里必须同口径。
  const explainPath2 = path.join(root, "battle-lab", "tools", "compile-explain.json");
  const explain2 = fs.existsSync(explainPath2) ? JSON.parse(fs.readFileSync(explainPath2, "utf8")) : {};
  const rd = diffCensus(baseFile, docOnly, explain2);
  ok("★★★ 把**全部**技能的 missing 都改掉 → 一条变化都不报（说明文字不是编译结果）",
    rd.unexplained.length === 0, JSON.stringify(rd.unexplained.slice(0, 2).map(c => c.key)));
  const verbOnly = { skills: input.skills.map(e => ({ ...e, json: e.json.replace(/"verb":"([^"]*)"/, '"verb":"$1X"') })), buffs: input.buffs };
  /**
   * ★★★ 第 253 轮**按事实改写**：这一条原来拿「真实基线 vs 改过 verb 的当前产物」比，指望"有些技能的 verb
   *   从基线到现在没变过 ⇒ 改名后必然成为**未解释**的变化"。
   *   随着轮次推进，带 verb 的技能几乎都已经与基线不同（各自也都有台帐）⇒ 那条路自然收敛到 **0**：
   *   它测的其实是"基线有多旧"，不是"闸门还灵不灵"。本轮实测就是这个数（0）。
   *   改成**自建合成基线**（基线 = 当前产物本身，另一侧只改 verb，说明表给空）——
   *   任何一条漏报都会当场变红，而且与真实基线的新旧无关。
   */
  /** 合成基线要写成 `CensusBaseline` 的形状（键 → JSON 字符串），不是条目数组（第一版写成数组 ⇒ 一条变化都测不出来） */
  const synthBase = {
    skills: Object.fromEntries(input.skills.map(e => [e.key, e.json])),
    buffs: Object.fromEntries(input.buffs.map(e => [e.key, e.json])),
  };
  const rv = diffCensus(synthBase, verbOnly, {});
  ok("★★★ 把**全部**技能的 verb 都改掉（对着**自建基线**）→ 变化必须被抓到且未解释（证明闸门没被关掉）",
    rv.changed.length > 0 && rv.unexplained.length === rv.changed.length,
    JSON.stringify({ changed: rv.changed.length, unexplained: rv.unexplained.length }));
}

console.log("\n=== 编译产物普查自检: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
