# Replay findings — open fix backlog

Findings from recorded duel-betting replays that are **not yet implemented**. Each item names the evidence. Frames are
in the session scratchpad (`replay/m*v/`) and are not kept in the repo.

## Match 7 (2026-11-23g, RED won; Red lost no unit) — items 1–5 done (2026-11-24)

1. **DONE: the Gentian Glass is not HP-scaled.** `YUKI.glassHpScaled = false`: HP = (360% + 39% per re-summon) × ATK, and
   the strike is 50% of that max HP (19893 / 3216 in the replay).
2. **DONE: the Glass is untargetable** (`setTargetable(false)`, `enemiesOf()` wrapper removed). Counters against it are
   blocked too (`untargetableInBetting`: Inugami, Mannendake, Yoto, 狰, 骰子鬼): before this, Inugami's counter still
   killed it. How it ends: the KB text (591_02, tips_5911) gives no duration, expiry or leave condition. It is debuff-immune
   and no AoE lists summons, so it stays all battle and Yuki is immune throughout.
3. **DONE (mechanics): Kuro's Soul Return.** Two bugs: (a) the kernel ticks TARGET_TURN statuses at the end of pseudo
   turns, so his free Chain Slashes burned 回魂. It is now counted on his own turns only. (b) Soul Rage rolled on
   the lethal hit at 0 HP: a dying Kuro got a free Chain Slash, and a saved Kuro had the rage on cooldown at once.
   Verified: 1 HP + 135% shield, works against counters, 4 hits per enemy at 1 HP (tests/betting-mechanics-13).
   Still rare in the sim (1/100 battles): Kuro is not focused in his 2-turn window (Kaoru's Owl on him in ~90%, and
   Blue spreads damage with free Sword Flurries). In the replay, 7 hits in a row on Kuro summed to exactly his 34952 HP.
4. **CHECKED, no change: Senhime's realm.** The replay shows ONE Senhime turn before her death (f852, Tidal Thought
   at 0 onibi), so "2 of her own turns" is consistent with the realm lasting until her death. Blue's 0 onibi came
   from Fortune Cat missing on Mannendake's 4 turns (1/16) and the first gauge reward only at f888. The sim's recasts
   come from 50% Fortune Cat procs and battles that are 3× too long.
5. **CHECKED, no change: Shuten's 6635.** That is a crit of the 125% basic: the sim's crits on Kuro average 5.5k (max 7.0k).
   The 2.1k figure was the non-crit mean.

Still open for match 7: the sim battle lasts ~80 top-level actions vs ~25 real, and Red still loses ~2.8 units vs 0.
Since the referee clock (2026-11-24; fewer rounds per action than the old fixed 8, no healing cut) m7 got worse: Red
63% (was 100%), ~240 actions, mostly "Yuki Gozen alone at 100% behind her untargetable Glass" vs a healed Blue side
that now lasts to the turn cap. The old ramp hid this; the Glass / Yuki immunity reading (item 2) needs another look.
Kernel follow-up (all modes, not changed): pseudo turns (counters / free casts) also tick SOURCE_TURN statuses,
e.g. Mannendake's own Bamboo Leaf Guard is consumed by his counters.

## Match 8 (2026-11-23h, BLUE won; Blue lost no unit; ~90 turns; sim ~53 → ~72 turns, Red 52.7% → 24.3%) — items 1–7 done or checked (2026-11-24)

