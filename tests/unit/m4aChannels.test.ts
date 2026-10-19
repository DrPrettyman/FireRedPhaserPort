// The m4a engine's notes, channels and cries (src/audio/m4a.ts ply_note, m4aMixer.ts SoundMainRAM's bookkeeping,
// the cry song), worked by hand from m4a_1.s / m4a.c on hand-built voices, then on the extracted voice data
// (public/gen/audio/voicegroups.json, samples.json, waves.json; skipped without them).
//
// Frames: a song is started during frame 0's game logic; "frame k" is the k-th m4aSoundMain call after that. A
// note read in frame k's sequencer starts its channel in frame k's SoundMainRAM.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  gCryTable,
  gCryTable_Reverse,
  gMPlayInfo_BGM,
  gMPlayInfo_SE1,
  gMPlayInfo_SE2,
  gMPlayInfo_SE3,
  gPokemonCryMusicPlayers,
  gSoundInfo,
  IsPokemonCryPlaying,
  m4aSoundInit,
  m4aSoundMain,
  MidiKeyToFreq,
  MPlayStart,
  SetPokemonCryChorus,
  SetPokemonCryLength,
  SetPokemonCryPanpot,
  SetPokemonCryPitch,
  SetPokemonCryPriority,
  SetPokemonCryProgress,
  SetPokemonCryRelease,
  SetPokemonCryTone,
  SetPokemonCryVolume,
  setSongTable,
  setVoiceData,
  umul3232H32,
} from '../../src/audio/m4a';
import {
  SOUND_CHANNEL_SF_ENV,
  SOUND_CHANNEL_SF_LOOP,
  SOUND_CHANNEL_SF_ON,
  SOUND_CHANNEL_SF_STOP,
  type MusicPlayerTrack,
  type SongHeader,
  type SoundChannel,
  type ToneData,
  type WaveData,
} from '../../src/audio/m4aInternal';
import { loadSongTable, type SongsJson } from '../../src/audio/songTable';
import type { SamplesJson, VoicegroupsJson, WavesJson } from '../../src/audio/m4aVoices';

// ---------------------------------------------------------------------------------------------------------------
// Song bytes (sound/MPlayDef.s)

const CLOCKS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 28, 30, 32, 36, 40,
  42, 44, 48, 52, 54, 56, 60, 64, 66, 68, 72, 76, 78, 80, 84, 88, 90, 92, 96,
];
const W = (ticks: number): number => 0x80 + CLOCKS.indexOf(ticks);
const N = (ticks: number): number => 0xcf + CLOCKS.indexOf(ticks);
const FINE = 0xb1, PRIO = 0xba, VOICE = 0xbd, VOL = 0xbe, EOT = 0xce, TIE = 0xcf;

let songCount = 0;

/** A song of one or more tracks (plain bytes, no pointers) on the voices `tone`. */
function song(tracks: number[][], tone: (ToneData | null)[], priority = 0): SongHeader {
  const data: number[] = [];
  const part: number[] = [];
  for (const t of tracks) {
    part.push(data.length);
    data.push(...t);
  }
  return {
    name: `test_song_${songCount++}`, trackCount: tracks.length, blockCount: 0, priority, reverb: 0,
    voicegroup: null, tone, part, data: Uint8Array.from(data),
  };
}

/** A sample header (no PCM: the engine's logic needs none). rate in Hz; MidiKeyToFreq gives `rate` at key 60. */
function wave(size: number, opts: { rate?: number; loopStart?: number; compressed?: boolean } = {}): WaveData {
  return {
    name: 'test', type: opts.compressed ? 1 : 0, status: opts.loopStart !== undefined ? 0xc000 : 0,
    freq: (opts.rate ?? 13379) * 1024, loopStart: opts.loopStart ?? 0, size, data: null,
  };
}

function voice(type: number, wav: ToneData['wav'], adsr: [number, number, number, number] = [255, 0, 255, 0]): ToneData {
  const [attack, decay, sustain, release] = adsr;
  return { type, key: 60, length: 0, pan_sweep: 0, wav, attack, decay, sustain, release };
}

function frames(n: number): void {
  for (let i = 0; i < n; i++) m4aSoundMain();
}

const chans = (): SoundChannel[] => gSoundInfo.chans.slice(0, gSoundInfo.maxChans);
const trackChans = (track: MusicPlayerTrack): SoundChannel[] => {
  const out: SoundChannel[] = [];
  for (let c = track.chan; c; c = c.nextChannelPointer) out.push(c);
  return out;
};

