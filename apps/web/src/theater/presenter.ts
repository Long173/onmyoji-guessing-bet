// theater/presenter.ts — ★ G4：Battle Presenter（a1-4 §27 后半：Presenter / Stage 分层）
//
// 职责：把「Replay 文件 + 帧号」变成「舞台要画的东西」。**纯函数、零 Vue、零引擎执行**。
//   ReplayPlayer（读文件、重建状态） → Presenter（算出视图模型） → Stage（Vue 组件只负责画）
//
// 为什么要单独一层：Theater 的调试成本几乎全在"这一帧到底应该显示什么"，
// 把它做成可单测的纯函数，就不必开浏览器去猜。
//
// 允许 import 的唯一引擎模块是 kernel/replay.ts —— 那是**纯播放器**（读 JSON、应用 Delta），
// 不会装配战斗、不会执行引擎。测试会断言这里不出现 assemble / battle。
import { ReplayPlayer } from "../../../../battle-lab/kernel/replay.ts";
import type { ReplayFile, ReplayFrame } from "../../../../battle-lab/kernel/replay.ts";
import { displayName } from "../kb/names.ts";
import { bettingBanner } from "./betting-banner.ts";

export interface UnitView {
  id: number; unitId: string; side: "red" | "blue"; name: string;
  hp: number; maxHp: number; hpPct: number;
  shield: number;
  alive: boolean;
  /** 死亡状态机（a1-4 §18）：alive → hpZero → dead → killed，以及变形/复活受阻 */
  state: "ALIVE" | "HP_ZERO" | "DEAD" | "KILLED" | "TRANSFORMED";
  statuses: Array<{ id: string; name: string; stacks: number; remaining: number; tag: string; isDebuff: boolean; effects: number }>;
  /** 当前八维（实时，含 effects 折叠 —— 折在 presenter 里，UI 不重算） */
  stats: { atk: number; hp: number; def: number; spd: number; cri: number; crid: number; efh: number; efr: number };
  /** 行动条位置（0..1） */
  timeline: number;
  locked: boolean;
  usedSkills: string[];
  isActor: boolean;
  isTarget: boolean;
}

export interface TeamView {
  side: "red" | "blue";
  orb: number; maxOrb: number; gauge: number; gaugeSize: number; cycle: number; pendingReward: number;
  aliveCount: number;
}

export interface BannerView {
  kind: "SKILL" | "DEATH" | "REVIVE" | "STATUS" | "ORB" | "TIMELINE" | "OTHER";
  actor?: string; target?: string; skill?: string; cost?: number;
  lines: Array<{ label: string; value: string; tone?: "normal" | "crit" | "resist" | "heal" | "warn" }>;
  code: string;
}

export interface TheaterView {
  frame: number;
  frameCount: number;
  /** 帧所属回合（从事件归属推出；开局阶段为 0） */
  turn: number;
  phase: string;
  units: UnitView[];
  teams: [TeamView, TeamView];
  banner: BannerView | null;
  /** 最近若干条伤害/治疗数字，用于舞台飘字 */
  floats: Array<{ unitId: string; text: string; tone: "dmg" | "crit" | "heal" | "shield" | "resist" }>;
  winner: 0 | 1 | null;
  result: string;
  warning: string | null;
}

const sameId = (a: any, b: any) => a !== undefined && a !== null && String(a) === String(b);

/** 属性键 → 英文简称（显示用；引擎帧里的 prop 键不变） */
const STAT_EN: Record<string, string> = { atk: "ATK", hp: "HP", def: "DEF", spd: "Speed", cri: "Crit", crid: "Crit DMG", efh: "Effect HIT", efr: "Effect RES" };
const statEn = (fr: any) => STAT_EN[String(fr.prop)] ?? String(fr.cn ?? fr.prop ?? "");
/** 「N 回合」 */
const turns = (n: any) => String(n) + (Number(n) === 1 ? " turn" : " turns");

/** effects 折叠：与 Entity.prop 同一套语义（FIXED 累加 / ADD_RATE 乘 / SET 覆盖） */
function propOf(base: any, effects: any[], p: string): number {
  let fixed = base?.[p] ?? 0, rate = 0, set: number | null = null;
  for (const e of effects ?? []) {
    if (e.prop !== p) continue;
    if (e.mode === "FIXED") fixed += e.value;
    else if (e.mode === "ADD_RATE") rate += e.value;
    else set = e.value;
  }
  const v = set !== null ? set : fixed * (1 + rate);
  return p === "spd" ? Math.max(0, v) : Math.max(0, v);
}

export class Presenter {
  readonly player: ReplayPlayer;
  private unitIdByEntity = new Map<number, { unitId: string; side: "red" | "blue"; name: string }>();

  constructor(file: ReplayFile) {
    this.player = new ReplayPlayer(file);
    // 实体 id ↔ UI unitId：装配约定红 101..105 / 蓝 201..205
    file.frames.forEach(() => { /* 保持顺序语义 */ });
    for (const [i, name] of (file.match.red ?? []).entries()) this.unitIdByEntity.set(101 + i, { unitId: "r" + (i + 1), side: "red", name });
    for (const [i, name] of (file.match.blue ?? []).entries()) this.unitIdByEntity.set(201 + i, { unitId: "b" + (i + 1), side: "blue", name });
  }

  static fromSerialized(json: string | object): Presenter { return new Presenter(typeof json === "string" ? JSON.parse(json) : json); }

  get frameCount(): number { return this.player.frameCount; }
  get result() { return this.player.result; }
  /** 记录到的最后一帧（含终局补记帧） */
  get lastFrame(): number { return Math.max(this.player.frameCount - 1, this.player.lastFrame); }

  frame(i: number): ReplayFrame | null { return this.player.frame(i); }

  /** 事件链（Inspector 用，a1-4 §28） */
  ancestry(i: number) { return this.player.ancestryOfFrame(i); }

  view(i: number): TheaterView | null {
    const frameIndex = Math.max(0, Math.min(i, this.player.frameCount - 1));
    const fr = this.player.frame(frameIndex);
    const st = this.player.stateAt(fr ? fr.frame : frameIndex);
    if (!st) return null;

    const timelinePos = new Map<number, { pos: number; locked: boolean }>();
    for (const e of st.timeline.entries) timelinePos.set(e.id, { pos: e.pos, locked: e.locked });
    const GOAL = 10000;

    const units: UnitView[] = [];
    for (const t of st.teams) {
      const side = t.id === 0 ? "red" : "blue";
      for (const m of t.members) {
        const meta = this.unitIdByEntity.get(m.id);
        const eff = m.effects ?? [];
        const state: UnitView["state"] = m.transformed ? "TRANSFORMED" : m.killed ? "KILLED" : m.dead ? "DEAD" : m.hpZero ? "HP_ZERO" : "ALIVE";
        units.push({
          id: m.id, unitId: meta?.unitId ?? String(m.id), side, name: m.name,
          hp: m.hp, maxHp: m.maxHp, hpPct: m.maxHp > 0 ? Math.max(0, Math.min(100, (m.hp / m.maxHp) * 100)) : 0,
          shield: (m.shields ?? []).filter((s: any) => !s.broken).reduce((a: number, s: any) => a + (s.value ?? 0), 0),
          alive: m.alive, state,
          statuses: (m.statuses ?? []).map((s: any) => ({
            id: s.defId, name: s.defId, stacks: s.stacks, remaining: s.remaining, tag: s.tag,
            isDebuff: /DEBUFF|CONTROL|STATE/.test(String(s.defId)), effects: (s.effects ?? []).length,
          })),
          stats: {
            atk: propOf(m.base, eff, "atk"), hp: m.maxHp, def: propOf(m.base, eff, "def"), spd: propOf(m.base, eff, "spd"),
            cri: propOf(m.base, eff, "cri"), crid: propOf(m.base, eff, "crid"), efh: propOf(m.base, eff, "efh"), efr: propOf(m.base, eff, "efr"),
          },
          timeline: Math.max(0, Math.min(1, (timelinePos.get(m.id)?.pos ?? 0) / GOAL)),
          locked: timelinePos.get(m.id)?.locked ?? false,
          usedSkills: m.usedSkills ?? [],
          isActor: sameId(fr?.actor, m.id) || sameId(fr?.src, m.id),
          isTarget: sameId(fr?.target, m.id) || sameId(fr?.dst, m.id),
        });
      }
    }

    const teams = st.teams.map((t): TeamView => ({
      side: t.id === 0 ? "red" : "blue",
      orb: t.orbs.orb, maxOrb: 8, gauge: t.orbs.gauge, gaugeSize: 5,
      cycle: t.orbs.cycle, pendingReward: t.orbs.pendingReward,
      aliveCount: t.members.filter((m: any) => m.alive).length,
    })) as [TeamView, TeamView];

    return {
      frame: fr?.frame ?? frameIndex, frameCount: this.player.frameCount,
      /**
       * ★★★ 第 137 轮：**回合必须从重建出来的状态读**。
       *   原来的判据是 fr?.turn ?? 0 —— 而回顾放文件里**帧上根本没有 turn 字段**
       *   （597 帧里只有 1 帧带 turn，那还是某个事件自己的载荷）。于是：
       *     · Theater 顶栏「第 N 回合」整场都是 0；
       *     · nextTurn 的判据恒为 0 ⇒ ⏭「下一回合」直接跳到末帧。
       *   两处都是**用户看得见的错**，而第 137 轮之前没有任何断言盯着它。
       *   现在以 stateAt() 重建出来的状态为准（帧上的 turn 只作为兜底）。
       */
      turn: Number.isFinite(st.turn) ? Number(st.turn) : (typeof fr?.turn === "number" ? fr.turn : 0),
      phase: String(st.phase),
      units, teams,
      banner: fr ? this.banner(fr, units) : null,
      floats: this.floats(fr, units),
      winner: st.winner, result: st.endReason || "",
      warning: this.warningOf(frameIndex),
    };
  }

