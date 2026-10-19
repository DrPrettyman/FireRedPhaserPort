// The PSG synth (src/audio/psgSynth.ts) on hand-built register writes, worked out by hand from GBATEK / Pan Docs
// (and mGBA's GB_AUDIO_GBA behaviour where they leave it open), the sound circuit that mixes it with the FIFOs
// (outputCore.ts's SoundCircuit), then the extracted songs rendered headless (skipped without public/gen/audio/).
//
// Units: with NR50 0x77 and SOUNDCNT_H's PSG share at 100%, a channel at level v (0-15) adds v × 8 × 8 / 4 = 16v
// to the 10-bit sum, so `levels()` divides by 16. Times: the frame sequencer's first step (0) comes 32,768 cycles
// after NR52 is switched on, its first envelope step (7) after 262,144.

import { describe, expect, test } from 'vitest';
import { m4aSongNumStart, SetPokemonCryStereo } from '../../src/audio/m4a';
import { dacOutput, SoundCircuit } from '../../src/audio/outputCore';
import { clockLfsr, noisePeriod, PsgSynth, type Noise } from '../../src/audio/psgSynth';
import {
  PSG_NR10,
  PSG_NR11,
  PSG_NR12,
  PSG_NR13,
  PSG_NR14,
  PSG_NR21,
  PSG_NR22,
  PSG_NR23,
  PSG_NR24,
  PSG_NR30,
  PSG_NR32,
  PSG_NR33,
  PSG_NR34,
  PSG_NR42,
  PSG_NR43,
  PSG_NR44,
  PSG_NR50,
  PSG_NR51,
  PSG_NR52,
  PSG_SOUNDBIAS_H,
  PSG_SOUNDCNT_H_L,
  PSG_WAVE_RAM,
  resetSoundRegs,
  SoundRegWrite8,
  takePsgFrame,
} from '../../src/audio/soundRegs';
import { haveGenAudio, loadGenAudio, render, speakerRms, speakers } from '../audioRender';

/** A PSG switched on with NR50 0x77, every channel on both sides, the PSG at 100%. */
function psg(): PsgSynth {
  const s = new PsgSynth();
  s.write(PSG_NR52, 0x80);
  s.write(PSG_NR50, 0x77);
  s.write(PSG_NR51, 0xff);
  s.write(PSG_SOUNDCNT_H_L, 2);
  return s;
}

/** `n` samples of `cycles` cycles each, as channel levels (0-15 for one channel). */
function levels(s: PsgSynth, n: number, cycles: number, side: 'l' | 'r' = 'l'): number[] {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  s.render(l, r, n, cycles);
  return Array.from(side === 'l' ? l : r, (v) => v / 16);
}

/**
 * Square 2 at `freq` (a step every 16 × (2048 − freq) cycles), restarted with NRx4 `n4` (bit 7 added). The duty
 * position free-runs from power-on, where the step timer counts 16 × 2048 cycles; `align` starts a new step now
 * (at position 0), so the samples below line up with the steps.
 */
function square2(s: PsgSynth, nr21: number, nr22: number, freq: number, n4 = 0, align = true): void {
  s.write(PSG_NR21, nr21);
  s.write(PSG_NR22, nr22);
  s.write(PSG_NR23, freq & 0xff);
  s.write(PSG_NR24, 0x80 | n4 | (freq >> 8));
  if (align) s.sq2.timer = 16 * (2048 - freq);
}

