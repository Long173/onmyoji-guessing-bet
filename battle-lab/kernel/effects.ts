// kernel/effects.ts — ★ a1-4 §16 Effect Registry：引擎**能执行哪些效果**，各自由哪段代码执行
//
// 与 capability/registry.ts 的区别（两者容易混，所以写在这里）：
//   · capability/registry.ts —— **游戏机制**层：官方 tags[] 的 48 类，标的是「这个机制实现了多少」；
//   · 本表 —— **引擎操作**层：一个效果对应哪个**代码入口 / 使用点**，标的是「要执行这件事该调谁」。
// 规格 §16 的原话是「目标最终覆盖官方 tags[]」，所以每条尽量挂到 capability 上；
// 挂不上的写 null 并说明为什么，而不是硬凑一个。
//
// ★★ 防「声明本身不是实现」：producer 必须是**使用点**，不能是定义、import、字符串字面量。
//   判定由 tests/g35-effect-registry.ts 机械执行，三态**互斥且穷尽**：
//     WIRED            使用点 ≥ 1                —— 真的有人调它
//     PARTIAL + ORPHAN 定义 ≥ 1、使用点 = 0      —— 入口在、没人调用
//     NONE             连定义都找不到            —— producer 写的是「缺的那个东西」
//
// ★ 第 56 轮这张表的第一版在这里栽过一次，记下来：
//   PseudoAction 我标成 FULL，依据是「能找到 runPseudoTurn 这个字符串」——
//   而唯一那一处正是它自己的**定义**（battle.ts 的 async runPseudoTurn）。
//   g22 早就用更严的判据（找 .runPseudoTurn( 调用点）证伪过同一件事，
//   capability/registry.ts 的 COUNTER 至今标着 PARTIAL「入口存在，没有调用方」。
//   教训不是「小心一点」，而是：查「有没有代码」时，**找到的东西属于哪一类**必须由机器分。
export interface EffectKind {
  key: string;
  /** 三态见文件头：WIRED = 使用点；PARTIAL + ORPHAN = 入口定义；NONE = 缺失标记 */
  producer: string;
  /** 对应的官方能力 key（capability/registry.ts 的 48 条之一）；没有对应则 null */
  capability: string | null;
  /** 引擎能执行到哪一步 */
  support: "FULL" | "PARTIAL" | "NONE";
  /** 生产代码里有没有调用方 / 触发路径 */
  reach: "WIRED" | "ORPHAN";
  note: string;
}

