// compile/buff-names.ts — ★★★ 第 186 轮：**状态/印记的「名字表」**（名字形态的引用要用它）
//
// 由来：正文里有些状态引用写的是**名字**而不是方括号 id ——
//   「增加1层**雄姿英发**并增加自身5%行动条」（大天狗）·「为敌方目标施加3层**结怨**」（聆海金鱼姬）·
//   「言灵增加1层**墨灵**」（言灵）。编译器只认 \`[buff_x]\` 形态，于是这些效果**整个漏收**：
//   言灵那条就是靠隔壁鬼火子句的 2 层凑出来的（第 179 轮 §151.3 记过）。
//
// 名字 → id 的映射**本来就在数据里**（data/kb/buffs.json 的 name 字段），只是此前没人读。
//
// ★ 与 compile/tips.ts 同一条纪律：**这个文件不 import node:fs**（网页侧的 vue-tsc 没有 node 类型，
//   第 101 轮 ui12 当场红过）。表由**入口显式设置**：node 侧读 data/kb/buffs.json、
//   浏览器侧从预打包的 EngineBundle 里取 —— 两处设的是同一份数据。
export interface BuffNameEntry { id: string; name: string }

let BUFF_NAMES: Map<string, string[]> = new Map();

/** 入口显式设置（装配 / 编译普查 / 测试各一次）。不设置就是空表 ⇒ 名字形态**不解析**（fail-closed）。 */
export function setBuffNames(m: Map<string, string[]> | null): void { BUFF_NAMES = m ?? new Map(); }

/** 名字 → id 列表。**一个名字对多个 id 时不猜** —— 由调用方按 fail-closed 拒绝。 */
export function buffNames(): Map<string, string[]> { return BUFF_NAMES; }

export function loadBuffNames(buffsJson: any[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const b of buffsJson ?? []) {
    const name = String(b?.name ?? ""), id = String(b?.id ?? "");
    if (!name || !id) continue;
    if (!m.has(name)) m.set(name, []);
    m.get(name)!.push(id);
  }
  return m;
}
