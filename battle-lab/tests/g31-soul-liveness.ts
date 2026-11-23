// tests/g31-soul-liveness.ts — ★★ 御魂运行时到底有没有效果：70 件逐件实测
//
// 由来：第 36 轮证明「典型对局的事件总线订阅者是 0」，我用「装上御魂 → 100 订阅者 → 61 次投递」
// 当正向对照，并写下「总线功能正常」。这一轮去查那 61 次投递**到底做了什么**，结论是：
// **什么都没做** —— 雪幽魂装上 ×4 后，整场战斗的 trace 长度、胜负、回合数、终局指纹
// 与「完全不装御魂」**逐位相同**。
//
// 原因在 soul/effect-system.ts 的设计里写着（「解释不了的仍然注册 handler，但标记 UNSUPPORTED」）：
// 解析不出效果的御魂会注册一批**空 handler**，它们会被调用、会被计数，但不改变任何状态。
// 所以「总线投递成功」只证明总线会调用函数，**不证明效果发生** ——
// 我第 36 轮那条断言正是被空 handler 满足的（又一次平凡通过，这次在我自己的测试里）。
//
// 这个测试做两件事：
//   ① 用**可观测状态**（鬼火 / 护盾 / 状态 / 胜负 / 回合 / 终局指纹）逐件量出到底几件御魂有效果；
//   ② 给出正向对照（火灵 / 蚌精），否则「没变化」分不清是「御魂没用」还是「我的指纹太粗」。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { CUSTOM_SOULS, BETTING_ONLY_SOULS } from "../soul/custom-effects.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const soulIdx = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "kb", "soul-index.json"), "utf8"));
const SEED = 20261001;
const base = canonicalMatch();

/** 全队 10 只都装上同一件御魂（4 件套 = 单个 id 复制 4 份，见 engine/assemble.ts） */
const allWearing = (id: number | null) => {
  const m: any = JSON.parse(JSON.stringify(base));
  for (const side of ["red", "blue"]) for (const u of m[side].units) u.soulId = id;
  return m;
};

/**
 * 可观测指纹：胜负 / 回合 / 开局后双方鬼火 / 护盾数 / 状态数 / 终局状态哈希。
 * 用 stateHash 而不是只看胜负 —— 只看胜负太粗，会漏掉「过程变了但结果没变」的效果。
 */
async function fingerprint(id: number | null) {
  const a: any = assembleMatch(createKit(bundle), allWearing(id), { seed: SEED, traceLevel: "NONE" });
  const b = a.battle;
  await b.runStartup();
  const orbs = b.teams.map((t: any) => t.orbs.current).join(",");
  const shields = b.allEntities().reduce((n: number, e: any) => n + e.shields.length, 0);
  const statuses = b.allEntities().reduce((n: number, e: any) => n + e.statuses.length, 0);
  const r = await b.run();
  // Damage / healing totals: custom souls such as 蝠翼 (lifesteal) and 镇墓兽 (crit damage) change how much
  // was dealt or healed without changing the winner, turn count or the final state of this fixture.
  const total = (m: Map<number, number>) => Math.round([...m.values()].reduce((s, v) => s + v, 0));
  const flow = [total(b.stats.damageDealt), total(b.stats.healing)].join("/");
  const fired = Object.values(((a.soulReport as any)?.fireCount ?? {}) as Record<string, number>).reduce((s, v) => s + v, 0);
  return {
    key: [r.winner, r.turns, orbs, shields, statuses, flow, stateHash(captureState(b))].join("|"),
    result: r, orbs, shields, statuses, fired,
    installed: (a.soulReport as any)?.installed?.length ?? 0,
    unsupported: (a.soulReport as any)?.unsupported ?? 0,
  };
}

const baseline = await fingerprint(null);
console.log("    基线（无御魂）：" + baseline.result.winner + "/" + baseline.result.turns + " 回合｜开局鬼火 " + baseline.orbs);

