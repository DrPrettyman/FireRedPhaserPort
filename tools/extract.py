#!/usr/bin/env python3
"""Extract FireRed data from a local pret/firered checkout into web-friendly assets.

Output goes to public/gen/ (gitignored). Nothing here ships game content in the repo;
everything is regenerated from the decomp the user points us at.

Usage: python3 tools/extract.py [--decomp PATH] [--out PATH]
"""
import argparse
import json
import os
import re
import shutil
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DECOMP = os.environ.get("FIRERED_DECOMP", str(ROOT.parent / "pret" / "firered"))

# include/fieldmap.h
NUM_TILES_IN_PRIMARY = 640
NUM_METATILES_IN_PRIMARY = 640
NUM_PALS_IN_PRIMARY = 7
NUM_METATILES_TOTAL = 1024
ATLAS_COLS = 32  # 32x32 metatiles of 16px -> 512x512 atlas

# src/fieldmap.c sMetatileAttrMasks
ATTR_BEHAVIOR_MASK = 0x000001FF
ATTR_TERRAIN_SHIFT, ATTR_TERRAIN_MASK = 9, 0x1F
ATTR_ENCOUNTER_SHIFT, ATTR_ENCOUNTER_MASK = 24, 0x7
ATTR_LAYER_SHIFT, ATTR_LAYER_MASK = 29, 0x3
LAYER_NORMAL, LAYER_COVERED, LAYER_SPLIT = 0, 1, 2


def read_jasc(path):
    lines = Path(path).read_text().split()
    # "JASC-PAL" "0100" "16" then r g b triples
    n = int(lines[2])
    vals = list(map(int, lines[3 : 3 + n * 3]))
    return [tuple(vals[i : i + 3]) for i in range(0, n * 3, 3)]


def load_indexed(path):
    img = Image.open(path)
    if img.mode != "P":
        raise ValueError(f"{path} is not an indexed PNG (mode {img.mode})")
    return img


# ---------------------------------------------------------------- tilesets


