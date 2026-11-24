// compile/betting-m9.ts — match-9 kits (2026-11-24a), MAX (betting) mode only.
//
// The match-9 kits plug into betting-mechanics.ts through the match-7 hub (betting-m7.ts appends M9_KITS to its own
// list, so every BettingKit hook — patches, cost, damageHook, afterCast, ruleSkill, gate, target, install — is
// dispatched the same way):
//   阿修罗 364 (betting-asura.ts) / 鬼童丸 345 (betting-kidomaru.ts) / 天井下 323 (betting-tenjo.ts) /
//   匣中少女 287 (betting-hako.ts) / 青行灯 266 (betting-aoandon.ts) / 梦引蝴蝶精 594 (betting-chocho594.ts) /
//   千姬 356 (betting-senhime356.ts; the base SSR, not 鲸汐千姬 562 in betting-senhime.ts).
// Every kit checks `bettingActive()` and its own unit (skill ids) itself. In BASE mode nothing here is consulted.
import type { BettingKit } from "./betting-m7.ts";
import { KIT as ASURA } from "./betting-asura.ts";
import { KIT as KIDOMARU } from "./betting-kidomaru.ts";
import { KIT as TENJO } from "./betting-tenjo.ts";
import { KIT as HAKO } from "./betting-hako.ts";
import { KIT as AOANDON } from "./betting-aoandon.ts";
import { KIT as CHOCHO594 } from "./betting-chocho594.ts";
import { KIT as SENHIME356 } from "./betting-senhime356.ts";

export const M9_KITS: readonly BettingKit[] = Object.freeze([ASURA, KIDOMARU, TENJO, HAKO, AOANDON, CHOCHO594, SENHIME356]);
