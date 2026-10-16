# Change log

One entry per change, newest at the bottom. Append only. Search it rather than reading it
end to end.

### Milestone 1: overworld
- Vite + TS + Phaser 3 scaffold; extractor for maps, tilesets, sprites.
- Walkable overworld with connections, warps, ledges, NPCs. Verified Player's House 2F → 1F → Pallet Town → Route 1.

### Tileset de-duplication
- Atlases split into per-primary + per-pair (with palette-dependent "override" metatiles). 3.6 MB → 1.2 MB.
  Verified pixel-identical to the old per-pair render for all 60 pairs.

### Text engine + scripts
- Input module: A=Z/Space, B=X, Start=Enter, Select=Backspace, L=A, R=S, D-pad=arrows (WASD dropped).
- Extracted fonts, charmap, strings, dialogue frame, script instruction streams, constants.
- Text printer ported from `RenderText`; message box from `field_message_box.c` / `WindowFunc_DrawDialogueFrame`.
- Script interpreter runs the decomp's own scripts at macro level; `msgbox` goes through the decomp's std scripts.
- Verified: signs, NPC dialogue across multiple pages, female NPC red text, dialogue closes and returns control.
- Fixed: the A press that closes a message could re-trigger the interaction in the same frame
  (field input now only runs if no script was active at the start of the frame, as on the GBA).

### Menus
- Std-framed windows (`MenuWindow`), generic cursor menu (`Menu`), YES/NO box, start menu shell.
- `yesnobox` now shows the real menu; verified YES → 1, NO → 0, B → 0 via `Std_MsgboxYesNo`.
- Fixed: an overlay handing off to another (start menu → notice) was immediately cleared.

### Oak sequence fixes (user report)
- A + held direction: A is now checked before movement (ProcessPlayerFieldInput order), so you can talk while still holding a direction.
- `LOCALID_*` names weren't resolved (they're generated per map from map.json `local_id`), so `addobject`/`applymovement` on NPCs targeted nothing → Oak never appeared. Now resolved per map; unknown ids warn.
- `addobject` spawned asynchronously (sprite still loading). All of a map's object sprites are now preloaded on map entry and spawning is synchronous.
- Player stayed invisible after `set_invisible` + warp. Warps now reset player visibility (the GBA recreates the player object).
- Extractor now expands assembler macros defined inside script files (e.g. movement macros in PalletTown/scripts.inc).
- Door animation commands stubbed (no animation yet).
- Verified: trigger → Oak appears → leads player to lab → lab scene with rival plays out.
- Blocking the rest of the lab (starter choice + rival battle): `special`/`specialvar` (10+), buffer commands,
  `showmonpic`/`hidemonpic`, `givemon` (needs party/species data), `giveitem_msg`/`checkitem`/`removeitem` (bag),
  `fadescreen`, `famechecker`, `trainerbattle_earlyrival` (battle engine).

### Oak trigger off-by-one (user report)
- Symptom: 1-tile gap between Oak and player; player walked over the lab's bottom row on the way to the door.
- Cause: holding Up onto the trigger tile. The coord trigger started the script on arrival, but field input for that
  same frame had already been allowed, so the player took one extra step north. All scripted player moves are
  relative, so everything after was shifted by a row.
- Fix: re-check script/overlay state after arrival before processing movement (matches ProcessPlayerFieldInput
  returning after TryStartCoordEventScript).
- Verified for both triggers, holding Up: player stays on (12,1)/(13,1), Oak stops at (12,2)/(13,2), player ends at
  (15,14) and Oak at (16,14), both enter the door at (16,13), and the lab scene starts.

### Missing Oak in the lab (user report)
- The lab scene does `removeobject` (sets FLAG_HIDE_OAK_IN_HIS_LAB) → `setobjectxyperm 6,3` → `clearflag`, with no
  `addobject`. On the GBA, Oak comes back because `TrySpawnObjectEvents` runs every time the camera moves a tile and
  spawns any unspawned template in view whose hide flag is clear.
- Implemented that view-window spawn check (player-relative x −9..+10, y −7..+9, from MAP_OFFSET bounds), run after
  every completed player step, scripted or not.
- Verified: Oak walks up, is removed, and reappears at (6,3) as soon as the player takes a step.
- Not yet: RemoveObjectEventsOutsideView (despawning objects that leave the view). Harmless for now.

### Starter selection: Pokémon, bag, specials
- Extractor: `pokemon/species.json` (gSpeciesInfo + names + level-up learnsets + national dex), `moves.json`
  (gBattleMoves + names), `items.json` (from the decomp's items.json), `tables.json` (gExperienceTables evaluated
  from the EXP_* macros, sNatureStatTable, gStdStringPtrs, dex counts), `pokemon/front/<species>.png`.
  `#define` parsing moved into `parse_defines` (shared by scripts and pokemon).
- Event macros made only of other script commands (giveitem_msg, msgreceiveditem, famechecker,
  trainerbattle_earlyrival, ...) are now expanded at extraction, with default arguments.
- `pokemon/Pokemon.ts`: CreateMon/CreateBoxMon, GiveBoxMonInitialMoveset, CalculateMonStats (incl. the u16
  ModifyStatByNature), GetLevelFromMonExp, gender, CalculatePPWithBonus. `util/random.ts`: the GBA LCG.
- `state/Bag.ts` (item.c), GameState party/bag/trainer id/money/Pokédex.
- Script commands: givemon, showmonpic/hidemonpic (`ui/MonPicBox.ts`), fadescreen (`ui/ScreenFade.ts`, follows
  UpdateNormalPaletteFade timing), item commands, buffer commands, special/specialvar/waitstate,
  trainerbattle/dotrainerbattle/gotopostbattlescript, trainer flag commands.
- Text colour now lives in VAR_TEXT_COLOR/VAR_PREV_TEXT_COLOR like the GBA (EventScript_RestorePrevTextColor
  depends on it); `setvar` accepts LOCALID_* names (RIVAL_STARTER_ID); NPC interaction sets VAR_LAST_TALKED
  (`removeobject VAR_LAST_TALKED` removes the chosen ball).
- Fixed: `STR_VAR_n` arguments are names, not constants (the `stringvar` macro maps them to 0..2).
- Verified in headless Chrome: Bulbasaur and Charmander paths (party mon species/level/moves/stats checked by hand
  against CalculateMonStats), rival takes the counter starter, battle trigger (right and left) → stub → rival
  exits, scene var 4 + FLAG_BEAT_RIVAL_IN_OAKS_LAB + trainer flag set. Route 1 Potion, Oak's 5 Poké Balls
  ("put the POKé BALLS in the POKé BALLS POCKET"), Mom's heal with fade to black and back.

### Decomp audit of the starter milestone
- Constants that were hardcoded are now read from the extracted defines: Pokémon constants (`readPokemonConstants`:
  MAX_LEVEL, PARTY_SIZE, SPECIES_SHEDINJA, ITEM_POKE_BALL, MON_GIVEN_TO_*, ...), FADE_*, POCKET_*,
  NPC_TEXT_COLOR_*, DIR_*, LOCALID_PLAYER. Only the bag's 999 stack limit stays a literal (it is one in item.c).
- Checked against the decomp: starting money 3000 (NewGameInitData), bufferleadmonspeciesname (GetLeadMonIndex).
- Fixed: losing an early-rival battle only heals with RIVAL_BATTLE_HEAL_AFTER (CB2_EndTrainerBattle); otherwise
  it's a white-out (not implemented, warns). GetPartyMonSpecies returns SPECIES_EGG for eggs (MON_DATA_SPECIES_OR_EGG).
- Added "Known deviations from the decomp" above.


### Battle engine: rival battle playable (controllers, BattleScene)
- Controllers ported from battle_controller_player.c, battle_controller_opponent.c and
  battle_controller_oak_old_man.c (incl. Oak's PrintOakText_* narration with the healthbox palette trick
  DoLoadHealthboxPalsForLevelUp, BtlCtrl_Draw/RemoveVoiceoverMessageFrame, the Old Man's simulated input).
- `Cmd_drawlvlupbox` now ported against the GBA layer (InitLevelUpBanner, Slide*LevelUpBanner, DrawLevelUpBannerText,
  DrawLevelUpWindowPg1/Pg2); BattleUi shrank to input/audio/save-data hooks — windows, yes/no cursor and fades call
  battleWindow.ts / palette.ts directly like the C.
- `BattleScene`: CB2_InitBattle/CB2_InitBattleInternal video setup, CB2_HandleStartBattle (single-player states),
  BattleMainCB2, VBlankCB_Battle, ReturnFromBattleToOverworld → `onEnd`. `OverworldScene.startTrainerBattle` replaces
  the stub: StartTrainerBattle's type flags (FIRST_BATTLE for RIVAL_BATTLE_TUTORIAL), BattleSetup_GetTerrainId (new
  metatile predicates in behaviors.ts), map battle scene/type/weather, trainer speeches, context text colour.
- Fixes found by running it: `PIXEL_FILL(c)` in sTextOnWindowsInfo was extracted as `c` (striped text boxes);
  small-font glyphs are packed two per latfont cell (DecompressGlyph_Small) — healthbox names/levels were blank;
  pokedex.h/berry.h added to the define headers; `K` must be initialised before listing gfx symbols.
- Verified headless: full Oak's Lab rival battle (Charmander vs Squirtle) to a win, Lv5→6 with both level-up pages,
  back in the lab overworld. `browser-test.mjs` now prints exception messages.