  /** 技能/死亡/拉条… → Action Banner（a1-4 §16） */
  banner(fr: ReplayFrame, units: UnitView[]): BannerView {
    const nm = (id: any) => { const u = units.find(x => sameId(x.id, id)); return u ? displayName(u.name) : (id != null ? "#" + id : undefined); };
    const lines: BannerView["lines"] = [];
    switch (fr.t) {
      case "SKILL_CAST":
        if (fr.cost !== undefined) lines.push({ label: "Onibi", value: "-" + fr.cost, tone: "warn" });
        /**
         * ★★★ 第 252 轮：**分段技能**（一次施放里不止一种次数 —— 例如「3 次全体 + 1 次单体」）。
         *   只报首段的 `hits` 会让横幅比产物**乐观**；帧里现在带 `segments`（见 compile/character.ts），有它就写全。
         */
        if (Array.isArray(fr.segments) && fr.segments.length > 1) lines.push({ label: "Hits", value: fr.segments.join(" + ") });
        else if (fr.hits !== undefined && fr.hits > 1) lines.push({ label: "Hits", value: String(fr.hits) });
        return { kind: "SKILL", actor: nm(fr.actor), target: nm(fr.target), skill: fr.skill, cost: fr.cost, lines, code: fr.t };
      case "SKILL_FALLBACK":
        lines.push({ label: "Reason", value: `Not enough Onibi (need ${fr.need}, have ${fr.have})`, tone: "warn" });
        lines.push({ label: "Instead", value: String(fr.fallback ?? "—") });
        return { kind: "SKILL", actor: nm(fr.actor), skill: fr.skill, lines, code: fr.t };
      case "DAMAGE":
        lines.push({ label: "Damage", value: String(Math.round(fr.applied ?? 0)), tone: fr.crit ? "crit" : "normal" });
        if (fr.crit) lines.push({ label: "Crit", value: "Yes", tone: "crit" });
        if (fr.absorbed) lines.push({ label: "Absorbed", value: String(Math.round(fr.absorbed)) });
        return { kind: "OTHER", actor: nm(fr.src), target: nm(fr.dst), lines, code: fr.t };
      /**
       * ★★★ 第 130 轮：**治疗没有落到目标身上**这件事必须看得见 —— 否则回放里
       *   看起来就是"治疗量算错了"（实际是"目标根本不该被治疗"）。
       *   两种原因：① 原文写「无法被治疗或恢复生命」（KB：百羽凤凰火「未熄羽」）；
       *   ② 目标是**离场的本体**（形态期间，人不在场上）。
       */
      case "HEAL_SKIPPED":
        lines.push({
          label: "Heal not applied",
          value: fr.reason === "CANNOT_BE_HEALED" ? "Target cannot be healed (per skill text)" : "Target is off-field (in form)",
          tone: "warn",
        });
        lines.push({ label: "Would heal", value: "+" + Math.round(fr.amount ?? 0) });
        return { kind: "OTHER", actor: nm(fr.src), target: nm(fr.dst), lines, code: fr.t };
      /**
       * ★★★ 第 244 轮：规格 §60 的两端（00:00 BATTLE_START → BATTLE_END）。
       *   它们此前只在事件总线上（不进 trace）⇒ 录像的首尾帧对不上规格；补上 trace 之后，
       *   Theater 也必须渲染它们，否则又是一条「引擎发了、没人显示」（ui13 的词汇闸门会红）。
       */
      case "BATTLE_START":
        lines.push({ label: "Start", value: "Battle start" });
        return { kind: "OTHER", lines, code: fr.t };
      case "BATTLE_END":
        lines.push({ label: "End", value: String(fr.reason ?? "Decided") });
        if (fr.winner === 0 || fr.winner === 1) lines.push({ label: "Winner", value: fr.winner === 0 ? "Red" : "Blue" });
        return { kind: "OTHER", lines, code: fr.t };
      case "HEAL": case "RECOVER":
        lines.push({ label: fr.t === "HEAL" ? "Heal" : "Recover", value: "+" + Math.round(fr.amount ?? 0), tone: "heal" });
        return { kind: "OTHER", actor: nm(fr.src), target: nm(fr.dst), lines, code: fr.t };
      case "SHIELD_APPLY":
        lines.push({ label: "Shield", value: "+" + Math.round(fr.value ?? 0) });
        return { kind: "OTHER", actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill, lines, code: fr.t };
      case "STATUS_APPLY":
        lines.push({ label: "Status", value: String(fr.name ?? fr.status) });
        /**
         * ★★★ 第 240 轮：**层数型状态**（计数器）显示「层数 / 上限」，不显示「持续」。
         *   判据只看帧里有没有 stacks —— 技能施加的状态一个都没带（compile/character.ts 两处都不写），
         *   所以这条分支对既有录像**逐位不变**；带 stacks 的只有第 240 轮接上的计数器。
         *   （GLOBAL 策略的 duration=99999 直接显示成「99999 回合」是噪声，不是信息。）
         */
        if (fr.stacks != null) lines.push({ label: "Stacks", value: String(fr.stacks) + (fr.threshold != null ? " / " + String(fr.threshold) : "") });
        else lines.push({ label: "Duration", value: turns(fr.duration ?? 1) });
        if (fr.known === false) lines.push({ label: "Data", value: "Missing source data (unknown mark)", tone: "warn" });
        return { kind: "STATUS", actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill, lines, code: fr.t };
      case "STATUS_EXPIRE":
        /**
         * ★★★ 第 240 轮：**被消耗 ≠ 到期**。引擎早就在记 reason（damage.ts:178 UNDYING_CONSUMED、
         *   self-revive.ts:91 SELF_REVIVE_CONSUMED、第 240 轮的 COUNTER_SPENT），而 Banner 把它丢掉了 ——
         *   「记了却没人显示」等于没记。现在按 reason 分会话音（含被消耗的那一档）。
         */
        lines.push(/CONSUMED|SPENT/.test(String(fr.reason ?? ""))
          ? { label: "Consumed", value: String(fr.status) }
          : { label: "Expired", value: String(fr.status) });
        if (fr.reason) lines.push({ label: "Reason", value: String(fr.reason) });
        return { kind: "STATUS", target: nm(fr.id), lines, code: fr.t };
      /**
       * ★★★ 第 99 轮：**属性偷取**（§84）。它是可观测机制，必须出现在 Banner 上 ——
       *   否则"打了一下，双方属性都变了"在回放里没有任何解释。
       *   口径（basis）也一起显示：用哪种口径算出来的结果必须看得出来（与 policySnapshot 同一条规矩）。
       */
      case "STAT_STEAL":
        lines.push({ label: "Steal", value: statEn(fr) + " " + Math.round(fr.toTarget ?? 0) });
        lines.push({ label: "Target", value: nm(fr.dst) + " −" + Math.round(fr.toTarget ?? 0) });
        lines.push({ label: "Stealer", value: nm(fr.src) + " +" + Math.round(fr.toActor ?? 0) });
        lines.push({ label: "Duration", value: "returned after " + turns(fr.duration ?? 1) });
        if (fr.conservation) lines.push({ label: "Basis", value: "not conserved (" + String(fr.basis) + ")", tone: "warn" });
        return { kind: "STATUS", actor: nm(fr.src), target: nm(fr.dst), lines, code: fr.t };
      case "STAT_STEAL_MISS":
        lines.push({ label: "Steal missed", value: "Chance " + Math.round(((fr.probability ?? 0) as number) * 100) + "%", tone: "warn" });
        return { kind: "STATUS", actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill, lines, code: fr.t };
      case "STAT_STEAL_BLOCKED":
        lines.push({ label: "Steal blocked", value: String(fr.reason ?? "—"), tone: "warn" });
        return { kind: "STATUS", actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill, lines, code: fr.t };
      /**
       * ★★★ 第 108 轮：**执行点之间的分工必须在画面上看得见**。
       *   噬魂的「施放『焚天九尾』前，先偷取…」现在由被动运行时在 SKILL_START 上执行，
       *   主动执行点遇到它时会留一条这个 —— 不渲染的话，回放里"技能结算处没偷"看起来就像漏了。
       */
      case "STAT_STEAL_SKIPPED":
        lines.push({ label: "Steal not run here", value: String(fr.trigger) + " · " + String(fr.reason ?? "—") });
        lines.push({ label: "Text", value: String(fr.evidence ?? "—") });
        return { kind: "STATUS", actor: nm(fr.src), skill: fr.skill, lines, code: fr.t };
      /**
       * ★★★ 第 109 轮：**残局档位**（a1-4 §34 的 Environment）。
       *   它改变的是"后面每一次伤害/治疗"的乘区 —— 不在画面上说清楚，回放里就成了"伤害莫名变大"。
       */
      /** ★★★ 第 111 轮：在场光环的施加与撤离（它们改变的是属性，画面上必须看得见"谁给的光环"） */
      case "AURA_APPLY":
        lines.push({ label: "Aura", value: String(fr.tipsId ?? "?") + " applied ×" + String(fr.count ?? 0) });
        lines.push({ label: "Contents", value: (fr.auras ?? []).join(", ") });
        return { kind: "STATUS", actor: nm(fr.owner), lines, code: fr.t };
      case "AURA_END":
        lines.push({ label: "Aura removed", value: String(fr.tipsId ?? "?") + " · " + String(fr.reason ?? "—") });
        lines.push({ label: "Reverted", value: String(fr.count ?? 0) + " stat modifier(s)" });
        return { kind: "STATUS", actor: nm(fr.from), lines, code: fr.t };
      case "SUMMON_REMOVE":
        lines.push({ label: "Placed unit left", value: String(fr.name ?? "?") + " (" + String(fr.reason ?? "—") + ")" });
        lines.push({ label: "Not a death", value: "Recall/removal does not trigger on-death effects" });
        return { kind: "OTHER", lines, code: fr.t };
      case "STATUS_REMOVED":
        lines.push({ label: "Status removed", value: String(fr.status ?? "?") + " (" + String(fr.reason ?? "—") + ")" });
        return { kind: "STATUS", target: nm(fr.id), lines, code: fr.t };
      /** ★★★ 第 113 轮：召唤物的两种「在场」行为（反应式回血 / 移除代价） */
      case "SUMMON_REACTIVE_HEAL":
        lines.push({ label: "Presence heal", value: String(fr.summon) + " heals " + nm(fr.dst) + " for " + Math.round(Number(fr.healed ?? 0)) });
        lines.push({ label: "Source", value: "damage taken " + Math.round(Number(fr.fromDamage ?? 0)) + " × " + Number(fr.ratio ?? 0) });
        return { kind: "STATUS", target: nm(fr.dst), lines, code: fr.t };
      case "SUMMON_PAYOFF":
        lines.push({ label: "Removal payoff", value: String(fr.kind) + " (" + String(fr.reason ?? "") + ")" });
        if (fr.gained !== undefined) lines.push({ label: "Onibi refunded", value: String(fr.gained) });
        if (fr.ratio !== undefined) lines.push({ label: "Ratio", value: String(fr.ratio) });
        return { kind: "STATUS", lines, code: fr.t };
      case "SUMMON_PAYOFF_SKIPPED":
        lines.push({ label: "Removal payoff skipped", value: String(fr.kind) + " · " + String(fr.why ?? "—"), tone: "warn" });
        return { kind: "STATUS", lines, code: fr.t };
      /** ★★★ 第 115 轮：场地（幻境 / 结界）的展开与结束 */
      case "FIELD_PER_TURN": {
        /** ★ 第 124 轮：幻境/结界的每回合效果（辉夜姬「龙首之玉」的 67% 回火）—— Theater 要看得见掷骰结果 */
        const roll = fr.probability === null || fr.probability === undefined ? "always" : ("p=" + fr.probability + (fr.rolled ? " hit" : " miss"));
        lines.push({ label: "Field per turn", value: String(fr.name ?? "?") + "｜" + roll, tone: fr.rolled === false ? "warn" : "normal" });
        if (fr.gained) lines.push({ label: "Onibi", value: String(fr.orbsBefore ?? "?") + " → " + String(fr.orbsAfter ?? "?") + " (+" + fr.gained + ")" });
        if (fr.overflow) lines.push({ label: "Overflow", value: String(fr.overflow), tone: "warn" });
        return { kind: "ORB", actor: nm(fr.entity), lines, code: fr.t };
      }
      case "FIELD_ENTER":
        lines.push({ label: "Field deployed", value: String(fr.name ?? "?") + " (" + String(fr.kind === "ILLUSION" ? "Illusion" : "Barrier") + ")" });
        lines.push({ label: "Duration", value: turns(fr.duration ?? 1) + " (" + String(fr.durationSource ?? "?") + ")" });
        if (fr.auraCount) lines.push({ label: "Stat modifiers", value: String(fr.auraCount) });
        return { kind: "OTHER", actor: nm(fr.owner), lines, code: fr.t };
      case "FIELD_EXIT":
        lines.push({ label: "Field ended", value: String(fr.name ?? "?") + " · " + String(fr.reason ?? "—") });
        if (fr.auras) lines.push({ label: "Reverted", value: String(fr.auras) + " stat modifier(s)" });
        return { kind: "OTHER", lines, code: fr.t };
      case "FIELD_SKIPPED":
        lines.push({ label: "Field not deployed", value: String(fr.name ?? "?") + " (" + String(fr.reason ?? "") + ")", tone: "warn" });
        return { kind: "OTHER", lines, code: fr.t };
      /** Betting endgame (policies.endgame): a referee round completed — every living shikigami acted once. */
      case "REFEREE_ROUND":
        lines.push({ label: "Referee round", value: String(fr.round ?? "?") + " complete (" + String(fr.policy ?? "?") + ")", tone: "warn" });
        lines.push({ label: "DMG multiplier", value: "×" + Number(fr.damageMultiplier ?? 1).toFixed(2) });
        lines.push({ label: "Heal multiplier", value: "×" + Number(fr.healingMultiplier ?? 1).toFixed(2) });
        return { kind: "STATUS", lines, code: fr.t };
      /** Betting endgame: turn cap reached ⇒ more survivors wins, then higher team HP%. */
      case "TIMEOUT_DECISION": {
        const pct = (x: any) => Math.round(Number(x ?? 0) * 1000) / 10 + "%";
        lines.push({ label: "Time limit", value: fr.reason === "TIMEOUT_ALIVE" ? "Decided by surviving shikigami" : fr.reason === "TIMEOUT_HP" ? "Decided by remaining HP%" : "Draw", tone: "warn" });
        lines.push({ label: "Survivors", value: "Red " + String(fr.alive?.[0] ?? "?") + " · Blue " + String(fr.alive?.[1] ?? "?") });
        lines.push({ label: "Remaining HP", value: "Red " + pct(fr.hpPct?.[0]) + " · Blue " + pct(fr.hpPct?.[1]) });
        if (fr.winner === 0 || fr.winner === 1) lines.push({ label: "Winner", value: fr.winner === 0 ? "Red" : "Blue" });
        return { kind: "OTHER", lines, code: fr.t };
      }
      case "ENV_STAGE":
        lines.push({ label: "Endgame stage", value: String(fr.stageBefore ?? 0) + " → " + String(fr.stage ?? 0), tone: "warn" });
        lines.push({ label: "DMG multiplier", value: "×" + Number(fr.damageMultiplier ?? 1).toFixed(3) });
        lines.push({ label: "Heal multiplier", value: "×" + Number(fr.healingMultiplier ?? 1).toFixed(3) });
        lines.push({ label: "Battle time", value: String(fr.at ?? 0) + " " + String(fr.timeUnit ?? "") + " (rule " + String(fr.rule ?? "?") + ")" });
        return { kind: "STATUS", lines, code: fr.t };
      /**
       * ★★★ 第 110 轮：**召唤物上场**（kind=SUMMON）。与 FORM_ENTER 的区别是本体**留在场上** ——
       *   画面上必须分得清"多了一个单位"与"本体变成了那个单位"。
       */
      case "SUMMON_ENTER":
        lines.push({ label: "Summon enters", value: String(fr.name ?? "?") + " (" + String(fr.tipsId ?? "?") + ")" });
        lines.push({ label: "Owner", value: nm(fr.owner) + " stays on field" });
        lines.push({ label: "Entry", value: String(fr.trigger ?? "—") + " · " + String(fr.placement ?? "—") });
        return { kind: "STATUS", actor: nm(fr.owner), lines, code: fr.t };
      case "ENV_MODIFIER":
        lines.push({ label: "Global modifier", value: String(fr.prop) + " " + (Number(fr.value) >= 0 ? "+" : "") + String(fr.value) + " (" + String(fr.mode) + ")" });
        lines.push({ label: "Source", value: String(fr.source ?? "—") + " · rule " + String(fr.rule ?? "?") });
        return { kind: "STATUS", lines, code: fr.t };
      case "STEAL_RETURN":
        lines.push({ label: "Returned", value: String(fr.status) });
        return { kind: "STATUS", target: nm(fr.id), lines, code: fr.t };
      case "STEAL_RETURN_ALL":
        lines.push({ label: "Returned all", value: (fr.count ?? 0) + " item(s) (" + String(fr.reason ?? "") + ")" });
        return { kind: "STATUS", target: nm(fr.id), lines, code: fr.t };
      // ★ 作用范围：一个技能打谁、给谁加，由技能原文决定（见 a1-4 §16 与 tests/g17）。
      //   它必须出现在 Banner 上 —— 否则"群攻到底打了几个人"只能靠数伤害条目去猜。
      case "TARGET_SCOPE": {
        const MODE_CN: Record<string, string> = {
          SELF: "Self", ALLY_ALL: "All allies", ALLY_ONE: "Ally target",
          ENEMY_ALL: "All enemies", ENEMY_RANDOM: "Random enemy", ENEMY_ONE: "Enemy target",
        };
        lines.push({ label: "Scope", value: MODE_CN[fr.mode as string] ?? String(fr.mode) });
        if ((fr.hurt ?? []).length) lines.push({ label: "Hit", value: (fr.hurt as number[]).map(nm).join(", ") });
        if ((fr.aid ?? []).length) lines.push({ label: "Benefit", value: (fr.aid as number[]).map(nm).join(", ") });
        return { kind: "OTHER", actor: nm(fr.actor), skill: fr.skill, lines, code: fr.t };
      }
      /**
       * ★★★ 第 140 轮：**叠层场地（花海）**的四条痕迹。
       *   执行点还没接（见报告 §124），但词汇表必须**现在就对齐** ——
       *   ui13 的闸门要求"发得出的类型要么有 Banner、要么写明理由"，
       *   而"先加代码后补渲染"正是它要防的事（新机制在剧场里只剩一个没有解释的空条目）。
       */
      case "LAYER_FIELD_SET":
        lines.push({ label: "Stacks", value: String(fr.before ?? "?") + " → " + String(fr.after ?? "?"), tone: (fr.after ?? 0) < (fr.before ?? 0) ? "warn" : "normal" });
        lines.push({ label: "Cap", value: String(fr.cap ?? "?") + " stacks (scales with HP%)" });
        lines.push({ label: "Reason", value: String(fr.reason ?? "—") });
        return { kind: "STATUS", actor: nm(fr.owner), lines, code: fr.t };
      case "LAYER_FIELD_GRANT":
        lines.push({ label: "Stacks gained", value: "+" + String(fr.gained ?? 0) + " (" + String(fr.before ?? "?") + " → " + String(fr.after ?? "?") + ")" });
        lines.push({ label: "Source", value: String(fr.reason ?? "—") });
        return { kind: "STATUS", actor: nm(fr.owner), lines, code: fr.t };
      case "LAYER_FIELD_DECAY":
        lines.push({ label: "Turn-start decay", value: String(fr.before ?? "?") + " → " + String(fr.after ?? "?"), tone: "warn" });
        lines.push({ label: "Floor", value: String(fr.min ?? 1) + " stacks (text: never below)" });
        return { kind: "STATUS", actor: nm(fr.owner), lines, code: fr.t };
      case "LAYER_FIELD_DAMAGE": {
        lines.push({ label: fr.term ?? "Stacks", value: String(fr.layers ?? 0) + " stacks × ATK " + (Number(fr.ratio ?? 0) * 100).toFixed(0) + "%" });
        // ★ tone 只认 normal/crit/resist/heal/warn（vue-tsc 当场抓到第一版写的 "dmg"）
        lines.push({ label: "Damage", value: String(Math.round(fr.applied ?? 0)), tone: "normal" });
        return { kind: "OTHER", actor: nm(fr.owner), target: nm(fr.dst), lines, code: fr.t };
      }
      case "TIMELINE_SHIFT":
        lines.push({ label: fr.direction === "pull" ? "Pull action bar" : "Push action bar", value: ((fr.percent ?? 0) * 100).toFixed(0) + "%" });
        lines.push({ label: "Position", value: `${Math.round(fr.posBefore ?? 0)} → ${Math.round(fr.posAfter ?? 0)}` });
        return { kind: "TIMELINE", actor: nm(fr.id), skill: fr.skill, lines, code: fr.t };
      case "ORB_PAY":
        lines.push({ label: "Onibi", value: `${fr.before} → ${fr.after} (-${fr.amount})`, tone: "warn" });
        return { kind: "ORB", actor: nm(fr.actor), skill: fr.skill, lines, code: fr.t };
      case "ORB_GAIN":
        lines.push({ label: "Onibi gain", value: `${fr.before} → ${fr.after} (+${fr.after - fr.before})` });
        if (fr.overflow) lines.push({ label: "Overflow", value: String(fr.overflow), tone: "warn" });
        return { kind: "ORB", actor: nm(fr.src), lines, code: fr.t };
      case "ORB_REWARD":
        lines.push({ label: "Onibi reward", value: "+" + (fr.gained ?? 0) });
        if (fr.overflow) lines.push({ label: "Overflow", value: String(fr.overflow), tone: "warn" });
        return { kind: "ORB", lines, code: fr.t };
      case "DEATH":
        lines.push({ label: "Defeated", value: fr.killer != null ? "by " + nm(fr.killer) : "—" });
        return { kind: "DEATH", target: nm(fr.id), lines, code: fr.t };
      case "LETHAL":
        lines.push({ label: "Lethal damage", value: "HP " + Math.round(fr.hp ?? 0), tone: "warn" });
        return { kind: "DEATH", target: nm(fr.id), lines, code: fr.t };
      case "DEATH_PREVENTED":
        lines.push({ label: "Death prevented", value: "This death was blocked", tone: "resist" });
        return { kind: "DEATH", target: nm(fr.id), lines, code: fr.t };
      case "REVIVE":
        lines.push({ label: "Revive", value: "HP " + Math.round(fr.hp ?? 0), tone: "heal" });
        return { kind: "REVIVE", target: nm(fr.id), lines, code: fr.t };
      /**
       * ★★★ 第 129 轮：**触发式自复活**（「阵亡时，若拥有4层…立即复活并治疗生命上限20%的生命」）。
       *   与主动复活（上面那条 REVIVE）分开渲染，因为要说清的是"**为什么**这次复活成立"：
       *   门槛层数、走的是恢复还是治疗通道、有没有把层数消耗掉。
       */
      case "SELF_REVIVE":
        lines.push({ label: "Triggered revive", value: "Max HP " + String(fr.hpPercent ?? "?") + "%", tone: "heal" });
        if (fr.stacks !== null && fr.stacks !== undefined) lines.push({ label: "Required stacks", value: String(fr.stacks) + (fr.consumed ? " (consumed)" : " (kept)") });
        lines.push({ label: "Channel", value: fr.channel === "RECOVER" ? "Recover (official [20], ignores heal reduction)" : "Heal (affected by heal reduction)" });
        return { kind: "REVIVE", target: nm(fr.id), lines, code: fr.t };
      case "SELF_REVIVE_BLOCKED":
        lines.push({ label: "Triggered revive failed", value: String(fr.reason ?? "—"), tone: "warn" });
        if (fr.need !== undefined) lines.push({ label: "Stacks", value: String(fr.have ?? 0) + " / need " + String(fr.need) });
        return { kind: "DEATH", target: nm(fr.id), lines, code: fr.t };
      case "TRANSFORMED":
        lines.push({ label: "Transform", value: "Immune to this death", tone: "resist" });
        return { kind: "DEATH", target: nm(fr.id), lines, code: fr.t };
      /**
       * ★★★ 第 130 轮：**自身的「受到致命伤害时，进入[tips_N]姿态」**（百羽凤凰火「未熄羽」→ 余烬）。
       *   它和上面的"变形免死"是两件事：那个是**拦下这一次死亡**（本体还在），
       *   这个是**换人**（本体离场、形态上场）—— 画面上必须说清是哪一个
       *   （回归时机也一起显示：余烬是"到达行动条终点"，蛇神是"形态阵亡"）。
       */
      case "LETHAL_FORM":
        lines.push({ label: "Lethal ⇒ transform", value: String(fr.name ?? "?") + " (" + String(fr.tipsId ?? "?") + ")", tone: "resist" });
        lines.push({ label: "Returns on", value: fr.returnOn === "TIMELINE_END" ? "Form reaches end of action bar" : String(fr.returnOn ?? "—") });
        lines.push({ label: "This death", value: "Not counted: owner leaves, form takes over" });
        return { kind: "REVIVE", target: nm(fr.id), lines, code: fr.t };
      /**
       * ★★★ 第 106 轮：**补上 25 种 trace 类型的 Banner**。
       *
       * 由来：机制一直在加（放置单位 / 偷取 / 免疫 / 吸血 / 免死 / 反击 / 锁条 / 抵抗…），
       * 但 Theater 的 Presenter 只认得 24 种 trace —— 新机制在剧场里**只剩一个没有解释的空条目**，
       * 而"什么都没发生"与"发生了但没渲染"在画面上是一样的。
       * 这一轮把「引擎发出的 trace 类型」与「Presenter 的 case」机械对齐（见 tests/ui13-trace-vocab.ts）。
       */
      case "SUMMON_CREATE":
        lines.push({ label: "Placed unit", value: String(fr.name ?? "?") + " (tips_" + String(fr.tipsId ?? "?") + ")" });
        lines.push({ label: "HP", value: String(fr.hp ?? "?") });
        if (fr.noAction) lines.push({ label: "Action", value: "Cannot act", tone: "warn" });
        if (fr.suppressed != null) lines.push({ label: "Seal", value: nm(fr.suppressed) + " replaced" });
        return { kind: "OTHER", actor: nm(fr.owner), lines, code: fr.t };
      case "SUMMON_SLOT_FULL":
        lines.push({ label: "Summon slots full", value: String(fr.name ?? "?") + " (slots " + String(fr.slots ?? "?") + ")", tone: "warn" });
        return { kind: "OTHER", actor: nm(fr.owner), lines, code: fr.t };
      case "SUMMON_NO_SKILLS":
        lines.push({ label: "Placed unit has no skills", value: "so its action bar does not advance", tone: "warn" });
        return { kind: "OTHER", lines, code: fr.t };
      case "FORM_ENTER":
        lines.push({ label: "Form entered", value: String(fr.name ?? "?") });
        // betting kits (betting-otakemaru.ts) name the shikigami `id` instead of `owner`
        lines.push({ label: "Owner", value: nm(fr.owner ?? fr.id) + " leaves field" });
        lines.push({ label: "Returns on", value: String(fr.returnOn ?? "?") });
        return { kind: "OTHER", actor: nm(fr.owner ?? fr.id), lines, code: fr.t };
      case "FORM_RETURN":
        lines.push({ label: "Form ended", value: nm(fr.owner) + " returns to field" });
        lines.push({ label: "HP", value: String(fr.hp ?? "?") + " (" + String(fr.returnHp ?? "") + ")" });
        if (fr.reason === "SEAL_RELEASE") lines.push({ label: "Reason", value: "Seal released" });
        return { kind: "OTHER", actor: nm(fr.owner), lines, code: fr.t };
      case "FORM_SKILL":
        lines.push({ label: "Form skill", value: String(fr.skill ?? "?") + " belongs to this form" });
        return { kind: "OTHER", actor: nm(fr.owner), lines, code: fr.t };
      /**
       * ★★★ 第 131 轮：**替友方拦截致命伤**（KB：伊邪那美「神赐之吻」）。
       *   与"免死"（状态自带 preventsLethal）分开渲染：那是目标自己的状态救了自己，
       *   这是**队友站在场上**替他挡下来的 —— 画面上必须能看出是谁救的。
       */
      case "ALLY_GUARD":
        lines.push({ label: "Ally blocked lethal damage", value: nm(fr.owner) + " → " + nm(fr.target), tone: "resist" });
        lines.push({ label: "Result", value: "Left at 1 HP (guard clause: " + String(fr.status) + ")" });
        lines.push({ label: "Count", value: "#" + String(fr.usedThisWindow ?? 1) + " this window · #" + String(fr.totalUsed ?? 1) + " total" });
        return { kind: "DEATH", target: nm(fr.target), lines, code: fr.t };
      case "ALLY_GUARD_BLOCKED":
        lines.push({ label: "Guard not applied", value: fr.reason === "PER_TURN_LIMIT" ? "Already used this turn window" : "Total uses exhausted", tone: "warn" });
        lines.push({ label: "Count", value: "used " + String(fr.used ?? 0) + " / max " + String(fr.limit ?? "—") });
        return { kind: "DEATH", target: nm(fr.target), lines, code: fr.t };
      /**
       * ★★ 两份计数的复位也要看得见 —— 否则"为什么这次又能拦了"在回放里没有解释：
       *   · ALLY_GUARD_RESET：状态被重新施加（「被再次施加毁灭前至多累计触发3次」）；
       *   · ALLY_GUARD_WINDOW：目标自己的回合开始（「目标下回合开始前至多触发1次」）。
       */
      case "ALLY_GUARD_RESET":
        lines.push({ label: "Guard count reset", value: "\"" + String(fr.status ?? "?") + "\" re-applied" });
        return { kind: "OTHER", target: nm(fr.target), lines, code: fr.t };
      case "ALLY_GUARD_WINDOW":
        lines.push({ label: "Guard window reopened", value: "Target's own turn started (max once per window)" });
        return { kind: "OTHER", target: nm(fr.target), lines, code: fr.t };
      /**
       * ★★★ 第 132 轮：**"御魂没装上"必须看得见**。
       *   背景：订阅是函数、不进 BattleState —— 恢复时调用方没给知识库，御魂战斗效果就装不上。
       *   "少装一套"与"这套御魂本来就没效果"在画面上完全一样，所以这条要单独渲染。
       */
      case "SOUL_STATE_UNAVAILABLE":
        lines.push({ label: "Souls not reinstalled", value: String(fr.note ?? fr.reason ?? "—"), tone: "warn" });
        lines.push({ label: "Impact", value: "No Soul battle effects will trigger this match" });
        return { kind: "OTHER", lines, code: fr.t };
      /**
       * ★★★ 第 135 轮：**触发式追加施放**（「阵亡时…并对随机敌方目标施放『X』」）。
       *   与"再放一次这个被动"是两件事：这里放的是**被点名的那一个技能**（走伪回合入口）。
       *   跳过也要看得见（技能不在表里 / 已经在伪回合里 ⇒ 不连锁）。
       */
      case "SUBCAST":
        lines.push({ label: "Extra cast", value: String(fr.skill ?? fr.ref ?? "?") + " → " + (nm(fr.target) ?? "—"), tone: "resist" });
        lines.push({ label: "Trigger", value: "Pseudo-turn cast (same path as counter/assist)" });
        return { kind: "OTHER", actor: nm(fr.actor), target: nm(fr.target), lines, code: fr.t };
      /** Betting-mode mechanics (battle-lab/compile/betting-mechanics.ts) */
      case "STACKS_CONSUMED":
        lines.push({ label: "Stacks spent", value: String(fr.name ?? fr.status) + " " + String(fr.from ?? "?") + " → " + String(fr.to ?? "?") });
        lines.push({ label: "Reason", value: String(fr.reason ?? "—") });
        return { kind: "OTHER", actor: nm(fr.id), skill: fr.skill, lines, code: fr.t };
      case "GOLDFISH_RAGE":
        lines.push({ label: "Goldfish counter", value: "鱼之怒 → all enemies (every " + String(fr.every ?? 8) + " enemy turns)", tone: "resist" });
        return { kind: "OTHER", actor: nm(fr.actor), skill: fr.skill, lines, code: fr.t };
      /** 鲸汐千姬 / 云外镜 (battle-lab/compile/betting-senhime.ts, betting-ungaikyo.ts) */
      case "SEA_FROST_STORE":
        lines.push({ label: "海凝 stored", value: "+" + String(fr.added ?? 0) + " → " + String(fr.stored ?? 0) + " (" + String(fr.stacks ?? 1) + " stack(s))" + (fr.capped ? " · capped" : "") });
        lines.push({ label: "Source", value: String(fr.reason ?? "—") + (fr.skill ? " · " + String(fr.skill) : "") });
        return { kind: "OTHER", actor: nm(fr.src), target: nm(fr.dst), skill: "海凝", lines, code: fr.t };
      case "SEA_FROST_BURST":
        lines.push({ label: "海凝 burst", value: String(fr.stored ?? 0) + " stored damage dealt as indirect damage", tone: "crit" });
        return { kind: "OTHER", actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill, lines, code: fr.t };
      case "WHALE_SUMMON":
        lines.push({ label: "Whale summoned", value: String(fr.name ?? "?") + " for " + String(fr.turns ?? 1) + " turn(s) (" + String(fr.reason ?? "—") + ")", tone: "resist" });
        return { kind: "OTHER", actor: nm(fr.owner), target: nm(fr.summon), lines, code: fr.t };
      case "WHALE_CAP":
        lines.push({ label: "Whale not summoned", value: "At most " + String(fr.cap ?? 2) + " " + String(fr.name ?? "whales") + " exist", tone: "warn" });
        return { kind: "OTHER", actor: nm(fr.owner), lines, code: fr.t };
      case "ICE_SLEEP":
        lines.push({ label: "冰眠", value: "Ice-sleep (cannot act until her turn starts) · " + String(fr.reason ?? "—") });
        return { kind: "OTHER", target: nm(fr.id), lines, code: fr.t };
      case "SHIELD_EXPIRE":
        lines.push({ label: "Shield expired", value: String(fr.remaining ?? 0) + " left unused" });
        return { kind: "OTHER", target: nm(fr.id), lines, code: fr.t };
      case "HEAL_TO_SHIELD":
        lines.push({ label: "Heal → shield", value: "Cannot be healed: " + String(Math.round(Number(fr.ratio ?? 0.5) * 100)) + "% of " + String(fr.heal ?? 0) + " becomes a shield", tone: "heal" });
        return { kind: "OTHER", actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill, lines, code: fr.t };
      case "YINYANG_FORM":
        lines.push({ label: "Form", value: (fr.form === "YIN" ? "Yin" : "Yang") + " (initial ATK " + String(fr.atk0) + " vs 500% DEF " + String(fr.threshold) + ")" });
        lines.push({ label: "Stats", value: "HP " + String(fr.hp) + " (other pool " + String(fr.otherHp) + ") · ATK " + String(fr.atk) + " · DEF " + String(fr.def) });
        return { kind: "OTHER", actor: nm(fr.id), lines, code: fr.t };
      case "SKILL_TABLE_SWAP":
        lines.push({ label: "Skill table", value: String(fr.form ?? "?") + ": " + (Array.isArray(fr.skills) ? fr.skills.join(" / ") : "—") });
        return { kind: "OTHER", actor: nm(fr.id), lines, code: fr.t };
      case "BLACK_LOTUS_EXTRA":
        lines.push({ label: "Extra Black Lotus", value: "+" + String(fr.extra ?? 0) + " hit(s) at Yin HP " + String(fr.yinHpRatio ?? "?") });
        return { kind: "OTHER", actor: nm(fr.actor), skill: fr.skill, lines, code: fr.t };
      case "HIT_DECAYED_OUT":
        lines.push({ label: "Hit skipped", value: "Repeat-hit decay reached 0% on " + (nm(fr.dst) ?? "—"), tone: "warn" });
        return { kind: "OTHER", actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill, lines, code: fr.t };
      case "SUBCAST_SKIPPED":
        lines.push({
          label: "Extra cast skipped",
          value: fr.reason === "SKILL_NOT_FOUND" ? "Skill not in own skill list"
            : fr.reason === "CHAINED" ? "Already in a pseudo-turn (no chaining)"
            : fr.reason === "NO_TARGET" ? "No valid target" : "Caster is defeated",
          tone: "warn",
        });
        return { kind: "OTHER", actor: nm(fr.actor), lines, code: fr.t };
      /**
       * ★★★ 第 136 轮：**额外推进鬼火行动条**（「[先机]：使鬼火行动条额外推进1格」/
       *   「自身回合结束后额外推进3格鬼火行动条…」）。
       *   与回合开始那一次推进分开渲染：那一次是规则，这一次是**原文点名的"额外"**，观众要能看出是谁推的。
       */
      case "ORB_GAUGE_ADVANCE_EXTRA":
        lines.push({ label: "Extra Onibi gauge", value: String(fr.cells ?? 0) + " cell(s) (" + String(fr.reason ?? "—") + ")" });
        lines.push({ label: "Result", value: "filled ×" + String(fr.filled ?? 0) + " · now " + String(fr.gauge ?? 0) + " cell(s) · cycle " + String(fr.cycle ?? 0) });
        return { kind: "OTHER", actor: nm(fr.actor), lines, code: fr.t };
      case "FORM_SKIPPED":
        lines.push({ label: "Form not entered", value: String(fr.reason ?? "?"), tone: "warn" });
        return { kind: "OTHER", actor: nm(fr.owner), lines, code: fr.t };
      case "SEAL":
        lines.push({ label: "Seal", value: nm(fr.victim) + " → " + String(fr.name ?? "?") });
        lines.push({ label: "Replacement", value: nm(fr.summon) ?? String(fr.summon ?? "?") });
        lines.push({ label: "Release", value: "Returns at 1 HP when the replacement is defeated" });
        return { kind: "DEATH", actor: nm(fr.killer), target: nm(fr.victim), lines, code: fr.t };
      case "PLACE_ON_KILL":
        lines.push({ label: "Summon on kill", value: String(fr.name ?? "?") });
        lines.push({ label: "Position", value: "fallen unit's action bar position " + String(Math.round(fr.pos ?? 0)) });
        return { kind: "OTHER", actor: nm(fr.killer), target: nm(fr.victim), lines, code: fr.t };
      case "PLACE_STACK":
        lines.push({ label: "Repeat summon", value: "Max HP +" + String(Math.round(fr.gain ?? 0)) + " (#" + String(fr.stacks ?? "?") + ")" });
        lines.push({ label: "Fully healed", value: "Max HP " + String(Math.round(fr.maxHp ?? 0)) });
        return { kind: "OTHER", actor: nm(fr.killer), lines, code: fr.t };
      case "PLACE_STACK_CAPPED":
        lines.push({ label: "Repeat summon capped", value: "Only heals to full", tone: "warn" });
        return { kind: "OTHER", actor: nm(fr.killer), lines, code: fr.t };
      case "PLACE_REJECTED":
        lines.push({ label: "Summon rejected", value: String(fr.reason ?? "?"), tone: "warn" });
        return { kind: "OTHER", actor: nm(fr.killer), lines, code: fr.t };
      case "PLACE_STANDALONE":
        lines.push({ label: "Summon", value: String(fr.name ?? "?") + " (standalone unit)" });
        return { kind: "OTHER", actor: nm(fr.owner), lines, code: fr.t };
      case "LINK_END":
        lines.push({ label: "Aura ended", value: "Placed unit left ⇒ \"while on field\" effects removed" });
        return { kind: "STATUS", target: nm(fr.owner), lines, code: fr.t };
      case "STATUS_STEAL":
        lines.push({ label: "Status steal", value: (fr.statuses ?? []).join(", ") });
        lines.push({ label: "Order", value: String(fr.order ?? "") });
        return { kind: "STATUS", actor: nm(fr.src), target: nm(fr.dst), lines, code: fr.t };
      case "STATUS_STEAL_BLOCKED":
        lines.push({ label: "Status steal blocked", value: String(fr.reason ?? "?"), tone: "warn" });
        return { kind: "STATUS", actor: nm(fr.src), target: nm(fr.dst), skill: fr.skill, lines, code: fr.t };
      case "IMMUNE":
        lines.push({ label: "Immune", value: String(fr.name ?? fr.status ?? "?") + " blocked" });
        lines.push({ label: "By", value: String(fr.by ?? "?") + " (" + String(fr.kind ?? "") + ")", tone: "resist" });
        return { kind: "STATUS", actor: nm(fr.src), target: nm(fr.dst), lines, code: fr.t };
      case "STATUS_RESIST":
        lines.push({ label: "Resisted", value: "Effective chance " + Math.round((Number(fr.effective ?? 0)) * 100) + "%", tone: "resist" });
        return { kind: "STATUS", actor: nm(fr.src), target: nm(fr.dst), lines, code: fr.t };
      case "STATUS_MISS":
        lines.push({ label: "Missed", value: "Chance " + Math.round(Number(fr.probability ?? 0) * 100) + "%", tone: "warn" });
        return { kind: "STATUS", actor: nm(fr.src), target: nm(fr.dst), lines, code: fr.t };
      case "STATUS_REMOVE":
        lines.push({ label: fr.by === "DISPEL" ? "Dispel" : "Removed", value: String(fr.name ?? fr.status ?? "?") });
        return { kind: "STATUS", target: nm(fr.id), lines, code: fr.t };
      case "STATUS_DURATION_CONFLICT":
        lines.push({ label: "Duration conflict", value: "skill says " + String(fr.fromSkill) + " / mark says " + String(fr.fromBuff) + " ⇒ using " + String(fr.used), tone: "warn" });
        return { kind: "STATUS", target: nm(fr.status), lines, code: fr.t };
      case "LIFESTEAL":
        lines.push({ label: "Lifesteal", value: "+" + Math.round(fr.healed ?? 0), tone: "heal" });
        return { kind: "OTHER", actor: nm(fr.src), lines, code: fr.t };
      case "UNDYING":
        lines.push({ label: "Undying", value: String(Math.round(fr.hpAfter ?? fr.hp ?? 1)) + " HP left", tone: "resist" });
        return { kind: "DEATH", target: nm(fr.id ?? fr.dst), lines, code: fr.t };
      /**
       * ★★★ 第 129 轮：两条**"少算"的留痕**必须看得见 —— 否则"没做"与"做了但没渲染"在画面上一样。
       *   · KILLED_SKIPPED：目标在 EV.DEATH 期间把自己复活了 ⇒ 不再记 killed（记了就是把 revive 刚清掉的标记钉回去）；
       *   · PASSIVE_SKIPPED：这一句的承受者写着「伤害来源」，但**逐句归属的证据不齐**（不是每个 [buff_x] 都有来源子句证据）
       *     ⇒ 照旧失败关闭、装都不装。
       *   ★ 第 176 轮：**逐句承受者归属接上之后**，这一族正常路径不再走 PASSIVE_SKIPPED；
       *     新出现的是 STATUS_BEARER_SKIPPED（下一次出现：这一句有证据、但**事件载荷里取不到来源**）。
       */
      case "KILLED_SKIPPED":
        lines.push({ label: "Kill settlement skipped", value: String(fr.reason ?? "—"), tone: "warn" });
        lines.push({ label: "Reason", value: "Target revived during the death flow; killed flag not written back" });
        return { kind: "DEATH", target: nm(fr.id), lines, code: fr.t };
      case "PASSIVE_SKIPPED":
        lines.push({ label: "Passive not installed", value: String(fr.skill ?? "?") + " (" + String(fr.family ?? "—") + ")", tone: "warn" });
        lines.push({ label: "Reason code", value: String(fr.reason ?? "—") });
        lines.push({ label: "Text", value: String(fr.clause ?? "—") });
        return { kind: "OTHER", actor: nm(fr.entity), lines, code: fr.t };
      /**
       * ★★★ 第 176 轮：**逐句承受者归属**的"少算"留痕。
       *   这一句的效果是"把状态投给伤害来源"，而这次触发**载荷里没有来源**（最典型：主动施放这条技能 ——
       *   主动路径不传事件载荷）⇒ 按 fail-closed 不施加。不渲染的话，"没做"与"做了但没渲染"在画面上一样。
       */
      case "STATUS_BEARER_SKIPPED":
        lines.push({ label: "Bearer = damage source", value: "No source available ⇒ not applied", tone: "warn" });
        lines.push({ label: "Status", value: String(fr.ref ?? "?") + " (" + String(fr.skill ?? "?") + ")" });
        lines.push({ label: "Reason code", value: String(fr.reason ?? "—") });
        lines.push({ label: "Text", value: String(fr.clause ?? "—") });
        return { kind: "OTHER", actor: nm(fr.src), lines, code: fr.t };
      /**
       * ★★★ 第 194 轮：**池子（随机增益 / 随机减益）**的两条留痕。
       *   · POOL_MISS：这次施加的概率没掷中（原文写了概率就掷，100% 也掷 —— 与状态那一段同一口径）；
       *   · POOL_BEARER_SKIPPED：这一条池子的承受者写着「攻击者」，而本次载荷里取不到来源 ⇒ fail-closed 不施加。
       *   两条都是"少算"，必须看得见 —— 否则"没做"与"做了但没渲染"在画面上一样。
       */
      case "POOL_MISS":
        lines.push({ label: "Random effect missed", value: String(fr.pool ?? "?") + " · Chance " + Math.round(Number(fr.probability ?? 0)) + "%", tone: "warn" });
        return { kind: "STATUS", actor: nm(fr.src), target: nm(fr.dst), lines, code: fr.t };
      case "POOL_BEARER_SKIPPED":
        lines.push({ label: "Pool bearer = attacker", value: "No source available ⇒ not applied", tone: "warn" });
        lines.push({ label: "Pool", value: String(fr.pool ?? "?") + " (" + String(fr.skill ?? "?") + ")" });
        lines.push({ label: "Text", value: String(fr.clause ?? "—") });
        return { kind: "OTHER", actor: nm(fr.src), lines, code: fr.t };
      /**
       * ★★★ 第 195 轮：**占位符形态的控制效果**（`[tips_101]`=冰冻 / `[tips_108]`=眩晕…）的两条留痕。
       *   · CONTROL_MISS：这次控制没掷中（原文写了概率就掷，8% 就该有 92% 打空）；
       *   · CONTROL_BEARER_SKIPPED：这一条写着「使攻击来源…」，而本次载荷里取不到来源 ⇒ fail-closed 不施加。
       *   两条都是"少算"，必须看得见 —— 否则"没做"与"做了但没渲染"在画面上一样。
       */
      case "CONTROL_MISS":
        lines.push({ label: "Control missed", value: String(fr.name ?? fr.status ?? "?") + " · Chance " + Math.round(Number(fr.probability ?? 0)) + "%", tone: "warn" });
        return { kind: "STATUS", actor: nm(fr.src), target: nm(fr.dst), lines, code: fr.t };
      case "CONTROL_BEARER_SKIPPED":
        lines.push({ label: "Control bearer = attacker", value: "No source available ⇒ not applied", tone: "warn" });
        lines.push({ label: "Control", value: String(fr.name ?? fr.status ?? "?") + " (" + String(fr.skill ?? "?") + ")" });
        lines.push({ label: "Text", value: String(fr.clause ?? "—") });
        return { kind: "OTHER", actor: nm(fr.src), lines, code: fr.t };
      /**
       * ★★★ 第 187 轮：**消耗型换命**（石长姬「磐长纪」）—— 花掉一朵凝炼的生命换回一条命。
       *   它是与「免死 / 替友方拦死 / ON_LETHAL 转化」并列的**第四种活下来**，必须看得见：
       *   花了多少朵、还剩几朵、生命从多少回到多少。反向的那一条也要看得见（没有朵 ⇒ 照常倒下）。
       */
      case "LETHAL_CONSUME":
        lines.push({ label: "Life trade", value: "spent " + String(fr.consumed ?? 1) + " · " + String(fr.left ?? "?") + " left" });
        lines.push({ label: "HP", value: String(fr.hpBefore ?? "?") + " → " + String(fr.hpAfter ?? "?") });
        lines.push({ label: "Text", value: String(fr.clause ?? "—") });
        return { kind: "OTHER", actor: nm(fr.id), lines, code: fr.t };
      case "LETHAL_CONSUME_BLOCKED":
        lines.push({ label: "Life trade", value: "nothing left to spend ⇒ falls as normal (" + String(fr.reason ?? "—") + ")", tone: "warn" });
        return { kind: "OTHER", actor: nm(fr.id), lines, code: fr.t };
      case "ONHIT_SKIPPED_FULLY_ABSORBED":
        lines.push({ label: "On-hit effects", value: "Damage fully absorbed ⇒ \"on dealing damage\" not triggered", tone: "warn" });
        return { kind: "OTHER", target: nm(fr.dst), lines, code: fr.t };
      /** Extra turns ("获得新的回合"; battle-lab/kernel/extra-turn.ts, e.g. the 轮入道 soul). */
      case "EXTRA_TURN_GRANTED":
        lines.push({ label: "Extra turn earned", value: String(fr.reason ?? "—") + " (played after this turn)", tone: "resist" });
        return { kind: "OTHER", actor: nm(fr.actor), lines, code: fr.t };
      case "EXTRA_TURN":
        lines.push({ label: "Extra turn", value: "New turn from " + String(fr.reason ?? "—") + " (no onibi-gauge advance)", tone: "resist" });
        return { kind: "OTHER", actor: nm(fr.actor), lines, code: fr.t };
      case "COUNTER":
        lines.push({ label: "Counter", value: String(fr.skill ?? "Normal attack") });
        return { kind: "OTHER", actor: nm(fr.actor), target: nm(fr.target), lines, code: fr.t };
      case "SKILL_FORCED":
        lines.push({ label: "Forced action", value: String(fr.skill ?? "?") + " (" + String(fr.reason ?? "") + ")", tone: "warn" });
        return { kind: "OTHER", actor: nm(fr.actor), lines, code: fr.t };
      case "ACTION_PREVENTED":
        lines.push({ label: "Cannot act", value: (fr.by ?? []).join(", "), tone: "warn" });
        return { kind: "OTHER", actor: nm(fr.actor), lines, code: fr.t };
      case "TIMELINE_LOCKED":
        lines.push({ label: "Action bar locked", value: String(fr.reason ?? "locked"), tone: "warn" });
        return { kind: "TIMELINE", actor: nm(fr.id), lines, code: fr.t };
      case "TIMELINE_MISS":
        lines.push({ label: "Action bar effect missed", value: String(fr.reason ?? ""), tone: "warn" });
        return { kind: "TIMELINE", actor: nm(fr.id), lines, code: fr.t };
      case "ORB_SOUL_MISS":
        lines.push({ label: "Soul effect missed", value: String(fr.soul ?? fr.reason ?? ""), tone: "warn" });
        return { kind: "ORB", lines, code: fr.t };
      // Emitted by battle-lab/soul/custom-effects.ts (hand-written soul installers).
      case "ORB_DRAIN":
        lines.push({ label: "Onibi drained", value: `${String(fr.skill ?? "Soul")}: ${fr.before ?? "?"} → ${fr.after ?? "?"}`, tone: "warn" });
        return { kind: "ORB", lines, code: fr.t };
      case "SOUL_PROC":
        lines.push({ label: "Soul effect", value: `${displayName(String(fr.soul ?? ""))}: ${String(fr.effect ?? "")}` });
        return { kind: "OTHER", actor: nm(fr.src), target: nm(fr.dst), lines, code: fr.t };
      case "HP_LOSS":
        lines.push({ label: "HP lost", value: "-" + Math.round(fr.amount ?? 0), tone: "warn" });
        return { kind: "OTHER", target: nm(fr.dst), lines, code: fr.t };
      case "VICTORY_CHECK":
        lines.push({ label: "Victory check", value: String(fr.reason ?? "—") + " (check #" + String(fr.checked ?? "?") + ")" });
        return { kind: "OTHER", lines, code: fr.t };
      case "EVENT_OVERFLOW":
        lines.push({ label: "Event recursion overflow", value: "one level was skipped here", tone: "warn" });
        return { kind: "OTHER", lines, code: fr.t };
      // Hand-written betting kits (battle-lab/compile/betting-*.ts). Names stay as the engine wrote them;
      // the theater translates them for display (kb/en-engine.ts → enBanner).
      default:
        return bettingBanner(fr, nm) ?? { kind: "OTHER", lines, code: fr.t };
    }
  }

