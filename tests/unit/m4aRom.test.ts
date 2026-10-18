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
// - BGM loops: the frames in which track 0 runs its GOTO (ply_goto) the first three times. The first is the intro
//   plus one pass of the loop; the differences are the loop's length (they can differ by a frame: the tempo
//   accumulator's remainder carries over).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, test } from 'vitest';
import { gMPlayTable, m4aSongNumStart, m4aSoundInit, m4aSoundMain } from '../../src/audio/m4a';
import { MPT_FLG_EXIST, MUSICPLAYER_STATUS_TRACK, type MusicPlayerInfo } from '../../src/audio/m4aInternal';
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
];

/** Looping BGMs: [song, frames of track 0's first three GOTOs]. */
const ROM_BGM_GOTOS: [string, number[]][] = [];

/**
 * Cries, for W-sound 2 (batch C) to assert on W-m4a 2's cry API: PlayCry_ByMode(species, 0, mode) called in frame
 * 0; IsPokemonCryPlaying(gMPlay_PokemonCry) (track 0's channel still linked to it) is TRUE after frames 1 to
 * `last` and FALSE after frame `last + 1` on; the cry song's FINE runs in frame `fine` and the cry player's status
 * clears after frame `stopped`.
 */
const ROM_CRIES: { species: string; mode: string; last: number; fine: number; stopped: number }[] = [];

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
    const track = info.tracks[0];
    const gotos: number[] = [];
    for (let f = 1; f <= frames[frames.length - 1] + 1 && gotos.length < frames.length; f++) {
      const before = track.cmdPtr;
      const level = track.patternLevel;
      m4aSoundMain();
      // A GOTO is the only backward jump outside a pattern (PATT / PEND change patternLevel).
      if (level === 0 && track.patternLevel === 0 && track.cmdPtr < before) gotos.push(f);
    }
    expect(gotos).toEqual(frames);
  });

  for (const c of ROM_CRIES) {
    it.todo(`${c.species} ${c.mode}: IsPokemonCryPlaying TRUE after frames 1-${c.last}, FINE in ${c.fine}, ` +
      `player free after ${c.stopped} (W-sound 2)`);
  }
});
