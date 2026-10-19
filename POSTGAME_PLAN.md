# The postgame: plan for what a player meets after the Hall of Fame

The main path is done ([MAIN_PATH_PLAN.md](MAIN_PATH_PLAN.md)), so is the side content before the Hall of Fame
([SIDE_PLAN.md](SIDE_PLAN.md)) and the audio ([AUDIO_PLAN.md](AUDIO_PLAN.md)). This plan takes the postgame, in the
order a player meets it: back to One Island (Oak's National Dex, Celio asks for the Ruby), Kindle Road and Mt. Ember
(the Ruby), the Rainbow Pass and the Sevii Islands 4-7 (the Sapphire quest: Four, Six, Five Island, back to Celio),
Seven Island (the Tanoby Ruins), the Trainer Tower, then the event islands (Navel Rock, Birth Island). Field weather
comes in with it (decision 1). `tests/unit/scriptCoverageGaps.ts` is the backlog: its 42 `postgame` gaps, and each
unit takes its own off the list.

## What was checked

Checked against the decomp and master at `0b6b771` (2026-10-19):

- **The story after the Hall of Fame** runs on commands the port has, apart from the gaps below. Pallet Town's
  OakRatingScene (after One Island, 60 caught) gives the National Dex in the lab (`EnableNationalPokedex`, ported);
  Celio (OneIsland_PokemonCenter_1F_EventScript_Celio) asks for the Ruby once `IsNationalPokedexEnabled`, sets
  VAR_MAP_SCENE_MT_EMBER_EXTERIOR 1 (the Rockets at Mt. Ember), takes the Ruby for the Rainbow Pass
  (FLAG_SYS_SEVII_MAP_4567; the ferry's Rainbow Pass pages are ported), then the Sapphire: `SetPostgameFlags`
  (save_location.c, 8 lines: CHAMPION_SAVEWARP and the GameCube link flags), FLAG_SYS_CAN_LINK_WITH_RS,
  FLAG_HIDE_CERULEAN_CAVE_GUARD, `InitRoamer` (ported). Kindle Road and Mt. Ember have no gaps besides braille, but
  nobody has played them headless yet.
- **Braille** (scrcmd.c ScrCmd_braillemessage / _getbraillestringwidth, 20 lines; field_specials.c
  BrailleCursorToggle, 35; the `braillemessage_wait` macro around EventScript_BrailleCursorWaitButton) needs
  FONT_BRAILLE (graphics/fonts/braille.png, not extracted yet). Mt. Ember's Ruby Path B4F/B5F and the Dotted Hole's
  rooms read braille; it's flavour text except at Ruin Valley (Cut on the braille: CutMoveRuinValleyCheck is ported).
- **Four Island / Icefall Cave:** `setstepcallback STEP_CB_ICE` (field_tasks.c IcefallCaveIcePerStepCallback and
  the step-callback task, ~150 lines of 351), `special SetIcefallCaveCrackedIceMetatiles`, `warphole` (scrcmd.c,
  DoFallWarp: holes are ported in world/fallWarp.ts); UpdateLoreleiDollCollection (25 lines), StickerManGetBragFlags.
- **Six / Five Island:** the Dotted Hole's Sapphire room (braille, `disable_anim` / `restore_anim` movements,
  ShakeScreen, Gideon's theft, FLAG_LEARNED_YES_NAH_CHANSEY), the Water Path house's Heracross record
  (pokemon_size_record.c, 217 lines: CompareHeracrossSize, GetHeracrossSizeRecordInfo), Resort Gorgeous
  (SampleResortGorgeousMonAndReward and IncrementResortGorgeousStepCounter from the step, ~60 lines), the Rocket
  Warehouse (generic commands), the Lost Cave (WEATHER_FOG_HORIZONTAL in its headers).
- **Seven Island:** Sevault Canyon's Tanoby Key (ShakeScreen, FLAG_SYS_UNLOCKED_TANOBY_RUINS), the Tanoby chambers
  (EventScript_TryDarkenRuins: `setweather WEATHER_SHADE` / `doweather` until the key is used; the Unown slots
  are ported in world/WildEncounters.ts).
- **Field weather** (field_weather.c 1,147 lines, field_weather_effects.c 2,346, field_weather_util.c 105): FRLG's
  maps use only WEATHER_NONE (333 maps), WEATHER_SUNNY (66; no visible effect in FRLG), WEATHER_SHADE (7: Viridian
  Forest, the Pokémon Mansion's four floors, Berry Forest, Navel Rock's summit) and WEATHER_FOG_HORIZONTAL (19:
  Pokémon Tower 3F-7F, the Lost Cave's 14 rooms). No FRLG map has a weather coord event; the only scripts are
  EventScript_TryDarkenRuins (Tanoby) and Navel Rock's summit (`setweather 0`, `doweather`: the shade lifts for
  Ho-Oh). Rain, snow, thunder,
  ash, sandstorm, diagonal fog, underwater, drought and downpour are compiled but unreached, and with them every
  weather SE3 sound (SE_RAIN, SE_THUNDERSTORM, SE_THUNDER, PlayRainStoppingSoundEffect).
- **The Trainer Tower:** trainer_tower.c (1,095 lines: CallTrainerTowerFunc and its 22 functions, which every
  `ttower_*` macro calls through VAR_0x8004; 17 of the 42 gaps), trainer_tower_sets.c (8,997 lines of data: the
  local sets, floors, trainers, mons, Easy Chat speeches), battle_records.c's Trainer Tower page (ShowBattleRecords
  with VAR_0x8004 = 1, PrintTrainerTowerRecords), CreateBattleTowerMon (pokemon.c), and the battle's
  BATTLE_TYPE_TRAINER_TOWER paths (battle_message.c's opponent name / class / win and lose texts,
  battle_controller_opponent.c's trainer pic; the port's battle code already has the flag in its checks). The
  timer is SetVBlankCounter1Ptr on the save's tower record. The elevator and the counter warp
  (VAR_MAP_SCENE_TRAINER_TOWER) are ported. e-Reader sets (ReadTrainerTowerAndValidate) are link content.
- **The event islands:** the harbors and the ferry are ported, minus the tickets. REVISION 0 (what the port
  follows) only gets them through Mystery Gift; REVISION 0xA's EnterHallOfFame gives both (decision 2). Navel Rock:
  LoopWingFlapSound (~20 lines), ShakeScreen in the base (field_specials.c, ~40 lines: Lugia), the summit's shade and
  Ho-Oh, SpawnCameraObject (ported). Birth Island: DoDeoxysTriangleInteraction, SetDeoxysTrianglePalette (~200
  lines with data), FLDEFF_DESTROY_DEOXYS_ROCK (field_effect.c, ~150 lines), then StartLegendaryBattle (ported).
- **Smaller gaps:** CompareHeracrossSize / GetHeracrossSizeRecordInfo, SampleResortGorgeousMonAndReward,
  StickerManGetBragFlags, UpdateLoreleiDollCollection, SetPostgameFlags, ShowBattleRecords; each sits with the
  unit of the map that uses it.

## Workstreams

One PR per unit, merged as it hands back; the workstream's next unit starts on a fresh branch from the updated
`origin/master` (decision 3). Each workstream registers its specials in its own module spread into
`script/specials.ts` with one line, like `STORY_SPECIALS`.

### W-sevii: the Sevii 4-7 story

Owns `script/postgameSpecials.ts` (new), the braille commands and `setstepcallback` / `warphole` in
`script/ScriptEngine.ts`, the field step callbacks (field_tasks.c, a module under `world/`), the braille font in the
extractor, `tests/e2e/postgame*.test.ts` and `tests/e2e/postgameHelpers.ts` (`afterHallOfFame(game)`: the flags and
vars the Hall of Fame and the Sevii 1-3 trip leave, citing the scripts that set them).

1. **Back to One Island, Kindle Road, Mt. Ember, the Ruby.** Braille: FONT_BRAILLE through the extractor (font
   metrics beside the other fonts), `braillemessage`, `getbraillestringwidth`, BrailleCursorToggle. Then play it
   headless: Oak's OakRatingScene and the National Dex, Celio's Ruby request, the ferry to Three Island and Kindle
   Road (its trainers, the Ember Spa), Mt. Ember (the Rockets at VAR_MAP_SCENE_MT_EMBER_EXTERIOR 1, the Ruby Path,
   the braille, the Ruby, Moltres on the summit as a battle start), back to Celio: the Rainbow Pass. Fix what the
   play-through finds. E2E `tests/e2e/postgame.test.ts`.
2. **Four Island and Icefall Cave.** The rival scene, Lorelei's house (UpdateLoreleiDollCollection), the sticker
   man (StickerManGetBragFlags), Icefall Cave: the step-callback task (ActivatePerStepCallback, STEP_CB_ICE with
   IcefallCaveIcePerStepCallback and MarkIcePuzzleCoordVisited), SetIcefallCaveCrackedIceMetatiles, `warphole`
   (and EventScript_FallDownHole), the back room's Lorelei and Lapras scene. E2E `tests/e2e/postgameFourIsland.test.ts`.
3. **Six Island: the Dotted Hole and the Sapphire.** The Six Island Pokémon Center's rival scene, Ruin Valley's
   door (Cut on the braille, ported: check it), the Dotted Hole's floors and braille, the Sapphire room
   (`disable_anim` / `restore_anim`, ShakeScreen from W-events, Gideon), the Water Path house's Heracross record
   (pokemon_size_record.c), Pattern Bush / Green Path / Outcast Island swept. E2E `tests/e2e/postgameSixIsland.test.ts`.
4. **Five Island and the Sapphire back to Celio.** The Meadow's Rocket and the Rocket Warehouse (passwords,
   Gideon), Resort Gorgeous (SampleResortGorgeousMonAndReward, IncrementResortGorgeousStepCounter on the step),
   the Lost Cave and Selphy (fog from W-weather unit 2), Celio: SetPostgameFlags (saved), the network machine, the
   roamer; Cerulean Cave opens (the guard, Mewtwo as a battle start). E2E `tests/e2e/postgameFiveIsland.test.ts`.
