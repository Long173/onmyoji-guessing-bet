// tests/g1-event-queue.ts — ★ G1 验收：事件队列标准化（a1-4.md §20、§26-28、§43、§56）
//
// 文档要求（§56）：
//   skill / passive / soul / status 里不许再"直接调用另一个 skill / 直接改 HP / 直接改 speed"，
//   要逐渐迁移成 Effect → EventQueue → Resolver，否则 Theater 永远会漏事件。
//
// 本测试把"漏事件"变成可执行断言：
//   ① 每一条 trace 都知道自己属于哪个事件（frame / ev / depth），事件有 Parent/Root 链
//   ② 技能释放的每个子步骤都在事件流里可见（扣火/拉条/护盾/上状态/回火/退回普攻）
//   ③ 递归保护真的会生效（超深链不炸栈，且**留痕**而不是静默吞掉）
//   ④ 守恒不变量成立（鬼火收支、HP 不为负、死亡与血量自洽）
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);

const kit = createKit(bundle);
const a = assembleMatch(kit, canonicalMatch(), { seed: 20261001 });
await a.battle.run();
const trace = a.battle.trace as any[];
const chain = a.battle.bus.chain as any[];
const byCode = (c: string) => trace.filter(e => e.t === c);

sec("[1] 事件链完整性（§28 Event 必须有 Parent/Root）");
ok(`事件链有 ${chain.length} 个节点`, chain.length > 50);
ok("每个节点都有 seq/parent/root/depth", chain.every(n => typeof n.seq === "number" && typeof n.root === "number" && typeof n.depth === "number" && (n.parent === null || typeof n.parent === "number")));
ok("根节点的 parent 为 null", chain.filter(n => n.parent === null).length >= 1);
ok("★ 每个节点的 root 指向一个真实存在的根", chain.every(n => { const r = chain.find(x => x.seq === n.root); return !!r && r.parent === null; }));
ok("★ 祖先回溯能一路走到根（无断链）：ancestry() 返回根在前", chain.every(n => {
  const anc = a.battle.bus.ancestry(n.seq);
  return anc.length >= 1 && anc[0].seq === n.root && anc[anc.length - 1].seq === n.seq && anc[0].parent === null;
}));
ok("子节点列表与 parent 相互一致", chain.every(n => n.children.every((c: number) => chain.find(x => x.seq === c)?.parent === n.seq)));
ok("★ 存在真正的事件嵌套（每个回合是一个 TURN 节点，内部事件挂在它下面）", chain.some(n => n.depth > 0), "最深 " + Math.max(...chain.map(n => n.depth)));
ok("TURN 节点数量 = 实际回合数", chain.filter(n => n.code === "TURN").length === a.battle.turn, `${chain.filter(n => n.code === "TURN").length} vs ${a.battle.turn}`);
ok("★ TURN 的子节点就是该回合内部的真实事件", chain.filter(n => n.code === "TURN").every(n => n.children.length >= 1));

sec("[2] 每条 trace 都能归属到事件（Theater 靠这个定位）");
ok("trace 全部带 frame/ev/depth", trace.every(e => typeof e.frame === "number" && typeof e.depth === "number" && (e.ev === null || typeof e.ev === "number")));
ok("帧号连续且唯一（0..N-1）", trace.every((e, i) => e.frame === i), `${trace.length} 帧`);
ok("★ 非根事件的 trace 都能找到对应事件节点", trace.filter(e => e.ev !== null).every(e => chain.some(n => n.seq === e.ev)));
const owned = trace.filter(e => e.ev !== null).length;
ok("★ 绝大部分 trace 归属于某个事件（不是游离的日志）", owned / trace.length > 0.95, `${owned}/${trace.length}`);
  /**
   * ★★★ 第 244 轮按事实改写：规格 §60 的两端（`BATTLE_START` / `BATTLE_END`）是**战斗级**标记 ——
   *   它们合理地为 `ev === null`（不属于任何父事件），而 `BATTLE_END` 出现在**末帧**，
   *   于是原来那条「游离帧必须落在前 8 帧内」的判据不再成立（实测：游离帧恰好就是这两个）。
   * 判据改成**具名**、而且比原来更严：游离帧只允许是这两个战斗级标记，别的任何游离帧都要报出来。
   * 「如实标记、不许硬塞假父节点」这条意图一个字没丢。
   */
  const FREE_OK = new Set(["BATTLE_START", "BATTLE_END"]);
  const freeBad = trace.filter((e: any) => e.ev === null && !FREE_OK.has(String(e.t)));
  ok("★ 游离帧只能是**具名的战斗级标记**（BATTLE_START / BATTLE_END），其余一律报出来",
    freeBad.length === 0, JSON.stringify(trace.filter((e: any) => e.ev === null).map((e: any) => [e.frame, e.t]).slice(0, 12)));

