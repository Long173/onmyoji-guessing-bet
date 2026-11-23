// tests/g118-counter-cast.ts — ★★★ 第 239 轮：**计数器 → 满层免消耗施放**（百目鬼「鬼眸」293_02）
//
// 这是 §169「接触发」里"条件表达不了"的那一类中**唯一能直接落地**的一条：
//   · 产物：SkillIR.counterCast {name, threshold, perEvent, probability, skillRef, free, reset}
//     —— 载体是第 238 轮的合成状态 GHOST_EYE（不可驱散/不可解除，cap = threshold）；
//   · 执行：passive-runtime 注册 AFTER_DAMAGE 处理器（只认**敌方**来源 + **暴击**），
//     满层走第 237 轮的 free 通路（castTriggeredSkill + runPseudoTurn）。
//
// 本尺子的口径（每一档都要有**反向对照**，否则"接线了"和"没接线"看起来一样）：
//   ① 编译面：全库**恰好 1 条**带 counterCast，字段逐字对齐原文；
//   ② 装机面：处理器注册在**该单位**身上，敌方单位身上没有；OFF 档一条都不注册；
//   ③ 触发面：不暴击**不掷**、我方伤害**不掷**、暴击**每条掷一次**（掷数 == 事件数）；
//   ④ 幅度面：40% 是**真掷**出来的（200 次暴击的成功率落在 3σ 带内），不是写死的；
//   ⑤ 满层面：施放次数 == floor(成功次数 / 阈值)，残余层数 == 成功次数 % 阈值（放完清零）；
//   ⑥ 免消耗面：free 施放**不动鬼火池、不留 ORB_PAY**，同一门技能**不 free** 时会付费（双向）。
import fs from "node:fs";
import path from "node:path";
import { EV } from "../kernel/types.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const WHO = "百目鬼";
const REF = "293_03";
const CC_KEY = "counterCast";

sec("[1] ★★★ 编译面：全库恰好 1 条 counterCast，字段逐字对齐原文");
const dump: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "skill-ir.json"), "utf8"));
{
  const withCC = dump.filter((ir: any) => ir?.[CC_KEY]);
  ok("★★★ 带 counterCast 的技能恰好 1 条（**别的 817 条一个字不动**）", withCC.length === 1, JSON.stringify(withCC.map((ir: any) => ir.id)));
  const ir = withCC[0];
  ok("★★★ 就是百目鬼「鬼眸」293_02", !!ir && ir.id === "293_02" && ir.name === "鬼眸" && String(ir.charId) === "293", JSON.stringify(ir ? { id: ir.id, name: ir.name, charId: ir.charId } : null));
  const cc = ir?.[CC_KEY] ?? {};
  ok("★★★ 阈值/每击/概率/目标技能 = 5 / 1 / 40 / " + REF + "（原文「40%概率睁开1只鬼眸」「5只时免消耗施放」）",
    Number(cc.threshold) === 5 && Number(cc.perEvent) === 1 && Number(cc.probability) === 40 && String(cc.skillRef) === REF,
    JSON.stringify(cc));
  ok("★★★ 那条原文写了「免消耗」⇒ free=true、放完清零 ⇒ reset=true（**不替规格做决定**：只有原文写了才写）",
    cc.free === true && cc.reset === true, JSON.stringify({ free: cc.free, reset: cc.reset }));
  ok("★★ 计数器名字与状态定义同名（Theater 上「睁开的是几只鬼眸」要能对上）", String(cc.name) === "鬼眸", String(cc.name));
  /**
   * ★★★ 记账口径（与第 135 轮九命猫那条同型）：**有执行点的施放子句不许再报缺口**。
   *   否则报表会比现实**悲观** —— IR 里有 counterCast、运行时有处理器，而句子还挂着 MECHANIC_UNPARSED / 追加施放。
   */
  ok("★★★ 反向：这一条**不再**报「追加施放」缺口（全库从 6 条降到 5 条，见 tests/g89 的同一批断言）",
    !(ir.unmodeledMechanics ?? []).some((m: any) => m.verb === "追加施放"),
    JSON.stringify((ir.unmodeledMechanics ?? []).map((m: any) => m.verb)));
  ok("★★ 而且整句分类跟着走：点名的那个 [skill_293_03] 子句不再进 unparsed（否则两处账互相打架）",
    !(ir.unparsed ?? []).some((t: string) => /施放『\[skill_293_03\]』/.test(t)),
    JSON.stringify(ir.unparsed));
}

