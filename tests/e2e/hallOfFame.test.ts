// The end of the game: walking into the Hall of Fame room runs PokemonLeague_HallOfFame_EventScript_EnterRoom
// (Oak, FLDEFF_HALL_OF_FAME_RECORD, the post-game flags, `setrespawn`), then `special EnterHallOfFame`: the Hall of
// Fame screen saves the team and the game, shows the mons, the welcome text with confetti and the player's info,
// and warps to Indigo Plateau for the credits. The Hall of Fame PC shows the saved teams.

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
const HALL_OF_FAME = { start: 'after-rival', map: 'PokemonLeague_HallOfFame', x: 5, y: 12, party: PARTY } as const;

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

test('entering the Hall of Fame saves the team and the game, shows each mon, then warps to Indigo Plateau', async () => {
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
});
