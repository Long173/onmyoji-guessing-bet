// kernel/triggers.ts — ★★ 被动技能的**触发时机登记册**（第 68 轮）
//
// 由来（实测，不是推理）：
//   · 全库 802 个技能里 **157 个是被动**（cost < 0），分布在 **277 只式神中的 157 只**上；
//   · 而 `bus.register` 在生产代码里**只出现在 soul/effect-system.ts**（御魂）——
//     `compile/character.ts` 一处都没有。也就是说：**式神的被动技能没有任何运行时**。
//     它们的 IR 被解析出来了（damage / heal / buff 引用都在），但没有任何东西会执行它们。
//   · 被动文案里的触发时机有 126 种写法（过滤后），count ≥ 3 的有 13 种。
//
// 这一张表要回答的是**下一步该先做什么**，而不是"还差多少"：
//   对每个触发时机，问两件事 ——
//     ① 引擎有没有对应的事件码？（EV 表里声明了 42 个）
//     ② 那个事件码**有没有派发点**？（声明的 42 个里，只有 17 个在生产代码里真的被 dispatch）
//   两者都成立 ⇒ 一旦被动运行时建起来，这个时机**当天就能接**（READY）；
//   事件码在、没人派发 ⇒ 得先补派发点（NO_DISPATCH）；
//   连事件码都没有 ⇒ 更远（NO_EVENT）。
//
// ★★ 第二条是这一轮顺带量出来的、比被动更广的一件事：
//   **42 个事件码里有 25 个只有声明、没有派发点**（HEAL / STATUS_ADD / SHIELD_BREAK / TRANSFORM …）。
//   这直接影响两件事：
//     · 被动触发：`受到治疗时` `获得状态时` `护盾被打破时` 这些时机今天无处可挂；
//     · Inspector/触发类机制：Theater 读的是 **trace**（很密），而触发类机制必须读 **事件总线**
//       （很稀）—— 两条通道的密度不一样，这件事以前没有一处写清楚过。
/**
 * ★★★ 占位符的含义（第 69 轮实测，不是猜的）—— 建被动运行时的**前置知识**。
 *
 * 起因：我想挑一批"无条件、可直接执行"的被动做第一版运行时。按"子句里有没有 若/概率/层/每/当"
 * 过滤之后还剩 **30 条**，看着很可口。但读下去发现第一条就错了：
 *
 *     铁鼠「横财护身」：受到攻击时，有40%[tips_2]为攻击者附加[buff_2322_1]
 *
 * **40% 的"概率"两个字被写成了 [tips_2]** —— 我的过滤器只认字面的"概率"，于是这条被判成"无条件"。
 * 照这个清单建运行时，它会**每次都触发**，而原文说的是 40% 概率触发。
 * 那不是"少实现一点"，是**凭空多出一个机制**。
 *
 * 实测三个上下文坐实了 tips_2 = 概率：
 *   「造成攻击30%伤害，并有8%[tips_2]将其…」／「若目标为怪物，则[tips_2]提升至25%」／
 *   「有100%[tips_2]将敌方目标…」
 * 另外三个也一并量了：[tips_1] = 驱散/解除某个东西；[tips_3] = 控制效果；[tips_20] = 治疗/恢复。
 *
 * ★ 由此定下一条硬规则（g42 会机械检查）：
 *   **含未解析占位符 [tips_N] 的子句，一律不得当作"无条件可执行"** ——
 *   占位符里可能藏着概率、目标、状态名，而"没解析出来"不等于"没有条件"。
 *
 * ★★★ 第 71 轮的修正（这条才是重点）：上面那句"没解析出来"**根本不成立**。
 *   占位符表 `data/kb/tips.json`（122 条 {id,name,desc}）一直就在仓库里：
 *     tips_2  → **基础概率**     tips_20 → **恢复**     tips_108 → **眩晕**     tips_7 → **先机**
 *   实测：技能文案里共出现 **721 处** [tips_N]、**117 个**不同 id，**0 处落空**。
 *   也就是说，第 69 轮"18 条被动被占位符挡住"不是数据缺失，而是**我没读数据**：
 *   把 [tips_2] 解析成"基础概率"之后，"含占位符"这一档**直接归零**，干净候选 16 → **23**。
 *
 *   ⇒ 因此正确的管线是 **先解析、再分类**（`compile/tips.ts` 的 resolveTips）：
 *      · HAS_PLACEHOLDER 从此**只**表示"KB 里查不到这个 id"（真的缺口），必须报出来；
 *      · 不许把"没解析的占位符"当成"没有条件" —— 下面这条判定顺序就是为此存在的。
 */
/** ★ 上面这 4 条是我从上下文反推的**探针记录**（第 69 轮）；g42 会拿它与 data/kb/tips.json 逐条对照，
 *  对不上就红 —— 两份独立来源相互印证，谁错都会暴露。 */
export const TIP_PLACEHOLDER_MEANINGS: Record<string, { means: string; evidence: string }> = {
  "tips_1": { means: "驱散 / 解除某个东西", evidence: "「有50%概率驱散或[tips_1]自身的1个…」" },
  "tips_2": { means: "**概率**", evidence: "「并有8%[tips_2]将其…」／「则[tips_2]提升至25%」／「有100%[tips_2]将敌方目标…」" },
  "tips_3": { means: "控制效果", evidence: "「若受到[tips_3]，则将其解除」／「驱散全体友方带有的减益状态或[tips_3]」" },
  "tips_20": { means: "治疗 / 恢复", evidence: "「立即复活并[tips_20]生命上限20%的生命」" },
};

/**
 * 子句里出现这些词 ⇒ 需要条件模型（层数/概率/触发前置…），不能无条件执行。
 *
 * ★ 含「概率」—— 用于**粗筛**（"这句话可能有条件"）。
 * ★★ 真正决定分类的是下面那个**不含「概率」**的版本：因为「有 X% 概率」这一种条件
 *    第 75 轮**已经建模了**（见 `PassiveCondition`），它不再算"没法执行"。
 */
export const CONDITION_MARKERS = /若|概率|层|每|当|上限|至少|低于|高于|未拥有|存在|偷取|召唤|归还|抵挡|获得新的回合/;

/**
 * ★★★ 第 75 轮：**除概率之外**的条件标记 —— 命中它就说明还有别的条件没建模。
 *
 * ★★★ 第 77 轮拆桶：原来的 `层` 被拆成两件事，因为它们**根本不是一回事**：
 *
 *   · `层数` / `每层` / `若拥有N层` —— **条件**（层数是门槛或缩放依据）→ 留在本表；
 *   · `获得N层` / `失去N层` / `附加N层` —— **效果**（一次施加几层）→ **移出**本表。
 *
 * 为什么必须拆：第 76 轮读原文时发现 25 条含「层」的被动里有 **15 条**压根没有条件，
 * 挡住它们的是「获得N层」这个**效果细节**。当时的桶 `HAS_CONDITION` 同时装着
 *   "条件没建模"与"效果细节没建模" 两种东西 —— 后果不是分类不准，而是**修错方向**：
 *   看着像"缺条件模型"，实际要做的是把层数解析出来（第 76 轮做完，见 statusStacks）。
 *
 * ★ 拆完保留一个更窄的真条件词：`层数`（纸舞「落纸」：「消耗等量层数的[buff_3402_1]」）。
 *   光靠 `每`/`若` 抓不到它。
 */
