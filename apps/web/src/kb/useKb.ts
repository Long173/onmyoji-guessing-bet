// kb/useKb.ts — 知识库访问层
// selector 索引随首屏加载（37KB）；detail 懒加载（552KB），点「查看技能」才取
import { computed, ref } from "vue";
import shikigamiIndex from "./shikigami-index.json";
import soulIndex from "./soul-index.json";
import glossaryJson from "./glossary.json";
import { shikigamiEnLower, soulEnLower } from "./names.ts";

export interface ShikigamiIndexEntry {
  i: number; n: string; r: string; y: number | null;
  k?: string; p?: string; s?: string; t: string[];
  /** 六星觉醒面板 [攻,生,防,速,暴击%,爆伤%,效果命中%,效果抵抗%]；源数据缺失处为 null */
  pn?: (number | null)[] | null;
  has: { panel: boolean; skills: number; ai: boolean };
}
export interface SoulStatBonus { key: string; rate?: number; flat?: number }
export interface SoulIndexEntry {
  i: number; n: string; tag: string; suit: string; desc: string; type: number;
  suitBonus: SoulStatBonus | null;
  engine: { trigger: string | null; effectKind: string; magnitudes: number[]; support: "FULL" | "PARTIAL" | "UNSUPPORTED"; note: string };
}
export interface GlossaryEntry { id: number; name: string; text: string }

export const SHIKIGAMI: ShikigamiIndexEntry[] = shikigamiIndex as any;
export const SOULS: SoulIndexEntry[] = soulIndex as any;
export const GLOSSARY: GlossaryEntry[] = glossaryJson as any;

export const RARITIES = ["SP", "SSR", "SR", "R", "N", "UR"];
export const SOUL_SUPPORT_LABEL: Record<string, string> = { FULL: "Fully implemented", PARTIAL: "Partially implemented", UNSUPPORTED: "Not implemented" };

/** 式神搜索：英文名 / 正式名 / 别名 / 全拼 / 首字母 / ID */
export function searchShikigami(q: string, rarity: string | null, limit = 60): ShikigamiIndexEntry[] {
  const s = q.trim().toLowerCase();
  let list = SHIKIGAMI;
  if (rarity) list = list.filter(x => x.r === rarity);
  if (!s) return list.slice(0, limit);
  const scored: Array<{ x: ShikigamiIndexEntry; sc: number }> = [];
  for (const x of list) {
    let sc = -1;
    if (String(x.i) === s) sc = 100;
    else if (x.n === s) sc = 95;
    else if (x.n.toLowerCase().startsWith(s)) sc = 90;
    else if (x.n.toLowerCase().includes(s)) sc = 80;
    else if (shikigamiEnLower(x.i) === s) sc = 94;               // 英文名（国际服）
    else if (shikigamiEnLower(x.i).startsWith(s)) sc = 89;
    else if (shikigamiEnLower(x.i).split(/\s+/).some(w => w.startsWith(s))) sc = 85;
    else if (shikigamiEnLower(x.i).includes(s)) sc = 78;
    else if (x.k && x.k.toLowerCase().includes(s)) sc = 75;   // 别名
    else if (x.p && x.p.startsWith(s)) sc = 70;                // 全拼
    else if (x.s && x.s.startsWith(s)) sc = 60;                // 首字母
    else if (x.t.some(t => t.includes(s))) sc = 40;            // tag
    if (sc > 0) scored.push({ x, sc });
  }
  return scored.sort((a, b) => b.sc - a.sc || a.x.i - b.x.i).slice(0, limit).map(v => v.x);
}

export function searchSouls(q: string, limit = 70): SoulIndexEntry[] {
  const s = q.trim().toLowerCase();
  if (!s) return SOULS;
  return SOULS.filter(x => x.n.toLowerCase().includes(s) || soulEnLower(x.i).includes(s)
    || x.tag.includes(s) || x.suit.includes(s) || String(x.i) === s).slice(0, limit);
}

// ---------- 懒加载 detail ----------
let detailPromise: Promise<Record<string, any>> | null = null;
const detailState = ref<"idle" | "loading" | "ready" | "error">("idle");
const detailError = ref<string | null>(null);

export async function loadDetail() {
  if (!detailPromise) {
    detailState.value = "loading";
    detailPromise = import("./shikigami-detail.json").then(m => {
      detailState.value = "ready";
      return (m.default ?? m) as Record<string, any>;
    }).catch(e => { detailState.value = "error"; detailError.value = String(e?.message ?? e); throw e; });
  }
  return detailPromise;
}
export function useDetailState() { return { state: detailState, error: detailError }; }

/** 最近使用（localStorage） */
const RECENT_KEY = "yys.workbench.recent.v1";
const recent = ref<number[]>(load());
function load(): number[] { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); } catch { return []; } }
export function pushRecent(id: number) {
  recent.value = [id, ...recent.value.filter(x => x !== id)].slice(0, 12);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value)); } catch { /* ignore */ }
}
export function recentShikigami(): ShikigamiIndexEntry[] {
  return recent.value.map(id => SHIKIGAMI.find(x => x.i === id)).filter(Boolean) as ShikigamiIndexEntry[];
}

export const byId = computed(() => new Map(SHIKIGAMI.map(x => [x.i, x])));
export function shikigamiById(id: number) { return SHIKIGAMI.find(x => x.i === id) ?? null; }

/**
 * 选中式神时的八维预填（六星觉醒面板）。
 * 只作为**起点**：用户随后按截图逐格覆盖。源数据缺项保留 null，调用方沿用当前值。
 */
export function panelPrefill(id: number): Record<string, number> | null {
  const pn = shikigamiById(id)?.pn;
  if (!pn) return null;
  const keys = ["attack", "hp", "defense", "speed", "critRate", "critDamage", "effectHit", "effectResist"];
  const out: Record<string, number> = {};
  pn.forEach((v, i) => { if (v != null) out[keys[i]] = v; });
  return out;
}
export function soulById(id: number | null) { return id === null ? null : (SOULS.find(x => x.i === id) ?? null); }
