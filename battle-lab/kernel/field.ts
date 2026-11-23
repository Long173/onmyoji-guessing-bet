// kernel/field.ts — ★★★ 第 115 轮：**场地（幻境 / 结界）运行时**（目标 ⑨）
//
// 由来有两层：
//   ① 全库 **25 条技能**提到幻境/结界，其中 **20 条是创建类**（「创造存在2回合的幻境」「开启存在1回合的狐影结界」）——
//      而引擎里连"场上有没有这个场地"都答不出来；
//   ② 第 114 轮量出 **AI 里有 5 条规则的条件的正是它**（「自身处于幻境时」「所有友方均无狐影结界时」…）——
//      引擎既然没有这个状态，那些条件永远编译不出谓词（第 114 轮起它们不再被当成"条件成立"，但仍然是缺口）。
//
// 本轮做的是**存在性 + 持续时间 + 静态属性修正**这三件事，按同一套 Modifier 机制落地（不新增属性系统）：
//   · 创建：施放技能时写入 battle.fields，并把 spec.auras 挂到范围内（复用 PresenceAura 的实现）；
//   · 到期：回合结束时按 expiresTurn 清掉，光环按来源前缀整批回收；
//   · 查询：`entityInField` 供 AI 条件与后续机制使用。
// ★ 场地里那些**每回合触发/条件触发**的效果（「幻境中，施放技能所需鬼火不足时…」「结界中敌方目标回合开始时…」）
//   仍然没有行为代码 —— 由编译器逐句记成 FIELD_CLAUSE_NOT_MODELED，不许静默。
import type { Entity } from "./entity.ts";
import { EV } from "./types.ts";
import { StatusBook } from "./status.ts";
import { applyPresenceAuras, clearPresenceAuras } from "./summon.ts";
import type { PresenceAura } from "./summon.ts";

export type FieldKind = "ILLUSION" | "BARRIER";

export interface FieldSpec {
  kind: FieldKind;
  /** 原文里的名字（「狐影结界」「日曜结界」「命运星河幻境」…）—— 条件按它匹配 */
  name: string;
  /** 「存在N回合」；读不出来时为 1 并把 durationSource 记成 DEFAULT */
  duration: number;
  durationSource: "CLAUSE" | "DEFAULT";
  /** 静态属性修正（提升/降低 N%|N点 八维/伤害/减伤），范围来自原文（友方全体 / 敌方…） */
  auras: PresenceAura[];
  /**
   * ★★★ 第 124 轮：**场地里的每回合效果** —— 这是第 115 轮明说「仍然没有行为代码」的那一块。
   *   第一版只做**一种形状**（原文：辉夜姬「龙首之玉」的「且在回合开始前有67%概率获得1点鬼火」），
   *   其余形状（回合结束给 buff / 结界里敌方回合结束被打 / 预言判定…）继续逐句记账，不许静默。
   */
  perTurn?: FieldPerTurn;
  evidence: string;
}

/**
/**
 * 每回合效果。★ 第 125 轮从「只有 TURN_START + ORB_GAIN」扩到两种触发 × 两种效果：
 *   · TURN_START / ORB_GAIN —— 辉夜姬「龙首之玉」的「回合开始前有67%概率获得1点鬼火」（第 124 轮）；
 *   · TURN_END / STATUS_APPLY —— 神酿星熊童子「饮过三巡」的「双方目标在回合结束时有40%概率被施加[眩晕]」（第 125 轮）。
 *   其余三种形状（拉条 / 回合结束被打 / 预言判定）仍未建模，由编译器逐句记账。
 */
export interface FieldPerTurn {
  trigger: "TURN_START" | "TURN_END";
  /** ALLY = 场地拥有者一侧；ENEMY = 另一侧；ALL = 双方（「敌我双方所有非召唤物目标」） */
  scope: "ALLY" | "ENEMY" | "ALL";
  kind: "ORB_GAIN" | "STATUS_APPLY" | "TIMELINE_PUSH";
  /** ORB_GAIN：获得几点鬼火 */
  amount?: number;
  /** STATUS_APPLY：施加哪个状态（**已是 StatusBook 的 id**，由编译器从 [tips_N] 解析过来） */
  statusId?: string;
  /** STATUS_APPLY：持续回合（读不到时 1） */
  duration?: number;
  /** TIMELINE_PUSH：拉动条百分比（原文「增加20%行动条」） */
  percent?: number;
  /** 读不到概率时为 null（= 必定触发） */
  probability: number | null;
  evidence: string;
}

export interface FieldState {
  id: string;
  kind: FieldKind;
  name: string;
  ownerId: number;
  teamId: number;
  createdTurn: number;
  expiresTurn: number;
  /** ★ 第 124 轮：每回合效果随场地一起进档（否则「暂停→存档→续跑」会把它丢掉，G0 会红） */
  perTurn?: FieldPerTurn;
  evidence: string;
}

