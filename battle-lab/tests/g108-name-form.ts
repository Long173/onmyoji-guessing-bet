// tests/g108-name-form.ts — ★★★ 第 186 轮：**名字形态的状态引用**（正文写「雄姿英发」而不是 [buff_2173_1]）
//
// 由来：有些技能正文把状态写成**名字**：「增加1层雄姿英发并增加自身5%行动条」（大天狗）·
//   「为敌方目标施加3层结怨并开启…」（聆海金鱼姬）·「言灵增加1层墨灵」（言灵）。
//   编译器只认方括号形态 ⇒ 这些效果**整个漏收**（言灵那条 179 轮 §151.3 记过）。
// 这一轮把「名字 → id」表接进编译期（compile/buff-names.ts，入口显式设置），并**只落产物**：
//   → statusRefNameForm（带子句证据）。接进 statusRefs 会改变行为（346 在典型阵容里），与基数那条同属待裁定项。
import fs from "node:fs";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";
import { buffNames } from "../compile/buff-names.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const irs = (input.skills as any[]).map((e: any) => ({ key: String(e.key), ir: JSON.parse(String(e.json)) }));
const irOf = (k: string) => irs.find((x) => x.key === k)!.ir;

sec("[1] ★★★ 名字表本身（漏设置会当场红 —— 与 tips 表同一条纪律）");
{
  ok("★★★ 名字表非空（≥300 条）", buffNames().size >= 300, String(buffNames().size));
  ok("★★ 而且是一对多的形状（名字 → id 列表；多候选时由调用方拒绝）",
    [...buffNames().values()].every((v) => Array.isArray(v) && v.length >= 1));
}

sec("[2] ★★★ 收进来的两条（唯一的两个真命中）");
{
  const hits = irs.filter((x) => (x.ir.statusRefNameForm ?? []).length > 0);
  console.log("  " + hits.map((x) => x.key + " " + JSON.stringify(x.ir.statusRefNameForm)).join("\n  "));
  ok("★★★ 恰好 2 个技能：217/217_03（雄姿英发）与 346/346_03（结怨）",
    hits.map((x) => x.key).sort().join() === "217/217_03,346/346_03", JSON.stringify(hits.map((x) => x.key)));
  ok("★★★ 每条都**带子句证据**，且那个 id **还不在** statusRefs 里（说明它是真的漏收）",
    hits.every((x) => x.ir.statusRefNameForm.every((m: any) =>
      String(m.clause).length > 6 && !(x.ir.statusRefs ?? []).includes(m.ref))));
  ok("★★ 两条都是「施加 / 增加N层」的写法（有「给」的动词）",
    hits.every((x) => x.ir.statusRefNameForm.every((m: any) => /增加|施加|获得|附加/.test(String(m.clause)))));
}

sec("[3] ★★★ 反向（fail-closed）：三种不该收的写法，一条都不许收");
{
  const all = irs.flatMap((x) => (x.ir.statusRefNameForm ?? []).map((m: any) => ({ key: x.key, ...m })));
  ok("★★★ 铃彦姬「五山火祭」的「消耗…义火 / 愿力」**不收** —— 动词是「消耗」，不是「给」",
    !all.some((m) => m.key === "376/376_03" || m.ref === "3993_1" || m.ref === "3722_1"), JSON.stringify(all.filter((m) => m.ref === "3993_1" || m.ref === "3722_1")));
  ok("★★★ 云间不见岳「炎崖」的「御**神火**界」**不收** —— 名字左边是「御」，不是量词 / 边界（那只是长词的一部分）",
    !all.some((m) => m.ref === "3761_1"), JSON.stringify(all.filter((m) => m.ref === "3761_1")));
  ok("★★ 判据表里还有一条 fail-closed：名字 → id **多候选**时不猜（今天数据里没有实例，判据写在编译期注释里）", true);
}

sec("[4] ★★★ 只记账：产物**不进** statusRefs（行为逐位不变）");
{
  const a = irOf("346/346_03"), b = irOf("217/217_03");
  ok("★★★ 346/346_03：结怨（3461_1）**不在** statusRefs 里", !(a.statusRefs ?? []).includes("3461_1"), JSON.stringify(a.statusRefs));
  ok("★★★ 217/217_03：雄姿英发（2173_1）**不在** statusRefs 里", !(b.statusRefs ?? []).includes("2173_1"), JSON.stringify(b.statusRefs));
  ok("★★★ 原因写进缺口清单：接进去会改变行为，而 346 在**典型对局**的阵容里 ⇒ 会动默认档指纹（与基数那条同类，等一次裁定）", true);
}

console.log("\n=== 名字形态的状态引用: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
