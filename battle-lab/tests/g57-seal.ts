// tests/g57-seal.ts — ★★★ 封印：一个"有读取方、没有写入方"的集合，以及**从未被验证过的四个标记**（第 96 轮，目标 ⑨）
//
// 两件事：
//   ① `EventBus.suppressedPassive` 从第 10 轮起就在，`collect()` 一直在读它，
//      但**生产代码里没有一个写入方**（只有 experiments 脚手架会写）⇒ "被动能不能被封印"永远为假；
//   ② 两个标记（suppressPassive / suppressSoul）的**判据是错的**，而没人能发现 ——
//      因为它们从来没有被读过。**不可达的值不会被任何行为验证**，实测 9 条里 4 条是假命中。
import fs from "node:fs";
import path from "node:path";
import { compileBuff, toStatusDef } from "../compile/buff-compiler.ts";
import { hasSuppression, StatusBook } from "../kernel/status.ts";
import { CAPABILITIES } from "../capability/registry.ts";
import { producerScanFiles, stripComments } from "../tools/field-census.ts";
import { findUnmodeled } from "../compile/unmodeled.ts";
import { splitClauses } from "../compile/skill-compiler.ts";
import { DamageType } from "../kernel/types.ts";
import { createKit, assembleMatch, runtimeFor, attachRuntime } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash, restoreBattle } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const BASE = "2d7c7507e18db61f";
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const BUFFS: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8"));
const cb = (id: string) => compileBuff(BUFFS.find((b: any) => String(b.id) === id));
const defOf = (id: string) => toStatusDef(cb(id));

sec("[1] ★★★ 两个标记的判据：3 条被动失效 + 5 条御魂失效，四条假命中必须点名");
{
  const passive = BUFFS.filter((b: any) => compileBuff(b).suppressPassive).map((b: any) => String(b.id));
  const soul = BUFFS.filter((b: any) => compileBuff(b).suppressSoul).map((b: any) => String(b.id));
  ok("★★★ 被动失效恰好 3 条（五感尽失 / 四魂封印 / 鬼面）",
    passive.sort().join(",") === "2712_1,3194_1,3253_1", passive.join(","));
  ok("★★★ 御魂失效恰好 5 条（上面 3 条 + 盗取 + 粉妆）",
    soul.sort().join(",") === "2712_1,3194_1,3253_1,3843_1,5583_1", soul.join(","));
  const fp: Array<[string, string]> = [
    ["3641_1", "理性：「阿修罗受到**理性压制**」是修辞（效果是伤害 -9%）"],
    ["3312_1", "仇恨印记：「开启**封印结界**时」是结界专名"],
    ["2922_1", "霜织庇护：「**抵挡**1次压制、封印、冰冻类效果」—— 它抵抗封印，方向相反"],
    ["3833_1", "堕化：「破除1把天羽羽斩**封印**」是另一个机制的封印"],
  ];
  for (const [id, why] of fp) {
    const c = cb(id);
    ok("★★★ 假命中：" + why, !c.suppressPassive && !c.suppressSoul,
      JSON.stringify({ p: c.suppressPassive, s: c.suppressSoul }));
  }
  const synth = (desc: string) => compileBuff({ id: "probe", name: "探查", desc });
  ok("★★★ 反向：合成的「式神被动技能失效」必须收", synth("【减益、状态】式神被动技能失效。").suppressPassive === true);
  ok("★★★ 反向：合成的「封印御魂效果」必须收（这一处「封印」真的是动词）",
    synth("【减益、状态】封印御魂效果，持续1回合。").suppressSoul === true && synth("【减益、状态】封印御魂效果，持续1回合。").suppressPassive === false);
  ok("★★ 而「抵御封印」这种写法仍然不收（方向必须是「我在让别人失效」）",
    synth("【增益、印记】抵御封印与放逐。").suppressSoul === false);
}

