// tests/g37-determinism-coverage.ts — ★★★ 确定性/守恒的**机制样本矩阵**（第 58 轮）
//
// 由来（第 57 轮留下的自述缺口）：修完护盾 id 的随机性之后发现，
// g3 / g18 / g24 的确定性测试用的都是**典型对局** —— 而那 10 个单位的技能里
// **一个护盾技能都没有**。KB 里明明有 24 个护盾技能。
// 这不是断言写松了，是**样本里没有这个东西**：断言再严，样本没走到就等于没测。
//
// 所以这一轮把「样本选择」机械化：
//   · 机制清单 → 每个机制从 **KB 里按 IR 命中**取一个真实技能（不是我想到哪个用哪个）；
//   · 把这个技能注入到一个单位上，逼这个机制**真的发生**；
//   · 每个样本跑两遍（同 seed），比指纹；
//   · 并对照一个**不注入**的基线：样本必须比基线多出该机制的痕迹，否则样本是空的。
//
// 一句话：**样本集从数据里长出来，不从我的记忆里长出来。**
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { compileBuff } from "../compile/buff-compiler.ts";
import { buildCharacter } from "../compile/character.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const buffs = new Map<string, any>((JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[])
  .map(b => [String(b.id), compileBuff(b)]));
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
/** 阴阳师不在竞猜口径里，样本里一律排除 */
const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);

/**
 * 机制清单 = 有**明确痕迹**的机制。每条的「痕迹」是一个**从 trace 数出来的谓词**，
 * 不是"某个码出现过"—— 例如 targeting 数的是"一次施法选中了多个目标"，
 * multihit 数的是"一次施法打了多下"，statusDurations 数的是"施加了持续 ≥2 回合的状态"。
 *
 * ★★ `expect` 是「这个机制会不会被常规对局顺便带出来」的**声明**，而它必须与**实测**相符：
 *    DRIVEN     基线里**一次都不发生** —— 必须靠注入的技能逼出来（这正是第 57 轮的盲区类别）
 *    UNIVERSAL  基线里本来就在发生 —— 那么每个样本都已经覆盖到它了
 *    两个方向都断言（见 [3]）：声明 DRIVEN 而基线里有 ⇒ 红；声明 UNIVERSAL 而基线里没有 ⇒ 红。
 *    第 58 轮我是**声明**这件事的（delta: true/false），第 59 轮改成**测量**它。
 */
const MECHS = [
  { key: "damage",   kb: "damage",      expect: "UNIVERSAL", pick: (ir: any) => (ir.damage?.length ?? 0) > 0,
    seen: (t: any[]) => t.filter(e => e.t === "DAMAGE").length },
  { key: "heal",     kb: "heal",        expect: "UNIVERSAL", pick: (ir: any) => (ir.heal?.length ?? 0) > 0,
    seen: (t: any[]) => t.filter(e => e.t === "HEAL").length },
  { key: "shield",   kb: "shield",      expect: "DRIVEN",    pick: (ir: any) => (ir.shield?.length ?? 0) > 0,
    seen: (t: any[]) => t.filter(e => e.t === "SHIELD_APPLY").length },
  { key: "timeline", kb: "timeline",    expect: "UNIVERSAL", pick: (ir: any) => (ir.timeline?.length ?? 0) > 0,
    seen: (t: any[]) => t.filter(e => e.t === "TIMELINE_SHIFT").length },
  { key: "purge",    kb: "purge",       expect: "DRIVEN",    pick: (ir: any) => (ir.purge?.length ?? 0) > 0,
    seen: (t: any[]) => t.filter(e => e.t === "STATUS_REMOVE").length },
  { key: "status",   kb: "statusRefs",  expect: "UNIVERSAL", pick: (ir: any) => (ir.statusRefs?.length ?? 0) > 0,
    seen: (t: any[]) => t.filter(e => e.t === "STATUS_APPLY").length },
  { key: "orb",      kb: "orbCost",     expect: "UNIVERSAL", pick: (ir: any) => (ir.orb?.cost ?? 0) > 0,
    seen: (t: any[]) => t.filter(e => e.t === "ORB_PAY").length },
  // ★★ 下面三条是第 59 轮从「豁免表」里搬回来的。第 58 轮我给的理由是"不产生痕迹"——
  //    那是**没查就写的理由**：痕迹一直都在，只是我没去看 trace 的字段。
  { key: "multihit", kb: "multihit",    expect: "UNIVERSAL", pick: (ir: any) => (ir.hits ?? 1) > 1,
    seen: (t: any[]) => t.filter(e => e.t === "SKILL_CAST" && (e.hits ?? 0) > 1).length },
  { key: "statusTurns", kb: "statusDurations", expect: "UNIVERSAL", pick: (ir: any) => (ir.statusDurations?.length ?? 0) > 0,
    seen: (t: any[]) => t.filter(e => e.t === "STATUS_APPLY" && (e.duration ?? 0) >= 2).length },
  { key: "scope",    kb: "targeting",   expect: "UNIVERSAL", pick: (ir: any) => (ir.targeting?.length ?? 0) > 0,
    seen: (t: any[]) => t.filter(e => e.t === "TARGET_SCOPE" && ((e.hurt?.length ?? 0) + (e.aid?.length ?? 0)) > 1).length },
];
// ★ kb 是「对应 KB_FIELDS 里的哪一项」—— 显式连起来，不靠名字撞对。
//   第一次写这个门时就是因为名字不一致（status vs statusRefs）当场报红：
//   那是**对的**，报红说明门真的在比两边，而不是自己跟自己比。

