// itemfinder.c's hidden item search (src/world/itemfinderSearch.ts) on the extracted maps. Expected values are
// worked out by hand from the C: items within 7 tiles across and 5 up / down (the current map's bg events, and
// the connected maps' tiles in that box), underfoot items only when standing on them, 4 dings within 3 tiles
// along the longer axis (else 2), 3 for an underfoot item, and GetPlayerDirectionTowardsHiddenItem's DIR_*.

import { describe, expect, test } from 'vitest';
import type { MapData } from '../../src/data/types';
import {
  DIR_EAST,
  DIR_NONE,
  DIR_NORTH,
  DIR_SOUTH,
  DIR_WEST,
  GetPlayerDirectionTowardsHiddenItem,
  HiddenItemIsWithinRangeOfPlayer,
  newItemfinderSearch,
  RegisterHiddenItemRelativeCoordsIfCloser,
} from '../../src/world/itemfinderSearch';
import { readGen } from './gameData';

const index = readGen<Record<string, string>>('maps/index.json');
const mapById = (id: string) => readGen<MapData>(`maps/${index[id]}.json`);

/** Search from (x, y) on `map` with `flags` set. */
function search(map: string, x: number, y: number, flags: string[] = []) {
  const data = newItemfinderSearch();
  const found = HiddenItemIsWithinRangeOfPlayer({ map: readGen<MapData>(`maps/${map}.json`), mapHeader: mapById, player: { x, y }, flagGet: (f) => flags.includes(f) }, data);
  return { found, ...data, direction: GetPlayerDirectionTowardsHiddenItem(data.tItemX, data.tItemY) };
}

describe('HiddenItemIsWithinRangeOfPlayer', () => {
  // Route 3's hidden Oran Berry is at (26, 9).
  test('an item 2 tiles right: 4 dings, arrows to the right (DIR_NORTH)', () => {
    expect(search('Route3', 24, 9)).toMatchObject({ found: true, tItemX: 2, tItemY: 0, tNumDingsRemaining: 4, tUnderfoot: false, direction: DIR_NORTH });
  });
  test('6 tiles away: 2 dings', () => {
    expect(search('Route3', 20, 9)).toMatchObject({ found: true, tItemX: 6, tItemY: 0, tNumDingsRemaining: 2 });
  });
  test('the box: 7 across, 5 up and down', () => {
    expect(search('Route3', 33, 9)).toMatchObject({ found: true, tItemX: -7, direction: DIR_EAST });
    expect(search('Route3', 34, 9).found).toBe(false);
    expect(search('Route3', 26, 14)).toMatchObject({ found: true, tItemY: -5, direction: DIR_SOUTH });
    expect(search('Route3', 26, 15).found).toBe(false);
    expect(search('Route3', 26, 4)).toMatchObject({ found: true, tItemY: 5, direction: DIR_WEST });
    expect(search('Route3', 26, 3).found).toBe(false);
  });
  test('standing on an ordinary hidden item: 4 dings, DIR_NONE', () => {
    expect(search('Route3', 26, 9)).toMatchObject({ found: true, tItemX: 0, tItemY: 0, tNumDingsRemaining: 4, direction: DIR_NONE });
  });
  test('a picked-up item (its flag set) gives no response', () => {
    expect(search('Route3', 24, 9, ['FLAG_HIDDEN_ITEM_ROUTE3_ORAN_BERRY']).found).toBe(false);
  });
  // Route 12's Leftovers (14, 70) are underfoot (where Snorlax sleeps).
  test('an underfoot item only responds from on top of it: 3 dings', () => {
    const r = search('Route12', 14, 70);
    expect(r).toMatchObject({ found: true, tUnderfoot: true, tItemX: 0, tItemY: 0, tNumDingsRemaining: 3 });
    expect(r.underfootItem).toMatchObject({ item: 'ITEM_LEFTOVERS', flag: 'FLAG_HIDDEN_ITEM_ROUTE12_LEFTOVERS' });
    expect(search('Route12', 14, 71).found).toBe(false);
    expect(search('Route12', 14, 70, ['FLAG_HIDDEN_ITEM_ROUTE12_LEFTOVERS']).found).toBe(false);
  });
  // Route 12's Rare Candy (9, 116) is (57, -4) from Route 13, which hangs below Route 12 at offset -48.
  test("a connected map's item: Route 12's Rare Candy from Route 13", () => {
    expect(search('Route13', 62, 1)).toMatchObject({ found: true, tItemX: -5, tItemY: -5, tNumDingsRemaining: 2, direction: DIR_SOUTH });
    expect(search('Route13', 62, 1, ['FLAG_HIDDEN_ITEM_ROUTE12_RARE_CANDY']).found).toBe(false);
    expect(search('Route13', 62, 2).found).toBe(false); // 6 rows down
  });
  test('and the other way: Route 13’s map seen from Route 12 has nothing in range', () => {
    // Route 12 (9, 115): the Rare Candy one step down; Route 13's PP Up (23, 14) is far off
    expect(search('Route12', 9, 115)).toMatchObject({ found: true, tItemX: 0, tItemY: 1, tNumDingsRemaining: 4, direction: DIR_WEST });
  });
});

describe('RegisterHiddenItemRelativeCoordsIfCloser', () => {
  const pick = (...items: [number, number][]) => {
    const d = newItemfinderSearch();
    for (const [x, y] of items) RegisterHiddenItemRelativeCoordsIfCloser(d, x, y);
    return [d.tItemX, d.tItemY];
  };
  test('the closest by steps', () => {
    expect(pick([5, 1], [2, 2])).toEqual([2, 2]);
    expect(pick([2, 2], [5, 1])).toEqual([2, 2]);
  });
  test('on a tie, the smaller vertical distance, then the one further south', () => {
    expect(pick([0, 3], [3, 0])).toEqual([3, 0]);
    expect(pick([3, 0], [0, 3])).toEqual([3, 0]);
    expect(pick([0, -2], [0, 2])).toEqual([0, 2]);
    expect(pick([0, 2], [0, -2])).toEqual([0, 2]);
    expect(pick([-2, 0], [2, 0])).toEqual([-2, 0]); // same row: the first stays
  });
});

describe('GetPlayerDirectionTowardsHiddenItem', () => {
  test('the DIR_* CreateArrowSprite reads', () => {
    expect(GetPlayerDirectionTowardsHiddenItem(0, 0)).toBe(DIR_NONE);
    expect(GetPlayerDirectionTowardsHiddenItem(-3, 1)).toBe(DIR_EAST); // left
    expect(GetPlayerDirectionTowardsHiddenItem(3, -1)).toBe(DIR_NORTH); // right
    expect(GetPlayerDirectionTowardsHiddenItem(1, -3)).toBe(DIR_SOUTH); // up
    expect(GetPlayerDirectionTowardsHiddenItem(-1, 3)).toBe(DIR_WEST); // down
    expect(GetPlayerDirectionTowardsHiddenItem(2, -2)).toBe(DIR_SOUTH); // diagonal: up / down wins
    expect(GetPlayerDirectionTowardsHiddenItem(-2, 2)).toBe(DIR_WEST);
  });
});
