// The end of the game: walking into the Hall of Fame room runs PokemonLeague_HallOfFame_EventScript_EnterRoom
// (Oak, FLDEFF_HALL_OF_FAME_RECORD, the post-game flags, `setrespawn`), then `special EnterHallOfFame`: the Hall of
// Fame screen saves the team and the game, shows the mons, the welcome text with confetti and the player's info,
// and warps to Indigo Plateau, whose script rolls the credits; they end in a reset to the main menu. The Hall of
// Fame PC shows the saved teams.

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';

const session = useGame();

const PARTY: MonSpec[] = [
  { species: 'MEWTWO', level: 70, moves: ['PSYCHIC'] },
  { species: 'PIKACHU', level: 42 },
  { species: 'NIDORAN_M', level: 12 },
];

/** The Hall of Fame room's entrance: the script walks the player up 8 tiles to Oak and the machine. */
const HALL_OF_FAME = { start: 'after-rival', map: 'PokemonLeague_HallOfFame', x: 5, y: 12, party: PARTY, speed: 16 } as const;

const hofRecords = (game: Game) => game.eval(() => JSON.parse(localStorage.getItem('firered-phaser:hall-of-fame') ?? 'null'));
const savedGame = (game: Game) => game.eval(() => JSON.parse(localStorage.getItem('firered-phaser:save') ?? 'null'));

/** Through Oak's speech to the Hall of Fame screen's save; returns once the record has been written. */
async function enterHallOfFame(game: Game): Promise<void> {
  const since = await game.mark();
  await game.mashUntil((t) => t.events().some((e) => e.type === 'hallOfFameSaved'), { what: 'the Hall of Fame save', maxFrames: 40000 });
  const ev = await game.waitForEvent('hallOfFameSaved', { since });
  expect(ev.status).toBe(1); // SAVE_STATUS_OK
}

/** Wait (in the page) for the trainer info window, then press A to leave. */
async function leaveHallOfFame(game: Game): Promise<void> {
  const ok = await game.eval((t) => t.until(() => t.events().some((e) => e.type === 'hallOfFamePlayerInfo'), 6000));
  expect(ok).toBe(true);
  await game.press('A');
  await game.waitForEvent('hallOfFameExit');
}

