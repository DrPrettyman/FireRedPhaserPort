"""The Pokédex screen's data (public/gen/pokedex.json), for src/menus/pokedexScreen*.ts.

- entries: gPokedexEntries (data/pokemon/pokedex_entries.h) by national dex number: categoryName and description
  as raw decomp strings (with EOS `$`; the description's FireRed text from pokedex_text_fr.h), height, weight,
  pokemonScale / pokemonOffset / trainerScale / trainerOffset
- orders: gPokedexOrder_Alphabetical / _Weight / _Height (national dex numbers) and gPokedexOrder_Type (species),
  data/pokemon/pokedex_orders.h
- categories: gDexCategories (data/pokemon/pokedex_categories.h) as [category][page] -> species list
- footprints: gMonFootprintTable (data/pokemon_graphics/footprint_table.h): species -> graphics symbol
  (the gMonFootprint_* 1bpp symbols extract_gfx writes)
"""

import json
import re

from extract import eval_const_expr, parse_defines
from extract_battle import c_array_body
from extract_gfx import firered_only
from extract_menus import by_index, designated_entries


def c_string_literals(text):
    """`const u8 sym[] = _("a" "b");` -> {sym: "ab$"} (adjacent literals joined, as the compiler does)."""
    out = {}
    for sym, body in re.findall(r"\bconst\s+u8\s+(\w+)\s*\[\s*\]\s*=\s*_\(((?:\s*\"(?:\\.|[^\"\\])*\"\s*)+)\)\s*;", text):
        out[sym] = "".join(re.findall(r"\"((?:\\.|[^\"\\])*)\"", body)) + "$"
    return out


def number_list(body, defines):
    body = re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", body, flags=re.S))
    return [eval_const_expr(v.strip(), defines) for v in body.split(",") if v.strip()]


def extract_pokedex(decomp, out):
    defines = parse_defines(decomp)
    data_dir = decomp / "src/data/pokemon"

    texts = c_string_literals(firered_only((data_dir / "pokedex_text_fr.h").read_text(encoding="utf-8")))
    entries_h = (data_dir / "pokedex_entries.h").read_text(encoding="utf-8")

    def entry(body):
        fields = {}
        m = re.search(r"\.categoryName\s*=\s*_\(\"((?:\\.|[^\"\\])*)\"\)", body)
        fields["categoryName"] = m.group(1) + "$"
        fields["description"] = texts[re.search(r"\.description\s*=\s*(\w+)", body).group(1)]
        for name in ("height", "weight", "pokemonScale", "pokemonOffset", "trainerScale", "trainerOffset"):
            fields[name] = int(re.search(rf"\.{name}\s*=\s*(-?\d+)", body).group(1))
        return fields

    entries = by_index(designated_entries(c_array_body(entries_h, "gPokedexEntries")), defines, lambda v: entry(v))

    orders_h = (data_dir / "pokedex_orders.h").read_text()
    orders = {
        key: number_list(c_array_body(orders_h, f"gPokedexOrder_{name}"), defines)
        for key, name in (("alphabetical", "Alphabetical"), ("weight", "Weight"), ("height", "Height"), ("type", "Type"))
    }

    cat_h = (data_dir / "pokedex_categories.h").read_text()
    pages = {name: number_list(body, defines) for name, body in re.findall(r"static const u16 sDexCategory_(\w+)\[\]\s*=\s*\{([^}]*)\}", cat_h)}

    def category(name):
        body = c_array_body(cat_h, f"sDexCategory_{name}")
        return [pages[p] for p in re.findall(r"DEX_CATEGORY\((\w+)\)", body)]

    categories = [category(name) for name in re.findall(r"DEX_CATEGORY\((\w+)\)", c_array_body(cat_h, "gDexCategories"))]

    fp_h = (decomp / "src/data/pokemon_graphics/footprint_table.h").read_text()
    footprints = by_index(designated_entries(c_array_body(fp_h, "gMonFootprintTable")), defines, lambda v: v)

    data = {"entries": entries, "orders": orders, "categories": categories, "footprints": footprints}
    (out / "pokedex.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"  {len([e for e in entries if e])} Pokédex entries, {len(categories)} habitat categories, {len(footprints)} footprints")


if __name__ == "__main__":
    import sys
    from pathlib import Path

    extract_pokedex(Path(sys.argv[1]), Path(sys.argv[2]))