const rows: Array<{ id: number; name: string; support: string; changed: boolean; fired: number }> = [];
for (const s of soulIdx) {
  const f = await fingerprint(s.i);
  rows.push({ id: s.i, name: s.n, support: s.engine.support, changed: f.key !== baseline.key, fired: f.fired });
}
/**
 * Custom souls whose trigger condition never occurs in this fixture (so they cannot change it).
 * Each one is asserted in [1] to fire 0 times here — if it ever fires, it must also change the fixture.
 */
const FIXTURE_SILENT: Record<string, string> = {
  鸣屋: "needs a target under a control effect when attacked; the canonical fixture never has one",
  幽谷响: "needs a resisted control effect; the default resist policy (NOT_CONSUMED) never resists",
};

sec("[1] ★★ 逐件实测：70 件御魂里几件真的改变了对局");
{
  const bySup: Record<string, { n: number; changed: number }> = {};
  for (const r of rows) { const g = bySup[r.support] ?? (bySup[r.support] = { n: 0, changed: 0 }); g.n++; if (r.changed) g.changed++; }
  for (const [k, v] of Object.entries(bySup)) console.log("    " + k.padEnd(12) + " " + v.changed + " / " + v.n + " 件产生可观测变化");
  const changed = rows.filter(r => r.changed);
  // ★ Custom installers (soul/custom-effects.ts) add hand-written souls on top of the 4 generic ones.
  // Betting-only installers (BETTING_ONLY_SOULS) are not used in BASE mode, where this test runs.
  const customNames = Object.keys(CUSTOM_SOULS).filter(n => !(n in FIXTURE_SILENT) && !BETTING_ONLY_SOULS.has(n));
  const expectedChanged = ["火灵", "蚌精", "无刀取", "招财猫", ...customNames];
  const silent = rows.filter(r => r.name in FIXTURE_SILENT);
  ok("★ fixture-silent custom souls (" + Object.keys(FIXTURE_SILENT).join("/") + ") really never fire here",
    silent.length === Object.keys(FIXTURE_SILENT).length && silent.every(r => r.fired === 0 && !r.changed),
    JSON.stringify(silent.map(r => [r.name, r.fired, r.changed])));
  ok("★ 总量：产生可观测变化的御魂是 " + changed.length + " / 70 件（4 件通用 + " + customNames.length + " 件 custom）",
    changed.length === expectedChanged.length, String(changed.length));
  ok("★ 有变化的恰好是：火灵 / 蚌精 / 无刀取 / 招财猫 + custom（" + customNames.join("/") + "）",
    new Set(changed.map(r => r.name)).size === expectedChanged.length && expectedChanged.every(n => changed.some(r => r.name === n)),
    changed.map(r => r.name).join(","));
  // ★★★ 第 93 轮：这条断言**转向**了（3 → **4**），而转向的原因是**索引终于被重建过**。
  //   · 旧索引（生成于很久以前）里：招财猫是 PARTIAL、地藏像是 FULL；
  //   · 重建之后（第 93 轮走 build-kb-index.mjs）：招财猫是 FULL（它的 ORB_TURN_START 有规则、
  //     触发时机 TURN_START 有派发点 —— 第 42 轮就实现了，只是索引没跟上），
  //     地藏像是 PARTIAL（第 93 轮把 interpretEffect 的 ON_CRIT 降级提到最前，见第 [7] 节）。
  //   ⇒ 现在 FULL 6 件里有 **4** 件真的改变对局：火灵 / 蚌精 / 无刀取 / **招财猫**。
  //   ★ 换句话说：**"FULL 里只有 3 件有效"有一半是索引陈旧造成的**，不是引擎的帐。
  ok("★★ FULL 6 件里有 4 件有效果（招财猫第 93 轮从 PARTIAL 归位）—— FULL 标签仍不保证装上就有效",
    (bySup.FULL?.changed ?? 0) === 4 && (bySup.FULL?.n ?? 0) === 6, JSON.stringify(bySup.FULL));
  // 第 42 轮实现招财猫后不再是 0；第 93 轮它被索引正确地归到 FULL，于是这条变成 **0/32**。
  // ★ 它仍然是这份报告里最难听的一条，而且比之前更难听：**32 件 PARTIAL 御魂装上之后
  //   没有任何一件改变任何状态**。这不是"少算几件"，是"标签为 PARTIAL 的那一档整体不产生行为"。
  // ★ PARTIAL / UNSUPPORTED (labels from the text interpreter) only change state via custom installers.
  const customIn = (sup: string) => rows.filter(r => r.support === sup && customNames.includes(r.name)).length;
  ok("★★★ PARTIAL 32 件里只有 custom 实现的那几件有可观测变化",
    (bySup.PARTIAL?.changed ?? -1) === customIn("PARTIAL") && (bySup.PARTIAL?.n ?? 0) === 32, JSON.stringify(bySup.PARTIAL));
  ok("★ UNSUPPORTED 里只有 custom 实现的那几件有变化", (bySup.UNSUPPORTED?.changed ?? -1) === customIn("UNSUPPORTED"), JSON.stringify(bySup.UNSUPPORTED));
  console.log("    未产生变化的 " + (70 - changed.length) + " 件会被注册成**空 handler**：");
  console.log("    事件会投递给它们、会被计数，但不改变任何状态。");
}