export const CONDITION_MARKERS_NO_PROB = /若|层数|每|当|至少|低于|高于|未拥有|存在|获得新的回合/;

/**
 * ★★★ 第 108 轮：**偷取类的「上限」不是触发条件**，而且它已经被 IR 建模了。
 *
 * 这一刀是查噬魂「施放『焚天九尾』前，先偷取场上全体3%攻击力（每个目标最多偷取10次）」时发现的：
 * 触发族「施放技能前」（第 107 轮）与 IR（trigger=PRE_CAST / maxPerTarget）都接好了，
 * 可这一条**从来没被装上** —— 挡住它的是上面那张表里的单个字 `每`，命中的是「**每**个目标最多偷取10次」。
 *
 * 两者的差别是本质的：
 *   · 「每损失1%生命…」= **缩放/条件**（效果随某个量变化）→ 该挡；
 *   · 「每个目标最多偷取N次」= **上限**，且编译产物里就是 `maxPerTarget`（另有「偷取总值不超过…%」→ `capTotalRatio`）。
 * 与第 87 轮的 `若拥有4层` 同一套做法：**已被建模的片段先剥掉**，再看剩下的话有没有没建模的条件。
 *
 * ★ 但**只在 IR 里真的有偷取产物时才剥**（`irFacts.hasSteal`）—— 否则就违反「解析不出来 ≠ 没有条件」：
 *   一个写着上限、可解析器没能读出数字的技能，会因此被判成"无条件可执行"。
 */
export const PASSIVE_STEAL_CAP_RE = /每个目标最多可?偷取\s*[0-9]+\s*次(?:相同属性)?|偷取总值不超过[^。；]{0,40}?[0-9]+(?:\.[0-9]+)?%/g;

/**
 * ★★★ 第 77 轮：**效果细节**类的挡住理由（与"条件"分开命名）。
 *
 * 这些不是触发的前置条件，而是"这个效果本身引擎还做不像"：
 *   · `上限N层` —— 层数**封顶没有被执行**（kernel/entity.ts 的 addStatus 只是 `ex.stacks += stacks`，
 *     全库没有一处读 maxStacks）。所以「获得1层…上限4层」今天会无限叠上去。
 *   · `抵挡` / `吸收` / `存储` / `转为` —— 减伤与能量池的语义未建模。
 *
 * ★★★ 第 78 轮修了两处**假阳性**（第一版写得太宽，把不是缺口的东西也挡了）：
 *   · 裸 `上限` 会匹配到 **`生命上限`**（「恢复生命上限6%的生命」「造成其生命上限10%伤害」）——
 *     那是属性名，不是层数上限。收窄成 `上限\s*N\s*层` / `最多可叠加N层`。
 *   · 裸 `召唤` 会匹配到 **`非召唤物`**（「为生命比例最低的**非召唤物**友方治疗」）——
 *     那是目标筛选，不是召唤动作。加否定环视 `(?<!非)`。
 *   ⇒ 假阳性的代价与前几轮同类：**把"能做"的记成"做不了"**，缺口看起来比实际大。
 *   · `偷取` / `召唤` / `归还` —— 引擎明确做不到（见 compile/unmodeled.ts）。
 *
 * ★ 把它们与"条件"分开，是为了让报告能写清**下一步该修哪里**，
 *   而不是把两种缺口混成一个 `HAS_CONDITION` 数字。
 */
export const EFFECT_DETAIL_MARKERS = /偷取|(?<!非)召唤|归还|存储|转为|最高不超过|最多治疗|最多不超过/;

/**
 * ★★★ 第 85 轮：`最多抵挡该次伤害的N%` 从上面那张表里**移出**了 —— 它已经被执行
 * （`SkillIR.shield[].perHitRatio` → `Shield.perHitRatio` → `mutateHp` 的单次封顶）。
 * 同一条规矩：实现了却还挡着，就是把"能做"的记成"做不了"（第 78/79 轮各修过一次）。
 *
 * ★ 而 `最多不超过` **留着** —— 杀生丸「天生牙结界」的「最多不超过**已损失生命**的40%」
 * 是另一种形状（相对**已损失生命**，不是相对这一次伤害），引擎没有建模它。**不猜。**
 *
 * ★ 判据仍然要有可机械检查的前提：凡原文写了「最多抵挡该次伤害的N%」的技能，
 *   这个比例都必须真的被解析出来（`shield[].perHitRatio`）。
 *   tests/g51-shield-per-hit.ts 第 [4] 节逐条扫全库守着它。
 */
export const SHIELD_PER_HIT_RE = /最多抵挡该次伤害的\s*(\d+(?:\.\d+)?)\s*%/;

/**
 * ★★★ 第 80 轮：`抵挡` / `吸收` 从上面那张表里**移出**了，但它们比「上限」更麻烦 ——
 * **光看文本判不出来**：同样是「吸收」，`吸收攻击150%伤害` 会被 `P.shield` 解析成护盾（已实现），
 * 而 `吸收敌方携带的森之灵` 不是护盾。若一刀切地把「吸收」从表里拿走，
 * 后者会被放行；若留在表里，前者会被误挡。
 *
 * ⇒ 所以这一条**去问 IR**，而不是猜文本：`classifyPassive` 接受一个 `irFacts`，
 *   只有当"这句话提到抵挡/吸收，但编译产物里**没有** shield"时，才算效果缺口。
 *   `hasShield = true` 时这一条不成立 —— 因为护盾确实被解析出来了（第 80 轮还修好了它的基准）。
 *
 * ★ 这也让"缺口表"第一次有了一个**来自编译产物**的判据，而不只是正则。
 *   前提同样被机械守着：凡提到抵挡/吸收的技能，要么有 shield、要么有 shieldSkips、
 *   要么这条标记仍然挡着（见 tests/g47-shield-base.ts 第 [5] 节）。
 */
export const SHIELD_MARKER_RE = /抵挡|吸收/;

/** ★ 第 80 轮：分类时可以参考的**编译产物事实**（不再是纯文本猜测） */
export interface IrFacts {
  /** 这个技能的 IR 里解析出了护盾 —— 于是「抵挡/吸收」不再算缺口 */
  hasShield?: boolean;
  /**
   * ★★★ 第 105 轮：这个技能的 IR 里解析出了**偷取**（SkillIR.steals）——
   *   于是「偷取」不再算效果缺口。与 hasShield 同一条规矩：**去问 IR，不猜文本**。
   *   起因：首无「冥火」整条技能只有一句「造成伤害时，偷取目标40%暴击」，
   *   它被判成 EFFECT 缺口之后**根本不会注册**（第 88 轮的效果闸门），
   *   于是"实现了却没有触发者" —— g60 的被动路径端到端当场红。
   */
  hasSteal?: boolean;
  /**
   * ★★★ 第 129 轮：这个技能的 IR 里解析出了**触发式自复活**（SkillIR.selfRevive）——
   *   于是「则消耗所有层数」不再算未建模条件（它就是复活的前置动作，由 kernel/self-revive.ts 执行）。
   *   与 hasSteal 同一个坑、同一条规矩：**去问 IR，不猜文本**。
   *   不剥的话，骨女「怨生」的复活句里那个「层数」会被 CONDITION_MARKERS_NO_PROB 拦下 ⇒
   *   整条判成"有条件读不出来" ⇒ **永远不注册**（复活接线了也没有触发者）。
   */
  hasSelfRevive?: boolean;
}

