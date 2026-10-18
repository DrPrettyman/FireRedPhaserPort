# Audio: plan for sound effects, cries and music

Every sound in the port is a no-op today: `src/gba/sound.ts` stubs the C's sound.c API, the script engine's audio
commands do nothing, the GBA-layer menus call the stubs, and the field, the battle and some scenes dropped
their calls for a comment. This plan says how the GBA
makes its sound, where the game uses it (and where game logic *waits* on it), how to bring it into the port, and
how to split the work into batches. It was written as research (batch 3 of [SIDE_PLAN.md](SIDE_PLAN.md),
W-audioplan); the user has reviewed it and answered its open questions ("Decisions", marked "(user)"), and batch A
is under way.

**The recommendation in one paragraph:** port the m4a engine itself (the sequencer, the channel allocator, the
mixer and the CGB channels: `src/m4a.c`, `src/m4a_1.s`) to TypeScript and drive it from the 60 Hz tick, once per
frame, exactly where the GBA's VBlank runs `m4aSoundMain`. The engine's logic always runs, so `IsSEPlaying`,
`IsCryFinished`, `BGMusicStopped` and the other waits time the same with audio on or off (headless tests run it
with the output off). Only the last step, sending each frame's mixed samples to the speakers, needs an
AudioContext. The extractor builds the decomp's own `mid2agb` with the system C++ compiler, runs it on the MIDI
files (so the song bytes are the ROM's by construction), and reads the voicegroups and the WAV samples straight
from the decomp's sources. Pre-rendered audio files were measured and rejected (see section 3).

## What was checked

Checked against the decomp (`pret/firered` at `037335f4c`, "Audio improvements (#774)") and the port at master
`bda62a9` (2026-10-18). Spikes (scratch code, not committed; section 3 has the details):

1. **mid2agb builds and converts every song.** The decomp's `tools/mid2agb` (C++, 2,066 lines) builds with the
   system `c++` in seconds; run with each song's `midi.cfg` flags it turned all 347 `.mid` files into `.s`.
2. **A small Python assembler and sequencer handle all 347 songs.** It assembles the `.s` files with
   `sound/MPlayDef.s`'s symbols (289 KB of song bytes in all) and runs MPlayMain's timing (tempo accumulator,
   waits from gClockTable, GOTO / PATT / PEND, FINE) with no synth. All 347 assemble and run: 77 loop, 270 end.
   The fanfares' real lengths differ from `sFanfares`' fixed durations (MUS_LEVEL_UP 63 frames against 80,
   MUS_OBTAIN_BADGE 313 against 340, MUS_EVOLVED 229 against 220), which matters for section 2's waits.
   What the model follows, from MPlayMain (m4a_1.s:1129-1300) and MPlayStart (m4a.c:611): a song starts with
   `tempoD = tempoI = 150`, `tempoC = 0`; each frame `tempoC += tempoI` (`_081DD86C`), and while `tempoC >= 150`
   (`_081DD9BC`) one tick runs and `tempoC -= 150`; in a tick each live track reads commands while its `wait` is
   0 (`_081DD8E0`: running status for bytes < 0x80 when the last command was ≥ 0xBD; 0xCF+ notes take up to
   three argument bytes < 0x80; 0x80-0xB0 set `wait = gClockTable[cmd - 0x80]`, `_081DD92E`), then `wait--`;
   `TEMPO n` sets `tempoI = 2n * tempoU >> 8` (ply_tempo, m4a_1.s:920). It ignores the LFO, fades, notes'
   channels and MEMACC / REPT (no FRLG song uses REPT). Known gaps: MPlayMain clears the player's TRACK status
   bits in the first tick that finds no live track (`_081DD9A4`), i.e. one tick (one frame at 150 BPM) after the
   FINE; the model counts to the FINE, so IsSEPlaying on the GBA stays TRUE about one frame longer than its
   numbers. Since SoundMain runs the sequencers before the mixer, a song started during frame N's game logic gets
   its first tick in frame N's VBlank and is first heard in frame N+1.
   Cross-check against poryaaaa's renders (which play the MIDI, so the end of the sound is the last note's
   release, not the FINE): model FINE / render audible end, in frames: SE_SELECT 10 / 13, SE_LEDGE 13 / 10,
   SE_WALL_HIT 18 / 13, SE_SAVE 43 / 47, SE_PC_ON 61 / 67, SE_FAINT 51 / 52, SE_FLEE 40 / 37, SE_EXP 99 / 117,
   SE_DOOR 34 / 20, MUS_OBTAIN_ITEM 146 / 143, MUS_OBTAIN_BADGE 313 / 310, MUS_EVOLVED 229 / 226,
   MUS_SLOTS_WIN 151 / 151, MUS_HEAL 138 / 120. They agree to within a release tail or a trailing rest, which is
   as close as a MIDI renderer can show; the engine's unit tests should pin the exact numbers.
3. **The cry WAVs decode exactly.** All 388 cries in `sound/direct_sound_samples/cries/*.wav` are exactly
   reachable by FRLG's DPCM (every in-block step is in gDeltaEncodingTable), so decoding the WAV gives the
   samples the GBA decompresses. The port needs no DPCM code.
4. **An offline renderer from the decomp's sources exists.** poryaaaa (MIT, C) builds with plain `cc` and
   renders a song from its MIDI file and voicegroup without a ROM. It rendered all 347 songs (intro plus one
   loop) in seconds: 54 minutes of music and 6 minutes of SEs, 21 MB + 2.3 MB as 48 kbps Opus.
5. **Cry lifetimes and fanfare tails, from the C.** How long `IsPokemonCryPlaying` holds for each cry mode on
   real species (section 2's table, from the cry template, SetPokemonCryPitch's key / tune split and the WAV
   lengths), and which fanfare songs outlive their `sFanfares` counter (section 1). Arithmetic, not a run of
   the engine: the engine's unit tests should pin the real numbers.

---

## 1. How the GBA does it

### What the decomp holds, and what only exists after a build

