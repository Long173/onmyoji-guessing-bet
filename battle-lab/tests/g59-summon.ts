// tests/g59-summon.ts — ★★★ 第 98 轮：**放置单位（召唤物 / 姿态体）运行时**（a1-4 §32，目标 ⑨）
//
// 为什么是这个测试：capability 里 SUMMON 的结论长期是
//   「容器齐、序列化齐、恢复齐、寻敌齐 —— **没有任何地方往容器里放单位**」，
// 而 kernel/effects.ts 的注册表里那条 { key: "Summon", producer: "addSummon" } 写的正是缺的那一行。
//
// 本轮的**关键发现**（g12 §5 也记了一份）：放置单位的数据**不在 shikigami.full.json 里，在 tips.json 里**。
// 技能原文用 [tips_N] 引用，tips 条目自己写着名字 / 生命基准 / 免疫项 / 复活方式 / 胜利判定。
// 于是"数据边界"这个旧判断是**查错了表**得来的 —— 真正剩下的边界只有"召唤物用什么技能打人"。
//
// ★ 本文件的每一条都写成**双向**：正向断言实现存在，反向断言它不是恒真（否则"平凡通过的断言是藏 bug 的地方"）。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { parseSummonSpec } from "../kernel/summon.ts";
import type { SummonSpec } from "../kernel/summon.ts";
import { findDamageImmunity, findImmuneStatus, CONTROL_EFFECTS, IMMUNE_TEXT_RULES } from "../kernel/status.ts";
import { createKit as _ck, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { captureState, restoreBattle } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

const tips: any[] = (() => {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "tips.json"), "utf8"));
  return Array.isArray(t) ? t : Object.values(t).find((v: any) => Array.isArray(v)) as any[];
})();
const tipOf = (id: string) => tips.find(t => String(t.id) === id);
const SPECS = tips.map(t => parseSummonSpec(t)).filter(Boolean) as SummonSpec[];
const specOf = (id: string) => SPECS.find(s => s.tipsId === id)!;

