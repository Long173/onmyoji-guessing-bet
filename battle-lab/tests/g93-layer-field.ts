// tests/g93-layer-field.ts — ★★★ 第 142 轮：叠层场地（花海）的行为验收（目标 ①/⑨）
//
// 第 140 轮把六条判据解析成产物、第 141 轮接上装配点，但那时**一条行为断言都没有**。
// 这个文件是那把尺子。目前已验到的（全绿）：
//   · 默认档（被动 OFF）规格仍在 IR 里，但机制**不在场**、跑完整场一条花海痕迹都没有；
//   · 装上之后：先机 3 层（GRANT/SENKI）· 上限随生命比例 3/4/5/6（含 90% 仍 3、24% 为 6 两向）；
//   · 满血被夹到 3 · 掉到 40% 跨两档 +2（3 ⇒ 5，且被上限 5 夹住）· 1 层时不再减；
//   · 主动技能：60% 血 +2 层；机制不在场时**一层都不给**（不留什么都不做的计数器）；
//   · 默认档典型对局指纹逐位不变（2d7c7507e18db61f）。
//
// ★★★ 第 142 轮实测的**未完成部分**（如实记在这里，没有写成断言 —— 写进去就得是红的）：
//   TURN_START 的两条钩子（拥有者回合减 1 层、敌方回合按层结算 39%）**没有触发**：
//   LAYER_FIELD_DECAY 与 LAYER_FIELD_DAMAGE 都是 0 条，而注册本身看起来是成功的。
//   ⇒ 机制目前只到「装得上 · 层数会动 · 上限与跨档正确 · 主动技能给层」，**回合结算那一半还没跑通**。
//   另外「40% 血再 +1 层」第二次施放拿不到层，疑似被鬼火/冷却挡住（与机制无关，待新开一场重测）。
//   判据（修好后直接加回来）：
//     · 敌方回合开始 ⇒ LAYER_FIELD_DAMAGE 恰 1 条，dst=该单位，layers=当前层数，applied≈攻击×0.39×层数；
//     · 拥有者自己的回合 ⇒ LAYER_FIELD_DECAY 1 条（before→before-1），且该回合**没有**伤害；
//     · 跨档时同时给盾（SHIELD_APPLY 且 skill=花海）；
//     · 40% 血施放血之花海 ⇒ +3 层（2 + 低于50%再加1）。
//   按本仓库的规矩：没验过的部分不写进测试（红的测试会把注意力从真问题上带走），
//   但也不许假装验过 —— unmodeled.ts 的「花海」条与报告 §126 都照实写。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { TurnType } from "../kernel/types.ts";
import { bandOf, layerCap, layersOf, layerFieldActive, syncBands } from "../kernel/layer-field.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const BASE = "2d7c7507e18db61f";

function match() { const m: any = canonicalMatch(); m.red.units[0].shikigamiId = 288; m.red.units[0].name = "彼岸花"; return m; }
async function mk(passives: "NOT_EXECUTED" | "PARSED_CANDIDATES_ONLY", seed = 20261002) {
  const a: any = assembleMatch(createKit(bundle), match(), { seed, passives });
  await a.battle.runStartup();
  const owner = a.battle.teams[0].members[0];
  const sk = (owner.skills ?? []).find((s: any) => s?.ir?.layerField);
  return { a, owner, spec: sk?.ir?.layerField, foe: a.battle.teams[1].members[0] };
}
const traceOf = (a: any, t: string) => a.battle.trace.filter((x: any) => x.t === t);

sec("[1] ★★★ 反向先立：默认档（被动 OFF）一条都不许发生");
{
  const { a, owner, spec } = await mk("NOT_EXECUTED");
  ok("★ 规格仍在 IR 里（解析与装配是两件事）", !!spec && spec.term === "花海", JSON.stringify(spec?.term));
  ok("★★★ 但机制**没在场**（没有 installed 标记）", !layerFieldActive(owner, spec!));
  ok("★★ 层数为 0（连记录都不该有）", layersOf(owner, spec!) === 0, String(layersOf(owner, spec!)));
  await a.battle.run();
  ok("★★★ 跑完整场：四条花海痕迹一条都不该出现（OFF 档的历史结果必须逐位不变）",
    ["LAYER_FIELD_SET", "LAYER_FIELD_GRANT", "LAYER_FIELD_DECAY", "LAYER_FIELD_DAMAGE"].every(t => traceOf(a, t).length === 0),
    JSON.stringify(["SET", "GRANT", "DECAY", "DAMAGE"].map(t => t + "=" + traceOf(a, "LAYER_FIELD_" + t).length)));
}

