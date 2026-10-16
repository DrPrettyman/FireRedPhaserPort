# Developer notes

How the port's main pieces fit together, where to hook in, and how to test them. README.md has the file map;
this is the next level down. When you add or change a subsystem, update its entry here.

## Field

- **Overworld sprites:** draw order follows the GBA. Each object's OAM priority comes from its elevation
  (`ObjectEvent.updateElevationAndPriority`), and the 16 px screen-row subpriority (`updateSubpriority`) is
  recomputed every frame against last frame's camera (`field.cameraTop`). `objectDepth` in MapChunk.ts packs
  them into Phaser depths between the `below`/`above` layers, or above `above` for priority 1. The camera follows
  `ObjectEvent.anchor`, which leaves out the jump lift. `OBJ_EVENT_GFX_VAR_*` graphics are resolved from
  `VAR_OBJ_GFX_ID_*` at spawn (`resolveGraphicsId`).
- **Map layers / tile animations:** each map is three tilemaps (`ATLAS_LAYERS` bottom/middle/top = BG3/BG2/BG1,
  `LAYER_DEPTH` in MapChunk.ts), with OAM priority 3/2/1 sprite bands between them (`objectDepth`).
  `world/TilesetVram.ts` holds each loaded tileset's GBA tiles (`tilesetVram` stores, loaded by
  `Assets.loadTilesetTextures`); for a pair with an animated tileset its atlases become canvas textures and
  `writeTiles` redraws the slots whose metatiles use a changed tile. `world/tilesetAnims.ts` is tileset_anims.c,
  driven from `OverworldScene.tick` (InitTilesetAnimations on a warp, InitSecondaryTilesetAnimation on a
  connection). `__test.tilesetTile(name, tile)` shows a tile's current bytes.
- **Doors:** `world/doors.ts` (FieldDoors) is field_door.c: a door frame is drawn into small canvas textures over
  the door cell(s), with the map's tiles there hidden (`MapChunk.setCellVisible`). `OverworldScene.doDoorWarp`
  (Task_DoorWarp) and `exitDoor` (Task_ExitDoor) run as overlays, which freeze the NPCs and the input.
- **Field effects:** `entities/FieldEffects.ts` has FieldEffectSprite (struct Sprite's fields + sprite.c frame
  anims, drawn by Phaser) and the ported FldEff_* / Update*FieldEffect functions; `entities/groundEffects.ts` is
  the GetAllGroundEffectFlags_* / DoFlaggedGroundEffects / GroundEffect_* part of event_object_movement.c.
  ObjectEvent carries the GBA ground-effect state and calls `field.groundEffects` from its spawn / begin-step /
  finish-step points; `current` is the GBA's currentCoords, which during a jump differ from tileX/tileY (the
  landing tile, for collisions). Probes: `field().fieldEffects` / `playerEffects`. Test spots: Route 1 ledge into
  grass (12, 4), Viridian pond (14, 24), Four Island puddles (10, 8; mash through the rival scene first), Five
  Island sand (8, 3), Kindle Road shallow water (4, 17), Ember Spa (11, 10).
- **Interactions:** `OverworldScene.interact` is GetInteractionScript (object → bg event → metatile via
  `METATILE_SCRIPTS`); `tryWalkIntoSignpost` runs after a step (before the wild check) and when holding toward the
  facing direction. The signpost / walk-away / last-message-dismiss state (script.c statics) lives in ScriptEngine
  (`msgSetSignpost`, `handleCancelSignpost`, `takeRegisteredInput`); MessageBox draws the signpost frame when told.
  Tests: Viridian Forest item ball (`?start=after-rival&map=ViridianForest&x=5&y=42`, face up, A), hidden Potion
  (x=3 y=23), Pallet town sign (x=9 y=13, hold up), Viridian PC (`map=ViridianCity_PokemonCenter_1F&x=11&y=2`).
- **Multichoice / elevators:** `ui/MultichoiceMenu.ts` (vertical list and grid, field windows); the script engine
  sets VAR_RESULT from `ScriptHost.openMultichoice`. `text/stringWidth.ts` is GetStringWidth for any font set
  (the field's or the GBA layer's). Specials can start field tasks that outlive them (`ScriptHost.startFieldTask`,
  run after the script each frame like RunTasks); `world/elevator.ts` uses that. Test: walk into the Celadon Dept.
  Store elevator from 1F (`?start=after-rival&map=CeladonCity_DepartmentStore_1F&x=6&y=2`, Up), panel at (4,1).