beforeEach(() => {
  m4aSoundInit();
  setSongTable([]);
});

// ---------------------------------------------------------------------------------------------------------------

describe('pitch', () => {
  test('umul3232H32 is the high word of the 64-bit product', () => {
    const cases = [[0, 0], [0xffffffff, 0xffffffff], [10764288, 1 << 22], [0x12345678, 0x9abcdef0], [65535, 65537]];
    for (const [a, b] of cases) {
      expect(umul3232H32(a, b)).toBe(Number((BigInt(a) * BigInt(b)) >> 32n));
    }
  });

  test('MidiKeyToFreq: key 60 plays the sample at its rate, an octave is double, fine steps between', () => {
    const cry = wave(100, { rate: 10512 });
    expect(MidiKeyToFreq(cry, 60, 0)).toBe(10512);
    expect(MidiKeyToFreq(cry, 72, 0)).toBe(21024);
    expect(MidiKeyToFreq(cry, 48, 0)).toBe(5256);
    expect(MidiKeyToFreq(cry, 61, 0)).toBe(11137); // 10512 × 2^(1/12) = 11137.1
    const half = MidiKeyToFreq(cry, 60, 128);
    expect(half).toBeGreaterThan(10512);
    expect(half).toBeLessThan(11137);
    expect(MidiKeyToFreq(cry, 200, 0)).toBe(MidiKeyToFreq(cry, 178, 255)); // clamped
    expect(MidiKeyToFreq(null, 60, 0)).toBe(0);
  });
});

