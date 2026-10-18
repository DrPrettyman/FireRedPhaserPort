// The m4a engine (src/audio/m4a.ts) against frame counts measured on the FireRed rev 1 ROM in mGBA (W-ref 1,
// AUDIO_PLAN.md section 6 "W-ref"; decision 15: frame counts from the ROM may go into tests, nothing ripped from it
// may). How they were measured: docs/DEV_NOTES.md "ROM reference measurements".
//
// Frames are counted as in tests/unit/m4a.test.ts: the song (or cry) is started during frame 0's game logic, and
// "frame k" is the k-th m4aSoundMain call after that (the k-th VBlank). On the ROM the start call was made right
// before a VBlank's m4aSoundMain (the CPU hijacked at m4aSoundMain's entry), so that VBlank's call is frame 1, and
// a frame number is gMain.vblankCounter2 counted from there.
//
// - `fine`: the frame in which the song's last track runs its FINE (ply_fine).
// - `stopped`: the frame after which the player's status has no TRACK bit (MPlayMain's `status = PAUSE` at
//   _081DD9A4): IsSEPlaying (SE1 / SE2), IsBGMPlaying, IsFanfareTaskInactive's SE2 check are FALSE from there on.
// - BGM loops: the frames in which track 0 runs its GOTO command (ply_goto) the first three times. The first is
//   the intro plus one pass of the loop; the differences are the loop's length (they can differ by a frame: the
//   tempo accumulator's remainder carries over). Every track of these songs loops in the same frames.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  gCryTable,
  gMPlayJumpTable,
  gMPlayTable,
  IsPokemonCryPlaying,
  m4aSongNumStart,
  m4aSoundInit,
  m4aSoundMain,
  SetPokemonCryChorus,
  SetPokemonCryLength,
  SetPokemonCryPanpot,
  SetPokemonCryPitch,
  SetPokemonCryPriority,
  SetPokemonCryProgress,
  SetPokemonCryRelease,
  SetPokemonCryTone,
  SetPokemonCryVolume,
  setVoiceData,
} from '../../src/audio/m4a';
import { MPT_FLG_EXIST, MUSICPLAYER_STATUS_TRACK, type MusicPlayerInfo } from '../../src/audio/m4aInternal';
import type { SamplesJson, VoicegroupsJson, WavesJson } from '../../src/audio/m4aVoices';
import { loadSongTable, type SongsJson } from '../../src/audio/songTable';

// ---------------------------------------------------------------------------------------------------------------
// Measured on the ROM (mGBA 0.10.5, FireRed rev 1).

/** SEs and fanfares: [song, FINE frame, stopped after frame]. */
const ROM_SONG_ENDS: [string, number, number][] = [
  ['SE_SELECT', 10, 11],
  ['SE_LEDGE', 13, 14],
  ['SE_WALL_HIT', 18, 19],
  ['SE_SAVE', 43, 44],
  ['SE_PC_ON', 61, 62],
  ['SE_PC_OFF', 24, 25],
  ['SE_PC_LOGIN', 26, 28],
  ['SE_FAINT', 51, 53],
  ['SE_FLEE', 40, 41],
  ['SE_EXP', 99, 100],
  ['SE_EXP_MAX', 19, 20],
  ['SE_DOOR', 34, 36],
  ['SE_EXIT', 39, 40],
  ['SE_WIN_OPEN', 18, 19],
  ['SE_BALL_OPEN', 26, 28],
  ['SE_USE_ITEM', 29, 30],
  ['SE_SHOP', 38, 39],
  ['SE_BIKE_BELL', 121, 123],
  ['SE_SUCCESS', 16, 17],
  ['SE_FAILURE', 22, 23],
  ['SE_BALL', 9, 10],
  ['SE_BAG_CURSOR', 6, 6],
  ['SE_HELP_OPEN', 36, 36],
  ['SE_M_CUT', 34, 35],
  ['MUS_HEAL', 138, 139],
  ['MUS_LEVEL_UP', 64, 64],
  ['MUS_OBTAIN_ITEM', 146, 147],
  ['MUS_EVOLVED', 229, 230],
  ['MUS_OBTAIN_BADGE', 313, 315],
  ['MUS_OBTAIN_TMHM', 193, 195],
  ['MUS_OBTAIN_BERRY', 116, 117],
  ['MUS_EVOLUTION_INTRO', 61, 63],
  ['MUS_SLOTS_JACKPOT', 262, 264],
  ['MUS_SLOTS_WIN', 151, 153],
  ['MUS_MOVE_DELETED', 157, 158],
  ['MUS_TOO_BAD', 141, 142],
  ['MUS_JIGGLYPUFF', 396, 397],
  ['MUS_DEX_RATING', 200, 202],
  ['MUS_OBTAIN_KEY_ITEM', 160, 162],
  ['MUS_CAUGHT_INTRO', 215, 216],
  ['MUS_PHOTO', 76, 77],
  ['MUS_POKE_FLUTE', 3061, 3063],
];

