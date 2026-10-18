// The m4a engine's sequencer (src/audio/m4a.ts) on hand-written song bytes, worked by hand from m4a_1.s / m4a.c,
// then on the extracted songs (public/gen/audio/songs.json) when they are there.
//
// Frames: a song is started during frame 0's game logic; "frame k" is the k-th m4aSoundMain call after that (the
// k-th VBlank). At the default tempo (150 BPM, tempoI = 150) one tick runs per frame, the first in frame 1.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  gMPlayInfo_BGM,
  gMPlayInfo_SE1,
  gMPlayInfo_SE2,
  gMPlayInfo_SE3,
  gMPlayMemAccArea,
  gMPlayTable,
  gPokemonCryMusicPlayers,
  gSoundInfo,
  m4aMPlayAllContinue,
  m4aMPlayAllStop,
  m4aMPlayContinue,
  m4aMPlayFadeIn,
  m4aMPlayFadeOut,
  m4aMPlayFadeOutTemporarily,
  m4aMPlayImmInit,
  m4aMPlayPanpotControl,
  m4aMPlayPitchControl,
  m4aMPlayStop,
  m4aMPlayTempoControl,
  m4aMPlayVolumeControl,
  m4aSongNumContinue,
  m4aSongNumStart,
  m4aSongNumStartOrChange,
  m4aSongNumStartOrContinue,
  m4aSongNumStop,
  m4aSoundInit,
  m4aSoundMain,
  MPlayStart,
  setSongTable,
} from '../../src/audio/m4a';
import {
  MPT_FLG_EXIST,
  MUSICPLAYER_STATUS_PAUSE,
  MUSICPLAYER_STATUS_TRACK,
  TRACKS_ALL,
  type MusicPlayerInfo,
  type SongHeader,
} from '../../src/audio/m4aInternal';
import { loadSongTable, type SongsJson } from '../../src/audio/songTable';

// ---------------------------------------------------------------------------------------------------------------
// A tiny assembler for MPlayDef.s's commands. Waits and note lengths by their tick counts (W24 = W(24)).

const CLOCKS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 28, 30, 32, 36, 40,
  42, 44, 48, 52, 54, 56, 60, 64, 66, 68, 72, 76, 78, 80, 84, 88, 90, 92, 96,
]; // sound/MPlayDef.s: W00 = 0x80 ... W96 = 0xB0
const W = (ticks: number): number => {
  const i = CLOCKS.indexOf(ticks);
  if (i < 0) throw new Error(`no W${ticks}`);
  return 0x80 + i;
};
const N = (ticks: number): number => 0xcf + CLOCKS.indexOf(ticks); // N01 = 0xD0 ... N96 = 0xFF
const FINE = 0xb1, GOTO = 0xb2, PATT = 0xb3, PEND = 0xb4, REPT = 0xb5, MEMACC = 0xb9, PRIO = 0xba, TEMPO = 0xbb;
const KEYSH = 0xbc, VOICE = 0xbd, VOL = 0xbe, PAN = 0xbf, BEND = 0xc0, BENDR = 0xc1, TUNE = 0xc8, XCMD = 0xcd;
const EOT = 0xce, TIE = 0xcf, xWAIT = 0x0c;

type Item = number | { label: string } | { ref: string };
const L = (label: string): Item => ({ label });
const R = (ref: string): Item => ({ ref });

let songCount = 0;

/** Assembles tracks into one song's bytes; labels are shared by the song's tracks. */
function song(tracks: Item[][], opts: { priority?: number; reverb?: number } = {}): SongHeader {
  const bytes: number[] = [];
  const labels = new Map<string, number>();
  const refs: [number, string][] = [];
  const part: number[] = [];
  for (const items of tracks) {
    part.push(bytes.length);
    for (const it of items) {
      if (typeof it === 'number') bytes.push(it);
      else if ('label' in it) labels.set(it.label, bytes.length);
      else {
        refs.push([bytes.length, it.ref]);
        bytes.push(0, 0, 0, 0);
      }
    }
  }
  for (const [at, name] of refs) {
    const target = labels.get(name);
    if (target === undefined) throw new Error(`no label ${name}`);
    bytes[at] = target & 0xff;
    bytes[at + 1] = (target >> 8) & 0xff;
    bytes[at + 2] = (target >> 16) & 0xff;
    bytes[at + 3] = (target >> 24) & 0xff;
  }
  return {
    name: `test_song_${songCount++}`, trackCount: tracks.length, blockCount: 0, priority: opts.priority ?? 0,
    reverb: opts.reverb ?? 0, voicegroup: null, tone: null, part, data: Uint8Array.from(bytes),
  };
}