/**
 * ★★★ 第 129 轮：「（则）消耗所有层数」= 触发式复活的前置动作，编译产物里由 `selfRevive.consumeStacks` 承载。
 *   与 PASSIVE_STEAL_CAP_RE 同型：只在 IR 里真有产物时才剥（见 IrFacts.hasSelfRevive 的注）。
 */
export const PASSIVE_CONSUME_STACKS_RE = /(?:则)?消耗[^，。；]{0,6}层数/g;

/**
 * ★★★ 第 79 轮：`上限N层` / `最多可叠加N层` 从上面那张表里**移出**了 ——
 * 因为第 78 轮把层数上限**真的执行**了（`SkillIR.statusCaps` → `addStatus` 封顶）。
 * 标记表必须跟着实现走：实现了却还挡着，就是把"能做"的记成"做不了"（第 78 轮刚修过两次同类假阳性）。
 *
 * ★ 但"移出"不能只靠这句话 —— 它有一个**可机械检查的前提**：
 *   凡原文写了 `上限N层` 的地方，上限都必须真的被解析出来（`statusCaps`），
 *   或者被如实记成"不猜"（`statusCapSkips`）。**两者都没有 = 上限没被执行，此时这张表必须收回它。**
 *   tests/g46-status-caps.ts 第 [5] 节逐条扫全库守着这个前提。
 */
export const CAP_MARKER_RE = /上限\s*(\d+|[一二两三四五六七八九十])\s*层|最多(?:可)?叠加\s*(\d+|[一二两三四五六七八九十])\s*层/;

/**
 * ★★★ 第 75 轮：「有 X% 概率 …」里的那个 X。
 *
 * 由来：这是全库**最常见**的一类条件（75 条有条件被动里 33 条含它），
 * 而且它正是第 69 轮那个错误的源头 —— 「有40%[tips_2]为攻击者附加…」里的 40%
 * 藏在占位符后面，过滤器看不见，于是 40% 被执行成了 100%。
 *
 * 形状是单一的，所以判据可以写死：**紧挨着「概率」的那个百分数**。
 * 允许中间隔一个方括号引用（`[基础概率]` / `[tips_2]` 已被 resolveTips 解析成规范名）。
 * 实测唯一条件就是概率的 12 条里，**每一条都只有一个 `N% 概率`**，没有歧义。
 */
export const PASSIVE_PROB_RE = /(\d+(?:\.\d+)?)\s*%\s*(?:\[[^\]]*概率[^\]]*\]|概率)/;

/**
 * ★★★ 第 87 轮：「**若拥有N层[buff_X]**」—— 运行时条件求值的第一种。
 * 只认「若拥有 / 若带有 N 层 [buff_x]」这一种写法（层数门槛），
 * 且**要求状态引用紧跟在层数后面** —— 否则不归因（不猜）。
 */
/**
 * ★★★ 第 129 轮：**「N层以上」也是同一个门槛**。
 *   骨女「怨生」写的是「阵亡时，若拥有4层以上[buff_2232_1]」，旧正则要求层数后面紧跟方括号，
 *   于是这一整条被判成"有条件但读不出来" ⇒ HAS_CONDITION ⇒ **永远不注册**（复活那一句也一起没了）。
 *   中文的「以上」含本数（4层以上 = ≥4），与「4层」是同一个判据，所以这个后缀**不改变语义**，
 *   只是把它认出来。实测全库只有这 1 条（tools/_probe-revive-scope.ts）。
 *   ★★ 用**非捕获组**：捕获组的编号是外部契约（judgeClause / skill-compiler 都按下标取值），
 *     往中间插一个组会把 statusRef 读成层数 —— 一个不会报错的错。
 */
export const PASSIVE_STACK_RE = /若(?:拥有|带有|身上有)\s*(\d+)\s*层(?:以上)?\s*\[buff_(\d+_\d+)\]/;

/**
 * ★★★ 第 193 轮：**「若…」之外的其它条件写法里，那个 buff 引用也不是效果**。
 *
 * 由来：第 181 轮的 `statusRefConditionOnly` 只认 `PASSIVE_STACK_RE`（「若拥有N层」）。
 *   实测全库有 **17 个技能**的引用落在条件写法里，其中 **15 个**没被标出来 ——
 *   于是「若自身未拥有[buff_3464_1]」（聆海金鱼姬「凌波」）这样的**检查**被执行成了**再给一层**（多算）。
 *   ★ 最要命的一条是 346 正在典型阵容里 ⇒ 这条不只影响冷门技能。
 *
 * 判据（三条一起看，fail-closed）：
 *   ① 子句里出现条件词（若 / 如果 / 只要 / 除非 / 需）；
 *   ② 那个引用出现在**条件词之后**（条件词之前的引用与这条无关）；
 *   ③ 条件词与引用之间**没有施加类动词**（获得 / 附加 / 施加 / 赋予）——
 *      这一条把「若生命低于50%则获得[buff_x]」这种**同一子句里的后果**排除在外（那才是效果）。
 * ★ 只判「是不是条件」，不判「条件成不成立」：不成立时的运行时求值仍归 judgeClause 的条件模型管。
 */
const CONDITION_MARKER_RE = /若|如果|只要|除非|需/;
const APPLY_VERB_RE = /获得|附加|施加|赋予/;
/**
 * ★★★ 第 193 轮：**计数读法** —— 引用紧跟在「每…层」后面。
 *   「每层[buff_x]增加1次攻击次数」「每有1层[buff_x]额外造成1次伤害」「每获得5层[buff_x]，自身增加20%行动条」
 *   「每消耗1层[buff_x]使系数提升30%」—— 这四种都是在**按层数读**（缩放 / 门槛），不是「给几层」。
 *   实测 17 个槽位命中，此前**全部**被当成效果施加（施放一次就凭空多出层数）。
 *   ★ 与「获得N层」的分界就是那个**每**字：没有 每 的「获得/附加N层」是写，有 每 的是读。
 */
const COUNT_READ_RE = /每(?:有|获得|消耗|使用)?\s*(?:\d+|[一二两三四五六七八九十])?\s*层\s*$/;

/** 这个引用在子句里是不是**只当条件**（见上注） */
export function refIsConditionOnly(clause: string, ref: string): boolean {
  const c = String(clause ?? "");
  const at = c.indexOf("[buff_" + ref + "]");
  if (at < 0) return false;
  /** 读法一：计数（「每…层[buff_x]」）—— 与条件词无关，单独判 */
  if (COUNT_READ_RE.test(c.slice(0, at))) return true;
  /** 读法二：条件写法（「若…[buff_x]」） */
  const m = CONDITION_MARKER_RE.exec(c);
  if (!m || at < m.index) return false;
  /**
   * ★ 先把**被动语态**的两处剥掉：「若敌方**被附加**[buff_x]」说的是「敌方身上已经被附加了它」——
   *   那是**状态**，不是本技能在施加。不剥的话它会被 APPLY_VERB_RE 判成后果（实测：以津真天「风之舞」）。
   *   判据与第 183 轮的假阳性伤害同一路：**动词的方向**决定它是读还是写。
   */
  const between = c.slice(m.index, at).replace(/被(?:附加|施加)/g, "");
  return !APPLY_VERB_RE.test(between);
}