describe('squares', () => {
  test('duty: the 8-step patterns, the position free-running from power-on and kept by a restart', () => {
    for (const [duty, pattern] of [
      [0, [0, 0, 0, 0, 0, 0, 0, 1]],
      [1, [1, 0, 0, 0, 0, 0, 0, 1]],
      [2, [1, 0, 0, 0, 0, 1, 1, 1]],
      [3, [0, 1, 1, 1, 1, 1, 1, 0]],
    ] as const) {
      const s = psg();
      // freq 2032: a step every 256 cycles. The timer still counts the power-on period (16 × 2048 = 32,768
      // cycles) for step 0, then steps every 256: one sample per step from sample 128.
      square2(s, duty << 6, 0xf0, 2032, 0, false);
      const out = levels(s, 144, 256);
      expect(out.slice(0, 128).every((v) => v === pattern[0] * 15)).toBe(true);
      expect(out.slice(128, 144)).toEqual(Array.from({ length: 16 }, (_, k) => pattern[(1 + k) & 7] * 15));
      // A restart (as CgbSound writes on every volume change) doesn't move the position.
      s.write(PSG_NR24, 0x87);
      expect(levels(s, 8, 256)).toEqual(Array.from({ length: 8 }, (_, k) => pattern[(1 + 16 + k) & 7] * 15));
    }
  });

  test('a sample is the average over its cycles (a whole period: the duty share of the volume)', () => {
    const shares = [1.875, 3.75, 7.5, 11.25]; // 15 × 1/8, 2/8, 4/8, 6/8
    for (let duty = 0; duty < 4; duty++) {
      const s = psg();
      square2(s, duty << 6, 0xf0, 2032);
      expect(levels(s, 4, 2048)).toEqual([shares[duty], shares[duty], shares[duty], shares[duty]]);
    }
    // Half a step per sample (50%: steps 0, 5, 6, 7 high), then a step and a half.
    const s = psg();
    square2(s, 2 << 6, 0xf0, 2032);
    expect(levels(s, 6, 128)).toEqual([15, 15, 0, 0, 0, 0]); // steps 0, 0, 1, 1, 2, 2
    expect(levels(s, 2, 384)).toEqual([0, 10]); // step 3 and half of 4: 0; the rest of 4 and 5: 15 × 256 / 384
  });

  test('the hardware envelope: one step per NRx2 step time at 64 Hz, stopping at 0 and 15', () => {
    // 50% duty, a whole period per sample (2,048 cycles): 128 samples per 64 Hz clock.
    const down = psg();
    square2(down, 0x80, 0xf1, 2032); // 15, down, every clock
    const d = levels(down, 2048, 2048);
    for (const i of [0, 127, 128, 255, 256, 1791, 1792, 1919, 1920, 2047]) {
      expect([i, d[i]]).toEqual([i, (Math.max(0, 15 - Math.floor(i / 128)) * 7.5) / 15]);
    }
    expect(down.sq2.on).toBe(true); // at volume 0, still on
    const up = psg();
    square2(up, 0x80, 0x0a, 2032); // 0, up, every 2 clocks (0x0A: the DAC on with volume 0)
    const u = levels(up, 4352, 2048);
    for (const i of [0, 255, 256, 511, 512, 3839, 3840, 4351]) {
      expect([i, u[i]]).toEqual([i, (Math.min(15, Math.floor(i / 256)) * 7.5) / 15]);
    }
    // Step time 0: no steps (CgbSound's sustain, 0x08 | volume << 4).
    const hold = psg();
    square2(hold, 0x80, 0x98, 2032);
    expect(new Set(levels(hold, 1024, 2048))).toEqual(new Set([4.5]));
  });

  test('NRx2 with bits 3-7 clear turns the DAC (and the channel) off; 0x08 is volume 0 with the DAC on', () => {
    const s = psg();
    square2(s, 0x80, 0xf0, 2032);
    s.write(PSG_NR22, 0x08);
    expect(s.sq2.on).toBe(true);
    s.write(PSG_NR24, 0x87); // CgbOscOff: NRx2 = 8, NRx4 = 0x80: on, silent
    expect(s.sq2.on).toBe(true);
    expect(new Set(levels(s, 16, 2048))).toEqual(new Set([0]));
    s.write(PSG_NR22, 0x00);
    expect(s.sq2.on).toBe(false);
    s.write(PSG_NR24, 0x87); // a restart with the DAC off stays off
    expect(s.sq2.on).toBe(false);
  });

  test('the length counter: 64 − NRx1 bits 0-5, counted at 256 Hz when NRx4 bit 6 is set', () => {
    const s = psg();
    square2(s, 0x80 | 62, 0xf0, 2032, 0x40); // length 2
    // Length steps: step 0 at 32,768 cycles (sample 16 at 2,048 a sample) → 1, step 2 at 98,304 (sample 48) → 0.
    const out = levels(s, 64, 2048);
    expect(out.slice(0, 48).every((v) => v === 7.5)).toBe(true);
    expect(out.slice(48).every((v) => v === 0)).toBe(true);
    expect(s.sq2.on).toBe(false);
    // A restart with the counter at 0 reloads 64, less one when the sequencer's next step (here 3) doesn't count
    // lengths (mGBA's quirk), as it does after steps 1, 3, 5, 7.
    expect(s.seqStep).toBe(2);
    s.write(PSG_NR24, 0xc7);
    expect(s.sq2.length).toBe(63);
    levels(s, 16, 2048); // step 3
    s.write(PSG_NR22, 0xf0);
    s.sq2.length = 0;
    s.write(PSG_NR24, 0xc7);
    expect(s.sq2.length).toBe(64);
    // Without bit 6 the counter doesn't count.
    const free = psg();
    square2(free, 0x80 | 63, 0xf0, 2032);
    expect(levels(free, 512, 2048).every((v) => v === 7.5)).toBe(true);
  });

  test('square 1 sweep: up, the overflow check, and down', () => {
    const s = psg();
    s.write(PSG_NR10, 0x12); // time 1, up, shift 2
    s.write(PSG_NR11, 0x80);
    s.write(PSG_NR12, 0xf0);
    s.write(PSG_NR13, 0x00);
    s.write(PSG_NR14, 0x84); // 1024, restart
    // 4,096 cycles a sample: the sequencer steps every 8 samples; sweep steps 2 and 6 at samples 24, 56, 88.
    levels(s, 24, 4096);
    expect(s.sq1.freq).toBe(1024);
    levels(s, 1, 4096);
    expect(s.sq1.freq).toBe(1280); // 1024 + 1024 >> 2 (the next, 1600, passes the check)
    levels(s, 32, 4096);
    expect(s.sq1.freq).toBe(1600);
    expect(s.sq1.on).toBe(true);
    levels(s, 32, 4096);
    // 1600 + 400 = 2000 is written, then 2000 + 500 overflows: the channel goes off.
    expect(s.sq1.freq).toBe(2000);
    expect(s.sq1.on).toBe(false);

    const d = psg();
    d.write(PSG_NR10, 0x1a); // time 1, down, shift 2
    d.write(PSG_NR12, 0xf0);
    d.write(PSG_NR13, 0x00);
    d.write(PSG_NR14, 0x84);
    levels(d, 57, 4096);
    expect(d.sq1.freq).toBe(1024 - 256 - 192); // 768, then 576
    // A restart whose first step would overflow is off at once (shift ≠ 0).
    const o = psg();
    o.write(PSG_NR10, 0x01);
    o.write(PSG_NR12, 0xf0);
    o.write(PSG_NR13, 0x00);
    o.write(PSG_NR14, 0x84); // 1024 + 512 = 1536: fine
    expect(o.sq1.on).toBe(true);
    o.write(PSG_NR13, 0x80);
    o.write(PSG_NR14, 0x85); // 1408 + 704 = 2112: off
    expect(o.sq1.on).toBe(false);
  });
});

