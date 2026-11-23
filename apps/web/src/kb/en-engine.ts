// kb/en-engine.ts — display-time English for strings that come out of the engine
// (trace events / replays, AI decisions, damage breakdowns, compile reasons, AI conditions from data/kb/ai.json).
//
// ★ Display only. The engine, the trace format and the replay files keep their Chinese strings; tests pin them.
// Sources, in priority order (all generated into en-engine.gen.ts by tools/build-en-text.mjs):
//   ENGINE_SENTENCES  whole strings (AI conditions / target rules / engine notes), exact match only;
//   ENGINE_TERMS      phrases that only exist in the betting kits or engine logs (data/kb/en-engine-terms.json);
//   KB names          skill / status (buff + tip) names and tags, the same English as the Skills tab (en-text.json);
//   shikigami / soul  names (en-names.json).
// Mixed strings ("Kuro 连斩", "愿满夜·幻境", "基础 3788.8 × 倍率 100% = 3788.8") are translated piecewise:
// longest known phrase first, ASCII passes through, full-width punctuation becomes ASCII.
// Unknown Chinese is left as it is (honest fallback); tests/ui26-en-everywhere.ts keeps the sample matches clean.
import { ENGINE_SENTENCES, ENGINE_TERMS, KB_SKILL_EN, KB_STATUS_EN, KB_TAG_EN } from "./en-engine.gen.ts";
import { SHIKIGAMI_EN, SOUL_EN } from "./en-names.gen.ts";

/** Any CJK ideograph, CJK punctuation or full-width form (the same ranges the no-CJK tests use). */
export const CJK_RE = /[　-〿㐀-鿿豈-﫿＀-￯]/;
const IDEO_RE = /[㐀-鿿豈-﫿]/;

const SKILL = new Map<string, string>(Object.entries(KB_SKILL_EN));
const STATUS = new Map<string, string>(Object.entries(KB_STATUS_EN));
/** Phrase table for piecewise translation (later sets win). */
const PHRASE = new Map<string, string>();
for (const [cn, en] of Object.entries(KB_TAG_EN)) PHRASE.set(cn, en);
for (const [en, cn] of Object.values(SOUL_EN)) PHRASE.set(cn, en);
for (const [cn, en] of Object.entries(KB_STATUS_EN)) PHRASE.set(cn, en);
for (const [cn, en] of Object.entries(KB_SKILL_EN)) PHRASE.set(cn, en);
for (const [en, cn] of Object.values(SHIKIGAMI_EN)) PHRASE.set(cn, en);
for (const [cn, en] of Object.entries(ENGINE_TERMS)) PHRASE.set(cn, en);
const SENTENCE = new Map<string, string>(Object.entries(ENGINE_SENTENCES));
let MAX_LEN = 1;
for (const k of PHRASE.keys()) MAX_LEN = Math.max(MAX_LEN, k.length);

