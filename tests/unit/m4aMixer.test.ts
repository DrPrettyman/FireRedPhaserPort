// The m4a mixer (src/audio/m4aMixer.ts SoundMainRAM's mixing, the reverb, m4aSoundVSync's slots, mono routing),
// worked by hand from m4a_1.s on hand-built channels; then on the extracted data (public/gen/audio/, skipped
// without it): the bookkeeping is the same with the mixing on and off, and real songs and SEs rendered headless
// have the right length and are audible (RMS), with silence before they start and after they end.

import { beforeEach, describe, expect, test } from 'vitest';
import {
  gCryTable,
  gCryTable_Reverse,
  gMPlayInfo_BGM,
  gMPlayInfo_SE1,
  gMPlayInfo_SE2,
  gSoundInfo,
  m4aPcmFrame,
  m4aSongNumStart,
  m4aSoundInit,
  m4aSoundMain,
  m4aSoundVSync,
  SetPokemonCryStereo,
  SetPokemonCryTone,
} from '../../src/audio/m4a';
import {
  MUSICPLAYER_STATUS_TRACK,
  PCM_DMA_BUF_SIZE,
  SOUND_CHANNEL_SF_START,
  SOUND_CHANNEL_SF_STOP,
  TONEDATA_TYPE_FIX,
  WAVE_DATA_FLAG_LOOP,
  type SoundChannel,
  type WaveData,
} from '../../src/audio/m4aInternal';
import { m4aSetMixing, SoundMainRAM } from '../../src/audio/m4aMixer';
import { dacOutput, frameToDac, SOUNDCNT_H_MONO, SOUNDCNT_H_STEREO } from '../../src/audio/outputCore';
import { haveGenAudio, loadGenAudio, peak, render, rms } from '../audioRender';

const N = 224;

function wave(samples: number[], opts: { loop?: boolean } = {}): WaveData {
  // size + 1 bytes, as samples.bin has them (the byte after the last is the sample's own).
  return {
    name: 'test', type: 0, status: opts.loop ? WAVE_DATA_FLAG_LOOP << 8 : 0, freq: 13379 * 1024, loopStart: 0,
    size: samples.length, data: Int8Array.from([...samples, samples[samples.length - 1]]),
  };
}

/** Starts DirectSound channel 0 on `wav` as ply_note leaves it (START), with an instant attack by default. */
function startChannel(wav: WaveData, opts: Partial<SoundChannel> = {}): SoundChannel {
  const chan = gSoundInfo.chans[0];
  Object.assign(chan, {
    statusFlags: SOUND_CHANNEL_SF_START, type: TONEDATA_TYPE_FIX, rightVolume: 128, leftVolume: 64, attack: 255,
    decay: 255, sustain: 255, release: 0, pseudoEchoVolume: 0, pseudoEchoLength: 0, count: 0, fw: 0,
    frequency: 0, wav, currentPointer: 0,
  }, opts);
  return chan;
}

const fifoA = (slot = 0) => Array.from(gSoundInfo.pcmBuffer.subarray(slot, slot + N));
const fifoB = (slot = 0) => Array.from(gSoundInfo.pcmBuffer.subarray(PCM_DMA_BUF_SIZE + slot, PCM_DMA_BUF_SIZE + slot + N));
const padded = (head: number[]) => [...head, ...new Array(N - head.length).fill(0)];

beforeEach(() => {
  m4aSoundInit(); // master volume 12, reverb 0, pcmDmaCounter 0 (slot 0)
  m4aSetMixing(true);
  return () => m4aSetMixing(false);
});

