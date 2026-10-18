// sound.c's cries (gba/sound.ts, W-sound 2) beyond the ROM table in m4aRom.test.ts: the constants it keeps, SpeciesToCryId,
// the BGM ducking around a cry, ClearPokemonCrySongs ending a cry song early, StopCryAndClearCrySongs; and the text
// printer's audio (text.c): PLAY_SE, WAIT_SE, SE_SELECT on A, PAUSE_MUSIC / PLAY_BGM / RESUME_MUSIC.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { AgbMainFrameEnd, AgbMainSoundInit } from '../../src/audio/frame';
import { gCryTable, gMPlayInfo_BGM, gPokemonCryMusicPlayers, setVoiceData } from '../../src/audio/m4a';
import { MUSICPLAYER_STATUS_PAUSE, MUSICPLAYER_STATUS_TRACK } from '../../src/audio/m4aInternal';
import { loadSongTable, type SongsJson } from '../../src/audio/songTable';
import { initConstants } from '../../src/battle/constants';
import {
  IsCryFinished,
  IsCryPlaying,
  IsCryPlayingOrClearCrySongs,
  IsSEPlaying,
  PlayBGM,
  PlayCry_ByMode,
  PlayCry_Normal,
  PlayCry_NormalNoDucking,
  PlayCry_Script,
  setSoundEventListener,
  SOUND_CONSTANTS,
  StopCryAndClearCrySongs,
  type SoundEvent,
} from '../../src/gba/sound';
import { SpeciesToCryId } from '../../src/pokemon/Pokemon';
import { TextPrinter, type PrinterTemplate } from '../../src/text/TextPrinter';
import type { Input } from '../../src/input/Input';
import type { Fonts } from '../../src/text/Font';
import type { TextSurface } from '../../src/text/TextWindow';
import { newGame, readGen } from './gameData';

const GEN = resolve(__dirname, '../../public/gen/audio');
const haveAudio = ['songs.json', 'voicegroups.json', 'samples.json', 'waves.json'].every((f) => existsSync(resolve(GEN, f)));
const gen = <T,>(f: string): T => JSON.parse(readFileSync(resolve(GEN, f), 'utf8')) as T;

const game = newGame(); // PokemonData's constructor installs SpeciesToCryId's tables
const { d } = game;
const defines = readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines;
initConstants(defines); // K.SE_SELECT for the text printer

test("sound.ts's constants/sound.h numbers equal the extracted ones", () => {
  for (const [name, value] of Object.entries(SOUND_CONSTANTS)) expect([name, value]).toEqual([name, d(name)]);
});

test('SpeciesToCryId (pokemon.c): Gen I-II as is, the old Unown letters as Unown, Hoenn through cry_ids.h', () => {
  // PlayCryInternal passes species - 1.
  expect(SpeciesToCryId(d('SPECIES_PIDGEY') - 1)).toBe(d('SPECIES_PIDGEY') - 1);
  expect(SpeciesToCryId(d('SPECIES_CELEBI') - 1)).toBe(d('SPECIES_CELEBI') - 1);
  expect(SpeciesToCryId(d('SPECIES_OLD_UNOWN_B') - 1)).toBe(d('SPECIES_UNOWN') - 1);
  expect(SpeciesToCryId(d('SPECIES_OLD_UNOWN_Z') - 1)).toBe(d('SPECIES_UNOWN') - 1);
  expect(SpeciesToCryId(d('SPECIES_TREECKO') - 1)).toBe(d('CRY_TREECKO'));
  expect(SpeciesToCryId(d('SPECIES_CHIMECHO') - 1)).toBe(d('CRY_CHIMECHO'));
  expect(SpeciesToCryId(d('SPECIES_DEOXYS') - 1)).toBe(d('CRY_DEOXYS'));
});

