// kernel/events.ts — 冻结的 Event Model
// 官方语义来源：data/kb/glossary.core.json
// 流程：collect candidates -> priority resolution -> queue -> resolve
// ★ 同优先级如何排序 = 红区 B（未实测），由 PriorityPolicy 决定，绝不硬编码。
import type { EventRange } from "./types.ts";
import type { ResolutionScope } from "./resolution.ts";

export interface Handler {
  id: string;
  ownerId: number;
  code: string;
  range: EventRange;
  priority: number;
  passive: boolean;
  /**
   * ★★★ 第 96 轮：这个处理器属于**哪一类来源** —— 它决定"封印"该不该挡它。
   *   `"PASSIVE"` = 式神被动技能（被 `suppressPassive` 挡）；
   *   `"SOUL"`    = 御魂战斗效果（被 `suppressSoul` 挡）；
   *   不写 = 不受封印影响（Dummy 探针、测试探针、Battle 自己的内部钩子）。
   * ★ 为什么必须显式声明而不是"猜"：唯一能区分它们的线索是注册 id 的前缀字符串，
   *   而按字符串猜会在改名时静默失效 —— 那正是本项目反复抓到的"静默"类缺陷。
   */
  source?: "PASSIVE" | "SOUL";
  once?: boolean;
  fn: (ctx: any) => void | Promise<void>;
}

/**
 * ★ a1-4 §22：ResolutionKey —— **所有**候选（被动 / 御魂 / 状态 / 死亡 / 反击 / 协战 / 环境）
 * 都折算成同一把排序键，再进同一个 Resolver。
 *
 * 规格给的比较链（六级，逐级下降）：
 *   phase ↓ order ↓ priority DESC ↓ subOrder ↓ speed DESC ↓ seeded tieBreak
 *
 * 这么做的价值规格里写得很清楚：
 *   「这样 B 组实测的结果只是：**填阴阳师的 ResolutionKey 规则**，而不是推翻 Engine。」
 * 也就是说红区（未实测的排序规则）只影响 PriorityPolicy 填哪几级，
 * 比较链本身不需要动 —— 这正是这一层存在的理由。
 *
 * 当前 phase / order 恒为 0（还没有需要粗粒度分组的事件），
 * 但比较链把它们放在最前面：那是留给「阶段 / 批次」这类粗排序的位置。
 */
export interface ResolutionKey {
  phase: number;
  order: number;
  /** 越大越先（DESC） */
  priority: number;
  subOrder: number;
  /** 越大越先（DESC）；undefined 视为 0 */
  speedOrder?: number;
  /** 越小越先（ASC）：并列时的最终裁决，通常是注册序号或种子随机数 */
  tieBreak: number;
}

/**
 * ★ 比较链只有这一处实现。红区实验改的是 PriorityPolicy 填哪几级，**不是这里** ——
 *   如果哪天为了某个假设必须动这个函数，就说明 §22 的分层没设计对。
 */
export function compareResolutionKey(a: ResolutionKey, b: ResolutionKey): number {
  if (a.phase !== b.phase) return a.phase - b.phase;
  if (a.order !== b.order) return a.order - b.order;
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.subOrder !== b.subOrder) return a.subOrder - b.subOrder;
  const sa = a.speedOrder ?? 0, sb = b.speedOrder ?? 0;
  if (sa !== sb) return sb - sa;
  return a.tieBreak - b.tieBreak;
}

export interface OrderCtx {
  teamOf?: (id: number) => number;
  speedOf?: (id: number) => number;
  actorTeam?: number | null;
}

/** 把候选折算成完整的 ResolutionKey：基线全 0，再由策略填它负责的层级 */
export function resolutionKeyOf(h: Handler, policy: PriorityPolicy, insertion: Map<string, number>, ctx?: OrderCtx): ResolutionKey {
  return { phase: 0, order: 0, priority: h.priority, subOrder: 0, speedOrder: undefined, tieBreak: 0, ...policy.keyOf(h, insertion, ctx) };
}

