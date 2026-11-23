# omj_simulator 战斗引擎源码考古报告

**考古对象**：`reference/omj_simulator-master`（作者 AnzerWall，MIT，TypeScript 3.2 + Vue2 + ant-design-vue）
**规模实测**：`core/` 共 **50 个 .ts 文件、173,282 字节**；`core/` 的外部依赖**只有 `lodash` 和 `random-js`**，**零 Vue/DOM 依赖**。
**方法**：逐行阅读 + 把 `core/` 复制到隔离目录装依赖、用 `tsc` 编译成 CommonJS 后在 Node 上**真跑**。探针脚本留在 `omj_engine_probe/`，复现步骤见 `omj_engine_probe/REPRO.md`。**下文所有「实测」均为我亲手运行得到，非推测。**

---

## 0. 执行摘要（先看这 10 条）

| # | 结论 | 证据 |
|---|---|---|
| 1 | 引擎**可以脱离 Vue 用 node 直接跑** | `core/` 只 import `lodash`/`random-js`；实测 `node out/probe.js` 跑通 1000 场 |
| 2 | 单场 0.82 ms（关日志）/ 23 ms（开日志），**快** | 实测 1000 场 822 ms；单场产生 **1118 行 console.log** |
| 3 | **同种子不可复现**：61/100 场结果不同 | `core/battle.ts:87` `this.runway = new Runway();` 没传种子，`core/runway.ts:29` 默认 `Math.random`；改成传种子后实测 **0/100** 不一致 |
| 4 | **暴击判定写错了，必定暴击** | `core/tasks/attack.ts:80` `battle.testHit(attackInfo.criticalDamage)` 用的是**爆伤**当暴击率；实测 47/47 次 `testHit` 实参都是 `1.5` |
| 5 | **效果抵抗形同虚设**：抵抗成功也照样上 buff | `core/tasks/add-buff.ts:46-50` 判定 `isRes` 后只发事件，**没有 return** |
| 6 | 治疗公式写错（增疗被加成常数） | `core/tasks/healing.ts:64` |
| 7 | **御魂/召唤物/额外回合/复活/护盾/吸血全部为 0** | `equipments`(`core/battle.ts:41`) 声明未用；`summonToken`(`core/entity.ts:29`) 未用；README TODO 勾选状态 |
| 8 | **AI 只有「用 1 技能打随机敌人」** | `core/heroes/ai/index.ts:5-16`；御馔津装了 4 个技能，AI 永远只会放 1 技能 |
| 9 | 预测页**确实跑了 N 场**（默认 100，上限 1000），但**没有置信区间**，还会把中途崩掉的场次算进分母 | `src/views/Predict.vue:6,82,95-107` |
| 10 | 141 条式神面板，**只有 14 只**有技能实现，其余 127 只只有「普通攻击 + normalAI」 | `core/heroes/index.ts:56-58` + 实测 `probe4` |

> 一句话：**骨架值得抄，肉全是坏的。** Task/Event/属性管线三件套是真正有价值的资产；伤害、命中、行动条随机数三处是硬 bug，必须重写。

---

## 1. 战斗主循环与行动条（Runway）

### 1.1 主循环是一个「状态机任务树」的深度优先解释器

`core/battle.ts:138-174`：

```ts
process(): boolean {
    if (this.seed === null) return false;
    if (this.isEnd) return false;
    if (this.currentTask.step === 0) return false;          // step===0 视为出错 → 整场静默终止
    if (this.currentTask.children.length) {                  // 先处理子任务
        if (this.currentTask.children[0].step < 0) {         // 子任务已结束 → 出队
            this.currentTask.children.shift();
            return this.process();
        }
        this.currentTask = this.currentTask.children[0];     // 下沉
        return this.process();
    }
    if (this.currentTask.step > 0) {
        if (this.currentTask.step === 1) this.log();
        const step = this.currentTask.processor(this, this.currentTask.data, this.currentTask.step);
        this.currentTask.step = step === void 0 ? -1 : step;  // 返回 undefined 等价于「结束」
        return true;
    } else {                                                  // 任务已完成 → 回溯
        if (!this.currentTask.parent) { this.isEnd = true; return false; }
        this.currentTask = this.currentTask.parent;
        return this.process();
    }
}
```

- **`process()` 每次调用只推进「一个 step」**，返回 `true` 表示还能继续。这就是「步进调试」和「批量模拟」共用同一个引擎的原因（`src/views/Debug.vue:119-122` 点一次走一步，`src/views/Predict.vue:100-101` 用 `while (battle.process()) {}` 直接跑完）。
- 任务节点结构见 `core/task.ts:8-17`，作者在 `core/task.ts:19-27` 画了示例注释。
- **递归实现**：`process()` 自己调自己，一棵任务树深度约 6-8 层，无栈溢出风险，但每 step 一次递归。

### 1.2 「回合」是真的，但不是「轮」

`core/tasks/battle.ts:6-41` 是整局主循环：

```ts
case 1: battle.addEventProcessor(EventCodes.BATTLE_START, 0, _); return 2;
case 2: battle.runway.compute(); battle.addEventProcessor(EventCodes.SENKI, 0, _); return 3;
case 3: {
    battle.judgeWin();
    if (battle.isEnd) return -1;
    battle.entities.forEach(e => e.turnData.clear());      // 清理回合临时数据
    const nextId = battle.runway.computeNext() || 0;
    if (!nextId) return -1;
    const next = battle.getEntity(nextId);
    if (battle.turn >= 1000) return 0;                     // 超时 → step 0 → 整场终止
    const turnData = new TurnProcessing(++battle.turn, next.entityId);
    battle.addProcessor(turnProcessor, turnData, 'Turn');
    return 4;
}
case 4: {                                                   // 结算本回合排队的伪回合
    if (battle.fakeTurns.length) {
        battle.fakeTurns.forEach(ft => battle.addProcessor(fakeTurnProcessor, ft, '伪回合处理'));
        battle.fakeTurns = [];
    }
    return 3;
}
```

即：**「回合」= 一个单位的一次行动**（官方术语里的「普通回合」），**没有「双方各动一次算一轮」的概念**。`battle.turn` 就是「第几次行动」，到 1000 时返回 step 0 让整场静默结束（`core/battle.ts:146` → `src/views/Predict.vue:104` 记成 `error`）。

⚠️ **顺序 bug**：`runway.computeNext()`（`core/tasks/battle.ts:21`）已经把选中单位的行动条归零（`core/runway.ts:105`），超时判定在它**之后**（`core/tasks/battle.ts:25`），所以第 1000 回合被选中的单位会白白掉条。

### 1.3 Runway 推进算法（核心公式，完整）

`core/runway.ts:1-3, 55-112`：

```ts
const eps = 1e-6;      // 精度
const GOAL = 10000;    // 行动条终点
const oo = 1e10;       // 无限大

compute(): boolean {                                   // 推进到「下一个人到终点」的时刻
    let allFrozen = true, minT = +oo;
    for (const [id, dis] of this.distanceTable) {
        if (this.frozenTable.get(id)) continue;
        const velocity = (this.velocityFunctions.get(id) || lowVelocity)() || eps;
        minT = Math.min(minT, getReachGoalTime(dis, velocity));   // (GOAL - d) / v
        allFrozen = false;
    }
    if (allFrozen) return false;
    for (const [id, dis] of this.distanceTable) {
        if (this.frozenTable.get(id)) continue;
        const velocity = (this.velocityFunctions.get(id) || lowVelocity)() || eps;
        const newDistance = Math.min(dis + velocity * minT, GOAL);
        this.distanceTable.set(id, newDistance);
    }
    return true;
}

getNext(): number | null {                              // 谁到终点了
    let reachGoalEntities = [], maxVelocity = 0;
    for (const [id, dis] of this.distanceTable) {
        if (isReachGoal(dis) && !this.frozenTable.get(id)) {     // feq(dis, 10000)
            const velocity = (this.velocityFunctions.get(id) || lowVelocity)() || eps;
            if (feq(velocity, maxVelocity)) reachGoalEntities.push(id);
            else if (velocity > maxVelocity) { reachGoalEntities = [id]; maxVelocity = velocity; }
        }
    }
    if (!reachGoalEntities.length) return null;
    const id = reachGoalEntities[Math.floor(this.random() * reachGoalEntities.length)];  // ← Math.random！
    this.distanceTable.set(id, 0);
    return id;
}

computeNext(): number { this.compute(); return this.getNext() || 0; }

updatePercent(id, percent) {                            // 拉条/推条
    const nextDistance = Math.max(Math.min(prevDistance + (GOAL * percent), GOAL), 0);
}
```

**公式化描述**（连续时间模型，`d` ∈ [0, 10000]，`v` = 实时计算的速度）：

```
minT   = min over 未冻结 j of (10000 - d_j) / v_j
d_i   ← min(d_i + v_i · minT, 10000)      ∀ 未冻结 i
next   = argmax_{i : d_i ≈ 10000} v_i    （并列时均匀随机取一个）
d_next ← 0
拉条： d ← clamp(d + 10000 · percent, 0, 10000)
```

