# Onmyoji Battle Knowledge Base — 覆盖率报告

| 数据集 | 条目 | 来源 |
|---|---|---|
| 式神 Shikigami | 282 | Data:Character/<id>.json x282 |
| 技能 Skill | 818 | 同上 skills[] |
| 属性面板 Panel | 276 | Data:Attribute.json |
| AI 规则 AIProfile | 272 | Data:SkillAI.json |
| 御魂 Soul | 70 | Data:Soul.json |
| 对弈百科记录 | 240 | workbuddy 快照 |
| buff 词典 | 338 | SkillBuffs 解析 |
| tip 词典 | 122 | SkillTips 解析 |
| 官方术语词典 | 156 | Data:SkillTips.json |
| 对弈预设面板 | 679 | workbuddy 快照解析 |
| 阴阳师面板 | 6 | 第三方（带 confidence，非权威） |

- buff 词典: 338 条（技能引用 335 个，缺 2 个为源数据本身不存在）
- tip 词典: 122 条（技能引用 119 个，**0 缺失**）

## 覆盖率

- 技能条目总数: 818（覆盖 282 只式神，全部有描述）
- 有属性面板的式神: 276/282
- 有 AI 条目的式神: 272/282
- 有 AI cast 规则的式神: 271/282
- 能 join 到对弈百科的式神: 236/282
- 其中有对弈预设面板原文: 235

## 品阶分布

{
 "阴阳师": 4,
 "英杰": 2,
 "SR": 68,
 "R": 38,
 "N": 30,
 "SSR": 88,
 "SP": 51,
 "UR": 1
}