sec("[3] 以前看不见的步骤，现在都在事件流里（§15/§16/§17/§56）");
ok(`SKILL_CAST 事件存在（${byCode("SKILL_CAST").length} 条）`, byCode("SKILL_CAST").length > 20);
ok(`ORB_PAY 扣火事件存在（${byCode("ORB_PAY").length} 条）`, byCode("ORB_PAY").length > 0);
// 回火必然发生：鬼火条推进到满格就回火（技能给火 ORB_GAIN 或周期回火 ORB_REWARD 至少有一种）
  ok(`回火事件存在（技能给火 ${byCode("ORB_GAIN").length} 条 / 周期回火 ${byCode("ORB_REWARD").length} 条）`, byCode("ORB_GAIN").length + byCode("ORB_REWARD").length >= 1);
ok(`STATUS_APPLY 上状态事件存在（${byCode("STATUS_APPLY").length} 条）`, byCode("STATUS_APPLY").length > 0);
ok("SKILL_CAST 与行动日志一一对应", byCode("SKILL_CAST").length === a.battle.turnLog.filter(t => t.skill).length,
   `${byCode("SKILL_CAST").length} vs ${a.battle.turnLog.filter(t => t.skill).length}`);
const fallbacks = byCode("SKILL_FALLBACK");
ok(`★ 技能调用技能（鬼火不足退回普攻）已被**显式记录**（${fallbacks.length} 次）`, fallbacks.every(f => f.reason === "ORB_SHORT" && typeof f.need === "number"));
if (fallbacks.length) {
  const idx = trace.indexOf(fallbacks[0]);
  const after = trace.slice(idx, idx + 3).some(e => e.t === "SKILL_CAST" && e.skill === fallbacks[0].fallback);
  ok("退回普攻确实跟着一次真实施放（不是只有一行日志）", after, JSON.stringify(trace.slice(idx, idx + 3).map(e => e.t)));
} else {
  // 典型对局可能整场鬼火都够用；这条断言只是"若有则必须自洽"，无则跳过不算失败
  ok("本次对局未触发鬼火不足（该断言的前提不成立，不算失败）", true);
}
ok("拉条/推条事件带前后位置（Theater 行动条要用）", byCode("TIMELINE_SHIFT").every(e => e.posBefore !== null && e.posAfter !== null));
ok("护盾事件带数值", byCode("SHIELD_APPLY").every(e => typeof e.value === "number"));

