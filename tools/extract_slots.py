"""The slot machine's tables (public/gen/slotMachine.json), for src/menus/slotMachineLogic.ts.

From slot_machine.c (its file-local enums ICON_* / PAYOUT_* / ROWATTR_* resolved):
- reelIcons: sReelIconAnimByReelAndPos, [reel][pos] -> ICON_*
- payoutTable: sPayoutTable, PAYOUT_* -> coins
- reelBiasChances: sReelBiasChances, [machine][PAYOUT_*]
- secondReelBiasCheckIndices / thirdReelBiasCheckIndices / rowAttributes: the line tables
From field_specials.c:
- slotMachineIndices: sSlotMachineIndices (GetRandomSlotMachineId)
constants: slot_machine.c's ICON_* / PAYOUT_* / ROWATTR_* enums and NUM_REELS, REEL_LENGTH, NUM_MATCH_LINES.
"""

import json
import re

from extract import eval_const_expr, parse_defines
from extract_battle import c_array_body


def c_enums(text):
    """Every `enum { A, B = 4, C, ... };` in a C file -> {name: value}."""
    out = {}
    for body in re.findall(r"\benum\s*\w*\s*\{(.*?)\}", text, re.S):
        body = re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", body, flags=re.S))
        value = -1
        for entry in [e.strip() for e in body.split(",") if e.strip()]:
            name, _, expr = entry.partition("=")
            value = eval_const_expr(expr, out) if expr.strip() else value + 1
            out[name.strip()] = value
    return out


def c_nested(body, known):
    """A C array initializer body (nested braces, `[KEY] = value` designators) -> nested lists of numbers."""
    body = re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", body, flags=re.S))
    pos = 0

    def parse_list(end):
        nonlocal pos
        out, index = [], 0
        while True:
            m = re.compile(r"\s*").match(body, pos)
            pos = m.end()
            if pos >= len(body) or body[pos] == end:
                pos += 1
                return out
            if body[pos] == ",":
                pos += 1
                continue
            d = re.compile(r"\[([^\]]+)\]\s*=\s*").match(body, pos)
            if d:
                index = eval_const_expr(d.group(1), known)
                pos = d.end()
            if body[pos] == "{":
                pos += 1
                value = parse_list("}")
            else:
                v = re.compile(r"[^,}]+").match(body, pos)
                pos = v.end()
                value = eval_const_expr(v.group(0).strip(), known)
                if value is None:
                    raise ValueError(f"can't evaluate {v.group(0).strip()!r}")
            out += [0] * (index + 1 - len(out))
            out[index] = value
            index += 1

    return parse_list("\0")


def extract_slot_machine(decomp, out):
    defines = parse_defines(decomp)
    slots_c = (decomp / "src/slot_machine.c").read_text()
    known = {**defines, **c_enums(slots_c)}
    for k, v in re.findall(r"^#define\s+(\w+)\s+(\d+)", slots_c, re.M):
        known.setdefault(k, int(v))

    def table(name, text=slots_c):
        return c_nested(c_array_body(text, name), known)

    data = {
        "reelIcons": table("sReelIconAnimByReelAndPos"),
        "payoutTable": table("sPayoutTable"),
        "reelBiasChances": table("sReelBiasChances"),
        "secondReelBiasCheckIndices": table("sSecondReelBiasCheckIndices"),
        "thirdReelBiasCheckIndices": table("sThirdReelBiasCheckIndices"),
        "rowAttributes": table("sRowAttributes"),
        "slotMachineIndices": table("sSlotMachineIndices", (decomp / "src/field_specials.c").read_text()),
        # The file-local enums and #defines the tables are indexed by (the TS module's consts are checked against them)
        "constants": {k: known[k] for k in known if re.match(r"(ICON|PAYOUT|ROWATTR)_|NUM_(REELS|MATCH_LINES|PAYOUT_TYPES)$|REEL_LENGTH$", k)},
    }
    (out / "slotMachine.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"  {len(data['reelIcons'])} reels, {len(data['reelBiasChances'])} machines")
