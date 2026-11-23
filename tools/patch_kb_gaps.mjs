#!/usr/bin/env node
// tools/patch_kb_gaps.mjs
// ---------------------------------------------------------------------------
// 补齐 data/kb/buffs.json 与 data/kb/tips.json 中「被技能文本引用、但知识库缺失」的词条。
//
// 数据来源（全部为已落盘的真实抓取物，不联网、不编造）：
//   - data/raw/SkillBuffs.json  ：Data:SkillBuffs.json 的抓取结果。
//     ⚠ 该文件被 web_fetch 的 10 万字符上限截断（只保留到 id≈5545 的部分），
//       但对本脚本需要的条目足够；脚本按「大括号配对扫描」逐条抽取，未闭合的尾部自动丢弃。
//   - data/raw/SkillTips.json   ：Data:SkillTips.json 的抓取结果（完整，156 条）。
//
// 归一化规则（与既有 331 条 buff / 119 条 tip 完全一致，脚本会自检复现率）：
//   buff.desc = '【' + type + '、' + kind + '】' + resolve(buffDesc)
//   tip.desc  = trim(resolve(skill_tips_text))
//   resolve() ：[tips_N] -> tip 名称；[buff_x] -> buff 名称；<br> 与换行 -> 空格；连续空白压成一个空格
//
// 运行： node tools/patch_kb_gaps.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const KB = path.join(ROOT, 'data', 'kb');
const p = (...a) => path.join(...a);

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

// 大括号配对扫描：从被截断的 JSON 文本里逐条抽出对象
function extractObjects(txt) {
  const map = {};
  const re = /"(\d+_\d+)":\{/g;
  let m;
  while ((m = re.exec(txt)) !== null) {
    const start = m.index + m[0].length - 1;
    let depth = 0, i = start, inStr = false, esc = false;
    for (; i < txt.length; i++) {
      const ch = txt[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) break; }
    }
    if (i >= txt.length) break; // 尾部被截断，丢弃
    try { const o = JSON.parse(txt.slice(start, i + 1)); if (o && o.id) map[o.id] = o; } catch {}
  }
  return map;
}

const kbBuffs = await readJson(p(KB, 'buffs.json'), []);
const kbTips = await readJson(p(KB, 'tips.json'), []);
const rawBuffs = extractObjects(await fs.readFile(p(RAW, 'SkillBuffs.json'), 'utf8'));
const rawTipsDoc = await readJson(p(RAW, 'SkillTips.json'), { tips: {} });
const rawTips = rawTipsDoc.tips ?? {};
const shikigami = await readJson(p(KB, 'shikigami.full.json'), []);

// ---- 名称表（用于还原 [buff_x] / [tips_x]） ---------------------------------
const buffName = new Map();
const tipName = new Map();
for (const b of Object.values(rawBuffs)) buffName.set(b.id, b.name);
for (const b of kbBuffs) if (!buffName.has(b.id)) buffName.set(b.id, b.name);
for (const [id, t] of Object.entries(rawTips)) tipName.set(String(id), t.skill_tips_name);
for (const t of kbTips) if (!tipName.has(String(t.id))) tipName.set(String(t.id), t.name);

const collapse = (s) => s.replace(/<br\s*\/?>/gi, ' ').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ');
function resolveRefs(text) {
  if (typeof text !== 'string') return '';
  let t = text.replace(/\[tips_(\d+)\]/g, (_, id) => tipName.get(String(id)) ?? '[tips_' + id + ']');
  t = t.replace(/\[buff_(\d+_\d+)\]/g, (_, id) => buffName.get(id) ?? '[buff_' + id + ']');
  return collapse(t);
}
const buffDescOf = (r) => '【' + r.type + '、' + r.kind + '】' + resolveRefs(r.buffDesc);
const tipDescOf = (t) => resolveRefs(t.skill_tips_text).trim();

// ---- 自检：规则必须能复现既有条目 -------------------------------------------
const buffCheck = { checked: 0, ok: 0 };
for (const b of kbBuffs) {
  const r = rawBuffs[b.id];
  if (!r) continue;
  buffCheck.checked++;
  if (buffDescOf(r) === b.desc) buffCheck.ok++;
}
const tipCheck = { checked: 0, ok: 0 };
for (const t of kbTips) {
  const r = rawTips[t.id];
  if (!r) continue;
  tipCheck.checked++;
  if (tipDescOf(r) === t.desc) tipCheck.ok++;
}

// ---- 找出「被引用但缺失」的 id ----------------------------------------------
const txt = JSON.stringify(shikigami);
const refBuffs = [...new Set([...txt.matchAll(/\[buff_(\d+_\d+)\]/g)].map(m => m[1]))];
const refTips = [...new Set([...txt.matchAll(/\[tips_(\d+)\]/g)].map(m => m[1]))];
const haveB = new Set(kbBuffs.map(b => b.id));
const haveT = new Set(kbTips.map(t => String(t.id)));
const missB = refBuffs.filter(id => !haveB.has(id)).sort();
const missT = refTips.filter(id => !haveT.has(id)).sort();

// ---- 追加 ---------------------------------------------------------------
const added = { buffs: [], tips: [] };
const unresolved = { buffs: [], tips: [] };
for (const id of missB) {
  const r = rawBuffs[id];
  if (!r) { unresolved.buffs.push({ id, reason: 'data/raw/SkillBuffs.json（10 万字符截断）中不存在该条目' }); continue; }
  kbBuffs.push({ id, name: r.name, desc: buffDescOf(r) });
  added.buffs.push({ id, name: r.name, desc: buffDescOf(r), source: 'data/raw/SkillBuffs.json' });
}
for (const id of missT) {
  const t = rawTips[id];
  if (!t) { unresolved.tips.push({ id, reason: 'data/raw/SkillTips.json 中不存在该条目' }); continue; }
  kbTips.push({ id: String(id), name: t.skill_tips_name, desc: tipDescOf(t) });
  added.tips.push({ id: String(id), name: t.skill_tips_name, desc: tipDescOf(t), source: 'data/raw/SkillTips.json' });
}

await fs.writeFile(p(KB, 'buffs.json'), JSON.stringify(kbBuffs, null, 1), 'utf8');
await fs.writeFile(p(KB, 'tips.json'), JSON.stringify(kbTips, null, 1), 'utf8');
await fs.writeFile(p(RAW, 'gap-entries.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  note: 'data/kb/buffs.json / tips.json 补齐记录；来源为本地已落盘的 wiki 抓取物，未联网、未编造。',
  rule: {
    buff: "desc = '【' + type + '、' + kind + '】' + resolve(buffDesc)",
    tip: "desc = trim(resolve(skill_tips_text))",
    resolve: '[tips_N]->tip名称；[buff_x]->buff名称；<br>/换行->空格；连续空白压缩',
  },
  selfCheck: { buff: buffCheck, tip: tipCheck },
  added, unresolved,
}, null, 1), 'utf8');

console.log(JSON.stringify({
  selfCheck: { buff: buffCheck, tip: tipCheck },
  requested: { buffs: missB, tips: missT },
  added: { buffs: added.buffs.map(b => b.id), tips: added.tips.map(t => t.id) },
  unresolved,
  totals: { buffs: kbBuffs.length, tips: kbTips.length },
}, null, 1));
