// compile/betting-m11.ts — match-11 kits (2026-11-24c), MAX (betting) mode only.
//
// The match-11 kits plug into betting-mechanics.ts through the match-7 hub (betting-m7.ts appends M11_KITS to its own
// list, so every BettingKit hook is dispatched the same way):
//   影鳄 375 (betting-kagewani.ts) / 惠比寿 268 (betting-ebisu.ts) / 大天狗 217 (betting-ootengu.ts) /
//   玉藻前 300 (betting-tamamo.ts; the base SSR, not 烬天玉藻前 339 in betting-mechanics.ts).
// 御怨般若 331 (also in match 11) already has its kit (betting-hannya.ts). The 涂佛 soul is in
// soul/custom-effects-betting.ts. Every kit checks `bettingActive()` and its own unit (skill ids) itself. In BASE
// mode nothing here is consulted.
import type { BettingKit } from "./betting-m7.ts";
import { KIT as KAGEWANI } from "./betting-kagewani.ts";
import { KIT as EBISU } from "./betting-ebisu.ts";
import { KIT as OOTENGU } from "./betting-ootengu.ts";
import { KIT as TAMAMO } from "./betting-tamamo.ts";

export const M11_KITS: readonly BettingKit[] = Object.freeze([KAGEWANI, EBISU, OOTENGU, TAMAMO]);
