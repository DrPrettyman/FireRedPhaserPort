# Audio: plan for sound effects, cries and music

Every sound in the port is a no-op today: `src/gba/sound.ts` stubs the C's sound.c API, the script engine's audio
commands do nothing, and most ported files dropped their `PlaySE` calls for a comment. This plan says how the GBA
makes its sound, where the game uses it (and where game logic *waits* on it), how to bring it into the port, and
how to split the work into batches. It is research only (batch 3 of [SIDE_PLAN.md](SIDE_PLAN.md), W-audioplan):
no audio code merges until the user has reviewed it.

**The recommendation in one paragraph:** port the m4a engine itself (the sequencer, the channel allocator, the
mixer and the CGB channels: `src/m4a.c`, `src/m4a_1.s`) to TypeScript and drive it from the 60 Hz tick, once per
frame, exactly where the GBA's VBlank runs `m4aSoundMain`. The engine's logic always runs, so `IsSEPlaying`,
`IsCryFinished`, `BGMusicStopped` and the other waits time the same with audio on or off (headless tests run it
with the output off). Only the last step, sending each frame's mixed samples to the speakers, needs an
AudioContext. The extractor turns the decomp's MIDI files into the song bytes `mid2agb` would build, and reads the
voicegroups and the WAV samples straight from the decomp's sources. Pre-rendered audio files were measured and
rejected (see section 3).

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
3. **The cry WAVs decode exactly.** All 388 cries in `sound/direct_sound_samples/cries/*.wav` are exactly
   reachable by FRLG's DPCM (every in-block step is in gDeltaEncodingTable), so decoding the WAV gives the
   samples the GBA decompresses. The port needs no DPCM code.
