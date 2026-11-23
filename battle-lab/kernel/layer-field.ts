// kernel/layer-field.ts — ★★★ 第 140 轮：**叠层场地**（KB 术语「花海」）
//
// 由来：彼岸花「赤团华」/「血之花海」的 8 条子句此前只在动词表里记了账（verb=花海, severity=WARN），
// 引擎里既没有这个计数器、也没有「每层每回合造成伤害」的执行点。这一轮把它接上。
//
// 判据全部来自 KB 原文与官方术语表（逐条留在 spec.evidence 里）：
//   · 官方术语 3446 花海：「彼岸花的特殊机制，**在花海中的敌方单位回合前受到伤害**」
//     ⇒ 伤害时机是**敌方自己的回合开始**（不是彼岸花的回合）；
//   · 「每层花海对其造成攻击39%伤害」 ⇒ 每层 39% 攻击，层数即倍率；
//   · 「自身生命比例100%、75%、50%、25%时，花海上限为3、4、5、6层」
//     ⇒ 上限 = 3 + 已越过的阈值数（用 ≤ 判，正好在 75% 时上限是 4）；
//   · 「回合开始时自动减少1层花海，最少不低于1层」 ⇒ **拥有者**回合开始 −1，下限 1；
//   · 「生命比例每降低25%，获得1层花海及『血之花海』的护盾」 ⇒ 每跨一档 +1 层（可同时给盾）；
//   · 「[tips_7]：创造3层花海，包围敌方全体」 ⇒ 先机：战斗开始 +3 层。
//
// ★★ 两处**原文没写死、必须如实标注**的推断（写进 spec.ambiguity，报告与测试都点得到）：
//   ① 「回合开始时自动减少1层」的主语：原文那一句以「自身」开头，所以按**拥有者自己的回合**实现；
//      另一种读法（每个单位的回合都减）会让层数掉得飞快，且与「花海中的敌方…在回合开始时」重复措辞矛盾。
//   ② 生命比例**回升**时上限会变小（上限跟着当前比例走）⇒ 层数被**夹到新上限**（不额外补偿）。
//
// ★ 计数存 `owner.notes`（与替友方拦死同一套：改同一个键、不是追加日志 —— 第 133 轮那次教训），
//   于是它天然进存档、进 stateHash、进快照恢复（g0/g2/g85 已经把那套路径压实过）。
import type { Battle } from "./battle.ts";
import type { Entity } from "./entity.ts";
import { DamageType } from "./types.ts";
import { dealDamage } from "./damage.ts";
import { GameMath } from "./gamemath.ts";

export interface LayerFieldSpec {
  /** KB 术语名（判据词） */
  term: string;
  /** 每层伤害 = 拥有者攻击 × 该比例 */
  perLayerRatio: number;
  /** 满血时的上限 */
  baseCap: number;
  /** 生命比例阈值（降序）；越过一档上限 +1、层数 +1 */
  capThresholds: number[];
  /** 层数下限（回合开始减层不会低于它） */
  minLayers: number;
  /** 拥有者回合开始减几层 */
  decayPerTurn: number;
  /** 先机层数（战斗开始时创造） */
  startLayers: number;
  /** 因跨档获得层数时是否同时给盾 */
  grantShield: boolean;
  /** 随层数一起给的那个盾（来自同一只式神的另一个技能） */
  shield?: { ratio: number; base: "maxHp" | "atk" | "lostHp" } | null;
  /**
   * ★ 跨技能引用的那个技能的 id（原文『[skill_288_03]』）。
   *   编译是**逐技能**的，解析不到另一个技能的护盾数值 ⇒ 这里只记 id，
   *   由装配期（compile/character.ts）按 id 在拥有者自己的技能表里取出护盾数值填进 shield。
   */
  shieldFrom?: string | null;
  evidence: Record<string, string>;
  ambiguity: string[];
}

const key = (spec: LayerFieldSpec, what: string) => "layerField:" + spec.term + ":" + what;

function noteNum(e: Entity, k: string): number | null {
  const hit = (e.notes ?? []).find((n: string) => n.startsWith(k + "="));
  return hit ? Number(hit.slice(k.length + 1)) : null;
}
function writeNote(e: Entity, k: string, v: number) {
  e.notes = (e.notes ?? []).filter((n: string) => !n.startsWith(k + "="));
  e.notes.push(k + "=" + v);
}

/** 生命比例落在哪一档：还没越过的阈值个数（满血 = 阈值全未越过 = thresholds.length） */
export function bandOf(hpRatio: number, thresholds: number[]): number {
  return thresholds.filter(t => hpRatio > t).length;
}

/** 当前生命比例下的层数上限：满血 baseCap，越过一档 +1 */
export function layerCap(hpRatio: number, spec: LayerFieldSpec): number {
  return spec.baseCap + (spec.capThresholds.length - bandOf(hpRatio, spec.capThresholds));
}

export function layerHpRatio(e: Entity): number {
  return e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 0;
}

