# OnmyojiAutoScript 源码考古报告
## 聚焦：对弈竞猜（蛙老板 / FrogBoss）与"截图 → 识别双方 5v5 阵容"可行性

- 仓库：`runhey/OnmyojiAutoScript`（GitHub，master 分支）
- 读取方式：GitHub REST tree API（`git/trees/master?recursive=1`）+ raw.githubusercontent.com 按需下载，**未 clone**
- 取证时间：本次会话；tree 完整未截断（`truncated: false`）
- 仓库规模（实测）：**3471 个 tree 条目 / 3130 个 blob**，其中 `.py` 434 个、图片 2009 张、`.json` 350 个（其中 `tasks/**` 下的规则 json 342 个）、`tasks/` 下 60 个任务模块目录

---

## 0. 结论摘要（先看这一段）

| 问题 | 结论 |
|---|---|
| **1. FrogBoss 是"自动点击下注"还是"识别阵容"？** | **纯自动下注**。它**完全不读取双方 5 个式神**，一行相关代码都没有。 |
| FrogBoss 的下注策略是什么？ | 6 种：押人数多的一方 / 押少的一方 / 抄 B 站（空壳）/ 抄网易大神 27 个博主的投票 / 永远红 / 永远蓝。**没有一种策略看阵容**。 |
| **2. 仓库里有式神头像图库吗？** | **没有。** 全仓库唯一与式神头像相关的位图只有 5 张：`tasks/Duel/ban/*.png`，且**未被任何 `assets.py` 或代码引用**（孤儿文件）。 |
| 仓库里有式神名称词表吗？ | **没有。** 顶层 `assets/` 目录下**只有 i18n**（2 个文件），没有任何图片或式神字典。 |
| **3. OCR 引擎是什么？** | **PaddleOCR via `ppocr-onnx`**（ONNX Runtime CPU 推理），封装在 `module/ocr/`。模板匹配用 **OpenCV `cv2.matchTemplate`（TM_CCOEFF_NORMED）**。 |
| 能否复用成"离线截图 → 结构化数据"管线？ | **可以，而且这是本仓库最有价值的部分。** 但只能复用"感知基础设施"，阵容语义层需要完全自建。 |
| **4. 三个 json 的 schema** | 见第 4 节，含真实片段与字段语义、以及 `assets_extract.py` 的类型判定顺序（有坑）。 |
| **5. 可复用度结论** | 见第 5 节文件级清单。**基础设施 ~70% 可复用，式神识别层 0% 可复用。** |

**一句话给决策者**：OAS 已经解决了"稳定截屏 + ROI 裁剪 + OCR + 模板匹配 + 可视化标注 + 规则代码生成"这整条链路，你可以把它当作**离线截图分析框架**直接复用；但"式神是谁"这件事，OAS 从未做过，头像库、名称表、分类器都要从零建。

---

## 1. 仓库总体结构

```
OnmyojiAutoScript/
├── assets/i18n/             ← 顶层 assets 目录【只有 i18n，无任何图片】
│   ├── en-US.json  (4 B)        # 空
│   └── zh-CN.json  (9374 B, 142 条)  # 仅配置项的中文翻译
├── config/
│   ├── template.json (41 KB)    # 全任务调度配置模板（60 个任务段）
│   └── findjade/find_jade.json
├── dev_tools/
│   ├── assets_extract.py        ★ json → assets.py 代码生成器
│   ├── assets_test.py           # 规则测试
│   └── get_images.py            # 连拍截图工具
├── module/                      ← 感知/设备/配置基础设施
│   ├── atom/                    ★ image.py / ocr.py / click.py / list.py / swipe.py
│   ├── ocr/                     ★ base_ocr.py / ppocr.py / sub_ocr.py / models.py / rpc.py
│   ├── base/                    # timer / decorator / filter / utils / retry / protect
│   ├── device/                  # adb / scrcpy / uiautomator2 截屏与点击
│   ├── config/                  # pydantic 配置模型 + 调度器 + i18n(.xml)
│   ├── server/                  ★ FastAPI 后端 + web/annotator 可视化标注器
│   ├── gui/                     # PyQt/FluentUI 桌面端
│   ├── map/ · handler/ · notify/ · team_flow/
├── tasks/                       ← 60 个任务模块
│   ├── FrogBoss/                ★ 本次重点
│   ├── Duel/                    # 斗技 PvP（不是竞猜！）
│   ├── GameUi/                  ★ 页面注册表 + 路由图
│   └── Component/               # 复用组件（GeneralBattle / SwitchSoul / ReplaceShikigami ...）
└── gui.py · script.py · server.py
```

**关键否定事实（对方案评估最重要）**：
- `assets/` 顶层目录下**只有 `i18n/` 两个 json**，没有任何 `shikigami/`、`hero/`、`avatar/` 之类的图库目录。
- 全仓库 2009 张图片**全部**是 UI 模板（按钮、图标、页面标识），按 `<任务前缀>_<语义>.png` 命名，尺寸从 22×58 到 269×72 不等。
- 文件名含中文的图片**全仓库只有 10 张**，其中 5 张就是式神头像候选（见第 2 节）。

---

## 2. 【问题 1】tasks/FrogBoss 到底做了什么

### 2.1 目录清单（23 个条目）

```
tasks/FrogBoss/
├── script_task.py   13560 B / 323 行   ← 全部业务逻辑
├── assets.py         3941 B            ← 由 assets_extract.py 自动生成
├── config.py          894 B            ← 策略枚举 + 调度配置
└── fb/                                  ← 16 张模板 + 3 个规则 json
    ├── image.json    3328 B  (14 条 image 规则)
    ├── image2.json    488 B  (2 条 image 规则)
    ├── ocr.json       627 B  (3 条 ocr 规则)
    └── 16 张 .png
```

### 2.2 入口：不在页面图里，走"右侧活动栏"

`tasks/FrogBoss/script_task.py` 第 24–26 行：

```python
class ScriptTask(RightActivity, FrogBossAssets, GeneralBattleAssets):
    def run(self):
        self.enter(self.I_FROG_BOSS_ENTER)
```

- `RightActivity.enter()`（`tasks/Component/RightActivity/right_activity.py`）先 `ui_goto(page_main)`，再点 `I_TOGGLE_BUTTON` 展开右侧活动栏，再点目标图标。
- **`tasks/GameUi/page.py` 里没有任何 FrogBoss 的 `Page` 定义**，竞猜不是页面路由图上的节点。这一点对你们很重要：**OAS 没有"竞猜页面识别器"这种东西，只有一张入口图标模板。**

### 2.3 主循环：一个纯状态机

`script_task.py` 第 25–67 行（核心逻辑，逐行真实代码）：

