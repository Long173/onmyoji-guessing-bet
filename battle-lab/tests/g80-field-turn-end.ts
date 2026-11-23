// tests/g80-field-turn-end.ts — ★★★ 第 125 轮：场地的**回合结束**效果（第二种每回合形状）
//
// 第 124 轮做了第一种形状（辉夜姬：回合开始 67% 回火）。这一轮做第二种：
//   神酿星熊童子「饮过三巡」的「结界中敌我双方所有非召唤物目标在回合结束时有40%[tips_2]被施加[tips_103]」。
//   ★ 两处**实测踩到的坑**（都写在这里，因为它们不是"少做"而是"做错"）：
//     ① 原文写「有40%[tips_2]」——**没有「概率」二字**（tips_2 本身就是「基础概率」），
//        第一版正则要求「概率」⇒ 永远匹配不到；
//     ② 这句**不在创建句里**（创建句只写到「创造存在2回合的神饮之宴结界，期间自身免疫[混乱]」），
//        第一版把它写在创建句分支里 ⇒ 同样永远匹配不到。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { loadTips, setTipsTable } from "../compile/tips.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { fieldTurnEnd, fieldTurnStart, fieldsOf, createField, clearField } from "../kernel/field.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const kb = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(kb) ? kb : (kb.characters ?? kb.items ?? []);
{
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
  setTipsTable(loadTips(Array.isArray(raw) ? raw : ((Object.values(raw).find((v: any) => Array.isArray(v)) as any[]) ?? [])));
}
const bear = LIST.find((s: any) => s.name === "神酿星熊童子");
const withBear = () => { const m: any = JSON.parse(JSON.stringify(canonicalMatch())); m.red.units[0].shikigamiId = bear.id; m.red.units[0].name = "神酿星熊童子"; return m; };
const run = async (match: any, seed = 20261001) => { const a: any = assembleMatch(createKit(bundle), match, { seed }); await a.battle.runStartup(); return a.battle; };

sec("[1] 解析：跨句 + 无「概率」二字（两处都是实测踩出来的）");
{
  const ir: any = compileSkill(bear.id, "神酿星熊童子", (bear.skills ?? []).find((k: any) => k.name === "饮过三巡"));
  const pt = ir.field?.perTurn;
  ok("★★★ 解析出第二种 perTurn（TURN_END + STATUS_APPLY）", pt?.trigger === "TURN_END" && pt?.kind === "STATUS_APPLY", JSON.stringify(pt));
  ok("★★★ [tips_103] 映射到了 StatusBook 的 id（混乱）", pt?.statusId === "confuse", String(pt?.statusId));
  ok("★★★ 概率 0.4（原文只写 40%[tips_2]，没有「概率」二字）", pt?.probability === 0.4, String(pt?.probability));
  ok("★★ 范围 = ALL（「敌我双方」）", pt?.scope === "ALL", String(pt?.scope));
  ok("★★ 证据句是**独立的那一句**，不是创建句", /回合结束/.test(pt?.evidence ?? "") && !/创造/.test(pt?.evidence ?? ""), String(pt?.evidence).slice(0, 40));
  let n = 0;
  for (const s of LIST) for (const sk of (s.skills ?? [])) { const i2: any = compileSkill(s.id, s.name, sk); if (i2.field?.perTurn) n++; }
  ok("★★ 全库带 perTurn 的技能 3 条（第 124/125/126 轮各一条）", n === 3, String(n));
}

