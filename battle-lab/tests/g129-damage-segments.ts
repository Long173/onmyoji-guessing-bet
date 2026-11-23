// tests/g129-damage-segments.ts — ★★★ 第 252 轮：**分段伤害形状**（`SkillIR.damageSegments`）
//
// 由来（报告 §191.4 留下的第一件事）：331_03「予愿必还」的产物把「3 次」套到了**全体**上（15 条），
//   而原文是「攻击敌方目标3次…然后攻击敌方全体1次」= 8 条。探针 tools/_probe-seg252.ts 一量：
//   全库 `hits > 1` 且 `targeting` 同时含「全体」与「单目标」的有 **12 条** —— 这不是孤例，是一族。
//
// 本轮做两件事，**两侧互斥**（一处缺口一条记录，且不许"修好了还记着"）：
//   ① **修**：形状干净、四条闸门全过的 4 条（262_03 / 281_03 / 331_03 / 375_03）改按段展开；
//   ② **记**：其余写法（范围相同 / 顺序相反 / 动态量 / 条件追加）+「次数读成了上限」+「暴击那一族」逐条具名缺口。
//
// 判据：产物逐段核对 · 行为逐条实测 · 反向（没被收的逐位不变）· 记账人口 · 两侧互斥 · 闸门负例 · 逐句归因不打架 · 指纹护栏。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const dump: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "skill-ir.json"), "utf8"));
const byId = (id: string) => dump.find((x: any) => x.id === id);
const verbged = (ir: any, verb: string) => (ir.unmodeledMechanics ?? []).filter((m: any) => m.verb === verb);
/** ★★★ 第 254 轮：4 → **6** —— 本轮又收下两种写法（②反序 607_03 · ③静态追加 556_03） */
const FIXED = ["262_03", "281_03", "331_03", "375_03", "556_03", "607_03"];

sec("[1] ★★★ 产物：恰好 4 条技能有分段形状，逐段的范围/次数/比例都要经得起复核");
{
  const withSeg = dump.filter((ir: any) => Array.isArray(ir.damageSegments) && ir.damageSegments.length > 0);
  ok("★★★ 全库恰好 6 条（三种形状各自放行的那六条）", withSeg.length === 6 && withSeg.map((ir: any) => ir.id).sort().join(",") === [...FIXED].sort().join(","), JSON.stringify(withSeg.map((ir: any) => ir.id)));
  const want: Record<string, Array<[string, number, number]>> = {
    "262_03": [["ENEMY_ALL", 3, 33], ["ENEMY_ONE", 1, 88]],
    "281_03": [["ENEMY_ONE", 5, 19], ["ENEMY_ALL", 1, 44]],
    "331_03": [["ENEMY_ONE", 3, 72], ["ENEMY_ALL", 1, 72]],
    "375_03": [["ENEMY_ALL", 2, 30], ["ENEMY_ONE", 1, 60]],
    "556_03": [["ENEMY_ALL", 3, 72], ["ENEMY_ONE", 3, 72]],
    "607_03": [["ENEMY_ONE", 1, 160], ["ENEMY_ALL", 2, 50]],
  };
  for (const id of FIXED) {
    const ir: any = byId(id);
    const got = (ir.damageSegments ?? []).map((g: any) => [g.scope, Number(g.hits), Number(g.ratio)]);
    ok("★★★ " + id + "「" + ir.name + "」两段的 scope/hits/ratio 与原文一致", JSON.stringify(got) === JSON.stringify(want[id]), JSON.stringify(got));
    ok("★★ " + id + "：每一段都带着可复核的原句", (ir.damageSegments ?? []).every((g: any) => typeof g.clause === "string" && g.clause.length >= 8));
    ok("★★ " + id + "：recognized 里点名了这个机制", (ir.recognized ?? []).some((r: string) => r.startsWith("damageSegments:")), JSON.stringify((ir.recognized ?? []).filter((r: string) => r.startsWith("damageSegments"))));
  }
}

