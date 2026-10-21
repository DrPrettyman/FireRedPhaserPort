// QUEST_LOG_PLAN.md QL5a2: what the quest log's playback changes in sound.c and text.c. gQuestLogState is set by
// hand (world/questLogState.ts); expected numbers are the C's: sFanfareCounter = 0xFF (PlayFanfareByFanfareNum),
// TextPrinterWaitAutoMode's 50 / 120 frames, RenderText's delayCounter = 1 in auto mode.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { AgbMainFrameEnd, AgbMainSoundInit } from '../../src/audio/frame';
import { gMPlayInfo_BGM, setVoiceData } from '../../src/audio/m4a';
import { MUSICPLAYER_STATUS_PAUSE } from '../../src/audio/m4aInternal';
import { loadSongTable, type SongsJson } from '../../src/audio/songTable';
import { initConstants } from '../../src/battle/constants';
import {
  IsBGMPlaying,
  IsCryFinished,
  PlayBGM,
  PlayCry_Script,
  PlayFanfareByFanfareNum,
  PlayNewMapMusic,
  PlaySE,
  setSoundEventListener,
  WaitFanfare,
  type SoundEvent,
} from '../../src/gba/sound';
import type { Input } from '../../src/input/Input';
import type { Fonts } from '../../src/text/Font';
import { gTextFlags } from '../../src/text/textFlags';
import { TextPrinter, type PrinterTemplate } from '../../src/text/TextPrinter';
import type { TextSurface } from '../../src/text/TextWindow';
import { gHelpSystemEnabled, HelpSystem_Disable, HelpSystem_Enable } from '../../src/ui/helpSystemContext';
import { gQL, QL_InPlaybackState, QL_IS_PLAYBACK_STATE } from '../../src/world/questLogState';
import { newGame, readGen } from './gameData';

const GEN = resolve(__dirname, '../../public/gen/audio');
const haveAudio = ['songs.json', 'voicegroups.json', 'samples.json', 'waves.json'].every((f) => existsSync(resolve(GEN, f)));
const gen = <T,>(f: string): T => JSON.parse(readFileSync(resolve(GEN, f), 'utf8')) as T;

const { d } = newGame(); // PokemonData's constructor installs SpeciesToCryId's tables
initConstants(readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines);

afterEach(() => {
  gQL.state = 0;
  gTextFlags.autoScroll = false;
});

test('QL_IS_PLAYBACK_STATE is PLAYBACK or PLAYBACK_LAST; QL_InPlaybackState only PLAYBACK', () => {
  const rows = [0, d('QL_STATE_RECORDING'), d('QL_STATE_PLAYBACK'), d('QL_STATE_PLAYBACK_LAST')].map((s) => {
    gQL.state = s;
    return [QL_IS_PLAYBACK_STATE(), QL_InPlaybackState()];
  });
  expect(rows).toEqual([
    [false, false],
    [false, false],
    [true, true],
    [true, false],
  ]);
});

test('HelpSystem_Enable does nothing in playback (help_system.c: !QL_IS_PLAYBACK_STATE)', () => {
  HelpSystem_Disable();
  gQL.state = d('QL_STATE_PLAYBACK_LAST');
  HelpSystem_Enable();
  expect(gHelpSystemEnabled).toBe(false);
  gQL.state = 0;
  HelpSystem_Enable();
  expect(gHelpSystemEnabled).toBe(true);
});

// ------------------------------------------------------------------------------------------------- text.c

/** A printer over stub surfaces: control codes only, so no glyph is drawn. `press` answers pressedAorB. */
function printer(bytes: number[], speed = 1) {
  let pressA = false;
  const input = { pressedAorB: () => pressA, held: () => false } as unknown as Input;
  const surface = { width: 240, height: 160, fill() {}, fillRect() {}, blit() {}, scrollUp() {}, drawGlyph: () => 0 } as unknown as TextSurface;
  const t: PrinterTemplate = { fontId: 2, x: 0, y: 0, fgColor: 2, bgColor: 1, shadowColor: 3, lineSpacing: 0, speed, canABSpeedUp: true, scrollSpeed: 4 };
  const p = new TextPrinter(surface, { get: () => ({ info: { maxLetterHeight: 14 } }) } as unknown as Fonts, input, {} as ImageData, bytes, t);
  return { p, press: (v: boolean) => (pressA = v) };
}
const CHAR_PROMPT_CLEAR = 0xfb;
const CHAR_PROMPT_SCROLL = 0xfa;
const FC = 0xfc;
const EXT_PAUSE_UNTIL_PRESS = 0x09;
const EXT_PLAY_BGM = 0x0b;
const EOS = 0xff;

/** Frames until the printer finishes (cap: -1). */
function framesToFinish(p: TextPrinter, cap = 1000): number {
  for (let f = 1; f <= cap; f++) {
    p.tick();
    if (p.finished) return f;
  }
  return -1;
}

