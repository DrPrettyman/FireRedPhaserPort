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

### Registered items: the Town Map, TM case and berry pouch from the field (W-select unit 2, SCREENS_PLAN.md batch 2)

- `menus/itemUse.ts`: the SELECT branches of FieldUseFunc_TownMap / _TmCase / _BerryPouch (were
  `RegisteredItemFromFieldNotPorted`, removed): FadeScreen(FADE_TO_BLACK, 0), then Task_UseTownMapFromField /
  Task_InitTMCaseFromField / Task_InitBerryPouchFromField wait for the fade, SetFieldCallback2ForItemUse and open
  the screen with CB2_ReturnToField (InitTMCase(..., TRUE) / InitBerryPouch(..., 1): SELECT closes them).
  FieldCB2_UseItemFromField + Task_ItemUseWaitForFade: freeze and lock while the field fades in, then release.
  StopPokemonLeagueLightingEffectTask is skipped (no league lighting in the port).
- Field side: `world/fieldItems.ts` FadeScreen / IsFieldPaletteFadeActive / OpenScreenFromField (FieldItemsHost,
  registered with the other item field funcs in world/fishing.ts); OverworldScene.openItemScreenFromField
  (CleanupOverworldWindowsAndTilemaps, prepareFieldMoveMenu, FieldMenuScene `itemFromField` with the screen's init
  and graphics). The start menu's RunFieldCallback code moved into `OverworldScene.runFieldCallback`, shared by both.
- The C's return path from a TM taught / a berry used in a screen opened from the field is the same as from the bag
  (the party menu reopens the TM case / pouch, which keeps its CB2_ReturnToField exit); checked for the TM case.
- Verified: typecheck; `npm test` (155); e2e registeredItems (9, 3 new: the Town Map opened on Pallet Town and B
  back to the field; the TM case with HM01 taught and back to it, SELECT closes it; the berry pouch and B; each
  checks the bag never shows, the objects frozen / controls locked on return, then released, and a step works; run
  3 times), tmCase, berryPouch, fly, fieldItems, trainerCard (33 in all). Screenshots of the three screens opened
  from the field match the bag's.

### Story checks Brock to Lt. Surge (W-story unit 2)

