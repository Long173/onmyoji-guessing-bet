// tests/g46-status-caps.ts — ★★★ 状态的**层数上限**（第 78 轮）
//
// 由来：`kernel/entity.ts` 的 `addStatus` 只做 `ex.stacks += stacks` ——
// **全库没有一处读层数上限**（`maxStacks` 只在御魂系统里出现，与此无关）。
// 于是「上限4层」的状态会被无限叠上去，而按层缩放的效果（「每层提升5%攻击」）跟着一起失真。
//
// ★ 上限**只写在技能原文里**：实测 338 条 buff 定义中写明层数上限的有 **0 条**，技能文案里有 28 处。
//   所以它只能落在技能 IR 上（`statusCaps`），与 statusStacks / statusDurations 同型。
//
// ★★ 这一轮顺带查出**我自己的检查表有假阳性**：第 77 轮写的 `EFFECT_DETAIL_MARKERS` 里，
//   裸 `上限` 会匹配到 **`生命上限`**（那是属性名），裸 `召唤` 会匹配到 **`非召唤物`**（那是目标筛选）。
//   代价与前几轮同类：**把"能做"的记成"做不了"**。两条都在这条测试里做了反向断言。
import fs from "node:fs";
import path from "node:path";
import { compileSkill, capOf } from "../compile/skill-compiler.ts";
import { EFFECT_DETAIL_MARKERS, CAP_MARKER_RE } from "../kernel/triggers.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const sk = (t: string) => compileSkill(1, "T", { id: "1_01", name: "S", cost: 5, description: t, brief: "", upgrades: [] });
const cap = (t: string) => { const c = sk(t).statusCaps; return c?.length ? c[0].max : null; };

sec("[1] ★★★ 合成用例：三种上限写法认得，其它「上限」不许误认");
{
  ok("★★★ 「上限4层」→ 4", cap("获得1层[buff_1_1]，上限4层") === 4);
  ok("★★★ 「最多可叠加3层」→ 3", cap("获得1层[buff_1_1]，最多可叠加3层") === 3);
  ok("★★★ 「最多10层」→ 10", cap("获得1层[buff_1_1]，最多10层") === 10);
  ok("★★ 中文数字「上限五层」→ 5", cap("获得1层[buff_1_1]，上限五层") === 5);
  ok("★★★ 没写上限 → null（不封顶，保持旧语义）", cap("获得1层[buff_1_1]") === null);
  // ★★★ 反向：一句里出现**不同**状态引用却只给一个上限 → 不许猜
  ok("★★★ 反向：一句里两个**不同**状态引用 + 一个上限 → 不归因（记进 statusCapSkips）",
    cap("获得1层[buff_1_1]，获得1层[buff_1_2]，上限4层") === null &&
    (sk("获得1层[buff_1_1]，获得1层[buff_1_2]，上限4层").statusCapSkips ?? []).length === 1);
  ok("★★ 同一状态引用出现两次 + 一个上限 → **可以**归因（同 id 不存在歧义）",
    cap("获得[buff_1_1]，上限80层；每获得40层[buff_1_1]") === 80);
}

sec("[2] ★★★ 反向：我自己的检查表曾经把这两件事误判成缺口");
{
  ok("★★★ 「生命上限6%」不是层数上限 —— 裸「上限」不得命中（第 77 轮的假阳性）",
    cap("回合结束时，有20%概率醉倒，直至下回合醒来并恢复生命上限6%的生命") === null);
  ok("★★★ 而且「生命上限」也**不再**被当成效果缺口（EFFECT_DETAIL_MARKERS）",
    !EFFECT_DETAIL_MARKERS.test("恢复生命上限6%的生命") && !EFFECT_DETAIL_MARKERS.test("造成其生命上限10%伤害"),
    "狸猫「醉倒」/傀儡师「傀儡·追击」正是被这一条误挡的");
  ok("★★★ 「非召唤物」不是召唤动作 —— 否定环视必须生效",
    !EFFECT_DETAIL_MARKERS.test("为生命比例最低的非召唤物友方治疗") && EFFECT_DETAIL_MARKERS.test("召唤1个白色小鬼"),
    "海坊主「祝福之水」/灵海蝶「灵巡」/言灵「语罪」正是被这一条误挡的");
  //   ★★★ 第 79 轮：这条断言**换了方向** —— 上一轮它守的是"上限仍算缺口"，
  //   因为那时上限还没被执行。第 78 轮把它执行掉了，于是"还挡着"反而变成了错误：
  //   标记表必须跟着实现走，实现了却还挡着就是把"能做"的记成"做不了"。
  //   ★ 守卫没有消失，而是搬到了第 [5] 节：**"上限能离开缺口表"有一个可机械检查的前提**
  //     （凡写了上限的地方，上限都被解析出来或如实记成不猜）。前提一破，第 [5] 节就红。
  ok("★★★ 真正的层数上限**已经不算**效果缺口（第 78 轮把它执行掉了，标记表必须跟着实现走）",
    !EFFECT_DETAIL_MARKERS.test("获得[buff_1_1]，上限80层") && !EFFECT_DETAIL_MARKERS.test("最多可叠加3层"));
}

