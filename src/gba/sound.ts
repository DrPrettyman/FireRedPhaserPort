// sound.c: the layer the game calls for music and sound effects, on top of the m4a engine (audio/m4a.ts). The map
// music state machine (MapMusicMain), fanfares (sFanfares, Task_Fanfare, WaitFanfare), PlaySE / PlayBGM and the
// player checks (IsSEPlaying, IsBGMStopped, ...). MapMusicMain, the sound tasks and m4aSoundMain run once per frame
// from audio/frame.ts's AgbMainFrameEnd. The engine's logic always runs, so every wait here times like the GBA
// whether or not anything is heard (AUDIO_PLAN.md decision 2).
//
// Not here yet: the cries (sound.c:344-537, W-sound 2: the functions at the bottom are still stubs) and overworld.c's
// map music (W-sound 3: GetCurrLocationDefaultMusic, savedMusic, gDisableMapMusicChangeOnMapLoad).

import {
  gMPlayInfo_BGM,
  gMPlayInfo_SE1,
  gMPlayInfo_SE2,
  gMPlayInfo_SE3,
  gMPlayTable,
  gSongTable,
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
} from '../audio/m4a';
import { MUSICPLAYER_STATUS_PAUSE, MUSICPLAYER_STATUS_TRACK, TRACKS_ALL, type MusicPlayerInfo } from '../audio/m4aInternal';

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
  /** The song started, or the song on the player for stop / continue / fade (-1: none). */
  id: number;
  name: string;
  /** The music player: BGM, SE1, SE2, SE3 (cries: W-sound 2). */
  player: string;
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

/** The short player name of a music player (BGM, SE1, ...). */
export function musicPlayerName(info: MusicPlayerInfo): string {
  return info.name.replace(/^gMPlayInfo_/, '');
}

/** A song's name as songs.h has it (SE_SELECT, MUS_PALLET). */
export function songName(id: number): string {
  return gSongTable[id]?.header.name.toUpperCase() ?? `song ${id}`;
}

function playerEvent(type: SoundEventType, info: MusicPlayerInfo, extra: Partial<SoundEvent> = {}): void {
  if (!soundEventListener) return;
  const song = info.songHeader ? gSongTable.findIndex((s) => s.header === info.songHeader) : -1;
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

/** gDisableHelpSystemVolumeReduce (help_system.c, not ported): the help system halves the BGM unless it's set. */
let gDisableHelpSystemVolumeReduce = false;

// ---------------------------------------------------------------------------------------------------------------
// The sound tasks (AUDIO_PLAN.md decision 5). Task_Fanfare (and W-sound 2's Task_DuckBGMForPokemonCry) are gTasks of
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
  gDisableHelpSystemVolumeReduce = false;
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

// overworld.c's two one-line wrappers over the above. W-sound 3 (overworld.c's map music) may move them next to the
// rest of that block.

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
 *  WaitFanfare). The quest log's playback (sFanfareCounter = 0xFF, no song) isn't ported. */
export function PlayFanfareByFanfareNum(fanfareNum: number): void {
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

/** PlaySE. The C skips it while gDisableMapMusicChangeOnMapLoad is set (the Hall of Fame, the credits: W-sound 3
 *  ports that flag) and during the quest log's playback (not ported). */
export function PlaySE(songNum: number): void {
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

// ---------------------------------------------------------------------------------------------------------------
// The test hooks' view of sound.c (dev/testHooks.ts: __test.audio()).

export function soundProbe() {
  return {
    mapMusic: { current: sCurrentMapMusic, next: sNextMapMusic, state: sMapMusicState, fadeInSpeed: sMapMusicFadeInSpeed },
    fanfareCounter: sFanfareCounter,
    fanfareTaskActive: !IsFanfareTaskInactive(),
    helpSystemVolumeReduceDisabled: gDisableHelpSystemVolumeReduce,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Cries: still stubs (W-sound 2 ports sound.c:344-537 on W-m4a 2's cry players).

/** PlayCry_ByMode: no cries yet. */
export function PlayCry_ByMode(_species: number, _pan: number, _mode: number): void {}

/** PlayCry_Normal: no cries yet. */
export function PlayCry_Normal(_species: number, _pan: number): void {}

/** PlayCry_NormalNoDucking: no cries yet. */
export function PlayCry_NormalNoDucking(_species: number, _pan: number, _volume: number, _priority: number): void {}

/** IsCryFinished: TRUE once the cry has stopped (no cries yet, so always). */
export function IsCryFinished(): boolean {
  return true;
}

export function StopCryAndClearCrySongs(): void {}

/** IsCryPlaying: FALSE (no cries yet) */
export function IsCryPlaying(): boolean {
  return false;
}

/** IsCryPlayingOrClearCrySongs: TRUE while a cry is playing. */
export function IsCryPlayingOrClearCrySongs(): boolean {
  return false;
}
