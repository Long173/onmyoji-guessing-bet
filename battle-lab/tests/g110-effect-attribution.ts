// tests/g110-effect-attribution.ts — ★★★ 第 188 轮：**逐句效果归因的第二批**（damage / heal / shield / timeline）
//
// 由来：被动运行时是「触发一句、执行整门技能」（compile/passive-runtime.ts 的 sk.execute）。
//   第 180/181 轮把**状态引用**归到了句（statusRefClauses + onlyStatusSlots），但四个效果数组仍是**技能级**的 ——
//   于是「造成伤害时，获得1层[buff]」（闻人翊悬「火浣重重」）会把同一门技能里另外两句的
//   「每获得5层…增加20%行动条」「满层时…增加100%行动条」一起执行：每次造成伤害白送 120% 行动条。
// 本轮：产物 effectClauses（按族给逐句证据）+ 执行侧 onlyEffectSlots。
//   ★ 判据不是「按数字回找子句」（同一个 125% 可以在两个子句里各写一次，鬼切「鬼刃·罗城门」就是），
//     而是「正则匹配下标 → 小句区间」（compile/skill-compiler.ts 的 NH + clauseSpans）。
import fs from "node:fs";
import path from "node:path";
import { compileAll } from "../tools/compile-census.ts";
import { splitClauses, clauseSpans, effectSlotsForClause } from "../compile/skill-compiler.ts";
import { createKit, assembleMatch } from "../../apps/web/src/engine/assemble.ts";
import { canonicalMatch } from "../../apps/web/src/mock/canonical-match.ts";
import { captureState, stateHash } from "../kernel/state.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const { input } = compileAll(path.join(ROOT, "data", "kb"));
const irs = (input.skills as any[]).map((e: any) => ({ key: String(e.key), ir: JSON.parse(String(e.json)) }));
const irOf = (k: string) => irs.find((x) => x.key === k)!.ir;
const KB: any[] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "kb", "shikigami.full.json"), "utf8"));
const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "src", "engine", "bundle.json"), "utf8"));
const KINDS = ["damage", "heal", "shield", "timeline"] as const;

sec("[1] ★★★ 判据等价：splitClauses ≡ clauseSpans（切分只有一份，偏移版与文本版不许分叉）");
{
  let same = 0, diff = 0;
  for (const c of KB) for (const sk of (c.skills ?? [])) {
    const desc = String(sk.description ?? "").replace(/％/g, "%").replace(/／/g, "/").replace(/[\u3000\u00a0]/g, " ").replace(/<br\s*\/?>/gi, "\n");
    for (const s of desc.split(/[。\n]/)) {
      if (splitClauses(s).join("|") === clauseSpans(s).map((x: any) => x.text).join("|")) same++; else diff++;
    }
  }
  ok("★★★ 全库逐句相同（2675 条），0 条不同", diff === 0 && same === 2675, JSON.stringify({ same, diff }));
  const edge = ["  甲  ，乙", "；甲；", "", "甲", "   ", "甲，乙。丙\n丁！戊", "a,b;c"];
  ok("★★★ 边界（前后空白 / 空串 / 全空白 / 多分隔符混排）逐条相同",
    edge.every((s) => splitClauses(s).join("|") === clauseSpans(s).map((x: any) => x.text).join("|")),
    JSON.stringify(edge.map((s) => [s, splitClauses(s), clauseSpans(s).map((x: any) => x.text)])));
  ok("★★★ 偏移是**去空白后**的起点（切分给的是可用的下标，不是原串下标）",
    JSON.stringify(clauseSpans("  甲，乙")) === JSON.stringify([{ text: "甲", at: 2 }, { text: "乙", at: 4 }]),
    JSON.stringify(clauseSpans("  甲，乙")));
}

