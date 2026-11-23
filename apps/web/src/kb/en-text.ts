// kb/en-text.ts — KB 正文（技能 / 术语 / 状态 / 御魂 / 标签）的英文显示层
// 数据：en-text.gen.ts（由 tools/build-en-text.mjs 从 data/kb/en-text.json 生成）。
// ★ 只用于**显示**：引擎与 battle-lab 仍读中文 KB；这里查不到英文 ⇒ 原样回退中文。
//
// key 约定（扁平）：
//   skill:<skillId>:name | brief | desc | up<level>    （skillId 如 "593_02"，level 2..5）
//   tip:<id>:name | desc                                buff:<id>:name | desc
//   soul:<i>:suit | desc                                tag:<中文标签>
// 英文值保留 [buff_x] / [tips_x] 占位符，resolveRefs 照常工作。
import { EN_TEXT } from "./en-text.gen.ts";
import type { RefTables, RefTip, ResolvedRef } from "./resolve-refs.ts";

type Id = string | number | null | undefined;

/**
 * The translations keep the game's corner brackets (『』「」) around skill names and use [skill_<id>] for a skill
 * named by id. For display: brackets become plain quotes and [skill_<id>] becomes that skill's English name.
 * ([buff_x] / [tips_x] stay: resolveRefs turns them into names with their explanation box.)
 */
function polish(v: string): string {
  return v
    .replace(/\[skill_(\d+_\d+)\]/g, (m, id: string) => EN_TEXT[`skill:${id}:name`] ?? m)
    .replace(/[『「]/g, "\"")
    .replace(/[』」]/g, "\"");
}

/** 按 key 取英文；缺失 / 空串 ⇒ 回退中文原文（null/undefined ⇒ ""） */
export function enText(key: string, fallbackCn: string | null | undefined): string {
  const v = EN_TEXT[key];
  return typeof v === "string" && v.length ? polish(v) : String(fallbackCn ?? "");
}

/** 是否有这条英文（测试 / 调试用） */
export function hasEnText(key: string): boolean {
  return typeof EN_TEXT[key] === "string" && EN_TEXT[key].length > 0;
}

export type SkillField = "name" | "brief" | "desc";

/** 技能文本：name / brief / desc */
export function skillText(skillId: Id, field: SkillField, cn: string | null | undefined): string {
  return skillId == null ? String(cn ?? "") : enText(`skill:${skillId}:${field}`, cn);
}

/** 技能升级句（Lv.2..5） */
export function skillUpgradeText(skillId: Id, level: number | string, cn: string | null | undefined): string {
  return skillId == null ? String(cn ?? "") : enText(`skill:${skillId}:up${level}`, cn);
}

/** 标签（技能 / 式神 / 御魂类型标签，中文原词作 key） */
export function tagText(cn: string | null | undefined): string {
  return cn == null ? "" : enText(`tag:${cn}`, cn);
}

/** 御魂 2 件套 / 4 件套 */
export function soulSuitText(soulId: Id, cn: string | null | undefined): string {
  return soulId == null ? String(cn ?? "") : enText(`soul:${soulId}:suit`, cn);
}
export function soulDescText(soulId: Id, cn: string | null | undefined): string {
  return soulId == null ? String(cn ?? "") : enText(`soul:${soulId}:desc`, cn);
}

/** 术语（tips）名与说明 */
export function tipName(id: Id, cn: string | null | undefined): string { return enText(`tip:${id}:name`, cn); }
export function tipDesc(id: Id, cn: string | null | undefined): string { return enText(`tip:${id}:desc`, cn); }

const prefixOf = (source: ResolvedRef["source"]) => (source === "buff" ? "buff" : "tip");

/** 英文化引用表：名字与说明逐条换成英文（缺失回退中文），供 resolveRefs 解析英文正文 */
export function enRefTables(tables: RefTables): RefTables {
  const map = (prefix: "tip" | "buff", list: RefTip[]): RefTip[] =>
    list.map((t) => ({
      id: t.id,
      name: enText(`${prefix}:${t.id}:name`, t.name),
      desc: enText(`${prefix}:${t.id}:desc`, t.desc),
    }));
  return { tips: map("tip", tables.tips ?? []), buffs: map("buff", tables.buffs ?? []) };
}

/** 单条引用英文化（小框：用中文表收集 —— 保证与游戏一致 —— 再按 id 换成英文显示） */
export function enRef(ref: ResolvedRef): ResolvedRef {
  const p = prefixOf(ref.source);
  return { ...ref, name: enText(`${p}:${ref.id}:name`, ref.name), text: enText(`${p}:${ref.id}:desc`, ref.text) };
}