const live = (info: MusicPlayerInfo): number => info.status & MUSICPLAYER_STATUS_TRACK;
const paused = (info: MusicPlayerInfo): boolean => (info.status & MUSICPLAYER_STATUS_PAUSE) !== 0;

function frames(n: number): void {
  for (let i = 0; i < n; i++) m4aSoundMain();
}

/** Runs frames until the player's tracks are all gone (FINE), and until its status has no live track; returns
 *  both frame numbers. */
function runToEnd(info: MusicPlayerInfo, cap = 20000): { fine: number; stopped: number } {
  let fine = -1;
  for (let f = 1; f <= cap; f++) {
    m4aSoundMain();
    if (fine < 0 && info.tracks.slice(0, info.trackCount).every((t) => !(t.flags & MPT_FLG_EXIST))) fine = f;
    if (live(info) === 0) return { fine, stopped: f };
  }
  return { fine, stopped: -1 };
}

beforeEach(() => {
  m4aSoundInit();
  setSongTable([]);
});

// ---------------------------------------------------------------------------------------------------------------

describe('init', () => {
  test('m4aSoundInit: sound mode, players, the MPlayMain chain', () => {
    expect(gSoundInfo.maxChans).toBe(5);
    expect(gSoundInfo.masterVolume).toBe(12);
    expect(gSoundInfo.freq).toBe(4);
    expect(gSoundInfo.pcmSamplesPerVBlank).toBe(224);
    expect(gSoundInfo.pcmFreq).toBe(13379); // (597275 * 224 + 5000) / 10000
    expect(gSoundInfo.pcmDmaPeriod).toBe(7); // 1584 / 224
    expect(gMPlayTable.map((m) => [m.info.name, m.info.trackCount, m.info.unk_B])).toEqual([
      ['gMPlayInfo_BGM', 10, 0],
      ['gMPlayInfo_SE1', 3, 1],
      ['gMPlayInfo_SE2', 9, 1],
      ['gMPlayInfo_SE3', 1, 0],
    ]);
    for (const m of gMPlayTable) {
      expect(m.info.status).toBe(MUSICPLAYER_STATUS_PAUSE);
      expect(m.info.memAccArea).toBe(gMPlayMemAccArea);
    }
    // MPlayOpen puts each player at the head: the chain from SoundMain is newest first.
    const chain: string[] = [];
    for (let p = gSoundInfo.musicPlayerHead; p; p = p.musicPlayerNext) chain.push(p.name);
    expect(chain).toEqual([
      'gPokemonCryMusicPlayers[1]', 'gPokemonCryMusicPlayers[0]', 'gMPlayInfo_SE3', 'gMPlayInfo_SE2',
      'gMPlayInfo_SE1', 'gMPlayInfo_BGM',
    ]);
    expect(gPokemonCryMusicPlayers[0].trackCount).toBe(2);
    expect(gPokemonCryMusicPlayers[0].unk_B).toBe(0);
  });

  test('MPlayMain runs the rest of the chain before its own player, so the work runs oldest first', () => {
    // BGM sets memAcc[0] = 1 in its first tick; SE1, started the same frame, jumps on memAcc[0] == 1. If SE1 ran
    // before BGM it would fall through to FINE.
    MPlayStart(gMPlayInfo_BGM, song([[MEMACC, 0, 0, 1, W(96), FINE]]));
    MPlayStart(gMPlayInfo_SE1, song([[MEMACC, 6, 0, 1, R('yes'), W(1), FINE, L('yes'), W(96), FINE]], { priority: 5 }));
    frames(3);
    expect(gMPlayMemAccArea[0]).toBe(1);
    expect(live(gMPlayInfo_SE1)).toBe(1);
    // And SE1's MEMACC does run its jump: without the BGM write it ends.
    m4aSoundInit();
    MPlayStart(gMPlayInfo_SE1, song([[MEMACC, 6, 0, 1, R('yes'), W(1), FINE, L('yes'), W(96), FINE]], { priority: 5 }));
    frames(3);
    expect(live(gMPlayInfo_SE1)).toBe(0);
  });
});

