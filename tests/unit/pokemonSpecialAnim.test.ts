// pokemon_special_anim_scene.c's positions: menu2.c's sMonPosAttributes (extracted to menus.json's monPosAttributes)
// as Menu2_GetMonPosAttribute reads it, checked against rows of the decomp's table.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, expect, test } from 'vitest';
import { loadMenusData } from '../../src/menus/data';
import { Menu2_GetMonPosAttribute } from '../../src/menus/pokemonSpecialAnimScene';
import { newBattleEnv, type TestGame } from './gameData';

const PUBLIC = resolve(__dirname, '../../public');
let game: TestGame;

beforeAll(async () => {
  game = await newBattleEnv();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const path = resolve(PUBLIC, String(url).replace(/^\//, ''));
    return existsSync(path) ? new Response(readFileSync(path)) : new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    await loadMenusData('gen');
  } finally {
    globalThis.fetch = realFetch;
  }
});

const attrs = (species: string, personality = 0) => [0, 1, 2, 3, 4].map((a) => Menu2_GetMonPosAttribute(game.d(`SPECIES_${species}`), personality, a));

test('rows of sMonPosAttributes: [TMHM_X, TMHM_Y, Y_OFFSET, ITEM_X, ITEM_Y]', () => {
  expect(attrs('BULBASAUR')).toEqual([22, 27, 48, 22, 41]);
  expect(attrs('CHARMANDER')).toEqual([20, 15, 56, 19, 30]);
  expect(attrs('BUTTERFREE')).toEqual([18, 27, 8, 18, 42]);
  expect(attrs('DEOXYS')).toEqual([27, 8, 40, 28, 22]); // FIRERED's row, not LEAFGREEN's
  expect(attrs('CHIMECHO')).toEqual([29, 12, 8, 28, 26]);
});

test('Unown: the letter picks its row (A is SPECIES_UNOWN, ! and ? the last two), SPECIES_NONE is 32', () => {
  // GET_UNOWN_LETTER takes the low two bits of each personality byte: 26 = 0b00_01_10_10 → bytes 0, 1, 2, 2.
  const p26 = (1 << 16) | (2 << 8) | 2;
  const p27 = (1 << 16) | (2 << 8) | 3;
  expect(attrs('UNOWN', p26)).toEqual([32, 33, 8, 32, 43]);
  expect(attrs('UNOWN', p27)).toEqual([32, 35, 8, 32, 45]);
  expect(Menu2_GetMonPosAttribute(0, 0, 0)).toBe(32);
});
