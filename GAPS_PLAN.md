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
