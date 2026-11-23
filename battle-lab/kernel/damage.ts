// kernel/damage.ts — 5 种伤害类型（官方[5][12][18][28] + 形毁伤害）+ 治疗/恢复分离
import { DamageType, HpMutation, EV } from "./types.ts";
import { findPreventLethal, findDamageImmunity } from "./status.ts";
import { envDamageMultiplier, envHealMultiplier } from "./environment.ts";
import { GameMath } from "./gamemath.ts";
import type { Entity } from "./entity.ts";
import type { Battle } from "./battle.ts";

export interface DamageInput {
  source: Entity; target: Entity; base: number;   // 已含技能倍率
  rate: number; type: DamageType;
  skillTag?: string;
  /**
   * ★★★ 第 93 轮：本次伤害**附带的吸血**（比例）。
   * 由编译产物 `SkillIR.lifesteal` 提供，或由被动运行时在触发时补上（见 compile/passive-runtime.ts）。
   * 基数是"实际扣掉的血"还是"伤害总量"由 policies.lifesteal 决定 —— 见下面的 applyLifesteal。
   */
  lifesteal?: { ratio: number } | null;
  /** "此伤害不触发…御魂" (betting kits): result.triggersSoul = false. Unset everywhere else ⇒ no change. */
  noSoul?: boolean;
}

export interface DamageResult {
  type: DamageType; raw: number; final: number;
  isCrit: boolean; critMultiplier: number;
  defenseMultiplier: number; applied: number; absorbed: number;
  /** 各类型的行为开关，全部来自官方 tooltip */
  triggersSoul: boolean; canBeShared: boolean; canCrit: boolean;
  ignoresDefense: boolean; ignoresModifiers: boolean;
}

/** 官方[5] 间接伤害：对防御为 0 的敌人必定暴击 */
function defenseMultiplier(def: number): number { return 300 / (300 + Math.max(0, def)); }

