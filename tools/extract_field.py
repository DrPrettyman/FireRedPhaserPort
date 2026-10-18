"""Overworld field graphics that come with code tables: field effect sprites and door animations.

- field_effects/objects.json + field_effects/obj_<Name>.png: every gFieldEffectObjectTemplate_<Name>
  (src/data/field_effects/field_effect_objects.h) as a sprite sheet of its pic table's frames, drawn
  with the palette its paletteTag names, plus its frame size, anim table and callback name.
- doors.json: field_door.c's sDoorGraphics table and its DoorAnimFrame lists. The door tiles themselves
  are GBA-native graphics (extract_gfx: sDoorAnimTiles_*), drawn at runtime with the map's palettes.
- leagueLighting.json: field_specials.c's Elite Four / Champion room lighting palettes and timers.
"""

import json
import re

from PIL import Image

from extract import eval_const_expr, read_jasc
from extract_anims import split_top, translation_unit, unit_anims
from extract_gfx import GfxBuilder, incbin_symbols

TEMPLATE = re.compile(r"const struct SpriteTemplate (gFieldEffectObjectTemplate_\w+) =\s*\{(.*?)\};", re.S)
PIC_TABLE = re.compile(r"static const struct SpriteFrameImage (\w+)\[\] =\s*\{(.*?)\};", re.S)
SPRITE_PALETTE = re.compile(r"const struct SpritePalette \w+ = \{\s*\.data = (\w+),\s*\.tag = (\w+)\s*\}")
PLAYER_PALETTE = "gObjectEventPal_Player"  # palette slot 0 (PALSLOT_PLAYER), which TAG_NONE templates draw with


def anim_list(cmds):
    """extract_anims' command dicts -> compact [frame, duration, hFlip, vFlip] / ["end"] / ["jump", n] / ["loop", n]."""
    out = []
    for c in cmds:
        if c["type"] == -1:
            out.append(["end"])
        elif c["type"] == -2:
            out.append(["jump", c["target"]])
        elif c["type"] == -3:
            out.append(["loop", c["count"]])
        else:
            out.append([c["imageValue"], c["duration"], int(c["hFlip"]), int(c["vFlip"])])
    return out


