"""Tables the party menu and bag index (public/gen/menus.json).

- monIcons / monIconPaletteIndices: gMonIconTable / gMonIconPaletteIndices (pokemon_icon.c), by species
- itemIcons: sItemIconTable (data/item_icon_table.h), item id -> [tiles symbol, palette symbol]
- tmhmMoves: sTMHMMoves (data/party_menu.h); tutorMoves / tutorLearnsets (data/pokemon/tutor_learnsets.h)
- tmhmLearnsets: sTMHMLearnsets (data/pokemon/tmhm_learnsets.h) as [low u32, high u32] per species
- evolutions: gEvolutionTable (data/pokemon/evolution.h) as [[method, param, targetSpecies], ...] per species
- natureNames: gNatureNamePointers (data/text/nature_names.h); abilityDescriptions: gAbilityDescriptionPointers
  (data/text/abilities.h); moveDescriptions: gMoveDescriptionPointers (move_descriptions.c), indexed move - 1
- mapsecNames: sMapNames (generated from data/region_map/region_map_sections.json), indexed mapsec - KANTO_MAPSEC_START
- menuInfoIcons: sMenuInfoIcons (list_menu.c) as [width, height, tile offset]
- namingKeyboardChars: sKeyboardChars (naming_screen.c) by KEYBOARD_* page, four raw `__()` rows each
- regionMap: region_map.c's tables (see region_map_data)
- pokedexArea: wild_pokemon_area.c's and pokedex_area_markers.c's tables (see pokedex_area_data)
"""

import json
import re

from extract import eval_const_expr, parse_defines
from extract_battle import c_array_body, c_numeric_table


def designated_entries(body):
    """`[KEY] = value,` entries at the top level of an array initializer -> [(key, value text)]."""
    body = re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", body, flags=re.S))
    out = []
    for m in re.finditer(r"\[([^\]]+)\]\s*=", body):
        start, depth, i = m.end(), 0, m.end()
        while i < len(body):
            c = body[i]
            if c in "({":
                depth += 1
            elif c in ")}":
                if depth == 0:
                    break
                depth -= 1
            elif c == "," and depth == 0:
                break
            i += 1
        out.append((m.group(1).strip(), body[start:i].strip()))
    return out


def by_index(entries, defines, convert):
    table = []
    for key, val in entries:
        idx = eval_const_expr(key, defines)
        if idx is None:
            raise ValueError(f"unknown index {key}")
        table += [None] * (idx + 1 - len(table))
        table[idx] = convert(val)
    return table


def string_pointer_table(text, name, defines):
    """`[KEY] = sSym,` pointers to `const u8 sSym[] = _("...");` in the same file -> raw strings by index."""
    literals = dict(re.findall(r'\b(\w+)\s*\[\s*\]\s*=\s*_\("(.*?)"\);', text))
    return by_index(designated_entries(c_array_body(text, name)), defines, lambda v: literals[v] + "$")


def mapsec_names(decomp, defines):
    """sMapNames[mapsec - KANTO_MAPSEC_START]: every section with a name (clones repeat it)."""
    sections = json.loads((decomp / "src/data/region_map/region_map_sections.json").read_text())["map_sections"]
    start = defines["KANTO_MAPSEC_START"]
    names = [None] * (defines["MAPSEC_NONE"] - start)
    for m in sections:
        if "name" in m:
            names[defines[m["id"]] - start] = m["name"] + "$"
    return names


def naming_keyboard_chars(decomp):
    """sKeyboardChars[KEYBOARD_*][row]: the raw `__("...")` rows (no EOS; the C pads them with 0, CHAR_SPACE)."""
    text = (decomp / "src/naming_screen.c").read_text(encoding="utf-8")
    enum = re.search(r"enum\s*\{\s*(KEYBOARD_LETTERS_LOWER[^}]*)\}", text).group(1)
    ids = {name: i for i, name in enumerate(re.findall(r"\w+", enum))}
    return by_index(designated_entries(c_array_body(text, "sKeyboardChars")), ids, lambda v: re.findall(r'__\("((?:\\.|[^"\\])*)"\)', v))


