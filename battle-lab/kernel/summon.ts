// kernel/summon.ts — ★★★ 第 98 轮：**召唤物/放置单位**的数据层与规格声明
//
// 由来：`compile/unmodeled.ts` 里「召唤」是**最大的一桶**（26 处命中），而 capability 的 SUMMON 一直是
// 「容器齐、序列化齐、恢复齐、寻敌齐 —— **没有任何地方往容器里放单位**」；
// 注册表 kernel/effects.ts 里那条 `{ key: "Summon", producer: "addSummon" }` 写的正是**缺的那一行**。
//
// ★★ 而"知识库里没有召唤物数据"这句话**只对了一半**：`shikigami.full.json` 里确实一个召唤物都没有，
//   但 **`tips.json` 就是它们的定义处** —— 技能原文用 `[tips_N]` 引用，那里写着名字、生命基准、
//   免疫项、胜利判定、复活方式：
//     · tips_3896 雷冢（须佐之男「神之领域」）：「无法行动，不触发御魂和被动，生命为须佐之男初始攻击150%。
//       雷冢被击败后，被镇压的式神以1点生命复活。若敌方只存在雷冢，视为战斗胜利。同一式神该效果只可生效1次。」
//     · tips_6071 余烬（百羽凤凰火「未熄羽」）：「继承…在行动条的位置和初始属性，免疫伤害、减益、控制效果和放逐，
//       提升100点速度，若场上只有余烬视为战斗失败；到达行动条终点后复活…」
//     · tips_5991 蝙蝠（蚀月吸血姬）：「攻击敌方附加对应层数喰噬，累积12只进入…姿态」（伤害写在技能里）
//     · tips_5723 烟之鬼（遥念烟烟罗）：「无法被驱散，无法动作，式神被动技能失效…消失时对敌方全体造成攻击49%的伤害」
//   ⇒ 这一轮把**能从原文无歧义读出的那些字段**变成声明，并在内核里做出唯一的产生者 `Battle.addSummon`。
import { IMMUNE_TEXT_RULES, StatusBook } from "./status.ts";
import type { ImmuneKind, StatusDef } from "./status.ts";
import { EV, StatusCategory, DamageType } from "./types.ts";
import { healTarget, dealDamage } from "./damage.ts";
import type { Entity } from "./entity.ts";
// ★ 第 191 轮：取整统一走 GameMath（见 tools/lint-rounding.ts）
import { GameMath } from "./gamemath.ts";

/**
 * ★★★ 第 101 轮：**自身形态类放置单位**（姿态 / 化身）的入场与回归。
 *
 * 与 addSummon 的分工：addSummon 只管"造出那个单位"；这里管"本体怎么办"——
 *   · 入场：本体**离场**（挂一个 preventsAction + locksTimeline 的状态 + setTargetable(false) + transformed=true）；
 *   · 回归：蛇神阵亡（或按原文到达行动条终点）时本体回来（撤状态、恢复可选中、revive 1 点生命）。
 * ★ `transformed` 与 `setTargetable` 此前都是"有读者、没有生产写入方"（第 56/94 轮记在案），
 *   这一轮它们**第一次**在生产路径上被真的写进去 —— 而且语义有 KB 出处，不是为了让字段好看。
 */
export const FORM_OFF_FIELD_STATUS = "form_off_field";

/** 本体离场用的状态定义（懒注册进 StatusBook：恢复存档时要靠它反查） */
export function formOffFieldDef(evidence: string): StatusDef {
  const existing = StatusBook.get(FORM_OFF_FIELD_STATUS);
  if (existing) return existing;
  const def: StatusDef = {
    id: FORM_OFF_FIELD_STATUS, name: "形态离场", category: StatusCategory.BUFF_MARK,
    dispellable: false, removable: false,
    preventsAction: true, preventsSkill: true, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: true,
    durationPolicy: "GLOBAL", desc: evidence,
  };
  StatusBook.set(def.id, def);
  return def;
}

export interface FormSpec {
  tipsId: string; name: string;
  /** ★ 第 103 轮加 ON_KILL（击败非召唤物敌方目标时） */
  trigger: "ON_CAST" | "ON_LETHAL" | "ON_KILL";
  /** ★ 第 103 轮加 ENEMY（镇压式：放到**被镇压者那一队**） */
  placement: "SELF" | "ENEMY";
  /** ★ 第 103 轮加 NONE：不做本体/形态的进出场，就是一个普通放置单位（龙胆蓝璃） */
  returnOn: "TIMELINE_END" | "SUMMON_DEATH" | "NONE";
  returnOnSource: string;
  /** ★ 镇压式：目标离场、由它顶替；被击败时目标以 1 点生命复活（tips_3896） */
  seal?: boolean;
  /** ★ 放在目标的行动条位置（「在其行动条处召唤」） */
  atTargetPos?: boolean;
  /**
   * ★★★ 第 111 轮：**在场光环**（「[tips_N]在场时，提升除召唤物外友方目标20%防御」）。
   *   只收**静态属性修正**（提升/降低 <范围> N%|N点 <八维之一>）—— 它们可以准确地实现成
   *   Modifier（带来源、可按来源整批回收）；普攻加成、行动条、鬼火、层数这些**留在原文里**继续报未建模。
   */
  auras?: PresenceAura[];
  /**
   * ★★★ 第 111 轮：**收回**（「回合开始时，收回[tips_5523]并移除[buff_5522_1]」）。
   *   这只是"谁在什么时候把它收回去"，与「被打死」是两条不同的离场路径。
   */
  recall?: { at: "OWNER_TURN_START"; removeStatuses?: string[]; evidence: string };
  /**
   * ★★★ 第 110 轮：**两种放置的区分**（此前只有一种，于是"召唤"被当成"变身"）。
   *   · `FORM`（默认，既有 6 条都是这一种）：「进入/化身[tips_N]姿态」⇒ **本体离场**，形态上场；
   *   · `SUMMON`：「召唤[tips_N]」⇒ 召唤物上场，**本体留在场上**（原文另有旁证：
   *     千姬的「若海原贝戟在场，额外附加…」、猫川的「[tips_5691]在场时，猫川的普攻系数翻倍」、
   *     慧明灯的「回合开始时，**收回**[tips_5523]」—— 三处都说明本体还在打）。
   *   ★ 默认值 FILTER 掉的是误伤：只有显式写 SUMMON 的才是召唤物，既有形态行为逐位不变。
   */
  kind?: "FORM" | "SUMMON";
  spec: SummonSpec;
}

/** 某个单位身上所有"放置单位"声明（来自它的技能 IR） */
export function skillPlacements(e: Entity): FormSpec[] {
  const out: FormSpec[] = [];
  for (const sk of (e.skills ?? [])) {
    const fs = (sk as any)?.ir?.forms;
    if (Array.isArray(fs)) out.push(...fs);
  }
  return out;
}

/**
 * ★★★ 第 104 轮：**链接**（standalone 放置的拥有者）。
 *   与 form:owner= 分开记：那个表示"我是谁的形态/我压着谁"（有进出场语义），
 *   这个表示"我是谁召唤出来的"（用来做两条细则：重复召唤叠加、在场时拥有者免伤）。
 */
export function linkOwnerOf(e: Entity): number | null {
  for (const n of e.notes) {
    const m = /^link:owner=([0-9]+)$/.exec(n);
    if (m) return Number(m[1]);
  }
  return null;
}

