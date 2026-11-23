// compile/unmodeled.ts — ★ 明确「未建模机制」的动词表（第 29 轮）
//
// 为什么需要它：句子的分类是**整句**级的 —— 只要句子里匹配到任何一个模式
// （哪怕 [tips_1] 这种纯引用）就记为 PARSED。于是
//   · 「为友方目标驱散3个减益状态…」被报成 confidence=HIGH / unparsed=0（第 27 轮已修）
//   · 「战斗开始时获得[buff]，受到致命伤害时复活」同样会自称完整编译
// Fidelity 的 SKILL 层据此把这些技能算进「完整编译（无可执行缺口）」—— 报告比代码乐观。
//
// 第 27 轮我试过「子句里有机制词却无可执行模式就判未解析」，结果大面积误报：
//   · 「使目标受到的伤害增加10%」「每层提升5%攻击」是**印记自带**的效果，本来已建模
//   · 「上限4层」「受到伤害时」是条件与上限的碎片，不是机制
// 所以这一版换了个方向：**只收「引擎里确实没有对应行为代码」的动词**，
// 且每条都记录了验证依据。宁可少收，不可错收。
//
// 验证方式（2026-10，可直接复跑）：
//   rg "this\\.revive\\(" battle-lab            → 只命中定义处，无调用点
//   rg "runPseudoTurn\\(" battle-lab              → 同上（反击/协战/邀战的共用入口）
//   rg "suppressedPassive\\.add" battle-lab       → 只有 experiments 脚手架
//   …其余同理，见每条 note
export interface UnmodeledMechanic {
  /** 触发词（会出现在技能文案里） */
  verb: string;
  /** 引擎里缺少的是什么 */
  missing: string;
  /** 验证依据：跑了什么、看到了什么 */
  evidence: string;
  /**
   * ★★★ 第 112 轮：**这条缺口影不影响胜负** —— 由记录自己声明，不写在报告层。
   *
   * 由来：`kernel/fidelity.ts` 此前写着 `verb === "召唤" || verb === "复活" ? "WARN" : "INFO"` ——
   * 一张**硬编码的两个名字**的名单。它一定会与动词表分叉（第 110 轮「召唤」的动作部分已经实现，
   * 第 111 轮又新增了在场光环/收回这两种缺口），而分叉的方向是**把要紧的缺口标成 INFO**。
   * ⇒ 判据跟着记录走：表里的动词在这里声明，编译器合成的记录（在场光环/收回）自己声明。
   *   WARN = 本局会因此**少做一件影响胜负的事**；INFO = 记录性缺口（支线/次要分支）。省略 = INFO。
   */
  severity?: "WARN" | "INFO";
  /**
   * ★ 该词**还有另一种用法**：作为过滤器/修饰语而非动作。
   * 例如「非召唤物的友方全体」里的「召唤物」是筛选条件，不是"这个技能会召唤"。
   * 有 filterPattern 的词，只有在**同一子句里匹配不上过滤器形状**时才判为未建模。
   */
  filterPattern?: RegExp;
  /**
   * ★ 该词还有**修辞用法**：写了"召唤"，但实际是把一次攻击说得花哨些。
   * 例：「召唤暴风雪攻击敌方全体3次」「召唤流星攻击敌方目标3次」——
   * 这些技能的效果是伤害，不是召唤出一个会行动的单位。
   * 第 29 轮实测：45 个被标为"召唤未建模"的技能里 **19 个属于这一类**，
   * 若不排除，Fidelity 面板会告诉用户「雪女「暴风雪」依赖未建模的召唤机制」—— 那是**假话**。
   */
  flavorPattern?: RegExp;
  /**
   * ★★★ 第 95 轮：**这个动词已经接线的那一类写法**（判据作用在**整句**上）。
   *
   * 与 filterPattern / flavorPattern 的区别：那两个说"这个词根本不是在讲这件事"，
   * 而这个说"**这件事已经做了**"——命中它的句子不再算未建模，命中不了的仍然算。
   * 于是"部分接线"可以被如实表达：接线的那一类消失，没接线的继续报缺口。
   */
  modeledPattern?: RegExp;
}

