// The m4a (MP2K) engine's structs and constants: include/gba/m4a_internal.h.
//
// Structs are plain objects with the C's field names. C pointers become object references, except pointers into
// song bytes: a track keeps the song's bytes (`data`) and `cmdPtr` / `patternStack` are byte offsets into them.
// Integer fields hold the C's ranges (u8 0..255, s8 -128..127, u16, u32); the code masks on every write.

export const ID_NUMBER = 0x68736d53; // 'Smsh'

export const C_V = 0x40; // center value for PAN, BEND, and TUNE

export const SOUND_MODE_REVERB_VAL = 0x0000007f;
export const SOUND_MODE_REVERB_SET = 0x00000080;
export const SOUND_MODE_MAXCHN = 0x00000f00;
export const SOUND_MODE_MAXCHN_SHIFT = 8;
export const SOUND_MODE_MASVOL = 0x0000f000;
export const SOUND_MODE_MASVOL_SHIFT = 12;
export const SOUND_MODE_FREQ_13379 = 0x00040000;
export const SOUND_MODE_FREQ = 0x000f0000;
export const SOUND_MODE_FREQ_SHIFT = 16;
export const SOUND_MODE_DA_BIT_8 = 0x00900000;
export const SOUND_MODE_DA_BIT = 0x00b00000;
export const SOUND_MODE_DA_BIT_SHIFT = 20;

export const TONEDATA_TYPE_CGB = 0x07;
export const TONEDATA_TYPE_FIX = 0x08;
export const TONEDATA_TYPE_SPL = 0x40; // key split
export const TONEDATA_TYPE_RHY = 0x80; // rhythm

export const SOUND_CHANNEL_SF_START = 0x80;
export const SOUND_CHANNEL_SF_STOP = 0x40;
export const SOUND_CHANNEL_SF_LOOP = 0x10;
export const SOUND_CHANNEL_SF_IEC = 0x04;
export const SOUND_CHANNEL_SF_ENV = 0x03;
export const SOUND_CHANNEL_SF_ON =
  SOUND_CHANNEL_SF_START | SOUND_CHANNEL_SF_STOP | SOUND_CHANNEL_SF_IEC | SOUND_CHANNEL_SF_ENV;

export const MAX_DIRECTSOUND_CHANNELS = 12;

export const MPT_FLG_VOLSET = 0x01;
export const MPT_FLG_VOLCHG = 0x03;
export const MPT_FLG_PITSET = 0x04;
export const MPT_FLG_PITCHG = 0x0c;
export const MPT_FLG_START = 0x40;
export const MPT_FLG_EXIST = 0x80;

export const MUSICPLAYER_STATUS_TRACK = 0x0000ffff;
export const MUSICPLAYER_STATUS_PAUSE = 0x80000000;

export const MAX_MUSICPLAYER_TRACKS = 16;
export const TRACKS_ALL = 0xffff;

export const TEMPORARY_FADE = 0x0001;
export const FADE_IN = 0x0002;
export const FADE_VOL_MAX = 64;
export const FADE_VOL_SHIFT = 2;

export const MAX_POKEMON_CRIES = 2;

/** struct ToneData: one voice of a voicegroup. W-m4a 2 fills `wav` (a WaveData, or for keysplit / rhythm voices
 *  the sub-voicegroup) and `keySplitTable` (which shares `attack`'s word in the C) from voicegroups.json. */
export interface ToneData {
  type: number;
  key: number;
  length: number;
  pan_sweep: number;
  wav: unknown;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  keySplitTable?: Uint8Array | null;
}

export function emptyToneData(): ToneData {
  return { type: 0, key: 0, length: 0, pan_sweep: 0, wav: null, attack: 0, decay: 0, sustain: 0, release: 0 };
}

/** struct SongHeader. `part[i]` is track i's start as a byte offset into `data` (the song's bytes). `voicegroup` is
 *  the voicegroup's name from songs.json; `tone` is that voicegroup once resolved (W-m4a 2), else null. */
export interface SongHeader {
  name: string;
  trackCount: number;
  blockCount: number;
  priority: number;
  reverb: number;
  voicegroup: string | null;
  tone: ToneData[] | null;
  part: number[];
  data: Uint8Array;
}

/** struct Song: gSongTable's entry. `ms` is the music player's index in gMPlayTable. */
export interface Song {
  header: SongHeader;
  ms: number;
  me: number;
}

