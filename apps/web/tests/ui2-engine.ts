// tests/ui2-engine.ts — UI-2 验收：真引擎接入 Worker 层
// 核心命题：**浏览器侧装配与 Node 侧装配同构** —— 同一 seed 必须给出同一胜者/回合数。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createEngineAdapter } from "../src/adapters/engine-adapter.ts";
import { canonicalMatch } from "../src/mock/canonical-match.ts";
import { assembleGuessingMatch } from "../../../battle-lab/soul/guessing-match.ts";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (extra ? "  — " + extra : "")); } };
const sec = (s: string) => console.log("\n" + s);

const bundle = JSON.parse(readFileSync(join(here, "..", "src", "engine", "bundle.json"), "utf8"));
const fixture = JSON.parse(readFileSync(join(here, "..", "..", "..", "battle-lab", "fixtures", "guessing-match-canonical-001.json"), "utf8"));
const adapter = createEngineAdapter(bundle);
const match = canonicalMatch();

sec("[1] 数据包完整性");
ok("bundle 版本与引擎对齐", bundle.engineVersion === "battle-lab 0.1-experimental" && bundle.gameDataVersion === "2026-10-01");
ok("282 只式神（含 6 阴阳师，由规则层拦截）", bundle.shiki.length === 282);
ok("818 条技能 / 272 条 AI / 338 条 buff / 70 条御魂",
   bundle.shiki.reduce((a: number, s: any) => a + s.skills.length, 0) === 818 && bundle.ai.length === 272 && bundle.buffs.length === 338 && bundle.souls.length === 70);
ok("不含任何 wiki 正文（体积 621KB < 原始 1280KB）", JSON.stringify(bundle).length < 1_300_000);

sec("[2] 校验（VALIDATE）走真引擎");
const v = await adapter.validate(match);
ok("典型对局校验通过（0 阻断）", v.ok, v.blockers.join("; "));
ok("覆盖度：单位 10/10", v.coverage.unitsJoined === 10 && v.coverage.unitsTotal === 10);
ok("覆盖度：技能 10/10 可用", v.coverage.skillsAvailable === 10);
ok("覆盖度：AI 高置信度按**编译后**置信度统计（10/10）", v.coverage.aiHigh === 10, `aiHigh=${v.coverage.aiHigh}/${v.coverage.aiTotal}`);
const gapWarn = v.warnings.filter(w => /未解析出任何可执行数值/.test(w.message));
ok("★ 真缺口（主动技能什么都没解析出）单独 WARN，且典型对局里应当为 0", gapWarn.length === 0, JSON.stringify(gapWarn.map(w => w.message)));
ok("被动技能归为 INFO（数据事实，不是缺口）", v.warnings.some(w => w.severity === "INFO" && /passive skill\(s\) not modelled/.test(w.message)), JSON.stringify(v.warnings.map(w => [w.severity, w.message.slice(0, 30)])));
ok("策略快照：UNKNOWN 计数 > 0 且被标为不可下结论", v.strategySnapshot.unknownCount > 0 && v.warnings.some(w => w.kind === "UNKNOWN_STRATEGY"));
ok("未识别御魂被显式告知（不是静默忽略）", v.warnings.some(w => w.kind === "SOUL_EFFECT_UNSUPPORTED") || v.coverage.soulsResolved === 0);
ok("显示层同速被识别（116=116）", v.warnings.some(w => w.kind === "MODEL_SENSITIVE" && /116/.test(w.message)), JSON.stringify(v.warnings.map(w => w.message)));

const bad = canonicalMatch();
bad.blue.units[2].shikigamiId = 0; bad.blue.units[2].name = "";
const vb = await adapter.validate(bad);
ok("缺 1 只 → 阻断且指明位置", !vb.ok && vb.blockers.some(b => /Blue slot 3/.test(b)), vb.blockers.join("; "));

const omy = canonicalMatch();
omy.red.units[0].shikigamiId = 10; omy.red.units[0].name = "晴明";
const vo = await adapter.validate(omy);
ok("阴阳师 → 被 GUESSING_NO_ONMYOJI 拦下", !vo.ok && vo.blockers.some(b => /Onmyoji/.test(b)), vo.blockers.join("; "));

