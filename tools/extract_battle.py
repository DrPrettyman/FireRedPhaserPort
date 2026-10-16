"""Battle data for tools/extract.py: battle + AI scripts assembled into a ROM image, battle strings,
type chart, trainers, and battle graphics. Everything goes to public/gen/battle/."""
import base64
import json
import re
import struct
from pathlib import Path

from PIL import Image

from extract import (
    c_initializers,
    c_string_table,
    c_struct_fields,
    eval_const_expr,
    load_indexed,
    macro_params,
    parse_defines,
    read_jasc,
    split_args,
    strip_comment,
)

# Script pointers are ROM addresses (labels) or RAM addresses (the globals scripts read/write),
# like on the GBA. Each RAM symbol gets its own 0x400-byte slot; src/battle/ram.ts lays them out
# from the addresses written to scripts.json.
ROM_BASE = 0x08000000
RAM_BASE = 0x02000000
RAM_SLOT = 0x400
RAM_SYMBOLS = [
    "gBattleScripting", "gBattleCommunication", "gHitMarker", "gMoveResultFlags", "gBattlerTarget",
    "gBattlerAttacker", "gEffectBattler", "gBattlerFainted", "gBattleOutcome", "gBattleMoveDamage",
    "gHpDealt", "gBattlersCount", "gBattlerByTurnOrder", "gBattleTextBuff1", "gBattleTypeFlags",
    "gBattleWeather", "gChosenMove", "gCurrentMove", "gCritMultiplier", "gDynamicBasePower",
    "gLastUsedItem", "gNumSafariBalls", "gTrainerBattleOpponent_A",
]

# u16 STRINGID tables in battle_message.c that scripts and C code index (printfromtable).
STRING_ID_TABLE = re.compile(r"const u16 (g\w+(?:StringIds|Strings))\[[^\]]*\]\s*=\s*\{(.*?)\};", re.S)


class Assembler:
    """Just enough of GNU as for data/battle_scripts_*.s and data/battle_ai_scripts.s:
    macros (with defaults, nesting, whitespace-separated args), labels, .byte/.2byte/.4byte,
    .align, .space, .set. Expressions use C constants, labels (ROM addresses) and RAM symbols."""

    def __init__(self, defines, ram, symbolic):
        self.defines = defines
        self.ram = ram
        # #defines over RAM symbols (sB_ANIM_TURN = gBattleScripting + 0x18), substituted textually.
        self.symbolic = symbolic
        self.labels = {}
        self.items = []  # (offset, size, expr, context)
        self.size = 0
        self.sets = {"NULL": 0, "FALSE": 0, "TRUE": 1}

    def load_macros(self, path):
        macros = {}
        text = path.read_text()
        for name, header, body in re.findall(r"^\s*\.macro\s+(\w+)([^\n]*)\n(.*?)^\s*\.endm", text, re.M | re.S):
            lines = [strip_comment(l).strip() for l in body.splitlines()]
            macros[name] = (macro_params(header), [l for l in lines if l])
        return macros

    def assemble_file(self, path, macros):
        for raw in path.read_text(encoding="utf-8").splitlines():
            if raw.lstrip().startswith("#"):
                continue  # C preprocessor lines (constants come from parse_defines)
            line = strip_comment(raw).strip()
            if line:
                self.line(line, macros, path.name)

    def line(self, line, macros, ctx):
        m = re.match(r"^([A-Za-z_][\w.]*)::?\s*(.*)$", line)
        if m and not line.startswith("."):
            self.labels[m.group(1)] = self.size
            line = m.group(2).strip()
            if not line:
                return
        parts = line.split(None, 1)
        op, rest = parts[0], parts[1] if len(parts) > 1 else ""
        if op in (".byte", ".2byte", ".4byte", ".hword", ".word"):
            size = {".byte": 1, ".2byte": 2, ".hword": 2, ".4byte": 4, ".word": 4}[op]
            for a in split_args(rest):
                self.items.append((self.size, size, a, ctx))
                self.size += size
        elif op == ".align":
            n = 1 << int(rest.split(",")[0], 0)
            self.size = (self.size + n - 1) // n * n
        elif op == ".space":
            self.size += int(rest, 0)
        elif op in (".set", ".equ"):
            name, expr = [s.strip() for s in rest.split(",", 1)]
            v = self.eval(expr)
            if v is not None:
                self.sets[name] = v
        elif op in (".include", ".section", ".global", ".text", ".data"):
            pass
        elif op in macros:
            params, body = macros[op]
            args = split_args(rest)
            if len(args) < len(params) and args and re.match(r"^[\w.]+\s+[^\s|&<>+\-*/]", args[0]):
                # GNU as also separates macro arguments with whitespace: `setbyte sSTATCHANGER 1 | 2 << 4`
                first, second = args[0].split(None, 1)
                args = [first, second] + args[1:]
            order = sorted(range(len(params)), key=lambda i: -len(params[i][0]))
            for bl in body:
                for i in order:
                    prm, default = params[i]
                    val = args[i] if i < len(args) and args[i] else default
                    bl = bl.replace("\\" + prm, val)
                self.line(bl, macros, ctx)
        else:
            raise ValueError(f"{ctx}: unknown directive or macro: {line}")

    def symbol(self, name):
        if name in self.sets:
            return self.sets[name]
        if name in self.labels:
            return ROM_BASE + self.labels[name]
        if name in self.ram:
            return self.ram[name]
        return self.defines.get(name)

    def eval(self, expr):
        for _ in range(4):
            expr = re.sub(r"\b[A-Za-z_]\w*\b", lambda m: f"({self.symbolic[m.group(0)]})" if m.group(0) in self.symbolic else m.group(0), expr)
        known = {}
        for tok in set(re.findall(r"\b[A-Za-z_]\w*\b", expr)):
            v = self.symbol(tok)
            if v is None:
                return None
            known[tok] = v
        return eval_const_expr(expr, known)

    def link(self):
        rom = bytearray(self.size)
        missing = set()
        for off, size, expr, ctx in self.items:
            v = self.eval(expr) if expr else 0
            if v is None:
                missing.add(f"{ctx}: {expr}")
                v = 0
            struct.pack_into({1: "<B", 2: "<H", 4: "<I"}[size], rom, off, v & ((1 << (8 * size)) - 1))
        if missing:
            raise ValueError("unresolved expressions:\n  " + "\n  ".join(sorted(missing)[:40]))
        return rom


