// kernel/entity.ts
import { HpMutation } from "./types.ts";
import type { ActiveStatus, StatusDef } from "./status.ts";
// ★ 第 94 轮：reviveBlocked 由状态维护（唯一写入方在 refreshReviveBlock 里）
import { hasReviveBlock } from "./status.ts";

export interface Shield {
  id: string; value: number; dispellable: boolean; sourceId: number; consumed: number; broken: boolean;
  /** ★ 第 85 轮：单次受击最多吸收「该次伤害」的比例。undefined = 不设上限（旧语义） */
  perHitRatio?: number;
}

/**
 * ★★ 护盾的施加说明。`id` 要么由调用方给（必须**确定性**），要么由 addShield 生成。
 *   `tag` 只用于生成 id，进不了战斗逻辑（便于在 state / notes 里认出这是谁给的盾）。
 */
export interface ShieldSpec {
  value: number;
  sourceId: number;
  /** 默认 true。蚌精那类「不可驱散」写 false */
  dispellable?: boolean;
  /** 显式 id（必须确定性）。给了就原样使用 */
  id?: string;
  /** 不给 id 时用它拼：`sh_<tag>_<实体id>_<该实体第几层盾>` */
  tag?: string;
  /** ★ 第 85 轮：单次受击上限（0..1，相对该次伤害）。不给 = 不设上限 */
  perHitRatio?: number;
}

export const EntityType = { SHIKIGAMI: "SHIKIGAMI", ONMYOJI: "ONMYOJI", SUMMON: "SUMMON", SPECIAL_SUMMON: "SPECIAL_SUMMON" } as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

/**
 * 阴阳师双体系。依据**数据自身的 grade 字段**（不是我们的猜测）：
 *   - 灰机 Data:Character/10|11|12|13.json 的 grade = "阴阳师"
 *   - 灰机 Data:Character/15|16.json       的 grade = "英杰"
 * 老 xlsx（2020）同样把 10-13 标为"阴阳师"，源赖光当时是 编号7005/ID36/稀有度空 —— 从未归入阴阳师。
 * 两套体系的属性来源不同：CLASSIC 走御灵养成，CLAN_HERO 不明。
 */
export const OnmyojiSystem = {
  CLASSIC_GUARDIAN: "CLASSIC_GUARDIAN",
  CLAN_HERO: "CLAN_HERO",
} as const;
export type OnmyojiSystem = (typeof OnmyojiSystem)[keyof typeof OnmyojiSystem];

export type OnmyojiStatsSource = "GUARDIAN" | "NONE" | "UNKNOWN";

export interface OnmyojiProfile {
  system: OnmyojiSystem;
  /** 数据原始 grade 字段，不做加工 */
  gradeRaw: string;
  /** 御灵（神龙/白藏主/孔雀/黑豹）。CLASSIC 体系的面板由御灵养成决定。 */
  guardian: { name: string; level: number | null; stats: Record<string, number> | null } | null;
  statsSource: OnmyojiStatsSource;
  statsConfidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  aiAvailable: boolean;
  notes: string[];
}

export interface EntityCapabilities {
  advancesOrbGauge: boolean; occupiesSummonSlot: boolean;
  countsForVictory: boolean; canBeTargeted: boolean; persistsAcrossRound: boolean;
  /**
   * ★★★ 第 130 轮：**能不能被治疗/恢复**（KB：百羽凤凰火「未熄羽」——「无法被治疗或[恢复]生命」）。
   *   它是**能力**（跟着单位走、进 state）而不是一条状态 —— 原文没有时限、也没有可驱散性。
   *   ★ 之前没有任何字段接住这句话：治疗照样落在它身上（探针实测 0 → 16767 点），
   *     而那句话在 Fidelity 里**一个字都没报**（动词表里没有这个动词）。
   */
  receivesHeal: boolean;
}