**评价**：

- ✅ **模型本身是对的**，就是官方「速度→行动条填充率」的连续化等价形式；`minT` 保证每次 `compute()` 至少有一个人恰好到 10000，浮点误差用 `eps=1e-6` + `feq` 兜住。匀速、无随机项、可解析——比「每回合每人 +spd」的离散实现精确得多。
- ❌ **并列先手用了 `Math.random()`**（`core/runway.ts:29, 102`），而 `Battle` 构造时 `this.runway = new Runway()`（`core/battle.ts:87`）**没把 seeded RNG 传进去**。实测：同一 seed 跑 100 次，**61 次结果不同**。而且并列**极其常见**——141 只式神只有 25 个不同速度值，**139/141 与他人同速**（实测）。这直接判了「可复现模拟」和「配对样本方差缩减」的死刑。
  → 一行修：`new Runway(() => this.random.real(0, 1))`。改完实测 **0/100 不一致**。
- ❌ 死亡只 `freeze`（`core/runway.ts:144-150`），没有 `unfreeze`/复活路径；`updatePercent` 对冻结单位直接返回 false。
- ❌ `getNext()` 里速度是**到达那一刻实时重算**的，速度 buff 中途改变会顺带改变「谁先到」，与官方「到达顺序在推进时确定」存在差异（对本项目实际影响很小，因为 buff 多在回合边界结算）。

---

## 2. Task / Event 管线

### 2.1 设计模式：**解释器模式 + 显式状态机树 + 事件总线**

- `core/task.ts:3-5`：`Processor = (battle, data, step) => number | void`。step 语义在 `core/task.ts:9` 明确：`0=出错、<0=结束、>0=进行到第几步`。
- 每个 `action*` 方法不直接改状态，而是 **挂一个子任务**（`core/battle.ts:187-200` `addProcessor`）：

```ts
addProcessor(processor, data = {}, type = ''): number {
    const task = { step: 1, children: [], processor, type, parent: this.currentTask,
                   data, depth: this.currentTask.depth + 1, taskId: ++this.taskCounter };
    this.currentTask.children.push(task);
    return task.taskId;
}
```

  `core/battle.ts:385-430` 是全部「动作 API」：`actionAttack / actionHeal / actionUseSkill / actionAddBuff / actionRemoveBuff / actionUpdateMana / actionUpdateManaProgress / actionUpdateRunwayPercent`。

**优点**：整局完全可暂停、可单步、可 dump（`core/battle.ts:436-445` 的 `dump()` 直接序列化任务树，`src/views/Debug.vue:101-116` 用它渲染）。异步性天然正确：`actionAttack` 之后紧跟的代码不会「提前」执行，因为伤害任务排在子队列里。

**缺点**：每个动作都要 new 一个对象 + 数组 push；**事件分发是主要开销**（见 2.2）。`data: any` 完全无类型约束。

### 2.2 事件派发：在派发瞬间快照所有 handler

`core/battle.ts:202-230`：

```ts
addEventProcessor(code: EventCodes, eventId: number, data?: any): number {
    const eventEntity = eventId <= 0 ? null : this.getEntity(eventId);
    const processing: EventProcessing = new EventProcessing(code);
    this.entities.forEach(entity => {
        forEach(entity.skills, (skill: Skill) => {
            forEach(skill.handlers, handler => {
                if (handler.code !== code) return;
                if (eventId > 0 && eventEntity) {
                    if (handler.range === EventRange.SELF)  { if (eventId !== entity.entityId) return; }
                    if (handler.range === EventRange.TEAM)  { if (eventEntity.teamId !== entity.teamId) return; }
                    if (handler.range === EventRange.ENEMY) { if (eventEntity.teamId ==  entity.teamId) return; }
                }
                processing.units.push(new RealEventData(entity.entityId, skill.no, eventId, handler, data));
            });
        });
    });
    processing.units.sort((a, b) => a.handler.priority - b.handler.priority);
    return this.addProcessor(eventProcessor, processing, 'Event(' + EventCodes[code] + ')');
}
```

Handler 结构 `core/handler.ts:4-11`：`{ handle: Processor, code: EventCodes, range: EventRange, priority: number, passive: boolean, name: string }`。

执行 `core/tasks/event.ts:17-33`：

```ts
const units = data.units;
if (step > units.length) return -1;
const eventData = units[step - 1];
if (eventData.handler.passive && battle.hasBuffByControl(eventData.skillOwnerId, Control.PASSIVE_FORBID))
    return step + 1;                                   // 被动封印：跳过
battle.log(...);
battle.addProcessor(eventData.handler.handle, eventData, 'EventProcess');   // 挂成子任务 → 深度优先、串行
return step + 1;
```

- **串行保证**：handler 被挂成当前 Event 任务的**子任务**，而 `process()` 是「先子后己」，所以第 k 个 handler 完全结算完才会跑第 k+1 个。✅
- **快照语义**：`processing.units` 在派发瞬间定死。**handler 在执行过程中新加的 buff/技能，不会加入当前这次事件**（下一同类事件才生效）。这个语义需要在 2026 版明确下来并写成文档。

### 2.3 「事件反馈处理结果」是怎么实现的 —— **共享 processing 对象 + 就地打标**

返回值没用。真正的中介是**派发时传进去的那个 `data` 对象**：handler 通过修改它来「否决/改写」当前动作。

最干净的实例是 `core/heroes/ssr/ootengu.ts:76-93`（大天狗「庇护」挡控制）：

```ts
{
    handle(battle: Battle, data: RealEventData) {
        if (data.skillOwnerId && data.data && (data.data as AddBuffProcessing).buff.hasParam(BuffParams.CONTROL)) {
            const buffs = battle.filterBuffByName(data.skillOwnerId, '庇护');
            if (buffs.length) {
                (data.data as AddBuffProcessing).cancel = true;   // ← 就地打标 = 「处理结果反馈」
                buffs.forEach(b => battle.actionRemoveBuff(b, Reasons.SKILL));
            }
        }
    },
    code: EventCodes.BEFORE_BUFF_GET, range: EventRange.SELF, priority: 0, passive: false, name: '庇护判定'
}
```

而 `core/tasks/add-buff.ts:27-30` 消费这个标记：

```ts
case 2: {
    if (data.cancel) { // buff被抵消了  庇护 花鸟卷
        return -1;
    }
```

同类机制还有：`AttackInfo`（`core/tasks/attack.ts:10-31`）作为「攻击中间结果」被各路 handler 读写；`RemoveBuffProcessing`、`AddBuffProcessing.isHit/isRes`。

**这是本引擎最值得继承的设计**：事件的「输入/上下文/可修改结果」打包成一个可辨识的 data 对象，被动技能只依赖这个对象的类型，耦合极小；加一个新拦截点（如「免疫控制」）只需新增一个 EventCodes + 一个新的 Processing 类。

**它的缺点**：

1. `data.data` 是 `any`，handler 里全是 `as AddBuffProcessing` 强转（`core/heroes/ssr/ootengu.ts:79,82`、`core/heroes/ssr/shutendoji.ts:94`），没有编译期保护。
2. **没有「消费/拦截」的显式协议**：有人 `return -1`、有人改 `data.cancel`、有人什么都不做。行为分散，容易漏。
3. `handler.priority` 只是单一数字，同优先级按 `entities` Map 的插入顺序（= 注册顺序 = 队伍 0 先于队伍 1）稳定排序，**不是官方的「速度决定」**。
4. `addEventProcessor` 每次都 `O(实体 × 技能 × handler)` 全扫，且**每个事件都新建一个 Task**。一局约 50 回合、每回合十几次事件 → 上千个 Task 对象。这是性能热点（虽然 0.82ms/场说明还没到瓶颈，但规模化到 10 万场会显现）。
5. `eventId <= 0` 时（BATTLE_START / SENKI / MANA_OVERFLOW）**range 过滤被整体跳过**，所有 handler 无条件触发——`EventRange.SELF` 的先机技能也会被别人的先机事件唤醒，属于语义漏洞。

---

## 3. 伤害公式（原文照抄）

`core/tasks/attack.ts:44-112`：

