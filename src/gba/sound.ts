// sound.c: the layer the game calls for music and sound effects, on top of the m4a engine (audio/m4a.ts). The map
// music state machine (MapMusicMain), fanfares (sFanfares, Task_Fanfare, WaitFanfare), PlaySE / PlayBGM and the
// player checks (IsSEPlaying, IsBGMStopped, ...). MapMusicMain, the sound tasks and m4aSoundMain run once per frame
// from audio/frame.ts's AgbMainFrameEnd. The engine's logic always runs, so every wait here times like the GBA
// whether or not anything is heard (AUDIO_PLAN.md decision 2).
//
// The cries (PlayCry_*, IsCryFinished, Task_DuckBGMForPokemonCry) are at the bottom. overworld.c's map music
// (which song a map plays, savedMusic, the warps' fade-out) is gba/overworldMusic.ts.

import {
  gCryTable,
  gCryTable_Reverse,
  gMPlayInfo_BGM,
  gMPlayInfo_SE1,
  gMPlayInfo_SE2,
  gMPlayInfo_SE3,
  gMPlayTable,
  gPokemonCryMusicPlayers,
  gPokemonCrySongs,
  gSongTable,
  IsPokemonCryPlaying,
  m4aMPlayAllStop as m4aMPlayAllStopEngine,
  m4aMPlayContinue,
  m4aMPlayFadeIn,
  m4aMPlayFadeOut,
  m4aMPlayFadeOutTemporarily,
  m4aMPlayImmInit,
  m4aMPlayPanpotControl,
  m4aMPlayStop,
  m4aMPlayVolumeControl,
  m4aSongNumStart as m4aSongNumStartEngine,
  m4aSongNumStop,
  SetPokemonCryChorus,
  SetPokemonCryLength,
  SetPokemonCryPanpot,
  SetPokemonCryPitch,
  SetPokemonCryPriority,
  SetPokemonCryProgress,
  SetPokemonCryRelease,
  SetPokemonCryTone,
  SetPokemonCryVolume,
} from '../audio/m4a';
import { MUSICPLAYER_STATUS_PAUSE, MUSICPLAYER_STATUS_TRACK, TRACKS_ALL, type MusicPlayerInfo } from '../audio/m4aInternal';
import { SpeciesToCryId } from '../pokemon/Pokemon';
import { QL_InPlaybackState, QL_IS_PLAYBACK_STATE } from '../world/questLogState';

/** MUS_DUMMY (constants/songs.h): song 0, no tracks, on the BGM player. */
const MUS_DUMMY = 0;
/** MUS_NONE (constants/songs.h): "no music", played as MUS_DUMMY. */
const MUS_NONE = 0xffff;

// ---------------------------------------------------------------------------------------------------------------
// What the dev test hooks see (dev/testHooks.ts: __test.audioEvents). Nothing in the game reads it.

export type SoundEventType = 'se' | 'bgm' | 'fanfare' | 'cry' | 'stop' | 'continue' | 'fade';

/** One m4aSongNumStart-level call (a start, a pause, a resume or a fade), for the tests. */
export interface SoundEvent {
  type: SoundEventType;
  /** The song started, or the song on the player for stop / continue / fade (-1: none). A cry: the species. */
  id: number;
  /** The song's name; a cry: its sample (Cry_Charizard). */
  name: string;
  /** The music player: BGM, SE1, SE2, SE3, or a cry player, CRY0 / CRY1. */
  player: string;
  /** A cry: its CRY_MODE_*. */
  mode?: number;
  pan?: number;
  /** A start: whether MPlayStart took the song (an SE player keeps a song of higher priority). */
  started?: boolean;
  /** A fade: 'out', 'outTemporarily' or 'in', and its speed (frames per step). */
  fade?: 'out' | 'outTemporarily' | 'in';
  speed?: number;
}

let soundEventListener: ((e: SoundEvent) => void) | undefined;

/** Dev only: the test hooks listen to every start, pause, resume and fade. */
export function setSoundEventListener(fn: ((e: SoundEvent) => void) | undefined): void {
  soundEventListener = fn;
}

/** The short player name of a music player (BGM, SE1, ..., CRY0 / CRY1 for gPokemonCryMusicPlayers). */
export function musicPlayerName(info: MusicPlayerInfo): string {
  const cry = gPokemonCryMusicPlayers.indexOf(info);
  if (cry >= 0) return `CRY${cry}`;
  return info.name.replace(/^gMPlayInfo_/, '');
}

/** A song's name as songs.h has it (SE_SELECT, MUS_PALLET). */
export function songName(id: number): string {
  return gSongTable[id]?.header.name.toUpperCase() ?? `song ${id}`;
}

function playerEvent(type: SoundEventType, info: MusicPlayerInfo, extra: Partial<SoundEvent> = {}): void {
  if (!soundEventListener) return;
  const song = info.songHeader ? gSongTable.findIndex((s) => s.header === info.songHeader) : -1; // -1 for a cry
  soundEventListener({ type, id: song, name: song < 0 ? '' : songName(song), player: musicPlayerName(info), ...extra });
}