sec("[1] 数据来源：规格是**从 tips 原文解析出来的**，不是写死的常量");
{
  ok("★★★ tips.json 里解析出 10 条放置单位规格（第 110 轮 +4：生命基准的另两种写法与逐属性继承）", SPECS.length === 10, SPECS.map(s => s.tipsId + ":" + s.name).join(", "));
  ok("★★★ 10 条 id 与实测一致（新增 3565 海原贝戟 / 5523 明识灯 / 5691 别馆私汤 / 3942 虚假之月）", ["3896", "5994", "5975", "5911", "6071", "3831", "3565", "5523", "5691", "3942"].every(id => SPECS.some(s => s.tipsId === id)),
    SPECS.map(s => s.tipsId).join(","));
  /**
   * ★ 雷冢的生命基准是「须佐之男**初始攻击**150%」—— 不是生命。
   *   这是最容易写错的一处：默认按 hp 算会得到一个**看起来合理**的数字，而且不会有任何测试变红。
   */
  const lei = specOf("3896");
  ok("★★★ 雷冢：生命基准取自**攻击**、比例 1.5（原文「生命为须佐之男初始攻击150%」）",
    lei.hp?.prop === "atk" && Math.abs((lei.hp?.ratio ?? 0) - 1.5) < 1e-9, JSON.stringify(lei.hp));
  ok("★★ 雷冢：无法行动 / 不触发御魂和被动", lei.noAction && lei.suppressSoul && lei.suppressPassive);
  ok("★★ 雷冢：被击败后以 1 点生命复活 + 只可生效 1 次",
    lei.onDefeatRevive?.hp === 1 && lei.oncePerTarget, JSON.stringify(lei.onDefeatRevive));
  ok("★★★ 雷冢：胜利判定被读到（「若敌方只存在雷冢，视为战斗胜利」）", lei.victoryRule === "ONLY_THIS_MEANS_DEFEAT");
  ok("★★ 证据锚点确实是那一句原文", /只存在/.test(String(tipOf("3896")?.desc)) && /视为战斗胜利/.test(String(tipOf("3896")?.desc)));

  const ember = specOf("6071");
  ok("★★★ 余烬：继承初始属性 + 提升 100 点速度 + 可行动（原文没有「无法行动」）",
    ember.inheritInitialStats && ember.spdBonus === 100 && !ember.noAction, JSON.stringify([ember.inheritInitialStats, ember.spdBonus, ember.noAction]));
  /**
   * ★★ 期望值**从声明派生**（status.ts 的 IMMUNE_TEXT_RULES），不在这里手写第二份四个字符串 ——
   *   手写会立刻被词汇普查抓成"跨文件重复词表"（这一轮就抓到了），
   *   而且规则表将来加一类时，手写的断言会**静默漏掉**新类。
   */
  const ALL_KINDS = IMMUNE_TEXT_RULES.map(r => r.kind);
  ok("★★★ 余烬：四类免疫全被读到（伤害/减益/控制/放逐）",
    ALL_KINDS.length === 4 && ALL_KINDS.every(k => ember.immuneTo.includes(k)), JSON.stringify(ember.immuneTo));
  ok("★★★ 余烬：胜利判定（「若场上只有余烬视为战斗失败」）", ember.victoryRule === "ONLY_THIS_MEANS_DEFEAT");

  sec("[2] ★★★ 反向：判据不能被**状态**文案骗到（第一版这里错了 17 条）");
  const mk = (id: string, name: string, desc: string) => parseSummonSpec({ id, name, desc });
  ok("★★★ 「无法行动，免疫伤害，无法被选中」= 状态文案 ⇒ **不是**放置单位",
    mk("x1", "放逐", "无法行动，免疫伤害，无法被选中，不可驱散") === null);
  ok("★★ 同理「沉眠」「吞食」这类也不能算", mk("x2", "沉眠", "无法行动，受到伤害时解除") === null && mk("x3", "吞食", "无法行动，被吞食的目标无法被选中") === null);
  ok("★★★ 正向对照：只要写了**生命基准**就必须算（否则判据过严）",
    mk("x4", "假人", "生命为自身防御200%，无法行动") !== null);
  ok("★★★ 正向对照：只要写了**胜利判定**也必须算", mk("x5", "假物", "若敌方只存在此物，视为战斗胜利") !== null);
  ok("★★ 空 desc 不算（不能靠默认值凑出一条规格）", mk("x6", "空", "") === null);
}