def c_strings(text):
    """`const u8 NAME[] = _("..." "...");` -> {NAME: raw string + '$'}"""
    out = {}
    for name, body in re.findall(r"(?:static )?const u8 (\w+)\[\]\s*=\s*_\((.*?)\);", text, re.S):
        parts = re.findall(r'"((?:\\.|[^"\\])*)"', body)
        out[name] = "".join(parts) + "$"
    return out


def item_effects(decomp, defines):
    """gItemEffectTable (src/data/pokemon/item_effects.h) -> {ITEM id: effect bytes}."""
    text = (decomp / "src/data/pokemon/item_effects.h").read_text()
    text = re.sub(r"/\*.*?\*/", "", re.sub(r"//[^\n]*", "", text), flags=re.S)
    # Expand the file's own #define macros (VITAMIN_FRIENDSHIP_CHANGE(i), STAT_BOOST_FRIENDSHIP_CHANGE).
    macros = {}
    for name, params, body in re.findall(r"#define (\w+)(?:\(([^)]*)\))?((?:[^\n]*\\\n)*[^\n]*)", text):
        macros[name] = ([p.strip() for p in params.split(",")] if params else None, body.replace("\\\n", " "))
    text = re.sub(r"#define (\w+)(?:\(([^)]*)\))?((?:[^\n]*\\\n)*[^\n]*)", "", text)
    for name, (params, body) in macros.items():
        if params is None:
            text = re.sub(rf"\b{name}\b", body, text)
        else:
            def expand(m, params=params, body=body):
                out = body
                for p, a in zip(params, m.group(1).split(",")):
                    out = re.sub(rf"\b{p}\b", a.strip(), out)
                return out
            text = re.sub(rf"\b{name}\(([^)]*)\)", expand, text)
    # ITEM6_HEAL_HP_FULL etc. are `((u8) -n)`
    known = dict(defines, ITEM6_HEAL_HP_FULL=0xFF, ITEM6_HEAL_HP_HALF=0xFE, ITEM6_HEAL_HP_LVL_UP=0xFD)
    defines = known
    arrays = {}
    for name, size, body in re.findall(r"static const u8 (\w+)\[(\w+)\]\s*=\s*\{(.*?)\};", text, re.S):
        out = [0] * eval_const_expr(size, defines)
        pos = 0
        for entry in [e.strip() for e in body.split(",") if e.strip()]:
            m = re.fullmatch(r"\[(.+?)\]\s*=\s*(.+)", entry, re.S)
            if m:
                pos = eval_const_expr(m.group(1), defines)
                entry = m.group(2)
            out[pos] = eval_const_expr(entry, defines) & 0xFF
            pos += 1
        arrays[name] = out
    table = {}
    for key, sym in re.findall(r"\[(\w+)\s*-\s*ITEM_POTION\]\s*=\s*(\w+)", c_array_body(text, "gItemEffectTable")):
        if sym in arrays:
            table[defines[key]] = arrays[sym]
    return table


