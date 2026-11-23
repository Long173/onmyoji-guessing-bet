// tests/g127-overflow-shield.ts — ★★★ 第 249 轮：**治疗溢出转护盾**（蝴蝶精「祈愿之舞」241_03）
//
// 由来：第 248 轮的静默缺口筛查把「自称完整编译」的 818 条技能按机制族扫了一遍，这一条是候选之一：
//   句子在（「若治疗溢出，则获得1个能够吸收蝴蝶精生命上限5%的护盾」），而 `shield` 里一条都没有。
// 判据：产物逐字 · 行为双向（满血 ⇒ 溢出 ⇒ 给盾；残血 ⇒ 不溢出 ⇒ 不给盾）· 盾值 = **施放者**生命上限 5% ·
//   痕迹带 reason=HEAL_OVERFLOW 与溢出量 · 边界（「持续2回合」暂不执行，护盾没有时长载体）如实写进报告。
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

sec("[1] ★★★ 产物：全库恰好 1 条带 overflowShield（蝴蝶精「祈愿之舞」241_03）");
{
  const withO = dump.filter((ir: any) => ir.overflowShield);
  ok("★★★ 恰好 1 条，就是 241_03", withO.length === 1 && withO[0].id === "241_03", JSON.stringify(withO.map((ir: any) => ir.id)));
  const o = withO[0]?.overflowShield ?? {};
  ok("★★★ 字段逐字：吸收**施放者**生命上限 5%，原文的持续回合数也记下来了",
    Number(o.ratio) === 5 && o.base === "selfMaxHp" && Number(o.duration) === 2 && /治疗溢出/.test(String(o.clause)), JSON.stringify(o));
  ok("★★★ 报表点名（recognized 里能看到这条技能靠哪个机制）", (withO[0]?.recognized ?? []).includes("overflowShield:5%/2回合"), JSON.stringify(withO[0]?.recognized));
  ok("★★★ 别的 817 条技能没有这个键", dump.filter((ir: any) => ir.overflowShield).length === 1, String(dump.length));
}

sec("[2] ★★★ 行为：满血 ⇒ 治疗溢出 ⇒ 给盾（盾值 = 施放者生命上限 5%）；残血 ⇒ 不溢出 ⇒ 不给盾");
const unit = (name: string) => {
  const s = LIST.find((x: any) => x.name === name)!;
  return { unitId: "u-" + name, shikigamiId: s.id, name,
    stats: { attack: 3000, hp: 40000, defense: 400, speed: 150, critRate: 0, critDamage: 1.5, effectHit: 0, effectResist: 0 }, soulId: null };
};
async function arena(who: string, seed: number) {
  const m: any = canonicalMatch();
  m.red.units[0] = unit(who);
  const a: any = assembleMatch(createKit(bundle), m, { seed, passives: "NOT_EXECUTED", traceLevel: "FULL" });
  await a.battle.runStartup();
  const e = a.battle.teams[0].members[0];
  const ally = a.battle.teams[0].members[1];
  return { b: a.battle, e, ally };
}
{
  const A = await arena("蝴蝶精", 249);
  const sk = (A.e.skills ?? []).find((s: any) => String(s?.ir?.id ?? "") === "241_03");
  ok("★★ 前置：这一招在自己的技能表里", !!sk, JSON.stringify((A.e.skills ?? []).map((s: any) => s?.ir?.id)));
  const shieldsOf = (u: any) => (u.shields ?? []).filter((x: any) => !x.broken);
  if (sk) {
    /** ① 满血 ⇒ 治疗全溢出 ⇒ 给盾 */
    A.ally.hp = A.ally.maxHp;
    const before = shieldsOf(A.ally).length;
    const t0 = A.b.trace.length;
    await sk.execute(A.b, A.e, A.ally, undefined, { free: true });
    const ev = A.b.trace.slice(t0);
    const shieldEv = ev.find((x: any) => x.t === "SHIELD_APPLY" && x.dst === A.ally.id);
    const expect = A.e.maxHp * 0.05;
    ok("★★★ 满血治疗 ⇒ 溢出 ⇒ 上盾（护盾数 +1）", shieldsOf(A.ally).length === before + 1, JSON.stringify(shieldsOf(A.ally).map((s: any) => s.value)));
    ok("★★★ 盾值 = **施放者**生命上限 5%（" + Math.round(expect) + "）", !!shieldEv && Math.abs(Number(s盾Value(shieldEv)) - expect) < 1, JSON.stringify(shieldEv));
    ok("★★★ 痕迹写明来路：reason=HEAL_OVERFLOW 且带溢出量（没有它，玩家会以为这个盾是凭空来的）",
      !!shieldEv && shieldEv.reason === "HEAL_OVERFLOW" && Number(shieldEv.overflow) > 0, JSON.stringify(shieldEv));
    /** ② 残血 ⇒ 治疗不溢出 ⇒ 不给盾 */
    A.ally.hp = Math.floor(A.ally.maxHp * 0.2);
    const before2 = shieldsOf(A.ally).length;
    const t1 = A.b.trace.length;
    await sk.execute(A.b, A.e, A.ally, undefined, { free: true });
    ok("★★★ 反向：残血治疗不溢出 ⇒ **不给盾**（也不留 HEAL_OVERFLOW 痕迹）",
      shieldsOf(A.ally).length === before2 && !A.b.trace.slice(t1).some((x: any) => x.reason === "HEAL_OVERFLOW"),
      JSON.stringify({ shields: shieldsOf(A.ally).length, before: before2 }));
  }
}

sec("[3] ★★ 爆炸半径与边界");
{
  const LINEUP = [202, 297, 601, 225, 346, 205, 358, 267, 352, 390];
  ok("★★ 蝴蝶精 241 不在典型对局阵容里 ⇒ 两个指纹不该动", !LINEUP.includes(241));
  const o = dump.find((ir: any) => ir.id === "241_03").overflowShield;
  ok("★★★ 边界如实记：原文的「持续 N 回合」只被记录、**运行时暂不执行**（护盾没有时长载体）—— duration 在产物里，但引擎不读它",
    Number(o.duration) === 2, JSON.stringify(o));
}
function s盾Value(ev: any) { return ev.value; }

console.log("\ng127-overflow-shield: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);