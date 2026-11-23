// tests/g62-form-summon.ts — ★★★ 第 101 轮：**自身形态类放置单位**（姿态 / 化身）（目标 ⑨）
//
// 第 98 轮把放置单位的**运行时**建好了，但明说缺一样东西：**编译层没有触发者**（effects.ts 的 Summon 条是 PARTIAL+ORPHAN）。
// 这一轮补第一块触发者：技能原文里的 [tips_N]姿态 ⇒ 认出「本体离场、形态上场」。
//   · 神堕八岐大蛇「神堕之力」：施放化身[蛇神]姿态（ON_CAST，回归时机写在 tips 里）
//   · 百羽凤凰火「未熄羽」：受到致命伤害时进入[余烬]姿态（ON_LETHAL + 到达行动条终点后复活）
//
// ★ 这一轮**只执行** returnOn=SUMMON_DEATH 的形态（蛇神）。余烬要等「形态单位自己会行动」（第 98 轮声明的空缺）——
//   进一个永远回不来的形态是**做错**，不是少做，所以它被明确拒绝并留痕。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { compileSkill } from "../compile/skill-compiler.ts";
import { loadTips, setTipsTable, tipsTable } from "../compile/tips.ts";
import { enterForm, formOwnerOf, FORM_OFF_FIELD_STATUS } from "../kernel/summon.ts";
import { TurnType } from "../kernel/types.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const isOnmyoji = (n: string) => /晴明|神乐|八百比丘尼|源博雅/.test(n);
/**
 * ★★ tips 表必须由入口设置（第 101 轮去掉了模块内的文件兜底：它会给 web 侧带来 node:fs 依赖，
 *   而且"没设置就静默空表"正是本项目最忌讳的静默失效）。这里显式设置，并**断言表非空**。
 */
{
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
  const list = Array.isArray(raw) ? raw : (Object.values(raw).find((v: any) => Array.isArray(v)) as any[]) ?? [];
  setTipsTable(loadTips(list));
}
const irOf = (shiki: string, skill: string) => {
  const s = LIST.find(x => x.name === shiki)!;
  const k = (s.skills ?? []).find((y: any) => y.name === skill)!;
  return compileSkill(s.id, s.name, k) as any;
};

sec("[1] 编译普查：全库只有 3 处「[tips_N]姿态」，其中 2 处是形态、1 处必须给理由")
{
  const hits: Array<{ who: string; ir: any }> = [];
  const skips: string[] = [];
  for (const s of LIST) {
    if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) {
      const ir: any = compileSkill(s.id, s.name, k);
      if (ir.forms) hits.push({ who: s.name + "「" + k.name + "」", ir });
      for (const x of (ir.formSkips ?? [])) skips.push(s.name + "「" + k.name + "」" + x.reason);
    }
  }
  ok("★★★ 前置：tips 表已设置且非空（漏设置会静默少解析 —— 这条断言就是防它的）", tipsTable().size > 100, String(tipsTable().size));
  /**
   * ★★★ 第 103 轮：这条断言的**期望值按事实改写**：2 → **4**。
   *   原因不是"多收了两条脏数据"，而是第 103 轮把另外两类放置也收进了同一个 IR 字段：
   *     · 自身形态（SELF）：神堕八岐大蛇「神堕之力」、百羽凤凰火「未熄羽」；
   *     · 镇压式（ENEMY + seal）：须佐之男「神之领域」→ 雷冢；
   *     · 击杀式（ON_KILL）：雪御前「龙胆·绽」→ 龙胆蓝璃。
   *   三类**必须能分辨**，所以断言改成按类计数，而不是只数总数。
   */
  const byClass = (pred: (f: any) => boolean) => hits.filter(h => (h.ir.forms ?? []).some(pred)).map(h => h.who);
  ok("★★★ 带放置声明的技能共 8 条：形态类 4（自身形态 2 / 镇压 1 / 击杀 1）+ 召唤物类 4（第 110 轮接线，kind=SUMMON）",
    hits.length === 8 &&
    byClass(f => f.kind !== "SUMMON" && f.placement === "SELF" && f.returnOn !== "NONE").length === 2 &&
    byClass(f => f.placement === "ENEMY" && f.seal === true).length === 1 &&
    byClass(f => f.trigger === "ON_KILL").length === 1 &&
    byClass(f => f.kind === "SUMMON").length === 4,
    JSON.stringify({ total: hits.length, form: byClass(f => f.kind !== "SUMMON"), summon: byClass(f => f.kind === "SUMMON") }));
  ok("★★★ 第 3 处被记成 PLACEMENT_UNKNOWN：审判仪式写的是「[tips_3831]姿态下可施放」= 这个姿态下能放什么，不是放置动作",
    skips.some(x => x.includes("审判仪式") && x.includes("PLACEMENT_UNKNOWN")), JSON.stringify(skips));

  const snake = irOf("神堕八岐大蛇", "神堕之力").forms[0];
  ok("★★★ 蛇神：ON_CAST（「施放化身[蛇神]姿态」）+ 己方放置", snake.tipsId === "3831" && snake.trigger === "ON_CAST" && snake.placement === "SELF");
  ok("★★★ 回归时机来自 **tips 原文**（「本体重新回到场上」），不是默认值套上去的",
    snake.returnOn === "SUMMON_DEATH" && snake.returnOnSource === "TIPS", JSON.stringify([snake.returnOn, snake.returnOnSource]));
  ok("★★ 生命基准来自 tips：神堕八岐大蛇攻击 200%", snake.spec.hp?.prop === "atk" && snake.spec.hp?.ratio === 2, JSON.stringify(snake.spec.hp));
  ok("★★ 免疫减益与放逐被一起带进规格", ["DEBUFF", "BANISH"].every(k => snake.spec.immuneTo.includes(k)), JSON.stringify(snake.spec.immuneTo));

  const ember = irOf("百羽凤凰火", "未熄羽").forms[0];
  ok("★★★ 余烬：ON_LETHAL（「受到致命伤害时…进入」）+ 回归时机 TIMELINE_END（tips：「到达行动条终点后复活」）",
    ember.tipsId === "6071" && ember.trigger === "ON_LETHAL" && ember.returnOn === "TIMELINE_END" && ember.returnOnSource === "TIPS",
    JSON.stringify([ember.trigger, ember.returnOn, ember.returnOnSource]));
}

