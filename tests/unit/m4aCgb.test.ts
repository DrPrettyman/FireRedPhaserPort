// The PSG channels (src/audio/m4aCgb.ts: CgbSound, CgbModVol, CgbOscOff, MidiKeyToCgbFreq) and the sound
// registers they write (src/audio/soundRegs.ts), worked by hand from m4a.c on hand-built voices, then on the
// extracted songs (skipped without public/gen/audio/).
//
// Frames: a song is started before frame 1; "frame k" is the k-th m4aSoundMain call. A note read in frame k's
// sequencer starts its channel in frame k's CgbSound. c15 is 0 after m4aSoundInit, so CgbSound's double envelope
// step falls on frames 15, 30, 45, ...

import { describe, expect, test, beforeEach } from 'vitest';
import {
  gMPlayInfo_BGM,
  gSoundInfo,
  m4aPcmFrame,
  m4aMPlayStop,
  m4aSongNumStart,
  m4aSoundInit,
  m4aSoundMain,
  MPlayStart,
  SetPokemonCryStereo,
  setSongTable,
} from '../../src/audio/m4a';
import { CgbModVol, MidiKeyToCgbFreq } from '../../src/audio/m4aCgb';
import { type CgbChannel, type SongHeader, type ToneData } from '../../src/audio/m4aInternal';
import { gCgbScaleTable } from '../../src/audio/m4aTables';
import {
  PSG_STATE_BANK0,
  PSG_STATE_BANK1,
  PSG_STATE_SIZE,
  SoundRegRead8,
  SoundRegWrite8,
  soundRegsSnapshot,
  takePsgFrame,
} from '../../src/audio/soundRegs';
import { haveGenAudio, loadGenAudio } from '../audioRender';

// ---------------------------------------------------------------------------------------------------------------
// Helpers

const CLOCKS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 28, 30, 32, 36, 40,
  42, 44, 48, 52, 54, 56, 60, 64, 66, 68, 72, 76, 78, 80, 84, 88, 90, 92, 96,
];
const W = (ticks: number): number => 0x80 + CLOCKS.indexOf(ticks);
const N = (ticks: number): number => 0xcf + CLOCKS.indexOf(ticks);
const FINE = 0xb1, VOICE = 0xbd, VOL = 0xbe, XCMD = 0xcd, EOT = 0xce, TIE = 0xcf, xIECV = 0x08, xIECL = 0x09;

const REG_NAMES: Record<number, string> = {
  0x00: 'NR10', 0x02: 'NR11', 0x03: 'NR12', 0x04: 'NR13', 0x05: 'NR14', 0x08: 'NR21', 0x09: 'NR22', 0x0c: 'NR23',
  0x0d: 'NR24', 0x10: 'NR30', 0x12: 'NR31', 0x13: 'NR32', 0x14: 'NR33', 0x15: 'NR34', 0x18: 'NR41', 0x19: 'NR42',
  0x1c: 'NR43', 0x1d: 'NR44', 0x20: 'NR50', 0x21: 'NR51', 0x22: 'CNTH_L', 0x23: 'CNTH_H', 0x24: 'NR52',
  0x28: 'BIAS_L', 0x29: 'BIAS_H',
};
/** A write as `NR12=09`; wave RAM as `WAVE3=33`. */
const fmt = (w: number): string => {
  const off = w >> 8;
  const name = off >= 0x30 && off < 0x40 ? `WAVE${(off - 0x30).toString(16)}` : (REG_NAMES[off] ?? off.toString(16));
  return `${name}=${(w & 0xff).toString(16).padStart(2, '0')}`;
};
const writes = (): string => Array.from(takePsgFrame().writes, fmt).join(' ');

let songCount = 0;
function song(track: number[], tone: ToneData[], priority = 0): SongHeader {
  return {
    name: `cgb_test_${songCount++}`, trackCount: 1, blockCount: 0, priority, reverb: 0, voicegroup: null, tone,
    part: [0], data: Uint8Array.from(track),
  };
}

