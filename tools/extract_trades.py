"""In-game trade data (public/gen/trades.json), for src/script/tradeSpecials.ts.

- ingameTrades: sInGameTrades (src/data/ingame_trades.h, the FireRed side of its #if blocks) by INGAME_TRADE_*:
  nickname and otName as raw decomp strings (with EOS `$`, encoded at runtime), species, ivs (HP, Atk, Def, Speed,
  SpAtk, SpDef as struct InGameTrade orders them), abilityNum, otId, conditions (cool, beauty, cute, smart,
  tough), personality, heldItem, mailNum, otGender (MALE / FEMALE), sheen, requestedSpecies; constants resolved.
"""

import json
import re

from extract import c_value, parse_defines
from extract_battle import c_array_body
from extract_gfx import firered_only
from extract_menus import by_index, designated_entries


def trade_fields(body, defines):
    body = re.sub(r"//[^\n]*", "", body).strip().removeprefix("{").removesuffix("}")
    fields = {}
    for m in re.finditer(r"\.(\w+)\s*=\s*(\{[^}]*\}|_\(\"(?:\\.|[^\"\\])*\"\)|[^,]+)", body):
        raw = m.group(2).strip()
        if raw.startswith("{"):
            fields[m.group(1)] = [c_value(v.strip(), defines) for v in raw[1:-1].split(",") if v.strip()]
        else:
            fields[m.group(1)] = c_value(raw, defines)
    for key in ("nickname", "otName"):
        fields[key] += "$"
    for key, val in fields.items():
        if isinstance(val, str) and key not in ("nickname", "otName"):
            raise ValueError(f"unresolved {key} = {val}")
    return fields


def extract_trades(decomp, out):
    defines = parse_defines(decomp)
    text = firered_only((decomp / "src/data/ingame_trades.h").read_text(encoding="utf-8"))
    trades = by_index(designated_entries(c_array_body(text, "sInGameTrades")), defines, lambda v: trade_fields(v, defines))
    (out / "trades.json").write_text(json.dumps({"ingameTrades": trades}, ensure_ascii=False, separators=(",", ":")))
    print(f"  {len(trades)} in-game trades")


if __name__ == "__main__":
    import sys
    from pathlib import Path

    extract_trades(Path(sys.argv[1]), Path(sys.argv[2]))
