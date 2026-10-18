// gba/sound.ts (sound.c without the cries) and audio/frame.ts's AgbMainFrameEnd on the extracted songs: the fanfare
// task's frame counts, the BGM paused and resumed around a fanfare, IsSEPlaying over an SE's life, the map music
// state machine and its fade-out wait. Expected numbers: sFanfares (sound.c) and the engine's song lengths, which
// tests/unit/m4a.test.ts pins.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { gMPlayInfo_BGM, gMPlayInfo_SE2, setVoiceData } from '../../src/audio/m4a';
import { MUSICPLAYER_STATUS_PAUSE } from '../../src/audio/m4aInternal';
import { loadSongTable, type SongsJson } from '../../src/audio/songTable';
import { AgbMainFrameEnd, AgbMainSoundInit } from '../../src/audio/frame';
import {
  BGMusicStopped,
  FadeOutAndPlayNewMapMusic,
  FadeOutMapMusic,
  GetCurrentMapMusic,
  IsBGMPlaying,
  IsBGMStopped,
  IsFanfareTaskInactive,
  IsNotWaitingForBGMStop,
  IsSEPlaying,
  PlayFanfare,
  PlayFanfareByFanfareNum,
  PlayNewMapMusic,
  PlaySE,
  setSoundEventListener,
  songName,
  WaitFanfare,
  type SoundEvent,
} from '../../src/gba/sound';

const SONGS_JSON = resolve(__dirname, '../../public/gen/audio/songs.json');

