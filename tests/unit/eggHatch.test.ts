// daycare.c's CreatedHatchedMon / AddHatchedMonToParty through `special ScriptHatchMon` (no scene).

import { beforeAll, expect, test } from 'vitest';
import { EGG_HATCH_SPECIALS } from '../../src/menus/eggHatch';
import type { Pokemon } from '../../src/pokemon/Pokemon';
import type { SpecialEnv } from '../../src/script/specials';
import { newBattleEnv, type TestGame } from './gameData';

let t: TestGame;

beforeAll(async () => {
  t = await newBattleEnv();
});

/** CreateEgg (daycare.c) as the port's test hook makes it: level 5, isEgg, friendship = egg cycles. */
function egg(species: string): Pokemon {
  const mon = t.pokemon.createMon(t.d(`SPECIES_${species}`), 5, { otId: t.state.trainerId, otName: t.state.playerName, otGender: t.state.playerGender, metLocation: 'MAPSEC_FOUR_ISLAND' });
  mon.isEgg = true;
  mon.friendship = 0;
  mon.metLevel = 0;
  mon.nickname = t.charmap.encodePlain('タマゴ');
  mon.ivs = { hp: 1, attack: 2, defense: 3, speed: 4, spAttack: 5, spDefense: 6 };
  mon.moves = [t.d('MOVE_TACKLE'), t.d('MOVE_GROWL'), t.d('MOVE_PETAL_DANCE'), 0]; // an egg move from a parent
  mon.pp = [1, 1, 1, 0];
  mon.ppBonuses = 0;
  mon.markings = 5;
  mon.pokerus = 0x13;
  return mon;
}

test('ScriptHatchMon hatches party slot VAR_0x8004 into a level-5 mon with the egg\'s IVs, moves and personality', () => {
  const lead = t.pokemon.createMon(t.d('SPECIES_PIDGEY'), 20, { otId: 1, otName: 'RED', otGender: 'male', metLocation: 'MAPSEC_ROUTE_1' });
  const e = egg('BULBASAUR');
  t.state.party = [lead, e];
  t.state.currentMapSection = 'MAPSEC_ROUTE_5';
  t.state.setVar('VAR_0x8004', 1);
  t.state.dexSeen.clear();
  t.state.dexCaught.clear();

  EGG_HATCH_SPECIALS.ScriptHatchMon({ state: t.state } as SpecialEnv);

  const mon = t.state.party[1];
  expect(t.state.party[0]).toBe(lead);
  expect(mon).not.toBe(e);
  expect(mon.isEgg).toBe(false);
  expect(mon.species).toBe(t.d('SPECIES_BULBASAUR'));
  expect(mon.level).toBe(5); // EGG_HATCH_LEVEL
  expect(mon.exp).toBe(t.pokemon.tables.experience[t.pokemon.species[mon.species].growthRate][5]);
  expect(mon.personality).toBe(e.personality);
  expect(mon.ivs).toEqual({ hp: 1, attack: 2, defense: 3, speed: 4, spAttack: 5, spDefense: 6 });
  expect(mon.moves).toEqual([t.d('MOVE_TACKLE'), t.d('MOVE_GROWL'), t.d('MOVE_PETAL_DANCE'), 0]);
  // MonRestorePP: each move's full PP
  expect(mon.pp).toEqual([35, 40, 20, 0]);
  expect(mon.friendship).toBe(120);
  expect(mon.markings).toBe(5);
  expect(mon.pokerus).toBe(0x13);
  expect(mon.nickname).toEqual(t.charmap.encodePlain('BULBASAUR'));
  expect(mon.metLevel).toBe(0);
  expect(mon.metLocation).toBe('MAPSEC_ROUTE_5');
  expect(mon.pokeball).toBe(t.d('ITEM_POKE_BALL'));
  expect(mon.otId).toBe(t.state.trainerId);
  expect(mon.otName).toBe(t.state.playerName);
  expect(mon.heldItem).toBe(0);
  expect(mon.evs).toEqual({ hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 });
  expect(mon.hp).toBe(mon.maxHP);
  expect(mon.maxHP).toBeGreaterThan(0);
  // GetSetPokedexFlag: seen and caught
  expect(t.state.dexSeen.has(1)).toBe(true);
  expect(t.state.dexCaught.has(1)).toBe(true);
  // DayCare_GetMonNickname(mon, gStringVar1)
  expect(t.state.stringVars[0]).toEqual(t.charmap.encodePlain('BULBASAUR'));
});

test('a hatched mon\'s stats are its level-5 stats from the egg\'s IVs', () => {
  const e = egg('CHARMANDER');
  e.ivs = { hp: 31, attack: 31, defense: 31, speed: 31, spAttack: 31, spDefense: 31 };
  t.state.party = [e];
  t.state.setVar('VAR_0x8004', 0);
  EGG_HATCH_SPECIALS.ScriptHatchMon({ state: t.state } as SpecialEnv);
  const mon = t.state.party[0];
  // Charmander (39 HP base): HP = (2*39 + 31) * 5 / 100 + 5 + 10 = 20; Atk (52) = (104 + 31) * 5 / 100 + 5 = 11, nature-modified
  expect(mon.maxHP).toBe(20);
  expect([9, 11, 12]).toContain(mon.stats.attack);
});
