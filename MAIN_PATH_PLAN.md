# Main path: plan to unblock a full playthrough

Status as of 2026-10-16 (master at `8a00924`). See STATUS.md "Next up" for where this list comes from.

The game is playable from the new game to Brock, but a playthrough stalls on four things:

1. **PC storage:** a 7th Pokémon has nowhere to go (`givemon` returns MON_CANT_GIVE; the "sent to PC" message is
   cosmetic).
2. **Save/load:** nothing persists, and there is no main menu to continue from.
3. **Field moves:** every field move in the party menu says it can't be used here. Cut is needed for Vermilion
   Gym, Surf and Strength later, Flash is optional (Rock Tunnel is passable in the dark).
4. **`special ListMenu`:** Silph Co.'s elevator (and two Cerulean houses) use a scrolling list menu.

## What exists, what's missing

| Area | Decomp | In the port |
|---|---|---|
| Field effect script commands | `dofieldeffect`, `waitfieldeffect`, `setfieldeffectargument`, `checkpartymove` (scrcmd.c), `data/field_effect_scripts.s` | none of them |
| Field move framework | party_menu.c `sFieldMoveCursorCallbacks` + `gPostMenuFieldCallback`; field_effect.c `FldEff_FieldMoveShowMon(Init)` (the mon banner) | `CursorCB_FieldMove` is a stub that always fails |
| Player avatar | field_player_avatar.c (2.2k lines): avatar flags and states, collision, forced movement (ice, spinners, currents, slides), bike, surfing, boulder pushing | movement is hand-written in `OverworldScene`: walk, run, ledges; no avatar flags, no forced movement |
| Field moves | fldeff_cut.c (295), fldeff_rocksmash.c (137), fldeff_strength.c (46), fldeff_flash.c (479), fldeff_sweetscent.c, fldeff_dig.c, fldeff_teleport.c; field_effect.c Surf/Waterfall/Fly | none |
| Fly | region_map.c (4k lines: town map and fly map), field_effect.c FlyOut/FlyIn | `world/regionMap.ts` has GetMapName only |
| PC storage | pokemon_storage_system*.c (8.7k lines over 6 files), player_pc.c (740) | the PC menu runs; storage, item PC and Hall of Fame PC are stubs |
| Save/load | save.c (963), load_save.c (298), start_menu.c save dialog, main_menu.c (788) | GameState lives in memory only |
| ListMenu | field_specials.c `ListMenu` on list_menu.c | list_menu.c is ported for the bag (GBA layer), not as a field special |

## Workstreams

Each is one worker unless noted. "Owns" means the worker is the only one changing that file's core in its batch;
others may only add small hooks.

- **W-state: GameState boxes + save data model.** Add the 14 PC boxes (BoxPokemon, box names, wallpapers) and
  pokemon_storage_system_data.c's data functions (SendMonToPC, CountPartyMons, ...); `givemon` and catches go to
  the PC with the right messages. Define the save data model: everything gSaveBlock1/2 hold that the port keeps
  (party, boxes, bag, flags, vars, money, location and warp data, roamer, dex, options, ...), serialised to and
  from JSON with a version number. Owns `state/`. No UI.
- **W-fieldmove: field move framework + Cut, Rock Smash, Sweet Scent, Dig, Teleport.** The four script commands,
  the field effect script table, `FldEff_FieldMoveShowMon`, the party-menu → field hand-off
  (`gPostMenuFieldCallback`, FieldCallback_*), `CursorCB_FieldMove` for real, then the small field moves on top
  of it (fldeff_cut.c incl. cutting grass, fldeff_rocksmash.c + RockSmashWildEncounter, sweet scent, dig,
  teleport). Owns `partyMenu.ts`'s field-move code and the field effect script commands in `ScriptEngine.ts`.
- **W-avatar: field_player_avatar.c.** Port it properly and move `OverworldScene`'s hand-written movement onto
  it: avatar flags and states, CheckForPlayerAvatarCollision, forced movement tiles (ice, spinners, currents,
  slides), the bike (bike.c: Mach/Acro, Cycling Road), the surfing state and boulder pushing (TryPushBoulder).
  Owns player movement in `OverworldScene.ts` and `ObjectEvent.ts`. Highest-risk refactor: everything walks
  through it, so this worker runs the full e2e suite.