def c_array_body(text, name):
    m = re.search(rf"\b{name}\s*\[[^\]]*\](?:\[[^\]]*\])*\s*=\s*\{{", text)
    if not m:
        raise ValueError(f"array {name} not found")
    i, depth = m.end(), 1
    while depth:
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        i += 1
    return text[m.end() : i - 1]


def c_flat_values(body, known):
    """Positional or `[KEY] = VALUE` entries of a flat array -> list of evaluated values."""
    body = re.sub(r"//[^\n]*", "", body)
    out = []
    for entry in [e.strip() for e in body.split(",")]:
        if not entry:
            continue
        m = re.fullmatch(r"\[(.+?)\]\s*=\s*(.+)", entry, re.S)
        if m:
            idx = eval_const_expr(m.group(1), known)
            while len(out) <= idx:
                out.append(0)
            out[idx] = eval_const_expr(m.group(2), known)
        else:
            out.append(eval_const_expr(entry, known))
    return out


# Numeric tables the battle code indexes, extracted rather than copied by hand: (file, symbol).
# 2D arrays come out flattened in C memory order.
MECHANICS_TABLES = [
    ("src/battle_main.c", "sPlayerThrowXTranslation"),
    ("src/battle_util.c", "sSoundMovesTable"),
    ("src/battle_script_commands.c", "sAccuracyStageRatios"),
    ("src/battle_script_commands.c", "sCriticalHitChance"),
    ("src/battle_script_commands.c", "sStatusFlagsForMoveEffects"),
    ("src/battle_script_commands.c", "sProtectSuccessRates"),
    ("src/battle_script_commands.c", "sMovesForbiddenToCopy"),
    ("src/battle_script_commands.c", "sFlailHpScaleToPowerTable"),
    ("src/battle_script_commands.c", "sNaturePowerMoves"),
    ("src/battle_script_commands.c", "sWeightToDamageTable"),
    ("src/battle_script_commands.c", "sPickupItems"),
    ("src/battle_script_commands.c", "sTerrainToType"),
    ("src/battle_script_commands.c", "sBallCatchBonuses"),
    ("src/pokemon.c", "sPokeblockFlavorCompatibilityTable"),
    ("src/pokemon.c", "sFriendshipEventDeltas"),
    ("src/pokemon.c", "sHoldEffectToType"),
    ("src/pokemon.c", "gPPUpGetMask"),
    ("src/pokemon.c", "gPPUpClearMask"),
    ("src/pokemon.c", "gPPUpAddValues"),
    ("src/pokemon.c", "sStatsToRaise"),
    ("src/battle_message.c", "gTrappingMoves"),
    ("src/overworld.c", "sWhiteOutMoneyLossMultipliers"),
    ("src/overworld.c", "sWhiteOutMoneyLossBadgeFlagIDs"),
    ("src/pokemon.c", "sHMMoves"),
]
# Tables of battle script pointers: (file, symbol) -> list of label names.
SCRIPT_POINTER_TABLES = [
    ("src/battle_script_commands.c", "sMoveEffectBS_Ptrs"),
]


def c_numeric_table(text, name, known):
    raw = re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", c_array_body(text, name), flags=re.S))
    known = {"USHRT_MAX": 0xFFFF, "UINT_MAX": 0xFFFFFFFF, **known}
    # File-local sentinels such as `#define SOUND_MOVES_END 0xFFFF`.
    for k, v in re.findall(r"^#define\s+(\w+)\s+(0x[0-9A-Fa-f]+|\d+)\s*$", text, re.M):
        known.setdefault(k, int(v, 0))
    rows = re.findall(r"\[([^\]]+)\]\s*=\s*\{([^}]*)\}", raw)
    if rows:  # designated 2D rows: [KEY] = { a, b, c }
        width = max(len([v for v in r.split(",") if v.strip()]) for _, r in rows)
        out = []
        for key, r in rows:
            idx = eval_const_expr(key, known)
            vals = [eval_const_expr(v, known) for v in r.split(",") if v.strip()]
            out += [0] * ((idx + 1) * width - len(out))
            out[idx * width : idx * width + len(vals)] = vals
        return out
    body = re.sub(r"[{}]", " ", raw)
    m = re.fullmatch(r"\s*PP_UP_SHIFTS(_INV)?\((\d+)\)\s*,?\s*", body)
    if m:  # gPPUpGetMask / gPPUpClearMask: the value shifted into each move slot (inverted for _INV)
        v = int(m.group(2))
        return [(v << (2 * i)) ^ (0xFF if m.group(1) else 0) for i in range(4)]
    return c_flat_values(body, known)


