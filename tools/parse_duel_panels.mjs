#!/usr/bin/env node
// tools/parse_duel_panels.mjs
// ---------------------------------------------------------------------------
// 解析 data/kb/duiyi.json 中 239 条记录的「面板」自由文本 -> data/kb/duel-panels.json
//
// 输入样例（每条记录的「面板」字段可含多行，每行一个御魂配置）：
//   火灵：攻击2737 生命23586 防御696；799 速度169；181 暴击率5% 暴击伤害150% 效果命中15% 效果抵抗104；64%
//
// 噪声与处理策略（不猜，可疑即标 LOW 并保留 raw）：
//   1) 同一属性多值用「；」分隔（多套配置被折叠到一行）——原样保留为数组，不尝试与配置对齐；
//   2) 百分号只写在「一组值的末尾」（如「暴击率78；83；78%」），整组视为同一个百分数字段；
//   3) 全角冒号/百分号/分号/数字/空格（U+3000）统一归一化为半角；
//   4) 缺失属性、非数字 token、属性顺序异常、字段有多值 —— 一律 LOW，并在 notes 中写明原因。
//
// 数值口径（与 data/kb/shikigami.full.json 的 panel 一致，见 data/huiji_buff_dict.json 的 _meta.数值口径）：
//   攻击/生命/防御/速度 = 整数面板值；暴击/暴击伤害/效果命中/效果抵抗 = 小数（0.05 = 5%，1.5 = 150%）。
//
// 输出结构（data/kb/duel-panels.json）：
//   [{ name, build, atk, hp, def:[...], spd:[...], cri, crid, efh, efr, raw, parseConfidence, notes, recordId }]
//   - def / spd 恒为数组；atk/hp/cri/crid/efh/efr 单值时为 number，多值时为 number[]，缺失时为 null；
//   - parseConfidence: "HIGH"（8 项齐全、每项恰好 1 个值、无异常）| "LOW"（其余情况）。
//
// 运行： node tools/parse_duel_panels.mjs
// ---------------------------------------------------------------------------
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'data', 'kb', 'duiyi.json');
const OUT = path.join(ROOT, 'data', 'kb', 'duel-panels.json');
const SOULS = path.join(ROOT, 'data', 'kb', 'soul.json');

// 属性关键词，必须按此顺序出现
const FIELDS = [
  { key: 'atk', label: '攻击', pct: false },
  { key: 'hp', label: '生命', pct: false },
  { key: 'def', label: '防御', pct: false },
  { key: 'spd', label: '速度', pct: false },
  { key: 'cri', label: '暴击率', pct: true },
  { key: 'crid', label: '暴击伤害', pct: true },
  { key: 'efh', label: '效果命中', pct: true },
  { key: 'efr', label: '效果抵抗', pct: true },
];

const FULLWIDTH = [
  ['\u3000', ' '], ['：', ':'], ['；', ';'], ['％', '%'], ['，', ','], ['、', ','],
  ['０', '0'], ['１', '1'], ['２', '2'], ['３', '3'], ['４', '4'],
  ['５', '5'], ['６', '6'], ['７', '7'], ['８', '8'], ['９', '9'],
];

function normalize(s) {
  let t = String(s);
  for (const [a, b] of FULLWIDTH) t = t.split(a).join(b);
  return t.replace(/[\t\u00a0]/g, ' ').replace(/ {2,}/g, ' ').trim();
}

// 御魂名归一（对弈文本里的简称 -> Data:Soul.json 正式名）
const SOUL_ALIAS = new Map([['招财', '招财猫'], ['地藏', '地藏像'], ['三味', '三味'], ['日女巳时', '日女巳时']]);