- **W-list: `special ListMenu` + Flash's darkness.** The field ListMenu (Silph Co. elevator, Cerulean houses).
  Flash's overworld side: dark caves (flash level from the map header), `setflashlevel` / `animateflash`, the
  flash circle, and the battle transition's TRANSITION_TYPE_FLASH (a deviation today). The party-menu hook
  (FieldCallback_Flash) is wired after W-fieldmove lands.
- **W-pc: PC storage UI** (after W-state). pokemon_storage_system.c, _menu, _tasks, _graphics, _misc: deposit,
  withdraw, move Pokémon, box switching, the summary from the PC. 8.7k lines: one worker, two or three PRs one
  after another. Then player_pc.c (item storage) if there's room.
- **W-save: save dialog + main menu + continue** (after W-state). start_menu.c's SAVE dialog and save info
  window, save.c's behaviour on top of browser storage, main_menu.c (CONTINUE / NEW GAME / OPTIONS), and
  CB2_ContinueSavedGame (load, warp to the saved location).
- **W-surf: Surf + Waterfall** (after W-fieldmove and W-avatar). SetUpFieldMove_Surf/Waterfall,
  FldEff_UseSurf/UseWaterfall, the surf blob (field_effect_helpers.c), GetInteractedWaterScript (surf.inc),
  mounting and dismounting, wild encounters on water.
- **W-strength: Strength + scripted wild battles** (after W-fieldmove and W-avatar). fldeff_strength.c and the
  boulder scripts on top of W-avatar's boulder pushing. Strength alone was small, so batch 2 added `dowildbattle`
  and `special StartLegendaryBattle` (Snorlax with the Poké Flute, which blocks the main path, the legendary
  birds, Mewtwo) from the "later" list below.
- **W-fly: Fly + Town Map** (after W-fieldmove). region_map.c's fly map (and the Town Map item, which is the same
  screen), FlyOut/FlyIn. Big and self-contained.

## Batches

Up to four workers at a time.

| Batch | Workers | Why together |
|---|---|---|
| 1 | W-state, W-fieldmove, W-avatar, W-list | No dependencies on each other; they own different files |
| 2 | W-pc, W-save, W-surf, W-strength | All need batch 1; different files from each other |
| 3 | W-fly, plus leftovers (item PC, Hall of Fame PC, anything a batch-2 worker didn't finish) | |

Overlap to watch: W-fieldmove and W-avatar both touch `OverworldScene.ts`. W-avatar owns movement and collision;
W-fieldmove only adds field-effect hooks. If they collide at merge, W-avatar's version wins and the hook is
re-added.

## Rules (same as the battle anims, plus)

- Follow CLAUDE.md. Port from the decomp, cite C function names.
- Only change what your workstream owns; keep shared changes small and list them in the PR.
- Tests: typecheck, `npm test`, and your own e2e file (`tests/e2e/<workstream>.test.ts`). W-avatar also runs the
  full e2e suite. The merger runs the full suite once per batch.
- Docs: a docs/LOG.md entry, new deviations in docs/DEVIATIONS.md, a docs/DEV_NOTES.md entry for a new
  subsystem. Don't tick STATUS.md items; the merger does.
- Scratch files: prefix with your workstream name.
- If you run low on context, commit, push, open the PR with what's done and say what's left.

## Decisions (agreed 2026-10-16)

1. **Where saves live:** browser `localStorage`, one slot, like the GBA's one save file. (A download/upload of the
   save file could come later.)
2. **Boot without a title screen:** until the title screen and Oak's speech exist, boot straight into the main
   menu (CONTINUE / NEW GAME) when a save exists, and into the new game otherwise. Logged as a deviation.

## Not in this plan (later main-path blockers)

Silph Co.'s card key doors, `setmaplayoutindex` (Seafoam's stopped currents), the Pokédex screen, title screen / intro / Oak's speech, audio.
