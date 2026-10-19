// The scenes' sounds, part 2 (AUDIO_PLAN.md W-sound 7b): the Hall of Fame (hall_of_fame.c) and its warp into the
// credits (credits.c), the Hall of Fame PC, the Pokédex (pokedex_screen.c) and the title screen (title_screen.c).
// Read through `__test.audioEvents` (each start / stop / fade with the logic tick it was made in, on the same seq and
// frame counters as `__test.events`); the engine runs headless with the output off, so the waits time like the GBA
// without anything being heard.

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';

const session = useGame();

interface Ev {
  seq: number;
  frame: number;
  type: string;
  id: number;
  name: string;
  player: string;
  mode?: number;
  fade?: string;
  speed?: number;
  started?: boolean;
}

const audioEvents = (game: Game, since: number): Promise<Ev[]> => game.eval((t, s) => t.audioEvents(s), since) as Promise<Ev[]>;
const define = (game: Game, name: string): Promise<number> => game.eval((t, n) => t.define(n), name);
/** The BGM player: song, playing, volume (track volX: 64 = full). */
const bgm = (game: Game) => game.eval((t) => t.audio().players.BGM);
/** One-line list of the events, for failure messages. */
const show = (evs: Ev[]) => evs.map((e) => `${e.frame} ${e.type} ${e.player} ${e.name || e.id}${e.fade ? ` ${e.fade} ${e.speed}` : ''}`).join('\n');

const PARTY: MonSpec[] = [
  { species: 'MEWTWO', level: 70, moves: ['PSYCHIC'] },
  { species: 'PIKACHU', level: 42 },
  { species: 'NIDORAN_M', level: 12 },
];

