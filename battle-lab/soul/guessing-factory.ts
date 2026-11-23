// soul/guessing-factory.ts — M1.5A GuessingEntityFactory
// 竞猜路径：截图八维即权威输入。**不跑装备面板生成器。**
import { Entity, EntityType } from "../kernel/entity.ts";
import { makeExact, toDisplay, observe, bindExact } from "../kernel/stats.ts";
import type { ExactStats, DisplayStats, ObservedStats } from "../kernel/stats.ts";
import { StatSource, EntityMode, judgeLegality, assertNoStaticDoubleCount } from "./stat-source.ts";
import type { StatResolution } from "./stat-source.ts";
import { battleEffectsOf, compileSoulBook } from "./effects.ts";
import type { SoulDef } from "./loadout.ts";
import { bettingHpScale, BETTING_HP_SCALE_RULE } from "../compile/betting-policies.ts";
import { GameMath } from "../kernel/gamemath.ts";

export interface GuessingShikigamiInput {
  shikigamiId: number;
  /** 截图八维（整数 / 百分数） */
  observed: Partial<DisplayStats>;
  /** 御魂图标 -> 御魂 id 列表（用于组成 4 件套；静态属性一律不用） */
  soulIds?: number[];
}

export interface GuessingFactoryDeps {
  soulDefs: Map<number, SoulDef>;
  charMeta: Map<number, { name: string; type?: string }>;
}

export interface GuessingBuildResult {
  entity: Entity;
  resolution: StatResolution;
  observed: ObservedStats;
  /** 截图值 -> 可行区间（未坍缩为整数） */
  feasible: Array<{ key: string; displayed: number; range: [number, number] }>;
}

/** 竞猜口径：显示值 -> 可行区间中值作为初始精确值（保留区间不做坍缩） */
function exactFromGuessing(observed: Partial<DisplayStats>): ExactStats {
  const obs = observe(observed);
  const mid: any = {};
  for (const k of Object.keys(obs) as Array<keyof typeof obs>) {
    const o = obs[k];
    const isPct = k === "cri" || k === "crid" || k === "efh" || k === "efr";
    // 点估计直接取**显示值本身**：ROUND 口径下它正是取整区间的中心，
    // 且不会引入 (lo+hi)/2 那种 149.9999999995 的浮点毛刺。
    // 区间仍然完整保留在 feasible 里，供后续边缘化使用。
    mid[k] = isPct ? o.displayed / 100 : o.displayed;
  }
  return makeExact(mid);
}

export function makeGuessingEntity(
  id: number, teamId: number, input: GuessingShikigamiInput, deps: GuessingFactoryDeps,
): GuessingBuildResult {
  const meta = deps.charMeta.get(input.shikigamiId);
  const exact = exactFromGuessing(input.observed);
  const obs = observe(input.observed);
  const { ok, mismatches } = bindExact(obs, exact);

  const soulIds = input.soulIds ?? [];
  const defs = deps.soulDefs;
  const effectBook = compileSoulBook([...defs.values()]);
  const battleEffects = battleEffectsOf(soulIds, effectBook, defs);

  const resolution: StatResolution = {
    mode: EntityMode.GUESSING,
    source: StatSource.AUTHORITATIVE_OVERRIDE,
    exact,
    soulStaticApplied: false,          // ★ 竞猜绝不叠加御魂静态属性
    soulBattleEffects: battleEffects,
    legality: judgeLegality(EntityMode.GUESSING, { explainableByEquipment: null }),
    notes: [
      "面板来源 = AUTHORITATIVE_OVERRIDE（截图即真值）",
      "御魂静态属性未应用（避免重复计算）",
      battleEffects.length ? `已加载 ${battleEffects.length} 条御魂战斗效果` : "无 4 件套战斗效果",
    ],
  };
  assertNoStaticDoubleCount(resolution);

  // Betting (MAX) mode: real max HP = Lineup HP × BETTING_HP_SCALE (HYPOTHESIS, compile/betting-policies.ts).
  // Only the entity is scaled; resolution.exact keeps the screenshot value, so verifyGuessingPanel still
  // echoes the unscaled input. BASE: scale 1 ⇒ byte-identical.
  const hpScale = bettingHpScale();
  const hp = hpScale === 1 ? exact.hp : GameMath.roundAt(exact.hp * hpScale, "BETTING_HP_SCALE");   // integer max HP
  const e = new Entity(id, meta?.name ?? `shikigami#${input.shikigamiId}`, teamId, {
    atk: exact.atk, hp, def: exact.def, spd: exact.spd,
    cri: exact.cri, crid: exact.crid, efh: exact.efh, efr: exact.efr,
    dmgTakenB: 0, dmgTakenD: 0, healDown: 0,
  });
  if (meta?.type === "ONMYOJI") e.type = EntityType.ONMYOJI;
  e.notes.push("mode=GUESSING source=AUTHORITATIVE_OVERRIDE");
  if (hpScale !== 1) e.notes.push(`hpScale=${hpScale} (${BETTING_HP_SCALE_RULE.id}, ${BETTING_HP_SCALE_RULE.status}) lineupHp=${exact.hp} maxHp=${hp}`);
  e.notes.push("soulStatic=NOT_APPLIED battleEffects=" + battleEffects.map(b => b.name).join("/"));

  const feasible = Object.entries(obs).map(([k, o]: any) => ({ key: k, displayed: o.displayed, range: o.feasibleRange }));
  // 不做静默坍缩：把截图校验结果也记下来
  if (!ok) e.notes.push("display-mismatch:" + mismatches.join("; "));

  return { entity: e, resolution, observed: obs, feasible };
}

/** 竞猜单位面板自检：观察值 -> 精确 -> 回显，必须与原截图逐项一致 */
export function verifyGuessingPanel(r: GuessingBuildResult): { ok: boolean; detail: string[] } {
  const disp = toDisplay(r.resolution.exact);
  const detail: string[] = [];
  const dispIdx = disp as unknown as Record<string, number>;
  for (const [k, o] of Object.entries(r.observed) as any) {
    if (Math.abs(dispIdx[k] - (o as any).displayed) > 0.500001) detail.push(`${k}: ${dispIdx[k]} vs 截图 ${(o as any).displayed}`);
  }
  return { ok: detail.length === 0, detail };
}
