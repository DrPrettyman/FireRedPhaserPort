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
- **BG palette loads on the field:** `tilesetVram.loadBgPalette(textures, pair, slot, colors)` is LoadPalette into
  the map BGs' palette slot (0-6 the primary's, 7-12 the secondary's; colours as palettes.json's JASC [r, g, b]): it
  makes the pair's atlases live and redraws only the slots whose metatiles use that palette (AtlasCanvas keeps a
  palette → slots index beside the tile → slots one). Loading the colours a slot already has costs nothing.
  `tilesetVram.resetBgPalettes()` is LoadMapTilesetPalettes: OverworldScene calls it on a map load after ON_RESUME
  (before it on a connection) and in `resumeMap` after ON_RESUME / ON_RETURN_TO_FIELD, as the GBA reloads the
  palettes there. The GBA layer's copy of the map (fieldGbaScreen.ts, battle transitions) loads the changed slots
  too (`bgPaletteOverrides`, back to BGR555). The field's fades are an overlay, so they cover a loaded palette too.
- **League lighting:** `world/leagueLighting.ts` is field_specials.c's DoPokemonLeagueLightingEffect (registered
  with `registerLeagueLighting()`; the rooms' ON_RESUME script), Task_RunPokemonLeagueLightingEffect /
  Task_CancelPokemonLeagueLightingEffect as field tasks, and StopPokemonLeagueLightingEffectTask (the start menu's
  `openFieldMenu`, itemUse.ts' FadeToScreenFromField). Palettes and timers come from `public/gen/leagueLighting.json`
  (tools/extract_field.py `extract_league_lighting`). The field's ResetTasks (`enterMap`, `resumeMap`) ends the
  tasks with `ResetLeagueLightingTasks`. ON_RESUME runs on every map load as on the GBA (LoadMapInStepsLocal's
  ResumeMap: after ON_LOAD, before the objects and ON_WARP_INTO), not only on a return to the field. Probe:
  `__test.leagueLighting(colorIndex?)` (the tasks, BG palette 7, a canvas pixel drawn with palette 7). Tests:
  tests/e2e/leagueLighting.test.ts (dev start `?map=PokemonLeague_LoreleisRoom&x=6&y=12` or
  `PokemonLeague_ChampionsRoom&x=6&y=19`).
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
- **S.S. Anne departure:** `world/ssAnne.ts` is ss_anne.c: `special DoSSAnneDepartureCutscene` (registered with
  `registerSSAnne` from OverworldScene, host `setSSAnneHost`: scene, screen origin, cameraTop, object by local id)
  creates a field task (Task_SSAnneInit/Run/Finish) and hands the script's `waitstate` a wait that ends at
  Task_SSAnneFinish's ScriptContext_Enable. The boat (local id 1) moves only through its sprite's x2 (the object
  stays on its tile, `removeobject` takes it after); the wake and smoke are FieldEffectSprites at screen
  coordinates (like world/hallOfFameRecord.ts, whose `drawFrames` / `canvasTexture` build their textures from
  sWakeTiles / sSmokeTiles on gObjectEventPal_SSAnne, OBJ palette 10). Probe: `__test.ssAnne()` (state, frames,
  boatX2, boatScreenX, wake, smoke, smokeCreated; the last cutscene stays there as 'done'); event
  `ssAnneDeparture` (phase start / run / finish / done). Test spot: `?map=SSAnne_Exterior&x=32&y=14`, then set
  VAR_MAP_SCENE_VERMILION_CITY to 1. Tests: tests/e2e/ssAnne.test.ts (also Vermilion's ticket check, the rival's
  side triggers on 2F, the captain, the dock afterwards).
- **Field moves:** four pieces.
  - `world/fieldEffectScripts.ts` is field_effect.c's interpreter: `FieldEffectStart('FLDEFF_*')` runs the
    decomp's own script (data/field_effect_scripts.s → `field_effects/scripts.json`), whose `callnative` calls a
    function registered with `registerFieldEffectNatives({ FldEff_X })`; `gFieldEffectArguments`,
    `FieldEffectActiveListRemove/Contains` as in C (Contains also sees `entities/FieldEffects.ts`' Phaser
    effects). Script commands `dofieldeffect` (a following `waitstate` waits for the effect's
    ScriptContext_Enable), `waitfieldeffect`, `setfieldeffectargument`, `checkpartymove` (+ `buffermovename`,
    `setescapewarp`) are in ScriptEngine's "field effects and field moves" block. A script that ends without the `waitstate`
    (EventScript_DeepWater) leaves no wait behind: `start()` clears it.
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
- **Dive:** `world/dive.ts`, an R/S leftover FRLG compiles but never reaches (GetInteractedWaterScript never
  returns EventScript_DeepWater / EventScript_TrySurface; no FRLG map has a dive/emerge connection or
  MB_DEEP_WATER). FldEff_UseDive (registered from `registerFieldMoves`) runs Task_UseDive's three steps, one a
  frame: DiveFieldEffect_Init (preventStep), _ShowMon (LockPlayerFieldControls, FLDEFF_FIELD_MOVE_SHOW_MON_INIT
  once the banner's graphics are loaded), _TryWarp (once FLDEFF_FIELD_MOVE_SHOW_MON is over: dive_warp, then off
  the active list). dive_warp: underwater (and not under MB_UNDERWATER_BLOCKED_ABOVE) SetDiveWarpEmerge, on
  diveable water (Behaviors.isDiveable: MB_FAST_WATER..MB_DEEP_WATER) SetDiveWarpDive; each takes the map's
  `emerge` / `dive` connection to the same map-local tile (else RunOnDiveWarpMapScript and FALSE), then
  StoreInitialPlayerAvatarState and DoDiveWarp. `DoDiveWarp(fieldCallback?)` is field_fadetransition.c's (lock,
  WarpFadeOutScreen, Task_Teleport2Warp, `FieldMoveHost.warpIntoMap`); without a callback the field arrives with
  FieldCB_DefaultWarpExit (OverworldScene.defaultWarpExit, then UnfreezeObjectEvents / UnlockPlayerFieldControls).
  DoFallWarp is DoDiveWarp(FieldCB_FallWarpExit). `DiveHost` (`setDiveHost` in OverworldScene.create): the map's
  connections, its ON_DIVE_WARP script, SetWarpDestination. Test events `diveShowMon`, `diveWarp` (dir, map, x, y),
  `diveDone` (warped). Tests: tests/unit/dive.test.ts (the steps on fake hosts), tests/e2e/dive.test.ts (Six
  Island's MB_FAST_WATER at (13, 23), surfing, given a synthetic dive connection to Route 21 North; and none).
- **Interactions:** `OverworldScene.interact` is GetInteractionScript (object → bg event → metatile via
  `METATILE_SCRIPTS` → water); `tryWalkIntoSignpost` runs after a step (before the wild check) and when holding toward the
  facing direction. The signpost / walk-away / last-message-dismiss state (script.c statics) lives in ScriptEngine
  (`msgSetSignpost`, `handleCancelSignpost`, `takeRegisteredInput`); MessageBox draws the signpost frame when told.
  Tests: Viridian Forest item ball (`?start=after-rival&map=ViridianForest&x=5&y=42`, face up, A), hidden Potion
  (x=3 y=23), Pallet town sign (x=9 y=13, hold up), Viridian PC (`map=ViridianCity_PokemonCenter_1F&x=11&y=2`).
- **Side specials:** `script/sideSpecials.ts` (SIDE_SPECIALS, spread into SPECIALS like STORY_SPECIALS; no Phaser)
  holds small side-content specials: GetProfOaksRatingMessage (prof_pc.c: the rating by VAR_0x8004 Kanto mons
  caught through `SpecialEnv.showFieldMessage`, VAR_RESULT = complete; the script's `waitmessage` waits for it),
  HasAllMons (menus/pokedex.ts), BackupHelpContext / RestoreHelpContext (no-ops). Its callers:
  PokedexRating_EventScript_RateInPerson (Oak, PalletTown_ProfessorOaksLab) and EventScript_AccessProfOaksPC (the
  PC menu's PROF. OAK's PC). The museum's fossil pics are `ui/MuseumFossilPic.ts` (script_menu.c
  OpenMuseumFossilPic / CloseMuseumFossilPic / Task_WaitMuseumFossilPic as a field task, so it outlives the
  script): registered from OverworldScene with `registerSpecials` (it draws), graphics `sMuseum*Spr*` through
  extract_gfx.py (`graphics/script_menu/`), preloaded with the field's gfx. Probe: `__test.museumFossilPic()`.
  Tests: tests/e2e/sideEvents.test.ts (Oak in his lab at (6, 4), the Viridian PC, the museum's fossils from
  (5, 4) / (5, 7) facing left, the Cinnabar lab's fossil revival), tests/unit/sideSpecials.test.ts.
- **Daycare:** `world/daycare.ts` is daycare.c except the hatching scene: `GameState.route5DayCareMon` (struct
  DaycareMon: a BoxPokemon or null, u32 steps; no mail) and `GameState.daycare` (struct DayCare, the Four Island
  daycare: two DaycareMons, the u16 offspringPersonality, the u8 egg-cycle stepCounter), both saved (SAVE_VERSION
  4; a version 3 save had only `daycareStepCounter`). Storage: StorePokemonInDaycare / StoreSelectedPokemonInDaycare
  (first empty slot), TakeSelectedPokemonFromDaycare / TakePokemonFromDaycare (BoxMonToMon, one exp per step,
  ApplyDaycareExperience: TryIncrementMonLevel level by level with MonTryLearningNewMove, the first move pushed out
  when full; then ShiftDaycareSlots), the level / cost helpers (cost 100 + 100 per level), GetDaycareState,
  GetDaycareMonNicknames. Eggs: ShouldEggHatch / TryProduceOrHatchEgg on every field step (the Route 5 mon's and
  the daycare mons' steps; with both mons in and no egg pending, when the second's steps reach 0xFF mod 256 the
  GetDaycareCompatibilityScore roll calls TriggerPendingDaycareEgg; party eggs' egg cycles), the compatibility
  (EggGroupsOverlap, SetDaycareCompatibilityString into menus/common.ts's gStringVar4), _GiveEggFromDaycare
  (DetermineEggSpeciesAndParentSlots: GetEggSpecies back through `menusData.evolutions`, Nidoran♂ / Volbeat for an
  EGG_GENDER_MALE personality, Ditto as "mother"; AlterEggSpeciesWithIncenseItem; SetInitialEggData; InheritIVs with
  the C's RemoveIVIndexFromList quirk; BuildEggMoveset: GetEggMoves over `tables.eggMoves` (gEggMoves, flat, from
  extract.py), the father's TM/HM moves, the level-up moves both parents know), RejectEggFromDayCare, CreateEgg
  (the shared egg maker: W-hatch / anything else making an egg should call it) and ScriptGiveEgg (`giveegg`,
  ScriptEngine.ts), NameHasGenderSymbol / AppendGenderSymbol. The script specials are `script/daycareSpecials.ts`
  (DAYCARE_SPECIALS: ChooseSendDaycareMon through `runScreenFromScript` and partyMenu.ts's ChooseMonForDaycare
  (PARTY_MENU_TYPE_DAYCARE: STORE leaves the slot in VAR_0x8004), the Route 5 ones, the Four Island ones (slot in
  VAR_0x8004), GetSelectedMonNicknameAndSpecies; they read the chosen slot with GetCursorSelectionMonId, as the C
  does; plus field_specials.c's ShowFieldMessageStringVar4 (SpecialEnv.showFieldMessage takes encoded bytes too)
  and PlayerPartyContainsSpeciesWithPlayerID for the Water Labyrinth's egg; its GetLeadMonFriendship is in
  script/miscSpecials.ts).
  IsEnoughForCostInVar0x8005 / SubtractMoneyFromVar0x8005 / CalculatePlayerPartyCount are in SIDE_SPECIALS.
  ShowDaycareLevelMenu is `ui/DaycareLevelMenu.ts` (a field task with a FieldListMenu, whose template now takes an
  `itemPrintFunc`; probe `t.daycareLevelMenu()`). Tests: tests/unit/daycare.test.ts, tests/unit/eggs.test.ts,
  tests/e2e/daycare.test.ts (Route 5: `?start=after-rival&map=Route5_PokemonDayCare&x=4&y=5`, face up; Four
  Island: `map=FourIsland_PokemonDayCare&x=2&y=3`, face up for the lady; out through the mat at (4, 7) with
  VAR_MAP_SCENE_FOUR_ISLAND = 1 to skip the rival, the old man at (16, 13), talk from (16, 14); the Water
  Labyrinth gentleman: `map=FiveIsland_WaterLabyrinth&x=14&y=12` with a lead at 255 friendship). Set the steps
  (`t.state.route5DayCareMon.steps`, `t.state.daycare.mons[1].steps = 254` before a step for the egg roll) rather
  than walking.
  `script/miscSpecials.ts` (MISC_SPECIALS, spread into SPECIALS; W-misc) has more: Daisy's grooming
  (DaisyMassageServices, GetLeadMonFriendship; RunMassageCooldownStepCounter runs on every step from
  OverworldScene.processPlayerFieldInput), the Route 12 Magikarp size record (pokemon_size_record.c: GetMonSizeHash,
  GetMonSize, FormatMonSizeRecord in inches; the record is VAR_MAGIKARP_SIZE_RECORD, so it's saved with the vars;
  the heights come from pokedex.json, loaded on demand while the script waits), SetSeenMon,
  DoesPlayerPartyContainSpecies, BufferBigGuyOrBigGirlString, HasAllKantoMons + ShowDiploma (`menus/diploma.ts`,
  diploma.c; graphics `sDiploma*` from `graphics/diploma/`; probe `__test.diploma()`), and the Trainer Fan Club
  (trainer_fan_club.c: struct TrainerFanClub packed in VAR_FANCLUB_FAN_COUNTER as on the GBA, the loss timer in
  VAR_FANCLUB_LOSE_FAN_TIMER, play hours from `state.playTime`). The Compare/Get*SizeRecordInfo pair takes a var
  name and species, so the postgame Heracross record is two more table entries. GetMartClerkObjectId (sMartMaps)
  is here too; its only caller is EventScript_Questionnaire, behind Easy Chat.
  Tests: tests/e2e/sideSpecials.test.ts (Daisy in PalletTown_RivalsHouse from (5, 5) facing up with
  FLAG_SYS_GAME_CLEAR; the fishing guru at Route12_FishingHouse (4, 5); the designer at
  CeladonCity_Condominiums_3F (3, 9); the S.S. Anne gentleman; the Trainer Fan Club at
  SaffronCity_PokemonTrainerFanClub (7, 14): the crush girl before the Hall of Fame, then
  Script_UpdateTrainerFanClubGameClear called in the page, MeetFirstFans on the way back in, a fan and a non-fan),
  tests/unit/miscSpecials.test.ts (the size formula, the friendship rating, the fan club by hand, every mart's
  clerk).
- **Fall warps (holes):** `world/fallWarp.ts`. Stepping onto an MB_FALL_WARP tile with a warp
  (OverworldScene.tryStartWarpEventScript, TryStartWarpEventScript's branch) runs SetupWarp (`setupWarp`, shared
  with takeWarp; the destination lands in `warpDestination` once its header has loaded: `warpSetup`) and
  EventScript_DoFallWarp; its `special DoFallWarp` (registered with the field moves) is DoDiveWarp (world/dive.ts)
  with FieldCB_FallWarpExit: the fade out, `FieldMoveHost.warpIntoMap(..., warpId)`, then Task_FallWarpFieldEffect (the
  player drops from the top of the screen, lands with the landing ground effect, the camera shakes 4/2/1 px through
  `FieldMoveHost.setCameraPanning`; on Seafoam B3F/B4F water the player lands surfing with VAR_TEMP_1 = 1 for the
  B4F current). The holes before the Hall of Fame: Seafoam Islands 1F-B3F, Pokémon Mansion 3F, Victory Road 3F;
  Six Island's Dotted Hole after. Test events `fallWarp` (map), `fallWarpLanded`, `fallWarpDone`; the field probe's
  `avatar.spriteY2` / `avatar.cameraPanY`. Tests: tests/e2e/sideSpecials.test.ts (Pokémon Mansion 3F (18, 17)
  walking down; Seafoam B3F (6, 17) into the B4F current).
- **Egg hatching:** `menus/eggHatch.ts` is daycare.c's hatching half. ShouldEggHatch (world/daycare.ts) leaves the
  egg's slot in VAR_0x8004; OverworldScene counts GAME_STAT_HATCHED_EGGS and runs EventScript_EggHatch, whose
  `special EggHatch` (EGG_HATCH_SPECIALS, spread into SPECIALS) fades out and `runScreenFromScript(StartEggHatch,
  eggHatchGfxSymbols(...))`: CB2_EggHatch_0 (the battle textbox, the trade shadow on BG1, the egg and shard sheets,
  AddHatchedMonToParty, the mon pic through gMonSpritesGfxPtr's position 1), CB2_EggHatch_1 (states 0-12: wobbles
  SpriteCB_Egg_0..5, 19 shards, the white flash, the message, the nickname YES/NO → DoNamingScreen →
  EggHatchSetMonNickname), back through CB2_ReturnToField. AddHatchedMonToParty / ScriptHatchMon take the
  GameState and need no screen (unit tests). Probe `__test.eggHatch()` (CB2_state, the egg's anim and
  visibility, the mon's, shards on screen / made). Test hook: a `MonSpec` with `egg: <cycles left>` is made by
  world/daycare.ts' `createEgg` (then friendship = cycles; `level` / `iv` / `shiny` don't apply); set `t.state.daycare.stepCounter = 254` so the next step counts
  the cycle. Tests: tests/unit/eggHatch.test.ts, tests/e2e/eggHatch.test.ts.
- **Multichoice / elevators:** `ui/MultichoiceMenu.ts` (vertical list and grid, field windows); the script engine
  sets VAR_RESULT from `ScriptHost.openMultichoice`. Like `yesnobox`, `multichoice` / `multichoicedefault` /
  `multichoicegrid` let the script run on the frame after the choice (Task_MultichoiceMenu_HandleInput's
  ScriptContext_Enable), so the A that chose can't reach a menu or `waitbuttonpress` that follows. `text/stringWidth.ts` is GetStringWidth for any font set
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
  `floorNumber`. Tests: `tests/e2e/mapNamePopup.test.ts`, probe `__test.mapNamePopup()`, event `mapNamePopupText` (each
  name printed; the hooks log it each tick, since a popup after a load can be gone before a poll sees it).
- **Screen transitions:** `battle/transition.ts` is battle_transition.c; `world/fieldGbaScreen.ts` puts the field
  on the GBA layer for it (start → BattleTransition_StartOnField, `frame()` once per overworld tick, stop when
  IsBattleTransitionDone) and has a bare mode for CB2_DoChangeMap's cave flash screens (`world/mapTransition.ts`,
  also MapTransitionIsEnter/IsExit). Warps go WarpFadeOutScreen (with TryFadeOutOldMapMusic and SE_EXIT, waiting
  for BGMusicStopped too: "Map music") → doChangeMap → SetUpWarpExitTask in `OverworldScene.warpTo`. `__test.forceBattleTransition('SWIRL')` makes the next battles use one transition.
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
    FieldUseFunc and end in something that unfreezes and unlocks. The Town Map, TM case and berry pouch open their
    screens from the field (Task_UseTownMapFromField / Task_InitTMCaseFromField / Task_InitBerryPouchFromField):
    `FadeToScreenFromField` (FadeScreen to black through world/fieldItems.ts), then `OpenScreenFromFieldOnceFaded`
    sets gFieldCallback2 = FieldCB2_UseItemFromField (SetFieldCallback2ForItemUse) and calls the field's
    `OpenScreenFromField(init, gfxSymbols)`: OverworldScene.openItemScreenFromField clears the message box
    (CleanupOverworldWindowsAndTilemaps), loads the headers (prepareFieldMoveMenu) and runs FieldMenuScene
    `itemFromField`, whose `itemScreen.init` is the C's InitRegionMapWithExitCB / InitTMCase / InitBerryPouch with
    CB2_ReturnToField. Back on the field, `OverworldScene.runFieldCallback` (RunFieldCallback, shared with the start
    menu's screens) runs FieldCB2_UseItemFromField: objects frozen and controls locked while the field fades in,
    then both released. The TM case / pouch's USE and GIVE go through the party menu and back to the screen as from
    the bag (the reopening keeps the CB2_ReturnToField exit); SELECT closes both. The Fame Checker and Teachy TV
    (no screens) log and give the controls back (registeredItemFieldFunc). Script `release` / `releaseall` now also
    unfreeze objects (ClearPlayerHeldMovementAndUnfreezeObjectEvents), and a map load or a battle's return clears the
    freeze. Probes: `field().locked` (LockPlayerFieldControls held), `field().objectsFrozen`, `__test.gbaTasks()`
    (active gTasks by function name, e.g. `Task_BagMenu_HandleInput`, `Task_FieldItemContextMenuHandleInput`),
    `__test.paletteFadeActive()`. Tests: tests/e2e/registeredItems.test.ts (registering the Bicycle in the bag and SELECT on /
    off, Cycling Road, the Old Rod, the Coin Case, the VS Seeker / Itemfinder / Poké Flute messages, nothing
    registered; Pallet Town's pond at (8, 16), (12, 13) for no trainers or hidden items; the Town Map, TM case (HM01
    taught, SELECT to close) and berry pouch from the field, never through the bag).
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
- **In-game trades and the Name Rater:** `script/tradeSpecials.ts` (TRADE_SPECIALS, spread into SPECIALS) is
  trade_scene.c's in-game path: GetInGameTradeSpeciesInfo, GetTradeSpecies, CreateInGameTradePokemon(Internal)
  (the trade's mon into `state.enemyParty[0]`), TradeMons, UpdatePokedexForReceivedMon, BufferInGameTradeMonName,
  and DoInGameTradeScene: the fade to black (the scene's graphics and both mon pics load meanwhile:
  `tradeSceneGfxSymbols`), then `ScriptHost.runScreenFromScript` runs `menus/tradeScene.ts` on FieldMenuScene:
  CB2_InitInGameTrade → CB2_InGameTrade (DoTradeAnim) → CB2_ReturnToField, and the script's `waitstate` ends once
  the field has faded back in. FireRed's in-game trades never set `isCableTrade` (only CB2_LinkTrade does), so
  the scene is DoTradeAnim_Wireless (the GBA's wireless signal, the white column where the mons cross); the cable
  path isn't ported. STATE_TRY_EVOLUTION calls TradeMons(VAR_0x8005, 0), the end BufferInGameTradeMonName. The
  graphics are graphics/trade/ (extract_gfx.py's GFX_PREFIXES); the scene sets a silent BattleUi if none is set
  (the Poké Balls' open particles play their SE through it). Probe: `tradeSceneProbe()` (the state, the mon
  sprite ids), imported in the page; the e2e's `watchTradeScene` records the states and renders frames at a few
  of them (`TRADE_SHOTS=<dir>` saves them as PNGs). The data
  is sInGameTrades (src/data/ingame_trades.h) through `tools/extract_trades.py` → `public/gen/trades.json`, loaded by
  `Assets.init` and handed over with `initInGameTrades` (OverworldScene). The scripts' VARs: 0x8008 = the
  INGAME_TRADE_*, copied to 0x8004 for the specials; ChoosePartyMon's slot (0x8004) is kept in 0x800A and copied
  to 0x8005; 0x8009 = the requested species. The Name Rater's specials (IsMonOTIDNotPlayers, which writes
  VAR_RESULT itself, IsMonOTNameNotPlayers, NameRaterWasNicknameChanged against the gStringVar3 that
  ChangePokemonNickname leaves) are in the same file. Tests: tests/unit/inGameTrades.test.ts,
  tests/e2e/inGameTrades.test.ts (Reyley in Route2_House, talk from (7, 3); the Name Rater in LavenderTown_House2,
  talk from (4, 5)).
- **Step counters:** `world/stepCounters.ts` (happiness, VS Seeker, field poison; ShouldEggHatch is re-exported
  from world/daycare.ts), called from `OverworldScene.tryStartStepCountScript`;
  `world/roamer.ts` is roamer.c with its EWRAM statics as module state
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
- **Game Corner (coins box, slot machine, photo printer):** `ui/CoinsBox.ts` is coins.c's field window (ShowCoinsWindow /
  PrintCoinsString / HideCoinsWindow), drawn like `ui/MoneyBox.ts`; the script commands `showcoinsbox` /
  `updatecoinsbox` / `hidecoinsbox` call `ScriptHost.showCoinsBox` etc. (OverworldScene; the box's last printed
  `amount` is the test probe). `menus/slotMachineLogic.ts` is slot_machine.c's game logic without the screen: a
  module-global `sSlotMachineState` (`CreateSlotMachineState(machineIdx)` = PlaySlotMachine's Alloc +
  InitSlotMachineState), `SpinReels` (Task_SpinReels minus the sprites), StartReels / StopCurrentReel / StopReel1-3
  with TwoReelBiasCheck / OneReelBiasCheck, CalcSlotBias / ResetMachineBias, CalcPayout / GetPayout /
  GetWinFlagByLine; functions that roll take an optional `rand` (default Random()). Its tables (reel icons, payouts,
  bias chances, the line tables, field_specials.c's sSlotMachineIndices and the file-local enums) are extracted by
  `tools/extract_slots.py` to `slotMachine.json`, loaded by OverworldScene (`loadSlotMachineData`). Game Corner
  specials go in `script/gameCornerSpecials.ts` (GAME_CORNER_SPECIALS, spread into SPECIALS): GetRandomSlotMachineId,
  UpdateTrainerCardPhotoIcons (the photo printer: the party as mail species and the tint into the trainer card's
  VAR_TRAINER_CARD_MON_ICON_* vars). The same file has the Game Corner scripts' field effect natives,
  FldEff_SmileyFaceIcon (the field's Phaser emote over the object) and FldEff_PhotoFlash (a FADE_FROM_WHITE), which
  `registerGameCornerFieldEffects(host, defines)` registers from the ScriptEngine constructor (they need the host).
  The screen: `menus/slotMachine.ts` is the rest of slot_machine.c. `playslotmachine` (ScriptEngine →
  `PlaySlotMachineFromScript`) loads `slotMachineGfxSymbols()`, then `host.runScreenFromScript` runs PlaySlotMachine
  on FieldMenuScene with CB2_ReturnToFieldContinueScriptPlayMapMusic; the script waits (ScriptContext_Stop) until
  the field has faded back in. Structure as in the C: a main task (MainTask_SlotsGameLoop and the others, switched by
  SetMainTask), Task_SpinReels (the logic's SpinReels + UpdateReelIconSprites), and Task_SlotMachine running up to 8
  setup tasks (SlotsTask_*, `SetSlotMachineSetupTask(funcno, slot)` / `IsSlotMachineSetupTaskActive(slot)`), whose
  data (struct SlotMachineSetupTaskData) is the module's `sSetupTaskData`. The reels are 15 affine sprites sharing
  OAM matrix 0; HBlankCB_SlotMachine writes its PA (`oamMatrices[0].a`) and BLDY per line, which squashes and darkens
  the reels towards their top and bottom (BLDCNT darkens BG3, OBJ and the backdrop, which shows through BG2's reel
  window). The help (RIGHT) slides BG1's combos window in through WIN0; the field leaves WIN0V at (0, 255), which
  PlaySlotMachineFromScript sets since FieldMenuScene starts from reset registers. The slot machine's graphics come
  from `graphics/slot_machine/`; its `sBg_Pal` clashes with main_menu.c's, so extract_gfx.py now also writes a
  clashing static symbol as `<file stem>.<symbol>` (`slot_machine.sBg_Pal`; the plain name stays the first file's,
  in sorted order). Probe `__test.slotMachine()`: the main task and step, `ready`, bet, reels, win flags, payout,
  the CREDIT / PAYOUT digits drawn, Clefairy's anim, the help slide, the line lights' palettes, the reel buttons.
  Tests: `tests/unit/slotMachine.test.ts` (hand-worked reel positions), `tests/e2e/gameCorner.test.ts` (the coin
  clerk, the prize room, the Fisher, hidden coins; the slot machine: bet with R and DOWN, spins checked against a
  payout worked out from the reel table, START to pay, the help window, YES/NO to quit, no coins; the smiley; the
  photo printer). To wait for a message's `\p` in a test without a press reaching the menu after it, wait in the
  page for `messageBox.waitingForButton` (TextPrinter.waitingForButton).
- **Seagallop ferry:** `menus/seagallop.ts` is seagallop.c; `script/ferrySpecials.ts` (FERRY_SPECIALS, spread into
  SPECIALS) has its specials and script_menu.c's Rainbow Pass menu. `special DoSeagallopFerryScene` runs
  `host.runScreenFromScript(DoSeagallopFerryScene, SEAGALLOP_GFX)` and keeps the script in its `waitstate` until the
  scene warps (`SeagallopWarpWait`). Don't end the script at the special: the field runs out the frame's ticks
  after it, and the player's input there starts other scripts (the HoF's EnterHallOfFame still does that): CB2_SetUpSeagallopScene (states 0-7: BG3 water
  from graphics/seagallop with the WB or EB tilemap, the ferry and wake sheets, WIN0 letterboxing lines 24-136),
  then Task_Seagallop_1 scrolls BG3 6 px a frame for 140 frames and fades out, and Task_Seagallop_3 warps to
  sSeag[VAR_0x8006] through CB2_LoadMap → `fieldReturn.warp` (menus/fieldCallbacks.ts; FieldMenuScene exits with
  the WarpData and OverworldScene's `warpFromScreen` loads the map and fades in, FieldCB_DefaultWarpExit's way).
  Any screen can leave the same way. The direction (GetDirectionOfTravel / `TravelDirection`) is
  sTravelDirectionMatrix's bit [VAR_0x8004][VAR_0x8006]. GetSeagallopNumber and IsPlayerLeftOfVermilionSailor take
  plain arguments (unit tests). DrawSeagallopDestinationMenu opens the field's MultichoiceMenu with a fixed `layout`
  (MultichoiceRequest.layout: CreateWindowFromRect(17, top, 11, rows * 2), 16 px rows) and ends its `waitstate` the
  frame after the choice (ScriptContext_Enable's frame). Probe `__test.seagallop()`: setup state, Task_Seagallop_1's
  frame count, BG3's x, the ferry's x / x2 / flip, the wakes on screen. Test: `tests/unit/seagallop.test.ts`,
  `tests/e2e/seagallop.test.ts` (Bill's trip out, declining Bill, Vermilion ⇄ Two Island, cancelling at the
  Vermilion sailor; every harbor's sailor: the islands' Tri-Pass menus before and after VAR_MAP_SCENE_CINNABAR_ISLAND
  4, the Rainbow Pass from Vermilion and each island in turn with both pages, OTHER, EXIT and B, each arrival and
  direction; Navel Rock / Birth Island from the tickets' EventScript_SailToNavelRock / _BirthIsland and back),
  `tests/e2e/seviiQuest.test.ts` (the Sevii 1-3 quest played, Bill's way back without setting the var). Helpers
  for new ferry tests: `tests/e2e/seagallopHelpers.ts` (`warp`, `rideFerry` / `checkRide`, `sail` (checks the
  HI-SPEED number), `waitForMenu`, `talkToHarborSailor`, `harborState`). Quick look: `?map=VermilionCity&x=23&y=31` with
  VAR_MAP_SCENE_VERMILION_CITY 3 and VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F >= 1, walk down onto the ticket check.
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
- **Easy Chat (easy_chat.c, easy_chat_2.c, easy_chat_3.c; SIDE_PLAN.md W-easychat):**
  `menus/easyChatData.ts` holds
  public/gen/easyChat.json (tools/extract_easy_chat.py: sEasyChatGroups, the alphabetical word lists, the group
  names, the default words, plus easy_chat_2.c's screen templates and passphrases), set by Assets.init before any
  GameState exists (unit tests: gameData.ts), and InitEasyChatPhrases / InitQuestionnaireWords, which the GameState
  constructor runs (NewGameInitData). `menus/easyChat.ts` is the rest of easy_chat.c: CopyEasyChatWord (encoded,
  no EOS), ConvertEasyChatWordsToString (with EOS, like gStringVar4), EC_DoesEasyChatStringFitOnLine (TRUE = does
  NOT fit, as in the C), IsECWordInvalid, the unlocked groups / words (POKéMON = the 251-species list once one is
  seen, POKéMON2 = the Hoenn list with the National Dex, EVENTS / MOVE 1 / MOVE 2 after FLAG_SYS_GAME_CLEAR, TRENDY
  SAYING never), the trendy-saying bits (EnableRareWord, UnlockRandomTrendySaying, ...), and the screen's selection
  lists (InitEasyChatSelection(state) → GetNumDisplayableGroups / GetSelectedGroupByIndex, GetUnlockedECWords(alpha,
  group) → GetDisplayedWordByIndex). Words are EC_WORD(group, index); the EC_WORD_* names are in the script
  defines, the EC_GROUP_* / EASY_CHAT_TYPE_* constants also in easyChat.json (`EC()`). Note EC_GROUP_POKEMON_2 (0)
  holds sEasyChatGroup_Pokemon (Hoenn) and EC_GROUP_POKEMON (21) sEasyChatGroup_Pokemon2. Saved words: GameState's
  easyChatProfile / easyChatBattleStart / easyChatBattleWon / easyChatBattleLost / questionnaireWords /
  additionalPhrases (gSaveBlock1's names), in the save's `easyChat` since version 5 (a version-4 save keeps the
  new-game words); `easyChatWordsForType(state, EASY_CHAT_TYPE_*)` picks the array ShowEasyChatScreen edits.
  Specials: `script/easyChatSpecials.ts` (ShowEasyChatMessage, BufferRandomHobbyOrLifestyleString). The trainer
  card copies the profile words (only a link card prints them). Tests: tests/unit/easyChat.test.ts,
  tests/e2e/easyChat.test.ts (the Pewter Pokémon Center's profile woman at (13, 2), talked to from (13, 3)).
  The screen's model, `menus/easyChatScreenModel.ts`, is easy_chat_2.c without graphics (no Phaser, no GBA
  layer): sEasyChatScreen and the getters easy_chat_3.c reads (GetMainCursorColumn, GetECSelectWordCursorCoords,
  ShouldDrawECUpArrow, ...; texts as src/strings.c labels). The screen (unit 3) calls InitEasyChatSelection(state),
  `EasyChat_AllocateResources(state, type, words, { processYesNoInput })` (`words` is the saved array from
  easyChatWordsForType: confirm writes into it), then each frame `EasyChatScreen_HandleJoypad({ newKeys,
  newAndRepeatedKeys })` (gMain's key bits) → an `EC_CMD` id for ECInterfaceCmd_01-22 (pokeemerald's ECFUNC_*
  names), `EC_CMD.EXIT` (23) to fade out; after the fade `EasyChat_OnLeave()` (Task_RunEasyChat case 3: the
  profile flag, the passphrase compares into VAR_0x8004), then EasyChat_FreeResources / DestroyEasyChatSelectionData.
  Cancel / confirm set VAR_RESULT. `processYesNoInput` is gba/menu.ts's Menu_ProcessInputNoWrapClearOnChoose for
  the YES/NO the screen creates (initial cursor: NO for quit / DEL ALL, YES for confirm); without it a model of it
  reads the same keys (`GetEasyChatYesNoCursor`). Tests: tests/unit/easyChatScreen.test.ts (key presses through
  the fields, footer, groups, keyboard, blue box, word list, the YES/NO menus and both passphrases).
  The screen, `menus/easyChatScreen.ts`, is easy_chat_2.c's task / CB2 wiring (ShowEasyChatScreen → DoEasyChatScreen
  → Task_InitEasyChat, which runs the whole setup in one frame, → Task_RunEasyChat: fade in, joypad → command, fade
  out, EasyChat_OnLeave, DismantleEasyChat → the callback) plus easy_chat_3.c (`sEasyChatGraphicsResources` is
  struct ECWork). `special ShowEasyChatScreen` (script/easyChatSpecials.ts) runs it with
  `host.runScreenFromScript(ShowEasyChatScreen, EASY_CHAT_GFX)` and `stopScript` (no `waitstate`, as
  SelectMoveDeleterMove); it leaves through a local CB2_ReturnToFieldContinueScript (the field stays black and
  Common_ShowEasyChatScreen's `fadescreen FADE_FROM_BLACK` fades it in). Graphics: `graphics/easy_chat/` in
  extract_gfx.py's GFX_PREFIXES (gEasyChat* and easy_chat_3.c's static s* symbols; LoadSpriteGfx loads every sheet
  and palette, the rectangle cursor / mode / button window ones for unit 4). Layers: BG3 the yellow window
  (gEasyChatWindow_Tilemap) with the phrase window (sPhraseFrameDimensions[frameId], baseBlock 0x60) and the footer;
  BG1 the orange text input frame (DrawECFrameInTilemapBuffer), the title (window 0) and the green frame around
  window 2; BG0 the instructions (window 1, the user's frame at tile 1 / palette 14) and the YES/NO
  (sEasyChatYesNoWindowTemplate); BG2 window 2 (28x32 tiles, 256 px tall) for the groups menu / A-Z keyboard / word
  list, shown only inside WIN0 (WINOUT leaves BG2 out). The green frame's animation: StartWin2FrameAnim(n) sets a
  step range, AnimateFrameResize takes one step a frame through RedrawFrameByIndex (BG1 rows 10-19 cleared, the
  frame at that step's size by RedrawFrameByRect, which also sets WIN0 to its inside): 0-10 grows the groups /
  keyboard frame out of the instructions (BG0 hidden meanwhile), 11-17 widens it for the word list, 18-22 shrinks it
  for the mode switch. Window 2's rows sit at y = (row * 16 + 96) mod 256 and BG2 starts 8 px down (InitBg2Scroll),
  so a row scrolled to the top of the frame shows at y 88; ScheduleBg2VerticalScroll / AnimateBg2VerticalScroll move
  BG2 by rows (2 px a frame for a row, 4 for a page, at once for the groups menu reopening scrolled), and the word
  list prints only the rows that scroll in (UpdateWin2PrintWordsScroll*). Sprites: the red rectangle cursor (two
  64x32 halves, the right one flipped; anim by what it's on: group, blue box button, "others", letter), the word
  list's triangle cursor, the mode window (64x32 at (208, 80), anims hidden / to GROUP / to A-Z / transition) and
  the button window (the blue help box, 64x64 at (208, 128), sliding in from x2 -64 8 px a frame), the scroll arrows
  (x 96 on the groups, 120 on the words) and START / SELECT. Interface commands: `EasyChatInterfaceCommand_Setup(id)`
  / `_Run()`, all of ECInterfaceCmd_01-22 (pokeemerald's ECFUNC_* names in EC_CMD). Probe `__test.easyChat()`: the
  live model (`screen`), `lastCommand` and `commandCount`, the triangle cursor (x, y, x2, bouncing), START / SELECT
  visibility, `idle` (Task_RunEasyChat reading keys, no fade), the frame step, WIN0, BG2's y and scroll row, the
  rectangle / word cursors, the mode window's anim and the help sprite's x2, the scroll arrows, the displayable
  `groups` and the `words` on display, and `reprint()` (PrintECFields). Test: tests/e2e/easyChat.test.ts (the
  Pewter profile woman: B → YES, the cursor over fields and footer, DEL. ALL, START → YES unchanged; a profile
  typed through the groups and the keyboard; the group names and ENDINGS' 35 rows scrolled by rows and pages, the
  mode switch, DEL; MYSTERY EVENT IS EXCITING typed; the Pewter Mart questionnaire at (1, 4) with LINK TOGETHER
  WITH ALL typed). Its `step(game, button, cmds, state)` presses and waits in the page for a new command (by
  `commandCount`) and the input state; `typeByGroup` / `typeByKeyboard` type a word from the field selection.
  Don't wait for a fixed number of frames.
- **Party selection from scripts, tutors, the move deleter:** `menus/partyMenuSpecials.ts` is
  party_menu_specials.c (ChoosePartyMon, ChooseMonForMoveRelearner, SelectMoveDeleterMove, the deleter's
  helpers) plus the ChooseMonForMoveTutor special; `PARTY_MENU_SPECIALS` is spread into SPECIALS. A special that
  hands the field over to a GBA-layer screen calls `ScriptHost.runScreenFromScript(init)` (OverworldScene: field
  black, FieldMenuScene `itemFromField` runs `init`; back through CB2_ReturnToField, RunFieldCallback runs
  gFieldCallback2 / gFieldCallback, e.g. the party menu's CB2_FadeFromPartyMenu, and the wait ends when that has).
  Followed by `waitstate`, pass the wait to `setWaitState`; without one (SelectMoveDeleterMove), to
  `SpecialEnv.stopScript`. ChoosePartyMon leaves the slot in VAR_0x8004 (SLOT_CANCEL = PARTY_SIZE + 1 on B).
  W-trade / W-daycare: `special ChoosePartyMon` + `waitstate` just works. `runScreenFromScript(init, gfxSymbols)`
  preloads what the screen draws beyond prepareMenus (e.g. `LEARN_MOVE_GFX`).
  The move relearner: `menus/learnMove.ts` is learn_move.c (CB2_MoveRelearner_Init / _Resume, the
  MENU_STATE_* machine, the list, the move info windows, the YES/NO prompts, the forget-a-move summary through
  ShowSelectMovePokemonSummaryScreen) plus pokemon.c's GetMoveRelearnerMoves / GetNumberOfRelearnableMoves.
  `special TeachMoveRelearnerMove` (in PARTY_MENU_SPECIALS) fades, then `runScreenFromScript(StartMoveRelearner)`;
  VAR_0x8004 comes back TRUE if a move was taught. ChooseMonForMoveRelearner's party menu sets VAR_0x8005 =
  GetNumberOfRelearnableMoves (HandleChooseMonSelection). The Cape Brink tutor's CapeBrinkGetMoveToTeachLeadPokemon
  / HasLearnedAllMovesFromCapeBrinkTutor (field_specials.c) are there too; it teaches through ChooseMonForMoveTutor.
  Probe `__test.moveRelearner()` (MENU_STATE_* `state`, the list's move ids, `selectedIndex`, `selectedMoveSlot`).
  Tests: tests/e2e/moveTutors.test.ts (Route 4's Mega Punch tutor, the Fuchsia move deleter, Two Island's Move
  Maniac, the Cape Brink tutor), tests/unit/partyMenuSpecials.test.ts.
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
  same file runs FLDEFF_POKECENTER_HEAL, whose monitor shares the glow's palette) and `special EnterHallOfFame` → `OverworldScene.enterHallOfFame`:
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
  The back (BufferTextForCardBack at init, PrintAllOnCardBack when flipping): the name, the Hall of Fame debut once
  GAME_STAT_ENTERED_HOF is set, the link battle / trade / Berry Crush / Union Room lines only when not 0 (so never,
  without link play), DrawCardBackStats (their end tiles), the photo's mon icons (VAR_TRAINER_CARD_MON_ICON_*, mail
  species, tinted by VAR_TRAINER_CARD_MON_ICON_TINT_IDX: LoadMonIconGfx puts the icon palettes in BG palettes 5-10
  and the tiles at BG3 tile 224 + 16 * i; trainerCardGfxSymbols preloads those icons) and the Four Island stickers
  (the brag vars; palettes 11-14, tiles at 320). BG3 tilemap entries leave out its baseTile (192): badges 192+,
  icons 224+, stickers 320+. The flip (FlipTrainerCard → Task_DoCardFlipTask, one step a frame): hide BG1/BG3, the
  card closes 7 lines a frame from each edge to 77 (UpdateCardFlipRegs: WIN0V and the BLDY darkening), the other
  side is drawn, then it opens 5 lines a frame. HBlankCB_TrainerCard's per-line BG0VOFS is modelled as an HBlank
  DMA table (gba/hw.ts `hblankRegs` on `gScanlineEffectRegBuffers[1]`, which VBlankCB_TrainerCard copies buffer 0
  into while `allowDMACopy`), not a real HBlank callback: the PPU runs callbacks only for the frames the host draws,
  so a register written per line could be left mid-flip when the flip ends between two drawn frames. Input as in
  the C: A on the front flips, on the back B flips back and A closes; B on the front closes. Probe
  `__test.trainerCard()` (mainState, `ready` / `backReady`, `onBack`, `flip` while the flip task runs (step,
  cardTop, BLDY, the per-line offsets), the stars and badges it has and the ones drawn on BG3, the back's icons and
  stickers drawn on BG3 and BG palette 5, which card palette is in the hardware palettes, the female background,
  the pic's pixel count, what each side printed, decoded). Tests: tests/e2e/trainerCard.test.ts (front, back, the
  flip both ways, closing from each side, the photo and stickers), tests/unit/trainerCard.test.ts (the stars).
- **Evolution scene:** `menus/evolutionScene.ts` + `menus/evolutionGraphics.ts` run on whichever GBA host is up
  (BattleScene after TryEvolvePokemon, FieldMenuScene from the party menu) and hand back through
  `gCB2_AfterEvolution` (`setCB2_AfterEvolution`). It draws on the battle BG/window layout, so the field host
  needs the battle text setup too (`initBattleMessages`, `setBattleTextSpeed`). `menuGfxSymbols` preloads the
  scene's graphics plus the pics/palettes/icons of every species the party can evolve into
  (`evolutionTargetSpecies`). Tests wait for the `evolution` event (`from`, `to`, `stopped`). Its sounds: "Scene sounds".

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
  **Sounds:** every anim file calls `gba/sound.ts` directly, as the C does: PlaySE12WithPanning (and PlaySE1 / 2
  WithPanning, PlaySE) with the pan BattleAnimAdjustPanning / BattleAnimAdjustPanning2 give (SOUND_PAN_ATTACKER
  -64 .. SOUND_PAN_TARGET 63, negated for the opponent's side), SE12PanpotControl from `setpan` and the panse
  task, PlayCry_ByMode with the C's species and CRY_MODE_* (soundTasks.ts), and audio/m4a.ts's m4aMPlayStop /
  m4aMPlayAllStop / m4aMPlayVolumeControl. **Waits:** `end` waits for IsSEPlaying up to 90 frames
  (sSoundAnimFramesToWait), then stops SE1 / SE2; `waitsound` waits for the sound tasks, then the same way. So an
  anim whose SE outlasts its visuals ends in the frame after the SE's last tick (an SE started in frame s that
  lasts n engine ticks: frame s + n). gMovesWithQuietBGM (read from the anim ROM image) sets the BGM to 128 at
  launch; `end` sets 256. special.ts: the ball SEs, and the caught click's m4aMPlayAllStop + PlaySE(MUS_CAUGHT_INTRO).
  Tests: tests/e2e/audioBattleAnims.test.ts (`__test.audioEvents`: Tackle's pan from both sides and its end on the
  SE's end, Growl's two cries, Perish Song's BGM volume, a Master Ball's SEs and the jingle).

## Audio

The plan is [AUDIO_PLAN.md](../AUDIO_PLAN.md): the m4a engine ported to TypeScript (`src/audio/`), fed from
`public/gen/audio/`.

### Audio data: songs

- **Where:** `tools/extract_audio.py` (`extract_audio(decomp, out)`, the "audio songs" step of `npm run extract`)
  writes `public/gen/audio/songs.json`. It builds the decomp's own `tools/mid2agb` with `$CXX` (default `c++`) and
  the Makefile's CXXFLAGS minus `-Werror` into `tools/.bin/mid2agb` (gitignored; rebuilt only when a source, header
  or the Makefile is newer), runs it on every `midi.cfg` line whose `.mid` exists (347; the 52 `ph_*` / `se_card*`
  lines have no file) with that line's flags, into a temporary directory, and assembles the `.s` files with a small
  Python assembler (`Assembler`: labels, `.byte` / `.hword` / `.word`, `.equ` / `.set` / `.equiv`, GNU as
  expressions and precedence with C division, `.include`, `.section` / `.align` / `.space` / `.end`; anything else
  is an error). `sound/MPlayDef.s`'s symbols are read once and its `.include` skipped per song. No compiler: extract
  stops with what to install.
- **Shape:** `{ players: [{name, tracks}], songs: [{id, name, ms, me, priority, reverb, blockCount, voicegroup,
  tracks, data}] }`. `players` is gMPlayTable (music_player_table.inc) in order. `songs[id]` is gSongTable
  (song_table.inc): `ms` / `me` are the entry's two music player numbers; `priority`, `reverb` (`0x80 | -R`, i.e.
  178 for `-R50`) and `blockCount` are the SongHeader's bytes, `voicegroup` its voicegroup symbol
  (`voicegroupNNN`, resolved by W-audiodata 2's voicegroups.json), `tracks` the track pointers as byte offsets into
  `data`; `data` (base64) is everything mid2agb puts before the header, with every pointer inside (GOTO, PATT) a
  little-endian u32 byte offset into that same `data` (the ROM has absolute addresses there). A table entry on
  `dummy_song_header` would get an empty song (FRLG has none). Every track ends in FINE; a looping one has its
  GOTO a few bytes before it (mid2agb writes what follows the `]` marker), so don't assume GOTO is last.
- **Test:** `tests/unit/audioSongs.test.ts` (players, 347 songs with ids = SE_* / MUS_* from scripts.json, known
  priorities, se_select's bytes, and a command walker over every track: FINE at its end, 77 looping songs,
  3,088 pointers inside the data). Rerun just the songs with
  `python3 -c "import sys; sys.path.insert(0, 'tools'); from pathlib import Path; from extract_audio import
  extract_audio; extract_audio(Path('../pret/firered'), Path('public/gen'))"` (~1.5 s; the first build of mid2agb
  adds ~1.5 s).

### Audio data: voicegroups and samples

- **Where:** `tools/extract_audio_voices.py` (`extract_audio_voices(decomp, out)`, the last line of
  `tools/extract.py`'s main; ~0.2 s) → `public/gen/audio/voicegroups.json` (1.2 MB), `samples.json` (45 KB),
  `samples.bin` (3.7 MB), `waves.json` (1 KB). Its docstring lists every macro and byte.
- **voicegroups.json:** `{ voicegroups: { voicegroupNNN: [voice | null] }, voicegroupSizes: { name: voices the
  source defines }, keysplits: { KeySplitTableN: [128 subgroup indices | null] }, cries: [388 voices],
  criesReverse: [388 voices] }`. A voice is struct ToneData's bytes as `asm/macros/music_voice.inc` emits them:
  `type` (0x00 / 0x08 no-resample / 0x10 reverse / 0x20 compressed (cries) / 0x30; CGB 1-4, +8 for `_alt`;
  0x40 keysplit; 0x80 rhythm), `key`, `length`, `panSweep`, `attack`, `decay`, `sustain`, `release`, and in place
  of the `wav` word one of `sample` (a samples.json name), `wave` (a waves.json name), `duty` (squares) or `period`
  (noise), or `subgroup` (a voicegroup name) + `keysplit` (a table name, `null` for 0x80 rhythm sets).
  Read it the way ply_note reads the ROM:
  - **Voicegroups run on into the next one.** ply_note indexes `voicegroup + 12 * n` without a bound, and the
    source defines many voicegroups with fewer than 128 voices (`voicegroupSizes`), so each list is the 128 voices
    from its label on, through the following voicegroups (cry_tables.inc is `.include`d between voicegroup128 and
    voicegroup129, so the cry voices sit in that run too, out of every window's reach). `null` = past the end of voice_groups.inc (only
    voicegroup190, from index 88: the ROM has keysplit table bytes there).
  - **Keysplit subgroups have 256 entries** (voicegroup003-007): a keysplit table entry is a u8.
  - **Keysplit tables are indexed by the MIDI key** (the `. - 36` label offsets applied). Every table maps keys
    36-107 (KeySplitTable4 from 24); outside that, the entries are the ROM's neighbouring bytes (the next table, or
    below KeySplitTable1 the end of voice_groups.inc, past KeySplitTable5 the programmable waves), `null` where
    that byte is part of a pointer. Values there can be up to 255.
  - **CGB voices:** the macros put the pan byte (`0x80 | pan`, or 0) in `length`, and square 1's sweep in
    `panSweep`; ADSR are masked to 3/3/4/3 bits. No CGB voice in FRLG has a pan.
  - Rhythm (0x80) voices index their subgroup by the key; a resolved voice that is itself 0x40 / 0x80 plays
    nothing (ply_note).
- **samples.json / samples.bin:** `{ <label>: { freq, loop, loopStart, size, offset } }`, the labels of
  `sound/direct_sound_data.inc` (`DirectSoundWaveData_*`, `Cry_*`), the fields of struct WaveData as
  `tools/wav2agb -b` writes them: `freq` = the WAV's `agbp` chunk (rate × 1024: 13379 × 1024 for most
  instruments, 10512 × 1024 for cries), `loop` = the `smpl` loop, `loopStart`, `size` = the `agbl` chunk.
  samples.bin holds signed 8-bit PCM (u8 − 128), each sample 4-byte aligned at `offset` and `size + 1` bytes long
  (wav2agb writes the smpl loop end's worth, `agbl` is one less; the mixer's interpolation may read that byte).
  The cries are DPCM-compressed in the ROM (type 0x20 / 0x30); here they are the decoded PCM, so the engine must
  not decode them (AUDIO_PLAN decision 4).
- **waves.json:** `{ ProgrammableWaveData_N: [16 bytes] }` (32 4-bit samples, high nibble first).
- **Cries:** `cries[SpeciesToCryId(species)]` (gCryTable), `criesReverse` the same with type 0x30.
- **Tests:** `tests/unit/audioVoices.test.ts`: every reference resolves, every sample fits samples.bin, the cry
  count (CRY_CHIMECHO + 1), spot values from the sources; "every song's voicegroup resolves" skips until
  `songs.json` (W-audiodata 1) is there. Checked once by hand against the decomp's own wav2agb (built to a
  scratch dir): all 89 instrument headers and bytes identical to `wav2agb -b`, and all 388 cries identical to the
  decoded `wav2agb -b -c -l 1 --no-pad` output.

### m4a engine

- **Where:** `src/audio/m4a.ts` (m4a.c + m4a_1.s, named as the C: m4aSoundInit, m4aSoundMain, MPlayMain,
  MPlayStart, the ply_* commands incl. ply_note, ChnVolSetAsm, MidiKeyToFreq, the m4aSongNum* / m4aMPlay*
  controls, gMPlayInfo_BGM / SE1 / SE2 / SE3, gPokemonCryMusicPlayers, the cry song and its setters,
  `setVoiceData`), `m4aMixer.ts` (SoundMainRAM: the DirectSound envelopes, sample positions and the mix; see
  "m4a mixer" below),
  `m4aCgb.ts` (gCgbChans, CgbSound and the PSG: see "PSG frames" below), `soundRegs.ts` (the sound registers),
  `m4aVoices.ts` (voicegroups / samples / waves
  JSON → ToneData / WaveData), `m4aInternal.ts` (m4a_internal.h: the structs and constants), `m4aTables.ts`
  (gClockTable, gPcmSamplesPerVBlankTable, gScaleTable, gFreqTable, gPokemonCrySongTemplate), `songTable.ts`
  (`loadSongTable(json)`: songs.json → gSongTable, checks the players against gMPlayTable, returns `idByName`). Pure logic: no DOM, no AudioContext, no clock; module
  globals like the C's (call `m4aSoundInit()` to reset everything). Structs are plain objects with the C's field
  names and ranges (u8 / s8 / u16 masked on write); a track's `data` is its song's bytes and `cmdPtr` /
  `patternStack` are offsets into them.
- **A frame:** `m4aSoundMain()` → SoundMain → `MPlayMain(head)`. Each MPlayMain first calls the next player in the
  chain, so although MPlayOpen puts the newest player at the head (cry 1, cry 0, SE3, SE2, SE1, BGM), the work runs
  oldest first: BGM, SE1, SE2, SE3, cry 0, cry 1 (it matters for channel stealing, W-m4a 2). Per player, unless
  paused: FadeOutBody; `tempoC += tempoI`; while `tempoC >= 150` a tick (per live track: gate times, the first
  tick's reset, commands until a wait with running status, `wait--`, the LFO), after which `status` = the tracks
  live at the start of that tick; a tick with none sets `status = MUSICPLAYER_STATUS_PAUSE`. So the TRACK bits
  clear one *tick* after the last FINE: the next frame at 150 BPM, the same frame above it (MUS_LEVEL_UP), up to
  two frames later below it (SE_DOOR). `status` is 0 between MPlayStart and the first tick (frame N's VBlank for a
  song started in frame N's logic), so `IsSEPlaying` is FALSE until then, as on the GBA.
- **Seams:** notes (`ply_note`) parse key / velocity / extra gate and set the track's gate time, then stop where
  the asm looks up the voice (`_081DDB46`): W-m4a 2 adds the voice lookup and channels there (or replaces
  `gSoundInfo.plynote`), fills `ChnVolPitUpdate` (MPlayMain's per-channel volume / pitch), `SongHeader.tone` from
  the voicegroup, and the cry songs. The channel loops (gate times, TrackStop, ply_fine, ply_endtie, RealClearChain)
  are ported and walk an empty list until then. `SoundMain` runs CgbSound ("PSG frames" below), then
  SoundMainRAM (the mixer, "m4a mixer" below); `ply_port` writes the sound registers (soundRegs.ts).
- **Hooking in:** see "sound.c" below: the boot loads the songs and calls `m4aSoundInit()`, AgbMainFrameEnd runs
  `m4aSoundMain()` once per frame; gba/sound.ts calls the m4a* functions on the gMPlayInfo_* players.
- **Voices:** `setVoiceData(voicegroups, samples, waves, pcm?)` (m4a.ts) takes the parsed voicegroups.json,
  samples.json and waves.json (and optionally samples.bin as a Uint8Array / ArrayBuffer; `setSamplePcm(pcm)` adds it
  later) and returns the built `VoiceData`. It sets every song's `SongHeader.tone` to its voicegroup (also for a
  song table installed afterwards: `setSongTable` applies it), and `gCryTable` / `gCryTable_Reverse`. ToneData.wav
  is a WaveData (DirectSound), the duty / noise period (a number), the wave bytes, or the subgroup (keysplit /
  rhythm); `keySplitTable` is the JSON's table. WaveData.type is 1 for the `Cry_*` samples (compressed in the ROM:
  SoundMainRAM_Unk1 checks it), the loop flag is `status`'s 0xC000. Only the headers matter to the logic.
- **Notes and channels:** `ply_note` (m4a_1.s:1538) resolves the voice (keysplit: the subgroup voice at
  keySplitTable[key]; rhythm: subgroup[key] at that voice's own key, its pan as rhythmPan; a resolved keysplit /
  rhythm voice is silent), the priority (player + track, ≤ 255), then a channel: a CGB voice claims its PSG channel
  (`gSoundInfo.cgbChans[type & 7 - 1]`) unless that plays a higher priority, or the same priority from a lower
  track; a DirectSound voice takes the first free of the 5 channels, else the released channel of lowest priority,
  else the playing one of lowest priority ≤ its own. Ties go to the channel whose track is at the highest address:
  `MusicPlayerTrack.addr` ranks the tracks as IWRAM has them (BGM < SE1 < SE2 < SE3 < the cry tracks); a playing
  channel of equal priority is only taken from a track at the same or a higher address, so the BGM can't steal from
  an SE of its own priority. Since the players run oldest first, an SE's note in the frame the BGM's runs wins.
  `ChnVolPitUpdate` (MPlayMain's VOLCHG / PITCHG pass) and `ChnVolSetAsm` set the channel volumes and frequency.
- **A channel's life:** SoundMainRAM (`m4aMixer.ts`, after the sequencers and CgbSound in the same frame) starts a
  START channel (ATTACK, its sample from the start offset, the WaveData's loop flag), steps the envelope once per
  frame (attack +n to 255, decay ×n/256 to sustain, release ×n/256 to the echo volume, then pseudoEchoLength
  frames), and moves the sample over the frame's 224 output samples (`fw += divFreq × frequency`, 2^23 per sample;
  FIX voices one per output sample; reverse voices from the end) to its loop or its end. A channel that ends
  (release done, sample out) gets statusFlags 0 there; the track unlinks it in its next tick (MPlayMain's
  ClearChain), so `IsPokemonCryPlaying` turns false the frame after. `FastForward` takes a frame's steps in one go
  when the sample doesn't end in it (exact: see its comment), used only when nothing is mixed.
- **Cries:** `gPokemonCrySong` (the template's byte image, m4aInternal's CRY_SONG_* offsets), the setters
  `SetPokemonCryVolume / Panpot / Pitch / Length / Release / Progress / Chorus / Priority / Stereo`,
  `SetPokemonCryTone(tone)` (a free cry player, else the one with the highest clock; returns it) and
  `IsPokemonCryPlaying(mplayInfo)`. sound.c's PlayCryInternal (W-sound 2) calls them in that order with a
  `gCryTable[SpeciesToCryId(species - 1)]` entry. Lifetimes for section 2's species and modes are pinned in
  tests/unit/m4aChannels.test.ts (they equal AUDIO_PLAN's estimates, e.g. Charizard NORMAL 56 frames, Jynx
  NORMAL 135, any species DOUBLES ≤ 21).
- **CGB channels:** a CGB note's channel lives from its START through CgbSound's envelope, release and pseudo
  echo ("PSG frames" below); ply_note only takes it while it isn't playing a higher-priority note, so a released
  one is free. IsSEPlaying and the other waits read the tracks, not the channels.
- **Hooking in:** W-sound 1 calls `m4aSoundInit()`, `loadSongTable()` and `setVoiceData()` at boot and
  `m4aSoundMain()` once per frame (AUDIO_PLAN.md section 4, "The tick"); gba/sound.ts calls the m4a* functions on
  the gMPlayInfo_* players.
- **Tests:** `tests/unit/m4a.test.ts`: hand-assembled songs (a small assembler with labels: `W(24)`, `N(12)`,
  `GOTO, R('loop')`) for tempo and ticks, waits, GOTO / PATT / PEND / REPT / xWAIT, the one-tick-late status,
  the chain order (through MEMACC), MPlayStart's priority rule, pause / continue, fades (FadeOut stops after 16 ×
  speed frames, FadeOutTemporarily pauses after 17 × speed: its TEMPORARY_FADE bit makes fadeOV 257), volume / pan
  / pitch control, the loader; then on songs.json (skipped without it): 270 songs end and 77 loop, and the FINE /
  stop frames of a table of SEs and fanfares (SE_SELECT 10 / 11 ... MUS_POKE_FLUTE 3,061 / 3,063).
  `tests/unit/m4aChannels.test.ts`: hand-built voices and samples for MidiKeyToFreq, envelopes frame by frame, a
  sample's end and loop, FIX / reverse voices, EOT / FINE, stealing (5 channels, priorities, track order, released
  channels, the CGB claim), keysplit / rhythm resolution, the cry song; then on the extracted voices: setVoiceData,
  voicegroup000's keysplit / rhythm voices, no song reaching a null keysplit entry, the cry lifetime table, a cry
  stealing from MUS_PALLET.

### m4a mixer

- **Where:** `src/audio/m4aMixer.ts` (SoundMainRAM and SoundMainRAM_Unk1, m4a_1.s:88-680), `m4aSoundVSync` and
  `m4aPcmFrame` in `m4a.ts`, the per-frame call in `audio/frame.ts`. Each frame: the reverb pass over this
  frame's slot of `gSoundInfo.pcmBuffer` (or its clearing), then per DirectSound channel the envelope and the
  frame's 224 samples: `data[cur]` interpolated toward `data[cur + 1]` by `fw >> 23` (FIX voices: no step, so no
  interpolation; reverse voices read backwards), × envelopeVolumeRight >> 8 into FIFO A (right, `pcmBuffer`) and
  × envelopeVolumeLeft >> 8 into FIFO B (left, `pcmBuffer + PCM_DMA_BUF_SIZE`), added with 8-bit wraparound (the
  asm's byte lanes: no clipping). The master volume is in the envelope volumes.
- **The DMA ring:** pcmBuffer holds pcmDmaPeriod (7) slots of 224 samples per FIFO. `m4aSoundVSync` (VCountIntr)
  counts pcmDmaCounter down and reloads it at 0; `PcmSlotOffset` gives the slot SoundMain mixes into
  (slot period + 1 − counter, 0 for a counter ≤ 1), which the DMA plays the next frame. The reverb (the song
  header's `reverb`, usually 50, set by MPlayStart through m4aSoundMode) rewrites each sample of the slot as
  (this slot's A + B, mixed 7 frames ago, + the next slot's A + B, 6 frames ago) × reverb >> 9, +1 when bit 7 is
  set, in both FIFOs (a mono echo).
- **Mono:** FRLG's mixer never reads `soundInfo.mode` bit 0; SetPokemonCryStereo sets `gRegSoundCntH`
  (REG_SOUNDCNT_H: SOUNDCNT_H_STEREO, or SOUNDCNT_H_MONO = both FIFOs to both speakers at half volume), which
  `m4aPcmFrame` hands to the output's DAC (`frameToDac`). The bit itself is CgbModVol's (the PSG channels on both
  sides). Callers: SetTitleScreenScene_Cry after LoadGameSave (`titleScreenEnv.savedOptionsSound`, from
  MainMenuScene), CloseAndSaveOptionMenu (`state.optionsSound`). Dev starts that skip the title keep SoundInit's
  stereo.
- **On / off:** `m4aSetMixing(on)`: AgbMainFrameEnd sets it from `audioOutputWantsFrames()` each frame and pushes
  the frame only then. Off (headless, `?audio=0`, the output not running yet), SoundMainRAM clears the slot and
  runs only the bookkeeping (FastForward where it can); every channel's envelope, count, fw and position come
  out the same (unit-tested over MUS_TITLE, SEs and cries). A channel whose WaveData has no PCM yet (samples.bin
  loads in the background, `audioData.ts`, only when the output is on) also only advances.
- **Hearing it:** `npm run dev`, open http://localhost:5173/ (the output is on by default; `?audio=1` forces it),
  press a key (the browser's autoplay rule): the title screen plays MUS_TITLE; M mutes. The PSG parts (squares,
  wave, noise) play through the output's synth ("PSG synth" below). Headless: `npx vite-node tools/render-audio.ts
  MUS_PALLET 1200 out.wav [mono] [nopsg]` renders a song (comma-separated names start together) to a 53,516 Hz WAV
  of what the speakers get, and prints its RMS (`tests/audioRender.ts` does the loading and the frame loop).
- **Tests:** `tests/unit/m4aMixer.test.ts`: a FIX note's block against hand-computed values (floor(vol × s / 256),
  the end mid-frame), a resampled note's interpolation (2^22 + 326 steps), the envelope frame by frame (attack,
  release), 8-bit wraparound, the slot order, the reverb's echoes 6 and 7 frames after an impulse (and their
  echoes, rounding for negatives), mono routing through the DAC, the bookkeeping with the mixing on and off (hand
  and real data); on public/gen/audio: MUS_TITLE (1,200 frames: 268,800 samples per FIFO, RMS 18.0, peak 106, silent
  for the 30 frames before it starts), MUS_PALLET (RMS 9.6), SE_SAVE (sounds, silent from 42 frames after its
  start), a cry and its reverse, SE_SELECT silent (PSG). `tests/e2e/audioOutput.test.ts`: with `?audio=1` the
  title's frames reach the worklet with a non-zero peak.

### PSG frames (CgbSound)

- **Where:** `src/audio/m4aCgb.ts` (m4a.c: CgbSound, CgbModVol, CgbPan, CgbOscOff, MidiKeyToCgbFreq; gCgbChans as
  MPlayExtender sets them up), `src/audio/soundRegs.ts` (the sound registers, the write log, the `PsgFrame` type and
  the register offsets: pure, the worklet can import it), the tables in `m4aTables.ts` (gCgbScaleTable,
  gCgbFreqTable, gNoiseTable, gCgb3Vol). The C's register writes go through `SoundRegWrite8/16/32`, its reads
  through `SoundRegRead8` (CgbSound reads back NRx2, NR10, NR43, NR51 and SOUNDBIAS_H, all readable as written).
- **Who writes:** m4aSoundInit (first `resetSoundRegs()`: the BIOS's power-on state, SOUNDBIAS 0x200), SoundInit
  (SOUNDCNT_X 0x8F, SOUNDCNT_H, SOUNDBIAS_H 0x42), MPlayExtender (SOUNDCNT_X, SOUNDCNT_L 0, NR12 / NR22 / NR42 8,
  NR14 / NR24 / NR44 0x80, NR30 0, NR50 0x77), m4aSoundMode (SOUNDBIAS_H's resolution), SetPokemonCryStereo
  (SOUNDCNT_H), ply_port (no FRLG song has one), TrackStop's CgbOscOff (the game logic: m4aSongNumStop,
  m4aMPlayStop / AllStop, a song replacing another), and CgbSound in each frame's SoundMain.
- **CgbSound per frame** (between the sequencers and SoundMainRAM): a START channel gets ATTACK, CgbModVol (goal
  (left + right) / 16, clamped to 15 only when hard-panned; sustain goal; NR51 bits: one side when one volume is at
  least twice the other, both in mono), the note's setup writes (square 1's NR10 sweep (8 = none), NRx1 duty << 6 +
  length, the wave's RAM when the wave changed: NR30 0x40, 16 bytes, NR30 0; NR31; the noise's NR41 and NR43 width
  bit), then the software envelope: +1 per `attack` frames to the goal, −1 per `decay` frames to the sustain goal,
  the sustain (re-read every 7 frames), −1 per `release` frames after STOP, then the pseudo echo (the track's
  xIECV volume for xIECL frames), then CgbOscOff. c15 makes every 15th frame step twice (the hardware envelope's
  64 Hz). On a pitch change NRx3 / NRx4 (no restart); on a volume change NR51, NRx2 (the envelope's direction and
  step time with the new volume) and NRx4 | 0x80 (a restart; square 1 twice with a rising sweep), or for the wave
  NR32 from gCgb3Vol and, on its first, NR30 0x80 and NR34 with the restart. Between those writes the hardware
  envelope (NRx2's step time) does the steps the software only counts.
- **The frame** (`m4aPcmFrame().psg`, taken in AgbMainFrameEnd every frame, pushed only when the output wants
  frames): `{ writes: Uint16Array, state: Uint8Array }`. `writes` are all the writes since the previous frame in
  order, each `offset << 8 | value`, offsets from REG_SOUND1CNT_L 0x4000060: NR10 0x00, NR11 0x02, NR12 0x03,
  NR13 0x04, NR14 0x05, NR21 0x08, NR22 0x09, NR23 0x0C, NR24 0x0D, NR30 0x10, NR31 0x12, NR32 0x13, NR33 0x14,
  NR34 0x15, NR41 0x18, NR42 0x19, NR43 0x1C, NR44 0x1D, NR50 0x20, NR51 0x21, SOUNDCNT_H 0x22-0x23, NR52 0x24,
  SOUNDBIAS 0x28-0x29, wave RAM 0x30-0x3F (`PSG_*` in soundRegs.ts). A wave RAM write goes to the bank NR30 bit 6
  does *not* play at the time of the write (so CgbSound's NR30 0x40, bytes, NR30 0 loads bank 0 and plays it).
  `state` (`PSG_STATE_SIZE` 0x50 bytes) is the register file before `writes`: 0x00-0x2F as above, then wave RAM
  bank 0 (0x30) and bank 1 (0x40): latched values, no events. In the worklet message: `psg` (the writes' buffer),
  `psgState`.
- **The synth** ("PSG synth" below) replays `writes` in order as the hardware takes them (GBATEK "Sound Channel
  1-4"): NRx4 bit 7 restarts a channel, NRx2's upper five bits are its DAC, NR30 / NR32 the wave's bank and volume,
  NR43 the noise's clock and width, then NR50 / NR51 / SOUNDCNT_H / NR52 for the mix.
- **Gotchas for the synth:** (1) Timing: CgbSound writes in VBlank, which takes effect at once, but the DirectSound
  mix made in the same SoundMain plays in the *next* frame: on the GBA the PSG leads the FIFOs of the same frame by
  one frame, so apply a frame's `writes` one frame before the PCM it arrives with plays (or hold the PCM back one
  frame). Game-logic writes (CgbOscOff) come first in `writes` and happened earlier in the frame; applying them at
  the frame's start is close enough. (2) Starting mid-song (the output starts at the first key press, after boot's
  writes): load `state` first; channels triggered before then stay silent until their next restart (frequent:
  every volume change restarts). Load it again after dropping frames. (3) The CGB voices' length byte is their pan
  byte (music_voice.inc), so a voice with a pan gets a length (and NRx1 values whose top bits change the duty):
  apply them as written. (4) A frame can write the same register several times (NR14 twice, NR43 twice, NR30 three
  times): the order matters. (5) NRx2 = 0x08 (CgbOscOff) is volume 0 with the DAC on.
- **Tests:** `tests/unit/m4aCgb.test.ts`: MidiKeyToCgbFreq against the tables, the init writes in the C's order,
  wave RAM banking and the frame's state, SOUNDCNT_H from SetPokemonCryStereo, CgbModVol in stereo / mono, then
  frame by frame against m4a.c (worked by hand in the comments): a square note (attack, decay, sustain, release,
  pseudo echo, off; the track unlinks it a frame later), a rising sweep, square 2, a wave note (bank switch, NR32 per
  step, no reload for the same wave), a noise note, START with STOP, TrackStop's CgbOscOff, the echo's length; on
  public/gen/audio: SE_SELECT, MUS_ROUTE1's four channels, and the frame each PSG-only SE's channels go off
  (SE_SELECT 15, SE_DOOR 22, SE_EXIT 36, SE_PC_ON 68, SE_WALL_HIT 14, SE_FLEE 39).

### PSG synth

- **Where:** `src/audio/psgSynth.ts` (`PsgSynth`: the four PSG channels, the frame sequencer and the PSG's mix) and
  `src/audio/outputCore.ts`'s `SoundCircuit` (one frame at a time: the PSG writes, the FIFOs held back a frame, the
  DAC), shared by the worklet (`worklet.ts`) and the headless renderers (`tests/audioRender.ts`'s `speakers()`,
  `tools/render-audio.ts`). Pure: no DOM. Sources: GBATEK "Sound Channel 1-4" / "Sound Control Registers", Pan
  Docs "Audio Details", and mGBA's GB_AUDIO_GBA mode (`src/gb/audio.c`, `src/gba/audio.c`) where those leave the
  GBA open (its sweep and envelope edge cases follow mGBA's `_updateSweep` / `_updateEnvelopeDead`, rewritten,
  not copied); poryaaaa's `m4a_channel.c` (MIT) was read for the m4a side, nothing taken from it.
- **A frame** (`SoundCircuit.frame`): if the frame's `state` isn't what the writes so far left (the first frame,
  after a `reset()`, or frames missed) `loadState(state)` (registers latched, every channel off); then each write
  in order at the frame's start (`PsgSynth.write`: NRx4 bit 7 restarts, NRx2 bits 3-7 are the DAC, NR30's bank and
  64-sample mode, NR52 bit 7 resets NR10-NR51); then `render` plays 280,896 cycles as 896 samples. Each sample:
  the frame sequencer's steps (512 Hz: lengths at 0/2/4/6, square 1's sweep at 2/6, envelopes at 7; through the DAC
  each on its own cycle, a step on a tick's cycle before the tick; the box filter steps at the sample boundaries)
  and the DAC's point samples (every 0x200 >> SOUNDBIAS's resolution = 256 cycles, 65,536 Hz, as the GBA and mGBA: each
  channel's level at that cycle, held to the next tick; `dacInterval`, set by SoundCircuit) averaged over the
  sample's 313.5 cycles (channel levels 0-15: squares 16 × (2048 − f) cycles a duty step, the wave 8 × (2048 − f) a
  sample, noise 32 or 64r << s cycles an LFSR clock), routed by NR51, × 8 × (NR50 + 1), / 4, 8 or 16 by SOUNDCNT_H's
  share (a channel at 15 adds 240 at 100%). Point sampling matters for fast noise (NR43 0x00: a 524 kHz clock): a
  plain average over the sample cancels it out, the GBA's DAC aliases it at full level (W-ref 2: SE_FLEE was 10 dB
  down in its noise frames). `PsgSynth.render` with `dacInterval` 0 is the plain average (the hand-worked tests). The circuit adds the previous frame's FIFO
  samples (×4 / ×2 by SOUNDCNT_H, the register as it stands now) and goes through `dacOutput(level, SOUNDBIAS)`.
- **Behaviour worth knowing:** PSG levels are unsigned (a sounding channel adds DC, as on the GBA); a square's duty
  position free-runs (a restart doesn't move it; from power-on its timer counts 16 × 2048 cycles); the wave RAM
  rotates as it plays and a restart keeps the position (fresh RAM written by CgbSound starts at its first sample);
  the sample after a restart is the one that was playing, for a period + 24 cycles (`WAVE_RESTART_DELAY`: mGBA,
  SameBoy); noise restarts its LFSR at 0 (XNOR feedback, output = the
  feedback bit); a stopped channel outputs 0. docs/DEVIATIONS.md has what is approximated.
- **Hooking in:** nothing to do for new sounds: everything the engine writes is played. To render: `speakers(render(
  frames, before), { psg })` (tests/audioRender.ts), `speakerRms` (AC RMS: the DC taken out), `toWav`.
- **Listening:** `npx vite-node tools/render-audio.ts SE_DOOR 60 /tmp/door.wav` (`mono`, `nopsg` flags), or `npm run
  dev`, any key, M mutes.
- **Tests:** `tests/unit/psgSynth.test.ts`: duty patterns and the free-running position, box averages, the envelope
  up / down / held, the DAC bits, the length counter and its reload, square 1's sweep (up, overflow, down, the
  restart check), the LFSR's first values (15 and 7 bits) and its clock, the wave's samples, volumes, banks and
  restarts and the restart's 24-cycle delay, the sequencer's steps on their own cycle through the DAC, NR50 / NR51 /
  SOUNDCNT_H / NR52, the circuit (the FIFOs a frame late, resync after a missed frame, no
  PSG part); on public/gen/audio: the PSG-only SEs heard from their first frame to the one before CgbOscOff
  (SE_SELECT 0-13 ... SE_FLEE 0-37), MUS_PALLET / MUS_TITLE's PSG part, mono (L = R) and stereo.
  `tests/e2e/audioOutput.test.ts`: SE_SELECT alone reaches the worklet's speakers.

### ROM reference measurements

Frame counts measured on the user's FireRed ROM (rev 1) in mGBA, pinned against the engine in
`tests/unit/m4aRom.test.ts` (W-ref 1; AUDIO_PLAN.md decision 15: frame counts may go into tests, nothing read from
the ROM may). The ROM's path is in AUDIO_PLAN.md section 6 "W-ref" only; the scripts live outside the repo. To redo
or extend them:

- **mGBA:** `brew install --cask mgba-app` (0.10.5). Its Qt build has Lua scripting only through the GUI, so drive
  it through its **GDB stub** instead: `mGBA -C fpsTarget=100000 -C audioSync=0 -C videoSync=0 -C mute=1 -g <rom>`
  opens a window, waits on port 2345 and runs ~360 frames a second when let go. A small Python client for the GDB
  remote protocol (`m` / `M` memory, `g` / `P` registers, `Z0` / `z0` breakpoints, `c`) does the rest. Each stop
  costs ~60 ms, so stop per frame only where needed (cries) and use code breakpoints as events otherwise.
- **Addresses:** no symbol file for rev 1, so find them by pattern search in the ROM: gMPlayTable (four 12-byte
  entries with 10 / 3 / 9 / 1 tracks), gSongTable (songs.json's ms / me pairs), m4aSongNumStart (the literal pool
  holding both), m4aSoundMain (the function before it; VBlankIntr's `bl` to it gives gMain from its pool),
  gMPlayJumpTableTemplate (pointers to ply_fine's bytes) for ply_fine / ply_goto, MPlayMain's
  `status = MUSICPLAYER_STATUS_PAUSE` store by its bytes, PlayCry_ByMode / PlayCryInternal through the `movs r2,
  #85; bl m4aMPlayVolumeControl` ducking calls in sound.c, gMPlay_PokemonCry from PlayCryInternal's pool. Capstone
  (`pip install capstone` in a venv) disassembles Thumb.
- **Method:** break on m4aSoundMain's entry for ~10 VBlanks after boot, then freeze the game (gMain.callback1 =
  NULL, callback2 = a lone `bx lr`) so only VBlankIntr runs. Write them on every frame for ~60 frames and check
  they stay: the boot code is still inside an init that sets callback2 itself when it returns, and a game that
  isn't frozen starts the intro's songs and the title's cry over the measurement 200-1,000 frames in (breaking on
  MPlayStart during a measurement catches that). To start a song or cry, at m4aSoundMain's entry set
  r0-r2, LR = m4aSoundMain and PC = m4aSongNumStart / PlayCry_ByMode, continue to the entry again and restore LR:
  the call lands right before that VBlank's m4aSoundMain, which is "frame 1" as the engine's tests count it, and
  frame k = gMain.vblankCounter2 − v0 + 1. Songs: breakpoints on ply_fine and ply_goto (r0 = player, r1 = track)
  and on the PAUSE store (r7 = player) give the FINE, loop and stop frames; ply_patt and MEMACC's true branch
  run ply_goto too, so count a GOTO only when the byte before the track's cmdPtr is 0xB2. Cries: stop on every m4aSoundMain
  entry and evaluate IsPokemonCryPlaying from memory (gMPlay_PokemonCry → tracks[0].chan → chan.track).
- **Revision check:** songs.json's 347 songs (all track bytes, with GOTO / PATT targets relocated, and the headers)
  and the 76 voicegroups the songs reach (every voice, keysplit table, sample header and instrument PCM) are found
  in the ROM byte for byte, so the decomp's audio data is rev 1's.
- **Test:** `tests/unit/m4aRom.test.ts` holds the numbers as data and runs the engine on them: 42 SEs and fanfares
  (FINE and stop frames), 10 looping songs (the frames of track 0's first three GOTOs, watched through
  `gMPlayJumpTable[1]`), 8 species' cries in 5 modes (IsPokemonCryPlaying) and the cry song's end per mode. To add
  a number, measure it the same way and add a row; a mismatch is an engine bug or a difference in what is counted.
- **W-ref 2: the output per frame, and the listening comparison** (scripts in `wref-scratch/wref2/`, outside the
  repos; results in AUDIO_PLAN.md section 6 "W-ref"). Same mGBA, freeze and start method. `capture.py` (through
  `run.sh`, which starts mGBA with `-C fpsTarget=100000 -C audioSync=0 -C videoSync=0 -C mute=1 -g`; set TCP_NODELAY
  on the socket) runs a job list (`jobs.py`: songs by id, `PlayCry_ByMode`, `SetPokemonCryStereo` at 0x081DE844,
  found by its literal pool with REG_SOUNDCNT_H and SOUND_INFO_PTR) and stops at every m4aSoundMain entry (~100 ms a
  frame: 900 frames ≈ 90 s) to read: SoundInfo's first 16 bytes (`*0x03007FF0`; pcmDmaCounter at +4, c15 at +10),
  the slot the previous frame mixed (`pcmBuffer` = SoundInfo + 0x350, slot from that frame's counter as
  `PcmSlotOffset`; FIFO B at + 1,584), the four CgbChannel structs (SoundInfo + 28 → 4 × 64 bytes) and the sound
  registers 0x4000060-0x40000AF as mGBA reads them back (write-only bits read 0: NRx3, NRx4's low bits; NR52's low
  bits are the channels' on flags; wave RAM is the bank not playing). Jobs end with the song's stop and 60 idle
  frames. `port_capture.ts` (run from the worktree: `npx vite-node --root /Users/joshua/Coding/PokemonProjects
  <path>`, since vite-node won't load a file outside its root) replays the same job list headless, syncing
  pcmDmaCounter and c15 to the ROM's at each start, and writes the same records plus each job's speakers WAV and
  PSG writes; `compare.py` compares them field by field (the registers through mGBA's read masks, NR52 against the
  port's synth's `on` flags). A one-frame shift shows up in every field (checked), so "identical" means identical.
  The listening part: mGBA's Qt app records only from its GUI and nothing headless is installed, so `mgba_model.py`
  renders a reference from the ROM's own FIFO bytes plus an independent model of mGBA's PSG (gb_audio.c /
  gba_audio.c's GB_AUDIO_GBA paths in `Scratch/mgba-ref`: point samples every 256 cycles, a stopped channel holds
  its level, the writes ~14,000 cycles into the frame) driven by the port's PSG writes; `analyze.py` compares it
  with the port's WAV after a 20 Hz DC blocker and a 20 kHz band limit; `make_page.py` builds `index.html`.
  Nothing from the ROM goes into the repo: only pass / fail facts and dB numbers the port computes itself.
- **W-ref 2b: making the listening comparison like for like** (same directory; AUDIO_PLAN.md "W-ref" has the
  numbers). The PSG's sound depends on phases nothing on the ROM shows (the frame sequencer's against the frames,
  the squares' duty positions), and with DirectSound playing related pitches a frame's RMS swings ±2 dB with them,
  so both sides must start from the same: `port_capture.ts` renders each job's WAV with a circuit reset at the job
  (its first frame's state loaded; a second circuit that runs on gives the records' NR52 bits, as the ROM's PSG
  runs on), and `mgba_model.render(label, write_at, seq_phase=32768, hw)` starts the sequencer 32,768 cycles in as
  the port's loadState. `hw=True` swaps mGBA's shortcuts for the documented hardware (the list is in
  docs/DEVIATIONS.md's PSG entry); with `write_at=0` it is what the port should be, and it equals the port at every
  DAC tick (`wref-scratch/wref2b/`: `port_tick.ts` records the port's channel levels at its ticks, `points.py` the
  model's, and compares them channel by channel; per-channel renders with NR51 masked: `port_chan.ts`, `exp.py`).
  `ref_all.py` renders both references (`ref/`: mGBA as is, `ref_hw/`), `analyze2.py <refdir>` compares through
  the port's output stage (the held 65,536 Hz reference averaged over each 313.5-cycle sample: brightness and
  level then measure the synth, not the output rate) and adds a sample-by-sample residual; `make_page.py` reads
  both. To check a synth change: rerun `port_capture.ts`, `analyze2.py ref_hw ...` (r ≥ 0.9998 and the PSG-only
  SEs' residual ≤ −32 dB today).
### Audio output

- **Where:** `src/audio/output.ts` (the AudioContext, the worklet node, autoplay, visibility, mute, `pushFrame`, the
  dev test tone, `audioOutputProbe`), `src/audio/worklet.ts` (the AudioWorkletProcessor), `src/audio/outputCore.ts`
  (pure: `decideOutput`, the message types, the DAC, `SoundCircuit`, `SampleHoldResampler`), `src/audio/psgSynth.ts`
  (the PSG, "PSG synth" below). Started by
  `startAudioOutput(listenForOutputKeys)` in `main.ts` and `battleTest.ts`; Phaser's own sound is off there
  (`audio: { noAudio: true }`). The keys: `listenForOutputKeys` in `input/Input.ts` (passed in, so output.ts loads
  without Phaser: testHooks imports it, and the unit tests import testHooks).
- **When it's on:** by default in a browser; off headless (navigator.webdriver or a `HeadlessChrome` user agent:
  the e2e harness's Chrome has webdriver false) and for `?speed=` > 1 (dev). `?audio=0` / `?audio=1` force it (any
  build), `?audio=tone` (dev) is on and plays the test tone. The AudioContext is created at boot; the browser holds
  it suspended until the first keydown / pointerdown anywhere (a capture listener on window, so typing in the
  battle test panel counts), which resumes it. Hidden tab: suspended; visible again: the worklet's buffer is
  flushed and it resumes.
- **pushFrame(frame)** (audio/frame.ts's AgbMainFrameEnd, once per frame after m4aSoundMain, with `m4aPcmFrame()`): `{ fifoA, fifoB, soundcntH?,
  psg? }`: the frame's 224 signed 8-bit samples per FIFO (A = `pcmBuffer`, B = `pcmBuffer + PCM_DMA_BUF_SIZE`),
  REG_SOUNDCNT_H (`SOUNDCNT_H_STEREO` by default, `SOUNDCNT_H_MONO` after SetPokemonCryStereo(0)) and `psg` (the
  PSG's register writes and state: "PSG frames" below). The FIFOs are copied into one transferable buffer, the PSG
  writes and state into two more (the message's `psg`, `psgState`), and posted on the node's port; a no-op while
  the output is off, suspended, loading or playing the tone. `audioOutputWantsFrames()` lets the
  mixer skip writing samples when nobody listens (never its bookkeeping). Nothing else may read the output's state
  (AUDIO_PLAN.md "Rules").
- **The worklet:** `SoundCircuit` turns each frame into speaker samples as the GBA does: the previous frame's FIFO
  samples (each routed FIFO ×4 (full) or ×2 (half)) plus the PSG, + SOUNDBIAS 0x200, clipped to 10 bits, the 2
  low bits dropped (SOUNDBIAS_H 0x40: 8-bit resolution), 4 samples per FIFO sample (896 a frame; `frameToDac` is
  the FIFOs-only DAC). `SampleHoldResampler` buffers them and plays them by sample-and-hold at 896 × 60 = 53,760 Hz
  (224 × 60 = 13,440 Hz for the FIFOs: docs/DEVIATIONS.md) in the context's rate: it starts once 3 frames are
  buffered, nudges its step by up to ±0.5% (0.5% per frame off) to keep the fill at 3.5 frames, plays silence on an
  underrun until 3 frames are back, and drops the oldest samples back to 3.5 frames when a push passes 7 (after a
  stall). A `flush` also resets the circuit (it picks up from the next frame's PSG state). It reports stats (frames, underruns, dropped, buffered, peak, rendered) every 64 render quanta.
- **Mute key M** (docs/DEVIATIONS.md "Deliberate QOL changes"): toggles the output only (the worklet writes zeros,
  the frames keep flowing); ignored with Ctrl / Cmd / Alt and in text fields; saved as
  `firered-phaser:audio-muted` in localStorage (try/catch). Works with the output off too (it is remembered).
- **Bundling:** `import workletUrl from './worklet.ts?worker&url'`: Vite serves it as a module in dev and builds it
  as its own chunk (`assets/worklet-*.js`, imports inlined) in `npm run build`.
- **Try it:** `npm run dev`, open `/` (or `/?audio=1`), press any key: the title screen's MUS_TITLE. `/?audio=tone`, press any key: a square wave alternating A4 / E5 every half
  second; M mutes it. In the console: `__test.audioOutput.state()`, `__test.audioOutput.tone(false)`. Same on
  `/battle-test.html?audio=tone`.
- **Tests:** `tests/unit/audioOutput.test.ts` (decideOutput, the DAC's stereo / mono / clipping values, the
  resampler's holds, rate nudge, start, underrun, overflow, and a simulated 60 Hz loop with drift and 30 Hz rAF);
  `tests/e2e/audioOutput.test.ts` (off headless; `?audio=1` suspended → running after a real key press
  (`game.realKey`); SE_SELECT alone (square 1) reaches the speakers; M toggles, survives a reload, not in a text field; the tone's peak 0.3125 = 40 / 128 reaches the
  speakers and M silences it: headless Chrome runs the audio graph on a fake device). Hooks:
  `__test.audioOutput` (`src/dev/audioOutputHooks.ts`). Harness: `query: { audio: '1' }` adds URL parameters.

### sound.c

- **Where:** `src/gba/sound.ts` is sound.c (the cries at the bottom, see "Cries" below): MapMusicMain and
  the map music helpers (PlayNewMapMusic, StopMapMusic, FadeOutMapMusic, FadeOutAndPlayNewMapMusic,
  FadeOutAndFadeInNewMapMusic, IsNotWaitingForBGMStop; overworld.c's BGMusicStopped and Overworld_ChangeMusicTo),
  fanfares (sFanfares, PlayFanfare / PlayFanfareByFanfareNum, Task_Fanfare, WaitFanfare, IsFanfareTaskInactive),
  PlaySE / PlaySE12WithPanning / PlaySE1/2WithPanning / SE12PanpotControl, PlayBGM / FadeInNewBGM / FadeInBGM /
  FadeOutBGM / FadeOutBGMTemporarily, IsSEPlaying / IsSpecialSEPlaying / IsBGMPlaying / IsBGMStopped /
  IsBGMPausedOrStopped. It is the one API the game calls; call it with song ids (`K.SE_SELECT`, `K.MUS_HEAL`).
  sFanfares names its songs and resolves them through the loaded song table.
- **The frame:** `src/audio/frame.ts`'s `AgbMainFrameEnd()` runs the sound tasks (Task_Fanfare,
  Task_DuckBGMForPokemonCry), MapMusicMain, then m4aSoundMain. Called once per logic tick by `OverworldScene.tick`
  (after PlayTimeCounter_Update) and `GbaHostScene.update` (every tick, also the one whose callbacks stop the
  host), which also runs BattleScene in the game and on battle-test.html. Only one host ticks at a time, so it runs
  exactly once per frame. Don't call it anywhere else. A new kind of host scene must call it once per tick.
- **Sound tasks:** Task_Fanfare is a gTask in the C; the field doesn't run gTasks every frame, so sound.ts keeps
  its own list (CreateSoundTask / FuncIsActiveSoundTask / DestroySoundTask, `RunSoundTasks` from the hook) with
  FuncIsActiveTask's meaning (AUDIO_PLAN.md decision 5). A task created in a frame runs in that frame's hook, as a
  priority-80 task created in CB1 runs in CB2's RunTasks.
- **Boot:** `src/audio/audioData.ts`'s `loadAudioData()` fetches songs.json (→ `loadSongTable`), voicegroups.json,
  samples.json and waves.json (→ `setVoiceData`) once (BootScene and battle-test's BattleTestBoot, in parallel with
  `Assets.init`). `AgbMainSoundInit()` (frame.ts: m4aSoundInit +
  sound.ts's ResetSoundState) runs before the first frame and again on a soft reset. When the output is on,
  loadAudioData also fetches samples.bin in the background (→ `setSamplePcm`); nothing waits for it.
- **Script commands** (script/ScriptEngine.ts): `playse`, `waitse`, `playbgm` (PlayNewMapMusic), `fadenewbgm`,
  `fadeoutbgm` (+ its IsBGMPausedOrStopped wait), `fadeinbgm`, `playfanfare`, `waitfanfare`, as scrcmd.c. The three
  waits go through `SetupNativeScript`, which keeps script.c's frames: the check starts the frame after the
  command, and the script goes on the frame after it holds. `savebgm`, `fadedefaultbgm` and `playbgm`'s save flag
  are overworld.c's (see "Map music").
- **Timing:** IsSEPlaying is FALSE in the frame an SE is started (the engine's first tick is that frame's hook) and
  turns FALSE after the song's last tick (tests/unit/m4a.test.ts pins the lengths). A fanfare holds for sFanfares'
  count + 1 frames (80 counts, then the frame that resumes the BGM); the song plays on to its FINE (MUS_EVOLVED's
  230 frames outlast its 220).
- **Cries** (sound.c:316-580): `PlayCry_Normal`, `PlayCry_ByMode(species, pan, CRY_MODE_*)`, `PlayCry_Script`
  (`playmoncry`, `showmonpic`), `PlayCry_NormalNoDucking` (Pokédex, credits), `PlayCry_ReleaseDouble`; all go through
  `PlayCryInternal` (the mode table → the engine's SetPokemonCry* setters → `SetPokemonCryTone(gCryTable[
  SpeciesToCryId(species - 1)])`, on a free cry player, gMPlay_PokemonCry). `SpeciesToCryId` is pokemon.c's, in
  `pokemon/Pokemon.ts` (cry_ids.h's Hoenn table comes from `pokemon/tables.json`, installed by PokemonData's
  constructor; before that only Gen I-II species, which are their own id). Normal / ByMode (not DOUBLES) / Script
  duck the BGM to volume 85 and start `Task_DuckBGMForPokemonCry` (a sound task): it waits 2 frames, then polls
  `IsCryPlaying` and restores 256. **Waits:** `IsCryFinished` = that task is gone (TRUE at once for a cry without
  it: NoDucking, DOUBLES); a cry started in frame 0's logic whose IsPokemonCryPlaying is FALSE after k hooks
  (AUDIO_PLAN.md section 2's ROM table: "frame k") makes IsCryFinished TRUE from frame k + 1's logic on, one
  frame later than IsCryPlaying (tests/unit/m4aRom.test.ts pins every ROM cry through the API). `IsCryPlaying` / `IsCryPlayingOrClearCrySongs`
  read the cry player; `StopCryAndClearCrySongs` pauses it. `ClearPokemonCrySongs` (main.c; IsCryFinished,
  IsCryPlayingOrClearCrySongs) zeroes the cry players' song bytes as the C does, which ends a cry song still in
  its xWAIT at its next tick (a 0 byte runs as XCMD 0 → ply_fine). The constants (CRY_MODE_*, CRY_VOLUME,
  CRY_PRIORITY_NORMAL) are sound.h's numbers in sound.ts (the title screen cries before the defines load),
  checked against the extracted ones by tests/unit/soundCries.test.ts. `waitmoncry` uses SetupNativeScript.
- **Text** (text/TextPrinter.ts, text.c's RenderText): A or B at a `\p` / `\l` / PAUSE_UNTIL_PRESS plays SE_SELECT
  (TextPrinterWait / _WithDownArrow); `{PLAY_SE}`, `{PLAY_BGM}` (PlayBGM: a fanfare song goes to its own SE2 player,
  as in the gym badge texts), `{WAIT_SE}` (holds the printer until !IsSEPlaying), `{PAUSE_MUSIC}` /
  `{RESUME_MUSIC}` (m4aMPlayStop / Continue on the BGM). At text speed 1 each code after the first in a frame
  costs a frame (RenderText's delayCounter), as on the GBA.
- **Specials** (script/audioSpecials.ts): `PlayTrainerEncounterMusic` (the trainer's encounterMusic id →
  MUS_ENCOUNTER_GIRL / _BOY / _ROCKET via PlayNewMapMusic; reads the configured trainer battle through
  SpecialEnv.trainerBattle) and `Script_FadeOutMapMusic` (FadeOutMapMusic(4), its `waitstate` until BGMusicStopped,
  the script on the frame after).
- **Test hooks:** `__test.audioEvents(since)` (a seq from `game.mark()`): each start, BGM pause / resume and fade
  as `{seq, frame, type: 'se' | 'bgm' | 'fanfare' | 'cry' | 'stop' | 'continue' | 'fade', id, name, player: 'BGM' |
  'SE1' | 'SE2' | 'SE3' | 'CRY0' | 'CRY1', pan?, started?, fade?, speed?, mode?}` (`started`: MPlayStart took it; a
  cry: `id` the species, `name` its sample, `mode` the CRY_MODE_*);
  `__test.audio()`: each player's `{song, playing, paused, status, volume (track volX, 64 = full), fading}`, the cry
  players, sound.c's map music state, fanfare counter and task, `cry: {player, playing, duckTaskActive,
  duckingCounter}`; `__test.playSong(name)` starts a song. sound.ts
  reports through `setSoundEventListener` (dev only).
- **Tests:** `tests/unit/sound.test.ts` (fanfare counts, the BGM paused and resumed, IsSEPlaying over SE_SELECT,
  FadeOutMapMusic's wait, a new map song after the fade), `tests/e2e/audio.test.ts` (Viridian Forest's Potion
  ball: MUS_LEVEL_UP holds "put the POTION away" 80 + 3 frames with MUS_VIRIDIAN_FOREST paused; the Game Corner
  fisher's `waitse` holds `setflag` until SE_SHOP stops). Cries: `tests/unit/soundCries.test.ts` (constants,
  SpeciesToCryId, ducking, ClearPokemonCrySongs, StopCryAndClearCrySongs, the text printer's codes and SE_SELECT on
  stub surfaces), `tests/unit/m4aRom.test.ts` (the ROM's cry table through PlayCry_ByMode / IsCryPlaying /
  IsCryFinished), `tests/e2e/audioCries.test.ts` (the Celadon Condominiums Meowth's `waitmoncry` holds `release`
  until cry stop + 3 frames; SE_SELECT on a `\p`).

### Map music

- **Where:** `src/gba/overworldMusic.ts` is overworld.c's music block (overworld.c:989-1200): GetLocationMusic /
  GetCurrLocationDefaultMusic / GetWarpDestinationMusic, Overworld_PlaySpecialMapMusic, Overworld_SetSavedMusic /
  ClearSavedMusic, Overworld_TryMapConnectionMusicTransition, Overworld_ChangeMusicToDefault, GetMapMusicFadeoutSpeed,
  TryFadeOutOldMapMusic, Overworld_FadeOutMapMusic, Overworld_MusicCanOverrideMapMusic. BGMusicStopped and
  Overworld_ChangeMusicTo stay in sound.ts, and so does gDisableMapMusicChangeOnMapLoad (MUSIC_DISABLE_OFF / STOP /
  KEEP; set with `SetDisableMapMusicChangeOnMapLoad`), since PlaySE reads it: PlaySE does nothing while it's set (the
  Hall of Fame's warp sets KEEP, the credits clear it; a soft reset clears it too). The song a map plays:
  `state.savedMusic` (gSaveBlock1Ptr->savedMusic, saved since save version 6) if set, else MUS_SURF while surfing
  (not on Victory Road, Route 23, the Indigo Plateau), else the header's `music`.
- **Host:** `setOverworldMusicHost({ state, currentMap, playerLocal })` (OverworldScene.create): gMapHeader is the
  current map's MapData. sWarpDestination isn't a global in the port: TryFadeOutOldMapMusic and the connection
  transition take the destination's header (the port loads it before the warp's fade).
- **Hooks (where the C calls it, the port does):** OverworldScene: CB2_NewGame / CB2_ContinueSavedGame / CB2_WhiteOut's
  StopMapMusic; Overworld_PlaySpecialMapMusic from the new game, CONTINUE (both branches), `defaultWarpExit`
  (FieldCB_DefaultWarpExit), `warpFromScreen` (the ferry, the Hall of Fame), a battle's `returnToField`, the Safari
  Zone's out-of-balls warp, the naming screen's return; Overworld_ClearSavedMusic in `onMapLoaded` before
  ON_TRANSITION (LoadMapFromWarp / LoadMapFromCameraTransition: Cycling Road's ForcePlayerOntoBike sets it again);
  the connection transition in `onPlayerArrived` before the new chunk is current. Warps: `warpTo(name, warpId, x, y,
  kind)` is DoWarp ('warp': SE_EXIT), DoDiveWarp ('silent') or Task_DoorWarp's case 4 ('door'); each runs
  TryFadeOutOldMapMusic with WarpFadeOutScreen and waits for `!fade && BGMusicStopped()` (Task_Teleport2Warp). The
  door warps play GetDoorSoundEffect (Task_DoorWarp, Task_ExitDoor's 25th frame). Field moves: `FieldMoveHost.
  warpFadeOutScreen(mapId, fadeOutMusic)` (true for Dive / fall warps, Teleport, Dig / Escape Rope; Fly fades no
  music), and their field callbacks (FieldCallback_TeleportIn, _EscapeRopeExit, _FlyIntoMap, FieldCB_FallWarpExit)
  start with Overworld_PlaySpecialMapMusic; the warp tasks' SEs (SE_WARP_IN / _OUT, SE_CLICK, SE_FALL,
  SE_M_STRENGTH) are live. Bike: GetOnOffBike / ForcePlayerOntoBike (world/bike.ts); surf: FldEff_UseSurf
  (world/surf.ts) and CreateStopSurfingTask (world/playerAvatar.ts). The Seagallop ferry: Overworld_FadeOutMapMusic,
  then Task_Seagallop_2 waits for BGMusicStopped. Scripts: `playbgm` (save flag), `savebgm`, `fadedefaultbgm`.
- **Timing:** a warp into a map with other music takes 16 × 2 + 1 frames (indoors) or 16 × 4 + 1 (outdoors) from its
  fade's start, more than the screen fade; the same song: no fade, no restart. A connection fades at speed 8 and
  MapMusicMain starts the new song 128 frames after the fade (on the bike: a crossfade, 4 out and 4 in).
- **Tests:** `tests/unit/overworldMusic.test.ts` (the song choice incl. savedMusic and surf, the override rule,
  KEEP / STOP, PlaySE's gate, the fade lengths, the connection transition, ChangeMusicToDefault, the Champion's
  room), `tests/unit/save.test.ts` (a version 5 save loads with no savedMusic), `tests/e2e/mapMusic.test.ts`
  (Pallet Town → Oak's lab door: SE_DOOR, a speed-2 fade, the lab loads ≥ 33 frames later, MUS_OAK_LAB; the lab's mat
  → Pallet Town: SE_EXIT and a speed-4 fade, ≥ 65 frames; the player's house: no fade; Pallet Town → Route 1:
  speed 8, MUS_ROUTE1 128 frames later; the Bicycle from SELECT: MUS_CYCLING, saved, CONTINUE plays it, off again
  MUS_ROUTE1; Surf: MUS_SURF, and back on land MUS_PALLET). `__test.audio()` shows the map music state
  (`mapMusic`: current, next, state) and `disableMapMusicChangeOnMapLoad`.
### Field SEs (W-sound 4)

- **Where:** each C call sits at its port function, citing it: field_player_avatar.c in `world/playerAvatar.ts`
  (PlayCollisionSoundIfNotFacingWarp, PlayerJumpLedge, PlaySpinSound, DoBoulderDust), field_control_avatar.c in
  `scenes/OverworldScene.ts` (SE_WIN_OPEN where START opens the menu, `startInteractionScript` =
  TryStartInteractionScript's SE_SELECT except for the PCs, the boulder's SE_FALL in `boulderPushed`), the heal
  machine's glow in `world/hallOfFameRecord.ts` (SE_BALL, MUS_HEAL, PokeballGlowEffect_WaitForSound's
  IsFanfareTaskInactive: the nurse's `waitfieldeffect` holds until the fanfare task ends), the fldeff_*.c SEs in
  `world/fieldMoves.ts` / `flash.ts` / `fieldMoveShowMon.ts` (the banner's cry), `world/elevator.ts`,
  `world/itemfinder.ts`, `world/vsSeeker.ts`, `world/ssAnne.ts`, `menus/seagallop.ts`, `entities/FieldEffects.ts`
  (puddles), `entities/FieldPoisonEffect.ts` (its constructor is FldEffPoison_Start), the PCs' menus
  (`ui/PlayerPcMenu.ts`, `ui/StoragePcMenu.ts`), the start menu and save dialog (`ui/StartMenu.ts`,
  `ui/SaveDialog.ts`: SE_SAVE, then SaveDialogCB_ReturnSuccess's 60 frames only count once !IsSEPlaying).
- **Menus:** `ui/Menu.ts` plays menu.c's SEs itself (Menu_ProcessInput with `wrap`, else
  Menu_ProcessInputNoWrapAround: SE_SELECT on A and on UP / DOWN, without wrap only if the cursor moved; none on B),
  so the start menu, YES/NO, multichoice and the shop's menu get them; the callers add what their C adds on B
  (CloseStartMenu, script_menu.c's NO / B with YesNoMenu's `seOnNo`, the multichoice's B, Task_ShopMenu's B). The
  multichoice grid has Menu_ProcessInputGridLayout's.
- **Doors:** `FieldDoors.getDoorSoundEffect(x, y)` (world coords) is GetDoorSoundEffect; `opendoor` plays it via
  the ScriptHost's `doorSoundEffect` (map-local); the warps' door SEs (Task_DoorWarp, Task_ExitDoor) use it too.
- **Not here:** the warp tasks' sounds (Escape Rope, Dig, Teleport, the fall arrival, Fly's music) and map music
  ("Map music"), the cries' timing (W-sound 2), the bike bell (item_use.c: menus/itemUse.ts). Not in the port: escalators,
  the Lavaridge warps, FldEff_NpcFlyOut, Birth Island's rock (SE_THUNDER), ShakeScreen, LoopWingFlapSound, the
  Acro Bike and secret base mats (field_player_avatar.c's SE_BIKE_HOP / SE_WARP_IN), the mailbox, field weather.
- **Tests:** `tests/e2e/fieldSounds.test.ts` (a bump's SE_WALL_HIT, a ledge's SE_LEDGE, talking's SE_SELECT, Bill's
  `opendoor` SE_SLIDING_DOOR, the bedroom PC's SE_PC_ON without SE_SELECT, START's SE_WIN_OPEN and the menu's
  SE_SELECTs, the save dialog closing SE_SAVE's length + 60 frames after it, the heal machine's SE_BALLs 25 frames
  apart, MUS_HEAL 32 frames after the last, the effect running until the fanfare task resumes the BGM).

### Scene sounds (W-sound 7a, 7b)
### Battle sounds: the controllers (W-sound 5b)

- **Where:** each controller calls `gba/sound.ts` (and `audio/m4a.ts` for m4aMPlayContinue / m4aMPlayVolumeControl /
  m4aSongNumStop) as its C file does, with the C's pans and cry modes: `battle/controllerPlayer.ts`
  (battle_controller_player.c), `controllerOpponent.ts`, `controllerOakOldMan.ts`, `controllerSafari.ts`; the exp
  bar's SE_EXP (PlaySE, then m4aSongNumStop when the bar is full) and Task_CreateLevelUpVerticalStripes' SE_RS_SHOP
  are in `controllerCommon.ts`. The menus' SE_SELECT (action, move, target, move switching, the Old Man's
  simulated input, Safari's menu), SE_FAINT (PlaySE12WithPanning: SOUND_PAN_ATTACKER for the player's side,
  SOUND_PAN_TARGET for the foe's), CONTROLLER_PLAYSE (panned by side, except the Oak/Old Man controller's plain
  PlaySE), PLAYFANFARE, PLAYBGM (the player's only; the others just complete), FAINTINGCRY (player / opponent:
  PlayCry_ByMode(species, -25 / 25, CRY_MODE_FAINT); Oak/Old Man and Safari: PlayCry_Normal(species, 25)), Cmd55's
  FadeOutMapMusic(5).
- **Waits:** Intro_WaitForShinyAnimAndHealthbox (player, opponent) and SwitchIn_HandleSoundAndEnd hold until
  `!IsCryPlayingOrClearCrySongs()` (the send-out cry), then put the BGM back to 256 (m4aMPlayContinue in multi
  battles). The Oak/Old Man intro doesn't wait: it starts Task_PlayerController_RestoreBgmAfterCry (exported by
  controllerPlayer.ts). The cries themselves come from pokeball.c / battle_main.c's ports (`gfx.ts`, W-sound 6a).
- **Tests:** `tests/e2e/audioBattleControllers.test.ts` (a wild battle's intro leaves Intro_WaitForShinyAnimAndHealthbox
  only after MEWTWO's send-out cry stops; 4 SE_SELECTs from the action and move menus; a fainting PIDGEY's SE_FAINT
  at SOUND_PAN_TARGET and CRY_MODE_FAINT cry; SE_EXP stopped well before its 100 frames; the Old Man's two
  SE_SELECTs 64 frames apart and the catch's speed-5 fade).
### Battle sounds (W-sound 5a)

- **Where:** each C call sits in the file that ports its C file and calls `gba/sound.ts` directly with the C's
  arguments. The battle's music: `battle/battleBgm.ts` (pokemon.c's GetBattleBGM, PlayMapChosenOrBattleBGM; the
  caller passes the battle type flags and the trainer's class, which the C reads from gBattleTypeFlags / gTrainers),
  called by `OverworldScene.runBattle` (CreateBattleStartTask: before the transition, with `song`: 0 for the
  default, MUS_VS_LEGEND for a roamer, StartLegendaryBattle's MUS_VS_MEWTWO / _VS_DEOXYS / _VS_LEGEND /
  MUS_RS_VS_TRAINER through `script/specials.ts` and `ScriptHost.startScriptedBattle`'s `song`) and by
  battle-test.html's `launch`. SE_MUGSHOT: `battle/transition.ts` (Mugshot_StartOpponentSlide). battle_main.c in
  `battle/main.ts`: the victory music (HandleEndTurn_BattleWon: MUS_VICTORY_GYM_LEADER for leaders and the
  Champion, else MUS_VICTORY_TRAINER), FadeOutMapMusic(5) at the end, SE_FLEE (the Safari run), SE_LOW_HEALTH's
  stop on the way out. battle_script_commands.c in `battle/bsCommands1-4.ts`: getexp's MUS_VICTORY_WILD (not for a
  level-100 mon: the C skips it there too), the level-up's HandleLowHpMusicChange (battle/gfx.ts), the yes / no
  boxes' SE_SELECT, VARIOUS_WAIT_FANFARE (`waitfanfare`, only the Poké Flute's script uses it); `playse`, `fanfare`
  and `playfaintcry` emit to the controllers, as in the C.
- **The hooks:** BattleUi's `playSE / playCry / playBGM / playFanfare` pass through to sound.ts (PlayCry_Normal(species,
  0): no mode or pan) for the callers not converted yet; new code calls sound.ts (AUDIO_PLAN.md decision 21: W-sound
  8 deletes them). MainMenuScene's and tradeScene's BattleUi stand-ins keep no-op hooks.
- **After the battle:** returnToField's Overworld_PlaySpecialMapMusic brings the map's music back (the battle song is
  the map music state's current song, so it always differs). The level-up fanfare pauses the victory music for 80
  frames but holds nothing: BattleScript_LevelUp has no `waitfanfare`.
- **Tests:** `tests/unit/battleBgm.test.ts` (GetBattleBGM by flags and class), `tests/e2e/audioBattle.test.ts`
  (a wild battle: MUS_VS_WILD before the transition, MUS_VICTORY_WILD, MUS_LEVEL_UP pausing it 80 frames,
  FadeOutMapMusic's fade before the end, MUS_ROUTE1 after; a level-100 win without victory music; Rick:
  MUS_ENCOUNTER_BOY, MUS_VS_TRAINER, MUS_VICTORY_TRAINER, MUS_VIRIDIAN_FOREST after; Lorelei's mugshot SE_MUGSHOT;
  Zapdos's MUS_VS_LEGEND; the Poké Flute's `waitfanfare` holding "...awoke!" until MUS_POKE_FLUTE's 450 frames end).
### Scene sounds (W-sound 7a)

- **Where:** each C call at its port function, through `gba/sound.ts` with the C's arguments.
  `menus/evolutionScene.ts` (evolution_scene.c): m4aMPlayAllStop on entry (EvolutionScene) and on a cancel, the
  cries (PlayCry_Normal; IsCryFinished holds EVOSTATE_INTRO_SOUND, _SET_MON_EVOLVED, _CANCEL_MSG), MUS_EVOLUTION_INTRO
  through PlaySE (!IsSEPlaying holds EVOSTATE_START_MUSIC), PlayNewMapMusic(MUS_EVOLUTION), SE_EXP and
  EVOSTATE_RESTORE_SCREEN's `if (IsSEPlaying())` + m4aMPlayAllStop (the frame after SE_EXP starts: it cuts SE_EXP
  and MUS_EVOLUTION), PlayBGM(MUS_EVOLVED) (a fanfare song: it goes to SE2), PlayFanfare(MUS_LEVEL_UP), and
  StopMapMusic + Overworld_PlaySpecialMapMusic when a move is learned or at the end (skipped on battle-test.html,
  which has no field: `hasOverworldMusicHost`). `menus/evolutionGraphics.ts`: the sparkles' four SEs.
  `menus/eggHatch.ts` (daycare.c): VAR_0x8005 = GetCurrentMapMusic(), Task_EggHatchPlayBGM (StopMapMusic, then
  PlayBGM MUS_EVOLUTION_INTRO, MUS_EVOLUTION 60 frames later), SE_BALL, SE_EGG_HATCH, the cry, the MUS_EVOLVED
  fanfare. `menus/tradeScene.ts` (trade_scene.c's wireless path): cachedMapMusic + PlayNewMapMusic(MUS_EVOLUTION) at
  STATE_START, PlayNewMapMusic(cachedMapMusic) at the end, the two cries, the balls' / signal's SEs, MUS_EVOLVED; its
  stand-in BattleUi's `playSE` is PlaySE (the ball open particles' SE_BALL_OPEN).
- **m4aMPlayAllStop:** `gba/sound.ts` wraps the engine's and reports a `stop` per player that had a live track.
- **Map music after script screens:** `OverworldScene.runScreenFromScript` calls Overworld_PlaySpecialMapMusic when
  the screen left neither gFieldCallback nor gFieldCallback2: every screen it runs returns through a callback that
  does (FieldCB_ContinueScriptHandleMusic: trades, egg hatching, the move relearner, the move tutor, the slot
  machine; the diploma's FieldCB_WarpExitFadeFromBlack; RunFieldCallback's FieldCB_DefaultWarpExit). The ones that
  set their own (the party menu's CB2_FadeFromPartyMenu, Easy Chat's FieldCB_ContinueScript, the move deleter's)
  play none.
- **Hall of Fame, credits, Pokédex, title (W-sound 7b):** `menus/hallOfFame.ts` (hall_of_fame.c, hof_pc.c):
  PlayBGM(MUS_HALL_OF_FAME) when the screen has faded in, SE_SAVE, PlayCry_Normal per mon (not eggs) in the frame its
  info prints (nothing waits for it: the 120-frame timer runs alongside, the BGM ducks), SE_APPLAUSE, FadeOutBGM(4)
  on A. SetWarpsToRollCredits sets MUSIC_DISABLE_KEEP (so PlaySE is silent until the credits clear it) and runs
  DoWarp under the screen's CB2: TryFadeOutOldMapMusic (the room's MUS_SLOW_PALLET → Indigo Plateau's
  MUS_VICTORY_ROAD: FadeOutMapMusic(4)), the skipped SE_EXIT, then Task_Teleport2Warp waits for the fade and
  BGMusicStopped before `hofEnv.doWarp`; `hofEnv.loadMapHeader` (FieldMenuScene) gives it the destination's header.
  Indigo Plateau's ON_TRANSITION `playbgm MUS_CREDITS` starts the credits' music; `menus/credits.ts` plays the mon
  scenes' PlayCry_NormalNoDucking (GetCreditsMonSpecies, CRY_VOLUME_RS). The Hall of Fame PC: StopCryAndClearCrySongs
  + PlayCry_Normal per mon shown, and on leaving IsCryPlayingOrClearCrySongs → StopCryAndClearCrySongs +
  m4aMPlayVolumeControl(BGM, 0x100); its return (OverworldScene.openHallOfFamePc) runs
  ReshowPCMenuAfterHallOfFamePC's Overworld_PlaySpecialMapMusic. `menus/pokedexScreen.ts`: DexScreen_LoadResources'
  SetBGMVolume_SuppressHelpSystemReduction(0x80) and DoClosePokedex's BGMVolumeMax_EnableHelpSystemReduction around
  the SE_SELECTs, SE_BALL_TRAY_ENTER and the NoDucking cries (FRLG's Pokédex has no SE_DEX_* sounds). The title
  screen (MUS_TITLE, the Charizard cry, FadeOutMapMusic(10) / FadeOutBGM(4)), the trainer card (SE_CARD_*, the
  opening's IsSEPlaying wait), the bag and item use (item_menu.c's calls but Teachy TV's, the bike bell, the Poké
  Flute's fanfare and WaitFanfare, SE_REPEL's wait) and the main menu were live already; MainMenuScene's stand-in
  BattleUi plays Oak's speech's ball-open SE_BALL_OPEN through PlaySE. Not ported: Task_MysteryGiftError's SE_SELECT
  (no Mystery Gift), the berry fix program's m4aMPlayAllStop (REVISION 0), Teachy TV's bag tutorials.
- **Tests:** `tests/e2e/audioScenes.test.ts`: a Rare Candy evolution (the scene's stop of MUS_ROUTE1, Charmander's
  cry, MUS_EVOLUTION_INTRO, MUS_EVOLUTION exactly the intro's length later, the four sparkle SEs, SE_EXP and the stop
  one frame later, Charmeleon's cry, MUS_EVOLVED, MUS_ROUTE1 again); an egg hatching (MUS_DUMMY, MUS_EVOLUTION_INTRO a
  frame later, MUS_EVOLUTION 60 after, SE_EGG_HATCH, the cry, MUS_EVOLVED, MUS_PALLET on the field); Reyley's trade
  (MUS_EVOLUTION, both cries, MUS_EVOLVED, MUS_PEWTER again).
  `tests/e2e/audioScenes2.test.ts`: the Hall of Fame (MUS_HALL_OF_FAME, SE_SAVE in the save's frame, each cry in
  its mon's frame and ≥ 121 frames apart, the BGM ducked to 85 and back, SE_APPLAUSE, both speed-4 fade-outs, no SE
  after them, MUS_CREDITS, the credits' Charizard cry without ducking); the Hall of Fame PC (a cry per mon, the stop
  before the next, B during a cry stops it, the BGM volume back at full); the Pokédex (the BGM at 0x80 while open,
  the mon page's and START's cries, full volume after); the title screen (MUS_TITLE, the cry, FadeOutBGM(4) ≥ 90
  frames later).

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
  far) are in the save since version 2; `savedMusic` (gba/overworldMusic.ts) since version 6. The Hall of Fame records live apart from the save, like their own flash
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
  object literal so the test can read its keys. What FRLG compiles but never reaches is ported as the C has it:
  ScriptEngine's decoration commands (`adddecoration`, `removedecoration`, `checkdecor`, `checkdecorspace`,
  `bufferdecorationname`) read their arguments and do nothing, as FRLG comments out the RSE calls
  (tests/unit/dive.test.ts); Dive: see "Dive".
- **Story checks:** `tests/e2e/story.test.ts` (Brock to Lt. Surge; later stretches in their own
  `story*.test.ts`). Each gym starts on its map with the state the story has by then (`setFlags` for the earlier
  badges and story flags, a Lv. 100 Mewtwo), walks the gym (`walkFighting` lets trainers spot the player and fights
  them; `beatTrainers` sets their flags instead), then `beatLeader(game, x, y, from)` talks to the leader, fights
  to the end and presses through the badge and TM text; assert the badge flag, FLAG_DEFEATED_*, the TM
  (`t.itemCount('TM34')`). Story events between gyms are walked from map to map with `takeWarp(game, x, y, map)`
  (doors and mats warp by themselves; stairs get a push once the player has stood still for 30 frames) and
  `talk` / `approach`. Read the decomp map scripts first for the coord events and flags on the way (e.g. Vermilion's
  ticket check, VAR_MAP_SCENE_*). New story specials go in `script/storySpecials.ts` (STORY_SPECIALS, spread into
  SPECIALS); ones that draw with Phaser use `registerSpecials` from their own module.
- **Build conditionals in scripts:** the script extractor keeps only the taken branch of top-level `.ifdef` /
  `.ifndef` / `.if` / `.else` / `.endif` (and cpp `#ifdef` / `#else` / `#endif`) in data/ script files, for
  `BUILD_SYMBOLS` in tools/extract.py (FIRERED, REVISION 0, ENGLISH; no BUGFIX). Before, both branches ran (the
  prize room charged LeafGreen's prices). `.if` inside macros is still expand_conditionals'.
- **Script argument expressions:** `Defines.get` folds constant expressions over known names (`FALSE | (TRUE <<
  1)`, `(MAX_COINS + 1) - 20`), as GAS does; before, the Pokémon Center nurse's `multichoice` threw.
- **Story checks (Erika to Sabrina):** `tests/e2e/storyCeladonSaffron.test.ts` plays each required story event
  from a `?map=` start with the state the story would have (badges and hide flags with `setFlag`, the area's
  trainers marked beaten with the TRAINER_FLAGS_START offset, a level-100 Mewtwo with PSYCHIC + CUT) and checks what
  the player gets: Celadon Gym (the Cut tree, Erika, the badge, TM19), the Game Corner grunt and poster switch
  (FLAG_OPENED_ROCKET_HIDEOUT, the stair warp to B1F), Rocket Hideout B1F / B4F's barriers, the hideout lift,
  Giovanni and the Silph Scope, Mr. Fuji → the Poké Flute, the Tea and the Route 5 gate guard, Silph Co. 7F's rival
  and 11F's Giovanni + Master Ball, Saffron Gym's pads and Sabrina. The ghost Marowak (pokemonTower.test.ts),
  Snorlax with the flute (scriptedBattles.test.ts) and the card key doors (mainPathLeftovers.test.ts) have their own
  files. Helpers in the file: `warp` (OverworldScene.warp, to reload a map after changing flags its ON_LOAD reads),
  `talkFrom(x, y, dir)`, `winBattle` (A through a trainer battle; mashUntil's predicate runs in the page, so the
  start mark goes through `window.__storySince`). Stair warps (MB_*_STAIR_WARP) and gate exits need
  `t.enterWarp()` after `walkTo`; walking onto them doesn't warp. A `special` whose C sets gSpecialVar_Result must
  set VAR_RESULT itself in specials.ts: `special` drops the function's return value (only `specialvar` stores it).
- **Story checks (Koga to the Hall of Fame):** `tests/e2e/storyLeague.test.ts`, same approach: Fuchsia Gym
  (Koga behind the invisible walls), the Safari Zone (the gate's entry, the Gold Teeth, the Secret House's HM03,
  the Warden's HM04), Cinnabar (the locked gym door, Pokémon Mansion B1F's secret switch and the Secret Key, the
  door opening), Cinnabar Gym (a wrong quiz answer → its trainer → the door; Blaine), Viridian Gym (locked until
  the seventh badge; a spinner tile; Giovanni), Route 22's late rival, Route 23's badge guards, and the Elite Four
  and the Champion from Indigo Plateau up to the warp into the Hall of Fame (Oak's congratulations names the
  starter: GetStarterSpecies). Victory Road's boulders and switches: strength.test.ts (2F). Helpers here:
  `scriptDone` presses **B** after a battle or a gift (mashing A in front of the person restarts their script in
  the first free tick: Bruno's post-battle text looped), `talkUntil(cond)` presses A until a gift or switch is
  done and then B, `spinnerRoute` is a route search that allows for MB_SPIN_* tiles (t.walkTo's doesn't),
  `repel` keeps wild battles away, `heal` resets the party between Elite Four rooms. `canReach` (testFindPath)
  checks whether a part of a map is shut off.
- **Bugs that depend on world position:** `?map=` always loads at origin 0, so maps that are far from the origin in
  a real playthrough (e.g. Viridian at y = -80 after walking up from Pallet) need either a real walk or
  `await s.world.load(name, ox, oy)`, then `s.player.setPosition(...)` and `await s.onMapLoaded(false)`.