  /** 舞台飘字：这一帧产生的数字 */
  floats(fr: ReplayFrame | null | undefined, units: UnitView[]): TheaterView["floats"] {
    if (!fr) return [];
    const uid = (id: any) => units.find(u => sameId(u.id, id))?.unitId;
    const out: TheaterView["floats"] = [];
    switch (fr.t) {
      case "DAMAGE": { const u = uid(fr.dst); if (u) out.push({ unitId: u, text: "-" + Math.round(fr.applied ?? 0), tone: fr.crit ? "crit" : "dmg" }); break; }
      case "HEAL": case "RECOVER": { const u = uid(fr.dst); if (u) out.push({ unitId: u, text: "+" + Math.round(fr.amount ?? 0), tone: "heal" }); break; }
      case "SHIELD_APPLY": { const u = uid(fr.dst); if (u) out.push({ unitId: u, text: "Shield +" + Math.round(fr.value ?? 0), tone: "shield" }); break; }
      case "STATUS_APPLY": { const u = uid(fr.dst); if (u) out.push({ unitId: u, text: String(fr.name ?? fr.status ?? "Status"), tone: "shield" }); break; }
      // ★ 第 99 轮：偷取要在双方身上都看得见（一个 −、一个 +），否则"属性变了"没有解释
      case "STAT_STEAL": {
        const t = uid(fr.dst), s = uid(fr.src);
        if (t) out.push({ unitId: t, text: "−" + Math.round(fr.toTarget ?? 0) + " " + statEn(fr), tone: "dmg" });
        if (s) out.push({ unitId: s, text: "+" + Math.round(fr.toActor ?? 0) + " " + statEn(fr), tone: "heal" });
        break;
      }
    }
    return out;
  }