/**
 * ★★★ 第 75 轮：**已被建模的条件**。`null` = 无条件（可以按原样执行）。
 *
 * ★★★ 第 87 轮加入第二种：`STACK_AT_LEAST`（「若拥有N层[buff_X]」）。
 *   这是**运行时条件求值**的第一种 —— 概率只需要掷一次骰子，
 *   而这一种要在触发的那一刻去**读战斗状态**（拥有者身上这个状态有几层）。
 *   做法：判据里把这段**剥掉**，再看剩下的话还有没有没建模的条件；
 *   运行时在触发时求值，不满足就**跳过**。
 *   ⇒ 机制一旦建好，后面那些「若/当」形状（若目标带有X / 若自身未处于X / 若防御高于目标…）
 *     都可以挂到同一条路径上，而不是每来一种就改一次分类器。
 */
export type PassiveCondition =
  | {
      kind: "PROBABILITY";
      /** 0..1 的条件概率（与 kernel/rng.ts 的 testHit(p) 同一口径） */
      p: number;
      /** 判定依据的子句 —— 判错时要能一眼看出是照哪句话判的（与 unmodeled / revive 同一原则） */
      evidence: string;
    }
  | {
      kind: "STACK_AT_LEAST";
      /** 要检查的状态引用，形如 `2072_1`（与 SkillIR.statusRefs 同一口径） */
      statusRef: string;
      /** 至少要有几层 */
      n: number;
      evidence: string;
    };

/** ★ 第 95 轮：一条触发句的判定（含它的原文子句） */
export interface PassiveUnit extends PassiveVerdict { clause: string }

/**
 * ★★★ 第 179 轮：**触发句的主语** —— 这件事必须发生在**谁**身上。
 *
 * 由来（第 178 轮勘定）：全库 29 条子句的主语**不是拥有者** ——
 *   「非召唤物的敌方目标回合结束时，言灵增加1层墨灵」（主语=敌方）·
 *   「全体目标回合结束时，言和获得1层…」（主语=任意）·
 *   「任一友方受到伤害时…」（主语=友方）。而此前的模型里**只有 SELF / TARGET 两种 side**：
 *   side=TARGET 的族按「拥有者就是承受者」过滤（主语是别人时**永远不触发**），
 *   没有 side 的族按 range SELF 装（只有自己的事件才触发 —— 主语是敌方/友方时**方向反了**）。
 *
 * 判据取自**子句原文**（与族判定同一层，逐句、可复核）；认不出来就是 `SELF`（fail-closed，与今天逐位相同）。
 * ★ 这一维与「承受者」（第 176 轮的 bearer）是**两件事**：主语决定"什么时候触发"，承受者决定"效果给谁"。
 */
export type TriggerSubject = "SELF" | "ALLY" | "ENEMY" | "ANY";

/**
 * 主语判据表。**顺序有意义**：
 *   · 「全体友方」是**友方**（TEAM），不是「全体」（ALL）—— 所以 ALLY 必须排在 ANY 前面；
 *   · 「非召唤物的敌方…」是敌方；
 *   · 认不出来 ⇒ SELF（不猜）。
 */
/**
 * ★★★ 第 189 轮：**带限定语的主语**（「带有[buff_x]的敌方阵亡时」「生命比例低于40%的非自身的友方受到伤害时」）。
 *
 * 为什么上一轮不收：限定语让主语**不在句首**（「…的敌方」），而上一轮的判据全部锚在句首 ——
 *   放宽锚点就会撞上第 179 轮那个坑（九命猫的「并**对随机敌方目标**施放『X』」被判成主语=敌方，复活没了）。
 *
 * 这一轮的做法是把"放宽"限制在一张**实测出来的词头表**上：只有当限定语**以某个词头开头**、
 *   且整段限定语里没有逗号时，才承认它是一个主语短语。这样：
 *   · 收：「带有[buff_2163_1]的敌方阵亡时」·「生命比例低于40%的非自身的友方受到伤害时」；
 *   · 不收：「对带有[buff]的敌方造成伤害时」（**对**是介词，那个名词是宾语）·
 *     「使非召唤物的友方全体获得…」（**使**）·「为生命比例最低的友方治疗…」（**为**）
 *     —— 它们都不以词头表里的词开头 ⇒ 落回 SELF（fail-closed，与今天逐位相同）。
 *   ★ 词头表取自实测（tools/_probe-subject189b.ts：全库 129 条「…的敌方/友方」的 84 种词头），
 *     不是凭感觉写的；表外的写法一律不收。
 */
const QUALIFIER_HEADS = [
  /** 状态类限定语（可能携带一个可执行的条件：见 QUALIFIER_STATUS_RE） */
  "带有", "携带", "拥有", "处于", "附着", "没有", "未拥有",
  /** 被动语态 / 属性类 */
  "被", "受", "生命比例", "生命值", "血量", "当前生命", "当前血量",
  /** 身份类（不存在"条件"，只是把范围缩小到一个子集） */
  "非召唤物的", "非自身的", "除自身外的", "除自身外", "自身外的", "自身外", "其他", "其余",
  "非阴阳师的",
  /** 场地/状态词（同样可能带条件） */
  "花海中的", "结界中的", "场上的", "用餐状态的", "清醒状态的",
] as const;
const QUALIFIER_HEAD_RE = QUALIFIER_HEADS.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
/** 「…的<主语>」——限定语不许跨逗号（跨了就不是同一句的主语） */
const QUALIFIED_SUBJECT_RE = new RegExp("^(?:当|若|每当|在)?(?:" + QUALIFIER_HEAD_RE + ")[^，。；]{0,22}?的(?:非召唤物的|非自身的)?(敌方|友方|全体友方|其他友方|其余友方)");
/**
 * ★★★ 第 189 轮：限定语里的**条件**能不能被表达。
 *   能表达的只有一种：`动词 + [buff_x]`（「带有/携带/拥有/处于/附着」）。
 *   出现条件词却拿不到 buff 引用 ⇒ **整条不收**（fail-closed）——
 *   否则「带有棋子的敌方在其回合结束时」会变成"**任何**敌方回合结束都触发"，那是多算，比少算更坏。
 *   实测被这条挡下的：带有棋子的敌方（弈）· 带有1、2、3个天平的敌方（卖药郎）·
 *   被记录的友方（匣中少女）· 被小鬼占位的敌方（鬼使白/阎魔）· 生命比例最低的友方（蝴蝶精）。
 */
const QUALIFIER_STATUS_RE = /(?:带有|携带|拥有|处于|附着)\[buff_(\d+_\d+)\]/;
const QUALIFIER_CONDITION_RE = /带有|携带|拥有|处于|附着|没有|未拥有|生命比例|生命值|血量|当前生命|被|受|花海中的|结界中的|场上的|用餐状态的|清醒状态的/;
/** 显式**排除自己**的写法（KB 自己就用「其他友方」表示不含自身，见 report §160/§161） */
const EXCLUDES_SELF_RE = /(?:其他|其余)友方|除自身|非自身的|自身外/;

/**
 * 一条子句的主语**规格**（主语 + 排除自己 + 限定语带来的状态条件）。
 * `rejected` 非空 = 认出了限定语主语但**条件表达不了** ⇒ 调用方按 SELF 处理（并可以记账）。
 */
export interface SubjectSpec {
  subject: TriggerSubject;
  excludesSelf: boolean;
  /** 限定语要求主语实体持有的状态引用（没有条件就是 null） */
  requiresStatus: string | null;
  /** 认出来了却没收的理由（给报表记账用；收下了就是 null） */
  rejected: string | null;
}