sec("[2] ★★ 求值器：封印由**状态**决定（不是运行时集合）");
{
  const defs = [defOf("3253_1")];
  ok("★★★ hasSuppression 读状态上的标记", hasSuppression(defs, "PASSIVE") && hasSuppression(defs, "SOUL"));
  ok("★★ 御魂专属的封印不影响被动（盗取：只有御魂失效）",
    !hasSuppression([defOf("5583_1")], "PASSIVE") && hasSuppression([defOf("5583_1")], "SOUL"));
  ok("★★ 而「变形」这个**内置控制状态**本来就带 suppressPassive ⇒ 它现在真的会压住被动",
    hasSuppression([StatusBook.get("morph")!], "PASSIVE"));
  ok("★★ 对照：普通控制状态（冰冻）不带封印标记", !hasSuppression([StatusBook.get("freeze")!], "PASSIVE"));
}

// ── 夹具：红方 1 号是铁鼠（被动「横财护身」= 受到攻击时 40% 给攻击者挂 buff）
async function ratBattle(passives: any = "PARSED_CANDIDATES_ONLY") {
  const m: any = canonicalMatch();
  m.red.units[0].shikigamiId = 232; m.red.units[0].name = "铁鼠";
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261001, passives });
  await a.battle.runStartup();
  const battle: any = a.battle;
  const rat = battle.allEntities().find((e: any) => e.shikigamiId === 232);
  const foe = battle.allEntities().find((e: any) => e.teamId !== rat.teamId);
  return { battle, rat, foe };
}
const applies = (battle: any) => battle.trace.filter((t: any) => t.t === "STATUS_APPLY" && t.status === "2322_1").length;
const hit = async (battle: any, foe: any, rat: any, n = 20) => { for (let i = 0; i < n; i++) { rat.hp = rat.maxHp; await battle.damage(foe, rat, 60, DamageType.NORMAL, 1); } };

sec("[3] ★★★ 行为：被封印的单位**被动不再触发**，状态消失后恢复");
{
  const { battle, rat, foe } = await ratBattle();
  const before = applies(battle);
  await hit(battle, foe, rat, 20);
  const normal = applies(battle) - before;
  ok("★★★ 基线：没被封印时，20 次挨打有触发（40% 概率）", normal > 0, "触发 " + normal + " 次");

  rat.addStatus(defOf("3253_1") as any, 0, 1, 9);
  ok("★★ 前置：封印状态确实挂在身上", hasSuppression(rat.statusDefs(), "PASSIVE"));
  const before2 = applies(battle);
  await hit(battle, foe, rat, 20);
  ok("★★★ 被封印之后 20 次挨打**一次都不触发**（处理器在 collect 阶段就被挡掉了）",
    applies(battle) === before2, "触发 " + (applies(battle) - before2) + " 次");

  rat.expireStatus(rat.statuses.find((s: any) => s.def.id === "3253_1")!);
  const before3 = applies(battle);
  await hit(battle, foe, rat, 20);
  ok("★★★ 封印消失后**恢复触发**（不是把处理器永久删掉了）", applies(battle) > before3, "触发 " + (applies(battle) - before3) + " 次");
}

sec("[4] ★★★ G0：封印跟着**状态**走 —— 存档→重建之后仍然生效");
{
  const { battle, rat, foe } = await ratBattle();
  rat.addStatus(defOf("3253_1") as any, 0, 1, 9);
  const snap = captureState(battle);
  // ★ 恢复要的 deps 与 g0-state / g12 同一套（kit + makeRuntime + attachRuntime）
  // ★ 恢复路径按 defId 去 StatusBook 取定义（快照里不存 def）。生产代码在**施加时**会
  //   StatusBook.set(id, def)（character.ts），所以这里照做 —— 否则会走"缺定义"那条如实记账的支路。
  StatusBook.set("3253_1", defOf("3253_1") as any);
  const kit2 = createKit(bundle);
  const rebuilt: any = restoreBattle(JSON.parse(JSON.stringify(snap)), { kit: kit2, makeRuntime: (id: number) => runtimeFor(kit2, id), attachRuntime } as any);
  const rat2 = rebuilt.allEntities().find((e: any) => e.shikigamiId === 232);
  ok("★★★ 重建之后求值器仍说「被封印」（因为它读的是状态，而状态在 state 里）",
    hasSuppression(rat2.statusDefs(), "PASSIVE"));
  ok("★★★ 对照：这条性质**不依赖** bus 的运行时集合（那个 Set 不进 state）",
    rebuilt.bus.suppressedPassive.size === 0 && hasSuppression(rat2.statusDefs(), "PASSIVE"),
    JSON.stringify({ setSize: rebuilt.bus.suppressedPassive.size }));
}