sec("[2] ★★★ 内核行为：本体离场 → 形态上场 → 形态阵亡 → 本体回来")
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.runStartup();
  const b = a.battle;
  const owner = b.teams[0].members[0];
  const form = irOf("神堕八岐大蛇", "神堕之力").forms[0];
  ok("★ 前置：入场前本体是正常状态（可被选中、transformed=false）",
    owner.caps.canBeTargeted === true && owner.transformed === false);
  const expectHp = Math.max(1, Math.round(owner.base.atk * 2));
  const r = enterForm(b, owner, form, { hasSkills: false });
  ok("★★★ 形态单位被造出来了（第 98 轮那个「没有任何地方往容器里放单位」的正面反证）", r.ok === true && !!r.summon);
  ok("★★★ 生命 = 本体**初始**攻击 × 200%（tips 的算法）", r.summon!.maxHp === expectHp, r.summon!.maxHp + " vs " + expectHp);
  ok("★★★ 本体离场：不可被选中 + transformed=true（这两个字段此前在生产路径上**从来没有写入方**）",
    owner.caps.canBeTargeted === false && owner.transformed === true);
  ok("★★★ 本体还挂着「形态离场」状态（无法动作 + 锁条）—— 离场不等于消失，它还能被计数",
    owner.statuses.some((s: any) => s.def.id === FORM_OFF_FIELD_STATUS) && owner.statuses.some((s: any) => s.def.id === FORM_OFF_FIELD_STATUS && s.def.preventsAction === true));
  ok("★★ 关系记在 notes 里（存档字段）⇒ 续跑之后仍然知道这是谁的形态", formOwnerOf(r.summon!) === owner.id, String(formOwnerOf(r.summon!)));
  ok("★★ 形态免疫减益与放逐（挂成了真状态）",
    r.summon!.statuses.some((s: any) => (s.def.immuneTo ?? []).includes("BANISH")), String(r.summon!.statuses.length));
  /**
   * ★★★ 第 102 轮：这条断言**按事实改写**。第 101 轮写的是「没有技能表的单位不进行动条」
   *   （那时怕它在回合里空转）；第 102 轮发现空转本身是安全的，而且**余烬必须进行动条**
   *   （它的回归时机是"到达行动条终点"）。现在：照样进行动条，但"为什么什么都不做"必须留痕。
   */
  ok("★★★ 没有技能表的单位**照样进行动条**（余烬要靠它到终点），而且写明理由",
    r.summon!.notes.includes("summon:NO_SKILLS") && !!b.timeline.get(r.summon!.id) &&
    b.trace.some((t: any) => t.t === "SUMMON_NO_SKILLS" && t.summon === r.summon!.id));
  ok("★ 事件链留痕 FORM_ENTER（Theater 看得到）", b.trace.some((t: any) => t.t === "FORM_ENTER" && t.owner === owner.id && t.tipsId === "3831"));

  const summonsBefore = b.teams[0].summons.length;
  const hpBefore = owner.hp;   // 施放式形态：本体离场期间不会掉血 ⇒ 这一档是 PRESERVED
  await (b as any).resolveLethal(r.summon!, 0);
  ok("★★★ 形态阵亡 ⇒ 本体回到场上（tips：「受到致命伤害时，本体重新回到场上」）",
    owner.caps.canBeTargeted === true && owner.transformed === false && owner.alive === true,
    JSON.stringify({ can: owner.caps.canBeTargeted, tr: owner.transformed, alive: owner.alive, hp: owner.hp }));
  ok("★★★ 施放式形态的回归：**原生命值**回来，并且事件里标的是 PRESERVED（不是把保留说成默认 1 点）",
    owner.hp === hpBefore && b.trace.some((t: any) => t.t === "FORM_RETURN" && t.returnHp === "PRESERVED" && t.owner === owner.id),
    owner.hp + " vs " + hpBefore);

  // ★ 另一档：本体是**被打到 0 血**才进入形态的（致命伤害式）⇒ 回归只能按最低可存活值 1 点，且必须记账
  {
    const c: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 8 });
    await c.battle.runStartup();
    const o2 = c.battle.teams[0].members[2];
    const s2 = enterForm(c.battle, o2, form, { hasSkills: false }).summon!;
    o2.hp = 0; o2.alive = false; o2.dead = true;      // 模拟"被打到致命伤害才进的形态"
    await (c.battle as any).resolveLethal(s2, 0);
    ok("★★★ 致命伤害式形态的回归：以 1 点生命回来，且事件里标 DEFAULT_1（默认值要看得见）",
      o2.alive === true && o2.hp === 1 && c.battle.trace.some((t: any) => t.t === "FORM_RETURN" && t.returnHp === "DEFAULT_1" && t.owner === o2.id),
      JSON.stringify({ alive: o2.alive, hp: o2.hp }));
  }
  ok("★★ 离场状态被撤掉（否则本体回来了却永远不能行动）", !owner.statuses.some((s: any) => s.def.id === FORM_OFF_FIELD_STATUS));
  ok("★ 形态单位本身仍然留在容器里（阵亡 ≠ 抹掉，守恒：召唤物数不减）", b.teams[0].summons.length === summonsBefore);
}

