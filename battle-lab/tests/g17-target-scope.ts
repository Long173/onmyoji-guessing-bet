// tests/g17-target-scope.ts — ★ 技能作用范围：一个技能打谁、给谁加（第八个同型接线缺口）
//
// 由来：SkillIR.targeting 是 field-census 查出的「从未被读」字段之一。追下去发现它不是边角料，
// 而是**整层"效果作用对象"缺失**，而且三个方向全都是错的：
//   ① 114 个「敌方全体」技能只打 1 个目标（雪女「暴风雪」只打到 1/5）
//   ② 64 个「友方全体」技能把护盾/治疗丢给敌方 —— AI 目标永远取自敌人列表，
//      连「优先选择没有护盾的友方单位」这类规则也拿到敌人当候选
//   ③ 127 个「自身」技能也去打敌人
//   ④ 「击退行动条」推的是**自己**（对 self.id 生效），方向与对象全错
// 全库 818 个技能里 653 个 targeting 非空 —— 这不是边角情况。
import fs from "node:fs";
import path from "node:path";
import { compileSkill, targetModeOf, isAllyScoped } from "../compile/skill-compiler.ts";
import { buildCharacter } from "../compile/character.ts";
import { compileBuff } from "../compile/buff-compiler.ts";
import { compileAI } from "../compile/ai-compiler.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const buffs = new Map<string, any>(
  (JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[])
    .map(b => [String(b.id), compileBuff(b)]),
);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const mk = (desc: string) => compileSkill(1, "探查单位", { id: "probe", name: "探查", cost: 0, description: desc });
/** 造一个探查技能；aiEntry 给 AI 目标规则用（可为 undefined = 没有规则） */
const probeSkill = (desc: string, aiEntry?: any) =>
  buildCharacter({ id: 1, name: "探查单位", panel: { atk: 1000, hp: 50000, def: 300, spd: 100, cri: 0, crid: 1.5, efh: 0, efr: 0 }, skills: [{ id: "probe", name: "探查", cost: 0, description: desc }] },
    aiEntry ? compileAI(1, "探查单位", aiEntry, ["探查"]) : undefined, undefined, buffs, 0, 1).entity.skills[0];

const fresh = async (seed = 20261001) => {
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed });
  await a.battle.runStartup();
  return a.battle;
};

sec("[1] 分类：技能原文 -> 作用范围");
{
  const cases: Array<[string, string]> = [
    ["对敌方全体造成攻击100%的伤害", "ENEMY_ALL"],
    ["使友方全体获得护盾，能吸收12%生命上限的伤害", "ALLY_ALL"],
    ["治疗友方目标，恢复其12%生命", "ALLY_ONE"],
    ["自身获得护盾，能吸收10%生命上限的伤害", "SELF"],
    ["对随机敌方目标造成攻击100%的伤害", "ENEMY_RANDOM"],
    ["对敌方目标造成攻击100%的伤害", "ENEMY_ONE"],
    ["造成攻击100%的伤害", "ENEMY_ONE"],
  ];
  for (const [desc, want] of cases) {
    const got = targetModeOf(mk(desc));
    ok(desc.slice(0, 18) + "… → " + want, got === want, "得到 " + got);
  }
  ok("友方范围为真的判定为友方（决定候选名单取队友）",
     isAllyScoped("SELF") && isAllyScoped("ALLY_ALL") && isAllyScoped("ALLY_ONE") && !isAllyScoped("ENEMY_ALL"));
  // 真实技能抽样
  const shiki = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
  const list = Array.isArray(shiki) ? shiki : (shiki.characters ?? shiki.items ?? []);
  const find = (charName: string, skillName: string) => {
    for (const c of list) if (c.name === charName) for (const sk of (c.skills ?? [])) {
      const ir = compileSkill(Number(c.id ?? 0), charName, sk);
      if (ir.name === skillName) return targetModeOf(ir);
    }
    return null;
  };
  ok("真实技能 雪女「暴风雪」= 敌方全体", find("雪女", "暴风雪") === "ENEMY_ALL", String(find("雪女", "暴风雪")));
  ok("真实技能 雪女「冰甲术」= 自身", find("雪女", "冰甲术") === "SELF", String(find("雪女", "冰甲术")));
}

