# Side content: plan for what a player meets off the main path

The main path is done ([MAIN_PATH_PLAN.md](MAIN_PATH_PLAN.md)) and the screens a player opens from the start menu
are in ([SCREENS_PLAN.md](SCREENS_PLAN.md)). This plan takes the side content a player meets on the way to the
Hall of Fame, ordered by how often a player meets it: Prof. Oak's Pokédex rating, the move tutors / deleter /
relearner, the in-game trades (and the party selection they need), the Game Corner, the Name Rater, the fossils,
the Route 5 daycare, then eggs. `tests/unit/scriptCoverageGaps.ts` is the backlog: each unit takes its specials
off that list.

## Batch 1: what was checked

Checked against the decomp and master at `c094d3a` (2026-10-18):

- **Party selection:** `ChoosePartyMonByMenuType` (party_menu.c) is already ported in `menus/partyMenu.ts`, so
  `special ChoosePartyMon` / `ChooseMonForMoveRelearner` (party_menu_specials.c, 108 lines) are thin wrappers:
  LockPlayerFieldControls, a fade, then the party menu. 13 maps use ChoosePartyMon (trades, Name Rater, move
  deleter, Daisy).
- **Move tutors:** `ChooseMonForMoveTutor` and `TryTutorSelectedMon` are ported in `menus/partyMenu.ts`, but the
  special isn't registered (15 maps). The move deleter (Fuchsia) is party_menu_specials.c plus the summary screen's
  PSS_MODE_FORGET_MOVE, which exists. The move relearner (Two Island) is learn_move.c (932 lines, its own screen);
  the party menu logs "the move relearner is not implemented".
- **In-game trades:** 9 trades in `src/data/ingame_trades.h` (not extracted yet). trade_scene.c is 2,916 lines; the
  in-game trade needs the data, the four specials (GetInGameTradeSpeciesInfo, GetTradeSpecies,
  CreateInGameTradePokemon, DoInGameTradeScene), and the cable animation (CB2_InitInGameTrade, CB2_InGameTrade,
  DoTradeAnim_Cable, the bouncing Poké Ball, about 1,300 lines). The wireless animation and link trading stay out.
  No FRLG in-game trade evolves on arrival, so TradeEvolutionScene stays out (logged as a deviation).
- **Game Corner:** the coins box (coins.c, 98 lines: `showcoinsbox` / `updatecoinsbox` / `hidecoinsbox`) is what
  the prize room and the coin sellers need; `playslotmachine` is slot_machine.c (2,527 lines: ~900 game logic
  (reels, bias, payout), ~1,000 screen and sprites, the rest data). Plus GetRandomSlotMachineId
  (field_specials.c).
- **Oak's rating:** prof_pc.c (109 lines) GetProfOaksRatingMessage, pokedex.c HasAllMons, and the help-context
  specials (no-ops like the other help specials). Reached from Oak in his lab *and* from "PROF. OAK's PC" on every
  PC (data/scripts/pc.inc), so it's the most-met item here.
- **Fossils:** the Cinnabar lab revival is `multichoice` + `givemon`, which the port has: likely needs only a test.
  The museum's fossil pic is OpenMuseumFossilPic / CloseMuseumFossilPic (script_menu.c, ~100 lines + graphics).
- **Name Rater:** ChoosePartyMon, IsMonOTIDNotPlayers, IsMonOTNameNotPlayers, NameRaterWasNicknameChanged
  (field_specials.c); the naming screen exists.
- **Daycare:** daycare.c (2,155 lines) holds the Route 5 daycare (one mon, levels from steps; ~150 lines of
  specials on top of the shared storage code), the Four Island daycare and eggs (compatibility, egg species,
  inherited IVs, egg moves, ~600 lines), and the hatching scene (~550 lines). **The Route 5 daycare holds one
  mon and never makes eggs;** in FRLG eggs come only from the Four Island daycare and the Water Labyrinth's Togepi
  (`giveegg`), both after the Hall of Fame. Eggs are planned after Route 5 below (decision 3).

## Workstreams

Each unit is its own branch and PR (decision 2 of SCREENS_PLAN.md stands): the merger merges a unit as soon as it
hands back, and the next unit of the workstream starts on a fresh branch from the updated `origin/master`. A
worker that hands back mid-unit gets a continuation on the same branch.

Each workstream registers its specials in its own module (e.g. `script/tradeSpecials.ts`) spread into
`script/specials.ts` with one line, like `STORY_SPECIALS`, so the table doesn't conflict.

### W-moves: tutors, deleter, relearner

Owns `menus/partyMenuSpecials.ts` (new: party_menu_specials.c, all of it), `menus/learnMove.ts` (new:
learn_move.c), the tutor / relearner branches in `menus/partyMenu.ts`.

