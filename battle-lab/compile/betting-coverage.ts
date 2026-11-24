// compile/betting-coverage.ts — what the hand-written betting modules (compile/betting-*.ts) really cover.
//
// Read-only declarations for the reports (web readiness panel, Fidelity, unit tiles). Nothing here changes a
// battle. Every query answers for MAX (betting) mode only: in BASE mode the betting modules are not installed,
// so every query returns "nothing hand-written".
//
//   · bettingAiRuleOf(id)     — the unit's skill choice is decided by a hand-written betting rule
//                               (bettingPreferredSkill in betting-mechanics.ts returns a decision for it).
//   · bettingKitSkillOf(id)   — a betting module implements this skill's mechanics (FULL = everything the
//                               skill text states runs; PARTIAL = hand-written, with the riders listed as not
//                               modelled in the module header still missing).
//   · bettingNeverCastOf(id)  — the betting AI provably never casts this skill: derived from the gates
//                               themselves (ungaikyoGate / senhimeGate / nyunaiGate), not a second list.
//
// Anti-drift: battle-lab/tests/g135-betting-coverage.ts checks that every declared AI rule really returns a
// decision in a MAX battle (and that undeclared units get none), that every kit skill id is referenced by the
// module named here, and that every never-cast skill is refused by bettingGate.
import { skillLevelMode } from "./max-level.ts";
import { ungaikyoGate } from "./betting-ungaikyo.ts";
import { senhimeGate } from "./betting-senhime.ts";
import { nyunaiGate } from "./betting-nyunai.ts";
import { fengyangGate } from "./betting-fengyang.ts";

export type KitLevel = "FULL" | "PARTIAL";
export interface KitSkill { level: KitLevel; module: string; note: string }

const isMax = (): boolean => skillLevelMode() === "MAX";

/** Shikigami whose skill choice is a hand-written betting rule (module that holds the rule). */
export const BETTING_AI_RULES: Readonly<Record<number, string>> = Object.freeze({
  220: "betting-ai-rules.ts", 306: "betting-ai-rules.ts", 328: "betting-ai-rules.ts", 593: "betting-ai-rules.ts",
  280: "betting-kaguya.ts", 367: "betting-hana.ts", 369: "betting-shokurei.ts", 388: "betting-momiji.ts",
  331: "betting-hannya.ts", 365: "betting-nyunai.ts", 259: "betting-shishio.ts",
  575: "betting-fengyang.ts", 376: "betting-suzuhiko.ts", 355: "betting-otakemaru.ts", 372: "betting-inaba.ts",
  321: "betting-okuribito.ts",
  // Match 7 (wired through betting-m7.ts)
  341: "betting-shuten.ts",
  554: "betting-enmusubi.ts", 279: "betting-hana279.ts",
  298: "betting-kaoru.ts", 572: "betting-enenra.ts",
  591: "betting-yuki.ts",
  // Match 8 (wired through betting-m8.ts)
  200: "betting-momo.ts", 330: "betting-shiranui.ts", 201: "betting-yukionna.ts",
  // Match 9 (wired through betting-m9.ts)
  323: "betting-tenjo.ts", 287: "betting-hako.ts",
  356: "betting-senhime356.ts",
  // Match 10 (wired through betting-m10.ts)
  285: "betting-chin.ts", 595: "betting-hakuzosu.ts", 347: "betting-enmusubi347.ts",
  390: "betting-susabi390.ts", 346: "betting-seawatch.ts", 371: "betting-kawazaru.ts",
  // Match 11 (wired through betting-m11.ts)
  300: "betting-tamamo.ts",
});

const F = (module: string, note: string): KitSkill => ({ level: "FULL", module, note });
const P = (module: string, note: string): KitSkill => ({ level: "PARTIAL", module, note });