  // ───────────── ★ G5 Inspectors ─────────────

  /** Damage Inspector（§26）：返回这一帧的伤害拆解；不是伤害帧就往前找最近一次 */
  damageBreakdown(frameIndex: number): { frame: number; data: any } | null {
    for (let i = Math.min(frameIndex, this.player.frameCount - 1); i >= 0; i--) {
      const f: any = this.player.frame(i);
      if (f && f.t === "DAMAGE" && f.breakdown) return { frame: i, data: f.breakdown };
    }
    return null;
  }

  /** AI Inspector（§25）：最近一次 AI 决策（技能选择 + 目标选择） */
  aiDecision(frameIndex: number): { frame: number; skill: any; target: any } | null {
    let skill: any = null, target: any = null, sf = -1, tf = -1;
    for (let i = Math.min(frameIndex, this.player.frameCount - 1); i >= 0; i--) {
      const f: any = this.player.frame(i);
      if (!f) continue;
      if (!skill && f.t === "AI_DECISION") { skill = f; sf = i; }
      if (!target && f.t === "AI_TARGET") { target = f; tf = i; }
      if (skill && target && i < Math.min(sf, tf)) break;
      if (skill && target) break;
    }
    return (skill || target) ? { frame: Math.max(sf, tf), skill, target } : null;
  }