describe('noise', () => {
  test('the LFSR: XNOR of bits 0 and 1 into bit 14 (and bit 6 at 7 bits), from 0 at a restart', () => {
    const n = { lfsr: 0, width7: false, out: 0 } as Noise;
    const values: number[] = [];
    for (let i = 0; i < 4; i++) {
      clockLfsr(n);
      values.push(n.lfsr);
    }
    expect(values).toEqual([0x4000, 0x6000, 0x7000, 0x7800]);
    const n7 = { lfsr: 0, width7: true, out: 0 } as Noise;
    clockLfsr(n7);
    expect(n7.lfsr).toBe(0x4040);
    clockLfsr(n7);
    expect(n7.lfsr).toBe(0x6060);
  });

  test('its output: 14 ones, then a 0 (15 bits); 6 ones, then a 0 (7 bits)', () => {
    for (const [nr43, ones] of [
      [0x01, 14],
      [0x09, 6],
    ]) {
      const s = psg();
      s.write(PSG_NR42, 0xf0);
      s.write(PSG_NR43, nr43); // r 1, s 0: a clock every 64 cycles
      s.write(PSG_NR44, 0x80);
      // One clock per sample; sample 0 plays the bit before the first clock (0 after a restart).
      const out = levels(s, ones + 3, 64);
      expect(out).toEqual([0, ...Array(ones).fill(15), 0, 15]);
    }
  });

  test('its clock: 524,288 Hz / r / 2^(s + 1), r = 0 as 0.5; no clocks at shift 14 and 15', () => {
    const period = (nr43: number) =>
      noisePeriod({ ratio: nr43 & 7, shift: nr43 >> 4 } as Noise);
    expect(period(0x00)).toBe(32); // 2^24 / (524288 × 2)
    expect(period(0x01)).toBe(64);
    expect(period(0x07)).toBe(448);
    expect(period(0x21)).toBe(256);
    expect(period(0xd7)).toBe(448 * 8192);
    expect(period(0xe0)).toBe(Infinity);
  });
});

