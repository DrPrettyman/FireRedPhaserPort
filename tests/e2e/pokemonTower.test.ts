// Pokémon Tower 6F's ghost Marowak (PokemonTower_6F_EventScript_MarowakGhost): special StartMarowakBattle,
// then CB2_EndMarowakBattle's VAR_RESULT picks between calming the ghost and pushing the player back.

import { expect, test } from 'vitest';
import { useGame, type Game } from './harness';

const session = useGame();

/** One step above the event's trigger at (11, 15). */
const TOWER_6F = { start: 'after-rival', map: 'PokemonTower_6F', x: 11, y: 14 } as const;

const outcomeOf = async (game: Game, since: number) => {
  const end = await game.waitForEvent('battleEnd', { since });
  return game.eval((t, o) => t.nameOf('B_OUTCOME_', o), end.outcome as number);
};

test('with the Silph Scope, beating the ghost Marowak calms its spirit', async () => {
  const game = await session.start({ ...TOWER_6F, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  await game.eval((t) => t.state!.bag.add(t.define('ITEM_SILPH_SCOPE'), 1));
  const since = await game.mark();
  await game.walk('down');
  // "Be gone… Intruders…", then special StartMarowakBattle
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleStart'), { what: 'the Marowak battle' });
  const marowak = await game.waitFor((t) => t.battle()?.mons[1]?.species !== 'NONE' && t.battle()?.mons[1], { what: 'the ghost' });
  // CreateMonWithGenderNatureLetter(…, SPECIES_MAROWAK, 30, 31, MON_FEMALE, NATURE_SERIOUS, 0)
  expect(marowak).toMatchObject({ species: 'MAROWAK', level: 30, nickname: 'GHOST' });
  const enemy = await game.eval((t) => {
    const s = t.state!;
    const mon = s.enemyParty[0];
    return { gender: s.pokemon.gender(mon), nature: s.pokemon.nature(mon), ivs: Object.values(mon.ivs), female: t.define('MON_FEMALE'), serious: t.define('NATURE_SERIOUS') };
  });
  expect(enemy.gender).toBe(enemy.female);
  expect(enemy.nature).toBe(enemy.serious);
  expect(enemy.ivs).toEqual([31, 31, 31, 31, 31, 31]);

  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: 'the battle to end' });
  expect(await outcomeOf(game, since)).toBe('B_OUTCOME_WON');
  // VAR_RESULT FALSE: "The GHOST was the restless soul of CUBONE's mother!", "The mother's spirit was calmed…"
  await game.mashUntil((t) => t.idle(), { what: 'the script to end' });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_POKEMON_TOWER_6F'))).toBe(1);
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'PokemonTower_6F', x: 11, y: 15 });
});

test('without the Silph Scope, running from the ghost pushes the player back', async () => {
  const game = await session.start({ ...TOWER_6F, party: [{ species: 'MEWTWO', level: 100, moves: ['PSYCHIC'] }] });
  const since = await game.mark();
  await game.walk('down');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleStart'), { what: 'the Marowak battle' });
  const start = await game.waitForEvent('battleStart', { since });
  expect(start.flags).toBe(await game.eval((t) => t.define('BATTLE_TYPE_GHOST')));
  // The `setwildbattle SPECIES_MAROWAK, 30` mon, still unidentified.
  expect(await game.eval((t) => t.state!.enemyParty.map((m) => [m.species, m.level]))).toEqual([[await game.eval((t) => t.define('SPECIES_MAROWAK')), 30]]);
  expect(await game.waitFor((t) => t.battle()?.mons[1]?.nickname === 'GHOST', { what: 'the ghost' })).toBe(true);

  await game.chooseAction('RUN');
  await game.mashUntil((t) => t.events().some((e) => e.type === 'battleEnd'), { what: '"Got away safely!"' });
  expect(await outcomeOf(game, since)).toBe('B_OUTCOME_RAN');
  // VAR_RESULT TRUE: PokemonTower_6F_Movement_ForcePlayerUp
  await game.mashUntil((t) => t.idle(), { what: 'the script to end' });
  expect(await game.eval((t) => t.field())).toMatchObject({ map: 'PokemonTower_6F', x: 11, y: 14 });
  expect(await game.eval((t) => t.var('VAR_MAP_SCENE_POKEMON_TOWER_6F'))).toBe(0);
});