sec("[2] 群攻：必须打到**全部**敌人（此前只打第一个）");
{
  const bt: any = await fresh();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const enemies = bt.enemiesOf(0);
  ok("前置：对方有 5 个可被选中的敌人", enemies.length === 5, String(enemies.length));
  const skill = probeSkill("对敌方全体造成攻击100%的伤害");
  bt.trace.length = 0;
  await skill.execute(bt, self, enemies[0]);
  const hit = new Set(bt.trace.filter((e: any) => e.t === "DAMAGE").map((e: any) => e.dst));
  ok("★ 5 个敌人**全部**受到伤害", hit.size === 5, "命中 " + hit.size + " 个：" + JSON.stringify([...hit]));
  const scope = bt.trace.find((e: any) => e.t === "TARGET_SCOPE");
  ok("作用范围写进事件流（Theater 能看见）", scope?.mode === "ENEMY_ALL" && scope.hurt.length === 5, JSON.stringify(scope));
}

sec("[3] 友方技能：护盾必须给**队友**，一个敌人都不能有");
{
  const bt: any = await fresh();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const enemy = bt.enemiesOf(0)[0];
  const skill = probeSkill("使友方全体获得护盾，能吸收12%生命上限的伤害");
  const before = { ally: bt.teams[0].aliveMembers().reduce((s: number, m: any) => s + m.shields.length, 0),
                   foe: bt.teams[1].aliveMembers().reduce((s: number, m: any) => s + m.shields.length, 0) };
  bt.trace.length = 0;
  await skill.execute(bt, self, enemy);        // 故意把敌人当主目标传进去
  const after = { ally: bt.teams[0].aliveMembers().reduce((s: number, m: any) => s + m.shields.length, 0),
                  foe: bt.teams[1].aliveMembers().reduce((s: number, m: any) => s + m.shields.length, 0) };
  ok("★ 5 个队友各得到 1 层护盾", after.ally - before.ally === 5, JSON.stringify([before, after]));
  ok("★★ 敌方**一个护盾都没有**（这正是修复前的方向性错误）", after.foe - before.foe === 0, JSON.stringify([before, after]));
}

sec("[4] 自身技能：只作用于自己");
{
  const bt: any = await fresh();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const skill = probeSkill("自身获得护盾，能吸收10%生命上限的伤害");
  bt.trace.length = 0;
  await skill.execute(bt, self, bt.enemiesOf(0)[0]);
  const scopes = bt.trace.filter((e: any) => e.t === "SHIELD_APPLY");
  ok("只有自己拿到护盾", scopes.length === 1 && scopes[0].dst === self.id, JSON.stringify(scopes.map((s: any) => s.dst)));
}

sec("[5] 推条：推的是**承受者**，不是自己");
{
  const bt: any = await fresh();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const enemy = bt.enemiesOf(0)[0];
  const skill = probeSkill("对敌方全体造成攻击100%的伤害，并有30%概率击退100%行动条");
  const selfPosBefore = bt.timeline.get(self.id).pos;
  const foePosBefore = bt.timeline.get(enemy.id).pos;
  bt.trace.length = 0;
  await skill.execute(bt, self, enemy);
  const shifts = bt.trace.filter((e: any) => e.t === "TIMELINE_SHIFT");
  ok("★ 推条事件的对象全是敌人", shifts.length > 0 && shifts.every((s: any) => s.id !== self.id), JSON.stringify(shifts.map((s: any) => s.id)));
  ok("★ 施法者自己的行动条位置没有被推后", bt.timeline.get(self.id).pos === selfPosBefore, selfPosBefore + " → " + bt.timeline.get(self.id).pos);
  console.log("    敌人行动条 " + foePosBefore + " → " + bt.timeline.get(enemy.id).pos + "（推条生效时变小）");
}