/** m4aSongNumStart, reported to the test hooks as `type`. */
function startSong(songNum: number, type: SoundEventType, pan?: number): void {
  m4aSongNumStartEngine(songNum);
  if (!soundEventListener) return;
  const song = gSongTable[songNum];
  const info = song ? gMPlayTable[song.ms].info : undefined;
  soundEventListener({
    type,
    id: songNum,
    name: songName(songNum),
    player: info ? musicPlayerName(info) : '',
    ...(pan !== undefined ? { pan } : {}),
    started: !!info && info.songHeader === song!.header && info.status === 0,
  });
}

/** m4aSongNumStart (m4a.c), for callers that start a song directly (the title screen's MUS_TITLE). */
export function m4aSongNumStart(songNum: number): void {
  const song = gSongTable[songNum];
  startSong(songNum, song && song.ms === 0 ? 'bgm' : 'se');
}

/** m4aMPlayStop on a player, reported as 'stop'. */
function stopPlayer(info: MusicPlayerInfo): void {
  m4aMPlayStop(info);
  playerEvent('stop', info);
}

/** m4aMPlayAllStop (m4a.c:175): pauses every music player and the cry players (the evolution scene); each player
 *  with a live track is reported as a 'stop'. */
export function m4aMPlayAllStop(): void {
  m4aMPlayAllStopEngine();
  for (const info of [...gMPlayTable.map((m) => m.info), ...gPokemonCryMusicPlayers]) if (info.status & MUSICPLAYER_STATUS_TRACK) playerEvent('stop', info);
}

/** m4aMPlayContinue on a player, reported as 'continue'. */
function continuePlayer(info: MusicPlayerInfo): void {
  m4aMPlayContinue(info);
  playerEvent('continue', info);
}

// ---------------------------------------------------------------------------------------------------------------
// sound.c's state

/** struct Fanfare: the song and how many frames the fanfare holds (a frame counter, not the song's length). */
interface Fanfare {
  song: string;
  duration: number;
}

/** sFanfares, indexed by FANFARE_* (constants/sound.h). The songs by name, resolved through the song table. */
const sFanfares: readonly Fanfare[] = [
  /* FANFARE_LEVEL_UP */ { song: 'MUS_LEVEL_UP', duration: 80 },
  /* FANFARE_OBTAIN_ITEM */ { song: 'MUS_OBTAIN_ITEM', duration: 160 },
  /* FANFARE_EVOLVED */ { song: 'MUS_EVOLVED', duration: 220 },
  /* FANFARE_OBTAIN_TMHM */ { song: 'MUS_OBTAIN_TMHM', duration: 220 },
  /* FANFARE_HEAL */ { song: 'MUS_HEAL', duration: 160 },
  /* FANFARE_OBTAIN_BADGE */ { song: 'MUS_OBTAIN_BADGE', duration: 340 },
  /* FANFARE_MOVE_DELETED */ { song: 'MUS_MOVE_DELETED', duration: 180 },
  /* FANFARE_OBTAIN_BERRY */ { song: 'MUS_OBTAIN_BERRY', duration: 120 },
  /* FANFARE_SLOTS_JACKPOT */ { song: 'MUS_SLOTS_JACKPOT', duration: 250 },
  /* FANFARE_SLOTS_WIN */ { song: 'MUS_SLOTS_WIN', duration: 150 },
  /* FANFARE_TOO_BAD */ { song: 'MUS_TOO_BAD', duration: 160 },
  /* FANFARE_POKE_FLUTE */ { song: 'MUS_POKE_FLUTE', duration: 450 },
  /* FANFARE_KEY_ITEM */ { song: 'MUS_OBTAIN_KEY_ITEM', duration: 170 },
  /* FANFARE_DEX_EVAL */ { song: 'MUS_DEX_RATING', duration: 196 },
];

let fanfareSongsFor: unknown;
let fanfareSongs: number[] = [];

/** sFanfares[i].songNum: the song id, or -1 before the song table is loaded. */
function fanfareSongNum(i: number): number {
  if (fanfareSongsFor !== gSongTable) {
    fanfareSongsFor = gSongTable;
    fanfareSongs = sFanfares.map((f) => gSongTable.findIndex((s) => s.header.name.toUpperCase() === f.song));
  }
  return fanfareSongs[i];
}

let sCurrentMapMusic = 0;
let sNextMapMusic = 0;
let sMapMusicState = 0;
let sMapMusicFadeInSpeed = 0;
let sFanfareCounter = 0;

/** gDisableMusic: nothing in FRLG sets it. */
let gDisableMusic = false;

/** MUSIC_DISABLE_* (overworld.h): gDisableMapMusicChangeOnMapLoad's values. */
export const MUSIC_DISABLE_OFF = 0;
export const MUSIC_DISABLE_STOP = 1;
export const MUSIC_DISABLE_KEEP = 2;