  /**
   * Buff/状态检查器（§27）：从帧流里还原每个状态的**生命周期**
   * （什么时候上的、谁给的、还剩多久、什么时候没的），而不是只看当前快照。
   */
  statusTimeline(unitId?: string): Array<{
    unitId: string; status: string; name?: string; from: number; to: number | null;
    duration: number | null; source: string | null; known: boolean; expired: boolean;
  }> {
    const out: Array<any> = [];
    const open = new Map<string, number>();   // tag → index in out
    for (let i = 0; i < this.player.frameCount; i++) {
      const f: any = this.player.frame(i);
      if (!f) continue;
      const uid = (id: any) => this.unitIdByEntity.get(Number(id))?.unitId ?? String(id);
      if (f.t === "STATUS_APPLY") {
        const key = `${f.dst}:${f.status}:${f.tag ?? i}`;
        /**
         * ★★★ 第 240 轮：**同一个状态实例的重复施加合并成一段**（计数器从 1 层涨到 5 层是一条生命周期，不是五条）。
         *   判据：key 里有状态实例自己的 tag ⇒ 只有"同一个实例再次施加"才会命中；
         *   不同实例（被驱散后再施加）tag 不同 ⇒ 仍然是两段。层数取**最新**（那才是卡面上读到的值）。
         */
        const prevIdx = open.get(key);
        const prevRec: any = prevIdx != null ? out[prevIdx] : null;
        if (prevRec && prevRec.to === null) {
          prevRec.stacks = f.stacks ?? prevRec.stacks;
          prevRec.threshold = f.threshold ?? prevRec.threshold;
          prevRec.reapplied = (prevRec.reapplied ?? 1) + 1;
          continue;
        }
        const rec = { unitId: uid(f.dst), status: f.status, name: f.name, from: i, to: null, duration: f.duration ?? null, source: f.src != null ? uid(f.src) : null, known: f.known !== false, expired: false, stacks: f.stacks ?? null, threshold: f.threshold ?? null, reapplied: 1 };
        open.set(key, out.length);
        out.push(rec);
      } else if (f.t === "STATUS_EXPIRE") {
        // 到期事件只带 status id 与单位 id，倒序找最近一个仍打开的同名状态
        for (let k = out.length - 1; k >= 0; k--) {
          const rec = out[k];
          if (rec.to === null && rec.status === f.status && rec.unitId === uid(f.id)) { rec.to = i; rec.expired = true; break; }
        }
      }
    }
    const filtered = unitId ? out.filter(r => r.unitId === unitId) : out;
    return filtered.sort((a, b) => a.from - b.from);
  }

