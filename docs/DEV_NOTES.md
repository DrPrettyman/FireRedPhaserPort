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
  - **Surf:** `ForcePlayerToStartSurfing` / the SURFING transition (the surf blob comes through the host's
    optional `startSurfBlob` / `stopSurfBlob` / `destroySurfBlob` / `setSurfBlobInvisible`, which OverworldScene
    points at world/surf.ts); walking into elevation-3 land gets off (CanStopSurfing → CreateStopSurfingTask).
    `PartyHasMonWithSurf` and `IsPlayerSurfingNorth` are there. Using Surf / Waterfall: "Surf and Waterfall".
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
- **Map layouts (`setmaplayoutindex`):** maps carry `layoutId` (gMapHeader.mapLayoutId) and `GameState.mapLayoutId`
  is gSaveBlock1Ptr->mapLayoutId: `onMapLoaded` sets it from the header before ON_TRANSITION (LoadCurrentMapData),
  the script command changes it (SetCurrentMapLayout), and `initMapLayout` then swaps the current chunk's grid,
  border and tilesets (`World.setCurrentLayout`) before ON_LOAD, as InitMap would build it. CONTINUE takes it from
  the save (`location.mapLayoutId`). Layouts no map header uses are extracted to `maps/layouts/<LAYOUT_ID>.json`
  (`Assets.loadLayout`; `maps/layouts/index.json` names the map file for the others), LAYOUT_* ids are in the
  script defines. Users: Seafoam Islands B3F/B4F (currents stop once both boulders are down), Three Island's
  Dunsparce Tunnel, Seven Island's house. Tests: tests/e2e/mainPathLeftovers.test.ts (B4F from (7, 6), B3F from
  (12, 8); a dev start never passed Route 20, so both boulders count as down there).
- **Silph Co. card key doors** (data/scripts/silphco_doors.inc) need nothing of their own: ON_LOAD closes them with
  `setmetatile`, the bg events open them (FLAG_HIDE_SILPH_CO_5F_CARD_KEY, `special SetHiddenItemFlag`). Test spot:
  `?map=SilphCo_5F&x=9&y=9`, face left (mark the floor's trainers beaten first).
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
- **Field moves:** four pieces.
  - `world/fieldEffectScripts.ts` is field_effect.c's interpreter: `FieldEffectStart('FLDEFF_*')` runs the
    decomp's own script (data/field_effect_scripts.s → `field_effects/scripts.json`), whose `callnative` calls a
    function registered with `registerFieldEffectNatives({ FldEff_X })`; `gFieldEffectArguments`,
    `FieldEffectActiveListRemove/Contains` as in C (Contains also sees `entities/FieldEffects.ts`' Phaser
    effects). Script commands `dofieldeffect` (a following `waitstate` waits for the effect's
    ScriptContext_Enable), `waitfieldeffect`, `setfieldeffectargument`, `checkpartymove` (+ `buffermovename`,
    `setescapewarp`) are in ScriptEngine's "field effects and field moves" block.
  - Party menu (`menus/partyMenu.ts`): CursorCB_FieldMove calls the move's SetUpFieldMove_* from
    `registerFieldMoveSetUp('FIELD_MOVE_X', fn)`; it returns TRUE after setting `gFieldCallback2.fn =
    FieldCallback_PrepareFadeInFromMenu` and `setPostMenuFieldCallback(FieldCallback_X)`. The menu closes with
    CB2_ReturnToField; the field (OverworldScene.openFieldMenu) runs gFieldCallback2 (RunFieldCallback), which
    fades in, sets `gFieldEffectArguments[0]` to the species and calls FieldCallback_X. Teleport/Dig ask first
    (their map names come from headers `prepareFieldMoveMenu` loads before the menu opens). Soft-Boiled stays in
    the menu.
  - `world/fieldMoves.ts`: fldeff_cut/rocksmash/sweetscent/dig/teleport.c and the Teleport / Escape Rope warp
    tasks, on top of `FieldMoveHost` (OverworldScene.createFieldMoveHost: map grid, scripts, wild encounters,
    the GBA layer, warps with a gFieldCallback) and the avatar host (locks, tasks, objects).
    `CreateFieldEffectShowMon(func)` is the shared part: the player's pose, the banner, then `func`.
    LockPlayerFieldControls is a flag here; handing over to a script (ScriptContext_Enable / _SetupScript) or a
    battle releases it, since those hold the field's input themselves.
  - `world/fieldMoveShowMon.ts`: FLDEFF_FIELD_MOVE_SHOW_MON(_INIT), the banner, runs the C on the field's GBA
    layer (FieldGbaScreen, like battle transitions): streaks in BG0, WIN0/WIN1, the mon as a GBA pic sprite.
  - **Adding a field move** (e.g. Fly): write SetUpFieldMove_X / FieldCallback_X / FldEff_UseX
    in your own module, `registerFieldMoveSetUp('FIELD_MOVE_X', SetUpFieldMove_X)` and
    `registerFieldEffectNatives({ FldEff_UseX })` at boot (as `registerFieldMoves` does), and start with
    `CreateFieldEffectShowMon` for the banner. Script-driven moves (EventScript_StrengthBoulder, EventScript_UseSurf,
    EventScript_Waterfall) then work from the field too: until a FldEff_UseX exists, `dofieldeffect
    FLDEFF_USE_X` + `waitstate` just continue. A move in its own module (world/surf.ts, world/strength.ts) is
    registered from `registerFieldMoves`. Fly is special-cased in CursorCB_FieldMove (CB2_OpenFlyMap, see "Fly").
    Escape warp: `UpdateEscapeWarp` (from OverworldScene.takeWarp) / `SetEscapeWarp`, state.escapeWarp.
    `CreateFieldEffectShowMon`, `ScriptContext_Enable` and `ScriptContext_SetupScript` are exported for that.
  - **Strength:** `world/strength.ts` (fldeff_strength.c). From the party menu SetUpFieldMove_Strength needs a
    boulder in front (CheckObjectGraphicsInFrontOfPlayer) and no surfing, and runs EventScript_FldEffStrength;
    talking to a boulder runs EventScript_StrengthBoulder (Rainbow Badge, `checkpartymove`, YES/NO). Both do
    `dofieldeffect FLDEFF_USE_STRENGTH` (FldEff_UseStrength: banner, nickname into STR_VAR_1) and then
    EventScript_UseStrength sets FLAG_SYS_USE_STRENGTH, which TryPushBoulder (world/playerAvatar.ts) checks. The
    flag goes with ClearTempFieldEventData (`GameState.clearTemps`, every map load incl. connections), a white-out
    and Teleport / Dig / Escape Rope. Victory Road's switch scripts use `copyobjectxytoperm`. Test spot: Victory
    Road 2F `?map=VictoryRoad_2F&x=6&y=16`, face down (boulder 1; its switch is at (2, 19)).
  - Extracted: `field_effects/scripts.json`, tileset `terrains` (METATILE_ATTRIBUTE_TERRAIN, `TileInfo.terrain`)
    and map `allowEscaping`. Probes: `field().fieldEffects` lists the scripted active list too; events
    `fieldMoveShowMon` (species, outdoors), `cutGrass`, `sweetScent`, `fieldMoveWarp`, `fieldMoveWarpDone`.
    Tests: tests/e2e/fieldMoves.test.ts (Vermilion's cut tree from (19, 25), Route 1 grass (14, 8), Mt. Ember
    rock (29, 41) with `wild.seed(0)` for an encounter / `seed(1)` for none, Mt. Moon from Route 4 (19, 6) for Dig).
- **Fly:** `world/fly.ts`. SetUpFieldMove_Fly (registered from `registerFieldMoves`) only checks the map type; the
  badge check is CursorCB_FieldMove's, which then closes the party menu into CB2_OpenFlyMap (menus/regionMap.ts,
  in FieldMenuScene). Choosing a visited town calls SetFlyWarpDestination → SetWarpDestinationToHealLocation
  (sMapFlyDestinations' HEAL_LOCATION_*, `FieldMoveHost.healLocation`) and ReturnToFieldFromFlyMapSelect, which
  sets `gFieldCallback.fn = FieldCallback_UseFly`; cancelling goes back to the party menu
  (CB2_ReturnToPartyMenuFromFlyMap). On the field, Task_UseFly runs FLDEFF_FLY_OUT (FldEff_FlyOut: pose, banner,
  the bird leaving its ball, swooping, the player jumping on and flying off, WarpFadeOutScreen), then
  Overworld_ResetStateAfterFly and `FieldMoveHost.warpIntoMap` with FieldCallback_FlyIntoMap → FLDEFF_FLY_IN. The
  bird is a field effect sprite (`createFieldEffectSprite`) in screen coordinates: `BirdSprite` keeps the C's
  struct Sprite fields and runs sprite.c's affine anims, and FieldEffectSprite gained `scaleY` / `rotation` /
  `crop` to draw the matrix and the double-size box. While the bird carries the player, the player's Phaser
  sprite is placed from the bird's position; `ObjectEvent.inanimate` (the C's run-time flag) keeps the
  get-on frame through the jump. Test events `flyOut`, `flyWarp` (map, x, y), `flyIn`, `flyDone`. Tests:
  tests/e2e/fly.test.ts (Pallet Town → Viridian City with FLAG_BADGE03_GET and FLAG_WORLD_MAP_VIRIDIAN_CITY).