test('the Hall of Fame saves the team and the game, then the credits roll and the game restarts', async () => {
  const game = await session.start(HALL_OF_FAME);
  const since = await game.mark();
  await enterHallOfFame(game);
  // The script before the special: the post-game flags and vars, and the respawn point
  expect(await game.eval((t) => t.flag('FLAG_SYS_GAME_CLEAR'))).toBe(true);
  expect(await game.eval((t) => t.flag('FLAG_HIDE_POSTGAME_GOSSIPERS'))).toBe(false);
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_PALLET_TOWN_OAK'))).toBe(2); // no National Dex yet
  expect(await game.eval((t) => t.state!.lastHealLocation)).toEqual({ map: 'MAP_PALLET_TOWN', x: 6, y: 8 });
  // The record (this team only) and the game, saved with GAME_STAT_ENTERED_HOF and CONTINUE from Pallet Town
  const records = await hofRecords(game);
  expect(records.teams).toHaveLength(1);
  const team = records.teams[0];
  const species = await game.eval((t) => ['MEWTWO', 'PIKACHU', 'NIDORAN_M'].map((s) => t.define(`SPECIES_${s}`)));
  expect(team.slice(0, 3).map((m: { species: number }) => m.species)).toEqual(species);
  expect(team.slice(0, 3).map((m: { lvl: number }) => m.lvl)).toEqual([70, 42, 12]);
  expect(team[3].species).toBe(0);
  const save = await savedGame(game);
  expect(save.gameStats[await game.eval((t) => t.define('GAME_STAT_ENTERED_HOF'))]).toBe(1);
  expect(save.flags).toContain(await game.eval((t) => t.define('FLAG_SYS_GAME_CLEAR')));
  expect(save.continueGameWarp).toEqual({ mapId: 'MAP_PALLET_TOWN', warpId: -1, x: 6, y: 8 });

  await leaveHallOfFame(game);
  const mons = (await game.eval((t, s) => t.events(s).filter((e) => e.type === 'hallOfFameMon').map((e) => e.species), since)) as number[];
  expect(mons).toEqual(species);
  expect(await game.eval((t, s) => t.events(s).some((e) => e.type === 'hallOfFameWelcome'), since)).toBe(true);
  // SetWarpsToRollCredits
  await game.waitFor((t) => t.field()?.map === 'IndigoPlateau_Exterior', { what: 'Indigo Plateau' });
  expect(await game.eval((t) => t.flag('FLAG_DONT_SHOW_MAP_NAME_POPUP'))).toBe(true);

  // IndigoPlateau_Exterior_EventScript_Credits: the rival and Oak leave, the player runs off, `special DoCredits`
  await game.waitForEvent('creditsStart', { since, timeout: 120_000 });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_INDIGO_PLATEAU_EXTERIOR'))).toBe(0);
  expect(await game.eval((t) => t.objects().length)).toBe(0);
  // The title, then Route 23 with the first names, then the Charizard scene
  expect((await game.waitForEvent('creditsMap', { since, timeout: 120_000 })).map).toBe('MAP_ROUTE23');
  expect((await game.waitForEvent('creditsPrint', { since, timeout: 60_000 })).title).toBe('gCreditsString_Director');
  expect((await game.waitForEvent('creditsMon', { since, timeout: 120_000 })).species).toBe(await game.eval((t) => t.define('SPECIES_CHARIZARD')));
  // Skip the rest of the names: the copyright, THE END, A, and SoftReset back to the boot flow
  expect(
    await game.eval((t) => {
      let skipped = false;
      return t.until(() => skipped || (skipped = t.creditsSkipToClosing()), 3600);
    }),
  ).toBe(true);
  await game.waitForEvent('creditsTheEnd', { since, timeout: 60_000 });
  await game.press('A');
  await game.waitForEvent('creditsEnd', { since });
  // The saved game boots to the main menu; CONTINUE starts in Pallet Town (the continue-game warp)
  await game.waitForEvent('mainMenu', { since, timeout: 60_000 });
  await game.eval((t) => t.until(() => t.mainMenu() && !t.mainMenu()!.fading, 600));
  await game.press('A');
  await game.waitFor((t) => t.field()?.map === 'PalletTown', { what: 'Pallet Town', timeout: 60_000 });
  expect(await game.eval((t) => ({ x: t.field()!.x, y: t.field()!.y }))).toEqual({ x: 6, y: 8 });
  // VAR_MAP_SCENE_PALLET_TOWN_OAK = 2 (EventScript_SetReadyTryGiveNationalDexScene): Oak's rating scene starts
  await game.waitFor((t) => t.events().some((e) => e.type === 'script' && e.label === 'PalletTown_EventScript_OakRatingScene'), { what: "Oak's scene" });
  expect(await game.eval((t) => t.flag('FLAG_SYS_GAME_CLEAR'))).toBe(true);
  expect(await game.eval((t) => t.flag('FLAG_DONT_SHOW_MAP_NAME_POPUP'))).toBe(false);
}, 300_000);

/** Viridian City's Pokémon Center: the PC is above (11, 2). */
const PC = { start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 11, y: 2, party: PARTY } as const;

