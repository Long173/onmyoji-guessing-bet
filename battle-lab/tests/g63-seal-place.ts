// tests/g63-seal-place.ts — ★★★ 第 103 轮：**敌方位放置（镇压）与击杀式放置**（目标 ⑨）
//
// 第 98 轮声明「放置单位缺触发者」，第 101/102 轮补了「自身形态」那一类（蛇神、余烬）。
// 这一轮补另外两类 —— 它们的**放置方不同**，这正是第 98 轮拒绝「只按 tips 就调用 addSummon」的原因：
//   · 镇压式：须佐之男「神之领域」→「敌方式神受到…致命伤害时，优先被**镇压成[雷冢]**」
//     放**敌方那一队**；被镇压者离场，雷冢被击败时它以 1 点生命复活；同一式神只生效 1 次。
//   · 击杀式：雪御前「龙胆·绽」→「击败非召唤物敌方目标时，**在其行动条处召唤**[龙胆蓝璃]」
//     放**己方那一队**，位置 = 阵亡者原来的位置。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { compileSkill } from "../compile/skill-compiler.ts";
import { loadTips, setTipsTable, tipsTable } from "../compile/tips.ts";
import { sealedVictimOf, FORM_OFF_FIELD_STATUS } from "../kernel/summon.ts";
import { findDamageImmunity } from "../kernel/status.ts";

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
const irOf = (shiki: string, skill: string) => {
  const s = LIST.find(x => x.name === shiki)!;
  const k = (s.skills ?? []).find((y: any) => y.name === skill)!;
  return compileSkill(s.id, s.name, k) as any;
};
/** 把典型对局某一位换成指定式神（其余面板不变）—— g60/g62 用的同一手法 */
const matchWith = (name: string, slot = 0) => {
  const s = LIST.find(x => x.name === name)!;
  const m = canonicalMatch();
  m.red.units[slot] = { ...m.red.units[slot], shikigamiId: s.id, name };
  return m;
};

sec("[1] 编译普查：三类放置声明各自的取值")
{
  ok("★ 前置：tips 表非空", tipsTable().size > 100, String(tipsTable().size));
  const seal = irOf("须佐之男", "神之领域").forms[0];
  ok("★★★ 雷冢：镇压式（placement=ENEMY + seal）且触发时机是**致命伤害**",
    seal.tipsId === "3896" && seal.trigger === "ON_LETHAL" && seal.placement === "ENEMY" && seal.seal === true,
    JSON.stringify([seal.trigger, seal.placement, seal.seal]));
  ok("★★ 回归时机来自 tips（「雷冢被击败后，被镇压的式神以1点生命复活」）",
    seal.returnOn === "SUMMON_DEATH" && seal.returnOnSource === "TIPS", JSON.stringify([seal.returnOn, seal.returnOnSource]));
  const place = irOf("雪御前", "龙胆·绽").forms.find((f: any) => f.trigger === "ON_KILL");
  ok("★★★ 龙胆蓝璃：击杀式放置 + **放在目标的行动条位置**",
    !!place && place.tipsId === "5911" && place.placement === "SELF" && place.atTargetPos === true,
    JSON.stringify(place ?? null));
  ok("★★★ 它不是「本体进出场」那类（returnOn=NONE）—— 两类放置语义必须分开",
    !!place && place.returnOn === "NONE", String(place?.returnOn));
  const skips: string[] = [];
  for (const s of LIST) { if (isOnmyoji(s.name ?? "")) continue;
    for (const k of (s.skills ?? [])) for (const x of ((compileSkill(s.id, s.name, k) as any).formSkips ?? [])) skips.push(s.name + "::" + x.reason); }
  /**
   * ★★★ 第 110 轮：这条断言的**方向反过来了**（按事实改写）。
   *   第 103 轮判「tips_3942 不是一个单位」，真因是 parseSummonSpec 当时只认「生命为…%」一种写法 ——
   *   而虚假之月写的是「继承月读45%生命值，100%防御和100%速度」。这一轮补上那两种写法之后，
   *   它就是一个**真的放置单位**（行动时为全体敌方附加2层惑星、受到致命伤害时在目标行动后阵亡）。
   *   ★ 被判 NOT_A_SUMMON_SPEC 的现在只剩绘世花鸟卷「绘梦浮生」（浮生画影：免疫伤害、无法行动，但没有生命基准/继承/胜利判定）。
   */
  const yuedu = compileSkill(LIST.find((x: any) => x.name === "月读")!.id, "月读", (LIST.find((x: any) => x.name === "月读")!.skills ?? []).find((y: any) => y.name === "虚诞月落")) as any;
  ok("★★★ 月读「虚诞月落」的召唤**被收成放置单位**了（kind=SUMMON；虚假之月继承月读45%生命值与100%防御）",
    (yuedu.forms ?? []).some((f: any) => f.tipsId === "3942" && f.kind === "SUMMON" && f.spec?.hp?.ratio === 0.45 && (f.spec?.inherit ?? []).some((i: any) => i.prop === "def" && i.ratio === 1)),
    JSON.stringify((yuedu.forms ?? []).map((f: any) => ({ t: f.tipsId, k: f.kind, hp: f.spec?.hp, inh: f.spec?.inherit }))));
  ok("★★ 反向：绘世花鸟卷「绘梦浮生」仍然只拿到 NOT_A_SUMMON_SPEC（判据没有被放宽到「看起来像单位」）",
    (() => { const s = LIST.find((x: any) => x.name === "绘世花鸟卷")!; const k = (s.skills ?? []).find((y: any) => y.name === "绘梦浮生"); const ir = compileSkill(s.id, s.name, k) as any; return !(ir.forms ?? []).length && (ir.formSkips ?? []).some((x: any) => x.reason === "NOT_A_SUMMON_SPEC"); })());

}

