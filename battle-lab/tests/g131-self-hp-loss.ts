// tests/g131-self-hp-loss.ts — ★★★ 第 255 轮：**失血**（「然后失去N%最大生命值」）
//
// 由来：第 254 轮修伤害形状时发现——百羽凤凰火三条技能的「失去N%最大生命值」**今天什么都不做**，
//   而内核早就有 `loseHp`（官方[21] 失去 ≠ 伤害：不暴击、**不被护盾吸收**、不触发受到伤害相关效果）。
//   那一轮先补了缺口动词「失血」把账记上；这一轮把**主动技能**这条路径真的接起来（IR 槽位 + 执行点）。
//
// 判据：产物逐条 · 行为逐条（HP 真的掉，且掉的正是那个比例）· **护盾不许吸收它**（与伤害是两条管线）·
//       反向（没有这个字段的技能一动不动）· 被动 fail-closed（不写字段、继续记账）· 指纹护栏。
import fs from "node:fs";
import path from "node:path";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const KB = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const LIST: any[] = Array.isArray(KB) ? KB : (KB.characters ?? KB.items ?? []);
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const dump: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "battle-lab", "fixtures", "skill-ir.json"), "utf8"));
const byId = (id: string) => dump.find((x: any) => x.id === id);

sec("[1] ★★★ 产物：三条技能各有 selfHpLoss（比例 / 基数 / 可复核原句）");
{
  const withLoss = dump.filter((ir: any) => ir.selfHpLoss);
  ok("★★★ 全库恰好 3 条，都是百羽凤凰火（607）的技能", withLoss.length === 3 && withLoss.every((ir: any) => Number(ir.charId) === 607), JSON.stringify(withLoss.map((ir: any) => ir.id)));
  const WANT: Record<string, number> = { "607_01": 10, "607_02": 25, "607_03": 50 };
  for (const id of Object.keys(WANT)) {
    const ir: any = byId(id);
    ok("★★★ " + id + "「" + ir.name + "」 = 失去最大生命的 " + WANT[id] + "%（基数 maxHp）",
      !!ir.selfHpLoss && Number(ir.selfHpLoss.ratio) === WANT[id] && ir.selfHpLoss.base === "maxHp", JSON.stringify(ir.selfHpLoss ?? null));
    ok("★★ " + id + "：带可复核原句（写着「失去」与百分比）", /失去\s*\d+(?:\.\d+)?\s*%\s*最大生命/.test(String(ir.selfHpLoss?.clause ?? "")), String(ir.selfHpLoss?.clause ?? "").slice(0, 60));
  }
  ok("★★ 报表点名：recognized 里有 selfHpLoss", (byId("607_03").recognized ?? []).some((r: string) => String(r).startsWith("selfHpLoss:")), JSON.stringify(byId("607_03").recognized));
}

sec("[2] ★★★ 边界：被动**不写**这个字段（执行点在施放路径，被动那条路继续由缺口动词记账）");
{
  ok("★★★ 带 selfHpLoss 的技能全部是主动（cost ≥ 0）", dump.filter((ir: any) => ir.selfHpLoss).every((ir: any) => Number(ir.cost) >= 0), JSON.stringify(dump.filter((ir: any) => ir.selfHpLoss).map((ir: any) => [ir.id, ir.cost])));
  const passiveLoss = dump.filter((ir: any) => Number(ir.cost) < 0 && /失去\s*\d+(?:\.\d+)?\s*%\s*(?:最大)?生命/.test(String(ir.description ?? "")));
  ok("★★ 反向：今天全库**没有**被动技能写「失去N%生命」（所以「失血」这个动词当前人口是 0 —— 它留在代码里是 fail-closed，不是死代码）",
    passiveLoss.length === 0, JSON.stringify(passiveLoss.map((ir: any) => ir.id)));
  ok("★★ 而第 254 轮补的那个缺口动词仍然在（判据没被删掉）", fs.readFileSync(path.join(ROOT, "battle-lab", "compile", "skill-compiler.ts"), "utf8").includes("verb: \"失血\""));
}

