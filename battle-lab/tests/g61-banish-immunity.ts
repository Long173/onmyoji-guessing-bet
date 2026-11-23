// tests/g61-banish-immunity.ts — ★★★ 第 100 轮：**放逐与「免疫放逐」**（目标 ⑨ / ① Fidelity）
//
// 两条由来，都是「有字段没东西」那一类：
//   ① immuneTo 里的 BANISH 从第 94 轮起就有（4 条 buff 解析出来），但**没有任何状态是放逐** ⇒ 无物可免；
//   ② 338 条 buff 里唯一一条用「**抵挡**1次…或放逐」表述免疫的（buff_2922_1 霜织庇护）**没被收上**。
//
// ★ 本轮同时**明确不实现**的一条：被放逐 = 无法被选中。KB 里查不到（「无法被选中」在 338 条 buff 里 0 条），
//   而 buff_3334_1 反写着「剑狱关闭时对被放逐目标造成伤害」⇒ 被放逐的目标仍在场上。见 kernel/status.ts 的 BANISH_STATUS。
import fs from "node:fs";
import path from "node:path";
import { compileBuff } from "../compile/buff-compiler.ts";
import { BANISH_STATUS, StatusBook, findImmuneStatus, incomingKinds, CONTROL_EFFECTS } from "../kernel/status.ts";
import { Entity } from "../kernel/entity.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BUFFS = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8"));
const bArr: any[] = Array.isArray(BUFFS) ? BUFFS : (Object.values(BUFFS).find((v: any) => Array.isArray(v)) as any[]);
const mk = (desc: string) => compileBuff({ id: "probe_1", name: "探查", desc } as any) as any;
const banished = (desc: string) => (mk(desc).immuneTo ?? []).includes("BANISH");
const real = (id: string) => compileBuff(bArr.find(b => String(b.id) === id)) as any;

sec("[1] 全表普查：immuneTo 含 BANISH 的从 4 条变 5 条（多出来的必须点名）")
{
  const withBan: string[] = [];
  for (const b of bArr) if (((compileBuff(b) as any).immuneTo ?? []).includes("BANISH")) withBan.push(String(b.id) + " " + b.name);
  ok("★★★ 恰好 5 条（第 99 轮之前是 4 条）", withBan.length === 5, JSON.stringify(withBan));
  ok("★★★ 新增的那一条是 buff_2922_1「霜织庇护」（用「抵挡1次…」表述免疫）",
    withBan.some(x => x.startsWith("2922_1")), JSON.stringify(withBan));
  ok("★★ 而且它同时是**消耗型**（「抵挡1次」= 一次性的），不是永久免",
    real("2922_1").consumeOnImmune === true);
  console.log("    " + withBan.join("｜"));
}

sec("[2] ★★★ 双向：真写法必须收、假写法必须不收")
{
  ok("★★★ 真写法①「抵挡1次压制、封印、冰冻类效果或放逐」→ 收 BANISH", banished("抵挡1次压制、封印、冰冻类效果或放逐"));
  ok("★★★ 真写法②同一句里的 1 次语义 → consumeOnImmune", mk("抵挡1次压制、封印、冰冻类效果或放逐").consumeOnImmune === true);
  ok("★★ 真写法③「抵挡1次伤害」→ 收 DAMAGE（不是只认放逐）", ((mk("抵挡1次伤害").immuneTo ?? []) as string[]).includes("DAMAGE"));
  ok("★★★ 假写法①「有30%概率抵挡伤害」→ **不收**（概率抵挡是减伤，不是状态免疫；收了等于全程免伤）",
    !(((mk("有30%概率抵挡伤害").immuneTo ?? []) as string[]).includes("DAMAGE")));
  ok("★★★ 假写法②只写「抵挡」不写次数 → 不收（同一类多算的入口）",
    !(((mk("抵挡敌方的伤害").immuneTo ?? []) as string[]).includes("DAMAGE")));
  ok("★★★ 假写法③buff_3334_1「被放逐目标之外的敌方全部死亡时…」→ 过滤器，不收",
    (real("3334_1").immuneTo ?? null) === null, JSON.stringify(real("3334_1").immuneTo ?? null));
  ok("★★★ 假写法④buff_5652_1「若自身未处于控制效果或放逐」→ 条件句，不收",
    (real("5652_1").immuneTo ?? null) === null);
  ok("★★ 假写法⑤buff_3761_1「未处于控制效果和放逐时，立刻施放…」→ 条件句，不收",
    (real("3761_1").immuneTo ?? null) === null);
  ok("★★ 对照：buff_2193_1 鬼王降临「免疫所有控制效果和放逐」仍然收（老行为不许被改掉）",
    ((real("2193_1").immuneTo ?? []) as string[]).includes("BANISH") && ((real("2193_1").immuneTo ?? []) as string[]).includes("CONTROL"));
}

