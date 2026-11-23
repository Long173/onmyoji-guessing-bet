// tools/build-kb-index.mjs — 生成前端的紧凑知识库索引
// 索引分两层：selector 索引（首屏必备，~13KB） + detail 索引（懒加载）
import fs from "node:fs/promises";
import path from "node:path";
import { pinyin } from "pinyin-pro";
// ★ 从引擎导入效果解释器 —— 不复制逻辑，避免与引擎漂移
import { compileSoulEffect } from "../../../battle-lab/soul/effects.ts";
import { interpretEffect } from "../../../battle-lab/soul/effect-system.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const KB = path.join(ROOT, "data", "kb");
const OUT = path.resolve(import.meta.dirname, "..", "src", "kb");
await fs.mkdir(OUT, { recursive: true });

const ONMYOJI = new Set([10, 11, 12, 13, 15, 16]);
const shiki = JSON.parse(await fs.readFile(path.join(KB, "shikigami.full.json"), "utf8"))
  .filter(s => !ONMYOJI.has(Number(s.id)));
const souls = JSON.parse(await fs.readFile(path.join(KB, "soul.json"), "utf8"));
const glossary = JSON.parse(await fs.readFile(path.join(KB, "glossary.json"), "utf8"));

const RARITY_ORDER = ["SP", "SSR", "SR", "R", "N", "UR", "联动", "呱", "素材"];

function py(name) {
  try { return pinyin(name, { toneType: "none", type: "array" }).join(""); } catch { return ""; }
}
function initials(name) {
  try { return pinyin(name, { pattern: "first", toneType: "none", type: "array" }).join(""); } catch { return ""; }
}

// ---------- selector 索引 ----------
const index = shiki.map(s => {
  const nick = Array.isArray(s.nickname) ? s.nickname.join(" ") : (s.nickname || "");
  return {
    i: Number(s.id),
    n: s.name,
    r: s.rarity || "?",
    y: Number(s.year) || null,
    k: nick || undefined,          // 别名
    p: py(s.name) || undefined,     // 全拼
    s: initials(s.name) || undefined, // 首字母
    t: (s.tags ?? []).slice(0, 4),
    // ★ 六星觉醒面板，供「选中式神即预填八维」用（避免逐格手打 80 个数字）
    // 顺序 = [攻, 生, 防, 速, 暴击%, 爆伤%, 效果命中%, 效果抵抗%]；源数据缺失处为 null
    pn: s.panel ? [s.panel.atk, s.panel.hp, s.panel.def, s.panel.spd,
                   s.panel.cri == null ? null : Math.round(s.panel.cri * 1000) / 10,
                   s.panel.crid == null ? null : Math.round(s.panel.crid * 1000) / 10,
                   s.panel.efh == null ? null : Math.round(s.panel.efh * 1000) / 10,
                   s.panel.efr == null ? null : Math.round(s.panel.efr * 1000) / 10] : null,
    /**
     * ★★★ 第 162 轮：**「有面板」的判据收紧**。
     *   原来判的是 `!!s.panel` —— 而实测有 4 只（生剥鬼 / 慧明灯 / 盗人神 / 湍津姬）的 panel 对象
     *   只有速度/暴击/抵抗，**攻/生/防全是 null**（来源 Data:Attribute.json）。
     *   于是图鉴圆点写着「六星面板存在」，而面板其实只有半张 —— 属于「有字段 ≠ 有数据」。
     *   现在判据改成：**攻/生/防至少一项非 null** 才算有面板。
     *   ★ 注意：这不影响预填（panelPrefill 本来就跳过 null，见 apps/web/src/kb/useKb.ts），
     *     只影响**界面上那句声明**是否说得过满。
     */
    has: { panel: !!(s.panel && (s.panel.atk != null || s.panel.hp != null || s.panel.def != null)), skills: (s.skills ?? []).length, ai: !!s.ai },
  };
}).sort((a, b) => {
  const ra = RARITY_ORDER.indexOf(a.r), rb = RARITY_ORDER.indexOf(b.r);
  return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || (b.y ?? 0) - (a.y ?? 0) || a.i - b.i;
});
await fs.writeFile(path.join(OUT, "shikigami-index.json"), JSON.stringify(index), "utf8");