export interface PriorityPolicy {
  id: string;
  /** 状态：UNKNOWN = 未实测；HYPOTHESIS = 有依据的假设；VERIFIED = 已实测确认 */
  status: "UNKNOWN" | "HYPOTHESIS" | "VERIFIED";
  question: string;
  /**
   * ★ 只填**它负责的那几级**，其余留空（=0）。
   *   留空不是「没实现」，而是「这一级上不表态」：UNDETERMINED 全部留空，
   *   于是比较结果为 0、顺序退回稳定排序（= 收集顺序），而键本身诚实地写着「没有裁决」。
   *   若把 UNDETERMINED 填成注册序号，行为一样，但键会**谎称**做过裁决 —— 不许这样。
   */
  keyOf(h: Handler, insertion: Map<string, number>, ctx?: OrderCtx): Partial<ResolutionKey>;
  evidence?: string;
}

/** 行动方一侧记 0、另一侧记 1；没有行动方上下文时一律 0（= 不表态） */
function sideRank(h: Handler, ctx: OrderCtx | undefined, selfFirst: boolean): number {
  const at = ctx?.actorTeam ?? null;
  if (at === null || !ctx?.teamOf) return 0;
  const isActorSide = ctx.teamOf(h.ownerId) === at;
  return selfFirst ? (isActorSide ? 0 : 1) : (isActorSide ? 1 : 0);
}

export const PriorityPolicies: Record<string, PriorityPolicy> = {
  REGISTRATION_ORDER: {
    id: "REGISTRATION_ORDER", status: "HYPOTHESIS",
    question: "同优先级事件按注册顺序结算？",
    keyOf: (h, ins) => ({ tieBreak: ins.get(h.id) ?? 0 }),
    evidence: "omj_simulator 的实现方式，未对官方验证",
  },
  TEAM_THEN_SPEED: {
    id: "TEAM_THEN_SPEED", status: "HYPOTHESIS",
    question: "同优先级事件按 队伍顺序 -> 速度 结算？",
    keyOf: (h, ins, ctx) => ({ subOrder: ctx?.teamOf?.(h.ownerId) ?? 0, speedOrder: ctx?.speedOf?.(h.ownerId) ?? 0, tieBreak: ins.get(h.id) ?? 0 }),
    evidence: "社区常说‘速度快的先’，未对官方验证",
  },
  SPEED_DESC: {
    id: "SPEED_DESC", status: "HYPOTHESIS",
    question: "同优先级事件按 速度降序 结算（不分队伍）？",
    keyOf: (h, ins, ctx) => ({ speedOrder: ctx?.speedOf?.(h.ownerId) ?? 0, tieBreak: ins.get(h.id) ?? 0 }),
    evidence: "A01 的候选假设；未对官方验证",
  },
  SELF_SIDE_FIRST: {
    id: "SELF_SIDE_FIRST", status: "HYPOTHESIS",
    question: "同优先级事件：行动方的效果先于对方结算？",
    keyOf: (h, ins, ctx) => ({ subOrder: sideRank(h, ctx, true), tieBreak: ins.get(h.id) ?? 0 }),
    evidence: "B01 的候选假设；社区常说『攻方先算』，未对官方验证",
  },
  OTHER_SIDE_FIRST: {
    id: "OTHER_SIDE_FIRST", status: "HYPOTHESIS",
    question: "同优先级事件：对方（受击方）的效果先于行动方结算？",
    keyOf: (h, ins, ctx) => ({ subOrder: sideRank(h, ctx, false), tieBreak: ins.get(h.id) ?? 0 }),
    evidence: "B01 的候选假设；未对官方验证",
  },
  UNDETERMINED: {
    id: "UNDETERMINED", status: "UNKNOWN",
    question: "同优先级事件的真实排序规则未知 —— 必须做 B 组实验",
    // ★ 全部留空：键上写着「没有裁决」，顺序退回稳定排序（= 收集顺序 = 注册顺序）。
    //   行为与「按注册序号」相同，但**不许**把 tieBreak 填成注册序号 —— 那会让键谎称做过裁决。
    keyOf: () => ({}),
  },
}

export interface DispatchRecord {
  code: string; candidateCount: number; order: string[]; policyId: string;
}

/**
 * ★ G1：事件链节点（a1-4.md §28「Event 必须有 Parent/Root」）。
 * 有了它，Theater / Inspector 才能回答"这次伤害是被哪次技能触发的、再往上是谁"。
 */
export interface EventNode {
  seq: number;
  code: string;
  parent: number | null;
  root: number;
  depth: number;
  handlerCount: number;
  /** 该事件解析期间产生的事件 seq（子节点） */
  children: number[];
  /**
   * ★ a1-4 §31：「事件知道自己在哪个 Scope」。
   *   当前最内层的 ResolutionScope（SKILL / HIT / EFFECT / TRIGGER），
   *   不在任何 scope 内时为 null。Inspector 用它回答「这次伤害属于哪一段」。
   */
  scope: ResolutionScope | null;
}