export class Entity {
  id: number; name: string; teamId: number;
  /** ★ G0：知识库身份。状态序列化后要靠它重建运行时（技能/AI/御魂 handler）。 */
  shikigamiId: number | null = null;
  /** 该单位装备的御魂 id（竞猜口径下是"4 件套生效"的图标） */
  soulIds: number[] = [];
  type: EntityType = EntityType.SHIKIGAMI;
  caps: EntityCapabilities = { advancesOrbGauge: true, occupiesSummonSlot: false, countsForVictory: true, canBeTargeted: true, persistsAcrossRound: true, receivesHeal: true };
  base: Record<string, number> = {};
  /** 效果列表（FIXED / ADD_RATE 等），属性读取时实时折叠 */
  effects: Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE" | "SET"; source: string }> = [];
  hp = 1; maxHp = 1;
  statuses: ActiveStatus[] = [];
  shields: Shield[] = [];
  alive = true;
  /** ★ 三个状态必须分开：HP<=0 != DEAD != KILLED（红区 C） */
  hpZero = false; dead = false; killed = false; killCredit: number | null = null;
  transformed = false; reviveBlocked = false; undeathUsed = false;
  skills: any[] = [];
  notes: string[] = [];
  /** 仅当 type === ONMYOJI 时存在 */
  onmyoji: OnmyojiProfile | null = null;
  /** 本场已使用过的技能名（AI 的「未使用N技能时」需要真实状态，不能恒为真） */
  usedSkills = new Set<string>();

  constructor(id: number, name: string, teamId: number, base: Record<string, number>, shikigamiId: number | null = null) {
    this.id = id; this.name = name; this.teamId = teamId; this.shikigamiId = shikigamiId;
    this.base = { ...base };
    this.maxHp = base.hp ?? 1; this.hp = this.maxHp;
  }
  /** 官方[23] 初始 = 基础属性 + 御魂提供；此处用 effects 折叠 */
  /**
   * 会被钳到非负的字段 = 八维面板属性。其余（伤害修正 / 减疗 这类纯效果字段）允许为负。
   * 见 prop() 里的注释：把负数一律钳成 0 会让"减益"静默失效。
   */
  static readonly PANEL_STATS = new Set(["atk", "hp", "def", "spd", "cri", "crid", "efh", "efr"]);

  prop(p: string): number {
    let fixed = this.base[p] ?? 0; let rate = 0; let set: number | null = null;
    for (const e of this.effects) {
      if (e.prop !== p) continue;
      if (e.mode === "FIXED") fixed += e.value;
      else if (e.mode === "ADD_RATE") rate += e.value;
      else set = e.value;
    }
    const v = set !== null ? set : fixed * (1 + rate);
    /**
     * ★★ 第 44 轮：负值过去被**一律**钳到 0。
     *
     * 对 atk/hp/def/spd 这类**面板属性**，钳非负是对的（属性不能为负）。
     * 但对**纯效果字段**（伤害修正、减疗）它是**静默作废**：
     * buff 文案写「造成伤害降低30%」→ 编译器算出 -0.3 → prop() 读回 0，
     * 于是"减益"变成"没有效果"，而且没有任何地方报错、没有任何测试变红。
     * 实测（报告 §36）：338 条 buff 里有 4 条正落在这个坑里（符咒·破 / 猪鹿蝶 / 隐匿 …）。
     *
     * 现在按字段区分：面板属性照旧钳非负；效果字段保留符号，
     * 由伤害管线自己去解释"正 = 挨得更多 / 负 = 挨得更少"。
     */
    if (Entity.PANEL_STATS.has(p)) return Math.max(0, v);
    return v;
  }
  get speed(): number { return this.prop("spd"); }
  statusDefs(): StatusDef[] { return this.statuses.map(s => s.def); }
  hasStatus(id: string): boolean { return this.statuses.some(s => s.def.id === id); }
  /** 状态标签发号器。**是可观测状态**（决定 st1/st2 的 tag，tag 又是 effects 回收依据），
   *  因此必须能序列化/恢复 —— G0 的逐字节比对就是在这里抓到差异的。 */
  /**
   * ★ Modifier 生命周期（a1-4 §6/§7）：所有属性改动都必须**带来源**，并且能按来源整批回收。
   * 之前御魂叠层是直接 effects.push —— 一旦触发条件不再成立（或整场重来），
   * 没有任何统一入口能把它收回去，只能靠作者自觉。
   */
  /**
   * ★ 设置"能否被敌方选中"。无敌 / 放逐 / 隐匿 类效果必须走这里，而不是直接改 caps，
   * 这样才有事件可查（否则又是一个"改了但看不见"的隐式状态）。
   * 注意：不影响 aliveMembers / 胜负判定 —— 不可选中 ≠ 不计入胜负。
   */
  setTargetable(v: boolean, reason: string): void {
    if (this.caps.canBeTargeted === v) return;
    this.caps.canBeTargeted = v;
    this.notes.push(`targetable=${v} by ${reason}`);
  }