export async function dealDamage(battle: Battle, input: DamageInput): Promise<DamageResult> {
  const { source, target, type } = input;
  const rate = input.rate ?? 1;
  const def = type === DamageType.TRUE || type === DamageType.FIXED || type === DamageType.FORM_DESTROY
    ? 0 : target.prop("def");

  const canCrit = type === DamageType.NORMAL || type === DamageType.INDIRECT;
  let isCrit = false;
  /**
   * Crit RES (Global 335_02 L5: "Crit RES, meaning the damage source is treated as having 30% less Crit"):
   *   effective crit = max(0, attacker cri − target critRes). Only betting kits write `critRes`
   *   (e.g. compile/betting-suzuhiko.ts 心火永明); absent ⇒ 0 ⇒ `cri` is the untouched source value
   *   (BASE byte-identical). The crit roll is still drawn, so the RNG stream never shifts.
   */
  const criRaw = source.prop("cri");
  const critRes = target.prop("critRes");
  const cri = critRes > 0 ? Math.max(0, criRaw - critRes) : criRaw;
  let critRoll: { n: number; v: number; tag: string } | null = null;
  let critForced = false;
  if (canCrit) {
    const forced = type === DamageType.INDIRECT && def <= 0;   // 官方[5]
    critForced = forced;
    if (forced) {
      isCrit = true;   // 必暴：**没有**抽随机数，因此不能假装有一个 roll
    } else {
      battle.rng.expect(`crit:${input.skillTag ?? type}`);
      isCrit = battle.rng.testHit(cri);
      critRoll = battle.rng.lastDraw;
    }
  }
  const critMultiplier = isCrit ? source.prop("crid") : 1;

  const ignoresModifiers = type === DamageType.FIXED || type === DamageType.FORM_DESTROY;
  /**
   * ★★ 第 43 轮修：这条链路上原本**只有受击方的两个字段**：
   *     dealtBuff   = target.prop("dmgTakenB") + 1
   *     takenDebuff = target.prop("dmgTakenD") + 1
   *   也就是说「攻击方身上的增伤」从来没被读过。实测（g32）：把 dmgTakenB=0.5 加到**攻击方**身上，
   *   伤害逐位不变（991.2 → 991.2）；加到**受击方**身上才 ×1.5。
   *   而无刀取（文案「永久提升15%的伤害」）写的正是 dmgTakenB ——
   *   于是它实际的效果是「携带者多挨最多 45% 伤害」，方向完全相反。
   *
   * 修法刻意选择**加一项**而不是改口径：新增源侧字段 dmgDealtB（造成伤害加成），
   * 默认 0 —— 没有任何东西写它时，行为与修复前逐位相同，因此**不动基准**。
   * 受击侧两个字段这次不动：它们到底该是「易伤」还是「减伤」，
   * 仓库里有三种互相矛盾的说法（见报告 §35），那是一个需要单独决策的语义问题。
   */
  const dealtBonus = ignoresModifiers ? 1 : source.prop("dmgDealtB") + 1;
  const dealtBuff = ignoresModifiers ? 1 : target.prop("dmgTakenB") + 1;
  const takenDebuff = ignoresModifiers ? 1 : target.prop("dmgTakenD") + 1;
  const mods = dealtBonus * dealtBuff * takenDebuff;
  /**
   * ★★★ 第 109 轮：**残局乘区**（a1-4 §34 的 stalemate.damageMultiplier）。
   *   位置刻意与增伤/易伤**同一处**：`ignoresModifiers` 的伤害类型（固定伤害 / 形态摧毁）不吃它 ——
   *   与"固定伤害无视 modifier"是同一条既有语义。
   *   ★ 与固定伤害的交互**没有证据**（规格只写「每 X 秒 +Y% 伤害」），所以不擅自决定；
   *     将来要改，得由规则自己带出处（见 kernel/environment.ts 的 EnvironmentRule.evidence）。
   *   默认档：没有档位 ⇒ 1 ⇒ 历史逐位相同。
   */
  const envMul = ignoresModifiers ? 1 : envDamageMultiplier(battle.environment);

  const dmgMul = type === DamageType.TRUE || type === DamageType.FIXED || type === DamageType.FORM_DESTROY
    ? 1 : defenseMultiplier(def);

  battle.rng.expect(`float:${input.skillTag ?? type}`);
  const float = battle.rng.real(1 - battle.rules.damageFloat, 1 + battle.rules.damageFloat);
  const floatRoll = battle.rng.lastDraw;
  const raw = input.base * rate * critMultiplier;
  const final = type === DamageType.FIXED
    ? input.base * rate
    : raw * dmgMul * mods * envMul * float;

  const res: DamageResult = {
    type, raw, final, isCrit, critMultiplier,
    defenseMultiplier: dmgMul, applied: 0, absorbed: 0,
    triggersSoul: type !== DamageType.INDIRECT && type !== DamageType.CONDUCTION && input.noSoul !== true, // 官方[5][12]
    canBeShared: type !== DamageType.INDIRECT,                                   // 官方[5] 无法被分担
    canCrit, ignoresDefense: type !== DamageType.NORMAL,
    ignoresModifiers,
  };

  const ctx: any = { input, result: res, cancelled: false };
  await battle.bus.dispatch(EV.BEFORE_DAMAGE, ctx, source.id, source.teamId, id => battle.teamOf(id));
  if (ctx.cancelled) { res.final = 0; return res; }

  /**
   * ★★★ 第 94 轮：**状态自带的伤害免疫**（「免疫所有伤害 / 免疫伤害」）。
   *
   * 位置在 BEFORE_DAMAGE **之后**、DAMAGE/AFTER_DAMAGE **之前**：
   *   · 放在 BEFORE_DAMAGE 之前 → 订阅者看不到这次攻击（它们连「打过来了」都不知道）；
   *   · 放在 DAMAGE 之后 → 「造成伤害时」类效果会被一次**根本没造成伤害**的攻击触发。
   * ⇒ 免疫的语义是「这一击被免除」：不落账、不派 DAMAGE/AFTER_DAMAGE、不结算吸血。
   * ★ 留下的是一条 IMMUNE trace + 一次 EV.IMMUNE 派发 —— 不是「什么都没有」。
   */
  const dimm = findDamageImmunity(target);
  if (dimm) {
    const negated = res.final;
    res.final = 0;
    battle.trace.push({
      t: "IMMUNE", src: source.id, dst: target.id, by: dimm.def.id, kind: "DAMAGE",
      damage: GameMath.display(negated), consumed: dimm.consumed, skill: input.skillTag ?? String(type),
    });
    await battle.bus.dispatch(EV.IMMUNE,
      { target, source, by: dimm.def, kind: "DAMAGE", damage: negated },
      target.id, target.teamId, (id: number) => battle.teamOf(id));
    return res;
  }
  const fullyAbsorbed = res.applied === 0 && res.absorbed > 0;
  if (!fullyAbsorbed || battle.rules.fullyAbsorbedTriggersOnHit) {
    await battle.bus.dispatch(EV.DAMAGE, { input, result: res }, source.id, source.teamId, id => battle.teamOf(id));
  } else {
    battle.trace.push({ t: "ONHIT_SKIPPED_FULLY_ABSORBED", dst: target.id, absorbed: res.absorbed });
  }
  const m = target.mutateHp(HpMutation.DAMAGE, res.final, `dmg:${type}`);
  res.applied = m.applied; res.absorbed = m.absorbed;
  /**
   * ★★★ 第 122 轮：护盾的「吸收」与「破碎」从此进事件总线。
   * 此前它们只活在 `absorbed` 字段与单位的 `notes` 里 —— 机制在跑，但 SHIELD_DAMAGE / SHIELD_BREAK
   * 两个码从第 57 轮起就是「只有声明」。数值取自 mutateHp 的返回值（唯一知道真相的地方）。
   * ★ 走队列（同步生产点不能 await dispatch），由 Battle 在安全点 drain。
   */
  if (m.absorbed > 0) battle.queueEvent(EV.SHIELD_DAMAGE, { battle, target, source, absorbed: m.absorbed, shieldBroken: m.shieldBroken }, target.id, target.teamId);
  if (m.shieldBroken > 0) battle.queueEvent(EV.SHIELD_BREAK, { battle, target, source, count: m.shieldBroken }, target.id, target.teamId);
  /**
   * ★★★ 第 94 轮：**免死**（状态自带）。
   *
   * 数据一直在：338 条 buff 里有 3 条写着「免疫首次/下1次受到的致命伤害」
   * （血色之花 5852_1 / 四季流转 3928_1 / 怒火 2652_1），而 `Entity.undeathUsed`
   * 此前**从来没有被置为 true** —— 和 reviveBlocked 一样，是个只有序列化没有写入方的字段。
   *
   * 位置：**在 mutateHp 之后、recordDamage 之前** —— 因为「这一击致不致命」要等护盾算完才知道
   * （放在伤害之前判会漏掉「护盾挡了一半」的情形）。代价是血量先掉再还回去，
   * 所以这里必须把三个数字**一起改正**：hpAfter / applied / recordDamage，
   * 否则 trace 与统计会与实际血量对不上（G6 对照就是要逐条核血量的）。
   */
  if (target.hpZero) {
    const pl = findPreventLethal(target);
    if (pl) {
      const hpBefore = m.hpBefore;
      target.hp = pl.keep === "FULL" ? Math.max(1, hpBefore) : 1;
      target.hpZero = false;
      target.undeathUsed = true;            // ★ 这个字段第一次真的被置为 true
      m.hpAfter = target.hp;
      m.applied = Math.max(0, hpBefore - target.hp);
      res.applied = m.applied;
      battle.trace.push({
        t: "UNDYING", id: target.id, src: source.id, by: pl.def.id, keep: pl.keep,
        hpBefore: GameMath.display(hpBefore), hpAfter: GameMath.display(target.hp),
        exhausted: pl.exhausted, undeathUsed: true,
      });
      if (pl.exhausted) {
        const st = target.statuses.find(s => s.def.id === pl.def.id);
        if (st && target.expireStatus(st)) {
          battle.trace.push({ t: "STATUS_EXPIRE", id: target.id, status: pl.def.id, name: pl.def.name, reason: "UNDYING_CONSUMED" });
          battle.queueEvent(EV.STATUS_EXPIRE,
            { battle, entity: target, status: pl.def.id, name: pl.def.name, reason: "UNDYING_CONSUMED" },
            target.id, target.teamId);
        }
      }
    }
  }
  battle.recordDamage(source.id, target.id, m.applied);   // §45：统计在引擎里，不依赖 trace

  // ★ G5：每次伤害都生成 Breakdown（a1-4 §19/§26）——
  //   把"这个数字是怎么来的"逐项记下来，而不是只留一个结果。
  //   每一项都来自上面真实参与计算的量，没有一个是为了好看补的。
  const breakdown = {
    type,
    skill: input.skillTag ?? null,
    // ① 技能倍率部分
    base: input.base, rate, atkPortion: input.base * rate,
    // ② 暴击
    crit: {
      canCrit, forced: critForced, isCrit, cri,
      ...(critRes > 0 ? { criRaw, critRes } : {}),
      roll: critRoll ? { n: critRoll.n, v: critRoll.v, tag: critRoll.tag } : null,
      cridMultiplier: critMultiplier,
    },
    // ③ 增伤/易伤（来自 target 身上的 modifier）
    modifiers: { dmgDealtB: dealtBonus, dmgTakenB: dealtBuff, dmgTakenD: takenDebuff, product: mods, env: envMul, ignored: ignoresModifiers },
    // ④ 防御减伤
    defense: { value: def, multiplier: dmgMul, formula: "300/(300+def)", ignored: type !== DamageType.NORMAL },
    // ⑤ 浮动
    float: { value: float, window: battle.rules.damageFloat, roll: floatRoll ? { n: floatRoll.n, v: floatRoll.v, tag: floatRoll.tag } : null },
    // ⑥ 结果与落账
    raw, final: res.final, applied: m.applied, absorbed: m.absorbed,
    // 人话版算式（Inspector 直接展示）
    steps: [
      `基础 ${input.base.toFixed(1)} × 倍率 ${(rate * 100).toFixed(0)}% = ${(input.base * rate).toFixed(1)}`,
      canCrit
        ? (critForced ? `暴击：官方[5] 间接伤害对 0 防御必暴 → ×${critMultiplier.toFixed(2)}`
                      : `暴击判定：roll ${critRoll ? critRoll.v.toFixed(4) : "—"} < 暴击率 ${cri.toFixed(4)} → ${isCrit ? `暴击，×${critMultiplier.toFixed(2)}` : "未暴击，×1"}`)
        : `该伤害类型不参与暴击判定（${type}）`,
      ignoresModifiers ? "增伤/易伤：该类型无视 modifier" : `增伤 ${dealtBuff.toFixed(3)} × 易伤 ${takenDebuff.toFixed(3)} = ${mods.toFixed(3)}`,
      envMul === 1 ? "残局乘区：×1（环境无档位）" : `残局乘区：×${envMul.toFixed(3)}`,
      type === DamageType.NORMAL ? `防御减伤：300/(300+${def.toFixed(0)}) = ${dmgMul.toFixed(4)}` : `防御减伤：该类型无视防御`,
      `浮动：×${float.toFixed(4)}（±${(battle.rules.damageFloat * 100).toFixed(0)}%）`,
      `最终伤害 ${res.final.toFixed(1)} → 实际扣除 ${m.applied.toFixed(1)}${m.absorbed > 0 ? `（护盾吸收 ${m.absorbed.toFixed(1)}）` : ""}`,
    ],
  };
  // ★ hpBefore / hpAfter：G6 对照要以「人从游戏画面上读到的数字」为准 —— 血量是玩家真正看得见、
  //   也唯一能逐事件核对的量。没有它，模拟侧的时间线与人工观测根本无法逐条比对。
  battle.trace.push({
    t: "DAMAGE", type, src: source.id, dst: target.id,
    final: GameMath.display(res.final), applied: m.applied, absorbed: m.absorbed, crit: isCrit,
    hpBefore: GameMath.display(m.hpBefore), hpAfter: GameMath.display(m.hpAfter),
    breakdown,
  });

  // ★★★ 第 93 轮：伤害落账之后立刻结算吸血（**逐段**，因为结算点就在这里）。
  //   放在 AFTER_DAMAGE 之前：被动侧若也有吸血（「造成伤害时…附带N%吸血」），
  //   它拿到的是同一份 result.applied，两者各自按自己的比例回流，互不吞并。
  if (input.lifesteal) await applyLifesteal(battle, source, input.lifesteal.ratio, res, input.skillTag ?? String(type));

  await battle.bus.dispatch(EV.AFTER_DAMAGE, { input, result: res }, source.id, source.teamId, id => battle.teamOf(id));
  // A nested damage inside AFTER_DAMAGE (e.g. a soul proc) may already have resolved this death: resolving it
  // again traced DEATH twice and re-ran every on-death rule (kill counters, ally-defeated stacks, free casts).
  if (target.hpZero && !target.dead) await battle.resolveLethal(target, source.id);
  return res;
}

