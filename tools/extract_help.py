"""The help system's tables (public/gen/helpSystem.json), for src/ui/helpSystemMenu.ts.

From src/help_system.c:
- topics: the file's `enum HelpSystemTopics` (TOPIC_*) and helpIds: its anonymous enums of submenu ids (HELP_*), plus
  HELP_NONE / HELP_END.
- labels: the string tables by name (sHelpSystemTopicPtrs, sHelpSystemSpecializedQuestionTextPtrs, ...), each as
  index -> C string label (in text/strings.json: data/text/help_system.inc's Help_Text_*) or null.
- lists: every `static const u8 sXxx[] = { ..., HELP_END }` submenu list (HELP_TYPE_MATCHUPS expanded), without the
  HELP_END.
- submenuItemLists: sHelpSystemSubmenuItemLists as [HELPCONTEXT_COUNT][TOPIC_COUNT - 1] list names (or null).
- contextTopicOrder: sHelpSystemContextTopicOrder; contextTopicFlags: sHelpSystemContextTopicFlags
  [HELPCONTEXT_COUNT + 1][TOPIC_COUNT] as booleans.
- martMaps / gymMaps: sMartMaps / sGymMaps as MAP_* ids; dungeonMaps: sDungeonMaps expanded, each row's
  MAP_GROUP/MAP_NUM + j (j < count) as MAP_* ids, by row (IsInDungeonMap checks row 15, Tanoby, against a flag).
From src/save_location.c: pokeCenterMaps: sSaveLocationPokeCenterList (IsCurMapPokeCenter) as MAP_* ids.
Every label is checked against text/strings.json (written earlier by the text step).
"""

import json
import re

from extract_battle import c_array_body
from extract_menus import designated_entries

LABEL_TABLES = [
    "sHelpSystemTopicPtrs",
    "sHelpSystemTopicMouseoverDescriptionPtrs",
    "sHelpSystemSpecializedQuestionTextPtrs",
    "sHelpSystemSpecializedAnswerTextPtrs",
    "sHelpSystemMenuTopicTextPtrs",
    "sHelpSystemHowToUseMenuTextPtrs",
    "sHelpSystemTermTextPtrs",
    "sHelpSystemTermDefinitionsTextPtrs",
    "sHelpSystemGeneralTopicTextPtrs",
    "sHelpSystemGeneralTopicDescriptionTextPtrs",
    "sHelpSystemTypeMatchupTextPtrs",
    "sHelpSystemTypeMatchupDescriptionTextPtrs",
]


def strip_comments(text):
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", text, flags=re.S))


def parse_enums(text):
    """Every `enum [name] { A = n, B, ... }` in the file -> {name: value}."""
    values = {}
    for body in re.findall(r"\benum\b\s*\w*\s*\{(.*?)\}", text, re.S):
        n = -1
        for entry in [e.strip() for e in body.split(",") if e.strip()]:
            m = re.match(r"(\w+)\s*(?:=\s*(\w+))?$", entry)
            if not m:
                raise ValueError(f"enum entry {entry!r}")
            n = int(m.group(2), 0) if m.group(2) else n + 1
            values[m.group(1)] = n
    return values


def map_ids(decomp):
    """MAP_* id by (group index, map index in group) from data/maps/map_groups.json and each map.json."""
    groups = json.loads((decomp / "data/maps/map_groups.json").read_text())
    out = {}
    for g, group in enumerate(groups["group_order"]):
        for n, name in enumerate(groups[group]):
            out[(g, n)] = json.loads((decomp / "data/maps" / name / "map.json").read_text())["id"]
    return out