function cgbVoice(type: number, wav: ToneData['wav'], adsr: [number, number, number, number], panSweep = 0): ToneData {
  const [attack, decay, sustain, release] = adsr;
  return { type, key: 60, length: 0, pan_sweep: panSweep, wav, attack, decay, sustain, release };
}

/** VOICE 0, VOL 127, the pseudo echo, one note, then a long wait. */
function noteSong(v: ToneData, key: number, velocity: number, gate: number, echo: [number, number] = [0, 0]): SongHeader {
  return song([VOICE, 0, VOL, 127, XCMD, xIECV, echo[0], XCMD, xIECL, echo[1], N(gate), key, velocity, W(96), FINE], [v]);
}

/** Runs `n` frames; returns each frame's writes. */
function run(n: number): string[] {
  const out: string[] = [];
  for (let f = 0; f < n; f++) {
    m4aSoundMain();
    out.push(writes());
  }
  return out;
}

const WAVE = Uint8Array.from({ length: 16 }, (_, i) => i * 0x11);

beforeEach(() => {
  m4aSoundInit();
  setSongTable([]);
});

// ---------------------------------------------------------------------------------------------------------------

describe('MidiKeyToCgbFreq', () => {
  test('gCgbScaleTable is m4a_tables.c\'s', () => {
    expect(gCgbScaleTable.length).toBe(132);
    expect(gCgbScaleTable[0]).toBe(0x00);
    expect(gCgbScaleTable[11]).toBe(0x0b);
    expect(gCgbScaleTable[12]).toBe(0x10);
    expect(gCgbScaleTable[130]).toBe(0xaa);
    expect(gCgbScaleTable[131]).toBe(0xab);
  });

  test('squares and wave: 2048 + gCgbFreqTable >> octave, interpolated by fineAdjust, clamped', () => {
    expect(MidiKeyToCgbFreq(1, 36, 0)).toBe(-2004 + 2048); // 44
    expect(MidiKeyToCgbFreq(1, 48, 0)).toBe((-2004 >> 1) + 2048); // 1046
    expect(MidiKeyToCgbFreq(2, 60, 0)).toBe(0x60b); // -2004 >> 2 = -501
    expect(MidiKeyToCgbFreq(3, 69, 0)).toBe(0x6d6); // A: -1192 >> 2 = -298 → 1750 (131072 / 298 = 439.8 Hz)
    expect(MidiKeyToCgbFreq(1, 36, 128)).toBe(-2004 + ((128 * 113) >> 8) + 2048); // 100
    expect(MidiKeyToCgbFreq(1, 48, 1)).toBe(1046); // (1 × 56) >> 8 = 0
    // B (0x1B: -1062 >> 1 = -531) toward C (0x20: -2004 >> 2 = -501)
    expect(MidiKeyToCgbFreq(1, 59, 255)).toBe(-531 + ((255 * 30) >> 8) + 2048);
    // Below 36: key 36 with no fine adjustment; above 166: key 166 at fine 255 (-1125 >> 10 = -2, -1062 >> 10 = -2).
    expect(MidiKeyToCgbFreq(1, 35, 200)).toBe(44);
    expect(MidiKeyToCgbFreq(1, 0, 0)).toBe(44);
    expect(MidiKeyToCgbFreq(1, 200, 0)).toBe(2046);
  });

  test('noise: gNoiseTable from key 21 to 80', () => {
    expect(MidiKeyToCgbFreq(4, 0, 0)).toBe(0xd7);
    expect(MidiKeyToCgbFreq(4, 20, 0)).toBe(0xd7);
    expect(MidiKeyToCgbFreq(4, 21, 0)).toBe(0xd7);
    expect(MidiKeyToCgbFreq(4, 22, 0)).toBe(0xd6);
    expect(MidiKeyToCgbFreq(4, 60, 0)).toBe(0x44);
    expect(MidiKeyToCgbFreq(4, 76, 0)).toBe(0x04);
    expect(MidiKeyToCgbFreq(4, 77, 0)).toBe(0x03);
    expect(MidiKeyToCgbFreq(4, 80, 99)).toBe(0x00);
    expect(MidiKeyToCgbFreq(4, 127, 0)).toBe(0x00);
  });
});