| Data | In the repo | Built by |
| --- | --- | --- |
| Songs (BGM, fanfares and SEs alike) | `sound/songs/midi/*.mid` (347 files, 1.9 MB) + `midi.cfg` (per-song flags). No `.s` song files are checked in (`sound/songs/` holds only `midi/`) | `audio_rules.mk` MID_RULE: `mid2agb <song>.mid <song>.s <flags>`, then `as` |
| Song table | `sound/song_table.inc` (347 `song name, player, player` entries + `dummy_song_header`) | assembled |
| Music players | `sound/music_player_table.inc`: BGM 10 tracks, SE1 3, SE2 9, SE3 1 | assembled |
| Voicegroups | `sound/voice_groups.inc` (8,073 lines, 77 voicegroups; macros in `asm/macros/music_voice.inc`) | assembled |
| Keysplit tables | `sound/keysplit_tables.inc` (labels offset back by the table's low key, see its header comment) | assembled |
| DirectSound samples | `sound/direct_sound_samples/*.wav` (89 instruments) and `cries/*.wav` (388), 4.5 MB in all | `wav2agb -b` (instruments), `wav2agb -b -c -l 1 --no-pad` (cries, DPCM-compressed) |
| Programmable wave samples | `sound/programmable_wave_samples/01-11.pcm` (16 bytes each: 32 4-bit samples) | `.incbin` |
| Cry tables | `sound/cry_tables.inc`: gCryTable and gCryTable_Reverse (`cry` / `cry_reverse` macros = `voice_directsound_compressed[_reverse] 60, 0, sample, 255, 0, 255, 0`) | assembled |
| Engine | `src/m4a.c` (1,781 lines), `src/m4a_1.s` (1,917 lines of ARM/Thumb: SoundMain, SoundMainRAM, MPlayMain, ply_*), `src/m4a_tables.c` (gClockTable, gScaleTable, gFreqTable, gCgbFreqTable, gNoiseTable, gDeltaEncodingTable, gPokemonCrySongTemplate), `include/gba/m4a_internal.h` | compiled |
| Game-side API | `src/sound.c` (649 lines: map music, fanfares, cries, PlaySE*) | compiled |

Every sample WAV is 8-bit mono PCM with a `smpl` chunk (loop start/end) and two custom chunks: `agbp` (the GBA
pitch: sample rate × 1024, e.g. 13379 × 1024 for most instruments, 10512 × 1024 for cries) and `agbl` (the
length). Rates vary (1672 to 53516 Hz). Python's `wave` module reads them; the extractor needs no new tool.

**midi.cfg flags** (399 lines; 52 of them name `ph_*` / `se_card` files that don't exist and are never built):
`-E` (exact gate time) on every song, `-G<n>` voicegroup (398), `-R<n>` reverb (348, `-R50` almost everywhere),
`-V<n>` master volume (221), `-P<n>` priority (328; SEs mostly 4-5, fanfares 5, BGMs 0-1). mid2agb's other
options (`-X` 48 clocks/beat, `-N` no compression) aren't used. mid2agb reads `[` / `]` text events as the loop
points and writes them as a GOTO.

### The engine (m4a / MP2K, "Sappy")

- **Init** (`m4aSoundInit`, m4a.c): `SoundInit`, then `m4aSoundMode(SOUND_MODE_DA_BIT_8 | SOUND_MODE_FREQ_13379 |
  12 << MASVOL | 5 << MAXCHN)`: an **8-bit DAC, 13,379 Hz mixing, master volume 12 of 15, at most 5 DirectSound
  channels** (of the 12 structs, `MAX_DIRECTSOUND_CHANNELS`). `SampleFreqSet` gives 224 PCM samples per VBlank
  (`gPcmSamplesPerVBlankTable`) at the 59.7275 Hz refresh. Then the four music players are opened
  (`MPlayOpen`) and two cry players (`MAX_POKEMON_CRIES = 2`, 2 tracks each).
- **Per frame** (main.c:406 `VBlankIntr` → `m4aSoundMain` → `SoundMain`, m4a_1.s:20-86), in this order:
  (1) the music players' sequencers, through the `MPlayMainHead` / `musicPlayerHead` chain (SoundMain_3); MPlayOpen
  (m4a.c:565) puts each newly opened player at the head, so they run newest first: cry player 1, cry player 0,
  SE3, SE2, SE1, BGM; (2) `CgbSound` for the four PSG channels (SoundMain_4); (3) `SoundMainRAM` (m4a_1.s:88,
  run from its RAM copy): the reverb pass over the buffer, then per DirectSound channel the envelope (attack /
  decay / sustain / release, once per frame), the pitch step, loop, reverse and DPCM playback
  (`SoundMainRAM_Unk2` decodes 64-sample blocks), mixed into the next 224-sample buffer with the master volume.
  `m4aSoundVSync` (the VCount interrupt) only restarts the DMA. The mix made in frame N plays during frame N+1.
  So a channel that ends in frame N's mix (its sample ran out or its release reached 0) is unlinked from its
  track by `MPlayMain` in frame N+1 (the ClearChain in MPlayMain's channel loop, m4a_1.s `_081DD8AE`), and
  `IsPokemonCryPlaying` turns FALSE one frame after the sound stopped.
- **Sequencer** (`MPlayMain`, m4a_1.s:1129): `FadeOutBody`, then `tempoC += tempoI`; while `tempoC >= 150`, one
  tick per track: count gate times down on its channels, read commands until a wait (running status for
  commands ≥ 0xBD; `ply_note` for 0xCF+; the jump table for 0xB1-0xCE: FINE, GOTO, PATT, PEND, REPT, MEMACC,
  PRIO, TEMPO, KEYSH, VOICE, VOL, PAN, BEND, BENDR, LFOS, LFODL, MOD, MODT, TUNE, XCMD, EOT), then the LFO. A
  `TEMPO n` byte sets `tempoD = 2n` BPM, `tempoI = tempoD * tempoU >> 8`; 150 BPM is one tick per frame, 24
  ticks to a beat. `MPlayStart` (m4a.c:611) starts a song on its player only if that player is free, paused, or
  playing a song of lower or equal priority (SE players; the BGM and SE3 players always restart).
- **Notes** (`ply_note`, m4a_1.s:1538): gate time from gClockTable plus the `-E` extra byte; the voice from the
  track's voicegroup (keysplit / rhythm voices resolve by key); then a channel: DirectSound voices take one of
  the 5 PCM channels, taking a free one or stealing by priority (ply_note's search); CGB voices take their fixed
  PSG channel (square 1, square 2, wave, noise), which BGM and SEs share, so **an SE on square 1 silences the
  BGM's square-1 part while it plays** (an audible GBA trait). `TrkVolPitSet` / `ChnVolSetAsm` turn track volume,
  pan, the fade's volX, bend and LFO into channel volumes and frequencies (`MidiKeyToFreq`, `MidiKeyToCgbFreq`).
- **Envelopes:** DirectSound ADSR runs once per frame in the mixer (attack/decay/sustain/release bytes from the
  voice); CGB channels use a per-frame software envelope in `CgbSound` (m4a.c:925) written to NRx2, with the
  `c15` counter. A track's channel is alive until its release ends or a non-looping sample runs out.
- **Voice types** (counts in voice_groups.inc): `voice_directsound` 423, `_no_resample` 81 (fixed-rate drums),
  `_reverse` 2, `voice_square_1` 6,692 (mostly filler entries) and `_alt` 122, `voice_square_2` 13 / `_alt` 95,
  `voice_programmable_wave` 2 / `_alt` 86, `voice_noise` 2 / `_alt` 101, `voice_keysplit` 161,
  `voice_keysplit_all` 61 (rhythm sets). Cries use the compressed DirectSound type.
- **Controls the game calls** (m4a.c): `m4aSongNumStart/Stop`, `m4aMPlayStop` (pause: tracks stop, position kept),
  `m4aMPlayContinue`, `m4aMPlayAllStop`, `m4aMPlayFadeOut` / `FadeOutTemporarily` / `FadeIn` (16 steps of 4/64
  volume, one step every `speed` frames: `FadeOutBody`), `m4aMPlayImmInit`, `m4aMPlayVolumeControl`,
  `m4aMPlayPanpotControl`, `m4aMPlayTempoControl` and `m4aMPlayPitchControl` (both unused in FRLG).
- **Stereo:** `SetPokemonCryStereo` (m4a.c:1758) is the options menu's SOUND setting: mono routes both DMA
  channels to both speakers at half volume and sets `soundInfo->mode` bit 0 (the mixer then writes mono).
  Called from option_menu.c:519, title_screen.c:742, reset_save_heap.c:24, intro.c:1009. The default is mono.

### Cries

`PlayCryInternal` (sound.c) sets up a 1-2 track song from `gPokemonCrySongTemplate` (m4a_tables.c:259: VOICE 0,
VOL, XCMD 0x0D progress, xRELE release, PAN, TIE key 60, xWAIT length, EOT, FINE) through `SetPokemonCryVolume /
Panpot / Pitch / Length / Release / Chorus / Priority` and starts it on a free cry player (`SetPokemonCryTone`,
m4a.c:1660). The mode table (CRY_MODE_NORMAL, DOUBLES, ENCOUNTER, HIGH_PITCH, ECHO_START/END, FAINT, ROAR_1/2,
GROWL_1/2, WEAK, WEAK_DOUBLES) sets length (default 140 frames), reverse, release, pitch (default 15360), chorus
(a second detuned track) and volume. `IsPokemonCryPlaying` (m4a.c:1735) is true while the cry track's first
channel is still linked to it (`track->chan && track->chan->track == track`). The link goes at the first of:
**FINE** (`ply_fine`, m4a_1.s:750, unlinks every channel with RealClearChain at once, so the release tail that
still sounds does *not* count), reached `length` ticks after the TIE (`ply_xwait` waits one tick per loop until
its timer reaches `length`; the cry song runs at the default tempo, one tick per frame); or **the sample running
out** (the mixer stops the channel; MPlayMain unlinks it the next frame). So cry waits depend on the sequencer
*and* the mixer's sample position, but not on the release. Section 2 has the numbers. `PlayCry_Normal` / `_ByMode` / `_Script` duck the BGM to
volume 85 and `Task_DuckBGMForPokemonCry` restores 256 once the cry stops (`IsCryFinished` = that task is gone).
Cries are the compressed (DPCM) voice type in FRLG; spike 3 shows the WAVs decode to exactly those samples.

### sound.c: the layer the game calls

- **Map music** (sound.c:60-190): `sCurrentMapMusic`, `sNextMapMusic`, `sMapMusicState` and `MapMusicMain`, run
  once per frame from AgbMain (main.c:215). `PlayNewMapMusic`, `StopMapMusic`, `FadeOutMapMusic`,
  `FadeOutAndPlayNewMapMusic`, `FadeOutAndFadeInNewMapMusic`, `IsNotWaitingForBGMStop` (states 5-7 wait for
  `IsBGMStopped` and the fanfare task).
- **Fanfares** play on the **SE2** player (all 18 fanfare songs are `song mus_..., 2, 2`), not the BGM one:
  `PlayFanfareByFanfareNum` pauses the BGM (`m4aMPlayStop`), sets `sFanfareCounter` from `sFanfares`' fixed
  duration (MUS_LEVEL_UP 80 frames ... MUS_POKE_FLUTE 450) and starts the song; `Task_Fanfare` counts it down and
  resumes the BGM (`m4aMPlayContinue`); `WaitFanfare` does the same counting for callers without the task.
  **Fanfare waits are frame counters, not the song's length** (spike 2). When the counter ends, only the BGM is
  resumed: the fanfare song is not stopped and plays on over the BGM until its FINE. Five fanfare songs outlive
  their counter (model frames to FINE / sFanfares): MUS_EVOLVED 229 / 220, MUS_SLOTS_JACKPOT 262 / 250,
  MUS_SLOTS_WIN 151 / 150, MUS_DEX_RATING 200 / 196 (a few frames of tail over the resumed BGM), and
  **MUS_POKE_FLUTE 3,061 / 450**: its last note starts at frame 316, then both tracks hold 14 empty bars
  (`W96` × 14 before FINE) at TEMPO 40 (80 BPM, 0.53 ticks a frame). The 450-frame counter covers the melody;
  the silent tail keeps SE2 "playing" (IsSEPlaying TRUE) for ~2,600 more frames until another SE2 song of
  priority ≥ 5 replaces it (MPlayStart's rule), which in practice is the SE_SELECT (`-P5`) of the next text box's
  A press. Its callers wait only on the counter (item_use.c:389 Task_PlayPokeFlute → WaitFanfare(FALSE);
  EventScript_AwakenSnorlax in data/scripts/static_pokemon.inc: `playfanfare` + `waitfanfare`), so nothing hangs,
  but a `waitse` right after the flute would wait for the tail. The port must keep this (don't stop fanfares
  early).
- **SEs:** `PlaySE` (skipped during quest log playback or while `gDisableMapMusicChangeOnMapLoad`),
  `PlaySE12WithPanning`, `PlaySE1/2WithPanning`, `SE12PanpotControl`, `IsSEPlaying` (SE1 or SE2 has a live track,
  so it is TRUE during a fanfare too), `IsSpecialSEPlaying` (SE3: rain, thunderstorm, downpour, low HP).
- **BGM:** `PlayBGM`, `FadeInBGM`, `FadeOutBGM`, `FadeOutBGMTemporarily`, `IsBGMPlaying`, `IsBGMStopped`,
  `IsBGMPausedOrStopped`, `SetBGMVolume_SuppressHelpSystemReduction` / `BGMVolumeMax_EnableHelpSystemReduction`
  (the help system halves the BGM).
- **Players and priorities:** BGM (player 0: 74 songs), SE1 (209 SEs: doors, battle anim SEs, ...), SE2 (39 SEs
  such as SE_SELECT, plus the 18 fanfares), SE3 (7: rain, downpour, thunderstorm and their stops, SE_LOW_HEALTH).

### Map music (overworld.c:989-1200)

The map header's `music` (in the extracted map JSON already: `"music": "MUS_PALLET"`), overridden by
`gSaveBlock1Ptr->savedMusic` (set by `savebgm`, the bike, `ForcePlayerOntoBike` on Cycling Road; **saved in the
save file**) or MUS_SURF while surfing (`Overworld_MusicCanOverrideMapMusic`: not on Victory Road, Route 23, the
Indigo Plateau). `Overworld_PlaySpecialMapMusic` on map load (22 callers), `TryFadeOutOldMapMusic` before a warp
(fade speed 2 indoors, 4 outdoors: 32 or 64 frames), `Overworld_TryMapConnectionMusicTransition` on connections,
`gDisableMapMusicChangeOnMapLoad` (MUSIC_DISABLE_OFF / STOP / KEEP: the Hall of Fame and the credits).

---

## 2. Every place the game needs audio

### Call counts (decomp `src/*.c`, without sound.c and m4a.c) and the port today

| API | Decomp calls (files) | Port today |
| --- | --- | --- |
| PlaySE | 686 (88) | stub, called 334 times in 51 files: the GBA-layer screens kept their calls (party menu 58, storage 52+7, bag 24, summary 22, ...). The field (`world/`, `entities/`) and some scenes dropped theirs for a comment; the battle goes through `ui.playSE` (a no-op in BattleScene.ts:225). Appendix A has the file-by-file gaps |
| PlaySE12WithPanning / 1 / 2, SE12PanpotControl | 49 (20) / 3 / 2, 2 | 36 calls in 13 anim files to `battle/anim/battleAnim.ts`'s PlaySE12WithPanning → `ui.playSE`, panning dropped |
| PlayBGM / PlayNewMapMusic / Overworld_PlaySpecialMapMusic | 21 (12) / 20 (10) / 22 (9) | stub / missing / missing (comments) |
| Overworld_ChangeMusicTo(Default), FadeOutAndPlayNewMapMusic, FadeOutAndFadeInNewMapMusic | 6, 6, 2 | missing |
| FadeOutMapMusic / FadeOutBGM / FadeInBGM / FadeOutBGMTemporarily | 11 / 4 / 3 / 2 | stubs (title screen only) / comments |
| StopMapMusic / BGMusicStopped / IsNotWaitingForBGMStop | 18 / 12 / 3 | missing / missing / stub (TRUE) |
| PlayFanfare / PlayFanfareByFanfareNum / WaitFanfare / IsFanfareTaskInactive | 24 (19) / 5 / 6 / 16 (12) | stubs called 7 / 3 / 4 / 8 times; IsFanfareTaskInactive and WaitFanfare always TRUE |
| PlayCry_Normal / _ByMode / _Script / _NormalNoDucking / _ReleaseDouble | 21 / 16 / 2 / 7 / 4 | stubs called 8 / 7 / 0 / 4 / 0 times; battle's `ui.playCry` no-op |
| IsCryFinished / IsCryPlaying / IsCryPlayingOrClearCrySongs / StopCryAndClearCrySongs | 11 / 4 / 12 / 7 | stubs called 6 / 3 / 1 / 2 times: finished at once |
| IsSEPlaying / IsBGMPlaying / IsBGMStopped / IsSpecialSEPlaying | 34 (11) / 1 / 1 / 1 | stub (FALSE) called 12 times in 6 files / missing |
| m4aSongNumStart / Stop, m4aMPlayStop / Continue / AllStop, m4aMPlayVolumeControl | 2 / 15, 18 / 4 / 11, 16 | `m4aSongNumStart` stub; others missing |
| SetPokemonCryStereo | 4 | comment in `menus/optionMenu.ts:403` |

Script commands (event scripts, `data/maps` + `data/scripts`): `playse` 109, `waitse` 89, `playbgm` 51, `savebgm`
6, `fadedefaultbgm` 23, `fadenewbgm` 1, `fadeoutbgm` 2, `fadeinbgm` 1, `playfanfare` 56, `waitfanfare` 57,
`playmoncry` 40, `waitmoncry` 40. All twelve are empty functions in `script/ScriptEngine.ts:1295-1307`. Specials:
`PlayTrainerEncounterMusic` (7 scripts) and `Script_FadeOutMapMusic` (2) are in `NO_OP` (`script/specials.ts:64`),
`LoopWingFlapSound` (Navel Rock's summit, 3 uses) is in `tests/unit/scriptCoverageGaps.ts` as postgame.
Battle scripts: `playse` 5, `fanfare` 3, `playfaintcry` 2 (`bsCommands1/2.ts` emit them to the controllers,
whose CONTROLLER_PLAYSE / PLAYBGM / PLAYFANFARE handlers end in `ui.*` no-ops). Battle anim scripts:
`playsewithpan` 894, `loopsewithpan` 98, `waitplaysewithpan` 52, `panse` 20, `createsoundtask` 8, `waitsound` 6
(the anim engine runs them all; the sound tasks in `battle/anim/soundTasks.ts` keep their timing).
Text: the printer's A/B press plays SE_SELECT (text.c:563, 581), and the control codes `PLAY_BGM` (23 uses),
`PLAY_SE` (11), `WAIT_SE` (5), `PAUSE_MUSIC` / `RESUME_MUSIC` (4 each): `text/TextPrinter.ts:283-288` skips them
("TODO: audio").

### By caller

- **Field.** No footstep sounds in FRLG. field_player_avatar.c (11 PlaySE: SE_LEDGE, SE_WALL_HIT bumps, SE_BIKE_HOP,
  SE_M_STRENGTH, SE_WARP_IN), field_control_avatar.c (SE_WIN_OPEN, SE_SELECT on talking/signs, SE_FALL,
  SE_M_DIVE), doors (`GetDoorSoundEffect`, field_door.c:513: SE_DOOR / SE_SLIDING_DOOR; `opendoor` via
  scrcmd.c:2126), warps (field_fadetransition.c: SE_EXIT, the 8 PlaySE there), field_effect.c (16: Fly, Dig,
  Teleport, the show-mon cry, the warp spin), puddles, the bike bell, elevators, the PC (SE_PC_ON / _LOGIN / _OFF),
  the item finder, VS Seeker, weather loops (SE_RAIN etc. on SE3; `PlayRainStoppingSoundEffect`, 15 calls).
- **Map music and transitions.** As above: map load, warps (with the BGM fade-out wait), connections (fade
  speed 8 or a crossfade), bike (bike.c:321-329, savedMusic), surf (field_effect.c:2987), Cycling Road
  (`ForcePlayerOntoBike`), scripts' `playbgm` / `fadedefaultbgm` (rival and Oak scenes), trainer encounter music
  (`PlayTrainerEncounterMusic`, battle_setup.c:1020-1033: MUS_ENCOUNTER_GIRL / BOY / ROCKET / ...).
- **Battle.** The transition starts the battle music (`CreateBattleStartTask(transition, song)`, battle_setup.c:
  MUS_VS_LEGEND, MUS_VS_MEWTWO, MUS_RS_VS_TRAINER, ...; the default from the trainer class), victory music
  (MUS_VICTORY_WILD / _TRAINER / _GYM_LEADER, `bsCommands2.ts:139` and `battle/main.ts:1251` note it), the
  low HP beep (SE_LOW_HEALTH on SE3: battle_gfx_sfx_util.c:820-834, stopped by `BattleStopLowHpSound`), cries on
  send-out / intro / faint (CRY_MODE_ENCOUNTER, _FAINT, _DOUBLES), the controllers' 32 PlaySE in
  battle_controller_player.c (menus, the exp bar's SE_EXP, ball sounds), pokeball.c (10), the anim SEs and sound
  tasks, the level-up fanfare (MUS_LEVEL_UP), the caught jingle (MUS_CAUGHT_INTRO / MUS_CAUGHT).
- **Menus.** menu.c (32), party_menu.c (68), the PC (pokemon_storage_system_tasks.c 52, item_pc.c 15,
  player_pc.c 10), item_menu.c (37), summary (22), Pokédex (6 plus cries and BGM volume), region map (14), TM case
  (11), berry pouch (14), shop (8), start menu (7), trainer card (6), slot machine (6 + fanfares), the save dialog
  (SE_SAVE).
- **Scenes.** Title screen (MUS_TITLE, the Charizard cry), Oak's speech (MUS_NEW_GAME_*, the Nidoran cry),
  evolution (MUS_EVOLUTION_INTRO, MUS_EVOLUTION, MUS_EVOLVED, cries, SE_EXP / sparkles), egg hatching, trades
  (MUS_EVOLUTION, cries, SEs), Hall of Fame (MUS_HALL_OF_FAME, cries, SE_APPLAUSE), credits (MUS_CREDITS, the
  cries with `PlayCry_NormalNoDucking`, credits.c:1203), the Seagallop ferry (SE_SHIP), the S.S. Anne (SE horn).

### Where game logic waits on audio

These are the timings audio changes. The port times them all as "finished at once" today except where a local
counter stands in.

| Wait | What it depends on on the GBA | Decomp callers | Port today |
| --- | --- | --- | --- |
| `waitfanfare`, IsFanfareTaskInactive, WaitFanfare | `sFanfareCounter`: a **fixed frame count** per fanfare (sFanfares) | scrcmd.c, learn_move.c, battle_script_commands.c (level up), daycare.c (2), evolution_scene.c (2), slot_machine.c (3: the payout), field_effect.c, party_menu.c, item_use.c, diploma.c, pokemon_special_anim.c | always done, so scripts' item / badge / heal fanfares don't hold the message; `menus/eggHatch.ts:494` keeps its own 220-frame counter; the slot payout and the relearner don't wait (DEVIATIONS) |
| `waitse`, IsSEPlaying | the SE1 / SE2 players' tracks (the sequencer), incl. a fanfare on SE2 | scrcmd.c:891, evolution_scene.c (21), start_menu.c:829 (save), item_use.c, trainer_card.c, battle_anim.c (479: the 90-frame SE wait at the end of an anim, 1533), battle_gfx_sfx_util.c:297, text.c (WAIT_SE), field_weather_effects.c | FALSE: `waitse` doesn't hold scripts; `evolutionScene.ts:544` goes on where the C would wait for SE_EXP |
| `waitmoncry`, IsCryFinished, IsCryPlaying(OrClearCrySongs) | the cry track's channel link: until FINE after `length` ticks, or the sample's end (not the release): sequencer + mixer state. Numbers below | scrcmd.c:2097, evolution_scene.c (6), trade_scene.c (2), daycare.c, oak_speech.c, battle_anim_sound_tasks.c (4), the battle controllers (8: the opponent's intro cry before the battle starts), hall_of_fame.c (2), pokeball.c, pokemon_summary_screen.c | finished at once: battle intros, the Hall of Fame and evolutions go faster than on the GBA |
| BGMusicStopped, IsNotWaitingForBGMStop | the BGM fade-out (16 × speed frames) and MapMusicMain's states 5-7 | field_fadetransition.c (5 warp tasks: `!WaitWarpFadeOutScreen() && BGMusicStopped()`), field_effect.c (5: Fly, Dig, Teleport, Escape Rope), field_screen_effect.c, seagallop.c, overworld.c, title_screen.c, pokemon_jump.c | not checked: warps wait only for the palette fade. On the GBA a warp into a map with other music waits 32 frames (indoors) or 64 (outdoors) for the music |
| IsBGMStopped / IsBGMPlaying | the BGM player | trade_scene.c, pokeball.c | not ported |
| IsSpecialSEPlaying | SE3 | field_weather.c (rain stopping) | not ported |

**How long a cry holds a wait.** From section 1: the cry is a TIE at key 60 plus the mode's pitch, held for
`length` ticks (one a frame), so it is "playing" for min(length + 1, 1 + sample frames) frames after the call,
where sample frames = sample length / (176 × 2^(pitch / 12)): the cry WAVs are 10,512 Hz and the mixer takes
224 × 10512 / 13379 = 176 source samples a frame at the base key. `PlayCryInternal`'s pitches decode (through
SetPokemonCryPitch's key / tune split and TrkVolPitSet's `tune * 4`) to key 60 (NORMAL, DOUBLES), 60.875
(ENCOUNTER), 56.8125 (FAINT), 61.4375 (HIGH_PITCH). IsCryFinished turns TRUE about a frame later
(Task_DuckBGMForPokemonCry first waits 2 frames, then polls). Estimates in frames (±1-2: the start frame and the
frame order aren't modelled exactly):

| Species (cry samples) | NORMAL (length 140) | ENCOUNTER (140) | FAINT (140) | HIGH_PITCH (50) | DOUBLES (20) |
| --- | --- | --- | --- | --- | --- |
| Pidgey (1,902, the shortest) | 12 | 12 | 14 | 11 | 12 |
| Nidoran♀ (4,775) | 29 | 27 | 34 | 26 | 21 |
| Bulbasaur (8,183) | 48 | 46 | 57 | 44 | 21 |
| Pikachu (8,233) | 48 | 46 | 58 | 45 | 21 |
| Charizard (9,539) | 56 | 53 | 67 | 51 | 21 |
| Onix (12,257) | 71 | 68 | 85 | 51 | 21 |
| Mew (15,064) | 87 | 83 | 104 | 51 | 21 |
| Jynx (23,524, the longest) | 135 | 129 | 141 | 51 | 21 |

The median cry (Magmar, 7,655 samples) is ~45 frames. So a wild battle's intro (the opponent's ENCOUNTER cry,
which battle_controller_opponent.c waits for with IsCryPlayingOrClearCrySongs) gains ~0.5-2 s on the GBA over
the port today, a faint gains 1-2 s per fainted mon, and an evolution's two cries ~1-3 s.

Timings that don't depend on audio and stay as they are: the credits (frame counters; the music only runs
alongside), the title screen's cry scene (90 frames), the Hall of Fame's per-mon timers.

### docs/DEVIATIONS.md entries that wait on audio

Pokémon Center nurse (SE_BALL, MUS_HEAL); the S.S. Anne's departure; in-game trades ("silent"); Lt. Surge's trash
cans and Bill's cell separator; side specials (Daisy's MUS_HEAL, the diploma's fanfare); fall warps; Easy Chat
(SE_SELECT); the Seagallop ferry (incl. its BGMusicStopped wait); VS Seeker; Itemfinder; "Battles: no audio";
"Field sounds" (doors, puddles); the evolution scene; the move relearner (IsFanfareTaskInactive); region map /
Fly; field moves; TM case; berry pouch; battle transitions (SE_MUGSHOT, battle music); Flash; scripted wild
battles (battle music); player avatar (bump, ledge, spinner, bike bell, Strength, fall; Cycling Road and surf
music); Surf and Waterfall (MUS_SURF, Overworld_ClearSavedMusic); Poké Mart (SE_SHOP); egg hatching (the local
fanfare counter); Safari Zone entrance; Pokémon Storage System; the main menu (SE_SELECT); the title screen
(MUS_TITLE, the cry); Oak's speech; the save dialog; the option menu (SetPokemonCryStereo); elevators; field
ListMenu; Hall of Fame; Pokédex screen (incl. the BGM volume calls); trainer card; credits; no-op specials
(PlayTrainerEncounterMusic, Script_FadeOutMapMusic); `showmonpic` (no cry); Oak's Pokédex rating (MUS_DEX_RATING
/ MUS_EVOLVED); the slot machine (IsFanfareTaskInactive, the payout). About 40 entries: each call-site unit
below removes the ones it fixes.

---

## 3. How to bring it into the port

### Tools that exist

| Tool | License | Input | Fit |
| --- | --- | --- | --- |
| **mid2agb** (decomp `tools/mid2agb`, YamaArashi) | MIT | `.mid` + flags | Exactly what the ROM is built from. Spiked: builds with `c++`, converts all 347 songs |
| **wav2agb** (decomp `tools/wav2agb`, ipatix) | MIT | `.wav` | Not needed: the WAVs carry everything (spike 3) |
| **poryaaaa** (github.com/huderlem/poryaaaa) | MIT | the decomp's sources: MIDI + voicegroups + WAVs, **no ROM** | A C re-implementation of the m4a mixer (SoundMainRAM, CGB channels, reverb) and a voicegroup loader for pokefirered. Its sequencer plays MIDI events, not mid2agb's bytes. Spiked: `cc` builds `poryaaaa_render` (5 C files); it rendered every song. Good reference code and a dev-only comparison oracle |
| **agbplay** (github.com/ipatix/agbplay) | LGPL-3.0 | a **ROM** | The reference MP2K player (C++), exports WAV. Needs a built ROM, which needs `arm-none-eabi` + agbcc (not installed here) or the user's own dump |
| **VGMusicStudio** (Kermalis) | LGPL-3.0 | a ROM | C#, Windows-first; same ROM problem |
| mGBA recording | MPL-2.0 | a ROM | The ground truth for comparisons: the user has a ROM (decision 13); W-ref 1 uses it |

**Which decomp tools `npm run extract` builds** (decision 9): only **mid2agb**. The song pipeline's other steps:

- **`.s` → bytes:** the decomp assembles mid2agb's output with `arm-none-eabi-as` (binutils from devkitARM),
  which isn't in the decomp's `tools/` and is far too big to build during extract. mid2agb's `.s` uses a tiny
  subset (labels, `.byte`, `.word`, `.equ` / `.set`, `.include "MPlayDef.s"`, `.global` / `.section` / `.align`),
  so a Python assembler (~80 lines in spike 2, which assembled all 347 songs) stays.
- **wav2agb** (decomp `tools/wav2agb`, C++): could be built the same way, but nothing needs it: the WAVs carry
  the rate, loop and length (`agbp`, `smpl`, `agbl`) and the instruments' bytes are the PCM as is; for the cries
  it would only produce the DPCM-compressed bytes the port doesn't need (spike 3). Not built.
- **aif2pcm:** pokefirered has no such tool (its samples are WAVs).
- **The voicegroup / keysplit / cry table `.inc` files** go through assembler macros (`asm/macros/music_voice.inc`);
  no decomp tool reads them, so the Python parser stays (W-audiodata 2).

### (a) Port the m4a engine (sequencer + mixer) and run it live

The extractor writes the songs as the ROM has them (mid2agb's bytes), the voicegroups, the keysplit tables and
the samples; the port runs a TypeScript port of m4a.c / m4a_1.s.

- **Fidelity:** the highest possible: the same bytes through the same engine, incl. channel stealing between BGM
  and SEs, the 5-channel limit, CGB channel sharing, the 13,379 Hz 8-bit mix and its reverb. Bit-exact PCM is
  reachable for the DirectSound part; the PSG part is an emulation (as in any emulator).
- **Runtime control:** everything the C calls works as on the GBA (pause/continue for fanfares, fades, BGM volume
  ducking, SE panning, cry pitch / length / reverse / chorus), because it *is* the C's logic.
- **Waits:** exact, and independent of whether sound is output.
- **Size of public/gen:** ~0.3 MB of song bytes + ~4.5 MB of 8-bit samples + a voicegroup JSON.
- **CPU:** small: per frame, ≤ 15 tracks across the players, ≤ 5 PCM channels × 224 samples, 4 PSG channels.
- **Looping:** free (GOTO in the song).
- **Effort:** the largest code effort: ~2,500 lines of TS for the engine (m4a.c 1,781 + the ~1,900 lines of
  assembly, much of it register shuffling). The songs cost little: the decomp's mid2agb is built and run during
  extract (decision 9).
- **CLAUDE.md fit:** good: data through the extractor, constants (song ids, CRY_MODE_*, FANFARE_*) already in
  `scripts.json`, the engine ticks in GBA frames. New setup requirement: a C++ compiler for mid2agb (README).

### (b) Pre-render songs and SEs to audio files at extract time

The extractor runs a renderer (poryaaaa is the only one that works from the decomp's sources) and encodes Opus /
AAC; the port plays them with Web Audio buffers.

- **Fidelity:** lower: MIDI-driven, not mid2agb's bytes; no channel stealing between BGM and SEs, no CGB channel
  sharing; each song rendered alone.
- **Runtime control:** volume, fades and pan via GainNode / StereoPannerNode are easy; pause / resume needs
  offset bookkeeping; **cries can't be pre-rendered usefully** (388 samples × 12 modes × pitch), so a cry synth is
  needed anyway.
- **Waits:** the files know nothing of the GBA's player rules, so IsSEPlaying / BGMusicStopped / the fade times
  need a model of the four players (song lengths, priorities, fades) next to them: half of option (a)'s logic.
- **Size:** spike 4: 21 MB of BGM (intro + one loop) + 2.3 MB of SEs at 48 kbps Opus; 600 MB as WAV.
- **Looping:** the loop points must come from the sequencer (MIDI `[` `]`), and lossy encoders pad and prime, so
  sample-accurate loops need decoded buffers with `loopStart` / `loopEnd` and care.
- **Effort:** less engine code, but a C build (poryaaaa) and ffmpeg in `npm run extract`, a cry synth and a player
  model in TS.
- **CLAUDE.md fit:** acceptable (generated into public/gen), but the extractor would need a C compiler and ffmpeg
  where today it needs only Python and Pillow.

### (c) Hybrids

- **Sequencer live, samples as PCM** is option (a): the samples are PCM already.
- **Sequencer on the main thread, mixer in an AudioWorklet** (the worklet holds the samples and mixes from per-frame
  channel snapshots): it frees the main thread of the mix, but the main thread still has to track each channel's
  sample position and envelope (cry and SE waits depend on them), so the mixer's bookkeeping would run twice.
- **Pre-rendered BGM, live SEs and cries:** keeps the 21 MB and the loop / pause problems, and loses BGM-SE
  channel interplay, for little saving: the engine is needed for the SEs and cries anyway.

### Recommendation: (a), with the output split off

1. **The engine runs on the main thread, once per 60 Hz tick, always.** `m4aSoundMain` does what SoundMain does:
   `MPlayMain` for the four music players and the two cry players, `CgbSound`, and the mixer's per-channel
   bookkeeping (envelopes, sample positions, loop / end). With output on, the mixer also writes the frame's 224
   stereo samples; with output off (headless tests, before the first key press, `?speed=` > 1) it skips the
   sample arithmetic and only advances positions, which is all the waits need.
2. **The output is a thin AudioWorklet**: each frame the main thread posts the 224-sample DirectSound block and the
   frame's PSG register state (a transferable buffer on a MessagePort; no SharedArrayBuffer, so no COOP/COEP
   headers). The worklet upsamples the PCM (sample-and-hold, like the GBA's DMA: decision 8),
   synthesizes the four PSG channels at the output rate from the registers (this is where the hardware envelope
   and the noise LFSR live), mixes and writes. A few frames of buffering absorb timer jitter; an underrun plays
   silence.
3. **The data comes from the decomp's sources through the extractor**: the decomp's own mid2agb, built with the
   system C++ compiler during `npm run extract` and run with each song's `midi.cfg` flags (spike 1: it builds in
   seconds), a small Python assembler for its `.s` output, the voicegroups / keysplits / cry tables parsed from the
   `.inc` files in Python, the WAVs read as they are (cries included).
4. **poryaaaa is the reference** for the mixer and PSG details (MIT: code may be adapted with its notice) and its
   renderer is a dev-only comparison tool; it is not part of `npm run extract`.

Why: it is the only option where the waits in section 2 are right by construction, where every m4a call the C makes
has a real meaning, and where the extractor needs only a C++ compiler on top of Python. Its cost is engine code, which this project
writes routinely (the battle engine, the anim engine and the PPU are the same kind of port).

---

## 4. Integration

### Where it lives

- `src/audio/m4a.ts` (+ `m4aTables.ts`, `m4aMixer.ts`, `m4aCgb.ts`): the engine, named as the C: `m4aSoundInit`,
  `m4aSoundMain`, `m4aSongNumStart/Stop`, `MPlayStart`, `m4aMPlayStop/Continue/AllStop/FadeOut/FadeIn/
  FadeOutTemporarily/ImmInit/VolumeControl/PanpotControl/TempoControl/PitchControl`, `gMPlayInfo_BGM/SE1/SE2/SE3`,
  `SetPokemonCryTone`, `SetPokemonCry*`, `IsPokemonCryPlaying`, `SetPokemonCryStereo`. Pure logic, no DOM: unit
  tests import it directly.
- `src/audio/output.ts` + `src/audio/worklet.ts`: the AudioContext, the worklet, resume on input, visibility.
- `src/gba/sound.ts`: becomes the port of sound.c (every function in it, with the C's names; the stubs' callers
  keep compiling). It is the one API the game calls.
- `tools/extract_audio.py` (songs: builds and runs mid2agb, assembles) and `tools/extract_audio_voices.py`
  (voicegroups, samples) → `public/gen/audio/`: `songs.json` (per song: name, id, player, priority, reverb,
  voicegroup, track offsets; the bytes base64 or in `songs.bin`), `voicegroups.json` (voices with their type
  byte, key, pan / length, ADSR, sample or CGB parameters, keysplit table; references as names), `samples.json`
  (per sample: rate × 1024, loop flag, loop start, size, offset) + `samples.bin` (int8 PCM), `waves.json` (the 11
  programmable waves), cry table indices. Constants (song ids, CRY_MODE_*, FANFARE_*, SOUND_PAN_*) come from the
  existing `scripts.json` numbers.
- Loading: songs, voicegroups and sample *headers* are small and load at boot (the logic needs the headers to time
  cries and SEs). `samples.bin` (~4.5 MB) loads in the background and is only needed once output starts.

### The tick

The GBA runs `MapMusicMain` at the end of each AgbMain iteration (main.c:215) and `m4aSoundMain` in VBlank
(main.c:406). The port's frame is ticked by two hosts, never both at once (the field sleeps while a GbaHostScene
runs): `OverworldScene.tick` (OverworldScene.ts:580) and `GbaHostScene.update` (GbaHostScene.ts:50). Both
already call `PlayTimeCounter_Update` per frame; a shared `AgbMainFrameEnd()` (in `gba/main.ts` or
`audio/frame.ts`) called from both does `MapMusicMain(); m4aSoundMain();`, unconditionally (GbaHostScene calls
PlayTimeCounter only with a play time). Tasks: `Task_Fanfare` and `Task_DuckBGMForPokemonCry` are gTasks in C;
the field only runs `RunTasks` while its GBA layer is up (`world/fieldGbaScreen.ts:256`), so a fanfare started
by a field script would never finish. Either run them from `AgbMainFrameEnd` as "sound tasks" with `FuncIsActiveTask`
semantics kept in sound.ts, or make the field run RunTasks every frame (a bigger change). The plan takes the
first (decision 5).

### The browser

- **Autoplay:** create the AudioContext at boot (suspended) and `resume()` it on the first keydown / pointerdown
  (`input/Input.ts` already listens). The engine runs from boot, so the output joins mid-song, as if unmuted.
- **Tab hidden:** Phaser stops the frame loop, so no frames reach the worklet: suspend the context on
  `visibilitychange` and resume when visible, so it doesn't buzz on an underrun.
- **`?speed=` > 1 and headless:** output off (the engine still runs). A `?audio=0/1` dev flag forces it.
- **`battle-test.html`** gets audio too (decision 12): its boot loads the audio data, BattleScene's frame runs
  the sound hook, and the output starts on the first key press as in the game.
- **Phaser's sound system:** not used (it plays decoded buffers; it has no synth). Set `audio: { noAudio: true }`
  in `main.ts` so Phaser doesn't open a second AudioContext.
- **Options:** SOUND (`state.optionsSound`, saved since save version 3, `state/saveData.ts:94`) calls
  `SetPokemonCryStereo` where the C does (option_menu.c:519 on exit, title_screen.c:742 and reset_save_heap.c:24
  on load), which switches the mixer's mono bit and the output routing.
- **Save state:** `gSaveBlock1Ptr->savedMusic` (global.h:767) must be saved: it holds MUS_CYCLING on the bike and
  `savebgm` songs, and CONTINUE plays it (`Overworld_PlaySpecialMapMusic`). One field and a save version bump.
  Nothing else in the audio state is saved (the GBA saves no player state).
- **Volume:** the GBA has none. **M toggles all output on and off** (decision 10): a deliberate QOL change,
  logged in docs/DEVIATIONS.md "Deliberate QOL changes" by the unit that adds it (W-out 1). M is free: the game
  uses Z, Space, X, Enter, Backspace, A, S and the arrows, and the dev HUD uses the backtick. It mutes the output
  only (the engine runs on, so nothing times differently); the choice is remembered in `localStorage` (not in the
  save), and the battle test panel's text fields keep their own key presses.

---

## 5. Testing

- **Unit (Vitest, Node):** the song bytes are mid2agb's own output, so no differential check is needed; the
  extractor fails loudly on any song that doesn't assemble, and a unit test on `songs.json` checks the song and
  music player tables (347 songs, their players and priorities, every track offset inside its song, every song
  ending in FINE or a GOTO); the TS side: the sequencer on the extracted songs (lengths in frames
  of the fanfares and a set of SEs pinned in a table, e.g. SE_SELECT 10, MUS_LEVEL_UP 63, from the spike's model and
  then from the engine), MPlayStart's priority rule, pause / continue, FadeOutBody's 16 × speed frames, the cry
  modes' channel lifetimes, keysplit voice resolution, the mixer's output for a single note against a hand-computed
  block, the DPCM-free cry samples.
- **E2E (headless, output off):** a recording hook `__test.audioEvents(since)` (dev-only, in `dev/testHooks.ts`):
  `{frame, type: 'se' | 'bgm' | 'fanfare' | 'cry' | 'stop' | 'fade', id, name, player, pan}` for every
  `m4aSongNumStart`-level start, plus `__test.audio()` for the players' state (song, playing, paused, volume) and
  the cry players. Scenarios (`tests/e2e/audio.test.ts` and in the call-site units' own files): walking into a
  door plays SE_DOOR and the new map's music starts after the BGM fade (the warp now waits ~64 frames); an item
  ball's MUS_OBTAIN_ITEM holds the message 160 frames and the BGM resumes; `waitse` holds a script until the SE
  ends; a trainer's encounter music, the battle music, the victory music; a wild battle's encounter cry holds the
  intro; bike music on and off, saved and continued; surf music.
- **Existing tests:** once the engine is in, every wait in section 2 gets longer (warps, cries, SE waits): the
  GBA's timing, which the user wants (decision 11). E2E tests wait on state, not time (tests/README.md rule 3), so
  they should pass, but each unit that lengthens a wait runs the full suite once and raises the tick budgets that
  were sized for the instant waits (in the same PR, saying which and why).
- **Against the GBA:** (1) poryaaaa_render as a dev-only oracle: render a song from the decomp sources, render the
  same song with the port's engine in Node, compare loudness envelopes and note onsets (not bit-exact: poryaaaa
  plays MIDI, not mid2agb's bytes). (2) The user's ROM in mGBA is the ground truth for a few listening checks and
  for cry / SE / song timings: W-ref 1 (decision 13). (3) The fanfare / SE length table
  doubles as a regression check.

---

## 6. The work split

Units follow docs/WORKFLOW.md section 1: about an hour for a fresh worker (roughly 1,000-1,500 lines of C ported
plus tests and docs), each leaving the branch green. One PR per unit (SIDE_PLAN.md decision 1). Sizes below are
`wc -l` of the C / assembly / C++ each unit ports; ARM assembly is about three lines to one of C, so
"asm" lines count for a third. The JSON shapes in section 4 are fixed here, so the engine and the extractor start
in parallel: the engine's first unit tests on hand-written song bytes.

The user's answer on mid2agb (decision 9: build the decomp's tool instead of porting it) shrank W-audiodata from
three units to two (the Python mid2agb port and its byte-for-byte differential script are gone), and the old
W-m4a 3 is split in two (W-m4a 3, the mixer; W-out 1, the browser output), so batch B has three workers.

### W-audiodata: the extractor (owns `tools/extract_audio.py`, `tools/extract_audio_voices.py`, `public/gen/audio/`)

1. **Songs: build and run mid2agb, assemble.** `tools/extract_audio.py`: build the decomp's `tools/mid2agb`
   (agb.cpp, error.cpp, main.cpp, midi.cpp, tables.cpp) with `$CXX` (default `c++`) and the Makefile's flags minus
   `-Werror` (so a newer compiler's new warnings don't break the build) into `tools/.bin/mid2agb` (gitignored),
   compiling straight from the decomp's sources so nothing is written into the decomp's tree; rebuild only when a
   source is newer than the binary. No compiler: fail with a clear message (what's missing, how to install it:
   `xcode-select --install` on macOS, `g++` / `build-essential` on Linux; `CXX=` to pick one). Run it on every
   `sound/songs/midi/*.mid` named in `midi.cfg` with its flags (MID_RULE in `audio_rules.mk`), writing the `.s`
   files to a temporary directory (deleted afterwards: only `public/gen/audio/` keeps anything), then a Python
   assembler for the `.s` text with `sound/MPlayDef.s`'s symbols (the spike's took ~80 lines) → `songs.json`
   with `sound/song_table.inc` and `sound/music_player_table.inc`. Wired into `npm run extract` (one line in
   `tools/extract.py`), README's setup section names the new requirement, `.gitignore` gets `tools/.bin/`. Unit
   test on `songs.json` (section 5). Small: probably done well inside the hour.
2. **Voicegroups and samples.** `tools/extract_audio_voices.py`: `voice_groups.inc` (8,073 lines of data) through the `music_voice.inc` macros
   (~160 lines: every voice type in section 1), `keysplit_tables.inc` (393, with the label offsets),
   `direct_sound_data.inc` → the WAVs (`smpl`, `agbp`, `agbl`), `programmable_wave_data.inc`, `cry_tables.inc`
   → `voicegroups.json`, `samples.json`, `samples.bin`, `waves.json`; wired into `npm run extract` with its own
   line in `tools/extract.py` (W-audiodata 1 adds the other: the merger keeps both). Unit test: every voice's
   sample exists, every keysplit resolves, and (once both units are on master) every song's voicegroup resolves.

### W-m4a: the engine (owns `src/audio/`)

1. **Sequencer, track commands and controls (silent).** MPlayOpen (46), MPlayStart (57), m4aMPlayStop (24),
   MPlayMain (339 asm), TrackStop (40 asm), the jump-table commands (ply_fine ... ply_port, ply_lfos, ply_mod:
   ~330 asm), ply_memacc ... ply_xcmd_0D (m4a.c, ~240), FadeOutBody (73), TrkVolPitSet (45), m4aSongNum*
   (~80), the m4aMPlay* controls (~330), m4aSoundInit / SoundInit / m4aSoundMode / SampleFreqSet (~170),
   `m4aSoundMain` (the player chain in its newest-first order); ~1,060 lines of C plus ~710 of asm. Notes only
   set gate times here (no channels). Unit tests: tempo and tick counts, MPlayStart's priority rule, pause /
   continue, fades (16 × speed frames), on hand-written bytes, then on `songs.json` once W-audiodata 1 lands.
2. **Notes, channels and cries (silent).** ply_note (280 asm: voice lookup through keysplit and rhythm voices,
   PCM channel allocation and stealing, CGB channel claim), ply_endtie (41 asm), ChnVolSetAsm (30 asm),
   MidiKeyToFreq (21), Clear/RealClearChain (34), the per-frame half of SoundMainRAM that isn't mixing (the
   envelope state machine, the sample position, loop and end: ~200 of its 381 asm lines, plus the reverse start
   from SoundMainRAM_Unk1), the cry song (SetPokemonCryTone and its setters, IsPokemonCryPlaying, the template:
   ~130); ~190 lines of C plus ~600 of asm. Needs W-audiodata 2's voicegroups. Unit tests: channel lifetimes,
   the cry table in section 2 (pin the real numbers), channel stealing between BGM and an SE.
3. **The mixer (first audible).** SoundMainRAM's mixing (resampling, ADSR applied, reverb, master volume, mono:
   the other ~180 asm lines), SoundMainRAM_Unk1's mixing loop (201 asm; DPCM isn't needed, spike 3), handing each
   frame's 224-sample block to W-out 1's `output.ts`. ~380 asm. Unit tests: a single note's block against a
   hand-computed one, reverb, mono. Songs play without their PSG parts.
4. **The CGB channels.** CgbSound (309), MidiKeyToCgbFreq (47), CgbOscOff / CgbPan / CgbModVol (68),
   MPlayExtender (71) as per-frame register state, and the worklet's PSG synth (squares with duty and sweep,
   the wave channel, noise with both LFSR widths, the hardware envelope, pan: new code, poryaaaa's
   `m4a_channel.c` as the reference). ~500 lines of C plus ~300 new. Music is complete after this.

