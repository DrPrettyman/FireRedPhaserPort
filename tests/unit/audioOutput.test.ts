// The browser output's pure parts (src/audio/outputCore.ts): when the output is on, the GBA's DirectSound DAC
// (GBATEK's sound mixer: FIFO samples ×4 at 100% / ×2 at 50%, + SOUNDBIAS 0x200, clipped to 10 bits, 8-bit
// resolution at SOUNDBIAS_H 0x40) and the sample-and-hold upsampler with its buffer.

import { describe, expect, test } from 'vitest';
import {
  dacOutput,
  decideOutput,
  directSoundLevel,
  frameToDac,
  isHeadlessBrowser,
  PCM_INPUT_RATE,
  SampleHoldResampler,
  SOUND_A_LEFT_OUTPUT,
  SOUND_ALL_MIX_FULL,
  SOUND_B_LEFT_OUTPUT,
  SOUNDCNT_H_MONO,
  SOUNDCNT_H_STEREO,
} from '../../src/audio/outputCore';

describe('decideOutput', () => {
  const browser = { headless: false, dev: true };
  test('on by default, off headless or fast-forwarded', () => {
    expect(decideOutput('', browser)).toEqual({ enabled: true, reason: 'default', tone: false });
    expect(decideOutput('?map=PalletTown', { headless: true, dev: true })).toMatchObject({ enabled: false, reason: 'headless' });
    expect(decideOutput('?speed=8', browser)).toMatchObject({ enabled: false, reason: 'speed' });
    expect(decideOutput('?speed=1', browser)).toMatchObject({ enabled: true, reason: 'default' });
    // ?speed= is a dev flag: a production build runs at 1 whatever the URL says.
    expect(decideOutput('?speed=8', { headless: false, dev: false })).toMatchObject({ enabled: true });
  });
  test('?audio= forces it', () => {
    expect(decideOutput('?audio=1&speed=8', { headless: true, dev: true })).toEqual({ enabled: true, reason: 'flag', tone: false });
    expect(decideOutput('?audio=0', browser)).toEqual({ enabled: false, reason: 'flag', tone: false });
    expect(decideOutput('?audio=tone', { headless: true, dev: true })).toEqual({ enabled: true, reason: 'flag', tone: true });
    expect(decideOutput('?audio=tone', { headless: false, dev: false })).toEqual({ enabled: true, reason: 'default', tone: false });
  });
  test('headless Chrome', () => {
    const chrome = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ';
    expect(isHeadlessBrowser({ webdriver: false, userAgent: chrome + 'HeadlessChrome/155.0.0.0 Safari/537.36' })).toBe(true);
    expect(isHeadlessBrowser({ webdriver: true, userAgent: chrome + 'Chrome/155.0.0.0 Safari/537.36' })).toBe(true);
    expect(isHeadlessBrowser({ webdriver: false, userAgent: chrome + 'Chrome/155.0.0.0 Safari/537.36' })).toBe(false);
  });
});

describe('the DAC', () => {
  test('stereo (SoundInit): FIFO A right, FIFO B left, each sample as it is', () => {
    expect(directSoundLevel(10, -20, SOUNDCNT_H_STEREO, false)).toBe(40);
    expect(directSoundLevel(10, -20, SOUNDCNT_H_STEREO, true)).toBe(-80);
    // 0x200 + 40 = 552 → >> 2 = 138 → 10 above the middle.
    expect(dacOutput(40)).toBe(10 / 128);
    expect(dacOutput(-80)).toBe(-20 / 128);
    for (const s of [-128, -1, 0, 1, 127]) expect(dacOutput(directSoundLevel(s, 0, SOUNDCNT_H_STEREO, false))).toBe(s / 128);
  });
  test('mono (SetPokemonCryStereo(0)): both FIFOs to both speakers at half, the low bit lost', () => {
    expect(directSoundLevel(10, -20, SOUNDCNT_H_MONO, true)).toBe(-20);
    expect(directSoundLevel(10, -20, SOUNDCNT_H_MONO, false)).toBe(-20);
    expect(dacOutput(-20)).toBe(-5 / 128); // (10 - 20) / 2
    expect(dacOutput(directSoundLevel(1, 0, SOUNDCNT_H_MONO, true))).toBe(0); // 0x202 >> 2 = 0x80
    expect(dacOutput(directSoundLevel(-1, 0, SOUNDCNT_H_MONO, true))).toBe(-1 / 128); // 0x1FE >> 2 = 0x7F
    expect(dacOutput(directSoundLevel(127, 127, SOUNDCNT_H_MONO, true))).toBe(127 / 128);
  });
  test('clips at the 10-bit range', () => {
    const bothLeftFull = SOUND_A_LEFT_OUTPUT | SOUND_B_LEFT_OUTPUT | SOUND_ALL_MIX_FULL;
    expect(directSoundLevel(127, 127, bothLeftFull, true)).toBe(1016);
    expect(dacOutput(1016)).toBe(127 / 128);
    expect(dacOutput(-1024)).toBe(-1);
    expect(directSoundLevel(127, 127, bothLeftFull, false)).toBe(0);
  });
  test('frameToDac', () => {
    const l = new Float32Array(3);
    const r = new Float32Array(3);
    frameToDac(Int8Array.of(1, 2, 3), Int8Array.of(-4, -5, -6), SOUNDCNT_H_STEREO, l, r);
    expect([...r]).toEqual([1, 2, 3].map((x) => x / 128));
    expect([...l]).toEqual([-4, -5, -6].map((x) => x / 128));
  });
});

/** Frames of `frameLength` samples counting up from `from` (×0.01 so they are exact as floats). */
function frame(from: number, frameLength: number): [Float32Array, Float32Array] {
  const l = Float32Array.from({ length: frameLength }, (_, i) => (from + i) / 100);
  return [l, l.map((x) => -x)];
}

