// compile/skill-compiler.ts v2 — 技能文本 -> 可执行技能 IR
// 原则：**绝不静默丢弃**。区分三种句子：MECHANIC_PARSED / MECHANIC_UNPARSED / FLAVOR。
// 只有 MECHANIC_UNPARSED 才降低 confidence —— 风味文字（「以恶制恶，以杀止杀」）不是机制。
import { DamageType } from "../kernel/types.ts";
import { findUnmodeled, UNMODELED } from "./unmodeled.ts";
// ★ 第 140 轮：叠层场地的 spec 形状声明在 kernel（执行侧），编译器只负责按文本产出它
import type { LayerFieldSpec } from "../kernel/layer-field.ts";
import { STEAL_PROPS } from "../kernel/steal.ts";
import type { BuffWhat } from "../kernel/steal.ts";
import { parseSummonSpec, parsePresenceAuras } from "../kernel/summon.ts";
import type { SummonSpec, FormSpec } from "../kernel/summon.ts";
import { tipsTable, resolveTipsMatching } from "./tips.ts";
// ★ 第 129 轮：层数门槛的正则**只有一份**（kernel/triggers.ts 的 PASSIVE_STACK_RE）——
//   分类器与编译器必须按同一个写法读「若拥有N层[buff_X]」，否则两边会分叉。
import { PASSIVE_STACK_RE, refIsConditionOnly } from "../kernel/triggers.ts";
// ★★★ 第 186 轮：名字形态的状态引用要用「名字 → id」表（入口显式设置，与 tips 表同一条纪律）
import { buffNames } from "./buff-names.ts";
import { parseRandomPool } from "../kernel/random-pool.ts";
import { CONTROL_EFFECTS, controlDefByTipName } from "../kernel/status.ts";
import type { FieldPerTurn } from "../kernel/field.ts";

export interface SkillIR {
  id: string; charId: number; charName: string; name: string; cost: number;
  hits: number;
  damage: Array<{ ratio: number; type: DamageType; base: "atk" | "maxHp" | "lostHp" | "curHp"; note?: string }>;
  heal: Array<{ ratio: number; base: "atk" | "maxHp" | "curHp" }>;
  /**
   * ★★★ 第 80 轮：护盾的**基准**（吸收量按什么算）。
   *
   * 由来：`base` 这个字段一直存在，但两边都没兑现 ——
   *   · 解析侧把 `base` **写死成 "maxHp"**（正则里那个 `(?:生命上限|攻击)?` 组的位置在百分号**之后**，
   *     而中文的写法几乎都是「吸收**攻击**150%伤害」——"攻击"落在百分号**前面**的间隔里，那个组一辈子抓不到它）；
   *   · 执行侧更彻底：`character.ts` 直接 `self.maxHp * ratio`，**根本没读 `base`**。
   * 实测 24 条护盾条目 base 全是 maxHp，而按原文分类应为：
   *   **攻击 7 条**、生命上限 5 条、已损失生命 2 条（另有 1 条是误匹配，见 shieldSkip）。
   * 于是一个"吸收攻击150%伤害"的护盾，实际按鲤鱼精的**生命上限**算 —— 量级完全不对。
   *
   * ★ 与 `damage` 的 base 同一套取值（`lostHp` 在 damage 里已经有了），只是护盾此前一种都没用上。
   */
  shield: Array<{
    ratio: number; base: "atk" | "maxHp" | "lostHp"; evidence: string;
    /**
     * ★★★ 第 85 轮：**单次受击的抵挡上限**（占该次伤害的比例，0..1）。`undefined` = 不设上限。
     *
     * 「抵挡等同生命上限3%的伤害，**最多抵挡该次伤害的40%**」—— 前半句是盾的**池子大小**，
     * 后半句是**每次受击最多能吸收这一击的 40%**。池子早就有了，上限没有：
     * `mutateHp` 里是 `Math.min(sh.value, remaining)` —— 一击就能把整个池子吸干。
     *
     * ★ 只认**无歧义**的写法：`最多抵挡该次伤害的N%`（上限相对**这一次伤害**）。
     *   杀生丸「天生牙结界」的「最多不超过**已损失生命**的40%」是另一种形状（相对已损失生命），
     *   **不在这里猜** —— 它继续留在效果缺口表里。
     */
    perHitRatio?: number;
  }>;
  /** 看见了护盾写法但**判定不是护盾**（例如「吸收时，额外对目标造成其最大生命10%的固定伤害」是说伤害，不是护盾） */
  shieldSkips: Array<{ reason: "NOT_A_SHIELD"; evidence: string }> | null;
  /**
   * ★★★ 第 183 轮：**被拒的假阳性伤害**（引用式写法：储存/转化 等同于伤害N%）。
   *   全库只有 1 个技能命中（晴思日和坊「澄空彩虹」）—— 而它此前让这个被动"看起来有可执行效果"从而被装上。
   * ★★★ 第 188 轮新增第二种理由码：**PROBABILITY_NOT_DAMAGE**（「造成…时，有N%[tips_2]附加…」里的 N 是概率）。
   *   由这一轮的逐句证据照出来的 —— 292/292_02「霜天之织」的 damage=[25]，而它的证据子句是
   *   「有25%[基础概率]附加[冰冻]1回合」：dmgGeneric 的尾巴允许 `[tips_\\d+]`，于是概率被当成了伤害。
   */
  damageSkips?: Array<{ reason: "DAMAGE_REFERENCE_NOT_DEALT" | "PROBABILITY_NOT_DAMAGE"; ratio: number; evidence: string }> | null;
  /**
   * ★★★ 第 183 轮：**基数不一致的记账** —— 子句写「生命上限N%」，产物却一律记 base=atk（13 个技能）。
   *   本轮只记账不改行为（改它会动默认档指纹，需要一次裁定）。
   */
  damageBaseMismatch?: Array<{ ratio: number; stated: "maxHp"; evidence: string }> | null;
  /**
   * ★★★ 第 184 轮：**治疗量的基数不一致** —— 治疗产物**一律**记 base=maxHp（第 930 行的提取就是这么写的），
   *   而子句可能写的是「治疗**攻击**N%的生命」（10 条）或「治疗**等同该次伤害**N%的生命」（3 条，动态量）。
   *   与 damageBaseMismatch 同一处置：**只记账、不改行为**（改它会动典型对局里 聆海金鱼姬 / 日和坊 的默认档指纹）。
   */
  healBaseMismatch?: Array<{ ratio: number; stated: "atk" | "dynamic"; evidence: string }> | null;
  /**
   * ★★★ 第 253 轮：**同一比例出现在两种伤害语义下**（全库 1 条：251_03「死亡宣告」）。
   *
   * 「造成攻击100%伤害」+「未被移除时，在目标回合开始前造成攻击100%[tips_5]」—— 第二次是**延迟 + 有条件**的那一次，
   * 而引擎没有"延迟引爆"这条时间线。合并规则：**保留先出现的那一条**，这一条记下被丢掉的那一半。
   * ★ 与 damageBaseMismatch / healBaseMismatch 同一处置：**只记账、不改行为**（行为上等价于"少算那一次延迟伤害"，
   *   比"两次都打"更接近原文；账记在这里，谁都能复核）。
   */
  damageTypeCollisions?: Array<{ ratio: number; kept: string; dropped: string; clause: string }> | null;
  /**
   * ★★★ 第 255 轮：**失血**（「然后失去N%最大生命值」）—— 官方[21]「失去」不是伤害。
   *
   * 由来（探针 tools/_probe-m254d.ts）：内核早就有 `loseHp`（不暴击、**不被护盾吸收**、不触发受到伤害相关效果，
   * 推 HP_LOSS 痕迹 + EV.HP_LOSS 事件，g35 记 WIRED），但**编译器从不产出失血槽** ——
   * 百羽凤凰火三条技能里的「然后失去N%最大生命值」今天什么都不做（607_01 / 607_03 此前还记着 HIGH，
   * 第 254 轮先补了缺口动词「失血」把账记上）。
   *
   * 判据（窄口径）：句子写「失去N%**最大**生命」且技能是**主动**（cost ≥ 0 ⇒ 执行点在 compile/character.ts 的施放路径）。
   *   ★ 被动（cost < 0）不写这个字段：失血要挂在触发点上执行，而被动运行时今天没有"失去生命"这个动作 ——
   *     那一条继续由缺口动词「失血」记账（fail-closed：读不出执行点就不假装做了）。
   *   ★ 「失去**当前**生命N%」不收（基数是当前生命，与最大生命不是一回事）。
   */
  selfHpLoss?: {
    /** 失去**最大生命**的百分比 */
    ratio: number;
    base: "maxHp";
    /** 判据原句（可复核） */
    clause: string;
  };
  /**
   * ★★★ 第 93 轮：**吸血**（造成伤害后按比例回流自身生命）。
   *
   * 由来：全库 9 个技能写着「附带 N% 吸血」，引擎此前一行回流生命的代码都没有；
   * 三尾狐「诱惑」（典型对局里那条被动）就是因为"效果做不了"被拦在被动运行时之外。
   *
   * ★ 判据故意收得很窄：**百分号必须紧贴「吸血」**（`N%吸血`）。这一条同时排掉两类假命中：
   *   · 吸血姬「鲜血之拥」——「不超过**吸血姬**攻击400%」里的「吸血」是**式神名的一部分**；
   *   · 铃彦姬「五山火祭」——「施放时无法触发治疗、X和**吸血**效果」是**抑制声明**，不是本技能在吸血。
   *   两类都被记进 `lifestealSkips`（有理由的跳过），而不是悄悄消失。
   *
   * ★ 「有50%概率附带20%吸血」里的 50% **不进这里** —— 那是触发概率，由既有的概率机制
   *   （被动侧的执行概率）负责；这里只取紧贴吸血的那个比例。否则同一句话会被掷两次骰子。
   */
  lifesteal: { ratio: number; evidence: string } | null;
  /**
   * ★★★ 第 95 轮：**反击**（受到伤害时打回去）。
   *
   * 由来：`Battle.runPseudoTurn`（伪回合受控入口）从第 23 轮就在，**没有任何生产者调用它** ——
   * capability 表里的 COUNTER 一直是 PARTIAL「入口在、无生产者」，
   * 未建模动词表里「反击」有 15 处命中，御魂「狰」也写着「受到伤害时，有35%概率反击」。
   *
   * ★ 判据（正反两面都实测过）：
   *   · **收**：`进行反击 / 有N%概率反击敌方 / 则反击敌方 / 反击伤害来源 / 反击（…`；
   *   · **不收（SUPPRESSION）**：「**若非进行反击**」——酒吞童子与以津真天的原文里都有这句，
   *     它的意思是「反击的时候不触发这个效果」（正是"反击不连锁"这条规则的文本证据），不是本技能在反击；
   *   · **不收（NOT_A_COUNTER）**：「受反击敌方30%攻击」「每次触发[buff]的**反击后**」
   *     「并对**反击目标**附加」——这三处 反击 是**定语**（别人的反击 / 反击的目标），不是动作。
   *
   * ★ 概率只收**紧邻**反击的那种写法（`有N%概率…反击`）。主动技能里的反击
   *   （「施放后…反击」）**没有**接线：它的触发点在本技能自己的结算里，不在"受到伤害"这一刻。
   */
  /** ★ 可选（不是 `| null`）：只有非默认值才写进产物 —— 理由见 spec 末尾的组装处与 §79.6。
   *  这一点同样是 vue-tsc 逼出来的（typecheck 会报「undefined 不可赋给 null」）。 */
  counter?: { chance: number | null; evidence: string };
  /** 看见了「反击」但**判定不是本技能在反击**（有理由的跳过，见 counter 注释） */
  counterSkips?: Array<{ reason: "SUPPRESSION" | "NOT_A_COUNTER"; evidence: string }>;
  /** 看见了「吸血」二字但**判定不是吸血**（有理由的跳过，见 lifesteal 注释） */
  lifestealSkips: Array<{ reason: "NOT_A_LIFESTEAL" | "BRANCH_CONDITION" | "AMBIGUOUS"; evidence: string }> | null;
  timeline: Array<{ percent: number; direction: "pull" | "push" }>;
  orb: { gain: number; cost: number };
  statusRefs: string[]; tipRefs: number[];
  /**
   * ★★★ 第 180 轮：**状态引用的逐句证据**（与 statusRefs **一一对应**）——
   *   每个引用**出现在哪些子句里**。只有在同一个 ref 跨 ≥2 个子句时才写出来（否则整个键不出现）。
   *
   * 为什么需要：触发是**逐句**的（%s 的那一句），效果的施加却是**技能级**的 ——
   *   同一个 ref 在两个子句里各写一次（甚至层数不同），触发第一句时会把第二句的那份**也算上**。
   *   探针（tools/_probe-attrib180.ts）实测：**112 个技能**有这个形状，其中言灵「和音」最典型 ——
   *   「敌方每次获得大于3点鬼火时，言灵增加**2层**[buff_3991_1]。非召唤物的敌方目标回合结束时，言灵增加**1层**墨灵」，
   *   而 IR 的 statusStacks 只有一条（技能级，2 层）⇒ 敌方回合结束时**多加了一层**。
   * ★ 本轮只**加产物**、不动行为（运行时按它收窄是下一轮）；没有这个键的技能行为逐位不变。
   */
  statusRefClauses?: string[];
  /** ★★★ 第 181 轮：**只当条件**的槽位下标（「若拥有4层[buff_x]」）—— 触发时**不施加**它们 */
  statusRefConditionOnly?: number[];
  /**
   * ★★★ 第 188 轮：**逐句效果归因的第二批** —— damage / heal / shield / timeline 四个字段的逐句证据。
   *
   * 由来：第 180/181 轮把**状态引用**归到了句（statusRefClauses），但四个效果数组仍然是**技能级**的 ——
   *   而被动运行时是"**触发一句、执行整门技能**"（compile/passive-runtime.ts 的 sk.execute）。
   *   于是「造成伤害时，获得1层[buff]」（闻人翊悬「火浣重重」）会把同一门技能里另外两句的
   *   「每获得5层…增加20%行动条」「满层时…增加100%行动条」一起执行 ⇒ 每次造成伤害白送 120% 行动条。
   *   实测（tools/_probe-attrib188d.ts）：**27 条**装上的被动触发句里，触发句并不拥有本技能全部效果槽位。
   *
   * 形状：**按族**给（damage / heal / shield / timeline 各自一个数组，与 IR 里同名数组**一一对应**），
   *   每个元素 = 那个槽位在原文里所在的**小句**（可复核 —— 判错时要能一眼看出照哪句话判的）。
   *   ★ 只写**非空且每个槽位都定位到子句**的族（定位不到 ⇒ 整族不写 ⇒ 执行侧照旧全放，fail-closed）。
   *   ★ 只对**被动技能（cost<0）**写 —— 收窄只发生在"逐句执行"那条路上（见 effectSlotsForClause 的注）；
   *     主动技能整门施放，写了也没人读，只会把 compile-census 灌成噪声。
   * 尺子：tests/g110-effect-attribution.ts（纯函数双向 + 装机面实测）。
   */
  effectClauses?: {
    damage?: string[]; heal?: string[]; shield?: string[]; timeline?: string[];
  };
  /**
   * ★★★ 第 186 轮：**名字形态的状态引用**（正文写「雄姿英发」而不是 [buff_2173_1]）。
   *   仅当四条都满足才收：① 这一句有「给」的动词（获得 / 附加 / 施加 / 增加 / 提升 / 赋予）；
   *   ② 名字**独立出现**（左边是量词或边界，例如「增加1层**雄姿英发**」—— 「御**神火**界」不算）；
   *   ③ 名字 → id **唯一**；④ 那个 id **还不在** statusRefs 里。
   *   ★ 本轮只**记账**：接进 statusRefs 会改变行为（其中 聆海金鱼姬 346 在典型阵容里 ⇒ 会动默认档指纹），
   *     与「伤害 / 治疗基数」那一条同属待裁定项。尺子：tests/g108-name-form.ts。
   */
  statusRefNameForm?: Array<{ ref: string; name: string; clause: string }>;
  /**
   * ★★★ 第 194 轮：**「随机增益 / 随机减益」的池子**（见 kernel/random-pool.ts）。
   *
   * 由来：匣中少女「溢彩」287_02「受到攻击时，有100%[基础概率]为攻击者附加**1个[随机减益]效果**，持续1回合」
   *   此前 fail-closed（没有 `[buff_x]` 引用 ⇒ 认不出该附加什么）。而 `data/kb/tips.json` 第 200/201 条
   *   **把池子写全了**：五条属性改动、数值、单位都有。所以这不是猜，是读数据。
   * ★ 只有引用形态是 `[tips_N]`（原文写 `[tips_201]`），池子的**性质**由 tips 的**名字**决定、
   *   **条目**由 tips 的 **desc** 解析 —— 换一份 KB 只要名字/写法还在，判据不用改。
   * ★ 认不出来 ⇒ 这个键**根本不出现**（fail-closed，与今天逐位相同）。
   */
  randomStatuses?: Array<{
    kind: "BUFF" | "DEBUFF";
    /** KB 里的名字（「随机增益」/「随机减益」） */
    name: string;
    /** 「N个」—— 一次施加几层（缺省 1） */
    count: number;
    duration: number;
    /** 承受者：「为攻击者附加」⇒ DAMAGE_SOURCE；否则走技能级 targeting */
    bearer: "DAMAGE_SOURCE" | "EFFECT_TARGET";
    /** 「有N%[基础概率]…」里的 N（没写 = null ⇒ 必定） */
    probability: number | null;
    entries: Array<{ prop: string; mode: "ADD_RATE" | "FIXED"; value: number; label: string }>;
    /** 判据所依据的原句（**解析后**的句子 —— 与触发侧 u.clause 同一种形态，可复核） */
    clause: string;
    /** KB 里池子那一条的 desc（条目数值的出处） */
    evidence: string;
  }>;
  /**
   * ★★★ 第 194 轮：**认出来是池子、但这一轮不落地的写法**（逐条写原因，绝不静默丢）。
   *   NO_APPLY_VERB = 句子里没有「给」的动词；DURATION_NOT_UNIQUE = 「持续N回合」不是恰好一处；
   *   PROBABILITY_NOT_UNIQUE = 引用所在那一小句里概率不止一处（分不清管谁 ⇒ 不猜）。
   */
  randomStatusSkips?: Array<{ ref: string; name: string; clause: string; reason: "NO_APPLY_VERB" | "DURATION_NOT_UNIQUE" | "PROBABILITY_NOT_UNIQUE" }>;
  /**
   * ★★★ 第 195 轮：**占位符形态的控制效果**（`[tips_101]`=冰冻 / `[tips_108]`=眩晕 / `[tips_107]`=变形…）。
   *
   * 由来：控制效果在原文里几乎都写成 tips 占位符 —— 全库 **73 处小句、56 个技能**，而引擎此前
   *   **一处都不施加**，那 56 个技能在报表上却大多是「完整编译」（unparsed 为空）。这是「少算」里最坏的一类：
   *   不是没做，而是**看不出来没做**。
   *
   * 判据（逐小句，见 controlSkips 的理由码）：
   *   ① 占位符的名字能在 CONTROL_EFFECTS 里找到（controlDefByTipName，唯一映射）；
   *   ② 引用**前面**有施加标记（使其/将其/将…/对…/为…/施加/附加/陷入/让…/并），且窗口里没有否定或引用标记；
   *   ③ 引用**后面**不是引用形态（的/时/状态/效果/目标/回合数/会）；
   *   ④ 不是分支（改为/转化为/转为/则结束）、不是随机取一、不是场地 perTurn 已经在做的那一句。
   *   ★ 概率与时长**就地读**（同一小句里，概率取紧贴引用的那一个）—— 不跨句猜。
   */
  controlRefs?: Array<{
    /** 控制状态 id（CONTROL_EFFECTS，例如 "freeze"） */
    ref: string;
    /** KB 里的占位符 id（"101"）与规范名（"冰冻"） */
    tipId: string;
    name: string;
    /** 「N回合」/「N个回合」；没写 = null（运行时按 1 回合） */
    duration: number | null;
    /** 「有N%[基础概率]…」里紧贴引用的那个 N；没写 = null（必定） */
    probability: number | null;
    /** 承受者：「使攻击来源…」⇒ DAMAGE_SOURCE；否则走技能级 targeting */
    bearer: "DAMAGE_SOURCE" | "EFFECT_TARGET";
    /** 判据所依据的小句（可复核） */
    clause: string;
    /**
     * ★★★ 第 242 轮：**效果位的条件变体**（§175 设计草案的形状 ②/③）。
     *   原文（雪女「暴风雪」201_03）：「…并有8%[tips_2]将其[tips_101]1回合。…再次攻击被[tips_101]的目标时，有30%概率转化为[tips_112]。」
     *   ⇒ 基础效果位仍是 `freeze`（8% / 1 回合），但当**目标已带该状态**时按 `probability` 掷一次，
     *     命中就把这一位**改写成**变体状态（deepFreeze）。★「改写」不是「新增」—— 否则目标会同时挂着两个状态（多算）。
     *   判据 fail-closed：条件与变体**各自都要**解析出一个控制状态（占位符或规范名），任一端认不出 ⇒ 这个键一个字都不写
     *     （保持今天的「不施加」+ controlSkips 记账）。
     */
    variant?: {
      when: { kind: "TARGET_HAS"; statusId: string };
      /** 「有N%概率转化为…」里的 N；原文没写 = null（必定转化） */
      probability: number | null;
      /** 变体状态（控制 id + 规范名） */
      ref: string;
      name: string;
      /** 判据原句（可复核） */
      evidence: string;
    };
  }>;
  /** 认出来是控制类占位符、但这一轮**不施加**的写法（逐条写原因，绝不静默丢） */
  controlSkips?: Array<{
    tipId: string; name: string; clause: string;
    reason: "NO_APPLY_VERB" | "NEGATED_OR_REFERENCE" | "REFERENCE_FORM" | "CONDITIONAL_BRANCH" | "RANDOM_ONE_OF" | "FIELD_PER_TURN" | "AMBIGUOUS_PROBABILITY" | "AMBIGUOUS_DURATION";
  }>;
  /**
   * ★★★ 第 239 轮：**计数器 → 满层免消耗施放**（§169 百目鬼「鬼眸」293_02）。
   *
   * 原文：「当敌方造成伤害暴击时，百目鬼有40%概率睁开一只鬼眸；当睁开5只鬼眸时，将免消耗施放『[skill_293_03]』，之后闭上所有鬼眸。」
   * 判据（两条都命中才写出来，否则这个键不出现）：
   *   ① 「有N%概率睁开一只X」→ probability / name；
   *   ② 「当睁开M只X时，将(免消耗)施放『[skill_a_b]』」→ threshold / skillRef / free，且 ① ② 的 X **必须同名**；
   *   「闭上所有|清空|移除所有」⇒ reset=true。
   * ★ 计数器本体是**合成状态** `GHOST_EYE`（kernel/status.ts），不是新概念：这样才能落进已有的 STACK_AT_LEAST。
   */
  counterCast?: {
    name: string;
    perEvent: number;
    threshold: number;
    probability: number | null;
    skillRef: string;
    free: boolean;
    reset: boolean;
    clause: string;
  };
  /**
   * ★★★ 第 245 轮：**「醉倒」这一类自伤状态标记**（狸猫 208_02；判据见下面提取处与报告 §185）。
   *
   * 为什么必须做：这一条此前 `sentences` 两句都写着 **PARSED**、`unparsed` 为空、`confidence: HIGH`，
   *   而「醉倒」这个状态根本不存在、「直至下回合醒来并治疗生命上限6%」的治疗也**一处都没读出来**（`heal: []`）——
   *   也就是**编译率冒充真实性**（目标 ① 明确禁止）。
   * ★ 状态本体是**合成状态** `DRUNK`（kernel/status.ts），时长由运行时自己管（醒来即移除）。
   */
  /**
   * ★★★ 第 246 轮：**「失去 X 时结束 Y」**（蝉冰雪女「永冬」362_03）—— §175 里「条件表达不了」的最后一类之一。
   *
   * 原文：「自身获得[buff_3622_1]，若失去[buff_3622_1]则结束[tips_3621]」。
   *   引擎里**「失去状态」本来就有派发点**（`EV.STATUS_EXPIRE` / `EV.STATUS_REMOVE` 都进事件总线），
   *   所以这一条不需要新概念：一个挂在拥有者身上的「失去监视」处理器就够了。
   * 判据 fail-closed：`watch` 必须是 `[buff_x]` 引用、`remove` 必须能解析成 CONTROL_EFFECTS 里的控制状态；
   *   任一端认不出 ⇒ 这个键一个字都不写（保持今天的「不施加 + CONDITIONAL_BRANCH 记账」）。
   */
  /**
   * ★★★ 第 249 轮：**治疗溢出转护盾**（蝴蝶精「祈愿之舞」241_03 —— 第 248 轮静默缺口筛查列出的候选）。
   *
   * 原文：「为友方目标驱散3个减益状态或[tips_3]，并治疗生命上限30%的生命，**若治疗溢出，则获得1个能够吸收蝴蝶精生命上限5%的护盾**，持续2回合；
   *        之后为其施加[buff_2414_1]，持续3回合。」
   * 这一句此前 `confidence: HIGH`、`unparsed: []`、`unmodeledMechanics: []`，而 `shield` 里**一条都没有** —— 也就是"报表说完整编译、实际没做"。
   * 判据 fail-closed 三条：① 句子必须写「治疗溢出」；② 必须读出「能够吸收…生命上限N%的护盾」（基数是**施放者**的生命上限，原文点名了式神名）；③ 比例要读得出。
   * ★ 边界（如实记，别让它变成"假装做完了"）：原文还写了「持续2回合」，而**引擎的护盾至今没有时长载体**
   *   （`Entity.addShield` 的 spec 里没有 duration，也没有任何按回合到期护盾的代码）—— 所以 `duration` 只作为**原文事实**记录下来，
   *   运行时**不执行**这一半。要补这一半得先给护盾加生命周期（会动 stateHash 与 Delta），那是另一件事。
   */
  /**
   * ★★★ 第 251 轮：**条件伤害分支**（「若开启X，则此技能改为攻击…」）—— **摘出来、不执行**。
   *
   * 由来：第 250 轮实测 331_01「恨返」一次施放打出 4 条伤害事件（原文 1 或 2 条）—— 基础槽与分支槽被并列收进 `damage[]`，
   *   `hits` 又取了分支的「2次」。这一轮把分支槽摘到这里（`movedSlot` 是原样记下的那一条），并让基础形态的 `hits` 收回 1。
   * ★ 为什么只摘不执行：条件（`gateName`，例如「封印结界」）在引擎里**没有载体** —— 摘掉是修**多算**，
   *   把分支真做出来需要先有场地/结界的判定，那是另一件事；记账户头（缺口动词「条件伤害分支」）因此照旧保留。
   */
  damageBranch?: {
    /** 判据原句（可复核） */
    clause: string;
    /** 那一支写了几次 */
    hits: number;
    /** 那一支每次的伤害比例（基数是 atk） */
    ratio: number;
    base: "atk";
    /** 条件名（原文点名，例如「封印结界」）；读不出 = null */
    gateName: string | null;
    /** 被摘出来的那一条伤害槽（原样记下，便于核对） */
    movedSlot: { type: string; ratio: number };
  };
  /**
   * ★★★ 第 252 轮：**分段伤害形状**（「先 N 次单体 X%，最后 1 次全体 Y%」这一族）—— 第 251 轮 §191.4 留下的那件事。
   *
   * 由来（探针 tools/_probe-seg252.ts）：全库 818 条技能里，`hits > 1` **且** `targeting` 同时含「全体」与「单目标」的有 **12 条**。
   *   运行时的伤害展开是 `damage 槽数 × hits × 受击人数`（compile/character.ts），于是"次数"被同时套到了单体段和全体段上：
   *   · 烟烟罗「烟之鬼」281_03 实测一次施放 **50 条**伤害事件（原文 5 次单体 + 1 次全体 = 10 条）；
   *   · 姑获鸟「天翔鹤斩」262_03 **30 条**（原文 3×全体 + 1×单体 = 16 条）；
   *   · 御怨般若「予愿必还」331_03 **15 条**（原文 3×单体 + 1×全体 = 8 条）；
   *   · 影鳄「幕影盖地」375_03 **20 条**（原文 2×全体 + 1×单体 = 11 条）。
   *   四条此前都是 `confidence: HIGH` / `unparsed: []` —— **报表说完整编译**。
   *
   * 这个字段把"一次施放里的两段"分别记下来：每段有自己的**范围**与**次数**，运行时按段展开（不再是槽数 × hits）。
   * 判据六条，任一条不成立就**一个字都不写**（fail-closed，保持旧行为）：
   *   ① A 段「攻击敌方(全体|目标)N次…造成攻击X%」；② B 段「(最后|然后|随后|再)…(对|攻击)(指定)?敌方(全体|目标)…造成攻击Y%」；
   *   ③ B 必须**整段落在 A 之后**（607_03「百羽衔火」的 B 落在 A 内部 —— 那是"先单体后多段"的反序形状，不收）；
   *   ④ 两段范围必须**不同**（相同范围的是"附加状态 + 附带伤害"那一族，如 210_03 / 260_03，不在本模型里）；
   *   ⑤ 两个比例都要在 `damage` 槽位里真的存在、且基数都是 atk；A 段次数 ≥ 2；槽位总数 ≤ 2；
   *   ⑥ 中段不许夹**动态量 / 条件追加**（「等同于本次攻击造成总伤害18%」592_03、「追加1次」392_03/399_03/556_03）—— 读不出来的量不许猜。
   * ★ 边界如实记：以上六条挡下的那些**不是"没问题"，是"这一轮做不了"** —— 它们各自有一条具名缺口（缺口动词「分段伤害形状」/「次数读成了上限」，见本函数末尾的记账段）。
   */
  damageSegments?: Array<{
    /** 判据原句（可复核） */
    clause: string;
    /** 这一段打谁 —— 原文写的范围，不是 AI 选了谁 */
    scope: "ENEMY_ALL" | "ENEMY_ONE";
    /** 这一段几次 */
    hits: number;
    /** 每一次的伤害比例（基数 atk） */
    ratio: number;
  }>;
  overflowShield?: {
    /** 吸收**施放者**生命上限的百分比 */
    ratio: number;
    base: "selfMaxHp";
    /** 原文写的持续回合数（记录用：见上面那条边界，运行时暂不执行） */
    duration: number | null;
    clause: string;
  };
  /**
   * ★★★ 第 248 轮：**施放限制**（「X 存在时，无法施放此技能」）—— 大岳丸「无尽剑狱」333_03 / 蝉冰雪女「永冬」362_03 等。
   *
   * 由来（第 248 轮的静默缺口筛查 tools/_probe-silent248.ts）：这几条技能 `confidence: HIGH`、`unparsed: []`、`unmodeledMechanics: []`，
   *   也就是报表说"完整编译"—— 而「有这个状态时这一招根本放不出来」这件事**引擎里没有任何执行点**。
   * 判据 fail-closed：① 条件必须是 `[buff_x]`（自身）或 `[tips_y]`（敌方）形态；② 状态必须能解析（buff 在 statusRefs 里 / tips 能落到控制状态）；
   *   ③ 句子必须写「无法施放」。任一条不成立 ⇒ 这个键一个字都不写。
   * ★ 边界（如实写）：本轮只在 **AI 选招**这条路径上执行（那是正常对局里唯一会挑技能的路径）；
   *   伪回合里的追加施放不受它约束 —— 原文没写这两者的关系，不替规格做决定。
   */
  castGate?: {
    when: {
      /** SELF_HAS =「[buff_x]存在时」（自己身上）；ENEMY_HAS =「敌方存在[tips_y]目标时」 */
      kind: "SELF_HAS" | "ENEMY_HAS";
      statusRef: string;
      statusName: string;
    };
    /** 判据原句（可复核） */
    evidence: string;
  };
  endOnLose?: {
    /** 监视哪个状态被失去（KB 的 buff id，例如 "3622_1"） */
    watchRef: string;
    /** 失去它以后要结束哪个控制状态（CONTROL_EFFECTS 的 id） */
    removeRef: string;
    removeName: string;
    clause: string;
  };
  drunk?: {
    name: string;
    /** 「回合结束时…有N%概率X」里的 N */
    chance: number;
    /** 「直至下回合醒来并治疗生命上限M%的生命」里的 M（基数写死 maxHp —— 原文写的就是"生命上限"） */
    healRatio: number;
    healBase: "maxHp";
    /** 「X时若被攻击…有K%概率被吵醒」里的 K */
    wakeChance: number;
    /** 吵醒时给**攻击者**的状态与层数上限（原文：「为攻击者附上1层[buff_y]，上限C层」） */
    wakeBuffRef: string;
    wakeBuffCap: number;
    clause: string;
  };
  /**
   * ★★★ 第 176 轮：**逐句承受者归属**（「对伤害来源附加[buff_x]」）。
   *
   *   为什么是**独立字段**而不是给 statusRefs 加对象：statusRefs 是 `string[]`，消费者有十来处
   *   （character.ts 的施加循环 / triggers.ts 的状态检查 / 多个测试），改成对象是**破坏性**改动，
   *   而这条记录是**附加事实**：它只说"这个 ref 的承受者写在子句里"。
   *
   *   判据（fail-closed）：**子句里同时**点名「伤害来源 / 攻击者 / 攻击来源」**且**含 `[buff_x]` 引用。
   *   没有这条记录的状态引用一律按技能级 targeting 走 —— 与今天逐位相同。
   *   `clause` 是判定所依据的原句（可复核 —— 判错时要能一眼看出是照哪句话判的）。
   */
  sourceBearerRefs?: Array<{ ref: string; clause: string; bearer: "DAMAGE_SOURCE" }>;
  /** 原文里出现过的所有 N%概率（**未归因**，保留作审计用；引擎不直接读它） */
  probabilities: number[]; durations: number[];
  /**
   * ★ 「有 30% 概率冰冻」里的那个 30 —— **归因到具体效果**。
   *
   * 由来：`probabilities` 只是一个扁平列表，没人知道它管哪个效果；
   * 引擎于是干脆不读，结果全部控制效果都变成 100% 必中。
   * 实测：309 个带状态的技能里，266 个原文本来就没写概率（必定施加，正确），
   * 但有 43 个**写了概率却被丢掉** —— 这一批是实打实的过度施加。
   *
   * slot 语义：`status:i` 对应 statusRefs[i]；`timeline:i` 对应 timeline[i]。
   * evidence 保留原句，便于人工复核归因是否正确（绝不静默猜测）。
   */
  effectProbs: Array<{ slot: string; probability: number; evidence: string }>;
  /**
   * **看见了概率、但归属有歧义所以没敢用**的那些句子。
   * 绝不静默丢弃：宁可保持"必定施加"的旧语义并把它报出来，也不要猜错一个机制。
   */
  effectProbSkips: Array<{ reason: "MULTI_PROB_MULTI_SLOT" | "PROB_AND_EFFECT_IN_DIFFERENT_CLAUSE"; evidence: string }>;
  /**
   * ★ 「持续 N 回合」——归因到具体状态槽位。
   *
   * 由来：durations 同样是「解析出来了但没人读」的字段。运行时的持续时间只取印记
   * **自身**描述里的 durationFromText，印记没写就退化成 1 回合。
   * 实测 339 个带状态的技能里，**107 个只在技能原文写了持续回合** —— 它们全被静默降级：
   * 巫蛊师「魔蛊毒爆」3 回合变 1 回合、雨女「天之泪」2 回合变 1 回合，
   * 而跳跳弟弟「毒气喷泉」（典型对局红方阵容里就有）同样是 2 → 1。
   *
   * 归因粒度是**句子**而不是小句：「造成伤害，有30%概率冰冻，持续2回合」里
   * 持续时间与状态引用天然不在同一小句。一句里多个持续时间且与槽位数对不上时不猜。
   */
  statusDurations: Array<{ slot: string; turns: number; evidence: string }>;
  /**
   * ★★★ 第 76 轮：状态引用上写明的**层数**（`附加3层[buff_x]` 里的那个 3）。
   *
   * 由来：`kernel/entity.ts` 的 `addStatus(def, src, stacks = 1, ...)` 支持层数，
   * 但 `compile/character.ts` 调用时**写死了 1**，而编译器**完全没有解析层数** ——
   * 于是「附加3层」被施加成 1 层。实测全库 `…N 层` 出现 153 次，其中 **N>1 的 50 次**
   * （主动 33 / 被动 17），例如鸩「鸩羽」（**普攻**）「造成攻击80%伤害并附加2层[buff_2852_1]」。
   *
   * ★ 与 `revive` 同一个约定：没有层数信息时是 **null**（而不是空数组），
   *   这样第 67 轮加的"null 键归一化"能让 compile-census 只报真正变了的那几条。
   *
   * ★ 判据保守：只认 **`<动词>N层[buff_x]` 紧邻**的写法，且**排除阈值句**
   *   （`每获得40层[buff_x]` 是"攒到 40 层时"的条件，不是"一次加 40 层"）。
   */
  statusStacks: Array<{ slot: string; stacks: number; evidence: string }> | null;
  /**
   * ★★★ 第 78 轮：状态的**层数上限**（`上限4层` / `最多可叠加3层` 里的那个数）。
   *
   * 由来：`kernel/entity.ts` 的 `addStatus` 只做 `ex.stacks += stacks` ——
   * **全库没有一处读层数上限**（`maxStacks` 只出现在御魂系统里，与此无关），
   * 于是「上限4层」的状态会被无限叠上去，而按层缩放的效果（「每层提升5%攻击」）跟着失真。
   *
   * ★ 上限**只写在技能原文里**：实测 338 条 buff 定义里写明层数上限的有 **0 条**，
   *   而技能文案里写了 **28 处**。所以它只能落在技能 IR 上，与 statusStacks 同型。
   * ★ 归因保守：只认「该子句里**恰好一个**状态引用」的情形，多引用时**不猜**（记进 statusCapSkips）。
   * ★ 与 revive / statusStacks 同一个约定：没有就是 **null**（而不是空数组），
   *   这样 compile-census 的 null 归一化能让基线比对只报真正变了的那几条。
   */
  statusCaps: Array<{ slot: string; max: number; evidence: string }> | null;
  /** 看见了层数上限、但归属有歧义（一句里多个状态引用）→ 不猜，记在这里 */
  statusCapSkips: Array<{ reason: "MULTI_REF_ONE_CAP"; evidence: string }> | null;
  /** 看见了持续回合但归属有歧义 → 不猜，记在这里（绝不静默丢弃） */
  durationSkips: Array<{ reason: "MULTI_DURATION_MULTI_SLOT"; evidence: string }>;
  /**
   * ★ 驱散 / 解除 —— 此前**完全没有被建模**，而且是最坏的那种"没有"：
   * 句子因为匹配到 [tips_1] 之类的引用就算作 PARSED，于是"驱散3个减益状态"
   * 会被报成 confidence=HIGH、unparsed=0（蝴蝶精「祈愿之舞」、雨女「天之泪」都是这样）。
   * 官方[8]驱散 / [1]解除的差别：能否驱散看印记的 dispellable，能否解除看 removable。
   * side 由文本判定（友方/自身 → 己方，敌方 → 敌方），count 缺省 1、写明"所有/全部"则为 ALL。
   */
  /**
   * ★★★ 第 99 轮：**属性偷取**（a1-4 §16 Restore / 目标 ⑨）。
   *
   * 解析只认**能读成数字与属性名**的写法：「偷取目标40%暴击」「偷取20%攻击」「15%攻击、20%防御、15%暴击、10点速度」。
   * 读不出来的（「偷取1个增益状态」= 增益偷取、「永久偷取…直到回目结束」）**不在这里**，
   * 它们进 stealSkips 并继续由 compile/unmodeled.ts 报未建模 —— 解析不了就必须说出来。
   *
   * ★ 只有非空才写出来（第 94/95 轮的教训：无条件新增字段会让全部 802 条技能变成 compile-census 的"变化"）。
   */
  steals?: Array<{
    prop?: string; ratio?: number | null; flat?: number | null;
    options?: Array<{ prop: string; ratio: number | null; flat: number | null }>;
    random?: boolean; duration: number;
    /** 「持续N回合」从哪读来的：子句 / 整句 / 技能全文 / 哪都没写（默认 1）—— 不许把默认值当证据 */
    durationSource?: "CLAUSE" | "SENTENCE" | "SKILL" | "DEFAULT";
    probability: number | null;
    maxPerTarget?: number | null; side: "ENEMY" | "ALLY"; evidence: string;
    /**
     * ★★★ 第 104 轮：**增益偷取**（「偷取1个增益状态」）——与属性偷取完全不同的一类：
     *   属性偷取是"按比例取走一个数值、到期归还"；增益偷取是"把目标身上的一个状态搬到自己身上"。
     *   两者共用同一个 IR 位置与同一个执行点（都是"偷"），但运行时走的是两条不同的路。
     */
    buffSteal?: { count: number; what: BuffWhat };
    /**
     * ★★★ 第 105 轮：**触发时机**。省略 = 施放技能时（ON_CAST，与属性偷取原本的语义一致）；
     *   "ON_DAMAGE" = 「造成伤害时…偷取」（首无「冥火」）—— 由**被动运行时**在 AFTER_DAMAGE 上执行，
     *   因为它读的是"刚刚那一下打了谁"（与吸血类被动同型，见 compile/passive-runtime.ts）。
     */
    trigger?: "ON_DAMAGE" | "PRE_CAST";
    /** trigger=PRE_CAST：施放**哪一个**技能之前（原文「施放『X』前」里的 X） */
    onSkill?: string;
    /** ★ 总量上限（相对**自身初始攻击**的比例）：「偷取总值不超过自身初始攻击60%」 */
    capTotalRatio?: number;
    /** ★ 受害者范围：目前只实现「敌方全体」；scopeSource=DEFAULT 表示原文写的是「场上全体」 */
    victimScope?: "ENEMY_ALL";
    scopeSource?: "DEFAULT" | "CLAUSE";
    /** 「同时间内只能对一个目标生效」⇒ 偷新目标时把旧目标的那笔还回去 */
    oneTargetOnly?: boolean;
  }>;
  /** 读不出来/这一轮不执行的偷取写法，逐条记下原因（**不静默丢**） */
  stealSkips?: Array<{ reason: string; evidence: string }>;
  /**
   * ★★★ 第 101 轮：**自身形态类放置单位**（a1-4 §34 / 目标 ⑨）—— 第 98 轮声明"缺的那一步"的第一块。
   *
   * 数据出处：技能原文里的 `[tips_N]姿态`（第 98 轮已证明 tips.json 就是放置单位的定义处）。
   * 只认**能从原文读出放置方与触发时机**的写法：
   *   · `化身[tips_3831]姿态` / `进入[tips_6071]姿态` ⇒ 放**己方**（本体离场、形态上场）；
   *   · 同句有「受到致命伤害」⇒ 触发时机 = ON_LETHAL；否则 = ON_CAST（「施放化身…」）。
   * ★ 读不出来的（敌方位、镇压式、击败触发的召唤）**不在这里** —— 它们是下一轮的入口，
   *   而不是"顺便猜一个"（雷冢要放敌方、龙胆蓝璃要放在目标的行动条位置，两者都需要各自的证据）。
   *
   * `spec` 在**编译期**就解析好并嵌进 IR：这样运行时不需要 tips 表，
   * 生产 / 普查 / 测试三条路读到的规格按构造一致（第 87 轮"两条装配路径必须装同一套运行时"的教训）。
   */
  /**
   * ★★★ 第 103 轮：类型**直接用 kernel 的 ~B~FormSpec~B~**，不在这里再抄一份取值联合。
   *   第一版把 trigger / placement / returnOn 的取值在这里又写了一遍，词汇普查当场抓到两组重复
   *   （~B~ON_CAST,ON_KILL,ON_LETHAL~B~ 与 ~B~NONE,SUMMON_DEATH,TIMELINE_END~B~）——
   *   两份声明意味着"改一处忘一处"的可能，而且 vue-tsc 也检查不到它们是否同步。
   *   现在只有一份（kernel/summon.ts），编译器只管往里塞值。
   */
  forms?: FormSpec[];
  /**
   * ★★★ 第 102 轮：**这个技能属于哪个形态**（「[tips_N]姿态下可施放」）。
   *   它是"放置单位的技能表"这条空缺的第一块数据：形态单位上场时，
   *   本体身上所有声明了同一个 tipsId 的技能会被**挂到形态身上**（见 kernel/summon.ts 的 enterForm）。
   *   实测全库只有 1 处（神堕八岐大蛇「审判仪式」→ tips_3831 蛇神）。
   */
  formSkillOf?: string;
  /** 认出来但**这一轮不执行**的形态（逐条写原因，不许静默丢） */
  formSkips?: Array<{ reason: string; evidence: string }>;
  /**
   * ★★★ 第 199 轮：**看见了「驱散/解除/移除」但判定不是动作**的子句（逐条写理由，绝不静默丢）。
   *   全库 4 条，全是同一种毛病：**规则句/条件句**被当成了本技能在扒状态。
   */
  purgeSkips?: Array<{ clause: string; reason: 'RULE_OR_CONDITION' }>;
  purge: Array<{
    kind: "DISPEL" | "REMOVE"; side: "ALLY" | "ENEMY"; what: BuffWhat; count: number;
    /**
     * ★★★ 第 196 轮：**按名驱散** —— 原文点名了要驱散/解除的是哪几种状态（兔丸「守护之心」点了五种控制）。
     *   取值是状态 id（普通 buff 是 `2081_1` 这种，控制是 CONTROL_EFFECTS 的 `freeze` / `stun` …）。
     *   有它 ⇒ 运行时只碰这几种（`count` 记 99 = 全部）；没有它 = 按 what 的类别驱（与今天逐位相同）。
     */
    statusIds?: string[];
    /**
     * ★★★ 第 196 轮：**作用范围**。省略 = ALL（对整侧逐个驱散，与今天逐位相同）；
     *   `RANDOM_ONE` = 原文写「对**随机**…的友方/敌方目标…」⇒ 只对随机一个生效。
     *   ★ 只在**按名驱散**（有 statusIds）时才判这一条：那一族的原文才是「对随机 X 目标驱散其…」，
     *     其余 47 条一个字不动（范围问题在那族里另记，见报告）。
     */
    scope?: "ALL" | "RANDOM_ONE";
    evidence: string;
  }>;
  targeting: string[];
  levelScale: Array<{ level: number; effect: string }>;
  sentences: Array<{ text: string; kind: "PARSED" | "MECHANIC_UNPARSED" | "FLAVOR" }>;
  unparsed: string[];
  /**
   * ★ 未解析句子的**分类**：哪一句、缺的是哪个机制、那个机制在引擎里缺什么。
   * unparsed 只给出原句，Fidelity 面板要能说"这个技能依赖召唤，而引擎不会生成召唤物"，
   * 靠的就是这里。来源见 compile/unmodeled.ts（每条都带验证依据）。
   */
  /**
   * ★★★ 第 112 轮：多了 `severity`（WARN/INFO）—— 它决定 Fidelity 面板上这条缺口的分量。
   *   值来自**记录本身**（动词表声明、或编译器合成的记录自己声明），报告层不再维护名字名单。
   */
  unmodeledMechanics: Array<{ verb: string; missing: string; evidence: string; clause: string; severity?: "WARN" | "INFO" }>;
  /**
   * ★★★ 第 115 轮：**场地（幻境 / 结界）**。只收**施放式创建**（「创造/开启/展开…存在N回合的幻境|结界」），
   *   回合开始/概率触发的那几种（荒「星辰之境」、帝释天「无垢莲华」）记成 FIELD_TRIGGER_NOT_MODELED。
   */
  field?: { kind: "ILLUSION" | "BARRIER"; name: string; duration: number; durationSource: "CLAUSE" | "DEFAULT"; probability: number | null; auras: any[]; /** ★ 第 124/125 轮：场地的每回合效果（两种触发 × 两种效果，类型只声明在 kernel/field.ts） */ perTurn?: FieldPerTurn; evidence: string };
  /**
   * ★★ 主动复活（第 67 轮）。`null` = 这个技能不会主动复活任何人。
   *   `scope`：ONE = 复活一个阵亡友方，ALL = 复活全体阵亡友方。
   *   `clause`：判定所依据的原文子句（可复核 —— 判错时要能一眼看出是照哪句话判的）。
   *
   *   ★ 只收**动作**子句：`阵亡时…立即复活`（触发）、`棺材…复活`（召唤物）、
   *     `被复活时…`（关于复活的被动）都不是主动复活 —— 那些留在未建模表里。
   *   实测全库 818 个技能里只有 3 个是主动复活（桃花妖「桃华灼灼」/童男「魂之祭献」/
   *   灼华桃花妖「醒时花」），所以这一层的爆炸半径是 3 条。 */
  revive: { scope: "ONE" | "ALL"; clause: string } | null;
  /**
   * ★★★ 第 129 轮：**触发式自复活**（「阵亡时，若拥有N层[buff_X]，则立即复活并治疗生命上限M%的生命」）。
   *
   * 与 `revive` 的分工：那个是**动作**（我施放这个技能去救别人），这个是**反应**
   * （我自己倒下时把自己拉回来）。第 67 轮接线了前者，后者一直留在未建模表里
   * （compile/unmodeled.ts 的「复活」条），因为"阵亡时"这个时机需要运行时条件求值。
   * 第 87 轮把「若拥有N层」建模成 STACK_AT_LEAST 之后，条件这一半已经有了；
   * 第 129 轮把总线改成"死亡级联事件照常投递给刚阵亡的单位"，时机这一半也通了。
   *
   * ★ **判据是 fail-closed 的**（与 steal / aura 同一套做法）：只有同时满足下面四条才收，
   *   否则整句留在未建模表里 ——「解析不出来 ≠ 没有条件」，宁可少算也不能多算：
   *     ① 触发词（阵亡/死亡/被击败）与「复活」在**同一句**里；
   *     ② 复活后的生命写得出来（「生命上限N%的生命」）；
   *     ③ 句子里写了条件（若/如果/当）时，那个条件**必须**被解析成层数门槛；
   *     ④ 不依赖未建模容器（棺材 / 晴天娃娃 / 小鬼）。
   *   实测全库 4 条候选（九命猫「九命」/ 骨女「怨生」/ 跳跳妹妹「不玩了啦」/ 青蛙瓷器「转运」），
   *   ①②③④ 全过的只有**前两条** —— 跳跳妹妹缺②③（且要看"番茄在场"），青蛙瓷器缺②③（骰子点数）。
   *
   * `castSkill`：同一句里还有「并对随机敌方目标施放『X』」这种**追加施放**，它**没有**行为代码，
   *   由编译器合成一条 unmodeled 记录（不是静默吞掉 —— 第 110/111 轮同型处置）。
   */
  /**
   * ★★★ 第 130 轮：**无法被治疗/恢复**（KB：百羽凤凰火「未熄羽」——「无法被治疗或[恢复]生命」）。
   *   落点是能力位 `EntityCapabilities.receivesHeal`（跟着单位走、进 state），不是一条状态：
   *   原文没有时限、也没有可驱散性 ⇒ 做成状态反而是编的。
   *   ★ 实测全库只有这一条这么写（tools/_probe-healblock130.ts）；读不出就**不写这个字段**。
   */
  /**
   * ★★★ 第 136 轮：**额外推进鬼火行动条**（「[先机]：使鬼火行动条额外推进1格」/
   *   「自身回合结束后额外推进3格鬼火行动条并使全体友方获得2层[buff]」）。
   *
   * 数据早就在原文里，而引擎**没有任何字段接它**：追月神「明月潮生」因此连"可执行面"都没有
   *   （先机族接线之后仍然装不上，见第 135 轮报告 §119.6），流光追月神「绮罗舞」则是**少做了半句**
   *   （buff 发了、鬼火条没推）。两者都不是"没写过"，是"没人接"。
   * 判据：`推进N格鬼火行动条` 与 `鬼火行动条推进N格` 两种语序；N 取 1..10（越界不收，不猜）。
   */
  orbGaugeAdvance?: number;
  /**
   * ★★★ 第 140 轮：**叠层场地**（KB 术语「花海」）。判据、歧义与出处见 kernel/layer-field.ts。
   * ★ 六条判据缺一不可（fail-closed）：每层伤害比例 / 上限表 / 生命比例阈值表 / 回合开始减层 /
   *   每降一档得层 / 先机层数。缺一条就**整条不收**，由动词表继续按子句记 WARN。
   */
  layerField?: LayerFieldSpec;
  /** ★ 第 140 轮：主动技能里的「获得N层花海（若生命比例低于M%，再获得K层）」 */
  grantLayers?: { base: number; extraIfBelow?: { ratio: number; extra: number }; evidence: string };
  noHeal?: { clause: string } | null;
  /**
   * ★★★ 第 131 轮：**替友方拦截致命伤**（「自身在场时，处于[buff_X]的友方目标受到致命伤害将剩余1点生命（…次数上限）」）。
   *
   * 三类拦截点里的第三类（前两类：状态自带的 preventsLethal 与 ON_LETHAL 形态）。
   *   它挂在**别人**身上：拦的是"带着那个状态的友方"，所以它是**技能级常驻条款**，
   *   由死亡路径在 `EV.DEATH_PREVENTION` 那一刻扫描同队成员（kernel/ally-guard.ts）。
   *   ★ 这也是 `EV.DEATH_PREVENTION` 这个事件码**第一次有生产者**（第 91 轮登记、一直没人派发订阅）。
   *
   * ★ 次数上限必须真的执行（第 78 轮层数封顶同一条判据）：读不出数字就**整条不收**。
   */
  allyGuard?: {
  /**
   * ★★★ 第 187 轮：**消耗型换命**（石长姬「磐长纪」：「受到致命伤害时，消耗1朵[buff_6082_1]，获得其中的生命」）。
   *   fail-closed 判据：同一份文本里既写着「凝炼成N朵[buff_x]」、又写着「受到致命伤害时，消耗M朵[buff_x]，获得其中的生命」，
   *   而且两处引用的是**同一个** buff id。缺任一条 ⇒ 不写这个字段（照旧按「致命伤害拦截」记未建模）。
   *   `total` = 初始生命被凝炼成几朵（每一朵 = 初始生命 / total）；`perStack` = 一次消耗几朵。
   */
  lethalConsume?: { statusRef: string; perStack: number; total: number; clause: string };
    /** 拦的是**带着这个状态**的友方（[buff_X]） */
    statusRef: string;
    /** 原文是否写了「自身在场时」（写了 ⇒ 拥有者离场/阵亡时这条不生效） */
    requireSelfOnField: boolean;
    /** 「剩余1点生命」——目前只有这一档（写死成联合类型，将来有第二档再加） */
    keep: "ONE";
    /** 「目标下回合开始前至多触发1次」⇒ 1；没写 = null（不封顶） */
    perTurnMax: number | null;
    /** 「被再次施加毁灭前至多累计触发3次」⇒ 3；没写 = null */
    totalMax: number | null;
    /** 累计次数在什么时候清零（「被再次施加…前」⇒ 状态被重新施加时） */
    resetOn: "STATUS_REAPPLY" | null;
    /** 判定所依据的原文子句（可复核） */
    clause: string;
  } | null;
  /**
   * ★★★ 第 135 轮：**触发式追加施放**（「阵亡时…并对随机敌方目标施放『[skill_207_03]』」/
   *   「[先机]：施放『[skill_280_03]』」）。
   *
   * 引擎里此前**没有"替某个单位释放另一个技能"的入口** —— 这一轮接上（kernel/sub-cast.ts），
   *   用的是与反击/协战**同一条**伪回合入口（Battle.runPseudoTurn）。
   * ★ fail-closed：只收**显式技能 id**（`[skill_X_Y]`）的写法 —— 名字引用（「施放『五光斩』」）
   *   要按同式神内的技能表查，容易在不同形态下指到别的技能，留给下一轮。
   * ★ 只收两类触发：**阵亡时**（九命猫「九命」）与**先机**（辉夜姬「火鼠裘」，tips_7 = 战斗开始时）。
   *   其余写法（百目鬼的「睁开5只鬼眸时」、御馔津的「敌方行动后…有5%概率」、麓铭大岳丸的「自身行动回合」、
   *   梦寻山兔的「若…引爆时」）触发条件没有模型 ⇒ 不收，由动词表记「追加施放」。
   */
  subCasts?: Array<{
    /** 目标技能的 IR id（`charId_index`，如 "207_03"） */
    ref: string;
    /**
     * 打谁 —— **复用既有的 TargetMode**（第 112 轮的词汇普查盯的就是这种重复）：
     * 第一版自造了 "RANDOM_ENEMY" | "SELF" | "FIRST_ENEMY" 三个新字面量，
     * 而 `TargetMode` 里本来就有 `ENEMY_RANDOM` / `SELF` / `ENEMY_ONE` —— g38 当场报未说明的重复组。
     * 只认原文写得出来的三种：随机敌方目标 / 自身 / 敌方目标。
     */
    target: TargetMode;
    /** 判定所依据的原文子句 */
    clause: string;
  }>;
  selfRevive?: {
    /** 复活后的生命 = 生命上限 × 这个比例（原文「生命上限N%的生命」） */
    hpPercent: number;
    /** 原文「则消耗所有层数」—— 复活前把门槛状态整条消耗掉 */
    consumeStacks: boolean;
    /** 「若拥有N层[buff_X]」（含「N层以上」，中文的"以上"含本数）—— 运行时在死亡那一刻再读一次 */
    requireStacks: { statusRef: string; n: number } | null;
    /** 同一句里的追加施放（『X』的技能引用或名字）；没有则 null。**记录但未实现** */
    castSkill: string | null;
    /**
     * ★ 治疗走哪条通道 —— 由**原文的动词**决定，不是统一处理：
     *   「恢复」（九命猫「九命」写的是 [tips_20]，解析出来就是"恢复"）= 官方[20] RECOVER
     *   （不受减疗 / 暴击 / 残局治疗乘区影响）；「治疗」= HEAL（吃减疗）。
     *   引擎里本来就是两条管线（kernel/damage.ts 的 healTarget），这里如实分派。
     */
    channel: "HEAL" | "RECOVER";
    /** 判定所依据的原文子句（可复核） */
    clause: string;
  } | null;
  recognized: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW";
}

