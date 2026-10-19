// The scenes' sounds (AUDIO_PLAN.md W-sound 7a): the evolution scene (evolution_scene.c, evolution_graphics.c), egg
// hatching (daycare.c) and the in-game trade (trade_scene.c), and the map music after them. Read through
// `__test.audioEvents` (each start / stop with the logic tick it was made in); the engine runs headless with the output
// off, so the waits time like the GBA without anything being heard.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { gMPlayTable, m4aSongNumStart, m4aSoundInit, m4aSoundMain, setVoiceData } from '../../src/audio/m4a';
import { MUSICPLAYER_STATUS_TRACK } from '../../src/audio/m4aInternal';
import { loadSongTable, type SongsJson } from '../../src/audio/songTable';
import { useGame, type Game } from './harness';

const session = useGame();

/** The number of engine ticks after which song `name` alone has no live track left (as audio.test.ts). */
function songStopFrame(name: string): number {
  const gen = (f: string) => JSON.parse(readFileSync(resolve(__dirname, '../../public/gen/audio', f), 'utf8'));
  m4aSoundInit();
  const table = loadSongTable(gen('songs.json') as SongsJson);
  setVoiceData(gen('voicegroups.json'), gen('samples.json'), gen('waves.json'));
  const id = table.idByName.get(name)!;
  m4aSongNumStart(id);
  const info = gMPlayTable[table.songs[id].ms].info;
  for (let f = 1; f < 20000; f++) {
    m4aSoundMain();
    if (!(info.status & MUSICPLAYER_STATUS_TRACK)) return f;
  }
  throw new Error(`${name} doesn't end`);
}

interface Ev {
  seq: number;
  frame: number;
  type: string;
  id: number;
  name: string;
  player: string;
  mode?: number;
  started?: boolean;
}

const events = (game: Game, since: number): Promise<Ev[]> => game.eval((t, s) => t.audioEvents(s), since) as Promise<Ev[]>;
const species = (game: Game, name: string): Promise<number> => game.eval((t, n) => t.define(n), name);
/** The song on the BGM player and whether it plays. */
const bgm = (game: Game) => game.eval((t) => t.audio().players.BGM);
/** One-line list of the events, for failure messages. */
const show = (evs: Ev[]) => evs.map((e) => `${e.frame} ${e.type} ${e.player} ${e.name || e.id}`).join('\n');

