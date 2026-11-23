// compile/character.ts — 纯函数式单位装配（零 fs / 零 Node API）
// 为什么要拆出来：同一份装配逻辑必须能同时在 **Node 测试** 与 **浏览器 Worker** 里跑，
// 否则 Web 端的技能/AI 行为会与测试基线悄悄漂移。数据来源由调用方注入。
import { Entity, EntityType, OnmyojiSystem } from "../kernel/entity.ts";
import { DamageType, EV } from "../kernel/types.ts";
import { compileSkill, probOf, durationOf, stacksOf, capOf, targetModeOf, isAllyScoped } from "./skill-compiler.ts";
import type { SkillIR, EffectSlotFilter } from "./skill-compiler.ts";
import { applySkillOverrides } from "./skill-overrides.ts";
import { applyMaxLevel } from "./max-level.ts";
// Betting-mode (MAX) shikigami mechanics: 金鱼姬 / 饭笥 / per-hit random targets (see the module header)
import { bettingMechanicsActive, bettingDamageHook, bettingAfterCast, bettingGate, bettingPreferredSkill, resolveRuleSkill, bettingCostOf, aiRuleTarget } from "./betting-mechanics.ts";
import { noteKbBaseAtk } from "./betting-shared.ts";
import { compileBuff, toStatusDef } from "./buff-compiler.ts";
import { compileAI } from "./ai-compiler.ts";
import type { AIProfileIR, AICtx } from "./ai-compiler.ts";
import { StatusBook, findImmuneStatus, controlDefByTipName } from "../kernel/status.ts";
import { rollStatusContest, reportResist } from "../kernel/resist.ts";
// ★★★ 第 194 轮：「随机增益 / 随机减益」池子（见 kernel/random-pool.ts）
import { poolEntryDef } from "../kernel/random-pool.ts";
// ★ 第 246 轮：「失去 X 时结束 Y」的监视器（主动技能在**施放点**安装；与被动侧共用一份实现）
import { installEndOnLose } from "../kernel/end-on-lose.ts";
import { applyStatSteal, stealBuff } from "../kernel/steal.ts";
import { enterForm } from "../kernel/summon.ts";
// ★ G1 起，技能释放的每一个子步骤（扣火/护盾/拉条/上状态）都要在 trace 里可见，
//   显示口径统一走 GameMath（唯一取整入口），因此这里需要它。
import { GameMath } from "../kernel/gamemath.ts";
import { createField, entityInField, fieldRemaining } from "../kernel/field.ts";
// ★ 第 141 轮：叠层场地（花海）的主动得层 —— 只在机制在场时给（见下面的注释）
import { grantLayers, layerFieldActive, layerHpRatio } from "../kernel/layer-field.ts";

/**
 * ★★★ 第 176 轮：**从事件载荷里取「伤害来源」**（逐句承受者归属的执行侧入口）。
 *
 * 三个触发点，三条路径 —— 全部由第 175 轮的探针实测过（tests/g98-source-bearer-plan.ts 第 [3] 节）：
 *   · BEFORE_DAMAGE / AFTER_DAMAGE：载荷是 `{ input: { source, target } }` ⇒ `ctx.input.source`；
 *   · 其余带来源的事件：`ctx.source`（形如状态/护盾事件的自定义载荷）；
 *   · DEATH：载荷是 `{ target, killerId }` ⇒ 按 id 找**击杀者**（这就是原文说的"伤害来源"）。
 * ★ fail-closed：一条都取不到就返回 null —— 调用方**不施加**并留痕，绝不退回"随机敌人"（那是算错）。
 */
/**
 * ★★★ 第 195 轮：**「就地读出来的效果」的施加核心**（随机池子 / 控制占位符共用这一份）。
 *
 * 为什么要有它：这两族效果都不是 `[buff_x]` 引用，认出来的时候已经带着"该加什么、几回合、几成概率"，
 *   所以它们走的是"合成一个状态定义再施加"这条路。第一条（池子，第 194 轮）当时自己写了一遍概率/免疫/落痕，
 *   第二条（控制占位符，第 195 轮）再抄一遍就成了三份 —— 于是抽出来，**判据只留一份**：
 *   · 概率：原文写了就掷（100% 也掷 —— 与状态那一段同一条口径），标签进 RNG 账本；
 *   · 免疫：`findImmuneStatus`（与状态那一段同一个入口 —— 红区 G 的口径也在这里生效）；
 *   · 定义进 StatusBook（跨进程恢复要用），施加走 `Entity.addStatus`（唯一的施加点）。
 * ★ 与状态那一段（`x.statusRefs` 的循环）的分工：那一段还要处理抵抗档（SINGLE_ROLL_RATIO /
 *   COMMUNITY_TWO_ROLL）、层数、层数上限、时长冲突 —— 那些信息在 `[buff_x]` 的描述里；
 *   合成状态这条路没有那些输入，所以**默认档（NONE）下两条路的判定逐位一致**，
 *   差别只在抵抗档：见报告 §167 写明的边界。
 */
export async function applySyntheticStatus(battle: any, self: Entity, victim: Entity, o: {
  def: any; dur: number; count: number; effects: Array<{ prop: string; value: number; mode: any }>;
  probability: number | null; probTag: string; missTrace: string; ref: string;
  extra: Record<string, any>; skill: string;
}): Promise<void> {
  if (!victim?.alive) return;
  // Same contest as the [buff_x] status section (kernel/resist.ts): NONE ⇒ the historical roll only when a
  // chance is written; a resist policy also contests 100% enemy controls and reports RESIST (EV.RESIST).
  const written = o.probability !== null && o.probability !== undefined ? Number(o.probability) / 100 : null;
  const contest = rollStatusContest(battle, self, victim, o.def, written, o.probTag, "resist:" + o.probTag);
  if (contest.outcome === "MISS") {
    battle.trace.push({ t: o.missTrace, src: self.id, dst: victim.id, probability: o.probability, skill: o.skill, ...o.extra,
      ...(contest.single ? { effective: contest.effective, efh: contest.efh, efr: contest.efr } : {}) });
    return;
  }
  if (!StatusBook.has(o.def.id)) StatusBook.set(o.def.id, o.def);
  if (contest.outcome === "RESIST") {
    await reportResist(battle, self, victim, o.def, contest, { probability: o.probability, duration: o.dur, ref: o.ref, skill: o.skill });
    return;
  }
  const imm = findImmuneStatus(victim, o.def, battle.policies?.immune?.debuffCoversControl ?? true);
  if (imm) {
    battle.trace.push({
      t: "IMMUNE", src: self.id, dst: victim.id, status: o.def.id, name: o.def.name,
      by: imm.def.id, kind: imm.kind, consumed: imm.consumed, ref: o.ref, skill: o.skill,
    });
    return;
  }
  const applied = victim.addStatus(o.def, self.id, o.count, o.dur, o.effects, null);
  battle.trace.push({
    t: "STATUS_APPLY", src: self.id, dst: victim.id, status: o.def.id, name: o.def.name,
    category: o.def.category, duration: o.dur, ref: o.ref, known: true,
    tag: (applied as any)?.tag ?? null, skill: o.skill,
  });
}

export function damageSourceOf(battle: any, ctx: any): Entity | null {
  const direct = ctx?.input?.source ?? ctx?.source ?? null;
  if (direct) return direct;
  const k = ctx?.killerId;
  if (k === null || k === undefined) return null;
  return battle?.allEntities?.().find((e: any) => e.id === k) ?? null;
}

/** 经典四阴阳师对应的御灵（社区通说；名称来自 2020 老 xlsx 的"御灵"稀有度 4 条：神龙/白藏主/孔雀/黑豹） */
export const GUARDIAN_OF: Record<number, string> = { 10: "神龙", 11: "孔雀", 12: "黑豹", 13: "白藏主" };

export interface LoadedChar { entity: Entity; ir: SkillIR[]; ai: AIProfileIR; meta: any; issues: string[] }

/**
 * ★★★ 第 130 轮：**把"只写在技能原文里"的能力位落到单位上**（目前只有一项：无法被治疗/恢复）。
 *
 * 为什么必须是**共用助手**而不是写在 buildCharacter 里：竞猜口径的单位是
 *   soul/guessing-factory.ts 的 makeGuessingEntity 造的，装配时只把 **skills** 拷过去
 *   （apps/web/src/engine/assemble.ts）—— 能力位写在 buildCharacter 的实体上会**静默丢掉**。
 *   探针 tools/_probe-noheal130.ts 实测：buildCharacter 出来的单位 receivesHeal=false，
 *   而装配进对局之后又变回 true（同一个 IR、两个实体，能力位只落在其中一个上）。
 *
 * @returns 实际落地的能力位（供调用方留痕；空数组 = 这条技能没有能力位）
 */
export function applyIrCapabilities(e: Entity, ir: SkillIR[]): string[] {
  const applied: string[] = [];
  const nh = ir.map((x: SkillIR) => x.noHeal).find(Boolean);
  if (nh) {
    e.caps.receivesHeal = false;
    e.notes.push("noHeal:" + nh.clause);
    applied.push("NO_HEAL");
  }
  return applied;
}

/**
 * 由**已解析的数据**装配一个可运行单位。
 * @param s       shikigami.full.json 里的一条记录
 * @param aiRecord ai.json 里对应的一条（可为 undefined → AI 编译为 LOW 置信度）
 * @param omyProfile onmyoji-ai.json 里的对应条目（阴阳师才需要）
 * @param buffs   compileBuff 之后的 buff 表
 */
