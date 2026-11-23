// soul/effect-system.ts — M1.5C SoulEffectSystem：把御魂战斗效果接入 Event Kernel
// 原则同全项目：**绝不静默丢弃**。
//   - 能解释的数值型效果 -> 注册成真实 handler
//   - 解释不了的        -> 仍然注册 handler，但标记 UNSUPPORTED 并计数，供报告
import { EV } from "../kernel/types.ts";
import { DISPATCHED_EV_CODES } from "../compile/passive-runtime.ts";
import { GameMath } from "../kernel/gamemath.ts";
import { compileSoulEffect, type SoulEffectIR } from "./effects.ts";
import type { SoulEffectRef } from "./stat-source.ts";
import type { SoulDef } from "./loadout.ts";
import { customSoulFor, CUSTOM_SOUL_NOTES } from "./custom-effects.ts";

/** 触发时机 -> EventBus code */
const TRIGGER_TO_EVENT: Record<string, string> = {
  TURN_END: EV.TURN_END,
  TURN_START: EV.TURN_START,
  ON_DEAL_DAMAGE: EV.AFTER_DAMAGE,
  ON_TAKE_DAMAGE: EV.AFTER_DAMAGE,
  ON_ATTACK: EV.BEFORE_DAMAGE,
  ON_TAKE_ATTACK: EV.BEFORE_DAMAGE,
  BATTLE_START: EV.BATTLE_START,
  ON_SKILL: EV.SKILL_END,
  ON_ACTION: EV.ACTION_END,
  ON_DEATH: EV.DEATH,
  // ★ 引擎**没有**暴击事件（EV 里根本没有 CRI）：这里刻意保留一个不存在的 code，
  //   好让「暴击时」类御魂（针女/地藏像）永远不会触发。
  //   用 as any 而不是新增 EV.CRI —— 后者会让「其实没有这个事件」这件事从类型上消失。
  //
  // ★★★ 第 90 轮更正上面那句旧注释：它原本还写着「并由 interpretEffect **如实降级为 UNSUPPORTED**」——
  //   实测这句**不总成立**：地藏像 的 interpretEffect 返回的是 **SHIELD**，
  //   于是它被报成「已安装、挂在 CRI 上」的护盾效果，而 CRI **永远不会被派发**
  //   ⇒ **一个静默的死处理器**（针女同样是 CRI，但它确实被判成 UNSUPPORTED，所以只有地藏像漏了）。
  //   ⇒ 光靠"意图 + 一句注释"守不住这件事，补一道**结构性**判据（见下面的 deadCode）：
  //     `code` 不在「真的有人派发」的集合里，就不算已安装。
  ON_CRIT: (EV as any).CRI ?? "CRI",
  ON_KILLED: EV.KILLED,
};

export interface InstalledEffect {
  soulId: number; name: string; trigger: string | null; code: string | null;
  kind: "DAMAGE_RAMP" | "ORB_START" | "ORB_TURN_START" | "HEALING" | "SHIELD" | "STATIC_BUFF" | "CUSTOM" | "UNSUPPORTED";
  params: Record<string, number>;
  note: string;
}

export interface InstallReport {
  installed: InstalledEffect[];
  unsupported: number;
  /** 累计触发次数（供测试与报告） */
  fireCount: Record<string, number>;
}

/**
 * 解析文案为可执行效果。**只认明确能解释的句式**，其余标 UNSUPPORTED。
 */