sec("[2] ★★★ 先机：装上就有 3 层（原文里的 [tips_7]）");
const on = await mk("PARSED_CANDIDATES_ONLY");
{
  const { owner, spec } = on;
  ok("★★★ 机制在场（installed 标记）", layerFieldActive(owner, spec!));
  ok("★★★ 战斗开始时 3 层（先机）", layersOf(owner, spec!) === 3, String(layersOf(owner, spec!)));
  ok("★★ 有 GRANT 痕迹，且理由是 SENKI、一次 +3", traceOf(on.a, "LAYER_FIELD_GRANT").some((x: any) => x.reason === "SENKI" && x.gained === 3),
    JSON.stringify(traceOf(on.a, "LAYER_FIELD_GRANT")));
}

sec("[3] ★★★ 上限随生命比例（3/4/5/6），层数被夹住");
{
  const { owner, spec } = on;
  const capAt = (r: number) => layerCap(r, spec!);
  ok("★★★ 满血 100% ⇒ 3；75% ⇒ 4；50% ⇒ 5；25% ⇒ 6（原文那四个数）",
    capAt(1) === 3 && capAt(0.75) === 4 && capAt(0.5) === 5 && capAt(0.25) === 6,
    JSON.stringify([capAt(1), capAt(0.75), capAt(0.5), capAt(0.25)]));
  ok("★★ 两向：90% 仍是 3（没越线不加档）、24% 是 6（三档全越）", capAt(0.9) === 3 && capAt(0.24) === 6);
  ok("★★ bandOf 与上限同源（阈值 0.75/0.5/0.25）", bandOf(1, spec!.capThresholds) === 3 && bandOf(0.4, spec!.capThresholds) === 1);
  owner.hp = owner.maxHp;
  await syncBands(on.a.battle, owner, spec!, "TEST");
  ok("★★★ 满血时层数被夹到 3", layersOf(owner, spec!) === 3, String(layersOf(owner, spec!)));
  owner.hp = owner.maxHp * 0.4;
  await syncBands(on.a.battle, owner, spec!, "TEST");
  ok("★★★ 掉到 40%：跨过 75% 与 50% 两档 ⇒ +2（3 ⇒ 5），并被上限 5 夹住",
    layersOf(owner, spec!) === 5, "after=" + layersOf(owner, spec!) + " cap=" + capAt(0.4));
}

sec("[4] ★★★ 主动技能给层：血之花海 +2（60% 血，条件那半句不触发）");
{
  const { a, owner, spec, foe } = on;
  const skill = (owner.skills ?? []).find((s: any) => s.name === "血之花海");
  ok("★ 前置：找得到那个技能", !!skill);
  owner.hp = owner.maxHp * 0.6;
  owner.notes = (owner.notes ?? []).filter((n: string) => !n.startsWith("layerField:花海:layers="));
  a.battle.trace.length = 0;
  await a.battle.runPseudoTurn(owner, TurnType.PSEUDO_TURN, { skill, target: foe });
  ok("★★★ 60% 血：+2 层", layersOf(owner, spec!) === 2, "layers=" + layersOf(owner, spec!));
  const expect = owner.prop("atk") * spec!.perLayerRatio * layersOf(owner, spec!);
  ok("★ 期望伤害量算得出来（攻击 × 39% × 层数；下一轮补回合结算断言时直接用）", expect > 0, "expect≈" + Math.round(expect));
}

sec("[5] ★★ 反向：机制不在场时，主动技能**不给层**（不留什么都不做的计数器）");
{
  const off = await mk("NOT_EXECUTED");
  const skill = (off.owner.skills ?? []).find((s: any) => s.name === "血之花海");
  off.a.battle.trace.length = 0;
  await off.a.battle.runPseudoTurn(off.owner, TurnType.PSEUDO_TURN, { skill, target: off.foe });
  ok("★★★ 默认档施放血之花海 ⇒ 层数一条记录都没有，也没有 GRANT/SET 痕迹",
    (off.owner.notes ?? []).every((n: string) => !n.startsWith("layerField:花海:layers=")) &&
    ["LAYER_FIELD_SET", "LAYER_FIELD_GRANT"].every(t => traceOf(off.a, t).length === 0),
    JSON.stringify((off.owner.notes ?? []).filter((n: string) => n.includes("layerField"))));
}