sec("[3] 唯一产生者：Battle.addSummon 真的把单位放进容器");
{
  const kit = createKit(bundle);
  const a: any = assembleMatch(kit, canonicalMatch(), { seed: 20261001 });
  await a.battle.runStartup();
  const owner = a.battle.teams[0].members[0];
  const expectHp = Math.max(1, Math.round(owner.base.atk * 1.5));
  const before = a.battle.teams[0].summons.length;
  const e = a.battle.addSummon(owner, specOf("3896"));
  ok("★★★ 容器**不再为空**（这是 capability 里那条「没有任何地方往容器里放单位」的正面反证）",
    before === 0 && a.battle.teams[0].summons.length === 1 && !!e);
  ok("★★ 生命 = 拥有者**初始攻击** × 150%", e.maxHp === expectHp && e.hp === expectHp, e.maxHp + " vs " + expectHp);
  ok("★★ 单位类型是 SUMMON（不是又一个式神）", e.type === "SUMMON", String(e.type));
  /**
   * ★★★ 「原文没写的属性」必须**留痕**，不能给个像样的默认值。
   *   雷冢的 tips 只写了生命（= 初始攻击×150%），atk / def **一个字都没有** ——
   *   所以这里是 0 + 明确的 UNDECLARED 标记，而不是 `拥有者攻击 × 0.5` 那种"看起来正常"的数。
   */
  ok("★★★ 雷冢：原文没写的属性记成 UNDECLARED，而不是编一个值",
    e.base.atk === 0 && e.base.def === 0 && e.notes.includes("summon:stats-UNDECLARED"),
    JSON.stringify([e.base.atk, e.base.def]));
  ok("★★★ 事件链里写明属性来源（statsSource）",
    a.battle.trace.some((t: any) => t.t === "SUMMON_CREATE" && t.statsSource === "TIPS_HP_ONLY"));
  ok("★★ 占了召唤位（caps.occupiesSummonSlot）", e.caps.occupiesSummonSlot === true);
  ok("★★★ 不计入胜负（caps.countsForVictory=false）—— 两条 KB 胜利规则都指向这个默认", e.caps.countsForVictory === false);
  ok("★ 不可行动的单位不推进行动条（雷冢没有 timeline 条目）", e.caps.advancesOrbGauge === false && !a.battle.timeline.get(e.id));
  ok("★ 证据链留痕：notes 里写明了 tipsId", e.notes.includes("summon:3896"));
  ok("★ 事件链留痕：SUMMON_CREATE 带 owner/tipsId/计数",
    a.battle.trace.some((t: any) => t.t === "SUMMON_CREATE" && t.tipsId === "3896" && t.countsForVictory === false));

  sec("[4] 召唤位上限：满了必须**报出来**，不能静默丢弃");
  const slots = a.battle.teams[0].summonSlots;
  const e3 = a.battle.addSummon(owner, specOf("6071"));
  ok("★★★ 召唤位已满时返回 null（默认 summonSlots=1）", slots === 1 && e3 === null, String(slots));
  ok("★★★ 而且 trace 里有 SUMMON_SLOT_FULL —— 静默失败是查不出来的",
    a.battle.trace.some((t: any) => t.t === "SUMMON_SLOT_FULL" && t.tipsId === "6071"));
  a.battle.teams[0].summonSlots = 3;
  const e4 = a.battle.addSummon(owner, specOf("6071"));
  ok("★★ 放开上限后同一个规格能进来（证明上一条是**上限**拦的，不是规格本身有问题）", !!e4 && e4.type === "SPECIAL_SUMMON", String(e4?.type));
  ok("★★ 它的 id 与第一个不同（id 由 队伍+序号 确定性推导）", !!e4 && e4.id !== e.id, e.id + " / " + e4?.id);
  ok("★★★ 反向：余烬是**继承初始属性** ⇒ 不该有 UNDECLARED 标记（否则上一条就是恒真）",
    !!e4 && e4.base.atk === owner.base.atk && !e4.notes.includes("summon:stats-UNDECLARED"),
    e4 ? String(e4.base.atk) + " vs " + owner.base.atk : "null");
  /**
   * ★★★ 第 101 轮先把这条断言从「可行动就要进行动条」改成「没技能表就不进」；
   *   **第 102 轮又改回来**，但不是回到原点：现在两个方向**都进行动条**，
   *   区别只剩「有没有技能表」这件事本身（记在 notes / trace 里）。
   *   改回来的理由：余烬的回归时机是「到达行动条终点」—— 不进行动条就永远回不来（见 §87.4）。
   */
  ok("★★★ 没有技能表的形态单位**照样进行动条**（第 102 轮：余烬要靠它到终点），并写明理由",
    !!e4 && !!a.battle.timeline.get(e4.id) && e4.notes.includes("summon:NO_SKILLS") &&
    a.battle.trace.some((t: any) => t.t === "SUMMON_NO_SKILLS" && t.summon === e4.id));
  /**
   * ★★ 两处都要对：① 用**可行动**的规格（余烬 noAction=false；雷冢即使有技能表也不进行动条，那是规格说的）；
   *   ② 先放开召唤位 —— 否则这里会因为"位子满了"被拒，断言测到的就是另一件事（第一版正是这样红的）。
   */
  a.battle.teams[0].summonSlots = 5;
  const e6 = a.battle.addSummon(owner, specOf("6071"), { skills: [{ name: "探查·普攻", cost: 0, ir: {} }] } as any);
  ok("★★★ 反向：带上技能表之后**不再**记 NO_SKILLS（区别只剩这一条 —— 两边都进行动条）",
    !!e6 && !!a.battle.timeline.get(e6.id) && !e6.notes.includes("summon:NO_SKILLS"),
    e6 ? JSON.stringify([!!a.battle.timeline.get(e6.id), e6.notes]) : "null");
  ok("★★ 对照：两者都在行动条里 ⇒ 区分它们的**只有** NO_SKILLS 这一条（不是「进不进行动条」）",
    !!e4 && !!e6 && !!a.battle.timeline.get(e4.id) && !!a.battle.timeline.get(e6.id));

  sec("[5] 「初始」是初始：属性被改过之后，召唤物血量**不变**");
  owner.addModifier({ prop: "atk", value: 10, mode: "ADD_RATE", source: "g59:probe" });
  const e5 = a.battle.addSummon(owner, specOf("3896"));
  ok("★★★ 拥有者攻击被 +100% 之后，新建召唤物的血量仍按**初始**攻击算（若读当前值 prop(atk)，这条会变红）",
    owner.prop("atk") > owner.base.atk && !!e5 && e5.maxHp === expectHp,
    owner.base.atk + " → 当前 " + owner.prop("atk") + "，召唤物 " + e5?.maxHp + " vs 期望 " + expectHp);
}