### W-out: the browser output (owns `src/audio/output.ts`, `src/audio/worklet.ts`)

1. **Output, autoplay and the mute key.** `output.ts` and the worklet's PCM path (decision 3: the main thread
   posts each frame's 224-sample 8-bit stereo block on a MessagePort; the worklet upsamples by sample-and-hold
   from 13,379 Hz (decision 8) and plays, with 3-4 frames of buffering and silence on an underrun), the
   AudioContext created suspended at boot and resumed on the first keydown / pointerdown, suspended while the tab
   is hidden, off headless and for `?speed=` > 1, the `?audio=0/1` flag, Phaser's `noAudio`, the mute key M
   (decision 10; its DEVIATIONS entry), the same in `battle-test.html` (decision 12). The interface the mixer
   calls (`pushFrame(...)`) is fixed here; until W-m4a 3 lands nothing calls it, so a dev-only test tone
   (`?audio=tone`, or a `__test` hook) proves the path. The PSG state the worklet will synthesize is W-m4a 4's.
   Mostly new web code (~300-400 lines); no wait changes, so its own e2e checks plus the boot ones.

### W-sound: sound.c, map music and the call sites (owns `gba/sound.ts`, the audio script commands, the call-site files of each unit)

1. **sound.c and the hooks.** sound.c without the cries (~450 of its 649 lines: map music state machine,
   fanfares with Task_Fanfare / WaitFanfare, PlaySE*, Is*Playing, the BGM helpers), `AgbMainFrameEnd` in both
   hosts with the fanfare task (decision 5), the script commands playse ... waitfanfare (scrcmd.c:883-990),
   `__test.audioEvents` / `__test.audio()`, eggHatch's local fanfare counter removed, the audio data loaded by
   BootScene and battle-test's BattleTestBoot, the frame hook in BattleScene's host too (decision 12). E2E
   `tests/e2e/audio.test.ts`: an item fanfare holds its message 160 frames, `waitse` holds a script. Needs
   W-m4a 1 and W-audiodata 1 (the songs), not the mixer: the waits are right before anything is heard. Lengthens
   waits: runs the full e2e suite and raises the tick budgets that need it.
