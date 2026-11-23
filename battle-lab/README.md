# Battle Lab — M0「空战场」+ 红区实验台

> `0.1-experimental` ｜ 2026-10-01
> 设计原则：**Schema / Event Model 冻结；四个红区作为待实验参数，不允许靠猜测补值。**

## 快速开始

```bash
node tests/m0.ts                 # M0 空战场验收，34 项断言        -> 34/34
node tests/m1.ts                 # M1 真实式神验收，14 项断言      -> 14/14
node compile/report.ts           # 技能编译器覆盖率（818 技能）
node compile/ai-report.ts        # AI 规则编译器覆盖率（272 AI）
node experiments/run-all.ts      # 44 个红区实验，输出判别性观测
node capability/report.ts        # 引擎能力覆盖率（对照官方 48 类 tags）
node compile/ai-gaps.ts          # AI 规则阈值量化缺口
node runner/duiyi-demo.ts 300    # 对弈竞猜端到端胜率 demo（含回合上限敏感性）
node runner/bias-probe.ts        # 引擎对称性自检（镜像对局）
node runner/stall-survey.ts      # 卡住率普查（1v1 全组合）
node tests/guessing-rules.ts     # 已确证规则强制校验    -> 8/8
```

详见 [M1-REPORT.md](M1-REPORT.md)。

## 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M0** | Empty Battlefield：不加载任何真实式神 | ✅ 34/34 |
| **M1** | First Real Shikigami：真实数据装载 + AI 编译 + 端到端 | ✅ **23/23** |
| M2 | 红区实验游戏内观测 → 策略转 VERIFIED | ⏳ 待游戏内实测 |
| M3 | 对弈竞猜胜率可用（无 UNKNOWN 策略） | ⏳ 依赖 M2 |

## 阴阳师（本体）——已确认不在对弈竞猜中

**规则 `GUESSING_NO_ONMYOJI`（来源 `USER_CONFIRMED`）：对弈竞猜环境下不存在阴阳师。**
引擎强制校验：用竞猜 ruleset 构造含阴阳师的阵容会抛 `RuleViolation`（`node tests/guessing-rules.ts`，8/8）。
需要研究阴阳师时须显式选用 `GuessingRulesets.RESEARCH_WITH_ONMYOJI`。

以下基础设施因此**不在关键路径上**，仅作保留：

`Entity.type = ONMYOJI`，并按**数据自身的 `grade` 字段**拆成两套体系：

| 体系 | 成员 | 御灵 | 技能 | 面板 | AI |
|---|---|---|---|---|---|
| `CLASSIC_GUARDIAN` | 晴明/神乐/源博雅/八百比丘尼 | 有映射 | 🟡 不完整 | 🔴 无 | 🟢 有（2019 资料） |
| `CLAN_HERO` | 源赖光/藤原道长 | ➖ | 🟢 完整 | 🔴 无 | 🔴 无 |

AI 已结构化落库：[data/kb/onmyoji-ai.json](../data/kb/onmyoji-ai.json)。
完整证据链与"为什么面板根本没有"：[05-阴阳师数据考古报告.md](../05-阴阳师数据考古报告.md)。

## M0 验收范围（不加载任何真实式神数据）

创建双方 → 初始化泛鬼火 → 初始化行动条 → 普通回合 → 技能选择 → 目标 → 资源支付
→ Damage / HP Loss / Heal / Recover → Buff → 死亡 → 胜负 → **Seed Replay**

## 目录

```
kernel/       Battle / Team / Entity / Timeline / Resource / EventBus / Status / RNG / damage / policies
dummy/        可任意配置的 Dummy（制造控制变量实验，不模拟真实式神）
experiments/  44 个红区实验（A 开局顺序 / B 同时触发 / C 死亡复活 / D 竞猜 Ruleset）
compile/      技能编译器 / AI 编译器 / buff 编译器 / 真实式神装载器 / 缺口分析
runner/       Monte Carlo + Wilson 区间 + 对称性自检 + 卡住率普查 + 胜率 demo
capability/   官方 48 类 tags → 引擎能力覆盖率
tests/        M0 / M1 验收
fixtures/     编译产物（skill-ir / ai-ir / 编译质量 / AI 缺口）
traces/       对局产物（demo 报告）
```

