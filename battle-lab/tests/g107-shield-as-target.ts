// tests/g107-shield-as-target.ts — ★★★ 第 185 轮：**「打护盾打得更疼」不是「给谁套盾」**
//
// 由来：孟婆「药汤」写的是「造成攻击100%伤害，**额外对[护盾]造成100%伤害**」。
//   那条 tips_6（= 护盾）的引用被 shieldTip 那一趟抓成了一个**护盾效果**：
//   shield=[{ratio:100, base:"maxHp"}] —— 而且护盾会跟着技能的目标走，
//   于是这一击**会给敌方套一个 100% 生命上限的盾**（比"少算"坏得多：这是反过来帮对手）。
// 修法：在 [tips_6] 与那个百分数之间出现「造成」⇒ 那是在说"打护盾"，不是"套盾"，拒绝并留痕。
import fs from "node:fs";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const irs = (input.skills as any[]).map((e: any) => ({ key: String(e.key), ir: JSON.parse(String(e.json)) }));
const irOf = (k: string) => irs.find((x) => x.key === k)!.ir;

sec("[1] ★★★ 孟婆「药汤」：那个凭空多出来的护盾没了");
{
  const ir = irOf("215/215_01");
  console.log("  shield = " + JSON.stringify(ir.shield) + "｜shieldSkips = " + JSON.stringify(ir.shieldSkips));
  ok("★★★ 护盾产物为空（此前是 [{ratio:100, base:maxHp}]）", (ir.shield ?? []).length === 0, JSON.stringify(ir.shield));
  ok("★★★ 而且留了痕：shieldSkips 里有一条 NOT_A_SHIELD（判错时要能看出照哪句话判的）",
    (ir.shieldSkips ?? []).some((s: any) => s.reason === "NOT_A_SHIELD" && /tips_6/.test(String(s.evidence))), JSON.stringify(ir.shieldSkips));
  ok("★★ 它真正的伤害还在（造成攻击100%伤害 + 对护盾造成100%伤害 —— 两条都是伤害）",
    (ir.damage ?? []).some((d: any) => d.ratio === 100), JSON.stringify(ir.damage));
}

sec("[2] ★★★ 反向：真的护盾一条都不许误伤");
{
  const cases: Array<[string, number]> = [["292/292_02", 150], ["206/206_02", 12], ["201/201_02", 6], ["272/272_02", 16]];
  for (const [key, ratio] of cases) {
    const ir = irOf(key);
    ok("★ " + key + " 的护盾仍在（" + ratio + "）且没有 skip 记录",
      (ir.shield ?? []).some((s: any) => s.ratio === ratio) && !(ir.shieldSkips ?? []).length,
      JSON.stringify({ shield: ir.shield, skips: ir.shieldSkips ?? null }));
  }
  ok("★★★ 全库有 shieldSkips 的技能 = 4（都是 NOT_A_SHIELD 那一类：把护盾当被打的对象 / 讲的是造成伤害）",
    irs.filter((x) => (x.ir.shieldSkips ?? []).length > 0).length === 4,
    JSON.stringify(irs.filter((x) => (x.ir.shieldSkips ?? []).length > 0).map((x) => x.key)));
}

sec("[3] ★★★ 端到端：这一击**不会**再给敌方套盾");
{
  const KB: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
  const s = KB.find((c: any) => c.name === "孟婆")!;
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: s.id, name: s.name };
  const a: any = assembleMatch(createKit(bundle), m, { seed: 185, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  const b = a.battle;
  const self = b.teams[0].members[0];
  const foe = b.allEntities().find((e: any) => e.teamId === 1)!;
  const sk = (self.skills ?? []).find((x: any) => String(x.ir?.id ?? "") === "215_01");
  const shieldOf = (e: any) => Number(e.shield ?? 0);
  const before = { self: shieldOf(self), foe: shieldOf(foe) };
  await sk.execute(b, self, foe);
  const after = { self: shieldOf(self), foe: shieldOf(foe) };
  console.log("  护盾变化：" + JSON.stringify({ before, after }));
  ok("★★★ 敌方**没有**拿到护盾（修之前这里会出现一个 100% 生命上限的盾）", after.foe === before.foe, JSON.stringify({ before, after }));
  ok("★★★ 自己也没有（这门技能本来就不给任何人套盾）", after.self === before.self, JSON.stringify({ before, after }));
  ok("★★ 但伤害照常发生（技能的主体没被这次修复牵连）", b.trace.some((t: any) => t.t === "DAMAGE"), JSON.stringify(b.trace.filter((t: any) => t.t === "DAMAGE").length));
}

console.log("\n=== 护盾当被打的对象: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