2. **Cries, text codes and specials.** sound.c's cries (sound.c:344-537, 194 lines: PlayCry_*, PlayCryInternal's
   mode table, the ducking task, IsCryFinished and the rest), SpeciesToCryId, `playmoncry` / `waitmoncry`
   (scrcmd.c:2088-2101), the text printer's SE_SELECT on A/B and its PLAY_BGM / PLAY_SE / WAIT_SE /
   PAUSE_MUSIC / RESUME_MUSIC codes (text.c:555-760, 900-905), the NO_OP audio specials, SetPokemonCryStereo
   from the option menu, title screen and save load. E2E: `waitmoncry`, a text WAIT_SE. Needs W-m4a 2.
3. **Map music.** overworld.c's music block (overworld.c:989-1200, ~210 lines: GetCurrLocationDefaultMusic,
   Overworld_PlaySpecialMapMusic, the connection transition, TryFadeOutOldMapMusic, ChangeMusicTo(Default),
   MusicCanOverrideMapMusic, gDisableMapMusicChangeOnMapLoad), `savedMusic` in the save (version bump), and the
   music calls at their callers: field_fadetransition.c (22, incl. the BGMusicStopped warp waits), overworld.c
   (27), field_effect.c (18: Fly, Dig, Teleport, Escape Rope, Surf), bike.c (4), the Hall of Fame and credits.
   E2E: a warp between maps with different music waits for the fade; bike music on, saved, continued; surf music.