def c_label_table(text, name):
    out = []
    for entry in [e.strip() for e in re.sub(r"//[^\n]*", "", c_array_body(text, name)).split(",") if e.strip()]:
        m = re.fullmatch(r"\[(.+?)\]\s*=\s*(\w+)", entry, re.S)
        out.append((m.group(1), m.group(2)) if m else (None, entry))
    return out


def gfx_paths(decomp, *files):
    """INCBIN symbol -> source PNG/PAL path (the .4bpp/.gbapal are generated from these)."""
    paths = {}
    for f in files:
        for sym, p in re.findall(r"const u(?:8|16|32) (\w+)\[\] = INCBIN_U(?:8|16|32)\(\"(.+?)\"\)", (decomp / f).read_text()):
            p = re.sub(r"\.4bpp(\.lz)?$", ".png", p)
            p = re.sub(r"\.gbapal(\.lz)?$", ".pal", p)
            p = re.sub(r"\.bin(\.lz)?$", ".bin", p)
            paths[sym] = decomp / p
    return paths


def indexed_to_rgba(src, colors, transparent0=True):
    px = src.load()
    dst = Image.new("RGBA", src.size, (0, 0, 0, 0))
    dp = dst.load()
    for y in range(src.height):
        for x in range(src.width):
            c = px[x, y] & 0xF
            if c or not transparent0:
                dp[x, y] = tuple(colors[c]) + (255,)
    return dst


def png_palette(path):
    raw = Image.open(path).getpalette()[:48]
    return [tuple(raw[i : i + 3]) for i in range(0, 48, 3)]