- **Surf and Waterfall:** `world/surf.ts`. SetUpFieldMove_Surf / _Waterfall and FieldCallback_* for the party
  menu; GetInteractedWaterScript (the last step of `OverworldScene.interact`: EventScript_UseSurf,
  EventScript_CurrentTooFast, EventScript_Waterfall / CantUseWaterfall); IsPlayerFacingSurfableFishableWater and
  MetatileAtCoordsIsWaterTile (the terrain attribute; the rods will need them too); FldEff_UseSurf
  (Task_FldEffUseSurf: pose, banner, JUMP_SPECIAL onto the water, the blob) and FldEff_UseWaterfall
  (Task_UseWaterfall: banner, WALK_SLOWER north until off MB_WATERFALL), registered as field effect natives.
  The surf blob (field_effect_helpers.c: FldEff_SurfBlob, UpdateSurfBlobFieldEffect, SetSurfBlob_BobState /
  _DontSyncAnim / _PlayerOffset for Fly and the rods) is a FieldEffectSprite made through
  `FieldEffects.createSprite`; `sPlayerSurfBlob` stands for the player's `fieldEffectSpriteId`. In FRLG the blob
  never moves (sBobDirection stays 0): the player rides 1 px lower on its anim's second frame. `SurfHost`
  (`setSurfHost` in OverworldScene.create) gives the terrain and sprite creation; the rest goes through the avatar
  and field move hosts (`LockPlayerFieldControls`, `CreateTask`, `StartPlayerAvatarSummonMonForFieldMoveAnim`,
  `LoadFieldMoveShowMonGfx` are exported from fieldMoves.ts). Probes: `field().surfBlob` (centre, anim, bob
  state, the player's y2), event `partyMenuMessage` (msgId, from DisplayPartyMenuStdMessage). Tests:
  tests/e2e/surf.test.ts (Pallet Town pond from (8, 16) facing down; on the water at (8, 18); Icefall Cave
  entrance: waterfall x 15-19 y 14-20, its foot at (17, 21), pond at (12, 10) for encounters).
- **Interactions:** `OverworldScene.interact` is GetInteractionScript (object → bg event → metatile via
  `METATILE_SCRIPTS` → water); `tryWalkIntoSignpost` runs after a step (before the wild check) and when holding toward the
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
  after every completed step, incl. the first tile after a map connection. Rock Smash, Sweet Scent and fishing
  call in from their field code. `startWildBattle` is
  StartWildBattle + CB2_EndWildBattle as a field overlay (white-out on a loss); `doSafariBattle` is
  DoSafariBattle + CB2_EndSafariBattle. To skip the dice in tests:
  `s.startWildBattle(s.state.pokemon.createMonWithNature(species, level, 32, nature, {...}))` on the Overworld scene.
  `state.currentMapId` is the MAP_* id (`currentMap` is the folder name).
- **Field items (rods, Escape Rope, VS Seeker, Itemfinder):** the bag's half is `menus/itemUse.ts` (FieldUseFunc_Rod,
  ItemUseOutOfBattle_EscapeRope, their ItemUseOnFieldCB_* through gFieldCallback = FieldCB_FadeInFromBlack, like the
  Bicycle). itemUse.ts must stay free of Phaser imports (battle unit tests load it), so the field functions it calls
  (CanFish, StartFishing, CanUseEscapeRopeOnCurrMap, LockPlayerFieldControls, DisplayItemMessageOnField,
  Task_UseDigEscapeRopeOnField, ...) are registered at boot: `registerFieldItems()` (world/fishing.ts) fills
  `registerItemUseFieldFuncs` (which merges: `registerVsSeeker()` and `registerItemfinder()` add their parts;
  `fieldFuncs()` checks one function of each is there).
  `world/fieldItems.ts` is the field host for item uses (OverworldScene.createFieldItemsHost): the field message box
  as window 0 (`openMessageBox` = LoadMessageBoxAndFrameGfx, `printMessage` = AddTextPrinterParameterized(2) at an x
  and speed, `showMessage` + `DisplayItemMessageOnField(str, callback)`), JOY_NEW(A), the object event anim tables
  (`field_effects/objects.json` `objectEventAnims`, sAnimTable_* by the name SpriteInfo.anims gives) and the wild
  encounter calls.
  - **Fishing:** `world/fishing.ts` is StartFishing / Task_Fishing (Fishing1..16, one task object with the C's
    tStep/tFrameCounter/...), AlignFishingAnimationFrames and CanFish. FRLG's Fishing7 jumps straight to "A POKéMON's
    on the hook!" (no "Oh! A bite!", no A-press window, one round of dots; Fishing8/9/13 are ported but
    unreachable). The player's sprite runs the fishing graphics' anims through `SpriteAnim` (sprite.c's anim
    state, split out of FieldEffectSprite in entities/FieldEffects.ts), with x2/y2 put on the Phaser sprite
    (surfing: SetSurfBlob_PlayerOffset). The encounter is `WildEncounters.doesCurrentMapHaveFishingMons` /
    `fishingWildEncounter(rod)` (ChooseWildMonIndex_Fishing is exported for unit tests). The rod is
    `ItemId_GetSecondaryId` (items.json keeps OLD_ROD etc. as names; menus/common.ts resolves them).
  - **Escape Rope:** ItemUseOnFieldCB_EscapeRope prints "{PLAYER} used the ESCAPE ROPE." and then runs Dig's
    Task_UseDigEscapeRopeOnField (world/fieldMoves.ts, exported). The field message box is hidden when a warp
    loads the next map (`loadWarpedMap`: CB2_LoadMap frees the windows).
  - Probes / events: `field().fishing` (`step` = tStep, 5 is Fishing6's bite roll; the anim's `animNum`, `image`,
    `x2`, `y2`), events `fishing` (rod), `fishingBite`, `fishingResult` (`onHook` / `noBite` / `gotAway`),
    `fishingEnd`. Seed the bite roll with `t.seedWhen(() => t.field()?.fishing?.step === 5, seed)` (seed 0: a bite,
    3: none). Tests: tests/e2e/fieldItems.test.ts (Pallet Town's pond from (8, 16) facing down; Mt. Moon from Route
    4 (19, 6) for the rope), tests/unit/fishing.test.ts.
  - **VS Seeker:** `world/vsSeeker.ts` is vs_seeker.c's field side: Task_VsSeeker_0..3 (Task_VsSeeker_0 is the
    ItemUseOnFieldCB; FieldUseFunc_VsSeeker's map check is in itemUse.ts), GatherNearbyTrainerInfo /
    GetVsSeekerResponseInArea (the "!" / "X" / step-in-place + "!!" movement scripts as MovementRunners in field
    tasks, the 30% refusal roll), StartAllRespondantIdleMovements, FLDEFF_USE_VS_SEEKER (UseVsSeekerEffect_1..4 and
    the player's VS Seeker anim through `SpriteAnim`, as fishing; both VS Seeker graphics are preloaded),
    ClearRematchStateByTrainerId (ScriptHost.clearRematchStateByTrainerId, from ScriptEngine.runTrainerBattle at
    every trainer battle's end), ResetMovementOfRematchableTrainers (after `mapResetTrainerRematches` on map load)
    and EventScript_VsSeekerChargingDone's specials (registered with `registerSpecials`: script/specials.ts is
    reached from the battle unit tests, so it can't import Phaser-side modules). `world/rematches.ts` is the
    Phaser-free part: the sRematches lookups (GetRematchTrainerId, GetNextAvailableRematchTrainer, the
    ShouldTryRematchBattle / IsTrainerReadyForRematch specials ScriptEngine.trainerSpecial calls),
    GetRunningBehaviorFromGraphicsId. A rematch: the VS Seeker sets `state.trainerRematches[localId]` (the party's
    index in the row); talking to the trainer goes trainerbattle → post-battle script → ShouldTryRematchBattle →
    `trainerbattle_rematch` (GetRematchTrainerId) → IsTrainerReadyForRematch → StartRematchBattle; winning clears
    it (ClearRematchStateOfLastTalked). Trainer sight ignores rematches (CheckTrainer skips beaten trainers), as on
    the GBA. The charge: 100 steps with it in the bag (low byte of `trainerRematchStepCounter`), reset by a use that
    finds a rematch; then 100 charging steps (high byte) end every rematch (world/stepCounters.ts).
    The raise-hand movement types (MOVEMENT_TYPE_RAISE_HAND_AND_STOP / _JUMP / _SWIM and their actions) are in
    `entities/NpcBrain.ts` (frame 9 = ANIM_RAISE_HAND, x2/y2 on the Phaser sprite; `singleMovementActive` while in
    the air). Probes / events: `field().vsSeeker` (`func` 0..3 = Task_VsSeeker_0..3, the player's `animNum` /
    `image`), `__test.objects()` now has each object's `facing`, `movementType`, `frame`, `x2`, `y2`; events
    `vsSeeker` (`result`: notCharged / noOneInRange / canUse), `vsSeekerResponse` (noResponse / unfoughtTrainers /
    foundRematches), `vsSeekerEnd`. Seed the refusal roll at the start of the tick it runs:
    `t.seedWhen(() => f.vsSeeker?.func === 2 && !f.fieldEffects.includes('FLDEFF_USE_VS_SEEKER'), seed)` (the
    first roll is the first beaten trainer in range's; seed 1 → 38, a rematch). Tests: tests/e2e/vsSeeker.test.ts
    (Route 3's Ben from (16, 6); Pallet Town for the messages), tests/unit/rematches.test.ts.
  - **Itemfinder:** `world/itemfinder.ts` is itemfinder.c's field side: ItemUseOnFieldCB_Itemfinder (the
    ItemUseOnFieldCB ItemUseOutOfBattle_Itemfinder sets; registered with `registerItemfinder()`), the response /
    underfoot tasks (a ding every 25 frames: 4 within 3 tiles along the longer axis, else 2; 3 for an underfoot
    item), their messages and clean-ups, and EventScript_ItemfinderDigUpUnderfootItem for an underfoot item. The
    search is `world/itemfinderSearch.ts` (no Phaser): HiddenItemIsWithinRangeOfPlayer over gMapHeader's hidden
    items within 7 across / 5 up and down, FindHiddenItemsInConnectedMaps with fieldmap.c's GetMapConnectionAtPos
    in the C's MAP_OFFSET coordinates, RegisterHiddenItemRelativeCoordsIfCloser's tie-breaks and
    GetPlayerDirectionTowardsHiddenItem (whose DIR_* names don't match where the arrows go: see its comment). The
    host (OverworldScene: `setItemfinderHost`) gives the current map's data and the loaded neighbours' headers
    (`world.loaded`). FRLG's Itemfinder doesn't turn the player. The arrows and stars are screen-fixed
    FieldEffectSprites at the camera's corner plus (120, 76), run by the item's own field task (task func, then
    each sprite's callback and anim, like RunTasks + AnimateSprites), rotated by sAffineAnim_Left/Down/Right/Up;
    their tiles (`sArrowAndStarSpriteTiles`, extract_gfx's `graphics/itemfinder/`) are drawn in
    gObjectEventPal_Player (OBJ palette 0 in the field). Probes / events: `field().itemfinder` (`running`, each
    sprite's screen `x` / `y`, `anim` 0-3 arrows / 4 star, `affineAnim` 0 left 1 down 2 right 3 up), events
    `itemfinder` (`result`: none / response / underfoot, `itemX`, `itemY`, `dings`, `direction`),
    `itemfinderArrow` (`anim`, `affineAnim`, `deltaX`, `deltaY`), `itemfinderStar`, `itemfinderEnd`. Tests:
    tests/e2e/itemfinder.test.ts (Route 3's Oran Berry (26, 9) from (24, 9); Cape Brink's underfoot PP Max at
    (16, 28); Pallet Town for none; Route 13 (62, 1) for Route 12's Rare Candy), tests/unit/itemfinder.test.ts.
  - **Registered items (SELECT):** `menus/registeredItem.ts` is UseRegisteredKeyItemOnField (item_menu.c),
    called from `OverworldScene.processPlayerFieldInput` when FieldGetPlayerInput saw SELECT (after START, as in
    ProcessPlayerFieldInput). It dismisses the map name popup, takes LockPlayerFieldControls (fieldMoves.ts' flag
    version, which the field items' own Unlock calls release), FreezeObjectEvents, stops the player, and runs the
    item's `FIELD_USE_FUNCS` entry as a GBA task with `data[3] = 1` (stepped by a field task: the field doesn't run
    RunTasks). Nothing registered, or the item gone from the bag (the registration is cleared):
    EventScript_BagItemCanBeRegistered. The from-the-field branches are in menus/itemUse.ts: SetUpItemUseOnFieldCallback
    calls sItemUseOnFieldCB at once; DisplayItemMessageInCurrentContext / PrintNotTheTimeToUseThat go to
    `DisplayItemMessageOnField(taskId, fontId, str, callback)` (the task waits in Task_ContinueTaskAfterMessagePrints
    while world/fieldItems.ts prints, then the callback becomes its func) and Task_ItemUse_CloseMessageBoxAndReturnToField
    (clears the box, unfreezes, unlocks). An sItemUseOnFieldCB gets TASK_NONE after the bag (there's no task),
    so it destroys its task through `DestroyItemUseTask`. To add an item's field branch: check `inField(taskId)` in its
    FieldUseFunc and end in something that unfreezes and unlocks. The Town Map / TM case / berry pouch branches
    (`RegisteredItemFromFieldNotPorted`) log and give the controls back. Script `release` / `releaseall` now also
    unfreeze objects (ClearPlayerHeldMovementAndUnfreezeObjectEvents), and a map load or a battle's return clears the
    freeze. Probes: `field().locked` (LockPlayerFieldControls held), `field().objectsFrozen`, `__test.gbaTasks()`
    (active gTasks by function name, e.g. `Task_BagMenu_HandleInput`, `Task_FieldItemContextMenuHandleInput`),
    `__test.gbaFading()`. Tests: tests/e2e/registeredItems.test.ts (registering the Bicycle in the bag and SELECT on /
    off, Cycling Road, the Old Rod, the Coin Case, the VS Seeker / Itemfinder / Poké Flute messages, nothing
    registered; Pallet Town's pond at (8, 16), (12, 13) for no trainers or hidden items).
- **Scripted battles:** specials that start a battle (StartOldManTutorialBattle, StartMarowakBattle,
  StartLegendaryBattle in `script/specials.ts`) call `host.startScriptedBattle(flags, enemyParty, transition)` and
  block the script with `setWaitState` until the field has faded back in (their CB2_End* sets VAR_RESULT; a loss
  calls `endScript()` + `host.whiteOut()`). `setwildbattle` leaves gEnemyParty in `state.enemyParty`;
  `host.wildBattleTransition(mon)` is GetWildBattleTransition. `dowildbattle` (StartScriptedWildBattle) and
  StartLegendaryBattle share `runScriptedWildBattle` (CB2_EndScriptedWildBattle): `returnToField` runs the map's
  ON_RESUME script while FLAG_SYS_SPECIAL_WILD_BATTLE is still set (that's how Snorlax and caught legendaries
  disappear: `removeobject VAR_LAST_TALKED`), then the script reads `specialvar GetBattleOutcome`
  (`state.battleOutcome`). `seteventmon` expands to `special CreateEnemyEventMon` (Navel Rock's Lugia and Ho-Oh,
  Birth Island's Deoxys), which leaves its mon in `state.enemyParty` like `setwildbattle`. Every battle start (OverworldScene.runBattle) does Task_BattleStart's
  RestartWildEncounterImmunitySteps. Tests: tests/e2e/pokemonTower.test.ts (walk onto the 6F trigger at 11,15),
  tests/e2e/scriptedBattles.test.ts (Snorlax from Route 12 (14, 69) facing down with FLAG_GOT_POKE_FLUTE, Route
  16 (30, 13) facing right; Zapdos from Power Plant (5, 12) and Mewtwo from Cerulean Cave B1F (7, 13), facing up).
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
- **TM case:** `menus/tmCase.ts` is tm_case.c. `InitTMCase(type, exitCallback, allowSelectClose)` runs on whichever
  GBA host has the bag (FieldMenuScene); `menuGfxSymbols` preloads `TM_CASE_GFX`. Ways in: the bag's KEY ITEMS → TM
  CASE → OPEN (`FieldUseFunc_TmCase` in menus/itemUse.ts → TMCASE_FIELD, back to CB2_BagMenuFromStartMenu), the
  bag's GIVE from the party menu / PC box (`GoToTMCase_Give` / `GoToTMCase_PCBox`) and the Poké Mart's SELL
  (`GoToTMCase_Sell`), all in menus/itemMenu.ts. USE sets ItemUseCB_TMHM and opens CB2_ShowPartyMenuForItemUse,
  whose exit callback for the TM case pocket is CB2_ReturnToTMCaseMenu (TMCASE_REOPENING: same type, list position
  and exit callback). `SortPocketAndPlaceHMsFirst` / `SortAndCompactBagPocket` (item.c) live there too. Probe
  `__test.tmCase()` (TMCASE_* type, the screen task's name, `fading`, scroll/row, the pocket's item ids in list
  order). Tests: tests/e2e/tmCase.test.ts.
- **Berry pouch:** `menus/berryPouch.ts` is berry_pouch.c, built like the TM case (static vs per-open resources,
  `rebuildList` after a toss / sale). `InitBerryPouch(type, savedCallback, allowSelect)` runs on whichever GBA host
  has the bag: FieldMenuScene, or BattleScene for the battle bag (`menuGfxSymbols` preloads `BERRY_POUCH_GFX` for
  both). Ways in: the bag's KEY ITEMS → BERRY POUCH → OPEN (`FieldUseFunc_BerryPouch` → BERRYPOUCH_FROMFIELD), the
  battle bag's OPEN (`BattleUseFunc_BerryPouch` → BERRYPOUCH_FROMBATTLE, back to CB2_BagMenuFromBattle), the bag's
  GIVE from the party menu / PC box and the Poké Mart's SELL (`GoToBerryPouch_Give` / `_PCBox` / `_Sell` in
  menus/itemMenu.ts). USE runs the berry's own item_use.c function with the pouch's task (looked up in
  `FIELD_USE_FUNCS` / `BATTLE_USE_FUNCS`); item_use.c checks `GetPocketByItemId(...) == POCKET_BERRY_POUCH` to hand
  back through `BerryPouch_SetExitCallback` + `BerryPouch_StartFadeToExitCallback` (SetUpItemUseCallback,
  ItemUse_SwitchToPartyMenuInBattle) or `DisplayItemMessageInBerryPouch` (FieldUseFunc_OakStopsYou). The party
  menu comes back through CB2_ReturnToBerryPouchMenu (BERRYPOUCH_NA: same type, list position and callback).
  Item icons: `CreateBerryPouchItemIcon` (menus/itemMenuIcons.ts). Probe `__test.berryPouch()` (BERRYPOUCH_* type,
  the screen task's name, `fading`, scroll/row, the pocket's berries in list order). Tests:
  tests/e2e/berryPouch.test.ts.
- **Naming screen:** `DoNamingScreen` (`menus/namingScreen.ts`) runs on any GBA host. From a script, use
  `ScriptHost.doNamingScreen` (FieldMenuScene `naming`). Oak's speech calls it with NAMING_SCREEN_PLAYER
  (monSpecies = the player's gender) and NAMING_SCREEN_RIVAL on MainMenuScene, preloading `namingScreenGfxSymbols`
  after `setObjectEventGraphicsInfo` (the icons are object event graphics) and `loadMenusData` (the keyboard).
- **Boot, title screen and soft reset:** `BootScene` loads the extracted data and starts `MainMenuScene` on the
  title screen (`entry: 'title'`). MainMenuScene is one GbaHostScene for the boot screens, which hand over through
  gMain like the C: `menus/titleScreen.ts` (title_screen.c: CB2_InitTitleScreen, the intro scenes, the run scene
  with PRESS START / flames / the slash, the 2700-frame restart; A/START → the cry scene → `titleScreenEnv.
  loadGameSave` (LoadGameSave) → CB2_InitMainMenu), `menus/clearSaveDataScreen.ts` (B+SELECT+UP on the title
  screen) and `menus/mainMenu.ts` (B goes back to CB2_InitTitleScreen). Dev starts (`?start=`, `?map=`) go
  straight to the field; dev `?skipIntro` boots like the port did before the title screen: MainMenuScene with
  `entry: 'mainMenu'` (and `skipOakSpeech`: NEW GAME goes straight to the field) when the slot holds something,
  else the new game. **Restarting the game** (DoSoftReset, e.g.
  after the credits): `softReset(scene)` from scenes/BootScene.ts stops every scene and starts BootScene again with
  `{ softReset: true }`, which ignores the URL's dev starts and shows the title screen (with `?skipIntro`: the main
  menu / new game). From a GbaHostScene, `stopHost()` and clear gMain's callbacks first (see MainMenuScene's
  clear save data env). The extracted data stays loaded. Phaser reuses a stopped scene's instance with its fields,
  so `softReset` also replaces the Overworld scene with a new instance (a clean GameState and field state).
  Probes: `t.titleScreen()` (scene INIT/FLASHSPRITE/FADEIN/RUN/RESTART/CRY, state, timer, pressStartShown,
  flames), `t.clearSaveData()`; events `titleScreen` (CB2_InitTitleScreen) and `mainMenu` (CB2_InitMainMenu).
  Tests: tests/e2e/titleScreen.test.ts (harness option `title: true`).
- **Oak's speech (NEW GAME):** `menus/oakSpeech.ts` is oak_speech.c: StartNewGameScene, the controls guide, the
  Pikachu intro, Oak with Nidoran♀ (`CreatePokeballSpriteToReleaseMon` / `CreateTradePokeballSprite`, now in
  battle/gfx.ts's pokeball.c section), BOY / GIRL, the names (the naming screen, or the rival presets), "Let's go!"
  and the shrink (BG2 is an affine BG in bg mode 1: `SetBgAffine`). MainMenuScene runs it when the main menu's NEW
  GAME calls `startNewGame` (`startOakSpeech`): it builds a GameState for gSaveBlock1/2, gives it to the battle env
  (StringExpandPlaceholders, mon pics and ball anims read it there) plus a no-op BattleUi, preloads
  `oakSpeechGfxSymbols()` and the naming screen, and fills `oakSpeechEnv`. CB2_NewGame starts the overworld with
  `newGameProfile` (names and gender; OverworldStart), applied to its fresh GameState before the map loads.
  Charmap.decodePlain turns the naming screen's bytes into GameState's name strings. Helpers it brought:
  `gba/topBarWindow.ts` (menu.c's top bar, also the Hall of Fame's), `gba/textCursor.ts` (text.c's
  CreateTextCursorSprite). Probe: `t.oakSpeech()` (the main task's function name, page, `menu` 'gender' | 'names' |
  'yesNo', fading, gMain.state, gender and names so far); event `oakSpeech`. Tests: tests/e2e/titleScreen.test.ts
  (`title: true`; `?skipIntro`, the harness default, skips the speech).
- **PC storage screens:** the PC's "Someone's/BILL's PC" runs `special ShowPokemonStorageSystemPC`: the storage menu
  (WITHDRAW / DEPOSIT / MOVE POKéMON / MOVE ITEMS / SEE YA!, Task_PCMainMenu) is a field overlay,
  `ui/StoragePcMenu.ts`, through `OverworldScene.openPokemonStoragePc`. An option fades out and runs the box screen
  in FieldMenuScene (`menu: 'storage', storageOption`), which preloads every party and boxed mon's pic, palettes
  and icon plus held/bag item icons (`pokemonStorageGfxSymbols`): the screen draws them synchronously. The box
  screen is one module per C file: `menus/pokemonStorage.ts` (tasks.c: gStorage, EnterPokeStorage /
  CB2_ReturnToPokeStorage, every Task_*, the display mon, party box, close-box button, messages),
  `pokemonStorageCursor.ts` (data.c: the hand cursor, input per cursor area, picking up / placing / shifting,
  release checks, SetDisplayMonData, the action menus), `pokemonStorageGraphics.ts` (graphics.c: mon icons in the
  shared 40-slot icon tile area, wallpapers on BG2, box titles, scroll arrows), `pokemonStorageMenu.ts` (menu.c's
  box-choosing popup and text-to-sprite helpers), `pokemonStorageMisc.ts` (misc.c: moving several mons through an
  8bpp window on BG0, MOVE ITEMS' item icons and info window), plus `tilemapUtil.ts` and `pcScreenEffect.ts`.
  Like the C, the screen keeps empty party slots while it runs: it works on its own six-slot `gPlayerParty`,
  loaded in Task_InitPokeStorage and written back (compacted) to `state.party` whenever it hands over to another
  screen (FreePokeStorageData). It leaves for the summary screen (`ShowPokemonSummaryScreen` with a box's slots in
  PSS_MODE_BOX), the naming screen (NAMING_SCREEN_BOX) and the bag (ITEMMENULOCATION_PCBOX, whose
  Task_ItemContext_PcBoxGive sets VAR_ITEM_ID) and comes back through CB2_ReturnToPokeStorage; leaving the boxes
  (CB2_ExitPokeStorage) returns to the field, which reopens the storage menu on the option just used
  (FieldTask_ReturnToPcMenu). The PC's "PLAYER's PC" (`special PlayerPC`, and `BedroomPC` at home) is
  `ui/PlayerPcMenu.ts`: ITEM STORAGE (WITHDRAW ITEM = `menus/itemPc.ts`, item_pc.c, FieldMenuScene 'itemPc';
  DEPOSIT ITEM = the bag at ITEMMENULOCATION_ITEMPC, 'itemPcDeposit'), MAILBOX (always empty) and TURN OFF;
  `state/pcItems.ts` is item.c's PC item functions. Specials that hand the script over use
  `SpecialEnv.setupScript` (ScriptContext_SetupScript). Probes: `__test.pcStorage()` (task, state, cursor, box,
  displayed species, bottom message, menu items, the popup's box) and `__test.itemPc()`. Tests:
  tests/e2e/pcStorage.test.ts (Viridian Pokémon Center, the PC above (11, 2)).
- **Region map:** `menus/regionMap.ts` is region_map.c (GetMapName stays in `world/regionMap.ts`): the Town Map
  from the bag (FieldUseFunc_TownMap → InitRegionMapWithExitCB(REGIONMAP_TYPE_NORMAL, CB2_BagMenuFromStartMenu):
  the map edges' open/close animation, the Kanto / Sevii switch menu once FLAG_SYS_SEVII_MAP_123 is set, the dungeon
  previews with map_preview_screen.c's graphics), the wall maps (`special ShowTownMap`, REGIONMAP_TYPE_WALL,
  FieldMenuScene 'townMap' through `ScriptHost.showTownMap`) and the fly map (CB2_OpenFlyMap, REGIONMAP_TYPE_FLY:
  fly icons on visited towns). Towns count as visited by their FLAG_WORLD_MAP_* flags (`setworldmapflag` in the
  maps' scripts). What the C reads from the overworld (gMapHeader, the location, pos, escape / dynamic warps and
  their headers) is handed over with `setRegionMapField`, which `prepareFieldMoveMenu` / `prepareRegionMap`
  (world/fieldMoves.ts) fill before the party menu, the bag or a wall map opens. Tables: menus.json `regionMap`
  (tools/extract_menus.py: layouts, section corners/sizes, sSeviiMapsecs, sMapFlyDestinations, sDungeonInfo,
  sMapPreviewScreenData, MAP_NUMs); graphics: graphics/region_map/ and graphics/map_preview/
  (`regionMapGfxSymbols`, preloaded by FieldMenuScene). The screen re-copies its tilemaps at VBlank (see
  DEVIATIONS: the port's DMA is immediate). Probe `__test.regionMap()` (type, task, `ready`, cursor, `moving`,
  player icon, section and its MAPSECTYPE_*, fly icons, map name, top bar text). Tests: tests/e2e/fly.test.ts.
- **Pokédex area markers:** `menus/wildPokemonArea.ts` is wild_pokemon_area.c (GetSpeciesPokedexAreaMarkers:
  every gWildMonHeaders table holding the species → its map's mapsec → sDexAreas_Kanto / the unlocked
  sDexAreas_Sevii* → DEX_AREA_* markers; Altering Cave by VAR_ALTERING_CAVE_WILD_SET; the roamer paired with the
  starter at its current map). It reads wild_encounters.json through `initWildPokemonArea` (OverworldScene, next to
  initRoamerTables) and menus.json `pokedexArea` (tools/extract_menus.py `pokedex_area_data`: the dex area tables,
  sRoamerPairs, sAreaMarkers, sSubsprites, every map's mapsec, `firstMap` for the roamer's unset location).
  `menus/pokedexArea.ts` is pokedex_area_markers.c: CreatePokedexAreaMarkers(species, tilesTag, palIdx, y) makes
  one OBJ-window sprite at (104, y + 32) whose subsprites are the markers, fills BG1 with tile 0x00F from char
  base 0 and sets the window/blend registers (BG1 blended 12/8 inside the markers); the sprite shows on the
  task's first run; DestroyPokedexAreaMarkers puts BG1 (char base 2) and the registers back. Preload
  `pokedexAreaMarkerGfxSymbols` (sMarkerTiles, sMarkerPal). GetUnlockedSeviiAreas (field_specials.c) is in
  `world/regionMap.ts` (importable in Node, unlike menus/regionMap.ts). The area page is in `menus/pokedexArea.ts`
  too: DexScreen_DrawMonAreaPage (A on the mon page; Task_DexScreen_ShowMonPage states 7-12 run it) draws the
  frame (BG3, and BG0 round the size box), the Kanto map and each unlocked island as BG2 windows whose pixel buffers
  get the sTilemap_AreaMap_* 4bpp tiles (Kanto moves up 4 tiles, kantoMapVoff 0, once any of islands 4-7 is
  unlocked), the icon / number and name / types (caught only) / "SIZE" / "AREA" windows, the size comparison (the
  mon's pic and the player's front pic as pic sprites in OBJ palette 2, sPalette_Silhouette, with affine matrices 2
  and 1 scaled by gPokedexEntries' pokemonScale / trainerScale and y2 = the offsets; caught only), the markers
  (OBJ palette 3, tag 2001) and "AREA UNKNOWN" over the sBlitTiles_WideEllipse when there are none.
  DexScreen_DestroyAreaScreenResources undoes it. It leaves BG1 to the markers (DestroyPokedexAreaMarkers puts it
  back for the mon page's flavour text). W-dex unit 3's category pages call the same two functions. Graphics:
  `pokedexAreaGfxSymbols()` (in `pokedexScreenGfxSymbols()`, with the player's front pic by gender) and the mon's
  icon in `dexMonGfxSymbols` (DexScreen_LoadMonGfx). list_menu.c's ListMenu_LoadMonIconPalette /
  ListMenu_DrawMonIconGraphics are in `gba/listMenu.ts`. Probe: `__test.pokedexArea()` (species, `ready` = state 9,
  kantoMapVoff, islands, markers and their sprite, areaUnknown, the blitted types, icon / type pixels, the
  silhouettes' OAM and matrix scale). Tests: tests/unit/pokedexArea.test.ts (the marker lists, and the sprite's OAM
  in Node), tests/e2e/pokedexArea.test.ts (the page from the Pokédex).
- **Hall of Fame and credits:** the room's script (PokemonLeague_HallOfFame_EventScript_EnterRoom) runs
  `dofieldeffect FLDEFF_HALL_OF_FAME_RECORD` (`world/hallOfFameRecord.ts`: the machine's Poké Balls and monitor,
  CreateGlowingPokeballsEffect's states, drawn as FieldEffectSprites from the GBA pics at screen coordinates; the
  same glow would serve FLDEFF_POKECENTER_HEAL) and `special EnterHallOfFame` → `OverworldScene.enterHallOfFame`:
  post_battle_event_funcs.c's set-up (`EnterHallOfFame` in `menus/hallOfFame.ts`), `storeLocationForSave`, then
  FieldMenuScene 'hallOfFame' runs CB2_DoHallOfFameScreen. `hofEnv` is what the screen needs from its host: saving
  (TrySavingData(SAVE_HALL_OF_FAME)), DoWarp (FieldMenuStart.onExit's `warp`: the field loads Indigo Plateau with
  `warpFromScreen` instead of returning to the Hall of Fame room) and ReturnFromHallOfFamePC. `special
  HallOfFamePCBeginFade` (`OverworldScene.openHallOfFamePc`) runs CB2_InitHofPC in FieldMenuScene 'hallOfFamePc'
  and comes back through ReshowPCMenuAfterHallOfFamePC (the PC menu again, its choice in VAR_RESULT). Both screens
  preload the pics they show (`hallOfFameGfxSymbols`). `menus/picSprites.ts` now has the trainer half
  (CreateTrainerPicSprite); menu.c's top bar window is `gba/topBarWindow.ts` (shared with Oak's speech). The records are
  `state/hallOfFame.ts` (see "PC boxes and save data"). Indigo Plateau's script (IndigoPlateau_Exterior_EventScript_
  Credits, with `special SpawnCameraObject` / `RemoveCameraObject`) ends in `special DoCredits` →
  `OverworldScene.doCredits`: the credits (`menus/credits.ts`) run on the field's GBA layer, called once per tick
  from a field overlay (CB2_Credits) before `FieldGbaScreen.frame`. `creditsEnv.loadMap` puts each credits map on the
  layer (`world.load`, then `FieldGbaScreen.reloadField`, which reloads the BGs, tilesets and palettes but keeps
  tasks, sprites and OBJ palettes), the credits camera (`creditsCamera`) pans it, and the Pokémon / THE END scenes
  use `startBare` (the PPU draws affine BG2 in modes 1 and 2 for the circle). The credits end in BootScene's
  `softReset` (see "Boot, title screen and soft reset"), which boots to the title screen. Probes: `__test.hallOfFame()` (task, data), `__test.credits()`; dev hook
  `__test.creditsSkipToClosing()` jumps the credits to the copyright. Events: hallOfFameSaved (status),
  hallOfFameMon, hallOfFameWelcome, hallOfFamePlayerInfo, hallOfFameExit, hallOfFamePcMon (team, page, slot,
  species), hallOfFamePcCorrupted, hallOfFamePcExit, creditsStart, creditsMap, creditsPrint (title), creditsMon,
  creditsTheEnd, creditsEnd. Tests: tests/e2e/hallOfFame.test.ts (the room's entrance
  `?map=PokemonLeague_HallOfFame&x=5&y=12`; the Viridian PC for the Hall of Fame PC, records written straight
  into localStorage). To grab a GBA-layer frame at an exact tick, read the canvas inside a `t.until` predicate
  (and keep the predicate idempotent: `until` calls it once more after it resolves).
- **Pokédex screen:** `menus/pokedexScreen.ts` is pokedex_screen.c; `menus/pokedex.ts` is pokedex.c plus the data
  (`loadPokedexData` → `pokedexData`: gPokedexEntries' strings, sizes and scales by national number, the four
  orders, gDexCategories' pages, gMonFootprintTable's symbols; public/gen/pokedex.json from
  tools/extract_pokedex.py), NationalPokedexNumToSpecies and DexScreen_GetSetPokedexFlag (on GameState's
  `dexSeen` / `dexCaught`). START → POKéDEX (StartMenuPokedexSanityCheck: nothing until a mon's been seen) fades
  out and runs CB2_OpenPokedexFromStartMenu in FieldMenuScene 'pokedex' (which loads the data and
  `pokedexScreenGfxSymbols()`, and sets the field's DISPCNT the screen inherits); CB2_ClosePokedex returns through
  CB2_ReturnToFieldWithOpenMenu. Graphics: graphics/pokedex/ by symbol (sKantoDexTiles, sTopMenuIconTiles_*, ...),
  the footprints as 1bpp `gMonFootprint_*` symbols (32 bytes, bit 0 = leftmost pixel). Structure: struct
  PokedexScreenData is `sPokedexScreenData` (null while the screen is down); one task whose func is swapped like
  the C's (`gTasks[taskId].func = Task_DexScreen_X; d.state = 0`), each a `switch (d.state)`. Ported: DexScreen_
  LoadResources, Task_PokedexScreen (top menu, the selection icons, the counts), Task_DexScreen_NumericalOrder
  (Kanto; national with the National Dex), Task_DexScreen_CharacteristicOrder (the SEARCH entries: A TO Z, TYPE,
  LIGHTEST, SMALLEST), Task_DexScreen_ShowMonPage (the mon page from the numerical lists: DexScreen_DrawMonDexPage
  / RemoveDexPageWindows, DexScreen_DexPageZoomEffectFrame, up/down through the seen mons with
  DexScreen_TryScrollMonsVertical, which moves the order's saved list cursor so B lands on that mon), the
  ordered-list helpers and printers, Task_DexScreen_CategorySubmenu (the habitat pages, from the top menu's
  habitats with parentOfCategoryMenu = 0 and from A on a search list with 1, after DexScreen_LookUpCategoryBySpecies
  picked the page and slot; the unlock rules DexScreen_IsPageUnlocked / IsCategoryUnlocked /
  CreateCategoryPageSpeciesList / GetPageLimitsForCategory / PageNumberToRenderablePages; left / right move the
  cursor and flip to the next unlocked page at the edges (or leave the habitat past the first / last), L / R flip
  with BUTTON MODE LR (DexScreen_InputHandler_GetShoulderInput); the page turn is DexScreen_FlipCategoryPageInDirection
  over a copy of BG1-3's tilemaps; A zooms into the mon page (states 14-20), whose A opens the area page (states
  21-26)), and registering a catch: the battle's Cmd_displaydexinfo (battle/bsCommands4.ts) fades to white and calls
  `DexScreen_RegisterMonToPokedex(species)`, which runs DexScreen_LoadResources inside the battle (callback2 stays
  BattleMainCB2, which runs the task) with Task_DexScreen_RegisterMonToPokedex: the habitat page with the mon
  selected for 30 frames, its page zooming in with "A NEXT", A / B → DoClosePokedex; the command then clears VRAM,
  redraws the battle BGs and the mon's pic (CreateMonPicSprite_HandleDeoxys) and fades in to the nickname prompt. A
  non-Kanto mon before the National Dex only gets a task that ends at once (the battle still redraws). BattleScene
  preloads the data and `dexRegisterGfxSymbols(species)` for a wild battle's uncaught species. The page cursor is
  list_menu.c's red outline cursor object (`ListMenuAddCursorObjectInternal` / `ListMenuUpdateCursorObject` /
  `ListMenuRemoveCursorObject` in gba/listMenu.ts, menu_indicators.c's red outline and red arrow; list menus with
  cursorKind 2 / 3 use them too), its colour pulsed by DexScreen_CreateCategoryPageSelectionCursor. Mon graphics: the
  screen can show any seen mon, so `DexScreen_LoadMonGfx(species)` fetches its front pic, palettes and footprint on
  demand (it returns true once loaded; a task waits in its state until then; `dexMonGfxSymbols` lists them); the
  habitat pages wait on all of a page's mons (`DexScreen_LoadCategoryPageGfx`) before drawing or flipping to it.
  The area page: A on the mon page (ShowMonPage states 7-12, CategorySubmenu states 21-26) calls
  DexScreen_DrawMonAreaPage / DexScreen_DestroyAreaScreenResources from menus/pokedexArea.ts (see "Pokédex area
  markers"). list_menu.c's ListMenuInitInRect and window.c's
  PutWindowRectTilemapOverridePalette came with it. Probe: `__test.pokedex()` (task, state, `ready`, the counts,
  unlocked categories, the top menu's and the ordered list's cursor, selected entry and every row's species,
  `categoryPage` (category, page, unlocked page range, shown species, cursor slot, pic pixel counts), the mon page's
  species, printed strings and pic / footprint pixel counts; it also works in battle while the registered page is
  up). Tests: tests/e2e/pokedex.test.ts (Pallet Town with FLAG_SYS_POKEDEX_GET and the dex sets written through
  `t.state`; the registered page from a Master Ball catch on Route 1), tests/unit/pokedex.test.ts.
- **Option menu:** `menus/optionMenu.ts` is option_menu.c. START → OPTION fades out (OverworldScene
  `openFieldMenu('options')`) and runs CB2_OptionsMenuFromStartMenu in FieldMenuScene 'options' (which preloads
  `optionMenuGfxSymbols()`: sOptionMenuPalette, the std frame, every user frame, and sets the black backdrop);
  CloseAndSaveOptionMenu writes the settings to GameState and returns through gMain.savedCallback =
  CB2_ReturnToFieldWithOpenMenu (the start menu reopens on OPTION). The settings live in GameState: `textSpeed`
  ('slow' / 'mid' / 'fast' = OPTIONS_TEXT_SPEED_*), `battleSceneOff`, `battleStyleSet`, `optionsSound` (stored and
  saved only, since save version 3), `optionsButtonMode`, `optionsWindowFrameType` (0-9 = TYPE 1-10). Who reads
  them: the field message box and GBA text (text speed), the battle (scene, style, `battle/battleBg.ts`'s user frame),
  GbaHostScene's ReadKeys (L=A) and the GBA list menus (LR), the start menu (HELP: its help window), and every field
  window drawn with a user frame: `MenuWindow` defaults to the options' frame through `setUserFrameTypeSource`
  (OverworldScene sets it), multichoices / list menus / the shop pass it themselves; GBA screens get it through
  `menuEnv.windowFrameType` (`configureMenuEnv`, each FieldMenuScene start). Probe: `t.optionMenu()` (loadState: 2
  takes input, cursorPos, option[] by MENUITEM_*). Tests: tests/e2e/options.test.ts.
- **Start menu help window:** `ui/HelpMessageWindow.ts` is help_message.c (CreateHelpMessageWindow,
  DrawHelpMessageWindowTilesById, PrintTextOnHelpMessageWindow, DestroyHelpMessageWindow) plus new_menu_helpers.c's
  DrawHelpMessageWindowWithText, as a Phaser window like the start menu (one at a time, sHelpMessageWindowId; the
  graphics `helpMessageWindowGfxSymbols` are preloaded by the field). Text drawn on it uses TEXT_COLOR_TRANSPARENT as
  background, which `TextWindow.drawGlyph` now leaves alone like GLYPH_COPY. `ui/StartMenu.ts` draws the item's
  sStartMenuDescPointers text on open (DoDrawStartMenu case 5) and on cursor moves (StartCB_HandleInput) and
  destroys it with the menu, only when `optionsButtonMode == OPTIONS_BUTTON_MODE_HELP` (no link play or union room,
  so those checks always pass). Probe: `t.helpMessage()` (decoded, undefined when it's down).
- **Trainer card:** `menus/trainerCard.ts` is trainer_card.c, CARD_TYPE_FRLG for the player only (the Hoenn and link
  cards wait for link play). START → PLAYER (StartMenuPlayerCallback) fades out and runs ShowPlayerTrainerCard in
  FieldMenuScene 'trainerCard' (which preloads `trainerCardGfxSymbols(gender)`: graphics/trainer_card/ by symbol plus
  the player's front pic); B fades out and CloseTrainerCard hands over to CB2_ReturnToFieldWithOpenMenu. Structure as
  in the C: `sTrainerCardDataPtr` (struct TrainerCardData, null while the card is down), CB2_InitTrainerCard's
  gMain.state steps (LoadCardGfx / SetTrainerCardBgsAndPals copy the extracted tilemaps, tiles and palettes into the
  struct's buffers and VRAM), one task (Task_TrainerCard, `mainState`; STATE_HANDLE_INPUT_FRONT = 10). The card data
  comes from TrainerCard_GenerateCardForLinkPlayer, as ShowPlayerTrainerCard does: its FRLG stars (Hall of Fame,
  HasAllKantoMons, HasAllMons, the berry picking / Pokémon Jump records, always 0) pick the card palette
  (sKantoTrainerCardPals) and the star tiles; GetTrainerStarCount is unused in the game too. The front: the prints
  (name, ID, money, Pokédex once FLAG_SYS_POKEDEX_GET is set, the live play time with BlinkTimeColon's colon, from
  the VBlank callback), the badges (FLAG_BADGE01-08_GET) on BG3, the player's pic drawn into window 2
  (`CreateTrainerCardTrainerPicSprite` in menus/picSprites.ts, which also has PlayerGenderToFrontTrainerPicId now).
  Not yet (W-tcard unit 2): the back (PrintAllOnCardBack, BufferTextForCardBack, DrawCardBackStats, the stickers'
  and mon icons' tiles: LoadMonIconGfx is a stub, LoadStickerGfx is ported) and the flip (A on the front does
  nothing; the flip's HBlankCB_TrainerCard sets BG0VOFS per scanline, and the port doesn't run HBlank callbacks:
  scanline effects go through gba/hw.ts's `hblankRegs`). Probe
  `__test.trainerCard()` (mainState, `ready`, the stars and badges it has and the ones drawn on BG3, which card
  palette is in the hardware palettes, the female background, the pic's pixel count, what the front printed,
  decoded). Tests: tests/e2e/trainerCard.test.ts, tests/unit/trainerCard.test.ts (the stars).
- **Evolution scene:** `menus/evolutionScene.ts` + `menus/evolutionGraphics.ts` run on whichever GBA host is up
  (BattleScene after TryEvolvePokemon, FieldMenuScene from the party menu) and hand back through
  `gCB2_AfterEvolution` (`setCB2_AfterEvolution`). It draws on the battle BG/window layout, so the field host
  needs the battle text setup too (`initBattleMessages`, `setBattleTextSpeed`). `menuGfxSymbols` preloads the
  scene's graphics plus the pics/palettes/icons of every species the party can evolve into
  (`evolutionTargetSpecies`). Tests wait for the `evolution` event (`from`, `to`, `stopped`).

## Battle

- **Affine BGs:** the software PPU (`gba/ppu.ts`) draws bg modes 0-2: BG2 is affine in mode 1, BG2 and BG3 in
  mode 2 (8bpp, u8 tilemap entries, BGxPA..PD and the 28-bit BGxX/Y reference point, wraparound; no mosaic).
  bg.ts has bg.c's affine paths (the tilemap buffer stays a Uint16Array, read as bytes), `GetBgMetricAffineMode`,
  `SetBgAffine` (bios.ts `BgAffineSet`, computed like mGBA's HLE BIOS) and ChangeBgX/Y writing BG2X/Y in affine
  modes. resetHardware leaves PA = PD = 0x100 like RegisterRamReset. Used by Oak's speech's shrinking player pic.
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

## Game state

- **PC boxes and save data:** `state/PokemonStorage.ts` is struct PokemonStorage (`state.storage`: 14 boxes of 30
  `BoxPokemon | null`, encoded box names, wallpapers, the current box) with pokemon_storage_system.c's accessors
  (GetBoxedMonPtr = `getBoxedMon`, GetBoxMonDataAt, SetBoxMonAt (copies), BoxMonAtToMon, GetBoxNamePtr,
  SeekToNextMonInBox, ...). A BoxPokemon is a Pokemon without `level/status/hp/maxHP/stats`; `boxMonFromMon` /
  `boxMonToMon` convert (BoxMonToMon recalculates stats and fully heals, as on the GBA). GameState has
  GiveMonToPlayer / SendMonToPC (`giveMon` returns MON_GIVEN_TO_PC when the party is full and sets
  VAR_MON_BOX_ID/POS and VAR_PC_BOX_TO_SEND_MON), IsDestinationBoxFull, ShouldShowBoxWasFullMessage,
  Get/SetPCBoxToSendMon and the CountParty* functions; the specials and `bufferboxname` call them. The box-full
  messages come from Cmd_givecaughtmon (battle), DisplaySentToPCMessage (naming screen) and
  EventScript_TransferredToPC (scripts).
  `state/saveData.ts` is the save file: `toSaveData(state)` gives a plain JSON object (`version: SAVE_VERSION`)
  with what gSaveBlock1/2 and the boxes hold that the port keeps, and `fromSaveData(data, state)` loads one into a
  fresh GameState (it throws on another version). Saving and loading the result round-trips exactly. The slot is
  browser localStorage (`writeSave` / `readSave` / `hasSave` / `clearSave`, key `SAVE_STORAGE_KEY`). Before
  saving, call `OverworldScene.storeLocationForSave()`: it fills `state.location` (MAP_* id, map-local x/y,
  facing, PLAYER_AVATAR_FLAG_ON_FOOT/MACH_BIKE/ACRO_BIKE/SURFING). Not saved, as on the GBA: EWRAM state
  (special vars 0x8000+, special flags, gStringVar*, gEnemyParty, the Safari ball/step counts, which can't be
  saved anyway since the Safari start menu has no SAVE, and the roamer's location). Other optional warps the save
  keeps: `continueGameWarp` + `specialSaveWarpFlags` (CONTINUE_GAME_WARP), `escapeWarp`. Game stats
  (`state.gameStats`, Get/Set/IncrementGameStat; only GAME_STAT_ENTERED_HOF and _FIRST_HOF_PLAY_TIME are counted so
  far) are in the save since version 2. The Hall of Fame records live apart from the save, like their own flash
  sectors: `state/hallOfFame.ts` (key `HOF_STORAGE_KEY`, versioned), read into `gHofBuffer` (gDecompressionBuffer)
  by LoadHallOfFameSave, written by TrySavingData(SAVE_HALL_OF_FAME) (which also counts GAME_STAT_ENTERED_HOF) and
  erased by SAVE_OVERWRITE_DIFFERENT_FILE.
  When a new GameState field belongs in the save, add it to SaveData, toSaveData and fromSaveData and bump
  SAVE_VERSION (and have `upgradeSave` fill it in for older saves, as for version 2's `gameStats`); a new Pokemon field won't compile until it's listed in saveData.ts's field lists. Saving and
  loading from the game: see "Saving and continuing". Tests: tests/unit/pcBoxes.test.ts,
  tests/unit/saveData.test.ts, tests/e2e/pcBoxes.test.ts (Celadon Condominiums roof Eevee at (7,3) with a full
  party; catches on Route 1). `t.battle().message` is the battle's last displayed string.
- **Saving and continuing:** `state/save.ts` is save.c on top of the slot: `LoadGameSave()` (BootScene, at boot)
  sets `gSave.fileStatus` (gSaveFileStatus: SAVE_STATUS_EMPTY / OK / INVALID for an unreadable slot),
  `TrySavingData(type, state)` writes `toSaveData(state)` and sets `gSave.attemptStatus`; `gSave.differentSaveFile`
  is gDifferentSaveFile (set by the new game, cleared by CONTINUE and by the new file's first save); plus
  load_save.c's UseContinueGameWarp & co. The start menu's SAVE runs `ui/SaveDialog.ts` (start_menu.c's
  SaveDialogCB_* chain, one callback per frame, in the field message box; the save info window is PrintSaveStats
  on `ui/saveMenuUtil.ts`'s SaveStatToString / GetKantoPokedexCount). It calls `storeLocationForSave()` right
  before writing, since the port doesn't keep gSaveBlock1Ptr->pos current. NO goes back to the start menu.
  Boot: see "Boot, title screen and soft reset". The main menu (`menus/mainMenu.ts`, main_menu.c: CONTINUE / NEW
  GAME, no OPTIONS in FRLG, no MYSTERY GIFT) reads the save through `saveDataView` (what LoadGameSave leaves in
  gSaveBlock1/2). CONTINUE starts the overworld with `{ continueGame: save }`: `create()` loads it with
  `fromSaveData` into the fresh GameState, then `continueSavedGame()` is CB2_ContinueSavedGame
  (Overworld_ResetStateOnContinue, PlayTimeCounter_Start, the continue-game warp if CONTINUE_GAME_WARP is set,
  else the saved map with only ON_LOAD (`onMapLoaded(false, location)`), the player put back with the saved facing
  and bike/surf state, ResumeMap's scripts, the map name popup and a fade from black). Play time
  (state/playTime.ts) is started by the field (new game or CONTINUE) and updated once per logic tick by
  `OverworldScene.tick` and by GbaHostScene's loop (`initHost(texture, state.playTime)`), i.e. on every screen as
  AgbMain does. Tests: tests/unit/save.test.ts, tests/e2e/saveContinue.test.ts. The e2e harness empties the slot
  before every `load()` unless `keepSave: true`; `mainMenu: true` waits for the main menu instead of the field
  (the harness boots with `?skipIntro`, so no title screen first).
  Probes: `t.startMenu()` (items, cursor), `t.saveDialog()` (yesNo, statsWindow, the stats as text),
  `t.mainMenu()` (menuType, cursorPos, fading, the CONTINUE values as text).
  Scripted save prompts: `special Field_AskSaveTheGame` (EventScript_AskSaveGame + `waitstate`) runs the same
  dialog through `ScriptHost.createSaveDialog()` (OverworldScene) as the special's wait state (task50_save_game):
  VAR_RESULT TRUE once saved, FALSE for NO/B or a failed write; the message box is left as is. Users: the cable
  club attendants (Pokémon Center 2F, e.g. Viridian's at (10, 2) from (10, 4) with FLAG_SYS_POKEDEX_GET; the
  linkup that follows never connects, B cancels it) and Seven Island's e-Reader trainer (unreachable).

## Testing and debugging

- **Tests:** `npm test` (unit) and `npm run test:e2e` (headless playthroughs, ~20 s); how to write them is in
  tests/README.md. Each e2e file starts from a URL preset, drives `window.__test` (`src/dev/testHooks.ts`) and
  asserts on state and events. New field mechanics should get a scenario there rather than a one-off
  `browser-test.mjs` run. The game reports milestones through `testEvent()` (map, script, trainerApproach,
  battleTransition, battleTransitionEnd, battleStart, battleEnd, whiteOut, mapTransition, barnDoorWipe,
  multichoice); add one
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
  as `[script] unimplemented command ...`. The whole list, without running anything: see "Script coverage".
- **Script coverage:** `tests/unit/scriptCoverage.test.ts` reads `scripts/scripts.json` and finds every script
  command, special / specialvar, std script (callstd / gotostd / msgbox type), movement action and `dofieldeffect`
  FLDEFF_* the decomp's scripts use that the port doesn't handle, against the port's own tables: ScriptEngine's
  command table (`commandNames`), `SPECIALS` + `TRAINER_SPECIALS` + the specials other modules add with
  `registerSpecials` (read from the source text: those modules import Phaser), MovementRunner's dispatch (each
  action run on a stub object; unhandled ones log `[movement] unimplemented`), the field effect script's
  `callnative`s against `registerFieldEffectNatives` (also read from the source). The extractor's `macros` key
  (asm/macros/event.inc + trainer_tower.inc, movement.inc, map.inc) tells commands from movement actions and map
  data; an op in none of them fails the test. The known gaps are `tests/unit/scriptCoverageGaps.ts`, each tagged
  `main` / `side` / `postgame` / `link` with the maps that reach it (from each map's map scripts, object, coord and
  bg event scripts, following every label argument) and a note (BLOCKER = the story stops there). The test fails on
  a new gap (it prints a ready-made entry with the maps; pick the tag from the decomp scripts) and on a fixed one
  (take it off the list). Porting a special in a Phaser module: register it with `registerSpecials({ ... })` as an
  object literal so the test can read its keys.
- **Bugs that depend on world position:** `?map=` always loads at origin 0, so maps that are far from the origin in
  a real playthrough (e.g. Viridian at y = -80 after walking up from Pallet) need either a real walk or
  `await s.world.load(name, ox, oy)`, then `s.player.setPosition(...)` and `await s.onMapLoaded(false)`.