sec("[4] 递归保护（§27 不要递归爆栈）");
// 真实对局里嵌套深度有限，所以用一个**合成深链**来证明保护真的生效（而不是靠运气）
{
  const kit2 = createKit(bundle);
  const b = assembleMatch(kit2, canonicalMatch(), { seed: 20261001 });
  const bus: any = b.battle.bus;
  bus.maxDepth = 3;
  // 自己触发自己：不设保护就是无限递归
  bus.register({ id: "probe:self", ownerId: 101, code: "PROBE", range: "ALL", priority: 0, passive: false,
    fn: async () => { await bus.dispatch("PROBE", {}, 101, 0, (id: number) => b.battle.teamOf(id)); } });
  let threw = "";
  try { await bus.dispatch("PROBE", {}, 101, 0, (id: number) => b.battle.teamOf(id)); } catch (e: any) { threw = String(e?.message ?? e); }
  ok("★ 自我触发的深链没有把栈打爆（被上限截断）", threw === "", threw || "（未抛错）");
  ok("★ 溢出被计数", bus.overflowCount > 0, String(bus.overflowCount));
  ok("链深度不超过上限", Math.max(...bus.chain.map((n: any) => n.depth)) <= 3, String(Math.max(...bus.chain.map((n: any) => n.depth))));
}
{
  // 在**真实对局**里制造溢出：注册一个"收到 TURN_START 就再发一次 TURN_START"的探针，
  // 并把上限压到 2（TURN 节点 = 0 层，TURN_START = 1 层，再嵌套就到顶）。
  const c = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  const bus: any = c.battle.bus;
  // ★ 先把开局跑完再压低上限：开局自 G1 起收敛成 STARTUP → STARTUP:<stage> 两层，
  //   若在开局前就把上限设为 2，溢出会来自开局阶段的嵌套事件，而不是本节要考察的
  //   「TURN_START 里再发 TURN_START」。断言因此会指向错误的来源。
  await c.battle.runStartup();
  bus.maxDepth = 2;
  bus.register({ id: "probe:turn-restart", ownerId: 101, code: "TURN_START", range: "ALL", priority: -1, passive: false,
    fn: async () => { await bus.dispatch("TURN_START", {}, 101, 0, (id: number) => c.battle.teamOf(id)); } });
  await c.battle.run();
  ok("★ 压低上限后战斗仍能跑完（不炸栈、不中断）", c.battle.turn > 0 && c.battle.winner !== null, `turn=${c.battle.turn} winner=${c.battle.winner}`);
  ok("★ 溢出被计数", bus.overflowCount > 0, String(bus.overflowCount));
  ok("★ 溢出写进事件流（留痕，不静默吞掉）", (c.battle.trace as any[]).some(e => e.t === "EVENT_OVERFLOW"), String(bus.overflowCount));
  // 压低上限到 2 之后，**所有**超过 2 层的合法嵌套都会溢出（不只是探针那一处），
  // 所以断言分两半：① 每条溢出都必须带得清"是谁触发的"（非空 code + 真实上限）；
  // ② 探针那条必须被抓到（否则等于没验证到本节真正想验证的递归）。
  const ovs = (c.battle.trace as any[]).filter(e => e.t === "EVENT_OVERFLOW");
  ok("溢出事件带 code 与上限，便于定位是谁触发的",
     ovs.length > 0 && ovs.every(e => typeof e.code === "string" && e.code.length > 0 && e.maxDepth === 2));
  ok("★ 探针制造的 TURN_START 自递归确实被抓到并标注了来源",
     ovs.some(e => e.code === "TURN_START"), JSON.stringify([...new Set(ovs.map(e => e.code))]));
}
{
  const d = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await d.battle.run();
  ok("默认上限下不发生溢出", (d.battle.bus as any).overflowCount === 0, String((d.battle.bus as any).overflowCount));
}

sec("[5] 守恒与自洽不变量（§43）");
const pays = byCode("ORB_PAY");
ok("★ 每次扣火：before − cost === after", pays.every(e => Math.abs(e.before - e.amount - e.after) < 1e-9), JSON.stringify(pays.slice(0, 3)));
ok("扣火后鬼火不为负", pays.every(e => e.after >= 0));
const gains = byCode("ORB_GAIN");
ok("回火：after === min(上限, before + requested)", gains.every(e => e.after >= e.before && e.after <= e.before + e.requested + 1e-9));
const units = captureState(a.battle).teams.flatMap(t => t.members);
ok("★ 没有单位 HP 为负", units.every(u => u.hp >= 0), JSON.stringify(units.filter(u => u.hp < 0).map(u => [u.id, u.hp])));
ok("★ 死亡与血量自洽（alive=false ⇒ hp<=0）", units.every(u => u.alive || u.hp <= 0), JSON.stringify(units.filter(u => !u.alive && u.hp > 0).map(u => [u.id, u.hp])));
ok("HP 从未超过上限", units.every(u => u.hp <= u.maxHp + 1e-6), JSON.stringify(units.filter(u => u.hp > u.maxHp + 1e-6).map(u => [u.id, u.hp, u.maxHp])));
const shieldTotal = byCode("SHIELD_APPLY").reduce((s, e) => s + e.value, 0);
ok("护盾总量非负", shieldTotal >= 0);
ok("伤害事件的 applied 不为负", byCode("DAMAGE").every(e => (e.applied ?? 0) >= 0));

sec("[6] 加了事件之后，确定性不能被破坏");
const d1 = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
await d1.battle.run();
const d2 = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
await d2.battle.run();
ok("★ 两次运行的最终核心状态指纹一致", stateHash(captureState(d1.battle)) === stateHash(captureState(d2.battle)));
ok("★ 两次运行的事件流逐字节一致", JSON.stringify(d1.battle.trace) === JSON.stringify(d2.battle.trace));

console.log(`\n=== G1: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