describe.skipIf(!haveAudio)('cries on the extracted data', () => {
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

  const sampleOf = (species: string) => {
    const tone = gCryTable[SpeciesToCryId(d(species) - 1)];
    return (tone.wav as { name: string }).name;
  };

  test("the cry table entry is the species' own cry (Gen I, Unown's letters, Hoenn)", () => {
    expect(sampleOf('SPECIES_CHARIZARD')).toBe('Cry_Charizard');
    expect(sampleOf('SPECIES_OLD_UNOWN_Q')).toBe('Cry_Unown');
    expect(sampleOf('SPECIES_TREECKO')).toBe('Cry_Treecko');
    expect(sampleOf('SPECIES_CHIMECHO')).toBe('Cry_Chimecho');
    expect(sampleOf('SPECIES_DEOXYS')).toBe('Cry_Deoxys');
  });

  test("PlayCry_Normal ducks the BGM to 85 until Task_DuckBGMForPokemonCry sees the cry end, and reports a 'cry'", () => {
    PlayBGM(id('MUS_ROUTE1'));
    AgbMainFrameEnd();
    const volX = () => gMPlayInfo_BGM.tracks[0].volX; // 256 >> 2 = 64 is full volume
    expect(volX()).toBe(64);
    PlayCry_Normal(d('SPECIES_CHARIZARD'), 0);
    expect(events.at(-1)).toMatchObject({ type: 'cry', id: d('SPECIES_CHARIZARD'), name: 'Cry_Charizard', player: 'CRY0', mode: 0 });
    expect(volX()).toBe(85 >> 2);
    let frames = 0;
    while (!IsCryFinished()) {
      expect(volX()).toBe(85 >> 2);
      AgbMainFrameEnd();
      frames++;
    }
    expect(frames).toBe(56 + 1); // Charizard NORMAL: IsPokemonCryPlaying FALSE after frame 56 (the ROM)
    expect(volX()).toBe(64);
  });

  test('PlayCry_NormalNoDucking and DOUBLES leave the BGM alone and start no task: IsCryFinished at once', () => {
    PlayBGM(id('MUS_ROUTE1'));
    AgbMainFrameEnd();
    PlayCry_NormalNoDucking(d('SPECIES_MEW'), 0, d('CRY_VOLUME_RS'), d('CRY_PRIORITY_NORMAL'));
    expect(gMPlayInfo_BGM.tracks[0].volX).toBe(64);
    AgbMainFrameEnd();
    expect(IsCryPlaying()).toBe(true);
    // No task: finished at once, though the cry plays. (And IsCryFinished's ClearPokemonCrySongs then cuts it off at
    // its next tick, as in the C; the Pokédex and the credits never ask.)
    expect(IsCryFinished()).toBe(true);
    PlayCry_ByMode(d('SPECIES_MEW'), 0, d('CRY_MODE_DOUBLES'));
    expect(gMPlayInfo_BGM.tracks[0].volX).toBe(64);
    expect(IsCryFinished()).toBe(true);
  });

  test('a second cry while the first plays takes the other cry player', () => {
    PlayCry_Script(d('SPECIES_JYNX'), d('CRY_MODE_NORMAL'));
    AgbMainFrameEnd();
    PlayCry_Script(d('SPECIES_PIDGEY'), d('CRY_MODE_NORMAL'));
    expect(events.filter((e) => e.type === 'cry').map((e) => [e.name, e.player])).toEqual([
      ['Cry_Jynx', 'CRY0'],
      ['Cry_Pidgey', 'CRY1'],
    ]);
  });

  test('ClearPokemonCrySongs (IsCryFinished) ends a cry song still in its xWAIT: the player is free two frames on', () => {
    // Pidgey's sample runs out after frame 12, long before NORMAL's 140-tick length (the song's FINE in 141).
    PlayCry_ByMode(d('SPECIES_PIDGEY'), 0, d('CRY_MODE_NORMAL'));
    const player = gPokemonCryMusicPlayers[0];
    let f = 0;
    while (!IsCryFinished()) {
      AgbMainFrameEnd();
      f++;
    }
    expect(f).toBe(13);
    expect(player.status & MUSICPLAYER_STATUS_TRACK).toBeTruthy();
    // Next tick: the cleared bytes read as running-status XCMD 0 (ply_xxx → ply_fine); the tick after, no track.
    AgbMainFrameEnd();
    AgbMainFrameEnd();
    expect(player.status & MUSICPLAYER_STATUS_TRACK).toBe(0);
  });

  test('without ClearPokemonCrySongs the cry song runs to its FINE (IsCryPlaying alone clears nothing)', () => {
    PlayCry_NormalNoDucking(d('SPECIES_PIDGEY'), 0, d('CRY_VOLUME'), d('CRY_PRIORITY_NORMAL'));
    const player = gPokemonCryMusicPlayers[0];
    for (let f = 1; f <= 141; f++) {
      AgbMainFrameEnd();
      expect(IsCryPlaying()).toBe(f < 12);
    }
    expect(player.status & MUSICPLAYER_STATUS_TRACK).toBeTruthy();
    AgbMainFrameEnd();
    expect(player.status & MUSICPLAYER_STATUS_TRACK).toBe(0);
  });

  test('StopCryAndClearCrySongs stops the cry at once; IsCryPlayingOrClearCrySongs is then FALSE', () => {
    PlayCry_ByMode(d('SPECIES_MEW'), 0, d('CRY_MODE_NORMAL'));
    AgbMainFrameEnd();
    expect(IsCryPlayingOrClearCrySongs()).toBe(true);
    StopCryAndClearCrySongs();
    expect(events.at(-1)).toMatchObject({ type: 'stop', player: 'CRY0' });
    expect(IsCryPlaying()).toBe(false);
    expect(IsCryPlayingOrClearCrySongs()).toBe(false);
    // The ducking task sees it stopped in the next hook and restores the BGM volume.
    AgbMainFrameEnd();
    AgbMainFrameEnd();
    expect(IsCryFinished()).toBe(true);
  });

  // --------------------------------------------------------------------------------------------------- text.c

  /** A printer over stub surfaces: control codes only, so no glyph is drawn. `pressA` answers pressedAorB. */
  function printer(bytes: number[]) {
    let pressA = false;
    const input = { pressedAorB: () => pressA, held: () => false } as unknown as Input;
    const surface = { width: 240, height: 160, fill() {}, fillRect() {}, blit() {}, scrollUp() {}, drawGlyph: () => 0 } as unknown as TextSurface;
    const t: PrinterTemplate = { fontId: 2, x: 0, y: 0, fgColor: 2, bgColor: 1, shadowColor: 3, lineSpacing: 0, speed: 1, canABSpeedUp: true, scrollSpeed: 4 };
    const p = new TextPrinter(surface, {} as Fonts, input, {} as ImageData, bytes, t);
    return { p, press: (v: boolean) => (pressA = v) };
  }
  const FC = 0xfc;
  const EXT_WAIT_SE = 0x0a;
  const EXT_PLAY_BGM = 0x0b;
  const EXT_PLAY_SE = 0x10;
  const EXT_PAUSE_MUSIC = 0x17;
  const EXT_RESUME_MUSIC = 0x18;
  const CHAR_PROMPT_CLEAR = 0xfb;
  const EOS = 0xff;
  const u16 = (n: number) => [n & 0xff, n >> 8];

  test('{PLAY_SE}{WAIT_SE} holds the printer until the SE stops, then \\p waits for A, which plays SE_SELECT', () => {
    // sText_GotAwaySafely's {PLAY_SE SE_FLEE}, then a WAIT_SE as in sText_PkmnGrewToLv.
    const { p, press } = printer([FC, EXT_PLAY_SE, ...u16(id('SE_FLEE')), FC, EXT_WAIT_SE, CHAR_PROMPT_CLEAR, EOS]);
    p.tick(); // frame 0: SE_FLEE starts, the printer goes to RENDER_STATE_WAIT_SE
    expect(events.map((e) => [e.type, e.name])).toEqual([['se', 'SE_FLEE']]);
    expect(IsSEPlaying()).toBe(false); // the engine's first tick is this frame's hook
    AgbMainFrameEnd();
    let f = 1;
    while (!p.waitingForButton) {
      expect(f).toBeLessThan(100);
      p.tick();
      AgbMainFrameEnd();
      f++;
    }
    // At text speed 1 each code after the first in a frame waits a frame (RenderText's delayCounter): PLAY_SE in
    // frame 0, WAIT_SE in 1. SE_FLEE's player stops after frame 41 (the ROM): the printer sees it in frame 41,
    // waits its delay frame in 42 and reaches the \p in 43.
    expect(f).toBe(44);
    for (let i = 0; i < 5; i++) {
      p.tick();
      AgbMainFrameEnd();
    }
    expect(p.waitingForButton).toBe(true);
    press(true);
    p.tick();
    press(false);
    expect(events.at(-1)).toMatchObject({ type: 'se', name: 'SE_SELECT', player: 'SE2' });
    p.tick(); // the delay frame
    p.tick(); // EOS
    expect(p.finished).toBe(true);
  });

  test('{PAUSE_MUSIC}{PLAY_BGM MUS_OBTAIN_BADGE}...{RESUME_MUSIC}: the BGM paused while the fanfare song plays on SE2', () => {
    // PewterCity_Gym_Text_ReceivedBoulderBadge's codes (the PAUSEs left out).
    PlayBGM(id('MUS_GYM'));
    AgbMainFrameEnd();
    const { p } = printer([FC, EXT_PAUSE_MUSIC, FC, EXT_PLAY_BGM, ...u16(id('MUS_OBTAIN_BADGE')), FC, EXT_RESUME_MUSIC, EOS]);
    const paused: boolean[] = [];
    while (!p.finished && paused.length < 10) {
      p.tick(); // one code a frame at text speed 1
      AgbMainFrameEnd();
      paused.push(!!(gMPlayInfo_BGM.status & MUSICPLAYER_STATUS_PAUSE));
    }
    expect(paused).toEqual([true, true, false, false]);
    // PlayBGM starts the song on its own player: the fanfare songs are SE2's.
    expect(events.find((e) => e.name === 'MUS_OBTAIN_BADGE')).toMatchObject({ type: 'bgm', player: 'SE2', started: true });
    expect(IsSEPlaying()).toBe(true);
  });
});