describe('tempo and ticks', () => {
  test('default tempo: one tick per frame; FINE after W24 in frame 25; status clears a tick later', () => {
    MPlayStart(gMPlayInfo_SE1, song([[W(24), FINE]]));
    expect(gMPlayInfo_SE1.status).toBe(0); // until the first tick
    frames(1);
    expect(gMPlayInfo_SE1.clock).toBe(1);
    expect(live(gMPlayInfo_SE1)).toBe(1);
    expect(runToEnd(gMPlayInfo_SE1)).toEqual({ fine: 25 - 1, stopped: 26 - 1 }); // counted from frame 2
  });

  test('runToEnd from the start', () => {
    MPlayStart(gMPlayInfo_SE1, song([[W(24), FINE]]));
    expect(runToEnd(gMPlayInfo_SE1)).toEqual({ fine: 25, stopped: 26 });
    expect(gMPlayInfo_SE1.status).toBe(MUSICPLAYER_STATUS_PAUSE);
    expect(gMPlayInfo_SE1.clock).toBe(26); // the empty tick counts too
  });

  test('TEMPO 75 is one tick per frame, TEMPO 150 two, TEMPO 50 two in three frames', () => {
    MPlayStart(gMPlayInfo_BGM, song([[TEMPO, 75, L('a'), W(96), GOTO, R('a')]]));
    frames(10);
    expect(gMPlayInfo_BGM.tempoI).toBe(150);
    expect(gMPlayInfo_BGM.clock).toBe(10);

    MPlayStart(gMPlayInfo_BGM, song([[TEMPO, 150, L('a'), W(96), GOTO, R('a')]]));
    frames(10);
    // frame 1: tempoC 150 → 1 tick at the start tempo (TEMPO runs in it), tempoC 0; then 300 a frame: 2 ticks.
    expect(gMPlayInfo_BGM.tempoI).toBe(300);
    expect(gMPlayInfo_BGM.clock).toBe(1 + 9 * 2);

    MPlayStart(gMPlayInfo_BGM, song([[TEMPO, 50, L('a'), W(96), GOTO, R('a')]]));
    // tempoC after each frame: 0 (tick), 100, 50 (tick), 0 (tick), 100, 50 (tick), 0 (tick)
    const clocks: number[] = [];
    for (let f = 0; f < 7; f++) {
      m4aSoundMain();
      clocks.push(gMPlayInfo_BGM.clock);
    }
    expect(clocks).toEqual([1, 1, 2, 3, 3, 4, 5]);
  });

  test('a slow tempo clears the status at the next tick, not the next frame', () => {
    // TEMPO 25: tempoI 50, a tick every 3 frames after the first. Ticks at frames 1, 4, 7, ...
    MPlayStart(gMPlayInfo_SE1, song([[TEMPO, 25, W(2), FINE]]));
    // tick 1 (frame 1): W02 → wait 1; tick 2 (frame 4): wait 0; tick 3 (frame 7): FINE; tick 4 (frame 10): none live.
    expect(runToEnd(gMPlayInfo_SE1)).toEqual({ fine: 7, stopped: 10 });
  });

  test('waits come from gClockTable', () => {
    MPlayStart(gMPlayInfo_SE1, song([[W(96), W(72), W(1), W(0), W(28), FINE]]));
    expect(runToEnd(gMPlayInfo_SE1).fine).toBe(96 + 72 + 1 + 0 + 28 + 1);
  });

  test('m4aMPlayTempoControl scales the tempo (0x100 = 1x)', () => {
    MPlayStart(gMPlayInfo_BGM, song([[L('a'), W(96), GOTO, R('a')]]));
    m4aMPlayTempoControl(gMPlayInfo_BGM, 0x200);
    frames(4);
    expect(gMPlayInfo_BGM.tempoI).toBe(300);
    expect(gMPlayInfo_BGM.clock).toBe(8);
  });
});

