"""Easy Chat's word data (public/gen/easyChat.json), for src/menus/easyChatData.ts.

- constants: EC_GROUP_*, EC_NUM_GROUPS, EASY_CHAT_TYPE_*, EC_WORD_UNDEFINED, NUM_ADDITIONAL_PHRASES(_BYTES),
  NUM_QUESTIONNAIRE_WORDS, EASY_CHAT_BATTLE_WORDS_COUNT, MAIL_WORDS_COUNT, NUM_ALPHABET_ROWS / _COLUMNS.

From src/data/easy_chat/ (included by easy_chat.c):
- groups: sEasyChatGroups by EC_GROUP_* (easy_chat_groups.h): numWords, numEnabledWords, and either `values`
  (the POKEMON / POKEMON_2 / MOVE_1 / MOVE_2 groups' valueList: SPECIES_* / MOVE_* ids) or `words` (struct
  EasyChatWordInfo: the raw decomp text without EOS, alphabeticalOrder, enabled).
- wordsByLetter: sEasyChatWordsByLetterPointers (easy_chat_words_by_letter.h), 27 lists (others, A-Z) of EC words
  as the C has them, incl. the `-1, n` markers (as EC_WORD_UNDEFINED, n) before a doubled species name; numWords.
From easy_chat.c:
- groupNames: sEasyChatGroupNamePointers by EC_GROUP_*: {label, text} (src/strings.c's gEasyChatGroupName_*).
- defaultProfileWords / defaultBattleStartWords: sDefaultProfileWords / sDefaultBattleStartWords; deoxys:
  sDeoxysValue.
- threeQuestionMarks: src/strings.c's gText_ThreeQuestionMarks (CopyEasyChatWord's invalid word).
From easy_chat_2.c:
- screenTemplates: sEasyChatScreenTemplates (type, numColumns, numRows, frameId and the text labels, null when unset).
- passphrases: sECPhrase_MysteryEventIsExciting (the profile's) and sECPhrase_LinkTogetherWithAll (the
  questionnaire's), by name.
"""

import json
import re

from extract import eval_const_expr, parse_defines
from extract_battle import c_array_body
from extract_menus import by_index, designated_entries

EC_DIR = "src/data/easy_chat"


def strip_comments(text):
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", text, flags=re.S))


def ec_value(expr, defines):
    """An EC word as the word lists write it: EC_WORD_*, EC_POKEMON(X), EC_POKEMON2(X), EC_MOVE(X), EC_MOVE2(X), -1, n."""
    expr = expr.strip()
    m = re.fullmatch(r"EC_(POKEMON2?|MOVE2?)\((\w+)\)", expr)
    if m:
        kind, name = m.groups()
        group = {"POKEMON": "EC_GROUP_POKEMON", "POKEMON2": "EC_GROUP_POKEMON_2", "MOVE": "EC_GROUP_MOVE_1", "MOVE2": "EC_GROUP_MOVE_2"}[kind]
        index = defines[("SPECIES_" if kind.startswith("POKEMON") else "MOVE_") + name]
        return (defines[group] << 9) | index
    if expr == "-1":
        return 0xFFFF  # a u16 array: EC_WORD_UNDEFINED
    v = eval_const_expr(expr, defines)
    if v is None:
        raise ValueError(f"unresolved easy chat word {expr}")
    return v


def value_list(text, name, defines):
    out = []
    for e in strip_comments(c_array_body(text, name)).split(","):
        if e.strip():
            v = eval_const_expr(e.strip(), defines)
            if v is None:
                raise ValueError(f"unresolved {e.strip()} in {name}")
            out.append(v)
    return out


def word_infos(text, name):
    literals = dict(re.findall(r'\b(sEasyChatWord_\w+)\s*\[\s*\]\s*=\s*_\("(.*?)"\);', text))
    out = []
    for body in re.findall(r"\{([^{}]*)\}", c_array_body(text, name)):
        fields = dict(re.findall(r"\.(\w+)\s*=\s*([^,\s]+)", body))
        out.append({"text": literals[fields["text"]], "alphabeticalOrder": int(fields["alphabeticalOrder"], 0), "enabled": fields["enabled"] == "TRUE"})
    return out