const SUBJECT_RULES: Array<{ subject: TriggerSubject; test: RegExp }> = [
  /**
   * ★ 两条**都是实测出来的**：
   *   ① 允许一个前导词（当 / 若 / 每当 / 在）——「**当**敌方造成伤害暴击时…」也是敌方主语；
   *   ② **整条判据必须锚在句首** —— 第一版把「敌方(目标|单位|全体)」写成**不带锚点**的分支，
   *      于是九命猫的复活句（「阵亡时，若拥有4层…，并**对随机敌方目标**施放『X』」）被判成主语=敌方，
   *      处理器装到了 ENEMY 上 ⇒ **自己阵亡时不再触发**，g89 第 [3] 节当场照出来（复活没了）。
   *   ★ 带限定语的写法（「带有[buff]的敌方受到伤害时」「生命比例低于40%的非自身的友方受到伤害时」）
   *     这一轮**不收**（认不出来 ⇒ SELF）—— 属于下一批（限定语 + 主语），fail-closed。
   */
  { subject: "ENEMY", test: /^(?:当|若|每当|在)?(?:非召唤物的)?敌方/ },
  { subject: "ALLY", test: /^(?:当|若|每当|在)?(?:自身及友方|除自身|其他友方|其余友方|任一友方|所有友方|全体友方|友方)/ },
  { subject: "ANY", test: /^(?:当|若|每当|在)?(?:场上|任意|全体)/ },
];

/**
 * ★★★ 第 189 轮：一条子句的主语**规格**（唯一实现 —— subjectOf 现在是它的薄壳）。
 *
 * 顺序有意义：先看**锚在句首**的三条（敌方 / 友方 / 任意，第 179 轮），再看**带限定语**的那一条。
 *   反过来会让「带有[buff]的友方…」先被锚在句首的规则漏掉（它俩本来就不冲突，但这个顺序读起来更清楚）。
 * ★ 认不出来 ⇒ SELF（fail-closed，与今天逐位相同）。
 */
export function subjectSpecOf(clause: string): SubjectSpec {
  const c = String(clause ?? "");
  for (const r of SUBJECT_RULES) {
    if (r.test.test(c)) return { subject: r.subject, excludesSelf: EXCLUDES_SELF_RE.test(c.slice(0, 12)), requiresStatus: null, rejected: null };
  }
  const m = QUALIFIED_SUBJECT_RE.exec(c);
  if (!m) return { subject: "SELF", excludesSelf: false, requiresStatus: null, rejected: null };
  const head = c.slice(0, m[0].length);
  const sm = QUALIFIER_STATUS_RE.exec(head);
  /**
   * ★ 条件词出现却没有可执行的 buff 引用 ⇒ **整条不收**（见 QUALIFIER_CONDITION_RE 的注）。
   *   注意「非召唤物的 / 非自身的 / 除自身外的 / 其他 / 其余」不在条件词表里 ——
   *   它们是**身份标记**（第 179 轮起「非召唤物的敌方」就一直按敌方收，这里保持一致）。
   */
  if (!sm && QUALIFIER_CONDITION_RE.test(head)) {
    return { subject: "SELF", excludesSelf: false, requiresStatus: null, rejected: "LIMITER_CONDITION_UNMODELED" };
  }
  return {
    subject: m[1].includes("敌方") ? "ENEMY" : "ALLY",
    excludesSelf: EXCLUDES_SELF_RE.test(head),
    requiresStatus: sm ? String(sm[1]) : null,
    rejected: null,
  };
}

/** 一条子句的**主语**（见 TriggerSubject 的注）。第 189 轮起是 subjectSpecOf 的薄壳。 */
export function subjectOf(clause: string): TriggerSubject {
  return subjectSpecOf(clause).subject;
}

export interface PassiveVerdict {
  family: string | null;
  /** ★★★ 第 179 轮：这条子句的主语（谁身上发生这件事）。由 judgeClause 统一补上。 */
  subject?: TriggerSubject;
  /**
   * ★★★ 第 189 轮：主语的**两个附加事实**（都由 judgeClause 从子句原文判定）。
   *   · `subjectExcludesSelf`：文本显式排除拥有者（「其他友方 / 其余友方 / 除自身 / 非自身的 / 自身外」）；
   *   · `subjectRequiresStatus`：限定语要求主语实体持有某个状态（「**带有**`[buff_x]`的敌方阵亡时」）——
   *     条件表达不了的那些**根本收不到这里**（见 kernel/triggers.ts 的 QUALIFIER_CONDITION_RE）。
   */
  subjectExcludesSelf?: boolean;
  subjectRequiresStatus?: string;
  verdict: "NO_TRIGGER" | "HAS_CONDITION" | "HAS_PLACEHOLDER" | "CANDIDATE";
  clause: string;
  /** ★★★ 第 75 轮：已建模的条件（今天只有概率一种）。`null` = 无条件。 */
  condition: PassiveCondition | null;
  /**
   * ★★★ 第 77 轮：被挡住时，**挡住它的到底是什么**。
   *   `"CONDITION"` = 触发的前置条件没建模（若 / 每层 / 达到N层 …）；
   *   `"EFFECT"`    = 条件没问题，但这个**效果**引擎做不像（上限N层 / 抵挡 / 偷取 / 召唤 …）。
   *   `null` = 没被挡住。
   * ★ 拆这一刀的理由见 CONDITION_MARKERS_NO_PROB 的注释：混在一起会导致**修错方向**。
   */
  blockedBy: "CONDITION" | "EFFECT" | null;
}

/**
 * ★★ 一个被动技能**今天能不能安全地被执行**。纯函数，供 tests/g42 直接喂合成文案。
 *   四个判定互斥且穷尽，顺序有意义：先看有没有可映射的触发时机，再看条件，再看占位符。
 */
/**
 * ★★★ 一条子句属于哪个触发时机 —— **取名字最长的那个**（最具体优先）。
 *
 * 为什么不写成「第一个 `clause.includes(family + "时")` 的」：那是**子串匹配**，
 * 而中文的触发时机名互相包含：
 *   「受到攻击时」.includes("攻击时") === true      ← 就是这一个字符组的差别
 * 于是「受到攻击时」被判成 family「攻击」（→ `SKILL_START`，**未派发**），
 * 而它真正的归属是「受到攻击」（→ `BEFORE_DAMAGE`，**已派发**）。
 *
 * 第 73 轮实测：25 条含「攻击时」的被动子句里，**12 条**被这样错判 ——
 * 而且错判的方向是「已派发的时机被记成未派发」，也就是**把能做的说成不能做**。
 *
 * 判据改成「谁最具体谁说了算」，对上述所有包含关系都成立：
 *   「受到攻击」>「攻击」、「自身回合开始」>「回合开始」。
 */
export function matchFamily(clause: string, families: TriggerFamily[] = TRIGGER_FAMILIES): TriggerFamily | null {
  let best: TriggerFamily | null = null;
  for (const f of families) {
    /**
     * ★★★ 第 107 轮：有的族**不能用「名字 + 时」这种连续子串**表达 ——
     *   典型是「施放『X』**前**」（噬魂）：「施放」与「前」之间隔着技能名，
     *   写成 `family: "施放前"` 永远匹配不到。所以给族一个可选的 `test` 正则，
     *   命中判据仍然只有一处（这里），具体性规则（名字更长者优先）也不变。
     */
    if (f.test) { if (!f.test.test(clause)) continue; }
    else if (!clause.includes(f.family + "时")) continue;
    if (!best || f.family.length > best.family.length) best = f;
  }
  return best;
}