def render_tilemap(tiles_img, tilemap, cols, rows, palettes, tile_overrides=None):
    """Draw a 4bpp text-mode BG: tilemap entries = tile | hflip << 10 | vflip << 11 | pal << 12.
    `palettes` maps palette number -> 16 colours; colour 0 of a tile is transparent."""
    tpx = tiles_img.load()
    tcols = tiles_img.width // 8
    out = Image.new("RGBA", (cols * 8, rows * 8), (0, 0, 0, 0))
    op = out.load()
    for i in range(cols * rows):
        entry = struct.unpack_from("<H", tilemap, i * 2)[0]
        tile, hflip, vflip, pal = entry & 0x3FF, entry >> 10 & 1, entry >> 11 & 1, entry >> 12
        src = tpx
        sx, sy = (tile % tcols) * 8, (tile // tcols) * 8
        if tile_overrides and tile in tile_overrides:
            src, sx, sy = tile_overrides[tile]
        elif sy >= tiles_img.height:
            continue
        colors = palettes.get(pal)
        if colors is None:
            continue
        # Tilemaps are stored as 32x32-entry screen blocks; wide BGs put blocks side by side.
        block, within = divmod(i, 1024)
        bx, by = (block % (cols // 32), block // (cols // 32)) if cols > 32 else (0, block)
        ox, oy = (bx * 32 + within % 32) * 8, (by * 32 + within // 32) * 8
        for y in range(8):
            for x in range(8):
                c = src[sx + x, sy + y] & 0xF
                if c:
                    op[ox + (7 - x if hflip else x), oy + (7 - y if vflip else y)] = tuple(colors[c]) + (255,)
    return out


def extract_battle(decomp, out):
    defines = parse_defines(decomp)
    bd = out / "battle"
    bd.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ scripts → ROM image
    ram = {name: RAM_BASE + i * RAM_SLOT for i, name in enumerate(RAM_SYMBOLS)}
    symbolic = {}
    for name, expr in re.findall(r"^#define\s+(\w+)\s+(.+?)\s*(?://.*)?$", (decomp / "include/constants/battle_script_commands.h").read_text(), re.M):
        if name not in defines:
            symbolic[name] = expr
    asm = Assembler(defines, ram, symbolic)
    battle_macros = asm.load_macros(decomp / "asm/macros/battle_script.inc")
    ai_macros = asm.load_macros(decomp / "asm/macros/battle_ai_script.inc")
    asm.assemble_file(decomp / "data/battle_scripts_1.s", battle_macros)
    asm.assemble_file(decomp / "data/battle_scripts_2.s", battle_macros)
    asm.assemble_file(decomp / "data/battle_ai_scripts.s", ai_macros)
    # STRINGID tables from battle_message.c, read by printfromtable and C code alike.
    msg_c = (decomp / "src/battle_message.c").read_text()
    string_tables = {}
    for name, body in STRING_ID_TABLE.findall(msg_c):
        values = c_flat_values(body, defines)
        string_tables[name] = values
        asm.size = (asm.size + 1) & ~1
        asm.labels[name] = asm.size
        for v in values:
            asm.items.append((asm.size, 2, str(v), name))
            asm.size += 2
    rom = asm.link()
    scripts = {
        "romBase": ROM_BASE,
        "rom": base64.b64encode(bytes(rom)).decode(),
        "labels": {k: ROM_BASE + v for k, v in asm.labels.items()},
        "ram": ram,
        "ramSlot": RAM_SLOT,
    }
    (bd / "scripts.json").write_text(json.dumps(scripts, separators=(",", ":")))

    # ------------------------------------------------------------ strings
    main_c_text = (decomp / "src/battle_main.c").read_text()
    strings = c_strings(msg_c)
    strings.update(c_strings(main_c_text))  # gStatusConditionString_*Jpn
    # gStatusConditionStringsTable: [Japanese status string, English replacement] pairs.
    status_strings = re.findall(r"\{(\w+),\s*(\w+)\}", c_array_body(main_c_text, "gStatusConditionStringsTable"))
    table_body = c_array_body(msg_c, "gBattleStringsTable")
    start = defines["BATTLESTRINGS_TABLE_START"]
    battle_strings = {}
    for key, sym in re.findall(r"\[(\w+)\s*-\s*BATTLESTRINGS_TABLE_START\]\s*=\s*(\w+)", table_body):
        battle_strings[defines[key]] = sym
    pointer_tables = {}
    for name in ("gStatNamesTable", "sStatNamesTable2", "sATypeMove_Table", "gPokeblockWasTooXStringTable"):
        body = re.sub(r"//[^\n]*", "", c_array_body(msg_c, name))
        entries = []
        for e in [x.strip() for x in body.split(",") if x.strip()]:
            m = re.fullmatch(r"\[(\w+)\]\s*=\s*(\w+)", e)
            if m:
                idx = defines[m.group(1)]
                entries += [None] * (idx + 1 - len(entries))
                entries[idx] = m.group(2)
            else:
                entries.append(e)
        pointer_tables[name] = entries
    grammar = c_flat_values(c_array_body(msg_c, "sGrammarMoveUsedTable"), defines)
    # Window text placement and colours (sTextOnWindowsInfo_Normal) — fields per B_WIN_*.
    windows = []
    for key, body in c_initializers(msg_c, "sTextOnWindowsInfo_Normal").items():
        idx = defines[key]
        windows += [None] * (idx + 1 - len(windows))
        # PIXEL_FILL(c) = c | c << 4 (window.h)
        body = re.sub(r"PIXEL_FILL\((\w+)\)", lambda m: str(int(m.group(1), 0) * 0x11), body)
        windows[idx] = c_struct_fields(body, defines)
    # Other battle UI strings live in src/strings.c, already in text/strings.json.
    misc_names = (decomp / "src/data/text/abilities.h").read_text()
    data = {
        "strings": strings,
        "battleStrings": battle_strings,
        "battleStringsStart": start,
        "stringIdTables": string_tables,
        "pointerTables": pointer_tables,
        "grammarMoveUsed": grammar,
        "statusConditionStrings": [list(p) for p in status_strings],
        "textOnWindows": windows,
        "abilityNames": c_list_of_strings(misc_names, "gAbilityNames", defines),
        "typeNames": c_list_of_strings((decomp / "src/battle_main.c").read_text(), "gTypeNames", defines),
        "trainerClassNames": c_list_of_strings((decomp / "src/data/text/trainer_class_names.h").read_text(), "gTrainerClassNames", defines),
    }
    (bd / "strings.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))

    # ------------------------------------------------------------ tables + trainers
    main_c = (decomp / "src/battle_main.c").read_text()
    type_chart = c_flat_values(c_array_body(main_c, "gTypeEffectiveness"), defines)
    money = [[eval_const_expr(a, defines), int(b)] for a, b in re.findall(r"\{(\w+),\s*(\d+)\}", c_array_body(main_c, "gTrainerMoneyTable"))]
    pokemon_c = (decomp / "src/pokemon.c").read_text()
    stat_ratios = [[int(a), int(b)] for a, b in re.findall(r"\{(\d+),\s*(\d+)\}", c_array_body(pokemon_c, "gStatStageRatios"))]
    trainers = extract_trainers(decomp, defines)
    coords = {
        "monFront": mon_coords(decomp / "src/data/pokemon_graphics/front_pic_coordinates.h", "gMonFrontPicCoords", defines),
        "monBack": mon_coords(decomp / "src/data/pokemon_graphics/back_pic_coordinates.h", "gMonBackPicCoords", defines),
        "trainerFront": mon_coords(decomp / "src/data/trainer_graphics/front_pic_tables.h", "gTrainerFrontPicCoords", defines),
        "trainerBack": mon_coords(decomp / "src/data/trainer_graphics/back_pic_tables.h", "gTrainerBackPicCoords", defines),
        "enemyElevation": c_flat_values(c_array_body((decomp / "src/data/pokemon_graphics/enemy_mon_elevation.h").read_text(), "gEnemyMonElevation"), defines),
    }
    sources = {}
    mech = {}
    for f, name in MECHANICS_TABLES:
        text = sources.setdefault(f, (decomp / f).read_text())
        mech[name] = c_numeric_table(text, name, defines)
    for f, name in SCRIPT_POINTER_TABLES:
        text = sources.setdefault(f, (decomp / f).read_text())
        labels = []
        for key, label in c_label_table(text, name):
            idx = len(labels) if key is None else eval_const_expr(key, defines)
            labels += [None] * (idx + 1 - len(labels))
            labels[idx] = label
        mech[name] = labels
    # gPokedexEntries height/weight by national dex number (GetPokedexHeightWeight, Low Kick).
    dex_hw = []
    for key, body in c_initializers((decomp / "src/data/pokemon/pokedex_entries.h").read_text(), "gPokedexEntries").items():
        idx = defines.get(key)
        if idx is None:
            continue
        f = dict(re.findall(r"\.(height|weight)\s*=\s*(\d+)", body))
        dex_hw += [None] * (idx + 1 - len(dex_hw))
        dex_hw[idx] = [int(f.get("height", 0)), int(f.get("weight", 0))]
    mech["pokedexHeightWeight"] = dex_hw
    mech["itemEffects"] = item_effects(decomp, defines)
    # trig.c: gSineTable (Q8.8) and gSineDegreeTable (Q4.12)
    trig_c = (decomp / "src/trig.c").read_text()
    for name, macro, scale in (("gSineTable", "Q_8_8", 256), ("gSineDegreeTable", "Q_4_12", 4096)):
        body = re.sub(r"//[^\n]*", "", c_array_body(trig_c, name))
        mech[name] = [int(float(v) * scale) for v in re.findall(macro + r"\(\s*(-?[\d.]+)\s*\)", body)]
    tables = {"typeEffectiveness": type_chart, "trainerMoney": money, "statStageRatios": stat_ratios, "trainers": trainers, "coords": coords, "mech": mech}
    (bd / "tables.json").write_text(json.dumps(tables, ensure_ascii=False, separators=(",", ":")))
    from extract_anims import extract_anims

    extract_anims(decomp, out, defines)
    from extract_battle_anims import extract_battle_anims

    extract_battle_anims(decomp, out, defines)

    # ------------------------------------------------------------ graphics
    n_gfx = extract_battle_graphics(decomp, bd, defines)
    print(f"  {len(rom)} bytes of battle/AI script, {len(asm.labels)} labels, {len(battle_strings)} battle strings, "
          f"{len(trainers)} trainers, {n_gfx} images")


def c_list_of_strings(text, name, defines):
    """`[KEY] = _("TEXT")` (or positional) entries -> list indexed by KEY's value."""
    out = []
    for key, val in c_string_table(text, name).items():
        idx = defines.get(key)
        if idx is None:
            continue
        out += [None] * (idx + 1 - len(out))
        out[idx] = val
    if not out:  # positional entries
        out = [s + "$" for s in re.findall(r'_\("(.*?)"\)', c_array_body(text, name))]
    return out


def mon_coords(path, name, defines):
    """struct MonCoords tables -> [[size, y_offset], ...] (MON_COORDS_SIZE evaluated)."""
    text = path.read_text()
    body = c_array_body(text, name)

    def size(expr):
        m = re.fullmatch(r"MON_COORDS_SIZE\((\d+),\s*(\d+)\)", expr.strip())
        if m:
            w, h = int(m.group(1)), int(m.group(2))
            return ((w + 7) // 8) << 4 | ((h + 7) // 8)
        return eval_const_expr(expr, defines)

    out = []
    keyed = re.findall(r"\[(\w+)\]\s*=\s*\{(.*?)\}", body, re.S)
    entries = keyed if keyed else [(None, b) for b in re.findall(r"\{(.*?)\}", body, re.S)]
    for key, fields in entries:
        f = dict(re.findall(r"\.(\w+)\s*=\s*(\w+\([^)]*\)|[^,}]+)", fields))
        val = [size(f["size"]), eval_const_expr(f["y_offset"], defines)]
        if key is None:
            out.append(val)
        else:
            idx = defines[key]
            out += [None] * (idx + 1 - len(out))
            out[idx] = val
    return out


def extract_trainers(decomp, defines):
    parties_src = (decomp / "src/data/trainer_parties.h").read_text()
    parties = {}
    # Each definition runs to the next one: one-liners like `sParty_EliteFourDrake[] = {DUMMY_TRAINER_MON};`
    # have no "\n};", so a lazy match up to that would swallow the following party.
    for name, body in re.findall(r"static const struct TrainerMon\w+ (\w+)\[\] = \{(.*?)\};\s*(?=static const|//|\Z)", parties_src, re.S):
        mons = []
        for mon in re.findall(r"\{\s*(\..*?)\}\s*,?\s*(?=\{|$)", body.strip() + "\n", re.S):
            mons.append(c_struct_fields(mon, defines))
        parties[name] = mons
    src = (decomp / "src/data/trainers.h").read_text()
    trainers = []
    for key, body in c_initializers(src, "gTrainers").items():
        idx = defines.get(key)
        if idx is None:
            continue
        party = re.search(r"\.party\s*=\s*(\w+)\((\w+)\)", body)
        fields = c_struct_fields(re.sub(r"\.party\s*=\s*\w+\(\w+\),?", "", body), defines)
        flags = {"NO_ITEM_DEFAULT_MOVES": 0, "NO_ITEM_CUSTOM_MOVES": 1, "ITEM_DEFAULT_MOVES": 2, "ITEM_CUSTOM_MOVES": 3}
        t = {
            "id": key,
            "trainerClass": fields.get("trainerClass", 0),
            "encounterMusicGender": fields.get("encounterMusic_gender", 0),
            "trainerPic": fields.get("trainerPic", 0),
            "trainerName": fields.get("trainerName", "") + "$" if isinstance(fields.get("trainerName"), str) else "$",
            "items": [i for i in fields.get("items", []) if isinstance(i, int)],
            "doubleBattle": fields.get("doubleBattle", 0),
            "aiFlags": fields.get("aiFlags", 0),
            # partyFlags: F_TRAINER_PARTY_CUSTOM_MOVESET (1) | F_TRAINER_PARTY_HELD_ITEM (2)
            "partyFlags": flags[party.group(1)] if party else 0,
            "party": parties.get(party.group(2), []) if party else [],
        }
        trainers += [None] * (idx + 1 - len(trainers))
        trainers[idx] = t
    return trainers


def extract_battle_graphics(decomp, bd, defines):
    count = 0
    paths = gfx_paths(decomp, "src/data/graphics/pokemon.h", "src/data/graphics/trainers.h", "src/graphics.c")

    # Mon back pics (normal palette), like the front pics in pokemon/front/.
    (bd / "mon_back").mkdir(exist_ok=True)
    backs = dict(re.findall(r"SPECIES_SPRITE\((\w+),\s*(\w+)\)", (decomp / "src/data/pokemon_graphics/back_pic_table.h").read_text()))
    pals = dict(re.findall(r"SPECIES_PAL\((\w+),\s*(\w+)\)", (decomp / "src/data/pokemon_graphics/palette_table.h").read_text()))
    for name, sym in backs.items():
        sid = defines.get(f"SPECIES_{name}")
        pic, pal = paths.get(sym), paths.get(pals.get(name, ""))
        if sid is None or not pic or not pal or not pic.exists() or not pal.exists():
            continue
        img = indexed_to_rgba(load_indexed(pic), read_jasc(pal))
        img.crop((0, 0, 64, 64)).save(bd / "mon_back" / f"{sid}.png", optimize=True)
        count += 1

    # Trainer front pics + back pic sheets.
    (bd / "trainer_front").mkdir(exist_ok=True)
    (bd / "trainer_back").mkdir(exist_ok=True)
    tables = (decomp / "src/data/trainer_graphics/front_pic_tables.h").read_text()
    fronts = dict(re.findall(r"TRAINER_SPRITE\((\w+),\s*(\w+),", tables))
    fpals = dict(re.findall(r"TRAINER_PAL\((\w+),\s*(\w+)\)", tables))
    for name, sym in fronts.items():
        tid = defines.get(f"TRAINER_PIC_{name}")
        pic, pal = paths.get(sym), paths.get(fpals.get(name, ""))
        if tid is None or not pic or not pal or not pic.exists() or not pal.exists():
            continue
        indexed_to_rgba(load_indexed(pic), read_jasc(pal)).save(bd / "trainer_front" / f"{tid}.png", optimize=True)
        count += 1
    back_src = (decomp / "src/data/trainer_graphics/back_pic_tables.h").read_text()
    back_pics = re.findall(r"\{\s*\(const u32 \*\)(\w+),", c_array_body(back_src, "gTrainerBackPicTable"))
    back_pals = re.findall(r"\{\s*(\w+),", c_array_body(back_src, "gTrainerBackPicPaletteTable"))
    for i, (sym, psym) in enumerate(zip(back_pics, back_pals)):
        pic, pal = paths.get(sym), paths.get(psym)
        if pic and pal and pic.exists() and pal.exists():
            indexed_to_rgba(load_indexed(pic), read_jasc(pal)).save(bd / "trainer_back" / f"{i}.png", optimize=True)
            count += 1

    # Battle terrains: BG3 (512x256 text BG, palettes loaded at BG_PLTT_ID(2)), one image per terrain id
    # (sBattleTerrainTable in battle_bg.c, incl. the indoor palette variants).
    bg_c = (decomp / "src/battle_bg.c").read_text()
    bg_syms = gfx_paths(decomp, "src/battle_bg.c")
    (bd / "terrain").mkdir(exist_ok=True)
    for key, body in c_initializers(bg_c, "sBattleTerrainTable").items():
        tid = defines.get(key)
        f = dict(re.findall(r"\.(\w+)\s*=\s*(\w+)", body))
        tiles, tmap, pal = bg_syms.get(f.get("tileset")), bg_syms.get(f.get("tilemap")), bg_syms.get(f.get("palette"))
        if tid is None or not tiles or not tmap or not pal:
            continue
        colors = read_jasc(pal)
        palettes = {2 + i: colors[i * 16 : i * 16 + 16] for i in range(len(colors) // 16)}
        img = render_tilemap(load_indexed(tiles), tmap.read_bytes(), 64, 32, palettes)
        img.crop((0, 0, 256, 160)).save(bd / "terrain" / f"{tid}.png", optimize=True)
        count += 1

    # BG0 text box (32x64 tiles: message box, action menu, move menu stacked vertically). Palette 0 is
    # textbox1; tiles 0x12.. and palette 1 are replaced by the user window frame (LoadBattleMenuWindowGfx
    # → LoadUserWindowGfx(2, 0x012, BG_PLTT_ID(1))), frame type 1 as on a new save.
    bi = decomp / "graphics/battle_interface"
    frame_png = decomp / "graphics/text_window/type1.png"
    frame = load_indexed(frame_png)
    fpx = frame.load()
    fcols = frame.width // 8
    overrides = {0x12 + i: (fpx, (i % fcols) * 8, (i // fcols) * 8) for i in range(fcols * (frame.height // 8))}
    textbox = render_tilemap(load_indexed(bi / "textbox.png"), (bi / "textbox.bin").read_bytes(), 32, 64,
                             {0: read_jasc(bi / "textbox1.pal"), 1: png_palette(frame_png)}, overrides)
    textbox.save(bd / "textbox.png", optimize=True)
    count += 1

    # Healthbox sprites and elements with their palettes (healthbox.pal / healthbar.pal).
    hb_pal = read_jasc(bi / "healthbox.pal")
    bar_pal = read_jasc(bi / "healthbar.pal")
    for name in ("healthbox_singles_player", "healthbox_singles_opponent", "healthbox_safari", "party_summary_bar", "enemy_mon_shadow"):
        indexed_to_rgba(load_indexed(bi / f"{name}.png"), hb_pal).save(bd / f"{name}.png", optimize=True)
        count += 1
    for name in ("healthbox_elements",):
        indexed_to_rgba(load_indexed(bi / f"{name}.png"), bar_pal).save(bd / f"{name}.png", optimize=True)
        count += 1
    palettes = {
        "textbox": read_jasc(bi / "textbox1.pal"),
        "healthbox": hb_pal,
        "healthbar": bar_pal,
    }
    (bd / "palettes.json").write_text(json.dumps(palettes, separators=(",", ":")))
    return count