4. **An offline renderer from the decomp's sources exists.** poryaaaa (MIT, C) builds with plain `cc` and
   renders a song from its MIDI file and voicegroup without a ROM. It rendered all 347 songs (intro plus one
   loop) in seconds: 54 minutes of music and 6 minutes of SEs, 21 MB + 2.3 MB as 48 kbps Opus.

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
- **Per frame** (main.c `VBlankIntr` → `m4aSoundMain` → `SoundMain`, m4a_1.s): mixes the next 224-sample buffer
  (`SoundMainRAM`: each DirectSound channel's envelope, pitch step, loop, reverse and compressed playback, the
  reverb echo of the buffer from the last frame, and the master volume), then runs each player's sequencer
  (`MPlayMain`) and `CgbSound` for the four PSG channels. `m4aSoundVSync` (the VCount interrupt) only restarts
  the DMA. On the GBA the mix for frame N plays during frame N+1.
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
(a second detuned track) and volume. `IsPokemonCryPlaying` is true **while the cry's channel is alive**: its
length plus the release envelope, or less if the sample runs out first, so cry waits depend on the mixer's
sample position and envelope, not only on the sequencer. `PlayCry_Normal` / `_ByMode` / `_Script` duck the BGM to
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
  **Fanfare waits are frame counters, not the song's length** (spike 2).
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
| PlaySE | 686 (88) | stub; called only in `gba/menu.ts`, `gba/listMenu.ts`, `battle/gfx.ts`. Elsewhere the call was dropped for a comment, or goes through the battle's `ui.playSE` (a no-op in BattleScene.ts:225) |
| PlaySE12WithPanning / 1 / 2, SE12PanpotControl | 49 (20) / 3 / 2, 2 | `battle/anim/battleAnim.ts` PlaySE12WithPanning → `ui.playSE`, panning dropped |
| PlayBGM / PlayNewMapMusic / Overworld_PlaySpecialMapMusic | 21 (12) / 20 (10) / 22 (9) | stub / missing / missing (comments) |
| Overworld_ChangeMusicTo(Default), FadeOutAndPlayNewMapMusic, FadeOutAndFadeInNewMapMusic | 6, 6, 2 | missing |
| FadeOutMapMusic / FadeOutBGM / FadeInBGM / FadeOutBGMTemporarily | 11 / 4 / 3 / 2 | stubs (title screen only) / comments |
| StopMapMusic / BGMusicStopped / IsNotWaitingForBGMStop | 18 / 12 / 3 | missing / missing / stub (TRUE) |
| PlayFanfare / PlayFanfareByFanfareNum / WaitFanfare / IsFanfareTaskInactive | 24 (19) / 5 / 6 / 16 (12) | stubs; IsFanfareTaskInactive always TRUE, WaitFanfare always TRUE |
| PlayCry_Normal / _ByMode / _Script / _NormalNoDucking / _ReleaseDouble | 21 / 16 / 2 / 7 / 4 | stubs (the first four); battle's `ui.playCry` no-op |
| IsCryFinished / IsCryPlaying / IsCryPlayingOrClearCrySongs / StopCryAndClearCrySongs | 11 / 4 / 12 / 7 | stubs: finished at once |
| IsSEPlaying / IsBGMPlaying / IsBGMStopped / IsSpecialSEPlaying | 34 (11) / 1 / 1 / 1 | stub (FALSE) / missing |
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
| `waitmoncry`, IsCryFinished, IsCryPlaying(OrClearCrySongs) | the cry **channel** (length + release, the sample's end): sequencer + mixer state | scrcmd.c:2097, evolution_scene.c (6), trade_scene.c (2), daycare.c, oak_speech.c, battle_anim_sound_tasks.c (4), the battle controllers (8: the opponent's intro cry before the battle starts), hall_of_fame.c (2), pokeball.c, pokemon_summary_screen.c | finished at once: battle intros, the Hall of Fame and evolutions go faster than on the GBA |
| BGMusicStopped, IsNotWaitingForBGMStop | the BGM fade-out (16 × speed frames) and MapMusicMain's states 5-7 | field_fadetransition.c (5 warp tasks: `!WaitWarpFadeOutScreen() && BGMusicStopped()`), field_effect.c (5: Fly, Dig, Teleport, Escape Rope), field_screen_effect.c, seagallop.c, overworld.c, title_screen.c, pokemon_jump.c | not checked: warps wait only for the palette fade. On the GBA a warp into a map with other music waits 32 frames (indoors) or 64 (outdoors) for the music |
| IsBGMStopped / IsBGMPlaying | the BGM player | trade_scene.c, pokeball.c | not ported |
| IsSpecialSEPlaying | SE3 | field_weather.c (rain stopping) | not ported |

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
| mGBA recording | MPL-2.0 | a ROM | The ground truth for comparisons, if a ROM is at hand (open question 6) |

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
  assembly, much of it register shuffling) and a ~1,000-line Python mid2agb.
