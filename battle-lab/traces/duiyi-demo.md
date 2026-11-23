# 对弈竞猜端到端胜率 Demo

阵容：红方 236 vs 蓝方 246（真实式神，数据来自灰机 wiki 2026 快照）

> ⚠️ 本 demo 的唯一目的是**打通链路并量化不确定性**，不是给出可下注的胜率。
> 四个红区中仍有 3 个是 UNKNOWN，见文末策略快照。

### S0 镜像对照（同阵容打自己，期望≈50%）
模拟 40 局 | 红胜 22 | 蓝胜 18 | 卡住(未终结) 0 | 同归于尽 0
红方胜率 55.00%  Wilson 95% CI [39.83%, 69.29%]
蓝方胜率 45.00%  Wilson 95% CI [30.71%, 60.17%]
可下结论: 否
  ⚠️ 存在 UNKNOWN 策略：{"startup":{"id":"NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI","status":"HYPOTHESIS"},"priority":"REGISTRATION_ORDER","tieBreak":"SPEED_THEN_RANDOM","death":{"id":"DEATH_AFTER_PREVENTION","status":"HYPOTHESIS"},"resource":{"id":"COMMUNITY_4_8_5_345","status":"HYPOTHESIS"},"guessing":{"id":"COMMUNITY_2020_UNVERIFIED","status":"UNKNOWN"},"_warning":"存在 UNKNOWN 策略时，本产物的数值不构成机制结论"} —— 本结果不构成机制结论
  ⚠️ 有效样本仅 40 局，置信区间过宽

### S1 开局顺序 = 御魂→被动→先机
模拟 40 局 | 红胜 40 | 蓝胜 0 | 卡住(未终结) 0 | 同归于尽 0
红方胜率 100.00%  Wilson 95% CI [91.24%, 100.00%]
蓝方胜率 0.00%  Wilson 95% CI [-0.00%, 8.76%]
可下结论: 否
  ⚠️ 存在 UNKNOWN 策略：{"startup":{"id":"NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI","status":"HYPOTHESIS"},"priority":"REGISTRATION_ORDER","tieBreak":"SPEED_THEN_RANDOM","death":{"id":"DEATH_AFTER_PREVENTION","status":"HYPOTHESIS"},"resource":{"id":"COMMUNITY_4_8_5_345","status":"HYPOTHESIS"},"guessing":{"id":"COMMUNITY_2020_UNVERIFIED","status":"UNKNOWN"},"_warning":"存在 UNKNOWN 策略时，本产物的数值不构成机制结论"} —— 本结果不构成机制结论
  ⚠️ 有效样本仅 40 局，置信区间过宽

### S2 开局顺序 = 先机最先
模拟 40 局 | 红胜 40 | 蓝胜 0 | 卡住(未终结) 0 | 同归于尽 0
红方胜率 100.00%  Wilson 95% CI [91.24%, 100.00%]
蓝方胜率 0.00%  Wilson 95% CI [-0.00%, 8.76%]
可下结论: 否
  ⚠️ 存在 UNKNOWN 策略：{"startup":{"id":"SENKI_FIRST","status":"HYPOTHESIS"},"priority":"REGISTRATION_ORDER","tieBreak":"SPEED_THEN_RANDOM","death":{"id":"DEATH_AFTER_PREVENTION","status":"HYPOTHESIS"},"resource":{"id":"COMMUNITY_4_8_5_345","status":"HYPOTHESIS"},"guessing":{"id":"COMMUNITY_2020_UNVERIFIED","status":"UNKNOWN"},"_warning":"存在 UNKNOWN 策略时，本产物的数值不构成机制结论"} —— 本结果不构成机制结论
  ⚠️ 有效样本仅 40 局，置信区间过宽

