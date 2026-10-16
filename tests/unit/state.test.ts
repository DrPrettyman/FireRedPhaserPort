import { beforeEach, describe, expect, test } from 'vitest';
import type { Constants } from '../../src/data/types';
import { newGame, readGen, type TestGame } from './gameData';

let t: TestGame;
const item = (name: string) => t.d(`ITEM_${name}`);

beforeEach(() => {
  t = newGame();
});

describe('Bag (item.c)', () => {
  test('starts empty', () => {
    expect(t.state.bag.pockets.flat().every((s) => s.quantity === 0)).toBe(true);
  });

  test('adds to one stack per item and removes from it', () => {
    const bag = t.state.bag;
    expect(bag.add(item('POTION'), 3)).toBe(true);
    expect(bag.add(item('POTION'), 2)).toBe(true);
    expect(bag.has(item('POTION'), 5)).toBe(true);
    expect(bag.has(item('POTION'), 6)).toBe(false);
    expect(bag.remove(item('POTION'), 4)).toBe(true);
    expect(bag.has(item('POTION'), 1)).toBe(true);
    expect(bag.remove(item('POTION'), 2)).toBe(false); // not enough: nothing removed
    expect(bag.remove(item('POTION'), 1)).toBe(true);
    expect(bag.has(item('POTION'), 1)).toBe(false);
  });

  test('items land in their pocket', () => {
    const bag = t.state.bag;
    bag.add(item('POKE_BALL'), 1);
    bag.add(item('POTION'), 1);
    const pocketOf = (id: number) => bag.pockets.findIndex((p) => p.some((s) => s.itemId === id)) + 1;
    expect(pocketOf(item('POKE_BALL'))).toBe(t.d('POCKET_POKE_BALLS'));
    expect(pocketOf(item('POTION'))).toBe(t.d('POCKET_ITEMS'));
  });

  test('a stack holds at most 999', () => {
    const bag = t.state.bag;
    expect(bag.add(item('POTION'), 999)).toBe(true);
    expect(bag.hasSpace(item('POTION'), 1)).toBe(false);
    expect(bag.add(item('POTION'), 1)).toBe(false);
    expect(bag.has(item('POTION'), 999)).toBe(true);
  });

  test('a full pocket refuses a new item but still stacks existing ones', () => {
    const bag = t.state.bag;
    const capacity = t.d('BAG_ITEMS_COUNT');
    const items = t.pokemon.items.flatMap((info, id) => (id !== item('NONE') && info.pocket === t.d('POCKET_ITEMS') ? [id] : []));
    expect(items.length).toBeGreaterThan(capacity);
    for (const id of items.slice(0, capacity)) expect(bag.add(id, 1)).toBe(true);
    expect(bag.hasSpace(items[capacity], 1)).toBe(false);
    expect(bag.add(items[capacity], 1)).toBe(false);
    expect(bag.add(items[0], 5)).toBe(true);
  });

  test('the first TM also gives the TM Case', () => {
    const bag = t.state.bag;
    expect(bag.has(item('TM_CASE'), 1)).toBe(false);
    expect(bag.add(item('TM01'), 1)).toBe(true);
    expect(bag.has(item('TM_CASE'), 1)).toBe(true);
    expect(bag.has(item('TM01'), 1)).toBe(true);
  });

  test('the first berry also gives the Berry Pouch and sets its flag', () => {
    const bag = t.state.bag;
    expect(t.state.getFlag('FLAG_SYS_GOT_BERRY_POUCH')).toBe(false);
    expect(bag.add(item('ORAN_BERRY'), 1)).toBe(true);
    expect(bag.has(item('BERRY_POUCH'), 1)).toBe(true);
    expect(t.state.getFlag('FLAG_SYS_GOT_BERRY_POUCH')).toBe(true);
  });

  test('ITEM_NONE cannot be removed', () => {
    expect(t.state.bag.remove(item('NONE'), 0)).toBe(false);
  });
});

describe('GameState', () => {
  test('money: new game 3000, capped at 999999, floored at 0', () => {
    expect(t.state.money).toBe(3000);
    t.state.addMoney(2_000_000);
    expect(t.state.money).toBe(999999);
    t.state.removeMoney(5_000_000);
    expect(t.state.money).toBe(0);
  });

  test('coins: capped at MAX_COINS, and removal needs enough', () => {
    const max = t.d('MAX_COINS');
    expect(t.state.addCoins(max + 50)).toBe(true);
    expect(t.state.coins).toBe(max);
    expect(t.state.addCoins(1)).toBe(false);
    expect(t.state.removeCoins(max + 1)).toBe(false);
    expect(t.state.removeCoins(10)).toBe(true);
    expect(t.state.coins).toBe(max - 10);
  });

  test('flags and vars resolve by name or number', () => {
    t.state.setFlag('FLAG_SYS_POKEMON_GET');
    expect(t.state.getFlag(t.d('FLAG_SYS_POKEMON_GET'))).toBe(true);
    t.state.setVar('VAR_STARTER_MON', 2);
    expect(t.state.getVar(t.d('VAR_STARTER_MON'))).toBe(2);
    expect(t.state.value('VAR_STARTER_MON')).toBe(2);
    expect(t.state.value('0x10')).toBe(16);
  });

  test('temp flags and vars clear on map entry; others stay', () => {
    t.state.setFlag('FLAG_TEMP_1');
    t.state.setVar('VAR_TEMP_1', 7);
    t.state.setFlag('FLAG_SYS_POKEMON_GET');
    t.state.clearTemps();
    expect(t.state.getFlag('FLAG_TEMP_1')).toBe(false);
    expect(t.state.getVar('VAR_TEMP_1')).toBe(0);
    expect(t.state.getFlag('FLAG_SYS_POKEMON_GET')).toBe(true);
  });

  test('the new-game flags from the extractor start set', () => {
    const { newGameFlags } = readGen<Constants>('constants.json');
    expect(newGameFlags.length).toBeGreaterThan(0);
    for (const f of newGameFlags) expect(t.state.getFlag(f)).toBe(true);
  });

  test('party holds six; a seventh mon goes to the PC', () => {
    const mk = () => t.pokemon.createMon(t.d('SPECIES_PIDGEY'), 3, { otId: 1, otName: 'RED', otGender: 'male', metLocation: 'MAPSEC_ROUTE_1' });
    for (let i = 0; i < 6; i++) expect(t.state.giveMon(mk())).toBe(t.d('MON_GIVEN_TO_PARTY'));
    expect(t.state.party).toHaveLength(6);
    expect(t.state.giveMon(mk())).toBe(t.d('MON_GIVEN_TO_PC'));
    expect(t.state.party).toHaveLength(6);
  });
});