/**
 * gDisableMapMusicChangeOnMapLoad (overworld.c's EWRAM): KEEP from the Hall of Fame's warp to the end of the
 * credits (the map loads keep the music, PlaySE is skipped), STOP for the quest log's playback (Task_BeginQuestLogPlayback to Task_EndQuestLog). Here rather than
 * in overworldMusic.ts so PlaySE can read it without an import cycle; set it with SetDisableMapMusicChangeOnMapLoad.
 */
export let gDisableMapMusicChangeOnMapLoad = MUSIC_DISABLE_OFF;

export function SetDisableMapMusicChangeOnMapLoad(value: number): void {
  gDisableMapMusicChangeOnMapLoad = value;
}

/** gDisableHelpSystemVolumeReduce (help_system_util.c's EWRAM): the help system halves the BGM unless it's set. */
let gDisableHelpSystemVolumeReduce = false;

// ---------------------------------------------------------------------------------------------------------------
// The sound tasks (AUDIO_PLAN.md decision 5). Task_Fanfare and Task_DuckBGMForPokemonCry are gTasks of
// priority 80 in the C. The field doesn't run gTasks every frame, so they run from AgbMainFrameEnd instead, after
// the frame's callbacks, where RunTasks would have run them. FuncIsActiveTask's meaning is kept: a task is active
// from its CreateTask until its DestroyTask. Unlike a gTask, ResetTasks doesn't remove them (docs/DEVIATIONS.md).

type SoundTaskFunc = () => void;
let sSoundTasks: SoundTaskFunc[] = [];

/** CreateTask(func, 80) for a sound task. */
function CreateSoundTask(func: SoundTaskFunc): void {
  sSoundTasks.push(func);
}

/** FuncIsActiveTask for a sound task. */
function FuncIsActiveSoundTask(func: SoundTaskFunc): boolean {
  return sSoundTasks.includes(func);
}

function DestroySoundTask(func: SoundTaskFunc): void {
  sSoundTasks = sSoundTasks.filter((f) => f !== func);
}

/** RunTasks for the sound tasks, once per frame (AgbMainFrameEnd). A task created in the frame runs in it. */
export function RunSoundTasks(): void {
  for (const func of [...sSoundTasks]) if (sSoundTasks.includes(func)) func();
}

/** sound.c's statics as a fresh boot leaves them (SoftReset clears RAM): no sound tasks, no fanfare counting. */
export function ResetSoundState(): void {
  sSoundTasks = [];
  sFanfareCounter = 0;
  gMPlay_PokemonCry = null;
  gPokemonCryBGMDuckingCounter = 0;
  gDisableHelpSystemVolumeReduce = false;
  gDisableMapMusicChangeOnMapLoad = MUSIC_DISABLE_OFF; // EWRAM, cleared by SoftReset(RESET_ALL)
  InitMapMusic();
}

// ---------------------------------------------------------------------------------------------------------------
// Map music

/** InitMapMusic (sound.c), from AgbMain. */
export function InitMapMusic(): void {
  gDisableMusic = false;
  ResetMapMusic();
}

/** MapMusicMain (sound.c), once per frame at the end of AgbMain's loop (main.c:215; here AgbMainFrameEnd). */
export function MapMusicMain(): void {
  switch (sMapMusicState) {
    case 0:
      break;
    case 1:
      sMapMusicState = 2;
      PlayBGM(sCurrentMapMusic);
      break;
    case 2:
    case 3:
    case 4:
      break;
    case 5:
      if (IsBGMStopped()) {
        sNextMapMusic = 0;
        sMapMusicState = 0;
      }
      break;
    case 6:
      if (IsBGMStopped() && IsFanfareTaskInactive()) {
        sCurrentMapMusic = sNextMapMusic;
        sNextMapMusic = 0;
        sMapMusicState = 2;
        PlayBGM(sCurrentMapMusic);
      }
      break;
    case 7:
      if (IsBGMStopped() && IsFanfareTaskInactive()) {
        FadeInNewBGM(sNextMapMusic, sMapMusicFadeInSpeed);
        sCurrentMapMusic = sNextMapMusic;
        sNextMapMusic = 0;
        sMapMusicState = 2;
        sMapMusicFadeInSpeed = 0;
      }
      break;
  }
}

export function ResetMapMusic(): void {
  sCurrentMapMusic = 0;
  sNextMapMusic = 0;
  sMapMusicState = 0;
  sMapMusicFadeInSpeed = 0;
}

export function GetCurrentMapMusic(): number {
  return sCurrentMapMusic;
}

/** PlayNewMapMusic: the song starts in the frame's MapMusicMain. */
export function PlayNewMapMusic(songNum: number): void {
  sCurrentMapMusic = songNum & 0xffff;
  sNextMapMusic = 0;
  sMapMusicState = 1;
}

export function StopMapMusic(): void {
  sCurrentMapMusic = 0;
  sNextMapMusic = 0;
  sMapMusicState = 1;
}

