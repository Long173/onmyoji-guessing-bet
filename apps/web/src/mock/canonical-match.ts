// mock/canonical-match.ts — 用真实典型对局 #001 作为开发期 mock
// 数据来源：battle-lab/fixtures/guessing-match-canonical-001.json（游戏内阵容详情截图 1:1 录入）
import { GUESSING_SCHEMA_VERSION, newUnitId } from "../contracts/guessing-match.ts";
import type { GuessingMatch, GuessingUnitInput } from "../contracts/guessing-match.ts";

type Row = [string, number, number, number, number, number, number, number, number, number];
// 名称, id, 攻击, 生命, 防御, 速度, 暴击, 暴伤, 命中, 抵抗
const RED: Row[] = [
  ["三尾狐", 202, 5686, 17605, 792, 176, 85, 311, 0, 48],
  ["日和坊", 297, 3976, 16767, 524, 166, 45, 339, 0, 32],
  ["思金神", 601, 2630, 20424, 750, 128, 8, 150, 0, 86],
  ["跳跳弟弟", 225, 5059, 29362, 658, 116, 93, 276, 0, 80],
  ["聆海金鱼姬", 346, 3848, 16420, 561, 111, 35, 220, 0, 0],
];
const BLUE: Row[] = [
  ["座敷童子", 205, 2957, 26890, 1141, 180, 28, 164, 15, 104],
  ["夜溟彼岸花", 358, 5946, 16665, 506, 150, 80, 178, 0, 40],
  ["樱花妖", 267, 3873, 24799, 668, 147, 73, 157, 0, 63],
  ["缚骨清姬", 352, 3514, 14095, 586, 142, 43, 192, 0, 40],
  ["神启荒", 390, 4708, 15155, 536, 116, 10, 241, 30, 0],
];

function conv(rows: Row[]): GuessingUnitInput[] {
  return rows.map(([name, id, attack, hp, defense, speed, critRate, critDamage, effectHit, effectResist]) => ({
    unitId: newUnitId(), shikigamiId: id, name,
    stats: { attack, hp, defense, speed, critRate, critDamage, effectHit, effectResist },
    soulId: null,   // 御魂图标未识别；只影响战斗效果，不影响面板
  }));
}

export function canonicalMatch(): GuessingMatch {
  const now = new Date().toISOString();
  return {
    schemaVersion: GUESSING_SCHEMA_VERSION,
    id: "canonical-001",
    red: { units: conv(RED) },
    blue: { units: conv(BLUE) },
    ruleset: "GUESSING",
    source: { type: "FIXTURE", capturedAt: "2026-10-01", note: "Sample match #001 (entered from a real betting screenshot)" },
    createdAt: now, updatedAt: now,
  };
}