sec("[3] ★ 同构校验：浏览器路径 vs Node 路径（同 seed 同结果）");
const SEEDS = [20261001, 20261002, 20261003, 11111, 99999, 424242, 7, 100000, 555001, 31415926];
let same = 0; const diffs: string[] = [];
for (const seed of SEEDS) {
  const nodeA = await assembleGuessingMatch(fixture, { seed, maxTurns: 300 });
  const nodeR = await nodeA.battle.run();
  const { assembleMatch } = await import("../src/engine/assemble.ts");
  const { createKit } = await import("../src/engine/assemble.ts");
  const kit = createKit(bundle);
  const webA = assembleMatch(kit, match, { seed, maxTurns: 300 });
  const webR = await webA.battle.run();
  const a = `${nodeR.winner}/${nodeR.reason}/${nodeR.turns}`;
  const b = `${webR.winner}/${webR.reason}/${webR.turns}`;
  if (a === b) same++; else diffs.push(`seed ${seed}: Node=${a} Web=${b}`);
}
ok(`${SEEDS.length} 个 seed 全部逐局一致（胜者/结束原因/回合数）`, same === SEEDS.length, diffs.join(" | "));

sec("[4] 面板语义：竞猜绝不叠加御魂静态属性");
const withSoul = canonicalMatch();
withSoul.red.units[0].soulId = 0;   // 雪幽魂（防御加成30%）
const { assembleMatch: am, createKit: ck } = await import("../src/engine/assemble.ts");
const kit2 = ck(bundle);
const a1 = am(kit2, canonicalMatch(), { seed: 1 });
const a2 = am(kit2, withSoul, { seed: 1 });
const key = (a: any) => a.red.map((b: any) => b.resolution.exact.def).join(",");
ok("★ 换御魂不改面板（def 逐项相同）", key(a1) === key(a2), `${key(a1)} vs ${key(a2)}`);
ok("★ 但战斗效果被加载（4 件套生效）", a2.red[0].resolution.soulBattleEffects.length === 1, JSON.stringify(a2.red[0].resolution.soulBattleEffects.map((x: any) => x.name)));
ok("★ soulStaticApplied 恒为 false", a2.red.every((b: any) => b.resolution.soulStaticApplied === false));
ok("御魂静态属性未变 = 竞猜口径正确（3 尾狐 def 792 原样）", a2.red[0].resolution.exact.def === 792, String(a2.red[0].resolution.exact.def));

sec("[5] 模拟吞吐与非阻塞（SIMULATE + 进度 + 取消）");
let progressCalls = 0; let lastCompleted = 0;
const t0 = Date.now();
const res = await adapter.simulate(match, { simulations: 200, seed: 20261001, progressEvery: 50 }, (p) => { progressCalls++; lastCompleted = p.completed; }, () => false);
const ms = Date.now() - t0;
ok("200 局跑完，无异常", res.errors === 0 && res.simulations === 200, `errors=${res.errors}`);
ok("进度回调至少触发 2 次且 completed 递增", progressCalls >= 2 && lastCompleted === 200, `calls=${progressCalls}`);
ok("红+蓝+平+超时 = 总局数（分母不撒谎）", res.redWins + res.blueWins + res.draws + res.timeouts === 200, JSON.stringify({ r: res.redWins, b: res.blueWins, d: res.draws, t: res.timeouts }));
ok("decisive = 红+蓝（超时永不进入分母）", res.decisive === res.redWins + res.blueWins);
ok("Wilson 区间包含点估计", !!res.confidenceInterval && res.confidenceInterval.low <= res.redWinRate! && res.redWinRate! <= res.confidenceInterval.high);
ok(`吞吐 ≥ 20 局/秒（实测 ${(200 / (ms / 1000)).toFixed(1)} 局/秒，${ms}ms）`, 200 / (ms / 1000) >= 20, `${ms}ms`);
ok("逐单位贡献非空且与输入一一对应", res.battleStats.perUnit.length === 10 && res.battleStats.perUnit.every(p => p.avgActions >= 0));
ok("逐单位伤害有真实来源（至少 3 只有输出）", res.battleStats.perUnit.filter(p => p.avgDamageDealt > 0).length >= 3, JSON.stringify(res.battleStats.perUnit.map(p => p.avgDamageDealt)));
ok("代表 seed 已产出（供 UI-4 回放）", (res.seeds?.length ?? 0) >= 1, JSON.stringify(res.seeds));
ok("引擎未暴露的指标被显式声明而非编造", res.coverage.unsupportedCapabilities.some(x => /Onibi-spent/.test(x)));