```python
def run(self):
    self.enter(self.I_FROG_BOSS_ENTER)
    while 1:
        self.screenshot()
        # 已经下注
        if self.appear(self.I_BETTED):
            logger.info('You have betted'); break
        # 休息中
        if self.appear(self.I_FROG_BOSS_REST):
            logger.info('Frog Boss Rest'); break
        # 竞猜成功
        if self.appear(self.I_BET_SUCCESS):
            logger.info('You bet win')
            self.detect()
            while 1:
                self.screenshot()
                if self.appear(self.I_BET_LEFT) and self.appear(self.I_BET_RIGHT): break
                if self.appear_then_click(self.I_BET_SUCCESS_BOX, interval=1): continue
                if self.appear_then_click(self.I_REWARD, interval=2): continue      # I_REWARD 继承自 GeneralBattleAssets
                if self.appear_then_click(self.I_NEXT_COMPETITION, interval=4): continue
            continue
        # 竞猜失败
        if self.appear(self.I_BET_FAILURE):
            logger.info('You bet lose')
            self.ui_click_until_disappear(self.I_NEXT_COMPETITION)
            self.detect()
            continue
        # 正式竞猜
        if self.appear(self.I_BET_LEFT) and self.appear(self.I_BET_RIGHT):
            self.do_bet()
            continue
```

**判定"现在在竞猜界面"的唯一依据** = `I_BET_LEFT and I_BET_RIGHT` 两张模板同时命中（就是左右两个"竞猜"按钮的文字图）。**中间那 5v5 的阵容区域，代码从未看过一眼。**

### 2.4 下注决策：全部逻辑（`do_bet`，第 93–141 行）

```python
def do_bet(self):
    logger.hr('do bet', level=2)
    self.screenshot()
    flag_glod_30 = 0
    count_left  = self.O_LEFT_COUNT.ocr(self.device.image)    # ROI (143,496,69,31)  mode=Digit
    count_right = self.O_RIGHT_COUNT.ocr(self.device.image)   # ROI (1105,497,77,32) mode=Digit
    match self.config.model.frog_boss.frog_boss_config.strategy_frog:
        case Strategy.Majority:    click_image = self.I_BET_LEFT if count_left > count_right else self.I_BET_RIGHT
        case Strategy.Minority:    click_image = self.I_BET_LEFT if count_left < count_right else self.I_BET_RIGHT
        case Strategy.Bilibili:    click_image = self.I_BET_LEFT if count_left > count_right else self.I_BET_RIGHT
        case Strategy.Dashen:      click_image = self.get_dashen(count_left, count_right)
        case Strategy.AlwaysRed:   click_image = self.I_BET_LEFT
        case Strategy.AlwaysBlue:  click_image = self.I_BET_RIGHT
        case _: raise ValueError(f'Unknown bet mode: ...')
    logger.info(f'You strategy is {self.config...strategy_frog} and bet on {click_image}')
    self.ui_click_until_disappear(click_image)
    gold_30_timer = Timer(10); gold_30_timer.start()
    while 1:
        self.screenshot()
        if self.appear(self.I_GOLD_30_CHECK): break
        if gold_30_timer.reached(): logger.info('Gold 30 not appear'); break
        if self.appear_then_click(self.I_GOLD_30, interval=3): continue
    # 正式下注
    while 1:
        self.screenshot()
        if self.appear(self.I_BETTED): break
        if self.appear_then_click(self.I_BET_SURE, interval=2) and flag_glod_30 == 1: continue
        if self.appear_then_click(self.I_GOLD_30, interval=2): flag_glod_30 = 1; continue
        if self.appear_then_click(self.I_UI_CONFIRM, interval=2): continue
        if self.appear_then_click(self.I_UI_CONFIRM_SAMLL, interval=2): continue
```

**决策输入只有两个整数**：`count_left` / `count_right`（左右两侧"已有多少人押注"的数字，来自 OCR）。**没有任何关于式神、阵容、克制关系的信息。**

### 2.5 `Dashen` 策略：抄网易大神博主的投票（第 165–311 行）

这是全文件最"高级"的策略，但本质是**爬虫 + 正则 + 计票**：

```python
red_regex  = re.compile(r'(押红|押左|压红|压左|红方|红色|我红|我左|红优|左|红六|红七|红八|红九|红十|91开|82开|73开|64开)')
blue_regex = re.compile(r'(押蓝|押右|压蓝|压右|蓝方|蓝色|我蓝|我右|蓝优|右|蓝六|蓝七|蓝八|蓝九|蓝十|19开|28开|37开|46开)')

def analyze_bet(body_text):
    red_span = 9999; blue_span = 9999
    if red_regex.search(body_text):  red_span  = red_regex.search(body_text).start()
    if blue_regex.search(body_text): blue_span = blue_regex.search(body_text).start()
    if red_span < blue_span:  return 'LEFT'
    elif red_span > blue_span: return 'RIGHT'
    return 'Unknown'
```

- 数据源：`https://inf.ds.163.com/v1/web/feed/basic/getSomeOneFeeds?someOneUid=<uid>` 与 `.../facade?feedId=<id>`。
- `uids` 是**硬编码的 27 个博主名单**（面灵气喵、余岁岁、七面相、待机中的徐ok、雯雯、晨时微凉…）。
- 最后按 `count_uper_left` vs `count_uper_right` 多数决；平票时退回"押少数人一方"。

**这里有两个真实 bug（考古价值）**：
1. `uids` 有 27 个条目但**只有 26 个唯一 uid** —— `薛定谔家查查尔`(第 250 行) 与 `查查尔`(第 261 行) 是**同一个 uid `d9dc2a75497c4a91b2db1e909a36544d`**，该博主被**重复计票两次**。
2. `Strategy.Bilibili` 与 `Strategy.Majority` 的代码分支**完全相同**；对应的 helper `get_bilibili()` 是 `pass` 空壳（第 158–163 行）——B 站抄作业策略**从未实现**。

### 2.6 一个"读了但不用"的胜负检测

```python
def detect(self) -> bool:
    """检测是左边赢了还是右边赢的 :return: True 左边赢了"""
    if self.appear(self.I_SUCCESS_LEFT) and self.appear(self.I_FAILURE_RIGHT):
        result = True;  logger.info('Left win')
    elif self.appear(self.I_SUCCESS_RIGHT) and self.appear(self.I_FAILURE_LEFT):
        result = False; logger.info('Right win')
    else:
        result = True
    return result
```

调用点只有第 42 行和第 58 行的裸调用 `self.detect()` —— **返回值被丢弃**。也就是说：结果被识别了，但**不落库、不回传、不影响任何后续决策**，没有学习闭环。对你们而言，这意味着 **OAS 里不存在任何"竞猜历史 + 结果"的数据积累**。

### 2.7 调度：自己算下一个竞猜时段

`next_run()`（第 69–91 行）按当前小时推导下一个双数整点（10→12→14→16→18→20→22→次日12），再减去配置里的 `before_end_frog`（默认 `00:15:00`），调用 `self.set_next_run(task='FrogBoss', target=...)`。

`tasks/FrogBoss/config.py`：

