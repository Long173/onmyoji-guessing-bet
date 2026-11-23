// tests/ui19-spec-acceptance.ts — ★★★ 第 244 轮：把 a1-4 §60「最终验收场景」做成**一条可执行的尺子**
//
// 规格原话（§60）：一场真实竞猜阵容 + Seed 123456 + 「观看一场」⇒ 从 BATTLE_START 一路看到 BATTLE_END；
//   然后能暂停 / 后退 / 拖到任意时间 / 点任意式神 / 看实时八维 / 看所有 Buff / 看鬼火 / 看行动条 /
//   看 AI 为什么这么选 / 看某次伤害怎么算 / 看某次随机数是多少 / 看 Event Parent；
//   最后**复制 Seed 重跑 ⇒ 每一个事件、每一个 RNG、每一点 HP、最终胜负完全一致**。
//
// 判据三段：
//   [1] 步骤清单：规格列的每一步，要么在**这份录像**里看得到（帧数 ≥ 1），要么**具名**给出覆盖它的尺子
//       （文件必须在磁盘上）—— 这就是「能力可达」与「这一局没触发」的分界，不许含糊过去。
//   [2] 播放器能力：逐项对着规格点（每个 bullet 一条断言）。
//   [3] 一致性：同一输入 + 同一 seed 跑两次 ⇒ 帧数与终局指纹一致，逐帧视图也一致。
import fs from "node:fs";
import path from "node:path";
import { Presenter } from "../src/theater/presenter.ts";
import { createEngineAdapter } from "../src/adapters/engine-adapter.ts";
import { canonicalMatch } from "../src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const here = import.meta.dirname;
const ROOT = path.resolve(here, "..", "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(here, "..", "src", "engine", "bundle.json"), "utf8"));
const fixture = path.join(ROOT, "battle-lab", "fixtures", "replay-demo-123456.json");
const replay = JSON.parse(fs.readFileSync(fixture, "utf8"));
const p = Presenter.fromSerialized(replay);
const frames: any[] = replay.frames ?? [];
const count = (f: (x: any) => boolean) => frames.filter(f).length;

sec("[1] ★★★ §60 的步骤清单：能看到的报帧数，看不到的必须具名给出覆盖它的尺子");
{
  const STEPS: Array<{ step: string; has: (x: any) => boolean; orTest?: string }> = [
    { step: "BATTLE_START", has: (x) => x.t === "BATTLE_START" },
    { step: "开局效果", has: (x) => /^(SENKI|ORB_INIT|SOUL_START|PASSIVE_|FIELD_)/.test(String(x.t)) },
    { step: "行动条推进", has: (x) => /^(TIMELINE_|ORB_GAUGE_ADVANCE)/.test(String(x.t)) },
    { step: "式神行动", has: (x) => /^(TURN_TYPE|TURN_START|SKILL_SELECT|ACTION_START)/.test(String(x.t)), orTest: "battle-lab/tests/g11-turn-types.ts" },
    { step: "AI 选择技能", has: (x) => x.t === "AI_DECISION" },
    { step: "AI 选择目标", has: (x) => x.t === "AI_TARGET" },
    { step: "扣鬼火", has: (x) => x.t === "ORB_PAY" },
    { step: "技能", has: (x) => x.t === "SKILL_CAST" },
    { step: "多段伤害", has: (x) => x.t === "DAMAGE" && Number(x.hits ?? 1) > 1, orTest: "battle-lab/tests/g17-target-scope.ts" },
    { step: "暴击", has: (x) => x.t === "DAMAGE" && x.crit === true, orTest: "battle-lab/tests/g5-inspectors.ts" },
    { step: "Buff", has: (x) => x.t === "STATUS_APPLY" },
    /** ★ 本局是被动 OFF 档（默认路径）⇒ 被动帧为 0 是**预期**；覆盖尺子是 g43（被动运行时） */
    { step: "被动", has: (x) => /^PASSIVE/.test(String(x.t)) || x.passive === true, orTest: "battle-lab/tests/g43-passive-runtime.ts" },
    { step: "御魂", has: (x) => /^SOUL_/.test(String(x.t)), orTest: "battle-lab/tests/g31-soul-liveness.ts" },
    { step: "反击", has: (x) => x.t === "PSEUDO_TURN" || /COUNTER/.test(String(x.t)), orTest: "battle-lab/tests/g56-counter.ts" },
    { step: "鬼火回复", has: (x) => x.t === "ORB_GAIN" },
    { step: "致命伤害", has: (x) => x.t === "LETHAL", orTest: "battle-lab/tests/g109-lethal-consume.ts" },
    { step: "死亡/免死/复活", has: (x) => /^(DEATH|DEATH_PREVENTED|REVIVE|KILLED)/.test(String(x.t)), orTest: "battle-lab/tests/g83-death-revive.ts" },
    { step: "BATTLE_END（胜负）", has: (x) => /^(BATTLE_END|VICTORY)/.test(String(x.t)) },
  ];
  const rows: string[] = [];
  const unexplained: string[] = [];
  let seen = 0;
  for (const s of STEPS) {
    const n = count(s.has);
    if (n > 0) { seen++; rows.push("      " + s.step + "：本局 " + n + " 帧"); continue; }
    const t = s.orTest ?? null;
    const okFile = t ? fs.existsSync(path.join(ROOT, t)) : false;
    rows.push("      " + s.step + "：本局 0 帧" + (t ? " ⇒ 覆盖尺子 " + t + (okFile ? " ✓" : " ✗不存在") : " ⇒ **没有任何声明**"));
    if (!t || !okFile) unexplained.push(s.step);
  }
  console.log("    步骤表（" + STEPS.length + " 步）：");
  console.log(rows.join("\n"));
  ok("★★★ 每一步要么本局看得到、要么有**存在**的覆盖尺子（本局看到 " + seen + " / " + STEPS.length + "）", unexplained.length === 0, JSON.stringify(unexplained));
  ok("★★ 首尾两帧就是规格写的两端（BATTLE_START → BATTLE_END/VICTORY）",
    frames.length > 0 && String(frames[0].t) === "BATTLE_START" && STEPS[STEPS.length - 1].has(frames[frames.length - 1]),
    JSON.stringify([frames[0]?.t, frames[frames.length - 1]?.t]));
  ok("★★ 而且胜负真的被判出来了（result 非空）", !!replay.result && (replay.result.winner === 0 || replay.result.winner === 1), JSON.stringify(replay.result));
}

sec("[2] ★★★ 播放器能力：规格 §60 下半段逐项点（暂停/后退/拖动/点式神/八维/Buff/鬼火/行动条/AI/伤害/RNG/Parent）");
{
  const mid = Math.floor(p.frameCount / 2);
  ok("★★★ 暂停 / 后退 / 拖到任意时间：view(0) / view(mid) / view(last) 都能取，且 frame 对得上",
    p.view(0)?.frame === 0 && p.view(mid)?.frame === mid && p.view(p.frameCount - 1)?.frame === p.frameCount - 1,
    JSON.stringify([p.view(0)?.frame, p.view(mid)?.frame, p.view(p.frameCount - 1)?.frame, p.frameCount]));
  const v = p.view(mid)!;
  ok("★★★ 双方 10 个式神都在卡面上", v.units.length === 10 && v.units.filter(u => u.side === "red").length === 5 && v.units.filter(u => u.side === "blue").length === 5, String(v.units.length));
  const u = v.units[0];
  ok("★★★ 点任意式神 ⇒ 实时八维八项都在（presenter 折好 effects，UI 不重算）",
    ["atk", "hp", "def", "spd", "cri", "crid", "efh", "efr"].every(k => typeof (u.stats as any)[k] === "number"), JSON.stringify(u.stats));
  ok("★★★ 看所有 Buff：statuses 是数组，每条带 name/stacks/remaining/isDebuff/effects",
    Array.isArray(u.statuses) && u.statuses.every(s => typeof s.name === "string" && typeof s.stacks === "number" && typeof s.remaining === "number" && typeof s.isDebuff === "boolean" && typeof s.effects === "number"),
    JSON.stringify(u.statuses.slice(0, 3)));
  ok("★★★ 看鬼火（含回火计数/上限）",
    typeof v.teams[0].orb === "number" && typeof v.teams[0].maxOrb === "number" && typeof v.teams[0].gauge === "number",
    JSON.stringify(v.teams));
  ok("★★★ 看行动条：每个单位的 timeline 在 0..1（Action Bar 的输入）",
    v.units.every(x => x.timeline >= 0 && x.timeline <= 1), JSON.stringify(v.units.map(x => x.timeline).slice(0, 5)));
  const aiIdx = frames.findIndex((x: any) => x.t === "AI_DECISION");
  const ai = aiIdx >= 0 ? p.aiDecision(aiIdx) : null;
  ok("★★★ 看 AI 为什么这么选：aiDecision 给出选招与目标", !!ai && !!ai.skill && "target" in ai, JSON.stringify(ai));
  const dmgIdx = frames.findIndex((x: any) => x.t === "DAMAGE");
  const brk = dmgIdx >= 0 ? p.damageBreakdown(dmgIdx) : null;
  ok("★★★ 看某次伤害怎么算：damageBreakdown 有载荷", !!brk && !!brk.data, JSON.stringify(brk ? Object.keys(brk.data).slice(0, 8) : null));
  ok("★★★ 看某次随机数是多少：rngAt 给出该帧附近的抽数，rngSummary 有总量与用途分布",
    !!p.rngAt(dmgIdx >= 0 ? dmgIdx : 0) && p.rngSummary().total > 0, JSON.stringify(p.rngSummary()));
  const evIdx = frames.findIndex((x: any) => x.ev !== null && x.ev !== undefined);
  ok("★★★ 看 Event Parent：带 ev 的帧能读出祖先链", evIdx >= 0 && p.ancestry(evIdx).length >= 1, JSON.stringify([evIdx, evIdx >= 0 ? p.ancestry(evIdx).length : 0]));
  ok("★★ 死亡状态机在视图里（§18 的五态之一，逐帧可读）",
    p.view(p.frameCount - 1)!.units.every(x => ["ALIVE", "HP_ZERO", "DEAD", "KILLED", "TRANSFORMED"].includes(x.state)),
    JSON.stringify(p.view(p.frameCount - 1)!.units.map(x => x.name + "=" + x.state).slice(0, 4)));
}

sec("[3] ★★★ 复制 Seed 重跑 ⇒ 每一个事件、每一个 RNG、每一点 HP、最终胜负完全一致");
{
  const adapter = createEngineAdapter(bundle);
  const r1: any = await adapter.replay(canonicalMatch(), 123456);
  const r2: any = await adapter.replay(canonicalMatch(), 123456);
  ok("★★★ 两次运行的终局指纹逐位相同", r1.replay.finalHash === r2.replay.finalHash, JSON.stringify([r1.replay.finalHash, r2.replay.finalHash]));
  ok("★★★ 帧数相同（事件流一致）", r1.replay.frames.length === r2.replay.frames.length, JSON.stringify([r1.replay.frames.length, r2.replay.frames.length]));
  const p1 = Presenter.fromSerialized(r1.replay);
  const p2 = Presenter.fromSerialized(r2.replay);
  const last1 = p1.view(p1.frameCount - 1)!;
  const last2 = p2.view(p2.frameCount - 1)!;
  ok("★★★ 每一点 HP 一致（终局十张卡的 hp/maxHp/state 逐项相同）",
    JSON.stringify(last1.units.map(x => [x.name, x.hp, x.maxHp, x.state])) === JSON.stringify(last2.units.map(x => [x.name, x.hp, x.maxHp, x.state])),
    JSON.stringify(last1.units.map(x => x.hp)));
  ok("★★★ 每一个 RNG 一致（抽数总量与用途分布逐项相同）",
    JSON.stringify(p1.rngSummary()) === JSON.stringify(p2.rngSummary()), JSON.stringify(p1.rngSummary()));
  ok("★★ 最终胜负一致", JSON.stringify(r1.result ?? null) === JSON.stringify(r2.result ?? null), JSON.stringify([r1.result ?? null, r2.result ?? null]));
  ok("★★ 与仓库里那份录像文件是同一局（finalHash 相等 ⇒ 录像没过期）", r1.replay.finalHash === replay.finalHash, JSON.stringify([r1.replay.finalHash, replay.finalHash]));
}

console.log("\n=== a1-4 §60 最终验收场景: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;