describe('flow commands', () => {
  test('GOTO loops forever', () => {
    MPlayStart(gMPlayInfo_BGM, song([[W(5), L('loop'), W(12), GOTO, R('loop')]]));
    frames(1000);
    expect(live(gMPlayInfo_BGM)).toBe(1);
    // 5 ticks, then 12 a loop from tick 6: tick 1000 is the 11th of a loop (994 = 82 × 12 + 10), leaving 1.
    expect(gMPlayInfo_BGM.tracks[0].wait).toBe(1);
    frames(2);
    expect(gMPlayInfo_BGM.tracks[0].wait).toBe(11);
  });

  test('PATT / PEND call and return', () => {
    MPlayStart(gMPlayInfo_SE1, song([[PATT, R('sub'), PATT, R('sub'), W(3), FINE], [L('sub'), W(10), PEND]]));
    // Track 1 is the subroutine's own bytes: W10, then PEND at level 0 (ignored), then the end of the data (read
    // as FINE) in tick 11. Track 0 decides the end.
    expect(runToEnd(gMPlayInfo_SE1).fine).toBe(10 + 10 + 3 + 1);
  });

  test('PATT more than three deep ends the track', () => {
    MPlayStart(gMPlayInfo_SE1, song([[L('a'), W(1), PATT, R('a')]]));
    // tick 1: W01; ticks 2-4: PATT (levels 1, 2, 3) and W01; tick 5: a fourth PATT, which is FINE
    expect(runToEnd(gMPlayInfo_SE1).fine).toBe(5);
  });

  test('REPT n repeats n times; REPT 0 forever', () => {
    MPlayStart(gMPlayInfo_SE1, song([[L('a'), W(5), REPT, 3, R('a'), W(1), FINE]]));
    expect(runToEnd(gMPlayInfo_SE1).fine).toBe(15 + 1 + 1);
    MPlayStart(gMPlayInfo_SE1, song([[L('a'), W(5), REPT, 0, R('a'), FINE]]));
    frames(500);
    expect(live(gMPlayInfo_SE1)).toBe(1);
  });

  test('xWAIT waits its length plus one tick', () => {
    MPlayStart(gMPlayInfo_SE1, song([[XCMD, xWAIT, 5, 0, FINE]]));
    expect(runToEnd(gMPlayInfo_SE1).fine).toBe(6);
  });

  test('two tracks: the status bits drop one tick after each FINE', () => {
    MPlayStart(gMPlayInfo_SE2, song([[W(10), FINE], [W(20), FINE]]));
    frames(11);
    expect(gMPlayInfo_SE2.tracks[0].flags).toBe(0);
    expect(live(gMPlayInfo_SE2)).toBe(0b11);
    frames(1);
    expect(live(gMPlayInfo_SE2)).toBe(0b10);
    frames(9);
    expect(live(gMPlayInfo_SE2)).toBe(0b10); // frame 21: track 1's FINE
    frames(1);
    expect(gMPlayInfo_SE2.status).toBe(MUSICPLAYER_STATUS_PAUSE);
  });
});

describe('track state commands', () => {
  test('VOL, PAN, KEYSH, TUNE, BEND, BENDR, PRIO and TrkVolPitSet', () => {
    MPlayStart(gMPlayInfo_BGM, song([[VOL, 100, PAN, 0x40 + 20, KEYSH, 0xfe, TUNE, 0x40 + 8, BENDR, 12, BEND, 0x40 - 2,
      PRIO, 30, W(96), FINE]]));
    frames(1);
    const t = gMPlayInfo_BGM.tracks[0];
    expect([t.vol, t.pan, t.keyShift, t.tune, t.bendRange, t.bend, t.priority]).toEqual([100, 20, -2, 8, 12, -2, 30]);
    // TrkVolPitSet: x = 100 * 64 >> 5 = 200; y = 2 * 20 = 40; R = 168 * 200 >> 8 = 131, L = 87 * 200 >> 8 = 67
    expect([t.volMR, t.volML]).toEqual([131, 67]);
    // pitch: (8 + -2 * 12) * 4 + (-2 << 8) = -64 - 512 = -576: keyM = -576 >> 8 = -3, pitM = -576 & 0xFF = 192
    expect([t.keyM, t.pitM]).toEqual([-3, 192]);
    expect(t.flags & 0x0f).toBe(0);
  });

  test('running status repeats VOL and notes; note arguments and gate times', () => {
    MPlayStart(gMPlayInfo_BGM, song([[VOL, 50, W(1), 60, W(1), N(24), 60, 100, W(1), 62, W(1), N(12), 64, 90, 3, W(1),
      TIE, 70, 80, W(1), EOT, 70, W(1), EOT, W(96), FINE]]));
    const t = gMPlayInfo_BGM.tracks[0];
    frames(1);
    expect(t.vol).toBe(50);
    frames(1);
    expect(t.vol).toBe(60); // running VOL
    frames(1);
    expect([t.gateTime, t.key, t.velocity]).toEqual([24, 60, 100]);
    frames(1);
    expect([t.gateTime, t.key, t.velocity]).toEqual([24, 62, 100]); // running N24, key only
    frames(1);
    expect([t.gateTime, t.key, t.velocity]).toEqual([15, 64, 90]); // N12 + 3 (mid2agb -E)
    frames(1);
    expect([t.gateTime, t.key, t.velocity]).toEqual([0, 70, 80]); // TIE
    frames(2);
    expect(t.key).toBe(70); // EOT 70, then EOT (no key)
    expect(t.flags & MPT_FLG_EXIST).toBeTruthy();
  });

  test('VOICE with no voicegroup loaded leaves the tone alone', () => {
    MPlayStart(gMPlayInfo_BGM, song([[VOICE, 3, W(1), FINE]]));
    frames(1);
    expect(gMPlayInfo_BGM.tracks[0].tone.type).toBe(1); // the first tick's reset
    expect(gMPlayInfo_BGM.tracks[0].cmdPtr).toBe(3);
  });

  test('the first tick resets the track (bendRange 2, volX 64, lfoSpeed 22)', () => {
    MPlayStart(gMPlayInfo_BGM, song([[W(96), FINE]]));
    frames(1);
    const t = gMPlayInfo_BGM.tracks[0];
    expect([t.bendRange, t.volX, t.lfoSpeed, t.flags & 0xf0]).toEqual([2, 64, 22, MPT_FLG_EXIST]);
  });

  test('m4aMPlayImmInit resets tracks still waiting for their first tick', () => {
    MPlayStart(gMPlayInfo_BGM, song([[W(96), FINE]]));
    gMPlayInfo_BGM.tracks[0].volX = 5;
    m4aMPlayImmInit(gMPlayInfo_BGM);
    expect(gMPlayInfo_BGM.tracks[0].volX).toBe(64);
    expect(gMPlayInfo_BGM.tracks[0].flags).toBe(MPT_FLG_EXIST);
  });
});

