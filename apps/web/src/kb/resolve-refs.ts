// kb/resolve-refs.ts — ★★★ 第 256 轮：把技能原文里的占位符**换成阴阳师里的说明文字**
//
// 由来（用户实测 + 截图）：式神录里那条技能写着「唯一效果。为友方目标治疗生命上限15%的生命并施加新蕊。」，
//   而我们的技能详情显示的是原文占位符 —— `[tips_11]。为友方目标治疗生命上限15%的生命并施加[buff_5981_1]。`
//   （知识库里其实**两张表都有**：glossary/tips 156 条 + buffs 338 条，只是没人把它们接进详情页。）
//
// 处置：一个**纯函数**解析器（可被尺子直接压），三种占位符各有明确去向：
//   · `[tips_N]`  ⇒ 内联换成术语名（唯一效果 / 先机 / 间接伤害…），完整说明随 ref 一起带出去（详情页做成悬停）；
//   · `[buff_x]`  ⇒ 内联换成状态名（新蕊 / 盛放…），同样带说明；
//   · **认不出的** ⇒ **原样留在正文里**并记进 `unknown`（不许静默吞掉 —— 这是本仓库反复抓的那一类）。
export interface RefTip { id: string; name: string; desc: string }
export interface RefTables { tips: RefTip[]; buffs: RefTip[] }
export interface ResolvedRef { source: "tips" | "buff"; id: string; name: string; text: string }
export type Part = { kind: "text"; text: string } | ({ kind: "ref" } & ResolvedRef);
export interface ResolvedText {
  /** 内联渲染用：文本片段与术语片段按原文顺序排好 */
  parts: Part[];
  /** 平铺后的纯文本（搜索 / 断言 / 复制用） */
  text: string;
  /** 这一段里用到的术语与状态（去重，按出现顺序） */
  refs: ResolvedRef[];
  /** 认不出的占位符（原样留在 text 里，这里也报一份） */
  unknown: string[];
}

const PATTERN = /\[(tips_(\d+)|buff_([0-9A-Za-z_]+))\]/g;

export function resolveRefs(raw: string, tables: RefTables): ResolvedText {
  const tipById = new Map(tables.tips.map((t) => [String(t.id), t]));
  const buffById = new Map(tables.buffs.map((b) => [String(b.id), b]));
  const parts: Part[] = [];
  const refs: ResolvedRef[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  let last = 0;
  const src = String(raw ?? "");
  for (const m of src.matchAll(PATTERN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ kind: "text", text: src.slice(last, at) });
    last = at + m[0].length;
    const tipId = m[2];
    const buffId = m[3];
    const hit: RefTip | undefined = tipId ? tipById.get(String(tipId)) : buffById.get(String(buffId));
    if (!hit) {
      /** 认不出 ⇒ 原样显示 + 记账（**不许**静默删掉这一段） */
      parts.push({ kind: "text", text: m[0] });
      if (!unknown.includes(m[0])) unknown.push(m[0]);
      continue;
    }
    const ref: ResolvedRef = { source: tipId ? "tips" : "buff", id: String(hit.id), name: String(hit.name), text: String(hit.desc ?? "") };
    parts.push({ kind: "ref", ...ref });
    const key = ref.source + ":" + ref.id;
    if (!seen.has(key)) { seen.add(key); refs.push(ref); }
  }
  if (last < src.length) parts.push({ kind: "text", text: src.slice(last) });
  const text = parts.map((p) => (p.kind === "text" ? p.text : p.name)).join("");
  return { parts, text, refs, unknown };
}

/** 只要纯文本时的便捷入口（列表 / 搜索用） */
export function resolveText(raw: string, tables: RefTables): string {
  return resolveRefs(raw, tables).text;
}

