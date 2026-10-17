// The evolution scene (evolution_scene.c): after a battle (TryEvolvePokemon), learning a move on the way,
// stopping it with B, and from the field's bag with a Rare Candy or an evolution stone.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

const ROUTE1 = { start: 'after-rival', map: 'Route1', x: 12, y: 7 } as const;

/** Put the first party mon one exp point short of `level`. */
const setExpJustBelow = (game: Game, level: number) =>
  game.eval((t, lv) => {
    const mon = t.state!.party[0];
    const pk = t.state!.pokemon;
    mon.exp = pk.tables.experience[pk.species[mon.species].growthRate][lv] - 1;
  }, level);

test('a Caterpie that reaches level 7 in battle evolves into Metapod and learns Harden', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'CATERPIE', level: 6, iv: 31 }] });
  await setExpJustBelow(game, 7);
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));

  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_EvolutionSceneUpdate'), { what: 'the evolution scene after the battle' });
  const evolved = await game.waitForEvent('evolution', { timeout: 60_000 });
  expect(evolved).toMatchObject({ stopped: false });
  expect(await game.eval((t, e) => [t.nameOf('SPECIES_', e.from as number), t.nameOf('SPECIES_', e.to as number)], evolved)).toEqual(['SPECIES_CATERPIE', 'SPECIES_METAPOD']);

  // "Congratulations! ...", then Metapod's level-7 move, then back to the field.
  await game.mashUntil((t) => t.idle(), { what: 'the field after the evolution' });
  const [mon] = await game.eval((t) => t.party());
  expect(mon).toMatchObject({ species: 'METAPOD', nickname: 'METAPOD', level: 7 });
  expect(mon.moves).toContain('HARDEN');
  expect(await game.eval((t) => t.state!.dexCaught.has(11))).toBe(true); // national dex #011
  expect(await game.eval((t) => t.field()?.map)).toBe('Route1');
});

test('with four moves, the evolved mon forgets one through the summary screen', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'CATERPIE', level: 6, iv: 31, moves: ['TACKLE', 'STRING_SHOT', 'POUND', 'SCRATCH'] }] });
  await setExpJustBelow(game, 7);
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_EvolutionSceneUpdate'), { what: 'the evolution scene after the battle' });
  await game.waitForEvent('evolution', { timeout: 60_000 });

  // "...trying to learn HARDEN" ... "Delete a move...?" YES → the summary screen → A on the first move
  // (TACKLE) → back to the evolution scene: "1, 2, and... Poof!".
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_RunPokemonSummaryScreen'), { what: 'the summary screen' });
  await game.mashUntil((t) => t.party()[0].moves.includes('HARDEN'), { what: 'HARDEN learned' });
  await game.mashUntil((t) => t.idle(), { what: 'the field after the evolution' });

  const [mon] = await game.eval((t) => t.party());
  expect(mon.species).toBe('METAPOD');
  expect(mon.moves).toEqual(['HARDEN', 'STRING_SHOT', 'POUND', 'SCRATCH']);
});

test('holding B stops the evolution', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'CATERPIE', level: 6, iv: 31 }] });
  await setExpJustBelow(game, 7);
  await game.eval((t) => t.startWildBattle({ species: 'RATTATA', level: 2 }));

  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_EvolutionSceneUpdate'), { what: 'the evolution scene after the battle' });
  await game.eval((t) => t.hold('B'));
  const stopped = await game.waitForEvent('evolution', { timeout: 60_000 });
  await game.eval((t) => t.release('B'));
  expect(stopped).toMatchObject({ stopped: true });

  await game.mashUntil((t) => t.idle(), { what: 'the field after "stopped evolving"' });
  const [mon] = await game.eval((t) => t.party());
  expect(mon).toMatchObject({ species: 'CATERPIE', nickname: 'CATERPIE', level: 7 });
  expect(await game.eval((t) => t.state!.dexCaught.has(11))).toBe(false);
});