def extract_help_system(decomp, out):
    text = strip_comments((decomp / "src/help_system.c").read_text())
    ids = parse_enums(text)
    defines = {"HELP_NONE": 0, "HELP_END": 0xFF, **ids}
    strings = json.loads((out / "text" / "strings.json").read_text())

    def index(key):
        key = key.strip()
        if re.fullmatch(r"\d+", key):
            return int(key)
        if key not in defines:
            raise ValueError(f"unknown help id {key}")
        return defines[key]

    labels = {}
    for name in LABEL_TABLES:
        table = []
        for key, val in designated_entries(c_array_body(text, name)):
            i = index(key)
            table += [None] * (i + 1 - len(table))
            table[i] = None if val == "NULL" else val
            if table[i] is not None and table[i] not in strings:
                raise ValueError(f"{name}[{key}]: {val} isn't in strings.json")
        labels[name] = table

    matchups = re.search(r"#define HELP_TYPE_MATCHUPS\s*\\\n(.*?)\n\s*\n", text, re.S)
    matchup_ids = [int(v) for v in re.findall(r"\d+", matchups.group(1))]

    lists = {}
    for name, body in re.findall(r"static const u8 (s\w+)\[\] = \{(.*?)\};", text, re.S):
        values = []
        for entry in [e.strip() for e in body.split(",") if e.strip()]:
            if entry == "HELP_TYPE_MATCHUPS":
                values += matchup_ids
            else:
                values.append(index(entry))
        if values[-1] != 0xFF:
            continue  # not a submenu list
        lists[name] = values[:-1]

    item_lists = [e.strip() for e in c_array_body(text, "sHelpSystemSubmenuItemLists").split(",") if e.strip()]
    topic_count = ids["TOPIC_COUNT"]
    per_context = topic_count - 1
    submenu_item_lists = [
        [None if v == "NULL" else v for v in item_lists[i : i + per_context]] for i in range(0, len(item_lists), per_context)
    ]
    for row in submenu_item_lists:
        for v in row:
            if v is not None and v not in lists:
                raise ValueError(f"sHelpSystemSubmenuItemLists: unknown list {v}")

    topic_order = [ids[e.strip()] for e in c_array_body(text, "sHelpSystemContextTopicOrder").split(",") if e.strip()]

    contexts = (decomp / "include/constants/help_system.h").read_text()
    context_ids = {k: int(v) for k, v in re.findall(r"#define (HELPCONTEXT_\w+)\s+(\d+)", contexts)}
    flags = [[False] * topic_count for _ in range(context_ids["HELPCONTEXT_COUNT"] + 1)]
    for key, val in designated_entries(c_array_body(text, "sHelpSystemContextTopicFlags")):
        m = re.match(r"CONTEXT_TOPIC_FLAGS\((.*)\)", val, re.S)
        if not m:
            continue  # `{}`: all FALSE
        args = [a.strip() == "TRUE" for a in m.group(1).split(",")]
        # CONTEXT_TOPIC_FLAGS(whatToDo, howToDo, terms, aboutGame, typeMatchup, exit), by TOPIC_*
        order = ["TOPIC_WHAT_TO_DO", "TOPIC_HOW_TO_DO", "TOPIC_TERMS", "TOPIC_ABOUT_GAME", "TOPIC_TYPE_MATCHUP", "TOPIC_EXIT"]
        for topic, v in zip(order, args):
            flags[context_ids[key]][ids[topic]] = v

    def map_list(src, name):
        return [e.strip() for e in c_array_body(src, name).split(",") if e.strip() and e.strip() != "MAP_UNDEFINED"]

    by_group_num = map_ids(decomp)
    id_to_group_num = {v: k for k, v in by_group_num.items()}
    dungeon_maps = []
    for first, count in re.findall(r"\{\s*MAP_GROUP\((\w+)\),\s*MAP_NUM\(\w+\),\s*(\d+)\s*\}", c_array_body(text, "sDungeonMaps")):
        g, n = id_to_group_num[first]
        dungeon_maps.append([by_group_num[(g, n + j)] for j in range(int(count)) if (g, n + j) in by_group_num])

    save_location = strip_comments((decomp / "src/save_location.c").read_text())
    data = {
        "topics": {k: v for k, v in ids.items() if k.startswith("TOPIC_")},
        "helpIds": {k: v for k, v in defines.items() if k.startswith("HELP_")},
        "labels": labels,
        "lists": lists,
        "submenuItemLists": submenu_item_lists,
        "contextTopicOrder": topic_order,
        "contextTopicFlags": flags,
        "martMaps": map_list(text, "sMartMaps"),
        "gymMaps": map_list(text, "sGymMaps"),
        "dungeonMaps": dungeon_maps,
        "pokeCenterMaps": map_list(save_location, "sSaveLocationPokeCenterList"),
    }
    (out / "helpSystem.json").write_text(json.dumps(data, separators=(",", ":")))