def region_map_data(decomp, defines):
    """region_map.c's data: sRegionMapSections_* (data/region_map/region_map_layout_*.h) as [layer][y][x]
    mapsecs per REGIONMAP_*, sMapSectionTopLeftCorners / sMapSectionDimensions (region_map_sections.json),
    sSeviiMapsecs, sMapFlyDestinations ([MAP_* id, HEAL_LOCATION_* number]), sDungeonInfo ([mapsec, desc
    string label]) and map_preview_screen.c's sMapPreviewScreenData ([mapsec, flag, tiles, tilemap, palette
    symbols]), all indexed as in the C (mapsec tables by mapsec - KANTO_MAPSEC_START); mapNums: MAP_NUM() of
    every MAP_* id (data/maps/map_groups.json), which the player position overrides compare."""
    src = decomp / "src"
    rm_c = (src / "region_map.c").read_text()

    def mapsecs(text):
        return [defines[t] for t in re.findall(r"MAPSEC_\w+", text)]

    layouts = []
    for name, sym in (("kanto", "Kanto"), ("sevii_123", "Sevii123"), ("sevii_45", "Sevii45"), ("sevii_67", "Sevii67")):
        h = (src / f"data/region_map/region_map_layout_{name}.h").read_text()
        flat = mapsecs(c_array_body(h, f"sRegionMapSections_{sym}"))
        width, height = 22, 15  # MAP_WIDTH, MAP_HEIGHT
        assert len(flat) == 2 * width * height, name
        layouts.append([[flat[(layer * height + y) * width : (layer * height + y + 1) * width] for y in range(height)] for layer in range(2)])

    start = defines["KANTO_MAPSEC_START"]
    count = defines["MAPSEC_NONE"] - start
    corners, dims = [None] * count, [None] * count
    for m in json.loads((src / "data/region_map/region_map_sections.json").read_text())["map_sections"]:
        if m["id"] not in defines or defines[m["id"]] < start:
            continue
        if "x" in m:
            corners[defines[m["id"]] - start] = [m["x"], m["y"]]
        if "width" in m:
            dims[defines[m["id"]] - start] = [m["width"], m["height"]]

    sevii = [mapsecs(row) for row in re.findall(r"=\s*\{([^{}]*)\}", c_array_body(rm_c, "sSeviiMapsecs"))]

    heal_ids = {h["id"]: i + 1 for i, h in enumerate(json.loads((src / "data/heal_locations.json").read_text())["heal_locations"])}
    heal_ids["HEAL_LOCATION_NONE"] = 0

    def fly_dest(v):
        m = re.fullmatch(r"\{\s*MAP\((\w+)\)\s*,\s*(\w+)\s*\}", v)
        return [m.group(1), heal_ids[m.group(2)]]

    fly = by_index(designated_entries(c_array_body(rm_c, "sMapFlyDestinations")), defines, fly_dest)
    dungeon_info = [[defines[i], d] for i, d in re.findall(r"\.id\s*=\s*(MAPSEC_\w+),\s*\.name\s*=\s*\w+,\s*\.desc\s*=\s*(\w+)", c_array_body(rm_c, "sDungeonInfo"))]

    mps = (src / "map_preview_screen.c").read_text()
    previews = [
        [defines[sec], flag, tiles, tilemap, pal]
        for sec, flag, tiles, tilemap, pal in re.findall(
            r"\.mapsec\s*=\s*(\w+),\s*\.type\s*=\s*\w+,\s*\.flagId\s*=\s*(\w+),\s*\.tilesptr\s*=\s*(\w+),\s*\.tilemapptr\s*=\s*(\w+),\s*\.palptr\s*=\s*(\w+)",
            c_array_body(mps, "sMapPreviewScreenData"),
        )
    ]
    map_nums = {}
    groups = json.loads((decomp / "data/maps/map_groups.json").read_text())
    for group in groups["group_order"]:
        for num, folder in enumerate(groups[group]):
            map_nums[json.loads((decomp / "data/maps" / folder / "map.json").read_text())["id"]] = num
    return {
        "mapNums": map_nums,
        "layouts": layouts,
        "topLeftCorners": corners,
        "dimensions": dims,
        "seviiMapsecs": sevii,
        "flyDestinations": fly,
        "dungeonInfo": dungeon_info,
        "mapPreviews": previews,
    }