describe('the wave channel', () => {
  /** Loads 16 bytes into the bank NR30 0x40 lets the CPU reach (bank 0) and plays it, as CgbSound does. */
  function loadWave(s: PsgSynth, bytes: number[], nr32 = 0x20): void {
    s.write(PSG_NR30, 0x40);
    bytes.forEach((b, i) => s.write(PSG_WAVE_RAM + i, b));
    s.write(PSG_NR30, 0x00);
    s.write(PSG_NR32, nr32);
    s.write(PSG_NR30, 0x80);
    s.write(PSG_NR33, 0xe0);
    s.write(PSG_NR34, 0x87); // 2016: a sample every 8 × 32 = 256 cycles
  }
  const RAMP = [0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef];

  test('32 4-bit samples, high nibble first, each played once rotated out of the RAM', () => {
    const s = psg();
    loadWave(s, RAMP);
    // Sample 0 plays what played before (0); then the RAM's samples in order.
    const out = levels(s, 34, 256);
    expect(out).toEqual([0, ...Array.from({ length: 33 }, (_, k) => k % 16)]);
  });

  test("NR32's volume: mute, 100%, 50%, 25% (shifts) and bit 7's 75%", () => {
    for (const [nr32, f] of [
      [0x00, () => 0],
      [0x20, (v: number) => v],
      [0x40, (v: number) => v >> 1],
      [0x60, (v: number) => v >> 2],
      [0x80, (v: number) => (v * 3) >> 2],
      [0xe0, (v: number) => (v * 3) >> 2],
    ] as const) {
      const s = psg();
      loadWave(s, RAMP, nr32);
      expect(levels(s, 17, 256).slice(1)).toEqual(Array.from({ length: 16 }, (_, k) => f(k)));
    }
  });

  test('a restart keeps the position; NR30 bit 7 clear stops it; the other bank', () => {
    const s = psg();
    loadWave(s, RAMP);
    levels(s, 5, 256); // played 0, 0, 1, 2, 3; 4 rotated out at the end
    s.write(PSG_NR34, 0x87);
    expect(levels(s, 3, 256)).toEqual([4, 5, 6]); // the sample playing (4) goes on for a whole step
    s.write(PSG_NR30, 0x00);
    expect(s.wave.on).toBe(false);
    expect(levels(s, 3, 256)).toEqual([0, 0, 0]);
    // NR30 0x00 lets the CPU reach bank 1; NR30 0xC0 plays it.
    for (let i = 0; i < 16; i++) s.write(PSG_WAVE_RAM + i, 0xff);
    s.write(PSG_NR30, 0xc0);
    s.write(PSG_NR34, 0x87);
    expect(levels(s, 3, 256)).toEqual([7, 15, 15]); // 7 was playing when it stopped
    // Back to bank 0: it goes on where it stopped (sample 8 next), its rotation kept.
    s.write(PSG_NR30, 0x80);
    s.write(PSG_NR34, 0x87);
    expect(levels(s, 3, 256)).toEqual([15, 8, 9]);
  });
});

