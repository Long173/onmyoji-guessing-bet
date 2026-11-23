// tests/g32-damage-direction.ts — ★★ 伤害加成的**方向**：源侧与受击侧必须分开
//
// 由来：第 42 轮修完御魂注册重复后回头看 effect-system，发现无刀取（"永久提升15%的伤害"）
// 写的是 dmgTakenB —— 而伤害管线里 dmgTakenB 是从**受击方**读的，并且是**乘上去**的。
// 也就是说它实际的效果是「携带者多挨最多 45% 伤害」，方向完全相反。
//
// 实测（这个测试的前身探针，dummy 对 dummy）：
//   基线                        final=991.2
//   dmgTakenB=0.5 给**攻击方**   final=991.2   ← 逐位不变：攻击方的字段从来没被读过
//   dmgTakenB=0.5 给**受击方**   final=1486.9  ← ×1.5
//
// 修法是**加一项**：新增源侧字段 dmgDealtB，默认 0 —— 没有东西写它时行为与修复前逐位相同，
// 所以基准不动。受击侧两个字段这次不动（它们的语义在仓库里有三种矛盾说法，见报告 §35）。
import fs from "node:fs";
import path from "node:path";
import { makeDummy, wireDummy } from "../dummy/dummy.ts";
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { DamageType } from "../kernel/types.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const R = ResourcePolicies.COMMUNITY_4_8_5_345;
const POL = { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
  death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER" as const,
  tieBreak: "SPEED_THEN_RANDOM" as const, guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED };
const cfg = (name: string) => ({ name, hp: 1000000, atk: 1000, def: 0, spd: 100, cri: 0, crid: 1.5 } as any);

/** 造一对 dummy 打一次，返回最终伤害（cri=0，浮动 ±1%，所以比较用"是否成倍"而不是逐位） */
async function hit(tweak: (a: any, b: any) => void, prop = "dmgDealtB", value = 0.5) {
  const A = makeDummy(cfg("A"), 101, 0), B = makeDummy(cfg("B"), 201, 1);
  const t0 = new Team(0, "RED", R, 1), t1 = new Team(1, "BLUE", R, 1);
  const bt = new Battle([t0, t1], { seed: 7, rules: { ...DEFAULT_RULES, maxTurns: 5 }, policies: POL as any });
  t0.add(A); t1.add(B); wireDummy(bt, A); wireDummy(bt, B);
  await bt.runStartup();
  tweak(A, B);
  const res: any = await bt.damage(A, B, 1000, DamageType.NORMAL);
  // breakdown 挂在**事件流**上（damage.ts 把它写进 DAMAGE 那条 trace），不是返回值上
  const dmgs = (bt.trace as any[]).filter((e: any) => e.t === "DAMAGE");
  const bd: any = dmgs.length ? dmgs[dmgs.length - 1].breakdown : {};
  return { final: res.final as number, mods: (bd.modifiers ?? {}) as any };
  return { final: res.final as number, mods: (bd.modifiers ?? {}) as any };
}

sec("[1] ★★ 源侧加成与受击侧加成是两个不同的输入");
{
  const base = await hit(() => {});
  const onSource = await hit((a) => a.addModifier({ prop: "dmgDealtB", value: 0.5, mode: "FIXED", source: "probe" }));
  const takenOnSource = await hit((a) => a.addModifier({ prop: "dmgTakenB", value: 0.5, mode: "FIXED", source: "probe" }));
  const takenOnTarget = await hit((_a, b) => b.addModifier({ prop: "dmgTakenD", value: 0.5, mode: "FIXED", source: "probe" }));
  console.log("    基线 " + base.final.toFixed(1) + "｜源侧 dmgDealtB " + onSource.final.toFixed(1)
    + "｜源侧 dmgTakenB " + takenOnSource.final.toFixed(1) + "｜受击侧 dmgTakenD " + takenOnTarget.final.toFixed(1));
  ok("★★ 源侧 dmgDealtB 生效：攻击方打得更疼（×1.5）",
    Math.abs(onSource.final / base.final - 1.5) < 0.03, (onSource.final / base.final).toFixed(3));
  ok("★★ 而且它**不改**受击侧的账：takenDebuff 仍是 1", onSource.mods.dmgTakenD === 1 && onSource.mods.dmgDealtB === 1.5, JSON.stringify(onSource.mods));
  ok("★★ 受击侧 dmgTakenD 也生效（易伤方向）", Math.abs(takenOnTarget.final / base.final - 1.5) < 0.03, (takenOnTarget.final / base.final).toFixed(3));
  ok("★★ 记录事实：把 dmgTakenB 加在**攻击方**身上对伤害**没有任何影响**（它读的是受击方）",
    Math.abs(takenOnSource.final - base.final) < 1e-9, takenOnSource.final + " vs " + base.final);
  ok("★ 三个字段都进了分解（可审计）", ["dmgDealtB", "dmgTakenB", "dmgTakenD"].every(k => k in base.mods), JSON.stringify(Object.keys(base.mods)));
}

