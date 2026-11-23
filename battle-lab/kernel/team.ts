import { OrbPool } from "./resource.ts";
import type { ResourcePolicy } from "./resource.ts";
import type { Entity } from "./entity.ts";

export class Team {
  id: number; name: string; members: Entity[] = []; orbs: OrbPool;
  summonSlots = 1; summons: Entity[] = [];
  constructor(id: number, name: string, resource: ResourcePolicy, summonSlots = 1) {
    this.id = id; this.name = name; this.orbs = new OrbPool(id, resource); this.summonSlots = summonSlots;
  }
  add(e: Entity): void { this.members.push(e); }
  aliveMembers(): Entity[] { return this.members.filter(m => m.alive && m.caps.countsForVictory); }
  /**
   * ★ 可被选中的成员（a1-4 §22 Targeting 必须独立系统）。
   * 与 aliveMembers 的区别：无敌 / 放逐 / 隐匿 的单位**仍然活着、仍然计入胜负**，
   * 但不能被敌方技能选中。此前 canBeTargeted 字段全库无人读取 —— 这些机制等于空转。
   */
  targetableMembers(): Entity[] { return this.members.filter(m => m.alive && m.caps.canBeTargeted); }
  aliveAll(): Entity[] { return [...this.members, ...this.summons].filter(m => m.alive); }
  /**
   * ★★ 第 98 轮：**胜负计数**（不是"存活数"）。
   *
   * 与 aliveMembers 的区别只有一个：把放置单位（召唤物/姿态体）也算进来，
   * 但仍然只数 `caps.countsForVictory`。此前这个字段的读者只有 aliveMembers（只看 members），
   * 于是召唤物**永远无法影响胜负**，而 tips_3896 / tips_6071 那两条胜利判定规则
   * （「若敌方只存在雷冢视为战斗胜利」「若场上只有余烬视为战斗失败」）根本无处落地。
   *
   * 召唤物建出来时 countsForVictory=false（见 Battle.addSummon），所以本函数在
   * **没有召唤物的对局里与 aliveMembers().length 逐值相同** —— 这一点由 g59 断言，
   * 保证它不是"顺手改了胜负口径"。
   */
  victoryCount(): number {
    const c = (l: Entity[]) => l.filter(e => e.alive && e.caps.countsForVictory).length;
    return c(this.members) + c(this.summons);
  }
}