describe('the sound registers', () => {
  test('m4aSoundInit: SoundInit, MPlayExtender and m4aSoundMode write them in the C\'s order', () => {
    m4aSoundInit();
    expect(writes()).toBe(
      // SoundInit: SOUNDCNT_X, SOUNDCNT_H (stereo), SOUNDBIAS_H (0x02 from the BIOS: (0x02 & 0x3F) | 0x40)
      'NR52=8f CNTH_L=0e CNTH_H=21 BIAS_H=42 ' +
        // MPlayExtender
        'NR52=8f NR50=00 NR51=00 NR12=08 NR22=08 NR42=08 NR14=80 NR24=80 NR44=80 NR30=00 NR50=77 ' +
        // m4aSoundMode(SOUND_MODE_DA_BIT_8 ...): (0x900000 & 0x300000) >> 14 = 0x40
        'BIAS_H=42',
    );
    expect(writes()).toBe('');
  });

  test('wave RAM: a write goes to the bank NR30 bit 6 does not play; the state holds both banks', () => {
    takePsgFrame();
    SoundRegWrite8(0x10, 0x40); // NR30: play bank 1
    SoundRegWrite8(0x30, 0xab); // → bank 0
    SoundRegWrite8(0x10, 0x00); // play bank 0
    SoundRegWrite8(0x30, 0xcd); // → bank 1
    expect(SoundRegRead8(0x30)).toBe(0xcd);
    const regs = soundRegsSnapshot();
    expect(regs.length).toBe(PSG_STATE_SIZE);
    expect(regs[PSG_STATE_BANK0]).toBe(0xab);
    expect(regs[PSG_STATE_BANK1]).toBe(0xcd);
    // The frame: the state before the writes, then the writes in order.
    const frame = takePsgFrame();
    expect(frame.state[PSG_STATE_BANK0]).toBe(0);
    expect(frame.state[0x20]).toBe(0x77); // NR50 from MPlayExtender
    expect(Array.from(frame.writes)).toEqual([0x1040, 0x30ab, 0x1000, 0x30cd]);
    expect(takePsgFrame().state).toEqual(regs);
  });

  test('m4aPcmFrame carries the frame\'s writes; SetPokemonCryStereo writes SOUNDCNT_H', () => {
    takePsgFrame();
    SetPokemonCryStereo(0);
    const frame = m4aPcmFrame();
    expect(Array.from(frame.psg.writes, fmt).join(' ')).toBe('CNTH_L=02 CNTH_H=33');
    expect(frame.soundcntH).toBe(0x3302);
    expect(m4aPcmFrame().psg.writes.length).toBe(0);
  });
});

describe('CgbModVol', () => {
  const chan = (right: number, left: number, sustain = 8): CgbChannel =>
    ({ ...gSoundInfo.cgbChans![0], rightVolume: right, leftVolume: left, sustain, panMask: 0x11 });

  test('stereo: twice as loud on one side → that side only, goal at most 15; else both sides, goal unclamped', () => {
    const c = chan(200, 60);
    CgbModVol(gSoundInfo, c);
    expect(c.pan).toBe(0x01); // 0x0F & 0x11
    expect(c.envelopeGoal).toBe(15); // 260 / 16 = 16, clamped
    expect(c.sustainGoal).toBe((15 * 8 + 15) >> 4);
    const l = chan(60, 200);
    CgbModVol(gSoundInfo, l);
    expect(l.pan).toBe(0x10);
    const both = chan(200, 101);
    CgbModVol(gSoundInfo, both);
    expect(both.pan).toBe(0x11);
    expect(both.envelopeGoal).toBe(18); // 301 / 16: not clamped
  });

  test('mono (SetPokemonCryStereo(0), soundInfo.mode bit 0): both sides, goal unclamped', () => {
    SetPokemonCryStereo(0);
    const c = chan(200, 60);
    CgbModVol(gSoundInfo, c);
    expect(c.pan).toBe(0x11);
    expect(c.envelopeGoal).toBe(16);
    expect(c.sustainGoal).toBe((16 * 8 + 15) >> 4);
  });
});

