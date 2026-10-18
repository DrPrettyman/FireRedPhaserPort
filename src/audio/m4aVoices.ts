// The voices the engine plays, from public/gen/audio/voicegroups.json, samples.json, waves.json (and optionally
// samples.bin), written by tools/extract_audio_voices.py. docs/DEV_NOTES.md "Audio data: voicegroups and samples"
// has the JSON shapes and how ply_note reads them; this file turns them into the engine's structs (ToneData,
// WaveData). Pure: m4a.ts's setVoiceData installs the result.

import { TONEDATA_TYPE_CGB, WAVE_DATA_FLAG_LOOP, type ToneData, type WaveData } from './m4aInternal';

/** A voice as voicegroups.json writes it (struct ToneData's bytes; one of the reference fields by type). */
export interface VoiceJson {
  type: number;
  key: number;
  length: number;
  panSweep: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** DirectSound: a samples.json label. */
  sample?: string;
  /** Programmable wave: a waves.json label. */
  wave?: string;
  /** Squares: the duty. */
  duty?: number;
  /** Noise: the period. */
  period?: number;
  /** Keysplit / rhythm: the sub-voicegroup. */
  subgroup?: string;
  /** Keysplit: the keysplit table (null for a rhythm voice). */
  keysplit?: string | null;
}

export interface VoicegroupsJson {
  /** Each voicegroup as ply_note reads it: 128 voices from its label on (256 for the keysplit subgroups), running
   *  on into the following voicegroups; null past the end of voice_groups.inc. */
  voicegroups: Record<string, (VoiceJson | null)[]>;
  voicegroupSizes?: Record<string, number>;
  /** Keysplit tables by MIDI key; null where the ROM byte is part of a pointer. */
  keysplits: Record<string, (number | null)[]>;
  /** gCryTable, gCryTable_Reverse: indexed by SpeciesToCryId. */
  cries: VoiceJson[];
  criesReverse: VoiceJson[];
}

export interface SampleJson {
  freq: number;
  loop: boolean;
  loopStart: number;
  size: number;
  /** Byte offset of the sample's PCM in samples.bin (size + 1 bytes). */
  offset: number;
}

export type SamplesJson = Record<string, SampleJson>;

/** waves.json: each programmable wave's 16 bytes (32 4-bit samples, high nibble first). */
export type WavesJson = Record<string, number[]>;

export interface VoiceData {
  /** Each voicegroup's voices by name (`voicegroup000`); a null voice is past the ROM's voicegroups. */
  voicegroups: Map<string, (ToneData | null)[]>;
  /** gCryTable / gCryTable_Reverse. */
  cryTable: ToneData[];
  cryTableReverse: ToneData[];
  /** Every sample's WaveData by label. */
  samples: Map<string, WaveData>;
}

/** The compressed samples: everything under sound/direct_sound_samples/cries/, built with `wav2agb -c`
 *  (audio_rules.mk), labelled `Cry_*` in direct_sound_data.inc. Their WaveData.type is 1 in the ROM, which
 *  SoundMainRAM_Unk1 checks; the PCM here is already decoded. */
const isCompressedSample = (label: string): boolean => label.startsWith('Cry_');

/** WaveData from samples.json's header (and samples.bin's PCM when given). */
export function makeWaveData(label: string, s: SampleJson, pcm?: Uint8Array): WaveData {
  return {
    name: label,
    type: isCompressedSample(label) ? 1 : 0,
    status: s.loop ? WAVE_DATA_FLAG_LOOP << 8 : 0,
    freq: s.freq >>> 0,
    loopStart: s.loopStart >>> 0,
    size: s.size >>> 0,
    data: pcm ? new Int8Array(pcm.buffer, pcm.byteOffset + s.offset, s.size + 1) : null,
  };
}

/**
 * Builds the engine's voices from the parsed JSONs. `pcm` is samples.bin (signed 8-bit; only the mixer needs it,
 * so it may come later or never: every WaveData's header is there without it). Throws on a reference that doesn't
 * resolve (a sample, wave, subgroup or keysplit table missing from its JSON).
 */
export function buildVoiceData(
  voicegroupsJson: VoicegroupsJson,
  samplesJson: SamplesJson,
  wavesJson: WavesJson,
  pcm?: Uint8Array | ArrayBuffer,
): VoiceData {
  const bytes = pcm instanceof ArrayBuffer ? new Uint8Array(pcm) : pcm;
  const samples = new Map<string, WaveData>();
  for (const [label, s] of Object.entries(samplesJson)) samples.set(label, makeWaveData(label, s, bytes));

  const waves = new Map<string, Uint8Array>();
  for (const [label, w] of Object.entries(wavesJson)) waves.set(label, Uint8Array.from(w));

  const voicegroups = new Map<string, (ToneData | null)[]>();

  const voicegroup = (name: string): (ToneData | null)[] => {
    let tones = voicegroups.get(name);
    if (tones) return tones;
    const json = voicegroupsJson.voicegroups[name];
    if (!json) throw new Error(`voicegroups.json: no voicegroup ${name}`);
    tones = [];
    voicegroups.set(name, tones); // before the voices, so a subgroup that refers back resolves
    for (const v of json) tones.push(v ? tone(v) : null);
    return tones;
  };

  const tone = (v: VoiceJson): ToneData => {
    const t: ToneData = {
      type: v.type,
      key: v.key,
      length: v.length,
      pan_sweep: v.panSweep,
      wav: null,
      attack: v.attack,
      decay: v.decay,
      sustain: v.sustain,
      release: v.release,
    };
    if (v.subgroup !== undefined) {
      // TONEDATA_TYPE_SPL / RHY: ply_note indexes the subgroup (a voicegroup with no null voices in its reach).
      t.wav = voicegroup(v.subgroup) as ToneData[];
      if (v.keysplit) {
        const table = voicegroupsJson.keysplits[v.keysplit];
        if (!table) throw new Error(`voicegroups.json: no keysplit table ${v.keysplit}`);
        t.keySplitTable = table;
      } else {
        t.keySplitTable = null;
      }
    } else if (v.sample !== undefined) {
      const w = samples.get(v.sample);
      if (!w) throw new Error(`samples.json: no sample ${v.sample}`);
      t.wav = w;
    } else if (v.wave !== undefined) {
      const w = waves.get(v.wave);
      if (!w) throw new Error(`waves.json: no wave ${v.wave}`);
      t.wav = w;
    } else if (v.duty !== undefined) {
      t.wav = v.duty;
    } else if (v.period !== undefined) {
      t.wav = v.period;
    } else if (!(v.type & TONEDATA_TYPE_CGB)) {
      throw new Error(`voicegroups.json: a DirectSound voice (type ${v.type}) with no sample`);
    }
    return t;
  };

  for (const name of Object.keys(voicegroupsJson.voicegroups)) voicegroup(name);

  return {
    voicegroups,
    cryTable: voicegroupsJson.cries.map(tone),
    cryTableReverse: voicegroupsJson.criesReverse.map(tone),
    samples,
  };
}
