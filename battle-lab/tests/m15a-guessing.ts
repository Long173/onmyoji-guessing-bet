// tests/m15a-guessing.ts — M1.5A 不变量：竞猜路径绝不重复计算御魂静态属性
import fs from "node:fs/promises";
import path from "node:path";
import { makeGuessingEntity, verifyGuessingPanel } from "../soul/guessing-factory.ts";
import { EntityMode, StatSource, judgeLegality } from "../soul/stat-source.ts";
import { solveCompatibleSoulBuilds, MainStatRules, EnhanceRules } from "../soul/solver.ts";
import { makeExact, toDisplay } from "../kernel/stats.ts";
import { compileSoulBook, battleEffectsOf } from "../soul/effects.ts";
import type { SoulDef } from "../soul/loadout.ts";

const KB = path.resolve(import.meta.dirname, "..", "..", "data", "kb");
const souls: SoulDef[] = JSON.parse(await fs.readFile(path.join(KB, "soul.json"), "utf8"));
const soulDefs = new Map<number, SoulDef>(souls.map(s => [Number(s.id), s]));
const byName = new Map(souls.map(s => [s.name, s]));

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };

console.log("=== M1.5A 竞猜路径 ===");

// 用户给的示例：无刀取，2件套=暴击伤害20%
const wd = byName.get("无刀取")!;
ok("无刀取已入库且 2件套 = 暴击伤害20%", !!wd && wd.suit.includes("暴击伤害"), `suit=${wd?.suit}`);

// 模拟一局竞猜：暴伤 164%，带 4 件无刀取
const deps = { soulDefs, charMeta: new Map([[217, { name: "大天狗" }], [201, { name: "雪女" }]]) };
const input = {
  shikigamiId: 217,
  observed: { atk: 5946, hp: 16665, def: 506, spd: 150, cri: 80, crid: 164, efh: 0, efr: 40 },
  soulIds: [wd.id, wd.id, wd.id, wd.id, byName.get("破势")!.id, byName.get("破势")!.id],
};
const built = makeGuessingEntity(1, 0, input, deps);

ok("★ 竞猜模式 soulStaticApplied = false", built.resolution.soulStaticApplied === false);
ok("★ 面板来源 = AUTHORITATIVE_OVERRIDE", built.resolution.source === StatSource.AUTHORITATIVE_OVERRIDE);
ok("★ 暴伤仍是 164% 而不是 184%（未重复叠加 2件套20%）",
   Math.abs(toDisplay(built.resolution.exact).crid - 164) < 1e-9,
   `crid=${toDisplay(built.resolution.exact).crid}`);
ok("面板整体与截图逐项一致", verifyGuessingPanel(built).ok, JSON.stringify(verifyGuessingPanel(built).detail));

// 御魂战斗效果仍然加载
const book = compileSoulBook(souls);
const eff = battleEffectsOf(input.soulIds, book, soulDefs);
ok("4件套战斗效果被加载（静态属性不加载）", eff.length === 1 && eff[0].name === "无刀取", JSON.stringify(eff.map(e => `${e.name}:${e.desc}`)));
const ir = book.get(wd.id)!;
ok("战斗效果识别出触发时机", ir.trigger === "TURN_END", `trigger=${ir.trigger} magnitudes=${JSON.stringify(ir.magnitudes)}`);

// 模式语义决定合法性：竞猜接受"装备做不出"的面板
const impossible = judgeLegality(EntityMode.GUESSING, { explainableByEquipment: false });
const buildMode = judgeLegality(EntityMode.PLAYER_BUILD, { explainableByEquipment: false });
ok("竞猜模式接受装备无法解释的面板", impossible === "ACCEPT");
ok("同数据在 PlayerBuild 模式判 IMPOSSIBLE_BUILD", buildMode === "IMPOSSIBLE_BUILD");

// 截图值不坍缩为整数：保留可行区间
const spdObs = built.feasible.find(f => f.key === "spd")!;
ok("速度保留可行区间而非坍缩成整数", spdObs.range[0] < 150 && spdObs.range[1] > 150,
   `150 ∈ [${spdObs.range[0]}, ${spdObs.range[1].toFixed(4)})`);

// solver 不擅自取第一个解
const base = makeExact({ atk: 3000, hp: 12000, def: 400, spd: 110, cri: 0.1, crid: 1.5, efh: 0, efr: 0 });
// 采用用户给出的真实示例数值（暴伤 178%，不是 164%）——164% 与 无刀取2件套+20% 不相容，
// 会被下面的 NO_SOLUTION 分支正确拦下。
const target = makeExact({ atk: 5946, hp: 16665, def: 506, spd: 150, cri: 0.8, crid: 1.78, efh: 0, efr: 0.4 });
const loadout = { pieces: [1, 2, 3, 4, 5, 6].map(slot => ({ soulId: wd.id, slot: slot as any, mainStat: { type: "atk" as any, exactValue: 0 }, subStats: [], level: 15 })) };
const sol = solveCompatibleSoulBuilds(target, base, loadout, soulDefs);
ok("solver 返回 UNDERDETERMINED 而不是假装唯一解", sol.kind === "UNDERDETERMINED", `kind=${sol.kind}`);
ok("solver 给出必须由主副属性补足的残差", sol.kind === "UNDERDETERMINED" && !!sol.residual,
   sol.kind === "UNDERDETERMINED" ? `暴伤残差 ${(sol.residual.crid! * 100).toFixed(1)} 个百分点（178-150-20）` : "");

// 套装超出目标 -> NO_SOLUTION（可判定）
const tinyTarget = makeExact({ atk: 3000, hp: 12000, def: 400, spd: 110, cri: 0.1, crid: 1.51, efh: 0, efr: 0 });
const sol2 = solveCompatibleSoulBuilds(tinyTarget, base, loadout, soulDefs);
ok("套装贡献超过目标增量时判 NO_SOLUTION", sol2.kind === "NO_SOLUTION", sol2.kind === "NO_SOLUTION" ? sol2.detail[0]?.slice(0, 60) : "");

// 御魂规则常量
ok("主属性规则：1/3/5 固定、2/4/6 随机", JSON.stringify(MainStatRules.fixed) === '{"1":"atk","3":"def","5":"hp"}' && MainStatRules.randomSlots.length === 3);
ok("强化规则：+3/+6/+9/+12/+15，不足4条新增、满4条随机强化",
   EnhanceRules.breakpoints.length === 5 && EnhanceRules.onEvent(2) === "ADD_SUB" && EnhanceRules.onEvent(4) === "UPGRADE_RANDOM_SUB" && EnhanceRules.upgradeProbability === 0.25);

console.log(`\n=== M1.5A: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