  addModifier(m: { prop: string; value: number; mode: "FIXED" | "ADD_RATE" | "SET"; source: string }): void {
    if (!m.source) throw new Error("modifier 必须有 source：无来源的属性改动无法回收，也不可审计");
    this.effects.push({ prop: m.prop, value: m.value, mode: m.mode, source: m.source });
  }
  /** 按来源前缀回收（例如 soul12: 回收 12 号御魂的全部叠层），返回回收条数 */
  removeModifiersBySource(prefix: string): number {
    const before = this.effects.length;
    this.effects = this.effects.filter(e => !String(e.source).startsWith(prefix));
    return before - this.effects.length;
  }
  /** 某来源当前挂着几条 modifier（审计与测试用） */
  modifierCount(prefix: string): number { return this.effects.filter(e => String(e.source).startsWith(prefix)).length; }
  /** 所有 modifier 的来源清单（去重）——「有没有匿名改动」一眼可见 */
  modifierSources(): string[] { return [...new Set(this.effects.map(e => String(e.source)))]; }

  statusSeq = 0;
  /**
   * ★★★ 第 94 轮：**`reviveBlocked` 此前从来没有被置为 true。**
   *
   * 它是一个字段、被 state.ts 序列化、被 Battle.revive 读来挡复活 —— 但**没有任何写入方**。
   * 数据其实一直在：338 条 buff 定义里有 2 条写着「无法被复活 / 无法触发复活效果」
   * （屹立不倒 3341_1、破碎印记 3143_1）。这一轮把状态与它接起来，这里是**唯一写入方**。
   * 判据（tests/g55 第 [4] 节）：挂着这种状态时复活失败，状态消失后同一目标又能被复活。
   */
  refreshReviveBlock(): void { this.reviveBlocked = hasReviveBlock(this.statuses); }

  /**
   * ★★★ 第 122 轮：**状态 / 护盾的生产点只报事实，派发交给 Battle**。
   *
   * 为什么不在这里直接 dispatch：`dispatch` 是 async，而 `addStatus` / `addShield` 是同步方法 ——
   * 硬 await 会把它们全变成 async（涟漪到几十个调用点），不 await 就是悬空 Promise。
   * 所以只把事实同步塞进这个 sink，由 Battle 入队（queueEvent）并在安全点 drain ——
   * 与 kernel/battle.ts 的 drainEvents 是同一套机制。
   *
   * ★ 口径边界（如实写）：走 sink 的只有 **STATUS_ADD** 与 **SHIELD_CREATE**；
   *   STATUS_EXPIRE / STATUS_REMOVE 仍由**具体调用点**派发（kernel/battle.ts 的状态计时、
   *   kernel/damage.ts 的免死耗尽、compile/character.ts 的驱散）—— 两处都派发会变成双事件。
   *   将来若要统一，先把那三处拆掉再改成 sink。
   */
  eventSink?: (kind: "STATUS_ADD" | "SHIELD_CREATE", payload: any) => void;