## 编译覆盖率（当前）

| 环节 | 结果 |
|---|---|
| 技能编译 HIGH/MEDIUM | 556 / 818（68.0%），其中**真正需人工复核仅 48 个（5.9%）** |
| AI 规则编译 | 580 / 744（**78.0%**）—— cast 70.3% / target 87.9% |
| AI 规则含模糊词 | 18（2.4%），其中**模糊且未编译仅 4 条（0.5%）** |
| 可装载式神（全技能 HIGH/MEDIUM） | **99 / 282** |
| 引擎能力覆盖率 | Kernel **58.3%**（FULL 20 / PARTIAL 16 / NONE 12） |

## 核心设计决定（都有官方或规格书依据）

| 决定 | 依据 |
|---|---|
| **5 种伤害类型** NORMAL / INDIRECT / CONDUCTION / TRUE / FIXED (+ 形毁) | 官方术语 [5][12][18][28] |
| **HP 变更四条独立管线** DAMAGE / LOSS / HEAL / RECOVER | 官方 [21] 失去 ≠ 伤害；[20] 恢复 ≠ 治疗 |
| **泛鬼火** 鬼火 / 愿力 / 义火，统一走 `resources.pay()` | 官方 [26] |
| **状态 5 分类** 增益状态/增益印记/减益状态/减益印记/通用印记 | 官方 [25] |
| **驱散 ≠ 解除** `dispel()` 看 dispellable，`remove()` 看 removable | 官方 [3] 后九者不可驱散、仅霜冻不可解除；[8] 驱散；[1] 解除 |
| **回合四类型** NORMAL / NEW / PSEUDO / SKILL_RESOLUTION，各自带 flags | 规格书 + 社区研究 |
| **速度 ≠ 拉条** `effects` 改属性，`timeline.shift()` 改位置 | 官方 [117] 缚足"无法受到改变行动条的效果" |
| **HP<=0 ≠ DEAD ≠ KILLED** 三个独立字段 | 官方 [3252] 转化"视同被击败但无法被复活"；[3342] 屹立不倒 |
| **行动条并发推进** t_i=(GOAL-p_i)/v_i，Δt=min(t_i) | 规格书 + 连续时间等价模型 |
| **状态计时按来源回合** | 官方 [15] 维持 |

## 红区策略（policies.ts）

任何一次模拟都会把 `policySnapshot` 写进产物；只要含 `UNKNOWN`，就会带
`_warning: 存在 UNKNOWN 策略时，本产物的数值不构成机制结论`。

| 红区 | 策略 | 状态 |
|---|---|---|
| A 开局结算顺序 | `StartupPolicies`（3 个候选） | UNKNOWN |
| B 同优先级排序 | `PriorityPolicies`（3 个候选） | UNKNOWN |
| B 行动条并列 | `TieBreaks` | UNKNOWN |
| C 击杀时点 | `DeathPolicies`（3 个候选） | UNKNOWN |
| D 对弈竞猜 Ruleset | `GuessingRulesets` | UNKNOWN（残局参数全为 null） |
| 鬼火数值 | `ResourcePolicies` | HYPOTHESIS（社区值，官方未给） |

## 实验产物格式

每个实验输出 `experiments/results/<ID>.json`：

```jsonc
{
  "experiment": "A02",
  "question": "先机 与 御魂开局效果 谁先？",
  "inGameObservation": "带一个开局触发的御魂 + 一个先机式神，看哪个效果先写入状态栏",
  "hypotheses": [ { "id": "SOUL_FIRST", "observable": { "order": ["SOUL","SENKI"] } },
                  { "id": "SENKI_FIRST", "observable": { "order": ["SENKI","SOUL"] } } ],
  "discriminating": true,
  "status": "AWAITING_IN_GAME_OBSERVATION",
  "confidence": "NOT_RUN"
}
```

`discriminating: true` 表示**这两个假设在游戏里会产生可观察的差异** ——
拿到游戏内观测后填入 `chosenHypothesis`，实验即变为 `RESOLVED`，并写入 `verified-rules.json`。
**未 RESOLVED 的实验结果禁止用于产出胜率。**