export function fieldId(spec: { kind: FieldKind; name: string }): string { return spec.kind + ":" + spec.name; }

/** 当前场上的场地（只读） */
export function fieldsOf(battle: any): FieldState[] { return (battle?.fields ?? []) as FieldState[]; }

/**
 * 某个单位"是否处于"某类场地里。
 *   · `name` 给了就按名字匹配（条件原文常带名字：「所有友方均无狐影结界时」）；
 *   · ★ 判据是**存在性**，不是"站在场地的哪一格"——引擎是离散事件模型，没有坐标。
 */
export function entityInField(battle: any, e: Entity, kind: FieldKind, name?: string): boolean {
  if (!e) return false;
  return fieldsOf(battle).some((f) => f.kind === kind && (!name || f.name.includes(name)) && f.teamId === e.teamId);
}

/** 场上有没有这一类（可选按名字）场地 —— 供「无幻境时」「不存在山行结界时」这类条件用 */
export function activeField(battle: any, kind: FieldKind, name?: string): FieldState | null {
  return fieldsOf(battle).find((f) => f.kind === kind && (!name || f.name.includes(name))) ?? null;
}

/**
 * 创建场地。★ **同名场地是替换**（原文：「重复展开幻境时，唤来…」——重复展开不是叠两层）。
 * 替换与到期走**同一条清理路径**（`clearField`），否则光环会漏撤。
 */
/** 场地还剩几回合（AI 条件「幻境剩余回合数=1时」要用它）；没有这个场地时返回 0 */
export function fieldRemaining(battle: any, kind: FieldKind, name?: string): number {
  const f = activeField(battle, kind, name);
  return f ? Math.max(0, f.expiresTurn - Number(battle?.turn ?? 0)) : 0;
}

export function createField(battle: any, owner: Entity, spec: FieldSpec): FieldState | null {
  if (!battle || !owner) return null;
  const id = fieldId(spec);
  const prev = fieldsOf(battle).find((f) => f.id === id);
  if (prev) clearField(battle, prev, "REPLACED");
  const st: FieldState = {
    id, kind: spec.kind, name: spec.name, ownerId: owner.id, teamId: owner.teamId,
    createdTurn: Number(battle.turn ?? 0),
    expiresTurn: Number(battle.turn ?? 0) + Math.max(1, spec.duration),
    ...(spec.perTurn ? { perTurn: spec.perTurn } : {}),
    evidence: spec.evidence,
  };
  if (!Array.isArray(battle.fields)) battle.fields = [];
  battle.fields.push(st);
  const auras = applyPresenceAuras(battle, owner, spec.auras, "field:" + spec.name);
  battle.trace?.push?.({
    t: "FIELD_ENTER", kind: spec.kind, name: spec.name, owner: owner.id, team: owner.teamId,
    duration: spec.duration, durationSource: spec.durationSource, expiresTurn: st.expiresTurn, auraCount: auras, evidence: spec.evidence,
  });
  return st;
}

/** 清理一个场地：撤光环 + 发布件（到期 / 被替换 都走这里） */
export function clearField(battle: any, st: FieldState, reason: string): number {
  const list: FieldState[] = battle?.fields ?? [];
  const i = list.indexOf(st);
  if (i < 0) return 0;
  list.splice(i, 1);
  const owner: Entity | undefined = battle.allEntities?.().find((e: Entity) => e.id === st.ownerId);
  const cleared = owner ? clearPresenceAuras(battle, owner, "field:" + st.name, "FIELD_" + reason) : 0;
  battle.trace?.push?.({ t: "FIELD_EXIT", kind: st.kind, name: st.name, owner: st.ownerId, reason, auras: cleared });
  return cleared;
}

/**
 * ★★★ 第 124 轮：场地的**每回合效果**。在行动者回合开始时调用一次，只对**行动者**结算 ——
 *   原文「使友方全体…且在回合开始前有67%概率获得1点鬼火」的读法是：每个友方单位在**自己**回合开始时各掷一次。
 *   · 掷骰走 battle.rng 且带**稳定 tag**（进 RNG parity / 快照 / 重放）；读不到概率时**不掷**（必触发）；
 *   · trace 每次都写（含 rolled=false 的那些 —— 否则「67%」无法被验证）；
 *   · 真触发时同时**发事件**（ORB_GAIN，复用第 120 轮接的事件队列）。
 */
