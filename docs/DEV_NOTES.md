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
- **Player avatar:** `world/playerAvatar.ts` is field_player_avatar.c and `world/bike.ts` is bike.c; like the C,
  `gPlayerAvatar` (flags, runningState, tileTransitionState, ...) is a module global, so specials and item uses
  call `TestPlayerAvatarFlags`, `SetPlayerAvatarTransitionFlags`, `GetOnOffBike` etc. directly. OverworldScene
  implements `PlayerAvatarHost` (map, collision = `collisionAt` / GetCollisionAtCoords, objects, tasks, controls
  lock) and runs DoCB1_Overworld's part after the objects' update each tick: `UpdatePlayerAvatarTransitionState`,
  `fieldGetPlayerInput` (FieldGetPlayerInput: A/START only at T_NOT_MOVING or T_TILE_CENTER, `tookStep` at a tile
  centre), `processPlayerFieldInput` (ProcessPlayerFieldInput in the C's order), else `PlayerStep`. The player
  moves only through held movements: `ObjectEvent.setHeldMovement(MOVEMENT_ACTION_*)` (`entities/movementActions.ts`
  maps action ids to steps, jumps, in-place anims, faces and delays); `heldMovementFinished` is what makes the next
  input frame T_TILE_CENTER. Hooks for other workstreams:
  - **States:** `SetPlayerAvatarTransitionFlags(PLAYER_AVATAR_FLAG_SURFING / MACH_BIKE / ON_FOOT)` swaps the
    graphics (preloaded at boot) and the state; `PLAYER_AVATAR_FLAG_FORCED` is set while a tile moves the player.
    Warps carry the state (`StoreInitialPlayerAvatarState` at TryStartWarpEventScript / TryArrowWarp / TryDoorWarp,
    `GetInitialPlayerAvatarState` in `initPlayerAvatarOnWarp`, which also picks the arrival facing); arriving on
    water starts surfing. After a battle or menu `ReturnPlayerAvatarToField` rebuilds the flags from the graphics.
  - **Forced movement:** `sForcedMovementFuncs` (ice, spinners, currents, slides, waterfall) run from PlayerStep
    once the player has moved (CONTROLLABLE cleared); step-based scripts and encounters skip forced tiles.
  - **Surf:** `ForcePlayerToStartSurfing` / the SURFING transition (W-surf adds FLDEFF_SURF_BLOB through the
    host's optional `startSurfBlob` / `stopSurfBlob`); walking into elevation-3 land gets off
    (CanStopSurfing → CreateStopSurfingTask). `PartyHasMonWithSurf` and `IsPlayerSurfingNorth` are there.
  - **Strength:** with FLAG_SYS_USE_STRENGTH, walking into an OBJ_EVENT_GFX_PUSHABLE_BOULDER pushes it
    (TryPushBoulder → Task_BumpBoulder; holes and Victory Road switches in `OverworldScene.boulderPushed`).
  - **Bike:** the Bicycle's bag use is `FieldUseFunc_Bike` (menus/itemUse.ts) through `gFieldCallback`
    (menus/fieldCallbacks.ts), which the field runs after the bag closes. Specials: ForcePlayerOntoBike,
    GetPlayerAvatarBike, ForcePlayerToStartSurfing, SeafoamIslandsB4F_CurrentDumpsPlayerOnLand,
    GetPlayerFacingDirection. `lock`/`release` go through `IsFreezePlayerFinished` / `ClearPlayerHeldMovement`.
  Probes: `__test.field().avatar` (flags, states, graphics, held action), `__test.setAvatarState('SURFING')`,
  `__test.objects()`. Tests: tests/e2e/playerAvatar.test.ts (Icefall Cave B1F ice at (20,7), Rocket Hideout B2F
  spinner from (9,19), Route 16 gate (4,12) for Cycling Road, Route 17 slope (7,2), Pallet Town pond (8,18),
  Seafoam 1F boulder from (23,12)).
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
- **Field ListMenu:** `ui/FieldListMenu.ts` has three layers: `FieldListMenu` (list_menu.c's ListMenu on a
  MenuWindow: `cursorPos` is the scroll offset and `itemsAbove` the cursor's row, as in the C; its own key repeat
  since the field Input has none), `FieldScrollArrows` (menu_indicators.c's up/down pair as Phaser images; preload
  `fieldListMenuGfxSymbols`) and field_specials.c's `special ListMenu` task, a field task that ends the script's
  `waitstate` (and stays up, suspended, for lists that `ReturnToListMenu` comes back to). The item strings come
  from scripts.json `listMenus` (sListMenuLabels), the layouts from ListMenu's switch. Any other field list (e.g.
  a future port of a field screen that uses ListMenuInit) can reuse `FieldListMenu`. Probe: `__test.field().listMenu`
  (scroll, row, selected, suspended, arrows). Tests: Silph Co. 1F `?map=SilphCo_1F&x=22&y=4`, Up into the
  elevator, panel at (0,2) from (0,3); Cerulean badge list `?map=CeruleanCity_House1&x=7&y=5`, face left.
- **Flash:** `world/flash.ts`. The level is `GameState.flashLevel` (gSaveBlock1Ptr->flashLevel), set by
  `SetDefaultFlashLevel` in `OverworldScene.onMapLoaded` (maps carry `cave`) and by `setflashlevel`. `FieldFlash`
  is the field's WIN0H scanline effect: the circle table (double-buffered, swapped in `tick()`'s VBlank step),
  the flash tasks (`animateflash`), and a black overlay at `DEPTH_FLASH` (over every map layer and object, under
  the text windows, as WINOUT shows only BG0). It's rebuilt from the level after a warp and in `resumeMap`
  (InitCurrentFlashLevelScanlineEffect); a map connection keeps it. On the GBA layer, `FieldGbaScreen.start` runs
  the real scanline effect into REG_WIN0H (`InitCurrentFlashLevelScanlineEffect`). The Flash field move
  (W-fieldmove) checks `SetUpFieldMove_Flash` and ends in `OverworldScene.useFlash()` (FldEff_UseFlash).
  Probes: `__test.field().flash` ({ level, dark: share of the screen covered }), `gbaScreenBlack`,
  `__test.useFlash()`. Test spot: Route 10 `?map=Route10&x=8&y=20`, Up into Rock Tunnel.
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
- **Scripted battles:** specials that start a battle (StartOldManTutorialBattle, StartMarowakBattle in
  `script/specials.ts`) call `host.startScriptedBattle(flags, enemyParty, transition)` and block the script with
  `setWaitState` until the field has faded back in (their CB2_End* sets VAR_RESULT; a loss calls `endScript()` +
  `host.whiteOut()`). `setwildbattle` leaves gEnemyParty in `state.enemyParty`; `host.wildBattleTransition(mon)` is
  GetWildBattleTransition. Every battle start (OverworldScene.runBattle) does Task_BattleStart's
  RestartWildEncounterImmunitySteps. Tests: tests/e2e/pokemonTower.test.ts (walk onto the 6F trigger at 11,15).
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
- **Battle anims:** `src/battle/anim/` (see docs/LOG.md "Battle animation engine"): every battle_anim_*.c file is
  ported, one module per C file (`battle_anim_fight.c` → `fight.ts`, ...; `battle_anim_effects_3.c` is split over
  `effects3.ts` and `effects3b.ts` at AnimTask_PainSplitMovement), each registered in `ported.ts`, with graphics a
  callback loads itself listed through `registerAnimExtraGfx`. The unit test asserts `battleAnimCoverage()` finds
  nothing missing in any of the 397 scripts. Templates a task creates itself (e.g. gRainDropSpriteTemplate) aren't
  seen by the coverage check. `DestroySprite` gives the sprite a new `data` array: don't read a saved
  `sprite.data` after destroying it. E2e tests whose outcome depends on an accuracy roll should reseed
  (`reseed()` in tests/e2e/battleAnimHelpers.ts) right before that roll: other anims' lengths change when the
  roll happens.
  A file's static `union AffineAnimCmd[]` / tables come from anims.json (`bdata.anims.units['battle_anim_x.c']`,
  `affineAnimTable`; see psychic.ts). Scanline effects: `ScanlineEffect_SetParams` with per-line buffers, or
  `ScanlineEffect_InitWave` (src/gba/scanline.ts) for a travelling sine wave. An e2e test can read module state
  in the page with `await new Function('p', 'return import(p)')('/src/gba/hw.ts')` (a bare `import()` in the
  function gets rewritten by Vitest); see battleAnims.2d.test.ts's `hblankLines`.

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
