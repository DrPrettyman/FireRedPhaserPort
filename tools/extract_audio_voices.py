"""Voicegroups, keysplit tables, samples, programmable waves and cry tables -> public/gen/audio/
(AUDIO_PLAN.md unit W-audiodata 2). The m4a engine (src/audio/) reads these the way m4a_1.s reads the ROM.

Sources (decomp; data/sound_data.s assembles them in this order: voice_groups (with cry_tables inside it),
keysplit_tables, programmable_wave_data, music_player_table, song_table, direct_sound_data):

- sound/voice_groups.inc (which `.include`s cry_tables.inc between voicegroup128 and voicegroup129) through the
  macros in asm/macros/music_voice.inc: each `voice_*` line is one 12-byte struct ToneData
  (include/gba/m4a_internal.h): type, key, length, pan_sweep, wav (a pointer, or the CGB duty / noise period
  word), attack, decay, sustain, release. The fields below hold exactly the bytes the macros emit:
    * voice_directsound[_no_resample|_reverse]: type 0x00 / 0x08 / 0x10, key, length 0, pan_sweep = 0x80|pan (or
      0), wav -> "sample", ADSR as given.
    * voice_square_1[_alt] (type 1 / 9): length = 0x80|pan (or 0: the macro puts the pan in the *length* byte),
      pan_sweep = sweep, wav = duty & 3 -> "duty", ADSR masked to 3/3/4/3 bits.
    * voice_square_2[_alt] (2 / 10): as square 1 with pan_sweep 0.
    * voice_programmable_wave[_alt] (3 / 11): length = pan byte, pan_sweep 0, wav -> "wave", ADSR masked.
    * voice_noise[_alt] (4 / 12): length = pan byte, pan_sweep 0, wav = period & 1 -> "period", ADSR masked.
    * voice_keysplit (0x40): key/length/pan_sweep 0, wav -> "subgroup", the ADSR bytes hold the keysplit table
      pointer -> "keysplit" (attack..release are written as 0).
    * voice_keysplit_all (0x80, a rhythm set: the subgroup is indexed by the MIDI key): "keysplit": null.
  Voicegroups sit back to back in the ROM, and ply_note indexes them as `voicegroup + 12 * n` with no bound, so a
  voicegroup defined with fewer than 128 voices (drum kits, keysplit subgroups) reads on into the next one. Each
  voicegroup's list here has 128 entries read that way (256 for the subgroups of voice_keysplit voices, as a
  keysplit table entry is a u8), null past the end of voice_groups.inc. The cry tables sit in that run too
  (between voicegroup128 and voicegroup129), but no voicegroup's window reaches them.
- sound/keysplit_tables.inc: `.set KeySplitTableN, . - K` puts each label K bytes before its data (see the file's
  header comment), so table[key] is the byte at label + key. Each table here has 128 entries indexed by the MIDI
  key, read from the bytes around it as the ROM has them (keys below the first table's range read the end of
  voice_groups.inc, keys past the last read the programmable waves); null where that byte is a pointer.
- sound/direct_sound_data.inc -> the .wav each .bin is built from (audio_rules.mk: `wav2agb -b`, cries `-b -c`).
  Read as tools/wav2agb does (wav_file.cpp, converter.cpp): 8-bit unsigned PCM -> s8 (u8 - 128); `smpl` gives
  the loop (loopStart; loopEnd = the last looped sample + 1), the data written is the first loopEnd samples (all
  of them without a loop); WaveData.freq = the `agbp` chunk (else rate * 2^((60 - key)/12 + tune/1200) * 1024);
  WaveData.size = the `agbl` chunk (else loopEnd); the loop flag (status 0x4000) = the smpl loop. The cries are
  DPCM-compressed in the ROM; the WAVs are the decoded data (AUDIO_PLAN decision 4), so they're stored as PCM.
- sound/programmable_wave_data.inc -> the 16-byte .pcm files (32 4-bit samples, high nibble first).
- sound/cry_tables.inc: gCryTable / gCryTable_Reverse (`cry` = voice_directsound_compressed 60, 0, sample, 255,
  0, 255, 0: type 0x20; `cry_reverse`: type 0x30), indexed by SpeciesToCryId.

Output (public/gen/audio/):
  voicegroups.json  {"voicegroups": {name: [128 (keysplit subgroups: 256) voices|null]},
                     "voicegroupSizes": {name: voices defined}, "keysplits": {name: [128 subgroup indices|null]},
                     "cries": [voices], "criesReverse": [voices]}
  samples.json      {label: {"freq", "loop", "loopStart", "size", "offset"}}  (freq = WaveData.freq = rate*1024)
  samples.bin       s8 PCM, each sample at its offset (4-byte aligned), size + 1 bytes long (wav2agb writes
                    loopEnd samples and agbl = loopEnd - 1, so the byte after the last one is the sample's own)
  waves.json        {label: [16 bytes]}
"""