1. **DONE: referee = a clock, not an action count.** Re-read of both videos: the referee is a koi-flag icon that runs on
   the turn-order bar like a unit and takes the current-actor slot when it fires. m8: banners right after Kusa's (SPD 114)
   1st, 2nd and 3rd turns, before Kaoru (213) / Mannendake (205) took their 2nd turns, and banner 3 came one Mannendake
   turn AFTER everyone had acted (so not "every unit acted"). m6: banners 1 and 2 each fell just before an Inaba (113)
   turn; Okuribito / Ungaikyo / Peach were held back (Red acted only 4 times in that replay). One rule fits both: a
   referee runner of speed 113 < v ≤ 114, ties to the unit. New default preset `REFEREE_CLOCK_114` (kernel/policies.ts,
   envRefereeClock in kernel/environment.ts, called after every action-bar advance); the old `REFEREE_15_10` (8 actions,
   −10% healing) is kept to revert (`BETTING_ENDGAME=REFEREE_15_10`). Sim now: m8 rounds after 10, 13–15, 11–14 … actions
   (replay 10, 13, ~11, ~15), m6 after 7–9 and ~17. **Effect:** the banner is followed by a green "DMG Dealt Up" on all
   ten units; healing is not cut and ATK-based heals do not grow (Kusa 1883 before round 1 → 2070 after round 7; her
   crit seed heal 4067 → 4117 across round 1), so it is modelled as damage dealt, not ATK. The size could not be
   measured cleanly (Amaterasu 1201 → 1225 on the same unit across round 1 hints it is small; crit / DEF noise
   elsewhere): +15%/round kept, **open**.
2. **DONE: the on-hit heal is Kusa's Seed, and heals crit.** 4067 = 1883 (her 35% heal at Bamboo-buffed ATK 5380) ×
   2.16 (her crit damage). It appears already on the first Red hit, so every removed seed heals (not only the last);
   seed / smash heals now crit with her crit stats (`betting-kusa.ts`).
3. **DONE (partly): Momo.** The main heal crits (kernel `healTarget` crit + new `onRequested`), the splash is 30% of the
   requested heal (overheal included; 13307 ×3 next to a capped 21533) and does not crit. Still open: her main heal's base
   reads 35% of her ×2.42 max HP (21521 × 2.06 = 44333) vs 30% modelled (25% × Tree Spirit 1.2).
4. **DONE: Shiranui's Upper Hand barrier opens at the first turn start, not at t = 0.** The replay order Kaoru >
   Mannendake > Hitotsume > Momo > Vampira > Yuki > Shiranui > Amaterasu > Inaba > Kusa only fits +25 SPD starting at
   Kaoru's first turn (from t = 0 Mannendake 230 would act first and Yuki 188 before Hitotsume). The sim now reproduces
   that first cycle exactly.
5. **DONE: Amaterasu.** Per-hit damage is right; the sim's ~50k per Holy Judgment came from multipliers stacking on 18
   hits (In Bloom +30%, Kaoru's Play +10%, and the early 8-action referee rounds). Heavenly Radiance now goes to the
   highest initial *panel* ATK ally (Hitotsume). The echo rule reads "during Amaterasu's turn" (Global "during self's
   turn"): the bearer's own turns no longer echo.
6. **CHECKED: Vampira.** Blood Rage (+4%/1% HP lost, separate multiplier) and Tomb Guard (+0.5% crit damage per 1%)
   match the text; her inflated output came from low HP (heals cut by the old referee, no Momo crits). Now ~48k per
   battle (was 61k); she still lands kills in the sim, **open**.
7. **CHECKED, no change: Kaoru.** 60% is right at max level (Global: 80% base, up2 70%, up4 60%); 29662 = 60% of a
   49.4k record. The settlement showed at her next turn (f2383), consistent with the kit's 1-turn sustain.
8. Confirmed: ×2.42 HP; the damage formula (Amaterasu 1197 vs 1201); Mannendake's Bamboo Whisper (+15% of his ATK flat).

## Match 5 (2026-11-23e, BLUE won) — still open

- Doujo's heals of 2304 / 2016 / 1728 / 1152 = 2880 × 0.8 / 0.7 / 0.6 / 0.4. CHECKED 2026-11-24: the referee does
  not cut healing (match 8), so this is not the referee ramp; the model stays "10% of her current HP". Unexplained.
- The sim still predicts Red (~67.7%).

## Match 3 (2026-11-23c, BLUE won) — still wrong (~87% Red), no replay recorded.