/** FadeOutMapMusic: fade the BGM out over 16 × speed frames; IsNotWaitingForBGMStop is FALSE until it has stopped. */
export function FadeOutMapMusic(speed: number): void {
  if (IsNotWaitingForBGMStop()) FadeOutBGM(speed);
  sCurrentMapMusic = 0;
  sNextMapMusic = 0;
  sMapMusicState = 5;
}

/** FadeOutAndPlayNewMapMusic: fade out, then (once the BGM has stopped and no fanfare is counting) play songNum. */
export function FadeOutAndPlayNewMapMusic(songNum: number, speed: number): void {
  FadeOutMapMusic(speed);
  sCurrentMapMusic = 0;
  sNextMapMusic = songNum & 0xffff;
  sMapMusicState = 6;
}

/** FadeOutAndFadeInNewMapMusic: fade out, then fade songNum in. */
export function FadeOutAndFadeInNewMapMusic(songNum: number, fadeOutSpeed: number, fadeInSpeed: number): void {
  FadeOutMapMusic(fadeOutSpeed);
  sCurrentMapMusic = 0;
  sNextMapMusic = songNum & 0xffff;
  sMapMusicState = 7;
  sMapMusicFadeInSpeed = fadeInSpeed & 0xff;
}

/** IsNotWaitingForBGMStop: FALSE while MapMusicMain waits for a fade-out (states 5-7). */
export function IsNotWaitingForBGMStop(): boolean {
  if (sMapMusicState === 6) return false;
  if (sMapMusicState === 5) return false;
  if (sMapMusicState === 7) return false;
  return true;
}

// overworld.c's two one-line wrappers over the above. The rest of overworld.c's map music is gba/overworldMusic.ts.

/** BGMusicStopped (overworld.c): the warp tasks wait on it. */
export function BGMusicStopped(): boolean {
  return IsNotWaitingForBGMStop();
}

/** Overworld_ChangeMusicTo (overworld.c): `fadenewbgm`. */
export function Overworld_ChangeMusicTo(newMusic: number): void {
  const currentMusic = GetCurrentMapMusic();
  if (currentMusic !== newMusic) FadeOutAndPlayNewMapMusic(newMusic, 8);
}

// ---------------------------------------------------------------------------------------------------------------
// Fanfares: they play on the SE2 player, with the BGM paused for sFanfares' duration.

/** PlayFanfareByFanfareNum: pause the BGM, start the fanfare and set sFanfareCounter (counted by Task_Fanfare or
 *  WaitFanfare). In the quest log's playback (gQuestLogState == QL_STATE_PLAYBACK) no song plays and the BGM isn't
 *  paused: sFanfareCounter = 0xFF, so the wait is 255 frames whatever the fanfare. */
export function PlayFanfareByFanfareNum(fanfareNum: number): void {
  if (QL_InPlaybackState()) {
    sFanfareCounter = 0xff;
    return;
  }
  stopPlayer(gMPlayInfo_BGM);
  const songNum = fanfareSongNum(fanfareNum);
  sFanfareCounter = sFanfares[fanfareNum].duration;
  if (songNum >= 0) startSong(songNum, 'fanfare');
}

/** WaitFanfare: counts sFanfareCounter down, one per call; once it's 0, resumes the BGM (with `stop`: starts
 *  MUS_DUMMY on the BGM player instead) and returns TRUE. For callers that don't use the fanfare task. */
export function WaitFanfare(stop: boolean): boolean {
  if (sFanfareCounter) {
    sFanfareCounter--;
    return false;
  }
  if (!stop) continuePlayer(gMPlayInfo_BGM);
  else startSong(MUS_DUMMY, 'bgm');
  return true;
}

/** StopFanfareByFanfareNum (unused in FRLG) */
export function StopFanfareByFanfareNum(fanfareNum: number): void {
  const songNum = fanfareSongNum(fanfareNum);
  if (songNum >= 0) m4aSongNumStop(songNum);
}

/** PlayFanfare: the sFanfares entry for songNum (the first one, MUS_LEVEL_UP, if it has none), and Task_Fanfare to
 *  count it and resume the BGM. */
export function PlayFanfare(songNum: number): void {
  for (let i = 0; i < sFanfares.length; i++) {
    if (fanfareSongNum(i) === songNum) {
      PlayFanfareByFanfareNum(i);
      CreateFanfareTask();
      return;
    }
  }
  // songNum is not in sFanfares: play the first fanfare in the table instead
  PlayFanfareByFanfareNum(0);
  CreateFanfareTask();
}

/** IsFanfareTaskInactive: `waitfanfare` and the screens wait on it. */
export function IsFanfareTaskInactive(): boolean {
  return !FuncIsActiveSoundTask(Task_Fanfare);
}

/** Task_Fanfare: once sFanfareCounter has run out, resume the BGM. The fanfare song itself plays on to its FINE. */
function Task_Fanfare(): void {
  if (sFanfareCounter) {
    sFanfareCounter--;
  } else {
    continuePlayer(gMPlayInfo_BGM);
    DestroySoundTask(Task_Fanfare);
  }
}

