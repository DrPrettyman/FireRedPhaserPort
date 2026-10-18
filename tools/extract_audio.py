"""Songs for the m4a engine (public/gen/audio/songs.json), built the way the ROM's are.

1. Build the decomp's own `tools/mid2agb` (C++) with the system compiler into tools/.bin/ (gitignored), straight
   from the decomp's sources so nothing is written into the decomp's tree. Rebuilt only when a source is newer.
2. Run it on every song in `sound/songs/midi/midi.cfg` with that line's flags (audio_rules.mk's MID_RULE:
   `mid2agb <song>.mid <song>.s <flags>`), into a temporary directory that is deleted afterwards.
3. Assemble each `.s` with a small assembler for the subset mid2agb writes (labels, .byte, .word, .equ / .set,
   expressions over sound/MPlayDef.s's symbols, .include, .global / .section / .align), in place of
   arm-none-eabi-as.
4. Join with sound/song_table.inc (gSongTable: `song label, ms, me`) and sound/music_player_table.inc
   (gMPlayTable).

songs.json:
  players: [{name, tracks}]  gMPlayTable in order (MusicPlayer.info name, track count)
  songs:   [{id, name, ms, me, priority, reverb, blockCount, voicegroup, tracks, data}]  index = song id.
           The SongHeader's bytes (trackCount = len(tracks)); voicegroup is the header's symbol name; tracks are
           byte offsets into data; data is base64 of the song's track bytes (everything mid2agb puts before the
           header), with every pointer in it (GOTO / PATT targets) relocated to a little-endian u32 byte offset
           into the same data.
"""

import base64
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN_DIR = ROOT / "tools" / ".bin"

# mid2agb's Makefile, used when its CXXFLAGS / SRCS lines can't be read.
MID2AGB_FLAGS = ["-std=c++11", "-O2", "-Wall", "-Wno-switch"]
MID2AGB_SRCS = ["agb.cpp", "error.cpp", "main.cpp", "midi.cpp", "tables.cpp"]


class AsmError(Exception):
    pass


# --- mid2agb ------------------------------------------------------------------------------------------------


def makefile_var(text, name):
    m = re.search(rf"^{name}\s*:?=\s*(.*)$", text, re.M)
    return m[1].split() if m else None


def build_mid2agb(decomp):
    """Build tools/mid2agb from the decomp's sources (its Makefile's flags minus -Werror) -> the binary's path."""
    src = decomp / "tools" / "mid2agb"
    makefile = (src / "Makefile").read_text()
    flags = [f for f in (makefile_var(makefile, "CXXFLAGS") or MID2AGB_FLAGS) if f != "-Werror"]
    srcs = makefile_var(makefile, "SRCS") or MID2AGB_SRCS
    deps = [src / s for s in srcs + (makefile_var(makefile, "HEADERS") or [])] + [src / "Makefile"]
    exe = BIN_DIR / ("mid2agb.exe" if os.name == "nt" else "mid2agb")
    if exe.exists() and all(d.stat().st_mtime <= exe.stat().st_mtime for d in deps if d.exists()):
        return exe

    cxx = shlex.split(os.environ.get("CXX") or "c++")
    if not cxx or not shutil.which(cxx[0]):
        sys.exit(
            f"extract_audio: no C++ compiler found ({' '.join(cxx) or 'c++'}). The songs are converted with the\n"
            "decomp's own mid2agb, which npm run extract builds. Install one: `xcode-select --install` on macOS,\n"
            "`g++` (e.g. `apt install build-essential`) on Linux; or set CXX= to the compiler to use."
        )
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    tmp = exe.with_name(exe.name + ".tmp")
    cmd = cxx + flags + [str(src / s) for s in srcs] + ["-o", str(tmp)]
    print(f"  building mid2agb ({' '.join(cxx)})")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not tmp.exists():
        sys.exit(
            f"extract_audio: building mid2agb failed:\n  {' '.join(cmd)}\n{(r.stdout + r.stderr)[-3000:]}\n"
            "Set CXX= to choose another C++ compiler."
        )
    tmp.replace(exe)
    return exe


def midi_cfg(decomp):
    """midi.cfg -> [(song name, [flags])] for the lines whose .mid exists, and the count of the others."""
    midi = decomp / "sound" / "songs" / "midi"
    songs, missing = [], 0
    for line in (midi / "midi.cfg").read_text().splitlines():
        if not line.strip():
            continue
        m = re.match(r"(\S+)\.mid:\s*(.*)$", line)
        if not m:
            raise ValueError(f"midi.cfg: unexpected line {line!r}")
        if (midi / f"{m[1]}.mid").exists():
            songs.append((m[1], m[2].split()))
        else:
            missing += 1  # ph_* / se_card*: listed but never built
    return songs, missing