```ts
// case 2 数据准备
attackInfo.critical          = battle.getComputedProperty(source.entityId, BattleProperties.CRI);      // 暴击率
attackInfo.criticalDamage    = battle.getComputedProperty(source.entityId, BattleProperties.CRI_DMG);  // 暴击伤害
attackInfo.damageDealtBuff   = battle.getComputedProperty(source.entityId, BattleProperties.DMG_DEALT_B) + 1;
attackInfo.damageDealtDebuff = battle.getComputedProperty(source.entityId, BattleProperties.DMG_DEALT_D) + 1;
attackInfo.targetDamageTakenBuff   = battle.getComputedProperty(target.entityId, BattleProperties.DMG_TAKEN_B) + 1;
attackInfo.targetDamageTakenDebuff = battle.getComputedProperty(target.entityId, BattleProperties.DMG_TAKEN_D) + 1;
attackInfo.targetDefence = battle.getComputedProperty(target.entityId, BattleProperties.DEF);
attackInfo.damage = typeof attack.base === 'string'
    ? battle.getComputedProperty(source.entityId, attack.base)
    : attack.base(battle, attack.sourceId, attack.targetId);

// case 4 暴击判定
if (attack.hasParam(AttackParams.SHOULD_COMPUTE_CRI)) {
    if (attack.hasParam(AttackParams.INDIRECT) && battle.getComputedProperty(target.entityId, BattleProperties.DEF) <= eps) {
        attackInfo.isCri = true;                                    // 间接伤害 防御为0时必然暴击
    } else {
        attackInfo.isCri = attackInfo.isCri || battle.testHit(attackInfo.criticalDamage);   // ★ 用爆伤当暴击率
    }
    if (attackInfo.isCri) { attack.addParam(AttackParams.CRITICAL); battle.addEventProcessor(EventCodes.CRI, ...); }
}

// case 5 伤害计算
const FR  = battle.random.real(1 - attackInfo.FR, 1 + attackInfo.FR);          // 伤害浮动系数
const atk = attackInfo.damage * attack.rate * (attackInfo.isCri ? attackInfo.criticalDamage : 1) * 300;  // 伤害公式攻击部
const def = attackInfo.targetDefence + 300;                                    // 伤害公式防御部
const rate = (attackInfo.damageDealtBuff / attackInfo.damageDealtDebuff) *
             (attackInfo.targetDamageTakenBuff / attackInfo.targetDamageTakenDebuff);
attackInfo.finalDamage = atk / def * rate * FR;
//TODO: 计算盾的抵消伤害
```

**等价数学式**：

```
伤害 = [ 基础值 × 技能倍率 × (暴击 ? 暴伤 : 1) × 300 / (目标防御 + 300) ]
       × (造成伤害加成 / 造成伤害降低) × (受到伤害加成 / 受到伤害减免) × FR
FR ~ U(1 - 浮动, 1 + 浮动)，默认浮动 = 0.01（core/attack.ts:146）
暴击判定：random(0,1) <= 暴击伤害          ← ★ 应为 暴击率
```

- ✅ **`300/(def+300)` 这一项与官方公式一致**，减伤/增伤处理成「分子分母」也是社区通行做法。
- ★ **`core/tasks/attack.ts:80` 把 `criticalDamage` 当成暴击率。** `attackInfo.critical` 在 `core/tasks/attack.ts:50` 算出来之后**全文再无人使用**（grep 确认）。所有式神 `cri_dmg` 都是 1.5 → `testHit(1.5)` 恒真 → **实测 47/47 次判定全部 p=1.5，即 100% 暴击**。
- ❌ `attack.limit`（「不超过 xxx」，`core/attack.ts:24-27,126`）**从未被处理器读取**。帚神 `core/heroes/n/houkikami.ts:19-22` 写了 `limit(自身攻击×1.5)` 完全无效 —— 这是**声明了但没接线**的典型。同理 `Healing.limit`。
- ❌ **间接伤害**：只在「防御为 0 必暴」这一处被特判（`core/tasks/attack.ts:77`），没有独立的「回合结束结算间接伤害」阶段（官方文档明确有），也没有 `AttackParams.INDIRECT` 的其他语义。
- ❌ **`AttackParams.REAL`（真实伤害）/ `CONDUCTION`（传导）/ `NO_SHIELD`（无视护盾）在整个代码库里只有「被 push」没有「被 if」**（grep 确认）。`BattleProperties.DEF_NEG` / `DEF_NEG_P`（忽略防御）同样只声明不消费。
- ❌ **护盾未接线**：`BuffBuilder.shield()`（`core/buff.ts:24-28`）能建，但 `core/tasks/attack.ts:100` 直接写着 `//TODO: 计算盾的抵消伤害`。
- ❌ **吸血未接线**：酒吞 `core/heroes/ssr/shutendoji.ts:125` 设了 `HP_STEAL = 0.1`，全文无人读取。
- ⚠️ 死亡处理在 `core/tasks/attack.ts:121-136`：置 `fields[team][i]=0`、`runway.freeze`、清空该单位所有 buff，然后发 `DEAD` 事件。**没有复活路径**，且 `fields` 一旦置 0 位置信息就丢了。
- ⚠️ `core/tasks/attack.ts:130` 有 `// TODO: 杀生丸禁止复活buff`。

---

## 4. Buff 系统

### 4.1 建模：**能力标记（flag）集合 + 单一 Effect**，不是分类枚举

`core/buff.ts:163-196` 的 `Buff` 类：

```ts
export default class Buff {
    name: string = '';        // buff名称 用于表示相同buff
    sourceId: number = 0;     // 来源实体
    ownerId: number = 0;      // -2 = 队伍0 全局, -1 = 队伍1 全局, -3 = 双方全局（见 core/battle.ts:306）
    buffId: number;
    params: BuffParams[] = [];
    maxCount?: number;        // 同名最大持有数量
    control?: Control;        // 控制类型        flag: CONTROL
    countDown?: number;       // 倒计时剩余回合   flag: COUNT_DOWN / COUNT_DOWN_BY_SOURCE
    shield?: number;          // 护盾剩余量       flag: SHIELD
    icon?: string;            //                 flag: VISIBLE
    effect?: Effect;          // 对属性的影响     flag: AFFECT_PROPERTY
    dependBuffId?: number; dependEntityId?: number; dependBuffName?: string;  // flag: DEPEND_ON
    probability?: number;     //                 flag: SHOULD_COMPUTE_PROBABILITY
}
```

`core/buff.ts:3-15` 的 Effect 模型：

```ts
export const enum EffectTypes { FIXED, SET, ADD_RATE, MAX, MIN }
export interface Effect { propertyName: string; value: number; effectType: EffectTypes; }
```

**注册方式**：链式 Builder `core/buff.ts:18-161`：

- `Buff.build(sourceId, ownerId).name('狂气', 4).buff().end()`（`core/heroes/ssr/shutendoji.ts:16-21`）
- `.name('庇护',1).stamp().end()`（`core/heroes/ssr/ootengu.ts:19-24`）
- `.countDownBySource(buffs.length)`（`core/heroes/ssr/shutendoji.ts:126`）
- `.dependOn(sourceId,'狐狩界').buffAP(BattleProperties.DEF, EffectTypes.ADD_RATE, 0.12).end()`（`core/heroes/ssr/miketsu.ts:116-131`）

### 4.2 层数 / 冲突覆盖：**只有「同名替换」，没有层数**

`core/tasks/add-buff.ts:56-69`：

```ts
case 5: {
    // 替换同名buff
    if (buff.maxCount && buff.maxCount > 0 && buff.name) {
        const sameBuffs = battle.buffs.filter(b => b.ownerId === buff.ownerId && b.name === buff.name);
        if (sameBuffs.length >= buff.maxCount) {
            const index = battle.buffs.indexOf(sameBuffs[0]);
            if (index === -1) return -1;
            battle.buffs.splice(index, 1);
        }
    }
    battle.buffs.push(buff);
    battle.addEventProcessor(EventCodes.BUFF_GET, buff.ownerId, data);
    return -1;
}
```

**「层数」是用 N 个同名的独立 Buff 对象模拟的**：`core/heroes/ssr/shutendoji.ts:16-21` 的「狂气」`.name('狂气', 4)` 允许最多 4 份，酒吞自己 `filterBuffByName(sourceId,'狂气').length` 数层（`shutendoji.ts:29,32,112`）。UI 侧再按 name 聚合显示（`src/views/Visual.vue:308-321`、`src/visual/battle-scene.ts:92-103`）。

- ⚠️ **FIFO 覆盖**（`sameBuffs[0]` 是最早的一个），不是「取最弱/刷新时长」。
- ⚠️ `maxCount` 只在 `name` 同时存在时生效；`battle.buffs` 是**一个全局数组**，每次查找都是 O(全 buff 数)。
- ✅ `DEPEND_ON` 的「依赖 buff 存在时才生效」是在 `getComputedProperty` 里**实时求值**的（`core/battle.ts:310-316`），不需要同步清理，设计干净。

### 4.3 回合递减

`core/tasks/turn.ts:38-56`：

```ts
case 2: {
    battle.buffs.forEach(buff => {
        if (!(buff.hasParam(BuffParams.COUNT_DOWN) || buff.hasParam(BuffParams.COUNT_DOWN_BY_SOURCE))) return;
        if (buff.hasParam(BuffParams.COUNT_DOWN))            { if (buff.ownerId  !== currentEntity.entityId) return; }
        if (buff.hasParam(BuffParams.COUNT_DOWN_BY_SOURCE))  { if (buff.sourceId !== currentEntity.entityId) return; }
        if (!buff.countDown || buff.countDown <= 1) {        // 未提供倒计时或者剩余时间少于一个回合
            buff.countDown = 0;
            battle.actionRemoveBuff(buff, Reasons.TIME_OUT);
        } else {
            buff.countDown = buff.countDown - 1;
        }
    });
    return 3;
}
```

