# The single-player gaps: map previews, the help system, the intro, the Kanto postgame

The main path, the side content, the audio and the Sevii postgame are done ([MAIN_PATH_PLAN.md](MAIN_PATH_PLAN.md),
[SIDE_PLAN.md](SIDE_PLAN.md), [AUDIO_PLAN.md](AUDIO_PLAN.md), [POSTGAME_PLAN.md](POSTGAME_PLAN.md)). This plan takes
what a single player still meets that isn't ported, most visible first: the map preview screens (every cave and
forest), the L/R help system, the intro movie before the title screen, and a sweep of the Kanto postgame (the
National Dex's effects in Kanto, Cerulean Cave through Mewtwo's battle). Batch 11; **complete** ("Batch 11
result" below).

## What was checked

Checked against the decomp and master at `7920d68` (2026-10-19):

- **Map preview screens** (map_preview_screen.c, 616 lines, ~270 of them data; fldeff_flash.c's
  RunMapPreviewScreen / Task_MapPreviewScreen_0, ~90): the cave banner runs as FlashStruct.func2 when
  TryDoMapTransition moves into a section with a MPS_TYPE_CAVE preview (`world/mapTransition.ts` returns false there
  today, so the warp goes straight to the map); the forest banner runs from the map load (overworld.c
  `MapPreview_LoadGfx` + `MapPreview_StartForestTransition`, `OverworldScene.ts` names the spot). MapPreview_SetFlag
  makes the second visit short (MapPreview_GetDuration). The 21 previews' graphics are extracted already
  (`graphics/map_preview/`); `menus/regionMap.ts` has its own copy of GetDungeonMapPreviewScreenInfo and the table.
- **The help system** (help_system.c 2,480 lines, about 1,700 of them strings and tables; help_system_util.c 848;
  data/text/help_system.inc 1,881 lines of text). main.c runs RunHelpSystemCallback before callback2 every frame:
  in OPTIONS_BUTTON_MODE_HELP, L or R (R unless gHelpSystemToggleWithRButtonDisabled) saves the screen, halves the
  BGM (unless gDisableHelpSystemVolumeReduce, sound.c's SetBGMVolume_SuppressHelpSystemReduction), draws its own BG0
  and runs the menus (welcome, topics, submenus, help items, type matchups) until closed, then restores everything.
  The topics depend on a help context: SetHelpContext / SetHelpContextForMap / BackupHelpContext /
  RestoreHelpContext / HelpSystem_Disable / _Enable, called from 34 C files (~90 call sites: start menu, party menu,
  summary, bag, PCs, battle, trainer card, naming, Oak's speech, options, save, Pokédex, evolution, trades,
  daycare, Seagallop, Surf, the title screen) and five specials. help_message.c (the start menu's help window) is
  ported. The graphics (`graphics/help_system/`) are extracted; the text isn't.
- **The intro** (intro.c 2,805 lines, ~880 of them data and 49 INCBINs, `graphics/intro/` not extracted): the
  copyright screen (CB2_InitCopyrightScreenAfterBootup, and AfterTitleScreen when the title screen times out), the
  Game Freak scene (star, name sparkles, logo, "presents"), scene 1 (grass zoom), scene 2 (the forest pan, the two
  mons), scene 3 (Gengar and Nidorino's fight), any of A / START / SELECT skipping to the title screen. The port
  boots into the title screen (`menus/titleScreen.ts`, `scenes/BootScene.ts`); dev `?skipIntro` skips it all.
- **The Kanto postgame:** every C branch on IsNationalPokedexEnabled outside the Pokédex (main_menu.c,
  save_menu_util.c, trainer_card.c, prof_pc.c, party_menu.c, pokemon.c, evolution_scene.c, easy_chat.c) has a port
  counterpart, but no e2e test drives them from a postgame save. 15 maps branch on FLAG_SYS_CAN_LINK_WITH_RS or
  FLAG_SYS_GAME_CLEAR; the Kanto ones are the Elite Four rooms and Lance's (the rematch teams), Oak's lab, the
  rival's house, the Vermilion fan club, the Celadon condominiums and the Indigo Plateau Pokémon Center. The
  postgame e2e files take Mewtwo (Cerulean Cave B1F), Moltres and the event legendaries only to the start of their
  battles.

## Workstreams

One PR per unit, merged as it hands back; a workstream's next unit starts on a fresh branch from the updated
`origin/master` (as POSTGAME_PLAN.md decision 3). Each unit leaves the branch green: typecheck, unit tests, its
own e2e file.

### W-preview: map preview screens (1 unit)

1. map_preview_screen.c whole, fldeff_flash.c's RunMapPreviewScreen / Task_MapPreviewScreen_0, the cave hook in
   TryDoMapTransition and the forest hook in the map load (overworld.c's MapPreview_StartForestTransition /
   ForestMapPreviewScreenIsRunning holding the field's start), MapPreview_SetFlag and the durations; move
   regionMap.ts onto the new module's GetDungeonMapPreviewScreenInfo. New `world/mapPreviewScreen.ts`. E2e
   `tests/e2e/mapPreview.test.ts`: a cave (Mt. Moon from Route 4: the banner, its first and second-visit
   durations, the flash after), a forest (Viridian Forest), a postgame one (e.g. Icefall Cave or the Lost Cave),
   and a warp inside one section showing none. Plus `fieldWeather.test.ts` (Viridian Forest's shade and the forest
   banner meet) and the region map's e2e file.

### W-help: the help system (2 units)

1. **The engine and the menus:** help_system_util.c (RunHelpSystemCallback hooked where main.c has it, before
   callback2 in the GBA main loop and in the field's tick, pausing whatever runs; saving and restoring the screen,
   the BG0 drawing, HelpSystemRenderText, the list menu controller and scroll arrows), help_system.c's menu
   subroutines and tables (welcome, topics, submenus, items, type matchups, HelpSystem_ShouldShowBasicTerms,
   IsHelpSystemSubmenuEnabled), the text through the extractor (its own module, e.g. `tools/extract_help.py`),
   SE_HELP_OPEN / _CLOSE / _ERROR and the BGM halving with gDisableHelpSystemVolumeReduce
   (SetBGMVolume_SuppressHelpSystemReduction, `gba/sound.ts`), SetHelpContextForMap on the field, the overworld
   contexts. New `ui/helpSystem*.ts`. E2e `tests/e2e/helpSystem.test.ts`: HELP mode, L in the field opens it,
   welcome page once, a topic and an item, B back out, the field and the music as before; not in LR mode.
2. **The contexts:** SetHelpContext / BackupHelpContext / RestoreHelpContext / HelpSystem_Disable / _Enable /
   HelpSystem_EnableToggleWithRButton at every call site the port has (the list above; skip link-only screens),
   the five help specials (out of `NO_OP`), and the DEVIATIONS entries that wait on the help system removed.
   E2e: helpSystem.test.ts grows a context per screen family (title screen, start menu, party menu, bag, battle,
   Pokédex, PC).

### W-intro: the intro movie (2 units)

1. **The copyright screen, the framework and the Game Freak scene:** CB2_InitCopyrightScreenAfterBootup /
   AfterTitleScreen, CB2_SetUpIntro, IntroCB_Init, the skip to the title screen, IntroCB_ExitToTitleScreen, the GF
   scene (IntroCB_GF_*, GFScene_*, its sprites); `graphics/intro/` in the extractor; boot runs copyright → intro →
   title, the title screen's timeout goes back to the copyright screen. New `menus/intro.ts`. E2e
   `tests/e2e/intro.test.ts` (boots without `?skipIntro`): the copyright screen, the GF scene, a skip with A, the
   title screen's timeout back to the intro. Plus the title screen's e2e file.
2. **Scenes 1-3:** IntroCB_Scene1 (grass, the BG zoom), IntroCB_Scene2 (the forest and mons pan),
   IntroCB_Scene3_Entrance / _Fight (Gengar and Nidorino: sprites, cries, swipes, recoil dust, zooms), the music
   (MUS_INTRO_FIGHT) and SEs as the C plays them; the whole movie ends on the title screen. intro.test.ts grows a
   run of the full movie (its frame count against the C's) and a skip from scene 3.

### W-kanto: the Kanto postgame sweep (2 units)

1. **Cerulean Cave and the legendaries' battles to the end:** Cerulean Cave from the entrance to Mewtwo (the floors,
   the guard gone after SetPostgameFlags), Mewtwo's battle caught and defeated (StartLegendaryBattle's end, its
   flags, the object gone), the same for Moltres (Mt. Ember), Articuno (Seafoam) and Zapdos (Power Plant), and the
   event legendaries' battles to the end (Lugia, Ho-Oh, Deoxys). E2e `tests/e2e/postgameKanto.test.ts`;
   `tests/e2e/postgameHelpers.ts` is this workstream's.
2. **The National Dex in Kanto:** from a postgame save, every IsNationalPokedexEnabled branch outside the Pokédex
   (main menu's and the save window's dex counts, the trainer card's star, Oak's PC rating, the party menu's and
   the evolution scene's checks, Easy Chat's words), the Elite Four and Champion rematch teams
   (FLAG_SYS_CAN_LINK_WITH_RS), and the Kanto maps' postgame NPCs (Oak's lab, the rival's house, the fan club, the
   Celadon condominiums, the Indigo Plateau Pokémon Center). Fix what's wrong. postgameKanto.test.ts grows.

## Shared files

- `world/mapTransition.ts`, `menus/regionMap.ts`: W-preview. `scenes/OverworldScene.ts`: W-preview (the forest
  preview at map load), W-help (the help callback in the tick, SetHelpContextForMap): small hooks, the logic in
  their own modules.
- `gba/sound.ts`, the GBA main loop (`scenes/GbaHostScene.ts`), `script/specials.ts`'s help `NO_OP`s: W-help.
- `menus/titleScreen.ts`, `scenes/BootScene.ts`: W-intro. W-help unit 2 adds the title screen's context line
  after W-intro 1 merges.
- `tools/extract_gfx.py` GFX_PREFIXES: W-intro adds `graphics/intro/`. The help text: W-help, in its own module.
- `tests/e2e/postgameHelpers.ts`: W-kanto.
- `src/battle/`: W-kanto only for fixes it finds; W-help unit 2 adds the battle's help context calls.

## Batches

| Batch | Workers | Why together |
|---|---|---|
| 11 | W-preview (1), W-help (1, 2), W-intro (1, 2), W-kanto (1, 2) | Four workstreams with distinct files; each unit merges as it hands back and the workstream's next unit starts from the new master |

### Batch 11 result

**The plan is complete.** Merged: #127 the plan; #128 W-intro 1 (the copyright screen, the framework, the Game Freak
scene; `gba/menu2.ts`); #129 W-help 1 (the engine, the menus, the text through `tools/extract_help.py`, the BGM
halving; R in the slot machine opens the help in HELP mode, as on the GBA); #130 W-kanto 1 (Cerulean Cave, every
legendary's battle to its end; the field message box now closes on the return from a battle, as InitFieldMessageBox
does); #132 W-intro 2 (scenes 1-3, frame counts checked against intro.c); #131 W-preview (map_preview_screen.c, the
cave and forest banners); #133 W-help 2 (the contexts at every ported screen, the help specials,
gHelpSystemEnabled FALSE until the title screen); #134 W-kanto 2 (IsNationalPokedexEnabled checks all three of the
C's conditions everywhere, the summary screen's "No. ???"). The end-of-batch e2e run had two failures, both test
races, fixed in the STATUS PR (ssAnne.test.ts's wandering sailor, postgameSevenIsland's warp-then-read).