function CreateFanfareTask(): void {
  if (!FuncIsActiveSoundTask(Task_Fanfare)) CreateSoundTask(Task_Fanfare);
}

// ---------------------------------------------------------------------------------------------------------------
// BGM

/** FadeInNewBGM: start songNum silent and paused, then fade it in over 16 × speed frames. */
export function FadeInNewBGM(songNum: number, speed: number): void {
  if (gDisableMusic) songNum = 0;
  if (songNum === MUS_NONE) songNum = 0;
  startSong(songNum, 'bgm');
  m4aMPlayImmInit(gMPlayInfo_BGM);
  m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 0);
  m4aSongNumStop(songNum);
  m4aMPlayFadeIn(gMPlayInfo_BGM, speed);
  playerEvent('fade', gMPlayInfo_BGM, { fade: 'in', speed });
}

/** FadeOutBGMTemporarily: fade out and pause (FadeInBGM resumes it). */
export function FadeOutBGMTemporarily(speed: number): void {
  m4aMPlayFadeOutTemporarily(gMPlayInfo_BGM, speed);
  playerEvent('fade', gMPlayInfo_BGM, { fade: 'outTemporarily', speed });
}

export function IsBGMPausedOrStopped(): boolean {
  if (gMPlayInfo_BGM.status & MUSICPLAYER_STATUS_PAUSE) return true;
  if (!(gMPlayInfo_BGM.status & MUSICPLAYER_STATUS_TRACK)) return true;
  return false;
}

export function FadeInBGM(speed: number): void {
  m4aMPlayFadeIn(gMPlayInfo_BGM, speed);
  playerEvent('fade', gMPlayInfo_BGM, { fade: 'in', speed });
}

/** FadeOutBGM: fade out over 16 × speed frames, then stop. */
export function FadeOutBGM(speed: number): void {
  m4aMPlayFadeOut(gMPlayInfo_BGM, speed);
  playerEvent('fade', gMPlayInfo_BGM, { fade: 'out', speed });
}

export function IsBGMStopped(): boolean {
  return !(gMPlayInfo_BGM.status & MUSICPLAYER_STATUS_TRACK);
}

/** PlayBGM: MUS_NONE plays MUS_DUMMY (silence). */
export function PlayBGM(songNum: number): void {
  if (gDisableMusic) songNum = 0;
  if (songNum === MUS_NONE) songNum = 0;
  startSong(songNum, 'bgm');
}

// ---------------------------------------------------------------------------------------------------------------
// Sound effects

/** PlaySE: skipped while gDisableMapMusicChangeOnMapLoad is set (from the Hall of Fame's warp through the credits,
 *  and the quest log's playback) and while gQuestLogState is QL_STATE_PLAYBACK. */
export function PlaySE(songNum: number): void {
  if (gDisableMapMusicChangeOnMapLoad !== MUSIC_DISABLE_OFF || QL_InPlaybackState()) return;
  startSong(songNum, 'se');
}

/** PlaySE12WithPanning: the battle anims' sounds, panned (SOUND_PAN_ATTACKER .. SOUND_PAN_TARGET). */
export function PlaySE12WithPanning(songNum: number, pan: number): void {
  startSong(songNum, 'se', pan);
  m4aMPlayImmInit(gMPlayInfo_SE1);
  m4aMPlayImmInit(gMPlayInfo_SE2);
  m4aMPlayPanpotControl(gMPlayInfo_SE1, TRACKS_ALL, pan);
  m4aMPlayPanpotControl(gMPlayInfo_SE2, TRACKS_ALL, pan);
}

export function PlaySE1WithPanning(songNum: number, pan: number): void {
  startSong(songNum, 'se', pan);
  m4aMPlayImmInit(gMPlayInfo_SE1);
  m4aMPlayPanpotControl(gMPlayInfo_SE1, TRACKS_ALL, pan);
}

export function PlaySE2WithPanning(songNum: number, pan: number): void {
  startSong(songNum, 'se', pan);
  m4aMPlayImmInit(gMPlayInfo_SE2);
  m4aMPlayPanpotControl(gMPlayInfo_SE2, TRACKS_ALL, pan);
}

export function SE12PanpotControl(pan: number): void {
  m4aMPlayPanpotControl(gMPlayInfo_SE1, TRACKS_ALL, pan);
  m4aMPlayPanpotControl(gMPlayInfo_SE2, TRACKS_ALL, pan);
}

/** IsSEPlaying: SE1 or SE2 has a live track (so TRUE during a fanfare too, which plays on SE2). FALSE in the frame
 *  an SE is started, until the engine's first tick of it (m4aSoundMain at the end of the frame), as on the GBA. */
export function IsSEPlaying(): boolean {
  if (gMPlayInfo_SE1.status & MUSICPLAYER_STATUS_PAUSE && gMPlayInfo_SE2.status & MUSICPLAYER_STATUS_PAUSE) return false;
  if (!(gMPlayInfo_SE1.status & MUSICPLAYER_STATUS_TRACK) && !(gMPlayInfo_SE2.status & MUSICPLAYER_STATUS_TRACK)) return false;
  return true;
}

