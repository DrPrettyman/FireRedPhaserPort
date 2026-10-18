# Deviations from the GBA

Where the port differs from the decomp: by necessity or for now (known deviations), or on purpose (QOL changes).

## Known deviations from the decomp

Things that are placeholders or approximations, so they aren't mistaken for ports. Remove entries as they get done properly.

- **Placeholders (not in the decomp):**
  - Naming screen: the help context, SeedRngAndSetTrainerId after naming the player and the REVISION >= 0xA
    bad-word check aren't ported.
  - Pokémon Center nurse: the heal machine's SE_BALL and MUS_HEAL are silent (no audio);
    SetUsedPkmnCenterQuestLogEvent is a no-op (no quest log) and BufferUnionRoomPlayerName always says no wireless
    player was seen.
  - The S.S. Anne leaving (`special DoSSAnneDepartureCutscene`, ss_anne.c) isn't ported: the ship doesn't sail off
    (no wake or smoke sprites), the script's `waitstate` passes at once and `removeobject` hides it. Its graphics
    (graphics/ss_anne/) aren't extracted yet.
  - In-game trades (script/tradeSpecials.ts): DoInGameTradeScene is a stand-in until W-trade unit 2: a fade to
    black, the swap and a fade back in on the same field (no trade_scene.c animation, no MUS_EVOLUTION, no
    CB2_ReturnToField rebuild of the field). The traded mon's contest conditions and sheen aren't kept (Pokémon
    have no contest stats), and DONTAE's Jynx holds its Fab Mail without the message (mail isn't modelled:
    GetInGameTradeMail / gLinkPartnerMail / MON_DATA_MAIL).
  - Lt. Surge's trash cans, Bill's cell separator: silent (SE_PIN, SE_UNLOCK, SE_BALL, SE_WARP_IN).
  - The Elite Four and Champion rooms' lighting (`special DoPokemonLeagueLightingEffect`, field_specials.c) isn't
    ported: the rooms keep their tileset's BG palette 7 (no sEliteFourLightingPalettes / sChampionRoomLightingPalettes
    cycle). It needs a runtime BG palette swap of the tileset atlases; visual only, the scripts go on.
  - `special Script_TryGainNewFanFromCounter` (after Lance) is a no-op, like Script_UpdateTrainerFanClubGameClear:
    the Trainer Fan Club isn't kept.
  - White-out after the Trainer Tower: its challenge state isn't tracked, so `spokeToOwner` reads as FALSE.
  - VS Seeker (world/vsSeeker.ts): silent (SE_CONTEST_MONS_TURN, SE_PIN); no quest log event. Task_VsSeeker_0
    takes the field controls lock itself (the field's overlay held the controls until the bag's callback, as for
    the Escape Rope). The movement scripts (Wait48, the trainers' emotes and step in place) run as MovementRunners
    in their own field tasks; a frozen trainer still finishes them, so UnfreezeObjectEvent has nothing to do.
    UseVsSeekerEffect_2/3 don't hold MOVEMENT_ACTION_START_ANIM_IN_DIRECTION on the player: Effect_3 waits for the
    VS Seeker anim's end itself. ClearRematchStateByTrainerId leaves the movement type of a same-row trainer other
    than the selected one alone (the C sets its `movementType` field to FACE_DOWN without changing its callback;
    the port's NpcBrain has one value for both).
  - Itemfinder (world/itemfinder.ts): silent (SE_ITEMFINDER); GAME_STAT_USED_ITEMFINDER isn't counted (no game
    stats). ItemUseOnFieldCB_Itemfinder takes the field controls lock itself, as the VS Seeker's task does. The
    arrows and stars are Phaser sprites at the camera's corner plus their GBA screen position, drawn in the
    player's palette as it is at load (the GBA's OBJ palette 0, faded with the field); DestroyArrowAndStarTiles
    frees nothing (the texture stays; no sprite is out by then). Before EventScript_ItemfinderDigUpUnderfootItem,
    ScriptContext_SetupScript hands the task's lock to the running script instead of locking again.
  - Raise-hand movement types (entities/NpcBrain.ts, MOVEMENT_TYPE_RAISE_HAND_AND_*): leaving one zeroes the
    sprite's x2/y2 (the GBA keeps them unless ResetMovementOfRematchableTrainers zeroes them); a frozen jumper
    (any, not only `lock`'s selected object) lands before it holds still.
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
  - Move deleter (SelectMoveDeleterMove): on the GBA the script's `fadescreen FADE_FROM_BLACK` after the special
    runs (unseen) before the summary screen takes over, and FieldCB_ContinueScriptHandleMusic fades the field in
    afterwards. Here the script waits at the special and that `fadescreen` does the fade in (same on screen).
  - Party menu: mail, the move relearner screen (ChooseMonForMoveRelearner opens the party menu, then warns), Union Room, minigames, Pokédude/Teachy TV demos are not ported. No
    field move records a quest log event (SetUsedFieldMoveQuestLogEvent, SetUsedFlyQuestLogEvent).
  - Region map / Fly (menus/regionMap.ts, world/fly.ts): no audio (SE_DEX_SCROLL, SE_CARD_OPEN, SE_M_FLY, ...).
    The bird of Fly always uses the extracted bird sheet's own palette (Red's), where the GBA draws it in OBJ
    palette 0, the player's (Leaf's frames would use hers). gExitStairsMovementDisabled isn't kept (no stair
    walk-out). The dungeon previews' third palette is zero-filled: the C loads 3 palettes from 2-palette data,
    reading on into the ROM (no preview tilemap uses it). Where the C reads a NULL sMapCursor (naming the section
    before the cursor exists, CB2_OpenRegionMap / UpdateMapsecNameBox), the port reads MAPSEC_NONE.
  - Field moves (world/fieldMoves.ts, world/fieldMoveShowMon.ts): no audio (the cry in the banner, SE_M_CUT,
    SE_M_ROCK_THROW, SE_M_SWEET_SCENT, the warp sounds) and no GAME_STAT_USED_CUT / _ROCK_SMASH. The field
    effect scripts' palette commands (loadfadedpal, ...) do nothing: the field's sprites are Phaser textures. A
    `callnative` that isn't ported warns once and the effect ends at once (the emote icons from scripts). Sweet Scent's
    red fade is an overlay under the player instead of a fade of every other palette, so the player is also drawn
    over the map's top layer meanwhile, and the field is its normal colour during the battle transition that
    follows. The show-mon banner's graphics load while the player's pose plays, so a very slow load would hold the
    banner back. Dig/Escape Rope with no escape warp saved (a dev start in a cave) go to the last heal location.
  - Item use: the item-use animation (pokemon_special_anim.c) is skipped. Bag uses that need overworld systems
    (Fame Checker, Teachy TV, mail) log "not implemented" and return to the bag. Berry
    powder reads as 0. The Escape Rope's quest log event (ItemUse_SetQuestLogEvent) isn't
    recorded; ItemUseOnFieldCB_EscapeRope takes the field controls lock itself (on the GBA the start menu's lock is
    still held when the bag returns; here the field's overlay held the controls until then). RemoveUsedItem after
    the bag has closed skips the bag display's item counts (the GBA writes them through a freed NULL pointer). The TM case
    and berry pouch can't be opened to give from (the PC box's GIVE, GoToTMCase_PCBox / GoToBerryPouch_PCBox).
  - Registered items (menus/registeredItem.ts, SELECT on the field): the field doesn't run the GBA task list, so
    the item's task (data[3] = 1) runs its first step in the frame SELECT is read (as RunTasks would, after the
    input callback) and then once a frame from a field task of its own, which stops when the task is destroyed;
    the VS Seeker and the Itemfinder destroy it at once and go on in their own field tasks (on the GBA,
    Task_VsSeeker_0 / ItemUseOnFieldCB_Itemfinder carry on as the item's task). The Fame Checker and Teachy TV
    from SELECT log and give the controls back (no screens). ChangeBgY(0, 0, 0) is a no-op (the field's message
    box isn't on a scrolled BG); InUnionRoom is always FALSE. No quest log events (ItemUse_SetQuestLogEvent).
    The Town Map, TM case and berry pouch from SELECT skip StopPokemonLeagueLightingEffectTask (the league rooms'
    lighting isn't ported), and their screen starts once the map headers the region map / party menu read have
    loaded (prepareFieldMoveMenu), a frame or more after the fade instead of in the same frame.
  - TM case (menus/tmCase.ts): silent (SE_SELECT, SE_SHOP); no quest log (RecordItemTransaction). Not ported:
    the Pokédude's Teachy TV demo (TMCASE_POKEDUDE) and the Union Room's GIVE / EXIT menu (no link play).
  - Berry pouch (menus/berryPouch.ts): silent (SE_BAG_CURSOR, SE_SELECT, SE_SHOP); no quest log
    (RecordItemTransaction). Not ported: Berry Crush (BERRYPOUCH_FROMBERRYCRUSH), the link / Union Room context
    menus (GIVE / EXIT, EXIT) and IsHoldingItemAllowed's Enigma Berry check there (always TRUE: neither can be
    entered) and AbortBerryPouchLoading (for a failed Alloc).
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
    ...), no GAME_STAT_TOTAL_BATTLES / _WILD_BATTLES. `seteventmon` (CreateEnemyEventMon) doesn't set
    MON_DATA_MODERN_FATEFUL_ENCOUNTER (the port keeps no such field; IsBattlerModernFatefulEncounter is always
    TRUE, so it makes no difference). Navel Rock and Birth Island need the Mystery Gift event tickets, which can't
    be had, so only a dev start reaches Lugia, Ho-Oh and Deoxys; Navel Rock's `special ShakeScreen` (and the
    other ShakeScreen users) isn't ported and warns once.
  - `setmaplayoutindex` (World.setCurrentLayout): the swapped layout replaces the current map's chunk after
    ON_TRANSITION rather than being picked before the grid is first built (same result; ON_TRANSITION can't see
    the grid on the GBA either). gSaveBlock1Ptr->mapLayoutId is saved inside the save's `location`
    (PlayerLocation.mapLayoutId), not as its own field.
  - Cable club (cable_club.c): there is no link play. TryBattleLinkup / TryTradeLinkup run as if nothing were on
    the other end of the cable (Task_LinkupAwaitConnection until B, then LINKUP_FAILED), IsWirelessAdapterConnected
    and ValidateSavedWonderCard are FALSE, IsBadEggInParty is FALSE (no bad eggs), CloseLink is a no-op.
  - Player avatar (world/playerAvatar.ts, world/bike.ts): no audio (bump, ledge, spinner, bike bell, Strength
    and fall sounds; Cycling Road and surf music). Not ported: the warp arrow sprite on arrow mats
    (HandleWarpArrowSpriteHideShow), DoStairWarp's 12-frame delay when a stair warp takes the player off the
    bike, the teleport spin, the quest log's recordings, and the help context. Movement scripts
    (applymovement) still run through MovementRunner rather than the player's held-movement actions, so `lock`
    waits for a scripted step to end by `isMoving`.
  - Fishing (world/fishing.ts): no quest log (QuestLogTryRecordPlayerAvatarGfxTransition, QL_PLAYER_GFX_FISH's
    playback task) and no GAME_STAT_FISHING_CAPTURES. StartFishing's task runs its second state a frame later than
    the GBA's (a new task there also runs in the RunTasks pass that created it). The dots and messages go through
    the field message box's printer, which runs after the field's tasks: a dot printed at speed 0 appears in the
    same frame, but Fishing11 / Fishing16 see a finished message a frame later than RunTextPrinters would. The
    player's sprite anim (AnimateSprites) is run by the fishing task after its state functions, as the GBA's sprite
    pass would after the tasks.
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
  - Field steps: eggs count down egg cycles, but the daycare (breeding,
    its mons' steps) and the hatching scene (`special EggHatch`) aren't ported.
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
    the region map zoom option. The player's position is stored only when the field writes it before
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
    (task50_save_game) doesn't switch to HELPCONTEXT_SAVE.
  - Option menu (menus/optionMenu.ts): no help context (HELPCONTEXT_OPTIONS); SOUND (MONO / STEREO) is stored and
    saved but changes nothing (no audio, so no SetPokemonCryStereo). The L=A button mode applies on the GBA-layer
    screens (GbaHostScene's ReadKeys) but not on the field, whose input reads the buttons directly (on the GBA,
    ReadKeys turns L into A everywhere). The field isn't on the GBA layer, so FieldMenuScene sets the backdrop
    (BG palette 0 colour 0, black as LoadTilesetPalette leaves it) the option menu doesn't load itself.
  - Start menu help window (ui/HelpMessageWindow.ts): a Phaser window like the start menu, not a BG0 window; the
    start menu (and its help window) goes away as soon as an item that leaves the field is chosen, before the fade
    (on the GBA both stay up under the fade).
  - CONTINUE (OverworldScene.continueSavedGame): the map's objects spawn from its templates (object events aren't
    saved, see Save data); gExitStairsMovementDisabled isn't kept (no Task_ExitStairs).
  - Multichoice: the cable club menus' help descriptions (MultiChoicePrintHelpDescription) aren't drawn (no
    link play); the quest log's QL_AvoidDisplay bit of ignoreBPress is ignored.
  - Elevators: SE_ELEVATOR / SE_DING_DONG are silent; UpdateEscapeWarp isn't kept on warps.
  - Field ListMenu (ui/FieldListMenu.ts): SE_SELECT is silent; the quest log's QL_AvoidDisplay is ignored.
  - PC: HallOfFamePCBeginFade logs "not implemented" and goes straight back to the PC menu.
  - Interaction metatiles whose scripts need unported screens/specials (Trainer Tower clock, cable club
  - Hall of Fame (menus/hallOfFame.ts): no audio (MUS_HALL_OF_FAME, the cries, SE_SAVE, SE_APPLAUSE); no Champion
    Ribbons (mons have no ribbons; REVISION 0 gives no event tickets either); the help system isn't toggled and the
    quest log isn't saved; a failed save carries on (no DoSaveFailedScreen / gGameContinueCallback).
    FLDEFF_HALL_OF_FAME_RECORD's SE_BALL is silent. Other game stats than GAME_STAT_ENTERED_HOF and
    GAME_STAT_FIRST_HOF_PLAY_TIME aren't counted. `special Script_UpdateTrainerFanClubGameClear` is a no-op (the Trainer
    Fan Club isn't kept).
  - Pokédex screen (menus/pokedexScreen.ts, menus/pokedexArea.ts): no audio (SE_SELECT, the SE_DEX_* sounds, the
    mon page's cries and START = CRY, the page turn's SE_BALL_TRAY_ENTER and the cry after registering a catch; the
    BGM volume calls are no-ops); no help system context. The mon page and the habitat pages load the shown mons'
    pics, palettes, footprints and icons (for the area page) when they're first drawn (fetched on demand, not
    preloaded; the battle preloads the registered page's), so the first view of a mon or a page can take a frame or
    two longer. Unown and Spinda are drawn with personality 0 (the save's unownPersonality / spindaPersonality
    aren't kept; Spinda's spots aren't drawn anywhere). The anticheat's second and third copies of the seen flags
    aren't kept (one `dexSeen` set), so "caught" just needs "seen" too. The Pokédex keeps the field's DISPCNT,
    which the port sets in FieldMenuScene since the field isn't on the GBA layer.
  - Trainer card (menus/trainerCard.ts): no audio (SE_CARD_OPEN / SE_CARD_FLIP / SE_CARD_FLIPPING); no help system
    context. The berry picking and Pokémon Jump records (a star for 200 of each) and the link stats are always 0 (no
    link minigames), so the back never shows its link battle / trade / Berry Crush / Union Room lines; the easy chat
    profile isn't kept (only a link card prints it). The flip's per-line BG0VOFS gives line L buffer[L] (the PPU's
    HBlank convention), where the GBA's HBlank interrupt sets it for the line after, a one-line shift of the squash.
    LoadMonIconGfx's 96 colours read 48 past gMonIconPalettes on the GBA; those palettes (BG 8-10) are zeros here and
    no icon uses them. The photo's icons need special UpdateTrainerCardPhotoIcons (the Celadon Game Corner printer),
    which isn't in specials.ts yet, so they only show with the vars set by hand.
  - Credits (menus/credits.ts): no audio (MUS_CREDITS, the cries). A map scene loads asynchronously, so it can start
    a frame or two later than on the GBA (behind a black screen; the Pokémon scene → map switch, synchronous on the
    GBA, also takes a few frames). Before the first one the credits wait a few frames for their maps and graphics.
    SoftReset (BootScene's `softReset`) restarts the boot flow (the title screen) with a fresh Overworld scene and
    GameState; other module-level state isn't reset, and intro.c's movie isn't ported.
  - PPU: rotation/scaling BGs (modes 1 and 2) ignore BG mosaic.
  - Interaction metatiles whose scripts need unported screens/specials (Town Map, Trainer Tower clock, cable club
    monitors, questionnaire/easy chat) start their scripts and hit the unimplemented-special warnings.
  - No-op specials (`NO_OP` in `script/specials.ts`): audio, quest log, help system, fame checker, GameCube link
    flags, CloseLink.
  - Player names are "PLAYER"/"RIVAL" until Oak's intro exists.
  - No-op specials (`NO_OP` in `script/specials.ts`): audio, quest log, help system, fame checker, GameCube link flags.
  - Player names are "PLAYER"/"RIVAL" in dev starts and with `?skipIntro` (the e2e harness), which skip Oak's speech.
- **Approximations:**
  - `fadescreen` is an alpha overlay, not a palette blend: same ramp and timing, not bit-identical; weather palettes ignored.
  - `showmonpic`: the sprite appears when its PNG has loaded; no cry.
  - The Pewter Museum's fossil pics (ui/MuseumFossilPic.ts): a Phaser image over a MenuWindow, like `showmonpic`,
    not an OBJ in palette 13 over BG0 (the field isn't on the GBA layer); the graphics and positions are the C's.
  - Prof. Oak's Pokédex rating: the MUS_DEX_RATING / MUS_EVOLVED fanfares are silent (`playfanfare` and
    `waitfanfare` are no-ops until audio); BackupHelpContext / RestoreHelpContext are no-ops (no help system).
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
  - Fly's bird is a Phaser sprite (like the field's objects): its OAM matrix becomes a uniform scale and a
    rotation, and the double-size box it's drawn in is a crop of the frame (exact while unrotated; the bird only
    rotates while smaller than the box). Its screen coordinates go through the Phaser camera's view.
  - The GBA layer's BG copies happen at once rather than at the next VBlank (DMA3). The region map re-copies the
    tilemaps it asked for at its VBlank, so a window put after the request in the same frame shows as on the GBA
    (ClearOrDrawTopBar after PrintTopBarTextRight); other screens don't.
  - Buy menu map view: object sprites skip their subsprite tables (table 0 is empty for every size, so it draws the
    same); an inanimate object not facing south shows its only anim instead of reading past the anim table.
  - The map name popup scrolls only its own window; on the GBA it scrolls all of BG0 (BG0VOFS), so a message
    box opened during the frame or two before the dismissal clears it would also be shifted.
  - Castform's form change (HandleSpeciesGfxDataChange) takes the new form's palette row from that battler's own
    Castform palette. The GBA keeps one gBattleStruct->castformPalette, written by whichever Castform's gfx
    loaded last, so it only differs with two Castforms of different shininess on the field.
  - Slot machine: `playslotmachine` (the screen) isn't ported yet (W-slots unit 2), nor FLDEFF_SMILEY_FACE_ICON
    before it. In `menus/slotMachineLogic.ts` the state's machineBias, biasCooldown and reelStopOrder start at 0;
    PlaySlotMachine Allocs the state without zeroing it, so on the GBA they start as whatever the heap held.
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