export function buildCharacter(
  s: any, aiRecord: any, omyProfile: any, buffs: Map<string, any>, teamId: number, entId: number,
): LoadedChar {
  const issues: string[] = [];

  const panel = s.panel ?? { atk: 1000, hp: 10000, def: 300, spd: 100, cri: 0.05, crid: 1.5, efh: 0, efr: 0 };
  noteKbBaseAtk(Number(s.id), s.panel?.atk);   // read only by betting-mode "X% ATK" buffs (no state change)
  const e = new Entity(entId, s.name, teamId, {
    atk: panel.atk, hp: panel.hp, def: panel.def, spd: panel.spd,
    cri: panel.cri ?? 0.05, crid: panel.crid ?? 1.5, efh: panel.efh ?? 0, efr: panel.efr ?? 0,
    dmgTakenB: 0, dmgTakenD: 0, healDown: 0,
  });
  e.notes.push("rarity=" + (s.rarity ?? "?") + " year=" + (s.year ?? "?"));

  // 阴阳师 / 英杰：不占式神位，且属性来源与式神不同（依 grade 字段分流，不做猜测）
  // 品阶来源：shikigami.full.json 里是 rarity（来自 Data:CharacterIndex.json），
  // 原始文档里是 grade。两处都要看，避免因字段改名而静默失效。
  const gradeRaw = String(s.gradeRaw ?? s.grade ?? s.rarity ?? "");
  if (gradeRaw === "阴阳师" || gradeRaw === "英杰") {
    e.type = EntityType.ONMYOJI;
    const isClassic = gradeRaw === "阴阳师";
    const hasPanel = !!(s.panel && s.panel.atk !== undefined);
    e.onmyoji = {
      system: isClassic ? OnmyojiSystem.CLASSIC_GUARDIAN : OnmyojiSystem.CLAN_HERO,
      gradeRaw,
      guardian: isClassic ? { name: GUARDIAN_OF[s.id] ?? "未知", level: null, stats: null } : null,
      statsSource: hasPanel ? "GUARDIAN" : "NONE",
      statsConfidence: hasPanel ? "MEDIUM" : "NONE",
      aiAvailable: (omyProfile?.castPriority?.length ?? 0) > 0,
      notes: [
        isClassic ? "CLASSIC_GUARDIAN：面板应由御灵养成决定" : "CLAN_HERO：独立体系，无御灵模型",
        hasPanel ? "面板来自第三方（带 confidence），非权威" : "无任何属性面板来源（灰机 stats 为空对象）",
      ],
    };
    e.notes.push("onmyoji:" + e.onmyoji.system + " guardian=" + (e.onmyoji.guardian?.name ?? "-"));
  }

  // Max skill level (compile/max-level.ts) first, then hand-reviewed corrections
  // (compile/skill-overrides.ts) win. Both run before executors capture the IR.
  const compiled: SkillIR[] = (s.skills ?? []).map((sk: any) => compileSkill(s.id, s.name, sk));
  const ir: SkillIR[] = applySkillOverrides(applyMaxLevel(compiled));
  /**
   * ★★★ 第 130 轮：**「无法被治疗或[恢复]生命」是能力位，不是状态**（KB：百羽凤凰火「未熄羽」）。
   *   判据取自**编译产物**（SkillIR.noHeal），不在这里重扫文本 —— 一处解析，一处消费。
   *   ★ 为什么必须在装配时定下：能力位跟着单位进 state（EntityCapabilities 整体序列化），
   *     而"谁不能治疗"只写在技能原文里，运行时没有别的入口能知道。
   *   ★ 留一条 note：能力位是**存档字段**的一部分，而"它为什么是 false"必须能一眼看出来。
   */
  applyIrCapabilities(e, ir);
  const skillNames = ir.map((x: SkillIR) => x.name);
  const ai = omyProfile?.castPriority?.length
    ? compileAI(s.id, s.name, { cast: omyProfile.castPriority, target: omyProfile.target }, skillNames)
    : compileAI(s.id, s.name, aiRecord, skillNames);
  if (!s.panel) issues.push("缺属性面板，使用默认值");
  for (const x of ir) if (x.confidence === "LOW") {
    // 区分「纯被动（本来就没有可执行数值）」与「主动技能没解析出来」——
    // 前者是数据事实，后者才是模型缺口。混在一起报会让真正的缺口被噪音淹没。
    // 三分类，把「数据事实」与「模型缺口」分开，缺口才配 WARN：
    //   被动技能（cost < 0）      —— 引擎没有触发条件模型，属已知边界
    //   已解析出可执行数值        —— 数值能用，但描述里还有未建模的附加效果
    //   主动技能且什么都没解析出  —— 真缺口
    const parsedSomething = x.damage.length || x.heal.length || x.shield.length
      || x.timeline.length || x.statusRefs.length || x.orb.gain > 0;
    const kind = x.cost < 0 ? "被动技能，引擎未建模其触发条件"
      : parsedSomething ? "已解析出可执行数值，但描述中仍有未建模的附加效果"
      : "主动技能未解析出任何可执行数值";
    issues.push("技能「" + x.name + "」编译置信度 LOW（" + kind + "）");
  }
  if (ai.confidence === "LOW") issues.push("AI 编译置信度 LOW");

  // 技能运行时
  e.skills = ir.map((x: SkillIR, idx: number) => ({
    name: x.name, cost: x.cost, ir: x, selectable: true, index: idx,
    pickTarget: (battle: any, self: Entity, enemies: Entity[]) => {
      const tr = ai.targetRules.find(t => t.skill.index === idx);
      const mode = targetModeOf(x);
      // ★ 候选名单必须按技能的**作用范围**取。此前无论技能写的是"友方单位"还是"敌方单位"，
      //   传进去的都是敌人列表 —— 于是「优先选择没有护盾的友方单位」这类规则选中的是敌人，
      //   护盾于是被加到对面身上（方向性错误，比"选错人"严重得多）。
      // ★★ 主动复活技能的候选是**阵亡的队友**（第 67 轮）——活人名单里没有他们要救的人。
      const allies = x.revive
        ? battle.teams[self.teamId].members.filter((m: Entity) => m.dead)
        : battle.teams[self.teamId].aliveMembers().filter((m: Entity) => m.id !== self.id);
      const cands = isAllyScoped(mode) ? (mode === "SELF" ? [self] : (allies.length ? allies : [self])) : enemies;
      const ctx: AICtx = mkCtx(battle, self, enemies);
      /** Betting mode (MAX only): in-game target rules that replace the KB rule (compile/betting-ai-rules.ts). */
      const bPick = bettingMechanicsActive() ? aiRuleTarget(self, x, cands) : null;
      const picked = bPick ? bPick.target : (tr && tr.selector) ? tr.selector(ctx, cands) : undefined;
      const chosen = picked ?? cands[0] ?? enemies[0];
      // ★ G5：目标选择的依据也要留痕（"为什么打的是他"）
      if (battle?.trace) battle.trace.push({
        t: "AI_TARGET", actor: self.id, skill: x.name,
        mode, pool: isAllyScoped(mode) ? "ALLY" : "ENEMY",
        rule: bPick ? bPick.rule : tr?.ruleRaw ?? null, applied: !!picked,
        candidates: cands.map((e: Entity) => e.id), chosen: chosen?.id ?? null,
        note: picked ? undefined
          : tr?.ruleRaw ? "该技能的 AI 目标规则存在但没有可用候选 → 取候选名单第一个"
          : "该技能没有目标规则 → 按技能原文的范围取候选名单第一个",
      });
      return chosen;
    },
    /**
     * ★★★ 第 176 轮：多了第四个入参 `ctx`（事件载荷）。被动运行时一直传它（`sk.execute(battle, e, target, ctx)`），
     *   而这里此前只有三个形参 —— 于是"这一句是被哪个事件触发的、来源是谁"在执行点里**根本看不到**，
     *   逐句承受者归属也就无从谈起。主动施放路径不传 ⇒ `ctx === undefined` ⇒ 走 fail-closed 分支。
     */
    execute: async (battle: any, self: Entity, target: Entity, ctx?: any, opts?: { statusOnly?: string[]; onlyStatusSlots?: number[]; onlyEffectSlots?: EffectSlotFilter; onlyPoolSlots?: number[]; onlyControlSlots?: number[]; free?: boolean }) => {
      self.usedSkills.add(x.name);
      /**
       * ★★★ 第 177 轮：**statusOnly 模式**（只施加指定的那几个状态引用，别的效果一概不做）。
       *
       * 为什么需要它：有些技能**同时**是主动技能、又写着一条被动的反击子句 ——
       *   鸩「毒之华」（cost=2）：「受到攻击时，为攻击者附加1层[buff_2852_1]」。
       *   第 176 轮把"承受者＝伤害来源"接通之后，这一句只差一个**装配点**（被动运行时不收 cost ≥ 0 的技能）。
       *   但直接调 execute 会把这门技能**整套再放一遍**（伤害 / 治疗 / 护盾 / 拉条 / 鬼火）——
       *   那就成了"挨一下打就白送一发大招"，是**多算**。所以这里给一个只跑状态那一段的模式。
       *
       * 口径：状态那一段的逻辑**一个字都不复制**（概率 / 抵抗 / 免疫 / 层数 / 上限 / 时长 / 事件 / RNG 标签全部走原路），
       *   只是把别的分节挡在外面、并把状态引用收窄到调用方点名的几个。
       */
      const statusOnly: string[] | null = opts?.statusOnly ?? null;
      /**
       * ★★★ 第 188 轮：**逐句效果归因的第二批** —— damage / heal / shield / timeline 四族按句收窄。
       *
       * 与 onlyStatusSlots 是同一件事的另外四个字段（第 181 轮立的规矩）：被动运行时触发的是**一句**，
       *   而 execute 跑的是**整门技能** —— 不过滤就会把隔壁子句的效果也一起放出去（多算）。
       * 语义与失败方向都与 onlyStatusSlots 一致：调用方按证据算好。
       *   · 传了某一族 ⇒ **严格按证据**：只做属于这一句的槽位（可能是空数组 = 这一句不做这一族）；
       *   · 没传某一族 ⇒ 照旧全放（没有证据，与今天逐位相同）。
       * 实测（tools/_probe-attrib188f.ts）：27 条装上的被动触发句里 **16 条**会因此改变行为，全部是**去掉多算**。
       */
      const onlyEffects: EffectSlotFilter = opts?.onlyEffectSlots ?? {};
      const team = battle.teams[self.teamId];
      // ★★ 作用范围：一个技能打谁、给谁加，由**技能原文**决定，不是由"AI 选了谁"决定。
      //   这一层此前完全不存在：群攻打 1 个、友方技能丢给敌人、推条推的是自己。
      const mode = targetModeOf(x);
      const allyPool = team.aliveMembers();
      const enemyPool = battle.enemiesOf(self.teamId);
      const primary = target?.alive ? target : (isAllyScoped(mode) ? (allyPool[0] ?? self) : (enemyPool[0] ?? target));
      /**
       * 伤害/减益的承受者。**永远指向敌人** —— 这是一条硬不变量：
       * 一个技能即使被判成"自身/友方"范围（如「自身获得护盾」），它的伤害也绝不该落到队友身上。
       * 反过来，友方范围且没有伤害的技能，承受者就该是**空集**，而不是"随便挑一个"。
       */
      /** Betting mode (MAX only): skills whose damage loop is replaced (targets are chosen per hit). */
      const bettingDmg = !statusOnly && !onlyEffects.damage && bettingMechanicsActive() ? bettingDamageHook(x, mode) : null;
      const hurt: Entity[] = bettingDmg ? []
        : x.damage.length === 0 && isAllyScoped(mode) ? []
        : mode === "ENEMY_ALL" ? uniq([primary, ...enemyPool])
        : mode === "ENEMY_RANDOM" ? [battle.rng.pick(enemyPool) ?? primary]
        : isAllyScoped(mode) ? [enemyPool[0] ?? primary]
        : [primary];
      /**
       * ★★ 主动复活（第 67 轮）：**先**把阵亡的队友拉起来，**再**走原来的治疗循环。
       *   顺序不能反 —— heal 循环里有 `if (!m.alive) continue`，
       *   复活之后那次治疗才会落在被复活的人身上（原文写的就是「复活…并为其治疗 N%」）。
       *   `battle.revive(m, 1)`：先以 1 点血复活，随后的治疗把它抬到 N% —— 合计就是原文的 N%。
       *   （内核的 revive 早已备好：它检查 dead / reviveBlocked / transformed，并补记 REVIVE 事件、
       *   把单位重新加回行动条；checkVictory 也已经是全函数，支持"打死 → 复活 → 继续打"。）
       */
      let revived: Entity[] = [];
      if (!statusOnly && x.revive) {
        const dead = team.members.filter((m: Entity) => m.dead);
        const picked = dead.find((m: Entity) => m.id === target?.id);
        const want = x.revive.scope === "ALL" ? dead : (picked ? [picked] : dead.slice(0, 1));
        for (const m of want) if (await battle.revive(m, 1)) revived.push(m);
      }
      /** 治疗/护盾/增益的承受者 */
      const aid: Entity[] = x.revive ? revived
        : mode === "ALLY_ALL" ? allyPool
        : mode === "SELF" ? [self]
        : mode === "ALLY_ONE" ? [primary && allyPool.includes(primary) ? primary : self]
        : [self];
      // ★★★ 第 177 轮：statusOnly 模式下，**非状态的所有分节**都不执行（复活已单独挡在上面）。
      if (!statusOnly) {
      /** Betting mode (MAX only): effective onibi cost (鲸汐千姬's illusion: -1, minimum 0). BASE: x.cost. */
      const cost = bettingMechanicsActive() ? bettingCostOf(battle, self, x) : x.cost;
      if (battle?.trace) battle.trace.push({
        t: "TARGET_SCOPE", actor: self.id, skill: x.name, mode,
        hurt: hurt.map(e => e.id), aid: aid.map(e => e.id),
      });
      // ★ G1：技能释放本身必须是一个**可见事件**（a1-4 §16 Action Banner）。
      //   以前这里什么都不记，Theater 只能看到零散的伤害数字，不知道是谁放了什么。
      battle.trace.push({
        t: "SKILL_CAST", actor: self.id, skill: x.name, cost, target: target.id, hits: Math.max(1, x.hits),
        /**
         * ★★★ 第 252 轮：分段形状的技能，**一次施放不止一种次数** —— 只报 `hits`（首段）会让 Theater 的横幅
         *   比产物乐观（262_03 写「3 次」而实际是 3 次全体 + 1 次单体）。有分段时把它一并留痕。
         */
        ...(Array.isArray((x as any).damageSegments) && (x as any).damageSegments.length >= 2
          ? { segments: (x as any).damageSegments.map((g: any) => g.hits + "x" + g.ratio + "%/" + (g.scope === "ENEMY_ALL" ? "全体" : "单体")) }
          : {}),
      });
      if (cost > 0 && !opts?.free) {   // ★ 第 237 轮：免消耗施放跳过整段付费（含"鬼火不足退回普攻"）
        if (!team.orbs.canPay(cost)) {
          const basic = self.skills.find((sk: any) => sk.cost === 0);
          // ★ G1：这是一次**技能调用技能**的直接递归（鬼火不足退回普攻）。
          //   以前它是隐形的；现在既留事件，也让 Theater 能看到"为什么这次放的是普攻"。
          battle.trace.push({
            t: "SKILL_FALLBACK", actor: self.id, skill: x.name, reason: "ORB_SHORT",
            need: cost, have: team.orbs.current, fallback: basic?.name ?? null,
          });
          if (basic && basic.index !== idx) await basic.execute(battle, self, target);
          return;
        }
        const before = team.orbs.current;
        team.orbs.pay(cost, "orb", "COST");
        /** ★★★ 第 120 轮：ORB_COST 的派发点（技能付费那一刻）。trace 里这条叫 ORB_PAY，事件码叫 ORB_COST ——
         *  两个名字指同一件事，统一到 EV 表的名字上，避免又出现「码与标签对不上」的账。 */
        battle.queueEvent(EV.ORB_COST, { battle, team: self.teamId, actor: self.id, skill: x.name, amount: cost, before, after: team.orbs.current }, self.id, self.teamId);
        battle.trace.push({ t: "ORB_PAY", team: self.teamId, actor: self.id, skill: x.name, amount: cost, before, after: team.orbs.current });
      }
      /**
       * ★★★ 第 136 轮：**额外推进鬼火行动条**（KB：流光追月神「绮罗舞」——「自身回合结束后额外推进3格鬼火行动条
       *   并使全体友方获得2层[buff_3952_1]」）。
       *
       * 位置：付费之后、伤害/状态之前 —— 原文把"推进鬼火条"写在最前面（「…额外推进3格…**并**使全体友方获得…」）。
       * ★ 这一句此前**只做了一半**：buff 发了、鬼火条没推（IR 里根本没有接它的字段，见 SkillIR.orbGaugeAdvance 的注）。
       *   追月神「明月潮生」更彻底 —— 它的整条被动就只有这半句，所以连"可执行面"都没有、一直装不上。
       */
      if ((x as any).orbGaugeAdvance > 0) {
        battle.advanceOrbGauge(self.teamId, (x as any).orbGaugeAdvance, "SKILL:" + x.name, self.id);
      }
      // 伤害：**逐目标**结算（多段 hit 逐段结算，目标死了就跳过它，不影响其它目标）
      // ★★★ 第 188 轮：逐句归因 —— 触发的是哪一句，就只做属于那一句的伤害槽位（见 onlyEffects 的注）
      /**
       * ★★★ 第 252 轮：**分段伤害形状**（`SkillIR.damageSegments`）—— 一次施放里"先 N 次单体、最后 1 次全体"这类两段形状。
       *
       * 此前只有一条展开式：`damage 槽数 × hits × 受击人数` —— 于是"次数"被同时套到了单体段和全体段上
       *   （实测：281_03 一次施放 50 条伤害事件、262_03 30 条、331_03 15 条、375_03 20 条）。
       * 判据全在编译侧（skill-compiler.ts 的六条闸门），这里只按段展开；**没有这个字段的技能走下面的原路，逐位不变**。
       * ★ 两道 fail-closed：① 只有段落数 ≥ 2 才走新路（1 段等于旧行为，没必要绕）；
       *   ② 一旦调用方按句收窄过伤害槽位（`onlyEffects.damage`，第 188 轮的逐句归因），**一律回旧路** ——
       *      那一侧的语义是"只做属于这一句的槽位"，与"分段"叠加会互相打架。
       */
      if (bettingDmg) await bettingDmg.run(battle, self, hurt, primary);
      const segs: any[] | null = (!bettingDmg && !onlyEffects.damage && Array.isArray((x as any).damageSegments) && (x as any).damageSegments.length >= 2)
        ? (x as any).damageSegments : null;
      if (segs) {
        for (let gi = 0; gi < segs.length; gi++) {
          const g = segs[gi];
          /** 这一段用哪一条槽：按比例找（找不到就退回第一条 —— 编译侧的第五条闸门已保证找得到） */
          const slot = x.damage.find((d: any) => Number(d.ratio) === Number(g.ratio)) ?? x.damage[0];
          /** 这一段的承受者：范围由**原文**决定（与技能级 mode 同一套规则，只是逐段算） */
          const segHurt: Entity[] = g.scope === "ENEMY_ALL" ? uniq([primary, ...enemyPool]) : [primary];
          for (let h = 0; h < Math.max(1, g.hits); h++) {
            await battle.withinResolution({ id: "HIT:" + x.name + "#" + (gi + 1) + "." + (h + 1), type: "HIT" }, async () => {
              for (const victim of segHurt) {
                if (!victim.alive) continue;
                await battle.damage(self, victim, self.prop("atk") * (((slot as { ratioMax?: number }).ratioMax ?? slot.ratio) / 100), slot.type, 1, x.lifesteal ?? null);
              }
            });
          }
        }
      }
      for (let di = 0; di < (segs || bettingDmg ? 0 : x.damage.length); di++) {
        if (onlyEffects.damage && !onlyEffects.damage.includes(di)) continue;
        const d = x.damage[di];
        for (let h = 0; h < Math.max(1, x.hits); h++) {
          // ★ a1-4 §31：每一段是一次 HIT resolution —— 规格问的就是
          //   「被动/死亡什么时候插入：Hit 2 后立即，还是技能全部结束后」。
          //   现在这个问题有了可观测的边界（scope 进事件链），换策略只改这里。
          await battle.withinResolution({ id: "HIT:" + x.name + "#" + (h + 1), type: "HIT" }, async () => {
            for (const victim of hurt) {
              if (!victim.alive) continue;
              // ★★★ 第 93 轮：技能自带的吸血随**每一段伤害**一起进去（逐段结算，见 policies.lifesteal）。
              await battle.damage(self, victim, self.prop("atk") * (((d as { ratioMax?: number }).ratioMax ?? d.ratio) / 100), d.type, 1, x.lifesteal ?? null);
            }
          });
        }
      }
      /**
       * ★★★ 第 255 轮：**失血**（`SkillIR.selfHpLoss`，官方[21]「失去」≠ 伤害）。
       *
       * 位置照原文：这一句写在伤害之后（「攻击…，**然后**失去50%最大生命值」）。
       * 走内核的 `battle.lose` → `loseHp`：不暴击、**不被护盾吸收**、不触发受到伤害相关效果，
       * 留 `HP_LOSS` 痕迹与 `EV.HP_LOSS` 事件（与 damage 是两条管线，不是同一条加了参数）。
       * ★ 它不受"按句收窄"那一族影响（`onlyEffects` 只管 damage/heal/shield/timeline 四族）——
       *   但整段仍在 `if (!statusOnly)` 里：只施加状态的那种调用**不会**顺手扣血。
       */
      if ((x as any).selfHpLoss) {
        const loss = self.maxHp * (Number((x as any).selfHpLoss.ratio) / 100);
        if (loss > 0) battle.lose(self, loss);
      }
      // 治疗：给**该给的人**（此前无视范围，永远只治疗自己）
      // ★★★ 第 188 轮：同上 —— 按句收窄（治疗槽位）
      for (let hi = 0; hi < x.heal.length; hi++) {
        if (onlyEffects.heal && !onlyEffects.heal.includes(hi)) continue;
        const hl = x.heal[hi];
        for (const m of aid) {
          if (!m.alive) continue;
          const hlRatio = (hl as { ratioMax?: number }).ratioMax ?? hl.ratio;
          const amt = hl.base === "maxHp" ? self.maxHp * (hlRatio / 100) : self.prop("atk") * (hlRatio / 100);
          const appliedHeal = await battle.heal(self, m, amt, { crit: false });
          /**
           * ★★★ 第 249 轮：**治疗溢出转护盾**（IR 的 overflowShield；蝴蝶精「祈愿之舞」241_03）。
           *   溢出量 = 申请量 − 实际治疗量（`healTarget` 的返回值就是实际治疗量）⇒ 目标满血时溢满、残血时按差额。
           *   与普通护盾走**同一个内核入口**（第 57 轮收口的 `Entity.addShield`）与同一条 SHIELD_APPLY 痕迹。
           *   ★ 边界：原文的「持续2回合」暂不执行（护盾没有时长载体，见 IR 字段注）—— 只记事实，不假装。
           */
          const ofs = (x as any).overflowShield;
          if (ofs && Number(appliedHeal) < amt) {
            const value = self.maxHp * (Number(ofs.ratio) / 100);
            m.addShield({ value, sourceId: self.id, dispellable: true, tag: x.id });
            battle.trace.push({ t: "SHIELD_APPLY", src: self.id, dst: m.id, value: GameMath.display(value), base: "selfMaxHp", ratio: Number(ofs.ratio), skill: x.name, reason: "HEAL_OVERFLOW", overflow: GameMath.display(amt - Number(appliedHeal)) });
          }
        }
      }
      // 护盾：同样按范围（此前挂到 AI 选的"目标"上 —— 对友方技能而言那就是敌人）
      // ★★★ 第 188 轮：同上 —— 按句收窄（护盾槽位）
      for (let shi = 0; shi < x.shield.length; shi++) {
        if (onlyEffects.shield && !onlyEffects.shield.includes(shi)) continue;
        const sh = x.shield[shi];
        // ★★★ 第 80 轮：护盾基准此前**完全没有被读** —— 一律 `self.maxHp * ratio`。
        //   而实测 24 条护盾里 9 条原文写的是「吸收**攻击**N%伤害」或「吸收N%**已损失生命**的伤害」，
        //   于是「吸收攻击150%伤害」被按鲤鱼精的**生命上限**算 —— 量级完全不对。
        //   取值与 damage/heal 的 base 同一套（lostHp 在 damage 里早已存在）。
        const shRatio = (sh as { ratioMax?: number }).ratioMax ?? sh.ratio;
        const value = sh.base === "atk" ? self.prop("atk") * (shRatio / 100)
          : sh.base === "lostHp" ? Math.max(0, self.maxHp - self.hp) * (shRatio / 100)
          : self.maxHp * (shRatio / 100);
        for (const m of aid) {
          // ★ 走内核的唯一入口（第 57 轮）。此前是 "sh_" + x.id + "_" + h0()，而 h0() = Math.random()
          //   —— 护盾 id 会进 stateHash，于是同一份输入两次运行的指纹对不上。
          // ★ 第 85 轮：把「最多抵挡该次伤害的N%」传下去（没写就不传 → 不设上限）
          m.addShield({ value, sourceId: self.id, dispellable: true, tag: x.id, ...(sh.perHitRatio !== undefined ? { perHitRatio: sh.perHitRatio } : {}) });
          battle.trace.push({ t: "SHIELD_APPLY", src: self.id, dst: m.id, value: GameMath.display(value), base: sh.base, ratio: sh.ratio, skill: x.name });
        }
      }
      /**
       * ★★★ 第 141 轮：**叠层场地的主动得层**（血之花海「获得2层花海，若生命比例低于50%，再获得1层花海」）。
       *
       * 判据两向：
       *   · 规格来自本技能自己的 `grantLayers`（无条件那部分 + 条件那部分，逐句解析见编译器）；
       *   · 但**只有机制在场时才给层**（layerFieldActive）—— 机制由被动运行时装配（默认 OFF），
       *     不装的时候留下一个"什么都不做的计数器"比不给更坏（它进存档、进指纹，读起来像机制在跑）。
       * 层数上限由 kernel/layer-field.ts 的 setLayers 夹（随生命比例 3/4/5/6）。
       */
      if (x.grantLayers) {
        const lf = (self.skills ?? []).map((s: any) => s?.ir?.layerField).find((v: any) => !!v);
        if (lf && layerFieldActive(self, lf)) {
          const ratio = layerHpRatio(self);
          const extra = x.grantLayers.extraIfBelow && ratio < x.grantLayers.extraIfBelow.ratio ? x.grantLayers.extraIfBelow.extra : 0;
          const n = x.grantLayers.base + extra;
          // ★ 第 191 轮：取整点统一走 GameMath（lint-rounding 的规则；这里是**标签文本**，用展示口径）
          await grantLayers(battle, self, lf, n, "ACTIVE:" + x.name + (extra ? "+BELOW" + GameMath.displayPercent(x.grantLayers.extraIfBelow!.ratio) : ""));
        }
      }
      // 行动条：拉条/推条是阴阳师的核心机制，必须能在 Theater 的行动条上**看见它发生**
      for (let ti = 0; ti < x.timeline.length; ti++) {
        // ★★★ 第 188 轮：同上 —— 按句收窄（行动条槽位）。这一族的**下标本来就在**（概率归因用的就是 ti），
        //   所以这里只是在同一处加一道闸门。
        if (onlyEffects.timeline && !onlyEffects.timeline.includes(ti)) continue;
        const t = x.timeline[ti];
        const percent = t.direction === "pull" ? t.percent : -t.percent;
        // ★ 「有30%概率击退30%行动条」里的那个 30% —— 以前被丢掉，等于必定击退。
        const tp = probOf(x, "timeline:" + ti);
        if (tp !== null) {
          battle.rng.expect("timeline_prob:" + x.name + ":" + ti);
          if (!battle.rng.testHit(tp)) {
            battle.trace.push({ t: "TIMELINE_MISS", id: self.id, skill: x.name, direction: t.direction, percent, probability: tp });
            battle.queueEvent(EV.TIMELINE_MISS, { battle, actor: self.id, skill: x.name, direction: t.direction, percent, probability: tp }, self.id, self.teamId);
            continue;
          }
        }
        // ★ 推条的对象是**承受者**，不是自己。此前无论拉条还是推条都对 self.id 生效 ——
        //   「有30%概率击退100%行动条」于是变成了"把自己往后推"，方向与对象全错。
        const recipients = t.direction === "push" ? hurt : [self];
        for (const r of recipients) {
          const posBefore = battle.timeline.get(r.id)?.pos ?? null;
          const moved = battle.timeline.shift(r.id, percent);
          // ★ 被缚足/放逐/石化挡下时必须留痕（官方[117]：无法受到改变行动条的效果）。
          //   否则"Theater 里看到技能放了但行动条没动"会变成一个无法解释的现象。
          if (!moved && battle.timeline.isLocked?.(r.id)) {
            battle.trace.push({
              t: "TIMELINE_LOCKED", id: r.id, direction: t.direction, percent,
              skill: x.name, reason: "锁条（缚足/放逐/石化）",
            });
            continue;
          }
          battle.trace.push({
            t: "TIMELINE_SHIFT", id: r.id, direction: t.direction, percent,
            posBefore, posAfter: battle.timeline.get(r.id)?.pos ?? null, applied: moved, skill: x.name,
          });
        }
      }
      // ★ 驱散 / 解除（官方[8] / 官方[1]）：此前**完全没有实现** ——
      //   Entity.dispel()/remove() 两个方法在生产代码里零调用，技能写了"驱散3个减益状态"也什么都不发生。
      //   能否驱散看印记的 dispellable、能否解除看 removable（引擎里这两个标记一直是对的，只是没人用）。
      for (const pg of (x.purge ?? [])) {
        const pool = pg.side === "ALLY" ? allyPool : enemyPool;
        /**
         * ★★★ 第 196 轮：**随机一个**（兔丸「守护之心」写的是「对随机非召唤物的友方目标」）。
         *   此前 runtime 对**整侧**逐个驱散 ⇒ 原文清一个人，引擎清了全队（多算）。
         *   抽数走 battle.rng（进 stateHash / 重放），标签写明用途。
         */
        let recipients = pool;
        if (pg.scope === "RANDOM_ONE" && pool.length) {
          battle.rng.expect("purge_pick:" + x.name);
          const one = battle.rng.pick(pool);
          recipients = one ? [one] : [];
        }
        for (const vic of recipients) {
          if (!vic.alive) continue;
          const wantsBuff = pg.what === "BUFF";
          const cands = vic.statuses.filter((s: any) => {
            if (wantsBuff && !s.def.category.startsWith("BUFF")) return false;
            if (pg.what === "DEBUFF" && !s.def.category.startsWith("DEBUFF")) return false;
            /** ★★★ 第 196 轮：**按名驱散** —— 原文点名了是哪几种（兔丸「守护之心」）⇒ 只碰这几种 */
            if (Array.isArray(pg.statusIds) && pg.statusIds.length && !pg.statusIds.includes(String(s.def.id))) return false;
            return pg.kind === "DISPEL" ? s.def.dispellable : s.def.removable;
          });
          // 「驱散哪几个」的优先顺序属于红区（未实测）→ 取挂载顺序的前 N 个，并在事件里写明顺序依据
          for (const st of cands.slice(0, pg.count)) {
            const gone = pg.kind === "DISPEL" ? vic.dispel(st.def.id) : vic.remove(st.def.id);
            if (!gone) continue;
            battle.trace.push({
              t: "STATUS_REMOVE", id: vic.id, status: st.def.id, name: st.def.name,
              by: pg.kind, side: pg.side, what: pg.what, src: self.id, skill: x.name,
              order: "挂载顺序（红区：驱散优先级未实测）",
            });
            battle.queueEvent(EV.STATUS_REMOVE, { battle, entity: vic, status: st.def.id, name: st.def.name, by: pg.kind, side: pg.side, what: pg.what, src: self.id, skill: x.name }, vic.id, vic.teamId);
          }
        }
      }
      /**
       * ★★★ 第 99 轮：**属性偷取**（偷取 → 到期/阵亡归还）。运行时在 kernel/steal.ts。
       *
       * 位置：驱散之后、鬼火之前 —— 也就是**这一下伤害已经结算完**之后，
       * 所以偷到的是「打完这一下」时的目标属性（与「造成攻击100%伤害并有100%偷取20%攻击」的语序一致）。
       *
       * ★ 只执行能从原文读出数字的写法；读不出来的三类（逐次伤害触发 / 施放前被动 / 增益偷取）
       *   留在 stealSkips 与未建模表里，**不会**被这里静默吃掉。
       */
      /**
       * ★★★ 第 101 轮：**自身形态类放置单位**的入场点（第 98 轮声明"缺的那一步"的第一块）。
       *   · ON_CAST（「施放化身[蛇神]姿态」）在这里执行；
       *   · ON_LETHAL（「受到致命伤害时…进入[余烬]姿态」）**不在这里**，它属于死亡路径 ——
       *     而这一轮只执行 returnOn=SUMMON_DEATH 的形态（余烬要等形态单位会行动才能回来，见 kernel/summon.ts）。
       */
      for (const fm of ((x as any).forms ?? [])) {
        if (fm.trigger !== "ON_CAST") {
          battle.trace.push({ t: "FORM_SKIPPED", owner: self.id, tipsId: fm.tipsId, name: fm.name, reason: "TRIGGER_NOT_CAST", trigger: fm.trigger, skill: x.name });
          continue;
        }
        const r = enterForm(battle, self, fm, { hasSkills: false });
        if (!r.ok) battle.trace.push({ t: "FORM_SKIPPED", owner: self.id, tipsId: fm.tipsId, name: fm.name, reason: r.reason, skill: x.name });
      }
      /**
       * ★★★ 第 115 轮：**施放式创建场地**（「创造存在2回合的幻境」「开启存在1回合的狐影结界」）。
       *   与时点无关的顺序问题：场地先于本技能的其余效果生效 —— 原文的语序就是「创造…，使友方全体提升…」。
       *   ★ 带概率的创建（「有30%概率创造…」）要**掷骰**，用稳定 tag 进 RNG 账本（同一 seed 可重放）。
       */
      if ((x as any).field) {
        const fspec: any = (x as any).field;
        let go = true;
        if (fspec.probability !== null && fspec.probability !== undefined) {
          battle.rng.expect("field_prob:" + fspec.name);
          go = battle.rng.testHit(fspec.probability);
        }
        if (go) createField(battle, self, fspec);
        else battle.trace.push({ t: "FIELD_SKIPPED", name: fspec.name, owner: self.id, reason: "PROBABILITY", p: fspec.probability });
      }
      for (const stl of ((x as any).steals ?? [])) {
        /**
         * ★★★ 第 108 轮：**这个执行点只负责「施放技能时」那一类偷取**。
         *   · trigger=ON_DAMAGE（「造成伤害时，偷取…」）由被动运行时在 AFTER_DAMAGE 上执行；
         *   · trigger=PRE_CAST（「施放『X』前，先偷取…」）由被动运行时在 SKILL_START 上执行。
         *
         * 第 99 轮写这里时，这两类**还没被解析出来**（注释里写着"留在 stealSkips 里"），
         * 所以"全都执行"当时是对的；105/107 轮把它们接上之后，这里就变成了**第二个执行点**。
         * 实测（tools/_probe-prec5.ts）：噬魂一次施放偷了**两遍**（10 次 = 5 敌 × 2），
         * 而且第二遍发生在"技能结算之后" —— 原文写的是「施放『焚天九尾』**前**」。
         * 一个不报错的错：多算的偷取会凭空改攻击力，还改的是同一回合的伤害结算。
         */
        if (stl.trigger && stl.trigger !== "ON_CAST") {
          battle.trace.push({ t: "STAT_STEAL_SKIPPED", src: self.id, skill: x.name, trigger: stl.trigger, reason: "NOT_THIS_EXECUTION_POINT", evidence: stl.evidence });
          continue;
        }
        const victims = stl.side === "ALLY" ? allyPool : enemyPool;
        for (const vic of victims) {
          if (!vic.alive) continue;
          if (stl.probability !== null) {
            // 掷骰标签与状态路径同型：默认档下既有夹具的随机数序列不因新机制而漂移
            const tag = "steal_prob:" + (stl.prop ?? "random") + ":" + x.name + ":" + vic.id;
            battle.rng.expect(tag);
            if (!battle.rng.testHit(stl.probability)) {
              battle.trace.push({ t: "STAT_STEAL_MISS", src: self.id, dst: vic.id, skill: x.name, probability: stl.probability });
              continue;
            }
          }
          // ★ 第 104 轮：两类"偷"共用同一个执行点，但走两条路（属性偷取有借据 / 增益偷取是搬运）
          if (stl.buffSteal) {
            const rb = stealBuff(battle, self, vic, stl);
            if (!rb.applied) battle.trace.push({ t: "STATUS_STEAL_BLOCKED", src: self.id, dst: vic.id, skill: x.name, reason: rb.reason });
            continue;
          }
          const r = applyStatSteal(battle, self, vic, stl);
          if (!r.applied) battle.trace.push({ t: "STAT_STEAL_BLOCKED", src: self.id, dst: vic.id, skill: x.name, reason: r.reason });
        }
      }
      // 鬼火
      if (x.orb.gain > 0) {
        const before = team.orbs.current;
        const og = team.orbs.gain(x.orb.gain);
        /** ★★★ 第 120 轮：鬼火「获得」与「溢出」是两个事件（gain() 的返回值里本来就有 overflow，
         *  此前只写进 trace、没进总线）。★ 口径边界：派发点在**技能 / 御魂两条生产路径**上，
         *  直接调鬼火池的地方不产生事件 —— 这是本次口径的边界，不等于已经全覆盖。 */
        battle.queueEvent(EV.ORB_GAIN, { battle, team: self.teamId, src: self.id, skill: x.name, requested: x.orb.gain, gained: og.gained, before, after: team.orbs.current }, self.id, self.teamId);
        if (og.overflow > 0) battle.queueEvent(EV.ORB_OVERFLOW, { battle, team: self.teamId, src: self.id, skill: x.name, overflow: og.overflow, after: team.orbs.current }, self.id, self.teamId);
        battle.trace.push({ t: "ORB_GAIN", team: self.teamId, src: self.id, skill: x.name, requested: x.orb.gain, before, after: team.orbs.current, overflow: Math.max(0, before + x.orb.gain - team.orbs.current) });
      }
      }   // ★★★ 第 177 轮：statusOnly 的挡板到此为止（下面是状态那一段 —— 它是这一段唯一的执行体）
      // 状态（通过 [buff_x_y] 引用）
      for (let si = 0; si < x.statusRefs.length; si++) {
        const ref = x.statusRefs[si];
        /** ★ 第 177 轮：statusOnly 时只施加调用方点名的那几个引用 */
        if (statusOnly && !statusOnly.includes(ref)) continue;
        /**
         * ★★★ 第 181 轮：**逐句效果归因** —— 触发的是哪一句，就只施加**属于那一句**的引用
         *   （调用方用 statusRefsForClause 算好传进来）。与 statusOnly 的分工：
         *   statusOnly = 整门技能只跑状态那一段（主动技能里的被动子句用）；
         *   onlyStatusSlots = 状态那一段只碰这几个**槽位**（逐句归因用 —— 按槽位而不是按 ref！）。两个可以同时给。
         */
        if (opts?.onlyStatusSlots && !opts.onlyStatusSlots.includes(si)) continue;
        /**
         * ★★★ 第 193 轮：**只当条件的槽位，在主动施放里也不该被施加**。
         *   第 181 轮只把这道闸门装在被动路径上（statusRefSlotsForClause 里），
         *   于是主动技能里的条件引用照旧被当成效果：以津真天「风之舞」的
         *   「若敌方**被附加**[buff_2862_1]」会在**施放时**给敌人挂上 2862_1。
         *   判据同源、只有一份（编译器产出的 statusRefConditionOnly），两条路径都得看它。
         *   ★ fail-closed：没有逐句证据（statusRefConditionOnly 不存在）⇒ 一个字都不变。
         */
        if ((x.statusRefConditionOnly ?? []).includes(si)) continue;
        const cb = buffs.get(ref) ?? unknownBuff(ref, self, battle);
        if (!cb.known) (battle as any).unknownBuffRefs.push(ref);
        const def = StatusBook.get(cb.id) ?? toStatusDef(cb);
        if (!StatusBook.has(cb.id)) StatusBook.set(cb.id, def);
        // 减益跟伤害走同一个范围（群攻附带群控），增益跟治疗/护盾走同一个范围
        const isDebuff = cb.category.startsWith("DEBUFF");
        // 减益跟随伤害范围；若这个技能没有伤害（hurt 为空）则退回敌方首个目标 ——
        // 绝不因为"范围判成友方"就把减益丢给队友。
        const statusVictims = isDebuff ? (hurt.length ? hurt : [enemyPool[0] ?? primary]) : aid;
        /**
         * ★★★ 第 176 轮：**逐句承受者归属**（缺口清单里那条「对伤害来源附加…」）。
         *
         * 现状（第 129 轮探针照出来的那个"算错"）：这一族的状态承受者来自**技能级 targeting**，
         *   于是九命猫「阵亡时，对伤害来源附加…」把状态加到了**随机一个敌人**身上（击杀者是 203、状态落在 201）。
         *   那一轮按"算错比少算更坏"的口径**整条不装**（failure-closed + byTarget 桶）。
         *
         * 修法：编译产物 `x.sourceBearerRefs` 逐句记下了「哪条子句点名了来源、用的是哪个 buff 引用」，
         *   这里按它把承受者换成**事件来源**（damageSourceOf）。两个方向都失败关闭：
         *   · 拿不到来源（主动施放这条技能时就是如此）⇒ **不施加** + 留 STATUS_BEARER_SKIPPED 痕；
         *   · 没有这条记录的引用 ⇒ 一个字都不变（与今天逐位相同）。
         */
        /**
         * ★ 红区 E：这条路径跟着**被动档**走 —— 与所有"机制类"一样，默认档（NOT_EXECUTED）**一个字都不变**。
         *   ★ 档位判据取 `policies.passives.mode`（值是 "OFF" / "PARSED_ONLY"，不是 id 里的 NOT_EXECUTED ——
         *     第一版就是照 id 比对的，于是默认档也被判成"开着"，指纹当场就动了）。
         *   若不加这道闸门，主动施放（没有事件载荷）也会走"拿不到来源 ⇒ 不施加"，
         *   于是默认档的状态施加结果改变、指纹跟着动（实测：2d7c7507e18db61f → ebe69db360755da9）。
         *   三条断言守着它：g43「基准指纹逐位不变」/ g54「OFF 档指纹逐位不变」/ g78「默认跑完整场指纹不变」。
         */
        const bearerOn = String(battle?.policies?.passives?.mode ?? "OFF") !== "OFF";
        const bearer = bearerOn
          ? (((x.sourceBearerRefs ?? []) as Array<{ ref: string; clause: string }>).find(b => b.ref === ref) ?? null)
          : null;
        let victims = statusVictims;
        if (bearer) {
          const source = damageSourceOf(battle, ctx);
          if (!source) {
            battle.trace.push({
              t: "STATUS_BEARER_SKIPPED", src: self.id, ref, skill: x.name,
              clause: bearer.clause, reason: "NO_DAMAGE_SOURCE",
            });
            continue;
          }
          victims = [source];
        }
        // ★ 「有30%概率冰冻」里的那个 30% —— 以前被丢掉，等于 100% 冰冻。
        //   只有原文**明写**概率时才掷骰；没写 = 必定施加（不污染 RNG 序列，也不改变既有语义）。
        const sp = probOf(x, "status:" + si);
        // ★ 概率**每个承受者各掷一次**：群控是"对每个人分别判定命中"，
        //   不是"掷一次决定全场"。掷一次会让 5 人同时中或同时不中，方差被严重低估。
        // ★ 持续时间的三级优先：技能原文写明 > 印记自身描述 > 1 回合。
        //   此前只有后两级，于是「持续3回合」若只写在技能里就静默变成 1 回合（全库 107 个技能）。
        const fromSkill = durationOf(x, "status:" + si);
        const duration = fromSkill ?? cb.durationFromText ?? 1;
        // 两处都写了且不一致 → 记下来（不假装其中一个一定对）
        if (fromSkill !== null && cb.durationFromText !== null && cb.durationFromText !== fromSkill) {
          battle.trace.push({
            t: "STATUS_DURATION_CONFLICT", src: self.id, status: def.id, name: def.name,
            fromSkill, fromBuff: cb.durationFromText, used: duration, ref, skill: x.name,
          });
        }
        for (const victim of victims) {
          if (!victim.alive) continue;
          /**
           * ★★★ 第 97 轮：**效果抵抗**（红区 H）。在这里把"这次状态能不能上"这件事收成一个判定。
           *
           * 三种口径（kernel/policies.ts 的 ResistPolicies）：
           *   · NONE（默认）：与今天**逐位相同** —— 一次 `testHit(sp)`，RNG 标签不变；
           *   · SINGLE_ROLL_RATIO：一次掷 `sp × (1+命中) / (1+抵抗)`（属性是比例：0.84 = 84%）；失败且 u < sp×(1+命中) ⇒ 抵抗；
           *   · COMMUNITY_TWO_ROLL：先掷命中、再掷抵抗（多消耗一次随机数 ⇒ 整条随机数流改变）。
           * ★ 抵抗只对**敌方施加的减益**有意义（给自己人上增益不该被自己的抵抗挡住），
           *   所以判定条件里带了 `isDebuff && self.id !== victim.id`。
           */
          // ★ One contest for every status producer (kernel/resist.ts). NONE ⇒ the historical single
          //   roll of the written chance under the same tag; SINGLE_ROLL_RATIO also contests 100% debuffs.
          const contest = rollStatusContest(battle, self, victim, def, sp,
            "status_prob:" + def.id + ":" + x.name + ":" + victim.id,
            "resist:" + def.id + ":" + x.name + ":" + victim.id);
          if (contest.outcome === "MISS") {
            battle.trace.push({
              t: "STATUS_MISS", src: self.id, dst: victim.id, status: def.id, name: def.name,
              probability: sp, ref, skill: x.name,
              ...(contest.single ? { effective: contest.effective, efh: contest.efh, efr: contest.efr } : {}),
            });
            battle.queueEvent(EV.STATUS_MISS, { battle, src: self.id, dst: victim.id, status: def.id, name: def.name, probability: sp, ref, skill: x.name }, self.id, self.teamId);
            continue;
          }
          if (contest.outcome === "RESIST") {
            // ★ 抵抗必须是一个**事件**（EV.RESIST）—— 幽谷响 / 被动订阅它
            await reportResist(battle, self, victim, def, contest, { probability: sp, duration, ref, skill: x.name });
            continue;
          }
          // ★★★ 第 76 轮：层数此前**写死 1** —— 「附加3层[buff_x]」被施加成 1 层。
          //   实测 39 个技能受影响（主动 29 / 被动 10），含普攻（鸩「鸩羽」附加2层）。
          //   `stacksOf` 与 `durationOf`/`probOf` 同型：null = 原文没说 → 1 层（保持旧语义）。
          /**
           * ★★★ 第 94 轮：**状态自带的免疫**（数据：338 条 buff 里 15 条写了免疫语义）。
           *
           * 在此之前：EV.IMMUNE 这个事件码从来没被派发过，而且**没有任何免控判定** ——
           * 「免疫控制效果」只是一句文案。判据全部取自 **buff 原文**（不是技能文案）：
           * 状态在，免疫就在；状态没了，免疫也就没了。
           *
           * ★ 闸门放在**唯一的状态施加点**（这里），而不是各个技能里 ——
           * 于是主动技能 / 被动执行 / 后续任何新生产者**自动继承**这道判定。
           * ★ 被挡下的施加要留两条痕迹：一条 trace（Theater 能看见）与一次 EV.IMMUNE 派发
           * （订阅者能反应）。**「什么都没发生」必须是一个可观测的事件。**
           */
          const imm = findImmuneStatus(victim, def, battle.policies?.immune?.debuffCoversControl ?? true);
          if (imm) {
            battle.trace.push({
              t: "IMMUNE", src: self.id, dst: victim.id, status: def.id, name: def.name,
              by: imm.def.id, kind: imm.kind, consumed: imm.consumed, ref, skill: x.name,
            });
            await battle.bus.dispatch(EV.IMMUNE,
              { target: victim, incoming: def, by: imm.def, kind: imm.kind },
              victim.id, victim.teamId, (id: number) => battle.teamOf(id));
            continue;
          }
          const stacks = stacksOf(x, "status:" + si) ?? 1;
          // ★★★ 第 78 轮：层数上限。「上限4层」此前**完全没有被执行**（addStatus 只做加法）。
          const cap = capOf(x, "status:" + si);
          const applied = victim.addStatus(def, self.id, stacks, duration,
            cb.effects.map((ef: any) => ({ prop: ef.prop, value: ef.value, mode: ef.mode })), cap);
          // ★ G1：Buff/Debuff 的施加必须有事件，否则 Theater 无法展示生命周期（a1-4 §17）
          battle.trace.push({
            t: "STATUS_APPLY", src: self.id, dst: victim.id, status: def.id, name: def.name,
            category: cb.category, duration, ref, known: !!cb.known, tag: (applied as any)?.tag ?? null, skill: x.name,
          });
        }
      }
      /**
       * ★★★ 第 194 轮：**「随机增益 / 随机减益」池子**（IR 的 randomStatuses；判据见 kernel/random-pool.ts）。
       *
       * 由来：匣中少女「溢彩」287_02「受到攻击时，有100%[基础概率]为攻击者附加1个[随机减益]效果，持续1回合」——
       *   它**没有** [buff_x] 引用，认不出该附加什么，此前整条不落地（数据其实在 tips_200/201 里）。
       *
       * 口径（与状态那一段**同一套原语**，不另写一份）：
       *   · 概率：原文写了就掷（100% 也掷 —— 与状态那一段一致：写了就是一次判定，进 RNG 账本）；没写 = 必定。
       *     ★ 与被动触发侧**不会重复掷**：passive-runtime 的 probOwnedByEffect 认得池子。
       *   · 抽哪一条：走 battle.rng（进 stateHash / 快照 / 重放 —— 同 seed 必然抽到同一条）。
       *   · 免疫：同一个 findImmuneStatus（与状态那一段同一入口）。
       *   · 状态定义进 StatusBook（跨进程恢复要用；RANDOM_* 不在 KB 里，见 poolDefFromId）。
       *   · statusOnly 模式**不跑池子**（那是「只跑状态那一段」，池子不是按 ref 点名的状态）。
       * ★ 承受者：bearer=DAMAGE_SOURCE ⇒ 事件来源（拿不到就留痕、不施加，与第 176 轮同一条）；
       *   否则跟状态那一段同一套（减益随伤害范围、增益走 aid）。
       * ★ 不额外挂被动档闸门：今天全库只有这 1 条池子技能，且它是被动（cost=-1）——
       *   默认档根本不装被动运行时，所以默认档逐位不变（实测两个指纹都没动）。
       */
      if (!statusOnly) {
        const pools = (x.randomStatuses ?? []) as any[];
        for (let pi = 0; pi < pools.length; pi++) {
          if (opts?.onlyPoolSlots && !opts.onlyPoolSlots.includes(pi)) continue;
          const spec = pools[pi];
          const entries = (spec.entries ?? []) as any[];
          if (!entries.length) continue;
          const dur = Number(spec.duration) || 1;
          const poolVictims: Entity[] = spec.bearer === "DAMAGE_SOURCE"
            ? (() => {
                const src = damageSourceOf(battle, ctx);
                if (!src) {
                  battle.trace.push({ t: "POOL_BEARER_SKIPPED", src: self.id, pool: spec.name, skill: x.name, clause: spec.clause, reason: "NO_DAMAGE_SOURCE" });
                  return [];
                }
                return [src];
              })()
            : spec.kind === "DEBUFF" ? (hurt.length ? hurt : [enemyPool[0] ?? primary]) : aid;
          for (const victim of poolVictims) {
            if (!victim?.alive) continue;
            battle.rng.expect("pool_pick:" + spec.name + ":" + x.name + ":" + victim.id);
            const pick = battle.rng.pick(entries) ?? entries[0];   // ★ 抽数走引擎自己的入口（不手写取整 —— 见 lint-rounding）
            const def = poolEntryDef({ kind: spec.kind, name: spec.name, entries, evidence: String(spec.evidence ?? "") } as any, pick, dur);
            /** ★ 施加走第 195 轮抽出来的共用核心（概率 / 免疫 / 落痕三件事只写一份） */
            await applySyntheticStatus(battle, self, victim, {
              def, dur, count: Number(spec.count) || 1,
              effects: [{ prop: String(pick.prop), value: Number(pick.value), mode: pick.mode }],
              probability: spec.probability ?? null,
              probTag: "pool_prob:" + spec.name + ":" + x.name + ":" + victim.id,
              missTrace: "POOL_MISS", ref: "POOL:" + spec.name, extra: { pool: spec.name }, skill: x.name,
            });
          }
        }
      }
      /**
       * ★★★ 第 195 轮：**占位符形态的控制效果**（IR 的 controlRefs；判据见 compile/skill-compiler.ts）。
       *
       * 由来：控制效果在原文里几乎都写成 tips 占位符（`[tips_101]`=冰冻 / `[tips_108]`=眩晕…），
       *   全库 73 处小句、56 个技能，而引擎此前**一处都不施加**，那 56 个技能在报表上却大多写着「完整编译」。
       *   这一轮把其中 43 处认了出来（36 处按理由码挡下，见 controlSkips —— 否定式/引用式/分支/随机取一/场地已在做）。
       *
       * 施加走与池子**同一个核心**（applySyntheticStatus）：概率掷、免疫、落痕、定义进 StatusBook 都是同一份；
       * 时长与概率是编译期**就地读出来**的（同一小句），所以这里不需要槽位归因。
       */
      if (!statusOnly) {
        const ctrls = (x.controlRefs ?? []) as any[];
        for (let ci = 0; ci < ctrls.length; ci++) {
          if (opts?.onlyControlSlots && !opts.onlyControlSlots.includes(ci)) continue;
          const spec = ctrls[ci];
          const cdef = StatusBook.get(String(spec.ref)) ?? controlDefByTipName(String(spec.name));
          if (!cdef) continue;                            // 认不出来的控制 ⇒ 一个字都不做（编译期已记账）
          const cdur = Number(spec.duration) || 1;
          const cVictims: Entity[] = spec.bearer === "DAMAGE_SOURCE"
            ? (() => {
                const src = damageSourceOf(battle, ctx);
                if (!src) {
                  battle.trace.push({ t: "CONTROL_BEARER_SKIPPED", src: self.id, status: spec.ref, name: spec.name, skill: x.name, clause: spec.clause, reason: "NO_DAMAGE_SOURCE" });
                  return [];
                }
                return [src];
              })()
            : (hurt.length ? hurt : [enemyPool[0] ?? primary]);
          for (const victim of cVictims) {
            /**
             * ★★★ 第 242 轮：**效果位变体**（IR 的 controlRefs[].variant，§175 的形状 ②/③）。
             *   条件在**目标**身上 ⇒ 只能逐目标判；两个铁律：
             *   ① **条件不掷骰**（`hasStatus` 只是读状态，不进 RNG 账本）—— 否则"同一个 seed 两次不同结果"会从条件里漏进来；
             *   ② 转换概率是**原文写明的**（雪女「有30%概率转化为深度冰冻」）⇒ 该掷就掷，标签 `branch_pick:<技能>:<变体名>`，
             *      且排在基础概率**之前**（先把这一位的身份定下来，再判它落不落地）。
             *   ★ 命中即"改写"：同一个效果位换成变体状态，**不是**再加一个（多算比不做更坏）。
             */
            let vDef: any = cdef, vRef = String(spec.ref), vName = String(spec.name);
            const variant = spec.variant;
            if (variant && variant.when?.kind === "TARGET_HAS" && victim.hasStatus(String(variant.when.statusId))) {
              const vTargetDef = StatusBook.get(String(variant.ref)) ?? controlDefByTipName(String(variant.name));
              if (vTargetDef) {
                let convert = true;
                if (variant.probability !== null && variant.probability !== undefined) {
                  battle.rng.expect("branch_pick:" + x.name + ":" + String(variant.name));
                  convert = battle.rng.testHit(Number(variant.probability) / 100);
                }
                if (convert) { vDef = vTargetDef; vRef = String(variant.ref); vName = String(variant.name); }
              }
            }
            await applySyntheticStatus(battle, self, victim, {
              def: vDef, dur: cdur, count: 1, effects: [],
              probability: spec.probability ?? null,
              probTag: "control_prob:" + vRef + ":" + x.name + ":" + victim.id,
              missTrace: "CONTROL_MISS", ref: "CONTROL:" + vRef, extra: { status: vRef, name: vName }, skill: x.name,
            });
          }
        }
        /**
         * ★★★ 第 246 轮：**「失去 X 时结束 Y」**（IR 的 endOnLose）—— 这一条是**主动技能给的持续效果**，
         *   所以监视器装在**施放点**（不是被动装配点）：先施放、才获得要监视的那个 buff。
         *   实现共用 `kernel/end-on-lose.ts`（与被动侧同一份判据、同一个 handler id ⇒ 幂等）。
         */
        if ((x as any).endOnLose) installEndOnLose(battle, self, (x as any).endOnLose, x.name);
        // Betting mode (MAX only): summon / stack bookkeeping that runs after a full active cast.
        if (bettingMechanicsActive() && !opts?.onlyStatusSlots && !opts?.onlyEffectSlots) await bettingAfterCast(battle, self, x);
      }
    },
  }));

  // AI：在 TURN_START 时按规则改写本次要用的技能
  e.skills.forEach((sk: any) => { sk.aiProfile = ai; });
  return { entity: e, ir, ai, meta: s, issues };
}