- 两种递减语义：`COUNT_DOWN` = 「持续 N 回合」（按**持有者**的回合），`COUNT_DOWN_BY_SOURCE` = 「维持 N 回合」（按**来源**的回合）。
- ⚠️ **递减发生在「回合开始」（step 2），而官方在「回合结束阶段第 2 步」**。这会让「本回合刚挂上的 1 回合 buff」的存活窗口整体偏移一个行动，是所有 buff 时长系统性差 1 的根源。
- ⚠️ 遍历 `battle.buffs` 的同时 `actionRemoveBuff` 只是**挂任务**（不立即 splice），所以不会边遍历边改数组 —— 这点是对的。

### 4.4 分类（B1/B2/B3、D1/D2/D3、G1/G2/G3、控、间）—— **本项目完全没有**

我对整个仓库做了正则全量搜索 `\b(B1|B2|B3|D1|D2|D3|G1|G2|G3)\b`：

- 全仓库**唯一命中**是 `package-lock.json:2725` 里一段 base64 哈希（巧合）。
- 设计文档 `core/fixtures/origin_data/回合结算过程3.0.docx`（第三方整理，8878 字）里写着 `附2 buff、debuff一览（略）` —— **恰恰把这一节省略了**。
- 两个 `阴阳师式神信息表V3.x.x.xlsx` 的 `sharedStrings.xml`（2652 条字符串）里同样 **0 命中**。

**代码里实际存在的分类维度只有 `BuffParams`（`core/constant.ts:84-105`）：**

| 代码里的标记 | 含义 | 与用户所述分类的对应 |
|---|---|---|
| `STAMP` (印记) | 印记，强制 NO_DISPEL+NO_REMOVE（`core/buff.ts:52-57`） | 近似「间」（不可驱散类） |
| `ENCHANTMENT` (结界) | 结界，强制 NO_DISPEL+NO_REMOVE（`core/buff.ts:59-64`） | 近似「G」（场地类） |
| `FAIRYLAND` (幻境) | 幻境，强制 NO_DISPEL+NO_REMOVE（`core/buff.ts:66-71`） | 近似「G」 |
| `BUFF` / `DEBUFF` | 增益/减益 | 近似「B」/「D」的粗分 |
| `CONTROL` + `control: Control` | 控制，12 种（`core/constant.ts:1-14`，含封印御魂/封印被动） | 「控」 |
| `NO_DISPEL` / `NO_REMOVE` | 可否驱散/清除 | — |
| `AFFECT_PROPERTY` / `SHIELD` / `VISIBLE` / `SHOULD_COMPUTE_PROBABILITY` / `DEPEND_ON` / `COUNT_DOWN(_BY_SOURCE)` | 机制开关 | — |
| `RULE_HIGH_AND_DRY` / `RULE_CONTROL_IMMUNE` | 孤立无援 / 免疫控制 | — |

**结论：B1/B2/B3、D1/D2/D3、G1/G2/G3 这套「驱散优先级/结算层级」分类在这个项目里不存在。** 2026 版需要自己建（`BuffParams` 这套 flag 可以作为承载它的容器，但「层级」本身得新加一个字段 + 在驱散/清除逻辑里排序）。

- ⚠️ `NO_DISPEL = 'CanDispel'` / `NO_REMOVE = 'CanRemove'`（`core/constant.ts:85-86`）**名字和值语义相反**，是个定时炸弹。
- ⚠️ `BuffParams` 目前**只被「写入」和 `hasParam`「读取」**，唯一真正按 flag 过滤的只有 `getComputedProperty`（`core/battle.ts:305-318`）。**没有任何一处实现「按 NO_DISPEL/NO_REMOVE 过滤驱散」** —— 驱散类技能根本没有基础设施可依赖。

### 4.5 属性管线（buff 怎样影响面板）

`core/battle.ts:301-336`：

```ts
getComputedProperty(entityId: number, name: string): number {
    const entity = this.getEntity(entityId);
    const origin = entity.properties.get(name);
    if (origin === undefined) throw new Error(...);
    const effects: Effect[] = this.buffs.reduce((list, buff) => {
        if (buff.ownerId !== entityId && !(buff.ownerId === entity.teamId - 2 || buff.ownerId === -3)) return list; // 全局buff
        if (!buff.hasParam(BuffParams.AFFECT_PROPERTY)) return list;
        if (!buff.effect) return list;
        if (buff.effect.propertyName !== name) return list;
        if (buff.hasParam(BuffParams.DEPEND_ON)) { /* 依赖不存在则跳过 */ }
        return list.concat([buff.effect]);
    }, []);
    return effects.reduce((current, e: Effect) => {
        switch (e.effectType) {
            case EffectTypes.FIXED:    return current + e.value;
            case EffectTypes.SET:      return e.value;
            case EffectTypes.ADD_RATE: return current + origin * e.value;   // ★ 始终基于 origin，不是 current
            case EffectTypes.MAX:      return Math.max(current, e.value);
            case EffectTypes.MIN:      return Math.min(current, e.value);
            default: return current;
        }
    }, origin);
}
```

- ✅ 这个「**基值 + 效果列表实时折叠**」的模型非常干净：buff 只声明「我要对哪个属性做什么」；`ADD_RATE` 固定基于 `origin` 也避免了「百分比互相放大」的经典错误。
- ⚠️ 但它**不是官方的乘区模型**：官方是 (基础+固定加成)×(1+百分比加成) 分层；这里是纯线性折叠，且顺序敏感（`SET` 之后的效果会覆盖）。
- ⚠️ 每次取属性都 `reduce` 全 `battle.buffs` 两遍。一局几千次调用 × buff 数几十 → 可优化但不是瓶颈。
- ⚠️ 全局 buff 的 ownerId 编码 `-2`(队0)/`-1`(队1)/`-3`(双方) 是魔法数字，且 `addBuffProcessor`（`core/tasks/add-buff.ts:14`）对全局 buff 直接 `target = null`。

---

## 5. 鬼火 Mana

`core/mana.ts:1-13`：

```ts
export default class Mana {
    num: number;          // 当前鬼火数量
    progress: number;     // 鬼火进度条
    preProgress: number;  // 每次恢复多少
    initNum: number;
    constructor(initNum: number) { this.initNum = initNum; this.num = initNum; this.progress = 0; this.preProgress = 5; }
}
```

**初始化**：`core/battle.ts:88` 的 `this.manas = [new Mana(4), new Mana(4)]` —— 双方各 4 点，**每队独立**。

**消耗**：`core/tasks/use-skill.ts:16-23`

```ts
case 1: {
    battle.log(...);
    if (data.cost > 0) battle.actionUpdateMana(source.entityId, source.teamId, -data.cost, Reasons.COST);
    return 2;
}
```
可选性检查在 `core/tasks/turn.ts:79-83`：`if (cost > 0) { if (!mana || mana.num < cost) return false; }`（只用来过滤可选项，**`actionUseSkill` 自身不做二次校验**）。

**回复/上限**：`core/tasks/update-mana.ts:9-21`

```ts
export default function updateManaProcessor(battle, data, _) {
    const mana = battle.manas[data.teamId];
    if (!mana) return 0;
    mana.num = mana.num + data.num;
    if (mana.num < 0) return 0;              // ★ 已经写进去了才 return，负数会留着；且 step 0 = 出错
    if (mana.num > 8) {
        mana.num = 8;
        battle.addEventProcessor(EventCodes.MANA_OVERFLOW, 0, data);
    }
    return -1;
}
```
→ **上限 8，溢出时发 `MANA_OVERFLOW` 事件**。

**进度条推进**：`core/tasks/turn.ts:58-61`（**该队每个单位行动时 +1**）：

```ts
case 3: {
    battle.actionUpdateManaProgress(0, currentEntity.teamId, 1, Reasons.RULE);
    return 4;
}
```
`core/tasks/update-mana-progress.ts:9-18` 把 `progress` 夹在 `[0, 5]`（`// TODO: 追月神用的事件`）。

**结算**：`core/tasks/turn.ts:149-158`（回合结束阶段最后一步）：

```ts
case 7: {
    const mana = battle.manas[currentEntity.teamId];
    if (!mana) return 0;
    if (mana.progress >= 5) {
        mana.progress = 0;
        mana.preProgress = Math.min(5, mana.preProgress + 1);
        battle.actionUpdateMana(0, currentEntity.teamId, mana.preProgress, Reasons.RULE);
    }
    return -1;
}
```