function parseLine(line, soulNames) {
  const raw = line;
  const notes = [];
  let text = normalize(line);

  // 1) 拆 build（第一个冒号之前）
  let build = null;
  let body = text;
  const ci = text.search(/[：:]/);
  if (ci >= 0) {
    build = text.slice(0, ci).trim();
    body = text.slice(ci + 1).trim();
    if (!build) { build = null; notes.push('build 前缀为空'); }
    else if (build.length > 12) notes.push('build 前缀过长: ' + build);
  } else {
    notes.push('缺少 build 前缀（无冒号）');
  }

  // 2) 定位 8 个属性关键词
  const pos = [];
  for (const f of FIELDS) {
    const idx = body.indexOf(f.label);
    pos.push(idx);
  }
  const orderOk = pos.every((p, i) => p >= 0 && (i === 0 ? p === 0 : p > pos[i - 1]));
  if (!orderOk) notes.push('属性关键词缺失或顺序异常: [' + FIELDS.map((f, i) => f.label + '@' + pos[i]).join(', ') + ']');

  const values = {};
  for (let i = 0; i < FIELDS.length; i++) {
    const f = FIELDS[i];
    if (pos[i] < 0) { values[f.key] = []; continue; }
    const start = pos[i] + f.label.length;
    const end = (() => {
      let e = body.length;
      for (let j = i + 1; j < FIELDS.length; j++) if (pos[j] >= 0) { e = pos[j]; break; }
      return e;
    })();
    if (end <= start) { values[f.key] = []; notes.push(f.label + ' 段为空'); continue; }
    let seg = body.slice(start, end).trim();
    const hasPct = seg.includes('%');
    seg = seg.split('%').join(' ');
    const toks = seg.split(/[;,\s]+/).filter(t => t.length > 0);
    const nums = [];
    for (const t of toks) {
      if (!/^\d+(?:\.\d+)?$/.test(t)) { notes.push(f.label + ' 段含非数字 token: ' + JSON.stringify(t)); continue; }
      nums.push(Number(t));
    }
    if (nums.length === 0) notes.push(f.label + ' 段无有效数字: ' + JSON.stringify(body.slice(start, end).trim()));
    if (f.pct && nums.length > 0 && !hasPct) notes.push(f.label + ' 段缺少百分号');
    if (!f.pct && hasPct) notes.push(f.label + ' 段意外出现百分号');
    values[f.key] = f.pct ? nums.map(n => n / 100) : nums;
  }

  // 3) 组装结果
  const out = { build };
  for (const f of FIELDS) {
    const v = values[f.key];
    if (f.key === 'def' || f.key === 'spd') out[f.key] = v;
    else out[f.key] = v.length === 0 ? null : (v.length === 1 ? v[0] : v);
  }
  const multi = FIELDS.filter(f => values[f.key].length > 1).map(f => f.key);
  const missing = FIELDS.filter(f => values[f.key].length === 0).map(f => f.key);
  if (multi.length) notes.push('多值字段(未与具体配置对齐): ' + multi.join(','));
  if (missing.length) notes.push('缺失字段: ' + missing.join(','));

  const soul = build ? (soulNames.has(build) ? build : (SOUL_ALIAS.get(build) ?? null)) : null;
  if (build && !soul) notes.push('build 不是已知御魂名: ' + build);

  const confidence = (!orderOk || missing.length || multi.length || notes.length) ? 'LOW' : 'HIGH';
  return { out, values, confidence, notes, raw, soul };
}

const duiyi = JSON.parse(await fs.readFile(SRC, 'utf8'));
let soulNames = new Set();
try { soulNames = new Set(JSON.parse(await fs.readFile(SOULS, 'utf8')).map(s => s.name)); } catch {}

const entries = [];
let lineCount = 0, highCount = 0, lowCount = 0;
const reasonTally = new Map();
const buildTally = new Map();
const unknownBuilds = new Set();

for (const rec of duiyi) {
  const name = rec['名字'] ?? '';
  const panelText = rec['面板'];
  if (!panelText || !String(panelText).trim()) continue;
  for (const ln of String(panelText).split(/\r?\n/)) {
    if (!ln.trim()) continue;
    lineCount++;
    const p = parseLine(ln.trim(), soulNames);
    if (p.confidence === 'HIGH') highCount++; else lowCount++;
    for (const n of p.notes) {
      const k = n.split(':')[0].split('(')[0].trim();
      reasonTally.set(k, (reasonTally.get(k) ?? 0) + 1);
    }
    if (p.out.build) buildTally.set(p.out.build, (buildTally.get(p.out.build) ?? 0) + 1);
    if (p.out.build && !p.soul) unknownBuilds.add(p.out.build);
    entries.push({
      name,
      build: p.out.build,
      atk: p.out.atk, hp: p.out.hp, def: p.out.def, spd: p.out.spd,
      cri: p.out.cri, crid: p.out.crid, efh: p.out.efh, efr: p.out.efr,
      raw: p.raw,
      parseConfidence: p.confidence,
      notes: p.notes,
      recordId: rec['record_id'] ?? null,
    });
  }
}

await fs.writeFile(OUT, JSON.stringify(entries, null, 1), 'utf8');

const summary = {
  source: 'data/kb/duiyi.json',
  records: duiyi.length,
  recordsWithPanel: duiyi.filter(r => r['面板'] && String(r['面板']).trim()).length,
  lines: lineCount,
  entries: entries.length,
  HIGH: highCount,
  LOW: lowCount,
  distinctBuilds: buildTally.size,
  unknownBuilds: [...unknownBuilds],
  topLOWReasons: [...reasonTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
};
console.log(JSON.stringify(summary, null, 1));
console.log('--- 样例(前 3 条):');
console.log(JSON.stringify(entries.slice(0, 3), null, 1));
console.log('--- 第一个 HIGH 样例:');
console.log(JSON.stringify(entries.find(e => e.parseConfidence === 'HIGH') ?? null, null, 1));
