// tools/ir-dump.ts — ★★★ 第 137 轮：让 `fixtures/skill-ir.json` 从"只写不读"变成"可被断言"。
//
// 由来：报告 §39.5（第 47 轮）记下的处置是「保持原样 —— 它是人可读的全量 IR 转储，不是检查」。
// 那条处置在当时是对的，但它有一个**没有被兑现的前提**：转储得是**当前**编译器的产物。
// 第 137 轮实测：转储里 288_03「血之花海」的 shield 还是 `{"ratio":20,"base":"maxHp"}`，
// 而第 80 轮修好后的活产物是 `{"ratio":20,"base":"lostHp","evidence":"吸收20%已损失生命的伤害"}` ——
// 一个读这份转储的人（或 AI）会得出「已损失生命护盾没接」的结论，**与事实相反**。
// 更糟的是这类矛盾不会报错：它只是一份"没人比对"的文件。
//
// 所以这一轮做两件事：
//   ① 生成方式统一到**生产环境**（tools/compile-census.ts 的 compileAll 会装 tips 表；
//      compile/report.ts 原来不装 ⇒ 12 条形如 forms/formSkips 的产物与生产不一致）；
//   ② 把"转储 == 生产产物"做成**可执行**的断言（tests/g91-ir-dump.ts，带正向对照）。
// 这样 §39.5 那条处置就真的成立了：它是转储，**而且**是一条能被机械验证的转储。
import type { CensusEntry } from "./compile-census.ts";

export interface DumpDrift {
  /** 逐字节相同的条数 */
  same: number;
  /** 键对得上但内容不同的键（按发现顺序） */
  diff: string[];
  /** 生产产物里有、转储里没有的键 */
  missing: string[];
  /** 转储里有、生产产物里没有的键 */
  extra: string[];
}

/** 转储项 → 键。转储是**纯 IR 数组**（没有外层键），所以键必须由 charId/id 反推。 */
export function dumpKey(ir: any): string {
  return String(ir?.charId) + "/" + String(ir?.id);
}

/**
 * 逐条比对「转储」与「生产产物」。
 * ★ 先按键建表并**查重**：重复键会让"后一条覆盖前一条"，把真差异藏起来（防放水）。
 */
export function compareDump(dump: any[], entries: CensusEntry[]): DumpDrift & { dupInDump: string[] } {
  const byKey = new Map<string, any>();
  const dupInDump: string[] = [];
  for (const ir of dump) {
    const k = dumpKey(ir);
    if (byKey.has(k)) dupInDump.push(k);
    byKey.set(k, ir);
  }
  const seen = new Set<string>();
  const diff: string[] = [], missing: string[] = [];
  let same = 0;
  for (const e of entries) {
    seen.add(e.key);
    const d = byKey.get(e.key);
    if (d === undefined) { missing.push(e.key); continue; }
    if (JSON.stringify(d) === JSON.stringify(JSON.parse(e.json))) same++;
    else diff.push(e.key);
  }
  const extra = [...byKey.keys()].filter(k => !seen.has(k));
  return { same, diff, missing, extra, dupInDump };
}