sec("[6] 免疫是**真的状态**，不是 notes 里的一句话");
{
  const kit = createKit(bundle);
  const b: any = assembleMatch(kit, canonicalMatch(), { seed: 7 });
  await b.battle.runStartup();
  const owner = b.battle.teams[0].members[0];
  b.battle.teams[0].summonSlots = 2;   // 两个规格要同时在场上（默认只有 1 个位子）
  const ember = b.battle.addSummon(owner, specOf("6071"));
  const lei = b.battle.addSummon(owner, specOf("3896"));   // 雷冢没有免疫项
  ok("★ 对照组成立（两个单位都真的建出来了）", !!ember && !!lei);
  const ctrl = CONTROL_EFFECTS.find(d => d.id === "freeze")!;
  ok("★★★ 余烬：免疫伤害（findDamageImmunity 读得到 —— 这是 immuneTo 的第二个来源）", !!findDamageImmunity(ember));
  ok("★★★ 余烬：免疫控制（findImmuneStatus 读得到）", !!findImmuneStatus(ember, ctrl, true));
  ok("★★★ 反向：雷冢（原文没写免疫）两条都读不到 ⇒ 上两条不是恒真",
    !findDamageImmunity(lei) && !findImmuneStatus(lei, ctrl, true));
  ok("★ 免疫状态不可驱散（原文说「免疫」，没说可以被驱散掉）", ember.statuses.every((s: any) => !s.def.dispellable));
  ok("★ 免疫状态跟着存档走（4 类 = 4 个状态，其中有 immuneTo 的正好 4 个）",
    ember.statuses.filter((s: any) => (s.def.immuneTo ?? []).length > 0).length === 4,
    String(ember.statuses.length));
}

sec("[7] 胜负：countsForVictory 必须**真的在决定胜负**");
{
  const kit = createKit(bundle);
  const c: any = assembleMatch(kit, canonicalMatch(), { seed: 11 });
  await c.battle.runStartup();
  ok("★★★ 无召唤物时：victoryCount() 与 aliveMembers().length 逐值相同（没有偷改胜负口径）",
    [0, 1].every(i => c.battle.teams[i].victoryCount() === c.battle.teams[i].aliveMembers().length),
    [0, 1].map(i => c.battle.teams[i].victoryCount() + "/" + c.battle.teams[i].aliveMembers().length).join(" "));

  // 把 A 队成员全部打死，只留一个 countsForVictory=false 的召唤物
  const summon = c.battle.addSummon(c.battle.teams[0].members[0], specOf("3896"));
  for (const m of c.battle.teams[0].members) { m.hp = 0; m.alive = false; }
  ok("★★★ 只剩召唤物 = 该队判负（这正是 tips_3896 / tips_6071 那两条规则要的语义）",
    c.battle.checkVictory() === true && c.battle.winner === 1 && c.battle.endReason === "TEAM0_WIPED",
    JSON.stringify([c.battle.winner, c.battle.endReason]));
  ok("★★ 而召唤物**确实还活着**（不是因为它死了才判负 —— 那样这条断言就没在测 countsForVictory）", summon.alive === true);

  // 反向：把计数打开，同一条战线就不该判负
  const kit2 = createKit(bundle);
  const d: any = assembleMatch(kit2, canonicalMatch(), { seed: 11 });
  await d.battle.runStartup();
  const s2 = d.battle.addSummon(d.battle.teams[0].members[0], specOf("3896"));
  for (const m of d.battle.teams[0].members) { m.hp = 0; m.alive = false; }
  s2.caps.countsForVictory = true;
  ok("★★★ 反向：同一个局面下把 countsForVictory 打开，就不再判负 ⇒ 这个字段是**读者在起作用**",
    d.battle.checkVictory() === false && d.battle.winner === null,
    JSON.stringify([d.battle.winner, d.battle.endReason]));
}