/** Looping songs: [song, frames of track 0's first three GOTOs]. */
const ROM_BGM_GOTOS: [string, number[]][] = [
  ['SE_LOW_HEALTH', [37, 73, 109]], // SE3, loops until stopped
  ['MUS_PALLET', [2620, 5238, 7856]],
  ['MUS_ROUTE1', [1507, 2996, 4486]],
  ['MUS_POKE_CENTER', [1988, 3974, 5960]],
  ['MUS_VS_WILD', [2692, 4591, 6489]],
  ['MUS_VS_TRAINER', [6113, 11053, 15992]],
  ['MUS_OAK_LAB', [1021, 1981, 2941]],
  ['MUS_TITLE', [2701, 5170, 7639]],
  ['MUS_VIRIDIAN_FOREST', [6316, 12616, 18916]],
  ['MUS_GYM', [2026, 4051, 6076]],
];

/**
 * Cries: PlayCry_ByMode(species, 0, mode) called in frame 0 (sound.c PlayCryInternal: the mode's length, release,
 * pitch, chorus and volume, pan 0, CRY_PRIORITY_NORMAL). [cry sample, then per mode NORMAL, ENCOUNTER, FAINT,
 * HIGH_PITCH, DOUBLES: the first frame after which IsPokemonCryPlaying(gMPlay_PokemonCry) is FALSE (track 0's
 * channel no longer linked: the sample ran out, or the FINE after `length` ticks)]. It is TRUE after every frame
 * before that, from frame 1 on.
 */
const ROM_CRIES: [string, number, number, number, number, number][] = [
  ['Cry_Pidgey', 12, 12, 14, 11, 12],
  ['Cry_NidoranF', 29, 27, 34, 26, 21],
  ['Cry_Bulbasaur', 48, 46, 57, 44, 21],
  ['Cry_Pikachu', 48, 46, 58, 45, 21],
  ['Cry_Charizard', 56, 53, 67, 51, 21],
  ['Cry_Onix', 71, 68, 85, 51, 21],
  ['Cry_Mew', 87, 83, 104, 51, 21],
  ['Cry_Jynx', 135, 129, 141, 51, 21],
];
/** The cry song itself: [mode, FINE frame, cry player free after frame] (the same for every species). */
const ROM_CRY_SONG_ENDS: [CryModeName, number, number][] = [
  ['NORMAL', 141, 142],
  ['ENCOUNTER', 141, 142],
  ['FAINT', 141, 142],
  ['HIGH_PITCH', 51, 52],
  ['DOUBLES', 21, 22],
];

// ---------------------------------------------------------------------------------------------------------------

const SONGS_JSON = resolve(__dirname, '../../public/gen/audio/songs.json');

describe.skipIf(!existsSync(SONGS_JSON))('the engine against the ROM', () => {
  const json = existsSync(SONGS_JSON) ? (JSON.parse(readFileSync(SONGS_JSON, 'utf8')) as SongsJson) : null;

  /** Starts a song alone on a fresh engine (in frame 0); returns its player. */
  function start(name: string): MusicPlayerInfo {
    m4aSoundInit();
    const { idByName } = loadSongTable(json!);
    const id = idByName.get(name);
    if (id === undefined) throw new Error(`no ${name}`);
    m4aSongNumStart(id);
    return gMPlayTable[json!.songs[id].ms].info;
  }

  test.each(ROM_SONG_ENDS)('%s: FINE in frame %i, stopped after frame %i (as on the ROM)', (name, fine, stopped) => {
    const info = start(name);
    let gotFine = -1;
    let gotStopped = -1;
    for (let f = 1; f <= 5000 && gotStopped < 0; f++) {
      m4aSoundMain();
      if (gotFine < 0 && info.tracks.slice(0, info.trackCount).every((t) => !(t.flags & MPT_FLG_EXIST))) gotFine = f;
      if ((info.status & MUSICPLAYER_STATUS_TRACK) === 0) gotStopped = f;
    }
    expect({ fine: gotFine, stopped: gotStopped }).toEqual({ fine, stopped });
  });

  test.each(ROM_BGM_GOTOS)('%s: track 0 loops (GOTO) in the same frames as on the ROM', (name, frames) => {
    const info = start(name);
    const track0 = info.tracks[0];
    const gotos: number[] = [];
    let frame = 0;
    // Watch the GOTO command (gMPlayJumpTable[1], ply_goto) as the ROM measurement watched ply_goto; MEMACC's
    // true branch runs the same entry with mplayInfo.cmd = 8.
    const plyGoto = gMPlayJumpTable[1];
    gMPlayJumpTable[1] = (mplayInfo, track) => {
      if (mplayInfo === info && track === track0 && mplayInfo.cmd === 1) gotos.push(frame);
      plyGoto(mplayInfo, track);
    };
    try {
      for (frame = 1; frame <= frames[frames.length - 1] && gotos.length < frames.length; frame++) m4aSoundMain();
    } finally {
      gMPlayJumpTable[1] = plyGoto;
    }
    expect(gotos).toEqual(frames);
  });

});