- **CLAUDE.md fit:** good: data through the extractor, constants (song ids, CRY_MODE_*, FANFARE_*) already in
  `scripts.json`, the engine ticks in GBA frames.

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
   headers). The worklet upsamples the PCM (sample-and-hold, like the GBA's DMA, or linear, see open question 1),
   synthesizes the four PSG channels at the output rate from the registers (this is where the hardware envelope
   and the noise LFSR live), mixes and writes. A few frames of buffering absorb timer jitter; an underrun plays
   silence.
3. **The data comes from the decomp's sources through the extractor**, in Python: a port of mid2agb (verified
   byte-for-byte against the decomp's C++ tool by a dev script, since spike 1 shows the tool builds in seconds), the
   voicegroups / keysplits / cry tables parsed from the `.inc` files, the WAVs read as they are (cries included).
4. **poryaaaa is the reference** for the mixer and PSG details (MIT: code may be adapted with its notice) and its
   renderer is a dev-only comparison tool; it is not part of `npm run extract`.

Why: it is the only option where the waits in section 2 are right by construction, where every m4a call the C makes
has a real meaning, and where nothing new is needed to extract. Its cost is engine code, which this project
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
- `tools/extract_audio.py` → `public/gen/audio/`: `songs.json` (per song: name, id, player, priority, reverb,
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
- **Phaser's sound system:** not used (it plays decoded buffers; it has no synth). Set `audio: { noAudio: true }`
  in `main.ts` so Phaser doesn't open a second AudioContext.
- **Options:** SOUND (`state.optionsSound`, saved since save version 3, `state/saveData.ts:94`) calls
  `SetPokemonCryStereo` where the C does (option_menu.c:519 on exit, title_screen.c:742 and reset_save_heap.c:24
  on load), which switches the mixer's mono bit and the output routing.
- **Save state:** `gSaveBlock1Ptr->savedMusic` (global.h:767) must be saved: it holds MUS_CYCLING on the bike and
  `savebgm` songs, and CONTINUE plays it (`Overworld_PlaySpecialMapMusic`). One field and a save version bump.
  Nothing else in the audio state is saved (the GBA saves no player state).
- **Volume:** the GBA has none. A master volume / mute is a deliberate QOL change if wanted (open question 3).

---

## 5. Testing

- **Unit (Vitest, Node):** the Python side is checked by the extractor run itself plus a dev script
  (`tools/check_mid2agb.py`, not part of `npm test`) that builds the decomp's mid2agb with `c++` into a temp
  directory and compares every song's bytes; the TS side: the sequencer on the extracted songs (lengths in frames
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
- **Existing tests:** once the engine is in, every wait in section 2 gets longer (warps, cries, SE waits). E2E
  tests wait on state, not time (tests/README.md rule 3), so they should pass, but each unit runs the full suite
  once to catch hard-coded tick budgets.
- **Against the GBA:** (1) poryaaaa_render as a dev-only oracle: render a song from the decomp sources, render the
  same song with the port's engine in Node, compare loudness envelopes and note onsets (not bit-exact: poryaaaa
  plays MIDI, not mid2agb's bytes). (2) If the user has a ROM or builds one, mGBA's audio recording is the ground
  truth for a few listening checks and for cry timings (open question 6). (3) The fanfare / SE length table
  doubles as a regression check.

---

## 6. The work split

Units follow docs/WORKFLOW.md section 1: about an hour for a fresh worker, each leaving the branch green. One PR
per unit (SIDE_PLAN.md decision 1). Three workstreams; the engine and the data can start in parallel once the
JSON shapes in section 4 are agreed (they are fixed here, so neither waits on the other's code: the engine's first
unit tests on fixtures built from the spike's song bytes).

### W-audiodata: the extractor (owns `tools/extract_audio.py`, `public/gen/audio/`, `tools/check_mid2agb.py`)

1. **Songs.** midi.cfg, a Python port of mid2agb (midi.cpp's reader, agb.cpp's writer: notes and ties, waits,
   `-E` gate times, the volume / pan / bend / mod / tempo events, loop markers to GOTO, PATT compression of
   repeats, `-V` volume scaling, priority and reverb), the song table and music player table → `songs.json`;
   the dev check against the C++ mid2agb (all 347 songs byte-identical, or the differences listed in the PR).
   `npm run extract` wires it in.
2. **Voicegroups and samples.** `voice_groups.inc` with the `music_voice.inc` macros (every voice type in
   section 1), `keysplit_tables.inc` (with the label offsets), `direct_sound_data.inc` → the WAVs (`smpl`,
   `agbp`, `agbl`), `programmable_wave_data.inc`, `cry_tables.inc` → `voicegroups.json`, `samples.json`,
   `samples.bin`, `waves.json`. Unit test: every song's voicegroup resolves and every voice's sample exists.

### W-m4a: the engine (owns `src/audio/`)

1. **Sequencer and channels, no sound.** m4a.c + m4a_1.s's logic: MPlayOpen / MPlayStart / MPlayMain, every
   `ply_*` and `ply_x*` command, TrackStop, TrkVolPitSet, FadeOutBody, the m4aMPlay* controls, ply_note's voice
   lookup and channel allocation (PCM priority stealing, the 5-channel limit, CGB channels), ChnVolSetAsm,
   MidiKeyToFreq / MidiKeyToCgbFreq, the per-frame envelope and sample-position bookkeeping (no mixing), the cry
   song (SetPokemonCryTone and its setters, IsPokemonCryPlaying), `m4aSoundMain`. Unit tests as in section 5.
2. **The mixer and the output.** SoundMainRAM's mixing (resampling, ADSR applied, reverse, the no-resample type,
   reverb, master volume, mono), `output.ts` and the worklet (PCM path only), autoplay resume, visibility, the
   `?audio=` flag, Phaser `noAudio`. First audible unit (songs without their PSG parts).
3. **The CGB channels.** CgbSound's register writes and the worklet's PSG synth (squares with duty and sweep, the
   wave channel with the programmable waves, noise with both LFSR widths, the hardware envelope, pan). Compare
   with poryaaaa's renders. After this, music is complete.

### W-sound: sound.c and the call sites (owns `gba/sound.ts`, the audio script commands, the call-site files of each unit)

1. **sound.c and the hooks.** All of sound.c on the engine (map music state machine, fanfares with
   Task_Fanfare / WaitFanfare, cries with the ducking task, PlaySE*, Is*Playing, BGM volume helpers),
   `AgbMainFrameEnd` in both hosts, the twelve script commands (ScrCmd_playse ... ScrCmd_waitmoncry, `savebgm`
   with `savedMusic` in the save and a version bump), the NO_OP audio specials, the text printer's SE_SELECT and
   control codes, `__test.audioEvents` / `__test.audio()`. Remove eggHatch's local fanfare counter. E2E
   `tests/e2e/audio.test.ts` (item fanfare, `waitse`, `waitmoncry`). Can start on W-m4a unit 1 alone: the waits
   are right before any sound is heard.
2. **Map and battle music.** overworld.c's music functions (Overworld_PlaySpecialMapMusic, TryFadeOutOldMapMusic,
   the connection transition, ChangeMusicTo(Default), MusicCanOverrideMapMusic, gDisableMapMusicChangeOnMapLoad)
   at their callers (field_fadetransition.c's warp tasks with BGMusicStopped, Fly / Dig / Teleport / Escape Rope,
   bike, surf, Cycling Road, the Hall of Fame and credits), battle music (CreateBattleStartTask's song, trainer
   encounter music, victory music, BattleStopLowHpSound / SE_LOW_HEALTH, the controllers' PLAYBGM / PLAYFANFARE /
   PLAYSE through sound.ts instead of `ui.*`), the title screen and Oak's speech BGM.
3. **Call sites: field.** Re-add the C's PlaySE / cries / fanfares in `world/` and `entities/` (player avatar,
   doors, field moves, field effects, the field items, elevators, VS Seeker, Itemfinder, the PC, Seagallop,
   S.S. Anne, Flash, falls, weather SE3 loops), removing their DEVIATIONS lines.