def run_mid2agb(exe, decomp, songs, outdir):
    """mid2agb <song>.mid <outdir>/<song>.s <flags> for every song, in parallel (MID_RULE)."""
    midi = decomp / "sound" / "songs" / "midi"

    def one(song):
        name, flags = song
        r = subprocess.run(
            [str(exe), str(midi / f"{name}.mid"), str(outdir / f"{name}.s"), *flags], capture_output=True, text=True
        )
        if r.returncode != 0:
            raise RuntimeError(f"mid2agb failed on {name}.mid: {(r.stdout + r.stderr).strip()}")

    with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as pool:
        list(pool.map(one, songs))


# --- the assembler ------------------------------------------------------------------------------------------

INCLUDE = re.compile(r'\.include\s+"([^"]+)"$')
LABEL = re.compile(r"([A-Za-z_.$][\w.$]*)::?(?:\s+|$)")
STATEMENT = re.compile(r"(\.?\w+)\s*(.*)$")
TOKEN = re.compile(r"\s*(?:(0[xX][0-9a-fA-F]+|0[bB][01]+|\d+)|([A-Za-z_.$][\w.$]*)|(<<|>>|&&|\|\||[-+*/%&|^~!()]))")

# GNU as precedence (as.info "Infix Operators"), higher binds tighter.
BINARY = {
    "*": 4, "/": 4, "%": 4, "<<": 4, ">>": 4,
    "|": 3, "&": 3, "^": 3,
    "+": 2, "-": 2,
    "&&": 1, "||": 1,
}


def tokenize(expr):
    out, pos = [], 0
    expr = expr.strip()
    while pos < len(expr):
        m = TOKEN.match(expr, pos)
        if not m or m.end() == pos:
            raise AsmError(f"bad expression {expr!r}")
        pos = m.end()
        if m[1]:
            out.append(("num", int(m[1], 0)))
        elif m[2]:
            out.append(("sym", m[2]))
        else:
            out.append(("op", m[3]))
    return out


class Value:
    """An assembler value: an integer, plus at most one symbol it is relative to (a label or an undefined one)."""

    __slots__ = ("n", "sym")

    def __init__(self, n, sym=None):
        self.n, self.sym = n, sym

    def int(self, what):
        if self.sym is not None:
            raise AsmError(f"{what}: {self.sym} is not a constant")
        return self.n


def c_div(a, b):
    if b == 0:
        raise AsmError("division by zero")
    q = abs(a) // abs(b)
    return q if (a >= 0) == (b >= 0) else -q


def c_mod(a, b):
    return a - b * c_div(a, b)


def binop(op, a, b):
    if op == "+":
        if a.sym is not None and b.sym is not None:
            raise AsmError("adding two symbols")
        return Value(a.n + b.n, a.sym if a.sym is not None else b.sym)
    if op == "-":
        if b.sym is not None and b.sym != a.sym:
            raise AsmError(f"subtracting symbol {b.sym}")
        return Value(a.n - b.n, None if b.sym is not None else a.sym)
    x, y = a.int(op), b.int(op)
    return Value(
        {
            "*": lambda: x * y,
            "/": lambda: c_div(x, y),
            "%": lambda: c_mod(x, y),
            "<<": lambda: x << y,
            ">>": lambda: x >> y,
            "|": lambda: x | y,
            "&": lambda: x & y,
            "^": lambda: x ^ y,
            "&&": lambda: int(bool(x) and bool(y)),
            "||": lambda: int(bool(x) or bool(y)),
        }[op]()
    )


