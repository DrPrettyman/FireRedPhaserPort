// The m4a (MP2K) sound engine: the sequencer, the track commands and the music player controls, ported from
// src/m4a.c and src/m4a_1.s (pret/firered). Pure logic: no DOM, no AudioContext, no clock. The game runs
// m4aSoundMain() once per frame, where the GBA's VBlank does, whether or not anything is heard, so every wait on
// the sound state (IsSEPlaying, the fanfares, the BGM fades) times the same headless and in the browser.
//
// Notes take channels (ply_note: the voice through keysplit and rhythm voices, a free or stolen DirectSound
// channel, or the voice's CGB channel), and m4aMixer.ts's SoundMainRAM runs each DirectSound channel's envelope and
// sample position every frame, so channels live and end as on the GBA. The cry songs (SetPokemonCryTone and the
// SetPokemonCry* setters, IsPokemonCryPlaying) are at the end. The voices come from setVoiceData (m4aVoices.ts).
//
// SoundMainRAM (m4aMixer.ts) also mixes the DirectSound channels into pcmBuffer while mixing is on (audio/frame.ts
// hands each frame's slot to the output: m4aPcmFrame). What isn't here yet (AUDIO_PLAN.md section 6): W-m4a 4, the
// CGB channels' envelope, registers and frequencies (m4aCgb.ts is a placeholder), so songs play without their PSG
// parts.
//
// Naming follows the C. The asm's local labels are cited as `m4a_1.s _081DD8E0` and so on.

import {
  CGB_CHANNEL_MO_PIT,
  CGB_CHANNEL_MO_VOL,
  CRY_SONG_CONT,
  CRY_SONG_GOTO_TARGET,
  CRY_SONG_LENGTH,
  CRY_SONG_PAN_VALUE,
  CRY_SONG_PART0,
  CRY_SONG_PART1,
  CRY_SONG_RELEASE_VALUE,
  CRY_SONG_TIE_KEY_VALUE,
  CRY_SONG_TUNE_VALUE,
  CRY_SONG_TUNE_VALUE2,
  CRY_SONG_UNK_CMD_0D_PARAM,
  CRY_SONG_VOLUME_VALUE,
  C_V,
  FADE_IN,
  FADE_VOL_SHIFT,
  ID_NUMBER,
  MAX_DIRECTSOUND_CHANNELS,
  PCM_DMA_BUF_SIZE,
  MAX_MUSICPLAYER_TRACKS,
  MAX_POKEMON_CRIES,
  MPT_FLG_EXIST,
  MPT_FLG_PITCHG,
  MPT_FLG_PITSET,
  MPT_FLG_START,
  MPT_FLG_VOLCHG,
  MPT_FLG_VOLSET,
  MUSICPLAYER_STATUS_PAUSE,
  MUSICPLAYER_STATUS_TRACK,
  SOUND_CHANNEL_SF_ENV,
  SOUND_CHANNEL_SF_ON,
  SOUND_CHANNEL_SF_START,
  SOUND_CHANNEL_SF_STOP,
  SOUND_MODE_DA_BIT_8,
  SOUND_MODE_FREQ,
  SOUND_MODE_FREQ_13379,
  SOUND_MODE_MASVOL,
  SOUND_MODE_MASVOL_SHIFT,
  SOUND_MODE_MAXCHN,
  SOUND_MODE_MAXCHN_SHIFT,
  SOUND_MODE_REVERB_SET,
  SOUND_MODE_REVERB_VAL,
  TEMPORARY_FADE,
  TONEDATA_P_S_PAN,
  TONEDATA_TYPE_CGB,
  TONEDATA_TYPE_RHY,
  TONEDATA_TYPE_SPL,
  emptyToneData,
  s16,
  s8,
  u16,
  u32,
  u8,
  type CgbChannel,
  type MusicPlayer,
  type MusicPlayerInfo,
  type MusicPlayerTrack,
  type PokemonCrySong,
  type Song,
  type SongHeader,
  type SoundChannel,
  type SoundInfo,
  type ToneData,
  type ToneWav,
} from './m4aInternal';
import { CgbOscOff, CgbSound, MidiKeyToCgbFreq, newCgbChannels } from './m4aCgb';
import { PcmSlotOffset, SoundMainRAM, isWaveData } from './m4aMixer';
import { SOUNDCNT_H_MONO, SOUNDCNT_H_STEREO } from './outputCore';
import {
  gClockTable,
  gFreqTable,
  gPcmSamplesPerVBlankTable,
  gScaleTable,
  pokemonCrySongTemplate,
} from './m4aTables';
import {
  buildVoiceData,
  makeWaveData,
  type SamplesJson,
  type VoiceData,
  type VoicegroupsJson,
  type WavesJson,
} from './m4aVoices';

// ---------------------------------------------------------------------------------------------------------------
// Globals (m4a.c's COMMON_DATA, sound/music_player_table.inc)

const EMPTY_SONG_DATA = new Uint8Array(0);

function newTrack(): MusicPlayerTrack {
  return {
    flags: 0, wait: 0, patternLevel: 0, repN: 0, gateTime: 0, key: 0, velocity: 0, runningStatus: 0, keyM: 0,
    pitM: 0, keyShift: 0, keyShiftX: 0, tune: 0, pitX: 0, bend: 0, bendRange: 0, volMR: 0, volML: 0, vol: 0,
    volX: 0, pan: 0, panX: 0, modM: 0, mod: 0, modT: 0, lfoSpeed: 0, lfoSpeedC: 0, lfoDelay: 0, lfoDelayC: 0,
    priority: 0, pseudoEchoVolume: 0, pseudoEchoLength: 0, chan: null, tone: emptyToneData(), timer: 0,
    unk_3C: 0, data: EMPTY_SONG_DATA, cmdPtr: 0, patternStack: [0, 0, 0], addr: 0,
  };
}

function newMusicPlayerInfo(name: string): MusicPlayerInfo {
  return {
    name, songHeader: null, status: 0, trackCount: 0, priority: 0, cmd: 0, unk_B: 0, clock: 0, memAccArea: null,
    tempoD: 0, tempoU: 0, tempoI: 0, tempoC: 0, fadeOI: 0, fadeOC: 0, fadeOV: 0, tracks: [], tone: null, ident: 0,
    MPlayMainNext: null, musicPlayerNext: null,
  };
}

function newSoundChannel(): SoundChannel {
  return {
    statusFlags: 0, type: 0, rightVolume: 0, leftVolume: 0, attack: 0, decay: 0, sustain: 0, release: 0, key: 0,
    envelopeVolume: 0, envelopeVolumeRight: 0, envelopeVolumeLeft: 0, pseudoEchoVolume: 0, pseudoEchoLength: 0,
    gateTime: 0, midiKey: 0, velocity: 0, priority: 0, rhythmPan: 0, count: 0, fw: 0, frequency: 0, wav: null,
    currentPointer: 0, track: null, prevChannelPointer: null, nextChannelPointer: null,
  };
}

function DummyFunc(): void {}

function newSoundInfo(): SoundInfo {
  return {
    ident: 0, pcmDmaCounter: 0, reverb: 0, maxChans: 0, masterVolume: 0, freq: 0, mode: 0, c15: 0,
    pcmDmaPeriod: 0, maxLines: 0, pcmSamplesPerVBlank: 0, pcmFreq: 0, divFreq: 0, MPlayMainHead: null,
    musicPlayerHead: null, CgbSound: DummyFunc, CgbOscOff: DummyFunc, MidiKeyToCgbFreq: () => 0, plynote: ply_note,
    ExtVolPit: DummyFunc, cgbChans: null, chans: [], soundRegs: new Uint8Array(0x100),
    pcmBuffer: new Int8Array(PCM_DMA_BUF_SIZE * 2),
  };
}

/** gSoundInfo (SOUND_INFO_PTR points at it). */
export const gSoundInfo: SoundInfo = newSoundInfo();

export const gMPlayInfo_BGM = newMusicPlayerInfo('gMPlayInfo_BGM');
export const gMPlayInfo_SE1 = newMusicPlayerInfo('gMPlayInfo_SE1');
export const gMPlayInfo_SE2 = newMusicPlayerInfo('gMPlayInfo_SE2');
export const gMPlayInfo_SE3 = newMusicPlayerInfo('gMPlayInfo_SE3');

// sound/music_player_table.inc
const NUM_TRACKS_BGM = 10;
const NUM_TRACKS_SE1 = 3;
const NUM_TRACKS_SE2 = 9;
const NUM_TRACKS_SE3 = 1;

const newTracks = (n: number): MusicPlayerTrack[] => Array.from({ length: n }, newTrack);

/** gMPlayTable (sound/music_player_table.inc): `music_player info, tracks, NUM_TRACKS, unk_A`. */
export const gMPlayTable: readonly MusicPlayer[] = [
  { info: gMPlayInfo_BGM, track: newTracks(NUM_TRACKS_BGM), unk_8: NUM_TRACKS_BGM, unk_A: 0 },
  { info: gMPlayInfo_SE1, track: newTracks(NUM_TRACKS_SE1), unk_8: NUM_TRACKS_SE1, unk_A: 1 },
  { info: gMPlayInfo_SE2, track: newTracks(NUM_TRACKS_SE2), unk_8: NUM_TRACKS_SE2, unk_A: 1 },
  { info: gMPlayInfo_SE3, track: newTracks(NUM_TRACKS_SE3), unk_8: NUM_TRACKS_SE3, unk_A: 0 },
];

/** NUM_MUSIC_PLAYERS */
export const NUM_MUSIC_PLAYERS = gMPlayTable.length;

/** gMPlayMemAccArea: the 16 bytes MEMACC reads and writes, shared by the four players. */
export const gMPlayMemAccArea = new Uint8Array(0x10);

/** gPokemonCryMusicPlayers / gPokemonCryTracks: two players of two tracks each (SetPokemonCryTone). */
export const gPokemonCryMusicPlayers: readonly MusicPlayerInfo[] = Array.from({ length: MAX_POKEMON_CRIES }, (_, i) =>
  newMusicPlayerInfo(`gPokemonCryMusicPlayers[${i}]`),
);
export const gPokemonCryTracks: readonly MusicPlayerTrack[] = newTracks(MAX_POKEMON_CRIES * 2);