/** 第 124/125 轮：两个触发时机共用一段结算（掷骰那一步完全一样，只有"掷中之后做什么"不同） */
function fieldPhase(battle: any, actor: Entity, phase: "TURN_START" | "TURN_END"): number {
  let fired = 0;
  for (const st of fieldsOf(battle)) {
    const pt = st.perTurn;
    if (!pt || pt.trigger !== phase) continue;
    if (!actor?.alive) continue;
    const inScope = pt.scope === "ALL" ? true
      : pt.scope === "ALLY" ? actor.teamId === st.teamId : actor.teamId !== st.teamId;
    if (!inScope) continue;
    let hit = true;
    if (pt.probability !== null) {
      battle.rng.expect("field:" + st.name + ":" + (phase === "TURN_START" ? "turnStart" : "turnEnd") + ":" + actor.id);
      hit = battle.rng.testHit(pt.probability);
    }
    if (pt.kind === "ORB_GAIN") {
      const pool = battle?.teams?.[actor.teamId]?.orbs;
      if (!pool) continue;
      const before = pool.current;
      let gained = 0, overflow = 0;
      if (hit) { const g = pool.gain(pt.amount ?? 1); gained = g.gained; overflow = g.overflow; fired++; }
      battle.trace?.push?.({
        t: "FIELD_PER_TURN", kind: st.kind, name: st.name, entity: actor.id, effect: pt.kind,
        amount: pt.amount, probability: pt.probability, rolled: pt.probability === null ? null : hit,
        gained, overflow, orbsBefore: before, orbsAfter: pool.current, evidence: pt.evidence,
      });
      if (hit) {
        battle.queueEvent?.(EV.ORB_GAIN,
          { battle, team: actor.teamId, src: actor.id, skill: "场地：" + st.name, requested: pt.amount ?? 1, gained, before, after: pool.current },
          actor.id, actor.teamId);
      }
    } else if (pt.kind === "TIMELINE_PUSH") {
      /**
       * ★★★ 第 126 轮：**拉条**（稻荷神御馔津「狐狩·日曜界」的「每当友方回合结束后，
       *   使行动条最前端的另一友方增加20%行动条」）。目标选择：「另一友方」= 除行动者外的存活友方，
       *   取**行动条最前端**的那个（pos 最大者）。
       *   ★ 没有候选（只剩自己活着）时**什么都不做**，但 trace 仍写一条（否则"看起来没触发"与"没目标"分不清）。
       */
      const mates = (battle?.teams?.[actor.teamId]?.members ?? []).filter((m: any) => m.alive && m.id !== actor.id);
      const front = [...mates].sort((a: any, b: any) =>
        (battle.timeline.get(b.id)?.pos ?? 0) - (battle.timeline.get(a.id)?.pos ?? 0))[0] ?? null;
      let moved = 0;
      const posBefore = front ? (battle.timeline.get(front.id)?.pos ?? 0) : null;
      if (front && hit) { moved = battle.timeline.shift(front.id, pt.percent ?? 20); fired++; }
      battle.trace?.push?.({
        t: "FIELD_PER_TURN", kind: st.kind, name: st.name, entity: actor.id, effect: pt.kind,
        target: front?.id ?? null, percent: pt.percent, moved, posBefore,
        posAfter: front ? (battle.timeline.get(front.id)?.pos ?? 0) : null,
        probability: pt.probability, rolled: pt.probability === null ? null : hit, evidence: pt.evidence,
      });
    } else if (pt.kind === "STATUS_APPLY") {
      /**
       * ★ 第 125 轮：施加状态。**来源记成场地拥有者**（不是"被施加者自己"）——
       *   否则「同来源才合并层数」这条 addStatus 语义会把不同来源的状态错误合并。
       *   定义由编译器从 [tips_N] 解析成 StatusBook 的 id；查不到定义时**什么都不做**（编译器已记账）。
       */
      const def = pt.statusId ? StatusBook.get(pt.statusId) : null;
      if (!def) continue;
      if (hit) { actor.addStatus(def, st.ownerId, 1, pt.duration ?? 1); fired++; }
      battle.trace?.push?.({
        t: "FIELD_PER_TURN", kind: st.kind, name: st.name, entity: actor.id, effect: pt.kind,
        status: pt.statusId, probability: pt.probability, rolled: pt.probability === null ? null : hit, evidence: pt.evidence,
      });
    }
  }
  return fired;
}

export function fieldTurnStart(battle: any, actor: Entity): number { return fieldPhase(battle, actor, "TURN_START"); }
export function fieldTurnEnd(battle: any, actor: Entity): number { return fieldPhase(battle, actor, "TURN_END"); }

/** 回合结束时判到期（「存在N回合」读作：创建当回合算第 1 回合） */
export function expireFields(battle: any): number {
  const turn = Number(battle?.turn ?? 0);
  let n = 0;
  for (const st of [...fieldsOf(battle)]) {
    if (turn >= st.expiresTurn) { clearField(battle, st, "EXPIRED"); n++; }
  }
  return n;
}

/** 序列化：**空场地不进档**（默认对局连这个键都没有 ⇒ 指纹只在真有场地时才变） */
export function fieldSnapshot(battle: any): FieldState[] | null {
  const l = fieldsOf(battle);
  return l.length ? l.map((f) => ({ ...f })) : null;
}

export function fieldRestore(battle: any, raw: FieldState[] | null | undefined): void {
  battle.fields = Array.isArray(raw) ? raw.map((f) => ({ ...f })) : [];
}
