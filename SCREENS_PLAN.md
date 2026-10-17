# Screens and items: plan for what a player notices is missing

Status as of 2026-10-17 (master at `abcb7d0`). MAIN_PATH_PLAN.md is done; this plan picks up STATUS.md "Next up":
the Pokédex screen, and the bag items that still say "not implemented".

One main-path blocker turned up while planning: **the TM case can't be opened** (FieldUseFunc_TmCase isn't
ported), and in FRLG every TM and HM lives in it. The party menu's TM/HM teaching (ItemUseCB_TMHM) is ported, but
nothing reaches it, so a real playthrough can't teach Cut, Surf or Strength. W-tmcase fixes that in batch 1.

## What exists, what's missing

| Area | Decomp | In the port |
|---|---|---|
| Pokédex screen | pokedex_screen.c (3.45k lines), pokedex.c (148), data/pokemon/pokedex_entries.h, pokedex_orders.h, pokedex_categories.h, graphics/pokedex/ | start menu POKéDEX says "not implemented"; seen/caught flags are kept (battle, catch, givemon, evolution) and saved; GetPokedexCount / the save menu's counts work; `mechanics.pokedexHeightWeight` only |
| Area page | pokedex_screen.c DexScreen_DrawMonAreaPage (size comparison, type icons), wild_pokemon_area.c (317), pokedex_area_markers.c (274), region_map.c GetUnlockedSeviiAreas | none |
| Registering a catch | pokedex_screen.c DexScreen_RegisterMonToPokedex, battle_script_commands.c Cmd_displaydexinfo | `Cmd_displaydexinfo` skips straight past it |
| TM case | tm_case.c (1.7k): from the bag (FIELD), GIVE (party, PC box), SELL, REOPENING after teaching | none: the bag logs "not implemented"; party menu returns to the bag instead (CB2_ReturnToTMCaseMenu) |
| Berry pouch | berry_pouch.c (1.5k), same entry points | none |
| Field items | field_player_avatar.c StartFishing / Task_Fishing, wild_encounter.c FishingWildEncounter, item_use.c FieldUseFunc_Rod / ItemUseOutOfBattle_EscapeRope / _Itemfinder / FieldUseFunc_VsSeeker, itemfinder.c (658), vs_seeker.c (1.3k) | Bike, Town Map, flutes, Repel, medicine; Dig's escape (world/fieldMoves.ts, CanUseEscapeRopeOnCurrMap); the VS Seeker step counter; the rest logs "not implemented" |
| Other start menu screens | option_menu.c (575), trainer_card.c (2k), help_system.c (2.5k) | none |

Helpers that already exist and should be reused: `gba/listMenu.ts` (no cursor objects yet), `menus/menuIndicators.ts`
(scroll arrows), `menus/picSprites.ts` (CreateMonPicSprite_HandleDeoxys, CreateTrainerPicSprite),
`menus/pokemonIcon.ts`, `gba/listMenu.ts` BlitMenuInfoIcon / ListMenuLoadStdPalAt, `gba/sprite.ts` SetOamMatrix and
subsprites, `PlayerGenderToFrontTrainerPicId` (in `menus/hallOfFame.ts`, unexported; export it rather than copy it
a third time).

## Workstreams

A unit is about an hour for a fresh worker (docs/WORKFLOW.md section 1). **Each unit is its own PR from a fresh
`origin/master`** (a new branch and worktree per unit), merged as soon as it's green, so the next unit and the
other workstreams build on it.

### W-dex: the Pokédex screen (pokedex_screen.c)

Owns `menus/pokedexScreen.ts` (the C file's port; split into `pokedexScreen*.ts` files if it gets big), the
Pokédex data in the extractor, the start menu's POKéDEX entry (OverworldScene's dispatch + a `pokedex` mode in
FieldMenuScene), and list_menu.c's cursor objects in `gba/listMenu.ts`.