describe('DirectSound channel lifetimes', () => {
  test('a note: attack, decay, sustain, then the release after its gate time, then the channel is unlinked', () => {
    const v = voice(0x00, wave(100000), [64, 128, 100, 128]);
    MPlayStart(gMPlayInfo_BGM, song([[VOICE, 0, N(24), 60, 127, W(96), FINE]], [v]));
    const track = gMPlayInfo_BGM.tracks[0];
    const env: number[] = [];
    const state: number[] = [];
    for (let f = 1; f <= 32; f++) {
      m4aSoundMain();
      const c = gSoundInfo.chans[0];
      env.push(c.envelopeVolume);
      state.push(c.statusFlags & (SOUND_CHANNEL_SF_ON | SOUND_CHANNEL_SF_STOP));
    }
    // ATTACK +64 to 255; DECAY × 128/256 to the sustain of 100; SUSTAIN; the gate time (24 ticks: the note in
    // tick 1, 0 in tick 25) sets STOP in frame 25; RELEASE × 128/256 until it's 0 (no echo): off in frame 31.
    expect(env.slice(0, 7)).toEqual([64, 128, 192, 255, 127, 100, 100]);
    expect(env.slice(23, 30)).toEqual([100, 50, 25, 12, 6, 3, 1]);
    expect(state[23]).toBe(1); // frame 24: SUSTAIN, not released
    expect(state[24] & SOUND_CHANNEL_SF_STOP).toBeTruthy(); // frame 25
    expect(state[29]).not.toBe(0); // frame 30: still releasing
    expect(state[30]).toBe(0); // frame 31: off
    // The track keeps the channel until its next tick finds it off (frame 32).
    expect(gSoundInfo.chans[0].track).toBe(null);
    expect(track.chan).toBe(null);
  });

  test('ChnVolSetAsm and the envelope volumes', () => {
    const v = voice(0x00, wave(100000));
    MPlayStart(gMPlayInfo_BGM, song([[VOL, 100, VOICE, 0, TIE, 60, 127, W(96), FINE]], [v]));
    frames(1);
    const c = gSoundInfo.chans[0];
    // TrkVolPitSet: x = 100 × 64 >> 5 = 200, centre pan: volMR = 128 × 200 >> 8 = 100, volML = 127 × 200 >> 8 = 99
    // ChnVolSetAsm: right = 128 × 127 × 100 >> 14 = 99, left = 127 × 127 × 99 >> 14 = 97
    expect([c.rightVolume, c.leftVolume]).toEqual([99, 97]);
    // master volume 12: (13 × 255) >> 4 = 207; right = 99 × 207 >> 8 = 80, left = 97 × 207 >> 8 = 78
    expect([c.envelopeVolume, c.envelopeVolumeRight, c.envelopeVolumeLeft]).toEqual([255, 80, 78]);
  });

  test('a non-looping sample ends the channel in the frame it runs out; the track drops it the frame after', () => {
    // 13,379 Hz at key 60: divFreq 627 × frequency 13379 = 2^23 + 25 per output sample, so 224 samples a frame
    // (the 25s add up to one more sample only after 335,544).
    const v = voice(0x00, wave(224 * 3));
    MPlayStart(gMPlayInfo_SE1, song([[VOICE, 0, TIE, 60, 127, W(96), FINE]], [v], 5));
    const track = gMPlayInfo_SE1.tracks[0];
    frames(1);
    const c = track.chan!;
    expect([c.count, c.currentPointer]).toEqual([448, 224]);
    frames(1);
    expect([c.count, c.currentPointer, c.fw]).toEqual([224, 448, 2 * 224 * 25]);
    frames(1);
    expect(c.statusFlags).toBe(0); // frame 3: the 672nd step
    expect(track.chan).toBe(c); // still linked: the sequencer ran before the mixer
    frames(1);
    expect(track.chan).toBe(null); // frame 4: MPlayMain's tick unlinks it
    expect(c.track).toBe(null);

    // One sample more and it lasts into frame 4.
    m4aSoundInit();
    MPlayStart(gMPlayInfo_SE1, song([[VOICE, 0, TIE, 60, 127, W(96), FINE]], [voice(0x00, wave(224 * 3 + 1))], 5));
    frames(3);
    expect(gMPlayInfo_SE1.tracks[0].chan!.statusFlags & SOUND_CHANNEL_SF_ON).toBeTruthy();
    frames(1);
    expect(gSoundInfo.chans[0].statusFlags).toBe(0);
  });

  test('a looping sample goes back to its loop start by the overshoot and never ends', () => {
    const v = voice(0x00, wave(224 * 3, { loopStart: 100 }));
    MPlayStart(gMPlayInfo_BGM, song([[VOICE, 0, TIE, 60, 127, W(96), FINE]], [v]));
    frames(3);
    const c = gSoundInfo.chans[0];
    expect(c.statusFlags & SOUND_CHANNEL_SF_LOOP).toBeTruthy();
    // Frame 3's last step lands exactly on the end: back to 100 with the loop's 572 samples to go.
    expect([c.currentPointer, c.count]).toEqual([100, 572]);
    frames(1);
    expect([c.currentPointer, c.count]).toEqual([324, 348]);
    frames(1);
    expect([c.currentPointer, c.count]).toEqual([548, 124]);
    frames(1);
    // 124 to the end, then 100 more from the loop start (and the fw remainder, 6 × 224 × 25 < 2^23: none)
    expect([c.currentPointer, c.count]).toEqual([200, 472]);
    frames(80); // (the W96 ends the track in frame 97)
    expect(c.statusFlags & SOUND_CHANNEL_SF_ON).toBeTruthy();
  });

  test('a FIX voice steps one sample per output sample whatever its key; a higher key steps faster', () => {
    MPlayStart(gMPlayInfo_BGM, song([[VOICE, 0, TIE, 96, 127, W(96), FINE]], [voice(0x08, wave(10000, { rate: 8000 }))]));
    frames(2);
    expect(gSoundInfo.chans[0].currentPointer).toBe(448);
    m4aSoundInit();
    MPlayStart(gMPlayInfo_BGM, song([[VOICE, 0, TIE, 72, 127, W(96), FINE]], [voice(0x00, wave(10000))]));
    frames(1);
    expect(gSoundInfo.chans[0].currentPointer).toBe(448); // an octave up: 2 samples per output sample
  });

  test('a reverse voice starts at the end (minus the start offset) and runs backwards to its end', () => {
    MPlayStart(gMPlayInfo_BGM, song([[VOICE, 0, TIE, 60, 127, W(96), FINE]], [voice(0x10, wave(500))]));
    frames(1);
    const c = gSoundInfo.chans[0];
    expect([c.currentPointer, c.count]).toEqual([500 - 224, 276]);
    frames(1);
    expect([c.currentPointer, c.count]).toEqual([500 - 448, 52]);
    frames(1);
    expect(c.statusFlags).toBe(0);
  });

  test('EOT releases the held channel of its key; FINE releases and unlinks at once', () => {
    const v = voice(0x00, wave(100000), [255, 0, 255, 200]);
    MPlayStart(gMPlayInfo_BGM, song([[VOICE, 0, TIE, 60, 127, TIE, 64, 127, W(2), EOT, 60, W(2), FINE]], [v]));
    const track = gMPlayInfo_BGM.tracks[0];
    frames(1);
    const [c64, c60] = trackChans(track); // the newest first
    expect([c64.midiKey, c60.midiKey]).toEqual([64, 60]);
    frames(2);
    expect(c60.statusFlags & SOUND_CHANNEL_SF_STOP).toBeTruthy(); // frame 3: EOT 60
    expect(c64.statusFlags & SOUND_CHANNEL_SF_STOP).toBeFalsy();
    expect(trackChans(track)).toEqual([c64, c60]); // released, still linked
    frames(2);
    expect(track.chan).toBe(null); // frame 5: FINE
    expect(c64.statusFlags & SOUND_CHANNEL_SF_STOP).toBeTruthy(); // its release tail goes on, unlinked
    expect(c64.statusFlags & SOUND_CHANNEL_SF_ON).toBeTruthy();
  });

  test('the start offset (XCMD 0x0D, the cry progress) skips into the sample', () => {
    const XCMD = 0xcd;
    MPlayStart(gMPlayInfo_BGM, song([[VOICE, 0, XCMD, 0x0d, 0x64, 0, 0, 0, TIE, 60, 127, W(96), FINE]], [voice(0, wave(1000))]));
    frames(1);
    expect([gSoundInfo.chans[0].currentPointer, gSoundInfo.chans[0].count]).toEqual([100 + 224, 900 - 224]);
  });
});