describe('the auto mode (gTextFlags.autoScroll)', () => {
  // At speed 1: frame 1 reads the \p / \l / {PAUSE_UNTIL_PRESS}, then TextPrinterWaitAutoMode is FALSE `delay` times
  // (counting 0 → delay) and TRUE on the next frame; then the delay frame (delayCounter = 1) and EOS: delay + 4.
  // \l scrolls 14 px at 4 a frame first (4 frames) and a frame finds it done: delay + 9.
  test.each([
    ['playback', 'QL_STATE_PLAYBACK', 50],
    ['the final scene (PLAYBACK_LAST: 120, as outside the quest log)', 'QL_STATE_PLAYBACK_LAST', 120],
    ['a Pokédude battle (no quest log)', '', 120],
  ])('\\p, \\l and {PAUSE_UNTIL_PRESS} go on by themselves in %s after %i frames', (_name, state, delay) => {
    gQL.state = state ? d(state) : 0;
    gTextFlags.autoScroll = true;
    expect(framesToFinish(printer([CHAR_PROMPT_CLEAR, EOS]).p)).toBe(delay + 4);
    expect(framesToFinish(printer([FC, EXT_PAUSE_UNTIL_PRESS, EOS]).p)).toBe(delay + 4);
    expect(framesToFinish(printer([CHAR_PROMPT_SCROLL, EOS]).p)).toBe(delay + 9);
  });

  test('A and B do nothing at a \\p in auto mode, and nothing waits for them', () => {
    gQL.state = d('QL_STATE_PLAYBACK');
    gTextFlags.autoScroll = true;
    const { p, press } = printer([CHAR_PROMPT_CLEAR, EOS]);
    press(true);
    for (let f = 0; f < 50; f++) p.tick();
    expect(p.finished).toBe(false);
    expect(p.waitingForButton).toBe(true);
    press(false);
  });

  test('without it the \\p waits for A however long', () => {
    gQL.state = d('QL_STATE_PLAYBACK');
    const { p, press } = printer([CHAR_PROMPT_CLEAR, EOS]);
    for (let f = 0; f < 500; f++) p.tick();
    expect(p.finished).toBe(false);
    press(true);
    p.tick();
    press(false);
    expect(framesToFinish(p)).toBe(2);
  });

  test('a character every other frame, whatever the text speed (RenderText: delayCounter = 1)', () => {
    gTextFlags.autoScroll = true;
    // Three characters and EOS at the slow speed (8): frames 1, 3, 5 print, 7 reads EOS.
    expect(framesToFinish(printer([0xbb, 0xbc, 0xbd, EOS], 8).p)).toBe(7);
    gTextFlags.autoScroll = false;
    expect(framesToFinish(printer([0xbb, 0xbc, 0xbd, EOS], 8).p)).toBe(28);
  });
});

// ------------------------------------------------------------------------------------------------- sound.c

describe.skipIf(!haveAudio)('sound.c in playback', () => {
  const songs = haveAudio ? gen<SongsJson>('songs.json') : null!;
  const voices = haveAudio ? [gen('voicegroups.json'), gen('samples.json'), gen('waves.json')] : [];
  let id: (name: string) => number;
  let events: SoundEvent[];

  beforeEach(() => {
    const table = loadSongTable(songs);
    id = (name) => table.idByName.get(name)!;
    setVoiceData(...(voices as Parameters<typeof setVoiceData>));
    AgbMainSoundInit();
    events = [];
    setSoundEventListener((e) => events.push(e));
  });

  test('PlayFanfareByFanfareNum: no song, the BGM plays on, and WaitFanfare counts sFanfareCounter = 0xFF', () => {
    PlayNewMapMusic(id('MUS_ROUTE1'));
    AgbMainFrameEnd();
    events.length = 0;
    gQL.state = d('QL_STATE_PLAYBACK');
    PlayFanfareByFanfareNum(5); // FANFARE_OBTAIN_BADGE: 340 frames outside playback
    expect(events).toEqual([]);
    expect(gMPlayInfo_BGM.status & MUSICPLAYER_STATUS_PAUSE).toBeFalsy();
    let calls = 1;
    while (!WaitFanfare(false)) calls++;
    expect(calls).toBe(0xff + 1);
    AgbMainFrameEnd();
    expect(IsBGMPlaying()).toBe(true);
  });

  test('PlaySE is quiet in PLAYBACK (not in PLAYBACK_LAST)', () => {
    gQL.state = d('QL_STATE_PLAYBACK');
    PlaySE(id('SE_SELECT'));
    expect(events).toEqual([]);
    gQL.state = d('QL_STATE_PLAYBACK_LAST');
    PlaySE(id('SE_SELECT'));
    expect(events.map((e) => [e.type, e.name])).toEqual([['se', 'SE_SELECT']]);
  });

  test("PlayCry_Script: no cry and no ducking in either playback state, but the ducking task's frames still run", () => {
    PlayBGM(id('MUS_ROUTE1'));
    AgbMainFrameEnd();
    for (const state of ['QL_STATE_PLAYBACK', 'QL_STATE_PLAYBACK_LAST']) {
      events.length = 0;
      gQL.state = d(state);
      PlayCry_Script(d('SPECIES_CHARIZARD'), d('CRY_MODE_NORMAL'));
      expect(events.filter((e) => e.type === 'cry')).toEqual([]);
      expect(gMPlayInfo_BGM.tracks[0].volX).toBe(64);
      // gPokemonCryBGMDuckingCounter = 2 and the task: IsCryFinished once it has seen no cry playing
      let frames = 0;
      while (!IsCryFinished() && frames < 20) {
        AgbMainFrameEnd();
        frames++;
      }
      expect(frames).toBeGreaterThan(0);
      expect(frames).toBeLessThan(20);
    }
  });

  test('{PLAY_BGM} plays nothing in playback (text.c: !QL_IS_PLAYBACK_STATE)', () => {
    gQL.state = d('QL_STATE_PLAYBACK_LAST');
    const { p } = printer([FC, EXT_PLAY_BGM, id('MUS_OBTAIN_BADGE') & 0xff, id('MUS_OBTAIN_BADGE') >> 8, EOS]);
    framesToFinish(p);
    expect(events).toEqual([]);
  });
});