- `tests/e2e/story.test.ts` (new, 7 tests): Lt. Surge's gym (the trash can puzzle: first switch, a wrong second
  can resets the locks and picks new cans, both switches open the beam; then Surge, FLAG_BADGE03_GET, TM34); Misty
  (her gym walked, the trainers spot the player and are fought, then Misty, FLAG_BADGE02_GET, TM03,
  `set_gym_trainers 2`); Bill's Sea Cottage (Bill the Clefairy into the teleporter, the PC's cell separator, Bill
  out, the S.S. Ticket); the S.S. Anne (Vermilion's ticket check, aboard, the rival on 2F, the captain's HM01, out
  again: SSAnne_Exterior_ExitSSAnne and back on the pier with VAR_MAP_SCENE_VERMILION_CITY 3); Cut on the tree in
  front of Vermilion Gym and in through the door; face_original_direction (Pewter's Nidoran); the Pokémon Center
  nurse (heal machine sprites, bow, the party healed, GAME_STAT_USED_POKECENTER).
- Ported: `special SetVermilionTrashCans` (field_specials.c; the gym's BLOCKER), AnimateTeleporterHousing /
  AnimateTeleporterCable (special_field_anim.c), SetWalkingIntoSignVars, and the nurse's pieces:
  FLDEFF_POKECENTER_HEAL (FldEff_PokecenterHeal in `world/hallOfFameRecord.ts`, sharing the Hall of Fame record's
  glow; the monitor is sPokecenterMonitor_Gfx on the glow's palette), `nurse_joy_bow` (sAnim_NurseBow),
  `incrementgamestat`, IsPlayerNotInTrainerTowerLobby, BufferUnionRoomPlayerName (no wireless: 0),
  SetUsedPkmnCenterQuestLogEvent (no-op). `movement face_original_direction`: gInitialMovementTypeFacingDirections is
  extracted (`constants.json` `initialMovementTypeFacing`), NpcBrain sets `ObjectEvent.originalFacing` from the
  movement type. The new story specials live in `script/storySpecials.ts` (STORY_SPECIALS, spread into SPECIALS).
- Found on the way: every Pokémon Center nurse threw `Unknown constant FALSE | (TRUE << 1)` at her YES/NO
  (`multichoice ..., FALSE | (TRUE << 1)`): script arguments can be constant expressions, which GAS folds.
  `Defines.get` now folds them (names and numbers, + - * / % << >> & | ^ ~ and parentheses; tests/unit/defines.test.ts);
  that also fixes `(MAX_COINS + 1) - 20` in the Game Corner and `(NUM_TRAINER_FAN_CLUB_MEMBERS - 1)`.
- Gap list: 11 entries off (main: 6 left: call_if_defeated / call_if_not_defeated for unit 3,
  DoSSAnneDepartureCutscene, DoPokemonLeagueLightingEffect, GetStarterSpecies, Script_TryGainNewFanFromCounter).
  The S.S. Anne's departure isn't ported (needs graphics/ss_anne/ extracted and the boat's sprite offset); it's
  visual only, the story goes on (DEVIATIONS).
- A race in the test's own warp helper: walking onto Vermilion Gym's door, the field looked idle during the door
  warp, so the helper pushed as for stairs (`t.enterWarp()`), whose final wait has no frame limit and hung. It now
  pushes only after the player has stood still on the old map for 30 frames.
- Verified: typecheck; `npm test` (18 files, 156 tests); e2e story.test.ts (7, twice in a row) plus hallOfFame,
  field, fieldMoves, vsSeeker, trainerBattle, newGame.

### Story checks Erika to Sabrina (W-story unit 3)

- Extractor: `split_args` splits macro arguments like gas (macro.c's get_any_string ends an argument at a blank
  between two operands; the scrubber keeps blanks only between symbol characters), so the two decomp lines without
  a comma now extract as three arguments: Rocket Hideout B1F's `call_if_not_defeated TRAINER_TEAM_ROCKET_GRUNT_12
  RocketHideout_B1F_EventScript_SetBarrier` and the nurse's `case 1 EventScript_PkmnCenterNurse_Goodbye` (NO at a
  Pokémon Center nurse now says goodbye instead of ending on a missing label). Expressions (`(MAX_COINS + 1) - 500`,
  `A | B`, battle script flags) stay one argument. Checked by diffing the whole of public/gen before and after: only
  those two instructions in scripts.json changed.
- ScriptEngine: `call_if_defeated` / `call_if_not_defeated` (event.inc: checktrainerflag + call_if TRUE / FALSE).
  Rocket Hideout B4F's barrier to Giovanni opens once both door grunts are beaten (was a BLOCKER), and B1F's OnLoad
  barrier is set until grunt 12 is beaten. Both gap entries removed.
- Fixed on the way: `special GetQuestLogState` returned 0 instead of writing VAR_RESULT (quest_log.c sets
  gSpecialVar_Result; `special` drops return values), so EventScript_DoNoIntroTrainerBattle read a stale VAR_RESULT
  and, when it was 2, went to EventScript_EndQuestLogBattle: no battle, the script ended and talking again restarted
  it. Hit by Giovanni in Rocket Hideout B4F after the two grunt battles (a BLOCKER); any `trainerbattle_no_intro`
  could hit it (every rival battle after Oak's lab, Blaine, the Elite Four, Silph Co.'s Giovanni, Mt. Moon's
  Miguel), depending on what VAR_RESULT last held.
- e2e `tests/e2e/storyCeladonSaffron.test.ts` (new, 10 tests): Erika (Cut tree, badge, TM19); the Game Corner grunt,
  poster switch and stair warp to the hideout; B1F's barrier with and without grunt 12; the hideout lift B1F → B4F;
  B4F's door grunts, the barrier, Giovanni and the Silph Scope, and the barrier staying open on reload; Mr. Fuji's
  warp home and the Poké Flute; the Tea, the Route 5 gate guard turning the player back without it and letting
  them through with it; Silph Co. 7F's rival trigger battle; 11F's Giovanni and the president's Master Ball;
  Saffron Gym's teleport pads to Sabrina, the badge and TM04. Nothing else on this stretch blocked.
- Verified: typecheck; `npm test` (17 files, 155 tests, incl. the coverage test); e2e storyCeladonSaffron (10,
  twice), field, trainerBattle, mainPathLeftovers, pokemonTower, scriptedBattles (24).

### Four e2e races fixed (W-flaky, SCREENS_PLAN.md batch 2)

Each failed once with other workers' e2e runs on the machine and passed alone; tests only, no game changes.
- battleAnims.3e3a "Baton Pass": read `spriteInvisible` from Node after the `battleAnimEnd` poll, by when the party
  screen (openpartyscreen, right after waitanimation) could have replaced the battle sprites (it read false). Now an
  in-page `t.until` started before the move reads it in the tick after the anim ends.
- mainPathLeftovers "Field_AskSaveTheGame: YES": `mashUntil(battle mode menu opened)` then `press('A')` for SINGLE
  BATTLE. The battle mode menu has no sDelay and takes input in the tick it opens (as on the GBA: the multichoice
  task runs in the frame the script creates it), and the mash's last A landed on that tick in 7 of 9 traced runs,
  so the mash picked SINGLE BATTLE itself and the extra A went to the save prompt: harmless while it was still
  printing, YES once under load it came after the YES/NO was up. Now it mashes A until the save window is up.
- fieldEffects "water and flower tiles animate": the two tile reads were separate evals 40 ticks apart plus the
  round trip; at 80 ticks (a whole 5-frame flower cycle) or 128 (the 8-frame water cycle) they matched. Now both
  reads are in one `until` predicate, exactly 40 ticks apart.
- fieldEffects "leaving a house": the 600-tick limits for the hidden arrival and the door ran out. The game keeps
  ticking while the next map loads: ~185 ticks to the arrival on an idle machine, 1,221 under load (reproduced with
  six CPU hogs and two other e2e files). Limits raised to 20000.
- Same kinds fixed in transitions.test.ts (not seen failing): the Mt. Moon exit's fade-in watcher had a 600-tick
  limit across Route 4's load, started only after a Node poll saw the flash, and read `fadeWhite` in a later eval;
  the walk into Mt. Moon read `fadeWhite` after its `until` resolved, with a 120-tick limit across the map load that
  comes before the fade out. Both now start before the warp, read the colour in the predicate, limit 20000.
- tests/README.md "Writing a new scenario": comparing two reads n ticks apart and reading inside the predicate
  (5), a mash press picking from a menu in the tick it opens (6), tick limits across loads (7).
- Verified: typecheck; `npm test` (17 files, 155 tests); e2e battleAnims.3e3a, mainPathLeftovers, fieldEffects and
  transitions (30 tests) three times, once under load (load average ~170).

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

### Four more e2e races fixed (W-flaky 2, SCREENS_PLAN.md batch 2)

Each failed once in a merge run at load average ~276 and passed alone. No game changes; one test hook event.
- battleAnims "the Silph Scope unveils the ghost Marowak" (`expected 'MAROWAK' to be 'GHOST'`): the name was read
  from Node after `mashUntil(General_SilphScoped started)`; AnimTask_TransformMon(255) renames the mon ~50 ticks into
  the anim, and under load the read came after. The mash's predicate now returns the name, read in the tick after
  the anim starts.
- battleAnims "Reflect" (timed out waiting for the foe drawn on a BG): `waitFor(spriteInvisible)` polled from Node
  while the foe is on the anim BG only as long as the wall is up. Now `game.watch` (new in harness.ts: an in-page
  `until` started before the move, awaited after) reads it tick by tick.
- battleAnims.3e2 "Attract, Soft-Boiled, Sweet Kiss and Lovely Kiss" (no Move_SWEET_KISS anim: it missed):
  VBlankCB_Battle calls Random() every tick (as in the C), and `useMoveSlot` / `useFirstMove` seeded in one eval
  and pressed the move in the next, so the rolls were as many calls apart as ticks ran between the two round trips:
  none on an idle machine, dozens under load. Measured: seeding at the action menu and reading Random() 0, 10 and
  60 ticks later gave three different values; a stack trace showed VBlankCB_Battle as the only caller. New
  `pressSeeded` (battleAnimHelpers.ts) seeds and queues the press in one eval, so the press is sampled in the tick
  right after the seed, as it was on an idle machine; the substitute test uses it too.
- mapNamePopup "crossing into another map section" (`expected undefined to be 24`): the counting `until` had a
  900-tick limit that spans Route 1's load (over 1,000 ticks under load), so it ran out before the popup was up.
  Limit 20000.
- Same kinds fixed in these files (not seen failing): Node polls of short-lived anim state moved to `game.watch`
  started before the move: Tackle's hit splat, the ball's open burst, the old man's ball in flight, the shiny
  sparkles, the Safari bait, Transform's full mosaic, Surf's wave blend; battleAnims.3e2's Sketch HBlank scroll (600
  Node round trips, now one in-page `until`). mapNamePopup: the popup after a load (~150 ticks) was polled from Node
  right after the `ready` poll; the hooks now log each printed name as a `mapNamePopupText` event (testHooks.ts
  onTick), and the tests wait for that. "field input ... dismisses the popup" waited for the load's popup fully shown
  from Node (120 ticks), then pressed START: it now crosses into Route 1 and does the wait, START and the count to
  the popup being gone (still at most 4 ticks after the start menu opens) in one eval.
- tests/README.md "Writing a new scenario": `game.watch`, the popup event, `pressSeeded` and the per-tick battle RNG
  (5), returning the value from a `mashUntil` predicate.
- Verified: typecheck; `npm test` (17 files, 155 tests); e2e battleAnims, battleAnims.3e2 and mapNamePopup (35
  tests) four times: twice alone, once with 8 CPU hogs and two other e2e files (load ~106), once with 16 hogs and
  four other e2e files (load up to ~314); the other battleAnims files that use the changed helpers (2a, 2b, 2c, 2d,
  3e1, 3e3a, 3e3b: 67 tests) once.

### Story checks Koga to the Hall of Fame (W-story unit 4)

- e2e `tests/e2e/storyLeague.test.ts` (new, 8 tests): Fuchsia Gym (Koga behind the invisible walls, the badge,
  TM06); the Safari Zone (the gate's ¥500 entry and 30 balls, the Gold Teeth, the Secret House's HM03, the Warden's
  HM04 for the teeth); Cinnabar (the gym door's locked trigger, Pokémon Mansion B1F's secret switch opening the way
  to the Secret Key, CheckUnlockGym, in through the door); Cinnabar Gym (quiz 1 answered wrong → Burglar Quinn's
  battle → the door opens; Blaine, TM38); Viridian Gym (the locked doors with six badges, TryUnlockGym with seven, a
  spinner tile carrying the player to its stop tile, Giovanni, TM26, VAR_MAP_SCENE_ROUTE22 3); Route 22's late
  rival; Route 23's badge guards (the gate's Boulder Badge, the Cascade Badge guard turning the player back without
  it and letting them on with it); the Elite Four rooms one after another (the walk in, the entry closing, each
  member, the door opening, Lance's corridor) and the Champion's room through Oak to the warp into the Hall of Fame.
  Nothing on this stretch blocked.
- Ported: `special GetStarterSpecies` (Oak's congratulations named species 0 without it; `GetStarterSpecies` in
  world/roamer.ts, which GetRoamerSpecies now uses too). `special Script_TryGainNewFanFromCounter` is a no-op like
  Script_UpdateTrainerFanClubGameClear (no Trainer Fan Club state). Both gap entries removed; main gaps left:
  DoPokemonLeagueLightingEffect (visual: needs a runtime BG palette swap; DEVIATIONS) and DoSSAnneDepartureCutscene.
- Audit of specials whose C sets gSpecialVar_Result (directly or two calls deep, incl. their tasks / callbacks):
  every one the port implements writes VAR_RESULT itself (RockSmashWildEncounter, TryFieldPoisonWhiteOut,
  CreatePCMenu, StartMarowakBattle, ListMenu, GetQuestLogState, HasEnoughMonsForDoubleBattle). The others
  (size records, daycare level menu, Seagallop menu, IsSelectedMonEgg, GetNumMovesSelectedMonHas, the link / tower
  ones) aren't ported yet; they're on the gap list.
- Found on the way (test only): mashing A until the field is free after a battle restarted the leader's
  post-battle script when a press landed in the first free tick (Bruno's looped). The file's `scriptDone` presses B.
- Verified: typecheck; `npm test` (156); e2e storyLeague (8, twice), story, storyCeladonSaffron, hallOfFame.

### SCREENS_PLAN.md batch 2 merged (PRs #42-#53)

- Merged one PR per unit as each went green: #42 (plan), #43 / #47 trainer card front, then back and flip; #44
  option menu and start menu help window; #45 / #49 registered SELECT items, then the Town Map / TM case / berry
  pouch from the field; #46 script coverage test and e2e bag/party waits; #51 / #50 / #52 story checks Brock to
  Lt. Surge, Erika to Sabrina, Koga to the Hall of Fame; #48 / #53 e2e race fixes.
- Conflict resolutions: #44 vs #43 in FieldMenuScene / OverworldScene (both added a start menu entry, a menu
  mode and an import: kept both); #51 vs #50 in `tests/unit/scriptCoverageGaps.ts` (each removed different
  entries: kept both removals).
- Duplicated building block: #45's `__test.gbaFading()` and #46's `__test.paletteFadeActive()` were the same probe;
  kept `paletteFadeActive`, moved registeredItems.test.ts and the docs onto it (also dropped a duplicate import).
- Races found in merge runs (load averages 150-300 while workers tested): Cut's field-move pose read from node
  after the banner (fixed in #47: read in the mash predicate); the rest went to the W-flaky workers (#48, #53).
- Verified: each PR after merging master in: typecheck, `npm test`, full e2e. Last run (#53 on top of everything):
  typecheck clean, 156 unit, 308 e2e in 45 files.

### Workflow: branch cleanup checks, worker count and e2e scope are the coordinator's call

- Batches 1-2 of SCREENS_PLAN.md left 15 merged branches on origin while reporting "all branches cleaned up".
  Cause: `gh pr merge --delete-branch` run while a worktree had the branch checked out fails to delete the local
  branch and then skips the remote one. The main coordinator found them with `git ls-remote --heads origin`,
  checked each against its merged PR's head and deleted them.
- docs/WORKFLOW.md section 4: "Cleaning up a merged PR" (explicit worktree / local / remote deletes, then
  `ls-remote` must print nothing) and an end-of-batch check whose output goes in the report. Section 1: the number
  of workers (at most four) is the coordinator's estimate from the work and the machine load. Section 4: which e2e
  files each merge runs is the merger's call; the full suite runs at least once at the end. Section 3: workers
  don't edit `.git/info/exclude` (a worker had added a line there; removed).
- CLAUDE.md "Merging PRs" points at both; the get-on skill's main coordinator now checks the cleanup itself.
- Verified: docs only.

### In-game trades without the animation, and the Name Rater (W-trade unit 1)

- Data: `tools/extract_trades.py` (called from extract.py's main) writes sInGameTrades (src/data/ingame_trades.h,
  FireRed side of its `#if` blocks via `firered_only`) to `public/gen/trades.json`; `Assets.init` loads it and
  OverworldScene hands it to `initInGameTrades`.
- `script/tradeSpecials.ts` (TRADE_SPECIALS, one spread line in SPECIALS): GetInGameTradeSpeciesInfo,
  GetTradeSpecies, CreateInGameTradePokemon (CreateInGameTradePokemonInternal: the player's mon's level, the fixed
  personality / OT id / IVs / ability / held item, OT name and gender, nickname, METLOC_IN_GAME_TRADE; CreateMon
  still rolls the random IVs first, as on the GBA), TradeMons (friendship 70), UpdatePokedexForReceivedMon,
  BufferInGameTradeMonName, and DoInGameTradeScene as a stand-in (fade to black, swap, fade in, the script's
  `waitstate` ends). The Name Rater: IsMonOTIDNotPlayers (a `special` that writes VAR_RESULT itself),
  IsMonOTNameNotPlayers, NameRaterWasNicknameChanged. All seven came off scriptCoverageGaps.ts.
- Not modelled (DEVIATIONS): the trade animation (unit 2), contest conditions and sheen, the Jynx's mail message.
- Verified: typecheck, `npm test` (unit: tests/unit/inGameTrades.test.ts checks the extracted table, the created
  Mr. Mime's fields and stats worked out by hand, the swap behind the fade, the Name Rater specials),
  tests/e2e/inGameTrades.test.ts (Reyley's trade, declining, the wrong species and a cancelled party menu; the
  Name Rater declining, renaming and refusing a traded mon).

### Party selection from scripts, the move tutors and the move deleter (W-moves unit 1)

- `menus/partyMenuSpecials.ts`: party_menu_specials.c (ChoosePartyMon, ChooseMonForMoveRelearner's party menu
  half, Task_ChoosePartyMon, SelectMoveDeleterMove, GetNumMovesSelectedMonHas, BufferMoveDeleterNicknameAndMove,
  MoveDeleterForgetMove with ShiftMoveSlot / RemoveMonPPBonus, IsSelectedMonEgg) and the ChooseMonForMoveTutor
  special, spread into SPECIALS; eight entries off `scriptCoverageGaps.ts`.
- New `ScriptHost.runScreenFromScript(init)` (OverworldScene): a special's SetMainCallback2 to a GBA-layer screen,
  back through RunFieldCallback; `SpecialEnv.stopScript(wait)` for a special that leaves the field without a
  `waitstate` after it (SelectMoveDeleterMove).
- Fix on the way: ChoosePartyMonByMenuType didn't set gFieldCallback2 = CB2_FadeFromPartyMenu.
- The party menu's tutor path (TryTutorSelectedMon, the replace-a-move summary) was already ported and worked
  as is. The C's B value in VAR_0x8004 is SLOT_CANCEL (PARTY_SIZE + 1); FireRed has no PARTY_NOTHING_CHOSEN.
- Verified: typecheck, `npm test` (161), tests/e2e/moveTutors.test.ts (5: Mega Punch with a free slot and with
  four moves, B in the tutor's party menu, deleting GROWL from the middle of four moves with PP Ups shifted, B out
  of the deleter's party menu and summary screen), tests/e2e/tmCase.test.ts; screenshots of the field after both.

### The in-game trade scene (W-trade unit 2)

- `menus/tradeScene.ts`: trade_scene.c's in-game path: CB2_InitInGameTrade (TradeAnimInit_LoadGfx, LoadTradeMonPic,
  LoadTradeGbaSpriteGfx, TradeBufferOTnameAndNicknames), CB2_InGameTrade / DoTradeAnim, SetTradeSequenceBgGpuRegs
  (incl. the affine BG2 for the zooming GBA, set through BgAffineSet like SetTradeBGAffine), VBlankCB_TradeAnim,
  the sprite templates and callbacks (the bouncing Poké Ball leaving and arriving, the link mon glow and its
  shadow's palette flash, the GBA screen flash), DrawTextOnTradeWindow, Task_AnimateWirelessSignal,
  Task_OpenCenterWhiteColumn / Task_CloseCenterWhiteColumn. `DoInGameTradeScene` (script/tradeSpecials.ts) now
  runs it through `runScreenFromScript`, replacing unit 1's fade stand-in.
- Found on the way: the in-game trade is the *wireless* animation, not the cable one. CB2_InitInGameTrade
  allocates sTradeAnim zeroed and only CB2_LinkTrade sets isCableTrade, so DoTradeAnim always takes
  DoTradeAnim_Wireless here (the plan said cable). The cable path is a link trade's and stays out.
- Graphics: `graphics/trade/` added to extract_gfx.py's GFX_PREFIXES. trade_scene.c's unused sBlackPalette has the
  same name as evolution_scene.c's; the extractor keeps one of them, and both files are identical (black).
- The Poké Ball open particles (battle/anim/special.ts) play their SE through the battle's BattleUi, which isn't set
  on FieldMenuScene: the scene sets a silent one if none is set.
- Verified: typecheck, `npm test` (170; the stand-in's unit test became one for TradeMons + BufferInGameTradeMonName),
  tests/e2e/inGameTrades.test.ts (6): Reyley's trade runs the scene from STATE_START to STATE_WAIT_FADE_OUT_END
  under CB2_InitInGameTrade / CB2_InGameTrade, the swap happens while it's up, eight frames rendered mid-scene
  draw something (the GBA fills the screen when zoomed), ABRA's and MR. MIME's pics are drawn; then back on the
  field. Looked at the eight frames (TRADE_SHOTS) against the C's states.

### The move relearner and the Cape Brink tutor (W-moves unit 2)

- `menus/learnMove.ts`: learn_move.c (TeachMoveRelearnerMove's screen: CB2_MoveRelearner_Init / _Resume, the
  MENU_STATE_* machine, the move list, the type / power / accuracy / PP / description windows, the "Teach X?",
  "give up?", "trying to learn" and "stop learning" YES/NO prompts, forgetting a move through
  ShowSelectMovePokemonSummaryScreen and back) and pokemon.c's GetMoveRelearnerMoves / GetNumberOfRelearnableMoves.
  The scroll arrows' sprites (`graphics/learn_move/`) come through the extractor (GFX_PREFIXES).
- `menus/partyMenuSpecials.ts`: the TeachMoveRelearnerMove special, CapeBrinkGetMoveToTeachLeadPokemon,
  HasLearnedAllMovesFromCapeBrinkTutor (with GetLeadMonIndex); three entries off `scriptCoverageGaps.ts`.
  The party menu's PARTY_MENU_TYPE_MOVE_RELEARNER branch sets VAR_0x8005 (it only warned before).
- `ScriptHost.runScreenFromScript(init, gfxSymbols?)`: the screen's extra graphics are preloaded;
  `__test.moveRelearner()` probe.
- Two Island's Move Maniac asks for a Big Mushroom or two Tiny Mushrooms (FRLG has no Heart Scale).
- Verified: typecheck, `npm test` (163), tests/e2e/moveTutors.test.ts (9, twice: + relearning METAL CLAW with a
  free slot and over GROWL with four moves, B out of the list (NO back to the list, YES back to the party menu),
  the Cape Brink tutor teaching Blast Burn, Frenzy Plant and Hydro Cannon to max-friendship starters until "passed
  on everything"), tests/e2e/tmCase.test.ts, tests/e2e/evolution.test.ts; screenshots of the list, the YES/NO and
  the "1, 2, and... Poof!" after the summary screen.

### Oak's Pokédex rating, the museum's fossil pics, the fossil revival (W-daycare unit 1)

- `script/sideSpecials.ts` (new, spread into SPECIALS): GetProfOaksRatingMessage (prof_pc.c
  GetProfOaksRatingMessageByCount: one message per ten Kanto mons caught, 150 without Mew counts as complete),
  HasAllMons (the existing menus/pokedex.ts port), BackupHelpContext / RestoreHelpContext as no-ops. Oak's rating
  runs end to end in his lab and through PROF. OAK's PC (the national dex part too, with FLAG_OAK_SAW_DEX_COMPLETION);
  `playfanfare` / `waitfanfare` were already no-ops, so nothing hangs without audio.
- `ui/MuseumFossilPic.ts` (new): OpenMuseumFossilPic / CloseMuseumFossilPic / Task_WaitMuseumFossilPic (the
  Kabutops and Aerodactyl fossil pics in PewterCity_Museum_1F); `graphics/script_menu/` added to extract_gfx.py's
  GFX_PREFIXES. OverworldScene preloads and registers it; `__test.museumFossilPic()` probe.
- The Cinnabar lab's fossil revival (CinnabarIsland_PokemonLab_ExperimentRoom) already worked: hand over the Dome
  Fossil, leave for the entrance hall (its ON_TRANSITION sets the revive state to 2), come back, get Kabuto.
- story.test.ts and storyCeladonSaffron.test.ts press B (not A) through the script after a leader battle, as
  storyLeague.test.ts does.
- Six entries off `scriptCoverageGaps.ts`.
- Verified: typecheck; `npm test` (163); e2e sideEvents (7, twice), story + storyCeladonSaffron (17), hallOfFame;
  screenshots of both fossil pics.

### W-slots unit 1: the coins box, the Game Corner's clerks and the slot machine's game logic

- coins.c's coins box (`ui/CoinsBox.ts`): `showcoinsbox` / `updatecoinsbox` / `hidecoinsbox` (ScrCmd_* →
  ShowCoinsWindow / PrintCoinsString / HideCoinsWindow), "COINS" over the 4-digit amount, next to the money box.
- slot_machine.c's game logic as `menus/slotMachineLogic.ts` (no screen): InitSlotMachineState, the reel spin,
  StopReel1/2/3 with TwoReelBiasCheck / OneReelBiasCheck, TestReelIconAttribute, CalcSlotBias, ResetMachineBias,
  CalcPayout, GetPayout. Tables extracted by `tools/extract_slots.py` (new) to `slotMachine.json`.
  GetRandomSlotMachineId (field_specials.c) in `script/gameCornerSpecials.ts`.
- Fix found on the way: the script extractor ran both branches of top-level `.ifdef FIRERED` / `.ifdef LEAFGREEN`
  blocks, so the prize room used LeafGreen's prices and levels (an Abra cost 120 coins, level 7). It now keeps
  only the taken branch of `.ifdef` / `.if` / `#ifdef` blocks (BUILD_SYMBOLS: FIRERED, REVISION 0, no BUGFIX).
  That also fixes Daisy's grooming text (both `#ifdef BUGFIX` branches were concatenated), the help system's
  Pokédex text and the slot machine's smiley-face field effect arguments. Diffed scripts.json / strings.json
  before and after: only those lines changed.
- `TextPrinter.waitingForButton` / `MessageBox.waitingForButton` (getters, for tests): a test waits for a `\p`
  in the page instead of mashing A into the multichoice that follows the message.
- Verified: typecheck; `npm test` (179, incl. the new slotMachine.test.ts: 23 hand-worked cases from the C);
  e2e `tests/e2e/gameCorner.test.ts` (new, 5 tests: buying 50 and 500 coins with the coins box at 7 → 57 → 557
  and the money box; no Coin Case; the prize room's Abra for 180 coins and TM13 for 4000, not enough coins; the
  Fisher's 10 coins and hidden coins; a slot machine without a Coin Case and GetRandomSlotMachineId's spread),
  storyCeladonSaffron's Game Corner test. Screenshot of the coin clerk: money and coins boxes as on the GBA.

### W-slots unit 2: the slot machine screen, the Game Corner's smiley and photo printer

- slot_machine.c's screen as `menus/slotMachine.ts`: PlaySlotMachine / CB2_InitSlotMachine / CB2_RunSlotMachine, the
  main tasks (game loop, no coins, help, confirm exit, no payout, payout, exit), Task_SlotMachine's setup tasks
  (graphics init, fade out, line lights, Clefairy, coins display, out of coins, quit YES/NO, reel buttons, help
  slide), the reel icon sprites with HBlankCB_SlotMachine (OAM matrix 0's PA and BLDY per line), the score digits,
  the two Clefairy, Task_FlashWinningLine. `playslotmachine` (ScrCmd_playslotmachine) runs it from the Game Corner's
  machines through `host.runScreenFromScript` and the script continues once the field is back.
- The Game Corner's other gaps: FLDEFF_SMILEY_FACE_ICON (FldEff_SmileyFaceIcon: the Phaser emote over the player),
  FLDEFF_PHOTO_FLASH (FldEff_PhotoFlash: a fade from white) and special UpdateTrainerCardPhotoIcons (the photo
  printer fills the trainer card's photo vars), in `script/gameCornerSpecials.ts`. The Game Corner has no gaps left
  in scriptCoverageGaps.ts.
- tools/extract_gfx.py: `graphics/slot_machine/` in GFX_PREFIXES; the C files are read in sorted order, and a static
  symbol that two files define (slot_machine.c's and main_menu.c's `sBg_Pal`) is also written as
  `<file stem>.<symbol>`. Diffed gfx/index.json: only the new symbols, and two unused palettes (`sUnusedPal`,
  `sUnused_Pal`) whose plain name now belongs to another file.
- Fixes found on the way: WIN0H is written as the C does (WIN_RANGE(0, 256) is 0x100, X1 > X2, so the window spans
  to 240; masking to (0, 0) hid the combos window); Task_SpinReels no longer touches the freed gfx manager in the
  exit frame (a TypeError). The e2e's own payout table had the top row wrong; the port was right.
- Verified: typecheck; `npm test` (193); e2e `tests/e2e/gameCorner.test.ts` (8 tests, twice: the 5 before, plus the
  slot machine (the smiley; R bets 3; spins until a win and a loss, each checked against the payout worked out from
  the reel table and the coins; START pays at once; DOWN bets one at a time and lights the lines; the help window in
  and out; B on the YES/NO is NO; YES gives the bet back and returns to the field), no coins ("Game over!" and back),
  the photo printer (¥50, PINK, the white flash, Pikachu and an Unown's mail species and the tint in the vars)),
  saveContinue.test.ts and trainerCard.test.ts (the main menu's sBg_Pal, the trainer card). Screenshots of the
  machine, a win (flashing lines and payout lights), the help window and the quit YES/NO compared with the C's
  layout: reels at x 80/120/160, CREDIT / PAYOUT digits at y 30, Clefairy at (16, 136) and (224, 136), the YES/NO at
  tile (19, 9), the message window at (5, 15).

### The Route 5 daycare (W-daycare unit 2)

- `world/daycare.ts` (new): daycare.c's storage. struct DaycareMon / DayCare in GameState (`route5DayCareMon`,
  `daycare`, which takes over `daycareStepCounter` as `daycare.stepCounter`), StorePokemonInDaycare,
  TakeSelectedPokemonFromDaycare, ApplyDaycareExperience, GetLevelAfterDaycareSteps, GetNumLevelsGained*,
  GetDaycareCostForSelectedMon, ShiftDaycareSlots, CountPokemonInDaycare; ShouldEggHatch / TryProduceOrHatchEgg
  moved here from world/stepCounters.ts (which re-exports it) and now count the Route 5 mon's steps (and the Four
  Island mons', for unit 3).
- `script/daycareSpecials.ts` (new, spread into SPECIALS): ChooseSendDaycareMon, GetSelectedMonNicknameAndSpecies,
  PutMonInRoute5Daycare, GetCostToWithdrawRoute5DaycareMon, IsThereMonInRoute5Daycare,
  GetNumLevelsGainedForRoute5DaycareMon, TakePokemonFromRoute5Daycare. SIDE_SPECIALS: IsEnoughForCostInVar0x8005,
  SubtractMoneyFromVar0x8005 (money.c), CalculatePlayerPartyCount (also used by the cable club attendants).
- Fix on the way: partyMenu.ts's ChooseMonForDaycare didn't set gFieldCallback2 = CB2_FadeFromPartyMenu, so the
  field wouldn't have faded back in after the daycare's party menu.
- Save format version 4: `daycare` and `route5DayCareMon` replace `daycareStepCounter`; `upgradeSave` turns a
  version 3 save into one with both daycares empty and the old step counter kept.
- Ten entries off `scriptCoverageGaps.ts`. Route5_PokemonDayCare's script runs end to end.
- Verified: typecheck; `npm test` (205, incl. the new daycare.test.ts and a version 3 save upgrade); e2e
  daycare.test.ts (new, 4 tests: leave a mon, 46 steps "back already" and NO, 92 steps a level for ¥200; eight
  levels with Quick Attack and Hyper Fang learned, not enough money first; a one-mon party refused and B in the
  party menu; save and CONTINUE keeps the mon and its steps), saveContinue, wildBattle; a screenshot of the
  daycare party menu's STORE / SUMMARY / CANCEL.

### Egg hatching (W-daycare unit 4, as W-hatch)

- `menus/eggHatch.ts` (new): daycare.c's EggHatch / Task_EggHatch (the special: fade, then
  `runScreenFromScript`), CB2_EggHatch_0 / CB2_EggHatch_1 with EggHatchCreateMonSprite, SpriteCB_Egg_0..5,
  CreateRandomEggShardSprite / SpriteCB_EggShard (sEggShardVelocities), Task_EggHatchPlayBGM (silent),
  EggHatchPrintMessage, EggHatchSetMonNickname; CreatedHatchedMon / AddHatchedMonToParty (level 5, the egg's
  personality / IVs / moves / markings / Pokérus, friendship 120, species name, Poké Ball, met level 0 at the
  current map section, Pokédex seen + caught, PP restored) and ScriptHatchMon. EGG_HATCH_SPECIALS spread into
  SPECIALS; EggHatch is off scriptCoverageGaps.ts.
- OverworldScene: IncrementGameStat(GAME_STAT_HATCHED_EGGS) before EventScript_EggHatch, as
  TryStartStepCountScript does (game stats are kept now).
- Graphics: the egg sheets and palette were already extracted (graphics/misc/, graphics/pokemon/); the shadow
  (gTradeGba_Gfx, gTradeGba2_Pal, gTradeOrHatchMonShadowTilemap) comes with W-trade's `graphics/trade/` prefix.
- Found on the way: BG palette 15 is the YES/NO's text palette and the scene never loads it (the GBA field leaves
  the message box palette there); without it the YES/NO was a black box. The scene loads it at start. Also, with
  `graphics/trade/` extracted, trade_scene.c's sBlackPalette shadows evolution_scene.c's (both all black, so
  harmless).
- Test hooks: `MonSpec.egg` (an egg with that many cycles left, as CreateEgg makes it), `__test.eggHatch()`.
- Verified: typecheck; `npm test` (209, incl. the new eggHatch.test.ts); e2e eggHatch.test.ts (new, 2 tests: the
  step that hatches the egg, the scene's states / cracks / 19 shards / the mon shown, NO, the hatched mon's level,
  IVs, moves, personality, friendship, met level, the game stat and the Pokédex, back on the field with the script
  done; YES and "AA" through the naming screen) and daycare.test.ts, twice each. Screenshots: the cracked egg, the
  "BULBASAUR hatched from the EGG!" message over the shadow, the YES/NO, the naming screen with the mon icon.

### Side specials: holes, Daisy, the Magikarp record, the diploma, the fan club (W-misc)

- Fall warps: `world/fallWarp.ts` (new) is DoFallWarp (field_fadetransition.c) and FieldCB_FallWarpExit /
  Task_FallWarpFieldEffect (field_effect.c). MB_FALL_WARP tiles were plain warps; now they run SetupWarp, then
  EventScript_DoFallWarp (the player vanishes, waits, then the warp), and the player drops onto the floor below
  with the camera shake. Landing in Seafoam B4F's water starts surfing and VAR_TEMP_1 hands over to the map's
  current script. OverworldScene: `setupWarp` split out of `takeWarp`; FieldMoveHost gains `warpDestination`,
  `setCameraPanning` and an optional warp id on `warpIntoMap`.
- `script/miscSpecials.ts` (new, MISC_SPECIALS): DaisyMassageServices, GetLeadMonFriendship and the massage
  cooldown step counter; CompareMagikarpSize / GetMagikarpSizeRecordInfo (pokemon_size_record.c, inches as the
  English build); SetSeenMon, DoesPlayerPartyContainSpecies, BufferBigGuyOrBigGirlString, HasAllKantoMons,
  ShowDiploma; the Trainer Fan Club's six specials (Script_UpdateTrainerFanClubGameClear and
  Script_TryGainNewFanFromCounter were no-ops). No save format change: all of it lives in vars.
- `menus/diploma.ts` (new): diploma.c, graphics through `graphics/diploma/` in extract_gfx.py.
- 14 specials off scriptCoverageGaps.ts (DoFallWarp, the nine above, the four fan club ones);
  CalculatePlayerPartyCount came with the Route 5 daycare.
- Verified: typecheck; `npm test` (215, incl. the new miscSpecials.test.ts); e2e sideSpecials.test.ts (new, 8
  tests: the Mansion hole with the drop and the shake, the Seafoam B4F current after falling, Daisy's rating and
  grooming, the Magikarp record and a tie, the diploma KANTO / NATIONAL and without a full dex, SetSeenMon), plus
  field, transitions, fieldMoves, strength, playerAvatar, mainPathLeftovers, hallOfFame (all green on the first
  run). A screenshot of the KANTO diploma.


### Eggs and the Four Island daycare (W-daycare unit 3)

- `world/daycare.ts`: the rest of daycare.c but the hatching scene. Egg production in TryProduceOrHatchEgg (the
  GetDaycareCompatibilityScore roll when the second mon's steps reach 0xFF mod 256), _TriggerPendingDaycareEgg /
  _TriggerPendingDaycareMaleEgg, EggGroupsOverlap, SetDaycareCompatibilityString (menus/common.ts's gStringVar4),
  GetEggSpecies, DetermineEggSpeciesAndParentSlots, AlterEggSpeciesWithIncenseItem, SetInitialEggData, InheritIVs
  (with the C's RemoveIVIndexFromList quirk: a stat can be picked twice), GetEggMoves / BuildEggMoveset,
  _GiveEggFromDaycare, RemoveEggFromDayCare / RejectEggFromDayCare, CreateEgg, ScriptGiveEgg; the Four Island
  storage (StoreSelectedPokemonInDaycare, TakePokemonFromDaycare, GetDaycareCost, GetNumLevelsGainedFromDaycare,
  GetDaycareState, GetDaycarePokemonCount, GetDaycareMonNicknames); NameHasGenderSymbol / AppendGenderSymbol.
- `script/daycareSpecials.ts`: the Four Island specials, ShowFieldMessageStringVar4 and
  PlayerPartyContainsSpeciesWithPlayerID. `ui/DaycareLevelMenu.ts` (new): ShowDaycareLevelMenu and its input
  task; FieldListMenu's template takes an `itemPrintFunc`. `giveegg` in ScriptEngine.ts.
- Extractor: `tables.eggMoves` (gEggMoves, flat) and `eggMovesSpeciesOffset` in pokemon/tables.json;
  daycare.c's sJapaneseEggNickname and trade.c's gender symbol strings in strings.json. SpeciesInfo types its
  `eggGroups` (already extracted).
- Fix on the way: `yesnobox` ran the script on in the frame the YES/NO's A press landed, so that press also
  passed a `waitbuttonpress` right after (the "received the EGG" message never showed) or picked a menu's first
  item (the level menu). It now resumes a frame later, as Task_HandleYesNoInput's ScriptContext_Enable does.
- 13 entries off `scriptCoverageGaps.ts`. FourIsland_PokemonDayCare's, FourIsland's daycare man's and the Water
  Labyrinth gentleman's scripts run end to end.
- Verified: typecheck; `npm test` (229, incl. the new eggs.test.ts: 14 tests worked by hand from the C and the
  data: egg species incl. Nidoran / Volbeat / Illumise / Ditto / incense, the compatibility scores and messages,
  InheritIVs with two seeds, egg moves and BuildEggMoveset, the egg roll with seeds, the specials); e2e
  daycare.test.ts (8 tests, 4 new: leave two at Four Island, the compatibility message, walk until an egg, take
  it, refuse the next; take one back through the level menu and then the other; B in the level menu; the Togepi
  egg from `giveegg`), eggHatch, sideSpecials, saveContinue, and for the `yesnobox` change inGameTrades,
  moveTutors, sideEvents, mainPathLeftovers, fieldMoves, gameCorner, newGame (all green).

### SIDE_PLAN.md batch 1 merged (PRs #56-#67)

- Plan: SIDE_PLAN.md (#56). Merged one PR per unit as each went green: #57 ChoosePartyMon, move tutors, move
  deleter; #58 in-game trades behind a fade, the Name Rater; #59 coins box, Game Corner clerks, slot machine logic
  (and the extractor's FIRERED/LEAFGREEN script conditionals); #60 Oak's Pokédex rating, the museum fossil pics,
  the fossil revival check, story tests press B after leader battles; #61 move relearner, Cape Brink tutor; #62
  the in-game trade scene (the wireless animation, which is what in-game trades run); #63 Route 5 daycare (save
  version 4); #64 slot machine screen, smiley, photo printer; #65 egg hatching; #66 holes (DoFallWarp), Daisy,
  the Magikarp record, the diploma, the fan club; #67 eggs, the Four Island daycare, `giveegg`, and `yesnobox`
  resuming a frame after the A press.
- Conflict resolutions: `script/specials.ts` (each workstream's spread line: kept all), `tools/extract_gfx.py`
  GFX_PREFIXES (kept every prefix), `tests/unit/scriptCoverageGaps.ts` (each side removed its own entries: kept
  every removal, i.e. dropped both sides of each conflict block).
- Race found in a merge run: #67's `yesnobox` timing change made gameCorner.test.ts's photo printer test mash its
  last A press into the print type menu the tick it opened (picked NORMAL, every run). Fixed in #67: mash only until
  the YES/NO's money is taken, then wait for the menu.
- Verified: each PR after merging master in: typecheck, `npm test`, its own e2e file plus the files for the shared
  code it touched; the full e2e suite for #66 (warps) and #67 (yesnobox). Last run, on master with everything
  merged: typecheck clean, 229 unit, 356 e2e in 52 files.

### The Seagallop ferry and Bill's trip (W-ferry unit 1)

- `menus/seagallop.ts`: all of seagallop.c. CB2_SetUpSeagallopScene's states, the scrolling water on BG3 (the
  WB/EB tilemaps by sTravelDirectionMatrix), the ferry and wake sprites (SpriteCB_Ferry / SpriteCB_Wake), WIN0's
  letterbox, Task_Seagallop_0-3 and the warp through sSeag; GetSeagallopNumber, IsPlayerLeftOfVermilionSailor.
  Graphics: `graphics/seagallop/` added to extract_gfx.py's GFX_PREFIXES (the INCBIN symbols sWaterTiles etc.).
- `script/ferrySpecials.ts`: the five specials (DoSeagallopFerryScene, GetSeagallopNumber,
  IsPlayerLeftOfVermilionSailor, DrawSeagallopDestinationMenu, GetSelectedSeagallopDestination), off
  `scriptCoverageGaps.ts`. The destination menu is the field's MultichoiceMenu with a fixed layout
  (MultichoiceRequest gets an optional `layout`).
- A screen can now leave through a warp: `fieldReturn.warp(WarpData)` (menus/fieldCallbacks.ts), which
  FieldMenuScene turns into its existing warp exit (OverworldScene.warpFromScreen, as the Hall of Fame does).
- Found on the way: the script engine resumes a script in the tick its wait ends, so the A that picked OTHER on the
  Rainbow Pass menu's first page also picked the second page's first row. In C, ScriptContext_Enable runs the
  script a frame later; DrawSeagallopDestinationMenu's wait now ends the frame after the choice (as `yesnobox`
  does since #67). The `multichoice` command still resumes in the same tick (DEVIATIONS; only the event tickets'
  menus lead into another menu).
- Found on the way: ending the script at DoSeagallopFerryScene (as EnterHallOfFame does) let the field take input
  in the frame's remaining ticks: under load, the e2e's A press talked to the Vermilion sailor the player faced,
  and his script ran on at Two Island. The script now stays stopped in its `waitstate` until the scene warps; the
  e2e checks that what runs on arrival is the destination's own script.
- Verified: typecheck; `npm test` (27 files, 235 tests, incl. tests/unit/seagallop.test.ts: GetSeagallopNumber,
  the direction matrix, both menu pages and the row → destination mapping for every origin, the SEAGALLOP_* ids
  against the extracted defines); e2e `tests/e2e/seagallop.test.ts` (5 tests: Bill's scene after Blaine → YES →
  the Seagallop sails in → the ferry (BG3 scrolling 0x600 a frame for 140 frames, the ferry's x2 3 px a frame,
  flipped eastbound, wakes) → One Island → Celio's Tri-Pass, then VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F = 2
  → the leave scene → the westbound ferry → Cinnabar (21, 7) → Bill's goodbye; declining Bill and the trip from
  the Pokémon Center along FLAG_TEMP_2's path; Vermilion → Two Island with the Tri-Pass and back; cancelling left
  of the sailor walks up the pier, from above him it just ends; the Rainbow Pass menu's two pages to Five Island),
  plus hallOfFame and sideSpecials for the screen-exit change. seagallop.test.ts green 3 runs in a row, two of
  them beside `npm test` loops for load. Screenshots of the scene and both menu pages
  checked by eye.

### The Elite Four and Champion rooms' lighting (SIDE_PLAN.md batch 2, W-league unit 1)

- `world/leagueLighting.ts` is field_specials.c's DoPokemonLeagueLightingEffect, Task_RunPokemonLeagueLightingEffect
  (FLAG_TEMP_2 / FLAG_TEMP_5 / palette fade checks, sEliteFourLightingTimers / sChampionRoomLightingTimers),
  Task_CancelPokemonLeagueLightingEffect (FLAG_TEMP_4, the last palette) and StopPokemonLeagueLightingEffectTask,
  now called from the start menu (`openFieldMenu`: StartMenu_FadeScreenIfLeavingOverworld) and the SELECT Town Map /
  TM case / berry pouch (itemUse.ts FadeToScreenFromField). The QOL note that they skipped it is gone.
- Palettes and timers through the extractor: `public/gen/leagueLighting.json` (tools/extract_field.py
  `extract_league_lighting`, JASC colours like tilesets/palettes.json, so the redraw matches the atlases).
- `tilesetVram.loadBgPalette` / `resetBgPalettes`: a BG palette load redraws only the atlas slots whose metatiles
  use that palette (a palette → slots index next to the tile → slots one); a no-op when the colours don't change.
  The GBA layer's copy of the field (battle transitions) loads the changed slots too.
- Fix found on the way: map loads didn't run MAP_SCRIPT_ON_RESUME (only returns to the field did). On the GBA,
  LoadMapInStepsLocal's ResumeMap and LoadMapFromCameraTransition run it on every load; `onMapLoaded` now does
  (after ON_LOAD, before the objects and ON_WARP_INTO), followed by LoadMapTilesetPalettes' reset. Without it the
  lighting never started on the warp in. The other ON_RESUME scripts are guarded by FLAG_SYS_SPECIAL_WILD_BATTLE,
  are no-ops (InitUnionRoom) or postgame (setstepcallback, Trainer Tower).
- `__test.leagueLighting(colorIndex?)`: the tasks, BG palette 7, a pixel the atlas canvas drew with palette 7.
- Verified: typecheck; `npm test` (229); e2e leagueLighting.test.ts (new, 2 tests: Lorelei's room, 13 palette
  changes each on its timer with the canvas pixel in the new colour, the start menu's BAG stopping the task and the
  return restarting it from palette 0, the last palette after the battle; the Champion's room, 10 changes during the
  rival's intro, the last palette after the battle), field, fieldEffects, transitions, storyLeague (TilesetVram),
  scriptedBattles, playerAvatar, mainPathLeftovers (ON_RESUME on map loads): all green.

### Side leftovers: GetMartClerkObjectId, the `unused` gap tag, a Trainer Fan Club e2e, the egg hook (W-league unit 2)

- `special GetMartClerkObjectId` (field_specials.c sMartMaps, in script/miscSpecials.ts). Its only caller is
  EventScript_Questionnaire, after the Easy Chat screen, so nothing reaches it yet.
- `tests/unit/scriptCoverageGaps.ts`: a new tag, `unused`, for what FRLG shares with Emerald and nothing reaches
  (checked in the decomp: no map or C code calls Std_ObtainDecoration or EventScript_DeepWater /
  EventScript_TrySurface): `adddecoration`, `bufferdecorationname`, FLDEFF_USE_DIVE moved there from `side`.
- tests/e2e/sideSpecials.test.ts: the Trainer Fan Club (SaffronCity_PokemonTrainerFanClub; the plan called it
  Vermilion's, but trainer_fan_club.c is Saffron's): scene 0's crush girl, Script_UpdateTrainerFanClubGameClear
  (scene 1, three fans, the hidden members shown), the way back in (ON_TRANSITION's seats, MeetFirstFans, scene
  2), a fan's and a non-fan's lines.
- The e2e hooks' `egg` MonSpec now comes from world/daycare.ts' `createEgg` instead of being built by hand.
- Race found in my own new test: leagueLighting.test.ts read the restarted task after the start menu's bag with a
  poll, which under load came after its first 40-tick palette; it's watched in the page now.
- Verified: typecheck; `npm test` (230, incl. the clerk table against every mart map's objects); e2e
  sideSpecials (9), daycare, eggHatch, leagueLighting: all green.

### The S.S. Anne's departure and an S.S. Anne sweep (W-ssanne unit 1)

- Ported ss_anne.c as `world/ssAnne.ts`: DoSSAnneDepartureCutscene, Task_SSAnneInit / Run / Finish,
  CreateWakeBehindBoat / WakeSpriteCallback, CreateSmokeSprite / SmokeSpriteCallback, the templates and anims. The
  boat (local id 1) slides left through its sprite's x2, a pixel per 5 frames, until x + x2 < -120; the wake
  (16x32, two frames every 12) follows 80 px behind; a smoke puff (16x16, four frames, ANIMCMD_END) every 70
  frames while the funnel is on screen; 40 frames after the horn, ScriptContext_Enable ends the script's
  `waitstate` and `removeobject` takes the boat. The wake and smoke are FieldEffectSprites at screen coordinates,
  their textures sWakeTiles / sSmokeTiles (graphics/ss_anne/, a new GFX_PREFIXES entry) on gObjectEventPal_SSAnne
  (OBJ palette 10). Probe `__test.ssAnne()` (through OverworldScene.testSSAnne: testHooks can't import a Phaser
  module, unit tests load it), event `ssAnneDeparture`. Off `scriptCoverageGaps.ts`: main has 1 left (the league
  lighting).
- Sweep, checked at runtime against the decomp's scripts: Vermilion's ticket check in both columns (refused
  without the ticket and walked back up the pier, the sailor turning to the player and back; let through with it,
  the other column not checking again, (22/23, 32)'s ExitedTicketCheck resetting the trigger, aboard through the
  arrow warp); every NPC on the 24 S.S. Anne maps with objects (all texts, all 16 trainers fought, the 7 item balls,
  the 2F gentleman's showmonpic scene, the 1F heal lady), the hidden items (B1F corridor Hyper Potion, the kitchen's
  three berries), the captain's office signs; the rival's three triggers on 2F (the side two are new tests); the
  captain's back turned until he's rubbed, HM01, "set sail soon" after; both branches of SSAnne_Exterior_ExitSSAnne
  (from the ship, and walked down the dock when arriving from Vermilion with VAR_MAP_SCENE_VERMILION_CITY 1);
  VAR_MAP_SCENE_VERMILION_CITY 1 → 2 → 3, FLAG_HIDE_SS_ANNE set by `removeobject`; Vermilion afterwards (the
  trigger's "The ship set sail.", the ferry sailor, the old man's OldMan1SSAnneLeft, the pier sailor). No other
  differences from the decomp found. Not reachable in the sweep: the exterior's hidden Lava Cookie at (58, 28)
  (across the water from the dock, as in the decomp) and the deck sailor at (13, 13), who walks back and forth
  without stopping (his movement checked tile by tile; his script is a plain MSGBOX_NPC).
- Verified: typecheck; `npm test` (229); e2e ssAnne.test.ts (10, twice in a row) and story.test.ts (7).

### Easy Chat: the word data and easy_chat.c (W-easychat unit 1)

- Sized the workstream (easy_chat.c 730, easy_chat_2.c 1,363, easy_chat_3.c 2,316 lines): four units, written into
  SIDE_PLAN.md's W-easychat section (this one, easy_chat_2.c as a model, the screen's main layer, choosing words).
- `tools/extract_easy_chat.py` → public/gen/easyChat.json: the 22 groups (word texts as raw decomp strings,
  alphabeticalOrder, enabled; species / move id lists), the 27 alphabetical lists with their `-1, 2` doubled-species
  markers, the group names, sDefaultProfileWords / sDefaultBattleStartWords / sDeoxysValue, gText_ThreeQuestionMarks,
  easy_chat_2.c's sEasyChatScreenTemplates and the two passphrases, the EC_GROUP_* / EASY_CHAT_TYPE_* constants.
- Ported easy_chat.c (menus/easyChatData.ts, menus/easyChat.ts): word text and validity, ConvertEasyChatWordsToString,
  EC_DoesEasyChatStringFitOnLine, unlocked groups and words, GetRandomECPokemon, the trendy sayings
  (additionalPhrases, EnableRareWord, UnlockRandomTrendySaying, GetRandomUnlockedTrendySaying),
  InitEasyChatPhrases / InitQuestionnaireWords (GameState's constructor), the selection lists for the screen.
  Specials ShowEasyChatMessage (off scriptCoverageGaps: side has one Easy Chat gap left, ShowEasyChatScreen) and
  BufferRandomHobbyOrLifestyleString. The trainer card's link-card profile words now come from the save.
- Save version 5: `easyChat` (profile, battle start / won / lost, questionnaire words, additionalPhrases); a
  version-4 save loads with the new-game words.
- Verified: typecheck; `npm test` (unit: easyChat.test.ts with cases worked from the C, e.g. with sayings 5 and 9
  unlocked a roll of 9 unlocks saying 11, the battle-start 3x2 / 2x3 choice at 18 characters, the doubled ABRA in the A list;
  save.test.ts's version-4 upgrade); e2e easyChat.test.ts (new), saveContinue.test.ts, trainerCard.test.ts.

### Easy Chat: easy_chat_2.c as a model (W-easychat unit 2)

- `menus/easyChatScreenModel.ts` (new, no Phaser / GBA imports): struct EasyChatScreen and EasyChat_AllocateResources
  per screen template (numWords capped at 9, selectGroupNumRows from the displayable groups), the seven input states'
  handlers (HandleJoypad_SelectField / _SelectFooter / _SelectGroup / _SelectWord, the quit / DEL ALL / confirm
  YES/NO menus) returning the interface command ids (`EC_CMD`, 1-22 and 23 = leave), the cursor rules (field wrap
  and the footer, the mail frame's one-field last row, group mode scrolling, the A-Z keyboard's 7/6/7/7 rows, the
  blue box and GroupCursorMoveToBlueBox / GroupCursorWrapAroundLeft, the word list's scroll and page up / down
  clamps), the word buffer (DEL, DEL ALL, place, CommitECWords into the saved array), the getters easy_chat_3.c
  reads, and Task_RunEasyChat's leave step (`EasyChat_OnLeave`: FLAG_SYS_SET_TRAINER_CARD_PROFILE, the
  MYSTERY EVENT IS EXCITING / LINK TOGETHER WITH ALL compares into VAR_0x8004). Keys come in as gMain's bits; the
  YES/NO input is the screen's Menu_ProcessInputNoWrapClearOnChoose, or a built-in model of it.
- C details kept: the passphrase compare reads the edited words even after a cancel (quitting with LINK TOGETHER
  WITH ALL typed still enables Mystery Gift), and the profile flag is set on a cancel too; START with every field
  empty asks "Quit editing?" instead of confirming; the D-pad on the groups and words repeats (JOY_REPT), on the
  fields it doesn't.
- Verified: typecheck; `npm test` (unit: easyChatScreen.test.ts, 31 cases driven by key presses and worked by hand
  from the C: fields → footer wrap and column clamp, group scrolling with 16 and 17 groups, the blue box from both
  modes, page down on 25 and 9 words, DEL / DEL ALL, quit and confirm with and without changes, a profile of MYSTERY
  EVENT IS EXCITING typed on the keyboard, the questionnaire's LINK TOGETHER WITH ALL typed through the groups).
  No e2e: nothing user-visible changes until the screen (unit 3).

### Easy Chat: the screen's main layer and ShowEasyChatScreen (W-easychat unit 3)

- `menus/easyChatScreen.ts` (new): easy_chat_2.c's DoEasyChatScreen / Task_InitEasyChat / Task_RunEasyChat (fade in,
  joypad → interface command, fade out, EasyChat_OnLeave) / DismantleEasyChat around unit 2's model, and easy_chat_3.c's
  main layer: LoadEasyChatGraphics with the BG and window templates, the palettes, the title, the instructions in
  the user's window frame, the phrase window and orange frame by sPhraseFrameDimensions[frameId], the fields (red /
  green underscores for an empty one), the DEL. ALL / CANCEL / OK footer, the bouncing triangle cursor, the START /
  SELECT and scroll arrow sprites (created hidden), the YES/NO window, ECInterfaceCmd_01-08. Commands 09-22 (groups,
  keyboard, word list) log once and return: unit 4.
- Graphics: `graphics/easy_chat/` in extract_gfx.py's GFX_PREFIXES (no symbol clashes).
- `special ShowEasyChatScreen` (script/easyChatSpecials.ts): `runScreenFromScript` + `stopScript`, back through
  CB2_ReturnToFieldContinueScript; off scriptCoverageGaps.ts. Probe `__test.easyChat()` (src/dev/testHooks.ts).
- Found on the way: START → YES on an unchanged profile gives VAR_RESULT FALSE (Confirm_HandleYesNoMenu's
  HasECMessageChanged), so the profile woman says "decided not to" (EventScript_CancelGiveProfile), as on the GBA;
  EventScript_GaveProfile needs a changed word. The Pewter Mart questionnaire is reachable (GetMartClerkObjectId was
  already in), so LINK TOGETHER WITH ALL now enables Mystery Gift through the screen.
- Verified: typecheck; `npm test` (289); e2e easyChat.test.ts (6, rewritten: the profile woman's B → YES with the
  NO / B round trip, the cursor positions on the fields (HELLO's 30 px + 17) and the footer (28 / 115 / 97), DEL. ALL
  → YES and START asking "Quit editing?" on empty fields, START → YES unchanged, a changed word (written into the
  buffer through the probe until unit 4 types it) → EventScript_GaveProfile and the saved profile read back, MYSTERY
  EVENT IS EXCITING → EventScript_GaveSpecialProfile, the questionnaire's LINK TOGETHER WITH ALL →
  FLAG_SYS_MYSTERY_GIFT_ENABLED), all green on the first run. Screenshots of the profile, the three prompts, the
  empty fields and the questionnaire checked by eye against the C's layout.

### Easy Chat: choosing words (W-easychat unit 4, the last)

- `menus/easyChatScreen.ts`: the rest of easy_chat_3.c. ECInterfaceCmd_09-22 replace the stub: the groups menu
  (PrintECGroupsMenu, two names a row, reopening at its scroll), the A-Z keyboard (keyboard_text.c's rows), the word
  list (PrintECRowsWin2 / ClearECRowsWin2 with window 2's 256-px wrap, the UpdateWin2PrintWordsScroll* rows coming
  in), BG2's row scrolling (InitBg2Scroll, ScheduleBg2VerticalScroll / AnimateBg2VerticalScroll: 2 px a frame for a
  row, 4 for a page), the green frame's open / close / widen / shrink animation (StartWin2FrameAnim,
  AnimateFrameResize, RedrawFrameByIndex / RedrawFrameByRect setting WIN0 to its inside), the red rectangle cursor
  (EC_MoveCursor, MoveCursor_Group / _Alpha with sAlphabetKeyboardColumnOffsets), the word list's triangle cursor, the
  mode window and the button window (help) sprites with their slide / anims, the scroll arrows' x by menu. ECWork
  has the remaining fields. No gba/ changes.
- The probe `__test.easyChat()` adds `commandCount`, the frame step, WIN0, BG2's y and scroll row, the cursors, the
  mode / help sprites, the scroll arrows, `selectVisible`, the displayable `groups` and the `words` on display.
- DEVIATIONS: the stubbed-commands note is gone (the screen is still silent).
- Verified: typecheck; `npm test` (289); e2e easyChat.test.ts (7: the three unit-3 cases; a profile typed through the
  groups (HI) and the keyboard (AWESOME) → EventScript_GaveProfile, FLAG_SYS_SET_TRAINER_CARD_PROFILE, the saved
  words, read back; the group names scrolled down / up a row, ENDINGS' 35 rows by SELECT / START pages, rows down
  and up, B back to the groups at their scroll, SELECT to the keyboard and back, the blue box's MODE / DEL, B out;
  MYSTERY EVENT IS EXCITING typed → EventScript_GaveSpecialProfile; the questionnaire's LINK TOGETHER WITH ALL typed
  → FLAG_SYS_MYSTERY_GIFT_ENABLED; the probe injections are gone) and trainerCard.test.ts (3), all green on the
  first run and again with trainerCard. Screenshots of the groups, the scrolled groups, the keyboard, the word list
  and its pages, DEL and the typed questionnaire checked by eye against the C's layout (the footer's OK shows right
  of the green frame between the mode and help sprites, as BG3 outside WIN0 does on the GBA).

### Every Seagallop harbor and the Sevii 1-3 quest (W-ferry unit 2)

- The ferry from every harbor, as e2e tests (`tests/e2e/seagallop.test.ts`): the One / Two / Three Island sailors'
  Tri-Pass menus (EventScript_ChooseDestFromOneIsland / _TwoIsland / _Island: MULTICHOICE_ISLAND_23 / _13 / _12
  while VAR_MAP_SCENE_CINNABAR_ISLAND < 4, MULTICHOICE_SEAGALLOP_V23 / _V13 / _V12 after), EXIT and B; the Rainbow
  Pass menu from Vermilion (EXIT left of the sailor walks the player up the pier) and from each island in turn
  (Vermilion → Three → Four → Six → Seven → Five → One → Two → Vermilion: both pages, OTHER both ways, EXIT, B on
  page 2), each trip's HI-SPEED number (GetSeagallopNumber), direction (sTravelDirectionMatrix) and arrival (sSeag:
  (8, 5) on every island, (23, 32) at Vermilion, the player facing south as GetAdjustedInitialDirection gives with
  no stored direction); Navel Rock and Birth Island (the tickets aren't ported: the trip there starts at their
  sail-off scripts, EventScript_SailToNavelRock / _SailToBirthIsland, HI-SPEED 10 / 12; back with the harbor sailor's
  MULTICHOICE_SEAGALLOP_VERMILION, HI-SPEED 7). Cinnabar has no sailor: its only ferry is Bill's (unit 1).
- The Sevii 1-3 quest played headless (`tests/e2e/seviiQuest.test.ts`): Bill's trip and Celio, One → Two Island by
  the sailor, the Joyful Game Corner's HelpFindLostelleScene (positions after it checked), Two → Three Island,
  BikerBossIntroTrigger and BattleBikersScene (the three bikers and Paxton, the bikers removed with the port's), Berry
  Forest's Lostelle (the wild Hypno, the Iapapa Berry, the warp into FoundLostelleScene), the Meteorite to her daddy
  (VAR_MAP_SCENE_ONE_ISLAND_POKEMON_CENTER_1F → 2, the Moon Stone), Two → One Island, the Pokémon Center's leave
  scene, the ferry to Cinnabar and Bill's goodbye. Warps skip the walking between scenes. Kindle Road isn't on the
  story's path (it leads to Mt. Ember, which waits for the postgame) and isn't played. The play-through found no
  script or mechanic to fix. The unit 1 test's var shortcut (SIDE_PLAN.md decision 7) is gone: seagallop.test.ts's
  Bill's trip now ends at Celio, and the way back is only played in seviiQuest.test.ts.
- ScriptEngine: `multichoice` (and `multichoicedefault`, `multichoicegrid`) resumes the script the frame after the
  choice, as `yesnobox` does since #67 (Task_MultichoiceMenu_HandleInput's ScriptContext_Enable). Its DEVIATIONS
  note is gone. EnterHallOfFame's theoretical input gap (it ends its script at the special) is noted in DEVIATIONS
  instead; not fixed (optional in the plan, and the field sleeps under the HoF screen).
- Found on the way: the unit 1 helpers' `warp` returned on the map event, before the fade-in, so under load the next
  walk gave up at once (the walk onto Vermilion's ticket check never happened). The helpers moved to
  `tests/e2e/seagallopHelpers.ts`; `warp` now waits until the field takes input or a map script has started, and
  `talkToHarborSailor` waits for an idle field after a ride.
- Verified: typecheck; `npm test` (29 files, 289 tests, after merging master); e2e seagallop.test.ts (8) and
  seviiQuest.test.ts (1), green in two runs beside other e2e files for load (with storyCeladonSaffron + sideEvents,
  then gameCorner + mainPathLeftovers: the e2e files with multichoice menus, all green), and again alone after
  merging master. A first run beside five other files failed three ferry tests on the `warp` race above, fixed
  before the green runs. Screenshots of a harbor menu, Three Island's bikers, Berry Forest and Navel Rock's harbor
  checked by eye.

### SIDE_PLAN.md batch 2 merged (PRs #69-#77)

- Plan: SIDE_PLAN.md batch 2 (#69). Merged one PR per unit as each went green: #70 the S.S. Anne departure
  (ss_anne.c) and an S.S. Anne sweep (nothing else wrong); #71 the league lighting (and MAP_SCRIPT_ON_RESUME on
  every map load), GetMartClerkObjectId, the `unused` gap tag, a Trainer Fan Club e2e, the e2e egg hook through
  createEgg; #73 the Seagallop ferry and Bill's trip; #72 / #74 / #75 / #77 Easy Chat units 1-4; #76 every harbor,
  the Sevii 1-3 quest, `multichoice` resuming a frame after the choice.
- Conflict resolutions: `tests/unit/scriptCoverageGaps.ts` in every merge (each side removed its own entries). In
  #73 the conflict resolution kept the three entries #71 had moved to `unused` and GetMartClerkObjectId, which the
  coverage test caught; rebuilt as master's file minus #73's lines (do this rather than resolving the conflict
  blocks by hand). `src/dev/testHooks.ts` (kept both probes), `script/specials.ts` (kept both spread lines),
  `tools/extract_gfx.py`'s GFX_PREFIXES comment.
- Races found in #71's full merge run at load ~230 (passed alone, fixed in #71): transitions.test.ts read the field
  after `waitForEvent('barnDoorWipe')` with a round trip that could land after the fade (now read in the page on
  the wipe's tick); storyLeague.test.ts's Champion battle ran past mashUntil's 120 s wall-clock default (now 300 s
  for whole battles; the frame budget stays the bound; tests/README.md item 8).
- Verified: each PR after merging master in: typecheck, `npm test`, its own e2e file plus the files for shared code;
  the full e2e suite for #71 (ON_RESUME on map loads), #76 (ScriptEngine's multichoice) and #77 (the final tree).
  Last run, on the final tree (#77 with master merged, identical to master after its squash): typecheck clean, 289
  unit, 385 e2e in 57 files.

### AUDIO_PLAN.md: the audio plan (SIDE_PLAN.md batch 3, W-audioplan; docs only)

- New [AUDIO_PLAN.md](../AUDIO_PLAN.md): how the GBA's m4a engine and sound.c work, every place the game uses audio
  (call counts, the port's stubs, the ~40 DEVIATIONS entries), the waits that depend on it (fanfares are frame
  counters; `waitse`, cries and `BGMusicStopped` depend on the engine's track and channel state), the options
  (live engine, pre-rendered files, hybrids), integration, testing and a three-workstream split. Recommends porting
  m4a to TypeScript, ticked once per frame and always running (output optional), with songs from a Python mid2agb.
- Spikes (scratch, not committed): the decomp's mid2agb builds and converts all 347 songs; a Python assembler +
  MPlayMain timing model runs all of them (77 loop, 270 end; fanfare lengths differ from `sFanfares`); all 388 cry
  WAVs are exactly DPCM-reachable; poryaaaa (MIT) renders every song from the decomp's sources (21 MB of Opus).
- Second pass (the coordinator's review): units re-sized against WORKFLOW.md (14 units in four batches, sized with
  `wc -l` of the functions), appendix A maps every port file with audio calls or notes to its owner unit (the
  GBA-layer menus already make their calls), cry wait lengths per mode on real species, the fanfare songs that
  outlive their counters (MUS_POKE_FLUTE's 14 silent bars), the sequencer timing model's exact source lines and
  SoundMain's order (sequencers, then CgbSound, then the mixer: the first frame-order claim was wrong), and a
  model-vs-poryaaaa length cross-check.
- STATUS.md "Next up" points at the plan. No code changed; no tests run.

### The unused gaps: decoration commands and Dive (SIDE_PLAN.md batch 3, W-unused)

- ScriptEngine: `adddecoration`, `removedecoration`, `checkdecor`, `checkdecorspace` (ScrCmd_*: VarGet the id, the
  RSE call commented out) and `bufferdecorationname` (reads the string var and the id, the StringCopy commented
  out) as FRLG's stubs: VAR_RESULT and the string vars stay as they were. Std_ObtainDecoration runs through.
- `world/dive.ts`: FLDEFF_USE_DIVE (FldEff_UseDive, Task_UseDive, DiveFieldEffect_Init / _ShowMon / _TryWarp),
  dive_warp, SetDiveWarp / SetDiveWarpDive / SetDiveWarpEmerge (the map's `dive` / `emerge` connections, else
  RunOnDiveWarpMapScript; sFixedDiveWarp stays the dummy warp, `setdivewarp` isn't ported) and DoDiveWarp with
  Task_Teleport2Warp. PlaySE(SE_M_DIVE) goes through gba/sound.ts's no-op. Behaviors gained isDiveable /
  isUnableToEmerge. EventScript_DeepWater / EventScript_TrySurface run if started.
- Shared changes: DoFallWarp (world/fallWarp.ts) is now DoDiveWarp(FieldCB_FallWarpExit), as in the C, so it gains
  Task_Teleport2Warp's FreezeObjectEvents (FieldCB_FallWarpExit unfreezes). `FieldMoveHost.warpIntoMap` takes an
  optional field callback: without one the field arrives with FieldCB_DefaultWarpExit (`defaultWarpExit`, split
  out of OverworldScene.warpTo) and then unfreezes the objects and unlocks the field controls (Task_ExitNonDoor's
  end). `ScriptEngine.start()` clears a pending `waitState`: EventScript_DeepWater's `dofieldeffect` is followed
  by `releaseall` / `end`, not `waitstate`, and its wait would have hung the next script's `waitstate`.
- Gap list: the three `unused` entries and the `unused` tag are gone (SIDE_PLAN.md decision 10).
- Verified: typecheck; `npm test` (30 files, 298 tests; tests/unit/dive.test.ts: the decoration commands on a
  synthetic script, the waitState fix (fails without it), the three Dive steps on fake hosts through to the warp,
  emerge, MB_UNDERWATER_BLOCKED_ABOVE, no connection, non-diveable water); e2e dive.test.ts (new: Six Island's
  fast water with a synthetic dive connection to Route 21 North, and without one), fieldMoves, surf, strength,
  sideSpecials (fall warps), fly and field: 50 tests green.

### SIDE_PLAN.md batch 3 merged (PRs #79-#81)

- #79 the plan (docs only). #81 W-unused: the decoration commands (FRLG's stubs) and FLDEFF_USE_DIVE / DoDiveWarp;
  its branch was already on master, no conflicts; typecheck clean, 298 unit, full e2e 387 in 58 files (it touches
  the script engine and OverworldScene's warps). #80 AUDIO_PLAN.md: after the first version the coordinator sent
  it back for a second pass (units over WORKFLOW.md's size, the call-site list, cry lengths, the fanfare tails,
  the timing model); merging master in left STATUS.md's "Next up" sentence twice (merge=union), tidied by hand.
- Final tree: master after #80 differs from #81's tested tree only in AUDIO_PLAN.md, STATUS.md and docs/LOG.md, so
  #81's full run stands as the end-of-batch run.

### Audio data: songs (AUDIO_PLAN.md batch A, W-audiodata 1)

- `tools/extract_audio.py` (new, the "audio songs" step of `npm run extract`, one call in tools/extract.py's
  main): builds the decomp's `tools/mid2agb` with `$CXX` (default `c++`), the Makefile's CXXFLAGS minus `-Werror`
  (read from the Makefile, with the known flags as a fallback), straight from the decomp's sources into the
  gitignored `tools/.bin/mid2agb`; rebuilt only when a source, header or the Makefile is newer. No compiler or a
  failed build stops extract with what to install (`xcode-select --install`, `build-essential`, `CXX=`).
- Runs mid2agb on the 347 `midi.cfg` lines whose `.mid` exists (52 `ph_*` / `se_card*` lines skipped) with their
  flags, in parallel, into a temporary directory; assembles the `.s` with a small Python assembler (GNU as
  expressions and precedence, C division; MPlayDef.s read once) and writes `public/gen/audio/songs.json`
  (`players` from music_player_table.inc, `songs[id]` from song_table.inc with the header bytes, the voicegroup
  symbol, track offsets and base64 track bytes whose GOTO / PATT pointers are relocated to offsets into the same
  data). 281,848 bytes of track data, 428 KB of JSON.
- Found on the way: mid2agb ends *every* track with FINE; a looping track's GOTO sits before it, sometimes followed
  by a wait or a PAN (what comes after the `]` marker), so "ends in FINE or GOTO" is really "ends in FINE, loops
  through a GOTO somewhere before it". The song table has no entry on `dummy_song_header` (index 0 is mus_dummy,
  which has no tracks). Re-running MPlayDef.s's ~400 `.equ`s per song made the assembler 2.8 s; reading them once
  and skipping the include made it 0.7 s.
- `npm run extract`: 22.7 s before, 26.8 s after with mid2agb already built (28.0 s with the build); the audio step
  alone is ~1.5 s (mid2agb ~0.55 s, assembly ~0.7 s), the build ~1.3 s.
- Verified: typecheck; `npm test` (31 files, 305 tests; tests/unit/audioSongs.test.ts, 7 tests: the players,
  347 songs with ids equal to scripts.json's SE_* / MUS_*, known players / priorities, se_select's first bytes by
  hand from MPlayDef.s, and a command walker that reaches each track's FINE exactly at its end with 77 looping
  songs and all 3,088 PATT / GOTO pointers inside the data); a missing `CXX` gives the message.

### Audio data: voicegroups and samples (AUDIO_PLAN.md batch A, W-audiodata 2)

- New `tools/extract_audio_voices.py` (one line in `tools/extract.py`'s main, ~0.2 s of extract time) →
  `public/gen/audio/voicegroups.json` (1.2 MB: 77 voicegroups, 5 keysplit tables, gCryTable / gCryTable_Reverse,
  388 each), `samples.json` + `samples.bin` (477 samples, 3.7 MB of s8 PCM), `waves.json` (11 programmable waves).
  Shape and reading rules in docs/DEV_NOTES.md "Audio data: voicegroups and samples".
- Found on the way: voice_groups.inc `.include`s cry_tables.inc between voicegroup128 and voicegroup129; many
  voicegroups define fewer than 128 voices (drum kits, keysplit subgroups of 2-4 voices) and ply_note indexes them
  unbounded, so each voicegroup is written as the ROM reads it, running on into the next ones; keysplit table
  entries outside a table's 36-107 range are the ROM's neighbouring bytes (up to 255), so the five keysplit
  subgroups get 256 entries. In the CGB macros the pan goes into ToneData.length (none of FRLG's CGB voices has
  one). wav2agb's `agbl` is one less than the samples it writes on every one of the 477 WAVs, so each sample in
  samples.bin is `size + 1` bytes.
- Verified: typecheck; `npm test` (31 files, 307 passed + 1 skipped; tests/unit/audioVoices.test.ts: 9 tests, the
  songs one skips until W-audiodata 1's songs.json is merged, checked against a fake songs.json both ways). Once,
  by hand: the decomp's wav2agb built to a scratch dir: all 89 instruments' WaveData headers and bytes equal
  `wav2agb -b`'s, and all 388 cries equal the decoded output of `wav2agb -b -c -l 1 --no-pad` (the DPCM round trip
  is exact, as AUDIO_PLAN spike 3 found).

### W-m4a 1: the m4a sequencer, track commands and controls (silent) (AUDIO_PLAN.md batch A)

- `src/audio/m4a.ts`, `m4aInternal.ts`, `m4aTables.ts`, `songTable.ts`: MPlayOpen, MPlayStart, m4aMPlayStop,
  MPlayMain (m4a_1.s), TrackStop, RealClearChain, the jump-table commands (ply_fine ... ply_port, ply_lfos,
  ply_mod, ply_endtie), ply_memacc, ply_xcmd and the xcmds (ply_xwait, ply_xcmd_0D, ...), FadeOutBody,
  TrkVolPitSet, m4aSongNumStart / StartOrChange / StartOrContinue / Stop / Continue, the m4aMPlay* controls,
  m4aSoundInit / SoundInit / MPlayExtender's jump-table part / m4aSoundMode / SampleFreqSet, m4aSoundMain →
  SoundMain → the MPlayMain chain, and `loadSongTable(songs.json)`. Notes only parse their arguments and set the
  gate time (no channels: W-m4a 2's seam at ply_note's `_081DDB46` and `ChnVolPitUpdate`). Not wired into the
  game (W-sound 1).
- Found on the way: MPlayMain calls the next player in the chain *before* its own work (`o_MusicPlayerInfo_func`
  at its top), so the players run oldest first (BGM, SE1, SE2, SE3, cry 0, cry 1), not newest first as
  AUDIO_PLAN.md section 1 says. m4aMPlayFadeOutTemporarily takes 17 steps, not 16 (fadeOV starts at 257). The
  status clears one tick after the last FINE, which is the same frame when a tempo above 150 BPM runs two ticks
  (MUS_LEVEL_UP: FINE and stop both in frame 64; spike 2's model said 63 because it ran the first tick at the
  song's TEMPO instead of the default 150) and up to two frames later below it (SE_DOOR 34 / 36).
- Verified: typecheck; `npm test` (33 files, 367 tests; tests/unit/m4a.test.ts 52: hand-assembled songs for
  ticks, tempos, waits, GOTO / PATT / PEND / REPT / xWAIT, the one-tick-late status, the chain order, the priority
  rule, pause / continue, fades, volume / pan / pitch control; on songs.json: 270 songs end, 77 loop, and the
  FINE / stop frames of 19 SEs and fanfares, e.g. SE_SELECT 10 / 11, MUS_OBTAIN_BADGE 313 / 315, MUS_EVOLVED
  229 / 230, MUS_POKE_FLUTE 3,061 / 3,063, MUS_CREDITS 14,970 / 14,971). No game code changed, so no e2e.

### AUDIO_PLAN.md batch A merged (PRs #83-#86)

- PR #83 (docs): the user's answers to the plan's open questions as decisions 8-13 (GBA-exact mix; the decomp's own
  mid2agb built during `npm run extract`, so the Python port and its differential script went away; mute key M;
  GBA timing; battle-test audio; W-ref 1 for mGBA recordings with the user's ROM, which is rev 1), W-audiodata
  re-split to two units, W-out 1 split off the mixer (decision 14), a new open question (ROM-derived numbers in
  tests).
- Merged smallest first: #84 (W-audiodata 2, voicegroups and samples), #85 (W-audiodata 1, songs), #86 (W-m4a 1,
  the sequencer). Conflicts: `tools/extract.py` (both audio calls kept, in the file's style) and two `## Audio`
  sections in docs/DEV_NOTES.md (merged into one with the three entries under it). README's extraction table got
  the audio rows (#85). `git diff <PR head>` after each master merge showed only master's changes.
- AUDIO_PLAN.md corrected from W-m4a 1's findings: the music players run oldest first (MPlayMain calls the
  previous head before its own work), the engine's song lengths replace spike 2's (MUS_LEVEL_UP stops in frame
  64), FadeOutTemporarily takes 17 steps.
- Verified: per merge, typecheck and `npm test` (no game code changed, so no e2e per merge); at the end on master
  98d9ab7 after `npm run extract`: typecheck, `npm test` 33 files / 367 tests, the full e2e suite 58 files / 387
  tests, all green.

### W-out 1: the browser output, autoplay and the mute key (AUDIO_PLAN.md batch B)

- `src/audio/output.ts`, `src/audio/worklet.ts`, `src/audio/outputCore.ts` (pure): an AudioContext created at boot
  (suspended by the browser until the first keydown / pointerdown, then resumed; suspended while the tab is
  hidden, flushed and resumed when it is back), one AudioWorkletNode, `pushFrame({ fifoA, fifoB, soundcntH?, psg? })`
  for the mixer (W-m4a 3; `psg` is a proposed shape for W-m4a 4), posted as one transferable buffer per frame. The
  worklet runs the GBA's DirectSound DAC (FIFO routing and volume from REG_SOUNDCNT_H, SOUNDBIAS, 10-bit clip,
  8-bit resolution) and a sample-and-hold upsampler with a 3-4 frame buffer, a ±0.5% rate nudge, silence on an
  underrun and a drop after a stall. Off headless and for `?speed=` > 1; `?audio=0/1` forces it, `?audio=tone`
  (dev) plays a test tone through the same path. Mute key M (localStorage; not in text fields). Phaser's
  `noAudio` and the output start in `main.ts` and `battleTest.ts`. Vite bundles the worklet via
  `./worklet.ts?worker&url` (dev: served as a module; build: `assets/worklet-*.js`, checked with `vite build` and
  by loading the built chunk in Chrome).
- Found on the way: the e2e harness's headless Chrome has `navigator.webdriver` false, so headless is also detected
  by the `HeadlessChrome` user agent. A key sent through DevTools (`Input.dispatchKeyEvent`) turns that page hidden
  (and Phaser stops its loop) unless focus emulation is on: the harness's new `game.realKey` turns it on. The
  PCM plays at 224 × 60 = 13,440 Hz, not 13,379 Hz: the port's frame is 60 Hz, and playing slower than the frames
  come would overflow the buffer (docs/DEVIATIONS.md). `output.ts` takes the key listener as a parameter: importing
  Input.ts (Phaser) from it broke every unit test that imports testHooks.
- Shared edits: `src/main.ts`, `src/battleTest.ts` (noAudio, start), `src/input/Input.ts` (`listenForOutputKeys`,
  `MUTE_KEY_CODE`), `src/dev/testHooks.ts` (one line: `audioOutput`, from the new `src/dev/audioOutputHooks.ts`),
  `tests/e2e/harness.ts` (`query` start option, `realKey`).
- Verified: typecheck; `npm test` 34 files / 381 tests (`tests/unit/audioOutput.test.ts` 14: decideOutput, the
  DAC's stereo / mono / clipping values, the resampler's holds, rate nudge, start, underrun, overflow, a simulated
  60 Hz loop for 2 minutes and with ±0.1% drift and 30 Hz rAF for 10 minutes: no underruns or drops);
  `tests/e2e/audioOutput.test.ts` 4 (off headless; `?audio=1` suspended → running after a real key, suspended
  while hidden; M toggles, survives a reload, not in a text field, remembered with the output off; the tone's peak
  0.3125 = 40 / 128 reaches the speakers in headless Chrome and M silences it while the frames keep flowing), run
  three times; titleScreen + newGame e2e (7). battle-test.html by hand with tools/browser-test.mjs
  (`?audio=tone`: suspended → running on a key, the tone's peak 0.3125, M ignored in the panel's input, muted
  outside it).

### W-m4a 2: notes, channels and cries (silent) (AUDIO_PLAN.md batch B)

- `src/audio/m4a.ts`: ply_note from `_081DDB46` on (the voice through keysplit and rhythm voices, the priority,
  DirectSound channel allocation and stealing, the CGB channel claim, the channel set-up), ChnVolSetAsm,
  ChnVolPitUpdate (MPlayMain's per-channel volume / pitch), umul3232H32, MidiKeyToFreq, MPlayExtender's gCgbChans,
  the cry song (gPokemonCrySong, SetPokemonCryTone, the SetPokemonCry* setters incl. Stereo, IsPokemonCryPlaying)
  and `setVoiceData(voicegroups, samples, waves, pcm?)` / `setSamplePcm(pcm)`, which bind the extracted voice data
  (songs' SongHeader.tone, gCryTable / gCryTable_Reverse). New `m4aMixer.ts` (SoundMainRAM's bookkeeping: the
  DirectSound envelope state machine, the sample position, loop and end, SoundMainRAM_Unk1's reverse start),
  `m4aCgb.ts` (CgbSound as a lifetime placeholder for W-m4a 4), `m4aVoices.ts` (JSON → ToneData / WaveData);
  gScaleTable, gFreqTable and gPokemonCrySongTemplate in `m4aTables.ts`; the full SoundChannel / CgbChannel /
  WaveData / PokemonCrySong structs in `m4aInternal.ts`. Still silent and not wired into the game.
- Found on the way: ply_note breaks priority ties by comparing track *pointers* (`chan.track >= track`), so the
  tracks' IWRAM order matters: gMPlayTrack_BGM < _SE1 < _SE2 < _SE3 (.bss) < gPokemonCryTracks (COMMON). A
  playing channel of the same priority is only stolen by a track at the same or a higher address, and once a
  released channel is seen no playing channel is a candidate. ply_note copies the track's gate time, key and
  velocity to the channel as one word (so midiKey is set there). A cry's sample advances 175.9993 samples a frame
  at key 60 (divFreq 627 × 10,512 / 2^23 × 224), not 176. A compressed voice (the cries) relies on its sample's
  WaveData.type being non-zero (SoundMainRAM_Unk1 plays nothing otherwise), so the port marks the `Cry_*` samples
  as compressed although their PCM is decoded. IsPokemonCryPlaying's lifetimes for AUDIO_PLAN.md section 2's
  species and modes equal its hand estimates in every cell (Pidgey 12 / 12 / 14 / 11 / 12 ... Jynx 135 / 129 /
  141 / 51 / 21 for NORMAL / ENCOUNTER / FAINT / HIGH_PITCH / DOUBLES).
- Verified: typecheck; `npm test` (34 files, 400 tests; tests/unit/m4aChannels.test.ts 33: hand-built envelopes,
  sample ends and loops, FIX / reverse voices, stealing, the CGB claim, keysplit / rhythm, the cry song; on the
  extracted data: setVoiceData, voicegroup000's keysplit / rhythm voices, no song reaching a null keysplit entry,
  the cry table, a cry stealing from MUS_PALLET); `tests/e2e/titleScreen.test.ts` (6) as the boot check.

### W-ref 1: mGBA timings from the ROM (AUDIO_PLAN.md batch B)

- mGBA 0.10.5 from Homebrew (`mgba-app` cask; no sudo, no prompts). Its Qt build only runs Lua from the GUI, so the
  ROM was driven through mGBA's GDB stub from a small Python client (scripts outside the repo; method in
  docs/DEV_NOTES.md "ROM reference measurements"): addresses found by pattern search in the ROM, the game frozen
  after boot (gMain's callbacks), songs and cries started by hijacking the CPU at m4aSoundMain's entry
  (m4aSongNumStart, PlayCry_ByMode), frames counted from gMain.vblankCounter2 the way `tests/unit/m4a.test.ts`
  counts them (the call in frame 0, the next VBlank's m4aSoundMain is frame 1).
- Revision check: songs.json's 347 songs and the 76 voicegroups they reach (voices, keysplit tables, sample headers,
  instrument PCM) are in the rev 1 ROM byte for byte.
- Measured: 24 SEs and 18 fanfares (FINE and IsSEPlaying stop frames; e.g. SE_SELECT 10 / 11, SE_DOOR 34 / 36,
  MUS_LEVEL_UP 64 / 64, MUS_OBTAIN_BADGE 313 / 315, MUS_POKE_FLUTE 3,061 / 3,063), SE_LOW_HEALTH and 9 BGMs' loop
  frames (track 0's first three GOTOs; e.g. MUS_PALLET 2,620 / 5,238 / 7,856), IsPokemonCryPlaying for 8 species in
  NORMAL, ENCOUNTER, FAINT, HIGH_PITCH and DOUBLES (Pidgey 12 ... Jynx 141 frames), and the cry song's end per
  mode. **Every number equals the engine's**; no engine change. The cry numbers also equal AUDIO_PLAN.md section 2's
  estimates (now marked as measured).
- Found on the way: the boot code sets gMain.callback2 itself when its init returns, so a one-off write doesn't
  freeze the game; the first run's long songs were broken into by the intro's songs and the title's Charizard cry
  (caught with a breakpoint on MPlayStart) and were remeasured with the callbacks held for 60 frames. ply_patt and
  MEMACC's true branch run ply_goto, so a GOTO is counted only on a 0xB2 command.
- `tests/unit/m4aRom.test.ts`: the numbers as data, 65 tests on the engine (songs.json and the voice data; skipped
  without them).
- Verified: typecheck; `npm test` (37 files, 491 tests, after merging master). No game code changed, so no e2e.

### W-sound 1: sound.c without the cries, the frame hook, the audio script commands (AUDIO_PLAN.md batch B)

- `src/gba/sound.ts` is now sound.c minus the cries (still stubs, W-sound 2): MapMusicMain and the map music
  helpers, sFanfares / PlayFanfare / PlayFanfareByFanfareNum / Task_Fanfare / WaitFanfare / IsFanfareTaskInactive,
  PlaySE / PlaySE12WithPanning / PlaySE1/2WithPanning / SE12PanpotControl, PlayBGM and the BGM fades, IsSEPlaying /
  IsSpecialSEPlaying / IsBGMPlaying / IsBGMStopped / IsBGMPausedOrStopped, and overworld.c's BGMusicStopped and
  Overworld_ChangeMusicTo. Task_Fanfare runs as a "sound task" from the new `AgbMainFrameEnd()`
  (`src/audio/frame.ts`: the sound tasks, MapMusicMain, m4aSoundMain), called once per logic tick by
  `OverworldScene.tick` and `GbaHostScene.update` (which also hosts BattleScene, in the game and on battle-test, so
  BattleScene needed no line of its own). `src/audio/audioData.ts` loads songs.json, voicegroups.json, samples.json
  and waves.json at boot (BootScene, BattleTestBoot) into `loadSongTable` / `setVoiceData`; `AgbMainSoundInit()`
  (m4aSoundInit + sound.c's statics) runs before the first frame and on a soft reset.
- Script commands (scrcmd.c:883-990): `playse`, `waitse`, `playbgm` (PlayNewMapMusic), `fadenewbgm`, `fadeoutbgm`,
  `fadeinbgm`, `playfanfare`, `waitfanfare`. The three waits use a `SetupNativeScript` that keeps script.c's frames
  (the check starts the next frame; the script goes on the frame after it holds). `savebgm`, `fadedefaultbgm` and
  `playbgm`'s save flag wait for W-sound 3.
- Test hooks: `__test.audioEvents(since)`, `__test.audio()`, `__test.playSong(name)`. eggHatch's local 220-frame
  counter is gone (the real Task_Fanfare holds the message).
- Found on the way: FRLG's item balls (and `giveitem`'s EventScript_BufferPocketNameTryFanfare) play MUS_LEVEL_UP
  (FANFARE_LEVEL_UP, 80 frames), not MUS_OBTAIN_ITEM as AUDIO_PLAN.md section 5 says; MUS_OBTAIN_ITEM is only
  Std_ObtainDecoration's (unreached) and the mystery event's. The diploma played FANFARE 0 (a local
  `FANFARE_OBTAIN_BADGE = 0`); now K.FANFARE_OBTAIN_BADGE (5, 340 frames).
- Waits that now take their GBA length: every `waitfanfare` / IsFanfareTaskInactive / WaitFanfare (items, heals,
  badges, the move relearner, the slot payout, the diploma, the dex rating, egg hatching), every `waitse`, and the
  IsSEPlaying checks of the screens whose PlaySE calls are live (evolution's MUS_EVOLUTION_INTRO, the trainer card,
  item use), the title screen's FadeOutMapMusic wait.
- Tick budgets raised: none. The full e2e suite passed on its first run with the longer waits (59 files, 389
  tests, 22.7 min), so no budget sized for the instant waits was too tight, and nothing failed and passed on a
  rerun.
- Verified: typecheck; `npm test` (36 files, 426 tests after merging W-m4a 2 and W-out 1; tests/unit/sound.test.ts
  12: fanfare counts, the BGM paused and resumed, MUS_EVOLVED outliving its counter, WaitFanfare, IsSEPlaying over
  SE_SELECT, FadeOutMapMusic's 16 × speed + 1 wait, a new song after the fade); `tests/e2e/audio.test.ts` (Viridian
  Forest's Potion ball: MUS_LEVEL_UP's continue 80 frames after the fanfare, "put the POTION" 3 after, BGM paused
  throughout; the Game Corner fisher's `waitse` holds `setflag` until SE_SHOP's player stops, against the engine's
  own length for SE_SHOP), 3 runs green; the full e2e suite once before the merge (above), and after it audio,
  audioOutput, eggHatch, titleScreen and wildBattle.

### AUDIO_PLAN.md batch B merged (PRs #88-#92)

- **#88** (docs): the user's answer to open question 1 (decision 15: frame counts measured from the ROM may go into
  unit tests); W-ref split in two, W-ref 1 (mGBA timings) run as batch B's fourth worker (decision 16, coordinator);
  WORKFLOW.md's e2e suite figure raised from ~10 to ~20 minutes.
- **#89** W-m4a 2 (notes, channels, cries; silent), **#90** W-out 1 (AudioWorklet output, autoplay, mute key M),
  **#91** W-sound 1 (sound.c without the cries, `AgbMainFrameEnd`, fanfare and `waitse` waits, audio data at boot,
  test hooks), **#92** W-ref 1 (mGBA timings on the rev 1 ROM: every SE, fanfare, loop and cry number equals the
  engine's; the audio data is in the rev 1 ROM byte for byte), merged in that order (as they finished).
- Merges: #90 and #91 merged master in (docs union-merged; #91's worker resolved `dev/testHooks.ts` and
  `src/battleTest.ts` against W-out 1 and wired W-m4a 2's `setVoiceData` into `loadAudioData` itself); each
  merge's diff against the PR head was checked to hold only master's changes plus those resolutions.
- Found on the way: FRLG's item balls and `giveitem` play MUS_LEVEL_UP (80 frames), not MUS_OBTAIN_ITEM;
  AUDIO_PLAN.md sections 5 and 6 corrected. The diploma passed fanfare 0 (fixed in #91).
- Tests: per merge typecheck and unit; e2e per PR: #89 titleScreen; #90 audioOutput, titleScreen, newGame, field,
  wildBattle; #91 audio, audioOutput, titleScreen, newGame, eggHatch (its worker ran the full suite before
  merging master in: 389 passed, no budgets raised); #92 none (unit test and docs only). Full run on master
  097f0fb (everything but #92's unit test): typecheck clean, 426 unit in 36 files, **393 e2e in 60 files, all
  passed first time, 20.8 min**. Final master 5ae37a9: typecheck clean, 491 unit in 37 files.

### W-sound 2: cries, text codes and the audio specials (AUDIO_PLAN.md batch C)

- `src/gba/sound.ts`'s cries (sound.c:316-580): PlayCry_Normal / _ByMode / _Script / _NormalNoDucking /
  _ReleaseDouble, PlayCryInternal's mode table on W-m4a 2's SetPokemonCry* setters and SetPokemonCryTone,
  gMPlay_PokemonCry, Task_DuckBGMForPokemonCry (a sound task next to Task_Fanfare: BGM volume 85 while the cry plays,
  256 after), IsCryFinished, IsCryPlaying, IsCryPlayingOrClearCrySongs, StopCry, StopCryAndClearCrySongs, main.c's
  ClearPokemonCrySongs. Cry starts are reported to `__test.audioEvents` as `{type: 'cry', id: species, name: sample,
  player: 'CRY0' | 'CRY1', mode}`; `__test.audio().cry` has the ducking task. `SpeciesToCryId` (pokemon.c) is in
  `pokemon/Pokemon.ts`; `tools/extract.py` adds cry_ids.h's sHoennSpeciesIdToCryId to `pokemon/tables.json`.
- Script commands: `playmoncry` (PlayCry_Script), `waitmoncry` (SetupNativeScript(IsCryFinished)), and
  `showmonpic`'s PlayCry_Script(species, CRY_MODE_NORMAL) (ScrCmd_showmonpic plays it, not the pic box).
- Text printer (text.c): SE_SELECT on A / B at a `\p`, `\l` or PAUSE_UNTIL_PRESS; PLAY_SE, PLAY_BGM, WAIT_SE,
  PAUSE_MUSIC, RESUME_MUSIC.
- Specials (new `script/audioSpecials.ts`, out of NO_OP): PlayTrainerEncounterMusic (battle_setup.c; SpecialEnv gets
  `trainerBattle()`), Script_FadeOutMapMusic (its `waitstate` waits for BGMusicStopped, the white-out fade).
- Found on the way: ClearPokemonCrySongs zeroes the cry song while its track may still be in the xWAIT loop (the
  sample ran out before the length): the next tick reads 0 as running-status XCMD 0 = ply_xxx → ply_fine, so
  IsCryFinished / IsCryPlayingOrClearCrySongs end the cry song early and free its player; and IsCryFinished right
  after a NoDucking cry (no task) clears and cuts off that cry, as on the GBA. PLAY_BGM with a fanfare song (the gym
  badge texts' MUS_OBTAIN_BADGE, Route 23's MUS_LEVEL_UP) starts it on SE2, its own player, so WAIT_SE-style checks
  see it. At text speed 1 every control code after the first in a frame costs a frame (RenderText's delayCounter).
  No `it.todo`s were left in tests/unit/m4aRom.test.ts; its ROM cry table is now also asserted through
  PlayCry_ByMode / IsCryPlaying / IsCryFinished (TRUE one frame after IsCryPlaying turns FALSE).
- Waits that now take their GBA length: every IsCryFinished / IsCryPlaying wait (evolution's cries, egg hatching,
  the trade scene, Oak's Nidoran, the battle anims' Howl / Roar / Growl / Hyper Voice tasks, `waitmoncry`), WAIT_SE in
  text, the white-out's music fade, and any `waitse` right after a text box closed with A (SE_SELECT, 11 frames).
- Tick budgets raised: none. The full e2e suite (61 files, 396 tests, 29 min under another worker's run) had one
  failure, unrelated to audio: surf.test.ts "getting off on the shore" read the surf blob after `t.until` returned
  (tests/README.md rule 5), when the jump could be over under load; it now reads it inside the predicate (and allows
  1,200 frames for the round trip). It passed on the rerun.
- Verified: typecheck; `npm test` (38 files, 518 tests; new tests/unit/soundCries.test.ts 11, m4aRom.test.ts +16:
  the 8 ROM cries in 5 modes through PlayCry_ByMode for IsCryPlaying and IsCryFinished); `tests/e2e/audioCries.test.ts`
  (3: the Celadon Condominiums Meowth's `waitmoncry` holds `release` until the cry's stop + 3 frames, SE_SELECT on
  a `\p`, Bug Catcher Rick's MUS_ENCOUNTER_BOY), audio.test.ts; the full e2e suite once (above).

### W-sound 3: map music, savedMusic, the warps' music waits (AUDIO_PLAN.md batch C)

- `src/gba/overworldMusic.ts` is overworld.c's music block (overworld.c:989-1200): GetCurrLocationDefaultMusic,
  GetWarpDestinationMusic, Overworld_PlaySpecialMapMusic (savedMusic, MUS_SURF where Overworld_MusicCanOverrideMapMusic
  allows it, the Champion's room's fade back in), Overworld_SetSavedMusic / ClearSavedMusic,
  Overworld_TryMapConnectionMusicTransition, Overworld_ChangeMusicToDefault, GetMapMusicFadeoutSpeed,
  TryFadeOutOldMapMusic, Overworld_FadeOutMapMusic. gDisableMapMusicChangeOnMapLoad (and MUSIC_DISABLE_*) is in
  sound.ts, where PlaySE now skips its sound while it's set; the Hall of Fame's SetWarpsToRollCredits sets KEEP, the
  credits set KEEP / OFF, a soft reset clears it.
- `savedMusic` in GameState and the save: **SAVE_VERSION 6** (`upgradeSave` gives version 5 saves 0).
- Callers: the new game, CONTINUE, the warps' and screens' field callbacks (FieldCB_DefaultWarpExit and friends),
  a battle's return, the Safari Zone's out-of-balls warp, the naming screen's return, white-out (StopMapMusic),
  `onMapLoaded`'s ClearSavedMusic before ON_TRANSITION, the connections. Every warp path's sound calls (decision 17):
  DoWarp / DoDiveWarp / Task_DoorWarp in `OverworldScene.warpTo` (TryFadeOutOldMapMusic, SE_EXIT, the wait for
  `!fade && BGMusicStopped()`), the door SEs of Task_DoorWarp / Task_ExitDoor, Dive / fall warps, Teleport, Dig /
  Escape Rope (TryFadeOutOldMapMusic and BGMusicStopped through `FieldMoveHost.warpFadeOutScreen(mapId, true)`; their
  SE_WARP_IN / _OUT, SE_CLICK, SE_FALL, SE_M_STRENGTH), Fly in (Overworld_PlaySpecialMapMusic; Fly fades no music
  out), the Seagallop ferry's Overworld_FadeOutMapMusic + BGMusicStopped wait. Bike music (GetOnOffBike,
  ForcePlayerOntoBike), surf music (FldEff_UseSurf, CreateStopSurfingTask). Scripts: `savebgm`, `fadedefaultbgm`,
  `playbgm`'s save flag, `warpsilent` (no SE_EXIT).
- Waits that now take their GBA length: every warp into a map with other music (+16 × 2 + 1 frames from the fade's
  start indoors, 16 × 4 + 1 outdoors, over the screen fade's), Teleport / Dig / Escape Rope / Dive / fall warps the
  same, the Seagallop ferry's warp (64 frames).
- Found on the way: on the GBA the bike's MUS_CYCLING doesn't survive a connection (LoadMapFromCameraTransition crossfades
  to the next map's music, then clears savedMusic); FRLG's FieldCB_DefaultWarpExit (no gFieldCallback) is also what
  brings the map's music back after a wild battle. The warps' door SEs use W-sound 4's `FieldDoors.getDoorSoundEffect`.
- Tick budgets raised: none. The full e2e suite passed on its first run with the longer warps (61 files, 398 tests,
  22.4 min), and nothing failed and passed on a rerun. After merging master (#95, #96), two races showed when four
  e2e files shared the machine and were fixed: surf.test.ts's shore jump (a 60-tick watcher that could run out
  before the walk began, and the blob read after the frame's batch) and playerAvatar.test.ts's ledge jump (the
  release came after the batch, up to 40 ticks, so the player walked on a step: now `holdWhile`); mapMusic's surf
  test retries the step back to the shore.
- Verified: typecheck; `npm test` (38 files, 502 tests; tests/unit/overworldMusic.test.ts 9, a version 5 save in
  save.test.ts, savedMusic in saveData.test.ts's round trip); `tests/e2e/mapMusic.test.ts` (5: Pallet Town → Oak's lab
  door with SE_DOOR and a speed-2 fade, the lab ≥ 33 frames later and MUS_OAK_LAB; the lab's mat → Pallet Town with
  SE_EXIT and a speed-4 fade, ≥ 65 frames; the player's house without a fade; Pallet Town → Route 1, MUS_ROUTE1 128
  frames after the speed-8 fade; the Bicycle: MUS_CYCLING, saved, CONTINUE plays it, off the bike MUS_ROUTE1; Surf:
  MUS_SURF, back on land MUS_PALLET); the full e2e suite once (above).

### W-sound 4: the field's SEs (AUDIO_PLAN.md batch C)

- The field's sound calls, ported at their port functions with the C's names: the Pokémon Center / Hall of Fame
  machine (SE_BALL per ball, MUS_HEAL, PokeballGlowEffect_WaitForSound's IsFanfareTaskInactive: the nurse now waits
  for the fanfare), Fly's SE_M_FLY, the Escape Rope arrival's SE_CLICK, the field move banner's cry
  (PlayCry_NormalNoDucking / PlayCry_Normal, still W-sound 2's stubs), Cut (2), Rock Smash, Sweet Scent, Flash,
  Ruin Valley's SE_BANG; field_player_avatar.c (PlayCollisionSoundIfNotFacingWarp's SE_WALL_HIT, SE_LEDGE, the
  spinners' SE_M_RAZOR_WIND2, the boulder's SE_M_STRENGTH); field_control_avatar.c (SE_WIN_OPEN on START and on
  Task_QuestLogPlayback_OpenStartMenu's path, TryStartInteractionScript's SE_SELECT except for the PCs, the
  boulder's SE_FALL down a hole); field_specials.c (SE_ELEVATOR, SE_DING_DONG, the field ListMenu's three
  SE_SELECTs); `opendoor` (GetDoorSoundEffect: `FieldDoors.getDoorSoundEffect`, the ScriptHost's
  `doorSoundEffect`); player_pc.c and the storage PC's main menu; start_menu.c (the menu's SEs, CloseStartMenu,
  SE_SAVE with SaveDialogCB_ReturnSuccess's IsSEPlaying wait, SE_BOO, the A-held SE_SELECT); the Itemfinder, the
  VS Seeker, the S.S. Anne's horn (2), the Seagallop's SE_SHIP / SE_EXIT (were `PlaySE(0)`), SE_FIELD_POISON and
  the puddles' SE_PUDDLE (2).
- `ui/Menu.ts` now plays menu.c's SEs (Menu_ProcessInput / Menu_ProcessInputNoWrapAround), which gives the start
  menu, YES/NO, multichoice and the shop's menu theirs; the callers add their B / NO SEs (script_menu.c, shop.c).
  The multichoice grid has Menu_ProcessInputGridLayout's. These files belong to no unit in appendix A (the calls
  there were comments, not "kept").
- Left to others / not in the port: the warp tasks' SEs and music, including the fall arrival's SE_FALL /
  SE_M_STRENGTH in world/fallWarp.ts (decision 17: W-sound 3), the warp paths' door SEs (W-sound 3 can call
  `getDoorSoundEffect`); escalators, the Lavaridge warps, FldEff_NpcFlyOut, Birth Island's rock, ShakeScreen,
  LoopWingFlapSound, the Acro Bike's and secret base mats' SEs, the mailbox's five SE_SELECTs (no mail), weather.
- Found on the way: `tests/e2e/audio.test.ts`'s `waitse` check took the first frame either SE player was busy as
  SE_SHOP's; talking to the fisher now plays SE_SELECT first, so it counts only from SE_SHOP's frame on.
  storyLeague's Elite Four test failed once in the full run: mashing A only ever picks PSYCHIC, whose 10 PP ran out
  in the Champion battle on an unlucky run ("There's no PP left" until the 20,000-frame budget; normally ~12,700
  frames), a race on the rolls, not on audio; the test's Mewtwo now has three PP Ups (16 PP).
- Tick budgets raised: none (the heal's MUS_HEAL and the save's SE_SAVE fit the existing waits).
- Verified: typecheck; `npm test` (37 files, 491 tests); `tests/e2e/fieldSounds.test.ts` (6: the bump and ledge,
  talking and Bill's `opendoor`, the bedroom PC, START and the save's SE_SAVE + 60 frames, the heal machine's SE_BALLs
  and MUS_HEAL wait, the school blackboard's grid SEs), several runs; the full e2e suite once (61 files, 398 tests,
  22.4 min: 396 passed, the two above failed; both fixed and rerun green: audio, storyLeague's Elite Four (3 runs),
  fieldSounds).

### W-m4a 3: the mixer, first sound (AUDIO_PLAN.md batch C)

- **Mixer** (`audio/m4aMixer.ts`, m4a_1.s SoundMainRAM / SoundMainRAM_Unk1): the reverb pass (SoundMainRAM_Reverb:
  this slot's and the next slot's A + B × reverb >> 9, +1 when bit 7 is set, into both FIFOs) or the clearing,
  then each DirectSound channel's samples (interpolated by `fw` for resampled voices, as read for FIX ones, reverse
  voices backwards) × envelopeVolumeRight / Left >> 8 added into FIFO A / B with 8-bit wraparound, inside the
  per-sample loops W-m4a 2 left (`mix:` comments); FastForward only when nothing is mixed. No DPCM (decision 4).
- **DMA ring:** `gSoundInfo.pcmBuffer` (PCM_DMA_BUF_SIZE × 2), `m4aSoundVSync` (VCountIntr: pcmDmaCounter) and
  `PcmSlotOffset` (SoundMain's r5: the slot this frame mixes into); `m4aPcmFrame()` returns it with REG_SOUNDCNT_H.
- **Output:** `AgbMainFrameEnd` runs m4aSoundVSync before m4aSoundMain, turns the mixing on while
  `audioOutputWantsFrames()` and then calls `pushFrame(m4aPcmFrame())`; `loadAudioData` fetches samples.bin in the
  background when the output is on (`setSamplePcm`).
- **Mono:** found on the way: FRLG's mixer never reads `soundInfo.mode` bit 0 (no reference in m4a_1.s); mono is
  SetPokemonCryStereo's REG_SOUNDCNT_H (both FIFOs to both speakers at half volume), now kept as `gRegSoundCntH`
  and sent with each frame (the DAC already applied it), and the bit is CgbSound's (W-m4a 4). Callers wired:
  title_screen.c:742 (`titleScreenEnv.savedOptionsSound`, set by MainMenuScene from the loaded save) and
  option_menu.c:519; reset_save_heap.c's ReloadSave is the link's (not ported).
- **Found on the way:** SE_SELECT (and SE_DOOR, SE_EXIT, SE_PC_ON, SE_WALL_HIT, SE_USE_ITEM, SE_FLEE) are PSG only,
  so the menus' cursor sound stays silent until W-m4a 4; SE_SAVE, SE_BALL_OPEN, SE_SHOP, SE_BIKE_BELL, SE_EXP, SE_BANG
  and the cries are DirectSound. The "silent until the mixer" entries in DEVIATIONS.md now say what is left (PSG).
- **Headless render** (`tests/audioRender.ts`, `tools/render-audio.ts`: `npx vite-node tools/render-audio.ts
  MUS_TITLE 1200 out.wav`): MUS_TITLE 1,200 frames = 268,800 samples per FIFO, RMS 18.0, peak 106 (s8), zero for the
  30 frames before it starts; MUS_PALLET RMS 9.6, peak 47; SE_SAVE RMS 8.5 over its first 30 frames, last non-zero
  sample 41 frames after its start (reverb tail included); cry 25 and its reverse RMS 10.9.
- Tests: typecheck; unit (`tests/unit/m4aMixer.test.ts`, 14: hand-computed blocks, interpolation, envelope,
  wraparound, slots, reverb impulse, mono through the DAC, bookkeeping on / off by hand and over MUS_TITLE + SEs +
  cries for 900 frames, the renders); e2e audioOutput (now: `?audio=1` frames reach the worklet with a non-zero
  peak on the title screen), titleScreen, audio.

### AUDIO_PLAN.md batch C merged (PRs #94-#98)

- **#94** (docs): batch C's ownership (decisions 17-19, coordinator): every sound call in the warp paths to W-sound
  3, SetPokemonCryStereo's callers to W-m4a 3, the workers' full e2e runs taking turns through a lock directory.
- **#95** W-m4a 3 (the mixer: the first sound), **#96** W-sound 4 (the field's SEs), **#97** W-sound 3 (map music,
  savedMusic, save version 6, the warps' music waits and SEs), **#98** W-sound 2 (cries, the text printer's audio
  codes, the audio specials), merged in that order (as they finished).
- Merges: #96 merged master in cleanly; #97's worker merged master itself (its warps' door SEs moved onto #96's
  `FieldDoors.getDoorSoundEffect`); #98 conflicted on `gba/sound.ts` (header comment, probe: both kept),
  `script/ScriptEngine.ts` (imports: both kept) and `tests/e2e/surf.test.ts` (#97 and #98 fixed the same race:
  master's kept). The docs' union merge doubled four DEVIATIONS entries (battles, field sounds, evolution, egg
  hatching: tidied, incl. a stale evolution fragment from batch B) and ran LOG entries together (blank lines
  restored). Each merge's diff against the PR head was checked to hold only master's changes plus those.
- Found on the way: FRLG's mixer never reads `soundInfo.mode & 1` (mono is SetPokemonCryStereo's DMA routing);
  races fixed by the workers in surf, playerAvatar (a ledge jump overshooting when DOWN was released after the
  tick batch), storyLeague (Mewtwo's PSYCHIC running out of PP in the Champion battle: 3 PP Ups) and audio.test.ts.
- Tests: per merge typecheck and unit; e2e per PR: #95 audioOutput, titleScreen, audio, newGame; #96 fieldSounds,
  audio, audioOutput, titleScreen, options, saveContinue; #97 mapMusic, saveContinue, newGame, field, hallOfFame,
  fieldSounds, audio; #98 audioCries, audio, fieldSounds, mapMusic, surf, titleScreen, newGame, evolution,
  eggHatch, trainerBattle. W-sound 2, 3 and 4 each ran the full suite before merging master in (398 / 396 / 398
  tests, all green after their fixes; no tick budgets raised). Full run on master 8504a80: typecheck clean, 542
  unit in 40 files, **407 e2e in 63 files: 406 passed, 20.3 min**; the one failure, inGameTrades' Reyley trade,
  was a race (the scene watcher imported its modules inside the eval, so under load its poll began after
  CB2_InitInGameTrade's one frame): the modules now load in an awaited eval first, 3 reruns green, cause added to
  tests/README.md. A headless render of MUS_PALLET (`tools/render-audio.ts`, 600 frames) gave 134,400 samples per
  FIFO, RMS 9.7 / peak 47 of 128.

### W-sound 5a: battle music, the BattleUi hooks, the battle scripts' sounds (AUDIO_PLAN.md batch D)

- BattleScene's `ui.playSE / playCry / playBGM / playFanfare` pass through to gba/sound.ts (PlaySE, PlayCry_Normal(species,
  0), PlayBGM, PlayFanfare), so the controllers', battle/gfx.ts', battleInterface's and the anims' calls are heard
  until their units call sound.ts directly (decision 21; W-sound 8 deletes the hooks).
- Battle music: new `battle/battleBgm.ts` (pokemon.c's GetBattleBGM and PlayMapChosenOrBattleBGM, taking the flags
  and the trainer class as arguments). `OverworldScene.runBattle` is CreateBattleStartTask: it starts the song before
  the transition; `song` is 0 (the default: MUS_VS_WILD, MUS_VS_TRAINER, MUS_VS_GYM_LEADER for leaders and the
  Elite Four, MUS_VS_CHAMPION), MUS_VS_LEGEND for a roamer, StartLegendaryBattle's MUS_VS_MEWTWO / _VS_DEOXYS /
  _VS_LEGEND / MUS_RS_VS_TRAINER (`ScriptHost.startScriptedBattle` takes an optional `song`). battle-test.html
  starts the battle music on launch.
- SE_MUGSHOT in the mugshot transitions (Mugshot_StartOpponentSlide). battle_main.c: HandleEndTurn_BattleWon's
  victory music (MUS_VICTORY_GYM_LEADER for leaders and the Champion, else MUS_VICTORY_TRAINER), FadeOutMapMusic(5)
  in HandleEndTurn_FinishBattle, SE_FLEE (Safari run), m4aSongNumStop(SE_LOW_HEALTH) in ReturnFromBattleToOverworld.
  battle_script_commands.c: getexp's MUS_VICTORY_WILD, the level-up's HandleLowHpMusicChange call (gfx.ts' function,
  still a no-op until W-sound 6a), the yes / no boxes' SE_SELECT, VARIOUS_WAIT_FANFARE's IsFanfareTaskInactive.
  BattleStopLowHpSound (battle_gfx_sfx_util.c) is a TODO in main.ts / bsCommands2.ts for W-sound 6a.
- Found on the way: the level-up fanfare holds nothing on the GBA. BattleScript_LevelUp has `fanfare MUS_LEVEL_UP`
  and no `waitfanfare`, so it only pauses the victory music for 80 frames. The one battle script that waits
  (VARIOUS_WAIT_FANFARE) is the Poké Flute's (BattleScript_PokeFluteWakeUp: MUS_POKE_FLUTE, 450 frames). A level-100
  mon gets no MUS_VICTORY_WILD: getexp's music change is in the branch that MAX_LEVEL skips (as in the C).
- Tick budgets raised: none (no wait in the battle got longer: the level-up fanfare holds nothing, see above).
- Verified: typecheck; `npm test` (41 files, 544 tests; new tests/unit/battleBgm.test.ts 2); `tests/e2e/audioBattle.test.ts`
  (6), wildBattle, trainerBattle, scriptedBattles, audio, transitions. transitions.test.ts' "every battle transition"
  (17 page loads in one test, 120 s wall clock) timed out twice at load averages of 80-140 while another worker's
  full suite ran (and the tests after it failed on the leftover page), then passed (50 s) on the rerun; master ran it
  in 59 s at a similar load, and timing each transition alone showed nothing slower. The full suite was not run
  (the coordinator's checkpoint came while the lock was held by another worker).

### W-sound 7a: the evolution scene's, egg hatching's and the in-game trade's sounds; map music after script screens

- **Evolution scene** (`menus/evolutionScene.ts`, evolution_scene.c): m4aMPlayAllStop on entry and on a cancel,
  PlayNewMapMusic(MUS_EVOLUTION), EVOSTATE_RESTORE_SCREEN's `if (IsSEPlaying())` after SE_EXP (no longer skipped:
  the m4aMPlayAllStop the frame after it starts cuts SE_EXP and MUS_EVOLUTION), PlayBGM(MUS_EVOLVED),
  PlayFanfare(MUS_LEVEL_UP), StopMapMusic + Overworld_PlaySpecialMapMusic when a move is learned or at the end
  (battle-test.html has no field: skipped there). The cries, MUS_EVOLUTION_INTRO and the sparkles' SEs
  (evolutionGraphics.ts, complete) were live already.
- **Egg hatching** (`menus/eggHatch.ts`): gSpecialVar_0x8005 = GetCurrentMapMusic(), Task_EggHatchPlayBGM's
  StopMapMusic; m4aSoundVSyncOn is a no-op (nothing turned the sound off).
- **In-game trade** (`menus/tradeScene.ts`): cachedMapMusic + PlayNewMapMusic(MUS_EVOLUTION) at STATE_START,
  PlayNewMapMusic(cachedMapMusic) at the end; its stand-in BattleUi's playSE is PlaySE (SE_BALL_OPEN). The cable /
  link path's FadeOutBGM / IsBGMStopped wait isn't ported (no link play).
- **Map music after script screens:** `OverworldScene.runScreenFromScript` calls Overworld_PlaySpecialMapMusic when
  the screen set no field callback: in the C every such screen returns through FieldCB_ContinueScriptHandleMusic
  (trades, egg hatching, the move relearner, the move tutor, the slot machine), FieldCB_WarpExitFadeFromBlack (the
  diploma) or RunFieldCallback's FieldCB_DefaultWarpExit; the party menu's, Easy Chat's and the move deleter's set
  their own. After egg hatching MUS_PALLET comes back on the field.
- Shared: `gba/sound.ts` gains an `m4aMPlayAllStop` that reports a `stop` per player with a live track;
  `gba/overworldMusic.ts` gains `hasOverworldMusicHost()`.
- Found on the way (the full run): two test races, both fixed. gameCorner's slot machine read the main task in a
  `.then()` after `t.until`, so a loss's MainTask_DarnNoPayout could be over before the read (now read inside the
  predicate); easyChat's special profile mashed A through `delay 80` + Text_HeardThatBefore, which once went past the
  page and on into talking to the woman again until the 120 s timeout (now waits in the page without pressing).
- Tests: typecheck clean, 542 unit; new `tests/e2e/audioScenes.test.ts` (3: a Rare Candy evolution's events in
  order with MUS_EVOLUTION exactly MUS_EVOLUTION_INTRO's length after it and SE_EXP stopped one frame after it
  starts; an egg hatching's MUS_DUMMY / MUS_EVOLUTION_INTRO / MUS_EVOLUTION 60 frames later / cry / MUS_EVOLVED /
  MUS_PALLET on the field; Reyley's trade's MUS_EVOLUTION, both cries, MUS_EVOLVED and MUS_PEWTER again); evolution,
  eggHatch, daycare, inGameTrades, moveTutors, gameCorner (39) green. Full suite on 5e23095 + this (load ~90 from
  the other workers): 410 e2e in 64 files, 408 passed, 27.4 min; the two failures are the races above, both green on
  rerun after the fixes. No tick budgets needed raising (the waits this unit adds are a frame or none: the cries and
  MUS_EVOLUTION_INTRO's wait were live already).

### W-m4a 4a: CgbSound, the engine side of the PSG (AUDIO_PLAN.md batch D, unit 1)

- `src/audio/m4aCgb.ts` replaces the placeholder with m4a.c's CgbSound (the per-frame software envelope with its
  attack / decay / sustain / release, the pseudo echo, c15's double step every 15 frames, the NRx0-NRx4 writes, the
  wave channel's RAM load through NR30's bank switch), CgbModVol / CgbPan (`soundInfo.mode & 1`: mono plays the
  PSG on both sides), CgbOscOff and MidiKeyToCgbFreq (gCgbScaleTable, gCgbFreqTable, gNoiseTable, gCgb3Vol in
  m4aTables.ts). CgbSound's gotos are a small state machine named after the C's labels.
- New `src/audio/soundRegs.ts`: the sound registers 0x4000060-0x400009F as a register file (reads return what was
  written; wave RAM writes go to the bank NR30 doesn't play), the write log, and `PsgFrame { writes, state }`.
  SoundInit, MPlayExtender, m4aSoundMode, SetPokemonCryStereo and ply_port write through it as the C does
  (SOUNDCNT_X, SOUNDCNT_L / NR50 0x77, SOUNDCNT_H, SOUNDBIAS_H 0x42); `gSoundInfo.soundRegs` is gone. m4aSoundInit
  resets it to the power-on state first.
- `m4aPcmFrame()` now carries `psg`; AgbMainFrameEnd takes it every frame (so the log can't pile up headless) and
  pushes it with the frame; output.ts posts `psg` and `psgState` to the worklet (`FrameMessage`), which ignores them
  until W-m4a 4b's synth. docs/DEV_NOTES.md "PSG frames" says what the frame holds and when, for W-m4a 4b.
- Lifetimes: a CGB channel now lives through its release and echo (SE_SELECT's square 1 goes off in frame 15, SE_DOOR
  22, SE_EXIT 36, SE_PC_ON 68, SE_WALL_HIT 14, SE_FLEE 39). No wait moved: IsSEPlaying and the other waits read the
  tracks (m4a, m4aRom, m4aChannels unchanged and green).
- Found on the way: audioCries.test.ts's Meowth `waitmoncry` test raced (a `press('A')` from Node then a mash: under
  load the message closed ~40 frames after the cry, and the script with it; 71 instead of 31). It now talks and
  mashes in one in-page mash; the script's end is checked to be 3 to 9 frames after the cry (the mash's cycle can
  close the message just after the cry ends).
- Tests: `tests/unit/m4aCgb.test.ts` (18): MidiKeyToCgbFreq against the tables, the init writes in order, wave RAM
  banking, CgbModVol stereo / mono, and square, sweep, square 2, wave and noise notes frame by frame against m4a.c
  (worked by hand), START with STOP, TrackStop's CgbOscOff, the echo; on the extracted songs SE_SELECT, MUS_ROUTE1's
  four channels and the PSG-only SEs' off frames. Typecheck clean, unit 560 in 41 files; e2e audio, audioCries,
  audioOutput, mapMusic, fieldSounds: 20 passed.

### W-sound 5b: the battle controllers' sounds (AUDIO_PLAN.md batch D, unit 4)

- Every sound call of battle_controller_player.c, _opponent.c, _oak_old_man.c and _safari.c now calls gba/sound.ts
  (or audio/m4a.ts) with the C's arguments instead of BattleScene's `ui.play*`: the menus' SE_SELECT (action, move,
  target, move switching, the Old Man's simulated input, Safari's menu), SE_FAINT panned by side (PlaySE12WithPanning
  SOUND_PAN_ATTACKER / _TARGET), CONTROLLER_PLAYSE (panned by side; the Oak/Old Man controller's plain PlaySE),
  PLAYFANFARE, the player's PLAYBGM, FAINTINGCRY (PlayCry_ByMode(species, ∓25, CRY_MODE_FAINT) for the player and
  opponent, PlayCry_Normal(species, 25) for Oak/Old Man and Safari), Cmd55's FadeOutMapMusic(5) (Oak/Old Man,
  Safari, and the player's link-only one with its BeginFastPaletteFade), SE_EXP and its m4aSongNumStop when the
  exp bar is full (controllerCommon.ts).
- Waits: Intro_WaitForShinyAnimAndHealthbox (player, opponent) and SwitchIn_HandleSoundAndEnd hold until
  !IsCryPlayingOrClearCrySongs() and then set the BGM volume back to 256 (m4aMPlayContinue in multi battles);
  Task_PlayerController_RestoreBgmAfterCry (exported from controllerPlayer.ts) runs after the Oak/Old Man intro.
- Found on the way: Task_CreateLevelUpVerticalStripes wasn't ported (the player's DestroyExpTask... went straight
  to CompleteOnInactiveTextPrinter): it now runs with its BG move and SE_RS_SHOP; the stripes themselves
  (pokemon_special_anim_scene.c's CreateLevelUpVerticalSpritesTask) are a DEVIATIONS entry. The player's
  PlayerHandleCmd55 had dropped FadeOutMapMusic(5) / BeginFastPaletteFade(3) (link battles only).
- The cries the waits wait on come from gfx.ts (pokeball.c / battle_main.c: W-sound 6a), through W-sound 5a's
  `ui.playCry` pass-through until then. W-sound 5a's pass-through commit was cherry-picked to run the tests and
  reverted before the PR.
- Verified: typecheck; `npm test`; `tests/e2e/audioBattleControllers.test.ts` (4: the wild intro leaves
  Intro_WaitForShinyAnimAndHealthbox only after MEWTWO's send-out cry stops, and fails with the wait taken out; 4
  SE_SELECTs from the menus; SE_FAINT at SOUND_PAN_TARGET and the CRY_MODE_FAINT cry; SE_EXP stopped well before its
  100 frames; the Old Man's SE_SELECTs 64 frames apart and the catch's speed-5 fade), wildBattle, trainerBattle,
  scriptedBattles, battleAnims, newGame (39 passed); the full e2e suite once (below).
- Full e2e suite (with 5a's pass-through cherry-picked, so the send-out cries play; load up to ~300 from another
  worker's run): 411 tests in 64 files, 408 passed, 26.6 min. Failures, none in the controllers: listMenuFlash's
  dark-cave Blur transition (fails on the base commit 2fbcf54 too), battleAnims.2d's Teleport (reads `t.battle()`
  from Node after the anim ended: the battle can be over by then, tests/README.md rule 5) and battleAnims.3e3b's
  Snatch (polls a short-lived sprite from Node; timed out under load; on the rerun Memento timed out instead).
  Tick budgets raised: none.

### W-m4a 4b: the PSG synth, music complete (AUDIO_PLAN.md batch D, unit 2)

- New `src/audio/psgSynth.ts` (`PsgSynth`): the GBA's four PSG channels driven by the engine's register writes
  (W-m4a 4a's PsgFrame): squares with duty, square 1's sweep (overflow check, down / up), the hardware envelope and
  length counters on a 512 Hz frame sequencer, the wave channel (both banks, NR30's bank switch and 64-sample mode,
  the RAM rotating as it plays, NR32's shifts and 75%), noise (15 / 7-bit LFSR, NR43's divisor and shift), restart
  and DAC semantics, NR52, NR50 / NR51 / SOUNDCNT_H's mix into the 10-bit sum (mGBA's GBA scale: a channel at 15 adds
  240). Each output sample is the channels' average over its cycles (a box filter).
- `src/audio/outputCore.ts`: `SoundCircuit` mixes it with the FIFOs as the GBA does: 896 samples a frame (4 per FIFO
  sample), the FIFO samples held back a frame (the PSG writes take effect in VBlank, the DirectSound mix plays the
  frame after), all writes applied in order at the frame's start, `state` loaded on the first frame, after a flush
  and whenever the writes so far don't match it (missed frames). `dacOutput` takes SOUNDBIAS (bias, resolution).
  The worklet plays it at 53,760 Hz through the same resampler; `tests/audioRender.ts` gains `speakers()`,
  `speakerRms()` and a 53,516 Hz `toWav`; `tools/render-audio.ts` prints the RMS with and without the PSG (`nopsg`,
  `mono` flags).
- docs/DEVIATIONS.md: the m4a engine's "PSG silent" entry and the "no PSG parts until W-m4a 4" clauses are gone; a
  PSG synth entry says what it approximates (the box filter at 53.76 kHz, writes at the frame's start, mGBA's choices
  where the documents are open, a stopped channel at 0, mid-song pickup).
- Checked: the PSG-only SEs are heard from the frame they start to the frame before their CgbOscOff (SE_SELECT 0-13,
  SE_DOOR 0-20, SE_EXIT 0-34, SE_PC_ON 0-66, SE_WALL_HIT 0-12, SE_FLEE 0-37); MUS_PALLET's speakers' RMS goes
  0.067 → 0.081 with the PSG (MUS_ROUTE1 0.051 → 0.077); mono is identical on both sides. 60 s of MUS_ROUTE1
  through the circuit takes ~0.8 s in Node.
- Tests: `tests/unit/psgSynth.test.ts` (17: hand-worked duty / box averages / envelope / DAC / length / sweep /
  LFSR / noise clock / wave samples, volumes, banks / mixing / the circuit's timing and resync, then the extracted
  SEs and songs); `tests/e2e/audioOutput.test.ts` + 1 (SE_SELECT alone reaches the worklet's speakers; checked to
  fail with the PSG switched off). Typecheck clean; unit 577 in 42 files; e2e audioOutput 5, audio 2.

### W-sound 7b: the Hall of Fame, the credits, the Pokédex, the bag, the title screen, the main menu, the trainer card

- Recounted against the C (AUDIO_PLAN.md appendix A): hall_of_fame.c + hof_pc.c 14 calls, 0 live before; credits.c
  1 (+ the two gDisableMapMusicChangeOnMapLoad writes, live); pokedex_screen.c 12, 10 live; item_menu.c 37, the 24
  outside Teachy TV's tutorials (not ported) live; item_use.c 7, all live (the bike bell, the Poké Flute's fanfare);
  title_screen.c 7, live but the REVISION 0 berry fix's m4aMPlayAllStop; main_menu.c 3, live but
  Task_MysteryGiftError's (no Mystery Gift); trainer_card.c 7, all live (only the header comment was stale).
- **Hall of Fame** (`menus/hallOfFame.ts`): PlayBGM(MUS_HALL_OF_FAME), SE_SAVE, the cries (PlayCry_Normal, not for
  eggs), SE_APPLAUSE, FadeOutBGM(4). SetWarpsToRollCredits' DoWarp now runs as the C's under the screen's CB2:
  TryFadeOutOldMapMusic (the room plays MUS_SLOW_PALLET, Indigo Plateau MUS_VICTORY_ROAD, so FadeOutMapMusic(4)),
  PlaySE(SE_EXIT) (skipped: MUSIC_DISABLE_KEEP), Task_Teleport2Warp's `!gPaletteFade.active && BGMusicStopped()`
  wait, then the warp; the destination header comes from the new `hofEnv.loadMapHeader` (FieldMenuScene). The Hall
  of Fame PC: StopCryAndClearCrySongs + PlayCry_Normal per mon, IsCryPlayingOrClearCrySongs → StopCryAndClearCrySongs
  + m4aMPlayVolumeControl(BGM, 0x100) on A / B out; ReshowPCMenuAfterHallOfFamePC's Overworld_PlaySpecialMapMusic
  in OverworldScene.openHallOfFamePc (the music never changes there, so it's a no-op in practice).
- **Credits** (`menus/credits.ts`): PlayCry_NormalNoDucking(GetCreditsMonSpecies, 0, CRY_VOLUME_RS,
  CRY_PRIORITY_NORMAL) in the mon scenes. MUS_CREDITS was already live (Indigo Plateau's `playbgm`).
- **Pokédex** (`menus/pokedexScreen.ts`): SetBGMVolume_SuppressHelpSystemReduction(0x80) /
  BGMVolumeMax_EnableHelpSystemReduction. FRLG's Pokédex has no SE_DEX_* sounds (only region_map.c uses them);
  `pokedexArea.ts` has no sound calls in the C.
- **Main menu** (`scenes/MainMenuScene.ts`): the stand-in BattleUi's `playSE` is PlaySE (Oak's speech's ball-open
  particles' SE_BALL_OPEN).
- docs/DEVIATIONS.md: the Hall of Fame, Pokédex, trainer card, credits, title screen and main menu entries lose
  their audio clauses; the Hall of Fame DoWarp approximation now says what's left (the header's load, no
  WarpFadeOutScreen).
- The Hall of Fame's cries don't hold anything in the C (the 120-frame timer runs alongside); the only wait this
  unit adds is DoWarp's BGMusicStopped (a frame: the BGM has faded out under the screen's fade already).
- Tests: typecheck clean, unit 577 in 42 files; new `tests/e2e/audioScenes2.test.ts` (4: the Hall of Fame and the
  credits, the Hall of Fame PC, the Pokédex, the title screen); hallOfFame, pokedex, pokedexArea, titleScreen,
  trainerCard, fieldItems, registeredItems green. Full suite on dc88453 (load from the other workers): 415 e2e in 65
  files, 411 passed, 35 min. Of the four failures, audioScenes2's Hall of Fame test is fixed (it read the ducked BGM
  volume after an awaited `t.until`, past the first cry's duck under load; now recorded tick by tick in one `t.mash`
  predicate); transitions' "every battle transition" (its 120 s timeout), battleAnims.3e3a's Smokescreen and
  battleAnims.2d's Memento were green on rerun: races outside this unit, not fixed. No tick budgets needed raising.

### W-sound 6b: the battle anim engine's sounds (AUDIO_PLAN.md batch D)

- `src/battle/anim/` calls `gba/sound.ts` directly, with the C's arguments; battleAnim.ts's PlaySE12WithPanning
  wrapper (→ BattleScene's no-op `ui.playSE`, pan dropped) is gone, and so are ghost.ts's and special.ts's
  `ui.playSE` stand-ins. battle_anim.c: `playse` (PlaySE), `playsewithpan` / `loopsewithpan` / `waitplaysewithpan`
  / the three `panse` commands (PlaySE12WithPanning with BattleAnimAdjustPanning's / _2's pan), `setpan` and
  Task_PanFromInitialToTarget (SE12PanpotControl; the last step now lands on the target pan, as the C), `stopsound`
  (m4aMPlayStop of SE1 and SE2), Cmd_end and Cmd_waitsound's IsSEPlaying wait (sSoundAnimFramesToWait: up to 90
  frames, then SE1 / SE2 stopped), gMovesWithQuietBGM (read from the anim ROM image: Sing, Perish Song, Grass
  Whistle set the BGM to 128 at launch; Cmd_end sets 256). battle_anim_sound_tasks.c: SoundTask_PlaySE1WithPanning
  / _PlaySE2WithPanning now play on their own player (PlaySE1 / PlaySE2WithPanning, they were both PlaySE12); the
  cries (PlayCry_ByMode with the species and CRY_MODE_HIGH_PITCH / GROWL_1-2 / ROAR_1-2 / ECHO_START-END) and their
  IsCryPlaying waits were already live (W-sound 2). effects3.ts's Encore SE is PlaySE1WithPanning, as in the C.
  battle_anim_special.c: the ball SEs (SE_BALL_THROW panned 0, SE_BALL_OPEN, SE_BALL_TRADE, the four bounces,
  SE_BALL, SE_BALL_CLICK, SE_SHINY panned to the battler's side) and the click's m4aMPlayAllStop +
  PlaySE(MUS_CAUGHT_INTRO). The 27 PlaySE12WithPanning / PlaySE1WithPanning / PlaySE calls in the type files were
  checked against the C: all pass the C's pan (BattleAnimAdjustPanning(...), gAnimCustomPanning, or the task's
  stored pan).
- Waits that now take their GBA length: every anim whose SE outlasts its visuals ends in the frame after the SE's
  last tick (Tackle: SE_M_COMET_PUNCH, 26 frames from its start), up to 90 frames; `waitsound` the same.
- Races fixed on the way (both read something short-lived from Node): battleAnims.2d's Teleport read the
  attacker's sprite after the anim's end, when the battle (ending ~150 ticks later) could already be gone; it now
  reads it in the page in the tick after the end. battleAnims.3e3b's Snatch polled for the attacker's copy
  (up ~40 ticks) from Node and missed it under load; now watched in the page.
- Found on the way: after merging master (W-sound 7a), special.ts uses sound.ts's `m4aMPlayAllStop` (it reports a
  `stop` per live player). The first version of the pan test had the foe use Tackle, which can miss (no anim):
  it uses Shadow Punch now, which never does.
- Tick budgets raised: none (the full suite passed with only the two races above fixed).
- Verified: typecheck; `npm test` (42 files, 577 tests, after merging master); new `tests/e2e/audioBattleAnims.test.ts`
  (4: Tackle's SE pan from the player's side and its anim ending exactly SE_M_COMET_PUNCH's 26 frames after the
  SE's start, Shadow Punch's pans from the opponent's side; Growl's two Rattata cries in CRY_MODE_GROWL_1 / _2 at
  SOUND_PAN_ATTACKER, no cry playing at the anim's end; Perish Song's BGM at volume 32 of 64 from its launch to its
  end, 64 after; a Master Ball's twelve SEs in order and MUS_CAUGHT_INTRO with the BGM and SE1 stopped); every
  battleAnims*.test.ts and wildBattle.test.ts; **the full e2e suite once (before merging master): 64 files, 411
  tests, all passed, 26 min**; after the merge audioBattleAnims (twice), battleAnims, wildBattle, audio.

### W-sound 6a: pokeball.c's, battle_gfx_sfx_util.c's and battle_interface.c's sounds (AUDIO_PLAN.md batch D, unit 5)

- **Send-out cries** (`battle/gfx.ts`, pokeball.c): SpriteCB_ReleaseMonFromBall starts Task_PlayCryWhenReleasedFromBall
  (pan 25 for the opponent's side, -25 for the player's; CRY_MODE_NORMAL, or CRY_MODE_WEAK when
  ShouldPlayNormalMonCry says no) in the task's fifth run after the ball opens. In a double battle's intro the left mons' cries
  are PlayCry_ReleaseDouble(CRY_MODE_DOUBLES / _WEAK_DOUBLES) after StopCryAndClearCrySongs, the right ones' wait 6
  frames, then for !IsCryPlayingOrClearCrySongs, then 3 more, and play CRY_MODE_NORMAL / _WEAK; the left ones also set
  the BGM to volume 128 (a multi battle stops it). The task keeps the mon as its side and party index where the C
  keeps its pointer in data[3..4]. pokeball.c's unused throw path (DoPokeballSendOutAnimation with a throw case other
  than the two send-outs: SpriteCB_BallThrow*, SE_BALL_THROW, the bounces, SE_BALL, MUS_CAUGHT_INTRO) has no caller in
  the C and stays unported; the real ball throw's sounds are battle_anim_special.c's (W-sound 6b).
- **The wild mon's cry** (battle_main.c's SpriteCB_MoveWildMonToRight, in gfx.ts): PlayCry_Normal(species, 25).
- **The low HP beep** (battle_gfx_sfx_util.c): HandleLowHpMusicChange plays SE_LOW_HEALTH (a looping song on SE3)
  when a player's mon drops into the red, unless its partner already beeps, and m4aSongNumStop's it when the mon
  leaves the red (in a double battle once neither is); BattleStopLowHpSound; HandleBattleLowHpMusicChange (new),
  called by party_menu.c's Task_DisplayHPRestoredMessage (`menus/partyMenu.ts`). IsBattleSEPlaying (new): the
  controllers' wait for an SE before a move / status anim, 30 calls at most, then m4aMPlayStop of SE1 and SE2.
- **The ball trays** (`battle/battleInterface.ts`, battle_interface.c): PlaySE12WithPanning(SE_BALL_TRAY_ENTER, 0)
  and each ball's PlaySE1WithPanning(SE_BALL_TRAY_BALL) / PlaySE2WithPanning(SE_BALL_TRAY_EXIT) at
  SOUND_PAN_ATTACKER (the opponent's) / SOUND_PAN_TARGET, replacing `ui.playSE`. gfx.ts and battleInterface.ts no
  longer use BattleUi.

### W-ref 2: the port's audio against the ROM (AUDIO_PLAN.md batch D, unit 10)

- Exact check on the rev 1 ROM in mGBA (GDB stub, W-ref 1's freeze and start; scripts in `wref-scratch/wref2/`,
  method in docs/DEV_NOTES.md "ROM reference measurements"): per frame, the DirectSound slot m4a mixed, the four
  CgbChannel structs, SoundInfo's header and the sound registers as mGBA reads them back (incl. NR52's channel-on
  bits against the port's synth), for 31 items (6 BGMs 900 frames each, MUS_PALLET mono, 2 fanfares, 13 SEs incl.
  the six PSG-only ones and 4 battle anim SEs, 9 cries in NORMAL / FAINT / ENCOUNTER / GROWL_1 / ECHO_START and
  mono), against the port's engine run headless on the same job list: **identical in every frame** (~9,100 frames).
  A one-frame shift was checked to show up in every field.
- Listening: real mGBA audio can't be recorded headless with what's installed (the Qt app records from its GUI
  only), so the reference is the ROM's FIFO bytes plus an independent model of mGBA's PSG C, driven by the port's
  register writes. Results table in AUDIO_PLAN.md section 6 "W-ref"; the A/B page with the WAVs is
  `wref-scratch/wref2/index.html`. Cries and DirectSound SEs within 0.01-0.2 dB, envelope r ≥ 0.97; PSG SEs
  within 0.5 dB, r ≥ 0.996; BGMs within 0.2 dB overall.
- Fixed: the PSG synth averaged each output sample over its cycles (a box filter), which cancels fast noise
  (NR43 0x00: a 524 kHz LFSR clock): SE_FLEE's noise frames were ~10 dB down (the SE −1.6 dB, envelope r 0.947).
  SoundCircuit now has the synth point-sample the PSG every 256 cycles (65,536 Hz, SOUNDBIAS's resolution, as the
  GBA's DAC and mGBA) and hold it, averaged to the output's samples (`PsgSynth.dacInterval`; 0 keeps the box for
  the hand-worked tests): SE_FLEE −0.5 dB, r 0.996; SE_EXIT r 0.989 → 0.997. CPU: +~15% for the synth.
- Left (AUDIO_PLAN.md): the BGMs' per-frame envelope wanders ±2 dB around the reference (r 0.86-0.95; not the
  squares' duty phase, tried), MUS_VS_WILD / MUS_VS_TRAINER 10-14% darker; the writes land 0.8 ms early in the frame
  (docs/DEVIATIONS.md). Next: split the audio comparison per PSG channel.
- Tests: `tests/unit/psgSynth.test.ts` + 1 (fast noise through the DAC: every sample 0 or 15, held per tick, against
  the box's cancelled average); the circuit tests skip each frame's first sample (it can hold the previous frame's
  last DAC tick) and get 30 s timeouts (they're CPU-heavy; the machine's load ran them past 5 s). Typecheck clean;
  unit 578 in 42 files; e2e audio, audioOutput, audioCries, audioScenes 13 passed.
- 5a's TODOs: BattleStopLowHpSound before the victory music in `battle/main.ts` (HandleEndTurn_BattleWon) and
  `battle/bsCommands2.ts` (getexp's MUS_VICTORY_WILD). Left for the controllers' owner (W-sound 5b / 8): their
  IsBattleSEPlaying calls and PlayerHandleCmd23's BattleStopLowHpSound (docs/DEVIATIONS.md).
- Tests: typecheck clean; unit 580 (m4a.test's "every song ends" and scriptCoverage timed out once at load ~100,
  green on rerun); new `tests/e2e/audioBattleBalls.test.ts` (7: wild and send-out cries with pan / mode, a weak cry,
  the trainer's and player's trays, the beep starting on a hit and at a send-out and stopping on a Potion, a switch
  and the victory music, a double battle's intro cries and BGM volume on Victory Road 3F), audioBattle 6, wildBattle,
  trainerBattle, battleAnims, berryPouch, scriptedBattles green. The full suite wasn't run (the lock was held; the
  coordinator runs it at the end of the batch), so no tick budgets were raised.
- After merging master with W-sound 5a (#104: the controllers' cries are real): audioBattleAnims' Growl test counts
  only the CRY_MODE_GROWL_1 / _2 cries (the send-out and intro cries come first now), and its Perish Song test
  waits for the intro cry's BGM ducking to end before its mark. battleAnims.2d's Memento polled for the shadow
  from Node, importing gba/hw.ts on every poll (600 of them past the 120 s test timeout under load): the module is
  now loaded once and the shadow watched in the page.

### W-ref 2b: W-ref 2's leftovers were the comparison's (AUDIO_PLAN.md batch D, W-ref 2's continuation)

- Split W-ref 2's listening comparison per PSG channel (NR51 masked in both renders, the FIFOs silent) and then
  tick by tick (each channel's level at every DAC tick, port vs model). Findings: (1) the ±2 dB per-frame wander
  of the BGMs is interference between the squares and the DirectSound voices playing related pitches, whose
  relative phase three things moved: the frame sequencer's phase (W-ref 2's `port_capture.ts` ran one circuit
  through all the jobs, so each job inherited the last one's; the model started each at 0), mGBA's shortcuts
  (a square's new frequency from lastUpdate + the new period, a stopped channel holding its level, NR32 jumping to
  the next nibble, the noise at its last clock's volume, NR34 restarting the wave's timer) and the 0.8 ms write
  offset; each alone gives r ≈ 0.9. (2) "10-14% darker" was the reference's rate: its 65,536 Hz point samples were
  analysed as they are, the port's 53,516 Hz samples average the DAC's held signal (a box, −2 dB at 20 kHz), which
  takes the most off the noise drums; through the same averaging the two are as bright, and the noise is identical
  tick by tick.
- Fixed in the port (one commit each, a unit test each): the wave channel's first sample after a restart comes
  24 cycles after a period (mGBA's GBAudioWriteNR34, SameBoy's 3 ticks of the 2 MHz clock); through the DAC, the
  frame sequencer's steps land on their own cycle, not on the next output sample's boundary (up to 313 cycles
  late: an envelope step one tick late now and then).
- Comparison made like for like (scripts in `wref-scratch/wref2/` and `wref2b/`, DEV_NOTES "ROM reference
  measurements"): each job's WAV from a circuit reset at the job, the model's sequencer starting 32,768 cycles in
  as the port's, a second reference with mGBA's shortcuts swapped for the documented hardware and the port's write
  timing (the port equals it at every DAC tick), the references put through the port's output stage. Against
  that: r ≥ 0.9998 and within 0.05 dB on every item (SE_M_SCRATCH +0.37 dB, a FIFO-only SE: the FIFO's tick
  jitter in the reference), residual −32 to −54 dB on the PSG-only SEs. Against mGBA as is the music stays at
  r 0.86-0.99 (the interference again), and SE_SAVE's level depends on the sequencer's phase (−1.04 dB here,
  +0.12 dB at W-ref 2's): nothing readable gives the ROM's. Results table in AUDIO_PLAN.md "W-ref"; the page
  (`wref2/index.html`) has both references and W-ref 2's numbers. The exact per-frame check is still identical on
  all 31 items.
- Left: the writes' 0.8 ms offset within the frame; the FIFO's samples step exactly every 1,254 cycles where the
  GBA's DAC takes them at its 65,536 Hz ticks (≤ 15 µs); the output rate's box (docs/DEVIATIONS.md).
- Tests: `tests/unit/psgSynth.test.ts` + 2 (the wave restart's delay; a sequencer step inside an output sample
  through the DAC, checked to fail before the fix). Typecheck clean; unit 580 in 42 files; e2e audioOutput +
  audio 7 passed.

### W-sound 8: the sweep (AUDIO_PLAN.md batch D, unit 9)

- Ambient cries (overworld.c: ChooseAmbientCrySpecies, UpdateAmbientCry, PlayAmbientCry; field_tasks.c's
  Task_RunTimeBasedEvents) in `gba/overworldMusic.ts`, with `WildEncounters.getLocalWildMon` (GetLocalWildMon) and
  two new OverworldMusicHost members. ChooseAmbientCrySpecies runs on every map load (before the roamer moves) and in
  CONTINUE's Overworld_ResetStateOnContinue, so a map with a wild header now rolls Random() once or twice on load, as
  on the GBA; the task's state lives in OverworldScene (zeroed on map loads and in resumeMap) and ticks after the
  field tasks while the field is free. No seeded e2e outcome changed (the full suite below).
- Battle controllers: the player's and the opponent's MOVEANIMATION / STATUSICONUPDATE / STATUSANIMATION /
  BATTLEANIMATION handlers hold while IsBattleSEPlaying (up to 30 calls, then SE1 / SE2 stop), PlayerHandleCmd23
  calls BattleStopLowHpSound.
- BattleUi's `playSE / playCry / playBGM / playFanfare` deleted (decision 21), with BattleScene's pass-throughs and
  the MainMenuScene / tradeScene stand-ins' hooks.
- Stale, removed from docs/DEVIATIONS.md (their screens already made the C's calls, checked by grep against the C):
  Lt. Surge's trash cans and Bill's cell separator (script `playse`), Easy Chat, the TM case, the berry pouch, the
  Safari Zone entrance (script `playfanfare`), the Storage System, the Player's PC, Oak's speech, the Poké Mart's
  SE_SHOP, Dive's SE_M_DIVE. Stale src comments: namingScreen.ts (PlaySE "silent"), seagallop.ts (now names field
  weather as deferred), OverworldScene's ChooseAmbientCrySpecies note.
- Races: battleAnims.3e3a's Smokescreen polled the smoke cloud's four sprites from Node, which could come after the
  cloud was gone under load; now watched in the page. Found by the full suite: battleAnims.2c's Zap Cannon row timed out
  at 120 s (Zap Cannon's 50% accuracy, each miss a retried turn, misses vary run to run as expectMovesRun documents);
  its rows get 300 s.
- AUDIO_PLAN.md: "Batch D result" lists what stays deferred.
- Tests: typecheck clean; unit 583 in 43 files (overworldMusic + the ambient cries' rolls against an independent
  LCG); new `tests/e2e/audioSweep.test.ts` (4: Route 1's ambient cries and their spacing, none indoors, the trash
  can's SE_PIN, PSYCHIC's anim held behind a long SE until IsBattleSEPlaying stops it); the battle files (60) green.
  Full suite on the branch: 440 e2e in 70 files, 439 passed, 25 min; the one failure (2c's Zap Cannon timeout) is
  fixed above and the file passes (7).

### Audio batch D merged (AUDIO_PLAN.md complete; PRs #100-#111)

- Merged, in order: #100 (the plan: batch D split into ten smaller units, decisions 20-22), #101 W-m4a 4a, #102
  W-sound 7a, #103 W-m4a 4b, #106 W-ref 2, #104 W-sound 5a, #109 W-ref 2b, #108 W-sound 5b, #105 W-sound 6b, #107
  W-sound 6a, #110 W-sound 7b, #111 W-sound 8. AUDIO_PLAN.md is marked complete; STATUS "Next up" points at the
  postgame.
- Conflict resolutions: only the docs (merge=union). DEVIATIONS' "Battles" entry came out of each battle merge as
  two or three overlapping entries and was rewritten into one each time; union also restored lines a side had
  removed (the trade and evolution entries' "no PSG parts until W-m4a 4", "Battle transitions: no SE_MUGSHOT")
  and put DEV_NOTES' renamed "Scene sounds (W-sound 7a, 7b)" heading on the wrong section twice: all tidied.
- Races and test fixes found while merging: audioOutput's tone test asserted the worklet's `dropped` frames (a host
  stall under load drops some: tests/README.md rule 9 added); transitions' "every battle transition" (17 page
  loads) got a 600 s test timeout; listMenuFlash's Flash circle and dark-cave transition are watched in the page
  (Node polls missed them under load); audioBattle compares MUS_VS_WILD with the transition by frame (MapMusicMain
  starts the song at the frame's end, so a hook-started battle's transition can come first in the tick);
  audioBattleAnims (Growl's cries, Perish Song's mark) and audioBattleBalls (send-out cries without the faint
  cries) filter out the other units' now-real cries; battleAnims.2d's Memento watched in the page (by W-sound 6b).
- Test runs: per merge typecheck, unit and the touched e2e files; the full suite for #104 (417 in 65 files, all
  passed), on master after #110 (436 in 69 files, all passed, 26 min) and at the end on master 1bde692:
  typecheck clean, unit 583 in 43 files, e2e 440 in 70 files, all passed, 22 min. The workers' own full runs are
  in their entries.

### Workflow: the full e2e suite runs once per batch

- The user asked to stop running the e2e suite for every small change: audio batch D's workers ran 60-110 minutes,
  much of it running or queueing for full suites (~20 min each) under load.
- CLAUDE.md, docs/WORKFLOW.md (worker prompt, worker rules, merger) and the get-on skill now say: workers run
  typecheck, unit tests and their own named e2e files, never the full suite; each merge runs typecheck, unit tests
  and the PR's own e2e files; the full suite runs exactly once per batch, at the end on master, and failures there
  are rerun file by file. Docs-only changes run nothing.
- Verified: docs only.

### W-sevii 1: back to One Island, Kindle Road, Mt. Ember, the Ruby (POSTGAME_PLAN.md batch 10)

- Braille: `tools/extract.py` extracts FONT_BRAILLE beside the latin fonts (`braille_font`: graphics/fonts/braille.png
  as a glyph mask, 16x16 cells as DecompressGlyph_Braille reads the .fwjpnfont, every glyph GetGlyphWidth_Braille's
  16 px, `fixedWidth` in fonts.json, gFontInfos[FONT_BRAILLE]: line spacing 2, dark gray on white) and the
  `.braille` strings of data/text/braille.inc (`braille_encoding` / `encode_braille`: preproc's
  AsmFile::ReadBraille table with BRAILLE_CHAR_* from include/characters.h, written to strings.json as byte tokens,
  `{0x01 0x05 0x03}$`, so Charmap.encode gives the ROM's bytes). `text/Font.ts` FONT_BRAILLE (6) and fixed widths;
  `text/stringWidth.ts` skips the Japanese letter spacing for braille (`fontId != FONT_BRAILLE && isJapanese`);
  TextPrinter draws braille glyphs whatever {FONT} says (FontFunc_Braille).
- Script commands (`script/ScriptEngine.ts`): `braillemessage` (ScrCmd_braillemessage: the dialogue frame, printed
  at once in FONT_BRAILLE through MessageBox.show's font), `getbraillestringwidth` (VAR_0x8004 = GetStringWidth).
  `script/postgameSpecials.ts` (POSTGAME_SPECIALS, new): BrailleCursorToggle with text.c's text cursor on the field
  (CreateTextCursorSprite's (x + 3, y + 4), SpriteCB_TextCursor's bob by a field task, DestroyTextCursorSprite), so
  the `braillemessage_wait` macro (EventScript_BrailleCursorWaitButton) works. Three gaps off scriptCoverageGaps.ts.
- Played headless (`tests/e2e/postgame.test.ts`, helpers in `tests/e2e/postgameHelpers.ts`: `afterHallOfFame`,
  `fillPokedex`, `scriptsSince`, `battlesSince`): Pallet Town's OakRatingScene → the lab's National Dex scene;
  Three Island's harbor → One Island (MULTICHOICE_SEAGALLOP_V12); Celio's Ruby request; One Island → Kindle Road
  over the connection; Abigail by sight and Mik & Kia's double battle; the Ember Spa (HM06, the hot spring's heal);
  Mt. Ember's password scene, both grunts and the open cave; the Ruby Path B4F / B5F braille (the bytes, each
  braillemessage_wait's width and cursor); the Ruby; Moltres's battle on the summit, won; GiveCelioRuby → the
  Rainbow Pass. Kindle Road and Mt. Ember ran without changes.
- Fix found on the way: `waitbuttonpress` now waits from the frame after it was set up (SetupNativeScript): the A
  that let one wait through could pass the next one in the same frame, so one press went through all eight of
  B5F's messages (braille prints at once). DEVIATIONS' native-wait note updated.
- Verified: typecheck; unit 589 (6 new in tests/unit/braille.test.ts: the font info and widths, the encoded strings,
  GetStringWidth, the commands through the engine, the cursor's position and bob); e2e postgame.test.ts, plus
  field, audioCries, seviiQuest and sideEvents (waitbuttonpress), all passed.

### W-ttower 1: the Trainer Tower's data and the tower without battles (POSTGAME_PLAN.md batch 10)

- Data: `tools/extract_trainer_tower.py` (in `npm run extract`) → `public/gen/trainerTower.json`: every
  sTrainerTowerFloor_* of trainer_tower_sets.c (a small C initializer parser; DUMMY_TOWER_TEAM / DUMMY_TOWER_MON and
  easy_chat.h's EC_MOVE / EC_MOVE2 expanded from their #defines), gTrainerTowerLocalHeader, gTrainerTowerFloors as
  floor symbols, and trainer_tower.c's tables (sSingle/DoubleBattleTrainerInfo, sTrainerEncounterMusicLUT,
  sFloorLayouts, sPrizeList, sTrainerTowerEncounterMusic, the mon index tables) plus trainer_class_lookups.h's
  gFacilityClassToTrainerClass / gFacilityClassToPicIndex (the #else side of its `#ifdef BUGFIX`).
- Scripts: the `ttower_*` macros (asm/macros/trainer_tower.inc) are expanded by the script extractor like the
  assembler does (`setvar VAR_0x8004, TRAINER_TOWER_FUNC_*` + `special CallTrainerTowerFunc`); asm_condition gained
  `&&` / `||` and `>= <= > <` for ttower_getspeech's `.if \trainer >= VARS_START && \trainer != 0xFF`. The rest of
  scripts.json is unchanged (checked against the old file).
- `world/trainerTower.ts` is trainer_tower.c without the battle: CallTrainerTowerFunc and every sTrainerTowerFunctions
  entry; DoTrainerTowerBattle is a stand-in (reports `trainerTowerBattle`, VAR_RESULT B_OUTCOME_WON, map music back),
  ShowResultsBoard / CloseResultsBoard (no script uses them) don't draw. `script/trainerTowerSpecials.ts` registers the
  special (TRAINER_TOWER_SPECIALS). The record is `state/trainerTowerRecord.ts` (struct TrainerTower,
  ResetTrainerTowerResults in the GameState constructor); GameState gained `towerChallengeId`, `trainerTower` and
  `mapHeaderLayoutId` (gMapHeader.mapLayoutId, which the tower reads; set on every map load).
- The timer: gMain.vblankCounter1 (gba/main.ts SetVBlankCounter1Ptr / DisableVBlankCounter1 /
  VBlankCounter1Update), counted next to the play time in OverworldScene.tick and GbaHostScene's loop; softReset
  clears it (InitMainCallbacks).
- Save version 8 (W-weather took 7 first; master merged into the branch): `trainerTower: { challengeId, records }`;
  a version-7 save loads with the new-game records.
- Fixes on the way: `msgbox gStringVar4` printed nothing (ScriptEngine's stringFor didn't know gStringVar4; also
  SevenIsland_House_Room2's); the white-out during a challenge now keeps VAR_MAP_SCENE_TRAINER_TOWER when the owner
  was reached (SetWhiteoutRespawnWarpAndHealerNpc), the old DEVIATIONS line is gone.
- Coverage gaps: the 16 `ttower_*` commands and CallTrainerTowerFunc are off the list (the macros no longer reach the
  scripts as ops; the battle stand-in is in DEVIATIONS); 22 postgame gaps left.
- Verified: typecheck; unit 601 in 44 files (tests/unit/trainerTower.test.ts: the data, PRINT_TOWER_TIME, start / floors
  cleared / status / owner / prize / final time / resume timer, the floors' layouts and graphics for each type,
  speeches and text colour, the 2x3 \l layout, the stand-in; saveData.test.ts: the record round-trips, version 7
  loads); e2e tests/e2e/trainerTower.test.ts (4: a Single challenge from the receptionist to 1F's trainer, his intro
  and after speeches, the stand-in battle, the floor cleared, the timer exactly 60 per 60 ticks and the clock; a
  Double challenge's 1F_DOUBLES layout and twins; a loss ending the challenge in the lobby and leaving the tower;
  a white-out during a challenge) and saveContinue.test.ts, all passed.

### The event tickets, Navel Rock, Birth Island (W-events unit 1, batch 10)

- The tickets: `GiveEventTickets` (menus/hallOfFame.ts), EnterHallOfFame's `#if REVISION >= 0xA` block: the Aurora
  and Mystic Tickets with FLAG_ENABLE_SHIP_BIRTH_ISLAND / _NAVEL_ROCK and FLAG_RECEIVED_*_TICKET while the bag has no
  Aurora Ticket (no ribbons in the port, so the Champion Ribbon condition counts as met). A deliberate QOL change
  (POSTGAME_PLAN.md decision 2), in DEVIATIONS' own section; the "REVISION 0 gives no tickets" notes are gone.
- `script/eventIslandSpecials.ts` (EVENT_ISLAND_SPECIALS): ShakeScreen / Task_ShakeScreen / Task_EndScreenShake
  (shared: W-sevii's Dotted Hole and Tanoby Key use it next batch), LoopWingFlapSound / Task_WingFlapSound,
  DoDeoxysTriangleInteraction (Task_DoDeoxysTriangleInteraction, MoveDeoxysObject, Task_WaitDeoxysFieldEffect),
  SetDeoxysTrianglePalette, and IncrementBirthIslandRockStepCount, which nothing called yet (the step caps need it:
  now in OverworldScene's tookStep).
- The camera pan has a horizontal half now: `setCameraPanning(dy, dx = 0)` (ScriptHost, OverworldScene: the follow
  offset's x), `field().avatar.cameraPanX`. The elevator, fall warp and Deoxys rock use the same call.
- `world/deoxysRock.ts`: the triangle's palette (sDeoxysObjectPals through extract_gfx.py's new
  graphics/field_specials/ prefix; colours 0-3 over gObjectEventPal_Meteorite, the rock redrawn into a canvas texture),
  FLDEFF_MOVE_DEOXYS_ROCK (not ported before: FldEff_MoveDeoxysRock, Task_MoveDeoxysRock_Step; ObjectEvent gained
  shiftObjectEventCoords / shiftStillObjectEventCoords / setSpriteOffset) and FLDEFF_DESTROY_DEOXYS_ROCK
  (Task_DestroyDeoxysRock's three states with Task_DeoxysRockCameraShake in the same field task, in priority order,
  the white flash, the four fragments from sRockFragment_* at screen coordinates). Five gaps off
  scriptCoverageGaps.ts (ShakeScreen, LoopWingFlapSound, DoDeoxysTriangleInteraction, SetDeoxysTrianglePalette,
  FLDEFF_DESTROY_DEOXYS_ROCK).
- Found on the way: Vermilion's ticket texts are `msgbox`es that wait for a button at their end, which
  seagallopHelpers' `waitForMenu` (it presses only at page breaks) doesn't pass: the test mashes to the ferry question
  first. seagallop.test.ts' comment no longer says the tickets aren't ported.
- Left: Navel Rock's summit's `setweather 0` / `doweather` (W-weather) log once; the flash is the fade overlay over
  the objects too (DEVIATIONS).
- Verified: typecheck; `npm test` (583 in 43 files); e2e `tests/e2e/eventIslands.test.ts` (5: the Hall of Fame's
  tickets and not twice; Vermilion's MULTICHOICE_SEVII_NAVEL_BIRTH, both texts, HI-SPEED 10 to Navel Rock, back, 12
  to Birth Island; Lugia's two shakes tick by tick ([-3, -3, 3, 3, -3, -3] each, two SE_M_STRENGTH) and LUGIA 70;
  Ho-Oh's six wing flaps 34 / 35 frames apart and HO_OH 70; the triangle: a failed corner back to the start
  (SE_M_CONFUSE_RAY), ten corners within their caps with the palette and position each time, the shake (±4 dying
  down), the fragments 32 / 24 px apart in their first frame, SE_THUNDER2 then SE_THUNDER, the rock's flag, DEOXYS
  30), plus hallOfFame, listMenuFlash (the elevator's shake) and sideSpecials (the fall warp's shake) for the shared
  code.

### W-weather 1: field weather's framework and Shade (POSTGAME_PLAN.md batch 10)

- `world/weather.ts`: field_weather.c's state (gWeatherPtr), StartWeather, SetNextWeather /
  SetCurrentAndNextWeather, Task_WeatherInit / Task_WeatherMain with sWeatherPalStateFuncs (UpdateWeatherGammaShift,
  FadeInScreenWithWeather / FadeInScreen_RainShowShade), BuildGammaShiftTables (the C's u16 loops), ApplyGammaShift,
  FadeScreen's weather half, IsWeatherNotFadingIn & co.; field_weather_util.c's saved weather (SetSavedWeather,
  SetSavedWeatherFromCurrMapHeader, DoCurrentWeather, ResumePausedWeather, TranslateWeatherNum, UpdateRainCounter);
  None, Sunny (no visible effect: gamma 0) and Shade (gamma index 3, 20 frames a step). Fog and the unused weathers
  run as NONE and log once (fog is unit 2).
- `public/gen/weather.json` (tools/extract_field.py `extract_weather`): sBasePaletteGammaTypes, sWeatherFuncs' row
  names, the loadfadedpal field effect palette tags. Rerun `npm run extract` (or just that function).
- The field: tilesetVram keeps the unfaded BG palettes beside the shown ones (`loadBgPaletteFaded`,
  `bgPaletteUnfaded`); `world/weatherTextures.ts` redraws the field's sprite sheets through the shift (the object
  sheets GAMMA_ALT, which rows 0-2 leave alone, reflections and loadfadedpal field effects GAMMA_NORMAL);
  `ScreenFade.weather` lets the weather fade the screen in (the shade's 16 frames). OverworldScene calls the weather
  where overworld.c does (LoadMapFromWarp / LoadMapFromCameraTransition / ResumeMap), and ticks the task.
- Save version 7: `weather` (gSaveBlock1Ptr->weather); version-6 saves load with WEATHER_NONE.
- Script commands `setweather`, `doweather`, `resetweather`; `setweather` and `doweather` are off the gap list.
- Stale "no field weather" notes in docs/DEVIATIONS.md reworded (the rain stopping sound stays out: decision 1);
  "weather tints are ignored" on the battle transitions' copy of the field and on reflections removed.
- Verified: typecheck; unit 590 passed, with tests/unit/weather.test.ts (gamma tables against the C's arithmetic by hand, the
  shade's fade in, doweather's steps both ways, the saved weather, an unported weather); e2e
  tests/e2e/weather.test.ts (Viridian Forest through the gate: a BG atlas pixel and the tall grass sheet at the
  shade's colours, the player's sheet unchanged, the 16-frame weather fade, back out lit; the Monean Chamber dark
  through EventScript_TryDarkenRuins and lit with FLAG_SYS_UNLOCKED_TANOBY_RUINS; Navel Rock's Ho-Oh scene lifting
  the shade 3, 2, 1, 0 a frame apart; the weather surviving save + CONTINUE), plus leagueLighting, saveContinue,
  fieldEffects and transitions (19 passed). A screenshot of Viridian Forest shows the shaded map with the tall grass
  sprite matching it.

### W-sevii 3: Six Island, the Dotted Hole and the Sapphire (POSTGAME_PLAN.md batch 11)

- Movement actions (`script/MovementRunner.ts`): `disable_anim` / `restore_anim` (MovementAction_DisableAnimation /
  _RestoreAnimation: ObjectEvent.inanimate on, then back to the graphics info's), so the Sapphire room's thief
  slides down from (5, 0) on his standing frame. Off scriptCoverageGaps.ts.
- pokemon_size_record.c is its own module, `script/pokemonSizeRecord.ts` (moved out of miscSpecials.ts, which keeps
  the Magikarp specials): sBigMonSizeTable, GetMonSizeHash, GetMonSize, FormatMonSizeRecord (inches),
  CompareMonSize, GetMonSizeRecordInfo, and the Heracross specials CompareHeracrossSize / GetHeracrossSizeRecordInfo
  on VAR_HERACROSS_SIZE_RECORD, registered in POSTGAME_SPECIALS. Off scriptCoverageGaps.ts (3 postgame gaps left
  with W-sevii 2 and W-ttower 2 merged: SampleResortGorgeousMonAndReward, SetPostgameFlags, ShowBattleRecords).
- Played headless (`tests/e2e/postgameSixIsland.test.ts`, from afterHallOfFame + the Rainbow Pass state): Six
  Island's Pokémon Center rival scene (MUS_ENCOUNTER_RIVAL, VAR_MAP_SCENE_SIX_ISLAND_POKEMON_CENTER_1F and
  VAR_MAP_SCENE_FOUR_ISLAND 1, the rival removed, not again); Ruin Valley's scientist in front of the door (until
  Icefall Cave's FLAG_HIDE_RUIN_VALLEY_SCIENTIST), the door's YES and braille CUT, Cut from the party menu
  (CutMoveRuinValleyCheck / CutMoveOpenDottedHoleDoor: the open metatile, SE_BANG, the flag; OnLoad keeps it
  open); the Dotted Hole's 1F (setworldmapflag), its holes floor by floor with each braille (UP, LEFT, RIGHT,
  DOWN) and a wrong hole back to 1F; the Sapphire room's sixteen wall braille messages; the Sapphire scene watched
  every tick (the thief's frames through the fall, ShakeScreen's 33 frames of ±3 px vertical pan, SE_FALL /
  SE_M_STRENGTH x2 / SE_EXIT, the Sapphire removed, FLAG_LEARNED_YES_NAH_CHANSEY, the player looking after him);
  the Heracross record (the blank chart, no Heracross, a first record and its Nest Ball, a bigger one, a smaller
  one and the same one, the chart's record). The sweep: all 29 trainers of Pattern Bush, Green Path, Outcast
  Island, the Water Path and Ruin Valley (the double battles Ava & Geb and Miu & Mia), the 6 item balls and 6
  hidden items, Pattern Bush's two escape warps, the Water Path house's man. Nothing in them was wrong.
- Verified: typecheck; unit 625 with master merged (tests/unit/pokemonSizeRecord.test.ts: the hash and sizes moved from
  miscSpecials.test.ts, and the Heracross specials through POSTGAME_SPECIALS); e2e postgameSixIsland.test.ts (4)
  and sideSpecials.test.ts (the Magikarp record on the moved code), postgameSixIsland.test.ts again after merging
  master (4 passed, ~6 min: the sweep's 29 battles are most of it).

### W-ttower 2: the Trainer Tower's battles (POSTGAME_PLAN.md batch 10)

- `world/trainerTower.ts`: unit 1's DoTrainerTowerBattle stand-in replaced by the C's: gBattleTypeFlags TRAINER |
  TRAINER_TOWER (| DOUBLE on a doubles floor), gTrainerBattleOpponent_A 0, BuildEnemyParty (the mon tables indexed by
  floors cleared; each floor mon copied before its level is set, the floors being the loaded JSON), GetPartyMaxLevel,
  CreateBattleTowerMon (pokemon.c: CreateMon with IVs 0, the preset personality and OT id, no Random() call, then
  moves, PP bonuses, item, nickname, friendship, EVs, ability bit, IVs, CalculateMonStats),
  BattleSetup_GetBattleTowerBattleTransition (the foes are at the party's top level, so it is always the big Poké
  Ball), Task_DoTrainerTowerBattle / CB2_EndTrainerTowerBattle (`env.startTowerBattle`: back to the field whatever
  the outcome, no white-out; PlayMapChosenOrBattleBGM(0)), and the battle's side: InitTrainerTowerBattleStruct /
  FreeTrainerTowerBattleStruct (sTrainerTowerOpponent; the timer counts on during the battle),
  GetTrainerTowerOpponentClass / Name / WinText / LoseText (both trainers on a doubles floor), GetTrainerTowerTrainerFrontSpriteId.
- `src/battle/`: AllocateBattleResources / FreeBattleResources call the tower's struct functions (main.ts);
  battle/message.ts's trainer class, name, win / lose texts and B_TXT_TRAINER2_LOSE_TEXT / _WIN_TEXT for the tower;
  controllerOpponent.ts's trainer pic. The other BATTLE_TYPE_TRAINER_TOWER checks the decomp has (getexp, Thief,
  Trick, the AI's flags and items, the terrain, HandleEndTurn_BattleWon / FinishBattle, CreateNPCTrainerParty) were
  already ported. `scenes/BattleScene.ts` loads the tower trainer's pic with the battle's graphics.
- Shared: `host.startScriptedBattle` takes `battleStartTask` (false for the tower's own task: no FldEffPoison wait,
  no ClearPoisonStepCounter / RestartWildEncounterImmunitySteps), ScriptEngine.ts's ScriptHost and OverworldScene.
- The test event `trainerTowerBattle` is gone (the battle's own `battleStart` / `battleEnd` report it). Stand-in
  removed from docs/DEVIATIONS.md.
- Verified: typecheck; unit 610 passed (tests/unit/trainerTower.test.ts: BuildEnemyParty for each challenge type
  against the decomp's tables, the data left alone, a Lv50 FERALIGATR's stats against the stat formula by hand, the
  transition, InitTrainerTowerBattleStruct's class / name / pic / both trainers' texts); e2e
  tests/e2e/trainerTower.test.ts (a Single floor won: SAILOR ALBERTO, his pic, FERALIGATR and KANGASKHAN at the
  party's Lv70 with a Lv5 RATTATA along, the lose text after "Player defeated"; the doubles on 1F (TWINS JEN & KIRA)
  and 2F (CRUSH KIN JO & HALEY: both lose texts in order, sDoubleBattleChallengeMonIdxs[1]); a Knockout floor's three
  battles; a loss: the win text, no white-out, healed, the receptionist ends the challenge), plus trainerBattle and
  scriptedBattles. Found on the way: the "Will you change POKéMON?" prompt between a single trainer's two mons eats
  the mash's A (the test sets the SET battle style).

### W-sevii 2: Four Island and Icefall Cave (POSTGAME_PLAN.md batch 10)

- `world/fieldTasks.ts` (new): field_tasks.c's per-step callback task. SetUpFieldTasks (a fresh STEP_CB_DUMMY task
  where ResumeMap makes one: OverworldScene's `onMapLoaded` on a warp before ON_RESUME, `resumeMap()`),
  ActivatePerStepCallback, Task_RunPerStepCallback (once a frame from `tickField`, beside the ambient cries),
  sPerStepCallbacks with IcefallCaveIcePerStepCallback (thin ice cracks 5 frames after the step onto it, cracked ice
  breaks and sets VAR_TEMP_1; SE_ICE_CRACK / SE_ICE_BREAK), MarkIcePuzzleCoordVisited / sIcefallCaveIceCoords
  (FLAG_TEMP_1-9) and SetIcefallCaveCrackedIceMetatiles. The ash grass and cracked floor callbacks (R/S leftovers)
  log once.
- Script commands `setstepcallback` and `warphole` (SetWarpDestination to the player's spot on the named map, then
  `special DoFallWarp` and ResetInitialPlayerAvatarState; MAP_UNDEFINED's fixed hole warp logs).
- `script/postgameSpecials.ts`: SetIcefallCaveCrackedIceMetatiles, UpdateLoreleiDollCollection (a doll every 25
  Hall of Fame entries), StickerManGetBragFlags. All five are off tests/unit/scriptCoverageGaps.ts.
- tests/e2e/postgameHelpers.ts: `afterHallOfFame` also counts GAME_STAT_ENTERED_HOF 1 (the Hall of Fame's save);
  `rainbowPassState` (where postgame.test.ts ends) and `talk` (moved from postgame.test.ts).
- Nothing else needed fixing on the way: the rival scene, the sticker man's multichoice and fanfare, the back room's
  scene (its trainerbattle_no_intro, Lapras's cry, the Rockets' exit) and the Seagallop to Four Island ran as they
  were.
- Verified: typecheck; unit (tests/unit/fieldTasks.test.ts: the ice's frame timing and flags, the cracked-ice
  special, the doll thresholds, the brag flags); e2e tests/e2e/postgameFourIsland.test.ts (the ferry from Three
  Island, the rival scene, the sticker man's HALL OF FAME brag, Icefall Cave 1F's ice cracking on the first step and
  breaking on the second with their SEs, a save + CONTINUE keeping the cracked ice, the fall to B1F at the same spot,
  the ice whole again on the next visit, the back room's scene to its end and Lorelei hidden on the next visit,
  Lorelei's Meowth doll at 25 entries and her text), plus postgame.test.ts (the helper) and sideSpecials.test.ts
  (the fall warps).

### W-weather 2: the horizontal fog (POSTGAME_PLAN.md batch 10)

- `world/weather.ts`: WEATHER_FOG_HORIZONTAL (FogHorizontal_InitVars / _InitAll / _Main / _Finish, its scroll:
  fogHScrollPosX from gSpriteCoordOffsetX, a pixel left every 4 frames), the blend coefficients
  (Weather_SetBlendCoeffs, Weather_SetTargetBlendCoeffs, Weather_UpdateBlend: REG_BLDALPHA through the host),
  StartWeather's blend and sprite reset, FadeScreen's Weather_SetBlendCoeffs, FadeInScreen_FogHorizontal and
  ApplyFogBlend (the BG palettes as loaded, the GAMMA_NORMAL sheets lightened: BlendPalette(12, RGB(28, 31, 28))).
  FogHorizontal is in `PORTED`, so WEATHER_UNDERWATER runs it too, as FRLG's sWeatherFuncs has it.
- `world/fogHorizontal.ts` (new): the fog's 20 sprites (gWeatherFogHorizontalTiles in gDefaultWeatherSpritePalette,
  already extracted by tools/extract_gfx.py), FogHorizontalSpriteCallback's placement and wrap, and the blend over the
  field: the GPU in two passes (a MULTIPLY rectangle of EVB / 16, the sprites in ADD mode at EVA / 16), between BG2 and
  the priority-2 objects. `world/weatherTextures.ts` takes per-channel tables beside the gamma shift's one.
- The GBA layer's copy of the field (battle transitions): the fog as semi-transparent OBJ pixels behind the priority-2
  objects (`ObjBitmapLayer.semi`, which gba/ppu.ts now copies into its OBJ line) with the weather's BLDALPHA.
- OverworldScene: the fog's host (sprites, BLDALPHA, gSpriteCoordOffsetX / Y as the camera's movement since the last
  InitObjectEventsLocal, `cameraLeft` beside `cameraTop`), its update after the weather task, `FieldGbaSource.fog`.
  Probes `__test.fog()` and `__test.screenPixel()` (Phaser's WebGL snapshotPixel reads screen row y - 1: the hook
  asks for y + 1).
- docs/DEVIATIONS.md: the "fog runs as NONE until unit 2" note gone; the fog's blend, lightened sheets and camera
  offset written up.
- Verified: typecheck; unit 593 passed (tests/unit/weather.test.ts: the fog's blend steps (0, 16) → (12, 8) in one
  frame, the 17 fade-in frames, the drift, a tile's scroll, the 95-frame finish to (0, 16) and the sprites' end, a warp
  out, WEATHER_UNDERWATER's (4, 16)); e2e weather.test.ts 7 passed (Pokémon Tower 3F: the sprites cover the screen
  at (12, 8), four rendered pixels against min(255, fog * 12 / 16 + field * 8 / 16) read with the fog hidden and
  shown, the player unfogged, 4 pixels of drift in 16 frames, a step up / left moving the fog 16 pixels, the stairs
  to 2F lifting it, back up fading it in with the sprites up from the start; a battle transition with the fog on the
  GBA layer at BLDALPHA (12, 8) and back after the battle; the Lost Cave fogged), pokemonTower.test.ts and
  transitions.test.ts (15 passed with weather), battleAnims "a ghost dodges the ball" (3F). Screenshots of 3F on the
  field and mid-transition show the fog.

### W-ttower 3: records and the full climb (POSTGAME_PLAN.md batch 10)

- `menus/battleRecords.ts` (new): battle_records.c's screen. `special ShowBattleRecords` (script/trainerTowerSpecials.ts:
  `host.runScreenFromScript(ShowBattleRecords, BATTLE_RECORDS_GFX)`) after the script's `fadescreen`: MainCB2_SetUp's
  states 0-7 (ResetGpu, StopAllRunningTasks, BG0 / BG3 from sBgTemplates, the frame on BG3, the text window
  palette, the window, the fade in), Task_WaitFadeIn / Task_WaitButton (A or B: SE_SELECT) / Task_FadeOut /
  Task_DestroyAndReturnToField (CB2_ReturnToFieldContinueScriptPlayMapMusic; the script's `waitstate` ends with the
  field's fade in). VAR_0x8004 1: PrintTrainerTowerRecords (world/trainerTower.ts, trainer_tower.c's: TIME BOARD and
  each challenge type's record through PRINT_TOWER_TIME, the current record validated first). VAR_0x8004 0: the link
  page came for free (PrintBattleRecords / PrintTotalRecord / PrintOpponentBattleRecord: the GAME_STAT_LINK_BATTLE_*
  totals and five cleared records, since no link battle writes gSaveBlock2Ptr->linkBattleRecords; DEVIATIONS).
  ShowBattleRecords is off tests/unit/scriptCoverageGaps.ts.
- Extractor: `graphics/battle_records/` in extract_gfx.py's prefixes (`battle_records.sTiles`: help_system_util.c has
  an sTiles too, so the plain name is now battle_records.c's, which sorts first; nothing used it; `sPalette`,
  `sTilemap`); extract_battle.py's pointer tables gained gTrainerTowerChallengeTypeTexts. Rerun `npm run extract`.
- The roof's owner, GiveChallengePrize and CheckFinalTime were ported in unit 1; nothing in them needed fixing once
  played through.
- Probe `__test.battleRecords()`: what the screen printed (decoded, with x / y) while it runs.
- Verified: typecheck; unit (tests/unit/trainerTower.test.ts: PrintTrainerTowerRecords' nine lines and positions, a
  record of another set starting over, a kept record " 3MIN. 25.75SEC."); e2e tests/e2e/trainerTower.test.ts (9: unit
  1-2's six, plus the link records machine in Viridian's Pokémon Center 2F (the totals, five rows of dashes, SE_SELECT),
  a new game's TIME BOARD (59MIN. 59.99SEC. four times), and a full Single climb: eight floors' battles won (the party
  healed before each floor in the test, speed 16, battle scene off), the roof's layout, the owner (GetOwnerState stops
  the timer, the UP-GRADE, "Stupendous!", the record = the timer), the owner again (only the farewell), the roof's
  elevator to the lobby, the TIME BOARD with the record; out and back in, a second challenge with its floors counted
  cleared and its clock 10 s past the record: "taken your sweet time", no prize, the record kept on the board).

### W-sevii 4: Five Island and the Sapphire back to Celio (POSTGAME_PLAN.md batch 11)

- `script/postgameSpecials.ts` (its own block at the end): SampleResortGorgeousMonAndReward (SampleResortGorgeousMon:
  100 random tries for a seen species, then down from the last try, wrapping past Bulbasaur;
  SampleResortGorgeousReward: a Luxury Ball 70%, else sResortGorgeousDeluxeRewards), IncrementResortGorgeousStepCounter
  (called on every step from `OverworldScene.processPlayerFieldInput`, beside IncrementBirthIslandRockStepCount, as
  ProcessPlayerFieldInput does), SetPostgameFlags (CHAMPION_SAVEWARP, gcnLinkFlags bits 1-3 and 15) and
  SetUnlockedPokedexFlags (gcnLinkFlags bits 0, 4, 5; was a no-op). Both gap lines are off
  tests/unit/scriptCoverageGaps.ts.
- Save version 9: `GameState.gcnLinkFlags` (gSaveBlock2Ptr->gcnLinkFlags) in the save; a version-8 save loads with 0.
  CHAMPION_SAVEWARP lives in the already-saved specialSaveWarpFlags; the C reads it only in union_room.c's
  IsTryingToTradeAcrossVersionTooSoon (wireless link), so nothing else changes (the continue warp reads only
  CONTINUE_GAME_WARP).
- Fixed on the way: the `compare` macro's operand. `goto_if_eq` & co., `compare` and `case` read their value through
  VarGet semantics (anything from 0x4000 up a var), so Selphy's `goto_if_eq VAR_RESORT_GORGEOUS_REQUESTED_MON, 0xFFFF`
  compared with an unset var (0) and she was "tired of waiting" at the first visit. event.inc's macro picks
  compare_var_to_var only for VARS_START..VARS_END and SPECIAL_VARS_START..SPECIAL_VARS_END; ScriptEngine's
  `compareArg` does the same. A scan of the decomp's scripts finds no other comparison it changes.
- Nothing else needed fixing: the Meadow's trainers and password door (setmetatile + DrawWholeMapView, SE_PIN), the
  warehouse's spinners, coord trigger, admins (the arrows for re-entry on the switch and ON_LOAD), Gideon, Celio's
  network machine scene, InitRoamer, the Lost Cave's Selphy scene and her warp home, Resort Gorgeous's door scene,
  the butler, the Memorial Pillar, the Cerulean Cave guard's flag and Mewtwo's StartLegendaryBattle ran as they were.
  (There is no FLAG_LEARNED_GOLDEEN_NEED_LOG: the first password is only text; the door checks
  FLAG_LEARNED_YES_NAH_CHANSEY alone.)
- Verified: typecheck; unit 626 passed (tests/unit/fiveIsland.test.ts: the request only ever picks a seen species,
  the rewards, an open request kept, 249/250 steps, SetPostgameFlags / SetUnlockedPokedexFlags; saveData.test.ts:
  gcnLinkFlags round-trips, a version-8 save loads); e2e tests/e2e/postgameFiveIsland.test.ts 2 passed (the Meadow's
  Rocket by sight, the door with one password and then two, the warehouse's grunt, both admins and the arrows,
  Gideon and the Sapphire, the door still open on the next load, Celio: the machine's metatiles, SE_CLICK / SE_PC_ON,
  the flags, SetPostgameFlags' bits, the roamer; save + CONTINUE keeps them and ON_LOAD turns the machine on; VAR 7
  on the next visit; Cerulean City's guard gone and the cave entered; Mewtwo's battle start. The Lost Cave fogged,
  Selphy's scene and battle, the warp home and her door scene; her request for the only seen mon, asked again
  without it, 249 steps keep it and the 250th ends it, "tired of waiting" and a new request, the reward with a
  Pikachu in the party, her goodbye; the Memorial Pillar's Lemonade for TM42), saveContinue.test.ts (6) and
  eventIslands.test.ts (5: the step hook).

### W-sevii 5: Seven Island, the Tanoby Ruins, Altering Cave (POSTGAME_PLAN.md batch 10)

- Played headless (`tests/e2e/postgameSevenIsland.test.ts`, 6 tests): Three Island → Seven Island on the Rainbow Pass
  menu's second page (HI-SPEED 6); the Liptoo Chamber dark (EventScript_TryDarkenRuins' WEATHER_SHADE) with no
  encounter in 40 steps while the ruins are locked; Sevault Canyon → the Tanoby Key, Strength from a boulder, the
  puzzle in 34 pushes (a search over the map's collision found them), each switch's script
  (HandleBoulderActivateVictoryRoadSwitch → Switch1-7, VAR_TEMP_1-7 100, VAR_TEMP_8 7), every ShakeScreen's camera
  pan per tick (seven 1 px shakes, then PuzzleSolvedShakeScreen's 2 px and 3 px ones), SE_TRUCK_MOVE x7,
  SE_LAVARIDGE_FALL_WARP, the rumble message, FLAG_SYS_UNLOCKED_TANOBY_RUINS, the boulders on the switches again on
  the next visit (MoveBouldersToSolvedPos); the chamber lit and a seeded wild Unown with one of its letters; all seven
  chambers dark then lit, each with sUnownLetterSlots' letters by slot (GenerateWildMon); Altering Cave's Zubat (set
  0); and a sweep: all 18 trainer battles of the Sevault Canyon entrance, the canyon, the Tanoby Ruins and the Trainer
  Tower's path, their 4 item balls and 10 hidden items, the town's, Mart's, Pokémon Center's and house's NPCs and
  signs, the Swords Dance tutor (declined), the Black Belt, the Chansey and the Chansey Dance (the party healed).
- Fixes found on the way: an Unown's battle threw "gMonFrontPic_UnownD used before loadGfx()" (BattleScene's
  gfxSymbolsFor preloaded only the species' pic; it now adds the letter's front / back pics as LoadSpecialPokePic
  reads them); ValidateEReaderTrainer (script/postgameSpecials.ts, off the link gaps) left VAR_RESULT 0, so the
  Seven Island house opened its battle-room door and the old woman offered the e-Reader trainer's challenge: it now
  gives 1, as the C does for a save without an e-Reader trainer (DEVIATIONS).
- Everything else ran as it was: the canyon's trainers, items and NPCs, the Chansey Dance, the chambers and Altering
  Cave. Neighbouring maps' objects spawn in the port, so the Sevault Canyon entrance's `clone` of the Swords Dance
  tutor needs nothing.
- Coverage gaps: one postgame line is left after merging master (W-sevii 3 and 4 took theirs): ShowBattleRecords
  (the Trainer Tower lobby's battle records, W-ttower's). One link gap fewer (ValidateEReaderTrainer).
- Verified (after merging master): typecheck; unit 629 passed; e2e postgameSevenIsland.test.ts (6 passed, ~7 min: most of it the sweep's
  battles) and wildBattle.test.ts (3 passed: the battle's preload).

### Batch 10 merge: the postgame (POSTGAME_PLAN.md, PRs #114-#125)

- Merged in this order: #114 the plan (docs), #115 W-weather 1, #116 W-events 1, #117 W-ttower 1, #118 W-sevii 1,
  #119 W-weather 2, #120 W-sevii 2, #121 W-ttower 2, #122 W-sevii 4, #123 W-sevii 3, #124 W-sevii 5, #125
  W-ttower 3. W-sevii 3-5 and W-ttower 3 were planned for batch 11 and ran in slots that freed up (POSTGAME_PLAN.md
  decision 7).
- Conflict resolutions: `script/specials.ts` (the spread lines, both sides kept), `scriptCoverageGaps.ts` (each
  side's removals kept; the postgame section is empty now), `script/postgameSpecials.ts` (units 3 and 4's blocks
  both kept, the header comment merged), the save version (W-weather took 7, W-ttower 8, W-sevii 4 9, each with its
  upgrade step). Union merges of docs/DEVIATIONS.md restored W-weather 1's field weather entry twice (once split
  around the braille entry): unit 2's text kept once each time. docs/LOG.md lost the blank line before entries in
  union merges: restored.
- A race fixed at merge: weather.test.ts probed right after a dev start, before the weather's own fade in had run
  (the field goes idle first): `startedIdle` waits for WEATHER_PAL_STATE_IDLE. The same file's Tanoby test failed
  once in a merge run at load ~79 (log lost) and passed in five reruns; it passed in the end-of-batch run.
- Tests per merge: typecheck, unit tests and the PR's own e2e files (plus eventIslands / trainerTower /
  weather where a merge touched them). The full e2e suite ran once, on master at #125: 474 passed, 1 failed
  (postgameSevenIsland's seven chambers: the dev start on SevenIsland_TanobyRuins let a ruins trainer spot the
  player, and the test's warp carried EventScript_DoTrainerBattleFromApproach into the chamber, where it never
  ended). Fixed by starting inside a chamber; the file rerun alone: 6 passed. tests/README.md item 10 names the
  pattern.

### W-preview: the map preview screens (GAPS_PLAN.md batch 11)

- New `world/mapPreviewScreen.ts`: map_preview_screen.c whole (sMapPreviewScreenData from menus.json
  `mapPreviewScreens`, MapHasPreviewScreen / _HandleQLState2, MapPreview_InitBgs / LoadGfx / Unload /
  IsGfxLoadFinished / CreateMapNameWindow, MapPreview_StartForestTransition, Task_RunMapPreviewScreenForest,
  ForestMapPreviewScreenIsRunning, GetDungeonMapPreviewScreenInfo, MapPreview_GetDuration, MapPreview_SetFlag) and
  `world/mapPreviewLayer.ts` (the forest banner's BG0 blended over the Phaser field, MULTIPLY / ADD as the fog).
  `world/mapTransition.ts`: fldeff_flash.c's RunMapPreviewScreen / Task_MapPreviewScreen_0 from TryDoMapTransition,
  handing over to Task_FlashTransition_Enter_1; its hand-written section table is gone. The forest hook is
  OverworldScene.showMapNameOnWarpArrival (LoadMapInStepsLocal's state 12); the warp exits wait for
  FieldFadeTransitionBackgroundEffectIsFinished (the fade and ForestMapPreviewScreenIsRunning). `setworldmapflag`
  goes through MapPreview_SetFlag. The region map's copy of the table and GetDungeonMapPreviewScreenInfo moved onto
  the new module. Extractor: `map_preview_screen_data` (menus.json `mapPreviewScreens`, with the type the region
  map's table lacked) and include/map_preview_screen.h in the defines (MPS_TYPE_*).
- No quest log, so MapHasPreviewScreen_HandleQLState2 takes the non-playback path (MapHasPreviewScreen).
- Found on the way: the C's AddWindow keeps the preview's BG0 tilemap only because the field's InitWindows left BG0
  a window tilemap buffer; the port's GBA side has no field windows, so `InitFieldBg0AndWindows` puts back what
  InitOverworldBgs / InitStandardTextBoxWindows leave (else AddWindow swaps in an empty tilemap). The cave screen's
  B check needs gMain's keys: OverworldScene.doChangeMap calls ReadKeys while CB2_DoChangeMap runs.
- Verified: typecheck; unit (tests/unit/mapPreview.test.ts new); e2e mapPreview.test.ts (new: Mt. Moon's banner held
  121 frames in state 4 for its 120-frame duration then 41 for 40 on the second visit, the change-map tasks
  Task_MapPreviewScreen_0 → Task_FlashTransition_Enter_1..3, B cutting it short, Viridian Forest's banner held 121
  frames after the Shade's fade in and blended out in 47, the field busy meanwhile and no name popup, 41 on the
  second visit, Icefall Cave's banner, none from Mt. Moon 1F to B1F), transitions, weather, fly, and the story tests
  that warp into forest sections (storyCeladonSaffron's Game Corner stairs to the Rocket Hideout, storyLeague's
  Safari Zone gate). Screenshots of both banners checked by eye (the name window and the art as on the GBA).

### W-kanto 1: Cerulean Cave and the legendaries' battles to the end (GAPS_PLAN.md batch 11)

- Played headless: Cerulean Cave from Cerulean City's entrance (the guard hidden by FLAG_HIDE_CERULEAN_CAVE_GUARD)
  through 1F (Surf across the lake), 2F and 1F's north-west corner down to B1F, Surf round to Mewtwo, and Mewtwo's
  StartLegendaryBattle to its end: caught with a full party (Text_MonSentToBoxInBillsPC, BOX1), ON_RESUME's
  CeruleanCave_B1F_EventScript_TryRemoveMewtwo, FLAG_FOUGHT_MEWTWO, MUS_ROCKET_HIDEOUT back, gone on the next visit;
  beaten (CeruleanCave_B1F_EventScript_DefeatedMewtwo → EventScript_RemoveStaticMon's fade, never back); run from
  (EventScript_MonFlewAway, back on the next visit). Moltres, Articuno and Zapdos caught; Moltres teleported away
  from (B_OUTCOME_PLAYER_TELEPORTED, back on the next visit); Lugia caught and beaten (FLAG_LUGIA_FLEW_AWAY, stays
  away); Ho-Oh caught (VAR_TEMP_1 keeps the coord event off) and run from (where Movement_HoOhApproach left it, the
  script's `setweather 0` kept through the battle, WEATHER_SHADE again on the next visit); Deoxys caught (the
  triangle's last touch; no Deoxys, no rock on the next visit).
- Fixed: the field message box stayed up through a scripted battle. Mewtwo's "Mew!", the birds' "Gyaoo!" and the
  like (`message` + `waitbuttonpress`, then StartLegendaryBattle) were still on screen when the field faded back
  in after the battle, and through EventScript_RemoveStaticMon's fades, until `release`. On the GBA,
  CB2_ReturnToField → InitOverworldBgs → InitFieldMessageBox (overworld.c) makes the field's windows anew with the
  message box hidden; `returnToField` (OverworldScene.runBattle) now hides it. Trainer and wild battles return the
  same way.
- Test state: `afterHallOfFame` now sets FLAG_SYS_NOT_SOMEONES_PC (Route25_SeaCottage: Bill met), so the postgame's
  PC texts say BILL'S PC as they would.
- Everything else ran as the scripts have it: StartLegendaryBattle's music and BLUR, CB2_EndScriptedWildBattle,
  every map's ON_RESUME / ON_TRANSITION, the GetBattleOutcome branches.
- Verified: typecheck; unit 630 passed; e2e postgameKanto.test.ts (3 passed, ~85 s), postgameKantoLegendaries.test.ts
  (9 passed, ~2.5 min), scriptedBattles.test.ts (6) and trainerBattle.test.ts (3) for the message box change.

### W-help 1: the help system's engine and menus (help_system_util.c, help_system.c)

- `ui/helpSystem.ts` (help_system_util.c: RunHelpSystemCallback's states 0-8, SaveCallbacks with DMA0 stopped,
  the tiles / GPU regs saved and restored, BG0's HS_* panels in a 0x4000 buffer committed to char block 3,
  HelpSystemRenderText with {PLAYER}, {STR_VAR_1} (BILL / SOMEONE), CLEAR_TO and keypad icons, the list menu
  controller, TryMoveCursor1 / MoveCursor, the scroll arrows), `ui/helpSystemMenu.ts` (RunHelpMenuSubroutine and
  its subroutines), `ui/helpSystemContext.ts` (contexts, SetHelpContextForMap, the enable / R toggles, the list
  builders and gates), `ui/helpSystemField.ts` (the field's hook and overlay). The tables through
  `tools/extract_help.py` (helpSystem.json); the strings were already in strings.json.
- Hooks: GbaHostScene runs RunHelpSystemCallback before CallCallbacks; OverworldScene.tick samples the buttons
  first, asks the help, and skips tickField, the flash VBlank and the GBA layer's frame while it's up.
  AgbMainFrameEnd(callbacksRan) keeps the sound tasks (gTasks in the C) waiting too. ReadKeys takes a key state
  (`gba/main.ts` KeyState / NewKeyState): the field reads the help's keys into its own, leaving gMain alone (the
  field's credits read gMain's A, which the field never updates: unchanged). gba/sound.ts: HelpSystem_StopSE1AndSE2,
  HelpSystem_BGMVolumeControl, IsHelpSystemVolumeReduceDisabled.
- SetHelpContextForMap where overworld.c calls it (warps and CONTINUE: LoadMapInStepsLocal; returns to the field:
  ReturnToFieldLocal). The other screens' contexts, the specials and the title screen's HelpSystem_Enable are
  unit 2's; gHelpSystemEnabled starts TRUE meanwhile (DEVIATIONS).
- Found on the way: in the HELP button mode (the new-game default) R in the slot machine opens the help, as on the
  GBA (RunHelpSystemCallback takes it before the machine's callback). gameCorner.test.ts's spins set the LR mode
  before betting with R.
- Verified: typecheck; unit 637 passed (new tests/unit/helpSystem.test.ts: 7); e2e helpSystem.test.ts (3: the field,
  the LR mode and HelpSystem_Disable's SE_HELP_ERROR, the bag), options.test.ts (2), audio.test.ts (2),
  gameCorner.test.ts (8). Screenshots of the welcome page, the topics, a scrolled submenu and a help item looked
  like FRLG's.

### W-intro 1: the copyright screen, the intro's framework and the Game Freak scene (batch 11)

- `menus/intro.ts` ports intro.c up to the end of the Game Freak scene: CB2_InitCopyrightScreenAfterBootup /
  AfterTitleScreen, SetUpCopyrightScreen, LoadCopyrightGraphics, CB2_WaitFadeBeforeSetUpIntro, CB2_SetUpIntro,
  CB2_Intro, VBlankCB_Intro, Intro_ResetGpuRegs, StartIntroSequence, SetIntroCB, Task_CallIntroCallback (the skip
  with A / START / SELECT), IntroCB_Init, IntroCB_ExitToTitleScreen, LoadFightSceneSpriteGraphics, and
  IntroCB_GF_OpenWindow / _Star / _RevealName / _RevealLogo with GFScene_* and the star, sparkle and logo sprites
  (REVISION 0: no "presents", the copyright screen fades in from white). PlaySE(MUS_GAME_FREAK) as the C plays it.
  IntroCB_Scene1 is a stub that goes to IntroCB_ExitToTitleScreen until unit 2 ports scenes 1-3.
- menu2.c's StartBlendTask / IsBlendTaskActive: new `gba/menu2.ts`. `graphics/intro/` is in extract_gfx.py's
  GFX_PREFIXES (all 49 INCBINs extract).
- Boot (BootScene → MainMenuScene `entry: 'copyright'`) and soft reset now run copyright → intro → title; the
  title screen's 2700-frame timeout goes to CB2_InitCopyrightScreenAfterTitleScreen instead of straight back to
  the title screen. `?skipIntro`, `?start=`, `?map=` skip it all as before. MainMenuScene loads the battle data for
  gSineTable (the star's wave).
- Tests: new tests/e2e/intro.test.ts (harness option `intro: true`: boot like the game, return once the copyright
  screen is up): the copyright screen, the GF scene's callbacks in order with their frame counts against the C
  (copyright → IntroCB_Init 167 frames, Init 2, OpenWindow 8, Star 121, RevealName 189, RevealLogo 187), the
  jingle in the Star's first frame, the sparkles, A skipping to the title screen, and the title screen's timeout
  back to the copyright screen. titleScreen.test.ts: the restart and the soft resets go through the copyright
  screen; audioOutput.test.ts's headless check boots with `intro: true` (only needs the page up). The frame counts
  showed BeginNormalPaletteFade doing the fade's first step itself and the intro task first running the frame
  after CB2_SetUpIntro creates it, as in the C.

### W-kanto 2: the National Dex in Kanto (GAPS_PLAN.md batch 11)

- Checked every IsNationalPokedexEnabled branch outside the Pokédex against the C: main_menu.c's PrintDexCount,
  save_menu_util.c's SaveStatToString, trainer_card.c's GetCaughtMonsCount, prof_pc.c's GetPokedexCount,
  party_menu.c's MonCanEvolve, pokemon.c's GetEvolutionTargetSpecies (EVO_TRADE_ITEM) and SpeciesToPokedexNum,
  evolution_scene.c's Task_EvolutionScene cancel, easy_chat.c's groups, hall_of_fame.c. (trade.c's
  CanTradeSelectedMon and link.c are link play; Task_TradeEvolutionScene isn't ported: no FRLG in-game trade
  evolves.)
- Fixed: the port had two National Dex checks. The trainer card, the Pokédex screen, Easy Chat and Oak's rating used
  the C's (the magic, VAR_NATIONAL_DEX = 0x6258 and FLAG_SYS_NATIONAL_DEX); the save window, the main menu's
  CONTINUE count, MonCanEvolve, GetEvolutionTargetSpecies, the evolution scene and the Hall of Fame read the magic
  alone. Now one `state/nationalDex.ts` (IsNationalPokedexEnabled over GameState or a save file's view:
  SaveBlockView gained `getVar`), and every site calls it.
- Fixed: the summary screen showed a non-Kanto mon's national number before the National Dex; BufferMonInfo now
  calls SpeciesToPokedexNum (shared with the Hall of Fame, whose local copy is gone), which gives "No. ???".
- The Elite Four / Champion rematch teams (FLAG_SYS_CAN_LINK_WITH_RS) and the Kanto NPCs that branch on
  FLAG_SYS_GAME_CLEAR / the National Dex (Oak's lab and its aides, the fan club, Celadon's tea lady, the Indigo
  Plateau door guard and gossipers, Daisy) were right: scripts the interpreter runs as written.
- postgameHelpers: `rainbowPassState` enables the National Dex as EnableNationalPokedex does (it set only the
  magic); `finishScript` takes the button to mash.
- Verified: typecheck; unit (new tests/unit/nationalDex.test.ts: 4; save.test.ts: a save file's dex count needs all
  three); e2e new tests/e2e/postgameKantoNational.test.ts (5 tests, ~75 s): the trainer card and the save window
  at 10 with the magic alone and 12 with the National Dex, CONTINUE at 12 after saving; a Sun Stone does nothing to
  Gloom and Golbat's Rare Candy evolution stops itself without the National Dex, both evolve with it; Lance after
  the Hall of Fame (rematch intro, TRAINER_ELITE_FOUR_LANCE, Gyarados Lv. 56); Lorelei (TRAINER_ELITE_FOUR_LORELEI_2,
  Dewgong Lv. 64) and the Champion (TRAINER_CHAMPION_REMATCH_*, Heracross Lv. 72) with the network machine on;
  Oak rating 70 Kanto / 71 national, the aides, the fan club's worker, the tea lady once, the Indigo Plateau guard
  in the doorway (Lorelei away) and back at her post.

### W-help 2: the help system's contexts at every screen (batch 11)

- The contexts: every SetHelpContext / BackupHelpContext / RestoreHelpContext / HelpSystem_Disable / _Enable call
  site the port has a counterpart for, as one- or two-line hooks: title_screen.c (HELPCONTEXT_TITLE_SCREEN and
  HelpSystem_Enable in SetTitleScreenScene_Run, Disable on the timeout), oak_speech.c, naming_screen.c,
  start_menu.c's save (StartCB_Save1 / Field_AskSaveTheGame → SaveDialog's constructor, the restore on every way
  out of RunSaveDialogCB), option_menu.c, pokedex_screen.c, party_menu.c, pokemon_summary_screen.c (its local
  no-op SetHelpContext replaced), item_menu.c (the item PC's deposit context), item_pc.c, player_pc.c (the
  bedroom PC's contexts through PlayerPcMenu's `notInRoom`), pokemon_storage_system_menu.c / _tasks.c,
  trainer_card.c, battle_main.c / reshow_battle_screen.c (SetHelpContextForBattle), battle_setup.c's
  Task_BattleStart, field_effect.c (FldEff_UseSurf's end, the Seafoam fall warp), field_specials.c's
  ForcePlayerToStartSurfing, field_player_avatar.c's Task_WaitStopSurfing (SetHelpContextForMap), daycare.c's egg
  hatch, evolution_scene.c, trade_scene.c's in-game trade, seagallop.c, hall_of_fame.c. Skipped (no port): mail,
  Teachy TV, the main menu's Mystery Gift, the link / wireless screens, the e-Reader, the berry fix program, the
  quest log.
- The help specials out of NO_OP (specials.ts HELP_SPECIALS; sideSpecials.ts's no-op Backup / Restore pair gone).
  The duplicated "No-op specials" lines in DEVIATIONS.md (a union-merge leftover) are one line now.
- Boot: gHelpSystemEnabled starts FALSE (main.c); the title screen enables it, and BootScene does for the dev
  starts that skip the title screen. softReset calls ResetHelpSystemState. MainMenuScene hands the help its fonts
  and loads its graphics, and builds a GameState from the save on each LoadGameSave (the help reads the flags and
  the button mode), so the help opens on the title screen and the main menu of a fresh boot.
- Tests: helpSystem.test.ts grows checkHelpContext (the context, then L, the topics against helpSystem.json's
  sHelpSystemContextTopicFlags / order, B) on the title screen, a Pokémon Center, the save dialog (and the
  restore after NO), the Pokédex, the party menu, the summary (and the skills page's context), the bag, Bill's
  PC, a wild battle (and the bag in it keeping the battle's context), plus Surf's context on and off the water.
  Unit: SetHelpContextForBattle by battle type, the help specials. Ran helpSystem, titleScreen, intro, surf and
  inGameTrades e2e files.

### W-intro 2: the intro's scenes 1-3 (batch 11)

- `menus/intro.ts` ports the rest of intro.c: IntroCB_Scene1 (Scene1_Task_AnimateGrass, Scene1_StartGrassScrolling,
  Scene1_Task_BgZoom), IntroCB_Scene2 (Scene2_Task_PanForest / _PanMons, Scene2_CreateMonSprites /
  _DestroyMonSprites), IntroCB_Scene3_Entrance and IntroCB_Scene3_Fight with every Scene3_* task and function
  (the BG scroll, Gengar's bounce, entrance and attack, the swipes, the grass, Nidorino's entrance, cry, recoil and
  its dust, hops and attack, the zooms) and the sprite callbacks; sBgTemplates_Scene1/2/3, the sprite templates and
  anims. m4aSongNumStart(MUS_INTRO_FIGHT) and PlayCry_ByMode(SPECIES_NIDORINO, 0x3F, CRY_MODE_DOUBLES) through
  gba/sound.ts. The movie now ends on IntroCB_ExitToTitleScreen after the fight. No shared files changed: gba/bg.ts
  already had ChangeBgX / ChangeBgY / GetBgX, and the scenes use no affine BG.
- Tests: tests/e2e/intro.test.ts's callback order is the whole movie (boot, the title screen's timeout); a new
  full-movie test checks each scene's frame count against the C, worked out by hand from intro.c (scene 1 47,
  scene 2 138, scene 3's entrance 60, the fight 501: the fades, Gengar's scroll vs Nidorino's slide, the cry, the
  attack landing on its 31st frame, the recoil and hops, Gengar's 30-frame bounce), MUS_INTRO_FIGHT on scene 1's
  17th frame and Nidorino's cry on the fight's 41st, with screenshots of each scene; another skips with A during
  Gengar's attack (MUS_TITLE takes over from MUS_INTRO_FIGHT). The port matched every hand count on the first run.
  The full movie adds about 750 frames to each `title: true` boot (well inside the 60 s waits): titleScreen.test.ts,
  audioOutput.test.ts and audioScenes2.test.ts's title test pass unchanged.

### Batch 11 merge: GAPS_PLAN.md complete (PRs #127-#134)

- Merged in hand-back order, each with `origin/master` merged in, `npm run extract` (both sides changed `tools/`),
  typecheck, unit tests and the PR's own e2e files: #128, #129, #130, #132, #131, #133, #134. Conflicts: #131's
  OverworldScene `loadGfx` list (both symbol lists kept) and tests/README.md's events row (both sides' events);
  #134's imports in hallOfFame.ts and partyMenu.ts (both kept). The union merges of docs/LOG.md dropped the blank
  line before a heading three times (#130, #133, #134); fixed in each merge.
- One full e2e run at the end, on master at eb7e1d1: 507 of 509 passed in 84 files. Both failures were test races,
  rerun alone and fixed here:
  - ssAnne.test.ts's "Vermilion once the S.S. Anne has left" failed again alone: its `talkTo` faced a wandering
    sailor, but the sailor stepped away before the A press landed, so A talked to nobody (and runScript waited out
    its 6000 frames, then returned no messages). It now presses A for 12 frames until a script starts and walks up
    again if none did; 10 passed twice. tests/README.md item 11.
  - postgameSevenIsland.test.ts's town test passed alone (6 passed): its `interact` returned at once when the field
    wasn't idle right after the warp helper had seen it idle, so the sign wasn't read. It now waits up to 600 ticks
    for the field (or a trainer's script) first; the test passed again alone. What held the field for those ticks
    wasn't pinned down.
- Typecheck clean, 646 unit tests.

### W-teachy 1: Teachy TV's screen (FIELD_ITEMS_PLAN.md batch 12)

- `menus/teachyTv.ts` is teachy_tv.c whole but the demos: InitTeachyTvController, CB2_ReturnToTeachyTV,
  SetTeachyTvControllerModeToResume, the main callback (modes 0-2), the BGs (the TV set, the noise, the title, Route 1
  drawn on BG3 from its layout and tilesets: TeachyTvLoadBg3Map and its tile / palette helpers), the Pokédude's object,
  the six-option list (four without the TM case) with its scroll arrows and WIN0 darkening, every TTVcmd, the tall
  grass sprites (the field effect's template on the GBA layer, with the C's subsprite tables), quitting to the bag or
  the field (Overworld_PlaySpecialMapMusic). menus/itemUse.ts: FieldUseFunc_TeachyTv, InitTeachyTvFromBag,
  Task_InitTeachyTvFromField. The Pokédude's battles and scripted bag / TM case (units 2-3) go through one seam,
  PokedudeDemoNotPorted: logged, and the screen comes back as from the demo's end (mode 2: the closing text).
- Extractor: `graphics/teachy_tv/` in extract_gfx.py's prefixes (gTeachyTv_Gfx, the screen and title tilemaps, the
  4-palette gTeachyTv_Pal); extract.py reads `src/data/text/teachy_tv.h` with strings.c (strings.c #includes it, the
  regex only saw strings.c's own text). FieldMenuScene awaits `prepareTeachyTv` for the bag and SELECT screens when
  the bag holds Teachy TV (the layout is a JSON fetch, the rest graphics).
- On the way: the grass sprites' callback reads sResources after TeachyTvPrepBattle has freed it (on the GBA, the
  freed heap during the transition); the port keeps the freed buffer for it (sFreedResources).
- Tests: tests/e2e/teachyTv.test.ts, 4 tests: the old man's tutorial to the gift and Teachy TV from the bag (five
  rows, no arrows, MUS_TEACHY_TV_MENU, SELECT ignored from the bag, B back to the bag and the map music); all six
  options with the TM case, each recorded tick by tick in the page (the texts printed, every TTVcmd in order, mode 2
  after the skipped demo, grass sprites in the battle options only, MUS_FOLLOW_ME then MUS_TEACHY_TV_MENU, back on
  the same row), then CANCEL scrolled into view; B mid-sequence (TTVcmd_End's state, the list on the same option);
  SELECT from the field (HELPCONTEXT_BAG, SELECT and CANCEL back to the field with the controls locked until the
  fade in). Screenshots of the noise, title, walk-in, hello, the grass, mode 2, the walk off and THE END checked by
  eye. Typecheck, 646 unit tests; teachyTv, registeredItems and fieldItems e2e pass.

### W-mail 1: mail's data, the mail screen, the party menu's mail actions (FIELD_ITEMS_PLAN.md, batch 12)

- mail_data.c whole in `world/mail.ts` (no Phaser): struct Mail, ClearMailData / ClearMailStruct, MonHasMail,
  GiveMailToMon / GiveMailToMon2, TakeMailFromMon / TakeMailFromMon2, ClearMailItemId, SpeciesToMailSpecies /
  MailSpeciesToSpecies, plus pokemon_icon.c's MailSpeciesToIconSpecies; the Game Corner's photo special and the
  trainer card now use these instead of their own copies. `GameState.mail` (gSaveBlock1Ptr->mail[16], ClearMailData
  in the constructor; InitEasyChatPhrases clears the words), MON_DATA_MAIL as the party-only `Pokemon.mail` (absent =
  MAIL_NONE). Save version 11 (10 at first; renumbered at the merge after W-fame's 10): `mail` and each party mon's `mail` (an older save keeps the new-game slots).
- mail.c whole in `menus/mail.ts`: ReadMail, DoInitMailView's 19 steps, every mail type's graphics (graphics/mail/
  through extract_gfx.py) and textpals, sMessageLayouts_5x2 (and the unused 3x3), the gender colours, Bead / Dream
  Mail's icon (new CreateMonIcon_HandleDeoxys / LoadMonIconPalette / FreeMonIconPalette in menus/pokemonIcon.ts: the
  Unown letters' icon species are past NUM_SPECIES, which CreateMonIcon maps to SPECIES_NONE), BufferMailMessage
  (ConvertInternationalString for names under 6 chars), the help context by gPlayerPcMenuManager.notInRoom (now set
  by ui/PlayerPcMenu.ts). The menus preload the mail and Easy Chat graphics when the bag or the party holds mail.
- The party menu: give a mail from the bag or from ITEM → GIVE (also swapped for a held item), written on the Easy
  Chat screen (EASY_CHAT_TYPE_MAIL) and taken back on cancel; MAIL → READ; MAIL → TAKE → YES into the PC slots
  (TakeMailFromMon2; the mailbox screen is unit 2) or NO → YES into the bag. The bag's CHECK on a mail
  (FieldUseFunc_Mail: a blank mail). `special ShowEasyChatScreen` with EASY_CHAT_TYPE_MAIL edits VAR_0x8005's slot.
- On the way: CreateShedinja now clears the copy's mail and markings (both modelled now; the comment said neither
  was). The Easy Chat e2e helpers moved to tests/e2e/easyChatHelpers.ts for mail.test.ts.
- Left for W-mail unit 2: the PC mailbox (player_pc.c's mailbox, mailbox_pc.c, PARTY_ACTION_GIVE_MAILBOX_MAIL),
  daycare.c's DayCareMail, the in-game trade's mail (DONTAE's Jynx's Fab Mail reads as blank until then).
- Tests: tests/unit/mail.test.ts (8); tests/e2e/mail.test.ts (4: a Retro Mail bought at Celadon Dept. Store 4F,
  given from the bag with HI AWESOME typed, read, taken into the bag; ITEM → GIVE cancelled and written, Bead Mail's
  icon, TAKE → YES to the PC slots; CHECK; a held mail through SAVE and CONTINUE), passed three times in a row;
  easyChat.test.ts, fieldItems.test.ts, trainerCard.test.ts and gameCorner.test.ts's photo printer pass.

### The Fame Checker (W-fame, FIELD_ITEMS_PLAN.md batch 12)

- fame_checker.c whole in `menus/fameChecker.ts` (new): UseFameChecker and MainCB2_LoadFameChecker's setup (BG3 the
  background, BG2 the frame, BG1's 512 px info box / pick panel, BG0's four windows), the persons list with CANCEL
  (FC_PopulateListMenu, AdjustGiovanniIndexIfBeatenInGym, FC_DoMoveCursor's green / grey names), the six flavor-text
  icons (CreateFameCheckerObject's object events, PlaceQuestionMarkTile's "?"), the selector cursor and the dimmed
  icons (OBJ blending), the icon description box and its open / close animation, the pick mode (START: the person's
  trainer pic or Daisy / Fuji / Oak / Bill's own, in colour or as a silhouette, sliding in with the spinning Poké
  Ball and BG1; the name, or the quote with all six texts), the scroll arrows past five persons, the UI help line,
  B / CANCEL / SELECT (from the field) closing with a fade. `menus/itemUse.ts`: FieldUseFunc_FameChecker (from the
  bag, and with SELECT through FadeToScreenFromField / OpenScreenFromFieldOnceFaded); registeredItem.ts's "not
  implemented" fallback is Teachy TV's only now.
- Save data and specials in `state/fameChecker.ts` (new, Phaser-free): GameState.fameChecker, ResetFameChecker in
  the constructor (NewGameInitData), FullyUnlockFameChecker, SetFlavorTextFlagFromSpecialVars and
  UpdatePickStateFromSpecialVar8005 (out of specials.ts' NO_OP; the `famechecker` macro was already expanded by the
  extractor). SAVE_VERSION 9 → 10 (`fameChecker`; upgradeSave keeps the new-game state for a version 9 save).
- Extractor: `tools/extract_fame_checker.py` (new: fameChecker.json, loaded by Assets.init), `graphics/fame_checker/`
  in extract_gfx.py, and `paletteSlot` in the sprite manifest's `gba` info (extract.py's gba_info; the Fame
  Checker's objects draw with it). Rerun `npm run extract`.
- Shared files: state/saveData.ts (version 10), script/specials.ts (FAME_CHECKER_SPECIALS, NO_OP), menus/itemUse.ts,
  menus/registeredItem.ts (a comment), scenes/FieldMenuScene.ts (setObjectEventGraphicsInfo always; the Fame
  Checker's graphics for the bag / the registered item), data/Assets.ts, data/types.ts, dev/testHooks.ts
  (`fameChecker()`), tools/extract.py, tools/extract_gfx.py. No help context: the C sets none for it.
- Verified: typecheck; `npm test` (53 files, 653 tests; tests/unit/fameChecker.test.ts new, 7: the new-game state, both
  specials' rules, the save and a version 9 save, the extracted tables against fame_checker.c); e2e fameChecker.test.ts
  (new, 2 tests: the rival's battle and gift in Cerulean, the bag's USE, OAK / BILL / CANCEL, Bill's first text from
  the rival's icon, "?" elsewhere, the selector and dimming, pick mode with Bill's silhouette and Oak in colour with
  his name, B back to the bag and the field; Brock beaten in his gym, SELECT from the field, his icon and text, his
  pic in colour, B back to the field without the bag, the flags through a save and CONTINUE, SELECT closing it),
  registeredItems, fieldItems. Screenshots of the list, a flavor text, a silhouette and Brock's pic match the GBA's
  layout.

### W-mail 2: the PC mailbox, the daycare's mail, the in-game trade's mail (FIELD_ITEMS_PLAN.md, batch 12)

- player_pc.c's mailbox in `ui/PlayerPcMenu.ts` and mailbox_pc.c in the new `ui/MailboxPc.ts` (field overlays):
  Task_PlayerPcMailbox ("There's no MAIL here." when CountPCMail is 0), PCMailCompaction, the list (the writers'
  names by ItemPrintFunc, CANCEL, eight rows, upText_Y 10, the scroll arrows past seven mails), "What would you like
  to do with X's MAIL?" (trailing spaces cut), READ (ReadMail on FieldMenuScene through the host's new
  `enterScreen`, back through CB2_ReturnToMailbox), MOVE TO BAG (YES / NO, "The BAG is full." or "The MAIL was
  returned to the BAG with its message erased."), GIVE (party_menu.c's ChooseMonToGiveMailFromMailbox and
  TryGiveMailToSelectedMon for PARTY_ACTION_GIVE_MAILBOX_MAIL, back through
  CB2_ReturnToMailboxPc_UpdateScrollVariables), EXIT; the mailbox's help contexts. `gPlayerPcMenuManager` (world/mail.ts)
  has cursorPos / itemsAbove / count / pageItems now; CountPCMail, PCMailCompaction and SELECTED_MAIL (`selectedPcMail`)
  are there too. OverworldScene's PlayerPcMenu host passes the state (no `countPcMail: () => 0`) and `hideMessage`.
- daycare.c's struct DayCareMail (`DaycareMon.mail?`, absent = cleared): StorePokemonInDaycare's MonHasMail branch
  (the message, the player's name, the nickname; TakeMailFromMon), TakeSelectedPokemonFromDaycare's GiveMailToMon2,
  ShiftDaycareSlots moving it up, ClearDaycareMonMail, BufferDayCareMonReceivedMail and the special
  DaycareMonReceivedMail (no FRLG script calls it). Save version 13 (12 at first; renumbered at the merge after W-qlog 1's 12): the daycare mons' `mail`; upgrading a version 12
  save frees the party mail slots no party mon points at (a mon left in a daycare before kept its mail item but leaked
  its slot).
- trade_scene.c's GetInGameTradeMail (sInGameTradeMailMessages through extract_trades.py's `mailMessages`; the OT id
  big-endian as the C writes it) into gLinkPartnerMail[0] with the mon's mail id 0, and TradeMons' mail lines (the
  player's mon's slot cleared, the partner mail given to the mon received): DONTAE's Jynx's Fab Mail now reads
  "THAT'S A HEALTHY JYNX! BE KIND TO IT" from DONTAE.
- field_specials.c's mail lines (UpdateTrainerCardPhotoIcons' SpeciesToMailSpecies) were already on world/mail.ts
  since unit 1.
- Fixed on the way: the player's PC menus printed their items at the font's maxLetterWidth (10 px) instead of
  GetMenuCursorDimensionByFont(FONT_NORMAL, 0) (8). The duplicated save and item-use lines in DEVIATIONS.md (merge
  leftovers) are tidied.
- Tests: tests/unit/mail.test.ts (+3: CountPCMail / PCMailCompaction, SELECTED_MAIL, the version 11 upgrade),
  daycare.test.ts (+5: the mail into the daycare and back, another item kept, ShiftDaycareSlots, DaycareMonReceivedMail,
  the save), inGameTrades.test.ts (+2: the trade mail message, GetInGameTradeMail and TradeMons); tests/e2e/mail.test.ts
  (+4: the mailbox empty / READ / MOVE TO BAG with the bag full and not / GIVE; ten mails scrolled to the last and
  read; a mon with mail through the Route 5 daycare and read after; DONTAE's Fab Mail read after the trade), passed
  three times in a row; daycare, inGameTrades and pcStorage e2e pass.

### W-qlog 1: the quest log's recording and the scenes in the save (QUEST_LOG_PLAN.md QL1, batch 12)

- New `world/questLog.ts` (quest_log.c's recording half), `questLogEvents.ts` (quest_log_events.c: the u16 command
  stream as the C lays it out, RecordEventHeader's repeats, SetQuestLogEvent with its filters, the deferred trainer /
  link events, QL_EVENT_DEPARTED and QL_EVENT_ARRIVED), `questLogLocations.ts` (field_specials.c's departed
  locations), `questLogObjects.ts` (QL_RecordObjects), `questLogPlayer.ts` (the gfx transition records); data from
  the new `tools/extract_quest_log.py` (public/gen/questLog.json: MAP_* group / number / MAPSEC, the location and
  flag tables, the command sizes). The field's hooks record what the C records: the player's steps
  (PlayerSetAnimId), the gfx transitions, getting off Surf, Strength, fishing, the VS Seeker, NPC faces and steps
  (NpcBrain's `onSingleMovement`), the field input that took the controls (gFieldInputRecord), and the frames
  between actions (QL_TryRunActions while the controls are free). Scenes start at an event (here: leaving one of
  the 51 buildings / caves / gates, entering a town for the first time) and end when the 128-u16 script or the
  32-action buffer is full, on a cut (`special QuestLog_CutRecording`, ShowTownMap, ShowDiploma, a white-out, a
  Victory Road switch, walking into a disabled location), on a rematch, or on a save (SaveQuestLogData from the save
  dialog and the Hall of Fame, which also sorts the scenes oldest first). GetQuestLogState writes the real state.
  The save keeps the four scenes: SAVE_VERSION 12 after W-fame's 10 and W-mail's 11 (upgradeSave gives a version 11
  save none).
- Found on the way: the after-rival start preset now sets VAR_QLBAK_MAP_LAYOUT as leaving the house does (BackUpMapLayout
  at the departure's scene start); newGame.test.ts compares the preset against a real playthrough and caught it.
- Not done (QL2-QL5): playback on CONTINUE (QL_ResetForContinue stands in: the next scene goes after the saved ones),
  the other events' recorders and texts, the menus' call sites, QL_AvoidDisplay and `goto_if_questlog`.
- Tests: tests/unit/questLog.test.ts (19: the codecs against the C's byte layout, a scene's head, the frames
  between actions, the stream filling up after 30 steps, repeats past MAX_CMD_REPEAT, the ring of four and the
  save's sort, the filters, the departed locations, the save round trip), tests/e2e/questLog.test.ts (3: leave the
  house, walk, save; Daisy's cut; the fan club). Ran field, playerAvatar, saveContinue, hallOfFame, trainerBattle
  and newGame e2e files: all pass, nothing in the field changed.

### W-qlog 2a: the quest log's playback engine (QUEST_LOG_PLAN.md QL2a, batch 12)

- New `world/questLogPlayback.ts` (quest_log.c's playback: TryStartQuestLogPlayback, Task_BeginQuestLogPlayback,
  QLPlayback_InitOverworldState, QL_CopySaveState / RestoreTrainerRematches, QL_ResetPartyAndPC,
  QL_RestoreMapLayoutId, QLogCB_Playback with QuestLog_PlayCurrentEvent / HandleShowQuestLogMessage /
  GetQuestLogTextDisplayDuration, QL_HandleInput, QL_IsTrainerSightDisabled, DoSceneEndTransition /
  QuestLog_AdvancePlayhead, DoSkipToEndTransition / QuestLog_WaitFadeAndCancelPlayback, QuestLog_StartFinalScene,
  FieldCB2_FinalScene and the end tasks to Task_EndQuestLog); `world/questLog.ts` gets the action half
  (ResetActions' and QL_TryRunActions' RUNNING cases, sMovementScripts, QL_UpdateObject, gQuestLogFieldInput,
  ReadQuestLogScriptFromSav1, SetQuestLogState's playback branch); quest_log_objects.c's template load and
  QL_TryStopSurfing; quest_log_player.c's QuestLogUpdatePlayerSprite (normal, bike, surf, getting off).
- OverworldScene: continueSavedGame starts from QL_ResetOnSoftReset (replaces QL1's QL_ResetForContinue stand-in:
  sCurrentSceneNum now comes from the playback) and TryStartQuestLogPlayback; the scene loads
  (loadQuestLogScene: LoadMap_QLPlayback's steps around enterMap, hooks in onMapLoaded for the templates and the
  objects), DoCB1_Overworld_QuestLogPlayback beside DoCB1_Overworld in tickField, QL_UpdateObject for the player
  and the NPCs made during playback (NpcBrain `questLogUpdate`), the final scene reloading the save slot
  (`savedGame`) through enterSavedField (CB2_ContinueSavedGame's steps, shared with CONTINUE). The screen (tints,
  bars, texts, music) is QL2b's: `questLogScreen` seams.
- Shared bits: ObjectEvent.setHeldMovement replaces a held action while playback runs (ObjectEventSetHeldMovement);
  ScreenFade takes negative delays as the C does (deltaY += -delay: the skips' FadeScreen(FADE_TO_BLACK, -3));
  ScriptEngine.init (ScriptContext_Init); trainerSee checks QL_IsTrainerSightDisabled; the test probe's `free()`
  (so `idle()`) waits for the playback's end; `__test.questLog().playback`.
- Found on the way: QL1 recorded the steps of the neighbouring maps' NPCs (the port spawns them, the GBA doesn't),
  which playback, going by local id, then gave to the current map's NPC with that id: only the current map's are
  recorded now. QL_ResetPartyAndPC's "too many" branch clears the party's last slots (PARTY_SIZE - 1 - i), not the
  extra mons, as the C does (a two-mon party stays two against a one-mon scene).
- Tests: tests/unit/questLog.test.ts (21: + playback's action timing and the controls' hold),
  tests/e2e/questLog.test.ts (5: + two scenes played on CONTINUE with each scene's flags, empty bag and placeholder
  Rattata, the player and Pallet Town's NPCs ending each scene where they were recorded, the field afterwards
  equal to the save; A skips a scene, B to the end with the map name and no "saved the game"). Ran saveContinue,
  titleScreen, field, newGame, hallOfFame, mapMusic, weather, mail, daycare and fameChecker e2e files: all pass.

### W-qlog-events: the quest log's event codecs for QL_EVENT_* 3-29 (QUEST_LOG_PLAN.md QL3a, batch 12)

- New `world/questLogEventCodecs.ts`: quest_log_events.c's RecordEvent_* / LoadEvent_* for SWITCHED_PARTY_ORDER,
  USED_ITEM (items, key items, TMs / HMs learned or replacing a move, the Escape Rope with its map section, which
  stops recording steps until the next departure and so ends the scene), GAVE_HELD_ITEM(_BAG / _PC), TOOK_HELD_ITEM,
  SWAPPED_HELD_ITEM(_PC), USED_PKMN_CENTER (header only; a second heal at the same action writes nothing), the link
  events 12-19 (their own header, no repeats; TranslateLinkPartnersName; no callers until link play), the box events
  20-27 (the box bytes packed into a u16 as the C's u8 casts do; a party-first SWITCHED_PARTY_MON_FOR_PC_MON swapped
  round; "a different spot" for the same box twice) and DEPOSITED / WITHDREW_ITEM_PC, with the shared helpers
  (QuestLog_GetSpeciesName incl. the egg, GetBoxNamePtr, sBattleOutcomeTexts). Loaders expand the line into
  gStringVar4 as the C does. questLogEvents.ts registers them in ensureEventTables and exports LoadEvent and
  QL_DisableRecordingStepsUntilDepart.
- `tools/extract.py` reads src/data/text/quest_log.h with strings.c: all 125 gText_QuestLog_* in strings.json, for
  QL2b's and QL3b's texts too.
- Not done: events 30-42 and quest_log_battle.c (QL3b); the menus' call sites (QL4).
- Tests: tests/unit/questLogEvents.test.ts (17: every event recorded into a scene and loaded back to its line, against
  quest_log.h's string with the buffers filled as the C fills them; the stream's words; repeats loaded copy by copy
  with QL_TryRepeatEvent; the Pokémon Center's non-repeat; the Escape Rope's scene end; the link events through the
  deferred path; TranslateLinkPartnersName), tests/e2e/questLog.test.ts (+1: three events through
  `__test.questLogEvent` in a running game, a repeat, the save's stream).