class Assembler:
    """Assembles mid2agb's output (and MPlayDef.s) into one section's bytes, labels and relocations."""

    def __init__(self, include_dirs, symbols=None, included=()):
        self.include_dirs = include_dirs
        self.included = set(included)  # includes whose symbols are already in `symbols` (MPlayDef.s): skipped
        self.equs = dict(symbols or {})  # name -> Value
        self.labels = {}  # label -> offset in the section
        self.cache = {}  # expression -> Value, cleared whenever a symbol is (re)defined

    # expressions

    def lookup(self, name):
        if name in self.labels:
            return Value(0, name)
        if name in self.equs:
            return self.equs[name]
        return Value(0, name)  # undefined: an external symbol (voicegroupNNN)

    def value(self, expr):
        """eval() with a cache: a song's 200,000 operands are mostly the same few hundred expressions."""
        v = self.cache.get(expr)
        if v is None:
            v = self.cache[expr] = self.eval(expr)
        return v

    def eval(self, expr):
        toks = tokenize(expr)
        pos = 0

        def primary():
            nonlocal pos
            if pos >= len(toks):
                raise AsmError(f"truncated expression {expr!r}")
            kind, v = toks[pos]
            pos += 1
            if kind == "num":
                return Value(v)
            if kind == "sym":
                return self.lookup(v)
            if v == "(":
                r = binary(0)
                if pos >= len(toks) or toks[pos] != ("op", ")"):
                    raise AsmError(f"missing ) in {expr!r}")
                pos += 1
                return r
            a = primary()
            if v == "-":
                return Value(-a.int(expr))
            if v == "+":
                return a
            if v == "~":
                return Value(~a.int(expr))
            if v == "!":
                return Value(int(not a.int(expr)))
            raise AsmError(f"unexpected {v!r} in {expr!r}")

        def binary(min_prec):
            nonlocal pos
            left = primary()
            while pos < len(toks) and toks[pos][0] == "op" and BINARY.get(toks[pos][1], 0) > min_prec:
                op = toks[pos][1]
                pos += 1
                left = binop(op, left, binary(BINARY[op]))
            return left

        v = binary(0)
        if pos != len(toks):
            raise AsmError(f"trailing tokens in {expr!r}")
        return v

    # source

    def lines(self, path, depth=0):
        if depth > 8:
            raise AsmError(f"includes nested too deep at {path}")
        for raw in path.read_text().splitlines():
            line = raw.split("@", 1)[0].strip()  # ARM gas: @ starts a comment
            m = INCLUDE.match(line)
            if m and m[1] in self.included:
                continue
            if m:
                for d in [path.parent, *self.include_dirs]:
                    if (d / m[1]).exists():
                        yield from self.lines(d / m[1], depth + 1)
                        break
                else:
                    raise AsmError(f"{path.name}: can't find include {m[1]}")
            elif line:
                yield line

    def assemble(self, path):
        """Two passes over the file: labels and sizes, then bytes.

        Returns (bytes, relocs [(offset, symbol, addend)])."""
        stmts = []
        for line in self.lines(path):
            while True:  # labels, possibly several, before a statement
                m = LABEL.match(line)
                if not m:
                    break
                stmts.append(("label", m[1]))
                line = line[m.end() :]
            if line:
                d = STATEMENT.match(line)
                stmts.append(("stmt", d[1].lower(), d[2].strip()))

        for emit in (False, True):
            data, relocs, self.section, ended = bytearray(), [], ".text", False
            for st in stmts:
                if ended:
                    break
                if st[0] == "label":
                    if not emit:
                        if st[1] in self.labels:
                            raise AsmError(f"label {st[1]} defined twice")
                        self.labels[st[1]] = len(data)
                    continue
                _, op, args = st
                ended = self.directive(op, args, data, relocs, emit)
        return bytes(data), relocs

    def directive(self, op, args, data, relocs, emit):
        operands = [a.strip() for a in args.split(",")] if args else []
        if op in (".equ", ".set", ".equiv"):
            name, expr = operands[0], ",".join(operands[1:]).strip()
            if op == ".equiv" and not emit and name in self.equs:
                raise AsmError(f".equiv {name} redefined")
            self.cache.clear()
            # Evaluated now; a label defined further down reads as undefined in pass 1 and is right in pass 2.
            self.equs[name] = self.eval(expr)
        elif op in (".global", ".globl", ".type", ".size", ".file", ".ident"):
            pass
        elif op == ".section":
            self.section = operands[0]
        elif op in (".text", ".data", ".bss"):
            self.section = op
        elif op in (".align", ".balign", ".p2align"):
            n = self.eval(operands[0]).int(op)
            size = n if op == ".balign" else 1 << n
            data.extend(b"\0" * (-len(data) % size))
        elif op == ".end":
            return True
        elif op in (".byte", ".hword", ".2byte", ".short", ".word", ".4byte", ".int", ".long"):
            size = 1 if op == ".byte" else 2 if op in (".hword", ".2byte", ".short") else 4
            for expr in operands:
                if not emit:
                    data.extend(b"\0" * size)
                    continue
                v = self.value(expr)
                if v.sym is not None:
                    if size != 4:
                        raise AsmError(f"{op} {expr}: a symbol needs a .word")
                    relocs.append((len(data), v.sym, v.n))
                    n = 0
                else:
                    n = v.n
                    if not -(1 << (8 * size - 1)) <= n < (1 << (8 * size)):
                        print(f"  warning: {op} {expr} = {n} truncated (as GNU as does)")
                data.extend((n & ((1 << (8 * size)) - 1)).to_bytes(size, "little"))
            if self.section not in (".rodata", ".text"):
                raise AsmError(f"data in section {self.section}")
        elif op == ".space":
            n = self.eval(operands[0]).int(op)
            data.extend(b"\0" * n)
        else:
            raise AsmError(f"unsupported directive {op} {args}")
        return False


def mplaydef_symbols(decomp):
    asm = Assembler([])
    asm.assemble(decomp / "sound" / "MPlayDef.s")
    return asm.equs