sec("[2] ★★★ 装机面（双向）：处理器注册在**自己**身上，敌方身上没有；OFF 档一条不注册");
const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return {
    unitId: "u-" + name, shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 20000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 },
    soulId: null,
  };
};
async function arena(who: string, passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", seed: number) {
  const m: any = canonicalMatch();
  m.red.units[0] = unit(who);
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives, traceLevel: "FULL" });
  await a.battle.runStartup();
  return { b: a.battle, e: a.battle.teams[0].members[0], foes: a.battle.teams[1].members };
}
const A = await arena(WHO, "PARSED_CANDIDATES_ONLY", 239);
const hid = "counterCast:" + A.e.id + ":鬼眸";
{
  ok("★★★ 处理器已注册（id = counterCast:<单位>:<技能>）", A.b.bus.hasHandler(hid) === true, hid);
  ok("★★★ 反向：**敌方**任何一个单位身上都没有这个处理器（不是全局挂上去的）",
    A.foes.every((f: any) => A.b.bus.hasHandler("counterCast:" + f.id + ":鬼眸") === false),
    JSON.stringify(A.foes.map((f: any) => f.id)));
  const off = await arena(WHO, "NOT_EXECUTED", 239);
  ok("★★★ 反向：OFF 档**一个处理器都不注册**（默认路径逐位不变）",
    off.b.bus.hasHandler("counterCast:" + off.e.id + ":鬼眸") === false && (off.b.passiveReport?.installed ?? []).length === 0,
    String((off.b.passiveReport?.installed ?? []).length));
}

sec("[3] ★★★ 触发面：只认「敌方 + 暴击」，且**每条暴击恰好掷一次**");
const stacksOf = (b: any) => { const st = (b.teams[0].members[0].statuses ?? []).find((x: any) => String(x?.def?.id) === "GHOST_EYE"); return Number(st?.stacks ?? 0); };
const rolls = (b: any) => (b.rng.draws ?? []).filter((d: any) => String(d.tag).startsWith("counter_prob:"));
const casts = (b: any, from = 0) => b.trace.slice(from).filter((t: any) => t.t === "SUBCAST" && String(t.ref) === REF);
const hit = (b: any, src: any, crit: boolean) => b.bus.dispatch(EV.AFTER_DAMAGE,
  { input: { source: src, target: b.teams[0].members[0] }, result: { isCrit: crit, applied: 100 } },
  src.id, src.teamId, (id: number) => b.teamOf(id));
{
  const foe = A.foes[0];
  const t0 = A.b.trace.length;
  for (let i = 0; i < 20; i++) await hit(A.b, foe, false);
  ok("★★★ **不暴击不掷**：20 次非暴击 ⇒ 0 次概率掷、0 层计数、0 次施放",
    rolls(A.b).length === 0 && stacksOf(A.b) === 0 && casts(A.b, t0).length === 0,
    JSON.stringify({ rolls: rolls(A.b).length, stacks: stacksOf(A.b), casts: casts(A.b, t0).length }));

  const mine = A.b.teams[0].members[1];
  for (let i = 0; i < 20; i++) await hit(A.b, mine, true);
  ok("★★★ **只认敌方来源**：我方单位暴击 20 次 ⇒ 依然 0 次掷、0 层（否则自己人帮自己攒层数）",
    rolls(A.b).length === 0 && stacksOf(A.b) === 0,
    JSON.stringify({ rolls: rolls(A.b).length, stacks: stacksOf(A.b) }));

  const N = 200;
  const t1 = A.b.trace.length;
  for (let i = 0; i < N; i++) await hit(A.b, foe, true);
  const got = rolls(A.b);
  const success = got.filter((d: any) => Number(d.v) < 0.4).length;
  const cast = casts(A.b, t1).length;
  ok("★★★ **每条暴击恰好掷一次**（掷数 == 事件数 " + N + "；多掷/少掷都会让 40% 变形）", got.length === N, String(got.length));
  ok("★★★ 概率标签带得出处（counter_prob:<计数器>:<技能> ⇒ 归因不是 unlabeled）",
    got.every((d: any) => /^counter_prob:鬼眸:/.test(String(d.tag))), JSON.stringify(got.slice(0, 2)));
  ok("★★★ 40% 是**真掷**出来的：成功率 " + (success / N * 100).toFixed(1) + "% 落在 3σ 带 [25%, 55%] 内",
    success / N >= 0.25 && success / N <= 0.55, success + "/" + N);
  const cap = 5;
  ok("★★★ **满 5 层才放**：施放次数 == floor(成功次数/5)（" + cast + " == floor(" + success + "/5)）",
    cast === Math.floor(success / cap), JSON.stringify({ cast, success }));
  ok("★★★ **放后清零**：残余层数 == 成功次数 % 5（放完那一瞬间回到 0，不是留着继续涨）",
    stacksOf(A.b) === success % cap, JSON.stringify({ stacks: stacksOf(A.b), expect: success % cap }));
  ok("★★ 探针有效性：这一轮至少真的放过一次（否则上面两条约束是空转）", cast >= 1, String(cast));
}