// sound.c PlayCryInternal's mode table for the five modes measured (CRY_VOLUME 120).
type CryModeName = 'NORMAL' | 'ENCOUNTER' | 'FAINT' | 'HIGH_PITCH' | 'DOUBLES';
const CRY_MODES: Record<CryModeName, { length: number; release: number; pitch: number; chorus: number; volume: number }> = {
  NORMAL: { length: 140, release: 0, pitch: 15360, chorus: 0, volume: 120 },
  ENCOUNTER: { length: 140, release: 225, pitch: 15600, chorus: 20, volume: 90 },
  FAINT: { length: 140, release: 200, pitch: 14440, chorus: 0, volume: 120 },
  HIGH_PITCH: { length: 50, release: 200, pitch: 15800, chorus: 20, volume: 90 },
  DOUBLES: { length: 20, release: 225, pitch: 15360, chorus: 0, volume: 120 },
};
const MODE_ORDER: CryModeName[] = ['NORMAL', 'ENCOUNTER', 'FAINT', 'HIGH_PITCH', 'DOUBLES'];

const GEN = resolve(__dirname, '../../public/gen/audio');
const haveVoices = ['voicegroups.json', 'samples.json', 'waves.json'].every((f) => existsSync(resolve(GEN, f)));
const readJson = <T,>(f: string): T => JSON.parse(readFileSync(resolve(GEN, f), 'utf8')) as T;

describe.skipIf(!haveVoices)('cries against the ROM', () => {
  const voicegroups = haveVoices ? readJson<VoicegroupsJson>('voicegroups.json') : null!;
  const samples = haveVoices ? readJson<SamplesJson>('samples.json') : null!;
  const waves = haveVoices ? readJson<WavesJson>('waves.json') : null!;

  /** PlayCryInternal's setters (sound.c) for a cry sample and mode, on a fresh engine, in frame 0. */
  function playCry(sample: string, mode: CryModeName): MusicPlayerInfo {
    m4aSoundInit();
    setVoiceData(voicegroups, samples, waves);
    const cryId = voicegroups.cries.findIndex((c) => c.sample === sample);
    if (cryId < 0) throw new Error(`no ${sample}`);
    const m = CRY_MODES[mode];
    SetPokemonCryVolume(m.volume);
    SetPokemonCryPanpot(0);
    SetPokemonCryPitch(m.pitch);
    SetPokemonCryLength(m.length);
    SetPokemonCryProgress(0);
    SetPokemonCryRelease(m.release);
    SetPokemonCryChorus(m.chorus);
    SetPokemonCryPriority(10); // CRY_PRIORITY_NORMAL
    return SetPokemonCryTone(gCryTable[cryId]);
  }

  test.each(ROM_CRIES)('%s: IsPokemonCryPlaying FALSE after frame NORMAL %i, ENCOUNTER %i, FAINT %i, HIGH_PITCH %i, DOUBLES %i', (sample, ...want) => {
    const got = MODE_ORDER.map((mode) => {
      const mplay = playCry(sample, mode);
      for (let f = 1; f < 1000; f++) {
        m4aSoundMain();
        if (!IsPokemonCryPlaying(mplay)) return f;
      }
      return -1;
    });
    expect(got).toEqual(want);
  });

  test.each(ROM_CRY_SONG_ENDS)('%s: the cry song\'s FINE in frame %i, its player free after frame %i', (mode, fine, stopped) => {
    const mplay = playCry('Cry_Jynx', mode); // the longest sample: the length ends the song
    let gotFine = -1;
    let gotStopped = -1;
    for (let f = 1; f < 1000 && gotStopped < 0; f++) {
      m4aSoundMain();
      if (gotFine < 0 && !(mplay.tracks[0].flags & MPT_FLG_EXIST)) gotFine = f;
      if ((mplay.status & MUSICPLAYER_STATUS_TRACK) === 0) gotStopped = f;
    }
    expect({ fine: gotFine, stopped: gotStopped }).toEqual({ fine, stopped });
  });
});