describe('CgbSound, frame by frame (m4a.c:925)', () => {
  test('a square 1 note: attack, decay, sustain, release, the pseudo echo, off', () => {
    // Velocity 32 at VOL 127, centred: right (128 × 32 × 127) >> 14 = 31, left (127 × 32 × 126) >> 14 = 31, so the
    // goal is 62 / 16 = 3 and the sustain goal (3 × 8 + 15) >> 4 = 2. ADSR 1 / 1 / 8 / 2, echo 128 for 3 frames.
    const v = cgbVoice(0x01, 2, [1, 1, 8, 2]);
    MPlayStart(gMPlayInfo_BGM, noteSong(v, 60, 32, 12, [128, 3]));
    writes();
    const chan = gSoundInfo.cgbChans![0];
    const track = gMPlayInfo_BGM.tracks[0];
    const frames = run(20);
    expect(frames).toEqual([
      // 1: START: the sweep (none: 8), duty 2 and length 0, the envelope from 0 rising every frame (NR12 0x09), key
      //    60 (0x60B), centred (NR51 bits 0x11), a restart.
      'NR10=08 NR11=80 NR13=0b NR14=06 NR51=11 NR12=09 NR14=86',
      // 2-3: attack 1 → 2 in software only: the hardware envelope does the same.
      '', '',
      // 4: 3 reaches the goal: decay from 3, falling every frame.
      'NR51=11 NR12=31 NR14=86',
      // 5: 2 ≤ the sustain goal: sustain at 2, the envelope still.
      'NR51=11 NR12=28 NR14=86',
      // 6-12: sustain (CgbModVol again at 11, counter 7).
      '', '', '', '', '', '', '',
      // 13: the gate time ends (STOP): release from 2, falling every 2 frames.
      'NR51=11 NR12=22 NR14=86',
      // 14, 15 (c15: two steps, 2 → 1)
      '', '',
      // 16: 0: the pseudo echo at (3 × 128 + 255) >> 8 = 2.
      'NR51=11 NR12=28 NR14=86',
      // 17-18: the echo's 3 frames.
      '', '',
      // 19: CgbOscOff.
      'NR12=08 NR14=80',
      '',
    ]);
    expect(chan.statusFlags).toBe(0);
    // The track unlinks the channel in its next tick (MPlayMain's ClearChain).
    expect(track.chan).toBe(null);
  });

  test('the envelope state along the way', () => {
    const v = cgbVoice(0x01, 2, [1, 1, 8, 2]);
    MPlayStart(gMPlayInfo_BGM, noteSong(v, 60, 32, 12, [128, 3]));
    const chan = gSoundInfo.cgbChans![0];
    const states: string[] = [];
    for (let f = 1; f <= 19; f++) {
      m4aSoundMain();
      states.push(`${chan.statusFlags.toString(16)}:${chan.envelopeVolume}`);
    }
    expect(states).toEqual([
      '3:0', '3:1', '3:2', '2:3', '1:2', '1:2', '1:2', '1:2', '1:2', '1:2', '1:2', '1:2', // attack, decay, sustain
      '40:2', '40:2', '40:1', // release
      '44:2', '44:2', '44:2', // the echo (IEC)
      '0:2', // off
    ]);
  });

  test('square 1 with a rising sweep restarts twice; square 2 has no sweep', () => {
    const v = cgbVoice(0x01, 1, [0, 0, 15, 0], 0x17);
    MPlayStart(gMPlayInfo_BGM, noteSong(v, 60, 127, 3));
    writes();
    // Velocity 127: right 126, left 124: goal 250 / 16 = 15, sustain goal 15. Attack and decay 0: straight to
    // sustain (NR12 0xF8). NR10 = 0x17 has bit 3 clear (a rising sweep): NR14 written twice.
    expect(run(1)).toEqual(['NR10=17 NR11=40 NR13=0b NR14=06 NR51=11 NR12=f8 NR14=86 NR14=86']);
    m4aSoundInit();
    writes();
    const v2 = cgbVoice(0x02, 3, [0, 0, 15, 0]);
    MPlayStart(gMPlayInfo_BGM, noteSong(v2, 72, 127, 3));
    // Key 72: -2004 >> 3 = -251 → 1797 = 0x705. No release, no echo: off when the gate time ends (frame 4).
    expect(run(4)).toEqual(['NR21=c0 NR23=05 NR24=07 NR51=22 NR22=f8 NR24=87', '', '', 'NR22=08 NR24=80']);
  });

  test('a wave note: the wave RAM through NR30\'s bank switch, NR32 from gCgb3Vol at each step', () => {
    // Velocity 127: goal 15, sustain goal 8. ADSR 0 / 2 / 8 / 1: decay from 15 at once, released at frame 7.
    const v = cgbVoice(0x03, WAVE, [0, 2, 8, 1]);
    MPlayStart(gMPlayInfo_BGM, noteSong(v, 69, 127, 6));
    writes();
    const wave = Array.from(WAVE, (b, i) => `WAVE${i.toString(16)}=${b.toString(16).padStart(2, '0')}`).join(' ');
    expect(run(20)).toEqual([
      // 1: NR30 0x40 (play bank 1, write bank 0), the 16 bytes, NR30 0 (play bank 0), length 0; key 69 (0x6D6)
      //    with n4 0x80 (a restart, DAC still off), centred (0x44), volume 15 → 0x20 (100%), DAC on, restart.
      `NR30=40 ${wave} NR30=00 NR31=00 NR33=d6 NR34=86 NR51=44 NR32=20 NR30=80 NR34=86`,
      '', // 2
      'NR51=44 NR32=20', // 3: decay, volume 14 (NR32 rewritten at each step for the wave)
      '',
      'NR51=44 NR32=80', // 5: 13 (75%)
      '',
      'NR51=44 NR32=80', // 7: released (STOP) at 13; release 1: a step every frame
      'NR51=44 NR32=80', // 8: 12
      'NR51=44 NR32=80', // 9: 11
      'NR51=44 NR32=80', // 10: 10
      'NR51=44 NR32=40', // 11: 9 (50%)
      'NR51=44 NR32=40', // 12: 8
      'NR51=44 NR32=40', // 13: 7
      'NR51=44 NR32=40', // 14: 6
      'NR51=44 NR32=60', // 15: c15, two steps (5, 4): 25%
      'NR51=44 NR32=60', // 16: 3
      'NR51=44 NR32=60', // 17: 2
      'NR51=44 NR32=00', // 18: 1 (off in gCgb3Vol)
      'NR30=00', // 19: 0, echo volume 0: CgbOscOff (the DAC off)
      '',
    ]);
    // The same wave again: no reload.
    MPlayStart(gMPlayInfo_BGM, noteSong(v, 69, 127, 6));
    expect(run(1)[0]).toBe('NR30=00 NR31=00 NR33=d6 NR34=86 NR51=44 NR32=20 NR30=80 NR34=86');
  });

  test('a noise note: the width in NR43 bit 3, the clock from gNoiseTable; released with no release or echo', () => {
    const v = cgbVoice(0x04, 1, [0, 0, 15, 0]);
    MPlayStart(gMPlayInfo_BGM, noteSong(v, 60, 127, 3));
    writes();
    expect(run(5)).toEqual([
      // NR41 length 0, NR43 = 1 << 3 (7-bit), then (NR43 & 8) | 0x44; NR44 0 (no restart yet); NR42 0xF8, restart.
      'NR41=00 NR43=08 NR43=4c NR44=00 NR51=88 NR42=f8 NR44=80',
      '', '',
      'NR42=08 NR44=80', // 4: STOP, release 0, echo 0: off at once
      '',
    ]);
    expect(gSoundInfo.cgbChans![3].statusFlags).toBe(0);
  });

  test('a note released in the frame it starts is switched off; a stopped track switches its channel off', () => {
    const v = cgbVoice(0x02, 2, [0, 0, 15, 0]);
    // TIE then EOT in the same tick: START with STOP.
    MPlayStart(gMPlayInfo_BGM, song([VOICE, 0, VOL, 127, TIE, 60, 127, EOT, W(96), FINE], [v]));
    writes();
    expect(run(1)).toEqual(['NR22=08 NR24=80']);
    expect(gSoundInfo.cgbChans![1].statusFlags).toBe(0);

    MPlayStart(gMPlayInfo_BGM, noteSong(v, 60, 127, 30));
    run(2);
    // m4aMPlayStop (the game logic, e.g. m4aSongNumStop) → TrackStop → CgbOscOff, at once.
    m4aMPlayStop(gMPlayInfo_BGM);
    expect(writes()).toBe('NR22=08 NR24=80');
    expect(gSoundInfo.cgbChans![1].statusFlags).toBe(0);
  });

  test('the pseudo echo with the track\'s IEC length counts frames, then off; IEC volume 0 is off at once', () => {
    const v = cgbVoice(0x02, 2, [0, 0, 15, 0]);
    MPlayStart(gMPlayInfo_BGM, noteSong(v, 60, 127, 2, [64, 5]));
    const chan = gSoundInfo.cgbChans![1];
    const flags: number[] = [];
    for (let f = 1; f <= 9; f++) {
      m4aSoundMain();
      flags.push(chan.statusFlags);
    }
    // 1: sustain; 3: released with release 0: the echo at (15 × 64 + 255) >> 8 = 4; 4-7 count 5 down; 8: off.
    expect(flags).toEqual([1, 1, 0x44, 0x44, 0x44, 0x44, 0x44, 0, 0]);
  });
});

