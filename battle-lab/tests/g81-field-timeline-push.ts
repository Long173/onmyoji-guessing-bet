// tests/g81-field-timeline-push.ts — ★★★ 第 126 轮：场地的**拉条**形状（第三种每回合效果）
//
// 稻荷神御馔津「狐狩·日曜界」：「每当友方回合结束后，使行动条**最前端**的另一友方增加20%行动条」。
// ★ 同一位式神的「月影界」写的是「敌方回合结束后…攻击该敌方」——那是**另一种形状**（还没建模），
//   所以解析必须要求句子里有「友方」且**没有「敌方」**，否则两条技能会被解析成同一个 perTurn。本测试把这条钉住。
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
const inari = LIST.find((s: any) => s.name === "稻荷神御馔津");
const withInari = () => { const m: any = JSON.parse(JSON.stringify(canonicalMatch())); m.red.units[0].shikigamiId = inari.id; m.red.units[0].name = "稻荷神御馔津"; return m; };
const run = async (match: any, seed = 20261001) => { const a: any = assembleMatch(createKit(bundle), match, { seed }); await a.battle.runStartup(); return a.battle; };

sec("[1] 解析：只认「友方…行动条…增加N%」那一句（月影界那种决不能被当成同一个形状）");
{
  const irDay: any = compileSkill(inari.id, "稻荷神御馔津", (inari.skills ?? []).find((k: any) => k.name === "狐狩·日曜界"));
  const pt = irDay.field?.perTurn;
  ok("★★★ 日曜界解析出 TIMELINE_PUSH", pt?.kind === "TIMELINE_PUSH" && pt?.trigger === "TURN_END", JSON.stringify(pt));
  ok("★★★ 拉动 20% / 范围 ALLY / 无概率（必触发）", pt?.percent === 20 && pt?.scope === "ALLY" && pt?.probability === null, JSON.stringify(pt));
  const irMoon: any = compileSkill(inari.id, "稻荷神御馔津", (inari.skills ?? []).find((k: any) => k.name === "狐狩·月影界"));
  ok("★★★ 月影界（敌方回合结束后攻击）**没有**被解析成 TIMELINE_PUSH", irMoon.field?.perTurn?.kind !== "TIMELINE_PUSH", JSON.stringify(irMoon.field?.perTurn));
  ok("★★ 它仍然被逐句记账（FIELD_PER_TURN_NOT_MODELED）", (irMoon.formSkips ?? []).some((x: any) => x.reason === "FIELD_PER_TURN_NOT_MODELED"), JSON.stringify((irMoon.formSkips ?? []).map((x: any) => x.reason)));
  let n = 0;
  for (const s of LIST) for (const sk of (s.skills ?? [])) { const i2: any = compileSkill(s.id, s.name, sk); if (i2.field?.perTurn) n++; }
  ok("★★ 全库带 perTurn 的技能 3 条（三种形状各一条）", n === 3, String(n));
}