describe('channel allocation and stealing', () => {
  const held = (prio = 0): number[] => [PRIO, prio, VOICE, 0, TIE, 60, 127, W(96), FINE];

  test('the BGM fills the 5 channels; a sixth BGM note of the same priority is dropped', () => {
    const v = voice(0x00, wave(100000));
    MPlayStart(gMPlayInfo_BGM, song(Array.from({ length: 6 }, () => held()), [v]));
    frames(1);
    const tracks = gMPlayInfo_BGM.tracks;
    expect(chans().map((c) => tracks.indexOf(c.track!))).toEqual([0, 1, 2, 3, 4]);
    expect(tracks[5].chan).toBe(null); // the same priority, from a track at a higher address: no steal
  });

  test('an SE steals the BGM channel of lowest priority, on a tie the one of the highest track', () => {
    const v = voice(0x00, wave(100000));
    // BGM priority 0, tracks 0-4 with track priorities 3, 1, 1, 2, 4: the lowest is 1 (tracks 1 and 2: track 2 wins).
    MPlayStart(gMPlayInfo_BGM, song([held(3), held(1), held(1), held(2), held(4)], [v]));
    MPlayStart(gMPlayInfo_SE1, song([held(0)], [v], 5));
    frames(1); // the BGM runs first (oldest first), then SE1 steals
    const bgm = gMPlayInfo_BGM.tracks;
    const se = gMPlayInfo_SE1.tracks[0];
    expect(gSoundInfo.chans[2].track).toBe(se);
    expect(bgm[2].chan).toBe(null);
    expect(gSoundInfo.chans[2].priority).toBe(5);
    expect(trackChans(se)).toEqual([gSoundInfo.chans[2]]);
    // A second SE note (SE2, priority 4) steals the next lowest: track 1's (priority 1).
    MPlayStart(gMPlayInfo_SE2, song([held(0)], [v], 4));
    frames(1);
    expect(gSoundInfo.chans[1].track).toBe(gMPlayInfo_SE2.tracks[0]);
    expect(bgm[1].chan).toBe(null);
  });

  test('a note of lower priority than every playing channel is dropped; equal priority needs a higher track', () => {
    const v = voice(0x00, wave(100000));
    MPlayStart(gMPlayInfo_SE1, song(Array.from({ length: 3 }, () => held()), [v], 5));
    MPlayStart(gMPlayInfo_SE2, song([held(), held()], [v], 5));
    frames(1);
    // The BGM (priority 3) can't take any; SE3 isn't needed: SE2's tracks are above SE1's, so a third SE2 note of
    // priority 5 would take the channel of SE2's own highest track.
    MPlayStart(gMPlayInfo_BGM, song([held(3)], [v]));
    frames(1);
    expect(gMPlayInfo_BGM.tracks[0].chan).toBe(null);
    expect(chans().every((c) => c.track && c.track !== gMPlayInfo_BGM.tracks[0])).toBe(true);
  });

  test('a released channel is taken before any playing one, whatever the priorities', () => {
    const v = voice(0x00, wave(100000), [255, 0, 255, 250]); // a long release
    MPlayStart(gMPlayInfo_SE1, song([[PRIO, 9, VOICE, 0, N(1), 60, 127, W(96), FINE]], [v], 5)); // released in frame 2
    MPlayStart(gMPlayInfo_BGM, song(Array.from({ length: 4 }, () => held()), [v]));
    frames(3);
    const released = chans().find((c) => c.statusFlags & SOUND_CHANNEL_SF_STOP)!;
    expect(released.priority).toBe(14);
    MPlayStart(gMPlayInfo_SE2, song([held()], [v], 1)); // priority 1, above the BGM's 0 but below 14
    frames(1);
    expect(released.track).toBe(gMPlayInfo_SE2.tracks[0]);
  });

  test('a CGB voice claims its PSG channel: an SE on square 1 takes it from the BGM; the BGM can not take it back', () => {
    const sq1 = voice(0x01, 2);
    MPlayStart(gMPlayInfo_BGM, song([[VOICE, 0, TIE, 60, 127, W(2), TIE, 62, 127, W(96), FINE]], [sq1]));
    frames(1);
    const cgb = gSoundInfo.cgbChans![0];
    expect(cgb.track).toBe(gMPlayInfo_BGM.tracks[0]);
    expect(cgb.statusFlags & SOUND_CHANNEL_SF_ENV).toBe(3); // CgbSound started it (attack 255)
    MPlayStart(gMPlayInfo_SE1, song([[VOICE, 0, TIE, 70, 127, W(96), FINE]], [sq1], 5));
    frames(1);
    expect(cgb.track).toBe(gMPlayInfo_SE1.tracks[0]);
    expect(cgb.midiKey).toBe(70);
    expect(gMPlayInfo_BGM.tracks[0].chan).toBe(null);
    frames(1); // frame 3: the BGM's second note is dropped
    expect(cgb.track).toBe(gMPlayInfo_SE1.tracks[0]);
    expect(gMPlayInfo_BGM.tracks[0].chan).toBe(null);
    // Square 2 is another channel: no conflict.
    expect(gSoundInfo.cgbChans![1].statusFlags).toBe(0);
  });
});