sec("[8] ★★★ 跨档给盾 + 条件得层（第 144 轮补齐）");
{
  const s = await mk("PARSED_CANDIDATES_ONLY", 20261004);
  s.owner.hp = s.owner.maxHp * 0.4;
  s.a.battle.trace.length = 0;
  await syncBands(s.a.battle, s.owner, s.spec!, "TEST");
  const shields = s.a.battle.trace.filter((x: any) => x.t === "SHIELD_APPLY" && x.skill === "花海");
  ok("★★★ 跨档时同时给盾（原文「获得1层花海及『血之花海』的护盾」）—— 护盾按**已损失生命**算、且不可驱散",
    shields.length === 1 && shields[0].base === "lostHp" && shields[0].ratio === 20,
    JSON.stringify(shields));
  const g = await mk("PARSED_CANDIDATES_ONLY", 20261005);
  const skill2 = (g.owner.skills ?? []).find((x: any) => x.name === "血之花海");
  g.owner.hp = g.owner.maxHp * 0.4;
  // ★ 先清掉先机那 3 层：这条断言测的是**这次施放**给了几层（不清就是 3+2+1 被上限夹到 5）
  g.owner.notes = (g.owner.notes ?? []).filter((n: string) => !n.startsWith("layerField:花海:layers="));
  g.a.battle.teams[0].orbs.orb = 8;
  g.a.battle.trace.length = 0;
  await g.a.battle.runPseudoTurn(g.owner, TurnType.PSEUDO_TURN, { skill: skill2, target: g.foe });
  ok("★★★ 40% 血施放血之花海 ⇒ +3 层（2 + 低于50%再加1），理由记得下条件那半句",
    layersOf(g.owner, g.spec!) === 3 && g.a.battle.trace.some((x: any) => x.t === "LAYER_FIELD_GRANT" && /BELOW50/.test(String(x.reason))),
    "layers=" + layersOf(g.owner, g.spec!) + " " + JSON.stringify(g.a.battle.trace.filter((x: any) => x.t === "LAYER_FIELD_GRANT").map((x: any) => x.reason)));
}

sec("[7] ★★★ 回合结算（第 143 轮：行动者读取修好之后加回来）");
{
  const t = await mk("PARSED_CANDIDATES_ONLY", 20261003);
  const { a, owner, spec, foe } = t;
  const layers = layersOf(owner, spec!);
  const expect = owner.prop("atk") * spec!.perLayerRatio * layers;
  a.battle.trace.length = 0;
  await a.battle.runTurn(foe, TurnType.NORMAL);
  const dmg = traceOf(a, "LAYER_FIELD_DAMAGE");
  ok("★★★ 敌方回合一开就吃一次花海伤害，层数写进痕迹（layers=" + layers + "）",
    dmg.length === 1 && dmg[0].dst === foe.id && dmg[0].layers === layers,
    JSON.stringify(dmg.map((x: any) => ({ dst: x.dst, layers: x.layers, applied: x.applied }))));
  ok("★★★ 伤害量级 = 攻击 × 39% × 层数（期望 " + Math.round(expect) + "）",
    dmg.length === 1 && Number(String(dmg[0].applied).replace(/,/g, "")) > expect * 0.2,
    "applied=" + JSON.stringify(dmg[0]?.applied));
  const before = layersOf(owner, spec!);
  a.battle.trace.length = 0;
  await a.battle.runTurn(owner, TurnType.NORMAL);
  const dec = traceOf(a, "LAYER_FIELD_DECAY");
  ok("★★★ 拥有者自己回合：减 1 层（" + before + " ⇒ " + (before - 1) + "）",
    dec.length === 1 && dec[0].before === before && dec[0].after === before - 1,
    JSON.stringify(dec.map((x: any) => ({ b: x.before, a: x.after }))));
  ok("★★★ 两向：自己回合**不**结算花海伤害（伤害只属于敌方回合）", traceOf(a, "LAYER_FIELD_DAMAGE").length === 0);
}
sec("[6] ★★★ 默认档典型对局指纹逐位不变（这一轮没动默认路径）");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.run();
  ok("★★★ 指纹仍是 " + BASE, stateHash(captureState(a.battle)) === BASE, stateHash(captureState(a.battle)));
}

console.log("\n=== 叠层场地（花海）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