describe('MPlayStart priority', () => {
  test('SE1 / SE2 keep a song of higher priority; equal or higher replaces it', () => {
    const high = song([[W(48), FINE]], { priority: 5 });
    const low = song([[W(48), FINE]], { priority: 4 });
    const same = song([[W(48), FINE]], { priority: 5 });
    MPlayStart(gMPlayInfo_SE1, high);
    frames(1);
    MPlayStart(gMPlayInfo_SE1, low);
    expect(gMPlayInfo_SE1.songHeader).toBe(high);
    MPlayStart(gMPlayInfo_SE1, same);
    expect(gMPlayInfo_SE1.songHeader).toBe(same);
    // Once it has ended (or is paused), any priority starts.
    runToEnd(gMPlayInfo_SE1);
    MPlayStart(gMPlayInfo_SE1, low);
    expect(gMPlayInfo_SE1.songHeader).toBe(low);
    frames(1);
    m4aMPlayStop(gMPlayInfo_SE1);
    MPlayStart(gMPlayInfo_SE2, high); // (another player: no effect on SE1)
    MPlayStart(gMPlayInfo_SE1, song([[W(1), FINE]], { priority: 0 }));
    expect(gMPlayInfo_SE1.songHeader?.priority).toBe(0);
  });

  test('a song started this frame (before its first tick) keeps a lower-priority one out', () => {
    const high = song([[W(48), FINE]], { priority: 5 });
    MPlayStart(gMPlayInfo_SE2, high);
    expect(gMPlayInfo_SE2.status).toBe(0); // no live track yet, but the track waits for its first tick
    MPlayStart(gMPlayInfo_SE2, song([[W(48), FINE]], { priority: 4 }));
    expect(gMPlayInfo_SE2.songHeader).toBe(high);
  });

  test('BGM and SE3 always restart', () => {
    for (const info of [gMPlayInfo_BGM, gMPlayInfo_SE3]) {
      MPlayStart(info, song([[W(48), FINE]], { priority: 9 }));
      frames(1);
      const low = song([[W(48), FINE]], { priority: 0 });
      MPlayStart(info, low);
      expect(info.songHeader).toBe(low);
    }
  });

  test('extra tracks are cleared; the song reverb goes to m4aSoundMode', () => {
    MPlayStart(gMPlayInfo_BGM, song([[W(96), FINE], [W(96), FINE], [W(96), FINE]]));
    frames(1);
    expect(live(gMPlayInfo_BGM)).toBe(0b111);
    MPlayStart(gMPlayInfo_BGM, song([[W(96), FINE]], { reverb: 0x80 | 50 }));
    expect(gMPlayInfo_BGM.tracks[1].flags).toBe(0);
    expect(gSoundInfo.reverb).toBe(50);
    frames(1);
    expect(live(gMPlayInfo_BGM)).toBe(1);
  });
});