def pokedex_area_data(decomp, defines):
    """The Pokédex area page's tables: wild_pokemon_area.c's sDexAreas_Kanto and sDexAreas_Sevii1..7
    ([mapsec, DEX_AREA_*] rows, in order: a mapsec may repeat) and sRoamerPairs ([roamer, starter]
    species); pokedex_area_markers.c's sAreaMarkers ([MARKER_*, x, y] by DEX_AREA_*) and sSubsprites
    ([shape, size, priority, tileOffset] by MARKER_*); mapSecs: every map header's regionMapSectionId by
    MAP_* id (what Overworld_GetMapHeaderByGroupAndId(...)->regionMapSectionId gives); firstMap: the MAP_*
    id of group 0 / num 0 (where an EWRAM map location that was never set points)."""
    src = decomp / "src"
    wpa = (src / "wild_pokemon_area.c").read_text()
    pam = (src / "pokedex_area_markers.c").read_text()

    def pairs(name):
        body = c_array_body(wpa, name)
        return [[eval_const_expr(a, defines), eval_const_expr(b, defines)] for a, b in re.findall(r"\{\s*(\w+)\s*,\s*(\w+)\s*\}", body)]

    sevii_names = re.findall(r"\{\s*(sDexAreas_Sevii\d)\s*,", c_array_body(wpa, "sSeviiDexAreas"))

    known = dict(defines)
    enum = re.search(r"enum\s*\{([^}]*MARKER_CIRCULAR[^}]*)\}", pam).group(1)
    for i, name in enumerate(re.findall(r"\b(MARKER_\w+)", enum)):
        known[name] = i
    subsprite_defs = {}
    for name, body in re.findall(r"Subsprite\s+(\w+)\s*=\s*\{(.*?)\};", pam, re.S):
        f = dict(re.findall(r"\.(\w+)\s*=\s*([^,\n]+)", body))
        size = defines["SPRITE_SIZE_" + re.fullmatch(r"SPRITE_SIZE\((\w+)\)", f["size"].strip()).group(1)]
        shape = defines["SPRITE_SIZE_" + re.fullmatch(r"SPRITE_SHAPE\((\w+)\)", f["shape"].strip()).group(1)]
        subsprite_defs[name] = [shape & 3, size >> 2, eval_const_expr(f["priority"], known), eval_const_expr(f["tileOffset"], known)]
    subsprites = by_index(designated_entries(c_array_body(pam, "sSubsprites")), known, lambda v: subsprite_defs[v.lstrip("&").strip()])

    flat = c_numeric_table(pam, "sAreaMarkers", known)
    markers = [flat[i : i + 3] for i in range(0, len(flat), 3)]

    groups = json.loads((decomp / "data/maps/map_groups.json").read_text())
    map_secs, first_map = {}, None
    for group in groups["group_order"]:
        for folder in groups[group]:
            m = json.loads((decomp / "data/maps" / folder / "map.json").read_text())
            first_map = first_map or m["id"]
            map_secs[m["id"]] = defines[m["region_map_section"]]

    return {
        "dexAreasKanto": pairs("sDexAreas_Kanto"),
        "dexAreasSevii": [pairs(n) for n in sevii_names],
        "roamerPairs": pairs("sRoamerPairs"),
        "areaMarkers": markers,
        "subsprites": subsprites,
        "mapSecs": map_secs,
        "firstMap": first_map,
    }