4. **Call sites: field SEs.** See appendix A: field_effect.c's 19 non-music calls and the fldeff_* files,
   field_player_avatar.c (13), field_control_avatar.c (6), field_specials.c (13: elevators, ...), doors
   (`opendoor` / field_door.c), player_pc.c (10), start_menu.c (14: the save dialog), itemfinder.c,
   vs_seeker.c, ss_anne.c, seagallop.c, trainer_see.c, fldeff_poison.c: ~110 calls, nearly all missing in the
   port. (The weather loops on SE3 wait for field weather, which the port doesn't have yet.)
5. **Call sites: battle I (controllers, scripts, music).** battle_controller_player.c (48 in C / 17 live in the
   port), _oak_old_man.c (16 / 7), _opponent.c (9 / 4, incl. the intro cry wait), _safari.c (9 / 5),
   battle_script_commands.c (21 / 15), battle_main.c (11 / 1: the battle music, victory music), battle_setup.c
   and battle_transition.c (the music the transition starts, SE_MUGSHOT), BattleScene's `ui.play*` hooks
   replaced by sound.ts calls: ~70 calls to add.
6. **Call sites: battle II (balls, interface, anims).** pokeball.c (23, nearly all missing: the throw, wobbles,
   the send-out cry), battle_gfx_sfx_util.c (8: the low HP beep on SE3, the anim SE wait), battle_interface.c,
   the anim engine's panning and waits (battle_anim.c: 19 in C / 7 live, incl. the 90-frame SE wait at
   battle_anim.c:479; PlaySE12WithPanning's pan; SE12PanpotControl), battle_anim_sound_tasks.c (16 / 13),
   battle_anim_special.c (13 / 10): ~55 calls to add, plus checking the 36 PlaySE12WithPanning calls.
7. **Call sites: scenes.** evolution_scene.c (59 in C / 22 live: the music, cries and the SE_EXP / IsSEPlaying
   waits), trade_scene.c (30 / 18), hall_of_fame.c (14 / 0), credits.c, egg hatching (daycare.c / egg_hatch.c:
   14 / 13), pokedex_screen.c (14 / 10, the BGM volume calls), item_menu.c (37 / 24), title_screen.c and
   main_menu.c: ~85 calls to add.

The menu screens on the GBA layer (party menu, storage, summary, region map, TM case, berry pouch, item PC, shop,
trainer card, naming screen, markings, learn move, slot machine, Oak's speech) already make their calls (appendix
A): they need no unit, only a listen once sound.ts is real. Units 4-7 own disjoint files, so they run in parallel.

### Order and batches

| Batch | Workers (≤ 4) | Each needs merged |
| --- | --- | --- |
| A | W-audiodata 1, W-audiodata 2, W-m4a 1 | nothing |
| B | W-m4a 2, W-sound 1, W-out 1 | W-m4a 2: W-m4a 1 + W-audiodata 2. W-sound 1: W-m4a 1 + W-audiodata 1 (its e2e times real SEs and fanfares). W-out 1: nothing (it could run in A; it waits for B to keep A to three workers) |
| C | W-m4a 3, W-sound 2, W-sound 3, W-sound 4 | W-m4a 3: W-m4a 2 + W-out 1. W-sound 2: W-sound 1 + W-m4a 2. W-sound 3 and 4: W-sound 1 |
| D | W-m4a 4, W-sound 5, W-sound 6, W-sound 7 | W-m4a 4: W-m4a 3. W-sound 5-7: W-sound 2 (cries) |
| later | W-ref 1 | W-m4a 4 and W-sound 2 (it compares the engine's numbers with the ROM's) |

Fourteen units in four batches, plus W-ref 1. Fanfare and `waitse` waits become GBA-accurate in batch B (W-sound 1), cry and
warp (BGM fade) waits in batch C (W-sound 2 and 3); the first sound is heard in batch C (W-m4a 3). Every
W-sound unit only needs `__test.audioEvents` for its tests, not audible output, which is why the call-site units
don't wait for W-m4a 3-4.

### Shared building blocks and owners

- The JSON shapes in section 4: fixed here; W-audiodata owns any change and says so in its PR.
- `gba/sound.ts` (the API): W-sound 1 (cries: W-sound 2). Until they merge, other units call the existing stubs.
- `AgbMainFrameEnd` in `OverworldScene.ts` / `GbaHostScene.ts`: W-sound 1 (two lines each).
- `tools/extract.py`: one line each for W-audiodata 1 and 2. `.gitignore` (`tools/.bin/`) and README's setup
  section: W-audiodata 1.
- `src/main.ts` (Phaser `noAudio`), `src/battleTest.ts`'s output, `input/Input.ts` (the first-key resume, the
  mute key): W-out 1. `battleTest.ts`'s data loading: W-sound 1.