sec("[2] ★★ 无刀取：写的是源侧字段，效果是「打得更疼」而不是「挨得更疼」");
{
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
  const soulIdx = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "kb", "soul-index.json"), "utf8"));
  const wd = soulIdx.find((s: any) => s.n === "无刀取")!;
  ok("★ 前置：无刀取的文案确实是「永久提升…伤害…最高不超过…%」", /永久提升/.test(wd.desc) && /伤害/.test(wd.desc), wd.desc);
  const m: any = JSON.parse(JSON.stringify(canonicalMatch()));
  for (const side of ["red", "blue"]) for (const u of m[side].units) u.soulId = wd.i;
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261001, traceLevel: "NONE" });
  await a.battle.runStartup();
  await a.battle.runPartial(40);
  const alive = a.battle.allEntities().filter((e: any) => e.alive);
  const dealt = alive.map((e: any) => e.prop("dmgDealtB"));
  const taken = alive.map((e: any) => e.prop("dmgTakenB"));
  console.log("    存活 " + alive.length + " 只｜dmgDealtB " + JSON.stringify(dealt.map((x: number) => +x.toFixed(3))) + "｜dmgTakenB " + JSON.stringify(taken));
  ok("★★ 无刀取写在**源侧**字段上（至少有人叠到了）", dealt.some((x: number) => x > 0), JSON.stringify(dealt));
  ok("★★ 它**不再**污染受击侧字段（修复前全都会 > 0）", taken.every((x: number) => x === 0), JSON.stringify(taken));
  ok("★★ 叠层封顶 45%（15% × 3 层），不是无限增长", dealt.every((x: number) => x <= 0.45 + 1e-9), JSON.stringify(dealt));
}

sec("[3] ★★ 已知矛盾：把这条钉住，不许静默改动");
{
  // 仓库里对 dmgTakenB 有三种互相矛盾的说法：
  //   ① capability/registry.ts   —— 减伤(DMG_DOWN) 的 producer 是 dmgTakenB
  //   ② compile/buff-compiler.ts —— 「造成伤害|增伤」映射到 dmgTakenB
  //   ③ kernel/damage.ts         —— 从**受击方**读它并乘上去（越大挨得越疼）
  // 三者不可能同时成立。第 43 轮只钉住现状；第 44 轮已改掉前两条（见 g33 的登记册）。
  // 当时担心「要重测基准」，实测不成立：这 9 条 buff 在典型对局的 155 次状态施加里一次都没出现。
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const bc = fs.readFileSync(path.join(ROOT, "battle-lab", "compile", "buff-compiler.ts"), "utf8");
  const rg = fs.readFileSync(path.join(ROOT, "battle-lab", "capability", "registry.ts"), "utf8");
  // ★ 第 44 轮更新：这条矛盾已经修掉一半 —— 编译器不再把「造成伤害」写进受击侧字段了。
  ok("★★ 已修：buff-compiler 把「造成伤害|增伤」映射到源侧 dmgDealtB",
    /造成伤害\|增伤\/, "dmgDealtB"/.test(bc), (bc.match(/.*造成伤害.*/) ?? [""])[0].trim().slice(0, 88));
  ok("★★ 已修：减伤取负被限定在 dmgTakenD 上（第 48 轮：此前会误伤同句里的其它属性）",
    /const cutFlip = prop === "dmgTakenD"/.test(bc) && /const healFlip/.test(bc));
  ok("★★ registry 已同步：DMG_DOWN 的 producer 现在是 dmgTakenD",
    /producer: "dmgTakenD"/.test(rg));
  // 仍然存着的（见 g33）：整句回退匹配造成的 4 条误挂 + 心火只取第一个匹配。
}

console.log("\n=== 伤害方向验收: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
