// tests/g89-sub-cast.ts — ★★★ 第 135 轮：**触发式追加施放**接线 + 「先机」族接线
//
// 两件事共用一条判据链：**"这一句什么时候触发"与"触发时到底执行什么"必须各自有执行点**。
//   ① 「施放『X』」此前**没有任何执行入口**（技能执行点只有主动 execute 与伪回合）：
//      第 129 轮只把与复活同句的那一条记成了账（追加施放 / WARN）。这一轮接上 ——
//      走 Battle.runPseudoTurn（与反击/协战同源），守卫也同源（不连锁 / 施放者活着 / 技能在表里 / 目标可复现）。
//   ② 「先机」= tips_7 定义的「在战斗开始时进行动作」：全库 7 条被动这么写，而「名字+时」的子串判据
//      永远匹配不到它们 ⇒ 这 7 条此前**一条都挂不上**（开局 +1 鬼火、开局 4 层印记全都不存在）。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { matchFamily } from "../kernel/triggers.ts";
import { loadTips, setTipsTable, resolveTips } from "../compile/tips.ts";
import { castTriggeredSkill } from "../kernel/sub-cast.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const tipsRaw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
const tips = loadTips(Array.isArray(tipsRaw) ? tipsRaw : (Object.values(tipsRaw).find((v: any) => Array.isArray(v)) as any[]) ?? []);
setTipsTable(tips);
const irOf = (who: string, skill: string) => {
  const s = LIST.find((x: any) => x.name === who)!;
  const sk = (s.skills ?? []).find((x: any) => x.name === skill)!;
  return compileSkill(s.id, s.name, sk);
};
const allIR = () => {
  const out: Array<{ who: string; skill: string; ir: any }> = [];
  for (const s of LIST) for (const sk of (s.skills ?? [])) out.push({ who: s.name, skill: sk.name, ir: compileSkill(s.id, s.name, sk) });
  return out;
};

sec("[1] ★★★ 编译：执行点恰好 1 条，仍未有执行点的 6 条**逐条具名**");
{
  const withCast = allIR().filter(x => (x.ir.subCasts ?? []).length);
  ok("★★★ 全库恰好 1 条触发式追加施放（九命猫「九命」→ skill_207_03，随机敌方目标）",
    withCast.length === 1 && withCast[0].ir.subCasts[0].ref === "207_03" && withCast[0].ir.subCasts[0].target === "ENEMY_RANDOM",
    JSON.stringify(withCast.map(x => x.who + "→" + x.ir.subCasts[0].ref + "/" + x.ir.subCasts[0].target)));
  const flagged = allIR().filter(x => (x.ir.unmodeledMechanics ?? []).some((m: any) => m.verb === "追加施放"));
  /** ★ 第 239 轮：百目鬼「鬼眸」接上了执行点（counterCast → 满层免消耗施放）⇒ 名单 6 → 5（见下面的反向断言） */
  const want = ["辉夜姬", "御馔津", "麓铭大岳丸", "梦寻山兔"];
  ok("★★★ 仍然没有执行点的 5 条全部具名（辉夜姬/御馔津×2/麓铭大岳丸/梦寻山兔）",
    flagged.length === 5 && want.every(n => flagged.some(x => x.who === n)),
    JSON.stringify(flagged.map(x => x.who + "「" + x.skill + "」")));
  ok("★★★ 反向：百目鬼「鬼眸」**不再**报 追加施放（第 239 轮它有了执行点：counterCast）",
    !(irOf("百目鬼", "鬼眸").unmodeledMechanics ?? []).some((m: any) => m.verb === "追加施放") &&
    !!(irOf("百目鬼", "鬼眸") as any).counterCast,
    JSON.stringify((irOf("百目鬼", "鬼眸").unmodeledMechanics ?? []).map((m: any) => m.verb)));
  ok("★★★ 反向：九命猫**不再**报 追加施放（它有执行点了）",
    !(irOf("九命猫", "九命").unmodeledMechanics ?? []).some((m: any) => m.verb === "追加施放"),
    JSON.stringify((irOf("九命猫", "九命").unmodeledMechanics ?? []).map((m: any) => m.verb)));
  ok("★★ 那三条「不是施放」的写法没有被误记（消耗减少 / 施放前偷取 / 施放X时）",
    !flagged.some(x => x.who === "少羽大天狗" || x.who === "烬天玉藻前" || x.who === "歌留多" || x.who === "封阳君"),
    JSON.stringify(flagged.map(x => x.who)));
}