/** From the field: START → BAG → the only item → USE → the first party mon, then out of the bag again once the scene ends. */
async function useOnlyItemFromBag(game: Game) {
  await game.waitIdle();
  await game.press('START');
  await game.eval((t) => t.waitFrames(10));
  await game.press('DOWN');
  await game.press('A');
  await game.waitForBag();
  await game.pressTimes('A', 3);

  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_EvolutionSceneUpdate'), { what: 'the evolution scene' });
  const evolved = await game.waitForEvent('evolution', { timeout: 60_000 });

  // Back to the bag (gPartyMenu.exitCallback), then out to the field.
  await game.mashUntil((t) => t.gbaScreen() !== undefined && !t.gbaScreen()!.startsWith('CB2_EvolutionScene'), { what: 'the bag after the evolution' });
  await game.waitForBag();
  await game.press('B'); // close the bag: back to the start menu
  await game.mashUntil((t) => t.idle(), { button: 'B', what: 'the field' });
  return evolved;
}

test('a Rare Candy from the bag evolves the mon in the field', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'CHARMANDER', level: 15 }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_RARE_CANDY'), 1));
  // "CHARMANDER was elevated to Lv. 16!" and the stats box come before the scene.
  expect(await useOnlyItemFromBag(game)).toMatchObject({ stopped: false });

  const [mon] = await game.eval((t) => t.party());
  expect(mon).toMatchObject({ species: 'CHARMELEON', nickname: 'CHARMELEON', level: 16 });
  expect(await game.eval((t) => t.itemCount('RARE_CANDY'))).toBe(0);
  expect(await game.eval((t) => t.state!.dexCaught.has(5))).toBe(true); // national dex #005
});

test('a Fire Stone evolves Growlithe into Arcanine', async () => {
  const game = await session.start({ ...ROUTE1, party: [{ species: 'GROWLITHE', level: 20 }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_FIRE_STONE'), 1));
  expect(await useOnlyItemFromBag(game)).toMatchObject({ stopped: false });

  const [mon] = await game.eval((t) => t.party());
  expect(mon).toMatchObject({ species: 'ARCANINE', nickname: 'ARCANINE', level: 20 });
  expect(await game.eval((t) => t.itemCount('FIRE_STONE'))).toBe(0);
});

test('the evolution test bed (?start=evolution): beating Rick evolves the starter', async () => {
  const game = await session.start({ start: 'evolution', starter: 'squirtle' });
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'ViridianForest', x: 41, y: 45 });
  const party = await game.eval((t) => t.party());
  expect(party.map((m) => [m.species, m.level])).toEqual([
    ['SQUIRTLE', 15],
    ['CATERPIE', 6],
    ['PIKACHU', 10],
  ]);
  expect(await game.eval((t) => [t.itemCount('RARE_CANDY'), t.itemCount('THUNDER_STONE')])).toEqual([1, 1]);

  // Mashing A uses the first move, and a Lv. 15 Squirtle's is Tail Whip: lead with Water Gun instead.
  await game.eval((t) => {
    const mon = t.state!.party[0];
    const i = mon.moves.indexOf(t.define('MOVE_WATER_GUN'));
    [mon.moves[0], mon.moves[i]] = [mon.moves[i], mon.moves[0]];
    [mon.pp[0], mon.pp[i]] = [mon.pp[i], mon.pp[0]];
    t.state!.battleStyleSet = true; // no "Will you switch?" between Rick's mons (A would say YES)
  });
  await game.walk('right');
  await game.waitForEvent('trainerApproach');
  await game.mashUntil((t) => t.gbaScreen()?.startsWith('CB2_EvolutionSceneUpdate'), { what: 'the evolution scene after beating Rick' });
  await game.mashUntil((t) => t.idle(), { what: 'the field after the evolution' });
  expect(await game.eval((t) => t.party()[0])).toMatchObject({ species: 'WARTORTLE', level: 16 });
  expect(await game.eval((t) => t.trainerDefeated('BUG_CATCHER_RICK'))).toBe(true);
});