/** 去重且保持顺序（主目标优先，然后才是其余敌人） */
function uniq(list: Entity[]): Entity[] {
  const seen = new Set<number>(); const out: Entity[] = [];
  for (const e of list) { if (!seen.has(e.id)) { seen.add(e.id); out.push(e); } }
  return out;
}

/**
 * 缺失 buff 的兜底：灰机 wiki 源数据本身就不存在 12482_1 / 37152_1。
 * 原则是"绝不静默丢弃" —— 造一个**显式的未知印记**：
 *   - 不假设任何属性效果（effects 为空）
 *   - 不假设任何行为标记
 *   - 但它确实存在于单位身上，可被驱散/解除，且计入 unknownBuffRefs 供报告
 */
export function unknownBuff(ref: string, self: Entity, battle: any) {
  return {
    id: ref, name: "未知印记(" + ref + ")", known: false,
    category: "COMMON_MARK" as any,
    dispellable: true, removable: true,
    preventsAction: false, preventsSkill: false, forcesBasicAttack: false,
    suppressPassive: false, suppressSoul: false, locksTimeline: false,
    effects: [] as any[], durationFromText: null as number | null,
    confidence: "LOW" as const, unparsed: ["源数据缺失"], desc: "（灰机 wiki 未收录该 buff 定义）",
  };
}