import json
import re
import struct
import time

# asm/macros/music_voice.inc: macro -> type byte
DIRECTSOUND = {
    "voice_directsound": 0x00,
    "voice_directsound_no_resample": 0x08,
    "voice_directsound_reverse": 0x10,
    "voice_directsound_compressed": 0x20,
    "voice_directsound_compressed_reverse": 0x30,
}
CGB = {
    "voice_square_1": 1, "voice_square_1_alt": 9,
    "voice_square_2": 2, "voice_square_2_alt": 10,
    "voice_programmable_wave": 3, "voice_programmable_wave_alt": 11,
    "voice_noise": 4, "voice_noise_alt": 12,
}


def _pan_byte(pan):
    return (0x80 | pan) & 0xFF if pan != 0 else 0


def parse_voice(macro, args):
    """One music_voice.inc macro -> (the ToneData as a dict, its 12 bytes with None for pointer bytes)."""
    ptr = [None] * 4
    if macro in DIRECTSOUND:
        key, pan, sample, a, d, s, r = args
        v = {"type": DIRECTSOUND[macro], "key": int(key) & 0xFF, "length": 0, "panSweep": _pan_byte(int(pan)),
             "attack": int(a) & 0xFF, "decay": int(d) & 0xFF, "sustain": int(s) & 0xFF, "release": int(r) & 0xFF,
             "sample": sample}
        wav = ptr
    elif macro in CGB:
        t = CGB[macro]
        kind = t & 7
        if kind == 1:
            key, pan, sweep, wav_arg, a, d, s, r = args
            pan_sweep = int(sweep) & 0xFF
        else:
            key, pan, wav_arg, a, d, s, r = args
            pan_sweep = 0
        v = {"type": t, "key": int(key) & 0xFF, "length": _pan_byte(int(pan)), "panSweep": pan_sweep,
             "attack": int(a) & 0x7, "decay": int(d) & 0x7, "sustain": int(s) & 0xF, "release": int(r) & 0x7}
        if kind == 3:
            v["wave"] = wav_arg
            wav = ptr
        elif kind == 4:
            v["period"] = int(wav_arg) & 0x1
            wav = [v["period"], 0, 0, 0]
        else:
            v["duty"] = int(wav_arg) & 0x3
            wav = [v["duty"], 0, 0, 0]
    elif macro == "voice_keysplit":
        group, table = args
        v = {"type": 0x40, "key": 0, "length": 0, "panSweep": 0, "attack": 0, "decay": 0, "sustain": 0,
             "release": 0, "subgroup": group, "keysplit": table}
        return v, [0x40, 0, 0, 0] + ptr + ptr
    elif macro == "voice_keysplit_all":
        (group,) = args
        v = {"type": 0x80, "key": 0, "length": 0, "panSweep": 0, "attack": 0, "decay": 0, "sustain": 0,
             "release": 0, "subgroup": group, "keysplit": None}
        return v, [0x80, 0, 0, 0] + ptr + [0, 0, 0, 0]
    else:
        raise ValueError(f"unknown voice macro {macro}")
    head = [v["type"], v["key"], v["length"], v["panSweep"]]
    return v, head + wav + [v["attack"], v["decay"], v["sustain"], v["release"]]


LINE_VOICE = re.compile(r"^\s*(voice_\w+|cry_reverse|cry)\s+(.*?)\s*(?:@.*)?$")