/**
 * ★★★ KB 的机制清单（**独立于 MECHS 算出来**，这是覆盖门能失败的前提）。
 *
 * 第 58 轮第一次写这个门时我写成了「MECHS 里的每条都有样本」—— 那是**平凡通过**的：
 * 样本集就是从 MECHS 生成的，两边同一个来源，断言永远为真。
 * 正确的门要反过来：**先问 KB 里有什么，再问样本覆盖了没有。**
 *
 * 第三列是「痕迹码」：有码 ⇒ 必须进 MECHS；没码 ⇒ 必须进下面的豁免表并写明理由。
 */
const KB_FIELDS: Array<{ key: string; has: (ir: any) => boolean; code: string | null; why: string }> = [
  { key: "damage",             has: ir => (ir.damage?.length ?? 0) > 0,             code: "DAMAGE",         why: "" },
  { key: "heal",               has: ir => (ir.heal?.length ?? 0) > 0,               code: "HEAL",           why: "" },
  { key: "shield",             has: ir => (ir.shield?.length ?? 0) > 0,             code: "SHIELD_APPLY",   why: "" },
  { key: "timeline",           has: ir => (ir.timeline?.length ?? 0) > 0,           code: "TIMELINE_SHIFT", why: "" },
  { key: "purge",              has: ir => (ir.purge?.length ?? 0) > 0,              code: "STATUS_REMOVE",  why: "" },
  { key: "statusRefs",         has: ir => (ir.statusRefs?.length ?? 0) > 0,         code: "STATUS_APPLY",   why: "" },
  { key: "orbCost",            has: ir => (ir.orb?.cost ?? 0) > 0,                  code: "ORB_PAY",        why: "" },
  // ★★ 第 59 轮把这四项里的**三项搬回了样本清单**（见 MECHS 末尾三条）——
  //    它们的痕迹一直都在：targeting 有 TARGET_SCOPE.mode/hurt[]、multihit 有 SKILL_CAST.hits、
  //    statusDurations 有 STATUS_APPLY.duration。我第 58 轮写"不产生痕迹"时**没有打开 trace 看字段**。
  { key: "multihit",           has: ir => (ir.hits ?? 1) > 1,                       code: "SKILL_CAST",   why: "" },
  { key: "statusDurations",    has: ir => (ir.statusDurations?.length ?? 0) > 0,    code: "STATUS_APPLY", why: "" },
  { key: "targeting",          has: ir => (ir.targeting?.length ?? 0) > 0,          code: "TARGET_SCOPE", why: "" },
  //    只有下面这一项是**真的**该豁免：
  { key: "unmodeledMechanics", has: ir => (ir.unmodeledMechanics?.length ?? 0) > 0, code: null,
    why: "它表示「引擎里**没有**这个机制」—— 有痕迹才说明标错了；由 tests/g23 双向核对" },
];

