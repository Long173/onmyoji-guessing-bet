// tests/g51-shield-per-hit.ts — ★★★ 护盾的**单次受击上限**（第 85 轮）
//
// 原文：「抵挡等同生命上限3%的伤害，**最多抵挡该次伤害的40%**」
//   · 前半句是盾的**池子大小** —— 第 80 轮修好了它的基准（3% × 生命上限）；
//   · 后半句是**每一次受击最多能吸走这一击的 40%** —— 此前完全没有被执行：
//     `Entity.mutateHp` 里是 `Math.min(sh.value, remaining)`，**一击就能把整个池子吸干**。
//
// ★ 只认**无歧义**的写法：`最多抵挡该次伤害的N%`（上限相对**这一次伤害**）。
//   杀生丸「天生牙结界」的「最多不超过**已损失生命**的40%」是另一种形状（相对已损失生命），
//   引擎没有建模它 —— 它继续留在效果缺口表里，**不在这里猜**。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { SHIELD_PER_HIT_RE, EFFECT_DETAIL_MARKERS } from "../kernel/triggers.ts";
import { Entity } from "../kernel/entity.ts";
import { HpMutation } from "../kernel/types.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const sk = (t: string) => compileSkill(1, "T", { id: "1_01", name: "S", cost: 5, description: t, brief: "", upgrades: [] });
const kb = () => JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);

sec("[1] ★★★ 合成用例：无歧义的写法认得，另一种形状不许误认");
{
  const one = (t: string) => { const a = sk(t).shield ?? []; return a.length ? a[0] : null; };
  const a = one("抵挡等同生命上限3%的伤害，最多抵挡该次伤害的40%");
  ok("★★★ 池子 3% × maxHp 且单次上限 0.40", a?.ratio === 3 && a?.base === "maxHp" && a?.perHitRatio === 0.4, JSON.stringify(a));
  ok("★★★ 没有上限写法的护盾**不带** perHitRatio（不设上限 = 旧语义）",
    one("吸收攻击150%伤害")?.perHitRatio === undefined);
  ok("★★★ 反向：「最多不超过已损失生命的40%」是**另一种形状**，不许被当成单次上限",
    one("抵挡其中的30%，最多不超过已损失生命的40%") === null);
  ok("★★ 那个形状仍然留在效果缺口表里（引擎确实没建模它）",
    EFFECT_DETAIL_MARKERS.test("抵挡其中的30%，最多不超过已损失生命的40%"));
  ok("★★★ 而「最多抵挡」已经不在缺口表里了（它被执行了）",
    !EFFECT_DETAIL_MARKERS.test("抵挡等同生命上限3%的伤害，最多抵挡该次伤害的40%"));
}

sec("[2] ★★★ 全库：解析出来的每一条都要能复核");
{
  let total = 0, capped = 0;
  for (const s of (Array.isArray(kb()) ? kb() : [])) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      for (const x of (compileSkill(s.id, s.name, k).shield ?? [])) {
        total++;
        if (!x.evidence) fail++;
        if (x.perHitRatio !== undefined) { capped++; if (!(x.perHitRatio > 0 && x.perHitRatio <= 1)) fail++; }
      }
    }
  }
  ok("★★★ 护盾条目总数 ≥ 20", total >= 20, String(total));
  ok("★★★ 有单次上限的护盾确实存在（不是 0 条而显得干净）", capped >= 2, String(capped));
  console.log("    护盾 " + total + " 条，其中带单次上限 " + capped + " 条");
}