describe('keysplit and rhythm voices (hand-built)', () => {
  const a = voice(0x00, wave(1000));
  const b = voice(0x00, wave(2000));
  const drum = { ...voice(0x08, wave(3000)), key: 50, pan_sweep: 0xc0 + 16 };
  const keysplitTable: (number | null)[] = Array.from({ length: 128 }, (_, k) => (k < 60 ? 0 : 1));
  keysplitTable[10] = null; // a pointer byte

  test('a keysplit voice plays the subgroup voice its table names for the key, at the track key', () => {
    const split: ToneData = { ...voice(0x40, [a, b]), keySplitTable: keysplitTable };
    MPlayStart(gMPlayInfo_BGM, song([[VOICE, 0, TIE, 59, 127, TIE, 60, 127, TIE, 10, 127, W(96), FINE]], [split]));
    frames(1);
    const [c60, c59] = trackChans(gMPlayInfo_BGM.tracks[0]);
    expect([c59.wav, c59.key, c60.wav, c60.key]).toEqual([a.wav, 59, b.wav, 60]);
    expect(chans().filter((c) => c.track).length).toBe(2); // key 10's table entry is a pointer byte: nothing
  });

  test('a rhythm voice plays the subgroup voice at the key, at that voice\'s own key and pan', () => {
    const subgroup: (ToneData | null)[] = Array.from({ length: 128 }, () => a);
    subgroup[36] = drum;
    subgroup[37] = { ...voice(0x40, [a]), keySplitTable: keysplitTable }; // nested: silent
    const rhythm = voice(0x80, subgroup as ToneData[]);
    MPlayStart(gMPlayInfo_BGM, song([[VOL, 127, VOICE, 0, N(4), 36, 127, N(4), 37, 127, W(96), FINE]], [rhythm]));
    frames(1);
    const [c] = trackChans(gMPlayInfo_BGM.tracks[0]);
    expect([c.wav, c.key, c.midiKey, c.rhythmPan, c.type]).toEqual([drum.wav, 50, 36, 32, 0x08]);
    expect(trackChans(gMPlayInfo_BGM.tracks[0]).length).toBe(1);
    // VOL 127: x = 127 × 64 >> 5 = 254, volMR = 128 × 254 >> 8 = 127, volML = 127 × 254 >> 8 = 126; rhythmPan 32
    // pans right: right = (128 + 32) × 127 × 127 >> 14 = 157, left = (127 - 32) × 127 × 126 >> 14 = 92
    expect([c.rightVolume, c.leftVolume]).toEqual([157, 92]);
  });
});