export function classifyPassive(description: string, cost: number, families: TriggerFamily[] = TRIGGER_FAMILIES, irFacts: IrFacts = {}): PassiveVerdict {
  const text = String(description ?? "").replace(/<br>/g, "。");
  if ((Number(cost) || 0) >= 0) return { family: null, verdict: "NO_TRIGGER", clause: "", condition: null, blockedBy: null };
  // 先给每条子句定归属（最具体优先），再按登记册顺序挑优先级最高的一条 ——
  // 顺序语义与旧版一致，改的只有「子句归哪个 family」这一步。
  const clauses = text.split(/[。；]/);
  const hits = clauses.map(c => ({ clause: c, f: matchFamily(c, families) })).filter(h => h.f && (h.f as TriggerFamily).kbCount > 0);
  const hit = families.filter(f => f.kbCount > 0).map(f => hits.find(h => (h.f as TriggerFamily).family === f.family)).find(Boolean) as { clause: string; f: TriggerFamily } | undefined;
  if (!hit) return { family: null, verdict: "NO_TRIGGER", clause: "", condition: null, blockedBy: null };
  return judgeClause(hit.clause, hit.f, irFacts);
}

/**
 * ★★★ 第 95 轮：**逐句触发路由** —— 一个被动可以有多条互不相干的触发句。
 *
 * 由来（三次撞同一堵墙）：
 *   · 第 87 轮「九命猫『九命』」—— 三句话：暴击时 / 阵亡时(复活) / 阵亡时(附加 buff)，
 *     而分类器只挑**一族**，于是"4 层"这个条件会顺带管住另一句本来无条件的话；
 *   · 第 94 轮「骨女『怨生』」—— 触发句是「受到攻击时」，复活句是另一句，于是复活永远挂不上；
 *   · 第 95 轮「阿香『蛇之影』」—— 第一句是「攻击时…」，第二句才是「…受到…时反击」。
 *
 * 旧模型（一个技能 = 一族 + 一个条件 + 一个处理器）在这三处都不成立：
 * **被动的每一句话是它自己的触发单元。**
 *
 * 判据与 classifyPassive 完全同源（同一个 judgeClause），差别只在"挑一条"还是"逐条出"。
 * 返回顺序 = 文本顺序（运行时按此顺序注册，事件顺序才是可解释的）。
 */
export function classifyPassiveUnits(description: string, cost: number, families: TriggerFamily[] = TRIGGER_FAMILIES, irFacts: IrFacts = {}): PassiveUnit[] {
  const text = String(description ?? "").replace(/<br>/g, "。");
  if ((Number(cost) || 0) >= 0) return [];
  const out: PassiveUnit[] = [];
  for (const clause of text.split(/[。；]/)) {
    const f = matchFamily(clause, families);
    if (!f || f.kbCount <= 0) continue;
    out.push(judgeClause(clause, f, irFacts));
  }
  return out;
}

/**
 * ★★★ 第 95 轮：**一条子句**的判定（classifyPassive 与 classifyPassiveUnits 共用的唯一实现）。
 * 抽出来的理由与 classifySkill 一样：同一条判据有两个入口，就一定会分叉。
 */
export function judgeClause(clause: string, f: TriggerFamily, irFacts: IrFacts = {}): PassiveUnit {
  /**
   * ★★★ 第 179 轮：**主语在唯一入口处补上** —— judgeClause 是"一条子句的判定"的唯一实现
   *   （classifyPassive 与 classifyPassiveUnits 都走它），所以在这里补一次就够，不需要改那十几个 return。
   * ★★★ 第 189 轮：走 subjectSpecOf（主语 + 排除自己 + 限定语的状态条件），三个字段一起补上。
   */
  const spec = subjectSpecOf(clause);
  return {
    ...judgeClauseCore(clause, f, irFacts),
    subject: spec.subject,
    ...(spec.excludesSelf ? { subjectExcludesSelf: true } : {}),
    ...(spec.requiresStatus ? { subjectRequiresStatus: spec.requiresStatus } : {}),
  };
}

function judgeClauseCore(clause: string, f: TriggerFamily, irFacts: IrFacts = {}): PassiveUnit {
  const hit = { clause, f };
  // 顺序有意义：先排掉**未建模**的条件，再看有没有已建模的条件。
  // ★★★ 第 87 轮：**先剥掉已被建模的条件片段，再判断剩下的话有没有没建模的条件**。
  //   这一刀是为了「若拥有4层[buff_x]」——它的「若」会被下面的标记表拦下，
  //   而那句话其实**已经被建模了**（运行时读层数）。剥掉之后如果什么都不剩，就是干净的候选。
  //   ★ 只剥**已建模**的那一段；剥不掉的（若目标带有X / 若防御高于目标 …）原样留给标记表。
  const stackCond = clause.match(PASSIVE_STACK_RE);
  let residual = stackCond ? clause.replace(PASSIVE_STACK_RE, "") : clause;
  // ★★★ 第 108 轮：偷取类的上限（已建模为 maxPerTarget / capTotalRatio）同样先剥掉 —— 见 PASSIVE_STEAL_CAP_RE。
  if (irFacts.hasSteal) residual = residual.replace(PASSIVE_STEAL_CAP_RE, "");
  // ★★★ 第 129 轮：触发式复活的「消耗所有层数」（见 PASSIVE_CONSUME_STACKS_RE 的注）
  if (irFacts.hasSelfRevive) residual = residual.replace(PASSIVE_CONSUME_STACKS_RE, "");
  if (CONDITION_MARKERS_NO_PROB.test(residual)) return { family: hit.f.family, verdict: "HAS_CONDITION", clause, condition: null, blockedBy: "CONDITION" };
  // ★★ 效果细节：条件没问题，但这个效果引擎做不像 —— **与"条件"分开记账**。
  /**
   * ★★ 「偷取」这一族在第 99–105 轮陆续接线（属性偷取 / 增益偷取 / 造成伤害时触发），
   *   所以它与护盾一样：**提到它要看 IR 里有没有** steal 产物，而不是一律算缺口。
   */
  if (EFFECT_DETAIL_MARKERS.test(clause) && !(/偷取/.test(clause) && irFacts.hasSteal)) {
    return { family: hit.f.family, verdict: "HAS_CONDITION", clause, condition: null, blockedBy: "EFFECT" };
  }
  // ★★ 第 80 轮：「抵挡/吸收」要看 IR 事实，而不是只看文本 —— 护盾被解析出来了就不算缺口。
  if (SHIELD_MARKER_RE.test(clause) && !irFacts.hasShield) {
    return { family: hit.f.family, verdict: "HAS_CONDITION", clause, condition: null, blockedBy: "EFFECT" };
  }
  if (/\[tips_\d+\]/.test(clause)) return { family: hit.f.family, verdict: "HAS_PLACEHOLDER", clause, condition: null, blockedBy: null };
  // ★★★ 第 75 轮：「有 X% 概率 …」不再算"没法执行" —— 概率已经被建模，交运行时去掷。
  // ★★★ 安全网（第 75 轮第一版就踩到了）：如果这条子句里出现了「概率」，
  //   但正则**没能**把数值抠出来，那它**不是**无条件 —— 只是我解析不出来。
  //   第一版的正则漏了 `40%[基础概率]`（"概率"两个字在方括号**里面**）这种写法，
  //   于是铁鼠「横财护身」被判成"无条件的候选"，40% 又要被执行成 100% ——
  //   第 69 轮那个错误被我自己用另一种方式引了回来。g42 当场抓住了它。
  //   ⇒ 与 compile/unmodeled.ts 同一条原则：**解析不出来 ≠ 没有条件**。
  if (!PASSIVE_PROB_RE.test(clause) && clause.includes("概率")) {
    return { family: hit.f.family, verdict: "HAS_CONDITION", clause, condition: null, blockedBy: "CONDITION" };
  }
  const pm = clause.match(PASSIVE_PROB_RE);
  if (pm) {
    const p = Number(pm[1]) / 100;
    // 0 或 >100 的写法不可能出现在真实文案里；真出现了就退回"有条件"，不猜。
    if (!(p > 0 && p <= 1)) return { family: hit.f.family, verdict: "HAS_CONDITION", clause, condition: null, blockedBy: "CONDITION" };
    return { family: hit.f.family, verdict: "CANDIDATE", clause, condition: { kind: "PROBABILITY", p, evidence: clause }, blockedBy: null };
  }
  // ★ 第 87 轮：层数门槛（运行时求值）。剥完之后没有别的条件，才算干净候选。
  if (stackCond) {
    return {
      family: hit.f.family, verdict: "CANDIDATE", clause, blockedBy: null,
      condition: { kind: "STACK_AT_LEAST", statusRef: stackCond[2], n: Number(stackCond[1]), evidence: clause },
    };
  }
  return { family: hit.f.family, verdict: "CANDIDATE", clause, condition: null, blockedBy: null };
}