/** Full-width / CJK punctuation → ASCII (spacing is tidied afterwards). */
const PUNCT: Record<string, string> = {
  "（": " (", "）": ") ", "，": ", ", "：": ": ", "；": "; ", "、": ", ", "。": ". ", "！": "! ", "？": "? ",
  "「": " \"", "」": "\" ", "『": " \"", "』": "\" ", "【": " [", "】": "] ", "《": " \"", "》": "\" ",
  "～": "~", "　": " ", "％": "%", "＋": "+", "－": "-", "＝": "=", "＜": "<", "＞": ">", "／": "/", "＊": "*",
  "｜": " | ", "…": "...", "“": "\"", "”": "\"",
};
const WORD_END = /[A-Za-z0-9%)\].]$/;
const WORD_START = /^[A-Za-z0-9(\["'#+]/;

function tidy(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}

/** Piecewise translation: longest known phrase at each Chinese position; everything else passes through. */
function piecewise(src: string): string {
  let out = "";
  let lastTranslated = false;
  const push = (piece: string, translated: boolean) => {
    if (!piece) return;
    if ((translated || lastTranslated) && WORD_END.test(out) && WORD_START.test(piece)) out += " ";
    out += piece;
    lastTranslated = translated;
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (IDEO_RE.test(ch)) {
      let hit: string | undefined;
      for (let n = Math.min(MAX_LEN, src.length - i); n >= 1; n--) {
        hit = PHRASE.get(src.slice(i, i + n));
        if (hit !== undefined) { i += n; break; }
      }
      if (hit === undefined) { push(ch, false); i++; }      // unknown: left as is
      else if (hit !== "") push(hit, true);                  // "" = a dropped particle (的, 时 …)
      continue;
    }
    if (PUNCT[ch] !== undefined) { out += PUNCT[ch]; lastTranslated = false; i++; continue; }
    push(ch, false);
    i++;
  }
  return tidy(out);
}

const memo = new Map<string, string>();
const MEMO_MAX = 20000;

/** Pattern rules for structured engine strings (run before the phrase pass). */
const RULES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // AI skill slots: "3技能【暴风雪】" → "Skill 3 (Blizzard)", "1/3技能" → "Skill 1/3"
  [/(\d(?:\/\d)*)技能(?:【([^】]+)】)?/g as any, (m) => "Skill " + m[1] + (m[2] ? " (" + enSkill(m[2]) + ")" : "")],
  // "75%概率" → "75% chance:"
  [/(\d+(?:\.\d+)?%)概率/g as any, (m) => m[1] + " chance: "],
  // "第 98 轮" (engine round notes) → "round 98"
  [/第 ?(\d+) ?轮/g as any, (m) => "round " + m[1] + " "],
  // "[tips_7]先机" in quoted skill text: the placeholder is followed by its own name, so drop the placeholder
  [/\[tips_\d+\](?=[㐀-鿿])/g as any, () => ""],
];

/** Generic translation of an engine string. Non-strings are stringified; strings without Chinese pass through. */
export function enEngine(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (!CJK_RE.test(s)) return s;
  const hit = memo.get(s);
  if (hit !== undefined) return hit;
  let res = SENTENCE.get(s) ?? SKILL.get(s) ?? STATUS.get(s) ?? PHRASE.get(s);
  if (res === undefined) {
    let t = s;
    for (const [re, fn] of RULES) t = t.replace(re, (...a: any[]) => fn(a as unknown as RegExpMatchArray));
    res = SENTENCE.get(t) ?? piecewise(t);
  }
  if (memo.size > MEMO_MAX) memo.clear();
  memo.set(s, res);
  return res;
}

/** A skill name (prefers the KB skill table: some skills share a name with a status). */
export function enSkill(v: unknown): string {
  const s = v == null ? "" : String(v);
  return SKILL.get(s) ?? enEngine(s);
}

/** A status / mark / field name (prefers the KB buff / tip tables). */
export function enStatus(v: unknown): string {
  const s = v == null ? "" : String(v);
  return STATUS.get(s) ?? enEngine(s);
}

/** True when the string still contains Chinese after translation (tests / diagnostics). */
export function hasCjk(v: unknown): boolean {
  return CJK_RE.test(String(v ?? ""));
}

/** Translate every string inside a JSON-like value (new object; the input is not touched). */
export function enDeep<T>(v: T): T {
  if (typeof v === "string") return enEngine(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => enDeep(x)) as unknown as T;
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) o[k] = enDeep(x);
    return o as T;
  }
  return v;
}

/** Action Banner (theater/presenter.ts BannerView) translated for display; the Presenter keeps engine strings. */
export function enBanner<B extends { actor?: string; target?: string; skill?: string; lines: Array<{ label: string; value: string }> }>(b: B | null | undefined): B | null {
  if (!b) return null;
  return {
    ...b,
    actor: b.actor === undefined ? undefined : enEngine(b.actor),
    target: b.target === undefined ? undefined : enEngine(b.target),
    skill: b.skill === undefined ? undefined : enSkill(b.skill),
    lines: b.lines.map((l) => ({ ...l, label: enEngine(l.label), value: enEngine(l.value) })),
  };
}

/**
 * AI skill slot text from data/kb/ai.json ("3技能【暴风雪】", "75%概率2技能【花之馨香】，25%概率1技能【花舞】", "普攻").
 * byName: the shikigami's own skill table (Chinese name → English); slot: English name of skill slot N.
 * The AI data sometimes spells a skill name differently from the skill table, so the slot number is the fallback.
 */
export function enAiSkill(cn: unknown, byName?: (cn: string) => string | undefined, slot?: (n: number) => string | undefined): string {
  const s = cn == null ? "" : String(cn);
  const own = byName?.(s);
  if (own !== undefined) return own;
  // Whole-string translation first for slot text with extra words ("3技能（拔锤子）"); a bare slot gets the skill name.
  if (!/^\d(?:\/\d)*技能(?:【[^】]+】)?$/.test(s)) {
    const whole = SENTENCE.get(s);
    if (whole !== undefined) return whole;
  }
  const t = s.replace(/(\d)技能(?:【([^】]+)】)?/g, (_m, n: string, name?: string) => {
    const en = (name ? byName?.(name) : undefined) ?? slot?.(Number(n)) ?? (name ? enSkill(name) : undefined);
    return "Skill " + n + (en ? " (" + en + ")" : "");
  });
  return enEngine(t);
}