Left after this plan: the screens that set help contexts but aren't ported (mail, Teachy TV, Mystery Gift, the link
screens, the quest log), the Fame Checker, link play, the unused weathers.

## Rules

Worker and merger rules: docs/WORKFLOW.md sections 3 and 4. Each worker's e2e file is named in its unit above.
**Testing:** workers run typecheck, `npm test`, their own e2e files and a few named files covering shared code
they touch, never the full e2e suite; each merge runs typecheck, unit tests and the PR's own e2e files; the full
suite runs once, at the end of the batch, on master with everything merged (failures there: rerun the failing
files only). Docs-only PRs: no tests. Workers kill any headless Chrome they started before handing back.

## Decisions

1. **A new plan doc for these four** (coordinator, revisit if you disagree): POSTGAME_PLAN.md is complete and three
   of the four aren't postgame work.
2. **Four workers at once, one PR per unit** (coordinator, revisit if you disagree): four workstreams with distinct
   files; only W-preview's is a single unit, the others hand their second unit to a continuation worker.
3. **The intro plays on every boot outside the e2e harness** (coordinator, revisit if you disagree): as on the GBA;
   dev `?skipIntro` (the harness's default) keeps skipping the copyright screen, the intro and the title screen.
4. **HelpSystem_IsSinglePlayer is always TRUE** (coordinator, revisit if you disagree): there's no link play, so the
   help system never refuses for a link (SE_HELP_ERROR only when HelpSystem_Disable has run).

## Not in this plan

Link play (the cable club, the e-Reader room), the unused weathers, the Fame Checker, Teachy TV, mail, the quest
log.

## Batch 13: dynamic-graphics objects and the rest of the field weathers

Two items the user asked for (and only these; the quest log's QL4b / QL5 move to the next batch). Checked against
the decomp and master at `ee4c4ec` (2026-10-19).

### What was checked

- **Dynamic-graphics objects** (`OBJ_EVENT_GFX_VAR_0..F`, sprite from `VAR_OBJ_GFX_ID_0..F`,
  VarGetObjectEventGraphicsId). The maps with such objects: Viridian City (the tutorial old man: three states by
  VAR_MAP_SCENE_VIRIDIAN_CITY_OLD_MAN), Fuchsia City (the Kabuto / Omanyte by FLAG_GOT_DOME_FOSSIL), Birth Island
  (Deoxys), the Trainer Tower 1F-8F (trainer_tower.c's SetTrainerTowerNPCGraphics, `VAR_OBJ_GFX_ID_0..3`), and two
  link maps (the Seven Island house's e-Reader room: SetEReaderTrainerGfxId; the Union Room:
  union_room_player_avatar.c). battle_tower.c's VarSet is R/S code FRLG never runs. No rival appearance uses them
  (the rival is OBJ_EVENT_GFX_RIVAL everywhere). Every FRLG script sets the vars in MAP_SCRIPT_ON_TRANSITION (or
  through a special called there), before the objects spawn; no FRLG script sets one and then `addobject`s in the
  same run. The port (`OverworldScene.preloadMapSprites`) preloads the map's sprites again after ON_TRANSITION /
  ON_LOAD with the vars resolved, so these maps work; only Viridian's old man and the Trainer Tower have e2e
  checks. The trap (a `setvar VAR_OBJ_GFX_ID_*` then `addobject` mid-script logs `[overworld] no sprite loaded`
  and spawns nothing) is reachable only from a dev script, but the C has no such limit: SpawnObjectEventInternal
  takes the graphics from ROM at spawn time. The text colour (field_specials.c GetTextColorFromGraphicsId's
  VarGetObjectEventGraphicsId) also resolves the var.
- **Field weathers** (field_weather.c 1,147 lines, field_weather_effects.c 2,346, field_weather_util.c 105;
  `world/weather.ts`, `world/fogHorizontal.ts`, `world/weatherTextures.ts`). Ported: None, Sunny, Shade,
  FogHorizontal (and Underwater, which shares its row). Not ported, all run as None's callbacks and log once:
  Clouds (WEATHER_SUNNY_CLOUDS), Rain, Snow, Thunderstorm, Ash, Sandstorm, FogDiagonal, Drought, Downpour (Downpour_*
  with Thunderstorm_Main / _Finish), Bubbles. No FRLG map or script reaches them (map weathers: NONE, SUNNY, SHADE,
  FOG_HORIZONTAL; `setweather` only 0 and SHADE). The sprite sheets (`graphics/weather/`: rain, snow0/1, ash,
  sandstorm, fog_diagonal, cloud, bubble, the palettes) are extracted already. Four weathers draw BLDALPHA-blended
  sprites with transparent pixels (Clouds, Ash, FogDiagonal, Sandstorm: ST_OAM_OBJ_BLEND), which the horizontal
  fog's MULTIPLY-then-ADD trick (it needs a sprite layer that covers the screen) can't do. The sounds: the SE3 loops
  (SE_RAIN, SE_DOWNPOUR, SE_THUNDERSTORM: field_weather.c's SetRainStrengthFromSoundEffect and the effects'
  PlaySE12 / m4a calls), thunder (UpdateThunderSound: SE_THUNDER / SE_THUNDER2), and PlayRainStoppingSoundEffect
  (16 C call sites: field_weather.c, field_fadetransition.c, start_menu.c, seagallop.c; the port has comments at
  OverworldScene, dive.ts, seagallop.ts, weather.ts). `gba/sound.ts` has IsSpecialSEPlaying and the SE3 player.
  The battle's switch-in weather (ABILITYEFFECT_SWITCH_IN_WEATHER) already reads GetCurrentWeather at the battle's
  start.

### Workstreams

One PR per unit, merged as it hands back; W-weather's units 2 and 3 start from master after unit 1 merges, in
parallel.

**W-dyngfx: dynamic-graphics objects (1 unit).** Load a dynamic object's sprite so a spawn in the same script run
works, as SpawnObjectEventInternal does on the GBA (suggested: a VarSet of a VAR_OBJ_GFX_ID_* starts loading the
sheet and `addobject` / the spawn path wait for it within the script, so the object appears that frame; or another
way that gives the same result without making all spawns async). Check every FRLG map above in the port: the old
man's three states, Fuchsia's Kabuto / Omanyte before and after the Dome Fossil, Birth Island's Deoxys, the Trainer
Tower floors (singles, doubles, knockout), the text colour of a dynamic object; fix what's wrong. E2e
`tests/e2e/dynamicGfx.test.ts`: Fuchsia's two states, Birth Island's Deoxys (its graphics id on the map), a dev
script that sets a VAR_OBJ_GFX_ID_* to a sprite the map doesn't preload and `addobject`s at once (the object out
with that sheet on the same frame, no warning). Plus `trainerTower.test.ts` and the Viridian old man's e2e file.
Owns `OverworldScene`'s object spawning and preload (small changes), `script/ScriptEngine.ts`'s `addobject` /
`setvar` hooks if needed.

**W-weather: the rest of FRLG's weathers (3 units).** Each weather as field_weather_effects.c has it (its
InitVars / InitAll / Main / Finish, sprite templates, OAM, anims, callbacks, gamma targets and steps), with
field_weather.c's parts it needs, the sounds, and the palette / gamma behaviour; `PORTED` gains its row.
Testable through `setweather` + `doweather` (a dev script or a test hook); e2e `tests/e2e/weather.test.ts` grows
(or a second file, `weatherEffects.test.ts`, if it gets long): the sprites' count and positions over a few frames,
the gamma / blend values, the SE3 song, the finish (sprites gone, SE stopped).

1. **The weather sprite layer, Rain, Thunderstorm, Downpour, the sounds.** A generic layer for the weathers' sprites
   (the C's sprite templates with their callbacks run in plain TS beside weather.ts, the host only draws them;
   positions from gSpriteCoordOffsetX / Y like the fog), including **ST_OAM_OBJ_BLEND for sprites with transparent
   pixels** (BLDALPHA: min(31, (obj * EVA + bg * EVB) >> 4) where the sprite has a pixel, the background unchanged
   elsewhere), so units 2 and 3 reuse it; unit 1 owns it and checks it with a unit or e2e test even though rain
   doesn't blend. Rain_* (the 24 rain sprites, StartRainSpriteFall, the splash), Thunderstorm_* and Downpour_*
   (the lightning: ApplyWeatherGammaShiftIfIdle_Gradual / ApplyGammaShiftWithBlend, SetThunderCounter,
   UpdateThunderSound), FadeInScreen_RainShowShade for the rain weathers, field_weather.c's sound half
   (SetRainStrengthFromSoundEffect, PlayRainStoppingSoundEffect at all 16 C call sites the port has: the start
   menu, field_fadetransition.c's warps, seagallop.c, the weather change, Dive), the SE3 loops. Remove AUDIO_PLAN.md
   "Not in this plan"'s rain-SE deferral and the "no field weather yet" comments. E2e: rain (sprites, SE_RAIN on
   SE3, the shade), thunderstorm (a lightning flash's gamma, SE_THUNDER), downpour, a stop (SE_RAIN_STOP), a wild
   battle in rain starting with the rain message (optional cross-check).
2. **Snow, Ash, Sandstorm** (after unit 1 merges). Snow_* (snow0 / snow1 sprites, the flakes' fall and sway),
   Ash_* (LoadAshSpriteSheet, the blended ash layer), Sandstorm_* (the wave sprites and the swirl sprites,
   UpdateSandstormWaveIndex / Movement), their blends through unit 1's layer. E2e: each weather's sprites and blend,
   and its finish.
3. **Clouds, FogDiagonal, Drought, Bubbles** (after unit 1 merges, beside unit 2). Clouds_* (WEATHER_SUNNY_CLOUDS),
   FogDiagonal_*, Drought_* with field_weather.c's drought palettes (ApplyDroughtGammaShiftWithBlend,
   LoadDroughtWeatherPalettes, DroughtStateInit / Run, FadeInScreen_Drought, StartDroughtWeatherBlend), Bubbles_*
   (WEATHER_UNDERWATER_BUBBLES: its fog sprites plus the bubbles). Remove DEVIATIONS' "run as WEATHER_NONE" note
   and the log line in weather.ts. E2e: each weather's sprites / palettes and its finish.

Units 2 and 3 each add their weathers in their own new module(s) (e.g. `world/weatherSnow.ts`,
`world/weatherDrought.ts`) and only touch `PORTED`, the host and the test hooks in shared files; unit 3 owns the
DEVIATIONS / DEV_NOTES weather entries' final wording (unit 2 adds its lines).

### Shared files

- `scenes/OverworldScene.ts`: W-dyngfx (object spawning, preload), W-weather (the host, the PlayRainStoppingSoundEffect
  call sites): different methods.
- `world/weather.ts`, `world/fogHorizontal.ts`, `world/weatherTextures.ts`, the weather host, the weather sprite
  layer: W-weather unit 1, then units 2 and 3 (small registrations; the merger resolves the `PORTED` line).
- `dev/testHooks.ts`: both (separate hooks).
- `tests/e2e/weather.test.ts`: W-weather (units 2 and 3 add their own `describe`s or files).

### Batch 13 workers

| Phase | Workers | Why |
|---|---|---|
| 1 | W-dyngfx, W-weather 1 | distinct files; unit 1 builds the sprite layer units 2 and 3 need |
| 2 | W-weather 2, W-weather 3 | after unit 1 merges; their own modules |

### Batch 13 result

**Done.** Merged: #152 the plan; #153 W-dyngfx (a VarSet of a VAR_OBJ_GFX_ID_* starts loading the sheet; `addobject`
holds the field's frame until it's in, so the object spawns that frame; every FRLG map with dynamic objects checked:
Viridian's old man, Fuchsia's Kabuto / Omanyte, Birth Island's Deoxys, the Trainer Tower's singles / doubles /
knockout: none was broken); #154 W-weather 1 (the weather sprite layer with BLDALPHA for sprites with transparent
pixels, Rain / Thunderstorm / Downpour, the SE3 loops and PlayRainStoppingSoundEffect; the battle's switch-in
weather now reads GetCurrentWeather, not the map header's); #155 W-weather 2 (Snow, Ash, Sandstorm); #156 W-weather 3
(Clouds, the diagonal fog, the drought as FRLG's dummied-out C leaves it, the bubbles; no weather falls back to
WEATHER_NONE). The end-of-batch e2e run (558 tests in 92 files) failed only the two known load-sensitive files:
postgameKantoLegendaries' bird catches were a test race (a RIGHT in the bag before Task_AnimateWin0v ended was
dropped), fixed in the STATUS PR; Sevault Canyon fails alone on the pre-batch master too and stays a loose end.

