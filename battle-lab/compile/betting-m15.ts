// compile/betting-m15.ts — match-15 kits (2026-11-24g), MAX (betting) mode only.
//
// The match-15 kits plug into betting-mechanics.ts through the match-7 hub (betting-m7.ts appends M15_KITS to its own
// list, so every BettingKit hook is dispatched the same way):
//   山兔 237 (betting-yamausagi.ts) / 一目连 272 (betting-ichimokuren.ts) / 垢尝 361 (betting-akaname.ts).
// The soul 海月火玉 (Wispzoa) is in soul/custom-effects-betting.ts. Every kit checks `bettingActive()` and its own unit
// (skill ids) itself. In BASE mode nothing here is consulted.
import type { BettingKit } from "./betting-m7.ts";
import { KIT as YAMAUSAGI } from "./betting-yamausagi.ts";
import { KIT as ICHIMOKUREN } from "./betting-ichimokuren.ts";
import { KIT as AKANAME } from "./betting-akaname.ts";

export const M15_KITS: readonly BettingKit[] = Object.freeze([YAMAUSAGI, ICHIMOKUREN, AKANAME]);
