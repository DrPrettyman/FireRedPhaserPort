// Renders the m4a engine's output headless in Node (no browser, no AudioContext): loads public/gen/audio/ (the
// songs, voices and samples.bin, as audio/audioData.ts does in the browser), then runs frames as audio/frame.ts's
// AgbMainFrameEnd does (m4aSoundVSync, m4aSoundMain with the mixing on) and keeps each frame's FIFO samples.
// Used by tests/unit/m4aMixer.test.ts and the dev script tools/render-audio.ts (which writes a WAV to listen to).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { m4aPcmFrame, m4aSoundInit, m4aSoundMain, m4aSoundVSync, setSamplePcm, setVoiceData } from '../src/audio/m4a';
import { m4aSetMixing } from '../src/audio/m4aMixer';
import type { SamplesJson, VoicegroupsJson, WavesJson } from '../src/audio/m4aVoices';
import { frameToDac, GBA_PCM_FREQ } from '../src/audio/outputCore';
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

/** What render() collected: every frame's FIFO A and B samples back to back, and each frame's REG_SOUNDCNT_H. */
export interface Rendered {
  fifoA: Int8Array;
  fifoB: Int8Array;
  soundcntH: number[];
}

/**
 * Runs `frames` frames with the mixing on, after `before(frame)` (the game logic's part of the frame: start a song,
 * press a key). Returns the frames' samples (224 per frame per FIFO).
 */
export function render(frames: number, before?: (frame: number) => void): Rendered {
  const chunksA: Int8Array[] = [];
  const chunksB: Int8Array[] = [];
  const soundcntH: number[] = [];
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
  return { fifoA: join(chunksA), fifoB: join(chunksB), soundcntH };
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

/** A 16-bit stereo WAV at the GBA's 13,379 Hz of what the speakers get (the output's DAC: routing, 8-bit clip). */
export function toWav(r: Rendered, samplesPerFrame = 224): Buffer {
  const n = r.fifoA.length;
  const l = new Float32Array(samplesPerFrame);
  const rr = new Float32Array(samplesPerFrame);
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(GBA_PCM_FREQ, 24);
  buf.writeUInt32LE(GBA_PCM_FREQ * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let f = 0; f * samplesPerFrame < n; f++) {
    const at = f * samplesPerFrame;
    frameToDac(r.fifoA.subarray(at, at + samplesPerFrame), r.fifoB.subarray(at, at + samplesPerFrame), r.soundcntH[f], l, rr);
    for (let i = 0; i < samplesPerFrame; i++) {
      buf.writeInt16LE(Math.round(l[i] * 32767), 44 + (at + i) * 4);
      buf.writeInt16LE(Math.round(rr[i] * 32767), 44 + (at + i) * 4 + 2);
    }
  }
  return buf;
}
