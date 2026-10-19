# Status

Status of the port: what exists, what's next. Everything else lives in `docs/`:

- [docs/DEV_NOTES.md](docs/DEV_NOTES.md): how each subsystem fits together, where to hook in, how to test it.
- [docs/DEVIATIONS.md](docs/DEVIATIONS.md): placeholders and approximations (so they aren't mistaken for ports), and
  deliberate QOL changes.
- [docs/WORKFLOW.md](docs/WORKFLOW.md): how a batch of parallel workers is planned, run and merged.
- [docs/LOG.md](docs/LOG.md): one entry per change, newest at the bottom. Search it (`grep -n`) for the history of
  a subsystem; don't read it end to end.

## Where things stand

- **Boot:** title screen → main menu (CONTINUE / NEW GAME) → Oak's speech (gender, player and rival names).
- **Playable:** new game in Player's House 2F → Pallet Town → Oak's trigger → lab intro → choose a starter
  (picture box, YES/NO, nickname prompt → naming screen) → rival picks → the rival battle → rival leaves. Mom heals
  the party. Route 1 clerk Potion.
- **Story checked headless:** the Viridian Mart parcel scene, Oak's parcel → Pokédex scene, the Viridian old man's
  catching tutorial, Viridian Forest trainers, Brock; every gym and required story event after it, as e2e tests
  (`story.test.ts`, `storyCeladonSaffron.test.ts`, `storyLeague.test.ts`: Misty to Giovanni, Bill, the S.S. Anne,
  the Rocket Hideout, Pokémon Tower, Silph Co., the Safari Zone, Cinnabar, Route 22/23, the Elite Four and the
  Champion); the ending (Hall of Fame room → Hall of Fame → credits → reset → CONTINUE in Pallet Town); Bill's
  Sevii 1-3 trip after Blaine (`seviiQuest.test.ts`: Celio, the bikers, Lostelle, back to Cinnabar); the postgame
  (`postgame*.test.ts`: Oak's National Dex, Kindle Road, Mt. Ember and the Ruby, the Rainbow Pass, Four Island and
  Icefall Cave, Six Island's Dotted Hole and the Sapphire theft, Five Island's Rocket Warehouse and Celio's network
  machine, Seven Island's Tanoby Key and chambers; `trainerTower.test.ts`: a full climb; `eventIslands.test.ts`:
  Lugia, Ho-Oh, Deoxys; `postgameKanto*.test.ts`: Cerulean Cave and Mewtwo, every legendary's battle to its end,
  the National Dex's effects in Kanto, the Elite Four rematch teams).

## Next up

**Audio is done** ([AUDIO_PLAN.md](AUDIO_PLAN.md) complete: batches A-D, PRs #84-#111). `npm run dev`, press any
key (M mutes): the m4a engine (`src/audio/`: sequencer, DirectSound mixer, CgbSound and the PSG synth) plays every
song, SE and cry, checked against the ROM in mGBA (W-ref 2: the DirectSound mix, the CgbChannels and the sound
registers are identical frame by frame on 31 songs, SEs and cries; the listening page is in
`/Users/joshua/Coding/PokemonProjects/wref-scratch/wref2/index.html`). Every call site the plan lists makes its
sound: the field, map music (saved), the battle (music in the transition, the controllers, scripts, balls, the low
HP beep, the anims' panned SEs and waits), the scenes (evolution, eggs, trades, Hall of Fame, credits, Pokédex,
title), the ambient cries. Every audio wait times as on the GBA. Deferred: the quest log and link play (AUDIO_PLAN.md "Batch D result").

**The postgame is done** ([POSTGAME_PLAN.md](POSTGAME_PLAN.md) complete in one batch, batch 10: PRs #114-#125). The
42 postgame gaps are ported: braille, field weather (FRLG's Shade and horizontal fog: Viridian Forest, Pokémon Tower,
the Mansion, Berry Forest, the Lost Cave, the Tanoby chambers, Navel Rock), Icefall Cave's ice (field_tasks.c step
callbacks, `warphole`), the Heracross record, Resort Gorgeous, SetPostgameFlags, the Trainer Tower (trainer_tower.c,
its battles, the records board, battle_records.c), ShakeScreen, the event islands (the tickets from the Hall of
Fame as in REVISION 0xA, a deliberate QOL change; Lugia, Ho-Oh, the Deoxys triangle). Save version 9.

**The single-player gaps are closed** ([GAPS_PLAN.md](GAPS_PLAN.md) complete in batch 11: PRs #127-#134): the map
preview screens (map_preview_screen.c: every cave and forest banner), the L/R help system (help_system.c,
help_system_util.c: the menus, the text, the BGM halving, the contexts at every ported screen), the intro movie
(intro.c: the copyright screen, the Game Freak scene, Gengar vs Nidorino, the title screen's timeout back to it), and
a Kanto postgame sweep (Cerulean Cave through Mewtwo's battle, every legendary's battle caught / beaten / fled;
IsNationalPokedexEnabled now checks all three of the C's conditions everywhere; the Elite Four rematch teams and
Kanto's postgame NPCs checked).

**Mail, the Fame Checker and Teachy TV are done** ([FIELD_ITEMS_PLAN.md](FIELD_ITEMS_PLAN.md) complete in batch 12:
PRs #136-#148): mail (mail_data.c, the mail screen, the party menu's mail actions, the PC mailbox, the daycare's
and DONTAE's Fab Mail), the Fame Checker (fame_checker.c and its two specials), Teachy TV (teachy_tv.c, the
Pokédude's four battles, his REGISTER bag and TM case demos). Save version 13.

**The quest log is in up to its menu calls** ([QUEST_LOG_PLAN.md](QUEST_LOG_PLAN.md) QL1-QL4a, batch 12): recording
(the four scenes in the save, the departed / arrived locations), playback on CONTINUE ("Previously on your quest",
the grey field, the windows and texts, A / B skips, "saved the game at"), every QL_EVENT_* codec and its text, and
the events from item use, the party menu, the PCs, the boxes and Fly.

**The rest of FRLG's field weathers and the dynamic-graphics objects are done** ([GAPS_PLAN.md](GAPS_PLAN.md)
"Batch 13", PRs #152-#156): every sWeatherFuncs row runs as the C has it (rain, thunderstorm, downpour with their
SE3 loops and PlayRainStoppingSoundEffect; snow, ash, sandstorm; clouds, the diagonal fog, the drought, the bubbles)
on a weather sprite layer with the GBA's BLDALPHA; no FRLG map reaches them, `setweather` / `doweather` do. Dynamic
objects (`OBJ_EVENT_GFX_VAR_*`) load a sheet set mid-script on demand, so `addobject` spawns them that frame.

Next: the quest log's last two units (QUEST_LOG_PLAN.md, batch 14): QL4b (the shops, the TM case / berry pouch
transactions, the Pokémon Center, story items, the battles, the Game Corner) and QL5 (QL_AvoidDisplay,
`goto_if_questlog`, the escalators, the Surf / Strength / fishing recordings, playback's fanfare / cry / text
differences, its help contexts, a battle's end in playback, the "no quest log" DEVIATIONS sweep). After that, link
play is the big area left (needs a decision from the user about networking).

[SIDE_PLAN.md](SIDE_PLAN.md) batch 3 is in (PRs #79-#81): `adddecoration`,
`bufferdecorationname` (and the other decoration commands) and FLDEFF_USE_DIVE with DoDiveWarp, ported as FRLG's C
has them; the `unused` gap tag is gone.

[SIDE_PLAN.md](SIDE_PLAN.md) batch 2 is in (PRs #69-#77): the Seagallop ferry from every harbor and Bill's
One Island trip and back, the S.S. Anne's departure (ss_anne.c) and a sweep of the S.S. Anne (nothing else was
wrong), the Elite Four / Champion rooms' lighting, `multichoice` resuming a frame after the choice, and Easy Chat
(easy_chat*.c: the Pewter profile, the questionnaire, the trainer card's profile words; save version 5).
Batch 1 (PRs #56-#67): Prof. Oak's Pokédex rating (in person and on the
PC), the move tutors, move deleter, move relearner and Cape Brink tutor, ChoosePartyMon, the in-game trades with
their trade scene, the Name Rater, the Game Corner (coins box, clerks, prize room, slot machine, photo printer),
the museum's fossil pics and the fossil revival, the Route 5 and Four Island daycares, eggs, `giveegg`, egg
hatching, holes (DoFallWarp), Daisy's grooming, the Magikarp record, the diploma and the Trainer Fan Club.

[MAIN_PATH_PLAN.md](MAIN_PATH_PLAN.md) is done. [SCREENS_PLAN.md](SCREENS_PLAN.md) batches 1 and 2 are in: the
Pokédex, TM case, berry pouch, field items, registered SELECT items, the option menu and start menu help window,
the trainer card, and headless story checks from Brock to the Hall of Fame.

No known main-path blockers are left: the story checks found and fixed four (Lt. Surge's trash cans, the Rocket
Hideout's `call_if_defeated` barrier, `GetQuestLogState` leaving VAR_RESULT stale so `trainerbattle_no_intro`
could skip its battle, every nurse's YES/NO throwing on a constant expression). `tests/unit/scriptCoverageGaps.ts`
lists what the scripts use that isn't ported: 0 main, 0 side, 0 postgame, 43 link (what FRLG compiles but never
reaches, the decoration commands and Dive, is ported as the C has it).

Other open work:

- The quest log's QL4b and QL5 (QUEST_LOG_PLAN.md; `goto_if_questlog` never branches until QL5).
- Link play (the cable club's link specials are stand-ins that never find a partner; the Seven Island house's
  e-Reader battle room).
- More e2e scenarios (see the checklist's Tests section).
- Contest conditions/sheen aren't modelled.

Loose ends:

- postgameSevenIsland's Sevault Canyon fails now and then, alone too (also before batch 13): COOLTRAINER_LEROY's
  fight doesn't finish within the mash (batch 12's and 13's LOG entries). (postgameKantoLegendaries' bird catches
  were a test race, fixed in batch 13.)

## Checklist

`[x]` done · `[~]` partial (see note) · `[ ]` not started.

### Pipeline (tools/extract.py → public/gen/)
- [x] Maps + layouts (blocks, border, connections, events)
- [x] Tilesets: one atlas per primary, one per (primary, secondary) pair + overrides; attributes per tileset
- [x] Overworld sprites (object event pic tables + palettes)
- [x] Constants: metatile behaviors, new-game hidden-object flags
- [x] Fonts (latin normal/male/female/small) + glyph widths + font metrics
- [x] Charmap (for encoding decomp strings exactly as preproc does)
- [x] Text strings (all `.string` labels reachable from event_scripts.s)
- [x] Dialogue window frame graphics + palette, down-arrow indicator
- [x] Scripts (event_scripts.s + all includes → instruction streams with labels; macros defined in script files expanded)
- [x] Numeric constants (`#define`s incl. simple expressions, event macro symbols, std script table)
- [x] NPC text colours per graphics id (sTextColorTable)
- [x] C strings from src/strings.c (menu labels etc.)
- [x] Std window frames (type1..10, palette from each PNG); menu cursor is the ▶ font glyph
- [x] Tilesets split into bottom/middle/top atlases (BG3/BG2/BG1 as DrawMetatile fills them), the JASC palettes
  they were drawn with (`tilesets/palettes.json`) and each tileset's anim callback; tile anim frames are gfx symbols
- [x] Door animations (`doors.json`: sDoorGraphics + DoorAnimFrame lists; door tiles as gfx symbols)
- [x] Field effect graphics: emote icons (`field_effects/emoticons.*`) and every gFieldEffectObjectTemplate_*
  (`field_effects/obj_<Name>.png` + `objects.json`: frame size, anims, callback, the reflection distortion affine
  anims); object sprite sheets in their reflection palette (`sprites/<key>_reflection.png`)
- [x] Species (base stats, names, learnsets, national dex numbers), moves, items, experience tables, nature table, std strings
- [x] Trainers / trainer parties (battle/tables.json)
- [x] Wild encounters data (`wild_encounters.json`: FireRed gWildMonHeaders, ENCOUNTER_CHANCE_* slot totals, sUnownLetterSlots)
- [x] Battle graphics by C INCBIN symbol as decompressed ROM bytes (`tools/extract_gfx.py` → gen/gfx/): interface, terrain, balls, trainer/mon front+back pics and palettes, fonts
- [x] Battle scripts (assembled ROM image), battle strings, mechanics tables, anim command tables (`tools/extract_anims.py`)
- [x] Shop buy menu graphics; GBA-native tileset tiles/palettes/metatiles (`tilesets/index.json` `symbols`) and object
  event pics/palettes (sprite manifest `gba`), with spritesheet_rules.mk / tileset_rules.mk applied by extract_gfx
- [x] Party menu / bag / item icon / mon icon / help-window graphics; `menus.json` (`tools/extract_menus.py`: mon and item icon tables, TM/HM + tutor learnsets, TM/HM + tutor moves, evolutions)
- [x] Move/status battle animation scripts (`battle/battle_anims.json`, `tools/extract_battle_anims.py`: assembled
  battle_anim_scripts.s with template/task pointers as named externs, sprite templates, anim OamData, pic/palette/bg tables)
- [x] Evolution scene graphics (`graphics/evolution_scene/`: moving background, sparkles)
- [x] Pure event macros (giveitem_msg, famechecker, trainerbattle_*, ...) expanded like the assembler would, incl. `.if/.elseif/.else` on arguments
- [x] Audio: songs (`audio/songs.json`, the decomp's mid2agb built into `tools/.bin/` and run), voicegroups,
  keysplits, samples, waves, cry tables (`tools/extract_audio.py`, `extract_audio_voices.py`); a C++ compiler needed

### Engine
- [x] Map rendering (bottom/middle/top BG layers), connections, border
- [x] Grid movement: walk, run, tap-to-turn, ledges
- [x] Collision: collision bits, elevation rules, directional impassable, objects
- [x] Sprite priority from elevation (UpdateObjectEventElevationAndPriority): priority-1 objects draw over the top map layer
- [x] Warps: doors (+ walk out), arrow/stair warps, step warps
- [x] NPC movement types (wander, look around, face, pace)
- [x] Hidden objects via flags
- [x] Object spawning: all of a map's sprites preloaded on entry, synchronous `addobject` (a dynamic object's sheet
  set mid-script loads on demand and spawns that frame), in-view spawning as the camera moves (TrySpawnObjectEvents)
- [x] Object lifetime across connections: replaced by the neighbour-map QOL change (see "Deliberate QOL changes"); templates reloaded from the header on every map entry (LoadObjEventTemplatesFromHeader)
- [x] `LOCALID_*` names resolved per map from map.json `local_id`
- [x] Input module with all GBA buttons (A, B, Start, Select, L, R), sampled per logic tick
- [x] Text engine: port of RenderText (speed + A/B speed-up, all FC control codes, \n \l \p, placeholders)
- [x] Message box (dialogue frame, down-arrow indicator)
- [x] Game state: flags, vars, names, options, trainer id, money, coins, party, PC boxes, bag, registered item, Pokédex
  seen/caught, game stats; all saved (state/saveData.ts)
- [x] Pokémon creation: CreateMon/CreateBoxMon port (personality, IVs, nature, ability, initial moveset, stats); GBA RNG (random.c)
- [x] Bag: AddBagItem/RemoveBagItem/CheckBagHasItem/CheckBagHasSpace incl. TM case / berry pouch handling
- [~] Script interpreter: flow/branching, flags/vars, msgbox via std scripts, text colour, movements, object add/remove/move, setmetatile, warps, delay. Unimplemented commands log once to the console
- [x] NPC talk (incl. across counters) / signs / coord triggers / map scripts (on transition, on frame, on load, on warp-into)
- [x] NPC text colours by gender
- [x] YES/NO box (sYesNo_WindowTemplate, 5-frame input delay, B = NO)
- [x] Multichoice menus (script_menu.c): `multichoice`, `multichoicedefault`, `multichoicegrid` from the extracted
  sMultichoiceLists (`scripts.json` `multichoices`)
- [x] Elevators (field_specials.c): floor select, "Now on:" window, AnimateElevator (camera shake + window view);
  MAP_DYNAMIC warps and `setdynamicwarp` (gSaveBlock1Ptr->dynamicWarp)
- [x] Poké Mart (shop.c + buy_menu_helpers.c): `pokemart`, BUY/SELL/SEE YA! field menu, buy menu with the map view
  (field tiles + object sprites on the GBA layer), regular and TM layouts, quantity box, YES/NO; SELL via the bag
- [~] Specials (`special X` / `specialvar`): table in `script/specials.ts` with one module per area spread in
  (story, side, misc, party menu, trades, Game Corner, daycare, egg hatch, help, Fame Checker, quest log); only link
  play's are no-ops. Unknown specials log once; what's left is in `tests/unit/scriptCoverageGaps.ts`
- [x] Party selection from scripts (party_menu_specials.c: ChoosePartyMon), move tutors (incl. Cape Brink), the
  move deleter, the move relearner (learn_move.c)
- [x] In-game trades (trade_scene.c's in-game path: the data, the specials, the wireless trade animation) and the
  Name Rater. Link trading and TradeEvolutionScene aren't ported
- [x] Game Corner: coins box (coins.c), clerks and prize room, the slot machine (slot_machine.c), the smiley and
  the photo printer
- [x] Daycares and eggs (daycare.c): Route 5 and Four Island, egg production, egg species / IVs / moves, `giveegg`,
  the level menu, the hatching scene
- [x] Side specials: Oak's Pokédex rating, the museum fossil pics, holes (DoFallWarp), Daisy, the Magikarp record,
  the diploma (diploma.c), the Trainer Fan Club, GetMartClerkObjectId
- [x] The Seagallop ferry (seagallop.c): the ferry scene, the harbors' destination menus (Tri-Pass, Rainbow Pass
  pages), Bill's One Island trip; the Navel Rock / Birth Island harbors without the event tickets
- [x] The S.S. Anne's departure (ss_anne.c: the ship sails off with its wake and smoke) and the Elite Four /
  Champion rooms' lighting (field_specials.c: BG palette 7 cycles, redrawn through world/TilesetVram.ts)
- [x] Easy Chat (easy_chat.c, easy_chat_2.c, easy_chat_3.c): the words, the screen (groups, A-Z keyboard, word
  list), ShowEasyChatScreen / ShowEasyChatMessage, the profile and the questionnaire; saved
- [x] Items: additem/removeitem/checkitem/checkitemspace/checkitemtype, giveitem/giveitem_msg through the std scripts,
  item balls (`finditem` → Std_FindItem), hidden items (EventScript_HiddenItemScript, incl. hidden coins); coins
  (checkcoins/addcoins/removecoins)
- [x] Buffer commands (species/lead mon/party nick/item/item plural/number/std string/string); `waitstate`
- [x] givemon, getpartysize, showmonpic/hidemonpic (picture box), fadescreen (palette-fade timing)
- [x] White-out (CB2_WhiteOut → DoWhiteOut → FieldCB_RushInjuredPokemonToCenter) and `setrespawn`
- [x] trainerbattle: every mode (BattleSetup_ConfigureTrainerBattle + the trainer_battle.inc scripts and their specials, gotobeatenscript, rematch checks against vs_seeker.c sRematches), started by talking or by trainer sight
- [x] Text colour through VAR_TEXT_COLOR / VAR_PREV_TEXT_COLOR (ContextNpcGetTextColor), VAR_LAST_TALKED
- [x] Movement emotes (`emote_*` → FLDEFF_*_ICON, `entities/FieldEffects.ts`); other field effects in movement scripts not yet
- [~] Interactions (GetInteractionScript): bg events with the elevation check, hidden items, metatile scripts (PCs,
  bookshelves, TVs, Poké Mart/Center signs, ...), walk-into signs (TrySetUpWalkIntoSignpostScript) and walking
  away from them, the signpost message frame, and closing a script's last message with a direction/L/R/START/SELECT
  (replayed as field input). PC: CreatePCMenu + AnimatePcTurnOn/Off, the item PC, Pokémon Storage System and Hall
  of Fame PC; GetInteractedWaterScript (Surf/Waterfall)
- [x] Start menu shell: items by flags, wrap-around cursor, remembered position, B/START close; every entry opens
  its real screen
- [x] Start menu help window (help_message.c, start_menu.c's descriptions) in HELP button mode
- [x] The L/R help system (help_system.c, help_system_util.c): the menus over any screen, its text, the BGM
  halving, the help contexts at every ported screen and the help specials
- [x] Tile animations (tileset_anims.c): General water/sand/flowers, Celadon fountain, Silph Co. fountain, Mt. Ember
  steam, Vermilion Gym door, Celadon Gym flowers
- [x] Door animations (field_door.c), Task_DoorWarp / Task_ExitDoor, `opendoor`/`closedoor`/`waitdooranim`/
  `setdooropen`/`setdoorclosed`
- [~] Field effects: ground effects (tall grass, jump landings: grass/splashes/dust, shadows, ripples, puddle
  splashes, feet in shallow water, sand footprints/bike tracks, hot springs, water/ice reflections). Not yet: the
  field move effects (Cut, Surf blob, Strength, Rock Smash, Fly bird, ...), the warp arrow,
  `dofieldeffect` in general (Pokémon Center heal is done; the coverage test lists the unported field effects)
- [x] Map name popup (map_name_popup.c): on warps into maps with show_map_name, on connections into another
  region map section (reshown if still up), floor numbers / ROOFTOP, dismissed when field input starts something
- [x] Save/load: SAVE dialog, main menu + CONTINUE, play time, one localStorage slot (state/saveData.ts), game stats,
  Hall of Fame records (their own key), `special Field_AskSaveTheGame`
- [x] Region map (region_map.c): the Town Map from the bag, the wall maps (`special ShowTownMap`), the fly map; Fly
  (FldEff_UseFly / FlyOut / FlyIn) to the heal locations of visited towns
- [x] Hall of Fame (hall_of_fame.c): EnterHallOfFame, FLDEFF_HALL_OF_FAME_RECORD, the Hall of Fame PC; the credits
  (credits.c) and SoftReset (BootScene's `softReset`)
- [x] `setmaplayoutindex` (layouts no map uses are extracted), `seteventmon`, Silph Co.'s card key doors
- [x] Party menu (party_menu.c) and bag (item_menu.c, bag.c, item_use.c) on the GBA layer, from the field and in battle; list menus, scroll arrows, mon/item icons, std/dialog frames, YES/NO, money box
- [x] Summary screen (pokemon_summary_screen.c): INFO / SKILLS / KNOWN MOVES pages, move details, switching moves, choosing a move to forget (field and battle)
- [x] Pokédex (pokedex_screen.c, pokedex.c): the top menu with seen/owned counts, the numerical lists (Kanto,
  national), the search lists (A to Z, type, lightest, smallest), the habitat pages with their page turn, the mon
  page (pic, category, height/weight, footprint, flavour text), the area page (wild_pokemon_area.c,
  pokedex_area_markers.c, the Sevii islands, the size comparison) and the "registered" page after a catch
- [x] TM case (tm_case.c) and berry pouch (berry_pouch.c): from the bag, GIVE (party, PC box), SELL, back from
  teaching / using; the berry pouch from the battle bag too
- [x] Options (option_menu.c; SOUND sets mono or stereo through SetPokemonCryStereo) and trainer card (trainer_card.c: front, back, flip; the
  player's FRLG card only, no link cards)
- [x] Field items: rods and fishing (Task_Fishing, FishingWildEncounter), Escape Rope, VS Seeker (vs_seeker.c:
  rematches, the raise-hand trainers, the charge), Itemfinder (itemfinder.c); Bike, Town Map, flutes, Repel, Coin
  Case, Powder Jar; registered items with SELECT (UseRegisteredKeyItemOnField: every key item's from-field
  variant, incl. the Town Map, TM case and berry pouch from the field); the Fame Checker (fame_checker.c), Teachy TV
  (teachy_tv.c, battle_controller_pokedude.c, the Pokédude's bag and TM case), mail (mail.c, mail_data.c, the PC
  mailbox, the daycare's and the in-game trade's mail)
- [~] Wild encounters: grass/water step encounters (wild_encounter.c: cooldown, rate buff, flutes, Cleanse Tag,
  Stench/Illuminate, repel + EventScript_RepelWoreOff, Altering Cave, Tanoby/Unown), StartWildBattle (standard,
  Pokémon Tower ghosts with the ghost pic, roamers, Safari Zone), CB2_EndWildBattle / CB2_EndSafariBattle.
  Rock Smash, Sweet Scent and fishing encounters
- [x] Scripted wild battles: `setwildbattle`, Pokémon Tower 6F's ghost Marowak (StartMarowakBattle /
  CB2_EndMarowakBattle, the Silph Scope unveil), `dowildbattle` (StartScriptedWildBattle: Snorlax, the legendaries)
  and StartLegendaryBattle
- [x] Roamers (roamer.c): InitRoamer, location sets + history, encounters, HP/status kept between battles
- [x] Safari Zone: safari_zone.c (Enter/ExitSafariMode, 600-step counter, retire, out-of-balls endings),
  battle_controller_safari.c, the Safari healthbox text, start menu RETIRE + stats window, entrance money box
- [x] Step counters (TryStartStepCountScript): happiness, field poison (incl. the BG mosaic flash and the faint/white-out
  script), VS Seeker charge counter (and its rematches), Safari steps, Daisy's massage cooldown; the daycares' steps, egg production and egg hatching
- [x] Return to field runs MAP_SCRIPT_ON_RESUME / ON_RETURN_TO_FIELD (after battles and the bag/party menu)
- [x] Trainer sight (trainer_see.c): sight lines + CheckPathBetweenTrainerAndPlayer, the "!" and walk-up, FRLG's
  camera pan to trainers offscreen above, ConfigureAndSetUpOneTrainerBattle. Disguised/buried trainers aren't ported
  (none in FRLG)
- [x] Battle engine core: script interpreter, turn flow, damage/effects, messages, AI (battle_ai_script_commands.c + switch/items), player/opponent/Oak-Old Man controllers
- [x] GBA video layer (src/gba: VRAM/palette/regs, bg.c, window.c, sprite.c, task.c, palette fades, scanline effects, software PPU) and the battle presentation on it (BattleScene)
- [x] Battle: bag and party menu (choose item, use medicine/PP items/X items/balls, switch/send out) with reshow_battle_screen.c
- [x] Old Man's catching tutorial (StartOldManTutorialBattle)
- [x] Battle: move/status animations (src/battle/anim/: the battle_anim.c engine and every battle_anim_*.c file;
  all 397 move, status, general and special anim scripts run, with their panned SEs and SE waits)
- [x] Battle transitions (battle_transition.c): every FRLG B_TRANSITION_* (the grey-blink intro, Blur, Swirl,
  Shuffle, Big Poké Ball, Poké Balls trail, Clockwise wipe, Ripple, Wave, Slice, White bars fade, Grid squares,
  Angled wipes, the Elite Four / Champion mugshots) drawn over the field on the GBA layer, picked like battle_setup.c
  (GetWildBattleTransition / GetTrainerBattleTransition; Old Man's tutorial uses Slice)
- [x] Warp screen effects: WarpFadeOutScreen / WarpFadeInScreen (white in and out of caves), the cave flash
  transitions (FlashTransition_Enter / _Exit from CB2_DoChangeMap), the barn door wipe leaving through a door
- [x] Map preview screens (map_preview_screen.c, fldeff_flash.c's RunMapPreviewScreen: the cave banners before
  the flash, the forest banners on map load, shorter on a second visit)
- [x] Field weather (field_weather.c, field_weather_util.c, field_weather_effects.c' FRLG weathers): every
  sWeatherFuncs row: None, Sunny, Shade (the gamma shift on the field's palettes and sheets), horizontal fog (the
  sprites, BLDALPHA blend), and the ones no FRLG map reaches (rain, thunderstorm, downpour with their SE3 loops and
  PlayRainStoppingSoundEffect; snow, ash, sandstorm; clouds, diagonal fog, drought, bubbles) on the weather sprite
  layer (world/weatherSprites.ts); `setweather` / `doweather` / `resetweather`, the saved weather
- [x] The postgame (POSTGAME_PLAN.md): braille (FONT_BRAILLE, `braillemessage`, BrailleCursorToggle), field_tasks.c's
  step callbacks (Icefall Cave's ice), `warphole`, ShakeScreen, the Trainer Tower (trainer_tower.c, its battles,
  battle_records.c), the event islands (tickets, Lugia, Ho-Oh, the Deoxys triangle and rock effects), the postgame
  specials (Heracross record, Resort Gorgeous, Lorelei's dolls, the sticker man, SetPostgameFlags)
- [x] Evolution scene (evolution_scene.c, evolution_graphics.c): after a battle (TryEvolvePokemon), from a Rare Candy
  or an evolution stone; holding B stops it; Crobat-style evolutions stop without the National Dex; learning the
  new species' move (incl. forgetting one through the summary screen); Nincada's Shedinja. TradeEvolutionScene
  isn't ported (no FRLG in-game trade evolves; no link trading)
- [x] Audio playback (AUDIO_PLAN.md): the m4a engine (`src/audio/`: sequencer, notes, channels, envelopes, the cry
  song, the DirectSound mixer and reverb, CgbSound and the PSG synth) runs every frame; sound.c (`gba/sound.ts`);
  map music (`gba/overworldMusic.ts`, savedMusic, the ambient cries); the field's, battle's and scenes' calls; the
  AudioWorklet output with autoplay and the mute key M.
- [x] Naming screen (naming_screen.c): every template (player, rival, PC box, nickname, caught mon); opened by
  ChangePokemonNickname from scripts and by the battle's nickname prompt after a catch
- [x] Copyright screen and intro movie (intro.c), title screen (title_screen.c, clear save data screen) and Oak's
  speech (oak_speech.c)
- [~] Quest log (quest_log*.c, QUEST_LOG_PLAN.md): recording and the scenes in the save (QL1), playback on CONTINUE
  (QL2a-b), every event's codec and text (QL3a-b), the menus' calls (QL4a). Left: QL4b, QL5

### Tests (tests/README.md)
- [x] Unit tests (Vitest, Node): random.c, CreateMon/CalculateMonStats/levels/movesets/natures/gender/PP, Bag,
  GameState (money, coins, flags/vars, temps, party), charmap, CalculateBaseDamage
- [x] E2E harness: headless Chrome over CDP, dev-only `window.__test` hooks (virtual pad, per-tick in-page
  mashing, walk/walkTo pathfinding, event log, state probes, `?seed=` `?speed=` `?textSpeed=`)
- [x] E2E scenarios: new game → Oak → starter → rival battle (and the after-rival preset matches it), trainer
  sight, trainer battle won (prize, flag, no rematch) and lost (white-out home, heal, money loss), wild encounter
  in grass, running, Master Ball catch + nickname, Poké Mart purchase, walking/doors/stairs/talking, evolution
  (after a battle, learning a move with a full moveset, stopping it with B, Rare Candy and Fire Stone from the bag),
  the Pokédex (lists, mon page, habitats, area page, registering a catch), TM case / berry pouch, rods, Escape
  Rope, VS Seeker, Itemfinder, registered items, options, trainer card, the story gym by gym; move tutors /
  deleter / relearner, in-game trades and the Name Rater, the Game Corner, Oak's rating and the fossils, the
  daycares, eggs and hatching, holes and the other side specials; the Seagallop ferry from every harbor and the
  Sevii 1-3 quest, the S.S. Anne (ticket check, departure, the dock after), the league lighting, Easy Chat; field
  weather; the postgame from Oak's National Dex to Seven Island, the Trainer Tower, the event islands, the
  legendaries' battles and the Kanto postgame; map preview screens, the help system, the intro; mail, the Fame
  Checker, Teachy TV, the quest log
- [x] Script coverage unit test: every script command, special, std script, movement action and field effect the
  scripts use, against the port's tables; known gaps tagged in `tests/unit/scriptCoverageGaps.ts`
- [ ] More scenarios: party menu from the start menu, items in battle, level-up move learning, the Old Man
  tutorial, Viridian parcel → Pokédex, elevators, item balls, PCs