def assemble_song(path, name, include_dirs, symbols):
    """mid2agb's .s -> the song's header fields and relocated track bytes."""
    asm = Assembler(include_dirs, symbols, included=["MPlayDef.s"])
    blob, relocs = asm.assemble(path)
    if name not in asm.labels:
        raise AsmError(f"{path.name}: no header label {name}")
    hdr = asm.labels[name]
    data = bytearray(blob[:hdr])
    header_relocs = {}
    for off, sym, addend in relocs:
        if off >= hdr:
            header_relocs[off] = (sym, addend)
            continue
        if sym not in asm.labels or asm.labels[sym] + addend >= hdr:
            raise AsmError(f"{name}: pointer at {off} to {sym}+{addend} is outside the song's track data")
        data[off : off + 4] = (asm.labels[sym] + addend).to_bytes(4, "little")
    track_count, block_count, priority, reverb = blob[hdr : hdr + 4]
    grp = header_relocs.get(hdr + 4)
    if grp is None and int.from_bytes(blob[hdr + 4 : hdr + 8], "little") != 0:
        raise AsmError(f"{name}: voicegroup is a number")
    tracks = []
    for i in range(track_count):
        sym, addend = header_relocs.get(hdr + 8 + 4 * i, (None, 0))
        if sym not in asm.labels or asm.labels[sym] + addend >= hdr:
            raise AsmError(f"{name}: track {i + 1} pointer {sym} is not in the song")
        tracks.append(asm.labels[sym] + addend)
    return {
        "priority": priority,
        "reverb": reverb,
        "blockCount": block_count,
        "voicegroup": grp[0] if grp and grp[1] == 0 else None,
        "tracks": tracks,
        "data": base64.b64encode(bytes(data)).decode("ascii"),
    }


# --- tables -------------------------------------------------------------------------------------------------


def song_table(decomp):
    """gSongTable: [(label, ms, me)] in song id order."""
    text = (decomp / "sound" / "song_table.inc").read_text()
    body = text.split("gSongTable::", 1)[1]
    entries = re.finditer(r"^\s*song\s+(\w+)\s*,\s*(\w+)\s*,\s*(\w+)", body, re.M)
    return [(m[1], int(m[2], 0), int(m[3], 0)) for m in entries]


def music_players(decomp):
    """gMPlayTable: [{name, tracks}] in order (music_player info, track struct, track count, unknown)."""
    asm = Assembler([])
    text = (decomp / "sound" / "music_player_table.inc").read_text()
    for m in re.finditer(r"^\s*\.equiv?\s+(\w+)\s*,\s*(.+?)\s*$", text, re.M):
        asm.equs[m[1]] = asm.eval(m[2])
    return [
        {"name": m[1], "tracks": asm.eval(m[2]).int(m[1])}
        for m in re.finditer(r"^\s*music_player\s+(\w+)\s*,\s*\w+\s*,\s*([^,\n]+?)\s*,", text, re.M)
    ]


EMPTY_HEADER = {"priority": 0, "reverb": 0, "blockCount": 0, "voicegroup": None, "tracks": [], "data": ""}


def extract_audio(decomp, out):
    exe = build_mid2agb(decomp)
    cfg, skipped = midi_cfg(decomp)
    symbols = mplaydef_symbols(decomp)
    include_dirs = [decomp / "sound"]
    headers = {}
    with tempfile.TemporaryDirectory(prefix="mid2agb-") as tmp:
        run_mid2agb(exe, decomp, cfg, Path(tmp))
        for name, _ in cfg:
            try:
                headers[name] = assemble_song(Path(tmp) / f"{name}.s", name, include_dirs, symbols)
            except AsmError as e:
                sys.exit(f"extract_audio: {name}.s: {e}")
    # dummy_song_header (song_table.inc): `.byte 0, 0, 0, 0`, no voicegroup, no tracks.
    headers.setdefault("dummy_song_header", EMPTY_HEADER)

    songs = []
    for song_id, (label, ms, me) in enumerate(song_table(decomp)):
        if label not in headers:
            sys.exit(f"extract_audio: song table entry {song_id} ({label}) has no song in midi.cfg")
        songs.append({"id": song_id, "name": label, "ms": ms, "me": me, **headers[label]})

    (out / "audio").mkdir(parents=True, exist_ok=True)
    with open(out / "audio" / "songs.json", "w") as f:
        f.write('{"players":' + json.dumps(music_players(decomp), separators=(",", ":")) + ',\n"songs":[\n')
        f.write(",\n".join(json.dumps(s, separators=(",", ":")) for s in songs))
        f.write("\n]}\n")
    size = sum(len(base64.b64decode(s["data"])) for s in songs)
    print(f"  {len(songs)} songs ({len(cfg)} converted, {skipped} midi.cfg lines without a .mid), {size} bytes")
