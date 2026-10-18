// Loads public/gen/audio/ at boot (BootScene, battle-test's BattleTestBoot): songs.json into the engine's song table
// (loadSongTable), and voicegroups.json, samples.json and waves.json, kept for the engine's voices. samples.bin (the
// PCM, ~3.7 MB) is only needed by the mixer (W-m4a 3) and isn't fetched here.

import { loadSongTable, type SongsJson, type SongTable } from './songTable';

const GEN = 'gen/audio';

/** voicegroups.json (tools/extract_audio_voices.py; shape in docs/DEV_NOTES.md "Audio data: voicegroups and
 *  samples"). Typed loosely here: the engine (W-m4a 2) owns the reading. */
export interface VoicegroupsJson {
  voicegroups: Record<string, (Record<string, unknown> | null)[]>;
  voicegroupSizes: Record<string, number>;
  keysplits: Record<string, (number | null)[]>;
  cries: Record<string, unknown>[];
  criesReverse: Record<string, unknown>[];
}

/** samples.json: struct WaveData's header per sample label, and where its bytes are in samples.bin. */
export type SamplesJson = Record<string, { freq: number; loop: boolean; loopStart: number; size: number; offset: number }>;

/** waves.json: the programmable wave samples (16 bytes each). */
export type WavesJson = Record<string, number[]>;

export interface AudioData {
  songs: SongTable;
  voicegroups: VoicegroupsJson;
  samples: SamplesJson;
  waves: WavesJson;
}

let loading: Promise<AudioData> | undefined;
let loaded: AudioData | undefined;

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${GEN}/${path}`);
  if (!res.ok) throw new Error(`${GEN}/${path}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/**
 * Fetches the audio data once (later calls get the same promise) and installs the song table in the engine. Call
 * AgbMainSoundInit (audio/frame.ts) as well before the first frame: m4aSoundInit opens the players.
 */
export function loadAudioData(): Promise<AudioData> {
  loading ??= (async () => {
    const [songsJson, voicegroups, samples, waves] = await Promise.all([
      fetchJson<SongsJson>('songs.json'),
      fetchJson<VoicegroupsJson>('voicegroups.json'),
      fetchJson<SamplesJson>('samples.json'),
      fetchJson<WavesJson>('waves.json'),
    ]);
    const songs = loadSongTable(songsJson);
    // TODO(merger, W-m4a 2): bind the voicegroups, samples and waves to the engine here (W-m4a 2's loader call,
    // e.g. its loadVoices(voicegroups, samples, waves)), so each song's tone and the cry tables resolve.
    loaded = { songs, voicegroups, samples, waves };
    return loaded;
  })();
  return loading;
}

/** The audio data once loadAudioData has finished. */
export function audioData(): AudioData | undefined {
  return loaded;
}