export function interpretEffect(ir: SoulEffectIR): { kind: InstalledEffect["kind"]; params: Record<string, number>; note: string } {
  const d = ir.desc;
  /**
   * ★★★ 第 93 轮：**这条降级必须排在最前面** —— 它以前排在最后，于是被前面的句式匹配抢先命中。
   *
   * 事实：地藏像的文案是「受到暴击时，自身100%、友方30%概率获得1回合护盾，能吸收10%生命上限的伤害」，
   * 而「护盾…」那条正则先一步匹配成功 ⇒ 它返回 SHIELD，**永远走不到下面那句 ON_CRIT 降级**。
   *
   * 后果不是"少算"，而是**两处口径互相矛盾**：`installSoulEffects` 有自己的 deadCode 判据
   * （挂在不派发的事件上 ⇒ UNSUPPORTED，第 90 轮加的），它照旧把地藏像报成 UNSUPPORTED；
   * 而网页索引走 interpretEffect，把同一件御魂报成 **FULL**。
   * 一条数据源、两种结论 —— 这正是本项目反复出现的那一类缺口，只是这次分裂在**判读与安装之间**。
   *
   * 发现方式：重建网页索引（`tools/build-kb-index.mjs`）之后，FULL 从 6 变成 7，
   * 而 g31/ui1/ui6 三条断言同时变红 —— 断言把"文件是旧的"和"生成器错了"这两种可能分开了。
   * 判据（tests/g31 第 [7] 节，双向）：同一段护盾文案，trigger=ON_CRIT ⇒ 必须 UNSUPPORTED；
   * trigger=ON_DEAL_DAMAGE ⇒ 必须是 SHIELD。**区别在触发时机能不能派发，不在文案。**
   */
  if (ir.trigger === "ON_CRIT") {
    return { kind: "UNSUPPORTED", params: {}, note: "「暴击时」触发：引擎没有暴击事件，该效果永远不会触发（针女 / 地藏像）" };
  }
  // 永久/持续增伤，含上限：如 无刀取 "永久提升15%的伤害，最高不超过45%"
  // ★ 火灵：「战斗开始时，获得3点鬼火」—— 对弈竞猜里的核心御魂之一，
  //   在此之前它落进 UNSUPPORTED，等于开局白送对手 3 点鬼火的差距根本不存在。
  const orbStart = d.match(/战斗开始时[，,]?\s*获得\s*(\d+)\s*点鬼火/);
  if (orbStart) return { kind: "ORB_START", params: { orbs: parseFloat(orbStart[1]) }, note: "战斗开始时为己方增加鬼火" };
  /**
   * ★ 招财猫：「回合开始时，有50%的概率获得2点鬼火。」
   *   竞猜里最常见的鬼火引擎之一，直接决定对局节奏。
   *   与火灵的差别：火灵是**必定**、战斗开始时；招财猫是**概率**、回合开始时。
   *   概率与点数都写在文案里，不依赖红区 —— 所以它可以实现。
   */
  const orbTurnStart = d.match(/回合开始时[，,]?\s*有\s*(\d+(?:\.\d+)?)\s*%\s*的?概率获得\s*(\d+)\s*点鬼火/);
  if (orbTurnStart) return { kind: "ORB_TURN_START", params: { chance: parseFloat(orbTurnStart[1]) / 100, orbs: parseFloat(orbTurnStart[2]) }, note: "持有者回合开始时按文案概率获得鬼火" };
  const ramp = d.match(/永久提升\s*(\d+(?:\.\d+)?)%\s*的伤害[，,]?\s*最高不超过\s*(\d+(?:\.\d+)?)%/);
  if (ramp) return { kind: "DAMAGE_RAMP", params: { perTurn: parseFloat(ramp[1]) / 100, cap: parseFloat(ramp[2]) / 100 }, note: "回合结束后累加增伤，封顶" };
  const flatRamp = d.match(/永久提升\s*(\d+(?:\.\d+)?)%\s*的伤害/);
  if (flatRamp) return { kind: "DAMAGE_RAMP", params: { perTurn: parseFloat(flatRamp[1]) / 100, cap: 1 }, note: "回合结束后累加增伤，无明确上限" };
  const heal = d.match(/(?:恢复|治疗)[^。]{0,20}?(\d+(?:\.\d+)?)%/);
  if (heal) return { kind: "HEALING", params: { ratio: parseFloat(heal[1]) / 100 }, note: "按描述触发治疗" };
  const shield = d.match(/护盾[^。]{0,24}?(\d+(?:\.\d+)?)%/);
  if (shield) return { kind: "SHIELD", params: { ratio: parseFloat(shield[1]) / 100 }, note: "按描述生成护盾" };
  // ★ 「暴击时」的降级已**移到函数最前面**（第 93 轮），原因见那里的注释：
  //   放在这里会被上面的「护盾…」正则抢先命中，于是地藏像被判成 SHIELD/FULL。
  //   事实不变：kernel/types.ts 的 EV 里没有 CRI/CRIT，ON_CRIT 映射到的 code 永远不存在，
  //   这两件御魂（针女、地藏像）的 4 件套战斗效果**一次都不会触发**。
  //   真正修好需要给 Battle 加暴击事件钩子，属于引擎功能，不在本轮范围。
  return { kind: "UNSUPPORTED", params: {}, note: "文案未匹配到可执行句式 —— 已登记但不参与计算" };
}