/**
 * ★ 第 141 轮：**机制在场标记**。
 *   主动技能（血之花海「获得2层花海」）要不要给层，取决于**这套机制有没有被装上** ——
 *   被动运行时默认 OFF，那时不该留下一个「什么都不做的计数器」（它会进存档、进指纹，
 *   却没有任何行为，读起来像"机制在跑"）。
 */
export function layerFieldActive(owner: Entity, spec: LayerFieldSpec): boolean {
  return (owner.notes ?? []).some((n: string) => n === key(spec, "installed") + "=1");
}
function markInstalled(owner: Entity, spec: LayerFieldSpec) {
  if (!layerFieldActive(owner, spec)) owner.notes.push(key(spec, "installed") + "=1");
}

/** 读当前层数（没有记录 = 0） */
export function layersOf(owner: Entity, spec: LayerFieldSpec): number {
  return noteNum(owner, key(spec, "layers")) ?? 0;
}

/**
 * 写层数：夹到 [0, 上限] 并**重写同一个键**（不是追加日志）。
 * ★ 上限跟着**当前**生命比例走 ⇒ 这里同时处理「血量回升后层数被夹小」这一种情况。
 */
async function setLayers(battle: Battle, owner: Entity, spec: LayerFieldSpec, n: number, reason: string): Promise<number> {
  const cap = layerCap(layerHpRatio(owner), spec);
  const next = Math.max(0, Math.min(cap, GameMath.roundAt(n, "LAYER_COUNT")));
  const before = layersOf(owner, spec);
  if (next !== before) {
    writeNote(owner, key(spec, "layers"), next);
    battle.trace.push({
      t: "LAYER_FIELD_SET", owner: owner.id, term: spec.term, before, after: next, cap, reason,
      note: "层数变化（上限随生命比例：满血 " + spec.baseCap + "，越过一档 +1）",
    });
  }
  return next;
}

/** 加层（自动夹上限）。返回夹取后的层数。 */
export async function grantLayers(battle: Battle, owner: Entity, spec: LayerFieldSpec, n: number, reason: string): Promise<number> {
  if (n <= 0) return layersOf(owner, spec);
  const before = layersOf(owner, spec);
  const after = await setLayers(battle, owner, spec, before + n, reason);
  battle.trace.push({ t: "LAYER_FIELD_GRANT", owner: owner.id, term: spec.term, gained: after - before, before, after, reason });
  return after;
}

/** 随层数一起给的那个盾（原文：「获得1层花海及『血之花海』的护盾」） */
/**
 * ★★★ 第 144 轮：护盾**在用时**解析（不在装配时）。
 *   缘由：装配点拿到的 `owner.skills` 未必已经带上 IR（依赖装配顺序），
 *   于是 `spec.shield` 一直是 null ⇒ 跨档给盾静默不发生（g93 实测 SHIELD_APPLY = 0 条）。
 *   判据仍然是**跨技能引用**：原文『[skill_288_03]』按 id 在拥有者自己的技能表里取。
 */
function resolveShield(owner: Entity, spec: LayerFieldSpec): LayerFieldSpec["shield"] {
  if (spec.shield) return spec.shield;
  if (!spec.shieldFrom) return null;
  const ref = (owner.skills ?? []).find((s: any) => String(s?.ir?.id ?? s?.id ?? "") === String(spec.shieldFrom));
  const sh = ref?.ir?.shield?.[0];
  return sh ? { ratio: sh.ratio, base: sh.base } : null;
}

export async function applyLayerShield(battle: Battle, owner: Entity, spec: LayerFieldSpec, reason: string): Promise<number> {
  const sh = resolveShield(owner, spec);
  if (!sh) return 0;
  const value = sh.base === "atk" ? owner.prop("atk") * (sh.ratio / 100)
    : sh.base === "lostHp" ? Math.max(0, owner.maxHp - owner.hp) * (sh.ratio / 100)
    : owner.maxHp * (sh.ratio / 100);
  if (!(value > 0)) return 0;
  // ★ 不可驱散（原文「获得不可驱散的护盾」）；走与技能同一条 addShield 入口
  owner.addShield({ value, sourceId: owner.id, dispellable: false, tag: "layerField:" + spec.term });
  battle.trace.push({ t: "SHIELD_APPLY", src: owner.id, dst: owner.id, value: GameMath.display(value), base: sh.base, ratio: sh.ratio, skill: spec.term, reason });
  return value;
}

/**
 * 血量变化后同步档位：每跨过一档（向下）得 1 层，并（可选）同时给盾。
 * ★ 判据是**档位**而不是「每次掉血」：掉 10% 不掉层，掉过 25% 的那条线才掉 —— 与原文一致。
 */