// The tracks' order in IWRAM (MusicPlayerTrack.addr): gMPlayTrack_BGM ... _SE3 in .bss, then gPokemonCryTracks in
// COMMON (ld_script.ld). 0 stands for a null track.
[...gMPlayTable.flatMap((m) => m.track), ...gPokemonCryTracks].forEach((track, i) => (track.addr = i + 1));

/** gSongTable: set by loadSongTable (songTable.ts) from songs.json; the index is the song id. */
export let gSongTable: readonly Song[] = [];

/** Installs the song table; once the voices are loaded (setVoiceData, either order) each song's `tone` is its
 *  voicegroup. */
export function setSongTable(songs: readonly Song[]): void {
  gSongTable = songs;
  if (gVoiceData) setSongTones(gVoiceData);
}

// ---------------------------------------------------------------------------------------------------------------
// The voices: voicegroups.json, samples.json, waves.json (m4aVoices.ts)

/** The loaded voices (null until setVoiceData). */
export let gVoiceData: VoiceData | null = null;
/** gCryTable / gCryTable_Reverse (sound/cry_tables.inc), indexed by SpeciesToCryId: empty until setVoiceData. */
export let gCryTable: readonly ToneData[] = [];
export let gCryTable_Reverse: readonly ToneData[] = [];

/**
 * Binds the extracted voice data to the engine: builds every voicegroup's ToneData (keysplit and rhythm voices
 * resolved to their subgroups, DirectSound voices to their samples' WaveData, the programmable waves), sets each
 * song's SongHeader.tone from its voicegroup (now, and for a song table installed later) and the cry tables.
 * `pcm` is samples.bin, which only the mixer needs (setSamplePcm adds it later). Call it once at boot with the
 * parsed JSONs; it doesn't reset the engine (m4aSoundInit doesn't drop it either). Throws on a dangling reference.
 */
export function setVoiceData(
  voicegroups: VoicegroupsJson,
  samples: SamplesJson,
  waves: WavesJson,
  pcm?: Uint8Array | ArrayBuffer,
): VoiceData {
  const data = buildVoiceData(voicegroups, samples, waves, pcm);
  gVoiceData = data;
  gSamplesJson = samples;
  gCryTable = data.cryTable;
  gCryTable_Reverse = data.cryTableReverse;
  setSongTones(data);
  return data;
}

let gSamplesJson: SamplesJson | null = null;

/** Adds samples.bin's PCM to the loaded voices' WaveData (for the mixer; the engine's timing doesn't need it). */
export function setSamplePcm(pcm: Uint8Array | ArrayBuffer): void {
  if (!gVoiceData || !gSamplesJson) throw new Error('setSamplePcm: call setVoiceData first');
  const bytes = pcm instanceof ArrayBuffer ? new Uint8Array(pcm) : pcm;
  for (const [label, wave] of gVoiceData.samples) wave.data = makeWaveData(label, gSamplesJson[label], bytes).data;
}