describe('SampleHoldResampler', () => {
  // 4-sample frames, start at 2 frames, aim for 2, drop past 4; 1 input sample per 4 output samples.
  const small = () => new SampleHoldResampler(1, 4, { frameLength: 4, startFrames: 2, targetFrames: 2, maxFrames: 4 });

  test('holds each input sample for outRate / inRate output samples', () => {
    const res = small();
    res.push(...frame(1, 4));
    res.push(...frame(5, 4));
    const l = new Float32Array(8);
    const r = new Float32Array(8);
    expect(res.render(l, r)).toBeCloseTo(0.02);
    expect([...l]).toEqual([1, 1, 1, 1, 2, 2, 2, 2].map((x) => Math.fround(x / 100)));
    expect([...r]).toEqual([...l].map((x) => -x));
    expect(res.buffered).toBe(6);
  });

  test('below the target the step slows (0.5% per frame), so a sample is held a little longer', () => {
    const res = small();
    res.push(...frame(1, 4));
    res.push(...frame(5, 4));
    res.render(new Float32Array(8), new Float32Array(8));
    // 6 buffered, half a frame under the target: step 0.25 × 0.9975, so sample 3 plays 5 times.
    expect(res.step()).toBeCloseTo(0.25 * 0.9975, 12);
    const l = new Float32Array(6);
    res.render(l, new Float32Array(6));
    expect([...l].map((x) => Math.round(x * 100))).toEqual([3, 3, 3, 3, 3, 4]);
  });

  test('silence until startFrames are buffered; an underrun plays silence and waits for them again', () => {
    const res = small();
    const l = new Float32Array(4);
    const r = new Float32Array(4);
    res.push(...frame(1, 4));
    expect(res.render(l, r)).toBe(0);
    expect([...l]).toEqual([0, 0, 0, 0]);
    expect(res.isPlaying).toBe(false);
    res.push(...frame(5, 4));
    const long = new Float32Array(40);
    res.render(long, new Float32Array(40));
    expect(long.slice(0, 32).every((x) => x !== 0)).toBe(true);
    expect(long.slice(32).every((x) => x === 0)).toBe(true);
    expect(res.underruns).toBe(1);
    expect(res.isPlaying).toBe(false);
    res.push(...frame(9, 4));
    res.render(l, r); // one frame buffered: still waiting
    expect([...l]).toEqual([0, 0, 0, 0]);
    res.push(...frame(13, 4));
    res.render(l, r);
    expect(Math.round(l[0] * 100)).toBe(9);
  });

  test('a push past maxFrames drops the oldest samples back to the target', () => {
    const res = small();
    for (let f = 0; f < 4; f++) res.push(...frame(1 + 4 * f, 4));
    expect(res.buffered).toBe(16);
    res.push(...frame(17, 4));
    expect(res.dropped).toBe(1);
    expect(res.buffered).toBe(8);
    const l = new Float32Array(1);
    res.render(l, new Float32Array(1));
    expect(Math.round(l[0] * 100)).toBe(13);
  });

  test('flush empties the buffer', () => {
    const res = small();
    res.push(...frame(1, 4));
    res.push(...frame(5, 4));
    res.flush();
    expect(res.buffered).toBe(0);
    const l = new Float32Array(4);
    expect(res.render(l, new Float32Array(4))).toBe(0);
  });

  /**
   * The real sizes: 224-sample frames from a 60 Hz loop (ticked from requestAnimationFrame at `rafHz`, so frames come
   * in bunches), played in 128-sample quanta at 48 kHz on an audio clock that runs `ppm` off the page's.
   */
  function simulate(seconds: number, rafHz: number, ppm: number) {
    const res = new SampleHoldResampler(PCM_INPUT_RATE, 48000);
    const pcm = new Float32Array(224).fill(0.5);
    const out = new Float32Array(128);
    const quantumS = 128 / (48000 * (1 + ppm / 1e6));
    let t = 0;
    let nextRaf = 0;
    let acc = 0;
    let lastRaf = 0;
    let minFill = Infinity;
    let maxFill = 0;
    let quanta = 0;
    while (t < seconds) {
      while (nextRaf <= t) {
        acc = Math.min(acc + (nextRaf - lastRaf), 5 / 60);
        lastRaf = nextRaf;
        while (acc >= 1 / 60) {
          acc -= 1 / 60;
          res.push(pcm, pcm);
        }
        nextRaf += 1 / rafHz;
      }
      res.render(out, out);
      // From 10 s on: the first seconds fill the buffer from empty to its target.
      if (++quanta > (10 * 48000) / 128) {
        minFill = Math.min(minFill, res.buffered);
        maxFill = Math.max(maxFill, res.buffered);
      }
      t += quantumS;
    }
    return { underruns: res.underruns, dropped: res.dropped, minFill, maxFill };
  }

  test('steady 60 Hz frames: no underruns or drops, the buffer stays at 3-4 frames', () => {
    const r = simulate(120, 60, 0);
    expect(r.underruns).toBe(0);
    expect(r.dropped).toBe(0);
    // The 60 Hz accumulator loses a frame now and then (float error, as in the scene hosts): about a frame of slack.
    expect(r.minFill).toBeGreaterThan(1.5 * 224);
    expect(r.maxFill).toBeLessThan(5 * 224);
  });

  test('clock drift (±0.1%) and frames in pairs (a 30 Hz display) are absorbed', () => {
    for (const ppm of [-1000, 1000]) {
      const r = simulate(600, 30, ppm);
      expect(r.underruns, `${ppm} ppm`).toBe(0);
      expect(r.dropped, `${ppm} ppm`).toBe(0);
    }
  });
});
