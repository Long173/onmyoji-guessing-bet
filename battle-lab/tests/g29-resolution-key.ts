// tests/g29-resolution-key.ts — ★ a1-4 §22：ResolutionKey 六级排序链
//
// 规格给的比较链（逐级下降）：
//   phase ↓ order ↓ priority DESC ↓ subOrder ↓ speed DESC ↓ seeded tieBreak
//
// 规格说明这一层的**用途**是：
//   「这样 B 组实测的结果只是：填阴阳师的 ResolutionKey 规则，而不是推翻 Engine。」
// 所以这个测试要证明两件事：
//   ① 六级链的**优先关系**真的按规格实现（高级压低级，每一级都能独立破平）；
//   ② 六个策略只填自己负责的级，其余留空 —— 尤其 UNDETERMINED **不许**偷偷填注册序号：
//      它的行为与"按注册序"相同，但键上必须诚实写着"没有裁决"。
import { EventBus, PriorityPolicies, compareResolutionKey, resolutionKeyOf } from "../kernel/events.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import fs from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

/** 造一个候选（只用到排序关心的字段） */
const H = (id: string, ownerId: number, priority = 0) => ({ id, ownerId, code: "X", range: "ALL", priority, passive: false, fn: () => {} }) as any;
const mkKey = (o: any) => ({ phase: 0, order: 0, priority: 0, subOrder: 0, speedOrder: undefined, tieBreak: 0, ...o });
const cmp = (a: any, b: any) => Math.sign(compareResolutionKey(mkKey(a), mkKey(b)));

sec("[1] ★★ 六级比较链的优先关系（高级必须压住低级）");
{
  ok("★ phase 最小者先", cmp({ phase: 0 }, { phase: 1 }) < 0);
  ok("★ order 最小者先", cmp({ order: 0 }, { order: 1 }) < 0);
  ok("★★ order 压住 priority：order 小但 priority 极低，仍然先",
    cmp({ order: 0, priority: 0 }, { order: 1, priority: 999 }) < 0);
  ok("★★ phase 压住 order", cmp({ phase: 0, order: 9 }, { phase: 1, order: 0 }) < 0);
  ok("★ priority 大者先（DESC）", cmp({ priority: 5 }, { priority: 1 }) < 0);
  ok("★★ priority 压住 subOrder 与 speed", cmp({ priority: 2, subOrder: 9, speedOrder: 0 }, { priority: 1, subOrder: 0, speedOrder: 999 }) < 0);
  ok("★ subOrder 小者先", cmp({ subOrder: 0 }, { subOrder: 1 }) < 0);
  ok("★★ subOrder 压住 speed", cmp({ subOrder: 0, speedOrder: 0 }, { subOrder: 1, speedOrder: 999 }) < 0);
  ok("★ speed 大者先（DESC）", cmp({ speedOrder: 200 }, { speedOrder: 100 }) < 0);
  ok("★★ speed 压住 tieBreak", cmp({ speedOrder: 200, tieBreak: 99 }, { speedOrder: 100, tieBreak: 0 }) < 0);
  ok("★ tieBreak 小者先（ASC，最终裁决）", cmp({ tieBreak: 1 }, { tieBreak: 7 }) < 0);
  ok("★ speedOrder 省略等价于 0", cmp({ speedOrder: undefined }, { speedOrder: 0 }) === 0);
  ok("★ 六级全等 → 返回 0（交给稳定排序，不伪造裁决）", cmp({}, {}) === 0);
}