export function mkCtx(battle: any, self: Entity, enemies: Entity[]): AICtx {
  const allies = battle.teams[self.teamId].aliveAll();
  return {
    self, allies, enemies,
    orbs: battle.teams[self.teamId].orbs.current,
    maxOrbs: battle.teams[self.teamId].orbs.policy.maxOrb,
    turn: battle.turn,
    skillAvailable: (ref: string) => self.skills.some((s: any) => s.name.includes(ref.replace("技能", "")) || s.ir?.name === ref),
    usedSkill: (ref: string) => {
      // "未使用2技能时" -> 判断第 N 个技能是否用过
      const m = String(ref).match(/([1-4])\s*技能/);
      if (m) { const idx = Number(m[1]) - 1; const sk = self.skills[idx]; return !!sk && self.usedSkills.has(sk.name); }
      return [...self.usedSkills].some(n => n.includes(ref) || ref.includes(n));
    },
    rng: battle.rng,
    hasBuff: (ent: Entity, kw: string) => ent.statuses.some((st: any) => st.def.name.includes(kw) || st.def.id.includes(kw)),
    /** ★ 第 116 轮：场地查询（AI 条件「自身处于幻境时」「所有友方均无狐影结界时」要用） */
    inFieldOf: (ent: any, kind: any, name?: string) => entityInField(battle, ent, kind, name),
    fieldRemaining: (kind: any, name?: string) => fieldRemaining(battle, kind, name),
  };
}