1. **Data, resources, top menu, numerical lists.** Extract gPokedexEntries' text fields (categoryName,
   description) and scales/offsets, pokedex_orders.h, pokedex_categories.h, the footprints (drop the
   `footprint.1bpp` skip in extract_gfx.py) and `graphics/pokedex/` plus pokedex_screen.c's INCBINs. Port
   CB2_OpenPokedexFromStartMenu, DexScreen_LoadResources, DoClosePokedex / CB2_ClosePokedex, Task_PokedexScreen
   (the top menu: DexScreen_InitGfxForTopMenu, the mode list with its icons, the seen / owned counts),
   Task_DexScreen_NumericalOrder (Kanto and, with the National Dex, national), DexScreen_CountMonsInOrderedList,
   ItemPrintFunc_OrderedListMenu, the scroll arrows, the helpers (DexScreen_AddTextPrinterParameterized,
   DexScreen_PrintNum3*, DexScreen_GetSetPokedexFlag, DexScreen_GetDexCount, DexScreen_PrintControlInfo, ...)
   and pokedex.c. Wire START → POKéDEX → back to the start menu. E2E `tests/e2e/pokedex.test.ts`: open, counts,
   scroll the list, close.
2. **The mon page and the characteristic lists.** DexScreen_DrawMonDexPage and what it prints (pic, number, name,
   category, height, weight, footprint, flavour text), DexScreen_DexPageZoomEffectFrame, Task_DexScreen_ShowMonPage
   (up/down to the next mon, START = cry), DexScreen_TryScrollMonsVertical, Task_DexScreen_CharacteristicOrder
   (A to Z, type, lightest, smallest). A on the mon page opens the area page: if W-dexarea's unit 2 isn't on
   master yet, leave the A branch as a stub that W-dexarea wires.
3. **Habitat categories and registering a catch.** Task_DexScreen_CategorySubmenu and the category pages
   (DexScreen_CreateCategoryListGfx, DexScreen_DrawMonPicInCategoryPage, the page cursor through list_menu.c's
   cursor objects, DexScreen_FlipCategoryPageInDirection and the page-turn BG effect, the unlock rules,
   DexScreen_LookUpCategoryBySpecies); DexScreen_RegisterMonToPokedex + Task_DexScreen_RegisterMonToPokedex from
   the battle's Cmd_displaydexinfo (the "registered in the Pokédex" page after a catch). E2E: a catch shows the
   registered page.

### W-dexarea: the area page (wild_pokemon_area.c, pokedex_area_markers.c)

Owns `menus/wildPokemonArea.ts`, `menus/pokedexArea.ts`, the area data in the extractor, and
GetUnlockedSeviiAreas (added to `menus/regionMap.ts`).