def render_tiles(data, w_tiles, h_tiles, palette):
    """A sprite frame from 4bpp tile data in 1D mapping (tiles in raster order across the frame)."""
    img = Image.new("RGBA", (w_tiles * 8, h_tiles * 8), (0, 0, 0, 0))
    px = img.load()
    for t in range(w_tiles * h_tiles):
        tx, ty = (t % w_tiles) * 8, (t // w_tiles) * 8
        for y in range(8):
            for x in range(8):
                i = t * 32 + y * 4 + x // 2
                if i >= len(data):
                    continue
                c = (data[i] >> (4 * (x & 1))) & 0xF
                if c:
                    px[tx + x, ty + y] = tuple(palette[c]) + (255,)
    return img


def extract_field_effect_objects(decomp, out, defines):
    src = (decomp / "src/data/field_effects/field_effect_objects.h").read_text()
    builder = GfxBuilder(decomp)
    syms = incbin_symbols(decomp)
    unit = unit_anims(translation_unit(decomp, "src/event_object_movement.c"), defines)

    def build(sym):
        files = syms.get(sym)
        if not files:
            return None
        parts = [builder.build(re.sub(r"\.lz$", "", p)) for p in files]
        return None if any(p is None for p in parts) else b"".join(parts)

    def jasc(sym):
        files = syms.get(sym)
        return read_jasc(decomp / re.sub(r"\.gbapal$", ".pal", files[0])) if files else None

    palettes = {tag: sym for sym, tag in SPRITE_PALETTE.findall(src)}
    pic_tables = {}
    for name, body in PIC_TABLE.findall(src):
        frames = []
        for m in re.finditer(r"overworld_frame\((\w+),\s*(\d+),\s*(\d+),\s*(\d+)\)|obj_frame_tiles\((\w+)\)", body):
            frames.append((m.group(1), int(m.group(4))) if m.group(1) else (m.group(5), None))
        pic_tables[name] = frames

    fe = out / "field_effects"
    fe.mkdir(parents=True, exist_ok=True)
    for old in fe.glob("obj_*.png"):
        old.unlink()
    index = {}
    for name, body in TEMPLATE.findall(src):
        fields = dict(re.findall(r"\.(\w+)\s*=\s*&?(\w+)", body))
        short = name.replace("gFieldEffectObjectTemplate_", "")
        size = re.fullmatch(r"gObjectEventBaseOam_(\d+)x(\d+)", fields.get("oam", ""))
        frames = pic_tables.get(fields.get("images", ""))
        if not size or not frames:
            continue  # the sand disguise placeholder has no pic table
        fw, fh = int(size.group(1)), int(size.group(2))
        tag = fields.get("paletteTag", "TAG_NONE")
        pal = jasc(palettes[tag]) if tag in palettes else jasc(PLAYER_PALETTE)
        sheet = Image.new("RGBA", (fw * len(frames), fh), (0, 0, 0, 0))
        ok = True
        for i, (sym, frame) in enumerate(frames):
            data = build(sym)
            if data is None:
                ok = False
                break
            frame_size = fw * fh // 2
            # overworld_frame(ptr, w, h, n) points n frames into the pic; obj_frame_tiles is the whole pic.
            chunk = data[frame * frame_size : (frame + 1) * frame_size] if frame is not None else data[:frame_size]
            sheet.paste(render_tiles(chunk, fw // 8, fh // 8, pal), (i * fw, 0))
        if not ok:
            print(f"  field effect {short}: missing graphics")
            continue
        sheet.save(fe / f"obj_{short}.png", optimize=True)
        anims = [anim_list(unit["anims"][a]) if a in unit["anims"] else [] for a in unit["tables"].get(fields.get("anims", ""), [])]
        index[short] = {
            "frameWidth": fw,
            "frameHeight": fh,
            "frameCount": len(frames),
            "anims": anims,
            "callback": fields.get("callback"),
            "paletteTag": tag,
        }
    # CreateReflectionEffectSprites' affine anims, which drive OAM matrices 0 and 1 that water reflections
    # use: [xScale, yScale, rotation, duration] frames, ["jump", n] / ["end"] as in sprite.c.
    distortion = []
    for a in unit["affineTables"].get("sAffineAnims_ReflectionDistortion", []):
        cmds = []
        for c in unit["affineAnims"][a]:
            if c["type"] == 0x7FFE:
                cmds.append(["jump", c["target"]])
            elif c["type"] == 0x7FFF:
                cmds.append(["end"])
            else:
                cmds.append([c["xScale"], c["yScale"], c["rotation"], c["duration"]])
        distortion.append(cmds)
    # Object events' anim tables (object_event_anims.h, sAnimTable_*), for code that starts one of their anims
    # on an object's sprite itself (StartSpriteAnim: the player's fishing anims). Same command format.
    object_anims = {
        name: [anim_list(unit["anims"][a]) if a in unit["anims"] else [] for a in table]
        for name, table in unit["tables"].items()
        if name.startswith("sAnimTable_")
    }
    (fe / "objects.json").write_text(
        json.dumps({"templates": index, "reflectionDistortion": distortion, "objectEventAnims": object_anims}, separators=(",", ":"))
    )
    print(f"  {len(index)} field effect object templates")


def extract_doors(decomp, out, defines):
    src = (decomp / "src/field_door.c").read_text()
    local = dict(defines)
    for body in re.findall(r"\benum\s*\{(.*?)\}", src, re.S):
        for i, e in enumerate(split_top(body)):
            local[e.strip()] = i
    local["TILE_SIZE_4BPP"] = 32
    for name, expr in re.findall(r"^#define\s+(\w+)\s+(.+)$", src, re.M):
        v = eval_const_expr(expr.strip(), local)
        if v is not None:
            local[name] = v

    frames = {}
    for name, body in re.findall(r"static const struct DoorAnimFrame (\w+)\[\] = \{(.*?)\n\};", src, re.S):
        lst = []
        for entry in re.findall(r"\{([^}]*)\}", body):
            if not entry.strip():
                break  # the {} terminator
            duration, offset = (eval_const_expr(a.strip(), local) for a in entry.split(","))
            lst.append([duration, offset])
        frames[name.replace("sDoorAnimFrames_", "")] = lst
    pal_nums = {name: [int(n) for n in re.findall(r"\d+", body)]
                for name, body in re.findall(r"static const u8 (sDoorAnimPalettes_\w+)\[\] = \{(.*?)\};", src)}
    table = re.search(r"static const struct DoorGraphics sDoorGraphics\[\] = \{(.*?)\n\};", src, re.S).group(1)
    doors = []
    for entry in re.findall(r"^\s*\{(\w+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+)\}", table, re.M):
        metatile, sound, size, tiles, pals = entry
        mid = local.get(metatile)
        if mid is None:
            print(f"  doors: unknown metatile {metatile}")
            continue
        doors.append({"metatileId": mid, "metatile": metatile, "sound": local[sound], "size": local[size],
                      "tiles": tiles, "paletteNums": pal_nums[pals]})
    (out / "doors.json").write_text(json.dumps({
        "closedOffset": local["CLOSED_DOOR_TILES_OFFSET"],
        "frames": frames,
        "doors": doors,
    }, separators=(",", ":")))
    print(f"  {len(doors)} doors, {len(frames)} door anim frame lists")


def extract_league_lighting(decomp, out):
    """leagueLighting.json: field_specials.c's league lighting tables (DoPokemonLeagueLightingEffect).

    sEliteFourLightingPalettes / sChampionRoomLightingPalettes as JASC colours (the .pal files their .gbapal
    INCBINs are built from), the same colour space as tilesets/palettes.json, so the redrawn metatiles match
    the atlases; sEliteFourLightingTimers / sChampionRoomLightingTimers in frames.
    """
    src = (decomp / "src/field_specials.c").read_text()

    def palettes(array):
        body = re.search(rf"static const u16 {array}\[\]\[16\] = \{{(.*?)\n\}};", src, re.S).group(1)
        paths = re.findall(r'INCBIN_U16\("([^"]+)\.gbapal"\)', body)
        return [[c for rgb in read_jasc(decomp / f"{p}.pal") for c in rgb] for p in paths]

    def timers(array):
        body = re.search(rf"static const u8 {array}\[\] = \{{(.*?)\}};", src, re.S).group(1)
        return [int(n) for n in re.findall(r"\d+", body)]

    data = {
        "eliteFourPalettes": palettes("sEliteFourLightingPalettes"),
        "championRoomPalettes": palettes("sChampionRoomLightingPalettes"),
        "eliteFourTimers": timers("sEliteFourLightingTimers"),
        "championRoomTimers": timers("sChampionRoomLightingTimers"),
    }
    (out / "leagueLighting.json").write_text(json.dumps(data, separators=(",", ":")))
