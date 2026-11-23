// tools/compile-census.ts — ★★ 编译产物的全量快照与逐条 diff（第 47 轮）
//
// 由来（报告 §38）：我试着修心火的多段解析，改完一看 —— 338 条 buff 里 **146 条**的解析变了，
// 还翻了两条的符号（蝎毒 atk:-1→+1、墨灵 efr:-0.08→+0.08）。
//
// 真正可怕的地方是：**那个改动在项目现有的所有信号下都是"绿"的**。
//   · 没有任何测试逐条断言 818 条技能 / 338 条 buff 的编译结果；
//   · 典型对局的指纹也不会动（这些 buff 在典型对局里根本不出现）；
//   · fixtures/skill-ir.json 虽然是一份全量快照，但它**只写不读** —— 从来没有人比对过。
// 只有"改动前后对全量输出做逐条 diff"能发现它。这个工具把那条做法机械化：
//
//   ① 把全部编译产物（技能 IR + buff）快照成基线 fixtures/compile-baseline.json；
//   ② 每次运行重新编译，与基线逐条 diff；
//   ③ 任何变化都必须在 tools/compile-explain.json 里写明理由，否则检查失败。
//   ④ 比的是**编译结果**，不是随产物一起带出去的说明文字（第 56 轮补）：
//      unmodeledMechanics[].missing / .evidence 是从 UNMODELED 表原样抄下来的散文，
//      改它的措辞不该报变化；verb 与 clause 保留 —— 那两条是"有没有缺口""判给哪句话"，是行为。
//      细节与双向验证见 comparable() 的注释与 tests/g34 的第 [5] 节。
//
// 判据不是"测试绿不绿"，而是"**变化的每一条我能不能解释**"（§38.4）。
//
// 运行：cd battle-lab && node tools/compile-census.ts [--update]
import fs from "node:fs";
import path from "node:path";
import { compileSkill } from "../compile/skill-compiler.ts";
import { loadTips, setTipsTable } from "../compile/tips.ts";
// ★★★ 第 186 轮：名字形态的状态引用要用「名字 → id」表（与 tips 表同样是入口显式设置）
import { loadBuffNames, setBuffNames } from "../compile/buff-names.ts";
import { compileBuff } from "../compile/buff-compiler.ts";

export interface CensusEntry { key: string; json: string }
export interface CensusInput { skills: CensusEntry[]; buffs: CensusEntry[] }
export interface CensusBaseline { skills: Record<string, string>; buffs: Record<string, string> }
export interface Change { ns: "skills" | "buffs"; key: string; was: string; now: string }

/**
 * ★ 纯函数核心：给定基线、当前编译结果与解释表，算出变化。
 *   抽成纯函数是为了能造 fixture 精确压每一条规则（同 tools/field-census.ts 的做法）。
 */
/**
 * ★★★ 只比「编译结果」，不比「随编译结果一起带出去的说明文字」。
 *
 * `unmodeledMechanics[].missing / .evidence` 是从 compile/unmodeled.ts 的 UNMODELED 表
 * **原样抄下来**的散文：同一个动词在任何技能上都一模一样，改它的措辞不改变任何一条技能的解析。
 * 保留 `verb`（这条技能到底有没有被判成依赖未建模机制）与 `clause`（判给了哪一句）——
 * 那两条是行为：一个是"算不算有缺口"，一个是"归因到哪句话"。
 *
 * 第 56 轮实测：给「复活」条的 missing 补了一句「连标记也从来没被置为 true」，
 * 11 条技能的产物当场"变了"，而解析结果一个字节没动 —— 这就是"文档文本冒充编译结果"。
 *
 * ★ 防放水：解析不出 JSON 的输入一律**退回字符串原样比较**（更严，不是更松）；
 *   g34 的合成 fixture（"A" / "A2"）走的正是这条退路。
 */
export const DOC_FIELDS = ["missing", "evidence"] as const;

export function comparable(json: string): string {
  let v: any;
  try { v = JSON.parse(json); } catch { return json; }
  const walk = (o: any): any => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === "object") {
      const out: Record<string, any> = {};
      for (const k of Object.keys(o).sort()) {                      // 键序不是行为，统一排序
        // ★★ 第 67 轮：**值为 null 的键等于不存在**，两边都归一化掉。
        //   起因：给 SkillIR 加了一个新字段 revive（默认 null），818 条技能的 JSON 全变了 ——
        //   而它们的行为一个字节都没动。这与第 41.7 节「说明文字混进编译结果」是同一类：
        //   差分的噪声掩盖了真正要看的那几条（真正变的是 3 个主动复活技能）。
        //   ★ 这么做不会掩盖"变成 null"：值→null 在另一侧仍是键消失，照样报变化。
        const v = walk(o[k]);
        if (v !== null && v !== undefined) out[k] = v;
      }
      return out;
    }
    return o;
  };
  const stripDocs = (ir: any) => {
    if (!ir || !Array.isArray(ir.unmodeledMechanics)) return ir;
    return { ...ir, unmodeledMechanics: ir.unmodeledMechanics.map((u: any) => {
      const c: Record<string, any> = { ...u };
      for (const f of DOC_FIELDS) delete c[f];
      return c;
    }) };
  };
  return JSON.stringify(walk(stripDocs(v)));
}