/** 这个单位是不是"镇压"用的放置单位？是的话返回被镇压者的 id */
export function sealedVictimOf(e: Entity): number | null {
  for (const n of e.notes) {
    const m = /^seal:victim=([0-9]+)$/.exec(n);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * ★★★ 第 103 轮：**镇压式放置**（KB：须佐之男「神之领域」→ 雷冢）。
 *
 * 与"自身形态"（enterForm）的三处差别：
 *   ① 放置单位进的是**被镇压者那一队**（雷冢站在敌方队伍里）；
 *   ② 本体不是"离场后自己回来"，而是**被压着**：只有镇压单位被击败时才以 1 点生命复活（tips_3896 原文）；
 *   ③ 同一式神该效果**只生效 1 次**（tips_3896 原文）—— 用 killer.notes 里的标记封顶（notes 进存档）。
 */
export function sealEntity(battle: any, killer: Entity, victim: Entity, form: FormSpec):
  { ok: boolean; reason?: string; summon?: Entity } {
  if (form.placement !== "ENEMY") return { ok: false, reason: "NOT_A_SEAL" };
  const summon = battle.addSummon(killer, form.spec, {
    teamId: victim.teamId,
    seal: { victimId: victim.id },
    form: { ownerId: victim.id, tipsId: form.tipsId, returnOn: form.returnOn },
  });
  if (!summon) return { ok: false, reason: "SUMMON_REJECTED" };
  victim.setTargetable(false, "SEALED:" + form.tipsId);
  victim.addStatus(formOffFieldDef("被镇压：由「" + form.name + "」顶替（" + form.returnOnSource + " 说明了解除方式）"), victim.id, 1, 99999);
  victim.notes.push("sealed:by=" + summon.id);
  killer.notes.push("seal-used:" + victim.id);   // 「同一式神该效果只可生效1次」
  battle?.trace?.push?.({
    t: "SEAL", killer: killer.id, victim: victim.id, summon: summon.id, tipsId: form.tipsId, name: form.name,
    hp: summon.maxHp, note: "被镇压者离场、由放置单位顶替；它被击败时被镇压者以 1 点生命复活",
  });
  return { ok: true, summon };
}

/**
 * ★★★ 第 103 轮：**击杀式放置**（KB：雪御前「龙胆·绽」→ 龙胆蓝璃）。
 * 「击败非召唤物敌方目标时，在其行动条处召唤[龙胆蓝璃]」⇒ 放在**击杀者那一队**、位置 = 阵亡者原来的位置。
 * ★ 这一轮**不执行**的部分写在这里，不藏着：tips_5911 还有两条规则没做 ——
 *   「被重复召唤时，生命上限提升初始攻击的39%（至多3次）」与「龙胆蓝璃在场时，雪御前免疫受到的伤害」，
 *   两者都记进 trace 的 note 里，并由 g63 断言"它们确实没被实现"。
 */
export function placeOnKill(battle: any, killer: Entity, victim: Entity, form: FormSpec, pos: number): Entity | null {
  /**
   * ★★★ 第 104 轮：**重复召唤的两条细则**（tips_5911 原文）：
   *   · 「被重复召唤时，生命上限提升初始攻击的39%（至多3次），并恢复全部生命」
   *     ⇒ 同一拥有者已有同一个放置单位时**不再造第二个**，而是把它加强；
   *   · 「[放置单位]在场时，[拥有者]免疫受到的伤害」
   *     ⇒ 建立链接：放置单位活着的时候给拥有者挂一个 DAMAGE 免疫状态（复用第 94 轮的免疫机制）。
   *   ★ 这两条在上一轮是写在事件里的"未实现"，这一轮真的做了。
   */
  const existing = battle.allEntities().find((e: Entity) => linkOwnerOf(e) === killer.id && e.notes.includes("summon:" + form.tipsId) && e.alive);
  if (existing) {
    const spec = form.spec;
    const stacksNote = existing.notes.find((n: string) => n.startsWith("lace:stacks="));
    const stacks = stacksNote ? Number(stacksNote.split("=")[1]) : 0;
    const MAX = 3;
    if (stacks < MAX) {
      const gain = Math.max(1, GameMath.roundAt(killer.base.atk * 0.39, "SUMMON_STAT_GAIN"));
      existing.maxHp += gain;
      existing.hp = existing.maxHp;                      // 「并恢复全部生命」
      existing.notes.push("lace:stacks=" + (stacks + 1));
      battle?.trace?.push?.({
        t: "PLACE_STACK", killer: killer.id, summon: existing.id, tipsId: form.tipsId, name: form.name,
        stacks: stacks + 1, gain, maxHp: existing.maxHp, source: "tips_5911「被重复召唤时，生命上限提升初始攻击的39%（至多3次），并恢复全部生命」",
      });
    } else {
      existing.hp = existing.maxHp;                      // 叠加上限到了：只回满血（这一条是**默认读法**，如实记下来）
      battle?.trace?.push?.({
        t: "PLACE_STACK_CAPPED", killer: killer.id, summon: existing.id, stacks, maxHp: existing.maxHp,
        note: "叠加上限 3 次已到；原文只写了上限、没写第 4 次怎么办 ⇒ 按「只回满生命」处理（默认读法）",
      });
    }
    return existing;
  }
  const summon = battle.addSummon(killer, form.spec, { pos: form.atTargetPos ? pos : 0 });
  if (!summon) {
    battle?.trace?.push?.({ t: "PLACE_REJECTED", killer: killer.id, victim: victim.id, tipsId: form.tipsId, reason: "SUMMON_REJECTED" });
    return null;
  }
  summon.notes.push("link:owner=" + killer.id);
  // 「[放置单位]在场时，[拥有者]免疫受到的伤害」（tips_5911）——挂成真状态，放置单位阵亡时撤掉
  const aura = linkAuraDef(summon.name);
  killer.addStatus(aura, summon.id, 1, 99999);
  battle?.trace?.push?.({
    t: "PLACE_ON_KILL", killer: killer.id, victim: victim.id, summon: summon.id, tipsId: form.tipsId, name: form.name,
    pos: form.atTargetPos ? pos : 0, aura: aura.id,
    source: "tips_5911：击败非召唤物敌方目标时，在其行动条处召唤；在场时拥有者免疫受到的伤害",
  });
  return summon;
}

/** 「在场时拥有者免疫受到的伤害」挂的那个状态（懒注册进 StatusBook，恢复存档时要能反查） */
export const LINK_AURA_STATUS = "link_aura_immune_damage";
export function linkAuraDef(name: string): StatusDef {
  const existing = StatusBook.get(LINK_AURA_STATUS);
  if (existing) return existing;
  const def: StatusDef = {
    id: LINK_AURA_STATUS, name: name + "·在场免伤", category: StatusCategory.BUFF_MARK,
    dispellable: false, removable: false,
    preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false,
    durationPolicy: "GLOBAL", immuneTo: ["DAMAGE"],
    desc: "放置单位在场时，拥有者免疫受到的伤害（tips_5911 原文）",
  };
  StatusBook.set(def.id, def);
  return def;
}

/** 放置单位离场时撤掉它给的链接光环（由死亡路径调用） */
export function clearLinkAura(battle: any, summon: Entity): number {
  const ownerId = linkOwnerOf(summon);
  if (ownerId === null) return 0;
  const owner: Entity | undefined = battle.allEntities().find((e: Entity) => e.id === ownerId);
  if (!owner) return 0;
  let n = 0;
  for (const st of [...owner.statuses]) {
    if (st.def.id !== LINK_AURA_STATUS || st.sourceId !== summon.id) continue;
    if (owner.expireStatus(st)) n++;
  }
  if (n) battle?.trace?.push?.({ t: "LINK_END", owner: owner.id, summon: summon.id, count: n, note: "放置单位离场 ⇒ 撤掉「在场时」给的光环" });
  return n;
}

/**
 * ★★★ 第 111 轮：**在场光环** —— 「[tips_N]在场时，提升除召唤物外友方目标20%防御」这类效果。
 *
 * 设计上只用**已有的 Modifier 机制**（a1-4 §6/§7）：带来源（`aura:<tipsId>:<i>`）、可按来源整批回收、
 * 进 Entity.effects ⇒ **自动进档、进状态指纹**，不需要给 BattleState 加任何新字段。
 * 来源前缀让"谁给的光环"一眼可见：`modifierSources()` 里会出现 `aura:5523:0`。
 */
/** 八维词 → 属性键（不重抄：以现有 prop 名为准） */
const AURA_ATTR: Array<[RegExp, string]> = [
  [/暴击伤害/, "crid"], [/暴击/, "cri"], [/攻击/, "atk"], [/防御/, "def"],
  [/速度/, "spd"], [/生命/, "hp"], [/效果命中/, "efh"], [/效果抵抗/, "efr"],
  /** ★ 第 115 轮：场地光环里的「提升N%伤害」「获得N%减伤」——引擎本来就有这两个 prop */
  [/伤害/, "dmgDealtB"], [/减伤/, "dmgTakenD"],
];
/** 一句话里出现这些 ⇒ 它不是"静态属性修正"，本轮的实现接不住（留在 unmodeled 里） */
const AURA_UNMODELED_RE = /普攻|行动条|鬼火|概率|\[buff_|层/;

/**
 * ★★★ 第 111 轮：**「在场时」光环的唯一解析入口**（技能原文与 tips 原文共用一份实现）。
 *
 * 只收**静态属性修正**：「(提升|降低) [范围] N%|N点 <八维>」—— 它们能准确落成 Modifier。
 * 收不下的（普攻加成 / 行动条 / 鬼火 / 概率 / 层数）**原样返回**在 `unmodeled` 里，
 * 由调用方逐条记账（`在场光环` 这个 verb）—— 不许静默。
 *
 * @param defaultScope 没写范围时按哪一方算：技能原文里"友方"是默认，召唤物自己的 tips 里"拥有者"是默认。
 */
export function parsePresenceAuras(text: string, defaultScope: PresenceAura["scope"], trigger: RegExp = /在场时/): { auras: PresenceAura[]; unmodeled: string[] } {
  const auras: PresenceAura[] = [];
  const unmodeled: string[] = [];
  for (const clause of String(text ?? "").split(/[。；]/)) {
    if (!trigger.test(clause)) continue;
    let hit = false;
    /**
     * ★★ 语序**两种都有**，必须各写一条（第 111 轮实测）：
     *   A 数量在前：「提升除召唤物外友方目标**20%防御**」；
     *   B 属性在前：「降低慧明灯**的速度40点**」。
     *   第一版只写了 A，于是明识灯 tips 里那条光环**解析不出来**（而它恰好是本轮唯一的 B 实例）。
     */
    const SCOPE_WORD = "((?:除召唤物外友方(?:目标)?|友方全体|友方单位|全体友方|敌方全体|敌方目标|敌方|自身)?)";
    const ATTR = "(攻击力|攻击|防御力|防御|速度|暴击伤害|暴击|生命值|生命|效果命中|效果抵抗)";
    const reA = new RegExp("(提升|降低|增加|减少)" + SCOPE_WORD + "[^0-9]{0,10}?(\\d+(?:\\.\\d+)?)(%|点)" + ATTR, "g");
    const reB = new RegExp("(提升|降低|增加|减少)" + SCOPE_WORD + "[^0-9]{0,10}?" + ATTR + "\\s*(\\d+(?:\\.\\d+)?)(%|点)", "g");
    const seen = new Set<string>();
    const take = (verb: string, word: string, num: string, unit: string, attrWord: string) => {
      const prop = AURA_ATTR.find(([r]) => r.test(attrWord))?.[1];
      if (!prop) return;
      const scope: PresenceAura["scope"] = /除召唤物外友方/.test(word) ? "ALLY_NON_SUMMON"
        : /敌方/.test(word) ? "ENEMY"
        : /友方/.test(word) ? "ALLY" : defaultScope;
      const sign = /提升|增加/.test(verb) ? 1 : -1;
      const mode: PresenceAura["mode"] = unit === "%" ? "ADD_RATE" : "FIXED";
      const value = sign * Number(num) / (unit === "%" ? 100 : 1);
      const key = scope + "|" + prop + "|" + mode + "|" + value;
      if (seen.has(key)) return;
      seen.add(key);
      auras.push({ scope, prop, mode, value, evidence: clause });
      hit = true;
    };
    for (const m of clause.matchAll(reA)) take(m[1], m[2] ?? "", m[3], m[4], m[5]);
    /**
     * ★★★ 第 115 轮：**第三种语序** —— 范围写在动词**之前**（场地类几乎都是这个写法）：
     *   「使友方全体提升15%防御」「此期间，友方全体提升20点速度」「结界中敌方效果抵抗降低30%」。
     *   前两种（数量在前 / 属性在前）都要求范围跟在动词后面，于是这一类的范围会被
     *   当成默认范围 —— 而「敌方效果抵抗降低30%」按友方施加就是**算错**，不是少算。
     */
    const reC = new RegExp(SCOPE_WORD + "[^0-9]{0,8}?(提升|降低|增加|减少)[^0-9]{0,10}?(\d+(?:\.\d+)?)(%|点)" + ATTR, "g");
    for (const m of clause.matchAll(reC)) take(m[2], m[1] ?? "", m[3], m[4], m[5]);
    for (const m of clause.matchAll(reB)) take(m[1], m[2] ?? "", m[4], m[5], m[3]);
    /**
     * ★★★ 第 111 轮：**一句话可以既"部分实现"又"部分没做"** —— 两者都要说出来。
     *   实测：慧明灯那句是「提升除召唤物外友方目标20%防御，**并使携带3层[buff_5522_1]的敌方陷入[tips_115]**」，
     *   前半句能准确落成 Modifier，后半句（点名状态 + 层数条件）没有行为代码。
     *   第一版只要看到「层」就整句丢弃 ⇒ 已经把前半句做出来的事实反而看不见了。
     */
    if (!hit || AURA_UNMODELED_RE.test(clause)) unmodeled.push(clause);
  }
  return { auras, unmodeled };
}

export interface PresenceAura {
  /** 受影响的一方：OWNER=拥有者自己；ALLY_NON_SUMMON=除召唤物外的友方；ALLY=全部友方（含召唤物） */
  scope: "OWNER" | "ALLY_NON_SUMMON" | "ALLY" | "ENEMY";
  prop: string;
  mode: "FIXED" | "ADD_RATE";
  /** ★ 带符号：提升为正、降低为负（「降低慧明灯的速度40点」⇒ -40） */
  value: number;
  evidence: string;
}

/** 光环来源前缀（清除时按它整批回收） */
export function auraSource(tipsId: string, i: number): string { return "aura:" + tipsId + ":" + i; }

/** 某个单位算不算"召唤物"（拿 caps 判，不重抄一份类型表） */
function isSummonUnit(e: Entity): boolean { return !!(e as any).caps?.occupiesSummonSlot; }

/**
 * 施加在场光环。返回施加了几条（0 表示这条召唤物没有静态光环）。
 * ★ 只对**活着**的同队单位生效；召唤物自己（scope=ALLY_NON_SUMMON）按原文排除。
 */
export function applyPresenceAuras(battle: any, owner: Entity, auras: PresenceAura[] | undefined, tipsId: string): number {
  if (!auras?.length) return 0;
  const team = battle.teams[owner.teamId];
  /**
   * ★★ 第 115 轮实测踩到的坑：`owner` 本来也在 `team.members` 里 —— 直接拼数组会让**拥有者被施加两次**
   *   （实测：辉夜姬的幻境只该给友方 +15% 防御，拥有者却拿了 +30%，而且那个差异**不会报错**）。
   */
  const pool: Entity[] = [...new Set([owner, ...(team?.members ?? []), ...(team?.summons ?? [])])];
  let n = 0;
  for (let i = 0; i < auras.length; i++) {
    const au = auras[i];
    const foePool: Entity[] = au.scope === "ENEMY" ? (battle.teams[1 - owner.teamId]?.members ?? []).concat(battle.teams[1 - owner.teamId]?.summons ?? []) : [];
    const targets = au.scope === "OWNER" ? [owner]
      : au.scope === "ENEMY" ? foePool
      : au.scope === "ALLY_NON_SUMMON" ? pool.filter(e => !isSummonUnit(e))
      : pool;
    for (const t of targets) {
      if (!t || !t.alive) continue;
      t.addModifier({ prop: au.prop, value: au.value, mode: au.mode, source: auraSource(tipsId, i) });
      n++;
    }
  }
  if (n) battle?.trace?.push?.({ t: "AURA_APPLY", tipsId, owner: owner.id, count: n, auras: auras.map(a => a.scope + ":" + a.prop + (a.mode === "ADD_RATE" ? "×" : "±") + a.value) });
  return n;
}

/** 光环撤离：按来源前缀整批回收（召唤物阵亡 / 被收回 / 被移除时都要走这里） */
export function clearPresenceAuras(battle: any, ownerOrSummon: Entity, tipsId: string, reason: string): number {
  const team = battle?.teams?.[ownerOrSummon.teamId];
  const pool: Entity[] = [ownerOrSummon, ...(team?.members ?? []), ...(team?.summons ?? [])];
  let n = 0;
  for (const e of pool) {
    if (!e) continue;
    const removed = e.removeModifiersBySource("aura:" + tipsId + ":");
    n += removed;
  }
  if (n) battle?.trace?.push?.({ t: "AURA_END", tipsId, from: ownerOrSummon.id, count: n, reason });
  return n;
}

/**
 * ★★★ 第 111 轮：**移除一个放置单位**（被收回 / 被移除，不是被打死）。
 *   · 从 Team.summons 摘掉、撤出行动条、注销它的处理器；
 *   · 撤掉「在场时」的光环（link 光环 + 在场光环两条都要走）；
 *   · ★ 不走 resolveLethal：那不是死亡，不该触发 KILLED / 阵亡被动 / 击杀式放置。
 */
/** 从 notes 里读一个数值标记（notes 是**存档字段** ⇒ 恢复后钩子照样装得上） */
export function noteNum(e: Entity, prefix: string): number | null {
  const hit = (e.notes ?? []).find((x: string) => x.startsWith(prefix));
  if (!hit) return null;
  const v = Number(hit.slice(prefix.length));
  return Number.isFinite(v) ? v : null;
}

/**
 * ★★★ 第 113 轮：**反应式光环的钩子**（「在场时为友方单位恢复受到伤害30%的生命值」）。
 *
 * 判据来自 notes（`summon:reactive-heal=<ratio>`）—— notes 是**存档字段**，所以
 *   · 新建时由 addSummon 装上；
 *   · **恢复后**由 restoreBattle 重装（否则续跑的战斗里这条光环会静默消失）。
 * 这正是「handler 不在档里」的通用风险：钩子必须在两条路径上都被装上。
 */
export function installSummonHooks(battle: any, summon: Entity): number {
  const ratio = noteNum(summon, "summon:reactive-heal=");
  if (ratio === null || !(ratio > 0)) return 0;
  /**
   * ★★ 第 133 轮：**幂等**（同 id 已在表里就跳过）。
   *   它有两个调用点：`addSummon`（新建时）与 `restoreBattle`（恢复时）。
   *   两边都可能被"再调一次"（例如以后把召唤物钩子也收进统一的订阅安装点），
   *   而 bus.register 不去重 —— 重复注册会让反应式回血**治两次**，且不会报错。
   */
  const id = "summon:" + summon.id + ":reactive-heal";
  if (battle.bus.handlers.some((h: any) => h.id === id)) return 0;
  battle.bus.register({
    id, ownerId: summon.id, code: "AFTER_DAMAGE",
    range: "ALL", priority: 0, passive: true, source: "SUMMON",
    fn: async (ctx: any) => {
      /** 只对**同队**挨打生效（原文「为友方单位」；按字面包含召唤物自己 —— 原文没写「除召唤物外」） */
      const t = ctx?.input?.target;
      if (!t || t.teamId !== summon.teamId) return;
      if (!summon.alive) return;
      const applied = Number(ctx?.result?.applied ?? 0);
      if (!(applied > 0) || !t.alive) return;
      const healed = await healTarget(battle, summon, t, applied * ratio, { recover: true });
      battle.trace.push({ t: "SUMMON_REACTIVE_HEAL", summon: summon.id, dst: t.id, ratio, fromDamage: applied, healed, note: "在场时为友方单位恢复受到伤害的N%（走 RECOVER 通道，与原文的「恢复」一致）" });
    },
  });
  return 1;
}

export async function removeSummon(battle: any, summon: Entity, reason: string): Promise<boolean> {
  const team = battle?.teams?.[summon.teamId];
  if (!team) return false;
  const i = (team.summons ?? []).indexOf(summon);
  if (i < 0) return false;
  team.summons.splice(i, 1);
  battle?.timeline?.remove?.(summon.id);
  battle?.bus?.unregisterOwner?.(summon.id);
  const link = clearLinkAura(battle, summon);
  /**
   * ★★ 第 111 轮实测踩到的坑：notes 里第一条 `summon:` 不一定是 tipsId ——
   *   addSummon 会先推 `summon:stats-UNDECLARED:atk`，于是按前缀取会把 tipsId 取成那个字符串，
   *   光环一棵都撤不掉（而且不报错）。判据收紧成**纯数字**的那一条。
   */
  const tipsId = String((summon.notes ?? []).find((x: string) => /^summon:[0-9]+$/.test(x)) ?? "summon:").slice("summon:".length);
  const auras = clearPresenceAuras(battle, summon, tipsId, reason);
  summon.alive = false;
  summon.notes.push("summon:removed:" + reason);
  battle?.trace?.push?.({ t: "SUMMON_REMOVE", summon: summon.id, name: summon.name, tipsId, reason, linkAuras: link, presenceAuras: auras });
  /**
   * ★★★ 第 113 轮：**移除代价**（「被移除时返还2点鬼火」/「被移除时恢复…生命上限14%的生命」/
   *   「消失时，对敌方全体造成攻击49%的伤害」）。
   *   ★ 只在**移除路径**上执行，不在阵亡路径上 —— KB 自己区分了这两件事（雷冢写「被击败后」）。
   *   数值来自 notes（存档字段）⇒ 恢复后重装钩子/重跑代价都读得到同一份事实。
   */
  await runRemovalPayoff(battle, summon, reason);
  return true;
}

/** 移除代价的执行体（单独一段：便于测试直接量它，也便于以后加新形状） */
export async function runRemovalPayoff(battle: any, summon: Entity, reason: string): Promise<number> {
  const team = battle?.teams?.[summon.teamId];
  const ownerId = noteNum(summon, "summon:owner=");
  const owner: Entity | undefined = ownerId === null ? undefined : battle.allEntities().find((e: Entity) => e.id === ownerId);
  let n = 0;
  const orbs = noteNum(summon, "summon:on-remove-orbs=");
  if (orbs && team) {
    const g = team.orbs.gain(orbs);
    battle.trace.push({ t: "SUMMON_PAYOFF", summon: summon.id, kind: "ORBS", requested: orbs, gained: g.gained, overflow: g.overflow, reason });
    n++;
  }
  const healR = noteNum(summon, "summon:on-remove-heal-maxhp=");
  if (healR && team) {
    for (const a of [...(team.members ?? []), ...(team.summons ?? [])]) {
      if (!a.alive || a.id === summon.id) continue;
      const healed = await healTarget(battle, owner ?? summon, a, a.maxHp * healR, { recover: true });
      if (healed > 0) n++;
    }
    battle.trace.push({ t: "SUMMON_PAYOFF", summon: summon.id, kind: "HEAL", ratio: healR, reason });
  }
  const dmgR = noteNum(summon, "summon:on-remove-damage-atk=");
  if (dmgR) {
    /** ★ 伤害基准取**拥有者**攻击（召唤物自己的 atk 是 0，用它等于打 0 伤害 —— 一个不报错的错） */
    const base = owner ? owner.prop("atk") : 0;
    if (base > 0) {
      for (const foe of battle.enemiesOf(summon.teamId)) {
        if (!foe.alive) continue;
        await dealDamage(battle, { source: owner ?? summon, target: foe, base, rate: dmgR, type: DamageType.NORMAL, skillTag: "SUMMON_PAYOFF" });
      }
      battle.trace.push({ t: "SUMMON_PAYOFF", summon: summon.id, kind: "DAMAGE", ratio: dmgR, basis: "OWNER_ATK", reason });
      n++;
    } else {
      battle.trace.push({ t: "SUMMON_PAYOFF_SKIPPED", summon: summon.id, kind: "DAMAGE", reason, why: "拿不到拥有者攻击" });
    }
  }
  return n;
}



/**
 * 本体进入形态：造出形态单位 + 本体离场。
 * 返回 null 时一定带 reason（召唤位满 / 规格解析不出来 / 回归时机这一轮不支持）。
 */
export function enterForm(battle: any, owner: Entity, form: FormSpec, opts: { hasSkills?: boolean; pos?: number } = {}):
  { ok: boolean; reason?: string; summon?: Entity } {
  /**
   * ★★★ 第 110 轮：**召唤物（kind=SUMMON）与形态（kind=FORM）在这一行分岔**。
   *
   * 分岔点必须是这里：下面那段"本体离场"（transformed / setTargetable(false) / form_off_field 状态）
   * 只对**姿态/化身**成立。千姬、慧明灯、猫川的召唤物上场时本体还在打 —— 原文有旁证（见 FormSpec.kind 的注）。
   *
   * ★ 而且 SUMMON **不能**把 `form` 传给 addSummon：那会让 formOwnerOf(召唤物) 不为 null，
   *   于是它阵亡时 `resolveLethal` 会去"把本体放回场上"（本体压根没离场）—— 一个不报错的错。
   */
  if (form.kind === "SUMMON") {
    const s = battle.addSummon(owner, form.spec, { hasSkills: false });
    if (!s) return { ok: false, reason: "SUMMON_REJECTED" };
    /**
     * ★★★ 第 111 轮：**光环跟着一起上场**。两处来源都要施加：
     *   · 技能原文里的「[tips_N]在场时，提升除召唤物外友方目标20%防御」（form.auras）；
     *   · 召唤物自己 tips 里的「在场时，降低慧明灯的速度40点」（spec.auras）。
     *   ★ 来源带 tipsId ⇒ 撤离时按前缀整批回收，不会漏也不会误伤别人的 modifier。
     */
    applyPresenceAuras(battle, owner, [...(form.auras ?? []), ...(form.spec.auras ?? [])], form.tipsId);
    battle?.trace?.push?.({
      t: "SUMMON_ENTER", owner: owner.id, summon: s.id, tipsId: form.tipsId, name: form.name,
      trigger: form.trigger, placement: form.placement, returnOn: form.returnOn,
      note: "召唤物（本体留在场上）",
    });
    return { ok: true, summon: s };
  }
  /**
   * ★★ 回归时机：第 102 轮起**两种都支持**。
   *   · SUMMON_DEATH：形态阵亡 ⇒ 本体回来（蛇神）；
   *   · TIMELINE_END：形态**到达行动条终点**（= 轮到它行动）⇒ 本体回来（余烬）。
   *     它需要在回合入口有一个钩子（kernel/battle.ts 的 runTurnInner 顶部），
   *     而"没有技能表的单位也进行动条"是它的前提（第 102 轮放开）。
   *   仍然拒绝**认不出来**的取值：那是解析器将来加了新档而运行时没跟上，必须报出来而不是猜。
   */
  if (form.placement !== "SELF") {
    battle?.trace?.push?.({ t: "FORM_SKIPPED", owner: owner.id, tipsId: form.tipsId, name: form.name, reason: "PLACEMENT_NOT_SELF", placement: form.placement });
    return { ok: false, reason: "PLACEMENT_NOT_SELF" };
  }
  if (form.returnOn === "NONE") {
    // 龙胆蓝璃这类：就是一个普通放置单位，没有本体进出场
    const s = battle.addSummon(owner, form.spec, { pos: form.atTargetPos ? (opts as any).pos ?? 0 : 0 });
    if (s) battle?.trace?.push?.({ t: "PLACE_STANDALONE", owner: owner.id, summon: s.id, tipsId: form.tipsId, name: form.name });
    return s ? { ok: true, summon: s } : { ok: false, reason: "SUMMON_REJECTED" };
  }
  if (form.returnOn !== "SUMMON_DEATH" && form.returnOn !== "TIMELINE_END") {
    battle?.trace?.push?.({ t: "FORM_SKIPPED", owner: owner.id, tipsId: form.tipsId, name: form.name, reason: "RETURN_ON_UNSUPPORTED", returnOn: form.returnOn });
    return { ok: false, reason: "RETURN_ON_UNSUPPORTED" };
  }
  /**
   * ★★★ 第 102 轮：**把形态自己的技能挂上去**（数据来自 SkillIR.formSkillOf ← 「[tips_N]姿态下可施放」）。
   *   这是第 98 轮声明的那条空缺（"放置单位用什么技能打人"）的第一块：
   *   实测全库只有 1 处（蛇神 ← 审判仪式）。挂上去之后形态不再是"什么都没有的单位"。
   */
  const formSkills = (owner.skills ?? []).filter((sk: any) => sk?.ir?.formSkillOf === form.tipsId);
  for (const sk of formSkills) {
    battle?.trace?.push?.({ t: "FORM_SKILL", owner: owner.id, tipsId: form.tipsId, skill: sk.name, note: "这个技能属于形态（原文：姿态下可施放）" });
  }
  /**
   * ★★★ 第 130 轮：**进入次数上限**（余烬：「至多可进入1次」）。
   *   计数记在**拥有者的 notes** 里（notes 是存档字段 ⇒ 存档/续跑不会把次数清零，
   *   与镇压的 seal-used 标记同一套做法）。到上限时**明确拒绝**并给出原因码，
   *   由调用方决定"那接下来就按死亡结算"——不在这里偷偷放行。
   */
  const entered = owner.notes.filter((n: string) => n === "form-entered:" + form.tipsId).length;
  const limit = form.spec?.maxEntries ?? null;
  if (limit !== null && entered >= limit) {
    battle?.trace?.push?.({
      t: "FORM_SKIPPED", owner: owner.id, tipsId: form.tipsId, name: form.name,
      reason: "ENTRY_LIMIT", entered, limit, place: form.trigger,
    });
    return { ok: false, reason: "ENTRY_LIMIT" };
  }
  const summon = battle.addSummon(owner, form.spec, {
    form: { ownerId: owner.id, tipsId: form.tipsId, returnOn: form.returnOn },
    hasSkills: !!opts.hasSkills || formSkills.length > 0,
    skills: formSkills,
    /** ★ 第 130 轮：「继承…在行动条的位置」——位置由调用方给（致命伤害那一刻记下的 victimPos） */
    pos: opts.pos,
  });
  if (!summon) return { ok: false, reason: "SUMMON_REJECTED" };
  owner.notes.push("form-entered:" + form.tipsId);
  owner.transformed = true;
  /** ★★★ 第 122 轮：形态切换进事件总线（此前 TRANSFORM 是「只有声明」的码）。
   *  语义：**形态真的变了**，不是「变形免死」（后者由 battle.ts 的 TRANSFORMED trace 与 transformed 标记表达）。 */
  battle?.queueEvent?.(EV.TRANSFORM, { battle, owner, to: "FORM", form: form.name, tipsId: form.tipsId }, owner.id, owner.teamId);
  owner.setTargetable(false, "SELF_FORM:" + form.tipsId);
  owner.addStatus(formOffFieldDef("本体离场：进入「" + form.name + "」形态（" + form.returnOnSource + " 说明回归时机）"), owner.id, 1, 99999);
  owner.notes.push("offField:form:" + form.tipsId);
  battle?.trace?.push?.({
    t: "FORM_ENTER", owner: owner.id, summon: summon.id, tipsId: form.tipsId, name: form.name,
    trigger: form.trigger, returnOn: form.returnOn,
  });
  // ★★★ 第 122 轮更正：这里原先写「只留 trace，不新开 EV 码」，理由是「这一轮没有订阅者需要它」。
  //   但 TRANSFORM **本来就在 EV 表里**（第 57 轮就声明了）—— 于是它一直属于「声明了、没人派发」那一类。
  //   现在两处（进入 / 回归）都派发 EV.TRANSFORM；trace 的 FORM_ENTER 仍保留给 Theater 看。
  // 旧注释（保留原意）：新事件码要同时改 EV 表、DISPATCHED_EV_CODES 与 g42 的双向比对，
  //   而这一轮没有任何订阅者需要它（Theater / Inspector 读的就是 trace）。
  return { ok: true, summon };
}

/** 本体回归：撤掉离场状态、恢复可选中、以 1 点生命复活（KB 没写回归生命值 ⇒ 明确记账） */
export async function returnForm(battle: any, summon: Entity, reason: string): Promise<number | null> {
  const ownerId = formOwnerOf(summon);
  if (ownerId === null) return null;
  const owner: Entity | undefined = battle.allEntities().find((e: Entity) => e.id === ownerId);
  if (!owner) return null;
  for (const st of [...owner.statuses]) if (st.def.id === FORM_OFF_FIELD_STATUS) owner.expireStatus(st);
  owner.setTargetable(true, "SELF_FORM_END");
  owner.transformed = false;
  /** ★ 第 122 轮：回归也是一次形态切换（同一码、payload 写明方向）—— 否则订阅者只看得见「进」看不见「出」 */
  battle?.queueEvent?.(EV.TRANSFORM, { battle, owner, to: "BASE", reason }, owner.id, owner.teamId);
  /**
   * ★★ 回归生命有两档，**必须分开记账**（否则"保留了原生命"会被写成"默认 1 点"）：
   *   · PRESERVED：本体**没有掉血**就离场（施放式形态，如蛇神）⇒ 原样回来；
   *   · DEFAULT_1：本体是**被打到 0 血**才进入形态的（致命伤害式，如余烬）⇒ KB 没写回归生命值，
   *     按最低可存活值 1 点处理，并在事件里写明这是一个默认值。
   */
  const wasDead = !owner.alive || owner.hp <= 0;
  const specHp = returnHpOf(summon);
  const keep = specHp ?? (wasDead ? 1 : Math.max(1, owner.hp));
  /**
   * ★★★ 第 103 轮：**被镇压者从来没有"死"过**（镇压 = 换人，不是杀死）——
   *   所以它走不了 ~B~revive()~B~（那个函数第一行就是 ~B~if (!target.dead) return false~B~，第一版正是这样红的：
   *   放出来了但生命停在 0）。两条路分开走，事件里也分开记（via）。
   */
  let revived: boolean;
  if (owner.dead) {
    revived = await battle.revive(owner, keep);
  } else {
    owner.alive = true; owner.hpZero = false;
    owner.hp = Math.min(owner.maxHp, Math.max(1, keep));
    // 它一直在行动条里（镇压期间由 preventsAction 挡住行动）⇒ 只有真的不在时才补一条
    if (!battle.timeline.get(owner.id)) battle.timeline.add(owner.id, () => owner.speed);
    battle?.trace?.push?.({ t: "REVIVE", id: owner.id, hp: owner.hp, via: "SEAL_RELEASE" });
    revived = true;
  }
  battle?.trace?.push?.({
    t: "FORM_RETURN", owner: owner.id, summon: summon.id, reason, revived, hp: keep,
    returnHp: specHp !== null ? "TIPS" : wasDead ? "DEFAULT_1" : "PRESERVED",
    note: wasDead ? "KB 未写致命伤害式形态回归时的生命值 ⇒ 按最低可存活值 1 点处理（默认值，如实记账）"
                  : "施放式形态：本体离场期间不会掉血 ⇒ 原生命值回来",
  });
  return owner.id;
}

/**
 * ★★★ 第 103 轮：**解除时以多少生命放回**，取自规格的 ~B~onDefeatRevive~B~（tips_3896 原文「以1点生命复活」）。
 *   没有写这条规格的单位返回 null ⇒ 调用方按 PRESERVED / DEFAULT_1 两档推断（第 101 轮的规矩）。
 */
export function returnHpOf(summon: Entity): number | null {
  for (const n of summon.notes) {
    const m = /^form:returnHp=([0-9]+)$/.exec(n);
    if (m) return Number(m[1]);
  }
  return null;
}

/** 形态单位身上记着"我是谁的形态"（notes 是存档字段，所以这条关系**能续跑**） */
export function formOwnerOf(e: Entity): number | null {
  for (const n of e.notes) {
    /**
     * ★★ 用 [0-9] 而不是 \d：这一行第一版被写成 `(d+)` —— 因为它是**在模板字符串里**生成的，
     *   而模板字符串会把不认识的转义 `\d` 吞成 `d`（同一类坑在本项目出现过多次：正则里的反斜杠）。
     *   抓出它的是 g62 的四条断言（formOwnerOf 返回 null ⇒ 本体回不来），不是代码审查。
     */
    const m = /^form:owner=([0-9]+)$/.exec(n);
    if (m) return Number(m[1]);
  }
  return null;
}

export interface SummonSpec {
  /** tips 里的 id（如 "3896"）—— 证据锚点 */
  tipsId: string;
  name: string;
  /** 生命基准：按拥有者的哪个属性、多少比例（「生命为须佐之男初始攻击150%」） */
  hp: { prop: "atk" | "hp" | "def"; ratio: number } | null;
  /** 「继承…初始属性」：属性整套照抄拥有者的**初始值**（不是当前值） */
  inheritInitialStats: boolean;
  /** 「无法行动」：不参与行动条推进的自主行动 */
  noAction: boolean;
  /** 「不触发御魂和被动」 */
  suppressSoul: boolean;
  suppressPassive: boolean;
  /** 「免疫伤害 / 减益 / 控制效果 / 放逐」—— 取值来自 status.ts 的 ImmuneKind（不在这里重抄一遍） */
  immuneTo: ImmuneKind[];
  /**
   * ★★★ 第 110 轮：**按属性继承**（「继承千姬100%的防御」「继承猫川攻击550%的生命值和100%防御」）。
   *   与 `inheritInitialStats`（整套照抄初始面板）是两种写法：这里是**逐属性给比例**，
   *   所以它单独记一份，不混进那个布尔值（混了就没法审计"到底照抄了什么"）。
   */
  inherit: Array<{ prop: "atk" | "hp" | "def"; ratio: number }>;
  /**
   * ★★★ 第 113 轮：**反应式光环**（「在场时为友方单位恢复受到伤害30%的生命值」）。
   *   与 auras（静态属性修正）分开：它要在**伤害结算之后**动手，所以需要一个事件钩子；
   *   静态修正只要挂一个 Modifier。实测全库只有 1 处（海原贝戟），所以只做这一种形状。
   */
  reactive?: { kind: "HEAL_ON_ALLY_DAMAGE"; ratio: number; evidence: string };
  /**
   * ★★★ 第 113 轮：**移除/消失时的代价或收益**（「被移除时返还2点鬼火」「消失时，对敌方全体造成攻击49%的伤害」）。
   *   ★ 读作「**移除路径**」（收回 / 效果移除），**不含阵亡** —— 依据是 KB 自己在区分这两种写法：
   *     雷冢写「雷冢**被击败**后，被镇压的式神以1点生命复活」，明识灯写「**被移除**时返还2点鬼火」。
   *   挂在 removeSummon 这唯一的移除路径上，出处逐条记在 evidence 里。
   */
  onRemove?: { orbs?: number; healMaxHpRatio?: number; damageAtkRatio?: number; evidence: string };
  /**
   * ★★★ 第 111 轮：**召唤物自己 tips 里的在场光环**（「在场时，降低慧明灯的速度40点」）。
   *   ★ 与 `FormSpec.auras`（**技能原文**里的那一份）是两处来源，运行时两份都施加 ——
   *     名字相同但载体不同，读代码时不至于混淆（一个在规格里、一个在放置声明里）。
   */
  auras?: PresenceAura[];
  /** 速度修正（「提升100点速度」） */
  spdBonus: number | null;
  /** 被击败后的处理（「被镇压的式神以1点生命复活」） */
  onDefeatRevive: { hp: number } | null;
  /** 胜利判定：「若敌方只存在雷冢，视为战斗胜利／若场上只有余烬视为战斗失败」 */
  victoryRule: "ONLY_THIS_MEANS_DEFEAT" | null;
  /** 「该效果只可生效1次」 */
  oncePerTarget: boolean;
  /**
   * ★★★ 第 130 轮：**一个单位最多能进入这个形态几次**（KB：余烬 tips_6071 写「**至多可进入1次**余烬」）。
   *
   * 为什么必须实现：接线「受到致命伤害时进入形态」之后，进入次数就成了**结果的一部分** ——
   *   没有上限时，百羽凤凰火每挨一次致命伤害就换一次形态，等于反复免死（原文写明只有 1 次）。
   * null = 原文没写上限 ⇒ **不猜**（不封顶），与其它"没写就是不限"的字段同一约定。
   * ★ 它住在 SummonSpec（数据来自 **tips 原文**），不是 FormSpec（来自技能原文的放置声明）——
   *   第一版写进了 FormSpec，于是运行时读到的永远是 undefined（一个不会报错的错，探针当场抓到）。
   */
  maxEntries: number | null;
  evidence: string;
}

/**
 * ★ 生命基准的**四种写法**（都是 KB 里真实出现的，逐条加而不是把正则放宽到"看起来像"）：
 *   A 「生命为须佐之男初始攻击150%」／「生命值是千姬攻击力的550%」 —— 词是 生命为/生命值是；
 *   B 「继承慧明灯45%生命值」 —— 继承**拥有者生命**的比例；
 *   C 「继承猫川攻击550%的生命值」 —— 继承**拥有者攻击**的比例（属性词写在百分号前面）；
 *   D 「继承千姬100%的防御」 —— 逐属性比例（进 `inherit`，不进 hp）。
 * ★ 第 110 轮之前只认 A 的前半（`生命为…`），于是 千姬「海原贝戟」/慧明灯「明识灯」/猫川「别馆私汤」
 *   三条 tips 全被判成"不是放置单位" —— 而技能里的 `召唤[tips_N]` 连**跳过记录**都没有（静默丢）。
 */
const HP_RE = /生命值?[是为]([^，。]{0,12}?)的?(\d+(?:\.\d+)?)%/;
const HP_INHERIT_RE = /继承[^，。]{0,10}?(\d+(?:\.\d+)?)%的?生命值/;
const HP_INHERIT_ATTR_RE = /继承[^，。]{0,10}?(攻击力|攻击|防御力|防御)(\d+(?:\.\d+)?)%的?生命值/;
/** 继承子句里的**逐属性**比例（防御/攻击；生命值那一项归 hp，避免同一句话算两遍） */
const INHERIT_ATTR_RE = /(\d+(?:\.\d+)?)%的?(防御力|防御|攻击力|攻击)/g;
const PROP: Array<[RegExp, "atk" | "hp" | "def"]> = [[/攻击/, "atk"], [/生命/, "hp"], [/防御/, "def"]];

/**
 * 从一个 tips 条目解析出召唤物规格。**只认无歧义的写法**，读不出来的字段一律保持默认值，
 * 并把这一条原文放进 evidence —— 判错时要能一眼看出是照哪句话判的。
 */
export function parseSummonSpec(tip: { id: string | number; name: string; desc?: string }): SummonSpec | null {
  /**
   * ★★★ 第 130 轮：进入次数上限（「至多可进入1次余烬」）。
   *   实测全库只有这一条这么写；读不出来 = null（不封顶，不猜）。
   */
  const maxEntriesM = /至多可进入\s*(\d+)\s*次/.exec(String(tip.desc ?? ""));
  const desc = String(tip.desc ?? "").replace(/<br\s*\/?>/gi, "");
  if (!desc) return null;
  let hp: SummonSpec["hp"] = null;
  const hpM = desc.match(HP_RE);
  const hpInhAttr = desc.match(HP_INHERIT_ATTR_RE);
  const hpInh = desc.match(HP_INHERIT_RE);
  if (hpInhAttr) {
    // C：「继承猫川攻击550%的生命值」⇒ 基准是拥有者的**攻击**
    const prop = PROP.find(([re]) => re.test(hpInhAttr[1]))?.[1] ?? "atk";
    hp = { prop, ratio: Number(hpInhAttr[2]) / 100 };
  } else if (hpInh) {
    // B：「继承慧明灯45%生命值」⇒ 基准是拥有者的生命
    hp = { prop: "hp", ratio: Number(hpInh[1]) / 100 };
  } else if (hpM) {
    // A：「生命为…」／「生命值是千姬攻击力的550%」
    const prop = PROP.find(([re]) => re.test(hpM[1]))?.[1] ?? "atk";
    hp = { prop, ratio: Number(hpM[2]) / 100 };
  }
  /** D：继承子句里的逐属性比例（防御/攻击）。★ 生命值不在这里 —— 它已经由 B/C 归到 hp */
  /**
   * ★★★ 第 113 轮：**反应式光环**（海原贝戟）与**移除代价**（明识灯/烟之鬼…）的解析。
   *   两句都只认无歧义的写法，且各自把**原文**留进 evidence。
   */
  const reactiveM = /在场时为?(友方单位|友方全体|除召唤物外友方)[^。]{0,10}?恢复受到伤害(\d+(?:\.\d+)?)%的生命值/.exec(desc)
    ?? /在场时为?(友方单位|友方全体|除召唤物外友方)[^。]{0,10}?受到伤害(\d+(?:\.\d+)?)%[^。]{0,6}?恢复/.exec(desc);
  const orbM = /被移除时返还(\d+)点鬼火/.exec(desc);
  const healM = /被移除时[^。]{0,20}?恢复[^。]{0,20}?生命上限(\d+(?:\.\d+)?)%/.exec(desc);
  const dmgM = /消失时[^。]{0,20}?对敌方全体造成攻击(\d+(?:\.\d+)?)%的伤害/.exec(desc);
  const onRemove: SummonSpec["onRemove"] = (orbM || healM || dmgM) ? {
    ...(orbM ? { orbs: Number(orbM[1]) } : {}),
    ...(healM ? { healMaxHpRatio: Number(healM[1]) / 100 } : {}),
    ...(dmgM ? { damageAtkRatio: Number(dmgM[1]) / 100 } : {}),
    evidence: (orbM ?? healM ?? dmgM)![0],
  } : undefined;
  const inhClause = desc.match(/继承[^。]{0,60}/)?.[0] ?? "";
  const inherit: SummonSpec["inherit"] = [];
  for (const m of inhClause.matchAll(INHERIT_ATTR_RE)) {
    const prop = PROP.find(([re]) => re.test(m[2]))?.[1];
    if (!prop) continue;
    const ratio = Number(m[1]) / 100;
    if (!inherit.some(x => x.prop === prop && x.ratio === ratio)) inherit.push({ prop, ratio });
  }
  /**
   * ★★ 免疫项的判据**不在这里**：规则表是 status.ts 的 `IMMUNE_TEXT_RULES`（唯一一份）。
   *   第一版在这里又抄了一遍四个字符串，词汇普查立刻抓到一组跨文件重复词表 ——
   *   与第 97 轮 RESIST 的处理同一条规矩：**判据从声明派生，不写第二份**。
   */
  const immuneTo: SummonSpec["immuneTo"] = IMMUNE_TEXT_RULES.filter(r => r.re.test(desc)).map(r => r.kind);
  const spdM = desc.match(/(?:提升|增加)\s*(\d+)\s*点速度/);
  const reviveM = desc.match(/被击败后[^。]{0,20}以\s*(\d+)\s*点生命复活/);
  const victory = /若敌方只存在[^。]{0,6}视为战斗胜利|若场上只有[^。]{0,6}视为战斗失败/.test(desc)
    ? ("ONLY_THIS_MEANS_DEFEAT" as const) : null;
  const spec: SummonSpec = {
    tipsId: String(tip.id), name: String(tip.name), hp,
    inheritInitialStats: /继承[^。]{0,20}初始(属性|攻击|生命)/.test(desc),
    noAction: /无法行动/.test(desc),
    suppressSoul: /不触发御魂/.test(desc),
    suppressPassive: /和被动|被动技能失效/.test(desc),
    inherit,
    /** ★ 第 111 轮：召唤物自己 tips 里的「在场时…」——范围默认是**拥有者**（「降低慧明灯的速度40点」） */
    auras: parsePresenceAuras(desc, "OWNER").auras,
    ...(reactiveM ? { reactive: { kind: "HEAL_ON_ALLY_DAMAGE" as const, ratio: Number(reactiveM[2] ?? reactiveM[1]) / 100, evidence: reactiveM[0] } } : {}),
    ...(onRemove ? { onRemove } : {}),
    immuneTo, spdBonus: spdM ? Number(spdM[1]) : null,
    onDefeatRevive: reviveM ? { hp: Number(reviveM[1]) } : null,
    victoryRule: victory,
    /**
     * ★★★ 第 130 轮：**「至多可进入N次」从这里挪走了** —— 它是"进入次数上限"，不是"每个目标只生效一次"。
     *   两者此前挤在同一个正则里（第 103 轮写镇压式时把「至多可进入1次」也收了进来），
     *   而 oncePerTarget 的唯一消费者是镇压路径（雷冢的「同一式神该效果只可生效1次」）。
     *   一个字段一件事：进入次数进 maxEntries（见上），这里只留"每个目标一次"。
     */
    oncePerTarget: /只可生效1次|唯一效果/.test(desc),
    maxEntries: maxEntriesM ? Number(maxEntriesM[1]) : null,
    evidence: desc.slice(0, 160),
  };
  /**
   * ★★ 判据收紧（第一版太宽，实测 17 条里大半是**状态**而不是放置单位）：
   *   只有"一个单位才有的东西"才算规格 —— **生命基准 / 继承初始属性 / 胜利判定**。
   *   「无法行动」「免疫伤害」这类**状态也有的**描述不能单独作为判据：
   *   第一版把它们也算进来，于是「放逐」「沉眠」「吞食」这些 tips 条目被当成了召唤物 ✗。
   */
  const meaningful = !!spec.hp || spec.inheritInitialStats || !!spec.victoryRule;
  return meaningful ? spec : null;
}