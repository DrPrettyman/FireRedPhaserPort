// renewable_hidden_items.c (world/renewableHiddenItems.ts): the new game's flags, the step counter and the
// regeneration on a map load.

import { describe, expect, test } from 'vitest';
import type { Constants } from '../../src/data/types';
import { seedRng } from '../../src/util/random';
import {
  IncrementRenewableHiddenItemStepCounter,
  TryRegenerateRenewableHiddenItems,
} from '../../src/world/renewableHiddenItems';
import { newGame, readGen } from './gameData';

const table = readGen<Constants>('constants.json').renewableHiddenItems;

/** random.c's LCG written out independently: the `count` values Random() returns after seedRng(seed). */
function referenceRolls(seed: number, count: number): number[] {
  let s = BigInt(seed);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    s = (s * 1103515245n + 24691n) & 0xffffffffn;
    out.push(Number(s >> 16n));
  }
  return out;
}

describe('renewable hidden items (renewable_hidden_items.c)', () => {
  test('the table: the fifteen maps of sRenewableHiddenItems, eight ids per group', () => {
    expect(table).toHaveLength(15);
    expect(table[0]).toMatchObject({ map: 'MAP_ROUTE20' });
    expect(table.map((e) => e.map)).toContain('MAP_THREE_ISLAND_BERRY_FOREST');
    for (const e of table) for (const g of [e.rare, e.uncommon, e.common]) expect(g).toHaveLength(8);
  });

  test('a new game starts with every renewable item hidden (NewGameInitData: SetAllRenewableItemFlags)', () => {
    const { state } = newGame();
    expect(state.getFlag('FLAG_HIDDEN_ITEM_ROUTE20_STARDUST')).toBe(true);
    expect(state.getFlag('FLAG_HIDDEN_ITEM_THREE_ISLAND_BERRY_FOREST_LUM_BERRY')).toBe(true);
    expect(state.getFlag('FLAG_HIDDEN_ITEM_UNDERGROUND_PATH_EAST_WEST_TUNNEL_ETHER')).toBe(true);
    // not renewable: still there
    expect(state.getFlag('FLAG_HIDDEN_ITEM_ROUTE9_ETHER')).toBe(false);
    expect(state.getFlag('FLAG_HIDDEN_ITEM_VIRIDIAN_FOREST_POTION')).toBe(false);
  });

  test('every step counts VAR_RENEWABLE_ITEM_STEP_COUNTER up to 1500', () => {
    const { state } = newGame();
    expect(state.getVar('VAR_RENEWABLE_ITEM_STEP_COUNTER')).toBe(0);
    IncrementRenewableHiddenItemStepCounter(state);
    expect(state.getVar('VAR_RENEWABLE_ITEM_STEP_COUNTER')).toBe(1);
    state.setVar('VAR_RENEWABLE_ITEM_STEP_COUNTER', 1499);
    IncrementRenewableHiddenItemStepCounter(state);
    IncrementRenewableHiddenItemStepCounter(state);
    expect(state.getVar('VAR_RENEWABLE_ITEM_STEP_COUNTER')).toBe(1500);
  });

  test('nothing comes back on a map outside the table, or before 1500 steps', () => {
    const { state } = newGame();
    state.setVar('VAR_RENEWABLE_ITEM_STEP_COUNTER', 1500);
    state.currentMapId = 'MAP_ROUTE9';
    TryRegenerateRenewableHiddenItems(state);
    expect(state.getVar('VAR_RENEWABLE_ITEM_STEP_COUNTER')).toBe(1500);
    expect(state.getFlag('FLAG_HIDDEN_ITEM_ROUTE20_STARDUST')).toBe(true);

    state.setVar('VAR_RENEWABLE_ITEM_STEP_COUNTER', 1499);
    state.currentMapId = 'MAP_ROUTE20';
    TryRegenerateRenewableHiddenItems(state);
    expect(state.getVar('VAR_RENEWABLE_ITEM_STEP_COUNTER')).toBe(1499);
    expect(state.getFlag('FLAG_HIDDEN_ITEM_ROUTE20_STARDUST')).toBe(true);
  });

  test('at 1500 on a table map: the counter resets, and each map gets one group back by its Random() % 100 roll', () => {
    for (const seed of [1, 7, 0x1234, 0xbeef]) {
      const { state, d } = newGame();
      const start = d('FLAG_HIDDEN_ITEMS_START');
      // An item a group had and the player hasn't picked up yet is hidden again first (SetAllRenewableItemFlags)
      state.setFlag('FLAG_HIDDEN_ITEM_ROUTE20_STARDUST', false);
      state.setVar('VAR_RENEWABLE_ITEM_STEP_COUNTER', 1500);
      state.currentMapId = 'MAP_ONE_ISLAND_TREASURE_BEACH'; // any map in the table regenerates all fifteen
      seedRng(seed);
      TryRegenerateRenewableHiddenItems(state);
      expect(state.getVar('VAR_RENEWABLE_ITEM_STEP_COUNTER')).toBe(0);
      const rolls = referenceRolls(seed, table.length).map((r) => r % 100);
      table.forEach((entry, i) => {
        const chosen = rolls[i] >= 90 ? entry.rare : rolls[i] >= 60 ? entry.uncommon : entry.common;
        const visible = new Set(chosen.filter((id) => id !== 0xff));
        for (const id of [...entry.rare, ...entry.uncommon, ...entry.common]) {
          if (id === 0xff) continue;
          expect(state.getFlag(start + id), `${entry.map} hidden id ${id} (roll ${rolls[i]}, seed ${seed})`).toBe(!visible.has(id));
        }
      });
    }
  });
});
