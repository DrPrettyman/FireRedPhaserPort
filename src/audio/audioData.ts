// Loads public/gen/audio/ at boot (BootScene, battle-test's BattleTestBoot): songs.json into the engine's song table
// (loadSongTable), and voicegroups.json, samples.json and waves.json into its voices (setVoiceData). samples.bin (the
// PCM, ~3.7 MB) is only needed by the mixer (W-m4a 3) and isn't fetched here.

import { setVoiceData } from './m4a';
import type { SamplesJson, VoicegroupsJson, WavesJson } from './m4aVoices';
import { loadSongTable, type SongsJson, type SongTable } from './songTable';

const GEN = 'gen/audio';

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
    // Each SongHeader's tone (its voicegroup) and the cry tables; m4aSoundInit keeps them. The PCM (samples.bin)
    // comes later through setSamplePcm, for the mixer (W-m4a 3).
    setVoiceData(voicegroups, samples, waves);
    loaded = { songs, voicegroups, samples, waves };
    return loaded;
  })();
  return loading;
}

/** The audio data once loadAudioData has finished. */
export function audioData(): AudioData | undefined {
  return loaded;
}
