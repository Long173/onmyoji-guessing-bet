// tests/g14-targeting.ts — ★ 可选中性（canBeTargeted）接线验收（a1-4 §22 Targeting 独立系统）
// 背景：canBeTargeted 字段此前**全库无人读取** —— 无敌/放逐/隐匿 只是挂了个状态，敌人照样能打。
// 关键区分：不可选中 ≠ 不计入胜负。活着、计入胜负、但不能被选中，是三件不同的事。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const m = () => { const x = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 }); return x.battle as any; };

sec("[1] 不可选中的敌人会被寻敌跳过");
{
  const b = m();
  await b.runStartup();
  const foe = b.teams[1].members[0];
  ok("初始可被选中", b.enemiesOf(0).some((e: any) => e.id === foe.id));
  foe.setTargetable(false, "probe:invincible");
  ok("★ 标记后不再出现在寻敌结果里", !b.enemiesOf(0).some((e: any) => e.id === foe.id), JSON.stringify(b.enemiesOf(0).map((e: any) => e.id)));
  ok("★ 但它**仍然活着、仍然计入胜负**", b.teams[1].aliveMembers().some((e: any) => e.id === foe.id) && foe.alive);
  ok("痕迹写进了 notes（可审计）", foe.notes.some((n: string) => n.startsWith("targetable=false")));
  foe.setTargetable(true, "probe:invincible-end");
  ok("恢复后可再次被选中", b.enemiesOf(0).some((e: any) => e.id === foe.id));
}

sec("[2] 全员不可选中时不死锁（红区假设，显式退回）");
{
  const b = m();
  await b.runStartup();
  for (const e of b.teams[1].members) e.setTargetable(false, "probe:all-untargetable");
  ok("★ 全员不可选中时退回存活列表（而不是返回空数组造成行动空转）", b.enemiesOf(0).length === b.teams[1].aliveMembers().length, `${b.enemiesOf(0).length} vs ${b.teams[1].aliveMembers().length}`);
  const r = await b.runPartial(3);
  ok("战斗照常推进", b.turn > 0, `turn=${b.turn}`);
}

sec("[3] 胜负判定不受可选中性影响（最关键的一条）");
{
  const b = m();
  await b.runStartup();
  for (const e of b.teams[1].members) { e.alive = false; e.dead = true; e.hp = 0; }
  const last = b.teams[1].members[4];
  last.alive = true; last.dead = false; last.hp = 100;
  last.setTargetable(false, "probe:untargetable-survivor");
  const finished = b.checkVictory?.();
  ok("★ 唯一存活者即使不可选中，也**不会**被判为全灭", b.winner === null, `winner=${b.winner}`);
  last.alive = false; last.dead = true; last.hp = 0;
  b.checkVictory?.();
  ok("★ 它真的死了才判负", b.winner === 0, `winner=${b.winner}`);
}

sec("[4] 诚实边界：状态 → 不可选中的自动联动尚未实现");
  console.log("    已接线：canBeTargeted 被寻敌读取；setTargetable() 是可审计的受控入口。");
  console.log("    未接线：无敌/放逐/隐匿 类**状态**还不会自动调用 setTargetable —— StatusDef 上没有对应标记字段，");
  console.log("            要做得先扩 StatusDef + buff-compiler（属下一步，不在本轮）。");
  ok("(记录性质，不作通过判断)", true);

console.log(`\n=== 可选中性: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;