/** 归一化：全角百分号/空格/常见变体 */
export function normalize(text: string): string {
  return text
    .replace(/％/g, "%")
    .replace(/／/g, "/")
    .replace(/[\u3000\u00a0]/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/，/g, "，");
}

const MECH_KEYWORDS = /造成|伤害|治疗|恢复|护盾|吸收|抵挡|行动条|鬼火|概率|回合|免疫|无视|驱散|解除|增益|减益|控制|封印|压制|复活|召唤|提升|降低|增加|减少|消耗|获得|冷却|层|暴击|速度|防御|攻击|生命|命中|抵抗|倍|上限|递减|继承|替换|转移|分摊|抵挡|反击|协战|邀战|先机|维持|吞食|放逐|孤立|庇护|屏障/;

/** ★ 第 76 轮：`<动词>N层[buff_x]`。动词限定为"施加/移除"义，且**紧邻**状态引用才认。 */
const STACK_VERBS = "获得|附加|失去|消耗|叠加|增加|移除";
const RE_STACKS = new RegExp("(" + STACK_VERBS + ")\\s*(\\d+|[一二两三四五六七八九十])\\s*层\\s*(\\[buff_\\d+_\\d+\\])", "g");
/** ★ 阈值前缀：`每获得40层` / `达到N层` / `拥有N层` 是**条件**，不是一次施加 N 层。 */
const RE_STACK_THRESHOLD = /(每|若|达到|拥有|超过|上限|满)\s*$/;
const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** ★ 第 78 轮：层数上限的三种写法。实测技能文案里共 28 处，buff 定义里 0 处。 */
const RE_STACK_CAP = /(?:上限|最多(?:可)?叠加|最多)\s*(\d+|[一二两三四五六七八九十])\s*层/g;

/**
 * ★ 第 85 轮：护盾的**单次受击上限**。只认「最多抵挡该次伤害的N%」这一种写法 ——
 * 它明确说的是"这一次伤害"，所以归因没有歧义（对比：「最多不超过已损失生命的40%」就不认）。
 */
const RE_SHIELD_PER_HIT = /最多抵挡该次伤害的\s*(\d+(?:\.\d+)?)\s*%/;

/**
 * ★★★ 第 253 轮：**从伤害尾巴上读伤害类型**（探针 tools/_probe-m253b.ts / _probe-m253d.ts）。
 *
 * 尾巴有两种写法：tips 占位符（`[tips_5]`，名字就是「间接伤害」）与字面类型词（「间接伤害 / 真实伤害 / 固定伤害 / 传导伤害」）。
 * 此前只有**字面词**那一半有独立模式（dmgIndirect / dmgTrue / dmgFixed / dmgConduct），而通用的 dmgGeneric 一律记 `NORMAL`：
 *   · 24 条技能的伤害**类型记错**（写「造成…N%[tips_5]」却记 NORMAL）；
 *   · 同一次伤害被解析两遍的（581_03 的 195% 间接 / 561_03 的 150% 真实）在 type:ratio 去重下**活成两条槽** ⇒ 多算。
 * 把类型判定收到这一处之后，两半用**同一个答案**，重复自然合流。
 */
/**
 * ★★★ 第 253 轮（补量，探针 tools/_probe-m253h.ts）：**类型占位符不止 `[tips_5]` 一个**。
 *   tips 表里名字含「伤害」的条目有 5 个：间接伤害(5) / 真实伤害(18) / 固定伤害(28) / 传导伤害(12) / 形毁伤害(5732) ——
 *   按**名字**建表（不写死 id），于是任何一个"名字就是伤害类型"的占位符都能认出来。
 *   实测使用人口（比例落在伤害槽里的）：间接 24 条 · 真实 **1 条**（324_02「齿甲」的 12%）· 其余 0 条。
 */
const DAMAGE_TYPE_BY_TIP_NAME: Record<string, DamageType> = {
  "间接伤害": DamageType.INDIRECT,
  "真实伤害": DamageType.TRUE,
  "固定伤害": DamageType.FIXED,
  "传导伤害": DamageType.CONDUCTION,
  "形毁伤害": DamageType.FORM_DESTROY,
};

const typeOfDamageTail = (tail: string, tip: { name?: unknown } | null | undefined): DamageType | null => {
  const byTip = tip ? DAMAGE_TYPE_BY_TIP_NAME[String(tip.name)] : undefined;
  if (byTip) return byTip;
  if (/间接伤害/.test(tail)) return DamageType.INDIRECT;
  if (/真实伤害/.test(tail)) return DamageType.TRUE;
  if (/固定伤害/.test(tail)) return DamageType.FIXED;
  if (/传导伤害/.test(tail)) return DamageType.CONDUCTION;
  if (/形毁伤害/.test(tail)) return DamageType.FORM_DESTROY;
  return null;
};