sec("[5] ★★★ 御魂侧：御魂失效真的挡掉御魂效果（且只挡被封印的那一个单位）");
{
  // 全队穿招财猫（回合开始时 50% 概率 +2 鬼火），把红方 1 号封印住
  const m: any = canonicalMatch();
  for (const side of ["red", "blue"]) for (const u of m[side].units) u.soulId = 5;   // 招财猫
  const a: any = assembleMatch(createKit(bundle), m, { seed: 20261001, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  const battle: any = a.battle;
  const victim = battle.teams[0].members[0];
  victim.addStatus(defOf("3253_1") as any, 0, 1, 99);
  await battle.runPartial(20);
  const gains = battle.trace.filter((t: any) => t.t === "ORB_GAIN" && t.src === victim.id);
  const others = battle.trace.filter((t: any) => t.t === "ORB_GAIN" && t.src !== victim.id && t.before !== undefined);
  ok("★★★ 被封印单位的招财猫**一次都没触发**", gains.length === 0, "触发 " + gains.length + " 次");
  ok("★★ 对照：没被封印的其它单位照常触发（证明不是整个御魂系统被关掉了）", others.length > 0, "其它单位 " + others.length + " 次");
  console.log("    20 回合里：被封印者 0 次｜其它单位 " + others.length + " 次 ORB_GAIN");
}

sec("[6] ★★★ 登记册：封印的写入方从「没有」变成「有」，但形态与原来写的不同");
{
  const prod = producerScanFiles(ROOT).map(f => stripComments(fs.readFileSync(f, "utf8"))).join("\n");
  ok("★★★ Battle 注入了封印求值器（这就是新的写入方）", /bus\.suppressProvider = /.test(prod));
  ok("★★★ 而那个 Set 仍然没有生产写入方 —— 它是**旧通道**，两处判据是「或」的关系",
    !/suppressedPassive\.add\(/.test(prod), JSON.stringify(prod.match(/suppressedPassive\.add\(/g)));
  const cap = CAPABILITIES.find(c => c.key === "SEAL")!;
  ok("★★★ 能力表：封印不再是「没有任何写入方」", !/没有任何写入方/.test(cap.note), cap.note.slice(0, 50));
  ok("★★★ 封印升为 FULL 且给了 producer（本轮接线后，它不再是「有标记没写入方」）",
    cap.support === "FULL" && !!cap.producer && cap.note.includes("仍未建模"));
  // ★★★ 与第 93 轮的「吸血」同一处置：机制接线了 ⇒ 从**未建模表**里移除。
  //   移除的前提可机械检查：状态标记真有（第 [1] 节）、行为真发生（第 [3]/[5] 节）、
  //   而剩下的 3 处命中全是**名词用法**（封印结界 / 天羽羽斩的封印）。
  ok("★★★ 未建模表里**不再有**「封印」（机制接线了；剩下的是名词用法，不归这个动词管）",
    !findUnmodeled("对敌方目标附加封印效果", splitClauses).some(h => h.verb === "封印"),
    JSON.stringify(findUnmodeled("对敌方目标附加封印效果", splitClauses).map(h => h.verb)));
  ok("★★ 而名词用法本来就不该进未建模表（「若开启封印结界时」不是「我在封印别人」）",
    !findUnmodeled("若开启封印结界时，此技能改为攻击敌方目标2次", splitClauses).some(h => h.verb === "封印"),
    JSON.stringify(findUnmodeled("若开启封印结界时，此技能改为攻击敌方目标2次", splitClauses).map(h => h.verb)));
}

sec("[7] ★★ 默认路径指纹不变（典型对局里没有任何单位带封印状态）");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  await a.battle.run();
  ok("★★★ OFF 指纹逐位不变", stateHash(captureState(a.battle)) === BASE, stateHash(captureState(a.battle)));
}

console.log("\n=== 封印: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