sec("[2] ★★★ 产物 effectClauses：只给被动、只写非空且全部定位到子句的族");
{
  const withField = irs.filter((x) => !!x.ir.effectClauses);
  const cnt: Record<string, number> = {};
  for (const x of withField) for (const k of Object.keys(x.ir.effectClauses)) cnt[k] = (cnt[k] ?? 0) + 1;
  console.log("  带 effectClauses 的技能 = " + withField.length + "｜按族 " + JSON.stringify(cnt));
  ok("★★★ 带 effectClauses 的技能 = 46，按族 damage 16 / heal 11 / shield 7 / timeline 14",
    withField.length === 46 && cnt.damage === 16 && cnt.heal === 11 && cnt.shield === 7 && cnt.timeline === 14,
    JSON.stringify({ n: withField.length, cnt }));
  ok("★★★ **只有被动**写这个键（主动技能整门施放，写了也没人读，只会把普查灌成噪声）",
    withField.every((x) => Number(x.ir.cost) < 0),
    JSON.stringify(withField.filter((x) => Number(x.ir.cost) >= 0).map((x) => x.key)));
  ok("★★★ 每个族的数组与 IR 里同名数组**等长**（一一对应是收窄的前提）",
    withField.every((x) => Object.keys(x.ir.effectClauses).every((k: string) => x.ir.effectClauses[k].length === (x.ir[k] ?? []).length)));
  ok("★★★ 每个元素都非空（有一个定位不到就整族不写 —— 半份证据比没有证据更坏）",
    withField.every((x) => Object.keys(x.ir.effectClauses).every((k: string) => (x.ir.effectClauses[k] as string[]).every((s: string) => typeof s === "string" && s.length > 0))));
  ok("★★ 反向：不是被动的技能里这个键**根本不出现**（默认 undefined，不是空对象）",
    irs.filter((x) => Number(x.ir.cost) >= 0).every((x) => x.ir.effectClauses === undefined));
}

sec("[3] ★★★ 纯函数双向：effectSlotsForClause（没有证据 ⇒ null；有证据 ⇒ 严格按证据）");
{
  const ir: any = { damage: [{ ratio: 100, type: "NORMAL", base: "atk" }, { ratio: 200, type: "NORMAL", base: "atk" }],
    effectClauses: { damage: ["造成攻击100%伤害", "造成攻击200%伤害"] } };
  ok("★★★ 触发句 = 第一句 ⇒ [0]（只做那一句的伤害）",
    JSON.stringify(effectSlotsForClause(ir, "受到攻击时，造成攻击100%伤害", "damage")) === "[0]",
    JSON.stringify(effectSlotsForClause(ir, "受到攻击时，造成攻击100%伤害", "damage")));
  ok("★★★ 触发句 = 第二句 ⇒ [1]", JSON.stringify(effectSlotsForClause(ir, "回合结束时，造成攻击200%伤害", "damage")) === "[1]");
  ok("★★★ 触发句与两句都不沾 ⇒ **空数组**（这一句不做这一族 —— 宁可少算，不许把隔壁那句也算上）",
    JSON.stringify(effectSlotsForClause(ir, "造成伤害时，获得1层[buff_1_1]", "damage")) === "[]");
  ok("★★★ 触发句是**整句**（把两个小句都包住）⇒ 两槽位都给",
    JSON.stringify(effectSlotsForClause(ir, "受到攻击时，造成攻击100%伤害并造成攻击200%伤害", "damage")) === "[0,1]");
  ok("★★★ 这一族**没有证据** ⇒ null（调用方照旧全放，逐位不变）",
    effectSlotsForClause({ damage: ir.damage }, "任何一句话", "damage") === null);
  ok("★★★ 证据长度与产物长度**对不上** ⇒ null（半份证据不猜）",
    effectSlotsForClause({ damage: ir.damage, effectClauses: { damage: ["造成攻击100%伤害"] } }, "受到攻击时，造成攻击100%伤害", "damage") === null);
  ok("★★★ 四族独立：伤害有证据、拉条没有 ⇒ 伤害收窄、拉条照旧全放",
    JSON.stringify(effectSlotsForClause(ir, "造成伤害时", "damage")) === "[]" && effectSlotsForClause(ir, "造成伤害时", "timeline") === null);
  ok("★★★ 归一化：证据与触发句里的 tips 占位符 / 空白被去掉后仍能对上（第 181 轮那条规矩复用同一份）",
    JSON.stringify(effectSlotsForClause({ damage: ir.damage, effectClauses: { damage: ["造成攻击100%[tips_5]", "造成攻击200%伤害"] } },
      "受到攻击时，造成攻击100%[间接伤害]", "damage")) === "[0]");
}