class Tileset:
    def __init__(self, decomp, symbol, paths):
        self.symbol = symbol
        self.folder = decomp / paths["folder"]
        self.tiles = load_indexed(decomp / paths["tiles"])
        self.tile_cols = self.tiles.width // 8
        self.tile_count = self.tile_cols * (self.tiles.height // 8)
        self.tile_px = self.tiles.load()
        raw = (self.folder / "metatiles.bin").read_bytes()
        self.metatiles = [struct.unpack_from("<8H", raw, i) for i in range(0, len(raw) - 15, 16)]
        raw = (self.folder / "metatile_attributes.bin").read_bytes()
        self.attrs = [struct.unpack_from("<I", raw, i)[0] for i in range(0, len(raw) - 3, 4)]
        self.palettes = [read_jasc(decomp / p) for p in paths["palettes"]]


def parse_tileset_symbols(decomp):
    """Map gTileset_X -> {folder, tiles, palettes} by following headers.h into graphics.h/metatiles.h.

    Tilesets may share graphics (e.g. Silph Co uses another folder's tiles), so never assume paths.
    """
    td = decomp / "src/data/tilesets"
    headers = (td / "headers.h").read_text()
    metatiles_h = (td / "metatiles.h").read_text()
    # Some tile/palette symbols live in src/graphics.c rather than the tileset headers.
    graphics_h = (td / "graphics.h").read_text() + (decomp / "src/graphics.c").read_text()
    meta_paths = dict(re.findall(r"const u16 (gMetatiles_\w+)\[\] = INCBIN_U16\(\"(.+?)/metatiles\.bin\"\)", metatiles_h))
    tile_paths = {
        sym: re.sub(r"\.4bpp(\.lz)?$", ".png", path)
        for sym, path in re.findall(r"const u32 (gTilesetTiles_\w+)\[\] = INCBIN_U32\(\"(.+?)\"\)", graphics_h)
    }
    pal_paths = {
        sym: [re.sub(r"\.gbapal$", ".pal", p) for p in re.findall(r"INCBIN_U16\(\"(.+?)\"\)", body)]
        for sym, body in re.findall(r"const u16 (gTilesetPalettes_\w+)\[\]\[16\] =\s*\{(.*?)\};", graphics_h, re.S)
    }
    out = {}
    for name, body in re.findall(r"const struct Tileset (gTileset_\w+) =\s*\{(.*?)\};", headers, re.S):
        fields = dict(re.findall(r"\.(\w+)\s*=\s*(\w+)", body))
        try:
            out[name] = {
                "folder": meta_paths[fields["metatiles"]],
                "tiles": tile_paths[fields["tiles"]],
                "palettes": pal_paths[fields["palettes"]],
                # The C symbols of the GBA-native data (extract_gfx), for code that loads them into VRAM,
                # and the tileset's animation init function (tileset_anims.c), if any.
                "symbols": {k: fields[k] for k in ("tiles", "palettes", "metatiles")}
                | ({"callback": fields["callback"]} if fields.get("callback", "NULL") != "NULL" else {}),
            }
        except KeyError as e:
            print(f"  tileset {name}: unresolved {e}", file=sys.stderr)
    return out


def depends_on_secondary(entries):
    """True if a primary metatile uses secondary palettes (7+) or tiles, so its look varies per pair."""
    return any(((e >> 12) & 0xF) >= NUM_PALS_IN_PRIMARY or (e & 0x3FF) >= NUM_TILES_IN_PRIMARY for e in entries)


def metatile_attrs(ts):
    """Per-metatile attributes for one tileset (independent of which tileset it is paired with)."""
    out = {"behaviors": [], "layers": [], "encounters": [], "terrains": []}
    for i in range(len(ts.metatiles)):
        attr = ts.attrs[i] if i < len(ts.attrs) else 0
        out["behaviors"].append(attr & ATTR_BEHAVIOR_MASK)
        out["layers"].append((attr >> ATTR_LAYER_SHIFT) & ATTR_LAYER_MASK)
        out["encounters"].append((attr >> ATTR_ENCOUNTER_SHIFT) & ATTR_ENCOUNTER_MASK)
        out["terrains"].append((attr >> ATTR_TERRAIN_SHIFT) & ATTR_TERRAIN_MASK)
    return out


ATLAS_LAYERS = ("bottom", "middle", "top")


def render_atlas(slots, primary, secondary):
    """Render metatiles into 'bottom', 'middle' and 'top' atlases, ATLAS_COLS per row, one slot per metatile.

    `slots` is a list of (entries, layer_type) or None for an empty slot. The three images are the
    field's BG3/BG2/BG1 as DrawMetatile (field_camera.c) fills them for each layer type: NORMAL puts the
    metatile's bottom layer on the middle BG and its top layer on the top BG, COVERED uses the bottom and
    middle BGs, SPLIT the bottom and top. Sprites at OAM priority 3 (reflections, ripples) draw between
    the bottom and middle images, priority 2 between middle and top, priority 1 above all three.
    The bottom image is filled with the backdrop colour where nothing else is drawn.
    """
    palettes = primary.palettes[:NUM_PALS_IN_PRIMARY] + (secondary or primary).palettes[NUM_PALS_IN_PRIMARY:]
    backdrop = palettes[0][0]
    rows = max(1, -(-len(slots) // ATLAS_COLS))
    images = [Image.new("RGBA", (ATLAS_COLS * 16, rows * 16), (0, 0, 0, 0)) for _ in ATLAS_LAYERS]
    bottom, middle, top = (img.load() for img in images)

    def draw_tile(px, entry, ox, oy):
        tile = entry & 0x3FF
        hflip, vflip = entry & 0x400, entry & 0x800
        pal = palettes[(entry >> 12) & 0xF]
        if tile < NUM_TILES_IN_PRIMARY:
            ts, t = primary, tile
        else:
            ts, t = secondary, tile - NUM_TILES_IN_PRIMARY
        if ts is None or t >= ts.tile_count:
            return
        sx, sy = (t % ts.tile_cols) * 8, (t // ts.tile_cols) * 8
        for y in range(8):
            for x in range(8):
                c = ts.tile_px[sx + (7 - x if hflip else x), sy + (7 - y if vflip else y)] & 0xF
                if c:
                    px[ox + x, oy + y] = pal[c] + (255,)

    for slot, item in enumerate(slots):
        if item is None:
            continue
        entries, layer = item
        mx, my = (slot % ATLAS_COLS) * 16, (slot // ATLAS_COLS) * 16
        for y in range(16):
            for x in range(16):
                bottom[mx + x, my + y] = backdrop + (255,)
        lower, upper = {LAYER_NORMAL: (middle, top), LAYER_COVERED: (bottom, middle), LAYER_SPLIT: (bottom, top)}.get(layer, (middle, top))
        for i in range(4):
            ox, oy = mx + (i % 2) * 8, my + (i // 2) * 8
            draw_tile(lower, entries[i], ox, oy)
            draw_tile(upper, entries[4 + i], ox, oy)
    return images


def render_primary(primary):
    """Atlas of the primary's metatiles 0..639. Pair-dependent ones are left blank (see render_pair)."""
    attrs = metatile_attrs(primary)
    slots = [
        None if depends_on_secondary(m) else (m, attrs["layers"][i])
        for i, m in enumerate(primary.metatiles[:NUM_METATILES_IN_PRIMARY])
    ]
    return render_atlas(slots, primary, None)


def render_pair(primary, secondary):
    """Atlas of a pair's own content: secondary metatiles 640..1023 in slots 0..383, then the
    primary metatiles whose appearance depends on the secondary (listed in `overrides`)."""
    sec_attrs, prim_attrs = metatile_attrs(secondary), metatile_attrs(primary)
    n_sec = NUM_METATILES_TOTAL - NUM_METATILES_IN_PRIMARY
    slots = [(m, sec_attrs["layers"][i]) for i, m in enumerate(secondary.metatiles[:n_sec])]
    slots += [None] * (n_sec - len(slots))
    overrides = [i for i, m in enumerate(primary.metatiles[:NUM_METATILES_IN_PRIMARY]) if depends_on_secondary(m)]
    slots += [(primary.metatiles[i], prim_attrs["layers"][i]) for i in overrides]
    return render_atlas(slots, primary, secondary), overrides


# ---------------------------------------------------------------- maps


def extract_maps(decomp, out, ts_folders):
    layouts_json = json.loads((decomp / "data/layouts/layouts.json").read_text())
    layouts = {l["id"]: l for l in layouts_json["layouts"] if l.get("id")}
    maps_dir = decomp / "data/maps"
    tilesets = {}
    pairs = {}
    index = {}
    (out / "maps").mkdir(parents=True, exist_ok=True)

    def get_tileset(sym):
        if sym not in tilesets:
            tilesets[sym] = Tileset(decomp, sym, ts_folders[sym])
        return tilesets[sym]

    for map_dir in sorted(maps_dir.iterdir()):
        mj = map_dir / "map.json"
        if not mj.exists():
            continue
        m = json.loads(mj.read_text())
        layout = layouts.get(m["layout"])
        if not layout:
            print(f"  skip {m['name']}: no layout {m['layout']}", file=sys.stderr)
            continue
        w, h = layout["width"], layout["height"]
        blocks = list(struct.unpack(f"<{w*h}H", (decomp / layout["blockdata_filepath"]).read_bytes()[: w * h * 2]))
        bw, bh = layout["border_width"], layout["border_height"]
        border = list(struct.unpack(f"<{bw*bh}H", (decomp / layout["border_filepath"]).read_bytes()[: bw * bh * 2]))
        pair_key = f"{layout['primary_tileset']}__{layout['secondary_tileset']}".replace("gTileset_", "")
        pairs[pair_key] = (layout["primary_tileset"], layout["secondary_tileset"])
        data = {
            "id": m["id"],
            "name": m["name"],
            "width": w,
            "height": h,
            "blocks": blocks,
            "borderWidth": bw,
            "borderHeight": bh,
            "border": border,
            "tilesetPair": pair_key,
            "music": m.get("music"),
            "weather": m.get("weather"),
            "mapType": m.get("map_type"),
            "regionMapSection": m.get("region_map_section"),
            "battleScene": m.get("battle_scene"),
            "allowCycling": m.get("allow_cycling"),
            "allowRunning": m.get("allow_running"),
            "allowEscaping": m.get("allow_escaping"),
            "showMapName": m.get("show_map_name"),
            "floorNumber": m.get("floor_number", 0),
            # gMapHeader.cave: the map is dark until Flash is used (SetDefaultFlashLevel)
            "cave": bool(m.get("requires_flash", False)),
            "connections": m.get("connections") or [],
            "objectEvents": m.get("object_events") or [],
            "warpEvents": m.get("warp_events") or [],
            "coordEvents": m.get("coord_events") or [],
            "bgEvents": m.get("bg_events") or [],
        }
        (out / "maps" / f"{m['name']}.json").write_text(json.dumps(data, separators=(",", ":")))
        index[m["id"]] = m["name"]

    (out / "maps" / "index.json").write_text(json.dumps(index, indent=1))
    print(f"  {len(index)} maps")

    ts_dir = out / "tilesets"
    ts_dir.mkdir(parents=True, exist_ok=True)
    for old in ts_dir.glob("*.png"):
        old.unlink()
    short = lambda sym: sym.replace("gTileset_", "")
    index = {"primaries": {}, "secondaries": {}, "pairs": {}, "symbols": {}}
    for p in sorted({p for p, _ in pairs.values()}):
        for layer, img in zip(ATLAS_LAYERS, render_primary(get_tileset(p))):
            img.save(ts_dir / f"{short(p)}_{layer}.png", optimize=True)
        index["primaries"][short(p)] = metatile_attrs(get_tileset(p))
    for s_ in sorted({s_ for _, s_ in pairs.values()}):
        index["secondaries"][short(s_)] = metatile_attrs(get_tileset(s_))
    for key, (p, s_) in sorted(pairs.items()):
        images, overrides = render_pair(get_tileset(p), get_tileset(s_))
        for layer, img in zip(ATLAS_LAYERS, images):
            img.save(ts_dir / f"{key}_{layer}.png", optimize=True)
        index["pairs"][key] = {"primary": short(p), "secondary": short(s_), "overrides": overrides}
    for sym in sorted({t for pair in pairs.values() for t in pair}):
        index["symbols"][short(sym)] = ts_folders[sym]["symbols"]
    (ts_dir / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    # The palettes the atlases were drawn with (JASC colours, not BGR555), so tile animations can redraw
    # metatiles at runtime in exactly the same colours. Loaded on demand.
    palettes = {
        short(sym): [[c for rgb in pal for c in rgb] for pal in get_tileset(sym).palettes]
        for sym in sorted({t for pair in pairs.values() for t in pair})
    }
    (ts_dir / "palettes.json").write_text(json.dumps(palettes, separators=(",", ":")))
    (ts_dir / "attributes.json").unlink(missing_ok=True)
    print(f"  {len(pairs)} tileset pairs")


# ---------------------------------------------------------------- object event sprites


def extract_object_events(decomp, out):
    od = decomp / "src/data/object_events"
    pointers = dict(
        re.findall(r"\[(OBJ_EVENT_GFX_\w+)\]\s*=\s*&(gObjectEventGraphicsInfo_\w+)", (od / "object_event_graphics_info_pointers.h").read_text())
    )
    infos = {}
    for name, body in re.findall(r"const struct ObjectEventGraphicsInfo (\w+) = \{(.*?)\};", (od / "object_event_graphics_info.h").read_text(), re.S):
        fields = dict(re.findall(r"\.(\w+)\s*=\s*([^,]+),", body))
        infos[name] = fields
    pic_tables = {}
    for name, body in re.findall(r"static const struct SpriteFrameImage (\w+)\[\] = \{(.*?)\};", (od / "object_event_pic_tables.h").read_text(), re.S):
        frames = []
        for m in re.finditer(r"overworld_frame\((\w+),\s*(\d+),\s*(\d+),\s*(\d+)\)|obj_frame_tiles\((\w+)\)", body):
            if m.group(1):
                frames.append((m.group(1), int(m.group(4))))
            else:
                frames.append((m.group(5), None))
        pic_tables[name] = frames
    gfx_h = (od / "object_event_graphics.h").read_text()
    pic_paths = {k: v for k, v in re.findall(r"(\w+)\[\] = INCBIN_\w+\(\"(.+?)\"\)", gfx_h)}

    movement_c = (decomp / "src/event_object_movement.c").read_text()
    pal_by_tag = {tag: sym for sym, tag in re.findall(r"\{\s*(gObjectEventPal_\w+),\s*(OBJ_EVENT_PAL_TAG_\w+)\s*\}", movement_c)}
    pal_tag_values = {n: int(v, 0) for n, v in re.findall(r"#define\s+(OBJ_EVENT_PAL_TAG_\w+)\s+(0x[0-9A-Fa-f]+|\d+)", movement_c)}

    # The palette an object's reflection sprite draws with (SetUpReflection → LoadObjectReflectionPalette,
    # sCurrentReflectionType 0): the player's and special objects' come from their paired palette sets;
    # NPC slots 1-4 use the reflection slot gReflectionEffectPaletteMap gives them, which map loading fills
    # from sObjectPaletteTags0 (graphics ids leave reflectionPaletteTag NONE, so nothing repatches it).
    def first_tags(array):
        body = re.search(rf"{array}\[\] = \{{(.*?)\}};", movement_c, re.S)
        return re.findall(r"OBJ_EVENT_PAL_TAG_\w+", body.group(1)) if body else []

    def paired_sets(name):
        body = re.search(rf"{name}\[\] = \{{(.*?)\}};", movement_c, re.S).group(1)
        return {tag: (first_tags(arr) or [None])[0] for tag, arr in re.findall(r"\{\s*(OBJ_EVENT_PAL_TAG_\w+),\s*(s\w+)\s*\}", body)}

    player_reflections = paired_sets("gPlayerReflectionPaletteSets")
    special_reflections = paired_sets("gSpecialObjectReflectionPaletteSets")
    slot_tags = first_tags("sObjectPaletteTags0")
    pal_slots = re.search(r"enum\s*\{([^}]*PALSLOT_PLAYER[^}]*)\}", (decomp / "include/event_object_movement.h").read_text()).group(1)
    pal_slots = {n: i for i, n in enumerate(re.findall(r"PALSLOT_\w+", pal_slots))}
    reflection_map = dict(re.findall(r"\[(PALSLOT_\w+)\]\s*=\s*(PALSLOT_\w+)", re.search(r"gReflectionEffectPaletteMap\[16\] = \{(.*?)\};", movement_c, re.S).group(1)))

    def reflection_tag(info):
        slot, tag = info.get("paletteSlot", "").strip(), info.get("paletteTag", "").strip()
        if slot == "PALSLOT_PLAYER":
            return player_reflections.get(tag)
        if slot == "PALSLOT_NPC_SPECIAL":
            return special_reflections.get(tag)
        target = pal_slots.get(reflection_map.get(slot, ""))
        return slot_tags[target] if target is not None and target < len(slot_tags) else None

    def png_for(sym):
        p = pic_paths.get(sym)
        if not p:
            return None
        return decomp / re.sub(r"\.(4bpp|gbapal)(\.lz)?$", ".png", p)

    def pal_for(tag):
        sym = pal_by_tag.get(tag)
        if not sym or sym not in pic_paths:
            return None
        path = decomp / re.sub(r"\.gbapal$", ".pal", pic_paths[sym])
        return read_jasc(path) if path.exists() else None

    # GetColorFromTextColorTable: one nibble per graphics id (NPC_TEXT_COLOR_MALE/FEMALE/MON/NEUTRAL).
    color_src = (decomp / "src/dynamic_placeholder_text_util.c").read_text()
    gfx_ids = {n: int(v, 0) for n, v in re.findall(r"#define\s+(OBJ_EVENT_GFX_\w+)\s+(0x[0-9A-Fa-f]+|\d+)", (decomp / "include/constants/event_objects.h").read_text())}
    npc_colors = {n: int(v, 0) for n, v in re.findall(r"#define\s+(NPC_TEXT_COLOR_\w+)\s+(\d+)", (decomp / "include/constants/vars.h").read_text())}
    colors_by_gfx = {}
    for name, low, high in re.findall(r"\[(OBJ_EVENT_GFX_\w+)\s*/\s*2\]\s*=\s*COLORS\((\w+),\s*(\w+)\)", color_src):
        base = gfx_ids.get(name)
        if base is not None:
            colors_by_gfx[base & ~1] = npc_colors.get(low, 3)
            colors_by_gfx[(base & ~1) | 1] = npc_colors.get(high, 3)

    def text_color(gfx_id):
        n = gfx_ids.get(gfx_id)
        return colors_by_gfx.get(n, 3) if n is not None else 3

    def gba_info(info, table):
        """CopyObjectGraphicsInfoToSpriteTemplate's inputs: GBA-native pics (extract_gfx symbols) per frame."""
        tag = info.get("paletteTag", "").strip()
        w_tiles, h_tiles = int(info["width"]) // 8, int(info["height"]) // 8
        frame_size = w_tiles * h_tiles * 32
        frames = []
        for sym, frame in table:
            # overworld_frame(ptr, w, h, frame) = {ptr + frame * w * h * TILE_SIZE_4BPP, w * h * TILE_SIZE_4BPP};
            # obj_frame_tiles(ptr) = {ptr, sizeof(ptr)}: the whole symbol (size -1 here).
            frames.append([sym, 0, -1] if frame is None else [sym, frame * frame_size, frame_size])
        return {
            "paletteTag": pal_tag_values.get(tag, 0x11FF),
            "palette": pal_by_tag.get(tag),
            "oam": re.sub(r"^&gObjectEventBaseOam_", "", info.get("oam", "").strip()),
            "images": frames,
        }

    def render_strip(table, fw, fh, pal):
        strip = Image.new("RGBA", (fw * len(table), fh), (0, 0, 0, 0))
        for i, (sym, frame) in enumerate(table):
            path = png_for(sym)
            if not path or not path.exists():
                return None
            img = Image.open(path)
            if frame is None:
                sx, sy = 0, 0
            else:
                cols = max(1, img.width // fw)
                sx, sy = (frame % cols) * fw, (frame // cols) * fh
            cell = img.crop((sx, sy, sx + fw, sy + fh))
            if img.mode == "P":
                idx = cell.load()
                rgba = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
                rp = rgba.load()
                colors = pal or [tuple(img.getpalette()[c * 3 : c * 3 + 3]) for c in range(16)]
                for y in range(fh):
                    for x in range(fw):
                        c = idx[x, y] & 0xF
                        if c:
                            rp[x, y] = colors[c] + (255,)
                cell = rgba
            else:
                cell = cell.convert("RGBA")
            strip.paste(cell, (i * fw, 0))
        return strip

    # Start clean: on a case-insensitive disk, overwriting an old "Blackbelt.png" keeps that name, and the
    # dev server's case-sensitive lookup of "BlackBelt.png" then misses it.
    shutil.rmtree(out / "sprites", ignore_errors=True)
    (out / "sprites").mkdir(parents=True, exist_ok=True)
    manifest = {}
    written = {}
    for gfx_id, info_name in pointers.items():
        info = infos.get(info_name)
        if not info:
            continue
        table = pic_tables.get(info.get("images", ""))
        if not table:
            continue
        fw, fh = int(info["width"]), int(info["height"])
        key = info_name.replace("gObjectEventGraphicsInfo_", "")
        if key not in written:
            strip = render_strip(table, fw, fh, pal_for(info.get("paletteTag", "")))
            if strip is None:
                print(f"  skip sprite {key}: missing image", file=sys.stderr)
                continue
            strip.save(out / "sprites" / f"{key}.png", optimize=True)
            written[key] = {
                "key": key,
                "frameWidth": fw,
                "frameHeight": fh,
                "frameCount": len(table),
                "anims": info.get("anims", "").strip(),
                "inanimate": info.get("inanimate", "FALSE").strip() == "TRUE",
                "shadowSize": info.get("shadowSize", "SHADOW_SIZE_M").strip(),
                "tracks": info.get("tracks", "TRACKS_NONE").strip(),
            }
            refl_pal = pal_for(reflection_tag(info) or "")
            if refl_pal:
                render_strip(table, fw, fh, refl_pal).save(out / "sprites" / f"{key}_reflection.png", optimize=True)
                written[key]["reflection"] = True
        manifest[gfx_id] = {**written[key], "textColor": text_color(gfx_id), "gba": gba_info(info, table)}
    (out / "sprites" / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"  {len(written)} sprite sheets, {len(manifest)} gfx ids")


def extract_field_effects(decomp, out):
    """Emote icons (trainer_see.c sSpriteTemplate_Emoticons): a strip in sSpriteImages_Emoticons order plus
    sSpriteAnimTable_Emoticons as [[frame, duration], ...] per anim. oam.paletteNum 0 is the player's palette
    slot in the field, which is also the PNG's own palette."""
    src = (decomp / "src/trainer_see.c").read_text()
    gfx_path = re.search(r"sGfx_Emoticons\[\] = INCBIN_U16\(\"(.+?)\.4bpp\"\)", src).group(1)
    images = re.search(r"sSpriteImages_Emoticons\[\] =\s*\{(.*?)\};", src, re.S).group(1)
    frames = [int(n) for n in re.findall(r"overworld_frame\(sGfx_Emoticons,\s*2,\s*2,\s*(\d+)\)", images)]
    cmds = {name: [[int(f), int(d)] for f, d in re.findall(r"ANIMCMD_FRAME\(\s*(\d+),\s*(\d+)\)", body)]
            for name, body in re.findall(r"static const union AnimCmd (\w+)\[\] = \{(.*?)\};", src, re.S)}
    table = re.search(r"sSpriteAnimTable_Emoticons\[\] = \{(.*?)\};", src, re.S).group(1)
    anims = [cmds[name] for name in re.findall(r"\w+", table)]

    img = load_indexed(decomp / f"{gfx_path}.png")
    pal = img.getpalette()
    idx = img.load()
    cols = img.width // 16
    strip = Image.new("RGBA", (16 * len(frames), 16), (0, 0, 0, 0))
    sp = strip.load()
    for i, n in enumerate(frames):
        sx, sy = (n % cols) * 16, (n // cols) * 16
        for y in range(16):
            for x in range(16):
                c = idx[sx + x, sy + y] & 0xF
                if c:
                    sp[i * 16 + x, y] = tuple(pal[c * 3 : c * 3 + 3]) + (255,)
    fe = out / "field_effects"
    fe.mkdir(parents=True, exist_ok=True)
    strip.save(fe / "emoticons.png", optimize=True)
    (fe / "emoticons.json").write_text(json.dumps({"frameWidth": 16, "frameHeight": 16, "anims": anims}))
    print(f"  emoticons: {len(frames)} frames, {len(anims)} anims")
    extract_field_effect_scripts(decomp, fe)


def extract_field_effect_scripts(decomp, fe):
    """data/field_effect_scripts.s: gFieldEffectScriptPointers (FLDEFF_* order) and each script's commands
    (asm/macros/field_effect_script.inc: loadtiles, loadfadedpal, loadpal, callnative, end and the combined
    loadgfx_callnative / loadtiles_callnative / loadfadedpal_callnative) as [name, ...symbol args]."""
    src = (decomp / "data/field_effect_scripts.s").read_text()
    pointers = re.findall(r"\.4byte\s+(\w+)\s*@\s*(FLDEFF_\w+)", src)
    scripts = {}
    for label, body in re.findall(r"^(gFldEffScript_\w+)::\n(.*?)(?=^\w+::|\Z)", src, re.S | re.M):
        cmds = []
        for line in body.splitlines():
            line = line.split("@")[0].strip()
            if not line:
                continue
            op, _, args = line.partition(" ")
            cmds.append([op] + [a.strip() for a in args.split(",") if a.strip()])
        scripts[label] = cmds
    table = {fldeff: scripts[label] for label, fldeff in pointers}
    (fe / "scripts.json").write_text(json.dumps(table, separators=(",", ":")))
    print(f"  {len(table)} field effect scripts")


# ---------------------------------------------------------------- text: charmap, fonts, windows


def parse_charmap(decomp):
    """charmap.txt -> {chars: {'A': [0xBB]}, names: {'PLAYER': [0xFD, 0x01]}} (as preproc reads it)."""
    chars, names = {}, {}
    for line in (decomp / "charmap.txt").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("@"):
            continue
        m = re.match(r"^'((?:\\.|[^'])+)'\s*=\s*([0-9A-Fa-f ]+)", line) or re.match(r"^(\w+)\s*=\s*([0-9A-Fa-f ]+)", line)
        if not m:
            continue
        key, val = m.group(1), [int(b, 16) for b in m.group(2).split()]
        if line.startswith("'") and key in ("\\'", "\\\\"):
            key = key[1]  # '\'' -> ', '\\' -> \
        if line.startswith("'"):
            chars.setdefault(key, val)
        else:
            names.setdefault(key, val)
    return {"chars": chars, "names": names}


FONT_IDS = {"Small": 0, "NormalCopy1": 1, "Normal": 2, "NormalCopy2": 3, "Male": 4, "Female": 5}


def extract_text_assets(decomp, out):
    td = out / "text"
    td.mkdir(parents=True, exist_ok=True)
    (td / "charmap.json").write_text(json.dumps(parse_charmap(decomp), ensure_ascii=False, separators=(",", ":")))

    # Fonts: latin glyph sheets (16x16 cells, 16 per row, indexed by charmap byte). 2bpp values:
    # 1 = foreground, 2 = shadow, 0/3 = background (sFontHalfRowOffsets maps 3 like 0).
    text_c = (decomp / "src/text.c").read_text()
    # .hwlatfont sheets hold 8x16 glyphs, 32 per row; .fwlatfont (and the older .latfont) 16x16, 16 per row.
    glyph_imgs = {n: (p, ext) for n, p, ext in re.findall(r"static const u16 sFont(\w+)LatinGlyphs\[\] = INCBIN_U16\(\"(.+?)\.((?:hw|fw)?latfont)\"\)", text_c)}
    widths = {
        name: [int(v) for v in re.findall(r"\d+", body)]
        for name, body in re.findall(r"static const u8 sFont(\w+)LatinGlyphWidths\[\] =\s*\{(.*?)\};", text_c, re.S)
    }
    infos = {}
    menu_c = (decomp / "src/new_menu_helpers.c").read_text()
    for font, body in re.findall(r"\[(FONT_\w+)\]\s*=\s*\{(.*?)\}", menu_c, re.S):
        f = dict(re.findall(r"\.(\w+)\s*=\s*(\w+)", body))
        if "maxLetterWidth" in f:
            infos[font] = {k: int(f[k], 0) for k in ("maxLetterWidth", "maxLetterHeight", "letterSpacing", "lineSpacing", "fgColor", "bgColor", "shadowColor")}
    id_to_const = {0: "FONT_SMALL", 1: "FONT_NORMAL_COPY_1", 2: "FONT_NORMAL", 3: "FONT_NORMAL_COPY_2", 4: "FONT_MALE", 5: "FONT_FEMALE"}
    fonts = {}
    written = set()
    for name, (path, ext) in glyph_imgs.items():
        if name not in FONT_IDS or name not in widths:
            continue
        img_name = Path(path).name
        if img_name not in written:
            src = Image.open(decomp / f"{path}.png")
            px = src.load()
            mask = Image.new("L", src.size, 0)
            mp = mask.load()
            for y in range(src.height):
                for x in range(src.width):
                    v = px[x, y]
                    mp[x, y] = 255 if v == 1 else 128 if v == 2 else 0
            mask.save(td / f"{img_name}.png", optimize=True)
            written.add(img_name)
        fid = FONT_IDS[name]
        fonts[fid] = {"name": name, "image": img_name, "halfWidth": ext == "hwlatfont", "widths": widths[name], **infos.get(id_to_const[fid], {})}

    # Dialogue frame (menu_message) + down arrow, rendered with the text window palette (stdpal_0).
    pal = read_jasc(decomp / "graphics/text_window/stdpal_0.pal")

    def render_indexed(src_path, dst_name, pal=pal):
        src = Image.open(src_path)
        px = src.load()
        dst = Image.new("RGBA", src.size, (0, 0, 0, 0))
        dp = dst.load()
        for y in range(src.height):
            for x in range(src.width):
                c = px[x, y] & 0xF
                if c:
                    dp[x, y] = pal[c] + (255,)
        dst.save(td / dst_name, optimize=True)

    render_indexed(decomp / "graphics/text_window/menu_message.png", "dialogue_frame.png")
    # LoadSignpostWindowFrameGfx: gSignpostWindow_Gfx with GetTextWindowPalette(1) (stdpal_1).
    render_indexed(decomp / "graphics/text_window/signpost.png", "signpost_frame.png", read_jasc(decomp / "graphics/text_window/stdpal_1.pal"))
    # User-selectable std window frames (options "FRAME" setting); each has its own palette.
    for n in range(1, 11):
        png = decomp / f"graphics/text_window/type{n}.png"
        if not png.exists():
            continue
        src = Image.open(png)
        # typeN.gbapal is generated from the PNG's own embedded palette.
        raw_pal = src.getpalette()[:48]
        frame_pal = [tuple(raw_pal[i : i + 3]) for i in range(0, 48, 3)]
        px = src.load()
        dst = Image.new("RGBA", src.size, (0, 0, 0, 0))
        dp = dst.load()
        for y in range(src.height):
            for x in range(src.width):
                c = px[x, y] & 0xF
                if c:
                    dp[x, y] = frame_pal[c] + (255,)
        dst.save(td / f"frame_type{n}.png", optimize=True)
    render_indexed(decomp / "graphics/fonts/down_arrows.png", "down_arrows.png")
    # LoadStdWindowGfx's frame (gStdTextWindow_Gfx, text window palette 3): the money box and others.
    pal = read_jasc(decomp / "graphics/text_window/stdpal_3.pal")
    render_indexed(decomp / "graphics/text_window/std.png", "frame_std.png")
    # sKeypadIcons (text.c): [tile offset into gKeypadIconTiles, width, height] by CHAR_*_BUTTON / CHAR_DPAD_* id.
    defines = parse_defines(decomp)
    keypad = []
    body = text_c[text_c.index("sKeypadIcons[] =") :]
    body = body[: body.index("};")]
    for key, off, w, h in re.findall(r"\[(\w+)\]\s*=\s*\{\s*(\w+),\s*(\d+),\s*(\d+)\s*\}", body):
        idx = defines[key]
        keypad += [None] * (idx + 1 - len(keypad))
        keypad[idx] = [int(off, 0), int(w), int(h)]
    (td / "fonts.json").write_text(json.dumps({"fonts": fonts, "windowPalette": pal, "keypadIcons": keypad}, separators=(",", ":")))
    print(f"  {len(fonts)} fonts, charmap")


# ---------------------------------------------------------------- scripts + strings

DIRECTIVES_SKIP = (".include", ".global", ".align", ".section", ".set", ".equ", ".macro", ".endm", ".if", ".endif", ".else", ".ifdef", ".ifndef")


def split_args(s):
    """Split macro arguments on commas, respecting quotes and parentheses."""
    args, cur, depth, quote = [], "", 0, False
    for ch in s:
        if ch == '"':
            quote = not quote
        if not quote and ch in "([":
            depth += 1
        if not quote and ch in ")]":
            depth -= 1
        if ch == "," and depth == 0 and not quote:
            args.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        args.append(cur.strip())
    return args


def strip_comment(line):
    out, quote = "", False
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == '"' and (i == 0 or line[i - 1] != "\\"):
            quote = not quote
        if not quote and (ch == "@" or line.startswith("//", i)):
            break
        out += ch
        i += 1
    return out


def eval_const_expr(expr, known):
    """Evaluate a C constant expression made of numbers, known names and + - * / << >> | & ~ ^."""
    tokens = re.findall(r"0x[0-9A-Fa-f]+|\d+|\w+|<<|>>|[()+\-*/|&~^]", expr)
    out = []
    for t in tokens:
        if re.fullmatch(r"0x[0-9A-Fa-f]+|\d+", t):
            out.append(str(int(t, 0)))
        elif re.fullmatch(r"\w+", t):
            if t not in known:
                return None
            out.append(str(known[t]))
        else:
            out.append("//" if t == "/" else t)
    try:
        v = eval(" ".join(out), {"__builtins__": {}}, {})
    except Exception:
        return None
    return int(v) if isinstance(v, int) else None


EXPAND_EVENT_MACROS = {
    "giveitem", "finditem", "putitemaway", "msgreceiveditem", "giveitem_msg", "famechecker", "set_gym_trainers",
    "goto_if_questlog", "seteventmon", "braillemessage_wait",
    "trainerbattle_earlyrival", "trainerbattle_rematch", "trainerbattle_rematch_double", "trainerbattle_no_intro",
    "trainerbattle_single", "trainerbattle_double",
}


def asm_condition(cond, known):
    """`.if` operand after argument substitution: `A == B`, `A != B` or a bare value. Names that aren't
    constants (script labels) compare as themselves, so `SomeLabel == FALSE` is false like in gas."""

    def value(x):
        x = x.strip()
        v = eval_const_expr(x, known)
        return x if v is None else v

    m = re.fullmatch(r"(.+?)\s*(==|!=)\s*(.+)", cond.strip())
    if m:
        eq = value(m.group(1)) == value(m.group(3))
        return eq if m.group(2) == "==" else not eq
    v = value(cond)
    return v != 0 if isinstance(v, int) else True


def expand_conditionals(lines, known):
    """Keep the lines of a macro body whose .if/.elseif/.else/.endif branch is taken."""
    out, stack = [], []  # stack entries: [this branch active, some branch already taken, parent active]
    for line in lines:
        directive = line.split(None, 1)
        d, rest = directive[0], (directive[1] if len(directive) > 1 else "")
        active = all(e[0] for e in stack)
        if d == ".if":
            ok = active and asm_condition(rest, known)
            stack.append([ok, ok, active])
        elif d == ".elseif":
            e = stack[-1]
            e[0] = e[2] and not e[1] and asm_condition(rest, known)
            e[1] = e[1] or e[0]
        elif d == ".else":
            e = stack[-1]
            e[0] = e[2] and not e[1]
            e[1] = True
        elif d == ".endif":
            stack.pop()
        elif active:
            out.append(line)
    return out


def macro_params(header):
    """`.macro name a:req, b=1` header -> [("a", ""), ("b", "1")]."""
    out = []
    for a in split_args(header) if header.strip() else []:
        name, _, default = a.partition("=")
        out.append((name.split(":")[0].strip(), default.strip()))
    return out


def extract_scripts(decomp, out):
    """Flatten event_scripts.s and everything it includes into one instruction stream.

    code: [[op, arg, ...], ...]   labels: {label: index}   (fall-through between labels is preserved)
    strings: {label: raw decomp string}   (.string data, encoded at runtime with the charmap)
    """
    code, labels, strings = [], {}, {}
    equs = {}
    seen = set()

    def subst(tok):
        return equs.get(tok, tok)

    macros = {}  # name -> (params, body lines); only macros defined in script files (asm/ is skipped)
    known = {}  # constants for macro .if conditions, filled before the walk

    def walk(rel):
        if rel in seen or rel.startswith("asm/") or rel.endswith(("script_cmd_table.inc", "specials.inc")):
            return
        seen.add(rel)
        path = decomp / rel
        if not path.exists():
            return
        st = {"pending": [], "after_label": False, "macro": None}

        def handle(line):
            if st["macro"] is not None:
                if line.startswith(".endm"):
                    name, params, body = st["macro"]
                    macros[name] = (params, body)
                    st["macro"] = None
                else:
                    st["macro"][2].append(line)
                return
            m = re.match(r"^\.macro\s+(\w+)\s*(.*)$", line)
            if m:
                st["macro"] = (m.group(1), macro_params(m.group(2)), [])
                return
            m = re.match(r'^\.include\s+"(.+?)"', line)
            if m:
                walk(m.group(1))
                return
            m = re.match(r"^\.(?:equ|set)\s+(\w+)\s*,\s*(.+)$", line)
            if m:
                equs[m.group(1)] = subst(m.group(2).strip())
                return
            m = re.match(r"^([A-Za-z_][\w.]*)::?\s*(.*)$", line)
            if m and not line.startswith("."):
                labels[m.group(1)] = len(code)
                st["pending"] = st["pending"] + [m.group(1)] if st["after_label"] else [m.group(1)]
                st["after_label"] = True
                line = m.group(2).strip()
                if not line:
                    return
            st["after_label"] = False
            if line.startswith(".string"):
                text = "".join(re.findall(r'"((?:\\.|[^"\\])*)"', line))
                for lab in st["pending"]:
                    strings[lab] = strings.get(lab, "") + text
                code.append([".string", text])
                return
            if line.startswith(DIRECTIVES_SKIP):
                return
            parts = line.split(None, 1)
            op = parts[0]
            args = split_args(parts[1]) if len(parts) > 1 else []
            if op in macros:
                params, body = macros[op]
                # Longest names first so \\item doesn't clobber \\items.
                order = sorted(range(len(params)), key=lambda i: -len(params[i][0]))
                lines = []
                for bl in body:
                    for i in order:
                        prm, default = params[i]
                        bl = bl.replace("\\" + prm, args[i] if i < len(args) and args[i] else default)
                    lines.append(bl)
                for bl in expand_conditionals(lines, known):
                    handle(bl)
                return
            code.append([op] + [subst(a) for a in args])

        for raw in path.read_text(encoding="utf-8").splitlines():
            line = strip_comment(raw).strip()
            if line:
                handle(line)

    # Event macros that are pure sequences of other script commands are expanded like the assembler
    # would, so the interpreter only needs the underlying commands (giveitem_msg = additem + ...).
    event_inc = (decomp / "asm/macros/event.inc").read_text()
    for name, header, body in re.findall(r"^\s*\.macro\s+(\w+)([^\n]*)\n(.*?)^\s*\.endm", event_inc, re.M | re.S):
        if name in EXPAND_EVENT_MACROS:
            lines = [strip_comment(l).strip() for l in body.splitlines()]
            macros[name] = (macro_params(header), [l for l in lines if l])

    # Numeric constants scripts compare against (TRUE, MALE, DIR_*, MSGBOX_*, ITEM_*, ...), plus the
    # assembler symbols the event macros' .if conditions use (e.g. `NO_MUSIC = FALSE`).
    defines = parse_defines(decomp)
    known.update(defines)
    known.update({"TRUE": 1, "FALSE": 0})
    known.update({k: known[v] for k, v in re.findall(r"^\s*(\w+)\s*=\s*(TRUE|FALSE)\s*$", event_inc, re.M)})

    walk("data/event_scripts.s")

    std = []
    i = labels.get("gStdScripts")
    while i is not None and i < len(code) and code[i][0] == ".4byte":
        std.append(code[i][1])
        i += 1

    # vs_seeker.c sRematches: each trainer's rematch parties (SKIP = 0xFFFF), for ShouldTryRematchBattle etc.
    vs = (decomp / "src/vs_seeker.c").read_text()
    body = re.search(r"sRematches\[\]\s*=\s*\{(.*?)\n\};", vs, re.S).group(1)
    rematches = [
        [0xFFFF if t == "SKIP" else defines[t] for t in re.findall(r"\w+", ids)]
        for ids in re.findall(r"\{\s*\{([^}]*)\}", body)
    ]

    # src/data/heal_locations.json (the decomp generates HEAL_LOCATION_* = index + 1 from it): fly/respawn
    # points, plus the map and healer NPC a white-out sends you to (sWhiteoutRespawnHealCenterMapIdxs/NpcIds).
    heal_locations = []
    for i, h in enumerate(json.loads((decomp / "src/data/heal_locations.json").read_text())["heal_locations"]):
        defines[h["id"]] = i + 1
        heal_locations.append({"map": h["map"], "x": h["x"], "y": h["y"], "respawnMap": h["respawn_map"], "respawnNpc": h["respawn_npc"]})

    # overworld.c ComputeWhiteOutMoneyLoss tables.
    ow = (decomp / "src/overworld.c").read_text()

    def c_array(name):
        body = re.search(rf"{name}\[\]\s*=\s*\{{(.*?)\}};", ow, re.S).group(1)
        return [int(t) if t.isdigit() else defines[t] for t in re.findall(r"\w+", body)]

    white_out = {"moneyLossMultipliers": c_array("sWhiteOutMoneyLossMultipliers"), "moneyLossBadgeFlags": c_array("sWhiteOutMoneyLossBadgeFlagIDs")}

    # script_menu.c sMultichoiceLists: MULTICHOICE_* -> the MenuAction texts (string symbols) of its list.
    sm = (decomp / "src/script_menu.c").read_text()
    mc_lists = {
        name: re.findall(r"\{\s*(\w+)\s*\}", body)
        for name, body in re.findall(r"static const struct MenuAction (sMultichoiceList_\w+)\[\]\s*=\s*\{(.*?)\};", sm, re.S)
    }
    table = re.search(r"sMultichoiceLists\[\]\s*=\s*\{(.*?)\};", sm, re.S).group(1)
    multichoices = []
    for mc, lst in re.findall(r"\[(MULTICHOICE_\w+)\]\s*=\s*MULTICHOICE\((\w+)\)", table):
        idx = defines[mc]
        multichoices += [None] * (idx + 1 - len(multichoices))
        multichoices[idx] = mc_lists[lst]

    # field_specials.c sListMenuLabels: LISTMENU_* -> the string symbols of special ListMenu's items.
    fs = (decomp / "src/field_specials.c").read_text()
    table = re.search(r"sListMenuLabels\[\]\[\d+\]\s*=\s*\{(.*?)\n\};", fs, re.S).group(1)
    list_menus = []
    for lm, body in re.findall(r"\[(LISTMENU_\w+)\]\s*=\s*(?://[^\n]*)?\s*\{(.*?)\}", table, re.S):
        idx = defines[lm]
        list_menus += [None] * (idx + 1 - len(list_menus))
        list_menus[idx] = re.findall(r"\w+", body)

    sd = out / "scripts"
    sd.mkdir(parents=True, exist_ok=True)
    (sd / "scripts.json").write_text(
        json.dumps(
            {"code": code, "labels": labels, "defines": defines, "stdScripts": std, "rematches": rematches, "healLocations": heal_locations, "whiteOut": white_out, "multichoices": multichoices, "listMenus": list_menus},
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    # C strings (menu labels etc.): const u8 gText_X[] = _("..." "...");
    for cfile in ("src/strings.c", "src/keyboard_text.c"):
        src = (decomp / cfile).read_text(encoding="utf-8")
        for name, body in re.findall(r"const u8 (\w+)\[\]\s*=\s*_\((.*?)\);", src, re.S):
            parts = re.findall(r'"((?:\\.|[^"\\])*)"', body)
            if parts and name not in strings:
                strings[name] = "".join(parts) + "$"
    (out / "text" / "strings.json").write_text(json.dumps(strings, ensure_ascii=False, separators=(",", ":")))
    print(f"  {len(seen)} files, {len(code)} instructions, {len(labels)} labels, {len(strings)} strings")


# ---------------------------------------------------------------- pokemon, moves, items


# Non-constants headers whose #defines and enums the battle engine needs (B_ACTION_*, CONTROLLER_*, ...).
EXTRA_DEFINE_HEADERS = (
    "include/global.h", "include/battle.h", "include/battle_controllers.h", "include/battle_message.h",
    "include/battle_interface.h", "include/battle_ai_script_commands.h", "include/battle_setup.h",
    "include/battle_anim.h", "include/pokemon.h", "include/characters.h", "include/text.h", "include/event_object_movement.h",
    "include/battle_ai_switch_items.h", "include/battle_util.h", "include/battle_gfx_sfx_util.h",
    "include/pokeball.h", "include/sprite.h", "include/gba/io_reg.h", "include/bg.h", "include/window.h",
    "include/palette.h", "include/scanline_effect.h", "include/trainer_pokemon_sprites.h", "include/decompress.h",
    "include/battle_main.h", "include/battle_script_commands.h", "include/gba/types.h", "include/gba/defines.h", "include/menu.h", "include/pokemon_icon.h", "include/pokedex.h", "include/berry.h",
    "include/item.h", "include/item_menu.h", "include/item_menu_icons.h", "include/list_menu.h", "include/menu_helpers.h",
    "include/menu_indicators.h", "include/money.h", "include/party_menu.h", "include/new_menu_helpers.h", "include/item_use.h",
    "include/task.h", "include/pokemon_summary_screen.h", "include/mon_markings.h", "include/data.h",
    "include/naming_screen.h", "include/pokemon_storage_system.h", "include/pokemon_storage_system_internal.h", "include/battle_transition.h",
    # field_player_avatar.c / bike.c: PLAYER_AVATAR_FLAG_*, COLLISION_*, T_*, running states, BIKE_*
    "include/global.fieldmap.h", "include/bike.h",
    # save.c / start_menu.c / main_menu.c: SAVE_STATUS_*, SAVE_NORMAL.., CONTINUE_GAME_WARP, SAVE_STAT_*
    "include/save.h", "include/save_location.h", "include/save_menu_util.h",
)


def region_map_sections_header(decomp):
    """include/constants/region_map_sections.h is generated at build time from
    src/data/region_map/region_map_sections.json through a jinja template; render its one loop."""
    tmpl = decomp / "src/data/region_map/region_map_sections.constants.json.txt"
    data = decomp / "src/data/region_map/region_map_sections.json"
    if not tmpl.exists() or not data.exists():
        return ""
    ids = [m["id"] for m in json.loads(data.read_text())["map_sections"]]
    loop = re.compile(r"## for map_section in map_sections\n(.*?)## endfor\n", re.S)
    return loop.sub(lambda m: "".join(m.group(1).replace("{{ map_section.id }}", i) for i in ids), tmpl.read_text())


def parse_defines(decomp):
    """Numeric #defines and enum values from include/constants and the battle headers
    (incl. simple expressions and aliases)."""
    defines = {}
    headers = sorted((decomp / "include/constants").glob("*.h")) + [decomp / h for h in EXTRA_DEFINE_HEADERS]
    texts = [re.sub(r"/\*.*?\*/", "", hdr.read_text(errors="ignore"), flags=re.S) for hdr in headers if hdr.exists()]
    texts.append(region_map_sections_header(decomp))
    # `((u8) -1)` style values: the u8 they wrap around to.
    texts = [re.sub(r"\(\s*u8\s*\)\s*-\s*(\d+)", lambda m: str(256 - int(m.group(1))), t) for t in texts]
    for text in texts:
        for name, val in re.findall(r"^#define\s+(\w+)\s+\(?(-?(?:0x[0-9A-Fa-f]+|\d+))\)?\s*(?://.*)?$", text, re.M):
            defines.setdefault(name, int(val, 0))
    # Assembler symbols such as MSGBOX_NPC = 2 / STD_OBTAIN_ITEM = 0 live in the event macros.
    for name, val in re.findall(r"^\s*(\w+)\s*=\s*(\d+)\s*$", (decomp / "asm/macros/event.inc").read_text(), re.M):
        defines.setdefault(name, int(val))
    # Resolve aliases and simple arithmetic (#define FLAG_X (SYS_FLAGS + 0x90)) until nothing changes.
    pending = {}
    for text in texts:
        for name, expr in re.findall(r"^#define\s+(\w+)\s+(.+?)\s*(?://.*)?$", text, re.M):
            if name not in defines and re.fullmatch(r"[\w\s()+\-*/<>|&~^]+", expr):
                pending[name] = expr
    enums = [body for text in texts for body in re.findall(r"\benum\s*\w*\s*\{(.*?)\}", text, re.S)]
    progress = True
    while progress:
        progress = False
        for name, expr in list(pending.items()):
            v = eval_const_expr(expr, defines)
            if v is not None:
                defines[name] = v
                del pending[name]
                progress = True
        # enum { A, B = X + 1, C }: values follow the previous one; stop at an unresolvable expression.
        for body in enums:
            value = -1
            for entry in re.sub(r"//[^\n]*", "", body).split(","):
                entry = entry.strip()
                m = re.fullmatch(r"(\w+)(?:\s*=\s*(.+))?", entry, re.S)
                if not m:
                    continue
                if m.group(2) is not None:
                    v = eval_const_expr(m.group(2), defines)
                    if v is None:
                        break
                    value = v
                else:
                    value += 1
                if m.group(1) not in defines:
                    defines[m.group(1)] = value
                    progress = True
    return defines


def c_ternary_to_py(expr):
    """Rewrite C `a ? b : c` chains (right-associative) as Python conditional expressions."""
    depth, q = 0, -1
    for i, ch in enumerate(expr):
        depth += ch in "(" and 1 or ch in ")" and -1 or 0
        if ch == "?" and depth == 0:
            q = i
            break
    if q < 0:
        return expr
    depth, nested = 0, 0
    for i in range(q + 1, len(expr)):
        ch = expr[i]
        depth += ch in "(" and 1 or ch in ")" and -1 or 0
        if depth == 0 and ch == "?":
            nested += 1
        elif depth == 0 and ch == ":":
            if nested == 0:
                cond, a, b = expr[:q], expr[q + 1 : i], expr[i + 1 :]
                return f"(({c_ternary_to_py(a)}) if ({cond}) else ({c_ternary_to_py(b)}))"
            nested -= 1
    raise ValueError(f"unbalanced ternary: {expr}")


def c_initializers(text, array):
    """`const T array[] = { [KEY] = {...}, ... };` -> {KEY: body text}. Bodies that are a macro name stay as-is."""
    m = re.search(rf"\b{array}\s*\[[^\]]*\](?:\[[^\]]*\])?\s*=\s*\{{", text)
    if not m:
        raise ValueError(f"array {array} not found")
    i, depth, start = m.end(), 1, m.end()
    while depth:
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        i += 1
    body = text[start : i - 1]
    out = {}
    for em in re.finditer(r"\[(\w+)\]\s*=\s*", body):
        j = em.end()
        if body[j] == "{":
            d, k = 1, j + 1
            while d:
                d += {"{": 1, "}": -1}.get(body[k], 0)
                k += 1
            out[em.group(1)] = body[j + 1 : k - 1]
        else:
            out[em.group(1)] = re.match(r"[^,\n]+", body[j:]).group(0).strip()
    return out


def c_struct_fields(body, known):
    """`.a = 1, .b = {X, Y}, .c = FLAG_A | FLAG_B` -> dict with constants resolved to numbers when possible."""
    fields = {}
    for m in re.finditer(r"\.(\w+)\s*=\s*(\{[^}]*\}|[^,]+)", body):
        raw = m.group(2).strip()
        if raw.startswith("{"):
            fields[m.group(1)] = [c_value(v.strip(), known) for v in raw[1:-1].split(",") if v.strip()]
        else:
            fields[m.group(1)] = c_value(raw, known)
    return fields


def c_value(raw, known):
    m = re.fullmatch(r"PERCENT_FEMALE\(([\d.]+)\)", raw)
    if m:  # min(254, ((percent * 255) / 100)), truncated into a u8
        return min(254, int(float(m.group(1)) * 255 / 100))
    m = re.fullmatch(r"_\(\"(.*)\"\)", raw)
    if m:
        return m.group(1)
    if raw in ("TRUE", "FALSE"):
        return int(raw == "TRUE")
    v = eval_const_expr(raw, known)
    return v if v is not None else raw


def c_string_table(text, array):
    """`[KEY] = _("TEXT"),` entries -> {KEY: "TEXT$"} (raw decomp strings, encoded at runtime)."""
    return {k: re.match(r'_\("(.*)"\)', v).group(1) + "$" for k, v in c_initializers(text, array).items() if v.startswith("_(")}


def dex_h_count(dex_h, name):
    return re.search(rf"#define {name}\s+(\w+)", dex_h).group(1)


def extract_pokemon(decomp, out):
    defines = parse_defines(decomp)
    for name, val in re.findall(r"^#define\s+(MOVE_TARGET_\w+)\s+\(?(0x[0-9A-Fa-f]+|\d+)\)?", (decomp / "include/battle.h").read_text(), re.M):
        defines.setdefault(name, int(val, 0))
    data_dir = decomp / "src/data"
    pd = out / "pokemon"
    (pd / "front").mkdir(parents=True, exist_ok=True)

    # gSpeciesInfo (+ macro bodies such as OLD_UNOWN_SPECIES_INFO)
    info_src = (data_dir / "pokemon/species_info.h").read_text()
    macros = {n: b.replace("\\\n", "\n") for n, b in re.findall(r"#define (\w+)\s+\\\n((?:.*\\\n)+.*)", info_src)}
    names = c_string_table((data_dir / "text/species_names.h").read_text(), "gSpeciesNames")
    learnset_src = (data_dir / "pokemon/level_up_learnsets.h").read_text()
    learnsets = {}
    for sym, body in re.findall(r"static const u16 (\w+)\[\] = \{(.*?)\};", learnset_src, re.S):
        learnsets[sym] = [[int(lv), defines[mv]] for lv, mv in re.findall(r"LEVEL_UP_MOVE\(\s*(\d+),\s*(\w+)\)", body)]
    learnset_ptrs = c_initializers((data_dir / "pokemon/level_up_learnset_pointers.h").read_text(), "gLevelUpLearnsets")
    num_species = defines["NUM_SPECIES"]
    species = [None] * num_species
    for key, body in c_initializers(info_src, "gSpeciesInfo").items():
        sid = defines.get(key)
        if sid is None or sid >= num_species:
            continue
        body = macros.get(body, body)
        fields = c_struct_fields(body.strip().strip("{}"), defines)
        fields["name"] = names.get(key, "??????????$")
        fields["learnset"] = learnsets.get(learnset_ptrs.get(key, ""), [])
        species[sid] = {"id": key, **fields}
    # National dex numbers (sSpeciesToNationalPokedexNum; NATIONAL_DEX_* is an enum in constants/pokedex.h).
    dex_h = (decomp / "include/constants/pokedex.h").read_text()
    enum_body = re.search(r"enum \{(.*?)\};", dex_h, re.S).group(1)
    national = {n: i for i, n in enumerate(re.findall(r"^\s*(NATIONAL_DEX_\w+)", enum_body, re.M))}
    pokemon_c = (decomp / "src/pokemon.c").read_text()
    for name in re.findall(r"^\s*SPECIES_TO_NATIONAL\((\w+)\),", pokemon_c, re.M):
        dex = national[f"NATIONAL_DEX_{name}"]
        sid = defines.get(f"SPECIES_{name}")
        if sid is not None and species[sid] is not None:
            species[sid]["nationalDex"] = dex
    for sid in range(num_species):
        if species[sid] is None:
            species[sid] = {"id": f"SPECIES_{sid}", "name": "??????????$", "learnset": []}

    # gBattleMoves + gMoveNames
    move_names = c_string_table((data_dir / "text/move_names.h").read_text(), "gMoveNames")
    moves = [None] * defines["MOVES_COUNT"]
    for key, body in c_initializers((data_dir / "battle_moves.h").read_text(), "gBattleMoves").items():
        mid = defines.get(key)
        if mid is not None and mid < len(moves):
            moves[mid] = {"id": key, "name": move_names.get(key, "-$"), **c_struct_fields(body, defines)}
    moves = [m or {"id": f"MOVE_{i}", "name": "-$"} for i, m in enumerate(moves)]

    # items.json is the decomp's own item table source (gItems is generated from it).
    items = []
    for it in json.loads((data_dir / "items.json").read_text())["items"]:
        items.append({
            "id": it["itemId"],
            "name": it["english"] + "$",
            "price": it["price"],
            "holdEffect": defines.get(it["holdEffect"], 0),
            "holdEffectParam": it["holdEffectParam"],
            "description": it["description_english"] + "$",
            "importance": it["importance"],
            "pocket": defines.get(it["pocket"], 0),
            "type": it["type"],
            "fieldUseFunc": it["fieldUseFunc"],
            "battleUsage": it["battleUsage"],
            "battleUseFunc": it["battleUseFunc"],
            "secondaryId": it["secondaryId"],
        })

    # gExperienceTables: evaluate the EXP_* macros exactly as written (all operands are non-negative,
    # so C integer division is Python floor division).
    exp_src = (data_dir / "pokemon/experience_tables.h").read_text()
    funcs = {"__builtins__": {}}  # macros see each other (CUBE, SQUARE) through the shared globals
    for name, param, body in re.findall(r"#define (\w+)\((\w+)\)\s*((?:.*\\\n)*.*)", exp_src):
        body = re.sub(r"//.*", "", body.replace("\\\n", " ")).replace("/", "//")
        funcs[name] = eval(f"lambda {param}: {c_ternary_to_py(body.strip())}", funcs)
    tables_src = exp_src[exp_src.index("gExperienceTables") :]
    exp_tables = []
    for block in re.findall(r"\{\s*//[^\n]*\n(.*?)\n\s*\}", tables_src, re.S):
        row = []
        for tok in re.findall(r"(\w+)\((\d+)\)|^\s*(\d+),", block, re.M):
            row.append(funcs[tok[0]](int(tok[1])) if tok[0] else int(tok[2]))
        exp_tables.append(row)

    nature_body = re.search(r"sNatureStatTable\[NUM_NATURES\]\[NUM_NATURE_STATS\] =\s*\{(.*?)\n\};", pokemon_c, re.S).group(1)
    nature_stats = [[int(v) for v in re.findall(r"[+-]?\d+", row)] for row in re.findall(r"=\s*\{([^}]*)\}", nature_body)]

    # gStdStringPtrs (bufferstdstring): index -> C string symbol (in strings.json)
    std_strings = [None] * 64
    for key, sym in c_initializers((decomp / "src/script_menu.c").read_text(), "gStdStringPtrs").items():
        std_strings[defines[key]] = sym
    std_strings = std_strings[: max(i for i, s in enumerate(std_strings) if s) + 1]

    tables = {
        "experience": exp_tables,
        "natureStats": nature_stats,
        "stdStrings": std_strings,
        "kantoDexCount": national[dex_h_count(dex_h, "KANTO_DEX_COUNT")],
        "nationalDexCount": national[dex_h_count(dex_h, "NATIONAL_DEX_COUNT")],
    }
    (pd / "species.json").write_text(json.dumps(species, ensure_ascii=False, separators=(",", ":")))
    (pd / "moves.json").write_text(json.dumps(moves, ensure_ascii=False, separators=(",", ":")))
    (pd / "items.json").write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")))
    (pd / "tables.json").write_text(json.dumps(tables, separators=(",", ":")))

    # Front pics (gMonFrontPicTable + gMonPaletteTable), 64x64 with colour 0 transparent.
    gfx_src = (data_dir / "graphics/pokemon.h").read_text() + (decomp / "src/graphics.c").read_text()
    gfx_paths = dict(re.findall(r"const u32 (\w+)\[\] = INCBIN_U32\(\"(.+?)\"\)", gfx_src))
    pics = dict(re.findall(r"SPECIES_SPRITE\((\w+),\s*(\w+)\)", (data_dir / "pokemon_graphics/front_pic_table.h").read_text()))
    pals = dict(re.findall(r"SPECIES_PAL\((\w+),\s*(\w+)\)", (data_dir / "pokemon_graphics/palette_table.h").read_text()))
    written = 0
    for name, pic_sym in pics.items():
        sid = defines.get(f"SPECIES_{name}")
        if sid is None or name not in pals or pic_sym not in gfx_paths:
            continue
        pic = decomp / re.sub(r"\.4bpp(\.lz)?$", ".png", gfx_paths[pic_sym])
        pal = decomp / re.sub(r"\.gbapal(\.lz)?$", ".pal", gfx_paths[pals[name]])
        if not pic.exists() or not pal.exists():
            print(f"  skip front pic {name}", file=sys.stderr)
            continue
        colors = read_jasc(pal)
        src = load_indexed(pic)
        px = src.load()
        dst = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        dp = dst.load()
        for y in range(64):
            for x in range(64):
                c = px[x, y] & 0xF
                if c:
                    dp[x, y] = colors[c] + (255,)
        dst.save(pd / "front" / f"{sid}.png", optimize=True)
        written += 1
    print(f"  {sum(1 for s in species if 'baseHP' in s)} species, {len(moves)} moves, {len(items)} items, {len(exp_tables)} exp tables, {written} front pics")


# ---------------------------------------------------------------- misc tables


def extract_constants(decomp, out):
    """Flags set at new game by EventScript_ResetAllMapFlags, so hidden NPCs start hidden."""
    src = (decomp / "data/event_scripts.s").read_text()
    m = re.search(r"EventScript_ResetAllMapFlags::(.*?)\n\s*(?:end|return)\b", src, re.S)
    flags = re.findall(r"setflag (FLAG_\w+)", m.group(1)) if m else []
    behaviors = dict(
        (name, int(val, 0)) for name, val in re.findall(r"#define (MB_\w+)\s+(0x[0-9A-Fa-f]+|\d+)", (decomp / "include/constants/metatile_behaviors.h").read_text())
    )
    (out / "constants.json").write_text(json.dumps({"newGameFlags": flags, "metatileBehaviors": behaviors}, indent=1))
    print(f"  {len(flags)} new-game flags, {len(behaviors)} behaviors")


def extract_wild_encounters(decomp, out):
    """gWildMonHeaders as wild_encounters.json.txt generates it for FIRERED, plus its ENCOUNTER_CHANCE_* defines.

    Headers keep the table's order: GetCurrentMapWildMonHeaderId offsets into consecutive Altering Cave entries.
    Species stay SPECIES_* names (resolved through the defines at runtime).
    """
    group = json.loads((decomp / "src/data/wild_encounters.json").read_text())["wild_encounter_groups"][0]
    fields = {}
    for f in group["fields"]:
        rates = f["encounter_rates"]
        if "groups" in f:
            # ENCOUNTER_CHANCE_<TYPE>_<ROD>_SLOT_<i>: running total over that rod's slots, as [slot, total] pairs
            fields[f["type"]] = {}
            for rod, slots in f["groups"].items():
                total, cum = 0, []
                for i in slots:
                    total += rates[i]
                    cum.append([i, total])
                fields[f["type"]][rod] = cum
        else:
            total, cum = 0, []
            for r in rates:
                total += r
                cum.append(total)
            fields[f["type"]] = cum
    headers = []
    for e in group["encounters"]:
        if "LeafGreen" in e["base_label"]:
            continue
        h = {"map": e["map"]}
        for kind in ("land_mons", "water_mons", "rock_smash_mons", "fishing_mons"):
            if kind in e:
                h[kind] = {
                    "encounterRate": e[kind]["encounter_rate"],
                    "mons": [[m["min_level"], m["max_level"], m["species"]] for m in e[kind]["mons"]],
                }
        headers.append(h)
    fieldmap_h = (decomp / "include/global.fieldmap.h").read_text()
    m = re.search(r"enum\s*\{\s*(TILE_ENCOUNTER_NONE[^}]*)\}", fieldmap_h)
    tile_encounter = {name.strip(): i for i, name in enumerate(n for n in m.group(1).split(",") if n.strip())}
    altering = int(re.search(r"#define NUM_ALTERING_CAVE_TABLES\s+(\d+)", (decomp / "include/wild_encounter.h").read_text()).group(1))
    # sUnownLetterSlots[chamber][slot]; chamber = mapNum - MAP_NUM(MAP_SEVEN_ISLAND_TANOBY_RUINS_MONEAN_CHAMBER)
    src = (decomp / "src/wild_encounter.c").read_text()
    body = re.search(r"sUnownLetterSlots\[\]\[LAND_WILD_COUNT\]\s*=\s*\{(.*?)\n\};", src, re.S).group(1)
    body = re.sub(r"//[^\n]*", "", body)
    unown_slots = [[int(n) for n in row.split(",") if n.strip()] for row in re.findall(r"\{([^}]*)\}", body)]
    groups = json.loads((decomp / "data/maps/map_groups.json").read_text())
    special = groups["gMapGroup_SpecialArea"]
    first = special.index("SevenIsland_TanobyRuins_MoneanChamber")
    chambers = []
    for name in special[first:first + len(unown_slots)]:
        chambers.append(json.loads((decomp / "data/maps" / name / "map.json").read_text())["id"])
    # roamer.c sRoamerLocations (all in ROAMER_MAP_GROUP); each set's trailing MAP_UNDEFINED padding is dropped
    # (RoamerMove rerolls those slots, so the set width is kept as roamerLocationsPerSet)
    # and field_specials.c sStarterSpecies (GetRoamerSpecies picks by the starter)
    roamer_src = (decomp / "src/roamer.c").read_text()
    body = re.search(r"sRoamerLocations\[\]\[\d+\]\s*=\s*\{(.*?)\n\};", roamer_src, re.S).group(1)
    roamer_sets = []
    for row in re.findall(r"\{([^}]*)\}", body):
        maps = re.findall(r"MAP_NUM\((MAP_\w+)\)", row)
        if maps:
            roamer_sets.append(maps)
    per_set = int(re.search(r"sRoamerLocations\[\]\[(\d+)\]", roamer_src).group(1))
    specials_src = (decomp / "src/field_specials.c").read_text()
    starters = re.findall(r"SPECIES_\w+", re.search(r"sStarterSpecies\[\]\s*=\s*\{(.*?)\};", specials_src, re.S).group(1))
    data = {
        "roamerLocations": roamer_sets,
        "roamerLocationsPerSet": per_set,
        "starterSpecies": starters,
        "chances": fields,
        "headers": headers,
        "tileEncounter": tile_encounter,
        "numAlteringCaveTables": altering,
        "unownLetterSlots": unown_slots,
        "tanobyChambers": chambers,
    }
    (out / "wild_encounters.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"  {len(headers)} wild encounter headers")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--decomp", default=DEFAULT_DECOMP)
    ap.add_argument("--out", default=str(ROOT / "public" / "gen"))
    args = ap.parse_args()
    decomp, out = Path(args.decomp), Path(args.out)
    if not (decomp / "data/maps").is_dir():
        sys.exit(f"Not a pret/firered checkout: {decomp}")
    out.mkdir(parents=True, exist_ok=True)
    print("constants")
    extract_constants(decomp, out)
    print("text")
    extract_text_assets(decomp, out)
    print("scripts")
    extract_scripts(decomp, out)
    print("sprites")
    extract_object_events(decomp, out)
    print("field effects")
    extract_field_effects(decomp, out)
    print("pokemon")
    extract_pokemon(decomp, out)
    print("wild encounters")
    extract_wild_encounters(decomp, out)
    print("battle")
    from extract_battle import extract_battle

    extract_battle(decomp, out)
    print("menus")
    from extract_menus import extract_menus

    extract_menus(decomp, out)
    print("gfx")
    from extract_gfx import extract_gfx
    extract_gfx(decomp, out)
    print("maps + tilesets")
    extract_maps(decomp, out, parse_tileset_symbols(decomp))
    print("field objects + doors")
    from extract_field import extract_doors, extract_field_effect_objects

    defines = parse_defines(decomp)
    extract_field_effect_objects(decomp, out, defines)
    extract_doors(decomp, out, defines)


if __name__ == "__main__":
    main()
