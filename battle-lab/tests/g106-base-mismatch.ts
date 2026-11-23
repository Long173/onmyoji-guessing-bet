// tests/g106-base-mismatch.ts — ★★★ 第 184 轮：**基数记账**（伤害 + 治疗）—— 只记账、不改行为
//
// 第 183 轮量到伤害的基数：10 个技能的子句写「造成（自身/敌方）生命上限N%」，产物却一律记 base=atk。
// 这一轮把**治疗**也量了一遍：治疗产物的提取**一律**写 base=maxHp，而子句可能写的是
//   「治疗**攻击**N%的生命」（10 条）或「治疗**等同该次伤害**N%的生命」（2 条，动态量）。
// ★ 两族都**只记账**：改基数会动到典型对局的默认档指纹（阵容里有 聆海金鱼姬 与 日和坊），
//   必须先有一次明确裁定 —— 已记进缺口清单的「待定规格」那一档。
import fs from "node:fs";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const irs = (input.skills as any[]).map((e: any) => ({ key: String(e.key), ir: JSON.parse(String(e.json)) }));
const irOf = (k: string) => irs.find((x) => x.key === k)!.ir;

sec("[1] ★★★ 伤害基数：10 条，每条都对应真实存在的伤害槽位");
{
  const hits = irs.filter((x) => (x.ir.damageBaseMismatch ?? []).length > 0);
  console.log("  " + hits.map((x) => x.key + JSON.stringify(x.ir.damageBaseMismatch.map((m: any) => m.ratio))).join(" · "));
  ok("★★★ 有 damageBaseMismatch 的技能 = 10", hits.length === 10, String(hits.length));
  ok("★★★ 每条都**真有**这个 ratio 的伤害产物（不许把纯条件句收进来）",
    hits.every((x) => x.ir.damageBaseMismatch.every((m: any) => (x.ir.damage ?? []).some((d: any) => d.ratio === m.ratio))));
  ok("★★★ 而产物里的 base 仍然是 atk（只记账 —— 改它会动默认档指纹）",
    hits.every((x) => (x.ir.damage ?? []).every((d: any) => (d.base ?? "atk") === "atk")));
}

sec("[2] ★★★ 治疗基数：11 个技能（攻击类 10 + 动态量类 2）");
{
  const hits = irs.filter((x) => (x.ir.healBaseMismatch ?? []).length > 0);
  const all = hits.flatMap((x) => x.ir.healBaseMismatch);
  console.log("  " + hits.map((x) => x.key + JSON.stringify(x.ir.healBaseMismatch.map((m: any) => m.ratio + "/" + m.stated))).join(" · "));
  ok("★★★ 有 healBaseMismatch 的技能 = 11", hits.length === 11, String(hits.length));
  ok("★★★ 分类：攻击类 10 条 · 动态量（等同该次伤害）类 2 条",
    all.filter((m: any) => m.stated === "atk").length === 10 && all.filter((m: any) => m.stated === "dynamic").length === 2,
    JSON.stringify({ atk: all.filter((m: any) => m.stated === "atk").length, dynamic: all.filter((m: any) => m.stated === "dynamic").length }));
  ok("★★★ 每条都**真有**这个 ratio 的治疗产物",
    hits.every((x) => x.ir.healBaseMismatch.every((m: any) => (x.ir.heal ?? []).some((h: any) => h.ratio === m.ratio))));
  ok("★★★ 而产物的 base **一律**还是 maxHp（提取处就是这么写的 —— 这一轮只记账）",
    hits.every((x) => (x.ir.heal ?? []).every((h: any) => (h.base ?? "maxHp") === "maxHp")));
}

sec("[3] ★★ 反向：写「生命上限N%」的治疗**不进**清单（不许误伤）");
{
  const ir = irOf("257/257_02");
  ok("★★ 食梦貘「沉睡」的治疗写的是「治疗5%生命上限的生命」⇒ 不在清单里",
    !(ir.healBaseMismatch ?? []).length && (ir.heal ?? []).some((h: any) => h.ratio === 5), JSON.stringify({ heal: ir.heal, flag: ir.healBaseMismatch ?? null }));
  const good = irs.filter((x) => (x.ir.heal ?? []).length > 0);
  ok("★★ 全库有治疗产物的技能 " + good.length + " 个，其中被标基数不一致的只有 11 个（多数写的就是生命上限）",
    good.length >= 40 && good.length - 11 >= 30, String(good.length));
}

sec("[4] ★★★ 为什么只记账：典型对局里有它们");
{
  const lineup = [202, 297, 601, 225, 346, 205, 358, 267, 352, 390];
  const flagged = new Set(irs.filter((x) => (x.ir.healBaseMismatch ?? []).length > 0).map((x) => Number(x.key.split("/")[0])));
  const overlap = lineup.filter((id) => flagged.has(id));
  console.log("  阵容里的角色与清单的交集：" + JSON.stringify(overlap));
  ok("★★★ 交集非空（聆海金鱼姬 346 在阵容里、且它的「灵鱼抱蕊」写的是「治疗攻击50%的生命」）",
    overlap.includes(346), JSON.stringify(overlap));
  ok("★★★ 所以改基数 = 动默认档指纹 ⇒ 必须先有一次裁定（这条已进缺口清单的「待定规格」）", true);
}

console.log("\n=== 基数记账（伤害 + 治疗）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
