// experiments/definitions.ts — 44 个红区实验
// 原则：每个实验只改一个变量。
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { DamageType, TurnType } from "../kernel/types.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { makeTeam, wireDummy } from "../dummy/dummy.ts";
import type { Experiment } from "./runner.ts";

const R = ResourcePolicies.COMMUNITY_4_8_5_345;

function lab(seed: number, teams: any, extra: any = {}) {
  const [a, b] = teams;
  const bt = new Battle([a.team, b.team], {
    seed, rules: { ...DEFAULT_RULES, maxTurns: 200 },
    policies: {
      resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI,
      death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER",
      tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED, ...extra,
    },
  });
  for (const e of [...a.entities, ...b.entities]) wireDummy(bt, e);
  return bt;
}
const stdTeams = (hooksA: any = {}, hooksB: any = {}, stats: any = {}) => {
  const a = makeTeam(0, "RED", [
    { name: "R1", hp: 20000, atk: 1000, def: 300, spd: 120, skills: [{ name: "普攻", base: 500 }], hooks: hooksA },
    { name: "R2", hp: 20000, atk: 900, def: 300, spd: 100, skills: [{ name: "普攻", base: 500 }] },
  ], R, 0);
  const b = makeTeam(1, "BLUE", [
    { name: "B1", hp: 20000, atk: 1000, def: 300, spd: 110, skills: [{ name: "普攻", base: 500 }], hooks: hooksB },
    { name: "B2", hp: 20000, atk: 900, def: 300, spd: 100, skills: [{ name: "普攻", base: 500 }] },
  ], R, 100);
  return [a, b];
};