describe('pause and continue', () => {
  test('m4aMPlayStop keeps the position; m4aMPlayContinue resumes from it', () => {
    MPlayStart(gMPlayInfo_BGM, song([[W(30), W(30), FINE]]));
    frames(10);
    m4aMPlayStop(gMPlayInfo_BGM);
    expect(paused(gMPlayInfo_BGM)).toBe(true);
    expect(live(gMPlayInfo_BGM)).toBe(1); // the track bits stay
    const { clock } = gMPlayInfo_BGM;
    const { wait, cmdPtr } = gMPlayInfo_BGM.tracks[0];
    frames(100);
    expect(gMPlayInfo_BGM.clock).toBe(clock);
    expect([gMPlayInfo_BGM.tracks[0].wait, gMPlayInfo_BGM.tracks[0].cmdPtr]).toEqual([wait, cmdPtr]);
    m4aMPlayContinue(gMPlayInfo_BGM);
    expect(runToEnd(gMPlayInfo_BGM).fine).toBe(61 - 10);
  });

  test('m4aMPlayAllStop / m4aMPlayAllContinue', () => {
    MPlayStart(gMPlayInfo_BGM, song([[W(96), FINE]]));
    MPlayStart(gMPlayInfo_SE1, song([[W(96), FINE]]));
    frames(1);
    m4aMPlayAllStop();
    expect(gMPlayTable.every((m) => paused(m.info))).toBe(true);
    expect(gPokemonCryMusicPlayers.every(paused)).toBe(true);
    frames(5);
    expect(gMPlayInfo_SE1.clock).toBe(1);
    m4aMPlayAllContinue();
    frames(5);
    expect([gMPlayInfo_BGM.clock, gMPlayInfo_SE1.clock]).toEqual([6, 6]);
  });

  test('m4aSongNum*: by song id through gSongTable', () => {
    const a = song([[W(30), FINE]]);
    const b = song([[W(30), FINE]]);
    setSongTable([{ header: a, ms: 0, me: 0 }, { header: b, ms: 0, me: 0 }]);
    m4aSongNumStart(0);
    expect(gMPlayInfo_BGM.songHeader).toBe(a);
    frames(5);
    m4aSongNumStartOrChange(0); // already playing: no restart
    expect(gMPlayInfo_BGM.clock).toBe(5);
    m4aSongNumStop(1); // not the current song: nothing
    expect(paused(gMPlayInfo_BGM)).toBe(false);
    m4aSongNumStop(0);
    expect(paused(gMPlayInfo_BGM)).toBe(true);
    m4aSongNumStartOrContinue(0); // paused current song: continue, keeping the clock
    expect(paused(gMPlayInfo_BGM)).toBe(false);
    expect(gMPlayInfo_BGM.clock).toBe(5);
    m4aSongNumStop(0);
    m4aSongNumContinue(0);
    expect(paused(gMPlayInfo_BGM)).toBe(false);
    m4aSongNumStop(0);
    m4aSongNumStartOrChange(0); // paused: restart
    expect(gMPlayInfo_BGM.clock).toBe(0);
    m4aSongNumStartOrChange(1);
    expect(gMPlayInfo_BGM.songHeader).toBe(b);
  });
});