### S3 击杀时点 = HP<=0 即 KILLED
模拟 40 局 | 红胜 40 | 蓝胜 0 | 卡住(未终结) 0 | 同归于尽 0
红方胜率 100.00%  Wilson 95% CI [91.24%, 100.00%]
蓝方胜率 0.00%  Wilson 95% CI [-0.00%, 8.76%]
可下结论: 否
  ⚠️ 存在 UNKNOWN 策略：{"startup":{"id":"NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI","status":"HYPOTHESIS"},"priority":"REGISTRATION_ORDER","tieBreak":"SPEED_THEN_RANDOM","death":{"id":"HP_ZERO_IS_KILLED","status":"HYPOTHESIS"},"resource":{"id":"COMMUNITY_4_8_5_345","status":"HYPOTHESIS"},"guessing":{"id":"COMMUNITY_2020_UNVERIFIED","status":"UNKNOWN"},"_warning":"存在 UNKNOWN 策略时，本产物的数值不构成机制结论"} —— 本结果不构成机制结论
  ⚠️ 有效样本仅 40 局，置信区间过宽

### S4 行动条并列 = 未定（按注册序）
模拟 40 局 | 红胜 40 | 蓝胜 0 | 卡住(未终结) 0 | 同归于尽 0
红方胜率 100.00%  Wilson 95% CI [91.24%, 100.00%]
蓝方胜率 0.00%  Wilson 95% CI [-0.00%, 8.76%]
可下结论: 否
  ⚠️ 存在 UNKNOWN 策略：{"startup":{"id":"NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI","status":"HYPOTHESIS"},"priority":"REGISTRATION_ORDER","tieBreak":"UNRESOLVED","death":{"id":"DEATH_AFTER_PREVENTION","status":"HYPOTHESIS"},"resource":{"id":"COMMUNITY_4_8_5_345","status":"HYPOTHESIS"},"guessing":{"id":"COMMUNITY_2020_UNVERIFIED","status":"UNKNOWN"},"_warning":"存在 UNKNOWN 策略时，本产物的数值不构成机制结论"} —— 本结果不构成机制结论
  ⚠️ 有效样本仅 40 局，置信区间过宽

## 策略不确定性带宽

同一对阵容，仅因四个红区取不同候选假设，红方胜率在 **55.00% ~ 100.00%** 之间漂移。

带宽 45.00 个百分点 —— **这就是当前不做游戏内实测所能达到的精度上限**。
作为对照：N=40 时 Wilson 95% 区间宽度约 29.47 个百分点。

结论：**策略不确定性远大于统计误差**，必须先做红区实验再谈胜率。

## 策略快照（每次模拟都强制携带）

```json
{
 "startup": {
  "id": "NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI",
  "status": "HYPOTHESIS"
 },
 "priority": "REGISTRATION_ORDER",
 "tieBreak": "SPEED_THEN_RANDOM",
 "death": {
  "id": "DEATH_AFTER_PREVENTION",
  "status": "HYPOTHESIS"
 },
 "resource": {
  "id": "COMMUNITY_4_8_5_345",
  "status": "HYPOTHESIS"
 },
 "guessing": {
  "id": "COMMUNITY_2020_UNVERIFIED",
  "status": "UNKNOWN"
 },
 "_warning": "存在 UNKNOWN 策略时，本产物的数值不构成机制结论"
}
```

## 回合上限敏感性（对应 D 组未实测的残局机制）

| maxTurns | 红方胜率 | 卡住 | 有效样本 |
|---:|---:|---:|---:|
| 50 | 100.00% | 0 | 60 |
| 150 | 100.00% | 0 | 60 |
| 300 | 100.00% | 0 | 60 |
| 800 | 100.00% | 0 | 60 |

**胜率对回合上限不敏感（漂移 0.0 个百分点）**（漂移 0.00 个百分点）

### 第二组：3v3 辅助阵容（201/212/236 vs 246/307/347）

| maxTurns | 红方胜率 | 卡住 | 有效样本 |
|---:|---:|---:|---:|
| 100 | 100.00% | 0 | 40 |
| 300 | 100.00% | 0 | 40 |
| 800 | 100.00% | 0 | 40 |
| 2000 | 100.00% | 0 | 40 |

**胜率对回合上限不敏感（漂移 0.0 个百分点）**

> 这就是**膀胱局**的量化：辅助型阵容在没有残局加速机制时会打不完，
> 而残局增伤/减疗曲线正是 D 组 12 个实验要测的东西。