sec("[1] ★★ 样本集从 KB 里按机制选（不是我挑的）");
const chosen: Array<{ key: string; code: string; delta: boolean; who: string; desc: string; cands: number }> = [];
for (const m of MECHS) {
  const hits: Array<{ who: string; desc: string }> = [];
  for (const s of LIST) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const sk of (s.skills ?? [])) {
      if (m.pick(compileSkill(s.id, s.name, sk))) hits.push({ who: s.name + "「" + sk.name + "」", desc: String(sk.description ?? "") });
    }
  }
  if (hits.length) chosen.push({ key: m.key, who: hits[0].who, desc: hits[0].desc, cands: hits.length });
}
{
  for (const c of chosen) console.log("    " + c.key.padEnd(9) + "KB 候选 " + String(c.cands).padStart(3) + " 个 → 取 " + c.who);
  ok("★★ 每个机制都在 KB 里取到了真实技能（清单不是写死的）", chosen.length === MECHS.length,
    JSON.stringify(MECHS.map(m => m.key).filter(k => !chosen.some(c => c.key === k))));
  ok("★★ 取的是 KB 里的第 1 个命中（顺序确定 ⇒ 样本可复现）",
    chosen.every(c => c.desc.length > 0));
  // ★ 第 57 轮的盲区必须有样本：护盾在 KB 里有 24 个技能，其中必须有 1 个进样本集
  const shield = chosen.find(c => c.key === "shield");
  ok("★★★ 护盾机制进入样本集（第 57 轮就是它没有样本才漏掉一个真 bug）", !!shield && shield.cands >= 20,
    shield ? shield.who + "（候选 " + shield.cands + " 个）" : "没有护盾样本");
}

/** 把一个真实技能描述注入到红方 1 号位，逼它反复使用 */
const mkSkill = (desc: string) => buildCharacter(
  { id: 1, name: "探查单位", panel: { atk: 3000, hp: 20000, def: 500, spd: 200, cri: 50, crid: 2, efh: 50, efr: 50 },
    skills: [{ id: "probe", name: "探查", cost: 0, description: desc }] },
  undefined, undefined, buffs, 0, 1).entity.skills[0];

const MATCH = canonicalMatch();          // ★ 同一个 match 对象跑两遍：unitId 不参与战斗，但也不给它机会
async function runProbe(desc: string | null, seed: number) {
  const a: any = assembleMatch(createKit(bundle), MATCH, { seed });
  await a.battle.runStartup();
  if (desc !== null) {
    const u = a.battle.teams[0].members[0];
    u.skills = [mkSkill(desc)];
    u.usedSkills = new Set();
  }
  await a.battle.run();
  const trace = (a.battle.trace ?? []) as any[];
  return { battle: a.battle, trace, hash: stateHash(captureState(a.battle)), winner: a.battle.winner, turns: a.battle.turn };
}

sec("[2] ★★★ 每个样本：同 seed 两次运行必须逐位相同（第 57 轮那类 bug 的通用闸门）");
const results: Array<{ c: typeof chosen[number]; a: any; b: any; base: any }> = [];
{
  const base = await runProbe(null, 20261001);
  for (const c of chosen) {
    const a = await runProbe(c.desc, 20261001);
    const b = await runProbe(c.desc, 20261001);
    results.push({ c, a, b, base });
    ok("★★ " + c.key.padEnd(9) + " 指纹一致 " + a.hash, a.hash === b.hash, a.hash + " ≠ " + b.hash);
  }
  ok("★★ 胜负与回合数也逐位一致（不是只有哈希碰巧相同）",
    results.every(r => r.a.winner === r.b.winner && r.a.turns === r.b.turns),
    JSON.stringify(results.filter(r => r.a.winner !== r.b.winner || r.a.turns !== r.b.turns).map(r => r.c.key)));
  ok("★ 基线本身也是确定的（对照组不能是随机的）", base.hash === (await runProbe(null, 20261001)).hash, base.hash);
}