sec("[2] ★★ 正向对照：有效果的那几件必须能被独立验证");
{
  const hl = soulIdx.find((s: any) => s.n === "火灵");
  const a: any = assembleMatch(createKit(bundle), allWearing(hl.i), { seed: SEED, traceLevel: "FULL" /* 192: 这几节读的是逐帧细节（SHIELD_APPLY / ORB_GAIN / ORB_SOUL_MISS），SUMMARY 现在是统计档 */ });
  await a.battle.runStartup();
  const orbsAfter = a.battle.teams.map((t: any) => t.orbs.current);
  await a.battle.run();
  ok("★★ 火灵：开局鬼火真的涨了（" + baseline.orbs + " → " + orbsAfter.join(",") + "）",
    orbsAfter[0] > Number(baseline.orbs.split(",")[0]), JSON.stringify([baseline.orbs, orbsAfter]));

  const bj = soulIdx.find((s: any) => s.n === "蚌精");
  const c: any = assembleMatch(createKit(bundle), allWearing(bj.i), { seed: SEED, traceLevel: "FULL" /* 192: 这几节读的是逐帧细节（SHIELD_APPLY / ORB_GAIN / ORB_SOUL_MISS），SUMMARY 现在是统计档 */ });
  await c.battle.runStartup();
  const shieldN = c.battle.allEntities().reduce((n: number, e: any) => n + e.shields.length, 0);
  await c.battle.run();
  const applied = (c.battle.trace as any[]).filter((e: any) => e.t === "SHIELD_APPLY").length;
  ok("★★ 蚌精：真的给了护盾（护盾 " + shieldN + " 个、SHIELD_APPLY " + applied + " 次）",
    shieldN > 0 && applied > 0, JSON.stringify([shieldN, applied]));
  ok("★ 对照：无御魂时护盾数就是 0", baseline.shields === 0, String(baseline.shields));
}

sec("[3] 范围声明（不许把上面的话读成「御魂系统完全没用」）");
{
  console.log("    口径写在断言里，防止被误读：");
  console.log("      · 全队 10 只 × 同一件 ×4；单一 seed " + SEED + "；单一对局 fixture");
  console.log("      · 「零可观测变化」只对**这组条件**成立 —— 换阵容 / 换 seed 可能有别件御魂显形");
  console.log("      · 它不能推出「某件御魂在游戏里没用」，只能推出「本引擎里它不改变任何状态」");
  ok("★★ 火灵 / 蚌精确实有效果 —— 所以不是运行时坏了，而是**大多数御魂没有可执行效果**", true);
  ok("★ 基线两次跑必须同指纹（否则「变化」可能只是随机噪声）",
    (await fingerprint(null)).key === baseline.key);
}