sec("[3] ★★★ 全库：解析出来的每一条都要能复核");
{
  const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);
  const rows: any[] = [];
  let skips = 0;
  for (const s of (Array.isArray(KB) ? KB : [])) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      const ir = compileSkill(s.id, s.name, k);
      for (const c of (ir.statusCaps ?? [])) rows.push({ nm: s.name, sk: k.name, c, refs: ir.statusRefs.length });
      skips += (ir.statusCapSkips ?? []).length;
    }
  }
  ok("★★★ 确实解析出上限（不是 0 条而显得干净）", rows.length >= 20, String(rows.length));
  const oob = rows.filter(r => { const i = Number(r.c.slot.split(":")[1]); return !(i >= 0 && i < r.refs); });
  ok("★★★ 槽位归因不越界", oob.length === 0, JSON.stringify(oob.slice(0, 3)));
  ok("★★★ 每一条都带上限数值与判定依据", rows.every(r => r.c.max > 0 && String(r.c.evidence).length > 0));
  ok("★★ 「不猜」的记录也被保留下来（不是静默丢弃）", skips >= 1, String(skips));
  console.log("    全库解析出上限 " + rows.length + " 条（" + new Set(rows.map(r => r.nm + "「" + r.sk + "」")).size +
    " 个技能）｜歧义未归因 " + skips + " 条");
}

sec("[4] ★★★ 端到端：上限真的**被执行**了（同一个技能连续施加，层数封顶）");
{
  // 河童「清流」：「行动结束时，获得1层[buff_2092_1]，上限4层」—— 施加 6 次，必须停在 4。
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
  const m: any = canonicalMatch();
  m.red.units[0].shikigamiId = 209;
  m.red.units[0].name = "河童";
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261001 });
  await a.battle.runStartup();
  const me = a.battle.allEntities().find((e: any) => e.teamId === 0 && e.shikigamiId === 209);
  const skill = me.skills.find((x: any) => x.name === "清流");
  ok("★★ 清流的 IR 里带上了上限 4", capOf(skill.ir, "status:0") === 4, JSON.stringify(skill.ir?.statusCaps));
  for (let i = 0; i < 6; i++) await skill.execute(a.battle, me, me);
  const st = (me.statuses ?? []).find((x: any) => /^2092_/.test(String(x.def?.id ?? "")));
  ok("★★★ 连续施加 6 次后，层数**停在 4**（上限被执行 —— 改动前会一路叠到 6）",
    st && st.stacks === 4, JSON.stringify({ stacks: st?.stacks, cap: st?.cap }));
  ok("★★★ 上限也记进了状态本身（快照/指纹里看得见这个事实）", st?.cap === 4, JSON.stringify(st?.cap));
  console.log("    河童「清流」施加 6 次 → " + st?.stacks + " 层（上限 " + st?.cap + "）");
}


sec("[5] ★★★ 自我守护：「上限」能离开缺口表，靠的是这个前提一直成立");
{
  // 第 79 轮把「上限N层」从 EFFECT_DETAIL_MARKERS 里**移出**了 —— 因为上限真的被执行了。
  // 但"移出"只有在下面这个前提成立时才是对的：
  //   凡原文写了「上限N层」的技能，上限都必须**真的被解析出来**（statusCaps）
  //   或者被如实记成"不猜"（statusCapSkips）。
  // 两者都没有 = 上限没被执行 = 这张表必须把它收回去。
  //
  // ★ 这条断言的作用就是：**让"移出标记"这个决定不再依赖我的记忆**。
  //   如果哪天有新的上限写法（或解析器退化）导致漏解析，这里会立刻变红，
  //   而不是安静地把一条"其实没封顶"的被动放进候选。
  const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);
  let marked = 0, parsed = 0, skipped = 0;
  const violations: string[] = [];
  for (const s of (Array.isArray(KB) ? KB : [])) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      const raw = String(k.description ?? "");
      if (!CAP_MARKER_RE.test(raw)) continue;
      marked++;
      const ir = compileSkill(s.id, s.name, k);
      if (ir.statusCaps?.length) parsed++;
      else if (ir.statusCapSkips?.length) skipped++;
      else violations.push(s.name + "「" + k.name + "」");
    }
  }
  ok("★★★ 样本非空（不许因为一条都没扫到而平凡通过）", marked >= 20, String(marked));
  ok("★★★ 写了「上限N层」的技能，上限**要么被解析、要么被如实记成不猜** —— 一个都不许漏",
    violations.length === 0,
    "漏解析 " + violations.length + " 条：" + JSON.stringify(violations.slice(0, 5)) +
    "（若 >0：必须把 上限 收回到 EFFECT_DETAIL_MARKERS，否则会放行没封顶的被动）");
  ok("★★ 两个出口都真的用到了（解析 " + parsed + "｜不猜 " + skipped + "）", parsed > 0 && skipped > 0,
    JSON.stringify({ marked, parsed, skipped }));
  console.log("    写了上限的技能 " + marked + " 个：" + parsed + " 个解析成功，" + skipped + " 个如实记成不猜");
  ok("★★★ 「上限」确实已经不在缺口表里了（否则这一节的前提说明就是空话）",
    !EFFECT_DETAIL_MARKERS.test("获得1层[buff_1_1]，上限4层") && !EFFECT_DETAIL_MARKERS.test("最多可叠加3层"));
  console.log("    ★ 若第 2 条变红：把 /上限\\s*\\d+\\s*层|最多(?:可)?叠加\\s*\\d+\\s*层/ 加回 EFFECT_DETAIL_MARKERS。");
}

console.log("\n=== 状态层数上限: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
