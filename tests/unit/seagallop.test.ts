import { describe, expect, test } from 'vitest';
import * as seagallop from '../../src/menus/seagallop';
import { GetSeagallopNumber, IsPlayerLeftOfVermilionSailor, TravelDirection } from '../../src/menus/seagallop';
import { GetSelectedSeagallopDestination, SeagallopDestinationMenuItems } from '../../src/script/ferrySpecials';
import { newGame } from './gameData';

// seagallop.c and script_menu.c's Seagallop menu, worked by hand from the decomp's tables.
const [V, ONE, TWO, THREE, FOUR, FIVE, SIX, SEVEN, CINNABAR, NAVEL, BIRTH] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MORE = 254;
const CANCEL = 127;

describe('seagallop.c', () => {
  test('the SEAGALLOP_* ids match include/constants/seagallop.h', () => {
    const t = newGame();
    for (const name of ['VERMILION_CITY', 'ONE_ISLAND', 'TWO_ISLAND', 'THREE_ISLAND', 'FOUR_ISLAND', 'FIVE_ISLAND', 'SIX_ISLAND', 'SEVEN_ISLAND', 'CINNABAR_ISLAND', 'NAVEL_ROCK', 'BIRTH_ISLAND']) {
      expect((seagallop as Record<string, unknown>)[`SEAGALLOP_${name}`], name).toBe(t.d(`SEAGALLOP_${name}`));
    }
    expect(t.d('SEAGALLOP_MORE')).toBe(MORE);
  });

  test('GetSeagallopNumber: Cinnabar 1, Vermilion 7, Navel Rock 10, Birth Island 12, then by island group', () => {
    expect(GetSeagallopNumber(CINNABAR, ONE)).toBe(1);
    expect(GetSeagallopNumber(ONE, CINNABAR)).toBe(1);
    expect(GetSeagallopNumber(V, CINNABAR)).toBe(1); // Cinnabar is checked first
    expect(GetSeagallopNumber(V, TWO)).toBe(7);
    expect(GetSeagallopNumber(SEVEN, V)).toBe(7);
    expect(GetSeagallopNumber(V, NAVEL)).toBe(7); // Vermilion before Navel Rock
    expect(GetSeagallopNumber(NAVEL, FOUR)).toBe(10);
    expect(GetSeagallopNumber(BIRTH, FOUR)).toBe(12);
    expect(GetSeagallopNumber(TWO, THREE)).toBe(2);
    expect(GetSeagallopNumber(ONE, ONE)).toBe(2);
    expect(GetSeagallopNumber(FIVE, FOUR)).toBe(3);
    expect(GetSeagallopNumber(SEVEN, SIX)).toBe(5);
    expect(GetSeagallopNumber(ONE, FOUR)).toBe(6);
    expect(GetSeagallopNumber(THREE, SEVEN)).toBe(6);
  });

  test('GetDirectionOfTravel: sTravelDirectionMatrix bit [origin][dest], eastbound for an unknown origin', () => {
    expect(TravelDirection(CINNABAR, ONE)).toBe(1); // 0x7ff: every trip from Cinnabar is eastbound
    expect(TravelDirection(ONE, CINNABAR)).toBe(0); // 0x6fc bit 8
    expect(TravelDirection(V, TWO)).toBe(1); // 0x6fe bit 2
    expect(TravelDirection(V, V)).toBe(0); // bit 0
    expect(TravelDirection(TWO, V)).toBe(0);
    expect(TravelDirection(FIVE, SIX)).toBe(1); // 0x4c0 bit 6
    expect(TravelDirection(FIVE, FOUR)).toBe(0);
    expect(TravelDirection(SIX, NAVEL)).toBe(0); // 0x400 bit 9
    expect(TravelDirection(SIX, BIRTH)).toBe(1); // bit 10
    expect(TravelDirection(BIRTH, V)).toBe(0); // 0x000
    expect(TravelDirection(11, V)).toBe(1);
  });

  test('IsPlayerLeftOfVermilionSailor: Vermilion City, x < 24', () => {
    expect(IsPlayerLeftOfVermilionSailor('MAP_VERMILION_CITY', 23)).toBe(true);
    expect(IsPlayerLeftOfVermilionSailor('MAP_VERMILION_CITY', 24)).toBe(false);
    expect(IsPlayerLeftOfVermilionSailor('MAP_ONE_ISLAND_HARBOR', 8)).toBe(false);
  });
});

describe("script_menu.c's Seagallop destination menu", () => {
  test('page 0 lists Vermilion to Four Island without the origin; page 1 Four or Five to Seven', () => {
    expect(SeagallopDestinationMenuItems(V, 0)).toEqual({ destinations: [ONE, TWO, THREE, FOUR], top: 0, numItems: 6 });
    expect(SeagallopDestinationMenuItems(THREE, 0).destinations).toEqual([V, ONE, TWO, FOUR]);
    expect(SeagallopDestinationMenuItems(SEVEN, 0).destinations).toEqual([V, ONE, TWO, THREE]);
    expect(SeagallopDestinationMenuItems(V, 1)).toEqual({ destinations: [FIVE, SIX, SEVEN], top: 2, numItems: 5 });
    expect(SeagallopDestinationMenuItems(FOUR, 1).destinations).toEqual([FIVE, SIX, SEVEN]);
    expect(SeagallopDestinationMenuItems(FIVE, 1).destinations).toEqual([FOUR, SIX, SEVEN]);
    expect(SeagallopDestinationMenuItems(SEVEN, 1).destinations).toEqual([FOUR, FIVE, SIX]);
  });

  test('GetSelectedSeagallopDestination maps each row back to what the menu showed', () => {
    for (const origin of [V, ONE, TWO, THREE, FOUR, FIVE, SIX, SEVEN]) {
      for (const page of [0, 1]) {
        const { destinations } = SeagallopDestinationMenuItems(origin, page);
        destinations.forEach((dest, row) => expect(GetSelectedSeagallopDestination(row, origin, page), `origin ${origin} page ${page} row ${row}`).toBe(dest));
        expect(GetSelectedSeagallopDestination(destinations.length, origin, page)).toBe(MORE); // OTHER
        expect(GetSelectedSeagallopDestination(destinations.length + 1, origin, page)).toBe(CANCEL); // EXIT
        expect(GetSelectedSeagallopDestination(CANCEL, origin, page)).toBe(CANCEL); // B
      }
    }
  });
});