test('the Hall of Fame: MUS_HALL_OF_FAME, SE_SAVE, a cry per mon on its timer, SE_APPLAUSE, the fade; MUS_CREDITS and the credits cry', async () => {
  // The room's entrance (as hallOfFame.test.ts): the script walks the player to Oak, then `special EnterHallOfFame`
  const game = await session.start({ start: 'after-rival', map: 'PokemonLeague_HallOfFame', x: 5, y: 12, party: PARTY, speed: 16 });
  expect(await bgm(game)).toMatchObject({ song: 'MUS_SLOW_PALLET', playing: true });
  const since = await game.mark();
  await game.mashUntil((t) => t.events().some((e) => e.type === 'hallOfFameSaved'), { what: 'the Hall of Fame save', maxFrames: 40000 });
  // The first cry ducks the BGM (PlayCry_Normal: volume 85, Task_DuckBGMForPokemonCry restores it after the cry);
  // the screen doesn't wait for it: its 120-frame timer runs alongside
  const duck = await game.eval(async (t) => {
    await t.until(() => t.audio().cry.duckTaskActive, 3600);
    const ducked = t.audio().players.BGM.volume;
    await t.until(() => !t.audio().cry.duckTaskActive, 600);
    return { ducked, restored: t.audio().players.BGM.volume };
  });
  expect(duck).toEqual({ ducked: 85 >> 2, restored: 64 });
  await game.eval((t) => t.until(() => t.events().some((e) => e.type === 'hallOfFamePlayerInfo'), 6000));
  await game.press('A');
  await game.waitFor((t) => t.field()?.map === 'IndigoPlateau_Exterior', { what: 'Indigo Plateau' });
  const charizard = await define(game, 'SPECIES_CHARIZARD');
  await game.waitForEvent('creditsMon', { since, timeout: 240_000 });
  await game.eval((t, c) => t.until(() => t.audioEvents().some((e) => e.type === 'cry' && e.id === c), 600), charizard);

  const evs = await audioEvents(game, since);
  const msg = show(evs);
  const marks = await game.events(since);
  const at = (pred: (e: Ev) => boolean, from = 0) => {
    const i = evs.findIndex((e, j) => j >= from && pred(e));
    expect(i, msg).toBeGreaterThanOrEqual(0);
    return i;
  };
  const named = (type: string, name: string) => (e: Ev) => e.type === type && e.name === name;

  // InitHallOfFameScreen's PlayBGM, then Task_Hof_TrySaveData's SE_SAVE
  const music = at(named('bgm', 'MUS_HALL_OF_FAME'));
  const save = at(named('se', 'SE_SAVE'), music);
  const saved = marks.find((e) => e.type === 'hallOfFameSaved')!;
  expect(evs[save].frame).toBe(saved.frame);
  // Task_Hof_PlayMonCryAndPrintInfo: PlayCry_Normal(species, 0) in the frame the mon's info prints, 120 frames apart
  // at least (the timer, then the next mon's slide in)
  const species = await game.eval((t) => ['MEWTWO', 'PIKACHU', 'NIDORAN_M'].map((s) => t.define(`SPECIES_${s}`)));
  const monFrames = marks.filter((e) => e.type === 'hallOfFameMon').map((e) => e.frame);
  expect(monFrames).toHaveLength(3);
  let prev = save;
  const cryFrames: number[] = [];
  for (const [i, sp] of species.entries()) {
    prev = at((e) => e.type === 'cry' && e.id === sp, prev);
    expect(evs[prev].mode, msg).toBe(await define(game, 'CRY_MODE_NORMAL'));
    expect(evs[prev].frame, msg).toBe(monFrames[i]);
    cryFrames.push(evs[prev].frame);
  }
  expect(cryFrames[1] - cryFrames[0]).toBeGreaterThanOrEqual(121);
  expect(cryFrames[2] - cryFrames[1]).toBeGreaterThanOrEqual(121);
  // Task_Hof_PaletteFadeAndPrintWelcomeText's SE_APPLAUSE once the last mon's 120 frames are over
  const applause = at(named('se', 'SE_APPLAUSE'), prev);
  expect(evs[applause].frame - cryFrames[2], msg).toBeGreaterThanOrEqual(121);
  expect(evs[applause].frame).toBe(marks.find((e) => e.type === 'hallOfFameWelcome')!.frame);
  // A on the player's info: FadeOutBGM(4) on MUS_HALL_OF_FAME
  const fade = at((e) => e.type === 'fade' && e.fade === 'out' && e.player === 'BGM', applause);
  expect(evs[fade].speed).toBe(4);
  // SetWarpsToRollCredits' DoWarp: TryFadeOutOldMapMusic (MUS_SLOW_PALLET in the room, MUS_VICTORY_ROAD outside:
  // FadeOutMapMusic(4), outdoors) on the faded player, then Task_Teleport2Warp's BGMusicStopped wait; its SE_EXIT is
  // skipped (gDisableMapMusicChangeOnMapLoad is set), and so is the map's music on load (MUSIC_DISABLE_KEEP)
  const warpFade = at((e) => e.type === 'fade' && e.fade === 'out' && e.player === 'BGM', fade + 1);
  expect(evs[warpFade].speed).toBe(4);
  expect(evs[warpFade].frame).toBeLessThan(marks.find((e) => e.type === 'creditsStart')?.frame ?? Infinity);
  expect(evs.slice(fade + 1).some((e) => e.type === 'se'), msg).toBe(false);
  expect(evs.slice(fade + 1).some(named('bgm', 'MUS_VICTORY_ROAD')), msg).toBe(false);
  // IndigoPlateau_Exterior's ON_TRANSITION: `playbgm MUS_CREDITS, 0`
  const credits = at(named('bgm', 'MUS_CREDITS'), fade);
  // The Charizard scene: PlayCry_NormalNoDucking when the mon shows (no ducking task)
  const cry = at((e) => e.type === 'cry' && e.id === charizard, credits);
  expect(evs[cry].frame).toBeGreaterThan(marks.find((e) => e.type === 'creditsMon')!.frame);
  expect(await game.eval((t) => t.audio().cry.duckTaskActive)).toBe(false);
  expect(await bgm(game)).toMatchObject({ song: 'MUS_CREDITS', playing: true, volume: 64 });
}, 300_000);

