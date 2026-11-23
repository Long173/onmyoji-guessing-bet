// tests/ui23-en-text.ts — KB 正文的英文显示层（kb/en-text.ts + en-text.gen.ts）
//
// 判据：缺译回退中文 · 英文正文的占位符仍能被 resolveRefs 解析（用英文化的表）· 小框按 id 换英文 ·
//       抽屉 / 图鉴 / 御魂选择器都走这层（不再直出中文原文）· 六星面板缺值显示「—」。
// ★ 断言不写死某条译文（data/kb/en-text.json 会被正式翻译整体覆盖），只断言「有译文时用译文、没有时回退」。
import fs from "node:fs";
import path from "node:path";
import { resolveRefs, collectSkillRefs } from "../src/kb/resolve-refs.ts";
import { enText, hasEnText, enRefTables, enRef, skillText, skillUpgradeText, tagText, soulSuitText } from "../src/kb/en-text.ts";

const here = import.meta.dirname;
const WEB = path.resolve(here, "..");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const S = (p: string) => fs.readFileSync(path.join(WEB, "src", p), "utf8");
const bundle: any = JSON.parse(fs.readFileSync(path.join(WEB, "src", "engine", "bundle.json"), "utf8"));
const detail: any = JSON.parse(fs.readFileSync(path.join(WEB, "src", "kb", "shikigami-detail.json"), "utf8"));
const TABLES = { tips: bundle.tips ?? [], buffs: bundle.buffs ?? [] };
const EN = enRefTables(TABLES);

sec("[1] 回退：查不到英文 ⇒ 原样中文");
{
  ok("未知 key ⇒ 中文原文", enText("skill:__nope__:desc", "中文") === "中文");
  ok("null 回退 ⇒ 空串（不渲染出 'undefined'）", enText("skill:__nope__:desc", undefined) === "");
  ok("skillId 缺失 ⇒ 中文", skillText(null, "name", "技能") === "技能");
  ok("升级句缺译 ⇒ 中文", skillUpgradeText("__nope__", 2, "升级") === "升级");
  ok("标签缺译 ⇒ 中文", tagText("__不存在的标签__") === "__不存在的标签__");
  ok("御魂缺译 ⇒ 中文", soulSuitText(-1, "攻击加成15%") === "攻击加成15%");
}

sec("[2] 英文化引用表：结构不变、id 不变、缺译条目保持中文");
{
  ok("条数与原表一致", EN.tips.length === TABLES.tips.length && EN.buffs.length === TABLES.buffs.length);
  ok("id 逐条一致", EN.buffs.every((b, i) => b.id === TABLES.buffs[i].id) && EN.tips.every((t, i) => t.id === TABLES.tips[i].id));
  const untranslated = TABLES.buffs.find((b: any) => !hasEnText(`buff:${b.id}:name`));
  ok("缺译条目名字仍是中文", !untranslated || EN.buffs.find((b) => b.id === untranslated.id)?.name === untranslated.name);
}

sec("[3] 593_02：英文正文里的占位符照常解析");
{
  const k = detail["593"]?.skills?.find((s: any) => String(s.id) === "593_02");
  ok("前置：KB 里有 593_02", !!k);
  const raw = skillText("593_02", "desc", k?.description);
  const r = resolveRefs(raw, EN);
  ok("占位符全部认得（unknown 为空）", r.unknown.length === 0, JSON.stringify(r.unknown));
  ok("解析后不再有 [tips_x] / [buff_x]", !/\[(tips|buff)_/.test(r.text), r.text);
  if (hasEnText("skill:593_02:desc")) {
    ok("有译文 ⇒ 用译文（正文不含中文句读）", !/[。，]/.test(r.text), r.text);
    const tipRef = r.parts.find((p: any) => p.kind === "ref" && p.source === "tips") as any;
    ok("tips_11 的名字走英文层", tipRef?.name === enText("tip:11:name", "唯一效果"), tipRef?.name);
    const buffRef = r.parts.find((p: any) => p.kind === "ref" && p.source === "buff") as any;
    ok("buff_5931_1 的名字走英文层", buffRef?.name === enText("buff:5931_1:name", "悬赏"), buffRef?.name);
  }
  const box = collectSkillRefs([k?.description, ...((k?.upgrades ?? []).map((u: any) => u.effect))], TABLES);
  const enBox = box.buffs.concat(box.tips).map(enRef);
  ok("小框：按中文收集、条目数不因翻译变化", enBox.length === box.buffs.length + box.tips.length && enBox.length > 0);
  ok("小框：名字按 id 换成英文层的值", enBox.every((x) => x.name === enText(`${x.source === "buff" ? "buff" : "tip"}:${x.id}:name`, x.name)));
}

sec("[4] 接线：界面上不再直出中文 KB 原文");
{
  const d = S("components/knowledge/DetailDrawer.vue");
  ok("抽屉引了英文层", /from "\.\.\/\.\.\/kb\/en-text\.ts"/.test(d));
  ok("技能名 / 标签 / 简介 / 正文 / 升级句都走英文层",
    /skillText\(id, "name"/.test(d) && /tagText\(t\)/.test(d) && /skillText\(id, "brief"/.test(d)
    && /skillText\(id, "desc"/.test(d) && /skillUpgradeText\(id, u\.level/.test(d));
  ok("小框按 id 换英文（enRef）、正文用英文表解析（enTables）", /map\(enRef\)/.test(d) && /enRefTables\(/.test(d));
  ok("反向：不再直出 raw.name / raw.tags / soul.suit / soul.desc",
    !/\{\{ v\.row\.raw\.name \}\}/.test(d) && !/in v\.row\.raw\.tags/.test(d) && !/\{\{ soul\.suit \}\}/.test(d) && !/\{\{ soul\.desc \}\}/.test(d));
  ok("六星面板缺值显示「—」（不再拼 ATK {{ detail.panel.atk }}）", !/detail\.panel\.atk \}\}/.test(d) && /fmtNum/.test(d));
  const c = S("components/knowledge/CodexView.vue");
  ok("图鉴：御魂 2/4 件套、标签、术语表走英文层",
    /soulSuitText\(s\.i/.test(c) && /soulDescText\(s\.i/.test(c) && /tagText\(t\)/.test(c) && /tipName\(g\.id/.test(c) && /tipDesc\(g\.id/.test(c));
  const so = S("components/lineup/SoulSelector.vue");
  ok("御魂选择器：2/4 件套走英文层", /soulSuitText\(hover\.i/.test(so) && /soulDescText\(hover\.i/.test(so));
  ok("机制页：覆盖标签走英文层", /tagText\(c\.tag\)/.test(S("components/mechanics/MechanicsView.vue")));
}

console.log(`\nui23-en-text: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
