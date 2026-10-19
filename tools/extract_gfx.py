"""GBA-native graphics keyed by their C symbol (`const u32 gFoo[] = INCBIN_U32("graphics/....4bpp.lz")`).

Each symbol becomes public/gen/gfx/<symbol>.bin holding exactly what the ROM holds once
decompressed: 4bpp/8bpp tile data, BGR555 palettes or raw tilemaps. The conversion follows the
decomp's own build: gbagfx semantics (8x8 tiles in raster order, grouped into -mwidth x -mheight
metatiles, truncated to -num_tiles) and the custom rules in graphics_file_rules.mk (including
`cat` concatenations such as Castform's forms).
"""

import json
import re
import struct
from pathlib import Path

from PIL import Image

from extract import read_jasc

# Graphics the ported code loads (battle UI, terrain, Pokémon/trainer pics and icons, balls, battle
# anims, party menu, bag and item icons, summary screen and mon markings, the shop's buy menu, the naming
# screen, the PC storage system and item PC, the evolution scene, the field's tilesets and object event pics, which the buy menu's map view draws from VRAM,
# field effect pics, door animation tiles, the cave entrance transition, and the weather graphics (the fog and palette that
# Haze and Mist Ball load and the field's horizontal fog draws), the main menu's palettes, the title screen and Oak's speech, the Hall of Fame and the
# credits, the region map (town map / fly map) with the dungeon map previews it shows, the TM case, the berry
# pouch, and the Pokédex (pokedex_screen.c with the mons' footprints, the area page's maps and
# pokedex_area_markers.c's markers), the Itemfinder's arrows and star (itemfinder.c), and the trainer card
# (trainer_card.c), the move relearner's scroll arrows (learn_move.c), the slot machine (slot_machine.c), and the
# Seagallop ferry scene (seagallop.c), the S.S. Anne's departure (ss_anne.c), Birth Island's triangle palettes
# (field_specials.c's sDeoxysObjectPals), the Deoxys rock's fragments (field_effect.c, already under field_effects/)
# and the battle records' frame (battle_records.c).
GFX_PREFIXES = (
    "graphics/battle_interface/",
    "graphics/battle_terrain/",
    "graphics/battle_anims/",
    "graphics/battle_transitions/",
    "graphics/trainers/",
    "graphics/interface/",
    "graphics/text_window/",
    "graphics/pokemon/",
    "graphics/fonts/",
    "graphics/party_menu/",
    "graphics/item_menu/",
    "graphics/items/",
    "graphics/help_system/",
    "graphics/summary_screen/",
    "graphics/misc/",
    "graphics/shop_menu/",
    "graphics/naming_screen/",
    "graphics/pokemon_storage/",
    "graphics/item_pc/",
    "graphics/evolution_scene/",
    "graphics/object_events/",
    "graphics/field_effects/",
    "graphics/door_anims/",
    "graphics/cave_transition/",
    "graphics/weather/",
    "graphics/main_menu/",
    "graphics/title_screen/",
    "graphics/intro/",  # intro.c: the copyright screen, the Game Freak scene, scenes 1-3 (W-intro)
    "graphics/oak_speech/",
    "graphics/hall_of_fame/",
    "graphics/credits/",
    "graphics/region_map/",
    "graphics/map_preview/",
    "graphics/tm_case/",
    "graphics/berry_pouch/",
    "graphics/pokedex/",
    "graphics/itemfinder/",
    "graphics/trainer_card/",
    "graphics/trade/",
    "graphics/learn_move/",
    "graphics/script_menu/",  # the museum's fossil pics (script_menu.c)
    "graphics/ss_anne/",  # the S.S. Anne's wake and smoke (ss_anne.c, W-ssanne)
    "graphics/diploma/",  # diploma.c (W-misc)
    "graphics/slot_machine/",
    "graphics/seagallop/",  # seagallop.c, the ferry scene (W-ferry)
    "graphics/easy_chat/",  # easy_chat_3.c, the Easy Chat screen (W-easychat)
    "graphics/field_specials/",  # field_specials.c's sDeoxysObjectPals, Birth Island's triangle (W-events)
    "graphics/battle_records/",  # battle_records.c, the Trainer Tower's TIME BOARD and the link records (W-ttower)
    "graphics/fame_checker/",  # fame_checker.c, the Fame Checker (W-fame)
    "graphics/quest_log/",  # quest_log.c's sDescriptionWindow_Gfx, the playback's description window (W-qlog)
    "graphics/mail/",  # mail.c, the mail screen (W-mail)
    "graphics/teachy_tv/",  # teachy_tv.c, the Teachy TV screen (W-teachy)
    "data/tilesets/",
)