export interface TriggerFamily {
  /** ★ 第 107 轮：命中判据（可选）。给了它就不再用「名字 + 时」的连续子串判据 —— 用于「施放『X』前」这种不连续写法 */
  test?: RegExp;
  /** 原文里的触发写法（如同「受到伤害时」去掉"时"） */
  family: string;
  /**
   * ★★★ 第 95 轮：**这一族的触发者是哪一侧** —— 它决定订阅怎么注册。
   *
   *   SOURCE（默认）：「造成伤害 / 攻击 / 暴击」——事件的 origin 就是被动拥有者，
   *                   `range: "SELF"` 天然正确；
   *   TARGET：「受到伤害 / 受到攻击 / 被攻击 / 受到敌方攻击」——事件的 origin 是**伤害来源**！
   *                   `range: "SELF"` 于是只会匹配到"伤害来源恰好是自己"的情形 ——
   *                   也就是说，一条「受到伤害时」的被动会在**自己打人的时候**触发（方向反了）。
   *
   * ★ 这条声明不是文档：passive-runtime 按它决定注册 range，并在 TARGET 侧加
   *   `ctx.input.target.id === 自己` 的**失败关闭**过滤。tests/g56 双向钉住（打人时不许触发、
   *   挨打时必须触发）；g42 机械检查"名字以 受到/被 开头的族必须标 TARGET"。
   */
  side?: "SOURCE" | "TARGET";
  /** ★★★ 第 95 轮：「暴击」这一族只在该次伤害**真的暴击**时触发（读 ctx.result.isCrit） */
  requiresCrit?: boolean;
  /** 该写法在**被动技能**里出现的次数（由 tests/g42 从 KB 重新数，对不上就红） */
  kbCount: number;
  /** 对应的事件码（EV 表里的键）；没有对应写 null */
  evCode: string | null;
  /** 这个映射为什么这么定（含歧义时说明取舍） */
  note: string;
}