⚠️ **`preProgress` 初值就是 5、上限也是 5，所以 `Math.min(5, preProgress+1)` 永远等于 5** —— 每次满格固定 +5 鬼火，「随回合递增」的意图没实现（官方也是固定 +5，所以结果碰巧对，但代码意图与实现不符）。

**跨回合处理**：`num` / `progress` 直接存在 `Mana` 对象上，`Battle` 持有两个 `Mana` 实例，天然跨回合；没有回目重置概念（`reset()` 被注释掉，`core/mana.ts:16-19`）。

**缺陷**：

- `core/tasks/update-mana.ts:15-16`：负数不夹取，且 `return 0` 会让**整场战斗静默终止**（`core/battle.ts:146`），`winner` 保持 -1。
- `EventCodes.MANA_CHANGE`（`core/constant.ts:38`）声明了但**从未派发**（grep 确认只有声明处一处）。

---

## 6. 技能 Skill

### 6.1 定义方式：**TS 接口 + 硬编码对象字面量 + 少数通用类**，不是 DSL

`core/skill.ts:8-18`：

```ts
export default interface Skill {
    no: number;
    name: string;
    cost: ((battle: Battle, entityId: number) => number) | number;
    hide?: boolean;
    handlers?: Handler[];                                                            // 事件钩子（被动的主要载体）
    passive?: boolean;
    text?: string;
    target?: ((battle: Battle, entityId: number) => number[]) | SkillTarget;          // 合法目标
    use?: (battle: Battle, sourceId: number, selectedId: number) => number | void;    // 实际效果
}
export enum SkillTarget { ENEMY, TEAM, SELF }
```

三种写法并存：

1. **通用类**（`core/heroes/common/`）：
   - `NormalAttack`（`core/heroes/common/normal-attack.ts:4-6`）→ 继承 `SingleAttack(1, name, 1.25, cost=0, times=1, isNormalAttack=true, FR=0.01)`
   - `SingleAttack`（`core/heroes/common/single-attack.ts:30-36`）：`for (i<times) battle.actionAttack(Attack.build(targetId, sourceId).rate(...).FR(...).shouldComputeCri().single().normalAttack(...).end())`
   - `GroupAttack`（`core/heroes/common/group-attack.ts:26-39`）：对 `battle.getTeamEntities(selected.teamId)` 每人一段
   - `BuffSkill`（`core/heroes/common/buff-skill.ts:20-31`）：对己方全体依次 `actionAddBuff`
2. **对象字面量 + 闭包**（绝大多数）：如 `core/heroes/n/houkikami.ts:5-28`、`core/heroes/ssr/shutendoji.ts:23-36`、`core/heroes/ssr/miketsu.ts:168-191`
3. **被动 = 技能对象里挂 `handlers` 数组**：如大天狗 `core/heroes/ssr/ootengu.ts:32-107`（1 个技能挂 5 个 handler）、酒吞 `core/heroes/ssr/shutendoji.ts:39-85`（1 个技能挂 2 个 handler）

注册在 `core/heroes/index.ts:28-64`：

```ts
function build(no, tags, ai, ...skills) { HeroBuilders.set(no, function (): Entity { ... }); }
HeroTable.forEach((_, no) => { build(no, ['simple'], normalAI, new NormalAttack('普通攻击')); });   // 141 只全部先给「普攻+傻瓜AI」
function HERO(name: string, skills: Skill[], ai: AI = normalAI) {
    const dd = HeroData.find(d => d.name === name.trim());
    if (!dd) throw new Error('找不到[' + name + ']');
    build(dd.id, [], ai, ...skills);            // 覆盖注册
}
```

### 6.2 可扩展性评价

- ✅ **加一只式神确实很轻**：写一个 `xxx_skill1` 对象 + 一行 `HERO('名字', [...])`。事件钩子、目标选择、代价函数都是可选的，不需要继承任何基类。
- ✅ **`Attack.build(...)` 的 builder（`core/attack.ts:4-120`）可读性好**：`.rate(1.31).shouldComputeCri().single().normalAttack().end()`。
- ❌ **没有 DSL / 没有数据驱动**：所有技能都是 TypeScript 代码，**必须重新编译**才能加式神。2026 版若要做「策划填表 → 自动生成」，这套结构需要一层中间表示（IR）+ 解释器。
- ❌ `Skill.handlers` 是**可选的、且与 `Entity.skills` 绑定**；`addEventProcessor` 只扫 `entity.skills`（`core/battle.ts:206`），所以**没有「技能之外的 buff 也能挂 handler」这条通路** —— 例如「某个 buff 自身监听回合结束」做不到，必须做成技能被动。
- ❌ **技能去重/覆盖机制缺失**：README 明确 `- [ ] 技能去重以及覆盖机制`。
- ❌ `hide: true` 的隐藏技能（如御馔津 `miketsu_skill4`，`core/heroes/ssr/miketsu.ts:63-67`）靠 `core/tasks/turn.ts:78` 的 `if (s.hide) return false` 屏蔽，但**伪回合里又能直接 `actionUseSkill(4, ...)`**（`miketsu.ts:22,25,27`）—— 「隐藏技能 = 事件专用技能」这个模式本身是合理的。
- ❌ `Skill.cost` 允许函数，但 `core/tasks/turn.ts:79` 和 `core/tasks/turn.ts:110` 各算一次，**没有缓存**，代价函数有副作用就会出错。
- ❌ `core/buff.ts:3` 用了 `export const enum EffectTypes`（全部 9 个 enum 里唯一的 `const enum`）。**`const enum` 不是可擦除语法**，在现代工具链（SWC/esbuild/Babel/Node `--experimental-strip-types`/Vite）下会直接报错，2026 版必须改成普通 `enum` 或 `as const` 对象。

---

## 7. AI

**全文只有 12 行。** `core/heroes/ai/index.ts:5-16`：

```ts
export function normalAI(battle: Battle, turnData: TurnProcessing, mana: Mana | null, selections: SelectableSkill[]): SkillSelection | null {
    for (const s of selections) {
        if (s.no === 1 && s.targets.length) {
            return { no: s.no, targetId: battle.getRandomOne(s.targets) };
        }
    }
    return null;
}
```

- **能力级别：L0 —— 「永远用 1 技能打随机目标」。** 没有鬼火规划、没有目标优先级（残血/最高攻/控制位）、没有技能循环、没有连招、没有对局势的判断。
- `core/entity.ts:153` 的默认 `ai: AI = () => ({no: 0, targetId: 0})` 会让选择落到 `core/tasks/turn.ts:134` 的 `if (selection && selection.no && selection.targetId)` 判空 → **这一回合什么都不做**。
- `core/heroes/index.ts:60` 的 `HERO(name, skills, ai = normalAI)` 意味着 **14 只「已实现」式神里没有一只写了专属 AI**。御馔津装了 4 个技能（含 3 费「燃爆·破魔箭」、3 费「狐狩界」），AI 永远只会放 1 技能「一矢」。酒吞永远不会用 3 费「狂啸」。
- `core/heroes/ai/index.ts:18-70` 里躺着两段**注释掉的旧 AI**（赤舌、天邪鬼赤），说明作者试过、放弃了。
- ⚠️ README 把 `- [x] AI机制实现` 打了勾 —— **勾是虚的**。

对「对弈竞猜胜率预测」来说这是**最致命的缺陷**：官方对弈里 AI 是官方 AI，你模拟时的 AI 是「只会平A的傻瓜」，模拟出的胜率与真实对局无因果关系。

---

## 8. 预测能力（src/views/Predict.vue）

**结论：真的跑了 N 场模拟，默认 100 场，上限 1000 场（`src/views/Predict.vue:6,82`）。但没有置信区间，没有种子控制，统计口径还有 bug。**

`src/views/Predict.vue:92-109` 全文核心：

```js
getWinner() {
    this.winner0 = this.winner1 = this.process = 0;
    this.total = this.count;
    const fn = () => {
        if (!this.total) return;
        this.total--
        const battle = new Battle(this.$store.state.team0.concat(this.$store.state.team1));
        // eslint-disable-next-line no-empty
        while (battle.process()) {
        }
        if (battle.winner === 0) this.winner0++;
        else if (battle.winner === 1) this.winner1++;
        else this.error++;
        setTimeout(fn, 10);                 // 每场之间让出 10ms 给 UI
    }
    setTimeout(fn, 10);
}
```

模板里的展示（`src/views/Predict.vue:6-9`）：

```html
<a-input-number :min="1" :max="1000" v-model="count"/>
<a-button @click="getWinner" :loading="!!total">预测</a-button>
{{total ? ' 剩余计算次数' + total : ''}} 队伍1赢{{winner0}}次({{Math.floor(winner0/count*100)}}%)
队伍2赢{{winner1}}次({{Math.floor(winner1/count*100)}}%)
```

**逐条核对：**

