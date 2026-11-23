// tests/parse-determinism.ts — ★ 技能解析必须与调用顺序无关
// 背景：compile/skill-compiler.ts 里的 /g 正则是**共享模块级对象**，
//       String.matchAll(re) 会克隆正则并继承 lastIndex，而 RegExp.test() 成功后会推进 lastIndex。
//       两者相撞 → 「同一个技能，先编译谁」会改变它的解析结果。这曾真实发生：
//       座敷童子「魂之火」（造成攻击100%伤害）在编译了 40 只式神之后被解析成"无伤害"。
import { compileSkill } from "../compile/skill-compiler.ts";
import { loadKb } from "../compile/load.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };

const kb = await loadKb();
const all: Array<[any, any]> = [];
for (const s of kb.shiki) for (const k of (s.skills ?? [])) all.push([s, k]);

const snapshot = (list: Array<[any, any]>) => list.map(([s, k]) => {
  const ir = compileSkill(s.id, s.name, k);
  return JSON.stringify({ id: s.id, n: ir.name, d: ir.damage, h: ir.heal, s: ir.shield, t: ir.timeline, o: ir.orb, st: ir.statusRefs, c: ir.confidence });
});

console.log("\n[1] 同一技能，单独编译 vs 批量之后编译");
const s205 = kb.shiki.find((x: any) => Number(x.id) === 205);
const hun = s205.skills.find((x: any) => x.name === "魂之火");
const alone = compileSkill(205, s205.name, hun);
for (const s of kb.shiki.slice(0, 40)) for (const k of (s.skills ?? [])) compileSkill(s.id, s.name, k);
const after = compileSkill(205, s205.name, hun);
ok("单独编译解析出 100% 伤害", alone.damage.length === 1 && alone.damage[0].ratio === 100, JSON.stringify(alone.damage));
ok("★ 批量编译 40 只之后结果不变（顺序无关）", JSON.stringify(alone.damage) === JSON.stringify(after.damage) && alone.confidence === after.confidence,
   `alone=${alone.confidence}/${JSON.stringify(alone.damage)} after=${after.confidence}/${JSON.stringify(after.damage)}`);

console.log("\n[2] 全库顺序不变性（818 条技能）");
const A = snapshot(all);
const B = snapshot([...all].reverse());
const C = snapshot([...all].sort((a, b) => (Number(a[0].id) * 31 + a[1].name.length) % 7 - (Number(b[0].id) * 31 + b[1].name.length) % 7));
const key = (x: string[]) => x.slice().sort().join("|");
ok("正序 == 逆序", key(A) === key(B));
ok("正序 == 第三顺序", key(A) === key(C));

console.log("\n[3] 缓存复用不改变结果（同一对象编译两次）");
const twice = JSON.stringify(compileSkill(205, s205.name, hun)) === JSON.stringify(compileSkill(205, s205.name, hun));
ok("重复编译幂等", twice);

console.log(`\n=== 解析确定性: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