describe('SoundMainRAM mixes', () => {
  test('a fixed-rate note: each sample × envelopeVolumeRight / Left >> 8 into FIFO A / B, until the sample ends', () => {
    const chan = startChannel(wave([0, 64, -64, 127, -128, 10, 20, 30]));
    SoundMainRAM(gSoundInfo);
    // env 255 (attack 255); vol = (12 + 1) × 255 >> 4 = 207; right = 128 × 207 >> 8 = 103, left = 64 × 207 >> 8 = 51
    expect(chan.envelopeVolumeRight).toBe(103);
    expect(chan.envelopeVolumeLeft).toBe(51);
    // floor(103 × s / 256): the asm's byte lanes take the product's bits 8-15 (an arithmetic shift)
    expect(fifoA()).toEqual(padded([0, 25, -26, 51, -52, 4, 8, 12]));
    expect(fifoB()).toEqual(padded([0, 12, -13, 25, -26, 1, 3, 5]));
    expect(chan.statusFlags).toBe(0); // _081DD174: the sample ran out mid-frame, the rest isn't mixed
  });

  test('a resampled note interpolates between samples by fw (_081DD1BC)', () => {
    gSoundInfo.masterVolume = 15;
    // divFreq 627 × 6690 = 4194630: a step of 2^22 + 326 (half a sample and a bit)
    expect(gSoundInfo.divFreq).toBe(627);
    startChannel(wave([0, 100, -100, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { loop: true }), {
      type: 0, frequency: 6690, rightVolume: 255, leftVolume: 255,
    });
    SoundMainRAM(gSoundInfo);
    // Sources: fw 0: 0; fw 4194630: 0 + (4194630 × 100 >> 23) = 50; then one sample on, fw 652:
    // 100 + (652 × -200 >> 23) = 99; fw 4195282: 100 + (4195282 × -200 >> 23) = -1.
    // Volume: (15 + 1) × 255 >> 4 = 255, × 255 >> 8 = 254; out = 254 × s >> 8.
    expect(fifoA().slice(0, 4)).toEqual([0, 49, 98, -1]);
    expect(fifoB().slice(0, 4)).toEqual([0, 49, 98, -1]);
  });

  test('the envelope scales the mix frame by frame: attack, then release', () => {
    const chan = startChannel(wave([100, 100, 100, 100], { loop: true }), { attack: 64, rightVolume: 255, release: 128 });
    const outs: number[] = [];
    for (let f = 0; f < 4; f++) {
      SoundMainRAM(gSoundInfo);
      const a = fifoA();
      expect(new Set(a).size).toBe(1); // a looping constant sample: every output sample is the same
      outs.push(a[0]);
    }
    // env 64, 128, 192, 255 → vol (13 × env) >> 4 = 52, 104, 156, 207 → right (255 × vol) >> 8 = 51, 103, 155,
    // 206 → 100 × right >> 8
    expect(outs).toEqual([19, 40, 60, 80]);
    chan.statusFlags |= SOUND_CHANNEL_SF_STOP;
    SoundMainRAM(gSoundInfo);
    // release: env 255 × 128 >> 8 = 127 → vol 103 → right 102 → 39
    expect(fifoA()[0]).toBe(39);
  });

  test('a channel adds onto what is in the slot, wrapping at 8 bits as the asm does (no clipping)', () => {
    startChannel(wave([127, 127], { loop: true }), { rightVolume: 255, leftVolume: 255 });
    Object.assign(gSoundInfo.chans[1], { ...gSoundInfo.chans[0], wav: wave([127, 127], { loop: true }) });
    gSoundInfo.masterVolume = 15;
    SoundMainRAM(gSoundInfo);
    // each: 254 × 127 >> 8 = 126; 126 + 126 = 252 → -4 as an s8
    expect(fifoA()[0]).toBe(-4);
  });

  test('with the mixing off nothing is written (the slot is cleared) and the channel advances the same', () => {
    const run = (mix: boolean) => {
      m4aSoundInit();
      m4aSetMixing(mix);
      const chan = startChannel(wave(Array.from({ length: 4000 }, (_, i) => (i * 7) % 100)), {
        type: 0, frequency: 9000, attack: 30,
      });
      const states: string[] = [];
      for (let f = 0; f < 8; f++) {
        SoundMainRAM(gSoundInfo);
        states.push(JSON.stringify([chan.statusFlags, chan.count, chan.fw, chan.currentPointer, chan.envelopeVolume]));
      }
      return { states, a: fifoA() };
    };
    const on = run(true);
    const off = run(false);
    expect(off.states).toEqual(on.states);
    expect(on.a.some((x) => x !== 0)).toBe(true);
    expect(off.a.every((x) => x === 0)).toBe(true);
  });
});

describe('the reverb and the DMA slots', () => {
  test('m4aSoundVSync cycles the 7 slots; each frame mixes into the slot the DMA plays next', () => {
    const slots: number[] = [];
    for (let f = 0; f < 8; f++) {
      m4aSoundVSync();
      const frame = m4aPcmFrame();
      slots.push(frame.fifoA.byteOffset / N);
    }
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 0, 1]);
  });

  test('an impulse echoes 6 and 7 frames later at (A + B) × reverb / 512, in both FIFOs, and so on', () => {
    gSoundInfo.reverb = 64;
    const run = (sample: number) => {
      m4aSoundInit();
      gSoundInfo.reverb = 64;
      m4aSetMixing(true);
      startChannel(wave([sample]));
      const firsts: [number, number][] = [];
      for (let f = 0; f < 15; f++) {
        m4aSoundVSync();
        m4aSoundMain();
        const { fifoA: a, fifoB: b } = m4aPcmFrame();
        firsts.push([a[0], b[0]]);
        expect(a.subarray(1).every((x) => x === 0) && b.subarray(1).every((x) => x === 0)).toBe(true);
      }
      return firsts;
    };
    // 100: A = 103 × 100 >> 8 = 40, B = 51 × 100 >> 8 = 19. Frame 6 (its slot is the one after frame 0's) and frame 7
    // (frame 0's slot): (40 + 19) × 64 >> 9 = 7. Frame 12: frame 6's echo, (7 + 7) × 64 >> 9 = 1; frame 13: both,
    // 28 × 64 >> 9 = 3; frame 14: frame 7's, 1.
    const z: [number, number] = [0, 0];
    expect(run(100)).toEqual([[40, 19], z, z, z, z, z, [7, 7], [7, 7], z, z, z, z, [1, 1], [3, 3], [1, 1]]);
    // -100: A = -41, B = -20; (-61 × 64) >> 9 = -8, bit 7 set → -7 (the asm's rounding toward 0 for negatives).
    // Then (-14 × 64) >> 9 = -2 → -1; (-28 × 64) >> 9 = -4 → -3.
    expect(run(-100)).toEqual([[-41, -20], z, z, z, z, z, [-7, -7], [-7, -7], z, z, z, z, [-1, -1], [-3, -3], [-1, -1]]);
  });
});