/** Skill id → hand-written implementation. Only skills whose module header documents the mechanics. */
export const BETTING_KIT_SKILLS: Readonly<Record<string, KitSkill>> = Object.freeze({
  // Kingyo 282 / Mishige 370 / Blazing Tamamonomae 339 (betting-mechanics.ts)
  "282_01": F("betting-mechanics.ts", "Fan Dance heals and buffs the Goldfish"),
  "282_02": F("betting-mechanics.ts", "Goldfish counter-rage every 8 enemy turns (damage, silence, push-back)"),
  "282_03": F("betting-mechanics.ts", "summons the Goldfish; not cast while a summon occupies the slot"),
  "370_02": F("betting-mechanics.ts", "food stacks gained per ally / enemy turn"),
  "370_03": F("betting-mechanics.ts", "unlocks at 6 stacks; highest-HP target, random hits, stack cost; 10-stack form"),
  "339_03": F("betting-mechanics.ts", "independent random target per hit with the repeat-hit decay"),
  // Inugami 220, Mushishi 306, Yoto Hime Scarlet Nightedge 593
  "220_02": F("betting-inugami.ts", "Guard marks and counters; the active part is never chosen by the betting AI"),
  "220_03": F("betting-inugami.ts", "5 hits, new random target per hit, repeat-hit decay, cost discount"),
  "306_02": F("betting-mushishi.ts", "25% damage immunity, Mark of Mushi, evolved heal"),
  "306_03": F("betting-ai-rules.ts", "dispel up to 4 allies, reduced heal on dispelled allies"),
  "593_02": F("betting-yoto.ts", "Bounty, Initiative cast, SPD and isolation riders"),
  "593_03": F("betting-yoto.ts", "6 hits, Bounty extra hit, kill scaling, free recast"),
  "593_04": F("betting-yoto.ts", "damage reduction, control immunity, counter once per turn"),
  // Senhime Resurgent 562, Ungaikyo 344
  "562_02": F("betting-senhime.ts", "passive part (control → ice sleep, shields, Night Whale on death); the active part is never cast"),
  "562_03": F("betting-senhime.ts", "Initiative illusion, cost reduction, Sea Frost storage, Day Whales"),
  "344_04": F("betting-ungaikyo.ts", "Yin/Yang form at battle start, split HP pools, Yang skill table"),
  "344_05": F("betting-ungaikyo.ts", "split HP pools, Yang Mirror Blessing at battle start; the skill itself is never cast"),
  "344_06": F("betting-ungaikyo.ts", "Yin AoE and Black Lotus hits per 30% HP lost (Yang form: its own skill table)"),
  // Kaguya 280, Virtuoso Hana 367, Shokurei 369, Inferno Ibaraki 322, Vampira 253
  "280_01": F("betting-kaguya.ts", "10% onibi removal from the enemy team"),
  "280_02": F("betting-kaguya.ts", "40% onibi on being attacked (allies too while the illusion is up)"),
  "280_03": F("betting-kaguya.ts", "illusion: DEF / RES, onibi chance, overdraft casting"),
  "367_02": F("betting-hana.ts", "Ink aura: healing received, RES, max HP, bar on painting end"),
  "367_03": P("betting-hana.ts", "painting, transfer damage, Blossom Rain heals; not modelled: summon-slot occupation, 1200% cap"),
  "369_01": F("betting-shokurei.ts", "vulnerability outside his turn"),
  "369_02": P("betting-shokurei.ts", "+50% damage outside own turn, assist; not modelled: L3 +30% assist chance"),
  "369_03": F("betting-shokurei.ts", "meal, protection, team heal, delayed feast damage"),
  "322_02": P("betting-ibaraki.ts", "+10% per extra enemy (max 50%); not modelled: L5 overkill carry-over, retarget"),
  "253_01": F("betting-vampira.ts", "sacrifices 10% current HP before the attack"),
  "253_02": F("betting-vampira.ts", "+4% damage per 1% HP lost"),
  // Garuda 378, Heartseeker Momiji 388, Vengeful Hannya 331, Nyunai-suzume 365 (match 5)
  "378_01": F("betting-garuda.ts", "consumes Feather Mark on hit"),
  "378_02": F("betting-garuda.ts", "shield bonus, Feather Mark chance, evolved heal (10% max HP; replay 4855 = 10% × Lineup HP × 2.42 HP scale), free ultimate (KB-only 10-attack removal not modelled)"),
  "378_03": F("betting-garuda.ts", "guaranteed Feather Mark on every enemy"),
  "388_01": F("betting-momiji.ts", "Leaf Blade form in Woods (bounces to the most-stacked enemy)"),
  "388_02": F("betting-momiji.ts", "Leaf Ember stacks, debuff / bar riders, crit reduction"),
  "388_03": F("betting-momiji.ts", "Woods stacks, Leaf Guard, Initiative cast"),
  "331_01": F("betting-hannya.ts", "field branch: 2 hits with 15% lifesteal"),
  "331_02": F("betting-hannya.ts", "9-stack cost, Seal Barrier, masks, closing debuff"),
  "331_03": F("betting-hannya.ts", "field branch: second AoE, L5 extra hits"),
  "365_01": F("betting-nyunai.ts", "DEF true damage, 40% / 100% assist"),
  "365_02": F("betting-nyunai.ts", "Initiative possession, lethal negation, Rotten Blood; the active part is never cast"),
  "365_03": F("betting-nyunai.ts", "max-HP corruption into Rotten Blood, per-ally SPD / RES / reduction"),
  // Kannazuki 596, Luminary Oitsuki 395, Shishio 259, Yato no Kami 373 (match 4)
  "596_02": F("betting-kannazuki.ts", "damage reduction for her and dream bearers"),
  "596_03": P("betting-kannazuki.ts", "dream stacks reduce onibi costs; not modelled: Dream God bonus, Sweet Dream, L2/L3/L5 riders"),
  "395_02": F("betting-oitsuki.ts", "gauge cells, Moonlight stacks on turn end and overflow, Initiative cells"),
  "395_03": F("betting-oitsuki.ts", "Gathered Light marks, Flowing Light, Faded Colour"),
  "259_02": F("betting-shishio.ts", "Endless Life stacks, control reflect, bar on enemy onibi skills"),
  "259_03": F("betting-shishio.ts", "push-back, stun, extra hits per stack"),
  "373_01": F("betting-yato.ts", "bats feed Dance stacks"),
  "373_02": F("betting-yato.ts", "lifesteal, Dance stacks, 7-stack strike"),
  "373_03": F("betting-yato.ts", "Shelter, Night Wedge (7 wedges), reset strikes"),
  // Fengyang 575, Suzuhikohime 376, Monumental Otakemaru 355, Inaba Kaguya Hime 372, Chocho 241, Peach Maki 310,
  // Kuro 277, Okuribito 321 (match 6)
  "575_01": F("betting-fengyang.ts", "style variants: Cold Snow 2 hits with Deep Freeze, Clear Sky 3 hits"),
  "575_02": P("betting-fengyang.ts", "styles, 50% reduction, Shelter, +100% bar, Wanted; not modelled: L3 push counter, L4 SPD"),
  "575_03": F("betting-fengyang.ts", "style variants: Snow Shadow freeze AoE, Bright Sun 25/35/180% AoE, style costs"),
  "376_02": F("betting-suzuhiko.ts", "Divine Fire, ally-turn heals, cast heals, Undying Flame (DEF + Crit RES 100% / allies 40%)"),
  "376_03": F("betting-suzuhiko.ts", "repeat loop on HP / onibi / Wish Power, kill restore, DEF-ignore stacks"),
  "355_01": F("betting-otakemaru.ts", "Foot Erosion that turns into Foot Pressure after the bearer's turn"),
  "355_02": F("betting-otakemaru.ts", "Upper Hand Soul Command form, Foot Marsh, death heal, Returned Bones form"),
  "355_03": F("betting-otakemaru.ts", "L5 buff dispel, Foot Erosion in Soul Command form, Foot Marsh cost"),
  "372_02": P("betting-inaba.ts", "Upper Hand illusion, Wish Power, Wish Blessing; not modelled: L2 soul onibi conversion"),
  "372_03": F("betting-inaba.ts", "Challenge, next-cast discount, Wish Power riders, L4 ignore, L5 rabbit"),
  "241_02": F("betting-chocho.ts", "SPD stacks from the lowest ally HP ratio, 4-stack cost reduction"),
  "241_03": F("betting-chocho.ts", "Butterfly Dance heal after damage (once per turn)"),
  "310_02": F("betting-chocho.ts", "30% chance to halve damage taken"),
  "277_02": F("betting-kuro.ts", "free Chain Slash on hit (cooldown 2, not on the lethal hit), Upper Hand Soul Return counted on his own turns only"),
  "277_03": F("betting-kuro.ts", "extra hits per 30% HP lost, free follow-up after a kill"),
  "321_02": F("betting-okuribito.ts", "Soul Rift stacks and their indirect damage, removal by a normal attack"),
  "321_03": F("betting-okuribito.ts", "Orie stats, counters after enemy turns with the onibi bonus, cooldown"),
  // Oitsuki 295, Doujo 213 (match-5 replay review)
  "295_02": F("betting-oitsuki295.ts", "Initiative +4 onibi-gauge cells, L5 partial Clear Moonlight paid with gauge cells"),
  "295_03": F("betting-oitsuki295.ts", "Moon's Blessing: other allies +20 SPD / +20% ATK, +1 gauge cell per ally turn end, until her next turn end"),
  "213_03": F("betting-doujo.ts", "sacrifices 20% current HP, heals other allies 10% of it (replay-calibrated), self heal below 30%"),
  // Match 7 (wired through betting-m7.ts): Demoniac Shuten Doji 341, Mannendake 275
  "341_01": F("betting-shuten.ts", "125%; in Demon King stance Torch the Sky 245% + 40% TRUE splash (no souls)"),
  "341_02": P("betting-shuten.ts", "control/banish immunity, heal −30%, Great Yokai Power damage / reduction per HP lost (×2 on himself); reduction cap 75% is an assumption"),
  "341_03": F("betting-shuten.ts", "40% push, 2 buffs dispelled, stance: ally turn-start burn 24%, damage guard, L3 recover, L5 control removal"),
  "275_01": F("betting-mannendake.ts", "125%, 30% Challenge of a random ally on the same target"),
  "275_02": F("betting-mannendake.ts", "turn-end Leaf Barrier; counters 60% (100% when he is hit), one per enemy action"),
  "275_03": F("betting-mannendake.ts", "Leaf Barrier + 15% of his ATK to every ally, sustained 1 of his turns"),
  // Bondweaver Enmusubi 554, Hana 279 (match 7)
  "554_01": F("betting-enmusubi.ts", "L5 +1 Divine Power"),
  "554_02": F("betting-enmusubi.ts", "Red bond on the highest-ATK ally, 2 Divine Power, recast dissolve + full cleanse, +30% bar both ways, her bar immunity / bonded ally's push immunity"),
  "554_03": F("betting-enmusubi.ts", "heal 8% own max HP (others at 3+ stacks), Worldly Bond red extra turn -2 cost / blue cleanse + 50% DR, L2 onibi, L3 Shelter, L4 shield, L5 crit-damage share"),
  "279_01": P("betting-hana279.ts", "1-3 birds, 40% per bird, 80% heal per hit; not modelled: bird cost of counterattacks"),
  "279_02": F("betting-hana279.ts", "30% +30% bar on action end, 30% bird-consuming control block"),
  "279_03": F("betting-hana279.ts", "12% team heal, Fragrance 11% / 10% before the next two turns"),
  // Kaoru 298, Nostalgic Enenra 572 (match 7)
  "298_01": F("betting-kaoru.ts", "L5: 15% push-back on a target with 4+ buffs"),
  "298_02": F("betting-kaoru.ts", "Play/Alert switch at every turn start (Alert +15 SPD / +60% RES), L5 +10% ally damage in Play"),
  "298_03": F("betting-kaoru.ts", "Owl's Guard on one ally (absorb + record, 60% HP loss on removal, cap 200% Kaoru HP, Upper Hand), 1 dispel per ally, Owl's Dance in Alert, +4 onibi"),
  "572_02": F("betting-enenra.ts", "Smoke Formlessness: entries on hit (max 2 per own turn), blocks one enemy skill, +15% bar, L3 hit shields, cast shield 25% max HP, Upper Hand"),
  "572_03": F("betting-enenra.ts", "2x51% AoE + 131% final ignoring souls/passives, Smoke Phantom morph 58%/72%, 49% burst on expiry"),
  // Yuki Gozen 591 (match 7)
  "591_02": F("betting-yuki.ts", "Gentian Glass: battle-start / cast / on-kill summon at the victim's bar, 360% initial ATK HP (no betting HP scale), re-summon +39% x3 and full heal, 50% max-HP strike on the lowest-HP enemy, untargetable and never countered (no expiry in the text), Yuki damage-immune while it lives, Snowy Edge stacks"),
  "591_03": F("betting-yuki.ts", "9 x 27% slashes, 2 Snowy Edge -> first slash is a 108% Snow Burst on all enemies (+50% on the target), L5 retarget to the lowest-HP enemy"),
  // Match 8 (wired through betting-m8.ts): Hitotsume 230, Momo 200, Amaterasu 556
  "230_02": F("betting-hitotsume.ts", "Diamond Sutra on every ally when he takes damage: +20% effect RES, 20% FIXED reflection, 1 turn"),
  "200_02": F("betting-momo.ts", "25% of her max HP to the lowest-HP-ratio ally (can crit), 30% of the requested heal splashed to the others, In Bloom +30% damage on everyone healed"),
  "200_03": P("betting-momo.ts", "generic revive + 25% of her max HP, then the 30% splash and In Bloom; not modelled: the wiki's 2-turn cooldown"),
  "556_02": F("betting-amaterasu.ts", "70% echo of the Heavenly Radiance bearer's skill hits during Amaterasu's turn, Light Cleansing on attackers (-40% damage to her, -150 DEF), L5 kill +50% bar"),
  "556_03": F("betting-amaterasu.ts", "highest-HP target; Heavenly Radiance to the other ally with the highest initial panel ATK (-15% ATK, +20% bar, 1-HP save), sustained 2 turns"),
  "330_01": F("betting-shiranui.ts", "2 × 60%; in Parting Sorrow Final Dance 2 × 72% with Parting Fire (double damage on a marked target)"),
  "330_02": P("betting-shiranui.ts", "dance (5% current HP → ally +80% RES, 100% in the barrier), lethal → Parting Sorrow stance (wiki numbers); active cast never chosen by the AI"),
  "330_03": F("betting-shiranui.ts", "Sparkfire Barrier 2 of her turns (+10% dmg, +25 SPD, 10% DR, +2%/onibi), extra basic attack (ignore 200 DEF, 30% lifesteal), Upper Hand (opens at the first turn start); stance: Blazing Flame 144% AOE, -1 cost per KO'd ally"),
  "555_01": F("betting-kusa.ts", "120% on an enemy, then spends 200% initial ATK of Dandelion Force as TRUE damage to the same target"),
  "555_02": F("betting-kusa.ts", "Dandelion Force from overflow heals (1800% cap per window), Seeds (L5 Upper Hand, turn end self + L4 allies, every removed seed heals 35% ATK (can crit), indirect-damage conversion), L2 DEF/SPD, L3 ATK, pursuits 30% per 345% ATK (max 3)"),
  "555_03": F("betting-kusa.ts", "183% to all enemies, 340% (+120%/skill use, L5, max +360%) initial ATK of force split evenly, heal all allies 35% ATK (can crit)"),
  "201_01": F("betting-yukionna.ts", "120%, 50% base chance slow -10 SPD for 2 turns (one slow per source, refreshed)"),
  "201_02": F("betting-yukionna.ts", "turn-end Ice Armor Shield on self + the 2 highest-crit-damage allies, 12% of her max HP, replaced each of her turns; 50% base slow on attackers; +40% initial ATK vs Frozen / Deep Frozen"),
  "201_03": F("betting-yukionna.ts", "3 waves x 36% on every enemy; per hit 8% base Freeze (+10 points on the final chance vs a slowed target), 30% Deep Freeze conversion on a Frozen target, 16% base slow"),
  // Match 9 (wired through betting-m9.ts): Tenjo Kudari 323, Hako Shoujo 287
  "323_02": F("betting-tenjo.ts", "Rain Shelter: +25% effect RES on non-summon allies (+50% self), L5 heal 5% of the ally's max HP at its turn start; sealed by passive suppression"),
  "323_03": P("betting-tenjo.ts", "awake yokai house (own turn, or Joy Mark + actionable) +20% damage on non-summon allies; 3 Joy Marks: +1 onibi and +25% action bar per other ally turn end; not modelled: fandom +75% self RES while awake"),
  "287_02": F("betting-hako.ts", "8% max-HP shield (2 turns, replaced) + 1 random buff before each ally acts; evolved: 1 random debuff (contested) on enemy attackers, once per action"),
  "287_03": F("betting-hako.ts", "records allies' HP for 2 of her turns, recovers to 60% of the record on expiry; lethal hit on a recorded ally ⇒ immune + takes effect now; cooldown 2"),
  // Match 9: Senhime 356 (base SSR; not Senhime Resurgent 562)
  "356_01": P("betting-senhime356.ts", "L5: +1 Tidal Sound while the halberd is present (the 125% hit is the generic path)"),
  "356_02": F("betting-senhime356.ts", "passive +10% action bar after each non-summon enemy turn; Tide Dream (halberd present, contested): -3 onibi after the bearer acts, L5 Deep Freeze at 0 onibi"),
  "356_03": P("betting-senhime356.ts", "halberd (kernel summon, 30% presence heal) + L2 30% DR, L3 Tidal Sound per onibi paid, L5 3 stacks, 7 stacks = +3 onibi / +15% team damage (max 5); fandom Tide of Eternity (2 onibi, 120% + 100%/Dirge, pulls the halberd); L4 read as immunity while unplanted"),
  // Match 9: Aoandon 266, Dreambound Chocho 594
  "266_01": F("betting-aoandon.ts", "120%, 30% chance to drain 1 onibi from the enemy side to hers (no unconditional +1 onibi)"),
  "266_02": P("betting-aoandon.ts", "Bright Lantern at another allied shikigami's turn start (40% − 3%/onibi): free skills that turn, +5% damage per onibi, removed when she dies; not modelled: fandom-only Candlelight overflow counter"),
  "266_03": F("betting-aoandon.ts", "190% to all enemies, 30% drain per enemy hit, one TRUE hit per onibi of lead (5% max HP, cap 100% initial ATK), L5 Bright Lantern (free skills, 1 turn) on the top-ATK ally"),
  "594_02": P("betting-chocho594.ts", "Dream Cocoon 20% max HP (2 turns, max 2, +20% damage, L3 excess-damage immunity); L4 free cast after 20% initial HP taken in a turn (once per own turn); not modelled: replaces Sleep"),
  "594_03": F("betting-chocho594.ts", "heals 15% of each ally's own max HP, 30% on the selected target, +20% damage 1 turn, Dream Cocoon 50% of the target's heal, L5 Upper Hand cast on the top initial-ATK ally"),
  // Match 9: Asura 364, Kidomaru 345
  "364_01": F("betting-asura.ts", "spends 1 Reason, 120%; a kill puts Annihilation (ATK -50%) on the victim and switches to Endless Slaughter"),
  "364_02": P("betting-asura.ts", "Reason 9 at battle / turn start, spend per target, -6% dealt per point, 8% heal per point restored, L5 -6% taken per point lost, control/banish immunity below 9, +10% vs slower initial SPD; Endless Slaughter (fandom 263% random unit + 113% to all others, allies included; +1 Reason per ally turn end) — its Reason spend is a reading"),
  "364_03": F("betting-asura.ts", "spends 1 Reason per enemy, 315% to all enemies, then 63% follow-ups (1 Reason each) until Reason runs out; L5 retarget to the lowest-HP enemy on a kill"),
  "345_01": P("betting-kidomaru.ts", "2 x 59% + Chains of Bone; counter-cast on an enemy bar increase (not chained, max 5 with assists per window); L5 +1 Frenzy at turn end on a chained target; not modelled: the 30% re-chain chance, single-target vs team bar boosts"),
  "345_02": P("betting-kidomaru.ts", "3 Frenzy -> Shura: 160% ATK shield, control immunity, Soul Hunt Frenzy 40% ATK to all (no souls) after each enemy turn, 3 uses or shield break; clears Frenzy and enemy chains; L5 next Shura Bone Chains -1 onibi per chain; not modelled: fandom's lethal-damage evolution"),
  "345_03": F("betting-kidomaru.ts", "3 x 90% + Chains of Bone, Concealment 3 turns (-20% taken, +33% ATK true damage per target, untargeted by enemy picks, lifted after an own-turn attack, L5 Upper Hand), +1 Frenzy at turn end; chain splash 60% ATK + reset; ally basic-attack assists"),
  // Match 10 (wired through betting-m10.ts): Chin 285, Zashiki 205, Hakuzosu Unbound 595, Enmusubi 347,
  // Divine Prophet Susabi 390, Seawatch Kingyo 346, Kawazaru 371
  "285_01": F("betting-chin.ts", "100% + 2 Poison Feather stacks (contested)"),
  "285_02": P("betting-chin.ts", "2 stacks on all enemies; stack tick 2/6/12/20/30% of the bearer's max HP (cap 280% ATK, -50 DEF per stack), -1 stack per turn; attacker retaliation; L5 overflow 30%; not modelled: a separate 2-turn timer"),
  "285_03": F("betting-chin.ts", "L4 3 stacks, 210%, consumes every stack for 42% ATK indirect each, L5 free Poison Blossom (1 stack) if the target survives"),
  "205_02": F("betting-zashiki.ts", "Initiative: +3 onibi at battle start"),
  "205_04": F("betting-zashiki.ts", "+3 onibi, sacrifices 20% of current HP"),
  "595_02": F("betting-hakuzosu.ts", "ally other than self (highest ATK): 20% lost HP recovered, Guardian Seal 2 turns (one per side): own-turn damage immunity, Talisman: Break on attackers (-30% damage, 8% of her max HP per turn); L5 Initiative seal; Onmyoji riders inert"),
  "595_03": P("betting-hakuzosu.ts", "needs an allied Seimei; replaced by Oath of Dream Mountain, which has no text in the data: never cast, she normal-attacks instead"),
  "347_02": F("betting-enmusubi347.ts", "random bond before each other ally's turn: match = +1 onibi and +1 Bond (max 7), miss = Bond Renewed (extra turn after hers, skills -3 onibi)"),
  "347_03": F("betting-enmusubi347.ts", "Sanctuary on the highest crit-damage ally, all allies +40% damage (+5%/Bond) and 9% (+1%/Bond) max-HP heal (can crit); L2 overheal shield, L3 +30 SPD, L4 Bond Renewed + self Sanctuary, L5 Initiative Sanctuary"),
  "390_01": F("betting-susabi390.ts", "L5: a normal attack in the realm adds 1 Starburst (max 6)"),
  "390_02": P("betting-susabi390.ts", "Starry River realm, 6 Starbursts (72% AoE indirect, +25% ramp up to 75%, 8% heal, Star Power), allies -20% normal-attack damage, self -40%, end +30% bar, L4 Initiative; L5 bursts with enemy passives suppressed; the prophecy is settled at the end of the enemy action; not modelled: the Star Power control cleanse"),
  "390_03": F("betting-susabi390.ts", "139% AoE + one 68% AoE hit per Star Power (all consumed); L4 adds 3 Starbursts in the realm"),
  "346_02": P("betting-seawatch.ts", "Focus after each enemy turn (Initiative 4, at 8: cleanse + Fishtail Cluster or +25% team bar), 80% ATK undispellable shield when none; not modelled: Riverflow Bind (no text)"),
  "346_03": F("betting-seawatch.ts", "3 Grudge on an enemy without Grudge, Fishtail Cluster until her next turn ends (+10% team bar, Surge stacks, heal 50% ATK x3 at <=50% HP after each ally turn, Surge 50%+3%/trigger (cap 80%) indirect, 150% on Grudge bearers, -30% / -60% non-crit damage taken)"),
  "371_02": F("betting-kawazaru.ts", "after the 3 papers: normal attacks apply -40% effect RES and +40% damage taken for 2 turns (contested)"),
  // Match 11 (wired through betting-m11.ts): Kagewani 375, Ebisu 268, Ootengu 217, Tamamonomae 300
  "375_02": P("betting-kagewani.ts", "60% Shadow Devour per enemy per cast (contested), 2 stacks -> 30% ATK burst + 3% max-HP self heal; not modelled: the burst ignoring shields (dealt as indirect damage)"),
  "375_03": F("betting-kagewani.ts", "L5 Shadow Bind base chance 50% (the 2x30% AoE + 80% hit is the generic path)"),
  "268_01": F("betting-ebisu.ts", "L5: +30% Carp Streamer action bar while it is on the field"),
  "268_02": F("betting-ebisu.ts", "30% onibi when attacked (once per enemy attack)"),
  "268_03": P("betting-ebisu.ts", "Carp Streamer summon (60% HP, 140% SPD, debuff/control immune): 40% max-HP heal before each ally acts, L2 dispel 2, L4 +20/+30 SPD aura, L5 +1 onibi per Carp turn; not recast while present. Assumptions: DEF 0, enemy AoE hits spill onto it (the kernel never targets summons)"),
  "217_02": F("betting-ootengu.ts", "Shelter at battle start / turn end, 50% Heroic Bearing (+1% damage, cap 80, whole battle) per damage instance, L5 free Feather Blade Storm after a block"),
  "217_03": F("betting-ootengu.ts", "4 x 75% on all enemies, +1 Heroic Bearing and +5% bar per enemy hit, max 6 per cast"),
  "300_03": F("betting-tamamo.ts", "L5 chain: a kill by Foxfire / Fallen from Heaven casts the other for free at -20% damage per step (additive reading)"),
  "371_03": P("betting-kawazaru.ts", "3 forms in KB order with a 15% max-HP undispellable paper shield; You're a Bad Guy 180% on the top-ATK enemy, Quick, Hide heals 31% ATK; not modelled: the forms' base effects and Stop Chasing Me's buff (no text)"),
});