const P = {
  // 伤害：覆盖 造成攻击N%的伤害 / 造成N%伤害 / 造成等同自身当前生命N%伤害 / 造成目标已损失生命N%
  dmgGeneric: /造成[^。；\n]{0,14}?(\d+(?:\.\d+)?)%[^。；\n]{0,6}?(?:伤害|\[tips_\d+\])/g,
  dmgMulti: /造成\s*(\d+)\s*次\s*(\d+(?:\.\d+)?)%\s*伤害/g,
  dmgIndirect: /(\d+(?:\.\d+)?)%\s*\[?间接伤害/g,
  dmgTrue: /(\d+(?:\.\d+)?)%\s*真实伤害/g,
  dmgFixed: /(\d+(?:\.\d+)?)%\s*固定伤害/g,
  dmgConduct: /(\d+(?:\.\d+)?)%\s*传导伤害/g,
  tally: /(\d+)\s*次/g,
  heal: /(?:治疗|恢复)[^。；\n]{0,14}?(\d+(?:\.\d+)?)%[^。；\n]{0,6}?生命/g,
  healTip: /(?:治疗|恢复)生命上限\s*(\d+(?:\.\d+)?)%/g,
  // ★ 第 80 轮：把百分号**两侧**都收进捕获组，基准词才抓得到（旧版只在百分号后找，"攻击"永远落在间隔里）。
  shield: /(?:吸收|抵挡)([^。；\n]{0,16}?)(\d+(?:\.\d+)?)%([^。；\n]{0,12}?)(?:的)?伤害/g,
  shieldTip: /\[tips_6\][^。；\n]{0,20}?(\d+(?:\.\d+)?)%/g,
  // ★ 第 93 轮：吸血的唯一写法 —— **百分号紧贴**「吸血」（含「N%吸血效果」）。
  //   宽松写法（只要句子里有「吸血」）会把式神名「吸血姬」与抑制句「无法触发…吸血效果」一起收进来，
  //   实测那两条都是假命中（见 IR 的 lifesteal 注释）。
  lifesteal: /(\d+(?:\.\d+)?)%\s*(?:的)?吸血/g,
  // ★ 拉条/推条是阴阳师的核心机制，但游戏文案的写法远不止"增加/击退"两种。
  //   实测漏掉过：「开启时提升友方全体10%行动条」（聆海金鱼姬·灵鱼抱蕊）——
  //   结果整场战斗一条 TIMELINE_SHIFT 都没有，Theater 的行动条永远不动。
  //   两种语序都要覆盖：① 提升…10%行动条 ② 行动条提升…10%
  pull: /(?:提升|增加|推进|前进)[^。；\n]{0,10}?(\d+(?:\.\d+)?)%\s*(?:的)?行动条|行动条[^。；\n]{0,8}?(?:提升|增加|推进)[^。；\n]{0,8}?(\d+(?:\.\d+)?)%/g,
  push: /(?:降低|减少|击退|后退|削减|推移)[^。；\n]{0,10}?(\d+(?:\.\d+)?)%\s*(?:的)?行动条|行动条[^。；\n]{0,8}?(?:降低|减少|击退|后退|削减)[^。；\n]{0,8}?(\d+(?:\.\d+)?)%/g,
  orbGain: /获得\s*(\d+)\s*点鬼火/g,
  orbAny: /(\d+)\s*点鬼火/g,
  buff: /\[buff_(\d+_\d+)\]/g,
  tips: /\[tips_(\d+)\]/g,
  /**
   * ★★★ 第 194 轮：**括起来的规范名也要认**（`有8%[基础概率]`）。
   *   原文里写的是 `8%[tips_2]` —— 读之前先把「名字里带概率」的占位符换回规范名（见下面的 probText）。
   *   全库 **97 处**这类写法此前一处都没读进来（实测椒图「水花弹」写 30%、跑出来 100%）。
   */
  prob: /(\d+(?:\.\d+)?)%\s*(?:\[(?:基础概率|的概率|概率)\]|基础概率|的概率|概率)/g,
  dur: /持续\s*(\d+)\s*回合/g,
  targetAll: /(敌方全体|友方全体|全体友方|全体敌方|非召唤物的友方全体)/g,
  targetSingle: /(敌方目标|友方目标|自身|选定目标|1名敌人|随机敌方目标)/g,
  defIgnore: /无视\s*(\d+(?:\.\d+)?)%[^。；\n]{0,6}?防御/g,
};

// ★ 所有 /g 正则都是**共享模块级对象**。String.matchAll(re) 会克隆正则并**继承 lastIndex**，
// 而 RegExp.test() 在成功后会推进 lastIndex —— 两者相撞会让「解析结果取决于函数被调用的顺序」。
// 修复：任何一次使用前先把 lastIndex 归零，用完再归零（见 tests/parse-determinism.ts）。
// 捕获组可能落在 m[1] 或 m[2]（同一语义的两种语序），取**第一个有值的组**，不要硬编码 m[1]
/**
 * ★★ 这一句是不是「主动复活」？（第 67 轮）
 *   保守优先：宁可漏判（保持未建模），也不要把触发式复活当主动技能执行。
 *   四条排除：被动技能、复活出现在触发词之后、`复活…时` 这种触发读法、依赖未建模容器。
 */
export const isActiveReviveClause = (clause: string, cost: number): boolean => {
  if ((Number(cost) || 0) < 0) return false;                       // 被动技能：整句都不是"动作"
  const i = clause.indexOf("复活");
  if (i < 0) return false;
  if (/[时若后被每]/.test(clause.slice(0, i))) return false;      // 「阵亡时…复活」「被复活…」
  if (/复活[^。；]{0,6}时/.test(clause)) return false;             // 「复活时…」
  if (/棺材|晴天娃娃|召唤物|小鬼/.test(clause)) return false;      // 依赖未建模容器
  if (/无法被复活|不能被复活/.test(clause)) return false;          // 禁止复活
  return true;
};

const N = (s: string, re: RegExp): number[] => {
  re.lastIndex = 0;
  const o: number[] = [];
  for (const m of s.matchAll(re)) {
    const v = m.slice(1).find(g => g !== undefined && g !== "");
    if (v !== undefined) o.push(parseFloat(v));
  }
  return o;
};
const M = (s: string, re: RegExp): RegExpMatchArray[] => { re.lastIndex = 0; return [...s.matchAll(re)]; };
/**
 * ★★★ 第 188 轮：**带偏移的数字提取** —— 与 N 同型，但每条数字带上**它自己在原文里的下标**。
 *
 * 为什么要下标：逐句效果归因要回答"这个伤害槽位是从哪一句话提取出来的"。
 * 靠**数字本身**回找子句是猜（同一个 125% 可以在两个子句里各写一次，鬼切「鬼刃·罗城门」就是），
 * 而正则匹配下标是**事实**：把下标落到 clauseSpans 的区间上，落在哪个小句就是哪个小句。
 * ★ 偏移取的是**那个数字**的位置，不是整段匹配的起点 —— 伤害正则允许跨逗号（`[^。；\n]{0,14}?`），
 *   取匹配起点会把"上一句里的动词 + 这一句里的数字"判成上一句。
 */
const NH = (s: string, re: RegExp): Array<{ v: number; at: number }> => {
  re.lastIndex = 0;
  const o: Array<{ v: number; at: number }> = [];
  for (const m of s.matchAll(re)) {
    const g = m.slice(1).findIndex((x) => x !== undefined && x !== "");
    if (g < 0) continue;
    const lit = String(m[g + 1]);
    o.push({ v: parseFloat(lit), at: (m.index ?? 0) + m[0].indexOf(lit) });
  }
  return o;
};
export function sentences(text: string): string[] { return text.split(/[。\n]/).map(s => s.trim()).filter(Boolean); }
/**
 * ★★★ 第 129 轮：「**追加施放**」——「…并对随机敌方目标施放『X』」这半句没有行为代码，
 *   由编译器合成一条 unmodeled 记录。**动词名只有这一份**：编译器写它、被动运行时读它
 *   （见 compile/passive-runtime.ts 里那道"记账照旧、执行不牵连"的例外）——
 *   两处各写一个字符串字面量，迟早会分叉，而分叉的方向是"这条记录不再被认出来"。
 */
export const APPEND_CAST_VERB = "追加施放";
/**
 * ★★★ 第 130 轮：「**致命伤害拦截**」——「受到致命伤害时…」里没有执行点的那些写法（见下面合成记录的判据）。
 *   与 APPEND_CAST_VERB 同一条规矩：动词名只有这一份，编译器写它、别处读它。
 */
export const LETHAL_GUARD_VERB = "致命伤害拦截";
/**
 * ★★★ 第 188 轮：**小句 + 它在原文里的偏移**（splitClauses 的"带下标孪生体"）。
 *
 * 为什么需要：第 180/181 轮的 statusRefClauses 靠"按子句顺序展开 buff 引用"这个技巧就能对上，
 *   因为引用本身是**带方括号的唯一串**；而伤害/治疗/护盾/拉条那些槽位只有**数字**
 *   （同一个 125% 可以在两个子句里各写一次），按数字找子句就是猜。
 *   带偏移的切分把"这个槽位是从原文第几个字符提取出来的"变成事实：正则的匹配下标 → 子句。
 */
export function clauseSpans(text: string): Array<{ text: string; at: number }> {
  const out: Array<{ text: string; at: number }> = [];
  for (const m of String(text ?? "").matchAll(/[^，；,;。\n！？!?]+/g)) {
    const lead = m[0].length - m[0].trimStart().length;
    out.push({ text: m[0].trim(), at: (m.index ?? 0) + lead });
  }
  return out.filter((x) => !!x.text);
}

/**
 * 小句：逗号/分号级。概率与驱散的归因粒度。
 * ★ 必须同时切句末标点与换行 —— 否则「对目标…驱散1个增益状态。友方受到单次敌方伤害…」
 *   会变成**一个小句**，下一句的主语「友方」把驱散对象判成己方（聆海金鱼姬「川流」就是这么错的）。
 * ★ 第 188 轮起，实现**委托给 clauseSpans** —— 同一条切分判据只有一份，否则偏移版与文本版迟早分叉。
 */
export function splitClauses(sentence: string): string[] {
  return clauseSpans(sentence).map((x) => x.text);
}

/**
 * ★ 技能的作用范围 —— 这是 `targeting` 字段的第一个（也是唯一一个）生产读取方。
 *
 * 由来：`targeting` 由技能原文解析而来（"敌方全体"/"友方全体"/"自身"/"随机敌方目标"），
 * 但引擎从来没人读它。后果是三重的、而且方向都是错的：
 *   ① 114 个群攻技能只打 1 个目标（雪女「暴风雪」只打到 1/5）
 *   ② 64 个「友方全体」技能把护盾/治疗丢给**敌方**（AI 目标永远取自敌人列表）
 *   ③ 127 个「自身」技能也去打敌人
 * 全库 818 个技能里 653 个的 targeting 非空，所以这不是边角情况。
 */
export type TargetMode = "SELF" | "ALLY_ALL" | "ALLY_ONE" | "ENEMY_ALL" | "ENEMY_RANDOM" | "ENEMY_ONE";

export function targetModeOf(ir: { targeting?: string[] }): TargetMode {
  const t = (ir.targeting ?? []).join("|");
  if (!t) return "ENEMY_ONE";
  if (/友方全体|全体友方|非召唤物的友方全体/.test(t)) return "ALLY_ALL";
  if (/敌方全体|全体敌方/.test(t)) return "ENEMY_ALL";
  if (/随机敌方目标/.test(t)) return "ENEMY_RANDOM";
  if (/友方目标/.test(t)) return "ALLY_ONE";
  if (/敌方目标|1名敌人|选定目标/.test(t)) return "ENEMY_ONE";
  if (/自身/.test(t)) return "SELF";
  return "ENEMY_ONE";
}

/** 该范围是否以**友方**为对象（决定候选名单取队友还是敌人） */
export function isAllyScoped(m: TargetMode): boolean {
  return m === "SELF" || m === "ALLY_ALL" || m === "ALLY_ONE";
}

/**
 * 取某个效果槽位的**施加概率**（0..1）。
 * `null` = 原文没有给概率 → 必定施加（这是**默认语义**，266/309 的状态本来就该必中）。
 * 引擎必须显式区分「原文说 100%」与「原文没说」—— 前者不该掷骰，后者也不该被当成 100% 概率去污染 RNG 序列。
 */
/**
 * ★★★ 第 80 轮：从护盾文本里判定**基准**。判据只认写出来的词，认不出就退回 maxHp（旧语义）。
 * 顺序有意义：先看「已损失生命」（它最具体），再看「攻击」，最后「生命上限」。
 */
export function shieldBaseOf(seg: string): { base: "atk" | "maxHp" | "lostHp"; evidence: string } | null {
  if (/已损失生命|损失的生命/.test(seg)) return { base: "lostHp", evidence: "已损失生命" };
  if (/攻击/.test(seg)) return { base: "atk", evidence: "攻击" };
  if (/生命上限|最大生命|生命值/.test(seg)) return { base: "maxHp", evidence: "生命上限" };
  return { base: "maxHp", evidence: "（原文未指明基准 → 默认生命上限，与旧语义一致）" };
}

export function probOf(ir: { effectProbs?: Array<{ slot: string; probability: number }> }, slot: string): number | null {
  const hit = (ir.effectProbs ?? []).find(e => e.slot === slot);
  return hit ? Math.max(0, Math.min(1, hit.probability / 100)) : null;
}

/**
 * 取某个状态槽位在**技能原文**里写明的持续回合（没写 = null，由调用方回退到印记自身描述）。
 * 与 probOf 同型：null 不等于 1，它是「原文没说」这个事实本身。
 */
/**
 * ★★★ 第 76 轮：取某个状态槽位在技能原文里写明的**层数**（没写 = null，施加默认 1 层）。
 * 与 probOf / durationOf 完全同型 —— null 不等于 1：前者是"原文没说"，后者是"原文说了 1 层"。
 */
/**
 * ★★★ 第 188 轮：**逐句比对的唯一归一化**（第 181 轮内联在 statusRefSlotsForClause 里，
 *   本轮抽出来共用 —— 两处各写一份正则，迟早会分叉，而分叉的方向是"证据认不出来 ⇒ 照旧全放 ⇒ 多算"）。
 *
 * 去掉 br 标签、去掉**所有非 buff 的方括号**（tips 占位符 / 基础概率 / 眩晕 …）、去掉空白。
 * 前两项都不是装饰：触发单元的文本是**解析过 tips 的规范文本**，而证据是**原文**，
 * 不归一化就永远对不上（第一版就是这么错的：有误判成没有）。
 */
export function normClauseText(s: any): string {
  return String(s ?? "").replace(/<br\s*\/?>/gi, "").replace(/\[(?!buff_)[^\]]*\]/g, "").replace(/\s+/g, "");
}

/** 一个偏移落在哪个小句里（clauseSpans 的下标 → 子句文本）。找不到 = 空串（fail-closed 的上游） */
export function clauseAtOffset(spans: Array<{ text: string; at: number }>, offset: number): string {
  const hit = spans.find((s) => offset >= s.at && offset < s.at + s.text.length);
  return hit ? hit.text : "";
}

/**
 * ★★★ 第 188 轮：**这一句该产生哪几个效果槽位**（逐句效果归因的**第二批** —— damage / heal / shield / timeline）。
 *
 * 与 statusRefSlotsForClause 是同一件事的另外四个字段，返回形状也一样：
 *   · null —— 这条技能**没有**这一族的逐句证据（effectClauses 里没写这一族）⇒ 调用方**照旧全放**（逐位不变）；
 *   · 数组（**可能是空的**）—— 严格按证据：只做属于这一句的槽位；空数组 = 这一句不产生这一族的效果。
 *
 * ★ 为什么按**族**分别返回而不是一个总表：四族的"有没有证据"是各自独立的事实 ——
 *   一条技能可能伤害有证据、拉条没有，那么伤害该收窄、拉条照旧。
 */
export interface EffectSlotFilter { damage?: number[]; heal?: number[]; shield?: number[]; timeline?: number[] }

export function effectSlotsForClause(ir: any, clause: string, kind: "damage" | "heal" | "shield" | "timeline"): number[] | null {
  const homes = ir?.effectClauses?.[kind];
  const arr: any[] = ir?.[kind] ?? [];
  if (!Array.isArray(homes) || homes.length !== arr.length) return null;
  const want = normClauseText(clause);
  const out: number[] = [];
  homes.forEach((h: any, i: number) => {
    const c = normClauseText(h);
    if (c.length > 4 && want.length > 4 && (want.includes(c) || c.includes(want))) out.push(i);
  });
  return out;
}

/**
 * ★★★ 第 181 轮：**这一句该施加哪几个状态引用**（逐句效果归因的执行侧判据）。
 *
 * 返回：
 *   · null —— 这条技能**没有**逐句证据（statusRefClauses 不存在或与 statusRefs 对不上）⇒ 调用方**照旧全放**（与今天逐位相同）；
 *   · 数组 —— **严格按证据**：只施加属于这一句的**槽位下标**（注意：不是 ref —— 同一个 ref 可能占多个槽位，
 *     按 ref 过滤会把隔壁那句的那一份也放过去，第一版就是这么错的）。**可能是空数组**（这一句的引用全是条件，或没有引用）——
 *     那就是这一句不施加任何状态，是**故意**的（宁可少算，不许把隔壁子句的效果也一起算上）。
 *
 * 归一化：去掉 br 标签、去掉**所有非 buff 的方括号**（tips 占位符 / 基础概率 / 眩晕 …），只留 buff 引用做比对 ——
 *   不加这一步，原文形态的 tips 占位符与解析后的规范名对不上，会把有误判成没有（探针里第一版就是这么错的）。
 * ★ 槽位的证据是**小句**（splitClauses 切出来的），而触发单元的子句可能是整句 ⇒ 用**双向包含**判。
 */
export function statusRefSlotsForClause(ir: any, clause: string): number[] | null {
  const slots = ir?.statusRefClauses;
  const refs: string[] = ir?.statusRefs ?? [];
  if (!Array.isArray(slots) || slots.length !== refs.length) return null;
  const want = normClauseText(clause);
  const condOnly = new Set<number>((ir?.statusRefConditionOnly ?? []) as number[]);
  const out: number[] = [];
  refs.forEach((r, i) => {
    if (condOnly.has(i)) return;                       // 层数门槛里的那个引用**不是效果**
    const c = normClauseText(slots[i]);
    if (c.length > 4 && want.length > 4 && (want.includes(c) || c.includes(want))) out.push(i);
  });
  return out;
}
/**
 * ★★★ 第 194 轮：**这一句该施加哪几个池子条目**（与 statusRefSlotsForClause / effectSlotsForClause 同型）。
 *   · null —— 这条技能没有池子（randomStatuses 不存在或为空）⇒ 调用方**不放这个键**（与今天逐位相同）；
 *   · 数组（**可能是空的**）—— 严格按证据：只施加属于这一句的池子条目。
 * 归一化沿用 normClauseText（去掉非 buff 方括号），与另外两族**共用同一份判据**。
 */
export function randomPoolSlotsForClause(ir: any, clause: string): number[] | null {
  const arr: any[] = ir?.randomStatuses ?? [];
  if (!Array.isArray(arr) || !arr.length) return null;
  const want = normClauseText(clause);
  const out: number[] = [];
  arr.forEach((e: any, i: number) => {
    const c = normClauseText(e?.clause);
    if (c.length > 4 && want.length > 4 && (want.includes(c) || c.includes(want))) out.push(i);
  });
  return out;
}
/**
 * ★★★ 第 195 轮：**这一句该施加哪几个控制占位符**（与 statusRefSlotsForClause / effectSlotsForClause / randomPoolSlotsForClause 同型）。
 *   · null —— 这条技能没有控制占位符（controlRefs 不存在或为空）⇒ 调用方**不放这个键**（与今天逐位相同）；
 *   · 数组（**可能是空的**）—— 严格按证据：只施加属于这一句的那些。
 */
export function controlSlotsForClause(ir: any, clause: string): number[] | null {
  const arr: any[] = ir?.controlRefs ?? [];
  if (!Array.isArray(arr) || !arr.length) return null;
  const want = normClauseText(clause);
  const out: number[] = [];
  arr.forEach((e: any, i: number) => {
    const c = normClauseText(e?.clause);
    if (c.length > 4 && want.length > 4 && (want.includes(c) || c.includes(want))) out.push(i);
  });
  return out;
}
export function stacksOf(ir: { statusStacks?: Array<{ slot: string; stacks: number }> | null }, slot: string): number | null {
  const hit = (ir.statusStacks ?? []).find(e => e.slot === slot);
  return hit && hit.stacks > 1 ? hit.stacks : null;
}

/**
 * ★★★ 第 78 轮：取某个状态槽位在技能原文里写明的**层数上限**（没写 = null，不封顶）。
 * 与 probOf / durationOf / stacksOf 完全同型。
 */
export function capOf(ir: { statusCaps?: Array<{ slot: string; max: number }> | null }, slot: string): number | null {
  const hit = (ir.statusCaps ?? []).find(e => e.slot === slot);
  return hit && hit.max > 0 ? hit.max : null;
}

export function durationOf(ir: { statusDurations?: Array<{ slot: string; turns: number }> }, slot: string): number | null {
  const hit = (ir.statusDurations ?? []).find(e => e.slot === slot);
  return hit && hit.turns > 0 ? hit.turns : null;
}

/**
 * ★★★ 第 112 轮：**严重度唯一的来源是动词表**（compile/unmodeled.ts 的 severity 字段）。
 *   报告层此前硬编码了 `verb === "召唤" || verb === "复活"` 两个名字 —— 那种名单一定会与表分叉，
 *   而分叉的方向是把要紧的缺口标成 INFO（第 110/111 轮新增的在场光环/收回就不在名单里）。
 */