// ★★★ 第 73 轮：kbCount 的口径更正 —— 此前 6 个数字**系统性偏低**
//
// 旧口径（g42 的 survey()）用正则 `([^，。；、]{1,10}?)时` 抓短语。它**非贪婪**，
// 于是从"本段最后一个逗号"开始抓，凡是**带限定词**的写法都会把限定词一起吞掉：
//
//   使用技能或普攻造成伤害时   → 抓到「使用技能或普攻造成伤害」
//   战斗开始及回合结束时      → 抓到「战斗开始及回合结束」
//   自身回合开始时           → 抓到「自身回合开始」
//   敌方阵亡时              → 抓到「敌方阵亡」
//   造成伤害暴击时           → 抓到「造成伤害暴击」
//
// 后果：这 6 个 family 的计数偏低（回合结束 11 → 实测 **19**，造成伤害 14 → **20**，
// 阵亡 6 → **11**，回合开始 9 → **13**，受到伤害 11 → **12**，暴击 2 → **3**），
// 而 g42 §[2] 的"重新数一遍"用的是**同一个正则**，所以它一直同意 —— 同意的原因
// 不是数字对，是**两边用同一把坏尺子**。这是本项目第 3 次遇到"计数一致但都错"。
//
// ★ 注意：这 6 个数字错了，但**行为一直是对的** —— 子串匹配认得出带限定词的写法
//   （「自身回合开始时」.includes("回合开始时") === true）。错的只有计数与验证。
//   行为上的错在另一处（见 matchFamily：挨打的子句被判成「攻击」）。
//
// 新口径：**逐子句取最长的 family 名**，与 classifyPassive 的归属判据同一套。
export const TRIGGER_FAMILIES: TriggerFamily[] = [
  /**
   * ★★★ 第 135 轮：**「先机」** —— tips_7 的定义是「先机：在战斗开始时进行动作」。
   *
   * 全库 **7 条被动**这么写（座敷童子「福运昌隆」/二口女「恐惧」/辉夜姬「火鼠裘」/彼岸花「赤团华」/
   * 追月神「明月潮生」/蟹姬「这下有劲了」/聆海金鱼姬「凌波」），而它们此前**一条都挂不上**：
   *   · 写法里没有「战斗开始」四个字 ⇒ 「名字+时」的子串判据永远匹配不到；
   *   · 于是「战斗开始获得1点鬼火」「战斗开始获得4层印记」这类**开局就生效**的效果在自动战斗里全都不存在。
   * ★ 判据用 test 而不是子串：原文写的是 `[tips_7]`（原始）或 `[先机]`（解析后）——
   *   两种形态都不含「先机+时」，所以这里同时认 **先机** 与 **\[tips_7\]**（同一个占位符，不会误伤）。
   * ★ 事件码选 BATTLE_START（第 74 轮起有派发点）：tips_7 的原话就是「在战斗开始时进行动作」。
   *   计数 7 由 tests/g42 用**同一把尺子**（matchFamily）重新数（它认 test）。
   */
  { family: "先机", test: /先机|\[tips_7\]/, kbCount: 7, evCode: "BATTLE_START",
    note: "★ 第 135 轮新增。tips_7 写明「先机：在战斗开始时进行动作」；全库 7 条被动用这个写法，此前全部挂不上（写法里没有「战斗开始」四个字）" },
  { family: "造成伤害", kbCount: 20, evCode: "AFTER_DAMAGE",
    note: "已被派发。★ 与「攻击时」的区别是：这一次攻击**真的造出了伤害**（被闪避/免疫则不算）—— 映射到 AFTER_DAMAGE 而不是 SKILL_START 就是这个原因" },
  { family: "回合结束", kbCount: 19, evCode: "TURN_END", note: "已被派发；顺序由 TurnFlags.triggersTurnEnd 决定（伪回合不触发）" },
  { family: "受到伤害", kbCount: 12, evCode: "AFTER_DAMAGE", side: "TARGET",
    note: "已被派发。★ 第 95 轮把「按 ownerId 过滤成受击方」**兑现**了：这一族注册成 range ALL，处理器里按 ctx.input.target 过滤（失败关闭）。此前是 range SELF + origin=伤害来源 ⇒ 方向反了（自己打人时触发）" },
  { family: "攻击", kbCount: 13, evCode: "SKILL_START",
    note: "★★★ 第 74 轮：**派发点已补上**（kernel/battle.ts 在技能开始执行处派发，判据 isAttackSkill = 技能 IR 里有伤害分量）。此前 0 处 dispatch，这一族 ×13 全被静默跳过。★ 与「造成伤害」是两个时点：被闪避/免疫/护盾全挡时**仍然**触发这里，而 AFTER_DAMAGE 不触发 —— 这正是两个 family 都存在的原因。★★ 第 73 轮更正：kbCount 原写 11，实测 **13**（旧数被子串匹配与正则口径一起压出来）；这条 family 还曾把 12 条「受到攻击时」也算进来，见 matchFamily 注释" },
  { family: "被攻击", kbCount: 1, evCode: "BEFORE_DAMAGE", side: "TARGET",
    note: "★ 第 73 轮补登记。同「受到攻击」：白狼「冥想」写的是「白狼被攻击时，影分身有30%概率抵挡全部单体伤害」—— 抵挡伤害必须发生在 BEFORE_DAMAGE。补这条之前，它被**子串匹配**吞进了 family「攻击」（→ SKILL_START，未派发），于是「本可以做的」被记成了「做不了」" },
  { family: "受到敌方攻击", kbCount: 1, evCode: "BEFORE_DAMAGE", side: "TARGET",
    note: "★ 第 73 轮补登记。天照「无灭」：「受到敌方攻击时，为伤害来源附加…」。★ 注意「受到敌方攻击时」**不包含**「受到攻击时」这个子串（中间隔着「敌方」），所以靠 longest-match 救不了它 —— 只能显式登记" },
  { family: "受到攻击", kbCount: 10, evCode: "BEFORE_DAMAGE", side: "TARGET",
    note: "已被派发。取 BEFORE_DAMAGE 而不是 AFTER_DAMAGE：原文说的是「受到攻击」，包含被护盾全挡、最终没掉血的情形" },
  { family: "回合开始", kbCount: 13, evCode: "TURN_START", note: "已被派发；与「自身回合开始时」共用，靠 ownerId 过滤" },
  { family: "战斗开始", kbCount: 7, evCode: "BATTLE_START", note: "已被派发（SENKI 是更早的一段，两者在文档里是不同时点）" },
  { family: "阵亡", kbCount: 11, evCode: "DEATH",
    note: "已被派发。★ 这正是被动复活（九命猫「九命」/骨女「怨生」）需要的时机 —— 事件早已存在，缺的是**被动技能的运行时**" },
  { family: "行动结束", kbCount: 4, evCode: "ACTION_END", note: "已被派发。ACTION_END 对普通回合与伪回合都会触发，与 TURN_END 的差别正在于此（伪回合不计回合）" },
  { family: "自身回合开始", kbCount: 3, evCode: "TURN_START", note: "同上，靠 ownerId 过滤成自己" },
  { family: "暴击", kbCount: 3, evCode: "AFTER_DAMAGE", requiresCrit: true,
    note: "已被派发；★ 第 95 轮把「需要读伤害结果里的 isCrit」**兑现**了（requiresCrit）：此前一条「暴击时」的被动在**每一次**伤害上都会触发" },
  /**
   * ★★★ 第 107 轮新增：**施放技能前**（噬魂「施放『焚天九尾』前，先偷取场上全体3%攻击力…」）。
   *   派发点第 74 轮就有（EV.SKILL_START，只在**攻击类**技能上派发），这一轮把它接上；
   *   全库只有 1 条被动是这个写法（量出来的）。
   */
  { family: "施放技能前", test: /施放[^。；]{0,20}前/, kbCount: 1, evCode: "SKILL_START",
    note: "★ 第 107 轮：用 test 正则而不是「名字+时」子串 —— 「施放『X』前」中间隔着技能名。SKILL_START 第 74 轮已派发（仅攻击类技能）" },
  /**
   * ★★★ 第 123 轮：这四条钉子的**理由**按实测改写（事件码在第 120/122 轮都接上了总线，
   *   但「有一个事件码」≠「有一族触发时机」—— 四条里有三条根本不是在说触发时机）。
   */
  { family: "受到治疗", kbCount: 0, evCode: "HEAL", side: "TARGET",
    note: "★★ 第 123 轮实测更正：全库含「受到治疗」的被动只有 1 条 —— 鬼王酒吞童子「红莲」的「受到治疗效果减少50%」，那是**减疗修正**，不是触发时机。旧注释写的「文案里多写成「受到治疗时」」是我猜的，猜错了。HEAL 事件现在会派发，但今天没有一条被动该挂它" },
  { family: "获得状态", kbCount: 0, evCode: "STATUS_ADD",
    note: "★★ 第 123 轮实测更正：KB 里 0 条子句写「获得状态」；真实写法是「**被施加**」（2 条）—— 那一族第 123 轮单独登记（见下一条），本条保留 0 只是为了钉住「别按字面猜文案」" },
  { family: "被施加", test: /被施加[^。；]{0,24}时/, kbCount: 2, evCode: "STATUS_ADD", side: "TARGET",
    note: "★★★ 第 123 轮登记：2 条（浮世青行灯「茕灯焕夜」再次被施加[buff]时 / 申屠子夜「渊冰三尺」敌方被施加[tips]时）。此前**没有登记**，于是这两句被算进 skipped.noTrigger（「没有触发时机」）—— 把「有时机但没登记」与「真的没有时机」说成同一件事，是本登记册最该防的错。事件码 STATUS_ADD 第 122 轮才接上总线" },
  { family: "护盾被打破", kbCount: 0, evCode: "SHIELD_BREAK",
    note: "★ 第 123 轮：SHIELD_BREAK 现在**真的会派发**（kernel/damage.ts 读 mutateHp 的 shieldBroken）。但全库 0 条被动写这个时机（「护盾被打破/击破/盾被打破」都量过）—— 这一条是「事件有了、还没有人来挂」" },
  { family: "变形", kbCount: 0, evCode: "TRANSFORM",
    note: "★ 第 123 轮：TRANSFORM 现在**真的会派发**（kernel/summon.ts 的 enterForm/returnForm）。全库 0 条被动写「变形时」（「化为/进入形态」的 3 条都是别的意思，逐条看过）—— 同上：事件有了、还没有人来挂" },
  { family: "战斗和回合开始", kbCount: 3, evCode: "BATTLE_START",
    note: "复合写法：既在战斗开始也在回合开始生效 —— 引擎里要挂到**两个**事件码上（BATTLE_START + TURN_START），只挂一个会漏掉一半时机" },
  { family: "非[tips_12]", kbCount: 3, evCode: null,
    note: "**不是触发时机**：这是「非[tips_12]时」被正则切断后的残片（[tips_N] 是引用占位符）。列在这里是为了让「count ≥ 3 一个都不漏」这条规则能过 —— 同时如实说明它为什么没有事件码" },
];