5. **Seven Island.** Sevault Canyon and the Tanoby Key (ShakeScreen), the Tanoby chambers (dark until the key,
   then the Unown), the Trainer Tower's surroundings, Altering Cave; a last sweep of the gap list's postgame lines
   no other unit took. E2E `tests/e2e/postgameSevenIsland.test.ts`.

### W-weather: field weather (FRLG's subset)

Owns `world/weather.ts` (new: field_weather.c and the FRLG weathers of field_weather_effects.c / _util.c),
`setweather` / `doweather` / `resetweather` in `script/ScriptEngine.ts`, the weather hook in
`OverworldScene` (map load, the tick, the fades), the weather graphics and gamma tables in the extractor,
`tests/e2e/weather.test.ts`.

1. **The framework and Shade.** field_weather.c's state (StartWeather, SetNextWeather / SetCurrentAndNextWeather,
   the weather task's palette processing: gamma shifts per palette, ApplyGammaShift / ApplyGammaShiftWithBlend, the
   gamma tables), SetSav1Weather / DoCurrentWeather / SetSavedWeatherFromCurrMapHeader on map loads (the weather
   saved), WEATHER_NONE / SUNNY / SHADE, the commands. The field draws from atlases: apply the gamma-shifted
   palettes through `tilesetVram.loadBgPalette` (as the league lighting does) and to the object palettes, and the
   fades on top (the port's fades are overlays: log what differs). E2E: Viridian Forest is shaded (a BG and an
   object pixel against the gamma table), the Tanoby chamber darkens through EventScript_TryDarkenRuins and
   doesn't with FLAG_SYS_UNLOCKED_TANOBY_RUINS, Navel Rock's summit (`setweather 0` / `doweather` lifts the shade).
