// compile/betting-m12.ts — match-12 kits (2026-11-24d), MAX (betting) mode only.
//
// The match-12 kits plug into betting-mechanics.ts through the match-7 hub (betting-m7.ts appends M12_KITS to its own
// list, so every BettingKit hook is dispatched the same way):
//   寻森小鹿男 551 (betting-shishio551.ts; not the SSR 小鹿男 259 in betting-shishio.ts) /
//   晴思日和坊 580 (betting-hiyoribou580.ts).
// The other match-12 units already have kits (追月神 295, 鸩 285, 天照 556, 缘结神 347, 鬼童丸 345, 妖刀姬·绯夜猎刃 593,
// 因幡辉夜姬 372, 匣中少女 287). The 元兴寺 soul is in soul/custom-effects-betting.ts. Every kit checks `bettingActive()`
// and its own unit (skill ids) itself. In BASE mode nothing here is consulted.
import type { BettingKit } from "./betting-m7.ts";
import { KIT as SHISHIO551 } from "./betting-shishio551.ts";
import { KIT as HIYORI580 } from "./betting-hiyoribou580.ts";

export const M12_KITS: readonly BettingKit[] = Object.freeze([SHISHIO551, HIYORI580]);
