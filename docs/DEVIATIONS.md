# Deviations from the GBA

Where the port differs from the decomp: by necessity or for now (known deviations), or on purpose (QOL changes).

## Known deviations from the decomp

Things that are placeholders or approximations, so they aren't mistaken for ports. Remove entries as they get done properly.

- **Placeholders (not in the decomp):**
  - Naming screen: the help context, SeedRngAndSetTrainerId after naming the player and the REVISION >= 0xA
    bad-word check aren't ported.
  - Pokémon Center nurse: SetUsedPkmnCenterQuestLogEvent is a no-op (no quest log) and BufferUnionRoomPlayerName always says no wireless
    player was seen.
  - In-game trades (script/tradeSpecials.ts): the traded mon's contest conditions and sheen aren't kept (Pokémon
    have no contest stats), and DONTAE's Jynx holds its Fab Mail without the message (mail isn't modelled:
    GetInGameTradeMail / gLinkPartnerMail / MON_DATA_MAIL). The trade scene (menus/tradeScene.ts) skips
    CheckPartnersMonForRibbons (no ribbons; no in-game trade mon has any) and TradeEvolutionScene (no FRLG
    in-game trade evolves). Only the in-game (wireless) path is ported: DoTradeAnim_Cable is a link trade's, and so
    are CB2_SaveAndEndTrade's FadeOutBGM / IsBGMStopped wait.
  - The Elite Four and Champion rooms' lighting (world/leagueLighting.ts): Task_CancelPokemonLeagueLightingEffect's
    BlendPalettes(palette 7 → black) while a fade runs does nothing (the field's fade is an overlay over everything,
    so the newly loaded palette is faded with the rest anyway). ApplyGlobalTintToPaletteSlot is a no-op (no quest
    log tints).
  - Trainer Fan Club (script/miscSpecials.ts, trainer_fan_club.c): there are no link battle records, so
    Script_BufferFanClubTrainerName always names the NPC trainer (the rival, LT. SURGE, KOGA), and the link-battle
    fan updates (Special_UpdateTrainerFansAfterLinkBattle) never run.
  - Side specials (script/miscSpecials.ts): Daisy's MUS_HEAL fanfare is the script's; the diploma's
    FANFARE_OBTAIN_BADGE holds its screen for sFanfares' 340 frames, as on the GBA. No quest log (QuestLog_CutRecording). The Magikarp size record loads pokedex.json for the
    heights the first time the guru measures (the script waits for it). The diploma returns through the field's
    plain fade from black rather than FieldCB_WarpExitFadeFromBlack's Task_ExitNonDoor (same look).
  - Fall warps (world/fallWarp.ts): no help context while surfing on Seafoam B4F.
  - Easy Chat (menus/easyChat.ts, menus/easyChatScreen.ts, SIDE_PLAN.md W-easychat): ShowEasyChatScreen: on the GBA the script's `fadescreen FADE_FROM_BLACK` after the special
    runs unseen before the screen takes over and FieldCB_ContinueScript fades the field in; here the script waits
    at the special and that `fadescreen` does the fade in (as the move deleter; same on screen). The mail type isn't
    modelled (the special does nothing for it). ShowEasyChatMessage shows
    its text like `messageautoscroll` does, as a plain field message (no auto-scroll; the profile's two lines fit one
    box). InitEasyChatPhrases doesn't clear the mail words (mail isn't modelled) and clears additionalPhrases only
    (the C's non-UBFIX loop clears 64 bytes, into the Mauville old man's data that's re-initialized right after).
  - Seagallop ferry (menus/seagallop.ts, script/ferrySpecials.ts): no PlayRainStoppingSoundEffect (it only
    sounds in rain, which isn't ported: POSTGAME_PLAN.md decision 1); no help system (HelpSystem_Disable / Enable) and no quest log (DrawSeagallopDestinationMenu's
    QL_AvoidDisplay). The script that ran DoSeagallopFerryScene stays in its `waitstate` until the scene warps, then
    runs on to its `end` (in C, CB2_LoadMap's ScriptContext_Init drops it). The scene's WarpFadeOutScreen is a plain palette fade to
    black (FadeScreen's white fade is for underwater maps, and no harbor is one).
  - Script timing: `special EnterHallOfFame` ends its script at the special (script/specials.ts) instead of
    keeping it in its `waitstate` until the screen warps out (as DoSeagallopFerryScene now does), so in theory the
    field could take input in the frame's ticks left after it. Not seen: the field sleeps under the HoF screen.
  - Trainer Tower (world/trainerTower.ts): DoTrainerTowerBattle is a stand-in until W-ttower unit 2: no battle, it
    counts as won (VAR_RESULT B_OUTCOME_WON) and the map music comes back, so a challenge can be climbed without
    fighting. ShowResultsBoard / CloseResultsBoard (`ttower_showresults` / `ttower_closeresults`, which no script
    uses) validate the record but draw no window. The record times aren't XORed with an encryption key (no key in
    the port). GetFloorAlreadyCleared on the roof with every floor cleared reads a zeroed floor where the C reads
    past the set (heap memory); the roof's result changes nothing. The e-Reader sets are never read (link content).
  - VS Seeker (world/vsSeeker.ts): no quest log event. Task_VsSeeker_0
    takes the field controls lock itself (the field's overlay held the controls until the bag's callback, as for
    the Escape Rope). The movement scripts (Wait48, the trainers' emotes and step in place) run as MovementRunners
    in their own field tasks; a frozen trainer still finishes them, so UnfreezeObjectEvent has nothing to do.
    UseVsSeekerEffect_2/3 don't hold MOVEMENT_ACTION_START_ANIM_IN_DIRECTION on the player: Effect_3 waits for the
    VS Seeker anim's end itself. ClearRematchStateByTrainerId leaves the movement type of a same-row trainer other
    than the selected one alone (the C sets its `movementType` field to FACE_DOWN without changing its callback;
    the port's NpcBrain has one value for both).
  - Itemfinder (world/itemfinder.ts): GAME_STAT_USED_ITEMFINDER isn't counted (no game
    stats). ItemUseOnFieldCB_Itemfinder takes the field controls lock itself, as the VS Seeker's task does. The
    arrows and stars are Phaser sprites at the camera's corner plus their GBA screen position, drawn in the
    player's palette as it is at load (the GBA's OBJ palette 0, faded with the field); DestroyArrowAndStarTiles
    frees nothing (the texture stays; no sprite is out by then). Before EventScript_ItemfinderDigUpUnderfootItem,
    ScriptContext_SetupScript hands the task's lock to the running script instead of locking again.
  - Raise-hand movement types (entities/NpcBrain.ts, MOVEMENT_TYPE_RAISE_HAND_AND_*): leaving one zeroes the
    sprite's x2/y2 (the GBA keeps them unless ResetMovementOfRematchableTrainers zeroes them); a frozen jumper
    (any, not only `lock`'s selected object) lands before it holds still.
  - Field sounds: puddles: UpdateFeetInFlowingWaterFieldEffect's SE_PUDDLE checks the splash's `invisible`, which
    the port never sets for an object off screen (UpdateObjectEventSpriteInvisibility's bounds check).
  - Audio output (audio/output.ts, audio/worklet.ts): the PCM plays at 224 samples per 60 Hz frame, 13,440 Hz,
    not the GBA's 13,379 Hz: the port's frame is 60 Hz rather than 59.7275 Hz, so the output keeps the GBA's
    samples per frame and music is 0.46% (8 cents) higher and faster, like all the port's timing. The worklet also
    nudges its playback rate by up to ±0.5% to keep its 3-4 frame buffer filled (the page's frame loop and the
    audio clock drift apart); an underrun plays silence, a stall drops the oldest frames. The analog filtering
    after the GBA's DAC isn't modelled (sample-and-hold straight to the speakers, AUDIO_PLAN.md decision 8).
  - The PSG synth (audio/psgSynth.ts, outputCore.ts's SoundCircuit): the sound circuit makes 896 samples per frame
    (4 per FIFO sample: 53,760 Hz, 53,516 Hz at the GBA's speed); the PSG is point-sampled at 65,536 Hz as the
    GBA's DAC does (SOUNDBIAS's 8-bit resolution) and held, then averaged over each output sample's 313.5 cycles (a
    box: −0.5 dB at 10 kHz, −2 dB at 20 kHz), so the PSG comes out darker (spectral centroid) than mGBA's 65,536 Hz
    samples: ~6% for the squares, 10-14% for the noise drums (W-ref 2b: through the same averaging the two are
    equally bright); the 8-bit rounding of the sum is kept. The DirectSound samples change exactly every 1,254
    cycles (4 output samples), where the GBA's DAC picks the FIFO's current sample at its 65,536 Hz ticks (a jitter of
    up to 256 cycles, 15 µs). A frame's register writes all apply at its start, in order (CgbSound writes them in VBlank's first
    lines, ~14,000 cycles = 0.8 ms after the DMA's slot starts at VCount 150; the game logic's CgbOscOff came a
    little earlier in the frame); the FIFO samples are held back a frame
    so the PSG leads them as on the GBA. Where GBATEK and Pan Docs leave the GBA open, it follows mGBA's GBA mode
    (unsigned PSG levels, so a sounding channel adds DC; positions kept across restarts; the wave RAM rotating as it
    plays; the wave's first sample after a restart 24 cycles late), but not mGBA's shortcuts where the hardware is
    documented (W-ref 2b: the port equals a model with these at every DAC tick): a new square or noise rate takes
    effect at the timer's next reload (mGBA: lastUpdate + the new period), a stopped channel outputs 0 (mGBA holds
    its last level), NR32 changes only the volume (mGBA jumps to the next nibble), the noise plays at the envelope's
    current volume (mGBA: its last clock's) and NR34 without a restart leaves the wave's timer alone (mGBA restarts
    it). The frame sequencer's phase against the frames is the GBA's boot's (unknown): the port starts it 32,768
    cycles after NR52's switch-on or a state load, so a hardware envelope's steps can land a 64 Hz clock earlier or
    later than on a given GBA (W-ref 2b: SE_SAVE's level moves by up to 1 dB with that phase). Not modelled: obscure DMG quirks
    (the envelope's "zombie" writes, the length counter's and sweep's rarer edge cases beyond mGBA's), the analog
    output's DC blocking. When the output starts mid-song (the first key press) or misses frames (a hidden tab),
    channels started before stay silent until their next restart (CgbSound restarts on every volume change, so it
    is usually a few frames).
  - Evolution scene: on battle-test.html (no field) EVOSTATE_END's
    Overworld_PlaySpecialMapMusic is skipped: the BGM stays stopped. The help system isn't toggled; GAME_STAT_EVOLVED_POKEMON isn't kept. Evolving
    from the field uses fresh battle globals, so the backdrop follows the map's battle scene (gyms etc.) but not the
    last battle's type flags, which the GBA keeps (e.g. a Rare Candy right after a gym leader would draw the
    Leader terrain there). Mons have no language, markings, ribbons or mail, so EvolutionRenameMon always treats
    them as English and Shedinja doesn't clear those fields.
  - Summary screen: no trade-screen view or multi-battle party order; the struct Pokemon fields the port doesn't
    store read as defaults (met game FireRed, no fateful-encounter flag, English).
  - Move deleter (SelectMoveDeleterMove): on the GBA the script's `fadescreen FADE_FROM_BLACK` after the special
    runs (unseen) before the summary screen takes over, and FieldCB_ContinueScriptHandleMusic fades the field in
    afterwards. Here the script waits at the special and that `fadescreen` does the fade in (same on screen).
  - Party menu: mail, Union Room, minigames, Pokédude/Teachy TV demos are not ported. No
    field move records a quest log event (SetUsedFieldMoveQuestLogEvent, SetUsedFlyQuestLogEvent).
  - Move relearner (menus/learnMove.ts): the MUS_LEVEL_UP fanfare after a move is learned holds the screen as on
    the GBA. The C's scroll arrows are kept as they
    are: scrollPositionMaybe never changes, so with more than six entries the down arrow always shows and the up
    arrow never does.
  - Region map / Fly (menus/regionMap.ts, world/fly.ts): the bird of Fly always uses the extracted bird sheet's own palette (Red's), where the GBA draws it in OBJ
    palette 0, the player's (Leaf's frames would use hers). gExitStairsMovementDisabled isn't kept (no stair
    walk-out). The dungeon previews' third palette is zero-filled: the C loads 3 palettes from 2-palette data,
    reading on into the ROM (no preview tilemap uses it). Where the C reads a NULL sMapCursor (naming the section
    before the cursor exists, CB2_OpenRegionMap / UpdateMapsecNameBox), the port reads MAPSEC_NONE.
  - Field moves (world/fieldMoves.ts, world/fieldMoveShowMon.ts): no GAME_STAT_USED_CUT / _ROCK_SMASH. The field
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
    The Town Map, TM case and berry pouch from SELECT start their screen once the map headers the region map /
    party menu read have loaded (prepareFieldMoveMenu), a frame or more after the fade instead of in the same frame.
  - TM case (menus/tmCase.ts): no quest log (RecordItemTransaction). Not ported:
    the Pokédude's Teachy TV demo (TMCASE_POKEDUDE) and the Union Room's GIVE / EXIT menu (no link play).
  - Berry pouch (menus/berryPouch.ts): no quest log
    (RecordItemTransaction). Not ported: Berry Crush (BERRYPOUCH_FROMBERRYCRUSH), the link / Union Room context
    menus (GIVE / EXIT, EXIT) and IsHoldingItemAllowed's Enigma Berry check there (always TRUE: neither can be
    entered) and AbortBerryPouchLoading (for a failed Alloc).
  - Bag/party run in their own scene (FieldMenuScene) when opened from the field; the field side fades with the
    overworld's ScreenFade.
  - Battles: the level-up banner (exp to a mon that isn't sent out) has no mon icon; Spinda's spots aren't drawn;
    HP-as-text (SwapHpBarsWithHpText) and link/multi battles aren't implemented.
  - Battles: the level-up's vertical stripes (CreateLevelUpVerticalSpritesTask, pokemon_special_anim_scene.c) aren't
    drawn: Task_CreateLevelUpVerticalStripes (controllerCommon.ts) moves the mon to the BG and plays SE_RS_SHOP, then
    goes on at once where the GBA waits ~35-65 frames for the 18 stripes to rise. The link battles' end
    (SetBattleEndCallbacks with its m4aSongNumStop(SE_LOW_HEALTH)) isn't ported.
  - Map preview screens (Mt. Moon, Rock Tunnel, Viridian Forest...) aren't ported: warps into those sections fade
    to black like the GBA and go straight to the map, without the banner (or the flash that follows it).
  - Wild encounters: GAME_STAT_* counters aren't kept.
  - Scripted wild battles (`dowildbattle`, StartLegendaryBattle): no GAME_STAT_TOTAL_BATTLES / _WILD_BATTLES. `seteventmon` (CreateEnemyEventMon) doesn't set
    MON_DATA_MODERN_FATEFUL_ENCOUNTER (the port keeps no such field; IsBattlerModernFatefulEncounter is always
    TRUE, so it makes no difference).
  - The event islands (script/eventIslandSpecials.ts, world/deoxysRock.ts): FLDEFF_DESTROY_DEOXYS_ROCK's white flash
    (BlendPalettes / BeginNormalPaletteFade on PALETTES_BG only) is the field's fade overlay, which whitens the
    objects and the rock's fragments too for its 16 frames. Its and FLDEFF_MOVE_DEOXYS_ROCK's map num / group
    arguments are ignored (the object is looked up on the current map; `setfieldeffectargument` can't evaluate
    `MAP_NUM(...)`). ApplyGlobalFieldPaletteTint (the quest log's tints) is a no-op.
  - `setmaplayoutindex` (World.setCurrentLayout): the swapped layout replaces the current map's chunk after
    ON_TRANSITION rather than being picked before the grid is first built (same result; ON_TRANSITION can't see
    the grid on the GBA either). gSaveBlock1Ptr->mapLayoutId is saved inside the save's `location`
    (PlayerLocation.mapLayoutId), not as its own field.
  - Cable club (cable_club.c): there is no link play. TryBattleLinkup / TryTradeLinkup run as if nothing were on
    the other end of the cable (Task_LinkupAwaitConnection until B, then LINKUP_FAILED), IsWirelessAdapterConnected
    and ValidateSavedWonderCard are FALSE, IsBadEggInParty is FALSE (no bad eggs), CloseLink is a no-op.
  - Player avatar (world/playerAvatar.ts, world/bike.ts): the bike bell is item_use.c's (menus/itemUse.ts). Not ported: the warp arrow sprite on arrow mats
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
  - Surf and Waterfall (world/surf.ts): no HELPCONTEXT_SURFING, no quest log (`goto_if_questlog` never branches). FldEff_UseSurf takes the
    field controls lock at once: the C holds FieldCallback_PrepareFadeInFromMenu's (or the script's) lock until
    the task takes it, which the port's hand-offs don't. Like CreateFieldEffectShowMon, the banner waits for its
    graphics to load (UseSurfEffect_3, waterfall_1). The surf blob is the player's only `fieldEffectSpriteId`
    user, so it lives in surf.ts rather than on the ObjectEvent, and the player's sprite y2 it sets is applied
    to the Phaser sprite directly (ObjectEvent's depth ignores that 1 px). After a battle or field menu the blob
    is made again (the GBA rebuilds every sprite), so its animation restarts.
  - Dive (world/dive.ts; an R/S leftover no FRLG map reaches): no PlayRainStoppingSoundEffect (rain isn't
    ported). DiveFieldEffect_ShowMon waits for the banner's graphics to load, as Waterfall's
    does. `setdivewarp` (ScrCmd_setdivewarp) isn't ported (no FRLG script uses it), so sFixedDiveWarp is always the
    dummy warp and a map without a dive/emerge connection never dives. As in the C, that case leaves the player
    locked (DiveFieldEffect_Init's preventStep and _ShowMon's LockPlayerFieldControls are never undone).
  - Object animations follow the step's progress (first half step frame, second half standing) instead of
    sprite.c's anim tables; a sliding player (disableAnim) shows the standing frame.
  - Poké Mart: no quest log transaction history (RecordItemTransaction / RecordTransactionForQuestLog) or
    GAME_STAT_SHOPPED. The decoration marts (`pokemartdecoration*`) aren't ported (unused in FRLG).
  - Egg hatching (menus/eggHatch.ts): the MUS_EVOLVED fanfare holds "X hatched from the EGG!" for sFanfares' 220
    frames and the cry holds the scene, as on the GBA. The C
    loads five palettes from gTradeGba2_Pal, two of them past the file's end (ROM that follows); the port loads
    the file's three (the shadow tilemap uses none of the other two). BG palette 15 (the YES/NO's text) is loaded
    with the field's message box palette, which the GBA field leaves there. The mon sprite buffers are freed on
    the NO path too (the C leaks them). The hatched mon's language, met game and fateful-encounter bit aren't
    modelled.
  - Daycare (world/daycare.ts): mail isn't modelled, so a mon left holding mail doesn't have it moved into
    struct DayCareMail (StorePokemonInDaycare's MonHasMail branch) and back (and DaycareMonReceivedMail isn't
    ported). Eggs: MON_DATA_LANGUAGE isn't modelled, so CreateEgg / SetInitialEggData's LANGUAGE_JAPANESE isn't
    kept (the nickname is タマゴ). The level menu's 1 px letter spacing is dropped, as for all latin text.
    DetermineEggSpeciesAndParentSlots leaves parentSlots uninitialised in the C when neither mon is female nor
    Ditto; the port starts them at [0, 1] (no compatible pair gets there).
  - The money box and Safari stats window are Phaser MenuWindows (the field isn't on the GBA layer).
  - Pokémon Storage System (menus/pokemonStorage*.ts): no
    quest log events (SetPokeStorageQuestLogEvent) or help context. The PPU has no OBJ mosaic, so the mon shown on
    the left changes at once instead of un-pixelating (the effect's timing, which the menus wait for, is kept).
    The screen works on its own six-slot copy of the party (the C keeps empty slots while it runs) and writes it
    back, compacted, when it hands over to another screen; a mon placed after an empty party slot would move up
    early if the summary / naming screen / bag opened while the party box still showed the gap.
    MON_DATA_SANITY_IS_BAD_EGG reads FALSE and mail isn't modelled, so the bad-egg and mail checks never trigger.
  - Player's PC (ui/PlayerPcMenu.ts, menus/itemPc.ts): the mailbox is always empty (mail isn't modelled); no quest
    log events (withdrew / deposited / gave from the PC) or help contexts.
  - Save data (state/saveData.ts): one JSON save in browser localStorage instead of the flash's two 14-sector
    save slots, so there are no sector checksums, no alternating slots / save counter, no backup of the previous
    save and no encryption of money, coins and bag quantities (gSaveBlock2Ptr->encryptionKey). The save holds
    what the port keeps; left out because the port doesn't keep them: the current map's object events and object
    templates (NPC positions, setobjectxyperm changes), game stats, the quest log, mail,
    Pokédex order/mode and the Unown/Spinda personalities, the second copies of the dex seen flags, the fame
    checker, minigame records, the enigma berry, mystery gift, link records and
    the region map zoom option. The player's position is stored only when the field writes it before
    a save (`OverworldScene.storeLocationForSave`), not kept current on every step like gSaveBlock1Ptr->pos.
  - Boot and main menu (scenes/BootScene.ts, menus/mainMenu.ts): the game boots into the title screen; the
    copyright screen and intro.c's Game Freak / Nidorino movie before it aren't ported. Dev starts (`?start=`,
    `?map=`) skip the title screen and the main menu; dev `?skipIntro` (the e2e harness's default) skips the title
    screen and Oak's speech: the main menu with a save, the new game without. No MYSTERY GIFT (IsMysteryGiftEnabled isn't kept), no quest log playback ("Previously on your quest")
    before CONTINUE. SAVE_STATUS_ERROR ("the previous save file will be loaded") can't happen: one
    slot, no backup; an unreadable slot is SAVE_STATUS_INVALID ("The save file has been deleted...").
  - Title screen (menus/titleScreen.ts): no help system (HELPCONTEXT_TITLE_SCREEN: L/R do nothing). When its 2700-frame timer runs out it goes
    straight back to the title screen (CB2_InitCopyrightScreenAfterTitleScreen would replay the copyright screen
    and the intro). StartTimer1 / SeedRngAndSetTrainerId don't seed the RNG from the time spent on the title
    screen: the port seeds it at load. B+SELECT (REVISION 0's berry fix program, a multiboot program for Ruby and
    Sapphire's berry clock) does nothing. The clear save data screen (B+SELECT+UP) empties the one localStorage
    slot (ClearSaveData erases every flash sector, incl. the Hall of Fame) and its soft reset (DoSoftReset) is
    `softReset` in scenes/BootScene.ts: the scenes restart, the extracted data stays loaded.
  - Oak's speech (menus/oakSpeech.ts): no help context (HELPCONTEXT_NEW_GAME). After the naming screen the C loads 48
    colours past the background palette (out of the tiles after it) into palettes the player / rival pic overwrite
    anyway; the port loads just the palette. The trainer id is still rolled when the game state is created (see the
    RNG approximation), not by the naming screen's SeedRngAndSetTrainerId. CB2_NewGame hands only the names and the
    gender to the field, whose new GameState is NewGameInitData's.
  - Save dialog (ui/SaveDialog.ts): no help context, no
    GAME_STAT_SAVED_GAME, no quest log data. A failed write shows the save error message without
    DoSaveFailedScreen. SaveMapView isn't ported: the map view isn't saved, so CONTINUE rebuilds the map from its
    header and ON_LOAD script (metatiles a script changed later aren't restored). `special Field_AskSaveTheGame`
    (task50_save_game) doesn't switch to HELPCONTEXT_SAVE.
  - Option menu (menus/optionMenu.ts): no help context (HELPCONTEXT_OPTIONS). The L=A button mode applies on the GBA-layer
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
  - Elevators: UpdateEscapeWarp isn't kept on warps.
  - Field ListMenu (ui/FieldListMenu.ts): the quest log's QL_AvoidDisplay is ignored.
  - PC: HallOfFamePCBeginFade logs "not implemented" and goes straight back to the PC menu.
  - Hall of Fame (menus/hallOfFame.ts): no Champion
    Ribbons (mons have no ribbons; the event tickets come anyway: see "Deliberate QOL changes"); the help system isn't toggled and the
    quest log isn't saved; a failed save carries on (no DoSaveFailedScreen / gGameContinueCallback).
    Other game stats than GAME_STAT_ENTERED_HOF and
    GAME_STAT_FIRST_HOF_PLAY_TIME aren't counted.
  - Pokédex screen (menus/pokedexScreen.ts, menus/pokedexArea.ts): no help system context. The mon page and the habitat pages load the shown mons'
    pics, palettes, footprints and icons (for the area page) when they're first drawn (fetched on demand, not
    preloaded; the battle preloads the registered page's), so the first view of a mon or a page can take a frame or
    two longer. Unown and Spinda are drawn with personality 0 (the save's unownPersonality / spindaPersonality
    aren't kept; Spinda's spots aren't drawn anywhere). The anticheat's second and third copies of the seen flags
    aren't kept (one `dexSeen` set), so "caught" just needs "seen" too. The Pokédex keeps the field's DISPCNT,
    which the port sets in FieldMenuScene since the field isn't on the GBA layer.
  - Trainer card (menus/trainerCard.ts): no help system context. The berry picking and Pokémon Jump records (a star for 200 of each) and the link stats are always 0 (no
    link minigames), so the back never shows its link battle / trade / Berry Crush / Union Room lines (the easy chat
    profile is saved since save version 5, but only a link card prints it). The flip's per-line BG0VOFS gives line L buffer[L] (the PPU's
    HBlank convention), where the GBA's HBlank interrupt sets it for the line after, a one-line shift of the squash.
    LoadMonIconGfx's 96 colours read 48 past gMonIconPalettes on the GBA; those palettes (BG 8-10) are zeros here and
    no icon uses them.
  - Credits (menus/credits.ts): a map scene loads asynchronously, so it can start
    a frame or two later than on the GBA (behind a black screen; the Pokémon scene → map switch, synchronous on the
    GBA, also takes a few frames). Before the first one the credits wait a few frames for their maps and graphics.
    SoftReset (BootScene's `softReset`) restarts the boot flow (the title screen) with a fresh Overworld scene and
    GameState; other module-level state isn't reset, and intro.c's movie isn't ported.
  - PPU: rotation/scaling BGs (modes 1 and 2) ignore BG mosaic.
  - Interaction metatiles whose scripts need unported screens/specials (Town Map, cable club monitors) start their scripts and hit the unimplemented-special warnings.
  - No-op specials (`NO_OP` in `script/specials.ts`): quest log, help system, fame checker, GameCube link flags,
    CloseLink.
  - Player names are "PLAYER"/"RIVAL" until Oak's intro exists.
  - No-op specials (`NO_OP` in `script/specials.ts`): quest log, help system, fame checker, GameCube link flags.
  - Player names are "PLAYER"/"RIVAL" in dev starts and with `?skipIntro` (the e2e harness), which skip Oak's speech.
- **Approximations:**
  - sound.c (gba/sound.ts, audio/frame.ts): the engine's logic runs every frame, output or not, so fanfare, `waitse`, `fadeoutbgm` and IsSEPlaying waits time like the GBA. Task_Fanfare is a
    "sound task" run from AgbMainFrameEnd after the frame's callbacks, not a gTask: ResetTasks doesn't remove it (on
    the GBA a screen's ResetTasks during a fanfare would drop it and leave the BGM paused; no FRLG screen does that
    mid-fanfare), and a screen task that polls IsFanfareTaskInactive in the frame the counter runs out sees it a
    frame later than a task ordered after Task_Fanfare would. The quest log's playback paths (no fanfare
    song, the BGM commands skipped, PlaySE skipped) aren't ported. The script engine models SetupNativeScript's frames
    (a native wait starts checking the next frame, and the script goes on the frame after it holds) only for the
    audio commands; the port's other waits check in the same frame.
  - Cries (gba/sound.ts): Task_DuckBGMForPokemonCry is a sound task like Task_Fanfare (same caveats: ResetTasks
    doesn't remove it, and it runs after every screen task of the frame, as a priority-80 task after the usual
    priority-0 ones would). PlayCry_ReleaseDouble ducks in multi battles too (BATTLE_TYPE_MULTI is link only and
    never set); the quest log's playback (PlayCry_Script's skip) and the text printer's auto-scroll
    (gTextFlags.autoScroll, link / recorded battles) aren't ported.
  - Map music (gba/overworldMusic.ts, overworld.c's music block): the warps load the destination's header before
    their fade starts (WarpFadeOutScreen and TryFadeOutOldMapMusic wait for it; it's cached after SetupWarp, so
    usually the same frame). The warps' PlayRainStoppingSoundEffect isn't ported (rain isn't). DoStairWarp
    runs as DoWarp (no stair walk: its TryFadeOutOldMapMusic and SE_EXIT come at once rather than after the
    player's step and delay). `warpdoor` (unused in FRLG) goes straight to Task_DoorWarp's warp: no door SE or
    animation. The Hall of Fame's DoWarp (SetWarpsToRollCredits, menus/hallOfFame.ts) loads the
    destination's header before its TryFadeOutOldMapMusic (a frame or two later than on the GBA, behind the black
    screen) and has no WarpFadeOutScreen (the screen is black already). Of the screens that come back through FieldCB_ContinueScriptHandleMusic,
    SelectMoveDeleterMove's field callback (menus/partyMenuSpecials.ts) plays no Overworld_PlaySpecialMapMusic (the
    deleter never changes the map music, so nothing is missed). The ambient cries' Task_RunTimeBasedEvents is a step
    of the field's tick after its tasks (OverworldScene.tickField); it counts while the field is free as the port
    sees it (no script, overlay, field-task lock, trainer approach, warp or map load in flight), so a connection's
    asynchronous load (no GBA frames) doesn't count down. Cable club /
    union room / link-return warps (DoCableClubWarp, ReturnFromLinkRoom, DoUnionRoomWarp) aren't ported (no link
    play).
  - `fadescreen` is an alpha overlay, not a palette blend: same ramp and timing, not bit-identical. In a shaded map the
    fade in is the weather's (FadeInScreen_RainShowShade: 16 frames, `delay` unused): the palettes are at gamma index
    3 under the overlay from the first step and the overlay follows its blend coefficient, where the C blends the
    shifted colours toward the fade colour (ApplyGammaShiftWithBlend).
  - `showmonpic`: the sprite appears when its PNG has loaded.
  - The Pewter Museum's fossil pics (ui/MuseumFossilPic.ts): a Phaser image over a MenuWindow, like `showmonpic`,
    not an OBJ in palette 13 over BG0 (the field isn't on the GBA layer); the graphics and positions are the C's.
  - Prof. Oak's Pokédex rating: `waitfanfare` holds the script for MUS_DEX_RATING / MUS_EVOLVED's sFanfares counts,
    as on the GBA; BackupHelpContext / RestoreHelpContext are no-ops (no help system).
  - Text colour is reset to NPC_TEXT_COLOR_DEFAULT when a script starts, not in ProcessPlayerFieldInput.
  - The RNG (`random.c` formula) is seeded from `Math.random` (or `?seed=` in dev); the trainer id is rolled when the game state is created instead of in Oak's intro.
  - A mon's met location is the MAPSEC_* name, not the numeric id.
  - Battle transitions draw the field on the GBA layer (`world/fieldGbaScreen.ts`): BG1-3 come from the map
    grid as DrawWholeMapView would lay them out (the ring buffer anchored at the camera, tile offsets 0), so a
    scrolled BG shows the same neighbouring rows/columns the GBA's 32x32 tilemaps hold. Object sprites stay
    Phaser's and are copied into an OBJ bitmap layer each frame (behind OAM sprites, priority from their depth
    band); their colours follow palette fades/blends through two probe OBJ palettes, not their real palettes.
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
    check and the gCamera map-change fixups in the grass callbacks aren't needed. A reflection drawn with the
    object's own sheet (a graphics id without a reflection sheet) takes that sheet's weather shift (GAMMA_ALT), not
    the reflection palette's (GAMMA_NORMAL).
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
  - Slot machine: in `menus/slotMachineLogic.ts` the state's machineBias, biasCooldown and reelStopOrder start at 0;
    PlaySlotMachine Allocs the state without zeroing it, so on the GBA they start as whatever the heap held. The
    screen's payout (`menus/slotMachine.ts`) waits for MUS_SLOTS_WIN / MUS_SLOTS_JACKPOT's sFanfares counts, as on
    the GBA. HBlankCB_SlotMachine's
    per-line squash and darkening of the reels apply to the line REG_VCOUNT names (the PPU calls it before drawing
    that line); the GBA's HBlank interrupt for line L sets them for line L + 1, a one-line shift. After
    MainTask_ExitSlots frees the screen, the C's Task_SpinReels still runs that frame through the NULL gfx manager;
    the port skips it. No quest log entry (SetQLPlayedTheSlots) and no GAME_STAT_SLOT_JACKPOTS.
  - The Game Corner's photo printer flash (FldEff_PhotoFlash) is the field's FADE_FROM_WHITE (16 → 0 in steps of 2)
    where the C fades from 15 to 0 in steps of 3, a few frames longer.
  - The m4a engine (src/audio/, AUDIO_PLAN.md): a note on a keysplit entry that voicegroups.json has as
    null (a ROM pointer byte, outside the table's key range) is dropped, where the GBA would play the subgroup voice
    that byte names; no FRLG song plays one (tests/unit/m4aChannels.test.ts).
  - The m4a mixer (audio/m4aMixer.ts, W-m4a 3): mixes as m4a_1.s's SoundMainRAM does, byte for byte, with two
    differences in what's read past a sample's ends: a reverse sample's interpolation before its first byte reads 0
    (the ROM reads the WaveData header), and the cries are the WAVs' PCM, not SoundMainRAM_Unk2's DPCM decode
    (AUDIO_PLAN.md decision 4; the decoded blocks equal the WAVs). The mixing is skipped (bookkeeping only) while
    the output doesn't want frames (headless, `?audio=0`), and samples.bin loads only when the output is on.
    ReloadSave's SetPokemonCryStereo (reset_save_heap.c, the link's save reload) has no caller: no link play.
  - Field weather (world/weather.ts, W-weather unit 1): only WEATHER_NONE, SUNNY and SHADE are ported.
    WEATHER_FOG_HORIZONTAL (Pokémon Tower 3F-7F and the Lost Cave's 14 rooms) runs as WEATHER_NONE until
    W-weather unit 2, and the weathers no FRLG map or script reaches (rain, snow, thunder, ash, sandstorm, diagonal
    fog, underwater, drought, downpour, bubbles) run as WEATHER_NONE and log once (POSTGAME_PLAN.md decision 1);
    their saved number is kept. The gamma shift is applied to the map's atlases (tilesetVram's faded palettes) and to
    the field's sprite sheets redrawn in place (world/weatherTextures.ts: `spr_*` GAMMA_ALT, their reflection sheets
    and the loadfadedpal field effects GAMMA_NORMAL), not to palette RAM: a connected map with another secondary
    tileset isn't shifted until it's the current map. FadeScreen's fade-out copy of the shifted palettes into the
    unfaded buffer (CpuFastCopy(gPlttBufferFaded, gPlttBufferUnfaded)) isn't ported: on the GBA a fade out and back
    in on the same map without a palette reload (a script's `fadescreen` pair) shifts the shaded colours again; here
    the fade in shifts the colours as loaded. Sweet Scent's and the battle transitions' SetWeatherScreenFadeOut /
    WeatherProcessingIdle aren't called (Sweet Scent's red blend is an overlay, so the shade stays where the GBA's
    fade back ends on the unshaded palettes). PreservePaletteInWeather (the field move's mon pic) isn't needed: that
    pic isn't one of the field's sprites. TranslateWeatherNum's Route 119 / 123 cycles (R/S leftovers) use stage 0
    (no weatherCycleStage in the save). A dev start (`?map=`) skips CB2_NewGame's fade in from black, as before,
    but runs its weather half, so the map is shaded from the first frames. A save from before version 7 has no
    weather: CONTINUE gives WEATHER_NONE until the next map load sets the map's.
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
- **The Hall of Fame gives the event tickets** (`GiveEventTickets` in menus/hallOfFame.ts; POSTGAME_PLAN.md decision
  2). The port follows REVISION 0, where the Mystic and Aurora Tickets (Navel Rock, Birth Island) come only through
  Mystery Gift (link content). EnterHallOfFame's `#if REVISION >= 0xA` block (FireRed 1.1) gives both, with
  FLAG_ENABLE_SHIP_NAVEL_ROCK / _BIRTH_ISLAND and FLAG_RECEIVED_MYSTIC_TICKET / _AURORA_TICKET, when a party mon
  gets its first Champion Ribbon and the bag has no Aurora Ticket. The port has no ribbons, so it gives them on any
  entry while the bag has no Aurora Ticket; saves past the Hall of Fame get them on their next entry.
- **A mute key, M** (`input/Input.ts` listenForOutputKeys, `audio/output.ts`; AUDIO_PLAN.md decision 10). The GBA
  has no volume control; M toggles all sound output on and off. It only silences the output: the m4a engine runs
  on, so nothing times differently. The setting is kept in localStorage (`firered-phaser:audio-muted`), not in
  the save. Ignored with Ctrl / Cmd / Alt held and in text fields (the battle test panel).