describe('mixing', () => {
  test('NR51 routes, NR50 scales each side (×1-8), SOUNDCNT_H bits 0-1 the PSG share', () => {
    const s = psg();
    s.write(PSG_NR51, 0x02); // square 2 right only
    square2(s, 0x80, 0xf0, 2032);
    expect(levels(s, 2, 2048, 'r')).toEqual([7.5, 7.5]);
    expect(levels(s, 2, 2048, 'l')).toEqual([0, 0]);
    s.write(PSG_NR51, 0x22);
    s.write(PSG_NR50, 0x30); // left 3 (×4), right 0 (×1)
    expect(levels(s, 1, 2048, 'l')).toEqual([7.5 / 2]);
    expect(levels(s, 1, 2048, 'r')).toEqual([7.5 / 8]);
    s.write(PSG_NR50, 0x77);
    s.write(PSG_SOUNDCNT_H_L, 1); // 50%
    expect(levels(s, 1, 2048)).toEqual([7.5 / 2]);
    s.write(PSG_SOUNDCNT_H_L, 0); // 25%
    expect(levels(s, 1, 2048)).toEqual([7.5 / 4]);
    // NR52 bit 7 off: silent, and NR10-NR51 ignore writes.
    s.write(PSG_NR52, 0x00);
    expect(levels(s, 1, 2048)).toEqual([0]);
    s.write(PSG_NR50, 0x77);
    expect(s.volLeft).toBe(0);
  });

  test('the circuit: the FIFOs a frame late, the PSG at once, both through the DAC', () => {
    resetSoundRegs();
    const circuit = new SoundCircuit();
    const l = new Float32Array(896);
    const r = new Float32Array(896);
    const fifo = (v: number) => new Int8Array(224).fill(v);
    // Frame 1: SoundInit's registers (SOUNDCNT_H 0x210E: A right, B left) and FIFO samples of 10 and −10.
    SoundRegWrite8(PSG_NR52, 0x8f);
    SoundRegWrite8(PSG_SOUNDCNT_H_L, 0x0e);
    SoundRegWrite8(PSG_SOUNDCNT_H_L + 1, 0x21);
    SoundRegWrite8(PSG_SOUNDBIAS_H, 0x42);
    SoundRegWrite8(PSG_NR50, 0x77);
    circuit.frame(fifo(10), fifo(-10), 0, takePsgFrame(), l, r);
    expect(new Set([...l, ...r])).toEqual(new Set([0])); // the FIFOs play next frame
    // Frame 2: square 2 at 50%, 15, on the left (NR51 bit 5); the FIFO samples of frame 1 now play.
    SoundRegWrite8(PSG_NR51, 0x20);
    SoundRegWrite8(PSG_NR21, 0x80);
    SoundRegWrite8(PSG_NR22, 0xf0);
    SoundRegWrite8(PSG_NR23, 0xe0);
    SoundRegWrite8(PSG_NR24, 0x87);
    circuit.frame(fifo(0), fifo(0), 0, takePsgFrame(), l, r);
    expect(new Set(r)).toEqual(new Set([dacOutput(10 * 4)]));
    // Left: FIFO B's −40 + the square's 0 or 240 (15 × 16), averaged per sample (313.5 cycles; a step is 512).
    expect(Math.min(...l)).toBe(dacOutput(-40));
    expect(Math.max(...l)).toBe(dacOutput(-40 + 240));
    // A missed frame: the next frame's state isn't what the writes left, so the circuit starts over from it (the
    // square, restarted in the missed frame, stays off until its next restart).
    SoundRegWrite8(PSG_NR22, 0x00);
    takePsgFrame(); // never played
    SoundRegWrite8(PSG_NR22, 0xf0);
    circuit.frame(fifo(0), fifo(0), 0, takePsgFrame(), l, r);
    expect(circuit.psg.sq2.on).toBe(false);
    // No PSG part (the dev test tone): the FIFOs only, routed by the frame's SOUNDCNT_H.
    circuit.frame(fifo(0), fifo(0), 0x0b0e, undefined, l, r);
    circuit.frame(fifo(0), fifo(0), 0x0b0e, undefined, l, r);
    expect(new Set([...l, ...r])).toEqual(new Set([0]));
  });
});