export function IsBGMPlaying(): boolean {
  if (gMPlayInfo_BGM.status & MUSICPLAYER_STATUS_PAUSE) return false;
  if (!(gMPlayInfo_BGM.status & MUSICPLAYER_STATUS_TRACK)) return false;
  return true;
}

/** IsSpecialSEPlaying: the SE3 player (rain, downpour, thunderstorm, the low HP beep). */
export function IsSpecialSEPlaying(): boolean {
  if (gMPlayInfo_SE3.status & MUSICPLAYER_STATUS_PAUSE) return false;
  if (!(gMPlayInfo_SE3.status & MUSICPLAYER_STATUS_TRACK)) return false;
  return true;
}

export function SetBGMVolume_SuppressHelpSystemReduction(volume: number): void {
  gDisableHelpSystemVolumeReduce = true;
  m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, volume);
}

export function BGMVolumeMax_EnableHelpSystemReduction(): void {
  gDisableHelpSystemVolumeReduce = false;
  m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 256);
}

// The help system's sound (help_system_util.c's RunHelpSystemCallback; ui/helpSystem.ts).

/** gDisableHelpSystemVolumeReduce */
export function IsHelpSystemVolumeReduceDisabled(): boolean {
  return gDisableHelpSystemVolumeReduce;
}

/** RunHelpSystemCallback's m4aMPlayStop(&gMPlayInfo_SE1) and m4aMPlayStop(&gMPlayInfo_SE2) as it opens. */
export function HelpSystem_StopSE1AndSE2(): void {
  stopPlayer(gMPlayInfo_SE1);
  stopPlayer(gMPlayInfo_SE2);
}

/** RunHelpSystemCallback's m4aMPlayVolumeControl(&gMPlayInfo_BGM, TRACKS_ALL, volume): 0x80 open, 0x100 closed. */
export function HelpSystem_BGMVolumeControl(volume: number): void {
  m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, volume);
}

// ---------------------------------------------------------------------------------------------------------------
// The test hooks' view of sound.c (dev/testHooks.ts: __test.audio()).

export function soundProbe() {
  return {
    mapMusic: { current: sCurrentMapMusic, next: sNextMapMusic, state: sMapMusicState, fadeInSpeed: sMapMusicFadeInSpeed },
    fanfareCounter: sFanfareCounter,
    fanfareTaskActive: !IsFanfareTaskInactive(),
    helpSystemVolumeReduceDisabled: gDisableHelpSystemVolumeReduce,
    cry: cryProbe(),
    disableMapMusicChangeOnMapLoad: gDisableMapMusicChangeOnMapLoad,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Cries (sound.c:316-580): PlayCryInternal sets the cry song up through the engine's SetPokemonCry* setters and
// starts it on a cry player (SetPokemonCryTone); PlayCry_Normal / _ByMode / _Script duck the BGM to 85 / 256 while
// it plays, and Task_DuckBGMForPokemonCry (a sound task, like Task_Fanfare) restores it once the cry's channel is
// gone. IsCryFinished is "that task is gone"; IsCryPlaying reads the cry player itself (IsPokemonCryPlaying).

// constants/sound.h (fixed numbers, like MUS_DUMMY above: the title screen cries before the defines are loaded;
// tests/unit/soundCries.test.ts checks them against the extracted ones)
const CRY_MODE_NORMAL = 0;
const CRY_MODE_DOUBLES = 1;
const CRY_MODE_ENCOUNTER = 2;
const CRY_MODE_HIGH_PITCH = 3;
const CRY_MODE_ECHO_START = 4;
const CRY_MODE_FAINT = 5;
const CRY_MODE_ECHO_END = 6;
const CRY_MODE_ROAR_1 = 7;
const CRY_MODE_ROAR_2 = 8;
const CRY_MODE_GROWL_1 = 9;
const CRY_MODE_GROWL_2 = 10;
const CRY_MODE_WEAK = 11;
const CRY_MODE_WEAK_DOUBLES = 12;
const CRY_PRIORITY_NORMAL = 10;
const CRY_VOLUME = 120;
export const SOUND_CONSTANTS = {
  CRY_MODE_NORMAL, CRY_MODE_DOUBLES, CRY_MODE_ENCOUNTER, CRY_MODE_HIGH_PITCH, CRY_MODE_ECHO_START, CRY_MODE_FAINT,
  CRY_MODE_ECHO_END, CRY_MODE_ROAR_1, CRY_MODE_ROAR_2, CRY_MODE_GROWL_1, CRY_MODE_GROWL_2, CRY_MODE_WEAK,
  CRY_MODE_WEAK_DOUBLES, CRY_PRIORITY_NORMAL, CRY_VOLUME,
} as const;

/** gMPlay_PokemonCry: the cry player of the last cry (SetPokemonCryTone's), NULL before the first. */
let gMPlay_PokemonCry: MusicPlayerInfo | null = null;
/** gPokemonCryBGMDuckingCounter: Task_DuckBGMForPokemonCry's first frames, before it polls the cry. */
let gPokemonCryBGMDuckingCounter = 0;

/** PlayCry_Normal: the cry at CRY_VOLUME with the BGM ducked to 85 until it ends. */
export function PlayCry_Normal(species: number, pan: number): void {
  m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 85);
  PlayCryInternal(species, pan, CRY_VOLUME, CRY_PRIORITY_NORMAL, CRY_MODE_NORMAL);
  gPokemonCryBGMDuckingCounter = 2;
  RestoreBGMVolumeAfterPokemonCry();
}

/** PlayCry_NormalNoDucking: the Pokédex and the credits: no ducking, so no ducking task (IsCryFinished is TRUE). */
export function PlayCry_NormalNoDucking(species: number, pan: number, volume: number, priority: number): void {
  PlayCryInternal(species, pan, volume, priority, CRY_MODE_NORMAL);
}

/** PlayCry_ByMode: PlayCry_Normal with a mode; CRY_MODE_DOUBLES doesn't duck the BGM. */
export function PlayCry_ByMode(species: number, pan: number, mode: number): void {
  if (mode === CRY_MODE_DOUBLES) {
    PlayCryInternal(species, pan, CRY_VOLUME, CRY_PRIORITY_NORMAL, mode);
  } else {
    m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 85);
    PlayCryInternal(species, pan, CRY_VOLUME, CRY_PRIORITY_NORMAL, mode);
    gPokemonCryBGMDuckingCounter = 2;
    RestoreBGMVolumeAfterPokemonCry();
  }
}