sec("[3] 放逐这个状态本身：类别 / 锁条 / 免疫类别")
{
  ok("★★★ StatusBook 里有放逐（此前根本没这个状态，于是「免疫放逐」无物可免）", StatusBook.get("banish") === BANISH_STATUS);
  /**
   * ★ 一条容易做错的边界：**放逐不是官方[3] 的 16 种控制效果之一**（那张表逐条列了 16 种，没有它）。
   *   把它塞进 CONTROL_EFFECTS 会顺手改掉"16 种"这个定义，而且会让 g13 的条数断言变红。
   *   所以它进 StatusBook，但不进 CONTROL_EFFECTS —— 这一条同时盯住两件事。
   */
  ok("★★★ 它**不在** CONTROL_EFFECTS 里（那张表是 16 种官方控制 + 缚足 = 17 条的定义），但确实在 StatusBook 里",
    !CONTROL_EFFECTS.some(d => d.id === "banish") && CONTROL_EFFECTS.length === 17 && !!StatusBook.get("banish"),
    "CONTROL_EFFECTS=" + CONTROL_EFFECTS.length + "｜book=" + !!StatusBook.get("banish"));
  ok("★★ 无法动作 + 锁条（官方[117] 明确写了放逐「无法受到改变行动条的效果」）",
    BANISH_STATUS.preventsAction === true && BANISH_STATUS.locksTimeline === true);
  ok("★★★ 来袭类别里**同时**有 BANISH 与 CONTROL —— KB 两处并列写法分别对应这两条路（「免疫放逐」与「免疫控制效果」）",
    (() => { const k = incomingKinds(BANISH_STATUS, true); return k.includes("BANISH") && k.includes("CONTROL"); })(),
    JSON.stringify(incomingKinds(BANISH_STATUS, true)));
  ok("★★★ 刻意**不实现**的一条：放逐不等于「无法被选中」（KB 里 0 条这么写，而剑狱反而会打被放逐目标）",
    !Object.prototype.hasOwnProperty.call(BANISH_STATUS, "canBeTargeted"));
}

sec("[4] ★★★ 行为：合成的「免疫放逐」状态真的能挡下放逐；没有它则挡不住")
{
  const guard = new Entity(1, "护卫", 0, { atk: 100, hp: 100, def: 10, spd: 100 });
  const bare = new Entity(2, "裸奔", 0, { atk: 100, hp: 100, def: 10, spd: 100 });
  const immuneDef = { ...StatusBook.get("freeze")!, id: "probe_immune_banish", name: "探查·免放逐",
    preventsAction: false, preventsSkill: false, forcesBasicAttack: false, immuneTo: ["BANISH"] as any };
  guard.addStatus(immuneDef as any, 1, 1, 9);
  ok("★★★ 带「免疫放逐」的单位：findImmuneStatus 认定是 BANISH 被挡下",
    findImmuneStatus(guard, BANISH_STATUS, true)?.kind === "BANISH",
    String(findImmuneStatus(guard, BANISH_STATUS, true)?.kind ?? "null"));
  ok("★★★ 反向：没有免疫的单位挡不住（否则上一条是恒真）", findImmuneStatus(bare, BANISH_STATUS, true) === null);
  const d2 = new Entity(3, "替身", 0, { atk: 100, hp: 100, def: 10, spd: 100 });
  d2.addStatus({ ...immuneDef, id: "probe_immune_dmg", immuneTo: ["DAMAGE"] as any } as any, 1, 1, 9);
  ok("★★★ 对照：只免疫**伤害**（不含 BANISH）的单位挡不住放逐 —— 免疫是按类别匹配的",
    findImmuneStatus(d2, BANISH_STATUS, true) === null);
  const ctrlOnly = new Entity(4, "只免控", 0, { atk: 100, hp: 100, def: 10, spd: 100 });
  ctrlOnly.addStatus({ ...immuneDef, id: "probe_immune_ctrl", immuneTo: ["CONTROL"] as any } as any, 1, 1, 9);
  ok("★★★ 而「免疫控制效果」**也**能挡下放逐（buff_3334_1：「目标免疫控制效果，则不开启剑狱」）",
    findImmuneStatus(ctrlOnly, BANISH_STATUS, true)?.kind === "CONTROL");
}

console.log(`\n=== 放逐与免疫放逐: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