sec("[4] ★★ 注册去重：同一件御魂穿在 N 个单位身上，不能注册成 N² 个 handler");
{
  // 第 42 轮的 bug：refs 是"每个穿戴单位一条"，而安装循环内部又遍历所有穿戴单位，
  // 两者相乘 = N²。10 只都穿招财猫时 TURN_START 订阅者是 100、每个回合开始触发 10 次，
  // 概率效果的期望被放大 10 倍。此前所有 soul 测试都只给**一个**单位穿御魂（N²=N），所以没暴露。
  const one: any = JSON.parse(JSON.stringify(base));
  one.red.units[0].soulId = 7;
  const two: any = JSON.parse(JSON.stringify(base));
  two.red.units[0].soulId = 7; two.red.units[1].soulId = 7;
  const count = async (m: any) => {
    const a: any = assembleMatch(createKit(bundle), m, { seed: SEED, traceLevel: "NONE" });
    return (a.battle.bus.handlers as any[]).filter((h: any) => h.code === "TURN_START").length;
  };
  ok("★★ 1 个单位穿 → 恰好 1 个 handler", (await count(one)) === 1, String(await count(one)));
  ok("★★ 2 个单位穿 → 恰好 2 个 handler（不是 4 个）", (await count(two)) === 2, String(await count(two)));
  ok("★★ 10 个单位穿 → 恰好 10 个 handler（不是 100 个）", (await count(allWearing(7))) === 10, String(await count(allWearing(7))));

  const a: any = assembleMatch(createKit(bundle), allWearing(7), { seed: SEED, traceLevel: "FULL" /* 192: 这几节读的是逐帧细节（SHIELD_APPLY / ORB_GAIN / ORB_SOUL_MISS），SUMMARY 现在是统计档 */ });
  await a.battle.runStartup();
  const r = await a.battle.run();
  const ts = (a.battle.bus.chain as any[]).filter((n: any) => n.code === "TURN_START");
  const hist: Record<string, number> = {};
  for (const n of ts) hist[n.handlerCount] = (hist[n.handlerCount] ?? 0) + 1;
  ok("★★ 每个回合开始节点只投递给 1 个 handler（修复前是 10 个）",
    ts.length > 0 && Object.keys(hist).join(",") === "1", JSON.stringify(hist));
  ok("★★ installed 的含义收紧为「本局有几种御魂效果」（10 只穿同一件 = 1 种）",
    (a.soulReport as any).installed.length === 1, String((a.soulReport as any).installed.length));
  ok("★ 战斗仍然跑完并给出胜负", r.turns > 0 && (r.winner === 0 || r.winner === 1 || r.winner === null), JSON.stringify([r.turns, r.winner]));
}

sec("[5] ★★ 招财猫：概率写在文案里，就必须按概率抽、并且**只抽一次**");
{
  const zc = soulIdx.find((s: any) => s.n === "招财猫")!;
  ok("★ 前置：招财猫的文案确实是「回合开始时，有50%的概率获得2点鬼火」",
    /回合开始时/.test(zc.desc) && /50%/.test(zc.desc) && /2s*点鬼火/.test(zc.desc), zc.desc);
  const a: any = assembleMatch(createKit(bundle), allWearing(zc.i), { seed: SEED, traceLevel: "FULL" /* 192: 这几节读的是逐帧细节（SHIELD_APPLY / ORB_GAIN / ORB_SOUL_MISS），SUMMARY 现在是统计档 */ });
  await a.battle.runStartup();
  const r = await a.battle.run();
  const tr = a.battle.trace as any[];
  const hit = tr.filter((e: any) => e.t === "ORB_GAIN" && /招财猫/.test(e.skill ?? ""));
  const miss = tr.filter((e: any) => e.t === "ORB_SOUL_MISS");
  const chance = hit.length + miss.length;
  ok("★★ 触发机会数 ≈ 回合数（SELF 语义：只有持有者自己回合开始才抽）",
    chance === r.turns, chance + " vs 回合 " + r.turns);
  ok("★★ 命中率接近文案写的 50%", hit.length / chance > 0.35 && hit.length / chance < 0.65,
    (hit.length / chance * 100).toFixed(1) + "%（" + hit.length + "/" + chance + "）");
  ok("★★ 每次命中给的是 2 点鬼火（文案值），不是 1 点", hit.every((e: any) => e.requested === 2), JSON.stringify(hit.slice(0, 3).map((e: any) => e.requested)));
  ok("★ 没中的那些也留痕（否则「50%」无法验证，只看得见中的）", miss.length > 0, String(miss.length));
  ok("★ 抽数带用途标签（a1-4 §20：每次抽数都要能说清为什么抽）",
    tr.filter((e: any) => e.roll).every((e: any) => /^soul:招财猫:turnStart$/.test(e.roll)), JSON.stringify([...new Set(tr.filter((e: any) => e.roll).map((e: any) => e.roll))]));
  ok("★ 它不再是 UNSUPPORTED（效果轴认可它）", (a.soulReport as any).unsupported === 0, String((a.soulReport as any).unsupported));
}

