// tests/g64-buff-steal.ts — ★★★ 第 104 轮：**增益偷取**（把状态搬走）（目标 ⑨）
//
// 与属性偷取（g60）刻意分开：两者都叫「偷取」，但原文决定的语义完全不同 ——
//   · 属性偷取：按比例取走一个**数值**，持续 N 回合后**归还**（有借据）；
//   · 增益偷取：「偷取1个增益状态」—— 把目标身上的一个**状态**搬到自己身上，**不归还**。
// 全库只有 1 条（饿鬼「臭馒头」：造成攻击100%伤害并有20%概率偷取1个增益状态）。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { compileSkill } from "../compile/skill-compiler.ts";
import { loadTips, setTipsTable } from "../compile/tips.ts";
import { stealBuff } from "../kernel/steal.ts";
import { StatusBook } from "../kernel/status.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);
{
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
  const list = Array.isArray(raw) ? raw : (Object.values(raw).find((v: any) => Array.isArray(v)) as any[]) ?? [];
  setTipsTable(loadTips(list));
}
const sk = (t: string) => compileSkill(1, "T", { id: "1_01", name: "S", cost: 5, description: t, brief: "", upgrades: [] }) as any;

sec("[1] 解析：只有一条真写法，而且它必须与「属性偷取」分得开")
{
  const hits: Array<{ who: string; ir: any }> = [];
  for (const s of LIST) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      const ir: any = compileSkill(s.id, s.name, k);
      if ((ir.steals ?? []).some((x: any) => x.buffSteal)) hits.push({ who: s.name + "「" + k.name + "」", ir });
    }
  }
  ok("★★★ 全库恰好 1 条技能带增益偷取（不是 0 条而显得干净）", hits.length === 1, JSON.stringify(hits.map(h => h.who)));
  ok("★★★ 而且就是饿鬼「臭馒头」", hits[0]?.who === "饿鬼「臭馒头」", String(hits[0]?.who));
  const bs = hits[0].ir.steals.find((x: any) => x.buffSteal);
  ok("★★★ 读成 buffSteal{count:1, what:BUFF}，**不是**属性偷取那套 prop/ratio",
    bs.buffSteal.count === 1 && bs.buffSteal.what === "BUFF" && !bs.prop && !bs.options, JSON.stringify(bs));
  ok("★★ 概率写在本技能的另一句里（20%概率偷取…）⇒ 由属性那套的 pm 收不到它，如实为空",
    bs.probability === null, String(bs.probability));
}

sec("[2] ★★★ 双向：能读的写法必须收，读不出的必须给理由")
{
  ok("★★★ 真写法①「偷取1个增益状态」→ 收成 buffSteal(BUFF,1)",
    sk("造成攻击100%伤害并有20%概率偷取1个增益状态").steals?.some((x: any) => x.buffSteal?.what === "BUFF"));
  ok("★★★ 真写法②「偷取2个减益状态」→ 收成 DEBUFF,2（不是只认增益）",
    sk("偷取2个减益状态").steals?.some((x: any) => x.buffSteal?.what === "DEBUFF" && x.buffSteal?.count === 2));
  ok("★★★ 对照：属性偷取**不走** buffSteal 这条路（两者不能混）",
    !sk("偷取目标40%暴击，持续1回合").steals?.some((x: any) => x.buffSteal) &&
    !!sk("偷取目标40%暴击，持续1回合").steals?.some((x: any) => x.prop === "cri"));
  /**
   * ★★★ 第 105 轮：这条断言**按事实改写**（与 g60 §3 同一处变化）——
   *   「造成伤害时」现在**收**（由被动运行时在 AFTER_DAMAGE 执行），但必须带 trigger=ON_DAMAGE；
   *   真正仍然不收的是「**受到**伤害时…偷取」（挨打触发没有执行点）。
   */
  const dmgTrigger = sk("造成伤害时，偷取1个增益状态");
  ok("★★★ 造成伤害时触发的增益偷取 → 收，且带 trigger=ON_DAMAGE",
    dmgTrigger.steals?.length === 1 && dmgTrigger.steals[0].trigger === "ON_DAMAGE" && !!dmgTrigger.steals[0].buffSteal,
    JSON.stringify(dmgTrigger.steals));
  const takeTrigger = sk("受到伤害时，偷取1个增益状态");
  ok("★★★ 假写法：「受到伤害时…偷取」→ 仍然不收（ON_TAKE_DAMAGE_TRIGGER）",
    !takeTrigger.steals && (takeTrigger.stealSkips ?? []).some((x: any) => x.reason === "ON_TAKE_DAMAGE_TRIGGER"),
    JSON.stringify(takeTrigger.stealSkips));
}

