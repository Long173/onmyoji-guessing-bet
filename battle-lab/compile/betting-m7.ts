// compile/betting-m7.ts — match-7 kits (2026-11-23g), MAX (betting) mode only.
//
// One aggregation point so that the match-7 kits plug into betting-mechanics.ts through a single set of hooks:
//   薰 298 (betting-kaoru.ts) / 遥念烟烟罗 572 (betting-enenra.ts) / 纺愿缘结神 554 (betting-enmusubi.ts) /
//   雪御前 591 (betting-yuki.ts) / 万年竹 275 (betting-mannendake.ts) / 花鸟卷 279 (betting-hana279.ts) /
//   鬼王酒吞童子 341 (betting-shuten.ts).
// Every kit module exports `KIT: BettingKit`; every hook it provides must check `bettingActive()` and its own
// unit (skill ids) itself. In BASE mode nothing here is installed or consulted.
import type { Entity } from "../kernel/entity.ts";
import { bettingActive } from "./betting-shared.ts";
import { KIT as KAORU } from "./betting-kaoru.ts";
import { KIT as ENENRA } from "./betting-enenra.ts";
import { KIT as ENMUSUBI } from "./betting-enmusubi.ts";
import { KIT as YUKI } from "./betting-yuki.ts";
import { KIT as MANNENDAKE } from "./betting-mannendake.ts";
import { KIT as HANA279 } from "./betting-hana279.ts";
import { KIT as SHUTEN } from "./betting-shuten.ts";
// Match 8 (2026-11-23h): see betting-m8.ts — its kits share this hub.
import { M8_KITS } from "./betting-m8.ts";
// Match 9 (2026-11-24a): see betting-m9.ts — its kits share this hub.
import { M9_KITS } from "./betting-m9.ts";
// Match 10 (2026-11-24b): see betting-m10.ts — its kits share this hub.
import { M10_KITS } from "./betting-m10.ts";
// Match 11 (2026-11-24c): see betting-m11.ts — its kits share this hub.
import { M11_KITS } from "./betting-m11.ts";

export type Hook = { kind: string; run: (battle: any, self: Entity, hurt: Entity[], primary?: Entity) => Promise<void> };
export type Installed = Array<{ entityId: number; mechanic: string }>;

export interface BettingKit {
  /** IR patches (merged into BETTING_IR_PATCHES). */
  patches?: Readonly<Record<string, { note: string; patch: Record<string, unknown> }>>;
  /** Effective onibi cost: receives the cost computed so far and returns the new one. */
  cost?: (battle: any, self: Entity, sk: any, base: number) => number;
  /** Replacement damage loop for a skill (null = not this kit). */
  damageHook?: (x: any) => Hook | null;
  /** End of an active cast; true = handled (stops the after-cast chain). */
  afterCast?: (battle: any, self: Entity, x: any) => Promise<boolean> | boolean;
  /** Skill choice that replaces the KB rules (null = not this kit). */
  ruleSkill?: (battle: any, self: Entity, costOf: (sk: any) => number) => { skill: any; rule: string } | null;
  /** Why a skill cannot be chosen right now (null = allowed). */
  gate?: (battle: any, self: Entity, sk: any) => string | null;
  /** Target override (null = not this kit). */
  target?: (self: Entity, x: any, cands: Entity[]) => { target: Entity; rule: string } | null;
  /** Battle installation (event handlers). */
  install?: (battle: any, entities: Entity[]) => Installed;
}

const KITS: readonly BettingKit[] = Object.freeze([KAORU, ENENRA, ENMUSUBI, YUKI, MANNENDAKE, HANA279, SHUTEN, ...M8_KITS, ...M9_KITS, ...M10_KITS, ...M11_KITS]);

export const M7_PATCHES: Readonly<Record<string, { note: string; patch: Record<string, unknown> }>> =
  Object.freeze(Object.assign({}, ...KITS.map(k => k.patches ?? {})));

export function m7Cost(battle: any, self: Entity, sk: any, base: number): number {
  if (!bettingActive()) return base;
  return KITS.reduce((c, k) => (k.cost ? k.cost(battle, self, sk, c) : c), base);
}

export function m7DamageHook(x: any): Hook | null {
  if (!bettingActive()) return null;
  for (const k of KITS) { const h = k.damageHook?.(x); if (h) return h; }
  return null;
}

export async function m7AfterCast(battle: any, self: Entity, x: any): Promise<boolean> {
  if (!bettingActive()) return false;
  for (const k of KITS) if (k.afterCast && await k.afterCast(battle, self, x)) return true;
  return false;
}

export function m7RuleSkill(battle: any, self: Entity, costOf: (sk: any) => number): { skill: any; rule: string } | null {
  if (!bettingActive()) return null;
  for (const k of KITS) { const r = k.ruleSkill?.(battle, self, costOf); if (r) return r; }
  return null;
}

export function m7Gate(battle: any, self: Entity, sk: any): string | null {
  if (!bettingActive()) return null;
  for (const k of KITS) { const g = k.gate?.(battle, self, sk); if (g) return g; }
  return null;
}

export function m7Target(self: Entity, x: any, cands: Entity[]): { target: Entity; rule: string } | null {
  if (!bettingActive()) return null;
  for (const k of KITS) { const t = k.target?.(self, x, cands); if (t) return t; }
  return null;
}

export function installM7(battle: any, entities: Entity[]): Installed {
  if (!bettingActive()) return [];
  return KITS.flatMap(k => k.install?.(battle, entities) ?? []);
}