describe('fades', () => {
  const endless = (): SongHeader => song([[VOL, 100, L('a'), W(96), GOTO, R('a')], [VOL, 100, L('b'), W(96), GOTO, R('b')]]);

  test('m4aMPlayFadeOut: one step of 4/64 every `speed` frames, stopped after 16 steps', () => {
    MPlayStart(gMPlayInfo_BGM, endless());
    frames(1);
    m4aMPlayFadeOut(gMPlayInfo_BGM, 3);
    const volX: number[] = [];
    let stoppedAt = -1;
    for (let f = 1; f <= 60 && stoppedAt < 0; f++) {
      m4aSoundMain();
      volX.push(gMPlayInfo_BGM.tracks[0].volX);
      if (live(gMPlayInfo_BGM) === 0) stoppedAt = f;
    }
    expect(stoppedAt).toBe(16 * 3);
    expect(volX.slice(0, 7)).toEqual([64, 64, 60, 60, 60, 56, 56]);
    expect(volX[15 * 3 - 1]).toBe(4);
    expect(gMPlayInfo_BGM.status).toBe(MUSICPLAYER_STATUS_PAUSE);
    expect(gMPlayInfo_BGM.tracks[0].flags).toBe(0);
    // TrkVolPitSet follows volX: at volX 4, x = 100 * 4 >> 5 = 12
  });

  test('m4aMPlayFadeOutTemporarily pauses after 17 steps (fadeOV 257); m4aMPlayFadeIn resumes in 16', () => {
    MPlayStart(gMPlayInfo_BGM, endless());
    frames(1);
    m4aMPlayFadeOutTemporarily(gMPlayInfo_BGM, 2);
    let f = 0;
    while (!paused(gMPlayInfo_BGM)) {
      m4aSoundMain();
      f++;
    }
    expect(f).toBe(17 * 2);
    expect(live(gMPlayInfo_BGM)).toBe(0b11); // still there, paused
    expect(gMPlayInfo_BGM.tracks[0].flags & MPT_FLG_EXIST).toBeTruthy();
    const clock = gMPlayInfo_BGM.clock;
    m4aMPlayFadeIn(gMPlayInfo_BGM, 2);
    expect(paused(gMPlayInfo_BGM)).toBe(false);
    const volX: number[] = [];
    for (let i = 0; i < 40; i++) {
      m4aSoundMain();
      volX.push(gMPlayInfo_BGM.tracks[0].volX);
    }
    expect(volX[1]).toBe(4); // 2 + 16 = 18 >> 2
    expect(volX[31]).toBe(64);
    expect(gMPlayInfo_BGM.fadeOI).toBe(0);
    expect(gMPlayInfo_BGM.clock).toBe(clock + 40);
    expect(gMPlayInfo_BGM.tracks[0].volMR).toBe(100); // x = 100 * 64 >> 5 = 200, (0 + 128) * 200 >> 8
  });
});

describe('volume, pan and pitch control', () => {
  test('m4aMPlayVolumeControl: volX = volume / 4 on the selected tracks', () => {
    MPlayStart(gMPlayInfo_BGM, song([[VOL, 100, W(96), FINE], [VOL, 100, W(96), FINE]]));
    frames(1);
    m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 85); // PlayCry_Normal's duck
    frames(1);
    const [t0, t1] = gMPlayInfo_BGM.tracks;
    expect(t0.volX).toBe(21);
    // x = 100 * 21 >> 5 = 65; R = 128 * 65 >> 8 = 32; L = 127 * 65 >> 8 = 32
    expect([t0.volMR, t0.volML]).toEqual([32, 32]);
    m4aMPlayVolumeControl(gMPlayInfo_BGM, 0b10, 256);
    frames(1);
    expect([t0.volX, t1.volX]).toEqual([21, 64]);
    expect([t1.volMR, t1.volML]).toEqual([100, 99]);
  });

  test('m4aMPlayPanpotControl: panX', () => {
    MPlayStart(gMPlayInfo_SE1, song([[VOL, 100, W(96), FINE]]));
    frames(1);
    m4aMPlayPanpotControl(gMPlayInfo_SE1, TRACKS_ALL, -64);
    frames(1);
    const t = gMPlayInfo_SE1.tracks[0];
    // y = -64: R = 64 * 200 >> 8 = 50, L = 191 * 200 >> 8 = 149
    expect([t.panX, t.volMR, t.volML]).toEqual([-64, 50, 149]);
    m4aMPlayPanpotControl(gMPlayInfo_SE1, TRACKS_ALL, 127);
    frames(1);
    expect([t.volMR, t.volML]).toEqual([199, 0]);
  });

  test('m4aMPlayPitchControl: keyShiftX and pitX', () => {
    MPlayStart(gMPlayInfo_SE1, song([[W(96), FINE]]));
    frames(1);
    m4aMPlayPitchControl(gMPlayInfo_SE1, TRACKS_ALL, -0x180);
    frames(1);
    const t = gMPlayInfo_SE1.tracks[0];
    // keyShiftX = -0x180 >> 8 = -2, pitX = 0x80: x = -512 + 128 = -384: keyM -2, pitM 0x80
    expect([t.keyShiftX, t.pitX, t.keyM, t.pitM]).toEqual([-2, 0x80, -2, 0x80]);
  });
});

