// Wild encounters and wild battles: the encounter dice in Route 1's tall grass, running away, and
// catching a Pokémon with a nickname.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** Route 1's northern grass patch covers (10..21, 6..10). */
const ROUTE1_GRASS = { start: 'after-rival', map: 'Route1', x: 12, y: 7 } as const;

const outcomeOf = async (game: Game) => {
  const end = await game.waitForEvent('battleEnd');
  return game.eval((t, o) => t.nameOf('B_OUTCOME_', o), end.outcome as number);
};

test('walking in tall grass leads to a wild encounter', async () => {
  const game = await session.start(ROUTE1_GRASS);
  // Pace back and forth through the grass until the dice say so.
  for (let i = 0; i < 100 && !(await game.events()).some((e) => e.type === 'battleStart'); i++) {
    await game.walk(i % 2 ? 'left' : 'right', 3);
  }
  const start = await game.waitForEvent('battleStart', { timeout: 1000, what: 'an encounter within 300 steps' });
  expect(start.trainer).toBe(0);
  const wild = await game.waitFor((t) => t.battle()?.mons.length === 2 && t.battle()!.mons[1].species !== 'NONE' && t.battle()!.mons[1], { what: 'the wild mon' });
  // Route 1 (FireRed): Pidgey and Rattata, levels 2-5.
  expect(['PIDGEY', 'RATTATA']).toContain(wild.species);
  expect(wild.level).toBeGreaterThanOrEqual(2);
  expect(wild.level).toBeLessThanOrEqual(5);
});

test('running from a wild battle returns to the field', async () => {
  const game = await session.start({ ...ROUTE1_GRASS, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 3 }));
  await game.chooseAction('RUN'); // faster than the wild mon, so the escape always works
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: '"Got away safely!"' });
  expect(await outcomeOf(game)).toBe('B_OUTCOME_RAN');
  await game.mashUntil((t) => t.idle(), { what: 'the field to fade back in' });
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'Route1', x: 12, y: 7 });
  expect(await game.eval((t) => t.party().length)).toBe(1);
});

test('catching a wild Pokémon with a Master Ball and nicknaming it', async () => {
  const game = await session.start({ ...ROUTE1_GRASS, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_MASTER_BALL'), 1));
  await game.eval((t) => t.startWildBattle({ species: 'PIDGEY', level: 2 }));

  // BAG → the POKé BALLS pocket (two to the right of ITEMS) → MASTER BALL → throw it.
  await game.chooseAction('BAG');
  await game.waitForBag();
  await game.pressTimes('RIGHT', 2);
  await game.pressTimes('A', 2);

  // "Gotcha! PIDGEY was caught!", the Pokédex entry, then "Give a nickname...?" YES → the naming screen.
  await game.mashUntil((t) => t.gbaScreen() === 'CB2_NamingScreen', { what: 'the naming screen' });
  await game.eval((t) => t.waitFrames(30)); // the screen fades in
  await game.pressTimes('A', 3); // the cursor starts on "A"
  await game.press('START'); // jump to OK
  await game.press('A');
  await game.mashUntil((t) => t.idle(), { what: 'the field after the battle' });

  expect(await outcomeOf(game)).toBe('B_OUTCOME_CAUGHT');
  const party = await game.eval((t) => t.party());
  expect(party).toHaveLength(2);
  expect(party[1]).toMatchObject({ species: 'PIDGEY', nickname: 'AAA', level: 2 });
  expect(await game.eval((t) => t.itemCount('MASTER_BALL'))).toBe(0);
  expect(await game.eval((t) => t.state!.dexCaught.has(16))).toBe(true); // national dex #016
});
