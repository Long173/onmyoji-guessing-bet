// tests/m15c-soul-effects.ts — M1.5C：御魂战斗效果接入事件系统
import fs from "node:fs/promises";
import path from "node:path";
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { makeGuessingEntity } from "../soul/guessing-factory.ts";
import { compileSoulBook } from "../soul/effects.ts";
import { installSoulEffects, interpretEffect } from "../soul/effect-system.ts";
import { compileSoulEffect } from "../soul/effects.ts";
import type { SoulDef } from "../soul/loadout.ts";

const KB = path.resolve(import.meta.dirname, "..", "..", "data", "kb");
const souls: SoulDef[] = JSON.parse(await fs.readFile(path.join(KB, "soul.json"), "utf8"));
const soulDefs = new Map<number, SoulDef>(souls.map(s => [Number(s.id), s]));
const byName = new Map(souls.map(s => [s.name, s]));
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, x = "") => { if (c) { pass++; console.log("  PASS " + n + (x ? "  " + x : "")); } else { fail++; console.log("  FAIL " + n + "  " + x); } };

console.log("=== M1.5C 御魂战斗效果 ===");

// ① 70 种御魂的战斗效果全部可编译
const book = compileSoulBook(souls);
ok("70 种御魂全部编译出效果 IR", book.size === souls.length, `${book.size}/${souls.length}`);
const withTrigger = [...book.values()].filter(ir => ir.trigger).length;
console.log(`     其中识别出触发时机 ${withTrigger}/${book.size}`);

// ② 无刀取的语义解释
const wd = byName.get("无刀取")!;
const interp = interpretEffect(compileSoulEffect(wd));
ok("无刀取被解释为 DAMAGE_RAMP（累加增伤+封顶）", interp.kind === "DAMAGE_RAMP",
   JSON.stringify(interp.params));
ok("参数正确：每回合 +15%，封顶 45%", Math.abs(interp.params.perTurn - 0.15) < 1e-9 && Math.abs(interp.params.cap - 0.45) < 1e-9);

// ③ 全局覆盖率：多少能解释、多少只能登记
const kinds: Record<string, number> = {};
for (const def of souls) { const k = interpretEffect(compileSoulEffect(def)).kind; kinds[k] = (kinds[k] ?? 0) + 1; }
console.log("     效果类型分布:", JSON.stringify(kinds));

// ④ 接入事件系统并实际触发
const R = ResourcePolicies.COMMUNITY_4_8_5_345;
const deps = { soulDefs, charMeta: new Map([[217, { name: "大天狗" }], [201, { name: "雪女" }]]) };
const A = makeGuessingEntity(1, 0, { shikigamiId: 217, observed: { atk: 3000, hp: 20000, def: 400, spd: 120, cri: 0, crid: 150, efh: 0, efr: 0 }, soulIds: [wd.id, wd.id, wd.id, wd.id] }, deps);
const Bb = makeGuessingEntity(2, 1, { shikigamiId: 201, observed: { atk: 2500, hp: 30000, def: 400, spd: 110, cri: 0, crid: 150, efh: 0, efr: 0 } }, deps);
const t0 = new Team(0, "RED", R, 1); t0.add(A.entity);
const t1 = new Team(1, "BLUE", R, 1); t1.add(Bb.entity);
const bt = new Battle([t0, t1], { seed: 7, rules: { ...DEFAULT_RULES, maxTurns: 30 },
  policies: { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
    death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER",
    tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED } });
const rep = installSoulEffects(bt, A.resolution.soulBattleEffects, soulDefs);
ok("4件套效果已装入引擎", rep.installed.length === 1, JSON.stringify(rep.installed.map(i => `${i.name}/${i.kind}/${i.code}`)));
await bt.run();
const fired = Object.values(rep.fireCount).reduce((a, b) => a + b, 0);
ok("效果在真实对局中被实际触发", fired > 0, `触发 ${fired} 次：${JSON.stringify(rep.fireCount)}`);
ok("触发后给持有者写入了增伤效果", A.entity.effects.some((e: any) => String(e.source).startsWith("soul" + wd.id)),
   `effects=${A.entity.effects.length}`);
// 封顶必须生效：无刀取 每回合 +15%、上限 45% -> 最多 3 层
ok("★ 增伤叠层封顶正确（45%/15% = 3 层，触发 16 次仍只有 3 层）",
   A.entity.effects.filter((e: any) => String(e.source).startsWith("soul" + wd.id)).length === 3,
   `触发 ${fired} 次，实际层数 ${A.entity.effects.filter((e: any) => String(e.source).startsWith("soul" + wd.id)).length}`);
ok("累计增伤 = 45% 而非无限增长",
   Math.abs(A.entity.effects.filter((e: any) => String(e.source).startsWith("soul" + wd.id)).reduce((a: number, e: any) => a + e.value, 0) - 0.45) < 1e-9,
   `合计 ${(A.entity.effects.filter((e: any) => String(e.source).startsWith("soul" + wd.id)).reduce((a: number, e: any) => a + e.value, 0) * 100).toFixed(0)}%`);

// ⑤ 不变量仍然成立：全程没有动面板
ok("★ 装入战斗效果后，面板仍等于截图值", Math.abs(A.entity.prop("crid") * 100 - 150) < 1e-9, `crid=${A.entity.prop("crid") * 100}`);

console.log(`\n=== M1.5C: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exitCode = 1;
