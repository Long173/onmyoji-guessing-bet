// matches/names.ts — English (Global) names for shikigami and souls, and lineup normalisation.
// Data: data/kb/en-names.json (built from onmyoji.fandom.com lists).
import fs from "node:fs";
import path from "node:path";

const KB = path.resolve(import.meta.dirname, "..", "data", "kb");
const EN = JSON.parse(fs.readFileSync(path.join(KB, "en-names.json"), "utf8"));
const SHIKI: Array<{ id: number; name: string }> = JSON.parse(fs.readFileSync(path.join(KB, "shikigami.json"), "utf8"));
const SOULS: Array<{ id: number; name: string }> = JSON.parse(fs.readFileSync(path.join(KB, "soul.json"), "utf8"));

const norm = (s: string) => s.toLowerCase().replace(/[\s'’._-]+/g, "");

/** English display name for a shikigami (by KB id or Chinese name). */
export function enShiki(idOrCn: number | string): string {
  const id = typeof idOrCn === "number" ? idOrCn : SHIKI.find(s => s.name === idOrCn)?.id;
  return (id != null && EN.shikigami[String(id)]?.en) || String(idOrCn);
}

export function enSoul(idOrCn: number | string): string {
  const id = typeof idOrCn === "number" ? idOrCn : SOULS.find(s => s.name === idOrCn)?.id;
  return (id != null && EN.souls[String(id)]?.en) || String(idOrCn);
}

/** Resolve a shikigami written in English (Global or wiki name) or Chinese to its KB record. */
export function resolveShiki(name: string): { id: number; cn: string } | null {
  const key = norm(name);
  for (const [id, v] of Object.entries<any>(EN.shikigami)) {
    if (norm(v.en) === key || (v.wiki && norm(v.wiki) === key) || v.cn === name) return { id: Number(id), cn: v.cn };
  }
  const cn = SHIKI.find(s => s.name === name);
  return cn ? { id: cn.id, cn: cn.name } : null;
}

export function resolveSoul(name: string): number | null {
  const key = norm(name);
  for (const [id, v] of Object.entries<any>(EN.souls)) if (norm(v.en) === key || v.cn === name) return Number(id);
  return SOULS.find(s => s.name === name)?.id ?? null;
}

/**
 * Accepts lineup entries written as on the Global screen:
 *   { "name": "Shiro Mujou", "soul": "Temptress", "stats": {...} }
 * and fills shikigamiId / Chinese name / soulIds (4-piece) for the engine. Throws on unknown names.
 */
export function normalizeLineup(fx: any): any {
  const out = { ...fx };
  for (const side of ["red", "blue"]) {
    out[side] = fx[side].map((e: any) => {
      const hit = e.shikigamiId != null ? { id: e.shikigamiId, cn: e.name } : resolveShiki(e.name);
      if (!hit) throw new Error(`Không nhận ra thức thần "${e.name}" (${side})`);
      let soulIds = e.soulIds ?? null;
      if (!soulIds && e.soul) {
        const sid = resolveSoul(e.soul);
        if (sid == null) throw new Error(`Không nhận ra ngự hồn "${e.soul}" của ${e.name}`);
        soulIds = [sid, sid, sid, sid];
      }
      const cn = SHIKI.find(s => s.id === hit.id)?.name ?? hit.cn;
      return { ...e, name: cn, enName: enShiki(hit.id), shikigamiId: hit.id, soulIds };
    });
  }
  return out;
}