/**
 * ★★★ 第 129 轮：**死亡级联**的事件码 —— 这几个码即使在拥有者已经阵亡时也照常投递。
 *
 * 判据是"这个事件讲的是不是他倒下这件事本身"：LETHAL（致命一击）/ DEATH_PREVENTION（免死拦截）/
 * DEATH（已阵亡）/ KILLED（击杀结算）/ REVIVE（复活）。
 * 排除它们会让「阵亡时，若拥有4层…立即复活」这一类原文**永远无法触发**（第 129 轮实测）。
 */
export const DEATH_CASCADE_CODES = new Set<string>(["LETHAL", "DEATH_PREVENTION", "DEATH", "KILLED", "REVIVE"]);

export class EventBus {
  private handlers: Handler[] = [];
  private insertion = new Map<string, number>();
  private seq = 0;
  policy: PriorityPolicy = PriorityPolicies.UNDETERMINED;
  /** 供排序策略查询实体归属与速度（由 Battle 注入） */
  resolver: { teamOf?: (id: number) => number; speedOf?: (id: number) => number; actorTeam?: number | null } = {};
  /** 当前行动方所在队伍（B 组"攻击方/防守方事件优先"策略需要） */
  actorTeam: number | null = null;
  readonly log: DispatchRecord[] = [];
  /** 被封印的被动（官方[106] 压制 / [107] 变形） */
  suppressedPassive = new Set<number>();
  /**
   * ★★★ 第 96 轮：**封印**（官方[105] 压制 / [107] 变形）的第二个判据源。
   *
   * 那个 Set 从第 10 轮起就在、`collect()` 也一直在读它，但生产代码里**没有一个写入方**
   * （只有 experiments 脚手架会写）—— 于是"被动能不能被封印"这件事在真实对局里永远为假。
   *
   * 这一轮不往那个 Set 里写（它是**不序列化**的：存档/续跑会丢），而是让 Battle 注入一个**求值器**：
   *   `suppressProvider(id) → { passive, soul }`，由 Battle 读**该单位身上有没有带封印标记的状态**。
   * ⇒ 封印状态与其它状态一样进 state（G0 天然成立）、进指纹、可重放；
   *   而 Set 保留原样（既有实验脚手架与旧调用方不受影响，两处判据是**或**的关系）。
   */
  suppressProvider: ((id: number) => { passive: boolean; soul: boolean }) | null = null;
  /**
   * ★★★ 第 129 轮：**「阵亡的单位不再做事」由总线自己保证，而不是靠注销订阅来实现。**
   *
   * 由来（探针 tools/_probe-revive129c.ts 实测）：死亡路径里有 `unregisterOwner(target.id)`，
   * 它把该单位的**全部**处理器删掉（被动 / 御魂 / 召唤物钩子）—— 于是
   *   · 复活之后那个单位**永久失去所有订阅**：探针里三尾狐「诱惑」在阵亡前挨打回流 200 点，
   *     复活后再派发同一条 AFTER_DAMAGE，**一条 trace 都没有**（不是少算，是彻底不响应）；
   *   · 更硬的一条：「阵亡时」这一族**永远不可能触发** —— 注销发生在 EV.DEATH 派发**之前**
   *     （battle.ts 的 resolveLethal），也就是说死亡瞬间自己的处理器已经被摘掉了。
   *
   * 正确做法有两条路：① 复活时重建订阅；② 订阅不动，**派发时按存活状态挡**。
   * 这里选 ②：重建订阅会丢掉处理器的闭包状态（御魂「无刀取」的层数计数就是这个形状），
   * 而且"谁该重建"要在四处注册点各写一遍 —— 那正是会分叉的地方。
   * 于是：处理器留在表里，由 `ownerActive` 求值器回答"这个拥有者现在还算在场吗"。
   *
   * ★ 求值器由 Battle 注入（与 suppressProvider / scopeProvider 同一套做法），
   *   EventBus 仍然对 Battle 一无所知；**没有注入时一律放行**（旧行为，实验脚手架不受影响）。
   * ★ 失败开启的方向是刻意的：判据要的是"**已知且已阵亡**"，不是"查不到就拦"。
   */
  ownerActive: ((id: number) => boolean) | null = null;
  /**
   * ★ a1-4 §31：事件从哪里问「我在哪个 Scope」。由 Battle 注入（读它的 resolutionStack）。
   *   用回调而不是让 EventBus 持有栈，是为了让 EventBus 保持对 Battle 一无所知。
   */
  scopeProvider: (() => ResolutionScope | null) | null = null;
  private currentScope(): ResolutionScope | null { return this.scopeProvider?.() ?? null; }