describe.skipIf(!existsSync(SONGS_JSON))('sound.c on the extracted songs', () => {
  const json = existsSync(SONGS_JSON) ? (JSON.parse(readFileSync(SONGS_JSON, 'utf8')) as SongsJson) : null;
  const gen = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../public/gen/audio', f), 'utf8'));
  if (json) setVoiceData(gen('voicegroups.json'), gen('samples.json'), gen('waves.json')); // as audioData.ts does
  let id: (name: string) => number;

  beforeEach(() => {
    const table = loadSongTable(json!);
    id = (name) => table.idByName.get(name)!;
    AgbMainSoundInit();
    setSoundEventListener(undefined);
  });

  /** Frames (AgbMainFrameEnd calls) until cond holds, checked before each frame as a script's native wait is. */
  const framesUntil = (cond: () => boolean, cap = 5000): number => {
    for (let f = 0; f < cap; f++) {
      if (cond()) return f;
      AgbMainFrameEnd();
    }
    return -1;
  };

  test('PlayFanfare: Task_Fanfare holds sFanfares frames, the BGM paused, then resumes it', () => {
    PlayNewMapMusic(id('MUS_ROUTE1'));
    AgbMainFrameEnd(); // MapMusicMain starts it, m4aSoundMain runs its first tick
    expect(IsBGMPlaying()).toBe(true);

    const events: SoundEvent[] = [];
    setSoundEventListener((e) => events.push(e));
    PlayFanfare(id('MUS_LEVEL_UP'));
    expect(events.map((e) => [e.type, e.name, e.player])).toEqual([
      ['stop', 'MUS_ROUTE1', 'BGM'],
      ['fanfare', 'MUS_LEVEL_UP', 'SE2'],
    ]);
    expect(gMPlayInfo_BGM.status & MUSICPLAYER_STATUS_PAUSE).toBeTruthy();
    expect(IsFanfareTaskInactive()).toBe(false);
    // The task runs in the frame that created it: 80 frames count the counter down, the 81st resumes the BGM.
    let frames = 0;
    while (!IsFanfareTaskInactive()) {
      expect(IsBGMPlaying()).toBe(false);
      AgbMainFrameEnd();
      frames++;
    }
    expect(frames).toBe(81);
    expect(events.at(-1)).toMatchObject({ type: 'continue', name: 'MUS_ROUTE1', player: 'BGM' });
    AgbMainFrameEnd();
    expect(IsBGMPlaying()).toBe(true);
  });

  test.each([
    ['MUS_OBTAIN_ITEM', 160],
    ['MUS_HEAL', 160],
    ['MUS_OBTAIN_BADGE', 340],
    ['MUS_EVOLVED', 220],
    ['MUS_OBTAIN_KEY_ITEM', 170],
  ])('%s holds %i frames', (name, duration) => {
    PlayFanfare(id(name));
    expect(framesUntil(IsFanfareTaskInactive)).toBe(duration + 1);
  });

  test('a song not in sFanfares plays the first entry (MUS_LEVEL_UP, 80 frames)', () => {
    PlayFanfare(id('SE_SELECT'));
    expect(gMPlayInfo_SE2.songHeader?.name.toUpperCase()).toBe('MUS_LEVEL_UP');
    expect(framesUntil(IsFanfareTaskInactive)).toBe(81);
  });

  test('a fanfare outliving its counter keeps SE2 playing (IsSEPlaying) past the resumed BGM: MUS_EVOLVED', () => {
    PlayFanfare(id('MUS_EVOLVED'));
    expect(framesUntil(IsFanfareTaskInactive)).toBe(221);
    expect(IsSEPlaying()).toBe(true); // the song is 230 frames long (m4a.test.ts)
    expect(framesUntil(() => !IsSEPlaying())).toBe(230 - 221);
  });

  test('WaitFanfare counts without the task: FANFARE_OBTAIN_BADGE (index 5) is 340 calls, then TRUE', () => {
    PlayFanfareByFanfareNum(5);
    let calls = 1;
    while (!WaitFanfare(false)) calls++;
    expect(calls).toBe(341);
    expect(IsFanfareTaskInactive()).toBe(true);
  });

  test('IsSEPlaying: FALSE in the frame the SE starts, TRUE from the first engine tick until the player stops', () => {
    PlaySE(id('SE_SELECT'));
    expect(IsSEPlaying()).toBe(false);
    // SE_SELECT stops after the engine's 11th frame (m4a.test.ts).
    expect(framesUntil(IsSEPlaying)).toBe(1);
    expect(framesUntil(() => !IsSEPlaying())).toBe(10);
  });

  test('FadeOutMapMusic: IsNotWaitingForBGMStop / BGMusicStopped wait for the fade (16 × speed frames)', () => {
    PlayNewMapMusic(id('MUS_PALLET'));
    AgbMainFrameEnd();
    AgbMainFrameEnd();
    FadeOutMapMusic(4);
    expect(BGMusicStopped()).toBe(false);
    const frames = framesUntil(BGMusicStopped);
    // FadeOutBody stops the player in its 16th step (m4a.test.ts); MapMusicMain sees it in the next frame's hook,
    // which runs before m4aSoundMain.
    expect(frames).toBe(16 * 4 + 1);
    expect(IsBGMStopped()).toBe(true);
    expect(GetCurrentMapMusic()).toBe(0);
  });

  test('FadeOutAndPlayNewMapMusic: the new song starts once the old one has stopped', () => {
    PlayNewMapMusic(id('MUS_PALLET'));
    AgbMainFrameEnd();
    const events: SoundEvent[] = [];
    setSoundEventListener((e) => events.push(e));
    FadeOutAndPlayNewMapMusic(id('MUS_OAK'), 2);
    expect(IsNotWaitingForBGMStop()).toBe(false);
    const frames = framesUntil(IsNotWaitingForBGMStop);
    expect(frames).toBe(16 * 2 + 1);
    expect(events.map((e) => [e.type, e.name])).toEqual([
      ['fade', 'MUS_PALLET'],
      ['bgm', 'MUS_OAK'],
    ]);
    expect(GetCurrentMapMusic()).toBe(id('MUS_OAK'));
    AgbMainFrameEnd();
    expect(IsBGMPlaying()).toBe(true);
    expect(songName(id('MUS_OAK'))).toBe('MUS_OAK');
  });
});
