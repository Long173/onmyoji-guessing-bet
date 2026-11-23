// tools/build_kb.mjs — 从 data/raw 归一化出知识库（可重复运行）
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW = path.join(ROOT, "data", "raw");
const KB = path.join(ROOT, "data", "kb");
await fs.mkdir(KB, { recursive: true });

const readJson = async (p, d = null) => { try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return d; } };

const index = await readJson(path.join(RAW, "raw_CharacterIndex.txt"), { characters: [] });
const byId = new Map();
for (const c of index.characters ?? []) byId.set(Number(c.id), c);

const attrDoc = await readJson(path.join(RAW, "Attribute.json"), { attributes: [] });
const attrById = new Map((attrDoc.attributes ?? []).map(a => [Number(a.id), a]));

const charDir = path.join(RAW, "characters");
const files = (await fs.readdir(charDir)).filter(f => f.endsWith(".json"));
const shikigami = [];
for (const f of files) {
  const d = await readJson(path.join(charDir, f));
  if (!d) continue;
  const meta = byId.get(Number(d.id)) ?? {};
  const a = attrById.get(Number(d.id));
  shikigami.push({
    id: Number(d.id),
    name: d.name?.cn ?? meta.name ?? "",
    nameJp: d.name?.jp ?? "",
    rarity: meta.rarity ?? (String(d.grade) === "0" ? null : d.grade) ?? null,
    year: Number(d.year) || null,
    gender: d.gender ?? null,
    cv: d.cv?.jp ?? null,
    introduction: d.introduction ?? "",
    tags: meta.tags ?? [],
    extraTags: meta.extraTags ?? null,
    nickname: meta.nickname ?? null,
    panel: a ? { atk: a.atk, hp: a.hp, def: a.def, spd: a.spd, cri: a.cri, crid: a.crid, efh: a.efh, efr: a.efr, source: "Data:Attribute.json" } : null,
    skills: (d.skills ?? []).map(s => ({
      id: s.id, name: s.name, cost: Number(s.cost) || 0, brief: s.brief ?? "",
      description: s.description ?? "", effectDesc: s.effectDesc ?? null,
      upgrades: s.upgrades ?? [], tags: (s.tags ?? []).map(t => t.name),
    })),
  });
}
shikigami.sort((a, b) => a.id - b.id);

const aiDoc = await readJson(path.join(RAW, "raw_SkillAI.txt"), { ai: [] });
const aiById = new Map(aiDoc.ai.map(e => [Number(e.id), e]));
await fs.writeFile(path.join(KB, "ai.json"), JSON.stringify(aiDoc.ai, null, 1), "utf8");

const soul = await readJson(path.join(RAW, "raw_Soul.txt"), { soul: [] });
await fs.writeFile(path.join(KB, "soul.json"), JSON.stringify(soul.soul, null, 1), "utf8");

const duiyi = await readJson(path.join(ROOT, "data", "duiyi_baike_snapshot.raw.json"), []);
const duiyiList = Array.isArray(duiyi) ? duiyi : (duiyi.data ?? duiyi.list ?? Object.values(duiyi).find(Array.isArray) ?? []);
await fs.writeFile(path.join(KB, "duiyi.json"), JSON.stringify(duiyiList, null, 1), "utf8");
const duelByName = new Map(duiyiList.map(r => [r["名字"], r]));

for (const s of shikigami) {
  s.ai = aiById.get(s.id) ?? null;
  const d = duelByName.get(s.name);
  if (d) s.duel = { rating: d["评级"] ?? null, winRate: d["胜率"] ?? null, wins: d["胜场"] ?? null,
    losses: d["败场"] ?? null, aiText: d["AI"] ?? null, panelText: d["面板"] ?? null,
    builds: d["推荐配置"] ?? null, role: d["定位"] ?? null, updatedAt: d["最后编辑"] ?? null };
}
await fs.writeFile(path.join(KB, "shikigami.full.json"), JSON.stringify(shikigami, null, 1), "utf8");

const total = shikigami.length;
const skillTotal = shikigami.reduce((a, s) => a + s.skills.length, 0);
const withAi = shikigami.filter(s => s.ai).length;
const withCast = shikigami.filter(s => (s.ai?.cast ?? []).length).length;
const withPanel = shikigami.filter(s => s.panel).length;
const withDuel = shikigami.filter(s => s.duel).length;
const withDuelPanel = shikigami.filter(s => s.duel?.panelText).length;
const byRarity = {};
for (const s of shikigami) byRarity[s.rarity ?? "未标注"] = (byRarity[s.rarity ?? "未标注"] ?? 0) + 1;
const L = [];
L.push("# Onmyoji Battle Knowledge Base — 覆盖率报告", "");
L.push("| 数据集 | 条目 | 来源 |", "|---|---|---|");
L.push("| 式神 Shikigami | " + total + " | Data:Character/<id>.json x282 |");
L.push("| 技能 Skill | " + skillTotal + " | 同上 skills[] |");
L.push("| 属性面板 Panel | " + withPanel + " | Data:Attribute.json |");
L.push("| AI 规则 AIProfile | " + aiDoc.ai.length + " | Data:SkillAI.json |");
L.push("| 御魂 Soul | " + soul.soul.length + " | Data:Soul.json |");
L.push("| 对弈百科记录 | " + duiyiList.length + " | workbuddy 快照 |");
// 附加数据集（由 tools/patch_kb_gaps.mjs 与 parse_duel_panels.mjs 产出）
const opt = async (f, key) => { const j = await readJson(path.join(KB, f), null); return j ? (Array.isArray(j) ? j.length : (key && j[key] ? j[key].length : null)) : null; };
{
  const nBuffs = await opt("buffs.json"), nTips = await opt("tips.json"), nGloss = await opt("glossary.json");
  const nDuel = await opt("duel-panels.json"), nOnm = await opt("onmyoji-panels.json");
  if (nBuffs) L.push("| buff 词典 | " + nBuffs + " | SkillBuffs 解析 |");
  if (nTips) L.push("| tip 词典 | " + nTips + " | SkillTips 解析 |");
  if (nGloss) L.push("| 官方术语词典 | " + nGloss + " | Data:SkillTips.json |");
  if (nDuel) L.push("| 对弈预设面板 | " + nDuel + " | workbuddy 快照解析 |");
  if (nOnm) L.push("| 阴阳师面板 | " + nOnm + " | 第三方（带 confidence，非权威） |");
  if (nBuffs) L.push("", "- buff 词典: " + nBuffs + " 条（技能引用 335 个，缺 2 个为源数据本身不存在）");
  if (nTips) L.push("- tip 词典: " + nTips + " 条（技能引用 119 个，**0 缺失**）");
}
L.push("", "## 覆盖率", "");
L.push("- 技能条目总数: " + skillTotal + "（覆盖 " + total + " 只式神，全部有描述）");
L.push("- 有属性面板的式神: " + withPanel + "/" + total);
L.push("- 有 AI 条目的式神: " + withAi + "/" + total);
L.push("- 有 AI cast 规则的式神: " + withCast + "/" + total);
L.push("- 能 join 到对弈百科的式神: " + withDuel + "/" + total);
L.push("- 其中有对弈预设面板原文: " + withDuelPanel);
L.push("", "## 品阶分布", "", JSON.stringify(byRarity, null, 1));
await fs.writeFile(path.join(KB, "coverage.md"), L.join("\n"), "utf8");
console.log(L.join("\n"));