sec("[2] ★★ resolutionKeyOf：基线 + 各策略只填自己负责的级");
{
  const ins = new Map<string, number>([["a", 3], ["b", 9]]);
  const ctx = { teamOf: (id: number) => (id >= 100 ? 1 : 0), speedOf: (id: number) => id % 100, actorTeam: 0 };
  const k = (id: string, ownerId: number, policyId: string, priority = 0) =>
    resolutionKeyOf(H(id, ownerId, priority), (PriorityPolicies as any)[policyId], ins, ctx);

  const base = k("a", 5, "UNDETERMINED", 7);
  ok("★★ 基线：priority 取自 handler，其余全 0", base.priority === 7 && base.phase === 0 && base.order === 0 && base.subOrder === 0 && base.tieBreak === 0 && (base.speedOrder ?? 0) === 0, JSON.stringify(base));
  ok("★★ UNDETERMINED 全留空 —— **不许**偷偷填注册序号冒充裁决", base.tieBreak === 0, JSON.stringify(base));

  const reg = k("b", 5, "REGISTRATION_ORDER");
  ok("★ REGISTRATION_ORDER 只填 tieBreak（= 注册序号），不碰速度/队伍", reg.tieBreak === 9 && (reg.speedOrder ?? 0) === 0 && reg.subOrder === 0, JSON.stringify(reg));

  const spd = k("a", 105, "SPEED_DESC");
  ok("★ SPEED_DESC 填 speedOrder（取自 ownerId 的速度）", spd.speedOrder === 5, JSON.stringify(spd));

  const tts = k("a", 105, "TEAM_THEN_SPEED");
  ok("★ TEAM_THEN_SPEED 填 subOrder(队伍) + speedOrder + tieBreak", tts.subOrder === 1 && tts.speedOrder === 5 && tts.tieBreak === 3, JSON.stringify(tts));

  ok("★★ SELF_SIDE_FIRST：行动方一侧记 0，对方记 1", k("a", 5, "SELF_SIDE_FIRST").subOrder === 0 && k("a", 105, "SELF_SIDE_FIRST").subOrder === 1);
  ok("★★ OTHER_SIDE_FIRST：正好相反", k("a", 5, "OTHER_SIDE_FIRST").subOrder === 1 && k("a", 105, "OTHER_SIDE_FIRST").subOrder === 0);
  ok("★ 没有 actorTeam 上下文时 side 策略一律 0（= 不表态，而不是猜一个）",
    resolutionKeyOf(H("a", 5), (PriorityPolicies as any).SELF_SIDE_FIRST, ins, undefined).subOrder === 0);
}

sec("[3] ★★ 排序语义（合成候选集，断言精确顺序）");
{
  const ins = new Map<string, number>();
  const hs = [H("h0", 5, 0), H("h1", 105, 0), H("h2", 7, 0)];
  hs.forEach((h, i) => ins.set(h.id, i));
  const ctx = { teamOf: (id: number) => (id >= 100 ? 1 : 0), speedOf: (id: number) => (id >= 100 ? 200 : 100), actorTeam: 0 };
  const order = (policyId: string) => {
    const p = (PriorityPolicies as any)[policyId];
    return [...hs].sort((a, b) => compareResolutionKey(resolutionKeyOf(a, p, ins, ctx), resolutionKeyOf(b, p, ins, ctx))).map(h => h.id);
  };
  ok("★ REGISTRATION_ORDER → 注册序（速度/队伍都不参与）", order("REGISTRATION_ORDER").join(",") === "h0,h1,h2", order("REGISTRATION_ORDER").join(","));
  ok("★ SPEED_DESC → 速度降序（h1 速度 200 先）", order("SPEED_DESC").join(",") === "h1,h0,h2", order("SPEED_DESC").join(","));
  ok("★ TEAM_THEN_SPEED → 先队伍序（0 队先），再速度降序", order("TEAM_THEN_SPEED").join(",") === "h0,h2,h1", order("TEAM_THEN_SPEED").join(","));
  ok("★ SELF_SIDE_FIRST → 行动方(0 队)先", order("SELF_SIDE_FIRST").join(",") === "h0,h2,h1", order("SELF_SIDE_FIRST").join(","));
  ok("★ OTHER_SIDE_FIRST → 对方(1 队)先", order("OTHER_SIDE_FIRST").join(",") === "h1,h0,h2", order("OTHER_SIDE_FIRST").join(","));
  ok("★★ 速度相同则退回注册序（SPEED_DESC 下 h0/h2 速度都是 100）", order("SPEED_DESC").indexOf("h0") < order("SPEED_DESC").indexOf("h2"));
  // 优先级必须压住速度：给最慢的那个最高优先级
  const hp = [H("slow", 5, 9), H("fast", 105, 0)];
  const pin = new Map([["slow", 0], ["fast", 1]]);
  const p = (PriorityPolicies as any).SPEED_DESC;
  const sorted = [...hp].sort((a, b) => compareResolutionKey(resolutionKeyOf(a, p, pin, ctx), resolutionKeyOf(b, p, pin, ctx))).map(h => h.id);
  ok("★★ priority 在链上位于 speed 之前：慢但高优先级者先", sorted.join(",") === "slow,fast", sorted.join(","));
}

