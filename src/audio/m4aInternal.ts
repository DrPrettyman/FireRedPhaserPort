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
export const TONEDATA_TYPE_REV = 0x10; // reverse (constants/m4a_constants.inc)
export const TONEDATA_TYPE_CMP = 0x20; // compressed: the cries (constants/m4a_constants.inc)
export const TONEDATA_TYPE_SPL = 0x40; // key split
export const TONEDATA_TYPE_RHY = 0x80; // rhythm

export const TONEDATA_P_S_PAN = 0xc0;

export const SOUND_CHANNEL_SF_START = 0x80;
export const SOUND_CHANNEL_SF_STOP = 0x40;
export const SOUND_CHANNEL_SF_SPECIAL = 0x20; // SoundMainRAM_Unk1's start done (constants/m4a_constants.inc)
export const SOUND_CHANNEL_SF_LOOP = 0x10;
export const SOUND_CHANNEL_SF_IEC = 0x04;
export const SOUND_CHANNEL_SF_ENV = 0x03;
export const SOUND_CHANNEL_SF_ENV_ATTACK = 0x03;
export const SOUND_CHANNEL_SF_ENV_DECAY = 0x02;
export const SOUND_CHANNEL_SF_ENV_SUSTAIN = 0x01;
export const SOUND_CHANNEL_SF_ENV_RELEASE = 0x00;
export const SOUND_CHANNEL_SF_ON =
  SOUND_CHANNEL_SF_START | SOUND_CHANNEL_SF_STOP | SOUND_CHANNEL_SF_IEC | SOUND_CHANNEL_SF_ENV;

export const CGB_CHANNEL_MO_PIT = 0x02;
export const CGB_CHANNEL_MO_VOL = 0x01;

/** WaveData.status's high byte (o_WaveData_flags): the sample loops. */
export const WAVE_DATA_FLAG_LOOP = 0xc0;

export const MAX_DIRECTSOUND_CHANNELS = 12;

export const PCM_DMA_BUF_SIZE = 1584;

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

/** struct PokemonCrySong (m4a_internal.h): a cry's song, one or two tracks. The header's fields are fields here;
 *  `data` is the whole struct's byte image (0x32 bytes, the track bytes from `part0` at 0x11 on), written by the
 *  SetPokemonCry* setters at the struct's offsets (CRY_SONG_*), so the two tracks run from it like any song: part 0
 *  at 0x11 (TUNE, GOTO cont), part 1 at 0x18 (TUNE), both on through `cont` at 0x1A. */
export interface PokemonCrySong {
  trackCount: number;
  blockCount: number;
  priority: number;
  reverb: number;
  tone: ToneData | null;
  data: Uint8Array;
}

export const CRY_SONG_SIZE = 0x32;
export const CRY_SONG_PART0 = 0x11;
export const CRY_SONG_TUNE_VALUE = 0x12;
export const CRY_SONG_GOTO_TARGET = 0x14; // u32
export const CRY_SONG_PART1 = 0x18;
export const CRY_SONG_TUNE_VALUE2 = 0x19;
export const CRY_SONG_CONT = 0x1a;
export const CRY_SONG_VOLUME_VALUE = 0x1d;
export const CRY_SONG_UNK_CMD_0D_PARAM = 0x20; // u32
export const CRY_SONG_RELEASE_VALUE = 0x26;
export const CRY_SONG_PAN_VALUE = 0x28;
export const CRY_SONG_TIE_KEY_VALUE = 0x2a;
export const CRY_SONG_TIE_VELOCITY_VALUE = 0x2b;
export const CRY_SONG_LENGTH = 0x2e; // u16

/** struct WaveData: a DirectSound sample (samples.json + samples.bin). `type` is 1 for the compressed samples
 *  (the cries: wav2agb -c; here already decoded to PCM, AUDIO_PLAN decision 4) and 0 otherwise; `status`'s high
 *  byte holds WAVE_DATA_FLAG_LOOP. `freq` is the rate × 1024, `size` the sample count. `data` is the signed 8-bit
 *  PCM (null until samples.bin is loaded: the engine's logic needs only the header). `name` is the sample's label
 *  (`DirectSoundWaveData_*`, `Cry_*`), for debugging. */
export interface WaveData {
  name: string;
  type: number;
  status: number;
  freq: number;
  loopStart: number;
  size: number;
  data: Int8Array | null;
}

/** What ToneData.wav points at, by voice type: a WaveData (DirectSound), the square's duty or the noise period
 *  (CGB 1, 2, 4), the programmable wave's 16 bytes (CGB 3), or for keysplit / rhythm voices the sub-voicegroup.
 *  (ply_xwave can write a raw ROM address, a number: no FRLG song uses it.) */
export type ToneWav = WaveData | ToneData[] | Uint8Array | number | null;

/** struct ToneData: one voice of a voicegroup (m4aVoices.ts builds them from voicegroups.json). `keySplitTable`
 *  (TONEDATA_TYPE_SPL voices: the subgroup index by MIDI key) shares `attack`'s word in the C. */