export const EFFECT_KINDS: EffectKind[] = [
  { key: "Damage", producer: "dealDamage", capability: "DAMAGE", support: "FULL", reach: "WIRED", note: "五种伤害语义分叉都在这一处（无视防御/不暴击/不触发御魂等由 DamageType 决定）；battle.damage() 是内核包装，调用方在 compile/character.ts。★★★ 第 252 轮：**分段伤害形状**（IR 键 damageSegments —— 一次施放里「先 N 次单体、最后 1 次全体」这类两段各带自己的范围与次数）也在这条路径上：执行侧由 compile/character.ts 按段展开（此前一律是「槽数 × hits × 受击人数」，实测 262/281/331/375 四条各多算了 14~40 条伤害事件）；尺子 tests/g129-damage-segments.ts（46 条）。★★★ 第 253 轮：**伤害类型也在这条路径上收口** —— `typeOfDamageTail`（skill-compiler.ts）按尾巴上的占位符名字与字面类型词决定 NORMAL / INDIRECT / TRUE / FIXED / CONDUCTION / FORM_DESTROY，此前这五种语义只有「字面词」那一半认得出（24 条 `[tips_5]` 记成 NORMAL、2 条同一击被收两遍）；尺子 tests/g130-damage-type.ts（26 条）" },
  { key: "HP Loss", producer: "loseHp", capability: null, support: "FULL", reach: "WIRED", note: "官方[21] 失去：不暴击、不被护盾吸收、不触发受伤效果。官方 tags 里没有独立类别，所以挂 null。★★★ 第 255 轮：**技能侧的失血终于有生产者了** —— `SkillIR.selfHpLoss`（「然后失去N%最大生命值」）由 compile/character.ts 的施放路径读出来并调 `battle.lose`；此前这个内核入口只有测试与 dummy 在调，三条写着 loss 的技能什么都不做（尺子 tests/g131-self-hp-loss.ts，22 条）" },
  { key: "Heal", producer: "healTarget(", capability: "HEAL", support: "FULL", reach: "WIRED", note: "可暴击、受减疗影响（乘 1 - healDown）" },
  { key: "Recover", producer: "HpMutation.RECOVER", capability: "RECOVER", support: "FULL", reach: "WIRED", note: "官方[20] 独立管线：不受减疗影响、不触发治疗相关效果。入口只有 healTarget(..., {recover:true})" },
  { key: "Shield", producer: "addShield(", capability: "SHIELD", support: "FULL", reach: "WIRED", note: "含不可驱散与破盾；吸收发生在 Entity.mutateHp 内部。★ 第 57 轮补上内核入口 Entity.addShield：此前技能与蚌精各自 push 数组（字段默认值、id 生成方式还不一致），而技能盾的 id 用了 Math.random() —— 它会被序列化进 stateHash，导致同一份输入两次运行指纹不同" },
  { key: "AddStatus", producer: ".addStatus(", capability: null, support: "FULL", reach: "WIRED", note: "增益与减益共用 Entity.addStatus 这一个入口（官方 tags 里 BUFF/DEBUFF 是两类，所以这里挂 null）。★★★ 第 239/240 轮：**计数器**（鬼眸 GHOST_EYE，IR 键 counterCast）也走这一个入口 —— 增层与清零都留痕（STATUS_APPLY 带 stacks/threshold；STATUS_EXPIRE 的 reason=COUNTER_SPENT），尺子 tests/g118-counter-cast.ts（36 条）" },
  { key: "RemoveStatus", producer: ".remove(st.", capability: "CLEANSE", support: "FULL", reach: "WIRED", note: "官方[1] 解除（看 removable 标记，与驱散分离）。★ 标记故意写成调用点形态：裸的 .remove( 会同时命中 timeline.remove(，那是另一回事" },
  { key: "Dispel", producer: ".dispel(", capability: "DISPEL", support: "FULL", reach: "WIRED", note: "官方[8]（看 dispellable 标记）。调用点与 RemoveStatus 在同一行：三元表达式按 pg.kind 分派" },
  { key: "Control", producer: "isActionPrevented", capability: "CONTROL", support: "FULL", reach: "WIRED", note: "眩晕/冰冻/沉睡等由状态标记驱动，不是硬编码在回合里。★★★ 第 242 轮：**效果位条件变体**（IR 键 controlRefs[].variant）也在这条路径上 —— 条件（目标已带某控制）不掷骰、转换概率掷一次（branch_pick:）、命中**改写**该效果位而不是新增；尺子 tests/g121-control-variant.ts（19 条）" },
  { key: "TimelinePush", producer: "timeline.shift", capability: "PUSH", support: "FULL", reach: "WIRED", note: "与 TimelinePull 共用 shift，方向由正负号决定；★ 生产侧**只有一个调用点**（compile/character.ts），内核与御魂都不推条" },
  { key: "TimelinePull", producer: "timeline.shift", capability: "PULL", support: "FULL", reach: "WIRED", note: "同上；被锁条（缚足/放逐/石化）挡下时会留 TIMELINE_LOCKED 痕" },
  { key: "SpeedModify", producer: "addModifier", capability: "SPEED_UP", support: "PARTIAL", reach: "WIRED", note: "速度变化通过印记属性折叠 + Modifier API 表达，没有独立的『改速度』入口。有调用方，但语义不完整 —— 这就是 PARTIAL 的**第二种**含义（与 ORPHAN 那种『没人调』不是一回事）" },
  { key: "ResourceGain", producer: "orbs.gain", capability: "ORB", support: "FULL", reach: "WIRED", note: "溢出量一并返回并留痕" },
  { key: "ResourceCost", producer: "orbs.pay", capability: "ORB_REMOVE", support: "FULL", reach: "WIRED", note: "带 before/after，守恒等式见 tests/g20" },
  /**
   * ★★★ 第 104 轮把这条的**结论钉死**：偷鬼火不是"还没做"，而是**没有数据** ——
   *   全库 818 条技能里写「偷取鬼火 / 夺取鬼火」的是 **0 条**（脚本量的，见 tools/_probe-gaps-r99.ts）。
   *   ⇒ 保持 NONE，但理由从"没实现"换成"**KB 里没有这种写法**"：
   *     这两句话在报表上长得一样，含义完全不同（一个是待办，一个是边界）。
   *   ★ 顺带说明：这一轮实现的**增益偷取**（stealBuff）与它无关 —— 偷的是状态，不是鬼火。
   */
  { key: "ResourceSteal", producer: "stealOrbs", capability: null, support: "NONE", reach: "ORPHAN", note: "偷取鬼火：全库 **0 条**技能这么写（量过）⇒ 这是**数据边界**而不是待办；producer（stealOrbs）从来没有存在过，也不该为了凑覆盖率去造一个" },
  /**
   * ★★★ 第 98 轮：Summon 由「连入口都没有」变成「入口在、**还没有生产调用方**」。
   *
   * 上一版写的是 support:"NONE" —— 那时全仓库搜不到 `addSummon`，连函数都没有。
   * 现在它在 kernel/battle.ts 里**真的存在**（建实体 / 挂免疫状态 / 判胜负计数 / 占召唤位 /
   * 确定性 id / SUMMON_CREATE 事件链），由 tests/g59-summon.ts 的 41 条断言双向锁住。
   *
   * 但**仍然不能标 WIRED**：编译层（compile/character.ts）还没有任何技能会调用它 ——
   * 也就是"规格在、运行时在、**没有触发者**"。三态判定的字面含义正是这个：
   *   WIRED = 有使用点；PARTIAL+ORPHAN = 定义在、没人调用。g35 §3 机械检查这一条。
   *
   * 还差的那一步（下一轮的入口）：技能原文里 `[tips_N]` 指向的 tips 条目若能解析出 SummonSpec，
   * 就应当在技能结算处调用 addSummon —— 那是**数据驱动**的通用规则，
   * 不是给 4 个技能写死（须佐之男「神之领域」/ 百羽凤凰火「未熄羽」/ 雪御前「龙胆·绽」/ 神堕八岐大蛇「神堕之力」）。
   *
   * ★★ 但这一轮**故意没写**这个调用，理由不是懒：**放置在哪一方是技能决定的，不是 tips 决定的。**
   *   · 余烬是自己变成的（tips 写「继承百羽凤凰火在行动条的位置」）⇒ 放**己方**、且要顶掉自己；
   *   · 雷冢是**封印敌方目标**后立在那儿的（tips 写「被镇压的式神以 1 点生命复活」）⇒ 放**敌方**、占掉目标的位子。
   *   只按 tips 就调用 addSummon，会把雷冢放进**友方**队伍 —— 那不是"少做一步"，
   *   而是**做出一个错的局面**（错的方向比缺失更难发现，第 32 轮起就有这条规矩）。
   *   所以入口要连着"引用它的那句技能原文"一起读：先解析放置方与目标，再调 addSummon。
   *
   * ★★★ 第 101 轮：**入口有了**（reach: ORPHAN → WIRED）。`compile/skill-compiler.ts` 从
   *   `[tips_N]姿态` 认出**自身形态**（ON_CAST=施放式 / ON_LETHAL=致命伤害式），把解析好的规格嵌进
   *   `SkillIR.forms`；执行点两处：主动技能在 `compile/character.ts`（施放式），
   *   形态阵亡在 `kernel/battle.ts` 的死亡路径（本体回归）。**目前只有 1 条规格真的能走到**
   *   （神堕八岐大蛇「神堕之力」→ 蛇神；g62 端到端），所以 support 仍是 PARTIAL 而不是 FULL：
   *   ★★★ 第 103 轮：**三类放置全部有了触发者** —— 自身形态（ON_CAST/ON_LETHAL）、
   *   **镇压式**（「镇压成[雷冢]」：放敌方队、被镇压者离场、雷冢被击败时以 1 点生命放回）、
   *   **击杀式**（「击败…在其行动条处召唤[龙胆蓝璃]」：放己方队、位置 = 阵亡者原位置）。
   * ★★★ 第 102 轮再补两块：**形态自己的技能表**（`SkillIR.formSkillOf` ← 「[tips_N]姿态下可施放」，
   *   实测 1 处：审判仪式 → 蛇神）与**第二种回归时机**（「到达行动条终点后复活」= 轮到它行动时回归，
   *   余烬因此可以入场了）。没有技能表的形态照样进行动条（余烬要靠它到终点），空转是安全的且留痕。
   */
  { key: "Summon", producer: "addSummon", capability: "SUMMON", support: "PARTIAL", reach: "WIRED", note: "★ 第 98 轮：运行时**真的建好了**（kernel/battle.ts 的 addSummon：按 tips 原文算生命基准、挂真实免疫状态、占召唤位、countsForVictory、确定性 id、SUMMON_CREATE/SUMMON_SLOT_FULL 留痕），数据来源也找到了 —— **tips.json 就是放置单位的定义处**（6 条规格，见 kernel/summon.ts）。缺的是**触发者**：编译层还没有技能会调用它。另一个仍然空缺的点：召唤物用什么技能打人（tips 里只有「无法行动」的那些能确定，可行动的余烬没有技能表）" },
  { key: "Revive", producer: "revive(", capability: "REVIVE", support: "PARTIAL", reach: "WIRED", note: "★ 第 67 轮接线：主动复活技能（全库 3 个）现在会调用它 —— compile/character.ts 先以 1 点血复活，再由**同一次技能的治疗**抬到原文比例（tests/g41-revive.ts）。仍是 PARTIAL 而不是 FULL：触发式复活（阵亡时…立即复活）与依赖召唤物的复活（棺材 / 晴天娃娃）没有接线；★ 第 94 轮补上「无法被复活」那一层：reviveBlocked 现在由状态派生（refreshReviveBlock，见 §79）" },
  { key: "Transform", producer: "transformed = true", capability: null, support: "PARTIAL", reach: "WIRED", note: "★★★ 第 101 轮：**transformed 有生产写入方了** —— `kernel/summon.ts` 的 enterForm 在本体进入形态时置 true（reader 在 resolveLethal：transformed 的单位不被判定死亡）。它此前与 undeathUsed / reviveBlocked 同属『有读者、没有写入方』那一类（第 56 轮记在案）。仍不是 FULL：KB 里真正的『变形』是控制状态 morph（已在 CONTROL_EFFECTS），而『形态切换』的完整语义（替换技能表、形态专属技能）还没做。★ 第 56 轮从 PARTIAL 改成 NONE：transformed 标记有读取方（battle.ts 里变形免疫本次死亡、阻挡复活），但**生产代码里没有任何地方把它置为 true** —— 只有初值 false 与 state.ts 的存档恢复。读得到、永远不为真的分支在真实对局里不可达。producer 写的正是缺的那一行" },
  { key: "ExtraTurn", producer: "grantExtraTurn(", capability: "TURN_MECH", support: "PARTIAL", reach: "WIRED", note: "NEW_TURN now has a producer: kernel/extra-turn.ts queues a grant, Battle.runExtraTurns plays it right after the current turn (counts as a turn, triggers turn start/end, no onibi-gauge advance). Caller: the 轮入道 soul (soul/custom-effects.ts). PARTIAL: skill texts that grant new turns (e.g. 赤影妖刀姬 L3 '击败…获得新的回合') are not wired. Before: NEW_TURN existed only in the enum, nothing started such a turn" },
  // ★★★ 第 95 轮：ORPHAN → **WIRED**。`runPseudoTurn` 有真实调用方了（kernel/battle.ts 的 counterAttack）。
  //   support 仍是 PARTIAL 而不是 FULL：**入口有了，但从真实数据走不到** ——
  //   全库没有一条技能同时满足「触发句映射到目标侧族」与「IR 里有 counter」（tests/g56 第 [6] 节钉着这个 0）。
  { key: "PseudoAction", producer: "runPseudoTurn", capability: "TURN_MECH", support: "PARTIAL", reach: "WIRED", note: "★ 第 95 轮：入口有生产者了（Battle.counterAttack → 伪回合 + 强制普攻 + 反击不连锁 + 被控不反击）。仍是 PARTIAL：真实数据里没有一条技能同时满足两个条件，主动技能里的反击与「限N次」也没做。原文：与 capability 表 COUNTER=PARTIAL、compile/unmodeled.ts「反击/协战 缺失」三处口径现已一致" },
  { key: "InviteAttack", producer: "inviteAttackBy", capability: "INVITE_ATTACK", support: "NONE", reach: "ORPHAN", note: "官方[10]：内核里没有任何代码" },
  { key: "CoAttack", producer: "coAttackWith", capability: "CO_ATTACK", support: "NONE", reach: "ORPHAN", note: "官方[9]：伪回合入口在、没有生产者（与 capability 表口径一致）" },
  { key: "Isolate", producer: "isolateTarget", capability: "ISOLATE", support: "NONE", reach: "ORPHAN", note: "官方[19] 已定义，未实现（放逐/隔离）" },
  { key: "Link", producer: "linkDamage", capability: "LINK", support: "NONE", reach: "ORPHAN", note: "伤害分摊/传递未实现" },
  /**
   * ★★★ 第 99 轮：Restore 由「连入口都没有」变成 **WIRED** —— 属性偷取的**归还**真的接线了。
   *
   * 三件事同时在位（这正是三态判定的三个条件）：
   *   ① 定义：kernel/steal.ts 的 restoreStats（把某来源留下的偷取状态一次性还回去）；
   *   ② **使用点**：kernel/battle.ts 的死亡路径（KB 原文「阵亡时，将偷取的攻击全部归还」）
   *      —— 另外两条归还路径（状态到期、被驱散）走的是既有状态机制，不需要新代码；
   *   ③ 数据来源：4 条技能能从原文读出「偷取X%属性，持续N回合」（g60 双向锁住）。
   *
   * ★ support 仍是 PARTIAL 而不是 FULL：KB 里还有别的"还原"语义没做
   *   （复制属性、面板被降低后的还原、一反木绵的「直到回目结束」——「回目」这个时间轴引擎里没有）。
   */
  { key: "Restore", producer: "restoreStats", capability: "RESTORE", support: "PARTIAL", reach: "WIRED", note: "★ 第 99 轮：**属性偷取的归还**已接线（到期/驱散走状态机制，阵亡走 battle.ts 的死亡路径）。文本解析只认「偷取X%属性/点速度，持续N回合」；读不出来的三类（增益偷取 / 逐次伤害触发 / 施放前被动）留在 stealSkips 与未建模表里" },
  { key: "Switch", producer: "switchForm", capability: "SWITCH", support: "NONE", reach: "ORPHAN", note: "官方[5]：引擎里没有『形态 = A/B』的表示，也没有换一整套技能的入口；transformed 标记连自己都点不亮（见 Transform 条），更表达不了两套形态各自的技能表" },
  { key: "Dodge", producer: "rollDodge", capability: "DODGE", support: "NONE", reach: "ORPHAN", note: "官方[24] 已定义，未实现（闪避是独立于命中判定的另一条线）" },
  { key: "Protect", producer: "protectAlly", capability: "PROTECTION", support: "NONE", reach: "ORPHAN", note: "官方[14] 已定义，未实现（挡刀/代替承受）" },
];
