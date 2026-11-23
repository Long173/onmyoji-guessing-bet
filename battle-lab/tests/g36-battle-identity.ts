// tests/g36-battle-identity.ts — ★★★ 战斗状态里不许有「随机生成的身份」（第 57 轮）
//
// 由来（实测，不是推理）：
//   技能护盾的 id 是 `"sh_" + 技能id + "_" + h0()`，而 `h0() = Math.random().toString(36).slice(2,7)`。
//   shields 会被序列化进 BattleState（kernel/state.ts），于是——
//   **同一份输入、同一个 seed，两次运行的 stateHash 不同。**
//
//   实测形态（一个带护盾技能的单位，其余完全不变）：
//     第 1 次：指纹 02eca52f631ed499｜护盾 ["sh_probe_qi5w5", ...]
//     第 2 次：指纹 d3ca4a823d1c2b8e｜护盾 ["sh_probe_vs400", ...]
//     第 3 次：指纹 8e27fc7feeab36f1｜护盾 ["sh_probe_mbhwh", ...]
//   winner 与 turns 三次完全一样 —— 所以**胜率是对的**，坏掉的是「同一场战斗只有一个指纹」
//   这条不变量。G3 的逐帧校验（Frame N == final）、Replay determinism（目标 ⑩）、
//   G0 的「存档重载后续跑完全一致」全都建立在它上面。
//
// 这个测试锁三件事：
//   ① 施加护盾只有 Entity.addShield 一个入口（且它是确定的：同一状态必得同一个 id）；
//   ② 带护盾的对局，同 seed 两次运行 stateHash 逐位相同（**在旧代码上这条会红**）；
//   ③ 战斗路径的生产代码不许调用 Math.random（UI 层白名单写明理由）。
import fs from "node:fs";
import path from "node:path";
import { compileBuff } from "../compile/buff-compiler.ts";
import { buildCharacter } from "../compile/character.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";
import { producerScanFiles, stripComments } from "../tools/field-census.ts";
import { Entity } from "../kernel/entity.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const buffs = new Map<string, any>((JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[])
  .map(b => [String(b.id), compileBuff(b)]));
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));

/** 造一个"只会放护盾"的单位，逼它真的走一遍技能施盾路径 */
const shieldSkill = () => buildCharacter(
  { id: 1, name: "探查单位", panel: { atk: 1000, hp: 50000, def: 300, spd: 100, cri: 0, crid: 1.5, efh: 0, efr: 0 },
    skills: [{ id: "probe", name: "探查", cost: 0, description: "自身获得护盾，能吸收10%生命上限的伤害" }] },
  undefined, undefined, buffs, 0, 1).entity.skills[0];

const runWithShield = async (seed: number) => {
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed });
  await a.battle.runStartup();
  const u = a.battle.teams[0].members[0];
  u.skills = [shieldSkill()];
  u.usedSkills = new Set();
  await a.battle.run();
  return {
    hash: stateHash(captureState(a.battle)),
    won: a.battle.winner, turns: a.battle.turn,
    ids: a.battle.allEntities().flatMap((e: any) => e.shields.map((s: any) => s.id)),
  };
};

sec("[1] ★★★ 带护盾的对局必须可复现（这条在旧代码上是红的）");
{
  const a = await runWithShield(20261001);
  const b = await runWithShield(20261001);
  ok("★★ 前置：这一局真的产生了护盾（否则下面两条会平凡通过）", a.ids.length > 0, "护盾数 " + a.ids.length);
  ok("★★ 前置：两次运行的结果本身一致（说明战斗序列没问题）", a.won === b.won && a.turns === b.turns,
    JSON.stringify([a.won, a.turns, b.won, b.turns]));
  ok("★★★ 同 seed 两次运行 stateHash 逐位相同", a.hash === b.hash, a.hash + " ≠ " + b.hash);
  ok("★★★ 护盾 id 逐位相同（不是「赢的一样、指纹不一样」）", JSON.stringify(a.ids) === JSON.stringify(b.ids),
    JSON.stringify([a.ids.slice(0, 3), b.ids.slice(0, 3)]));
  console.log("    第 1 次指纹 " + a.hash + "｜护盾 " + a.ids.length + " 个，例：" + JSON.stringify(a.ids.slice(0, 2)));
  console.log("    第 2 次指纹 " + b.hash + "｜护盾 " + b.ids.length + " 个，例：" + JSON.stringify(b.ids.slice(0, 2)));
}