```python
class Strategy(str, Enum):
    Majority    = 'frog_majority'
    Minority    = 'frog_minority'
    Bilibili    = 'frog_bilibili'
    Dashen      = 'frog_dashen'
    AlwaysRed   = 'frog_always_red'
    AlwaysBlue  = 'frog_always_blue'

class FrogBossConfig(ConfigBase):
    before_end_frog: Time = Field(default=Time(0, 15, 0), description='before_end_frog_help')
    strategy_frog: Strategy = Field(default=Strategy.Majority, description='strategy_frog_help')

class FrogBoss(ConfigBase):
    scheduler: Scheduler = Field(default_factory=Scheduler)
    frog_boss_config: FrogBossConfig = Field(default_factory=FrogBossConfig)
```

### 2.8 FrogBoss 的 16 张模板：逐张说明

```python
# tasks/FrogBoss/assets.py —— 全部 RuleImage（roi_front 与 PNG 实际尺寸完全一致）
I_BET_LEFT         = RuleImage(roi_front=(95,308,145,100),   roi_back=(58,248,245,195),   threshold=0.8,  file=".../fb_bet_left.png")     # 145x100 「竞猜」按钮文字
I_BET_RIGHT        = RuleImage(roi_front=(1038,303,146,100), roi_back=(1012,268,187,208), threshold=0.8,  file=".../fb_bet_right.png")    # 146x100 右侧「竞猜」
I_BET_SUCCESS_BOX  = RuleImage(roi_front=(593,419,87,50),    roi_back=(564,378,140,133),  threshold=0.75, file=".../fb_bet_success_box.png")
I_SUCCESS_LEFT     = RuleImage(roi_front=(123,316,100,100),  roi_back=(91,254,202,221),   threshold=0.8,  file=".../fb_success_left.png") # 「胜」标
I_FAILURE_RIGHT    = RuleImage(roi_front=(1063,291,100,100), roi_back=(993,242,224,199),  threshold=0.8,  file=".../fb_failure_right.png")
I_NEXT_COMPETITION = RuleImage(roi_front=(673,510,42,36),    roi_back=(658,488,91,98),    threshold=0.8,  file=".../fb_next_competition.png")  # 「>>」下一场
I_GOLD_30          = RuleImage(roi_front=(858,494,78,76),    roi_back=(809,427,147,187),  threshold=0.8,  file=".../fb_gold_30.png")      # 30万金币
I_BET_SURE         = RuleImage(roi_front=(1025,402,100,100), roi_back=(1000,297,200,226), threshold=0.8,  file=".../fb_bet_sure.png")     # 确认竞猜
I_GOLD_30_CHECK    = RuleImage(roi_front=(513,196,58,53),    roi_back=(402,141,459,489),  threshold=0.8,  file=".../fb_gold_30_check.png")
I_BETTED           = RuleImage(roi_front=(93,352,125,54),    roi_back=(49,283,1192,161),  threshold=0.8,  file=".../fb_betted.png")       # 「已竞猜」
I_SUCCESS_RIGHT    = RuleImage(roi_front=(1048,341,122,116), roi_back=(999,243,201,260),  threshold=0.8,  file=".../fb_success_right.png")
I_FAILURE_LEFT     = RuleImage(roi_front=(116,307,100,100),  roi_back=(76,256,193,219),   threshold=0.8,  file=".../fb_failure_left.png")
I_BET_FAILURE      = RuleImage(roi_front=(496,252,269,72),   roi_back=(439,220,400,152),  threshold=0.8,  file=".../fb_bet_failure.png")  # 「竞猜失败」
I_BET_SUCCESS      = RuleImage(roi_front=(512,264,260,73),   roi_back=(433,214,418,151),  threshold=0.8,  file=".../fb_bet_success.png")  # 「竞猜成功」
I_FROG_BOSS_ENTER  = RuleImage(roi_front=(1191,391,36,38),   roi_back=(1174,135,78,320),  threshold=0.7,  file=".../fb_frog_boss_enter.png")  # 右侧活动栏入口
I_FROG_BOSS_REST   = RuleImage(roi_front=(510,274,169,64),   roi_back=(492,260,220,113),  threshold=0.8,  file=".../fb_frog_boss_rest.png")   # 「休息中」
```

**我实际下载并逐张看过了这些 PNG（IHDR 尺寸与 roi_front 完全吻合）**：

| PNG | 尺寸 | 实际画面内容 | 作用 |
|---|---|---|---|
| `fb_bet_left.png` | 145×100 | 书法字「**竞猜**」 | 左/右侧下注按钮的判定+点击锚点 |
| `fb_bet_right.png` | 146×100 | 书法字「**竞猜**」 | 同上（右侧） |
| `fb_betted.png` | 125×54 | 黑字「**已竞猜**」 | 本场已下注，结束循环 |
| `fb_frog_boss_rest.png` | 169×64 | 白描「**休息中**」 | 非竞猜时段 |
| `fb_bet_success.png` | 260×73 | 金边「**竞猜成功**」 | 结算：赢 |
| `fb_bet_failure.png` | 269×72 | 「竞猜失败」 | 结算：输 |
| `fb_bet_success_box.png` | 87×50 | 结算弹窗关闭件 | 关掉结算窗 |
| `fb_next_competition.png` | 42×36 | 「**≫**」双箭头按钮 | 切到下一场 |
| `fb_gold_30.png` | 78×76 | 金币/元宝图标（30 万金币档位） | 选最大下注额 |
| `fb_gold_30_check.png` | 58×53 | 选中态勾选标记 | 确认已选中 30 万 |
| `fb_bet_sure.png` | 100×100 | 圆形「确认竞猜」按钮 | 提交下注 |
| `fb_success_left/right`、`fb_failure_left/right` | 100×100~122×116 | 左/右 胜/负 印章 | `detect()` 判断哪边赢 |
| `fb_frog_boss_enter.png` | 36×38 | 右侧活动栏里的蛙老板图标 | 入口 |
| `fb_frog_boss_rest.png` | 169×64 | 「休息中」 | 未开盘 |

> **取证要点：这 16 张图里没有一张包含式神、头像或阵容。全部是文字/按钮/图标。** 这从资源层面直接证明了 FrogBoss **不具备**识别阵容的能力，也**没打算**这么做。

---

## 3. 【问题 2】阵容识别的可行性证据 —— 残酷的否定结论

### 3.1 顶层 `assets/` 目录：空的（只有 i18n）

```
tree   assets/i18n
blob   4      assets/i18n/en-US.json      ← 空文件
blob   9374   assets/i18n/zh-CN.json      ← 142 条配置项中文翻译，无式神名
```

### 3.2 全仓库式神相关资源盘点（按路径匹配 `shikigami|hero|shi_` 共 419 条）

