// compile/load.ts — 知识库装载的 **Node 侧** 入口（读文件）
// 装配逻辑本身在 compile/character.ts（纯函数），浏览器端复用同一份代码。
import fs from "node:fs/promises";
import path from "node:path";
import { buildCharacter, GUARDIAN_OF } from "./character.ts";
import type { LoadedChar } from "./character.ts";

export { buildCharacter, unknownBuff, mkCtx, selectSkillByAI, GUARDIAN_OF } from "./character.ts";
export type { LoadedChar } from "./character.ts";

const KB = path.resolve(import.meta.dirname, "..", "..", "data", "kb");

let onmyojiAI = new Map<number, any>();
export async function loadOnmyojiAI(): Promise<Map<number, any>> {
  if (onmyojiAI.size) return onmyojiAI;
  try {
    const raw = JSON.parse(await fs.readFile(path.join(KB, "onmyoji-ai.json"), "utf8"));
    for (const p of raw.profiles ?? []) onmyojiAI.set(Number(p.id), p);
  } catch { /* 文件不存在时保持空表 */ }
  return onmyojiAI;
}

let BUFFS: Map<string, any> | null = null;
export async function loadBuffs(): Promise<Map<string, any>> {
  if (BUFFS) return BUFFS;
  const raw = JSON.parse(await fs.readFile(path.join(KB, "buffs.json"), "utf8"));
  BUFFS = new Map();
  for (const b of raw) BUFFS.set(String(b.id), compileBuffLazy(b));
  return BUFFS;
}

// 保持与原实现完全一致的编译入口（避免循环 import，这里局部引入）
import { compileBuff } from "./buff-compiler.ts";
function compileBuffLazy(b: any) { return compileBuff(b); }

export async function loadKb() {
  const shiki = JSON.parse(await fs.readFile(path.join(KB, "shikigami.full.json"), "utf8"));
  const ai = JSON.parse(await fs.readFile(path.join(KB, "ai.json"), "utf8"));
  return { shiki, aiById: new Map(ai.map((e: any) => [Number(e.id), e])) };
}

/** Node 入口：读文件 + 装配。浏览器请改用 compile/character.ts 的 buildCharacter。 */
export async function loadCharacter(id: number, teamId: number, entId: number, opts: { kb?: any } = {}): Promise<LoadedChar> {
  const kb = opts.kb ?? await loadKb();
  const buffs = await loadBuffs();
  const omyAI = await loadOnmyojiAI();
  const s = kb.shiki.find((x: any) => Number(x.id) === id);
  if (!s) throw new Error("未找到式神 id=" + id);
  return buildCharacter(s, kb.aiById.get(Number(id)), omyAI.get(Number(id)), buffs, teamId, entId);
}