sec("[4] ★★★ 免消耗面（双向）：free 施放不动鬼火池、不留假付费事件；同一门技能不 free 时会付费");
{
  const t1 = A.b.trace.length;
  const orbsBefore = A.b.teams[0].orbs.current;
  const B = await arena(WHO, "PARSED_CANDIDATES_ONLY", 239);
  const sk3 = (B.e.skills ?? []).find((s: any) => String(s?.ir?.id ?? "") === REF);
  ok("★★ 前置：这门技能真的在百目鬼自己的技能表里（不然 SUBCAST 会是 SKILL_NOT_FOUND）", !!sk3, JSON.stringify((B.e.skills ?? []).map((s: any) => s?.ir?.id)));
  const cost = Number(sk3?.ir?.cost ?? sk3?.cost ?? 0);
  B.b.teams[0].orbs.gain(30);
  const before = B.b.teams[0].orbs.current;
  const tb = B.b.trace.length;
  const { castTriggeredSkill } = await import("../kernel/sub-cast.ts");
  const rFree = await castTriggeredSkill(B.b, B.e, { ref: REF, target: "ENEMY_ONE", free: true, clause: "探针" });
  const evFree = B.b.trace.slice(tb);
  ok("★★★ free：施放真的发生了（不是「没放所以没付费」）", rFree.fired === true, JSON.stringify(rFree));
  ok("★★★ free：**鬼火池一点没降**（cost = " + cost + "）", B.b.teams[0].orbs.current >= before, before + " → " + B.b.teams[0].orbs.current);
  ok("★★★ free：**没有** ORB_PAY / ORB_COST 这类假付费事件（留假的比不做更坏）",
    !evFree.some((e: any) => e.t === "ORB_PAY") && !evFree.some((e: any) => e.t === "ORB_COST"),
    JSON.stringify(evFree.map((e: any) => e.t).slice(0, 12)));
  /**
   * 反向对照：**同一条通路不 free**。
   *   ★ 判据必须是**事件**（ORB_PAY 的 amount），不能拿鬼火池的**净变化**当证据 ——
   *     第 239 轮实测：293_03「诅咒之眼」自己还会 `ORB_GAIN 3`（放完还火），于是
   *     「付费 3 → 退 3」的净变化正好是 0，用净额判会得出"没付费"这种与事实相反的结论。
   */
  const C = await arena(WHO, "PARSED_CANDIDATES_ONLY", 239);
  C.b.teams[0].orbs.gain(30);
  const tc = C.b.trace.length;
  const rPaid = await castTriggeredSkill(C.b, C.e, { ref: REF, target: "ENEMY_ONE", clause: "Probe" });
  const evPaid = C.b.trace.slice(tc);
  const payEv = evPaid.find((t: any) => t.t === "ORB_PAY" && t.actor === C.e.id);
  ok("★★★ 反向：同一条通路**不 free** ⇒ 真的派发了 ORB_PAY，且 amount == cost（" + (payEv?.amount ?? "无") + " / " + cost + "）—— 证明 free 那次的「没降」是**跳过支付**的效果，不是技能不要钱",
    rPaid.fired === true && !!payEv && Number(payEv.amount) === cost, JSON.stringify({ fired: rPaid.fired, pay: payEv ?? null, cost }));
  ok("★★ 而且这门技能自己会还火（ORB_GAIN requested == cost）—— 所以「净额」在这个技能上不可作判据（如实记账）",
    evPaid.some((t: any) => t.t === "ORB_GAIN" && Number(t.requested) === cost),
    JSON.stringify(evPaid.filter((t: any) => /^ORB_/.test(String(t.t)))));
  ok("★★ 这一轮（200 次暴击）里鬼火池同样没有被计数施放改动", A.b.teams[0].orbs.current >= orbsBefore && !A.b.trace.slice(t1).some((e: any) => e.t === "ORB_PAY"),
    orbsBefore + " → " + A.b.teams[0].orbs.current);
}


