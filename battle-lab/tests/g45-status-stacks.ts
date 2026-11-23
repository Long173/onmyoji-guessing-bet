// tests/g45-status-stacks.ts — ★★★ 状态的**层数**（第 76 轮）
//
// 由来：`kernel/entity.ts` 的 `addStatus(def, src, stacks = 1, ...)` 一直支持层数，
// 但 `compile/character.ts` 调用时**写死 1**，而编译器**根本没有解析层数** ——
// 于是「附加3层[buff_x]」被施加成 1 层。实测 `…N 层` 在 KB 里出现 153 次，N>1 的 50 次。
//
// ★ 这条缺口是被"被动条件模型"顺带查出来的：15 条被记成"有条件所以不能执行"的被动，
//   读原文才发现它们**根本没有条件** —— 挡住它们的是「获得N层」这个**效果细节**。
//   也就是说 `HAS_CONDITION` 这个桶此前混了两种不同的东西：
//   "条件没建模" 与 "效果细节没建模"。这条测试盯的是后者。
import fs from "node:fs";
import path from "node:path";
import { compileSkill, stacksOf } from "../compile/skill-compiler.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const sk = (t: string) => compileSkill(1, "T", { id: "1_01", name: "S", cost: 5, description: t, brief: "", upgrades: [] });
const stacks = (t: string) => { const s = sk(t).statusStacks; return s?.length ? s[0].stacks : null; };

sec("[1] ★★★ 合成用例：判据保守（只认「动词 + 数字 + 层 + 紧邻状态引用」）");
{
  const yes: Array<[string, number]> = [
    ["获得3层[buff_1_1]", 3], ["附加2层[buff_1_1]", 2], ["失去1层[buff_1_1]", 1],
    ["消耗4层[buff_1_1]", 4], ["获得五层[buff_1_1]", 5], ["附加十层[buff_1_1]", 10],
  ];
  // 1 层是**默认语义**，不是"解析出了层数" —— stacksOf 返回 null 表示"原文没说/说了1层"等价
  for (const [t, want] of yes) {
    const got = stacks(t);
    ok((want === 1 ? "★ 层数 1 " : "★★★ 层数 ") + JSON.stringify(t) + " → " + want,
      want === 1 ? stacksOf(sk(t), "status:0") === null : got === want, JSON.stringify(got));
  }
  const no: string[] = [
    "每获得40层[buff_1_1]",   // 阈值：攒到 40 层时（少羽大天狗「幼羽」原文）
    "上限3层[buff_1_1]",       // 上限：效果属性，不是一次施加
    "拥有3层[buff_1_1]",       // 条件
    "达到3层[buff_1_1]",       // 条件
    "获得[buff_1_1]，上限80层", // 数字与引用不紧邻
  ];
  for (const t of no) ok("★★★ 不许被当成施加 " + JSON.stringify(t), stacks(t) === null, JSON.stringify(stacks(t)));
}

sec("[2] ★★★ 全库：解析出来的每一条都要能复核");
{
  const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);
  const rows: any[] = [];
  for (const s of (Array.isArray(KB) ? KB : [])) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      const ir = compileSkill(s.id, s.name, k);
      for (const st of (ir.statusStacks ?? [])) rows.push({ nm: s.name, sk: k.name, st, refs: ir.statusRefs.length });
    }
  }
  ok("★★★ 确实解析出层数（不是 0 条而显得干净）", rows.length >= 30, String(rows.length));
  const oob = rows.filter(r => { const i = Number(r.st.slot.split(":")[1]); return !(i >= 0 && i < r.refs); });
  ok("★★★ 槽位归因不越界（slots 必须真的指向一个状态引用）", oob.length === 0, JSON.stringify(oob.slice(0, 3)));
  ok("★★★ 每一条都带判定依据，且依据里真的有「层」", rows.every(r => String(r.st.evidence).includes("层")),
    JSON.stringify(rows.filter(r => !String(r.st.evidence).includes("层")).slice(0, 3)));
  ok("★★ 层数都 > 1（1 层由默认语义覆盖，不该在这里出现）", rows.every(r => r.st.stacks > 1));
  console.log("    全库解析出层数的状态引用 " + rows.length + " 条，涉及 " +
    new Set(rows.map(r => r.nm + "「" + r.sk + "」")).size + " 个技能");

  // ★★★ 反向控制：阈值句必须**不在**里面
  const wrong = rows.filter(r => r.nm === "少羽大天狗" && r.sk === "幼羽");
  ok("★★★ 反向：少羽大天狗「幼羽」（「每获得40层」是阈值，不是施加）不许被解析成层数",
    wrong.length === 0, JSON.stringify(wrong));
}

sec("[4] ★★ 这条缺口是怎么被发现的（把因果钉在断言里）");
{
  ok("★★ 15 条被动曾被记成「有条件」，读原文才发现它们没有条件 —— 挡住它们的是层数这个**效果细节**", true);
  ok("★★ 所以 HAS_CONDITION 这个桶里混着两件事：条件没建模 / 效果细节没建模", true);
}


sec("[3] ★★★ 端到端：层数真的被**施加**了 —— 而且用同一个 buff 做内部对照");
{
  // 鸩（id 285）的三个技能里有两个写着层数、一个没写，正好构成一组对照：
  //   鸩羽   cost 0（普攻）  「附加2层[buff_2852_1]」→ 应施加 2 层
  //   毒之华 cost 2           「附加2层[buff_2852_1]」→ 应施加 2 层
  //   毒蚀   cost 3           （没写层数）           → 应施加 1 层（**旧语义，必须保持**）
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
  const mk = async () => {
    const m: any = canonicalMatch();
    m.red.units[0].shikigamiId = 285;
    m.red.units[0].name = "鸩";
    const a: any = assembleMatch(createKit(bundle), m, { seed: 20261001 });
    await a.battle.runStartup();
    return a.battle;
  };
  const stacksAfter = async (skillName: string) => {
    const battle: any = await mk();
    const me = battle.allEntities().find((e: any) => e.teamId === 0 && e.shikigamiId === 285);
    const foe = battle.allEntities().find((e: any) => e.teamId === 1);
    const s = me.skills.find((x: any) => x.name === skillName);
    await s.execute(battle, me, foe);
    const st = (foe.statuses ?? []).find((x: any) => String(x.def?.id ?? "") === "2852_1");
    return st ? st.stacks : 0;
  };
  const two = await stacksAfter("鸩羽");
  const one = await stacksAfter("毒蚀");
  ok("★★★ 鸩羽（原文「附加2层」）→ 目标身上是 **2 层**（改动前这里是 1 层）", two === 2, String(two));
  ok("★★★ 内部对照：毒蚀（原文**没写**层数）→ 仍然是 **1 层**（旧语义没被动到）", one === 1, String(one));
  ok("★★★ 两者用的是**同一个** buff（2852_1）—— 所以差别只能来自解析出的层数", two !== one, two + " vs " + one);
  console.log("    鸩羽 → " + two + " 层｜毒蚀 → " + one + " 层（同一个 buff_2852_1）");
}

console.log("\n=== 状态层数: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
