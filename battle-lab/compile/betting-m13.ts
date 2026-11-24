// compile/betting-m13.ts — match-13 kits (2026-11-24e), MAX (betting) mode only.
//
// The match-13 kits plug into betting-mechanics.ts through the match-7 hub (betting-m7.ts appends M13_KITS to its own
// list, so every BettingKit hook is dispatched the same way):
//   食梦貘 257 (betting-yumekui.ts) / 阿香 309 (betting-oko.ts) / 白童子 278 (betting-shiro.ts) / 久次良 332 (betting-kujira.ts).
// The other match-13 units already have kits (童男 / 辉夜姬 / 不知火 / 白藏主·Unbound / 云外镜 / 鲸汐千姬). Every kit checks
// `bettingActive()` and its own unit (skill ids) itself. In BASE mode nothing here is consulted.
import type { BettingKit } from "./betting-m7.ts";
import { KIT as YUMEKUI } from "./betting-yumekui.ts";
import { KIT as OKO } from "./betting-oko.ts";
import { KIT as SHIRO } from "./betting-shiro.ts";
import { KIT as KUJIRA } from "./betting-kujira.ts";

export const M13_KITS: readonly BettingKit[] = Object.freeze([YUMEKUI, OKO, SHIRO, KUJIRA]);