sec("[5] ★★★ 事故留痕（本轮尺子抓到的第一版错误）：不可解除的计数器，用 Entity.remove 清会**静默失败**");
{
  const { ghostEyeDef, GHOST_EYE_ID } = await import("../kernel/status.ts");
  const D = await arena(WHO, "PARSED_CANDIDATES_ONLY", 239);
  D.e.addStatus(ghostEyeDef("鬼眸"), D.e.id, 5, 99999, [], 5);
  const got = (D.e.statuses ?? []).find((x: any) => String(x?.def?.id) === GHOST_EYE_ID);
  ok("★★ 前置：计数器真的挂上了（5 层）", !!got && Number(got.stacks) === 5, JSON.stringify({ stacks: got?.stacks }));
  ok("★★★ 反例：Entity.remove(不可解除的状态) 返回 **false 且什么都不做**（返回值没人看 ⇒ 静默跑偏）",
    D.e.remove(GHOST_EYE_ID) === false && (D.e.statuses ?? []).some((x: any) => String(x?.def?.id) === GHOST_EYE_ID),
    JSON.stringify({ remove返回: D.e.remove(GHOST_EYE_ID), 还在: (D.e.statuses ?? []).some((x: any) => String(x?.def?.id) === GHOST_EYE_ID) }));
  ok("★★★ 正例：内部「把计数花掉」走 expireStatus ⇒ 真的清掉（仓库里 self-revive / steal / summon / damage 四处同一条）",
    (() => { const s2 = (D.e.statuses ?? []).find((x: any) => String(x?.def?.id) === GHOST_EYE_ID); return !!s2 && D.e.expireStatus(s2) === true && !(D.e.statuses ?? []).some((x: any) => String(x?.def?.id) === GHOST_EYE_ID); })(),
    JSON.stringify((D.e.statuses ?? []).map((x: any) => x?.def?.id)));
  /** 同类错误不许只修一处：把生产代码里所有 .remove( 调用点**具名**列出来（含反例断言） */
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d: any) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : (d.name.endsWith(".ts") && !d.name.startsWith("_") ? [path.join(dir, d.name)] : []));
  const srcFiles = [...walk(path.join(ROOT, "battle-lab", "compile")), ...walk(path.join(ROOT, "battle-lab", "kernel"))];
  const hits: string[] = [];
  for (const f of srcFiles) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((line: string, i: number) => { if (/\.remove\(/.test(line)) hits.push(path.relative(path.join(ROOT, "battle-lab"), f).replace(/\\/g, "/") + ":" + (i + 1) + "  " + line.trim()); });
  }
  console.log("    .remove( 的全部调用点：\n      " + hits.join("\n      "));
  ok("★★★ 生产代码里拿 remove 清**状态**的只有官方[1]解除那一条（character.ts 的 vic.remove(st.def.id)）；grep 面 0 处 remove(GHOST_EYE_ID)",
    hits.some((h: string) => /character\.ts:\d+\s+const gone = /.test(h)) && !hits.some((h: string) => /remove\(GHOST_EYE_ID/.test(h)),
    JSON.stringify(hits));
}

