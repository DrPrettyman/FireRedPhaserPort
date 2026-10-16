"""Move/status/general/special battle animations for tools/extract.py (public/gen/battle/battle_anims.json):

- data/battle_anim_scripts.s assembled into a ROM image like the battle scripts. Sprite templates and task
  functions the scripts point at (createsprite / createvisualtask / createsoundtask) aren't in this image;
  each gets an address in EXTERN_BASE, listed in `externs` by name, so the TS port looks them up by C name.
- Every `struct SpriteTemplate` of the battle_anim_*.c files (fields by name; the C unit it's in, for its
  file-static anim tables), and the OamData structs of src/data/battle_anim.h.
- gBattleAnimPicTable / gBattleAnimPaletteTable (by ANIM_TAG) and gBattleAnimBackgroundTable (by BG_*).
"""
import base64
import json
import re
from pathlib import Path

from extract import eval_const_expr, macro_params, split_args, strip_comment
from extract_anims import ANIM_C_FILES, local_defines, split_top, translation_unit
from extract_battle import ROM_BASE, Assembler, c_array_body

# Sprite templates / task functions referenced from the scripts.
EXTERN_BASE = 0x0A000000
# The project follows REVISION 0 (see src/battle/main.ts).
REVISION = 0


SCRIPT_TABLES = ("gBattleAnims_Moves", "gBattleAnims_StatusConditions", "gBattleAnims_General", "gBattleAnims_Special", "gMovesWithQuietBGM")


class AnimAssembler(Assembler):
    """The battle script assembler plus what battle_anim_script.inc needs: `\\@`, `.L` local labels,
    `.if/.else/.endif`, `vararg` parameters, RGB(r, g, b), and pointers to C symbols (externs)."""

    def __init__(self, decomp, defines):
        super().__init__(defines, {}, {})
        self.sets["REVISION"] = REVISION
        # include/constants/rgb.h: RGB_* are RGB(...) expressions, which parse_defines leaves out
        for name, expr in re.findall(r"^#define\s+(RGB_\w+)\s+(.+)$", (decomp / "include/constants/rgb.h").read_text(), re.M):
            v = self.eval(expr)
            if v is not None:
                self.sets[name] = v
        self.counter = 0
        self.cond = []  # stack of (active, taken)
        self.externs = {}

    def load_macros(self, path):
        macros = {}
        text = path.read_text()
        for name, header, body in re.findall(r"^\s*\.macro\s+(\w+)([^\n]*)\n(.*?)^\s*\.endm", text, re.M | re.S):
            # `\@` (the macro invocation counter) would read as an `@` comment
            lines = [strip_comment(l.replace("\\@", "\\__COUNTER")).strip() for l in body.splitlines()]
            params = macro_params(header)
            vararg = [p.strip().split(":")[0] for p in split_args(header) if p.strip().endswith(":vararg")]
            macros[name] = (params, [l for l in lines if l], vararg[0] if vararg else None)
        return macros

    def active(self):
        return all(a for a, _ in self.cond)

    def condition(self, expr):
        expr = expr.strip()
        for op in ("==", "!=", ">=", "<=", ">", "<"):
            if op in expr:
                a, b = (self.eval(s) for s in expr.split(op, 1))
                if a is None or b is None:
                    raise ValueError(f"can't evaluate .if {expr}")
                return {"==": a == b, "!=": a != b, ">=": a >= b, "<=": a <= b, ">": a > b, "<": a < b}[op]
        v = self.eval(expr)
        if v is None:
            raise ValueError(f"can't evaluate .if {expr}")
        return v != 0

    def line(self, line, macros, ctx):
        op = line.split(None, 1)[0]
        rest = line[len(op):].strip()
        if op == ".if":
            ok = self.active() and self.condition(rest)
            self.cond.append((ok, ok))
            return
        if op == ".else":
            _, taken = self.cond.pop()
            self.cond.append((not taken and self.active(), True))
            return
        if op == ".endif":
            self.cond.pop()
            return
        if not self.active():
            return
        m = re.match(r"^(\.L[\w.]*|[A-Za-z_]\w*)\s*::?\s*(.*)$", line)
        if m:
            self.labels[m.group(1).replace(".L", "__L")] = self.size
            if m.group(2).strip():
                self.line(m.group(2).strip(), macros, ctx)
            return
        if op in macros:
            params, body, vararg = macros[op]
            args = split_args(rest)
            if vararg:
                n = len(params) - 1
                args = args[:n] + [", ".join(args[n:])]
            self.counter += 1
            order = sorted(range(len(params)), key=lambda i: -len(params[i][0]))
            for bl in body:
                bl = bl.replace("\\__COUNTER", str(self.counter))
                for i in order:
                    prm, default = params[i]
                    val = args[i] if i < len(args) and args[i] else default
                    bl = bl.replace("\\" + prm, val)
                if bl.split(None, 1)[0] in (".byte", ".2byte", ".4byte") and not bl.split(None, 1)[1:]:
                    continue  # `.2byte \argv` with no arguments
                self.line(bl, macros, ctx)
            return
        super().line(line, macros, ctx)

    def eval(self, expr):
        # RGB(r, g, b) from include/gba/defines.h
        expr = expr.replace(".L", "__L")  # local labels (the tokenizer has no `.` in names)
        expr = re.sub(r"\bRGB\(([^,()]+),([^,()]+),([^,()]+)\)", r"((\1) | ((\2) << 5) | ((\3) << 10))", expr)
        return super().eval(expr)

    def symbol(self, name):
        v = super().symbol(name)
        # Constants are upper case; anything else unresolved is a C symbol (sprite template, task function,
        # or a data pointer passed as two args, like gIceCrystalSpiralInwardLarge).
        if v is None and not re.fullmatch(r"[A-Z0-9_]+", name):
            if name not in self.externs:
                self.externs[name] = EXTERN_BASE + 4 * len(self.externs)
            v = self.externs[name]
        return v