| 目录 | 文件数 | 实际是什么 | 是式神图库吗 |
|---|---|---|---|
| `tasks/HeroTest/as/` | 45 | **英杰试炼**玩法（活动副本）的 UI 模板：`as_check_hero1.png`、`as_hero2_skill1~6.png`、`as_switch_hero1.png` | ❌ 是玩法 UI，不是头像库 |
| `tasks/Component/ReplaceShikigami/rs/` | 31 | **候补式神替换** UI + **稀有度徽章** `rs_rs_n/r/sr/ssr/sp/ur.png`（只有 6 个稀有度，不是具体式神） | ❌ 只有稀有度 |
| `tasks/Component/CostumeShikigami/sk1..sk12/` | 21×12 | **"幕间"皮肤**支持，12 个皮肤槽位，每个槽位一套 UI 模板（`sk1_check_records_1.png` 等） | ❌ 皮肤 UI，与式神身份无关 |
| `tasks/ActivityShikigami/{as,fire}/` | 32 | **当期式神爬塔**活动 UI | ❌ |
| `tasks/Duel/ban/` | **5** | ★ **真正的式神头像**（见下） | ⚠️ 只有 5 张，且是孤儿 |
| `tasks/GameUi/res/res_home_shikikami.png` | 1 | 主界面"式神录"**入口图标** | ❌ |
| `tasks/GameUi/page/page_main_goto_shikigami_records.png` | 1 | 主界面→式神录的按钮 | ❌ |

### 3.3 ★ 唯一的式神头像资源：`tasks/Duel/ban/`（5 张，孤儿）

```
tasks/Duel/ban/sp云外镜.png    8563 B   61×59
tasks/Duel/ban/封阳君.png      9294 B   61×59
tasks/Duel/ban/星熊童子.png    9262 B   61×59
tasks/Duel/ban/祸津神.png      8800 B   61×59
tasks/Duel/ban/荒骷髅.png      9271 B   61×59
```

我下载并查看过：**它们是圆形的式神头像缩略图，右上角叠着一个红色"禁止"斜杠**（因为截取自斗技 ban/pick 界面被禁用的式神位）。

**命名规律**：`<稀有度前缀?><式神中文名>.png`，例如 `sp云外镜`（SP 稀有度）、`封阳君`（无前缀 = SSR/未标注）。

**⚠️ 三个致命限制**：
1. **只有 5 个式神**。阴阳师式神总数在 300+，覆盖率约 1.5%。
2. **图上有红色禁止斜杠覆盖**，不是干净头像，直接拿来做模板库会污染特征。
3. **完全未被引用**：我 grep 了 `tasks/Duel/assets.py`，**不含 `ban/` 路径，也不含 `云外镜`**；全仓库没有任何 `.py`/`.json` 引用这 5 张图。**这是半成品/废弃代码。**

> **考古推断**：OAS 作者曾尝试做"式神头像识别"，做到第 5 张就放弃了，转而用 OCR 读名字。这条路线在 OAS 内部被验证为**性价比不足**。

### 3.4 仓库里唯一"读取式神名字"的代码：Duel 的 ban 检测

`tasks/Duel/assets.py`：

```python
# 点击第五手上式神位置，获得式神名称
C_DUEL_CLICK_5 = RuleClick(roi_front=(105,23,52,47), roi_back=(105,23,52,47), name="duel_click_5")
...
# 被办式神名称
O_D_BAN_NAME = RuleOcr(roi=(92,97,82,25), area=(92,97,82,25),
                       mode="Single", method="Default", keyword="", name="d_ban_name")
```

`tasks/Duel/script_task.py` 第 143–154 行：

```python
# 名仕不开启自动上阵, 根据最后一个式神的名字是否改变来检查自己式神是否被ban
if not self.appear(self.I_D_CHECK_BAN, interval=0.8) and self.is_celeb:
    ocr_name = self.O_D_BAN_NAME.ocr(self.device.image)
    shikigami_banned = ocr_name != '' and not any(
        char in ocr_name for char in self.conf.duel_celeb_config.ban_name)
    logger.info(f'Check self shikigami is banned:{shikigami_banned}')
    if shikigami_banned:
        self.duel_exit_battle()
        continue
    self.click(self.C_DUEL_CLICK_5, interval=random.uniform(0.7, 1.4))
```

配置侧 `tasks/Duel/config.py`：

```python
class DuelCelebConfig(ConfigBase):
    celeb_battle: bool = Field(default=False, description='是否开启名仕战斗')
    # 填写第五手式神名称，如果阵容式神被办，第五手就会换式神，退出斗技
    ban_name: str = Field(default='', description='填写第五手式神名称')
```

**这说明什么**：
- ✅ OAS 确实能**从界面 OCR 出式神中文名**（`mode="Single"`，ROI 82×25，就是一个名字文本条）。
- ❌ 但它只读 **1 个**名字（"第五手"），只做**字符包含**的模糊判断，**没有把名字映射成结构化 ID，没有两侧 5v5 的概念**。
- ❌ 用户需要**手填** `ban_name` 字符串——**说明 OAS 没有式神名称词表**，它不知道游戏里有哪些合法式神名。

### 3.5 另一处"按名称"逻辑：SwitchSoul（按队伍预设名，不是式神名）

`tasks/Component/SwitchSoul/switch_soul_config.py`：

```python
class SwitchSoulConfig(BaseModel):
    enable: bool = Field(default=False)
    switch_group_team: str = Field(default='-1,-1', description='switch_group_team_help')
    enable_switch_by_name: bool = Field(default=False, description='enable_switch_by_name_help')
    group_name: str = Field(default='')     # 预设"组"名
    team_name: str = Field(default='')      # 预设"队伍"名
```

这是按**玩家自定义的御魂预设名**切换，与式神身份识别无关。

### 3.6 覆盖数量汇总

```
式神头像模板数：        5    （tasks/Duel/ban/*.png，孤儿，带 ban 斜杠）
式神名称词表：          0
式神→ID 映射表：        0
式神稀有度徽章模板：    6    （N/R/SR/SSR/SP/UR，tasks/Component/ReplaceShikigami/rs/）
含式神名的 OCR 规则：   1    （O_D_BAN_NAME，读单个名字，无后处理）
能读 5v5 双方阵容的代码：0
```

---

## 4. 【问题 3】图像识别基础设施

### 4.1 OCR：PaddleOCR（ONNX 版）

`requirements.txt`（实测相关行）：

```
ppocr-onnx==0.0.3.9       # via -r requirements-in.txt
onnxruntime==1.16.3       # via ppocr-onnx
opencv-python==4.7.0.72   # via -r requirements-in.txt, ppocr-onnx
numpy==1.24.3             # via onnxruntime, opencv-python, ppocr-onnx
pillow==10.2.0            # via ppocr-onnx
shapely==2.0.2            # via ppocr-onnx
pyclipper==1.3.0.post5    # via ppocr-onnx
cn2an==0.5.23             # via -r requirements-in.txt   ← 中文数字转阿拉伯数字
zerorpc==0.6.3            # via -r requirements-in.txt   ← 远程 OCR 服务
```

`module/ocr/ppocr.py`：

```python
import ppocronnx.predict_system

class TextSystem(ppocronnx.predict_system.TextSystem):
    def __init__(self, use_angle_cls=False, box_thresh=0.6, unclip_ratio=1.6,
                 rec_model_path=None, det_model_path=None, ort_providers=None):
        super().__init__(use_angle_cls=use_angle_cls, box_thresh=box_thresh,
                         unclip_ratio=unclip_ratio, rec_model_path=rec_model_path,
                         det_model_path=det_model_path, ort_providers=ort_providers)

# sorted_boxes() from PaddleOCR 2.6, newer and better than the one in ppocr-onnx
ppocronnx.predict_system.sorted_boxes = sorted_boxes
```