sec("[4] ★★★ 端到端（被动路径）：触发一句**只做那一句**的效果");
{
  const NAME = "闻人翊悬";
  const SK = "火浣重重";
  async function one(useEvidence: boolean) {
    const c = KB.find((x: any) => x.name === NAME)!;
    const m: any = canonicalMatch();
    m.red.units[0] = { ...m.red.units[0], shikigamiId: c.id, name: NAME };
    const a: any = assembleMatch(createKit(bundle), m, { seed: 188, passives: "PARSED_CANDIDATES_ONLY" });
    await a.battle.runStartup();
    const b = a.battle;
    const e = b.teams[0].members[0];
    const foe = b.enemiesOf(e.teamId)[0];
    const mine = (b.passiveReport?.installed ?? []).filter((x: any) => x.entityId === e.id && x.skill === SK);
    const sk = (e.skills ?? []).find((s: any) => s.name === SK)!;
    const clause = String(mine[0]?.clause ?? "");
    const only: any = {};
    for (const k of KINDS) { const s2 = effectSlotsForClause(sk.ir, clause, k); if (s2) only[k] = s2; }
    const start = b.timeline.get(e.id)?.pos ?? null;
    await sk.execute(b, e, foe, { input: { source: e, target: foe } },
      useEvidence && Object.keys(only).length ? { onlyEffectSlots: only } : undefined);
    const applied = (b.trace ?? []).filter((t: any) => t.t === "TIMELINE_SHIFT" && t.id === e.id && t.applied === true).length;
    const st = (e.statuses ?? []).find((s: any) => String(s.def?.id ?? "") === "5532_1");
    return { clause, only, start, end: b.timeline.get(e.id)?.pos ?? null, applied, stacks: st ? Number(st.stacks ?? 0) : 0, installed: mine.length };
  }
  const old1 = await one(false), neu = await one(true);
  console.log("  旧（不传证据）= " + JSON.stringify(old1));
  console.log("  新（按证据收窄）= " + JSON.stringify(neu));
  ok("★★★ 前置：这门被动被装上了，且触发句是「造成伤害时，获得1层…」",
    neu.installed === 1 && neu.clause.includes("造成伤害时"), JSON.stringify({ installed: neu.installed, clause: neu.clause }));
  ok("★★★ 证据：这一族（timeline）判定为**空**（那两条拉条写在另外两句里：每获得5层 / 满层时）",
    JSON.stringify(neu.only) === JSON.stringify({ timeline: [] }), JSON.stringify(neu.only));
  ok("★★★ 旧行为：一次「造成伤害」触发 **2 次**拉条、行动条 0 → 10000（20% + 100%，多算）",
    old1.applied === 2 && old1.end > old1.start, JSON.stringify(old1));
  ok("★★★ 新行为：**0 次**拉条、行动条原地不动（触发一句只做那一句的效果）",
    neu.applied === 0 && neu.end === neu.start, JSON.stringify(neu));
  ok("★★★ 而**状态那一段一个字都没少**（buff_5532_1 层数两次相同）—— 收窄只切掉隔壁子句，不切本句",
    neu.stacks === old1.stacks && neu.stacks > 0, JSON.stringify({ old: old1.stacks, neu: neu.stacks }));
}