sec("[2] 运行时：把**行动条最前端**的另一友方拉 20%");
{
  const b = await run(withInari());
  const me = b.teams[0].members[0];
  const skill = me.skills.find((s: any) => s.name === "狐狩·日曜界");
  ok("前置：换上场后带着「狐狩·日曜界」", !!skill, JSON.stringify(me.skills.map((s: any) => s.name)));
  if (skill) {
    await skill.execute(b, me, b.enemiesOf(me.teamId)[0]);
    ok("★★★ 结界创建成功", b.trace.some((e: any) => e.t === "FIELD_ENTER"));
    const mates = b.teams[0].members.filter((m: any) => m.alive && m.id !== me.id);
    const front = [...mates].sort((a: any, c: any) => (b.timeline.get(c.id)?.pos ?? 0) - (b.timeline.get(a.id)?.pos ?? 0))[0];
    const posBefore = b.timeline.get(front.id)?.pos ?? 0;
    const meBefore = b.timeline.get(me.id)?.pos ?? 0;
    const fired = fieldTurnEnd(b, me);
    ok("★★★ 触发一次", fired === 1, String(fired));
    const row = b.trace.filter((e: any) => e.t === "FIELD_PER_TURN" && e.effect === "TIMELINE_PUSH").pop();
    ok("★★★ 目标是**行动条最前端**的那位友方（不是随便一个）", row?.target === front.id, JSON.stringify({ picked: row?.target, expected: front.id }));
    ok("★★★ 它的位置真的增加了（moved > 0 且 pos 变大）", (b.timeline.get(front.id)?.pos ?? 0) > posBefore && (row?.moved ?? 0) > 0,
      posBefore + " → " + (b.timeline.get(front.id)?.pos ?? 0) + "（moved=" + row?.moved + "）");
    ok("★★★ **行动者自己**没有被拉（「另一友方」）", (b.timeline.get(me.id)?.pos ?? 0) === meBefore, meBefore + " → " + (b.timeline.get(me.id)?.pos ?? 0));
    ok("★★ trace 里写明了 before/after 与百分比（Inspector 不用猜）", row?.percent === 20 && row?.posBefore === posBefore);
  }
}

sec("[3] 边界：没有其他存活友方时不动，且**要留痕**");
{
  const b = await run(withInari());
  const me = b.teams[0].members[0];
  for (const st of [...fieldsOf(b)]) clearField(b, st, "RESET");
  createField(b, me, { kind: "BARRIER", name: "探查结界", duration: 3, durationSource: "CLAUSE", auras: [], perTurn: { trigger: "TURN_END", scope: "ALLY", kind: "TIMELINE_PUSH", percent: 20, probability: null, evidence: "单元测试" }, evidence: "单元测试" } as any);
  for (const m of b.teams[0].members) if (m.id !== me.id) m.alive = false;
  const before = b.trace.length;
  const fired = fieldTurnEnd(b, me);
  const rows = b.trace.slice(before).filter((e: any) => e.t === "FIELD_PER_TURN" && e.effect === "TIMELINE_PUSH");
  ok("★★★ 只剩自己时一次都不触发（fired=0）", fired === 0, String(fired));
  ok("★★★ 但仍然写了一条 trace（target=null）—— 「没有目标」与「没触发」必须分得开",
    rows.length === 1 && rows[0].target === null, JSON.stringify(rows.map((r: any) => r.target)));
  ok("★★ 两个触发时机互不串场：TURN_START 不结算这条 TURN_END 效果", fieldTurnStart(b, me) === 0);
}

sec("[4] 确定性：同一 seed 两次的拉动量一致");
{
  const a1 = await run(withInari(), 4242);
  const a2 = await run(withInari(), 4242);
  const s1 = a1.teams[0].members[0].skills.find((s: any) => s.name === "狐狩·日曜界");
  const s2 = a2.teams[0].members[0].skills.find((s: any) => s.name === "狐狩·日曜界");
  if (s1 && s2) {
    await s1.execute(a1, a1.teams[0].members[0], a1.enemiesOf(0)[0]);
    await s2.execute(a2, a2.teams[0].members[0], a2.enemiesOf(0)[0]);
    let f1 = 0, f2 = 0;
    for (let i = 0; i < 5; i++) { f1 += fieldTurnEnd(a1, a1.teams[0].members[i % 5]); f2 += fieldTurnEnd(a2, a2.teams[0].members[i % 5]); }
    ok("★★★ 同一 seed 两次的触发次数与位置完全一致", f1 === f2 && JSON.stringify(a1.timeline.all().map((e: any) => [e.id, Math.round(e.pos * 1e6)])) === JSON.stringify(a2.timeline.all().map((e: any) => [e.id, Math.round(e.pos * 1e6)])), f1 + " vs " + f2);
    ok("★★ 整场指纹相同", stateHash(captureState(a1)) === stateHash(captureState(a2)));
  }
}

console.log("\n=== 场地拉条效果: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;