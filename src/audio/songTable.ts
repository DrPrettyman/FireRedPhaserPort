// gSongTable from public/gen/audio/songs.json (written by tools/extract_audio.py from mid2agb's output). Each
// song's track bytes are base64; its track starts and every GOTO / PATT target in the bytes are byte offsets into
// those bytes (not ROM addresses), which is how the engine (m4a.ts) reads them.

import { gMPlayTable, setSongTable } from './m4a';
import type { Song, SongHeader } from './m4aInternal';

export interface SongsJsonPlayer {
  name: string;
  tracks: number;
}

export interface SongsJsonSong {
  id: number;
  name: string;
  /** The music player (index into `players`: sound/song_table.inc's second field). */
  ms: number;
  me: number;
  priority: number;
  reverb: number;
  blockCount: number;
  voicegroup: string | null;
  /** Each track's start, as a byte offset into `data`. */
  tracks: number[];
  /** The song's track bytes, base64. */
  data: string;
}

export interface SongsJson {
  /** sound/music_player_table.inc order. */
  players: SongsJsonPlayer[];
  /** Index = song id. */
  songs: SongsJsonSong[];
}

export interface SongTable {
  songs: Song[];
  /** Song id by name, upper case (`SE_SELECT`, `MUS_PALLET`). */
  idByName: Map<string, number>;
}

function decodeBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Builds the song table from songs.json and installs it as the engine's gSongTable. Throws if the JSON's music
 *  players don't match gMPlayTable or a song is out of order. */
export function loadSongTable(json: SongsJson): SongTable {
  if (json.players.length !== gMPlayTable.length) {
    throw new Error(`songs.json: ${json.players.length} music players, the engine has ${gMPlayTable.length}`);
  }
  json.players.forEach((p, i) => {
    const mplay = gMPlayTable[i];
    if (p.name !== mplay.info.name || p.tracks !== mplay.unk_8) {
      throw new Error(`songs.json: player ${i} is ${p.name} (${p.tracks} tracks), expected ${mplay.info.name} (${mplay.unk_8})`);
    }
  });

  const idByName = new Map<string, number>();
  const songs = json.songs.map((s, i): Song => {
    if (s.id !== i) throw new Error(`songs.json: song ${s.name} has id ${s.id} at index ${i}`);
    if (s.ms < 0 || s.ms >= gMPlayTable.length) throw new Error(`songs.json: song ${s.name} on player ${s.ms}`);
    const header: SongHeader = {
      name: s.name,
      trackCount: s.tracks.length,
      blockCount: s.blockCount,
      priority: s.priority,
      reverb: s.reverb,
      voicegroup: s.voicegroup,
      tone: null, // the voicegroup: setSongTable sets it once setVoiceData has run
      part: s.tracks,
      data: decodeBase64(s.data),
    };
    idByName.set(s.name.toUpperCase(), s.id);
    return { header, ms: s.ms, me: s.me };
  });

  setSongTable(songs);
  return { songs, idByName };
}
