// kb/names.ts — 式神 / 御魂的英文显示名（国际服名）
// 数据：en-names.gen.ts（由 tools/build-en-names.mjs 从 data/kb/en-names.json 生成）。
// ★ 只用于**显示**：存进对局 JSON / 交给引擎的仍是中文名与 ID，引擎侧比较不受影响。
// 查不到英文名时回退到中文名。
import { SHIKIGAMI_EN, SOUL_EN } from "./en-names.gen.ts";

const shikiByCn = new Map<string, string>();
for (const [en, cn] of Object.values(SHIKIGAMI_EN)) shikiByCn.set(cn, en);
const soulByCn = new Map<string, string>();
for (const [en, cn] of Object.values(SOUL_EN)) soulByCn.set(cn, en);

/** 式神英文名（按 KB id）；无记录 ⇒ null */
export function shikigamiEn(id: number | string | null | undefined): string | null {
  if (id == null) return null;
  return SHIKIGAMI_EN[String(id)]?.[0] ?? null;
}

/** 御魂英文名（按 soul id）；无记录 ⇒ null */
export function soulEn(id: number | string | null | undefined): string | null {
  if (id == null) return null;
  return SOUL_EN[String(id)]?.[0] ?? null;
}

/** 式神显示名：优先英文，回退中文 */
export function shikigamiName(id: number | string | null | undefined, cn: string): string {
  return shikigamiEn(id) ?? cn;
}

/** 御魂显示名：优先英文，回退中文 */
export function soulName(id: number | string | null | undefined, cn: string): string {
  return soulEn(id) ?? cn;
}

/**
 * 按中文名找英文显示名（引擎 / 录像里只有中文名时用，例如剧场卡面与事件日志）。
 * 先查式神再查御魂；都查不到 ⇒ 原样返回（召唤物、阴阳师等）。
 */
export function displayName(cn: string | null | undefined): string {
  if (cn == null) return "";
  return shikiByCn.get(cn) ?? soulByCn.get(cn) ?? cn;
}

/** 搜索用：式神英文名（小写）；无记录 ⇒ "" */
export function shikigamiEnLower(id: number): string {
  return (SHIKIGAMI_EN[String(id)]?.[0] ?? "").toLowerCase();
}

/** 搜索用：御魂英文名（小写）；无记录 ⇒ "" */
export function soulEnLower(id: number): string {
  return (SOUL_EN[String(id)]?.[0] ?? "").toLowerCase();
}