/** Viridian City's Pokémon Center: the PC is above (11, 2). */
const PC = { start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 11, y: 2, party: PARTY } as const;

test('the Hall of Fame PC: a cry per mon shown, the last one stopped first; B during a cry stops it and the BGM comes back up', async () => {
  const game = await session.start(PC);
  await game.eval((t) => {
    const s = t.state!;
    const team = ['MEWTWO', 'PIKACHU'].map((sp) => {
      const species = t.define(`SPECIES_${sp}`);
      return { tid: s.trainerId, personality: 0, species, lvl: 50, nick: [...s.pokemon.speciesName(species)] };
    });
    while (team.length < 6) team.push({ tid: 0, personality: 0, species: 0, lvl: 0, nick: [] });
    localStorage.setItem('firered-phaser:hall-of-fame', JSON.stringify({ version: 1, teams: [team] }));
    s.setGameStat(t.define('GAME_STAT_ENTERED_HOF'), 1);
    s.setFlag('FLAG_SYS_GAME_CLEAR', true);
  });
  const music = (await bgm(game)).song;
  const since = await game.mark();
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /Which PC/.test(t.message() ?? ''), { what: 'the PC menu' });
  await game.eval((t) => t.waitFrames(60));
  await game.pressTimes('DOWN', 3);
  await game.press('A');
  const [mewtwo, pikachu] = await game.eval((t) => [t.define('SPECIES_MEWTWO'), t.define('SPECIES_PIKACHU')]);
  // Mewtwo's page, then DOWN to Pikachu's; B while Pikachu's cry plays (all in the page, so it is still playing)
  const state = await game.eval(async (t) => {
    const ready = () => t.hallOfFame()?.task === 'Task_HofPC_HandleInput';
    await t.until(() => ready() && t.audio().cry.playing, 3600);
    await t.waitFrames(2);
    await t.press('DOWN');
    await t.until(() => ready() && t.events().filter((e) => e.type === 'hallOfFamePcMon').length === 2 && t.audio().cry.playing, 600);
    const ducked = t.audio().players.BGM.volume;
    await t.press('B');
    await t.until(() => t.events().some((e) => e.type === 'hallOfFamePcExit'), 600);
    return { ducked, cryPlaying: t.audio().cry.playing };
  });
  expect(state).toEqual({ ducked: 85 >> 2, cryPlaying: false });
  const evs = await audioEvents(game, since);
  const msg = show(evs);
  const cries = evs.filter((e) => e.type === 'cry').map((e) => e.id);
  expect(cries, msg).toEqual([mewtwo, pikachu]);
  // Task_HofPC_PrintMonInfo's StopCryAndClearCrySongs before Pikachu's cry, Task_HofPC_HandleInput's on B after it
  const pika = evs.findIndex((e) => e.type === 'cry' && e.id === pikachu);
  expect(evs[pika - 1], msg).toMatchObject({ type: 'stop' });
  expect(evs.slice(pika + 1).some((e) => e.type === 'stop' && e.player.startsWith('CRY')), msg).toBe(true);
  // m4aMPlayVolumeControl(&gMPlayInfo_BGM, TRACKS_ALL, 0x100); then back on the field the map's music as before
  await game.waitFor((t) => /Which PC/.test(t.message() ?? '') && !t.gbaScreen(), { what: 'the PC menu again' });
  expect(await bgm(game)).toMatchObject({ song: music, playing: true, volume: 64 });
});

