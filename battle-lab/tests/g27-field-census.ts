// tests/g27-field-census.ts — ★ 字段普查解析器自检（第 33 轮）
//
// 由来：这个解析器**自己错过一次**。它按行扫接口正文，于是
//   `id: string; name: string; category: StatusCategory;`
// 这种一行多字段只认得出第一个 —— StatusDef 13 个字段只普查到 6 个，
// 却报「0 个未接线」。当时只有真实数据能纠正它，而真实数据只能说
// 「结果不对」，说不出「哪条规则失效」。
//
// 第 33 轮把核心抽成不碰文件系统的纯函数 `censusContracts()`，于是可以造 fixture
// 精确压每一条规则。抽取过程本身又踩了一个坑，见 [2] —— 那个坑是
// 「重构前后数字对比」抓到的（从未被读 23 → 7），这里写成断言防止再犯。
//
// 判定标准（与工具一致）：某契约字段在**全部生产代码**里 0 次读取 → 从未被读。
// 「读取」= 成员访问 `.field` 或真正的裸引用；写入/键名/类型层引用/注释都不算。
import fs from "node:fs";
import path from "node:path";
import { censusContracts, realCensusInput, prodFilesOf, splitMembers, stripComments } from "../tools/field-census.ts";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ " + n + (e ? "  — " + e : "")); } };
const sec = (s: string) => console.log("\n" + s);

type Row = ReturnType<typeof censusContracts>[number];
/** 只声明、从没人读的字段名 */
const dead = (rows: Row[]) => rows.filter(r => r.dots + r.bares === 0).map(r => r.name);
const one = (contractSrc: string, prodSrc: string, kind: "decl" | "enum" = "decl", names = ["Probe"]) =>
  censusContracts({
    contractFiles: [{ path: "bl/probe.ts", src: contractSrc }],
    specs: [{ file: "bl/probe.ts", names, kind }],
    prodFiles: [{ path: "bl/use.ts", src: prodSrc }],
  });
const names = (rows: Row[]) => rows.map(r => r.name).join(",");

sec("[1] ★★ 一行多字段必须全部认出来（第 23 轮的原错）");
{
  const r1 = one("export interface Probe { id: string; name: string; category: string; }\n", "");
  ok("★★ 单行三个字段全部普查到（不是只认出第一个）", r1.length === 3, names(r1));
  ok("★ 三个字段都判为「从没人读」", dead(r1).length === 3, JSON.stringify(dead(r1)));
  const r2 = one("export interface Probe {\n  a: number;\n  b: string;\n  c: boolean;\n}\n", "");
  ok("★ 多行写法同样全部认出", names(r2) === "a,b,c", names(r2));
  const r3 = one("export interface Probe { a: { x: number; y: number }; b: string; }\n", "");
  ok("★ 嵌套对象类型不把内部字段当顶层字段", names(r3) === "a,b", names(r3));
  const r4 = one("export interface Probe { a: number; run(x: number): void; b(): string }\n", "");
  ok("★ 方法声明不算字段", names(r4) === "a", names(r4));
  const r5 = one("export interface Probe {\n  /**\n   * 说明\n   */\n  a: number;\n}\n", "");
  ok("★ 成员前的多行 JSDoc 不影响字段识别", dead(r5).join(",") === "a", JSON.stringify(dead(r5)));
  // ★ 发现（第 33 轮）：契约文件是**先 stripComments 再解析**的，块注释里的换行被一并删掉，
  //   于是 field.line 是「剥注释后文本」的行号，不是原文行号（上面原文第 5 行 → 报 3）。
  //   今天没有任何地方打印它；真正要命的是两侧必须用**同一套**行号 —— 见 [2] 末尾的断言。
  ok("★ field.line 是剥注释后的行号，不是原文行号（记录为已知语义）", r5[0].line === 3, String(r5[0].line));
}