export const UNMODELED: UnmodeledMechanic[] = [
  { verb: "复活", severity: "WARN", missing: "**触发式**复活（阵亡时…立即复活）与依赖召唤物的复活（棺材 / 晴天娃娃）没有接线；引擎只有「主动复活」（全库 3 个技能，第 67 轮接线）。reviveBlocked / undeathUsed 两个标记在生产代码里也从来没被置为 true",
    evidence: "第 67 轮：主动复活由 compile/character.ts 调用 Battle.revive（tests/g41-revive.ts 双向验证）；触发式与容器式的原文仍被 findUnmodeled 判为未建模（g41 第 [1] 节反向断言）", },
  /**
   * ★★★ 第 103 轮：**这条动词语义已经大部分落地**（第 98–103 轮），适用范围再次收窄。
   *   已经能收的写法（都有触发者与运行时）：
   *     · 「进入/化身[tips_N]姿态」⇒ 自身形态（神堕八岐大蛇神堕之力 / 百羽凤凰火未熄羽）；
   *     · 「镇压成[tips_N]」⇒ 镇压式（须佐之男神之领域 → 雷冢）；
   *     · 「击败…召唤[tips_N]」与「【施放】召唤[tips_N]」⇒ 击杀式/施放式（雪御前龙胆·绽 → 龙胆蓝璃）。
   *   ⇒ 判据写在这里，而且**必须与解析器接受的形状逐字对应**：
   *     · 自身形态：「[tips_N]姿态」+ 进入/化身；
   *     · 镇压式：「镇压成[tips_N]」；
   *     · 击杀式/施放式：「击败|击杀…召唤[tips_N]」／「【施放】…召唤[tips_N]」。
   *
   * ★★ 第一版这里写的是宽泛的「召唤[tips_N]」—— 于是**千姬「海潮入梦」/ 绘世花鸟卷「绘梦浮生」/
   *   慧明灯「正念」/ 猫川「洗筋伐髓」** 这四条被标成"已建模"，而解析器**根本没有为它们产生放置声明**
   *   （它们的召唤既不是击败触发也不是施放触发）。那是**拿声明冒充实现**，正是本项目最忌讳的。
   *   收紧之后这四条回到未建模（它们的召唤物规则确实还没做），census 也回到干净状态。
   */
  /**
   * ★★★ 第 110 轮：**"没有地方往 Team.summons 里放单位"这句话已经不成立**（第 98 轮起 addSummon
   *   就是生产代码），而这一轮又把**裸的「召唤[tips_N]」**（最字面的那一种）接上了 ——
   *   于是 modeledPattern 与解析器逐字对应：姿态 / 镇压成 / 击败式 / 【施放】式 / **召唤式**。
   *   ★ 仍然没有行为代码的是**召唤物的"在场效果"与"收回"**：那两件事由 skill-compiler 的句子分类
   *     单独记账（「在场光环」/「收回」），不再挂在"召唤"这个**动作**上 ——
   *     动作有行为代码、光环没有，两件事混在一句话里就永远说不清进度。
   */
  { verb: "召唤", severity: "WARN", missing: "「在场时」光环与「收回」没有行为代码（召唤动作本身已实现）", evidence: "addSummon 是生产代码（kernel/battle.ts）且 spec 来自 tips.json 的 [tips_N] 引用；在场光环与收回逐句记在 compile/skill-compiler.ts 的句子分类里", modeledPattern: /镇压成\[tips_[0-9]+\]|\[tips_[0-9]+\]\s*姿态|召唤\[tips_[0-9]+\]/,
    filterPattern: /非召唤物|除召唤物|召唤物外|召唤物以|对召唤物|召唤物的|召唤物造成/,
    // 伤害措辞：写了"召唤"，实际是给一次攻击加个花哨的主语
    flavorPattern: /召唤[^。；\n]{0,12}(攻击|冲击|轰击|降下|造成|形成|化为|对敌方)/ },
  /**
   * ★★★ 第 95 轮：**「反击」改成部分接线** —— 于是这一条也改成"剩下的那部分"。
   *
   * 已经做的：内核有了 `Battle.counterAttack`（伪回合 + 强制普攻 + **反击不连锁** +
   * 被控不反击），被动运行时按**逐句触发路由**给它装生产者（tests/g56 第 [3]/[4] 节）。
   * 还没做的（本条继续报的原因）：
   *   · **主动技能**里的反击（「施放后…反击」）没有接线 —— 它的触发点在本技能自己的结算里；
   *   · 触发句映射不到目标侧族的那些（阿香「自身及友方受到非传导伤害时」、
   *     久次良「没有X的友方受到非传导伤害时」、奴良陆生「受到伤害或触发抵抗时」）——
   *     它们的家族名不在登记册里，所以挂不上；
   *   · 「单个回合内限1次 / 自身回合开始前限5次」这类**次数限制**没有执行。
   * ⇒ 只有"触发句是 `受到伤害时 / 受到攻击时` 这一族 且 IR 里解析出 counter"的那一类才算已接线，
   *   判据就是下面这个 modeledPattern（逐句匹配）。
   */
  { verb: "反击", missing: "只接了**一部分**：主动技能里的反击、家族名不在登记册里的触发句（阿香/久次良/奴良陆生），以及「单个回合内限N次」的次数限制都还没做",
    evidence: "第 95 轮：Battle.counterAttack + 逐句触发路由（tests/g56 第 [3]/[4] 节双向量过）；阿香/萤草/久次良的反击句经实测**都不**落在已接线的形状里",
    modeledPattern: /(?:受到伤害|受到攻击|被攻击|受到敌方攻击)时[^。]{0,80}?反击/ },
  { verb: "协战", missing: "同反击 —— 共用伪回合入口 runPseudoTurn，且该入口没有调用方", evidence: "rg '\\.runPseudoTurn\\\(' 无命中；registry CO_ATTACK 亦记为「入口在、无生产者」", },
  { verb: "邀战", missing: "内核里没有任何相关代码：不会让友方立即对某目标行动", evidence: "rg 'inviteAttack' 无命中；registry INVITE_ATTACK 记「内核里没有任何代码，等同 NONE」", },
  // ★★★ 第 93 轮：**「吸血」从这张表里移除了** —— 它现在真的有行为代码：
  //   compile/skill-compiler.ts 解析出 SkillIR.lifesteal（百分号紧贴「吸血」），
  //   kernel/damage.ts 的 applyLifesteal 在伤害落账后回流生命（基数/通道由 policies.lifesteal 决定），
  //   被动侧（三尾狐「诱惑」/夜刀神「夜之邀约」）在被动运行时里按 ctx.result.applied 结算。
  //   ⇒ 移除的**前提**是可机械检查的：tests/g54 断言 IR 里真的有 lifesteal、伤害真的回流、
  //     且两个假命中（式神名「吸血姬」、抑制句「无法触发…吸血效果」）**没有**被收进来。
  //   ★ 保留的边界：驭魂/归骸形态、封印结界里的吸血（BRANCH_CONDITION，3 条）与
  //     「使用普攻或单体技能时」的吸血（1 条）仍然不收 —— 它们依赖未建模的形态/结界。
  //   ★★ 改这一行时踩了一次：替换时少了一个换行，于是**下面这条「免疫」整条被并进了注释里** ——
  //     表里少了一个动词，而"少一条"不会报错。是 tests/g23 第 [2] 节那条「免疫行动条击退效果」
  //     的断言把它抓出来的（它报的是一条空命中）。**删一行和注掉一行在 diff 上长得一样。**
  { verb: "免疫", missing: "EV.IMMUNE 从未被派发，也没有独立的免控判定（效果抵抗同样无人消费）", evidence: "第 27 轮事件码普查：EV.IMMUNE 在生产代码里一次都没出现；registry 的 CONTROL_IMMUNE/IMMUNITY 均为 PARTIAL", },
  // ★★★ 第 96 轮：**「封印」从这张表里移除了** —— 它现在真的有行为代码：
  //   EventBus 的抑制集合从第 10 轮起就在（collect() 一直读它），只是**没有任何写入方**；
  //   这一轮把它接到**状态**上（StatusDef.suppressPassive / suppressSoul，见 kernel/status.ts 的
  //   hasSuppression 与 kernel/battle.ts 注入的 bus.suppressProvider），被动与御魂处理器在 collect 阶段被挡下。
  //   实测 9 条 buff 带这两个标记（3 条被动失效 + 5 条御魂失效），四条假命中当场修掉。
  //   ⇒ 剩下 3 处「封印」命中**全是名词用法**：「若开启**封印结界**」（御怨般若 ×2）、
  //     「破除天羽羽斩的**封印**」——那是**结界机制**与另一个系统的专名，不是"封印别人的被动/御魂"。
  //     它们由 modality 表里的「结界」那一类负责（见 §12 的边界），不该记在这个动词上。
  //   判据与双向验证（3+5 条真值、四条假命中、强制普攻式的行为面）见 tests/g57-seal.ts。
  /**
   * ★★★ 第 134 轮：**技能替换**（「处于离殇姿态时，技能替换为『终舞』」/「当番茄在场时，该技能替换成『跟我学』」…）。
   *
   * 为什么必须记：引擎里**没有任何"换技能表"的入口** —— 一个单位的技能表在装配时就定死了
   *   （Entity.skills），选招只在这张表里挑（kernel/battle.ts 的 skillSelector → compile/character.ts 的 selectSkillByAI）。
   *   而这句话影响的是"这个单位接下来能放什么"，**直接改结果**，不是装饰句。
   *
   * ★ 旧的账是**分裂**的（第 134 轮实测 33 条子句 / 33 个技能）：一部分被逐句分类判成 MECHANIC_UNPARSED、
   *   但**没有一条具名的缺口**（报表说"这句没解析"，却说不清缺的是什么机制）；
   *   另一部分干脆是 PARSED（"完整编译"）—— 报表比代码乐观，正是这张表存在的理由。
   *
   * 判据只看文本；「无法替换 / 不可替换」这类**免疫声明**由 findUnmodeled 的否定语境规则排除。
   * 双向验证（33 条真值逐条点名 + 假命中必须不收 + 行为面「整场技能表不变」）见 tests/g88-skill-swap.ts。
   */
  { verb: "替换", severity: "WARN", missing: "引擎没有「换技能表」的入口：单位技能表在装配时定死（Entity.skills），选招只在这张表里挑 —— 「…替换为『X』」这一族（姿态 / 状态 / 场上条件触发）一条都没执行", evidence: "全库只有 Entity.skills 的赋值点（compile/character.ts 装配、kernel/state.ts 恢复），没有任何把技能表换成另一套的入口；33 条子句的逐条清单与行为面钉子见 tests/g88-skill-swap.ts" },
  /**
   * ★★★ 第 136 轮：**花海**（KB：彼岸花「赤团华」/「血之花海」）。
   *
   * 它是一个**叠层计数器 + 每回合伤害**的机制，原文写得很细：
   *   「花海中的敌方，在回合开始时，每层花海对其造成攻击39%伤害」/
   *   「自身生命比例100%、75%、50%、25%时，花海上限为3、4、5、6层」/
   *   「回合开始时自动减少1层花海，最少不低于1层」/「生命比例每降低25%，获得1层花海及…护盾」。
   * 而引擎里既没有"花海"这个计数器、也没有"每层每回合造成伤害"的字段 ⇒
   *   全库 7 条子句此前**一条都没报**（逐句分类把它们算成 PARSED 或干脆没命中任何动词）。
   *
   * ★ 过滤器：「**点燃**花海」是**修辞**（荒骷髅「花吻烈魂」讲的是战斗开始时给攻击最高的友方一个 buff，
   *   而 buff 那半句是已实现的）—— 与「召唤暴风雪」同一类假命中，所以那一句不算缺口。
   */
  /**
   * ★★★ 第 140 轮：**原文的六条判据已经全部解析出来了**（`SkillIR.layerField` / `SkillIR.grantLayers`，
   *   形状、出处与两处歧义见 kernel/layer-field.ts），但**运行时执行点还没接** ——
   *   叠层计数器、每层伤害、上限、减层、跨档得层与先机都还没有装配路径。
   * ★★ 第 141 轮进展：**装配点与主动得层已经接上**（compile/passive-runtime.ts 装被动时调 installLayerField、
   *   compile/character.ts 在 grantLayers 上给层，且只在机制在场时给）。
   *   ⇒ 但这一条**仍然记 WARN**，而且第 142 轮的实测把它分成了两半（tests/g93-layer-field.ts 17 条全绿）：
   *     **已验证**：先机 3 层 · 上限随生命比例 3/4/5/6（含两向）· 满血夹到 3 · 掉到 40% 跨两档 +2 ·
   *       1 层时不再减 · 主动技能 60% 血 +2 层 · 默认档（被动 OFF）一条都不发生；
   *     **第 143 轮已补上**：`TURN_START` 的两条钩子 —— 根因是行动者读的是 `ctx.input.actor` 而总线把
   *       "谁在行动"放在 **`ctx.actor`**（BATTLE_START 那条不看 ctx，所以只有它一直是绿的）。
   *       修好之后：敌方回合一开就吃「攻击 × 39% × 层数」、拥有者自己的回合减 1 层且不结算伤害（g93 第 [7] 节）。
   *     **仍未验证**：跨档同时给盾（依赖 `shieldFrom` 的跨技能解析）·「生命比例低于50%再 +1 层」
   *       （第二次施放拿不到层，疑似鬼火/冷却挡住施放，与机制无关）。
   *   按本仓库的规矩：**没验过的部分不放行记账**，也不假装验过。
   *   接线之后按第 108/129 轮的同一套办法收窄（逐子句放行 + 双向测试 + 全量普查逐条解释）。
   */
  { verb: "花海", severity: "INFO", missing: "「花海」的执行点还没接：六条判据（每层39%伤害 / 上限随生命比例3·4·5·6 / 拥有者回合开始减1层（下限1） / 每降25%得1层 / 先机3层 / 跨档同时给护盾）**已全部解析成产物**（SkillIR.layerField · SkillIR.grantLayers，见 kernel/layer-field.ts），但没有装配路径去跑它", evidence: "解析产物实测：全库只有 288/288_02「赤团华」有 layerField、288/288_03「血之花海」有 grantLayers（tools/_probe-hua140d.ts）；而 kernel 里没有任何安装点（rg 'installLayerField' 只命中定义处）；8 条子句的逐条清单与双向验证见 tests/g90-orb-gauge.ts", filterPattern: /点燃花海/ },
  { verb: "庇护", severity: "WARN", missing: "没有庇护类判定", evidence: "rg 'protection\\(' 无命中", },
  { verb: "变形", severity: "WARN", missing: "没有 transform() 入口；transformed 只是个别名标记，且只用于阻挡复活", evidence: "rg 'this\\.transform\\(' 无命中", },
  /**
   * ★★★ 第 99 轮：**属性偷取**已实现（kernel/steal.ts + character.ts 的执行点），
   *   所以这条动词的**适用范围收窄**成"增益偷取"。
   *
   * 为什么要写 modeledPattern 而不是删掉整条：全库 7 条含「偷取」的技能里，
   * 只有 4 条能被读成可执行的属性偷取，另外 3 条**确实没有行为代码**：
   *   · 饿鬼「臭馒头」偷取 1 个**增益状态**（没有 stealBuff 这条路）；
   *   · 首无「冥火」是**逐次伤害触发**（执行点是"施放技能时"，多段技能会差很多）；
   *   · 烬天玉藻前「噬魂」是**施放前被动**（走被动运行时，不是主动执行点）。
   * 前两条与第三条的差别必须能被机械检查 —— 于是判据写成「能读出数字+属性名、且不带这三类前缀」。
   * 双向验证（4 条真写法必须收、3 条假写法必须不收）见 tests/g60-stat-steal.ts。
   */
  /**
   * ★★★ 第 108 轮：**这一条只剩两种写法真的没有执行点** ——
   *     · 「**受到**伤害时…偷取」（挨打触发：引擎里没有这个触发时机）；
   *     · 「永久偷取…直到回目结束」（「回目」这个时间轴引擎里没有）。
   *   已经**有执行点**的四种（都在第 99–108 轮陆续接线）：
   *     · 施放技能时 → compile/character.ts 的执行点；
   *     · 造成伤害时 → compile/passive-runtime.ts 在 AFTER_DAMAGE 上；
   *     · 施放『X』前 → 同一个被动运行时在 SKILL_START 上（第 107 轮接线、第 108 轮跑通）；
   *     · 阵亡归还   → kernel/battle.ts 的 resolveLethal 调 kernel/steal.ts 的 restoreStats。
   *
   * ★ 负向先行断言里**为什么还留着 `施放…前`**：这张动词表**只看文本**（它拿不到技能 IR），
   *   而"这句话的效果到底有没有行为代码"是**编译产物的事实**。谁有事实谁说了算 ——
   *   于是 skill-compiler 会用 IR 覆盖它（第 108 轮的 modeledStealClause，与第 97 轮
   *   isActiveReviveClause 同一套做法）。★ 这个 lookahead 的作用只剩"动词表按文本报出来"，
   *   不是"断言它没实现"—— 两句之差正是第 107 轮把已实现的形状记成"做不了"的原因。
   *
   * ★ 双向验证（6 条真写法必须收、假写法必须不收、以及"未建模的那两句仍要报出来"）见 tests/g60-stat-steal.ts。
   */
  { verb: "偷取", missing: "只有「受到伤害时…偷取」（挨打触发）与「永久偷取…直到回目结束」（「回目」时间轴）两种写法没有执行点；动词表只看文本，施放前/造成伤害时/施放时/阵亡归还四种由 skill-compiler 用 IR 事实覆盖", evidence: "属性偷取(数值转移)在 kernel/steal.ts 的 applyStatSteal、增益偷取在 stealBuff；施放时由 character.ts 的执行点、**造成伤害时**由 compile/passive-runtime.ts 在 AFTER_DAMAGE 上、**施放『X』前**由它在 SKILL_START 上、阵亡归还由 kernel/battle.ts 的 resolveLethal 调 restoreStats；两种没有执行点的写法写在 skill-compiler 的 stealSkips 里", modeledPattern: /^(?!.*(?:受到伤害时|施放[^。；]{0,16}前))[^。；]*(?:偷取[^。；]{0,8}\d+(?:\.\d+)?(?:%|点)\s*(?:攻击力|防御力|暴击伤害|攻击|防御|速度|暴击|生命|效果命中)|随机偷取[^。；]{0,6}属性|可偷取的属性包含|偷取[0-9]+个(?:增益|减益|状态))/ },
  { verb: "转移", severity: "WARN", missing: "没有状态 / 印记转移：不会把某个状态从 A 搬到 B", evidence: "内核里搜不到 transferBuff / moveStatus 之类入口；状态的增删只有 addStatus 与 expireStatus 两条路", },
  { verb: "复制", severity: "WARN", missing: "没有增益复制：不会把某个状态克隆到另一个单位", evidence: "内核里搜不到 copyBuff / cloneStatus 入口；addStatus 的调用点全部来自技能与御魂配置，没有照抄别人状态这条路", },
  { verb: "分摊", severity: "WARN", missing: "没有伤害分摊 / 联结：伤害只会落在被指定的那一个目标身上", evidence: "内核里搜不到 shareDamage / linkTarget 之类入口；registry 的 LINK = NONE（伤害分摊/传递未实现）", },
  { verb: "孤立", severity: "WARN", missing: "没有孤立判定（被孤立的单位不会失去队友增益/无法被治疗）", evidence: "registry ISOLATE = NONE（官方[19] 已定义未实现）；rg 'isolate\\\(' 无命中", },
  { verb: "闪避", severity: "WARN", missing: "没有闪避判定：伤害结算里不存在「先判定是否闪避」这一级", evidence: "registry DODGE = NONE（官方[24] 已定义未实现）；rg 'dodgeRoll' 无命中", },
  { verb: "反伤", missing: "受到伤害后不会向伤害来源回写伤害（没有反伤管线）", evidence: "registry REFLECT = NONE；rg 'reflectDamage' 无命中", },
];

