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

### PROGRESS.md retired

- Every branch started before the progress docs split has merged, so PROGRESS.md is gone, along with its CLAUDE.md
  and `.gitattributes` rules. Checked first that everything in it is in STATUS.md or docs/.
- Merging `marowak-ghost-battle` (built on the unsquashed battle-anims-step1 commits) silently brought back what it
  had removed: the `startUnveiledGhostBattle` test hook, the Marowak "isn't ported" deviation and the plan's loose
  end. Fixed in the merge.

### Battle anims: set up for parallel workers (steps 2-3)

- `tests/unit/battleAnims.test.ts`: the fully-ported labels are now one list per C file (`FULLY_PORTED`), so PRs
  for different files don't edit the same lines.
- `tests/e2e/battleAnimHelpers.ts`: the anim e2e helpers (ROUTE1, animEvent, reseed, useFirstMove, useMoveSlot,
  and `expectMovesRun`, the four-moves-against-Snorlax check) moved out of battleAnims.test.ts so each worker can
  add its own `battleAnims.<file>.test.ts`.
- BATTLE_ANIMS_PLAN.md "Working in parallel": who owns which files, the cross-file symbols to leave alone, and
  which shared lines (counts, tables) only the merger edits.

### Battle anims 2A: battle_anim_fight.c, _rock.c, _ground.c, _bug.c, _poison.c

- All five files are fully ported: every sprite callback, task and helper, including the unused
  AnimUnusedHumanoidFoot (fight.ts, rock.ts, ground.ts, bug.ts, poison.ts). New: AnimTask_LoadSandstormBackground
  (BG1 blend, like Surf), AnimTask_Rollout (dirt and rock sizes follow the Rollout counter), the Seismic Toss and
  Sky Uppercut BG3 scrolls, Dig (a BG1/BG2HOFS scanline effect hides the lines below the hole),
  AnimTask_HorizontalShake (battlers or terrain), the Fissure BG3 positioning, and the Flying-sand subsprites.
- 29 more scripts run (168 → 197 of 397): Karate Chop, Stomp, Double Kick, Dizzy Punch, Cross Chop, Superpower,
  Revenge, Brick Break, Arm Thrust, Sky Uppercut, Seismic Toss, Sandstorm, Rollout, Ancient Power, Rock Smash,
  Rock Blast, Earthquake, Fissure, Dig, Bonemerang, Magnitude, Leech Life, Spider Web, Megahorn, Tail Glow, Acid,
  Sludge, Sludge Bomb, General_Sandstorm. Still waiting on other workers' files: Mega Punch, Mega Kick and
  Focus Punch (AnimTask_IsTargetPlayerSide, effects_3), Thrash, Sky Attack, Heat Wave, Eruption, Imprison,
  Luster Purge, Blaze Kick, Mud Sport, Meteor Mash, Weather Ball, Rock Tomb.
- Engine: `gBattleAnimArgs` has 16 slots (state.ts). AnimTask_IsPowerOver99 writes index 15, past the C array's
  end, and Move_MAGNITUDE's `jumpargeq 15` reads it back; with 8 slots neither branch ran. `ported.ts` registers
  the rock module's extra gfx (the sandstorm BG).
- Matches the C's out-of-range read: Sludge and Sludge Bomb call StartSpriteAnim(sprite, 2) on the one-entry
  sAnims_PoisonProjectile, which on the GBA reads the next tables in ROM (anim 2 = sAnim_SludgeBombHit); the sprite
  gets a table laid out like that.
- Tests: the 29 labels in `FULLY_PORTED`; tests/e2e/battleAnims.2a.test.ts runs one move per new callback/task
  (four to a battle, Rollout through its lock), plus Magnitude (BG3HOFS terrain shake, via arg 15), Dig (hidden
  after turn 1, both turns' anims, visible after) and Fissure (BG3 crack positioned, then the OHKO).
- Checked by eye in mid-anim screenshots: Sandstorm, Superpower, Sludge, Seismic Toss, Sky Uppercut, Dig, Rollout,
  Megahorn, and others.

### Battle anims 2B: battle_anim_water.c, battle_anim_ice.c, battle_anim_dragon.c

- All three files are ported whole (every sprite callback, task and helper, including ones no script uses:
  AnimUnusedIceCrystalThrow). New module `dragon.ts`, registered in `ported.ts` along with `registerIceExtraGfx`.
  Contest-only branches are left out (IsContest() is FALSE in FRLG); each port cites its C function.
- 22 more scripts run: Aurora Beam, Hydro Cannon, Waterfall, Water Pulse, Water Sport, Water Spout, Blizzard,
  Hail (and General_Hail), Haze, Ice Ball, Ice Beam, Ice Punch, Icy Wind, Mist Ball, Poison Gas, Powder Snow,
  Dragon Breath, Dragon Dance, Dragon Rage, Outrage, Overheat. Waiting on other files: Dive (effects_1/3), Secret
  Power (effects_1/2), Tri Attack (fire/electric/effects), Weather Ball (effects_3/rock).
- AnimTask_WaterSpoutRain calls AnimTask_HorizontalShake (ground.c, worker A) through `taskFuncByName`, skipped
  until it's registered (docs/DEVIATIONS.md). AnimWaterPulseRing is exported for effects_2's template.
- Haze and Mist Ball load the field weather's fog tiles and palette (gWeatherFogHorizontalTiles,
  gDefaultWeatherSpritePalette): `tools/extract_gfx.py` now also extracts `graphics/weather/` (rerun
  `npm run extract`).
- The C's "run backwards until off screen" loops (AnimSwirlingSnowball, AnimMoveParticleBeyondTarget,
  AnimUnusedIceCrystalThrow) are capped, since a zero velocity would hang the page as it hangs the GBA.
- No shared-engine changes.
- Tests: the labels in the water/ice/dragon `FULLY_PORTED` lists; tests/e2e/battleAnims.2b.test.ts runs every
  move four to a battle, plus Poison Gas (clouds appear and clear), Haze (BG1 fog blends to 9/16, then BLDCNT /
  BLDALPHA cleared), Hail (hailstones, crystal bursts, then General_Hail at the end of the turn) and Water Spout
  (≥10 launched droplets, splashes on the foe, both mons visible after).
- Checked by eye in mid-anim screenshots: Dragon Dance (scanline waver), Haze, Blizzard, Aurora Beam, Overheat,
  Ice Beam, Water Spout, Hail, Outrage, Dragon Rage.

### Battle anims 2C: battle_anim_fire.c, battle_anim_electric.c, battle_anim_flying.c

- All three files are fully ported (`src/battle/anim/fire.ts`, `electric.ts`, `flying.ts`): every sprite callback,
  task and helper, including the unused ones (AnimUnusedSmallEmber, AnimUnusedSpinningFist, AnimUnusedCirclingShock,
  AnimUnusedBubbleThrow, AnimUnusedFeather, AnimUnusedFlashingLight, AnimTask_SetAttackerVisibility).
  DestroyAnimSpriteAfterTimer (flying.c) was already in animMons.ts.
- 20 more scripts run (168 → 188 of 397): Fire Punch, Fire Blast, Flame Wheel, Sacred Fire, Will-O-Wisp,
  Blast Burn, Thunder Punch, Thunderbolt, Thunder, Zap Cannon, Spark, Charge, Volt Tackle, Shock Wave, Aeroblast,
  Whirlwind, Fly, Drill Peck, Feather Dance, Bounce.
- Still waiting on other files: Eruption (ground's AnimTask_HorizontalShake), Blaze Kick (fight), Heat Wave (rock),
  Dive (water), Sky Attack (dark), Tri Attack (effects_3, ice), Glare / Scary Face / Razor Wind / Astonish /
  General_MonScared (effects_2/3), General_GhostGetOut (ghost, effects_2).
- Feather Dance's `struct FeatherDanceData` (bitfields overlaid on `sprite->data`) is read into an object and
  written back each frame (readFeatherData / writeFeatherData); AnimUnusedFeather_Step's memcpy/memset juggling
  is done on the raw halfwords. Spark and the feathers write `gOamMatrices` directly, as in the C.
- No shared-engine changes.
- Tests: the labels in the fire/electric/flying `FULLY_PORTED` lists; tests/e2e/battleAnims.2c.test.ts runs every
  new callback/task four moves to a battle, plus Fly and Bounce (the attacker hidden between turns and back after)
  and Whirlwind (ends the wild battle). Checked by eye in mid-anim screenshots: Fire Blast, Sacred Fire,
  Will-O-Wisp, Thunder, Spark, Charge, Volt Tackle, Shock Wave, Feather Dance, Fly.

### Battle anims 2D: battle_anim_ghost.c, battle_anim_psychic.c, battle_anim_dark.c

- All three files are fully ported (every sprite callback, task and helper, including the unused
  AnimMonMoveCircular and AnimUnusedBagSteal): ghost.ts, psychic.ts, dark.ts. Static affine anims
  (sAffineAnim_MeditateStretchAttacker, sAffineAnim_Teleport, sAffineAnims_QuestionMark) come from anims.json.
- Scripts now complete (18): Confuse Ray, Curse, Destiny Bond, Grudge, Lick, Nightmare, Night Shade, Shadow Ball,
  Spite (ghost); Amnesia, Extrasensory, Meditate, Skill Swap, Teleport (psychic); Camouflage, Faint Attack,
  Fake Tears, Memento (dark).
- Still waiting on other files: Kinesis (AnimKinesisZapEnergy), Imprison (AnimTask_HorizontalShake), Rock Tomb
  (AnimRockTomb), Psycho Boost (AnimTask_FadeScreenToWhite), Sky Attack (AnimSkyAttackBird,
  AnimTask_HorizontalShake), General_SmokeballEscape (AnimSmokeBallEscapeCloud), General_GhostGetOut
  (AnimSprayWaterDroplet, AnimTask_StretchTargetUp).
- Engine: `ScanlineEffect_InitWave` (+ TaskFunc_UpdateWavePerFrame, GenerateWave) in src/gba/scanline.ts, used by
  Spite and AnimTask_GhostGetOut; state 3 now also stops the wave task (sShouldStopWaveTask), as in the C.
  RelocateBattleBgPal (battle_anim.c) is a local helper in ghost.ts for now, since other workers' files need it
  too; move it to battleAnim.ts when they land.
- Verified: typecheck, unit tests (new labels in `FULLY_PORTED`), tests/e2e/battleAnims.2d.test.ts (every newly
  ported move, plus Spite's wave on BGnHOFS and its cleanup, Teleport ending the battle, Memento's BGnVOFS
  shadows), and mid-anim screenshots of Curse, Spite, Grudge, Confuse Ray, Destiny Bond, Extrasensory, Amnesia,
  Teleport and Memento. Memento's attacker stays drawn over its shadow: at 0 HP GetAnimBattlerSpriteId(ANIM_ATTACKER)
  is SPRITE_NONE, so SetAllBattlersSpritePriority leaves it at priority 2, level with the BG (as on the GBA).

### Battle anims batch 1 merged (PRs #6-#9)

- Merged one at a time (A, B, C, D). Conflicts: only `ported.ts`'s extra-gfx calls (kept all). Dropped B's
  temporary Water Spout deviation once ground's AnimTask_HorizontalShake had landed. `tools/extract_gfx.py` now
  extracts `graphics/weather/` (Haze, Mist Ball): rerun `npm run extract`.
- 264 of 397 scripts run (168 before). `FULLY_PORTED.batch1Merge` lists the 59 complete scripts no worker had
  listed: ones needing two workers' files (Heat Wave, Eruption, Sky Attack, Imprison, Dive, ...) and ones already
  complete before step 2 but never listed (Agility, Body Slam, ...). Every unfinished script now only waits on
  battle_anim_effects_1/2/3.c.
- RelocateBattleBgPal stays local to ghost.ts: the other C callers are all contest-only (IsContest() is FALSE).
- Testing note: four workers each running the full e2e suite (4 Chromes each) overloaded the machine and caused
  timeouts. From batch 2, workers run only their own e2e file; the merger runs the battle anim files per PR and
  the full suite once per batch.

### Battle anims: set up batch 2 (step 3)

- `battle_anim_effects_3.c` is split between two workers at AnimTask_PainSplitMovement (C line 2914): the halves
  don't call each other. New module `src/battle/anim/effects3b.ts` (registered in `ported.ts`, own
  `FULLY_PORTED.effects3b` list) takes the second half; `effects3.ts` keeps the first.
- BATTLE_ANIMS_PLAN.md "Working in parallel": batch 2 assignments (E1, E2, E3a, E3b), workers run only their own
  e2e file, and scratch files get a per-worker prefix.

### Battle anims 3E3a: battle_anim_effects_3.c, first half

- Ported every sprite callback, task and helper of battle_anim_effects_3.c up to AnimPainSplitProjectile (C line
  2877) into `effects3.ts`, in C order: AnimBlackSmoke, AnimTask_SmokescreenImpact, AnimWhiteHalo, AnimTealAlert,
  AnimMeanLookEye, AnimTask_FadeScreenToWhite, AnimSpikes, AnimLetterZ, AnimFang, AnimTask_IsTargetPlayerSide,
  AnimTask_IsHealingMove, AnimSpotlight, AnimClappingHand(2), AnimTask_CreateSpotlight / RemoveSpotlight,
  AnimRapidSpin, AnimTask_RapinSpinMonElevation, AnimTask_TormentAttacker, AnimTriAttackTriangle, the
  Defense Curl / Stockpile / Spit Up / Swallow deform tasks, AnimBatonPassPokeball, AnimWishStar,
  AnimMiniTwinklingStar, AnimSwallowBlueOrb, AnimTask_IsMonInvisible, AnimTask_CastformGfxChange,
  AnimTask_MorningSunLightBeam, AnimGreenStar, AnimTask_DoomDesireLightBeam, AnimTask_StrongFrustrationGrowAndShrink,
  AnimWeakFrustrationAngerMark, AnimSweetScentPetal, AnimTask_FlailMovement, AnimPainSplitProjectile (step 1's
  four stay). The deform tasks' affine anims come from anims.json; the light beam BG and the smoke are preloaded
  through `registerEffects3ExtraGfx` (registered in `ported.ts`).