| 问题 | 事实 |
|---|---|
| 跑多少场？ | 默认 `count: 100`（`src/views/Predict.vue:82`），滑块上限 1000 |
| 是蒙特卡洛吗？ | 是。每场 `new Battle(...)` → `while (process())` |
| **有置信区间吗？** | **没有。** 只有两个点估计和一个 `Math.floor`（不是 round，也不是 Wilson/Clopper-Pearson 区间）。1000 场时 1 个百分点 ≈ 10 场，标准误约 1.6%，**报「52%」和「50%」在统计上不可区分** |
| **种子可控吗？** | **不可控。** `new Battle(...)` 不传第二个参数 → `core/battle.ts:77` 的 `seed = Date.now()`。同一队伍点两次「预测」得到不同数；而且如果两次 `Date.now()` 落在同一毫秒就会拿到相同种子（有 `setTimeout 10ms` 兜着，实践中概率低，但语义上完全没保证） |
| **分母用对了吗？** | **没有。** `winner0/count` 用 `count` 而不是 `winner0+winner1`；`error`（引擎 step 0 静默终止、`turn>=1000` 超时等失败场次）**被默默地算进分母**，导致两边胜率之和 < 100% |
| 效率 | 实测单场 0.82ms（关日志）/ 23ms（开日志，**单场 1118 行 console.log**）。1000 场 = **0.8 秒真实算力，但被 `setTimeout(...,10)` 拖成至少 10 秒**，浏览器下叠加 console 开销可能到 30 秒以上 |
| 前端的免责声明 | `src/views/Predict.vue:3`：`注意本项目尚在开发中，必须保证下面列表中所有式神均已实现ai和技能才有参考价值` —— 作者自己知道。**而现实是 141 只里只有 14 只有技能、0 只有 AI** |

**结论**：它是一个**能跑的蒙特卡洛采样器**，但离「可用于对弈竞猜的胜率估计器」差三件事：**可复现的种子**、**正确的统计口径**、**真实的 AI/式神库**。

---

## 9. 引擎与 UI 的耦合程度

**结论：`core/` 与 Vue 完全解耦，可以脱离浏览器跑；但项目本身没有提供 Node 侧批量模拟入口，唯一的 node 入口是个玩具脚本。**

1. **依赖**：全量扫描 `core/**/*.ts` 的 `from '...'`，非相对路径的只有 `lodash` 和 `random-js`。**没有任何 `vue`/`vuex`/DOM/Phaser 引用**。
2. **实测**：把 `core/` 拷到隔离目录、`npm i lodash random-js`、`npx tsc --module commonjs`、`node out/probe.js 200` → **200 场跑通，team0=100 / team1=100，5.33 ms/场（含日志）**。
3. **唯一 Node 入口**：`package.json` 的 `"debug": "ts-node core/debug.ts"`。而 `core/debug.ts`（36 行）做的事是：随机抽 10 只式神 → `new OrdinaryBattle` → `while (this.process()) sleep(100)`（**真的用忙等 `while (Date.now() - current < ms);` 卡 100ms**，`core/debug.ts:5-9,13-15`）→ `console.log('游戏结束...')`。**不是批量入口。**
4. **没有测试**：`package.json` 的 `"test": "echo \"Error: no test specified\" && exit 1"`；`tsconfig.json` 的 `include` 里写了 `tests/**/*.ts` 但仓库里**根本没有 `tests/` 目录**。CI（`.github/workflows/blank.yml`）只做 `npm install && npm run build` + 发 Pages，**不跑任何测试**。
5. **UI 侧的调用方式**：
   - `src/views/Predict.vue:24` / `src/views/Debug.vue:54` / `src/views/Visual.vue:218`：`import {Battle, HeroBuilders, BattleProperties} from '../../core'`
   - `src/store/index.ts:3` 直接 `import datas from '../../core/fixtures/heros.json'`
   - 也就是说：**耦合方向是 UI → core，core 从不反向依赖**。可以直接把 `core/` 抽成独立 npm 包。
6. `src/views/Visual.vue:380` 写了 `new Battle(data, Date.now(), true)` —— **第三个参数 `Battle` 构造函数根本不接受**（`core/battle.ts:77` 只有 `(datas, seed)`），是死代码/笔误。
7. `src/visual/*.ts`（Phaser 版战斗场景，223+46+39 行）在 `src/views/Visual.vue:215-216,382-392` 里**被整段注释掉**，实际走的是 Vue 模板渲染。`src/visual/battle-scene.ts:178-222` 的 `syncData()` 也是全注释。**这块是死代码。**

---

## 10. 致命缺陷清单 + 移植建议

### 10.1 必须重写（有明确 bug 证据）

| # | 缺陷 | 位置 | 后果 |
|---|---|---|---|
| F1 | 暴击率被写成爆伤 | `core/tasks/attack.ts:80` `testHit(attackInfo.criticalDamage)`；`attackInfo.critical` 是死代码 | **100% 暴击**（实测 47/47）。整个伤害量级翻约 1.5 倍，所有胜率无意义 |
| F2 | 治疗暴击同样写错 | `core/tasks/healing.ts:56` | 治疗恒暴击 |
| F3 | 效果抵抗不拦截 | `core/tasks/add-buff.ts:46-50`（`isRes` 后无 `return -1`） | 控制/减益近乎 100% 命中，抵抗属性完全无效 |
| F4 | 治疗公式结构错误 | `core/tasks/healing.ts:64`：`origin*rate*(1-down) + (1+up)*(isCri?criDmg:1)` | 增疗被加成常数；暴击只放大那个 `1` |
| F5 | 行动条未绑定种子 | `core/battle.ts:87` `new Runway()` vs `core/runway.ts:29` `random = Math.random` | 实测 **61/100 同种子结果不同**。无法复现、无法做配对实验、无法审计 |
| F6 | 同归于尽判队伍 1 胜 | `core/battle.ts:240-249`：第 1 个分支 `c0===0 && c1>=0` 的 `>=0` 应为 `>0`，第 3 个分支 `c0===0 && c1===0` **永远不可达** | 双杀时误判队伍 1 胜 |
| F7 | `Attack.limit` / `Healing.limit` 声明但从不读取 | `core/attack.ts:24-27`、`core/healing.ts:21-24` vs `core/tasks/attack.ts:58-60` | 帚神 `core/heroes/n/houkikami.ts:19-22` 等「上限类」技能静默失效 |
| F8 | 鬼火可为负 + 静默终止 | `core/tasks/update-mana.ts:15-16` | 负鬼火残留；`return 0` 让 `core/battle.ts:146` 结束整场，`winner=-1` |
| F9 | 全局 buff + 概率 → 静默终止 | `core/tasks/add-buff.ts:39` `if (!target) return 0;` | 带 `.probability()` 的全局/结界 buff 会让整场战斗中止 |
| F10 | `waitInput` 死循环 | `core/tasks/wait-input.ts:12-17` 永远 `return 1`；`core/battle.ts:158-163` 永远返回 true | 一旦单位 `waitInput=true`，`src/views/Predict.vue:100` 的 `while` **会挂死浏览器**（`src/views/Visual.vue:379` 正是设了 `waitInput: true`） |
| F11 | 超时判定在掉条之后 | `core/tasks/battle.ts:21-25` | 第 1000 回合单位白掉条 |
| F12 | 预测分母错误、误差场次被吞 | `src/views/Predict.vue:8-9,102-104` | 胜率系统性偏低，两边之和 ≠ 100% |
| F13 | `NO_DISPEL='CanDispel'` / `NO_REMOVE='CanRemove'` 名实相反 | `core/constant.ts:85-86` | 且**全代码库没有任何一处按这两个 flag 过滤驱散** |
| F14 | 日志 bug：`buff.ownerId == -1 ? getEntity(...) : null` | `core/tasks/remove-buff.ts:20` | 判定反了，永远打印「全局」（实测日志中确实出现 `全局 失去 【庇护】 Buff`） |
| F15 | `const enum EffectTypes` | `core/buff.ts:3` | 现代构建链（SWC/esbuild/Vite/Node 类型擦除）不支持，必须改 |

### 10.2 完全缺失（要做 2026 版必须从零建）

