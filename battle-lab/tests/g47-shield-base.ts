// tests/g47-shield-base.ts — ★★★ 护盾的**基准**（第 80 轮）
//
// 由来：SkillIR.shield 的 `base` 字段一直存在，但**两边都没兑现** ——
//   · 解析侧把 base **写死成 maxHp**：正则里那个 `(?:生命上限|攻击)?` 组的位置在百分号**之后**，
//     而中文写法几乎都是「吸收**攻击**N%伤害」——「攻击」两个字落在百分号**前面**的间隔里，
//     那个捕获组一辈子抓不到它；
//   · 执行侧更彻底：`character.ts` 直接 `self.maxHp * ratio`，**根本没读 base**。
//
// 实测 24 条护盾条目 base **全是 maxHp**，而按原文分类应为：
//   攻击 **7** 条、生命上限 5 条、已损失生命 **2** 条（另有 1 条是误匹配）。
// 于是一个「吸收攻击150%伤害」的护盾，实际按施法者的**生命上限**算 —— 量级完全不对。
import fs from "node:fs";
import path from "node:path";
import { compileSkill, shieldBaseOf } from "../compile/skill-compiler.ts";
import { SHIELD_MARKER_RE, EFFECT_DETAIL_MARKERS } from "../kernel/triggers.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const sk = (t: string) => compileSkill(1, "T", { id: "1_01", name: "S", cost: 5, description: t, brief: "", upgrades: [] });
const shieldOf = (t: string) => sk(t).shield ?? [];
const kb = () => JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);

sec("[1] ★★★ 合成用例：基准从百分号**两侧**都能认出来");
{
  const one = (t: string) => { const a = shieldOf(t); return a.length ? a[0].base : null; };
  const cases: Array<[string, string]> = [
    ["吸收攻击150%伤害", "atk"],
    ["吸收等同自身攻击60%的伤害", "atk"],
    ["吸收6%生命上限的伤害", "maxHp"],
    ["吸收20%已损失生命的伤害", "lostHp"],
    ["吸收30%的伤害", "maxHp"],
  ];
  for (const [text, want] of cases) {
    ok("★★★ 「" + text + "」→ " + want, one(text) === want, String(one(text)));
  }
  const falsePos = "吸收时，额外对目标造成其最大生命10%的固定伤害";
  ok("★★★ 反向：讲的是「造成伤害」而不是套盾 —— 不许被当成护盾",
    shieldOf(falsePos).length === 0 && (sk(falsePos).shieldSkips ?? []).length === 1,
    JSON.stringify({ shield: shieldOf(falsePos), skips: sk(falsePos).shieldSkips }));
  ok("★★ 每一条护盾都带判定依据（判错时要能一眼看出照哪句话判的）",
    shieldOf("吸收攻击150%伤害").every((x: any) => String(x.evidence).includes("吸收")));
  ok("★★ shieldBaseOf 的判据本身可单测（顺序：已损失生命 > 攻击 > 生命上限）",
    shieldBaseOf("已损失生命")?.base === "lostHp" && shieldBaseOf("攻击")?.base === "atk" && shieldBaseOf("生命上限")?.base === "maxHp");
}

sec("[2] ★★★ 全库：三种基准都真的出现了（不是只改了代码没改数据）");
{
  const dist = new Map<string, number>();
  let skips = 0, total = 0, noEvidence = 0;
  for (const s of (Array.isArray(kb()) ? kb() : [])) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      const ir = compileSkill(s.id, s.name, k);
      for (const x of (ir.shield ?? [])) { dist.set(x.base, (dist.get(x.base) ?? 0) + 1); total++; if (!x.evidence) noEvidence++; }
      skips += (ir.shieldSkips ?? []).length;
    }
  }
  ok("★★★ 护盾条目总数 ≥ 20", total >= 20, String(total));
  ok("★★★ 三种基准都出现过（否则说明解析器只认一种）",
    (dist.get("atk") ?? 0) > 0 && (dist.get("maxHp") ?? 0) > 0 && (dist.get("lostHp") ?? 0) > 0, JSON.stringify([...dist.entries()]));
  ok("★★★ 按攻击算的护盾 ≥ 5（改动前是 0 条）", (dist.get("atk") ?? 0) >= 5, String(dist.get("atk") ?? 0));
  ok("★★ 每条护盾都带依据", noEvidence === 0, String(noEvidence));
  ok("★★ 误匹配被记下来（不是静默丢弃）", skips >= 1, String(skips));
  console.log("    护盾基准分布：" + [...dist.entries()].map(([k, v]) => k + " " + v).join("｜") + "｜误匹配 " + skips);
}