  // ─────────── ★ G1：事件链与递归保护 ───────────
  /** 事件历史：Theater 的"状态时间轴"直接读它 */
  readonly chain: EventNode[] = [];
  private nodes = new Map<number, EventNode>();
  private evSeq = 0;
  private cursor: number | null = null;
  private curDepth = 0;
  /** 递归上限：超过就**记录并丢弃**，绝不让它把调用栈打爆（a1-4 §27） */
  maxDepth = 64;
  overflowCount = 0;
  /** 溢出发生时立刻回调（Battle 用它写一条 EVENT_OVERFLOW trace）：留痕不能等到战斗结束 */
  onOverflow: ((info: { total: number; code: string; maxDepth: number }) => void) | null = null;

  /** 当前正在解析的事件 seq（此刻产生的 trace 都属于它） */
  get currentEvent(): number | null { return this.cursor; }
  get depth(): number { return this.curDepth; }
  node(seq: number): EventNode | undefined { return this.nodes.get(seq); }
  /** ★ G1：事件序号也要能续（否则续跑的战斗里每条 trace 的 ev 都从 1 重来，与连续跑对不上） */
  seqSnapshot(): number { return this.evSeq; }
  seqRestore(n: number): void { this.evSeq = n; }
  /** 从任意事件回溯到根，供 Inspector 展示事件链 */
  ancestry(seq: number): EventNode[] {
    const out: EventNode[] = [];
    let cur: EventNode | undefined = this.nodes.get(seq);
    let guard = 0;
    while (cur && guard++ < 256) { out.push(cur); cur = cur.parent === null ? undefined : this.nodes.get(cur.parent); }
    return out.reverse();
  }

  register(h: Handler): void { this.handlers.push(h); this.insertion.set(h.id, this.seq++); }

  /**
   * ★ 第 140 轮：**公开的"这条订阅在不在"**。
   *   handler 表是私有的，而"装之前先查重"（幂等安装）需要问它 ——
   *   kernel/summon.ts 当年是拿 `battle: any` 绕过类型去读私有字段的，
   *   于是那条路径**看起来**没有类型问题，实际上绕过了封装。这里补一个正经入口。
   */
  hasHandler(id: string): boolean { return this.handlers.some(h => h.id === id); }
  /**
   * ★★★ 第 129 轮：**这个方法现在只有一处生产调用方 —— 撤销「被移除的放置单位」**（kernel/summon.ts）。
   *   `resolveLethal` 里那一处已经删掉（见 ownerActive 的注）：死亡**不再**等于注销订阅，
   *   否则复活带不回它们，而「阵亡时」的处理器在死亡那一刻就已经不存在了。
   */
  unregisterOwner(ownerId: number): void { this.handlers = this.handlers.filter(h => h.ownerId !== ownerId); }

  collect(code: string, selfId: number, teamId: number, teamOf: (id: number) => number): Handler[] {
    const out: Handler[] = [];
    for (const h of this.handlers) {
      if (h.code !== code) continue;
      // ★ 第 96 轮：封印挡两类处理器 —— 被动技能（PASSIVE）与御魂效果（SOUL）。
      //   判据是"或"：旧的 Set（实验脚手架会写）与新的求值器（读状态）任一为真都算被封印。
      if (h.passive && this.suppressedPassive.has(h.ownerId)) continue;
      if (h.source === "PASSIVE" || h.source === "SOUL") {
        const s = this.suppressProvider?.(h.ownerId) ?? null;
        if (s && (h.source === "PASSIVE" ? s.passive : s.soul)) continue;
      }
      /**
       * ★★★ 第 129 轮：**阵亡者不做事**（见 ownerActive 的注）。
       *   · `ownerId === 0` 是"全局订阅者"（Battle 自己用的那些），从来不是某个单位，**不挡**；
       *   · 死亡级联（LETHAL / DEATH_PREVENTION / DEATH / KILLED / REVIVE）**豁免** ——
       *     这一族的存在意义正是"**这个单位刚刚倒下了**"：它自己身上的「阵亡时」处理器
       *     必须能在这一刻跑（触发式复活就挂在上面）。
       */
      if (h.ownerId !== 0 && !DEATH_CASCADE_CODES.has(code) && this.ownerActive?.(h.ownerId) === false) continue;
      const ownerTeam = teamOf(h.ownerId);
      switch (h.range) {
        case "SELF":  if (h.ownerId !== selfId) continue; break;
        case "TEAM":  if (ownerTeam !== teamId) continue; break;
        case "ENEMY": if (ownerTeam === teamId) continue; break;
        case "ALL":   break;
      }
      out.push(h);
    }
    return out;
  }