### Battle test harness
- `battle-test.html` + `src/battleTest.ts`: a standalone page that loads the assets and launches `BattleScene`
  without the overworld. A side panel edits both parties (datalists of species/moves/items, validated),
  trainer (any gTrainers id: name, pic, AI flags and items come from it) or wild, double battles, IVs
  (random/max/zero), terrain and text speed; random teams/moves buttons; config kept in localStorage.
- `BattleStart.enemyParty` / `double` (test-only) replace gEnemyParty and force BATTLE_TYPE_DOUBLE after
  CreateNPCTrainerParty. `npm run dev:battle` opens the page.
- Verified headless: trainer single (Giovanni intro, AI using Bite), wild single on grass terrain, and a trainer
  double battle, each to B_OUTCOME_WON.

### Party menu and bag
- Ported party_menu.c, item_menu.c, bag.c, item_use.c, item_menu_icons.c, pokemon_icon.c, list_menu.c,
  menu_indicators.c (scroll arrows), menu.c / new_menu_helpers.c / menu_helpers.c / text_window.c,
  reshow_battle_screen.c and money.c's money box, plus pokemon.c's PokemonUseItemEffects (now complete, in and out
  of battle), PokemonItemUseNoEffect, GetEvolutionTargetSpecies, CanMonLearnTMHM, Battle_PrintStatBoosterEffectMessage.
- gMain + `GbaHostScene`: the battle's CB2s/VBlank moved to `battle/battleCallbacks.ts` so the menus can replace
  and restore them; the player and Oak/Old Man controllers now open the real bag/party (incl. InitOldManBag and
  Oak's first-battle party narration).
- Extractor: menu graphics prefixes (party_menu, item_menu, items, help_system) and mon icons; anim tables for
  party_menu.c / item_menu_icons.c / pokemon_icon.c / menu_indicators.c (4-arg ANIMCMD_FRAME now parsed);
  `menus.json`; more define headers (item.h, list_menu.h, menu_helpers.h, task.h, ...), `((u8) -N)` values;
  gPPUpAddValues and sStatsToRaise in the mechanics tables.
- Fixes found on the way: glyph colour 0 now leaves the window pixel untouched (GLYPH_COPY), so text on a
  differently-filled background no longer punches holes; GetStringWidth ported from text.c (latin glyphs don't add
  letter spacing, control-code argument lengths).
- Verified headless: field party menu (render, action menu, SWITCH slide, back to the start menu), bag (pockets,
  scroll arrows, icons, descriptions, context menu), Potion on a hurt mon from the bag (HP bar animates 12→28, bag
  3→2, back to the bag), Rare Candy (Lv5→6, both stats pages), giving a held item; in battle: bag → Potion at full HP
  ("won't have any effect"), X Attack ("ATTACK rose!"), Poké Ball throw → B_OUTCOME_CAUGHT, cancel → battle screen
  rebuilt, party SHIFT → "Go! PIDGEY!"; a trainer battle still runs to B_OUTCOME_WON.
- Not verified: Oak's first-battle narration in the party menu (needs the lab rival battle), the Old Man bag.

### Summary screen
- Ported pokemon_summary_screen.c (all four pages, page flips with the BG slide and HP/EXP bar sprites, switching
  mons with UP/DOWN, the move details page with move switching, select-a-move-to-forget mode), plus the pieces it
  reaches for: trainer_pokemon_sprites.c (mon pic sprites), mon_markings.c (marking combo sprite),
  dynamic_placeholder_text_util.c, BlitMenuInfoIcon / ListMenuLoadStdPalAt (list_menu.c), SafeFreeMonIconPalette,
  StringCompareWithoutExtCtrlCodes, GetMapName, and text.c's keypad icons (DrawKeypadIcon, their widths in
  GetStringWidth).
- Wired like the C: party menu SUMMARY → ShowPokemonSummaryScreen → back with GetLastViewedMonIndex; learning a 5th
  move from the party menu (TM/Rare Candy/tutor) and in battle (Cmd_yesnoboxlearnmove → ReshowBattleScreenAfterMenu,
  waiting for BattleMainCB2) use ShowSelectMovePokemonSummaryScreen + GetMoveSlotToReplace. The BattleUi
  `selectMoveToForget` stub is gone. The TM path's forget animation is skipped like the other item-use animations.
- Extractor: graphics/summary_screen/ and graphics/misc/ prefixes; anim tables for pokemon_summary_screen.c and
  mon_markings.c; menus.json gains natureNames, abilityDescriptions, moveDescriptions, mapsecNames, menuInfoIcons;
  defines gain pokemon_summary_screen.h, mon_markings.h, data.h and the MAPSEC_* enum (rendered from the
  region_map_sections.json template). fonts.json gains sKeypadIcons.
- Fixes found on the way: the decomp now names glyph sheets `.hwlatfont`/`.fwlatfont` and latin_small.png is a plain
  8x16-cell sheet, so the font extractor had been producing no fonts; it now matches both and records `halfWidth`.
  `state.currentMapSection` was never updated (caught/given mons were met at MAPSEC_NONE); the overworld now sets it
  and `state.currentMap` on every map load.
