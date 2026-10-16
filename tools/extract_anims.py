"""Sprite animation data per C translation unit: ANIMCMD / AFFINEANIMCMD arrays, the pointer
tables that list them, and the battle's pic tables (trainer front/back pics and palettes).

A translation unit is a .c file with its `#include "data/..."` headers inlined, because many
anim names are file-static and repeat across files (sAnim_GeneralFrame0 etc.).
"""

import json
import re
from pathlib import Path

from extract import eval_const_expr
from extract_gfx import firered_only

# Every battle anim source (their sprite templates point at these tables); extract_battle_anims imports it.
ANIM_C_FILES = sorted(
    [
        "battle_anim.c", "battle_anim_bug.c", "battle_anim_dark.c", "battle_anim_dragon.c", "battle_anim_effects_1.c",
        "battle_anim_effects_2.c", "battle_anim_effects_3.c", "battle_anim_electric.c", "battle_anim_fight.c",
        "battle_anim_fire.c", "battle_anim_flying.c", "battle_anim_ghost.c", "battle_anim_ground.c", "battle_anim_ice.c",
        "battle_anim_mon_movement.c", "battle_anim_mons.c", "battle_anim_normal.c", "battle_anim_poison.c",
        "battle_anim_psychic.c", "battle_anim_rock.c", "battle_anim_smokescreen.c", "battle_anim_sound_tasks.c",
        "battle_anim_special.c", "battle_anim_status_effects.c", "battle_anim_utility_funcs.c", "battle_anim_water.c",
    ]
)

ANIM_FILES = [
    "src/data.c",
    "src/pokemon.c",
    "src/pokeball.c",
    "src/battle_main.c",
    "src/battle_interface.c",
    "src/battle_gfx_sfx_util.c",
    "src/battle_bg.c",
    *(f"src/{f}" for f in ANIM_C_FILES),
    "src/battle_controllers.c",
    "src/battle_controller_player.c",
    "src/battle_controller_opponent.c",
    "src/battle_controller_oak_old_man.c",
    "src/party_menu.c",
    "src/item_menu_icons.c",
    "src/pokemon_icon.c",
    "src/menu_indicators.c",
    "src/pokemon_summary_screen.c",
    "src/mon_markings.c",
    "src/pokemon_storage_system_data.c",
    "src/pokemon_storage_system_graphics.c",
    "src/pokemon_storage_system_menu.c",
    "src/pokemon_storage_system_misc.c",
    "src/pokemon_storage_system_tasks.c",
    "src/event_object_movement.c",
]

ARRAY = re.compile(r"(?:static\s+)?const\s+union\s+(AnimCmd|AffineAnimCmd)\s+(\w+)\s*\[\s*\]\s*=\s*\{(.*?)\};", re.S)
PTR_PTR_TABLE = re.compile(r"(?:static\s+)?const\s+union\s+AnimCmd\s*\*\s*const\s*\*\s*const\s+(\w+)\s*\[[^\]]*\]\s*=\s*\{(.*?)\};", re.S)
PTR_TABLE = re.compile(r"(?:static\s+)?const\s+union\s+(AnimCmd|AffineAnimCmd)\s*\*\s*const\s+(\w+)\s*\[[^\]]*\]\s*=\s*\{(.*?)\};", re.S)


def translation_unit(decomp, rel):
    text = (decomp / rel).read_text(errors="replace")

    def inline(m):
        p = decomp / "src" / m.group(1)
        return p.read_text(errors="replace") if p.exists() else ""

    text = re.sub(r'#include\s+"(data/[^"]+)"', inline, text)
    text = re.sub(r"//[^\n]*", "", text)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return firered_only(text)


def split_top(body):
    """Split a C initializer body on top-level commas."""
    out, depth, cur = [], 0, ""
    for ch in body:
        if ch in "({":
            depth += 1
        elif ch in ")}":
            depth -= 1
        if ch == "," and depth == 0:
            if cur.strip():
                out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def macro_args(s):
    inner = s[s.index("(") + 1 : s.rindex(")")]
    return split_top(inner)


def anim_cmd(entry, defines):
    if entry.startswith("ANIMCMD_FRAME"):
        args = macro_args(entry)
        cmd = {"type": None, "hFlip": False, "vFlip": False}
        positional = ["imageValue", "duration", "hFlip", "vFlip"]
        for i, a in enumerate(args):
            m = re.fullmatch(r"\.(\w+)\s*=\s*(.+)", a)
            if m:
                key, val = m.group(1), m.group(2)
            else:
                key, val = positional[i], a
            v = eval_const_expr(val, defines)
            cmd[key] = bool(v) if key in ("hFlip", "vFlip") else v
        cmd["type"] = cmd["imageValue"]
        return cmd
    if entry.startswith("ANIMCMD_LOOP"):
        return {"type": -3, "count": eval_const_expr(macro_args(entry)[0], defines)}
    if entry.startswith("ANIMCMD_JUMP"):
        return {"type": -2, "target": eval_const_expr(macro_args(entry)[0], defines)}
    if entry.startswith("ANIMCMD_END"):
        return {"type": -1}
    raise ValueError(f"unknown anim cmd {entry}")


def affine_cmd(entry, defines):
    if entry.startswith("AFFINEANIMCMD_FRAME"):
        x, y, rot, dur = (eval_const_expr(a, defines) for a in macro_args(entry))
        return {"type": x, "xScale": x, "yScale": y, "rotation": rot, "duration": dur}
    if entry.startswith("AFFINEANIMCMD_LOOP"):
        return {"type": 0x7FFD, "count": eval_const_expr(macro_args(entry)[0], defines)}
    if entry.startswith("AFFINEANIMCMD_JUMP"):
        return {"type": 0x7FFE, "target": eval_const_expr(macro_args(entry)[0], defines)}
    if entry.startswith("AFFINEANIMCMD_END"):
        return {"type": 0x7FFF}
    raise ValueError(f"unknown affine anim cmd {entry}")