function setSongTones(data: VoiceData): void {
  for (const song of gSongTable) {
    const name = song.header.voicegroup;
    if (name === null) continue;
    const tone = data.voicegroups.get(name);
    if (!tone) console.warn(`[m4a] ${song.header.name}: no voicegroup ${name}`);
    song.header.tone = tone ?? null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Clear64byte (m4a_1.s's SoundMainBTM through gMPlayJumpTable[35]): zeroes the first 64 bytes of a struct. A
// MusicPlayerInfo is exactly 64 bytes; on a MusicPlayerTrack it covers everything before cmdPtr.

function Clear64byteTrack(track: MusicPlayerTrack): void {
  const { data, cmdPtr, patternStack, addr } = track;
  Object.assign(track, newTrack(), { data, cmdPtr, patternStack, addr });
}

function Clear64byteInfo(mplayInfo: MusicPlayerInfo): void {
  Object.assign(mplayInfo, newMusicPlayerInfo(mplayInfo.name));
}

/** The reset a track gets when MPlayMain first runs it after MPlayStart (m4a_1.s _081DD8BA) and in
 *  m4aMPlayImmInit. */
function TrackInit(track: MusicPlayerTrack): void {
  Clear64byteTrack(track);
  track.flags = MPT_FLG_EXIST;
  track.bendRange = 2;
  track.volX = 64;
  track.lfoSpeed = 22;
  track.tone.type = 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Init: m4aSoundInit, SoundInit, MPlayExtender, m4aSoundMode, SampleFreqSet, MPlayOpen

/** m4aSoundInit (m4a.c): SoundInit, MPlayExtender, the sound mode (8-bit DAC, 13,379 Hz, master volume 12, 5
 *  DirectSound channels), then opens the four music players and the two cry players. Calling it again resets the
 *  whole engine (tests do). */
export function m4aSoundInit(): void {
  SoundInit(gSoundInfo);
  MPlayExtender();
  m4aSoundMode(
    SOUND_MODE_DA_BIT_8 | SOUND_MODE_FREQ_13379 | (12 << SOUND_MODE_MASVOL_SHIFT) | (5 << SOUND_MODE_MAXCHN_SHIFT),
  );

  // gMPlayMemAccArea is zeroed RAM at boot; cleared here so a second m4aSoundInit starts the same way.
  gMPlayMemAccArea.fill(0);

  for (const mplay of gMPlayTable) {
    const mplayInfo = mplay.info;
    MPlayOpen(mplayInfo, mplay.track, mplay.unk_8);
    mplayInfo.unk_B = mplay.unk_A;
    mplayInfo.memAccArea = gMPlayMemAccArea;
  }

  Object.assign(gPokemonCrySong, pokemonCrySongTemplate());

  for (let i = 0; i < MAX_POKEMON_CRIES; i++) {
    const mplayInfo = gPokemonCryMusicPlayers[i];
    const tracks = gPokemonCryTracks.slice(i * 2, i * 2 + 2);
    MPlayOpen(mplayInfo, tracks, 2);
    tracks[0].chan = null;
  }
}

/** SoundInit (m4a.c). The DMA and sound registers it sets have no counterpart here. */
export function SoundInit(soundInfo: SoundInfo): void {
  Object.assign(soundInfo, newSoundInfo()); // CpuFill32(0, soundInfo, sizeof(struct SoundInfo))
  soundInfo.chans = Array.from({ length: MAX_DIRECTSOUND_CHANNELS }, newSoundChannel);
  soundInfo.maxChans = 8;
  soundInfo.masterVolume = 15;
  soundInfo.plynote = ply_note;
  soundInfo.CgbSound = DummyFunc;
  soundInfo.CgbOscOff = DummyFunc;
  soundInfo.ExtVolPit = DummyFunc;
  MPlayJumpTableCopy();
  gRegSoundCntH = SOUNDCNT_H_STEREO; // REG_SOUNDCNT_H (the FIFO resets and timer bits have no counterpart)
  SampleFreqSet(SOUND_MODE_FREQ_13379);
  soundInfo.ident = ID_NUMBER;
}

/**
 * REG_SOUNDCNT_H as SoundInit and SetPokemonCryStereo set it: the FIFOs' routing to the speakers and their volume
 * (outputCore.ts's SOUNDCNT_H_STEREO / _MONO), which the output's DAC applies to each frame (m4aPcmFrame).
 */
export let gRegSoundCntH = SOUNDCNT_H_STEREO;

/** MPlayExtender (m4a.c:257): puts the C versions of ply_memacc, ply_lfos, ply_mod, ply_xcmd and ply_endtie in the
 *  jump table and sets up the CGB channels (gCgbChans) and functions (m4aCgb.ts: placeholders until W-m4a 4, as are
 *  the sound registers it writes). */
export function MPlayExtender(): void {
  const soundInfo = gSoundInfo;
  gMPlayJumpTable[8] = ply_memacc;
  gMPlayJumpTable[17] = ply_lfos;
  gMPlayJumpTable[19] = ply_mod;
  gMPlayJumpTable[28] = ply_xcmd;
  gMPlayJumpTable[29] = ply_endtie;
  soundInfo.cgbChans = newCgbChannels();
  soundInfo.CgbSound = () => CgbSound(gSoundInfo);
  soundInfo.CgbOscOff = CgbOscOff;
  soundInfo.MidiKeyToCgbFreq = MidiKeyToCgbFreq;
}

/** m4aSoundMode (m4a.c): reverb, the DirectSound channel count (stopping every channel), master volume, DAC bits and
 *  sample rate, each only if its field in `mode` is non-zero. */
export function m4aSoundMode(mode: number): void {
  const soundInfo = gSoundInfo;
  if (soundInfo.ident !== ID_NUMBER) return;

  let temp = mode & (SOUND_MODE_REVERB_SET | SOUND_MODE_REVERB_VAL);
  if (temp) soundInfo.reverb = temp & SOUND_MODE_REVERB_VAL;

  temp = mode & SOUND_MODE_MAXCHN;
  if (temp) {
    soundInfo.maxChans = temp >> SOUND_MODE_MAXCHN_SHIFT;
    for (const chan of soundInfo.chans) chan.statusFlags = 0;
  }

  temp = mode & SOUND_MODE_MASVOL;
  if (temp) soundInfo.masterVolume = temp >> SOUND_MODE_MASVOL_SHIFT;

  // SOUND_MODE_DA_BIT sets REG_SOUNDBIAS_H's resolution bits: no counterpart (the mixer writes 8-bit samples).

  temp = mode & SOUND_MODE_FREQ;
  if (temp) SampleFreqSet(temp); // after m4aSoundVSyncOff, which only stops the DMA
}

/** SampleFreqSet (m4a.c): the mixing rate's derived numbers (224 samples per VBlank at 13,379 Hz). The timer and
 *  the VCOUNT wait have no counterpart; m4aSoundVSyncOn's part is the DMA counter reset. */
export function SampleFreqSet(freq: number): void {
  const soundInfo = gSoundInfo;
  freq = (freq & 0xf0000) >> 16;
  soundInfo.freq = freq;
  soundInfo.pcmSamplesPerVBlank = gPcmSamplesPerVBlankTable[freq - 1];
  soundInfo.pcmDmaPeriod = Math.floor(1584 / soundInfo.pcmSamplesPerVBlank); // PCM_DMA_BUF_SIZE
  // LCD refresh rate 59.7275Hz
  soundInfo.pcmFreq = Math.floor((597275 * soundInfo.pcmSamplesPerVBlank + 5000) / 10000);
  // CPU frequency 16.78Mhz
  soundInfo.divFreq = (Math.floor(16777216 / soundInfo.pcmFreq) + 1) >> 1;
  soundInfo.pcmDmaCounter = 0; // m4aSoundVSyncOn
}

/** MPlayOpen (m4a.c): clears the player, gives it its tracks (paused, no song) and puts it at the head of the
 *  MPlayMain chain, so the players opened later are called first (see MPlayMain for the order they run in). */
export function MPlayOpen(mplayInfo: MusicPlayerInfo, tracks: MusicPlayerTrack[], trackCount: number): void {
  const soundInfo = gSoundInfo;
  if (trackCount === 0) return;
  if (trackCount > MAX_MUSICPLAYER_TRACKS) trackCount = MAX_MUSICPLAYER_TRACKS;
  if (soundInfo.ident !== ID_NUMBER) return;

  Clear64byteInfo(mplayInfo);
  mplayInfo.tracks = tracks;
  mplayInfo.trackCount = trackCount;
  mplayInfo.status = MUSICPLAYER_STATUS_PAUSE;
  for (let i = 0; i < trackCount; i++) tracks[i].flags = 0;

  // append music player and MPlayMain to linked list
  if (soundInfo.MPlayMainHead !== null) {
    mplayInfo.MPlayMainNext = soundInfo.MPlayMainHead;
    mplayInfo.musicPlayerNext = soundInfo.musicPlayerHead;
  }
  soundInfo.musicPlayerHead = mplayInfo;
  soundInfo.MPlayMainHead = MPlayMain;
  mplayInfo.ident = ID_NUMBER;
}

// ---------------------------------------------------------------------------------------------------------------
// The frame: m4aSoundMain → SoundMain → MPlayMain

/** m4aSoundMain (m4a.c), run once per frame from VBlank (main.c VBlankIntr). */
export function m4aSoundMain(): void {
  SoundMain();
}

/**
 * m4aSoundVSync (m4a_1.s:1071), from VCountIntr (main.c:439) once per frame: counts the DMA's pcmBuffer slots down
 * and reloads the counter (restarting the DMA at slot 0) when it reaches 0. Only the mixer's slot depends on it
 * (PcmSlotOffset); the DMA restart has no counterpart.
 */
export function m4aSoundVSync(): void {
  const soundInfo = gSoundInfo;
  if (((soundInfo.ident - ID_NUMBER) >>> 0) > 1) return;
  const counter = soundInfo.pcmDmaCounter - 1; // ldrb, subs: a counter of 0 goes to -1
  soundInfo.pcmDmaCounter = counter > 0 ? counter : soundInfo.pcmDmaPeriod;
}

/** A frame of sound as the DMA reads it: the slot SoundMain mixed into this frame (views into pcmBuffer: copy them
 *  before the next frame) and REG_SOUNDCNT_H. The shape of output.ts's SoundFrame. */
export interface PcmFrame {
  fifoA: Int8Array;
  fifoB: Int8Array;
  soundcntH: number;
}

/** The frame m4aSoundMain just mixed (call it after m4aSoundMain, before the next m4aSoundVSync). */
export function m4aPcmFrame(): PcmFrame {
  const soundInfo = gSoundInfo;
  const n = soundInfo.pcmSamplesPerVBlank;
  const slot = PcmSlotOffset(soundInfo);
  const buf = soundInfo.pcmBuffer;
  return {
    fifoA: buf.subarray(slot, slot + n),
    fifoB: buf.subarray(PCM_DMA_BUF_SIZE + slot, PCM_DMA_BUF_SIZE + slot + n),
    soundcntH: gRegSoundCntH,
  };
}

/** SoundMain (m4a_1.s): the music players' sequencers (SoundMain_3), CgbSound (SoundMain_4), then SoundMainRAM
 *  (m4aMixer.ts: the DirectSound channels). maxLines (the CPU budget in scanlines) has no counterpart. */
export function SoundMain(): void {
  const soundInfo = gSoundInfo;
  if (soundInfo.ident !== ID_NUMBER) return;
  if (soundInfo.MPlayMainHead !== null && soundInfo.musicPlayerHead !== null) {
    soundInfo.MPlayMainHead(soundInfo.musicPlayerHead);
  }
  soundInfo.CgbSound();
  SoundMainRAM(soundInfo);
}

/** Safety net for corrupt song data: a track that reads this many commands in one tick without a wait (a GOTO to
 *  itself) would hang the GBA. Real songs never get near it. */
const MAX_COMMANDS_PER_TICK = 0x10000;

/** Reads the byte at `ptr` in a track's data. Past the end reads as FINE (never happens with real songs). */
function readByte(track: MusicPlayerTrack, ptr: number): number {
  return ptr < track.data.length ? track.data[ptr] : 0xb1;
}

/** ld_r3_tp_adr_i (m4a_1.s): the byte at cmdPtr, then cmdPtr++. */
function ld_r3_tp_adr_i(track: MusicPlayerTrack): number {
  const b = readByte(track, track.cmdPtr);
  track.cmdPtr++;
  return b;
}

/**
 * MPlayMain (m4a_1.s:1129): one frame of one music player.
 *
 * It first calls the next player in the chain (`o_MusicPlayerInfo_func` / `intp`, before any work of its own), so
 * although SoundMain calls the newest player (cry player 1), the work runs oldest first: BGM, SE1, SE2, SE3, cry
 * player 0, cry player 1.
 *
 * Then, unless paused: FadeOutBody; `tempoC += tempoI`; while `tempoC >= 150` one tick (every live track: its
 * channels' gate times, then commands until a wait, then `wait--` and the LFO), after which `status` is the set of
 * tracks that were live at the start of the tick. A tick that finds no live track sets `status` to
 * MUSICPLAYER_STATUS_PAUSE and ends the frame (`_081DD9A4`): so the status clears one tick after the last FINE.
 * Last, the volume / pitch of each track whose VOLCHG / PITCHG flags are set (TrkVolPitSet and the channels).
 */
export function MPlayMain(mplayInfo: MusicPlayerInfo): void {
  if (mplayInfo.ident !== ID_NUMBER) return;

  // _081DD82E: the rest of the chain first.
  if (mplayInfo.MPlayMainNext !== null && mplayInfo.musicPlayerNext !== null) {
    mplayInfo.MPlayMainNext(mplayInfo.musicPlayerNext);
  }

  if (mplayInfo.status & MUSICPLAYER_STATUS_PAUSE) return;
  FadeOutBody(mplayInfo);
  if (mplayInfo.status & MUSICPLAYER_STATUS_PAUSE) return;

  // _081DD86C / _081DD9BC
  mplayInfo.tempoC = u16(mplayInfo.tempoC + mplayInfo.tempoI);
  while (mplayInfo.tempoC >= 150) {
    // _081DD874: one tick
    let liveTracks = 0;
    for (let i = 0, bit = 1; i < mplayInfo.trackCount; i++, bit <<= 1) {
      const track = mplayInfo.tracks[i];
      if (!(track.flags & MPT_FLG_EXIST)) continue;
      liveTracks |= bit;
      MPlayMainTrackTick(mplayInfo, track);
    }

    // _081DD9A4
    mplayInfo.clock = u32(mplayInfo.clock + 1);
    if (liveTracks === 0) {
      mplayInfo.status = MUSICPLAYER_STATUS_PAUSE;
      return;
    }
    mplayInfo.status = liveTracks;
    mplayInfo.tempoC = u16(mplayInfo.tempoC - 150);
  }

  // _081DD9C4: volume and pitch
  for (let i = 0; i < mplayInfo.trackCount; i++) {
    const track = mplayInfo.tracks[i];
    if (!(track.flags & MPT_FLG_EXIST)) continue;
    if (!(track.flags & (MPT_FLG_VOLCHG | MPT_FLG_PITCHG))) continue;
    TrkVolPitSet(mplayInfo, track);
    for (let chan = track.chan; chan !== null; chan = chan.nextChannelPointer) {
      if (!(chan.statusFlags & SOUND_CHANNEL_SF_ON)) {
        ClearChain(chan);
        continue;
      }
      ChnVolPitUpdate(mplayInfo, track, chan);
    }
    track.flags &= 0xf0;
  }
}

/** One tick of one live track (m4a_1.s _081DD886 to _081DD994). */
function MPlayMainTrackTick(mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  // _081DD892: count the channels' gate times down; a channel whose gate time runs out is released.
  for (let chan = track.chan; chan !== null; chan = chan.nextChannelPointer) {
    if (chan.statusFlags & SOUND_CHANNEL_SF_ON) {
      if (chan.gateTime !== 0) {
        chan.gateTime = u8(chan.gateTime - 1);
        if (chan.gateTime === 0) chan.statusFlags |= SOUND_CHANNEL_SF_STOP;
      }
    } else {
      ClearChain(chan); // _081DD8AE
    }
  }

  // _081DD8BA: the first tick after MPlayStart
  if (track.flags & MPT_FLG_START) TrackInit(track);

  // _081DD938 / _081DD8E0: read commands while the wait is 0
  let commands = 0;
  while (track.wait === 0) {
    if (++commands > MAX_COMMANDS_PER_TICK) {
      console.warn(`[m4a] ${mplayInfo.name}: no wait in ${MAX_COMMANDS_PER_TICK} commands; stopping the track`);
      ply_fine(mplayInfo, track);
      return;
    }
    let cmd = readByte(track, track.cmdPtr);
    if (cmd < 0x80) {
      cmd = track.runningStatus; // running status: the byte is the argument
    } else {
      track.cmdPtr++;
      if (cmd >= 0xbd) track.runningStatus = cmd;
    }

    if (cmd >= 0xcf) {
      gSoundInfo.plynote(cmd - 0xcf, mplayInfo, track);
    } else if (cmd > 0xb0) {
      mplayInfo.cmd = cmd - 0xb1;
      gMPlayJumpTable[cmd - 0xb1](mplayInfo, track);
      if (track.flags === 0) return; // FINE (or PATT too deep): the track is gone, no wait or LFO
    } else if (cmd >= 0x80) {
      track.wait = gClockTable[cmd - 0x80]; // _081DD92E: W00-W96
    } else {
      // A data byte with no running status yet (corrupt data: the C would index before gClockTable).
      ply_fine(mplayInfo, track);
      return;
    }
  }

  track.wait = u8(track.wait - 1);

  // The LFO (_081DD938 on): after lfoDelay ticks from the note, a triangle wave of period 256 / lfoSpeed ticks
  // and depth `mod` into modM.
  if (track.lfoSpeed === 0 || track.mod === 0) return;
  if (track.lfoDelayC !== 0) {
    track.lfoDelayC--;
    return;
  }
  track.lfoSpeedC = u8(track.lfoSpeedC + track.lfoSpeed);
  const c = track.lfoSpeedC;
  // _081DD95A: ((c - 0x40) << 24) < 0 → s8(c), else 0x80 - c
  const wave = (u8(c - 0x40) & 0x80) !== 0 ? s8(c) : 0x80 - c;
  const modM = (track.mod * wave) >> 6;
  if (u8(track.modM ^ modM) === 0) return;
  track.modM = s8(modM);
  track.flags |= track.modT === 0 ? MPT_FLG_PITCHG : MPT_FLG_VOLCHG;
}

/** The per-channel half of MPlayMain's volume / pitch update (m4a_1.s _081DD9F6 to _081DDA52): ChnVolSetAsm on
 *  VOLCHG, the channel frequency (MidiKeyToFreq / MidiKeyToCgbFreq from key + keyM, pitM) on PITCHG; a CGB channel
 *  also gets its `modify` bits for CgbSound. */
function ChnVolPitUpdate(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack, chan: SoundChannel): void {
  const cgbType = chan.type & TONEDATA_TYPE_CGB;
  if (track.flags & MPT_FLG_VOLCHG) {
    ChnVolSetAsm(chan, track);
    if (cgbType) (chan as CgbChannel).modify |= CGB_CHANNEL_MO_VOL;
  }
  if (track.flags & MPT_FLG_PITCHG) {
    let key = chan.key + track.keyM;
    if (key < 0) key = 0;
    if (cgbType) {
      chan.frequency = gSoundInfo.MidiKeyToCgbFreq(cgbType, key, track.pitM);
      (chan as CgbChannel).modify |= CGB_CHANNEL_MO_PIT;
    } else {
      chan.frequency = MidiKeyToFreq(chan.wav, key, track.pitM);
    }
  }
}

/** ChnVolSetAsm (m4a_1.s:1514): the channel's right / left volume from its velocity, rhythm pan and the track's
 *  volMR / volML. */
export function ChnVolSetAsm(chan: SoundChannel, track: MusicPlayerTrack): void {
  const velocity = chan.velocity;
  const pan = chan.rhythmPan;
  let right = ((128 + pan) * velocity * track.volMR) >> 14;
  if (right > 0xff) right = 0xff;
  chan.rightVolume = right;
  let left = ((127 - pan) * velocity * track.volML) >> 14;
  if (left > 0xff) left = 0xff;
  chan.leftVolume = left;
}

/** umul3232H32 (m4a_1.s:10): the high 32 bits of an unsigned 32 × 32 multiply. */
export function umul3232H32(a: number, b: number): number {
  a >>>= 0;
  b >>>= 0;
  const aLo = a & 0xffff, aHi = a >>> 16, bLo = b & 0xffff, bHi = b >>> 16;
  const lo = aLo * bLo, mid1 = aHi * bLo, mid2 = aLo * bHi;
  const carry = ((lo >>> 16) + (mid1 & 0xffff) + (mid2 & 0xffff)) >>> 16;
  return (aHi * bHi + (mid1 >>> 16) + (mid2 >>> 16) + carry) >>> 0;
}

/** MidiKeyToFreq (m4a.c:23): a DirectSound channel's frequency (the sample's rate scaled to the key; key 60 plays
 *  it at its own rate), with fineAdjust in 1/256 semitones. SoundMainRAM steps divFreq × frequency / 2^23 samples
 *  per output sample. A channel with no sample (the voice data isn't loaded) gets 0. */
export function MidiKeyToFreq(wav: ToneWav, key: number, fineAdjust: number): number {
  if (!isWaveData(wav)) return 0;
  key = u8(key);
  let fineAdjustShifted = u32(u8(fineAdjust) << 24);
  if (key > 178) {
    key = 178;
    fineAdjustShifted = u32(255 << 24);
  }
  let val1 = gScaleTable[key];
  val1 = gFreqTable[val1 & 0xf] >>> (val1 >> 4);
  let val2 = gScaleTable[key + 1];
  val2 = gFreqTable[val2 & 0xf] >>> (val2 >> 4);
  return umul3232H32(wav.freq, u32(val1 + umul3232H32(u32(val2 - val1), fineAdjustShifted)));
}

/** TrackStop (m4a_1.s:1468): stops every channel of the track (CgbOscOff for the PSG ones) and unlinks them. */
export function TrackStop(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  if (!(track.flags & MPT_FLG_EXIST)) return;
  for (let chan = track.chan; chan !== null; chan = chan.nextChannelPointer) {
    if (chan.statusFlags !== 0) {
      if (chan.type & TONEDATA_TYPE_CGB) gSoundInfo.CgbOscOff(chan.type & TONEDATA_TYPE_CGB);
      chan.statusFlags = 0;
    }
    chan.track = null;
  }
  track.chan = null;
}

/** RealClearChain (m4a_1.s:726): unlinks a channel from its track's channel list. */
export function RealClearChain(chan: SoundChannel): void {
  const track = chan.track;
  if (track === null) return;
  const next = chan.nextChannelPointer;
  const prev = chan.prevChannelPointer;
  if (prev !== null) prev.nextChannelPointer = next;
  else track.chan = next;
  if (next !== null) next.prevChannelPointer = prev;
  chan.track = null;
}

/** ClearChain (m4a.c): gMPlayJumpTable[34], RealClearChain. */
export function ClearChain(chan: SoundChannel): void {
  RealClearChain(chan);
}

// ---------------------------------------------------------------------------------------------------------------
// Starting and stopping: MPlayStart, m4aMPlayStop, MPlayContinue, FadeOutBody, TrkVolPitSet

/**
 * MPlayStart (m4a.c:611). On the players with unk_B set (SE1, SE2) a song only replaces the current one if the
 * player is free (no song, or the current one already ran its first tick, and no live track or paused) or the new
 * song's priority is at least the current one's. The BGM and SE3 players (and the cry players) always restart.
 * The tracks are set up here and reset by their first tick in MPlayMain (MPT_FLG_START); `status` stays 0 until
 * that tick.
 */
export function MPlayStart(mplayInfo: MusicPlayerInfo, songHeader: SongHeader): void {
  if (mplayInfo.ident !== ID_NUMBER) return;

  const unk_B = mplayInfo.unk_B;
  if (
    !unk_B ||
    ((mplayInfo.songHeader === null || !(mplayInfo.tracks[0].flags & MPT_FLG_START)) &&
      ((mplayInfo.status & MUSICPLAYER_STATUS_TRACK) === 0 || mplayInfo.status & MUSICPLAYER_STATUS_PAUSE)) ||
    mplayInfo.priority <= songHeader.priority
  ) {
    mplayInfo.status = 0;
    mplayInfo.songHeader = songHeader;
    mplayInfo.tone = songHeader.tone;
    mplayInfo.priority = songHeader.priority;
    mplayInfo.clock = 0;
    mplayInfo.tempoD = 150;
    mplayInfo.tempoI = 150;
    mplayInfo.tempoU = 0x100;
    mplayInfo.tempoC = 0;
    mplayInfo.fadeOI = 0;

    let i = 0;
    for (; i < songHeader.trackCount && i < mplayInfo.trackCount; i++) {
      const track = mplayInfo.tracks[i];
      TrackStop(mplayInfo, track);
      track.flags = MPT_FLG_EXIST | MPT_FLG_START;
      track.chan = null;
      track.data = songHeader.data;
      track.cmdPtr = songHeader.part[i];
    }
    for (; i < mplayInfo.trackCount; i++) {
      const track = mplayInfo.tracks[i];
      TrackStop(mplayInfo, track);
      track.flags = 0;
    }

    if (songHeader.reverb & SOUND_MODE_REVERB_SET) m4aSoundMode(songHeader.reverb);
  }
}

/** m4aMPlayStop (m4a.c:668): pauses the player and stops its tracks' channels. The tracks keep their place, so
 *  m4aMPlayContinue resumes where it stopped. */
export function m4aMPlayStop(mplayInfo: MusicPlayerInfo): void {
  if (mplayInfo.ident !== ID_NUMBER) return;
  mplayInfo.status = u32(mplayInfo.status | MUSICPLAYER_STATUS_PAUSE);
  for (let i = 0; i < mplayInfo.trackCount; i++) TrackStop(mplayInfo, mplayInfo.tracks[i]);
}

/** MPlayContinue (m4a.c): clears the pause bit. */
export function MPlayContinue(mplayInfo: MusicPlayerInfo): void {
  if (mplayInfo.ident !== ID_NUMBER) return;
  mplayInfo.status = u32(mplayInfo.status & ~MUSICPLAYER_STATUS_PAUSE);
}

/** MPlayFadeOut (m4a.c). */
export function MPlayFadeOut(mplayInfo: MusicPlayerInfo, speed: number): void {
  if (mplayInfo.ident !== ID_NUMBER) return;
  mplayInfo.fadeOC = u16(speed);
  mplayInfo.fadeOI = u16(speed);
  mplayInfo.fadeOV = 64 << FADE_VOL_SHIFT;
}

/**
 * FadeOutBody (m4a.c:692), run by MPlayMain each frame: every `fadeOI` frames one step of 4/64 of the volume
 * (track volX = fadeOV >> 2). A fade-in ends after 16 steps at full volume. A fade-out stops the player at the
 * step that takes fadeOV to 0 or below: the 16th for m4aMPlayFadeOut, the 17th for m4aMPlayFadeOutTemporarily
 * (its TEMPORARY_FADE bit is the low bit of fadeOV, so 257 needs 17 steps of 16); a temporary fade only pauses
 * (the tracks keep their place for m4aMPlayFadeIn / m4aMPlayContinue), a full one clears the tracks.
 */
export function FadeOutBody(mplayInfo: MusicPlayerInfo): void {
  if (mplayInfo.fadeOI === 0) return;
  mplayInfo.fadeOC = u16(mplayInfo.fadeOC - 1);
  if (mplayInfo.fadeOC !== 0) return;
  mplayInfo.fadeOC = mplayInfo.fadeOI;

  if (mplayInfo.fadeOV & FADE_IN) {
    mplayInfo.fadeOV = u16(mplayInfo.fadeOV + (4 << FADE_VOL_SHIFT));
    if (mplayInfo.fadeOV >= 64 << FADE_VOL_SHIFT) {
      mplayInfo.fadeOV = 64 << FADE_VOL_SHIFT;
      mplayInfo.fadeOI = 0;
    }
  } else {
    mplayInfo.fadeOV = u16(mplayInfo.fadeOV - (4 << FADE_VOL_SHIFT));
    if (((mplayInfo.fadeOV << 16) >> 16) <= 0) {
      for (let i = 0; i < mplayInfo.trackCount; i++) {
        const track = mplayInfo.tracks[i];
        TrackStop(mplayInfo, track);
        if (!(mplayInfo.fadeOV & TEMPORARY_FADE)) track.flags = 0;
      }
      if (mplayInfo.fadeOV & TEMPORARY_FADE) mplayInfo.status = u32(mplayInfo.status | MUSICPLAYER_STATUS_PAUSE);
      else mplayInfo.status = MUSICPLAYER_STATUS_PAUSE;
      mplayInfo.fadeOI = 0;
      return;
    }
  }

  for (let i = 0; i < mplayInfo.trackCount; i++) {
    const track = mplayInfo.tracks[i];
    if (track.flags & MPT_FLG_EXIST) {
      track.volX = u8(mplayInfo.fadeOV >> FADE_VOL_SHIFT);
      track.flags |= MPT_FLG_VOLCHG;
    }
  }
}

/** TrkVolPitSet (m4a.c:765): the track's volume (volMR / volML from vol, volX, pan, panX and a volume / pan LFO) and
 *  pitch (keyM / pitM from tune, bend × bendRange, keyShift, keyShiftX, pitX and a pitch LFO). */
export function TrkVolPitSet(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  if (track.flags & MPT_FLG_VOLSET) {
    let x = (track.vol * track.volX) >>> 5;
    if (track.modT === 1) x = (x * (track.modM + 128)) >>> 7;
    let y = 2 * track.pan + track.panX;
    if (track.modT === 2) y += track.modM;
    if (y < -128) y = -128;
    else if (y > 127) y = 127;
    track.volMR = u8(((y + 128) * x) >>> 8);
    track.volML = u8(((127 - y) * x) >>> 8);
  }

  if (track.flags & MPT_FLG_PITSET) {
    const bend = track.bend * track.bendRange;
    let x = (track.tune + bend) * 4 + (track.keyShift << 8) + (track.keyShiftX << 8) + track.pitX;
    if (track.modT === 0) x += 16 * track.modM;
    track.keyM = s8(x >> 8);
    track.pitM = u8(x);
  }

  track.flags &= ~(MPT_FLG_PITSET | MPT_FLG_VOLSET);
}

// ---------------------------------------------------------------------------------------------------------------
// The track commands. gMPlayJumpTable is indexed by command - 0xB1 (FINE 0xB1 ... EOT 0xCE); m4a_tables.c's
// gMPlayJumpTableTemplate, with MPlayExtender's entries. (Entries 30-35 of the C's table hold engine functions,
// not commands; they are called directly here.)

export type MPlayFunc = (mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack) => void;

/** ply_fine (m4a_1.s:750): releases the track's channels, unlinks them at once, and ends the track. */
export function ply_fine(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  for (let chan = track.chan; chan !== null; chan = chan.nextChannelPointer) {
    if (chan.statusFlags & SOUND_CHANNEL_SF_ON) chan.statusFlags |= SOUND_CHANNEL_SF_STOP;
    RealClearChain(chan);
  }
  track.flags = 0;
}

/** ply_goto (m4a_1.s:831): the 4-byte target (a byte offset into the song's data). */
export function ply_goto(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  const p = track.cmdPtr;
  track.cmdPtr = u32(
    readByte(track, p) | (readByte(track, p + 1) << 8) | (readByte(track, p + 2) << 16) | (readByte(track, p + 3) << 24),
  );
}

/** ply_patt (m4a_1.s:851): call a pattern (3 levels deep; a fourth ends the track as FINE does). */
export function ply_patt(mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  if (track.patternLevel >= 3) {
    ply_fine(mplayInfo, track);
    return;
  }
  track.patternStack[track.patternLevel] = track.cmdPtr + 4;
  track.patternLevel++;
  ply_goto(mplayInfo, track);
}

/** ply_pend (m4a_1.s:869): return from a pattern (ignored outside one). */
export function ply_pend(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  if (track.patternLevel === 0) return;
  track.patternLevel--;
  track.cmdPtr = track.patternStack[track.patternLevel];
}

/** ply_rept (m4a_1.s:884): `REPT count, target`: jump back count - 1 times (count 0: forever). */
export function ply_rept(mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  const p = track.cmdPtr;
  if (readByte(track, p) === 0) {
    track.cmdPtr = p + 1;
    ply_goto(mplayInfo, track);
    return;
  }
  track.repN = u8(track.repN + 1);
  const count = ld_r3_tp_adr_i(track);
  if (track.repN < count) {
    ply_goto(mplayInfo, track);
    return;
  }
  track.repN = 0;
  track.cmdPtr = p + 5;
}

/** ply_prio (m4a_1.s:912): the track's channel priority. */
export function ply_prio(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.priority = ld_r3_tp_adr_i(track);
}

/** ply_tempo (m4a_1.s:920): `TEMPO n` is 2n BPM; tempoI = tempoD × tempoU >> 8 is added to tempoC each frame. */
export function ply_tempo(mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  mplayInfo.tempoD = u16(ld_r3_tp_adr_i(track) << 1);
  mplayInfo.tempoI = u16((mplayInfo.tempoD * mplayInfo.tempoU) >>> 8);
}

/** ply_keysh (m4a_1.s:933) */
export function ply_keysh(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.keyShift = s8(ld_r3_tp_adr_i(track));
  track.flags |= MPT_FLG_PITCHG;
}

/** ply_voice (m4a_1.s:945): copies voice n of the player's voicegroup into the track's tone. Until the
 *  voicegroups are loaded (setVoiceData) the tone stays as it was. */
export function ply_voice(mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  const n = ld_r3_tp_adr_i(track);
  const tone = mplayInfo.tone?.[n];
  if (tone) track.tone = { ...tone };
}

/** ply_vol (m4a_1.s:969) */
export function ply_vol(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.vol = ld_r3_tp_adr_i(track);
  track.flags |= MPT_FLG_VOLCHG;
}

/** ply_pan (m4a_1.s:981) */
export function ply_pan(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.pan = s8(ld_r3_tp_adr_i(track) - C_V);
  track.flags |= MPT_FLG_VOLCHG;
}

/** ply_bend (m4a_1.s:994) */
export function ply_bend(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.bend = s8(ld_r3_tp_adr_i(track) - C_V);
  track.flags |= MPT_FLG_PITCHG;
}

/** ply_bendr (m4a_1.s:1007) */
export function ply_bendr(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.bendRange = ld_r3_tp_adr_i(track);
  track.flags |= MPT_FLG_PITCHG;
}

/** clear_modM (m4a_1.s:1859) / ClearModM (m4a.c) */
export function ClearModM(track: MusicPlayerTrack): void {
  track.lfoSpeedC = 0;
  track.modM = 0;
  track.flags |= track.modT === 0 ? MPT_FLG_PITCHG : MPT_FLG_VOLCHG;
}

/** ply_lfos (m4a_1.s:1887) */
export function ply_lfos(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.lfoSpeed = ld_r3_tp_adr_i(track);
  if (track.lfoSpeed === 0) ClearModM(track);
}

/** ply_lfodl (m4a_1.s:1019) */
export function ply_lfodl(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.lfoDelay = ld_r3_tp_adr_i(track);
}

/** ply_mod (m4a_1.s:1899) */
export function ply_mod(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.mod = ld_r3_tp_adr_i(track);
  if (track.mod === 0) ClearModM(track);
}

/** ply_modt (m4a_1.s:1027): 0 pitch, 1 volume, 2 pan. */
export function ply_modt(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  const modT = ld_r3_tp_adr_i(track);
  if (track.modT !== modT) {
    track.modT = modT;
    track.flags |= MPT_FLG_VOLCHG | MPT_FLG_PITCHG;
  }
}

/** ply_tune (m4a_1.s:1043) */
export function ply_tune(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.tune = s8(ld_r3_tp_adr_i(track) - C_V);
  track.flags |= MPT_FLG_PITCHG;
}

/** ply_port (m4a_1.s:1056): writes a byte to a sound register (REG_SOUND1CNT_L + offset); kept in
 *  gSoundInfo.soundRegs for the PSG (W-m4a 4). */
export function ply_port(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  const reg = ld_r3_tp_adr_i(track);
  gSoundInfo.soundRegs[reg] = ld_r3_tp_adr_i(track);
}

/** ply_endtie (m4a_1.s:1818): EOT [key]: releases the first held channel of that key (the last note's key if
 *  none is given). */
export function ply_endtie(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  const b = readByte(track, track.cmdPtr);
  let key: number;
  if (b < 0x80) {
    track.key = b;
    track.cmdPtr++;
    key = b;
  } else {
    key = track.key;
  }
  for (let chan = track.chan; chan !== null; chan = chan.nextChannelPointer) {
    const flags = chan.statusFlags;
    if (flags & (SOUND_CHANNEL_SF_START | SOUND_CHANNEL_SF_ENV) && !(flags & SOUND_CHANNEL_SF_STOP)) {
      if (chan.midiKey === key) {
        chan.statusFlags = flags | SOUND_CHANNEL_SF_STOP;
        return;
      }
    }
  }
}

/** ply_memacc (m4a.c:1437): `MEMACC op, addr, data[, target]` on gMPlayMemAccArea; ops 6-17 jump (GOTO) when the
 *  comparison holds, else skip the target. (No FRLG song uses it.) */
export function ply_memacc(mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  const op = ld_r3_tp_adr_i(track);
  const area = mplayInfo.memAccArea ?? new Uint8Array(0x100); // the cry players have none (C: address 0)
  const addr = ld_r3_tp_adr_i(track);
  const data = ld_r3_tp_adr_i(track);
  const mem = (i: number): number => area[i] ?? 0;
  const set = (v: number): void => {
    if (addr < area.length) area[addr] = u8(v);
  };

  let cond: boolean;
  switch (op) {
    case 0: set(data); return;
    case 1: set(mem(addr) + data); return;
    case 2: set(mem(addr) - data); return;
    case 3: set(mem(data)); return;
    case 4: set(mem(addr) + mem(data)); return;
    case 5: set(mem(addr) - mem(data)); return;
    case 6: cond = mem(addr) === data; break;
    case 7: cond = mem(addr) !== data; break;
    case 8: cond = mem(addr) > data; break;
    case 9: cond = mem(addr) >= data; break;
    case 10: cond = mem(addr) <= data; break;
    case 11: cond = mem(addr) < data; break;
    case 12: cond = mem(addr) === mem(data); break;
    case 13: cond = mem(addr) !== mem(data); break;
    case 14: cond = mem(addr) > mem(data); break;
    case 15: cond = mem(addr) >= mem(data); break;
    case 16: cond = mem(addr) <= mem(data); break;
    case 17: cond = mem(addr) < mem(data); break;
    default: return;
  }
  if (cond) gMPlayJumpTable[1](mplayInfo, track); // cond_true: ply_goto
  else track.cmdPtr += 4; // cond_false
}

/** ply_xcmd (m4a.c:1523): XCMD n, through gXcmdTable. */
export function ply_xcmd(mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  const n = ld_r3_tp_adr_i(track);
  (gXcmdTable[n] ?? ply_xxx)(mplayInfo, track);
}

/** ply_xxx (m4a.c): an unused XCMD; ends the track as FINE. */
export function ply_xxx(mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  gMPlayJumpTable[0](mplayInfo, track);
}

/** READ_XCMD_BYTE × n: the little-endian value of the next n bytes (cmdPtr not moved). */
function readXcmdValue(track: MusicPlayerTrack, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v |= readByte(track, track.cmdPtr + i) << (i * 8);
  return u32(v);
}

/** ply_xwave (m4a.c): a raw WaveData pointer, meaningless outside the ROM (no FRLG song uses it). */
export function ply_xwave(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.tone.wav = readXcmdValue(track, 4);
  track.cmdPtr += 4;
}

export function ply_xtype(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.tone.type = ld_r3_tp_adr_i(track);
}

export function ply_xatta(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.tone.attack = ld_r3_tp_adr_i(track);
}

export function ply_xdeca(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.tone.decay = ld_r3_tp_adr_i(track);
}

export function ply_xsust(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.tone.sustain = ld_r3_tp_adr_i(track);
}

export function ply_xrele(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.tone.release = ld_r3_tp_adr_i(track);
}

export function ply_xiecv(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.pseudoEchoVolume = ld_r3_tp_adr_i(track);
}

export function ply_xiecl(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.pseudoEchoLength = ld_r3_tp_adr_i(track);
}

export function ply_xleng(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.tone.length = ld_r3_tp_adr_i(track);
}

export function ply_xswee(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.tone.pan_sweep = ld_r3_tp_adr_i(track);
}

/** ply_xwait (m4a.c:1615): `XCMD xWAIT len`: waits len ticks, one per tick, by re-reading itself (timer counts). */
export function ply_xwait(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  const len = readXcmdValue(track, 2);
  if (track.timer < len) {
    track.timer = u16(track.timer + 1);
    track.cmdPtr -= 2;
    track.wait = 1;
  } else {
    track.timer = 0;
    track.cmdPtr += 2;
  }
}

/** ply_xcmd_0D (m4a.c:1639): unk_3C, a DirectSound channel's starting `count` (the cry's progress). */
export function ply_xcmd_0D(_mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.unk_3C = readXcmdValue(track, 4);
  track.cmdPtr += 4;
}

/** gXcmdTable (m4a_tables.c) */
export const gXcmdTable: readonly MPlayFunc[] = [
  ply_xxx, ply_xwave, ply_xtype, ply_xxx, ply_xatta, ply_xdeca, ply_xsust, ply_xrele, ply_xiecv, ply_xiecl,
  ply_xleng, ply_xswee, ply_xwait, ply_xcmd_0D,
];

/** gMPlayJumpTableTemplate (m4a_tables.c), commands 0xB1-0xCE. */
const gMPlayJumpTableTemplate: readonly MPlayFunc[] = [
  ply_fine, // 0xB1 FINE
  ply_goto, // 0xB2 GOTO
  ply_patt, // 0xB3 PATT
  ply_pend, // 0xB4 PEND
  ply_rept, // 0xB5 REPT
  ply_fine, // 0xB6
  ply_fine, // 0xB7
  ply_fine, // 0xB8
  ply_fine, // 0xB9 MEMACC (MPlayExtender)
  ply_prio, // 0xBA PRIO
  ply_tempo, // 0xBB TEMPO
  ply_keysh, // 0xBC KEYSH
  ply_voice, // 0xBD VOICE
  ply_vol, // 0xBE VOL
  ply_pan, // 0xBF PAN
  ply_bend, // 0xC0 BEND
  ply_bendr, // 0xC1 BENDR
  ply_lfos, // 0xC2 LFOS
  ply_lfodl, // 0xC3 LFODL
  ply_mod, // 0xC4 MOD
  ply_modt, // 0xC5 MODT
  ply_fine, // 0xC6
  ply_fine, // 0xC7
  ply_tune, // 0xC8 TUNE
  ply_fine, // 0xC9
  ply_fine, // 0xCA
  ply_fine, // 0xCB
  ply_port, // 0xCC PORT
  ply_fine, // 0xCD XCMD (MPlayExtender)
  ply_fine, // 0xCE EOT (MPlayExtender: ply_endtie)
];

/** gMPlayJumpTable */
export const gMPlayJumpTable: MPlayFunc[] = [...gMPlayJumpTableTemplate];

/** MPlayJumpTableCopy (m4a_1.s:779) */
function MPlayJumpTableCopy(): void {
  gMPlayJumpTable.splice(0, gMPlayJumpTable.length, ...gMPlayJumpTableTemplate);
}

/** A channel's track as ply_note compares it: its place in IWRAM (0 for none). */
const trackAddr = (track: MusicPlayerTrack | null): number => (track ? track.addr : 0);

/**
 * ply_note (m4a_1.s:1538), commands 0xCF (TIE) to 0xFF (N96): the gate time from gClockTable, then up to three
 * argument bytes below 0x80: key, velocity, and extra gate time (mid2agb's -E). Then (`_081DDB46`):
 *
 * - The voice: the track's tone, or for a keysplit voice the subgroup's voice at keySplitTable[key], for a rhythm
 *   voice the subgroup's voice at [key] (played at that voice's own key, with its pan as rhythmPan). A resolved
 *   voice that is itself keysplit / rhythm plays nothing.
 * - The priority: the player's plus the track's (at most 255).
 * - A channel. A CGB voice takes its PSG channel (square 1, square 2, wave, noise) if that is free, released, of
 *   lower priority, or of the same priority on a track at the same or a higher address; else the note is dropped.
 *   A DirectSound voice takes the first free one of the maxChans (5) channels; failing that, the released channel
 *   of lowest priority (the highest track address on a tie) if any is released, else the playing channel of lowest
 *   priority below or equal to the note's (equal only from a track at the same or a higher address); else the
 *   note is dropped. Track addresses: BGM < SE1 < SE2 < SE3 < the cry players (MusicPlayerTrack.addr).
 * - The channel leaves its old track (ClearChain) and goes first in this track's list; it gets the voice, the
 *   track's gate time, key, velocity, echo and volume (TrkVolPitSet, ChnVolSetAsm), its frequency from key + keyM
 *   and pitM, the start offset (unk_3C), and START. SoundMainRAM / CgbSound start it in the same frame's VBlank.
 */
export function ply_note(noteCmd: number, mplayInfo: MusicPlayerInfo, track: MusicPlayerTrack): void {
  track.gateTime = gClockTable[noteCmd];
  let p = track.cmdPtr;
  let b = readByte(track, p);
  if (b < 0x80) {
    track.key = b;
    b = readByte(track, ++p);
    if (b < 0x80) {
      track.velocity = b;
      b = readByte(track, ++p);
      if (b < 0x80) {
        track.gateTime = u8(track.gateTime + b);
        p++;
      }
    }
    track.cmdPtr = p; // _081DDB44
  }

  // _081DDB46: the voice
  const soundInfo = gSoundInfo;
  let rhythmPan = 0;
  let voice: ToneData | null;
  let key: number;
  const toneType = track.tone.type;
  if (toneType & (TONEDATA_TYPE_RHY | TONEDATA_TYPE_SPL)) {
    key = track.key;
    let index = key;
    if (toneType & TONEDATA_TYPE_SPL) {
      // The keysplit tables cover keys 36-107 (24-107); beyond that the ROM's neighbouring bytes, null where they
      // are a pointer's (voicegroups.json). No FRLG song reaches a null one (tests/unit/m4aChannels.test.ts).
      const entry = track.tone.keySplitTable?.[key];
      if (entry === null || entry === undefined) return;
      index = entry;
    }
    const subgroup = track.tone.wav;
    voice = Array.isArray(subgroup) ? (subgroup[index] ?? null) : null;
    if (voice === null || voice.type & (TONEDATA_TYPE_SPL | TONEDATA_TYPE_RHY)) return;
    if (toneType & TONEDATA_TYPE_RHY) {
      if (voice.pan_sweep & 0x80) rhythmPan = s8((voice.pan_sweep - TONEDATA_P_S_PAN) << 1);
      key = voice.key;
    }
  } else {
    voice = track.tone;
    key = track.key;
  }

  // _081DDB9C: the priority
  let priority = mplayInfo.priority + track.priority;
  if (priority > 0xff) priority = 0xff;

  // The channel
  const cgbType = voice.type & TONEDATA_TYPE_CGB;
  let chan: SoundChannel;
  if (cgbType) {
    const cgbChans = soundInfo.cgbChans;
    if (cgbChans === null) return;
    const cgb = cgbChans[cgbType - 1];
    if (cgb.statusFlags & SOUND_CHANNEL_SF_ON && !(cgb.statusFlags & SOUND_CHANNEL_SF_STOP)) {
      if (cgb.priority > priority) return;
      if (cgb.priority === priority && trackAddr(cgb.track) < track.addr) return; // _081DDBE4
    }
    chan = cgb;
  } else {
    // _081DDBEC: r6 / r7 are the best candidate's priority and track, r2 whether a released channel was seen.
    let bestPriority = priority;
    let bestTrack = track.addr;
    let releasedSeen = false;
    let found: SoundChannel | null = null;
    for (let i = 0; i < soundInfo.maxChans; i++) {
      const c = soundInfo.chans[i];
      const flags = c.statusFlags;
      if (!(flags & SOUND_CHANNEL_SF_ON)) {
        found = c; // a free channel: taken at once
        break;
      }
      if (flags & SOUND_CHANNEL_SF_STOP) {
        if (!releasedSeen) {
          // The first released channel is the candidate whatever its priority.
          releasedSeen = true;
          bestPriority = c.priority;
          bestTrack = trackAddr(c.track);
          found = c;
          continue;
        }
      } else if (releasedSeen) {
        continue; // once one is released, playing channels aren't candidates
      }
      // _081DDC18
      if (c.priority < bestPriority) {
        bestPriority = c.priority;
        bestTrack = trackAddr(c.track);
        found = c;
      } else if (c.priority === bestPriority) {
        const a = trackAddr(c.track);
        if (a > bestTrack) {
          bestTrack = a;
          found = c;
        } else if (a === bestTrack) {
          found = c;
        }
      }
    }
    if (found === null) return;
    chan = found;
  }

  // _081DDC40: link the channel to the track
  ClearChain(chan);
  chan.prevChannelPointer = null;
  chan.nextChannelPointer = track.chan;
  if (track.chan !== null) track.chan.prevChannelPointer = chan;
  track.chan = chan;
  chan.track = track;
  track.lfoDelayC = track.lfoDelay;
  if (track.lfoDelay !== 0) ClearModM(track);
  TrkVolPitSet(mplayInfo, track);

  // The track's gateTime, key, velocity (one word copy: runningStatus lands on priority, set next)
  chan.gateTime = track.gateTime;
  chan.midiKey = track.key;
  chan.velocity = track.velocity;
  chan.priority = priority;
  chan.key = key;
  chan.rhythmPan = rhythmPan;
  chan.type = voice.type;
  chan.wav = voice.wav;
  chan.attack = voice.attack;
  chan.decay = voice.decay;
  chan.sustain = voice.sustain;
  chan.release = voice.release;
  chan.pseudoEchoVolume = track.pseudoEchoVolume;
  chan.pseudoEchoLength = track.pseudoEchoLength;
  ChnVolSetAsm(chan, track);

  let pitchKey = chan.key + track.keyM;
  if (pitchKey < 0) pitchKey = 0;
  if (cgbType) {
    const cgb = chan as CgbChannel;
    cgb.length = voice.length; // the CGB voices keep their pan here (music_voice.inc)
    // The sweep: square 1's from the voice (0x00-0x7F with a time in bits 4-6), else 8 (none)
    cgb.sweep = voice.pan_sweep & 0x80 || !(voice.pan_sweep & 0x70) ? 8 : voice.pan_sweep;
    chan.frequency = soundInfo.MidiKeyToCgbFreq(cgbType, pitchKey, track.pitM);
  } else {
    chan.count = track.unk_3C;
    chan.frequency = MidiKeyToFreq(chan.wav, pitchKey, track.pitM);
  }
  chan.statusFlags = SOUND_CHANNEL_SF_START;
  track.flags &= 0xf0;
}

// ---------------------------------------------------------------------------------------------------------------
// The game's API: m4aSongNum*, m4aMPlay* (m4a.c)

/** m4aSongNumStart (m4a.c:107): starts song n on its player (subject to MPlayStart's priority rule). */
export function m4aSongNumStart(n: number): void {
  const song = gSongTable[n];
  if (!song) return;
  MPlayStart(gMPlayTable[song.ms].info, song.header);
}

/** m4aSongNumStartOrChange (m4a.c:117): starts song n unless it is already playing (not paused) on its player. */
export function m4aSongNumStartOrChange(n: number): void {
  const song = gSongTable[n];
  if (!song) return;
  const info = gMPlayTable[song.ms].info;
  if (info.songHeader !== song.header) {
    MPlayStart(info, song.header);
  } else if ((info.status & MUSICPLAYER_STATUS_TRACK) === 0 || info.status & MUSICPLAYER_STATUS_PAUSE) {
    MPlayStart(info, song.header);
  }
}

/** m4aSongNumStartOrContinue (m4a.c:138): starts song n, or resumes it if it is the paused current song. */
export function m4aSongNumStartOrContinue(n: number): void {
  const song = gSongTable[n];
  if (!song) return;
  const info = gMPlayTable[song.ms].info;
  if (info.songHeader !== song.header) MPlayStart(info, song.header);
  else if ((info.status & MUSICPLAYER_STATUS_TRACK) === 0) MPlayStart(info, song.header);
  else if (info.status & MUSICPLAYER_STATUS_PAUSE) MPlayContinue(info);
}

/** m4aSongNumStop (m4a.c:153): pauses song n's player if n is its current song. */
export function m4aSongNumStop(n: number): void {
  const song = gSongTable[n];
  if (!song) return;
  const info = gMPlayTable[song.ms].info;
  if (info.songHeader === song.header) m4aMPlayStop(info);
}

/** m4aSongNumContinue (m4a.c:164): resumes song n's player if n is its current song. */
export function m4aSongNumContinue(n: number): void {
  const song = gSongTable[n];
  if (!song) return;
  const info = gMPlayTable[song.ms].info;
  if (info.songHeader === song.header) MPlayContinue(info);
}

/** m4aMPlayAllStop (m4a.c:175): pauses every music player and the cry players. */
export function m4aMPlayAllStop(): void {
  for (const mplay of gMPlayTable) m4aMPlayStop(mplay.info);
  for (const info of gPokemonCryMusicPlayers) m4aMPlayStop(info);
}

/** m4aMPlayContinue (m4a.c:186) */
export function m4aMPlayContinue(mplayInfo: MusicPlayerInfo): void {
  MPlayContinue(mplayInfo);
}

/** m4aMPlayAllContinue (m4a.c:191) */
export function m4aMPlayAllContinue(): void {
  for (const mplay of gMPlayTable) MPlayContinue(mplay.info);
  for (const info of gPokemonCryMusicPlayers) MPlayContinue(info);
}

/** m4aMPlayFadeOut (m4a.c:202): fade out over 16 × speed frames, then stop (the song is gone). */
export function m4aMPlayFadeOut(mplayInfo: MusicPlayerInfo, speed: number): void {
  MPlayFadeOut(mplayInfo, speed);
}

/** m4aMPlayFadeOutTemporarily (m4a.c:207): fade out, then pause (17 × speed frames: see FadeOutBody). */
export function m4aMPlayFadeOutTemporarily(mplayInfo: MusicPlayerInfo, speed: number): void {
  if (mplayInfo.ident !== ID_NUMBER) return;
  mplayInfo.fadeOC = u16(speed);
  mplayInfo.fadeOI = u16(speed);
  mplayInfo.fadeOV = (64 << FADE_VOL_SHIFT) | TEMPORARY_FADE;
}

/** m4aMPlayFadeIn (m4a.c:219): unpause and fade in from silence over 16 × speed frames. */
export function m4aMPlayFadeIn(mplayInfo: MusicPlayerInfo, speed: number): void {
  if (mplayInfo.ident !== ID_NUMBER) return;
  mplayInfo.fadeOC = u16(speed);
  mplayInfo.fadeOI = u16(speed);
  mplayInfo.fadeOV = (0 << FADE_VOL_SHIFT) | FADE_IN;
  mplayInfo.status = u32(mplayInfo.status & ~MUSICPLAYER_STATUS_PAUSE);
}

/** m4aMPlayImmInit (m4a.c:232): resets the live tracks still waiting for their first tick. */
export function m4aMPlayImmInit(mplayInfo: MusicPlayerInfo): void {
  for (let i = 0; i < mplayInfo.trackCount; i++) {
    const track = mplayInfo.tracks[i];
    if (track.flags & MPT_FLG_EXIST && track.flags & MPT_FLG_START) TrackInit(track);
  }
}

/** m4aMPlayTempoControl (m4a.c:1234): tempo scale, 0x100 = 1×. (Unused in FRLG.) */
export function m4aMPlayTempoControl(mplayInfo: MusicPlayerInfo, tempo: number): void {
  if (mplayInfo.ident !== ID_NUMBER) return;
  mplayInfo.tempoU = u16(tempo);
  mplayInfo.tempoI = u16((mplayInfo.tempoD * mplayInfo.tempoU) >>> 8);
}

/** Calls fn on each live track selected by trackBits (the loop of m4a.c's m4aMPly*Control functions). */
function forTracks(mplayInfo: MusicPlayerInfo, trackBits: number, fn: (track: MusicPlayerTrack) => void): void {
  if (mplayInfo.ident !== ID_NUMBER) return;
  for (let i = 0, bit = 1; i < mplayInfo.trackCount; i++, bit <<= 1) {
    const track = mplayInfo.tracks[i];
    if (trackBits & bit && track.flags & MPT_FLG_EXIST) fn(track);
  }
}

/** m4aMPlayVolumeControl (m4a.c:1245): volX = volume / 4 (256 = full) on the selected tracks. */
export function m4aMPlayVolumeControl(mplayInfo: MusicPlayerInfo, trackBits: number, volume: number): void {
  forTracks(mplayInfo, trackBits, (track) => {
    track.volX = u8(u16(volume) >> 2);
    track.flags |= MPT_FLG_VOLCHG;
  });
}

/** m4aMPlayPitchControl (m4a.c:1279): pitch offset in 1/256 semitones. (Unused in FRLG.) */
export function m4aMPlayPitchControl(mplayInfo: MusicPlayerInfo, trackBits: number, pitch: number): void {
  forTracks(mplayInfo, trackBits, (track) => {
    track.keyShiftX = s8((pitch << 16) >> 24);
    track.pitX = u8(pitch);
    track.flags |= MPT_FLG_PITCHG;
  });
}

/** m4aMPlayPanpotControl (m4a.c:1314): panX on the selected tracks (-128 left .. 127 right). */
export function m4aMPlayPanpotControl(mplayInfo: MusicPlayerInfo, trackBits: number, pan: number): void {
  forTracks(mplayInfo, trackBits, (track) => {
    track.panX = s8(pan);
    track.flags |= MPT_FLG_VOLCHG;
  });
}

/** m4aMPlayModDepthSet (m4a.c:1359) */
export function m4aMPlayModDepthSet(mplayInfo: MusicPlayerInfo, trackBits: number, modDepth: number): void {
  forTracks(mplayInfo, trackBits, (track) => {
    track.mod = u8(modDepth);
    if (!track.mod) ClearModM(track);
  });
}

/** m4aMPlayLFOSpeedSet (m4a.c:1395) */
export function m4aMPlayLFOSpeedSet(mplayInfo: MusicPlayerInfo, trackBits: number, lfoSpeed: number): void {
  forTracks(mplayInfo, trackBits, (track) => {
    track.lfoSpeed = u8(lfoSpeed);
    if (!track.lfoSpeed) ClearModM(track);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// The cries (m4a.c:1660-1781): sound.c's PlayCryInternal sets gPokemonCrySong up through the SetPokemonCry*
// setters, then SetPokemonCryTone copies it to a free cry player's song and starts it.

/** gPokemonCrySong: the next cry's song (gPokemonCrySongTemplate, then the setters). */
export const gPokemonCrySong: PokemonCrySong = pokemonCrySongTemplate();

/** gPokemonCrySongs: each cry player's copy, as the song header MPlayStart gets. */
export const gPokemonCrySongs: (SongHeader | null)[] = Array.from({ length: MAX_POKEMON_CRIES }, () => null);

/**
 * SetPokemonCryTone (m4a.c:1660): starts gPokemonCrySong with `tone` (a gCryTable / gCryTable_Reverse entry) on the
 * first cry player that is free (its first track ended and has no channel still linked), else on the one whose
 * song has run longest (the highest clock; the first on a tie), and returns that player.
 */
export function SetPokemonCryTone(tone: ToneData): MusicPlayerInfo {
  let maxClock = 0;
  let maxClockIndex = 0;
  let i = 0;
  let free = false;
  for (; i < MAX_POKEMON_CRIES; i++) {
    const track = gPokemonCryTracks[i * 2];
    if (!track.flags && (!track.chan || track.chan.track !== track)) {
      free = true;
      break;
    }
    if (maxClock < gPokemonCryMusicPlayers[i].clock) {
      maxClock = gPokemonCryMusicPlayers[i].clock;
      maxClockIndex = i;
    }
  }
  if (!free) i = maxClockIndex;

  // start_song
  const mplayInfo = gPokemonCryMusicPlayers[i];
  const song = gPokemonCrySong;
  const data = song.data.slice();
  // gotoTarget = &gPokemonCrySongs[i].cont: an offset into the copy's bytes here
  data[CRY_SONG_GOTO_TARGET] = CRY_SONG_CONT;
  data[CRY_SONG_GOTO_TARGET + 1] = data[CRY_SONG_GOTO_TARGET + 2] = data[CRY_SONG_GOTO_TARGET + 3] = 0;
  const header: SongHeader = {
    name: `gPokemonCrySongs[${i}]`,
    trackCount: song.trackCount,
    blockCount: song.blockCount,
    priority: song.priority,
    reverb: song.reverb,
    voicegroup: null,
    tone: [tone], // the song's VOICE 0 reads the cry table entry itself
    part: [CRY_SONG_PART0, CRY_SONG_PART1],
    data,
  };
  gPokemonCrySongs[i] = header;
  MPlayStart(mplayInfo, header);
  return mplayInfo;
}

/** SetPokemonCryVolume (m4a.c:1701) */
export function SetPokemonCryVolume(val: number): void {
  gPokemonCrySong.data[CRY_SONG_VOLUME_VALUE] = val & 0x7f;
}

/** SetPokemonCryPanpot (m4a.c:1706): -64 (left) .. 63 (right). */
export function SetPokemonCryPanpot(val: number): void {
  gPokemonCrySong.data[CRY_SONG_PAN_VALUE] = (s8(val) + C_V) & 0x7f;
}

/** SetPokemonCryPitch (m4a.c:1711): the pitch in 1/256 semitones from key 0 (15360 = key 60): the TIE key gets the
 *  semitones, the TUNE value the rest in half steps of TUNE's 1/64 semitone (TrkVolPitSet's tune × 4); the chorus
 *  track keeps its detune. */
export function SetPokemonCryPitch(val: number): void {
  const data = gPokemonCrySong.data;
  const b = s16(val + 0x80);
  const a = u8(data[CRY_SONG_TUNE_VALUE2] - data[CRY_SONG_TUNE_VALUE]);
  data[CRY_SONG_TIE_KEY_VALUE] = (b >> 8) & 0x7f;
  data[CRY_SONG_TUNE_VALUE] = (b >> 1) & 0x7f;
  data[CRY_SONG_TUNE_VALUE2] = (a + ((b >> 1) & 0x7f)) & 0x7f;
}

/** SetPokemonCryLength (m4a.c:1720): the ticks (frames, at the cry's 150 BPM) the TIE is held before EOT / FINE. */
export function SetPokemonCryLength(val: number): void {
  gPokemonCrySong.data[CRY_SONG_LENGTH] = val & 0xff;
  gPokemonCrySong.data[CRY_SONG_LENGTH + 1] = (val >> 8) & 0xff;
}

/** SetPokemonCryRelease (m4a.c:1725) */
export function SetPokemonCryRelease(val: number): void {
  gPokemonCrySong.data[CRY_SONG_RELEASE_VALUE] = u8(val);
}

/** SetPokemonCryProgress (m4a.c:1730): the sample offset the cry starts from (XCMD 0x0D → unk_3C → count). */
export function SetPokemonCryProgress(val: number): void {
  const data = gPokemonCrySong.data;
  for (let k = 0; k < 4; k++) data[CRY_SONG_UNK_CMD_0D_PARAM + k] = (val >>> (8 * k)) & 0xff;
}

/** IsPokemonCryPlaying (m4a.c:1735): the cry's first track still has its channel. FINE unlinks it (so the release
 *  tail doesn't count), and so does the sample running out (MPlayMain's ClearChain, the frame after). */
export function IsPokemonCryPlaying(mplayInfo: MusicPlayerInfo): boolean {
  const track = mplayInfo.tracks[0];
  return !!track && track.chan !== null && track.chan.track === track;
}

/** SetPokemonCryChorus (m4a.c:1745): a second track detuned by val / 64 semitones (0: one track). */
export function SetPokemonCryChorus(val: number): void {
  val = s8(val);
  const data = gPokemonCrySong.data;
  if (val) {
    gPokemonCrySong.trackCount = 2;
    data[CRY_SONG_TUNE_VALUE2] = (val + data[CRY_SONG_TUNE_VALUE]) & 0x7f;
  } else {
    gPokemonCrySong.trackCount = 1;
  }
}

/** SetPokemonCryStereo (m4a.c:1758): the options menu's SOUND setting (OPTIONS_SOUND_MONO 0 / _STEREO 1). Stereo:
 *  FIFO A to the right speaker, B to the left, at full volume, and soundInfo.mode's bit 0 clear; mono: both FIFOs
 *  to both speakers at half volume, and bit 0 set (CgbSound then centres the PSG channels, W-m4a 4). The mixer
 *  writes both FIFOs the same either way: the routing (gRegSoundCntH) is what the output's DAC applies. */
export function SetPokemonCryStereo(val: number): void {
  const soundInfo = gSoundInfo;
  if (val) {
    gRegSoundCntH = SOUNDCNT_H_STEREO;
    soundInfo.mode &= ~1;
  } else {
    gRegSoundCntH = SOUNDCNT_H_MONO;
    soundInfo.mode |= 1;
  }
}

/** SetPokemonCryPriority (m4a.c:1778) */
export function SetPokemonCryPriority(val: number): void {
  gPokemonCrySong.priority = u8(val);
}
