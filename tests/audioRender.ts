// Renders the m4a engine's output headless in Node (no browser, no AudioContext): loads public/gen/audio/ (the
// songs, voices and samples.bin, as audio/audioData.ts does in the browser), then runs frames as audio/frame.ts's
// AgbMainFrameEnd does (m4aSoundVSync, m4aSoundMain with the mixing on) and keeps each frame's FIFO samples and PSG
// register writes; `speakers` plays them through the worklet's sound circuit (outputCore.ts's SoundCircuit: the
// PSG synth and the DAC). Used by tests/unit/m4aMixer.test.ts, psgSynth.test.ts and the dev script
// tools/render-audio.ts (which writes a WAV to listen to).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { m4aPcmFrame, m4aSoundInit, m4aSoundMain, m4aSoundVSync, setSamplePcm, setVoiceData } from '../src/audio/m4a';
import { m4aSetMixing } from '../src/audio/m4aMixer';
import type { SamplesJson, VoicegroupsJson, WavesJson } from '../src/audio/m4aVoices';
import { DAC_OVERSAMPLE, GBA_DAC_RATE, SoundCircuit } from '../src/audio/outputCore';
import type { PsgFrame } from '../src/audio/soundRegs';
import { loadSongTable, type SongsJson, type SongTable } from '../src/audio/songTable';

export const GEN_AUDIO = resolve(__dirname, '../public/gen/audio');
const FILES = ['songs.json', 'voicegroups.json', 'samples.json', 'waves.json', 'samples.bin'];

export function haveGenAudio(): boolean {
  return FILES.every((f) => existsSync(resolve(GEN_AUDIO, f)));
}

/** Loads the extracted audio into the engine (song table, voices, PCM) and runs m4aSoundInit. */
export function loadGenAudio(): SongTable {
  const json = <T>(f: string): T => JSON.parse(readFileSync(resolve(GEN_AUDIO, f), 'utf8')) as T;
  const songs = loadSongTable(json<SongsJson>('songs.json'));
  setVoiceData(json<VoicegroupsJson>('voicegroups.json'), json<SamplesJson>('samples.json'), json<WavesJson>('waves.json'));
  setSamplePcm(new Uint8Array(readFileSync(resolve(GEN_AUDIO, 'samples.bin'))));
  m4aSoundInit();
  return songs;
}

/** What render() collected: every frame's FIFO A and B samples back to back, each frame's REG_SOUNDCNT_H and PSG
 *  register writes. */
export interface Rendered {
  fifoA: Int8Array;
  fifoB: Int8Array;
  soundcntH: number[];
  psg: PsgFrame[];
}

/**
 * Runs `frames` frames with the mixing on, after `before(frame)` (the game logic's part of the frame: start a song,
 * press a key). Returns the frames' samples (224 per frame per FIFO).
 */
export function render(frames: number, before?: (frame: number) => void): Rendered {
  const chunksA: Int8Array[] = [];
  const chunksB: Int8Array[] = [];
  const soundcntH: number[] = [];
  const psg: PsgFrame[] = [];
  m4aSetMixing(true);
  try {
    for (let f = 0; f < frames; f++) {
      before?.(f);
      m4aSoundVSync();
      m4aSoundMain();
      const pcm = m4aPcmFrame();
      chunksA.push(pcm.fifoA.slice());
      chunksB.push(pcm.fifoB.slice());
      soundcntH.push(pcm.soundcntH);
      psg.push(pcm.psg);
    }
  } finally {
    m4aSetMixing(false);
  }
  const join = (chunks: Int8Array[]): Int8Array => {
    const out = new Int8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  };
  return { fifoA: join(chunksA), fifoB: join(chunksB), soundcntH, psg };
}

/** RMS of samples [from, to) of both FIFOs, in s8 units. */
export function rms(r: Rendered, from = 0, to = r.fifoA.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += r.fifoA[i] * r.fifoA[i] + r.fifoB[i] * r.fifoB[i];
  return to > from ? Math.sqrt(sum / (2 * (to - from))) : 0;
}

/** The largest |sample| in [from, to) of both FIFOs. */
export function peak(r: Rendered, from = 0, to = r.fifoA.length): number {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(r.fifoA[i]), Math.abs(r.fifoB[i]));
  return p;
}

/** What the speakers get: DAC_OVERSAMPLE samples per FIFO sample (896 a frame), each side in [-1, 1). */
export interface Speakers {
  l: Float32Array;
  r: Float32Array;
}

/** Plays render()'s frames through the output's sound circuit (the worklet's SoundCircuit), from the first frame
 *  (the engine's boot writes included); `psg: false` leaves the PSG out. */
export function speakers(r: Rendered, opts: { psg?: boolean } = {}): Speakers {
  const frames = r.soundcntH.length;
  const per = r.fifoA.length / frames;
  const out = per * DAC_OVERSAMPLE;
  const l = new Float32Array(frames * out);
  const rr = new Float32Array(frames * out);
  const circuit = new SoundCircuit();
  circuit.psgOn = opts.psg ?? true;
  for (let f = 0; f < frames; f++) {
    const at = f * per;
    circuit.frame(
      r.fifoA.subarray(at, at + per),
      r.fifoB.subarray(at, at + per),
      r.soundcntH[f],
      r.psg[f],
      l.subarray(f * out, (f + 1) * out),
      rr.subarray(f * out, (f + 1) * out),
    );
  }
  return { l, r: rr };
}

/** The AC RMS (the mean taken out: the PSG's levels are unsigned) of speaker samples [from, to) of both sides. */
export function speakerRms(s: Speakers, from = 0, to = s.l.length): number {
  if (to <= from) return 0;
  let mean = 0;
  for (let i = from; i < to; i++) mean += s.l[i] + s.r[i];
  mean /= 2 * (to - from);
  let sum = 0;
  for (let i = from; i < to; i++) sum += (s.l[i] - mean) ** 2 + (s.r[i] - mean) ** 2;
  return Math.sqrt(sum / (2 * (to - from)));
}

/** A 16-bit stereo WAV of the speaker samples at the GBA's speed (GBA_DAC_RATE, 53,516 Hz). */
export function toWav(s: Speakers): Buffer {
  const n = s.l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(GBA_DAC_RATE, 24);
  buf.writeUInt32LE(GBA_DAC_RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(s.l[i] * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(s.r[i] * 32767), 44 + i * 4 + 2);
  }
  return buf;
}