// ---------- detail 索引（懒加载）----------
const detail = {};
for (const s of shiki) {
  detail[String(s.id)] = {
    panel: s.panel ?? null,
    tags: s.tags ?? [],
    extraTags: s.extraTags ?? null,
    skills: (s.skills ?? []).map(k => ({
      id: k.id, name: k.name, cost: k.cost, brief: k.brief,
      description: k.description, upgrades: k.upgrades ?? [], tags: k.tags ?? [],
    })),
    ai: s.ai ?? null,
  };
}
await fs.writeFile(path.join(OUT, "shikigami-detail.json"), JSON.stringify(detail), "utf8");

// ---------- 御魂索引 ----------
const soulIndex = souls.map(s => {
  const ir = compileSoulEffect(s);
  const interp = interpretEffect(ir);
  const supported = interp.kind !== "UNSUPPORTED" && !!ir.trigger;
  return {
    i: Number(s.id), n: s.name, tag: s.Tag || "", suit: s.suit || "", desc: s.desc || "",
    type: Number(s.type) || 1,
    // 2 件套的机器可读形式（UI 展示 + 后续校验共用）
    suitBonus: parseSuit(s.suit),
    // ★ 引擎实现状态：UI 必须在开跑前告知用户（UX 护栏 #5）
    engine: {
      trigger: ir.trigger,
      effectKind: interp.kind,
      magnitudes: ir.magnitudes,
      support: supported ? "FULL" : (ir.trigger ? "PARTIAL" : "UNSUPPORTED"),
      note: interp.note,
    },
  };
}).sort((a, b) => a.i - b.i);
await fs.writeFile(path.join(OUT, "soul-index.json"), JSON.stringify(soulIndex), "utf8");

// ---------- 术语表（Knowledge 页用）----------
await fs.writeFile(path.join(OUT, "glossary.json"), JSON.stringify(
  glossary.map(g => ({ id: g.id, name: g.name, text: g.text }))), "utf8");

function parseSuit(t) {
  if (!t) return null;
  const P = [["攻击加成", "attack"], ["生命加成", "hp"], ["防御加成", "defense"], ["暴击伤害", "critDamage"],
             ["暴击", "critRate"], ["效果命中", "effectHit"], ["效果抵抗", "effectResist"]];
  for (const [label, key] of P) {
    const m = t.match(new RegExp(label + "\\s*(\\d+(?:\\.\\d+)?)%"));
    if (m) return { key, rate: parseFloat(m[1]) / 100 };
  }
  const sp = t.match(/速度\\s*\\+?\\s*(\\d+)/);
  if (sp) return { key: "speed", flat: parseFloat(sp[1]) };
  return null;
}

const bytes = async f => (await fs.stat(path.join(OUT, f))).size;
console.log("=== KB 索引已生成 ===");
for (const f of ["shikigami-index.json", "shikigami-detail.json", "soul-index.json", "glossary.json"]) {
  console.log(`  ${f.padEnd(26)} ${(await bytes(f) / 1024).toFixed(1)} KB`);
}
console.log(`\n式神 ${index.length} 只｜御魂 ${soulIndex.length} 条｜术语 ${glossary.length} 条`);
const withPy = index.filter(x => x.p).length;
console.log(`拼音覆盖 ${withPy}/${index.length}`);
console.log("稀有度分布:", JSON.stringify(index.reduce((a, x) => (a[x.r] = (a[x.r] || 0) + 1, a), {})));
console.log("样例:", JSON.stringify(index.find(x => x.n === "夜溟彼岸花")));