let cancelled = false;
try {
  await adapter.simulate(match, { simulations: 100000, seed: 1, progressEvery: 10 }, () => {}, () => (cancelled = true));
  ok("取消生效", false, "未抛出");
} catch (e: any) { ok("取消生效（抛出 CANCELLED）", /CANCELLED/.test(String(e?.message))); }

sec("[6] 回放（REPLAY）");
const rp = await adapter.replay(match, 20261001);
ok("事件流非空", rp.events.length > 10, `events=${rp.events.length}`);
ok("事件带回合戳（可步进）", rp.events.every((e, i) => typeof e.turn === "number") && rp.events[rp.events.length - 1].turn > 0);
ok("含伤害事件与死亡事件", rp.events.some(e => e.code === "DAMAGE") && rp.events.some(e => ["DEATH", "LETHAL"].includes(e.code)));
ok("单位表 10 条含 maxHp", rp.units.length === 10 && rp.units.every(u => u.maxHp > 0));
ok("事件文案已渲染为文字（非裸 code）", rp.events.some(e => /damage/.test(e.text)));
ok("回放同 seed 与模拟同结果", rp.turns > 0 && ["red", "blue", "draw", "timeout"].includes(rp.winner));

console.log(`\n══════════════════════════════════`);
sec("[7] ★★ 御魂覆盖度的两个轴必须分开（第 37 轮修）");
{
  // 「定义解析成功」与「战斗效果已实现」是两件事。
  // 原先 soulsResolved 数的是「填了 id」，界面却把它显示成「御魂定义 / 御魂已解析」——
  // 于是 id 根本不在知识库里的御魂也会让这一行显示满分。
  const withSoul = (ids: (number | null)[]) => {
    const m: any = canonicalMatch();
    let k = 0;
    for (const side of ["red", "blue"] as const) for (const u of m[side].units) u.soulId = ids[k++] ?? null;
    return m;
  };
  const all = (id: number | null) => withSoul(Array(10).fill(id));

  const vNone = await adapter.validate(all(null));
  ok("★ 一个御魂都没录 → soulsResolved 0/10（而不是「10/10 已解析」）",
    vNone.coverage.soulsResolved === 0 && vNone.coverage.soulsTotal === 10,
    JSON.stringify([vNone.coverage.soulsResolved, vNone.coverage.soulsTotal]));

  const vZero = await adapter.validate(all(0));
  ok("★★ 雪幽魂 id=0：0 是合法 id，必须算作已解析（回归锁：按真假值过滤会漏掉它）",
    vZero.coverage.soulsResolved === 10, JSON.stringify([vZero.coverage.soulsResolved, vZero.coverage.soulsTotal]));

  const vGhost = await adapter.validate(all(9999));
  ok("★★ 不在知识库里的 id 不得算作已解析", vGhost.coverage.soulsResolved === 0, String(vGhost.coverage.soulsResolved));
  ok("★★ 而且要显式说出来，不许静默当满分",
    vGhost.coverage.unsupportedCapabilities.some((x: string) => /not in the knowledge base/.test(x)),
    JSON.stringify(vGhost.coverage.unsupportedCapabilities));

  // 第二个轴：定义解析成功 ≠ 战斗效果已实现。
  // ★ 支持度在 src/kb/soul-index.json（bundle.json 的 souls[] 里**没有**这个字段 —— 别去那儿找）。
  const soulIdx = JSON.parse(readFileSync(join(here, "..", "src", "kb", "soul-index.json"), "utf8"));
  const idsWith = (lv: string) => soulIdx.filter((s: any) => s.engine.support === lv).map((s: any) => s.i);
  const unsupportedIds = idsWith("UNSUPPORTED");
  const fullIds = idsWith("FULL");
  ok("★ 测试前提：知识库里 UNSUPPORTED 与 FULL 两种御魂都存在（否则下面两条断言会平凡通过）",
    unsupportedIds.length > 0 && fullIds.length > 0,
    "UNSUPPORTED=" + unsupportedIds.length + " FULL=" + fullIds.length);
  const vBad = await adapter.validate(all(unsupportedIds[0]));
  ok("★★ 定义解析成功 ≠ 效果已实现：UNSUPPORTED 御魂仍算已解析，但效果轴如实报 0 完整",
    vBad.coverage.soulsResolved === 10 && vBad.coverage.soulEffectsFull === 0,
    JSON.stringify([vBad.coverage.soulsResolved, vBad.coverage.soulEffectsFull, vBad.coverage.soulEffectsPartial]));
  ok("★ 缺口文字点名「战斗效果未实现」",
    vBad.coverage.unsupportedCapabilities.some((x: string) => /no implemented battle effect/.test(x)),
    JSON.stringify(vBad.coverage.unsupportedCapabilities));
  // 正向对照：缺了它，「效果轴报 0」也可以是"永远报 0"这种假通过。
  const vFull = await adapter.validate(all(fullIds[0]));
  ok("★★ 正向对照：FULL 御魂 → 效果轴计到 10 完整、已解析 10/10",
    vFull.coverage.soulEffectsFull === 10 && vFull.coverage.soulsResolved === 10,
    JSON.stringify([vFull.coverage.soulEffectsFull, vFull.coverage.soulsResolved, vFull.coverage.soulEffectsPartial]));

  // ★★ 第 41 轮：御魂的「可执行效果数」必须**逐局**报出来。
  //   tests/g31 实测 70 件里只有 3 件改变对局，而 32 件标 PARTIAL 的全部只注册空 handler ——
  //   「已加载 N 件御魂」很容易被读成「N 件在起作用」，这个数字以前没有任何界面读它。
  // 雪幽魂 已在 battle-lab/soul/custom-effects.ts 实现，改用仍然只注册空 handler 的 魍魉之匣。
  const snow = soulIdx.find((s: any) => s.n === "魍魉之匣");
  const huo = soulIdx.find((s: any) => s.n === "火灵");
  const vNoSoul = await adapter.validate(all(null));
  ok("★ 一个御魂都没录时不产生御魂效果警告（没有可报的东西）",
    !vNoSoul.warnings.some((w: any) => w.kind === "SOUL_EFFECT_UNSUPPORTED"),
    JSON.stringify(vNoSoul.warnings.map((w: any) => w.message)));
  const vSnow = await adapter.validate(all(snow.i));
  const sw: any = vSnow.warnings.find((w: any) => w.kind === "SOUL_EFFECT_UNSUPPORTED");
  ok("★★ 全是只登记不生效的御魂时，必须 WARN 出来（不能安静地显示「已加载」）",
    !!sw && sw.severity === "WARN" && /none is executable/.test(sw.message), JSON.stringify(sw));
  ok("★ 警告里写明了原因（空 handler）与实测出处（g31）",
    !!sw && /empty handler/.test(sw.detail) && /g31/.test(sw.detail), sw ? sw.detail : "无警告");
  const vHuo = await adapter.validate(all(huo.i));
  ok("★★ 正向对照：全是有可执行效果的御魂时，这条警告不出现（否则它会变成永远在叫的噪声）",
    !vHuo.warnings.some((w: any) => w.kind === "SOUL_EFFECT_UNSUPPORTED"),
    JSON.stringify(vHuo.warnings.map((w: any) => w.message)));
  // mock 适配器（离线 UI 开发用）同样不能把 id=0 当成没填
  const { mockAdapter } = await import("../src/adapters/mock-adapter.ts");
  const mv: any = await mockAdapter.validate(all(0));
  ok("★★ mock 适配器也不能把 id=0 当成没填", mv.coverage.soulsResolved === 10, String(mv.coverage.soulsResolved));

  // 界面层：这一行曾经硬编码 ok: true —— 永远显示 ✓，算出来的 warn 没人看（死代码）
  const HC = readFileSync(join(here, "..", "src", "components", "simulation", "HealthCheck.vue"), "utf8");
  ok("★★ HealthCheck 的「御魂定义」行不再硬编码 ok: true",
    !/Soul definitions[^\n]*ok: true/.test(HC), (HC.match(/Soul definitions[^\n]*/) ?? [""])[0].trim().slice(0, 90));
  ok("★ 该行的 warn 是 ok 的补集（只会是 ✓ 或 ⚠，不会是红 —— 缺输入不是错误）",
    /Soul definitions[^\n]*warn: !\(/.test(HC), (HC.match(/Soul definitions[^\n]*/) ?? [""])[0].trim().slice(0, 90));
}

console.log(`UI-2 验收：${pass} 通过 / ${fail} 失败`);
console.log(`══════════════════════════════════`);
if (fail > 0) process.exit(1);