export const EXPERIMENTS: Experiment[] = [
  // ---------------- A 开局结算顺序 ----------------
  {
    id: "A01", group: "A", question: "两个「先机」之间谁先结算？",
    inGameObservation: "双方各带一个开局生效的 buff，观察第一回合开始前谁的效果先出现（战斗日志/状态栏出现顺序）",
    hypotheses: [
      { id: "SPEED_DESC", note: "速度快的先（不分队伍）", apply: p => { p.priority = "SPEED_DESC"; } },
      { id: "TEAM_THEN_SPEED", note: "先按队伍，再按速度", apply: p => { p.priority = "TEAM_THEN_SPEED"; } },
      { id: "REGISTRATION_ORDER", note: "按注册顺序", apply: p => { p.priority = "REGISTRATION_ORDER"; } },
    ],
    run: async (p) => {
      const order: string[] = [];
      // 红方慢、蓝方快 -> 三种策略给出三种不同顺序
      const a = makeTeam(0, "RED", [{ name: "R1", spd: 120, hooks: { senki: [() => order.push("R1")] } }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1", spd: 200, hooks: { senki: [() => order.push("B1")] } }], R, 100);
      const bt = lab(1, [a, b], p);
      await bt.runStartup();
      return { senkiOrder: order, policy: bt.bus.policy.id };
    },
  },
  {
    id: "A02", group: "A", question: "先机 与 御魂开局效果 谁先？",
    inGameObservation: "带一个开局触发的御魂 + 一个先机式神，看哪个效果先写入状态栏",
    hypotheses: [
      { id: "SOUL_FIRST", note: "御魂先", apply: p => { p.startup = StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI; } },
      { id: "SENKI_FIRST", note: "先机先", apply: p => { p.startup = StartupPolicies.SENKI_FIRST; } },
    ],
    run: async (p) => {
      const order: string[] = [];
      const a = makeTeam(0, "RED", [{ name: "R1", hooks: { senki: [() => order.push("SENKI")], soulStart: [() => order.push("SOUL")] } }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1" }], R, 100);
      const bt = lab(2, [a, b], p);
      await bt.runStartup();
      return { order };
    },
  },
  {
    id: "A03", group: "A", question: "御魂开局效果 与 被动开局效果 谁先？",
    inGameObservation: "同一式神同时带开局御魂与开局被动，看属性快照以谁为准",
    hypotheses: [{ id: "SOUL_BEFORE_PASSIVE", note: "御魂先", apply: p => { p.startup = StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI; } },
                 { id: "PASSIVE_FIRST", note: "被动先", apply: p => { p.startup = { ...StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI, id: "PASSIVE_FIRST", order: ["SPAWN","INIT_STATS","PASSIVE_START","SOUL_START","SENKI","SUMMON","FIELD","ORB_INIT","TIMELINE_INIT"] }; } }],
    run: async (p) => {
      const order: string[] = [];
      const a = makeTeam(0, "RED", [{ name: "R1", hooks: { passive: [() => order.push("PASSIVE")], soulStart: [() => order.push("SOUL")] } }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1" }], R, 100);
      const bt = lab(3, [a, b], p);
      await bt.runStartup();
      return { order };
    },
  },
  {
    id: "A04", group: "A", question: "开局鬼火初始化 在 行动条初始化 之前还是之后？",
    inGameObservation: "带一个『开局给火』的效果；如果它在第一次行动前已生效，则鬼火初值更高",
    hypotheses: [{ id: "ORB_BEFORE_TIMELINE", note: "鬼火先", apply: p => { p.startup = StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI; } },
                 { id: "TIMELINE_BEFORE_ORB", note: "行动条先", apply: p => { p.startup = { ...StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI, id: "T_FIRST", order: ["SPAWN","INIT_STATS","SOUL_START","PASSIVE_START","SENKI","SUMMON","FIELD","TIMELINE_INIT","ORB_INIT"] }; } }],
    run: async (p) => {
      const marks: string[] = [];
      const a = makeTeam(0, "RED", [{ name: "R1", hooks: { senki: [() => marks.push("SENKI")] } }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1" }], R, 100);
      const bt = lab(4, [a, b], p);
      await bt.runStartup();
      return { stageOrder: bt.phaseLog.filter(x => x.startsWith("STARTUP:")).map(x => x.split(":")[1]) };
    },
  },
  {
    id: "A05", group: "A", question: "同速单位的开局顺序如何决定？",
    inGameObservation: "双方各放一个完全同速的单位，反复开 20 局看第一次行动方是否固定",
    hypotheses: [{ id: "SPEED_THEN_RANDOM", note: "同速随机", apply: p => { p.tieBreak = "SPEED_THEN_RANDOM"; } },
                 { id: "UNRESOLVED", note: "未定（可能按站位）", apply: p => { p.tieBreak = "UNRESOLVED"; } }],
    run: async (p) => {
      const firsts: number[] = [];
      for (let s = 1; s <= 20; s++) {
        const a = makeTeam(0, "RED", [{ name: "R1", hp: 1e6, spd: 100, skills: [{ name: "x", base: 1 }] }], R, 0);
        const b = makeTeam(1, "BLUE", [{ name: "B1", hp: 1e6, spd: 100, skills: [{ name: "x", base: 1 }] }], R, 100);
        const bt = lab(s, [a, b], p);
        await bt.runStartup();
        firsts.push(bt.timeline.advance()!);
      }
      return { firstActors: [...new Set(firsts)].sort(), distribution: firsts.reduce((m: any, x) => (m[x] = (m[x] ?? 0) + 1, m), {}) };
    },
  },
  {
    id: "A06", group: "A", question: "开局拉条/推条是否在第一次行动前生效？",
    inGameObservation: "带『开局提升行动条』的效果，看第一回合是否由该单位抢到",
    hypotheses: [{ id: "APPLIED_BEFORE_FIRST_TURN", note: "先生效", apply: p => { p.__x = 1; } },
                 { id: "IGNORED_AT_START", note: "开局忽略", apply: p => { p.__x = 2; } }],
    run: async (p) => {
      const a = makeTeam(0, "RED", [{ name: "R1", hp: 1e6, spd: 90, skills: [{ name: "x", base: 1 }] }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1", hp: 1e6, spd: 100, skills: [{ name: "x", base: 1 }] }], R, 100);
      const bt = lab(6, [a, b], p);
      await bt.runStartup();
      if (p.__x === 1) bt.timeline.shift(a.entities[0].id, 0.3);
      return { firstActor: bt.timeline.advance() };
    },
  },
  {
    id: "A07", group: "A", question: "召唤物在开局的生成时点（相对先机）",
    inGameObservation: "带『开局召唤』的式神，看召唤物头像何时出现",
    hypotheses: [{ id: "SUMMON_BEFORE_SENKI", note: "召唤先", apply: p => { p.startup = { ...StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI, id: "SUM_FIRST", order: ["SPAWN","INIT_STATS","SOUL_START","PASSIVE_START","SUMMON","SENKI","FIELD","ORB_INIT","TIMELINE_INIT"] }; } },
                 { id: "SUMMON_AFTER_SENKI", note: "先机先", apply: p => { p.startup = StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI; } }],
    run: async (p) => {
      const a = makeTeam(0, "RED", [{ name: "R1" }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1" }], R, 100);
      const bt = lab(7, [a, b], p);
      await bt.runStartup();
      return { stageOrder: bt.phaseLog.filter(x => x.startsWith("STARTUP:")).map(x => x.split(":")[1]) };
    },
  },
  {
    id: "A08", group: "A", question: "开局鬼火变化的叠加顺序（多个『开局给火』）",
    inGameObservation: "同队两个单位都带开局给火，看最终鬼火是 4+2+2 还是只取一个",
    hypotheses: [{ id: "STACK_ALL", note: "全部叠加", apply: p => { p.__stack = true; } }, { id: "ONLY_ONE", note: "只生效一个", apply: p => { p.__stack = false; } }],
    run: async (p) => {
      const a = makeTeam(0, "RED", [
        { name: "R1", hooks: { senki: [(b: any) => { if (p.__stack !== false) b.teams[0].orbs.gain(2); }] } },
        { name: "R2", hooks: { senki: [(b: any) => { if (p.__stack !== false) b.teams[0].orbs.gain(2); }] } },
      ], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1" }], R, 100);
      const bt = lab(8, [a, b], p);
      await bt.runStartup();
      return { orbAfterStartup: bt.teams[0].orbs.orb };
    },
  },
  {
    id: "A09", group: "A", question: "双方同类型先机的相对顺序（红蓝）",
    inGameObservation: "红蓝双方各带同一个开局技能，看谁先写入",
    hypotheses: [{ id: "RED_FIRST", note: "红方先", apply: p => { p.__r = 1; } }, { id: "SPEED_FIRST", note: "速度快的先", apply: p => { p.__r = 2; } }],
    run: async (p) => {
      const order: string[] = [];
      const a = makeTeam(0, "RED", [{ name: "R1", spd: 100, hooks: { senki: [() => order.push("R")] } }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1", spd: 300, hooks: { senki: [() => order.push("B")] } }], R, 100);
      const bt = lab(9, [a, b], p);
      await bt.runStartup();
      return { order, note: p.__r === 1 ? "本实验室按注册顺序" : "本实验室按速度" };
    },
  },
  {
    id: "A10", group: "A", question: "开局被动的封印判定发生在何时？",
    inGameObservation: "若一方开局被封印/压制，其开局被动是否仍生效",
    hypotheses: [{ id: "SUPPRESS_BEFORE_PASSIVE", note: "封印先，被动不生效", apply: p => { p.__s = true; } },
                 { id: "PASSIVE_BEFORE_SUPPRESS", note: "被动先，仍生效", apply: p => { p.__s = false; } }],
    run: async (p) => {
      const fired: string[] = [];
      const a = makeTeam(0, "RED", [{ name: "R1", hooks: { passive: [() => fired.push("R1_PASSIVE")] } }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1" }], R, 100);
      const bt = lab(10, [a, b], p);
      if (p.__s) bt.bus.suppressedPassive.add(a.entities[0].id);
      await bt.runStartup();
      return { passiveFired: fired, suppressed: bt.bus.suppressedPassive.size > 0 };
    },
  },
];