/**
 * 把御魂战斗效果装入 Battle。
 * 注意：这里**只碰战斗效果**，绝不改面板（竞猜模式下由 assertNoStaticDoubleCount 保证）。
 */
export function installSoulEffects(battle: any, refs: SoulEffectRef[], defs: Map<number, SoulDef>): InstallReport {
  const report: InstallReport = { installed: [], unsupported: 0, fireCount: {} };
  /**
   * ★★ 第 42 轮修：按 soulId **去重**。
   *
   * refs 是「每个穿戴单位一条」的扁平列表（10 只都穿同一件 → 10 条），
   * 而下面那个内层循环本身就会遍历**所有**穿戴单位。两者相乘 = N² 次注册：
   * 10 只都穿招财猫时，装配后 TURN_START 订阅者是 100（每只 10 个重复 handler），
   * 每个回合开始触发 10 次 —— 概率效果的期望被放大 10 倍。
   * 更糟的是这些重复 handler 的 id 完全相同（`${owner.id}:SOUL${soulId}:${code}`），
   * bus 的注册序号表被反复覆盖，排序信息也一并失真。
   *
   * 这个 bug 一直没被发现，是因为此前**所有** soul 测试都只给一个单位穿御魂
   * （refs.length === 1 时 N² === N，看不出差别）。招财猫是第一个「全队都穿」的用例。
   *
   * 去重后 installed 的含义也收紧了：从「ref 条数」变成「**本局有几种御魂战斗效果**」。
   */
  const seenSoul = new Set<number>();
  for (const ref of refs) {
    if (seenSoul.has(ref.soulId)) continue;
    seenSoul.add(ref.soulId);
    const def = defs.get(ref.soulId);
    if (!def) continue;
    const ir = compileSoulEffect(def);
    const custom = customSoulFor(ref.name);   // betting-only installers return null in BASE
    if (custom) {
      // Hand-written installer (soul/custom-effects.ts): registers its own handlers on each wearer.
      report.installed.push({
        soulId: ref.soulId, name: ref.name, trigger: ir.trigger, code: null,
        kind: "CUSTOM", params: {}, note: CUSTOM_SOUL_NOTES[ref.name] ?? "custom installer",
      });
      for (const team of battle.teams) {
        for (const owner of team.members) {
          if (owner.notes.every((n: string) => !n.includes(ref.name))) continue;
          custom({
            battle, owner, soulId: ref.soulId, name: ref.name,
            fired: key => { report.fireCount[key] = (report.fireCount[key] ?? 0) + 1; },
          });
        }
      }
      continue;
    }
    const code = ir.trigger ? TRIGGER_TO_EVENT[ir.trigger] ?? null : null;
    const { kind, params, note } = interpretEffect(ir);
    /**
     * ★★★ 第 90 轮：**挂在"永远不会被派发"的事件上的效果，不能算已安装。**
     *
     * 判据不是新造的：`DISPATCHED_EV_CODES` 是第 74 轮为被动运行时建的声明表，
     * 由 tests/g42 用生产者扫描**双向盯着**（少了红、多了也红）。
     * 这里复用它 —— 一处事实，两处消费。
     *
     * 实测抓到的那一条：地藏像（trigger=ON_CRIT → code=CRI，而 interpretEffect 给的是 SHIELD）。
     * 它此前被报成"已安装的护盾"，可 CRI 根本没有派发点 ⇒ handler 永远不会被调用。
     */
    const deadCode = !!code && !DISPATCHED_EV_CODES.has(code);
    const installed: InstalledEffect = {
      soulId: ref.soulId, name: ref.name, trigger: ir.trigger, code,
      kind: deadCode ? "UNSUPPORTED" : kind, params,
      note: deadCode
        ? "挂在事件 " + code + " 上，而该事件**没有派发点**（DISPATCHED_EV_CODES 里没有它）⇒ 处理器永远不会被调用。原判读：" + note
        : note,
    };
    report.installed.push(installed);
    if (kind === "UNSUPPORTED" || !code || deadCode) { report.unsupported++; }

    // 即便是 UNSUPPORTED 也注册 handler —— 保证"事件确实发生了"被记录，而不是当它不存在
    for (const team of battle.teams) {
      for (const e of team.members) {
        const owner = e;
        if (owner.notes.every((n: string) => !n.includes(ref.name))) continue;   // 只挂给带该御魂的单位
        /**
         * ★★★ 第 132 轮：**层数从实体身上已有的 Modifier 反推**，不再从 0 开始。
         *
         * 这个计数是**闭包状态**，不进 BattleState ⇒ 存档/续跑之后会从 0 重新叠——
         * 无刀取（每回合 +15%、上限 45%）最多再叠 3 层，"永久提升"变成了"续跑后又能涨一轮"。
         * 判据用它**自己写下去的那条 source**（\`soul<id>:stack<n>\`）：那本来就是"带来源、可整批回收"
         * 的来源标记，所以反推不需要新字段、也不会与别的 modifier 混淆。
         */
        let stacks = owner.effects.filter((x: any) => typeof x.source === "string" && x.source.startsWith("soul" + ref.soulId + ":stack")).length;
        // 层数上限 = 封顶 / 每层；这是**游戏规则决定的取整点**（不足一层即封顶），
        // 必须走 GameMath 而不是裸 Math.floor，以便日后统一替换取整模型。
        const maxStacks = kind === "DAMAGE_RAMP" && params.perTurn
          ? Math.max(1, GameMath.floorAt((params.cap ?? 1) / params.perTurn, "soul:DAMAGE_RAMP:maxStacks"))
          : 0;
        battle.bus.register({
          id: `${owner.id}:SOUL${ref.soulId}:${code ?? "NOCODE"}`,
          ownerId: owner.id,
          code: code ?? EV.TURN_END,
          range: "SELF",
          priority: 20,
          passive: false,
          source: "SOUL",   // ★ 第 96 轮：封印（御魂失效）按这个标记挡
          fn: (ctx: any) => {
            const key = `${ref.name}:${ir.trigger}`;
            report.fireCount[key] = (report.fireCount[key] ?? 0) + 1;
            // 叠层必须封顶：无刀取 每回合+15%、上限45% -> 最多 3 层，第 4 次起不再增加
            if (kind === "DAMAGE_RAMP" && stacks < maxStacks) {
              stacks++;
              // ★ 走 Modifier API：带来源、可审计、可按来源整批回收（a1-4 §7）
              // ★★ 第 43 轮修：这里原先是 dmgTakenB —— 那是**受击方**的字段，而且方向相反：
                //   无刀取的文案是「永久提升15%的伤害」，写进受击字段的结果是
                //   「携带者多挨最多 45% 伤害」。现在写源侧字段 dmgDealtB。
                owner.addModifier({ prop: "dmgDealtB", value: params.perTurn, mode: "FIXED", source: `soul${ref.soulId}:stack${stacks}` });
            }
            // ★ 火灵：开局 3 点鬼火。真改数值，不只是"登记过"。
            if (kind === "ORB_START") {
              const orbs = battle.teams[owner.teamId].orbs;
              const before = orbs.current;
              orbs.gain(params.orbs);
              /** ★ 第 120 轮：御魂路径的鬼火获得也进总线（与技能路径同一个事件码） */
              battle.queueEvent(EV.ORB_GAIN, { battle, team: owner.teamId, src: owner.id, skill: ref.name + "（4件套）" }, owner.id, owner.teamId);
              battle.trace.push({
                t: "ORB_GAIN", team: owner.teamId, src: owner.id, skill: ref.name + "（4件套）",
                requested: params.orbs, before, after: orbs.current, overflow: Math.max(0, before + params.orbs - orbs.current),
              });
            }
            /**
             * ★ 招财猫：持有者**回合开始时**按概率获得鬼火。
             *
             * 作用范围沿用既有约定（TURN_START 以 selfId = 行动者派发 + handler range = SELF）
             * → 只有「持有者自己的回合开始」才触发，与无刀取的 TURN_END 是同一条约定。
             * 这个读法**未实测**（属于 B 组候选），但它不是这一轮新猜的：引擎里回合触发类御魂一直这么做。
             * g32 有一条断言把这个语义钉死：触发机会数 ≈ 回合数，**不是** 10 × 回合数 ——
             * 若哪天改成「任意回合开始都给全场持有者触发」，那条断言会立刻红。
             *
             * 概率必须走 RNG 且带用途标签（a1-4 §20：每一次抽数都要能说清为什么抽）。
             */
            if (kind === "ORB_TURN_START" && ir.trigger === "TURN_START") {
              const tag = "soul:" + ref.name + ":turnStart";
              battle.rng.expect(tag);
              const hit = battle.rng.testHit(params.chance);
              const orbs = battle.teams[owner.teamId].orbs;
              if (hit) {
                const before = orbs.current;
                orbs.gain(params.orbs);
              /** ★ 第 120 轮：御魂路径的鬼火获得也进总线（与技能路径同一个事件码） */
              battle.queueEvent(EV.ORB_GAIN, { battle, team: owner.teamId, src: owner.id, skill: ref.name + "（4件套）" }, owner.id, owner.teamId);
                battle.trace.push({
                  t: "ORB_GAIN", team: owner.teamId, src: owner.id, skill: ref.name + "（4件套）",
                  requested: params.orbs, before, after: orbs.current,
                  overflow: Math.max(0, before + params.orbs - orbs.current),
                  probability: params.chance, roll: tag,
                });
              } else {
                // 没中也要留痕 —— 否则「50%」无法被验证，只看得见中的那些
                battle.trace.push({ t: "ORB_SOUL_MISS", team: owner.teamId, src: owner.id, skill: ref.name + "（4件套）", probability: params.chance, roll: tag });
              }
            }
            // ★ 蚌精：战斗开始时友方全体获得护盾（吸收生命上限 N%）
            if (kind === "SHIELD" && ir.trigger === "BATTLE_START") {
              for (const m of battle.teams[owner.teamId].aliveMembers()) {
                const value = m.maxHp * params.ratio;
                // ★ 同上：走内核唯一入口。id 由 addShield 生成（确定性），
                //   旧写法 `sh_soul<soulId>_<m.id>` 在同一个单位第二次拿到盾时会**撞 id**。
                m.addShield({ value, sourceId: owner.id, dispellable: false, tag: "soul" + ref.soulId });
                battle.trace.push({ t: "SHIELD_APPLY", src: owner.id, dst: m.id, value: GameMath.display(value), skill: ref.name + "（4件套）" });
              }
            }
          },
        });
      }
    }
  }
  return report;
}
