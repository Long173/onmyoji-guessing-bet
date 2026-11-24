// compile/betting-m10.ts — match-10 kits (2026-11-24b), MAX (betting) mode only.
//
// The match-10 kits plug into betting-mechanics.ts through the match-7 hub (betting-m7.ts appends M10_KITS to its own
// list, so every BettingKit hook is dispatched the same way):
//   鸩 285 (betting-chin.ts) / 座敷童子 205 (betting-zashiki.ts) / 梦山白藏主 595 (betting-hakuzosu.ts) /
//   缘结神 347 (betting-enmusubi347.ts; the base SSR, not 纺愿缘结神 554 in betting-enmusubi.ts).
// Every kit checks `bettingActive()` and its own unit (skill ids) itself. In BASE mode nothing here is consulted.
import type { BettingKit } from "./betting-m7.ts";
import { KIT as CHIN } from "./betting-chin.ts";
import { KIT as ZASHIKI } from "./betting-zashiki.ts";
import { KIT as HAKUZOSU } from "./betting-hakuzosu.ts";
import { KIT as ENMU347 } from "./betting-enmusubi347.ts";
import { KIT as SUSABI390 } from "./betting-susabi390.ts";
import { KIT as SEAWATCH } from "./betting-seawatch.ts";
import { KIT as KAWAZARU } from "./betting-kawazaru.ts";

export const M10_KITS: readonly BettingKit[] = Object.freeze([CHIN, ZASHIKI, HAKUZOSU, ENMU347, SUSABI390, SEAWATCH, KAWAZARU]);