/** Write Hall of Fame records (oldest first) and the GAME_STAT_ENTERED_HOF count that goes with them; set FLAG_SYS_GAME_CLEAR. */
const setRecords = (game: Game, teams: [string, number][][]) =>
  game.eval((t, ts) => {
    const s = t.state!;
    const team = (mons: [string, number][]) => {
      const out = mons.map(([sp, lvl]) => {
        const species = t.define(`SPECIES_${sp}`);
        return { tid: s.trainerId, personality: 0, species, lvl, nick: [...s.pokemon.speciesName(species)] };
      });
      while (out.length < 6) out.push({ tid: 0, personality: 0, species: 0, lvl: 0, nick: [] });
      return out;
    };
    if (ts.length) localStorage.setItem('firered-phaser:hall-of-fame', JSON.stringify({ version: 1, teams: ts.map(team) }));
    s.setGameStat(t.define('GAME_STAT_ENTERED_HOF'), ts.length);
    s.setFlag('FLAG_SYS_GAME_CLEAR', true);
  }, teams);

/** Turn on the PC and pick HALL OF FAME (the 4th entry once the game is clear). */
async function openHallOfFamePc(game: Game): Promise<void> {
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /Which PC/.test(t.message() ?? ''), { what: 'the PC menu' });
  await game.eval((t) => t.waitFrames(60)); // the message prints, then CreatePCMenu
  await game.pressTimes('DOWN', 3);
  await game.press('A');
}

/** Wait (in the page) for the PC screen to show team `team`'s mon `slot`; returns the event. */
const waitPcMon = (game: Game, since: number, team: number, slot: number) =>
  game.eval(
    async (t, s, tm, sl) => {
      const find = () => t.events(s).find((e) => e.type === 'hallOfFamePcMon' && e.team === tm && e.slot === sl);
      await t.until(() => find() && t.hallOfFame()?.task === 'Task_HofPC_HandleInput', 3600);
      return find();
    },
    since,
    team,
    slot,
  );

test('the Hall of Fame PC shows the saved teams, newest first, then the PC menu again', async () => {
  const game = await session.start(PC);
  await setRecords(game, [
    [['VENUSAUR', 60]],
    [['MEWTWO', 70], ['PIKACHU', 42], ['NIDORAN_M', 12], ['CHARIZARD', 50]],
  ]);
  const since = await game.mark();
  await openHallOfFamePc(game);
  // HALL OF FAME No. 2: the newer team, its first mon
  const first = await waitPcMon(game, since, 1, 0);
  expect(first).toMatchObject({ page: 2, species: await game.eval((t) => t.define('SPECIES_MEWTWO')) });
  await game.press('DOWN');
  expect(await waitPcMon(game, since, 1, 1)).toMatchObject({ species: await game.eval((t) => t.define('SPECIES_PIKACHU')) });
  // A: the older team (No. 1)
  await game.press('A');
  expect(await waitPcMon(game, since, 0, 0)).toMatchObject({ page: 1, species: await game.eval((t) => t.define('SPECIES_VENUSAUR')) });
  // A on the last team turns the PC screen off: back to the PC menu (ReshowPCMenuAfterHallOfFamePC)
  await game.press('A');
  await game.waitForEvent('hallOfFamePcExit', { since });
  await game.waitFor((t) => !t.field()?.fading && /Which PC/.test(t.message() ?? '') && !t.gbaScreen(), { what: 'the PC menu again' });
  expect(await game.eval((t) => t.field()?.script)).toBeTruthy();
  // B closes the PC menu (SCR_MENU_CANCEL → EventScript_TurnOffPC)
  await game.eval((t) => t.waitFrames(4));
  await game.press('B');
  await game.waitIdle();
  expect(await game.eval((t) => t.message())).toBeUndefined();
});

test('the Hall of Fame PC without saved records says the data is corrupted', async () => {
  const game = await session.start(PC);
  await setRecords(game, []);
  const since = await game.mark();
  await openHallOfFamePc(game);
  await game.waitForEvent('hallOfFamePcCorrupted', { since });
  await game.eval((t) => t.until(() => t.hallOfFame()?.task === 'Task_HofPC_ExitOnButtonPress', 600));
  await game.press('A');
  await game.waitForEvent('hallOfFamePcExit', { since });
  await game.waitFor((t) => !t.field()?.fading && /Which PC/.test(t.message() ?? '') && !t.gbaScreen(), { what: 'the PC menu again' });
});
