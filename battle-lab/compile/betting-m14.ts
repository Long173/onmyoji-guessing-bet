// compile/betting-m14.ts — match-14 kits (2026-11-24f), MAX (betting) mode only.
//
// The match-14 kits plug into betting-mechanics.ts through the match-7 hub (betting-m7.ts appends M14_KITS to its own
// list, so every BettingKit hook is dispatched the same way):
//   慧明灯 552 (betting-miakashi.ts) / 饴细工 368 (betting-amezaiku.ts) / 鬼使黑 211 (betting-kuromujou.ts) /
//   跳跳哥哥 233 (betting-kyonshiani.ts).
// The other match-14 units already have kits (云外镜 / 辉夜姬 / 鸩 / 鬼童丸 / 惠比寿 / 千姬). Every kit checks
// `bettingActive()` and its own unit (skill ids) itself. In BASE mode nothing here is consulted.
import type { BettingKit } from "./betting-m7.ts";
import { KIT as MIAKASHI } from "./betting-miakashi.ts";
import { KIT as AMEZAIKU } from "./betting-amezaiku.ts";
import { KIT as KUROMUJOU } from "./betting-kuromujou.ts";
import { KIT as KYONSHI } from "./betting-kyonshiani.ts";

export const M14_KITS: readonly BettingKit[] = Object.freeze([MIAKASHI, AMEZAIKU, KUROMUJOU, KYONSHI]);