/** Module holding the hand-written skill choice of this shikigami, or null (MAX only). */
export function bettingAiRuleOf(shikigamiId: number): string | null {
  return isMax() ? BETTING_AI_RULES[Number(shikigamiId)] ?? null : null;
}

/** Hand-written implementation of a skill, or null (MAX only). */
export function bettingKitSkillOf(skillId: string | null | undefined): KitSkill | null {
  if (!isMax() || !skillId) return null;
  return BETTING_KIT_SKILLS[String(skillId)] ?? null;
}

/**
 * Why the betting AI never casts this skill, or null (MAX only). Asks the gates of the betting modules
 * themselves (a skill they refuse with a never-cast reason can never be chosen by selectSkillByAI).
 */
export function bettingNeverCastOf(skillId: string | null | undefined): string | null {
  if (!isMax() || !skillId) return null;
  const sk = { ir: { id: String(skillId) } };
  const gates: Array<[string, () => string | null]> = [
    ["betting-ungaikyo.ts", () => ungaikyoGate(sk)],
    ["betting-senhime.ts", () => senhimeGate(sk)],
    ["betting-nyunai.ts", () => staticGate(() => nyunaiGate(null, null as any, sk))],
    ["betting-fengyang.ts", () => fengyangGate(sk)],
  ];
  for (const [module, ask] of gates) {
    const g = ask();
    if (g && /NEVER_CAST/.test(g)) return `the betting AI never casts it (${module} gate; user-confirmed / KB AI)`;
  }
  return null;
}

/**
 * A gate that needs battle state (nyunaiGate's 腐化 rule reads the allies) cannot answer without a battle:
 * that is a state-dependent refusal, never a "never cast" — so it counts as "no static reason".
 */
function staticGate(ask: () => string | null): string | null {
  try { return ask(); } catch (e) {
    if (e instanceof TypeError) return null;
    throw e;
  }
}