/** PlayCry_ReleaseDouble: releasing two mons at once in battle. It ducks the BGM without the task that restores it
 *  (the C's own quirk). The C skips the ducking in multi battles (gBattleTypeFlags & BATTLE_TYPE_MULTI), which are
 *  link only and never set in the port. */
export function PlayCry_ReleaseDouble(species: number, pan: number, mode: number): void {
  if (mode === CRY_MODE_DOUBLES) {
    PlayCryInternal(species, pan, CRY_VOLUME, CRY_PRIORITY_NORMAL, mode);
  } else {
    m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 85);
    PlayCryInternal(species, pan, CRY_VOLUME, CRY_PRIORITY_NORMAL, mode);
  }
}

/** PlayCry_Script: `playmoncry` and `showmonpic`. Centred, ducked; in the quest log's playback
 *  (QL_IS_PLAYBACK_STATE, FRLG only) no cry plays, but the ducking task still starts. */
export function PlayCry_Script(species: number, mode: number): void {
  if (!QL_IS_PLAYBACK_STATE()) {
    m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 85);
    PlayCryInternal(species, 0, CRY_VOLUME, CRY_PRIORITY_NORMAL, mode);
  }
  gPokemonCryBGMDuckingCounter = 2;
  RestoreBGMVolumeAfterPokemonCry();
}

/**
 * PlayCryInternal: the mode's length (ticks, one a frame), reverse, release, pitch (1/256 semitones: 15360 = key
 * 60), chorus and volume into gPokemonCrySong, then SetPokemonCryTone(gCryTable[SpeciesToCryId(species - 1)]).
 */
export function PlayCryInternal(species: number, pan: number, volume: number, priority: number, mode: number): void {
  species = (species - 1) & 0xffff;

  // Default values, overridden by the mode.
  let length = 140;
  let reverse = false;
  let release = 0;
  let pitch = 15360;
  let chorus = 0;

  switch (mode) {
    case CRY_MODE_NORMAL:
      break;
    case CRY_MODE_DOUBLES:
      length = 20;
      release = 225;
      break;
    case CRY_MODE_ENCOUNTER:
      release = 225;
      pitch = 15600;
      chorus = 20;
      volume = 90;
      break;
    case CRY_MODE_HIGH_PITCH:
      length = 50;
      release = 200;
      pitch = 15800;
      chorus = 20;
      volume = 90;
      break;
    case CRY_MODE_ECHO_START:
      length = 25;
      reverse = true;
      release = 100;
      pitch = 15600;
      chorus = 192;
      volume = 90;
      break;
    case CRY_MODE_FAINT:
      release = 200;
      pitch = 14440;
      break;
    case CRY_MODE_ECHO_END:
      release = 220;
      pitch = 15555;
      chorus = 192;
      volume = 90; // FR/LG changed this from 70 to 90
      break;
    case CRY_MODE_ROAR_1:
      length = 10;
      release = 100;
      pitch = 14848;
      break;
    case CRY_MODE_ROAR_2:
      length = 60;
      release = 225;
      pitch = 15616;
      break;
    case CRY_MODE_GROWL_1:
      length = 15;
      reverse = true;
      release = 125;
      pitch = 15200;
      break;
    case CRY_MODE_GROWL_2:
      length = 100;
      release = 225;
      pitch = 15200;
      break;
    case CRY_MODE_WEAK_DOUBLES:
      length = 20;
      release = 225;
    // fallthrough
    case CRY_MODE_WEAK:
      pitch = 15000;
      break;
  }

  SetPokemonCryVolume(volume);
  SetPokemonCryPanpot(pan);
  SetPokemonCryPitch(pitch);
  SetPokemonCryLength(length);
  SetPokemonCryProgress(0);
  SetPokemonCryRelease(release);
  SetPokemonCryChorus(chorus);
  SetPokemonCryPriority(priority);

  // The C picks one of four 128-entry tables (index = id % 128, table = id / 128); an id past them plays nothing.
  const cryId = SpeciesToCryId(species);
  const tone = cryId < 4 * 128 ? (reverse ? gCryTable_Reverse : gCryTable)[cryId] : undefined;
  if (!tone) return; // no cry tables loaded (unit tests without the audio data)
  gMPlay_PokemonCry = SetPokemonCryTone(tone);
  if (soundEventListener) {
    const wav = tone.wav as { name?: string } | null;
    soundEventListener({
      type: 'cry',
      id: (species + 1) & 0xffff,
      name: typeof wav?.name === 'string' ? wav.name : '',
      player: musicPlayerName(gMPlay_PokemonCry),
      ...(pan !== 0 ? { pan } : {}),
      mode,
    });
  }
}

