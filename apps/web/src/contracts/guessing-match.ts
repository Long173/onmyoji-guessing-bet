// contracts/guessing-match.ts — ★ UI / Engine 边界契约（冻结）
// 规则：本文件**零依赖**，不得 import 任何 Engine 内部类型。
// 规则：**永远不出现 soulPieces[]** —— 那是 BuildMatch，不是 GuessingMatch。

export const GUESSING_SCHEMA_VERSION = 1 as const;

export const MatchSourceType = {
  MANUAL: "MANUAL",
  SCREENSHOT: "SCREENSHOT",
  JSON: "JSON",
  FIXTURE: "FIXTURE",
} as const;
export type MatchSourceType = (typeof MatchSourceType)[keyof typeof MatchSourceType];

/** 八维面板。百分比类以**百分数**存储（28 表示 28%），与游戏界面一致，避免录入歧义。 */
export interface GuessingStats {
  attack: number;
  hp: number;
  defense: number;
  speed: number;
  critRate: number;
  critDamage: number;
  effectHit: number;
  effectResist: number;
}

export interface GuessingUnitInput {
  /** 稳定 id，仅用于 UI 定位（交换/删除/重排时不变） */
  unitId: string;
  shikigamiId: number;
  /** 冗余存储名称，便于离线展示与导入可读性；引擎以 shikigamiId 为准 */
  name: string;
  stats: GuessingStats;
  /** 御魂图标对应的御魂 id；未识别时为 null（只影响战斗效果，不影响面板） */
  soulId: number | null;
}

export interface GuessingTeam {
  units: GuessingUnitInput[];
}

export interface GuessingMatch {
  schemaVersion: typeof GUESSING_SCHEMA_VERSION;
  id: string;
  red: GuessingTeam;
  blue: GuessingTeam;
  ruleset: "GUESSING";
  source?: {
    type: MatchSourceType;
    capturedAt?: string;
    note?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export const STAT_KEYS = ["attack", "hp", "defense", "speed", "critRate", "critDamage", "effectHit", "effectResist"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const PERCENT_STAT_KEYS: StatKey[] = ["critRate", "critDamage", "effectHit", "effectResist"];
export const STAT_LABELS: Record<StatKey, string> = {
  attack: "ATK", hp: "HP", defense: "DEF", speed: "Speed",
  critRate: "Crit", critDamage: "Crit DMG", effectHit: "Effect HIT", effectResist: "Effect RES",
};

export const TEAM_SIZE = 5;

let seq = 0;
export function newUnitId(): string { return "u" + (++seq).toString(36) + Math.random().toString(36).slice(2, 6); }

export function emptyStats(): GuessingStats {
  return { attack: 0, hp: 0, defense: 0, speed: 0, critRate: 0, critDamage: 150, effectHit: 0, effectResist: 0 };
}

export function emptyUnit(name = ""): GuessingUnitInput {
  return { unitId: newUnitId(), shikigamiId: 0, name, stats: emptyStats(), soulId: null };
}

export function emptyMatch(): GuessingMatch {
  const now = new Date().toISOString();
  return {
    schemaVersion: GUESSING_SCHEMA_VERSION,
    id: "m" + Date.now().toString(36),
    red: { units: Array.from({ length: TEAM_SIZE }, () => emptyUnit()) },
    blue: { units: Array.from({ length: TEAM_SIZE }, () => emptyUnit()) },
    ruleset: "GUESSING",
    source: { type: MatchSourceType.MANUAL },
    createdAt: now, updatedAt: now,
  };
}

/** 红蓝互换（UX 护栏 #1 需要它是一等操作） */
export function swapSides(m: GuessingMatch): GuessingMatch {
  const red = m.blue.units.map(u => ({ ...u, unitId: newUnitId() }));
  const blue = m.red.units.map(u => ({ ...u, unitId: newUnitId() }));
  return { ...m, red: { units: red }, blue: { units: blue }, updatedAt: new Date().toISOString() };
}
