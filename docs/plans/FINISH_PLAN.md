# Finishing the single-player port

**Status: Done in batch 15 (PRs #167-#172).** Plans index: [README.md](README.md).

The last planned batch. An audit of the decomp against the port found six single-player pieces still missing or
approximated; the user approved exactly these six. After this batch the port is complete apart from link play,
which is out of scope (trades, link battles, the Union Room, the minigames, Mystery Gift stay stand-ins).

## The six units, checked against the C

1. **Renewable hidden items** (renewable_hidden_items.c, 608 lines, mostly the 15-map table). SetAllRenewableItemFlags
   at new game (new_game.c), IncrementRenewableHiddenItemStepCounter on every step (field_control_avatar.c's
   ProcessPlayerFieldInput, next to GAME_STAT_STEPS), TryRegenerateRenewableHiddenItems on map load
   (overworld.c's LoadMapFromCameraTransition and LoadMapFromWarp: once VAR_RENEWABLE_ITEM_STEP_COUNTER reaches
   1500 on a map in the table, the counter resets, every renewable flag is set and SampleRenewableItemFlags clears
   one rarity group per map: 10% rare / 30% uncommon / 60% common). Not ported today, not in DEVIATIONS. The
   counter is a var, which the save already holds, so **no save field is needed**. The table goes through
   `tools/extract.py` (parse sRenewableHiddenItems: map, and the three groups of hidden-item flag ids).
2. **CONTINUE restores the current map's object events and templates.** load_save.c's SaveObjectEvents /
   LoadObjectEvents (gSaveBlock1Ptr->objectEvents), gSaveBlock1Ptr->objectEventTemplates (setobjectxyperm,
   copyobjectxytoperm, setobjectmovementtype edits: the port keeps them in `OverworldScene.templates` only until the
   map is left), and fieldmap.c's SaveMapView / LoadSaveblockMapView (the metatiles around the player that a
   script changed after the map loaded). Today a pushed Victory Road boulder (copyobjectxytoperm) goes back to its
   start after CONTINUE though VAR_MAP_SCENE_VICTORY_ROAD_1F is 100. Save fields: the current map's object events
   and templates, the map view. DEVIATIONS lines: "Save data" (the object events / templates; its "game stats"
   is stale, they are saved since version 2), "Save dialog" (SaveMapView), "CONTINUE" (the objects).
   The quest log's snapshot code (world/questLogObjects.ts: questLogObjectEventFrom, QL_LoadTemplates) already
   converts between the port's objects and the C's structs: reuse it.
3. **The item-use animation and the battle level-up stripes** (pokemon_special_anim.c 709 + pokemon_special_anim_scene.c
   1,563 lines). party_menu.c's CB2_DoUseItemAnim (StartUseItemAnim_Normal / _CantEvolve for Rare Candy, the
   vitamins, PP items, evolution stones) and StartUseItemAnim_ForgetMoveAndLearnTMorHM; menus/partyMenu.ts skips
   them today (DEVIATIONS "Item use"). Then battle_controller_player.c's CreateLevelUpVerticalSpritesTask (the
   18 rising stripes; battle/controllerCommon.ts's Task_CreateLevelUpVerticalStripes goes on at once today) and
   the level-up banner's mon icon (DEVIATIONS "Battles"). Two units.
4. **Stair warps and the warp arrow.** field_fadetransition.c's DoStairWarp / Task_StairWarp (the walk into the
   stairs, the 12-frame delay when it takes the player off the bike, TryFadeOutOldMapMusic and SE_EXIT at their
   frames) and Task_ExitStairs (the walk out on arrival, gExitStairsMovementDisabled set by CONTINUE);
   field_player_avatar.c's HandleWarpArrowSpriteHideShow (the arrow sprite on arrow warps: field_effect_helpers.c's
   CreateWarpArrowSprite / ShowWarpArrowSprite / SetSpriteInvisible). Today DoStairWarp runs as DoWarp.
   DEVIATIONS lines: "Player avatar", "CONTINUE" (gExitStairsMovementDisabled), the warp list (DoStairWarp).
5. **Spinda's spots and the Pokédex personalities.** pokemon.c's DrawSpindaSpots, called from decompress.c's
   LoadSpecialPokePic paths (every front / back pic loaded with a personality: battle, summary, Pokédex, and the
   other screens that go through the same loader); gSaveBlock2Ptr->pokedex.unownPersonality / spindaPersonality,
   set in pokemon.c's HandleSetPokedexFlag (around line 6241) and read by pokedex_screen.c (line 2202) instead of
   personality 0. Save fields: the two personalities. DEVIATIONS: "Battles" (spots), "Pokédex screen".
6. **Small fixes.** The L=A button mode on the field (ReadKeys turns L into A everywhere on the GBA; the field
   reads the buttons directly today: DEVIATIONS "Option menu"). The GAME_STAT increments the C does and the port
   doesn't (single-player only): SAVED_GAME (start_menu.c / the save), USED_CUT, USED_ROCK_SMASH, USED_ITEMFINDER,
   TOTAL_BATTLES / WILD_BATTLES / TRAINER_BATTLES (battle_setup.c, incl. the scripted wild battles), STEPS,
   SHOPPED, JUMPED_DOWN_LEDGES, ENTERED_SAFARI_ZONE (grep the C for `IncrementGameStat(` and check each against
   the port; the script command `incrementgamestat` is ported already). Remove the DEVIATIONS lines they fix
   (Itemfinder, Field moves, Wild encounters, Scripted wild battles, Poké Mart, Save dialog, ...).

