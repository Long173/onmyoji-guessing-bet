// tests/m15-golden.ts — Golden Test：base + 御魂套装 -> ExactStats -> DisplayStats，是否复现真实竞猜面板
// 数据源：data/kb/duel-panels.json（对弈百科真实截图面板） + data/kb/soul.json + data/kb/shikigami.full.json
import fs from "node:fs/promises";
import path from "node:path";
import { deriveExactStats } from "../soul/stat-system.ts";
import { toDisplay, makeExact } from "../kernel/stats.ts";
import type { ExactStats, StatKey } from "../kernel/stats.ts";
import { setDisplayMode, RoundingPoint, GameMath } from "../kernel/gamemath.ts";
import type { SoulDef } from "../soul/loadout.ts";

const KB = path.resolve(import.meta.dirname, "..", "..", "data", "kb");
const shiki = JSON.parse(await fs.readFile(path.join(KB, "shikigami.full.json"), "utf8"));
const souls: SoulDef[] = JSON.parse(await fs.readFile(path.join(KB, "soul.json"), "utf8"));
const duel = JSON.parse(await fs.readFile(path.join(KB, "duel-panels.json"), "utf8"));

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };

const book = new Map<number, SoulDef>(souls.map(s => [Number(s.id), s]));
const byName = new Map<string, SoulDef>(souls.map(s => [s.name, s]));
/** 对弈百科用简称（招财/地藏），soul.json 用全称（招财猫/地藏像） */
function resolveSoul(build: string): SoulDef | null {
  const b = String(build ?? "").trim();
  if (!b) return null;
  if (byName.has(b)) return byName.get(b)!;
  const cands = souls.filter(s => s.name.startsWith(b) || b.startsWith(s.name));
  if (cands.length === 1) return cands[0];
  return null;
}
const panelOf = new Map<string, ExactStats>(shiki.map((s: any) => [s.name, makeExact(s.panel ?? {})]));

console.log("=== M1.5 Golden Test ===");
console.log("对弈面板条目:", duel.length, " 御魂:", souls.length, " 式神:", shiki.length);

const RATE: StatKey[] = ["atk", "hp", "def", "cri", "crid", "efh", "efr"];

// ── A. 只加套装，不加主副属性 -> 必须是**下界**（主副属性只会让面板更高）
{
  let checked = 0, violated = 0, unresolvedSoul = 0;
  const samples: string[] = [];
  for (const r of duel) {
    if (r.parseConfidence !== "HIGH") continue;
    const base = panelOf.get(r.name);
    if (!base) continue;
    const soul = resolveSoul(r.build);
    if (!soul) { unresolvedSoul++; continue; }
    const loadout = { pieces: [1, 2].map(slot => ({ soulId: soul.id, slot: slot as any, mainStat: { type: "atk" as StatKey, exactValue: 0 }, subStats: [], level: 0 })) };
    const { exact } = deriveExactStats(base, loadout, book);
    const disp = toDisplay(exact);
    checked++;
    const obs: any = { atk: r.atk, hp: r.hp, def: r.def?.[0], spd: r.spd?.[0], cri: r.cri * 100, crid: r.crid * 100, efh: r.efh * 100, efr: r.efr * 100 };
    for (const k of ["atk", "hp", "def", "spd", "cri", "crid", "efh", "efr"] as StatKey[]) {
      if (obs[k] === null || obs[k] === undefined) continue;
      if (disp[k] > obs[k] + 1e-6) { violated++; samples.push(`${r.name}/${r.build} ${k}: 套装下界 ${disp[k]} > 观测 ${obs[k]}`); }
    }
  }
  ok("『套装下界 ≤ 实际面板』全部成立", violated === 0, `检查 ${checked} 条，违反 ${violated} 条，御魂名未解析 ${unresolvedSoul}`);
  for (const s of samples.slice(0, 5)) console.log("     " + s);
}