sec("[2] ★★★ 镇压：本体离场 → 雷冢顶替 → 雷冢被击败 → 本体以 1 点生命复活")
{
  const a: any = assembleMatch(createKit(bundle), matchWith("须佐之男"), { seed: 20261101 });
  await a.battle.runStartup();
  const b = a.battle;
  const killer = b.teams[0].members[0];
  const victim = b.teams[1].members[0];
  const before = { summons: b.teams[1].summons.length, kills: b.trace.filter((t: any) => t.t === "DEATH").length };
  victim.hp = 0;
  await b.resolveLethal(victim, killer.id);
  const lei = b.teams[1].summons.find((e: any) => sealedVictimOf(e) === victim.id);
  ok("★★★ 雷冢被造出来了，而且放在**被镇压者那一队**（敌方队）",
    b.teams[1].summons.length === before.summons + 1 && !!lei, JSON.stringify([b.teams[1].summons.length, !!lei]));
  ok("★★★ 被镇压者**没有死**（镇压 ≠ 阵亡）—— 死亡留痕一条都没多",
    victim.alive === true && victim.dead === false && b.trace.filter((t: any) => t.t === "DEATH").length === before.kills);
  ok("★★★ 它离场了：不可被选中 + 挂着「形态离场」状态",
    victim.caps.canBeTargeted === false && victim.statuses.some((s: any) => s.def.id === FORM_OFF_FIELD_STATUS));
  ok("★★★ 雷冢的生命 = 须佐之男**初始攻击** × 150%（tips 的算法）",
    lei.maxHp === Math.max(1, Math.round(killer.base.atk * 1.5)), lei.maxHp + " vs " + Math.round(killer.base.atk * 1.5));
  ok("★★ 事件链留痕 SEAL（谁镇压了谁、谁顶替）",
    b.trace.some((t: any) => t.t === "SEAL" && t.killer === killer.id && t.victim === victim.id && t.summon === lei.id));
  ok("★★★ 「同一式神该效果只可生效1次」：击杀者身上留了标记（notes 进存档）",
    killer.notes.some((n: string) => n === "seal-used:" + victim.id));

  await b.resolveLethal(lei, killer.id);
  ok("★★★ 雷冢被击败 ⇒ 被镇压者**以 1 点生命复活**（tips_3896 原文）",
    victim.alive === true && victim.hp === 1 && victim.caps.canBeTargeted === true,
    JSON.stringify({ alive: victim.alive, hp: victim.hp, can: victim.caps.canBeTargeted }));
  ok("★★★ 解除时的生命值取自**规格字段** onDefeatRevive（tips：「以1点生命复活」）⇒ 事件里标的是 TIPS，不是默认值",
    b.trace.some((t: any) => t.t === "FORM_RETURN" && t.reason === "SEAL_RELEASE" && t.returnHp === "TIPS" && t.hp === 1),
    JSON.stringify(b.trace.filter((t: any) => t.t === "FORM_RETURN").map((t: any) => [t.reason, t.returnHp, t.hp])));
  ok("★★★ 而且事件里写明是**解除镇压**触发的（与形态阵亡那条路区分得开）",
    b.trace.some((t: any) => t.t === "FORM_RETURN" && t.reason === "SEAL_RELEASE" && t.owner === victim.id));
  ok("★★ 离场状态被撤掉", !victim.statuses.some((s: any) => s.def.id === FORM_OFF_FIELD_STATUS));

  /**
   * ★★★ 第 103 轮实测抓到过的一个 bug：「同一式神该效果只可生效1次」第一版写成了
   *   ~B~!killer.notes.includes("seal-used:")~B~ —— 前缀匹配等于"压过任何一个人就算用过"，
   *   于是须佐之男全场只能镇压一个敌人。这条断言就是钉住"**按目标**判定"的。
   */
  {
    const victim2 = b.teams[1].members[1];
    victim2.hp = 0;
    await b.resolveLethal(victim2, killer.id);
    ok("★★★ 另一个敌方目标**同样能被镇压**（「只可生效1次」是按**每个式神**，不是一辈子一次）",
      b.teams[1].summons.filter((e: any) => sealedVictimOf(e) === victim2.id).length === 1,
      JSON.stringify(b.teams[1].summons.map((e: any) => e.notes.filter((n: string) => n.startsWith("seal:victim=")))));
  }

  victim.hp = 0;
  await b.resolveLethal(victim, killer.id);
  ok("★★★ 第二次致命伤害**不再镇压**（原文：同一式神该效果只可生效1次）⇒ 这次真的阵亡",
    victim.alive === false && b.teams[1].summons.filter((e: any) => sealedVictimOf(e) === victim.id).length === 1);
}