export function diffCensus(base: CensusBaseline, cur: CensusInput, explain: Record<string, string>) {
  const changed: Change[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const ns of ["skills", "buffs"] as const) {
    const b = base[ns] ?? {};
    const seen = new Set<string>();
    for (const e of cur[ns]) {
      seen.add(e.key);
      const was = b[e.key];
      if (was === undefined) { added.push(ns + ":" + e.key); continue; }
      if (comparable(was) !== comparable(e.json)) changed.push({ ns, key: e.key, was, now: e.json });
    }
    for (const k of Object.keys(b)) if (!seen.has(k)) removed.push(ns + ":" + k);
  }
  const explained = changed.filter(c => !!explain[c.ns + ":" + c.key]);
  const unexplained = changed.filter(c => !explain[c.ns + ":" + c.key]);
  return { changed, added, removed, explained, unexplained };
}

/** 找出两段 JSON 第一处差异的上下文 —— 报告里要能一眼看出"变了什么"，而不是只给两个大字符串 */
export function firstDifference(a: string, b: string, span = 48): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 18);
  return "…" + a.slice(from, i + span) + " ⟶ " + b.slice(from, i + span) + "…";
}

/** 从原始 KB 重新编译出全部产物（技能按 charId/id 去重键） */
export function compileAll(kbDir: string): { input: CensusInput; dupSkillKeys: string[] } {
  const shiki = JSON.parse(fs.readFileSync(path.join(kbDir, "shikigami.full.json"), "utf8"));
  const buffs = JSON.parse(fs.readFileSync(path.join(kbDir, "buffs.json"), "utf8"));
  /**
   * ★★ 第 101 轮：形态类放置单位的解析要读 tips 表。**普查入口必须显式设置它** ——
   *   否则普查里 compileSkill 解析不出 forms，而生产（装配路径）解析得出来：
   *   同一次改动在两条路上产物不同，正是第 87 轮那条"两条装配路径必须装同一套运行时"的教训。
   */
  {
    const tipsRaw = JSON.parse(fs.readFileSync(path.join(kbDir, "tips.json"), "utf8"));
    const list = Array.isArray(tipsRaw) ? tipsRaw : (Object.values(tipsRaw).find(v => Array.isArray(v)) as any[]) ?? [];
    setTipsTable(loadTips(list));
    /**
     * ★★★ 第 186 轮：**状态名字表**也要显式设置（名字形态的引用：正文写「雄姿英发」而不是 [buff_x]）。
     *   与 tips 表同一条纪律 —— 这个文件读数据、编译器只读单例；不设置就是空表（fail-closed，名字形态不解析）。
     */
    setBuffNames(loadBuffNames(buffs));
  }
  const skills: CensusEntry[] = [];
  const dupSkillKeys: string[] = [];
  const seen = new Set<string>();
  for (const s of shiki) {
    for (const sk of (s.skills ?? [])) {
      // ★ 第 101 轮：形态类放置单位的解析要读 tips 表 ⇒ 普查入口也要设置（否则普查与生产的产物不一致）
      const ir = compileSkill(s.id, s.name, sk);
      const key = ir.charId + "/" + ir.id;
      if (seen.has(key)) dupSkillKeys.push(key);
      seen.add(key);
      skills.push({ key, json: JSON.stringify(ir) });
    }
  }
  const bs: CensusEntry[] = buffs.map((b: any) => ({ key: String(b.id), json: JSON.stringify(compileBuff(b)) }));
  return { input: { skills, buffs: bs }, dupSkillKeys };
}

// ───────── CLI（被 import 时不执行） ─────────
const here = import.meta.dirname;
const root = path.resolve(here, "..", "..");
const BASELINE = path.join(root, "battle-lab", "fixtures", "compile-baseline.json");
const EXPLAIN = path.join(here, "compile-explain.json");

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const { input, dupSkillKeys } = compileAll(path.join(root, "data", "kb"));
  console.log("=== 编译产物全量普查 ===");
  console.log("技能 " + input.skills.length + " 条｜buff " + input.buffs.length + " 条");
  if (dupSkillKeys.length) console.log("⚠ 技能键重复 " + dupSkillKeys.length + " 处（键为 charId/id，重复会让 diff 失真）");

  if (process.argv.includes("--update")) {
    const base: CensusBaseline = { skills: {}, buffs: {} };
    for (const e of input.skills) base.skills[e.key] = e.json;
    for (const e of input.buffs) base.buffs[e.key] = e.json;
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify(base), "utf8");
    console.log("已写入基线：" + BASELINE + "（" + (fs.statSync(BASELINE).size / 1024).toFixed(0) + " KB）");
    process.exit(0);
  }

  const base: CensusBaseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, "utf8")) : { skills: {}, buffs: {} };
  const explain: Record<string, string> = fs.existsSync(EXPLAIN) ? JSON.parse(fs.readFileSync(EXPLAIN, "utf8")) : {};
  const r = diffCensus(base, input, explain);

  for (const c of r.changed) {
    const reason = explain[c.ns + ":" + c.key];
    console.log((reason ? "○ 已解释 " : "✗ 未解释 ") + c.ns + ":" + c.key + (reason ? "  — " + reason : ""));
    if (!reason) console.log("    " + firstDifference(c.was, c.now));
  }
  for (const a of r.added) console.log("+ 新增 " + a);
  for (const d of r.removed) console.log("- 消失 " + d);
  console.log("");
  console.log("变化 " + r.changed.length + "（已解释 " + r.explained.length + "｜**未解释 " + r.unexplained.length + "**）｜新增 " + r.added.length + "｜消失 " + r.removed.length);
  if (r.unexplained.length || r.added.length || r.removed.length) {
    console.log("");
    console.log("处理方式二选一：① 回退改动；② 在 tools/compile-explain.json 里为**每一条**写明理由。");
    console.log("判据不是测试绿不绿，而是「变化的每一条我能不能解释」。");
    process.exitCode = 1;
  } else {
    console.log("✓ 所有编译产物与基线一致（或变化都已逐条解释）");
  }
}