- `state/saveData.ts` (savedMusic, version bump): W-sound 3.
- `script/ScriptEngine.ts` audio commands: W-sound 1 (`playmoncry` / `waitmoncry`: W-sound 2); `opendoor`'s SE:
  W-sound 4. `script/specials.ts` NO_OP list: W-sound 2.
- `text/TextPrinter.ts` control codes: W-sound 2.
- `dev/testHooks.ts` audio hooks: W-sound 1.
- `battle/battleUi.ts` / BattleScene's `ui.play*`: W-sound 5 (replaced by sound.ts calls); W-sound 6 calls
  sound.ts directly.
- Per-file call sites: appendix A names each file's unit.

### W-ref: reference recordings from the user's ROM (later)

1. **mGBA recordings against the engine.** Input: the ROM path, which the user gave as
   `/Users/joshua/Coding/PokemonProjects/pret/PokemonFireRed.gba` (outside both git repos). Its SHA-1
   `dd5945db9b930750cb39d00c84da8571feebf417` matches the decomp's `firered_rev1.sha1`: it is **FireRed rev 1
   (1.1)**, while the decomp builds rev 0 by default. Before using a recording as a reference, check that the audio
   data doesn't differ between the revisions: a grep at `037335f4c` finds no `REVISION` guard in `sound/`,
   `src/m4a*.c`, `src/sound.c` or `include/gba/m4a_internal.h` (main.c's are only VCOUNT bookkeeping around
   `m4aSoundMain`), but the unit confirms it on the data, e.g. by finding `songs.json`'s song bytes and the
   voicegroups in the ROM (found at some offset = identical; a read only, nothing kept). Where recordings help:
   - **Cry lengths:** `IsPokemonCryPlaying`'s frames for a few species in each mode (section 2's table), the
     engine's unit-test numbers checked against them.
   - **SE and fanfare lengths:** SE_SELECT, SE_DOOR, SE_SAVE, SE_EXP, MUS_LEVEL_UP, MUS_OBTAIN_ITEM,
     MUS_POKE_FLUTE's silent tail (IsSEPlaying through it), against the sequencer's.
   - **Song lengths:** intro and loop length in frames for a few BGMs.
   - **A listening comparison:** the same scene recorded from mGBA and from the port, for the user to listen to
     (PSG timbre, reverb, the mono mix).
   How: mGBA's Lua scripting (0.10+) can poke memory (to start a song or cry) and read the players' state per frame; recordings and any
   data read from the ROM stay in a scratch directory outside the repo. **The ROM and anything ripped from it
   never go into the repo or `public/gen`**, and the path above is recorded only here. Only numbers derived from
   recordings may go into tests, and only if the user agrees (open question 1).