`module/ocr/models.py`：单例 + 可选 RPC 代理

```python
class OcrModel:
    @cached_property
    def ch(self):
        return TextSystem()

OCR_MODEL = OcrModel()

def get_ocr_model(lang: str = "ch"):
    deploy_config = State.deploy_config
    if deploy_config.UseOcrServer:
        address = deploy_config.OcrClientAddress or "127.0.0.1:22268"
        if address not in _OCR_PROXY_CACHE:
            _OCR_PROXY_CACHE[address] = ModelProxy(address)   # module/ocr/rpc.py，zerorpc
        return _OCR_PROXY_CACHE[address]
    return getattr(OCR_MODEL, lang)
```

> **注意 `models.py` 里的注释**：`# 引入ocr 会导致非常巨大的内存开销`。PaddleOCR-ONNX 首次加载模型常驻内存约 1–2 GB量级。如果你们要做批量离线处理，注意这一点（好消息是可以走 `UseOcrServer` 把它独立成一个进程）。

**OCR 抽象层** `module/ocr/base_ocr.py` 的 `BaseCor`：

```python
class OcrMode(Enum):
    FULL = 1; SINGLE = 2; DIGIT = 3; DIGITCOUNTER = 4; DURATION = 5; QUANTITY = 6

class OcrMethod(Enum):
    DEFAULT = 1

class BaseCor:
    lang: str = "ch"
    score: float = 0.6       # 阈值默认为0.5
    min_score: float = 0.3   # 宽松阈值，用于挽救数字等结果
    roi: list = []           # [x, y, width, height]  裁剪区
    area: list = []          # [x, y, width, height]  结果区/点击区
    keyword: str = ""

    @classmethod
    def crop(cls, image, roi) -> np.array:       # image[y:y+h, x:x+w]
    def ocr_single_line(self, image):            # 单行识别 + 阈值判定 + 后处理
    def detect_and_ocr(self, image) -> list[BoxedResult]:   # 带 enlarge_canvas() 补成 32 倍数
    def detect_text(self, image) -> str:         # 全 ROI 文本按序拼接
    def filter(self, boxed_results, keyword, exact=False):  # ★ 含竖排逐字匹配兜底
```

`enlarge_canvas()`（关键性能技巧，注释里写明来源 StarRailCopilot）：

```python
def enlarge_canvas(image):
    """Enlarge image into a square fill with black background.
    In the structure of PaddleOCR, image with w:h=1:1 is the best
    while 3:1 rectangles takes three times as long.
    Also enlarge into the integer multiple of 32 cause PaddleOCR will downscale images to 1/32."""
    height, width = image.shape[:2]
    length = int(max(width, height) // 32 * 32 + 32)
    border = (0, length - height, 0, length - width)
    if sum(border) > 0:
        image = cv2.copyMakeBorder(image, *border, borderType=cv2.BORDER_CONSTANT, value=(0, 0, 0))
    return image
```

### 4.2 模板匹配：OpenCV

`module/atom/image.py` `RuleImage.match()`（第 141–174 行）：

```python
def match(self, image: np.array, threshold: float = None) -> bool:
    if threshold is None:
        threshold = self.threshold
    if not self.is_template_match:          # method == "Template matching"
        return self.sift_match(image)       # 否则走 SIFT+FLANN
    source = self.corp(image)               # 按 roi_back 裁剪搜索区
    mat = self.image                        # 模板（cv2.imdecode + BGR2RGB）
    if mat.shape[0] > source.shape[0] or mat.shape[1] > source.shape[1]:
        return False                        # 模板大于源图, 视为无效匹配
    res = cv2.matchTemplate(source, mat, cv2.TM_CCOEFF_NORMED)
    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)
    if max_val > threshold:
        self.roi_front[0] = max_loc[0] + self.roi_back[0]   # ★ 命中后动态更新 roi_front
        self.roi_front[1] = max_loc[1] + self.roi_back[1]
        return True
    else:
        return False
```

派生的能力（对"阵容头像检索"有参考价值）：

| 方法 | 用途 | 对你们的价值 |
|---|---|---|
| `match()` | 单模板 / 单 ROI 匹配 | 页面级判定 |
| `match_multi_scale()` | 多尺度模板匹配（`scale_range`） | 分辨率/UI 缩放的鲁棒性 |
| `match_all()` | 返回 **所有** 超过阈值的位置 | ★ 可用于一次找出多个头像位 |
| `match_all_any(nms_threshold=0.3)` | 全部命中 + **`cv2.dnn.NMSBoxes` 非极大值抑制** | ★ **多目标检测的现成骨架** |
| `sift_match()` | SIFT 特征 + FLANN 匹配 | ★ 可作头像检索起点（对裁剪/缩放更鲁棒） |
| `match_mean_color / match_brightness / match_saturation` | 颜色/亮度/饱和度匹配 | 头像框选中态判定 |

`module/atom/image.py` 第 83–86 行的特征提取：

```python
def load_kp_des(self) -> None:
    if self._kp is not None and self._des is not None:
        return
    self._kp, self._des = self.sift.detectAndCompute(self.image, None)

@cached_property
def sift(self):
    return cv2.SIFT_create()
```

### 4.3 图像规则 → Python 代码：`dev_tools/assets_extract.py`

这是本仓库设计上最聪明的一环：**所有 UI 交互元素都声明在 json 里，代码自动生成**。

```python
MODULE_FOLDER = 'tasks'
ASSETS_FILE = 'assets.py'

class AssetsExtractor:
    def all_json_file(self) -> list:
        return [str(x) for x in self.task_path.rglob('*.json') if 'temp' not in str(x)]
    ...
class AllAssetsExtractor:
    def __init__(self):
        self.task_paths = [x for x in self.task_path if x.is_dir()]
        self.task_paths = [x for x in self.task_paths if 'Component' not in x]
        self.task_paths.extend([str(x) for x in (self.task_path / 'Component').iterdir() if x.is_dir()])
```

### 4.4 可视化标注器：`module/server/` + `web/annotator/`

```
module/server/
├── app.py (FastAPI)  ├── tool.py (62187 B) ★ 标注后端全部业务
├── tool_router.py    ├── annotator_rule_schema.py ★ 规则 schema 唯一真源
├── main_manager.py   ├── script_router.py / script_websocket.py
└── web/annotator/    ★ 纯前端标注 GUI
    ├── index.html
    └── static/js/app.js (85725 B) / layout-ui.js / css/*
```