sec("[2] ★★★ 行为：一次施放的伤害事件条数 = 原文读出来的条数（此前 30 / 50 / 15 / 20）");
const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return { unitId: "u-" + name, shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 40000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 }, soulId: null };
};
const run = async (name: string, id: string, opts: any = { free: true }) => {
  const m: any = canonicalMatch();
  m.red.units[0] = unit(name);
  const a: any = assembleMatch(createKit(bundle), m, { seed: 252, passives: "NOT_EXECUTED", traceLevel: "FULL" });
  await a.battle.runStartup();
  const e = a.battle.teams[0].members[0];
  const foe = a.battle.teams[1].members[0];
  const sk = (e.skills ?? []).find((k: any) => String(k?.ir?.id ?? "") === id)!;
  const t0 = a.battle.trace.length;
  await sk.execute(a.battle, e, foe, undefined, opts);
  const frames = a.battle.trace.slice(t0);
  return { ev: frames.filter((x: any) => x.t === "DAMAGE"), cast: frames.find((x: any) => x.t === "SKILL_CAST"), frames };
};
{
  const CASES: Array<[string, string, number]> = [["姑获鸟", "262_03", 16], ["烟烟罗", "281_03", 10], ["御怨般若", "331_03", 8], ["影鳄", "375_03", 11], ["天照", "556_03", 18], ["百羽凤凰火", "607_03", 11]];
  for (const [name, id, want] of CASES) {
    const r = await run(name, id);
    ok("★★★ " + id + "「" + (byId(id)?.name ?? "") + "」一次施放 ⇒ **" + want + " 条**伤害事件", r.ev.length === want, String(r.ev.length));
    ok("★★ " + id + "：打到的目标仍是全体 5 人（分段只改「几次」，不改「打谁」）", new Set(r.ev.map((x: any) => x.dst)).size === 5, String(new Set(r.ev.map((x: any) => x.dst)).size));
  }
  const r262 = await run("姑获鸟", "262_03");
  ok("★★★ Theater 的横幅不再比产物乐观：SKILL_CAST 带 segments（一次施放不止一种次数）",
    Array.isArray(r262.cast?.segments) && r262.cast.segments.join("+") === "3x33%/全体+1x88%/单体", JSON.stringify(r262.cast?.segments ?? null));
}

sec("[3] ★★★ 反向：没被收进来的**逐位不变**（多算仍在，账也在 —— 本轮不许顺手改它们）");
{
  /** ★★★ 第 254 轮：607_03 从"反向"挪进"已收"（它的形状落地了）—— 反向这一组补上 392_03（动态追加，仍不收） */
  const CASES: Array<[string, string, number]> = [["大天狗", "217_03", 30], ["神启荒", "390_02", 30], ["平将门", "592_03", 30], ["季", "392_03", 30]];
  for (const [name, id, want] of CASES) {
    const ir: any = byId(id);
    ok("★★★ " + id + "：仍然**没有** segments 字段（判据把它挡下了）", ir.damageSegments === undefined, JSON.stringify(ir.damageSegments ?? null));
    const r = await run(name, id);
    ok("★★★ " + id + "：一次施放仍是 " + want + " 条 —— 行为一个字没动", r.ev.length === want, String(r.ev.length));
  }
}