  /** 附加状态。effects 会随状态到期一并回收（否则属性加成长局失真）。 */
  addStatus(def: StatusDef, sourceId: number, stacks = 1, duration = 1,
            effects: Array<{ prop: string; value: number; mode: "FIXED" | "ADD_RATE" }> = [],
            cap: number | null = null): ActiveStatus {
    const ex = this.statuses.find(s => s.def.id === def.id && s.sourceId === sourceId);
    if (ex) {
      // ★★★ 第 78 轮：**层数封顶**。此前只有 `ex.stacks += stacks` —— 全库没有一处读上限，
      //   于是「上限4层」的状态会无限叠（而「每层提升5%攻击」这类效果跟着一起失真）。
      //   上限只写在技能原文里（338 条 buff 定义里 0 条写了），由 compile/skill-compiler.ts 的
      //   `statusCaps` 解析、character.ts 传进来。**第一次施加时记下**，之后一直用它封顶 ——
      //   因为先施加的那个技能才写明了上限。没写上限 = 不封顶（保持旧语义）。
      const limit = ex.cap ?? cap ?? null;
      if (limit !== null) ex.cap = limit;
      ex.stacks = limit === null ? ex.stacks + stacks : Math.min(ex.stacks + stacks, limit);
      ex.remaining = Math.max(ex.remaining, duration);
      for (const e of effects) { const tag = ex.tag + ":" + (ex.effects.length); ex.effects.push({ ...e, tag }); this.effects.push({ ...e, source: tag }); }
      if (def.blocksRevive) this.refreshReviveBlock();
      this.eventSink?.("STATUS_ADD", { status: ex, merged: true, stacks, duration });
      return ex;
    }
    const limit = cap !== null && cap > 0 ? cap : null;
    const a: ActiveStatus = { def, sourceId, stacks: limit === null ? stacks : Math.min(stacks, limit), cap: limit, remaining: duration, effects: [], tag: `st${++this.statusSeq}` };
    for (const e of effects) { const tag = a.tag + ":" + a.effects.length; a.effects.push({ ...e, tag }); this.effects.push({ ...e, source: tag }); }
    this.statuses.push(a);
    if (def.blocksRevive) this.refreshReviveBlock();
    this.eventSink?.("STATUS_ADD", { status: a, merged: false, stacks, duration });
    return a;
  }
  /**
   * ★★★ 第 121 轮：状态回收**只有这一份实现**。expireStatus / dispel / remove 三个入口都必须走它。
   *
   * 由来（实测，不是推理）：`dispel` / `remove` 此前只 `statuses.splice(...)` + refreshReviveBlock，
   *   **不回收 `st.effects`** —— 于是「驱散」掉一个带属性加成的状态后，那条加成**留在单位身上**。
   *   探针（tools/_probe-dispel121.ts）：给单位加 +100 攻击的增益 → `dispel()` 之后
   *   攻击仍然 +100，`effects` 里还留着一条**没有主人**的 effect。
   *   长局里这类泄漏会持续累积 —— 正是 Fidelity 要抓的那类「看不见的漂移」。
   */
  private recycleStatus(st: ActiveStatus): void {
    const tags = new Set(st.effects.map(e => e.tag));
    this.effects = this.effects.filter(e => !tags.has(e.source));
    this.refreshReviveBlock();
  }
  /** 状态到期/被驱散/被解除时的统一回收 */
  expireStatus(st: ActiveStatus): boolean {
    const i = this.statuses.indexOf(st);
    if (i < 0) return false;
    this.statuses.splice(i, 1);
    this.recycleStatus(st);
    return true;
  }
  /** 官方[8] 驱散：移除效果、状态。能否驱散看 dispellable（官方[3] 后九者不可驱散） */
  dispel(id: string, force = false): boolean {
    const i = this.statuses.findIndex(s => s.def.id === id && (force || s.def.dispellable));
    if (i < 0) return false;
    const st = this.statuses[i];
    this.statuses.splice(i, 1);
    this.recycleStatus(st);   // ★ 第 121 轮：回收属性加成（此前漏了这一步）
    return true;
  }
  /** 官方[1] 解除：移除无法被驱散的控制效果。能否解除看 removable（官方[3] 霜冻不可解除） */
  remove(id: string, force = false): boolean {
    const i = this.statuses.findIndex(s => s.def.id === id && (force || s.def.removable));
    if (i < 0) return false;
    const st = this.statuses[i];
    this.statuses.splice(i, 1);
    this.recycleStatus(st);   // ★ 第 121 轮：同上
    return true;
  }