### Batch 13 rules

Workers and merger: docs/WORKFLOW.md sections 3 and 4. **Testing:** workers run typecheck, `npm test`, their own
e2e files and a few named files covering shared code they touch, never the full e2e suite; each merge runs
typecheck, unit tests and the PR's own e2e files; the full suite runs once, at the end of the batch, on master with
everything merged (failures there: rerun the failing files only). Docs-only PRs: no tests. Workers kill any
headless Chrome they started before handing back.

### Batch 13 decisions

1. **The plan as a section of GAPS_PLAN.md** (coordinator, revisit if you disagree): two small single-player gaps,
   the same kind of work as batch 11's.
2. **W-weather in three units, the last two in parallel** (coordinator, revisit if you disagree): unit 1
   owns the shared sprite layer (with the BLDALPHA blend for sprites with transparent pixels that Clouds, Ash,
   FogDiagonal and Sandstorm need), so units 2 and 3 can run side by side after it; the blended weathers are split
   between them by size.
3. **WEATHER_SUNNY_CLOUDS is ported with the others** (coordinator, revisit if you disagree): it's the one other
   sWeatherFuncs row FRLG compiles that no map reaches; the request's list didn't name it, but "the rest of FRLG's
   weathers" covers it.
4. **Two workers at a time** (coordinator, revisit if you disagree): there are only four units and units 2-3 depend
   on unit 1.