const SEV: Map<string, "WARN" | "INFO"> = new Map(UNMODELED.map((e: any) => [e.verb, e.severity ?? "INFO"]));
export function compileSkill(charId: number, charName: string, sk: any): SkillIR {
  const raw = normalize(sk.description ?? "");
  const recognized: string[] = [];
  /**
   * ★★★ 第 188 轮：**小句区间表**（逐句效果归因的定位基座，见 NH 的注）。
   *   一次切好复用四族 —— 每个槽位的正则下标落到哪一段，就是它的证据子句。
   */
  const spans = clauseSpans(raw);
  const homeAt = (offset: number): string => clauseAtOffset(spans, offset);
  /**
   * ★★★ 第 187 轮：**消耗型换命**的解析（见 SkillIR.lethalConsume 的注）。
   */
  const lethalConsume = (() => {
    const totalM = /凝炼成\s*(\d+)\s*朵\s*\[buff_(\d+_\d+)\]/.exec(raw);
    const useM = /受到致命伤害时[，,]?\s*消耗\s*(\d+)\s*朵\s*\[buff_(\d+_\d+)\][，,]?\s*获得其中的生命/.exec(raw);
    if (!totalM || !useM || totalM[2] !== useM[2]) return null;
    return { statusRef: String(useM[2]), perStack: Number(useM[1]), total: Number(totalM[1]), clause: String(useM[0]) };
  })();
  const damage: SkillIR["damage"] = [];
  /** ★★★ 第 188 轮：与 damage **一一对应**（去重前）的逐句证据 —— 去重必须**同进同出**，见下面的 keepIdx */
  const damageHomes: string[] = [];
  const pushDamage = (e: SkillIR["damage"][number], at: number): void => { damage.push(e); damageHomes.push(homeAt(at)); };

  /**
   * ★★★ 第 188 轮：**第三种假阳性伤害** —— 「造成…时，有 N%[tips_2]附加…」里的 N 是**概率**。
   *
   * 由来（由本轮的逐句证据照出来）：dmgGeneric 的尾巴是「伤害 或 [tips_N]」二选一 ——
   *   允许 tips 占位符是为了「造成攻击42%[tips_5]」（间接伤害）这种写法，但同一个尾巴也把**概率**收进来了：
   *   292/292_02「霜天之织」的 damage=[{ratio:25}]，而证据子句是「有25%[基础概率]附加[冰冻]1回合」。
   *   全库这种形状有 **92 个技能**（探针 tools/_probe-attrib188h.ts 逐个印出来），每一个都凭空多打一下。
   *
   * 判据（只有这一条，收得极窄）：**紧跟在那个数字后面**的 tips 占位符，其**规范名**含「概率」
   *   （全库只有 tips_2 =「基础概率」）。★ 用规范名而不是写死 id —— 加一个新占位符就会失效。
   * ★ 这一刀必须落在**匹配级**，不能沿用第 183 轮那种「按 ratio 拉黑」的写法：
   *   若同一门技能里既有真伤害 30% 又有概率 30%，ratio 级的闸门会把**真伤害**一起删掉（第一版就是这么写的，
   *   当场把 92 个技能全卷进来、其中一部分会误删真伤害）。
   */
  const damageProbRejects: Array<{ ratio: number; evidence: string }> = [];
  {
    const tipsRef = tipsTable();
    for (const m of M(raw, P.dmgGeneric)) {
      const num = String(m[1]);
      const head = m[0].indexOf(num);
      if (head < 0) { pushDamage({ ratio: parseFloat(num), type: DamageType.NORMAL, base: "atk" }, (m.index ?? 0)); continue; }
      const at = (m.index ?? 0) + head;
      const pm = /^\s*%\s*\[tips_(\d+)\]/.exec(m[0].slice(head + num.length));
      const pt = pm ? tipsRef.get(String(pm[1])) : null;
      if (pt && /概率/.test(String(pt.name))) { damageProbRejects.push({ ratio: parseFloat(num), evidence: homeAt(at) || m[0] }); continue; }
      /**
       * ★★★ 第 253 轮：**尾巴上的 tips 占位符就是伤害类型**（`[tips_5]` = 间接伤害）。
       *
       * 由来（探针 tools/_probe-m253b.ts）：全库 **25 条**技能写「造成…N%[tips_5]」，其中 **24 条**的比例真的落在伤害槽里，
       *   而这 24 条此前**全部**被记成 `NORMAL`。更糟的是同一个数据集里另有 `P.dmgIndirect`（按字面「间接伤害」）
       *   会把同一条比例**再收一遍**成 `INDIRECT`：581_03「五光斩」于是同时有 `NORMAL:195` 与 `INDIRECT:195` 两条槽
       *   ⇒ 一次施放把那个 195% 打了**两遍**（多算；去重键一直是 `type:ratio`，两条不同类型因此都活了下来）。
       *
       * 把类型判定放在这一处（与上面"概率不是伤害"共用同一个 tips 表、同一段证据），两个毛病一起消：
       *   ① 24 条的 type 按原文记成 INDIRECT；② 581_03 的两条槽合流成一条（同 type 同 ratio ⇒ 被去重）。
       * ★ 边界：只认名字**恰好**是「间接伤害」的占位符；名字不是它的（概率 / 别的东西）照旧走原路。
       */
      const tail = m[0].slice(head + num.length);
      pushDamage({ ratio: parseFloat(num), type: typeOfDamageTail(tail, pt) ?? DamageType.NORMAL, base: "atk" }, at);
    }
  }
  for (const m of M(raw, P.dmgMulti)) pushDamage({ ratio: parseFloat(m[2]), type: DamageType.NORMAL, base: "atk", note: m[1] + "段" }, (m.index ?? 0) + m[0].indexOf(m[2]));
  for (const r of NH(raw, P.dmgIndirect)) pushDamage({ ratio: r.v, type: DamageType.INDIRECT, base: "atk", note: "官方[5]" }, r.at);
  for (const r of NH(raw, P.dmgTrue)) pushDamage({ ratio: r.v, type: DamageType.TRUE, base: "atk", note: "官方[18]" }, r.at);
  for (const r of NH(raw, P.dmgFixed)) pushDamage({ ratio: r.v, type: DamageType.FIXED, base: "atk", note: "官方[28]" }, r.at);
  for (const r of NH(raw, P.dmgConduct)) pushDamage({ ratio: r.v, type: DamageType.CONDUCTION, base: "atk", note: "官方[12]" }, r.at);
  /**
   * ★★★ 第 183 轮：**引用式写法的假阳性伤害**（「储存等同于伤害20%的X」被当成「造成伤害」）与**基数不一致**的记账。
   *
   * ① 假阳性：子句里出现「等同于 / 相当于 … 伤害N%」**且这一句没有「造成/打出/施加」这类动词**时，
   *    那个 N% 不是「造成伤害」，而是「以伤害为参照做别的事」（储存 / 转化为护盾 / 吸收…）。
   *    实测（tools/_probe-dmg183.ts）：全库 3 条命中，其中 1 条是假阳性（晴思日和坊「澄空彩虹」的 damage=[20]）；
   *    另 2 条保留 —— 茨木童子「对敌方全体造成**等同过量伤害**100%伤害」有「造成」动词，是真伤害，**不许误伤**。
   *    ★ 这一条同时解释了另一个现象：那 1 条假阳性让「澄空彩虹」**看起来有可执行效果**，于是被动运行时把它装上了
   *      （hasExecutableSurface 认 damage）—— 假产物会一路骗到装配层。
   *
   * ② 基数不一致：子句写「生命上限N%」而产物一律记 base=atk（13 个技能，见 _probe-dmgbase183.ts）。
   *    这一轮**只记账、不改行为** —— 改基数会动到典型对局（樱花妖在阵容里）的默认档指纹，
   *    那需要一次明确的裁定（与 §142 那个「主动技能里的先机装在哪」同类）。
   */
  /** 去重后的 ratio 集合（用于判断"基数记账"有没有对应的真实产物） */
  const dedupRawRatios = new Set<number>(); { const seen0 = new Set<string>(); for (const d of damage) { const k = d.type + ":" + d.ratio; if (seen0.has(k)) continue; seen0.add(k); dedupRawRatios.add(d.ratio); } }
  const damageSkips: NonNullable<SkillIR["damageSkips"]> = [];
  const damageBaseMismatch: NonNullable<SkillIR["damageBaseMismatch"]> = [];
  {
    const clauses = sentences(raw).flatMap((s) => splitClauses(s).map((c) => c.trim())).filter(Boolean);
    const dealing = /造成|打出|施加|受到/;
    const refNums = new Set<number>(), dealNums = new Set<number>();
    for (const c of clauses) {
      const m = /(?:等同于|相当于|等于|等同)[^，。；]{0,8}伤害\s*(\d+(?:\.\d+)?)\s*%/.exec(c);
      if (!m) continue;
      const n = Number(m[1]);
      if (dealing.test(c)) dealNums.add(n); else refNums.add(n);
    }
    for (const n of refNums) if (!dealNums.has(n)) damageSkips.push({
      reason: "DAMAGE_REFERENCE_NOT_DEALT", ratio: n,
      evidence: clauses.find((c) => new RegExp("(?:等同于|相当于|等于|等同)[^，。；]{0,8}伤害\\s*" + n + "\\s*%").test(c)) ?? "",
    });
    for (const c of clauses) {
      const m = /生命上限\s*(\d+(?:\.\d+)?)\s*%/.exec(c);
      if (m && /造成|伤害/.test(c)) damageBaseMismatch.push({ ratio: Number(m[1]), stated: "maxHp", evidence: c });
    }
    /**
     * ★ 只保留**真的有对应伤害产物**的那些：子句写了「生命上限N%」但产物里没有这个 ratio 的，
     *   说明那一句本来就不产伤害（例如「超过其生命上限30%时」这种条件）—— 那不是"基数记错"，不该混进这个清单。
     */
    for (let i = damageBaseMismatch.length - 1; i >= 0; i--) {
      if (!dedupRawRatios.has(damageBaseMismatch[i].ratio)) damageBaseMismatch.splice(i, 1);
    }
  }
  /** ★★★ 第 188 轮：匹配级拒掉的那些（每个都带证据子句）—— 记账与第 183 轮同表，理由码不同 */
  for (const r of damageProbRejects) damageSkips.push({ reason: "PROBABILITY_NOT_DAMAGE", ratio: r.ratio, evidence: r.evidence });
  const refSkipRatios = new Set(damageSkips.map((s) => s.ratio));
  /**
   * ★★★ 第 253 轮：**同一比例出现在两种伤害语义下** —— 只保留**先出现**的那一条，另一条记进 `damageTypeCollisions`。
   *
   * 由来（探针 tools/_probe-m253d.ts）：全库只有 **3 条**技能有这种重复，但性质分两类 ——
   *   · 561_03 / 581_03 是**同一次伤害被解析了两遍**（dmgGeneric 的尾巴写着字面类型词「真实伤害」「间接伤害」，
   *     而 dmgTrue / dmgIndirect 又把同一个数收了一遍）⇒ 那是**多算**：581_03 一次施放把 195% 打了两遍（290+195+195）。
   *     ★ 这两条在类型判定统一到 `typeOfDamageTail` 之后**自己合流**（同 type 同 ratio ⇒ 被下面的去重吃掉），
   *       走不到这里来。留着这道闸门是为了**下一个**这种写法。
   *   · 251_03「死亡宣告」是**真的两次**：先「造成攻击100%伤害」，再「未被移除时，在目标回合开始前造成攻击100%[tips_5]」——
   *     第二次是**延迟 + 有条件**的那一次，而引擎没有"延迟引爆"这条时间线 ⇒ 两条都打就是多算。
   *     这里保留**即时**那一条（先出现的），把延迟那条记下来（账在人看得见的地方，而不是把多算留在行为里）。
   * ★ fail-closed：只合并"同一个比例 + 不同类型"；同型重复交给原来的 type:ratio 去重（行为与今天逐位相同）。
   */
  const damageTypeCollisions: NonNullable<SkillIR["damageTypeCollisions"]> = [];
  {
    const firstAt = new Map<number, number>();
    for (let i = 0; i < damage.length; i++) {
      const r = Number(damage[i].ratio);
      const j = firstAt.get(r);
      if (j === undefined) { firstAt.set(r, i); continue; }
      if (damage[j].type === damage[i].type) continue;
      /**
       * ★★★ 实测（第一版就踩到）：**不能只看"同比例、不同类型"就合并**。
       *   365_01「雀啄」写着「对目标造成攻击50%的伤害**并额外造成自身防御50%的真实伤害**」—— 两个 50% 是
       *   **两次真的伤害**（基数不同：攻击 / 防御），第一版把它们合成一条 ⇒ 当场少算一次。
       *   所以判据收窄成**"后出现的那一次是延迟 / 有条件的那一次"**：句子里点名了
       *   「未被移除时 / 回合开始前 / 回合结束时 / 引爆 / 延迟 / 之后 / 结束时」这类时间或条件标记，才合并。
       *   fail-closed：读不出这类标记 ⇒ 两条都留（与今天逐位相同）。
       */
      const home = damageHomes[i] ?? "";
      if (!/未被移除|回合开始前|回合结束时|引爆|延迟|之后|结束时/.test(home)) continue;
      damageTypeCollisions.push({ ratio: r, kept: String(damage[j].type), dropped: String(damage[i].type), clause: home });
      damage.splice(i, 1);
      damageHomes.splice(i, 1);
      i--;
    }
  }

  /**
   * 去重（同一数值被多个模式命中）。
   * ★★★ 第 188 轮改成**按下标去重**：逐句证据（damageHomes）与 damage 一一对应，
   *   两把 .filter 分开跑就再也对不上了 —— 而"对不上"的表现是**证据指到隔壁槽位**，
   *   比没有证据更坏（会用错的句子去收窄）。
   */
  const seen = new Set<string>();
  const keepIdx: number[] = [];
  damage.forEach((d, i) => { const k = d.type + ":" + d.ratio; if (seen.has(k)) return; seen.add(k); keepIdx.push(i); });
  const keptIdx = keepIdx.filter((i) => !refSkipRatios.has(damage[i].ratio));
  const dedup = keptIdx.map((i) => damage[i]);
  /** 与 dedup 一一对应的逐句证据 */
  const dedupHomes = keptIdx.map((i) => damageHomes[i]);
  if (dedup.length) recognized.push("dmg:" + dedup.map(d => d.type[0] + d.ratio).join(","));

  const tallies = N(raw, P.tally);
  const hitsRaw = tallies.length ? Math.max(...tallies.filter(n => n >= 2 && n <= 12), 1) : 1;
  /**
   * ★★★ 第 251 轮：**条件伤害分支的互斥**（把第 250 轮记的那笔账收尾；见报告 §190 与 §191）。
   *
   * 第 250 轮实测：御怨般若「恨返」331_01 一次施放打出 **4 条**伤害事件 —— 因为产物里既有基础那一条
   *   （`{atk,100}`），又有「若开启封印结界，**则此技能改为**攻击敌方目标2次，每次造成攻击80%」那一**支**的
   *   `{atk,80}`，而 `hits` 又取了那一支的「2次」⇒ 2×(100%+80%)。原文是**互斥**的：1 条 100%（未开结界）或 2 条 80%（开结界）。
   * 本轮把那一支**从可执行产物里摘出来**：
   *   · 摘出的槽进 `damageBranch`（记录 hits / ratio / 判据原句 / 条件名），**不执行**；
   *   · 若 `hits` 正好等于那一支的「N次」（说明它是从分支里读来的），基础形态的 `hits` 收回 **1**；
   *   · fail-closed：比例匹配不上、或摘完只剩 0 条伤害槽 ⇒ **一个字都不动**（保持第 250 轮的状态）。
   * ★ 边界如实记：那一支**仍未执行**（条件「封印结界」在引擎里没有载体）—— 本轮修的是**多算**，不是把分支做出来。
   *   所以记账户头照旧（句子判 MECHANIC_UNPARSED + 缺口动词「条件伤害分支」）。
   */
  const damageBranch: SkillIR["damageBranch"] = ((): SkillIR["damageBranch"] => {
    const cl = ((): string | null => {
      const m1 = /[^。；]{0,26}?则此技能改为[^。；]{0,12}攻击[^。；]{0,20}/.exec(raw);
      if (m1) return String(m1[0]).trim();
      return null;
    })();
    if (!cl) return undefined;
    const m = /则此技能改为攻击[^。；]{0,10}?(\d+)\s*次[^。；]{0,14}?造成攻击\s*(\d+(?:\.\d+)?)\s*%/.exec(cl);
    if (!m) return undefined;
    const bh = Number(m[1]), br = Number(m[2]);
    const at = dedup.findIndex((d: any) => d.base === "atk" && Number(d.ratio) === br);
    if (at < 0 || dedup.length < 2) return undefined;
    const [moved] = dedup.splice(at, 1);
    const gate = (() => { const g = /若\s*(?:开启|存在)\s*([\u4e00-\u9fa5]{2,8})/.exec(cl); return g ? String(g[1]) : null; })();
    return { clause: cl, hits: bh, ratio: br, base: "atk", gateName: gate, movedSlot: { type: String(moved.type), ratio: Number(moved.ratio) } };
  })();
  const hits = damageBranch && hitsRaw === damageBranch.hits ? 1 : hitsRaw;
  if (hits > 1) recognized.push("hits:" + hits);
  if (damageBranch) {
    /**
     * ★★★ 实测（第一版）：`dmg:` 那条 recognized 是在摘槽**之前**算的 ⇒ 摘完还写着「dmg:N100,N80」，
     *   而可执行产物里只剩 `N100` —— **报表与产物不一致**（这一族的老毛病）。摘完立刻把那条改对。
     */
    const di = recognized.findIndex((r: string) => r.startsWith("dmg:"));
    if (di >= 0) recognized[di] = "dmg:" + dedup.map((d: any) => d.type[0] + d.ratio).join(",");
    recognized.push("damageBranch:" + damageBranch.hits + "x" + damageBranch.ratio + "%");
  }

  /**
   * ★★★ 第 252 轮：**分段伤害形状**（见 SkillIR.damageSegments 的注 —— 那六条判据就是这里与下面 segGapClause 的判据）。
   *
   * A/B 两段先各自匹配，再逐条过闸门；**任一条不过就一个字都不写**，并把那句交给下面的记账（segGapClause）。
   *   ★ 为什么必须有"记账"那一半：探针 tools/_probe-seg252.ts 数出这一族 **12 条**（另有 3 条被六条闸门挡下），
   *     本轮只修得了 4 条。剩下的若只写"没修"而不记账，报表上它们仍然是 `confidence: HIGH` —— 又回到"报表说完整编译"。
   */
  const segA = /攻击敌方(全体|目标)\s*(\d+)\s*次[^。；]{0,20}?造成攻击\s*(\d+(?:\.\d+)?)\s*%/.exec(raw);
  const segB = segA ? /(?:最后再|最后|然后再|然后|随后再|随后|再)\s*(?:对|攻击)\s*(?:指定)?敌方(全体|目标)\s*(?:\d+\s*次)?([^。；]{0,20}?)(?:造成)?(?:攻击)?\s*(\d+(?:\.\d+)?)\s*%/.exec(raw) : null;
  /**
   * ★★★ 第 254 轮：**另外两种分段写法**（探针 tools/_probe-m254a.ts，各命中 1 条）—— 把第 252 轮剩下的两笔账收掉。
   *
   *   ② **反序**：先"单体一击"、再"N 次全体" —— 607_03「百羽衔火」：「攻击选中目标造成攻击160%伤害，
   *      **再**攻击敌方全体2次每次造成攻击50%伤害」。第 252 轮的判据写的是"先 N 次、后 1 次"⇒ 形状 ② 被第三条闸门挡下，
   *      当时按记账处理（缺口动词「分段伤害形状」）。
   *   ③ **静态追加**：先"对所有敌方 N 次 X%"、再"对指定敌方目标**追加 M 次 Y%**" —— 556_03「神圣裁决」。
   *      与"动态追加"的分界：M 与 Y 必须**写死在原文里**；出现「每层 / 每降低 / 每提升 / 若 / 等同于 / 根据」就是动态 ⇒ 不收
   *      （392_03 的「每降低24%…追加1次」正是被这一条挡下的）。★ 「每次造成」是"每一击"的写法，不算动态 ——
   *      第一版把"每"一律当动态，当场把 607_03 自己挡在门外（探针里那一栏写的 中段动态=true 就是这个假阳性）。
   */
  const revA = /攻击(?:选中|指定)?(?:敌方)?目标[^。；]{0,10}?造成攻击\s*(\d+(?:\.\d+)?)\s*%/.exec(raw);
  const revB = revA ? /再[^。；]{0,4}?攻击敌方全体\s*(\d+)\s*次[^。；]{0,14}?造成攻击\s*(\d+(?:\.\d+)?)\s*%/.exec(raw) : null;
  const addA = /对(?:所有|全体)敌方造成\s*(\d+)\s*次攻击\s*(\d+(?:\.\d+)?)\s*%/.exec(raw);
  const addB = addA ? /(?:再|然后|随后)[^。；]{0,6}?(?:对)?(?:指定)?敌方目标追加\s*(\d+)\s*次攻击\s*(\d+(?:\.\d+)?)\s*%/.exec(raw) : null;
  /** 动态标记（「每次」不在其中 —— 那是"每一击"，不是"每次不同"） */
  const DYN_SEG = /每层|每降低|每提升|每消耗|每有|若|等同于|相当于|根据/;
  const segScope = (w: string): "ENEMY_ALL" | "ENEMY_ONE" => (w === "全体" ? "ENEMY_ALL" : "ENEMY_ONE");
  const segSlotOk = (ratios: number[]): boolean =>
    ratios.every((r) => dedup.some((d: any) => Number(d.ratio) === r && d.base === "atk")) && dedup.length <= 2;

  const damageSegments: SkillIR["damageSegments"] = ((): SkillIR["damageSegments"] => {
    /**
     * ★★★ 三种形状**依次尝试**（第 254 轮改成"落空就往下试"）：
     *   第一版每种形状内部一遇闸门就 `return undefined` —— 整条链路当场结束。
     *   实测（把 607_03 挡在门外）：它的形状 ① 模式**命中**了（「再攻击敌方全体2次…」），
     *   只是第三条闸门（B 必须整段落在 A 之后）不过 ⇒ 于是连形状 ② 都没机会试。
     *   现在每一段闸门不过就**落空继续**，三种都不成立才返回 undefined。
     */
    /** 形状 ①（第 252 轮）：先 N 次（全体|目标）、最后 1 次（另一个范围） */
    const byFirst = ((): SkillIR["damageSegments"] => {
      if (!segA || !segB) return undefined;
      /** ③ B 必须**整段落在 A 之后**（607_03 的 B 落在 A 内部 ⇒ 那是形状 ② 的写法，交给下面） */
      if (segB.index < segA.index + segA[0].length) return undefined;
      /** ④ 两段范围必须不同（相同范围的是"附加状态 + 附带伤害"那一族：210_03 / 260_03） */
      if (segA[1] === segB[1]) return undefined;
      const hitsA = Number(segA[2]), ratioA = Number(segA[3]), ratioB = Number(segB[3]);
      /** ⑤ A 段必须真的是"多段"，且两个比例都要**真有槽位** */
      if (!(hitsA >= 2)) return undefined;
      if (!segSlotOk([ratioA, ratioB])) return undefined;
      /** ⑥ 中段不许夹动态量 / 条件追加（592_03 / 392_03 / 399_03） */
      if (/等同于|相当于|等于|等同|追加|每降低/.test(segB[2])) return undefined;
      return [
        { clause: String(segA[0]).trim(), scope: segScope(segA[1]), hits: hitsA, ratio: ratioA },
        { clause: String(segB[0]).trim(), scope: segScope(segB[1]), hits: 1, ratio: ratioB },
      ];
    })();
    if (byFirst) return byFirst;
    /** 形状 ②：先单体一击、再 N 次全体（607_03） */
    const byReversed = ((): SkillIR["damageSegments"] => {
      if (!revA || !revB) return undefined;
      if (revB.index < revA.index + revA[0].length) return undefined;
      const r1 = Number(revA[1]), h2 = Number(revB[1]), r2 = Number(revB[2]);
      if (!(h2 >= 2)) return undefined;
      if (!segSlotOk([r1, r2])) return undefined;
      if (DYN_SEG.test(String(revB[0]))) return undefined;
      return [
        { clause: String(revA[0]).trim(), scope: "ENEMY_ONE", hits: 1, ratio: r1 },
        { clause: String(revB[0]).trim(), scope: "ENEMY_ALL", hits: h2, ratio: r2 },
      ];
    })();
    if (byReversed) return byReversed;
    /** 形状 ③：先 N 次全体、再"追加 M 次单体"（M / Y 都写死在原文里；556_03） */
    const byAppend = ((): SkillIR["damageSegments"] => {
      if (!addA || !addB) return undefined;
      if (addB.index < addA.index + addA[0].length) return undefined;
      const h1 = Number(addA[1]), r1 = Number(addA[2]), h2 = Number(addB[1]), r2 = Number(addB[2]);
      if (!(h1 >= 2 && h2 >= 1)) return undefined;
      if (!segSlotOk([r1, r2])) return undefined;
      if (DYN_SEG.test(String(addB[0]))) return undefined;
      return [
        { clause: String(addA[0]).trim(), scope: "ENEMY_ALL", hits: h1, ratio: r1 },
        { clause: String(addB[0]).trim(), scope: "ENEMY_ONE", hits: h2, ratio: r2 },
      ];
    })();
    return byAppend;
  })();
  if (damageSegments) {
    recognized.push("damageSegments:" + damageSegments.map((g) => g.hits + "x" + g.ratio + "%/" + (g.scope === "ENEMY_ALL" ? "全体" : "单体")).join("+"));
  }
  /**
   * ★★★ 第 252 轮（记账侧）：**分段伤害形状** —— 认得出"两段"，但有一段表达不了。
   *
   * 两类写法：
   *   D1 两段模式都命中、六条闸门却没全过（范围相同 / 顺序相反 / 比例没槽位 …）；
   *   D2/D3 末段带**动态量或条件追加**（「造成等同于本次攻击造成总伤害18%」/「追加1次攻击」/「每降低24%…」）—— 连 B 段模式都匹配不上。
   * ★ 与实现侧**互斥**：`damageSegments` 生成成功就不再报这一条（一处缺口一条记录，且不许"修好了还记着"）。
   */
  const segGapClause = ((): string | null => {
    /**
     * ★★★ 第 254 轮：**与实现侧互斥的判据要精确到"那一段"**（不是"这条技能有没有分段"）。
     *   556_03 现在由形状 ③ 收下了 ⇒ 它的「追加3次攻击72%」不该再报缺口；
     *   但同一条技能里若还有**别的**读不出来的分段写法，仍然要报（不能被"有分段了"一句掩盖）。
     */
    const covered = (frag: string) => !!damageSegments && damageSegments.some((g) => String(g.clause).includes(frag.slice(0, 6)));
    const frag = (() => {
      if (!damageSegments && segA && segB) return String(segB[0]);
      const d2 = /(?:最后再|最后|然后再|然后|随后再|随后|再)[^。；]{0,10}?(?:对|攻击)(?:指定)?敌方(全体|目标)[^。；]{0,24}?(?:等同于|追加|每降低)/.exec(raw);
      if (d2 && !covered(String(d2[0]))) return String(d2[0]);
      const d3 = /敌方[^。；]{0,12}?目标[^。；]{0,6}?追加\s*\d+\s*次[^。；]{0,24}/.exec(raw);
      if (d3 && !covered(String(d3[0]))) return String(d3[0]);
      return null;
    })();
    if (frag === null) return null;
    return sentences(raw).find((t) => t.includes(frag)) ?? frag;
  })();
  /**
   * ★★★ 第 252 轮（记账侧）：**次数读成了上限**。
   *
   * 由来：`hits` 取自句子里的"次数"，而它此前是 `max(所有 2..12 的次数)` —— 于是一句
   *   「单次攻击**最多触发6次**」会把 217_03「羽刃暴风」的 4 次打成 6 次、「触发6次星爆后幻境结束」会把
   *   390_02「星罗云布」的一次施放写成 6 段、「**上限4次**」会把 286_01「风之舞」的 1+层数写成 4 段。
   * 判据（窄口径）：产物 `hits > 1` **且** 这个数恰好只出现在「最多触发N次 / 至多生效N次 / 触发N次 / 限N次」这类**上限子句**里。
   *   ★ 全库实测 **6 条**（tools/_probe-seg252e.ts）：217_03 / 286_01 / 385_02 / 390_02 / 500_02 / 572_02。
   *     其中 3 条**没有伤害产物**（385_02 / 500_02 / 572_02 ⇒ 对伤害事件数无影响，只是"次数"这个记账字段读错）；
   *     另外 3 条是**多算**：217_03 一次施放打出 30 条（原文 20 条）、286_01 打出 4 条（原文 1+层数）、
   *     390_02 打出 30 条（原文：一次施放**不造成伤害** —— 星爆是"敌方回合开始时的触发"，触发 6 次是幻境寿命）。
   *   ★★ 390_02 属于**典型对局阵容**（BLUE 神启荒），改它会动两个典型指纹 ⇒ 与"伤害基数/治疗基数"同一条处置：
   *     先记账，等一次明确裁定（见报告 §2 的待定规格）。
   */
  /**
   * ★★★ 第 254 轮：**修形状时不许把缺口藏起来** —— 本轮把 556_03 / 607_03 的伤害形状收进 damageSegments 之后，
   *   它们当场变成 `confidence: HIGH` / `unparsed: []`。可原文里还有两句引擎根本没有行为代码：
   *
   *   P 族「然后**失去50%最大生命值**」：内核有 `loseHp`（官方[21] 失去：不暴击、不被护盾吸收、不触发受伤效果），
   *     但**编译器从不产出失血槽** —— 这一句此前一条账都没有（探针 tools/_probe-m254d.ts：全库 3 条，
   *     607_01「唤羽」与 607_03「百羽衔火」静默、607_02「未熄羽」另有账）。
   *   Q 族「使除自身外的友方**初始攻击最高**的式神获得[buff]」：承受者带**选择规则**，
   *     而引擎的承受者只有 SELF / TARGET 两种 side —— 全库 9 条里 8 条静默（290_02 另有账）。
   *
   * ★ 与动词表**互不抢账**：只在动词表对这句一个字都没说时才记（一处缺口一条记录，与 lethalGuardClause 同一条规矩）。
   */
  /**
   * ★★★ 第 255 轮：**失血**（见 SkillIR.selfHpLoss 的注）—— 主动技能在这一轮真的会失去生命了。
   */
  const selfHpLoss: SkillIR["selfHpLoss"] = (() => {
    if ((Number(sk.cost) || 0) < 0) return undefined;              // 被动：执行点不在施放路径 ⇒ 交给缺口动词记账
    const m = /失去\s*(\d+(?:\.\d+)?)\s*%\s*最大生命/.exec(raw);
    if (!m) return undefined;
    const ratio = Number(m[1]);
    if (!(ratio > 0 && ratio <= 100)) return undefined;
    const clause = sentences(raw).find((t) => t.includes(String(m[0]))) ?? String(m[0]);
    return { ratio, base: "maxHp", clause };
  })();
  if (selfHpLoss) recognized.push("selfHpLoss:" + selfHpLoss.ratio + "%maxHp");

  const residualGapClauses: Array<{ verb: string; missing: string; evidence: string; clause: string }> = ((): Array<{ verb: string; missing: string; evidence: string; clause: string }> => {
    const out: Array<{ verb: string; missing: string; evidence: string; clause: string }> = [];
    const home = (re: RegExp): string | null => {
      const m = re.exec(raw);
      if (!m) return null;
      return sentences(raw).find((t) => t.includes(String(m[0]))) ?? String(m[0]);
    };
    /** ★★★ 第 255 轮：主动技能的失血**已经会执行**（SkillIR.selfHpLoss）⇒ 这一条只给被动留着（fail-closed） */
    const p = (Number(sk.cost) || 0) < 0 ? home(/失去\s*\d+(?:\.\d+)?\s*%\s*(?:最大)?生命/) : null;
    if (p) out.push({
      verb: "失血", clause: p,
      missing: "「然后失去N%最大生命值」没有行为代码：内核有 `loseHp`（官方[21] 失去 ≠ 伤害：不暴击、不被护盾吸收、不触发受伤效果），但**编译器从不产出失血槽** —— 也就是说这一句今天什么都不做",
      evidence: "第 254 轮实测（tools/_probe-m254d.ts）：全库写「失去N%生命」的 3 条里 2 条此前一条账都没有（百羽凤凰火 607_01 / 607_03，两条都写着 loss 却都记 HIGH）",
    });
    const q = home(/(?:初始)?(?:攻击|防御|速度|生命)最高[^。；]{0,10}?(?:的)?(?:友方|式神|目标)/);
    if (q) out.push({
      verb: "承受者选择规则", clause: q,
      missing: "「使…**初始攻击最高**的友方/式神获得X」里的**选择规则**没有行为代码：引擎的承受者只有 SELF / TARGET 两种 side（第 176–189 轮接的是**触发主语**那一半），不会按属性挑人 —— 于是这个状态会落到「AI 选的那个人」身上，而不是原文点名的那一个",
      evidence: "第 254 轮实测（tools/_probe-m254d.ts）：全库 9 条带属性最高限定语的写法里 8 条此前静默（218_01/218_03/324_02/370_03/387_02/556_03/578_02/585_02）",
    });
    return out;
  })();

  const hitsCapClause = ((): string | null => {
    if (!(hits > 1)) return null;
    const m = /(?:最多触发|至多生效|最多生效|触发)\s*(\d+)\s*次|限\s*(\d+)\s*次/.exec(raw);
    if (!m) return null;
    if (Number(m[1] ?? m[2]) !== hits) return null;
    return sentences(raw).find((t) => t.includes(String(m[0]))) ?? null;
  })();
  /**
   * ★★★ 第 252 轮（记账侧）：**暴击这一族的三种形状** —— 探针 tools/_probe-seg252k.ts / _probe-seg252m.ts 数出来的三条**静默缺口**
   *   （此前 confidence=HIGH/MEDIUM、unparsed 空、unmodeledMechanics 空 —— 也就是**报表说完整编译**）。
   *
   * 为什么这一轮顺手把它们记上：本轮刚把 281_03「烟之鬼」的伤害**形状**修对（damageSegments），
   *   而它同一句里还写着「前5次攻击的每次暴击，都会使最后的伤害提升30%」—— 只修形状不记这一条，
   *   报表上它就从"完整编译"变成"完整编译（形状已修）"，**比修之前更乐观**。这是本轮唯一必须一起做的事。
   * 三条判据各自**窄口径**（全库各命中 1 条，逐条列在 evidence 里）：
   *   A「每次暴击…使…伤害提升」⇒ 暴击联动（281_03）；
   *   B「受到暴击伤害时…触发」⇒ 状态自带的受击触发（324_03，效果写在 [tips_3243] 里，引擎没有"状态触发"模型）；
   *   C「每提升1%暴击伤害…非暴击伤害提升」⇒ 属性转化（392_02）。
   * ★ 三条都**只是记账**：不掷骰、不改产物、不改行为（暴击引擎里已实现，缺的是"暴击之后的联动"）。
   */
  const critGapClauses: Array<{ verb: string; missing: string; evidence: string; clause: string }> = (() => {
    const out: Array<{ verb: string; missing: string; evidence: string; clause: string }> = [];
    const home = (re: RegExp): string | null => {
      const m = re.exec(raw);
      if (!m) return null;
      return sentences(raw).find((t) => t.includes(String(m[0]))) ?? String(m[0]);
    };
    const ev = "第 252 轮实测（tools/_probe-seg252k.ts / _probe-seg252m.ts）：判据全库各命中 **1 条**，且三条此前都没有任何账（confidence=HIGH/MEDIUM、unparsed 空）";
    const a = home(/每次暴击[^。；]{0,16}使[^。；]{0,12}伤害提升/);
    if (a) out.push({ verb: "暴击联动", clause: a, evidence: ev, missing: "「每次暴击，都会使最后的伤害提升N%」没有行为代码：暴击只影响**那一次**伤害，不会回头改同一技能后续段的伤害（全库 1 条：烟烟罗「烟之鬼」281_03）" });
    const b = home(/受到暴击伤害时[^。；]{0,12}触发/);
    if (b) out.push({ verb: "受暴击触发", clause: b, evidence: ev, missing: "「[tips_N]在携带者受到暴击伤害时触发…」没有行为代码：效果写在 tips 状态里，而引擎没有「状态自带的受击触发」模型（全库 1 条：化鲸「体甲」324_03）" });
    const c = home(/每提升\s*\d+(?:\.\d+)?\s*%\s*暴击伤害[^。；]{0,24}(?:造成|提升)/);
    if (c) out.push({ verb: "暴击伤害转化", clause: c, evidence: ev, missing: "「相比基础每提升1%暴击伤害，自身造成的非暴击伤害提升1%」没有行为代码：暴击伤害属性不会改变非暴击伤害（全库 1 条：华落四时生 392_02）" });
    return out;
  })();

  // ★ 用**句子**粒度而不是子句粒度：未建模表的粒度也是句子，两边必须一致。
  //   实测踩过：跳跳哥哥「死而复生」的"棺材"在前一句，子句粒度会把后一句
  //   "复活原本位于该位置的友方…"单独判成主动复活（错），句子粒度不会。
  const reviveClauses = sentences(raw).filter(c => isActiveReviveClause(c, sk.cost));
  const revive: SkillIR["revive"] = reviveClauses.length
    ? { scope: reviveClauses.some(c => /复活[^。；\n]{0,10}?(全体|所有)/.test(c)) ? "ALL" : "ONE", clause: reviveClauses[0] }
    : null;
  if (revive) recognized.push("revive:" + revive.scope);

  /**
   * ★★★ 第 129 轮：**触发式自复活**的解析（判据与"为什么不收另外两条"见 SkillIR.selfRevive 的注）。
   *   ① 只对**被动**技能（cost < 0）—— 主动技能里的「复活」是上面那个 revive 字段的事；
   *   ② 触发词与「复活」必须在同一句；
   *   ③ 生命比例读不出来 ⇒ 不收（跳跳妹妹「会马上复活」就是这样，青蛙瓷器同理）；
   *   ④ 句子里**写了条件**（若/如果/当）而层数门槛又读不出来 ⇒ 不收（不许把条件当成不存在）。
   */
  const selfReviveHit = (Number(sk.cost) || 0) < 0
    ? sentences(raw).find(c => /(?:阵亡|死亡|被击败)时/.test(c) && /复活/.test(c) && !/棺材|晴天娃娃|小鬼/.test(c)) ?? null
    : null;
  const selfRevive: SkillIR["selfRevive"] = (() => {
    if (!selfReviveHit) return null;
    const hpM = /生命上限\s*(\d+(?:\.\d+)?)\s*%\s*的生命/.exec(selfReviveHit);
    if (!hpM) return null;                                                       // ③
    const hpPercent = Number(hpM[1]);
    if (!(hpPercent > 0 && hpPercent <= 100)) return null;
    const stackM = PASSIVE_STACK_RE.exec(selfReviveHit);
    if (/若|如果|当/.test(selfReviveHit) && !stackM) return null;                 // ④
    const castM = /施放『\[?(skill_[0-9]+_[0-9]+)\]?』|施放『([^』]{1,12})』/.exec(selfReviveHit);
    return {
      hpPercent,
      consumeStacks: /消耗[^，。；]{0,6}层数/.test(selfReviveHit),
      requireStacks: stackM ? { statusRef: stackM[2], n: Number(stackM[1]) } : null,
      castSkill: castM ? (castM[1] ?? castM[2] ?? null) : null,
      // ★ 「恢复」= 官方[20] RECOVER；「治疗」= HEAL。判据是原文自己写的那个动词
      //   （[tips_20] 解析出来正是"恢复"，与 tips 表同源 —— 这里两种写法都认）。
      channel: /复活并\s*(?:\[tips_20\]|恢复)/.test(selfReviveHit) ? "RECOVER" : "HEAL",
      clause: selfReviveHit,
    };
  })();
  if (selfRevive) recognized.push("selfRevive:" + selfRevive.hpPercent + "%" + (selfRevive.requireStacks ? "@" + selfRevive.requireStacks.n + "层" : ""));

  /**
   * ★★★ 第 130 轮：**无法被治疗 / 无法被恢复生命**。
   *   它的下游是 healTarget 的第一道闸门与 EntityCapabilities.receivesHeal（第 130 轮接线）。
   *   为什么必须在**编译层**认出来：能力位是**单位级**的，而"谁不能治疗"这件事只写在技能原文里 ——
   *   运行时没有别的办法知道（原文里既没有 [buff_N] 也没有状态名）。
   */
  /**
   * ★★★ 第 135 轮：**触发式追加施放**的解析（判据见 SkillIR.subCasts 的注）。
   */
  const subCasts: SkillIR["subCasts"] = (() => {
    const out: NonNullable<SkillIR["subCasts"]> = [];
    for (const s of sentences(raw)) {
      const m = /施放『\[?skill_([0-9]+_[0-9]+)\]?』/.exec(s);
      if (!m) continue;
      if (!/(?:阵亡|死亡|被击败)时|\[tips_7\]|先机/.test(s)) continue;   // ★ 只收这两类触发
      if (/施放『[^』]+』前/.test(s)) continue;                             // 「施放『X』前」= PRE_CAST 偷取，另有执行点
      if (/消耗减少/.test(s)) continue;                                     // 「施放『X』鬼火消耗减少1点」不是一次施放
      if (/施放『[^』]+』(?:时|后)/.test(s)) continue;                       // 「施放『X』时/后」是别的效果的触发条件
      const target = /随机敌方目标/.test(s) ? "ENEMY_RANDOM" as const
        : /自身/.test(s) ? "SELF" as const
        : /敌方目标/.test(s) ? "ENEMY_ONE" as const : null;
      if (!target) continue;                                               // 打谁读不出来 ⇒ 不收
      out.push({ ref: m[1], target, clause: s });
    }
    return out.length ? out : undefined;
  })();
  if (subCasts) recognized.push("subCast:" + subCasts.map(x => x.ref).join(","));
  /**
   * ★★★ 第 136 轮：**额外推进鬼火行动条**（判据见 SkillIR.orbGaugeAdvance 的注）。
   */
  const gaugeM = /(?:额外)?推进\s*(\d+)\s*格\s*鬼火行动条|鬼火行动条(?:额外)?推进\s*(\d+)\s*格/.exec(raw);
  const orbGaugeAdvance = (() => {
    if (!gaugeM) return undefined;
    const n = Number(gaugeM[1] ?? gaugeM[2]);
    if (!(n >= 1 && n <= 10)) return undefined;   // 越界不收（原文最大是 3 格）
    recognized.push("orbGaugeAdvance:" + n);
    return n;
  })();
  /**
   * ★★★ 第 140 轮：**叠层场地**（「花海」）的解析 —— 六条判据全部来自原文，逐条留证。
   *   任何一条缺了就整条不收（fail-closed）：收一半比不收更坏（"少算"看得见，"算错"看不见）。
   *   术语依据：官方术语表 3446「花海：彼岸花的特殊机制，在花海中的敌方单位回合前受到伤害」
   *   —— 它把**伤害时机**钉死成"敌方自己的回合"，这一条不靠猜。
   */
  const layerField = ((): LayerFieldSpec | undefined => {
    if (!/花海/.test(raw)) return undefined;
    const perLayerM = /每层花海对其造成攻击(\d+(?:\.\d+)?)%伤害/.exec(raw);
    /**
     * ★ 判据要把数字**全抽出来**，不能假设分隔符的形状：原文写的是
     *   「生命比例100%、75%、50%、25%时，花海上限为3、4、5、6层」—— **每个数字后面都跟着 %**，
     *   所以 `([\d、]+)%时` 永远匹配不上（\`%` 不是那个字符类里的成员）。
     *   第一版就是这么错的：正则写得"看起来对"，实测 null，而它只会让整条机制静默不收。
     */
    const capM = /生命比例([\d、%]+)时[，,]?\s*花海上限为([\d、%]+)层/.exec(raw);
    const decayM = /回合开始时自动减少(\d+)层花海/.exec(raw);
    const minM = /最少不低于(\d+)层/.exec(raw);
    const gainM = /生命比例每降低(\d+)%[，,]\s*获得(\d+)层花海/.exec(raw);
    const startM = /\[tips_7\][：:]\s*创造(\d+)层花海/.exec(raw);
    if (!perLayerM || !capM || !decayM || !minM || !gainM || !startM) return undefined;
    const ratios = (capM[1].match(/\d+/g) ?? []).map(Number);
    const caps = (capM[2].match(/\d+/g) ?? []).map(Number);
    if (ratios.length !== caps.length || ratios.length < 2) return undefined;
    if (ratios[0] !== 100) return undefined;                       // 原文第一个阈值必须是满血
    const thresholds = ratios.slice(1).map(r => r / 100);
    if (!thresholds.every(t => t > 0 && t < 1)) return undefined;
    const ratio = Number(perLayerM[1]) / 100;
    if (!(ratio > 0 && ratio < 5)) return undefined;
    const bandPct = Number(gainM[1]), gainN = Number(gainM[2]);
    if (!(bandPct > 0 && bandPct < 100) || !(gainN > 0)) return undefined;
    const shieldRef = /『\[skill_(\d+_\d+)\]』的\[tips_6\]/.exec(raw);
    recognized.push("layerField:" + ratio + "|cap" + caps.join("/") + "|start" + startM[1]);
    return {
      term: "花海",
      perLayerRatio: ratio,
      baseCap: caps[0],
      capThresholds: thresholds,
      minLayers: Number(minM[1]),
      decayPerTurn: Number(decayM[1]),
      startLayers: Number(startM[1]),
      grantShield: !!shieldRef,
      shield: null,
      shieldFrom: shieldRef ? shieldRef[1] : null,
      evidence: {
        term: "官方术语表 3446「花海：彼岸花的特殊机制，在花海中的敌方单位回合前受到伤害」",
        perLayer: perLayerM[0], cap: capM[0], decay: decayM[0] + "；" + minM[0], gain: gainM[0], start: startM[0],
        ...(shieldRef ? { shieldFrom: shieldRef[0] } : {}),
      },
      /**
       * ★★ 原文没写死、实现必须选一种读法的两处（如实带在产物里，界面与报告点得到）。
       *   选法一律写在这里，不许藏在代码里。
       */
      ambiguity: [
        "「回合开始时自动减少1层花海」的主语：按**拥有者自己的回合**实现（原句以「自身」开头）；另一种读法（任何单位的回合都减）会让层数掉得极快，与「花海中的敌方…在回合开始时」重复措辞矛盾",
        "生命比例**回升**时上限变小（上限跟当前比例走）⇒ 层数被夹到新上限，不额外补偿",
      ],
    };
  })();

  /**
   * ★★★ 第 140 轮：主动技能的「获得N层花海」。
   * ★ 只收**无条件**那一种：赤团华那句「生命比例每降低25%，获得1层花海及『血之花海』的护盾」
   *   是**跨档奖励**（已由 layerField 的 gain 判据覆盖），不能在这里再收一次 —— 否则每触发一次被动就白送一层。
   *   判据：子句含「获得N层花海」且**不含**「每降低」「及『」。
   */
  const grantLayers = ((): SkillIR["grantLayers"] => {
    const cls = splitClauses(raw).filter((c: string) => /获得\d+层花海/.test(c) && !/每降低|及『/.test(c));
    const baseM = cls.length ? /获得(\d+)层花海/.exec(cls[0]) : null;
    if (!baseM) return undefined;
    /**
     * ★ 「若生命比例低于50%，再获得1层花海」在**小句**层面被逗号切开（前半句没有「花海」二字），
     *   所以判据要在**句子**上做 —— 第一版在小句上找，于是无条件那部分收下了、条件那部分静默丢了
     *   （"少算"：血之花海永远只给 2 层，血量低于 50% 时少给 1 层）。
     */
    const extraSent = sentences(raw).find((s: string) => /再获得\d+层花海/.test(s)) ?? null;
    const extraM = extraSent ? /生命比例低于(\d+)%[，,]?\s*再获得(\d+)层花海/.exec(extraSent) : null;
    const base = Number(baseM[1]);
    if (!(base > 0)) return undefined;
    recognized.push("grantLayers:" + base + (extraM ? "+" + extraM[2] : ""));
    return {
      base,
      ...(extraM ? { extraIfBelow: { ratio: Number(extraM[1]) / 100, extra: Number(extraM[2]) } } : {}),
      evidence: baseM[0] + (extraM ? "；" + extraM[0] : ""),
    };
  })();

  const noHealClause = sentences(raw).find(c => /无法被治疗|无法被恢复生命|不能治疗/.test(c)) ?? null;
  const noHeal: SkillIR["noHeal"] = noHealClause ? { clause: noHealClause } : null;
  if (noHeal) recognized.push("noHeal");

  /**
   * ★★★ 第 131 轮：**替友方拦截致命伤**（KB：伊邪那美「神赐之吻」——
   *   「自身在场时，处于[buff_5572_1]的友方目标受到致命伤害将剩余1点生命
   *     （目标下回合开始前至多触发1次，被再次施加毁灭前至多累计触发3次）」）。
   *
   * 为什么它是**技能级**字段而不是被动运行时的事：这句话写在一个 cost=2 的**主动技能**里
   *   （同一个技能还在给友方施加毁灭）—— 被动运行时只收 cost<0 的技能，收不到它。
   *   与百羽凤凰火「未熄羽」的 ON_LETHAL 形态同一类：**站在场上的常驻条款**。
   *
   * ★ fail-closed 四条（与 previous 几轮同一条规矩）：
   *   ① 句子里有「受到致命伤害」+「剩余1点生命」；
   *   ② 能读出状态引用（[buff_X]）—— 拦的是**带着那个状态的**友方；
   *   ③ 写了「至多…次」时，那个数字必须读得出来（读不出来就不收 —— 不许把次数上限当成不存在）；
   *   ④ 范围必须写明是友方（「友方目标」）。
   *
   * ★ 实测全库命中 1 条（tools/_probe-allyguard131.ts）；蝉冰雪女「息吹」的同类写法
   *   （「以凝结形态占据原位置，视为已经阵亡」）**不收**：它依赖一个 KB 里没有定义的「凝结形态」
   *   （tips 表里查不到），收进来只能靠猜。
   */
  const guardClause = sentences(raw).find(c =>
    /受到致命伤害[^。]{0,40}?(?:将|会|时)?剩余1点生命/.test(c) && /友方/.test(c) && /\[buff_\d+_\d+\]/.test(c)) ?? null;
  const allyGuard: SkillIR["allyGuard"] = (() => {
    if (!guardClause) return null;
    const statusM = /\[buff_(\d+_\d+)\]/.exec(guardClause);
    if (!statusM) return null;                                                    // ②
    const perTurnM = /下回合开始前至多触发\s*(\d+)\s*次/.exec(guardClause);
    const totalM = /至多累计触发\s*(\d+)\s*次/.exec(guardClause);
    /** ③ 写了次数上限却读不出来 ⇒ 整条不收（宁可保持"未建模"） */
    if (/至多[^。]{0,12}次/.test(guardClause) && !perTurnM && !totalM) return null;
    return {
      statusRef: statusM[1],
      requireSelfOnField: /自身在场时/.test(guardClause),
      keep: "ONE" as const,
      perTurnMax: perTurnM ? Number(perTurnM[1]) : null,
      totalMax: totalM ? Number(totalM[1]) : null,
      resetOn: totalM ? ("STATUS_REAPPLY" as const) : null,
      clause: guardClause,
    };
  })();
  if (allyGuard) {
    recognized.push("allyGuard:" + allyGuard.statusRef + (allyGuard.perTurnMax ? "/每回合" + allyGuard.perTurnMax : "") + (allyGuard.totalMax ? "/累计" + allyGuard.totalMax : ""));
  }

  const heal: SkillIR["heal"] = [];
  /** ★★★ 第 188 轮：与 heal 一一对应的逐句证据（heal **没有**去重，所以直接并行 push） */
  const healHomes: string[] = [];
  for (const r of NH(raw, P.heal)) { heal.push({ ratio: r.v, base: "maxHp" }); healHomes.push(homeAt(r.at)); }
  /**
   * ★★★ 第 184 轮：治疗基数记账（见 SkillIR.healBaseMismatch 的注）。
   *   判据：治疗产物里**真有**这个 ratio，且含它的那一句写明「攻击N%」（应为 atk）或「等同…伤害N%」（动态量，引擎表达不了）。
   */
  const healBaseMismatch: NonNullable<SkillIR["healBaseMismatch"]> = [];
  {
    const clauses = sentences(raw).flatMap((s) => splitClauses(s).map((c) => c.trim())).filter((c) => /治疗|恢复|回复/.test(c));
    const healRatios = new Set<number>(heal.map((h) => h.ratio));
    for (const cl of clauses) {
      const atkM = /攻击\s*(\d+(?:\.\d+)?)\s*%/.exec(cl);
      const dynM = /(?:等同|相当于)[^，。；]{0,8}伤害\s*(\d+(?:\.\d+)?)\s*%/.exec(cl);
      const ratio = atkM ? Number(atkM[1]) : dynM ? Number(dynM[1]) : null;
      if (ratio === null || !healRatios.has(ratio)) continue;
      if (healBaseMismatch.some((x) => x.ratio === ratio)) continue;
      healBaseMismatch.push({ ratio, stated: atkM ? "atk" : "dynamic", evidence: cl });
    }
  }
  if (heal.length) recognized.push("heal:" + heal.map(h => h.ratio + "%").join(","));

  const shield: SkillIR["shield"] = [];
  /** ★★★ 第 188 轮：与 shield **一一对应**（去重前）的逐句证据 */
  const shieldHomes: string[] = [];
  const shieldSkips: SkillIR["shieldSkips"] = [];
  for (const m of raw.matchAll(P.shield)) {
    const seg = m[0];
    // ★ 误匹配过滤：「吸收时，额外对目标造成其最大生命10%的固定伤害」讲的是**造成伤害**，不是给谁套盾。
    //   判据：这一段里出现「造成/附加」就说明它是在描述伤害，不是在描述护盾。
    if (/造成|附加/.test(seg)) { shieldSkips.push({ reason: "NOT_A_SHIELD", evidence: seg }); continue; }
    const b = shieldBaseOf(seg);
    // ★★★ 第 85 轮：单次受击上限。「最多抵挡该次伤害的 40%」→ perHitRatio 0.40（只认这一种写法）
    //   ★ 必须在**整条子句**里找，不能在 `seg` 里找 —— 护盾正则匹配到「…的伤害」就停了，
    //     而「最多抵挡该次伤害的40%」写在**它后面**。第一版就是只在 seg 里找，于是 0 条命中。
    //   ★★ 粒度必须是**句子**（。级），不是小句（，级）：原文是
    //     「抵挡等同生命上限3%的伤害，**最多抵挡该次伤害的40%**」——
    //     两者被「，」隔开，所以 `splitClauses` 找不到它（第一版就是这么错的，0 条命中）。
    const clause = sentences(raw).find(s => s.includes(seg)) ?? seg;
    const perHit = RE_SHIELD_PER_HIT.exec(clause);
    const entry: SkillIR["shield"][number] = { ratio: Number(m[2]), base: b!.base, evidence: seg };
    if (perHit) {
      const r = Number(perHit[1]) / 100;
      if (r > 0 && r <= 1) entry.perHitRatio = r;
    }
    shield.push(entry);
    shieldHomes.push(homeAt((m.index ?? 0) + m[0].indexOf(m[2])));
  }
  for (const m of raw.matchAll(P.shieldTip)) {
    /**
     * ★★★ 第 185 轮：**把护盾当「被打的对象」**的写法（「额外对[tips_6]造成100%伤害」）——
     *   那是在说「打护盾打得更疼」，不是「给谁套盾」。判据：在 [tips_6] 与那个百分数之间出现「造成」。
     *   ★ 第一版没有这道闸门，于是孟婆「药汤」凭空多出一个 100% 生命上限的护盾 ——
     *     而且那个盾会跟着技能的目标走（等于给**敌方**上盾）。
     */
    if (/\[tips_6\][^%。]{0,12}造成/.test(m[0])) { shieldSkips.push({ reason: "NOT_A_SHIELD", evidence: m[0] }); continue; }
    shield.push({ ratio: Number(m[1]), base: "maxHp", evidence: "[tips_6]（未写基准 → 默认生命上限）" });
    shieldHomes.push(homeAt((m.index ?? 0) + m[0].indexOf(m[1])));
  }
  /**
   * ★★★ 第 188 轮：护盾的去重同样改成**按下标**（与 damage 同一个理由：逐句证据必须同进同出）。
   */
  const seenS = new Set<number>();
  const shieldKeepIdx: number[] = [];
  shield.forEach((s, i) => { if (seenS.has(s.ratio)) return; seenS.add(s.ratio); shieldKeepIdx.push(i); });
  const shieldD = shieldKeepIdx.map((i) => shield[i]);
  /** 与 shieldD 一一对应的逐句证据 */
  const shieldDHomes = shieldKeepIdx.map((i) => shieldHomes[i]);
  if (shieldD.length) recognized.push("shield:" + shieldD.map(s => s.ratio + "%").join(","));

  /**
   * ★★★ 第 93 轮：吸血。判据与假命中见 SkillIR.lifesteal 的注释。
   * 三档处置，**都要留痕**：
   *   ① 收：百分号紧贴「吸血」，且所在**句子**没有未建模的形态/结界分支；
   *   ② 跳过（BRANCH_CONDITION）：比例只在「若开启封印结界…」「驭魂形态下…」这类分支里生效 ——
   *      挂上去会让它**无条件**生效，那是"多算"，比不收更坏；
   *   ③ 跳过（NOT_A_LIFESTEAL）：看着像吸血其实不是（式神名、抑制声明）。
   * 留痕的意义：这 11 处必须能被逐条解释，而不是"解析器没抓到"。
   */
  /**
   * ★★★ 第 95 轮：反击。判据见 SkillIR.counter 的注释（正面三种写法 + 两类假命中）。
   */
  const counterSkips: SkillIR["counterSkips"] = [];
  let counter: SkillIR["counter"] = undefined;   // ★ 与"只有非默认值才写出来"一致：没有就是 undefined
  {
    for (const sentence of sentences(raw)) {
      for (const clause of splitClauses(sentence)) {
        if (!clause.includes("反击")) continue;
        if (/若非进行反击|不会进行反击|无法进行反击|不再进行反击|不可反击/.test(clause)) {
          counterSkips.push({ reason: "SUPPRESSION", evidence: clause });
          continue;
        }
        // 定语用法：受反击/被反击/反击后/反击目标/反击效果/…的反击 —— 这些都在说别人的反击
        if (/受反击|被反击|反击后|反击目标|反击效果|的反击/.test(clause)) {
          counterSkips.push({ reason: "NOT_A_COUNTER", evidence: clause });
          continue;
        }
        if (!/进行反击|概率[^。；]{0,8}反击|反击敌方|反击伤害来源|反击攻击来源|反击来源|则反击|会反击|能反击|反击[（(]/.test(clause)) {
          counterSkips.push({ reason: "NOT_A_COUNTER", evidence: clause });
          continue;
        }
        // 概率：只认**同一个小句**里的「有N%概率…反击」（中间不许有「，」——
        // 否则「有50%概率造成伤害，并对其进行反击」里的 50% 会被算到反击头上，那是多算）。
        // ★ 窗口从 10 放宽到 24：犬夜叉「有10%概率（每层风劲额外提升16%）对其进行反击」
        //   中间隔着一个括号说明，10 个字符抓不到 —— 实测漏收，概率被当成"必定反击"。
        const m = sentence.match(/有\s*(\d+(?:\.\d+)?)\s*%\s*(?:基础)?概率[^。；，]{0,24}?反击/);
        counter = { chance: m ? Number(m[1]) / 100 : null, evidence: clause };
        break;
      }
      if (counter) break;
    }
    if (counter) recognized.push("counter:" + (counter.chance === null ? "ALWAYS" : counter.chance));
  }

  const lifestealSkips: SkillIR["lifestealSkips"] = [];
  let lifesteal: SkillIR["lifesteal"] = null;
  {
    const ratios: Array<{ ratio: number; clause: string }> = [];
    for (const sentence of sentences(raw)) {
      for (const clause of splitClauses(sentence)) {
        if (!clause.includes("吸血")) continue;
        const m = /(\d+(?:\.\d+)?)%\s*(?:的)?吸血/.exec(clause);
        if (!m) { lifestealSkips.push({ reason: "NOT_A_LIFESTEAL", evidence: clause }); continue; }
        // ★ 分支判定看**整句**：比例写在分支里，子句本身看不出条件（"15%吸血"孤零零的）
        if (/形态下|结界|若[^。]{0,24}则|使用普攻或单体技能时/.test(sentence)) {
          lifestealSkips.push({ reason: "BRANCH_CONDITION", evidence: clause });
          continue;
        }
        ratios.push({ ratio: Number(m[1]) / 100, clause });
      }
    }
    const distinct = [...new Set(ratios.map(r => r.ratio))];
    if (distinct.length > 1) {
      // 一个技能两个不同比例：**不猜**（全库实测 0 例，tests/g54 把这条钉住）。
      // 取第一个是猜，所以整条不收，并写明是哪两句。
      for (const r of ratios) lifestealSkips.push({ reason: "AMBIGUOUS", evidence: r.clause });
    } else if (ratios.length) {
      lifesteal = { ratio: ratios[0].ratio, evidence: ratios[0].clause };
      recognized.push("lifesteal:" + (lifesteal.ratio * 100) + "%");
    }
  }

  const timeline: SkillIR["timeline"] = [];
  /** ★★★ 第 188 轮：与 timeline 一一对应的逐句证据（timeline **没有**去重，直接并行 push） */
  const timelineHomes: string[] = [];
  for (const r of NH(raw, P.pull)) { timeline.push({ percent: r.v / 100, direction: "pull" }); timelineHomes.push(homeAt(r.at)); }
  for (const r of NH(raw, P.push)) { timeline.push({ percent: r.v / 100, direction: "push" }); timelineHomes.push(homeAt(r.at)); }
  if (timeline.length) recognized.push("timeline:" + timeline.length);

  const gain = N(raw, P.orbGain).concat(N(raw, P.orbAny));
  const orb = { gain: gain.length ? gain[0] : 0, cost: Number(sk.cost) || 0 };
  if (gain.length) recognized.push("orbGain:" + orb.gain);

  const statusRefs = M(raw, P.buff).map(m => m[1]);
  const tipRefs = M(raw, P.tips).map(m => Number(m[1]));
  /**
   * ★★★ 第 180 轮：**状态引用的逐句证据**（见 SkillIR.statusRefClauses 的注）。
   *   判据：同一小句里出现 `[buff_x]` ⇒ 这个引用属于这一句。**只在同一个 ref 跨 ≥2 子句时**写出这个键 ——
   *   那正是"触发一句会把另一句的效果也算上"的多算风险；一个 ref 只在一句里出现的技能，行为本来就对，不必多记。
   */
  const statusRefClauses: string[] | null = (() => {
    /**
     * ★★★ 第 181 轮：**细化到槽位**（上一轮记的是"这个 ref 出现在哪些子句里"，同一个 ref 的多个槽位共享同一份清单，
     *   收窄时分不开）。现在**每个槽位 ← 它自己所在的那一句**：按子句顺序把每个子句里的 buff 引用依次展开 ——
     *   这个顺序与 M(raw, P.buff) 的匹配顺序一致（同一遍扫描）。对不上就**不写**（fail-closed）。
     */
    const clauses = sentences(raw).flatMap((s) => splitClauses(s).map((c) => c.trim())).filter((c) => /\[buff_\d+_\d+\]/.test(c));
    const slots: string[] = [];
    for (const c of clauses) for (const _m of c.matchAll(/\[buff_(\d+_\d+)\]/g)) slots.push(c);
    if (slots.length !== statusRefs.length) return null;
    const homes = new Map<string, Set<string>>();
    statusRefs.forEach((r, i) => { if (!homes.has(r)) homes.set(r, new Set()); homes.get(r)!.add(slots[i]); });
    if (![...homes.values()].some((s) => s.size > 1)) return null;
    return slots;
  })();
  /**
   * ★★★ 第 181 轮：**只当条件**的槽位（「若拥有4层[buff_x]」这种写法里的那个引用）。
   *   它进 statusRefs 是因为编译器收的是"文本里出现的所有引用"，但**它不是效果** ——
   *   触发时把它当效果施加，就是把"检查条件"执行成"再给一层"（多算）。
   *   判据复用 kernel/triggers.ts 的 PASSIVE_STACK_RE（层数门槛正则**只有一份**，第 129 轮立的规矩）。
   */
  const statusRefConditionOnly: number[] | null = (() => {
    if (!statusRefClauses) return null;
    const out: number[] = [];
    statusRefClauses.forEach((c, i) => {
      /**
       * ★★★ 第 193 轮：条件写法**不止「若拥有N层」那一种**。
       *   第 181 轮只认 PASSIVE_STACK_RE，于是「若自身未拥有[buff_x]」「若敌方存在[buff_x]目标」
       *   「若目标带有3层[buff_x]」这类**检查**被执行成了**再给一层**（多算）—— 实测 15 个技能命中。
       *   判据收在 kernel/triggers.ts 的 refIsConditionOnly（唯一实现，两条正则只有一份）。
       */
      if (PASSIVE_STACK_RE.test(c) || refIsConditionOnly(c, statusRefs[i])) out.push(i);
    });
    return out.length ? out : null;
  })();
  /**
   * ★★★ 第 188 轮：**四个效果字段的逐句证据**（见 SkillIR.effectClauses 的注）。
   *
   * 口径（两条都要满足才写）：
   *   ① 这条技能是**被动**（cost<0）—— 只有"触发一句、执行整门技能"那条路会读它；
   *   ② 这一族非空，**且每个槽位都定位到了小句**（有一个定位不到 ⇒ **整族不写**：
   *      半份证据比没有证据更坏，收窄时会漏掉真正该发生的那一份）。
   * ★ 数组与 IR 里同名数组**一一对应**，顺序也一致（damage 用去重后的 dedupHomes、shield 用 shieldD 的那一份）。
   */
  const effectClauses: NonNullable<SkillIR["effectClauses"]> = {};
  if ((Number(sk.cost) || 0) < 0) {
    const put = (k: "damage" | "heal" | "shield" | "timeline", homes: string[]): void => {
      if (!homes.length || !homes.every((h) => !!h)) return;
      effectClauses[k] = homes;
    };
    put("damage", dedupHomes);
    put("heal", healHomes);
    put("shield", shieldDHomes);
    put("timeline", timelineHomes);
  }
  const effectClausesOut: SkillIR["effectClauses"] | null = Object.keys(effectClauses).length ? effectClauses : null;
  /**
   * ★★★ 第 186 轮：**名字形态的状态引用**（见 SkillIR.statusRefNameForm 的注）。
   *   表由入口显式设置（compile/buff-names.ts 的单例）；没设置就是空表 ⇒ **不解析**（fail-closed，绝不猜）。
   */
  const statusRefNameForm: NonNullable<SkillIR["statusRefNameForm"]> = [];
  {
    const table = buffNames();
    if (table.size) {
      const have = new Set(statusRefs);
      /** 名字左边的合法上下文：句首 / 非汉字 / 量词（「增加1层**雄姿英发**」的「层」也在这一档） */
      const LEFT_OK = /(?:^|[^\u4e00-\u9fff]|[层个点枚名道张株次种只把颗滴重])$/;
      for (const s of sentences(raw)) for (const cl of splitClauses(s).map((c) => c.trim())) {
        if (cl.includes("[buff_")) continue;                  // 方括号形态已经收过
        if (!/\d/.test(cl) || !/获得|附加|施加|增加|提升|赋予/.test(cl)) continue;
        for (const [name, ids] of table) {
          if (name.length < 2 || !cl.includes(name)) continue;
          if (!LEFT_OK.test(cl.slice(0, cl.indexOf(name)))) continue;
          const fresh = ids.filter((id) => !have.has(id));
          if (fresh.length !== 1) continue;                   // 已经有 / 多候选 ⇒ 不猜
          if (statusRefNameForm.some((x) => x.ref === fresh[0] && x.clause === cl)) continue;
          statusRefNameForm.push({ ref: fresh[0], name, clause: cl });
        }
      }
    }
  }
  /**
   * ★★★ 第 194 轮：**「随机增益 / 随机减益」池子**（见 kernel/random-pool.ts 与 SkillIR.randomStatuses 的注）。
   *
   * 由来：匣中少女「溢彩」287_02「受到攻击时，有100%[基础概率]为攻击者附加1个[随机减益]效果，持续1回合」——
   *   它**没有** `[buff_x]` 引用，编译器认不出该附加什么，于是整条不落地（fail-closed 的正确处置，
   *   但数据其实在 `data/kb/tips.json` 第 200/201 条里：五条属性改动、数值、单位俱全）。
   *
   * 判据（逐**句**而不是逐小句 —— 时长与量词天然跨小句，与 statusDurations 同一条理由）：
   *   ① 句子里有 `[tips_N]`，N 的**名字**带「增益」/「减益」，且 desc 能解析出 ≥2 条（parseRandomPool）；
   *   ② 句子里有「给」的动词（获得/附加/施加/增加/提升/赋予）—— 与名字形态 statusRefNameForm 同一条；
   *   ③ 句子里写明「持续N回合」且**恰好一处**（读不出来 ⇒ 不猜时长，整条不落，并记 randomStatusSkips）；
   *   ④ 引用所在那一小句里概率**至多一处**（0 处 = 必定；≥2 处 = 分不清管谁 ⇒ 不落）。
   * ★ 承受者：那一小句点名「攻击者/伤害来源/攻击来源」⇒ DAMAGE_SOURCE（与 sourceBearerRefs 同一条判据），否则 EFFECT_TARGET。
   * ★ 「N个」只认**紧贴在引用前面**的那个量词；没写 = 1（与状态那一段的层数口径一致）。
   * ★ 概率按第 194 轮的新读法（先把「基础概率」占位符换回来），否则 `100%[tips_2]` 会被读成「没写概率」。
   */
  const randomStatuses: NonNullable<SkillIR["randomStatuses"]> = [];
  const randomStatusSkips: NonNullable<SkillIR["randomStatusSkips"]> = [];
  {
    const table = tipsTable();
    if (table.size) {
      const COUNT_BEFORE = /(\d+)\s*个\s*$/;
      const APPLY = /获得|附加|施加|增加|提升|赋予/;
      const SOURCE = /伤害来源|攻击者|攻击来源/;
      for (const s of sentences(raw)) {
        const clues = splitClauses(s);
        for (const m of M(s, P.tips)) {
          const tip = table.get(m[1]);
          if (!tip) continue;                      // 落空的占位符由 resolveTips 记账，这里不重复
          const pool = parseRandomPool(tip.name, tip.desc);
          if (!pool) continue;                     // 名字里没有「增益/减益」⇒ 不是池子，交给别的机制
          /** ★ 理由码的类型就用 IR 声明的那一份（union 只写一次 —— 否则 vue-tsc 会说 string 不可赋给它） */
          const skip = (reason: NonNullable<SkillIR["randomStatusSkips"]>[number]["reason"]): void => {
            if (!randomStatusSkips.some((y) => y.ref === "tips_" + m[1] && y.clause === s && y.reason === reason)) {
              randomStatusSkips.push({ ref: "tips_" + m[1], name: tip.name, clause: s, reason });
            }
          };
          if (!APPLY.test(s)) { skip("NO_APPLY_VERB"); continue; }
          const durs = N(s, P.dur);
          if (durs.length !== 1) { skip("DURATION_NOT_UNIQUE"); continue; }
          const cl = clues.find((c) => c.includes("[tips_" + m[1] + "]")) ?? s;
          const probs = N(resolveTipsMatching(cl, table, (t) => /概率/.test(t.name)), P.prob);
          if (probs.length > 1) { skip("PROBABILITY_NOT_UNIQUE"); continue; }
          const rs = resolveTipsMatching(s, table, (t) => /概率/.test(t.name));
          const at = rs.indexOf("[" + tip.name + "]");
          const cm = at > 0 ? COUNT_BEFORE.exec(rs.slice(0, at)) : null;
          if (randomStatuses.some((e) => e.name === tip.name && e.clause === rs)) continue;
          randomStatuses.push({
            kind: pool.kind, name: tip.name, count: cm ? Number(cm[1]) : 1, duration: durs[0],
            bearer: SOURCE.test(cl) ? "DAMAGE_SOURCE" : "EFFECT_TARGET",
            probability: probs.length ? probs[0] : null,
            entries: pool.entries.map((e) => ({ prop: e.prop, mode: e.mode, value: e.value, label: e.label })),
            clause: rs, evidence: pool.evidence,
          });
        }
      }
    }
  }
  if (randomStatuses.length) recognized.push("randomPool:" + randomStatuses.length);
  /**
   * ★★★ 第 195 轮：**占位符形态的控制效果**（见 SkillIR.controlRefs 的注）。
   *   判据四条 + 八种理由码；概率取**紧贴引用的那一个**（妖琴师那句里有两个 20%）。
   *   ★ 位置一律在**解析后**的小句里算（占位符长度会变，拿原文下标去比对会错位）。
   */
  const controlRefs: NonNullable<SkillIR["controlRefs"]> = [];
  const controlSkips: NonNullable<SkillIR["controlSkips"]> = [];
  {
    const table = tipsTable();
    if (table.size) {
      /** ★ 施加标记：「使其/将其/使…（≤6字）/将…/对…/为…/施加/附加/陷入/让…/并」。★「驱使」那种是另一个动词，由下面的否定窗口挡下 */
      const APPLY_BEFORE = /(?:使其|将其|使[^，。；]{0,6}|将[^，。；]{0,6}|对[^，。；]{0,6}|为[^，。；]{0,6}|施加|附加|陷入|让[^，。；]{0,4}|并)\s*$/;
      /** ★ 「触发」「结束」不在这里：它们是**时机**词，判据交给下面的施加标记（「触发格挡时沉默攻击者」是真施加） */
      const REJECT_BEFORE = /被|免疫|抵抗|抵挡|无法|不可|不会|驱散|带有|驱使|受到|进入/;
      const REFERENCE_AFTER = /^(?:的|时|状态|效果|目标|回合数|消失|普攻者|会)/;
      const BRANCH = /改为|转化为|转为|则结束/;
      const RANDOM_ONE_OF = /随机附加以下一种|其中之一|随机一种|以下一种/;
      const FIELD_DONE = /回合结束[^。；]{0,24}被施加/;
      const DUR_RE = /(\d+)\s*个?\s*回合/g;
      for (const s of sentences(raw)) {
        for (const cl of splitClauses(s)) {
          for (const m of M(cl, P.tips)) {
            const tip = table.get(m[1]);
            if (!tip) continue;
            const def = controlDefByTipName(tip.name);
            if (!def) continue;                 // 不是控制类占位符 ⇒ 交给别的机制
            const skip = (reason: NonNullable<SkillIR["controlSkips"]>[number]["reason"]): void => {
              if (!controlSkips.some((y) => y.tipId === m[1] && y.clause === cl && y.reason === reason)) {
                controlSkips.push({ tipId: m[1], name: tip.name, clause: cl, reason });
              }
            };
            const rs = resolveTipsMatching(cl, table, (t) => /概率/.test(t.name) || !!controlDefByTipName(t.name));
            const at = rs.indexOf("[" + tip.name + "]");
            if (at < 0) { skip("NO_APPLY_VERB"); continue; }
            const before = rs.slice(Math.max(0, at - 22), at).replace(/\[[^\]]*\]/g, "");
            const after = rs.slice(at + tip.name.length + 2);
            if (FIELD_DONE.test(cl)) { skip("FIELD_PER_TURN"); continue; }
            if (RANDOM_ONE_OF.test(s)) { skip("RANDOM_ONE_OF"); continue; }
            if (BRANCH.test(cl)) { skip("CONDITIONAL_BRANCH"); continue; }
            if (REFERENCE_AFTER.test(after)) { skip("REFERENCE_FORM"); continue; }
            /**
             * ★ 引用**后面紧跟一个对象名词**（攻击者/来源/目标/敌方/友方）⇒ 它是被施加的那个对象。
             *   这一条是实测逼出来的：「触发格挡时[tips_104]攻击者1回合」（天剑韧心鬼切「真剑·韧心」）——
             *   引用前面只有一个时机词，按"前面要有施加动词"判会把它整条丢掉（少算）。
             */
            const objectAfter = /^(?:攻击者|攻击来源|伤害来源|目标|敌方|友方|全体)/.test(after);
            /**
             * ★ 否定/引用标记只看**紧贴引用的 10 个字**，而施加标记可以回溯 22 个字。
             *   这一条是被实测逼出来的：「若**被**击退至末端则有100%[tips_2]使其[tips_108]1回合」（小鹿男「鹿角冲撞」）——
             *   那个「被」属于**条件**（被击退），不属于这个控制效果；窗口一样宽就会把它整条丢掉（少算）。
             */
            const near10 = rs.slice(Math.max(0, at - 10), at).replace(/\[[^\]]*\]/g, "");
            if (REJECT_BEFORE.test(near10)) { skip("NEGATED_OR_REFERENCE"); continue; }
            if (!objectAfter && !APPLY_BEFORE.test(before)) { skip("NO_APPLY_VERB"); continue; }
            const probHits = M(rs, P.prob);
            const near = probHits.filter((p) => at - ((p.index ?? 0) + p[0].length) <= 10);
            if (near.length > 1 || (near.length === 0 && probHits.length > 1)) { skip("AMBIGUOUS_PROBABILITY"); continue; }
            const probability = near.length === 1 ? Number(near[0][1]) : probHits.length === 1 ? Number(probHits[0][1]) : null;
            /**
             * ★ 时长：先在小句里读；小句没写就看**整句**（「持续1回合」常与效果不在同一小句 ——
             *   与 statusDurations 同一条理由）。两处都读不出 = null（运行时按 1 回合），多处 = 不猜。
             */
            const durs = M(cl, DUR_RE);
            const dursInSentence = durs.length ? durs : M(s, DUR_RE);
            if (dursInSentence.length > 1) { skip("AMBIGUOUS_DURATION"); continue; }
            const duration = dursInSentence.length === 1 ? Number(dursInSentence[0][1]) : null;
            if (controlRefs.some((e) => e.ref === def.id && e.clause === cl)) continue;
            controlRefs.push({
              ref: def.id, tipId: m[1], name: tip.name, duration, probability,
              bearer: /伤害来源|攻击者|攻击来源/.test(cl) ? "DAMAGE_SOURCE" : "EFFECT_TARGET",
              clause: cl,
            });
          }
        }
      }
    }
  }
  /**
   * ★★★ 第 242 轮：**分支转化 ⇒ 效果位变体**（§175.2 的形状 ②/③；把两条 CONDITIONAL_BRANCH 收成"已建模"）。
   *   形状：「（再次）攻击(被)[X]的目标时，(有N%概率)转化为/转为/改为[Y]」——
   *   X 是**条件**（目标已带的状态）、Y 是**变体**（命中后替换这一位的状态）。
   *   为什么必须"改写"：雪女那一句若读成"再加一个深度冰冻"，目标会同时挂冰冻与深度冰冻 —— 那是**多算**。
   *   fail-closed 三条：① 条件与变体都要解析成 CONTROL_EFFECTS 里的状态；② 必须找得到**可改写的基础效果位**（`ref` 相同）；
   *   ③ 一个槽位只收一个变体（重复出现 ⇒ 后面的不收）。
   */
  {
    const table = tipsTable();
    if (table.size) {
      const VARIANT = /(?:再次)?攻击(?:被)?(?:\[([^\]]+)\]|([\u4e00-\u9fa5]{2,6}))(?:的)?目标时[^。；]{0,12}?(?:有\s*(\d+(?:\.\d+)?)\s*%\s*(?:\[[^\]]*\]|概率)?\s*)?(?:转化为|转为|改为)\s*\[([^\]]+)\]/;
      for (const s of sentences(raw)) {
        {
          /**
           * ★★ 实测（第 242 轮第一版踩的坑）：条件句与转化句**被逗号切成两个小句** ——
           *   「再次攻击被[冰冻]的目标时」/「有30%概率转化为[深度冰冻]」各是一个 `splitClauses` 的结果，
           *   所以判据必须挂在**整句**上（按小句匹配 ⇒ 一条都收不到，而 census 因为这两条技能本来就在"变化集"里，
           *   **数字看不出来**：变化 393 与上一轮一模一样）。
           */
          const rs = resolveTipsMatching(s, table, (t) => /概率/.test(t.name) || !!controlDefByTipName(t.name));
          const m = VARIANT.exec(rs);
          if (!m) continue;
          const condName = String(m[1] ?? m[2] ?? "").trim();
          const targetName = String(m[4]).trim();
          const condDef = controlDefByTipName(condName);
          const targetDef = controlDefByTipName(targetName);
          if (!condDef || !targetDef) continue;                        // ① 任一端认不出 ⇒ 一个字不写
          const base = controlRefs.find((e) => e.ref === condDef.id);
          if (!base) continue;                                         // ② 没有可改写的基础位 ⇒ 不写（宁可少算）
          if (base.variant) continue;                                  // ③ 一个槽位只收一个变体
          base.variant = {
            when: { kind: "TARGET_HAS", statusId: condDef.id },
            probability: m[3] === undefined ? null : Number(m[3]),
            ref: targetDef.id, name: targetDef.name, evidence: s,
          };
          /** 变体落地 ⇒ 收掉"转化目标"那一条 CONDITIONAL_BRANCH 记账；**条件那一侧**的跳过照旧保留（那是引用形态） */
          for (let i = controlSkips.length - 1; i >= 0; i--) {
            const sk = controlSkips[i];
            const sameId = controlDefByTipName(sk.name)?.id === targetDef.id;
            if (sk.reason === "CONDITIONAL_BRANCH" && (sk.name === targetName || sameId)) controlSkips.splice(i, 1);
          }
          recognized.push("variant:" + condDef.name + "→" + targetDef.name);
        }
      }
    }
  }
  if (controlRefs.length) recognized.push("controls:" + controlRefs.length);
  /**
   * ★★★ 第 239 轮：**计数器 → 满层免消耗施放**（见 SkillIR.counterCast 的注；第 237/238 轮已备好 free 通路与合成状态）。
   */
  const counterCast: SkillIR["counterCast"] = (() => {
    const inc = /有\s*(\d+)\s*%\s*概率\s*睁开\s*(?:一|[1１])\s*只\s*([^，。；]{1,6})/.exec(raw);
    const act = /当\s*睁开\s*(\d+)\s*只\s*([^，。；]{1,6}?)\s*时[^。；]{0,12}?(免消耗)?\s*施放\s*『\[skill_(\d+_\d+)\]』/.exec(raw);
    if (!inc || !act) return undefined;
    if (String(inc[2]).trim() !== String(act[2]).trim()) return undefined;   // 计数器名字必须一致（不许张冠李戴）
    const threshold = Number(act[1]);
    if (!(threshold > 0)) return undefined;
    return {
      name: String(inc[2]).trim(), perEvent: 1, threshold,
      probability: inc[1] === undefined ? null : Number(inc[1]),
      skillRef: String(act[4]), free: !!act[3],
      reset: /闭上所有|清空|移除所有/.test(raw),
      clause: sentences(raw).find((x) => /睁开/.test(x)) ?? "",
    };
  })();
  if (counterCast) recognized.push("counterCast:" + counterCast.name + "x" + counterCast.threshold);
  /**
   * ★★★ 第 245 轮：**「醉倒」这一类自伤状态标记**（狸猫 208_02；实测全库只此一条，见 tools/_probe-prose-status245.ts）。
   *
   * 为什么必须做：这一条此前 `sentences` 两句都写着 **PARSED**、`unparsed` 为空、`confidence: HIGH`，
   *   而实际上「醉倒」这个状态**不存在**、「直至下回合醒来并治疗生命上限6%」的治疗**一处都没读出来**（`heal: []`）——
   *   也就是**编译率冒充了真实性**（目标 ① 明确禁止的那件事）。
   * 判据（三段都要读到，任一段读不出 ⇒ 这个键一个字都不写、保持原来的记账）：
   *   ① 「回合结束时…有N%概率X」→ chance / name；② 「直至下回合醒来并(治疗)生命上限M%的生命」→ healRatio；
   *   ③ 「X时若被攻击…有K%概率被吵醒，并为攻击者附上S层[buff_y]，上限C层」→ wakeChance / wakeBuffRef / wakeBuffCap；
   *   且 ① 与 ③ 的 X **必须同名**（不许张冠李戴）。
   */
  const drunk: SkillIR["drunk"] = (() => {
    const rs = resolveTipsMatching(raw, tipsTable(), (t) => /概率|治疗/.test(t.name));
    const apply = /回合结束时[^。；]{0,12}?有\s*(\d+(?:\.\d+)?)\s*%\s*概率\s*([\u4e00-\u9fa5]{2,4})/.exec(rs);
    const heal = /直至下回合醒来并(?:\[[^\]]*\]|治疗)\s*生命上限\s*(\d+(?:\.\d+)?)\s*%/.exec(rs);
    const wake = /([\u4e00-\u9fa5]{2,4})时若被攻击[^。；]{0,10}?有\s*(\d+(?:\.\d+)?)\s*%\s*概率被吵醒[^。；]{0,24}?为攻击者附上\s*(\d+)\s*层\[(?:buff_)?([0-9_]+)\][^。；]{0,16}?上限\s*(\d+)\s*层/.exec(rs);
    if (!apply || !heal || !wake) return undefined;
    if (String(apply[2]) !== String(wake[1])) return undefined;
    return {
      name: String(apply[2]), chance: Number(apply[1]), healRatio: Number(heal[1]), healBase: "maxHp",
      wakeChance: Number(wake[2]), wakeBuffRef: String(wake[4]), wakeBuffCap: Number(wake[5]),
      clause: String(apply[0]),
    };
  })();
  if (drunk) recognized.push("drunk:" + drunk.name + "@" + drunk.chance + "%");
  /** ★★★ 第 246 轮：**「失去 X 时结束 Y」**（判据见 SkillIR.endOnLose 的注）——全库只此一条（蝉冰雪女「永冬」）。 */
  const endOnLose: SkillIR["endOnLose"] = (() => {
    const rs = resolveTipsMatching(raw, tipsTable(), (t) => !!controlDefByTipName(t.name));
    const m = /若失去\[(?:buff_)?([0-9_]+)\]则结束\[([^\]]+)\]/.exec(rs);
    if (!m) return undefined;
    const removeDef = controlDefByTipName(String(m[2]).trim());
    if (!removeDef) return undefined;
    return { watchRef: String(m[1]), removeRef: removeDef.id, removeName: removeDef.name, clause: String(m[0]) };
  })();
  /**
   * ★★★ 第 248 轮：**施放限制**的解析（判据见 SkillIR.castGate 的注）。
   *   两种写法各一条正则，都要求句子里写「无法施放」：
   *     ① 「[buff_x]存在时，无法施放此技能」⇒ SELF_HAS；
   *     ② 「敌方存在[tips_y]目标时，无法施放此技能」⇒ ENEMY_HAS（tips 落到控制状态）。
   */
  const castGate: SkillIR["castGate"] = (() => {
    const rs = resolveTipsMatching(raw, tipsTable(), (t) => !!controlDefByTipName(t.name));
    const self1 = /\[buff_([0-9_]+)\]存在时[^。；]{0,10}?无法施放/.exec(rs);
    if (self1 && (statusRefs ?? []).includes(String(self1[1]))) {
      return { when: { kind: "SELF_HAS", statusRef: String(self1[1]), statusName: String(self1[1]) }, evidence: String(self1[0]) };
    }
    const foe1 = /敌方存在\[([^\]]+)\]目标时[^。；]{0,10}?无法施放/.exec(rs);
    if (foe1) {
      const d = controlDefByTipName(String(foe1[1]).trim());
      if (d) return { when: { kind: "ENEMY_HAS", statusRef: d.id, statusName: d.name }, evidence: String(foe1[0]) };
    }
    return undefined;
  })();
  if (castGate) recognized.push("castGate:" + castGate.when.kind + ":" + castGate.when.statusRef);
  /** ★★★ 第 249 轮：**治疗溢出转护盾**（判据见 SkillIR.overflowShield 的注 —— 含「持续回合数暂不执行」那条边界） */
  const overflowShield: SkillIR["overflowShield"] = (() => {
    if (!/治疗溢出/.test(raw)) return undefined;
    const m = /若治疗溢出[^。；]{0,8}?则获得[^。；]{0,12}?能够吸收[^。；]{0,12}?生命上限\s*(\d+(?:\.\d+)?)\s*%\s*的护盾(?:[^。；]{0,10}?持续\s*(\d+)\s*回合)?/.exec(raw);
    if (!m) return undefined;
    return { ratio: Number(m[1]), base: "selfMaxHp", duration: m[2] === undefined ? null : Number(m[2]), clause: String(m[0]) };
  })();
  if (overflowShield) recognized.push("overflowShield:" + overflowShield.ratio + "%" + (overflowShield.duration === null ? "" : "/" + overflowShield.duration + "回合"));
  if (endOnLose) {
    recognized.push("endOnLose:" + endOnLose.watchRef + "→" + endOnLose.removeRef);
    /** 有执行点了 ⇒ 把「结束 Y」那条 CONDITIONAL_BRANCH 记账收掉（**条件那一侧**的引用形态照旧保留） */
    for (let i = controlSkips.length - 1; i >= 0; i--) {
      const sk = controlSkips[i];
      if (sk.reason === "CONDITIONAL_BRANCH" && controlDefByTipName(sk.name)?.id === endOnLose.removeRef) controlSkips.splice(i, 1);
    }
  }
  if (statusRefs.length) recognized.push("buffs:" + statusRefs.length);
  /**
   * ★★★ 第 176 轮：**逐句承受者归属**（见 SkillIR.sourceBearerRefs 的注）。
   *   两向都钉住：子句点名来源 + 同一小句里真有 buff 引用 ⇒ 收；缺任一条 ⇒ 一个字都不写。
   */
  const sourceBearerRefs: NonNullable<SkillIR["sourceBearerRefs"]> = [];
  for (const s of sentences(raw)) for (const clause of splitClauses(s)) {
    if (!/伤害来源|攻击者|攻击来源/.test(clause)) continue;
    for (const ref of M(clause, P.buff).map(m => m[1])) {
      if (!sourceBearerRefs.some(x => x.ref === ref && x.clause === clause)) {
        sourceBearerRefs.push({ ref, clause, bearer: "DAMAGE_SOURCE" });
      }
    }
  }
  if (sourceBearerRefs.length) recognized.push("sourceBearer:" + sourceBearerRefs.length);
  const defIgnore = N(raw, P.defIgnore);
  if (defIgnore.length) recognized.push("defIgnore:" + defIgnore.join(","));

  /**
   * ★★★ 第 194 轮：**概率的读法要先把「基础概率」这个占位符换回来**（第 71 轮「先解析、再分类」的纪律 ——
   *   它此前只落在**触发侧**（passive-runtime 先 resolveTips 再分类），效果侧一直读的是原文）。
   *   于是 KB 里 **97 处** `有30%[tips_2]附加[buff_x]` 的 30% 一处都没被读进来，
   *   状态按「原文没写概率 = 必定」施加。实测（tools/_probe-jiaotu194.ts）：
   *   椒图「水花弹」原文 30%，80 次施放命中 **80 次 = 100%**。
   * ★ 只换**名字里带「概率」**的占位符（全库只有 tips_2「基础概率」一条）：伤害/护盾/控制
   *   那些占位符一个字不动（换成名字反而会让伤害类提取器读到不该读的字）。
   */
  const probText = resolveTipsMatching(raw, tipsTable(), (t) => /概率/.test(t.name));
  /**
   * ★★★ 第 194 轮：**先摘掉「属于未建模占位符效果」的那些概率**（归因用；审计用的 probabilities 不动）。
   *
   * 由来：妖琴师「疯魔琴心」写「并有20%概率击退100%行动条以及20%[基础概率]使其[tips_103]，持续1回合」——
   *   第一个 20% 管行动条，第二个 20% 管的是 `[tips_103]` 那个**还没有槽位**的效果。
   *   第 194 轮把「%[基础概率]」这种写法读进来之后，这一句变成「2 个概率 / 1 个槽位」⇒
   *   按第 15 轮的 MULTI_PROB_MULTI_SLOT 规则**整个子句不归因** ⇒ 行动条那一条从 20% 退回必定
   *   （实测：TIMELINE_MISS 从有到无，tests/g76 当场变红）。
   *   判据：概率后面**紧跟**一个 `[tips_N]` 引用（且 N 不是「概率」类占位符）⇒ 这个概率属于那个效果，
   *   不是本子句里已建模槽位的概率。★ 只影响归因，不改 probabilities（审计仍看得见原文有几个概率）。
   */
  const probsFor = (clause: string): number[] => {
    const out: number[] = [];
    const re = new RegExp(P.prob.source, "g");
    for (const m of clause.matchAll(re)) {
      const at = (m.index ?? 0) + m[0].length;
      const tail = clause.slice(at, at + 12);
      const tm = /^\s*(?:使|对|为|将|附加|施加|获得|其)?[^，。；]{0,4}\[tips_(\d+)\]/.exec(tail);
      if (tm) {
        const t = tipsTable().get(tm[1]);
        if (t && !/概率/.test(t.name)) continue;
      }
      out.push(Number(m[1]));
    }
    return out;
  };
  const probabilities = N(probText, P.prob);
  const durations = N(raw, P.dur);
  // ★ 归因：**按句**把 N%概率 绑到同一句里的效果槽位上。
  //   不跨句归因（跨句必然猜错），一句里概率与槽位数量不等时**不猜**，交给 unparsed 报告。
  const effectProbs: SkillIR["effectProbs"] = [];
  const effectProbSkips: SkillIR["effectProbSkips"] = [];
  {
    const pullTotal = N(raw, P.pull).length;
    let statusCursor = 0, pullCursor = 0, pushCursor = 0;
    const pending: Array<{ slot: string; probability: number; evidence: string }> = [];
    /** ★ 第 194 轮：归因也读**换过概率占位符**的那份文本（否则概率读到了、归因却看不到同一句里的它）*/
    for (const s of sentences(probText)) {
      // ★ 归因粒度是**小句**（逗号），不是整句。
      //   整句归因会猜错：「并有20%概率偷取1个增益状态，然后有30%[tips_2]获得1层[buff_2081_1]」
      //   —— 20% 管的是偷取，不是那个印记。按小句切开后，第二小句里没有匹配到的概率，
      //   于是**不归因**，保持"必定施加"，并把这个歧义记进 effectProbSkips 供人工复核。
      let sentenceHasProb = false, sentenceHasSlot = false;
      for (const clause of splitClauses(s)) {
        const probs = probsFor(clause);   // ★ 第 194 轮：属于 [tips_N] 效果的那些概率不算本槽位的
        const refsHere = M(clause, P.buff).map(m => m[1]);
        const pullsHere = M(clause, P.pull).length, pushesHere = M(clause, P.push).length;
        const slots: string[] = [];
        for (let i = 0; i < refsHere.length; i++) slots.push("status:" + (statusCursor + i));
        for (let i = 0; i < pullsHere; i++) slots.push("timeline:" + (pullCursor + i));
        for (let i = 0; i < pushesHere; i++) slots.push("timeline:" + (pullTotal + pushCursor + i));
        statusCursor += refsHere.length; pullCursor += pullsHere; pushCursor += pushesHere;
        if (probs.length) sentenceHasProb = true;
        if (slots.length) sentenceHasSlot = true;
        if (!probs.length || !slots.length) continue;
        if (probs.length !== 1 && probs.length !== slots.length) {
          effectProbSkips.push({ reason: "MULTI_PROB_MULTI_SLOT", evidence: clause });
          continue;
        }
        const p = probs.length === 1 ? probs[0] : null;
        slots.forEach((slot, i) => pending.push({ slot, probability: p ?? probs[i], evidence: clause }));
      }
      if (sentenceHasProb && sentenceHasSlot && !pending.some(x => x.evidence === s)) {
        // 概率与效果在同一句、但不在同一小句 —— 记下来，不猜
        const covered = splitClauses(s).some(c => pending.some(x => x.evidence === c));
        if (!covered) effectProbSkips.push({ reason: "PROB_AND_EFFECT_IN_DIFFERENT_CLAUSE", evidence: s });
      }
    }
    effectProbs.push(...pending);
  }
  // ★ 持续回合归因：**按句**（见 statusDurations 的注释：持续时间与状态引用天然跨小句）
  const statusDurations: SkillIR["statusDurations"] = [];
  const durationSkips: SkillIR["durationSkips"] = [];
  {
    let statusCursor = 0;
    for (const s of sentences(raw)) {
      const refsHere = M(s, P.buff).map(m => m[1]);
      const dursHere = N(s, P.dur);
      const base = statusCursor;
      statusCursor += refsHere.length;
      if (!refsHere.length || !dursHere.length) continue;
      if (dursHere.length !== 1 && dursHere.length !== refsHere.length) {
        durationSkips.push({ reason: "MULTI_DURATION_MULTI_SLOT", evidence: s });
        continue;
      }
      refsHere.forEach((_r, i) => statusDurations.push({
        slot: "status:" + (base + i),
        turns: dursHere.length === 1 ? dursHere[0] : dursHere[i],
        evidence: s,
      }));
    }
  }
  // ★★★ 第 76 轮：层数归因。判据保守，只认 `<动词>N层[buff_x]` 紧邻的写法。
  const statusStacks: SkillIR["statusStacks"] = [];
  {
    for (const m of raw.matchAll(RE_STACKS)) {
      const at = m.index ?? 0;
      // 排除阈值句：「每获得40层」「达到3层」不是一次施加
      if (RE_STACK_THRESHOLD.test(raw.slice(Math.max(0, at - 3), at))) continue;
      // ★ 数字与中文数字在**同一个捕获组**里，不能直接 Number("五")（那是 NaN）。
      //   第一版就是这么写的，于是「获得五层[buff_6052_1]」（洛天依「我心共鸣」）被静默丢掉 ——
      //   合成用例「获得五层」当场把它抓了出来（39 → 40 条）。
      const stacks = /^\d+$/.test(m[2]) ? Number(m[2]) : (CN_NUM[m[2]] ?? 1);
      if (!(stacks > 1)) continue;
      // 该引用在 statusRefs 里的**全局序号**：数它前面出现过多少个 [buff_x]
      const before = raw.slice(0, at + m[1].length + m[2].length).match(P.buff)?.length ?? 0;
      const idx = (raw.slice(0, at).match(/\[buff_\d+_\d+\]/g) ?? []).length;
      void before;
      statusStacks.push({ slot: "status:" + idx, stacks, evidence: splitClauses(raw).find(cl => cl.includes(m[0])) ?? m[0] });
    }
  }

  // ★★★ 第 78 轮：层数上限归因。**只在"该子句恰好一个状态引用"时归因**，多引用不猜。
  const statusCaps: SkillIR["statusCaps"] = [];
  const statusCapSkips: SkillIR["statusCapSkips"] = [];
  {
    let cursor = 0;
    for (const s of sentences(raw)) {
      const refsHere = M(s, P.buff).map(m => m[1]);
      const base = cursor;
      cursor += refsHere.length;
      const caps = [...s.matchAll(RE_STACK_CAP)].map(m => (/^\d+$/.test(m[1]) ? Number(m[1]) : (CN_NUM[m[1]] ?? 0)));
      if (!caps.length) continue;
      // ★ 无歧义的两种情形：① 只有一个引用；② 有多个引用但**它们指向同一个状态**。
      //   （②是第 78 轮补的：少羽大天狗「幼羽」写的是「获得[buff_3153_1]，上限80层；每获得40层[buff_3153_1]」——
      //     同一句话里同一个 id 出现两次，判给谁都是同一个状态。）
      //   不同 id 却只给一个上限 = 真的分不清 → 不猜。
      const distinct = [...new Set(refsHere)];
      if (distinct.length !== 1) {
        statusCapSkips.push({ reason: "MULTI_REF_ONE_CAP", evidence: s });
        continue;
      }
      for (const max of caps) if (max > 0) statusCaps.push({ slot: "status:" + base, max, evidence: s });
    }
  }

  const targeting = [...new Set([...M(raw, P.targetAll)].map(m => m[1]).concat([...M(raw, P.targetSingle)].map(m => m[1])))];

  // ★ 驱散 / 解除：逐小句判定，只认**明确的**句式（不可驱散 / 无法被驱散 是免疫声明，不是动作）
  const purge: SkillIR["purge"] = [];
  const purgeSkips: NonNullable<SkillIR["purgeSkips"]> = [];
  for (const clause of splitClauses(raw)) {
    // ★ 排除两类：免疫声明（不可驱散 / 无法被解除），以及**被动触发条件**（「X被驱散时，为其附加Y」）。
    //   后者是"当别人驱散它的时候"的触发器，不是本技能在驱散 —— 第一版把跳跳弟弟「毒气喷泉」判成了主动驱散。
    const isDispel = /驱散/.test(clause) && !/不可驱散|无法(?:被)?驱散|不能被驱散|被驱散/.test(clause);
    /**
     * ★★★ 第 196 轮补一类假命中：「**不会自动移除**目标的沉睡」（食梦貘「沉睡」）—— 那是**关于这个状态的规则**，
     *   不是本技能在移除它。第一版只排除了「不可解除/无法被解除/被解除/被移除」，漏了这种"不会…移除"的写法；
     *   而它一旦被收进来，本轮新加的「按名驱散」还会把 count 记成 99（把"移除1个"变成"移除所有"）。
     */
    const isRemove = /解除|移除/.test(clause) && !/不可解除|无法(?:被)?解除|被解除|被移除|不会[^。；]{0,6}(?:移除|解除)|自动移除/.test(clause);
    if (!isDispel && !isRemove) continue;
    /** ★★★ 第 199 轮：**规则句 / 条件句不是动作**（全库 4 条假命中，实测 tools/_probe-qm199.ts）：
     *   晴明「言灵·缚」×2「被束缚的单位可以通过使用普通攻击打破束缚解除控制」· 入殓师「离魂」「普攻入殓师可以驱散全部[buff_3214_1]」·
     *   梦寻山兔「梦心迷兔阵！」「若自身没有[tips_3]可以驱散且未处于[tips_17]」—— 此前都被当成本技能在驱散 ⇒ 施放时凭空扒状态（多算）。
     */
    if (/可以|可通过|通过[^。；]{0,6}(?:打破|解除|驱散)|若[^。；]{0,12}(?:没有|未|不存在)/.test(clause)) {
      purgeSkips.push({ clause, reason: 'RULE_OR_CONDITION' });
      continue;
    }
    const kind = isDispel ? "DISPEL" as const : "REMOVE" as const;
    const what = /增益/.test(clause) ? "BUFF" as const : /减益/.test(clause) ? "DEBUFF" as const : "ANY" as const;
    // 对象（side）改到下面与「按名驱散」一起判：小句里没有主谓时按**整句**判 —— 见第 196 轮的注
    const all = /(?:所有|全部|全体)/.test(clause);
    const m = clause.match(/(?:驱散|解除|移除)\s*(\d+)\s*个/);
    /**
     * ★★★ 第 196 轮：**按名驱散 + 方向按整句判**（兔丸「守护之心」289_03）。
     *
     * 原文：「对随机非召唤物的**友方目标**，驱散其带有的[tips_101](冰冻)、[tips_102](沉睡)或[tips_1](解除)
     *   其带有的[tips_107](变形)、[tips_108](眩晕)和[tips_112](深度冰冻)，并增加10%行动条。」
     * 此前这一条被读成「对**敌方**驱散 1 个**任意**状态」—— 方向、范围、对象三处全错
     *   （一个"给友方解控"的技能变成了"扒敌人一个状态"）。三处修法：
     *   ① 方向：小句里没有主谓（「驱散其带有的…」），就按**整句**判（与时长归因同一条理由：跨小句）；
     *   ② 对象：小句里的 `[tips_N]` 名字能在 CONTROL_EFFECTS 里找到 ⇒ 收进 statusIds；
     *   ③ 两种动作分开：`[tips_1]`（=「解除」）**之后**的那些是 REMOVE，之前的那些是 DISPEL ——
     *      这不是猜，是数据（tips_1 的规范名就是「解除」，而变形/眩晕/深度冰冻三个恰好 dispellable=false、removable=true）。
     */
    const removeAt = ((): number => {
      const tm = M(clause, P.tips).find((x) => /解除|移除/.test(tipsTable().get(x[1])?.name ?? ""));
      if (tm && tm.index !== undefined) return tm.index;
      return clause.search(/解除|移除/);
    })();
    const namedDis: string[] = [], namedRem: string[] = [];
    for (const tm of M(clause, P.tips)) {
      const tip = tipsTable().get(tm[1]);
      const def = tip ? controlDefByTipName(tip.name) : null;
      if (!def) continue;
      const bucket = removeAt >= 0 && (tm.index ?? 0) > removeAt ? namedRem : namedDis;
      if (!bucket.includes(def.id)) bucket.push(def.id);
    }
    const sentence = sentences(raw).find((s) => s.includes(clause)) ?? clause;
    const side = /友方|我方|自身|自己/.test(clause) ? "ALLY" as const
      : /敌方|敌人/.test(clause) ? "ENEMY" as const
      : /友方|我方|自身|自己/.test(sentence) ? "ALLY" as const
      : /敌方|敌人/.test(sentence) ? "ENEMY" as const
      : (kind === "DISPEL" ? "ENEMY" as const : "ALLY" as const);
    const base = { side, what, evidence: clause };
    if (namedDis.length || namedRem.length) {
      const scope = /随机[^。；]{0,10}(?:友方|敌方)/.test(sentence) ? { scope: "RANDOM_ONE" as const } : {};
      if (namedDis.length) purge.push({ kind: "DISPEL", ...base, ...scope, statusIds: namedDis, count: 99 });
      if (namedRem.length) purge.push({ kind: "REMOVE", ...base, ...scope, statusIds: namedRem, count: 99 });
    } else {
      purge.push({ kind, ...base, count: all ? 99 : (m ? Number(m[1]) : 1) });
    }
  }

  /**
   * ★★★ 第 99 轮：属性偷取的解析。
   *
   * ★ 三类**不执行**的写法必须被挡在外面（它们仍然由未建模表报出来）：
   *   · 「造成伤害时…偷取」= **逐次伤害触发**（引擎的偷取执行点是"施放技能时"，多段技能会差很多）；
   *   · 「施放『X』前，先偷取…」= **施放前被动**（走的是被动运行时，不是主动执行点）；
   *   · （第 104 轮起「偷取1个增益状态」**已经实现**，见下面的 buffSteal 分支。）
   *   这一层挡得对不对，由 g60/g64 的双向断言锁住（真写法必须收、假写法必须不收）。
   *
   * ★★ 顺序很关键：**触发条件先判、再分属性/增益** —— 第 104 轮第一版把 buffSteal 分支放在最前面，
   *   于是「造成伤害时，偷取1个增益状态」被当成了可执行（g64 当场红）。触发时机的闸门对**两种偷取都成立**。
   */
  const steals: NonNullable<SkillIR["steals"]> = [];
  const stealSkips: NonNullable<SkillIR["stealSkips"]> = [];
  {
    const optsOf = (t: string) => {
      const out: Array<{ prop: string; ratio: number | null; flat: number | null }> = [];
      for (const m of t.matchAll(/(\d+(?:\.\d+)?)(%|点)\s*(攻击力|防御力|暴击伤害|攻击|防御|速度|暴击|生命|效果命中)/g)) {
        const prop = STEAL_PROPS[m[3]];
        if (!prop) continue;
        out.push({ prop, ratio: m[2] === "%" ? Number(m[1]) / 100 : null, flat: m[2] === "点" ? Number(m[1]) : null });
      }
      return out;
    };
    const clauses = splitClauses(raw);
    /**
     * ★★ 触发条件必须看**整句**，不能只看子句 —— 这是本轮踩到的第一个坑：
     *   「造成伤害时，偷取目标40%暴击」被 splitClauses 切成两段，
     *   于是「造成伤害时」落在**别的**子句里，逐子句检测永远看不到它，
     *   首无「冥火」的**逐次伤害触发**就被当成了"施放技能时偷取"（= 一个错的语义，而且不报错）。
     *   同型的还有噬魂的「施放『X』前，先偷取…」。
     */
    const sents = sentences(raw);
    const enclosing = (c: string) => sents.find(s => s.includes(c)) ?? c;
    let enumOpts: Array<{ prop: string; ratio: number | null; flat: number | null }> = [];
    for (const c of clauses) {
      const em = c.match(/可偷取的属性包含([^。；]+)/);
      if (em) enumOpts = optsOf(em[1]);
    }
    const hasRandomClause = clauses.some(c => /随机偷取/.test(c));
    const dmAll = raw.match(/持续\s*(\d+)\s*回合/);
    const durAll = dmAll ? Number(dmAll[1]) : 1;
    for (const c of clauses) {
      if (!/偷取/.test(c)) continue;
      const ctx = enclosing(c);
      /**
       * ★★ 触发时机的闸门**对两种偷取都成立**，所以必须在分流之前判（第一版放反了，g64 当场红）。
       * ★★★ 第 105 轮更新：「**造成伤害时**」不再跳过 —— 它由被动运行时在 AFTER_DAMAGE 上执行
       *   （首无「冥火」），带 trigger=ON_DAMAGE 进 IR；「**受到**伤害时」仍然跳过（那是挨打触发，
       *   引擎里没有对应执行点），理由换成 ON_TAKE_DAMAGE_TRIGGER，免得与前者混为一谈。
       */
      if (/受到伤害时/.test(ctx)) { stealSkips.push({ reason: "ON_TAKE_DAMAGE_TRIGGER", evidence: ctx }); continue; }
      const onDamage = /造成伤害时/.test(ctx);
      /**
       * ★★ 「同时间内只能对一个目标生效」在 KB 里**另起一句**（首无原文：
       *   「造成伤害时，偷取目标40%暴击，持续1回合。同时间内只能对一个目标生效。」）
       *   ⇒ 只看所在整句会漏掉它（第一版就是这样，g60 当场红）。要**回读整篇技能文本**。
       */
      const oneTargetOnly = /同时间内只能对一个目标生效/.test(ctx) || /同时间内只能对一个目标生效/.test(raw);
      /**
       * ★★★ 第 107 轮：「**施放『X』前**，先偷取…」（噬魂）从跳过变成解析 ——
       *   它带 trigger=PRE_CAST 与 onSkill（要偷的是"施放那个技能之前"），
       *   由被动运行时在 SKILL_START 上执行（第 107 轮接线）。
       */
      const preCast = /施放[^。；]{0,20}前/.test(ctx);
      const onSkillM = ctx.match(/\[skill_([0-9]+_[0-9]+)\]/);
      if (preCast && !onSkillM) { stealSkips.push({ reason: "PRE_CAST_NO_SKILL", evidence: ctx }); continue; }
      /**
       * ★★★ 第 108 轮：**执行点跑通了**，第 107 轮的 fail-closed 闸门撤掉。
       *   第 107 轮关掉它的理由是探针实测 STAT_STEAL × 0；本轮查明真因，并补了端到端断言（tests/g60）。
       */
      if (/永久偷取|直到回目结束/.test(ctx)) { stealSkips.push({ reason: "PERMANENT_UNTIL_ROUND_END", evidence: ctx }); continue; }
      /**
       * ★★★ 第 104 轮：**增益偷取**从"跳过"变成"解析"（放在触发闸门之后）。
       *   判据照旧只看能读出数字的写法：「偷取1个增益状态」「偷取2个减益状态」。
       *   ★ 被偷走之后**不归还**（与属性偷取相反）—— 所以它不带 duration，运行时也不建"借据"。
       */
      const bs = c.match(/偷取\s*([0-9]+)\s*个\s*(增益|减益|状态)/);
      if (bs) {
        steals.push({
          buffSteal: { count: Number(bs[1]), what: bs[2] === "增益" ? "BUFF" : bs[2] === "减益" ? "DEBUFF" : "ANY" },
          duration: 0, probability: null, side: "ENEMY" as const, evidence: c,
          ...(onDamage ? { trigger: "ON_DAMAGE" as const } : {}),
        });
        continue;
      }
      // 「偷取总值不超过…」「将偷取的攻击全部归还」是**后果**，不是第二个偷取动作
      if (/归还|总值|不超过/.test(c) && !/\d+(?:\.\d+)?(%|点)\s*(?:攻击|防御|速度|暴击|生命|效果命中)/.test(c)) continue;
      // 盗人神的枚举句只用来提供选项，别和那句「随机偷取…属性」重复产出一条
      if (hasRandomClause && /属性包含/.test(c)) continue;
      const own = optsOf(c);
      const random = /随机偷取/.test(c);
      const use = own.length ? own : ((random || /偷取[^。；]{0,8}属性/.test(c)) ? enumOpts : []);
      if (!use.length) { stealSkips.push({ reason: "NO_NUMERIC_OPTION", evidence: c }); continue; }
      const cm = c.match(/持续\s*(\d+)\s*回合/);
      const cmCtx = ctx.match(/持续\s*(\d+)\s*回合/);
      const pm = c.match(/(\d+(?:\.\d+)?)%(?:\[tips_\d+\])?[^。；]{0,4}?偷取/);
      /**
       * ★★ 「偷取**总值**不超过自身初始攻击60%」（噬魂）—— 这是**总量上限**，与"每个目标最多N次"是两把不同的尺子。
       *   上限的基准是**自身初始攻击**（不含后续加成）⇒ 运行时要读 base.atk。
       */
      const capTotalM = c.match(/偷取总值不超过[^。；]{0,24}?([0-9]+(?:\.[0-9]+)?)%/) ?? raw.match(/偷取总值不超过[^。；]{0,24}?([0-9]+(?:\.[0-9]+)?)%/);
      /**
       * ★★ 「偷取**场上全体**3%攻击力」——「场上全体」字面上包含友方，但"偷自己人"没有意义。
       *   读作**敌方全体**，并把这是**默认读法**记下来（scopeSource=DEFAULT，与 durationSource 同一条规矩）。
       */
      const victimScope = /偷取场上全体|偷取敌方全体/.test(c);
      // ★ 上限可能写在**另一句**里（盗人神：「可偷取的属性包含…，每个目标最多可偷取3次相同属性」）
      const mm = c.match(/每个目标最多可?偷取\s*(\d+)\s*次/) ?? raw.match(/每个目标最多可?偷取\s*(\d+)\s*次/);
      steals.push({
        ...(use.length === 1 ? { prop: use[0].prop, ratio: use[0].ratio, flat: use[0].flat } : { options: use }),
        ...(random ? { random: true } : {}),
        duration: cm ? Number(cm[1]) : cmCtx ? Number(cmCtx[1]) : durAll,
        // ★ 「持续N回合」写在子句里 / 写在整句里 / 哪都没写（=1）——三档要能分辨，否则"1 回合"是编的
        durationSource: cm ? "CLAUSE" : cmCtx ? "SENTENCE" : dmAll ? "SKILL" : "DEFAULT",
        probability: pm ? Number(pm[1]) / 100 : null,
        maxPerTarget: mm ? Number(mm[1]) : null,
        ...(onDamage ? { trigger: "ON_DAMAGE" as const } : {}),
        ...(preCast && onSkillM ? { trigger: "PRE_CAST" as const, onSkill: onSkillM[1] } : {}),
        ...(oneTargetOnly ? { oneTargetOnly: true } : {}),
        ...(capTotalM ? { capTotalRatio: Number(capTotalM[1]) / 100 } : {}),
        ...(victimScope ? { victimScope: "ENEMY_ALL" as const, scopeSource: "DEFAULT" as const } : {}),
        side: "ENEMY" as const, evidence: c,
      });
    }
  }

  /**
   * ★★★ 第 101 轮：自身形态类放置单位（姿态 / 化身）。
   * 判据全部来自原文：`[tips_N]姿态` 引用 + 「化身/进入/施放化身」措辞。
   * tips 的 desc 由 parseSummonSpec 判"它到底是不是一个单位"（第 98 轮的判据：生命基准 / 继承初始属性 / 胜利判定）。
   */
  const forms: FormSpec[] = [];
  const formSkips: NonNullable<SkillIR["formSkips"]> = [];
  /**
   * ★ 形态归属：`[tips_N]姿态下可施放` ⇒ 这个技能是**那个形态**的技能，不是本体的。
   *   与 forms 的判据刻意分开：两者都引用同一个 tips，但一个说「我要变成它」，另一个说「我在它之下能放」。
   */
  let formSkillOf: string | undefined;
  {
    const m = raw.match(/\[tips_([0-9]+)\]\s*姿态下/);
    if (m) formSkillOf = String(m[1]);
  }
  {
    const tips = tipsTable();
    /**
     * ★★★ 第 130 轮：**tips 子句的覆盖扫描**（第 113 轮内联在"镇压/击杀/施放"那一段，本轮抽出来共用）。
     *
     * 判据：tips 原文按 。； 切句，**带数字**又不在**字段关键词白名单**里的句子 ⇒ TIPS_CLAUSE_NOT_MODELED。
     *   · 白名单是一份**声明**（这些字段没有各自的 evidence 可对），改一处要同步改这里；
     *     第 130 轮把「至多可进入N次」加进去 —— 它现在**真的被执行**了（FormSpec.maxEntries，
     *     由 kernel/summon.ts 的 enterForm 按拥有者 notes 计数封顶）。实现了却还挡着 = 把"能做"记成"做不了"。
     *
     * 为什么要抽出来：**自身形态**（「[tips_N]姿态」）此前根本没跑过这段扫描 ⇒ 余烬 tips 里的
     *   「到达行动条终点后复活，对敌方全体附加2层[淬火]并获得2点鬼火」一句都没进账
     *   （探针 tools/_probe-onlethal130.ts 实测：未熄羽的 unmodeled 与 formSkips 都是空的），
     *   而其中"附加 2 层淬火 / 获得 2 点鬼火"**确实没有行为代码** —— 形态一接线就会被读成"全实现"。
     */
    const scanTipsClauses = (tip: { name: string; desc?: string }, spec: any) => {
      const COVERED = /生命值?[是为]|继承|免疫|无法行动|点速度|被击败|若敌方只存在|若场上只有|只可生效1次|视为战斗|不触发御魂|至多可进入/;
      const covered = [...(spec.auras ?? []).map((a: any) => a.evidence), spec.reactive?.evidence, spec.onRemove?.evidence]
        .filter(Boolean).map((x: any) => String(x).replace(/\s+/g, ""));
      for (const clause of String(spec.evidence ?? "").split(/[。；]/)) {
        if (!/[0-9]/.test(clause) || COVERED.test(clause)) continue;
        const nc = clause.replace(/\s+/g, "");
        if (covered.some((c: string) => c.includes(nc) || nc.includes(c))) continue;
        const ev = tip.name + "：" + clause;
        /**
         * ★★ 去重：同一个 tips 可能被**两段代码**扫到（自身形态那一段 + 镇压/击杀/施放那一段），
         *   不去重就会出现两条一模一样的记录（实测：猫川「洗筋伐髓」的别馆私汤被记了两遍）。
         *   一处缺口一条记录 —— 这是第 108 轮「一处实现」在**记账**上的同一条要求。
         */
        if (formSkips.some((x: any) => x.reason === "TIPS_CLAUSE_NOT_MODELED" && x.evidence === ev)) continue;
        formSkips.push({ reason: "TIPS_CLAUSE_NOT_MODELED", evidence: ev });
      }
    };
    for (const s of sentences(raw)) {
      // ① 只认「[tips_N] + 姿态」这种引用方式（这是 KB 里唯一的写法，见 g62 的普查）
      for (const m of s.matchAll(/\[tips_(\d+)\]\s*姿态/g)) {
        const id = String(m[1]);
        const tip = tips.get(id);
        if (!tip) { formSkips.push({ reason: "TIPS_MISSING", evidence: s }); continue; }
        /**
         * ★★ 两种"解析不出规格"必须分开报：**条目没有 desc**（数据在传输中丢了）与
         *   **有 desc 但不是放置单位**（数据本来就如此）。混成一个原因时，
         *   网页侧 bundle 只带 id/name 的缺口会**完全看不见**（第 101 轮实测：引擎侧 2 条形态、网页侧 0 条）。
         */
        if (!tip.desc) { formSkips.push({ reason: "TIPS_NO_DESC", evidence: tip.name + "：" + s }); continue; }
        const spec = parseSummonSpec(tip);
        if (!spec) { formSkips.push({ reason: "NOT_A_SUMMON_SPEC", evidence: tip.name + "：" + s }); continue; }
        /**
         * ② 放置方：`化身/进入` = 本体离场、形态上场（己方）。KB 里两条都写这个措辞。
         *    敌方那一类（镇压成 / 在其行动条处召唤）**刻意不收** —— 它们要各自的证据。
         */
        if (!/(?:进入|化身|施放化身)/.test(s)) { formSkips.push({ reason: "PLACEMENT_UNKNOWN", evidence: s }); continue; }
        const onLethal = /受到致命伤害/.test(s);
        // ③ 回归时机：两句原文分别写「到达行动条终点后复活」「本体重新回到场上」
        /**
         * ★★ 回归时机这句话**可能写在 tips 原文里**，而不是技能里 ——
         *   实测两条都是这样：余烬「到达行动条终点后复活」、蛇神「受到致命伤害时，本体重新回到场上」
         *   都写在 tips_N 的 desc 里。第一版只看技能文本，于是两条都被记成 DEFAULT（把证据当默认值）。
         *   ⇒ 三档来源：子句 → 技能全文 → **tips 原文**（spec.evidence 就是它）。
         */
        const tipText = spec.evidence;
        const inClause = /到达行动条终点后复活|本体重新回到场上/.test(s);
        const inSkill = /到达行动条终点后复活|本体重新回到场上/.test(raw);
        const inTips = /到达行动条终点后复活|本体重新回到场上/.test(tipText);
        const timelineEnd = /到达行动条终点后复活/.test(s) || /到达行动条终点后复活/.test(raw) || /到达行动条终点后复活/.test(tipText);
        const returnOn: "TIMELINE_END" | "SUMMON_DEATH" = timelineEnd ? "TIMELINE_END" : "SUMMON_DEATH";
        forms.push({
          tipsId: id, name: tip.name,
          trigger: onLethal ? "ON_LETHAL" : "ON_CAST",
          placement: "SELF",
          returnOn,
          returnOnSource: inClause ? "CLAUSE" : inSkill ? "SKILL" : inTips ? "TIPS" : "DEFAULT",
          spec,
        });
        /** ★ 第 130 轮：自身形态也要跑一遍 tips 子句扫描（见上面 scanTipsClauses 的注） */
        scanTipsClauses(tip, spec);
      }
    }
    /**
     * ★★★ 第 103 轮：另外两类**放置单位**（与"自身形态"共用同一个 IR 字段，取值区分开）：
     *   · **镇压式**：「…致命伤害时，将会优先被**镇压成[tips_N]**」⇒ 放**敌方**队、被击败时被镇压者以 1 点生命复活；
     *   · **击杀式**：「**击败**非召唤物敌方目标时，**在其行动条处召唤[tips_N]**」⇒ 放己方、位置 = 阵亡者原来的位置。
     *   · 还有一条同源的**施放式**：「【施放】召唤[tips_N]」（同一条 tips，只是另一种进入方式）。
     * 三类都要求 [tips_N] **紧跟在动词后面** —— 这一条把"召唤暴风雪"那种修辞用法挡在外面。
     */
    for (const s of sentences(raw)) {
      const tips2 = tipsTable();
      const push = (id: string, f: Omit<NonNullable<SkillIR["forms"]>[number], "tipsId" | "name" | "spec">) => {
        const tip = tips2.get(id);
        if (!tip) { formSkips.push({ reason: "TIPS_MISSING", evidence: s }); return; }
        if (!tip.desc) { formSkips.push({ reason: "TIPS_NO_DESC", evidence: tip.name + "：" + s }); return; }
        const spec = parseSummonSpec(tip);
        if (!spec) { formSkips.push({ reason: "NOT_A_SUMMON_SPEC", evidence: tip.name + "：" + s }); return; }
        /**
         * ★★★ 第 111 轮：**召唤物自己 tips 里的在场效果也要可见**。
         *   实测：海原贝戟（tips_3565）写着「在场时为友方单位恢复受到伤害30%的生命值」—— 那是一条**反应式**光环，
         *   本轮的光环只做静态属性修正 ⇒ 它必须留下记录，否则"召唤物上场了"会掩盖"它的效果没做"。
         */
        /**
         * ★★★ 第 113 轮：**已实现的形状不再报未建模**，剩下的一律逐句记账。
         *   · 光环：静态属性修正（auras）与**反应式**（reactive：在场时按受伤回血）都算有行为代码；
         *   · 代价：onRemove（返还鬼火 / 恢复 / 对敌方全体造成伤害）算有行为代码；
         *   · 其余「带数字但没有任何字段接住」的句子 ⇒ TIPS_CLAUSE_NOT_MODELED
         *     （海原贝戟的「潮声」叠层、别馆私汤的「固定在行动条70%」「每使用普攻6次」）。
         *   ★ 覆盖判据是**字段关键词白名单**（生命基准 / 继承 / 免疫 / 无法行动 / 速度 / 被击败 / 胜利判定…）：
         *     这些字段没有各自的 evidence 可对，白名单是一份**声明**，改一处要在这里同步改。
         */
        // ★★★ 第 130 轮：这段扫描**抽成函数**了 —— 自身形态（「[tips_N]姿态」，上面第一段）此前**没有**跑它，
        //   于是余烬 tips 里的「到达行动条终点后复活，对敌方全体附加2层[淬火]并获得2点鬼火」
        //   一句都没有进账（探针实测：未熄羽的 unmodeled 是空的、formSkips 也是空的）——
        //   而其中"附加2层淬火 / 获得2点鬼火"**确实没有行为代码**。一处实现，两处调用。
        scanTipsClauses(tip, spec);
        /**
         * ★★ 第 111 轮：**"被移除时的代价/收益"也要记**。实测明识灯写着「被移除时返还2点鬼火」——
         *   收回本身这一轮实现了，但"返还鬼火"这条**代价**没有（鬼火池的返还路径不存在）。
         *   不记的话，"收回已实现"会顺手把这半句也盖过去。
         */
        forms.push({ tipsId: id, name: tip.name, spec, ...f });
      };
      const seal = s.match(/镇压成\[tips_([0-9]+)\]/);
      if (seal) {
        push(seal[1], {
          trigger: "ON_LETHAL", placement: "ENEMY", returnOn: "SUMMON_DEATH", returnOnSource: "TIPS", seal: true,
        });
        continue;
      }
      const call = s.match(/召唤\[tips_([0-9]+)\]/);
      if (call && /击败|击杀/.test(s)) {
        push(call[1], {
          trigger: "ON_KILL", placement: "SELF", returnOn: "NONE", returnOnSource: "CLAUSE",
          atTargetPos: /行动条处/.test(s),
        });
        continue;
      }
      /**
       * ★★★ 第 110 轮：**裸的「召唤[tips_N]」也是施放式放置**。
       *
       * 第 103 轮只认「【施放】…召唤[tips_N]」这一种写法，于是「召唤[tips_3565]，接受潮汐的祝福。」
       * （千姬「海潮入梦」）、「召唤[tips_5523]…」（慧明灯「正念」）、「召唤[tips_5691]。」（猫川「洗筋伐髓」）
       * 三条**既没有产物、也没有跳过记录** —— 静默丢，是这一轮实测出来的缺口。
       * 判据仍然是「[tips_N] 紧跟在 召唤 后面」，所以"召唤暴风雪"那种修辞用法照样挡在外面。
       */
      if (call && /【施放】/.test(s)) {
        // ★ 既有写法（【施放】召唤[tips_N]）：语义保持第 103 轮定的那一种，不由这一轮改判
        push(call[1], { trigger: "ON_CAST", placement: "SELF", returnOn: "NONE", returnOnSource: "CLAUSE" });
        continue;
      }
      if (call) {
        /**
         * ★★★ 第 110 轮：**裸的「召唤[tips_N]」= 召唤物**（本体留场）。
         *   原文旁证：千姬「若海原贝戟在场，额外附加[buff_3562_1]」、猫川「[tips_5691]在场时，
         *   猫川的普攻系数翻倍」、慧明灯「回合开始时，**收回**[tips_5523]」—— 三处都要求本体还在场上。
         *
         * ★★★ 第 111 轮：同时把这条召唤物的**在场光环**与**收回**读出来（两者都只认无歧义的写法）：
         *   · 光环：`[tips_N]在场时…` 且只含静态属性修正（其余形态留在 unmodeled 里）；
         *   · 收回：`回合开始时，收回[tips_N]（并移除[buff_x]）`。
         */
        const id = call[1];
        const auraText = (String(raw).match(new RegExp("\\[tips_" + id + "\\]在场时[^。]*", "g")) ?? []).join("。");
        const parsedAura = parsePresenceAuras(auraText, "ALLY");
        const rec = new RegExp("收回\\[tips_" + id + "\\](?:并移除\\[(buff_[0-9_]+)\\])?").exec(String(raw));
        push(id, {
          trigger: "ON_CAST", placement: "SELF", returnOn: "NONE", returnOnSource: "CLAUSE", kind: "SUMMON",
          ...(parsedAura.auras.length ? { auras: parsedAura.auras } : {}),
          /**
           * ★★ 第 111 轮实测：原文写 `[buff_5522_1]`，而**运行时的状态定义 id 是 `5522_1`** ——
           *   KB 文本里的 `buff_` 是引用前缀，编译产物把它去掉了。
           *   第一版直接拿文本 id 去比对，于是"移除[buff_5522_1]"一条都没删掉（而且不报错）。
           *   ⇒ IR 里存**运行时 id**（原文留在 evidence 里，仍可回溯是哪一句）。
           */
          ...(rec ? { recall: { at: "OWNER_TURN_START" as const, ...(rec[1] ? { removeStatuses: [rec[1].replace(/^buff_/, "")] } : {}), evidence: rec[0] } } : {}),
        });
      }
    }
    // 同一形态被多句提到（复苏/回归各一句）时去重
    const seen = new Set<string>();
    for (let i = forms.length - 1; i >= 0; i--) {
      const k = forms[i].tipsId + "|" + forms[i].trigger + "|" + forms[i].returnOn;
      if (seen.has(k)) forms.splice(i, 1); else seen.add(k);
    }
  }

  /**
   * ★★★ 第 115 轮：**场地（幻境 / 结界）的解析**。
   *
   * 只收**施放式创建**：「创造/开启/展开 …存在N回合的 幻境|结界」。
   * 三种**刻意不收**（各有理由，逐条记下来，不静默）：
   *   · 「回合开始前，有30%概率创造…」（荒「星辰之境」）⇒ 触发时机是回合开始 + 带概率；
   *   · 「回合开始时，若自身未处于…开启…」（帝释天「无垢莲华」）⇒ 被动式触发；
   *   · 「若开启封印结界，则…」（御怨般若）⇒ 那是**条件**，不是创建动作。
   *
   * ★ 名字与持续时间的读法（第一版两个都读错了，见报告 §100.4）：
   *   · 名字取「幻境/结界」**前面那串汉字**（≤6 字），再剥掉开头的「的」——
   *     这样「存在2回合的幻境」「开启存在1回合的狐影结界」「创造命运星河幻境」都能整名取出；
   *   · 持续时间从**创建动词之后的那段文字**里读（`存在2回合` / `2个回合` / `2回合的`），
   *     读不到才是 DEFAULT（而不是"没匹配上就默认 1"）。
   */
  let field: SkillIR["field"] | undefined;
  {
    for (const sent of sentences(raw)) {
      /** 先确认这句**提到了场地创建**（动词后面 16 字内出现幻境/结界） */
      if (!/(?:创造|开启|展开)[^。；]{0,16}?(?:幻境|结界)/.test(sent)) continue;
      /** ★ 「若开启封印结界，则…」是**条件引用**，不是创建 —— 单独一个原因码，别和"时机不对"混 */
      if (/若[^。；]{0,8}(?:开启|展开|创造)/.test(sent)) { formSkips.push({ reason: "FIELD_CONDITION_REFERENCE", evidence: sent }); continue; }
      const vm = /(?:^|[，。；])(创造|开启|展开)/.exec(sent);
      /** ★ 动词前面不是标点（例如「有30%概率创造…」）或写着回合开始/结束 ⇒ 不是施放式创建，如实记账 */
      if (!vm || /回合开始|回合结束/.test(sent.slice(0, vm.index))) { formSkips.push({ reason: "FIELD_TRIGGER_NOT_MODELED", evidence: sent }); continue; }
      const tail = sent.slice(vm.index + vm[0].length, vm.index + vm[0].length + 24);
      /** ★ 只认「创造/开启/展开」后面**紧跟创建对象**的写法：「若开启封印结界」的「若」在这里被挡下 */
      if (/^(?:时|后|过|了)/.test(tail)) continue;
      const nameRun = /([\u4e00-\u9fa5]{0,6}?(?:幻境|结界))/.exec(tail);
      if (!nameRun) { formSkips.push({ reason: "FIELD_CREATE_UNPARSED", evidence: sent }); continue; }
      if (/回合开始|回合结束/.test(sent.slice(0, vm.index))) { formSkips.push({ reason: "FIELD_TRIGGER_NOT_MODELED", evidence: sent }); continue; }
      /** ★ 名字里若还夹着「…回合的」，取最后一个「的」之后的部分（「回合的幻境」→「幻境」） */
      const name = nameRun[1].replace(/^.*的/, "");
      const kind = /幻境/.test(name) ? "ILLUSION" as const : "BARRIER" as const;
      const durM = /(?:存在\s*)?(\d+)\s*个?\s*回合/.exec(tail);
      /** ★ 概率只在**创建动词之前**才算（「有30%概率创造…」）—— 
       *   写在后面的概率属于别的效果（辉夜姬那句「有67%概率获得1点鬼火」跟创建无关，第一版把它读成了"有67%概率开幻境"） */
      const probM = /(\d+)%(?:\[tips_\d+\])?概率/.exec(sent.slice(0, vm.index));
      /** ★ 光环：同一句里带「提升/降低」的子句（范围写在动词前的写法由本轮新增的第三种语序接住） */
      const auras = parsePresenceAuras(sent, "ALLY", /提升|降低|增加|减少/).auras;
      /**
       * ★★★ 第 124 轮：**场地里的每回合效果** —— 第一版只认这一种形状：
       *   「（在）回合开始（前|时）（有N%概率）获得M点鬼火」（辉夜姬「龙首之玉」）。
       *   ★ 概率只在这一段里读：创建动词**后面**的概率属于这个每回合效果，不属于创建 ——
       *     第 115 轮正是在这里读错过一次（报告 §100.4），所以两处各读各的、互不借用。
       *   ★ 范围：句子里出现「敌方」⇒ ENEMY，否则 ALLY（今天只有「友方全体」这一种）。
       */
      const perM = /回合开始(?:前|时)?[^。；]{0,10}?(?:有\s*(\d+)%\s*(?:\[tips_\d+\])?\s*概率[^。；]{0,6}?)?获得\s*(\d+)\s*点鬼火/.exec(sent);
      const perTurn: FieldPerTurn | undefined = perM ? {
        trigger: "TURN_START" as const,
        scope: (/敌方/.test(sent) ? "ENEMY" : "ALLY") as "ENEMY" | "ALLY",
        kind: "ORB_GAIN" as const,
        amount: Number(perM[2]),
        probability: perM[1] ? Number(perM[1]) / 100 : null,
        evidence: sent.slice(0, 160),
      } : undefined;
      /**
       * ★★★ 第 125 轮：**第二种每回合形状** —— 「…在回合结束时有N%概率被施加[tips_X]」
       *   （神酿星熊童子「饮过三巡」）。目标状态从 [tips_N] 的**规范名**映射到 CONTROL_EFFECTS 的中文名；
       *   映射不到就**不建模**并记 STATUS_NOT_MAPPED（不许假装做了）。
       *   范围：「敌我双方」⇒ ALL（今天唯一一条就是它）。
       */
      /** ★ 注意：这里**不能要求出现「概率」二字** —— 原文写的是「有40%[tips_2]被施加」，而 tips_2 本身就是「基础概率」（第 71 轮的发现） */
      const stEndM = /回合结束[^。；]{0,20}?有\s*(\d+)%\s*(?:\[tips_\d+\]|概率)?\s*[^。；]{0,8}?被施加\s*\[(tips_\d+)\]/.exec(sent);
      const stEnd: FieldPerTurn | undefined = (() => {
        if (!stEndM) return undefined;
        /** ★ tips 表的键是数据里的 id 原样（"103"），而原文写的是 "[tips_103]" —— 两种都试（第 125 轮实测：只试前者会静默落空） */
        const tip = tipsTable().get(stEndM[2]) ?? tipsTable().get(stEndM[2].replace(/^tips_/, ""));
        const def = controlDefByTipName(tip?.name ?? "") ?? undefined;   // ★ 第 195 轮：映射只写一次（kernel/status.ts）
        if (!def) { formSkips.push({ reason: "STATUS_NOT_MAPPED", evidence: sent.slice(0, 140) }); return undefined; }
        return {
          trigger: "TURN_END" as const,
          scope: /敌我双方|双方/.test(sent) ? "ALL" : /敌方/.test(sent) ? "ENEMY" : "ALLY",
          kind: "STATUS_APPLY" as const,
          statusId: def.id,
          duration: 1,
          probability: Number(stEndM[1]) / 100,
          evidence: sent.slice(0, 160),
        };
      })();
      field = {
        kind, name,
        duration: durM ? Number(durM[1]) : 1,
        durationSource: durM ? "CLAUSE" : "DEFAULT",
        probability: probM ? Number(probM[1]) / 100 : null,
        auras,
        ...((perTurn ?? stEnd) ? { perTurn: perTurn ?? stEnd } : {}),
        evidence: sent.slice(0, 160),
      };
      break;
    }
  }

  /**
   * ★★★ 第 125 轮：每回合效果**不保证与创建句同一句**。实测「饮过三巡」：
   *   创建句 = 「创造存在2回合的神饮之宴结界，期间自身免疫[混乱]」，
   *   而 40% 那句是**独立的一句**「结界中敌我双方…在回合结束时有40%[tips_2]被施加[tips_103]」。
   *   所以这一遍扫**全部句子**（同句的写法由上面那一段接住，这里只补跨句的）。
   */
  if (field && !field.perTurn) {
    for (const s2 of sentences(raw)) {
      /** 形状②：回合结束 N% 被施加 [tips_X]（神酿星熊童子「饮过三巡」） */
      const m = /回合结束[^。；]{0,24}?有\s*(\d+)%\s*(?:\[tips_\d+\]|概率)?\s*[^。；]{0,8}?被施加\s*\[(tips_\d+)\]/.exec(s2);
      if (m) {
        const tip = tipsTable().get(m[2]) ?? tipsTable().get(m[2].replace(/^tips_/, ""));
        const def = controlDefByTipName(tip?.name ?? "") ?? undefined;   // ★ 第 195 轮：同上
        if (!def) { formSkips.push({ reason: "STATUS_NOT_MAPPED", evidence: s2.slice(0, 140) }); continue; }
        field.perTurn = {
          trigger: "TURN_END",
          scope: /敌我双方|双方/.test(s2) ? "ALL" : /敌方/.test(s2) ? "ENEMY" : "ALLY",
          kind: "STATUS_APPLY",
          statusId: def.id,
          duration: 1,
          probability: Number(m[1]) / 100,
          evidence: s2.slice(0, 160),
        };
        break;
      }
      /**
       * 形状③：友方回合结束后，使**行动条最前端**的另一友方 +N% 行动条
       *   （稻荷神御馔津「狐狩·日曜界」）。★ 必须要求句子里有「友方」且**没有「敌方」** ——
       *   同一位式神的「月影界」写的是「敌方回合结束后…攻击该敌方」，那是另一种形状（还没建模），
       *   不排除的话两条技能会被解析成同一个 perTurn。
       */
      if (/友方/.test(s2) && !/敌方/.test(s2)) {
        const pushM = /回合结束后[^。；]{0,14}?使[^。；]{0,12}?行动条[^。；]{0,8}?增加\s*(\d+)\s*%/.exec(s2);
        if (pushM) {
          field.perTurn = {
            trigger: "TURN_END",
            scope: "ALLY",
            kind: "TIMELINE_PUSH",
            percent: Number(pushM[1]),
            probability: null,
            evidence: s2.slice(0, 160),
          };
          break;
        }
      }
    }
  }

  /**
   * ★★★ 第 124 轮：**场地技能的其余每回合 / 条件效果，逐句记账**。
   *
   * 由来：第 115 轮的 field.ts 头注释写着「由编译器逐句记成 FIELD_CLAUSE_NOT_MODELED，不许静默」——
   *   实测**没有任何地方记**（那个原因码只存在于注释里）。于是 5 条场地技能的每回合效果
   *   （回合结束给 buff / 结界里敌方回合结束被打 / 预言判定…）就那样**静默丢了**，
   *   而 Fidelity 会把它们算成「完整编译」。这一轮补上记账，只放行已经建模的那一种形状。
   */
  if (field) {
    for (const s2 of sentences(raw)) {
      for (const c of s2.split(/[，,]/)) {
        if (!/回合开始|回合结束|每次行动|每使用/.test(c)) continue;
        /** 已建模：**perTurn 自己记着那一句证据** —— 归一化后比对，不再按形状写第二遍判据 */
        const nc = c.replace(/\s+/g, "");
        if (field.perTurn && nc.length > 4 && field.perTurn.evidence.replace(/\s+/g, "").includes(nc)) continue;
        formSkips.push({ reason: "FIELD_PER_TURN_NOT_MODELED", evidence: c.trim().slice(0, 140) });
      }
    }
  }

  // 同一条跳过原因可能被多个子句重复报出（噬魂那句被切成两段）—— 按 原因+证据 去重
  {
    const seenSkip = new Set<string>();
    for (let i = stealSkips.length - 1; i >= 0; i--) {
      const key = stealSkips[i].reason + "|" + stealSkips[i].evidence;
      if (seenSkip.has(key)) stealSkips.splice(i, 1); else seenSkip.add(key);
    }
  }

  const pats = Object.values(P);
  const parsed: Array<{ text: string; kind: "PARSED" | "MECHANIC_UNPARSED" | "FLAVOR" }> = [];
  const unparsed: string[] = [];
  const unmodeledMechanics: SkillIR["unmodeledMechanics"] = [];
  for (const s of sentences(raw)) {
    if (!s || /^[-—\s]*$/.test(s)) continue;
    // ★ 引擎确实没有建模的机制句，**优先**判为未解析 —— 哪怕这句里还有别的能解析的东西。
    //   起因：句子分类是整句级的，只要匹配到一个模式（哪怕 [tips_1] 这种纯引用）就记为 PARSED，
    //   于是「为友方目标驱散3个减益状态…」被报成 confidence=HIGH / unparsed=0。
    //   两类来源：
    //     ① 被动触发（「X被驱散时…」）—— 引擎没有"被驱散时"的触发模型；
    //     ② compile/unmodeled.ts 的动词表 —— 每条都记录了"引擎里缺什么、怎么验证的"。
    //   该表刻意**只收能证明没有行为代码的动词**，并排除三种误报：
    //   过滤器（非召唤物）、条件碎片（"受到伤害时"）、免疫声明（"不可驱散"）。
    const passiveTrigger = /被驱散|被解除|被移除/.test(s) && !/不可(?:被)?驱散|无法(?:被)?驱散|不能被驱散|不可解除|无法(?:被)?解除/.test(s);
    /**
     * ★★★ 第 108 轮：「**偷取**」这一族在 99–108 轮陆续接线（属性偷取 / 增益偷取 / 三种触发时机 /
     *   总量上限 / 阵亡归还），可 compile/unmodeled.ts 的动词表还写着「引擎明确做不到」——
     *   于是**整句**被判成 MECHANIC_UNPARSED，IR 里明明解析出来的那一条也被这句声明挡住：
     *   逐句注册闸门是按"子句包含关系"比对的（compile/passive-runtime.ts），
     *   所以噬魂「施放『焚天九尾』前，先偷取…」**从来没被装上**（探针实测 STAT_STEAL × 0）。
     *
     * 判据与第 97 轮的 isActiveReviveClause 同一套：**去问编译产物**，而不是只看动词表。
     * 三种已建模的形状（每一条都能指到行为代码）：
     *   · 偷取动作本身 —— 子句与 ir.steals[].evidence 是同一句（attribute 由 kernel/steal.ts 的 applyStatSteal 执行）；
     *   · 「偷取总值不超过…N%」—— 进 ir.steals[].capTotalRatio，由 applyStatSteal 按上限削（第 107 轮）；
     *   · 「将偷取的…归还」—— 由 kernel/steal.ts 的 restoreStats 执行，接在死亡路径上（kernel/battle.ts 的 resolveLethal）。
     * ★ 只在 IR 里**真有**偷取产物时才认（否则"解析不出来 ≠ 没有条件"会被绕过）。
     */
    const plain = (x: any) => String(x ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, "");
    const stealEv = steals.map(x => plain(x.evidence));
    const modeledStealClause = (c: any) => {
      const pc = plain(c);
      if (!pc) return false;
      if (stealEv.some(e => e.length > 4 && (e.includes(pc) || pc.includes(e)))) return true;
      if (/偷取总值不超过/.test(pc) && steals.some(x => x.capTotalRatio)) return true;
      if (/将偷取的[^。；]*归还|阵亡时[^。；]*归还/.test(pc) && steals.length > 0) return true;
      return false;
    };
    // ★★ 判成主动复活的那句**不再**报"复活未建模" —— 它现在真的有行为代码了。
    //   触发式复活（阵亡时…/棺材…）仍然会走到 findUnmodeled，保持未建模。
    const mechHitsAll = isActiveReviveClause(s, sk.cost) ? [] : findUnmodeled(s, splitClauses);
    // ★★★ 第 108 轮：已建模的偷取子句**不再算未建模**（判据见上面 modeledStealClause 的注）。
    /**
     * ★★★ 第 129 轮：**已建模的触发式自复活子句不再算未建模**（与第 108 轮偷取那一刀同型）。
     *   判据用 IR 自己的产物（`selfRevive.clause`），而且是**逐子句**收窄的：
     *   只有真的写着「复活…生命上限N%的生命」、且属于被建模那一句的子句才放过 ——
     *   跳跳妹妹「每复活1次，会使下次复活的冷却时间增加1回合」不会被顺手带走。
     *   ★ 反向：**没有产物**时一律照旧报缺口（fail-closed）—— 跳跳妹妹 / 青蛙瓷器今天仍然报。
     */
    const selfReviveEv = selfRevive ? plain(selfRevive.clause) : "";
    const modeledSelfReviveClause = (c: any) => {
      if (!selfRevive) return false;
      if (!/生命上限\s*\d+(?:\.\d+)?\s*%\s*的生命/.test(String(c ?? ""))) return false;
      const pc = plain(c);
      return !!pc && pc.length > 4 && selfReviveEv.includes(pc);
    };
    /**
     * ★★★ 第 140 轮：**花海没有走「已建模就不再记账」那条路** —— 这是有意的。
     *
     * 这一轮把六条判据全部解析出来了（`layerField` / `grantLayers`，形状见 kernel/layer-field.ts），
     * 但**运行时执行点还没接**：计数器、每层伤害、上限、减层、跨档得层与先机都还没有装配路径。
     * 也就是说 IR 里有 spec，战斗里一个字都不会发生。
     *
     * 第 108 轮（偷取）与第 129 轮（自复活）之所以能把子句从「未建模」里放出来，是因为**那一轮接线了**。
     * 这里若照抄那个闸门，报表就会从「未建模」直接跳到「完整编译」—— 正是本仓库反复强调的
     * **报表比代码乐观**。所以记账保持原样，等执行点落地再逐子句放行。
     */
    /**
     * ★★★ 第 145 轮：**已建模的花海子句不再算未建模** —— 与第 108 轮（偷取）、第 129 轮（自复活）同型，
     *   但**放行条件更严**：那一轮是"接线了"就放行，这一轮还要求"验过了"（tests/g93-layer-field.ts 23 条全绿：
     *   先机 / 上限 / 夹取 / 跨档 +2 / 减层不低于 1 / 敌方回合按层结算 / 自己回合减层不结算 / 主动 +2+1 / 跨档给盾）。
     *   判据用 IR 自己的产物，逐子句收窄：
     *     · layerField 解析成功 ⇒ 放过它覆盖的那几条（伤害 / 上限 / 减层 / 先机 / 跨档得层）；
     *     · grantLayers 解析成功 ⇒ 放过**无条件**的「获得N层花海」「再获得N层花海」。
     *   ★ fail-closed：只要有一条判据没解析出来（layerField === undefined），这些子句照旧记 WARN。
     */
    const modeledLayerClause = (c: any) => {
      if (!layerField && !grantLayers) return false;
      const pc = plain(c);
      if (!pc) return false;
      if (layerField) {
        if (/花海中的敌方/.test(pc)) return true;
        if (/每层花海对其造成攻击/.test(pc)) return true;
        if (/花海上限为/.test(pc)) return true;
        if (/回合开始时自动减少\d+层花海/.test(pc)) return true;
        if (/创造\d+层花海/.test(pc)) return true;
        if (/获得\d+层花海及/.test(pc)) return true;
      }
      if (grantLayers && (/^获得\d+层花海$/.test(pc) || /^再获得\d+层花海$/.test(pc))) return true;
      return false;
    };
    /**
     * ★★★ 第 239 轮：**计数器满层施放**（百目鬼「鬼眸」→ counterCast）也有执行点了。
     *   动词表在这一句上记的「追加施放」必须**跟着撤** —— 否则 mechHits 非空，整句仍进 MECHANIC_UNPARSED，
     *   报表就比现实**悲观**（IR 里有 counterCast、运行时有处理器，句子却自称没有行为代码）。
     *   判据仍取产物自己的话：counterCast.skillRef 就是这一句点名的那个 [skill_N]。
     */
    /** ★ 用**同一个函数里的局部** counterCast（它在上面就算好了）——
     *  第一版写的是 sk?.ir?.counterCast：那一刻 sk.ir 还没有这个键（它是本函数返回时才装上去的），
     *  于是两条豁免都成了死代码 —— 实测：census「变化 393」一个字没动，而 IR 里 counterCast 明明在。 */
    const ccRefForAccounting = counterCast?.skillRef;
    const counterCastCovers = (clause: string) => !!ccRefForAccounting && String(clause).includes("[skill_" + String(ccRefForAccounting) + "]");
    const mechHits = mechHitsAll.filter((h: any) =>
      !(h.verb === "偷取" && modeledStealClause(h.clause)) &&
      !(h.verb === "复活" && modeledSelfReviveClause(h.clause)) &&
      !(h.verb === "花海" && modeledLayerClause(h.clause)) &&
      !(h.verb === "追加施放" && counterCastCovers(h.clause)));
    const stealModeledOnly = mechHitsAll.length > 0 && mechHits.length === 0
      && mechHitsAll.every((h: any) => h.verb === "偷取" && modeledStealClause(h.clause));
    /**
     * ★★★ 第 110 轮：**召唤物的「在场时」光环与「收回」** —— 这两句今天没有行为代码，
     *   而它们此前**根本没有被记下来**：句子级分类只要匹配到一个模式（哪怕只是"20%防御"这种）
     *   就记为 PARSED，于是「[tips_5523]在场时，提升除召唤物外友方目标20%防御」在报表上是"已实现"。
     *
     * 为什么必须在这一轮补：同一个技能里的「召唤[tips_5523]」**刚刚变成真的会放单位**了 ——
     * 若光环不单独记账，这条技能就会从"召唤没实现"直接跳到"全实现"，中间那半边**消失不见**。
     * 判据按**子句**取（与 findUnmodeled 同一套切分），并且要求子句里真的有数字，避免把氛围句收进来。
     */
    /**
     * ★★★ 第 111 轮：**已实现的形状不再报未建模**（与第 108 轮偷取那一刀同一套做法）。
     *   · 光环：`parsePresenceAuras` 能把整句读成静态属性修正 ⇒ 它有行为代码了；
     *     只要还剩一句读不出来（普攻 / 行动条 / 鬼火 / 概率 / 层数），那一句照旧报。
     *   · 收回：这一轮接上了 `recall`（回合开始时移除放置单位 + 点名状态）。
     *   ★ 判据都用**编译产物自己的话**：forms[].auras / forms[].recall，而不是另写一套文本启发式。
     */
    const auraClauses = new Set<string>();
    for (const f of forms) for (const a of (f.auras ?? [])) auraClauses.add(String(a.evidence).replace(/\s+/g, ""));
    const recallTips = new Set(forms.filter((f: any) => f.recall).map((f: any) => f.tipsId));
    const presenceClause = splitClauses(s).find((c: string) => {
      if (!(/\[tips_[0-9]+\]在场时|若[^。；]{0,10}在场/.test(c) && /[0-9]/.test(c))) return false;
      const parsed = parsePresenceAuras(c, "ALLY");
      /** ★ 只有**整句都能落成静态属性修正**时才算"已实现"；剩下任何一部分都要继续报（部分实现也要说清是哪一半） */
      return parsed.unmodeled.length > 0;
    }) ?? null;
    const recallClause = splitClauses(s).find((c: string) => {
      const m = /收回\[tips_([0-9]+)\]/.exec(c);
      return !!m && !recallTips.has(m[1]);
    }) ?? null;
    /**
     * ★★★ 第 129 轮：同一句里**被建模之外的另一半** —— 「并对随机敌方目标施放『X』」。
     *   这一句追加施放**没有行为代码**，必须单独记账：否则复活一接线，
     *   整句就从"未实现"跳成"全实现"，而中间那半边会**消失不见**（第 110 轮同一个教训）。
     */
    /**
     * ★★★ 第 135 轮：**已有执行点的施放子句不再报缺口**（subCasts 里挂着它；
     *   九命猫那条的施放现在真的会执行，见 kernel/sub-cast.ts）。
     *   ★ 同时**扩大**到所有「施放『X』」子句：名字引用（「施放『五光斩』」）与
     *     触发条件没模型的（百目鬼/御馔津/麓铭/梦寻山兔）都要具名，而不是像以前那样 silent。
     */
    /**
     * ★★★ 第 135 轮：这一句里的「施放『X』」**有没有执行点**。
     *   · 有（subCasts 挂着它 —— 第 135 轮接线；或 selfRevive.castSkill 那一类）：不记账；
     *   · 没有（名字引用 / 触发条件没模型）：记一条 追加施放（WARN），不再 silent。
     *   ★ 三种**不是施放**的写法照旧排除（与 subCasts 的解析同一套判据）：
     *     「施放『X』前」= PRE_CAST 偷取、「…鬼火消耗减少」= 费用修正、「施放『X』时/后」= 别的效果的触发条件。
     */
    const castClause = ((): string | null => {
      const cl = splitClauses(s).find((c: string) => /施放『/.test(c));
      if (!cl) return null;
      if (/(?:阵亡|死亡|被击败)时|\[tips_7\]|先机/.test(s) && (sk?.ir?.subCasts ?? []).some((x: any) => x.clause === s)) return null;
      if (selfRevive?.castSkill && selfRevive.clause === s) return null;
      if (/施放『[^』]+』前/.test(cl) || /消耗减少/.test(cl) || /施放『[^』]+』(?:时|后)/.test(cl)) return null;
      /**
       * ★★★ 第 239 轮：**计数器满层施放也有执行点了**（百目鬼「鬼眸」：counterCast → 满 5 层走 FREE 通路施放同一门技能）。
       *   判据用产物自己的话：counterCast.skillRef 就是这一句点名的那个 [skill_N]，两者一致 ⇒ 这一句不再报缺口。
       *   与第 135 轮九命猫那条同型（subCasts 挂着它就不再报）—— 否则记账会比现实**悲观**：IR 里有执行点、
       *   运行时有处理器，句子分类却还挂 MECHANIC_UNPARSED。
       */
      const ccRef = counterCast?.skillRef;
      if (ccRef && cl.includes("[skill_" + String(ccRef) + "]")) return null;
      return cl;
    })();
    /**
     * ★★★ 第 130 轮：**「受到致命伤害时…」这一族里没有执行点的写法**必须单独记账。
     *
     * 由来（探针 tools/_probe-lethalguard130.ts 数出来的）：全库 7 条含「受到致命伤害」的子句里，
     *   · 2 条有自己的执行点 —— 须佐之男「神之领域」（ON_LETHAL + placement=ENEMY，第 103 轮）
     *     与百羽凤凰火「未熄羽」（ON_LETHAL + placement=SELF，第 130 轮接线）；
     *   · 3 条**既没有未建模动词、也没有任何执行点** —— 也就是说它们此前自称"完整编译"：
     *       石长姬「磐长纪」　「受到致命伤害时，消耗1朵[buff_6082_1]，获得其中的生命」
     *       空相面灵气「表里之相」「受到致命伤害时，进入[buff_3664_1]姿态」（姿态由 **buff** 定义，不是 [tips_N]）
     *       伊邪那美「神赐之吻」　「自身在场时，处于[buff_5572_1]的友方目标受到致命伤害将剩余1点生命（…次数上限）」
     *   · 另外 2 条（缚骨清姬「蚀骨」/入内雀「附身」）动词表已经记了（召唤 / 免疫·转移）。
     *
     * 判据全部取自**编译产物自己的话**，不在报告层另写名单：
     *   ① 子句里有「受到致命伤害」；② 这条技能**没有任何** ON_LETHAL 形态（有就说明它已被上一段或第 103 轮接管）；
     *   ③ 动词表这一句一个字都没报（报了就不再重复记账 —— 一处缺口一条记录）。
     */
    /**
     * ★ 第 131 轮：**已有执行点的三类都不许再报缺口** —— ON_LETHAL 形态（第 103/130 轮）、
     *   替友方拦截（第 131 轮接线，SkillIR.allyGuard）、以及动词表已经记过的（一处缺口一条记录）。
     */
  const lethalGuardClause = (!lethalConsume && !forms.some((f: any) => f.trigger === "ON_LETHAL") && !allyGuard && mechHits.length === 0)
      ? (splitClauses(s).find((c: string) => /受到致命伤害/.test(c)) ?? null)
      : null;
    /**
     * ★★★ 第 250 轮：**条件伤害分支**（「若开启X，则此技能改为攻击…」/「（若开启X，再增加N次）」）。
     *
     * 为什么必须记账：这一类**在多算**。编译器把两条分支的伤害**都**收进了 `damage[]`（`damage=[{atk,100},{atk,80}]`、`hits:2`），
     *   运行时两条都打。实测（tools/_probe-dd250.ts）：御怨般若「恨返」331_01 一次施放打出 **4 条**伤害事件，
     *   而原文是 1 条（未开结界）或 2 条（开结界）；「予愿必还」331_03 打出 **15 条**（原文 8 或 13 条）。
     *   —— 这两条此前 `confidence: HIGH`、`unparsed: []`、`unmodeledMechanics: []`，也就是**报表说完整编译**。
     * ★ 本轮只**如实记账**（句子判 MECHANIC_UNPARSED + 一条具名缺口），**行为一个字不改**：
     *   「算错比少算更坏」，但仓促改伤害形状会把风险撒到整个伤害解析面上 —— 先让它说出来，再单独修。
     * 判据（窄口径，两条写法各自命中）：① 「若…（开启|存在）…则此技能改为…攻击」；② 「（若…（开启|存在）…再增加N次」。
     */
    /**
     * ★★ 实测（第一版）：判据挂在**小句**上会漏掉 331_03 —— `splitClauses` 会按逗号切开，
     *   「（若开启封印结界，再增加1次）」被切成两半 ⇒ 两个半句各自都不匹配（只收到 331_01 一条）。
     *   改成在**整句**上匹配（与第 242 轮的效果位变体同一个坑）。
     */
    const damageBranchClause = ((): string | null => {
      const m1 = /[^。；]{0,26}?则此技能改为[^。；]{0,12}攻击[^。；]{0,20}/.exec(s);
      if (m1) return String(m1[0]).trim();
      const m2 = /[（(]?若[^。；]{0,14}(?:开启|存在)[^。；]{0,26}再增加\s*\d+\s*次[^。；]{0,4}/.exec(s);
      if (m2) return String(m2[0]).trim();
      return null;
    })();
    /**
     * ★★★ 第 252 轮：另外两条记账是**整条技能级**的（分段形状 / 次数读成上限）—— 它们在上面就算好了整句，
     *   这里只判断"当前这一句是不是那一句"（按句子**同一性**比，两边都来自同一个 sentences(raw)）。
     */
    const segGapHere = segGapClause !== null && s === segGapClause;
    const hitsCapHere = hitsCapClause !== null && s === hitsCapClause;
    /** ★★★ 第 252 轮：暴击那一族的三条（每种全库各 1 条，逐条带自己的动词与说明） */
    const critHere = critGapClauses.filter((g) => g.clause === s);
    /** ★★★ 第 254 轮：失血 / 承受者选择规则两族 —— **动词表对这句没说话**时才记（不抢账） */
    const residualHere = mechHits.length === 0 ? residualGapClauses.filter((g) => g.clause === s) : [];
    if (passiveTrigger || mechHits.length > 0 || presenceClause || recallClause || castClause || lethalGuardClause || damageBranchClause || segGapHere || hitsCapHere || critHere.length > 0 || residualHere.length > 0) {
      parsed.push({ text: s, kind: "MECHANIC_UNPARSED" });
      unparsed.push(s);
      if (damageBranchClause) {
        unmodeledMechanics.push({
          verb: "条件伤害分支", severity: "WARN",
          missing: "「若开启X，则此技能改为…」这类**条件伤害分支**没有载体：编译器把两条分支的伤害**都**收进了 damage[]，运行时两条都打（多算）；「（若开启X，再增加N次）」则相反（少算）",
          evidence: "第 250 轮实测（tools/_probe-dd250.ts）：御怨般若「恨返」331_01 一次施放打出 4 条伤害事件（原文 1 或 2 条）、「予愿必还」331_03 打出 15 条（原文 8 或 13 条）；两条技能此前都被算作「完整编译」",
          clause: damageBranchClause,
        });
      }
      /**
       * ★★★ 第 252 轮：**分段伤害形状**（认得出"两段"，但有一段表达不了）。
       *   与实现侧互斥：`damageSegments` 生成成功的 4 条（262_03 / 281_03 / 331_03 / 375_03）**不报**这一条。
       */
      if (segGapHere && segGapClause) {
        unmodeledMechanics.push({
          verb: "分段伤害形状", severity: "WARN",
          missing: "「先 N 次单体 X%，最后/然后 1 次全体 Y%」这类**分段伤害**只有一部分能表达：本轮落地的 damageSegments（第 252 轮）只收『两段顺序正确 + 范围不同 + 比例都是 atk 且都有槽位 + 中段无动态量』这四条 —— 其余写法（附加状态后附带伤害 / 动态量 / 条件追加 / 顺序相反）仍按『槽数 × hits × 受击人数』展开，**多算**",
          evidence: "第 252 轮实测（tools/_probe-seg252.ts / _probe-seg252c.ts / _probe-seg252e.ts）：全库 hits>1 且 targeting 混合的 12 条里，4 条已落地（262_03 / 281_03 / 331_03 / 375_03）、8 条不满足判据（210_03 / 260_03 / 607_03 由『两段范围相同 / 顺序相反』挡下；392_03 / 399_03 / 556_03 / 592_03 是动态量或条件追加；217_03 / 390_02 另有『次数读成上限』一条）",
          clause: segGapClause,
        });
      }
      /**
       * ★★★ 第 252 轮：**次数读成了上限**（「最多触发N次 / 至多生效N次 / 上限N次」被当成了"一次施放几段"）。
       */
      if (hitsCapHere && hitsCapClause) {
        unmodeledMechanics.push({
          verb: "次数读成了上限", severity: "WARN",
          missing: "`hits` 取自句子里的『次数』，而它是 `max(所有 2..12 的次数)` —— 「单次攻击最多触发6次」「至多生效5次」「上限4次」这类**触发/生效上限**会被当成『一次施放几段』。有伤害产物的 3 条是**多算**（217_03 / 286_01 / 390_02），无伤害产物的 3 条只错在『次数』这个记账字段（385_02 / 500_02 / 572_02）",
          evidence: "第 252 轮实测（tools/_probe-seg252e.ts）：全库 hits>1 且次数恰好只出现在上限子句里的 **6 条**；★ 390_02 神启荒在**典型对局阵容**里（BLUE），改它会动两个典型指纹 ⇒ 与『伤害基数 / 治疗基数』同一条处置：先记账，等一次明确裁定",
          clause: hitsCapClause,
        });
      }
      /** ★★★ 第 252 轮：暴击那一族（三种形状各 1 条）—— 说明与证据都随每一条自己带 */
      for (const g of critHere) unmodeledMechanics.push({ verb: g.verb, severity: "WARN", missing: g.missing, evidence: g.evidence, clause: g.clause });
      /** ★★★ 第 254 轮：失血 / 承受者选择规则（同上） */
      for (const g of residualHere) unmodeledMechanics.push({ verb: g.verb, severity: "WARN", missing: g.missing, evidence: g.evidence, clause: g.clause });
      if (presenceClause) {
        unmodeledMechanics.push({
          verb: "在场光环", severity: "WARN", missing: "「[tips_N]在场时…」里的**非静态属性修正**部分没有行为代码（普攻加成 / 行动条 / 鬼火 / 概率 / 层数 / 点名状态）；★ 同句里的静态属性修正（提升/降低 N%|N点 八维）第 111 轮已接线",
          evidence: "引擎里只有「放置单位本体」（addSummon）；没有「在场时按范围施加/撤销效果」这一段。判据与逐条清单见 tests/g66-summon-presence.ts",
          clause: presenceClause,
        });
      }
      if (recallClause) {
        unmodeledMechanics.push({
          verb: "收回", severity: "WARN", missing: "「回合开始时，收回[tips_N]」没有行为代码（召唤物只能被打死，不会被主动收回）",
          evidence: "引擎里没有「移除放置单位」这条生产路径（只有阵亡时的 resolveLethal 分支）。判据与逐条清单见 tests/g66-summon-presence.ts",
          clause: recallClause,
        });
      }
      if (passiveTrigger) {
        unmodeledMechanics.push({
          verb: "被动触发", missing: "引擎没有「被驱散/被解除/被移除时」的触发模型",
          evidence: "内核里没有该触发时机的派发点", clause: s,
        });
      }
      if (lethalGuardClause) {
        unmodeledMechanics.push({
          verb: LETHAL_GUARD_VERB, severity: "WARN",
          missing: "「受到致命伤害时…」这一族的**没有执行点的写法**：引擎只会走死亡结算（免死靠状态自带的 preventsLethal、转化靠 ON_LETHAL 形态，两者都不覆盖这一句）",
          evidence: "死亡路径的三个拦截点（kernel/battle.ts 的 resolveLethal）分别读：状态字段 preventsLethal（kernel/damage.ts 的 findPreventLethal）、forms[ON_LETHAL]（自己/敌方两种 placement）、以及未使用的 DEATH_PREVENTION 钩子。判据与双向验证见 tests/g84-lethal-guard.ts",
          clause: lethalGuardClause,
        });
      }
      if (castClause) {
        unmodeledMechanics.push({
          verb: APPEND_CAST_VERB, severity: "WARN",
          missing: "「…并对随机敌方目标施放『X』」里的**追加施放**没有行为代码（引擎不会在别人的（或自己的）死亡/复活流程中再放一次技能）；★ 同一句里的触发式复活第 129 轮已接线",
          evidence: "引擎里没有任何「替某个单位释放另一个技能」的入口：技能执行点只有 compile/character.ts 的 execute 与 kernel/battle.ts 的 runPseudoTurn（强制普攻）。逐条清单与判据见 tests/g83-death-revive.ts",
          clause: castClause,
        });
      }
      // ★ 第 112 轮：severity 跟着**动词表里那一条**走（一处声明，一处传播）
      for (const h of mechHits) unmodeledMechanics.push({ verb: h.verb, missing: h.missing, evidence: h.evidence, clause: h.clause, severity: SEV.get(h.verb) ?? "INFO" });
      continue;
    }
    /**
     * ★★★ 第 108 轮：这句话里的「偷取」**整句都已经有产物**（见 modeledStealClause）⇒ 它就是 PARSED。
     *   不补这一条，噬魂那句会掉进"未解释"桶里 —— 与事实不符（IR 里明明有 steals，运行时有执行点），
     *   而且会把 compile-census 的"未解释 = 0"打破成"多了一句没人认领的话"。
     */
    if (stealModeledOnly) { parsed.push({ text: s, kind: "PARSED" }); continue; }
    /**
     * ★★★ 第 131 轮：**已接线的"替友方拦死"那一句也是 PARSED**（与上面偷取那条同型）。
     *   不补这一条，伊邪那美「神赐之吻」的那句会掉进"未解释"桶：IR 里明明有 allyGuard、
     *   运行时有执行点（kernel/ally-guard.ts），而句子分类却还挂着 MECHANIC_UNPARSED。
     */
    if (allyGuard && /受到致命伤害/.test(s)) { parsed.push({ text: s, kind: "PARSED" }); continue; }
    /**
     * ★★★ 第 135 轮：**已接线的追加施放那一句也是 PARSED**（与偷取/拦死同型）。
     *   九命猫「九命」的复活+施放句、辉夜姬「火鼠裘」的先机施放句 —— 两者现在都有执行点。
     */
    if ((sk?.ir?.subCasts ?? []).some((x: any) => x.clause === s) || (selfRevive?.castSkill && selfRevive.clause === s)) {
      parsed.push({ text: s, kind: "PARSED" }); continue;
    }
    const hit = pats.some(p => { p.lastIndex = 0; const h = p.test(s); p.lastIndex = 0; return h; });
    if (hit) { parsed.push({ text: s, kind: "PARSED" }); continue; }
    const hasDigit = /\d/.test(s);
    const hasMech = MECH_KEYWORDS.test(s);
    if (!hasDigit && !hasMech) { parsed.push({ text: s, kind: "FLAVOR" }); continue; }
    parsed.push({ text: s, kind: "MECHANIC_UNPARSED" });
    unparsed.push(s);
  }

  const hasCore = dedup.length > 0 || heal.length > 0 || shieldD.length > 0 || statusRefs.length > 0 || timeline.length > 0 || !!lifesteal || !!counter;
  const ratio = parsed.length ? unparsed.length / parsed.filter(p => p.kind !== "FLAVOR").length : 1;
  let confidence: SkillIR["confidence"] = "LOW";
  if (hasCore && unparsed.length === 0) confidence = "HIGH";
  else if (hasCore && ratio <= 0.25) confidence = "MEDIUM";

  return {
    id: sk.id, charId, charName, name: sk.name, cost: Number(sk.cost) || 0,
    hits, damage: dedup, heal, shield: shieldD, timeline, orb,
    statusRefs, tipRefs, probabilities, durations, effectProbs, effectProbSkips,
    statusDurations, durationSkips, purge, unmodeledMechanics, targeting, revive,
    ...(purgeSkips.length ? { purgeSkips } : {}),
    // ★ 第 129 轮：与 forms/steals 同一策略 —— **只有非默认值才写出来**（默认 null 不出现）。
    ...(selfRevive ? { selfRevive } : {}),
    // ★★★ 第 176 轮：同上 —— 没有"来源承受者"子句的技能里这个字段**根本不出现**
    ...(sourceBearerRefs.length ? { sourceBearerRefs } : {}),
    // ★★★ 第 180 轮：同上 —— 没有"跨子句重复引用"的技能里这个字段**根本不出现**
    ...(statusRefClauses ? { statusRefClauses } : {}),
    ...(statusRefConditionOnly ? { statusRefConditionOnly } : {}),
    ...(statusRefNameForm.length ? { statusRefNameForm } : {}),
    // ★★★ 第 194 轮：同上 —— 没有池子的技能里这两个键**根本不出现**（fail-closed，与今天逐位相同）
    ...(randomStatuses.length ? { randomStatuses } : {}),
    ...(randomStatusSkips.length ? { randomStatusSkips } : {}),
    // ★★★ 第 195 轮：控制占位符（同上策略：只有非空才写出来）
    ...(controlRefs.length ? { controlRefs } : {}),
    ...(controlSkips.length ? { controlSkips } : {}),
    // ★★★ 第 239 轮：计数器 → 满层免消耗施放（只有解析出来才写）
    ...(counterCast ? { counterCast } : {}),
    ...(drunk ? { drunk } : {}),
    ...(endOnLose ? { endOnLose } : {}),
    ...(castGate ? { castGate } : {}),
    ...(overflowShield ? { overflowShield } : {}),
    ...(damageBranch ? { damageBranch } : {}),
    // ★★★ 第 252 轮：分段伤害形状（只有四条闸门全过的技能才写出来 —— 目前 4 条）
    ...(damageSegments ? { damageSegments } : {}),
    // ★★★ 第 253 轮：同比例两种伤害语义的合并记录（只有真出现时才写）
    ...(damageTypeCollisions.length ? { damageTypeCollisions } : {}),
    // ★★★ 第 255 轮：失血（只有真的读出「失去N%最大生命」的主动技能才写）
    ...(selfHpLoss ? { selfHpLoss } : {}),
    // ★★★ 第 188 轮：同上 —— 没有逐句效果证据的技能里这个字段**根本不出现**（执行侧照旧全放）
    ...(effectClausesOut ? { effectClauses: effectClausesOut } : {}),
    // ★★★ 第 187 轮：消耗型换命（只有解析出四条判据的技能才写出来）
    ...(lethalConsume ? { lethalConsume } : {}),
    // ★ 第 130 轮：同上 —— 只有非默认值才写出来
    ...(noHeal ? { noHeal } : {}),
    // ★ 第 131 轮：同上
    ...(allyGuard ? { allyGuard } : {}),
    // ★ 第 135 轮：同上
    ...(subCasts ? { subCasts } : {}),
    // ★ 第 136 轮：同上
    ...(orbGaugeAdvance ? { orbGaugeAdvance } : {}),
    // ★ 第 140 轮：叠层场地（同上策略：只有非默认值才写出来）
    ...(layerField ? { layerField } : {}),
    ...(grantLayers ? { grantLayers } : {}),
    statusStacks: statusStacks.length ? statusStacks : null,
    statusCaps: statusCaps.length ? statusCaps : null,
    statusCapSkips: statusCapSkips.length ? statusCapSkips : null,
    damageSkips: damageSkips.length ? damageSkips : null,
    damageBaseMismatch: damageBaseMismatch.length ? damageBaseMismatch : null,
    healBaseMismatch: healBaseMismatch.length ? healBaseMismatch : null,
    shieldSkips: shieldSkips.length ? shieldSkips : null,
    lifesteal,
    lifestealSkips: lifestealSkips.length ? lifestealSkips : null,
    // ★★ 第 95 轮：与 buff 同一策略 —— **只有非默认值才写出来**。
    //   无条件写 counter/counterSkips 会让**全部 802 条技能**都变成 compile-census 的"变化"
    //   （真正变的只有 15 条）。闸门的价值在于"变化数 == 需要解释的改动数"。
    ...(forms.length ? { forms } : {}),
    ...(formSkillOf ? { formSkillOf } : {}),
    ...(formSkips.length ? { formSkips } : {}),
    ...(field ? { field } : {}),
    ...(steals.length ? { steals } : {}),
    ...(stealSkips.length ? { stealSkips } : {}),
    ...(counter ? { counter } : {}),
    ...(counterSkips.length ? { counterSkips } : {}),
    levelScale: sk.upgrades ?? [], sentences: parsed, unparsed, recognized, confidence,
  };
}