export async function syncBands(battle: Battle, owner: Entity, spec: LayerFieldSpec, reason: string): Promise<number> {
  const band = bandOf(layerHpRatio(owner), spec.capThresholds);
  const prev = noteNum(owner, key(spec, "band"));
  if (prev === null) { writeNote(owner, key(spec, "band"), band); return 0; }
  if (band >= prev) { writeNote(owner, key(spec, "band"), band); await setLayers(battle, owner, spec, layersOf(owner, spec), reason + ":CLAMP"); return 0; }
  const gained = prev - band;
  writeNote(owner, key(spec, "band"), band);
  const after = await grantLayers(battle, owner, spec, gained, reason + ":BAND-" + prev + "->" + band);
  if (spec.grantShield) await applyLayerShield(battle, owner, spec, reason + ":BAND");
  return after;
}

/**
 * 装上一套叠层场地。幂等（同 id 的订阅者在表里就跳过）。
 * 返回装上的钩子数 —— 调用方据此记账（0 = 没装）。
 */
export function installLayerField(battle: Battle, owner: Entity, spec: LayerFieldSpec): number {
  const ids = [
    "layerField:" + spec.term + ":" + owner.id + ":start",
    "layerField:" + spec.term + ":" + owner.id + ":decay",
    "layerField:" + spec.term + ":" + owner.id + ":damage",
    "layerField:" + spec.term + ":" + owner.id + ":band",
  ];
  const has = (id: string) => battle.bus.hasHandler(id);
  if (ids.every(has)) return 0;
  markInstalled(owner, spec);
  let n = 0;
  if (!has(ids[0]) && spec.startLayers > 0) {
    battle.bus.register({
      id: ids[0], ownerId: owner.id, code: "BATTLE_START", range: "ALL", priority: 0, passive: true, source: "PASSIVE",
      fn: async () => {
        // ★ 先机：先把档位记下来再加层 —— 否则第一次 syncBands 会把先机层数当成跨档奖励再给一次
        writeNote(owner, key(spec, "band"), bandOf(layerHpRatio(owner), spec.capThresholds));
        await grantLayers(battle, owner, spec, spec.startLayers, "SENKI");
      },
    });
    n++;
  }
  if (!has(ids[1])) {
    battle.bus.register({
      id: ids[1], ownerId: owner.id, code: "TURN_START", range: "ALL", priority: 0, passive: true, source: "PASSIVE",
      fn: async (ctx: any) => {
        /**
         * ★★★ 第 143 轮：行动者要读 **ctx.actor**（总线在派发时放进上下文的那一个）。
         *   第一版读的是 ctx.input.actor —— BATTLE_START 那条钩子不看 ctx，所以"先机给 3 层"是绿的，
         *   而 TURN_START 的这条永远拿不到 actor ⇒ 直接 return（g93 实测 LAYER_FIELD_DECAY = 0 条）。
         *   ★ 两种形状都认，避免以后再被同一件事绊一次（拿不到就什么都不做，失败关闭）。
         */
        const actor: Entity | undefined = ctx?.actor ?? ctx?.input?.actor;
        if (!actor || actor.id !== owner.id) return;
        const before = layersOf(owner, spec);
        if (before > spec.minLayers) {
          await setLayers(battle, owner, spec, Math.max(spec.minLayers, before - spec.decayPerTurn), "OWN_TURN_START");
          battle.trace.push({ t: "LAYER_FIELD_DECAY", owner: owner.id, term: spec.term, before, after: layersOf(owner, spec), min: spec.minLayers });
        }
        await syncBands(battle, owner, spec, "OWN_TURN_START");
      },
    });
    n++;
  }
  if (!has(ids[2])) {
    battle.bus.register({
      id: ids[2], ownerId: owner.id, code: "TURN_START", range: "ALL", priority: 0, passive: true, source: "PASSIVE",
      fn: async (ctx: any) => {
        // ★ 同上：行动者读 ctx.actor（第 143 轮修）
        const actor: Entity | undefined = ctx?.actor ?? ctx?.input?.actor;
        if (!actor || actor.teamId === owner.teamId || !actor.alive) return;
        const layers = layersOf(owner, spec);
        if (layers <= 0 || !owner.alive) return;
        const base = owner.prop("atk") * spec.perLayerRatio * layers;
        const r = await dealDamage(battle, { source: owner, target: actor, base, rate: 1, type: DamageType.NORMAL, skillTag: spec.term });
        battle.trace.push({
          t: "LAYER_FIELD_DAMAGE", owner: owner.id, dst: actor.id, term: spec.term, layers,
          ratio: spec.perLayerRatio, applied: GameMath.display(r.applied),
          note: "每层花海在敌方回合开始时造成攻击N%伤害（官方术语 3446）",
        });
      },
    });
    n++;
  }
  if (!has(ids[3])) {
    battle.bus.register({
      id: ids[3], ownerId: owner.id, code: "AFTER_DAMAGE", range: "ALL", priority: 0, passive: true, source: "PASSIVE",
      fn: async (ctx: any) => {
        if (ctx?.input?.target?.id !== owner.id) return;
        await syncBands(battle, owner, spec, "AFTER_DAMAGE");
      },
    });
    n++;
  }
  return n;
}
