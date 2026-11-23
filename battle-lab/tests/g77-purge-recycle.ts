// tests/g77-purge-recycle.ts — ★★★ 第 121 轮：**驱散/解除漏回收属性加成**（一个不报错、只是悄悄失真的缺陷）
//
// 由来（实测）：`Entity.dispel()` / `Entity.remove()` 此前只 `statuses.splice(...)` + refreshReviveBlock，
//   而 `expireStatus()` 会把该状态的 effects 一并回收 —— 三个入口本该是同一件事，实现却是两套。
//   探针（tools/_probe-dispel121.ts）：给单位加 +100 攻击的增益 → `dispel()` 之后**攻击仍然 +100**，
//   `effects` 里还留着一条没有主人的 effect。长局里这类泄漏会持续累积。
// 修复：三个入口共用一份 `recycleStatus()`。本测试就是它的两侧闸门。
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { buildCharacter } from "../compile/character.ts";
import { compileBuff } from "../compile/buff-compiler.ts";
import { StatusBook } from "../kernel/status.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const buffs = new Map<string, any>((JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "buffs.json"), "utf8")) as any[]).map(b => [String(b.id), compileBuff(b)]));
const fresh = async (seed = 20261001) => { const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed }); await a.battle.runStartup(); return a.battle; };
const probeSkill = (desc: string) =>
  buildCharacter({ id: 1, name: "探查单位", panel: { atk: 1000, hp: 50000, def: 300, spd: 100, cri: 0, crid: 1.5, efh: 0, efr: 0 }, skills: [{ id: "probe", name: "探查", cost: 0, description: desc }] } as any,
    undefined, undefined, buffs, 0, 1).entity.skills[0];
/** 造一个带属性加成的探查状态：+100 攻击（FIXED） */
const buffDef = (id: string, dispellable: boolean, removable: boolean): any => ({
  id, name: "探查·" + id, category: "BUFF_STATE", dispellable, removable,
  preventsLethal: null, immuneTo: null, blocksRevive: false, durationPolicy: "SOURCE_TURN", tags: [],
});
const plusAtk = [{ prop: "atk", value: 100, mode: "FIXED" as const }];

sec("[1] dispel / remove 必须把属性加成一起回收（两侧）");
{
  const bt: any = await fresh();
  const e = bt.teams[0].members[0];
  const base = e.prop("atk");
  e.addStatus(buffDef("probe_disp", true, true), 999, 1, 5, plusAtk);
  ok("前置：加上 +100 攻击的增益后攻击确实上升", e.prop("atk") === base + 100, base + " → " + e.prop("atk"));
  const gone = e.dispel("probe_disp");
  ok("★ 状态确实被驱散（dispel 返回 true 且 hasStatus 为假）", gone === true && !e.hasStatus("probe_disp"));
  ok("★★★ 而且**属性加成回落**（第 121 轮修复的那一步）", e.prop("atk") === base, "期望 " + base + "，实际 " + e.prop("atk"));
  ok("★★★ effects 里不再留下无主的加成", !e.effects.some((x: any) => String(x.source).startsWith("probe_disp")), JSON.stringify(e.effects.length));

  e.addStatus(buffDef("probe_rm", false, true), 999, 1, 5, plusAtk);
  const base2 = base;
  const okRm = e.remove("probe_rm");
  ok("★ 不可驱散但可解除：remove 生效", okRm === true && !e.hasStatus("probe_rm"));
  ok("★★★ remove 同样回收加成", e.prop("atk") === base2, "期望 " + base2 + "，实际 " + e.prop("atk"));
}

sec("[2] 反向：把**旧实现**（裸 splice + refreshReviveBlock）装回去，必须泄漏");
{
  const bt: any = await fresh();
  const u = bt.teams[0].members[0];
  const base = u.prop("atk");
  u.addStatus(buffDef("probe_old", true, true), 999, 1, 5, plusAtk);
  const i = u.statuses.findIndex((s: any) => s.def.id === "probe_old");
  u.statuses.splice(i, 1);            // ← 旧 dispel 的全部动作
  u.refreshReviveBlock();
  ok("★★★ 旧实现确实**泄漏**（攻击仍高出 100）—— 证明上一条闸门不是空转",
    u.prop("atk") === base + 100 && !u.hasStatus("probe_old"), "期望泄漏 +100，实际 " + (u.prop("atk") - base));
}

sec("[3] 端到端：走真实技能路径（编译出的「驱散敌方目标1个增益状态」）");
{
  const bt: any = await fresh();
  const self = bt.teams[0].members.find((m: any) => m.alive);
  const foe = bt.enemiesOf(0)[0];
  const base = foe.prop("atk");
  foe.addStatus(buffDef("probe_e2e", true, true), 999, 1, 5, plusAtk);
  ok("前置：敌方带着 +100 攻击的增益", foe.prop("atk") === base + 100);
  const skill = probeSkill("驱散敌方目标1个增益状态");
  bt.trace.length = 0;
  await skill.execute(bt, self, foe);
  ok("★ 技能把增益驱散掉了", !foe.hasStatus("probe_e2e"), JSON.stringify(foe.statuses.map((s: any) => s.def.id)));
  ok("★★★ 而且敌方的攻击回到基线（第 121 轮之前这里会一直高出 100）", foe.prop("atk") === base, "期望 " + base + "，实际 " + foe.prop("atk"));
  ok("★★ 事件照样发出（与 g21 的分工：g21 查状态被拿掉，这里查**属性也回落**）",
    bt.trace.some((x: any) => x.t === "STATUS_REMOVE"));
}

sec("[4] 记账：泄漏面有多大、哪些入口受影响、行为是否中性");
{
  const withEffects = [...buffs.values()].filter(cb => (cb.effects ?? []).length > 0).length;
  console.log("    KB buff 共 " + buffs.size + " 条，其中带属性加成（effects 非空）**" + withEffects + "** 条 —— 这就是泄漏面");
  ok("★★ 带加成的 buff 占相当比例（≥ 50 条），所以这不是边角料", withEffects >= 50, String(withEffects));
  const bt: any = await fresh();
  const e = bt.teams[0].members[0];
  const before = e.effects.length;
  ok("★★ 幂等性：驱散一个不存在的 id 返回 false 且不动 effects", e.dispel("no_such_status") === false && e.effects.length === before);
  const full: any = await fresh();
  await full.run();                        // ★ 指纹是**跑完整场**之后的（g76 同款锚点）
  const h = stateHash(captureState(full));
  ok("★★ 典型对局（无驱散）指纹不变 ⇒ 这次修复对不含驱散的阵容是行为中性的", h === "2d7c7507e18db61f", h);
}

console.log("\n=== 驱散/解除的属性回收: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;