1. **Area data and markers** (in parallel with W-dex unit 1). wild_pokemon_area.c (GetSpeciesPokedexAreaMarkers,
   the sDexAreas_* / mapsec tables, roamer locations), pokedex_area_markers.c (CreatePokedexAreaMarkers,
   Task_ShowAreaMarkers' blink, DestroyPokedexAreaMarkers, GetNumPokedexAreaMarkers, the subsprites),
   GetUnlockedSeviiAreas, the area map and marker graphics. Unit tests for the marker lists (e.g. Pidgey on the
   Kanto routes, Magikarp by rod, a roamer at its current location, a mon with none).
2. **The area page** (after W-dex unit 2 is merged). DexScreen_DrawMonAreaPage (the Kanto map and unlocked Sevii
   islands, the species name, "AREA UNKNOWN", the type icons, the size comparison: the mon's and the player's
   silhouettes scaled by gPokedexEntries' scales/offsets) and DexScreen_DestroyAreaScreenResources, wired into the
   mon page (Task_DexScreen_ShowMonPage states 7-12) and, if W-dex unit 3 is on master, the category page's area
   step. E2E in `tests/e2e/pokedexArea.test.ts`.

### W-tmcase: the TM case and the berry pouch

Owns `menus/tmCase.ts`, `menus/berryPouch.ts`, their graphics in the extractor, and the bag/party/shop/PC hooks
that open them (FieldUseFunc_TmCase / _BerryPouch in `menus/itemUse.ts`, GoToTMCase_* / GoToBerryPouch_* in
`menus/itemMenu.ts`, CB2_ReturnToTMCaseMenu / CB2_ReturnToBerryPouchMenu in `menus/partyMenu.ts`).

1. **TM case.** tm_case.c: InitTMCase for FIELD (from the bag), GIVE_PARTY, GIVE_PC, SELL and REOPENING (back
   from teaching); the list with TM/HM numbers, the description and move info windows, USE → the party menu's
   ItemUseCB_TMHM, GIVE, the sell quantity flow. The Pokédude demo (TMCASE_POKEDUDE) stays out (no Teachy TV).
   E2E `tests/e2e/tmCase.test.ts`: teach HM01 from the TM case, sell a TM.
2. **Berry pouch.** berry_pouch.c with the same entry points (field, give, PC box, sell); berry use from the
   pouch through the existing medicine path.

### W-fielditems: rods, Escape Rope, VS Seeker, Itemfinder

Owns `world/fishing.ts`, `world/vsSeeker.ts`, `world/itemfinder.ts`, and their FieldUseFunc_* entries in
`menus/itemUse.ts`.

1. **Rods and Escape Rope.** FieldUseFunc_Rod, StartFishing / Task_Fishing (field_player_avatar.c: the cast, the
   bite timing, "Not even a nibble" / "It got away", the player's fishing anims), DoesCurrentMapHaveFishingMons /
   FishingWildEncounter (wild_encounter.c); ItemUseOutOfBattle_EscapeRope on top of the existing Dig escape.
   E2E `tests/e2e/fieldItems.test.ts`.
2. **VS Seeker.** vs_seeker.c: using it (the rematch check, the trainers' rematch emotes and movement), setting
   `state.trainerRematches` so rematches start, EventScript_VsSeekerChargingDone's specials. Removes the VS
   Seeker deviation.
3. **Itemfinder** (itemfinder.c), and registered SELECT items if there's room.

## Shared files and owners

- `menus/itemUse.ts`: W-tmcase adds the TM case / berry pouch entries, W-fielditems the rod / Escape Rope / VS
  Seeker / Itemfinder entries. Separate functions; the merger keeps both sides of the table.
- `scenes/FieldMenuScene.ts`: W-dex adds the `pokedex` mode; W-tmcase only if the TM case needs its own launch.
- `scenes/OverworldScene.ts`: W-dex adds POKéDEX to the start menu dispatch; W-fielditems hooks fishing into the
  player's field input. Small hooks only.
- `tools/extract_menus.py`: W-dex (Pokédex data), W-dexarea (area tables), W-tmcase (TM case / pouch tables)
  each add their own function and `menus.json` key. `tools/extract_gfx.py`'s directory list: W-dex and W-dexarea
  may both add `"graphics/pokedex/"`; the merger keeps one.
- list_menu.c's cursor objects (ListMenuAddCursorObject*): W-dex unit 3. If W-tmcase needs them first, it
  builds them in `gba/listMenu.ts` and W-dex reuses them.
- `PlayerGenderToFrontTrainerPicId`: export the copy in `menus/hallOfFame.ts` (whoever needs it first).

## Batches

| Batch | Workers | Why together |
|---|---|---|
| 1 | W-dex (units 1-3, one after another), W-dexarea (1, then 2 once W-dex 2 is in), W-tmcase (1, then 2), W-fielditems (1, then 2) | Different files; the Pokédex is the focus, the TM case unblocks HMs in a real playthrough |
| 2 | Leftovers of batch 1; option_menu.c, trainer_card.c; the start menu help window; headless story checks gym by gym | |

## Rules

Worker and merger rules: docs/WORKFLOW.md sections 3 and 4. Each worker's e2e file is named in its unit above.

## Decisions

1. **Batch 1 is wider than the Pokédex** (coordinator, revisit if you disagree): the Pokédex has two parallel
   workstreams at most (pokedex_screen.c is one tightly coupled file), so the other two slots take the TM case
   (a main-path blocker found while planning) and the field items STATUS.md lists as the most-noticed gaps.
2. **One PR per unit** (coordinator, revisit if you disagree): instead of one draft PR per workstream, each unit
   is merged as it finishes, so W-dexarea's area page can build on W-dex's mon page in the same batch.
3. **No cries or SE** (as everywhere): START on the mon page and the cry after registering are no-ops until
   audio exists; logged under the existing audio deviation.

## Not in this plan

The intro movie, audio, map preview screens, daycare and eggs, link play, Fame Checker and Teachy TV, mail.