def _voice_lines(text):
    """Yield (label, None) for each `label::` and (None, (voice, bytes)) for each voice macro, in order."""
    for line in text.splitlines():
        m = LINE_VOICE.match(line)
        if m:
            macro, args = m.group(1), [a.strip() for a in m.group(2).split(",")]
            if macro == "cry":
                macro, args = "voice_directsound_compressed", ["60", "0", args[0], "255", "0", "255", "0"]
            elif macro == "cry_reverse":
                macro, args = "voice_directsound_compressed_reverse", ["60", "0", args[0], "255", "0", "255", "0"]
            yield None, parse_voice(macro, args)
        elif m := re.match(r"^(\w+)::\s*$", line):
            yield m.group(1), None
        elif line.strip() and not re.match(r"^\s*\.align\s+2\s*$", line):
            raise ValueError(f"unexpected line: {line!r}")


def _voices(text):
    return [vb[0] for _, vb in _voice_lines(text) if vb]


def parse_voicegroups(text, decomp):
    """voice_groups.inc -> (every voice in ROM order, its bytes, {label: first voice index}). The file
    `.include`s cry_tables.inc between voicegroup128 and voicegroup129, so the cry tables are part of the run."""
    text = re.sub(r'^\.include\s+"([^"]+)"\s*$', lambda m: (decomp / m.group(1)).read_text(), text, flags=re.M)
    voices, image, starts = [], [], {}
    for label, vb in _voice_lines(text):
        if label:
            starts[label] = len(voices)
        else:
            voices.append(vb[0])
            image.extend(vb[1])
    return voices, image, starts


def parse_keysplits(text):
    """keysplit_tables.inc -> (the table bytes, {label: offset into them, may be negative})."""
    blob, labels = [], {}
    for line in text.splitlines():
        line = line.split("@")[0].strip()
        if not line:
            continue
        m = re.match(r"^\.set\s+(\w+),\s*\.\s*-\s*(\d+)$", line)
        if m:
            labels[m.group(1)] = len(blob) - int(m.group(2))
            continue
        m = re.match(r"^\.byte\s+(\d+)$", line)
        if not m:
            raise ValueError(f"unexpected keysplit line: {line!r}")
        blob.append(int(m.group(1)))
    return blob, labels


def incbin_labels(text):
    """`Label::` followed by `.incbin "path"` -> [(label, path)] in file order."""
    return re.findall(r"^(\w+)::[^\n]*\n\s*\.incbin\s+\"([^\"]+)\"", text, re.M)


def read_wav(path):
    """A sample WAV as tools/wav2agb reads it (wav_file.cpp) and writes it with -b (converter.cpp convert())."""
    b = path.read_bytes()
    if b[:4] != b"RIFF" or b[8:12] != b"WAVE":
        raise ValueError(f"{path}: not a RIFF WAVE")
    pos, chunks = 12, {}
    while pos + 8 <= len(b):
        cid, n = b[pos:pos + 4].decode("latin-1"), struct.unpack_from("<I", b, pos + 4)[0]
        chunks[cid] = b[pos + 8:pos + 8 + n]
        pos += 8 + n + (n & 1)
    tag, channels, rate, _, align, bits = struct.unpack_from("<HHIIHH", chunks["fmt "])
    if (tag, channels, align, bits) != (1, 1, 1, 8):
        raise ValueError(f"{path}: only 8-bit mono PCM is handled (wav2agb also takes 16/24/32-bit and float)")
    data = chunks["data"]
    loop_start, loop_end, loop, key, tune = 0, 0xFFFFFFFF, False, 60, 0.0
    if "smpl" in chunks:
        s = chunks["smpl"]
        key = min(struct.unpack_from("<I", s, 12)[0], 127)
        tune = struct.unpack_from("<I", s, 16)[0] / (4294967296.0 * 100.0)  # wav_file.cpp's conversion, as is
        if struct.unpack_from("<I", s, 28)[0] == 1:
            loop_start = struct.unpack_from("<I", s, 44)[0]
            loop_end = struct.unpack_from("<I", s, 48)[0] + 1  # smpl's end is inclusive
            loop = True
    loop_end = min(loop_end, len(data))
    agbp = struct.unpack_from("<I", chunks["agbp"])[0] if len(chunks.get("agbp", b"")) >= 4 else 0
    agbl = struct.unpack_from("<I", chunks["agbl"])[0] if len(chunks.get("agbl", b"")) >= 4 else 0
    if agbp:
        freq = agbp
    elif key == 60 and tune == 0.0:
        freq = int(rate * 1024.0)
    else:
        freq = int(rate * 2.0 ** ((60.0 - key) / 12.0 + tune / 1200.0) * 1024.0)
    pcm = bytes((x - 128) & 0xFF for x in data[:loop_end])  # floor((u8 - 128) / 128 * 128): exact s8
    return {"freq": freq, "loop": loop, "loopStart": loop_start, "size": agbl or loop_end}, pcm