export interface ToneData {
  type: number;
  key: number;
  length: number;
  pan_sweep: number;
  wav: ToneWav;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  keySplitTable?: readonly (number | null)[] | null;
}

export function emptyToneData(): ToneData {
  return { type: 0, key: 0, length: 0, pan_sweep: 0, wav: null, attack: 0, decay: 0, sustain: 0, release: 0 };
}

/** struct SongHeader. `part[i]` is track i's start as a byte offset into `data` (the song's bytes). `voicegroup` is
 *  the voicegroup's name from songs.json; `tone` is that voicegroup once resolved (setVoiceData), else null. */
export interface SongHeader {
  name: string;
  trackCount: number;
  blockCount: number;
  priority: number;
  reverb: number;
  voicegroup: string | null;
  tone: readonly (ToneData | null)[] | null;
  part: number[];
  data: Uint8Array;
}

/** struct Song: gSongTable's entry. `ms` is the music player's index in gMPlayTable. */
export interface Song {
  header: SongHeader;
  ms: number;
  me: number;
}

/** struct SoundChannel: a DirectSound channel (gSoundInfo.chans). struct CgbChannel (below) shares its first
 *  fields, which is what the sequencer and ply_note touch, so both live in a track's channel list.
 *
 *  The sample position (SoundMainRAM): `count` is the samples left from the current one to the end (before the
 *  START frame: the start offset, the track's unk_3C), `fw` the fractional position (23 bits), `currentPointer`
 *  the current sample's index into `wav.data` (reverse voices: one past it, as they read backwards). */
export interface SoundChannel {
  statusFlags: number;
  type: number;
  rightVolume: number;
  leftVolume: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** The MIDI key as translated into the final pitch (rhythm voices: the drum's key). */
  key: number;
  envelopeVolume: number;
  envelopeVolumeRight: number;
  envelopeVolumeLeft: number;
  pseudoEchoVolume: number;
  pseudoEchoLength: number;
  gateTime: number;
  /** The MIDI key as the track played it (ply_endtie matches it). */
  midiKey: number;
  velocity: number;
  priority: number;
  rhythmPan: number; // s8
  count: number; // s32 in SoundMainRAM's arithmetic
  fw: number; // u32
  frequency: number; // u32
  /** DirectSound: the WaveData. CGB (CgbChannel.wavePointer): the duty, wave bytes or noise period. */
  wav: ToneWav;
  currentPointer: number;
  track: MusicPlayerTrack | null;
  prevChannelPointer: SoundChannel | null;
  nextChannelPointer: SoundChannel | null;
}

/** struct CgbChannel: the four PSG channels (gCgbChans: square 1, square 2, wave, noise). The fields after the
 *  shared ones are CgbSound's (W-m4a 4); `wav` is the C's wavePointer. */
export interface CgbChannel extends SoundChannel {
  envelopeGoal: number;
  envelopeCounter: number;
  sustainGoal: number;
  n4: number;
  pan: number;
  panMask: number;
  modify: number;
  length: number;
  sweep: number;
  /** The wave last loaded into wave RAM (CGB 3). */
  cgbCurrentPointer: Uint8Array | null;
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
  /** The track's place in IWRAM, standing in for its address: ply_note compares track pointers to break
   *  priority ties. gMPlayTrack_BGM, _SE1, _SE2, _SE3 (sound/music_player_table.inc, in .bss) come before
   *  gPokemonCryTracks (m4a.c, COMMON). Set once by m4a.ts; not part of the C struct (Clear64byte keeps it). */
  addr: number;
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
  tone: readonly (ToneData | null)[] | null;
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

/** struct SoundInfo: the parts the sequencer, the channels, the controls and the mixer use. */
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
  MidiKeyToCgbFreq: (chanNum: number, key: number, fineAdjust: number) => number;
  plynote: PlyNoteFunc;
  ExtVolPit: () => void;
  /** gCgbChans, set by MPlayExtender (null before: ply_note then drops CGB notes, as the C does). */
  cgbChans: CgbChannel[] | null;
  chans: SoundChannel[];
  /** The PSG registers ply_port writes (REG_SOUND1CNT_L + offset): W-m4a 4 reads them. */
  soundRegs: Uint8Array;
  /** s8 pcmBuffer[PCM_DMA_BUF_SIZE * 2]: FIFO A's ring of pcmDmaPeriod 224-sample slots, then FIFO B's. */
  pcmBuffer: Int8Array;
}

/** Integer helpers for the C's field widths. */
export const u8 = (x: number): number => x & 0xff;
export const s8 = (x: number): number => ((x & 0xff) << 24) >> 24;
export const u16 = (x: number): number => x & 0xffff;
export const s16 = (x: number): number => ((x & 0xffff) << 16) >> 16;
export const u32 = (x: number): number => x >>> 0;
