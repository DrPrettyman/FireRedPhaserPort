// wild_encounter.c's fishing: ChooseWildMonIndex_Fishing's slots per rod, DoesCurrentMapHaveFishingMons and
// FishingWildEncounter's mon. Expected slots are from include/wild_encounter.h's ENCOUNTER_CHANCE_FISHING_MONS_*
// (old rod 70/30; good rod 60/20/20; super rod 40/40/15/4/1, each rod's slots numbered on from the last's).

import { beforeAll, describe, expect, test } from 'vitest';
import { initConstants } from '../../src/battle/constants';
import type { WildEncounterData } from '../../src/data/types';
import type { Pokemon } from '../../src/pokemon/Pokemon';
import { seedRng } from '../../src/util/random';
import { ChooseWildMonIndex_Fishing, WildEncounters } from '../../src/world/WildEncounters';
import { newGame, readGen } from './gameData';

const data = readGen<WildEncounterData>('wild_encounters.json');
const chances = data.chances.fishing_mons;
const OLD_ROD = 0;
const GOOD_ROD = 1;
const SUPER_ROD = 2;

beforeAll(() => initConstants(readGen<{ defines: Record<string, number> }>('scripts/scripts.json').defines));

describe('ChooseWildMonIndex_Fishing', () => {
  /** [roll, slot] at each threshold's edges */
  const cases: [number, number, number][] = [
    [OLD_ROD, 0, 0],
    [OLD_ROD, 69, 0],
    [OLD_ROD, 70, 1],
    [OLD_ROD, 99, 1],
    [GOOD_ROD, 0, 2],
    [GOOD_ROD, 59, 2],
    [GOOD_ROD, 60, 3],
    [GOOD_ROD, 79, 3],
    [GOOD_ROD, 80, 4],
    [GOOD_ROD, 99, 4],
    [SUPER_ROD, 0, 5],
    [SUPER_ROD, 39, 5],
    [SUPER_ROD, 40, 6],
    [SUPER_ROD, 79, 6],
    [SUPER_ROD, 80, 7],
    [SUPER_ROD, 94, 7],
    [SUPER_ROD, 95, 8],
    [SUPER_ROD, 98, 8],
    [SUPER_ROD, 99, 9],
  ];
  test.each(cases)('rod %i, roll %i: slot %i', (rod, roll, slot) => {
    expect(ChooseWildMonIndex_Fishing(roll, rod, chances)).toBe(slot);
  });

  test('the roll is Random() % 100 (the largest rod total)', () => {
    expect(ChooseWildMonIndex_Fishing(100 + 70, OLD_ROD, chances)).toBe(1);
    expect(ChooseWildMonIndex_Fishing(0xffff, SUPER_ROD, chances)).toBe(ChooseWildMonIndex_Fishing(0xffff % 100, SUPER_ROD, chances));
  });
});

describe('FishingWildEncounter', () => {
  function setUp(mapId: string) {
    const game = newGame();
    game.state.currentMapId = mapId;
    const started: Pokemon[] = [];
    const wild = new WildEncounters(data, game.state, game.defines, {
      startWildBattle: (mon) => started.push(mon),
      startRoamerBattle: () => {
        throw new Error('no roamer');
      },
    });
    return { game, wild, started };
  }

  test('DoesCurrentMapHaveFishingMons: Pallet Town has a pond, Route 1 doesn\'t', () => {
    expect(setUp('MAP_PALLET_TOWN').wild.doesCurrentMapHaveFishingMons()).toBe(true);
    expect(setUp('MAP_ROUTE1').wild.doesCurrentMapHaveFishingMons()).toBe(false);
  });

  test('the Old Rod in Pallet Town hooks a level 5-10 Magikarp and starts the battle', () => {
    const { game, wild, started } = setUp('MAP_PALLET_TOWN');
    for (let seed = 0; seed < 20; seed++) {
      seedRng(seed);
      wild.fishingWildEncounter(OLD_ROD);
    }
    expect(started).toHaveLength(20);
    for (const mon of started) {
      expect(mon.species).toBe(game.d('SPECIES_MAGIKARP'));
      expect(mon.level).toBeGreaterThanOrEqual(5);
      expect(mon.level).toBeLessThanOrEqual(10);
    }
  });

  test('the Super Rod in Pallet Town picks from slots 5-9 only', () => {
    const { game, wild, started } = setUp('MAP_PALLET_TOWN');
    const superSlots = ['SPECIES_HORSEA', 'SPECIES_SHELLDER', 'SPECIES_GYARADOS', 'SPECIES_SEADRA', 'SPECIES_PSYDUCK'].map((s) => game.d(s));
    for (let seed = 0; seed < 50; seed++) {
      seedRng(seed);
      wild.fishingWildEncounter(SUPER_ROD);
    }
    for (const mon of started) {
      expect(superSlots).toContain(mon.species);
      expect(mon.level).toBeGreaterThanOrEqual(15);
      expect(mon.level).toBeLessThanOrEqual(35);
    }
  });
});
