// capability/registry.ts — 把官方 48 类技能 tags 提升为引擎能力清单
// tags[] 来自 data/kb/shikigami.full.json 的每条技能（游戏自己的分类）
// support: FULL=已实现  PARTIAL=Schema有但行为未实测  NONE=未实现
export interface Capability {
  tag: string; key: string; support: "FULL" | "PARTIAL" | "NONE";
  evidence: "OFFICIAL" | "SPEC" | "DATA" | "NONE";
  note: string;
  /**
   * ★ 生产者：一段**必须在生产代码里出现**的正则（定义处不算，要有真正的调用路径）。
   * 有了它，这张表就从「一份声明」变成「一份可被机器证伪的声明」：
   *   support=FULL  ⇒ producer 必须能在生产代码里匹配到（tests/g22 强制）
   *   support=NONE  ⇒ 若给了 producer，则它必须**匹配不到**
   * 没写 producer 的条目会在测试输出里如实列出（不是静默通过）。
   */
  producer?: string;
}

export const CAPABILITIES: Capability[] = [
  { tag: "伤害",   key: "DAMAGE",         support: "FULL",    evidence: "OFFICIAL", note: "5 种伤害类型 + 300/(300+def)，官方[5][12][18][28]", producer: "dealDamage" },
  { tag: "增伤",   key: "DMG_UP",         support: "PARTIAL", evidence: "DATA",     note: "effects 折叠已支持，叠层规则未实测", producer: "dealtBuff" },
  { tag: "控制",   key: "CONTROL",        support: "FULL",    evidence: "OFFICIAL", note: "官方[3] 16 种 + 能力矩阵", producer: "preventsAction" },
  { tag: "减伤",   key: "DMG_DOWN",       support: "PARTIAL", evidence: "DATA",     note: "第 44 轮起由 dmgTakenD 的**负值**表达（减伤 = 挨得更少）；叠层与上限未实测", producer: "dmgTakenD" },
  { tag: "增益",   key: "BUFF",           support: "FULL",    evidence: "OFFICIAL", note: "官方[25] 5 分类", producer: "addStatus" },
  { tag: "拉条",   key: "PULL",           support: "FULL",    evidence: "SPEC",     note: "timeline.shift 正向", producer: "\"pull\"" },
  { tag: "减益",   key: "DEBUFF",         support: "FULL",    evidence: "OFFICIAL", note: "官方[25]", producer: "startsWith\\(\"DEBUFF\"" },
  { tag: "治疗",   key: "HEAL",           support: "FULL",    evidence: "OFFICIAL", note: "可暴击、受减疗影响", producer: "healTarget" },
  { tag: "护盾",   key: "SHIELD",         support: "FULL",    evidence: "OFFICIAL", note: "官方[6]，含不可驱散与破盾。第 57 轮起施加只有 Entity.addShield 一个入口（此前两处各自 push 数组）", producer: "addShield\\(" },
  { tag: "鬼火",   key: "ORB",            support: "PARTIAL", evidence: "OFFICIAL", note: "泛鬼火三形态已建模，数值来自未验证 Policy", producer: "orbs\\.pay" },
  { tag: "加速",   key: "SPEED_UP",       support: "FULL",    evidence: "SPEC",     note: "与拉条严格分离：改的是 spd 属性（影响行动条斜率），不是位置", producer: "get speed\\(\\)" },
  { tag: "削弱",   key: "WEAKEN",         support: "PARTIAL", evidence: "DATA",     note: "靠印记的 effects 折叠表达（降低攻击/伤害），但没有独立的「削弱」语义与叠层规则；第 28 轮审计补上原本为空的说明" },
  { tag: "恢复",   key: "RECOVER",        support: "FULL",    evidence: "OFFICIAL", note: "官方[20] 独立管线", producer: "HpMutation\\.RECOVER" },
  { tag: "破防",   key: "DEF_BREAK",      support: "PARTIAL", evidence: "DATA",     note: "需拆固定/百分比无视防御", producer: "defIgnore" },
  { tag: "驱散",   key: "DISPEL",         support: "FULL",    evidence: "OFFICIAL", note: "官方[8]；与解除已分离（第 27 轮才真正接线，此前 dispel() 零调用）", producer: "\\.dispel\\(" },
  /**
   * ★★★ 第 98 轮：仍然是 PARTIAL，但**理由换了一条**（旧理由已经不成立）。
   *
   * 旧理由：「没有任何生产代码会生成召唤物；继承比例与持续时间写在 tips 里，属红区」。
   * 查清之后发现这句**只对了一半**：放置单位的数据**不在 shikigami.full.json，而在 tips.json**——
   * 技能原文用 `[tips_N]` 引用，tips 条目自己写着名字 / 生命基准 / 免疫项 / 复活方式 / 胜利判定。
   * 实测解析出 6 条规格（kernel/summon.ts，逐条断言在 g59），运行时 `Battle.addSummon` 也已建好。
   *
   * 新理由（更窄、更硬）：**编译层还没有技能会调用它** —— 规格在、运行时在、没有触发者。
   * 另有一处真空缺：可行动的放置单位（余烬）**用什么技能打人**，tips 里没写。
   */
  /**
   * ★★★ 第 101 轮：**编译层的触发者有了**（第一块）。`[tips_N]姿态` ⇒ 自身形态类放置单位：
   *   施放式（神堕八岐大蛇「神堕之力」→ 蛇神）与致命伤害式（百羽凤凰火「未熄羽」→ 余烬）都能被认出来，
   *   但**只执行回归时机为"形态阵亡即回归"的那一类** —— 余烬要等"形态单位自己会行动"（到行动条终点做什么写在 tips 里），
   *   所以它被明确拒绝入场并留痕（FORM_SKIPPED），而不是进一个永远回不来的形态。
   * 仍缺：① 敌方位放置（雷冢的镇压、龙胆蓝璃放在目标行动条位置）；② 放置单位的技能表。
   */
  { tag: "召唤",   key: "SUMMON",         support: "PARTIAL", evidence: "OFFICIAL", note: "官方[3253]：容器/序列化/恢复/寻敌/行动条 + 第98轮的产生者（addSummon）+ ★第101轮的**触发者**（SkillIR.forms ← [tips_N]姿态）。已打通：自身形态类（施放式/致命伤害式识别，回归=形态阵亡）。★ 第 103 轮：**三类放置全部接线**（自身形态 / 镇压式 / 击杀式）。仍缺两条细则（都写在事件里）：龙胆蓝璃的「重复召唤叠加上限」与「在场时拥有者免疫受到的伤害」", producer: "addSummon" },
  // ★★★ 第 94 轮：PARTIAL → FULL。状态自带的「免疫控制效果」在执行点上真的挡下控制了
  //   （producer = findImmuneStatus，由 g22 强制它必须能在生产代码里匹配到），
  //   而且 EV.IMMUNE 第一次被派发。★ 仍未建模的三类如实写在说明里（不假装全覆盖）。
  { tag: "免控",   key: "CONTROL_IMMUNE", support: "FULL",    evidence: "DATA",     note: "第 94 轮接线：状态自带的免疫控制（15 条 buff）在唯一的状态施加点挡下控制并派发 EV.IMMUNE。★ 未建模：只免某一种控制的写法（「免疫沉睡效果」）、无状态承载的窗口式免疫、以及**效果抵抗**掷骰（RESIST 事件仍无派发点）", producer: "findImmuneStatus" },
  { tag: "推条",   key: "PUSH",           support: "FULL",    evidence: "SPEC",     note: "timeline.shift 负向", producer: "\"push\"" },
  { tag: "解控",   key: "CLEANSE",        support: "FULL",    evidence: "OFFICIAL", note: "官方[1] 解除（与驱散是两套标记：dispellable / removable）", producer: "removable" },
  // ★★★ 第 95 轮：说法改了（不是升 FULL）。入口现在**有生产者**了，但从真实数据走不到 ——
  //   要同时满足"触发句能映射到目标侧族"与"IR 里解析出 counter"，全库今天**一条都没有**。
  //   判据（tests/g56 第 [4] 节）：逐句路由 + counterAttack 端到端可达（用打了补丁的 IR 验证），
  //   而真实 KB 上满足两个条件的技能数为 **0** —— 这句话本身就是这条 PARTIAL 的理由。
  { tag: "反击",   key: "COUNTER",        support: "PARTIAL", evidence: "SPEC",     note: "第 95 轮：入口有生产者了（Battle.counterAttack：伪回合 + 强制普攻 + 反击不连锁 + 被控不反击），被动侧按**逐句**路由装处理器；★ 仍不可达的原因：全库没有一条技能同时满足「触发句映射到目标侧族」与「IR 有 counter」，主动技能里的反击与「限N次」也未做", producer: "counterAttack" },
  { tag: "减速",   key: "SPEED_DOWN",     support: "FULL",    evidence: "SPEC",     note: "同加速；印记文案「速度」由 buff-compiler 映射到 spd", producer: "get speed\\(\\)" },
  { tag: "守护",   key: "GUARD",          support: "NONE",    evidence: "SPEC",     note: "挡刀/代替承受未实现" },
  { tag: "复活",   key: "REVIVE",         support: "PARTIAL", evidence: "OFFICIAL", note: "官方[3252][3342]：Battle.revive() 与复活封锁已实现，但**没有任何生产者调用它**（技能文本里的「复活」不会触发）—— 第 28 轮审计发现，原标 FULL 属过度声称" },
  // ★★★ 第 93 轮：从 NONE 改成 FULL —— 伤害管线真的会向攻击方回流生命了。
  //   判据（可机械检查，tests/g54）：① producer 在生产代码里被调用；
  //   ② 全库 9 条「N%吸血」里收 6 条，另外 5 处**有理由**的跳过（3 条分支条件 + 2 条假命中）；
  //   ③ 端到端跑出 LIFESTEAL 事件，回流量 == 比例 × 实际伤害。
  //   ★ 仍不是"全知"：基数与通道是红区（policies.lifesteal），多段合计口径未实现。
  { tag: "吸血",   key: "LIFESTEAL",      support: "FULL",    evidence: "DATA",     note: "第 93 轮接线：SkillIR.lifesteal 只认「百分号紧贴吸血」，伤害落账后由 applyLifesteal 回流（基数/通道见 policies.lifesteal 红区 F）；形态/结界分支里的吸血仍不收", producer: "applyLifesteal" },
  { tag: "减疗",   key: "HEAL_DOWN",      support: "FULL",    evidence: "OFFICIAL", note: "官方[20] 恢复不受其影响", producer: "healDown" },
  // ★★★ 第 96 轮：说法改了 —— 写入方有了，而且**形态与原来设想的不同**（不是往 Set 里写，而是让 Battle
  //   注入一个读**状态**的求值器：状态进 state ⇒ 存档/续跑/重放都天然成立，而 Set 不进 state）。
  //   ★ 仍未建模：封印**结界**（结界机制本身）、放逐，以及"封印"作为独立机制的其它形态。
  { tag: "封印",   key: "SEAL",           support: "FULL",    evidence: "OFFICIAL", note: "官方[105]。第 96 轮接线：状态上的 suppressPassive / suppressSoul（3 条被动失效 + 5 条御魂失效）由 Battle 注入的 suppressProvider 求值，被动与御魂处理器在 collect 阶段被挡下；内置控制状态「变形」也带 survivePassive ⇒ 它现在真的压住被动。★ 仍未建模：封印结界、放逐、以及「封印」作为独立机制的其它形态", producer: "suppressProvider" },
  { tag: "切换",   key: "SWITCH",         support: "NONE",    evidence: "DATA",     note: "形态切换未实现" },
  { tag: "回合",   key: "TURN_MECH",      support: "FULL",    evidence: "SPEC",     note: "NORMAL/NEW_TURN/PSEUDO_TURN/ACTION_ONLY（第 23 轮已对齐规格命名）", producer: "runPseudoTurn" },
  { tag: "协战",   key: "CO_ATTACK",      support: "PARTIAL", evidence: "OFFICIAL", note: "官方[9]：同反击 —— 入口在、无生产者、时序未实测" },
  { tag: "易伤",   key: "VULNERABLE",     support: "PARTIAL", evidence: "DATA",     note: "与 dmgTakenD 同一处折叠", producer: "dmgTakenD" },
  { tag: "免疫",   key: "IMMUNITY",       support: "PARTIAL", evidence: "OFFICIAL", note: "官方[16]。第 94 轮：状态自带的**伤害免疫 / 减益免疫 / 放逐免疫**已接线（伤害免疫在伤害管线里把这一击归零，且不触发「造成伤害时」）；★ 仍未建模：无敌（INVINCIBLE 的 setTargetable 没有生产者）、技能文案里的窗口式免疫" },
  { tag: "不屈",   key: "UNDYING",        support: "PARTIAL", evidence: "OFFICIAL", note: "官方[3342]：字段已在状态里，触发规则未实测", producer: "undeathUsed" },
  { tag: "扣火",   key: "ORB_REMOVE",     support: "FULL",    evidence: "DATA",     note: "OrbPool.pay（守恒等式见 tests/g20）", producer: "orbs\\.pay" },
  { tag: "邀战",   key: "INVITE_ATTACK",  support: "PARTIAL", evidence: "OFFICIAL", note: "官方[10]：内核里没有任何代码，等同 NONE（原标 PARTIAL 偏乐观）" },
  { tag: "省火",   key: "ORB_SAVE",       support: "NONE",    evidence: "DATA",     note: "减耗/替代资源未实现" },
  { tag: "无敌",   key: "INVINCIBLE",     support: "PARTIAL", evidence: "OFFICIAL", note: "官方[16]：canBeTargeted 已被寻敌读取，但**没有任何状态会自动调用 setTargetable**（只有 tests/g14 直接调）" },
  { tag: "穿盾",   key: "SHIELD_PIERCE",  support: "NONE",    evidence: "DATA",     note: "未实现" },
  { tag: "锁条",   key: "TIMELINE_LOCK",  support: "FULL",    evidence: "OFFICIAL", note: "官方[117][109][2277]（第 25 轮才真正接线：此前 setLock 无生产者）", producer: "locksTimeline" },
  { tag: "反伤",   key: "REFLECT",        support: "NONE",    evidence: "SPEC",     note: "内核里没有反伤：受到伤害后不会向伤害来源回写伤害（第 28 轮补）" },
  { tag: "闪避",   key: "DODGE",          support: "NONE",    evidence: "OFFICIAL", note: "官方[24] 已定义，未实现" },
  { tag: "孤立",   key: "ISOLATE",        support: "NONE",    evidence: "OFFICIAL", note: "官方[19] 已定义，未实现" },
  { tag: "连击",   key: "MULTI_HIT",      support: "PARTIAL", evidence: "SPEC",     note: "多段结算已支持，连击判定未实现", producer: "hits" },
  { tag: "隐匿",   key: "STEALTH",        support: "NONE",    evidence: "DATA",     note: "没有隐匿状态；虽然 canBeTargeted 已被寻敌读取，但没有任何状态会自动设置它（与无敌同因，第 28 轮补）" },
  { tag: "庇护",   key: "PROTECTION",     support: "NONE",    evidence: "OFFICIAL", note: "官方[14] 已定义，未实现" },
  { tag: "免推",   key: "PUSH_IMMUNE",    support: "FULL",    evidence: "OFFICIAL", note: "官方[117]：与锁条共用同一判定", producer: "locksTimeline" },
  { tag: "联结",   key: "LINK",           support: "NONE",    evidence: "DATA",     note: "伤害分摊/传递未实现" },
  { tag: "弱化",   key: "ENFEEBLE",       support: "PARTIAL", evidence: "DATA",     note: "同削弱：只有印记属性折叠，没有独立语义；原说明为空，第 28 轮补" },
  /**
   * ★★★ 第 99 轮：RESTORE 由 NONE 升到 PARTIAL —— 属性偷取（偷取→归还）整条链路实现并接线。
   *   仍不是 FULL：KB 里还有别的"还原"语义（复制属性、被降低后的还原、一反木绵的「直到回目结束」）
   *   没有行为代码。这一条**不影响** g22 的 FULL 计数（它记的是 FULL 条数）。
   */
  { tag: "还原",   key: "RESTORE",        support: "PARTIAL", evidence: "DATA",     note: "★ 第 99 轮：属性偷取的**归还**已实现（kernel/steal.ts 的 restoreStats + battle.ts 死亡路径 + 状态到期机制）；文本解析覆盖 4/7 条含「偷取」的技能，其余三类写在 stealSkips 里" },
];

export function coverage() {
  const total = CAPABILITIES.length;
  const by = (s: string) => CAPABILITIES.filter(c => c.support === s).length;
  const full = by("FULL"), partial = by("PARTIAL"), none = by("NONE");
  return {
    total, full, partial, none,
    kernelCoverage: +(((full + partial * 0.5) / total) * 100).toFixed(1),
    hardCoverage: +((full / total) * 100).toFixed(1),
    unsupported: CAPABILITIES.filter(c => c.support === "NONE").map(c => c.key),
  };
}