| 缺失项 | 证据 |
|---|---|
| **御魂系统** | `InititalData.equipments`（`core/battle.ts:41`）**声明后从未被读取**；`Control.EQUIPMENT_FORBID` 无任何消费方；README `- [ ] Equipment(基础御魂)` |
| **召唤物** | `Entity.summonToken`（`core/entity.ts:29,46`）**只被赋值 false，从未被读取**；README `- [ ] 召唤物` |
| **额外回合** | README `- [ ] 额外回合`；代码里只有 `fakeTurns`（伪回合，`core/battle.ts:176-184`）。设计文档 `回合结算过程3.0.docx` 里「额外回合」出现 27 次 |
| **复活** | README `- [ ] 复活`；`core/tasks/attack.ts:121-136` 死亡即清 buff + `runway.freeze`，无逆操作 |
| **护盾** | `BuffBuilder.shield()` 能建；`core/tasks/attack.ts:100` 是 `//TODO: 计算盾的抵消伤害` |
| **吸血 / 忽略防御 / 真实伤害 / 传导 / 无视护盾** | `HP_STEAL`、`DEF_NEG`、`DEF_NEG_P`、`REAL`、`CONDUCTION`、`NO_SHIELD` 全部**只有声明/写入，无读取**（逐个 grep 确认） |
| **间接伤害独立结算阶段** | 只有 `core/tasks/attack.ts:77` 的「防御 0 必暴」特判；官方在「回合结束阶段第 1 步」 |
| **回合阶段顺序与官方对齐** | 官方：回合开始 → 行动 → **回合结束**（间接伤害 → buff 减 1 → 各种回合结束触发 → 鬼火推进 → 伪回合 → 额外回合）。代码把 buff 递减放在**回合开始**（`core/tasks/turn.ts:38-56`），鬼火推进放在**行动前**（`core/tasks/turn.ts:58-61`） |
| **回目 / 多波** | README `- [ ] 回目机制` / `- [ ] 跨回目机制探究（需要帮助）` |
| **AI 决策层** | 见第 7 节 |
| **批量模拟入口 + 统计层** | 见第 9 节。无 CLI、无 Worker、无置信区间、无种子管理 |
| **最大生命值减少时同步当前生命** | README `- [ ] 最大生命值减少时影响生命` |
| **`TAKEN_SELECT` / `MANA_CHANGE` 事件** | `core/constant.ts:27,38` 声明后从未派发 |
| **式神覆盖** | 141 条面板数据中只有 14 只有技能、**0 只有 AI**。README 自述 `N (11/12)`、`R (0/35)`、`SR (0/54)`、`SSR (2/28)`、`SP (0/11)` |

### 10.3 值得原样继承（真正的资产）

| 资产 | 位置 | 为什么值得留 |
|---|---|---|
| **状态机任务树 + `process()` 单步解释器** | `core/task.ts`、`core/battle.ts:138-174` | 一份代码同时支撑「单步调试」和「批量模拟」；天然可暂停/可快照；比 generator/coroutine 更易序列化与调试 |
| **事件总线 `addEventProcessor` + `Handler{code,range,priority,passive}`** | `core/battle.ts:202-230`、`core/handler.ts`、`core/tasks/event.ts` | 范围过滤 + 优先级 + 被动封印三件套齐全，新增拦截点成本极低 |
| **「共享 processing 对象就地打标」的反馈协议** | `core/tasks/add-buff.ts:27-30`（`cancel`）+ `core/heroes/ssr/ootengu.ts:76-93` | 比返回值可控、可组合、可被多个 handler 链式修改 |
| **属性管线 `BattleProperties` + `Effect{propertyName,value,effectType}` + `getComputedProperty`** | `core/constant.ts:113-133`、`core/buff.ts:3-15`、`core/battle.ts:301-336` | 五个 `EffectTypes` 覆盖绝大多数 buff；`ADD_RATE` 基于 origin 避免百分比自乘；`DEPEND_ON` 实时求值不需要清理钩子 |
| **Runway 连续时间模型** | `core/runway.ts:55-112` | 数学上正确、无逐帧误差、`minT` 保证恰好一人到终点。**只需修一行：把 seeded RNG 传进去** |
| **`Buff` 链式 Builder** | `core/buff.ts:18-161` | `.name().countDown().stamp().enchantment().probability().control().dependOn().buffAP()` 覆盖面广、可读性高 |
| **`Attack.build()` / `Healing.build()` Builder** | `core/attack.ts:4-120`、`core/healing.ts:6-42` | 参数命名与官方术语对齐（single/group/indirect/real/normalAttack/ignoreSource…），是写新技能的正确抽象 |
| **`core/` 零 UI 依赖** | 全量依赖扫描 | 可直接抽包、可在 Node/Worker 里跑，实测通过 |
| **141 只式神面板 fixture + `fix_data.js` 生成管线** | `core/fixtures/`、`core/fixtures/hero-data.ts`（3102 行） | 六星满级 atk/hp/def/spd/cri/cri_dmg + 觉醒描述 + 日英罗马音，来源是 xlsx，**可再生**；2026 版可沿用这套 pipeline 只换数据源 |
| **`origin_data/阴阳师式神信息表V3.2.1.xlsx`** | `core/fixtures/origin_data/` | 内含 **`御魂表` worksheet**（sheet 名实测：式神表/式神名称对照/御魂表/超鬼王/升级经验表…），2026 版做御魂系统时是现成数据源 |

---

## 11. 文件 → 职责 → 完成度 → 移植建议