2. **Horizontal fog.** WEATHER_FOG_HORIZONTAL (FogHorizontal_InitVars / _Main / _Finish, the fog sprites, their
   scroll with the camera, the BLDALPHA blend over the field): Pokémon Tower 3F-7F and the Lost Cave. E2E in the
   same file (pokemonTower.test.ts covers the tower's scripts: run it too). Remove the "no field weather" notes in
   docs/DEVIATIONS.md this makes stale (the warps' rain sound stays out, decision 1).

### W-ttower: the Trainer Tower

Owns `world/trainerTower.ts` (new: trainer_tower.c), `script/trainerTowerSpecials.ts` (new), the tower's save
record, `tools/extract_trainer_tower.py` (or a function in an existing extractor) → `public/gen/trainerTower.json`,
the BATTLE_TYPE_TRAINER_TOWER paths in `src/battle/`, `tests/e2e/trainerTower.test.ts`.

1. **The data and the tower without battles.** trainer_tower_sets.c through the extractor (the four challenge
   types' floors, trainers, mons, speeches as Easy Chat word ids), the save record (gSaveBlock1Ptr->trainerTower[],
   towerChallengeId; save version bump, old saves load), CallTrainerTowerFunc and every function except the
   battle: the floors' layouts (SetCurrentMapLayout) and NPC graphics, the speeches (TT_ConvertEasyChatMessageToString
   on menus/easyChat.ts), the timer (SetVBlankCounter1Ptr: counted in the field's tick), the lobby's challenge
   start, the counter warp, results board, prize, final time, losing. Unit tests on the functions; e2e: start a
   challenge, the first floor's trainer talks up to the battle.
2. **The battles.** DoTrainerTowerBattle, BuildEnemyParty, CreateBattleTowerMon, the battle's opponent name, class,
   pic, win / lose texts (both trainers in a double floor), BattleSetup_GetBattleTowerBattleTransition,
   PlayTrainerTowerEncounterMusic, CB2_EndTrainerTowerBattle. E2E: a floor of each kind won, a loss.
3. **Records and the full climb.** battle_records.c's Trainer Tower page (ShowBattleRecords with VAR_0x8004 = 1),
   PrintTrainerTowerRecords, the roof's owner and prize, a full climb with the time checked. May fit in unit 2.

### W-events: the event islands

Owns `script/eventIslandSpecials.ts` (new), ShakeScreen (shared: W-sevii units 3 and 5 use it), the Deoxys field
effect, the tickets in `menus/hallOfFame.ts`, `tests/e2e/eventIslands.test.ts`.

1. **The tickets, Navel Rock, Birth Island.** EnterHallOfFame's REVISION 0xA ticket gift (decision 2), ShakeScreen,
   LoopWingFlapSound, DoDeoxysTriangleInteraction / SetDeoxysTrianglePalette with the palettes through the
   extractor, FLDEFF_DESTROY_DEOXYS_ROCK. E2E: the Hall of Fame gives the tickets; Vermilion's sailor shows them and
   sails to Navel Rock and Birth Island; Lugia's base shakes and the battle starts; the Ho-Oh summit runs to the
   battle (the shade is W-weather's: until it lands `setweather` logs once and the script runs on); the Deoxys
   triangle's puzzle to the rock and the battle.

## Shared files

- `script/specials.ts`: one spread line per workstream; `tests/unit/scriptCoverageGaps.ts`: each takes its own
  lines off (the merger keeps both sides).
- `script/ScriptEngine.ts`: W-sevii (braille, `setstepcallback`, `warphole`) and W-weather (`setweather`,
  `doweather`, `resetweather`); each adds its own cases.
- `scenes/OverworldScene.ts`: W-weather (the weather on map load and in the tick), W-sevii unit 2 (the step
  callback), W-ttower (the timer, the floors' layouts); small hooks each, the logic in their own modules.
- `state/GameState.ts`, `state/saveData.ts`: W-ttower (the tower record), W-weather (the saved weather), W-sevii
  unit 4 (SetPostgameFlags). Whoever merges first takes save version 7, the next 8, each with its upgrade step
  (decision 5).
- `tools/extract*.py`: W-sevii (the braille font), W-weather (fog graphics, gamma tables), W-ttower (the tower
  sets), W-events (the Deoxys palettes and rock fragments). Own functions and keys.
- `src/battle/`: W-ttower only.
- `tests/e2e/postgameHelpers.ts`: W-sevii unit 1; the others set the few flags they need inline until it merges.

## Batches

| Batch | Workers | Why together |
|---|---|---|
| 10 | W-sevii (1, 2), W-weather (1, 2), W-ttower (1, 2), W-events (1) | One unit of each to start (four workers), then the next unit of each workstream as the first merges |
| 11 | W-sevii (3, 4, 5), W-ttower (3 if left) | The Sapphire quest and Seven Island, once weather and ShakeScreen are in |

What's left after this plan: map preview screens (the postgame caves have them), the help system, link play, the
unused weathers.

## Rules

Worker and merger rules: docs/WORKFLOW.md sections 3 and 4. Each worker's e2e file is named in its unit above.
Workers never run the full e2e suite; it runs once at the end of the batch, on master.

## Decisions

1. **Field weather comes into this plan, FRLG's subset only** (coordinator, revisit if you disagree): the Tanoby
   chambers and Navel Rock's summit need `setweather` / `doweather`, and 26 maps are shaded or foggy in their
   headers (Viridian Forest, Pokémon Tower and the Mansion before the Hall of Fame among them), so the
   framework, Shade and the horizontal fog are ported (W-weather). Rain, snow, thunder, ash, sandstorm, diagonal fog,
   underwater, drought and downpour aren't: no FRLG map, coord event or script reaches them, and with them go
   their SE3 sounds (SE_RAIN, SE_THUNDERSTORM, SE_THUNDER) and the warps' PlayRainStoppingSoundEffect, which only
   sounds in rain. Asking for one of them logs once.
2. **The event tickets come from the Hall of Fame, as in REVISION 0xA** (coordinator, revisit if you disagree): the
   port follows REVISION 0, where the Mystic and Aurora Tickets come only through Mystery Gift (link content).
   FireRed 1.1's EnterHallOfFame (post_battle_event_funcs.c, `#if REVISION >= 0xA`) gives both, with
   FLAG_ENABLE_SHIP_NAVEL_ROCK / _BIRTH_ISLAND and the FLAG_RECEIVED_* flags, when a party mon gets its Champion
   Ribbon and the bag has no Aurora Ticket. The port has no ribbons, so it gives them whenever the bag has no Aurora
   Ticket. Logged in docs/DEVIATIONS.md "Deliberate QOL changes" (a REVISION 0xA behaviour in a REVISION 0 port).
   Saves past the Hall of Fame get them on the next entry.
3. **One PR per unit** (as SIDE_PLAN.md decision 1): each unit merges as it hands back, so later units (and other
   workstreams: ShakeScreen, the weather commands, the postgame helper) build on master.
4. **Four workers at once** (coordinator, revisit if you disagree): four independent workstreams with distinct
   files; workers run only their own e2e files, so the load stays far below batch 2 of SCREENS_PLAN.md.
5. **Save version numbers go in merge order** (coordinator, revisit if you disagree): three workstreams add save
   data in this batch. Each bumps to the next free version on its branch; the merger renumbers on conflict and keeps
   every upgrade step, so a version-6 save still loads.
6. **ShakeScreen belongs to W-events** (coordinator, revisit if you disagree): Navel Rock's base is its first user
   in this batch; W-sevii's Sapphire room and Tanoby Key (batch 11) reuse it.