sec("[5] ★★★ 收窄是真在生效：部分保留（真实技能 + 只点名一个槽位）");
{
  const c = KB.find((x: any) => x.name === "两面佛")!;
  const m: any = canonicalMatch();
  m.red.units[0] = { ...m.red.units[0], shikigamiId: c.id, name: "两面佛" };
  const a: any = assembleMatch(createKit(bundle), m, { seed: 188, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  const b = a.battle;
  const e = b.teams[0].members[0];
  const foe = b.enemiesOf(e.teamId)[0];
  const sk = (e.skills ?? []).find((s: any) => String(s.ir?.id ?? "") === "258_01")!;
  const n = (sk.ir.damage ?? []).length;
  const before = (b.trace ?? []).length;
  await sk.execute(b, e, foe);
  const allHits = (b.trace ?? []).slice(before).filter((t: any) => t.t === "DAMAGE").length;
  const mark = (b.trace ?? []).length;
  await sk.execute(b, e, foe, undefined, { onlyEffectSlots: { damage: [0] } });
  const oneHits = (b.trace ?? []).slice(mark).filter((t: any) => t.t === "DAMAGE").length;
  console.log("  258_01「风雷两生」伤害槽位 = " + n + "｜全放 = " + allHits + " 条 DAMAGE｜只点名 [0] = " + oneHits + " 条");
  ok("★★★ 前置：这门技能有 ≥2 个伤害槽位", n >= 2, String(n));
  ok("★★★ 不传 onlyEffectSlots ⇒ 每个槽位都打（槽位数 × 目标数）", allHits >= n, JSON.stringify({ n, allHits }));
  ok("★★★ 传 [0] ⇒ 只剩第一个槽位那一次（**部分保留**，不是一刀切关掉）", oneHits > 0 && oneHits < allHits,
    JSON.stringify({ n, allHits, oneHits }));
}

sec("[6] ★★★ 波及面（全库名册）：27 条装上的触发句里 16 条会因此改变行为");
{
  const rows: Array<{ name: string; key: string; skill: string; family: string; clause: string; changed: boolean; detail: string }> = [];
  for (const c of KB) for (const sk of (c.skills ?? [])) {
    if (Number(sk.cost ?? 0) >= 0) continue;
    let a: any;
    try { a = assembleMatch(createKit(bundle), (() => { const m: any = canonicalMatch(); m.red.units[0] = { ...m.red.units[0], shikigamiId: c.id, name: c.name }; return m; })(), { seed: 188, passives: "PARSED_CANDIDATES_ONLY" }); await a.battle.runStartup(); }
    catch { continue; }   // 阴阳师不在对弈竞猜里（kernel/validate.ts 的 GUESSING_NO_ONMYOJI）
    const e = a.battle.teams[0].members[0];
    const mine = (a.battle.passiveReport?.installed ?? []).filter((x: any) => x.entityId === e.id && x.skill === sk.name);
    if (!mine.length) continue;
    const skObj = (e.skills ?? []).find((s: any) => s.name === sk.name);
    const ir = skObj?.ir; if (!ir) continue;
    if (!KINDS.some((k) => (ir[k] ?? []).length)) continue;
    for (const u of mine) {
      let changed = false; const parts: string[] = [];
      for (const k of KINDS) {
        const n = (ir[k] ?? []).length; if (!n) continue;
        const slots = effectSlotsForClause(ir, String(u.clause ?? ""), k);
        const before = Array.from({ length: n }, (_: any, i: number) => i);
        const after = slots === null ? before : slots;
        if (JSON.stringify(after) !== JSON.stringify(before)) { changed = true; parts.push(k + " " + JSON.stringify(before) + " → " + JSON.stringify(after)); }
      }
      rows.push({ name: c.name, key: c.id + "/" + sk.id, skill: sk.name, family: String(u.family ?? ""), clause: String(u.clause ?? ""), changed, detail: parts.join(" ｜ ") });
    }
  }
  const changedRows = rows.filter((r) => r.changed);
  console.log("  装上且带效果槽位的触发句 = " + rows.length + "｜其中收窄会改变行为 = " + changedRows.length);
  for (const r of changedRows) console.log("    ★ " + r.name + "「" + r.skill + "」 " + r.family + " :: " + r.detail);
  ok("★★★ 装上的触发句 = 27、会变的 = 16（数字由运行产生；与报告 §160 的探针一致）",
    rows.length === 27 && changedRows.length === 16, JSON.stringify({ units: rows.length, changed: changedRows.length }));
  const names = [...new Set(changedRows.map((r) => r.name))].sort();
  const WANT = ["鸦天狗", "鬼女红叶", "食梦貘", "匣中少女", "彼岸花", "雪童子", "弈", "鬼灯", "夜刀神", "我妻善逸", "嘴平伊之助", "坂田银时", "闻人翊悬", "天照", "龙吟铃鹿御前"].sort();
  ok("★★★ 会变的正是这 15 只（逐一点名）", JSON.stringify(names) === JSON.stringify(WANT), JSON.stringify({ names, WANT }));
  ok("★★★ 而且方向**全部是去掉多算**（结果一律是 []：触发句不拥有那些槽位）",
    changedRows.every((r) => /→ \[\]/.test(r.detail)), JSON.stringify(changedRows.map((r) => r.detail)));
  ok("★★★ 没变的 11 条是因为**触发句本身就拥有那些槽位**（证据命中 = 全下标，不是碰巧没证据）",
    rows.filter((r) => !r.changed).length === 11 && rows.filter((r) => !r.changed).every((r) => {
      const ir = irOf(r.key);
      return KINDS.every((k) => {
        const n = (ir?.[k] ?? []).length; if (!n) return true;
        const uid = String(r.clause ?? "");
        const slots = effectSlotsForClause(ir, uid, k);
        return Array.isArray(slots) && slots.length === n;
      });
    }),
    JSON.stringify(rows.filter((r) => !r.changed).map((r) => r.name)));
}

sec("[7] ★★★ 概率不是伤害（本轮的第二个发现：dmgGeneric 的尾巴把 [tips_2] 当成了伤害标记）");
{
  const d292 = irOf("292/292_02");
  const sk292 = (d292.damageSkips ?? []);
  console.log("  292/292_02 damage=" + JSON.stringify(d292.damage) + " damageSkips=" + JSON.stringify(sk292));
  ok("★★★ 292「霜天之织」的 damage 里**没有** 25（此前 dmgGeneric 把「有25%[基础概率]附加[冰冻]」当成了伤害）",
    !(d292.damage ?? []).some((d: any) => d.ratio === 25), JSON.stringify(d292.damage));
  ok("★★★ 而那一条被**记账**（理由码 PROBABILITY_NOT_DAMAGE + 证据子句非空）",
    sk292.some((s: any) => s.reason === "PROBABILITY_NOT_DAMAGE" && s.ratio === 25 && String(s.evidence).includes("[tips_2]")),
    JSON.stringify(sk292));
  const prob = irs.filter((x) => (x.ir.damageSkips ?? []).some((s: any) => s.reason === "PROBABILITY_NOT_DAMAGE"));
  ok("★★★ 全库命中 2 个（292/292_02 与 304/304_01）—— 收得窄：只认紧跟数字的那个 tips 且规范名含「概率」",
    prob.map((x) => x.key).sort().join() === "292/292_02,304/304_01", JSON.stringify(prob.map((x) => x.key)));
  ok("★★★ 反向不许误伤：`[tips_5]`（间接伤害）/`[tips_18]`（真实伤害）后面的数字**必须保留**",
    (irOf("231/231_02").damage ?? []).some((d: any) => d.ratio === 42)
      && (irOf("317/317_02").damage ?? []).some((d: any) => d.ratio === 90)
      && (irOf("373/373_02").damage ?? []).some((d: any) => d.ratio === 77),
    JSON.stringify({ a: irOf("231/231_02").damage, b: irOf("317/317_02").damage, c: irOf("373/373_02").damage }));
  ok("★★★ 两种理由码并存、且第 183 轮那 4 条一条没少",
    irs.filter((x) => (x.ir.damageSkips ?? []).some((s: any) => s.reason === "DAMAGE_REFERENCE_NOT_DEALT")).map((x) => x.key).sort().join()
      === "247/247_02,253/253_03,306/306_02,580/580_02");
}

sec("[8] ★★ 反向：默认档（被动 OFF）一条都不装，两个指纹逐位不变");
{
  // ★★★ 第 190 轮：被动档常量 6d7fb675c3d14eaf → **7bc24506bdcd349e**。**这不是漂移，是修好了一个 bug**：
  //   `run()` 内部会调 `runStartup()`，而这里写的是 `runStartup(); run()` ⇒ 开局跑了两遍（先机触发两次）。
  //   第 190 轮给 runStartup 加了幂等闸门（kernel/battle.ts），于是这一行现在测的是**单次开局**。
  for (const [mode, want] of [["NOT_EXECUTED", "2d7c7507e18db61f"], ["PARSED_CANDIDATES_ONLY", "7bc24506bdcd349e"]] as const) {
    const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: mode });
    await a.battle.runStartup();
    await a.battle.run();
    const h = stateHash(captureState(a.battle));
    ok("★★★ " + mode + " 指纹 " + want + " 逐位不变", h === want, h);
  }
  const a: any = assembleMatch(createKit(bundle), canonicalMatch(), { seed: 20261001, passives: "NOT_EXECUTED" });
  await a.battle.runStartup();
  ok("★★ 默认档 installed 为空", (a.battle.passiveReport?.installed ?? []).length === 0);
}

console.log("\n=== 逐句效果归因（第二批）: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