/**
 * ★★★ 第 93 轮：吸血 —— 把「造成伤害」与「回流生命」接起来。
 *
 * 两种口径都由 `policies.lifesteal` 决定（basis / asRecover），**不写死在代码里**：
 *   · HP_DAMAGE_APPLIED（默认）：只回流真的扣掉的血 —— 护盾挡掉的部分不算；
 *   · TOTAL_DAMAGE_BEFORE_SHIELD：按伤害总量算（含被护盾吸收的）。
 * 两种都留了实现，因为一次游戏内观测就能定案（见 kernel/policies.ts 红区 F）。
 *
 * 走 healTarget（治疗通道）：因此受减疗影响、计入治疗统计、在 Theater 里会出现一条 HEAL。
 * ★ 死亡者不回流 —— 吸血的前提是"打人的那个还活着"；反伤把人打死还能吸血，是没依据的猜测。
 */
export async function applyLifesteal(battle: Battle, src: Entity, ratio: number, res: DamageResult, tag: string): Promise<number> {
  /**
   * ★★★ 第 93 轮：这条守卫**第一版写错了**，是 tests/g54 第 [3] 节把它抓出来的。
   *   第一版只查 `src.alive` —— 而 `alive` 是一个**字段**（Entity 里 alive = true），
   *   只在死亡结算时被置 false；把 hp 直接置 0（还没走 resolveLethal）时它**仍然是 true**，
   *   于是"阵亡者不回流"这条断言实际成立不了：一个 0 血单位照样回了 217 点血。
   *   ⇒ 两个都查：`alive`（死亡状态机说的）+ `hp > 0`（血量事实说的）。
   *   注释里写的性质必须有代码守着 —— 否则它只是一句话。
   */
  if (!(ratio > 0) || !src.alive || !(src.hp > 0)) return 0;
  const policy = (battle as any).policies?.lifesteal;
  const base = policy?.basis === "TOTAL_DAMAGE_BEFORE_SHIELD" ? res.final : res.applied;
  if (!(base > 0)) return 0;
  const healed = await healTarget(battle, src, src, base * ratio, policy?.asRecover ? { recover: true } : {});
  battle.trace.push({
    t: "LIFESTEAL", src: src.id, ratio, tag,
    damage: GameMath.display(res.applied), base: GameMath.display(base),
    healed: GameMath.display(healed), policy: policy?.id ?? null,
  });
  return healed;
}

