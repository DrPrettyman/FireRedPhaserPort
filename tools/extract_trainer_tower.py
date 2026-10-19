"""The Trainer Tower's data (public/gen/trainerTower.json), for src/world/trainerTower.ts.

From src/trainer_tower_sets.c:
- localHeader: gTrainerTowerLocalHeader (numFloors, id).
- floors: every `static const struct TrainerTowerFloor sTrainerTowerFloor_*` by symbol: id, floorIdx,
  challengeType, prize (TTPRIZE_*), checksum, and trainers[MAX_TRAINERS_PER_FLOOR] (name as a raw decomp string
  with EOS `$`, facilityClass, textColor, speechBefore / speechWin / speechLose / speechAfter as Easy Chat word ids,
  mons[PARTY_SIZE] as struct BattleTowerPokemon). DUMMY_TOWER_TEAM / DUMMY_TOWER_MON are expanded from the file's
  own #defines; fields an initializer leaves out are 0, as in C.
- sets: gTrainerTowerFloors[NUM_TOWER_CHALLENGE_TYPES][MAX_TRAINER_TOWER_FLOORS] as floor symbols.

From src/trainer_tower.c: sSingleBattleTrainerInfo, sDoubleBattleTrainerInfo, sTrainerEncounterMusicLUT,
sFloorLayouts (LAYOUT_* names: the script defines hold their values), sPrizeList, sTrainerTowerEncounterMusic,
sSingleBattleChallengeMonIdxs / sDoubleBattleChallengeMonIdxs / sKnockoutChallengeMonIdxs.
From src/data/pokemon/trainer_class_lookups.h: gFacilityClassToTrainerClass, gFacilityClassToPicIndex.
Every constant is resolved to its number (parse_defines) except the layouts.
"""

import json
import re

from extract import eval_const_expr, parse_defines
from extract_battle import c_array_body, c_flat_values

MON_FIELDS = [
    "species", "heldItem", "moves", "level", "ppBonuses", "hpEV", "attackEV", "defenseEV", "speedEV", "spAttackEV",
    "spDefenseEV", "otId", "hpIV", "attackIV", "defenseIV", "speedIV", "spAttackIV", "spDefenseIV", "gap",
    "abilityNum", "personality", "nickname", "friendship",
]
SPEECHES = ["speechBefore", "speechWin", "speechLose", "speechAfter"]


def strip_comments(text):
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", text, flags=re.S))


def function_macros(text):
    """`#define NAME(arg) body` one-liners -> {NAME: (arg, body)}."""
    return {m.group(1): (m.group(2), m.group(3).strip()) for m in re.finditer(r"^#define\s+(\w+)\((\w+)\)\s+(.+)$", text, re.M)}


def expand_function_macros(text, macros):
    """Expand one-argument macros textually, `##` pasting included (DUMMY_TOWER_TEAM, EC_MOVE(THIEF), ...)."""
    text = re.sub(r"^#define[^\n]*$", "", text, flags=re.M)
    changed = True
    while changed:
        changed = False
        for name, (param, body) in macros.items():
            def sub(m, param=param, body=body):
                arg = m.group(1).strip()
                return re.sub(rf"\b{param}\b", arg, body.replace("##" + param, arg))

            text, n = re.subn(rf"\b{name}\(([^()]*)\)", sub, text)
            changed = changed or n > 0
    return text


def without_bugfix(text):
    """Keep the #else side of `#ifdef BUGFIX` blocks (the build the port follows doesn't define BUGFIX)."""
    return re.sub(r"#ifdef BUGFIX\b.*?(?:#else\b(.*?))?#endif[^\n]*", lambda m: m.group(1) or "", text, flags=re.S)


def parse_init(s, i=0):
    """A C initializer list starting at s[i] == '{' -> (items, next index). Items are (field or None, value);
    values are nested lists, strings (`_("...")`) or expression text."""
    assert s[i] == "{", s[i : i + 40]
    i += 1
    items = []
    while True:
        while s[i] in " \t\r\n,":
            i += 1
        if s[i] == "}":
            return items, i + 1
        field = None
        m = re.match(r"(?:\.(\w+)|(\[[^\]]+\]))\s*=\s*", s[i:])
        if m:
            field = m.group(1) or m.group(2)  # `.name =` or `[INDEX] =` (kept with its brackets)
            i += m.end()
        if s[i] == "{":
            value, i = parse_init(s, i)
        else:
            m = re.match(r'_\("((?:\\.|[^"\\])*)"\)', s[i:])
            if m:
                value = ("str", m.group(1))
                i += m.end()
            else:
                depth, j = 0, i
                while depth or s[j] not in ",}":
                    depth += {"(": 1, ")": -1}.get(s[j], 0)
                    j += 1
                value = s[i:j].strip()
                i = j
        items.append((field, value))


def scalar(v, defines):
    if isinstance(v, tuple):
        return v[1] + "$"
    n = eval_const_expr(v, defines)
    if n is None:
        raise ValueError(f"unresolved constant {v!r}")
    return n


def fields(items, defines, layout):
    """Designated (and positional) initializer items -> dict in `layout` order; missing fields are 0."""
    out = {}
    for idx, (field, value) in enumerate(items):
        key = field or layout[idx]
        out[key] = [scalar(x, defines) for _, x in value] if isinstance(value, list) else scalar(value, defines)
    return out


def tower_mon(items, defines):
    mon = {k: 0 for k in MON_FIELDS}
    mon["moves"] = [0, 0, 0, 0]
    mon["nickname"] = "$"
    mon.update(fields(items, defines, MON_FIELDS))
    mon["moves"] += [0] * (4 - len(mon["moves"]))
    return mon