test('evolution: the cries, MUS_EVOLUTION_INTRO, MUS_EVOLUTION, SE_EXP stopped with everything, MUS_EVOLVED, the map music back', async () => {
  // A Rare Candy from the bag on Route 1 (as evolution.test.ts): Charmander → Charmeleon, no move to learn at 16.
  const game = await session.start({ start: 'after-rival', map: 'Route1', x: 12, y: 7, party: [{ species: 'CHARMANDER', level: 15 }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_RARE_CANDY'), 1));
  expect(await bgm(game)).toMatchObject({ song: 'MUS_ROUTE1', playing: true });
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN');
  await game.press('A');
  await game.waitForBag();
  const mark = await game.mark();
  await game.pressTimes('A', 3);
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_EvolutionSceneUpdate'), { what: 'the evolution scene' });
  await game.waitForEvent('evolution', { since: mark, timeout: 60_000 });
  await game.mashUntil((t) => t.gbaScreen() !== undefined && !t.gbaScreen()!.startsWith('CB2_EvolutionScene'), { what: 'the bag after the evolution' });

  const charmander = await species(game, 'SPECIES_CHARMANDER');
  const charmeleon = await species(game, 'SPECIES_CHARMELEON');
  const evs = await events(game, mark);
  const msg = show(evs);
  const at = (pred: (e: Ev) => boolean, from = 0) => {
    const i = evs.findIndex((e, j) => j >= from && pred(e));
    expect(i, msg).toBeGreaterThanOrEqual(0);
    return i;
  };
  const named = (type: string, name: string) => (e: Ev) => e.type === type && e.name === name;

  // The party menu's level up first (MUS_LEVEL_UP); then the scene: m4aMPlayAllStop on entry stops the map music
  const levelUp = at(named('fanfare', 'MUS_LEVEL_UP'));
  const preCry = at((e) => e.type === 'cry' && e.id === charmander, levelUp);
  const entryStop = at(named('stop', 'MUS_ROUTE1'), levelUp);
  expect(entryStop, msg).toBeLessThan(preCry);
  // EVOSTATE_INTRO_SOUND waits for IsCryFinished, EVOSTATE_START_MUSIC for MUS_EVOLUTION_INTRO's SE player
  const intro = at(named('se', 'MUS_EVOLUTION_INTRO'), preCry);
  const music = at(named('bgm', 'MUS_EVOLUTION'), intro);
  expect(evs[intro].frame - evs[preCry].frame, msg).toBeGreaterThan(20); // Charmander's cry, ~50 frames
  // MUS_EVOLUTION_INTRO's first tick ends the frame it starts in, its last ends frame intro + length - 1: the next
  // frame's !IsSEPlaying starts the map music, which MapMusicMain plays in that frame
  expect(evs[music].frame - evs[intro].frame, msg).toBe(songStopFrame('MUS_EVOLUTION_INTRO'));
  // The sparkles' SEs (evolution_graphics.c), in order
  let i = music;
  for (const se of ['SE_M_MEGA_KICK', 'SE_M_BUBBLE_BEAM2', 'SE_SHINY', 'SE_M_PETAL_DANCE', 'SE_EXP']) i = at(named('se', se), i);
  const exp = i;
  expect(evs[exp].started, msg).toBe(true);
  // EVOSTATE_RESTORE_SCREEN: IsSEPlaying is TRUE from the frame after SE_EXP started; m4aMPlayAllStop stops it and
  // MUS_EVOLUTION
  const expStop = at(named('stop', 'SE_EXP'), exp);
  expect(evs[expStop].frame - evs[exp].frame, msg).toBe(1);
  expect(evs.find((e, j) => j > exp && e.type === 'stop' && e.name === 'MUS_EVOLUTION')?.frame, msg).toBe(evs[expStop].frame);
  // The evolved mon's cry, then (IsCryFinished) MUS_EVOLVED on the BGM player
  const postCry = at((e) => e.type === 'cry' && e.id === charmeleon, expStop);
  const evolved = at(named('bgm', 'MUS_EVOLVED'), postCry);
  expect(evs[evolved].frame - evs[postCry].frame, msg).toBeGreaterThan(20);
  // EVOSTATE_END: StopMapMusic + Overworld_PlaySpecialMapMusic
  at(named('bgm', 'MUS_ROUTE1'), evolved);
  expect(await bgm(game)).toMatchObject({ song: 'MUS_ROUTE1', playing: true });
});

test('egg hatching: the map music stops, MUS_EVOLUTION_INTRO, MUS_EVOLUTION 60 frames later, the cry, MUS_EVOLVED; the map music back on the field', async () => {
  // As eggHatch.test.ts: a Bulbasaur egg with no cycles left hatches on the next step in Pallet Town.
  const game = await session.start({
    start: 'after-rival',
    map: 'PalletTown',
    x: 12,
    y: 14,
    party: [
      { species: 'PIDGEY', level: 10 },
      { species: 'BULBASAUR', level: 5, egg: 0 },
    ],
  });
  await game.eval((t) => void (t.state!.daycare.stepCounter = 254));
  expect(await bgm(game)).toMatchObject({ song: 'MUS_PALLET', playing: true });
  const mark = await game.mark();
  await game.eval((t) => t.walk('right'));
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_EggHatch_1', { button: 'B', what: 'the hatch scene' });
  // NO at the nickname prompt: back to the field
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });

  const bulbasaur = await species(game, 'SPECIES_BULBASAUR');
  const evs = await events(game, mark);
  const msg = show(evs);
  const at = (pred: (e: Ev) => boolean, from = 0) => {
    const i = evs.findIndex((e, j) => j >= from && pred(e));
    expect(i, msg).toBeGreaterThanOrEqual(0);
    return i;
  };
  const named = (type: string, name: string) => (e: Ev) => e.type === type && e.name === name;

  // Task_EggHatchPlayBGM: StopMapMusic (MapMusicMain plays MUS_DUMMY), PlayBGM(MUS_EVOLUTION_INTRO) the next frame,
  // PlayBGM(MUS_EVOLUTION) when data[0] passes 60
  const dummy = at(named('bgm', 'MUS_DUMMY'));
  const intro = at(named('bgm', 'MUS_EVOLUTION_INTRO'), dummy);
  const music = at(named('bgm', 'MUS_EVOLUTION'), intro);
  expect(evs[intro].frame - evs[dummy].frame, msg).toBe(1);
  expect(evs[music].frame - evs[intro].frame, msg).toBe(60);
  // The wobbles' SE_BALLs, SE_EGG_HATCH, the cry, MUS_EVOLVED (after IsCryFinished)
  const hatch = at(named('se', 'SE_EGG_HATCH'), at(named('se', 'SE_BALL'), music));
  const cry = at((e) => e.type === 'cry' && e.id === bulbasaur, hatch);
  const fanfare = at(named('fanfare', 'MUS_EVOLVED'), cry);
  expect(evs[fanfare].frame - evs[cry].frame, msg).toBeGreaterThan(20); // Bulbasaur's cry, 48 frames
  // FieldCB_ContinueScriptHandleMusic: Overworld_PlaySpecialMapMusic on the field
  at(named('bgm', 'MUS_PALLET'), fanfare);
  expect(await bgm(game)).toMatchObject({ song: 'MUS_PALLET', playing: true });
});

test("an in-game trade: MUS_EVOLUTION for the scene, both cries, MUS_EVOLVED, then the map's song again", async () => {
  // Route 2's Reyley trades his Mr. Mime for an Abra (as inGameTrades.test.ts).
  const game = await session.start({ start: 'after-rival', map: 'Route2_House', x: 7, y: 3, party: [{ species: 'PIDGEY', level: 9 }, { species: 'ABRA', level: 12 }] });
  const mapSong = (await bgm(game)).song;
  expect(mapSong).toBe('MUS_PEWTER'); // Route2_House's header
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_UpdatePartyMenu' && !t.paletteFadeActive(), { what: 'the party menu' });
  const mark = await game.mark();
  await game.press('DOWN');
  await game.press('A');
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_InGameTrade', { what: 'the trade scene' });
  await game.mashUntil((t) => t.idle(), { what: 'the field after the trade' });

  const abra = await species(game, 'SPECIES_ABRA');
  const mrMime = await species(game, 'SPECIES_MR_MIME');
  const evs = await events(game, mark);
  const msg = show(evs);
  const at = (pred: (e: Ev) => boolean, from = 0) => {
    const i = evs.findIndex((e, j) => j >= from && pred(e));
    expect(i, msg).toBeGreaterThanOrEqual(0);
    return i;
  };
  const named = (type: string, name: string) => (e: Ev) => e.type === type && e.name === name;

  // STATE_START: cachedMapMusic = GetCurrentMapMusic(), PlayNewMapMusic(MUS_EVOLUTION)
  const music = at(named('bgm', 'MUS_EVOLUTION'));
  const sendCry = at((e) => e.type === 'cry' && e.id === abra, music);
  // The balls, the signal, the new mon's cry; STATE_WAIT_FOR_MON_CRY's IsCryFinished, then MUS_EVOLVED 10 frames on
  at(named('se', 'SE_WARP_OUT'), sendCry);
  const newCry = at((e) => e.type === 'cry' && e.id === mrMime, sendCry);
  const fanfare = at(named('fanfare', 'MUS_EVOLVED'), newCry);
  expect(evs[fanfare].frame - evs[newCry].frame, msg).toBeGreaterThan(20); // Mr. Mime's cry, then 10 frames
  // STATE_WAIT_FADE_OUT_END: PlayNewMapMusic(cachedMapMusic)
  at(named('bgm', mapSong!), fanfare);
  expect(await bgm(game)).toMatchObject({ song: mapSong, playing: true });
});
