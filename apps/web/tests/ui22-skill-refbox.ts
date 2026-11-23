// tests/ui22-skill-refbox.ts — ★★★ 第 256 轮：**技能右边那个小框**（与阴阳师式神录完全一致）
//
// 由来（用户要求）：「要与阴阳师里面的那个他每个技能右边附加的小框，一致，完全一致。」
//   我们此前把技能原文**带占位符**直接显示（`[tips_11]。…施加[buff_5981_1]。`），而游戏显示的是
//   左边正文（占位符换成术语名）+ 右边小框（这条技能引用到的**印记 / 术语**连同游戏原文）。
//   数据一直都在（bundle 里 tips 122 条 + buffs 338 条），缺的是把它接出来。
//
// 判据：解析器逐条 · **与用户四张截图对拍**（携芳意 / 醒时花 / 回春舞）· 文字来自游戏数据 · 接线 · 反向（不许静默吞占位符）。
import fs from "node:fs";
import path from "node:path";
import { resolveRefs, collectSkillRefs } from "../src/kb/resolve-refs.ts";

const here = import.meta.dirname;
const WEB = path.resolve(here, "..");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);
const S = (p: string) => fs.readFileSync(path.join(WEB, "src", p), "utf8");
const bundle: any = JSON.parse(fs.readFileSync(path.join(WEB, "src", "engine", "bundle.json"), "utf8"));
const TABLES = { tips: bundle.tips ?? [], buffs: bundle.buffs ?? [] };
const peach: any = bundle.shiki.find((s: any) => String(s.id) === "598");
const skill = (id: string) => peach.skills.find((k: any) => String(k.id) === id);
const boxOf = (k: any) => collectSkillRefs([k.description, ...((k.upgrades ?? []).map((u: any) => u.effect))], TABLES);

sec("[1] ★★★ 正文：占位符换成游戏里的名字（不再是 [tips_11] / [buff_5981_1]）");
{
  const r = resolveRefs(String(skill("598_02").description), TABLES);
  ok("★★★ 携芳意正文 = 「唯一效果。为友方目标治疗生命上限15%的生命并施加新蕊。」（与式神录截图逐字一致）",
    r.text === "唯一效果。为友方目标治疗生命上限15%的生命并施加新蕊。", r.text);
  ok("★★★ parts 结构：文本与术语片段按原文顺序排好（界面据此做悬停）", r.parts.map((p) => p.kind).join(",") === "ref,text,ref,text", JSON.stringify(r.parts.map((p) => p.kind)));
  ok("★★★ 术语片段带着**游戏原文**（悬停才看得到「唯一效果」是什么意思）",
    r.refs[0].name === "唯一效果" && /多个同名式神在场/.test(r.refs[0].text), JSON.stringify(r.refs[0]));
  const up = resolveRefs(String(skill("598_02").upgrades[3].effect), TABLES);
  ok("★★★ Lv.5 里的 [tips_7] 也换成了「先机」", up.text.startsWith("先机："), up.text);
}

sec("[2] ★★★ 右边那个小框：与用户四张截图**逐条对拍**");
{
  const box = (id: string) => { const b = boxOf(skill(id)); return { buffs: b.buffs.map((x) => x.name), tips: b.tips.map((x) => x.name) }; };
  const a = box("598_02");
  ok("★★★ 携芳意 ⇒ 印记[新蕊、盛放] 术语[唯一效果、先机]（截图里就是这四条、这个顺序）",
    a.buffs.join("、") === "新蕊、盛放" && a.tips.join("、") === "唯一效果、先机", JSON.stringify(a));
  const b = box("598_03");
  ok("★★★ 醒时花 ⇒ 印记[盛放、新蕊] 术语[唯一效果]（**顺序按正文出现**，不是按类型排）",
    b.buffs.join("、") === "盛放、新蕊" && b.tips.join("、") === "唯一效果", JSON.stringify(b));
  const c = box("598_01");
  ok("★★ 回春舞 ⇒ 空（截图里它右边没有小框）", c.buffs.length === 0 && c.tips.length === 0, JSON.stringify(c));
  ok("★★★ 传递一层：携芳意自己只写了新蕊，而「盛放」是**新蕊的正文里**提到的 —— 也收进来了",
    String(TABLES.buffs.find((x: any) => x.id === "5981_1").desc).includes("盛放") && a.buffs.includes("盛放"));
}

sec("[3] ★★★ 小框里的文字来自**游戏数据本身**（不是我们重写的）");
{
  const txt = (name: string) => String((TABLES.buffs.concat(TABLES.tips)).find((x: any) => x.name === name)?.desc ?? "");
  ok("★★★ 盛放 =「【增益、印记】攻击、防御与速度提升50%」", txt("盛放").includes("攻击、防御与速度提升50%"), txt("盛放"));
  ok("★★★ 新蕊 =「【通用、印记】携带者行动开始时为其治疗灼华桃花妖生命上限10%的生命…触发3次后移除并使携带者获得盛放，持续3回合」",
    txt("新蕊").includes("携带者行动开始时") && txt("新蕊").includes("触发3次后移除") && txt("新蕊").includes("持续3回合"), txt("新蕊"));
  ok("★★★ 唯一效果 =「若是有多个同名式神在场，只有其中一个式神的此技能会生效」", txt("唯一效果").includes("多个同名式神在场"), txt("唯一效果"));
  ok("★★★ 先机 =「在战斗开始时进行动作」", txt("先机").includes("在战斗开始时进行动作"), txt("先机"));
}

sec("[4] ★★★ 接线：技能详情真的用它渲染（而且正文不再直出原文）");
{
  const d = S("components/knowledge/DetailDrawer.vue");
  ok("★★★ 引了解析器与两张表", /from "\.\.\/\.\.\/kb\/resolve-refs\.ts"/.test(d) && /from "\.\.\/\.\.\/engine\/bundle\.json"/.test(d));
  ok("★★★ 正文走 parts 渲染（kw 带 title=游戏原文）", /v-for="\(p, i\) in v\.desc"/.test(d) && /class="kw" :title="p\.text"/.test(d));
  ok("★★★ 升级句也解析了（Lv.5 的「先机：…」不再是 [tips_7]）", /v-for="\(p, i\) in u\.parts"/.test(d));
  ok("★★★ 右边小框渲染出来了（印记在前、术语在后：collectSkillRefs 已按此排序）", /class="refbox"/.test(d) && /v-for="ref in v\.box"/.test(d));
  ok("★★★ 反向：正文**不再**直出带占位符的原文", !/\{\{ r\.raw\.description \}\}/.test(d) && !/\{\{ u\.effect \}\}/.test(d));
}

sec("[5] ★★★ 反向：认不出的占位符**不许静默吞掉**（原样留在正文里，并记进 unknown）");
{
  const r = resolveRefs("造成伤害[tips_9999]并施加[buff_not_exist]。", TABLES);
  ok("★★★ 认不出的原样显示（正文里看得见）", r.text.includes("[tips_9999]") && r.text.includes("[buff_not_exist]"), r.text);
  ok("★★★ 而且记进了 unknown（谁都能复核）", r.unknown.length === 2, JSON.stringify(r.unknown));
  ok("★★ 单字名不参与「按名命中」（否则「火」这种名字会把满篇正文都命中）",
    collectSkillRefs(["这里提到火这个字"], { tips: [], buffs: [{ id: "x", name: "火", desc: "" }] }).buffs.length === 0);
}

console.log("\nui22-skill-refbox: " + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