def tower_trainer(items, defines):
    t = {"name": "$", "facilityClass": 0, "textColor": 0, **{k: [0] * 6 for k in SPEECHES}, "mons": []}
    for field, value in items:
        if field == "mons":
            t["mons"] = [tower_mon(v, defines) for _, v in value]
        elif field in SPEECHES:
            t[field] = [scalar(x, defines) for _, x in value] + [0] * (6 - len(value))
        else:
            t[field] = scalar(value, defines)
    t["mons"] += [tower_mon([], defines) for _ in range(6 - len(t["mons"]))]
    return t


def tower_floor(items, defines):
    floor = {"id": 0, "floorIdx": 0, "challengeType": 0, "prize": 0, "trainers": [], "checksum": 0}
    for field, value in items:
        if field == "trainers":
            floor["trainers"] = [tower_trainer(v, defines) for _, v in value]
        else:
            floor[field] = scalar(value, defines)
    floor["trainers"] += [tower_trainer([], defines) for _ in range(defines["MAX_TRAINERS_PER_FLOOR"] - len(floor["trainers"]))]
    return floor


def struct_table(text, name, defines, layout):
    """`static const struct S name[] = { {a, b, c}, ... };` -> [dict in `layout` order]."""
    items, _ = parse_init("{" + c_array_body(text, name) + "}")
    return [fields(v, defines, layout) for _, v in items]


def nested_table(text, name, defines, convert):
    items, _ = parse_init("{" + c_array_body(text, name) + "}")
    return [[convert(x) for _, x in row] for _, row in items]


def extract_trainer_tower(decomp, out):
    defines = parse_defines(decomp)
    sets_text = strip_comments((decomp / "src/trainer_tower_sets.c").read_text(encoding="utf-8"))
    # The file's DUMMY_TOWER_* and easy_chat.h's EC_MOVE / EC_MOVE2 / EC_POKEMON / EC_POKEMON2
    macros = function_macros(sets_text) | function_macros((decomp / "include/constants/easy_chat.h").read_text())
    sets_text = expand_function_macros(sets_text, macros)

    floors = {}
    for m in re.finditer(r"static const struct TrainerTowerFloor (\w+)\s*=\s*", sets_text):
        items, _ = parse_init(sets_text, m.end())
        floors[m.group(1)] = tower_floor(items, defines)

    m = re.search(r"gTrainerTowerLocalHeader\s*=\s*", sets_text)
    header = fields(parse_init(sets_text, m.end())[0], defines, ["numFloors", "id", "dummy", "checksum"])

    sets_items, _ = parse_init("{" + c_array_body(sets_text, "gTrainerTowerFloors") + "}")
    sets = [None] * defines["NUM_TOWER_CHALLENGE_TYPES"]
    for key, row in sets_items:
        idx = eval_const_expr(key[1:-1], defines) if key and key.startswith("[") else None
        if idx is None:
            raise ValueError(f"gTrainerTowerFloors: unexpected row {key}")
        sets[idx] = [x.lstrip("&").strip() for _, x in row]

    tt_text = strip_comments((decomp / "src/trainer_tower.c").read_text(encoding="utf-8"))
    lookups = without_bugfix(strip_comments((decomp / "src/data/pokemon/trainer_class_lookups.h").read_text(encoding="utf-8")))
    data = {
        "localHeader": header,
        "floors": floors,
        "sets": sets,
        "singleBattleTrainerInfo": struct_table(tt_text, "sSingleBattleTrainerInfo", defines, ["objGfx", "facilityClass", "gender"]),
        "doubleBattleTrainerInfo": struct_table(
            tt_text, "sDoubleBattleTrainerInfo", defines, ["objGfx1", "objGfx2", "facilityClass", "gender1", "gender2"]
        ),
        "trainerEncounterMusicLUT": struct_table(tt_text, "sTrainerEncounterMusicLUT", defines, ["facilityClass", "musicId"]),
        "floorLayouts": nested_table(tt_text, "sFloorLayouts", defines, lambda x: x),
        "prizeList": c_flat_values(c_array_body(tt_text, "sPrizeList"), defines),
        "encounterMusic": c_flat_values(c_array_body(tt_text, "sTrainerTowerEncounterMusic"), defines),
        "singleBattleChallengeMonIdxs": nested_table(tt_text, "sSingleBattleChallengeMonIdxs", defines, lambda x: scalar(x, defines)),
        "doubleBattleChallengeMonIdxs": nested_table(tt_text, "sDoubleBattleChallengeMonIdxs", defines, lambda x: scalar(x, defines)),
        "knockoutChallengeMonIdxs": nested_table(tt_text, "sKnockoutChallengeMonIdxs", defines, lambda x: scalar(x, defines)),
        "facilityClassToTrainerClass": c_flat_values(c_array_body(lookups, "gFacilityClassToTrainerClass"), defines),
        "facilityClassToPicIndex": c_flat_values(c_array_body(lookups, "gFacilityClassToPicIndex"), defines),
    }
    for key in ("prizeList", "encounterMusic", "facilityClassToTrainerClass", "facilityClassToPicIndex"):
        if None in data[key]:
            raise ValueError(f"{key}: unresolved constant")
    (out / "trainerTower.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"  {len(floors)} floors, {sum(len(s) for s in sets)} set entries")


if __name__ == "__main__":
    import sys
    from pathlib import Path

    extract_trainer_tower(Path(sys.argv[1]), Path(sys.argv[2]))
