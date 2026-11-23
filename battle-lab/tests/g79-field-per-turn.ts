// tests/g79-field-per-turn.ts — ★★★ 第 124 轮：场地里的**每回合效果**（第 115 轮明说"没有行为代码"的那一块）
//
// 由来：第 115 轮把场地（幻境 / 结界）的**存在性 + 持续时间 + 静态光环**做完了，并在文件头写明：
//   「场地里那些每回合触发/条件触发的效果仍然没有行为代码」。这一轮补第一种形状：
//   辉夜姬「龙首之玉」的「且在回合开始前有67%概率获得1点鬼火」（全库**唯一**一条这个写法）。
//   ★ 概率只在**这一段**里读：创建动词后面的概率属于每回合效果，不属于创建（第 115 轮在这里读错过一次）。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { loadTips, setTipsTable } from "../compile/tips.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { fieldTurnStart, fieldsOf, createField } from "../kernel/field.ts";

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
const kaguya = LIST.find((s: any) => s.name === "辉夜姬");
const withKaguya = () => { const m: any = JSON.parse(JSON.stringify(canonicalMatch())); m.red.units[0].shikigamiId = kaguya.id; m.red.units[0].name = "辉夜姬"; return m; };
const run = async (match: any, seed = 20261001, passives?: any) => {
  const a: any = assembleMatch(createKit(bundle), match, { seed, ...(passives ? { passives } : {}) });
  await a.battle.runStartup();
  return a.battle;
};

sec("[1] 解析：全库唯一一条这个写法，概率读在**每回合那一段**里");
{
  const ir: any = compileSkill(kaguya.id, "辉夜姬", (kaguya.skills ?? []).find((k: any) => k.name === "龙首之玉"));
  ok("★★★ 解析出 perTurn（第 115 轮这里是空的）", !!ir.field?.perTurn, JSON.stringify(ir.field?.perTurn));
  ok("★★★ 触发时机 = 回合开始，范围 = 友方（ALLY）", ir.field?.perTurn?.trigger === "TURN_START" && ir.field?.perTurn?.scope === "ALLY");
  ok("★★★ 概率 0.67 / 数量 1 点鬼火（不是「有67%概率开幻境」——那是第 115 轮读错的那个）",
    ir.field?.perTurn?.probability === 0.67 && ir.field?.perTurn?.amount === 1, JSON.stringify(ir.field?.perTurn));
  ok("★★ 创建概率仍是 null（这一段里没有创建概率）", ir.field?.probability === null, String(ir.field?.probability));
  let n = 0;
  for (const s of LIST) for (const sk of (s.skills ?? [])) { const i2: any = compileSkill(s.id, s.name, sk); if (i2.field?.perTurn) n++; }
  //   ★★ 第 125/126 轮：1 → 2 → **3**（每轮接一种形状，见 tests/g80 / g81）。
  ok("★★ 全库带 perTurn 的技能 3 条（第 124/125/126 轮各接一种形状；其余形状仍然逐句记账）", n === 3, String(n));
}