def extract_audio_voices(decomp, out):
    print("audio: voicegroups + samples")
    t0 = time.time()
    sound = decomp / "sound"
    dest = out / "audio"
    dest.mkdir(parents=True, exist_ok=True)

    # Samples (direct_sound_data.inc), in ROM order, each 4-byte aligned.
    samples, blob = {}, bytearray()
    for label, binpath in incbin_labels((sound / "direct_sound_data.inc").read_text()):
        info, pcm = read_wav(decomp / re.sub(r"\.bin$", ".wav", binpath))
        info["offset"] = len(blob)
        blob += pcm
        blob += bytes(-len(blob) % 4)
        samples[label] = info
    (dest / "samples.bin").write_bytes(blob)
    (dest / "samples.json").write_text(json.dumps(samples, separators=(",", ":")))

    # Programmable waves.
    waves = {label: list((decomp / path).read_bytes())
             for label, path in incbin_labels((sound / "programmable_wave_data.inc").read_text())}
    for label, data in waves.items():
        if len(data) != 16:
            raise ValueError(f"{label}: {len(data)} bytes, expected 16")
    (dest / "waves.json").write_text(json.dumps(waves, separators=(",", ":")))

    # Voicegroups: 128 entries each, read on through the following voicegroups as ply_note does.
    voices, image, starts = parse_voicegroups((sound / "voice_groups.inc").read_text(), decomp)
    order = sorted(starts, key=starts.get)  # incl. gCryTable / gCryTable_Reverse, which sit among them
    sizes = {name: (starts[order[i + 1]] if i + 1 < len(order) else len(voices)) - starts[name]
             for i, name in enumerate(order) if name.startswith("voicegroup")}
    # A program number is 0-127 and so is a rhythm set's key, but a keysplit table entry is a u8: subgroups of
    # voice_keysplit voices get 256 entries (only reachable through the table bytes outside their ranges).
    split_groups = {v["subgroup"] for v in voices if v["type"] == 0x40}
    voicegroups = {name: [voices[i] if i < len(voices) else None
                          for i in range(starts[name], starts[name] + (256 if name in split_groups else 128))]
                   for name in order if name.startswith("voicegroup")}

    # Keysplit tables, by MIDI key, read from the ROM bytes around them: voice_groups, keysplit_tables, waves.
    ks_blob, ks_labels = parse_keysplits((sound / "keysplit_tables.inc").read_text())
    rom = image + ks_blob + [b for w in waves.values() for b in w]
    base = len(image)
    keysplits = {}
    for name, off in ks_labels.items():
        at = base + off
        keysplits[name] = [rom[at + k] if 0 <= at + k < len(rom) else None for k in range(128)]

    # Cry tables.
    cry_text = (sound / "cry_tables.inc").read_text()
    split = cry_text.index("gCryTable_Reverse::")
    cries, cries_reverse = _voices(cry_text[:split]), _voices(cry_text[split:])

    # Every reference resolves.
    for v in voices + cries + cries_reverse:
        if "sample" in v and v["sample"] not in samples:
            raise ValueError(f"unknown sample {v['sample']}")
        if "wave" in v and v["wave"] not in waves:
            raise ValueError(f"unknown wave {v['wave']}")
        if "subgroup" in v and v["subgroup"] not in starts:
            raise ValueError(f"unknown voicegroup {v['subgroup']}")
        if v.get("keysplit") and v["keysplit"] not in keysplits:
            raise ValueError(f"unknown keysplit table {v['keysplit']}")

    data = {"voicegroups": voicegroups, "voicegroupSizes": sizes, "keysplits": keysplits,
            "cries": cries, "criesReverse": cries_reverse}
    (dest / "voicegroups.json").write_text(json.dumps(data, separators=(",", ":")))
    print(f"  {len(voicegroups)} voicegroups, {len(keysplits)} keysplit tables, {len(samples)} samples "
          f"({len(blob)} bytes), {len(waves)} waves, {len(cries)} cries ({time.time() - t0:.1f} s)")


if __name__ == "__main__":
    import sys
    from pathlib import Path

    extract_audio_voices(Path(sys.argv[1]), Path(sys.argv[2]))