sec("[2] ★★ 声明行不算读 —— 而且这件事只在**可选字段**上看得出来（第 33 轮的坑）");
{
  // 真实代码库里契约文件本身就在生产文件集合里，所以「声明那行」必须被排除。
  const pair = (contractPath: string, prodPath: string, field: string) => censusContracts({
    contractFiles: [{ path: contractPath, src: "export interface Probe { " + field + " }\n" }],
    specs: [{ file: contractPath, names: ["Probe"], kind: "decl" }],
    prodFiles: [{ path: prodPath, src: "export interface Probe { " + field + " }\n" }],
  });
  const OPT = "only?: number;";
  ok("★★ 路径一致 + 可选字段 → 判为从未被读（声明行被正确排除）",
    dead(pair("bl/probe.ts", "bl/probe.ts", OPT)).join(",") === "only", JSON.stringify(pair("bl/probe.ts", "bl/probe.ts", OPT).map(r => [r.dots, r.bares, r.writes])));
  ok("★★ 路径形式不一致 → 同一个字段被**误判为已接线**（这就是 23 → 7 的机制）",
    !dead(pair("probe.ts", "bl/probe.ts", OPT)).includes("only"), JSON.stringify(pair("probe.ts", "bl/probe.ts", OPT).map(r => [r.dots, r.bares, r.writes])));
  // 为什么隐蔽：必填字段的声明行会被当成一次「写入」，于是两条路径给出同样的结论，
  // 错误只在可选字段（`?:`）上显形 —— 而 StatusDef/SkillIR 里恰恰大量是可选字段。
  ok("★ 必填字段：路径不一致也仍判未读 —— 所以这个错**不报错、只是静默弱化**",
    dead(pair("probe.ts", "bl/probe.ts", "only: number;")).join(",") === "only",
    JSON.stringify(pair("probe.ts", "bl/probe.ts", "only: number;").map(r => [r.dots, r.bares, r.writes])));
  ok("★ 对照：真的读了就不算未读", !dead(one("export interface Probe { only?: number; }\n", "const x = e.only;\n")).includes("only"));
  // ★★ 多行注释会改变行号（块注释里的换行被删掉）。契约侧与生产侧必须一起偏移才对齐；
  //    如果哪天有人只给一侧改成「保留原行号」，这条会立刻变红。
  const SRC = "export interface Probe {\n  /**\n   * 多行说明\n   */\n  a?: number;\n}\n";
  const both = censusContracts({
    contractFiles: [{ path: "bl/probe.ts", src: SRC }],
    specs: [{ file: "bl/probe.ts", names: ["Probe"], kind: "decl" }],
    prodFiles: [{ path: "bl/probe.ts", src: SRC }],
  });
  ok("★★ 声明前有多行注释时声明行仍被排除（两侧行号一起偏移才对齐）", dead(both).join(",") === "a", JSON.stringify(both.map(r => [r.dots, r.bares, r.writes, r.line])));
}

sec("[3] ★★ 三种「看着像读、其实是写/无关」的形态");
{
  const C = "export interface Probe { tipRefs: number[]; }\n";
  ok("★ 多行简写属性列表（单独成行 tipRefs,）算写不算读",
    dead(one(C, "const o = {\n  a,\n  tipRefs,\n};\n")).includes("tipRefs"));
  ok("★ 容器自改 tipRefs.push(x) 算写不算读",
    dead(one(C, "tipRefs.push(1);\n")).includes("tipRefs"));
  ok("★ 类型层引用 Probe[\"tipRefs\"] 不算运行期读",
    dead(one(C, "type T = Probe[\"tipRefs\"];\n")).includes("tipRefs"));
  ok("★ 注释里提到字段名不算读",
    dead(one(C, "// 以后要读 tipRefs\nconst z = 1;\n")).includes("tipRefs"));
  ok("★ 块注释同理", dead(one(C, "/* tipRefs */\nconst z = 1;\n")).includes("tipRefs"));
  ok("★ 对照：真的读了就不算未读",
    !dead(one(C, "for (const v of x.tipRefs) use(v);\n")).includes("tipRefs"));
  // ↓ 诚实记录已知局限：简写规则要求「简写列表独占一行」，同行还有别的内容就认不出。
  //   第 33 轮实测：真实代码库里**没有任何字段**的判定依赖这条，
  //   所以它目前只是理论盲点。若哪天有字段只剩这种证据，这里必须改成 span 解析。
  const inline = one(C, "const o = { a, tipRefs };\n");
  ok("★ 已知局限：同一行的简写 { a, tipRefs } 仍被当成读（目前不影响任何字段判定）",
    !dead(inline).includes("tipRefs"), JSON.stringify(inline.map(r => [r.name, r.dots, r.bares])));
}