def pointer_table(body, defines):
    entries = []
    for e in split_top(body):
        m = re.fullmatch(r"\[(.+?)\]\s*=\s*(\w+)", e, re.S)
        if m:
            idx = eval_const_expr(m.group(1), defines)
            if idx is None:
                print(f"  anims: unknown table index {m.group(1)}")
                idx = len(entries)
            entries += [None] * (idx + 1 - len(entries))
            entries[idx] = m.group(2)
        else:
            entries.append(e)
    return entries


def local_defines(text, defines):
    """File-local enums and object-like #defines on top of the global ones."""
    local = dict(defines)
    for name, expr in re.findall(r"^#define\s+(\w+)\s+([^\n]+)$", text, re.M):
        v = eval_const_expr(expr.strip(), local)
        if v is not None:
            local[name] = v
    for body in re.findall(r"\benum\s*\w*\s*\{(.*?)\}", text, re.S):
        n = 0
        for e in split_top(body):
            m = re.fullmatch(r"(\w+)(?:\s*=\s*(.+))?", e.strip(), re.S)
            if not m:
                continue
            if m.group(2):
                v = eval_const_expr(m.group(2), local)
                if v is None:
                    continue
                n = v
            local[m.group(1)] = n
            n += 1
    return local


def unit_anims(text, defines):
    defines = local_defines(text, defines)
    anims, affine, tables, affine_tables = {}, {}, {}, {}
    for kind, name, body in ARRAY.findall(text):
        entries = split_top(body)
        try:
            if kind == "AnimCmd":
                anims[name] = [anim_cmd(e, defines) for e in entries]
            else:
                affine[name] = [affine_cmd(e, defines) for e in entries]
        except (ValueError, TypeError) as err:
            print(f"  anims: skipping {name}: {err}")
    for kind, name, body in PTR_TABLE.findall(text):
        (tables if kind == "AnimCmd" else affine_tables)[name] = pointer_table(body, defines)
    table_tables = {name: pointer_table(body, defines) for name, body in PTR_PTR_TABLE.findall(text)}
    return {"anims": anims, "affineAnims": affine, "tables": tables, "affineTables": affine_tables, "tableTables": table_tables}


def pic_table(text, name, macro, defines):
    """TRAINER_SPRITE(PIC, symbol, size) / TRAINER_PAL(PIC, symbol) style tables -> list by index."""
    body = text[text.index(name) :]
    body = body[body.index("{") + 1 : body.index("};")]
    out = []
    for args in re.findall(macro + r"\(([^)]*)\)", body):
        parts = [a.strip() for a in args.split(",")]
        idx = eval_const_expr("TRAINER_PIC_" + parts[0], defines)
        out += [None] * (idx + 1 - len(out))
        out[idx] = parts[1:]
    return out


def struct_list(text, name):
    """{ (cast)symbol, size, tag } entries of a CompressedSpriteSheet / SpritePalette table."""
    body = text[text.index(name) :]
    body = body[body.index("{") + 1 : body.index("};")]
    return [re.sub(r"\([^)]*\)", "", e).split(",")[0].strip() for e in re.findall(r"\{([^}]*)\}", body)]


def extract_anims(decomp, out, defines):
    units = {}
    for rel in ANIM_FILES:
        if (decomp / rel).exists():
            units[Path(rel).name] = unit_anims(translation_unit(decomp, rel), defines)
    data_c = translation_unit(decomp, "src/data.c")
    pics = {
        "trainerFrontPics": [e and {"pic": e[0], "size": eval_const_expr(e[1], defines)} for e in pic_table(data_c, "gTrainerFrontPicTable", "TRAINER_SPRITE", defines)],
        "trainerFrontPalettes": [e and e[0] for e in pic_table(data_c, "gTrainerFrontPicPaletteTable", "TRAINER_PAL", defines)],
        "trainerBackPics": struct_list(data_c, "gTrainerBackPicTable[]"),
        "trainerBackPalettes": struct_list(data_c, "gTrainerBackPicPaletteTable[]"),
    }
    # gMonFrontPicTable / gMonBackPicTable / gMonPaletteTable / gMonShinyPaletteTable by species id
    for key, name, macro in (("monFrontPics", "gMonFrontPicTable", "SPECIES_SPRITE"), ("monBackPics", "gMonBackPicTable", "SPECIES_SPRITE"),
                             ("monPalettes", "gMonPaletteTable", "SPECIES_PAL"), ("monShinyPalettes", "gMonShinyPaletteTable", "SPECIES_SHINY_PAL")):
        body = data_c[data_c.index(name):]
        body = body[body.index("{") + 1 : body.index("};")]
        table = []
        for sp, sym in re.findall(macro + r"\((\w+),\s*(\w+)\)", body):
            idx = eval_const_expr("SPECIES_" + sp, defines)
            if idx is None:
                continue
            table += [None] * (idx + 1 - len(table))
            table[idx] = sym
        pics[key] = table
    (out / "battle" / "anims.json").write_text(json.dumps({"units": units, **pics}, separators=(",", ":")))
    n = sum(len(u["anims"]) + len(u["affineAnims"]) for u in units.values())
    print(f"  {n} anim command arrays in {len(units)} files")
