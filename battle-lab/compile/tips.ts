// compile/tips.ts — ★★★ [tips_N] 占位符解析（第 71 轮）
//
// 由来（第 69 轮的教训）：我按"子句里有没有 若/概率/层"筛"无条件被动"，筛出 30 条，
// 结果第一条就是错的 —— 铁鼠「横财护身」写的是「有40%[tips_2]为攻击者附加…」，
// **"概率"两个字被写成了 [tips_2]**，过滤器看不见它，于是 40% 变成了 100%。
// 那一轮我只能从上下文反推 tips_2 = 概率，并在 triggers.ts 里写下一条硬规则：
// 「含未解析占位符的子句一律不得当作无条件可执行」。
//
// ★★ 第 71 轮查数据时发现：**这些占位符根本不是不透明的** ——
//    `data/kb/tips.json` 里躺着 **122 条** {id, name, desc}：
//      tips_2   「基础概率」此概率受到效果命中属性影响
//      tips_20  「恢复」区别于治疗，不受减疗效果影响，不触发治疗相关效果，不会暴击
//      tips_108 「眩晕」无法被驱散，无法动作
//      tips_7   「先机」在战斗开始时进行动作
//    …也就是说，此前把它们当成噪声，是**没读数据**，不是数据不存在。
//
// 实测：被动技能文案里出现的占位符 **205 次，全部解析成功，0 次落空**。
// 解析之后"含占位符"这一档直接归零（18 → 0），而干净候选从 16 涨到 **23**。
export interface TipEntry { id: string; name: string; desc: string }

/** 解析结果：替换后的文本 + 命中/落空的 id（落空必须报出来，不许静默留着） */
export interface TipResolution { text: string; hit: string[]; miss: string[] }

/**
 * 把 `[tips_N]` 换成它的**规范名**（数据里写着的那个名字）。
 * ★ 只换名字、不换整段 desc：名字是"这个词是什么"，desc 是"它的完整规则" ——
 *   把整段 desc 塞进技能文案会把句子结构冲掉，让下游解析器更难判。
 * ★ 落空的 id **原样保留**并记进 miss —— 与 compile/unmodeled.ts 同一条原则：绝不静默丢弃。
 */
export function resolveTips(text: string, tips: Map<string, TipEntry>): TipResolution {
  const hit: string[] = [], miss: string[] = [];
  const out = String(text ?? "").replace(/\[tips_(\d+)\]/g, (m, id: string) => {
    const t = tips.get(String(id));
    if (!t) { miss.push(String(id)); return m; }
    hit.push(String(id));
    return "[" + t.name + "]";
  });
  return { text: out, hit, miss };
}

/**
 * ★★★ 第 194 轮：**只把名字满足条件的占位符换回规范名**（换的判据由调用方给，本函数不猜）。
 *
 * 由来：效果侧读概率时用的是**原文**，而 KB 里 97 处概率写成 `有30%[tips_2]附加…`
 *   （`%` 与「概率」之间夹着一个占位符）—— 于是那个 30% **一处都没被读进来**，
 *   状态按"原文没写概率 = 必定"施加。实测（tools/_probe-jiaotu194.ts）：
 *   椒图「水花弹」原文 30%，80 次施放命中 80 次。
 * ★ 为什么不直接用 resolveTips 把**全部**占位符换掉：那会把伤害/护盾/控制那些占位符也换成名字
 *   （`造成攻击100%[伤害]`），而伤害类提取器读的是原文的写法。**只换读这件事需要的那一类**，
 *   剩下的一个字都不动（与"最小改动"同一条纪律）。
 */
export function resolveTipsMatching(text: string, tips: Map<string, TipEntry>, pred: (t: TipEntry) => boolean): string {
  return String(text ?? "").replace(/\[tips_(\d+)\]/g, (m, id: string) => {
    const t = tips.get(String(id));
    return t && pred(t) ? "[" + t.name + "]" : m;
  });
}

/** 从 KB 读占位符表。map 的键是**数字字符串**（与 [tips_N] 的 N 对齐）。 */
export function loadTips(tipsJson: any[]): Map<string, TipEntry> {
  return new Map(tipsJson.map(t => [String(t.id), { id: String(t.id), name: String(t.name ?? ""), desc: String(t.desc ?? "") }]));
}

/**
 * ★★★ 第 101 轮：**模块级 tips 表**（带懒加载兜底）。
 *
 * 为什么需要它：第 101 轮要让编译器从 `[tips_N]` 认出"姿态/化身"类放置单位，
 * 而 `compileSkill` 此前**只拿到 id**（tipRefs），拿不到 desc。三条路都试过一遍：
 *   · 加第 4 个参数 → 调用方有 4 处（web 装配 / 编译普查 / 测试），**漏一处就静默少解析**；
 *   · 让运行时去查表 → `buildCharacter` 拿不到 kit，还要改签名与全部调用方；
 *   · 模块级单例 + **懒加载兜底** → 生产、普查、测试**读到的是同一张表**，行为按构造一致。
 * ⇒ 选第三条。兜底会按仓库布局自己去读 `data/kb/tips.json`：读不到就是空表，
 *   而 `tests/g62-form-summon.ts` 一条断言盯住"表非空"（静默空表会当场变红）。
 */
let TIPS_SINGLETON: Map<string, TipEntry> = new Map();
export function setTipsTable(m: Map<string, TipEntry> | null): void { TIPS_SINGLETON = m ?? new Map(); }
/**
 * ★★ 表由**入口显式设置**（装配 / 编译普查 / 测试各一次），而不是这里自己去读文件。
 *   第一版写了"懒加载读 data/kb/tips.json"的兜底，两个代价都不小：
 *     · `compile/tips.ts` 因此 import 了 `node:fs`，而**网页侧的 vue-tsc 没有 node 类型** ⇒ ui12 当场红；
 *     · "没设置就静默空表"会让形态解析**悄悄不发生**（正是本项目最忌讳的静默失效）。
 *   现在：没设置就是空表，而 `tests/g62-form-summon.ts` 有一条断言盯住"表非空"——
 *   漏设置会立刻变红，而不是安静地少解析两条形态。
 */
export function tipsTable(): Map<string, TipEntry> { return TIPS_SINGLETON; }
// ★ 不导出"是否已设置"这种只给测试用的谓词：接线审计会把它记成"没有生产调用方"（第 101 轮实测）。
//   表非空的断言直接用 tipsTable().size（见 tests/g62-form-summon.ts 的第一条）。