sec("[2] ★★ addShield 是确定性的：给定状态，id 只由状态决定");
{
  const mk = () => new Entity(101, "甲", 0, { hp: 1, atk: 1, def: 0, spd: 100, cri: 0, crid: 1.5, dmgTakenB: 0, dmgTakenD: 0, healDown: 0 });
  const a = mk(), b = mk();
  const s1 = a.addShield({ value: 100, sourceId: 7, tag: "probe" });
  const s2 = b.addShield({ value: 100, sourceId: 7, tag: "probe" });
  ok("★ 两个同状态实体 → 同一个 id", s1.id === s2.id, s1.id + " / " + s2.id);
  ok("★ 返回的就是进数组的那一个（不是副本）", a.shields[0] === s1);
  ok("★★ 默认值：consumed=0 / broken=false / dispellable=true",
    s1.consumed === 0 && s1.broken === false && s1.dispellable === true, JSON.stringify(s1));
  ok("★ 显式 dispellable:false 被尊重（蚌精口径）", mk().addShield({ value: 1, sourceId: 1, dispellable: false }).dispellable === false);
  ok("★★ 同实体连续两层盾 → id 不重复", (() => { const e = mk(); return e.addShield({ value: 1, sourceId: 1 }).id !== e.addShield({ value: 1, sourceId: 1 }).id; })());
  ok("★ 显式 id 原样使用（调用方想自己命名时不拦）",
    mk().addShield({ value: 1, sourceId: 1, id: "自定义" }).id === "自定义");
  // 存档 → 重载 → 续跑：id 序号靠 shields.length，不靠额外字段
  const e = mk();
  e.addShield({ value: 1, sourceId: 1 }); e.addShield({ value: 1, sourceId: 1 });
  const third = e.addShield({ value: 1, sourceId: 1 });
  ok("★★ 序号来自 shields.length（已被序列化的状态）而不是新字段 ⇒ 存档续跑接得上",
    third.id.endsWith("_2"), third.id);
}

sec("[3] ★★ 唯一写入口：生产代码里没有别的地方 push shields");
{
  const prod = producerScanFiles(ROOT).map(f => ({ f: path.relative(ROOT, f).split(path.sep).join("/"), s: stripComments(fs.readFileSync(f, "utf8")) }));
  const pushes = prod.filter(x => x.s.includes("shields.push(")).map(x => x.f);
  ok("★★ 只有 kernel/entity.ts 会写 shields 数组",
    pushes.length === 1 && pushes[0] === "battle-lab/kernel/entity.ts", JSON.stringify(pushes));
  const souls = prod.filter(x => /m\.shields\.push|t\.shields\.push/.test(x.s)).map(x => x.f);
  ok("★ 也不是「换个变量名再 push 一次」", souls.length === 0, JSON.stringify(souls));
}

sec("[4] ★★★ 战斗路径不许调用 Math.random（白名单要写明理由）");
{
  /**
   * 允许的 Math.random：**不进 BattleState** 的地方。
   * 判定标准不是"文件在哪"，而是"这个值会不会被序列化进战斗状态或影响战斗推进"。
   */
  const ALLOWED: Record<string, string> = {
    "apps/web/src/stores/simulation.ts": "模拟请求 id（前端用来配对请求/响应），不进 BattleState",
    "apps/web/src/lab/observations.ts": "观测记录 id（本地观测登记表的行号），不进 BattleState",
    "apps/web/src/contracts/guessing-match.ts": "阵容行的 unitId。★ 它**是输入文档的一部分**，不是战斗状态：引擎实体 id 按位置分配（红 101..205），unitId 只用于把引擎实体映射回界面行 —— 所以同一份阵容两次输入本来就是两份文档",
    "apps/web/src/adapters/mock-adapter.ts": "seed === AUTO 时随机挑一个 seed。挑 seed 这一步本来就是随机的；挑出来的值经 resultId 编码可回查。它决定战斗，但不从战斗里产生",
  };
  const prod = producerScanFiles(ROOT).map(f => path.relative(ROOT, f).split(path.sep).join("/"));
  const hits = prod.filter(f => /Math\.random/.test(stripComments(fs.readFileSync(path.join(ROOT, f), "utf8"))));
  const unlisted = hits.filter(f => !(f in ALLOWED));
  ok("★★★ 生产代码里的 Math.random 全在白名单里", unlisted.length === 0, JSON.stringify(unlisted));
  ok("★★ 战斗内核里一个都没有（kernel / compile / soul / runner）",
    hits.filter(f => /battle-lab\/(kernel|compile|soul|runner)\//.test(f)).length === 0,
    JSON.stringify(hits.filter(f => /battle-lab\//.test(f))));
  // 对照：白名单不是"把所有文件都写进去"——它必须短，且有理由
  ok("★ 白名单每条都写了理由", Object.values(ALLOWED).every(v => v.length > 8));
  console.log("    生产代码含 Math.random 的文件 " + hits.length + " 个，全部在 UI 层：" + hits.map(f => f.split("/").pop()).join(", "));
}

console.log("\n=== 战斗身份确定性: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
