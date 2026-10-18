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
| 1 (done, PRs #56-#67) | W-moves (1, 2), W-trade (1, 2), W-slots (1, 2; spare 3 not needed), W-daycare (1, 2, 3), W-hatch (unit 4, alongside 2-3), W-misc (the other small side specials) | Different files; all four are side content the user asked for, ordered by how often a player meets it |
| 2 (done, PRs #69-#77) | W-ferry (1, 2), W-ssanne (1), W-league (1, 2), W-easychat (1-4) | The user's focus: the ferry for Bill's trip, the S.S. Anne, the last two main gaps; three workers, then Easy Chat in the freed slots |
| 3 | W-unused (1), beside W-audioplan (AUDIO_PLAN.md, research only) | The user's call: port the three `unused` gaps after all; plan the audio before any audio code |

Batch 2 merged: #69 the plan; #70 the S.S. Anne departure and sweep; #71 the league lighting, GetMartClerkObjectId,
the `unused` gap tag, the fan club e2e, the egg hook; #73 the ferry and Bill's trip; #72, #74, #75, #77 Easy Chat
(data and easy_chat.c, the screen model, the main layer and ShowEasyChatScreen, choosing words); #76 every harbor,
the Sevii 1-3 quest played headless, `multichoice` resuming a frame after the choice. No side gaps are left.

Batch 1 merged: #57 party selection, tutors, deleter; #58 trades behind a fade, Name Rater; #59 coins box, Game
Corner clerks, slot machine logic; #60 Oak's rating, fossil pics, fossil revival check; #61 move relearner, Cape
Brink; #62 the trade scene; #63 Route 5 daycare; #64 slot machine screen, smiley, photo printer; #65 egg hatching;
#66 holes, Daisy, Magikarp record, diploma, fan club; #67 eggs and the Four Island daycare.

Left for a batch 2 (the side gaps in `tests/unit/scriptCoverageGaps.ts`): the Seagallop ferry
(DoSeagallopFerryScene, DrawSeagallopDestinationMenu, GetSeagallopNumber, GetSelectedSeagallopDestination,
IsPlayerLeftOfVermilionSailor) for Bill's One Island trip; Easy Chat (ShowEasyChatScreen / ShowEasyChatMessage,
the Pewter questionnaire); GetMartClerkObjectId. Outside the gap list: mail (daycare mail, the trade's Fab Mail),
contest conditions, TradeEvolutionScene and link trading, audio.

## Batch 2: what was checked

Checked against the decomp and master at `6a154b0` (2026-10-18):

- **The Seagallop ferry** is small: seagallop.c (504 lines: CB2_SetUpSeagallopScene, the scrolling water BG3, the
  ferry and wake sprites, Task_Seagallop_0-3 and the warp through sSeag, GetDirectionOfTravel's
  sTravelDirectionMatrix, GetSeagallopNumber, IsPlayerLeftOfVermilionSailor), plus script_menu.c's
  DrawSeagallopDestinationMenu / GetSelectedSeagallopDestination (~110 lines, the two-page menu on the existing
  multichoice input task). Graphics: graphics/seagallop/ (water tiles, the WB/EB tilemaps, ferry, wake, palette).
  The scripts are data/scripts/seagallop.inc and each harbor's sailor. Bill's trip: CinnabarIsland_EventScript_BillScene
  → CinnabarIsland_EventScript_SailToOneIsland (the Seagallop object arrives with plain movements) →
  EventScript_SetSail → One Island harbor → One Island PC (MeetCelioScene: Tri-Pass, FLAG_SYS_SEVII_MAP_123, the
  Town Map page). The way back (OneIsland_PokemonCenter_1F_EventScript_LeaveOneIslandScene) needs
  VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F = 2, which TwoIsland_JoyfulGameCorner sets after Lostelle's rescue
  (the Three Island bikers, Berry Forest); then CinnabarIsland_EventScript_ReturnFromSeviiIslands. Nothing else on
  the Sevii 1-3 maps is in the gap list.
- **The S.S. Anne departure** (ss_anne.c, 200 lines): DoSSAnneDepartureCutscene: SE horn, a 50-frame wait, the wake
  sprite behind the boat, a smoke puff every 70 frames, the boat object's sprite x2 moving left by one pixel per 5
  frames until it's off screen (x < -120), 40 frames, ScriptContext_Enable. Graphics: graphics/ss_anne/ (wake,
  smoke). Today `waitstate` passes at once and `removeobject LOCALID_SS_ANNE` hides the ship. story.test.ts checks
  the ticket, the rival, the captain and the exit, not the ship. The rest (the ship's 26 maps, the Vermilion ticket
  check and VAR_VERMILION_CITY_TICKET_CHECK_TRIGGER, the captain's HM01, VAR_MAP_SCENE_VERMILION_CITY 1→2→3 and
  the "SS Anne has departed" texts, the dock afterwards) runs on generic script commands: the sweep is a runtime check
  against the decomp, map by map.
- **The league lighting** (field_specials.c 2050-2210, ~160 lines with the data): DoPokemonLeagueLightingEffect
  cycles BG palette 7 through 12 (Elite Four) or 9 (Champion) palettes on timers while FLAG_TEMP_2 is set;
  Task_CancelPokemonLeagueLightingEffect sets the last palette once FLAG_TEMP_4 is set (after the battle);
  StopPokemonLeagueLightingEffectTask runs from the start menu and five item_use.c paths. The field draws metatiles
  from tile atlases (`world/TilesetVram.ts` keeps the GBA tiles and redraws metatiles that tile animations change),
  so a palette swap means redrawing the metatiles that use palette 7: the same mechanism, keyed on palettes.
- **Leftovers:** GetMartClerkObjectId (field_specials.c, sMartMaps, 20 lines; its only caller is
  EventScript_Questionnaire, which needs Easy Chat); `adddecoration` / `bufferdecorationname` and FLDEFF_USE_DIVE are
  reached only from std scripts no FRLG map calls; the Trainer Fan Club has no e2e; the e2e egg hook builds eggs by
  hand instead of world/daycare.ts's createEgg.
- **Easy Chat** is big: easy_chat.c 730, easy_chat_2.c 1,363, easy_chat_3.c 2,316 lines, plus the word tables and
  graphics. Its users before the Hall of Fame are the Pewter Pokémon Center's questionnaire (ShowEasyChatScreen /
  ShowEasyChatMessage) and EventScript_Questionnaire. Only if the rest is done (the user's call).

## Batch 2 workstreams

One PR per unit as in batch 1. Each workstream registers its specials in its own module spread into
`script/specials.ts`.

### W-ferry: the Seagallop ferry

Owns `menus/seagallop.ts` (new: seagallop.c), `script/ferrySpecials.ts` (new: the ferry specials, incl. the two
from script_menu.c), the seagallop graphics in the extractor, `tests/e2e/seagallop.test.ts`.

1. **The ferry and Bill's trip.** All of seagallop.c (the scene on the GBA layer, the warp through sSeag with
   FieldCB_DefaultWarpExit, GetDirectionOfTravel, GetSeagallopNumber, IsPlayerLeftOfVermilionSailor),
   DrawSeagallopDestinationMenu and GetSelectedSeagallopDestination. E2E: Bill's scene on Cinnabar → YES → the
   Seagallop arrives → the ferry scene → One Island harbor → One Island → the PC's Celio scene (Tri-Pass); then set
   VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F to 2 (Lostelle's rescue, unit 2 plays it) → the leave scene → the
   ferry → Cinnabar → Bill's goodbye. Also declining Bill (he waits in the Pokémon Center, the trip from there),
   Vermilion → Two Island with the Tri-Pass and back, and cancelling left of the Vermilion sailor (walk up the pier).
2. **Every harbor and the Sevii 1-3 quest.** The ferry from each harbor (Vermilion, Cinnabar, One to Seven Island),
   both pages of the Rainbow Pass menu (from Vermilion and from an island, the "OTHER" page and EXIT), the Navel
   Rock / Birth Island harbors as far as their scripts go without the tickets; the Sevii 1-3 story played headless
   (Kindle Road, the Three Island bikers, Berry Forest's Lostelle, Two Island's game corner) so the way back is
   reached without setting the var. Fix what the play-through finds.

### W-ssanne: the S.S. Anne

Owns `world/ssAnne.ts` (new: ss_anne.c), the ss_anne graphics in the extractor, `tests/e2e/ssAnne.test.ts`.

1. **The departure and the sweep.** DoSSAnneDepartureCutscene with the wake and smoke sprites on the field (the
   boat object's sprite offset, sprites over the field like the other field effects), `waitstate` waiting for
   ScriptContext_Enable. Then sweep everything S.S. Anne against the decomp at runtime: the Vermilion ticket check
   (without and with the ticket, both trigger columns, walking away), every S.S. Anne map's NPCs, trainers, items
   and signs, the kitchen / rooms' hidden items, the rival on 2F, the captain and HM01, the departure, Vermilion's
   dock and NPC texts after the ship has left (VAR_MAP_SCENE_VERMILION_CITY 3), the dock sailor afterwards. Fix
   what's wrong; log what's left in DEVIATIONS. E2E covers the ticket check, the departure (the ship moves off, the
   wake and smoke show, the script waits) and the dock afterwards.

### W-league: the league lighting, then the leftovers

Owns the lighting (a module under `world/`, the palette-redraw hook in `world/TilesetVram.ts`), the lighting
palettes in the extractor, `tests/e2e/leagueLighting.test.ts`.

1. **The league lighting.** DoPokemonLeagueLightingEffect, Task_RunPokemonLeagueLightingEffect,
   Task_CancelPokemonLeagueLightingEffect, StopPokemonLeagueLightingEffectTask (from the start menu and the
   item_use.c paths, which today skip it: remove that QOL note), the palettes through the extractor. E2E: the
   palette changes on the timers in an Elite Four room and the Champion's room, stops after the battle.
2. **Leftovers** (small, may go with unit 1): GetMartClerkObjectId; tag `adddecoration`, `bufferdecorationname`
   and FLDEFF_USE_DIVE as not reached by FRLG (a new gap tag, decision 8); an e2e for the Trainer Fan Club; the e2e
   egg hook using world/daycare.ts's createEgg.

### W-easychat (only once the focus is done)

Started only when W-ferry, W-ssanne and W-league have no units waiting (decision 9). Owns `menus/easyChat*.ts`,
`script/easyChatSpecials.ts`, `tools/extract_easy_chat.py` (public/gen/easyChat.json, later the easy chat graphics),
the Easy Chat fields of GameState / saveData, `tests/unit/easyChat*.test.ts`, `tests/e2e/easyChat.test.ts`.

What the C does (sized in unit 1):
- **easy_chat.c (730)**: the words (lookup, text, CopyEasyChatWord, ConvertEasyChatWordsToString,
  EC_DoesEasyChatStringFitOnLine), which groups / words are unlocked (the Pokédex, FLAG_SYS_GAME_CLEAR, the National
  Dex; the trendy sayings never in FRLG), ShowEasyChatMessage, the trendy-saying bits (additionalPhrases,
  EnableRareWord), InitEasyChatPhrases / InitQuestionnaireWords, and the selection lists the screen reads
  (InitEasyChatSelection, the groups, the alphabetical lists, GetUnlockedECWords). Data: src/data/easy_chat/*.h.
- **easy_chat_2.c (1,363)**: the screen's state machine without graphics. DoEasyChatScreen / ShowEasyChatScreen
  (the words by EASY_CHAT_TYPE_*), Task_RunEasyChat (fade in, joypad → an interface command id 1-22 for
  easy_chat_3.c, 23 = leave; on leaving the profile sets FLAG_SYS_SET_TRAINER_CARD_PROFILE and the profile /
  questionnaire compare the words with their passphrase into VAR_0x8004), sEasyChatScreenTemplates, the seven input
  states (fields, footer, group select, word select, the cancel / del-all / confirm YES/NO menus), the cursor rules
  (group mode vs the A-Z keyboard, the "blue box" footer, wrap-around, rows scrolled above), and the getters
  easy_chat_3.c draws from (GetMainCursorColumn, GetECSelectWordCursorCoords, ShouldDrawECUpArrow, ...).
- **easy_chat_3.c (2,316)**: the screen. Graphics (graphics/easy_chat/: window, frames, cursors, mode / button
  windows, scroll arrows, START/SELECT buttons), BG and window templates, the title / instructions / phrase frame
  (sPhraseFrameDimensions by frameId) / fields / footer, the groups menu, the keyboard and the words menu on window 2
  with BG2 scrolling and the frame resize animation, the YES/NO window; sprites (the bouncing triangle cursor, the
  red rectangle cursor, the mode window, the scroll arrows); the 22 interface commands (ECInterfaceCmd_01-22) that
  redraw for each action, a few frames each.

Units:

1. **The data and easy_chat.c** (done, PR "Easy Chat unit 1"). The word tables through the extractor, all of
   easy_chat.c, the save fields (profile, battle words, questionnaire words, additionalPhrases; save version 5),
   ShowEasyChatMessage and BufferRandomHobbyOrLifestyleString registered, the trainer card's profile words. E2E: the
   Pewter profile woman reads the saved profile back (through the passphrase branch while the screen is a gap).
2. **easy_chat_2.c as a model** (~920 lines of logic). `menus/easyChatScreen.ts` (or similar): the EasyChatScreen
   state, EasyChat_AllocateResources, every HandleJoypad_* / *_YesNoMenu / cursor function returning the
   interface command id, the getters, IsPhraseDifferentThanPlayerInput and the passphrase compares (the
   templates and passphrases are already in easyChat.json). Unit tests drive it with key presses (fields → footer
   wrap, group / alphabet cursor across the blue box, word scroll and page, DEL ALL, cancel with and without
   changes, confirm writing the words back). No graphics: the task/CB2 wiring waits for unit 3.
3. **The screen, main layer** (easy_chat_3.c ~1,100: graphics data and setup, LoadEasyChatGraphics, the title,
   instructions, phrase frame, fields and footer, the triangle cursor and START/SELECT sprites, the YES/NO window,
   ECInterfaceCmd_01-08 for the field / footer / YES/NO actions). The graphics through the extractor.
   ShowEasyChatScreen from a script on the GBA layer (`host.runScreenFromScript`, CB2_ReturnToFieldContinueScript,
   like the slot machine / diploma), Task_RunEasyChat's fades, leaving. E2E: the Pewter profile woman → the screen
   → B → YES (EventScript_CancelGiveProfile), START → YES keeps the profile (EventScript_GaveProfile); take the
   gap off scriptCoverageGaps and update the unit-1 e2e (it then goes through the screen).
4. **The screen, choosing words** (easy_chat_3.c ~1,200: the groups menu, the A-Z keyboard and mode window, the
   word menu with BG2 scrolling, the window-2 frame animation, the rectangle cursor, the scroll arrows,
   ECInterfaceCmd_09-22). E2E: a new profile typed through groups and the keyboard (EventScript_GaveProfile and the
   trainer card's profile flag), MYSTERY EVENT IS EXCITING (EventScript_GaveSpecialProfile), the Viridian Mart
   questionnaire (needs GetMartClerkObjectId: LINK TOGETHER WITH ALL sets FLAG_SYS_MYSTERY_GIFT_ENABLED).

## Shared files in batch 2

- `script/specials.ts`: one spread line per workstream; `tests/unit/scriptCoverageGaps.ts`: each takes its own
  lines off (the merger keeps both sides).
- `tools/extract*.py`: W-ferry (graphics/seagallop/), W-ssanne (graphics/ss_anne/), W-league (the lighting
  palettes). Own functions and keys.
- The field's sprite layer: W-ssanne adds sprites that follow an object's sprite; the ferry scene is a GBA screen of
  its own, so W-ferry doesn't touch the field.
- `world/TilesetVram.ts`: W-league only.

## Batch 3: what was checked

Checked against the decomp and master at `0d68053` (2026-10-18). The user wants the three `unused` gaps
(decision 8 of batch 2) ported after all, exactly as FRLG's C has them, even where that is a stub:

- **`adddecoration`** (scrcmd.c ScrCmd_adddecoration): FRLG reads the decoration id with VarGet and does nothing
  else (`gSpecialVar_Result = DecorationAdd(decorId)` is commented out). The same goes for `removedecoration`,
  `checkdecorspace` and `checkdecor` (not in the gap list since no script uses them; worth checking the engine
  handles them the same way). Std_ObtainDecoration (data/scripts/obtain_item.inc) is the caller.
- **`bufferdecorationname`** (ScrCmd_bufferdecorationname): reads the string var index and the decoration id and
  copies nothing (the StringCopy from gDecorations is commented out: FRLG has no decoration table). Caller:
  EventScript_ObtainDecorMessage.
- **FLDEFF_USE_DIVE** (field_effect.c FldEff_UseDive, Task_UseDive, DiveFieldEffect_Init / _ShowMon / _TryWarp;
  gFldEffScript_UseDive): preventStep, LockPlayerFieldControls, FLDEFF_FIELD_MOVE_SHOW_MON_INIT, then
  dive_warp (field_control_avatar.c) once the show-mon effect is over: MAP_TYPE_UNDERWATER /
  MetatileBehavior_IsUnableToEmerge / MetatileBehavior_IsDiveable, SetDiveWarpEmerge / SetDiveWarpDive
  (overworld.c SetDiveWarp, the map's connections of type dive/emerge), StoreInitialPlayerAvatarState, DoDiveWarp
  (field_fadetransition.c) and PlaySE(SE_M_DIVE). Callers: EventScript_DeepWater / EventScript_TrySurface
  (data/scripts/field_moves.inc), which GetInteractedWaterScript never returns in FRLG. ~150 lines of C in all.

## Batch 3 workstreams

### W-unused: the three unused gaps

Owns the decoration commands in `script/ScriptEngine.ts` (or wherever the engine's commands live), the Dive field
effect (beside the other field-move effects), `tests/unit/` tests for each, and the gap list.

1. **Port all three.** `adddecoration` and `bufferdecorationname` as FRLG's stubs (read their arguments, change
   nothing; `removedecoration` / `checkdecorspace` / `checkdecor` the same if the engine doesn't have them yet).
   FLDEFF_USE_DIVE with its tasks, dive_warp, SetDiveWarpDive / SetDiveWarpEmerge and DoDiveWarp as FRLG has them
   (the field move show-mon is already ported for Surf / Strength), PlaySE as whatever no-op SE call the port uses
   today. Unit tests: the commands consume the right bytes and leave VAR_RESULT / the string vars alone; the Dive
   effect runs its three steps, waits for the show-mon effect, then warps through a dive connection, or does
   nothing where no connection exists. An e2e only if something is observable on an FRLG map (none reaches it, so
   probably a test map built in the test or a unit-level check). Remove the three entries from
   `tests/unit/scriptCoverageGaps.ts`; drop the `unused` tag from GapTag and its header comment if nothing else
   uses it, and fix the docs that mention it (STATUS.md, docs/DEV_NOTES.md, tests/README.md if any).

### W-audioplan: the audio plan (docs only)

One research worker writes [AUDIO_PLAN.md](AUDIO_PLAN.md) (the GBA's m4a engine, every place the game needs audio
and where game logic waits on it, ways to bring it into the port with a recommendation, integration, testing, the
work split). No audio code merges in this batch; implementation starts once the user has reviewed the plan.

## Shared files in batch 3

- `tests/unit/scriptCoverageGaps.ts`: W-unused only.
- STATUS.md: W-audioplan adds a "Next up" pointer to AUDIO_PLAN.md; the merger keeps both sides.

## Rules

Worker and merger rules: docs/WORKFLOW.md sections 3 and 4. Each worker's e2e file is named in its unit above.

## Decisions

1. **One PR per unit** (as in SCREENS_PLAN.md decision 2): ChoosePartyMon from W-moves unit 1 is needed by
   W-trade and W-daycare, and the Game Corner's coins box is useful on its own, so each unit merges as it finishes.
2. **The in-game trade lands in two steps** (coordinator, revisit if you disagree): unit 1 makes trades work behind
   a fade, unit 2 adds trade_scene.c's animation. (The plan said "cable"; unit 2 found the in-game trade runs
   DoTradeAnim_Wireless, since only CB2_LinkTrade sets `isCableTrade`, and ported that.) Trades are playable a unit earlier; the stand-in is logged in
   DEVIATIONS until unit 2 replaces it. TradeEvolutionScene stays out (no FRLG in-game trade evolves).
3. **Eggs come after the Route 5 daycare** (coordinator, revisit if you disagree): in FRLG the Route 5 daycare man
   holds one mon and gives no eggs; eggs come from the Four Island daycare and the Water Labyrinth after the Hall
   of Fame. So the Route 5 daycare is W-daycare unit 2 and eggs / hatching are units 3-4, done in this batch if it
   has room and otherwise first in the next one.
4. **Four workers at once** (coordinator, revisit if you disagree): the machine (10 cores) was idle when the
   batch started; each worker runs only its own e2e file, and merges run the files the PR touches, with the full
   suite once at the end.

5. **Hatching ran as its own worker (W-hatch) beside the Route 5 daycare** (coordinator, revisit if you disagree):
   the hatching scene doesn't depend on the daycare storage (the field trigger already existed), so it took a free
   slot instead of waiting for unit 3.
6. **A W-misc worker for the other small side specials** (coordinator, revisit if you disagree): with W-moves and
   W-trade finished early, a free slot took the side gaps a player meets before the Hall of Fame (holes, Daisy, the
   Magikarp record, the diploma, the fan club) rather than starting the Seagallop ferry, which is left for batch 2.

7. **Bill's way back is tested with the var first** (coordinator, revisit if you disagree): the leave scene in the
   One Island Pokémon Center needs Lostelle's rescue (VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F = 2). W-ferry unit 1
   sets the var in its e2e to reach the way back; unit 2 plays the Sevii 1-3 quest headless and drops the shortcut.
8. **A gap tag for what FRLG never reaches** (coordinator, revisit if you disagree): `adddecoration`,
   `bufferdecorationname` (Std_ObtainDecoration) and FLDEFF_USE_DIVE (EventScript_DeepWater / TrySurface) are
   shared with Emerald's std scripts but no FRLG map calls them. They get their own tag rather than being ported.
9. **Easy Chat waits for the focus** (the user's call): W-easychat starts only when the other three workstreams
   have no units left to start, in the slot one of them frees. (Coordinator, revisit if you disagree: it started
   once W-ssanne and W-league had finished and W-ferry's unit 1 was running, since W-ferry's unit 2 could only
   follow its unit 1 and the free slots had no focus work left to take. It never held up the ferry.)
10. **Batch 3 ports the `unused` gaps after all** (the user's call, replacing decision 8): exactly what FRLG's C
   does, stubs included, so the gap list has no tag for code FRLG compiles but never reaches.
11. **Two workers in batch 3** (coordinator, revisit if you disagree): W-unused is one small unit, and the audio
   research is one long worker (90 minutes, checkpoint at 75) with no code to merge, so nothing else runs beside
   them.

## Not in this plan

Link trading and the cable trade animation, TradeEvolutionScene, mail, the Heracross size contest (postgame),
the event tickets (Navel Rock, Birth Island); audio (planned in AUDIO_PLAN.md, batch 3). Easy Chat only if batch 2 has room (decision 9). (DoFallWarp
holes, the Trainer Fan Club, the Magikarp record, the diploma and Daisy's grooming were planned out but done in
batch 1 by W-misc: decision 6.)