def extract_menus(decomp, out):
    defines = parse_defines(decomp)
    src = decomp / "src"

    icon_c = (src / "pokemon_icon.c").read_text()
    mon_icons = by_index(designated_entries(c_array_body(icon_c, "gMonIconTable")), defines, lambda v: v)
    mon_icon_pals = by_index(designated_entries(c_array_body(icon_c, "gMonIconPaletteIndices")), defines, lambda v: eval_const_expr(v, defines))

    item_icon_h = (src / "data/item_icon_table.h").read_text()
    item_icons = by_index(designated_entries(c_array_body(item_icon_h, "sItemIconTable")), defines, lambda v: re.findall(r"\w+", v))

    tmhm_moves = c_numeric_table((src / "data/party_menu.h").read_text(), "sTMHMMoves", defines)

    tutor_h = (src / "data/pokemon/tutor_learnsets.h").read_text()
    tutor_moves = c_numeric_table(tutor_h, "sTutorMoves", defines)

    def tutor_bits(v):
        bits = 0
        for move in re.findall(r"TUTOR\((\w+)\)", v):
            bits |= 1 << defines["TUTOR_" + move]
        return bits

    tutor_learnsets = by_index(designated_entries(c_array_body(tutor_h, "sTutorLearnsets")), defines, tutor_bits)

    def tmhm_bits(v):
        bits = 0
        for machine in re.findall(r"TMHM\((\w+)\)", v):
            bits |= 1 << (defines["ITEM_" + machine] - defines["ITEM_TM01_FOCUS_PUNCH"])
        return [bits & 0xFFFFFFFF, bits >> 32]

    tmhm_h = (src / "data/pokemon/tmhm_learnsets.h").read_text()
    tmhm_learnsets = by_index(designated_entries(c_array_body(tmhm_h, "sTMHMLearnsets")), defines, tmhm_bits)

    def evos(v):
        return [[eval_const_expr(x.strip(), defines) for x in e.split(",")] for e in re.findall(r"\{([^{}]+)\}", v)]

    evo_h = (src / "data/pokemon/evolution.h").read_text()
    evolutions = by_index(designated_entries(c_array_body(evo_h, "gEvolutionTable")), defines, evos)

    nature_names = string_pointer_table((src / "data/text/nature_names.h").read_text(), "gNatureNamePointers", defines)
    ability_descs = string_pointer_table((src / "data/text/abilities.h").read_text(), "gAbilityDescriptionPointers", defines)
    move_descs = string_pointer_table((src / "move_descriptions.c").read_text(), "gMoveDescriptionPointers", defines)
    flat = c_numeric_table((src / "list_menu.c").read_text(), "sMenuInfoIcons", defines)
    menu_info_icons = [flat[i : i + 3] for i in range(0, len(flat), 3)]

    data = {
        "natureNames": nature_names,
        "abilityDescriptions": ability_descs,
        "moveDescriptions": move_descs,
        "mapsecNames": mapsec_names(decomp, defines),
        "menuInfoIcons": menu_info_icons,
        "monIcons": mon_icons,
        "monIconPaletteIndices": mon_icon_pals,
        "itemIcons": item_icons,
        "tmhmMoves": tmhm_moves,
        "tutorMoves": tutor_moves,
        "tutorLearnsets": tutor_learnsets,
        "tmhmLearnsets": tmhm_learnsets,
        "evolutions": evolutions,
        "namingKeyboardChars": naming_keyboard_chars(decomp),
        "regionMap": region_map_data(decomp, defines),
        "pokedexArea": pokedex_area_data(decomp, defines),
    }
    (out / "menus.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"  {len([s for s in mon_icons if s])} mon icons, {len([s for s in item_icons if s])} item icons, "
          f"{len(tmhm_moves)} TM/HM moves, {len([e for e in evolutions if e])} evolution entries")


if __name__ == "__main__":
    import sys
    from pathlib import Path

    extract_menus(Path(sys.argv[1]), Path(sys.argv[2]))
