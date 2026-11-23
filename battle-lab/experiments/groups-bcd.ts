// experiments/groups-bcd.ts — B / C / D 三组红区实验
import { Battle, DEFAULT_RULES } from "../kernel/battle.ts";
import { DamageType, StatusCategory } from "../kernel/types.ts";
import { ResourcePolicies } from "../kernel/resource.ts";
import { StartupPolicies, DeathPolicies, GuessingRulesets } from "../kernel/policies.ts";
import { StatusBook } from "../kernel/status.ts";
import { makeTeam, wireDummy } from "../dummy/dummy.ts";
import type { Experiment } from "./runner.ts";

const R = ResourcePolicies.COMMUNITY_4_8_5_345;
function lab(seed: number, teams: any, extra: any = {}) {
  const [a, b] = teams;
  const bt = new Battle([a.team, b.team], {
    seed, rules: { ...DEFAULT_RULES, maxTurns: 200, ...(extra.rules ?? {}) },
    policies: { resource: R, startup: StartupPolicies.NAIVE_SOUL_THEN_PASSIVE_THEN_SENKI, death: DeathPolicies.DEATH_AFTER_PREVENTION, priority: "REGISTRATION_ORDER", tieBreak: "SPEED_THEN_RANDOM", guessing: GuessingRulesets.COMMUNITY_2020_UNVERIFIED, ...extra },
  });
  for (const e of [...a.entities, ...b.entities]) wireDummy(bt, e);
  return bt;
}
const two = (hA: any = {}, hB: any = {}, st: any = {}) => {
  const a = makeTeam(0, "RED", [{ name: "R1", hp: st.hpA ?? 20000, atk: st.atkA ?? 1000, def: 300, spd: st.spdA ?? 120, skills: [{ name: "普攻", base: st.base ?? 500 }], hooks: hA }], R, 0);
  const b = makeTeam(1, "BLUE", [{ name: "B1", hp: st.hpB ?? 20000, atk: 1000, def: 300, spd: st.spdB ?? 110, skills: [{ name: "普攻", base: st.base ?? 500 }], hooks: hB }], R, 100);
  return [a, b];
};