sec("[3] ★★★ 余烬：第 102 轮起**可以入场**了（回归时机=到达行动条终点）")
{
  /**
   * ★★ 这一节第 101 轮写的是"余烬必须被拒绝"（那时回归时机只支持"形态阵亡"）。
   *   第 102 轮把「到达行动条终点 = 轮到它行动」这个钩子接上之后，拒绝的理由消失了 ⇒ **断言按事实整体改写**。
   *   旧断言不删掉、而是换成新事实的正反两面：进场（这一节）与回归（§5）。
   */
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 7 });
  await a.battle.runStartup();
  const b = a.battle;
  const owner = b.teams[0].members[1];
  const ember = irOf("百羽凤凰火", "未熄羽").forms[0];
  const before = b.teams[0].summons.length;
  const r = enterForm(b, owner, ember, { hasSkills: false });
  ok("★★★ 现在能入场了（第 101 轮这里要求它被拒绝）", r.ok === true && !!r.summon, JSON.stringify({ ok: r.ok, reason: r.reason ?? null }));
  ok("★★★ 形态单位进了容器，本体离场", b.teams[0].summons.length === before + 1 && owner.caps.canBeTargeted === false);
  ok("★★★ 而它**仍然没有技能表**（余烬没有任何「姿态下可施放」的技能）⇒ 如实记 NO_SKILLS",
    r.summon!.skills.length === 0 && r.summon!.notes.includes("summon:NO_SKILLS"));
  ok("★★★ 但它**在行动条里** —— 否则永远到不了终点、本体永远回不来（第 102 轮放开的那一条）",
    !!b.timeline.get(r.summon!.id));
  ok("★★ 回归时机记在 notes 里（存档字段）⇒ 续跑之后仍然知道该怎么回来",
    r.summon!.notes.includes("form:returnOn=TIMELINE_END"));

  // 反向：**认不出来**的回归时机仍然必须被拒绝（解析器将来加了新档而运行时没跟上）
  const before2 = b.teams[0].summons.length;
  const r2 = enterForm(b, b.teams[0].members[2], { ...ember, returnOn: "SOMETHING_NEW" as any }, { hasSkills: false });
  ok("★★★ 反向：未知的回归时机仍然被拒绝（不许猜），且**没有**半进场",
    r2.ok === false && r2.reason === "RETURN_ON_UNSUPPORTED" && b.teams[0].summons.length === before2,
    JSON.stringify({ ok: r2.ok, reason: r2.reason ?? null, n: b.teams[0].summons.length }));
  ok("★★ 拒绝留痕（FORM_SKIPPED + 原因）",
    b.trace.some((t: any) => t.t === "FORM_SKIPPED" && t.reason === "RETURN_ON_UNSUPPORTED"));
}

