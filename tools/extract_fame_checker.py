"""The Fame Checker's tables (public/gen/fameChecker.json), for src/menus/fameChecker.ts.

From fame_checker.c (its local FAME_CHECKER_* / FC_NONTRAINER_START defines resolved):
- trainerIdxs: sTrainerIdxs, FAMECHECKER_* -> TRAINER_* id, or FC_NONTRAINER_START + n for OAK / DAISY / BILL / FUJI
- trainerPicIdxs: sFameCheckerTrainerPicIdxs, FAMECHECKER_* -> TRAINER_PIC_*
- npcGraphicsIds: sFameCheckerArrayNpcGraphicsIds, [person * 6 + i] -> OBJ_EVENT_GFX_* name (the sprite manifest's key)
- nonTrainerStart: FC_NONTRAINER_START
From event_object_movement.c:
- objectPalettes0: the palette symbol of each slot sObjectPaletteTags0 names (InitObjectEventPalettes(0))
The text (data/text/fame_checker.inc) is in strings.json; the graphics (graphics/fame_checker/) in gfx/.
"""

import json
import re

from extract import eval_const_expr, parse_defines


def _array(src, name):
    body = re.search(rf"\b{name}\[[^\]]*\]\s*=\s*\{{(.*?)\}};", src, re.S).group(1)
    body = re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", body, flags=re.S))
    return body


def _designated(body, known):
    """`[FAMECHECKER_X] = VALUE,` entries -> list by index (values as written)."""
    out = {}
    for key, value in re.findall(r"\[(\w+)\]\s*=\s*([^,\n]+)", body):
        out[eval_const_expr(key, known)] = value.strip()
    return [out[i] for i in range(len(out))]


def extract_fame_checker(decomp, out):
    src = (decomp / "src/fame_checker.c").read_text()
    known = dict(parse_defines(decomp))
    for name, expr in re.findall(r"#define\s+(FC_NONTRAINER_START|FAME_CHECKER_\w+)\s+(.+)", src):
        known[name] = eval_const_expr(re.sub(r"[()]", " ", expr).strip(), known)

    trainer_idxs = [eval_const_expr(v, known) for v in _designated(_array(src, "sTrainerIdxs"), known)]
    pic_idxs = [eval_const_expr(v, known) for v in _designated(_array(src, "sFameCheckerTrainerPicIdxs"), known)]
    npc_ids = re.findall(r"OBJ_EVENT_GFX_\w+", _array(src, "sFameCheckerArrayNpcGraphicsIds"))
    assert len(trainer_idxs) == known["NUM_FAMECHECKER_PERSONS"] == len(pic_idxs) and len(npc_ids) == 6 * len(pic_idxs)
    assert None not in trainer_idxs and None not in pic_idxs

    movement_c = (decomp / "src/event_object_movement.c").read_text()
    pal_by_tag = {tag: sym for sym, tag in re.findall(r"\{\s*(gObjectEventPal_\w+),\s*(OBJ_EVENT_PAL_TAG_\w+)\s*\}", movement_c)}
    slot_tags = re.findall(r"OBJ_EVENT_PAL_TAG_\w+", _array(movement_c, "sObjectPaletteTags0"))

    data = {
        "nonTrainerStart": known["FC_NONTRAINER_START"],
        "trainerIdxs": trainer_idxs,
        "trainerPicIdxs": pic_idxs,
        "npcGraphicsIds": npc_ids,
        "objectPalettes0": [pal_by_tag.get(t) for t in slot_tags],
    }
    (out / "fameChecker.json").write_text(json.dumps(data, separators=(",", ":")))