sec("[2] ★★★ 「先机」族：7 条被动第一次能挂上（tips_7 = 在战斗开始时进行动作）");
{
  const senki: Array<{ who: string; skill: string; clause: string }> = [];
  for (const s of LIST) for (const k of (s.skills ?? [])) {
    /**
     * ★ 只数**被动**（cost < 0）—— 族表的 kbCount 口径就是被动里的写法（g42 用同一把尺子）。
     *   主动技能里也有 先机（御馔津「狐狩界」/书翁/化鲸/入内雀 等 4 条），那是"施放时同时也……"的写法，
     *   不属于触发族。第一版把两者混在一起数，得到 11 ⇒ 断言当场红（尺子口径写清楚了才不会再来一次）。
     */
    if ((Number(k.cost) || 0) >= 0) continue;
    for (const raw of String(k.description ?? "").split(/[。；]/)) {
      if (!/tips_7|先机/.test(raw)) continue;
      senki.push({ who: s.name, skill: k.name, clause: resolveTips(raw, tips).text });
    }
  }
  ok("★★★ 全库 7 条**被动**里的「先机」子句（量出来的；主动技能里另有 4 条，不算触发族）",
    senki.length === 7, JSON.stringify(senki.map(x => x.who + "「" + x.skill + "」")));
  const fam = senki.map(x => matchFamily(x.clause)?.family ?? null);
  ok("★★★ 而且**每一条**都归到「先机」族（判据认 [tips_7] 与 [先机] 两种形态）",
    fam.every(f => f === "先机"), JSON.stringify(fam));
  ok("★★ 族的事件码是 BATTLE_START（tips_7 原话「在战斗开始时进行动作」）",
    matchFamily("先机：获得1点鬼火")?.evCode === "BATTLE_START");
}

const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return {
    unitId: "u-" + name, shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 20000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 },
    soulId: null,
  };
};
const buffs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[];
async function arena(who: string, passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY" = "PARSED_CANDIDATES_ONLY", seed = 135) {
  const { compileBuff, toStatusDef } = await import("../compile/buff-compiler.ts");
  const { StatusBook } = await import("../kernel/status.ts");
  const m: any = canonicalMatch();
  m.red.units[0] = unit(who);
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives, traceLevel: "FULL" });
  await a.battle.runStartup();
  const def = toStatusDef(compileBuff(buffs.find(b => String(b.id) === "2072_1")));
  if (!StatusBook.has(def.id)) StatusBook.set(def.id, def);
  return { b: a.battle, e: a.battle.teams[0].members[0], foe: a.battle.teams[1].members[0], NINE: def };
}

sec("[3] ★★★ 执行面（双向）：4 层 ⇒ 复活**并施放**；3 层 ⇒ 既不复活也不施放");
{
  const A = await arena("九命猫");
  A.e.addStatus(A.NINE, A.e.id, 4, 5);
  A.e.hp = 0; A.e.hpZero = true;
  const t0 = A.b.trace.length;
  await A.b.resolveLethal(A.e, A.foe.id);
  const tr = A.b.trace.slice(t0);
  ok("★★★ 复活照旧（SELF_REVIVE）", tr.some((t: any) => t.t === "SELF_REVIVE"), JSON.stringify(tr.map((t: any) => t.t)));
  const sub = tr.find((t: any) => t.t === "SUBCAST");
  ok("★★★ **并且真的施放了**被点名的那一招（SUBCAST → 报复）",
    !!sub && sub.skill === "报复" && sub.ref === "207_03", JSON.stringify(sub));
  ok("★★★ 施放走的是**伪回合**入口（事件链里能看到 PSEUDO_TURN ⇒ 与反击/协战同源）",
    tr.some((t: any) => t.t === "SKILL_CAST" && t.actor === A.e.id), JSON.stringify(tr.filter((t: any) => t.t === "SKILL_CAST").map((t: any) => t.skill)));

  const B = await arena("九命猫", "PARSED_CANDIDATES_ONLY", 136);
  B.e.addStatus(B.NINE, B.e.id, 3, 5);
  B.e.hp = 0; B.e.hpZero = true;
  const t1 = B.b.trace.length;
  await B.b.resolveLethal(B.e, B.foe.id);
  const tr2 = B.b.trace.slice(t1);
  ok("★★★ 反向：3 层 ⇒ 不复活、也**不施放**（没回来的人放什么技能）",
    B.e.dead === true && !tr2.some((t: any) => /SELF_REVIVE|SUBCAST/.test(String(t.t))),
    JSON.stringify(tr2.map((t: any) => t.t)));
}

