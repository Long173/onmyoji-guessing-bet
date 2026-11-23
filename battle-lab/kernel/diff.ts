// kernel/diff.ts — ★ G6：与真实游戏对照，定位**第一处**分歧（a1-4 §8 / 目标 ⑧）
//
// 为什么需要它：整条 Fidelity 链路都在回答"我们对自己有多不确定"，
// 但真正能推动模型变准的只有一个问题 —— **第一次和游戏不一样，是在哪里？**
// 在此之前项目里只有 lab/observations.ts（一个"记录观测"的登记簿），
// 没有任何东西把观测时间线与模拟时间线**逐条比对**并把分歧点指出来。
//
// 设计原则（与前几轮同源）：
//   ① 比对只以**玩家在画面上看得到的量**为准（血量 / 伤害数字 / 状态 / 鬼火 / 行动条 / 阵亡），
//      因为人工观测只能记这些；
//   ② 模拟侧有、游戏侧不显示的内部事件**不隐藏** —— 逐条列进 skipped，计数给出来；
//   ③ 只报**第一处**分歧（这是最有信息量的一个），同时也给出后续分歧的完整列表；
//   ④ 纯函数、零依赖，可被 Node 测试与浏览器同时使用。
// ★ 第 191 轮：取整统一走 GameMath（lint-rounding 的规则）
import { GameMath } from "./gamemath.ts";

export type ObsKind = "SKILL" | "DAMAGE" | "HEAL" | "STATUS" | "STATUS_END" | "DEATH" | "ORB" | "TIMELINE" | "TURN";

export interface ObsFrame {
  /** 人工记录的序号（可选；只用于回显，不参与比对） */
  n?: number;
  kind: ObsKind;
  /** 施动者：模拟侧是实体 id，人工侧一般写名字 —— 用 alias 归一 */
  actor?: string | number | null;
  target?: string | number | null;
  skill?: string | null;
  /** 伤害/治疗数字（游戏画面上显示的那个） */
  amount?: number | null;
  /** 该事件之后的血量（游戏画面上显示的那个） */
  hpAfter?: number | null;
  status?: string | null;
  orbs?: number | null;
  note?: string;
}

export interface DiffOptions {
  /** 数值比较容差。游戏显示常四舍五入，默认 1。 */
  tolerance?: number;
  /** 实体别名归一：把 id 与中文名映射到同一个规范键 */
  alias?: (v: string | number | null | undefined) => string;
  /** 允许在模拟侧向前跳过的最大帧数（模拟里有游戏不显示的内部事件） */
  lookahead?: number;
  /** 最多报告多少条分歧（默认 50） */
  maxReport?: number;
}

export interface Divergence {
  /** 第几条观测（从 0 开始） */
  index: number;
  reason: "MISSING" | "EXTRA" | "FIELD";
  expected: ObsFrame | null;
  actual: ObsFrame | null;
  field?: string;
  expectedValue?: unknown;
  actualValue?: unknown;
  /** 分歧点在观测序列里的上下文（前 3 条 / 后 2 条） */
  context: { before: ObsFrame[]; after: ObsFrame[] };
  /** 对应到模拟侧的帧号（MISSING 时为 null） */
  actualIndex: number | null;
}

export interface DiffResult {
  ok: boolean;
  first: Divergence | null;
  all: Divergence[];
  matched: number;
  /** 模拟侧被跳过（游戏不显示）的帧数与明细 —— 如实列出，不隐藏 */
  skipped: number;
  skippedDetail: ObsFrame[];
  /**
   * ★ 最后一条观测之后、模拟仍在继续的帧数。
   *   它**不是分歧**：人工观测本来就可能只覆盖前几个回合，人不可能（也不该）把整局都记下来。
   *   第一版把这段尾巴全报成 EXTRA —— 于是"只看了前 30 条"的正确观测会被报出 49 处分歧。
   *   但计数必须给出来，否则"观测只覆盖了一小段"就会被误读成"整局都核对过了"。
   */
  beyondObservation: number;
  summary: string;
}

const KEYS: Array<keyof ObsFrame> = ["kind", "actor", "target", "skill", "amount", "hpAfter", "status", "orbs"];

const ident = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

function norm(f: ObsFrame, o: DiffOptions): ObsFrame {
  const a = o.alias ?? ident;
  return { ...f, actor: a(f.actor), target: a(f.target) };
}

/** 两条帧是否指同一件事（不比数值，只比身份） */
export function sameEvent(a: ObsFrame, b: ObsFrame): boolean {
  if (a.kind !== b.kind) return false;
  if (ident(a.actor) !== ident(b.actor)) return false;
  if (ident(a.target) !== ident(b.target)) return false;
  // 技能名只有两边都写了才要求一致（人工不一定记得写技能名）
  if (a.skill && b.skill && a.skill !== b.skill) return false;
  return true;
}

