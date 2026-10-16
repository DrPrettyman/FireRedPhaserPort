# Deviations from the GBA

Where the port differs from the decomp: by necessity or for now (known deviations), or on purpose (QOL changes).

## Known deviations from the decomp

Things that are placeholders or approximations, so they aren't mistaken for ports. Remove entries as they get done properly.

- **Placeholders (not in the decomp):**
  - Naming screen: the help context, SeedRngAndSetTrainerId after naming the player and the REVISION >= 0xA
    bad-word check aren't ported.
  - Pokémon Center heal: the healing machine (`dofieldeffect FLDEFF_POKECENTER_HEAL`) and the nurse's bow
    (`nurse_joy_bow`) are skipped; the heal itself happens.
  - White-out after the Trainer Tower: its challenge state isn't tracked, so `spokeToOwner` reads as FALSE.
  - VS Seeker: `state.trainerRematches` is never set, so no trainer is ever ready for a rematch.
  - Battles: no audio (PlaySE/cries/BGM are no-ops, so anim SE waits and cry waits end at once).
  - Field sounds: doors (SE_DOOR / SE_SLIDING_DOOR) and puddle splashes (SE_PUDDLE) are silent.
  - Evolution scene: no audio, so cries and sound effects count as finished at once (the intro jingle and the SE_EXP
    wait don't hold the scene up); the help system isn't toggled; GAME_STAT_EVOLVED_POKEMON isn't kept. Evolving
    from the field uses fresh battle globals, so the backdrop follows the map's battle scene (gyms etc.) but not the
    last battle's type flags, which the GBA keeps (e.g. a Rare Candy right after a gym leader would draw the
    Leader terrain there). Mons have no language, markings, ribbons or mail, so EvolutionRenameMon always treats
    them as English and Shedinja doesn't clear those fields.
  - Summary screen: no trade-screen view or multi-battle party order; the struct Pokemon fields the port doesn't
    store read as defaults (met game FireRed, no fateful-encounter flag, English).
  - Party menu: mail, the move relearner, Union Room, minigames, Pokédude/Teachy TV demos are not ported. Of
    the field moves, Fly isn't registered yet (it says it can't be used here), and no field move records a quest
    log event.
  - Field moves (world/fieldMoves.ts, world/fieldMoveShowMon.ts): no audio (the cry in the banner, SE_M_CUT,
    SE_M_ROCK_THROW, SE_M_SWEET_SCENT, the warp sounds) and no GAME_STAT_USED_CUT / _ROCK_SMASH. The field
    effect scripts' palette commands (loadfadedpal, ...) do nothing: the field's sprites are Phaser textures. A
    `callnative` that isn't ported warns once and the effect ends at once (FLDEFF_POKECENTER_HEAL, the emote
    icons from scripts). Sweet Scent's
    red fade is an overlay under the player instead of a fade of every other palette, so the player is also drawn
    over the map's top layer meanwhile, and the field is its normal colour during the battle transition that
    follows. The show-mon banner's graphics load while the player's pose plays, so a very slow load would hold the
    banner back. Dig/Escape Rope with no escape warp saved (a dev start in a cave) go to the last heal location.
  - Item use: the item-use animation (pokemon_special_anim.c) is skipped. Bag uses that need overworld systems
    (rods, Escape Rope, Itemfinder, VS Seeker, Town Map, Fame Checker, Teachy TV, mail, TM case, berry pouch,
    registered SELECT items) log "not implemented" and return to the bag. Berry powder reads as 0. The TM case
    and berry pouch can't be opened to give from (the PC box's GIVE, GoToTMCase_PCBox / GoToBerryPouch_PCBox).
  - Bag/party run in their own scene (FieldMenuScene) when opened from the field; the field side fades with the
    overworld's ScreenFade.
  - Battles: the level-up banner (exp to a mon that isn't sent out) has no mon icon; Spinda's spots aren't drawn;
    HP-as-text (SwapHpBarsWithHpText) and link/multi battles aren't implemented.
  - Battle transitions: no SE_MUGSHOT, and the battle music doesn't start with the transition.
  - Flash (world/flash.ts): FldEff_UseFlash's SE_M_REFLECT is silent.
  - Map preview screens (Mt. Moon, Rock Tunnel, Viridian Forest...) aren't ported: warps into those sections fade
    to black like the GBA and go straight to the map, without the banner (or the flash that follows it).
  - Wild encounters: GAME_STAT_* counters aren't kept.
  - Scripted wild battles (`dowildbattle`, StartLegendaryBattle): no battle music (MUS_VS_MEWTWO / _VS_LEGEND /
    ...), no GAME_STAT_TOTAL_BATTLES / _WILD_BATTLES. Not ported: `setmaplayoutindex` (Seafoam Islands B3F/B4F
    keep their current layout after both boulders have been pushed down; the boulders still fall and the flags
    are set), `seteventmon` (Navel Rock's Lugia / Ho-Oh and Birth Island's Deoxys, which also need the event
    tickets).
  - Player avatar (world/playerAvatar.ts, world/bike.ts): no audio (bump, ledge, spinner, bike bell, Strength
    and fall sounds; Cycling Road and surf music). Not ported: the warp arrow sprite on arrow mats
    (HandleWarpArrowSpriteHideShow), DoStairWarp's 12-frame delay when a stair warp takes the player off the
    bike, fishing (rods), the teleport spin, the quest log's recordings, and the help context. Movement scripts
    (applymovement) still run through MovementRunner rather than the player's held-movement actions, so `lock`
    waits for a scripted step to end by `isMoving`.
  - Surf and Waterfall (world/surf.ts): no audio (MUS_SURF and Overworld_ClearSavedMusic; the banner's cry as
    above), no HELPCONTEXT_SURFING, no quest log (`goto_if_questlog` never branches). FldEff_UseSurf takes the
    field controls lock at once: the C holds FieldCallback_PrepareFadeInFromMenu's (or the script's) lock until
    the task takes it, which the port's hand-offs don't. Like CreateFieldEffectShowMon, the banner waits for its
    graphics to load (UseSurfEffect_3, waterfall_1). The surf blob is the player's only `fieldEffectSpriteId`
    user, so it lives in surf.ts rather than on the ObjectEvent, and the player's sprite y2 it sets is applied
    to the Phaser sprite directly (ObjectEvent's depth ignores that 1 px). After a battle or field menu the blob
    is made again (the GBA rebuilds every sprite), so its animation restarts.
  - Object animations follow the step's progress (first half step frame, second half standing) instead of
    sprite.c's anim tables; a sliding player (disableAnim) shows the standing frame.
  - Poké Mart: no quest log transaction history (RecordItemTransaction / RecordTransactionForQuestLog) or
    GAME_STAT_SHOPPED; no SE_SHOP. The decoration marts (`pokemartdecoration*`) aren't ported (unused in FRLG).
    Selling the TM case / berry pouch logs "not implemented" (those screens don't exist).
  - Field steps: eggs count down egg cycles, but the daycare (breeding,
    its mons' steps) and the hatching scene (`special EggHatch`) aren't ported. A finished VS Seeker charge would
    start EventScript_VsSeekerChargingDone, whose specials aren't ported; only the (unported) VS Seeker starts one.
  - Safari Zone: the entrance's SE/fanfare are silent.
  - The money box and Safari stats window are Phaser MenuWindows (the field isn't on the GBA layer).
  - Pokémon Storage System (menus/pokemonStorage*.ts): silent (SE_PC_LOGIN / SE_PC_OFF and the menu SEs); no
    quest log events (SetPokeStorageQuestLogEvent) or help context. The PPU has no OBJ mosaic, so the mon shown on
    the left changes at once instead of un-pixelating (the effect's timing, which the menus wait for, is kept).
    The screen works on its own six-slot copy of the party (the C keeps empty slots while it runs) and writes it
    back, compacted, when it hands over to another screen; a mon placed after an empty party slot would move up
    early if the summary / naming screen / bag opened while the party box still showed the gap.
    MON_DATA_SANITY_IS_BAD_EGG reads FALSE and mail isn't modelled, so the bad-egg and mail checks never trigger.
  - Player's PC (ui/PlayerPcMenu.ts, menus/itemPc.ts): the mailbox is always empty (mail isn't modelled); no quest
    log events (withdrew / deposited / gave from the PC), help contexts or SEs.
  - Save data (state/saveData.ts): one JSON save in browser localStorage instead of the flash's two 14-sector
    save slots, so there are no sector checksums, no alternating slots / save counter, no backup of the previous
    save and no encryption of money, coins and bag quantities (gSaveBlock2Ptr->encryptionKey). The save holds
    what the port keeps; left out because the port doesn't keep them: the current map's object events and object
    templates (NPC positions, setobjectxyperm changes), game stats, the quest log, mail, the daycare mons,
    Pokédex order/mode and the Unown/Spinda personalities, the second copies of the dex seen flags, the fame
    checker, Trainer Tower and minigame records, the enigma berry, mystery gift, easy chat, link records and
    the sound and region map zoom options. The player's position is stored only when the field writes it before
    a save (`OverworldScene.storeLocationForSave`), not kept current on every step like gSaveBlock1Ptr->pos.
  - Boot and main menu (scenes/BootScene.ts, menus/mainMenu.ts): the game boots into the title screen; the
    copyright screen and intro.c's Game Freak / Nidorino movie before it aren't ported. Dev starts (`?start=`,
    `?map=`) skip the title screen and the main menu; dev `?skipIntro` (the e2e harness's default) skips the title
    screen and Oak's speech: the main menu with a save, the new game without. No MYSTERY GIFT (IsMysteryGiftEnabled isn't kept), no quest log playback ("Previously on your quest")
    before CONTINUE, no SE_SELECT. SAVE_STATUS_ERROR ("the previous save file will be loaded") can't happen: one
    slot, no backup; an unreadable slot is SAVE_STATUS_INVALID ("The save file has been deleted...").
  - Title screen (menus/titleScreen.ts): no MUS_TITLE, no Charizard cry (the cry scene still waits its 90
    frames), no help system (HELPCONTEXT_TITLE_SCREEN: L/R do nothing). When its 2700-frame timer runs out it goes
    straight back to the title screen (CB2_InitCopyrightScreenAfterTitleScreen would replay the copyright screen
    and the intro). StartTimer1 / SeedRngAndSetTrainerId don't seed the RNG from the time spent on the title
    screen: the port seeds it at load. B+SELECT (REVISION 0's berry fix program, a multiboot program for Ruby and
    Sapphire's berry clock) does nothing. The clear save data screen (B+SELECT+UP) empties the one localStorage
    slot (ClearSaveData erases every flash sector, incl. the Hall of Fame) and its soft reset (DoSoftReset) is
    `softReset` in scenes/BootScene.ts: the scenes restart, the extracted data stays loaded.
  - Oak's speech (menus/oakSpeech.ts): no BGM (MUS_NEW_GAME_INSTRUCT / _INTRO / _EXIT, MUS_ROUTE24), cry or SEs
    (the cry waits end at once), no help context (HELPCONTEXT_NEW_GAME). After the naming screen the C loads 48
    colours past the background palette (out of the tiles after it) into palettes the player / rival pic overwrite
    anyway; the port loads just the palette. The trainer id is still rolled when the game state is created (see the
    RNG approximation), not by the naming screen's SeedRngAndSetTrainerId. CB2_NewGame hands only the names and the
    gender to the field, whose new GameState is NewGameInitData's.
  - Save dialog (ui/SaveDialog.ts): SE_SAVE / SE_BOO / SE_SELECT are silent; no help context, no
    GAME_STAT_SAVED_GAME, no quest log data. A failed write shows the save error message without
    DoSaveFailedScreen. SaveMapView isn't ported: the map view isn't saved, so CONTINUE rebuilds the map from its
    header and ON_LOAD script (metatiles a script changed later aren't restored). `special Field_AskSaveTheGame`
    (EventScript_AskSaveGame: cable club, Seven Island) isn't wired to the dialog yet.
  - CONTINUE (OverworldScene.continueSavedGame): the map's objects spawn from its templates (object events aren't
    saved, see Save data); gExitStairsMovementDisabled isn't kept (no Task_ExitStairs).
  - Multichoice: the cable club menus' help descriptions (MultiChoicePrintHelpDescription) aren't drawn (no
    link play); the quest log's QL_AvoidDisplay bit of ignoreBPress is ignored.
  - Elevators: SE_ELEVATOR / SE_DING_DONG are silent; UpdateEscapeWarp isn't kept on warps.
  - Field ListMenu (ui/FieldListMenu.ts): SE_SELECT is silent; the quest log's QL_AvoidDisplay is ignored.
  - PC: HallOfFamePCBeginFade logs "not implemented" and goes straight back to the PC menu.
  - Interaction metatiles whose scripts need unported screens/specials (Town Map, Trainer Tower clock, cable club
    monitors, questionnaire/easy chat) start their scripts and hit the unimplemented-special warnings.
  - No-op specials (`NO_OP` in `script/specials.ts`): audio, quest log, help system, fame checker, GameCube link flags.
  - Player names are "PLAYER"/"RIVAL" in dev starts and with `?skipIntro` (the e2e harness), which skip Oak's speech.
- **Approximations:**
  - `fadescreen` is an alpha overlay, not a palette blend: same ramp and timing, not bit-identical; weather palettes ignored.
  - `showmonpic`: the sprite appears when its PNG has loaded; no cry.
  - Text colour is reset to NPC_TEXT_COLOR_DEFAULT when a script starts, not in ProcessPlayerFieldInput.
  - The RNG (`random.c` formula) is seeded from `Math.random` (or `?seed=` in dev); the trainer id is rolled when the game state is created instead of in Oak's intro.
  - A mon's met location is the MAPSEC_* name, not the numeric id.
  - Battle transitions draw the field on the GBA layer (`world/fieldGbaScreen.ts`): BG1-3 come from the map
    grid as DrawWholeMapView would lay them out (the ring buffer anchored at the camera, tile offsets 0), so a
    scrolled BG shows the same neighbouring rows/columns the GBA's 32x32 tilemaps hold. Object sprites stay
    Phaser's and are copied into an OBJ bitmap layer each frame (behind OAM sprites, priority from their depth
    band); their colours follow palette fades/blends through two probe OBJ palettes, not their real palettes.
    Weather tints are ignored.
  - HBlank callbacks run before each line is drawn with REG_VCOUNT = that line, and HBlank DMA gives line L
    entry L of its table, so per-line effects are one line earlier than on hardware (consistently so).
  - The barn door wipe's windows are black Phaser rectangles under the screen fade (WININ 0 shows the backdrop,
    which the field forces to black).
  - Flash's darkness on the field is a black Phaser overlay painted outside each line's WIN0H span (the circle
    table is the GBA's, double-buffered the same way), under the text windows; weather palettes don't reach it
    (it's the black backdrop anyway).
  - Field ListMenu: scrolling reprints the shown rows instead of ScrollWindow + printing the new ones (same
    pixels); its key repeat counts from when the list opened, not from when the keys went down; the scroll arrows
    are Phaser images drawn from sRedArrowOtherGfx (frame and bounce as menu_indicators.c's).
  - Tile animations: the GBA only has the current map's tilesets in VRAM and draws connected maps with them; here
    each map keeps its own atlases, so a neighbour with a different secondary tileset only animates it while it's
    the current map. BG3 under NORMAL-layer metatiles shows the backdrop colour instead of DrawMetatile's
    garbage tile 0x3014. A door frame doesn't overwrite the last 8 BG tiles for the rest of the map
    (CopyDoorTilesToVram's side effect).
  - Field effect sprites are positioned in world pixels, so UpdateObjectEventSpriteInvisibility's off-screen
    check and the gCamera map-change fixups in the grass callbacks aren't needed. Reflections ignore weather
    palette tints (UpdateSpritePaletteWithWeather).
  - `lock`/`lockall` only wait for the player (and the selected object) to finish their steps; other objects already
    hold still while any script runs. Held movements (trainer approach, camera object) are ObjectEvent moves, so
    their frame order relative to the script and tasks can be off by a frame.
  - Sprite order: `fixedPriority` (surf/fly field effects, the `set_fixed_priority` movement action and
    `setobjectsubpriority`, none of which FRLG scripts use) isn't ported, and neither is OAM priority 0, which no
    map elevation produces (priority 3 is only used by field effects: reflections and ripples). Sprites tied on priority, subpriority and screen top keep creation order rather
    than the previous frame's gSpriteOrder.
  - BIOS ObjAffineSet uses a computed sine table; the PPU has BG mosaic but not OBJ mosaic.
  - Buy menu map view: object sprites skip their subsprite tables (table 0 is empty for every size, so it draws the
    same); an inanimate object not facing south shows its only anim instead of reading past the anim table.
  - The map name popup scrolls only its own window; on the GBA it scrolls all of BG0 (BG0VOFS), so a message
    box opened during the frame or two before the dismissal clears it would also be shifted.
  - Castform's form change (HandleSpeciesGfxDataChange) takes the new form's palette row from that battler's own
    Castform palette. The GBA keeps one gBattleStruct->castformPalette, written by whichever Castform's gfx
    loaded last, so it only differs with two Castforms of different shininess on the field.
- **Data:** Castform has no front pic (its `front.png` isn't in the decomp; it's built from per-form images).

## Deliberate QOL changes

Places where we choose to differ from the GBA on purpose (not placeholders). Keep this list current.

- **NPCs on neighbouring maps are spawned** (`OverworldScene.syncNpcsWithLoadedMaps`). The GBA already draws the
  connected maps' tiles but only spawns the current map's objects in the view window (TrySpawnObjectEvents), so
  NPCs pop in when you cross a border. We spawn every object of the current map and its connected neighbours and
  drop them when their map stops being adjacent. Consequences:
  - Clone objects (OBJ_KIND_CLONE, 9 in the game, e.g. Route 21 North's copy of Pallet's fat man) are not needed
    and stay unsupported.
  - Objects aren't despawned/respawned by the view window (RemoveObjectEventsOutsideView), so wandering NPCs don't
    snap home when you come back.
  - A neighbour's templates are its header ones (or the ones it had while it was last current); its map scripts
    don't run until you enter it. On entry, any of its objects whose reloaded template disagrees (position,
    graphics, movement type, hidden) is marked stale and respawned once it's off screen, so nobody visibly teleports.
    A stale one that's on screen keeps its old place until it isn't, as a live object would on the GBA.
  - Exception: a neighbour's objects with dynamic graphics (OBJ_EVENT_GFX_VAR_*) aren't spawned until it's current,
    because VAR_OBJ_GFX_ID_* hold the current map's choices, not the neighbour's.
  - Trainer sight only checks the current map's objects. On the GBA the previous map's objects linger until they
    scroll off screen, and a trainer among them can still spot you; here a neighbour's trainers never do.
  - Future: any other per-object logic should likewise check that an object belongs to the current map where the
    GBA would only have current-map objects alive.
