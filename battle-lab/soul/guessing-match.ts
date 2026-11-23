// soul/guessing-match.ts — 竞猜对局装配：截图八维（权威）+ KB 技能/AI（自动 Join）→ 完整 Battle
import fs from "node:fs/promises";
import path from "node:path";
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import type { TraceLevel } from "../kernel/battle.ts";
import { Team } from "../kernel/team.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets, LifestealPolicies, ImmunePolicies } from "../kernel/policies.ts";
import { loadCharacter, selectSkillByAI } from "../compile/load.ts";
import { makeGuessingEntity, verifyGuessingPanel } from "./guessing-factory.ts";
import type { GuessingBuildResult } from "./guessing-factory.ts";
import { compileSoulBook } from "./effects.ts";
// ★★★ 第 93/133 轮：**订阅的唯一安装点**（御魂 + 被动 + 替友方拦死）—— 见下面的注释。
import { installSubscribers } from "../compile/subscribers.ts";
import { loadTips, setTipsTable } from "../compile/tips.ts";
import { skillLevelMode } from "../compile/max-level.ts";
import { bettingPolicies } from "../compile/betting-policies.ts";
// ★★★ 第 186 轮：名字形态的状态引用（正文写「雄姿英发」而不是 [buff_x]）—— node 侧也要把表设上
import { loadBuffNames, setBuffNames } from "../compile/buff-names.ts";
import type { SoulDef } from "./loadout.ts";

const KB = path.resolve(import.meta.dirname, "..", "..", "data", "kb");

export interface MatchEntry {
  name: string; shikigamiId: number; rarity?: string;
  stats: { atk: number; hp: number; def: number; spd: number; cri: number; crid: number; efh: number; efr: number };
  soulIds?: number[] | null;
}
export interface MatchFixture { _meta: any; blue: MatchEntry[]; red: MatchEntry[] }

export interface AssembledMatch {
  battle: Battle;
  red: GuessingBuildResult[];
  blue: GuessingBuildResult[];
  /** 装配期发现的问题（不抛，集中报告） */
  issues: string[];
  /** 显示层同速（潜在精度陷阱） */
  displayTies: Array<{ spd: number; members: string[] }>;
}

export async function loadSoulDefs(): Promise<Map<number, SoulDef>> {
  const souls: SoulDef[] = JSON.parse(await fs.readFile(path.join(KB, "soul.json"), "utf8"));
  return new Map(souls.map(s => [Number(s.id), s]));
}