test("the Pokédex: the BGM at half volume while it's open, the mon page's cry and START's, the volume back after", async () => {
  const game = await session.start({ start: 'after-rival', map: 'PalletTown', x: 12, y: 14 });
  await game.eval((t) => {
    const s = t.state!;
    s.setFlag('FLAG_SYS_POKEDEX_GET', true);
    s.dexSeen.add(1);
    s.dexCaught.add(1);
  });
  expect(await bgm(game)).toMatchObject({ song: 'MUS_PALLET', volume: 64 });
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.until(() => !!t.startMenu()));
  const since = await game.mark();
  await game.press('A');
  await game.waitFor((t) => t.gbaScreen() === 'CB2_PokedexScreen', { what: 'the Pokédex' });
  // DexScreen_LoadResources: SetBGMVolume_SuppressHelpSystemReduction(0x80)
  expect(await bgm(game)).toMatchObject({ song: 'MUS_PALLET', playing: true, volume: 0x80 >> 2 });
  const ready = (task: string) => game.eval((t, task) => t.until(() => t.pokedex()?.task === task && !!t.pokedex()?.ready), task);
  await ready('Task_PokedexScreen');
  await game.press('A');
  await ready('Task_DexScreen_NumericalOrder');
  const pageMark = await game.mark();
  await game.press('A');
  await game.eval((t) => t.until(() => t.pokedex()?.task === 'Task_DexScreen_ShowMonPage' && !!t.pokedex()?.ready && t.pokedex()?.monPage?.species === 1));
  // The mon page's PlayCry_NormalNoDucking: no ducking, the BGM stays at 0x80
  let evs = await audioEvents(game, pageMark);
  expect(evs.filter((e) => e.type === 'cry').map((e) => e.id), show(evs)).toEqual([await define(game, 'SPECIES_BULBASAUR')]);
  expect(await game.eval((t) => t.audio().cry.duckTaskActive)).toBe(false);
  expect((await bgm(game)).volume).toBe(0x80 >> 2);
  // START on the page: CRY
  const startMark = await game.mark();
  await game.press('START');
  await game.eval((t, s) => t.until(() => t.audioEvents(s).some((e) => e.type === 'cry'), 60), startMark);
  // B back to the list, B to the top menu, B closes: DoClosePokedex's BGMVolumeMax_EnableHelpSystemReduction
  await game.press('B');
  await ready('Task_DexScreen_NumericalOrder');
  await game.press('B');
  await ready('Task_PokedexScreen');
  await game.press('B');
  // CB2_ClosePokedex: back to the field with the start menu open
  await game.waitFor((t) => t.gbaScreen() !== 'CB2_PokedexScreen' && !!t.startMenu(), { what: 'the start menu again' });
  expect(await bgm(game)).toMatchObject({ song: 'MUS_PALLET', playing: true, volume: 64 });
  evs = await audioEvents(game, since);
  expect(evs.filter((e) => e.type === 'se').length, show(evs)).toBeGreaterThan(0); // the menus' SE_SELECTs
});

test('the title screen: MUS_TITLE; START: the Charizard cry, then FadeOutBGM(4)', async () => {
  const game = await session.start({ title: true });
  await game.waitFor((t) => t.titleScreen()?.scene === 'RUN', { what: 'the title screen to run', timeout: 60_000 });
  let evs = await audioEvents(game, 0);
  expect(evs.filter((e) => e.type === 'bgm').map((e) => e.name), show(evs)).toContain('MUS_TITLE');
  expect(await bgm(game)).toMatchObject({ song: 'MUS_TITLE', playing: true });
  const since = await game.mark();
  await game.press('START');
  await game.waitForEvent('mainMenu', { since, timeout: 60_000 });
  evs = await audioEvents(game, since);
  const msg = show(evs);
  const cry = evs.findIndex((e) => e.type === 'cry');
  expect(cry, msg).toBeGreaterThanOrEqual(0);
  expect(evs[cry]).toMatchObject({ id: await define(game, 'SPECIES_CHARIZARD'), mode: await define(game, 'CRY_MODE_NORMAL') });
  // SetTitleScreenScene_Cry: 90 frames after the cry, the white fade and FadeOutBGM(4)
  const fade = evs.findIndex((e, i) => i > cry && e.type === 'fade' && e.fade === 'out');
  expect(fade, msg).toBeGreaterThan(cry);
  expect(evs[fade].speed).toBe(4);
  expect(evs[fade].frame - evs[cry].frame).toBeGreaterThanOrEqual(90);
});