sec("[4] ★★ 生产路径：bus.dispatch 真的按 ResolutionKey 排序");
{
  const run = async (policyId: string, actorTeam: number | null) => {
    const bus = new EventBus();
    bus.policy = (PriorityPolicies as any)[policyId];
    bus.resolver = { teamOf: (id: number) => (id >= 100 ? 1 : 0), speedOf: (id: number) => (id >= 100 ? 200 : 100) };
    bus.actorTeam = actorTeam;
    const seen: string[] = [];
    // 故意用"与期望顺序相反"的注册顺序，否则注册序策略会平凡通过
    for (const id of ["b", "a"]) bus.register({ id, ownerId: id === "a" ? 105 : 5, code: "X", range: "ALL", priority: 0, passive: false, fn: () => { seen.push(id); } } as any);
    await bus.dispatch("X", {}, 0, 0, (id: number) => (id >= 100 ? 1 : 0));
    return seen.join(",");
  };
  const reg = await run("REGISTRATION_ORDER", 0);
  ok("★★ REGISTRATION_ORDER 走的是注册序（注册是 b,a → 结算 b,a）", reg === "b,a", reg);
  const spd = await run("SPEED_DESC", 0);
  ok("★★ SPEED_DESC 真的按速度重排（a 速度 200 先，压过注册序）", spd === "a,b", spd);
  const self = await run("SELF_SIDE_FIRST", 0);
  ok("★★ SELF_SIDE_FIRST 走的是行动方一侧优先", self === "b,a", self);
  const other = await run("OTHER_SIDE_FIRST", 0);
  ok("★★ OTHER_SIDE_FIRST 与之相反", other === "a,b", other);
  const und = await run("UNDETERMINED", 0);
  ok("★★ UNDETERMINED 退回稳定排序 = 收集顺序（= 注册序），与 REGISTRATION_ORDER 同结果",
    und === reg, und + " vs " + reg);
  ok("★ 但两者的**键不同** —— 行为相同不等于可以谎称做过裁决",
    JSON.stringify(resolutionKeyOf(H("a", 5), (PriorityPolicies as any).UNDETERMINED, new Map([["a", 4]]))) !==
    JSON.stringify(resolutionKeyOf(H("a", 5), (PriorityPolicies as any).REGISTRATION_ORDER, new Map([["a", 4]]))));
}

sec("[5] 真实对局：六个策略都能跑完，且同 seed 可复现");
{
  const runOne = async (priority: string, seed = 20261001) => {
    const b: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed, traceLevel: "NONE", priority } as any).battle;
    await b.runStartup();
    const r = await b.run();
    return { winner: r.winner, turns: r.turns, reason: r.reason, checks: b.victoryChecks };
  };
  const ids = ["REGISTRATION_ORDER", "TEAM_THEN_SPEED", "SPEED_DESC", "SELF_SIDE_FIRST", "OTHER_SIDE_FIRST", "UNDETERMINED"];
  const out: any = {};
  for (const id of ids) out[id] = await runOne(id);
  ok("★★ 六个策略全部跑完并给出胜负（不是 NaN / 卡住）",
    ids.every(id => out[id].winner === 0 || out[id].winner === 1 || out[id].winner === null) && ids.every(id => out[id].turns > 0),
    JSON.stringify(out));
  const again = await runOne("REGISTRATION_ORDER");
  ok("★★ 同 seed 同策略可复现（排序不引入隐藏随机）",
    JSON.stringify(again) === JSON.stringify(out.REGISTRATION_ORDER), JSON.stringify([again, out.REGISTRATION_ORDER]));
  ok("★★ UNDETERMINED 与 REGISTRATION_ORDER 在真实对局中同结果（留空 = 退回注册序）",
    JSON.stringify(out.UNDETERMINED) === JSON.stringify(out.REGISTRATION_ORDER),
    JSON.stringify([out.UNDETERMINED, out.REGISTRATION_ORDER]));
}

console.log("\n=== ResolutionKey 验收: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