describe('songs.json loader', () => {
  test('loadSongTable decodes the bytes and checks the players', () => {
    const json: SongsJson = {
      players: gMPlayTable.map((m) => ({ name: m.info.name, tracks: m.unk_8 })),
      songs: [
        { id: 0, name: 'mus_dummy', ms: 0, me: 0, priority: 0, reverb: 0, blockCount: 0, voicegroup: null, tracks: [0],
          data: btoa(String.fromCharCode(W(24), FINE)) },
        { id: 1, name: 'se_test', ms: 1, me: 1, priority: 5, reverb: 0xb2, blockCount: 0, voicegroup: 'voicegroup128',
          tracks: [0, 2], data: btoa(String.fromCharCode(W(2), FINE, W(4), FINE)) },
      ],
    };
    const table = loadSongTable(json);
    expect(table.idByName.get('SE_TEST')).toBe(1);
    m4aSongNumStart(1);
    expect(gMPlayInfo_SE1.songHeader?.voicegroup).toBe('voicegroup128');
    expect(runToEnd(gMPlayInfo_SE1)).toEqual({ fine: 5, stopped: 6 });
    expect(() => loadSongTable({ ...json, players: json.players.slice(1) })).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The extracted songs (W-audiodata 1). Skipped until public/gen/audio/songs.json exists.

const SONGS_JSON = resolve(__dirname, '../../public/gen/audio/songs.json');

describe.skipIf(!existsSync(SONGS_JSON))('the extracted songs', () => {
  const json = existsSync(SONGS_JSON) ? (JSON.parse(readFileSync(SONGS_JSON, 'utf8')) as SongsJson) : null;
  const id = (name: string): number => {
    const s = json!.songs.find((x) => x.name.toUpperCase() === name);
    if (!s) throw new Error(`no ${name}`);
    return s.id;
  };

  /** Plays one song alone from a fresh engine. */
  function measure(name: string, cap = 20000): { fine: number; stopped: number } {
    m4aSoundInit();
    loadSongTable(json!);
    const songId = id(name);
    m4aSongNumStart(songId);
    return runToEnd(gMPlayTable[json!.songs[songId].ms].info, cap);
  }

  test('every song ends in FINE or loops', () => {
    // MUS_CREDITS is the longest that ends (14,971 frames); a song still playing after 15,000 frames loops.
    let ended = 0;
    let looped = 0;
    for (const s of json!.songs) {
      m4aSoundInit();
      loadSongTable(json!);
      m4aSongNumStart(s.id);
      const { stopped } = runToEnd(gMPlayTable[s.ms].info, 15000);
      if (stopped > 0) ended++;
      else looped++;
    }
    expect({ ended, looped }).toEqual({ ended: 270, looped: 77 }); // spike 2's counts (MUS_DUMMY ends at once)
  }, 30_000);

  // The frame of the last FINE and the frame after which the player's status has no live track (IsSEPlaying /
  // IsBGMPlaying turn FALSE): the next tick after the FINE, which is the next frame at tempos up to 150 BPM
  // (tempoI 150), can be the same frame above it (two ticks in a frame) and can be two frames later below it.
  // Spike 2's model (AUDIO_PLAN.md) agrees on the FINE frames except MUS_LEVEL_UP (63 there): its first tick runs
  // at the default 150 BPM before its TEMPO 87, which the model didn't count.
  test.each([
    ['SE_SELECT', 10, 11],
    ['SE_LEDGE', 13, 14],
    ['SE_WALL_HIT', 18, 19],
    ['SE_SAVE', 43, 44],
    ['SE_PC_ON', 61, 62],
    ['SE_FAINT', 51, 53],
    ['SE_FLEE', 40, 41],
    ['SE_EXP', 99, 100],
    ['SE_DOOR', 34, 36],
    ['MUS_LEVEL_UP', 64, 64],
    ['MUS_OBTAIN_ITEM', 146, 147],
    ['MUS_OBTAIN_BADGE', 313, 315],
    ['MUS_EVOLVED', 229, 230],
    ['MUS_SLOTS_WIN', 151, 153],
    ['MUS_SLOTS_JACKPOT', 262, 264],
    ['MUS_DEX_RATING', 200, 202],
    ['MUS_HEAL', 138, 139],
    ['MUS_POKE_FLUTE', 3061, 3063],
    ['MUS_CREDITS', 14970, 14971],
  ])('%s: FINE in frame %i, stopped after frame %i', (name, fine, stopped) => {
    expect(measure(name)).toEqual({ fine, stopped });
  });
});