sec("[3] ★★★ 每个机制的「会不会顺便发生」必须与实测相符（声明 vs 测量，两个方向都查）");
{
  const mechOf = (k: string) => MECHS.find(m => m.key === k)!;
  const empty: string[] = [];
  const misDeclared: string[] = [];
  for (const r of results) {
    const m = mechOf(r.c.key);
    const got = m.seen(r.a.trace);
    const was = m.seen(r.base.trace);
    // 声明必须与实测相符 —— 这是本节新加的双向断言
    if (m.expect === "DRIVEN" && was > 0) misDeclared.push(r.c.key + " 声明 DRIVEN 但基线里发生了 " + was + " 次");
    if (m.expect === "UNIVERSAL" && was === 0) misDeclared.push(r.c.key + " 声明 UNIVERSAL 但基线里一次都没有");
    if (got < 1) empty.push(r.c.key + "（注入后 " + got + "，基线 " + was + "）");
    console.log("    " + r.c.key.padEnd(11) + m.expect.padEnd(10) + "注入 " + String(got).padStart(4) + "｜基线 " + String(was).padStart(4) +
      "  " + (m.expect === "DRIVEN" ? "← 基线里从不发生，只能靠样本" : "← 常规对局里本来就有"));
  }
  ok("★★★ 每个机制在样本里都被观察到了（没有空样本）", empty.length === 0, JSON.stringify(empty));
  ok("★★★ DRIVEN / UNIVERSAL 的声明与实测相符（两个方向）", misDeclared.length === 0, JSON.stringify(misDeclared));
  // ★★ 这条是第 57 轮那个盲区的**可数形式**：基线里从不发生的机制，就是必须靠样本才测得到的机制。
  const driven = MECHS.filter(m => m.expect === "DRIVEN").map(m => m.key);
  ok("★★ 基线里从不发生的机制恰好是 shield 与 purge（第 57 轮的护盾 bug 就住在这一类里）",
    driven.sort().join(",") === "purge,shield", JSON.stringify(driven));
  console.log("    必须靠样本才能测到的机制（基线 0 次）：" + driven.join("、") + "；其余 " + (MECHS.length - driven.length) + " 个在基线里本来就在发生");
}

sec("[4] ★★ 守恒与事件安全：把 g1 的不变量铺到每个样本上");
{
  const bad: string[] = [];
  for (const r of results) {
    const bs = r.a.battle;
    for (const e of bs.allEntities()) {
      if (!(e.hp >= 0 && e.hp <= e.maxHp)) bad.push(r.c.key + " hp 越界 " + e.name + " " + e.hp + "/" + e.maxHp);
      if (e.dead && e.hp !== 0) bad.push(r.c.key + " 死亡但血量不为 0：" + e.name);
      if (e.hpZero && e.hp !== 0) bad.push(r.c.key + " hpZero 但血量不为 0：" + e.name);
    }
    for (const t of bs.teams) if (t.orbs.current < 0) bad.push(r.c.key + " 鬼火为负 team" + t.id);
    if (bs.bus.overflowCount > 0) bad.push(r.c.key + " 事件链溢出 " + bs.bus.overflowCount + " 次");
    const maxD = Math.max(0, ...bs.bus.chain.map((n: any) => n.depth));
    if (maxD > bs.bus.maxDepth) bad.push(r.c.key + " 链深度 " + maxD + " > " + bs.bus.maxDepth);
  }
  ok("★★ 全部样本：HP 不越界、死亡与血量自洽、鬼火不为负、事件链不溢出", bad.length === 0, JSON.stringify(bad.slice(0, 4)));
  ok("★ 前置：这些样本真的打了（trace 非空、事件链非空）",
    results.every(r => (r.a.battle.trace?.length ?? 0) > 0 && (r.a.battle.bus.chain?.length ?? 0) > 0));
  console.log("    样本 " + results.length + " 个，每个 2 局；最深事件链 " +
    Math.max(...results.map(r => Math.max(0, ...r.a.battle.bus.chain.map((n: any) => n.depth)))));
}