sec("[3] ★★★ 运行时：状态被**搬走**（含层数与剩余回合），而且不归还")
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261201 });
  await a.battle.runStartup();
  const b = a.battle;
  const thief = b.teams[0].members[0], victim = b.teams[1].members[0];
  const buff = StatusBook.get("freeze")!;
  const def = { ...buff, id: "probe_buff_x", name: "探查·增益", category: "BUFF_MARK" as any, immuneTo: null, preventsAction: false };
  victim.addStatus(def as any, 999, 2, 3);
  const before = { thief: thief.statuses.length, victim: victim.statuses.length };
  const r = stealBuff(b, thief, victim, { buffSteal: { count: 1, what: "BUFF" } });
  ok("★★★ 偷取成功，并且报出偷到了什么", r.applied === true && r.stolen.length === 1 && r.stolen[0] === "probe_buff_x", JSON.stringify(r));
  ok("★★★ 目标身上**没有了**、偷取者身上**有了**（一进一出，人数守恒）",
    victim.statuses.length === before.victim - 1 && thief.statuses.length === before.thief + 1,
    JSON.stringify([before, { thief: thief.statuses.length, victim: victim.statuses.length }]));
  const moved = thief.statuses.find((s: any) => s.def.id === "probe_buff_x")!;
  ok("★★★ 搬的是**整个状态**：层数与剩余回合都跟着走（不是重新施加一个 1 层 1 回合的）",
    moved.stacks === 2 && moved.remaining === 3, JSON.stringify({ stacks: moved.stacks, remaining: moved.remaining }));
  ok("★★ 来源 id 保持原样（时长按来源回合算，官方[15]）", moved.sourceId === 999, String(moved.sourceId));
  ok("★★★ **不归还**：没有任何「借据」状态被建出来（与属性偷取相反）",
    !thief.statuses.some((s: any) => String(s.def.id).startsWith("steal_up_")) &&
    !victim.statuses.some((s: any) => String(s.def.id).startsWith("steal_down_")));
  ok("★ 事件链留痕 STATUS_STEAL（含挑选顺序的依据与 sourceId 的说明）",
    b.trace.some((t: any) => t.t === "STATUS_STEAL" && t.count === 1 && /挂载顺序/.test(String(t.order ?? ""))));

  // 反向：没有候选时要有理由，而不是静默什么都不做
  const bare: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 7 });
  await bare.battle.runStartup();
  const r2 = stealBuff(bare.battle, bare.battle.teams[0].members[1], bare.battle.teams[1].members[1], { buffSteal: { count: 1, what: "BUFF" } });
  ok("★★★ 反向：目标身上没有任何增益 ⇒ 明确报 NO_CANDIDATE", r2.applied === false && r2.reason === "NO_CANDIDATE", JSON.stringify(r2));

  // 反向：不可驱散的状态搬不走（与驱散同一条判据）
  const frozen = StatusBook.get("stun")!;   // 眩晕：不可驱散
  const t3 = bare.battle.teams[1].members[2];
  t3.addStatus({ ...frozen, id: "probe_stun_x", name: "探查·眩晕" } as any, 999, 1, 3);
  const r3 = stealBuff(bare.battle, bare.battle.teams[0].members[2], t3, { buffSteal: { count: 1, what: "BUFF" } });
  ok("★★★ 不可驱散的状态搬不走（判据与驱散同源，不是另造一套）", r3.applied === false && r3.reason === "NO_CANDIDATE", JSON.stringify(r3));
}

console.log(`\n=== 增益偷取: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