def extract_easy_chat(decomp, out):
    defines = parse_defines(decomp)
    ec = decomp / EC_DIR
    group_files = "\n".join(p.read_text(encoding="utf-8") for p in sorted(ec.glob("easy_chat_group_*.h")))

    groups = []
    for body in re.findall(r"\{\s*\.wordData\s*=\s*\{(.*?)\},(.*?)\}", c_array_body((ec / "easy_chat_groups.h").read_text(), "sEasyChatGroups"), re.S):
        kind, array = re.fullmatch(r"\s*\.(valueList|words)\s*=\s*(\w+)\s*", body[0]).groups()
        nums = dict((k, int(v, 0)) for k, v in re.findall(r"\.(\w+)\s*=\s*(\d+)", body[1]))
        group = {"numWords": nums["numWords"], "numEnabledWords": nums["numEnabledWords"]}
        if kind == "valueList":
            group["values"] = value_list(group_files, array, defines)
            assert len(group["values"]) >= group["numWords"], array
        else:
            group["words"] = word_infos(group_files, array)
            assert len(group["words"]) == group["numWords"], array
        groups.append(group)
    assert len(groups) == defines["EC_NUM_GROUPS"], len(groups)

    letters_h = (ec / "easy_chat_words_by_letter.h").read_text(encoding="utf-8")
    words_by_letter = []
    for words, num in re.findall(r"\.words\s*=\s*(\w+),\s*\.numWords\s*=\s*(\d+)", c_array_body(letters_h, "sEasyChatWordsByLetterPointers")):
        entries = [e.strip() for e in strip_comments(c_array_body(letters_h, words)).split(",") if e.strip()]
        words_by_letter.append({"words": [ec_value(e, defines) for e in entries], "numWords": int(num)})
    assert len(words_by_letter) == 27

    c = (decomp / "src/easy_chat.c").read_text(encoding="utf-8")
    strings_c = (decomp / "src/strings.c").read_text(encoding="utf-8")
    c_strings = dict(re.findall(r'\b(\w+)\s*\[\s*\]\s*=\s*_\("(.*?)"\);', strings_c))
    group_names = by_index(designated_entries(c_array_body(c, "sEasyChatGroupNamePointers")), defines, lambda v: {"label": v.strip(), "text": c_strings[v.strip()]})

    c2 = (decomp / "src/easy_chat_2.c").read_text(encoding="utf-8")
    templates = []
    for body in re.findall(r"\{([^{}]*)\}", c_array_body(c2, "sEasyChatScreenTemplates")):
        fields = dict((k, v.strip()) for k, v in re.findall(r"\.(\w+)\s*=\s*([^,]+)", body))
        t = {k: eval_const_expr(fields[k], defines) for k in ("type", "numColumns", "numRows", "frameId")}
        for k in ("titleText", "instructionsText1", "instructionsText2", "confirmText1", "confirmText2"):
            t[k] = None if fields.get(k, "NULL") == "NULL" else fields[k]
        templates.append(t)

    constants = {k: v for k, v in defines.items() if re.fullmatch(r"EC_GROUP_\w+|EC_NUM_GROUPS|EASY_CHAT_TYPE_\w+", k)}
    for k in ("EC_WORD_UNDEFINED", "NUM_ADDITIONAL_PHRASES", "NUM_QUESTIONNAIRE_WORDS", "EASY_CHAT_BATTLE_WORDS_COUNT", "MAIL_WORDS_COUNT"):
        constants[k] = defines[k]
    # global.h: ROUND_BITS_TO_BYTES(NUM_ADDITIONAL_PHRASES)
    constants["NUM_ADDITIONAL_PHRASE_BYTES"] = (defines["NUM_ADDITIONAL_PHRASES"] + 7) // 8
    for k, v in re.findall(r"#define\s+(NUM_ALPHABET_\w+)\s+(\d+)", (decomp / "include/easy_chat.h").read_text()):
        constants[k] = int(v)

    data = {
        "constants": constants,
        "groups": groups,
        "wordsByLetter": words_by_letter,
        "groupNames": group_names,
        "defaultProfileWords": [ec_value(e, defines) for e in strip_comments(c_array_body(c, "sDefaultProfileWords")).split(",") if e.strip()],
        "defaultBattleStartWords": [ec_value(e, defines) for e in strip_comments(c_array_body(c, "sDefaultBattleStartWords")).split(",") if e.strip()],
        "deoxys": value_list(c, "sDeoxysValue", defines),
        "threeQuestionMarks": c_strings["gText_ThreeQuestionMarks"],
        "screenTemplates": templates,
        "passphrases": {
            name: [ec_value(e, defines) for e in strip_comments(c_array_body(c2, name)).split(",") if e.strip()]
            for name in ("sECPhrase_MysteryEventIsExciting", "sECPhrase_LinkTogetherWithAll")
        },
    }
    (out / "easyChat.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print(f"  {len(groups)} easy chat groups, {sum(len(w['words']) for w in words_by_letter)} alphabetical entries")


if __name__ == "__main__":
    import sys
    from pathlib import Path

    extract_easy_chat(Path(sys.argv[1]), Path(sys.argv[2]))