export async function assembleGuessingMatch(
  fixture: MatchFixture,
  /**
   * ★ policies 是可覆盖的（第 31 轮补）。
   *   此前这里把四个红区的候选**写死**在函数体里，于是 runner/policy-sweep.ts 传进来的候选
   *   被静默忽略 —— 8 个组合跑出完全相同的胜率，看起来像"结论对候选不敏感"，
   *   实际上**什么都没测**。这正是本项目反复出现的那一类缺口：数据齐、参数齐、没人用。
   */
  opts: { seed: number; maxTurns?: number; policies?: Record<string, unknown>; traceLevel?: TraceLevel } = { seed: 1 },
): Promise<AssembledMatch> {
  const soulDefs = await loadSoulDefs();
  // MAX (betting) mode: control/transform tips must be known before skills compile, otherwise no
  // stun / sleep / silence / confusion ever happens on this Node path. BASE mode keeps history.
  if (skillLevelMode() === "MAX") {
    setTipsTable(loadTips(JSON.parse(await fs.readFile(path.join(KB, "tips.json"), "utf8"))));
  }
  const issues: string[] = [];
  const results: Record<string, GuessingBuildResult[]> = { red: [], blue: [] };
  const teams: Record<string, Team> = {};

  for (const side of ["red", "blue"] as const) {
    const teamId = side === "red" ? 0 : 1;
    const team = new Team(teamId, side.toUpperCase(), ResourcePolicies.COMMUNITY_4_8_5_345, 1);
    let entId = (teamId + 1) * 100;
    for (const entry of fixture[side]) {
      // 1) KB 侧：技能 / AI / 元数据（不需要随输入提供）
      const lc = await loadCharacter(entry.shikigamiId, teamId, ++entId, {});
      // 2) 竞猜侧：权威面板（覆盖 KB 的面板）
      const built = makeGuessingEntity(entId, teamId, {
        shikigamiId: entry.shikigamiId,
        observed: entry.stats,
        soulIds: entry.soulIds ?? [],
      }, { soulDefs, charMeta: new Map([[entry.shikigamiId, { name: entry.name }]]) });

      /**
       * ★★★ 第 133 轮：**把御魂 id 记到实体上**（这条路径此前漏了）。
       *   网页装配路径一直写着这一句（apps/web/src/engine/assemble.ts：
       *   "图标 = 该 4 件套生效 ⇒ 实体侧也记 4 份，只记 1 份会让任何按'满 4 件'判断的路径静默失效"），
       *   而这条 Node 侧参考路径**从来没写过** —— 于是：
       *     · `battleEffectsOf(entity.soulIds, …)` 读到空数组 ⇒ 御魂订阅一条都装不上（第 133 轮实测）；
       *     · 而 resolution 里的 soulBattleEffects **是有值的**（探针 tools/_probe-node-soul133-evidence.ts）：
       *       账面说"无刀取已加载"，事件总线上一个处理器都没有 —— 正是第 70 轮在网页路径上抓到过的同一个形态。
       */
      built.entity.soulIds = (entry.soulIds ?? []).slice();
      // 3) 合并：权威面板 + 真实技能 + 真实 AI
      built.entity.skills = lc.entity.skills;
      built.entity.notes.push(`kb-skills=${lc.ir.length} ai=${lc.ai.confidence}`);
      if (!lc.ir.length) issues.push(`${entry.name} 无技能数据`);
      if (lc.ai.confidence === "LOW") issues.push(`${entry.name} AI 置信度 LOW`);
      const v = verifyGuessingPanel(built);
      if (!v.ok) issues.push(`${entry.name} 面板回显不一致: ${v.detail.join("; ")}`);

      team.add(built.entity);
      results[side].push(built);
    }
    teams[side] = team;
  }

  const battle = new Battle([teams.red, teams.blue], {
    seed: opts.seed,
    /**
     * ★★★ 第 192 轮：这条路径的档位**显式声明 NONE**（a1-4 §35：Monte Carlo 用 NONE）。
     *   它此前靠 Battle 的默认档 —— 而默认档刚刚从 SUMMARY 改成 FULL（观测默认完整）。
     *   批量跑十万局时整条事件流是纯浪费：这里一个读 trace 的地方都没有（grep 过：.trace 0 处），
     *   统计量由 stats / turnLog 提供。要事件流的调用方（runner/diff-cli.ts）自己传 FULL。
     */
    traceLevel: opts.traceLevel ?? "NONE",
    rules: { ...DEFAULT_RULES, maxTurns: opts.maxTurns ?? 300 },
    policies: {
      resource: ResourcePolicies.COMMUNITY_4_8_5_345,
      startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
      death: DeathPolicies.DEATH_AFTER_PREVENTION,
      priority: "REGISTRATION_ORDER",
      tieBreak: "SPEED_THEN_RANDOM",
      guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED,
      // ★★ 第 93/94 轮：两条新红区（吸血口径 / 免疫口径）—— 两条装配路径必须给同一套默认值，
      //   否则同一场对局在 CLI 与网页上会用不同的口径（第 93 轮刚踩过"两条路径装的东西不一样"）。
      lifesteal: LifestealPolicies.APPLIED_AS_HEAL,
      immune: ImmunePolicies.DEBUFF_COVERS_CONTROL,
      // MAX (betting) mode only: effect resist contest + anti-stall endgame ({} in BASE).
      ...bettingPolicies(),
      ...(opts.policies ?? {}),   // 扫描等场景显式覆盖；默认行为一字不变
    },
  });
  battle.skillSelector = (b, a, e) => selectSkillByAI(b, a, e);

  /**
   * ★★★ 第 93 轮：**被动运行时此前只装在网页那条装配路径上。**
   *
   * 这条路径（CLI / monte-carlo 基线 / policy-sweep）从来没有调用过 installPassiveSkills ——
   * 于是 `policies.passives` 在这里**只是一句声明**：把它设成 PARSED_ONLY 也一个处理器都不会注册。
   * 发现方式不是读代码，而是**两个本该校验差别的数字完全相同**：
   * 接线吸血后我量"被动开/关"对典型对局胜率的影响，N=1000 两次都是 634/366、连 CI 都一样 ——
   * 单场指纹明明不同（当时 ON c47af66446febdb8 / OFF 2d7c7507e18db61f —— ★ 第 132 轮把"后加的五个红区策略"
   * 入档之后，打开被动的那一侧变成 ba4f8137c904d909：状态里多了一个**必须有的键**，不是漂移），1000 个 seed 却一模一样，
   * 那只有一个解释：这条路径上那个开关**根本没接**。
   *
   * ⇒ 两条装配路径必须装同一套运行时。默认 OFF ⇒ 这里注册 0 个处理器，**默认路径逐位不变**；
   *   显式打开时才与网页路径行为一致（判据：tests/g54 第 [7] 节 + 基线重测）。
   */
  /**
   * ★★★ 第 133 轮：**改为与网页路径同一处安装**（compile/subscribers.ts）。
   *
   * 第 93 轮把被动补到这条路径上时，御魂与"替友方拦死"**还没接线**；等到它们接线之后，
   * 这条路径又落后了两样 —— 而 ui2 那条"Node vs Web 逐局一致"的对照**测不出来**：
   * 典型夹具里没有御魂、被动默认又是关的（两个本该校验差别的数字完全相同，又是第 93 轮那个形态）。
   * ⇒ 现在两条路径都调同一个 installSubscribers，顺序也由它定（tests/g87 逐项比对订阅集合与终局结果）。
   */
  const tipsMap = loadTips(JSON.parse(await fs.readFile(path.join(KB, "tips.json"), "utf8")));
  /**
   * ★★★ 第 186 轮：**两条路径的表要一致**（这条是 node 生产路径）。
   *   名字形态的状态引用要用「名字 → id」表；浏览器侧由 EngineBundle 注入、这里读知识库 —— 读的是同一份数据。
   *   ★ 不设置就是空表 ⇒ 名字形态不解析（fail-closed），而两条路径的产物会不一样 —— 那正是本仓库要防的漂移。
   */
  setBuffNames(loadBuffNames(JSON.parse(await fs.readFile(path.join(KB, "buffs.json"), "utf8"))));
  const subReport = installSubscribers(battle as any, { soulBook: compileSoulBook([...soulDefs.values()]), soulDefs, tipsMap });
  (battle as any).passiveReport = subReport.passive;
  (battle as any).soulReport = subReport.soul;
  (battle as any).allyGuardReport = subReport.allyGuard;

  // 显示层同速检测（潜在精度陷阱）
  const bySpd = new Map<number, string[]>();
  for (const side of ["red", "blue"] as const) for (const s of fixture[side]) {
    if (!bySpd.has(s.stats.spd)) bySpd.set(s.stats.spd, []);
    bySpd.get(s.stats.spd)!.push(`${side === "red" ? "红" : "蓝"}·${s.name}`);
  }
  const displayTies = [...bySpd.entries()].filter(([, v]) => v.length > 1).map(([spd, v]) => ({ spd, members: v }));

  return { battle, red: results.red, blue: results.blue, issues, displayTies };
}

export function loadMatchFixture(p: string): Promise<MatchFixture> {
  return fs.readFile(p, "utf8").then(t => JSON.parse(t));
}