/** struct SoundChannel (the DirectSound channels) and struct CgbChannel share their first fields, which is all the
 *  sequencer touches. W-m4a 2 adds the rest (envelope, frequency, sample position). */
export interface SoundChannel {
  statusFlags: number;
  type: number;
  key: number;
  gateTime: number;
  midiKey: number;
  velocity: number;
  priority: number;
  track: MusicPlayerTrack | null;
  prevChannelPointer: SoundChannel | null;
  nextChannelPointer: SoundChannel | null;
}

/** struct MusicPlayerTrack. */
export interface MusicPlayerTrack {
  flags: number;
  wait: number;
  patternLevel: number;
  repN: number;
  gateTime: number;
  key: number;
  velocity: number;
  runningStatus: number;
  /** u8 in the C, but MPlayMain and ply_note read it with ldrsb: held here as s8. */
  keyM: number;
  pitM: number;
  keyShift: number; // s8
  keyShiftX: number; // s8
  tune: number; // s8
  pitX: number;
  bend: number; // s8
  bendRange: number;
  volMR: number;
  volML: number;
  vol: number;
  volX: number;
  pan: number; // s8
  panX: number; // s8
  modM: number; // s8
  mod: number;
  modT: number;
  lfoSpeed: number;
  lfoSpeedC: number;
  lfoDelay: number;
  lfoDelayC: number;
  priority: number;
  pseudoEchoVolume: number;
  pseudoEchoLength: number;
  chan: SoundChannel | null;
  tone: ToneData;
  timer: number; // u16
  unk_3C: number; // u32
  /** The bytes cmdPtr and patternStack point into (the song's, or a cry song's). */
  data: Uint8Array;
  cmdPtr: number;
  patternStack: [number, number, number];
}

export type MPlayMainFunc = (mplayInfo: MusicPlayerInfo) => void;

/** struct MusicPlayerInfo. `name` is the C global's name, for debugging. */
export interface MusicPlayerInfo {
  name: string;
  songHeader: SongHeader | null;
  status: number; // u32
  trackCount: number;
  priority: number;
  cmd: number;
  unk_B: number;
  clock: number; // u32
  memAccArea: Uint8Array | null;
  tempoD: number;
  tempoU: number;
  tempoI: number;
  tempoC: number;
  fadeOI: number;
  fadeOC: number;
  fadeOV: number;
  tracks: MusicPlayerTrack[];
  tone: ToneData[] | null;
  ident: number;
  MPlayMainNext: MPlayMainFunc | null;
  musicPlayerNext: MusicPlayerInfo | null;
}

/** struct MusicPlayer: gMPlayTable's entry (sound/music_player_table.inc). unk_8 is the track count; unk_A is 1 for
 *  the players that keep a song of higher priority playing (SE1, SE2: MPlayStart). */
export interface MusicPlayer {
  info: MusicPlayerInfo;
  track: MusicPlayerTrack[];
  unk_8: number;
  unk_A: number;
}

export type PlyNoteFunc = (noteCmd: number, mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack) => void;

/** struct SoundInfo: the parts the sequencer and the controls use. The mixer's fields (pcmBuffer, the channels'
 *  sample state) and the CGB channels come with W-m4a 2-4. */
export interface SoundInfo {
  ident: number;
  pcmDmaCounter: number;
  reverb: number;
  maxChans: number;
  masterVolume: number;
  freq: number;
  mode: number;
  c15: number;
  pcmDmaPeriod: number;
  maxLines: number;
  pcmSamplesPerVBlank: number;
  pcmFreq: number;
  divFreq: number;
  MPlayMainHead: MPlayMainFunc | null;
  musicPlayerHead: MusicPlayerInfo | null;
  CgbSound: () => void;
  CgbOscOff: (chanNum: number) => void;
  plynote: PlyNoteFunc;
  ExtVolPit: () => void;
  chans: SoundChannel[];
  /** The PSG registers ply_port writes (REG_SOUND1CNT_L + offset): W-m4a 4 reads them. */
  soundRegs: Uint8Array;
}

/** Integer helpers for the C's field widths. */
export const u8 = (x: number): number => x & 0xff;
export const s8 = (x: number): number => ((x & 0xff) << 24) >> 24;
export const u16 = (x: number): number => x & 0xffff;
export const s16 = (x: number): number => ((x & 0xffff) << 16) >> 16;
export const u32 = (x: number): number => x >>> 0;