1. **Party selection, tutors and the deleter.** party_menu_specials.c: ChoosePartyMon, ChooseMonForMoveRelearner
   (the party menu part; the relearner screen is unit 2), SelectMoveDeleterMove, GetNumMovesSelectedMonHas,
   BufferMoveDeleterNicknameAndMove, MoveDeleterForgetMove (ShiftMoveSlot), IsSelectedMonEgg. Register
   ChooseMonForMoveTutor and check a tutor end to end (Route 4's Mega Punch / Mega Kick tutors,
   data/scripts/move_tutors.inc). E2E `tests/e2e/moveTutors.test.ts`: teach a tutor
   move (incl. forgetting one with a full moveset), delete a move at the Fuchsia move deleter, B out of both.
   **Small and first:** W-trade and W-daycare wait on ChoosePartyMon, so hand back as soon as this is green.
2. **The move relearner.** learn_move.c (TeachMoveRelearnerMove, the list screen, the move info, the "forget a
   move" flow through the summary screen), the party menu's PARTY_MENU_TYPE_MOVE_RELEARNER branch, Two Island's
   relearner (Heart Scale), and the Cape Brink tutor specials (CapeBrinkGetMoveToTeachLeadPokemon,
   HasLearnedAllMovesFromCapeBrinkTutor). E2E in the same file.

### W-trade: in-game trades and the Name Rater

Owns `script/tradeSpecials.ts` (new), `menus/tradeScene.ts` (new: trade_scene.c's in-game path), the trade data
and graphics in the extractor.

1. **Trades without the animation, and the Name Rater.** Extract `ingame_trades.h` (tools/), port
   GetInGameTradeSpeciesInfo, GetTradeSpecies, CreateInGameTradePokemon (CreateInGameTradePokemonInternal: OT name
   and ID, IVs, held item, the fixed personality, the mail stays out), and DoInGameTradeScene as a stand-in that
   swaps the mons (TradeMons, UpdatePokedexForReceivedMon) behind a fade (logged in DEVIATIONS until unit 2). The
   Name Rater: IsMonOTIDNotPlayers, IsMonOTNameNotPlayers, NameRaterWasNicknameChanged. ChoosePartyMon comes from
   W-moves unit 1: write the specials and unit tests first, merge `origin/master` in once it's there, then the
   e2e. E2E `tests/e2e/inGameTrades.test.ts`: Route2_House's trade (Abra for Mr. Mime, INGAME_TRADE_MR_MIME),
   declining, offering the wrong species; the Name Rater renaming a mon and refusing a traded
   one.
2. **The trade animation.** trade_scene.c's cable path: CB2_InitInGameTrade, CB2_InGameTrade, DoTradeAnim_Cable
   (the mon pics, the Poké Ball leaving and arriving, the cable and the GBA screens, the messages),
   CB2_UpdateInGameTrade back to the field, replacing unit 1's stand-in. Graphics through the extractor
   (`graphics/trade/`). E2E: the same trade runs the scene to the end.

### W-slots: the Game Corner

Owns `ui/CoinsBox.ts` (or wherever the money box lives: coins.c), `menus/slotMachine.ts` (new), the Game Corner
specials.

1. **The coins box and the slot machine's game.** coins.c (`showcoinsbox`, `updatecoinsbox`, `hidecoinsbox`) and
   the prize room and coin sellers that use it; GetRandomSlotMachineId; slot_machine.c's game logic as a module
   without the screen (InitSlotMachineState, the reels, StopReel1-3 with the bias checks, CalcSlotBias, CalcPayout)
   with unit tests against hand-worked cases. E2E `tests/e2e/gameCorner.test.ts`: buy coins, buy a prize in the
   prize room, the coins box values.
2. **The slot machine screen.** The rest of slot_machine.c: CB2_InitSlotMachine, the graphics, the reel and
   Clefairy sprites, the winning line flash, the help screen, the YES/NO to quit, MainTask_*; `playslotmachine`
   from the Game Corner's machines and back to the field. E2E: sit at a machine, bet, spin, stop the reels (seeded),
   check the coins.
3. **Spare:** the rest of what unit 2 leaves, if the screen doesn't fit in one unit, and the Game Corner's other
   gaps (UpdateTrainerCardPhotoIcons, FLDEFF_PHOTO_FLASH, FLDEFF_SMILEY_FACE_ICON) if they're the Game Corner's.

### W-daycare: Oak's rating, the fossils, the Route 5 daycare, then eggs

Owns `script/sideSpecials.ts` (new: the small specials), `world/daycare.ts` (new: daycare.c), the museum fossil
pic, the daycare and egg fields in GameState / saveData.

1. **Oak's rating and the fossils.** GetProfOaksRatingMessage (prof_pc.c), HasAllMons (pokedex.c), the help
   context specials as no-ops; OpenMuseumFossilPic / CloseMuseumFossilPic (script_menu.c, the graphics through the
   extractor). The fossil revival at the Cinnabar lab: check it runs and fix what doesn't. Also switch
   `story.test.ts` and `storyCeladonSaffron.test.ts` from mashing A after leader battles to pressing B, as
   storyLeague.test.ts does (A can restart a leader's post-battle script). E2E `tests/e2e/sideEvents.test.ts`:
   Oak rates the Pokédex in person and through a PC, the museum's Kabutops / Aerodactyl pics, reviving a fossil.
2. **The Route 5 daycare.** daycare.c's storage (StorePokemonInDaycare, TakeSelectedPokemonFromDaycare,
   ApplyDaycareExperience, the level and cost helpers), the Route 5 specials (PutMonInRoute5Daycare,
   GetCostToWithdrawRoute5DaycareMon, IsThereMonInRoute5Daycare, GetNumLevelsGainedForRoute5DaycareMon,
   TakePokemonFromRoute5Daycare), ChooseSendDaycareMon, GetSelectedMonNicknameAndSpecies,
   IsEnoughForCostInVar0x8005, SubtractMoneyFromVar0x8005; the daycare mon's steps from the field's step
   counter; saved. E2E `tests/e2e/daycare.test.ts`: leave a mon, walk, take it back (levels gained, cost paid).
3. **Eggs** (postgame, decision 3): the Four Island daycare (two mons, the level menu), compatibility, egg
   species and incense, inherited IVs, egg moves (extracted), TriggerPendingDaycareEgg on steps, GiveEggFromDaycare,
   RejectEggFromDayCare, SetDaycareCompatibilityString, GetDaycareMonNicknames, `giveegg`. E2E in the same file.
4. **Hatching** (postgame): ShouldEggHatch in the step counter, `special EggHatch` (the hatching scene: the egg
   sprite's wobbles, the shards, the nickname prompt), ScriptHatchMon. E2E: hatch an egg.

## Shared files in batch 1

- `menus/partyMenuSpecials.ts`: W-moves only. Others import ChoosePartyMon from it once W-moves unit 1 is in.
- `menus/partyMenu.ts`: W-moves (relearner branch), W-daycare (the daycare menu type, if it needs changes),
  W-trade (only if the trade's choose-mon path needs it). Small changes each.
- `script/specials.ts`: one spread line per workstream module; `tests/unit/scriptCoverageGaps.ts`: each takes its
  own lines off (the merger keeps both sides).
- `tools/extract*.py`: W-trade (trade data and graphics), W-slots (slot machine graphics), W-moves (learn_move.c
  graphics if any), W-daycare (the fossil pic, egg moves, the hatching graphics). Own functions and keys; one line
  each in `extract_gfx.py`'s GFX_PREFIXES.
- `state/GameState.ts`, `state/saveData.ts`: W-daycare (daycare mons, egg state). Coins are already saved.
- The step counter (`world/stepCounters.ts`): W-daycare only.

## Batches

| Batch | Workers | Why together |
|---|---|---|
| 1 (this one) | W-moves (1, then 2), W-trade (1, then 2), W-slots (1, 2, spare 3), W-daycare (1, 2, then 3 and 4 if the batch has room) | Different files; all four are side content the user asked for, ordered by how often a player meets it |

What's left after batch 1 goes first in batch 2 (see "Next up" in STATUS.md when this batch closes).

## Rules

Worker and merger rules: docs/WORKFLOW.md sections 3 and 4. Each worker's e2e file is named in its unit above.

## Decisions

1. **One PR per unit** (as in SCREENS_PLAN.md decision 2): ChoosePartyMon from W-moves unit 1 is needed by
   W-trade and W-daycare, and the Game Corner's coins box is useful on its own, so each unit merges as it finishes.
2. **The in-game trade lands in two steps** (coordinator, revisit if you disagree): unit 1 makes trades work behind
   a fade, unit 2 adds trade_scene.c's cable animation. Trades are playable a unit earlier; the stand-in is logged in
   DEVIATIONS until unit 2 replaces it. TradeEvolutionScene stays out (no FRLG in-game trade evolves).
3. **Eggs come after the Route 5 daycare** (coordinator, revisit if you disagree): in FRLG the Route 5 daycare man
   holds one mon and gives no eggs; eggs come from the Four Island daycare and the Water Labyrinth after the Hall
   of Fame. So the Route 5 daycare is W-daycare unit 2 and eggs / hatching are units 3-4, done in this batch if it
   has room and otherwise first in the next one.
4. **Four workers at once** (coordinator, revisit if you disagree): the machine (10 cores) was idle when the
   batch started; each worker runs only its own e2e file, and merges run the files the PR touches, with the full
   suite once at the end.

## Not in this plan

Link trading and the wireless trade animation, TradeEvolutionScene, mail, the Seagallop ferry, DoFallWarp holes,
the Trainer Fan Club, the Magikarp / Heracross size contests, the diploma, Daisy's grooming, Easy Chat; audio.