  /**
   * ★ G1：把一个**动作**本身变成一个事件节点（a1-4 §14 Action 系统）。
   * 与 dispatch 的区别：dispatch 是"通知订阅者"，within 是"我现在要做一件事，做这件事期间
   * 产生的一切（技能、伤害、上状态、被动连锁）都挂在它下面"。
   * 没有它，trace 里的大部分条目 ev=null —— Theater 就无法回答"这条伤害属于哪次行动"。
   */
  async within(code: string, ctx: any, selfId: number, teamId: number, teamOf: (id: number) => number, fn: () => Promise<void> | void): Promise<number | null> {
    if (this.curDepth >= this.maxDepth) { this.overflowCount++; this.onOverflow?.({ total: this.overflowCount, code, maxDepth: this.maxDepth }); return null; }
    const seq = ++this.evSeq;
    const parent = this.cursor;
    const node: EventNode = {
      seq, code, parent,
      root: parent === null ? seq : (this.nodes.get(parent)?.root ?? seq),
      depth: this.curDepth, handlerCount: 0, children: [], scope: this.currentScope(),
    };
    this.nodes.set(seq, node);
    this.chain.push(node);
    if (parent !== null) this.nodes.get(parent)?.children.push(seq);
    const prevCursor = this.cursor, prevDepth = this.curDepth;
    this.cursor = seq; this.curDepth = prevDepth + 1;
    try { await fn(); } finally { this.cursor = prevCursor; this.curDepth = prevDepth; }
    return seq;
  }

  async dispatch(code: string, ctx: any, selfId: number, teamId: number, teamOf: (id: number) => number): Promise<void> {
    // ★ 递归保护：被动/御魂互相触发是真实存在的，但"无限互相触发"是模型 bug。
    //   超过上限时不再进入（计入 overflowCount，由 Battle 写成一条 EVENT_OVERFLOW），
    //   宁可少算一层，也不能栈溢出把整场模拟打断。
    if (this.curDepth >= this.maxDepth) { this.overflowCount++; this.onOverflow?.({ total: this.overflowCount, code, maxDepth: this.maxDepth }); return; }

    const cands = this.collect(code, selfId, teamId, teamOf);
    // ★ a1-4 §22：候选先折算成 ResolutionKey，再由**唯一一条**比较链排序。
    //   键只算一次 —— n log n 次比较不能每次都重算键。
    const orderCtx: OrderCtx = { ...this.resolver, actorTeam: this.actorTeam };
    const keys = new Map(cands.map(h => [h, resolutionKeyOf(h, this.policy, this.insertion, orderCtx)]));
    cands.sort((a, b) => compareResolutionKey(keys.get(a)!, keys.get(b)!));
    this.log.push({ code, candidateCount: cands.length, order: cands.map(c => c.id), policyId: this.policy.id });

    const seq = ++this.evSeq;
    const parent = this.cursor;
    const node: EventNode = {
      seq, code, parent,
      root: parent === null ? seq : (this.nodes.get(parent)?.root ?? seq),
      depth: this.curDepth, handlerCount: cands.length, children: [], scope: this.currentScope(),
    };
    this.nodes.set(seq, node);
    this.chain.push(node);
    if (parent !== null) this.nodes.get(parent)?.children.push(seq);

    const prevCursor = this.cursor, prevDepth = this.curDepth;
    this.cursor = seq; this.curDepth = prevDepth + 1;
    try {
      for (const h of cands) {
        await h.fn(ctx);
        if (h.once) this.handlers = this.handlers.filter(x => x.id !== h.id);
      }
    } finally {
      this.cursor = prevCursor; this.curDepth = prevDepth;
    }
  }
}
