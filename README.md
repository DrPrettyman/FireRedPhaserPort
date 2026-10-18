# FireRed in Phaser

A browser rebuild of Pokémon FireRed in [Phaser 3](https://phaser.io), using the
[pret/firered](https://github.com/pret/pokefirered) decompilation as the source of truth for data and behaviour.

No game assets are committed. `tools/extract.py` reads a local decomp checkout and writes
everything the game needs into `public/gen/` (gitignored). Keep that folder local; don't publish it.

## Setup

```sh
npm install
pip3 install pillow           # extractor dependency
# + a C++ compiler: extract builds the decomp's mid2agb (macOS: xcode-select --install; Linux: build-essential)
npm run extract               # reads ../pret/firered by default
npm run dev                   # http://localhost:5173
npm run dev:battle            # battle test harness (battle-test.html)
```

To point at a decomp somewhere else, use `FIRERED_DECOMP=/path/to/firered npm run extract`
or `python3 tools/extract.py --decomp /path/to/firered`. The extractor compiles the decomp's `tools/mid2agb` (the
songs) with `c++` into `tools/.bin/`; set `CXX=` to use another compiler (e.g. `CXX=g++ npm run extract`).

### Controls

| GBA | Keys |
| --- | --- |
| D-pad | Arrow keys |
| A | Z / Space |
| B | X (hold to run) |
| Start | Enter |
| Select | Backspace |
| L / R | A / S |
| (debug) | <code>`</code> toggles the HUD (map, coords, metatile, behavior, elevation) |

Bindings live in `src/input/Input.ts`.

Debug: `?map=PalletTown&x=12&y=10` starts at any map and coordinate. In dev builds, `window.game` exposes the Phaser game.

## How it works

### Extraction (`tools/extract.py` → `public/gen/`)

| Output | Source in decomp |
| --- | --- |
| `maps/<Name>.json`, `maps/index.json` | `data/maps/*/map.json`, `data/layouts/layouts.json`, `map.bin`/`border.bin` |
| `tilesets/<Primary>_{bottom,middle,top}.png` | primary tileset metatiles 0–639 (shared by every map using that primary) |
| `tilesets/<Primary>__<Secondary>_{bottom,middle,top}.png` | secondary metatiles 640–1023, plus "override" copies of primary metatiles that use secondary palettes |
| `tilesets/index.json` | per-tileset metatile attributes (behavior, layer type, encounter type) + per-pair override lists |
| `sprites/<Name>.png`, `sprites/manifest.json` | overworld pic tables/palettes in `src/data/object_events/*.h`, NPC text colour (`sTextColorTable`) |
| `text/latin_*.png`, `text/fonts.json` | latin fonts, glyph widths (`src/text.c`), font metrics (`gFontInfos`) |
| `text/charmap.json` | `charmap.txt` (used to encode strings exactly like `preproc`) |
| `text/strings.json` | every `.string` label reachable from `data/event_scripts.s`, plus C strings in `src/strings.c` |
| `text/dialogue_frame.png`, `frame_type1..10.png`, `down_arrows.png` | dialogue frame, user window frames, page arrow |
| `scripts/scripts.json` | `data/event_scripts.s` and all its includes flattened to `[op, ...args]` with labels; script-file macros and pure event macros (`giveitem_msg`, `famechecker`, ...) expanded; numeric `#define`s (incl. simple expressions); std script table |
| `pokemon/species.json`, `moves.json`, `items.json` | `gSpeciesInfo` + names + level-up learnsets + national dex numbers, `gBattleMoves` + names, `src/data/items.json` |
| `pokemon/tables.json` | `gExperienceTables` (EXP_* macros evaluated), `sNatureStatTable`, `gStdStringPtrs`, dex counts |
| `pokemon/front/<species>.png` | front pics with the normal palette (`gMonFrontPicTable`, `gMonPaletteTable`) |
| `constants.json` | metatile behavior ids, new-game hidden-object flags |
| `tilesets/palettes.json` | the JASC palettes the atlases are drawn with, for runtime redraws (tile animations, doors) |
| `field_effects/obj_<Name>.png`, `objects.json` | every `gFieldEffectObjectTemplate_*` as a sheet with its frame size, anims and callback; the reflection distortion anims (`tools/extract_field.py`) |
| `sprites/<Name>_reflection.png` | object sprites in the palette their reflection draws with |
| `doors.json` | `sDoorGraphics` and the door anim frame lists (field_door.c) |
| `gfx/<symbol>.bin`, `gfx/index.json` | every `INCBIN` graphic used by battle/interface code, by C symbol, as the ROM holds it once decompressed (`tools/extract_gfx.py`, `graphics_file_rules.mk` rules) |
| `battle/scripts.json` | battle scripts + AI scripts assembled into a ROM image with labels and RAM symbols |
| `battle/battle_anims.json` | battle anim scripts (`battle_anim_scripts.s`) assembled the same way, with the sprite templates and task functions they point at by C name; the anim sprite templates, OamData, pic/palette/background tables (`tools/extract_battle_anims.py`) |
| `battle/strings.json`, `tables.json`, `anims.json` | battle strings and text-window info, trainers/parties, type chart, mechanics tables, sprite anim command tables per C file, pic tables (`tools/extract_battle.py`, `extract_anims.py`) |

Each metatile's two layers are spread over three atlases by layer type, as DrawMetatile fills the field's BG3,
BG2 and BG1: **bottom**, **middle** and **top**. Sprites of OAM priority 3 (reflections, ripples) draw between
bottom and middle, priority 2 between middle and top, priority 1 above all three. A map layer uses the primary
atlas at gid 0 and the pair atlas at gid 640. Tilesets with tile animations get canvas-texture atlases whose
animated metatiles are redrawn from the GBA tile data (`world/TilesetVram.ts`).

### Runtime (`src/`)

| Area | Files | What it does |
| --- | --- | --- |
| Boot | `main.ts`, `scenes/BootScene.ts`, `data/assets.ts` | 240×160 game, loads indexes, lazy-loads maps/textures |
| World | `world/World.ts`, `MapChunk.ts`, `TilesetPair.ts`, `behaviors.ts` | current map + connected neighbours in one world space; per-tile collision/elevation/behavior; `setmetatile` edits |
| Map graphics | `world/TilesetVram.ts`, `tilesetAnims.ts`, `doors.ts` | the tilesets' GBA tiles as VRAM, tileset_anims.c, field_door.c |
| Objects | `entities/ObjectEvent.ts`, `movementActions.ts`, `NpcBrain.ts` | grid movement at GBA speeds (walk/run/jump/slow/fast/in-place), held movement actions (MOVEMENT_ACTION_*), NPC movement types |
| Player | `world/playerAvatar.ts`, `bike.ts` | field_player_avatar.c and bike.c: gPlayerAvatar, PlayerStep, collision, ledges, forced movement tiles, the bike, surfing, boulders |
| Field moves | `world/fieldMoves.ts`, `fieldMoveShowMon.ts`, `fieldEffectScripts.ts` | fldeff_*.c (Cut, Rock Smash, Sweet Scent, Dig, Teleport), the show-mon banner, field_effect.c's script interpreter; the party menu side is in `menus/partyMenu.ts` |
| Field effects | `entities/FieldEffects.ts`, `groundEffects.ts` | field effect sprites (field_effect_helpers.c, emote icons) and the ground effects objects trigger (grass, shadows, splashes, reflections, ...) |
| Field | `scenes/OverworldScene.ts` | fixed 60 Hz tick; FieldGetPlayerInput / ProcessPlayerFieldInput, then PlayerStep; warps; coord triggers; map scripts; object spawning (on map entry and as objects come into view) |
| Input | `input/Input.ts` | GBA buttons sampled once per tick (`held` / `pressed`) |
| Text | `text/charmap.ts`, `Font.ts`, `TextWindow.ts`, `TextPrinter.ts`, `MessageBox.ts`, `placeholders.ts` | port of `RenderText`; pixel-buffer windows; field message box |
| Scripts | `script/ScriptEngine.ts`, `MovementRunner.ts`, `Defines.ts`, `specials.ts` | interpreter for decomp scripts at macro level; movement scripts; constant resolution; `special` table |
| Pokémon | `pokemon/Pokemon.ts`, `util/random.ts` | CreateMon, stats, movesets, gender/nature; the GBA RNG |
| State | `state/GameState.ts`, `Bag.ts` | flags/vars by numeric id, names, text speed, party, bag, Pokédex (memory only) |
| GBA video | `gba/hw.ts`, `bg.ts`, `window.ts`, `sprite.ts`, `palette.ts`, `task.ts`, `scanline.ts`, `ppu.ts` | VRAM/palette/IO registers, ports of bg.c, window.c, sprite.c, palette.c, task.c, scanline_effect.c; software PPU (text BGs, OBJ, windows, blending) |
| Battle | `battle/*.ts`, `scenes/BattleScene.ts` | port of battle_main.c, battle scripts/commands, util, AI, controllers, interface/gfx code on the GBA layer; the scene runs the C main/VBlank callbacks |
| Battle anims | `battle/anim/*.ts` | battle_anim.c's script engine and the battle_anim_*.c callbacks, registered by C name (`ported.ts`); scripts with unported callbacks finish at once |
| UI | `ui/MenuWindow.ts`, `Menu.ts`, `YesNoMenu.ts`, `StartMenu.ts`, `MonPicBox.ts`, `ScreenFade.ts` | std-framed windows, cursor menus, `showmonpic` box, `fadescreen` |
| PC | `menus/pokemonStorage*.ts`, `itemPc.ts`, `ui/StoragePcMenu.ts`, `PlayerPcMenu.ts`, `state/PokemonStorage.ts`, `pcItems.ts` | the Pokémon Storage System (pokemon_storage_system*.c: the box screen on the GBA layer, the PC's storage menu on the field) and the player's item PC (player_pc.c, item_pc.c) |
| End of the game | `menus/hallOfFame.ts`, `credits.ts`, `world/hallOfFameRecord.ts`, `state/hallOfFame.ts` | hall_of_fame.c (the Hall of Fame screen and PC), FLDEFF_HALL_OF_FAME_RECORD, credits.c on the field's GBA layer, the Hall of Fame records |

### Testing

- `npm run typecheck` (the game, then the tests)
- `npm test` (unit tests, Node) and `npm run test:e2e` (scripted playthroughs in headless Chrome: new game
  through the rival battle, trainer sight, winning/losing/white-out, wild encounters, catching, the Poké
  Mart). See [tests/README.md](tests/README.md) for how to write them.
- In the browser: `?map=<Name>&x=<x>&y=<y>` starts anywhere; <code>`</code> shows the debug HUD; `window.game` in dev.
- Headless, ad hoc: `tools/browser-test.mjs` drives Chrome (keys, evals, screenshots). See the header of that file.
  For anything worth keeping, write an e2e test instead.

## Progress

[STATUS.md](STATUS.md) has the checklist and what's next. [docs/](docs/) has the developer notes, the list of
deviations from the GBA, and the change log.