sec("[6] ★★★ 第 90 轮：挂在**永远不会被派发**的事件上的效果，不算已安装");
{
  // 由来：soul/effect-system.ts 里那段注释写着「暴击时」类御魂永远不会触发，
  // 「并由 interpretEffect **如实降级为 UNSUPPORTED**」—— 实测这句**不总成立**：
  //   地藏像（trigger=ON_CRIT → code=CRI）的 interpretEffect 返回的是 **SHIELD**，
  //   于是它被报成「已安装、挂在 CRI 上」的一个护盾效果，而 CRI **永远不会被派发**
  //   ⇒ 一个**静默的死处理器**（针女同样是 CRI，但它确实被判成 UNSUPPORTED，所以只有地藏像漏了）。
  // ⇒ 光靠"意图 + 一句注释"守不住，补一道**结构性**判据：
  //   `code` 不在 DISPATCHED_EV_CODES 里（那张表由 g42 双向盯着）就不算已安装。
  const souls = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "soul.json"), "utf8"));
  const { installSoulEffects } = await import("../soul/effect-system.ts");
  const { Battle, DEFAULT_RULES } = await import("../kernel/battle.ts");
  const { Team } = await import("../kernel/team.ts");
  const { Entity } = await import("../kernel/entity.ts");
  const { ResourcePolicies } = await import("../kernel/resource.ts");
  const { DISPATCHED_EV_CODES } = await import("../compile/passive-runtime.ts");
  const rows: any[] = [];
  for (const def of souls) {
    const ent = new Entity(1, "T", 0, { atk: 100, hp: 1000, def: 100, spd: 100 } as any);
    ent.notes.push("携带御魂 " + def.name);
    const tm = new Team(0, "R", Object.values(ResourcePolicies)[0] as any, 4);
    tm.add(ent);
    const bt: any = new Battle([tm], { seed: 1, rules: DEFAULT_RULES });
    const rep = installSoulEffects(bt, [{ soulId: def.id, name: def.name }], new Map([[Number(def.id), def]]));
    if (rep.installed[0]) rows.push({ def, it: rep.installed[0] });
  }
  ok("★★★ 样本非空（70 件全过一遍）", rows.length === 70, String(rows.length));
  const dead = rows.filter(r => r.it.code && !DISPATCHED_EV_CODES.has(r.it.code) && r.it.kind !== "UNSUPPORTED");
  ok("★★★ 没有任何效果挂在「没人派发」的事件上却仍报成已安装", dead.length === 0,
    JSON.stringify(dead.map(r => r.def.name + "@" + r.it.code + "/" + r.it.kind)));
  const jizo = rows.find(r => r.def.name === "地藏像");
  // 地藏像 no longer hangs on the undispatched CRI event: soul/custom-effects.ts reads result.isCrit on AFTER_DAMAGE
  //   (the dead-handler guard above still covers every generic soul).
  ok("★★★ 地藏像走 custom 安装（AFTER_DAMAGE + isCrit），不再是挂在 CRI 上的死处理器", jizo?.it.kind === "CUSTOM" && jizo?.it.code === null, JSON.stringify([jizo?.it.kind, jizo?.it.code]));
  ok("★★★ 而且安装说明写明了它真正做的事（受暴击 → 护盾）",
    /crit/.test(String(jizo?.it.note)) && /shield/.test(String(jizo?.it.note)), String(jizo?.it.note).slice(0, 80));
  const needle = rows.find(r => r.def.name === "针女");
  // 针女 no longer relies on a CRI event: soul/custom-effects.ts reads result.isCrit on AFTER_DAMAGE.
  ok("★★ 对照：针女走 custom 安装（AFTER_DAMAGE + isCrit），不再挂在不存在的 CRI 事件上",
    needle?.it.kind === "CUSTOM", JSON.stringify(needle?.it.kind));
  const unsup = rows.filter(r => r.it.kind === "UNSUPPORTED").length;
  console.log("    70 件御魂：UNSUPPORTED " + unsup + " 件｜静默死处理器 " + dead.length + " 件");
}
sec("[7] ★★★ 第 93 轮：判读（interpretEffect）必须与安装（installSoulEffects）得出同一个结论");
{
  // 由来：第 93 轮重建网页索引（tools/build-kb-index.mjs）之后，FULL 从 6 件变成 **7 件**，
  //   g31 / ui1 / ui6 三条断言同时变红。查下去是 interpretEffect 的**分支顺序**问题：
  //   地藏像的文案先说「受到暴击时」，再说「获得护盾…10%」——
  //   而「护盾…」那条正则排在 ON_CRIT 降级**前面**，于是它返回 SHIELD，永远走不到降级那句。
  //   后果是**同一个判断有两套实现、两个结论**：
  //     · installSoulEffects 有自己的 deadCode 判据（第 90 轮加的）⇒ 照旧报 UNSUPPORTED；
  //     · interpretEffect（网页索引用它）⇒ 报 SHIELD/FULL，等于告诉用户"这件御魂能用"。
  //   ★ 上面第 [6] 节守的是**安装**那一侧，这一节守**判读**那一侧 —— 两侧都必须被守。
  const { interpretEffect } = await import("../soul/effect-system.ts");
  const critShield = { desc: "受到暴击时，自身100%概率获得1回合护盾，能吸收10%生命上限的伤害", trigger: "ON_CRIT" };
  const A = interpretEffect(critShield as any);
  ok("★★★ 同一段护盾文案：trigger=ON_CRIT ⇒ 必须 UNSUPPORTED（降级要排在任何句式匹配**之前**）",
    A.kind === "UNSUPPORTED", JSON.stringify(A));
  ok("★★★ 而且理由点的是**暴击事件没有派发点**，不是笼统的「文案没匹配到」",
    /暴击/.test(A.note), A.note);
  const B = interpretEffect({ ...critShield, trigger: "ON_DEAL_DAMAGE" } as any);
  ok("★★★ 反向：同一段文案换成一个**有派发点**的触发 ⇒ 必须是 SHIELD（区别在触发时机，不在文案）",
    B.kind === "SHIELD" && Math.abs(Number((B.params as any).ratio) - 0.10) < 1e-9, JSON.stringify(B));
  const jz = soulIdx.find((s: any) => s.n === "地藏像");
  ok("★★★ 网页索引里的地藏像也不许是 FULL（索引走的就是 interpretEffect）",
    !!jz && jz.engine.support !== "FULL" && jz.engine.effectKind === "UNSUPPORTED", JSON.stringify(jz?.engine));
  const full = soulIdx.filter((s: any) => s.engine.support === "FULL");
  ok("★★★ 索引口径：FULL 恰好 6 件（重建时曾变成 7 —— 那条 7 就是 bug 的形状）",
    full.length === 6, full.map((s: any) => s.n).join(","));
  const expectFull = ["招财猫", "火灵", "伤魂鸟", "蚌精", "钓瓶火", "无刀取"];
  ok("★★★ 而且索引的 6 件 FULL 与安装侧**逐件一致**（判读与安装不再各说各话）",
    full.map((s: any) => s.n).sort().join(",") === [...expectFull].sort().join(","),
    full.map((s: any) => s.n).join(","));
}

console.log("\n=== 御魂活性验收: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
