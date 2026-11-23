# Capability Coverage — 引擎能力覆盖率

以游戏自身的技能 tags[]（48 类）为基准，而不是自定的功能清单。

| 能力 | 官方tag频次 | 引擎支持 | 机制来源 | 生产者（须在生产代码中匹配到） | 说明 |
|---|---:|---|---|---|---|
| DAMAGE | 521 | FULL | OFFICIAL | `dealDamage` | 5 种伤害类型 + 300/(300+def)，官方[5][12][18][28] |
| DMG_UP | 123 | PARTIAL | DATA | `dealtBuff` | effects 折叠已支持，叠层规则未实测 |
| CONTROL | 68 | FULL | OFFICIAL | `preventsAction` | 官方[3] 16 种 + 能力矩阵 |
| DMG_DOWN | 63 | PARTIAL | DATA | `dmgTakenD` | 第 44 轮起由 dmgTakenD 的**负值**表达（减伤 = 挨得更少）；叠层与上限未实测 |
| BUFF | 58 | FULL | OFFICIAL | `addStatus` | 官方[25] 5 分类 |
| PULL | 54 | FULL | SPEC | `"pull"` | timeline.shift 正向 |
| DEBUFF | 42 | FULL | OFFICIAL | `startsWith\("DEBUFF"` | 官方[25] |
| HEAL | 39 | FULL | OFFICIAL | `healTarget` | 可暴击、受减疗影响 |
| SHIELD | 39 | FULL | OFFICIAL | `addShield\(` | 官方[6]，含不可驱散与破盾。第 57 轮起施加只有 Entity.addShield 一个入口（此前两处各自 push 数组） |
| ORB | 24 | PARTIAL | OFFICIAL | `orbs\.pay` | 泛鬼火三形态已建模，数值来自未验证 Policy |
| SPEED_UP | 23 | FULL | SPEC | `get speed\(\)` | 与拉条严格分离：改的是 spd 属性（影响行动条斜率），不是位置 |
| WEAKEN | 22 | PARTIAL | DATA | — | 靠印记的 effects 折叠表达（降低攻击/伤害），但没有独立的「削弱」语义与叠层规则；第 28 轮审计补上原本为空的说明 |
| RECOVER | 21 | FULL | OFFICIAL | `HpMutation\.RECOVER` | 官方[20] 独立管线 |
| DEF_BREAK | 21 | PARTIAL | DATA | `defIgnore` | 需拆固定/百分比无视防御 |
| DISPEL | 21 | FULL | OFFICIAL | `\.dispel\(` | 官方[8]；与解除已分离（第 27 轮才真正接线，此前 dispel() 零调用） |
| SUMMON | 19 | PARTIAL | OFFICIAL | `summons` | 官方[3253]：容器/序列化/恢复/寻敌/行动条都已就绪，但没有任何生产代码会**生成**召唤物 —— 继承比例与持续时间多写在 tips 里，属红区，拒绝猜测 |
| CONTROL_IMMUNE | 16 | FULL | DATA | `findImmuneStatus` | 第 94 轮接线：状态自带的免疫控制（15 条 buff）在唯一的状态施加点挡下控制并派发 EV.IMMUNE。★ 未建模：只免某一种控制的写法（「免疫沉睡效果」）、无状态承载的窗口式免疫、以及**效果抵抗**掷骰（RESIST 事件仍无派发点） |
| PUSH | 15 | FULL | SPEC | `"push"` | timeline.shift 负向 |
| CLEANSE | 14 | FULL | OFFICIAL | `removable` | 官方[1] 解除（与驱散是两套标记：dispellable / removable） |
| COUNTER | 14 | PARTIAL | SPEC | `counterAttack` | 第 95 轮：入口有生产者了（Battle.counterAttack：伪回合 + 强制普攻 + 反击不连锁 + 被控不反击），被动侧按**逐句**路由装处理器；★ 仍不可达的原因：全库没有一条技能同时满足「触发句映射到目标侧族」与「IR 有 counter」，主动技能里的反击与「限N次」也未做 |
| SPEED_DOWN | 11 | FULL | SPEC | `get speed\(\)` | 同加速；印记文案「速度」由 buff-compiler 映射到 spd |
| GUARD | 10 | NONE | SPEC | — | 挡刀/代替承受未实现 |
| REVIVE | 10 | PARTIAL | OFFICIAL | — | 官方[3252][3342]：Battle.revive() 与复活封锁已实现，但**没有任何生产者调用它**（技能文本里的「复活」不会触发）—— 第 28 轮审计发现，原标 FULL 属过度声称 |
| LIFESTEAL | 9 | FULL | DATA | `applyLifesteal` | 第 93 轮接线：SkillIR.lifesteal 只认「百分号紧贴吸血」，伤害落账后由 applyLifesteal 回流（基数/通道见 policies.lifesteal 红区 F）；形态/结界分支里的吸血仍不收 |
| HEAL_DOWN | 9 | FULL | OFFICIAL | `healDown` | 官方[20] 恢复不受其影响 |
| SEAL | 9 | FULL | OFFICIAL | `suppressProvider` | 官方[105]。第 96 轮接线：状态上的 suppressPassive / suppressSoul（3 条被动失效 + 5 条御魂失效）由 Battle 注入的 suppressProvider 求值，被动与御魂处理器在 collect 阶段被挡下；内置控制状态「变形」也带 survivePassive ⇒ 它现在真的压住被动。★ 仍未建模：封印结界、放逐、以及「封印」作为独立机制的其它形态 |
| SWITCH | 9 | NONE | DATA | — | 形态切换未实现 |
| TURN_MECH | 8 | FULL | SPEC | `runPseudoTurn` | NORMAL/NEW_TURN/PSEUDO_TURN/ACTION_ONLY（第 23 轮已对齐规格命名） |
| CO_ATTACK | 8 | PARTIAL | OFFICIAL | — | 官方[9]：同反击 —— 入口在、无生产者、时序未实测 |
| VULNERABLE | 8 | PARTIAL | DATA | `dmgTakenD` | 与 dmgTakenD 同一处折叠 |
| IMMUNITY | 7 | PARTIAL | OFFICIAL | — | 官方[16]。第 94 轮：状态自带的**伤害免疫 / 减益免疫 / 放逐免疫**已接线（伤害免疫在伤害管线里把这一击归零，且不触发「造成伤害时」）；★ 仍未建模：无敌（INVINCIBLE 的 setTargetable 没有生产者）、技能文案里的窗口式免疫 |
| UNDYING | 7 | PARTIAL | OFFICIAL | `undeathUsed` | 官方[3342]：字段已在状态里，触发规则未实测 |
| ORB_REMOVE | 6 | FULL | DATA | `orbs\.pay` | OrbPool.pay（守恒等式见 tests/g20） |
| INVITE_ATTACK | 5 | PARTIAL | OFFICIAL | — | 官方[10]：内核里没有任何代码，等同 NONE（原标 PARTIAL 偏乐观） |
| ORB_SAVE | 5 | NONE | DATA | — | 减耗/替代资源未实现 |
| INVINCIBLE | 5 | PARTIAL | OFFICIAL | — | 官方[16]：canBeTargeted 已被寻敌读取，但**没有任何状态会自动调用 setTargetable**（只有 tests/g14 直接调） |
| SHIELD_PIERCE | 4 | NONE | DATA | — | 未实现 |
| TIMELINE_LOCK | 4 | FULL | OFFICIAL | `locksTimeline` | 官方[117][109][2277]（第 25 轮才真正接线：此前 setLock 无生产者） |
| REFLECT | 3 | NONE | SPEC | — | 内核里没有反伤：受到伤害后不会向伤害来源回写伤害（第 28 轮补） |
| DODGE | 3 | NONE | OFFICIAL | — | 官方[24] 已定义，未实现 |
| ISOLATE | 1 | NONE | OFFICIAL | — | 官方[19] 已定义，未实现 |
| MULTI_HIT | 1 | PARTIAL | SPEC | `hits` | 多段结算已支持，连击判定未实现 |
| STEALTH | 1 | NONE | DATA | — | 没有隐匿状态；虽然 canBeTargeted 已被寻敌读取，但没有任何状态会自动设置它（与无敌同因，第 28 轮补） |
| PROTECTION | 1 | NONE | OFFICIAL | — | 官方[14] 已定义，未实现 |
| PUSH_IMMUNE | 1 | FULL | OFFICIAL | `locksTimeline` | 官方[117]：与锁条共用同一判定 |
| LINK | 1 | NONE | DATA | — | 伤害分摊/传递未实现 |
| ENFEEBLE | 1 | PARTIAL | DATA | — | 同削弱：只有印记属性折叠，没有独立语义；原说明为空，第 28 轮补 |
| RESTORE | 1 | NONE | DATA | — | 属性还原未实现 |

## 汇总

- 能力总数: **48**
- FULL: 21
- PARTIAL: 16
- NONE: 11
- **Kernel Coverage = 60.4%**（PARTIAL 按 0.5 计）
- Hard Coverage = 43.8%（只算 FULL）

未支持能力: GUARD, SWITCH, ORB_SAVE, SHIELD_PIERCE, REFLECT, DODGE, ISOLATE, STEALTH, PROTECTION, LINK, RESTORE

> 这是**内核能力**覆盖率，不是实现了多少式神。M1 装载真实式神后应重新统计。
> 
> **这不是「真实性 / 准确率」** —— 没有依据把覆盖率线性映射成预测准确率（见 HealthCheck 的同一句声明）。
> 「生产者」一列由 tests/g22-capability-claims.ts 强制：FULL 的能力必须能在**生产代码**里匹配到
> 那个正则；匹配不到就说明这句声明比代码乐观。tests / tools / experiments 都**不算**生产代码 ——
> 否则脚手架会把自己的缺口掩盖掉（第 28 轮：封印的抑制集合只有 experiments 会写）。