describe.skipIf(!haveGenAudio())('the extracted songs through the circuit', () => {
  /** Frames (0-based, from the song's start) where the speakers move (not one level all frame). */
  function audibleFrames(name: string, frames: number, mono = false): { audible: number[]; rms: number } {
    const songs = loadGenAudio();
    SetPokemonCryStereo(mono ? 0 : 1);
    const r = render(frames, (f) => {
      if (f === 0) m4aSongNumStart(songs.idByName.get(name)!);
    });
    const s = speakers(r);
    const audible: number[] = [];
    for (let f = 0; f < frames; f++) {
      const part = [...s.l.subarray(f * 896, (f + 1) * 896), ...s.r.subarray(f * 896, (f + 1) * 896)];
      if (Math.max(...part) > Math.min(...part)) audible.push(f);
    }
    const last = audible.length ? audible[audible.length - 1] + 1 : 0;
    return { audible, rms: speakerRms(s, 0, last * 896) };
  }

  test('the PSG-only SEs sound until the frame before their CgbOscOff (m4aCgb.test.ts: its frame, 1-based)', () => {
    const off: Record<string, number> = { SE_SELECT: 15, SE_DOOR: 22, SE_EXIT: 36, SE_PC_ON: 68, SE_WALL_HIT: 14, SE_FLEE: 39 };
    for (const [name, frame] of Object.entries(off)) {
      const { audible, rms } = audibleFrames(name, 100);
      // Heard from the frame it starts in (CgbSound's writes take effect at once) to the one before CgbOscOff's.
      expect([name, audible[0], audible[audible.length - 1]]).toEqual([name, 0, frame - 2]);
      expect([name, rms > 0.03]).toEqual([name, true]);
    }
  });

  test('MUS_PALLET and MUS_TITLE gain their square, wave and noise parts', () => {
    const songs = loadGenAudio();
    for (const name of ['MUS_PALLET', 'MUS_TITLE']) {
      loadGenAudio();
      SetPokemonCryStereo(1);
      const r = render(1200, (f) => {
        if (f === 0) m4aSongNumStart(songs.idByName.get(name)!);
      });
      const all = speakers(r);
      const fifos = speakers(r, { psg: false });
      const psgOnly = { l: all.l.map((v, i) => v - fifos.l[i]), r: all.r.map((v, i) => v - fifos.r[i]) };
      // The PSG's own part is a fair share of the music (MUS_PALLET: 0.050 against the FIFOs' 0.071).
      expect([name, speakerRms(psgOnly) > 0.02]).toEqual([name, true]);
      expect([name, speakerRms(all) > speakerRms(fifos)]).toEqual([name, true]);
    }
  });

  test('mono plays everything on both sides; stereo does not', () => {
    const songs = loadGenAudio();
    const play = (mono: boolean) => {
      loadGenAudio();
      SetPokemonCryStereo(mono ? 0 : 1);
      return speakers(render(600, (f) => f === 0 && m4aSongNumStart(songs.idByName.get('MUS_PALLET')!)));
    };
    const mono = play(true);
    expect(mono.l.every((v, i) => v === mono.r[i])).toBe(true);
    expect(speakerRms(mono)).toBeGreaterThan(0.05);
    const stereo = play(false);
    expect(stereo.l.some((v, i) => v !== stereo.r[i])).toBe(true);
    SetPokemonCryStereo(1);
  });
});