# (also `[][16]`-shaped arrays such as the storage system's wallpaper palettes)
INCBIN = re.compile(r"(\w+)\s*(?:\[[^\]]*\])+\s*=\s*INCBIN_U(?:8|16|32)\(((?:\s*\"[^\"]+\"\s*,?)+)\)")
# `const u16 gTextWindowPalettes[][16] = { INCBIN_U16("a"), INCBIN_U16("b") };` -> concatenation
INCBIN_ARRAY = re.compile(r"(\w+)\s*\[[^\]]*\](?:\[[^\]]*\])+\s*=\s*\{((?:\s*INCBIN_U(?:8|16|32)\([^)]*\)\s*,?)+)\s*\}")


# The Makefile's graphics rule files (object event pics need spritesheet_rules.mk's -mwidth/-mheight,
# tilesets tileset_rules.mk's -num_tiles).
RULE_FILES = ("graphics_file_rules.mk", "spritesheet_rules.mk", "tileset_rules.mk")


class MakeRules:
    """The subset of the graphics rule files that changes what a file converts to."""

    def __init__(self, decomp):
        text = "\n".join((decomp / f).read_text() for f in RULE_FILES).replace("\\\n", " ")
        # (whole values: a list such as POKEDEXAREAMARKERFILES spans continued lines)
        self.vars = {k: v.strip() for k, v in re.findall(r"^(\w+)\s*:=[ \t]*(.*)$", text, re.M)}
        self.flags = {}  # target -> gbagfx flags
        self.cats = {}  # target -> [deps]
        lines = text.split("\n")
        for i, line in enumerate(lines):
            m = re.match(r"^(\S+?):\s*(.*)$", line)
            if not m or line.startswith("\t") or ":=" in line:
                continue
            recipe = lines[i + 1] if i + 1 < len(lines) else ""
            targets = self.expand(m.group(1)).split()
            rest = m.group(2)
            if "%.4bpp: %.png" in rest or "%.8bpp: %.png" in rest or "%.gbapal: %.pal" in rest:
                flags = self.parse_flags(recipe)
                for t in targets:
                    self.flags[t] = flags
            elif "cat $^" in recipe:
                for t in targets:
                    self.cats[t] = self.expand(rest).split()

    def expand(self, s):
        """$(VAR) references, recursively (a list variable's entries name other variables)."""
        while (t := re.sub(r"\$\((\w+)\)", lambda m: self.vars.get(m.group(1), ""), s)) != s:
            s = t
        return s

    @staticmethod
    def parse_flags(recipe):
        out = {}
        for name, val in re.findall(r"-(mwidth|mheight|num_tiles)\s+(\d+)", recipe):
            out[name] = int(val)
        return out