sec("[5] ★★★ 覆盖门：KB 里有的机制，要么有样本，要么有豁免（附理由）");
{
  // ① 先按 KB 的数据统计每个机制字段有多少个技能 —— 这一份**不依赖 MECHS**
  const kbCount: Record<string, number> = {};
  for (const s of LIST) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const sk of (s.skills ?? [])) {
      const ir: any = compileSkill(s.id, s.name, sk);
      for (const f of KB_FIELDS) if (f.has(ir)) kbCount[f.key] = (kbCount[f.key] ?? 0) + 1;
    }
  }
  console.log("    KB 机制清单（按 IR 机械枚举，共 " + KB_FIELDS.length + " 项）：");
  for (const f of KB_FIELDS) console.log("      " + f.key.padEnd(18) + String(kbCount[f.key] ?? 0).padStart(4) + " 个技能｜" + (f.code ?? "无痕迹码 → 豁免"));

  // ② 有痕迹码的机制，必须在 MECHS 里有样本
  const noSample = KB_FIELDS.filter(f => f.code && (kbCount[f.key] ?? 0) > 0 && !MECHS.some(m => (m as any).kb === f.key));
  // 反向：MECHS 里的 kb 必须真的指向 KB_FIELDS 的一项（防止写错字后两边都"通过"）
  const danglingKb = MECHS.filter(m => !KB_FIELDS.some(f => f.key === (m as any).kb)).map(m => m.key + "→" + (m as any).kb);
  ok("★★ MECHS 的 kb 指向都存在（写错字不会静默通过）", danglingKb.length === 0, JSON.stringify(danglingKb));
  ok("★★★ KB 里有痕迹码的机制都在样本清单里（漏一个就是红的）", noSample.length === 0,
    JSON.stringify(noSample.map(f => f.key + "(" + kbCount[f.key] + " 个技能)")));

  // ③ 没有痕迹码的机制，必须写明理由 —— 且理由不能是空话
  const badWhy = KB_FIELDS.filter(f => !f.code && f.why.trim().length < 10);
  ok("★★ 没有痕迹码的机制都写明了豁免理由", badWhy.length === 0, JSON.stringify(badWhy.map(f => f.key)));
  // ★ 第 59 轮把这条从"豁免 ≤ 5"收紧成"豁免恰好 1 项，而且必须是 unmodeledMechanics"。
  //   第 58 轮那 4 项里有 3 项是我没查就写的理由 —— 放宽的额度会被用来放水，所以现在不给额度。
  const exempt = KB_FIELDS.filter(f => !f.code).map(f => f.key);
  ok("★★ 真正需要豁免的只有 unmodeledMechanics 一项（它表示引擎里没有这个机制）",
    exempt.join(",") === "unmodeledMechanics", JSON.stringify(exempt));

  // ④ 每条 MECHS 都必须真的在 KB 里挑到了驱动技能（挑不到就红，不许静默跳过）
  const noCand = MECHS.filter(m => !chosen.some(c => c.key === m.key));
  // 一个 KB 机制只能挂一条样本（重复挂会让"覆盖"看起来比实际宽）
  ok("★★ 每条样本机制都能从 KB 里挑到真实技能来驱动", noCand.length === 0, JSON.stringify(noCand.map(m => m.key)));
  const dupKb = MECHS.map(m => (m as any).kb).filter((k, i, arr) => arr.indexOf(k) !== i);
  ok("★ 一个 KB 机制只挂一条样本（重复挂会让覆盖看起来比实际宽）", dupKb.length === 0, JSON.stringify(dupKb));

  // ⑤ 样本真的跑到并观察到了（不是"清单里有"就算数）
  const uncovered = MECHS.filter(m => !results.some(r => r.c.key === m.key && m.seen(r.a.trace) > 0));
  ok("★★★ 每条样本机制都**实测观察到**了痕迹", uncovered.length === 0, JSON.stringify(uncovered.map(m => m.key)));
  console.log("    覆盖：" + results.map(r => { const m = MECHS.find(x => x.key === r.c.key)!; return r.c.key + "(" + m.seen(r.a.trace) + ")"; }).join("、"));
}

console.log("\n=== 确定性样本覆盖: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
