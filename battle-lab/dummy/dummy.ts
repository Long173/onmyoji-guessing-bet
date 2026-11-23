// dummy/dummy.ts — 可任意配置的 Dummy：制造控制变量实验，不模拟真实式神
import { Entity, EntityType } from "../kernel/entity.ts";
import { StatusBook } from "../kernel/status.ts";
import { DamageType, EV } from "../kernel/types.ts";
import { Team } from "../kernel/team.ts";
import type { ResourcePolicy } from "../kernel/resource.ts";
import type { Battle } from "../kernel/battle.ts";

export interface DummyHooks {
  senki?: Array<(b: Battle, self: Entity) => void>;
  passive?: Array<(b: Battle, self: Entity) => void>;
  soulStart?: Array<(b: Battle, self: Entity) => void>;
  onDeath?: Array<(b: Battle, self: Entity, killerId: number) => void>;
  onTurnStart?: Array<(b: Battle, self: Entity) => void>;
  onTurnEnd?: Array<(b: Battle, self: Entity) => void>;
  onLethal?: Array<(b: Battle, self: Entity, hook: { prevented: boolean }) => void>;
  onKilled?: Array<(b: Battle, self: Entity) => void>;
}

export interface DummySkillSpec {
  name: string; cost?: number; base?: number; rate?: number; type?: DamageType;
  heal?: number; healSelf?: boolean; recover?: boolean; loseHpTarget?: number;
  applyStatus?: string; statusDuration?: number; priorityPick?: (t: Entity[]) => Entity | undefined;
}

export interface DummyConfig {
  name: string; hp?: number; atk?: number; def?: number; spd?: number;
  cri?: number; crid?: number; team?: number; id?: number;
  skills?: DummySkillSpec[]; hooks?: DummyHooks; caps?: Partial<Entity["caps"]>;
  type?: EntityType;
}

export function makeDummy(cfg: DummyConfig, id: number, teamId: number): Entity {
  const e = new Entity(id, cfg.name, teamId, {
    hp: cfg.hp ?? 10000, atk: cfg.atk ?? 1000, def: cfg.def ?? 300,
    spd: cfg.spd ?? 100, cri: cfg.cri ?? 0, crid: cfg.crid ?? 1.5,
    dmgTakenB: 0, dmgTakenD: 0, healDown: 0,
  });
  if (cfg.type) e.type = cfg.type;
  if (cfg.caps) e.caps = { ...e.caps, ...cfg.caps };

  const h = cfg.hooks ?? {};
  // ★ 第 57 轮删掉了一个**从未被调用**的 reg 助手 —— 它的 id 里带着 Math.random()。
  //   死代码不执行，但 handler id 会进 BattleState（kernel/state.ts 的 busHandlers），
  //   留着它等于在"唯一入口"旁边摆一把上了膛的枪：谁哪天接上一根线就把不确定性带回来了。
  //   真正在用的是下面 wireDummy() 的 mk()，它的 id 是确定性的 `<实体id>:<code>:<range>`。

  e.skills = (cfg.skills ?? [{ name: "普攻", cost: 0, base: 1000, rate: 1, type: DamageType.NORMAL }]).map((s, i) => ({
    name: s.name, cost: s.cost ?? 0, selectable: true,
    pickTarget: s.priorityPick ?? ((_b: Battle, _a: Entity, enemies: Entity[]) => enemies[0]),
    execute: async (b: Battle, self: Entity, target: Entity) => {
      // 泛鬼火支付
      const cost = s.cost ?? 0;
      if (cost > 0 && !b.teams[self.teamId].orbs.pay(cost, "orb", "COST")) {
        const basic = self.skills.find((x: any) => (x.cost ?? 0) === 0);
        if (basic && basic !== self.skills[i]) { await basic.execute(b, self, target); return; }
        return;
      }
      if (s.base !== undefined) await b.damage(self, target, s.base, s.type ?? DamageType.NORMAL, s.rate ?? 1);
      if (s.loseHpTarget) b.lose(target, s.loseHpTarget);
      if (s.heal) await b.heal(self, s.healSelf ? self : target, s.heal, { recover: s.recover ?? false });
      if (s.applyStatus) {
        const def = StatusBook.get(s.applyStatus);
        if (def) target.addStatus(def, self.id, 1, s.statusDuration ?? 1);
      }
    },
  }));

  e.notes.push(JSON.stringify({ hooks: Object.keys(h) }));
  // 开局钩子（注册为 SENKI / BATTLE_START / 御魂 / 被动 四类，供 A 组实验区分先后）
  (e as any)._hooks = h;
  return e;
}

/** 把 Dummy 的 hooks 挂到 EventBus 上（顺序由 startup policy 决定） */
export function wireDummy(b: Battle, e: Entity): void {
  const h: DummyHooks = (e as any)._hooks ?? {};
  const mk = (code: string, fn: (ctx: any) => void, priority = 0, passive = false, range: string = "SELF") =>
    b.bus.register({ id: `${e.id}:${code}:${range}`, ownerId: e.id, code, range: range as any, priority, passive, fn });

  for (const f of h.senki ?? []) mk(EV.SENKI, () => f(b, e), 100);
  for (const f of h.soulStart ?? []) mk(EV.SOUL_START, () => f(b, e), 50);
  for (const f of h.passive ?? []) mk(EV.PASSIVE_START, () => f(b, e), 50, true);
  for (const f of h.onTurnStart ?? []) mk(EV.TURN_START, () => f(b, e), 10);
  for (const f of h.onTurnEnd ?? []) mk(EV.TURN_END, () => f(b, e), 10);
  for (const f of h.onDeath ?? []) mk(EV.DEATH, () => f(b, e, (b as any).__lastKiller ?? -1), 10);
  // ★ 第 91 轮：这三个此前都是**裸字符串**，打错字不会报错、只会永远不触发。
  for (const f of h.onLethal ?? []) mk(EV.LETHAL, (ctx: any) => f(b, e, ctx), 10);
  for (const f of h.onKilled ?? []) mk(EV.KILLED, () => f(b, e), 10);
  // DEATH_PREVENTION 拦截点
  const anyHook = h.onLethal ?? [];
  void anyHook;
}

/** 便捷：造一支全 Dummy 队伍 */
export function makeTeam(teamId: number, name: string, cfgs: DummyConfig[], resource: ResourcePolicy, startId: number): { team: Team; entities: Entity[] } {
  const team = new Team(teamId, name, resource, 1);
  const entities: Entity[] = [];
  cfgs.forEach((c, i) => { const e = makeDummy(c, startId + i, teamId); team.add(e); entities.push(e); });
  return { team, entities };
}