  /** 唯一的 HP 变更入口。四条管线严格分开（官方[20][21]）。 */
  /**
   * ★ 返回 hpBefore / hpAfter：这两个值是**唯一知道真相的地方**产出的。
   *   调用方从 applied 反推 before 会在溢出、封顶、护盾吸收三种情形下算错 ——
   *   而 G6 对照要拿它跟玩家从画面上读到的血量逐条比，错一位就会指向错误的分歧点。
   */
  /**
   * ★★★ 护盾的**唯一**写入口（第 57 轮）。
   *
   * 收口之前，`shields` 数组被两处各自 push：技能（compile/character.ts，可驱散）与
   * 御魂蚌精（soul/effect-system.ts，不可驱散）。两个地方各写一遍字段，等于把「护盾是什么」
   * 摊在两处 —— 而它们**真的不一致**（id 生成方式、dispellable、默认值），谁都不是权威。
   *
   * ★ 为什么 id 必须确定性：shields 会被序列化进 BattleState（kernel/state.ts），
   *   进而进 stateHash。收口之前技能盾的 id 是 `sh_<技能>_` + Math.random()，
   *   于是**同一份输入、同一个 seed，两次运行的 stateHash 不同**（实测见 tests/g36）。
   *   胜负与胜率不受影响（战斗 RNG 没被碰），但「同一场战斗」不再有同一个指纹 ——
   *   Replay determinism（目标 ⑩）与 G3 的逐帧校验都建立在这个指纹上。
   *
   * ★ 生成的序号取 `this.shields.length`：它是**已经被序列化的状态**，
   *   所以存档 → 重载 → 续跑之后仍然接得上，不需要额外字段（G0 的不变量不因此变化）。
   *   护盾只会被打破（broken=true），不会被从数组里移除 —— 序号单调递增，id 不会撞。
   */
  addShield(spec: ShieldSpec): Shield {
    const id = spec.id ?? ("sh_" + (spec.tag ?? "x") + "_" + this.id + "_" + this.shields.length);
    const sh: Shield = {
      id,
      value: spec.value,
      dispellable: spec.dispellable ?? true,
      sourceId: spec.sourceId,
      consumed: 0,
      broken: false,
      // ★ undefined 而非 0：JSON.stringify 会丢掉 undefined，于是**没上限的盾指纹不变**
      ...(spec.perHitRatio !== undefined ? { perHitRatio: spec.perHitRatio } : {}),
    };
    this.shields.push(sh);
    this.eventSink?.("SHIELD_CREATE", { shield: sh, spec });
    return sh;
  }

  mutateHp(kind: HpMutation, amount: number, src: string): { applied: number; absorbed: number; overkill: number; hpBefore: number; hpAfter: number; shieldBroken: number } {
    if (!this.alive) return { applied: 0, absorbed: 0, overkill: 0, hpBefore: this.hp, hpAfter: this.hp, shieldBroken: 0 };
    if (kind === HpMutation.DAMAGE) {
      let remaining = amount; let absorbed = 0; let shieldBroken = 0;
      for (const sh of this.shields) {
        if (remaining <= 0 || sh.broken) continue;
        // ★★★ 第 85 轮：**单次受击上限**。此前一律 `min(sh.value, remaining)` ——
        //   一击就能把整个盾池吸干。而原文写的是「最多抵挡该次伤害的40%」
        //   （童男/童女「羽衣」），即这一击最多只能被它吸走 40%。
        //   ★ 上限只作用于**这一盾**对该次伤害的吸收量，不改变伤害计算本身。
        const cap = sh.perHitRatio !== undefined ? amount * sh.perHitRatio : Number.POSITIVE_INFINITY;
        const take = Math.min(sh.value, remaining, cap);
        sh.value -= take; sh.consumed += take; remaining -= take; absorbed += take;
        if (sh.value <= 0) { sh.broken = true; shieldBroken++; this.notes.push(`shield ${sh.id} broken`); }
      }
      const before = this.hp;
      this.hp = Math.max(0, this.hp - remaining);
      const applied = before - this.hp;
      if (this.hp <= 0) this.hpZero = true;
      return { applied, absorbed, overkill: remaining - applied, hpBefore: before, hpAfter: this.hp, shieldBroken };
    }
    if (kind === HpMutation.LOSS) {
      // 官方[21]：不暴击、无法被护盾吸收、不触发受到伤害相关效果
      const before = this.hp;
      this.hp = Math.max(0, this.hp - amount);
      if (this.hp <= 0) this.hpZero = true;
      return { applied: before - this.hp, absorbed: 0, overkill: 0, hpBefore: before, hpAfter: this.hp, shieldBroken: 0 };
    }
    if (kind === HpMutation.HEAL) {
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + amount);
      return { applied: this.hp - before, absorbed: 0, overkill: 0, hpBefore: before, hpAfter: this.hp, shieldBroken: 0 };
    }
    // RECOVER：官方[20] 不受减疗影响，不触发治疗相关效果
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return { applied: this.hp - before, absorbed: 0, overkill: 0, hpBefore: before, hpAfter: this.hp, shieldBroken: 0 };
  }
}