sec("[6] ★★★ Theater / Delta 可见性（第 240 轮补）：计数与清零都走**既有** trace 词汇，不新增类型");
{
  const T = await arena(WHO, "PARSED_CANDIDATES_ONLY", 239);
  const foe2 = T.foes[0];
  const t0 = T.b.trace.length;
  for (let i = 0; i < 60; i++) await hit(T.b, foe2, true);
  const ev = T.b.trace.slice(t0);
  const applies = ev.filter((x: any) => x.t === "STATUS_APPLY" && String(x.status) === "GHOST_EYE");
  const expires = ev.filter((x: any) => x.t === "STATUS_EXPIRE" && String(x.status) === "GHOST_EYE");
  const rolls2 = (T.b.rng.draws ?? []).filter((d: any) => String(d.tag).startsWith("counter_prob:"));
  const success2 = rolls2.filter((d: any) => Number(d.v) < 0.4).length;
  const casts2 = ev.filter((x: any) => x.t === "SUBCAST" && String(x.ref) === REF).length;
  ok("★★★ 每次成功计数都留一条 STATUS_APPLY（= " + success2 + " 条；与 40% 的掷数一一对应）",
    applies.length === success2, applies.length + " vs " + success2);
  ok("★★★ 层数字段从 1 涨到 5 —— Theater 上读得出「睁开第几只」（Banner 显示 层数 x / 5）",
    applies.length > 0 && applies.every((x: any) => Number(x.stacks) >= 1 && Number(x.stacks) <= 5) && applies.some((x: any) => Number(x.stacks) === 5),
    JSON.stringify(applies.map((x: any) => x.stacks).slice(0, 14)));
  /**
   * ★ merged 的正确判据不是「只有第一条 false」—— 每**清零之后**的那一次成功又是 1 层（merged=false），
   *   所以判据必须挂在**层数**上：merged === (stacks > 1)（merged 的含义是"并进了已存在的状态"）。
   *   那是断言写错，不是代码错（读数见下：st1 那条 merged:false stacks:1，紧接着 merged:true stacks:2）。
   */
  ok("★★ 上限 / 名字 / 标记都在（threshold=5、name=鬼眸、note=COUNTER_STACK），且 merged 严格跟着层数走",
    applies.every((x: any) => Number(x.threshold) === 5 && x.name === "鬼眸" && x.note === "COUNTER_STACK") &&
    applies.every((x: any) => x.merged === (Number(x.stacks) > 1)),
    "违例=" + JSON.stringify(applies.filter((x: any) => x.merged !== (Number(x.stacks) > 1)).map((x: any) => ({ stacks: x.stacks, merged: x.merged }))));
  ok("★★ 而且「新一轮的第 1 层」条数 == 清零次数 + （末态还有剩余层数 ? 1 : 0）—— 轮次分界在 trace 上数得出来",
    applies.filter((x: any) => x.merged === false).length === expires.length + (Number(applies[applies.length - 1]?.stacks ?? 0) > 0 && Number(applies[applies.length - 1]?.stacks ?? 0) < 5 ? 1 : 0),
    JSON.stringify({ freshStarts: applies.filter((x: any) => x.merged === false).length, expires: expires.length, lastStacks: applies[applies.length - 1]?.stacks }));
  ok("★★★ 清零同样可见，且**被消耗 ≠ 到期**（reason=COUNTER_SPENT ⇒ Presenter 显示「消耗」而不是「到期」）",
    expires.length >= 1 && expires.every((x: any) => x.reason === "COUNTER_SPENT" && Number(x.stacks) === 5),
    JSON.stringify(expires.slice(0, 3)));
  ok("★★★ 三本账对齐：清零次数 == 施放次数 == floor(成功/5)（" + expires.length + " / " + casts2 + " / " + Math.floor(success2 / 5) + "）",
    expires.length === casts2 && casts2 === Math.floor(success2 / 5), JSON.stringify({ expires: expires.length, casts: casts2, success: success2 }));
  const beforeNd = T.b.trace.length;
  for (let i = 0; i < 20; i++) await hit(T.b, foe2, false);
  ok("★★★ 反向：20 次非暴击 ⇒ 一条计数器痕迹都没有（不许有「假可见性」）",
    !T.b.trace.slice(beforeNd).some((x: any) => String(x.status) === "GHOST_EYE"),
    JSON.stringify(T.b.trace.slice(beforeNd).map((x: any) => x.t)));
}

console.log("\ng118-counter-cast: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
