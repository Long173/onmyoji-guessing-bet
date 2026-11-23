// compile/max-level.ts — apply skill upgrade lines (SkillIR.levelScale) at max skill level.
//
// Why: compileSkill stores the upgrade lines ("伤害增加至120%", "消耗鬼火减少1点", …) in levelScale but
// nothing consumed them, so every skill ran with level-1 numbers. The betting mode uses max skills.
//
// Only unambiguous patterns are applied; everything else is recorded in `maxLevel.skipped` so the
// gap stays visible. Lines are applied in level order, so a later line overrides an earlier one.

export interface MaxLevelReport {
  applied: string[];
  skipped: string[];
}

const DAMAGE_TO = /伤害(?:系数)?(?:增加|提升|提高)至\s*(\d+(?:\.\d+)?)%/;
const COST_DOWN = /消耗鬼火减少\s*(\d+)\s*点/;
const HEAL_TO = /(?:治疗|恢复)(?:量|效果)?[^，。；]{0,8}?(?:增加|提升|提高)?至\s*(\d+(?:\.\d+)?)%/;
const SHIELD_TO = /(?:护盾|吸收)[^，。；]{0,8}?(?:增加|提升|提高)?至\s*(\d+(?:\.\d+)?)%/;

/**
 * Writes the max-level value to `ratioMax`, leaving `ratio` as the level-1 number from the text
 * (compiler audits compare `ratio` with the prose). Executors read `ratioMax ?? ratio`.
 */
function setSingle(list: any[] | undefined, value: number): boolean {
  if (!Array.isArray(list) || list.length !== 1) return false;
  list[0] = { ...list[0], ratioMax: value };
  return true;
}

function applyLine(x: any, line: string, rep: MaxLevelReport): void {
  const dmg = line.match(DAMAGE_TO);
  const cost = line.match(COST_DOWN);
  const heal = line.match(HEAL_TO);
  const shield = line.match(SHIELD_TO);
  let used = false;
  if (dmg) {
    if (setSingle(x.damage, Number(dmg[1]))) { rep.applied.push(`damage→${dmg[1]}%`); used = true; }
    else rep.skipped.push(`damage→${dmg[1]}% (${x.damage?.length ?? 0} damage slots)`);
  }
  if (cost) {
    const n = Number(cost[1]);
    x.cost = Math.max(0, (x.cost ?? 0) - n);
    if (x.orb) x.orb = { ...x.orb, cost: Math.max(0, (x.orb.cost ?? 0) - n) };
    rep.applied.push(`cost-${n}`); used = true;
  }
  if (heal && !dmg) {
    if (setSingle(x.heal, Number(heal[1]))) { rep.applied.push(`heal→${heal[1]}%`); used = true; }
    else rep.skipped.push(`heal→${heal[1]}% (${x.heal?.length ?? 0} heal slots)`);
  }
  if (shield && !dmg && !heal) {
    if (setSingle(x.shield, Number(shield[1]))) { rep.applied.push(`shield→${shield[1]}%`); used = true; }
    else rep.skipped.push(`shield→${shield[1]}% (${x.shield?.length ?? 0} shield slots)`);
  }
  if (!used && !dmg && !heal && !shield) rep.skipped.push(line.slice(0, 40));
}

/**
 * Skill level mode. "BASE" (default) keeps the repository's historical level-1 behaviour, so the
 * pinned fingerprints of the regression suite stay valid; "MAX" is what the betting mode needs and
 * is switched on by the prediction tools (matches/*.ts) or with env SKILL_LEVEL=MAX.
 */
export type SkillLevelMode = "BASE" | "MAX";
let mode: SkillLevelMode = (globalThis as any).process?.env?.SKILL_LEVEL === "MAX" ? "MAX" : "BASE";
export const setSkillLevelMode = (m: SkillLevelMode): void => { mode = m; };
export const skillLevelMode = (): SkillLevelMode => mode;

/** Mutates each SkillIR in place (before executors capture it) and attaches a `maxLevel` report. */
export function applyMaxLevel<T>(ir: T[]): T[] {
  if (mode !== "MAX") return ir;
  for (const x of ir as any[]) {
    const rep: MaxLevelReport = { applied: [], skipped: [] };
    const lines = [...(x.levelScale ?? [])].sort((a, b) => a.level - b.level);
    for (const { effect } of lines) {
      if (!effect || /无法升级/.test(effect)) continue;
      applyLine(x, String(effect), rep);
    }
    x.maxLevel = rep;
  }
  return ir;
}