sec("[6] 群控的概率是**逐目标**判定，不是掷一次决定全场");
{
  const bt: any = await fresh();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const enemies = bt.enemiesOf(0);
  // 用一个**真实的 DEBUFF 类印记**：2081_1 是【通用、印记】，按语义该挂在自己身上，
  // 拿它测"群控逐目标判定"会得到恒为 1 个承受者的假象（第一版就是这么写错的）。
  const debuffId = String((JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[])
    .find(b => String(compileBuff(b).category).startsWith("DEBUFF"))!.id);
  console.log("    使用的减益印记 id = " + debuffId);
  // ⚠ 刻意**不带伤害**：第一版写了"造成攻击100%的伤害"，200 次群攻直接把对面打死了，
  //   后续几次自然一个都控不到（平均值 0.04），看起来像"概率没生效"，
  //   其实是被测对象已经不在场上了。测机制时要先把无关变量按住。
  const skill = probeSkill("使敌方全体有30%概率获得[buff_" + debuffId + "]");
  const nHits: number[] = [];
  for (let i = 0; i < 200; i++) {
    for (const e of bt.teams[1].members) { e.statuses.length = 0; e.hp = e.maxHp; e.alive = true; e.dead = false; }
    bt.trace.length = 0;
    await skill.execute(bt, self, enemies[0]);
    nHits.push(bt.trace.filter((e: any) => e.t === "STATUS_APPLY").length);
  }
  const dealt = nHits.filter(n => n > 0).length / nHits.length;
  ok("★ 至少有一次只中了一部分（逐目标判定的直接证据）", nHits.some(n => n > 0 && n < 5), JSON.stringify([...new Set(nHits)].sort()));
  const avg = nHits.reduce((a, b) => a + b, 0) / nHits.length;
  ok("平均命中数接近 5×30% = 1.5（逐目标独立判定）", Math.abs(avg - 1.5) < 0.35, avg.toFixed(2));
  console.log("    200 次群控的命中数分布：" + JSON.stringify([...new Set(nHits)].sort().map(n => n + "中×" + nHits.filter(x => x === n).length)));
  ok("整场至少有人中过（不是恒 0）", dealt > 0, (dealt * 100).toFixed(0) + "%");
}

sec("[7] 回归：单目标技能仍然只打 1 个");
{
  const bt: any = await fresh();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const enemies = bt.enemiesOf(0);
  const skill = probeSkill("对敌方目标造成攻击100%的伤害");
  bt.trace.length = 0;
  await skill.execute(bt, self, enemies[2]);
  const hit = new Set(bt.trace.filter((e: any) => e.t === "DAMAGE").map((e: any) => e.dst));
  ok("只命中 AI 选定的那一个", hit.size === 1 && hit.has(enemies[2].id), JSON.stringify([...hit]));
}

sec("[8] 候选名单：友方规则不再拿到敌人列表");
{
  const bt: any = await fresh();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  // 「优先选择没有护盾的友方单位」—— 这条规则以前拿到的是敌人列表
  const skill = probeSkill("使友方目标获得护盾，能吸收10%生命上限的伤害",
    { cast: ["1: 总是施放"], target: ["1: 优先选择没有护盾的友方单位"] });
  const enemies = bt.enemiesOf(0);
  bt.trace.length = 0;
  const chosen = skill.pickTarget(bt, self, enemies);
  const ev = bt.trace.find((e: any) => e.t === "AI_TARGET");
  ok("★ 候选名单取自**友方**", ev?.pool === "ALLY", JSON.stringify(ev));
  ok("★ 选中的是队友，不是敌人", chosen.teamId === self.teamId && chosen.id !== self.id, "chosen=" + chosen?.id + " team=" + chosen?.teamId);
  ok("候选名单里没有敌人 id", !(ev?.candidates ?? []).some((id: number) => enemies.some((e: any) => e.id === id)), JSON.stringify(ev?.candidates));
}

console.log("\n=== 技能作用范围: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