| 文件 | 职责 | 完成度 | 移植建议 |
|---|---|---|---|
| `core/task.ts` (27行) | Task 节点 / Processor 类型定义 | 100% | **直接复用**（改成泛型 `data: T`） |
| `core/battle.ts` (447行) | 主循环、任务树、事件分发、动作 API、属性计算、胜负判定 | 80%，`judgeWin`/Runway 播种/超时顺序有 bug | **改写**：保留 `process()`/`addProcessor`/`addEventProcessor`/`getComputedProperty` 骨架，重写 `judgeWin`、修 `new Runway(random)`、事件分发加索引 |
| `core/tasks/battle.ts` (42行) | 局级主循环（BATTLE_START→SENKI→循环） | 90% | **改写**：补「回目/多波」、把 `turn>=1000` 判定提到 `computeNext` 之前 |
| `core/tasks/turn.ts` (163行) | 回合 7 阶段：控制检查→buff减1→鬼火推进→选技能→AI→结束事件→鬼火结算 | 70%，阶段顺序与官方不符 | **改写**：按官方「回合开始/行动/回合结束」重排；buff 递减移到回合结束 |
| `core/tasks/fake-turn.ts` (48行) | 伪回合：ACTION_START → 自定义 processor → ACTION_END | 70% | **改写**：区分 A/B/C 三类伪回合；现在 `addFakeTurn` 按 `currentId` **同名覆盖**（`core/battle.ts:178-183`），同一单位一回合只能拿 1 个伪回合 |
| `core/tasks/attack.ts` (162行) | 攻击 8 步：准备→攻击前事件→受击事件→暴击→伤害→落血→完成回调→下一段 | 60%，F1/F7/护盾/吸血/真实/传导/间接全缺 | **重写**（这是最需要重写的文件） |
| `core/tasks/healing.ts` (90行) | 治疗 6 步 | 40%，F2/F4 | **重写** |
| `core/tasks/event.ts` (34行) | 事件逐个串行执行 + 被动封印跳过 | 90% | **直接复用**（补 `data` 泛型） |
| `core/tasks/add-buff.ts` (73行) | 加 buff：LOG→cancel 判定→命中/抵抗→BEFORE_BUFF_GET→同名替换+push | 50%，F3/F9 | **重写**命中抵抗段与全局 buff 分支 |
| `core/tasks/remove-buff.ts` (31行) | 移除 buff（BEFORE_BUFF_REMOVE→splice→BUFF_REMOVE） | 85%（F14 只是日志） | **改写**：补 NO_DISPEL/NO_REMOVE 过滤、驱散优先级 |
| `core/tasks/use-skill.ts` (30行) | 扣鬼火 → 调 `skill.use()` | 90% | **直接复用** |
| `core/tasks/update-mana.ts` (22行) | 鬼火增减、上限 8、溢出事件 | 70%，F8 | **改写**：负数夹取；错误码不要复用 step 0 |
| `core/tasks/update-mana-progress.ts` (19行) | 鬼火条进度增减，夹 [0,5] | 80% | **改写**（`// TODO: 追月神用的事件`） |
| `core/tasks/update-runway.ts` (10行) | 拉条/推条 | 95% | **直接复用** |
| `core/tasks/wait-input.ts` (19行) | 手动输入等待 | 30%，F10 死循环 | **改写**：加超时/默认 AI 回退 |
| `core/tasks/update-hp.ts` (45行) | 通用 HP 变更 | **0%（整文件已注释掉）** | **丢弃** |
| `core/tasks/index.ts` (42行) | 导出聚合 | 100% | 直接复用（删掉 update-hp 的注释残留） |
| `core/entity.ts` (162行) | 实体属性/skills/tags/battleData/turnData/AI 槽 | 70%，`summonToken` 死字段 | **改写**：加召唤物、位置、复活、最大生命变更同步 |
| `core/buff.ts` (197行) | Buff 数据模型 + 链式 Builder + Effect/EffectTypes | 85% | **改写**：`const enum`→`enum`；加 B/D/G 分层字段；`Effect` 支持函数值 |
| `core/runway.ts` (157行) | 行动条：连续时间推进、到点选取、拉推条、冻结 | 90%（模型正确，播种漏了） | **改写一行后直接复用** |
| `core/mana.ts` (33行) | 鬼火数值容器 | 70%（一半被注释） | **改写**：把 update-mana 的逻辑收进来 |
| `core/skill.ts` (30行) | Skill / SelectableSkill / SkillSelection 接口 | 90% | **改写**：加数据驱动 IR，支持外部配置 |
| `core/attack.ts` (155行) | Attack 数据模型 + AttackBuilder + AttackParams | 80%（`limit` 未接线） | **改写**：接上 `limit`，把参数真正落到管线里 |
| `core/healing.ts` (66行) | Healing 数据模型 + Builder | 75%（`limit` 未接线） | **改写** |
| `core/constant.ts` (150行) | Control/EventCodes/AttackParams/BuffParams/HealingParams/BattleProperties/Reasons/EventRange | 85%（多处声明即死） | **直接复用**：修 `NO_DISPEL/NO_REMOVE` 名实相反，删死枚举 |
| `core/handler.ts` (11行) | Handler 接口 | 100% | **直接复用** |
| `core/utils.ts` (5行) | `eps`/`feq` | 100% | **直接复用** |
| `core/index.ts` (17行) | 包出口 | 100% | 直接复用 |
| `core/debug.ts` (36行) | Node 冒烟脚本（忙等 sleep 100ms） | 10% | **丢弃**，换成正经 CLI/基准脚本 |
| `core/heroes/index.ts` (136行) | 式神注册表：141 只默认「普攻+normalAI」，14 只 `HERO()` 覆盖 | 14/141 有技能，0 有 AI | **改写为数据驱动**：技能从配置读，保留 `HERO()` 作为逃生舱 |
| `core/heroes/ai/index.ts` (71行) | `normalAI`：用 1 技能打随机目标；另有 58 行注释掉的旧 AI | **5%** | **重写**：这是 2026 版的核心竞争力所在 |
| `core/heroes/common/normal-attack.ts` (7行) | 普攻 = SingleAttack(1, rate 1.25, FR 0.01) | 100% | **直接复用** |
| `core/heroes/common/single-attack.ts` (37行) | 单体多段暴击技能 | 95% | **直接复用** |
| `core/heroes/common/group-attack.ts` (40行) | 群体多段技能 | 95% | **直接复用**（注意它用 `getTeamEntities(selected.teamId)` 而非敌方集合，混乱时语义会怪） |
| `core/heroes/common/buff-skill.ts` (33行) | 对己方全体加 buff 的技能 | 95% | **直接复用** |
| `core/heroes/ssr/ootengu.ts` (108行) | 大天狗：普攻/被动(庇护+雄姿英发)/群体 4 段 | 90% | **改写为示例**：事件钩子写得很标准，可当移植模板 |
| `core/heroes/ssr/shutendoji.ts` (130行) | 酒吞：狂气多段普攻/被动层数/狂啸形态+吸血 | 85%（`HP_STEAL` 未被消费） | **改写**：接上吸血 |
| `core/heroes/ssr/miketsu.ts` (191行) | 御馔津：一矢伪回合/狐狩界结界+灵符/破魔箭 | 90%（依赖伪回合与全局 buff，AI 不会用） | **改写**：这是「结界/依赖型 buff」的最佳参考 |
| `core/heroes/n/houkikami.ts` (29行) | 帚神：偷攻普攻 + 群体 1.31 | 80%（`limit` 失效） | **改写**：`base`/`limit` 用法的参考样例 |
| `core/fixtures/hero-data.ts` (3102行) | 141 条式神面板，字段 `index/rank/name/atk/hp/def/spd/cri/cri_dmg/evolve/atk_pt/hp_pt/def_pt/total_pt/name_jp/name_en/name_roma/name_kana/id/no`（比 `heros.json` 多 `id/no`） | 数据完整，覆盖 141 只（SR 49 / R 36 / N 26 / SSR 28 / SP 2） | **复用数据 + 重建管线**：2026 版需新增 6 星/御魂/技能等级字段 |
| `core/fixtures/heros.json` (141条) | 同上，无 `id/no`，由 `transfer_data.js` 从 `data.xlsx` 转换 | 同上 | 同上 |
| `core/fixtures/origin_data/transfer_data.js` / `fix_data.js` | `data.xlsx → heros.json`、`V3.2.1.xlsx → hero-data.ts` 的生成脚本 | 100% | **复用**：数据管线思路正确，2026 版换 xlsx 即可 |
| `core/fixtures/origin_data/回合结算过程3.0.docx` | 第三方（风之清-Mnu8）官方结算流程整理，8878 字 | 完整 | **复用为规格书**：这是本项目所有阶段划分的依据，2026 版应逐条对照实现 |
| `core/fixtures/origin_data/阴阳师式神信息表V3.2.1.xlsx` | 式神表 + **御魂表** + 升级经验表等 15 个 sheet | 完整 | **复用**：御魂系统的现成数据源 |
| `src/views/Predict.vue` (121行) | 竞猜预测页：跑 N 场取频率 | 40%，F12、无种子/无 CI | **丢弃重写**：改成 Web Worker 跑 10 万场 + Wilson 区间 + 固定种子 |
| `src/views/Debug.vue` (134行) | 步进调试页：单步 + 任务树 dump + 属性表 | 80% | **改写复用**：`battle.dump()` 的树渲染（`src/views/Debug.vue:101-116`）直接可用 |
| `src/views/Visual.vue` (502行) | 可视化战斗页：行动条/血量/鬼火/buff/手动选技能 | 75% | **改写复用**：`dump()`（`src/views/Visual.vue:266-360`）是很好的「引擎→视图」适配层样例 |
| `src/views/Hero.vue` (88行) | 式神列表：`ok: hero.hasTag('simple') ? '否' : '是'` | 100% | **复用**：这个 `simple` tag 是「实现覆盖率」的现成标记 |
| `src/views/Team.vue` (109行) | 队伍录入：面板 8 项可手改 | 90% | **复用**（可加御魂槽） |
| `src/store/index.ts` (29行) | Vuex：随机初始队伍 + 改成员 | 95% | **复用/改写**（换 Pinia） |
| `src/visual/*.ts` (308行) | Phaser 战斗场景/血条/鬼火条 | **死代码（调用处全被注释）** | **丢弃** |
| `package.json` / `tsconfig.json` | `debug: ts-node core/debug.ts`；`test` 未实现；`include` 里写了不存在的 `tests/` | 60% | **改写**：加 vitest + CLI + Worker 入口 |

---

## 12. 给「2026 版对弈竞猜胜率模拟器」的落地建议

### 12.1 复用优先级（按 ROI 排序）

1. **抄 `core/runway.ts` 的连续时间模型**（改 1 行播种），这是全项目最正确的一块。
2. **抄 Task 状态机 + `process()` 单步解释器**，但要给 `data` 加泛型、给事件加「按 code 建索引」的缓存。
3. **抄「属性管线 + BuffBuilder + Effect」三件套**，但要把属性折叠改成官方乘区分层，并补 `SHIELD`/`HP_STEAL`/`DEF_NEG` 的消费端。
4. **抄「processing 对象就地打标」的事件反馈协议**，并把它形式化（明确定义 `cancel`/`override`/`redirect` 三种结果）。
5. **抄 141 只面板数据 + xlsx 生成管线**。

### 12.2 必须新建

- **统计层**：固定种子 + 反事实配对（Common Random Numbers）+ Wilson 置信区间 + 收敛曲线。没有这些，「胜率」只是个噪声数字。
- **性能层**：Web Worker 并行 + 关闭日志 + 事件索引。当前 0.82ms/场（关日志）意味着单核约 1200 场/秒，10 万场约 83 秒单核，8 Worker 约 10 秒——完全可行，但**必须先干掉 `console.log`**（实测开日志慢 28 倍）。
- **AI 层**：这是与官方对弈结果对齐的最大变量。至少要：鬼火阈值决策、技能优先级、目标选择（残血/控制/最高威胁）、形态切换。
- **御魂层**：`core/fixtures/origin_data/阴阳师式神信息表V3.2.1.xlsx` 里的 `御魂表` sheet 是现成数据源。
- **回合阶段重排**：以 `回合结算过程3.0.docx` 为准逐条对齐（尤其是「回合结束阶段」的 11 个步骤）。
- **校验层**：需要一批「已知结果的战斗」golden test（现在项目里 0 个测试）。

### 12.3 一句话总结

> `omj_simulator` 的**架构（任务树 + 事件总线 + 属性管线 + 连续时间行动条）是可以直接继承的，代码实现（伤害/命中/行动条随机数/治疗/AI/统计）几乎全部需要重写**。
> 好消息是引擎本身极轻（`core/` 173KB、50 文件、2 个依赖、0.82ms/场、零 UI 耦合），把它当作 2026 版的**骨架与规格书**，比从零开始划算得多；
> 坏消息是**现在这版跑出来的任何胜率数字都不可信**——F1（必定暴击）和 F5（不可复现）两条就足以否定全部结论。

---

*报告基于 `reference/omj_simulator-master` 的实际源码逐行阅读，以及 `omj_engine_probe/` 中的 4 个探针脚本在 Node v24 上的真实运行结果。所有行号对应当前工作区内的文件内容。*