sec("[8] 确定性：同一 seed 两次装配，召唤物的 id / 血量 / 状态逐位相同");
{
  const run = async () => {
    const k = createKit(bundle);
    const x: any = assembleMatch(k, canonicalMatch(), { seed: 4242 });
    await x.battle.runStartup();
    const s = x.battle.addSummon(x.battle.teams[0].members[0], specOf("6071"));
    return { id: s.id, hp: s.hp, maxHp: s.maxHp, type: s.type, statuses: s.statuses.map((t: any) => t.def.id).join("|") };
  };
  const one = await run(); const two = await run();
  ok("★★★ 两次独立运行的召唤物完全相同（若 id 用随机数，这条会变红）",
    JSON.stringify(one) === JSON.stringify(two), JSON.stringify([one, two]));
  ok("★ 而且是**同队第二个位置**之外的可复现值（不是恰好都是 undefined）", one.id === +one.id && one.hp > 0);
}

sec("[9] ★★★ G0：召唤物经「存档 → 恢复」之后**仍然是它自己**");
{
  /**
   * 这一段盯的是 G0 与本轮改动交叉处的坑：占位检查读的是 `caps.occupiesSummonSlot`，
   * 而 caps 必须**跟着存档走** —— 否则恢复出来的召唤物"不占位"，
   * 于是同一队伍可以无限召唤（一个只在续跑路径上出现的 bug）。
   * 免疫也一样：它挂在 statuses 上，恢复时要按快照整体还原（state.ts 不走 addStatus）。
   */
  const kit = createKit(bundle);
  const a: any = assembleMatch(kit, canonicalMatch(), { seed: 909 });
  await a.battle.runStartup();
  // ★ 只留 1 个位子：这样"恢复后再召唤"必须被**占位**挡住（若写 2，反向断言就失去意义）
  const ember = a.battle.addSummon(a.battle.teams[0].members[0], specOf("6071"));
  const st = captureState(a.battle);
  const kit2 = createKit(bundle);
  const deps = { kit: kit2, makeRuntime: (id: number) => runtimeFor(kit2, id), attachRuntime };
  const r: any = restoreBattle(JSON.parse(JSON.stringify(st)), deps as any);
  const back = r.teams[0].summons.find((e: any) => e.id === ember.id);
  ok("★★★ 召唤物被恢复到队伍里（身份与血量逐位一致）",
    !!back && back.hp === ember.hp && back.type === ember.type, JSON.stringify([back?.hp, ember.hp, back?.type]));
  ok("★★★ 恢复后仍然占位（caps 跟着存档走）", back.caps.occupiesSummonSlot === true);
  ok("★★★ 恢复后仍然不计入胜负", back.caps.countsForVictory === false);
  ok("★★★ 恢复后免疫仍然读得到（免疫挂在 statuses 上，不走 addStatus 重建）", !!findDamageImmunity(back));
  ok("★★★ 反向：恢复后再召唤会被**占位**挡住 ⇒ 证明上一条的 caps 真的在拦人",
    r.addSummon(r.teams[0].members[0], specOf("3896")) === null);
  ok("★ 证据留痕也一起回来（notes 是存档字段）", back.notes.includes("summon:6071"));
}

console.log(`\n=== 放置单位运行时: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