describe('SetPokemonCryStereo', () => {
  test('mono sets mode bit 0 and routes both FIFOs to both speakers at half volume; stereo A right, B left', () => {
    startChannel(wave([100]));
    m4aSoundMain();
    const frame = m4aPcmFrame();
    expect([frame.fifoA[0], frame.fifoB[0]]).toEqual([40, 19]);
    const speakers = (soundcntH: number) => {
      const l = new Float32Array(N);
      const r = new Float32Array(N);
      frameToDac(frame.fifoA, frame.fifoB, soundcntH, l, r);
      return [l[0], r[0]];
    };

    expect(frame.soundcntH).toBe(SOUNDCNT_H_STEREO); // SoundInit's routing
    expect(speakers(frame.soundcntH)).toEqual([dacOutput(19 * 4), dacOutput(40 * 4)]);

    SetPokemonCryStereo(0); // OPTIONS_SOUND_MONO
    expect(gSoundInfo.mode & 1).toBe(1);
    expect(m4aPcmFrame().soundcntH).toBe(SOUNDCNT_H_MONO);
    expect(speakers(SOUNDCNT_H_MONO)).toEqual([dacOutput((40 + 19) * 2), dacOutput((40 + 19) * 2)]);

    SetPokemonCryStereo(1);
    expect(gSoundInfo.mode & 1).toBe(0);
    expect(m4aPcmFrame().soundcntH).toBe(SOUNDCNT_H_STEREO);
  });
});

