"""The quest log's tables (public/gen/questLog.json), for src/world/questLog*.ts.

- maps: {MAP_*: [mapGroup, mapNum, MAPSEC_*]}, from data/maps/map_groups.json (the group order and each group's
  map order give MAP_GROUP / MAP_NUM) and each map.json's region_map_section. The quest log's scenes and its
  movement commands store maps as group and number bytes, as the C does.
- insideOutsidePairs: field_specials.c's sInsideOutsidePairs, by QL_LOCATION_* index: [inside MAP_*, outside MAP_*].
- worldMapFlags: quest_log_events.c's sWorldMapFlags (QuestLog_RecordEnteredMap).
- disabledLocations: the maps InQuestLogDisabledLocation lists (every MAP_NUM(...) in its body).
- eventCmdSizes: sQuestLogEventCmdSizes as {QL_EVENT_*: bytes} (CMD_HEADER_SIZE folded in).
- specialEncounterSpecies: IsSpeciesFromSpecialEncounter's SPECIES_* cases.
- storyTrainerClasses: ShouldRegisterEvent_HandleBeatStoryTrainer's TRAINER_CLASS_* (the classes that register).
- locationNameTexts / departedTextIds / departedTexts / gymCityMapSecs: LoadEvent_DepartedLocation's tables
  (sLocationNameTexts and sLocationToDepartedTextId by QL_LOCATION_*, sDepartedLocationTexts by QL_DEPARTED_*,
  sGymCityMapSecs by badge).
- storyItems: item.c's TrySetObtainedItemQuestLogEvent's ITEM_* (the key items that record QL_EVENT_OBTAINED_STORY_ITEM).
"""

import json
import re


def _function_body(src, name):
    m = re.search(rf"\b{name}\s*\([^)]*\)\s*\n\{{(.*?)\n\}}", src, re.S)
    if not m:
        raise SystemExit(f"quest log: {name} not found")
    return m.group(1)


def _array_body(src, name):
    m = re.search(rf"\b{name}\s*\[\]\s*=\s*\{{(.*?)\n\}};", src, re.S)
    if not m:
        raise SystemExit(f"quest log: {name} not found")
    return m.group(1)


def extract_quest_log(decomp, out):
    groups = json.loads((decomp / "data/maps/map_groups.json").read_text())
    maps = {}
    for g, group in enumerate(groups["group_order"]):
        for n, name in enumerate(groups[group]):
            m = json.loads((decomp / "data/maps" / name / "map.json").read_text())
            maps[m["id"]] = [g, n, m.get("region_map_section", "MAPSEC_NONE")]

    specials = (decomp / "src/field_specials.c").read_text()
    pairs = []
    for row in re.findall(r"\[(QL_LOCATION_\w+)\]\s*=\s*\{([^}]*)\}", _array_body(specials, "sInsideOutsidePairs")):
        ids = re.findall(r"MAP\((MAP_\w+)\)", row[1])
        pairs.append(ids)

    events = (decomp / "src/quest_log_events.c").read_text()
    world_map_flags = re.findall(r"FLAG_WORLD_MAP_\w+", _array_body(events, "sWorldMapFlags"))
    disabled = []
    for name in re.findall(r"MAP_NUM\((MAP_\w+)\)", _function_body(events, "InQuestLogDisabledLocation")):
        if name not in disabled:
            disabled.append(name)
    header = int(re.search(r"#define CMD_HEADER_SIZE\s+(\d+)", events).group(1))
    sizes = {}
    body = re.search(r"sQuestLogEventCmdSizes\[\]\s*=\s*\{(.*?)\};", events, re.S).group(1)
    for ev, expr in re.findall(r"\[(QL_EVENT_\w+)\]\s*=\s*([^,\n]+)", body):
        sizes[ev] = eval(expr.replace("CMD_HEADER_SIZE", str(header)))  # noqa: S307 (integer sums only)
    special_species = re.findall(r"case (SPECIES_\w+):", _function_body(events, "IsSpeciesFromSpecialEncounter"))
    story_classes = re.findall(r"TRAINER_CLASS_\w+", _function_body(events, "ShouldRegisterEvent_HandleBeatStoryTrainer"))

    location_names = dict(re.findall(r"\[(QL_LOCATION_\w+)\]\s*=\s*(\w+)", _array_body(events, "sLocationNameTexts")))
    departed_ids = dict(re.findall(r"\[(QL_LOCATION_\w+)\]\s*=\s*(QL_DEPARTED_\w+)", _array_body(events, "sLocationToDepartedTextId")))
    departed_texts = dict(re.findall(r"\[(QL_DEPARTED_\w+)\]\s*=\s*(\w+)", _array_body(events, "sDepartedLocationTexts")))
    gym_mapsecs = re.findall(r"MAPSEC_\w+", re.search(r"sGymCityMapSecs\[[^\]]*\]\s*=\s*\{(.*?)\};", events, re.S).group(1))

    item_c = (decomp / "src/item.c").read_text()
    story_items = []
    for name in re.findall(r"itemId == (ITEM_\w+)", _function_body(item_c, "TrySetObtainedItemQuestLogEvent")):
        if name not in story_items:
            story_items.append(name)

    data = {
        "maps": maps,
        "insideOutsidePairs": pairs,
        "worldMapFlags": world_map_flags,
        "disabledLocations": disabled,
        "cmdHeaderSize": header,
        "eventCmdSizes": sizes,
        "specialEncounterSpecies": special_species,
        "storyTrainerClasses": story_classes,
        "locationNameTexts": location_names,
        "departedTextIds": departed_ids,
        "departedTexts": departed_texts,
        "gymCityMapSecs": gym_mapsecs,
        "storyItems": story_items,
    }
    (out / "questLog.json").write_text(json.dumps(data, separators=(",", ":")))