  /** RNG Inspector（§20）：某帧用到的随机数（带用途标签） */
  rngAt(frameIndex: number): { frame: number; draws: Array<{ n: number; v: number; tag: string }> } | null {
    const f: any = this.player.frame(frameIndex);
    if (!f) return null;
    const draws: Array<{ n: number; v: number; tag: string }> = [];
    const bd = f.breakdown;
    if (bd) {
      if (bd.crit?.roll) draws.push(bd.crit.roll);
      if (bd.float?.roll) draws.push(bd.float.roll);
    }
    if (!draws.length) return null;
    return { frame: frameIndex, draws };
  }

  /** 整场用到但**没有用途标签**的抽数占比（诚实地暴露"还有多少随机说不清用途"） */
  rngSummary(): { total: number; labeled: number; unlabeled: number; byTag: Record<string, number> } {
    const draws = (this.player as any).file?.rng?.draws as Array<{ tag: string }> | undefined;
    if (!draws || !draws.length) return { total: 0, labeled: 0, unlabeled: 0, byTag: {} };
    const byTag: Record<string, number> = {};
    let unlabeled = 0;
    for (const d of draws) { byTag[d.tag] = (byTag[d.tag] ?? 0) + 1; if (d.tag === "unlabeled") unlabeled++; }
    return { total: draws.length, labeled: draws.length - unlabeled, unlabeled, byTag };
  }

  /** 该帧附近是否有"值得警告"的东西（事件递归溢出等） */
  warningOf(frameIndex: number): string | null {
    const fr = this.player.frame(frameIndex);
    if (!fr) return null;
    if (fr.t === "EVENT_OVERFLOW") return `Event recursion limit reached; one level was skipped here (${fr.total} total)`;
    return null;
  }
}