describe.skipIf(!haveGenAudio())('the extracted songs, rendered headless', () => {
  let songs: ReturnType<typeof loadGenAudio>;
  beforeEach(() => {
    songs = loadGenAudio();
  });
  const id = (name: string) => songs.idByName.get(name)!;

  test('the bookkeeping is identical with the mixing on and off (a song, SEs, a cry and a reverse cry)', () => {
    const run = (mix: boolean) => {
      m4aSoundInit();
      m4aSetMixing(mix);
      const states: string[] = [];
      for (let f = 0; f < 900; f++) {
        if (f === 0) m4aSongNumStart(id('MUS_TITLE'));
        if (f === 100) m4aSongNumStart(id('SE_SAVE'));
        if (f === 200) SetPokemonCryTone(gCryTable[5]);
        if (f === 300) SetPokemonCryTone(gCryTable_Reverse[24]);
        if (f === 400) m4aSongNumStart(id('SE_BALL_OPEN'));
        m4aSoundVSync();
        m4aSoundMain();
        states.push(JSON.stringify(gSoundInfo.chans.map((c) => [c.statusFlags, c.count, c.fw, c.currentPointer, c.envelopeVolume, c.envelopeVolumeLeft, c.envelopeVolumeRight])));
      }
      m4aSetMixing(false);
      return states;
    };
    const on = run(true);
    const off = run(false);
    for (let f = 0; f < on.length; f++) if (on[f] !== off[f]) expect.fail(`frame ${f} differs`);
  });

  test('MUS_TITLE: 224 samples a frame, silent before it starts, audible after', () => {
    const r = render(1230, (f) => f === 30 && m4aSongNumStart(id('MUS_TITLE')));
    expect(r.fifoA.length).toBe(224 * 1230);
    expect(r.fifoB.length).toBe(224 * 1230);
    expect(peak(r, 0, 224 * 30)).toBe(0);
    const level = rms(r, 224 * 30);
    console.log(`[render] MUS_TITLE, 1200 frames: RMS ${level.toFixed(2)}, peak ${peak(r)} (s8 units, no PSG)`);
    expect(level).toBeGreaterThan(5);
    expect(gMPlayInfo_BGM.status & MUSICPLAYER_STATUS_TRACK).not.toBe(0);
  });

  test('MUS_PALLET is audible', () => {
    const r = render(1200, (f) => f === 0 && m4aSongNumStart(id('MUS_PALLET')));
    const level = rms(r);
    console.log(`[render] MUS_PALLET, 1200 frames: RMS ${level.toFixed(2)}, peak ${peak(r)}`);
    expect(level).toBeGreaterThan(3);
  });

  test('SE_SAVE (DirectSound) sounds, then the output falls silent once it and its reverb end', () => {
    const r = render(240, (f) => f === 10 && m4aSongNumStart(id('SE_SAVE')));
    expect(peak(r, 0, 224 * 10)).toBe(0);
    const level = rms(r, 224 * 10, 224 * 40);
    let last = 0;
    for (let f = 0; f < 240; f++) if (peak(r, f * 224, (f + 1) * 224) > 0) last = f;
    console.log(`[render] SE_SAVE: RMS ${level.toFixed(2)} over its first 30 frames, last sound in frame ${last - 10} after the start`);
    expect(level).toBeGreaterThan(1);
    const playing = (gMPlayInfo_SE1.status | gMPlayInfo_SE2.status) & MUSICPLAYER_STATUS_TRACK;
    expect(playing).toBe(0);
    expect(last).toBeLessThan(200);
    expect(peak(r, 224 * 200)).toBe(0);
  });

  test('a cry and its reverse (SoundMainRAM_Unk1, PCM instead of DPCM) are audible', () => {
    for (const [name, tone] of [['cry 25', gCryTable[24]], ['reverse cry 25', gCryTable_Reverse[24]]] as const) {
      m4aSoundInit();
      const r = render(60, (f) => f === 0 && SetPokemonCryTone(tone));
      const level = rms(r);
      console.log(`[render] ${name}: RMS ${level.toFixed(2)} over 60 frames, peak ${peak(r)}`);
      expect(level).toBeGreaterThan(1);
    }
  });

  test('SE_SELECT is all PSG (square 1): nothing in the FIFOs', () => {
    const r = render(30, (f) => f === 0 && m4aSongNumStart(id('SE_SELECT')));
    expect(peak(r)).toBe(0);
  });
});
