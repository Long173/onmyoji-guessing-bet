// compile/buff-compiler.ts — buff 描述文本 -> 可执行状态定义
// 数据：data/kb/buffs.json（331 条，{id,name,desc}）
// 官方[25] 词条里带【增益、状态】/【减益、印记】等前缀，直接作为分类来源。
import { StatusCategory } from "../kernel/types.ts";
import type { StatusDef, ImmuneKind } from "../kernel/status.ts";

export interface CompiledBuff {
  id: string; name: string; category: StatusCategory;
  dispellable: boolean; removable: boolean;
  preventsAction: boolean; preventsSkill: boolean; forcesBasicAttack: boolean;
  suppressPassive: boolean; suppressSoul: boolean; locksTimeline: boolean;
  effects: Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE"; note: string }>;
  durationFromText: number | null;
  /**
   * ★ 第 94 轮：buff 原文里写明的免疫类别（见 kernel/status.ts 的 StatusDef.immuneTo）。
   * ★ 可选（而不是 `| null`）：这四个字段**只有非默认值才写进产物**（理由见下面的对象字面量），
   *   所以"没有"的表示是**键不存在**。这一点是 vue-tsc 逼出来的 ——
   *   我第一版写成必填 `| null`，类型检查立刻报「undefined 不可赋给 null」。
   */
  immuneTo?: ImmuneKind[] | null;
  /** ★ 第 94 轮：「无法被复活 / 无法触发复活效果」（同上：只有 true 才写出来） */
  blocksRevive?: boolean;
  /** ★ 第 94 轮：「受到控制效果时消耗1层，免疫该控制效果」（同上） */
  consumeOnImmune?: boolean;
  /** ★ 第 94 轮：**免死**（「免疫…致命伤害」= FULL 免除该次伤害｜「剩余1点生命」= ONE） */
  preventsLethal?: "FULL" | "ONE" | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  unparsed: string[];
  desc: string;
}

const CAT: Array<[RegExp, StatusCategory]> = [
  [/【增益、状态】/, StatusCategory.BUFF_STATE],
  [/【增益、印记】/, StatusCategory.BUFF_MARK],
  [/【减益、状态】/, StatusCategory.DEBUFF_STATE],
  [/【减益、印记】/, StatusCategory.DEBUFF_MARK],
  [/【通用、印记】|【通用、状态】/, StatusCategory.COMMON_MARK],
];

const PROP: Array<[RegExp, string]> = [
  [/攻击/, "atk"], [/生命上限|最大生命|生命值/, "hp"], [/防御/, "def"],
  [/速度/, "spd"], [/暴击伤害|暴伤/, "crid"], [/暴击/, "cri"],
  [/效果命中|命中/, "efh"], [/效果抵抗|抵抗/, "efr"],
  // ★★ 第 44 轮重排（报告 §36）：三个字段的语义此前是混的 ——
  //   「造成伤害」被写进受击方字段（对携带者的输出无效、反而让他挨得更多）；
  //   「减伤」与「受伤」被写进同一个字段，而前者应当**取负**（减伤 = 挨得更少）。
  //   现在：造成伤害/增伤 → 源侧 dmgDealtB（第 43 轮新增的字段）；
  //        受伤/受到伤害   → 受击侧 dmgTakenD（正 = 挨得更多）；
  //        减伤            → 同样落在 dmgTakenD，但方向取反（见下面 SIGN_FLIP）。
  [/受伤|受到伤害/, "dmgTakenD"], [/造成伤害|增伤/, "dmgDealtB"], [/减伤/, "dmgTakenD"], [/治疗量|减疗/, "healDown"],
];

const pct = (s: string) => parseFloat(s);