sec("[3] ★★★ 反向：不是须佐之男打死的，就不该被镇压")
{
  const a: any = assembleMatch(createKit(bundle), matchWith("三尾狐"), { seed: 5 });
  await a.battle.runStartup();
  const b = a.battle;
  const other = b.teams[0].members[0];
  const victim = b.teams[1].members[0];
  victim.hp = 0;
  await b.resolveLethal(victim, other.id);
  ok("★★★ 换了击杀者 ⇒ 没有任何镇压式放置（否则上一条测的是「凡是致命伤害都镇压」）",
    victim.alive === false && b.teams[1].summons.length === 0, JSON.stringify([victim.alive, b.teams[1].summons.length]));
  ok("★★ 而且没有 SEAL 留痕", !b.trace.some((t: any) => t.t === "SEAL"));
}

sec("[4] ★★★ 击杀式放置：位置 = 阵亡者原来的行动条位置")
{
  const a: any = assembleMatch(createKit(bundle), matchWith("雪御前"), { seed: 20261102 });
  await a.battle.runStartup();
  const b = a.battle;
  const killer = b.teams[0].members[0];
  const victim = b.teams[1].members[1];
  const victimPos = b.timeline.get(victim.id)?.pos ?? null;
  ok("★ 前置：阵亡者此刻在行动条上（否则「放到它的位置」无从谈起）", victimPos !== null, String(victimPos));
  victim.hp = 0;
  await b.resolveLethal(victim, killer.id);
  const glass = b.teams[0].summons.find((e: any) => e.notes.includes("summon:5911"));
  ok("★★★ 龙胆蓝璃被召唤到**自己这一队**（与雷冢刚好相反）", !!glass, JSON.stringify(b.teams[0].summons.map((e: any) => e.id)));
  ok("★★★ 位置 = 阵亡者的行动条位置（「在其行动条处召唤」）",
    !!glass && b.timeline.get(glass.id)?.pos === victimPos, JSON.stringify([b.timeline.get(glass?.id ?? -1)?.pos ?? null, victimPos]));
  ok("★★ 生命 = 雪御前初始攻击 × 240%（tips_5911）",
    glass.maxHp === Math.max(1, Math.round(killer.base.atk * 2.4)), glass.maxHp + " vs " + Math.round(killer.base.atk * 2.4));
  /**
   * ★★★ 第 104 轮：这两条从"写在事件里的未实现"变成了**真的做了**（tips_5911 原文）：
   *   · 「在场时，雪御前免疫受到的伤害」⇒ 链接光环（DAMAGE 免疫状态，放置单位离场即撤）；
   *   · 「被重复召唤时，生命上限提升初始攻击的39%（至多3次），并恢复全部生命」⇒ 加在**已存在**的那个身上。
   */
  ok("★★★ 「在场时拥有者免疫受到的伤害」：拥有者身上真的挂着 DAMAGE 免疫（第 94 轮的免疫读取方认得它）",
    !!glass && !!findDamageImmunity(killer), JSON.stringify(findDamageImmunity(killer)?.def?.id ?? null));
  ok("★★ 而且事件里写明了光环的来源（PLACE_ON_KILL.aura）",
    b.trace.some((t: any) => t.t === "PLACE_ON_KILL" && t.aura === "link_aura_immune_damage"));

  // 重复召唤：再杀一个敌人（同一个击杀者）⇒ 不造第二个，而是把已存在的那个加强
  {
    const before2 = b.teams[0].summons.filter((e: any) => e.notes.includes("summon:5911")).length;
    const hp0 = glass.maxHp;
    const victim2 = b.teams[1].members[2];
    victim2.hp = 0;
    await b.resolveLethal(victim2, killer.id);
    ok("★★★ 重复召唤**不再造第二个单位**，而是加强已存在的那个（原文：被重复召唤时…）",
      b.teams[0].summons.filter((e: any) => e.notes.includes("summon:5911")).length === before2 && glass.maxHp > hp0,
      JSON.stringify([before2, glass.maxHp, hp0]));
    ok("★★★ 提升量 = 拥有者**初始攻击** × 39%（tips 的比例）",
      glass.maxHp - hp0 === Math.max(1, Math.round(killer.base.atk * 0.39)), String(glass.maxHp - hp0));
    ok("★★★ 而且「恢复全部生命」：血量跟着上限走满",
      glass.hp === glass.maxHp && glass.notes.includes("lace:stacks=1"), JSON.stringify([glass.hp, glass.maxHp]));
    ok("★★ 事件链留痕 PLACE_STACK（叠了几层、加了多少）",
      b.trace.some((t: any) => t.t === "PLACE_STACK" && t.summon === glass.id && t.stacks === 1));
  }

  // 放置单位阵亡 ⇒ 光环撤掉
  {
    await b.resolveLethal(glass, killer.id);
    ok("★★★ 放置单位离场 ⇒ 拥有者的免伤光环被撤掉（否则「在场时」会变成永久免疫）",
      !findDamageImmunity(killer) && b.trace.some((t: any) => t.t === "LINK_END" && t.summon === glass.id && t.owner === killer.id));
  }
}

sec("[5] ★ 边界：放置单位自己被击败时，不再触发这两类放置（防递归）")
{
  const a: any = assembleMatch(createKit(bundle), matchWith("须佐之男"), { seed: 9 });
  await a.battle.runStartup();
  const b = a.battle;
  const killer = b.teams[0].members[0];
  const victim = b.teams[1].members[0];
  victim.hp = 0;
  await b.resolveLethal(victim, killer.id);
  const lei = b.teams[1].summons.find((e: any) => sealedVictimOf(e) === victim.id)!;
  const n1 = b.teams[1].summons.length;
  await b.resolveLethal(lei, killer.id);
  ok("★ 雷冢被击败不会再生出第二个雷冢", b.teams[1].summons.length === n1);
}

console.log(`\n=== 镇压与击杀式放置: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