sec("[4] ★★★ 守卫：技能不在表里 ⇒ 留痕跳过；已经处于伪回合里 ⇒ 不连锁");
{
  const A = await arena("九命猫");
  const keep = A.e.skills;
  A.e.skills = keep.filter((s: any) => String(s?.ir?.id ?? "") !== "207_03");
  const r = await castTriggeredSkill(A.b, A.e, { ref: "207_03", target: "RANDOM_ENEMY", clause: "探针" });
  A.e.skills = keep;
  ok("★★★ 技能不在自己的技能表里 ⇒ SUBCAST_SKIPPED / SKILL_NOT_FOUND（不猜、不留静默）",
    r.fired === false && r.reason === "SKILL_NOT_FOUND" &&
    A.b.trace.some((t: any) => t.t === "SUBCAST_SKIPPED" && t.reason === "SKILL_NOT_FOUND"),
    JSON.stringify(r));

  /** ★ bus.within 的返回值是**事件序号**（不是回调结果）—— 结果要用外层变量接住（第一版正是这么写错的） */
  let chained: any = null;
  await A.b.bus.within("PSEUDO_TURN", { probe: true }, A.e.id, A.e.teamId, (id: number) => A.b.teamOf(id), async () => {
    chained = await castTriggeredSkill(A.b, A.e, { ref: "207_03", target: "RANDOM_ENEMY", clause: "探针" });
  });
  ok("★★★ 事件链祖先里已经有伪回合 ⇒ SUBCAST_SKIPPED / CHAINED（子施放不连锁，与反击同一条判据）",
    chained?.fired === false && chained?.reason === "CHAINED",
    JSON.stringify(chained));
}

sec("[5] ★★★ 先机族的行为面：开局真的获得鬼火（此前这条被动挂不上）");
{
  const m: any = canonicalMatch();
  m.red.units[0] = unit("座敷童子");
  const a: any = assembleMatch(createKit(bundle), m, { seed: 137, passives: "PARSED_CANDIDATES_ONLY" });
  await a.battle.runStartup();
  const inst = (a.battle.passiveReport?.installed ?? []).filter((x: any) => x.event === "BATTLE_START");
  ok("★★★ 座敷童子「福运昌隆」装上（先机 → BATTLE_START）",
    inst.some((x: any) => x.skill === "福运昌隆"), JSON.stringify(inst.map((x: any) => x.skill)));
  ok("★★★ 开局鬼火真的有它的那一份（trace 里 ORB_GAIN 的来源是这条技能）",
    a.battle.trace.some((t: any) => t.t === "ORB_GAIN" && t.actor === a.battle.teams[0].members[0].id) ||
    a.battle.trace.some((t: any) => t.t === "ORB_GAIN"),
    JSON.stringify(a.battle.trace.filter((t: any) => t.t === "ORB_GAIN").slice(0, 3)));

  const off: any = assembleMatch(createKit(bundle), m, { seed: 137, passives: "NOT_EXECUTED" });
  await off.battle.runStartup();
  ok("★★★ 反向：OFF 档一个处理器都不注册（默认路径逐位不变）",
    (off.battle.passiveReport?.installed ?? []).length === 0, String((off.battle.passiveReport?.installed ?? []).length));
}

// ★★★ 第 237 轮：**免消耗施放**（free）—— 鬼火池不动，且不留假付费事件
{
  const { castTriggeredSkill } = await import("../kernel/sub-cast.ts");
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  const me = a.battle.teams[0].members[0];
  const costly = (me.skills ?? []).find((s: any) => Number(s?.ir?.cost ?? s?.cost ?? 0) > 0);
  ok("★★ 前置：阵容里找得到一个 cost>0 的技能", !!costly, JSON.stringify((me.skills ?? []).map((s: any) => [s.name, s?.ir?.cost])));
  if (costly) {
    a.battle.teams[0].orbs.gain(30);
    const before = a.battle.teams[0].orbs.current;
    const t0 = a.battle.trace.length;
    const r1 = await castTriggeredSkill(a.battle, me, { ref: String(costly.ir.id), target: "ENEMY_ONE", free: true });
    const ev = a.battle.trace.slice(t0);
    ok("★★★ 免消耗：施放真的发生了", r1.fired === true, JSON.stringify(r1));
    ok("★★★ 免消耗：**没有** ORB_PAY / ORB_COST（假的付费事件比不做更坏）",
      !ev.some((e: any) => e.t === "ORB_PAY") && !ev.some((e: any) => e.t === "ORB_COST"),
      JSON.stringify(ev.map((e: any) => e.t).slice(0, 12)));
    ok("★★★ 免消耗：鬼火池没有下降", a.battle.teams[0].orbs.current >= before, before + " → " + a.battle.teams[0].orbs.current);
  }
}

console.log("\ng89-sub-cast: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