sec("[4] 枚举成员：同一套标准（成员没被引用 = 死分支）");
{
  const E = "export const Probe = {\n  A: \"A\", B: \"B\", C: \"C\",\n} as const;\n";
  ok("★ 一行三个成员全部认出", names(one(E, "", "enum")) === "A,B,C", names(one(E, "", "enum")));
  const r = one(E, "if (x === Probe.A) doIt();\n", "enum");
  ok("★ 被引用的成员不算未读，没被引用的算", dead(r).join(",") === "B,C", JSON.stringify(dead(r)));
}

sec("[5] 解析原语");
{
  ok("splitMembers 按顶层分隔符切", splitMembers("a: number; b: string,\nc: boolean").length === 3);
  ok("splitMembers 不切嵌套里的分隔符", splitMembers("a: { x: number; y: number }; b: string").length === 2,
    JSON.stringify(splitMembers("a: { x: number; y: number }; b: string").map(m => m.text.trim())));
  const s = stripComments("// f()\n/* g() */\nconst a = 1;");
  ok("stripComments 去掉行注释与块注释", !s.includes("f()") && !s.includes("g()"), JSON.stringify(s));
  ok("stripComments 不误伤 URL", stripComments('const u = "https://x/y";').includes("https://x/y"));
}

sec("[6] ★★ 真实代码库：数字必须与重构前一致，且没有新增缺口");
{
  const root = path.resolve(import.meta.dirname, "..", "..");
  const rows = censusContracts(realCensusInput(root));
  const never = rows.filter(r => r.dots + r.bares === 0);
  console.log("    契约字段 " + rows.length + "｜有读取方 " + (rows.length - never.length) + "｜从未被读 " + never.length);
  //   167 → 168：第 67 轮给 SkillIR 加了 revive（主动复活），它是一个**真的被读**的字段
  //   （compile/character.ts 用它取复活范围），所以「从未被读」的数量没有跟着变。
  //   168 → 169：第 70 轮给 BattlePolicies 加了红区 E 的 passives（被动执行策略），
  //   它**真的被读**（assemble.ts 与 passive-runtime.ts 都读它），所以「从未被读」仍是 22。
  //   169 → **170**：第 76 轮给 SkillIR 加了 statusStacks（状态层数）。
  //   它**真的被读**（compile/character.ts 用 stacksOf 取层数并传给 addStatus），
  //   所以「从未被读」仍然是 21 —— 新字段是接好线才进来的，不是先加字段再找用途。
  //   170 → **173**：第 78 轮加了三个 —— SkillIR.statusCaps（层数上限）、
  //   SkillIR.statusCapSkips（归属有歧义时不猜的记录）、ActiveStatus.cap（记在状态上，
  //   进核心状态所以进指纹）。前两个分别被 character.ts 的 capOf 与 g46 读取；
  //   ActiveStatus.cap 被 addStatus 读。**「从未被读」仍是 21** —— 三个都是接线后才进来的。
  //   173 → **174**：第 80 轮给 SkillIR 加了 shieldSkips（不是护盾的写法如实记下来）。
  //   它被 g47 与 compile-census 读；**「从未被读」仍是 21** —— 同样是接线后才进来的。
  //   174 → **177**：第 91 轮把 SOUL_START / PASSIVE_START / DEATH_PREVENTION 补进 EV 表
  //   （它们**一直在被派发**，只是写成了裸字符串，于是按 EV 表枚举的扫描全都看不见）。
  //   三个都**真的被读**（dispatch 处已改成 EV.*），所以「从未被读」仍是 21。
  //   177 → **180**：第 93 轮接线「吸血」时进来的三个字段 ——
  //     · SkillIR.lifesteal（读 16｜写 7）：compile/character.ts 把它交给伤害管线，
  //       compile/passive-runtime.ts 用它给「造成伤害时」的被动做回流；
  //     · DamageInput.lifesteal（同名，另一个接口）：kernel/damage.ts 的 applyLifesteal 读它；
  //     · SkillIR.lifestealSkips（读 1｜写 3）：**两次假命中与三次分支跳过**的记账，
  //       被 compile-census 的解释链与 tests/g54 读取。
  //   三个都真的被读，所以「从未被读」仍是 21 —— 与第 78/80/91 轮同一模式。
  //   180 → **185**：第 94 轮接线「状态自带的免疫/免死/禁复活」时进来的五个字段 ——
  //     · StatusDef.immuneTo（读 5｜写 5）：状态自带免疫什么（buff 解析写、施加闸门读）；
  //     · StatusDef.consumeOnImmune（读 6｜写 3）：免疫一次消耗一层；
  //     · StatusDef.blocksRevive：维护 Entity.reviveBlocked；
  //     · StatusDef.preventsLethal：免死（FULL/ONE）；
  //     · BattlePolicies.immune：红区 G 的口径快照。
  //   187 → **188**：第 97 轮红区 H 进来一个字段 —— BattlePolicies.resist（读 8｜写 3，
  //   compile/character.ts 的判定读它、kernel/policies.ts 写它）。同轮 EV.RESIST 也离开「从未被读」
  //   （20 → **19**），所以 allowlist 里那一条也必须删掉（下面有同型断言）。
  //   （185 → 187 是第 95 轮：反击 + 逐句触发路由时进来的两个字段）
  //     · SkillIR.counter（读 10｜写 3）：解析出的反击（比例与依据）；
  //     · SkillIR.counterSkips：两类假命中（抑制句 / 定语用法）的记账。
  //   ★ 同轮加的 TriggerFamily.side / requiresCrit **不在**这张表里（kernel/triggers.ts 不是本工具扫描的契约文件）——
  //     它们由 tests/g42 的机械检查守着（名字以 受到/被 开头的族必须标 TARGET）。
  /**
   * ★★★ 第 99 轮：188 → **191**（属性偷取这一轮新增三个契约字段）：
   *   · `BattlePolicies.steal` —— 口径（默认「量的转移」，有 KB 证据；备选不守恒口径用于对照）；
   *   · `SkillIR.steals` / `SkillIR.stealSkips` —— 编译侧的可执行偷取与"读不出来所以不执行"的记录。
   * ★ 而**从未被读的数量停在 18**：三个新字段都有读取方（steal.ts 读 policy、character.ts 读 steals、
   *   skill-compiler 读 stealSkips 去重）。**新字段如果不给它读者，这里会立刻 +3** —— 这正是这条断言的作用。
   */
  /**
   * ★★★ 第 100 轮：191 → **192**。新增的一个是 `StatusDef.banish`（放逐这一类放逐/免疫放逐的载体）。
   * ★ 从未被读仍是 18：banish 在 `incomingKinds` 里被读（放逐要能单独算一类，见 kernel/status.ts）。
   */
  /**
   * ★★★ 第 101 轮：192 → **194**（`SkillIR.forms` / `SkillIR.formSkips` 各 +1）。
   * ★ 从未被读仍是 18：forms 被 character.ts 读（施放入场）与 battle.ts（形态回归用 notes 里的关系）。
   */
  /**
   * ★★★ 第 102 轮：194 → **195**（`SkillIR.formSkillOf`：这个技能属于哪个形态）。
   * ★ 从未被读仍是 18：formSkillOf 在 kernel/summon.ts 的 enterForm 里被读（挑出形态的技能表）。
   */
  //   ★★★ 第 122 轮：196 → **197**。新增 `Entity.eventSink` —— 状态 / 护盾生产点同步上报事实的入口
  //     （`addStatus` / `addShield` 是同步方法，不能 await dispatch；见 kernel/entity.ts 的注释）。
  //     它是**被读的**（battle.ts 的 installEntitySinks 会赋值、entity.ts 会调用），所以不进未读名单。
  //   ★★★ 第 129 轮：197 → **198**。新增 `SkillIR.selfRevive`（触发式自复活：阵亡时…立即复活）。
  //     它是**被读的**（compile/passive-runtime.ts 读它决定执行哪一个动作、编译器读它过滤未建模记录），
  //     所以"从未被读"仍是 12 —— 与第 78/80/91/99/115/122 轮同一条模式：**接线后才进来的字段**。
  //   ★★★ 第 130 轮：198 → **200**。两个新契约字段，**两个都有读取方**（所以未读名单仍是 12）：
  //     · `SkillIR.noHeal`（「无法被治疗或恢复生命」，KB 全库 1 条）—— 编译器写它、compile/character.ts 的
  //       applyIrCapabilities 读它；
  //     · `EntityCapabilities.receivesHeal` —— 装配时按 IR 置位，kernel/damage.ts 的 healTarget 读它（治疗唯一入口）。
  //     ★ 同一轮还修了一件事：这个新键**取默认值时不写进 state**（否则典型对局指纹会因"形状变化"全漂，
  //       25 个测试文件各红一条 —— 见 kernel/state.ts 的 capsForState 注）。
  //   ★★★ 第 131 轮：200 → **201**。新增 `SkillIR.allyGuard`（替友方拦截致命伤，KB 全库 1 条）——
  //     编译器写它，kernel/ally-guard.ts 的 guardApplies / installAllyGuards 读它 ⇒ 同样进"有读取方"。
  //   ★★★ 第 135 轮：201 → **202**。新增 `SkillIR.subCasts`（触发式追加施放）——
  //     编译器写它、compile/passive-runtime.ts 与 kernel/sub-cast.ts 读它 ⇒ 进"有读取方"。
  //   ★★★ 第 136 轮：202 → **203**。新增 `SkillIR.orbGaugeAdvance`（额外推进鬼火行动条）——
  //     编译器写它、compile/character.ts 与 compile/passive-runtime.ts 读它 ⇒ 进"有读取方"。
  //   ★★★ 第 140 轮：203 → **205**。新增 `SkillIR.layerField` 与 `SkillIR.grantLayers`（花海的六条判据）。
  //     两者都进"有读取方"：kernel/layer-field.ts 读它（虽然执行点还没接，见 §124）。
  //   ★★★ 第 176 轮：205 → **206**。新增 `SkillIR.sourceBearerRefs`（逐句承受者归属：哪条子句点名了"伤害来源"）。
  //     它进"有读取方"：compile/character.ts 的状态施加循环读它（把承受者换成事件来源）。
  //   ★★★ 第 180 轮：206 → **207**。新增 `SkillIR.statusRefClauses`（状态引用的逐句证据 —— 逐句效果归因的第一步）。
  //     它进"有读取方"：tests/g103-status-attribution.ts 逐条读它（运行时按它收窄是下一轮）。
  //   ★★★ 第 181 轮：207 → **208**。新增 `SkillIR.statusRefConditionOnly`（只当条件的槽位 —— 触发时不施加它们）。
  //   ★★★ 第 183 轮：208 → **210**。新增 `SkillIR.damageSkips`（被拒的假阳性伤害：引用式写法「等同于伤害N%」）与
  //     `SkillIR.damageBaseMismatch`（子句写「生命上限N%」而产物记 base=atk 的记账 —— 只记不改）。
  //   ★★★ 第 184 轮：210 → **211**。新增 `SkillIR.healBaseMismatch`（治疗量的基数不一致：攻击类 / 动态量类）。
  //   ★★★ 第 186 轮：211 → **212**。新增 `SkillIR.statusRefNameForm`（名字形态的状态引用 —— 只记账）。
  //   ★★★ 第 188 轮：212 → **213**。新增 `SkillIR.effectClauses`（逐句效果归因的第二批：damage/heal/shield/timeline
  //     四个字段各自的逐句证据）。它进"有读取方"：compile/passive-runtime.ts 读它并把 onlyEffectSlots 传给 execute。
  //     ★ 同一轮 `damageSkips` 多了一个理由码（PROBABILITY_NOT_DAMAGE）—— **不新增字段**，所以总数只 +1。
  //   ★★★ 第 194 轮：213 → **215**。新增 `SkillIR.randomStatuses`（「随机增益/随机减益」池子）与
  //     `SkillIR.randomStatusSkips`（认出来但没落地的写法，逐条写原因）。两个都进"有读取方"：
  //     compile/passive-runtime.ts 读 randomStatuses 算 onlyPoolSlots 并传给 execute；compile/character.ts 读它执行；
  //     tests/g114-random-pool.ts 两条都读（产物 + 理由码双向）。
  //   ★★★ 第 195 轮：215 → **217**。新增 `SkillIR.controlRefs`（占位符形态的控制效果：`[tips_101]`=冰冻 …，
  //     全库 45 条）与 `SkillIR.controlSkips`（认出来但按理由挡下的 34 条，六类理由码）。
  //     两个都进"有读取方"：compile/passive-runtime.ts 读 controlRefs 算 onlyControlSlots 并传给 execute；
  //     compile/character.ts 读它执行；tests/g115-control-tips.ts 两条都读（产物 + 理由码 + 端到端）。
  //   ★★★ 第 252 轮：224 → **225**。新增 `SkillIR.damageSegments`（分段伤害形状：一次施放里的两段各有范围与次数）——
  //     它进"有读取方"：compile/character.ts 的伤害执行按段展开（`x.damageSegments`），compile/skill-compiler.ts 写它；
  //     尺子 tests/g129-damage-segments.ts（46 条）。
  //   ★★★ 第 253 轮：225 → **226**。新增 `SkillIR.damageTypeCollisions`（同一比例两种伤害语义的合并记录）——
  //     编译器写它（skill-compiler.ts 的合并闸门），尺子 tests/g130-damage-type.ts。
  //   ★★★ 第 255 轮：226 → **227**。新增 `SkillIR.selfHpLoss`（失血：失去最大生命 N%，官方[21] 不是伤害）——
  //     它进"有读取方"：compile/character.ts 的施放路径读它并调 `battle.lose`；尺子 tests/g131-self-hp-loss.ts（22 条）。
  //   ★★★ 227 → **228**: new `BattlePolicies.endgame` (betting anti-stall referee rounds + turn-cap verdict) ——
  //     read by kernel/environment.ts (envRefereeAfterTurn / timeoutVerdict) and kernel/state.ts; ruler tests/g133-betting-rules.ts.
  ok("★★ 字段总数 228（BattlePolicies.endgame +1；第 129 轮 selfRevive +1；第 130 轮 noHeal/receivesHeal +2；第 131 轮 allyGuard +1；第 135 轮 subCasts +1；第 136 轮 orbGaugeAdvance +1；第 140 轮 layerField/grantLayers +2；第 176 轮 sourceBearerRefs +1；第 180 轮 statusRefClauses +1；第 181 轮 statusRefConditionOnly +1；**第 183 轮 damageSkips/damageBaseMismatch +2；**第 184 轮 healBaseMismatch +1；**第 186 轮 statusRefNameForm +1；**第 188 轮 effectClauses +1；**第 194 轮 randomStatuses + randomStatusSkips +2；第 195 轮 controlRefs + controlSkips +2；第 199 轮 purgeSkips +1；第 239 轮 counterCast +1；**第 245 轮 drunk +1；**第 246 轮 endOnLose +1；**第 248 轮 castGate +1；**第 249 轮 overflowShield +1；**第 251 轮 damageBranch +1**（狸猫「醉倒」））", rows.length === 228, String(rows.length));
  //   23 → 21：VICTORY_CHECK 因为真的被派发了而离开名单（真接线）；
  //            EV.HIT 则因为与 a1-4 §31 的 ResolutionScope 名 "HIT" 字符串同名，被判成「有读取方」——
  //            这是**假已接线**，所以它必须留在 allowlist 的 knownGaps 里（见下面最后一条断言）。
  //   ★★ 第 68 轮：21 → **22**。这不是"多了个缺口"，是工具**变准了** ——
  //   读取方的扫描集合从 prodFilesOf 换成 producerScanFiles（排除声明文件）。
  //   起因：新建的 kernel/triggers.ts（触发时机登记册）把事件码当**字符串数据**写在表里，
  //   而旧的扫描把"字符串出现"也算作读取，于是 never 反而从 21 掉到 18 —— 声明表在冒充读取方。
  //   与第 23 轮那次 "HIT 同名污染"（把 §31 的 ResolutionScope 名当成事件码被读）是同一类假读取。
  //   ★ 第 74 轮：22 → **21**。少掉的那一个是 `EV.SKILL_START` —— 它此前"从未被引用"，
  //   因为确实**没有派发点**；这一轮在 kernel/battle.ts 补上了派发，于是它变成被读取的。
  //   方向是好的，所以这里跟着改，而不是把它塞进允许名单里假装没变。
  //   ★★★ 第 94 轮：21 → **20**。少掉的那一个是 `EV.IMMUNE` ——
  //   它此前是 knownGaps 里的「免疫事件从未派发」，这一轮真的有了两个派发点
  //   （compile/character.ts 的状态闸门 + kernel/damage.ts 的伤害免疫）。
  //   ★ 与第 74 轮的 SKILL_START、VICTORY_CHECK 完全同一模式：**真接线**才允许离开名单。
  //   所以 allowlist 里的 IMMUNE 条目也必须一起删（下面那条断言盯着 knownGaps 不许留已完成的）。
  /**
   * ★★★ 第 98 轮：19 → **18**。少掉的那一个是 `Team.summonSlots` ——
   *   它此前只有声明与序列化，没有任何读取方；这一轮 `Battle.addSummon` 的占位检查真的读它。
   *
   * ★★ 同一轮里 `caps.occupiesSummonSlot` 也离开了"从未被读"名单，
   *   但**这次改动是它自己争取来的**：占位检查从 `summons.length` 改成
   *   `summons.filter(s => s.alive && s.caps.occupiesSummonSlot).length` ——
   *   因为"只有写入方的字段"会被普查按**出现次数**豁免（写也算出现），缺口就此藏起来。
   *   ⇒ 治好它的办法不是改数字，而是**给它一个真读者**。
   */
  /**
   * ★★★ 第 120 轮：18 → **16**。少掉的两个是 `EV.ORB_COST` 与 `EV.ORB_OVERFLOW` ——
   *   它们此前**连字符串形式都不存在**（别的码还有 `t: "HEAL"` 这种标签兜着，这两个连标签都没有），
   *   这一轮接进事件总线后第一次被按名字引用（compile/character.ts 的两条 queueEvent）。
   *   判据：全库只有它们两个的**唯一** `EV.*` 引用落在本轮新增的 queueEvent 行上。
   */
  //   ★★★ 第 122 轮：16 → **12**。少掉的四个是 `EV.SHIELD_CREATE` / `EV.SHIELD_DAMAGE` /
  //     `EV.SHIELD_BREAK` / `EV.TRANSFORM` —— 它们此前连字符串形式都没有（护盾只写在 absorbed 字段与
  //     notes 里、变形只有 trace 的 FORM_ENTER），这一轮按规格名进了事件总线。
  // levelScale now has a reader: compile/max-level.ts (max-skill-level upgrades, SKILL_LEVEL=MAX) ⇒ 12 → 11.
  ok("★★ 从未被读的数量 11（第 120 轮 ORB_COST/OVERFLOW；第 122 轮 SHIELD_* 与 TRANSFORM 各 -1；levelScale 有了读者 -1）", never.length === 11, String(never.length));
  ok("★ 确实扫到了字段（不是 0 而显得干净）", rows.length > 100, String(rows.length));
  /**
   * ★★★ 第 98 轮：7 → **6**。`occupiesSummonSlot` 离开名单（召唤位检查现在真的读它，见上）。
   *   保留这一条回归锁的意义正是"每离开一个都要有理由"：剩下的 6 个仍然只有声明与序列化。
   */
  // levelScale left the list: compile/max-level.ts reads it (6 → 5).
  const gaps = ["persistsAcrossRound", "seedLabel", "tipRefs", "probabilities", "durations"];
  const got = gaps.filter(g => never.some(n => n.name === g));
  ok("★ 第 23 轮抓出的未完成字段仍在名单里（6 → 5：levelScale 有了真读者 compile/max-level.ts）", got.length === 5, JSON.stringify(got));
  ok("★★ 反向：levelScale 确实**已经不在**未读名单里", !never.some(n => n.name === "levelScale"));
  ok("★★ 反向：occupiesSummonSlot 确实**已经不在**未读名单里（否则上一条会静默变成 7 分之 6）",
    !never.some(n => n.name === "occupiesSummonSlot"));
  const enumDead = never.filter(n => n.kind === "enum").map(n => n.name);
  //   ★★ 14 → **15**：同样是因为"声明表不再冒充读取方"。新增进来的那一个是真实状态：
  //   它与 tests/g42-trigger-registry.ts 独立量出的"25 个事件码没有派发点"互相印证 ——
  //   两个检查器从不同角度得到同一个结论，这比任何一处单独的数字都可靠。
  //   ★ 第 74 轮：15 → **14**（SKILL_START 退出了这份名单）。
  //   剩下的 14 个与 tests/g42 独立量出的「24 个事件码没有派发点」互相印证 ——
  //   两边不是同一个数（g42 数的是 EV 表里的全部事件码，这里数的是"契约字段里的枚举成员"），
  //   但**重合方向一致**：都是"声明了、没人用"。
  //   ★★★ 第 94 轮：14 → **13**（IMMUNE 退出了这份名单 —— 它现在有两个派发点）。
  //   剩下的 13 个与 tests/g42 独立量出的「**23** 个事件码没有派发点」互相印证：
  //   两边不是同一个数（g42 数的是 EV 表里的全部事件码，这里数的是"契约字段里的枚举成员"），
  //   但**重合方向一致**：都是「声明了、没人用」。两个检查器各自独立得出同一个方向，比任一处单独的数字可靠。
  //   ★★★ 第 97 轮：13 → **12**（RESIST 退出了这份名单 —— 它现在有派发点）。
  //   剩下的 12 个与 tests/g42 独立量出的「**22** 个事件码没有派发点」互相印证。
  //   ★★★ 第 120 轮：12 → **10**。事件总线接线让 2 个枚举成员第一次被按名字引用（见上一条的判据）。
  //   剩下的 10 个与 tests/g42 独立量出的「**12** 个事件码没有派发点」互相印证：
  //   两边不是同一个数（这里数的是**契约里的枚举成员**，含 Phase.PRE_BATTLE 这类同名项；
  //   g42 数的是 EV 表全体），但方向一致 —— 都是「声明了、没人用」。
  //   ★★★ 第 122 轮：10 → **6**。事件总线接线让 4 个枚举成员第一次被按名字引用。
  //   剩下的 6 个恰好是 field-allowlist 里写明「按设计不派发」的那几个（BATTLE_CREATE / PRE_BATTLE ×2 /
  //   TIMELINE_ADVANCE / ACTION_START / BEFORE_HIT）—— 两份独立清单给出同一批，方向一致。
  ok("★ 从未被引用的枚举成员 6 个（与 g42 的「7 个事件码未派发」互相印证：这里不含 HIT/TARGET_SELECT）", enumDead.length === 6, JSON.stringify(enumDead));
  // 真正的 CI 闸门：任何从未被读的字段都必须已经登记（按设计 / 未完成）
  const AL = path.join(root, "battle-lab", "tools", "field-allowlist.json");
  const allow = JSON.parse(fs.readFileSync(AL, "utf8"));
  const fresh = never.filter(r => !(r.name in allow.allowed) && !(r.name in allow.knownGaps));
  ok("★★ 没有未登记的缺口（新增缺口会让 CLI 失败）", fresh.length === 0, JSON.stringify(fresh.map(r => r.name)));
  ok("★ 生产文件集合确实包含网页侧", prodFilesOf(root).some(f => /apps[\\/]web[\\/]src/.test(f)));
  ok("★ 生产文件集合排除了测试与工具自身", !prodFilesOf(root).some(f => /[\\/](tests|tools)[\\/]/.test(f)));
  // ★★ 字符串同名污染的**登记锁**：EV.HIT 被判成「有读取方」，但它对应的机制
  //    （命中判定事件 / 效果命中与抵抗）在引擎里根本不存在。
  //    这条断言防止它被当成"已接线"悄悄销案 —— 只要它还躺在 knownGaps 里就说明是待办。
  ok("★★ EV.HIT 必须留在 knownGaps（同名污染不得被当作已接线销案）", "HIT" in allow.knownGaps, JSON.stringify(Object.keys(allow.knownGaps)));
  ok("★ VICTORY_CHECK 已真接线，必须**不在** knownGaps 里（否则就是拿待办名单掩盖已完成项）", !("VICTORY_CHECK" in allow.knownGaps));
  // ★★★ 第 94 轮：同一条规矩用在 IMMUNE 上 —— 它这一轮真的有了派发点与读取方。
  ok("★★★ IMMUNE 已真接线，必须**不在** knownGaps 里（第 94 轮新增的同型断言）", !("IMMUNE" in allow.knownGaps));
  // ★★★ 第 97 轮：RESIST **也接线了**（红区 H + EV.RESIST 派发）⇒ 与 IMMUNE 同一处置，必须离开 knownGaps。
  ok("★★★ RESIST 已真接线，必须**不在** knownGaps 里（第 97 轮新增的同型断言）", !("RESIST" in allow.knownGaps));
  ok("★★ 而 BEFORE_HIT 仍未接线，必须**留在** knownGaps 里（对照：不许把没做的也删了）", "BEFORE_HIT" in allow.knownGaps);
}

console.log("\n=== 字段普查解析器自检: " + pass + " passed, " + fail + " failed ===");
if (fail > 0) process.exitCode = 1;