/**
 * 按官方 cast 规则选择技能。
 * ★ G5：同时把**决策过程**写进事件流（a1-4 §25）——
 * 逐条规则记下「鬼火够不够 / 条件过没过 / 最终选了谁」，这样 Inspector 才能回答
 * "为什么这一回合放的是普攻而不是大招"，而不是只看到一个结果。
 */
export function selectSkillByAI(battle: any, self: Entity, enemies: Entity[]): any {
  const ai: AIProfileIR | undefined = self.skills[0]?.aiProfile;
  const orbs = battle.teams[self.teamId].orbs;
  const trace = (obj: any) => { if (battle?.trace) battle.trace.push(obj); };

  if (!ai || !ai.skillRules.length) {
    const fallback = self.skills[0];
    trace({ t: "AI_DECISION", actor: self.id, reason: "NO_AI_PROFILE", chosen: fallback?.name ?? null, orbs: orbs.current, rules: [] });
    return fallback;
  }
  const ctx = mkCtx(battle, self, enemies);
  /** Betting mode (MAX only): unlock rules first, "N技能" by id suffix, passives / blocked skills gated. */
  const betting = bettingMechanicsActive();
  if (betting) {
    const pre = bettingPreferredSkill(battle, self);
    if (pre) {
      trace({ t: "AI_DECISION", actor: self.id, chosen: pre.skill.name, chosenIndex: pre.skill.index, reason: "BETTING_RULE", rule: pre.rule, orbs: orbs.current, maxOrbs: orbs.policy?.maxOrb ?? null, rules: [] });
      return pre.skill;
    }
  }
  const rules: Array<{ index: number; skill: string | null; cost: number | null; affordable: boolean; cond: boolean; condRaw: string; condUnresolved?: boolean; gated?: boolean; gate?: string }> = [];
  for (const [i, r] of ai.skillRules.entries()) {
    if (r.skill.index === null) { rules.push({ index: i, skill: r.skill.raw ?? null, cost: null, affordable: false, cond: false, condRaw: r.condRaw }); continue; }
    const sk = betting ? resolveRuleSkill(self, r.skill) : self.skills[r.skill.index];
    if (!sk) { rules.push({ index: i, skill: r.skill.raw ?? null, cost: null, affordable: false, cond: false, condRaw: r.condRaw }); continue; }
    const cost = betting ? bettingCostOf(battle, self, sk) : sk.cost;
    const affordable = !(cost > 0 && !orbs.canPay(cost));
    /**
     * ★★★ 第 114 轮：**条件解析不出 ≠ 条件成立**。
     *
     * 此前这一行写的是 `r.cond ? !!r.cond(ctx) : true` —— 于是**全库 114 条**条件没编译出来的规则
     * （涉及 70/272 只式神：「自身处于幻境时」「不存在山行结界时」「没buff」「不充足」…）
     * 会被当成「条件成立」逐回合放行，而且 AI_DECISION 事件里还写着 reason=COND_MATCH ——
     * **错的不只是行为，连解释都是假的**（G5 的 AI Inspector 会告诉用户「条件满足」）。
     *
     * 现在的三档：`r.cond` 有谓词 ⇒ 求值；`condRaw === ""` ⇒ 数据里真没写条件（照放）；
     * 有原文却编译不出 ⇒ **不放行**，并在决策事件里标 condUnresolved（失败关闭 + 说出来）。
     */
    const condUnresolved = !r.cond && !!r.condRaw;
    const cond = r.cond ? !!r.cond(ctx) : !condUnresolved;
    /**
     * ★★★ 第 248 轮：**施放限制**（IR 的 castGate）——「X 存在时，无法施放此技能」。
     *   判在这一层的理由：**这里是正常对局里唯一会挑技能的地方**（伪回合的追加施放不受它约束 —— 见 IR 字段注的边界）。
     *   限制成立 ⇒ 跳过这条规则，并在 `rules[]` 里写 `gated`（G5 要能回答"为什么这一回合没放它"）。
     */
    const gate = (sk as any)?.ir?.castGate;
    const bGate = betting ? bettingGate(battle, self, sk) : null;
    const gated = !!bGate || (!!gate && (gate.when.kind === "SELF_HAS"
      ? self.hasStatus(String(gate.when.statusRef))
      : enemies.some((x: any) => x.hasStatus(String(gate.when.statusRef)))));
    rules.push({ index: i, skill: sk.name, cost, affordable, cond, condRaw: r.condRaw, ...(condUnresolved ? { condUnresolved: true } : {}), ...(gated ? { gated: true, gate: bGate ?? String(gate.evidence ?? "") } : {}) });
    if (gated) continue;            // 施放限制优先于鬼火与条件（放不出来就是放不出来）
    if (!affordable) continue;      // 鬼火是第一约束
    if (cond) {
      trace({
        t: "AI_DECISION", actor: self.id, chosen: sk.name, chosenIndex: betting ? sk.index : r.skill.index,
        reason: r.condRaw ? "COND_MATCH" : "UNCONDITIONAL_RULE",
        unresolvedSkipped: rules.filter((x) => x.condUnresolved).length,
        gatedSkipped: rules.filter((x) => x.gated).length,
        orbs: orbs.current, maxOrbs: orbs.policy?.maxOrb ?? null, rules,
        note: r.condRaw ? undefined : "该规则在数据里没有写触发条件（按每回合都放处理）",
      });
      return sk;
    }
  }
  const fallback = self.skills.find((s: any) => s.cost === 0) ?? self.skills[0];
  trace({
    t: "AI_DECISION", actor: self.id, chosen: fallback?.name ?? null,
    reason: rules.some((r: any) => r.gated) ? "ALL_RULES_GATED_OR_UNMATCHED" : rules.some((r: any) => !r.affordable) ? "ALL_RULES_UNaffordable_OR_UNMATCHED" : "NO_RULE_MATCHED",
    unresolvedSkipped: rules.filter((x) => x.condUnresolved).length,
    gatedSkipped: rules.filter((x) => x.gated).length,
    orbs: orbs.current, maxOrbs: orbs.policy?.maxOrb ?? null, rules,
    note: "没有任何规则成立 → 退回 0 鬼火技能（普攻）",
  });
  return fallback;
}