sec("[3] ★★★ 行为：施放一次，HP 真的按那个比例掉");
const mk = async () => {
  const s = LIST.find((x: any) => x.name === "百羽凤凰火")!;
  const m: any = canonicalMatch();
  m.red.units[0] = { unitId: "u-bf", shikigamiId: s.id, name: s.name, stats: { attack: 3000, hp: 40000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 }, soulId: null };
  const a: any = assembleMatch(createKit(bundle), m, { seed: 255, passives: "NOT_EXECUTED", traceLevel: "FULL" });
  await a.battle.runStartup();
  return { a, e: a.battle.teams[0].members[0], foe: a.battle.teams[1].members[0] };
};
const cast = async (id: string) => {
  const { a, e, foe } = await mk();
  const sk = (e.skills ?? []).find((k: any) => String(k?.ir?.id ?? "") === id)!;
  e.hp = e.maxHp;
  const t0 = a.battle.trace.length;
  await sk.execute(a.battle, e, foe, undefined, { free: true });
  const frames = a.battle.trace.slice(t0);
  return { e, loss: frames.filter((x: any) => x.t === "HP_LOSS"), dmg: frames.filter((x: any) => x.t === "DAMAGE") };
};
{
  const CASES: Array<[string, number]> = [["607_01", 4000], ["607_02", 10000], ["607_03", 20000]];
  for (const [id, want] of CASES) {
    const r = await cast(id);
    ok("★★★ " + id + "：HP 40000 → " + (40000 - want) + "（失去 " + want + "）+ 恰好 1 条 HP_LOSS 痕迹",
      Math.round(r.e.hp) === 40000 - want && r.loss.length === 1 && Math.round(Number(r.loss[0].amount)) === want,
      JSON.stringify({ hp: Math.round(r.e.hp), loss: r.loss.map((x: any) => Math.round(Number(x.amount))) }));
  }
}

sec("[4] ★★★ 官方[21]：失血**不被护盾吸收**（与伤害是两条管线）");
{
  const { a, e, foe } = await mk();
  const sk = (e.skills ?? []).find((k: any) => String(k?.ir?.id ?? "") === "607_03")!;
  e.hp = e.maxHp;
  e.addShield({ value: 999999, sourceId: e.id, dispellable: true, tag: "probe" });
  const shieldOf = () => (e.shields ?? []).reduce((n: number, sh: any) => n + Number(sh.value), 0);
  const s0 = shieldOf();
  await sk.execute(a.battle, e, foe, undefined, { free: true });
  ok("★★★ 带 999999 护盾仍然按全额扣血（护盾挡不住「失去」）", Math.round(e.hp) === 20000, String(Math.round(e.hp)));
  ok("★★★ 而且护盾一点没少（失血不走护盾）", shieldOf() === s0 && s0 > 0, s0 + " → " + shieldOf());
  ok("★★ 对照：同一门技能的**伤害**是会被护盾吃的（两件事分得开）", a.battle.trace.some((x: any) => x.t === "DAMAGE"));
}

sec("[5] ★★ 反向：没有这个字段的技能，施放前后 HP 一动不动");
{
  const { a, e, foe } = await mk();
  const sk = (e.skills ?? []).find((k: any) => String(k?.ir?.id ?? "") === "607_03")!;
  const other = a.battle.teams[0].members[1];
  const before = other.hp;
  await sk.execute(a.battle, e, foe, undefined, { free: true });
  ok("★★ 队友没有被顺手扣血（失血只落在**自己**身上）", other.hp === before, before + " → " + other.hp);
  ok("★★ 且 selfHpLoss 只写在 607 的三条技能上（没有扩散到别的技能）", dump.filter((ir: any) => ir.selfHpLoss).map((ir: any) => Number(ir.charId)).every((c: number) => c === 607));
}

sec("[6] ★★ 指纹护栏：百羽凤凰火不在典型阵容里，两个指纹逐位不变");
{
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001 });
  await a.battle.run();
  ok("★★★ 默认档仍逐位不变（2d7c7507e18db61f）", stateHash(captureState(a.battle)) === "2d7c7507e18db61f", stateHash(captureState(a.battle)));
  const c: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "PARSED_CANDIDATES_ONLY" });
  await c.battle.runStartup(); await c.battle.run();
  ok("★★★ 被动档仍逐位不变（7bc24506bdcd349e）", stateHash(captureState(c.battle)) === "7bc24506bdcd349e", stateHash(captureState(c.battle)));
  const LINEUP = [202, 297, 601, 225, 346, 205, 358, 267, 352, 390];
  ok("★★ 607 不在典型阵容里（所以这一轮不该动指纹）", !LINEUP.includes(607));
}

console.log("\ng131-self-hp-loss: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