`module/server/tool.py` 的能力（函数名清单）：
- 会话/图像管理：`create_session / add_image / save_uploaded_images_base64 / list_images / get_image_file / delete_image`
- 模拟器抓帧：`EmulatorCaptureSession.start/_run/latest_jpeg/capture_latest_frame`
- 规则读写：`load_rule_file / create_rule_json / delete_rule_json / list_rule_source / list_task_json_files`
- ★ **规则在线测试**：`test_rule(...)`、`get_rule_image_file(...)`
- ★ **保存并重新生成 assets.py**：`save_rules_and_generate(...)`、`_resolve_assets_extract_target(...)`
- 图像裁剪入库：`save_cropped_image(...)`

> **这套东西可以直接改造成"阵容截图标注 + 头像库采集"工具**：上传/抓取截图 → 框选 ROI → 裁剪头像 → 落盘 → 生成 json。工作量远小于自己写一个标注器。

---

## 5. 【问题 4】click.json / image.json / ocr.json 的 schema

### 5.1 官方 schema 真源：`module/server/annotator_rule_schema.py`

```python
RULE_TYPE_SCHEMAS = OrderedDict({
  "image": {
    "type": "image", "label": "RuleImage",
    "capabilities": {"supports_test": True, "supports_crop": True,
                     "supports_image_preview": True, "shared_roi_back": False},
    "fields": [
      {"key": "itemName",    "control": "text",   "default": "new"},
      {"key": "imageName",   "control": "text",   "default": "", "auto_from_item_name": True},
      {"key": "method",      "control": "select", "default": "Template matching",
                             "options": ["Template matching", "Sift Flann"]},
      {"key": "threshold",   "control": "number", "default": 0.8, "step": 0.01, "min": 0, "max": 1},
      {"key": "description", "control": "textarea", "default": "", "full": True},
    ],
  },
  "ocr": {
    "type": "ocr", "label": "RuleOcr",
    "capabilities": {"supports_test": True, "supports_crop": False, "supports_image_preview": False},
    "fields": [
      {"key": "itemName", "control": "text", "default": "new"},
      {"key": "mode",     "control": "select", "default": "Single",
                          "options": ["Single","Full","Digit","DigitCounter","Duration","Quantity"]},
      {"key": "method",   "control": "text",   "default": "Default"},
      {"key": "keyword",  "control": "text",   "default": ""},
      {"key": "description", "control": "textarea", "default": "", "full": True},
    ],
  },
  "click": {
    "type": "click", "label": "RuleClick",
    "capabilities": {"supports_test": False, "supports_crop": False, "supports_image_preview": False},
    "fields": [
      {"key": "itemName", "control": "text", "default": "new"},
      {"key": "description", "control": "textarea", "default": "", "full": True},
    ],
  },
  "swipe":     { ... "mode": ["default","vector"] ... },
  "long_click":{ ... "duration(ms)": 1000 ... },
  "list":      { "meta_fields": ["name","direction","type","description"] ... },
})
ROI_DEFAULT = "0,0,100,100"
```

### 5.2 image.json 真实片段（`tasks/FrogBoss/fb/image.json`）

```json
[
  {
    "itemName": "bet_left",
    "imageName": "fb_bet_left.png",
    "roiFront": "95,308,145,100",
    "roiBack": "58,248,245,195",
    "method": "Template matching",
    "threshold": 0.8,
    "description": "左边竞猜"
  },
  {
    "itemName": "bet_success",
    "imageName": "fb_bet_success.png",
    "roiFront": "512,264,260,73",
    "roiBack": "433,214,418,151",
    "method": "Template matching",
    "threshold": 0.8,
    "description": "description"
  }
]
```

| 字段 | 类型 | 含义 |
|---|---|---|
| `itemName` | str | 逻辑名；生成 Python 时常量名 = `I_` + `itemName.upper()` |
| `imageName` | str | 同目录下的模板 PNG 文件名；**也是 assets_extract 判定"这是 image 规则"的标志字段** |
| `roiFront` | `"x,y,w,h"` | **模板图在 1280×720 截图中的原始位置与尺寸**；同时被用作点击坐标区。**若 PNG 实际尺寸与 w,h 不一致，`RuleImage.load_image()` 会用 PNG 尺寸覆盖它** |
| `roiBack` | `"x,y,w,h"` | **搜索区**（模板匹配只在 `image[y:y+h, x:x+w]` 内进行）。ROI 越小越快越稳 |
| `method` | `"Template matching" \| "Sift Flann"` | 匹配算法 |
| `threshold` | float 0–1 | `cv2.matchTemplate` 的 `max_val` 判定阈值 |
| `description` | str | 注释（会变成生成代码里的行注释） |

### 5.3 ocr.json 真实片段（`tasks/FrogBoss/fb/ocr.json`）

```json
[
  {
    "itemName": "left_count",
    "roiFront": "143,496,69,31",
    "roiBack": "143,496,69,31",
    "mode": "Digit",
    "method": "Default",
    "keyword": "",
    "description": "Ocr-description"
  },
  {
    "itemName": "right_count",
    "roiFront": "1105,497,77,32",
    "roiBack": "1105,497,77,32",
    "mode": "Digit",
    "method": "Default",
    "keyword": "",
    "description": "Ocr-description"
  },
  {
    "itemName": "time_remain",
    "roiFront": "594,564,91,35",
    "roiBack": "594,564,91,35",
    "mode": "Duration",
    "method": "Default",
    "keyword": "",
    "description": "Ocr-description"
  }
]
```

| 字段 | 含义 |
|---|---|
| `itemName` | 逻辑名 → 常量 `O_` + UPPER |
| `roiFront` | **OCR 裁剪区**（`BaseCor.crop` 用这个） |
| `roiBack` | 生成代码里映射到 `area` 参数（**结果区/点击区**）。注意 `assets_extract.py` 把 json 的 `roiBack` 填进 `RuleOcr(area=...)` |
| `mode` | 见下表 |
| `method` | 目前只有 `"Default"`（占位枚举 `OcrMethod.DEFAULT`） |
| `keyword` | 目标文本；`Full` 模式用它做匹配，`Single` 模式忽略（返回原文） |

**`mode` 语义表**（来自 `module/ocr/sub_ocr.py`）：

| mode | 类 | `ocr()` 返回 | 行为要点 |
|---|---|---|---|
| `Single` | `Single` | `str` | 固定 ROI 单行；失败时**回退到 `detect_and_ocr` 试竖排**。★**读式神名就该用这个** |
| `Full` | `Full` | `(x,y,w,h)` 或 `(0,0,0,0)` | 大 ROI 多行检测 + `filter()` 关键词匹配（含**竖排逐字匹配兜底**），返回合并后的坐标 |
| `Digit` | `Digit` | `int` | 字符替换表 `{I:1, D:0, S:5, B:8, ？:2, d:6, o:0, O:0, →:1}` + 只留数字；**全 0 且长度≥2 时强制改为 1** |
| `DigitCounter` | `DigitCounter` | `(current, remain, total)` | 解析 `"14/15"` |
| `Duration` | `Duration` | `datetime.timedelta` | 解析 `"01:30:00"`；`：`→`:` |
| `Quantity` | `Quantity` | `int` | 支持 `"6.33亿"` `"1.2万"` `"53万/100"`，用 `cn2an.cn2an(result,'smart')` |