describe.skipIf(!haveGenAudio())('the extracted songs', () => {
  let songs: ReturnType<typeof loadGenAudio>;
  beforeEach(() => {
    songs = loadGenAudio();
    takePsgFrame();
  });
  const id = (name: string) => songs.idByName.get(name)!;

  test('SE_SELECT (square 1) starts square 1 and switches it off again', () => {
    m4aSongNumStart(id('SE_SELECT'));
    const frames = run(30);
    expect(frames[0]).toMatch(/^NR10=\w\w NR11=\w\w NR13=\w\w NR14=\w\w NR51=\w\w NR12=\w\w NR14=8/);
    const last = frames.map((w, i) => (w ? i : -1)).filter((i) => i >= 0).pop()!;
    expect(frames[last].endsWith('NR12=08 NR14=80')).toBe(true);
    expect(gSoundInfo.cgbChans!.every((c) => c.statusFlags === 0)).toBe(true);
  });

  test('MUS_ROUTE1 plays all four channels: squares, the wave (its RAM loaded) and noise', () => {
    m4aSongNumStart(id('MUS_ROUTE1'));
    const all = run(300).join(' ');
    for (const reg of ['NR14=8', 'NR24=8', 'NR34=8', 'NR44=8', 'WAVE0=']) expect(all).toContain(reg);
  });

  test('the PSG-only SEs: the frame of their last write (CgbOscOff), after which every channel is off', () => {
    // The engine's numbers under the C's rules checked above (W-ref 2 compares them with the ROM).
    const lastWrite: Record<string, number> = { SE_SELECT: 15, SE_DOOR: 22, SE_EXIT: 36, SE_PC_ON: 68, SE_WALL_HIT: 14, SE_FLEE: 39 };
    for (const [name, frame] of Object.entries(lastWrite)) {
      m4aSoundInit();
      takePsgFrame();
      m4aSongNumStart(id(name));
      const frames = run(120);
      const last = frames.map((w, i) => (w ? i + 1 : 0)).reduce((a, b) => Math.max(a, b));
      expect([name, last]).toEqual([name, frame]);
      expect(gSoundInfo.cgbChans!.every((c) => c.statusFlags === 0)).toBe(true);
      expect(frames[last - 1]).toMatch(/(NR\d2=08 NR\d4=80|NR30=00)$/);
    }
  });
});