sec("[4] ★★★ 记账：五个缺口动词的人口与内容（每条都要有可复核的原句与实测证据）");
{
  /** ★★★ 第 254 轮：分段那一族的记账从 7 降到 **5**（两条落地）；另加本轮新写的两个动词 */
  /**
   * ★★★ 第 255 轮按事实改写：**「失血」从 3 条归零** —— 第 254 轮记的那三条（百羽凤凰火 607_01/607_02/607_03）
   *   在这一轮真的接了执行点（`SkillIR.selfHpLoss` + compile/character.ts 的 `battle.lose`），
   *   于是记账按"两侧互斥"撤掉。这个动词**留在代码里**是 fail-closed：它只服务**被动**技能写「失去N%生命」的情形，
   *   而今天全库没有这种写法（所以人口是 0，不是"判据被删了"）。执行面与语义见 tests/g131-self-hp-loss.ts。
   */
  const POP: Array<[string, number]> = [["分段伤害形状", 5], ["次数读成了上限", 6], ["暴击联动", 1], ["受暴击触发", 1], ["暴击伤害转化", 1], ["失血", 0], ["承受者选择规则", 8]];
  for (const [verb, n] of POP) {
    const hit = dump.filter((ir: any) => verbged(ir, verb).length > 0);
    ok("★★★ 缺口动词「" + verb + "」全库 " + n + " 条", hit.length === n, String(hit.length));
    ok("★★ " + verb + "：每条 severity=WARN · clause 非空 · 证据指向留在仓库里的探针",
      hit.every((ir: any) => verbged(ir, verb).every((m: any) => m.severity === "WARN" && String(m.clause ?? "").length >= 6 && /_probe-(seg252|m254)/.test(String(m.evidence))))
      && fs.existsSync(path.join(ROOT, "battle-lab", "tools", "_probe-seg252e.ts")) && fs.existsSync(path.join(ROOT, "battle-lab", "tools", "_probe-seg252m.ts"))
      && fs.existsSync(path.join(ROOT, "battle-lab", "tools", "_probe-m254a.ts")) && fs.existsSync(path.join(ROOT, "battle-lab", "tools", "_probe-m254d.ts")),
      JSON.stringify(hit.map((ir: any) => ir.id)));
  }
}

sec("[5] ★★★ 两侧互斥：修好的四条**不许**再报「分段伤害形状」");
{
  const segFlagged = dump.filter((ir: any) => verbged(ir, "分段伤害形状").length > 0).map((ir: any) => ir.id);
  ok("★★★ 4 条已落地的不在缺口名单里", FIXED.every((id) => !segFlagged.includes(id)), JSON.stringify(segFlagged));
  ok("★★★ 反过来：缺口名单里的 5 条都**没有** segments 字段", segFlagged.every((id: string) => byId(id)?.damageSegments === undefined), JSON.stringify(segFlagged.map((id: string) => [id, !!byId(id)?.damageSegments])));
  ok("★★ 而且这 5 条此前是「完整编译」的：现在句子分类跟着走（MECHANIC_UNPARSED + unparsed 非空）",
    segFlagged.every((id: string) => (byId(id)?.sentences ?? []).some((s: any) => s.kind === "MECHANIC_UNPARSED") && (byId(id)?.unparsed ?? []).length >= 1), JSON.stringify(segFlagged));
}

sec("[6] ★★★ 逐句归因不打架：调用方按句收窄伤害槽位时，**一律回旧路**（fail-closed）");
{
  const r = await run("姑获鸟", "262_03", { free: true, onlyEffectSlots: { damage: [] } });
  ok("★★★ 传了 onlyEffectSlots.damage=[] ⇒ 0 条伤害（分段路径被挡下，而不是绕过归因继续打）", r.ev.length === 0, String(r.ev.length));
  const r2 = await run("姑获鸟", "262_03", { free: true, onlyEffectSlots: { damage: [0] } });
  ok("★★★ 传了 damage=[0] ⇒ 回到旧路（槽数 × hits × 人数 = 15 条）—— 语义与第 188 轮一致", r2.ev.length === 15, String(r2.ev.length));
}

sec("[7] ★★ 指纹护栏：这四条技能的主人都**不在**典型阵容里");
{
  const LINEUP = [202, 297, 601, 225, 346, 205, 358, 267, 352, 390];
  const owners = FIXED.map((id) => Number(String(id).split("_")[0]));
  ok("★★ 262 / 281 / 331 / 375 都不在典型阵容 ⇒ 两个指纹不该动", owners.every((c) => !LINEUP.includes(c)), JSON.stringify(owners));
}

console.log("\ng129-damage-segments: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