sec("[4] ★★★ 端到端：真实技能施放路径（强制施放，不依赖 AI 选技）")
{
  const SNAKE = LIST.find(s => s.name === "神堕八岐大蛇")!;
  ok("★ 前置：知识库里有「神堕八岐大蛇」", !!SNAKE);
  const m = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: SNAKE.id, name: "神堕八岐大蛇" };
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261003 });
  await a.battle.runStartup();
  const b = a.battle;
  const self = b.teams[0].members[0];
  const sk = self.skills.find((x: any) => x.name === "神堕之力");
  ok("★ 前置：本体确实带着这个技能（否则这一段是空跑）", !!sk && !!sk.ir?.forms?.length, String(self.skills.map((x: any) => x.name).join(",")));
  const foe = b.teams[1].members[0];
  await b.runPseudoTurn(self, TurnType.PSEUDO_TURN, { skill: sk, target: foe });
  const enter = b.trace.find((t: any) => t.t === "FORM_ENTER" && t.owner === self.id);
  ok("★★★ 真实执行路径产生了 FORM_ENTER（不是只有内核函数能跑）", !!enter, JSON.stringify(enter ?? null));
  ok("★★★ 形态进了队伍容器，且本体离场",
    b.teams[0].summons.some((e: any) => formOwnerOf(e) === self.id) && self.caps.canBeTargeted === false);
}

sec("[5] ★★★ 两种回归时机各自的走法（第 102 轮）")
{
  // (a) 余烬：到达行动条终点 ⇒ 本体回来（它进入时本体已经是被打到 0 血的状态 ⇒ DEFAULT_1）
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 11 });
  await a.battle.runStartup();
  const b = a.battle;
  const owner = b.teams[0].members[1];
  const ember = irOf("百羽凤凰火", "未熄羽").forms[0];
  const s = enterForm(b, owner, ember, { hasSkills: false }).summon!;
  owner.hp = 0; owner.alive = false; owner.dead = true;      // 模拟"被打到致命伤害才进的形态"
  await (b as any).runPseudoTurn(s, TurnType.NORMAL);
  ok("★★★ 形态到达行动条终点（轮到它行动）⇒ 本体复活回到场上",
    owner.alive === true && owner.hp === 1 && owner.caps.canBeTargeted === true,
    JSON.stringify({ alive: owner.alive, hp: owner.hp }));
  ok("★★★ 事件里写明是 TIMELINE_END 触发的（与形态阵亡那条路区分得开）",
    b.trace.some((t: any) => t.t === "FORM_RETURN" && t.reason === "TIMELINE_END" && t.owner === owner.id));
  ok("★★ 而且只还一次（第二次行动不该再触发一次复活）", (() => {
    const n1 = b.trace.filter((t: any) => t.t === "FORM_RETURN" && t.owner === owner.id).length;
    return n1 === 1 && s.notes.includes("form:returned");
  })());

  // (b) 蛇神：形态自己的技能（「[tips_3831]姿态下可施放」= 审判仪式）应当挂到形态身上
  // ★ 本体**必须是神堕八岐大蛇** —— 第一版这里忘了替换阵容，于是"形态拿到技能表"测的是别人的技能（全空）
  const m2 = canonicalMatch();
  const SNAKE2 = LIST.find(x => x.name === "神堕八岐大蛇")!;
  m2.red.units[0] = { ...m2.red.units[0], shikigamiId: SNAKE2.id, name: "神堕八岐大蛇" };
  const c: any = assembleMatch(createKit(bundle), m2, { seed: 12 });
  await c.battle.runStartup();
  const big = c.battle.teams[0].members[0];
  const snake = enterForm(c.battle, big, irOf("神堕八岐大蛇", "神堕之力").forms[0], { hasSkills: false }).summon!;
  ok("★★★ 形态拿到了自己的技能表（审判仪式 ← 原文「[蛇神]姿态下可施放」）",
    snake.skills.length === 1 && snake.skills[0].name === "审判仪式", JSON.stringify(snake.skills.map((x: any) => x.name)));
  ok("★★★ 有技能 ⇒ **不是** NO_SKILLS，而且进行动条（它能真的行动了）",
    !snake.notes.includes("summon:NO_SKILLS") && !!c.battle.timeline.get(snake.id));
  ok("★★ 事件链留痕 FORM_SKILL（这个技能属于形态，不是本体的）",
    c.battle.trace.some((t: any) => t.t === "FORM_SKILL" && t.skill === "审判仪式" && t.tipsId === "3831"));
}

console.log(`\n=== 自身形态类放置单位: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