## Workstreams

| Worker | Branch / worktree | Units | Owns |
|---|---|---|---|
| W-anim | `finish-anim`, `../wt-finish-anim` | A1: the item-use anim (pokemon_special_anim.c, the scene file except the level-up stripes) and its party menu hooks. A2: CreateLevelUpVerticalSpritesTask in battle, the level-up banner's mon icon | a new `src/menus/pokemonSpecialAnim*.ts`; menus/partyMenu.ts's item-use exits; battle/controllerCommon.ts's level-up task; the level-up banner |
| W-continue | `finish-continue`, `../wt-finish-continue` | C1: object events, templates and the map view in the save; CONTINUE restores them | state/saveData.ts (save version), OverworldScene's continueSavedGame / storeLocationForSave / templates |
| W-stairs | `finish-stairs`, `../wt-finish-stairs` | S1: DoStairWarp / Task_StairWarp / Task_ExitStairs, the warp arrow | the warp path in OverworldScene (the stair warp, the arrival), world/playerAvatar.ts's warp arrow, a field effect for the arrow |
| W-small | `finish-small`, `../wt-finish-small` | M1: L=A on the field and the GAME_STAT increments. M2: renewable hidden items | the field input, the increment call sites, a new `src/world/renewableHiddenItems.ts`, tools/extract.py's table |
| W-spinda | `finish-spinda`, `../wt-finish-spinda` | P1: DrawSpindaSpots and the Pokédex personalities | the mon pic loader, the dex seen path, the Pokédex's personality reads |

W-anim, W-continue, W-stairs and W-small start together; W-spinda starts when the first of them hands back. W-anim's
A2 and W-small's M2 go to continuation workers if the first worker hands back after one unit (W-small may do both if
M1 is quick).

**Shared files.** OverworldScene.ts: W-continue owns the save / CONTINUE path and the templates map, W-stairs the
stair warp and the arrival after a warp, W-small the step hook (GAME_STAT_STEPS and the renewable step counter side
by side) and the map-load hook for TryRegenerateRenewableHiddenItems. Keep each edit small and in its own method.
W-stairs owns the CONTINUE side of gExitStairsMovementDisabled (one line in continueSavedGame); W-continue leaves it.
state/saveData.ts: W-continue and W-spinda both add fields; each bumps SAVE_VERSION by one from master's (14) with
an `upgradeSave` step; the merger renumbers the second one (15) when merging it. The pic loader (W-spinda) and the
item-use anim's mon pic (W-anim): W-anim calls the existing loader with the mon's personality, so the spots come
once W-spinda merges.

## Decisions

1. (coordinator, revisit if you disagree) Renewable hidden items need no save field or version bump: the step
   counter is VAR_RENEWABLE_ITEM_STEP_COUNTER, a saved var. Saves from before this batch keep their renewable flags as
   they are (the items not yet picked up stay visible) until the first regeneration; no upgrade runs
   SetAllRenewableItemFlags on them.
2. (coordinator, revisit if you disagree) The two PRs that add save fields each bump the version; the merger
   renumbers the second, so master goes 13 → 14 → 15 in one batch.
3. (coordinator, revisit if you disagree) The saved object events hold what the port's ObjectEvent can restore
   (position, previous position, facing, movement type and its state as far as the port keeps it, invisibility,
   the offscreen flags), in the C's struct ObjectEvent field names where they match; the GBA's sprite and
   animation state isn't saved (it's rebuilt on load, as LoadObjectEvents' caller TrySpawnObjectEvents does).

## Batch 15 result

All six units landed, one PR per workstream (W-anim's two units on one branch):

| PR | Workstream | What |
|---|---|---|
| #167 | (plan) | This plan |
| #168 | W-continue | CONTINUE restores the current map's object events, templates and map view (save version 14) |
| #169 | W-small | L=A on the field, every single-player GAME_STAT, renewable hidden items |
| #170 | W-anim | The item-use animation (pokemon_special_anim*.c); the battle level-up stripes and banner icon |
| #171 | W-stairs | Stair warps (Task_StairWarp / Task_ExitStairs, the bike delay), the warp arrow, one warp arrival path |
| #172 | W-spinda | Spinda's spots, the Pokédex's Unown / Spinda personalities (save version 15, renumbered at the merge) |

Merge notes: the docs' union merge doubled the "Save dialog", "Option menu", "CONTINUE", "Battles" and "Save data"
entries in DEVIATIONS and the save-fields paragraph in DEV_NOTES; each was tidied at its merge. The full e2e suite
on master after the last merge: 600 of 601 passed; the failure was real: the item-use anim's extracted
`sBg_Tilemap` took over the plain name the slot machine used (extract_gfx.py keeps a clashing name's plain form for
the first file in sorted order), fixed in the STATUS PR by the slot machine's qualified `slot_machine.sBg_Tilemap`.

Left, found on the way (in DEVIATIONS): Task_ExitNonAnimDoor on cave doors (the player isn't hidden during the fade
and doesn't walk a step out), Task_ExitNonDoor not freezing the map's objects, the saved objects' previousCoords /
initialCoords and a movement in progress, itemUseAnim's Fire Stone timeout seen once (unexplained).