/** IsCryFinished: TRUE once Task_DuckBGMForPokemonCry is gone (then it clears the cry songs). A cry without the
 *  task (NoDucking, DOUBLES) counts as finished at once, as in the C. */
export function IsCryFinished(): boolean {
  if (FuncIsActiveSoundTask(Task_DuckBGMForPokemonCry)) return false;
  ClearPokemonCrySongs();
  return true;
}

/** StopCryAndClearCrySongs: pause the cry player (its channels released) and clear the cry songs. */
export function StopCryAndClearCrySongs(): void {
  StopCry();
  ClearPokemonCrySongs();
}

/** StopCry */
export function StopCry(): void {
  if (!gMPlay_PokemonCry) return; // the C's m4aMPlayStop(NULL) writes into the BIOS area: nothing
  m4aMPlayStop(gMPlay_PokemonCry);
  playerEvent('stop', gMPlay_PokemonCry);
}

/** IsCryPlayingOrClearCrySongs: IsCryPlaying, and the cry songs cleared once it isn't. */
export function IsCryPlayingOrClearCrySongs(): boolean {
  if (IsCryPlaying()) return true;
  ClearPokemonCrySongs();
  return false;
}

/** IsCryPlaying: the last cry's first track still has its channel (until its FINE or the sample's end, the frame
 *  after: not the release tail). */
export function IsCryPlaying(): boolean {
  return gMPlay_PokemonCry !== null && IsPokemonCryPlaying(gMPlay_PokemonCry);
}

/** Task_DuckBGMForPokemonCry: waits gPokemonCryBGMDuckingCounter frames, then until the cry has stopped, and
 *  restores the BGM's volume. */
function Task_DuckBGMForPokemonCry(): void {
  if (gPokemonCryBGMDuckingCounter) {
    gPokemonCryBGMDuckingCounter--;
    return;
  }
  if (!IsCryPlaying()) {
    m4aMPlayVolumeControl(gMPlayInfo_BGM, TRACKS_ALL, 256);
    DestroySoundTask(Task_DuckBGMForPokemonCry);
  }
}

/** RestoreBGMVolumeAfterPokemonCry: CreateTask(Task_DuckBGMForPokemonCry, 80) unless it's running. */
function RestoreBGMVolumeAfterPokemonCry(): void {
  if (!FuncIsActiveSoundTask(Task_DuckBGMForPokemonCry)) CreateSoundTask(Task_DuckBGMForPokemonCry);
}

/**
 * ClearPokemonCrySongs (main.c): CpuFill16(0) over gPokemonCrySongs, the cry players' song copies. A cry track still
 * in its xWAIT (the sample ran out before the length did) then reads a 0 byte on its next tick: running status
 * XCMD with argument 0, ply_xxx, which runs ply_fine. So the cry song ends there and its player is free a tick
 * later (SetPokemonCryTone prefers a free player).
 */
export function ClearPokemonCrySongs(): void {
  for (const song of gPokemonCrySongs) {
    if (!song) continue;
    song.data.fill(0);
    song.trackCount = 0;
    song.blockCount = 0;
    song.priority = 0;
    song.reverb = 0;
  }
}

/** The test hooks' view of the cry state (__test.audio().sound.cry). */
function cryProbe() {
  return {
    player: gMPlay_PokemonCry ? musicPlayerName(gMPlay_PokemonCry) : null,
    playing: IsCryPlaying(),
    duckTaskActive: FuncIsActiveSoundTask(Task_DuckBGMForPokemonCry),
    duckingCounter: gPokemonCryBGMDuckingCounter,
  };
}