### 5.4 click.json 真实片段（`tasks/Duel/duel/click.json`）

```json
[
  {
    "itemName": "d_battle_data",
    "roiFront": "584,279,100,100",
    "roiBack": "584,279,100,100",
    "description": "战斗数据"
  },
  {
    "itemName": "duel_click_5",
    "roiFront": "105,23,52,47",
    "roiBack": "105,23,52,47",
    "description": "点击第五手上式神位置，获得式神名称"
  }
]
```

**只有 4 个字段**：`itemName / roiFront / roiBack / description`。生成 `C_` + UPPER 常量，类型 `RuleClick`。
点击时坐标是在 `roiFront` 内**随机正态分布取点**（`RuleClick` 的 `coord()`），以避免固定点被风控。

### 5.5 其它类型

`swipe.json`（5 字段）：`itemName / roiFront / roiBack / mode("default"|"vector") / description` → `S_` 前缀
`long_click.json`：多一个 `duration`(ms) → `L_` 前缀
`list.json`（**是 dict 不是 list**）：`{name, direction, type, roiBack, description, list:[{itemName, roiFront, ...}]}` → `L_` 前缀 + `RuleList`，用于「一列/一行重复元素」（如御魂列表）——**这个可能是你们做"5 个式神位"最接近的现成抽象**。

### 5.6 ⚠️ 类型判定的隐藏规则（`dev_tools/assets_extract.py`）

判定顺序**不可交换**，而且判据很"土"：

```python
if self.is_list_file(data):        # isinstance(data, dict) and 'name' in data
    ...
if self.is_image_file(data):       # 'imageName' in data[0]
elif self.is_click_file(data):     # len(data[0]) == 4      ← 靠"字段个数"！
elif self.is_long_click_file(data):# 'duration' in data[0]
elif self.is_swipe_file(data):     # 'mode' in data[0] and len(data[0]) == 5
elif self.is_ocr_file(data):       # 'keyword' in data[0]
```

**实践推论**：
1. 文件名**无关紧要**——`image2.json` / `detect_image.json` / `supplement.json` / `img_supplement.json` 都是 image 规则，只因含 `imageName`。
2. **click 规则必须恰好 4 个字段**，多一个字段就会被误判。
3. **ocr 规则必须含 `keyword`**（哪怕为空串 `""`）。
4. 常量前缀：`I_`(image) / `C_`(click) / `L_`(long_click, list) / `S_`(swipe) / `O_`(ocr)。

### 5.7 仓库规则文件统计（实测）

```
image.json        148        任务/组件各一份，主规则文件
ocr.json           64
click.json         45
swipe.json         22
image2.json         4        多套 UI 变体拆文件
long_click.json     3
supplement.json     1  img_supplement.json 1  detect_image.json 1
          共 342 个 tasks/** 下的规则 json
```

---

## 6. 【问题 5】可复用度结论 + 文件级清单

### 6.1 总体判断

| 层级 | OAS 现状 | 对你们方案的复用度 |
|---|---|---|
| **截屏 / 设备控制** | adb + uiautomator2 + scrcpy，多后端 | 🟡 若你们是**离线截图**批处理，基本不需要；若做实时则值得抄 |
| **ROI 声明 + 代码生成** | json → assets.py，工业级 | 🟢 **强烈推荐直接复用** |
| **模板匹配 / 特征匹配** | `RuleImage` + OpenCV 全家桶 | 🟢 **直接复用** |
| **OCR** | PaddleOCR-ONNX + 6 种后处理模式 | 🟢 **直接复用**（读式神名用 `Single`） |
| **可视化标注** | FastAPI + 纯前端标注器 | 🟢 **强烈推荐复用/改造** |
| **竞猜页面识别** | FrogBoss 的 16 张模板 | 🟢 **直接复用**（判定"是否在竞猜页/是否已下注/结算状态"） |
| **式神头像库** | 只有 5 张孤儿图 | 🔴 **0%，必须自建** |
| **式神名称词表 / ID 映射** | 不存在 | 🔴 **0%，必须自建** |
| **竞猜界面 5v5 头像 ROI 布局** | 不存在 | 🔴 **必须自己标注** |
| **头像分类器** | 无（只有单模板 matchTemplate） | 🔴 **必须自己写** |
| **战斗模拟器** | 完全不在本仓库 | 🔴 **完全自建** |

### 6.2 文件 → 作用 → 复用建议（可直接照做）

#### A. 直接复用（拷贝即用，改 import 路径）

| 文件 / 目录 | 作用 | 复用建议 |
|---|---|---|
| `module/ocr/ppocr.py` | PaddleOCR-ONNX 封装 + `sorted_boxes` 补丁 | **直接拷**。`TextSystem().detect_and_ocr(img)` 就是"截图→文本+框"的入口 |
| `module/ocr/models.py` | OCR 单例 + 可选 RPC 代理 | **直接拷**，去掉 `State.deploy_config` 分支就是纯单例 |
| `module/ocr/base_ocr.py` | `BaseCor`：crop / pre_process / after_process / `detect_and_ocr` / `detect_text` / `filter`（含竖排兜底）/ `enlarge_canvas` | **直接拷**。`detect_text()` 直接给你"ROI 内所有文字拼接" |
| `module/ocr/sub_ocr.py` | 6 种 mode 后处理 | **直接拷**。`Single` 用于读式神名，`Full` 用于在头像区找名字条 |
| `module/ocr/utils.py` | `merge_area()` 合并多个 OCR 框 | 直接拷 |
| `module/atom/image.py` | `RuleImage`：`match / match_multi_scale / match_all / match_all_any(NMS) / sift_match / match_mean_color / match_brightness / match_saturation` | **核心复用**。`match_all_any` 可作为"一屏多个头像"的检测骨架；`sift_match` 可作为头像检索起点 |
| `module/atom/ocr.py` | `RuleOcr`（按 mode 分派 + `coord()` 随机取点） | 直接拷 |
| `module/atom/click.py` / `swipe.py` / `list.py` | 点击/滑动/列表规则 | `list.py` 的 `RuleList` 思路可用于"5 个式神位" |
| `module/base/utils/utils.py` | `crop / area_pad / float2str` 等 | 直接拷 |
| `module/base/timer.py` / `decorator.py` / `filter.py` | `Timer` / `cached_property` / 正则过滤器 | 直接拷 |
| `dev_tools/assets_extract.py` | json → `assets.py` 代码生成 | **直接拷**，可作为你们"ROI 声明 → 代码"的生成器 |
| `module/server/annotator_rule_schema.py` | 规则 schema 唯一真源 + 默认值 | **直接拷**，改造成你们的标注表单定义 |
| `module/server/tool.py` | 标注会话、图像管理、`test_rule()`、`save_rules_and_generate()`、`save_cropped_image()` | **重点改造**。`save_cropped_image` + `test_rule` 就是"框选头像 → 存库 → 回归验证"闭环 |
| `module/server/web/annotator/` | 标注前端（`index.html` + `app.js` + css） | **直接拿来改**，省掉自研标注器 |
| `tasks/Component/RightActivity/assets.py` | 右侧活动栏开合模板 | 若要复现"进竞猜页"自动化则复用 |