4. **Call sites: battle.** Cries in every mode (send-out, faint, doubles, the Pokédex-registered cry), the anim
   engine's panning (PlaySE12WithPanning, SE12PanpotControl, the sound tasks), the 90-frame SE wait at the end
   of an anim (battle_anim.c:479), ball and exp SEs, IsCryPlayingOrClearCrySongs in the controllers.
5. **Call sites: menus and scenes.** Party menu, bag, TM case, berry pouch, PC screens, summary, Pokédex (incl.
   the BGM volume calls), region map, shop, trainer card, slot machine (the payout's fanfare wait), learn move,
   evolution, egg hatch, trades, Hall of Fame, credits, save dialog, option menu (SetPokemonCryStereo).

Units 3-5 split by directory, so they can run in parallel. Each greps its files for "no audio", "silent", "audio"
(121 comments in 53 files today) and the C files they port for every PlaySE / PlayCry / PlayFanfare / m4a call.

### Order and batches

| Batch | Workers (≤ 4) | Depends on |
| --- | --- | --- |
| A | W-audiodata 1, W-audiodata 2, W-m4a 1 | nothing (fixed JSON shapes) |
| B | W-m4a 2, W-sound 1, then W-m4a 3 | A merged |
| C | W-sound 2, W-sound 3, W-sound 4, W-sound 5 | W-sound 1 (the API) and W-m4a 2 (to hear it) |

### Shared building blocks and owners

- The JSON shapes in section 4: fixed here; W-audiodata owns any change and says so in its PR.
- `gba/sound.ts` (the API): W-sound unit 1. Until it merges, other units call the existing stubs.
- `AgbMainFrameEnd` in `OverworldScene.ts` / `GbaHostScene.ts`: W-sound unit 1 (two lines each).
- `state/saveData.ts` (savedMusic, version bump): W-sound unit 1.
- `script/ScriptEngine.ts` audio commands, `script/specials.ts` NO_OP list: W-sound unit 1.
- `text/TextPrinter.ts` control codes: W-sound unit 1.
- `dev/testHooks.ts` audio hooks: W-sound unit 1.
- `battle/battleUi.ts` / BattleScene's `ui.play*`: W-sound unit 2 (replaced by sound.ts calls).
- Per-file call sites: units 3-5 by directory.

### Rules

Worker and merger rules: docs/WORKFLOW.md sections 3 and 4. On top of that: **game logic must time the same with
the output on or off** (any branch on "is audio on" outside `audio/output.ts` is a bug); e2e tests run with the
output off; every unit that makes a wait longer runs the full e2e suite once.

### Risks

- **Longer waits break tests or feel slow:** warps gain 32-64 frames when the music changes, cries hold battle
  intros, `waitse` holds scripts. This is the GBA's timing; tests that budget ticks may need more.
- **mid2agb's port is subtle** (running status, PATT compression, rounding of volumes): the C++ tool as a
  differential check makes this safe, but the first unit may run long.
- **m4a_1.s is assembly:** the mixer and ply_note need careful reading; poryaaaa (MIT, C) has worked through the
  same code and is a second reading.
- **PSG fidelity:** the hardware envelope and the noise channel are emulation, not C; expect a listening pass.
- **Frame jitter:** the worklet's buffer (3-4 frames) trades latency for no crackle. A long main-thread stall
  (a map load) will drop audio for its length, as a lagging GBA game does.
- **Determinism:** the engine must not read anything from the AudioContext (time, state), or headless and
  browser runs drift apart.

### Open questions for the user

1. **How GBA-exact should it sound?** Exact (13,379 Hz 8-bit mix, sample-and-hold upsampling: the GBA's grit)
   or a cleaned-up mix (linear interpolation, poryaaaa's optional analog filter)? The plan builds exact and can
   add a filter later.
2. **mid2agb in Python vs the decomp's own tool:** the plan ports it to Python so `npm run extract` keeps needing
   only Python + Pillow. The alternative is building the decomp's mid2agb with the system C++ compiler during
   extract: byte-exact for free, but a new setup requirement.
3. **A volume / mute control** (not on the GBA): a key, a field in OPTIONS, or none? If any, it goes in
   DEVIATIONS' "Deliberate QOL changes".
4. **Timing changes:** OK that warps, battle intros and scripted scenes get as long as on the GBA once the engine
   lands (before anything is audible)?
5. **The battle test harness** (`battle-test.html`): audio there too?
6. **A ROM for comparisons:** if you have a FireRed ROM, mGBA recordings would let unit tests pin cry lengths and
   SE lengths to the real thing; otherwise poryaaaa and the decomp's C are the references.

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
6. **sound.c's state machines land before anything is audible** (W-sound unit 1 on W-m4a unit 1)
   (coordinator, revisit if you disagree): fanfare waits are frame counters, so they can be right first.
7. **Phaser's sound manager off** (`noAudio`) (coordinator, revisit if you disagree).

## Not in this plan

The help system's BGM halving (no help system yet: `SetBGMVolume_SuppressHelpSystemReduction` stays a volume call
with nothing reducing it), the quest log's playback muting (no quest log), link play and the wireless minigames'
sounds (dodrio_berry_picking.c, pokemon_jump.c, berry_crush.c, union_room.c), the intro movie's sound (intro.c
isn't ported), Teachy TV, the e-Reader and Mystery Gift screens, Emerald-only songs in the table (the `ph_*`
phoneme entries of midi.cfg are never built).