export async function healTarget(battle: Battle, source: Entity, target: Entity, amount: number, opts: { recover?: boolean; crit?: boolean; healDown?: number } = {}): Promise<number> {
  /**
   * ★★★ 第 130 轮：**治疗的唯一入口加两道闸门**（改一处，所有治疗路径同时生效）。
   *
   *   ① 「无法被治疗或[恢复]生命」（KB：百羽凤凰火「未熄羽」）—— 能力位 caps.receivesHeal；
   *   ② **离场的本体**（形态期间，notes 里带 offField:form:）—— 它不在场上，治疗不该落在它身上。
   *
   * 两条都是**实测**抓出来的：百羽凤凰火被打到 0 血进入余烬之后，本体仍在 team.members 里、
   * alive 仍为 true，于是治疗把它从 0 抬到 16767；回归时 wasDead 判成 false、生命按"保留"回来，
   * 而原文写的是「到达行动条终点后**复活**」（应当按 1 点生命的默认档回来）。
   * ★ 留痕而不是静默返回 —— "治疗没落地"必须看得见，否则回放里会以为是治疗量算错了。
   */
  if (!target.caps.receivesHeal) {
    battle?.trace?.push?.({ t: "HEAL_SKIPPED", dst: target.id, src: source.id, amount: GameMath.display(amount), reason: "CANNOT_BE_HEALED" });
    // Betting mode (compile/betting-ungaikyo.ts) installs this to convert the blocked heal (云外镜「镜中世界」); unset otherwise.
    (battle as any)?.onHealBlocked?.(source, target, amount);
    return 0;
  }
  if ((target.notes ?? []).some((n: string) => n.startsWith("offField:form:"))) {
    battle?.trace?.push?.({ t: "HEAL_SKIPPED", dst: target.id, src: source.id, amount: GameMath.display(amount), reason: "OFF_FIELD" });
    return 0;
  }
  const recover = opts.recover ?? false;   // 官方[20] 恢复：不受减疗影响、不触发治疗相关效果、不会暴击
  /**
   * Betting mode only: base-heal amplifiers installed by MAX-only souls (soul/custom-effects.ts 树妖).
   * Absent by default ⇒ BASE runs are byte-identical. Applied to the base heal, before crit / heal-down.
   */
  let base = amount;
  const amps: Array<(src: Entity, dst: Entity, base: number) => number> | undefined = (battle as any)?.healAmplifiers;
  if (!recover && amps?.length) for (const f of amps) base = f(source, target, base);
  let amt = base;
  if (!recover) {
    if (opts.crit) battle.rng.expect("heal-crit");
    const crit = opts.crit ? (battle.rng.testHit(source.prop("cri")) ? source.prop("crid") : 1) : 1;
    const down = opts.healDown ?? target.prop("healDown");
    /**
     * ★★★ 第 109 轮：**残局治疗乘区**（§34 的 stalemate.healingMultiplier）。
     *   与减疗/暴击**同一个位置**：走 HEAL 通道的才吃它；`recover`（官方[20] 恢复，不受减疗影响）不吃 ——
     *   与"固定伤害不吃增伤"是同一种边界处理方式（不替规格做未经证实的决定）。
     */
    const envHeal = envHealMultiplier((battle as any).environment);
    amt = base * crit * (1 - down) * envHeal;
  }
  const m = target.mutateHp(recover ? HpMutation.RECOVER : HpMutation.HEAL, amt, recover ? "recover" : "heal");
  battle.recordHeal(source.id, m.applied);
  battle.trace.push({
    t: recover ? "RECOVER" : "HEAL", src: source.id, dst: target.id,
    amount: GameMath.display(m.applied),
    hpBefore: GameMath.display(m.hpBefore), hpAfter: GameMath.display(m.hpAfter),
  });
  /**
   * ★★★ 第 120 轮：这是**同步**生产点（healTarget 不是 async）⇒ 走事件队列，不写悬空 Promise。
   * 语义：HEAL = 走治疗乘区的治疗（吃减疗/暴击/残局治疗乘区）；RECOVER = 官方[20] 恢复。
   * 两者**不是一个事件**：被动文案里「受到治疗时」与「恢复生命时」是两件事（登记册里分开登记）。
   */
  battle.queueEvent(recover ? EV.RECOVER : EV.HEAL,
    { battle, source, target, amount: m.applied, base, hpBefore: m.hpBefore, hpAfter: m.hpAfter, recover: !!recover },
    source.id, source.teamId);
  return m.applied;
}

export function loseHp(battle: Battle, target: Entity, amount: number): number {
  // 官方[21] 失去：不暴击、不被护盾吸收、不触发受到伤害相关效果
  const m = target.mutateHp(HpMutation.LOSS, amount, "loss");
  battle.trace.push({
    t: "HP_LOSS", dst: target.id, amount: GameMath.display(m.applied),
    hpBefore: GameMath.display(m.hpBefore), hpAfter: GameMath.display(m.hpAfter),
  });
  /** ★ 第 120 轮：官方[21]「失去」——不暴击、不被护盾吸收、不触发受到伤害相关效果，是**另一个事件** */
  battle.queueEvent(EV.HP_LOSS,
    { battle, target, amount: m.applied, hpBefore: m.hpBefore, hpAfter: m.hpAfter },
    target.id, target.teamId);
  return m.applied;
}