sec("[2] 运行时：回合结束按 40% 施加状态（双方都算）");
{
  const b = await run(withBear());
  const me = b.teams[0].members[0];
  const skill = me.skills.find((s: any) => s.name === "饮过三巡");
  ok("前置：换上场后带着「饮过三巡」", !!skill, JSON.stringify(me.skills.map((s: any) => s.name)));
  if (skill) {
    await skill.execute(b, me, b.enemiesOf(me.teamId)[0]);
    ok("★★★ 场地创建成功", b.trace.some((e: any) => e.t === "FIELD_ENTER"));
    ok("★★★ perTurn 进档（暂停→存档→续跑不丢）", fieldsOf(b)[0]?.perTurn?.statusId === "confuse", JSON.stringify(fieldsOf(b)[0]?.perTurn));
    let fired = 0;
    const N = 200;
    const all = [...b.teams[0].members, ...b.teams[1].members];
    for (let i = 0; i < N; i++) fired += fieldTurnEnd(b, all[i % all.length]);
    const rows = b.trace.filter((e: any) => e.t === "FIELD_PER_TURN" && e.status === "confuse");
    ok("★★★ " + N + " 次回合结束产生 " + N + " 条记录（含未命中，否则 40% 无法被验证）", rows.length === N, String(rows.length));
    const sigma = Math.sqrt(N * 0.4 * 0.6);
    ok("★★★ 触发次数落在 40%±5σ 区间（n=" + N + "，σ≈" + sigma.toFixed(1) + "）",
      fired > 0.4 * N - 5 * sigma && fired < 0.4 * N + 5 * sigma, String(fired));
    const confused = all.filter((u: any) => u.hasStatus("confuse")).length;
    ok("★★★ 状态真的挂上了（至少 1 个单位带着「混乱」）", confused >= 1, String(confused));
    await b.drainEvents();
    ok("★★ 施加状态同时发事件（第 122 轮的 STATUS_ADD 队列 —— 两条接线在这里合流）",
      b.bus.chain.filter((x: any) => x.code === "STATUS_ADD").length >= confused);
  }
}

sec("[3] 两个触发时机互不串场");
{
  const b = await run(withBear());
  const me = b.teams[0].members[0];
  const skill = me.skills.find((s: any) => s.name === "饮过三巡");
  if (skill) {
    await skill.execute(b, me, b.enemiesOf(me.teamId)[0]);
    const before = b.trace.filter((e: any) => e.t === "FIELD_PER_TURN").length;
    fieldTurnStart(b, me);
    ok("★★★ TURN_END 的效果**不会**在 TURN_START 触发", b.trace.filter((e: any) => e.t === "FIELD_PER_TURN").length === before);
    /** ★ 先把「饮过三巡」那个 ALL 范围的场地清掉 —— 否则它会同时命中，把范围过滤的判据搅浑（第一版就踩了） */
    for (const st of [...fieldsOf(b)]) clearField(b, st, "TEST_RESET");
    ok("前置：场地已清空", fieldsOf(b).length === 0, String(fieldsOf(b).length));
    const spec: any = { kind: "ILLUSION", name: "探查幻境", duration: 2, durationSource: "CLAUSE", auras: [], perTurn: { trigger: "TURN_END", scope: "ALLY", kind: "STATUS_APPLY", statusId: "stun", duration: 1, probability: null, evidence: "单元测试" }, evidence: "单元测试" };
    createField(b, b.teams[1].members[0], spec);
    const n = fieldTurnEnd(b, me);
    ok("★★ 范围过滤：ALLY 场地对**敌方**单位不结算", n === 0, String(n));
    ok("★★ probability=null 时必触发", fieldTurnEnd(b, b.teams[1].members[0]) === 1);
    ok("★★ 查不到定义的 statusId 什么都不做（编译器那边已记账）", (() => {
      const bad: any = { kind: "ILLUSION", name: "坏幻境", duration: 1, durationSource: "CLAUSE", auras: [], perTurn: { trigger: "TURN_END", scope: "ALL", kind: "STATUS_APPLY", statusId: "no_such", probability: null, evidence: "x" }, evidence: "x" };
      const f = createField(b, me, bad);
      return f ? fieldTurnEnd(b, me) === 0 : false;
    })());
  }
}

sec("[4] 确定性：同一 seed 两次，施加次数与整场指纹一致");
{
  const a1 = await run(withBear(), 777);
  const a2 = await run(withBear(), 777);
  const s1 = a1.teams[0].members[0].skills.find((s: any) => s.name === "饮过三巡");
  const s2 = a2.teams[0].members[0].skills.find((s: any) => s.name === "饮过三巡");
  if (s1 && s2) {
    await s1.execute(a1, a1.teams[0].members[0], a1.enemiesOf(0)[0]);
    await s2.execute(a2, a2.teams[0].members[0], a2.enemiesOf(0)[0]);
    let f1 = 0, f2 = 0;
    for (const u of a1.teams[0].members) f1 += fieldTurnEnd(a1, u);
    for (const u of a2.teams[0].members) f2 += fieldTurnEnd(a2, u);
    ok("★★★ 同一 seed 两次的施加次数完全相同", f1 === f2, f1 + " vs " + f2);
    ok("★★ 整场指纹相同", stateHash(captureState(a1)) === stateHash(captureState(a2)));
  }
}

console.log("\n=== 场地回合结束效果: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;