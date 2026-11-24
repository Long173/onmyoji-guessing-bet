// compile/betting-m8.ts — match-8 kits (2026-11-23h), MAX (betting) mode only.
//
// The match-8 kits plug into betting-mechanics.ts through the match-7 hub (betting-m7.ts appends M8_KITS to its own
// list, so every BettingKit hook — patches, cost, damageHook, afterCast, ruleSkill, gate, target, install — is
// dispatched the same way):
//   独眼小僧 230 (betting-hitotsume.ts) / 桃花妖 200 (betting-momo.ts) / 天照 556 (betting-amaterasu.ts) /
//   不知火 330 (betting-shiranui.ts) / 渺念萤草 555 (betting-kusa.ts) / 雪女 201 (betting-yukionna.ts).
// Every kit checks `bettingActive()` and its own unit (skill ids) itself. In BASE mode nothing here is consulted.
import type { BettingKit } from "./betting-m7.ts";
import { KIT as HITOTSUME } from "./betting-hitotsume.ts";
import { KIT as MOMO } from "./betting-momo.ts";
import { KIT as AMATERASU } from "./betting-amaterasu.ts";
import { KIT as SHIRANUI } from "./betting-shiranui.ts";
import { KIT as KUSA } from "./betting-kusa.ts";
import { KIT as YUKIONNA } from "./betting-yukionna.ts";

export const M8_KITS: readonly BettingKit[] = Object.freeze([HITOTSUME, MOMO, AMATERASU, SHIRANUI, KUSA, YUKIONNA]);
