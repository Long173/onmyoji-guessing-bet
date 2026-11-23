// kernel/end-on-lose.ts — ★★★ 第 246 轮：**「失去 X 时结束 Y」**（蝉冰雪女「永冬」362_03）
//
// 原文：「自身获得[buff_3622_1]，若失去[buff_3622_1]则结束[tips_3621]」。
//   引擎里「失去状态」本来就有派发点（`EV.STATUS_EXPIRE` 到期/耗尽 · `EV.STATUS_REMOVE` 被解除），
//   所以这一条不需要新概念 —— 一个挂在**拥有者**身上的「失去监视」处理器就够。
// ★ 安装点有两处，共用这一份实现（幂等：handler id 一样就跳过）：
//   · 主动技能：`compile/character.ts` 的施放点（这一条就是主动技能 —— 先施放、才获得要监视的那个 buff）；
//   · 被动技能：`compile/passive-runtime.ts` 的装配点（目前没有实例，但判据同一份，将来能直接用）。
// ★ 铁律延续第 239 轮：结束一个状态走 `expireStatus`（内部把状态花掉，不用 `remove` —— 它看 removable 标记，会静默失败）。
import type { Entity } from "./entity.ts";

export interface EndOnLoseSpec {
  /** 监视哪个状态被失去（KB buff id） */
  watchRef: string;
  /** 失去它以后要结束哪个控制状态（CONTROL_EFFECTS 的 id） */
  removeRef: string;
  removeName: string;
  clause?: string;
}

/** 装一个失去监视器。返回是否**新装**（已经装过 ⇒ false，不重复注册）。 */
export function installEndOnLose(battle: any, owner: Entity, spec: EndOnLoseSpec, skillName: string): boolean {
  const ownerId = owner.id;
  let installed = false;
  for (const code of ["STATUS_EXPIRE", "STATUS_REMOVE"]) {
    const hid = "end_on_lose:" + code + ":" + ownerId + ":" + skillName;
    if (battle.bus.hasHandler(hid)) continue;
    battle.bus.register({
      id: hid, ownerId, code, range: "ALL", priority: 0, passive: true, source: "PASSIVE",
      fn: async (ctx: any) => {
        if (!owner.alive) return;
        /**
         * ★★★ 实测（第 246 轮第一版）：**载荷形状两处不同** —— `AFTER_DAMAGE` 那类事件把数据包在 `input` 里
         *   （`{ input: {...}, result: {...} }`，第 239 轮的计数器就是照那个形状读的），
         *   而 `STATUS_EXPIRE` / `STATUS_REMOVE` 的载荷是**平铺**的（`{ entity, status, name, reason }`，见 kernel/battle.ts:1184）。
         *   第一版只读 `ctx.input.status` ⇒ 处理器装上了、派发也不报错，但**永远早退**（探针实测：trace 空、霜冻还在）。
         *   两种形状都认，才不会因为"发的人换了包装"就静默失效。
         */
        const lost = String(ctx?.input?.status ?? ctx?.status ?? ctx?.input?.name ?? ctx?.name ?? "");
        /**
         * ★★ 还必须确认**是"自己"失去的**：总线的 `range: "ALL"` 只按事件码分发，不看是谁的状态（实测：
         *   把派发方换成别人，处理器照样会跑）。载荷里的 `entity` 正是"失去状态的那个单位"，用它判最准。
         */
        const who: any = ctx?.input?.entity ?? ctx?.entity ?? null;
        if (who && Number(who.id ?? who) !== ownerId) return;
        if (lost !== String(spec.watchRef)) return;   // 只认监视的那一个（别的状态到期一概不管）
        for (const foe of battle.enemiesOf(owner.teamId)) {
          const st: any = (foe.statuses ?? []).find((x: any) => String(x?.def?.id) === String(spec.removeRef));
          if (!st) continue;
          const stacks = Number(st.stacks ?? 0);
          foe.expireStatus(st);
          battle.trace.push({ t: "STATUS_EXPIRE", id: foe.id, status: String(spec.removeRef), name: spec.removeName, stacks, reason: "ENDED_ON_LOSE" });
        }
      },
    });
    installed = true;
  }
  return installed;
}