export function compileBuff(b: any): CompiledBuff {
  const desc = String(b.desc ?? "");
  // ★ 显式标注类型：CAT 是字面量元组，不标注的话 TS 会把 category 收窄成 "COMMON_MARK"，
  //   后面两处比较就被判成"永不重叠"（运行期没问题，因为 Node 只是剥类型；但类型检查会红）。
  let category: StatusCategory = StatusCategory.COMMON_MARK;
  for (const [re, c] of CAT) if (re.test(desc)) { category = c as StatusCategory; break; }
  const isDebuff = category === StatusCategory.DEBUFF_STATE || category === StatusCategory.DEBUFF_MARK;

  const effects: CompiledBuff["effects"] = [];
  const unparsed: string[] = [];
  for (const seg of desc.split(/[，,；;。]/).map(s => s.trim()).filter(Boolean)) {
    const m = seg.match(/(提升|增加|提高|降低|减少|下降)\s*(\d+(?:\.\d+)?)\s*(%|点|％)?\s*([^，,；;。]*)/);
    if (m) {
      const dir = /提升|增加|提高/.test(m[1]) ? 1 : -1;
      const isPct = m[3] === "%" || m[3] === "％";
      const rest = m[4] ?? "";
      let prop: string | null = null;
      for (const [re, p] of PROP) if (re.test(rest) || re.test(seg)) { prop = p; break; }
      if (prop) {
        /**
         * ★ 方向修正（第 44/45 轮）。有两个字段的**语义与文案方向相反**，必须翻一次：
         * ① dmgTakenD 的语义是「受到的伤害」（正 = 挨得更多），而「减伤」是名词：
         *    「提升12%减伤」= 挨得更少 = 取负；「降低减伤」翻一次正好变成挨得更多 ✓
         * ② healDown 的语义是「减疗」（healTarget 算的是 1 - down），而「治疗量」说的是治疗量本身：
         *    「治疗量提升20%」= 治得更多 = 取负；文案本来就在说「减疗」时不翻。
         *
         * ★★ 第 48 轮补：① 必须**只在 prop 真的是 dmgTakenD 时**才翻。
         *    墨灵「每层增加8%效果抵抗和6%的减伤」里，第一个数字的属性是**效果抵抗**，
         *    却因为整句里出现了「减伤」而被翻了符号（efr -0.08）—— 这是一条真 bug，
         *    由 tools/compile-census.ts 的基线 diff 抓出来（它让这一条变化无处可藏）。
         */
        const cutFlip = prop === "dmgTakenD" && (/减伤/.test(rest) || /减伤/.test(seg)) ? -1 : 1;
        const healFlip = prop === "healDown" && /治疗/.test(seg) && !/减疗/.test(seg) ? -1 : 1;
        const val = pct(m[2]) * dir * cutFlip * healFlip;
        effects.push(isPct ? { prop, value: val / 100, mode: "ADD_RATE", note: seg }
                           : { prop, value: val, mode: "FIXED", note: seg });
        continue;
      }
    }
    if (/无法动作|不能行动/.test(seg)) continue;   // 已由 flag 表达
    if (/持续\s*\d+\s*回合|上限|最多|每层|不可驱散|不可被驱散/.test(seg)) continue;
    if (seg.length > 1 && !/^\[?(增益|减益|通用)/.test(seg)) unparsed.push(seg);
  }

  /**
   * ★★★ 第 94 轮：**状态自带的免疫**（与禁复活）。
   *
   * 判据全部只看**无歧义**的写法，且只收能从 buff 原文读出的属性：
   *   · 「免疫(所有)?控制(效果)」     → CONTROL
   *   · 「免疫减益」                  → DEBUFF（★ 免不免控制 = 红区 G，见 kernel/policies.ts）
   *   · 「免疫(该次|受到的|所有)?伤害」→ DAMAGE
   *   · 「免疫…放逐 / 放逐…免疫」     → BANISH
   *   · 「无法被复活 / 无法触发复活效果」→ blocksRevive（维护 Entity.reviveBlocked）
   *   · 「消耗1层…免疫 / 免疫…减少1层 / 免疫并移除1层」→ consumeOnImmune
   *
   * ★ 刻意**不**收的两类（如实留在 unparsed 里，而不是当成免疫）：
   *   · 「无法被驱散」—— 那是 dispellable 字段，早就在用，不是免疫；
   *   · 「无法受到改变行动条的效果」—— 那是这个状态**自己**锁条（locksTimeline），
   *     不是给别人免疫（实测 buff 里没有一条是"给别人免疫推条"的写法）。
   */
  /**
   * ★★ 逐**段**判定，而不是逐关键词 —— 第一版按关键词写，两个方向都错：
   *   · 漏收：「受到伤害、控制效果或放逐时，**免疫**并移除1层」里没有「免疫控制」这个字串，
   *     于是只收到 BANISH（少了两类）；
   *   · 误收：「…或**目标**免疫控制效果，则不开启剑狱」——那是**在说别人**免疫，
   *     不是这个状态给携带者免疫。
   * ⇒ 现在：先按「，；。」切段，只在**含「免疫」的那一段**判定，且排除主语是别人的写法；
   *   类别词允许写在**上一段**（列表写法：「受到伤害、控制效果或放逐时」+「免疫并移除1层」）。
   *
   * ★ 刻意**不**收：「免疫沉睡效果」这类**只免某一种控制**的写法。
   *   收成 CONTROL 会把它变成「免疫全部控制」—— 那是**多算**。这一条留在测试里当边界断言。
   */
  const segs = desc.split(/[，,；;。]/).map(s => s.trim()).filter(Boolean);
  const immuneTo: ImmuneKind[] = [];
  const KIND_RES: Array<[RegExp, ImmuneKind]> = [[/控制/, "CONTROL"], [/减益/, "DEBUFF"], [/伤害/, "DAMAGE"], [/放逐/, "BANISH"]];
  let preventsLethal: CompiledBuff["preventsLethal"] = null;
  /**
   * ★★★ 第 100 轮：「**抵挡**1次…」也是免疫的一种写法。
   *   实测 338 条 buff 里唯一一条用「抵挡」表述免疫的是 buff_2922_1 霜织庇护：
   *   「抵挡1次压制、封印、冰冻类效果或放逐。攻击时，若敌方存在庇护，则失去霜织庇护并移除敌方庇护。」
   *   —— 「抵挡1次」= 一次性的免疫（消耗一层）⇒ 收成 immuneTo + consumeOnImmune。
   *   ★ 判据刻意**要求写明次数**：只写「抵挡」不收，因为「有30%概率抵挡伤害」那种是**概率性减伤**，
   *     不是状态属性的免疫（多收会让携带者变成全程免伤）。两个方向都有断言（tests/g61）。
   */
  for (let i = 0; i < segs.length; i++) {
    const isImmuneWord = /免疫/.test(segs[i]);
    const isWardWord = /抵挡\s*(?:1|一)\s*次/.test(segs[i]) && !/概率/.test(segs[i]);
    if (!isImmuneWord && !isWardWord) continue;
    // ① 主语是别人（目标/敌方/友方/单位/式神）→ 这一句在描述别人的免疫，不是本状态的属性
    if (/(?:目标|敌方|友方|单位|式神)免疫/.test(segs[i])) continue;
    // ② 被动语态/条件句：「若该伤害**被免疫**或被护盾完全吸收」——那是在说"如果被免疫了"，
    //    不是本状态给谁免疫。判据：被免疫 / 句首的若·如果。
    if (/被免疫/.test(segs[i]) || /^(?:若|如果)/.test(segs[i])) continue;
    /**
     * ③ 类别词**优先看本段**，本段没有才看上一段（列表写法）。
     *    第一版无条件拼接上一段 —— 于是修罗的「…吸收攻击120%**伤害**的护盾，免疫控制效果」
     *    把上一段的「伤害」也算成了免疫类别（多收了 DAMAGE）。
     */
    const own = KIND_RES.filter(([re]) => re.test(segs[i])).map(([, k]) => k);
    const kinds = own.length ? own : KIND_RES.filter(([re]) => re.test(segs[i - 1] ?? "")).map(([, k]) => k);
    /**
     * ④ **致命伤害**不是「免疫伤害」：它是**一次**免死（原文「免疫首次/下1次受到的致命伤害」），
     *    永久免伤会让携带者从此不掉血 —— 那是多算。两类分开记账：
     *      · 免疫(所有)?伤害            → immuneTo: DAMAGE（状态存在期间一直免）
     *      · 免疫…致命伤害              → preventsLethal: FULL（那一次致命伤害被免除）
     *      · 受到致命伤害…剩余1点生命    → preventsLethal: ONE（活下来但只剩 1 点）
     */
    const lethal = /致命/.test(segs[i] + (segs[i - 1] ?? ""));
    for (const k of kinds) {
      if (k === "DAMAGE" && lethal) { if (!preventsLethal) preventsLethal = "FULL"; continue; }
      if (!immuneTo.includes(k)) immuneTo.push(k);
    }
  }
  if (!preventsLethal && /受到致命伤害[^。]{0,20}(?:剩余|保留)1点生命/.test(desc)) preventsLethal = "ONE";
  const consumeOnImmune = /消耗1层[^。]{0,10}免疫|免疫[^。]{0,6}减少1层|免疫并移除1层|减少1层来免疫|抵挡\s*(?:1|一)\s*次/.test(desc);
  const blocksRevive = /无法被复活|无法触发复活效果/.test(desc);

  const dur = desc.match(/持续\s*(\d+)\s*回合/);
  const def: CompiledBuff = {
    id: String(b.id), name: String(b.name), category,
    dispellable: !/无法(被)?驱散/.test(desc),
    removable: !/无法(被)?解除|霜冻/.test(desc),
    preventsAction: /无法动作|不能行动/.test(desc),
    preventsSkill: /无法施放技能|无法使用技能|只能(使用)?普攻/.test(desc),
    forcesBasicAttack: /强制(使用)?普攻|嘲讽|挑衅|混乱/.test(desc),
    /**
     * ★★★ 第 96 轮：这两个标记的判据**以前是错的** —— 而没人能发现，因为它们**从来没有被读过**
     *   （bus 的 `suppressedPassive` 集合在生产代码里没有任何写入方，见 §81）。
     *   不可达的值不会被任何行为验证，所以它错了四年也不会有人知道。
     *
     * 实测 9 条写进过这两个标记的 buff，其中 **4 条是假命中**：
     *   · 3641_1 理性：「阿修罗受到**理性压制**」——「压制」是修辞（效果是伤害 -9%）；
     *   · 3312_1 仇恨印记：「开启**封印结界**时」——那是**结界专名**，不是封印别人；
     *   · 2922_1 霜织庇护：「**抵挡**1次压制、封印、冰冻类效果」——它**抵抗**封印，方向正好相反；
     *   · 3833_1 堕化：「破除1把天羽羽斩**封印**」——那是另一个机制的封印。
     * ⇒ 判据收紧成"**这个状态在让别人失效**"这一种形状，且要求动词与宾语**紧邻**：
     *   · 被动失效：「(式神)被动技能(效果)失效/无效」；
     *   · 御魂失效：「御魂(效果)失效/无效」或「封印御魂」（这一处「封印」真的是动词）。
     */
    suppressPassive: /被动技能?(?:效果)?(?:失效|无效)/.test(desc),
    suppressSoul: /御魂(?:效果|4件套效果)?(?:失效|无效)|封印御魂/.test(desc),
    locksTimeline: /无法受到改变行动条|行动条位置被锁定/.test(desc),
    /**
     * ★★ 第 94 轮：**只有非默认值才写出来**。
     *
     * 这不是为了好看：compile-census 的基线是 `JSON.stringify(compileBuff(b))`（338 条），
     * 无条件写四个新键会让**全部 338 条**都变成"变化" —— 而真正的变化只有 19 条。
     * 闸门的价值在于"变化数 == 需要解释的机制改动数"；用默认值把噪声灌进去，
     * 下一个人就只能学会"忽略这张表"。
     */
    ...(immuneTo.length ? { immuneTo } : {}),
    ...(blocksRevive ? { blocksRevive: true } : {}),
    ...(consumeOnImmune ? { consumeOnImmune: true } : {}),
    ...(preventsLethal ? { preventsLethal } : {}),
    effects, durationFromText: dur ? Number(dur[1]) : null,
    confidence: effects.length > 0 && unparsed.length === 0 ? "HIGH" : effects.length > 0 ? "MEDIUM" : "LOW",
    unparsed, desc,
  };
  return def;
}

export function toStatusDef(cb: CompiledBuff): StatusDef {
  return {
    id: cb.id, name: cb.name, category: cb.category,
    dispellable: cb.dispellable, removable: cb.removable,
    preventsAction: cb.preventsAction, preventsSkill: cb.preventsSkill,
    forcesBasicAttack: cb.forcesBasicAttack,
    suppressPassive: cb.suppressPassive, suppressSoul: cb.suppressSoul,
    locksTimeline: cb.locksTimeline,
    durationPolicy: "SOURCE_TURN",   // 官方[15]
    immuneTo: cb.immuneTo, blocksRevive: cb.blocksRevive, consumeOnImmune: cb.consumeOnImmune,
    preventsLethal: cb.preventsLethal,
    desc: cb.desc,
  };
}