- Verified headless: field party menu → SUMMARY on Charmander (INFO with type icon, OT/ID, nature + "Met in PALLET
  TOWN" memo; SKILLS with yellow HP bar, EXP bar, ability; KNOWN MOVES; move details), DOWN to a poisoned Pidgey
  holding an Oran Berry (PSN icon, two type icons), switching Tackle/Sand-Attack (party data swapped), B back to the
  party menu with Pidgey selected. In battle: Pidgey Lv8 → 9 learns GUST, "delete a move?" YES opens the
  select-move summary (GUST as the 5th row, "PICK" only), choosing SAND-ATTACK → "1, 2, and… Poof!".
- Also verified with an injected party: a shiny Charmander (shiny border palette, star, shiny pic), a Pidgey with
  cured Pokérus (the dot by the ball), an egg (egg pic, "almost ready to hatch", Day-Care memo, CANCEL-only
  controls), and Rare Candy on a Lv12 Charmander with four moves (Lv13, the forget summary lists METAL CLAW,
  Growl → Metal Claw with 35 PP).
- Not verified: the TM forget path (TMs can't be used until the TM Case exists). Eggs show their species name
  because nothing creates eggs yet (CreateEgg would set the "EGG" nickname).

### NPCs across map connections (user report)
- Report: leaving Pallet Town north, the sign lady (standing at the Route 1 entrance once
  FLAG_PALLET_LADY_NOT_BLOCKING_SIGN is set) vanished on the crossing while still on screen, and popped back on return.
- Cause: every map load destroyed all objects. On the GBA, LoadMapFromCameraTransition leaves gObjectEvents alone;
  the old map's objects keep their mapNum/mapGroup and are only removed by RemoveObjectEventsOutsideView once
  both their current and initial coords leave the view window.
- Fix: `Npc` records its `map` and spawn coords; each camera step runs UpdateObjectEventsForCameraUpdate
  (TrySpawnObjectEvents + RemoveObjectEventsOutsideView). Warps still ResetObjectEvents, and now spawn only in view
  like InitObjectEventsLocal. Local-id lookups (`objectByLocalId`, `removeObject`, `addObject`, spawn dedup) are
  scoped to the current map (GetObjectEventIdByLocalIdAndMap); collision and talking still see every object.
- Verified headless: with the lady at (12,2), walking north she stays on screen on Route 1, is removed at 10 rows
  away, and walking back she is the same object (no duplicate).
- As on the GBA, a neighbouring map's objects aren't spawned until you cross into it, so an object that was
  already removed pops in at the crossing.

### Neighbour-map NPCs (QOL) + template reload fix (user request)
- Template bug: `templates` cached each map's object templates for the whole session, so `setobjectxyperm` /
  `setobjectmovementtype` edits never reverted. The GBA reloads them from the header on every map entry
  (LoadObjEventTemplatesFromHeader in LoadMapFromWarp / LoadMapFromCameraTransition), so they only last while you're
  on the map. Now `onMapLoaded` reloads the current map's templates before ON_TRANSITION. Effect: after the start
  menu has been opened, the Pallet sign lady goes back to (3,10) and wanders instead of staying at the Route 1 entrance.
- QOL: replaced the view-window spawn/despawn from the previous entry with spawning all objects of the loaded
  (current + connected) maps; see "Deliberate QOL changes". `World.loaded` exposes the loaded chunks; `Npc` keeps its
  chunk, the template it spawned as, and a `stale` flag.
- Verified headless: in Pallet, Route 1's and Route 21 North's NPCs are out; stepping onto Route 1 drops Route 21
  North's and adds Viridian's, and the sign lady stays at (12,2) all the way up Route 1 and back. Re-entering Pallet
  after setting FLAG_OPENED_START_MENU: she's marked stale and stays put while on screen, and is respawned at (3,10)
  wandering once off screen; warping in gives (3,10) straight away and VAR_MAP_SCENE_PALLET_TOWN_SIGN_LADY = 2.

### Invisible sprites north of the Viridian sign (user report)
- Report: walking north from Pallet into Viridian, the player vanished past the sign at (20,16) and the old man was
  invisible (but still blocked the path); walking back south past the sign the player reappeared.
- Cause: world origins are never rebased, so after walking up from Pallet, Viridian sits at y = -80 tiles. Object depth
  was `1000 + pixel y`, which went negative from world tile y -64 (the sign's row) and sorted under the `below`
  tile layer at depth 0.
- Fix: depth bands in `MapChunk.ts` are now symmetric around 0 (border/below at -1e6, objects at pixel y,
  above at +1e6), which leaves ±62,500 tiles of room either way. (Superseded by "GBA sprite subpriority" below:
  depth no longer depends on world position. The old man had a second, separate cause; see "Invisible Viridian
  old man".)
- Verified headless by reloading Viridian at origin (0,-80) and walking up x=22 past the sign: the player and the
  Viridian NPCs are drawn (they weren't before the fix). `?map=` always loads at origin 0, so it can't reproduce
  bugs that depend on world position; for those, `await s.world.load(name, ox, oy)` then `s.player.setPosition(...)`
  and `await s.onMapLoaded(false)`.

### Sprite priority from elevation (user request)
- Ported sElevationToPriority / UpdateObjectEventElevationAndPriority / ObjectEventUpdateElevation. `ObjectEvent`
  now has `currentElevation` (collision; IsElevationMismatchAt), `previousElevation` (last non-zero; picks the
  priority), `priority` and previousCoords. Update points follow the ground-effect hooks: spawn and
  `setobjectxy`/warp (MoveObjectEventToMapCoords), step begin (a jump's halfway point), and step end; walking in
  place has none. The update is skipped while either coord is on elevation 15. NPC elevations used to stay fixed at
  their template values; now they're updated like the player's.
- Depth bands (`objectDepth` in MapChunk.ts): `below` (BG3+BG2) < priority-2 objects < `above` (BG1) < priority-1
  objects < UI. Only elevations 0, 1, 3, 4 and 5 occur in map data, and 4 is the only raised one (Victory Road,
  Cerulean Cave, Seafoam, Kindle Road, a corner of each Pokémon Center).
- Verified headless on Victory Road 1F: (10,10) elev 3 → stairs (10,9) elev 0 (priority stays 2) → platform (10,8)
  elev 4 (priority 1, depth 1.5M + y) and back down to priority 2; the Cooltrainer at elevation 4 spawns at
  priority 1. Pallet's Oak trigger and the Viridian sign walk are unchanged (priority 2).

### GBA sprite subpriority (user request)
- Replaced the exact pixel-y sort with SetObjectSubpriorityByElevation: `subpriority = sElevationToSubpriority[prevElev]
  + ((16 - (((screenBottom + 8) & 0xFF) >> 4)) << 1) + 1`, i.e. 16 px screen rows, lower rows in front. Ties
  go to the sprite whose top is lower on screen, as in SortSprites (oam.y compare). `objectDepth(priority,
  subpriority, screenTop)` packs this; depth no longer depends on world position at all.
- Like AnimateSprites → CameraUpdate, every object recomputes its subpriority each frame against last frame's
  camera (`field.cameraTop`, gSpriteCoordOffsetY), then the camera is updated. The player's feet are at screen y 88
  (derived from SetSpritePosToOffsetMapCoords + UpdateCameraPanning), matching our camera framing.
- Verified headless: at rest the player's subpriority is 136 (115 + 20 + 1), 104 on Victory Road's raised
  platform (base 83); NPCs n rows above get 2n more. While walking, the player's screen bottom reads 89 (one
  frame of camera lag, as on the GBA). Pallet's Oak trigger and the Viridian sign walk are unchanged.

### Camera ignores jump lift
- The camera followed the player sprite including the jump arc, so the whole screen bobbed on ledge jumps. On the
  GBA the camera object copies the player sprite's x/y but not y2 (CameraObject_1), and jumps animate y2, so the
  screen scrolls steadily while the player arcs. `ObjectEvent.anchor` is now the lift-free position, and the camera
  follows that.
- Verified headless on Route 1's ledge at (4,5): camera scrollY now rises linearly (-8 → 23) through the jump; before,
  it stalled and then caught up with the arc.

### Invisible Viridian old man (user report)
- Report: after the depth fix, the tutorial old man north of the Viridian sign was still invisible (but blocking).
- Cause: his template uses `OBJ_EVENT_GFX_VAR_0`, which ViridianCity_OnTransition points at OLD_MAN_LYING_DOWN /
  OLD_MAN_1 through `VAR_OBJ_GFX_ID_0`. Nothing resolved dynamic graphics ids, so there was no sprite sheet and
  `spawnNpc` silently returned nothing (the blocking is the map's coord event, not the object).
- Fix: `resolveGraphicsId` ports SetObjectEventDynamicGraphicsId / GetObjectEventGraphicsInfo (VAR_OBJ_GFX_ID_n,
  out-of-range → LITTLE_BOY). Sprites are preloaded again after ON_TRANSITION/ON_LOAD with the resolved ids; an
  object is marked stale if its resolved graphics changed; spawn failures now `console.warn` once per id.
  A neighbour map's var-graphics objects aren't spawned until that map is current, since its ON_TRANSITION hasn't
  set the vars yet (see "Deliberate QOL changes": neighbour spawning).
- Verified headless: walking north from Route 1 (10,3) up x=22, the old man is drawn lying at (21,11) and the
  coord trigger starts beside him; Pallet's Oak trigger unchanged.

### Dev start preset: after the rival battle (user request)
- `?start=after-rival[&starter=...]` applies, to a new-game state, what the scripts leave behind from the house
  through the won lab battle: house/Pallet/Oak scene vars, FLAG_WORLD_MAP_PALLET_TOWN, FLAG_VISITED_OAKS_LAB,
  starter + Pokédex, both balls' hide flags, VAR_STARTER_MON, trainer flag, FLAG_HIDE_RIVAL_IN_LAB, scene var 4,
  FLAG_BEAT_RIVAL_IN_OAKS_LAB. Battle effects follow MonGainEVs, Cmd_getexp (×1.5 trainer), TryIncrementMonLevel +
  AdjustFriendship(GROW_LEVEL, +1 met here), Cmd_getmoneyreward, then HealPlayerParty. Start: lab (6,8) facing down.
- Verified headless: a real playthrough (Squirtle, mid trigger, won) and the preset give identical flags, scene
  vars, money (3080), Pokédex and party (Lv6, exp 202, friendship 76, 1 Sp. Atk EV, moves/PP), apart from the house
  var the real run skipped. Bulbasaur/Charmander give exp 204/205 as the formula predicts.
- Not covered: losing the battle, and having opened the start menu before the rival picks
  (VAR_MAP_SCENE_PALLET_TOWN_SIGN_LADY).

### Trainer battles (user report: Brock gave TM39 without a battle)
- Causes: (1) the extractor never expanded `trainerbattle_single`/`_double`, whose bodies pick the mode with
  `.if/.elseif`, so the interpreter skipped the line and Brock's script fell through to `goto_if_unset
  FLAG_GOT_TM39_FROM_BROCK`; (2) `trainerbattle` only handled EARLY_RIVAL and SINGLE_NO_INTRO_TEXT.
- Extractor: macro bodies now go through `.if/.elseif/.else/.endif` (constants from the defines plus event.inc's
  `NO_MUSIC = FALSE` symbols; labels compare as themselves); all 729 trainer battles expand to `trainerbattle`.
  `sRematches` is extracted into scripts.json. Trainer parties: one-line dummy parties (`{DUMMY_TRAINER_MON};`)
  made the regex swallow the next party, leaving 64 real trainers (Youngster Ben, Camper Chris, ...) with none.
  The sprites folder is cleared before writing: an old `Blackbelt.png` survived on the case-insensitive disk and the
  dev server's case-sensitive lookup of `BlackBelt.png` failed (Route 4's Black Belt never spawned).
- Engine: `trainerbattle` ports BattleSetup_ConfigureTrainerBattle (all s*BattleParams layouts, SetMapVarsToTrainer,
  GetRematchTrainerId) and jumps to EventScript_TryDoNormalTrainerBattle / Double / Rematch / NoIntro. New:
  `gotobeatenscript`, `reveal_trainer` (no FRLG disguises), specials Script_HasTrainerBeenFought,
  SetBattledTrainerFlag, GetTrainerBattleMode, SetUpTrainerMovement (NpcBrain.setMovementType),
  ShowTrainerIntroSpeech, ShowTrainerCantBattleSpeech, HasEnoughMonsForDoubleBattle, ShouldTryRematchBattle,
  IsTrainerReadyForRematch, StartRematchBattle. CB2_EndTrainerBattle is shared; a white-out now ends the script
  (it used to continue, which would have handed out Brock's badge after a loss). `Assets.loadSprite` shares
  in-flight loads.
- Verified headless (`?start=after-rival` + a Lv70 Squirtle): Brock gives his intro, battles, then sets
  FLAG_DEFEATED_BROCK / FLAG_BADGE01_GET / trainer flag / VAR_MAP_SCENE_PEWTER_CITY, pays ₽1400 and gives TM39;
  talking again gives the post-battle line, no battle. Route 3 Ben: battle, ₽176, then ShouldTryRematchBattle →
  rematch script → not ready → post-battle line. Losing to Camper Liam with the Lv6 starter ends the script with no
  trainer flag. Oak's lab rival battle unchanged.

### White-out (user request)
- `setrespawn` (SetLastHealLocationWarp) stores `state.lastHealLocation`. The extractor numbers HEAL_LOCATION_* from
  src/data/heal_locations.json (as the decomp's build does) and adds that table plus ComputeWhiteOutMoneyLoss's
  arrays to scripts.json. The start preset now records the house's `setrespawn HEAL_LOCATION_PALLET_TOWN`.
- A lost battle leaves the field black: the script engine either returns to the field
  (CB2_ReturnToFieldContinueScriptPlayMapMusic, `TrainerBattleRun.returnToField`) or ends the script and calls
  `host.whiteOut()`. OverworldScene.whiteOut is CB2_WhiteOut as an overlay: 120 black frames; DoWhiteOut
  (EventScript_ResetEliteFourEnd, RemoveMoney(ComputeWhiteOutMoneyLoss), HealPlayerParty,
  Overworld_ResetStateAfterWhitingOut, SetWhiteoutRespawnWarpAndHealerNpc incl. its special-cased coordinates and
  VAR_LAST_TALKED = healer, warp facing north); then Task_RushInjuredPokemonToCenter: "scurried to a POKéMON
  CENTER" / "back home" in white on black (`ui/WhiteOutText.ts`, sWindowTemplate_WhiteoutText, 1 char/frame, no
  speed-up), fade in, EventScript_AfterWhiteOutHeal / EventScript_AfterWhiteOutMomHeal.
- Verified headless, losing to Camper Liam with the preset's Lv6 starter: with the house as respawn point → "scurried
  back home", house 1F (8,5) facing north, Mom's script, party healed, ₽48 lost (Lv6 × 4 × 2); after entering
  Pewter's Pokémon Center → "scurried to a POKéMON CENTER", Pewter PC 1F (7,4), VAR_LAST_TALKED = the nurse, her
  heal script. Winning against Brock still fades back to the field and continues his script.

### Old Man tutorial battle, emote icons (main-path check)
- Ran the main path past Route 1 headless: the Viridian Mart parcel scene and Oak's parcel → Pokédex scene already
  worked; the only gaps were Oak's `emote_exclamation_mark` and `special StartOldManTutorialBattle`.
- StartOldManTutorialBattle (battle_setup.c): `PokemonData.createMaleMon` (CreateMaleMon, with
  GetGenderFromSpeciesAndPersonality split out) makes the Lv5 Weedle; `ScriptHost.startScriptedBattle` launches a
  non-trainer battle with that gEnemyParty (OverworldScene's battle start is now shared by trainer and scripted
  battles, `runBattle`), and the special's `waitstate` ends after CB2_ReturnToFieldContinueScriptPlayMapMusic's
  fade in. The bag/party preload now includes InitOldManBag's Potion and Poké Ball icons.
- Emote icons: the extractor writes `field_effects/emoticons.png` (sSpriteImages_Emoticons order) and `.json`
  (sSpriteAnimTable_Emoticons). `entities/FieldEffects.ts` ports FldEff_*Icon / SetIconSpriteData /
  SpriteCB_TrainerIcons (bounce, follows the object incl. jump lift, priority 1 with the C's subpriority, ends
  when the anim does or the object is gone); MovementRunner starts them for `emote_*` and moves on at once, like
  MovementAction_Emote*_Step0. Field effects are cleared on map entry.
- Verified headless: Oak shows "!" over his head in the Pokédex scene, FLAG_SYS_POKEDEX_GET set, VAR 6. Old man
  (VAR_MAP_SCENE_VIRIDIAN_CITY_OLD_MAN = 1, walking onto the left trigger): his back pic, a male Weedle, the demo
  bag cycling pockets, the throw, "Gotcha! WEEDLE was caught!", back to the field, Teachy TV given, VAR 2; party,
  Pokédex and bag otherwise unchanged (the old man's Potion/Ball are removed again), no console warnings.

### Wild encounters (user request)
- Extractor: `extract_wild_encounters` writes `wild_encounters.json`: the FireRed headers of
  src/data/wild_encounters.json in table order (Altering Cave's sets stay consecutive), the ENCOUNTER_CHANCE_*
  running totals wild_encounters.json.txt generates, TILE_ENCOUNTER_*, NUM_ALTERING_CAVE_TABLES,
  sUnownLetterSlots and the Tanoby chambers in map-number order. Tiles now report METATILE_ATTRIBUTE_ENCOUNTER_TYPE
  (`TileInfo.encounterType`, `TilesetPair.encounterType`).
- `world/WildEncounters.ts` ports TryStandardWildEncounter / HandleWildEncounterCooldown / StandardWildEncounter /
  DoWildEncounterRateTest (own ISO_RANDOMIZE2 RNG seeded from Random()), the 60% dice on a behavior change,
  the rate buff, flutes, Cleanse Tag, Stench/Illuminate, IsWildLevelAllowedByRepel, UpdateRepelCounter,
  GetCurrentMapWildMonHeaderId (Altering Cave, Tanoby lock), ChooseWildMonIndex_*/Level and GenerateWildMon
  (CreateMonWithNature, new in PokemonData; Unown letters by chamber/slot).
- Overworld: `onPlayerArrived` → `processStep` (step warp, coord event, repel wear-off script, then the
  encounter check), also run after crossing into a connected map, which previously skipped coord events on its
  first tile. RestartWildEncounterImmunitySteps on every map load and battle start. `startWildBattle` freezes the
  field with an overlay, picks DoGhostBattle (Pokémon Tower 1F–7F without the Silph Scope: BATTLE_TYPE_GHOST,
  nickname gText_Ghost) or the standard battle, and ends like CB2_EndWildBattle (fade in, or CB2_WhiteOut).
- Battle: SetWildMonHeldItem is now ported (the old comment claimed the field did it). For that, BattleScene
  installs the field's gEnemyParty before CB2_InitBattle; battle-test.html's party override now only replaces
  trainer parties, so its wild mons' held items get SetWildMonHeldItem's roll like on the GBA.
- `GameState.currentMapId` (MAP_*) added; `currentMap`'s comment wrongly called it a MAP_* id (it's the folder name).
- Verified headless (`?start=after-rival&map=Route1`): walking the grass starts wild Pidgey/Rattata Lv2–5 battles
  on the grass terrain; winning gives exp and fades back with the field unfrozen; RUN → "Got away safely!" → field;
  losing → white-out to the house. Repel at 4 steps wears off with "REPEL's effect wore off..." on the first tile of
  Viridian City. Pokémon Tower 3F: "GHOST" + "Darn! The GHOST can't be ID'd!". battle-test.html wild and trainer
  modes still run to B_OUTCOME_WON.

### Wild encounter follow-ups: map scripts on resume, step counters, ghost pic, roamers, Safari Zone (user request)
- Return to field: `OverworldScene.resumeMap` runs MAP_SCRIPT_ON_RESUME then ON_RETURN_TO_FIELD (ResumeMap +
  ReloadObjectsAndRunReturnToFieldMapScript) after every battle and on coming back from the bag/party menu, like
  CB2_ReturnToField. New specials: GetBattleOutcome (`state.battleOutcome`), InitUnionRoom (no-op: wireless only,
  every Pokémon Center's CableClub_OnResume calls it).
- Step counters (TryStartStepCountScript, `world/stepCounters.ts`): UpdateHappinessStepCounter (AdjustFriendship
  FRIENDSHIP_EVENT_WALKING every 128 steps; the overworld now initialises the battle env so it can use the battle's
  AdjustFriendship), UpdateVsSeekerStepCounter + MapResetTrainerRematches on map load, UpdatePoisonStepCounter /
  DoPoisonFieldEffect (1 HP every 5 steps), ShouldEggHatch's egg-cycle countdown, SafariZoneTakeStep.
- Field poison: FldEffPoison's BG mosaic pulse (REVISION 0: 2→6→1 px over 11 frames) as a WebGL post pipeline on
  the map tilemap layers only (`world/BgMosaic.ts`, GBA-style top-left sampling; sprites and text unaffected);
  Task_BattleStart waits for it and clears VAR_POISON_STEP_COUNTER. EventScript_FieldPoison works through
  TryFieldPoisonWhiteOut ("X fainted…", status cleared, friendship), OverworldWhiteOutGetMoneyLoss, SetCB2WhiteOut
  (specials can now `showFieldMessage` and `endScript`). New script commands: checkmoney, addmoney, removemoney.
- Ghost battles: DecompressGhostFrontPic / GetGhostSpriteDefault_Y in the opponent controller and
  reshow_battle_screen.c; the battle preloads gGhostFrontPic/gGhostPalette. (After the bag, the reshow gives the ghost
  its species' shadow, as the decomp does.)
- Roamers (`world/roamer.ts`): sRoamerLocations and sStarterSpecies are extracted (wild_encounters.json);
  InitRoamer special, UpdateLocationHistoryForRoamer + RoamerMove / RoamerMoveToOtherLocationSet on map load,
  TryStartRoamerEncounter in StandardWildEncounter (repel check), StartRoamerBattle, and in
  ReturnFromBattleToOverworld UpdateRoamerHPStatus + SetRoamerInactive with REVISION 0's `& B_OUTCOME_WON` check.
  The saved roamer is `state.roamer`.
- Safari Zone: battle_controller_safari.c (`battle/controllerSafari.ts`), UpdateSafariBallsTextOnHealthbox /
  UpdateLeftNoOfBallsTextOnHealthbox, gNumSafariBalls kept in `state.numSafariBalls` across battles,
  Enter/ExitSafariMode, IsThereRoomInAnyBoxForMorePokemon (always TRUE: no PC yet), DoSafariBattle +
  CB2_EndSafariBattle (balls left → field; out mid-battle → OutOfBallsMidBattle + warp to the `setwarp`
  destination from black; caught with the last ball → field, then SafariZone_EventScript_OutOfBalls), start menu
  SetUpStartMenu_SafariZone + DrawSafariZoneStatsWindow + RETIRE. Script commands showmoneybox / updatemoneybox /
  hidemoneybox (`ui/MoneyBox.ts`, LoadStdWindowGfx's frame now extracted as `text/frame_std.png`) and setwarp.
  Warps now pick the destination like SetPlayerCoordsFromWarp (warp id only if the map has it, else x/y, else the
  centre), which `warp MAP_SAFARI_ZONE_CENTER, 255, 26, 30` needs.
- Verified headless: a poisoned 3-HP starter loses 1 HP every 5 steps with the mosaic flash, then "BULBASAUR
  fainted…", "PLAYER is out of usable POKéMON! … panicked and lost ¥48", white-out home. Ghost battle shows the
  ghost pic, also after the bag. Roamer (Bulbasaur starter → Entei Lv50) appears on its map, flees, keeps HP, moves
  sets. Safari: pay ₽500 at the entrance (money box), enter with 30 balls / 600 steps; Safari battle UI; last ball
  misses → "out of SAFARI BALLS" → entrance walk-out; last ball catches → PA message → entrance; time up after
  the step count → PA → entrance; start menu RETIRE + stats window. A Route 3 trainer battle still runs through
  the script path to its end.

### Trainer sight (main path: Viridian Forest, gym trainers)
- `world/trainerSee.ts` ports trainer_see.c: CheckForTrainersWantingBattle (TRAINER_TYPE_NORMAL/BURIED only, as in
  the C), CheckTrainer (trainer flag and DOUBLE check from the script's leading `trainerbattle`),
  GetTrainerApproachDistance*, CheckPathBetweenTrainerAndPlayer, and Task_RunTrainerSeeFuncList's funcs: the "!",
  the walk-up, FACE_PLAYER, PrepareToEngage (face-direction movement type + template override, so the trainer stays
  where it walked to) and FRLG's offscreen-above camera pan (invisible LOCALID_CAMERA object walking fast up and back
  while the camera follows it).
- Overworld: GetCollisionFlagsAtCoords (`collisionFlagsAt`, incl. DoesObjectCollideWithObjectAt with previous
  coords and elevation compatibility; ObjectEvent now exposes `previous`), the camera can follow another object,
  `FieldEffects.isActive` (FieldEffectActiveListContains). Only current-map objects are candidates (see QOL list).
- ScriptEngine: `trainerbattle` split into `configureTrainerBattle` (BattleSetup_ConfigureTrainerBattle) so
  ConfigureAndSetUpOneTrainerBattle can configure a trainer's battle and start EventScript_DoTrainerBattleFromApproach;
  new special EndTrainerApproach; `lock`/`lockall` now wait for the player (and selected object) to stop, which is
  what holds the "!" until the player's step is done; GetMonsStateToDoubles shared as `monsStateToDoubles`.
- Verified headless: stepping into Rick's line (Viridian Forest) → spotted one frame into the step, "!" once the
  step ends, he walks 4 tiles, intro text in the male colour, battle, win → flag set, he stays at his new tile
  facing left, talking gives the post-battle text, no re-trigger. Blocking a tile in the line stops it; clearing
  it makes him spot the standing player. Route 20 Nora (range 4, facing down): camera pans 2 tiles up, "!", pans
  back, she approaches, female text. Oak's Pallet Town trigger still runs into the lab.

### Poké Mart (main path: buying Poké Balls)
- `pokemart` (ScrCmd_pokemart): reads the `.2byte` item list at the label and waits on `ScriptHost.openPokemart`.
- Field side (`ui/ShopMenu.ts`): CreatePokemartMenu / CreateShopMenu (sShopMenuWindowTemplate, user frame, BUY/SELL/SEE YA!,
  Menu_ProcessInputNoWrapAround), the mart font from ContextNpcGetTextColor (neutral reads as female, as in the C),
  Task_HandleShopMenuBuy/Sell (FadeScreen to black, then FieldMenuScene), MapPostLoadHook_ReturnToShopMenu +
  Task_ReturnToShopMenu ("Is there anything else I can do?" and the menu again), Task_HandleShopMenuQuit
  (ScriptContext_Enable). `OverworldScene.runFieldMenu` now launches any FieldMenuScene screen (start menu too).
- GBA side (`menus/shop.ts`): CB2_InitBuyMenu and the whole buy flow (list with prices, item icon or TM number/move
  name, description recolouring, "How many", quantity box with arrows, YES/NO, AddBagItem / not enough money / no
  room, money box), BuyMenuDrawMapView (metatiles by layer type into BG1-3, object sprites facing their way),
  ExitBuyMenu. CB2_GoToSellMenu is the existing bag's ITEMMENULOCATION_SHOP mode. New: BagGetQuantityByItemId,
  TilesetPair.layerType, Assets.tilesetSymbols.
- Extraction: extract_gfx adds graphics/shop_menu, graphics/object_events and data/tilesets, and now reads
  spritesheet_rules.mk and tileset_rules.mk too (object event pics were coming out in the wrong tile order without
  their -mwidth/-mheight); extract_anims adds event_object_movement.c (object anim tables); the sprite manifest gets
  each graphics id's GBA info (palette tag + symbol, base OAM, frame images); tilesets/index.json gets each tileset's
  tiles/palettes/metatiles symbols.
- Verified headless: Pewter Mart clerk → menu → BUY → map view with the clerk and player sprites, list, buy 13 Poké
  Balls (₽3080 → ₽480), back to the field with "anything else"; SELL 2 of 5 balls for ₽200; SEE YA! → "Please come
  again!" and the script ends. Celadon Dept. Store 2F TM clerk shows the TM layout (No.xx + move name, CANCEL shows
  ---/-------). The start menu bag still returns to the start menu.
- Note: some TM descriptions (e.g. TM45's first line, 164 px) are wider than the 144 px TM description window; the
  decomp's own glyph widths give the same, so this is left as the C draws it (clipped).

### Multichoice menus and elevators
- Extraction: `scripts.json` gets `multichoices` (script_menu.c sMultichoiceLists → each list's string symbols).
- `ui/MultichoiceMenu.ts`: ScriptMenu_Multichoice(WithDefault) = DrawVerticalMultichoiceMenu (width from the widest
  item, left clamped to 28 - width, GetMCWindowHeight, items at 8/2 + 14 per row, cursor at 0/2) +
  Task_MultichoiceMenu_HandleInput (waits for a field fade, sDelay 12 for the cable club ids, wraps above 3 items,
  B → SCR_MENU_CANCEL unless ignored); ScriptMenu_MultichoiceGrid with MultichoiceGrid_PrintItems /
  MultichoiceGrid_RedrawCursor / Menu_ProcessInputGridLayout (FONT_NORMAL_COPY_1, L/R in LR button mode).
- `text/stringWidth.ts`: GetStringWidth moved out of gba/window.ts so field menus measure `{FONT_SMALL}` /
  `{CLEAR_TO}` strings (the vending machine and prize lists) exactly; GetStringWidth calls it.
- Elevators (`world/elevator.ts`): GetElevatorFloor, InitElevatorFloorSelectMenuPos (+ sElevatorScroll),
  DrawElevatorCurrentFloorWindow / CloseElevatorCurrentFloorWindow, AnimateElevator (Task_ElevatorShake ending the
  waitstate, Task_AnimateElevatorWindowView swapping the window metatiles every 6 frames). The overworld gained
  field tasks, SetCameraPanning (`cameraPanY`, also in the sprite camera top), `setdynamicwarp`, and SetupWarp's
  MAP_DYNAMIC handling (warping into a map whose matching warp is dynamic records the way back).
- Verified headless: Celadon roof vending machine (prices in the small font line up; wrap-around; EXIT →
  "Not thirsty!"; buying loops back to the menu and stops when money runs out), Viridian school blackboard grid
  (3x2, no wrap, EXIT = 5), Celadon elevator: enter from 1F → "Now on: 1F", cursor on 1F → 5F: shake and window
  scroll, VAR_ELEVATOR_FLOOR 8, exit mat → 5F; entering from 5F shows "Now on: 5F" with the cursor on 5F; exit
  from 1F returns to 1F.

### Field interactions: item balls, hidden items, PCs, signs (main path: Viridian Forest)
- `OverworldScene.interact` now follows GetInteractionScript: an object without a script falls through to bg events;
  GetBackgroundEventAtPosition's elevation check (GetInFrontOfPlayerPosition's elevation); hidden items
  (VAR_0x8004/5/6 + EventScript_HiddenItemScript, underfoot ones skipped); `player_facing_dir` and MsgSetSignpost
  for signs on sign metatiles; GetInteractedMetatileScript as a table (`METATILE_SCRIPTS`). Water isn't ported.
- Signs: TrySetUpWalkIntoSignpostScript / SetUpWalkIntoSignScript (after a step and when pushing against one),
  FieldInput_HandleCancelSignpost (walking away or START cancels with EventScript_CancelMessageBox; START then opens
  the start menu), `signmsg`/`normalmsg`, DisableMsgBoxWalkaway, ResetFacingNpcOrSignpostVars' MsgSetNotSignpost on
  every free frame. ProcessPlayerFieldInput order fixed: walk-into sign, then A, then START.
- WaitForAorBPress: when the next command is release(all), a held direction other than VAR_FACING, L, R, START or
  SELECT closes the message; QuestLogOverrideJoyVars replays it as the next field frame's input (`Input.override`).
- Signpost frame: extract.py renders graphics/text_window/signpost.png with stdpal_1 (`text/signpost_frame.png`);
  MessageBox composes it with WindowFunc_DrawDialogueFrame's signpost row order.
- Specials: SetHiddenItemFlag, BufferTMHMMoveName (overworld now loads menus.json for sTMHMMoves), CheckAddCoins,
  DoPicboxCancel (MonPicBox.cancel = PicboxCancel), AnimatePcTurnOn (field task) / AnimatePcTurnOff, CreatePCMenu
  (MultichoiceMenu with a fixed layout: 13/14 tiles, 16 px rows); PlayerPC / ShowPokemonStorageSystemPC /
  HallOfFamePCBeginFade are stubs. GameState gained `coins` (AddCoins/RemoveCoins); the Coin Case reads it.
- Verified headless: Viridian Forest Poké Ball item ball (removed, flag set, in the bag) and hidden Potion (no repeat);
  Pallet Town sign by walking into it (signpost frame, cancelled by pressing Left, re-shown by tapping Up, walked
  away from with Down), A-pressed sign closed by tapping Left after printing (player turns left; ignored mid-print);
  Viridian Pokémon Center sign by walking into it; Pokémon Center PC (flicker on, menu SOMEONE'S PC / PLAYER's PC /
  LOG OFF, storage stub returns to the menu, LOG OFF turns it off); bookshelf (normal frame). Oak's Pallet trigger →
  lab intro still runs to completion.

### Naming screen (user request)
- Ported naming_screen.c as `menus/namingScreen.ts` (DoNamingScreen): keyboard pages and the page swap animation,
  cursor/button flashing (MultiplyInvertedPaletteRGBComponents, now in `gba/palette.ts`), input arrow and
  underscores, gender symbol, the player/rival/PC/mon icons, the "sent to PC" message for a caught mon with a full
  party. Like the C, gKeyRepeatStartDelay stays at 16 afterwards (`gba/main.ts` now lets it be set), and the
  freed struct stays readable for the sprite callbacks / VBlankCB_NamingScreen that outlive the screen.
- `gba/menu.ts`: InitStandardTextBoxWindows, InitTextBoxGfxAndPrinters, LoadStdWindowFrameGfx, DrawDialogueFrame,
  Menu_LoadStdPal (new_menu_helpers.c).
- Extractor: `graphics/naming_screen/` gfx; `src/keyboard_text.c` strings; `menus.json` `namingKeyboardChars`
  (sKeyboardChars; `c_array_body` now takes any number of dimensions); naming_screen.h / pokemon_storage_system.h
  defines.
- Callers: `ChangePokemonNickname` (FieldMenuScene `naming`, ScriptHost `doNamingScreen`: field message box
  cleared, CB2_ReturnToFieldContinueScriptPlayMapMusic fades back in); `Cmd_trygivecaughtmonnick` YES → fast fade
  → NAMING_SCREEN_CAUGHT_MON → BattleMainCB2 (BattleScene preloads the naming gfx and the wild mon's icon).
- Verified headless: player screen (typing, SELECT through UPPER/lower/others, B delete, START → OK, name written),
  `EventScript_ChangePokemonNickname` on the starter (icon, "BULBASAUR's nickname?", ♂, nickname set, old name in
  STR_VAR_3, field fades back in), Master Ball catch → YES → "PIDGEY's nickname?" (♀) → party mon named and back
  to the field, rival and PC box icons, blank entry leaves the buffer alone, party-full "transferred to Someone's PC".

### Test suite (user request)
- Vitest with two projects (`vitest.config.ts`): `unit` (Node; `tests/unit/gameData.ts` builds Defines/Charmap/
  PokemonData/GameState and the battle env from `public/gen`) and `e2e` (one Vite dev server per run from
  `tests/e2e/globalSetup.ts`; one headless Chrome per file, driven over the DevTools protocol by
  `tests/e2e/harness.ts`). Scripts: `npm test`, `test:watch`, `test:e2e`, `test:all`; `npm run typecheck` now
  also checks the tests (`tests/tsconfig.json`, `@types/node`).
- `src/dev/testHooks.ts` (dev builds only, `window.__test`): a virtual gamepad that `Input.sample()` ORs with
  the keyboard once per logic tick; `mash()` decides each press at the start of a tick after checking its
  condition, so presses can't land on a menu that just opened; `walk`/`walkTo` (`OverworldScene.testFindPath`, a
  BFS over canMove's rules, doors allowed as the target) / `face` / `enterWarp`; probes (`OverworldScene.testProbe`,
  message box text, party, bag, battle globals incl. the player's controller function, `gMain.callback2`'s name);
  an event log fed by `testEvent()` calls in the overworld and the script engine. `?seed=`, `?speed=` (logic
  ticks per frame: both scene loops multiply their accumulator) and `?textSpeed=`.
- RNG: `ScrCmd_random` and NPC wandering (direction, gMovementDelaysMedium) now roll `Random()` like the GBA
  instead of `Math.random`, so a seed covers them.
- Fix (found by the tests): push warps (stairs, arrow mats) ran `takeWarp` without locking the controls until
  the destination map had loaded, so a held direction set up the same warp again every frame meanwhile; each
  extra one reran the whole map entry (map scripts, temp clears, roamer moves). `takeWarp` now sets `busy` up front.
  `tests/e2e/field.test.ts` covers it.
- The after-rival preset is now checked against a real playthrough (`newGame.test.ts`): same flags, story vars,
  money, position, party.
- `MessageBox.text` keeps the shown message; `makeHandleInputChooseAction`'s function is named
  (HandleInputChooseAction) so the probe can tell when the action menu waits.
- Harness gotcha: DevTools awaits a page promise through a weak handle, so a promise resolved mid-battle could be
  garbage-collected first ("Promise was collected"); `evalRaw` keeps each one alive until a task after it settles.

### Start menu EXIT also interacted (user report)

- Picking EXIT on the start menu in front of the bedroom NES closed the menu *and* played the NES message on the
  same A press. The menu overlay closes mid-tick, and the field-input gate only checked whether a script was
  running at the start of the frame. It now also checks for an open overlay (`lockedAtFrameStart` in
  `OverworldScene.tick`), matching CB1_Overworld, which checks ArePlayerFieldControlsLocked before the menu's task
  unlocks the controls. Applies to every field overlay (start menu, notices, field menus returning).
  `tests/e2e/field.test.ts` covers it.

### Evolution scene (main path: Viridian Forest Caterpie/Weedle, starters at 16)

- Ported evolution_scene.c (EvolutionScene, BeginEvolutionScene, Task_EvolutionScene with its move-learning
  states, the background palette/scroll animation, CreateShedinja, EvolutionRenameMon) and evolution_graphics.c
  (the four sparkle sets, CycleEvolutionMonSprite) as `src/menus/evolutionScene.ts` / `evolutionGraphics.ts`.
  The trade-evolution variant isn't ported (no trading).
- Hooked up the three callers: `battle/main.ts` TryEvolvePokemon / WaitForEvoSceneToFinish (and
  FreeResetData_ReturnToOvOrDoEvolutions now resets sprites, windows and mon sprite buffers like the C),
  ExecuteTableBasedItemEffect's ITEM4_EVO_STONE case, and the party menu's PartyMenuTryEvolution (Rare Candy) and
  CB2_UseEvolutionStone (which no longer goes straight back to the bag).
- `tools/extract_gfx.py` extracts `graphics/evolution_scene/`. Preloading: `menuGfxSymbols` adds the scene's
  graphics, the battle textbox/terrain, and every evolution target's pic, palettes and icon.
- FieldMenuScene gets `mapBattleScene` from the field (gMapHeader.battleType), so an evolution in a gym draws the
  gym backdrop like the GBA. Battle text setup (`initBattleMessages`, `setBattleTextSpeed`) now also runs there.
- Helpers: `PlayCry_Normal` / `IsCryFinished` stubs (gba/sound.ts), `DecompressPicFromTable` (battle/gfx.ts),
  `gBattleStringsTable(stringId)` (battle/message.ts); `isHMMove2` is exported.
- `IsSEPlaying()` is always FALSE without audio, which would hang EVOSTATE_RESTORE_SCREEN (it waits for SE_EXP to
  *be* playing); that state goes straight on (noted in the code and under Known deviations).
- Tests: `tests/e2e/evolution.test.ts` (Caterpie → Metapod after a battle, learning Harden; the same with four
  moves, forgetting Tackle through the summary screen; holding B; Rare Candy on Charmander; Fire Stone on
  Growlithe). New test event `evolution`. Fix in the test probe: `t.party()` named moves from the first MOVE_*
  define with that value, which picked MOVE_EFFECT_SLEEP for Pound; it now reads the move table's ids.

### Evolution test bed preset (user request)

- `?start=evolution[&starter=...]` (`src/dev/startPresets.ts` `applyEvolutionTestBed`): after-rival, then the
  starter retrained to Lv. 15 one exp point short of 16, Caterpie Lv. 6, Pikachu Lv. 10 (all registered as caught),
  a Rare Candy and a Thunder Stone, starting in Viridian Forest at (41, 45) facing Bug Catcher Rick.
  `presetStart()` picks a preset's default location; BootScene uses it when the URL has no `?map=`.
- `tests/e2e/evolution.test.ts` checks the preset and that beating Rick evolves the starter. Test gotchas: a
  Lv. 15 Squirtle's first move is Tail Whip (mashing A only uses move 1), and with the SHIFT battle style mashing A
  says YES to "Will you switch?" and lands in the party menu, so the test leads with Water Gun and sets
  `battleStyleSet`.

### Tile animations, door animations, field effect graphics (user request)

- Map layers: the atlases are now three per tileset pair, bottom/middle/top, as DrawMetatile (field_camera.c)
  spreads a metatile's two layers over BG3/BG2/BG1 by layer type, so OAM priority 3 sprites (reflections, ripples)
  can sit between the bottom and middle BGs. `objectDepth` handles priority 3; depth bands moved accordingly.
- Tile animations: port of tileset_anims.c (`world/tilesetAnims.ts`) on top of `world/TilesetVram.ts`, which keeps
  each tileset's GBA tiles as "VRAM", converts animated pairs' atlases to canvas textures and redraws only the
  metatiles that use a changed tile, in the same JASC colours as the PNGs (`tilesets/palettes.json`). The
  transfer is skipped while a palette fade runs, like CB2_Overworld. The extractor records each tileset's
  `callback`.
- Doors: port of field_door.c (`world/doors.ts`, data in `doors.json` from `tools/extract_field.py`), the door
  warp (Task_DoorWarp: open, walk in, close behind the hidden player, fade) replacing the old walk-into-the-door
  warp, the exit (Task_ExitDoor: hidden, 25 frames, open, walk out, close after 14 frames), and the door script
  commands. TryDoorWarp is checked where ProcessPlayerFieldInput does (after A interactions, before START).
- Field effects: `tools/extract_field.py` writes every field effect object template as a sheet + JSON and the
  reflection distortion anims; `extract_object_events` writes each sprite in its reflection palette (picked like
  LoadObjectReflectionPalette: player/special sets, NPC slots via gReflectionEffectPaletteMap) plus `shadowSize`
  and `tracks`. Ported: the ground effect flags and GroundEffect_* (event_object_movement.c), FldEff_Shadow,
  TallGrass, JumpTallGrass, Dust, JumpSmall/BigSplash, Ripple, Splash, FeetInFlowingWater, Sand/DeepSand
  footprints, BikeTireTracks, HotSpringsWater and SetUpReflection with their update callbacks, the distortion
  sprites' x-scale wobble, and DoShadowFieldEffect on jumps. ObjectEvent now tracks the GBA currentCoords through
  jumps (shifted at InitJump and at JUMP_HALFWAY) and the ground-effect flags. FRLG's always-FALSE behaviours
  (long/short grass, deep sand, footprints, Pacifidlog logs) are ported as such; bubbles (MB_SEAWEED, unused by
  FRLG tilesets) aren't.
- `include/event_object_movement.h` is read for defines (GROUND_EFFECT_FLAG_*, PALSLOT_*).
- Fix: OverworldScene.update could tick before the first map had loaded (now the player's spawn ground effects
  look at the map).
- Tests: `tests/e2e/fieldEffects.test.ts` (water/flower tiles change, door entry and exit, ledge jump shadow into
  grass, pond reflection). New probes: `field().playerVisible/doorAnimating/fieldEffects/playerEffects`,
  `__test.tilesetTile()`.

### Battle animation scripts: extraction (user request, branch `battle-move-anims`)

- `tools/extract_battle_anims.py` assembles data/battle_anim_scripts.s (macros from battle_anim_script.inc) with the
  battle script assembler, extended with `\@`, `.L` local labels, `.if/.else/.endif` (REVISION 0), vararg macro
  parameters and RGB(). C symbols the scripts point at (sprite templates, AnimTask_/SoundTask_ functions, data
  pointers) get addresses from `externBase` and are listed by name in `externs`. It also writes every
  `struct SpriteTemplate` of the battle_anim_*.c files (with its C unit), the OamData structs of
  src/data/battle_anim.h, and gBattleAnimPicTable / gBattleAnimPaletteTable / gBattleAnimBackgroundTable.
  `extract_anims.py` now reads anim tables from all battle_anim_*.c files (`ANIM_C_FILES`).
- `BattleData.animScripts` (src/battle/data.ts) loads it. The extractor also writes each pointer table's
  entries (`tables`), resolves file-local #defines in templates, and reads OamData from every anim C file.

### Battle animation engine (user request, branch `battle-move-anims`)

- `src/battle/anim/`: `state.ts` (battle_anim.c globals, DestroyAnimSprite/VisualTask/SoundTask, registry of
  ported sprite callbacks / task functions by C name), `battleAnim.ts` (the battle_anim.c interpreter, all 0x00-0x2F
  commands incl. monbg/MoveBattlerSpriteToBG, fadetobg, pan tasks; LaunchBattleAnimation, DoMoveAnim,
  LaunchStatusAnimation, template building from the extracted data), `animMons.ts` (battle_anim_mons.c in full
  except CreateAdditionalMonSpriteForMoveAnim, plus Set/GetAnimBgAttribute and CopyBattlerSpriteToBg from
  battle_intro.c), `monMovement.ts` (battle_anim_mon_movement.c, complete), `normal.ts` (battle_anim_normal.c,
  minus the unused AnimTask_TintPalettes), `ported.ts` (registration, called lazily), `src/gba/bios.ts` (ArcTan2).
- A script runs only if every callback/task it can reach is registered and its graphics are loaded
  (`isAnimRunnable`, static walk of the bytecode); otherwise it ends at once like before and logs once
  `[battle anim] <label> skipped, not ported: ...`. BattleScene preloads the anim graphics of every move the
  parties know (`battleAnimGfxSymbols`); others load on first use and run from the next time.
- Hooked up: the three controllers' HandleMoveAnimation (gAnim* globals from the buffer) / DoMoveAnimation
  (DoMoveAnim + gAnimScriptCallback), InitAndLaunchChosenStatusAnimation (C port), TryHandleLaunchBattleTableAnimation
  and InitAndLaunchSpecialAnimation (script when runnable, old fallback otherwise), ClearBattleAnimationVars,
  AllocateBattleResources' anim BG buffers. Helpers: `CopySprite` (struct copy), `Task.ref` (StorePointerInVars).
- More ports: `utilityFuncs.ts` (battle_anim_utility_funcs.c complete: palette blends, InitStatsChangeAnimation
  and the OBJ-window BG1 masks, StartMonScrollingBgMask, traces, the small get/set tasks), `statusEffects.ts`
  (battle_anim_status_effects.c: AnimTask_FrozenIceCube, AnimTask_StatsChange), `soundTasks.ts`
  (battle_anim_sound_tasks.c; SE/cries are the sound.ts no-ops, `IsCryPlaying` added), `moves.ts` (the per-move
  callbacks/tasks for the early-game moves and every status anim, from effects_1/2/3, fire, water, poison,
  electric, flying, ground, bug, dark and ghost).
- Graphics a callback loads itself (stat masks, metal shine, curse lines) are listed with `registerAnimExtraGfx`, so
  runnability and preloading count them. Templates pointing into the middle of an anim table (`&sAnims_X[2]`)
  resolve. Fix: InitAnimLinearTranslationWithSpeed divides by data[0] (sTransl_Duration is data[0]).
- 88 of 397 scripts run: all status anims, General_StatsChange / MonHit / IngrainHeal, and moves incl. Pound,
  Scratch, Tackle, Growl, Tail Whip, Leer, Ember, Flamethrower, Water Gun, Bubble(Beam), Vine Whip, Gust, Peck,
  Sand-Attack, Poison Sting, String Shot, Harden, Bite, Supersonic, Absorb, Leech Seed, the powders, Thunder
  Shock/Wave, Quick Attack, Agility, Body Slam, Take Down. Checked by eye (screenshots mid-anim) for Tackle, Growl
  + stat change, Ember, Water Gun, Harden, Thunder Shock, String Shot, Leer. Open question: with the BG dimmed
  (Thunder Shock, String Shot) faint diagonal lines show at the healthbox corners; likely BG pixels in a palette
  the blend doesn't select, as on the GBA, but not compared against the game.
- Tests: `tests/unit/battleAnims.test.ts` (the scripts above are fully ported; `battleAnimCoverage()` lists what any
  script still needs), `tests/e2e/battleAnims.test.ts` (Tackle runs to its end with its hit splat and the turn
  goes on; Growl then the stat change; a poisoned mon's Status_Poison). New test probes: `battleAnim` /
  `battleAnimEnd` events (label, ran, attacker, target), `t.gbaSprites()`, MonSpec `status`.


### Special battle anims (user request, branch `battle-move-anims`)

- `src/battle/anim/special.ts`: battle_anim_special.c complete. The level-up healthbox flash, switch out (ball
  burst + fade + shrink), the ball throw (arc, the target shrinking in, bounces, the shakes by
  ballThrowCaseId, the click with stars and fade, or the break-out; the trainer block and ghost dodge),
  AnimTask_ThrowBallSpecial (the player's / old man's throw), the substitute swap and fade, every ball's open
  particles (each ball's own pattern, where the old gfx.ts version drew the Poké Ball burst for all) and
  LaunchBallFadeMonTask (both moved here from gfx.ts), shiny sparkles (TryShinyAnimation, replacing the
  controllers' stub), the Safari bait/rock throws and the small get/set tasks. Plus AnimTask_MonToSubstitute
  (General_SubstituteAppear, from effects_3).
- InitAndLaunchSpecialAnimation is the C again: the fallback switch is gone. `animSpriteTemplate(name, true)`
  gives templates for code that sets its own callback (the shiny stars). Code-loaded graphics (ball particles,
  gold stars, Safari bait) are preloaded.
- 101 of 397 scripts run. Checked by eye: the Master Ball throw (arc, burst, the target fading and shrinking in,
  the shakes) and switching out.
- Tests (`tests/e2e/battleAnims.test.ts`): a Poké Ball the wild Mewtwo breaks out of, a Master Ball catch
  (shakes, click, B_OUTCOME_CAUGHT), switching to the second mon, a level-up's healthbox flash, and Substitute
  (the doll, then SubstituteToMon / MonToSubstitute around a Tackle). The unit test covers every Special_* script.

### Battle anim e2e tests for the remaining throw paths (user request, branch `battle-move-anims`)

- `tests/e2e/battleAnims.test.ts` now also covers: the old man's tutorial (the Viridian coord trigger with
  VAR_MAP_SCENE_VIRIDIAN_CITY_OLD_MAN = 1; his throw, the ball in flight, Weedle caught), a ball thrown at Bug
  Catcher Rick's mon (TrainerBallBlock; battle goes on), a ball at a Pokémon Tower GHOST (GhostBallDodge), a
  shiny wild Pidgey's sparkles (gold stars appear and are gone by the action menu), and the Safari Zone's BAIT and
  ROCK throws (one battle each, since the wild mon may flee). All five were also checked by eye in screenshots.
- New test option: MonSpec `shiny` (a personality that is shiny for the player's OT id).
- Note from the old man's test: his ball's click clears gDoingBattleAnim at frame 95 of 315, so the tutorial
  battle can end before Special_BallThrowWithTrainer reaches `end` (the C does the same).
- The Substitute test fights a Lv. 12 Magikarp (Splash only): at Lv. 30 its Flail can break the substitute first.

### Screen transitions: battle transitions, warp fades, barn door wipe (user request)

- Battle transitions: port of battle_transition.c (`battle/transition.ts`) for every transition FRLG uses (Spiral,
  which nothing starts, is left out), incl. the trainer pics for the mugshots (CreateTrainerSprite) and the Poké
  Ball trail's field effect bookkeeping. `OverworldScene.runBattle` now runs CreateBattleStartTask /
  Task_BattleStart: the transition picked by GetWildBattleTransition / GetTrainerBattleTransition (Old Man:
  Slice), then BattleScene, instead of a fade to black. `include/battle_transition.h` is read for defines.
- `world/fieldGbaScreen.ts`: the field on the GBA layer (InitOverworldBgs, InitOverworldGraphicsRegisters,
  CopyMapTilesetsToVram from the animated tileset VRAM, LoadMapTilesetPalettes, DrawWholeMapView/DrawMetatile
  every frame, VBlankCB_Field), drawn by the software PPU over the field; Phaser's sprites go into a new OBJ
  bitmap layer of the PPU.
- PPU: BG mosaic (Blur), an HBlank callback per line (Swirl, Shuffle, Ripple, Slice, mugshots, white bars), HBlank
  DMA to any register (`DmaSetHBlank16` / `DmaStop0`). Window bounds now follow GBATEK (X2 > 240 or X1 > X2 means
  X2 = 240, same for Y with 160) instead of wrapping: the field's WIN1 at (255, 255) used to cover the whole screen.
  CB2_InitBattleInternal now clears the HBlank/VBlank callbacks like the C.
- Warps: WarpFadeOutScreen / WarpFadeInScreen with the decomp's timing (ScreenFade, which gained FadeScreen's delay
  and palette_bg_faded_fill_*) replace the 200 ms camera fade: white into caves, black into a section with a cave
  preview screen, white out of caves. CB2_DoChangeMap's FlashTransition_Enter / _Exit run on the GBA layer between
  the fade out and the new map (`world/mapTransition.ts`; cave_transition graphics extracted). Leaving through a
  door: DoOutwardBarnDoorWipe (`ui/BarnDoorWipe.ts`) with WarpFadeInScreenWithDelay, and Task_ExitDoor waits for it.
- Not done: map preview screens, battle music/SE with the transition, Flash (TRANSITION_TYPE_FLASH).
- Tests: `tests/e2e/transitions.test.ts` (wild and trainer transition choice, every transition ends black before
  the battle, barn door wipe, Mt. Moon exit flash and white fade in, black fade into Mt. Moon). New hooks:
  `forceBattleTransition`, `field().fadeWhite`, events battleTransition / battleTransitionEnd / mapTransition /
  barnDoorWipe.

### Map name popup (map_name_popup.c)

- Ported map_name_popup.c: slide in 2 px/frame to 24 px, hold 120 frames, slide out; reshow on a second section
  change; std frame, name centred in 112/152/176 px with " <n>F" / " B<n>F" / " ROOFTOP"; CELADON DEPT. inside the
  store. Shown after warps (LoadMapInStepsLocal state 12, incl. new game start and white-out) and connection
  crossings; dismissed whenever ProcessPlayerFieldInput would return TRUE; killed on map load. extract.py now
  writes `floorNumber`; GetMapName moved to `world/regionMap.ts`. New e2e: mapNamePopup.test.ts.

### Union merge for PROGRESS.md

- `.gitattributes`: `PROGRESS.md merge=union`, so branches that each append a log entry merge without a conflict
  (git keeps both sides). Two branches editing the same line (a checklist item, "Where to resume") come out with
  both versions: tidy them after merging. Log entries from the two sides may also need a blank line between them.

### Flaky e2e fixes (merging `battle-move-anims`)

- mapNamePopup: the hold check now waits for the full height and counts the 100 frames in the page; polling from
  Node could notice the full height late on a loaded run and land in the slide-out.
- battleAnims: the Tackle test's Magikarp knows only Splash (a faster Lv. 30 Magikarp's Tackle came first), and
  the RNG is reseeded at the move-select press, so Tackle's 95% accuracy can't miss (a miss plays no anim).

### Progress docs split (user request)

- PROGRESS.md had grown to 1,100+ lines (checklist, developer guide, deviations and the full log in one file).
  STATUS.md replaces it with status and backlog only: the checklist, "Where things stand" and a "Next up" list
  (main-path blockers in order, other open work, loose ends). The rest moved to `docs/`: DEV_NOTES.md ("Where to resume", regrouped by
  area: field, GBA screens and menus, battle, testing), DEVIATIONS.md (known deviations + deliberate QOL changes,
  unchanged apart from two QOL sub-bullets that were really deviations) and LOG.md (this log). Checked that every
  old line landed somewhere except the bullets folded into "Next up".
- PROGRESS.md stays, unchanged, until branches started before the split have merged (they still edit it); CLAUDE.md
  says not to add to it and to carry merged changes over. Delete it once nothing open touches it.
- `.gitattributes`: STATUS.md and `docs/*.md` use merge=union too. CLAUDE.md says what goes where. README's stale
  roadmap removed (STATUS.md is the one checklist).

### Battle anims step 1 (BATTLE_ANIMS_PLAN.md, branch `battle-anims-step1`)

- `moves.ts` split into one module per C file (`effects1/2/3.ts`, `fire.ts`, `water.ts`, `poison.ts`,
  `electric.ts`, `flying.ts`, `ground.ts`, `bug.ts`, `dark.ts`, `ghost.ts`), plus new `fight.ts`, `rock.ts`,
  `psychic.ts`, `ice.ts`; `ported.ts` registers each. Later PRs can work on separate files.
- Ported the plan's 25 symbols (+ AnimRainDrop, which AnimTask_CreateRaindrops spawns): 67 more scripts run
  (168 of 397), e.g. Psychic/Confusion's background, Reflect/Light Screen walls (foes moved to the anim BGs),
  Rock Slide, Pin Missile, Surf/Muddy Water (BG1 wave with a BLDALPHA scanline band), Rain Dance/Sunny Day and the
  weather-continues anims, punches and kicks, Fire Spin/Whirlpool/Sand Tomb and General_TurnTrap,
  General_SafariReaction.
- Transform and General_SilphScoped: AnimTask_TransformMon (BG mosaic) and HandleSpeciesGfxDataChange
  (battle_gfx_sfx_util.c) in `gfx.ts`; the Castform branch throws until castformPalette is ported.
- `ST_OAM_HFLIP` / `ST_OAM_VFLIP` in gba/sprite.ts.
- Tests: the 67 labels in the unit list; e2e (battleAnims.test.ts) runs one move per new callback four to a battle,
  plus Transform (mosaic, transformSpecies), the Silph Scope unveil (nickname → species), Surf (blend on, then
  BLDCNT/BLDALPHA cleared) and Reflect (foe hidden on the BG, then back). New test hooks: `battle().mons[i]`
  `nickname` / `transformSpecies` / `spriteInvisible`, `gpuReg(offset)`, `startUnveiledGhostBattle(spec)`.
- Checked by eye in mid-anim screenshots: Transform, Surf, Reflect, Psychic, Rock Slide, Headbutt, Mist, Wing Attack.

### Pokémon Tower 6F: the ghost Marowak battle (StartMarowakBattle)

- `special StartMarowakBattle` + CB2_EndMarowakBattle (battle_setup.c) in `script/specials.ts`: with the Silph Scope
  a GHOST | GHOST_UNVEILED battle against a Lv. 30 female Serious Marowak with 31 IVs
  (`PokemonData.createMonWithGenderNatureLetter`, no Unown branch: every caller passes letter 0), else a GHOST
  battle against the `setwildbattle` mon; nicknamed gText_Ghost either way, behind GetWildBattleTransition. Back on
  the field VAR_RESULT = FALSE only for B_OUTCOME_WON (the script calms the ghost and sets
  VAR_MAP_SCENE_POKEMON_TOWER_6F = 1), TRUE otherwise (ran: ForcePlayerUp); a loss whites out.
- `setwildbattle` (ScrCmd_setwildbattle → CreateScriptedWildMon): gEnemyParty is `GameState.enemyParty`.
  `dowildbattle` is still unported.
- RestartWildEncounterImmunitySteps moved from runWildBattle/doSafariBattle into runBattle at the end of the
  transition, where Task_BattleStart does it for every battle (trainer and scripted battles included).
- The e2e hook `startUnveiledGhostBattle` is gone: battleAnims.test.ts's Silph Scope test now walks onto the 6F
  trigger. New tests/e2e/pokemonTower.test.ts: beating the unveiled Marowak (checks gender, nature, IVs, the
  scene var) and running from the unidentified ghost (pushed back up a tile, scene var stays 0).
- Verified: typecheck, unit tests, full e2e suite.
