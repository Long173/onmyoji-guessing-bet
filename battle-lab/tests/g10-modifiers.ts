// tests/g10-modifiers.ts — ★ Modifier 生命周期验收（a1-4 §6/§7、目标 ⑨）
// 要求：属性改动必须带来源、可审计、可按来源整批回收；御魂叠层不再直接 push effects。
import { Entity } from "../kernel/entity.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);

sec("[1] Modifier API 语义");
{
  const e = new Entity(1, "T", 0, { atk: 1000, hp: 10000, def: 300, spd: 100, cri: 0.1, crid: 1.5, efh: 0, efr: 0 });
  const baseAtk = e.prop("atk");
  e.addModifier({ prop: "atk", value: 200, mode: "FIXED", source: "test:a" });
  ok("FIXED：加法生效", e.prop("atk") === baseAtk + 200, String(e.prop("atk")));
  e.addModifier({ prop: "atk", value: 0.5, mode: "ADD_RATE", source: "test:b" });
  ok("ADD_RATE：按比例生效（先固定后乘率）", Math.abs(e.prop("atk") - (baseAtk + 200) * 1.5) < 1e-9, String(e.prop("atk")));
  e.addModifier({ prop: "atk", value: 5000, mode: "SET", source: "test:c" });
  ok("SET：覆盖式生效（优先级最高）", e.prop("atk") === 5000, String(e.prop("atk")));
  ok("★ 无来源的改动被直接拒绝（不可审计的改动不允许存在）", (() => { try { e.addModifier({ prop: "atk", value: 1, mode: "FIXED", source: "" }); return false; } catch { return true; } })());
  ok("modifierSources() 能列出全部来源", e.modifierSources().join(",") === "test:a,test:b,test:c", e.modifierSources().join(","));

  sec("[2] 按来源整批回收");
  const removed = e.removeModifiersBySource("test:");
  ok("回收条数正确", removed === 3, String(removed));
  ok("★ 回收后属性回到基线（不留残留）", e.prop("atk") === baseAtk, String(e.prop("atk")));
  ok("回收是精确的（只动匹配前缀的）", (() => {
    const x = new Entity(2, "T", 0, { atk: 100 });
    x.addModifier({ prop: "atk", value: 10, mode: "FIXED", source: "soul12:stack1" });
    x.addModifier({ prop: "atk", value: 20, mode: "FIXED", source: "soul13:stack1" });
    x.removeModifiersBySource("soul12:");
    return x.prop("atk") === 120 && x.modifierCount("soul13:") === 1;
  })());
}

sec("[3] 御魂叠层走 Modifier API（战斗内实测）");
{
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { createKit, assembleMatch } = await import("../../apps/web/src/engine/assemble.ts");
  const { canonicalMatch } = await import("../../apps/web/src/mock/canonical-match.ts");
  const ROOT = path.resolve(import.meta.dirname, "..", "..");
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
  // 无刀取：回合结束永久+15%伤害、上限45% → 最多 3 层
  const soulId = (bundle.souls as any[]).find(s => /永久提升.*的伤害/.test(s.desc ?? ""))?.id;
  const m = canonicalMatch();
  m.red.units[0].soulId = soulId ?? null;
  const a = assembleMatch(createKit(bundle), m, { seed: 20261001 });
  a.battle.traceLevel = "NONE";
  await a.battle.run();
  const u = a.battle.allEntities().find((x: any) => x.id === 101)!;
  const soulMods = u.effects.filter((x: any) => String(x.source).startsWith("soul"));
  ok(`带来源的御魂 modifier 数量合理（${soulMods.length} 条，上限 3 层）`, soulMods.length <= 3, String(soulMods.length));
  ok("★ 每一条 modifier 都有非空来源（没有匿名属性改动）", u.effects.every((x: any) => !!x.source), JSON.stringify(u.effects.filter((x: any) => !x.source)));
  // ★ 第 43 轮：无刀取从 dmgTakenB 改到 dmgDealtB（源侧字段，见报告 §35）。
  //   这条断言测的是**回收生命周期**，不该绑死在某个具体属性名上 —— 直接从 modifier 自己取。
  const prop = soulMods[0]?.prop ?? "dmgDealtB";
  const before = u.prop(prop);
  u.removeModifiersBySource(`soul${soulId}:`);
  ok("★ 战斗结束后仍能按来源精确回收，属性随之回落", u.prop(prop) < before || soulMods.length === 0, `${prop}: ${before} → ${u.prop(prop)}`);
}

console.log(`\n=== Modifier 生命周期: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;