/**
 * 条件/上限的碎片：陈述的不是机制本身，而是"什么时候"或"最多多少"。
 * ★ 第一版写得太宽（任何以「受到…」开头的子句都算），把
 *   「受到的伤害由友方分摊」这种**真机制**也吞掉了 —— 收紧为：
 *   必须以 时 / 后 / 前 / ， 收尾，或者整句极短（≤10 字）。
 */
const CONDITION_TAIL = /(?:时|后|前|，|,)$/;
const CONDITION_HEAD = /(?:受到|造成|当|若|如果|每当|回合|行动|被|上限|最多|每层)/;

export interface UnmodeledHit {
  verb: string;
  clause: string;
  missing: string;
  evidence: string;
}

/**
 * 从一个技能文本里挑出「陈述了未建模机制」的子句。
 * 判定顺序（每一步都在防误报）：
 *   ① 该词是否存在；② 是否只作过滤器（非召唤物…）；③ 是否只是条件碎片（"受到伤害时"）；
 *   ④ 是否在否定语境（"不可驱散"式的免疫声明 —— 那是**声明别人无效**，不是本技能在做）。
 */
export function findUnmodeled(text: string, splitClauses: (s: string) => string[]): UnmodeledHit[] {
  const out: UnmodeledHit[] = [];
  const raw = String(text ?? "");
  // ★ 修辞判定要看**整句**，不能只看子句：赤舌「击鼓召唤雷云，降下数道闪电攻击敌方全体2次」
  //   的伤害在**隔壁子句**里，只看本子句会把"召唤雷云"当成真的在生成单位。
  for (const sentence of raw.split(/[。\n]/)) {
    if (!sentence.trim()) continue;
  for (const clause of splitClauses(sentence)) {
    for (const m of UNMODELED) {
      if (!clause.includes(m.verb)) continue;
      // ② 过滤器：整句里该词只出现在"非召唤物/除召唤物/对召唤物"这类筛选中
      if (m.filterPattern && m.filterPattern.test(clause) && !new RegExp("(?:^|[^非除])" + m.verb + "(?![物])").test(clause.replace(m.filterPattern, ""))) continue;
      // ②' 修辞用法：写了该词，但**整句**讲的是别的事（"召唤暴风雪攻击…"就是一次群攻）
      if (m.flavorPattern && (m.flavorPattern.test(clause) || m.flavorPattern.test(sentence))) continue;
      // ③ 条件碎片：子句以"受到/造成/当/若"开头且很短，陈述的是触发条件
      const bare = clause.replace(/<br\s*\/?>/gi, "").trim();
      // 只认「条件头 + 条件尾」同时成立的碎片（"受到伤害时" / "上限4层"）。
      // ★ 不要用长度做判据：第一版写了 <=10 字就跳过，结果把「免疫行动条击退效果」（9 字）
      //   这种**真机制句**也吞了。短不等于没内容。
      if (CONDITION_HEAD.test(bare) && CONDITION_TAIL.test(bare)) continue;
      // ⑤ 已经接线的那一类写法（第 95 轮）：判据在**整句**上 —— 与①②一样是"这个词不是在讲缺口"，
      //    区别是这个动词**部分做完了**，所以只放过做过的那一类形状。
      if (m.modeledPattern && m.modeledPattern.test(sentence)) continue;
      // ④ 否定语境：不可X / 无法被X / 不能X —— 那是**免疫声明**（说"别人对它无效"），不是本技能在做这件事。
      //    注意不要把"免疫"当成通用否定前缀：对 verb 本身是「免疫」时那会变成要求「免疫免疫」，
      //    而对「免疫行动条击退效果」这种**真机制句**又会误伤。所以只认"该词自己被否定"这一种形状。
      if (new RegExp("不可(?:被)?" + m.verb + "|无法(?:被)?" + m.verb + "|不能" + m.verb + "|不会被" + m.verb).test(clause)) continue;
      out.push({ verb: m.verb, clause, missing: m.missing, evidence: m.evidence });
      break;   // 一个子句只记一次（最靠前的那个机制）
    }
  }
  }
  return out;
}