class GrayIndices:
    """gbagfx reads greyscale PNGs' raw samples as colour indices (PIL scales them to 0..255) and inverts them:
    ConvertBitDepth keeps the sample's low bits, then ConvertToTiles4Bpp / 8Bpp take 15 - pixel / 255 - pixel.
    `~sample` masked to the output depth (png_tiles does that) is the same."""

    def __init__(self, img, bit_depth):
        self.px = img.load()
        self.scale = 255 // ((1 << bit_depth) - 1)

    def __getitem__(self, xy):
        return ~(self.px[xy] // self.scale) & 0xFF


def open_indexed(png):
    """Pixel access yielding colour indices, or None if the PNG isn't indexed/greyscale."""
    img = Image.open(png)
    if img.mode == "P":
        return img, img.load()
    if img.mode == "L":
        bit_depth = Path(png).read_bytes()[24]
        return img, GrayIndices(img, bit_depth)
    return None, None


def png_tiles(img, px, bpp, mwidth=1, mheight=1, num_tiles=None):
    """gbagfx ConvertToTiles: metatiles in raster order, tiles in raster order within each."""
    tw, th = img.width // 8, img.height // 8
    out = bytearray()
    count = 0
    for my in range(th // mheight):
        for mx in range(tw // mwidth):
            for ty in range(mheight):
                for tx in range(mwidth):
                    if num_tiles is not None and count >= num_tiles:
                        return bytes(out)
                    x0, y0 = (mx * mwidth + tx) * 8, (my * mheight + ty) * 8
                    for y in range(8):
                        if bpp == 4:
                            for x in range(0, 8, 2):
                                out.append((px[x0 + x, y0 + y] & 0xF) | ((px[x0 + x + 1, y0 + y] & 0xF) << 4))
                        else:
                            for x in range(8):
                                out.append(px[x0 + x, y0 + y] & 0xFF)
                    count += 1
    return bytes(out)


def png_tiles_1bpp(img):
    """gbagfx ConvertToTiles1Bpp: 8x8 tiles in raster order, a byte per row with the leftmost pixel in bit 0.
    gbagfx inverts greyscale PNGs (no palette), so the footprints' black pixels become set bits."""
    invert = img.mode != "P"
    if img.mode not in ("P", "1", "L"):
        return None
    px = img.load()
    out = bytearray()
    for ty in range(img.height // 8):
        for tx in range(img.width // 8):
            for y in range(8):
                byte = 0
                for x in range(8):
                    bit = 1 if px[tx * 8 + x, ty * 8 + y] else 0
                    byte |= (bit ^ invert) << x
                out.append(byte)
    return bytes(out)


def bgr555(colors):
    return b"".join(struct.pack("<H", (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10)) for r, g, b in colors)


class GfxBuilder:
    def __init__(self, decomp):
        self.decomp = decomp
        self.rules = MakeRules(decomp)

    def build(self, rel):
        """Bytes of a build product like graphics/x/y.4bpp (the .lz suffix already stripped)."""
        if rel in self.rules.cats:
            parts = [self.build(dep) for dep in self.rules.cats[rel]]
            return None if any(p is None for p in parts) else b"".join(parts)
        path = self.decomp / rel
        stem, ext = path.with_suffix(""), path.suffix
        if ext == ".1bpp":
            png = stem.with_suffix(".png")
            return png_tiles_1bpp(Image.open(png)) if png.exists() else None
        if ext in (".4bpp", ".8bpp"):
            png = stem.with_suffix(".png")
            if not png.exists():
                return None
            img, px = open_indexed(png)
            if img is None:
                return None
            f = self.rules.flags.get(rel, {})
            return png_tiles(img, px, int(ext[1]), f.get("mwidth", 1), f.get("mheight", 1), f.get("num_tiles"))
        if ext == ".gbapal":
            pal = stem.with_suffix(".pal")
            if pal.exists():
                return bgr555(read_jasc(pal))
            png = stem.with_suffix(".png")
            if png.exists():
                img = Image.open(png)
                if img.mode != "P":
                    return None
                raw = img.getpalette()
                n = len(raw) // 3
                return bgr555([tuple(raw[i * 3 : i * 3 + 3]) for i in range(n)])
            return None
        if ext == ".bin" and path.exists():
            return path.read_bytes()
        return None


def firered_only(text):
    """Drop #ifdef LEAFGREEN / #else-of-FIRERED blocks (other conditionals are kept)."""
    out, stack = [], []
    for line in text.split("\n"):
        m = re.match(r"\s*#\s*(ifdef|ifndef|if|else|elif|endif)\b\s*(.*)", line)
        if m:
            kind, cond = m.groups()
            if kind in ("ifdef", "ifndef", "if"):
                names = re.findall(r"\b(FIRERED|LEAFGREEN)\b", cond)
                val = None
                if names:
                    val = names[0] == "FIRERED"
                    if kind == "ifndef" or "!" in cond:
                        val = not val
                stack.append(val)
            elif kind in ("else", "elif") and stack:
                stack[-1] = None if stack[-1] is None else not stack[-1]
            elif kind == "endif" and stack:
                stack.pop()
            continue
        if all(v is not False for v in stack):
            out.append(line)
    return "\n".join(out)


def incbin_symbols(decomp):
    """symbol -> [build product paths] across src/ (C files and the headers they include)."""
    syms = {}
    owner = {}  # symbol -> file stem that holds the plain name
    for f in sorted((decomp / "src").rglob("*.c")) + sorted((decomp / "src/data").rglob("*.h")):
        text = firered_only(f.read_text(errors="replace"))
        for sym, paths in INCBIN.findall(text) + INCBIN_ARRAY.findall(text):
            files = re.findall(r"\"([^\"]+)\"", paths)
            if not all(p.startswith(GFX_PREFIXES) for p in files):
                continue
            if sym in syms and syms[sym] != files:
                # Static symbols with the same name in two files (sBg_Pal): each is also kept as
                # <file stem>.<symbol> (slot_machine.sBg_Pal), the plain name stays the first one's.
                syms.setdefault(f"{owner[sym]}.{sym}", syms[sym])
                syms[f"{f.stem}.{sym}"] = files
                continue
            syms[sym] = files
            owner.setdefault(sym, f.stem)
    return syms


def extract_gfx(decomp, out):
    gfx_dir = out / "gfx"
    gfx_dir.mkdir(parents=True, exist_ok=True)
    builder = GfxBuilder(decomp)
    index = {}
    missing = []
    for sym, files in sorted(incbin_symbols(decomp).items()):
        parts = [builder.build(re.sub(r"\.lz$", "", p)) for p in files]
        if any(p is None for p in parts):
            missing.append(sym)
            continue
        data = b"".join(parts)
        (gfx_dir / f"{sym}.bin").write_bytes(data)
        index[sym] = len(data)
    (gfx_dir / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    print(f"  {len(index)} graphics symbols ({sum(index.values()) // 1024} KB), {len(missing)} without sources")
    if missing:
        print("   e.g.", ", ".join(missing[:8]))


if __name__ == "__main__":
    import sys

    extract_gfx(Path(sys.argv[1]), Path(sys.argv[2]))