- **Map name popup:** `ui/MapNamePopup.ts` (Task_MapNamePopup) is owned by `OverworldScene` (`showMapNamePopup`,
  `showMapNameOnWarpArrival`); `world/regionMap.ts` is GetMapName (shared with the summary screen). Maps carry
  `floorNumber`. Tests: `tests/e2e/mapNamePopup.test.ts`, probe `__test.mapNamePopup()`.
- **Screen transitions:** `battle/transition.ts` is battle_transition.c; `world/fieldGbaScreen.ts` puts the field
  on the GBA layer for it (start → BattleTransition_StartOnField, `frame()` once per overworld tick, stop when
  IsBattleTransitionDone) and has a bare mode for CB2_DoChangeMap's cave flash screens (`world/mapTransition.ts`,
  also MapTransitionIsEnter/IsExit). Warps go WarpFadeOutScreen → doChangeMap → SetUpWarpExitTask in
  `OverworldScene.warpTo`. `__test.forceBattleTransition('SWIRL')` makes the next battles use one transition.
  The map preview screens are the obvious next piece: TryDoMapTransition already knows where they'd run.
- **Trainer sight:** `world/trainerSee.ts` (checkForTrainersWantingBattle + the TrainerApproach task), run from
  `OverworldScene.tick` on every frame the controls are free (mid-step too, against the step's destination).
  ScriptEngine.setUpTrainerBattleFromApproach is ConfigureAndSetUpOneTrainerBattle; `special EndTrainerApproach`
  starts the task. Test trainers: Viridian Forest Rick (`?start=after-rival&map=ViridianForest&x=41&y=45`, step
  right), Route 20 Nora for the camera pan (teleport the player to 34,11).
- **Wild encounters:** `world/WildEncounters.ts` (wild_encounter.c) runs from `OverworldScene.processStep`
  after every completed step, incl. the first tile after a map connection. `startWildBattle` is
  StartWildBattle + CB2_EndWildBattle as a field overlay (white-out on a loss); `doSafariBattle` is
  DoSafariBattle + CB2_EndSafariBattle. To skip the dice in tests:
  `s.startWildBattle(s.state.pokemon.createMonWithNature(species, level, 32, nature, {...}))` on the Overworld scene.
  `state.currentMapId` is the MAP_* id (`currentMap` is the folder name).
- **Step counters:** `world/stepCounters.ts` (happiness, VS Seeker, field poison, egg cycles), called from
  `OverworldScene.tryStartStepCountScript`; `world/roamer.ts` is roamer.c with its EWRAM statics as module state
  (`roamerLocation()` for tests). Field code may call battle-engine pokemon.c functions (AdjustFriendship): the
  overworld initialises the battle env at boot.

## GBA screens and menus

- **GBA screens:** `src/gba/main.ts` is gMain (callbacks, ReadKeys with key repeat). `GbaHostScene` runs the
  main loop; `BattleScene` and `FieldMenuScene` extend it. Screens hand over with SetMainCallback2 like the C
  (battle → CB2_BagMenuFromBattle → ... → ReshowBattleScreenAfterMenu → BattleMainCB2). Graphics are fetched
  asynchronously, so `prepareMenus()` (src/menus/host.ts) preloads everything the bag/party/summary can draw
  (incl. each party mon's front pic and palettes). The summary is `ShowPokemonSummaryScreen` /
  `ShowSelectMovePokemonSummaryScreen` + `GetMoveSlotToReplace` (src/menus/summaryScreen.ts).
- **Poké Mart:** `ui/ShopMenu.ts` is the field side of shop.c (the BUY/SELL/SEE YA! menu as a field overlay and
  the return hook); `menus/shop.ts` is the buy menu on the GBA layer, run by FieldMenuScene (`menu: 'buy' | 'sell'`).
  The buy menu's map view reads the field through `ShopFieldView` (`OverworldScene.shopFieldView`), and
  `LoadFieldTilesetsForShop` puts the map's tiles/palettes where the overworld would have left them in VRAM.
  `menus/objectEventGraphics.ts` is CreateObjectGraphicsSprite for any GBA-layer screen that needs NPC sprites.
  Test: `?start=after-rival&map=PewterCity_Mart&x=4&y=3`, face left, A (TM layout: Celadon Dept. Store 2F, x=3 y=6).
- **Naming screen:** `DoNamingScreen` (`menus/namingScreen.ts`) runs on any GBA host. From a script, use
  `ScriptHost.doNamingScreen` (FieldMenuScene `naming`). Oak's speech (not ported) should call it with
  NAMING_SCREEN_PLAYER (monSpecies = the player's gender) and NAMING_SCREEN_RIVAL, preloading
  `namingScreenGfxSymbols` after `setObjectEventGraphicsInfo` (the icons are object event graphics).
- **Evolution scene:** `menus/evolutionScene.ts` + `menus/evolutionGraphics.ts` run on whichever GBA host is up
  (BattleScene after TryEvolvePokemon, FieldMenuScene from the party menu) and hand back through
  `gCB2_AfterEvolution` (`setCB2_AfterEvolution`). It draws on the battle BG/window layout, so the field host
  needs the battle text setup too (`initBattleMessages`, `setBattleTextSpeed`). `menuGfxSymbols` preloads the
  scene's graphics plus the pics/palettes/icons of every species the party can evolve into
  (`evolutionTargetSpecies`). Tests wait for the `evolution` event (`from`, `to`, `stopped`).

## Battle

- **Battle architecture:** `src/gba` emulates the GBA video hardware; `src/battle` is a near line-for-line port of
  battle_main.c, battle_script_commands.c, battle_util.c, the controllers, battle_interface.c, battle_gfx_sfx_util.c,
  pokeball.c etc. on top of it. `BattleScene` runs CB2_InitBattle → CB2_HandleStartBattle → BattleMainCB1/CB2 +
  VBlankCB_Battle at 60 Hz and draws with the software PPU. `OverworldScene.startTrainerBattle` builds `BattleStart`.
- **Battle anims:** `src/battle/anim/` (see docs/LOG.md "Battle animation engine"). To port more: find what a
  script still needs with `battleAnimCoverage()` (tests/unit/battleAnims.test.ts), port those callbacks/tasks from
  the battle_anim_*.c file into a module (or `moves.ts`), register them in `ported.ts`, add the label to the
  unit test, and graphics a callback loads itself to `registerAnimExtraGfx`. All special anims run, so
  InitAndLaunchSpecialAnimation has no fallback any more (unit-tested: every Special_* script stays fully ported).

## Testing and debugging

- **Tests:** `npm test` (unit) and `npm run test:e2e` (headless playthroughs, ~20 s); how to write them is in
  tests/README.md. Each e2e file starts from a URL preset, drives `window.__test` (`src/dev/testHooks.ts`) and
  asserts on state and events. New field mechanics should get a scenario there rather than a one-off
  `browser-test.mjs` run. The game reports milestones through `testEvent()` (map, script, trainerApproach,
  battleTransition, battleTransitionEnd, battleStart, battleEnd, whiteOut, mapTransition, barnDoorWipe); add one
  wherever a test needs to know something happened.
- **Skip the intro:** `?start=after-rival[&starter=bulbasaur|squirtle|charmander]` (dev only) starts in Oak's lab
  right after the first rival battle, won (`src/dev/startPresets.ts`); add `&map=&x=&y=` to start elsewhere with
  that state. When a script on the way changes, update the preset to match.
- **Evolution test bed:** `?start=evolution[&starter=...]` is after-rival plus a party set up to evolve, in Viridian
  Forest six tiles left of Bug Catcher Rick (step right and he spots you): the starter at Lv. 15, one exp point
  short of 16 (beat Rick); Caterpie Lv. 6 + a Rare Candy; Pikachu Lv. 10 + a Thunder Stone. Not a story state.
- **Bag tests:** `battleTest.launch({..., bag: [["ITEM_POTION", 3]]})` stocks the bag for a battle.
- **Quick battle test:** `npm run dev:battle` opens `battle-test.html`: pick both parties (species, level, moves,
  held item), trainer or wild, single/double, IVs, terrain, then Start. Scripted: `battleTest.launch({...config})`
  and `mash:battleTest.lastOutcome` in `browser-test.mjs`; `await import('/src/battle/env.ts')` exposes the live
  battle globals (`g`).
- **Test driver:** `eval:` in `tools/browser-test.mjs` now awaits promises, so `eval:(async()=>{const r=await
  import('/src/world/roamer.ts'); ...})()` reaches module state.
- **Testing long scenes (ad hoc):** `tools/browser-test.mjs` has `mash:<js>` (press A until a condition holds), e.g.
  `mash:game.scene.getScene("Overworld").state.getVar("VAR_MAP_SCENE_PALLET_TOWN_PROFESSOR_OAKS_LAB")===2`.
  Build step lists as a bash array (`args+=(...)`) so JS with spaces survives word splitting.
- **How to find what a script needs:** unimplemented script commands and specials log once to the browser console
  as `[script] unimplemented command ...`.
- **Bugs that depend on world position:** `?map=` always loads at origin 0, so maps that are far from the origin in
  a real playthrough (e.g. Viridian at y = -80 after walking up from Pallet) need either a real walk or
  `await s.world.load(name, ox, oy)`, then `s.player.setPosition(...)` and `await s.onMapLoaded(false)`.
