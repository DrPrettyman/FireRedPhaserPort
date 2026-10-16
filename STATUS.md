# Status

Status of the port: what exists, what's next. Everything else lives in `docs/`:

- [docs/DEV_NOTES.md](docs/DEV_NOTES.md): how each subsystem fits together, where to hook in, how to test it.
- [docs/DEVIATIONS.md](docs/DEVIATIONS.md): placeholders and approximations (so they aren't mistaken for ports), and
  deliberate QOL changes.
- [docs/LOG.md](docs/LOG.md): one entry per change, newest at the bottom. Search it (`grep -n`) for the history of
  a subsystem; don't read it end to end.

## Where things stand

- **Playable:** new game in Player's House 2F → Pallet Town → Oak's trigger → lab intro → choose a starter
  (picture box, YES/NO, nickname prompt → naming screen) → rival picks → the rival battle → rival leaves. Mom heals
  the party. Route 1 clerk Potion.
- **Story checked headless:** the Viridian Mart parcel scene, Oak's parcel → Pokédex scene, the Viridian old man's
  catching tutorial, Viridian Forest trainers, Brock.

## Next up

Main-path blockers, roughly in the order a playthrough hits them:

1. **PC storage** (pokemon_storage_system.c): a 7th mon has nowhere to go (`givemon` returns MON_CANT_GIVE, the
   "sent to PC" message is cosmetic). Also the PC menu's storage entry and `ChangeBoxPokemonNickname`.
2. **Save/load** (save.c, load_save.c): nothing persists.
3. **Field moves**, Cut first (Vermilion Gym), then Flash, Surf, Strength, Rock Smash, Fly, Waterfall: the party
   menu's field-move path (always "can't be used here" now), each move's field effect (`dofieldeffect`), and for
   Surf/Waterfall GetInteractedWaterScript.
4. **`special ListMenu`** (the scrolling list menu): Silph Co.'s elevator.

Other open work:

- Battle move animations: steps 1-2 done (264 of 397 scripts run). Step 3 of
  [BATTLE_ANIMS_PLAN.md](BATTLE_ANIMS_PLAN.md) (battle_anim_effects_1/2/3.c) is all that's left.
- Audio: extraction and playback (SE, cries and BGM are no-ops; see DEVIATIONS for what waits on them).
- Title screen, intro, Oak's speech (the naming screen is ready for it; see DEV_NOTES "Naming screen").
- Start menu screens: Pokédex, options, TM case, berry pouch; the start menu help window.
- Map preview screens (map_preview_screen.c): TryDoMapTransition already knows where they'd run.
- Bag items that need field systems: bike, rods (fishing), Escape Rope, Itemfinder, VS Seeker, Town Map, Fame
  Checker, Teachy TV. Rock Smash and Sweet Scent encounters come with their field moves.
- Daycare and egg hatching; the item PC (PlayerPC) and Hall of Fame PC.
- `dowildbattle` (StartScriptedWildBattle + CB2_EndScriptedWildBattle) and `special StartLegendaryBattle`: Snorlax,
  the legendary birds, Mewtwo. `setwildbattle` and the field side (`host.startScriptedBattle` +
  `host.wildBattleTransition`) are in place from the Marowak battle.
- More e2e scenarios (see the checklist's Tests section).

Loose ends:

- Dynamic-graphics objects (`OBJ_EVENT_GFX_VAR_*`) are only checked on Viridian's old man; other maps that use them
  (e.g. rival appearances) are untested. A script that sets `VAR_OBJ_GFX_ID_*` and then `addobject`s in the same
  run only works if that sprite was already preloaded; otherwise it logs `[overworld] no sprite loaded`.

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
- [ ] Audio

### Engine
- [x] Map rendering (bottom/middle/top BG layers), connections, border
- [x] Grid movement: walk, run, tap-to-turn, ledges
- [x] Collision: collision bits, elevation rules, directional impassable, objects
- [x] Sprite priority from elevation (UpdateObjectEventElevationAndPriority): priority-1 objects draw over the top map layer
- [x] Warps: doors (+ walk out), arrow/stair warps, step warps
- [x] NPC movement types (wander, look around, face, pace)
- [x] Hidden objects via flags
- [x] Object spawning: all of a map's sprites preloaded on entry, synchronous `addobject`, in-view spawning as the camera moves (TrySpawnObjectEvents)
- [x] Object lifetime across connections: replaced by the neighbour-map QOL change (see "Deliberate QOL changes"); templates reloaded from the header on every map entry (LoadObjEventTemplatesFromHeader)
- [x] `LOCALID_*` names resolved per map from map.json `local_id`
- [x] Input module with all GBA buttons (A, B, Start, Select, L, R), sampled per logic tick
- [x] Text engine: port of RenderText (speed + A/B speed-up, all FC control codes, \n \l \p, placeholders)
- [x] Message box (dialogue frame, down-arrow indicator)
- [~] Game state: flags, vars, names, text speed, trainer id, money, party, bag, Pokédex seen/caught (in memory only; player/rival names are placeholders until Oak's speech calls the naming screen)
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
- [~] Specials (`special X` / `specialvar`): table in `script/specials.ts`; HealPlayerParty, GetPokedexCount, EnableNationalPokedex, GetQuestLogState, GetPartyMonSpecies, BufferMonNickname, ChangePokemonNickname (naming screen), plus no-ops for audio/quest log/help/fame checker. Unknown specials log once
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
  (replayed as field input). PC: CreatePCMenu + AnimatePcTurnOn/Off; the item PC, Pokémon Storage System and Hall
  of Fame PC aren't ported. Not yet: GetInteractedWaterScript (Surf/Waterfall)
- [~] Start menu shell: items by flags, wrap-around cursor, remembered position, B/START close. POKéMON and BAG open the real screens; the other entries (except EXIT) show a "not implemented" notice
- [ ] Start menu help/description window
- [x] Tile animations (tileset_anims.c): General water/sand/flowers, Celadon fountain, Silph Co. fountain, Mt. Ember
  steam, Vermilion Gym door, Celadon Gym flowers
- [x] Door animations (field_door.c), Task_DoorWarp / Task_ExitDoor, `opendoor`/`closedoor`/`waitdooranim`/
  `setdooropen`/`setdoorclosed`
- [~] Field effects: ground effects (tall grass, jump landings: grass/splashes/dust, shadows, ripples, puddle
  splashes, feet in shallow water, sand footprints/bike tracks, hot springs, water/ice reflections). Not yet: the
  field move effects (Cut, Surf blob, Strength, Rock Smash, Fly bird, ...), the warp arrow, Pokémon Center heal,
  `dofieldeffect` in general
- [x] Map name popup (map_name_popup.c): on warps into maps with show_map_name, on connections into another
  region map section (reshown if still up), floor numbers / ROOFTOP, dismissed when field input starts something
- [ ] Save/load
- [x] Party menu (party_menu.c) and bag (item_menu.c, bag.c, item_use.c) on the GBA layer, from the field and in battle; list menus, scroll arrows, mon/item icons, std/dialog frames, YES/NO, money box
- [x] Summary screen (pokemon_summary_screen.c): INFO / SKILLS / KNOWN MOVES pages, move details, switching moves, choosing a move to forget (field and battle)
- [ ] Pokédex, options, TM case, berry pouch
- [~] Wild encounters: grass/water step encounters (wild_encounter.c: cooldown, rate buff, flutes, Cleanse Tag,
  Stench/Illuminate, repel + EventScript_RepelWoreOff, Altering Cave, Tanoby/Unown), StartWildBattle (standard,
  Pokémon Tower ghosts with the ghost pic, roamers, Safari Zone), CB2_EndWildBattle / CB2_EndSafariBattle.
  Not yet: Rock Smash, fishing, Sweet Scent (they come with those field moves)
- [~] Scripted wild battles: `setwildbattle` and Pokémon Tower 6F's ghost Marowak (StartMarowakBattle /
  CB2_EndMarowakBattle, the Silph Scope unveil). Not yet: `dowildbattle` (StartScriptedWildBattle: Snorlax, the
  legendaries) and StartLegendaryBattle
- [x] Roamers (roamer.c): InitRoamer, location sets + history, encounters, HP/status kept between battles
- [x] Safari Zone: safari_zone.c (Enter/ExitSafariMode, 600-step counter, retire, out-of-balls endings),
  battle_controller_safari.c, the Safari healthbox text, start menu RETIRE + stats window, entrance money box
- [~] Step counters (TryStartStepCountScript): happiness, field poison (incl. the BG mosaic flash and the faint/white-out
  script), VS Seeker charge counter, Safari steps; eggs only lose egg cycles (no daycare, no hatching scene)
- [x] Return to field runs MAP_SCRIPT_ON_RESUME / ON_RETURN_TO_FIELD (after battles and the bag/party menu)
- [x] Trainer sight (trainer_see.c): sight lines + CheckPathBetweenTrainerAndPlayer, the "!" and walk-up, FRLG's
  camera pan to trainers offscreen above, ConfigureAndSetUpOneTrainerBattle. Disguised/buried trainers aren't ported
  (none in FRLG)
- [x] Battle engine core: script interpreter, turn flow, damage/effects, messages, AI (battle_ai_script_commands.c + switch/items), player/opponent/Oak-Old Man controllers
- [x] GBA video layer (src/gba: VRAM/palette/regs, bg.c, window.c, sprite.c, task.c, palette fades, scanline effects, software PPU) and the battle presentation on it (BattleScene)
- [x] Battle: bag and party menu (choose item, use medicine/PP items/X items/balls, switch/send out) with reshow_battle_screen.c
- [x] Old Man's catching tutorial (StartOldManTutorialBattle)
- [~] Battle: move/status animations (src/battle/anim/: the battle_anim.c engine; 264 of the 397 scripts run, incl.
  every status and special anim (ball throw, switch out, substitute, level up), the stat change, shiny sparkles,
  weather, Transform / Silph Scope and every type file (fight ... water, dragon); the rest finish at once.
  Remaining work: BATTLE_ANIMS_PLAN.md step 3)
- [x] Battle transitions (battle_transition.c): every FRLG B_TRANSITION_* (the grey-blink intro, Blur, Swirl,
  Shuffle, Big Poké Ball, Poké Balls trail, Clockwise wipe, Ripple, Wave, Slice, White bars fade, Grid squares,
  Angled wipes, the Elite Four / Champion mugshots) drawn over the field on the GBA layer, picked like battle_setup.c
  (GetWildBattleTransition / GetTrainerBattleTransition; Old Man's tutorial uses Slice)
- [x] Warp screen effects: WarpFadeOutScreen / WarpFadeInScreen (white in and out of caves), the cave flash
  transitions (FlashTransition_Enter / _Exit from CB2_DoChangeMap), the barn door wipe leaving through a door
- [ ] Map preview screens (map_preview_screen.c: the cave/forest name banners)
- [x] Evolution scene (evolution_scene.c, evolution_graphics.c): after a battle (TryEvolvePokemon), from a Rare Candy
  or an evolution stone; holding B stops it; Crobat-style evolutions stop without the National Dex; learning the
  new species' move (incl. forgetting one through the summary screen); Nincada's Shedinja. TradeEvolutionScene
  isn't ported (no trading)
- [ ] Audio playback
- [x] Naming screen (naming_screen.c): every template (player, rival, PC box, nickname, caught mon); opened by
  ChangePokemonNickname from scripts and by the battle's nickname prompt after a catch
- [ ] Title screen / intro / Oak's speech (the player and rival naming templates are ready for it)

### Tests (tests/README.md)
- [x] Unit tests (Vitest, Node): random.c, CreateMon/CalculateMonStats/levels/movesets/natures/gender/PP, Bag,
  GameState (money, coins, flags/vars, temps, party), charmap, CalculateBaseDamage
- [x] E2E harness: headless Chrome over CDP, dev-only `window.__test` hooks (virtual pad, per-tick in-page
  mashing, walk/walkTo pathfinding, event log, state probes, `?seed=` `?speed=` `?textSpeed=`)
- [x] E2E scenarios: new game → Oak → starter → rival battle (and the after-rival preset matches it), trainer
  sight, trainer battle won (prize, flag, no rematch) and lost (white-out home, heal, money loss), wild encounter
  in grass, running, Master Ball catch + nickname, Poké Mart purchase, walking/doors/stairs/talking, evolution
  (after a battle, learning a move with a full moveset, stopping it with B, Rare Candy and Fire Stone from the bag)
- [ ] More scenarios: party menu from the start menu, items in battle, level-up move learning, the Old Man
  tutorial, Viridian parcel → Pokédex, elevators, item balls, PCs