def assemble_scripts(decomp, defines):
    asm = AnimAssembler(decomp, defines)
    macros = asm.load_macros(decomp / "asm/macros/battle_anim_script.inc")
    asm.assemble_file(decomp / "data/battle_anim_scripts.s", macros)
    rom = asm.link()
    externs = sorted(asm.externs, key=asm.externs.get)
    # Each pointer table runs up to the next label: {table: [script address, ...]}
    starts = sorted(set(asm.labels.values()))
    tables = {}
    for name in SCRIPT_TABLES[:-1]:
        start = asm.labels[name]
        end = next(a for a in starts if a > start)
        tables[name] = [int.from_bytes(rom[a : a + 4], "little") for a in range(start, end, 4)]
    return {
        "tables": tables,
        "romBase": ROM_BASE,
        "rom": base64.b64encode(bytes(rom)).decode(),
        "labels": {k: ROM_BASE + v for k, v in asm.labels.items() if not k.startswith("__L")},
        "externBase": EXTERN_BASE,
        "externs": externs,
    }


def c_struct_designated(body, known):
    """`.field = value, ...` -> {field: value}; values stay strings unless they evaluate to a number."""
    out = {}
    for e in split_top(body):
        m = re.fullmatch(r"\.(\w+)\s*=\s*(.+)", e.strip(), re.S)
        if not m:
            continue
        val = m.group(2).strip()
        val = re.sub(r"SPRITE_SHAPE\((\w+)\)", r"(SPRITE_SIZE_\1 & 3)", val)
        val = re.sub(r"SPRITE_SIZE\((\w+)\)", r"((SPRITE_SIZE_\1 >> 2) & 3)", val)
        num = eval_const_expr(val, known)
        out[m.group(1)] = num if num is not None else val.lstrip("&").strip()
    return out


def sprite_templates(decomp, defines):
    """Every SpriteTemplate and OamData of the anim C files (OamData also from src/data/battle_anim.h)."""
    templates, oams = {}, {}
    text = re.sub(r"//[^\n]*", "", (decomp / "src/data/battle_anim.h").read_text())
    units = [(None, text, defines)]
    for f in ANIM_C_FILES:
        text = translation_unit(decomp, "src/" + f)
        units.append((f, text, local_defines(text, defines)))
    for f, text, known in units:
        for name, body in re.findall(r"const\s+struct\s+OamData\s+(\w+)\s*=\s*\{(.*?)\};", text, re.S):
            oams.setdefault(name, {k: v for k, v in c_struct_designated(body, known).items() if isinstance(v, int)})
        if f is None:
            continue
        for name, body in re.findall(r"const\s+struct\s+SpriteTemplate\s+(\w+)\s*=\s*\{(.*?)\};", text, re.S):
            t = c_struct_designated(body, known)
            t["unit"] = f
            templates[name] = t
    return templates, oams


def pic_tables(decomp, defines):
    text = re.sub(r"//[^\n]*", "", (decomp / "src/data/battle_anim.h").read_text())
    start = defines["ANIM_SPRITES_START"]
    pics, pals = {}, {}
    for sym, size, tag in re.findall(r"\{\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\}", c_array_body(text, "gBattleAnimPicTable")):
        pics[eval_const_expr(tag, defines) - start] = {"symbol": sym, "size": int(size, 0), "tag": eval_const_expr(tag, defines)}
    for sym, tag in re.findall(r"\{\s*(\w+)\s*,\s*(\w+)\s*\}", c_array_body(text, "gBattleAnimPaletteTable")):
        pals[eval_const_expr(tag, defines) - start] = {"symbol": sym, "tag": eval_const_expr(tag, defines)}
    n = max(pics) + 1
    bgs = []
    for key, image, pal, tilemap in re.findall(r"\[(\w+)\]\s*=\s*\{\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\}", c_array_body(text, "gBattleAnimBackgroundTable")):
        idx = eval_const_expr(key, defines)
        bgs += [None] * (idx + 1 - len(bgs))
        bgs[idx] = {"image": image, "palette": pal, "tilemap": tilemap}
    return [pics.get(i) for i in range(n)], [pals.get(i) for i in range(n)], bgs


def extract_battle_anims(decomp, out, defines):
    scripts = assemble_scripts(decomp, defines)
    pics, pals, bgs = pic_tables(decomp, defines)
    templates, oams = sprite_templates(decomp, defines)
    data = {
        **scripts,
        "templates": templates,
        "oam": oams,
        "pics": pics,
        "palettes": pals,
        "backgrounds": bgs,
        "animSpritesStart": defines["ANIM_SPRITES_START"],
    }
    (out / "battle" / "battle_anims.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"  battle anims: {len(base64.b64decode(scripts['rom']))} bytes of script, {len(scripts['externs'])} externs, "
          f"{len(templates)} sprite templates")