/** sound.c PlayCryInternal's setters, with a mode's numbers (pan 0, CRY_PRIORITY_NORMAL). */
function playCry(tone: ToneData, m: CryMode): ReturnType<typeof SetPokemonCryTone> {
  SetPokemonCryVolume(m.volume);
  SetPokemonCryPanpot(0);
  SetPokemonCryPitch(m.pitch);
  SetPokemonCryLength(m.length);
  SetPokemonCryProgress(0);
  SetPokemonCryRelease(m.release);
  SetPokemonCryChorus(m.chorus);
  SetPokemonCryPriority(10);
  return SetPokemonCryTone(tone);
}

/** Frames after the call until IsPokemonCryPlaying is FALSE (the first m4aSoundMain after which it is). */
function cryFrames(mplay: ReturnType<typeof SetPokemonCryTone>): number {
  for (let f = 1; f < 1000; f++) {
    m4aSoundMain();
    if (!IsPokemonCryPlaying(mplay)) return f;
  }
  return -1;
}

describe('the cry song (hand-built cry)', () => {
  test('the length ends it (FINE after `length` ticks of xWAIT), or the sample running out does', () => {
    const long = voice(0x20, wave(100000, { rate: 10512, compressed: true }));
    let mplay = playCry(long, CRY_MODES.DOUBLES);
    let f = 0;
    while (IsPokemonCryPlaying(mplay) && f < 1000) {
      m4aSoundMain();
      f++;
    }
    expect(f).toBe(0); // not yet linked before the first frame
    for (f = 1; f < 1000; f++) {
      m4aSoundMain();
      if (!IsPokemonCryPlaying(mplay)) break;
    }
    expect(f).toBe(21); // length 20: the TIE in frame 1, xWAIT 20 ticks, EOT + FINE in frame 21

    // 10512 Hz at key 60: 627 × 10512 = 6,591,024 per output sample, 175.9993 samples a frame: 10 frames take
    // 1,759 samples. A 1,759-sample cry runs out in frame 10's mix and is unlinked in frame 11; one more sample and
    // it runs into frame 11.
    m4aSoundInit();
    mplay = playCry(voice(0x20, wave(1759, { rate: 10512, compressed: true })), CRY_MODES.NORMAL);
    expect(cryFrames(mplay)).toBe(11);
    m4aSoundInit();
    mplay = playCry(voice(0x20, wave(1760, { rate: 10512, compressed: true })), CRY_MODES.NORMAL);
    expect(cryFrames(mplay)).toBe(12);
  });

  test('two cries take the two cry players; a third replaces the one that has run longest', () => {
    const tone = voice(0x20, wave(100000, { rate: 10512, compressed: true }));
    const p0 = playCry(tone, CRY_MODES.NORMAL);
    frames(5);
    const p1 = playCry(tone, CRY_MODES.NORMAL);
    frames(1);
    expect([p0, p1]).toEqual([gPokemonCryMusicPlayers[0], gPokemonCryMusicPlayers[1]]);
    expect(playCry(tone, CRY_MODES.NORMAL)).toBe(gPokemonCryMusicPlayers[0]);
  });

  test('the pitch and chorus setters: key, tune and the chorus detune (sound.c ENCOUNTER: 15600, chorus 20)', () => {
    const tone = voice(0x20, wave(100000, { rate: 10512, compressed: true }));
    const mplay = playCry(tone, CRY_MODES.ENCOUNTER);
    frames(1);
    const [t0, t1] = mplay.tracks;
    // 15600 + 128 = 15728: key 61 (15728 >> 8), tune (15728 >> 1) & 0x7F = 56 → TUNE -8 (−0.125 semitone)
    expect([t0.key, t0.tune, t1.tune]).toEqual([61, 56 - 64, 56 + 20 - 64]);
    expect([t0.keyM, t0.pitM]).toEqual([-1, 224]); // tune × 4 = −32: keyM −1, pitM 224 (= key 60.875)
    expect(trackChans(t0).length + trackChans(t1).length).toBe(2);
    expect(mplay.trackCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The extracted voice data

interface CryMode {
  length: number;
  release: number;
  pitch: number;
  chorus: number;
  volume: number;
}
/** sound.c PlayCryInternal's mode table (the five modes AUDIO_PLAN.md section 2 estimates); CRY_VOLUME 120. */
const CRY_MODES: Record<'NORMAL' | 'DOUBLES' | 'ENCOUNTER' | 'HIGH_PITCH' | 'FAINT', CryMode> = {
  NORMAL: { length: 140, release: 0, pitch: 15360, chorus: 0, volume: 120 },
  DOUBLES: { length: 20, release: 225, pitch: 15360, chorus: 0, volume: 120 },
  ENCOUNTER: { length: 140, release: 225, pitch: 15600, chorus: 20, volume: 90 },
  HIGH_PITCH: { length: 50, release: 200, pitch: 15800, chorus: 20, volume: 90 },
  FAINT: { length: 140, release: 200, pitch: 14440, chorus: 0, volume: 120 },
};

const GEN = resolve(__dirname, '../../public/gen/audio');
const haveVoices = ['voicegroups.json', 'samples.json', 'waves.json', 'songs.json'].every((f) => existsSync(resolve(GEN, f)));
const readJson = <T,>(f: string): T => JSON.parse(readFileSync(resolve(GEN, f), 'utf8')) as T;

describe.skipIf(!haveVoices)('the extracted voice data', () => {
  const voicegroups = haveVoices ? readJson<VoicegroupsJson>('voicegroups.json') : null!;
  const samples = haveVoices ? readJson<SamplesJson>('samples.json') : null!;
  const waves = haveVoices ? readJson<WavesJson>('waves.json') : null!;
  const songs = haveVoices ? readJson<SongsJson>('songs.json') : null!;

  beforeEach(() => {
    setVoiceData(voicegroups, samples, waves);
    loadSongTable(songs);
  });

  test('setVoiceData resolves every voicegroup, the songs\' tones and the cry tables', () => {
    const data = setVoiceData(voicegroups, samples, waves);
    expect(data.voicegroups.size).toBe(Object.keys(voicegroups.voicegroups).length);
    expect(gCryTable.length).toBe(voicegroups.cries.length);
    expect(gCryTable_Reverse.length).toBe(voicegroups.criesReverse.length);
    const pidgey = (gCryTable[voicegroups.cries.findIndex((c) => c.sample === 'Cry_Pidgey')].wav as WaveData);
    expect([pidgey.name, pidgey.type, pidgey.size, pidgey.freq]).toEqual(['Cry_Pidgey', 1, 1902, 10512 * 1024]);
    expect(gCryTable_Reverse[0].type).toBe(0x30);
    const { songs: table } = loadSongTable(songs);
    expect(table.every((s) => s.header.voicegroup === null || s.header.tone?.length)).toBe(true);
    // voicegroup000: [0] a rhythm set on voicegroup001, [1] a keysplit on voicegroup003 + KeySplitTable1
    const vg0 = data.voicegroups.get('voicegroup000')!;
    expect(vg0[0]!.wav).toBe(data.voicegroups.get('voicegroup001'));
    expect(vg0[1]!.wav).toBe(data.voicegroups.get('voicegroup003'));
    expect(vg0[1]!.keySplitTable).toBe(voicegroups.keysplits.KeySplitTable1);
  });

  test('keysplit and rhythm voices of voicegroup000 resolve by key', () => {
    const vg0 = setVoiceData(voicegroups, samples, waves).voicegroups.get('voicegroup000')!;
    const sub3 = voicegroups.voicegroups.voicegroup003;
    const sub1 = voicegroups.voicegroups.voicegroup001;
    const table = voicegroups.keysplits.KeySplitTable1;
    // A rhythm key whose drum is DirectSound
    const drumKey = sub1.findIndex((v, k) => k < 128 && v !== null && v.sample !== undefined && !(v.type & 0xc0));
    MPlayStart(gMPlayInfo_BGM, song([[VOICE, 0, N(4), drumKey, 127, W(96), FINE], [VOICE, 1, N(4), 60, 127, W(96), FINE],
      [VOICE, 1, N(4), 40, 127, W(96), FINE]], vg0));
    frames(1);
    const [rhythm, high, low] = gMPlayInfo_BGM.tracks.slice(0, 3).map((t) => t.chan!);
    expect((rhythm.wav as WaveData).name).toBe(sub1[drumKey]!.sample);
    expect(rhythm.key).toBe(sub1[drumKey]!.key);
    expect((high.wav as WaveData).name).toBe(sub3[table[60]!]!.sample);
    expect((low.wav as WaveData).name).toBe(sub3[table[40]!]!.sample);
    expect([high.key, low.key]).toEqual([60, 40]);
  });

  test('no song plays a note on an unreadable keysplit entry (each song to its end, or 3,000 frames)', () => {
    // A keysplit entry is null where the ROM byte is part of a pointer (voicegroups.json); ply_note drops such a
    // note. Checked on every note ply_note gets.
    const hits = new Set<string>();
    const table = loadSongTable(songs).songs;
    for (const s of songs.songs) {
      m4aSoundInit();
      const plynote = gSoundInfo.plynote;
      gSoundInfo.plynote = (cmd, info, track) => {
        plynote(cmd, info, track);
        const t = track.tone;
        if (t.type & 0x40 && t.keySplitTable && t.keySplitTable[track.key] == null) hits.add(`${s.name} key ${track.key}`);
      };
      const info = [gMPlayInfo_BGM, gMPlayInfo_SE1, gMPlayInfo_SE2, gMPlayInfo_SE3][s.ms];
      MPlayStart(info, table[s.id].header);
      for (let f = 0; f < 3000 && !(info.status & 0x80000000); f++) m4aSoundMain();
    }
    expect([...hits]).toEqual([]);
  }, 60_000);

  // IsPokemonCryPlaying's lifetime, in frames after the call (the first m4aSoundMain after which it is FALSE),
  // set up as sound.c's PlayCryInternal does (pan 0, CRY_PRIORITY_NORMAL). AUDIO_PLAN.md section 2's estimates
  // in the comments.
  // IsPokemonCryPlaying's lifetime in frames after the call (the first m4aSoundMain after which it is FALSE), set
  // up as sound.c's PlayCryInternal does. AUDIO_PLAN.md section 2 estimated min(length + 1, 1 + samples / 176 ×
  // 2^(-pitch / 12)) by hand; the engine agrees with every one of its estimates. (The sample runs at 175.9993
  // source samples a frame at key 60; ENCOUNTER / HIGH_PITCH / FAINT play at keys 60.875 / 61.4375 / 56.8125.)
  test.each([
    // name, samples: NORMAL, ENCOUNTER, FAINT, HIGH_PITCH, DOUBLES
    ['Pidgey', 1902, 12, 12, 14, 11, 12],
    ['NidoranF', 4775, 29, 27, 34, 26, 21],
    ['Bulbasaur', 8183, 48, 46, 57, 44, 21],
    ['Pikachu', 8233, 48, 46, 58, 45, 21],
    ['Charizard', 9539, 56, 53, 67, 51, 21],
    ['Onix', 12257, 71, 68, 85, 51, 21],
    ['Mew', 15064, 87, 83, 104, 51, 21],
    ['Jynx', 23524, 135, 129, 141, 51, 21],
    ['Magmar', 7655, 45, 43, 54, 42, 21],
  ] as const)('%s (%i samples): NORMAL %i, ENCOUNTER %i, FAINT %i, HIGH_PITCH %i, DOUBLES %i frames', (name, size, ...want) => {
    const cryId = voicegroups.cries.findIndex((c) => c.sample === `Cry_${name}`);
    expect(samples[`Cry_${name}`].size).toBe(size);
    const modes = ['NORMAL', 'ENCOUNTER', 'FAINT', 'HIGH_PITCH', 'DOUBLES'] as const;
    const got = modes.map((m) => {
      m4aSoundInit();
      return cryFrames(playCry(gCryTable[cryId], CRY_MODES[m]));
    });
    expect(got).toEqual(want);
  });

  test('a cry steals a BGM channel and the BGM keeps playing on the rest', () => {
    const cryId = voicegroups.cries.findIndex((c) => c.sample === 'Cry_Pikachu');
    const idByName = loadSongTable(songs).idByName;
    MPlayStart(gMPlayInfo_BGM, loadSongTable(songs).songs[idByName.get('MUS_PALLET')!].header);
    frames(60);
    const before = chans().filter((c) => c.track && gMPlayInfo_BGM.tracks.includes(c.track)).length;
    const mplay = playCry(gCryTable[cryId], CRY_MODES.ENCOUNTER); // chorus: two channels
    frames(1);
    const cry = chans().filter((c) => c.track && mplay.tracks.includes(c.track));
    expect(cry.length).toBe(2);
    expect(cry.every((c) => c.priority === 10)).toBe(true);
    expect(before).toBeGreaterThan(0);
    expect(IsPokemonCryPlaying(mplay)).toBe(true);
  });
});