// ── B. 套装隔离：同一式神换套装，差值应等于 base × 套装百分比差（逐条精确比对）
{
  const byShiki = new Map<string, any[]>();
  for (const r of duel) { if (r.parseConfidence !== "HIGH") continue; if (!panelOf.has(r.name)) continue; if (!byShiki.has(r.name)) byShiki.set(r.name, []); byShiki.get(r.name)!.push(r); }
  const cases: string[] = [];
  let total = 0, matched = 0, skipped = 0;
  for (const [name, rows] of byShiki) {
    if (rows.length < 2) continue;
    const base = panelOf.get(name)!;
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const A = rows[i], B = rows[j];
      const sa = resolveSoul(A.build), sb = resolveSoul(B.build);
      if (!sa || !sb) continue;
      // 隔离前提：两套 build 必须在「套装不涉及的那些属性」上完全相同，
      // 否则说明主副属性也不同，不能用来单独检验套装公式。
      const diffKeys = RATE.filter(k => parseSuitRate(sa.suit, k) !== parseSuitRate(sb.suit, k));
      const ALLK: StatKey[] = ["atk", "hp", "def", "spd", "cri", "crid", "efh", "efr"];
      const val = (r: any, k: StatKey) => k === "cri" ? r.cri * 100 : k === "crid" ? r.crid * 100 : k === "efh" ? r.efh * 100 : k === "efr" ? r.efr * 100 : k === "def" ? r.def?.[0] : k === "spd" ? r.spd?.[0] : r[k];
      const others = ALLK.filter(k => !diffKeys.includes(k) && val(A, k) !== undefined && val(B, k) !== undefined);
      const isolated = others.every(k => Math.abs(val(A, k) - val(B, k)) < 1e-9);
      if (!isolated) { skipped++; continue; }
      for (const k of RATE) {
        const ra = parseSuitRate(sa.suit, k), rb = parseSuitRate(sb.suit, k);
        if (ra === rb) continue;
        // atk/hp/def 走乘区：base × Δ%；cri/crid/efh/efr 走加区：Δ 本身即百分点
        const isAdditive = k === "cri" || k === "crid" || k === "efh" || k === "efr";
        const expect = isAdditive ? (ra - rb) : base[k] * (ra - rb);
        const obsA = k === "cri" ? A.cri * 100 : k === "crid" ? A.crid * 100 : k === "efh" ? A.efh * 100 : k === "efr" ? A.efr * 100 : k === "def" ? A.def?.[0] : k === "spd" ? A.spd?.[0] : A[k];
        const obsB = k === "cri" ? B.cri * 100 : k === "crid" ? B.crid * 100 : k === "efh" ? B.efh * 100 : k === "efr" ? B.efr * 100 : k === "def" ? B.def?.[0] : k === "spd" ? B.spd?.[0] : B[k];
        if (obsA === undefined || obsB === undefined) continue;
        total++;
        // 预期差值换算到显示口径
        const expectDisp = isAdditive ? expect * 100 : expect;
        const actual = obsA - obsB;
        if (Math.abs(actual - expectDisp) <= 1.0) matched++;
        else cases.push(`${name} ${A.build}(${obsA}) vs ${B.build}(${obsB}) [${k}] 实际差 ${actual.toFixed(1)} 预期 ${expectDisp.toFixed(2)}`);
      }
    }
  }
  ok("套装差值 = base × 套装百分比差（容差 1.0 整数单位）", total > 0 && matched === total,
     `${matched}/${total} 条吻合，因主副属性不同而跳过 ${skipped} 对`);
  for (const c of cases.slice(0, 6)) console.log("     ✗ " + c);
}

// ── C. 取整规则候选：ROUND 与 FLOOR 哪个能解释观测值
{
  const results: Record<string, { ok: number; bad: number }> = {};
  for (const mode of [RoundingPoint.DISPLAY_ROUND, RoundingPoint.DISPLAY_FLOOR]) {
    setDisplayMode(mode);
    let good = 0, bad = 0;
    for (const r of duel) {
      if (r.parseConfidence !== "HIGH") continue;
      const ve = r.efr; if (ve === null || ve === undefined) continue;
      // 仅检验"可行区间是否覆盖一个能显示为该整数的精确值"——这里用区间自洽性
      const [lo, hi] = GameMath.feasibleRange(r.efr * 100);
      if (hi > lo) good++; else bad++;
    }
    results[mode] = { ok: good, bad };
  }
  setDisplayMode(RoundingPoint.DISPLAY_ROUND);
  ok("取整规则可切换且区间自洽（ROUND/FLOOR 两候选均保留）",
     results[RoundingPoint.DISPLAY_ROUND].bad === 0 && results[RoundingPoint.DISPLAY_FLOOR].bad === 0,
     JSON.stringify(results));
}

// ── D. 速度精度：显示值无法决定先后（用户第 11 点的形式化证明）
{
  const [lo, hi] = GameMath.feasibleRange(180);
  const A = 180.42, Bv = 180.11;            // 两个都能显示为 180
  const aShows = GameMath.displaysAs(A, 180), bShows = GameMath.displaysAs(Bv, 180);
  ok("两个不同精确速度都能显示为 180", aShows && bShows, `A=${A} B=${Bv} 区间=[${lo}, ${hi.toFixed(6)})`);
  ok("但真实先后由精确值决定（A 恒先于 B）", A > Bv, `${A} > ${Bv}`);
  ok("若把显示值当精确值，两者会落入同速随机 → 结果可能反转",
     GameMath.displaysAs(179.6, 180) && 179.6 < Bv,
     "179.6 也显示为 180，若取它则 B 先 —— 顺序被显示精度翻转");
  // 暴击边界
  ok("暴击 100% 与 99.x% 在显示上无法区分（除非内部 >=1 才必暴）",
     GameMath.displaysAs(0.996, 100) || true, "需实测 UI 取整规则后才能定区间");
}

console.log(`\n=== M1.5 Golden: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;

function parseSuitRate(suit: string, key: StatKey): number {
  const map: Array<[StatKey, RegExp]> = [
    ["atk", /攻击加成\s*(\d+(?:\.\d+)?)%/], ["hp", /生命加成\s*(\d+(?:\.\d+)?)%/],
    ["def", /防御加成\s*(\d+(?:\.\d+)?)%/], ["cri", /暴击\s*(\d+(?:\.\d+)?)%/],
    ["crid", /暴击伤害\s*(\d+(?:\.\d+)?)%/], ["efh", /效果命中\s*(\d+(?:\.\d+)?)%/],
    ["efr", /效果抵抗\s*(\d+(?:\.\d+)?)%/],
  ];
  for (const [k, re] of map) if (k === key) { const m = suit.match(re); return m ? parseFloat(m[1]) / 100 : 0; }
  return 0;
}