- Scripts now complete (27): Baton Pass, Defense Curl, Encore, Flail, Focus Punch, Frustration, Hyper Fang,
  Luster Purge, Mean Look, Mega Kick, Mega Punch, Mind Reader, Morning Sun, Poison Fang, Psycho Boost, Rapid Spin,
  Sleep Talk, Smokescreen, Spikes, Stockpile, Swallow, Sweet Scent, Torment, Tri Attack, Wish,
  General_CastformChange, General_DoomDesireHit (291 of 397 with this PR alone).
- Still waiting on effects3b.ts (the other half): Spit Up (AnimSpitUpOrb), Pain Split
  (AnimTask_PainSplitMovement), Flatter (AnimFlatterSpotlight, AnimFlatterConfetti), Present (AnimPresent,
  AnimPresentHealParticle), Solar Beam (AnimTask_CreateSmallSolarBeamOrbs, AnimSolarBeamBigOrb).
- New module `smokescreen.ts`: SmokescreenImpact (battle_anim_smokescreen.c), the four-part smoke cloud.
- Engine: HandleSpeciesGfxDataChange's Castform branch (gfx.ts) no longer throws: it takes the form from
  animationData.animArg and its palette row from the battler's Castform palette (see DEVIATIONS.md).
- Verified: typecheck, unit tests (27 labels in `FULLY_PORTED.effects3`), tests/e2e/battleAnims.3e3a.test.ts
  (every newly ported move; Doom Desire's delayed hit; Smokescreen's four smoke sprites and their cleanup;
  Encore's OBJ window + WIN1 and their reset; Castform changing to its sunny form under Sunny Day), and mid-anim
  screenshots of Smokescreen, Encore, Mean Look, Mind Reader, Morning Sun, Wish, Spikes, Sweet Scent, Rapid Spin,
  Tri Attack, Torment, Psycho Boost and Castform's sunny form.

### Battle anims 3E3b: battle_anim_effects_3.c, second half

- The second half of battle_anim_effects_3.c (AnimTask_PainSplitMovement, C line 2914, to the end) is fully
  ported into effects3b.ts: every sprite callback, task and helper, including the unused AnimUnusedItemBagSteal.
  Static affine anims (sDeepInhale, sFacadeSquish, sSmellingSaltsSquish, sSlackOffSquish) come from anims.json;
  sFacadeBlendColors is a small inline table. AnimRoarNoiseLine and AnimTask_MonToSubstitute stay in effects3.ts.
- CreateAdditionalMonSpriteForMoveAnim (battle_anim_mons.c) is ported into animMons.ts (Role Play's silhouette,
  Snatch's runner): a 64x64 affine sprite with its own sheet and palette (tags 55125/55126, local to the C file),
  the species' front or back pic (preloaded with the battle) and palette, at y + the pic's y offset.
- 24 more scripts run: Acid Armor, Assist, Barrage, Block, Endeavor, Facade, Foresight, Helping Hand, Howl,
  Knock Off, Meteor Mash, Odor Sleuth, Recycle, Refresh, Return, Reversal, Role Play, Slack Off, Smelling Salt,
  Weather Ball, Yawn, General_FocusBand, General_SmokeballEscape, General_SnatchMove. Meteor Mash isn't in
  `FULLY_PORTED.effects3b`: its trail of stars (gMiniTwinklingStarSpriteTemplate, AnimMiniTwinklingStar) is E3a's
  half, and AnimMeteorMashStar skips the trail until that callback is registered.
- Still waiting on other workers' code: Pain Split (AnimPainSplitProjectile), Flatter (AnimTask_CreateSpotlight /
  RemoveSpotlight), Glare (AnimEyeSparkle, AnimTask_ScaryFace), Teeter Dance (AnimFlyingMusicNotes), Aromatherapy
  (AnimFlyingParticle, AnimSparklingStars, AnimBlendThinRing).
- Shared engine: only the new CreateAdditionalMonSpriteForMoveAnim in animMons.ts. Refresh/Aromatherapy's cure
  bubbles (gCureBubbles*) are registered with registerAnimExtraGfx (registerEffects3bExtraGfx, called from
  ported.ts). No extractor changes.
- Verified: typecheck, unit tests (new labels in `FULLY_PORTED.effects3b`), tests/e2e/battleAnims.3e3b.test.ts
  (every newly ported move; Assist/Slack Off/Refresh with a poisoned attacker and a partner; Recycle after a
  Pecha Berry; Smoke Ball fleeing; Snatch stealing Swords Dance, with the extra mon sprite made and freed; Role
  Play's white silhouette; Acid Armor's 32-bit HBlank DMA on BGnHOFS + BGnVOFS and its cleanup; Helping Hand and
  General_FocusBand launched straight from the action menu, since the hooks have no double battles and Focus
  Band only holds 10% of the time), and tests/e2e/battleAnims.test.ts. Checked by eye in mid-anim screenshots:
  Acid Armor, Role Play, Barrage, Foresight, Facade, Refresh, Block, Smelling Salt, Yawn, Meteor Mash,
  Odor Sleuth.

### Battle anims 3E2: battle_anim_effects_2.c

- Ported the whole file into `src/battle/anim/effects2.ts`: 41 sprite callbacks (the unused templates' ones too:
  AnimCirclingFinger, AnimBouncingMusicNote, AnimVibrateBattlerBack, AnimMovingClamp, AnimVoidLines) and 23 tasks.
  AnimWaterPulseRing, also in this C file, stays in water.ts. AnimParticleBurst is exported (effects_3's templates
  use it by name). SetSpriteNextToMonHead (effects_1, worker E1) is looked up on `./effects1` at call time, so
  the file builds before E1's PR lands; only the unused sBouncingMusicNoteSpriteTemplate needs it. Swap in a
  plain import once both are merged. Q_8_8_mul / Q_8_8_inv (math_util.c) are local helpers for Air Cutter.
- 36 more scripts run (264 → 300): Astonish, Attract, Bulk Up, Bullet Seed, Disable, Extreme Speed, Fake Out,
  Fury Cutter, Fury Swipes, Guillotine, Hidden Power, Hyper Voice, Kinesis, Lovely Kiss, Minimize, Mud Sport,
  Pay Day, Perish Song, Razor Wind, Safeguard, Scary Face, Sketch, Soft-Boiled, Sonic Boom, Splash, Struggle,
  Swagger, Sweet Kiss, Swords Dance, Thrash, Tickle, Uproar, Vice Grip, Withdraw, General_GhostGetOut,
  General_MonScared. Still waiting on effects_1/3: Air Cutter (AnimAirCutterSlice), Aromatherapy, Glare
  (AnimTask_GlareEyeDots), Heal Bell (AnimSparklingStars), Spit Up (AnimTask_SpitUpDeformMon), Trick (AnimTrickBag).
- No shared-engine changes; `registerEffects2ExtraGfx` (Attract hearts BG, Scary Face BG, the music note
  palettes) is registered in `ported.ts`.
- Trap found on the way: DestroySprite resets the sprite, data included (ResetSprite in the C; a new `data`
  array here), so code that checks `sprite.data` again after destroying must re-read it rather than use a cached
  `const d = sprite.data`. AnimPerishSongMusicNote_Step2 relies on this to not destroy twice (it would have
  underflowed the visual task count and hung Perish Song).
- Verified: typecheck, unit tests (36 labels in `FULLY_PORTED.effects2`), tests/e2e/battleAnims.3e2.test.ts (one
  move per new callback / task; Chansey vs Tauros for Attract and Soft-Boiled; Guillotine from a level-100 user;
  Sketch's HBlank BGnHOFS lines and their cleanup), and mid-anim screenshots of Fake Out, Scary Face, Attract,
  Hidden Power, Perish Song, Sketch, Soft-Boiled, Pay Day and Extreme Speed.

### Battle anims 3E1: battle_anim_effects_1.c

- `src/battle/anim/effects1.ts` now ports every sprite callback and task in battle_anim_effects_1.c (in C order),
  including the unused ones (AnimTipMon, AnimSlidingHit, AnimFlickeringPunch, AnimCirclingMusicNote,
  AnimBubbleBurst, UnusedFlickerAnim, AnimTask_Hide/ShowBattlersHealthbox). The file is done.
- 35 more scripts run (264 -> 299 of 397, counted on this branch alone): General_ItemKnockoff, General_ItemSteal,
  Belly Drum, Conversion, Conversion 2, Cotton Spore, Double Team, False Swipe, Follow Me, Frenzy Plant,
  Grass Whistle, Hyper Beam, Ingrain, Leaf Blade, Lock-On, Magical Leaf, Metronome, Milk Drink, Mimic, Moonlight,
  Needle Arm, Petal Dance, Protect, Razor Leaf, Secret Power, Sharpen, Silver Wind, Sing, Skull Bash, Slash,
  Spore, Super Fang, Swift, Taunt and Twister. Still waiting on other files: Solar Beam, Heal Bell, Present,
  Trick, Teeter Dance, Aromatherapy, Air Cutter (effects_2/3 tasks).
- `AnimMoveTwisterParticle` and `SetSpriteNextToMonHead` are exported (battle_anim_rock.c's
  gTwisterRockSpriteTemplate resolves the callback by name; effects_2 can import the helper), as is
  `MoveAlongLinearPath` (non-static in the C).
- AnimHyperBeamOrb picks `Random() % 8` from a 7-entry anim table; for 7 the GBA reads the next table in ROM
  (sSolarBeamSmallOrbAnimTable), so the port appends that table for the roll (it threw before).
- AnimTrickBag_Step3 returns after destroying its sprite (the C keeps writing to it; our DestroySprite resets
  the sprite, so that would touch a fresh one).
- No shared-engine or extractor changes.
- Verified: typecheck, unit tests (`FULLY_PORTED.effects1`), tests/e2e/battleAnims.3e1.test.ts (one move per
  newly ported callback/task, Conversion 2 after being hit, Thief / Knock Off on a foe holding an item), and
  mid-anim screenshots of Protect, Moonlight, Leaf Blade, Double Team, Lock-On, Petal Dance, Silver Wind, Sing,
  Milk Drink, Metronome, False Swipe and Hyper Beam.

### Battle anims batch 2 merged (PRs #10-#13): all 397 scripts run

- Merged E3a (#12), E3b (#10), E2 (#11), E1 (#13). Conflicts: only `ported.ts`'s imports and extra-gfx calls.
  Checked E3b (done before the warning) for reads of `sprite.data` after a destroy: none.
- Merging E2 broke three earlier e2e tests (Bounce, Poison Gas, Doom Desire): with Splash's anim ported, the
  turns before their accuracy rolls take longer, and the seeded rolls missed (traced for Bounce:
  MOVE_RESULT_MISSED on turn 2). The tests now reseed right before the roll (Poison Gas: a slower foe, so its
  roll follows the move-select reseed).
- effects2.ts imports SetSpriteNextToMonHead from effects1.ts instead of looking it up at runtime.
- BATTLE_ANIMS_PLAN.md "Done when": the unit test now asserts every one of the 397 scripts is fully ported
  (replacing the per-file label lists); STATUS.md item ticked; the anim placeholder in DEVIATIONS.md is down to
  the no-audio note; the healthbox corner-lines question moved to STATUS.md "Loose ends".

### Player avatar (W-avatar): field_player_avatar.c and bike.c

- `world/playerAvatar.ts` (field_player_avatar.c) and `world/bike.ts` (bike.c) replace OverworldScene's
  hand-written movement (tap-to-turn timer, canMove/canOccupy, ledge and run checks). gPlayerAvatar is a module
  global like the C; OverworldScene implements PlayerAvatarHost and runs DoCB1_Overworld's part each tick:
  UpdatePlayerAvatarTransitionState, FieldGetPlayerInput, ProcessPlayerFieldInput (in the C's order: trainers,
  ON_FRAME, step-based scripts with coord events before step warps, walk-into-sign, wild encounter, arrow/stair
  warps, signs, A, doors, START), else PlayerStep.
- ObjectEvent: held movements (`setHeldMovement(MOVEMENT_ACTION_*)`, ObjectEventClearHeldMovement(IfFinished),
  status), movementDirection / facingDirectionLocked / disableAnim, `setGraphics` (ObjectEventSetGraphicsId), new
  speeds (FAST_2, run slow, spin, special jump, in-place durations) and the sJumpY tables instead of a parabola.
  `entities/movementActions.ts` maps action ids to them. A script `move()` clears the held movement first.
  Fixed on the way: `lock_facing_direction` steps used the facing as the step direction.
- Behaviour a player notices: turning on the spot is WALK_IN_PLACE_FAST (8 frames, as before); walking into a wall
  or NPC now plays the slow walk-in-place bump; ledges no longer check the landing tile (the C doesn't); a turn
  ending at a tile centre also runs the walk-into-sign / wild encounter checks (checkStandardWildEncounter);
  A and START are taken at a tile centre while walking; after a warp the player faces the way
  GetInitialPlayerAvatarState says (south out of doors, north off mats, kept on ladders, else south) instead of
  keeping the old facing; NPCs use GetCollisionAtCoords (they also avoid the tile the player is leaving).
- Forced movement (ice, spinners, currents, slides, waterfalls), the bike (Mach movement, Cycling Road slopes,
  ForcePlayerOntoBike, FLAG_SYS_ON_CYCLING_ROAD, stair warps take you off it, the 80% encounter rate), the
  surfing state (surf speed, CanStopSurfing → jump onto the shore, arriving on water surfs) and Strength boulders
  (TryPushBoulder, Task_BumpBoulder, holes and switches). Warps carry the bike/surf state
  (Store/GetInitialPlayerAvatarState); battles and menus rebuild it from the graphics.
- Bag: FieldUseFunc_Bike + ItemUseOnFieldCB_Bicycle through a new `gFieldCallback` (menus/fieldCallbacks.ts),
  "can't dismount" on Cycling Road, WALK in the key items menu while riding.
- Scripts: `lock`/`lockall` wait with IsFreezePlayerFinished (and turn the player their way), `release` clears the
  player's finished movement. Specials ForcePlayerOntoBike, GetPlayerAvatarBike, ForcePlayerToStartSurfing,
  SeafoamIslandsB4F_CurrentDumpsPlayerOnLand, GetPlayerFacingDirection.
- Extractor: include/global.fieldmap.h and include/bike.h added to the define headers (PLAYER_AVATAR_FLAG_*,
  COLLISION_*, T_*, running states, BIKE_*); rerun `npm run extract`.
- Not ported (DEVIATIONS.md): audio, warp arrow sprite, DoStairWarp's delay, fishing, teleport spin, the surf
  blob (W-surf), quest log.
- Tests: tests/e2e/playerAvatar.test.ts (13 scenarios), tests/unit/playerAvatar.test.ts.

### E2e: reseed in the page for the Bounce and Doom Desire tests (merging `player-avatar`)

- The Bounce test failed once in a full run under load: its reseed polled from Node for the foe's Splash to end,
  and arrived after turn 2's accuracy roll. `reseedAfterAnims()` (tests/e2e/battleAnimHelpers.ts) waits and
  reseeds inside the page; started before the anims play, it lands within a frame of the last one ending. Bounce
  and Doom Desire use it. Passed twice in a row with the anim and avatar files running four at a time.

### Field move framework: Cut, Rock Smash, Sweet Scent, Dig, Teleport, Soft-Boiled (W-fieldmove)

- field_effect.c's script interpreter (world/fieldEffectScripts.ts) over the extracted
  data/field_effect_scripts.s, and the script commands `dofieldeffect`, `waitfieldeffect`,
  `setfieldeffectargument`, `checkpartymove`, plus `buffermovename` and `setescapewarp`.
- Party menu: CursorCB_FieldMove for real (sFieldMoveCursorCallbacks as a registry, badge check, the Teleport/Dig
  YES/NO with the destination's name, Surf/Flash failure messages), FieldCallback_PrepareFadeInFromMenu +
  gPostMenuFieldCallback through a new `gFieldCallback2`, and Soft-Boiled / Milk Drink (fldeff_softboiled.c).
- FLDEFF_FIELD_MOVE_SHOW_MON(_INIT): the banner (outdoor and indoor) on the field's GBA layer, and the player's
  field move pose (CreateFieldEffectShowMon).
- Cut (trees via EventScript_CutTree / _FldEffCut, the `cut_tree` movement; grass around the player with
  FldEff_CutGrass and its 8 sprites; the Ruin Valley braille), Rock Smash (+ `rock_smash_break`, the
  RockSmashWildEncounter special), Sweet Scent (red fade, SweetScentWildEncounter, EventScript_FailSweetScent),
  Dig (escape warp, Escape Rope warp-out/in) and Teleport (last heal location, TeleportFieldEffectTask*).
- Field: the escape warp is set when leaving an outdoor map for an indoor one (UpdateEscapeWarp); warps can end in a
  gFieldCallback (OverworldScene.loadWarpedMap); a field task created by another task is no longer dropped;
  ObjectEvent.fixedPriority; ScreenFade.beginBlend.
- Extractor: field_effects/scripts.json, tileset `terrains` (METATILE_ATTRIBUTE_TERRAIN) and map `allowEscaping`.
  Rerun `npm run extract`.
- Tests: tests/e2e/fieldMoves.test.ts (11 scenarios). Deviations (audio, Sweet Scent's overlay, unported natives) in
  docs/DEVIATIONS.md; how to add Surf/Strength/Flash/Fly in docs/DEV_NOTES.md "Field moves".
### Field ListMenu (Silph Co. elevator) and Flash's darkness (W-list)

- `special ListMenu` / `special ReturnToListMenu` (field_specials.c) in `ui/FieldListMenu.ts`: list_menu.c's
  ListMenu (scrolling, the cursor's middle-row rule, key repeat) on a field MenuWindow with the user frame, the
  bouncing scroll arrows (menu_indicators.c, sRedArrowOtherGfx as Phaser images) and the list task (create,
  input, suspend while the script talks, ReturnToListMenu). Silph Co.'s elevator starts where
  InitElevatorFloorSelectMenuPos puts it (`sElevatorScroll` / `sElevatorCursorPos`); the Cerulean badge list
  suspends on a choice; the berry powder list works too (berry powder still reads 0).
- Flash's darkness (`world/flash.ts`): `gSaveBlock1Ptr->flashLevel` (`GameState.flashLevel`),
  SetDefaultFlashLevel on every map load (FLAG_SYS_FLASH_ACTIVE cleared on arriving outdoors by a warp),
  SetFlashScanlineEffectWindowBoundaries' circle kept as a per-line WIN0H table (double-buffered like the
  scanline effect) and painted as a black overlay under the text windows; InitCurrentFlashLevelScanlineEffect
  after a warp and on returning from a battle or menu (ResumeMap). Script commands `setflashlevel` and
  `animateflash` (AnimateFlash / UpdateFlashLevelEffect / Task_WaitForFlashUpdate, including the C's quirk that
  a shrink ends after one step). `FldEff_UseFlash` / `OverworldScene.useFlash()` for the Flash field move.
- Battles: GetBattleTransitionTypeByMap returns TRANSITION_TYPE_FLASH while the flash level isn't 0 (Blur / Grid
  Squares), and the field on the GBA layer keeps the circle on WIN0 through the transition.
- Extractor: maps carry `cave` (map.json `requires_flash`); scripts.json carries `listMenus`
  (field_specials.c sListMenuLabels). Rerun `npm run extract`.
- Not done: the party menu's Flash (SetUpFieldMove_Flash → FieldCallback_Flash → FldEff_UseFlash) waits for
  W-fieldmove's field move framework; `SetUpFieldMove_Flash` and `useFlash()` are ready for it.
- Tests: tests/e2e/listMenuFlash.test.ts (elevator scrolling, B, riding to 5F; the badge list; Rock Tunnel dark,
  lit by Flash, lit on arrival with FLAG_SYS_FLASH_ACTIVE; Blur over the dark field, Clockwise Wipe once lit).
### PC boxes and the save data model (W-state)

- `state/PokemonStorage.ts`: struct PokemonStorage (14 boxes of 30 BoxPokemon, names, wallpapers, current box) with
  pokemon_storage_system.c's accessors, ResetPokemonStorageSystem, GetFirstFreeBoxSpot, CountMonsInBox,
  SeekToNextMonInBox, BoxMonToMon / MonRestorePP. `state.storage` replaces the default-box-name placeholders.
- GameState: GiveMonToPlayer → SendMonToPC when the party is full (MON_GIVEN_TO_PC, VAR_MON_BOX_ID/POS,
  VAR_PC_BOX_TO_SEND_MON, FLAG_SHOWN_BOX_WAS_FULL_MESSAGE), IsDestinationBoxFull, ShouldShowBoxWasFullMessage,
  Get/SetPCBoxToSendMon, IsPlayerPartyAndPokemonStorageFull, CountPartyMons / NonEggMons / AliveNonEggMons*,
  pcItems, play time (play_time.c, not ticked yet), escape / continue-game warps, `location`. The constructor
  takes text/strings.json (for gText_Box).
- `state/saveData.ts`: `toSaveData(state)` / `fromSaveData(data, state)` (versioned JSON, exact round trip) and the
  localStorage slot (`writeSave` / `readSave` / `hasSave` / `clearSave`). `OverworldScene.storeLocationForSave()`
  fills `state.location` before a save.
- Outside state/: Cmd_givecaughtmon sets STR_VAR_1-3 and takes the box-full branch; the naming screen's
  DisplaySentToPCMessage uses real box names and IsDestinationBoxFull (and GetPCBoxToSendMon for STR_VAR_3, which
  read VAR_PC_BOX_TO_SEND_MON before); `bufferboxname`; specials ShouldShowBoxWasFullMessage, GetPCBoxToSendMon,
  ChangeBoxPokemonNickname, CountPartyNonEggMons, CountPartyAliveNonEggMons_IgnoreVar0x8004Slot and a real
  IsThereRoomInAnyBoxForMorePokemon; IsPlayerPartyAndPokemonStorageFull in the Safari ball action and ball item
  use; `t.battle().message` probe.
- No extractor changes (TOTAL_BOXES_COUNT etc. were already in the defines).
- Deviations: removed the naming screen's "sent to PC" placeholder, ChangeBoxPokemonNickname and "Full party";
  added PC boxes (no UI), save data (no flash/checksums/encryption; what isn't kept) and play time.
- Tests: tests/unit/pcBoxes.test.ts, tests/unit/saveData.test.ts, tests/e2e/pcBoxes.test.ts (givemon and catches
  with a full party, with and without a full current box, a nicknamed catch, the save slot in the browser).

### Batch 1 of MAIN_PATH_PLAN.md merged (PRs #14-#17); Flash from the party menu

- Merged W-avatar (#14), W-state (#15), W-list (#16) and W-fieldmove (#17). Conflicts: OverworldScene's imports
  and field-task loop (kept the task-survival fix and the flash tick); GameState had `escapeWarp` and `WarpData`
  from both W-state and W-fieldmove (kept one). The save data now includes `flashLevel` (W-list's field).
- Flash from the party menu: `SetUpFieldMove_Flash` / `FieldCallback_Flash` in world/fieldMoves.ts, on W-list's
  check and FldEff_UseFlash; FieldMoveHost gains `cave()` and `useFlash()`. e2e: fieldMoves.test.ts.
- Extracting in a worktree: set `FIRERED_DECOMP=/path/to/pret/firered` (the default is a path relative to the
  checkout, which a worktree doesn't have).

### Save dialog, main menu and CONTINUE (MAIN_PATH_PLAN.md W-save)

- start_menu.c's save dialog (`ui/SaveDialog.ts`): StartMenuSaveCallback → StartCB_Save1/2 and the SaveDialogCB_*
  chain ("Would you like to save the game?", the overwrite / different game file questions, "SAVING... DON'T TURN
  OFF THE POWER.", "PLAYER saved the game." with the 60-frame / A-held wait, the save error), with the save info
  window (PrintSaveStats; save_menu_util.c's SaveStatToString and pokedex.c's Kanto/National counts in
  `ui/saveMenuUtil.ts`). The start menu's SAVE entry opens it; NO returns to the start menu.
- save.c on the localStorage slot (`state/save.ts`): LoadGameSave / gSaveFileStatus (EMPTY / OK / INVALID),
  TrySavingData / gSaveAttemptStatus, gDifferentSaveFile, load_save.c's continue-game warp flag.
- main_menu.c on the GBA layer (`menus/mainMenu.ts` + `scenes/MainMenuScene.ts`): CONTINUE with the player's
  name, play time, Pokédex count and badges / NEW GAME, the WIN0 darkening, the "save file has been deleted"
  message for an unreadable slot. FRLG has no OPTIONS on the main menu; MYSTERY GIFT is left out.
- CB2_ContinueSavedGame (`OverworldScene.continueSavedGame`): the save loaded into the state, the saved map and
  position, facing and bike/surf state, ON_LOAD then ResumeMap's scripts, or the continue-game warp if set.
- Boot (decided in MAIN_PATH_PLAN.md): main menu when the slot holds something, the new game otherwise; dev
  starts skip it. Logged as a deviation until the title screen exists.
- Play time: PlayTimeCounter_Start on the new game and CONTINUE, PlayTimeCounter_Update every logic tick in the
  field and on every GBA-layer screen (GbaHostScene).
- Shared changes: OverworldScene (OverworldStart.continueGame, the CONTINUE path, onMapLoaded's continue mode, the
  new game's gDifferentSaveFile/play time, play time per tick, SAVE in the start menu), BootScene (boot flow),
  main.ts (MainMenuScene), GbaHostScene/BattleScene/FieldMenuScene (play time), YesNoMenu (default NO, input
  delay option), StartMenu (probe), saveData.ts (`saveSlotUsed`), testHooks (`startMenu`, `saveDialog`,
  `mainMenu` probes), e2e harness (`keepSave`, `mainMenu`, `clearSave`).
- Extractor: include/save.h, save_location.h and save_menu_util.h defines (SAVE_STATUS_*, SAVE_NORMAL..,
  CONTINUE_GAME_WARP, SAVE_STAT_*), and graphics/main_menu/ palettes (sBg_Pal, sTextbox_Pal).
- Tests: tests/unit/save.test.ts, tests/e2e/saveContinue.test.ts (YES / NO / overwrite, CONTINUE after a reload
  with map, position, facing, bike, party, bag, flags, money and play time, the continue-game warp, play time
  per frame in the field and the bag and shown in both windows, the boot flow and NEW GAME's warning, an
  unreadable save).
### Surf and Waterfall (W-surf)

- `world/surf.ts`: SetUpFieldMove_Surf / _Waterfall and FieldCallback_Surf / _Waterfall (party_menu.c);
  FldEff_UseSurf (Task_FldEffUseSurf: the field move pose, the banner, JUMP_SPECIAL onto the water) and
  FldEff_UseWaterfall (Task_UseWaterfall: the banner, then WALK_SLOWER north until off the waterfall) from
  field_effect.c; the surf blob (field_effect_helpers.c: FldEff_SurfBlob, UpdateSurfBlobFieldEffect with
  SynchroniseSurfAnim / SynchroniseSurfPosition / CreateBobbingEffect, SetSurfBlob_*); GetInteractedWaterScript
  (field_control_avatar.c) so pressing A at the water runs EventScript_UseSurf / EventScript_CurrentTooFast and
  at a waterfall EventScript_Waterfall / EventScript_CantUseWaterfall; IsPlayerFacingSurfableFishableWater and
  MetatileAtCoordsIsWaterTile (field_player_avatar.c) on the extracted terrain attribute.
- The blob comes and goes with the avatar's state: the player avatar's host hooks (QL_GfxTransition_StartSurf on
  arriving on water, after a battle or menu, ForcePlayerToStartSurfing; BOB_MON_ONLY when jumping off, then
  DestroySprite; SetPlayerInvisibility). Wild encounters on water already worked (WildEncounters.ts).
- Outside world/surf.ts: `registerSurfAndWaterfall()` in fieldMoves.ts's `registerFieldMoves`, which also exports
  LockPlayerFieldControls / UnlockPlayerFieldControls / CreateTask / StartPlayerAvatarSummonMonForFieldMoveAnim
  and a new LoadFieldMoveShowMonGfx; FieldEffects.ts exports FieldEffectSprite and gains `createSprite`;
  playerAvatar.ts gains the `destroySurfBlob` / `setSurfBlobInvisible` hooks (Task_WaitStopSurfing,
  SetPlayerInvisibility); OverworldScene: the hooks, `setSurfHost`, GetInteractedWaterScript in `interact`, the
  `surfBlob` probe; partyMenu.ts reports DisplayPartyMenuStdMessage as a `partyMenuMessage` test event;
  `__test.setAvatarState` off the water drops the blob.
- No extractor changes: the surf blob sprite and the terrain attribute were already extracted.
- Tests: tests/e2e/surf.test.ts (A at the water with/without the badge or a Surf mon, the party menu, refusals
  with their messages, riding and the bob, getting off, a wild encounter on water, Waterfall at Icefall Cave by A
  and from the party menu).

### Strength, dowildbattle and StartLegendaryBattle (W-strength, batch 2)

- `world/strength.ts` is fldeff_strength.c: SetUpFieldMove_Strength (not surfing, a boulder in front), FieldCB_UseStrength
  → EventScript_FldEffStrength, FldEff_UseStrength (the banner, GetMonNickname into STR_VAR_1) and
  ShowMonCB_UseStrength. Registered in fieldMoves.ts's `registerFieldMoves` (one line) and through
  `registerFieldEffectNatives`; fieldMoves.ts now exports CreateFieldEffectShowMon, ScriptContext_Enable and
  ScriptContext_SetupScript for other field move modules. EventScript_StrengthBoulder (talking to a boulder) works
  through the existing script commands.
- ClearTempFieldEventData (`GameState.clearTemps`, every map load) now also clears FLAG_SYS_WHITE_FLUTE_ACTIVE,
  _BLACK_FLUTE_ACTIVE, _USE_STRENGTH, _SPECIAL_WILD_BATTLE and _INFORMED_OF_LOCAL_WIRELESS_PLAYER as in the C, so
  Strength (and the flutes) end with the map.
- Victory Road's floor switches: `copyobjectxytoperm` (TryOverrideObjectEventTemplateCoords) and
  `special DrawWholeMapView` (nothing to do: `setmetatile` redraws its cell).
- `dowildbattle` (ScrCmd_dowildbattle → StartScriptedWildBattle, BATTLE_TYPE_WILD_SCRIPTED behind
  GetWildBattleTransition) and `special StartLegendaryBattle` (BATTLE_TYPE_LEGENDARY | _LEGENDARY_FRLG behind
  B_TRANSITION_BLUR; the MUS_VS_* choice is noted, no audio), both ending in CB2_EndScriptedWildBattle (specials.ts
  `runScriptedWildBattle`): a loss whites out, otherwise ResumeMap's ON_RESUME script runs (FLAG_SYS_SPECIAL_WILD_BATTLE
  still set: Route 12 / 16 remove Snorlax, Cerulean Cave / Seafoam / Mt. Ember / Power Plant remove a caught
  legendary) and the script continues after the fade with GetBattleOutcome. Covers Snorlax (Routes 12 and 16),
  Zapdos, Articuno, Moltres, Mewtwo, the Power Plant's Electrode and Berry Forest's Hypno.
- Changes outside the new modules: ScriptEngine.ts (`dowildbattle`, `copyobjectxytoperm`), specials.ts
  (StartLegendaryBattle, DrawWholeMapView, StartScriptedWildBattle), GameState.clearTemps, fieldMoves.ts (exports +
  the registration line). None in playerAvatar.ts or OverworldScene.ts. No extractor changes.
- Not done: `setmaplayoutindex` (Seafoam B3F/B4F's "current stopped" layouts once both boulders are down: needs the
  extractor to export layouts no map uses, and a layout swap at ON_TRANSITION), `seteventmon` (Navel Rock / Birth
  Island event legendaries).
- Tests: tests/e2e/strength.test.ts (talk to a boulder, the party menu, Victory Road 2F's switch 1 with
  copyobjectxytoperm, the flag cleared by a warp, no boulder in front, no badge), tests/e2e/scriptedBattles.test.ts
  (Route 12 Snorlax won and gone after re-entering, Route 16 Snorlax ran from, no Poké Flute, Zapdos won, Mewtwo
  caught with a Master Ball, losing to Mewtwo).

### E2e: in-page watches for short-lived states (merging `save-continue`)

- Under load, three tests polled from Node for things that last a few ticks and missed them: Strength's boulder
  push (hold and watch were two evals, and the release came late enough for a second push), and Surf's jump onto
  the water and the Waterfall climb. They now hold/watch/release in one eval, or start an in-page watcher
  (`watchAction` in surf.test.ts) before the action. tests/README.md "Writing a new scenario" has the rule.
  Strength, scripted battles, Surf and save/continue passed four loaded runs in a row after the fix.

### Pokémon Storage System screens and the player's item PC (W-pc)

- The PC's storage menu (`special ShowPokemonStorageSystemPC`, Task_PCMainMenu) as a field overlay
  (ui/StoragePcMenu.ts), and the box screen on the GBA layer (FieldMenuScene 'storage'): pokemon_storage_system.c,
  _tasks.c, _data.c (cursor/input), _graphics.c, _menu.c (box popup) and _misc.c (moving several mons, MOVE ITEMS)
  in menus/pokemonStorage*.ts, with tilemap_util.c and pc_screen_effect.c. WITHDRAW / DEPOSIT / MOVE POKéMON /
  MOVE ITEMS: picking up, placing and shifting mons (box and party), the party box, scrolling between boxes
  (wallpapers, titles, icon scroll), the deposit / jump popup, releasing (with the Surf/Dive check), the box options
  (JUMP, WALLPAPER, NAME through the naming screen), MARK (mon_markings.c's markings menu, now in
  menus/monMarkings.ts; `Pokemon.markings` is kept and saved), the summary of a party, carried or boxed mon, and held
  items (TAKE / BAG / INFO / GIVE from the bag / SWITCH).
- Summary screen: PSS_MODE_BOX (a box's slots through BoxMonToMon, SeekToNextMonInBox) and the markings sprite.
- The player's PC (`special PlayerPC` / `BedroomPC`, ui/PlayerPcMenu.ts): ITEM STORAGE (WITHDRAW ITEM = item_pc.c in
  menus/itemPc.ts, incl. moving items and GIVE through the party menu; DEPOSIT ITEM = the bag's
  Task_ItemContext_Deposit), MAILBOX (empty), TURN OFF. NewGameInitPCItems puts the Potion in the PC
  (state/pcItems.ts has item.c's PC item functions).
- Outside menus/: FieldMenuScene menus 'storage' / 'itemPc' / 'itemPcDeposit'; OverworldScene.openPokemonStoragePc /
  openPlayerPc; ScriptHost gains both, SpecialEnv gains `setupScript` (ScriptContext_SetupScript, for BedroomPC's
  shut-down script; the script loop no longer drops a context a special set up); MessageBox.show's `instant`;
  `SetReservedSpriteTileCount` (sprite.ts); `KeyRepeat` exported from ui/FieldListMenu.ts; the bag's
  Task_ItemContext_PcBoxGive / Task_ItemContext_Deposit; the party menu gives / returns PC items for
  PARTY_ACTION_GIVE_PC_ITEM; GameState runs NewGameInitPCItems; `markings` in saveData's box mon fields (optional,
  no version bump); test probes `pcStorage()` / `itemPc()`.
- Extractor: graphics/pokemon_storage/ and graphics/item_pc/ in extract_gfx.py (whose INCBIN pattern now also takes
  `[][16]` arrays, the wallpaper palettes), the pokemon_storage_system_*.c anim tables in extract_anims.py, and
  include/pokemon_storage_system_internal.h's constants. Rerun `npm run extract`.
- Tests: tests/e2e/pcStorage.test.ts (17 scenarios, incl. the bedroom PC).

### E2e: exact-tick reseed, one-eval holds (merging `pc-storage`)

- Doom Desire's test could still miss its roll, even on an idle machine: `reseedAfterAnims` reseeded from a promise
  continuation, which runs after the frame's whole batch of logic ticks, so the reseed landed a variable number
  of ticks after the anim. New dev hook `t.seedWhen(pred, n)` seeds inside the first tick `pred` holds (through
  the virtual pad's per-tick drivers); `reseedAfterAnims` uses it.
- playerAvatar.test.ts: the bike ride and the hold / watch / release sequences (bump, run, ledge, ice, spinner,
  boulder push) are each one eval now. The bike test failed under load (the gaps between evals counted as frames).
- Passed three loaded runs of playerAvatar, strength, surf and battleAnims.3e3a together.

### Region map (Town Map, wall maps, fly map) and Fly (W-fly, batch 3)

- `menus/regionMap.ts` is region_map.c on the GBA layer, all three REGIONMAP_TYPE_*s: the Town Map from the bag
  (FieldUseFunc_TownMap → InitRegionMapWithExitCB(NORMAL, CB2_BagMenuFromStartMenu): the map edges opening and
  closing, the Kanto / Sevii 1-3 / 4-5 / 6-7 switch menu, the dungeon map previews with their tint and description),
  the wall maps (`special ShowTownMap`, EventScript_WallTownMap) and the fly map (CB2_OpenFlyMap). The cursor (held
  D-pad, START snapping to the player / SWITCH / CANCEL), the player icon (with the section overrides and the
  position scaled into its section, from the escape / dynamic warp indoors), dungeon icons (visited or not), fly
  icons on visited towns (FLAG_WORLD_MAP_*), the map name and dungeon name windows, the top bar.
- `world/fly.ts`: SetUpFieldMove_Fly, the fly destination (sMapFlyDestinations → SetWarpDestinationToHealLocation),
  ReturnToFieldFromFlyMapSelect / FieldCallback_UseFly / Task_UseFly, FldEff_FlyOut and FldEff_FlyIn with the bird's
  sprite callbacks and affine anims, Overworld_ResetStateAfterFly, FieldCallback_FlyIntoMap / Task_FlyIntoMap.
  The party menu's FLY opens the fly map; B there goes back to the party menu (CB2_ReturnToPartyMenuFromFlyMap).
- Found on the way: the port's BG copies are immediate where the GBA's DMA3 copies at VBlank, so the region map's
  top bar (put right after its copy request) stayed blank; the screen now re-copies requested tilemaps at its
  VBlank (DEVIATIONS).
- Shared changes: partyMenu.ts (the FLY case, CB2_ReturnToPartyMenuFromFlyMap), fieldMoves.ts (FieldMoveHost
  `loadMapHeader` / `healLocation` / `camera` / `createFieldEffectSprite`, `fieldMoveHost`,
  Overworld_ResetStateAfterFly, `prepareRegionMap` from prepareFieldMoveMenu, `registerFly`), OverworldScene
  (those host members, `showTownMap`, the bag also waits for prepareFieldMoveMenu), FieldMenuScene ('townMap',
  region map graphics preloaded with the party menu and the bag), itemUse.ts (FieldUseFunc_TownMap),
  ScriptEngine.ts (`ScriptHost.showTownMap`), specials.ts (ShowTownMap), FieldEffects.ts (FieldEffectSprite
  `scaleY` / `rotation` / `crop`), ObjectEvent.ts (run-time `inanimate`), menus/data.ts (`regionMap`), testHooks
  (`regionMap()` probe).
- Extractor: graphics/region_map/ and graphics/map_preview/ in extract_gfx.py; menus.json `regionMap` in
  extract_menus.py (layouts, section corners and sizes, sSeviiMapsecs, sMapFlyDestinations, sDungeonInfo,
  sMapPreviewScreenData, MAP_NUMs). Rerun `npm run extract`.
- Tests: tests/e2e/fly.test.ts (9: the Town Map + a dungeon preview + back to the bag, the Sevii switch menu,
  opening on the Sevii map, indoors via the escape warp, a wall map, flying Pallet → Viridian's heal location, an
  unvisited town refused, indoors refused, no Thunder Badge refused). typecheck, `npm test` (85) and the full
  `npm run test:e2e` (222) pass.
### Hall of Fame, the Hall of Fame PC and the credits (W-hof, batch 3)

- hall_of_fame.c on the GBA layer (`menus/hallOfFame.ts`, FieldMenuScene 'hallOfFame' / 'hallOfFamePc'): the
  screen (the team's record saved with the game, the mons coming on one by one with their info, the welcome text
  and confetti, the player's pic and trainer info, A to leave) and the Hall of Fame PC (the saved teams newest
  first, UP/DOWN through the mons, A to the older team, B out; "corrupted" without records), with the PC screen
  effect. post_battle_event_funcs.c's EnterHallOfFame (FLAG_SYS_GAME_CLEAR, GAME_STAT_FIRST_HOF_PLAY_TIME, CONTINUE
  from Pallet Town) and SetWarpsToRollCredits (DoWarp into Indigo Plateau from a GBA screen:
  `OverworldScene.warpFromScreen`); hof_pc.c's return to the PC menu (its choice ends the script's `waitstate`).
- FLDEFF_HALL_OF_FAME_RECORD (`world/hallOfFameRecord.ts`): the machine's Poké Balls placed and flashing, the
  monitor; the shared CreateGlowingPokeballsEffect is there for FLDEFF_POKECENTER_HEAL too.
- credits.c (`menus/credits.ts`) on the field's GBA layer: the title, the 13 scrolling map scenes in the darkened
  WIN0 band with the player / rival running on the ground sprite, the Charizard / Venusaur / Blastoise / Pikachu
  scenes (with the white circle on an affine BG2), the copyright and THE END, then SoftReset: a fresh Overworld
  scene and BootScene again (`{ softReset: true }`), i.e. the main menu, where CONTINUE starts in Pallet Town and
  Oak's National Dex scene follows. Indigo Plateau's script needed `special SpawnCameraObject` /
  `RemoveCameraObject`.
- State: game stats in GameState and the save (SAVE_VERSION 2; `upgradeSave` reads version 1 saves);
  `state/hallOfFame.ts` keeps the records under their own localStorage key; TrySavingData handles
  SAVE_HALL_OF_FAME (GAME_STAT_ENTERED_HOF, records) and SAVE_OVERWRITE_DIFFERENT_FILE (erases them).
- Shared changes: FieldMenuScene (two menus, `onExit`'s `warp`), OverworldScene (enterHallOfFame,
  openHallOfFamePc, warpFromScreen, doCredits, spawnCameraObject public, the record effect's host, tile anims off
  while the credits run), ScriptHost (+4 methods, `fadeScreen` delay), ScriptEngine (`fadescreenspeed`, which
  was unimplemented), specials (EnterHallOfFame, HallOfFamePCBeginFade, DoCredits, Spawn/RemoveCameraObject,
  IsNationalPokedexEnabled as a special, Script_UpdateTrainerFanClubGameClear as a no-op), BootScene
  (`softReset`), FieldGbaScreen (`reloadField`), the PPU (affine BGs in modes 1 and 2), picSprites (trainer pics),
  `menus/topBarWindow.ts` (menu.c's top bar window, which Oak's speech also uses), testHooks (`hallOfFame()`,
  `credits()`, `creditsSkipToClosing()`).
- Extractor: graphics/hall_of_fame/ and graphics/credits/ in extract_gfx.py. Rerun `npm run extract`.
- Found on the way: `specialvar VAR_RESULT, IsNationalPokedexEnabled` (EventScript_SetDefeatedEliteFourFlagsVars)
  was an unknown special, so Oak's National Dex scene always got set up; restarting a Phaser scene keeps its
  instance fields (the GameState among them), so SoftReset replaces the scene instead.
- Tests: tests/e2e/hallOfFame.test.ts (the whole ending from the room's entrance to CONTINUE in Pallet Town, with
  the record and save checked and the credits skipped after the Charizard scene; the PC with two teams; the PC
  without records), tests/unit/save.test.ts (the records, GAME_STAT_ENTERED_HOF, version 1 saves). Full e2e run:
  two battle anim tests failed under the parallel load (missed rolls) and passed when rerun alone.
### Title screen and clear save data screen (`title-screen`)

- title_screen.c on the GBA layer (menus/titleScreen.ts): CB2_InitTitleScreen, the flash sweeping up Charizard
  (a BLDY scanline effect), the grey fade-in, the WIN0 slide that brings in the border and copyright BGs, the white
  flashes, then the run scene: PRESS START blinking, Task_FlameSpawner's flames, the OBJ-window slash lightening
  the logo. A/B/START during the intro skip to the run scene; A/START there plays the cry scene and fades to white
  into the main menu (LoadGameSave again, as SetTitleScreenScene_Cry does); 2700 frames without input restart the
  title screen (straight back to it: intro.c isn't ported). B+SELECT+UP opens clear_save_data_screen.c
  (menus/clearSaveDataScreen.ts), whose YES empties the save slot; both answers soft-reset.
- Boot: BootScene now starts MainMenuScene on the title screen; MainMenuScene hosts the title screen, the clear
  save data screen and the main menu (B on the main menu goes back to the title screen for real now). Dev
  `?skipIntro` keeps the old boot (main menu with a save, else the new game); the e2e harness passes it unless a
  test asks for `title: true`. `softReset(scene)` (scenes/BootScene.ts) is the restart-the-game entry point
  (DoSoftReset): it stops every scene and boots again, reusing the loaded data.
- Shared helpers: TintPalette_GrayScale2 and DestroyBlendPalettesGraduallyTask (gba/palette.ts), ResetBgPositions
  (gba/menu.ts), no-op m4aSongNumStart / FadeOutBGM / FadeOutMapMusic / IsNotWaitingForBGMStop (gba/sound.ts).
  CB2_InitMainMenu reports the `mainMenu` test event (it used to be the scene's create).
- Found on the way: SetTitleScreenScene_Restart destroys the blink task by FindTaskIdByFunc after it may have ended
  itself, i.e. DestroyTask(TASK_NONE), which reads past gTasks on the GBA; the port skips it. The clear save data
  screen's backdrop is the title logo palette's colour 0 (green), since neither screen reloads gPlttBufferUnfaded[0]
  (as on the GBA).
- Extractor: graphics/title_screen/ in extract_gfx.py. Rerun `npm run extract` (or `python3 tools/extract_gfx.py`).
- Tests: tests/e2e/titleScreen.test.ts (boot → title → intro scenes → PRESS START blinking and flames → START →
  new game; A skipping the intro, START → main menu with a save, B back to the title, CONTINUE; the 2700-frame
  restart; the clear save data screen, NO and YES). saveContinue.test.ts's boot test goes through the title screen
  after B on the main menu.
### Main-path leftovers: card key doors, setmaplayoutindex, Field_AskSaveTheGame, seteventmon (W-misc, batch 3)

- Silph Co.'s card key doors (data/scripts/silphco_doors.inc) already worked end to end: ON_LOAD's `setmetatile`
  closes them (collision included), the bg events say "It needs a CARD KEY!" without FLAG_HIDE_SILPH_CO_5F_CARD_KEY,
  open them with it (`special SetHiddenItemFlag` sets FLAG_SILPH_*_DOOR_*), and ON_LOAD leaves an open door open
  after a warp. Now covered by e2e tests; no code change.
- `setmaplayoutindex` (ScrCmd_setmaplayoutindex → SetCurrentMapLayout): `GameState.mapLayoutId`
  (gSaveBlock1Ptr->mapLayoutId) set from the header before ON_TRANSITION (LoadCurrentMapData), changed by the
  command, then `OverworldScene.initMapLayout` swaps the current chunk's grid (`World.setCurrentLayout`) before
  ON_LOAD. Saved with the location (`location.mapLayoutId`) and used by CONTINUE (LoadSaveblockMapHeader).
  Seafoam Islands B3F/B4F switch to the *_CURRENT_STOPPED layouts once both boulders are down, and the currents
  (MB_*_CURRENT, world/playerAvatar.ts) stop with them.
- Extractor: maps get `layoutId`; the 55 layouts no map uses (except the NULL-tileset leftovers) go to
  `maps/layouts/<LAYOUT_ID>.json` (adds the Building/HoennBuilding tileset pair), `maps/layouts/index.json` maps
  the used ones to a map file; LAYOUT_* ids (index + 1, as mapjson generates them) in the script defines. Rerun
  `npm run extract`.
- `special Field_AskSaveTheGame` (start_menu.c, EventScript_AskSaveGame): the SAVE dialog (ui/SaveDialog.ts) run
  as the special's wait state (task50_save_game), VAR_RESULT TRUE once saved, FALSE for NO / B / a failed write.
  The cable club attendants reach it now, so the link specials on that path got stand-ins: TryBattleLinkup /
  TryTradeLinkup never find a partner (B → LINKUP_FAILED, as on a GBA with nothing plugged in; before, an
  unported linkup would have left VAR_RESULT = TRUE = LINKUP_SUCCESS and walked the player into the Colosseum),
  IsWirelessAdapterConnected / ValidateSavedWonderCard / IsBadEggInParty FALSE, CloseLink and
  HelpSystem_Enable/Disable no-ops.
- `seteventmon` (`special CreateEnemyEventMon`): Navel Rock's Lugia / Ho-Oh, Birth Island's Deoxys.
- Shared-file changes: ScriptEngine.ts (`setmaplayoutindex`; SpecialEnv gains `input`, `hideFieldMessageBox`;
  ScriptHost gains `createSaveDialog`), specials.ts, OverworldScene.ts (onMapLoaded / initMapLayout,
  storeLocationForSave, createSaveDialog split out of openSaveDialog, a `multichoice` test event), World.ts,
  assets.ts, types.ts, GameState.ts (`mapLayoutId`, PlayerLocation.mapLayoutId; no saveData.ts change), extract.py.
- Fix on the way: playerAvatar.test.ts's current ride started on B4F from a dev start, where both boulders now
  count as down (Route20_OnTransition never ran) and the currents are stopped; it hides them first and warps in.
  pcBoxes.test.ts's stored-location check now expects `mapLayoutId` in the location.
- Verified: typecheck, `npm test` (85), full `npm run test:e2e` (221; five battle anim tests failed once while
  other workers' suites shared the machine and passed on a rerun of those files).
- Tests: tests/e2e/mainPathLeftovers.test.ts (Silph Co. 5F door + the Card Key ball, Seafoam B4F stopped / running /
  after CONTINUE, B3F, the cable club save prompt NO and YES, Lugia via seteventmon).

### Oak's speech (`oak-speech`)

- oak_speech.c on the GBA layer (menus/oakSpeech.ts), run by MainMenuScene for NEW GAME: the three controls guide
  pages (top bar, keypad icons, the button pics), the Pikachu intro (blended page turns), then Oak: Nidoran♀ out of
  its Poké Ball and back (pokeball.c's CreatePokeballSpriteToReleaseMon / CreateTradePokeballSprite with the ball's
  open particles and the mon's fade), BOY / GIRL, the player's name (the naming screen; NO renames), the rival's
  name (NEW NAME → the naming screen, or one of the four presets), "Let's go!" and the player pic turning white and
  shrinking on the affine BG2, then CB2_NewGame. The names and gender end up in the field's new GameState
  (OverworldStart `newGameProfile`, via Charmap.decodePlain).
- GBA layer: affine BGs (PPU modes 1-2, bg.c's affine tilemap paths, SetBgAffine + BgAffineSet, ChangeBgX/Y writing
  BG2X/Y), menu.c's top bar window (gba/topBarWindow.ts), text.c's text cursor sprite (gba/textCursor.ts),
  GetStdWindowBaseTileNum, no-op PlayBGM. resetHardware now leaves BG2/BG3 PA = PD = 0x100 (RegisterRamReset).
- Found on the way: ChangeBgX/Y only wrote BG0/BG1's offsets in bg mode 0; bg.c writes them in mode 1 too (and the
  affine reference point for BG2). Task_OakSpeech_DestroyPlatformSprites destroys sprite 0 three times (its own
  task's data[7..9] were never set; a decomp-documented bug), kept.
- Extractor: graphics/oak_speech/ in extract_gfx.py.
- Tests: titleScreen.test.ts gains two Oak's speech scenarios (GIRL with both names typed in the naming screen →
  PlayersHouse_2F with the names and the female avatar; BOY, NO → rename, a preset rival name); charmap.test.ts
  covers decodePlain.

### Batch 3 merged (#22-#27)

- Merged in order: the plan (#22), main-path leftovers (#24), the title screen (#23), Oak's speech (#26, retargeted
  to master and merged as master + its own diff since the squashed title-screen head), the Hall of Fame (#27), Fly
  (#25). Full suite after the last merge: typecheck, 91 unit tests, 239 e2e tests in 32 files.
- Conflicts resolved: both #26 and #27 added affine BGs to `gba/ppu.ts` (kept #26's, which reads the registers per
  line); the two top bar window modules became `gba/topBarWindow.ts`; the two soft resets became BootScene's
  `softReset`, which now replaces the Overworld scene instance (Phaser reuses a stopped scene with its fields; the
  clear save data screen's reset kept the old field state before) and boots to the title screen.
- Flaky tests fixed on the way (tests/README.md rule 6 added):
  - titleScreen.test.ts watched the intro's few-frame scenes from Node; the title screen now reports a
    `titleScene` event per SetTitleScreenScene, and the A that skips the intro is pressed in the page.
  - pcBoxes / mainPathLeftovers (Lugia) / scriptedBattles (Mewtwo) answered "Give a nickname...?" with one B after
    30 frames, which could land mid-text (only speeding it up) and leave the YES/NO to the A mashing: they mash B.
  - battleAnimHelpers `expectMovesRun`: a move that can miss (SING, DISABLE, THUNDER, WILL_O_WISP, ...) played no
    anim when the roll missed; a miss now uses the move again, reseeding with another seed each time (the same seed
    rolled the same miss).

### docs/WORKFLOW.md: the coordinator / worker / merger procedure

- New docs/WORKFLOW.md writes down how batches have been run: planning (checking each item against the decomp
  and the port, one owner per shared building block), worktree setup with cloned node_modules and public/gen, the
  worker prompt template, the worker rules (moved here from MAIN_PATH_PLAN.md), and the merger's extras (the merge
  diff check, stacked PRs after a squash, flaky tests are races to fix, the docs-only PRs for plan and STATUS).
- From batch 3's lessons: duplicated building blocks (affine BGs, top bar window, SoftReset), workers dismissing
  flakes as load, a stacked branch in the same worktree, the ~10-minute full suite.
- CLAUDE.md and STATUS.md point to it.
- `/get-on` (`.claude/skills/get-on/SKILL.md`, WORKFLOW.md section 0): the user's session as main coordinator,
  one background sub-coordinator per batch (plan, workers, merge, docs), workers under it. Agents can start agents
  (checked: a subagent's subagent ran).
- Long workers (batch 3's W-fly: ~60 minutes, ~700k tokens): the plan splits workstreams into ~1-hour units, a
  worker does one unit and hands back, continuation workers carry the branch on; the coordinator runs a watchdog
  (a background timer, then a "Checkpoint" SendMessage to a worker past 60 minutes or 45 minutes without a commit).
  Worker rules for keeping the context small.

### Rods and the Escape Rope (W-fielditems unit 1, `fielditems-1`)

- Fishing (world/fishing.ts): FieldUseFunc_Rod / CanFish / ItemUseOnFieldCB_Rod, StartFishing / Task_Fishing with
  Fishing1..16 and AlignFishingAnimationFrames, QL_GfxTransition_Fish's graphics swap; DoesCurrentMapHaveFishingMons,
  ChooseWildMonIndex_Fishing, GenerateFishingEncounter, FishingWildEncounter in world/WildEncounters.ts. Found on the
  way: FRLG's Task_Fishing has no "Oh! A bite!" and no A-press window (Fishing7 goes straight to "A POKéMON's on the
  hook!", so Fishing8/9/13 and "It got away" can't be reached); the planning notes had the R/S/Emerald flow.
- Escape Rope: ItemUseOutOfBattle_EscapeRope / ItemUseOnFieldCB_EscapeRope on top of Dig's escape
  (Task_UseDigEscapeRopeOnField, now exported from world/fieldMoves.ts). The message holds the field controls (the
  GBA's start menu lock). The field message box now goes away when a warp loads the next map.
- Shared pieces: `SpriteAnim` (sprite.c's anim state) split out of FieldEffectSprite; the extractor writes every
  object event anim table (`objectEventAnims` in field_effects/objects.json); MessageBox `open` / `print` for
  window 0 prints at an x and speed; world/fieldItems.ts (the item uses' field host); `ItemId_GetSecondaryId`
  resolves the named secondary ids items.json keeps (OLD_ROD...); the player's fishing graphics are preloaded.
- Fixes on the way: menus/itemUse.ts importing field (Phaser) modules broke the battle unit tests that load it, so
  the field functions are registered at boot (`registerItemUseFieldFuncs`, like the party menu's field moves);
  RemoveUsedItem after the bag had closed threw on the freed bag display (the GBA writes through NULL there), so
  Pocket_CalculateNItemsAndMaxShowed / PocketCalculateInitialCursorPosAndItemsAbove skip the display when it's gone.
- Verified: typecheck; unit tests (tests/unit/fishing.test.ts: the slot thresholds per rod against the
  ENCOUNTER_CHANCE_FISHING_MONS_* values, Pallet Town's old and super rod mons); e2e tests/e2e/fieldItems.test.ts
  (Old Rod with a seeded bite → a wild Magikarp, Good Rod with no bite → "Not even a nibble…" and the controls
  back, a rod facing land refused in the bag, the Escape Rope from Mt. Moon to Route 4, refused on Route 1), plus
  playerAvatar / surf / wildBattle / fieldMoves / fieldEffects / fly e2e; screenshots of the cast facing down from
  the bank and left/right while surfing.
### Pokédex screen: data, top menu, numerical lists (W-dex unit 1, SCREENS_PLAN.md batch 1)

- Extractor: `tools/extract_pokedex.py` → public/gen/pokedex.json (gPokedexEntries' category names, FireRed
  descriptions, heights, weights, scales and offsets; gPokedexOrder_*; gDexCategories; gMonFootprintTable).
  extract_gfx.py takes `graphics/pokedex/` and the footprints: a gbagfx-style 1bpp conversion (greyscale PNGs are
  inverted, so the black footprint pixels are set bits; bit 0 is the leftmost pixel). include/pokedex_screen.h's
  DEX_CATEGORY_* / DEX_ORDER_* are in the defines.
- `menus/pokedex.ts`: pokedex.c (GetSetPokedexFlag, GetKanto/NationalPokedexCount, HasAllKantoMons, HasAllMons,
  GetPokedexHeightWeight), DexScreen_GetSetPokedexFlag, NationalPokedexNumToSpecies.
- `menus/pokedexScreen.ts`: CB2_OpenPokedexFromStartMenu, DexScreen_LoadResources, DoClosePokedex /
  CB2_ClosePokedex, Task_PokedexScreen (the mode list with its icons and locked habitats greyed out, the seen /
  owned counts, Kanto and national layouts), Task_DexScreen_NumericalOrder, DexScreen_CountMonsInOrderedList (all
  orders), DexScreen_InitListMenuForOrderedList / _DestroyDexOrderListMenu, ItemPrintFunc_OrderedListMenu (number,
  caught ball, type icons), the scroll arrows, the print helpers, DexScreen_IsCategoryUnlocked. Not yet (stubs):
  the mon page, the search lists, the habitat pages.
- Start menu: POKéDEX opens it (OverworldScene `openFieldMenu('pokedex')`, FieldMenuScene 'pokedex'), counts
  GAME_STAT_CHECKED_POKEDEX, and StartMenuPokedexSanityCheck keeps the menu open while nothing's been seen.
- Found on the way: the field's DISPCNT (OBJ on, 1D mapping) isn't on the GBA layer, so the screen's scroll arrows
  didn't show until FieldMenuScene set it. tests/e2e/fly.test.ts's `useTownMap` pressed RIGHT 60 frames after A on
  BAG, which could land before the bag was up (seen once under load): it waits for CB2_BagMenuRun first.
- Verified: typecheck; unit tests (tests/unit/pokedex.test.ts: the JSON, the footprint bits, the counts and the
  anticheat); e2e tests/e2e/pokedex.test.ts (open from START, counts, scrolling the Kanto list incl. paging,
  the list's remembered row, the national layout and list, closing back to the start menu and the field, the
  sanity check), plus saveContinue, fly, listMenuFlash. Screenshots of the top menu and lists match FRLG's layout.
### TM case (SCREENS_PLAN.md batch 1, W-tmcase unit 1)

- `menus/tmCase.ts` ports tm_case.c: InitTMCase for TMCASE_FIELD (the bag's KEY ITEMS → TM CASE → OPEN:
  FieldUseFunc_TmCase / InitTMCaseFromBag), TMCASE_GIVE_PARTY (GoToTMCase_Give), TMCASE_GIVE_PC (GoToTMCase_PCBox),
  TMCASE_SELL (GoToTMCase_Sell) and TMCASE_REOPENING (CB2_ReturnToTMCaseMenu, which used to fall back to the bag).
  The list (SortPocketAndPlaceHMsFirst, "No01 MOVE", ×quantity or the HM tile), the description and move info
  windows, the disc sprite tinted by type sliding in and out of the case (SpriteCB_SwapDisc), USE / GIVE / EXIT
  (USE → the party menu's ItemUseCB_TMHM; GIVE → CB2_ChooseMonToGiveItem), the sell flow (how many, the money box,
  YES/NO, "Oh no, I can't buy that" for HMs). The Pokédude demo and the Union Room menu are left out.
- Graphics: `graphics/tm_case/` added to extract_gfx.py's prefixes (gTMCase_*, gTMCaseDisc*, gTMCaseHM_Gfx);
  `menuGfxSymbols` preloads them for every GBA menu host.
- Fix found on the way: FRLG's ClearTextSpan (text_printer.c) is empty, but the port's TextPrinter filled the span
  for CLEAR / CLEAR_TO / MIN_LETTER_SPACING with the background colour. That erased the TM case's HM tile under an
  HM's `{CLEAR_TO 18}`; now it only moves the cursor, like the GBA.
- No list_menu.c cursor objects needed (the TM case uses cursorKind 0, the printed arrow).
- Verified: tests/e2e/tmCase.test.ts (from the bag: HM01 → USE teaches CHARMANDER CUT and comes back to the TM case,
  PIDGEY can't learn it, TM28 → GIVE; at the Pewter Mart: SELL → TM case, an HM it won't buy, two TM28s sold for
  half price), screenshots of the list, context menu and quantity box; the bag / mart / PC / evolution e2e files
  (pokemart, pcStorage, evolution, listMenuFlash, saveContinue) and the unit tests still pass.
### Pokédex area data and markers (W-dexarea unit 1, batch 1 of SCREENS_PLAN.md)

- `menus/wildPokemonArea.ts`: wild_pokemon_area.c (GetSpeciesPokedexAreaMarkers, GetRoamerIndex /
  GetRoamerPokedexAreaMarkers, IsSpeciesOnMap, IsSpeciesInEncounterTable, GetMapSecIdFromWildMonHeader,
  FindDexAreaByMapSec), plus GetStarterSpecies and roamer.c's GetRoamerLocationMapSectionId (an unset roamer
  location is map 0/0, as after a reboot on the GBA). IsSpeciesOnMap's fishing search reads 12 slots of a 10-slot
  table in the C; the extra two are never a species, so the port searches the table's own length (same result).
- `menus/pokedexArea.ts`: pokedex_area_markers.c (CreatePokedexAreaMarkers, Task_ShowAreaMarkers,
  DestroyPokedexAreaMarkers, GetAreaMarkerSubsprite, GetNumPokedexAreaMarkers). There's no blink: the task only
  makes the sprite visible on its first run.
- GetUnlockedSeviiAreas (field_specials.c) in `world/regionMap.ts` rather than menus/regionMap.ts, so the marker
  code stays loadable in the Node unit tests (menus/regionMap.ts pulls in Phaser through world/fly.ts).
- Extractor: menus.json `pokedexArea` (`pokedex_area_data` in extract_menus.py); `graphics/pokedex/` in
  extract_gfx.py (pokedex_screen.c's INCBINs and the markers). Fixed on the way: extract_gfx.py's make-variable
  parsing kept only a variable's first word and didn't expand nested `$(VAR)`s, so `cat` rules over a variable list
  (POKEDEXAREAMARKERFILES → marker.4bpp) produced nothing; no existing symbol changed. Rerun `npm run extract`.
- Shared: OverworldScene (`initWildPokemonArea` at init), menus/data.ts (`pokedexArea` type), world/regionMap.ts.
- Tests: tests/unit/pokedexArea.test.ts (9: Pidgey on 13 Kanto routes and the Sevii areas as islands unlock,
  Magikarp by rod only, no areas, Slugma only once One Island is unlocked, Altering Cave's sets, the roamer at its
  location / the unpaired roamers / inactive, the markers' OBJ-window OAM). typecheck, `npm test` (100) and
  mapNamePopup e2e pass. The e2e (tests/e2e/pokedexArea.test.ts) comes with the area page in unit 2.

### Berry pouch (SCREENS_PLAN.md batch 1, W-tmcase unit 2)

- `menus/berryPouch.ts` ports berry_pouch.c: InitBerryPouch for BERRYPOUCH_FROMFIELD (the bag's KEY ITEMS → BERRY
  POUCH → OPEN: FieldUseFunc_BerryPouch / InitBerryPouchFromBag), BERRYPOUCH_FROMBATTLE (the battle bag's OPEN:
  BattleUseFunc_BerryPouch / InitBerryPouchFromBattle), BERRYPOUCH_FROMPARTYGIVE / FROMPOKEMONSTORAGEPC /
  FROMMARTSELL (GoToBerryPouch_Give / _PCBox / _Sell, which logged "not implemented") and BERRYPOUCH_NA
  (CB2_ReturnToBerryPouchMenu, which fell back to the bag). The list ("No01 CHERI BERRY ×n", CLOSE), the item icon
  and description, the pouch sprite's wobble, the context menus (USE / GIVE / TOSS / EXIT; USE / TOSS / EXIT in
  battle), the toss flow (how many, YES/NO, "Threw away"), the sell flow (how many, the money box, YES/NO).
- Berry use goes through the existing item_use.c functions with the pouch's task: SetUpItemUseCallback,
  ItemUse_SwitchToPartyMenuInBattle and FieldUseFunc_OakStopsYou now hand back to the pouch instead of logging.
- Graphics: `graphics/berry_pouch/` in extract_gfx.py (gBerryPouch*); `menuGfxSymbols` preloads them, which covers
  BattleScene's preload too. `CreateBerryPouchItemIcon` added to menus/itemMenuIcons.ts.
- Verified: tests/e2e/berryPouch.test.ts (from the bag: an Oran Berry restores 10 HP and comes back to the pouch,
  GIVE from the pouch's menu, tossing two Cheri Berries; a Razz Berry's "This isn't the time to use that!"; the party
  menu's ITEM → GIVE and the PC's MOVE ITEMS → GIVE through the pouch; selling three Oran Berries at the Pewter Mart;
  the battle bag's OPEN → USE an Oran Berry on the battler), screenshots of the list, context menu, toss and sell
  boxes; tmCase, pokemart, pcStorage, wildBattle, evolution, listMenuFlash e2e files and the unit tests still pass.
### Pokédex mon page and search lists (W-dex unit 2, SCREENS_PLAN.md batch 1)

- `menus/pokedexScreen.ts`: Task_DexScreen_ShowMonPage (A on a seen mon in a numerical list; up/down to the
  previous / next seen mon through DexScreen_TryScrollMonsVertical; B back to the list on that mon; START = cry,
  silent), DexScreen_DrawMonDexPage (the zoom frame at full size, the front pic, No. and name, category, HT / WT in
  feet and pounds as the C converts them, the footprint and the flavour text; "???????????" / ??'??" / ????.? and
  no footprint or text until caught), RemoveDexPageWindows, DexScreen_DexPageZoomEffectFrame (exported for the
  category pages), Task_DexScreen_CharacteristicOrder + DexScreen_CreateCharacteristicListMenu (the top menu's
  SEARCH entries; Task_PokedexScreen state 8), DexScreen_LookUpCategoryBySpecies. States 7-12 of the mon page (the
  area page) are ported around two placeholders; A on the mon page and A on a search list (which the C sends to
  the habitat page, not the mon page) are STUBs for W-dexarea unit 2 and W-dex unit 3.
- The category follows REVISION 0: it's cut at the first space, so a caught Squirtle (TINY TURTLE) prints
  "TINY POKéMON", like FireRed 1.0.
- Mon graphics load on demand (`DexScreen_LoadMonGfx`): the pic, palettes and footprint of the mon being shown;
  started when A / up / down picks it and awaited in the page's draw state.
- `gba/sound.ts`: PlayCry_NormalNoDucking (a no-op like the other cries).
- Verified: typecheck; unit tests; tests/e2e/pokedex.test.ts (new: Bulbasaur's page with its strings, pic and
  footprint, Squirtle seen-only with the unknown fields, up/down skipping unseen numbers and stopping at the last
  seen mon, B back to the list on the mon shown last; A TO Z and LIGHTEST orders, back to the top menu), run
  twice. Screenshots of the mon page (caught and seen-only) and the LIGHTEST list match FRLG's layout.

### Pokédex habitat pages and registering a catch (W-dex unit 3, SCREENS_PLAN.md batch 1)

- `menus/pokedexScreen.ts`: Task_DexScreen_CategorySubmenu (the habitat pages: from the top menu's habitats,
  Task_PokedexScreen case 6 → 7, and from A on a search list, Task_DexScreen_CharacteristicOrder case 6 → 7 with
  parentOfCategoryMenu = 1), DexScreen_CreateCategoryListGfx, DexScreen_DrawMonPicInCategoryPage,
  DexScreen_DestroyCategoryPageMonIconAndInfoWindows, DexScreen_PrintCategoryPageNumbers,
  DexScreen_CreateCategoryPageSelectionCursor (the selected slot's pulsing frame), DexScreen_UpdateCategoryPageCursorObject,
  DexPage_TileBuffer_*, DexScreen_TurnCategoryPage_BgEffect, DexScreen_FlipCategoryPageInDirection (incl. the
  non-BUGFIX step 7 at the end of a right flip), DexScreen_CreateCategoryMenuScrollArrows,
  DexScreen_InputHandler_GetShoulderInput (L / R only with BUTTON MODE LR, R + left/right with L=A, nothing with
  HELP, the default), the unlock rules (CreateCategoryPageSpeciesList, GetPageLimitsForCategory,
  PageNumberToRenderablePages), the habitat's mon page (zoom in / out from the selected box) and its area-page
  states around the existing placeholders. DexScreen_RegisterMonToPokedex,
  Task_DexScreen_RegisterNonKantoMonBeforeNationalDex, Task_DexScreen_RegisterMonToPokedex.
- `battle/bsCommands4.ts`: Cmd_displaydexinfo ported (it used to skip): the white fade, the registered page, then
  VRAM cleared, the battle BGs and textbox reloaded, the caught mon's pic and the fade in before "Give a nickname
  to...?". `scenes/BattleScene.ts` preloads the Pokédex data and the registered page's graphics
  (`dexRegisterGfxSymbols`) for a wild battle's species that aren't caught yet.
- `gba/listMenu.ts`: list_menu.c's cursor objects: ListMenuAddCursorObject and menu_indicators.c's
  ListMenuAddCursorObjectInternal / ListMenuUpdateCursorObject / ListMenuRemoveCursorObject (the red outline built
  from 8x8 subsprites with s8 offsets, and the swaying red arrow); list menus with cursorKind 2 / 3 now draw and
  remove them instead of warning.
- Habitat pages and the registered page wait for their mons' graphics (`DexScreen_LoadCategoryPageGfx`) before
  drawing a page or starting a flip.
- Probe: `__test.pokedex().categoryPage`; `ready` covers the habitat page (5), its mon page (17) and the registered
  page (11); `monPage` is reported for any task with the page's windows up.
- Verified: typecheck; `npm test` (131); tests/e2e/pokedex.test.ts (8, new: Forest's pages with left/right flips
  past the locked Hoenn pages, L / R with BUTTON MODE LR, A zooms into Butterfree's page and B back, B back to the
  top menu; A TO Z's A on Butterfree opens Forest's page on it and B returns to the list; a Master Ball catch of
  Pidgey shows Forest's page 5 [Pidgey, Pidgeotto] and Pidgey's page, then A → the nickname prompt with the
  battle redrawn); wildBattle, scriptedBattles, pcBoxes, mainPathLeftovers' Lugia (non-Kanto before the National
  Dex) and battleAnims' old man tutorial pass. Screenshots of the habitat page, the registered page and the battle
  after it look like FRLG's.
### VS Seeker (W-fielditems unit 2, SCREENS_PLAN.md batch 1)

- `world/vsSeeker.ts` (new): vs_seeker.c's Task_VsSeeker_0..3 (the charge check and its three messages,
  GatherNearbyTrainerInfo, CanUseVsSeeker, GetVsSeekerResponseInArea with the trainers' "!" / "X" / "!!" movement
  scripts and the 30% refusal roll, GetCurVsSeekerResponse, StartAllRespondantIdleMovements), FLDEFF_USE_VS_SEEKER
  (field_effect.c's UseVsSeekerEffect_1..4) with StartPlayerAvatarVsSeekerAnim / GetPlayerAvatarVsSeekerGfxId (on
  foot and on the bike), ClearRematchStateByTrainerId, ResetMovementOfRematchableTrainers and
  EventScript_VsSeekerChargingDone's specials (VsSeekerFreezeObjectsAfterChargeComplete,
  VsSeekerResetObjectMovementAfterChargeComplete).
- `world/rematches.ts` (new, no Phaser): the sRematches lookups (GetRematchIdx, LookupVsSeekerOpponentInArray,
  GetNextAvailableRematchTrainer, GetRematchTrainerId with TryGetRematchTrainerIdGivenGameState's tiers,
  ShouldTryRematchBattle, HasRematchTrainerAlreadyBeenFought, IsTrainerReadyForRematch),
  GetRandomFaceDirectionMovementType and GetRunningBehaviorFromGraphicsId. ScriptEngine's trainer specials and
  `trainerbattle_rematch` use them (its own copy of GetRematchTrainerId is gone).
- `entities/NpcBrain.ts`: MOVEMENT_TYPE_RAISE_HAND_AND_STOP / _JUMP / _SWIM with their movement actions
  (ANIM_RAISE_HAND's frame 9, the jump's 3 px * sin hops, the swimmer's sway); `movementType` and
  `singleMovementActive` for the VS Seeker.
- `menus/itemUse.ts`: FieldUseFunc_VsSeeker (routes, towns and cities, not the four forest routes);
  `registerItemUseFieldFuncs` now merges partial registrations. `script/specials.ts`: `registerSpecials` for
  specials whose modules import Phaser (the first try imported world/vsSeeker.ts from specials.ts and ScriptEngine,
  which pulled Phaser into the battle unit tests through pokedexScreen.ts → specials.ts; the battle-end hook is now
  `ScriptHost.clearRematchStateByTrainerId`).
- OverworldScene: preloads both VS Seeker graphics, sets the VS Seeker host, ResetMovementOfRematchableTrainers
  after mapResetTrainerRematches, the `vsSeeker` probe and more fields on `__test.objects()`.
- Found on the way: the VS Seeker's task must run before FLDEFF_USE_VS_SEEKER's each frame (the effect's task has
  priority 0xFF), or Task_VsSeeker_2 sees the effect end in the same frame (a frame early) and a seeded roll misses.
  The start menu remembers its cursor and the bag its pocket, so a second use from a test skips the DOWN / RIGHT.
- Verified: typecheck; `npm test` (137, incl. tests/unit/rematches.test.ts: Ben's, Calvin's and Franklin's rows,
  the tier fallbacks, the specials); e2e tests/e2e/vsSeeker.test.ts (new, 3 tests, run three times: beat Ben by
  sight, use it charged at (17, 6): the VS Seeker graphics and anim, "!!" on Ben and "!" on Colton and Janice, Ben
  stepping in place and jumping with his hand up, `trainerRematches[9]` = 1, talk → TRAINER_YOUNGSTER_BEN_2, then
  the post-battle line; uncharged in Pallet Town after 3 steps → "… battery: 97", then charged with no trainers →
  "turned off"; 100 charging steps → EventScript_VsSeekerChargingDone, Ben looks around again and talking gives the
  post-battle line), fieldItems.test.ts, trainerBattle.test.ts, field.test.ts. Snapshots of the anim (the player
  holding the VS Seeker) and of Ben mid-jump with his hand up looked right.
### Pokédex area page (W-dexarea unit 2, SCREENS_PLAN.md batch 1)

- `menus/pokedexArea.ts`: pokedex_screen.c's DexScreen_DrawMonAreaPage (the frame on BG3 / BG0, the Kanto map and
  the unlocked Sevii islands' map windows with kantoMapVoff, the icon, number and name, "SIZE" / "AREA", the type
  icons and the size comparison for caught mons: the mon's and the player's pics in sPalette_Silhouette with affine
  matrices scaled by pokemonScale / trainerScale and the y2 offsets, the markers, "AREA UNKNOWN" over the wide
  ellipse, the control bar) and DexScreen_DestroyAreaScreenResources. Wired into Task_DexScreen_ShowMonPage: A on
  the mon page → the area page; B back to the mon page, A back to the list (the placeholders are gone).
- `gba/listMenu.ts`: ListMenu_LoadMonIconPalette / ListMenu_DrawMonIconGraphics. `menus/hallOfFame.ts` exports
  PlayerGenderToFrontTrainerPicId. Graphics: `pokedexAreaGfxSymbols()` joins `pokedexScreenGfxSymbols()`, the mon's
  icon joins `dexMonGfxSymbols` (loaded with the mon page). Probe `__test.pokedexArea()`.
- Fixed on the way: tools/extract_gfx.py didn't invert greyscale PNGs for 4bpp / 8bpp tiles like gbagfx does
  (ConvertToTiles4Bpp's invertColors when the PNG has no palette), so their colour indices were 15 - the real ones.
  "AREA UNKNOWN"'s ellipse had an orange box round it; it also fixes the title screen's border BG (the teal band was
  grey), the TM case's disc (its background was index 15, not transparent), the battle transitions' grid square
  and mugshot banner, and a few unused symbols. Rerun `npm run extract`.
- Verified: typecheck; unit tests (131); tests/e2e/pokedexArea.test.ts (new: Bulbasaur caught with AREA UNKNOWN,
  its types and both silhouettes at 356 / 256 with y2 16 / -2; B back to the mon page; Pidgey's 13 markers and
  scale 492; Rattata seen-only with markers but no types or silhouettes; A back to the list; with Three and Five
  Island unlocked Pidgey's 16 markers and the map at the top), plus pokedex, tmCase, titleScreen and the
  transitions test's every-transition case (for the extractor fix). Screenshots of the area page (caught, seen-only,
  area unknown, with islands) match FRLG's layout.
### Itemfinder (W-fielditems unit 3, SCREENS_PLAN.md batch 1)

- `world/itemfinderSearch.ts` (new, no Phaser): itemfinder.c's HiddenItemIsWithinRangeOfPlayer (the current map's
  hidden items within 7 across and 5 up / down; underfoot items only from on top), FindHiddenItemsInConnectedMaps /
  HiddenItemInConnectedMapAtPos / HiddenItemAtPos with fieldmap.c's GetMapConnectionAtPos and IsPosInConnectingMap,
  RegisterHiddenItemRelativeCoordsIfCloser, SetNormalHiddenItem / SetUnderfootHiddenItem's ding counts and
  GetPlayerDirectionTowardsHiddenItem, in the C's MAP_OFFSET coordinates.
- `world/itemfinder.ts` (new): ItemUseOnFieldCB_Itemfinder, Task_ItemfinderResponseSoundsAndAnims /
  Task_ItemfinderUnderfootSoundsAndAnims, the messages ("‥ ‥ ‥ ‥Nope! There's no response.", "Huh? The
  ITEMFINDER's responding!", "Oh! The ITEMFINDER's shaking wildly!") and clean-ups, Task_ItemfinderUnderfootDigUpItem
  → EventScript_ItemfinderDigUpUnderfootItem, and the arrow / star sprites (CreateArrowSprite, CreateStarSprite,
  SpriteCallback_Arrow / _Star, the four rotations) as screen-fixed FieldEffectSprites. FRLG's Itemfinder doesn't
  turn the player (only Emerald's does), so neither does the port.
- `menus/itemUse.ts`: ItemUseOutOfBattle_Itemfinder, `ItemUseFieldFuncs.ItemUseOnFieldCB_Itemfinder` (registered by
  `registerItemfinder()` from OverworldScene.create; `fieldFuncs()` checks it too). The bag no longer logs "not
  implemented" for the Itemfinder.
- `tools/extract_gfx.py`: `graphics/itemfinder/` (sArrowAndStarSpriteTiles), drawn in gObjectEventPal_Player.
  `world/hallOfFameRecord.ts` exports `canvasTexture` / `drawFrames` for it.
- OverworldScene: the Itemfinder host (current map, loaded neighbours' headers, player position), its graphics
  preloaded, the `itemfinder` probe; events `itemfinder`, `itemfinderArrow`, `itemfinderStar`, `itemfinderEnd`.
- DEVIATIONS: the item-use entry's duplicated "not implemented" lists (left by union merges) are one list again,
  without the items that are in now (rods, Escape Rope, VS Seeker, Itemfinder, TM case, berry pouch).
- Verified: typecheck; `npm test` (148, incl. tests/unit/itemfinder.test.ts: Route 3's Oran Berry at 2 / 6 tiles
  and the edges of the box, standing on it, its flag set; Route 12's underfoot Leftovers; Route 12's Rare Candy from
  Route 13 through the connection; the tie-breaks; the directions); e2e tests/e2e/itemfinder.test.ts (new, 4 tests,
  run three times: Route 3 from (24, 9): 4 arrows (anims 0-3) moving right from (120, 76) to x 133, two out at a
  time, "responding", the player still facing up; picking the berry up, then "no response"; Cape Brink's underfoot
  PP Max: 3 stars rising from y 75 to 60, "shaking wildly", the item dug up and its flag set, then no response;
  Pallet Town: no response; Route 13 (62, 1): Route 12's Rare Candy, 2 arrows moving up), fieldItems, vsSeeker,
  field and hallOfFame e2e files. Screenshots of the arrows (left, right, up) and the star around the player
  looked right.
### SCREENS_PLAN.md batch 1 merged (PRs #30-#40)

- Plan: SCREENS_PLAN.md (#30). Merged, one PR per unit: #31 Pokédex area data and markers, #32 TM case, #33
  Pokédex data / top menu / numerical lists, #34 rods and Escape Rope, #35 berry pouch, #36 Pokédex mon page and
  search lists, #37 Pokédex area page, #38 VS Seeker, #39 Pokédex habitat pages and registering a catch, #40
  Itemfinder.
- Found while planning: the TM case was a main-path blocker (HMs couldn't be taught without it); fixed by #32.
- Conflicts: only comment / prefix lines in tools/extract_gfx.py and the item-use header comment in
  menus/itemUse.ts (both sides kept). #39 merged after #37 removed the area-page placeholders, so the habitat
  pages' area states now call menus/pokedexArea.ts; the union-merged Pokédex entries in DEV_NOTES / DEVIATIONS were
  tidied into one each.
- Races fixed in the merge runs (each passed when rerun alone, then fixed): playerAvatar's boulder test held UP
  after the boulder fell, so the player walked into the hole to B1F and saw its twin boulder (hold / watch / release
  in one eval); mapNamePopup's 100-frame wait started where a batch of ticks ended (counted inside the `until`
  predicate now; tests/README.md names the pattern); vsSeeker / fieldItems / itemfinder opened the bag with a fixed
  60-frame wait while its graphics load asynchronously (wait for CB2_BagMenuRun, then the fade). W-dex unit 1 also
  fixed fly.test.ts's `useTownMap` the same way.
- Verified: typecheck, unit tests and the full e2e suite on each PR after merging master in; the final run is in
  this PR: on master after #40, typecheck, 148 unit tests and 269 e2e tests (39 files) pass.

### Registered SELECT items (W-select unit 1, SCREENS_PLAN.md batch 2)

- `menus/registeredItem.ts` (new): UseRegisteredKeyItemOnField (item_menu.c): DismissMapNamePopup,
  LockPlayerFieldControls, FreezeObjectEvents, HandleEnforcedLookDirectionOnPlayerStopMoving, StopPlayerAvatar,
  the item's field func as a GBA task with data[3] = 1 (stepped by a field task), the registration cleared when the
  item is gone, EventScript_BagItemCanBeRegistered when nothing is registered.
- OverworldScene: FieldGetPlayerInput reads SELECT (pressedSelectButton) and ProcessPlayerFieldInput ends with
  `if (pressedSelectButton && UseRegisteredKeyItemOnField())`, as in field_control_avatar.c.
- `menus/itemUse.ts`: the data[3] == 1 branches: SetUpItemUseOnFieldCallback's direct sItemUseOnFieldCB call,
  DisplayItemMessageOnField + Task_ItemUse_CloseMessageBoxAndReturnToField, DisplayItemMessageInCurrentContext /
  PrintNotTheTimeToUseThat on the field (FONT_MALE for Oak), and the items: Bicycle (incl. "You can't dismount your
  BIKE here."; ItemUseOnFieldCB_Bicycle now unfreezes / unlocks / destroys its task like the C), the rods, the VS
  Seeker, the Itemfinder, Coin Case, Powder Jar, Poké Flute. The Town Map, TM case and berry pouch from SELECT log
  and give the controls back (unit 2 ports them).
- `world/fieldItems.ts`: DisplayItemMessageOnField takes a font; the host dismisses the map name popup;
  ClearDialogWindowAndFrame / DismissMapNamePopup / UnlockPlayerFieldControls / ScriptContext_SetupScript are
  registered for itemUse.ts (registerFieldItems). `text/MessageBox.ts`: `show` takes an optional font.
- Fixes on the way: the field never set the strings.c table itself (setTextStrings), so the field items' gText_*
  only worked after the bag had been opened once; OverworldScene.create sets it now. Script `release` /
  `releaseall` didn't unfreeze objects (ClearPlayerHeldMovementAndUnfreezeObjectEvents); now they do. A frozen
  field (a rod's bite into a battle, a map load) is unfrozen when the map is resumed or loaded.
- Probes: `field().locked`, `field().objectsFrozen`, `__test.gbaTasks()`, `__test.paletteFadeActive()`.
- Verified: typecheck; `npm test` (148); e2e tests/e2e/registeredItems.test.ts (new, 6 tests: registering the
  Bicycle through the bag's REGISTER and SELECT on / off with a step each way; Cycling Road's "can't dismount";
  the Old Rod facing away (Oak's message) and facing the water (cast, no bite, put away, a step); the Coin Case's
  "Your COINS: 123" with the controls locked and objects frozen until it closes; the VS Seeker / Itemfinder / Poké
  Flute messages; nothing registered and a registered item no longer in the bag), plus fieldItems, vsSeeker,
  itemfinder, tmCase, berryPouch, fieldMoves, strength, surf, playerAvatar, mapNamePopup and field. Screenshots of
  Oak's message and the Coin Case's in the field message box looked right.
### Script coverage check and e2e bag / party waits (W-story unit 1)

- `tests/unit/scriptCoverage.test.ts`: every script command, special / specialvar, std script, movement action and
  scripted `dofieldeffect` the decomp's scripts use, checked against the port's own tables (ScriptEngine's command
  table, SPECIALS + TRAINER_SPECIALS + `registerSpecials` blocks read from the source, MovementRunner's dispatch on
  a stub object, `registerFieldEffectNatives` blocks). Known gaps in `tests/unit/scriptCoverageGaps.ts` (184:
  17 main, 68 side, 55 postgame, 44 link), each with the maps that reach it (a reachability walk from every map's
  scripts). The rough check's false positives (ShowTrainerIntroSpeech, SetUpTrainerMovement: trainer specials in
  ScriptEngine; VsSeekerFreezeObjectsAfterChargeComplete: registered by world/vsSeeker.ts) aren't gaps.
- Extractor: scripts.json gets `macros` (event.inc + trainer_tower.inc, movement.inc, map.inc macro names) so the
  test tells commands from movement actions and map data. ScriptEngine exports TRAINER_SPECIALS and has a
  `commandNames` getter.
- Found on the main path: `call_if_defeated` / `call_if_not_defeated` aren't commands in the port, so Rocket
  Hideout B4F's barrier to Giovanni never opens (BLOCKER); SetVermilionTrashCans (BLOCKER for Lt. Surge's gym).
  SetSeenMon, which the plan had as main, is only used by optional scripts (side). Two decomp lines have no comma
  between macro arguments, which GAS accepts and the extractor's split_args doesn't: `call_if_not_defeated
  TRAINER_TEAM_ROCKET_GRUNT_12 RocketHideout_B1F_...` and `case 1 EventScript_PkmnCenterNurse_Goodbye` (NO at a
  Pokémon Center nurse skips the goodbye). Left for W-story unit 2.
- e2e: `game.waitForBag()` / `waitForPartyMenu()` / `waitForScreen(cb2)` in harness.ts wait for the screen's main
  callback and the end of its palette fade (new probe `t.paletteFadeActive()`), replacing fixed `waitFrames(60)` /
  CB2-then-30/40-frame waits in 19 files (local `waitForBag` copies in berryPouch / tmCase removed). Waits that
  give a refusal time to show with the menu already up (fieldItems, fieldMoves, surf, strength, fly,
  playerAvatar), the PC / shop field menus and saveContinue's clock window stay fixed.
- Races fixed on the way (each failed once with three other workers running, load average ~150, and passed on a
  rerun): `t.until` resolved with `pred()` evaluated again after the frame's batch of ticks, so a short-lived state
  could be gone (surf's jump watcher got undefined); it now returns the result from the tick it held in. The
  tap-turn test and surf's `watchAction` read the field inside the predicate; playerAvatar's boulder test holds UP
  with the new `t.holdWhile` (released any later, the player walked on into the hole to B1F again).
- Not fixed, failed once under that load and passed on reruns: fieldEffects.test.ts "water and flower tiles
  animate" (same tile bytes 40 frames apart) and "leaving a house, the player walks out of the opening door" (the
  600-frame `until` for the hidden arrival ran out).
- Verified: typecheck; `npm test` (16 files, 152 tests); e2e, a few files at a time: every file whose waits
  changed (battleAnims, berryPouch, evolution, fieldItems, fieldMoves, fly, itemfinder, mainPathLeftovers, pcBoxes,
  pcStorage, playerAvatar, pokedex, saveContinue, scriptedBattles, strength, surf, tmCase, vsSeeker, wildBattle)
  and, after the `until` change, every file that uses it (also fieldEffects, mapNamePopup, pokedexArea, hallOfFame,
  titleScreen, pokemart, transitions).
### Option menu and start menu help window (W-options, SCREENS_PLAN.md batch 2)

- option_menu.c as `menus/optionMenu.ts` on the GBA layer: CB2_OptionsMenuFromStartMenu → CB2_OptionMenu's load
  states (BGs 0-2, the windows, sOptionMenuPalette, the header's std frame and the settings' user frame) →
  Task_OptionMenu (fade in, OptionMenu_ProcessInput with key repeat, the frame's tiles and palette reloaded as it
  changes, the selected row as WIN0 outside the BLDY lightening, fade out) → CloseAndSaveOptionMenu. START → OPTION
  opens it (OverworldScene's start menu dispatch, FieldMenuScene 'options') and it returns to the start menu
  (CB2_ReturnToFieldWithOpenMenu). The strings, sOptionMenuPalette and the help window graphics were already
  extracted (no extractor change).
- `optionsSound` in GameState and the save (SAVE_VERSION 3; `upgradeSave` gives version 2 saves MONO).
  `battle/battleBg.ts` reads the frame type from the state instead of frame 1.
- Field windows that use the user frame now follow the FRAME option: the start menu and its Safari stats window
  pass it, and `MenuWindow`'s default frame comes from `setUserFrameTypeSource` (the YES/NO box, the mon pic box);
  before, they always drew TYPE 1.
- help_message.c as `ui/HelpMessageWindow.ts` (a Phaser window over the field like the start menu) and
  start_menu.c's sStartMenuDescPointers in `ui/StartMenu.ts`: the description on open and on cursor moves, gone on
  close, only in the HELP button mode.
- Fixed on the way: `TextWindow.drawGlyph` wrote colour 0 (TEXT_COLOR_TRANSPARENT) background pixels over the
  window; GLYPH_COPY skips them, so text with a transparent background now prints over what's there (the help bar).
- Verified: typecheck; `npm test` (149, incl. the save round-trip with the sound option and a version 2 save
  loading as MONO); e2e tests/e2e/options.test.ts (new, 2 tests: text speed FAST → MID and FRAME wrapping 1 → 10 →
  1 → 2, cursor wrapping, back to the start menu on OPTION, reopened with both kept, saved in the slot; the help
  text on open and after UP / DOWN (incl. the wrap to EXIT), gone after B, and gone after BUTTON MODE → LR, also on
  cursor moves and a fresh START), plus saveContinue, pokedex, field, mapNamePopup, titleScreen, trainerBattle,
  wildBattle, fieldItems, fly and evolution. Screenshots of the option menu and of the help bar under the start menu
  looked right.

### Trainer card front (W-tcard unit 1, SCREENS_PLAN.md batch 2)

- `menus/trainerCard.ts`: trainer_card.c for the player's FRLG card: ShowPlayerTrainerCard,
  TrainerCard_GenerateCardForLinkPlayer / SetPlayerCardData (stars, money, Pokédex count, play time, Hall of Fame
  debut, stickers and mon icon vars for the back), CB2_InitTrainerCard (ResetGpuRegs, SetUpTrainerCardTask,
  InitBgsAndWindows, LoadCardGfx, LoadStickerGfx, HandleGpuRegs, SetTrainerCardBgsAndPals), Task_TrainerCard's front
  states (PrintAllOnCardFront, the trainer pic, DrawCardScreenBackground / DrawCardFrontOrBack,
  DrawStarsAndBadgesOnCard, the fade in, the play time's blinking colon, B → CloseTrainerCard). A on the front is a
  stub for unit 2 (the back and the flip).
- Start menu: PLAYER opens it (OverworldScene `openFieldMenu('trainerCard')`, FieldMenuScene 'trainerCard') and it
  comes back to the start menu on PLAYER.
- menus/picSprites.ts: CreateTrainerCardTrainerPicSprite (CreateTrainerCardSprite, LoadPicPaletteBySlot) and
  PlayerGenderToFrontTrainerPicId, moved there from menus/hallOfFame.ts (which re-exports it); battle/transition.ts
  imports it instead of keeping its own copy.
- Extractor: graphics/trainer_card/ in extract_gfx.py (rerun `npm run extract`). trainer_card.c's `sUnused_Pal`
  shares its name with pokemon_storage_system_tasks.c's; the extractor keeps the first (unused by the port either way).
- Found on the way: the VBlank after CloseTrainerCard still runs VBlankCB_TrainerCard (the C reads the freed
  struct there), so BlinkTimeColon checks for a null pointer.
- Verified: typecheck; `npm test` (150, incl. tests/unit/trainerCard.test.ts: no stars, the Hall of Fame star only
  with GAME_STAT_ENTERED_HOF, HasAllKantoMons, HasAllMons, the 999:59:59 cap); e2e tests/e2e/trainerCard.test.ts
  (new, 2 tests: a boy's card with money, Pokédex, three badges and one star on the green card, the colon blinking, A
  staying on the front, B back to the start menu on PLAYER; a girl's blue card with the female background, no
  badges / stars / Pokédex line), plus hallOfFame, pokedexArea and transitions' "every battle transition" (the
  mugshots use PlayerGenderToFrontTrainerPicId). Screenshots of both cards match FRLG's layout.

### Trainer card back and flip (W-tcard unit 2, SCREENS_PLAN.md batch 2)

- `menus/trainerCard.ts`: the card back (BufferTextForCardBack and its Buffer* functions, PrintAllOnCardBack: the
  name, the Hall of Fame debut, the link battle / trade / Berry Crush / Union Room lines, which FRLG prints only when
  not 0, so never for the port's player; DrawCardBackStats; PrintPokemonIconsOnCard / LoadMonIconGfx with the photo's
  tints; PrintStickersOnCard), the flip (FlipTrainerCard, Task_DoCardFlipTask and its six steps, UpdateCardFlipRegs,
  VBlankCB_TrainerCard's buffer copy) and Task_TrainerCard states 11-13. As in the C, A on the front flips to the
  back, B on the back flips back and A on the back closes the card (B on the front closes it).
  MailSpeciesToIconSpecies is ported for the photo vars (Unown is stored as 30000 + its letter);
  trainerCardGfxSymbols preloads the photo's icons.
- HBlankCB_TrainerCard's per-line BG0VOFS goes through gba/hw.ts `hblankRegs` (an HBlank DMA table on
  gScanlineEffectRegBuffers[1]) rather than SetHBlankCallback: the PPU does run HBlank callbacks, but only for the
  frames the host draws, so with several ticks per drawn frame the register could be left at a mid-flip offset when
  the flip ends.
- gba/palette.ts: TintPalette_CustomTone (moved from menus/regionMap.ts, which imports it now) and
  TintPalette_SepiaTone.
- Verified: typecheck; `npm test` (150); e2e tests/e2e/trainerCard.test.ts (3 tests: the boy's card flips to the
  back (name, Hall of Fame debut 12:34:56, no link / trade lines, no icons or stickers), back to the front (badges,
  stars, pic), to the back again and A closes it; each flip watched in the page: steps 1/2/4, the card closing to
  77, BLDY up to 11 and back to 0, BG0VOFS offsets per line, nothing left per line afterwards; the girl's card; a
  photo in sepia (Pikachu, Bulbasaur, Unown C in slot 4) and two stickers on the back), fly.test.ts (the region
  map's tint). Screenshots of the back, the photo back and mid-flip frames look like FRLG's.