### Rules

Worker and merger rules: docs/WORKFLOW.md sections 3 and 4. On top of that: **game logic must time the same with
the output on or off** (any branch on "is audio on" outside `audio/output.ts` is a bug); e2e tests run with the
output off; **every unit that makes a wait longer runs the full e2e suite once** and raises the tick budgets that
were sized for today's instant waits (GBA timing is the goal: decision 11).

### Risks

- **Longer waits break tests or feel slow:** warps gain 32-64 frames when the music changes, cries hold battle
  intros, `waitse` holds scripts. This is the GBA's timing (decision 11); tests that budget ticks get more.
- **A new setup requirement:** `npm run extract` needs a C++ compiler for mid2agb. The tool is small, portable
  C++11 and builds with Apple clang; dropping `-Werror` keeps a newer compiler's warnings from failing the build.
- **m4a_1.s is assembly:** the mixer and ply_note need careful reading; poryaaaa (MIT, C) has worked through the
  same code and is a second reading.
- **PSG fidelity:** the hardware envelope and the noise channel are emulation, not C; expect a listening pass
  (W-ref 1 gives the reference).
- **Frame jitter:** the worklet's buffer (3-4 frames) trades latency for no crackle. A long main-thread stall
  (a map load) will drop audio for its length, as a lagging GBA game does.
- **Determinism:** the engine must not read anything from the AudioContext (time, state), or headless and
  browser runs drift apart.

### Open questions for the user

1. **Numbers from the ROM recordings in tests:** W-ref 1 measures cry / SE / song lengths on the user's ROM in
   mGBA. May those numbers (frame counts only, nothing ripped) go into the unit tests? Until then, the tests pin
   the engine's own numbers and the recordings are only compared in the unit's report.

## Decisions

1. **Port the m4a engine and run it live** (coordinator, revisit if you disagree): section 3. Pre-rendering was
   measured (21 MB, MIDI-level fidelity, still needs a player model and a cry synth) and rejected.
2. **The engine's logic always runs; only output is optional** (coordinator, revisit if you disagree): the waits
   in section 2 depend on track and channel state, so headless runs need the same logic to time like the GBA.
3. **Mixing on the main thread, output in an AudioWorklet** (coordinator, revisit if you disagree): the mixer's
   bookkeeping is needed for the waits anyway, so the worklet only upsamples, synthesizes the PSG and plays.
   MessagePort with transferables, no SharedArrayBuffer (no COOP/COEP headers needed for hosting).
4. **Samples straight from the decomp's WAVs, cries included** (coordinator, revisit if you disagree): spike 3
   shows the cry WAVs are exactly the decompressed ROM data, so no DPCM in the port.
5. **The fanfare and cry-ducking tasks run from the per-frame sound hook** (coordinator, revisit if you
   disagree): the field doesn't run gTasks every frame, and these two tasks only touch sound state.
   `IsFanfareTaskInactive` keeps the C's meaning.
6. **sound.c's state machines land before anything is audible** (W-sound 1 on W-m4a 1)
   (coordinator, revisit if you disagree): fanfare waits are frame counters, so they can be right first.
7. **Phaser's sound manager off** (`noAudio`) (coordinator, revisit if you disagree).
8. **GBA-exact first** (user): the 13,379 Hz 8-bit mix with sample-and-hold upsampling, the GBA's grit. An
   optional smoothing filter (linear interpolation, an analog-style low-pass) can come later as a deliberate QOL
   option.
