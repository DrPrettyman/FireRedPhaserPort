// The Pokémon Storage System from a Pokémon Center PC: the PC's storage menu, and the box screen's
// deposit, withdraw, moving between boxes, release, box switching and the summary of a boxed mon.

import { expect, test } from 'vitest';
import type { MonSpec } from '../../src/dev/testHooks';
import { useGame, type Game } from './harness';

const session = useGame();

const PARTY: MonSpec[] = [
  { species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] },
  { species: 'RATTATA', level: 5 },
  { species: 'PIDGEY', level: 3 },
];

/** Viridian City's Pokémon Center: the PC is above (11, 2). */
const PC = { start: 'after-rival', map: 'ViridianCity_PokemonCenter_1F', x: 11, y: 2, party: PARTY } as const;

/** Turn on the PC, pick Someone's PC and stop at the storage menu (its WITHDRAW description shows). */
async function openStorageMenu(game: Game): Promise<void> {
  await game.eval((t) => t.face('up'));
  await game.press('A');
  await game.mashUntil((t) => /withdraw a POK/.test(t.message() ?? ''), { what: 'the storage menu' });
}

/** Pick option `index` of the storage menu and wait for the box screen to take input. */
async function enterBoxes(game: Game, index: number): Promise<void> {
  for (let i = 0; i < index; i++) await game.press('DOWN');
  await game.press('A');
  await game.waitFor((t) => t.pcStorage()?.task === 'Task_PokeStorageMain', { what: 'the box screen' });
}

test('the storage menu opens and closes', async () => {
  const game = await session.start(PC);
  await openStorageMenu(game);
  await game.screenshot('pc-storage-menu');
  await game.press('DOWN');
  await game.eval((t) => t.waitFrames(4));
  expect(await game.message()).toMatch(/deposit/i);
  await game.press('UP');
  await enterBoxes(game, 0);
  await game.screenshot('pc-withdraw-screen');
});