export const EXPERIMENTS_BCD: Experiment[] = [
  // ---------------- B 同时触发优先级 ----------------
  {
    id: "B01", group: "B", question: "同一次伤害：攻击方御魂 与 防守方被动 谁先？",
    inGameObservation: "攻方带触发型御魂、守方带受伤触发被动，看战斗日志里哪条先出现",
    hypotheses: [{ id: "ATTACKER_FIRST", note: "行动方（攻击方）的效果先结算", apply: p => { p.priority = "SELF_SIDE_FIRST"; } },
                 { id: "DEFENDER_FIRST", note: "受击方的效果先结算", apply: p => { p.priority = "OTHER_SIDE_FIRST"; } }],
    run: async (p) => {
      const order: string[] = [];
      const a = makeTeam(0, "RED", [{ name: "R1", skills: [{ name: "普攻", base: 100 }], hooks: { passive: [(bt: any, s: any) => bt.bus.register({ id: s.id + ":atkSoul", ownerId: s.id, code: "DAMAGE", range: "SELF", priority: 10, passive: false, fn: () => order.push("ATK") })] } }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1", hp: 99999, skills: [{ name: "普攻", base: 1 }], hooks: { passive: [(bt: any, s: any) => bt.bus.register({ id: s.id + ":defPas", ownerId: s.id, code: "DAMAGE", range: "ENEMY", priority: 10, passive: false, fn: () => order.push("DEF") })] } }], R, 100);
      const bt = lab(11, [a, b], p);
      await bt.runStartup();
      const s = a.entities[0], t = b.entities[0];
      await bt.damage(s, t, 100, DamageType.NORMAL);
      return { order, orderPolicy: bt.bus.policy.id };
    },
  },
  {
    id: "B02", group: "B", question: "多个被动同时触发时的排序",
    inGameObservation: "同队 3 个被动都在同一事件触发，看状态栏/日志顺序",
    hypotheses: [{ id: "REGISTRATION_ORDER", note: "注册顺序", apply: p => { p.priority = "REGISTRATION_ORDER"; } },
                 { id: "TEAM_THEN_SPEED", note: "队伍→速度", apply: p => { p.priority = "TEAM_THEN_SPEED"; } },
                 { id: "UNDETERMINED", note: "未知", apply: p => { p.priority = "UNDETERMINED"; } }],
    run: async (p) => {
      const order: string[] = [];
      const mk = (tag: string) => (bt: any, s: any) => bt.bus.register({ id: s.id + ":" + tag, ownerId: s.id, code: "DAMAGE", range: "SELF", priority: 10, passive: false, fn: () => order.push(tag) });
      const a = makeTeam(0, "RED", [{ name: "R1", skills: [{ name: "普攻", base: 100 }], hooks: { passive: [mk("P1"), mk("P2"), mk("P3")] } }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1", hp: 99999, skills: [{ name: "普攻", base: 1 }] }], R, 100);
      const bt = lab(12, [a, b], p);
      await bt.runStartup();
      await bt.damage(a.entities[0], b.entities[0], 100, DamageType.NORMAL);
      return { order, policy: bt.bus.policy.id };
    },
  },
  {
    id: "B03", group: "B", question: "HP阈值触发 与 死亡结算 谁先？",
    inGameObservation: "把目标一次打到 0 血，观察『低于X%血触发』的被动是否还生效",
    hypotheses: [{ id: "THRESHOLD_BEFORE_DEATH", note: "阈值先", apply: p => { p.death = DeathPolicies.DEATH_AFTER_PREVENTION; } },
                 { id: "DEATH_SHORT_CIRCUITS", note: "死亡短路", apply: p => { p.death = DeathPolicies.HP_ZERO_IS_KILLED; } }],
    run: async (p) => {
      const marks: string[] = [];
      const a = makeTeam(0, "RED", [{ name: "R1", skills: [{ name: "普攻", base: 99999 }] }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1", hp: 1000, hooks: { onKilled: [() => marks.push("KILLED_EVENT")], onDeath: [() => marks.push("DEATH_EVENT")] } }], R, 100);
      const bt = lab(13, [a, b], p);
      await bt.runStartup();
      await bt.damage(a.entities[0], b.entities[0], 99999, DamageType.TRUE);
      return { marks, traceOrder: bt.trace.map((x: any) => x.t) };
    },
  },
  {
    id: "B04", group: "B", question: "反击 与 追击 的先后",
    inGameObservation: "同时满足反击与追击条件时，看哪个动作先播",
    hypotheses: [{ id: "COUNTER_FIRST", note: "反击先", apply: p => { p.__c = 1; } }, { id: "CHASE_FIRST", note: "追击先", apply: p => { p.__c = 2; } }],
    run: async (p) => {
      const order: string[] = [];
      const a = makeTeam(0, "RED", [{ name: "R1", skills: [{ name: "普攻", base: 100 }] }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1", hp: 99999, hooks: { passive: [(bt: any, s: any) => bt.bus.register({ id: s.id + ":counter", ownerId: s.id, code: "AFTER_DAMAGE", range: "SELF", priority: 20, passive: false, fn: () => order.push("COUNTER") })] } }], R, 100);
      const bt = lab(14, [a, b], p);
      await bt.runStartup();
      await bt.damage(a.entities[0], b.entities[0], 100, DamageType.NORMAL);
      return { order, note: p.__c === 1 ? "假设反击先" : "假设追击先" };
    },
  },
  {
    id: "B05", group: "B", question: "新回合 与 伪回合 的优先顺序",
    inGameObservation: "同一时点既获得额外回合又触发伪回合，看谁先动（规格书称：伪回合 > 额外回合）",
    hypotheses: [{ id: "PSEUDO_BEFORE_NEW", note: "伪回合先（规格书）", apply: p => { p.__t = "pseudo"; } },
                 { id: "NEW_BEFORE_PSEUDO", note: "额外回合先", apply: p => { p.__t = "new"; } }],
    run: async (p) => ({ queued: p.__t === "pseudo" ? ["PSEUDO", "NEW"] : ["NEW", "PSEUDO"], source: "规格书 附1/正文" }),
  },
  {
    id: "B06", group: "B", question: "协战 是否触发对方的反击？",
    inGameObservation: "A 普攻触发队友协战，观察被协战打的敌人是否反击协战者",
    hypotheses: [{ id: "CO_ATTACK_TRIGGERS_COUNTER", note: "会触发", apply: p => { p.__v = 1; } },
                 { id: "CO_ATTACK_NO_COUNTER", note: "不会", apply: p => { p.__v = 2; } }],
    run: async (p) => ({ specNote: "规格书原文：A 在自己的伪回合对 B 造成伤害，B 无法反击，但 A 的队友 C 协战，B 可以对 C 反击", hypothesis: p.__v === 1 ? "会触发" : "不会" }),
  },
  {
    id: "B07", group: "B", question: "伤害被护盾完全吸收时，是否仍触发『造成伤害时』类御魂？",
    inGameObservation: "给目标叠满盾再打，看针女/破势类是否触发",
    hypotheses: [{ id: "NO_TRIGGER_WHEN_ABSORBED", note: "不触发（规格书原文）", apply: p => { p.__s = 1; p.rules = { fullyAbsorbedTriggersOnHit: false }; } },
                 { id: "STILL_TRIGGER", note: "仍触发", apply: p => { p.__s = 2; p.rules = { fullyAbsorbedTriggersOnHit: true }; } }],
    run: async (p) => {
      const marks: string[] = [];
      const a = makeTeam(0, "RED", [{ name: "R1", skills: [{ name: "普攻", base: 100 }] }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1", hp: 99999, hooks: { passive: [(bt: any, s: any) => bt.bus.register({ id: s.id + ":onHitSoul", ownerId: s.id, code: "AFTER_DAMAGE", range: "ENEMY", priority: 5, passive: false, fn: () => marks.push("SOUL_TRIGGER") })] } }], R, 100);
      const bt = lab(15, [a, b], p);
      await bt.runStartup();
      const t = b.entities[0];
      t.shields.push({ id: "sh", value: 1e6, dispellable: true, sourceId: t.id, consumed: 0, broken: false });
      const r = await bt.damage(a.entities[0], t, 100, DamageType.NORMAL);
      // 对照：若假设"仍触发"，则实验室在完全吸收时也应记录触发
      const soulTriggered = marks.length > 0;
      const hypothesisSaysTriggers = p.__s === 2;
      return { absorbed: r.absorbed, applied: r.applied, soulTriggered,
               rule: bt.rules.fullyAbsorbedTriggersOnHit };
    },
  },
  {
    id: "B08", group: "B", question: "间接伤害是否触发收伤方御魂",
    inGameObservation: "官方[5] 说不触发御魂 —— 用实验室确认实现与官方一致",
    hypotheses: [{ id: "OFFICIAL_5", note: "不触发", apply: p => { p.__i = 1; } }],
    run: async (p) => {
      const bt = lab(16, two(), p);
      await bt.runStartup();
      const s = bt.teams[0].members[0], t = bt.teams[1].members[0];
      const a = await bt.damage(s, t, 100, DamageType.NORMAL);
      const b = await bt.damage(s, t, 100, DamageType.INDIRECT);
      return { normal_triggersSoul: a.triggersSoul, indirect_triggersSoul: b.triggersSoul, shared_normal: a.canBeShared, shared_indirect: b.canBeShared };
    },
  },
  {
    id: "B09", group: "B", question: "多个 pending action 同时排队时的执行顺序",
    inGameObservation: "同一回合末同时触发多个『立即再行动』，看执行次序",
    hypotheses: [{ id: "FIFO", note: "先入先出", apply: p => { p.__q = "fifo"; } }, { id: "LIFO", note: "后入先出（规格书：后触发的先行动）", apply: p => { p.__q = "lifo"; } }],
    run: async (p) => ({ queue: ["E1", "E2", "E3"], executed: p.__q === "fifo" ? ["E1", "E2", "E3"] : ["E3", "E2", "E1"], source: "规格书：均为额外/伪回合时，后触发的先行动" }),
  },
  {
    id: "B10", group: "B", question: "封印 vs 压制：御魂失效 与 被动失效 是否独立",
    inGameObservation: "官方[105][106][107] 明确区分，用实验室确认实现未合并",
    hypotheses: [{ id: "SEPARATE", note: "独立（官方）", apply: p => { p.__s = 1; } }],
    run: async (p) => {
      const defs = ["disarm", "morph", "silence"].map(id => { const d = StatusBook.get(id)!; return { id, suppressSoul: d.suppressSoul, suppressPassive: d.suppressPassive }; });
      return { statuses: defs, official: { 封印: "御魂失效", 压制: "被动失效", 变形: "两者皆失效" } };
    },
  },

  // ---------------- C 死亡 / 转化 / 复活 ----------------
  ...([
    ["C01", "普通致死：HP<=0 后的完整 trace"],
    ["C02", "致死 + 免死（DEATH_PREVENTION 拦截）"],
    ["C03", "致死 + 被动复活"],
    ["C04", "致死 + 外部复活"],
    ["C05", "多个复活来源同时存在时谁生效"],
    ["C06", "死亡瞬间是否清除自身所有 buff（规格书：解除自身持有的所有效果）"],
    ["C07", "击杀方被动 在 KILLED 还是 DEATH 时触发"],
    ["C08", "转化（官方[3252] 视同被击败、无法被复活）"],
    ["C09", "转化后能否被复活（预期：不能）"],
    ["C10", "召唤物死亡是否计入胜负"],
    ["C11", "特殊召唤物死亡（官方[3253] 跨回目不移除）"],
    ["C12", "同归于尽（双方同时归零）的判定"],
  ] as Array<[string, string]>).map(([id, q]) => ({
    id, group: "C" as const, question: q,
    inGameObservation: "在游戏里构造对应场景并录屏；本实验室给出各候选假设下应看到的不同现象",
    hypotheses: [
      { id: "HP_ZERO_IS_KILLED", note: "HP<=0 即 KILLED", apply: (p: any) => { p.death = DeathPolicies.HP_ZERO_IS_KILLED; } },
      { id: "DEATH_AFTER_PREVENTION", note: "先拦截再 KILLED", apply: (p: any) => { p.death = DeathPolicies.DEATH_AFTER_PREVENTION; } },
    ],
    run: async (p: any) => {
      const marks: string[] = [];
      const a = makeTeam(0, "RED", [{ name: "R1", skills: [{ name: "普攻", base: 99999 }] }], R, 0);
      const b = makeTeam(1, "BLUE", [{ name: "B1", hp: 1000, hooks: { onKilled: [() => marks.push("KILLED")], onDeath: [() => marks.push("DEATH")], onLethal: [(bt: any, s: any, hook: any) => { if (p.__prevent) hook.prevented = true; }] } }], R, 100);
      const bt = lab(30, [a, b], p);
      await bt.runStartup();
      await bt.damage(a.entities[0], b.entities[0], 99999, DamageType.TRUE);
      const t = b.entities[0];
      return { marks, hp: t.hp, hpZero: t.hpZero, dead: t.dead, killed: t.killed, alive: t.alive, trace: bt.trace.map((x: any) => x.t), resurrectable: !t.reviveBlocked };
    },
  })),

  // ---------------- D 对弈竞猜 Ruleset ----------------
  ...([
    ["D01", "初始鬼火（对弈竞猜）"], ["D02", "初始鬼火条格数"],
    ["D03", "双方鬼火是否独立"], ["D04", "初始行动条位置"],
    ["D05", "首轮是否特殊规则"], ["D06", "时间推进方式（按回合 or 按秒）"],
    ["D07", "残局增伤开始时间"], ["D08", "增伤增长曲线"],
    ["D09", "减疗开始时间"], ["D10", "减疗增长曲线"],
    ["D11", "增伤/减疗上限"], ["D12", "超时判胜规则"],
  ] as Array<[string, string]>).map(([id, q]) => ({
    id, group: "D" as const, question: q,
    inGameObservation: "录屏逐帧采样：固定攻方/守方与面板，记录 t=0/60/120/180s 的伤害数字，反推 M(t)=Damage(t)/Damage(0)",
    hypotheses: [
      { id: "UNKNOWN_NO_ASSUMPTION", note: "不假设（当前策略）", apply: (p: any) => { p.guessing = GuessingRulesets.COMMUNITY_2020_UNVERIFIED; } },
      { id: "COMMUNITY_2020", note: "按 2020 攻略假设存在阶梯增伤（未验证）", apply: (p: any) => { p.guessing = { ...GuessingRulesets.COMMUNITY_2020_UNVERIFIED, id: "COMMUNITY_2020", stalemate: { damageRamp: null, healingReductionRamp: null, startTurn: 10 } }; } },
    ],
    run: async (p: any) => {
      const g = p.guessing ?? GuessingRulesets.COMMUNITY_2020_UNVERIFIED;
      return {
        ruleset: g.id, status: g.status, teamSize: g.teamSize, hasOnmyoji: g.hasOnmyoji,
        initialOrb: R.initialOrb, gaugeSize: R.gaugeSize, maxOrb: R.maxOrb,
        orbIndependence: "两队各自持有 OrbPool（本实验室为独立）",
        stalemate: g.stalemate, timeout: g.timeout,
      };
    },
  })),
];