9. **Build the decomp's own mid2agb during `npm run extract`** (user) instead of porting it to Python: the song
   bytes are the ROM's by construction, and the Python port and its differential check go away (W-audiodata 1).
   Built with the system C++ compiler into the gitignored `tools/.bin/`; extract fails with a clear message
   without one; the `.s` files go to a temporary directory and only `public/gen/audio/` keeps anything; nothing
   is committed. The other decomp tools aren't built (section 3, "Which decomp tools `npm run extract` builds").
   README's setup section names the compiler requirement. How it is built (coordinator, revisit if you
   disagree): `$CXX` straight from the decomp's sources with the Makefile's flags minus `-Werror`, not `make` in
   the decomp's tree, so the decomp checkout stays untouched.
10. **A mute key** (user): one key toggles all output. **M** (coordinator, revisit if you disagree): no game
    binding or dev key uses it. Remembered in `localStorage` (coordinator, revisit if you disagree). Logged in
    docs/DEVIATIONS.md "Deliberate QOL changes" when it lands (W-out 1).
11. **GBA timing** (user): warps, battle intros and scenes get as long as on the GBA; tests that budget ticks are
    updated (Rules).
12. **`battle-test.html` gets audio too** (user): W-out 1 (output) and W-sound 1 (data, frame hook).
13. **mGBA reference recordings from the user's ROM** (user): a later unit, W-ref 1, with the ROM path as input.
    The ROM and anything ripped from it never go into the repo or `public/gen`; numbers in tests only with the
    user's agreement (open question 1).
14. **W-audiodata re-split, W-out split off** (coordinator, revisit if you disagree): with mid2agb built, songs are
    one small unit and voicegroups another, both in batch A; the browser output (W-out 1) is split from the
    mixer so batch B runs three workers and W-m4a 3 is only the mixer.

## Not in this plan

Field weather's sounds (field_weather.c / field_weather_effects.c: SE_RAIN, SE_THUNDERSTORM, SE_DOWNPOUR and
their stops on SE3, PlayRainStoppingSoundEffect): the port has no field weather yet; whoever ports it adds them.

The help system's BGM halving (no help system yet: `SetBGMVolume_SuppressHelpSystemReduction` stays a volume call
with nothing reducing it), the quest log's playback muting (no quest log), link play and the wireless minigames'
sounds (dodrio_berry_picking.c, pokemon_jump.c, berry_crush.c, union_room.c), the intro movie's sound (intro.c
isn't ported), Teachy TV, the e-Reader and Mystery Gift screens, Emerald-only songs in the table (the `ph_*`
phoneme entries of midi.cfg are never built).

## Appendix A: call sites by file and owner

"C calls" counts every sound.c / m4a call (PlaySE*, PlayBGM, the map music functions, PlayFanfare*, WaitFanfare,
IsFanfareTaskInactive, PlayCry_*, the IsCry* / IsSE* / IsBGM* checks, m4a*) in the C file(s); "port live" counts
the port's live calls to the same functions plus the battle's `ui.play*` hooks (comments excluded); "comments"
counts the port's "no audio" / "silent" / "audio yet" notes. A C file's calls can also be for code the port
doesn't have (link play, the help system), so the gap is an upper bound. Measured at `bda62a9` with grep; the
unit that owns a file re-counts it.

| Owner | Port files | C files | C calls | Port live | Comments |
| --- | --- | --- | --- | --- | --- |
| W-sound 3 (music) | world/ (warps), scenes/OverworldScene.ts, menus/fieldCallbacks.ts, world/bike.ts, world/surf.ts | overworld.c, field_fadetransition.c, bike.c, field_effect.c (music part) | 27 + 22 + 4 + 18 | 0 | OverworldScene 3, bike 1, surf 1 |
| W-sound 4 | world/fieldMoves.ts, fieldMoveShowMon.ts, fly.ts, fallWarp.ts, flash.ts, hallOfFameRecord.ts | field_effect.c (non-music), fldeff_cut/dig/rocksmash/sweetscent/teleport/flash.c | 19 + 6 | 0 | 5 + 2 + 1 + 0 + 1 + 4 |
| W-sound 4 | world/playerAvatar.ts | field_player_avatar.c, field_control_avatar.c | 13 + 6 | 0 | 6 |
| W-sound 4 | world/elevator.ts, ui/PlayerPcMenu.ts, ui/StoragePcMenu.ts, world/vsSeeker.ts, world/itemfinder.ts, world/ssAnne.ts, menus/seagallop.ts | field_specials.c, player_pc.c, vs_seeker.c, itemfinder.c, ss_anne.c, seagallop.c | 13 + 10 + 2 + 2 + 2 + 5 | 0 + 0 + 0 + 0 + 1 + 2 | 1 + 0 + 0 + 2 + 3 + 3 + 4 |
| W-sound 4 | ui/SaveDialog.ts, ui/StartMenu.ts | start_menu.c | 14 | 1 | 3 |
| W-sound 4 | script/ScriptEngine.ts (`opendoor`), world/doors.ts | scrcmd.c:2126 (GetDoorSoundEffect), field_fadetransition.c's door SEs | 1 + 8 | 0 | 1 |
| W-sound 4 | entities/FieldEffects.ts, entities/FieldPoisonEffect.ts | trainer_see.c, fldeff_poison.c | 0 + 1 | 2 | 2 + 1 |
| deferred (no field weather in the port) | none | field_weather.c, field_weather_effects.c (the rain / thunder SE3 loops) | 9 + 3 | none | none |
| W-sound 5 | battle/controllerPlayer.ts, controllerOakOldMan.ts, controllerOpponent.ts, controllerSafari.ts, controllerCommon.ts | battle_controller_player.c, _oak_old_man.c, _opponent.c, _safari.c | 48 + 16 + 9 + 9 | 17 + 7 + 4 + 5 + 1 | 0 + 2 + 1 + 1 |
| W-sound 5 | battle/bsCommands1-4.ts, battle/main.ts, battle/transition.ts, battle/battleUi.ts, scenes/BattleScene.ts | battle_script_commands.c, battle_main.c, battle_setup.c, battle_transition.c | 21 + 11 + 1 + 1 | 15 + 1 + 0 + 4 + 4 | 3 + 2 + 1 + 3 |
| W-sound 6 | battle/gfx.ts, battle/battleInterface.ts | pokeball.c, battle_gfx_sfx_util.c, battle_interface.c | 23 + 8 + 3 | 3 + 2 | 1 |
| W-sound 6 | battle/anim/battleAnim.ts, soundTasks.ts, special.ts, effects1/2/3/3b.ts, electric/fire/ghost/psychic/rock.ts, utilityFuncs.ts | battle_anim.c, battle_anim_sound_tasks.c, battle_anim_special.c, battle_anim_effects_1/2/3.c, the type files, battle_anim_utility_funcs.c | 19 + 16 + 13 + 18 + 7 + 2 | 7 + 13 + 10 + 18 + 9 + 1 | 5 + 1 + 1 + 1 |
| W-sound 7 | menus/evolutionScene.ts, evolutionGraphics.ts | evolution_scene.c, evolution_graphics.c | 59 + 5 | 22 + 4 | 2 |
| W-sound 7 | menus/tradeScene.ts, menus/eggHatch.ts | trade_scene.c, daycare.c / egg_hatch.c | 30 + 14 | 18 + 13 | 2 + 5 |
| W-sound 7 | menus/hallOfFame.ts, menus/credits.ts, menus/titleScreen.ts, menus/mainMenu.ts, scenes/MainMenuScene.ts | hall_of_fame.c + hof_pc.c, credits.c, title_screen.c, main_menu.c | 14 + 1 + 7 + 3 | 0 + 0 + 5 + 2 | 9 + 2 + 1 + 1 |
| W-sound 7 | menus/pokedexScreen.ts, menus/itemMenu.ts, menus/itemUse.ts, menus/diploma.ts | pokedex_screen.c, item_menu.c, item_use.c, diploma.c | 14 + 37 + 7 + 2 | 10 + 24 + 7 + 2 | 3 + 0 + 0 + 1 |
| W-sound 2 | text/TextPrinter.ts, script/specials.ts, menus/optionMenu.ts, ui/MonPicBox.ts (`showmonpic` cry) | text.c, option_menu.c, scrcmd.c (playmoncry), reset_save_heap.c | 7 + 1 + 3 + 1 | 0 | 2 + 3 + 2 + 1 |
| none (calls kept) | menus/partyMenu.ts (+ partyMenuSpecials.ts) | party_menu.c, pokemon_special_anim.c, fldeff_softboiled.c | 73 + 5 + 3 | 63 | 1 |
| none (calls kept) | menus/pokemonStorage.ts, pokemonStorageCursor.ts, pokemonStorageMenu.ts | pokemon_storage_system_tasks.c, _data.c, _menu.c | 52 + 3 + 4 | 52 + 3 + 4 | 0 |
| none (calls kept) | menus/summaryScreen.ts, regionMap.ts, tmCase.ts, berryPouch.ts, itemPc.ts, shop.ts | pokemon_summary_screen.c, region_map.c, tm_case.c, berry_pouch.c, item_pc.c, shop.c | 27 + 15 + 11 + 14 + 15 + 8 | 26 + 14 + 11 + 14 + 15 + 7 | 0 |
| none (calls kept) | menus/trainerCard.ts, namingScreen.ts, monMarkings.ts, learnMove.ts, slotMachine.ts, oakSpeech.ts, clearSaveDataScreen.ts, easyChatScreen.ts | trainer_card.c, naming_screen.c, mon_markings.c, learn_move.c, slot_machine.c, oak_speech.c, clear_save_data_screen.c, easy_chat_2.c | 7 + 4 + 4 + 7 + 11 + 14 + 2 + 1 | 7 + 4 + 4 + 7 + 10 + 14 + 2 + 1 | 1 + 1 + 0 + 1 + 1 + 0 + 0 + 0 |
| none (calls kept) | gba/menu.ts, gba/listMenu.ts, ui/FieldListMenu.ts, ui/MultichoiceMenu.ts | menu.c, menu_helpers.c, list_menu.c, script_menu.c | 32 + 6 + 1 + 3 | 15 + 1 + 1 + 1 | 1 |

Not counted above: sound.c itself (W-sound 1 and 2), scrcmd.c's twelve audio commands (W-sound 1 and 2), and the C
files whose screens aren't ported (help_system_util.c 13, teachy_tv.c 9, fame_checker.c 8, the link minigames,
intro.c 4, mystery_gift_menu.c 3, map_preview_screen.c 1, quest_log.c 1).