/** 找第一条分歧。返回 null 表示观测与模拟完全一致。 */
export function diffTimelines(expected: ObsFrame[], actual: ObsFrame[], options: DiffOptions = {}): DiffResult {
  const o: DiffOptions = { tolerance: 1, lookahead: 8, maxReport: 50, ...options };
  const exp = expected.map(f => norm(f, o));
  const act = actual.map(f => norm(f, o));
  const all: Divergence[] = [];
  const skippedDetail: ObsFrame[] = [];
  let matched = 0;
  let j = 0;

  const ctx = (i: number) => ({ before: exp.slice(Math.max(0, i - 3), i), after: exp.slice(i + 1, i + 3) });

  for (let i = 0; i < exp.length; i++) {
    const want = exp[i];
    // 在模拟侧向前找同一件事（容差 = lookahead 条内部事件）
    let hit = -1;
    for (let k = j; k < Math.min(act.length, j + (o.lookahead ?? 8) + 1); k++) {
      if (sameEvent(want, act[k])) { hit = k; break; }
    }
    if (hit < 0) {
      all.push({ index: i, reason: "MISSING", expected: want, actual: null, context: ctx(i), actualIndex: null });
      continue;
    }
    // 中间那些"模拟有、观测没有"的帧：这是**真分歧**（模拟产生了玩家应当看得见、观测里却没有的事件），
    // 但也要考虑另一种解释：人漏记了。所以报出来、并写明两种可能，而不是替使用者选一个。
    for (let k = j; k < hit; k++) {
      skippedDetail.push(act[k]);
      all.push({
        index: i, reason: "EXTRA", expected: null, actual: act[k],
        context: ctx(i), actualIndex: k,
      });
    }
    j = hit + 1;
    const got = act[hit];
    // 逐字段比对：只比**观测里写了**的字段（人工没记的东西不该被判为分歧）
    let bad: { field: string; e: unknown; a: unknown } | null = null;
    for (const key of KEYS) {
      if (key === "kind" || key === "actor" || key === "target" || key === "skill") continue;
      const ev = (want as any)[key], av = (got as any)[key];
      if (ev === null || ev === undefined) continue;
      if (typeof ev === "number" && typeof av === "number") {
        if (Math.abs(ev - av) > (o.tolerance ?? 1)) { bad = { field: key, e: ev, a: av }; break; }
      } else if (String(ev) !== String(av ?? "")) { bad = { field: key, e: ev, a: av }; break; }
    }
    if (bad) {
      all.push({ index: i, reason: "FIELD", expected: want, actual: got, field: bad.field, expectedValue: bad.e, actualValue: bad.a, context: ctx(i), actualIndex: hit });
    } else matched++;
  }
  // 观测结束之后的模拟帧 = 观测范围之外，不算分歧（只计数）
  const beyondObservation = act.length - j;

  const first = all.length ? all[0] : null;
  const summary = first
    ? `第 ${first.index + 1} 条观测起出现分歧（${first.reason}` +
      (first.field ? `，字段 ${first.field}：观测 ${JSON.stringify(first.expectedValue)} vs 模拟 ${JSON.stringify(first.actualValue)}` : "") +
      `）｜已匹配 ${matched} 条，模拟侧另有 ${skippedDetail.length} 条内部帧被跳过`
    : `观测与模拟一致（逐条比对 ${matched} 条；观测范围之外另有 ${beyondObservation} 条模拟帧未参与比对）`;
  const tail = beyondObservation > 0 ? `｜观测只覆盖到第 ${matched} 条匹配，其后 ${beyondObservation} 条模拟帧不在观测范围内` : "";
  return { ok: all.length === 0, first, all: all.slice(0, o.maxReport ?? 50), matched, skipped: skippedDetail.length, skippedDetail, beyondObservation, summary: summary + tail };
}

/**
 * 把引擎 trace 投影成**玩家看得见**的观测序列。
 * 不在表里的事件就是"游戏画面上看不到的"，计入 unobservable —— 而不是假装它们不存在。
 */
export function projectObserved(trace: any[], opts: { maxFrames?: number } = {}): { frames: ObsFrame[]; unobservable: number } {
  const frames: ObsFrame[] = [];
  let unobservable = 0;
  for (const e of trace) {
    switch (e.t) {
      case "SKILL_CAST": frames.push({ kind: "SKILL", actor: e.actor, target: e.target, skill: e.skill }); break;
      case "DAMAGE": frames.push({ kind: "DAMAGE", actor: e.src, target: e.dst, amount: e.applied, hpAfter: e.hpAfter, skill: e.skill }); break;
      case "HEAL": case "RECOVER": frames.push({ kind: "HEAL", actor: e.src, target: e.dst, amount: e.amount }); break;
      case "STATUS_APPLY": frames.push({ kind: "STATUS", actor: e.src, target: e.dst, status: e.name ?? e.status }); break;
      case "STATUS_EXPIRE": frames.push({ kind: "STATUS_END", target: e.id, status: e.status }); break;
      case "DEATH": frames.push({ kind: "DEATH", target: e.id }); break;
      case "ORB_GAIN": case "ORB_PAY": frames.push({ kind: "ORB", actor: e.src ?? e.actor, orbs: e.after }); break;
      case "TIMELINE_SHIFT": frames.push({ kind: "TIMELINE", actor: e.id, amount: GameMath.roundAt((e.percent ?? 0) * 100, "TIMELINE_SHIFT_PERCENT") }); break;
      default: unobservable++;
    }
    if (opts.maxFrames && frames.length >= opts.maxFrames) break;
  }
  return { frames, unobservable };
}

/** 用「实体 id → 名字」建一个归一化函数：人工写名字、模拟给 id，两边都能归到同一个键 */
export function buildAlias(byId: Record<number | string, string>): (v: string | number | null | undefined) => string {
  const idToName = new Map<string, string>();
  const nameToName = new Map<string, string>();
  for (const [id, name] of Object.entries(byId)) {
    idToName.set(String(id), name);
    nameToName.set(name, name);
  }
  return (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return idToName.get(s) ?? nameToName.get(s) ?? s;
  };
}
