// tests/g94-summon-hook-install.ts — ★★★ 第 147 轮：**召唤物钩子的安装点收口**（目标 ⑨：Summon Runtime）
//
// 由来（报告里挂了很久的那一条）：「召唤物钩子 still has two install points」。
//   handler 不进存档，所以新建与恢复两条路径都必须装 —— 但**两处各写一遍**迟早会分叉：
//   分叉的表现是「恢复之后的战斗里那条光环静默消失」，而且不会报错。
// 第 113 轮起两条路径都调**同一个** installSummonHooks（且幂等）；这个文件把这件事钉成可执行事实：
//   · 安装点确实只有两处调用、且都走那个导出函数（没有第三条手写 bus.register 的路）；
//   · 新建的召唤物与**恢复后**的召唤物，订阅集合逐项一致（跨路径 parity）；
//   · 幂等：重复安装不新增；
//   · 反向：没有反应式光环的召唤物一条钩子都不装（不是「每个召唤物都挂一条」）。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { TurnType } from "../kernel/types.ts";
import { captureState, restoreBattle } from "../kernel/state.ts";
import { installSummonHooks } from "../kernel/summon.ts";
import { setTipsTable, loadTips } from "../compile/tips.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const tipsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
const tips: any[] = Array.isArray(tipsRaw) ? tipsRaw : (Object.values(tipsRaw).find((v: any) => Array.isArray(v)) as any[]);
setTipsTable(loadTips(tips));

const walk = (d: string, acc: string[] = []): string[] => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git|fixtures/.test(p)) walk(p, acc); }
    else if (/\.(ts)$/.test(e.name) && !/tests[\\/]/.test(p)) acc.push(p);
  }
  return acc;
};

sec("[1] ★★★ 安装点唯一：两条路径都走同一个导出函数，没有第三条手写注册的路");
{
  const files = [...walk(path.join(ROOT, "battle-lab")), ...walk(path.join(ROOT, "apps", "web", "src"))];
  const callers: string[] = [];
  let handRolled = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const code = src.split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");
    if (/installSummonHooks\s*\(/.test(code) && !/export function installSummonHooks/.test(code)) callers.push(path.relative(ROOT, f).replace(/\\/g, "/"));
    if (/bus\.register/.test(code) && /summon:/.test(code) && !f.endsWith("summon.ts")) handRolled++;
  }
  ok("★★★ 调用点恰好两处：addSummon（新建）与 restoreBattle（恢复）",
    callers.length === 2 && callers.some(c => c.endsWith("kernel/battle.ts")) && callers.some(c => c.endsWith("kernel/state.ts")),
    JSON.stringify(callers));
  ok("★★★ 没有第三条手写注册召唤物钩子的路（否则那条路上的召唤物会静默无光环）", handRolled === 0, String(handRolled));
  ok("★★ 而且它是从 kernel/summon.ts 导出的（两条路径读同一份实现）",
    /export function installSummonHooks/.test(fs.readFileSync(path.join(ROOT, "battle-lab", "kernel", "summon.ts"), "utf8")));
}

sec("[2] ★★★ 跨路径 parity：新建的与恢复后的召唤物，订阅集合逐项一致");
{
  const mk = async (name: string, seed: number) => {
    const s = KB.find((x: any) => x.name === name);
    const m = canonicalMatch();
    m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name };
    const a: any = assembleMatch(createKit(bundle), m, { seed });
    await a.battle.runStartup();
    return a;
  };
  const A: any = await mk("千姬", 20261801);
  const qj = A.battle.teams[0].members[0];
  A.battle.teams[0].orbs.orb = 8;
  await A.battle.runPseudoTurn(qj, TurnType.PSEUDO_TURN, { skill: qj.skills.find((s: any) => s.name === "海潮入梦"), target: A.battle.teams[1].members[0] });
  const lamp = A.battle.teams[0].summons[0];
  ok("★ 前置：海原贝戟上场了（否则下面全是平凡通过）", !!lamp && lamp.notes.some((n: string) => n.startsWith("summon:reactive-heal=")),
    JSON.stringify(lamp?.notes ?? []));
  const idsOf = (b: any) => b.bus.handlers.filter((h: any) => String(h.id).startsWith("summon:")).map((h: any) => h.id).sort();
  const fresh = idsOf(A.battle);
  ok("★★ 新建路径装上了钩子（≥1 条，且 id 带 summon: 前缀）", fresh.length >= 1, JSON.stringify(fresh));
  const k2 = createKit(bundle);
  const B: any = restoreBattle(JSON.parse(JSON.stringify(captureState(A.battle))), { kit: k2, makeRuntime: (id: number) => runtimeFor(k2, id), attachRuntime });
  const restored = idsOf(B);
  ok("★★★ 恢复后的订阅集合与新建时**逐项相同**（少一条就是「恢复之后光环消失」）",
    JSON.stringify(fresh) === JSON.stringify(restored), JSON.stringify({ fresh, restored }));
  ok("★★★ 比例判据也在（notes 是判据来源，恢复后读得到同一个值）",
    B.teams[0].summons[0].notes.some((n: string) => n === "summon:reactive-heal=0.3"),
    JSON.stringify(B.teams[0].summons[0].notes.filter((n: string) => n.includes("reactive"))));
  const n0 = B.bus.handlers.length;
  installSummonHooks(B, B.teams[0].summons[0]);
  ok("★★★ 幂等：对同一场再装一次，订阅总数不变（重复注册会让反应式回血治两次）",
    B.bus.handlers.length === n0, n0 + " → " + B.bus.handlers.length);
}

sec("[3] ★★ 反向：没有反应式光环的召唤物，一条钩子都不装");
{
  const s = KB.find((x: any) => x.name === "慧明灯");
  const m = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name: "慧明灯" };
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261802 });
  await a.battle.runStartup();
  const hm = a.battle.teams[0].members[0];
  a.battle.teams[0].orbs.orb = 8;
  const before = a.battle.bus.handlers.filter((h: any) => String(h.id).startsWith("summon:")).length;
  await a.battle.runPseudoTurn(hm, TurnType.PSEUDO_TURN, { skill: hm.skills.find((s: any) => s.name === "正念"), target: a.battle.teams[1].members[0] });
  const after = a.battle.bus.handlers.filter((h: any) => String(h.id).startsWith("summon:")).length;
  ok("★★ 明识灯（只有移除代价、没有反应式光环）⇒ 不新增订阅", after === before, before + " → " + after);
  ok("★★ 但它的移除代价判据照样写在 notes 里（两件事分开）",
    a.battle.teams[0].summons[0]?.notes.some((n: string) => n.startsWith("summon:on-remove-orbs=")) === true,
    JSON.stringify(a.battle.teams[0].summons[0]?.notes ?? []));
}

console.log("\n=== 召唤物钩子安装点: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