sec("[2] 运行时：场地在场时，行动者回合开始按概率回火");
{
  const b = await run(withKaguya());
  const actor = b.teams[0].members[0];
  const skill = actor.skills.find((s: any) => s.name === "龙首之玉");
  ok("前置：换上场后带着「龙首之玉」", !!skill, JSON.stringify(actor.skills.map((s: any) => s.name)));
  if (skill) {
    await skill.execute(b, actor, b.enemiesOf(actor.teamId)[0]);
    ok("★★★ 场地创建成功（trace 里有 FIELD_ENTER）", b.trace.some((e: any) => e.t === "FIELD_ENTER"));
    ok("★★★ 而且 perTurn 随场地进了**状态档**（暂停→存档→续跑不会丢）",
      fieldsOf(b)[0]?.perTurn?.probability === 0.67, JSON.stringify(fieldsOf(b)[0]));
    const snap: any = captureState(b);
    ok("★★ 序列化后仍在（state.fields[0].perTurn）", snap.fields?.[0]?.perTurn?.amount === 1, JSON.stringify(snap.fields?.[0]?.perTurn));
    const before = b.trace.filter((e: any) => e.t === "FIELD_PER_TURN").length;
    /** N = 友方单位数 × 20（每个单位在自己回合开始时各掷一次） */
    const N = b.teams[0].members.length * 20;
    let fired = 0;
    for (const m of b.teams[0].members) for (let i = 0; i < 20; i++) fired += fieldTurnStart(b, m);
    const rows = b.trace.filter((e: any) => e.t === "FIELD_PER_TURN");
    ok("★★★ " + N + " 次回合开始产生了 " + N + " 条 FIELD_PER_TURN 记录（含没中的，否则 67% 无法被验证）",
      rows.length - before === N, String(rows.length - before));
    const sigma = Math.sqrt(N * 0.67 * 0.33);
    ok("★★★ 触发次数落在 67%±5σ 区间内（二项分布，n=" + N + "，σ≈" + sigma.toFixed(1) + "）",
      fired > 0.67 * N - 5 * sigma && fired < 0.67 * N + 5 * sigma, String(fired));
    /**
     * ★ 鬼火池有上限（8 点）：掷中之后要么进池（gained），要么**溢出**（overflow）——
     *   所以判据是 gained + overflow == 触发次数，而不是 gained == 触发次数（第一版写成后者，实测对不上）。
     */
    const gsum = rows.reduce((s: number, r: any) => s + (r.gained ?? 0), 0);
    const osum = rows.reduce((s: number, r: any) => s + (r.overflow ?? 0), 0);
    ok("★★ 每一次触发都真的产生了 1 点鬼火（进池 " + gsum + " + 溢出 " + osum + " == 触发 " + fired + "）",
      gsum + osum === fired && fired > 0, String(fired));
    await b.drainEvents();
    ok("★★ 触发时同时发事件（ORB_GAIN 进了总线 —— 复用第 120 轮的队列）",
      b.bus.chain.some((x: any) => x.code === "ORB_GAIN"));
  }
}
{
  const b = await run(withKaguya());
  const me = b.teams[0].members[0], enemy = b.teams[1].members[0];
  const spec: any = { kind: "ILLUSION", name: "探查幻境", duration: 3, durationSource: "CLAUSE", auras: [], perTurn: { trigger: "TURN_START", scope: "ENEMY", kind: "ORB_GAIN", amount: 2, probability: null, evidence: "单元测试" }, evidence: "单元测试" };
  createField(b, me, spec);
  const enemyBefore = b.teams[1].orbs.current;
  const n1 = fieldTurnStart(b, enemy);
  ok("★★★ ENEMY 范围：对手回合开始才结算（自己回合不结算）", n1 === 1 && fieldTurnStart(b, me) === 0, String(n1));
  ok("★★★ probability=null ⇒ 必触发（不是「掷不中」）", b.teams[1].orbs.current >= enemyBefore, enemyBefore + " → " + b.teams[1].orbs.current);
  const b2 = await run(withKaguya());
  const n2 = fieldTurnStart(b2, b2.teams[0].members[0]);
  ok("★★★ 没有场地时一次都不触发（不是「默认有效果」）", n2 === 0 && !b2.trace.some((e: any) => e.t === "FIELD_PER_TURN"), String(n2));
}

sec("[4] 确定性：同一 seed 两次，回火次数与指纹都一致");
{
  const a1 = await run(withKaguya(), 12345);
  const a2 = await run(withKaguya(), 12345);
  const s1 = a1.teams[0].members[0].skills.find((s: any) => s.name === "龙首之玉");
  const s2 = a2.teams[0].members[0].skills.find((s: any) => s.name === "龙首之玉");
  if (s1 && s2) {
    await s1.execute(a1, a1.teams[0].members[0], a1.enemiesOf(0)[0]);
    await s2.execute(a2, a2.teams[0].members[0], a2.enemiesOf(0)[0]);
    let f1 = 0, f2 = 0;
    for (const m of a1.teams[0].members) f1 += fieldTurnStart(a1, m);
    for (const m of a2.teams[0].members) f2 += fieldTurnStart(a2, m);
    ok("★★★ 同一 seed 两次的回火次数完全相同（掷数走 battle.rng + 稳定 tag）", f1 === f2, f1 + " vs " + f2);
    ok("★★ 而且整场指纹相同", stateHash(captureState(a1)) === stateHash(captureState(a2)));
  }
}

console.log("\n=== 场地每回合效果: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;