sec("[3] ★★★ 端到端（内核级）：一击最多只被吸走 N%");
{
  const mk = () => { const e = new Entity(1, "靶子", 0, { atk: 100, hp: 10000, def: 0, spd: 100 } as any); return e; };
  const capped = mk();
  capped.addShield({ value: 1000, sourceId: 9, perHitRatio: 0.4 });
  const r1 = capped.mutateHp(HpMutation.DAMAGE, 500, "test");
  ok("★★★ 池子 1000、单次上限 40%，来一击 500 → 只吸 200", Math.abs(r1.absorbed - 200) < 1e-6, JSON.stringify(r1));
  const r2 = capped.mutateHp(HpMutation.DAMAGE, 2000, "test");
  ok("★★★ 来一击 2000 → 吸 800（= 2000 × 40%），而不是把剩下的池子全吸干", Math.abs(r2.absorbed - 800) < 1e-6, JSON.stringify(r2));
  ok("★★ 两次之后池子还剩 0（1000 - 200 - 800）", Math.abs((capped.shields[0].value) - 0) < 1e-6, String(capped.shields[0].value));
  // 反向：没有上限的盾，这一击会被全额吸收
  const plain = mk();
  plain.addShield({ value: 1000, sourceId: 9 });
  const r3 = plain.mutateHp(HpMutation.DAMAGE, 500, "test");
  ok("★★★ 反向：没有上限的盾**全额**吸收 500（旧语义没被动到）", Math.abs(r3.absorbed - 500) < 1e-6, JSON.stringify(r3));
  ok("★★★ 两者用的是同一个入口，差别只能来自 perHitRatio", r1.absorbed !== r3.absorbed, r1.absorbed + " vs " + r3.absorbed);
  ok("★★ 没上限的盾不写 perHitRatio 字段（指纹对它不变）", plain.shields[0].perHitRatio === undefined);
}

sec("[4] ★★★ 自我守护：「最多抵挡」能离开缺口表，靠的是这个前提一直成立");
{
  // 凡原文写了「最多抵挡该次伤害的N%」的技能，这个比例都必须真的被解析出来。
  // 两者都没有 = 上限没被执行 = 这张表必须把它收回去。
  let marked = 0, parsed = 0;
  const violations: string[] = [];
  for (const s of (Array.isArray(kb()) ? kb() : [])) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      const raw = String(k.description ?? "") + " " + (k.upgrades ?? []).join(" ");
      if (!SHIELD_PER_HIT_RE.test(raw)) continue;
      marked++;
      const ir = compileSkill(s.id, s.name, k);
      if ((ir.shield ?? []).some((x: any) => x.perHitRatio !== undefined)) parsed++;
      else violations.push(s.name + "「" + k.name + "」");
    }
  }
  ok("★★★ 样本非空（不许因为一条都没扫到而平凡通过）", marked >= 2, String(marked));
  ok("★★★ 写了「最多抵挡该次伤害的N%」的技能，上限**都**被解析出来了", violations.length === 0,
    "漏解析 " + JSON.stringify(violations) + "（若 >0：必须把 最多抵挡 收回到 EFFECT_DETAIL_MARKERS）");
  console.log("    写了单次上限的技能 " + marked + " 个，全部解析成功（" + parsed + "）");
}

sec("[5] ★★ 端到端（真技能）：童男「羽衣」施加出来的盾带着 0.40");
{
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
  const mm: any = canonicalMatch();
  mm.red.units[0].shikigamiId = 212;
  mm.red.units[0].name = "童男";
  const a: any = assembleMatch(createKit(bundle), mm, { seed: 20261001 });
  await a.battle.runStartup();
  const me = a.battle.allEntities().find((e: any) => e.teamId === 0 && e.shikigamiId === 212);
  const skill = me.skills.find((x: any) => x.name === "羽衣");
  ok("★★ 童男的「羽衣」在技能表里（id=212 是从 KB 查的，不是猜的）", !!skill, me.skills.map((x: any) => x.name).join("/"));
  me.shields.length = 0;
  await skill.execute(a.battle, me, me);
  const sh = (me.shields ?? [])[0];
  ok("★★★ 施加出的盾带 perHitRatio = 0.4", sh?.perHitRatio === 0.4, JSON.stringify(sh));
  ok("★★★ 池值 = 生命上限的 3%（第 80 轮修好的基准）",
    sh && Math.abs(sh.value - me.maxHp * 0.03) <= Math.max(1, me.maxHp * 0.0002), JSON.stringify({ v: sh?.value, want: me.maxHp * 0.03 }));
  console.log("    童男 maxHp=" + me.maxHp + " → 盾 " + (sh?.value ?? 0).toFixed(1) + "，单次上限 " + ((sh?.perHitRatio ?? 0) * 100) + "%");
}

console.log("\n=== 护盾单次上限: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