#### B. 部分复用 / 需改造

| 文件 | 作用 | 改造建议 |
|---|---|---|
| `tasks/base_task.py`（31 KB） | `screenshot / appear / appear_then_click / click / ocr_appear / list_find / ui_click` 等高层动作 | 抽掉 `Config/Device` 依赖，做成 `OfflineTask(screenshot_path)` 即可复用整套动作语义 |
| `tasks/FrogBoss/assets.py` + `tasks/FrogBoss/fb/*.png` + `fb/image.json` + `fb/ocr.json` | 竞猜页面状态机所需全部模板 | **直接复用做"竞猜页定位器"**：`I_BET_LEFT/I_BET_RIGHT` → 在竞猜页；`I_BETTED` → 已下注；`I_BET_SUCCESS/I_BET_FAILURE` → 结算；`I_NEXT_COMPETITION` → 下一场 |
| `tasks/Component/ReplaceShikigami/rs/` | 稀有度徽章 N/R/SR/SSR/SP/UR 模板 | 可作为头像**辅助特征**（稀有度边框颜色） |
| `tasks/Duel/ban/*.png` | 5 张圆形式神头像（61×59，带 ban 斜杠） | ⚠️ **别直接用**（斜杠污染特征）。但**可作"头像尺寸/边框样式"的参考样本**：圆形头像直径约 59–61 px |
| `tasks/Duel/script_task.py` L143–154 + `tasks/Duel/assets.py` `O_D_BAN_NAME` | 从 UI OCR 读**单个**式神名 | **改造模板**：把 `O_D_BAN_NAME` 复制成 10 份（左右各 5 个位置的 ROI），改用 `Single` 模式批量读名字 |
| `module/server/tool.py` 的 `EmulatorCaptureSession` | 从模拟器持续抓帧 | 若要在真机/模拟器上采集头像库，可直接用 |

#### C. 需要完全自建（OAS 里没有）

| 需要的东西 | 说明 | 建议做法 |
|---|---|---|
| **式神头像模板库（300+）** | OAS 只有 5 张，且是带 ban 斜杠的 | 在式神录逐页截图自动采集，或从游戏资源包/攻略站抓。建议统一裁成 **61×59 圆形**（对齐 OAS 的样本几何） |
| **式神名称 → 标准 ID 映射表** | 完全不存在 | 建 `{中文名, 别名[], 稀有度, id, 拼音}`。注意 `sp云外镜` 这种"稀有度前缀"命名习惯 |
| **竞猜界面 5v5 的 ROI 布局** | 不存在 | 用 `I_BET_LEFT`(roi_front 95,308,145,100) 与 `I_BET_RIGHT`(1038,303,146,100) 定位后，阵容区大概在屏幕中部 **x∈[240,1040], y∈[240,450]**（**此为推断，需实测标注**） |
| **头像检测器（多目标）** | OAS 只有"单模板 vs 单 ROI" | 三条路线：① 固定网格切分（布局固定时最省事）；② `cv2.HoughCircles`/轮廓找圆形头像框；③ 直接对 10 个已知位置做 ROI 裁剪（**最推荐，1280×720 固定布局下 ROI 法最稳**） |
| **头像分类/检索** | 无 | ① 模板匹配逐一遍历 300+ 张（`cv2.matchTemplate` 300 次/头像位 × 10 = 3000 次，太慢）；② **推荐**：预抽 embedding（小 CNN / MobileNet 特征）建向量索引，或 pHash/ORB 检索；③ `RuleImage.sift_match` 可作起点但需批量化 |
| **战斗模拟器** | 不在本仓库 | 与 OAS 无关，另建（离线伤害公式 + 行动条模拟） |

### 6.3 建议的落地管线（把 OAS 当"感知层"用）

```
[离线截图 1280x720]  (或 EmulatorCaptureSession 实时抓帧)
        │
        ▼  复用 tasks/FrogBoss/fb/*.png + RuleImage.match()
   [页面判定]  I_BET_LEFT & I_BET_RIGHT  → 确认在竞猜页
        │
        ▼  自建：10 个 ROI（用 annotator 标注一次，写进 lineups.json）
   [裁剪 10 个头像]  module/base/utils/utils.crop()
        │
        ├──► 复用 RuleOcr(mode="Single", roi=名字条)  → 式神名文本
        │         └─► 自建：名称归一化 → shikigami_id
        │
        └──► 自建：头像检索（embedding / pHash / SIFT）
                  └─► 自建：{name → id} 映射与置信度融合
        │
        ▼
   [结构化输出]  {"red": [id1..id5], "blue": [id1..id5], "confidence": [...], "ts": ...}
        │
        ▼  自建
   [战斗模拟]  → 胜率
```

**工作量估计**：
- **复用 OAS 感知层**：1–2 人日（拷贝模块 + 去掉 device 依赖 + 跑通离线截图）。
- **标注 10 个 ROI + 建立管线骨架**：2–3 人日（用 annotator 改）。
- **式神头像库 300+ 采集与清洗**：**这是主要成本**，5–15 人日（取决于能否找到现成资源包）。
- **头像分类器 + 名称融合**：3–7 人日。
- **战斗模拟器**：与 OAS 无关，独立估。

---

## 7. 附：本次考古的动作清单（可复核）

1. `GET /repos/runhey/OnmyojiAutoScript/git/trees/master?recursive=1` → 3471 条，`truncated:false`
2. 下载并逐行读了：
   - `tasks/FrogBoss/script_task.py`（323 行全文）、`assets.py`、`config.py`、`fb/image.json`、`fb/image2.json`、`fb/ocr.json`
   - `tasks/GameUi/page.py`（248 行全文）、`tasks/GameUi/game_ui.py`
   - `module/ocr/{base_ocr,ppocr,models,sub_ocr,utils}.py`、`module/atom/{image,ocr}.py`
   - `dev_tools/assets_extract.py`、`module/server/annotator_rule_schema.py`
   - `tasks/Duel/{assets.py,config.py,script_task.py}`、`tasks/Component/RightActivity/*`、`tasks/Component/SwitchSoul/*`
   - `tasks/Component/GeneralBattle/assets.py`、`gb/{image,ocr,click}.json`
   - `config/template.json`、`module/config/scheduler.py`、`assets/i18n/zh-CN.json`、`requirements.txt`
3. 下载并**视觉检查**了：FrogBoss 全部 16 张模板 + `tasks/Duel/ban/` 5 张式神头像（确认前者是纯文字/按钮、后者是带 ban 斜杠的圆形头像）
4. 统计：图片 2009 张分布、规则 json 342 个分类计数、`assets/Duel/ban` 无引用确认、FrogBoss 死代码确认（`O_TIME_REMAIN` 0 次引用、`detect()` 返回值丢弃、`Strategy.Bilibili` 与 Majority 同分支、`uids` 27 条 26 唯一 uid 重复计票）