/**
 * ★★★ 第 256 轮（用户要求：「要与阴阳师里每个技能右边附加的小框**完全一致**」）。
 *
 * 游戏那个小框的规则（从用户给的四张式神录截图反推出来的，两条都不许少）：
 *   ① **印记/状态在前，术语在后**；各自**按首次出现的顺序**（先看技能正文，再看升级句）；
 *   ② **传递一层**：引用的条目自己的正文里又引用了别的条目，也要收进来
 *      （例：携芳意引用了新蕊，而新蕊的正文里写着「使携带者获得盛放」⇒ 小框里也有盛放）。
 * 对拍（用户截图）：
 *   · 携芳意 ⇒ 新蕊、盛放、唯一效果、先机     （正文引用新蕊+唯一效果；新蕊的正文引用盛放；升级 Lv.5 引用先机）
 *   · 醒时花 ⇒ 盛放、新蕊、唯一效果           （正文先提盛放再提新蕊 —— **顺序按正文出现**，不是按类型排序）
 */
export interface SkillRefBox { buffs: ResolvedRef[]; tips: ResolvedRef[]; unknown: string[] }

export function collectSkillRefs(texts: Array<string | null | undefined>, tables: RefTables): SkillRefBox {
  const tipById = new Map(tables.tips.map((t) => [String(t.id), t]));
  const buffById = new Map(tables.buffs.map((b) => [String(b.id), b]));
  const buffs: ResolvedRef[] = [];
  const tips: ResolvedRef[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  const queue = texts.map((t) => String(t ?? ""));
  /**
   * ★ 广度优先、但**保持出现顺序**：每一层的文本按原顺序扫，扫到的引用先进小框、
   *   再把「引用条目自己的正文」追加到队尾（这就是那个"传递一层"的实现，深度不限但天然收敛 —— 靠 seen 去重）。
   */
  /**
   * ★★★ 实测（第一版就漏了）：「传递」这一步**不能只认占位符** —— 新蕊的正文里写着
   *   「…触发3次后移除并使携带者获得**盛放**，持续3回合。」，那里没有 `[buff_5982_1]`，是**中文名**。
   *   游戏的小框里照样有盛放 ⇒ 扫描必须同时按**占位符**与**条目名**命中，两者合并后**按出现位置排序**
   *   （顺序错了小框的条目顺序就会与游戏不一致 —— 用户要的是"完全一致"）。
   * ★ 保守之处：只认长度 ≥ 2 的名字（单字名如「火」会把满篇正文都命中），且同一 id 只收一次。
   */
  const hitsOf = (text: string): Array<{ at: number; source: "tips" | "buff"; id: string; raw: string }> => {
    const out: Array<{ at: number; source: "tips" | "buff"; id: string; raw: string }> = [];
    for (const m of text.matchAll(PATTERN)) {
      const at = m.index ?? 0;
      if (m[2] !== undefined) out.push({ at, source: "tips", id: String(m[2]), raw: m[0] });
      else out.push({ at, source: "buff", id: String(m[3]), raw: m[0] });
    }
    for (const [source, table] of [["buff", tables.buffs], ["tips", tables.tips]] as Array<["buff" | "tips", RefTip[]]>) {
      for (const e of table) {
        const nm = String(e.name ?? "");
        if (nm.length < 2) continue;
        const at = text.indexOf(nm);
        if (at >= 0) out.push({ at, source, id: String(e.id), raw: nm });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  };
  for (let qi = 0; qi < queue.length; qi++) {
    const text = queue[qi];
    for (const h of hitsOf(text)) {
      const hit: RefTip | undefined = h.source === "tips" ? tipById.get(h.id) : buffById.get(h.id);
      if (!hit) { if (!unknown.includes(h.raw)) unknown.push(h.raw); continue; }
      const key = (h.source === "tips" ? "tips:" : "buff:") + hit.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const ref: ResolvedRef = { source: h.source, id: String(hit.id), name: String(hit.name), text: String(hit.desc ?? "") };
      (ref.source === "buff" ? buffs : tips).push(ref);
      /** 传递：把这条引用自己的正文也扫一遍（它里面的引用同样按出现顺序落到后面） */
      queue.push(ref.text);
    }
  }
  return { buffs, tips, unknown };
}