sec("[3] ★★★ 端到端：盾值按**攻击**算，而不是按生命上限");
{
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
  const mm: any = canonicalMatch();
  mm.red.units[0].shikigamiId = 559;
  mm.red.units[0].name = "本真三尾狐";
  const a: any = assembleMatch(createKit(bundle), mm, { seed: 20261001 });
  await a.battle.runStartup();
  const me = a.battle.allEntities().find((e: any) => e.teamId === 0 && e.shikigamiId === 559);
  const skill = me.skills.find((x: any) => x.name === "灵合");
  const atk = me.prop("atk"), maxHp = me.maxHp;
  me.shields.length = 0;
  await skill.execute(a.battle, me, me);
  const value = (me.shields ?? []).reduce((acc: number, s: any) => acc + s.value, 0);
  const wantAtk = atk * 0.9, wantHp = maxHp * 0.9;
  const near = (x: number, y: number) => Math.abs(x - y) <= Math.max(1, y * 0.02);
  ok("★★★ 盾值 ≈ 攻击 × 90%（容忍四舍五入）", near(value, wantAtk), "盾=" + value.toFixed(1) + " 期望≈" + wantAtk.toFixed(1));
  ok("★★★ 而且**明显不等于**生命上限 × 90%（改动前就是这个值）", !near(value, wantHp), "生命上限×90%=" + wantHp.toFixed(1));
  const tr = a.battle.trace.filter((t: any) => t.t === "SHIELD_APPLY").slice(-1)[0];
  ok("★★ trace 里带上了 base 与 ratio（Theater/Inspector 能看见依据）", tr && tr.base === "atk" && tr.ratio === 90, JSON.stringify(tr));
  console.log("    本真三尾狐 atk=" + atk + " maxHp=" + maxHp + " → 盾 " + value.toFixed(1) + "（若按生命上限会是 " + wantHp.toFixed(1) + "）");
}

sec("[4] ★★★ 自我守护：抵挡/吸收 能离开缺口表，靠的是 IR 事实而不是文本猜测");
{
  let sawShield = 0, sawNonShield = 0;
  for (const s of (Array.isArray(kb()) ? kb() : [])) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      if (!SHIELD_MARKER_RE.test(String(k.description ?? ""))) continue;
      const ir = compileSkill(s.id, s.name, k);
      if (ir.shield?.length) sawShield++; else sawNonShield++;
    }
  }
  ok("★★★ 两个方向都有样本（既有护盾被解析的，也有提到吸收但不是护盾的）",
    sawShield > 0 && sawNonShield > 0, JSON.stringify({ sawShield, sawNonShield }));
  ok("★★★ 抵挡/吸收 确实已经不在**纯文本**缺口表里了（判定权交给了 IR）",
    !EFFECT_DETAIL_MARKERS.test("抵挡等同生命上限3%的伤害") && !EFFECT_DETAIL_MARKERS.test("吸收攻击150%伤害"));
  //   ★★★ 第 85 轮：这条断言**换了方向** —— 它原本守的是"盾量上限仍然挡着"，
  //   因为那时「最多抵挡该次伤害的40%」确实没被执行。第 85 轮把它做了
  //   （SkillIR.shield[].perHitRatio → Shield.perHitRatio → mutateHp 单次封顶），
  //   于是"还挡着"反而变成错误：标记表必须跟着实现走。
  //   ★ 守卫没有消失，而是**一分为二**：
  //     · 「最多抵挡该次伤害的N%」→ 不再挡（见下），它的可检查前提搬到 g51 第 [4] 节；
  //     · 「最多不超过已损失生命的N%」（杀生丸）→ 仍然挡着，那是**另一种形状**，确实没建模。
  ok("★★★ 「最多抵挡该次伤害的N%」已经不算缺口（第 85 轮把它执行掉了）",
    !EFFECT_DETAIL_MARKERS.test("抵挡等同生命上限3%的伤害，最多抵挡该次伤害的40%"));
  ok("★★★ 但「最多不超过已损失生命的N%」仍然挡着（相对已损失生命，另一种形状，没建模）",
    EFFECT_DETAIL_MARKERS.test("抵挡其中的30%，最多不超过已损失生命的40%"));
  console.log("    提到抵挡/吸收的技能：有护盾 " + sawShield + " 个｜没有护盾 " + sawNonShield + " 个（后者仍算效果缺口）");
}

console.log("\n=== 护盾基准: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
